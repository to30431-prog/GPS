// ==========================================
// [Module 13] src/fleet-radio-ptt.js
// 獨立模組：內建網路無線電（車隊短語音 PTT 對講）
// 封裝麥克風壓縮錄音（最長 8 秒）、Firebase 即時廣播收發、音訊自動播放解鎖、Wake Lock 防休眠與僅限地圖主畫面半透明懸浮按鈕
// ==========================================

(function initFleetRadioPTTModule() {
    const STORAGE_KEY_ENABLED = 'yingge_fleet_radio_ptt_enabled_v1';
    const MAX_RECORD_MS = 8000;          // 最長 8 秒自動截斷
    const MIN_RECORD_MS = 350;           // 短於 0.35 秒視為誤觸不發送
    const MAX_PLAYBACK_AGE_MS = 20000;   // 嚴格僅自動播放 20 秒內的最新語音
    const POLL_INTERVAL_MS = 1500;       // 輕量 meta.json 輪詢間隔（支援極致省電黑屏持續接收）
    const MAX_AUDIO_DATAURL_LEN = 350000;

    // 狀態變數（完全封裝於獨立模組）
    let isRadioEnabled = true;
    try {
        if (localStorage.getItem(STORAGE_KEY_ENABLED) === 'false') {
            isRadioEnabled = false;
        }
    } catch (e) {}

    let isRecordingPtt = false;
    let isUploadingPtt = false;
    let activeMediaRecorder = null;
    let activeMediaStream = null;
    let recordedChunks = [];
    let recordStartAt = 0;
    let recordTickTimer = null;
    let recordMaxTimer = null;
    let activePointerId = null;
    let cancelUploadFlag = false;

    let pollTimer = null;
    let isPollingMeta = false;
    let lastHandledMsgId = '';
    let playbackQueue = [];
    let isPlayingAudio = false;
    let sharedAudioEl = null;
    let unlockAudioCtx = null;
    let isAudioUnlocked = false;
    let radioWakeLock = null;

    let pttBtnEl = null;
    let pttIconEl = null;
    let pttLabelEl = null;
    let toastEl = null;
    let visibilityObserver = null;
    let visibilitySyncTimer = null;

    function getRadioCloudBaseUrl() {
        const base = (typeof FIREBASE_BASE_URL === 'string' && FIREBASE_BASE_URL)
            ? FIREBASE_BASE_URL
            : 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app';
        return `${base}/system_config/fleet_radio`;
    }

    function getCurrentDeviceId() {
        if (typeof fleetDeviceId === 'string' && fleetDeviceId) return fleetDeviceId;
        return localStorage.getItem('deviceId') || localStorage.getItem('fleet_device_id') || 'unknown_dev';
    }

    function getCurrentSenderName() {
        if (typeof fleetUserName === 'string' && fleetUserName.trim()) return fleetUserName.trim();
        const stored = (localStorage.getItem('fleet_user_name') || '').trim();
        return stored || '車隊隊員';
    }

    function isRestrictedByGate() {
        return typeof isDeviceRestrictedByGatekeeper === 'function' && isDeviceRestrictedByGatekeeper();
    }

    // 判斷目前是否處於「地圖主畫面」（巡航、導航、預覽、手繪、家具模式皆允許；進入全螢幕列表或彈窗時自動隱藏）
    function isOnMapMainScreen() {
        if (isRestrictedByGate()) return false;
        const blockingModalIds = [
            'historyModal',
            'cloudRoutesModal',
            'adminSettingsModal',
            'adminPasswordModal',
            'mapLayerMenuPanel',
            'settingsModal',
            'aiDispatchModal',
            'fleetUserNameModal',
            'welcomeProfileModal',
            'longPressPinTypeModal',
            'createMapPinModal',
            'createBuildingPinModal',
            'viewMapPinModal',
            'speedCameraEditorModal',
            'uploadConflictModal',
            'manualClearConfirmModal',
            'deviceAccessGateOverlay',
            'blackScreenOverlay',
            'photoLightboxModal'
        ];
        for (let i = 0; i < blockingModalIds.length; i++) {
            const el = document.getElementById(blockingModalIds[i]);
            if (el && !el.classList.contains('hidden')) {
                return false;
            }
        }
        return true;
    }

    // 🔓 瀏覽器音訊自動播放解鎖（於首次使用者互動時預熱 AudioContext 與共用 Audio 元素）
    function unlockBrowserAudio() {
        if (!sharedAudioEl) {
            sharedAudioEl = new Audio();
            sharedAudioEl.setAttribute('playsinline', '');
            sharedAudioEl.setAttribute('webkit-playsinline', '');
            sharedAudioEl.preload = 'auto';
        }
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                if (!unlockAudioCtx) unlockAudioCtx = new AudioCtx();
                if (unlockAudioCtx.state === 'suspended') {
                    unlockAudioCtx.resume().catch(() => {});
                }
            }
        } catch (e) {}
        if (!isAudioUnlocked && sharedAudioEl) {
            try {
                // 極短無聲 WAV 解鎖 iOS/Android 自動播放權限
                sharedAudioEl.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
                sharedAudioEl.volume = 0.01;
                const p = sharedAudioEl.play();
                if (p && typeof p.then === 'function') {
                    p.then(() => {
                        sharedAudioEl.pause();
                        sharedAudioEl.currentTime = 0;
                        sharedAudioEl.volume = 1.0;
                        isAudioUnlocked = true;
                    }).catch(() => {});
                }
            } catch (e) {}
        }
    }

    ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(evtName => {
        window.addEventListener(evtName, function onInteractUnlock() {
            unlockBrowserAudio();
            if (isAudioUnlocked) {
                window.removeEventListener(evtName, onInteractUnlock);
            }
        }, { passive: true });
    });

    // 🛡️ 螢幕防休眠（Wake Lock）：於無線電開啟且錄音／播放期間維持喚醒
    async function requestRadioWakeLock() {
        if (!('wakeLock' in navigator) || !isRadioEnabled) return;
        if (document.visibilityState !== 'visible') return;
        if (radioWakeLock && !radioWakeLock.released) return;
        try {
            radioWakeLock = await navigator.wakeLock.request('screen');
            radioWakeLock.addEventListener('release', () => {
                radioWakeLock = null;
            });
        } catch (e) {}
    }

    function releaseRadioWakeLock() {
        if (radioWakeLock) {
            try { radioWakeLock.release(); } catch (e) {}
            radioWakeLock = null;
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isRadioEnabled) {
            if (isRecordingPtt || isPlayingAudio) {
                requestRadioWakeLock();
            }
            pollLatestRadioMeta();
        }
    });

    // 🎙️ 挑選瀏覽器支援的最佳低流量壓縮音訊格式
    function pickSupportedAudioMimeType() {
        if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
            return '';
        }
        const candidates = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4;codecs=mp4a.40.2',
            'audio/mp4',
            'audio/ogg;codecs=opus'
        ];
        for (let i = 0; i < candidates.length; i++) {
            if (MediaRecorder.isTypeSupported(candidates[i])) {
                return candidates[i];
            }
        }
        return '';
    }

    // 🔊 畫面頂部簡短發話播放提示條（高層級 z-index，極致省電黑屏模式下亦清晰可見）
    function showRadioToast(message, tone = 'playing') {
        if (!toastEl) return;
        toastEl.textContent = message;
        if (tone === 'error') {
            toastEl.style.background = 'rgba(220, 38, 38, 0.94)';
            toastEl.style.borderColor = 'rgba(254, 202, 202, 0.9)';
        } else if (tone === 'sent') {
            toastEl.style.background = 'rgba(5, 150, 105, 0.94)';
            toastEl.style.borderColor = 'rgba(167, 243, 208, 0.9)';
        } else {
            toastEl.style.background = 'rgba(15, 23, 42, 0.94)';
            toastEl.style.borderColor = 'rgba(56, 189, 248, 0.9)';
        }
        toastEl.classList.remove('hidden');
    }

    function hideRadioToast() {
        if (toastEl) {
            toastEl.classList.add('hidden');
        }
    }

    function flashRadioToast(message, tone = 'sent', durationMs = 1800) {
        showRadioToast(message, tone);
        setTimeout(() => {
            if (!isPlayingAudio) hideRadioToast();
        }, durationMs);
    }

    // 🎨 更新懸浮 PTT 按鈕視覺狀態（平時半透明，按住錄音 100% 不透明亮紅高亮＋即時秒數）
    function updatePttButtonVisual(state = 'idle', secText = '') {
        if (!pttBtnEl || !pttIconEl || !pttLabelEl) return;
        if (state === 'recording') {
            pttBtnEl.style.opacity = '1';
            pttBtnEl.style.background = '#dc2626';
            pttBtnEl.style.borderColor = '#ffffff';
            pttBtnEl.style.boxShadow = '0 0 0 6px rgba(239, 68, 68, 0.38), 0 10px 24px rgba(220, 38, 38, 0.5)';
            pttBtnEl.style.transform = 'scale(1.08)';
            pttIconEl.textContent = '🔴';
            pttLabelEl.textContent = secText || '0.0s';
        } else if (state === 'uploading') {
            pttBtnEl.style.opacity = '0.95';
            pttBtnEl.style.background = '#d97706';
            pttBtnEl.style.borderColor = '#fef3c7';
            pttBtnEl.style.boxShadow = '0 8px 18px rgba(217, 119, 6, 0.4)';
            pttBtnEl.style.transform = 'scale(1)';
            pttIconEl.textContent = '📡';
            pttLabelEl.textContent = '傳送中';
        } else {
            pttBtnEl.style.opacity = '0.58';
            pttBtnEl.style.background = 'rgba(15, 23, 42, 0.78)';
            pttBtnEl.style.borderColor = 'rgba(255, 255, 255, 0.85)';
            pttBtnEl.style.boxShadow = '0 6px 16px rgba(15, 23, 42, 0.28)';
            pttBtnEl.style.transform = 'scale(1)';
            pttIconEl.textContent = '🎙️';
            pttLabelEl.textContent = '對講';
        }
    }

    function syncPttButtonVisibility() {
        if (!pttBtnEl) return;
        const shouldShow = isRadioEnabled && isOnMapMainScreen();
        pttBtnEl.classList.toggle('hidden', !shouldShow);
        if (!shouldShow && isRecordingPtt) {
            stopPttRecording(false);
        }
    }

    function cleanupMediaResources() {
        if (recordTickTimer) {
            clearInterval(recordTickTimer);
            recordTickTimer = null;
        }
        if (recordMaxTimer) {
            clearTimeout(recordMaxTimer);
            recordMaxTimer = null;
        }
        if (activeMediaStream) {
            try {
                activeMediaStream.getTracks().forEach(track => track.stop());
            } catch (e) {}
            activeMediaStream = null;
        }
        activeMediaRecorder = null;
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('讀取音訊資料失敗'));
            reader.readAsDataURL(blob);
        });
    }

    // ☁️ 上傳語音廣播至 Firebase（先寫 audio.json 再寫 meta.json，確保接收端讀到 meta 時音訊已就緒）
    async function uploadVoiceBroadcast(blob, durationMs, mimeType) {
        if (!navigator.onLine) {
            flashRadioToast('⚠️ 目前離線，無法發送對講語音', 'error', 2200);
            return;
        }
        isUploadingPtt = true;
        updatePttButtonVisual('uploading');

        try {
            const dataUrl = await blobToDataUrl(blob);
            if (!dataUrl || dataUrl.length > MAX_AUDIO_DATAURL_LEN) {
                throw new Error('音訊檔案過大');
            }
            const now = Date.now();
            const msgId = `ptt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
            const senderId = getCurrentDeviceId();
            const senderName = getCurrentSenderName();

            // 標記本機發送的 ID，避免本機重複播放
            lastHandledMsgId = msgId;

            const audioUrl = `${getRadioCloudBaseUrl()}/audio.json`;
            const metaUrl = `${getRadioCloudBaseUrl()}/meta.json`;

            const putAudioOpts = {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: msgId,
                    dataUrl,
                    mimeType: mimeType || blob.type || 'audio/webm',
                    createdAt: now
                })
            };
            const resAudio = (typeof fetchWithTimeout === 'function')
                ? await fetchWithTimeout(audioUrl, putAudioOpts, 8000)
                : await fetch(audioUrl, putAudioOpts);
            if (!resAudio.ok) throw new Error(`HTTP ${resAudio.status}`);

            const putMetaOpts = {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: msgId,
                    senderId,
                    senderName,
                    durationMs: Math.round(durationMs),
                    mimeType: mimeType || blob.type || 'audio/webm',
                    createdAt: now
                })
            };
            const resMeta = (typeof fetchWithTimeout === 'function')
                ? await fetchWithTimeout(metaUrl, putMetaOpts, 5000)
                : await fetch(metaUrl, putMetaOpts);
            if (!resMeta.ok) throw new Error(`HTTP ${resMeta.status}`);

            flashRadioToast(`📡 已廣播語音（${(durationMs / 1000).toFixed(1)} 秒）`, 'sent', 1600);
        } catch (err) {
            flashRadioToast(`⚠️ 語音傳送失敗：${err?.message || '網路異常'}`, 'error', 2400);
        } finally {
            isUploadingPtt = false;
            updatePttButtonVisual('idle');
            if (!isPlayingAudio) releaseRadioWakeLock();
        }
    }

    // 🎙️ 開始按住錄音
    async function startPttRecording() {
        if (!isRadioEnabled || isRecordingPtt || isUploadingPtt || isRestrictedByGate()) return;
        unlockBrowserAudio();

        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
            flashRadioToast('⚠️ 此裝置瀏覽器不支援麥克風錄音', 'error', 2500);
            return;
        }

        isRecordingPtt = true;
        cancelUploadFlag = false;
        recordedChunks = [];
        recordStartAt = Date.now();
        updatePttButtonVisual('recording', '0.0s');
        try { navigator.vibrate?.(30); } catch (e) {}
        requestRadioWakeLock();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            // 若使用者在取得麥克風權限前就已經放開，立即停止釋放資源
            if (!isRecordingPtt) {
                stream.getTracks().forEach(t => t.stop());
                updatePttButtonVisual('idle');
                return;
            }

            activeMediaStream = stream;
            const mimeType = pickSupportedAudioMimeType();
            const recorderOpts = mimeType
                ? { mimeType, audioBitsPerSecond: 16000 }
                : { audioBitsPerSecond: 16000 };

            const recorder = new MediaRecorder(stream, recorderOpts);
            activeMediaRecorder = recorder;
            recordStartAt = Date.now();

            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    recordedChunks.push(e.data);
                }
            };

            recorder.onstop = () => {
                const durationMs = Date.now() - recordStartAt;
                const finalChunks = recordedChunks.slice();
                const finalMime = recorder.mimeType || mimeType || 'audio/webm';
                const shouldSkip = cancelUploadFlag;

                cleanupMediaResources();
                isRecordingPtt = false;

                if (shouldSkip || durationMs < MIN_RECORD_MS || finalChunks.length === 0) {
                    updatePttButtonVisual('idle');
                    if (!isPlayingAudio) releaseRadioWakeLock();
                    return;
                }

                const audioBlob = new Blob(finalChunks, { type: finalMime });
                uploadVoiceBroadcast(audioBlob, Math.min(durationMs, MAX_RECORD_MS), finalMime);
            };

            recorder.start(200);

            recordTickTimer = setInterval(() => {
                if (!isRecordingPtt) return;
                const sec = Math.min(MAX_RECORD_MS / 1000, (Date.now() - recordStartAt) / 1000);
                updatePttButtonVisual('recording', `${sec.toFixed(1)}s`);
            }, 100);

            // 達最長 8 秒上限自動停止並上傳
            recordMaxTimer = setTimeout(() => {
                if (isRecordingPtt) {
                    stopPttRecording(false);
                }
            }, MAX_RECORD_MS);
        } catch (err) {
            cleanupMediaResources();
            isRecordingPtt = false;
            updatePttButtonVisual('idle');
            releaseRadioWakeLock();
            flashRadioToast('⚠️ 無法開啟麥克風，請允許麥克風權限', 'error', 2600);
        }
    }

    function stopPttRecording(cancelWithoutSending = false) {
        if (!isRecordingPtt) return;
        cancelUploadFlag = Boolean(cancelWithoutSending);
        isRecordingPtt = false;
        activePointerId = null;

        if (activeMediaRecorder && activeMediaRecorder.state !== 'inactive') {
            try {
                activeMediaRecorder.stop();
            } catch (e) {
                cleanupMediaResources();
                updatePttButtonVisual('idle');
            }
        } else {
            cleanupMediaResources();
            updatePttButtonVisual('idle');
        }
    }

    // 🔊 依序自動播放收到的隊員語音
    function processPlaybackQueue() {
        if (isPlayingAudio || playbackQueue.length === 0 || !isRadioEnabled) {
            if (!isPlayingAudio) hideRadioToast();
            return;
        }
        const item = playbackQueue.shift();
        if (!item || !item.dataUrl) {
            processPlaybackQueue();
            return;
        }

        isPlayingAudio = true;
        requestRadioWakeLock();
        showRadioToast(`🔊 正在播放：${item.senderName}`, 'playing');

        if (!sharedAudioEl) {
            sharedAudioEl = new Audio();
            sharedAudioEl.setAttribute('playsinline', '');
            sharedAudioEl.setAttribute('webkit-playsinline', '');
        }

        const finishOne = () => {
            isPlayingAudio = false;
            if (playbackQueue.length === 0) {
                hideRadioToast();
                if (!isRecordingPtt) releaseRadioWakeLock();
            } else {
                processPlaybackQueue();
            }
        };

        sharedAudioEl.onended = finishOne;
        sharedAudioEl.onerror = finishOne;
        sharedAudioEl.volume = 1.0;
        sharedAudioEl.src = item.dataUrl;

        const playPromise = sharedAudioEl.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                // 若瀏覽器尚未解鎖自動播放，靜默結束不卡住佇列
                finishOne();
            });
        }
    }

    // 📡 輪詢 Firebase meta.json（僅 20 秒內且非本機發送之新訊息才拉取 audio.json 播放）
    async function pollLatestRadioMeta(isInitialSeed = false) {
        if (!isRadioEnabled || !navigator.onLine || isPollingMeta || isRestrictedByGate()) return;
        isPollingMeta = true;
        try {
            const metaUrl = `${getRadioCloudBaseUrl()}/meta.json`;
            const res = (typeof fetchWithTimeout === 'function')
                ? await fetchWithTimeout(metaUrl, { cache: 'no-store' }, 4000)
                : await fetch(metaUrl, { cache: 'no-store' });
            if (!res.ok) return;
            const meta = await res.json();
            if (!meta || typeof meta !== 'object' || !meta.id) return;

            const now = Date.now();
            const createdAt = Number(meta.createdAt || 0);
            const ageMs = now - createdAt;

            // 剛開啟 App 或開啟無線電時，若訊息已超過 20 秒或視為歷史舊訊則直接標記已讀不播放
            if (isInitialSeed) {
                if (!createdAt || ageMs > MAX_PLAYBACK_AGE_MS || meta.senderId === getCurrentDeviceId()) {
                    lastHandledMsgId = meta.id;
                    return;
                }
            }

            if (meta.id === lastHandledMsgId) return;
            lastHandledMsgId = meta.id;

            // 排除發送者本機重複播放
            if (meta.senderId && meta.senderId === getCurrentDeviceId()) return;

            // 嚴格時間戳記過濾：僅自動播放 20 秒內送出的最新訊息
            if (!createdAt || ageMs > MAX_PLAYBACK_AGE_MS) return;

            // 拉取對應音訊檔並加入播放佇列
            const audioUrl = `${getRadioCloudBaseUrl()}/audio.json`;
            const audioRes = (typeof fetchWithTimeout === 'function')
                ? await fetchWithTimeout(audioUrl, { cache: 'no-store' }, 6000)
                : await fetch(audioUrl, { cache: 'no-store' });
            if (!audioRes.ok) return;
            const audioPayload = await audioRes.json();
            if (!audioPayload || audioPayload.id !== meta.id || !audioPayload.dataUrl) return;

            // 再次確認下載完後仍未超過過期緩衝
            if ((Date.now() - createdAt) > (MAX_PLAYBACK_AGE_MS + 8000)) return;

            playbackQueue.push({
                id: meta.id,
                senderName: String(meta.senderName || '車隊隊員').trim() || '車隊隊員',
                dataUrl: audioPayload.dataUrl
            });
            processPlaybackQueue();
        } catch (e) {
            // 弱訊號或逾時靜默略過
        } finally {
            isPollingMeta = false;
        }
    }

    function startRadioPolling() {
        stopRadioPolling();
        if (!isRadioEnabled) return;
        pollLatestRadioMeta(true);
        pollTimer = setInterval(() => pollLatestRadioMeta(false), POLL_INTERVAL_MS);
    }

    function stopRadioPolling() {
        if (pollTimer !== null) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        playbackQueue = [];
        if (sharedAudioEl && !sharedAudioEl.paused) {
            try { sharedAudioEl.pause(); } catch (e) {}
        }
        isPlayingAudio = false;
        hideRadioToast();
    }

    function isPointInsideButton(clientX, clientY) {
        if (!pttBtnEl) return false;
        const rect = pttBtnEl.getBoundingClientRect();
        const pad = 12; // 12px 舒適防誤滑容差
        return (
            clientX >= rect.left - pad &&
            clientX <= rect.right + pad &&
            clientY >= rect.top - pad &&
            clientY <= rect.bottom + pad
        );
    }

    // 🧩 建立並掛載獨立 UI（懸浮 56x56 圓角長方形 PTT 按鈕 ＋ 頂部播放提示條）
    function mountFleetRadioUI() {
        if (document.getElementById('fleetRadioPttBtn')) return;

        toastEl = document.createElement('div');
        toastEl.id = 'fleetRadioPlayToast';
        toastEl.className = 'hidden fixed left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-white text-xs font-black shadow-2xl border-2 pointer-events-none whitespace-nowrap transition-all';
        toastEl.style.top = '68px';
        toastEl.style.zIndex = '100006';
        document.body.appendChild(toastEl);

        pttBtnEl = document.createElement('button');
        pttBtnEl.id = 'fleetRadioPttBtn';
        pttBtnEl.type = 'button';
        pttBtnEl.title = '按住說話（最長 8 秒，放開即廣播）';
        pttBtnEl.className = 'fixed flex flex-col items-center justify-center border-2 text-white select-none cursor-pointer pointer-events-auto';
        pttBtnEl.style.width = '56px';
        pttBtnEl.style.height = '56px';
        pttBtnEl.style.borderRadius = '16px';
        pttBtnEl.style.left = '14px';
        pttBtnEl.style.bottom = '188px';
        pttBtnEl.style.zIndex = '45';
        pttBtnEl.style.touchAction = 'none';
        pttBtnEl.style.webkitUserSelect = 'none';
        pttBtnEl.style.webkitTouchCallout = 'none';
        pttBtnEl.style.transition = 'opacity 0.14s ease, background-color 0.14s ease, transform 0.12s ease, box-shadow 0.14s ease';
        pttBtnEl.innerHTML = `
            <span id="fleetRadioPttIcon" class="text-xl leading-none pointer-events-none">🎙️</span>
            <span id="fleetRadioPttLabel" class="text-[10px] font-black leading-none mt-1 pointer-events-none">對講</span>
        `;
        document.body.appendChild(pttBtnEl);

        pttIconEl = pttBtnEl.querySelector('#fleetRadioPttIcon');
        pttLabelEl = pttBtnEl.querySelector('#fleetRadioPttLabel');
        updatePttButtonVisual('idle');

        pttBtnEl.addEventListener('contextmenu', (e) => e.preventDefault());

        // 統一使用 Pointer Events（含觸控滑出按鈕自動停止並上傳）
        pttBtnEl.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
            e.preventDefault();
            e.stopPropagation();
            activePointerId = e.pointerId;
            try { pttBtnEl.setPointerCapture(e.pointerId); } catch (_) {}
            startPttRecording();
        });

        pttBtnEl.addEventListener('pointermove', (e) => {
            if (!isRecordingPtt || (activePointerId !== null && e.pointerId !== activePointerId)) return;
            if (!isPointInsideButton(e.clientX, e.clientY)) {
                stopPttRecording(false);
            }
        });

        const handlePointerRelease = (e) => {
            if (activePointerId !== null && e.pointerId !== activePointerId) return;
            if (isRecordingPtt) {
                stopPttRecording(false);
            }
        };
        pttBtnEl.addEventListener('pointerup', handlePointerRelease);
        pttBtnEl.addEventListener('pointercancel', handlePointerRelease);
        pttBtnEl.addEventListener('lostpointercapture', () => {
            if (isRecordingPtt) stopPttRecording(false);
        });

        // 監聽頁面彈窗狀態變化，自動於地圖主畫面顯示、進入列表／彈窗時隱藏
        visibilityObserver = new MutationObserver(() => syncPttButtonVisibility());
        visibilityObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['class'],
            subtree: true
        });
        visibilitySyncTimer = setInterval(syncPttButtonVisibility, 500);
        syncPttButtonVisibility();
    }

    function setRadioEnabled(enabled) {
        isRadioEnabled = Boolean(enabled);
        try {
            localStorage.setItem(STORAGE_KEY_ENABLED, isRadioEnabled ? 'true' : 'false');
        } catch (e) {}

        if (isRadioEnabled) {
            unlockBrowserAudio();
            startRadioPolling();
        } else {
            if (isRecordingPtt) stopPttRecording(true);
            stopRadioPolling();
            releaseRadioWakeLock();
        }
        syncPttButtonVisibility();
        if (typeof renderMapLayerMenuOptions === 'function') {
            renderMapLayerMenuOptions();
        }
    }

    function toggleRadioEnabled() {
        setRadioEnabled(!isRadioEnabled);
    }

    // 啟動掛載
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            mountFleetRadioUI();
            if (isRadioEnabled) startRadioPolling();
        });
    } else {
        mountFleetRadioUI();
        if (isRadioEnabled) startRadioPolling();
    }

    window.FleetRadioPTT = {
        isEnabled: () => isRadioEnabled,
        setEnabled: setRadioEnabled,
        toggle: toggleRadioEnabled,
        syncVisibility: syncPttButtonVisibility
    };

    if (typeof renderMapLayerMenuOptions === 'function') {
        renderMapLayerMenuOptions();
    }
})();
