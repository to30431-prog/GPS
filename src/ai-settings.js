// ==========================================
// [Module 8/10] src/ai-settings.js
// 開發者模式系統與 AI 參數設定面板（雙模型 gemini-3.6-flash / gemini-4-hydrogen、多組 API Key 與 20 秒 AbortController 連線測試）
// ==========================================

// --- 10.9 開發者模式設定面板表單渲染與雙向同步（含 v3.27 🤖 AI 智慧派工模型切換＋多組 API Key 管理） ---
let selectedAdminAiModel = systemNavConfig.aiDispatchModel || 'gemini-3.6-flash';
let editingAdminAiKeys = normalizeAiApiKeysArray(systemNavConfig.aiApiKeys);
let editingActiveAiKeyId = systemNavConfig.activeAiKeyId || '';

function maskGeminiApiKey(rawKey) {
    const k = String(rawKey || '').trim();
    if (k.length <= 10) {
        return k.slice(0, 3) + '••••' + k.slice(-2);
    }
    return `${k.slice(0, 6)}••••••••${k.slice(-4)}`;
}

function highlightAdminAiModelBtn(activeModel) {
    const modelToSelect = ALLOWED_AI_DISPATCH_MODELS.includes(activeModel)
        ? activeModel
        : 'gemini-3.6-flash';
    selectedAdminAiModel = modelToSelect;

    const btns = document.querySelectorAll('.admin-ai-model-btn');
    btns.forEach(btn => {
        const m = btn.getAttribute('data-ai-model');
        const isSelected = (m === modelToSelect);
        if (isSelected) {
            btn.className = 'admin-ai-model-btn bg-violet-600 text-white border-2 border-violet-600 rounded-xl p-2.5 text-left active:scale-[0.99] transition-all flex items-center justify-between shadow-sm pointer-events-auto cursor-pointer';
            btn.innerHTML = m === 'gemini-4-hydrogen'
                ? `<div><div class="text-xs font-black">gemini-4-hydrogen</div><div class="text-[10px] font-bold opacity-90">進階：強理解力版（複雜派工單深度解析）</div></div><i class="fa-solid fa-circle-check text-sm"></i>`
                : `<div><div class="text-xs font-black">gemini-3.6-flash</div><div class="text-[10px] font-bold opacity-90">預設：極速輕量版（回應最快、省額度）</div></div><i class="fa-solid fa-circle-check text-sm"></i>`;
        } else {
            btn.className = 'admin-ai-model-btn bg-white hover:bg-violet-50 text-gray-800 border-2 border-gray-200 rounded-xl p-2.5 text-left active:scale-[0.99] transition-all flex items-center justify-between pointer-events-auto cursor-pointer';
            btn.innerHTML = m === 'gemini-4-hydrogen'
                ? `<div><div class="text-xs font-black">gemini-4-hydrogen</div><div class="text-[10px] font-bold text-gray-500">進階：強理解力版（複雜派工單深度解析）</div></div><i class="fa-regular fa-circle text-sm text-gray-300"></i>`
                : `<div><div class="text-xs font-black">gemini-3.6-flash</div><div class="text-[10px] font-bold text-gray-500">預設：極速輕量版（回應最快、省額度）</div></div><i class="fa-regular fa-circle text-sm text-gray-300"></i>`;
        }
    });

    const dispatchBadge = document.getElementById('aiDispatchActiveModelBadge');
    if (dispatchBadge) {
        dispatchBadge.textContent = modelToSelect;
    }
}

function getCurrentSelectedAiModel(preferredModel) {
    if (preferredModel && ALLOWED_AI_DISPATCH_MODELS.includes(preferredModel)) {
        return preferredModel;
    }
    if (selectedAdminAiModel && ALLOWED_AI_DISPATCH_MODELS.includes(selectedAdminAiModel)) {
        return selectedAdminAiModel;
    }
    const activeDomBtn = document.querySelector('.admin-ai-model-btn.bg-violet-600');
    const domModel = activeDomBtn?.getAttribute('data-ai-model');
    if (domModel && ALLOWED_AI_DISPATCH_MODELS.includes(domModel)) {
        return domModel;
    }
    if (systemNavConfig?.aiDispatchModel && ALLOWED_AI_DISPATCH_MODELS.includes(systemNavConfig.aiDispatchModel)) {
        return systemNavConfig.aiDispatchModel;
    }
    return 'gemini-3.6-flash';
}

