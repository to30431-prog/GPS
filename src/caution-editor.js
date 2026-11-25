// ==========================================
// [Module] src/caution-editor.js
// 共用「黃色提醒表單」與「✏️ 相片標記編輯器（Canvas）」獨立模組
// - 雙入口共用：
//   1. 路線紀錄中「⚠️ 標註注意」（鎖定當下 GPS 與時間戳記，背景 watchPosition/計時/距離 100% 持續不中斷）
//   2. 路線編輯器「⚠️ 單點新增／編輯黃色提醒」
// - 內建 5 大常用快選標籤、紅/黃/白三色畫筆與粗細、Aa 可拖移高對比文字框、>= 10 步復原、還原原圖
// - 匯出合成 JPEG（最大寬度 800px、品質 0.7、防爆 <= 150KB），關閉時釋放 Canvas 與 ObjectURL 防記憶體洩漏
// ==========================================

(function initSharedCautionAndPhotoEditor() {
    'use strict';

    const QUICK_TAGS = [
        '狹窄難會車',
        '低垂電線/樹枝',
        '違停佔道',
        '倒車死角',
        '路面坑洞'
    ];

    const BRUSH_COLORS = [
        { id: 'red', hex: '#FF3B30', label: '紅' },
        { id: 'yellow', hex: '#FFD60A', label: '黃' },
        { id: 'white', hex: '#FFFFFF', label: '白' }
    ];

    const BRUSH_SIZES = [
        { id: 'sm', width: 4, label: '細' },
        { id: 'md', width: 8, label: '中' },
        { id: 'lg', width: 14, label: '粗' }
    ];

    const MAX_UNDO_STEPS = 20; // >= 10 步堆疊
    const EXPORT_MAX_WIDTH = 800;
    const EXPORT_QUALITY = 0.7;
    const EXPORT_MAX_BYTES = 150 * 1024;

    // 共用表單狀態（絕不影響背景 GPS 錄製）
    let activeFormSession = null; // { mode, title, initialNote, initialPhoto, lockedCoord, lockedTime, onSave, onDelete, onCancel }
    let currentPhotoDataUrl = '';
    let originalUnannotatedPhotoUrl = '';
    const trackedObjectUrls = new Set();

    // 相片標記編輯器狀態
    let photoEditorModalEl = null;
    let editorCanvas = null;
    let editorCtx = null;
    let editorBaseImg = null;
    let editorLogicalW = 0;
    let editorLogicalH = 0;
    let editorTool = 'brush'; // 'brush' | 'text'
    let editorBrushColor = '#FF3B30';
    let editorBrushWidth = 8;
    let editorStrokes = [];
    let editorTexts = [];
    let editorUndoStack = [];
    let activeStroke = null;
    let draggingTextIdx = -1;
    let dragTextOffsetX = 0;
    let dragTextOffsetY = 0;
    let isEditorBound = false;

    function revokeAllTrackedObjectUrls() {
        trackedObjectUrls.forEach(url => {
            try { URL.revokeObjectURL(url); } catch (e) {}
        });
        trackedObjectUrls.clear();
    }

    // 壓縮來源影像或 Canvas 為 JPEG Base64（最大寬度 800px、品質 0.7、防爆 <= 150KB），並釋放暫存 Canvas
    function compressSourceToJpegDataUrl(source, srcW, srcH) {
        let targetW = Math.max(1, Number(srcW) || EXPORT_MAX_WIDTH);
        let targetH = Math.max(1, Number(srcH) || 600);
        if (targetW > EXPORT_MAX_WIDTH) {
            targetH = Math.max(1, Math.round(targetH * (EXPORT_MAX_WIDTH / targetW)));
            targetW = EXPORT_MAX_WIDTH;
        }

        const offCanvas = document.createElement('canvas');
        offCanvas.width = targetW;
        offCanvas.height = targetH;
        const ctx = offCanvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(source, 0, 0, targetW, targetH);

        let quality = EXPORT_QUALITY;
        let dataUrl = offCanvas.toDataURL('image/jpeg', quality);
        let byteSize = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);

        while (byteSize > EXPORT_MAX_BYTES && quality > 0.3) {
            quality = Math.max(0.25, Number((quality - 0.1).toFixed(2)));
            dataUrl = offCanvas.toDataURL('image/jpeg', quality);
            byteSize = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);
        }

        if (byteSize > EXPORT_MAX_BYTES) {
            const scale = Math.sqrt((140 * 1024) / byteSize);
            offCanvas.width = Math.max(320, Math.round(targetW * scale));
            offCanvas.height = Math.max(240, Math.round(targetH * scale));
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, offCanvas.width, offCanvas.height);
            ctx.drawImage(source, 0, 0, offCanvas.width, offCanvas.height);
            dataUrl = offCanvas.toDataURL('image/jpeg', 0.65);
            byteSize = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);
        }

        // 釋放暫存 Canvas 記憶體
        offCanvas.width = 0;
        offCanvas.height = 0;

        return { dataUrl, kb: Math.max(1, Math.round(byteSize / 1024)) };
    }

    // 使用 ObjectURL 讀取並壓縮選取的照片，結束後立即 revokeObjectURL 避免記憶體累積
    function loadAndCompressImageFile(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject(new Error('未選取圖片'));
                return;
            }
            const objUrl = URL.createObjectURL(file);
            trackedObjectUrls.add(objUrl);

            const cleanupUrl = () => {
                try { URL.revokeObjectURL(objUrl); } catch (e) {}
                trackedObjectUrls.delete(objUrl);
            };

            const img = new Image();
            img.onload = () => {
                try {
                    const res = compressSourceToJpegDataUrl(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
                    cleanupUrl();
                    resolve(res);
                } catch (err) {
                    cleanupUrl();
                    reject(err);
                }
            };
            img.onerror = async () => {
                cleanupUrl();
                if (typeof window.createImageBitmap === 'function') {
                    try {
                        const bitmap = await window.createImageBitmap(file);
                        const res = compressSourceToJpegDataUrl(bitmap, bitmap.width, bitmap.height);
                        if (typeof bitmap.close === 'function') bitmap.close();
                        resolve(res);
                        return;
                    } catch (e) {}
                }
                reject(new Error('無法解析此照片格式'));
            };
            img.src = objUrl;
        });
    }

    // ==========================================
    // 1. 相片標記編輯器（<canvas>：三色畫筆、粗細、Aa 可拖移文字框、>=10步復原、還原原圖）
    // ==========================================
    function ensurePhotoEditorModalDOM() {
        if (photoEditorModalEl) return;

        const modal = document.createElement('div');
        modal.id = 'cautionPhotoAnnotatorModal';
        modal.className = 'hidden fixed inset-0 bg-black/90 z-[100008] flex flex-col justify-between p-3 sm:p-4 pointer-events-auto select-none';
        modal.innerHTML = `
            <!-- 頂部工具列：復原 / 還原原圖 / 取消 / 完成並套用 -->
            <div class="flex items-center justify-between gap-2 pb-2 border-b border-white/15 flex-shrink-0">
                <div class="flex items-center gap-1.5">
                    <button type="button" id="btnPhotoAnnotUndo" class="bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 font-extrabold px-2.5 py-2 rounded-xl text-xs active:scale-95 disabled:opacity-40 flex items-center gap-1" disabled>
                        <span>↩️ 復原</span>
                    </button>
                    <button type="button" id="btnPhotoAnnotReset" class="bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-600 font-extrabold px-2.5 py-2 rounded-xl text-xs active:scale-95 flex items-center gap-1">
                        <span>🔄 還原原圖</span>
                    </button>
                </div>
                <div class="flex items-center gap-1.5">
                    <button type="button" id="btnPhotoAnnotCancel" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-extrabold px-3 py-2 rounded-xl text-xs active:scale-95">
                        取消
                    </button>
                    <button type="button" id="btnPhotoAnnotApply" class="bg-emerald-600 hover:bg-emerald-500 text-white font-black px-3 py-2 rounded-xl text-xs shadow-lg active:scale-95 flex items-center gap-1">
                        <span>✅ 完成並套用</span>
                    </button>
                </div>
            </div>

            <!-- 中央畫布區 -->
            <div class="flex-1 min-h-0 flex items-center justify-center py-2 overflow-hidden">
                <canvas id="cautionPhotoAnnotCanvas" class="max-w-full max-h-full rounded-xl shadow-2xl border border-white/20 touch-none bg-black"></canvas>
            </div>

            <!-- 底部工具區：畫筆 / Aa 文字 ＋ 三色 ＋ 粗細 -->
            <div class="pt-2 border-t border-white/15 flex flex-col gap-2 flex-shrink-0">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-1.5">
                        <button type="button" id="btnPhotoToolBrush" class="bg-amber-500 text-white font-black px-3 py-1.5 rounded-xl text-xs active:scale-95">✏️ 畫筆</button>
                        <button type="button" id="btnPhotoToolText" class="bg-slate-800 text-slate-200 border border-slate-600 font-black px-3 py-1.5 rounded-xl text-xs active:scale-95">Aa 加文字</button>
                    </div>
                    <div id="photoAnnotColorGroup" class="flex items-center gap-2"></div>
                    <div id="photoAnnotSizeGroup" class="flex items-center gap-1.5"></div>
                </div>
                <div id="photoAnnotHint" class="text-[11px] font-bold text-slate-300 text-center">
                    ✏️ 單指塗鴉標記重點；點「Aa 加文字」可新增文字並按住拖移位置
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        photoEditorModalEl = modal;
        editorCanvas = modal.querySelector('#cautionPhotoAnnotCanvas');
        editorCtx = editorCanvas ? editorCanvas.getContext('2d') : null;

        // 建立三色按鈕
        const colorGroup = modal.querySelector('#photoAnnotColorGroup');
        BRUSH_COLORS.forEach(c => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.color = c.hex;
            btn.title = `${c.label}色`;
            btn.className = 'w-7 h-7 rounded-full border-2 shadow active:scale-90 transition-transform';
            btn.style.backgroundColor = c.hex;
            btn.addEventListener('click', () => {
                editorBrushColor = c.hex;
                editorTool = 'brush';
                syncPhotoEditorToolbarUI();
            });
            colorGroup?.appendChild(btn);
        });

        // 建立粗細按鈕
        const sizeGroup = modal.querySelector('#photoAnnotSizeGroup');
        BRUSH_SIZES.forEach(s => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.width = String(s.width);
            btn.textContent = s.label;
            btn.className = 'px-2.5 py-1 rounded-lg text-[11px] font-black border active:scale-95';
            btn.addEventListener('click', () => {
                editorBrushWidth = s.width;
                syncPhotoEditorToolbarUI();
            });
            sizeGroup?.appendChild(btn);
        });

        modal.querySelector('#btnPhotoToolBrush')?.addEventListener('click', () => {
            editorTool = 'brush';
            syncPhotoEditorToolbarUI();
        });

        modal.querySelector('#btnPhotoToolText')?.addEventListener('click', () => {
            const textVal = prompt('請輸入要標註在照片上的文字（例如：電線過低、窄巷注意）：', '');
            if (textVal && textVal.trim()) {
                pushEditorUndoSnapshot();
                editorTexts.push({
                    text: textVal.trim(),
                    x: Math.round(editorLogicalW * 0.5),
                    y: Math.round(editorLogicalH * 0.5),
                    color: editorBrushColor
                });
                editorTool = 'text';
                syncPhotoEditorToolbarUI();
                redrawEditorCanvas();
            }
        });

        modal.querySelector('#btnPhotoAnnotUndo')?.addEventListener('click', () => {
            if (editorUndoStack.length === 0) return;
            const snap = editorUndoStack.pop();
            editorStrokes = snap.strokes;
            editorTexts = snap.texts;
            syncPhotoEditorToolbarUI();
            redrawEditorCanvas();
        });

        modal.querySelector('#btnPhotoAnnotReset')?.addEventListener('click', () => {
            if (editorStrokes.length === 0 && editorTexts.length === 0) return;
            pushEditorUndoSnapshot();
            editorStrokes = [];
            editorTexts = [];
            syncPhotoEditorToolbarUI();
            redrawEditorCanvas();
        });

        modal.querySelector('#btnPhotoAnnotCancel')?.addEventListener('click', () => {
            closePhotoAnnotatorModal();
        });

        modal.querySelector('#btnPhotoAnnotApply')?.addEventListener('click', () => {
            applyAnnotatedPhotoAndClose();
        });

        bindPhotoCanvasPointerEvents();
    }

    function pushEditorUndoSnapshot() {
        editorUndoStack.push({
            strokes: JSON.parse(JSON.stringify(editorStrokes)),
            texts: JSON.parse(JSON.stringify(editorTexts))
        });
        if (editorUndoStack.length > MAX_UNDO_STEPS) {
            editorUndoStack.shift();
        }
        syncPhotoEditorToolbarUI();
    }

    function syncPhotoEditorToolbarUI() {
        if (!photoEditorModalEl) return;
        const undoBtn = photoEditorModalEl.querySelector('#btnPhotoAnnotUndo');
        if (undoBtn) {
            undoBtn.disabled = (editorUndoStack.length === 0);
            undoBtn.innerHTML = editorUndoStack.length > 0
                ? `<span>↩️ 復原 (${editorUndoStack.length})</span>`
                : '<span>↩️ 復原</span>';
        }

        const brushBtn = photoEditorModalEl.querySelector('#btnPhotoToolBrush');
        const textBtn = photoEditorModalEl.querySelector('#btnPhotoToolText');
        if (brushBtn && textBtn) {
            brushBtn.className = (editorTool === 'brush')
                ? 'bg-amber-500 text-white font-black px-3 py-1.5 rounded-xl text-xs active:scale-95 shadow'
                : 'bg-slate-800 text-slate-200 border border-slate-600 font-black px-3 py-1.5 rounded-xl text-xs active:scale-95';
            textBtn.className = (editorTool === 'text')
                ? 'bg-blue-600 text-white font-black px-3 py-1.5 rounded-xl text-xs active:scale-95 shadow'
                : 'bg-slate-800 text-slate-200 border border-slate-600 font-black px-3 py-1.5 rounded-xl text-xs active:scale-95';
        }

        photoEditorModalEl.querySelectorAll('#photoAnnotColorGroup button').forEach(btn => {
            const isSel = (btn.dataset.color === editorBrushColor);
            btn.style.borderColor = isSel ? '#38bdf8' : 'rgba(255,255,255,0.45)';
            btn.style.transform = isSel ? 'scale(1.15)' : 'scale(1)';
        });

        photoEditorModalEl.querySelectorAll('#photoAnnotSizeGroup button').forEach(btn => {
            const isSel = (Number(btn.dataset.width) === editorBrushWidth);
            btn.className = isSel
                ? 'px-2.5 py-1 rounded-lg text-[11px] font-black border bg-cyan-600 text-white border-cyan-300 active:scale-95'
                : 'px-2.5 py-1 rounded-lg text-[11px] font-black border bg-slate-800 text-slate-300 border-slate-600 active:scale-95';
        });
    }

    function getCanvasPoint(clientX, clientY) {
        if (!editorCanvas) return { x: 0, y: 0 };
        const rect = editorCanvas.getBoundingClientRect();
        const scaleX = editorLogicalW / Math.max(1, rect.width);
        const scaleY = editorLogicalH / Math.max(1, rect.height);
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function hitTestTextLabel(pt) {
        if (!editorCtx) return -1;
        const fontSize = Math.max(20, Math.round(editorLogicalW * 0.045));
        editorCtx.font = `900 ${fontSize}px sans-serif`;
        for (let i = editorTexts.length - 1; i >= 0; i--) {
            const t = editorTexts[i];
            const tw = editorCtx.measureText(t.text).width + 24;
            const th = fontSize + 18;
            if (Math.abs(pt.x - t.x) <= tw / 2 && Math.abs(pt.y - t.y) <= th / 2) {
                return i;
            }
        }
        return -1;
    }

    function redrawEditorCanvas() {
        if (!editorCtx || !editorCanvas || !editorBaseImg) return;
        editorCtx.clearRect(0, 0, editorLogicalW, editorLogicalH);
        editorCtx.drawImage(editorBaseImg, 0, 0, editorLogicalW, editorLogicalH);

        // 1. 繪製所有筆畫
        const drawSingleStroke = (st) => {
            if (!st || !Array.isArray(st.points) || st.points.length === 0) return;
            editorCtx.save();
            editorCtx.lineCap = 'round';
            editorCtx.lineJoin = 'round';
            editorCtx.strokeStyle = st.color;
            editorCtx.lineWidth = st.width;
            editorCtx.beginPath();
            editorCtx.moveTo(st.points[0].x, st.points[0].y);
            for (let i = 1; i < st.points.length; i++) {
                editorCtx.lineTo(st.points[i].x, st.points[i].y);
            }
            if (st.points.length === 1) {
                editorCtx.lineTo(st.points[0].x + 0.1, st.points[0].y + 0.1);
            }
            editorCtx.stroke();
            editorCtx.restore();
        };

        editorStrokes.forEach(drawSingleStroke);
        if (activeStroke) drawSingleStroke(activeStroke);

        // 2. 繪製所有 Aa 高對比文字框（深色底框＋描邊，在任何照片背景皆清晰可讀）
        const fontSize = Math.max(20, Math.round(editorLogicalW * 0.045));
        editorTexts.forEach(item => {
            editorCtx.save();
            editorCtx.font = `900 ${fontSize}px sans-serif`;
            editorCtx.textAlign = 'center';
            editorCtx.textBaseline = 'middle';
            const metrics = editorCtx.measureText(item.text);
            const padX = 14;
            const padY = 8;
            const boxW = metrics.width + padX * 2;
            const boxH = fontSize + padY * 2;
            const bx = item.x - boxW / 2;
            const by = item.y - boxH / 2;

            editorCtx.fillStyle = 'rgba(15, 23, 42, 0.82)';
            editorCtx.strokeStyle = item.color || '#FFD60A';
            editorCtx.lineWidth = 3;
            editorCtx.beginPath();
            if (typeof editorCtx.roundRect === 'function') {
                editorCtx.roundRect(bx, by, boxW, boxH, 10);
            } else {
                editorCtx.rect(bx, by, boxW, boxH);
            }
            editorCtx.fill();
            editorCtx.stroke();

            editorCtx.lineWidth = 4;
            editorCtx.strokeStyle = '#000000';
            editorCtx.strokeText(item.text, item.x, item.y);
            editorCtx.fillStyle = item.color || '#FFFFFF';
            editorCtx.fillText(item.text, item.x, item.y);
            editorCtx.restore();
        });
    }

    function bindPhotoCanvasPointerEvents() {
        if (isEditorBound || !editorCanvas) return;
        isEditorBound = true;

        const onStart = (clientX, clientY) => {
            if (!editorBaseImg) return;
            const pt = getCanvasPoint(clientX, clientY);

            // 若手指直接點中既有文字框，直接允許拖移文字位置
            const hitIdx = hitTestTextLabel(pt);
            if (hitIdx !== -1) {
                pushEditorUndoSnapshot();
                draggingTextIdx = hitIdx;
                dragTextOffsetX = pt.x - editorTexts[hitIdx].x;
                dragTextOffsetY = pt.y - editorTexts[hitIdx].y;
                return;
            }

            // 單指畫筆塗鴉
            draggingTextIdx = -1;
            activeStroke = {
                color: editorBrushColor,
                width: Math.max(2, Math.round(editorBrushWidth * (editorLogicalW / 600))),
                points: [pt]
            };
            redrawEditorCanvas();
        };

        const onMove = (clientX, clientY) => {
            if (!editorBaseImg) return;
            const pt = getCanvasPoint(clientX, clientY);
            if (draggingTextIdx !== -1 && editorTexts[draggingTextIdx]) {
                editorTexts[draggingTextIdx].x = Math.max(20, Math.min(editorLogicalW - 20, pt.x - dragTextOffsetX));
                editorTexts[draggingTextIdx].y = Math.max(20, Math.min(editorLogicalH - 20, pt.y - dragTextOffsetY));
                redrawEditorCanvas();
                return;
            }
            if (activeStroke) {
                activeStroke.points.push(pt);
                redrawEditorCanvas();
            }
        };

        const onEnd = () => {
            if (draggingTextIdx !== -1) {
                draggingTextIdx = -1;
                redrawEditorCanvas();
                return;
            }
            if (activeStroke) {
                pushEditorUndoSnapshot();
                editorStrokes.push(activeStroke);
                activeStroke = null;
                redrawEditorCanvas();
            }
        };

        editorCanvas.addEventListener('touchstart', (e) => {
            if (!e.touches || e.touches.length !== 1) return;
            if (e.cancelable) e.preventDefault();
            onStart(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: false });

        editorCanvas.addEventListener('touchmove', (e) => {
            if (!e.touches || e.touches.length !== 1) return;
            if (e.cancelable) e.preventDefault();
            onMove(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: false });

        editorCanvas.addEventListener('touchend', () => onEnd(), { passive: true });
        editorCanvas.addEventListener('touchcancel', () => {
            activeStroke = null;
            draggingTextIdx = -1;
            redrawEditorCanvas();
        }, { passive: true });

        editorCanvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            onStart(e.clientX, e.clientY);
        });
        window.addEventListener('mousemove', (e) => {
            if (!photoEditorModalEl || photoEditorModalEl.classList.contains('hidden')) return;
            if (draggingTextIdx !== -1 || activeStroke) onMove(e.clientX, e.clientY);
        });
        window.addEventListener('mouseup', () => {
            if (!photoEditorModalEl || photoEditorModalEl.classList.contains('hidden')) return;
            if (draggingTextIdx !== -1 || activeStroke) onEnd();
        });
    }

    function openPhotoAnnotatorModal(sourceDataUrl) {
        const imgSrc = originalUnannotatedPhotoUrl || sourceDataUrl;
        if (!imgSrc) return;
        ensurePhotoEditorModalDOM();

        const img = new Image();
        img.onload = () => {
            editorBaseImg = img;
            let w = img.naturalWidth || img.width || 800;
            let h = img.naturalHeight || img.height || 600;
            if (w > EXPORT_MAX_WIDTH) {
                h = Math.round(h * (EXPORT_MAX_WIDTH / w));
                w = EXPORT_MAX_WIDTH;
            }
            editorLogicalW = w;
            editorLogicalH = h;
            editorCanvas.width = w;
            editorCanvas.height = h;
            editorStrokes = [];
            editorTexts = [];
            editorUndoStack = [];
            activeStroke = null;
            draggingTextIdx = -1;
            editorTool = 'brush';

            syncPhotoEditorToolbarUI();
            redrawEditorCanvas();
            photoEditorModalEl.classList.remove('hidden');
        };
        img.src = imgSrc;
    }

    function closePhotoAnnotatorModal() {
        if (photoEditorModalEl) {
            photoEditorModalEl.classList.add('hidden');
        }
        // 釋放 Canvas 記憶體與圖片參考
        if (editorCanvas) {
            editorCanvas.width = 0;
            editorCanvas.height = 0;
        }
        editorBaseImg = null;
        editorStrokes = [];
        editorTexts = [];
        editorUndoStack = [];
        activeStroke = null;
        draggingTextIdx = -1;
    }

    function applyAnnotatedPhotoAndClose() {
        if (!editorCanvas || !editorBaseImg) {
            closePhotoAnnotatorModal();
            return;
        }
        redrawEditorCanvas();
        const { dataUrl, kb } = compressSourceToJpegDataUrl(editorCanvas, editorLogicalW, editorLogicalH);
        closePhotoAnnotatorModal();
        setFormPhotoPreview(dataUrl, `✅ 標記相片已合成壓縮（${kb} KB ≤ 150 KB）`, false);
    }

    // ==========================================
    // 2. 共用「黃色提醒表單」元件（雙入口共用同一套 DOM 與流程）
    // ==========================================
    function ensureSharedFormEnhancements() {
        const modal = document.getElementById('editAlertModal');
        if (!modal || modal.dataset.cautionEnhanced === '1') return;
        modal.dataset.cautionEnhanced = '1';

        const noteInput = document.getElementById('editAlertNoteInput');
        const noteContainer = noteInput?.parentElement;

        // 1. 注入 5 大常用快選標籤（點擊自動帶入文字框）
        if (noteContainer && !document.getElementById('cautionQuickTagsWrap')) {
            const tagsWrap = document.createElement('div');
            tagsWrap.id = 'cautionQuickTagsWrap';
            tagsWrap.className = 'flex flex-wrap gap-1.5 mt-1';
            QUICK_TAGS.forEach(tag => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.textContent = tag;
                chip.className = 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-[11px] font-extrabold px-2.5 py-1 rounded-full active:scale-95 transition-all';
                chip.addEventListener('click', () => {
                    if (!noteInput) return;
                    const cur = noteInput.value.trim();
                    if (!cur || cur === '注意路段') {
                        noteInput.value = tag;
                    } else if (!cur.includes(tag)) {
                        noteInput.value = `${cur}、${tag}`;
                    }
                    if (typeof activeFormSession?.onNoteChange === 'function') {
                        try { activeFormSession.onNoteChange(noteInput.value); } catch (e) {}
                    }
                    try { if (typeof vibrate === 'function') vibrate(15); } catch (e) {}
                });
                tagsWrap.appendChild(chip);
            });
            noteContainer.appendChild(tagsWrap);
        }

        if (noteInput && noteInput.dataset.livePreviewBound !== '1') {
            noteInput.dataset.livePreviewBound = '1';
            noteInput.addEventListener('input', () => {
                if (typeof activeFormSession?.onNoteChange === 'function') {
                    try { activeFormSession.onNoteChange(noteInput.value); } catch (e) {}
                }
            });
        }

        // 2. 在照片預覽區注入「✏️ 標記照片」按鈕（緊鄰「❌ 移除照片」）
        const previewWrap = document.getElementById('alertPhotoPreviewWrap');
        const removeBtn = document.getElementById('btnRemoveAlertPhoto');
        if (previewWrap && removeBtn && !document.getElementById('btnAnnotateAlertPhoto')) {
            const actionsRow = document.createElement('div');
            actionsRow.className = 'grid grid-cols-2 gap-2 w-full';

            const annotateBtn = document.createElement('button');
            annotateBtn.type = 'button';
            annotateBtn.id = 'btnAnnotateAlertPhoto';
            annotateBtn.className = 'bg-amber-500 hover:bg-amber-600 text-white font-black py-2 rounded-xl text-xs shadow-sm flex items-center justify-center gap-1 active:scale-95 transition-all';
            annotateBtn.innerHTML = '<span>✏️ 標記照片</span>';
            annotateBtn.addEventListener('click', () => {
                if (currentPhotoDataUrl) {
                    openPhotoAnnotatorModal(currentPhotoDataUrl);
                }
            });

            removeBtn.parentNode.insertBefore(actionsRow, removeBtn);
            actionsRow.appendChild(annotateBtn);
            actionsRow.appendChild(removeBtn);
        }

        // 3. 統一照片選取（使用 ObjectURL + 立即釋放記憶體，避免中斷背景 GPS）
        const camInput = document.getElementById('alertCameraInput');
        const galInput = document.getElementById('alertGalleryInput');
        const onPhotoPicked = async (e) => {
            const inputEl = e.target;
            const file = inputEl.files && inputEl.files[0];
            inputEl.value = '';
            if (!file) return;

            const statusEl = document.getElementById('alertPhotoStatus');
            if (statusEl) {
                statusEl.textContent = '⏳ 正在壓縮處理照片...';
                statusEl.classList.remove('hidden');
            }
            try {
                const { dataUrl, kb } = await loadAndCompressImageFile(file);
                setFormPhotoPreview(dataUrl, `✅ 照片已壓縮完成（${kb} KB ≤ 150 KB），可點「✏️ 標記照片」塗鴉`, true);
            } catch (err) {
                alert('⚠️ 無法解析此照片格式，建議改用「📷 現場拍照」或一般 JPG/PNG 照片！');
                setFormPhotoPreview(currentPhotoDataUrl, '', false);
            }
        };

        if (camInput) camInput.onchange = onPhotoPicked;
        if (galInput) galInput.onchange = onPhotoPicked;

        if (removeBtn) {
            removeBtn.onclick = () => {
                if (camInput) camInput.value = '';
                if (galInput) galInput.value = '';
                originalUnannotatedPhotoUrl = '';
                setFormPhotoPreview('', '', true);
            };
        }

        const previewImg = document.getElementById('alertPhotoPreviewImg');
        if (previewImg) {
            previewImg.onclick = () => {
                if (currentPhotoDataUrl && typeof window.openPhotoLightbox === 'function') {
                    window.openPhotoLightbox(currentPhotoDataUrl);
                }
            };
        }
    }

    function setFormPhotoPreview(dataUrl, statusText = '', updateOriginal = false) {
        currentPhotoDataUrl = dataUrl || '';
        if (updateOriginal) {
            originalUnannotatedPhotoUrl = currentPhotoDataUrl;
        }
        // 向下相容 route-editor.js 既有全域變數
        if (typeof currentAlertPhotoBase64 !== 'undefined') {
            try { currentAlertPhotoBase64 = currentPhotoDataUrl; } catch (e) {}
        }

        const previewImg = document.getElementById('alertPhotoPreviewImg');
        const previewWrap = document.getElementById('alertPhotoPreviewWrap');
        const statusEl = document.getElementById('alertPhotoStatus');

        if (currentPhotoDataUrl) {
            if (previewImg) previewImg.src = currentPhotoDataUrl;
            previewWrap?.classList.remove('hidden');
            if (statusEl) {
                if (statusText) {
                    statusEl.textContent = statusText;
                } else {
                    const kb = Math.max(1, Math.round((currentPhotoDataUrl.length * 0.75) / 1024));
                    statusEl.textContent = `✅ 已附加實景照片（約 ${kb} KB）`;
                }
                statusEl.classList.remove('hidden');
            }
        } else {
            if (previewImg) previewImg.src = '';
            previewWrap?.classList.add('hidden');
            if (statusEl) {
                statusEl.textContent = '';
                statusEl.classList.add('hidden');
            }
        }
    }

    function closeCautionFormModal() {
        closePhotoAnnotatorModal();
        revokeAllTrackedObjectUrls();
        document.getElementById('editAlertModal')?.classList.add('hidden');
        activeFormSession = null;
    }

    function openCautionForm(options) {
        ensureSharedFormEnhancements();
        const modal = document.getElementById('editAlertModal');
        const titleEl = document.getElementById('editAlertModalTitle');
        const noteInput = document.getElementById('editAlertNoteInput');
        const saveBtn = document.getElementById('btnSaveAlertEdit');
        const delBtn = document.getElementById('btnDeleteAlert');
        const cancelBtn = document.getElementById('btnCancelAlertEdit');
        if (!modal || !noteInput || !saveBtn) return;

        activeFormSession = options || {};

        if (titleEl) {
            titleEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${options?.title || '設定黃色提醒事項'}`;
        }
        const lockedBadgeEl = document.getElementById('editAlertLockedBadge');
        if (lockedBadgeEl) {
            if (options?.lockedBadgeText) {
                lockedBadgeEl.textContent = options.lockedBadgeText;
                lockedBadgeEl.classList.remove('hidden');
            } else if (Array.isArray(options?.lockedCoord) && options.lockedCoord.length >= 2) {
                lockedBadgeEl.textContent = '🎯 已鎖定上方地圖閃爍準星位置';
                lockedBadgeEl.classList.remove('hidden');
            } else {
                lockedBadgeEl.classList.add('hidden');
            }
        }
        noteInput.value = options?.initialNote !== undefined ? String(options.initialNote) : '';
        const camInput = document.getElementById('alertCameraInput');
        const galInput = document.getElementById('alertGalleryInput');
        if (camInput) camInput.value = '';
        if (galInput) galInput.value = '';

        setFormPhotoPreview(options?.initialPhoto || '', '', true);

        if (delBtn) {
            if (typeof options?.onDelete === 'function') {
                delBtn.classList.remove('hidden');
                delBtn.onclick = () => {
                    const shouldClose = options.onDelete();
                    if (shouldClose !== false) closeCautionFormModal();
                };
            } else {
                delBtn.classList.add('hidden');
                delBtn.onclick = null;
            }
        }

        saveBtn.onclick = () => {
            const note = noteInput.value.trim();
            if (!note) {
                alert('請輸入提醒內容或點選上方快選標籤！');
                return;
            }
            const payload = {
                note,
                photo: currentPhotoDataUrl || '',
                lockedCoord: options?.lockedCoord || null,
                lockedTime: options?.lockedTime || Date.now()
            };
            const onSave = options?.onSave;
            closeCautionFormModal();
            if (typeof onSave === 'function') onSave(payload);
        };

        if (cancelBtn) {
            cancelBtn.onclick = () => {
                const onCancel = options?.onCancel;
                closeCautionFormModal();
                if (typeof onCancel === 'function') onCancel();
            };
        }

        modal.classList.remove('hidden');
    }

    window.CautionEditor = {
        openForm: openCautionForm,
        closeForm: closeCautionFormModal,
        openPhotoAnnotator: openPhotoAnnotatorModal,
        QUICK_TAGS
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureSharedFormEnhancements);
    } else {
        ensureSharedFormEnhancements();
    }
})();
