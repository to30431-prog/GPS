// ==========================================
// [Module 13] src/fleet-radio-ptt.js
// 獨立模組：內建網路無線電（車隊短語音 PTT 對講）
// 封裝麥克風壓縮錄音（最長 8 秒）、Firebase 即時廣播收發、音訊自動播放解鎖、Wake Lock 防休眠與僅限地圖主畫面半透明懸浮按鈕
// ==========================================

(function initFleetRadioPTTModule() {
    const STORAGE_KEY_ENABLED = 'yingge_fleet_radio_ptt_enabled_v1';
    const STORAGE_KEY_LAYOUT = 'yingge_fleet_radio_ptt_layout_v1';
    const STORAGE_KEY_CLIENT_ID = 'yingge_fleet_radio_client_id_v1';
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

    let isRecordingPtt = false;
    let isRecorderCapturing = false;
    let isUploadingPtt = false;
    let uploadingStartedAt = 0;
    let recordingSessionId = 0;
    let activeMediaRecorder = null;
    let warmMediaStream = null;
    let isWarmingMicStream = false;
    let recordedChunks = [];
    let recordStartAt = 0;
    let recordTickTimer = null;
    let recordMaxTimer = null;
    let activePointerId = null;
    let cancelUploadFlag = false;

    let pollTimer = null;
    let isPollingMeta = false;
    let pollingStartedAt = 0;
    let lastCloudCleanupAt = 0;
    const handledMessageIds = new Map(); // msgId -> handledAtMs（防重複觸發且避免單筆覆寫漏收）
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

    function getRadioCloudBaseUrl() {
        const base = (typeof FIREBASE_BASE_URL === 'string' && FIREBASE_BASE_URL)
            ? FIREBASE_BASE_URL
            : 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app';
        return `${base}/system_config/fleet_radio`;
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

    function hasHandledMessage(msgId) {
        return Boolean(msgId && handledMessageIds.has(msgId));
    }

    function markMessageHandled(msgId) {
        if (!msgId) return;
        handledMessageIds.set(msgId, Date.now());
        if (handledMessageIds.size > MAX_DEDUP_CACHE_SIZE) {
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

    // 🔓 瀏覽器音訊自動播放解鎖（於首次使用者互動時預熱 AudioContext 與共用 Audio 元素，並自動補播先前被阻擋的語音）
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
        if (!isAudioUnlocked && sharedAudioEl && !isPlayingAudio) {
            try {
                // 極短無聲 WAV 解鎖 iOS/Android 自動播放權限（嚴禁在語音播放中覆寫 src）
                sharedAudioEl.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
                sharedAudioEl.volume = 0.01;
                const p = sharedAudioEl.play();
                if (p && typeof p.then === 'function') {
                    p.then(() => {
                        if (!isPlayingAudio) {
                            sharedAudioEl.pause();
                            sharedAudioEl.currentTime = 0;
                            sharedAudioEl.volume = 1.0;
                        }
                        isAudioUnlocked = true;
                        flushPendingAutoplayItem();
                    }).catch(() => {});
                }
            } catch (e) {}
        } else if (isAudioUnlocked) {
            flushPendingAutoplayItem();
        }
    }

    function flushPendingAutoplayItem() {
        if (!pendingAutoplayRetryItem || isPlayingAudio || isRecordingPtt || !isRadioEnabled) return;
        const item = pendingAutoplayRetryItem;
        pendingAutoplayRetryItem = null;
        if ((Date.now() - (item.receivedAt || 0)) <= MAX_PLAYBACK_AGE_MS) {
            playbackQueue.unshift(item);
            processPlaybackQueue();
        }
    }

    // 🔔 極短清脆無線電提示音（開始收音：高音短嗶；結束送出：低音確認嗶）
    function playPttCueTone(kind = 'start') {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            if (!unlockAudioCtx) unlockAudioCtx = new AudioCtx();
            if (unlockAudioCtx.state === 'suspended') {
                unlockAudioCtx.resume().catch(() => {});
            }
            if (unlockAudioCtx.state !== 'running') return;
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
            osc.start(now);
            osc.stop(now + 0.085);
        } catch (e) {}
    }

    // 🎚️ 與 BGM 播放器協調音訊焦點（對講錄音或播放期間平滑壓低 BGM，結束後自動恢復，不卡死音訊通道）
    function syncAudioFocusWithBgm() {
        const shouldDuck = Boolean(isRecordingPtt || isPlayingAudio);
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

    ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(evtName => {
        window.addEventListener(evtName, function onInteractUnlock() {
            unlockBrowserAudio();
            if (isRadioEnabled && !isMediaStreamAlive(warmMediaStream)) {
                tryPrewarmGrantedMicStream();
            }
            if (isAudioUnlocked && !pendingAutoplayRetryItem && isMediaStreamAlive(warmMediaStream)) {
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

    function recoverStuckNetworkFlags() {
        const now = Date.now();
        if (isPollingMeta && pollingStartedAt > 0 && (now - pollingStartedAt) > POLL_STUCK_TIMEOUT_MS) {
            isPollingMeta = false;
            pollingStartedAt = 0;
        }
        if (isUploadingPtt && uploadingStartedAt > 0 && (now - uploadingStartedAt) > UPLOAD_STUCK_TIMEOUT_MS) {
            isUploadingPtt = false;
            uploadingStartedAt = 0;
            updatePttButtonVisual('idle');
            if (!isPlayingAudio && !isRecordingPtt) releaseRadioWakeLock();
        }
    }

    function ensureRadioConnectionActive() {
        if (!isRadioEnabled) return;
        recoverStuckNetworkFlags();
        if (pollTimer === null) {
            startRadioPolling();
        } else {
            pollLatestRadioMeta(false);
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // 切至背景時安全中止進行中的發話與手勢，但保留已暖機的麥克風串流（由系統自行管理，切回前景若失效再自動重建）
            resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: false });
            return;
        }
        if (document.visibilityState === 'visible' && isRadioEnabled) {
            unlockBrowserAudio();
            if (isRecordingPtt || isPlayingAudio) {
                requestRadioWakeLock();
            }
            ensureRadioConnectionActive();
            if (!isMediaStreamAlive(warmMediaStream)) {
                tryPrewarmGrantedMicStream();
            }
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
            resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: false, releaseMic: false });
            flashRadioToast('⚠️ 網路中斷，已取消本次對講錄音', 'error', 2200);
        } else {
            resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: false });
        }
    });

    window.addEventListener('blur', () => {
        resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: false });
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

    function syncPttButtonVisibility() {
        if (!pttBtnEl) return;
        const shouldShow = isRadioEnabled && isOnMapMainScreen();
        pttBtnEl.classList.toggle('hidden', !shouldShow);
        if (!shouldShow && (isRecordingPtt || gestureMode !== 'idle' || activePointers.size > 0)) {
            resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: false });
        }
    }

    function isMediaStreamAlive(stream) {
        if (!stream || !stream.active) return false;
        const tracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
        return tracks.length > 0 && tracks.some(track => track.readyState === 'live');
    }

    function releaseWarmMicStream() {
        if (warmMediaStream) {
            try {
                warmMediaStream.getTracks().forEach(track => {
                    try { track.onended = null; track.onmute = null; track.onunmute = null; } catch (_) {}
                    try { track.stop(); } catch (_) {}
                });
            } catch (e) {}
            warmMediaStream = null;
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

    // 🎙️ 麥克風串流暖機複用池：授權後常駐暖機，僅於頁面關閉或手動停用對講時釋放；若系統休眠導致失效則自動重建
    async function acquireMicStream() {
        if (isMediaStreamAlive(warmMediaStream)) {
            try {
                warmMediaStream.getAudioTracks().forEach(track => {
                    track.enabled = true;
                });
            } catch (e) {}
            return warmMediaStream;
        }

        releaseWarmMicStream();
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
                if (warmMediaStream === stream) {
                    warmMediaStream = null;
                }
                if (isRecordingPtt) {
                    resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: false, releaseMic: true });
                    flashRadioToast('⚠️ 麥克風訊號中斷，已安全停止對講', 'error', 2400);
                }
            };
        });

        warmMediaStream = stream;
        return stream;
    }

    // 若使用者先前已授予麥克風權限，於互動／啟動時靜默預熱串流（不主動彈出權限視窗）
    async function tryPrewarmGrantedMicStream() {
        if (!isRadioEnabled || isWarmingMicStream || isMediaStreamAlive(warmMediaStream)) return;
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') return;
        if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return;
        isWarmingMicStream = true;
        try {
            const status = await navigator.permissions.query({ name: 'microphone' });
            if (status && status.state === 'granted' && isRadioEnabled && !isMediaStreamAlive(warmMediaStream)) {
                await acquireMicStream();
            }
        } catch (e) {
            // 部分瀏覽器不支援 permissions.query('microphone')，改由首次按住 PTT 時取得並常駐暖機
        } finally {
            isWarmingMicStream = false;
        }
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

    function cleanupRecorderState(releaseMicNow = false) {
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
        isRecorderCapturing = false;
        if (releaseMicNow || !isRadioEnabled) {
            releaseWarmMicStream();
        }
    }

    // 🛡️ 統一手勢與 PTT 發話狀態重置（確保異常中斷後絕不殘留發話或拖曳旗標）
    function resetAllPttGestureAndRecordingState({ cancelRecording = true, persistLayout = false, releaseMic = false } = {}) {
        if (persistLayout && isManipulatingPttLayout()) {
            savePttLayout();
        }
        activePointers.clear();
        gestureMode = 'idle';
        activePointerId = null;
        dragPointerId = null;
        handlePointerId = null;

        if (isRecordingPtt) {
            stopPttRecording(cancelRecording);
        } else {
            cleanupRecorderState(releaseMic);
        }

        if (releaseMic) {
            releaseWarmMicStream();
        }

        updatePttButtonVisual(isUploadingPtt ? 'uploading' : 'idle');
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

    // ☁️ 上傳語音廣播至 Firebase（先寫 audio.json 再寫 meta.json，嚴格確認兩筆皆寫入成功後才顯示「已發送」）
    async function uploadVoiceBroadcast(blob, durationMs, mimeType) {
        if (!navigator.onLine) {
            updatePttButtonVisual('idle');
            flashRadioToast('⚠️ 目前離線，無法發送對講語音', 'error', 2400);
            return;
        }
        isUploadingPtt = true;
        uploadingStartedAt = Date.now();
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
            markMessageHandled(msgId);
            playPttCueTone('end');
            flashRadioToast(`📡 已發送語音廣播（${(durationMs / 1000).toFixed(1)} 秒）`, 'sent', 1800);
        } catch (err) {
            flashRadioToast(`⚠️ 語音廣播傳送失敗：${err?.message || '網路異常'}`, 'error', 2800);
        } finally {
            isUploadingPtt = false;
            uploadingStartedAt = 0;
            updatePttButtonVisual('idle');
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

    // 🎙️ 開始按住錄音（確認 MediaRecorder 真正啟動收音後才發出提示音與紅燈「請說話」，消除起音截斷）
    async function startPttRecording() {
        recoverStuckNetworkFlags();
        if (!isRadioEnabled || isRecordingPtt || isUploadingPtt || isRestrictedByGate()) return;
        if (!navigator.onLine) {
            flashRadioToast('⚠️ 目前離線，無法發送對講語音', 'error', 2000);
            gestureMode = 'idle';
            activePointers.clear();
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
            return;
        }

        const mySessionId = ++recordingSessionId;
        isRecordingPtt = true;
        isRecorderCapturing = false;
        cancelUploadFlag = false;
        recordedChunks.length = 0;
        recordStartAt = Date.now();
        updatePttButtonVisual('preparing', '準備中');
        syncAudioFocusWithBgm();
        requestRadioWakeLock();

        try {
            const stream = await acquireMicStream();

            // 若使用者在取得麥克風權限前就已經放開、取消或切換為拖曳／縮放，立即安全中止
            if (!isRecordingPtt || mySessionId !== recordingSessionId) {
                cleanupRecorderState(false);
                updatePttButtonVisual('idle');
                syncAudioFocusWithBgm();
                return;
            }

            const mimeType = pickSupportedAudioMimeType();
            const recorderOpts = mimeType
                ? { mimeType, audioBitsPerSecond: RECORDER_AUDIO_BPS }
                : { audioBitsPerSecond: RECORDER_AUDIO_BPS };

            const recorder = new MediaRecorder(stream, recorderOpts);
            activeMediaRecorder = recorder;

            recorder.onstart = () => {
                if (!isRecordingPtt || mySessionId !== recordingSessionId) return;
                isRecorderCapturing = true;
                recordStartAt = Date.now();
                updatePttButtonVisual('recording', '請說話');
                playPttCueTone('start');
                try { navigator.vibrate?.(30); } catch (e) {}

                recordTickTimer = setInterval(() => {
                    if (!isRecordingPtt || mySessionId !== recordingSessionId) return;
                    const elapsed = (Date.now() - recordStartAt) / 1000;
                    const sec = Math.min(MAX_RECORD_MS / 1000, elapsed);
                    updatePttButtonVisual('recording', elapsed < 0.35 ? '請說話' : `${sec.toFixed(1)}s`);
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
                cleanupRecorderState(true);
                isRecordingPtt = false;
                gestureMode = 'idle';
                activePointers.clear();
                updatePttButtonVisual('idle');
                syncAudioFocusWithBgm();
                if (!isPlayingAudio) releaseRadioWakeLock();
                flashRadioToast('⚠️ 錄音裝置異常，已自動重設請重試', 'error', 2400);
            };

            recorder.onstop = () => {
                const durationMs = isRecorderCapturing ? (Date.now() - recordStartAt) : 0;
                const finalChunks = recordedChunks.slice();
                const finalMime = recorder.mimeType || mimeType || 'audio/webm';
                const shouldSkip = cancelUploadFlag || mySessionId !== recordingSessionId;

                cleanupRecorderState(false);
                isRecordingPtt = false;
                syncAudioFocusWithBgm();

                if (shouldSkip) {
                    updatePttButtonVisual('idle');
                    if (!isPlayingAudio) releaseRadioWakeLock();
                    if (!isPlayingAudio && playbackQueue.length > 0) processPlaybackQueue();
                    return;
                }

                if (durationMs < MIN_RECORD_MS || finalChunks.length === 0) {
                    updatePttButtonVisual('idle');
                    flashRadioToast('⏱️ 按住時間過短，請聽到提示音後說話', 'error', 1600);
                    if (!isPlayingAudio) releaseRadioWakeLock();
                    if (!isPlayingAudio && playbackQueue.length > 0) processPlaybackQueue();
                    return;
                }

                const audioBlob = new Blob(finalChunks, { type: finalMime });
                finalChunks.length = 0;
                uploadVoiceBroadcast(audioBlob, Math.min(durationMs, MAX_RECORD_MS), finalMime);
            };

            // 使用 150ms 短取樣間隔，確保開頭語音即時寫入 chunk 不漏字
            recorder.start(RECORDER_TIMESLICE_MS);
        } catch (err) {
            cleanupRecorderState(true);
            isRecordingPtt = false;
            gestureMode = 'idle';
            activePointers.clear();
            updatePttButtonVisual('idle');
            syncAudioFocusWithBgm();
            if (!isPlayingAudio) releaseRadioWakeLock();
            flashRadioToast(describeMicError(err), 'error', 2600);
        }
    }

    function stopPttRecording(cancelWithoutSending = false) {
        if (!isRecordingPtt) return;
        cancelUploadFlag = Boolean(cancelWithoutSending);
        isRecordingPtt = false;
        activePointerId = null;
        if (cancelWithoutSending) {
            recordingSessionId += 1;
        }

        if (activeMediaRecorder && activeMediaRecorder.state !== 'inactive') {
            try {
                activeMediaRecorder.stop();
            } catch (e) {
                cleanupRecorderState(true);
                updatePttButtonVisual('idle');
                syncAudioFocusWithBgm();
            }
        } else {
            cleanupRecorderState(false);
            updatePttButtonVisual('idle');
            syncAudioFocusWithBgm();
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
        showRadioToast(`🔊 正在播放：${item.senderName}`, 'playing');

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

    // 🧹 自動清理過期雲端語音節點（超過 60 秒即清除大型 audio.json，維持長期通話同步高速輕量）
    async function cleanupExpiredCloudAudioIfNeeded(meta) {
        if (!meta || meta.audioCleared === true || !navigator.onLine) return;
        const now = Date.now();
        if ((now - lastCloudCleanupAt) < CLOUD_CLEANUP_COOLDOWN_MS) return;
        const createdAt = Number(meta.createdAt || 0);
        if (!createdAt || (now - createdAt) < EXPIRED_CLOUD_CLEANUP_MS) return;

        lastCloudCleanupAt = now;
        try {
            const audioUrl = `${getRadioCloudBaseUrl()}/audio.json`;
            const metaUrl = `${getRadioCloudBaseUrl()}/meta.json`;
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

    // 📡 輪詢 Firebase meta.json（容錯欄位解析、時鐘誤差容忍、音訊拉取成功後才標記已讀避免漏收）
    async function pollLatestRadioMeta(isInitialSeed = false) {
        recoverStuckNetworkFlags();
        if (!isRadioEnabled || !navigator.onLine || isPollingMeta || isRestrictedByGate()) return;
        isPollingMeta = true;
        pollingStartedAt = Date.now();
        try {
            const metaUrl = `${getRadioCloudBaseUrl()}/meta.json`;
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
                cleanupExpiredCloudAudioIfNeeded(meta);
            }

            // 剛開啟 App 或開啟無線電時，若訊息已過期或為本機舊訊則直接標記已讀不播放
            if (isInitialSeed) {
                if (isExpired || isFromSelf || meta.audioCleared === true) {
                    markMessageHandled(msgId);
                    return;
                }
            }

            if (hasHandledMessage(msgId)) return;

            // 排除發送者本機重複播放、已清理節點或過期舊訊
            if (isFromSelf || isExpired || meta.audioCleared === true) {
                markMessageHandled(msgId);
                return;
            }

            // 拉取對應音訊檔（成功取得並入列後才 markMessageHandled，避免瞬斷永久漏收）
            const audioUrl = `${getRadioCloudBaseUrl()}/audio.json`;
            const audioRes = (typeof fetchWithTimeout === 'function')
                ? await fetchWithTimeout(audioUrl, { cache: 'no-store' }, 6000)
                : await fetch(audioUrl, { cache: 'no-store' });
            if (!audioRes.ok) return;
            const audioPayload = await audioRes.json();
            if (!audioPayload || typeof audioPayload !== 'object' || !audioPayload.dataUrl) return;
            if (audioPayload.id && meta.id && audioPayload.id !== meta.id) return;

            markMessageHandled(msgId);

            // 再次確認下載完後仍未超過過期緩衝
            if ((Date.now() - createdAt) > (MAX_PLAYBACK_AGE_MS + 10000)) return;

            playbackQueue.push({
                id: msgId,
                senderName: String(meta.senderName || '車隊隊員').trim() || '車隊隊員',
                durationMs: Number(meta.durationMs || MAX_RECORD_MS),
                mimeType: String(audioPayload.mimeType || meta.mimeType || 'audio/webm'),
                dataUrl: audioPayload.dataUrl
            });
            processPlaybackQueue();
        } catch (e) {
            // 弱訊號或逾時靜默略過，下次輪詢自動重試
        } finally {
            isPollingMeta = false;
            pollingStartedAt = 0;
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
        clearPlaybackWatchdog();
        playbackQueue = [];
        pendingAutoplayRetryItem = null;
        resetSharedAudioElement();
        isPlayingAudio = false;
        isPollingMeta = false;
        pollingStartedAt = 0;
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

        loadSavedPttLayout();
        applyPttLayout();
        updatePttButtonVisual('idle');

        pttBtnEl.addEventListener('contextmenu', (e) => e.preventDefault());

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
        // - 單指原地按住（位移 <= 10px）：維持原 PTT 按住說話、放開廣播
        // - 單指拖曳超過 10px：立即安全取消 PTT 並切換為自由拖動位置模式
        // - 雙指捏合：立即安全取消 PTT 並以中心點自由縮放（1.0x～4.0x）
        pttBtnEl.addEventListener('pointerdown', (e) => {
            if (e.target === pttResizeHandleEl) return;
            if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
            e.preventDefault();
            e.stopPropagation();

            activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            try { pttBtnEl.setPointerCapture(e.pointerId); } catch (_) {}

            if (activePointers.size >= 2) {
                // 進入雙指縮放前，若已啟動 PTT 立即安全取消且不發送
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

            // 單指按下：先保留完整 PTT 即時手感，並記錄起始座標供 10px 防抖判定
            gestureMode = 'ptt';
            activePointerId = e.pointerId;
            dragPointerId = e.pointerId;
            dragStartPointerX = e.clientX;
            dragStartPointerY = e.clientY;
            dragStartLeft = pttPosLeft;
            dragStartTop = pttPosTop;
            startPttRecording();
        });

        pttBtnEl.addEventListener('pointermove', (e) => {
            if (!activePointers.has(e.pointerId)) return;
            e.preventDefault();
            e.stopPropagation();
            activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

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
                const dx = e.clientX - dragStartPointerX;
                const dy = e.clientY - dragStartPointerY;
                if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
                    // 超過防抖門檻：安全取消 PTT 廣播並切換為自由拖曳
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
            if (e && activePointers.has(e.pointerId)) {
                activePointers.delete(e.pointerId);
            }
            if (e) {
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
                if (!e || e.pointerId === dragPointerId || activePointers.size === 0) {
                    gestureMode = 'idle';
                    dragPointerId = null;
                    activePointerId = null;
                    activePointers.clear();
                    if (isRecordingPtt) {
                        stopPttRecording(false);
                    } else {
                        updatePttButtonVisual(isUploadingPtt ? 'uploading' : 'idle');
                        syncAudioFocusWithBgm();
                    }
                }
            }
        };

        pttBtnEl.addEventListener('pointerup', handlePointerRelease);
        pttBtnEl.addEventListener('pointercancel', (e) => {
            e.stopPropagation();
            if (gestureMode === 'ptt') {
                // pointercancel（例如系統手勢或來電中斷）時安全結束發話並徹底重置所有手勢旗標
                resetAllPttGestureAndRecordingState({ cancelRecording: false, persistLayout: false, releaseMic: false });
                return;
            }
            resetAllPttGestureAndRecordingState({ cancelRecording: true, persistLayout: true, releaseMic: false });
        });
        pttBtnEl.addEventListener('lostpointercapture', (e) => {
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
    }

    function setRadioEnabled(enabled) {
        isRadioEnabled = Boolean(enabled);
        try {
            localStorage.setItem(STORAGE_KEY_ENABLED, isRadioEnabled ? 'true' : 'false');
        } catch (e) {}

        if (isRadioEnabled) {
            unlockBrowserAudio();
            tryPrewarmGrantedMicStream();
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

    // 啟動掛載
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            mountFleetRadioUI();
            if (isRadioEnabled) {
                tryPrewarmGrantedMicStream();
                startRadioPolling();
            }
        });
    } else {
        mountFleetRadioUI();
        if (isRadioEnabled) {
            tryPrewarmGrantedMicStream();
            startRadioPolling();
        }
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