let isTestingGeminiKeyInProgress = false;

function formatGeminiTestErrorMessage(err) {
    if (!err) return '未知連線錯誤，請檢查網路狀態';
    if (typeof err === 'string') {
        if (/aborted without reason|AbortError|timeout|逾時/i.test(err)) {
            return '連線逾時（超過 20 秒），請檢查網路狀態';
        }
        return err;
    }
    const rawMsg = String(err?.message || err || '').trim();
    if (
        err?.isTimeout ||
        err?.name === 'AbortError' ||
        err?.name === 'TimeoutError' ||
        /signal is aborted|aborted without reason|The user aborted a request|The operation was aborted|連線逾時/i.test(rawMsg)
    ) {
        return rawMsg && rawMsg.includes('連線逾時')
            ? rawMsg
            : '連線逾時（超過 20 秒），請檢查網路狀態';
    }
    if (/Failed to fetch|NetworkError|Load failed|網路/i.test(rawMsg)) {
        return `網路連線異常（${rawMsg}），請檢查行動網路或 Wi-Fi 狀態`;
    }
    return rawMsg || '未知錯誤';
}

function setAllAiKeyTestButtonsDisabled(disabled, activeBtn = null) {
    document.querySelectorAll('.admin-ai-key-test-btn, #btnTestNewAiKeyInput').forEach(btn => {
        btn.disabled = disabled;
        if (disabled) {
            btn.classList.add('opacity-60', 'cursor-not-allowed');
        } else {
            btn.classList.remove('opacity-60', 'cursor-not-allowed');
        }
        if (btn === activeBtn && disabled) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 測試中...';
        }
    });
}

