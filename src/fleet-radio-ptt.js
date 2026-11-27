// ==========================================
// [Module 13] src/fleet-radio-ptt.js
// 獨立模組：內建網路無線電（車隊短語音 PTT 對講）
// 封裝麥克風壓縮錄音（最長 8 秒）、Firebase 即時廣播收發、音訊自動播放解鎖、Wake Lock 防休眠與僅限地圖主畫面半透明懸浮按鈕
// ==========================================

(function initFleetRadioPTTModule() {
    const STORAGE_KEY_ENABLED = 'yingge_fleet_radio_ptt_enabled_v1';
    const STORAGE_KEY_LAYOUT = 'yingge_fleet_radio_ptt_layout_v1';
    const STORAGE_KEY_CLIENT_ID = 'yingge_fleet_radio_client_id_v1';
    const STORAGE_KEY_PRIVATE_CFG = 'yingge_fleet_radio_private_cfg_v1';
    const PRIVATE_MODE_OFF = 0;
    const PRIVATE_MODE_DUAL_WATCH = 1;
    const PRIVATE_MODE_PRIVATE_ONLY = 2;
    const PRIVATE_BTN_BASE_SIZE = 40;
    const PRIVATE_BTN_GAP_PX = 8;
    const PRIVATE_UNLOCK_TAP_TARGET = 5;
    const PRIVATE_UNLOCK_WINDOW_MS = 2500;
    const MAX_RECORD_MS = 8000;            // 最長 8 秒自動截斷
    const MIN_RECORD_MS = 350;             // 短於 0.35 秒視為誤觸不發送
    const RECORDER_TIMESLICE_MS = 150;     // 縮短取樣間隔至 150ms，確保開頭語音即時寫入 chunk
    const RECORDER_AUDIO_BPS = 16000;      // 16kbps 語音最佳化壓縮，縮小行動網路封包
    const MAX_PLAYBACK_AGE_MS = 30000;     // 允許 30 秒內訊息播放（容忍行動裝置時鐘誤差）
    const CLOCK_SKEW_TOLERANCE_MS = 15000; // 容忍發送端時鐘超前 15 秒
    const EXPIRED_CLOUD_CLEANUP_MS = 60000;// 雲端語音超過 60 秒自動清理 audio.json
    const CLOUD_CLEANUP_COOLDOWN_MS = 45000;
    const POLL_INTERVAL_MS = 1500;         // 輕量 meta.json 輪詢間隔（支援極致省電黑屏持續接收）
    const MAX_AUDIO_DATAURL_LEN = 350000;
    const POLL_STUCK_TIMEOUT_MS = 12000;   // 輪詢旗標逾時自癒門檻
    const UPLOAD_STUCK_TIMEOUT_MS = 20000; // 上傳旗標逾時自癒門檻
    const PLAYBACK_READY_TIMEOUT_MS = 1200;// 等待音訊緩衝就緒上限
    const PLAYBACK_MIN_WATCHDOG_MS = 12000;
    const PLAYBACK_MAX_WATCHDOG_MS = 18000;
    const MAX_DEDUP_CACHE_SIZE = 32;
    const BASE_BTN_SIZE = 56;
    const MIN_SCALE = 1.0;
    const MAX_SCALE = 4.0;
    const DRAG_THRESHOLD_PX = 10;
    const VIEWPORT_MARGIN_PX = 8;

    // 狀態變數（完全封裝於獨立模組）
    let isRadioEnabled = true;
    try {
        if (localStorage.getItem(STORAGE_KEY_ENABLED) === 'false') {
            isRadioEnabled = false;
        }
    } catch (e) {}

    // 隱藏式私人頻道與雙守候狀態（預設完全關閉，僅透過設定選單版本號連點 5 下解鎖）
    let privateRadioMode = PRIVATE_MODE_OFF;
    let privateChannelCode = '';

    function sanitizePrivateChannelCode(raw) {
        return String(raw || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16);
    }

    function loadPrivateRadioConfig() {
        privateRadioMode = PRIVATE_MODE_OFF;
        privateChannelCode = '';
        try {
            const raw = localStorage.getItem(STORAGE_KEY_PRIVATE_CFG);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return;
            const modeNum = Number(parsed.mode);
            const cleanCode = sanitizePrivateChannelCode(parsed.code);
            privateChannelCode = cleanCode;
            if ((modeNum === PRIVATE_MODE_DUAL_WATCH || modeNum === PRIVATE_MODE_PRIVATE_ONLY) && cleanCode.length >= 2) {
                privateRadioMode = modeNum;
            } else {
                privateRadioMode = PRIVATE_MODE_OFF;
            }
        } catch (e) {
            privateRadioMode = PRIVATE_MODE_OFF;
            privateChannelCode = '';
        }
    }

    function savePrivateRadioConfig(mode, code) {
        const cleanCode = sanitizePrivateChannelCode(code);
        const modeNum = (mode === PRIVATE_MODE_DUAL_WATCH || mode === PRIVATE_MODE_PRIVATE_ONLY) && cleanCode.length >= 2
            ? mode
            : PRIVATE_MODE_OFF;
        privateRadioMode = modeNum;
        privateChannelCode = cleanCode;
        try {
            localStorage.setItem(STORAGE_KEY_PRIVATE_CFG, JSON.stringify({
                mode: privateRadioMode,
                code: privateChannelCode
            }));
        } catch (e) {}
    }

    function getEffectivePrivateMode() {
        if ((privateRadioMode === PRIVATE_MODE_DUAL_WATCH || privateRadioMode === PRIVATE_MODE_PRIVATE_ONLY) && privateChannelCode.length >= 2) {
            return privateRadioMode;
        }
        return PRIVATE_MODE_OFF;
    }

    loadPrivateRadioConfig();

    let isRecordingPtt = false;
    let isAcquiringMic = false;
    let isRecorderCapturing = false;
    let isUploadingPtt = false;
    let uploadingStartedAt = 0;
    let activeTransmitChannel = 'public';  // 'public' | 'private'
    let activeTransmitButton = 'main';     // 'main' | 'private'
    let activeUploadingButton = 'main';    // 'main' | 'private'
    let recordingSessionId = 0;
    let activeMediaRecorder = null;
    let activeMicStream = null;
    let recordedChunks = [];
    let recordStartAt = 0;
    let recordTickTimer = null;
    let recordMaxTimer = null;
    let activePointerId = null;
    let cancelUploadFlag = false;
    let audioCtxIdleSuspendTimer = null;

    let pollTimer = null;
    const channelPollState = {
        public: { isPolling: false, pollingStartedAt: 0, lastCloudCleanupAt: 0 },
        private: { isPolling: false, pollingStartedAt: 0, lastCloudCleanupAt: 0 }
    };
    const handledMessageIds = new Map(); // `${channel}:${msgId}` -> handledAtMs（防重複觸發且雙頻道完全隔離）
    let playbackQueue = [];
    let pendingAutoplayRetryItem = null;
    let isPlayingAudio = false;
    let activePlaybackObjectUrl = null;
    let playbackWatchdogTimer = null;
    let toastHideTimer = null;
    let isBgmDuckedByRadio = false;
    let sharedAudioEl = null;
    let unlockAudioCtx = null;
    let isAudioUnlocked = false;
    let radioWakeLock = null;
    let fallbackRadioClientId = '';

    let pttBtnEl = null;
    let pttIconEl = null;
    let pttLabelEl = null;
    let pttResizeHandleEl = null;
    let privatePttBtnEl = null;
    let privatePttIconEl = null;
    let privatePttLabelEl = null;
    let privatePttPointerId = null;
    let isPrivatePttGestureActive = false;
    let privateModalEl = null;
    let toastEl = null;
    let visibilityObserver = null;
    let visibilitySyncTimer = null;

    // 懸浮按鈕位置與縮放狀態（支援自由拖動 ＋ 1.0x～4.0x 縮放並持久化）
    let pttScale = 1.0;
    let pttPosLeft = 14;
    let pttPosTop = 320;
    let gestureMode = 'idle'; // 'idle' | 'ptt' | 'drag' | 'pinch-resize' | 'handle-resize'
    const activePointers = new Map();
    let dragPointerId = null;
    let dragStartPointerX = 0;
    let dragStartPointerY = 0;
    let dragStartLeft = 14;
    let dragStartTop = 320;
    let pinchStartDist = 1;
    let pinchStartScale = 1.0;
    let pinchAnchorCenterX = 0;
    let pinchAnchorCenterY = 0;
    let handlePointerId = null;
    let handleStartX = 0;
    let handleStartY = 0;
    let handleStartScale = 1.0;

    function getFirebaseBaseUrl() {
        return (typeof FIREBASE_BASE_URL === 'string' && FIREBASE_BASE_URL)
            ? FIREBASE_BASE_URL
            : 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app';
    }

    function getRadioCloudBaseUrl() {
        return `${getFirebaseBaseUrl()}/system_config/fleet_radio`;
    }

    function getPrivateRadioCloudBaseUrl(codeOverride = '') {
        const cleanCode = sanitizePrivateChannelCode(codeOverride || privateChannelCode);
        if (cleanCode.length < 2) return '';
        return `${getFirebaseBaseUrl()}/system_config/walkie_talkie_private/${encodeURIComponent(cleanCode)}`;
    }

    function getRadioCloudBaseUrlForChannel(channel = 'public') {
        if (channel === 'private') {
            return getPrivateRadioCloudBaseUrl();
        }
        return getRadioCloudBaseUrl();
    }

    function getActiveListenChannels() {
        const mode = getEffectivePrivateMode();
        if (mode === PRIVATE_MODE_PRIVATE_ONLY) return ['private'];
        if (mode === PRIVATE_MODE_DUAL_WATCH) return ['public', 'private'];
        return ['public'];
    }

    function getMainPttTargetChannel() {
        return getEffectivePrivateMode() === PRIVATE_MODE_PRIVATE_ONLY ? 'private' : 'public';
    }

    function getCurrentDeviceId() {
        if (typeof fleetDeviceId === 'string' && fleetDeviceId.trim()) return fleetDeviceId.trim();
        try {
            const fromStorage = (localStorage.getItem('deviceId') || localStorage.getItem('fleet_device_id') || '').trim();
            if (fromStorage) return fromStorage;
            if (!fallbackRadioClientId) {
                const existing = (localStorage.getItem(STORAGE_KEY_CLIENT_ID) || '').trim();
                if (existing) {
                    fallbackRadioClientId = existing;
                } else {
                    fallbackRadioClientId = `radio_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                    localStorage.setItem(STORAGE_KEY_CLIENT_ID, fallbackRadioClientId);
                }
            }
            return fallbackRadioClientId;
        } catch (e) {
            if (!fallbackRadioClientId) {
                fallbackRadioClientId = `radio_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            }
            return fallbackRadioClientId;
        }
    }

    function getCurrentSenderName() {
        if (typeof fleetUserName === 'string' && fleetUserName.trim()) return fleetUserName.trim();
        try {
            const stored = (localStorage.getItem('fleet_user_name') || '').trim();
            if (stored) return stored;
        } catch (e) {}
        return '車隊隊員';
    }

    function getHandledMessageKey(channel, msgId) {
        return `${channel || 'public'}:${msgId}`;
    }

    function hasHandledMessage(channel, msgId) {
        return Boolean(msgId && handledMessageIds.has(getHandledMessageKey(channel, msgId)));
    }

    function markMessageHandled(channel, msgId) {
        if (!msgId) return;
        const key = getHandledMessageKey(channel, msgId);
        handledMessageIds.set(key, Date.now());
        if (handledMessageIds.size > MAX_DEDUP_CACHE_SIZE * 2) {
            const oldestKey = handledMessageIds.keys().next().value;
            if (oldestKey) handledMessageIds.delete(oldestKey);
        }
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
            'privateRadioSettingsModal',
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

    // 🔓 瀏覽器音訊延遲處理（嚴禁於頁面載入、一般點擊或切回前景時預先建立/resume AudioContext 或播放無聲 WAV，避免搶佔手機音訊焦點而壓低外部背景音樂）
    function unlockBrowserAudio() {
        isAudioUnlocked = true;
        if (pendingAutoplayRetryItem) {
            flushPendingAutoplayItem();
        }
    }

    function enqueuePlaybackItem(item) {
        if (!item || !item.dataUrl) return;
        const channel = item.channel === 'private' ? 'private' : 'public';
        const normalized = { ...item, channel };
        if (channel === 'public') {
            // 雙守候優先權：清潔隊主頻道語音優先排在私人頻道之前（不蓋台、不中斷正在播放的語音）
            const firstPrivateIdx = playbackQueue.findIndex(q => q.channel === 'private');
            if (firstPrivateIdx >= 0) {
                playbackQueue.splice(firstPrivateIdx, 0, normalized);
            } else {
                playbackQueue.push(normalized);
            }
        } else {
            playbackQueue.push(normalized);
        }
    }

    function flushPendingAutoplayItem() {
        if (!pendingAutoplayRetryItem || isPlayingAudio || isRecordingPtt || !isRadioEnabled) return;
        const item = pendingAutoplayRetryItem;
        pendingAutoplayRetryItem = null;
        if ((Date.now() - (item.receivedAt || 0)) <= MAX_PLAYBACK_AGE_MS) {
            if (item.channel === 'private') {
                enqueuePlaybackItem(item);
            } else {
                playbackQueue.unshift(item);
            }
            processPlaybackQueue();
        }
    }

    function scheduleIdleAudioCtxSuspend(delayMs = 150) {
        if (audioCtxIdleSuspendTimer) {
            clearTimeout(audioCtxIdleSuspendTimer);
            audioCtxIdleSuspendTimer = null;
        }
        audioCtxIdleSuspendTimer = setTimeout(() => {
            audioCtxIdleSuspendTimer = null;
            if (!isRecordingPtt && !isPlayingAudio && unlockAudioCtx && unlockAudioCtx.state === 'running') {
                unlockAudioCtx.suspend().catch(() => {});
            }
        }, delayMs);
    }

    // 🔔 極短清脆無線電提示音（僅在實際按下/放開對講鍵時才按需喚醒 AudioContext，85ms 播畢後立即 suspend 釋放音訊通道）
    function playPttCueTone(kind = 'start') {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            if (!unlockAudioCtx) unlockAudioCtx = new AudioCtx();
            const triggerTone = () => {
                if (!unlockAudioCtx || unlockAudioCtx.state !== 'running') return;
                const now = unlockAudioCtx.currentTime;
                const osc = unlockAudioCtx.createOscillator();
                const gain = unlockAudioCtx.createGain();
                osc.type = 'sine';
                if (kind === 'start') {
                    osc.frequency.setValueAtTime(880, now);
                    osc.frequency.exponentialRampToValueAtTime(1046, now + 0.055);
                } else {
                    osc.frequency.setValueAtTime(740, now);
                    osc.frequency.exponentialRampToValueAtTime(520, now + 0.06);
                }
                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
                osc.connect(gain);
                gain.connect(unlockAudioCtx.destination);
                osc.onended = () => {
                    try { osc.disconnect(); gain.disconnect(); } catch (_) {}
                    scheduleIdleAudioCtxSuspend(120);
                };
                osc.start(now);
                osc.stop(now + 0.085);
                scheduleIdleAudioCtxSuspend(150);
            };
            if (unlockAudioCtx.state === 'suspended') {
                unlockAudioCtx.resume().then(triggerTone).catch(() => {});
            } else {
                triggerTone();
            }
        } catch (e) {}
    }

    // 🎚️ 與 BGM 播放器協調音訊焦點（對講錄音或播放期間平滑壓低 BGM，結束後自動恢復媒體音訊通道）
    function syncAudioFocusWithBgm() {
        const shouldDuck = Boolean(isRecordingPtt || isPlayingAudio);
        if (!shouldDuck) {
            scheduleIdleAudioCtxSuspend(120);
        }
        if (shouldDuck === isBgmDuckedByRadio) return;
        isBgmDuckedByRadio = shouldDuck;
        try {
            if (window.BgmPlayer && typeof window.BgmPlayer.setVoiceDucking === 'function') {
                window.BgmPlayer.setVoiceDucking(shouldDuck);
            }
            if (!shouldDuck && window.BgmPlayer && typeof window.BgmPlayer.syncPlaybackState === 'function') {
                window.BgmPlayer.syncPlaybackState();
            }
        } catch (e) {}
    }

    // 僅在有待補播的對講語音時，才於使用者互動時觸發補播；平時觸碰畫面絕不啟動任何 AudioContext 或 Audio 元素
    ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(evtName => {
        window.addEventListener(evtName, function onInteractUnlock() {
            if (pendingAutoplayRetryItem) {
                flushPendingAutoplayItem();
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

    function recoverStuckNetworkFlags() {
        const now = Date.now();
        ['public', 'private'].forEach((ch) => {
            const st = channelPollState[ch];
            if (st && st.isPolling && st.pollingStartedAt > 0 && (now - st.pollingStartedAt) > POLL_STUCK_TIMEOUT_MS) {
                st.isPolling = false;
                st.pollingStartedAt = 0;
            }
        });
        if (isUploadingPtt && uploadingStartedAt > 0 && (now - uploadingStartedAt) > UPLOAD_STUCK_TIMEOUT_MS) {
            const prevUploadBtn = activeUploadingButton;
            isUploadingPtt = false;
            uploadingStartedAt = 0;
            updateTargetButtonVisual(prevUploadBtn, 'idle');
            if (!isPlayingAudio && !isRecordingPtt) releaseRadioWakeLock();
        }
    }

    function ensureRadioConnectionActive() {
        if (!isRadioEnabled) return;
        recoverStuckNetworkFlags();
        if (pollTimer === null) {
            startRadioPolling();
        } else {
            pollActiveRadioChannels(false);
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // 切至背景時立刻中止發話、停止所有麥克風音軌（track.stop()）並重置手勢狀態，避免系統持續佔用麥克風或鎖定通話音量
            resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: true });
            return;
        }
        if (document.visibilityState === 'visible' && isRadioEnabled) {
            unlockBrowserAudio();
            if (isRecordingPtt || isPlayingAudio) {
                requestRadioWakeLock();
            }
            ensureRadioConnectionActive();
            if (!isPlayingAudio && playbackQueue.length > 0) {
                processPlaybackQueue();
            }
            syncAudioFocusWithBgm();
        }
    });

    window.addEventListener('online', () => {
        if (!isRadioEnabled) return;
        recoverStuckNetworkFlags();
        ensureRadioConnectionActive();
    });

    window.addEventListener('offline', () => {
        if (isRecordingPtt) {
            resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: false, releaseMic: true });
            flashRadioToast('⚠️ 網路中斷，已取消本次對講並釋放麥克風', 'error', 2200);
        } else {
            resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: true });
        }
    });

    window.addEventListener('blur', () => {
        resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: true });
    });

    const releaseAllOnPageUnload = () => {
        resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: true });
        revokeActivePlaybackObjectUrl();
    };
    window.addEventListener('pagehide', releaseAllOnPageUnload);
    window.addEventListener('beforeunload', releaseAllOnPageUnload);

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
        } else if (tone === 'private') {
            toastEl.style.background = 'rgba(46, 16, 101, 0.94)';
            toastEl.style.borderColor = 'rgba(196, 181, 253, 0.9)';
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
        if (toastHideTimer) {
            clearTimeout(toastHideTimer);
            toastHideTimer = null;
        }
        showRadioToast(message, tone);
        toastHideTimer = setTimeout(() => {
            toastHideTimer = null;
            if (!isPlayingAudio) hideRadioToast();
        }, durationMs);
    }

    function isManipulatingPttLayout() {
        return gestureMode === 'drag' || gestureMode === 'pinch-resize' || gestureMode === 'handle-resize';
    }

    // 🎨 更新懸浮 PTT 按鈕視覺狀態（平時半透明，準備麥克風時亮琥珀色，真正開始收音後 100% 不透明亮紅高亮＋即時秒數，拖曳／縮放時亮青色外框提示）
    function updatePttButtonVisual(state = 'idle', secText = '') {
        if (!pttBtnEl || !pttIconEl || !pttLabelEl) return;
        if (state === 'idle' && isManipulatingPttLayout()) {
            state = gestureMode === 'drag' ? 'dragging' : 'resizing';
            secText = gestureMode === 'drag' ? '移動中' : `${pttScale.toFixed(1)}x`;
        }
        if (state === 'preparing') {
            pttBtnEl.style.opacity = '0.95';
            pttBtnEl.style.background = '#b45309';
            pttBtnEl.style.borderColor = '#fde68a';
            pttBtnEl.style.boxShadow = '0 0 0 4px rgba(245, 158, 11, 0.35), 0 8px 18px rgba(180, 83, 9, 0.45)';
            pttBtnEl.style.transform = 'scale(1.03)';
            pttIconEl.textContent = '⏳';
            pttLabelEl.textContent = secText || '準備中';
        } else if (state === 'recording') {
            pttBtnEl.style.opacity = '1';
            pttBtnEl.style.background = '#dc2626';
            pttBtnEl.style.borderColor = '#ffffff';
            pttBtnEl.style.boxShadow = '0 0 0 6px rgba(239, 68, 68, 0.38), 0 10px 24px rgba(220, 38, 38, 0.5)';
            pttBtnEl.style.transform = 'scale(1.08)';
            pttIconEl.textContent = '🔴';
            pttLabelEl.textContent = secText || '請說話';
        } else if (state === 'uploading') {
            pttBtnEl.style.opacity = '0.95';
            pttBtnEl.style.background = '#d97706';
            pttBtnEl.style.borderColor = '#fef3c7';
            pttBtnEl.style.boxShadow = '0 8px 18px rgba(217, 119, 6, 0.4)';
            pttBtnEl.style.transform = 'scale(1)';
            pttIconEl.textContent = '📡';
            pttLabelEl.textContent = '傳送中';
        } else if (state === 'dragging' || state === 'resizing') {
            pttBtnEl.style.opacity = '0.92';
            pttBtnEl.style.background = 'rgba(15, 23, 42, 0.9)';
            pttBtnEl.style.borderColor = '#38bdf8';
            pttBtnEl.style.boxShadow = '0 0 0 4px rgba(56, 189, 248, 0.35), 0 10px 24px rgba(15, 23, 42, 0.45)';
            pttBtnEl.style.transform = 'scale(1)';
            pttIconEl.textContent = state === 'dragging' ? '✋' : '⤢';
            pttLabelEl.textContent = secText || (state === 'dragging' ? '移動中' : `${pttScale.toFixed(1)}x`);
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

    function updatePrivatePttButtonVisual(state = 'idle', secText = '') {
        if (!privatePttBtnEl || !privatePttIconEl || !privatePttLabelEl) return;
        if (state === 'preparing') {
            privatePttBtnEl.style.opacity = '0.95';
            privatePttBtnEl.style.background = '#b45309';
            privatePttBtnEl.style.borderColor = '#fde68a';
            privatePttBtnEl.style.boxShadow = '0 0 0 3px rgba(245, 158, 11, 0.35), 0 6px 14px rgba(180, 83, 9, 0.4)';
            privatePttBtnEl.style.transform = 'scale(1.04)';
            privatePttIconEl.textContent = '⏳';
            privatePttLabelEl.textContent = secText || '準備';
        } else if (state === 'recording') {
            privatePttBtnEl.style.opacity = '1';
            privatePttBtnEl.style.background = '#7c3aed';
            privatePttBtnEl.style.borderColor = '#f5f3ff';
            privatePttBtnEl.style.boxShadow = '0 0 0 5px rgba(139, 92, 246, 0.42), 0 8px 20px rgba(109, 40, 217, 0.5)';
            privatePttBtnEl.style.transform = 'scale(1.1)';
            privatePttIconEl.textContent = '🟣';
            privatePttLabelEl.textContent = secText || '說話';
        } else if (state === 'uploading') {
            privatePttBtnEl.style.opacity = '0.95';
            privatePttBtnEl.style.background = '#6d28d9';
            privatePttBtnEl.style.borderColor = '#ddd6fe';
            privatePttBtnEl.style.boxShadow = '0 6px 14px rgba(109, 40, 217, 0.4)';
            privatePttBtnEl.style.transform = 'scale(1)';
            privatePttIconEl.textContent = '📡';
            privatePttLabelEl.textContent = '傳送';
        } else {
            privatePttBtnEl.style.opacity = '0.52';
            privatePttBtnEl.style.background = 'rgba(30, 27, 75, 0.76)';
            privatePttBtnEl.style.borderColor = 'rgba(196, 181, 253, 0.78)';
            privatePttBtnEl.style.boxShadow = '0 4px 12px rgba(15, 23, 42, 0.25)';
            privatePttBtnEl.style.transform = 'scale(1)';
            privatePttIconEl.textContent = '🔒';
            privatePttLabelEl.textContent = '私';
        }
    }

    function updateTargetButtonVisual(buttonKind = 'main', state = 'idle', secText = '') {
        if (buttonKind === 'private') {
            updatePrivatePttButtonVisual(state, secText);
        } else {
            updatePttButtonVisual(state, secText);
        }
    }

    function syncPttButtonVisibility() {
        if (!pttBtnEl) return;
        const shouldShowMain = isRadioEnabled && isOnMapMainScreen();
        const shouldShowPrivate = shouldShowMain && getEffectivePrivateMode() === PRIVATE_MODE_DUAL_WATCH;
        pttBtnEl.classList.toggle('hidden', !shouldShowMain);
        if (privatePttBtnEl) {
            privatePttBtnEl.classList.toggle('hidden', !shouldShowPrivate);
        }
        if (!shouldShowMain && (isRecordingPtt || isAcquiringMic || activeMicStream || gestureMode !== 'idle' || activePointers.size > 0 || isPrivatePttGestureActive)) {
            resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: true });
        } else if (!shouldShowPrivate && isPrivatePttGestureActive) {
            resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: false, releaseMic: true });
        }
    }

    function stopTracksOnStream(stream) {
        if (!stream) return;
        try {
            const tracks = typeof stream.getTracks === 'function' ? stream.getTracks() : [];
            tracks.forEach(track => {
                try { track.onended = null; track.onmute = null; track.onunmute = null; } catch (_) {}
                try { track.stop(); } catch (_) {}
            });
        } catch (e) {}
    }

    // 🛑 立刻完整停止並釋放麥克風所有音訊軌道（track.stop()），確保系統麥克風提示立刻消失、退出通話音量模式
    function stopAndReleaseMicStream(extraStream = null) {
        if (extraStream && extraStream !== activeMicStream) {
            stopTracksOnStream(extraStream);
        }
        if (activeMicStream) {
            stopTracksOnStream(activeMicStream);
            activeMicStream = null;
        }
    }

    function describeMicError(err) {
        const name = String(err?.name || '');
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
            return '⚠️ 無法開啟麥克風，請允許瀏覽器麥克風權限';
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
            return '⚠️ 找不到可用的麥克風裝置';
        }
        if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
            return '⚠️ 麥克風正被其他程式或通話佔用，請稍後再試';
        }
        return '⚠️ 麥克風啟動異常，請再按住重試';
    }

    // 🎙️ 僅在使用者按住對講鍵說話時才請求麥克風串流（嚴禁預開或常駐佔用）
    async function acquireOnDemandMicStream() {
        stopAndReleaseMicStream();
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        const tracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
        tracks.forEach(track => {
            track.onended = () => {
                if (activeMicStream === stream) {
                    activeMicStream = null;
                }
                if (isRecordingPtt) {
                    resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: false, releaseMic: true });
                    flashRadioToast('⚠️ 麥克風訊號中斷，已安全停止對講', 'error', 2400);
                }
            };
        });

        activeMicStream = stream;
        return stream;
    }

    function detachAndDestroyRecorder(recorder) {
        if (!recorder) return;
        try {
            recorder.onstart = null;
            recorder.ondataavailable = null;
            recorder.onerror = null;
            recorder.onstop = null;
        } catch (e) {}
    }

    function cleanupRecorderState(extraStream = null) {
        if (recordTickTimer) {
            clearInterval(recordTickTimer);
            recordTickTimer = null;
        }
        if (recordMaxTimer) {
            clearTimeout(recordMaxTimer);
            recordMaxTimer = null;
        }
        if (activeMediaRecorder) {
            detachAndDestroyRecorder(activeMediaRecorder);
            activeMediaRecorder = null;
        }
        recordedChunks.length = 0;
        isAcquiringMic = false;
        isRecorderCapturing = false;
        // 每次錄音結束、取消或異常，一律立即停止並釋放麥克風軌道
        stopAndReleaseMicStream(extraStream);
    }

    // 🛡️ 統一手勢與 PTT 發話狀態重置（確保任何中斷或結束都立即釋放麥克風並重置所有旗標）
    function resetAllPttGestureAndRecordingState({ cancelRecording = true, persistLayout = false, releaseMic = true } = {}) {
        if (persistLayout && isManipulatingPttLayout()) {
            savePttLayout();
        }
        activePointers.clear();
        gestureMode = 'idle';
        activePointerId = null;
        dragPointerId = null;
        handlePointerId = null;
        privatePttPointerId = null;
        isPrivatePttGestureActive = false;

        if (isRecordingPtt) {
            stopPttRecording(cancelRecording);
        } else {
            cleanupRecorderState();
        }

        if (releaseMic) {
            stopAndReleaseMicStream();
        }

        updatePttButtonVisual(isUploadingPtt && activeUploadingButton === 'main' ? 'uploading' : 'idle');
        updatePrivatePttButtonVisual(isUploadingPtt && activeUploadingButton === 'private' ? 'uploading' : 'idle');
        syncAudioFocusWithBgm();
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('讀取音訊資料失敗'));
            reader.readAsDataURL(blob);
        });
    }

    function dataUrlToBlob(dataUrl, fallbackMime = 'audio/webm') {
        try {
            const str = String(dataUrl || '');
            const commaIdx = str.indexOf(',');
            if (commaIdx < 0) return null;
            const header = str.slice(0, commaIdx);
            const base64 = str.slice(commaIdx + 1);
            const mimeMatch = /data:([^;]+);base64/i.exec(header);
            const mime = (mimeMatch && mimeMatch[1]) ? mimeMatch[1] : fallbackMime;
            const binary = atob(base64);
            const len = binary.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return new Blob([bytes], { type: mime });
        } catch (e) {
            return null;
        }
    }

    // ☁️ 上傳語音廣播至 Firebase（依發話目標頻道嚴格寫入對應路徑，先寫 audio.json 再寫 meta.json，確認兩筆皆成功才顯示「已發送」）
    async function uploadVoiceBroadcast(blob, durationMs, mimeType, targetChannel = 'public', sourceBtn = 'main') {
        const channel = targetChannel === 'private' ? 'private' : 'public';
        const btnKind = sourceBtn === 'private' ? 'private' : 'main';
        const baseUrl = getRadioCloudBaseUrlForChannel(channel);
        if (!baseUrl) {
            updateTargetButtonVisual(btnKind, 'idle');
            flashRadioToast('⚠️ 尚未設定有效的私人頻道密碼', 'error', 2400);
            return;
        }
        if (!navigator.onLine) {
            updateTargetButtonVisual(btnKind, 'idle');
            flashRadioToast('⚠️ 目前離線，無法發送對講語音', 'error', 2400);
            return;
        }
        isUploadingPtt = true;
        activeUploadingButton = btnKind;
        uploadingStartedAt = Date.now();
        updateTargetButtonVisual(btnKind, 'uploading');

        try {
            const dataUrl = await blobToDataUrl(blob);
            if (!dataUrl || dataUrl.length > MAX_AUDIO_DATAURL_LEN) {
                throw new Error('音訊檔案過大');
            }
            const now = Date.now();
            const msgId = `ptt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
            const senderId = getCurrentDeviceId();
            const senderName = getCurrentSenderName();

            const audioUrl = `${baseUrl}/audio.json`;
            const metaUrl = `${baseUrl}/meta.json`;

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
                ? await fetchWithTimeout(audioUrl, putAudioOpts, 8000, '音訊上傳逾時')
                : await fetch(audioUrl, putAudioOpts);
            if (!resAudio.ok) throw new Error(`音訊寫入失敗 (HTTP ${resAudio.status})`);
            const audioSaved = await resAudio.json().catch(() => null);
            if (!audioSaved || audioSaved.id !== msgId) {
                throw new Error('雲端音訊寫入驗證失敗');
            }

            const putMetaOpts = {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: msgId,
                    senderId,
                    senderName,
                    durationMs: Math.round(durationMs),
                    mimeType: mimeType || blob.type || 'audio/webm',
                    createdAt: now,
                    audioCleared: false
                })
            };
            const resMeta = (typeof fetchWithTimeout === 'function')
                ? await fetchWithTimeout(metaUrl, putMetaOpts, 5000, '廣播通知寫入逾時')
                : await fetch(metaUrl, putMetaOpts);
            if (!resMeta.ok) throw new Error(`通知寫入失敗 (HTTP ${resMeta.status})`);
            const metaSaved = await resMeta.json().catch(() => null);
            if (!metaSaved || metaSaved.id !== msgId) {
                throw new Error('雲端廣播通知驗證失敗');
            }

            // 確認雲端兩筆皆成功寫入後，才標記已處理（避免本機重播）並顯示「已發送」
            markMessageHandled(channel, msgId);
            playPttCueTone('end');
            if (channel === 'private') {
                flashRadioToast(`🔒 已發送私人語音（${(durationMs / 1000).toFixed(1)} 秒）`, 'private', 1800);
            } else {
                flashRadioToast(`📡 已發送語音廣播（${(durationMs / 1000).toFixed(1)} 秒）`, 'sent', 1800);
            }
        } catch (err) {
            flashRadioToast(`⚠️ 語音廣播傳送失敗：${err?.message || '網路異常'}`, 'error', 2800);
        } finally {
            isUploadingPtt = false;
            uploadingStartedAt = 0;
            updateTargetButtonVisual(btnKind, 'idle');
            syncAudioFocusWithBgm();
            if (!isPlayingAudio && !isRecordingPtt) releaseRadioWakeLock();
        }
    }

    function clearPlaybackWatchdog() {
        if (playbackWatchdogTimer) {
            clearTimeout(playbackWatchdogTimer);
            playbackWatchdogTimer = null;
        }
    }

    function revokeActivePlaybackObjectUrl() {
        if (activePlaybackObjectUrl) {
            try { URL.revokeObjectURL(activePlaybackObjectUrl); } catch (e) {}
            activePlaybackObjectUrl = null;
        }
    }

    function resetSharedAudioElement() {
        if (!sharedAudioEl) return;
        try {
            sharedAudioEl.onended = null;
            sharedAudioEl.onerror = null;
            sharedAudioEl.onstalled = null;
            sharedAudioEl.onabort = null;
            sharedAudioEl.oncanplaythrough = null;
            sharedAudioEl.onloadeddata = null;
            if (!sharedAudioEl.paused) sharedAudioEl.pause();
            sharedAudioEl.removeAttribute('src');
            sharedAudioEl.load();
        } catch (e) {}
        revokeActivePlaybackObjectUrl();
    }

    function abortCurrentPlaybackForPtt() {
        clearPlaybackWatchdog();
        resetSharedAudioElement();
        isPlayingAudio = false;
        hideRadioToast();
    }

    // 🎙️ 開始按住錄音（按住才請求麥克風，啟動期間顯示防呆提示，確認 MediaRecorder 真正收音後才亮紅「請說話」，放開立刻 track.stop()）
    async function startPttRecording(targetChannel = null, sourceBtn = 'main') {
        recoverStuckNetworkFlags();
        if (!isRadioEnabled || isRecordingPtt || isAcquiringMic || isUploadingPtt || isRestrictedByGate()) return;
        const sessionChannel = targetChannel || (sourceBtn === 'private' ? 'private' : getMainPttTargetChannel());
        const sessionBtn = sourceBtn === 'private' ? 'private' : 'main';

        if (sessionChannel === 'private' && !getPrivateRadioCloudBaseUrl()) {
            flashRadioToast('⚠️ 尚未設定有效的私人頻道密碼', 'error', 2000);
            gestureMode = 'idle';
            activePointers.clear();
            isPrivatePttGestureActive = false;
            privatePttPointerId = null;
            return;
        }
        if (!navigator.onLine) {
            flashRadioToast('⚠️ 目前離線，無法發送對講語音', 'error', 2000);
            gestureMode = 'idle';
            activePointers.clear();
            isPrivatePttGestureActive = false;
            privatePttPointerId = null;
            return;
        }

        // 若正在外放隊員語音，先禮讓並釋放播放通道，避免麥克風收錄回音或行動裝置音訊互鎖
        if (isPlayingAudio) {
            abortCurrentPlaybackForPtt();
        }
        unlockBrowserAudio();

        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
            flashRadioToast('⚠️ 此裝置瀏覽器不支援麥克風錄音', 'error', 2500);
            gestureMode = 'idle';
            activePointers.clear();
            isPrivatePttGestureActive = false;
            privatePttPointerId = null;
            return;
        }

        const mySessionId = ++recordingSessionId;
        activeTransmitChannel = sessionChannel;
        activeTransmitButton = sessionBtn;
        isRecordingPtt = true;
        isAcquiringMic = true;
        isRecorderCapturing = false;
        cancelUploadFlag = false;
        recordedChunks.length = 0;
        recordStartAt = Date.now();
        updateTargetButtonVisual(sessionBtn, 'preparing', sessionBtn === 'private' ? '啟動' : '啟動中');
        syncAudioFocusWithBgm();
        requestRadioWakeLock();

        let acquiredStream = null;
        try {
            acquiredStream = await acquireOnDemandMicStream();
            isAcquiringMic = false;

            // 若使用者在取得麥克風串流前就已經放開、取消、切背景或切換為拖曳／縮放，立即停止所有剛取得的音軌（track.stop()）且絕不送出
            if (!isRecordingPtt || mySessionId !== recordingSessionId || document.visibilityState === 'hidden') {
                cleanupRecorderState(acquiredStream);
                isRecordingPtt = false;
                updateTargetButtonVisual(sessionBtn, 'idle');
                syncAudioFocusWithBgm();
                if (!isPlayingAudio) releaseRadioWakeLock();
                return;
            }

            const mimeType = pickSupportedAudioMimeType();
            const recorderOpts = mimeType
                ? { mimeType, audioBitsPerSecond: RECORDER_AUDIO_BPS }
                : { audioBitsPerSecond: RECORDER_AUDIO_BPS };

            const recorder = new MediaRecorder(acquiredStream, recorderOpts);
            activeMediaRecorder = recorder;

            recorder.onstart = () => {
                if (!isRecordingPtt || mySessionId !== recordingSessionId) return;
                isRecorderCapturing = true;
                recordStartAt = Date.now();
                updateTargetButtonVisual(sessionBtn, 'recording', sessionBtn === 'private' ? '說話' : '請說話');
                playPttCueTone('start');
                try { navigator.vibrate?.(30); } catch (e) {}

                recordTickTimer = setInterval(() => {
                    if (!isRecordingPtt || mySessionId !== recordingSessionId) return;
                    const elapsed = (Date.now() - recordStartAt) / 1000;
                    const sec = Math.min(MAX_RECORD_MS / 1000, elapsed);
                    updateTargetButtonVisual(
                        sessionBtn,
                        'recording',
                        elapsed < 0.35 ? (sessionBtn === 'private' ? '說話' : '請說話') : `${sec.toFixed(1)}s`
                    );
                }, 100);

                // 達最長 8 秒上限自動停止並上傳
                recordMaxTimer = setTimeout(() => {
                    if (isRecordingPtt && mySessionId === recordingSessionId) {
                        stopPttRecording(false);
                    }
                }, MAX_RECORD_MS);
            };

            recorder.ondataavailable = (e) => {
                if (mySessionId === recordingSessionId && e.data && e.data.size > 0) {
                    recordedChunks.push(e.data);
                }
            };

            recorder.onerror = () => {
                if (mySessionId !== recordingSessionId) return;
                cleanupRecorderState(acquiredStream);
                isRecordingPtt = false;
                gestureMode = 'idle';
                activePointers.clear();
                isPrivatePttGestureActive = false;
                privatePttPointerId = null;
                updateTargetButtonVisual(sessionBtn, 'idle');
                syncAudioFocusWithBgm();
                if (!isPlayingAudio) releaseRadioWakeLock();
                flashRadioToast('⚠️ 錄音裝置異常，已釋放麥克風請重試', 'error', 2400);
            };

            recorder.onstop = () => {
                const wasCapturing = isRecorderCapturing;
                const durationMs = wasCapturing ? (Date.now() - recordStartAt) : 0;
                const finalChunks = recordedChunks.slice();
                const finalMime = recorder.mimeType || mimeType || 'audio/webm';
                const shouldSkip = cancelUploadFlag || mySessionId !== recordingSessionId;

                // 錄音一結束立刻停止並釋放所有麥克風音軌（track.stop()），退出系統通話音訊通道
                cleanupRecorderState(acquiredStream);
                isRecordingPtt = false;
                syncAudioFocusWithBgm();

                if (shouldSkip) {
                    updateTargetButtonVisual(sessionBtn, 'idle');
                    if (!isPlayingAudio) releaseRadioWakeLock();
                    if (!isPlayingAudio && playbackQueue.length > 0) processPlaybackQueue();
                    return;
                }

                if (!wasCapturing || durationMs < MIN_RECORD_MS || finalChunks.length === 0) {
                    updateTargetButtonVisual(sessionBtn, 'idle');
                    flashRadioToast('⏱️ 尚未收音完成，請按住待「請說話」亮起後說話', 'error', 1800);
                    if (!isPlayingAudio) releaseRadioWakeLock();
                    if (!isPlayingAudio && playbackQueue.length > 0) processPlaybackQueue();
                    return;
                }

                const audioBlob = new Blob(finalChunks, { type: finalMime });
                finalChunks.length = 0;
                uploadVoiceBroadcast(audioBlob, Math.min(durationMs, MAX_RECORD_MS), finalMime, sessionChannel, sessionBtn);
            };

            // 使用 150ms 短取樣間隔，確保開頭語音即時寫入 chunk 不漏字
            recorder.start(RECORDER_TIMESLICE_MS);
        } catch (err) {
            cleanupRecorderState(acquiredStream);
            isRecordingPtt = false;
            gestureMode = 'idle';
            activePointers.clear();
            isPrivatePttGestureActive = false;
            privatePttPointerId = null;
            updateTargetButtonVisual(sessionBtn, 'idle');
            syncAudioFocusWithBgm();
            if (!isPlayingAudio) releaseRadioWakeLock();
            flashRadioToast(describeMicError(err), 'error', 2600);
        }
    }

    function stopPttRecording(cancelWithoutSending = false) {
        if (!isRecordingPtt && !isAcquiringMic && !activeMicStream) return;
        const wasAcquiringOnly = isAcquiringMic && !isRecorderCapturing;
        const btnKind = activeTransmitButton;
        cancelUploadFlag = Boolean(cancelWithoutSending || wasAcquiringOnly);
        isRecordingPtt = false;
        isAcquiringMic = false;
        activePointerId = null;
        if (cancelUploadFlag) {
            recordingSessionId += 1;
        }

        if (activeMediaRecorder && activeMediaRecorder.state !== 'inactive') {
            try {
                activeMediaRecorder.stop();
            } catch (e) {
                cleanupRecorderState();
                updateTargetButtonVisual(btnKind, 'idle');
                syncAudioFocusWithBgm();
            }
        } else {
            cleanupRecorderState();
            updateTargetButtonVisual(btnKind, 'idle');
            syncAudioFocusWithBgm();
            if (wasAcquiringOnly && !cancelWithoutSending) {
                flashRadioToast('⏱️ 麥克風尚未就緒，請按住稍候再說話', 'error', 1600);
            }
            if (!isPlayingAudio) releaseRadioWakeLock();
        }
    }

    // 🔊 單例播放佇列：轉為 Blob ObjectURL、等待緩衝就緒後播放、播畢立即 revokeObjectURL 釋放記憶體，並確保視覺＋音訊雙重容錯
    function processPlaybackQueue() {
        if (isPlayingAudio || isRecordingPtt || playbackQueue.length === 0 || !isRadioEnabled) {
            if (!isPlayingAudio && !toastHideTimer) {
                hideRadioToast();
                syncAudioFocusWithBgm();
            }
            return;
        }
        const item = playbackQueue.shift();
        if (!item || !item.dataUrl) {
            processPlaybackQueue();
            return;
        }

        isPlayingAudio = true;
        requestRadioWakeLock();
        syncAudioFocusWithBgm();
        if (item.channel === 'private') {
            showRadioToast(`🔒 正在播放（私人）：${item.senderName}`, 'private');
        } else {
            showRadioToast(`🔊 正在播放：${item.senderName}`, 'playing');
        }

        if (!sharedAudioEl) {
            sharedAudioEl = new Audio();
            sharedAudioEl.setAttribute('playsinline', '');
            sharedAudioEl.setAttribute('webkit-playsinline', '');
            sharedAudioEl.preload = 'auto';
        }

        let finished = false;
        let readyFallbackTimer = null;
        let playTriggered = false;

        const finishOne = (fallbackNotice = '') => {
            if (finished) return;
            finished = true;
            if (readyFallbackTimer) {
                clearTimeout(readyFallbackTimer);
                readyFallbackTimer = null;
            }
            clearPlaybackWatchdog();
            resetSharedAudioElement();
            isPlayingAudio = false;

            if (fallbackNotice) {
                flashRadioToast(fallbackNotice, 'playing', 3000);
            }

            if (playbackQueue.length === 0 || isRecordingPtt || !isRadioEnabled) {
                if (!fallbackNotice) hideRadioToast();
                syncAudioFocusWithBgm();
                if (!isRecordingPtt && !isUploadingPtt) releaseRadioWakeLock();
            } else {
                processPlaybackQueue();
            }
        };

        // 看門狗：避免行動瀏覽器漏觸發 onended 導致後續對講佇列永久卡住
        const estDuration = Number(item.durationMs) || MAX_RECORD_MS;
        const watchdogMs = Math.min(PLAYBACK_MAX_WATCHDOG_MS, Math.max(PLAYBACK_MIN_WATCHDOG_MS, estDuration + 6000));
        clearPlaybackWatchdog();
        playbackWatchdogTimer = setTimeout(() => {
            finishOne();
        }, watchdogMs);

        // 轉為 Blob + ObjectURL，減輕 Base64 重複解碼壓力並確保播畢可完整釋放記憶體
        revokeActivePlaybackObjectUrl();
        const blob = dataUrlToBlob(item.dataUrl, item.mimeType || 'audio/webm');
        let mediaSrc = item.dataUrl;
        if (blob) {
            try {
                activePlaybackObjectUrl = URL.createObjectURL(blob);
                mediaSrc = activePlaybackObjectUrl;
            } catch (e) {
                activePlaybackObjectUrl = null;
            }
        }

        const startPlayingWhenReady = () => {
            if (finished || playTriggered || !sharedAudioEl) return;
            playTriggered = true;
            if (readyFallbackTimer) {
                clearTimeout(readyFallbackTimer);
                readyFallbackTimer = null;
            }
            sharedAudioEl.oncanplaythrough = null;
            sharedAudioEl.onloadeddata = null;

            const playPromise = sharedAudioEl.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((err) => {
                    const errName = String(err?.name || '');
                    if (errName === 'NotAllowedError') {
                        // 瀏覽器尚未解鎖自動播放：保留最新語音待點擊畫面即補播，並顯示清楚視覺提示
                        pendingAutoplayRetryItem = { ...item, receivedAt: Date.now() };
                        finishOne(`🔇 收到 ${item.senderName} 對講語音（點擊畫面立即播放）`);
                    } else {
                        finishOne(`📻 收到 ${item.senderName} 對講語音（裝置無法解碼此音訊）`);
                    }
                });
            }
        };

        sharedAudioEl.onended = () => finishOne();
        sharedAudioEl.onerror = () => finishOne(`📻 收到 ${item.senderName} 對講語音（音訊編碼不相容）`);
        sharedAudioEl.onstalled = () => {
            // 僅在尚未開始播放時才加速看門狗，避免誤殺正常短停頓
            if (!playTriggered) startPlayingWhenReady();
        };
        sharedAudioEl.onabort = () => finishOne();
        sharedAudioEl.oncanplaythrough = startPlayingWhenReady;
        sharedAudioEl.onloadeddata = startPlayingWhenReady;
        sharedAudioEl.volume = 1.0;
        sharedAudioEl.src = mediaSrc;
        try { sharedAudioEl.load(); } catch (e) {}

        // 若 1.2 秒內瀏覽器尚未觸發 canplaythrough/loadeddata，仍嘗試直接播放避免卡住
        readyFallbackTimer = setTimeout(startPlayingWhenReady, PLAYBACK_READY_TIMEOUT_MS);
    }

    // 🧹 自動清理過期雲端語音節點（依頻道獨立清理，超過 60 秒即清除大型 audio.json，維持長期通話同步高速輕量）
    async function cleanupExpiredCloudAudioIfNeeded(channelKey, baseUrl, meta) {
        if (!meta || meta.audioCleared === true || !navigator.onLine || !baseUrl) return;
        const st = channelPollState[channelKey];
        if (!st) return;
        const now = Date.now();
        if ((now - st.lastCloudCleanupAt) < CLOUD_CLEANUP_COOLDOWN_MS) return;
        const createdAt = Number(meta.createdAt || 0);
        if (!createdAt || (now - createdAt) < EXPIRED_CLOUD_CLEANUP_MS) return;

        st.lastCloudCleanupAt = now;
        try {
            const audioUrl = `${baseUrl}/audio.json`;
            const metaUrl = `${baseUrl}/meta.json`;
            const delOpts = { method: 'DELETE' };
            if (typeof fetchWithTimeout === 'function') {
                await fetchWithTimeout(audioUrl, delOpts, 4000);
            } else {
                await fetch(audioUrl, delOpts);
            }
            const patchMetaOpts = {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audioCleared: true })
            };
            if (typeof fetchWithTimeout === 'function') {
                await fetchWithTimeout(metaUrl, patchMetaOpts, 4000);
            } else {
                await fetch(metaUrl, patchMetaOpts);
            }
        } catch (e) {
            // 清理失敗靜默略過，不影響正常收發
        }
    }

    // 📡 輪詢指定頻道的 Firebase meta.json（雙守候模式下兩頻道完全獨立輪詢、獨立去重、互不干擾）
    async function pollChannelMeta(channelKey = 'public', isInitialSeed = false) {
        recoverStuckNetworkFlags();
        const st = channelPollState[channelKey];
        if (!st || !isRadioEnabled || !navigator.onLine || st.isPolling || isRestrictedByGate()) return;
        const baseUrl = getRadioCloudBaseUrlForChannel(channelKey);
        if (!baseUrl) return;

        st.isPolling = true;
        st.pollingStartedAt = Date.now();
        try {
            const metaUrl = `${baseUrl}/meta.json`;
            const res = (typeof fetchWithTimeout === 'function')
                ? await fetchWithTimeout(metaUrl, { cache: 'no-store' }, 4000)
                : await fetch(metaUrl, { cache: 'no-store' });
            if (!res.ok) return;
            const meta = await res.json();
            if (!meta || typeof meta !== 'object') return;

            const createdAt = Number(meta.createdAt || 0);
            const senderId = String(meta.senderId || '').trim();
            const msgId = String(meta.id || (createdAt ? `legacy_${createdAt}_${senderId || 'anon'}` : '')).trim();
            if (!msgId) return;

            const now = Date.now();
            const ageMs = createdAt ? (now - createdAt) : 0;
            const isExpired = !createdAt || ageMs > MAX_PLAYBACK_AGE_MS || ageMs < -CLOCK_SKEW_TOLERANCE_MS;
            const isFromSelf = Boolean(senderId && senderId === getCurrentDeviceId());

            // 若雲端節點已過期超過 60 秒，順手清理大型 audio.json 避免累積拖慢同步
            if (createdAt && (now - createdAt) > EXPIRED_CLOUD_CLEANUP_MS && meta.audioCleared !== true) {
                cleanupExpiredCloudAudioIfNeeded(channelKey, baseUrl, meta);
            }

            // 剛開啟 App 或開啟無線電時，若訊息已過期或為本機舊訊則直接標記已讀不播放
            if (isInitialSeed) {
                if (isExpired || isFromSelf || meta.audioCleared === true) {
                    markMessageHandled(channelKey, msgId);
                    return;
                }
            }

            if (hasHandledMessage(channelKey, msgId)) return;

            // 排除發送者本機重複播放、已清理節點或過期舊訊
            if (isFromSelf || isExpired || meta.audioCleared === true) {
                markMessageHandled(channelKey, msgId);
                return;
            }

            // 拉取對應音訊檔（成功取得並入列後才 markMessageHandled，避免瞬斷永久漏收）
            const audioUrl = `${baseUrl}/audio.json`;
            const audioRes = (typeof fetchWithTimeout === 'function')
                ? await fetchWithTimeout(audioUrl, { cache: 'no-store' }, 6000)
                : await fetch(audioUrl, { cache: 'no-store' });
            if (!audioRes.ok) return;
            const audioPayload = await audioRes.json();
            if (!audioPayload || typeof audioPayload !== 'object' || !audioPayload.dataUrl) return;
            if (audioPayload.id && meta.id && audioPayload.id !== meta.id) return;

            // 若等待音訊期間使用者已切換模式且不再監聽此頻道，直接略過避免跨頻道串音
            if (!getActiveListenChannels().includes(channelKey)) return;

            markMessageHandled(channelKey, msgId);

            // 再次確認下載完後仍未超過過期緩衝
            if ((Date.now() - createdAt) > (MAX_PLAYBACK_AGE_MS + 10000)) return;

            enqueuePlaybackItem({
                id: msgId,
                channel: channelKey,
                senderName: String(meta.senderName || (channelKey === 'private' ? '私人對象' : '車隊隊員')).trim() || (channelKey === 'private' ? '私人對象' : '車隊隊員'),
                durationMs: Number(meta.durationMs || MAX_RECORD_MS),
                mimeType: String(audioPayload.mimeType || meta.mimeType || 'audio/webm'),
                dataUrl: audioPayload.dataUrl
            });
            processPlaybackQueue();
        } catch (e) {
            // 弱訊號或逾時靜默略過，下次輪詢自動重試
        } finally {
            st.isPolling = false;
            st.pollingStartedAt = 0;
        }
    }

    function pollActiveRadioChannels(isInitialSeed = false) {
        const channels = getActiveListenChannels();
        channels.forEach((ch) => {
            pollChannelMeta(ch, isInitialSeed);
        });
    }

    function startRadioPolling() {
        stopRadioPolling();
        if (!isRadioEnabled) return;
        pollActiveRadioChannels(true);
        pollTimer = setInterval(() => pollActiveRadioChannels(false), POLL_INTERVAL_MS);
    }

    function stopRadioPolling() {
        if (pollTimer !== null) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        clearPlaybackWatchdog();
        playbackQueue = [];
        pendingAutoplayRetryItem = null;
        resetSharedAudioElement();
        isPlayingAudio = false;
        ['public', 'private'].forEach((ch) => {
            channelPollState[ch].isPolling = false;
            channelPollState[ch].pollingStartedAt = 0;
        });
        hideRadioToast();
        syncAudioFocusWithBgm();
    }

    function clampPttScale(scale) {
        const numeric = Number(scale);
        if (!Number.isFinite(numeric)) return 1.0;
        return Math.min(MAX_SCALE, Math.max(MIN_SCALE, numeric));
    }

    function getViewportDimensions() {
        const vw = Math.max(200, window.innerWidth || document.documentElement.clientWidth || 360);
        const vh = Math.max(200, window.innerHeight || document.documentElement.clientHeight || 640);
        return { vw, vh };
    }

    function getScaledBtnSize(scale = pttScale) {
        const { vw, vh } = getViewportDimensions();
        const maxAllowedSize = Math.max(BASE_BTN_SIZE, Math.min(vw, vh) - VIEWPORT_MARGIN_PX * 2);
        return Math.min(maxAllowedSize, Math.round(BASE_BTN_SIZE * clampPttScale(scale)));
    }

    function clampPttPosition(left, top, scale = pttScale) {
        const { vw, vh } = getViewportDimensions();
        const size = getScaledBtnSize(scale);
        const maxLeft = Math.max(VIEWPORT_MARGIN_PX, vw - size - VIEWPORT_MARGIN_PX);
        const maxTop = Math.max(VIEWPORT_MARGIN_PX, vh - size - VIEWPORT_MARGIN_PX);
        const safeLeft = Number.isFinite(Number(left)) ? Number(left) : 14;
        const safeTop = Number.isFinite(Number(top)) ? Number(top) : (vh - 188 - size);
        return {
            left: Math.min(maxLeft, Math.max(VIEWPORT_MARGIN_PX, Math.round(safeLeft))),
            top: Math.min(maxTop, Math.max(VIEWPORT_MARGIN_PX, Math.round(safeTop)))
        };
    }

    function loadSavedPttLayout() {
        const { vh } = getViewportDimensions();
        let nextScale = 1.0;
        let nextLeft = 14;
        let nextTop = vh - 188 - BASE_BTN_SIZE;

        try {
            const raw = localStorage.getItem(STORAGE_KEY_LAYOUT);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    nextScale = clampPttScale(parsed.scale);
                    if (Number.isFinite(Number(parsed.left))) nextLeft = Number(parsed.left);
                    if (Number.isFinite(Number(parsed.top))) nextTop = Number(parsed.top);
                }
            }
        } catch (e) {}

        pttScale = nextScale;
        const clamped = clampPttPosition(nextLeft, nextTop, pttScale);
        pttPosLeft = clamped.left;
        pttPosTop = clamped.top;
    }

    function savePttLayout() {
        try {
            localStorage.setItem(STORAGE_KEY_LAYOUT, JSON.stringify({
                left: Math.round(pttPosLeft),
                top: Math.round(pttPosTop),
                scale: Number(clampPttScale(pttScale).toFixed(2))
            }));
        } catch (e) {}
    }

    function applyPttLayout() {
        if (!pttBtnEl) return;
        const clamped = clampPttPosition(pttPosLeft, pttPosTop, pttScale);
        pttPosLeft = clamped.left;
        pttPosTop = clamped.top;

        const size = getScaledBtnSize(pttScale);
        const effectiveScale = size / BASE_BTN_SIZE;

        pttBtnEl.style.width = `${size}px`;
        pttBtnEl.style.height = `${size}px`;
        pttBtnEl.style.borderRadius = `${Math.round(16 * effectiveScale)}px`;
        pttBtnEl.style.left = `${pttPosLeft}px`;
        pttBtnEl.style.top = `${pttPosTop}px`;
        pttBtnEl.style.bottom = 'auto';
        pttBtnEl.style.right = 'auto';

        if (pttIconEl) {
            pttIconEl.style.fontSize = `${Math.round(20 * effectiveScale)}px`;
        }
        if (pttLabelEl) {
            pttLabelEl.style.fontSize = `${Math.round(10 * effectiveScale)}px`;
            pttLabelEl.style.marginTop = `${Math.max(2, Math.round(4 * effectiveScale))}px`;
        }
        if (pttResizeHandleEl) {
            const handleSize = Math.round(Math.min(36, Math.max(18, 15 + 4.5 * effectiveScale)));
            pttResizeHandleEl.style.width = `${handleSize}px`;
            pttResizeHandleEl.style.height = `${handleSize}px`;
            pttResizeHandleEl.style.fontSize = `${Math.round(Math.min(18, Math.max(10, 8 + 2.4 * effectiveScale)))}px`;
            pttResizeHandleEl.style.borderBottomRightRadius = `${Math.max(6, Math.round(14 * effectiveScale))}px`;
        }

        if (privatePttBtnEl) {
            const { vw, vh } = getViewportDimensions();
            const privSize = Math.round(Math.min(48, Math.max(36, PRIVATE_BTN_BASE_SIZE * (0.85 + 0.15 * effectiveScale))));
            let privLeft = pttPosLeft + size + PRIVATE_BTN_GAP_PX;
            if ((privLeft + privSize + VIEWPORT_MARGIN_PX) > vw) {
                privLeft = pttPosLeft - privSize - PRIVATE_BTN_GAP_PX;
            }
            privLeft = Math.min(Math.max(VIEWPORT_MARGIN_PX, vw - privSize - VIEWPORT_MARGIN_PX), Math.max(VIEWPORT_MARGIN_PX, Math.round(privLeft)));
            const privTop = Math.min(
                Math.max(VIEWPORT_MARGIN_PX, vh - privSize - VIEWPORT_MARGIN_PX),
                Math.max(VIEWPORT_MARGIN_PX, Math.round(pttPosTop + size - privSize))
            );
            privatePttBtnEl.style.width = `${privSize}px`;
            privatePttBtnEl.style.height = `${privSize}px`;
            privatePttBtnEl.style.borderRadius = `${Math.round(privSize * 0.3)}px`;
            privatePttBtnEl.style.left = `${privLeft}px`;
            privatePttBtnEl.style.top = `${privTop}px`;
            if (privatePttIconEl) {
                privatePttIconEl.style.fontSize = `${Math.round(privSize * 0.36)}px`;
            }
            if (privatePttLabelEl) {
                privatePttLabelEl.style.fontSize = `${Math.max(9, Math.round(privSize * 0.22))}px`;
                privatePttLabelEl.style.marginTop = '2px';
            }
        }
    }

    function handleViewportResize() {
        if (!pttBtnEl) return;
        applyPttLayout();
    }

    function getTwoPointerDistance() {
        const pts = Array.from(activePointers.values());
        if (pts.length < 2) return 0;
        return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }

    // 🧩 建立並掛載獨立 UI（可自由拖動 ＋ 1.0x～4.0x 縮放懸浮 PTT 按鈕 ＋ 頂部播放提示條）
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
        pttBtnEl.title = '按住說話（最長 8 秒）；單指拖曳移動位置、雙指或拖曳右下角可縮放（1x～4x）';
        pttBtnEl.className = 'fixed flex flex-col items-center justify-center border-2 text-white select-none cursor-pointer pointer-events-auto overflow-hidden';
        pttBtnEl.style.zIndex = '45';
        pttBtnEl.style.touchAction = 'none';
        pttBtnEl.style.webkitUserSelect = 'none';
        pttBtnEl.style.webkitTouchCallout = 'none';
        pttBtnEl.style.transition = 'opacity 0.14s ease, background-color 0.14s ease, transform 0.12s ease, box-shadow 0.14s ease';
        pttBtnEl.innerHTML = `
            <span id="fleetRadioPttIcon" class="leading-none pointer-events-none">🎙️</span>
            <span id="fleetRadioPttLabel" class="font-black leading-none pointer-events-none">對講</span>
            <span id="fleetRadioPttResizeHandle" title="拖曳縮放按鈕大小（1x～4x）" aria-label="縮放對講按鈕" class="absolute right-0 bottom-0 flex items-end justify-end leading-none text-white/80 hover:text-sky-300 select-none" style="touch-action:none; cursor:nwse-resize; padding:2px 3px; background:linear-gradient(135deg, transparent 48%, rgba(56, 189, 248, 0.32) 100%);">⤡</span>
        `;
        document.body.appendChild(pttBtnEl);

        pttIconEl = pttBtnEl.querySelector('#fleetRadioPttIcon');
        pttLabelEl = pttBtnEl.querySelector('#fleetRadioPttLabel');
        pttResizeHandleEl = pttBtnEl.querySelector('#fleetRadioPttResizeHandle');

        // 🔒 雙守候模式專用低調小型私人發話鈕（預設完全隱藏，僅於解鎖並啟用模式 1「主頻道＋私人頻道雙守候」時顯示）
        privatePttBtnEl = document.createElement('button');
        privatePttBtnEl.id = 'fleetRadioPrivatePttBtn';
        privatePttBtnEl.type = 'button';
        privatePttBtnEl.title = '按住發送私人頻道語音（最長 8 秒）';
        privatePttBtnEl.className = 'hidden fixed flex flex-col items-center justify-center border-2 text-white select-none cursor-pointer pointer-events-auto overflow-hidden';
        privatePttBtnEl.style.zIndex = '45';
        privatePttBtnEl.style.touchAction = 'none';
        privatePttBtnEl.style.webkitUserSelect = 'none';
        privatePttBtnEl.style.webkitTouchCallout = 'none';
        privatePttBtnEl.style.transition = 'opacity 0.14s ease, background-color 0.14s ease, transform 0.12s ease, box-shadow 0.14s ease';
        privatePttBtnEl.innerHTML = `
            <span id="fleetRadioPrivatePttIcon" class="leading-none pointer-events-none">🔒</span>
            <span id="fleetRadioPrivatePttLabel" class="font-black leading-none pointer-events-none">私</span>
        `;
        document.body.appendChild(privatePttBtnEl);

        privatePttIconEl = privatePttBtnEl.querySelector('#fleetRadioPrivatePttIcon');
        privatePttLabelEl = privatePttBtnEl.querySelector('#fleetRadioPrivatePttLabel');

        loadSavedPttLayout();
        applyPttLayout();
        updatePttButtonVisual('idle');
        updatePrivatePttButtonVisual('idle');

        pttBtnEl.addEventListener('contextmenu', (e) => e.preventDefault());
        privatePttBtnEl.addEventListener('contextmenu', (e) => e.preventDefault());

        // 隔離底層地圖手勢事件（避免雙指縮放或拖曳 PTT 按鈕時誤觸 MapLibre 縮放／平移）
        const isolateTouchEvent = (e) => {
            e.stopPropagation();
            if (e.cancelable) e.preventDefault();
        };
        pttBtnEl.addEventListener('touchstart', isolateTouchEvent, { passive: false });
        pttBtnEl.addEventListener('touchmove', isolateTouchEvent, { passive: false });
        pttBtnEl.addEventListener('touchend', (e) => e.stopPropagation(), { passive: false });
        pttBtnEl.addEventListener('touchcancel', (e) => e.stopPropagation(), { passive: false });
        pttBtnEl.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

        privatePttBtnEl.addEventListener('touchstart', isolateTouchEvent, { passive: false });
        privatePttBtnEl.addEventListener('touchmove', isolateTouchEvent, { passive: false });
        privatePttBtnEl.addEventListener('touchend', (e) => e.stopPropagation(), { passive: false });
        privatePttBtnEl.addEventListener('touchcancel', (e) => e.stopPropagation(), { passive: false });
        privatePttBtnEl.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

        // 🔒 低調小型私人發話鈕：按住僅發送至 walkie_talkie_private/{頻道密碼}，絕不寫入清潔隊主頻道
        const releasePrivatePtt = (e, cancelWithoutSending = false) => {
            if (!isPrivatePttGestureActive) return;
            if (e && e.pointerId !== undefined && privatePttPointerId !== null && e.pointerId !== privatePttPointerId) {
                return;
            }
            if (e && typeof e.stopPropagation === 'function' && e.currentTarget === privatePttBtnEl) {
                e.stopPropagation();
            }
            isPrivatePttGestureActive = false;
            privatePttPointerId = null;
            if (isRecordingPtt && activeTransmitButton === 'private') {
                stopPttRecording(cancelWithoutSending);
            } else {
                updatePrivatePttButtonVisual(isUploadingPtt && activeUploadingButton === 'private' ? 'uploading' : 'idle');
                syncAudioFocusWithBgm();
            }
        };

        privatePttBtnEl.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
            if (getEffectivePrivateMode() !== PRIVATE_MODE_DUAL_WATCH) return;
            e.preventDefault();
            e.stopPropagation();
            if (isRecordingPtt || isAcquiringMic || isUploadingPtt || isPrivatePttGestureActive) return;

            isPrivatePttGestureActive = true;
            privatePttPointerId = e.pointerId;
            try { privatePttBtnEl.setPointerCapture(e.pointerId); } catch (_) {}
            startPttRecording('private', 'private');
        });
        privatePttBtnEl.addEventListener('pointerup', (e) => releasePrivatePtt(e, false));
        privatePttBtnEl.addEventListener('pointercancel', (e) => releasePrivatePtt(e, false));
        privatePttBtnEl.addEventListener('lostpointercapture', (e) => {
            if (isPrivatePttGestureActive && isRecorderCapturing && activeTransmitButton === 'private') {
                return;
            }
            releasePrivatePtt(e, false);
        });
        privatePttBtnEl.addEventListener('touchend', (e) => {
            e.stopPropagation();
            if (isPrivatePttGestureActive && (!e.touches || e.touches.length === 0)) {
                releasePrivatePtt(null, false);
            }
        }, { passive: false });
        window.addEventListener('pointerup', (e) => {
            if (isPrivatePttGestureActive && (privatePttPointerId === null || e.pointerId === privatePttPointerId)) {
                releasePrivatePtt(e, false);
            }
        });
        window.addEventListener('touchend', (e) => {
            if (isPrivatePttGestureActive && (!e.touches || e.touches.length === 0)) {
                releasePrivatePtt(null, false);
            }
        }, { passive: true });

        // ↘️ 右下角縮放手把：專責連續縮放（1.0x～4.0x），絕不誤觸發 PTT 廣播
        if (pttResizeHandleEl) {
            pttResizeHandleEl.addEventListener('pointerdown', (e) => {
                if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
                e.preventDefault();
                e.stopPropagation();

                if (isRecordingPtt) stopPttRecording(true);
                activePointers.clear();
                gestureMode = 'handle-resize';
                handlePointerId = e.pointerId;
                handleStartX = e.clientX;
                handleStartY = e.clientY;
                handleStartScale = pttScale;
                try { pttResizeHandleEl.setPointerCapture(e.pointerId); } catch (_) {}
                updatePttButtonVisual('resizing', `${pttScale.toFixed(1)}x`);
            });

            pttResizeHandleEl.addEventListener('pointermove', (e) => {
                if (gestureMode !== 'handle-resize' || e.pointerId !== handlePointerId) return;
                e.preventDefault();
                e.stopPropagation();

                const dx = e.clientX - handleStartX;
                const dy = e.clientY - handleStartY;
                const delta = (dx + dy) / 2;
                pttScale = clampPttScale(handleStartScale + delta / BASE_BTN_SIZE);
                applyPttLayout();
                updatePttButtonVisual('resizing', `${pttScale.toFixed(1)}x`);
            });

            const finishHandleResize = (e) => {
                if (gestureMode !== 'handle-resize' || (e && e.pointerId !== undefined && e.pointerId !== handlePointerId)) return;
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                gestureMode = 'idle';
                handlePointerId = null;
                savePttLayout();
                updatePttButtonVisual('idle');
            };
            pttResizeHandleEl.addEventListener('pointerup', finishHandleResize);
            pttResizeHandleEl.addEventListener('pointercancel', finishHandleResize);
            pttResizeHandleEl.addEventListener('lostpointercapture', () => finishHandleResize(null));
        }

        // 🎙️ 統一 Multi-Pointer 狀態機：
        // - 一旦進入紅色錄音中狀態（isRecorderCapturing === true），立即鎖定本次按住錄音手勢：
        //   手指小幅移動或滑出按鈕邊界皆不取消、不切換為拖曳，直到真正放開手指（pointerup / touchend）才結束並送出錄音（同時 track.stop() 釋放麥克風）
        // - 僅在尚未進入紅色錄音狀態前，單指快速拖曳超過門檻才切換為移動按鈕位置模式，雙指才切換為縮放模式
        pttBtnEl.addEventListener('pointerdown', (e) => {
            if (e.target === pttResizeHandleEl) return;
            if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
            e.preventDefault();
            e.stopPropagation();

            // 若目前已處於紅色錄音鎖定狀態，忽略額外誤觸的指標，防止雙指誤判取消正在進行的錄音
            if (gestureMode === 'ptt' && isRecorderCapturing) {
                return;
            }

            activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            try { pttBtnEl.setPointerCapture(e.pointerId); } catch (_) {}

            if (activePointers.size >= 2) {
                // 尚未進入紅色錄音鎖定前，雙指捏合才取消準備並進入縮放模式
                if (isRecordingPtt) stopPttRecording(true);
                gestureMode = 'pinch-resize';
                pinchStartDist = Math.max(12, getTwoPointerDistance());
                pinchStartScale = pttScale;
                const curSize = getScaledBtnSize(pttScale);
                pinchAnchorCenterX = pttPosLeft + curSize / 2;
                pinchAnchorCenterY = pttPosTop + curSize / 2;
                updatePttButtonVisual('resizing', `${pttScale.toFixed(1)}x`);
                return;
            }

            // 單指按下：保留完整 PTT 即時手感，並記錄起始座標（模式 0/1 僅發送至清潔隊頻道，模式 2 僅發送至私人頻道）
            gestureMode = 'ptt';
            activePointerId = e.pointerId;
            dragPointerId = e.pointerId;
            dragStartPointerX = e.clientX;
            dragStartPointerY = e.clientY;
            dragStartLeft = pttPosLeft;
            dragStartTop = pttPosTop;
            startPttRecording(getMainPttTargetChannel(), 'main');
        });

        pttBtnEl.addEventListener('pointermove', (e) => {
            if (!activePointers.has(e.pointerId) && e.pointerId !== dragPointerId) return;
            e.preventDefault();
            e.stopPropagation();
            if (activePointers.has(e.pointerId)) {
                activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            }

            if (gestureMode === 'pinch-resize') {
                if (activePointers.size >= 2) {
                    const curDist = getTwoPointerDistance();
                    if (curDist > 0 && pinchStartDist > 0) {
                        const nextScale = clampPttScale(pinchStartScale * (curDist / pinchStartDist));
                        pttScale = nextScale;
                        const nextSize = getScaledBtnSize(pttScale);
                        pttPosLeft = pinchAnchorCenterX - nextSize / 2;
                        pttPosTop = pinchAnchorCenterY - nextSize / 2;
                        applyPttLayout();
                        updatePttButtonVisual('resizing', `${pttScale.toFixed(1)}x`);
                    }
                }
                return;
            }

            if (gestureMode === 'ptt' && e.pointerId === dragPointerId) {
                // 🔒 已進入紅色錄音中狀態時，鎖定錄音手勢：手指移動或滑出按鈕邊界一律不取消錄音、不切換為拖曳
                if (isRecorderCapturing) {
                    return;
                }
                const dx = e.clientX - dragStartPointerX;
                const dy = e.clientY - dragStartPointerY;
                if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
                    // 僅在尚未進入紅色錄音狀態前快速滑動，才取消準備並切換為自由拖曳位置
                    gestureMode = 'drag';
                    if (isRecordingPtt) stopPttRecording(true);
                    pttPosLeft = dragStartLeft + dx;
                    pttPosTop = dragStartTop + dy;
                    applyPttLayout();
                    updatePttButtonVisual('dragging', '移動中');
                }
                return;
            }

            if (gestureMode === 'drag' && e.pointerId === dragPointerId) {
                const dx = e.clientX - dragStartPointerX;
                const dy = e.clientY - dragStartPointerY;
                pttPosLeft = dragStartLeft + dx;
                pttPosTop = dragStartTop + dy;
                applyPttLayout();
            }
        });

        const handlePointerRelease = (e) => {
            if (e && e.pointerId !== undefined && activePointers.has(e.pointerId)) {
                activePointers.delete(e.pointerId);
            }
            if (e && typeof e.stopPropagation === 'function' && e.currentTarget === pttBtnEl) {
                e.stopPropagation();
            }

            if (gestureMode === 'pinch-resize') {
                if (activePointers.size === 0) {
                    resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: false });
                }
                return;
            }

            if (gestureMode === 'drag') {
                if (activePointers.size === 0) {
                    resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: false });
                }
                return;
            }

            if (gestureMode === 'ptt') {
                if (!e || e.pointerId === undefined || e.pointerId === dragPointerId || activePointers.size === 0) {
                    gestureMode = 'idle';
                    dragPointerId = null;
                    activePointerId = null;
                    activePointers.clear();
                    if (isRecordingPtt) {
                        stopPttRecording(false);
                    } else {
                        cleanupRecorderState();
                        updatePttButtonVisual(isUploadingPtt ? 'uploading' : 'idle');
                        syncAudioFocusWithBgm();
                    }
                }
            }
        };

        pttBtnEl.addEventListener('pointerup', handlePointerRelease);
        pttBtnEl.addEventListener('touchend', (e) => {
            e.stopPropagation();
            if (gestureMode === 'ptt' && (!e.touches || e.touches.length === 0)) {
                handlePointerRelease(null);
            }
        }, { passive: false });

        // 全域放開保底監聽：當手指在紅色錄音狀態下滑出按鈕邊界（甚至在部分行動瀏覽器遺失 pointer capture）後放開手指時，仍能準確收到放開事件、送出錄音並執行 track.stop()
        window.addEventListener('pointerup', (e) => {
            if (gestureMode === 'ptt' && (e.pointerId === dragPointerId || activePointers.has(e.pointerId))) {
                handlePointerRelease(e);
            } else if ((gestureMode === 'drag' || gestureMode === 'pinch-resize') && activePointers.has(e.pointerId)) {
                handlePointerRelease(e);
            }
        });
        window.addEventListener('touchend', (e) => {
            if (gestureMode === 'ptt' && (!e.touches || e.touches.length === 0)) {
                handlePointerRelease(null);
            }
        }, { passive: true });

        pttBtnEl.addEventListener('pointercancel', (e) => {
            e.stopPropagation();
            if (gestureMode === 'ptt') {
                // pointercancel（例如系統手勢或來電中斷）時安全結束發話並徹底重置所有手勢旗標與釋放麥克風
                resetAllPttGestureAndRecordingState({ cancelRecording: false, persistLayout: false, releaseMic: false });
                return;
            }
            resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: false });
        });
        pttBtnEl.addEventListener('lostpointercapture', (e) => {
            // 若正處於紅色錄音中且手指仍按在螢幕上（滑出按鈕邊界導致部分瀏覽器解除 capture），不要中斷錄音，交由全域 pointerup / touchend 在真正放開手指時結束
            if (gestureMode === 'ptt' && isRecorderCapturing) {
                return;
            }
            if (activePointers.has(e.pointerId) || gestureMode !== 'idle' || isRecordingPtt) {
                if (gestureMode === 'ptt') {
                    handlePointerRelease(e);
                } else {
                    resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: false });
                }
            }
        });

        // 視窗尺寸變化或螢幕旋轉時自動重新夾緊安全邊界
        window.addEventListener('resize', handleViewportResize);
        window.addEventListener('orientationchange', () => {
            handleViewportResize();
            setTimeout(handleViewportResize, 180);
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
        setupHiddenPrivateRadioTrigger();
    }

    // 🔒 套用私人對講頻道與雙守候模式（即時生效並重置收發輪詢，確保頻道 100% 隔離）
    function applyPrivateRadioConfig(mode, code) {
        const prevMode = getEffectivePrivateMode();
        const prevCode = privateChannelCode;
        resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: false, releaseMic: true });
        stopRadioPolling();
        savePrivateRadioConfig(mode, code);

        if (prevMode !== getEffectivePrivateMode() || prevCode !== privateChannelCode) {
            handledMessageIds.clear();
            channelPollState.public.lastCloudCleanupAt = 0;
            channelPollState.private.lastCloudCleanupAt = 0;
        }

        applyPttLayout();
        updatePttButtonVisual('idle');
        updatePrivatePttButtonVisual('idle');
        syncPttButtonVisibility();

        if (isRadioEnabled) {
            startRadioPolling();
        }
    }

    function closePrivateRadioSettingsModal() {
        if (privateModalEl) {
            privateModalEl.classList.add('hidden');
        }
        syncPttButtonVisibility();
    }

    // 🔒 隱藏式「私人對講頻道設定」面板（僅於設定選單版本號連點 5 下才動態建立與彈出，未解鎖前零 DOM 痕跡）
    function openPrivateRadioSettingsModal() {
        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal) {
            settingsModal.classList.add('hidden');
        }

        if (!privateModalEl) {
            privateModalEl = document.createElement('div');
            privateModalEl.id = 'privateRadioSettingsModal';
            privateModalEl.className = 'hidden fixed inset-0 bg-black/70 flex items-center justify-center p-4 pointer-events-auto';
            privateModalEl.style.zIndex = '100007';
            privateModalEl.innerHTML = `
                <div class="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl border border-gray-100 flex flex-col gap-3.5 max-h-[90vh] overflow-y-auto">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <span class="w-8 h-8 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-black">🔒</span>
                            <div>
                                <h3 class="text-base font-black text-gray-900 leading-tight">私人對講頻道設定</h3>
                                <p class="text-[11px] font-bold text-gray-400">設定存於本機，重開 App 自動生效</p>
                            </div>
                        </div>
                        <button type="button" id="btnClosePrivateRadioModal" class="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center active:scale-95">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <div class="flex flex-col gap-1.5">
                        <label for="privateRadioCodeInput" class="text-xs font-extrabold text-gray-700">私人頻道密碼（雙機需輸入相同密碼）</label>
                        <input id="privateRadioCodeInput" type="text" maxlength="16" autocomplete="off" spellcheck="false"
                            placeholder="例如：1234（建議 4 位數字或英數）"
                            class="w-full px-3.5 py-2.5 rounded-2xl border-2 border-gray-200 focus:border-violet-500 bg-gray-50 text-gray-900 text-sm font-black tracking-wider outline-none transition-colors">
                        <p id="privateRadioErrorText" class="hidden text-[11px] font-bold text-red-600"></p>
                    </div>

                    <div class="flex flex-col gap-2">
                        <div class="text-xs font-extrabold text-gray-700">收發模式</div>
                        <label class="flex items-start gap-2.5 p-3 rounded-2xl border-2 border-gray-200 cursor-pointer has-[:checked]:border-gray-700 has-[:checked]:bg-gray-50 transition-colors">
                            <input type="radio" name="privateRadioMode" value="0" class="mt-0.5 w-4 h-4 accent-gray-800 flex-shrink-0">
                            <div class="leading-snug">
                                <div class="text-xs font-black text-gray-900">模式 0：關閉（預設一般隊員模式）</div>
                                <div class="text-[11px] font-bold text-gray-500 mt-0.5">完全隱藏私人功能，僅使用原本清潔隊頻道。</div>
                            </div>
                        </label>
                        <label class="flex items-start gap-2.5 p-3 rounded-2xl border-2 border-gray-200 cursor-pointer has-[:checked]:border-violet-500 has-[:checked]:bg-violet-50/70 transition-colors">
                            <input type="radio" name="privateRadioMode" value="1" class="mt-0.5 w-4 h-4 accent-violet-600 flex-shrink-0">
                            <div class="leading-snug">
                                <div class="text-xs font-black text-gray-900">模式 1：主頻道＋私人頻道雙守候（家長端）</div>
                                <div class="text-[11px] font-bold text-gray-500 mt-0.5">同時監聽兩頻道（清潔隊優先不蓋台）；主鈕發清潔隊，旁側小型鈕僅發私人頻道。</div>
                            </div>
                        </label>
                        <label class="flex items-start gap-2.5 p-3 rounded-2xl border-2 border-gray-200 cursor-pointer has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50/70 transition-colors">
                            <input type="radio" name="privateRadioMode" value="2" class="mt-0.5 w-4 h-4 accent-emerald-600 flex-shrink-0">
                            <div class="leading-snug">
                                <div class="text-xs font-black text-gray-900">模式 2：僅私人頻道（幼兒端）</div>
                                <div class="text-[11px] font-bold text-gray-500 mt-0.5">僅監聽與發送至私人頻道，100% 隔離清潔隊頻道，主畫面維持單一對講按鈕。</div>
                            </div>
                        </label>
                    </div>

                    <div class="grid grid-cols-2 gap-2 pt-1">
                        <button type="button" id="btnCancelPrivateRadioModal" class="py-2.5 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-extrabold text-xs active:scale-95 transition-all">取消</button>
                        <button type="button" id="btnSavePrivateRadioModal" class="py-2.5 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-black text-xs shadow-md active:scale-95 transition-all">儲存並套用</button>
                    </div>
                </div>
            `;
            document.body.appendChild(privateModalEl);

            privateModalEl.addEventListener('click', (e) => {
                if (e.target === privateModalEl) {
                    closePrivateRadioSettingsModal();
                }
            });
            privateModalEl.querySelector('#btnClosePrivateRadioModal')?.addEventListener('click', closePrivateRadioSettingsModal);
            privateModalEl.querySelector('#btnCancelPrivateRadioModal')?.addEventListener('click', closePrivateRadioSettingsModal);
            privateModalEl.querySelector('#btnSavePrivateRadioModal')?.addEventListener('click', () => {
                const codeInput = privateModalEl.querySelector('#privateRadioCodeInput');
                const errEl = privateModalEl.querySelector('#privateRadioErrorText');
                const checkedRadio = privateModalEl.querySelector('input[name="privateRadioMode"]:checked');
                const selectedMode = checkedRadio ? Number(checkedRadio.value) : PRIVATE_MODE_OFF;
                const rawCode = codeInput ? String(codeInput.value || '').trim() : '';
                const cleanCode = sanitizePrivateChannelCode(rawCode);

                if (selectedMode !== PRIVATE_MODE_OFF) {
                    if (cleanCode.length < 2 || cleanCode !== rawCode) {
                        if (errEl) {
                            errEl.textContent = '請輸入 2～16 碼英數字私人頻道密碼（不可含空白或特殊符號）';
                            errEl.classList.remove('hidden');
                        }
                        if (codeInput) codeInput.focus();
                        return;
                    }
                }

                if (errEl) errEl.classList.add('hidden');
                applyPrivateRadioConfig(selectedMode, cleanCode);
                closePrivateRadioSettingsModal();

                if (selectedMode === PRIVATE_MODE_DUAL_WATCH) {
                    flashRadioToast('🔒 已啟用雙守候模式（清潔隊優先＋私人頻道）', 'private', 2400);
                } else if (selectedMode === PRIVATE_MODE_PRIVATE_ONLY) {
                    flashRadioToast('🔒 已啟用僅私人頻道模式（已隔離清潔隊頻道）', 'private', 2400);
                } else {
                    flashRadioToast('📻 已切換回一般隊員模式', 'sent', 2000);
                }
            });
        }

        const codeInput = privateModalEl.querySelector('#privateRadioCodeInput');
        const errEl = privateModalEl.querySelector('#privateRadioErrorText');
        const effectiveMode = getEffectivePrivateMode();
        if (codeInput) codeInput.value = privateChannelCode || '';
        if (errEl) errEl.classList.add('hidden');
        const radios = privateModalEl.querySelectorAll('input[name="privateRadioMode"]');
        radios.forEach((r) => {
            r.checked = Number(r.value) === effectiveMode;
        });

        privateModalEl.classList.remove('hidden');
        syncPttButtonVisibility();
    }

    // 🕵️ 隱藏解鎖入口：僅在設定選單的版本號文字上連續點擊 5 下才開啟私人頻道設定
    function setupHiddenPrivateRadioTrigger() {
        const versionTextEl = document.getElementById('settingsVersionText');
        if (!versionTextEl || versionTextEl.dataset.privateUnlockBound === '1') return;
        versionTextEl.dataset.privateUnlockBound = '1';

        let tapCount = 0;
        let tapResetTimer = null;

        versionTextEl.addEventListener('click', (e) => {
            e.stopPropagation();
            tapCount += 1;
            if (tapResetTimer) clearTimeout(tapResetTimer);
            tapResetTimer = setTimeout(() => {
                tapCount = 0;
                tapResetTimer = null;
            }, PRIVATE_UNLOCK_WINDOW_MS);

            if (tapCount >= PRIVATE_UNLOCK_TAP_TARGET) {
                tapCount = 0;
                if (tapResetTimer) {
                    clearTimeout(tapResetTimer);
                    tapResetTimer = null;
                }
                openPrivateRadioSettingsModal();
            }
        });
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
            resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: false, releaseMic: true });
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

    // 啟動掛載（僅啟動輕量接收輪詢，嚴禁預開麥克風）
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