function renderAdminAiKeyListUI() {
    const listContainer = document.getElementById('adminAiKeyListContainer');
    const countBadge = document.getElementById('adminAiKeyCountBadge');
    if (countBadge) {
        countBadge.textContent = `${editingAdminAiKeys.length} 組`;
    }
    if (!listContainer) return;

    listContainer.innerHTML = '';

    if (editingAdminAiKeys.length === 0) {
        listContainer.innerHTML = `
            <div class="bg-white/90 border border-violet-200 rounded-xl p-2.5 text-[11px] font-bold text-gray-500 text-center">
                目前尚未新增自訂 API Key（預設使用系統內建金鑰；可點下方按鈕新增多組備援金鑰）
            </div>
        `;
        return;
    }

    if (!editingAdminAiKeys.some(k => k.id === editingActiveAiKeyId)) {
        editingActiveAiKeyId = editingAdminAiKeys[0].id;
    }

    editingAdminAiKeys.forEach((item, idx) => {
        const isActive = (item.id === editingActiveAiKeyId);
        const row = document.createElement('div');
        row.className = isActive
            ? 'bg-violet-100/90 border-2 border-violet-500 rounded-xl p-2.5 flex flex-col gap-2 shadow-sm pointer-events-auto'
            : 'bg-white border border-gray-200 rounded-xl p-2.5 flex flex-col gap-2 pointer-events-auto';

        const topBar = document.createElement('div');
        topBar.className = 'flex items-center justify-between gap-2';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'min-w-0 flex-1 cursor-pointer';
        infoDiv.innerHTML = `
            <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-xs font-black text-gray-900">${item.note || `金鑰 #${idx + 1}`}</span>
                ${isActive
                    ? '<span class="bg-violet-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">✓ 啟用中</span>'
                    : '<span class="bg-gray-100 text-gray-600 text-[10px] font-extrabold px-2 py-0.5 rounded-full">備用</span>'}
            </div>
        `;
        infoDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isTestingGeminiKeyInProgress) return;
            editingActiveAiKeyId = item.id;
            renderAdminAiKeyListUI();
            persistAdminAiSettingsImmediately();
        });

        // 該列專屬 API Key 輸入框（支援直接修改與 .trim() 即時測試連線，不必先按儲存並同步）
        const rowKeyInput = document.createElement('input');
        rowKeyInput.type = 'text';
        rowKeyInput.value = String(item.key || '').trim();
        rowKeyInput.placeholder = '貼上 Gemini API Key (AIzaSy...)';
        rowKeyInput.autocomplete = 'off';
        rowKeyInput.spellcheck = false;
        rowKeyInput.className = 'w-full bg-white/95 border border-violet-200 rounded-lg px-2.5 py-1.5 text-[11px] font-mono font-bold text-gray-800 focus:outline-none focus:border-violet-500 pointer-events-auto';
        ['pointerdown', 'touchstart', 'mousedown', 'click'].forEach(evt => {
            rowKeyInput.addEventListener(evt, (e) => {
                e.stopPropagation();
            }, { passive: true });
        });
        rowKeyInput.addEventListener('input', () => {
            item.key = rowKeyInput.value.trim();
        });
        rowKeyInput.addEventListener('change', () => {
            item.key = rowKeyInput.value.trim();
            persistAdminAiSettingsImmediately();
        });

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'flex items-center gap-1 flex-shrink-0';

        // ⚡ 測試連線按鈕（獨立 AbortController 20秒逾時、鎖定測試中狀態防止連點或重繪中斷）
        const testBtn = document.createElement('button');
        testBtn.type = 'button';
        testBtn.className = 'admin-ai-key-test-btn bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-black px-2 py-1.5 rounded-lg active:scale-95 pointer-events-auto cursor-pointer whitespace-nowrap';
        testBtn.innerHTML = '⚡ 測試連線';
        testBtn.title = '以當前選中模型測試此組 API Key 連線狀態';
        testBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isTestingGeminiKeyInProgress) return;

            const keyLabel = item.note || `金鑰 #${idx + 1}`;
            const liveKey = (rowKeyInput.value || item.key || '').trim();
            item.key = liveKey;
            const liveModel = getCurrentSelectedAiModel();
            const testStatusBox = document.getElementById('adminAiKeyTestStatusBox');

            if (!liveKey) {
                if (testStatusBox) {
                    testStatusBox.className = 'rounded-xl p-2.5 text-[11px] font-extrabold leading-relaxed border bg-amber-50 border-amber-300 text-amber-800';
                    testStatusBox.innerHTML = `⚠️ 「${keyLabel}」尚未填入 API Key，請先貼上金鑰後再測試！`;
                    testStatusBox.classList.remove('hidden');
                }
                rowKeyInput.focus();
                return;
            }

            const origHtml = '⚡ 測試連線';
            isTestingGeminiKeyInProgress = true;
            setAllAiKeyTestButtonsDisabled(true, testBtn);

            if (testStatusBox) {
                testStatusBox.className = 'rounded-xl p-2.5 text-[11px] font-extrabold leading-relaxed border bg-violet-50 border-violet-200 text-violet-800';
                testStatusBox.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> 正在使用模型 <b>${liveModel}</b> 測試「${keyLabel}」純文字輕量連線（逾時上限 20 秒）...`;
                testStatusBox.classList.remove('hidden');
            }

            try {
                const resInfo = await testSingleGeminiApiKey(liveKey, liveModel);
                if (testStatusBox) {
                    testStatusBox.className = 'rounded-xl p-2.5 text-[11px] font-extrabold leading-relaxed border bg-emerald-50 border-emerald-300 text-emerald-800';
                    testStatusBox.innerHTML = `🟢 Gemini 連線成功（模型：${resInfo.testedModel || liveModel}｜實際回應端點：${resInfo.actualEndpointModel || resInfo.testedModel || liveModel}｜Key：${keyLabel}｜耗時 ${resInfo.elapsedSec}s）`;
                    testStatusBox.classList.remove('hidden');
                }
            } catch (err) {
                const detailedMsg = formatGeminiTestErrorMessage(err);
                if (testStatusBox) {
                    testStatusBox.className = 'rounded-xl p-2.5 text-[11px] font-extrabold leading-relaxed border bg-red-50 border-red-300 text-red-700';
                    testStatusBox.innerHTML = `🔴 Gemini 連線失敗（模型：${liveModel}｜Key：${keyLabel}）：${detailedMsg}`;
                    testStatusBox.classList.remove('hidden');
                }
            } finally {
                isTestingGeminiKeyInProgress = false;
                setAllAiKeyTestButtonsDisabled(false);
                testBtn.innerHTML = origHtml;
            }
        });
        actionsDiv.appendChild(testBtn);

        if (!isActive) {
            const useBtn = document.createElement('button');
            useBtn.type = 'button';
            useBtn.className = 'bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-black px-2 py-1.5 rounded-lg active:scale-95 pointer-events-auto cursor-pointer whitespace-nowrap';
            useBtn.textContent = '設為啟用';
            useBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isTestingGeminiKeyInProgress) return;
                editingActiveAiKeyId = item.id;
                renderAdminAiKeyListUI();
                persistAdminAiSettingsImmediately();
            });
            actionsDiv.appendChild(useBtn);
        }

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-[10px] font-black px-2 py-1.5 rounded-lg active:scale-95 pointer-events-auto cursor-pointer';
        delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        delBtn.title = '刪除此組 API Key';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isTestingGeminiKeyInProgress) return;
            editingAdminAiKeys = editingAdminAiKeys.filter(k => k.id !== item.id);
            if (editingActiveAiKeyId === item.id) {
                editingActiveAiKeyId = editingAdminAiKeys[0]?.id || '';
            }
            renderAdminAiKeyListUI();
            persistAdminAiSettingsImmediately();
        });
        actionsDiv.appendChild(delBtn);

        topBar.appendChild(infoDiv);
        topBar.appendChild(actionsDiv);
        row.appendChild(topBar);
        row.appendChild(rowKeyInput);
        listContainer.appendChild(row);
    });
}

async function persistAdminAiSettingsImmediately() {
    systemNavConfig.aiDispatchModel = getCurrentSelectedAiModel(selectedAdminAiModel);
    systemNavConfig.aiApiKeys = normalizeAiApiKeysArray(editingAdminAiKeys);
    systemNavConfig.activeAiKeyId = editingActiveAiKeyId;
    try {
        localStorage.setItem('yingge_system_nav_config_v31', JSON.stringify(systemNavConfig));
    } catch (e) {}
    try {
        await fetchWithTimeout(SYSTEM_CONFIG_URL, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...systemNavConfig,
                updatedAt: Date.now()
            })
        }, 5000);
    } catch (e) {}
}

// 綁定模型選擇器與多組 API Key 新增表單事件（確保 100% 可點擊、可聚焦打字，不被地圖或外層遮罩攔截）
(function setupAdminAiSettingsEvents() {
    const modalEl = document.getElementById('adminSettingsModal');
    if (modalEl) {
        ['pointerdown', 'touchstart', 'mousedown', 'wheel'].forEach(evtName => {
            modalEl.addEventListener(evtName, (e) => {
                e.stopPropagation();
            }, { passive: true });
        });
    }

    // 1. Gemini 模型選擇器卡片點擊切換
    document.querySelectorAll('.admin-ai-model-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const modelName = btn.getAttribute('data-ai-model');
            if (!modelName) return;
            highlightAdminAiModelBtn(modelName);
            vibrate(20);
            persistAdminAiSettingsImmediately();
        });
    });

    // 2. 「+ 新增填入新一組 API Key」展開/收合按鈕
    const toggleBtn = document.getElementById('btnToggleAddAiKeyForm');
    const formWrap = document.getElementById('adminAddAiKeyFormWrap');
    const noteInput = document.getElementById('adminNewAiKeyNoteInput');
    const keyInput = document.getElementById('adminNewAiKeyInput');
    const saveKeyBtn = document.getElementById('btnSaveNewAiKey');
    const testNewKeyBtn = document.getElementById('btnTestNewAiKeyInput');
    const cancelKeyBtn = document.getElementById('btnCancelNewAiKey');

    // 確保輸入框點擊或觸控時明確 stopPropagation 並 focus，絕不被外層攔截
    [noteInput, keyInput, document.getElementById('adminAnnouncementInput')].forEach(inp => {
        if (!inp) return;
        ['pointerdown', 'touchstart', 'mousedown', 'click'].forEach(evt => {
            inp.addEventListener(evt, (e) => {
                e.stopPropagation();
            }, { passive: true });
        });
        inp.addEventListener('click', () => {
            inp.focus();
        });
    });

    toggleBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!formWrap) return;
        const willShow = formWrap.classList.contains('hidden');
        if (willShow) {
            formWrap.classList.remove('hidden');
            setTimeout(() => {
                noteInput?.focus();
            }, 60);
        } else {
            formWrap.classList.add('hidden');
        }
    });

    cancelKeyBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (keyInput) keyInput.value = '';
        if (noteInput) noteInput.value = '';
        formWrap?.classList.add('hidden');
    });

    // 新增金鑰表單內的「⚡ 測試連線」按鈕：即使還沒按「確認新增」或「儲存並同步」，也立即用當下點選的模型與輸入框 .trim() 金鑰測試
    testNewKeyBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isTestingGeminiKeyInProgress) return;

        const rawKey = (keyInput?.value || '').trim();
        const rawNote = (noteInput?.value || '').trim() || '新輸入金鑰';
        const liveModel = getCurrentSelectedAiModel();
        const testStatusBox = document.getElementById('adminAiKeyTestStatusBox');

        if (!rawKey) {
            if (testStatusBox) {
                testStatusBox.className = 'rounded-xl p-2.5 text-[11px] font-extrabold leading-relaxed border bg-amber-50 border-amber-300 text-amber-800';
                testStatusBox.innerHTML = '⚠️ 請先在 API Key 輸入框貼上金鑰再點擊測試連線！';
                testStatusBox.classList.remove('hidden');
            }
            keyInput?.focus();
            return;
        }

        const origHtml = '⚡ 測試連線';
        isTestingGeminiKeyInProgress = true;
        setAllAiKeyTestButtonsDisabled(true, testNewKeyBtn);

        if (testStatusBox) {
            testStatusBox.className = 'rounded-xl p-2.5 text-[11px] font-extrabold leading-relaxed border bg-violet-50 border-violet-200 text-violet-800';
            testStatusBox.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> 正在使用模型 <b>${liveModel}</b> 測試「${rawNote}」純文字輕量連線（逾時上限 20 秒）...`;
            testStatusBox.classList.remove('hidden');
        }

        try {
            const resInfo = await testSingleGeminiApiKey(rawKey, liveModel);
            if (testStatusBox) {
                testStatusBox.className = 'rounded-xl p-2.5 text-[11px] font-extrabold leading-relaxed border bg-emerald-50 border-emerald-300 text-emerald-800';
                testStatusBox.innerHTML = `🟢 Gemini 連線成功（模型：${resInfo.testedModel || liveModel}｜實際回應端點：${resInfo.actualEndpointModel || resInfo.testedModel || liveModel}｜Key：${rawNote}｜耗時 ${resInfo.elapsedSec}s）`;
                testStatusBox.classList.remove('hidden');
            }
        } catch (err) {
            const detailedMsg = formatGeminiTestErrorMessage(err);
            if (testStatusBox) {
                testStatusBox.className = 'rounded-xl p-2.5 text-[11px] font-extrabold leading-relaxed border bg-red-50 border-red-300 text-red-700';
                testStatusBox.innerHTML = `🔴 Gemini 連線失敗（模型：${liveModel}｜Key：${rawNote}）：${detailedMsg}`;
                testStatusBox.classList.remove('hidden');
            }
        } finally {
            isTestingGeminiKeyInProgress = false;
            setAllAiKeyTestButtonsDisabled(false);
            testNewKeyBtn.innerHTML = origHtml;
        }
    });

    saveKeyBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const rawKey = (keyInput?.value || '').trim();
        const rawNote = (noteInput?.value || '').trim();
        if (!rawKey) {
            keyInput?.focus();
            return;
        }

        // 若已存在相同 Key 則更新備註並設為啟用，否則新增一組
        const existing = editingAdminAiKeys.find(item => item.key === rawKey);
        if (existing) {
            if (rawNote) existing.note = rawNote;
            editingActiveAiKeyId = existing.id;
        } else {
            const newId = `aikey_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            editingAdminAiKeys.push({
                id: newId,
                key: rawKey,
                note: rawNote || `金鑰 #${editingAdminAiKeys.length + 1}`,
                createdAt: Date.now()
            });
            editingActiveAiKeyId = newId;
        }

        if (keyInput) keyInput.value = '';
        if (noteInput) noteInput.value = '';
        formWrap?.classList.add('hidden');
        vibrate(25);
        renderAdminAiKeyListUI();
        persistAdminAiSettingsImmediately();
    });
})();

function highlightAdminSleepMaxMinBtn(activeMinutes) {
    const numVal = Number(activeMinutes);
    const btns = document.querySelectorAll('.admin-sleep-max-min-btn');
    btns.forEach(btn => {
        const btnVal = parseInt(btn.getAttribute('data-sleep-max-min'), 10);
        const isMatch = (!isNaN(numVal) && btnVal === numVal);
        const labelText = btnVal === 0 ? '不屏蔽(0)' : `${btnVal}分鐘`;
        if (isMatch) {
            btn.className = 'admin-sleep-max-min-btn bg-amber-100 border-2 border-amber-500 text-amber-900 font-extrabold py-1.5 px-1 rounded-lg active:scale-95 transition-all text-[11px]';
            btn.textContent = `✅ ${labelText}`;
        } else {
            btn.className = 'admin-sleep-max-min-btn bg-white hover:bg-amber-50 border border-gray-200 text-gray-700 font-extrabold py-1.5 px-1 rounded-lg active:scale-95 transition-all text-[11px]';
            btn.textContent = labelText;
        }
    });
}

function populateAdminSettingsForm(cfg) {
    const c = normalizeSystemConfig(cfg);
    selectedAdminInterval = c.radarIntervalSec;
    updateAdminIntervalDisplay(c.radarIntervalSec);
    highlightAdminIntervalBtn(c.radarIntervalSec);

    // 同步 AI 模型與多組 API Key 清單
    selectedAdminAiModel = c.aiDispatchModel || 'gemini-3.6-flash';
    editingAdminAiKeys = normalizeAiApiKeysArray(c.aiApiKeys);
    editingActiveAiKeyId = c.activeAiKeyId || (editingAdminAiKeys[0]?.id || '');
    highlightAdminAiModelBtn(selectedAdminAiModel);
    renderAdminAiKeyListUI();

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };
    const setChecked = (id, boolVal) => {
        const el = document.getElementById(id);
        if (el) el.checked = Boolean(boolVal);
    };

    setVal('adminAnnouncementInput', c.announcementText || '');
    setVal('adminLookAheadDistInput', c.lookAheadDistMeters);
    setVal('adminConfirmDistInput', c.confirmDistMeters);
    setVal('adminBearingTolInput', c.bearingToleranceDeg);
    setVal('adminVoiceRateInput', c.voiceRate);
    setVal('adminLowSpeedZoomInput', c.lowSpeedZoom);
    setVal('adminHighSpeedZoomInput', c.highSpeedZoom);
    setChecked('adminEnableDynamicZoomInput', c.enableDynamicZoom);
    setChecked('adminShowOnlineFleetListInput', c.showOnlineFleetList);
    setChecked('adminShowFleetSleepStatusInput', c.showFleetSleepStatus);
    setVal('adminFleetSleepMaxMinutesInput', c.fleetSleepMaxMinutes);
    highlightAdminSleepMaxMinBtn(c.fleetSleepMaxMinutes);
    setVal('adminMaxAccuracyInput', c.maxAccuracyMeters);
    setVal('adminMaxSpeedInput', c.maxSpeedKmh);
    setVal('adminMinLockSpeedInput', c.minLockSpeedKmh);

    // 同步「👥 管理使用者」書籤頁中的全站門禁開關
    setChecked('adminRequireUserApprovalInput', c.requireUserApproval);
    syncAdminGateStatusBadgeUI(c.requireUserApproval);
}

function readAdminSettingsForm() {
    const getVal = (id) => document.getElementById(id)?.value;
    const getChecked = (id) => Boolean(document.getElementById(id)?.checked);

    // 若使用者在新增 API Key 輸入框填了金鑰但還沒按「確認新增」就直接按底下「儲存並同步」，自動幫他收錄進清單！
    const pendingNewKey = (document.getElementById('adminNewAiKeyInput')?.value || '').trim();
    const pendingNewNote = (document.getElementById('adminNewAiKeyNoteInput')?.value || '').trim();
    if (pendingNewKey) {
        const existing = editingAdminAiKeys.find(k => k.key === pendingNewKey);
        if (existing) {
            if (pendingNewNote) existing.note = pendingNewNote;
            editingActiveAiKeyId = existing.id;
        } else {
            const newId = `aikey_${Date.now()}`;
            editingAdminAiKeys.push({
                id: newId,
                key: pendingNewKey,
                note: pendingNewNote || `金鑰 #${editingAdminAiKeys.length + 1}`,
                createdAt: Date.now()
            });
            editingActiveAiKeyId = newId;
        }
        const keyInput = document.getElementById('adminNewAiKeyInput');
        const noteInput = document.getElementById('adminNewAiKeyNoteInput');
        if (keyInput) keyInput.value = '';
        if (noteInput) noteInput.value = '';
        document.getElementById('adminAddAiKeyFormWrap')?.classList.add('hidden');
    }

    const reqApprovalVal = getChecked('adminRequireUserApprovalInput');
    return normalizeSystemConfig({
        radarIntervalSec: selectedAdminInterval,
        announcementText: getVal('adminAnnouncementInput') || '',
        lookAheadDistMeters: getVal('adminLookAheadDistInput'),
        confirmDistMeters: getVal('adminConfirmDistInput'),
        bearingToleranceDeg: getVal('adminBearingTolInput'),
        voiceRate: getVal('adminVoiceRateInput'),
        lowSpeedZoom: getVal('adminLowSpeedZoomInput'),
        highSpeedZoom: getVal('adminHighSpeedZoomInput'),
        enableDynamicZoom: getChecked('adminEnableDynamicZoomInput'),
        showOnlineFleetList: getChecked('adminShowOnlineFleetListInput'),
        showFleetSleepStatus: getChecked('adminShowFleetSleepStatusInput'),
        fleetSleepMaxMinutes: getVal('adminFleetSleepMaxMinutesInput'),
        maxAccuracyMeters: getVal('adminMaxAccuracyInput'),
        maxSpeedKmh: getVal('adminMaxSpeedInput'),
        minLockSpeedKmh: getVal('adminMinLockSpeedInput'),
        aiDispatchModel: selectedAdminAiModel,
        aiApiKeys: editingAdminAiKeys,
        activeAiKeyId: editingActiveAiKeyId,
        requireApproval: reqApprovalVal,
        requireUserApproval: reqApprovalVal
    });
}

async function openAdminSettingsPanel() {
    const modal = document.getElementById('adminSettingsModal');
    if (!modal) return;

    if (typeof syncAdminFurnitureEntryButtonUI === 'function') {
        syncAdminFurnitureEntryButtonUI();
    }

    // 先以目前本機有效設定立即渲染，再從 Firebase 拉取最新雲端設定覆蓋
    populateAdminSettingsForm(systemNavConfig);
    modal.classList.remove('hidden');

    // 背景載入使用者清單以更新「👥 管理使用者」待核准紅點徽章
    fetchAndRenderAdminFleetUsersList();

    const cloudCfg = await fetchSystemConfig();
    // 若使用者此時已經按了「⚡ 測試連線」正在測試中，不要重繪表單避免打斷測試狀態顯示
    if (isTestingGeminiKeyInProgress) {
        return;
    }
    // 若本機已有剛新增的 API Keys 而雲端還是空的，保留合併本機 Keys
    if (editingAdminAiKeys.length > 0 && (!Array.isArray(cloudCfg.aiApiKeys) || cloudCfg.aiApiKeys.length === 0)) {
        cloudCfg.aiApiKeys = editingAdminAiKeys;
        cloudCfg.activeAiKeyId = editingActiveAiKeyId;
    }
    applySystemConfigToRuntime(cloudCfg);
    populateAdminSettingsForm(cloudCfg);
}

function updateAdminIntervalDisplay(sec) {
    const el = document.getElementById('adminCurrentIntervalDisplay');
    if (el) el.textContent = `${sec} 秒`;
}

function highlightAdminIntervalBtn(activeSec) {
    const btns = document.querySelectorAll('.admin-interval-btn');
    btns.forEach(btn => {
        const val = parseInt(btn.dataset.interval, 10);
        if (val === activeSec) {
            btn.className = 'admin-interval-btn bg-blue-50 border-2 border-blue-500 text-blue-800 font-extrabold py-2 px-1 rounded-xl active:scale-95 transition-all flex flex-col items-center justify-center text-xs ring-2 ring-blue-200';
        } else {
            btn.className = 'admin-interval-btn bg-white hover:bg-blue-50 border-2 border-gray-200 text-gray-800 font-extrabold py-2 px-1 rounded-xl active:scale-95 transition-all flex flex-col items-center justify-center text-xs';
        }
    });
}

// 秒數選擇按鈕點擊事件
document.querySelectorAll('.admin-interval-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const val = parseInt(btn.dataset.interval, 10);
        if (!isNaN(val) && val > 0) {
            selectedAdminInterval = val;
            updateAdminIntervalDisplay(val);
            highlightAdminIntervalBtn(val);
        }
    });
});

// 休眠顯示上限分鐘數快速按鈕與輸入框雙向同步事件
document.querySelectorAll('.admin-sleep-max-min-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = parseInt(btn.getAttribute('data-sleep-max-min'), 10);
        if (!isNaN(val) && val >= 0) {
            const inputEl = document.getElementById('adminFleetSleepMaxMinutesInput');
            if (inputEl) inputEl.value = val;
            highlightAdminSleepMaxMinBtn(val);
        }
    });
});

document.getElementById('adminFleetSleepMaxMinutesInput')?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    highlightAdminSleepMaxMinBtn(isNaN(val) ? -1 : val);
});

// 一鍵清空公告按鈕
document.getElementById('btnClearAdminAnnouncement')?.addEventListener('click', () => {
    const input = document.getElementById('adminAnnouncementInput');
    if (input) {
        input.value = '';
        input.focus();
    }
});

// 恢復預設值按鈕（保留已設定的 API Keys 避免誤刪）
document.getElementById('btnResetAdminDefaults')?.addEventListener('click', () => {
    populateAdminSettingsForm({
        ...DEFAULT_SYSTEM_CONFIG,
        aiApiKeys: editingAdminAiKeys,
        activeAiKeyId: editingActiveAiKeyId
    });
});

// 儲存並同步按鈕
document.getElementById('btnSaveAdminSettings')?.addEventListener('click', async () => {
    const saveBtn = document.getElementById('btnSaveAdminSettings');
    if (!saveBtn) return;
    const originalText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 同步中...';
    saveBtn.disabled = true;

    try {
        const newConfig = readAdminSettingsForm();
        const payload = {
            ...newConfig,
            updatedAt: Date.now()
        };
        const saveRes = await fetchWithTimeout(SYSTEM_CONFIG_URL, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }, 5000);
        if (!saveRes.ok) throw new Error(`HTTP ${saveRes.status}`);

        // 本機立即套用所有新參數、AI 模型、API Key 清單與公告橫幅
        applySystemConfigToRuntime(newConfig);
        populateAdminSettingsForm(newConfig);

        saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> 已儲存並全隊同步！';
        setTimeout(() => {
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
            document.getElementById('adminSettingsModal')?.classList.add('hidden');
        }, 1200);
    } catch (err) {
        saveBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> 儲存失敗，請重試';
        saveBtn.disabled = false;
        setTimeout(() => { saveBtn.innerHTML = originalText; }, 2000);
    }
});

// 關閉按鈕
document.getElementById('btnCloseAdminSettings')?.addEventListener('click', () => {
    document.getElementById('adminSettingsModal')?.classList.add('hidden');
});

