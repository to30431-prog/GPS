// ==========================================
// 🔑 雲端路線庫管理員密碼與全域版本常數設定
// ==========================================
const APP_VERSION = 'v3.27';
window.APP_VERSION = APP_VERSION;
const ADMIN_PASSWORD = '5201314';

// 確保畫面上所有版本號膠囊同步顯示為 v3.27
const appVersionBadgeEl = document.getElementById('appVersionBadge');
if (appVersionBadgeEl) {
    appVersionBadgeEl.textContent = APP_VERSION;
}

// ==========================================
// 🛡️ 行車弱訊號防凍結保護：5 秒超時中斷 Fetch 封裝
// ==========================================
async function fetchWithTimeout(url, options = {}, timeoutMs = 5000, customAbortReason = '') {
    const controller = new AbortController();
    const timeoutSec = Math.max(1, Math.round(timeoutMs / 1000));
    const abortReason = customAbortReason || `連線逾時（超過 ${timeoutSec} 秒），請檢查網路狀態`;
    const timerId = setTimeout(() => {
        controller.abort(abortReason);
    }, timeoutMs);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        return response;
    } catch (err) {
        if (controller.signal.aborted) {
            const reason = controller.signal.reason;
            const msg = typeof reason === 'string' && reason.trim()
                ? reason.trim()
                : abortReason;
            const timeoutErr = new Error(msg);
            timeoutErr.name = 'AbortError';
            timeoutErr.isTimeout = true;
            throw timeoutErr;
        }
        throw err;
    } finally {
        clearTimeout(timerId);
    }
}

// 核心狀態變數
let idleWatchId = null;
let isFollowingCamera = true;
let isHeadingUpMode = true; 
let currentHeading = 0;
let lastKnownLngLat = [121.346, 24.954];
let isRecording = false, watchId = null, wakeLock = null;
let followWatchId = null; 
let musicActive = false;
let routePoints = [], musicEvents = []; 
let totalDistanceKm = 0, startTime = 0, elapsedSec = 0, timerInterval = null;
let gpsFreqMs = 2000, minMoveMeters = 2, lastRecordTime = 0;
let isBlackScreenActive = false, isScreenAutoWoken = false, sleepTimer = null;
let lastRouteLayerRenderTime = 0;

// ==========================================
// ⚙️ v3.1 動態導航與車隊系統參數（與 Firebase system_config 雙向即時同步，讀取不到時自動套用預設值）
// ==========================================
const ALLOWED_AI_DISPATCH_MODELS = ['gemini-3.6-flash', 'gemini-4-hydrogen'];

const DEFAULT_SYSTEM_CONFIG = {
    radarIntervalSec: 5,
    lookAheadDistMeters: 100,
    confirmDistMeters: 45,
    bearingToleranceDeg: 30,
    voiceRate: 1.1,
    lowSpeedZoom: 17.5,
    highSpeedZoom: 14.5,
    enableDynamicZoom: true,
    showOnlineFleetList: true,
    showFleetSleepStatus: true,
    fleetSleepMaxMinutes: 3,
    maxAccuracyMeters: 45,
    maxSpeedKmh: 160,
    minLockSpeedKmh: 4,
    announcementText: '',
    aiDispatchModel: 'gemini-3.6-flash',
    aiApiKeys: [],
    activeAiKeyId: '',
    requireUserApproval: false,
    buildingManagerPassword: '666666'
};

function clampNum(val, min, max, fallback) {
    const n = Number(val);
    if (isNaN(n)) return fallback;
    return Math.min(Math.max(n, min), max);
}

function normalizeAiApiKeysArray(rawList) {
    if (!Array.isArray(rawList)) return [];
    const seenKeys = new Set();
    const result = [];
    rawList.forEach((item, idx) => {
        if (!item) return;
        const keyStr = typeof item === 'string'
            ? item.trim()
            : (typeof item.key === 'string' ? item.key.trim() : '');
        if (!keyStr || seenKeys.has(keyStr)) return;
        seenKeys.add(keyStr);
        result.push({
            id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `aikey_${Date.now()}_${idx}`,
            key: keyStr,
            note: typeof item.note === 'string' ? item.note.trim().slice(0, 25) : '',
            createdAt: Number(item.createdAt) || Date.now()
        });
    });
    return result;
}

function normalizeSystemConfig(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const aiModelRaw = typeof src.aiDispatchModel === 'string' ? src.aiDispatchModel.trim() : '';
    const aiDispatchModel = ALLOWED_AI_DISPATCH_MODELS.includes(aiModelRaw)
        ? aiModelRaw
        : DEFAULT_SYSTEM_CONFIG.aiDispatchModel;
    const aiApiKeys = normalizeAiApiKeysArray(src.aiApiKeys);
    let activeAiKeyId = typeof src.activeAiKeyId === 'string' ? src.activeAiKeyId.trim() : '';
    if (aiApiKeys.length > 0 && !aiApiKeys.some(k => k.id === activeAiKeyId)) {
        activeAiKeyId = aiApiKeys[0].id;
    } else if (aiApiKeys.length === 0) {
        activeAiKeyId = '';
    }

    const rawMgrPwd = typeof src.buildingManagerPassword === 'string' ? src.buildingManagerPassword.trim() : '';
    const buildingManagerPassword = rawMgrPwd || DEFAULT_SYSTEM_CONFIG.buildingManagerPassword;

    return {
        radarIntervalSec: clampNum(src.radarIntervalSec, 2, 120, DEFAULT_SYSTEM_CONFIG.radarIntervalSec),
        lookAheadDistMeters: clampNum(src.lookAheadDistMeters, 20, 600, DEFAULT_SYSTEM_CONFIG.lookAheadDistMeters),
        confirmDistMeters: clampNum(src.confirmDistMeters, 10, 200, DEFAULT_SYSTEM_CONFIG.confirmDistMeters),
        bearingToleranceDeg: clampNum(src.bearingToleranceDeg, 5, 180, DEFAULT_SYSTEM_CONFIG.bearingToleranceDeg),
        voiceRate: Number(clampNum(src.voiceRate, 0.8, 1.5, DEFAULT_SYSTEM_CONFIG.voiceRate).toFixed(2)),
        lowSpeedZoom: Number(clampNum(src.lowSpeedZoom, 12, 21, DEFAULT_SYSTEM_CONFIG.lowSpeedZoom).toFixed(2)),
        highSpeedZoom: Number(clampNum(src.highSpeedZoom, 10, 20, DEFAULT_SYSTEM_CONFIG.highSpeedZoom).toFixed(2)),
        enableDynamicZoom: typeof src.enableDynamicZoom === 'boolean' ? src.enableDynamicZoom : DEFAULT_SYSTEM_CONFIG.enableDynamicZoom,
        showOnlineFleetList: typeof src.showOnlineFleetList === 'boolean' ? src.showOnlineFleetList : DEFAULT_SYSTEM_CONFIG.showOnlineFleetList,
        showFleetSleepStatus: typeof src.showFleetSleepStatus === 'boolean' ? src.showFleetSleepStatus : DEFAULT_SYSTEM_CONFIG.showFleetSleepStatus,
        fleetSleepMaxMinutes: Math.round(clampNum(src.fleetSleepMaxMinutes, 0, 120, DEFAULT_SYSTEM_CONFIG.fleetSleepMaxMinutes)),
        maxAccuracyMeters: clampNum(src.maxAccuracyMeters, 5, 300, DEFAULT_SYSTEM_CONFIG.maxAccuracyMeters),
        maxSpeedKmh: clampNum(src.maxSpeedKmh, 30, 300, DEFAULT_SYSTEM_CONFIG.maxSpeedKmh),
        minLockSpeedKmh: Number(clampNum(src.minLockSpeedKmh, 0.5, 30, DEFAULT_SYSTEM_CONFIG.minLockSpeedKmh).toFixed(1)),
        announcementText: typeof src.announcementText === 'string' ? src.announcementText.trim() : DEFAULT_SYSTEM_CONFIG.announcementText,
        aiDispatchModel,
        aiApiKeys,
        activeAiKeyId,
        requireUserApproval: typeof src.requireUserApproval === 'boolean' ? src.requireUserApproval : DEFAULT_SYSTEM_CONFIG.requireUserApproval,
        buildingManagerPassword
    };
}

let systemNavConfig = { ...DEFAULT_SYSTEM_CONFIG };
try {
    const cachedCfg = localStorage.getItem('yingge_system_nav_config_v31');
    if (cachedCfg) {
        systemNavConfig = normalizeSystemConfig(JSON.parse(cachedCfg));
    }
} catch (e) {}

function renderFleetAnnouncementBanner(text) {
    const bannerEl = document.getElementById('fleetAnnouncementBanner');
    const textEl = document.getElementById('fleetAnnouncementText');
    if (!bannerEl || !textEl) return;
    const clean = typeof text === 'string' ? text.trim() : '';
    if (clean.length > 0) {
        textEl.textContent = clean;
        bannerEl.classList.remove('hidden');
    } else {
        textEl.textContent = '';
        bannerEl.classList.add('hidden');
    }
}
renderFleetAnnouncementBanner(systemNavConfig.announcementText);

// 確認系統列與背景維持純黑 #000000
function ensurePureBlackSystemBars() {
    let metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme) {
        metaTheme = document.createElement('meta');
        metaTheme.name = 'theme-color';
        document.head.appendChild(metaTheme);
    }
    metaTheme.setAttribute('content', '#000000');
    document.documentElement.style.backgroundColor = '#000000';
    if (document.body) document.body.style.backgroundColor = '#000000';
}
ensurePureBlackSystemBars();

// 判斷目前是否處於純黑省電遮罩蓋住畫面的狀態（暫停地圖畫面重繪，保留背景 GPS 與雷達上傳）
function isPowerSaveMapPaused() {
    return Boolean(isBlackScreenActive && !isScreenAutoWoken);
}

// 持續啟用螢幕喚醒鎖定（Wake Lock API）防止手機休眠斷網
async function requestScreenWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            if (wakeLock && !wakeLock.released) return;
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                wakeLock = null;
            });
        }
    } catch (e) {}
}

async function releaseScreenWakeLockIfIdle(forceRelease = false) {
    if (!forceRelease && (isBlackScreenActive || isRecording || followWatchId !== null)) return;
    try {
        if (wakeLock) {
            await wakeLock.release();
            wakeLock = null;
        }
    } catch (e) {
        wakeLock = null;
    }
}

// 徹底停用手機電子羅盤（deviceorientation / deviceorientationabsolute），防止駕駛室金屬磁場干擾
(function disableDeviceCompass() {
    const noopCompass = (e) => {
        if (e && typeof e.stopImmediatePropagation === 'function') {
            // 僅確保本應用絕不依賴電子羅盤更新車頭角
        }
    };
    window.removeEventListener('deviceorientation', noopCompass, true);
    window.removeEventListener('deviceorientationabsolute', noopCompass, true);
})();

// ==========================================
// 🛡️ GPS 防亂飄與雜訊過濾核心引擎
// 1. 剔除低精度飄移點（保留 accuracy <= 45m，超過 45m 直接捨棄）
// 2. 剔除衛星反射瞬移（換算時速放寬上限至 160 km/h，解決高速公路 100+ km/h 凍結問題）
// 3. 徹底停用電子羅盤：純以 GPS 前後有效座標計算真實移動方位角（Bearing）
// 4. 車速 < 4 km/h 或位移 < 5m 時鎖死最後角度，防止怠速或低速作業時畫面亂轉
// 5. 移動中輕量加權平滑（新座標 0.7 + 前一座標 0.3）
// ==========================================
let lastValidGpsLat = null;
let lastValidGpsLng = null;
let lastValidGpsTime = 0;
let lastRawGpsFixKey = '';
let lastRawGpsFixWallTime = 0;
let lastFilteredGpsResult = null;
let lastRealGpsHeading = 0;
let isReplaying = false;
window.isReplaying = false;

// 🛰️ iOS 前景喚醒與 12 秒定位看門狗（Watchdog）核心狀態
let lastGpsUpdateTime = 0;
window.lastGpsUpdateTime = 0;
let activeRecordingGpsHandler = null;
let activeFollowGpsHandler = null;
let lastGpsForceRestartAt = 0;
let gpsWatchdogTimer = null;

function markGpsUpdateReceived() {
    const now = Date.now();
    lastGpsUpdateTime = now;
    window.lastGpsUpdateTime = now;
}

function processFilteredGpsPosition(pos, options = {}) {
    if (!pos || !pos.coords) return null;
    const rawLat = Number(pos.coords.latitude);
    const rawLng = Number(pos.coords.longitude);
    if (isNaN(rawLat) || isNaN(rawLng)) return null;

    // 只要收到合法經緯度座標即更新看門狗時間戳記
    markGpsUpdateReceived();

    const accuracy = typeof pos.coords.accuracy === 'number' && !isNaN(pos.coords.accuracy)
        ? pos.coords.accuracy
        : 10;

    const maxAccuracyMeters = Number(systemNavConfig.maxAccuracyMeters) || DEFAULT_SYSTEM_CONFIG.maxAccuracyMeters;
    const maxSpeedKmh = Number(systemNavConfig.maxSpeedKmh) || DEFAULT_SYSTEM_CONFIG.maxSpeedKmh;
    const minLockSpeedKmh = Number(systemNavConfig.minLockSpeedKmh) || DEFAULT_SYSTEM_CONFIG.minLockSpeedKmh;
    const forceBaselineReset = Boolean(options && options.forceBaselineReset);

    // 1. 剔除低精度飄移點：一般情況保留 accuracy <= maxAccuracyMeters (預設 45m)；剛解鎖喚醒單次定位放寬至 90m 避免冷啟動被丟棄
    const effectiveMaxAcc = forceBaselineReset ? Math.max(maxAccuracyMeters, 90) : maxAccuracyMeters;
    if (accuracy > effectiveMaxAcc) {
        return null;
    }

    const now = Date.now();
    // 防止多個 watchPosition 監聽器在極短時間內收到同一筆硬體座標時重複計算造成誤判靜止
    const fixKey = `${rawLat.toFixed(6)},${rawLng.toFixed(6)}`;
    if (!forceBaselineReset && fixKey === lastRawGpsFixKey && (now - lastRawGpsFixWallTime) < 350 && lastFilteredGpsResult) {
        return lastFilteredGpsResult;
    }

    const rawSpeed = (typeof pos.coords.speed === 'number' && !isNaN(pos.coords.speed) && pos.coords.speed >= 0)
        ? pos.coords.speed
        : null;

    // 首次取得合格高精度定位，或從 iOS 背景休眠／超過 12 秒斷線後剛喚醒重抓：直接以最新真實座標對齊基準點（不混入舊座標 0.3 權重，亦不因休眠期間移動距離被時速上限誤殺）
    const isStaleGapReset = lastValidGpsTime > 0 && (now - lastValidGpsTime) > 12000;
    if (lastValidGpsLat === null || lastValidGpsLng === null || forceBaselineReset || isStaleGapReset) {
        if (lastValidGpsLat !== null && lastValidGpsLng !== null) {
            const wakeMoveMeters = getDistanceKm(lastValidGpsLng, lastValidGpsLat, rawLng, rawLat) * 1000;
            if (wakeMoveMeters >= 5) {
                lastRealGpsHeading = getBearing(lastValidGpsLng, lastValidGpsLat, rawLng, rawLat);
            }
        }
        const wasNullBaseline = (lastValidGpsLat === null || lastValidGpsLng === null);
        lastValidGpsLat = rawLat;
        lastValidGpsLng = rawLng;
        lastValidGpsTime = now;
        if (!isReplaying) {
            currentHeading = lastRealGpsHeading;
            lastKnownLngLat = [rawLng, rawLat];
        }
        const wakeSpdKmh = rawSpeed !== null ? Math.min(rawSpeed * 3.6, maxSpeedKmh) : 0;
        const firstRes = {
            lng: rawLng,
            lat: rawLat,
            heading: lastRealGpsHeading,
            speedKmh: wakeSpdKmh,
            accuracy,
            isStationary: false,
            isFirstFix: wasNullBaseline,
            isWakeupFix: forceBaselineReset || isStaleGapReset
        };
        lastRawGpsFixKey = fixKey;
        lastRawGpsFixWallTime = now;
        lastFilteredGpsResult = firstRes;
        lastRecordedSpeedKmh = wakeSpdKmh;
        return firstRes;
    }

    const distKm = getDistanceKm(lastValidGpsLng, lastValidGpsLat, rawLng, rawLat);
    const distMeters = distKm * 1000;
    const dtSec = Math.max(0.25, (now - lastValidGpsTime) / 1000);
    const impliedSpeedKmh = (distKm / dtSec) * 3600;

    // 2. 剔除衛星反射瞬移：時速過濾上限依動態設定 maxSpeedKmh (預設 160 km/h)
    if (distMeters >= 5 && impliedSpeedKmh > maxSpeedKmh) {
        return null;
    }

    // 計算目前真實車速（若硬體未回傳 speed 或回傳 0 但實際有顯著高速位移，採用座標推算時速）
    const hardwareSpeedKmh = rawSpeed !== null ? (rawSpeed * 3.6) : null;
    const effectiveSpeedKmh = (hardwareSpeedKmh !== null && (hardwareSpeedKmh >= 1 || distMeters < 5))
        ? hardwareSpeedKmh
        : Math.min(impliedSpeedKmh, maxSpeedKmh);

    // 3. 停車與低速防抖動鎖定：當車速 < minLockSpeedKmh (預設 4 km/h) 或位移 < 5m 時，鎖死最後真實車頭角度（lastRealGpsHeading）
    if (distMeters < 5 || effectiveSpeedKmh < minLockSpeedKmh) {
        if (!isReplaying) {
            lastKnownLngLat = [lastValidGpsLng, lastValidGpsLat];
        }
        const stationaryRes = {
            lng: lastValidGpsLng,
            lat: lastValidGpsLat,
            heading: lastRealGpsHeading,
            speedKmh: effectiveSpeedKmh < minLockSpeedKmh ? 0 : effectiveSpeedKmh,
            accuracy,
            isStationary: true,
            isFirstFix: false
        };
        lastRawGpsFixKey = fixKey;
        lastRawGpsFixWallTime = now;
        lastFilteredGpsResult = stationaryRes;
        lastRecordedSpeedKmh = stationaryRes.speedKmh;
        return stationaryRes;
    }

    // 4. 移動中輕量加權平滑：新座標佔 0.7、前一有效座標佔 0.3
    const smoothedLng = Number((rawLng * 0.7 + lastValidGpsLng * 0.3).toFixed(6));
    const smoothedLat = Number((rawLat * 0.7 + lastValidGpsLat * 0.3).toFixed(6));

    // 5. 純用 GPS 前後有效座標計算真實移動方位角（Bearing），徹底停用電子羅盤
    const realBearing = getBearing(lastValidGpsLng, lastValidGpsLat, smoothedLng, smoothedLat);
    lastRealGpsHeading = realBearing;

    lastValidGpsLng = smoothedLng;
    lastValidGpsLat = smoothedLat;
    lastValidGpsTime = now;

    // 重播期間嚴禁真實 GPS 覆寫重播中的車輛座標與車頭角
    if (!isReplaying) {
        currentHeading = realBearing;
        lastKnownLngLat = [smoothedLng, smoothedLat];
    }

    const movingSpeedKmh = Math.min(effectiveSpeedKmh, maxSpeedKmh);
    const movingRes = {
        lng: smoothedLng,
        lat: smoothedLat,
        heading: realBearing,
        speedKmh: movingSpeedKmh,
        accuracy,
        isStationary: false,
        isFirstFix: false
    };
    lastRawGpsFixKey = fixKey;
    lastRawGpsFixWallTime = now;
    lastFilteredGpsResult = movingRes;
    lastRecordedSpeedKmh = movingSpeedKmh;
    return movingRes;
}

function stopIdleGPS() {
    if (idleWatchId !== null) {
        navigator.geolocation.clearWatch(idleWatchId);
        idleWatchId = null;
    }
}

function handleIdleGpsPosition(pos) {
    markGpsUpdateReceived();
    const filtered = processFilteredGpsPosition(pos);
    if (!filtered) return; // 誤差 > 45m 或 > 160km/h 暴衝跳點直接捨棄

    if (typeof window.onFleetPositionUpdate === 'function') {
        window.onFleetPositionUpdate(filtered.lat, filtered.lng);
    }

    // 🛡️ 重播期間鎖定車輛控制權：當 isReplaying === true 時，嚴禁真實 GPS 更新黃色垃圾車 Marker 的座標與角度
    if (isReplaying) return;

    if (!isPowerSaveMapPaused()) {
        const acc = Math.round(filtered.accuracy);
        const accEl = document.getElementById('accuracyText');
        if (accEl) accEl.innerText = `± ${acc} m`;
        if (vehicleMarker) {
            smoothMoveVehicleMarker([filtered.lng, filtered.lat], filtered.heading, 750);
        }
        if ((!filtered.isStationary || filtered.isWakeupFix) && isFollowingCamera) {
            const targetZoom = getDynamicZoomBySpeed(filtered.speedKmh);
            map.easeTo({
                center: [filtered.lng, filtered.lat],
                zoom: targetZoom,
                bearing: isHeadingUpMode ? filtered.heading : map.getBearing(),
                offset: [0, 100],
                duration: 600
            });
        }
    }
}

function startIdleGPS() {
    stopIdleGPS();
    if (!('geolocation' in navigator)) return;
    if (lastGpsUpdateTime === 0) markGpsUpdateReceived();
    idleWatchId = navigator.geolocation.watchPosition(
        handleIdleGpsPosition,
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
}

let savedRoutes = [];
let selectedRouteIdx = -1;
let domMarkers = []; 

function generateRouteId() {
    return 'rt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

// 取得路線版本號（向下相容：舊路線若無 routeVersion 預設視為 1）
function getRouteVersion(r) {
    const v = parseInt(r?.routeVersion, 10);
    return (!isNaN(v) && v >= 1) ? v : 1;
}

// 取得路線更新時間戳（向下相容舊資料）
function getRouteUpdatedAt(r) {
    if (typeof r?.updatedAt === 'number' && !isNaN(r.updatedAt) && r.updatedAt > 0) {
        return r.updatedAt;
    }
    if (typeof r?.updatedAt === 'string' && r.updatedAt) {
        const parsed = new Date(r.updatedAt).getTime();
        if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    if (r?.uploadedAt) {
        const parsed = new Date(r.uploadedAt).getTime();
        if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    if (r?.createdAt) {
        const parsed = new Date(r.createdAt).getTime();
        if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    if (typeof r?.id === 'number' && !isNaN(r.id) && r.id > 0) {
        return r.id;
    }
    return Date.now();
}

function formatRouteUpdateTimeText(r) {
    if (r?.uploadedAtText) return r.uploadedAtText;
    const ts = getRouteUpdatedAt(r);
    try {
        return new Date(ts).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return r?.date || '未知時間';
    }
}

function normalizeRouteBaseName(name) {
    return String(name || '')
        .trim()
        .replace(/\s*[\(（]?[vV]\d+(\.\d+)?[\)）]?$/i, '')
        .trim()
        .toLowerCase();
}

function isSameRouteIdentity(routeA, routeB) {
    if (!routeA || !routeB) return false;
    if (Boolean(routeA.isPendingPreview) !== Boolean(routeB.isPendingPreview)) return false;

    const rIdA = String(routeA.routeId || '').trim();
    const rIdB = String(routeB.routeId || '').trim();
    if (rIdA && rIdB && rIdA === rIdB) return true;

    const idA = routeA.id !== undefined && routeA.id !== null ? String(routeA.id).trim() : '';
    const idB = routeB.id !== undefined && routeB.id !== null ? String(routeB.id).trim() : '';
    const origA = routeA.originId !== undefined && routeA.originId !== null ? String(routeA.originId).trim() : '';
    const origB = routeB.originId !== undefined && routeB.originId !== null ? String(routeB.originId).trim() : '';

    if (idA && idB && idA === idB) return true;
    if (origA && origB && origA === origB) return true;
    if (idA && origB && idA === origB) return true;
    if (origA && idB && origA === idB) return true;

    const nameA = String(routeA.name || '').trim().toLowerCase();
    const nameB = String(routeB.name || '').trim().toLowerCase();
    if (nameA && nameB && nameA === nameB) return true;

    const baseA = normalizeRouteBaseName(routeA.name);
    const baseB = normalizeRouteBaseName(routeB.name);
    if (baseA && baseB && baseA === baseB) return true;

    return false;
}

function pickPreferredRouteDuplicate(existingRoute, candidateRoute) {
    const verA = getRouteVersion(existingRoute);
    const verB = getRouteVersion(candidateRoute);
    const updA = getRouteUpdatedAt(existingRoute);
    const updB = getRouteUpdatedAt(candidateRoute);

    let winner = existingRoute;
    if (verB > verA) {
        winner = candidateRoute;
    } else if (verB === verA) {
        if (updB > updA) {
            winner = candidateRoute;
        } else if (updB === updA) {
            const evA = Array.isArray(existingRoute?.events) ? existingRoute.events.length : 0;
            const evB = Array.isArray(candidateRoute?.events) ? candidateRoute.events.length : 0;
            if (evB > evA) winner = candidateRoute;
        }
    }

    const cleanName = String(winner.name || existingRoute.name || '').trim().replace(/\s+[vV]\d+(\.\d+)?$/i, '').trim() || String(winner.name || existingRoute.name || '').trim();

    return {
        ...winner,
        id: existingRoute.id || winner.id || Date.now(),
        originId: existingRoute.originId || existingRoute.id || winner.originId || winner.id || Date.now(),
        routeId: winner.routeId || existingRoute.routeId || generateRouteId(),
        name: cleanName,
        routeVersion: Math.max(verA, verB),
        updatedAt: Math.max(updA, updB)
    };
}

function ensureRoutesHaveRouteId(routes) {
    if (!Array.isArray(routes)) return false;
    let mutated = false;
    routes.forEach((r, idx) => {
        if (!r) return;
        if (!r.routeId) {
            const seed = r.originId || r.id || (Date.now() + idx);
            r.routeId = 'rt_' + String(seed) + '_' + Math.random().toString(36).substring(2, 6);
            mutated = true;
        }
        const ver = getRouteVersion(r);
        if (r.routeVersion !== ver) {
            r.routeVersion = ver;
            mutated = true;
        }
        const upd = getRouteUpdatedAt(r);
        if (r.updatedAt !== upd) {
            r.updatedAt = upd;
            mutated = true;
        }
    });
    return mutated;
}

function persistSavedRoutesToStorage() {
    try {
        localStorage.setItem('yinggeCleanRoutes_v2', JSON.stringify(savedRoutes));
    } catch (e) {}
    const countEl = document.getElementById('historyCount');
    if (countEl) countEl.innerText = savedRoutes.length;
    return localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).catch(() => {});
}

// 🧹 自動去重過濾器：清除名稱與距離重複或同 ID／同名的重複路線，保留 routeVersion 較高或 updatedAt 較新的那一筆，並保留原排序位置與本機 id
function deduplicateSavedRoutes(persistIfChanged = true) {
    if (!Array.isArray(savedRoutes)) return false;
    let mutated = ensureRoutesHaveRouteId(savedRoutes);

    const uniqueRoutes = [];
    for (let i = 0; i < savedRoutes.length; i++) {
        const current = savedRoutes[i];
        if (!current || !current.name) {
            mutated = true;
            continue;
        }
        const curName = String(current.name || '').trim().toLowerCase();
        const curDist = String(current.distance || '0.00').trim();

        const matchIdx = uniqueRoutes.findIndex(existing => {
            if (Boolean(existing.isPendingPreview) !== Boolean(current.isPendingPreview)) return false;
            const exName = String(existing.name || '').trim().toLowerCase();
            const exDist = String(existing.distance || '0.00').trim();
            if (curName && exName && curName === exName && curDist === exDist) return true;
            return isSameRouteIdentity(existing, current);
        });

        if (matchIdx !== -1) {
            uniqueRoutes[matchIdx] = pickPreferredRouteDuplicate(uniqueRoutes[matchIdx], current);
            mutated = true;
        } else {
            uniqueRoutes.push(current);
        }
    }

    if (mutated) {
        savedRoutes.splice(0, savedRoutes.length, ...uniqueRoutes);
        if (persistIfChanged) {
            persistSavedRoutesToStorage();
        }
    } else {
        const countEl = document.getElementById('historyCount');
        if (countEl) countEl.innerText = savedRoutes.length;
    }
    return mutated;
}

// 🚀 自動搬家與讀取大容量資料庫（自動補發唯一 routeId、routeVersion、updatedAt、自動去重清理，並啟動背景雲端版本比對）
localforage.getItem('yinggeCleanRoutes_v2').then((value) => {
    const oldStorage = localStorage.getItem('yinggeCleanRoutes_v2');
    if (value && value.length > 0) {
        savedRoutes = value;
    } else if (oldStorage) {
        try {
            savedRoutes = JSON.parse(oldStorage) || [];
        } catch (e) {
            savedRoutes = [];
        }
    }
    if (! deduplicateSavedRoutes(true)) {
        persistSavedRoutesToStorage();
    }
    if (typeof checkCloudRouteUpdatesInBackground === 'function') {
        checkCloudRouteUpdatesInBackground(true);
    }
}).catch((err) => console.log("讀取路線失敗:", err));

// --- 1. 初始化 MapLibre GL 向量／圖磚旋轉地圖（預設採用 Google 地圖，支援 6 種免費免 Key 圖層隨時切換、localStorage 記憶偏好，向量圖層強制路名永遠水平 viewport） ---
const MAP_LAYER_STORAGE_KEY = 'selectedMapLayer';

function buildRasterMapStyle(tileUrl, layerTitle, attributionText = '© Google', maxZoom = 19) {
    const sourceDef = {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        attribution: attributionText
    };
    if (typeof maxZoom === 'number') {
        sourceDef.maxzoom = maxZoom;
    }
    return {
        version: 8,
        name: layerTitle,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
            'custom-raster-tiles': sourceDef
        },
        layers: [
            {
                id: 'custom-raster-base-layer',
                type: 'raster',
                source: 'custom-raster-tiles',
                minzoom: 0,
                maxzoom: 22
            }
        ]
    };
}

const MAP_LAYER_PRESETS = [
    {
        id: 'google_roadmap',
        name: 'Google 地圖（預設）',
        shortName: 'Google 地圖',
        desc: 'Google 標準街道地圖',
        icon: '🗺️',
        isVector: false,
        pureChineseOverride: false,
        getStyle: () => buildRasterMapStyle(
            'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
            'Google 地圖（預設）',
            '© Google',
            20
        )
    },
    {
        id: 'google_hybrid',
        name: 'Google 衛星混合',
        shortName: 'Google 衛星',
        desc: 'Google 衛星實景＋道路門牌標記',
        icon: '🛰️',
        isVector: false,
        pureChineseOverride: false,
        getStyle: () => buildRasterMapStyle(
            'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
            'Google 衛星混合',
            '© Google',
            20
        )
    },
    {
        id: 'nlsc_emap',
        name: '門牌詳細（國土測繪）',
        shortName: '門牌詳細',
        desc: '內政部國土測繪通用電子地圖',
        icon: '🏠',
        isVector: false,
        pureChineseOverride: false,
        getStyle: () => buildRasterMapStyle(
            'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',
            '門牌詳細（國土測繪）',
            '© 內政部國土測繪中心 NLSC',
            19
        )
    },
    {
        id: 'voyager',
        name: '清爽向量（路名轉正）',
        shortName: '清爽向量',
        desc: 'Carto Voyager 向量（路名永遠水平）',
        icon: '🌤️',
        isVector: true,
        pureChineseOverride: false,
        getStyle: () => 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
    },
    {
        id: 'positron',
        name: '極簡灰白（路名轉正）',
        shortName: '極簡灰白',
        desc: 'OpenFreeMap 極簡向量（路名永遠水平）',
        icon: '⚪',
        isVector: true,
        pureChineseOverride: true,
        getStyle: () => 'https://tiles.openfreemap.org/styles/positron'
    },
    {
        id: 'liberty',
        name: '標準立體（路名轉正）',
        shortName: '標準立體',
        desc: 'OpenFreeMap 立體向量（路名永遠水平）',
        icon: '🏙️',
        isVector: true,
        pureChineseOverride: true,
        getStyle: () => 'https://tiles.openfreemap.org/styles/liberty'
    }
];

function getSavedMapLayerPreset() {
    try {
        const savedId = localStorage.getItem(MAP_LAYER_STORAGE_KEY);
        if (savedId) {
            const found = MAP_LAYER_PRESETS.find(item => item.id === savedId);
            if (found) return found;
        }
    } catch (e) {}
    return MAP_LAYER_PRESETS[0]; // 未設定時一律預設載入 Google 地圖
}

let currentMapLayerPreset = getSavedMapLayerPreset();

const PURE_CHINESE_TEXT_FIELD = [
    'coalesce',
    ['get', 'name:zh-Hant'],
    ['get', 'name:zh'],
    ['get', 'name:nonlatin'],
    ['get', 'name']
];

// 記錄最後一次繪製的路線 GeoJSON 資料，確保切換任何底圖樣式 (map.setStyle) 後自動無縫重繪所有自訂路線圖層
let cachedBgRouteGeoJSON = { type: 'FeatureCollection', features: [] };
let cachedSilentRouteGeoJSON = { type: 'FeatureCollection', features: [] };
let cachedMusicRouteGeoJSON = { type: 'FeatureCollection', features: [] };
let cachedCalloutLinesGeoJSON = { type: 'FeatureCollection', features: [] };
let cachedFurnitureOwnRouteGeoJSON = { type: 'FeatureCollection', features: [] };
let cachedFurnitureManualDraftGeoJSON = { type: 'FeatureCollection', features: [] };

const map = new maplibregl.Map({
    container: 'map',
    style: currentMapLayerPreset.getStyle(),
    center: [121.346, 24.954],
    zoom: 16, bearing: 0, pitch: 0, dragRotate: true, touchZoomRotate: true
});

function updateMapMarkersZoomScale() {
    if (!map) return;
    const currentZoom = map.getZoom();
    const mapEl = map.getContainer();
    if (!mapEl) return;

    // 1. ⚠️ 警告膠囊、🎵 音樂開關與黃色引線備忘框：依 zoom 等比例縮小（下限 0.55 倍）
    const rawScale = Math.max(0.55, Math.min(1, Math.pow(1.25, currentZoom - 15.5)));
    mapEl.style.setProperty('--map-pin-scale', rawScale.toFixed(3));

    // 2. 🏢 社區大樓三段式隨 zoom 變形 (zoom < 14.2 遠景小圓點 / 14.2~15.6 中景 0.65x 水滴無標籤 / >= 15.6 近景完整顯示)
    let tierClass = 'zoom-tier-near';
    if (currentZoom < 14.2) {
        tierClass = 'zoom-tier-far';
    } else if (currentZoom < 15.6) {
        tierClass = 'zoom-tier-mid';
    }
    if (!mapEl.classList.contains(tierClass)) {
        mapEl.classList.remove('zoom-tier-far', 'zoom-tier-mid', 'zoom-tier-near');
        mapEl.classList.add(tierClass);
    }
}
map.on('zoom', updateMapMarkersZoomScale);
map.on('load', updateMapMarkersZoomScale);
updateMapMarkersZoomScale();

setTimeout(() => { map.resize(); updateMapMarkersZoomScale(); }, 500);
window.addEventListener('resize', () => map.resize());

const puckEl = document.createElement('div');
puckEl.className = 'nav-puck';
puckEl.innerHTML = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 100" style="width:100%; height:100%; transform: rotate(0deg);">
    <rect x="4" y="15" width="8" height="20" rx="3" fill="#1f2937"/>
    <rect x="48" y="15" width="8" height="20" rx="3" fill="#1f2937"/>
    <rect x="4" y="65" width="8" height="20" rx="3" fill="#1f2937"/>
    <rect x="48" y="65" width="8" height="20" rx="3" fill="#1f2937"/>
    <rect x="8" y="5" width="44" height="90" rx="10" fill="#facc15" stroke="#ca8a04" stroke-width="2"/>
    <path d="M 14 30 L 46 30 L 42 12 L 18 12 Z" fill="#1e293b"/>
    <rect x="22" y="6" width="16" height="3" rx="1.5" fill="#ef4444"/>
    <rect x="12" y="62" width="36" height="30" rx="4" fill="#eab308" stroke="#ca8a04" stroke-width="1.5"/>
    <rect x="14" y="85" width="32" height="6" fill="#ffffff"/>
    <polygon points="14,91 22,85 30,91" fill="#ef4444"/>
    <polygon points="30,91 38,85 46,91" fill="#3b82f6"/>
</svg>`;

let vehicleMarker = null;
let lastRecordedSpeedKmh = 0;

// ==========================================
// 🏎️ 車輛 Marker 補間動畫（requestAnimationFrame 平滑位移與轉向，消除一秒跳一格瞬移感）
// ==========================================
let vehicleAnimFrameId = null;
let vehicleVisualLngLat = [...lastKnownLngLat];
let vehicleVisualHeading = currentHeading;

function smoothMoveVehicleMarker(targetLngLat, targetHeading, durationMs = 750) {
    // 🛡️ 重播期間嚴禁真實 GPS 補間動畫介入移動黃色垃圾車 Marker
    if (isReplaying) {
        if (vehicleAnimFrameId !== null) {
            cancelAnimationFrame(vehicleAnimFrameId);
            vehicleAnimFrameId = null;
        }
        return;
    }
    if (!vehicleMarker || !Array.isArray(targetLngLat) || targetLngLat.length < 2) return;
    const endLng = Number(targetLngLat[0]);
    const endLat = Number(targetLngLat[1]);
    const endHeading = typeof targetHeading === 'number' && !isNaN(targetHeading) ? targetHeading : vehicleVisualHeading;

    if (vehicleAnimFrameId !== null) {
        cancelAnimationFrame(vehicleAnimFrameId);
        vehicleAnimFrameId = null;
    }

    const startLng = Number(vehicleVisualLngLat[0]);
    const startLat = Number(vehicleVisualLngLat[1]);
    const startHeading = Number(vehicleVisualHeading) || 0;
    const jumpMeters = getDistanceKm(startLng, startLat, endLng, endLat) * 1000;

    // 若初始定位跳距過大 (> 250m) 或 durationMs <= 0，直接瞬間對齊不補間
    if (durationMs <= 0 || isNaN(startLng) || isNaN(startLat) || jumpMeters > 250) {
        vehicleVisualLngLat = [endLng, endLat];
        vehicleVisualHeading = endHeading;
        vehicleMarker.setLngLat(vehicleVisualLngLat).setRotation(vehicleVisualHeading);
        return;
    }

    const deltaHeading = getAngleDiff(startHeading, endHeading);
    const startTimePerf = performance.now();

    function stepFrame(nowPerf) {
        if (isReplaying) {
            vehicleAnimFrameId = null;
            return;
        }
        const elapsed = nowPerf - startTimePerf;
        const t = Math.min(Math.max(elapsed / durationMs, 0), 1);
        const curLng = startLng + (endLng - startLng) * t;
        const curLat = startLat + (endLat - startLat) * t;
        const curHead = (startHeading + deltaHeading * t + 360) % 360;

        vehicleVisualLngLat = [curLng, curLat];
        vehicleVisualHeading = curHead;
        if (vehicleMarker) {
            vehicleMarker.setLngLat(vehicleVisualLngLat).setRotation(vehicleVisualHeading);
        }

        if (t < 1) {
            vehicleAnimFrameId = requestAnimationFrame(stepFrame);
        } else {
            vehicleAnimFrameId = null;
        }
    }

    vehicleAnimFrameId = requestAnimationFrame(stepFrame);
}

// ==========================================
// 🔍 車速動態縮放（Speed-based Dynamic Zoom，支援管理員動態設定）
// - 時速 > 60 km/h：平滑拉遠視野（預設 Zoom 14.5）
// - 時速 < 20 km/h：平滑放大視野（預設 Zoom 17.5）
// - 時速 20~60 km/h：線性平滑過渡
// - 若管理員關閉「車速動態縮放」，則維持當前地圖縮放倍率不自動變動
// ==========================================
function getDynamicZoomBySpeed(speedKmh) {
    const spd = typeof speedKmh === 'number' && !isNaN(speedKmh) ? Math.max(0, speedKmh) : 0;
    lastRecordedSpeedKmh = spd;

    const lowZoom = Number(systemNavConfig.lowSpeedZoom) || DEFAULT_SYSTEM_CONFIG.lowSpeedZoom;
    const highZoom = Number(systemNavConfig.highSpeedZoom) || DEFAULT_SYSTEM_CONFIG.highSpeedZoom;

    if (!systemNavConfig.enableDynamicZoom) {
        return map ? map.getZoom() : lowZoom;
    }

    if (spd >= 60) {
        return Number(highZoom.toFixed(2));
    }
    if (spd <= 20) {
        return Number(lowZoom.toFixed(2));
    }
    // 20 ~ 60 km/h：由 lowZoom 線性平滑過渡至 highZoom
    const midFactor = (spd - 20) / 40;
    return Number((lowZoom + (highZoom - lowZoom) * midFactor).toFixed(2));
}

// ==========================================
// 🛣️ 自訂路線圖層（保留「音樂開（綠色）／音樂關（藍色）／已行駛（半透明淺灰）」分段顏色與俐落外框邊線 line-casing）
// 支援在任何底圖切換 (map.setStyle) 後自動重建並無縫還原所有路線與標記資料
// ==========================================
function ensureCustomRouteSourcesAndLayers() {
    if (!map) return;
    try {
        const currentStyle = map.getStyle();
        if (!currentStyle) return;
    } catch (e) {
        return;
    }

    try {
        // 0. 在 OpenFreeMap (openmaptiles) 樣式上補齊放大時的門牌號碼圖層 (housenumber-label)
        if (map.getSource('openmaptiles') && !map.getLayer('housenumber-label')) {
            map.addLayer({
                id: 'housenumber-label',
                type: 'symbol',
                source: 'openmaptiles',
                'source-layer': 'housenumber',
                minzoom: 17,
                layout: {
                    'text-rotation-alignment': 'viewport',
                    'icon-rotation-alignment': 'viewport',
                    'text-pitch-alignment': 'viewport',
                    'icon-pitch-alignment': 'viewport',
                    'text-keep-upright': true,
                    'text-field': '{housenumber}',
                    'text-font': ['Noto Sans Regular'],
                    'text-size': 10.5,
                    'text-padding': 4
                },
                paint: {
                    'text-color': '#64748b',
                    'text-halo-color': 'rgba(255,255,255,0.95)',
                    'text-halo-width': 1.8
                }
            });
        }

        // 1. 已行駛路段（半透明淺灰色 + 柔和外框）
        if (!map.getSource('bg-route')) {
            map.addSource('bg-route', { type: 'geojson', data: cachedBgRouteGeoJSON || emptyGeoJSON() });
        }
        if (!map.getLayer('bg-route-casing')) {
            map.addLayer({
                id: 'bg-route-casing',
                type: 'line',
                source: 'bg-route',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 9,
                    'line-opacity': 0.5,
                    'line-blur': 0.5
                }
            });
        }
        if (!map.getLayer('bg-route-line')) {
            map.addLayer({
                id: 'bg-route-line',
                type: 'line',
                source: 'bg-route',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#94a3b8',
                    'line-width': 6,
                    'line-opacity': 0.45
                }
            });
        }

        // 2. 音樂關閉路段（藍色虛線 + 俐落外框邊線 line-casing）
        if (!map.getSource('route-Silent')) {
            map.addSource('route-Silent', { type: 'geojson', data: cachedSilentRouteGeoJSON || emptyGeoJSON() });
        }
        if (!map.getLayer('route-silent-casing')) {
            map.addLayer({
                id: 'route-silent-casing',
                type: 'line',
                source: 'route-Silent',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 9,
                    'line-opacity': 0.85,
                    'line-blur': 0.5
                }
            });
        }
        if (!map.getLayer('route-silent-line')) {
            map.addLayer({
                id: 'route-silent-line',
                type: 'line',
                source: 'route-Silent',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#3b82f6',
                    'line-width': 6,
                    'line-dasharray': [2, 2]
                }
            });
        }

        // 3. 音樂開啟清運路段（綠色實線 + 俐落外框邊線 line-casing）
        if (!map.getSource('route-music')) {
            map.addSource('route-music', { type: 'geojson', data: cachedMusicRouteGeoJSON || emptyGeoJSON() });
        }
        if (!map.getLayer('route-music-casing')) {
            map.addLayer({
                id: 'route-music-casing',
                type: 'line',
                source: 'route-music',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 10.5,
                    'line-opacity': 0.9,
                    'line-blur': 0.5
                }
            });
        }
        if (!map.getLayer('route-music-line')) {
            map.addLayer({
                id: 'route-music-line',
                type: 'line',
                source: 'route-music',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#16a34a',
                    'line-width': 7
                }
            });
        }

        // 4. 📌 引線備忘框高對比引線圖層（含白色外框與主題顏色引線）
        if (!map.getSource('callout-lines-source')) {
            map.addSource('callout-lines-source', {
                type: 'geojson',
                data: cachedCalloutLinesGeoJSON || emptyGeoJSON()
            });
        }
        if (!map.getLayer('callout-lines-casing')) {
            map.addLayer({
                id: 'callout-lines-casing',
                type: 'line',
                source: 'callout-lines-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 6.5,
                    'line-opacity': 0.92
                }
            });
        }
        if (!map.getLayer('callout-lines-layer')) {
            map.addLayer({
                id: 'callout-lines-layer',
                type: 'line',
                source: 'callout-lines-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': ['coalesce', ['get', 'color'], '#d97706'],
                    'line-width': 3.5,
                    'line-dasharray': [2, 1.2],
                    'line-opacity': 0.98
                }
            });
        }

        if (!map.getSource('freehand-temp-source')) {
            map.addSource('freehand-temp-source', {
                type: 'geojson',
                data: (typeof freehandDraftCoords !== 'undefined' && Array.isArray(freehandDraftCoords) && freehandDraftCoords.length >= 2)
                    ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: freehandDraftCoords } }] }
                    : emptyGeoJSON()
            });
        }
        if (!map.getLayer('freehand-temp-layer')) {
            map.addLayer({
                id: 'freehand-temp-layer',
                type: 'line',
                source: 'freehand-temp-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': '#f97316', 'line-width': 6, 'line-dasharray': [2, 1.5], 'line-opacity': 0.95 }
            });
        }

        if (!map.getSource('custom-route-symbols')) {
            map.addSource('custom-route-symbols', { type: 'geojson', data: emptyGeoJSON() });
        }
        if (!map.getLayer('custom-route-symbols-layer')) {
            map.addLayer({
                id: 'custom-route-symbols-layer',
                type: 'symbol',
                source: 'custom-route-symbols',
                layout: {
                    'text-rotation-alignment': 'viewport',
                    'icon-rotation-alignment': 'viewport',
                    'text-pitch-alignment': 'viewport',
                    'icon-pitch-alignment': 'viewport',
                    'text-keep-upright': true,
                    'text-field': ['get', 'label'],
                    'text-font': ['Noto Sans Regular'],
                    'text-size': 12,
                    'text-offset': [0, 1.2]
                },
                paint: {
                    'text-color': '#0f172a',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2
                }
            });
        }

        // 5. 🛋️ 家具模式專屬圖層（共用主路線＋手動拉線草稿）
        if (!map.getSource('furniture-own-route-source')) {
            map.addSource('furniture-own-route-source', {
                type: 'geojson',
                data: cachedFurnitureOwnRouteGeoJSON || emptyGeoJSON()
            });
        }
        if (!map.getLayer('furniture-own-route-casing')) {
            map.addLayer({
                id: 'furniture-own-route-casing',
                type: 'line',
                source: 'furniture-own-route-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 11,
                    'line-opacity': 0.92
                }
            });
        }
        if (!map.getLayer('furniture-own-route-line')) {
            map.addLayer({
                id: 'furniture-own-route-line',
                type: 'line',
                source: 'furniture-own-route-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': ['coalesce', ['get', 'color'], '#9333ea'],
                    'line-width': 7,
                    'line-opacity': 0.96
                }
            });
        }

        if (!map.getSource('furniture-manual-draft-source')) {
            map.addSource('furniture-manual-draft-source', {
                type: 'geojson',
                data: cachedFurnitureManualDraftGeoJSON || emptyGeoJSON()
            });
        }
        if (!map.getLayer('furniture-manual-draft-layer')) {
            map.addLayer({
                id: 'furniture-manual-draft-layer',
                type: 'line',
                source: 'furniture-manual-draft-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#f97316',
                    'line-width': 5.5,
                    'line-dasharray': [2, 1.2],
                    'line-opacity': 0.95
                }
            });
        }

        if (typeof activeDistanceGuidePin !== 'undefined' && activeDistanceGuidePin && typeof updatePinDistanceGuideRender === 'function') {
            updatePinDistanceGuideRender();
        }
    } catch (e) {
        console.warn('建立自訂路線圖層時發生例外:', e);
    }
}

// ==========================================
// 🗺️ 地圖路名、地名、地標文字與自訂符號圖層永遠與手機螢幕水平對齊 (viewport + text-keep-upright: true)
// ==========================================
function fixSymbolTextAlignment() {
    try {
        const style = map.getStyle();
        if (!style || !style.layers) return;
        const usePureChinese = Boolean(currentMapLayerPreset?.pureChineseOverride);

        style.layers.forEach(layer => {
            if (layer.type === 'symbol') {
                const lid = String(layer.id || '');

                if (usePureChinese && lid.includes('shield')) {
                    try {
                        map.setLayoutProperty(lid, 'visibility', 'none');
                    } catch (e) {}
                    return;
                }

                try {
                    map.setLayoutProperty(lid, 'text-rotation-alignment', 'viewport');
                    map.setLayoutProperty(lid, 'icon-rotation-alignment', 'viewport');
                    map.setLayoutProperty(lid, 'text-pitch-alignment', 'viewport');
                    map.setLayoutProperty(lid, 'icon-pitch-alignment', 'viewport');
                    map.setLayoutProperty(lid, 'text-keep-upright', true);
                } catch (e) {}

                if (
                    usePureChinese &&
                    lid !== 'custom-route-symbols-layer' &&
                    lid !== 'housenumber-label' &&
                    !lid.includes('one_way_arrow') &&
                    layer.layout &&
                    layer.layout['text-field']
                ) {
                    try {
                        map.setLayoutProperty(lid, 'text-field', PURE_CHINESE_TEXT_FIELD);
                    } catch (e) {}
                }
            }
        });
    } catch (e) {
        console.error("修正字體對齊時發生錯誤:", e);
    }
}

// 確保所有 DOM Marker（黃色垃圾車、橘黃色警示膠囊、起終點、隊友雷達）在底圖切換後完整保留且座標不偏移
function ensureDomMarkersIntactAfterStyleSwitch() {
    try {
        if (vehicleMarker) {
            const el = vehicleMarker.getElement();
            if (el && !el.isConnected) {
                vehicleMarker.addTo(map);
            }
            vehicleMarker.setLngLat(vehicleVisualLngLat || lastKnownLngLat).setRotation(vehicleVisualHeading || currentHeading);
        }
        if (typeof domMarkers !== 'undefined' && Array.isArray(domMarkers)) {
            domMarkers.forEach(m => {
                if (m && typeof m.getElement === 'function') {
                    const el = m.getElement();
                    if (el && !el.isConnected) m.addTo(map);
                    else if (typeof m.getLngLat === 'function') m.setLngLat(m.getLngLat());
                }
            });
        }
        if (typeof editNodeMarkers !== 'undefined' && Array.isArray(editNodeMarkers)) {
            editNodeMarkers.forEach(m => {
                if (m && typeof m.getElement === 'function') {
                    const el = m.getElement();
                    if (el && !el.isConnected) m.addTo(map);
                    else if (typeof m.getLngLat === 'function') m.setLngLat(m.getLngLat());
                }
            });
        }
        if (typeof manualDrawMarkers !== 'undefined' && Array.isArray(manualDrawMarkers)) {
            manualDrawMarkers.forEach(m => {
                if (m && typeof m.getElement === 'function') {
                    const el = m.getElement();
                    if (el && !el.isConnected) m.addTo(map);
                    else if (typeof m.getLngLat === 'function') m.setLngLat(m.getLngLat());
                }
            });
        }
        if (typeof furnitureDomMarkers !== 'undefined' && Array.isArray(furnitureDomMarkers)) {
            furnitureDomMarkers.forEach(m => {
                if (m && typeof m.getElement === 'function') {
                    const el = m.getElement();
                    if (el && !el.isConnected) m.addTo(map);
                    else if (typeof m.getLngLat === 'function') m.setLngLat(m.getLngLat());
                }
            });
        }
        if (typeof furnitureSearchPreviewMarker !== 'undefined' && furnitureSearchPreviewMarker) {
            const el = furnitureSearchPreviewMarker.getElement?.();
            if (el && !el.isConnected) furnitureSearchPreviewMarker.addTo(map);
        }
        if (typeof activeFurniturePopupMarker !== 'undefined' && activeFurniturePopupMarker) {
            const el = activeFurniturePopupMarker.getElement?.();
            if (el && !el.isConnected) activeFurniturePopupMarker.addTo(map);
        }
    } catch (e) {}
}

let isRestoringCustomStyleLayers = false;
function restoreCustomLayersAndAlignmentAfterStyleLoad() {
    if (isRestoringCustomStyleLayers) return;
    isRestoringCustomStyleLayers = true;
    try {
        ensureCustomRouteSourcesAndLayers();
        map.getSource('bg-route')?.setData(cachedBgRouteGeoJSON || emptyGeoJSON());
        map.getSource('route-Silent')?.setData(cachedSilentRouteGeoJSON || emptyGeoJSON());
        map.getSource('route-music')?.setData(cachedMusicRouteGeoJSON || emptyGeoJSON());
        map.getSource('callout-lines-source')?.setData(cachedCalloutLinesGeoJSON || emptyGeoJSON());
        map.getSource('furniture-own-route-source')?.setData(cachedFurnitureOwnRouteGeoJSON || emptyGeoJSON());
        map.getSource('furniture-manual-draft-source')?.setData(cachedFurnitureManualDraftGeoJSON || emptyGeoJSON());
        if (currentMapLayerPreset?.isVector) {
            fixSymbolTextAlignment();
        }
        ensureDomMarkersIntactAfterStyleSwitch();
        if (typeof renderAllFurnitureMapElements === 'function') {
            renderAllFurnitureMapElements();
        }
    } finally {
        isRestoringCustomStyleLayers = false;
    }
}

// ==========================================
// 🗺️ 右上角「圖層」切換面板渲染與切換邏輯（含 localStorage 記憶偏好）
// ==========================================
function renderMapLayerMenuOptions() {
    const listEl = document.getElementById('mapLayerOptionList');
    const badgeEl = document.getElementById('currentMapLayerBadge');
    if (badgeEl && currentMapLayerPreset) {
        badgeEl.textContent = currentMapLayerPreset.shortName;
    }
    if (!listEl) return;

    listEl.innerHTML = '';
    MAP_LAYER_PRESETS.forEach(preset => {
        const isSelected = (preset.id === currentMapLayerPreset?.id);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = isSelected
            ? 'w-full text-left px-3 py-2 rounded-xl bg-emerald-50 border-2 border-emerald-500 text-emerald-900 flex items-center justify-between gap-2 transition-all active:scale-95'
            : 'w-full text-left px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-800 flex items-center justify-between gap-2 transition-all active:scale-95';

        btn.innerHTML = `
            <div class="flex items-center gap-2.5 min-w-0">
                <span class="text-base flex-shrink-0">${preset.icon}</span>
                <div class="min-w-0">
                    <div class="text-xs font-black truncate ${isSelected ? 'text-emerald-800' : 'text-gray-800'}">${preset.name}</div>
                    <div class="text-[10px] font-bold truncate ${isSelected ? 'text-emerald-600' : 'text-gray-400'}">${preset.desc}</div>
                </div>
            </div>
            ${isSelected ? '<i class="fa-solid fa-circle-check text-emerald-600 text-sm flex-shrink-0"></i>' : ''}
        `;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            switchMapBaseLayer(preset.id);
            document.getElementById('mapLayerMenuPanel')?.classList.add('hidden');
        });
        listEl.appendChild(btn);
    });
}

function switchMapBaseLayer(layerId) {
    const targetPreset = MAP_LAYER_PRESETS.find(item => item.id === layerId);
    if (!targetPreset || !map) return;

    currentMapLayerPreset = targetPreset;
    try {
        localStorage.setItem(MAP_LAYER_STORAGE_KEY, targetPreset.id);
    } catch (e) {}

    renderMapLayerMenuOptions();

    // 切換底圖後，監聽 map.once('style.load') 自動重繪所有自訂路線圖層與文字水平設定
    map.once('style.load', () => {
        restoreCustomLayersAndAlignmentAfterStyleLoad();
    });

    try {
        map.setStyle(targetPreset.getStyle());
    } catch (e) {
        console.error('切換底圖圖層時發生錯誤:', e);
    }
}

(function initMapLayerSwitcherUI() {
    const switchBtn = document.getElementById('mapLayerSwitchBtn');
    const menuPanel = document.getElementById('mapLayerMenuPanel');
    const wrapper = document.getElementById('mapLayerSwitcherWrapper');

    renderMapLayerMenuOptions();

    if (switchBtn && menuPanel) {
        switchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            renderMapLayerMenuOptions();
            menuPanel.classList.toggle('hidden');
        });
    }

    // 點擊面板外部任意處自動關閉圖層選單
    document.addEventListener('pointerdown', (e) => {
        if (!menuPanel || menuPanel.classList.contains('hidden')) return;
        if (wrapper && !wrapper.contains(e.target)) {
            menuPanel.classList.add('hidden');
        }
    });
})();

map.on('load', () => {
    // 僅有黃色清運車輛 Marker (vehicleMarker) 保留 rotationAlignment: 'map' 隨車頭方位角旋轉
    vehicleMarker = new maplibregl.Marker({ element: puckEl, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(lastKnownLngLat).addTo(map);
    vehicleVisualLngLat = [...lastKnownLngLat];
    vehicleVisualHeading = currentHeading;

    restoreCustomLayersAndAlignmentAfterStyleLoad();

    startIdleGPS();
    navigator.geolocation?.getCurrentPosition(pos => {
        if (!isReplaying) {
            map.jumpTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 17 });
        }
    });
});

map.on('style.load', () => {
    restoreCustomLayersAndAlignmentAfterStyleLoad();
});

function emptyGeoJSON() { return { type: 'FeatureCollection', features: [] }; }

// --- 2. 視角操作 ---
['dragstart', 'touchstart', 'wheel', 'rotatestart', 'pitchstart'].forEach(evt => {
    map.on(evt, (e) => { if (e.originalEvent) setCameraFollow(false); });
});

function setCameraFollow(follow) {
    isFollowingCamera = follow;
    const btn = document.getElementById('locateBtn');
    const label = document.getElementById('followLabel');
    if (follow) {
        btn.className = "bg-white text-blue-600 w-11 h-11 rounded-2xl shadow-lg flex flex-col items-center justify-center active:scale-95 border-2 border-blue-500";
        label.innerText = "跟隨中";
    } else {
        btn.className = "bg-white text-gray-400 w-11 h-11 rounded-2xl shadow-lg flex flex-col items-center justify-center active:scale-95 border border-gray-200";
        label.innerText = "自由看";
    }
}

document.getElementById('locateBtn').onclick = () => {
    setCameraFollow(true);
    const resumeZoom = (followWatchId !== null || isRecording)
        ? getDynamicZoomBySpeed(lastRecordedSpeedKmh)
        : Math.max(map.getZoom(), 17);
    map.easeTo({
        center: lastKnownLngLat, zoom: resumeZoom,
        bearing: isHeadingUpMode ? currentHeading : 0, offset: [0, 100], duration: 400
    });
};

document.getElementById('headingModeBtn').onclick = () => {
    isHeadingUpMode = !isHeadingUpMode;
    const btn = document.getElementById('headingModeBtn');
    const label = document.getElementById('headingLabel');
    if (vehicleMarker) {
        vehicleMarker.setRotation(currentHeading);
    }
    if (isHeadingUpMode) {
        btn.className = "bg-blue-600 text-white w-11 h-11 rounded-2xl shadow-lg flex flex-col items-center justify-center active:scale-95";
        label.innerText = "車頭上";
        if (isFollowingCamera) map.easeTo({ bearing: currentHeading, duration: 300 });
    } else {
        btn.className = "bg-white text-gray-700 w-11 h-11 rounded-2xl shadow-lg flex flex-col items-center justify-center active:scale-95";
        label.innerText = "正北上";
        if (isFollowingCamera) map.easeTo({ bearing: 0, duration: 300 });
    }
};

// --- 3. 幾何數學計算 ---
function getDistanceKm(lng1, lat1, lng2, lat2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBearing(lng1, lat1, lng2, lat2) {
    const toRad = d => d * Math.PI / 180;
    const toDeg = r => r * 180 / Math.PI;
    const dLon = toRad(lng2 - lng1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function getAngleDiff(angle1, angle2) {
    let diff = (angle2 - angle1 + 180) % 360 - 180;
    return diff < -180 ? diff + 360 : diff;
}

// ==========================================
// 🔊 語音播報排隊管理器（FIFO Queue，防連續觸發切斷與 3 秒防重複鎖）
// ==========================================
let isVoiceEnabled = true;
window._activeSpeechUtterance = null;

const VoiceQueue = {
    queue: [],
    maxSize: 4,
    debounceMs: 3000,
    isSpeaking: false,
    recentHistory: new Map(),
    _watchdogTimer: null,

    enqueue(text) {
        if (!isVoiceEnabled || !('speechSynthesis' in window) || !text) return;
        const cleanText = String(text).trim();
        if (!cleanText) return;

        // 3 秒內相同文字防重複鎖（Debounce），避免 GPS 漂移重複播報同一句
        const now = Date.now();
        for (const [k, ts] of this.recentHistory.entries()) {
            if (now - ts >= this.debounceMs) {
                this.recentHistory.delete(k);
            }
        }
        const lastTime = this.recentHistory.get(cleanText);
        if (lastTime && (now - lastTime) < this.debounceMs) {
            return;
        }
        this.recentHistory.set(cleanText, now);

        // 將觸發的語音依序加入 FIFO 佇列；上限 4 句，超過時自動丟棄最舊的一句
        this.queue.push(cleanText);
        while (this.queue.length > this.maxSize) {
            this.queue.shift();
        }

        this.processNext();
    },

    processNext() {
        if (!isVoiceEnabled || !('speechSynthesis' in window)) {
            this.clear();
            return;
        }
        if (this.isSpeaking || this.queue.length === 0) return;

        const nextText = this.queue.shift();
        if (!nextText) return;

        this.isSpeaking = true;
        try {
            if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
            }
            const u = new SpeechSynthesisUtterance(nextText);
            u.lang = 'zh-TW';
            u.rate = clampNum(systemNavConfig.voiceRate, 0.8, 1.5, DEFAULT_SYSTEM_CONFIG.voiceRate);

            let finished = false;
            const onComplete = () => {
                if (finished) return;
                finished = true;
                if (this._watchdogTimer) {
                    clearTimeout(this._watchdogTimer);
                    this._watchdogTimer = null;
                }
                if (window._activeSpeechUtterance === u) {
                    window._activeSpeechUtterance = null;
                }
                this.isSpeaking = false;
                this.processNext();
            };

            u.onend = onComplete;
            u.onerror = onComplete;

            // 安全保底：防止行動裝置瀏覽器偶發未觸發 onend 卡住佇列
            this._watchdogTimer = setTimeout(onComplete, 12000);

            // 將 SpeechSynthesisUtterance 實例保存於全域變數中，避免被瀏覽器垃圾回收機制中途切斷導致無聲
            window._activeSpeechUtterance = u;
            window.speechSynthesis.speak(u);
        } catch (e) {
            window._activeSpeechUtterance = null;
            this.isSpeaking = false;
            this.processNext();
        }
    },

    clear() {
        this.queue.length = 0;
        this.isSpeaking = false;
        this.recentHistory.clear();
        if (this._watchdogTimer) {
            clearTimeout(this._watchdogTimer);
            this._watchdogTimer = null;
        }
        window._activeSpeechUtterance = null;
        if ('speechSynthesis' in window) {
            try { window.speechSynthesis.cancel(); } catch (e) {}
        }
    }
};
window.VoiceQueue = VoiceQueue;

function speakText(text) {
    VoiceQueue.enqueue(text);
}

// 🚀 綁定語音開關按鈕切換邏輯
document.getElementById('voiceToggleBtn').onclick = () => {
    isVoiceEnabled = !isVoiceEnabled;
    const btn = document.getElementById('voiceToggleBtn');
    const icon = document.getElementById('voiceIcon');
    const label = document.getElementById('voiceLabel');
    
    if (isVoiceEnabled) {
        // 開啟狀態的樣式 (紫色)
        btn.className = "bg-indigo-500 text-white w-11 h-11 rounded-2xl shadow-lg flex flex-col items-center justify-center active:scale-95 border border-indigo-400";
        icon.className = "fa-solid fa-volume-high text-base";
        label.innerText = "語音開";
        speakText("語音播報已開啟"); // 唸出提示音
    } else {
        // 關閉狀態的樣式 (灰色)
        btn.className = "bg-gray-400 text-white w-11 h-11 rounded-2xl shadow-lg flex flex-col items-center justify-center active:scale-95 border border-gray-300";
        icon.className = "fa-solid fa-volume-xmark text-base";
        label.innerText = "語音關";
        
        // 切換為「語音關」時，呼叫 speechSynthesis.cancel() 並清空排隊佇列
        VoiceQueue.clear();
    }
};

function vibrate(pattern) { if ('vibrate' in navigator) navigator.vibrate(pattern); }

// ==========================================
// 🛣️ 來回重複路段「往右側平行偏移（雙線分離顯示）」視覺座標引擎
// - 資料與距離維持真實道路中心線座標不變（不汙染 route.points 與距離計算）
// - 在 MapLibre 路線圖層與編輯/手繪節點渲染時，自動偵測同一條路線上與既有線段重疊或反向折返（距離 < 15m）的路段，
//   依該段行進方向往右側平行偏移（約 5.5px 隨地圖縮放比例適度錯開），讓去程與回程雙線並排清楚可辨識
// ==========================================
function pointToSegmentDistMeters(pLng, pLat, aLng, aLat, bLng, bLat) {
    const cosLat = Math.cos(((pLat + aLat) * 0.5 * Math.PI) / 180);
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * cosLat;

    const px = (pLng - aLng) * mPerDegLng;
    const py = (pLat - aLat) * mPerDegLat;
    const bx = (bLng - aLng) * mPerDegLng;
    const by = (bLat - aLat) * mPerDegLat;

    const lenSq = bx * bx + by * by;
    if (lenSq <= 0.0001) {
        return Math.hypot(px, py);
    }
    const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
    const projX = t * bx;
    const projY = t * by;
    return Math.hypot(px - projX, py - projY);
}

function computeVisualRightOffsetCoords(points) {
    if (!Array.isArray(points) || points.length === 0) return [];
    const n = points.length;
    if (n < 2) {
        return points.map(p => ({ lng: p.lng, lat: p.lat, dLng: 0, dLat: 0, isOffset: false }));
    }

    // 1. 計算累積里程 (cumM) 與每個點的穩定前進方向角 (bearings)
    const cumM = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
        cumM[i] = cumM[i - 1] + getDistanceKm(points[i - 1].lng, points[i - 1].lat, points[i].lng, points[i].lat) * 1000;
    }

    const bearings = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        let found = false;
        for (let k = i + 1; k < n; k++) {
            const dM = cumM[k] - cumM[i];
            if (dM >= 1.2) {
                bearings[i] = getBearing(points[i].lng, points[i].lat, points[k].lng, points[k].lat);
                found = true;
                break;
            }
        }
        if (!found) {
            for (let k = i - 1; k >= 0; k--) {
                const dM = cumM[i] - cumM[k];
                if (dM >= 1.2) {
                    bearings[i] = getBearing(points[k].lng, points[k].lat, points[i].lng, points[i].lat);
                    found = true;
                    break;
                }
            }
        }
        if (!found && typeof points[i].bearing === 'number') {
            bearings[i] = points[i].bearing;
        }
    }

    // 2. 偵測每個節點是否與先前已走過的線段重疊或反向折返（距離 < 15m）
    const rawOverlapLevel = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
        const pI = points[i];
        const bI = bearings[i];
        let isOverlappingEarlier = false;

        for (let j = 0; j < i - 1; j++) {
            const pathGapM = cumM[i] - cumM[j + 1];
            if (pathGapM < 10) break;

            // 快速經緯度 Bounding Box 過濾（約 22m 範圍）
            if (Math.abs(pI.lat - points[j].lat) > 0.00022 && Math.abs(pI.lat - points[j + 1].lat) > 0.00022) continue;
            if (Math.abs(pI.lng - points[j].lng) > 0.00025 && Math.abs(pI.lng - points[j + 1].lng) > 0.00025) continue;

            const segDistM = pointToSegmentDistMeters(
                pI.lng, pI.lat,
                points[j].lng, points[j].lat,
                points[j + 1].lng, points[j + 1].lat
            );

            if (segDistM < 15) {
                const angleDiff = getAngleDiff(bI, bearings[j]);
                // 若為反向折返 (angleDiff >= 90°)，只要路徑間隔 >= 10m 即判定為回程折返；
                // 若為同向重疊 (angleDiff < 90°)，路徑間隔 >= 42m 判定為重疊繞回
                if ((angleDiff >= 90 && pathGapM >= 10) || pathGapM >= 42) {
                    isOverlappingEarlier = true;
                    break;
                }
            }
        }

        if (isOverlappingEarlier) {
            rawOverlapLevel[i] = 1;
        }
    }

    // 3. 針對短暫 1~2 點缺口進行填補並做平滑過渡，避免路口或折返頂點出現鋸齒跳動
    const filledLevel = [...rawOverlapLevel];
    for (let i = 1; i < n - 1; i++) {
        if (filledLevel[i] === 0 && filledLevel[i - 1] === 1 && filledLevel[i + 1] === 1) {
            filledLevel[i] = 1;
        }
    }
    const smoothFactor = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        const prev = filledLevel[Math.max(0, i - 1)];
        const curr = filledLevel[i];
        const next = filledLevel[Math.min(n - 1, i + 1)];
        smoothFactor[i] = prev * 0.22 + curr * 0.56 + next * 0.22;
    }

    // 4. 依當前地圖縮放層級換算約 5.5px 對應的實際公尺偏移量（限制於 3.6m ~ 8.5m 之間）
    let currentZoom = 16.8;
    try {
        if (typeof map !== 'undefined' && map && typeof map.getZoom === 'function') {
            currentZoom = map.getZoom();
        }
    } catch (e) {}
    const metersPerPx = (156543.03392 * Math.cos((24.95 * Math.PI) / 180)) / Math.pow(2, currentZoom + 1);
    const baseOffsetMeters = Math.max(3.6, Math.min(8.5, metersPerPx * 5.8));

    const result = new Array(n);
    for (let i = 0; i < n; i++) {
        const pt = points[i];
        const factor = smoothFactor[i];
        if (factor <= 0.02) {
            result[i] = { lng: pt.lng, lat: pt.lat, dLng: 0, dLat: 0, isOffset: false };
            continue;
        }

        const offsetM = baseOffsetMeters * factor;
        const rightRad = (((bearings[i] + 90) % 360) * Math.PI) / 180;
        const eastM = offsetM * Math.sin(rightRad);
        const northM = offsetM * Math.cos(rightRad);

        const dLat = northM / 111320;
        const cosLat = Math.max(0.2, Math.cos((pt.lat * Math.PI) / 180));
        const dLng = eastM / (111320 * cosLat);

        result[i] = {
            lng: Number((pt.lng + dLng).toFixed(6)),
            lat: Number((pt.lat + dLat).toFixed(6)),
            dLng,
            dLat,
            isOffset: true
        };
    }

    return result;
}

// 優化軌跡圖層更新：合併連續同狀態線段，並套用來回重複路段右側平行偏移視覺座標
function buildRouteLayerFeatures(points) {
    const musicFeatures = [], silentFeatures = [];
    if (Array.isArray(points) && points.length >= 2) {
        const visualPts = computeVisualRightOffsetCoords(points);
        let currentCoords = [[visualPts[0].lng, visualPts[0].lat]];
        let currentIsMusic = Boolean(points[1].musicActive);

        for (let i = 1; i < points.length; i++) {
            const pt = points[i];
            const vPt = visualPts[i];
            const isMusic = Boolean(pt.musicActive);
            if (isMusic === currentIsMusic) {
                currentCoords.push([vPt.lng, vPt.lat]);
            } else {
                if (currentCoords.length >= 2) {
                    const feature = { type: 'Feature', geometry: { type: 'LineString', coordinates: currentCoords } };
                    if (currentIsMusic) musicFeatures.push(feature);
                    else silentFeatures.push(feature);
                }
                const prevVPt = visualPts[i - 1];
                currentCoords = [[prevVPt.lng, prevVPt.lat], [vPt.lng, vPt.lat]];
                currentIsMusic = isMusic;
            }
        }
        if (currentCoords.length >= 2) {
            const feature = { type: 'Feature', geometry: { type: 'LineString', coordinates: currentCoords } };
            if (currentIsMusic) musicFeatures.push(feature);
            else silentFeatures.push(feature);
        }
    }
    return { musicFeatures, silentFeatures };
}

function updateRouteLayers(points, throttleMs = 0) {
    if (throttleMs > 0) {
        const now = performance.now();
        if (now - lastRouteLayerRenderTime < throttleMs) return;
        lastRouteLayerRenderTime = now;
    } else {
        lastRouteLayerRenderTime = performance.now();
    }

    const { musicFeatures, silentFeatures } = buildRouteLayerFeatures(points);
    cachedBgRouteGeoJSON = emptyGeoJSON();
    cachedMusicRouteGeoJSON = { type: 'FeatureCollection', features: musicFeatures };
    cachedSilentRouteGeoJSON = { type: 'FeatureCollection', features: silentFeatures };
    ensureCustomRouteSourcesAndLayers();
    map.getSource('bg-route')?.setData(cachedBgRouteGeoJSON);
    map.getSource('route-music')?.setData(cachedMusicRouteGeoJSON);
    map.getSource('route-Silent')?.setData(cachedSilentRouteGeoJSON);
}

// ==========================================
// 👾 動態軌跡變色（小精靈吃路線）與路線進度／雙層語音預警核心輔助函數
// - 已行駛路段（索引 0 至 currentTrackIndex）：渲染於 bg-route（日間半透明淺灰，夜間高亮度綠色 #22c55e）
// - 未行駛路段（索引 currentTrackIndex 至終點）：日間維持高亮綠/藍，夜間改為高對比螢光天藍色 (#00E5FF) 並加粗 1px
// ==========================================
function updateProgressRouteLayers(points, currentTrackIndex, exactPos = null, throttleMs = 0) {
    if (throttleMs > 0) {
        const now = performance.now();
        if (now - lastRouteLayerRenderTime < throttleMs) return;
        lastRouteLayerRenderTime = now;
    } else {
        lastRouteLayerRenderTime = performance.now();
    }

    ensureCustomRouteSourcesAndLayers();

    if (!Array.isArray(points) || points.length < 2) {
        cachedBgRouteGeoJSON = emptyGeoJSON();
        cachedMusicRouteGeoJSON = emptyGeoJSON();
        cachedSilentRouteGeoJSON = emptyGeoJSON();
        map.getSource('bg-route')?.setData(cachedBgRouteGeoJSON);
        map.getSource('route-music')?.setData(cachedMusicRouteGeoJSON);
        map.getSource('route-Silent')?.setData(cachedSilentRouteGeoJSON);
        return;
    }

    const maxIdx = points.length - 1;
    const clampedIdx = Math.min(Math.max(Math.floor(currentTrackIndex), 0), maxIdx);

    // 1. 已行駛路段（0 至 currentTrackIndex）：日間半透明淺灰色 / 夜間高亮度綠色 (bg-route)
    const traveledCoords = [];
    for (let i = 0; i <= clampedIdx; i++) {
        traveledCoords.push([points[i].lng, points[i].lat]);
    }
    if (exactPos && typeof exactPos.lng === 'number' && typeof exactPos.lat === 'number') {
        const lastC = traveledCoords[traveledCoords.length - 1];
        if (!lastC || lastC[0] !== exactPos.lng || lastC[1] !== exactPos.lat) {
            traveledCoords.push([exactPos.lng, exactPos.lat]);
        }
    }
    if (traveledCoords.length >= 2) {
        cachedBgRouteGeoJSON = {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: traveledCoords } }]
        };
    } else {
        cachedBgRouteGeoJSON = emptyGeoJSON();
    }
    map.getSource('bg-route')?.setData(cachedBgRouteGeoJSON);

    // 2. 未行駛路段（currentTrackIndex 至終點）：夜間高對比螢光天藍色 (#00E5FF) 加粗 1px ／ 日間原色
    let remainingPoints = [];
    if (exactPos && typeof exactPos.lng === 'number' && typeof exactPos.lat === 'number') {
        const nextIdx = Math.min(clampedIdx + 1, maxIdx);
        const startPt = {
            lng: exactPos.lng,
            lat: exactPos.lat,
            musicActive: exactPos.musicActive !== undefined ? exactPos.musicActive : Boolean(points[nextIdx]?.musicActive)
        };
        remainingPoints = [startPt, ...points.slice(clampedIdx + 1)];
    } else {
        remainingPoints = points.slice(clampedIdx);
    }

    const { musicFeatures, silentFeatures } = buildRouteLayerFeatures(remainingPoints);
    cachedMusicRouteGeoJSON = { type: 'FeatureCollection', features: musicFeatures };
    cachedSilentRouteGeoJSON = { type: 'FeatureCollection', features: silentFeatures };
    map.getSource('route-music')?.setData(cachedMusicRouteGeoJSON);
    map.getSource('route-Silent')?.setData(cachedSilentRouteGeoJSON);
}

// 計算路線各節點的累積里程（公尺），用於精準計算沿路線前瞻距離（Look-ahead Distance）
function buildCumulativeRouteMeters(pts) {
    if (!Array.isArray(pts) || pts.length === 0) return [];
    const cum = new Array(pts.length).fill(0);
    for (let i = 1; i < pts.length; i++) {
        const segM = getDistanceKm(pts[i - 1].lng, pts[i - 1].lat, pts[i].lng, pts[i].lat) * 1000;
        cum[i] = cum[i - 1] + segM;
    }
    return cum;
}

// 取得路線指定索引處的真實路段行進方向（Bearing）
function getRouteSegmentBearing(pts, idx) {
    if (!Array.isArray(pts) || pts.length < 2) return 0;
    const clamped = Math.min(Math.max(idx, 0), pts.length - 1);
    for (let j = clamped + 1; j < pts.length; j++) {
        const dM = getDistanceKm(pts[clamped].lng, pts[clamped].lat, pts[j].lng, pts[j].lat) * 1000;
        if (dM >= 1.5) {
            return getBearing(pts[clamped].lng, pts[clamped].lat, pts[j].lng, pts[j].lat);
        }
    }
    for (let j = clamped - 1; j >= 0; j--) {
        const dM = getDistanceKm(pts[j].lng, pts[j].lat, pts[clamped].lng, pts[clamped].lat) * 1000;
        if (dM >= 1.5) {
            return getBearing(pts[j].lng, pts[j].lat, pts[clamped].lng, pts[clamped].lat);
        }
    }
    return typeof pts[clamped]?.bearing === 'number' ? pts[clamped].bearing : 0;
}

// 進度鎖定追蹤器（前方滑動視窗 Sliding Window）：
// 僅從目前 prevTrackIndex 往後搜尋一小段合理範圍（最多往後 30 個節點且沿線距離 150 公尺內），
// 嚴禁搜尋整條路線全部節點，徹底防止「原路進出／巷口設終點 E、裡面繞圈」在巷口直接跳號到回程或終點
function computeNextTrackIndex(pts, prevTrackIndex, lng, lat, vehicleHeading, isMoving, cumMeters = null) {
    if (!Array.isArray(pts) || pts.length === 0) return { trackIndex: 0, minDistMeters: Infinity };
    const maxIdx = pts.length - 1;
    const startIdx = Math.min(Math.max(0, prevTrackIndex), maxIdx);
    const maxWindowNodeIdx = Math.min(maxIdx, startIdx + 30);
    const MAX_WINDOW_ALONG_METERS = 150;

    let bestLocalIdx = startIdx;
    let bestLocalScore = Infinity;
    let bestLocalDist = Infinity;
    let accumulatedAlongMeters = 0;

    for (let i = startIdx; i <= maxWindowNodeIdx; i++) {
        if (i > startIdx) {
            if (Array.isArray(cumMeters) && cumMeters.length === pts.length) {
                accumulatedAlongMeters = Math.max(0, (cumMeters[i] || 0) - (cumMeters[startIdx] || 0));
            } else {
                accumulatedAlongMeters += getDistanceKm(pts[i - 1].lng, pts[i - 1].lat, pts[i].lng, pts[i].lat) * 1000;
            }
            // 至少允許檢查緊鄰的下一個節點 (startIdx + 1)，超過沿線 150 公尺則停止往後擴張視窗
            if (i > startIdx + 1 && accumulatedAlongMeters > MAX_WINDOW_ALONG_METERS) {
                break;
            }
        }

        const d = getDistanceKm(lng, lat, pts[i].lng, pts[i].lat) * 1000;
        let penalty = (i - startIdx) * 0.25; // 微小順序權重：同距離時優先推進較近序號節點，不跨圈跳躍
        if (isMoving) {
            const segB = getRouteSegmentBearing(pts, i);
            const angDiff = Math.abs(getAngleDiff(vehicleHeading, segB));
            if (angDiff > 60) penalty += 35; // 逆向或垂直重疊路段加權懲罰，避免跳到回程
        }
        const score = d + penalty;
        if (score < bestLocalScore) {
            bestLocalScore = score;
            bestLocalIdx = i;
            bestLocalDist = d;
        }
    }

    // 僅在車輛位於前方滑動視窗軌跡附近 (<= 35m) 時推進 currentTrackIndex，絕不全域跳號
    if (bestLocalDist <= 35) {
        return {
            trackIndex: Math.max(startIdx, bestLocalIdx),
            minDistMeters: bestLocalDist
        };
    }

    return {
        trackIndex: startIdx,
        minDistMeters: bestLocalDist
    };
}

// 整理並重置路線所有語音標記點（包含開關音樂與黃色提醒點），重置 played / prePlayed 狀態
function prepareVoiceMarkerEvents(route, includeImplicitMusicTransitions = false) {
    const pts = route?.points || [];
    if (pts.length === 0) return [];

    const rawList = (route.events || []).map(ev => {
        ev.played = false;
        ev.prePlayed = false;

        let evPtIdx = (typeof ev.ptIdx === 'number' && ev.ptIdx >= 0 && ev.ptIdx < pts.length) ? ev.ptIdx : -1;
        if (evPtIdx === -1) {
            let bestScore = Infinity;
            let bestIdx = 0;
            for (let i = 0; i < pts.length; i++) {
                const d = getDistanceKm(ev.lng, ev.lat, pts[i].lng, pts[i].lat) * 1000;
                let dirPenalty = 0;
                if (typeof ev.bearing === 'number') {
                    const segB = getRouteSegmentBearing(pts, i);
                    if (Math.abs(getAngleDiff(ev.bearing, segB)) > 45) dirPenalty = 25;
                }
                if (d + dirPenalty < bestScore) {
                    bestScore = d + dirPenalty;
                    bestIdx = i;
                }
            }
            evPtIdx = bestIdx;
        }
        const segmentBearing = getRouteSegmentBearing(pts, evPtIdx);
        return {
            ...ev,
            ptIdx: evPtIdx,
            segmentBearing,
            played: false,
            prePlayed: false,
            sourceEvent: ev
        };
    });

    if (includeImplicitMusicTransitions && pts.length >= 2) {
        for (let i = 1; i < pts.length; i++) {
            const currActive = Boolean(pts[i].musicActive);
            const prevActive = Boolean(pts[i - 1].musicActive);
            if (currActive !== prevActive) {
                const evtType = currActive ? 'on' : 'off';
                const alreadyExists = rawList.some(e => e.type === evtType && Math.abs(e.ptIdx - i) <= 2);
                if (!alreadyExists) {
                    rawList.push({
                        type: evtType,
                        lng: pts[i].lng,
                        lat: pts[i].lat,
                        ptIdx: i,
                        segmentBearing: getRouteSegmentBearing(pts, i),
                        played: false,
                        prePlayed: false,
                        sourceEvent: null
                    });
                }
            }
        }
    }

    return rawList.sort((a, b) => a.ptIdx - b.ptIdx);
}

// ==========================================
// 🔊 綁定路線進度的雙層語音防誤報引擎
// 必須同時滿足 3 大條件才加入語音佇列：
// 1. 距離條件：進入觸發半徑（第一層：沿路線前瞻約 100m 預告；第二層：進入 40~50m 內完整確認）
// 2. 方向一致：當前車輛行進方向（vehicleBearing）與所屬路段方向誤差在 ±30° 以內
// 3. 進度鎖定：currentTrackIndex 已推進至該標記點綁定的路線索引區間，且本趟尚未播報（played !== true）
// ==========================================
function evaluateVoiceMarkersWithProgress({
    events,
    pts,
    cumMeters,
    currentTrackIndex,
    lng,
    lat,
    vehicleBearing,
    onTriggerWake = false
}) {
    if (!Array.isArray(events) || events.length === 0 || !Array.isArray(pts) || pts.length < 2) return;
    const maxIdx = pts.length - 1;
    const trackIdx = Math.min(Math.max(Math.floor(currentTrackIndex), 0), maxIdx);
    const currentTrackCumM = cumMeters[trackIdx] || 0;
    const currentSegBearing = getRouteSegmentBearing(pts, trackIdx);

    const lookAheadDist = Number(systemNavConfig.lookAheadDistMeters) || DEFAULT_SYSTEM_CONFIG.lookAheadDistMeters;
    const confirmDist = Number(systemNavConfig.confirmDistMeters) || DEFAULT_SYSTEM_CONFIG.confirmDistMeters;
    const bearingTol = Number(systemNavConfig.bearingToleranceDeg) || DEFAULT_SYSTEM_CONFIG.bearingToleranceDeg;
    const lookAheadLabel = Math.round(lookAheadDist);

    events.forEach(ev => {
        if (!ev || ev.played === true) return;
        const evIdx = Math.min(Math.max(ev.ptIdx || 0, 0), maxIdx);
        const evCumM = cumMeters[evIdx] || 0;
        const aheadRouteMeters = evCumM - currentTrackCumM;
        const directDistMeters = getDistanceKm(lng, lat, ev.lng, ev.lat) * 1000;
        const markerSegBearing = typeof ev.segmentBearing === 'number'
            ? ev.segmentBearing
            : getRouteSegmentBearing(pts, evIdx);

        // --- 第二層：進入近距離確認半徑 (預設 45 公尺) 內觸發完整確認語音 ---
        // 條件 1：車輛與標記點物理距離 <= confirmDist（且沿線距離不超過 confirmDist + 5）
        const isWithinConfirmRadius = (directDistMeters <= confirmDist && aheadRouteMeters <= (confirmDist + 5) && aheadRouteMeters >= -30);
        // 條件 2：當前車輛行進方向與標記點所屬路段方向一致（誤差 ±bearingTol° 以內）
        const bearingDiffConfirm = Math.abs(getAngleDiff(vehicleBearing, markerSegBearing));
        const isConfirmDirectionAligned = (bearingDiffConfirm <= bearingTol);
        // 條件 3：當前導航進度 currentTrackIndex 已推進至該標記點綁定之路線索引區間，且 played !== true
        const isConfirmIndexInZone = (trackIdx <= evIdx + 12 && aheadRouteMeters <= (confirmDist + 5) && aheadRouteMeters >= -30);

        if (isWithinConfirmRadius && isConfirmDirectionAligned && isConfirmIndexInZone && ev.played !== true) {
            ev.played = true;
            ev.prePlayed = true;
            if (ev.sourceEvent) {
                ev.sourceEvent.played = true;
                ev.sourceEvent.prePlayed = true;
            }
            if (onTriggerWake) autoWakeScreen();
            if (ev.type === 'on') {
                showNavAlert('🎵', '開啟音樂！', 'bg-green-600');
                speakText('請開啟音樂');
            } else if (ev.type === 'off') {
                showNavAlert('🔇', '關閉音樂！', 'bg-red-600');
                speakText('請關閉音樂');
            } else if (ev.type === 'alert') {
                showNavAlert('⚠️', ev.note || '注意路況', 'bg-amber-600', ev.photo || null);
                speakText(`前方提醒，${ev.note || '注意路況'}`);
            }
            if (onTriggerWake) autoSleepScreen();
            return;
        }

        // --- 第一層：沿路線前方約 lookAheadDist (預設 100 公尺) 處觸發簡短預告語音 ---
        if (ev.prePlayed === true) return;
        const lookAheadUpper = Math.max(lookAheadDist + 15, confirmDist + 15);
        const lookAheadLower = confirmDist + 5;
        // 條件 1：沿路線前方距離到達預警區間（且物理距離 > lookAheadLower 避免與第二層重疊）
        const isWithinLookAheadZone = (aheadRouteMeters <= lookAheadUpper && aheadRouteMeters > lookAheadLower && directDistMeters > lookAheadLower);
        // 條件 2：當前車輛行進方向與當前行駛路段（或標記點路段）方向一致（誤差 ±bearingTol° 以內）
        const bearingDiffCurrentSeg = Math.abs(getAngleDiff(vehicleBearing, currentSegBearing));
        const isLookAheadDirectionAligned = (bearingDiffCurrentSeg <= bearingTol || bearingDiffConfirm <= bearingTol);
        // 條件 3：currentTrackIndex 位於標記點前瞻索引區間（trackIdx < evIdx）且尚未播報
        const isLookAheadIndexInZone = (trackIdx < evIdx);

        if (isWithinLookAheadZone && isLookAheadDirectionAligned && isLookAheadIndexInZone && ev.prePlayed !== true) {
            ev.prePlayed = true;
            if (ev.sourceEvent) {
                ev.sourceEvent.prePlayed = true;
            }
            if (onTriggerWake) autoWakeScreen();
            if (ev.type === 'on') {
                showNavAlert('🎵', `前方 ${lookAheadLabel} 公尺：準備開啟音樂`, 'bg-green-600');
                speakText(`前方 ${lookAheadLabel} 公尺，準備開啟音樂`);
            } else if (ev.type === 'off') {
                showNavAlert('🔇', `前方 ${lookAheadLabel} 公尺：準備關閉音樂`, 'bg-red-600');
                speakText(`前方 ${lookAheadLabel} 公尺，準備關閉音樂`);
            } else if (ev.type === 'alert') {
                showNavAlert('⚠️', `前方 ${lookAheadLabel} 公尺：${ev.note || '注意路況'}`, 'bg-amber-600', ev.photo || null);
                speakText(`前方 ${lookAheadLabel} 公尺，注意${ev.note || '路況'}`);
            }
            if (onTriggerWake) autoSleepScreen();
        }
    });
}

let activeAlertPopupMarker = null;
let activeAlertPopupKey = null;
let activeAlertPinElement = null;

function closeActiveAlertPopup() {
    if (activeAlertPopupMarker) {
        try { activeAlertPopupMarker.remove(); } catch (e) {}
        activeAlertPopupMarker = null;
    }
    activeAlertPopupKey = null;
    if (activeAlertPinElement) {
        activeAlertPinElement.classList.remove('is-active');
        activeAlertPinElement = null;
    }
}

function refreshCurrentRouteMarkers(route) {
    if (!route) return;
    const detailEventsEl = document.getElementById('detailEvents');
    if (detailEventsEl) {
        detailEventsEl.innerText = `${(route.events || []).length} 處`;
    }
    if (isEditingMode) {
        renderEditableRouteMarkers(route);
    } else {
        renderRouteMarkers(route);
    }
}

function openAlertPopupCard(route, ev, eventIdx, pinEl) {
    if (!route || !ev) return;
    const key = `${eventIdx}_${ev.lng}_${ev.lat}`;
    if (activeAlertPopupKey === key && activeAlertPopupMarker) {
        closeActiveAlertPopup();
        return;
    }

    closeActiveAlertPopup();
    activeAlertPopupKey = key;
    if (pinEl) {
        pinEl.classList.add('is-active');
        activeAlertPinElement = pinEl;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'alert-popup-wrapper';
    wrapper.onclick = (e) => e.stopPropagation();

    const card = document.createElement('div');
    card.className = 'alert-popup-card';

    // 頂部標題列與關閉按鈕
    const headerRow = document.createElement('div');
    headerRow.className = 'flex items-center justify-between gap-2 pb-1 border-b border-amber-100';
    headerRow.innerHTML = `
        <span class="text-[11px] font-black text-amber-700 flex items-center gap-1">
            <i class="fa-solid fa-triangle-exclamation text-amber-500"></i> 警示提醒
        </span>
    `;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'w-5 h-5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center text-[11px] font-black active:scale-90';
    closeBtn.innerHTML = '✕';
    closeBtn.title = '收合';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeActiveAlertPopup();
    };
    headerRow.appendChild(closeBtn);
    card.appendChild(headerRow);

    // 完整警示文字（自動換行 max-width: 220px, white-space: normal, word-break: break-word）
    const noteEl = document.createElement('div');
    noteEl.className = 'alert-popup-note';
    noteEl.textContent = ev.note || '注意路況';
    card.appendChild(noteEl);

    // 若附有實景照片，顯示縮圖供點擊放大
    if (ev.photo) {
        const photoBtn = document.createElement('button');
        photoBtn.type = 'button';
        photoBtn.className = 'w-full h-24 mb-2 rounded-xl overflow-hidden border border-amber-200 relative block active:scale-[0.98] transition-transform';
        photoBtn.title = '點擊放大檢視照片';
        const img = document.createElement('img');
        img.src = ev.photo;
        img.alt = '提醒照片';
        img.className = 'w-full h-full object-cover';
        const badge = document.createElement('span');
        badge.className = 'absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md';
        badge.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus mr-0.5"></i>放大照片';
        photoBtn.appendChild(img);
        photoBtn.appendChild(badge);
        photoBtn.onclick = (e) => {
            e.stopPropagation();
            if (typeof window.openPhotoLightbox === 'function') {
                window.openPhotoLightbox(ev.photo);
            }
        };
        card.appendChild(photoBtn);
    }

    // 底部操作按鈕列（✏️ 編輯 / 🗑️ 刪除）
    const actionRow = document.createElement('div');
    actionRow.className = 'flex items-center gap-1.5 pt-1 border-t border-gray-100';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'flex-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-xl py-1.5 px-2 text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95 transition-all';
    editBtn.innerHTML = '<span>✏️ 編輯</span>';
    editBtn.onclick = (e) => {
        e.stopPropagation();
        closeActiveAlertPopup();
        openAlertModalForEdit(route, eventIdx);
    };

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl py-1.5 px-2.5 text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95 transition-all';
    delBtn.innerHTML = '<i class="fa-regular fa-trash-can"></i><span>刪除</span>';
    delBtn.onclick = (e) => {
        e.stopPropagation();
        if (!confirm(`確定要刪除【${ev.note || '提醒'}】這筆黃色提醒嗎？`)) return;
        closeActiveAlertPopup();
        if (isEditingMode && typeof pushEditUndoSnapshot === 'function') {
            pushEditUndoSnapshot(route);
        }
        if (Array.isArray(route.events) && eventIdx >= 0 && eventIdx < route.events.length) {
            route.events.splice(eventIdx, 1);
        }
        if (!isEditingMode && typeof persistSavedRoutesToStorage === 'function') {
            persistSavedRoutesToStorage();
        }
        refreshCurrentRouteMarkers(route);
    };

    actionRow.appendChild(editBtn);
    actionRow.appendChild(delBtn);
    card.appendChild(actionRow);

    const arrow = document.createElement('div');
    arrow.className = 'alert-popup-arrow';

    wrapper.appendChild(card);
    wrapper.appendChild(arrow);

    activeAlertPopupMarker = new maplibregl.Marker({
        element: wrapper,
        anchor: 'bottom',
        offset: [0, -40],
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport'
    }).setLngLat([ev.lng, ev.lat]).addTo(map);
}

function formatCompactAlertShortText(rawNote) {
    const clean = String(rawNote || '提醒').trim() || '提醒';
    const chars = Array.from(clean);
    return chars.length > 5 ? `${chars.slice(0, 5).join('')}...` : clean;
}

function createCompactAlertPinMarker(route, ev, eventIdx) {
    // 外層 markerEl 作為傳給 new maplibregl.Marker({ element: markerEl }) 的根容器，
    // 嚴禁在外層設定 CSS transform 或負 margin，避免干擾 MapLibre 的 translate3d 經緯度定位！
    const markerEl = document.createElement('div');
    markerEl.className = 'alert-compact-pin';
    markerEl.title = '點擊展開完整警示內容';

    // 內層膠囊（⚠️ ＋ 前 5 字 ＋ 22x22 照片縮圖），點擊與 active 縮放效果皆寫在內層
    const pillEl = document.createElement('div');
    pillEl.className = 'alert-compact-pill';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'text-xs leading-none flex-shrink-0';
    iconSpan.textContent = '⚠️';
    pillEl.appendChild(iconSpan);

    const textSpan = document.createElement('span');
    textSpan.textContent = formatCompactAlertShortText(ev.note);
    pillEl.appendChild(textSpan);

    if (ev.photo) {
        const thumbImg = document.createElement('img');
        thumbImg.src = ev.photo;
        thumbImg.alt = '縮圖';
        thumbImg.className = 'alert-compact-thumb';
        pillEl.appendChild(thumbImg);
    }

    // 正下方小橘色倒三角形指標，讓指標尖端精準對齊綠色路線上的觸發點 [ev.lng, ev.lat]
    const arrowEl = document.createElement('div');
    arrowEl.className = 'alert-compact-arrow';

    // 內層等比例縮放容器（transform-origin: bottom center），確保縮放時尖端不偏移且不覆蓋外層 MapLibre translate3d
    const scaleWrapEl = document.createElement('div');
    scaleWrapEl.className = 'alert-compact-scale-wrap';
    scaleWrapEl.appendChild(pillEl);
    scaleWrapEl.appendChild(arrowEl);

    markerEl.appendChild(scaleWrapEl);

    markerEl.onclick = (e) => {
        e.stopPropagation();
        openAlertPopupCard(route, ev, eventIdx, markerEl);
    };
    const m = new maplibregl.Marker({
        element: markerEl,
        anchor: 'bottom',
        offset: [0, -6],
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport'
    }).setLngLat([ev.lng, ev.lat]).addTo(map);
    domMarkers.push(m);
    return m;
}

function clearDomMarkers() {
    closeActiveAlertPopup();
    if (typeof clearPendingCalloutAnchor === 'function') {
        clearPendingCalloutAnchor();
    }
    if (typeof updateCalloutLeaderLines === 'function') {
        updateCalloutLeaderLines(null);
    }
    domMarkers.forEach(m => {
        try { m.remove(); } catch (e) {}
    });
    domMarkers = [];
}

function addPinMarker(lngLat, htmlContent) {
    // 使用乾淨無 transform 的外層 el 傳給 MapLibre Marker，避免內層 .pin-s / .pin-e 的 rotate(-45deg) 與 MapLibre translate3d 衝突
    const el = document.createElement('div');
    el.className = 'pin-se-wrapper';
    el.innerHTML = htmlContent;
    const m = new maplibregl.Marker({
        element: el,
        anchor: 'center',
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport'
    }).setLngLat(lngLat).addTo(map);
    domMarkers.push(m);
}

// --- 4. 紀錄路線（v3.27 三欄防誤觸橫排：左欄停止紀錄長按 1 秒＋確認 ｜ 中欄 GPS 精度隔離牆 ｜ 右欄音樂開關高頻盲操） ---
const musicToggleBtn = document.getElementById('musicToggleBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const stopRecordProgressFill = document.getElementById('stopRecordProgressFill');
const stopRecordSubHint = document.getElementById('stopRecordSubHint');

function renderMusicButtonState() {
    if (!musicToggleBtn) return;
    const icon = document.getElementById('musicBtnIcon');
    const text = document.getElementById('musicBtnText');
    const subHint = document.getElementById('musicBtnSubHint');
    if (musicActive) {
        musicToggleBtn.className = "w-full bg-green-600 text-white font-black py-2 px-1.5 rounded-2xl flex flex-col items-center justify-center shadow-lg animate-pulse active:scale-95 transition-all select-none";
        if (icon) icon.className = "fa-solid fa-volume-high text-xs";
        if (text) text.innerText = "🔊 音樂播放中";
        if (subHint) {
            subHint.innerText = "點擊切換關閉";
            subHint.className = "text-[9px] text-green-100 font-bold leading-tight mt-0.5 truncate max-w-full";
        }
    } else {
        musicToggleBtn.className = "w-full bg-gray-700 text-white font-black py-2 px-1.5 rounded-2xl flex flex-col items-center justify-center shadow-inner active:scale-95 transition-all select-none";
        if (icon) icon.className = "fa-solid fa-volume-xmark text-xs";
        if (text) text.innerText = "🔇 音樂關閉中";
        if (subHint) {
            subHint.innerText = "點擊切換開啟";
            subHint.className = "text-[9px] text-gray-300 font-bold leading-tight mt-0.5 truncate max-w-full";
        }
    }
}

if (musicToggleBtn) {
    musicToggleBtn.onclick = () => {
        if (!isRecording) return;
        musicActive = !musicActive;
        renderMusicButtonState();
        vibrate(25);
        const evtType = musicActive ? 'on' : 'off';
        musicEvents.push({ type: evtType, lng: lastKnownLngLat[0], lat: lastKnownLngLat[1], bearing: currentHeading });

        const badgeHtml = musicActive
            ? `<div class="music-marker music-on-pin"><i class="fa-solid fa-music"></i> 開音樂</div>`
            : `<div class="music-marker music-off-pin"><i class="fa-solid fa-volume-xmark"></i> 關音樂</div>`;
        addPinMarker(lastKnownLngLat, badgeHtml);
    };
}

function restoreIdleRecordingUILayout() {
    document.getElementById('recordingTopRow')?.classList.add('hidden');
    document.getElementById('idleTopRow')?.classList.remove('hidden');
    document.getElementById('idleActionRow')?.classList.remove('hidden');
    document.getElementById('startManualDrawBtn')?.classList.remove('hidden');
    const recBtn = document.getElementById('recordBtn');
    if (recBtn) {
        recBtn.classList.remove('bg-red-600');
        recBtn.classList.add('bg-green-700');
        const iconEl = recBtn.querySelector('i');
        if (iconEl) {
            iconEl.classList.remove('fa-stop');
            iconEl.classList.add('fa-play');
        }
    }
    const recBtnText = document.getElementById('recordBtnText');
    if (recBtnText) recBtnText.innerText = '開始紀錄路線';
    const titleEl = document.getElementById('appStatusTitle');
    if (titleEl) titleEl.innerText = '鶯歌清運路線助手 Pro Max';
}

async function stopAndSaveActiveRecording() {
    if (!isRecording) return;

    // 二次確認彈窗（「確定要結束紀錄並儲存路線嗎？」）
    if (!confirm("確定要結束紀錄並儲存路線嗎？\n\n(按「取消」可返回地圖繼續錄製)")) {
        return;
    }

    // 當有效軌跡點不足 2 點（例如靜止測試 0.00 km）時，直接停止錄製狀態、安全釋放 WakeLock 並彈出明確提示
    if (routePoints.length < 2) {
        isRecording = false;
        activeRecordingGpsHandler = null;
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        if (timerInterval !== null) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        try {
            if (wakeLock) {
                await wakeLock.release();
                wakeLock = null;
            }
        } catch (err) {
            wakeLock = null;
        }
        await releaseScreenWakeLockIfIdle(true);

        clearDomMarkers();
        updateRouteLayers([]);
        document.getElementById('distanceText').innerText = '0.00';
        document.getElementById('timeText').innerText = '00:00:00';
        document.getElementById('speedText').innerText = '0.0';

        restoreIdleRecordingUILayout();
        showNavAlert('移動距離過短（不足 2 個軌跡點），已取消本次紀錄');
        startIdleGPS();
        return;
    }

    isRecording = false;
    activeRecordingGpsHandler = null;
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    try {
        if (wakeLock) {
            await wakeLock.release();
            wakeLock = null;
        }
    } catch (err) {
        wakeLock = null;
    }
    await releaseScreenWakeLockIfIdle(true);

    restoreIdleRecordingUILayout();

    const defaultName = "鶯歌路線 " + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const name = prompt("路線紀錄完成！請輸入路線名稱（如：尖山線第一趟）：", defaultName);
    if (name) {
        const savedAuthor = localStorage.getItem('fleet_user_name') || localStorage.getItem('yinggeRouteLastAuthor') || '凱哥';
        const author = prompt("請輸入這條路線的創作者署名：", savedAuthor) || "熱心隊員";
        localStorage.setItem('yinggeRouteLastAuthor', author);

        const mins = Math.floor(elapsedSec / 60), secs = elapsedSec % 60;
        const nowId = Date.now();
        savedRoutes.unshift({
            id: nowId, originId: nowId, routeId: generateRouteId(), name, author,
            routeVersion: 1, updatedAt: nowId,
            date: new Date().toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
            createdAt: new Date(nowId).toISOString(),
            distance: totalDistanceKm.toFixed(2), timeStr: `${mins}m ${secs}s`,
            points: routePoints, events: musicEvents,
            alerts: [], warnings: []
        });
        localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);
        try { localStorage.setItem('yinggeCleanRoutes_v2', JSON.stringify(savedRoutes)); } catch (e) {}
        document.getElementById('historyCount').innerText = savedRoutes.length;
        window.openRouteDetail(0);
    }
    startIdleGPS();
}

// 綁定左欄「⏹️ 停止紀錄並儲存」按鈕：長按 1 秒（顯示進度填充動畫）＋跳出二次確認彈窗雙重防誤觸保護
(function setupStopRecordLongPressProtection() {
    if (!stopRecordBtn) return;
    let holdTimer = null;
    let holdTriggered = false;
    let isPressing = false;

    function resetHoldVisual(customHint) {
        if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
        }
        isPressing = false;
        if (stopRecordProgressFill) {
            stopRecordProgressFill.style.transition = 'width 120ms ease-out';
            stopRecordProgressFill.style.width = '0%';
        }
        if (stopRecordSubHint) {
            stopRecordSubHint.innerText = customHint || '長按 1 秒防誤觸';
        }
    }

    function startHold(e) {
        if (!isRecording) return;
        if (e.type === 'mousedown' && e.button !== 0) return;
        isPressing = true;
        holdTriggered = false;
        if (holdTimer) clearTimeout(holdTimer);

        if (stopRecordSubHint) {
            stopRecordSubHint.innerText = '⏳ 按住滿 1 秒停止...';
        }
        if (stopRecordProgressFill) {
            stopRecordProgressFill.style.transition = 'none';
            stopRecordProgressFill.style.width = '0%';
            void stopRecordProgressFill.offsetWidth;
            stopRecordProgressFill.style.transition = 'width 1000ms linear';
            stopRecordProgressFill.style.width = '100%';
        }

        holdTimer = setTimeout(() => {
            if (!isPressing || !isRecording) return;
            holdTriggered = true;
            vibrate([45, 30, 45]);
            resetHoldVisual('長按 1 秒防誤觸');
            stopAndSaveActiveRecording();
        }, 1000);
    }

    function endHold(e) {
        if (!isPressing) return;
        const wasTriggered = holdTriggered;
        resetHoldVisual(wasTriggered ? '長按 1 秒防誤觸' : '⚠️ 請按住滿 1 秒');
        if (!wasTriggered && isRecording) {
            vibrate(15);
            showNavAlert('🛡️', '防誤觸保護：請按住左側「停止紀錄」滿 1 秒以結束錄製', 'bg-rose-600');
            setTimeout(() => {
                if (stopRecordSubHint && isRecording && !isPressing) {
                    stopRecordSubHint.innerText = '長按 1 秒防誤觸';
                }
            }, 1800);
        }
    }

    stopRecordBtn.addEventListener('touchstart', startHold, { passive: true });
    stopRecordBtn.addEventListener('touchend', endHold, { passive: true });
    stopRecordBtn.addEventListener('touchcancel', () => resetHoldVisual('長按 1 秒防誤觸'), { passive: true });
    stopRecordBtn.addEventListener('mousedown', startHold);
    stopRecordBtn.addEventListener('mouseup', endHold);
    stopRecordBtn.addEventListener('mouseleave', () => {
        if (isPressing && !holdTriggered) resetHoldVisual('長按 1 秒防誤觸');
    });
})();

document.getElementById('recordBtn').onclick = async () => {
    stopIdleGPS();
    if (!isRecording) {
        // 單一實例保護：啟動前先清除可能殘留的計時器與定位監聽
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        if (timerInterval !== null) {
            clearInterval(timerInterval);
            timerInterval = null;
        }

        isRecording = true; musicActive = false; renderMusicButtonState();
        routePoints = []; musicEvents = []; totalDistanceKm = 0; elapsedSec = 0;
        clearDomMarkers(); updateRouteLayers([]);
        map.getSource('bg-route')?.setData(emptyGeoJSON());
        startTime = Date.now();

        document.getElementById('idleTopRow')?.classList.add('hidden');
        document.getElementById('idleActionRow')?.classList.add('hidden');
        document.getElementById('recordingTopRow')?.classList.remove('hidden');
        if (stopRecordProgressFill) {
            stopRecordProgressFill.style.transition = 'none';
            stopRecordProgressFill.style.width = '0%';
        }
        if (stopRecordSubHint) {
            stopRecordSubHint.innerText = '長按 1 秒防誤觸';
        }
        document.getElementById('appStatusTitle').innerText = '路線紀錄中...';
        setCameraFollow(true);

        await requestScreenWakeLock();

        timerInterval = setInterval(() => {
            elapsedSec = Math.floor((Date.now() - startTime) / 1000);
            if (!isPowerSaveMapPaused()) {
                document.getElementById('timeText').innerText = new Date(elapsedSec * 1000).toISOString().substr(11, 8);
            }
        }, 1000);

        activeRecordingGpsHandler = pos => {
            markGpsUpdateReceived();
            const filtered = processFilteredGpsPosition(pos);
            if (!filtered) return; // 剔除 accuracy > 45m 低精度與 > 160km/h 衛星反射瞬移

            const now = Date.now();
            const lng = filtered.lng, lat = filtered.lat;
            const acc = Math.round(filtered.accuracy);
            if (!isPowerSaveMapPaused()) {
                document.getElementById('recAccuracyText').innerText = `± ${acc} m`;
                document.getElementById('speedText').innerText = filtered.isStationary ? '0.0' : filtered.speedKmh.toFixed(1);
            }

            if (typeof window.onFleetPositionUpdate === 'function') {
                window.onFleetPositionUpdate(lat, lng);
            }

            if (routePoints.length === 0) {
                lastKnownLngLat = [lng, lat];
                routePoints.push({ lng, lat, time: now, musicActive, music: musicActive, bearing: 0 });
                addPinMarker([lng, lat], '<div class="pin-s"><span>S</span></div>');
                if (!isPowerSaveMapPaused() && vehicleMarker) vehicleMarker.setLngLat([lng, lat]);
                lastRecordTime = now;
                return;
            }

            // 停車防抖動鎖定：靜止狀態下凍結位置與車頭朝向更新
            if (filtered.isStationary) return;

            const prev = routePoints[routePoints.length - 1];
            const distKm = getDistanceKm(prev.lng, prev.lat, lng, lat);
            const distM = distKm * 1000;

            if (distM >= minMoveMeters || (now - lastRecordTime >= gpsFreqMs && distM >= 1.5)) {
                const minLockSpeed = Number(systemNavConfig.minLockSpeedKmh) || DEFAULT_SYSTEM_CONFIG.minLockSpeedKmh;
                // 車速 >= minLockSpeed 且位移 >= 5m 才更新真實移動方位角，否則鎖死最後角度
                if (distM >= 5 && filtered.speedKmh >= minLockSpeed) {
                    currentHeading = getBearing(prev.lng, prev.lat, lng, lat);
                } else {
                    currentHeading = filtered.heading;
                }
                totalDistanceKm += distKm;
                lastKnownLngLat = [lng, lat];
                routePoints.push({ lng, lat, time: now, musicActive, music: musicActive, bearing: currentHeading });

                if (!isPowerSaveMapPaused()) {
                    document.getElementById('distanceText').innerText = totalDistanceKm.toFixed(2);
                    if (vehicleMarker) smoothMoveVehicleMarker([lng, lat], currentHeading, 750);
                    updateRouteLayers(routePoints, 250);

                    if (isFollowingCamera) {
                        const targetZoom = getDynamicZoomBySpeed(filtered.speedKmh);
                        map.easeTo({
                            center: [lng, lat],
                            zoom: targetZoom,
                            bearing: isHeadingUpMode ? currentHeading : map.getBearing(),
                            offset: [0, 100],
                            duration: 600
                        });
                    }
                }
                lastRecordTime = now;
            }
        };

        watchId = navigator.geolocation.watchPosition(
            activeRecordingGpsHandler,
            () => {},
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );

    } else {
        await stopAndSaveActiveRecording();
    }
};

// --- 5. 歷史清單與路線預覽 ---
const historyModal = document.getElementById('historyModal');
const routeSearchInput = document.getElementById('routeSearchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');

if (routeSearchInput) {
    routeSearchInput.oninput = () => renderHistoryList();
}
if (clearSearchBtn) {
    clearSearchBtn.onclick = () => {
        if (routeSearchInput) {
            routeSearchInput.value = '';
            routeSearchInput.focus();
        }
        renderHistoryList();
    };
}

function renderHistoryList() {
    const list = document.getElementById('historyList');
    if (!list) return;
    list.innerHTML = '';

    // 每次讀取並渲染「鶯歌清運路線庫」本機清單時，自動執行去重過濾並寫回儲存空間清除重複殘留
    if (typeof deduplicateSavedRoutes === 'function') {
        deduplicateSavedRoutes(true);
    }

    if (typeof syncRouteUpdateBadgesAndAllBar === 'function') {
        syncRouteUpdateBadgesAndAllBar(false);
    }

    const rawSearch = routeSearchInput ? routeSearchInput.value : '';
    if (clearSearchBtn) {
        if (rawSearch.length > 0) clearSearchBtn.classList.remove('hidden');
        else clearSearchBtn.classList.add('hidden');
    }
    const keyword = rawSearch.trim().toLowerCase();
    
    if (savedRoutes.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-400 mt-16"><p>尚無儲存的清運路線</p></div>';
        if (window.sortableInstance) { window.sortableInstance.destroy(); window.sortableInstance = null; }
        return;
    }

    const filteredRoutes = savedRoutes
        .map((r, originalIdx) => ({ route: r, originalIdx }))
        .filter(({ route }) => {
            if (!keyword) return true;
            const nameMatch = (route.name || '').toLowerCase().includes(keyword);
            const authorMatch = (route.author || '').toLowerCase().includes(keyword);
            return nameMatch || authorMatch;
        });

    if (filteredRoutes.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-400 mt-16"><i class="fa-solid fa-magnifying-glass text-2xl mb-2 opacity-40"></i><p class="text-sm font-bold">找不到符合的路線或創作者</p></div>';
        if (window.sortableInstance) { window.sortableInstance.destroy(); window.sortableInstance = null; }
        return;
    }

    filteredRoutes.forEach(({ route: r, originalIdx }) => {
        const updateInfo = (typeof getCloudRouteUpdateInfo === 'function')
            ? getCloudRouteUpdateInfo(r)
            : { hasUpdate: false, localVer: getRouteVersion(r) };

        const card = document.createElement('div');
        card.className = updateInfo.hasUpdate
            ? "bg-gradient-to-r from-white to-orange-50/50 p-2.5 rounded-2xl shadow-md border-2 border-orange-300 flex items-stretch gap-2 active:scale-[0.99] transition-transform"
            : "bg-white p-2.5 rounded-2xl shadow-sm border border-gray-100 flex items-stretch gap-2 active:scale-[0.99] transition-transform";

        const authorTag = r.author
            ? `<span class="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap"><i class="fa-solid fa-user-ninja mr-1"></i>${r.author}</span>`
            : '';

        const versionBadgeHtml = updateInfo.hasUpdate
            ? `<span class="bg-gradient-to-r from-orange-500 to-red-600 text-white text-[10px] px-2 py-0.5 rounded-full font-black whitespace-nowrap shadow-sm animate-pulse">v${updateInfo.localVer} ➔ v${updateInfo.cloudVer} 有新版</span>`
            : `<span class="bg-gray-100 text-gray-600 text-[10px] px-1.5 py-0.5 rounded-md font-extrabold whitespace-nowrap">v${updateInfo.localVer}</span>`;

        const cloudTimeHtml = updateInfo.hasUpdate
            ? `<div class="text-[11px] font-extrabold text-orange-600 mt-0.5">☁️ 最新版更新於：${updateInfo.updateTimeText}</div>`
            : `<div class="text-xs text-gray-400 mt-0.5 mb-1">${r.date || ''}</div>`;

        card.innerHTML = `
            <div class="drag-handle text-gray-300 w-7 flex items-center justify-center cursor-grab active:cursor-grabbing hover:text-blue-500 flex-shrink-0" title="長按 0.5 秒解鎖拖曳排序">
                <i class="fa-solid fa-grip-vertical text-xl"></i>
            </div>
            <div class="route-card-info flex-1 min-w-0 py-1 cursor-pointer">
                <div class="font-black text-gray-900 text-base flex items-center gap-1.5 flex-wrap">
                    <span class="truncate max-w-full">${r.name}</span>
                    ${versionBadgeHtml}
                    ${authorTag}
                </div>
                ${cloudTimeHtml}
                <div class="flex gap-3 text-[11px] font-bold mt-1">
                    <span class="text-blue-600"><i class="fa-solid fa-route mr-1"></i>${r.distance} km</span>
                    <span class="text-green-600"><i class="fa-solid fa-music mr-1"></i>${(r.events||[]).length} 處標記</span>
                </div>
            </div>
            <div class="flex flex-col justify-between items-end py-0.5 gap-1.5 flex-shrink-0">
                <div class="flex items-center gap-1">
                    <button class="edit-name-btn text-gray-300 hover:text-amber-500 w-7 h-7 flex items-center justify-center rounded-xl active:bg-gray-50 transition-colors" title="更改名稱"><i class="fa-solid fa-pen text-xs"></i></button>
                </div>
                <div class="flex flex-col items-end gap-1">
                    ${updateInfo.hasUpdate ? `
                    <button type="button" class="update-from-cloud-btn bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white px-2.5 py-1.5 rounded-xl text-[11px] font-black shadow-md flex items-center gap-1 active:scale-95 transition-all whitespace-nowrap" title="立即覆蓋更新為雲端最新版">
                        🔄 更新路線
                    </button>` : ''}
                    <button type="button" class="upload-cloud-btn bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 px-2.5 py-1 rounded-xl text-[11px] font-extrabold flex items-center gap-1 active:scale-95 transition-all whitespace-nowrap" title="上傳分享至車隊雲端">
                        ⬆️ 上傳至雲端
                    </button>
                </div>
            </div>
        `;

        card.querySelector('.route-card-info').onclick = () => window.openRouteDetail(originalIdx);
        card.querySelector('.edit-name-btn').onclick = (e) => {
            e.stopPropagation();
            const newName = prompt('請輸入新的路線名稱：', r.name);
            if (newName && newName.trim() !== '') {
                savedRoutes[originalIdx].name = newName.trim();
                savedRoutes[originalIdx].updatedAt = Date.now();
                localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => renderHistoryList());
            }
        };
        const updateCloudBtn = card.querySelector('.update-from-cloud-btn');
        if (updateCloudBtn && updateInfo.hasUpdate && updateInfo.cloudRoute) {
            updateCloudBtn.onclick = (e) => {
                e.stopPropagation();
                applySingleCloudRouteUpdate(originalIdx, updateInfo.cloudRoute);
            };
        }
        const uploadBtn = card.querySelector('.upload-cloud-btn');
        uploadBtn.onclick = (e) => {
            e.stopPropagation();
            uploadRouteToCloud(originalIdx, uploadBtn);
        };
        list.appendChild(card);
    });

    if (window.sortableInstance) window.sortableInstance.destroy();
    window.sortableInstance = new Sortable(list, {
        handle: '.drag-handle',
        delay: 500, // 必須按住左側 ⋮⋮ 六點抓手滿 0.5 秒才正式解除鎖定進入拖曳排序
        delayOnTouchOnly: false,
        touchStartThreshold: 8, // 期間手指上下移動超過 8px 立即取消計時並改為正常捲動列表
        animation: 200,
        ghostClass: 'opacity-50',
        chosenClass: 'route-card-drag-unlocked',
        onChoose: function (evt) {
            try { vibrate(35); } catch (e) {}
            if (evt.item) evt.item.classList.add('route-card-drag-unlocked');
        },
        onUnchoose: function (evt) {
            if (evt.item) evt.item.classList.remove('route-card-drag-unlocked');
        },
        onEnd: function (evt) {
            if (evt.item) evt.item.classList.remove('route-card-drag-unlocked');
            if (evt.oldIndex === evt.newIndex) return;
            const fromIdx = filteredRoutes[evt.oldIndex]?.originalIdx;
            const toIdx = filteredRoutes[evt.newIndex]?.originalIdx;
            if (fromIdx === undefined || toIdx === undefined) return;
            const movedItem = savedRoutes.splice(fromIdx, 1)[0];
            savedRoutes.splice(toIdx, 0, movedItem);
            localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => renderHistoryList());
        }
    });
}

document.getElementById('historyBtn').onclick = () => {
    renderHistoryList();
    historyModal.classList.remove('hidden');
    if (typeof checkCloudRouteUpdatesInBackground === 'function') {
        checkCloudRouteUpdatesInBackground(false);
    }
};
document.getElementById('closeHistory').onclick = (e) => { 
    e.stopPropagation(); historyModal.classList.add('hidden'); backToMain(); 
};

function renderRouteMarkers(route) {
    clearDomMarkers();
    const pts = route.points;
    if (!pts || pts.length === 0) return;
    addPinMarker([pts[0].lng, pts[0].lat], '<div class="pin-s"><span>S</span></div>');
    addPinMarker([pts[pts.length-1].lng, pts[pts.length-1].lat], '<div class="pin-e"><span>E</span></div>');
    
    (route.events || []).forEach((ev, idx) => {
        if (ev.type === 'on') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-on-pin"><i class="fa-solid fa-music"></i> 開</div>`);
        } else if (ev.type === 'off') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-off-pin"><i class="fa-solid fa-volume-xmark"></i> 關</div>`);
        } else if (ev.type === 'alert') {
            createCompactAlertPinMarker(route, ev, idx);
        }
    });

    (route.points || []).forEach(p => {
        if (p.is_stop) addPinMarker([p.lng, p.lat], `<div class="music-marker bg-indigo-600 border border-white shadow-lg"><i class="fa-regular fa-clock"></i> ${p.scheduled_time || ''}</div>`);
    });

    renderRouteCallouts(route, false);
}

function openRouteDetail(idx, skipFitBounds = false) {
    selectedRouteIdx = idx; const route = savedRoutes[idx];
    if (!route) return;
    historyModal.classList.add('hidden');
    document.getElementById('mainUI').classList.add('hidden');
    document.getElementById('playbackUI').classList.add('hidden');
    document.getElementById('routeDetailUI').classList.remove('hidden');
    document.getElementById('topBackBtn').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = '路線預覽';

    const curVer = getRouteVersion(route);
    document.getElementById('detailTitle').innerText = `${route.name} (v${curVer})`;
    document.getElementById('detailDate').innerText = `更新於 ${route.date} · 創作者：${route.author || '隊員'}`;
    document.getElementById('detailDist').innerText = `${route.distance} km`;
    document.getElementById('detailTime').innerText = route.timeStr;
    document.getElementById('detailEvents').innerText = `${(route.events || []).length} 處`;

    map.getSource('bg-route')?.setData(emptyGeoJSON());
    updateRouteLayers(route.points);
    renderRouteMarkers(route);

    if (!skipFitBounds) {
        const bounds = new maplibregl.LngLatBounds();
        route.points.forEach(p => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: { top: 80, bottom: 260, left: 50, right: 50 }, bearing: 0, duration: 500 });
    }
}
window.openRouteDetail = openRouteDetail;

document.getElementById('deleteRouteBtn').ontouchend = (e) => {
    e.preventDefault(); e.stopPropagation();
    setTimeout(() => {
        if (confirm('確定要刪除這條清運路線嗎？')) {
            savedRoutes.splice(selectedRouteIdx, 1);
            persistSavedRoutesToStorage();
            
            document.getElementById('routeDetailUI').classList.add('hidden');
            document.getElementById('topBackBtn').classList.add('hidden');
            clearDomMarkers(); updateRouteLayers([]);
            map.getSource('bg-route')?.setData(emptyGeoJSON());
            
            renderHistoryList();
            document.getElementById('historyModal').classList.remove('hidden');
        }
    }, 100);
};

// ==========================================
// 🛠️ 統一版路線編輯引擎（拖曳微調 ＋ 虛擬中點 ＋ 節點修剪 ＋ 手繪延伸/剪接 ＋ 引線備忘框 ＋ 10步Undo）
// ==========================================
let isEditingMode = false, originalEventsBackup = [], originalPointsBackup = [], originalCalloutsBackup = [];
let editStep = 0, editStartIndex = -1, tempMarkerA = null;
let editSubMode = 'path', pathEditMarkers = [];
let selectedEditNodeIdx = -1;

// 📌 引線備忘框（Callout Annotation）暫存狀態
let pendingCalloutAnchorLngLat = null;
let pendingCalloutAnchorMarker = null;

const CALLOUT_STYLE_THEMES = [
    { id: 'yellow-black', label: '黃底黑字', lineColor: '#d97706' },
    { id: 'red-white', label: '紅框白底', lineColor: '#dc2626' },
    { id: 'blue-white', label: '藍框白底', lineColor: '#2563eb' }
];

function getCalloutThemeConfig(styleId) {
    return CALLOUT_STYLE_THEMES.find(t => t.id === styleId) || CALLOUT_STYLE_THEMES[0];
}

function clearPendingCalloutAnchor() {
    pendingCalloutAnchorLngLat = null;
    if (pendingCalloutAnchorMarker) {
        try { pendingCalloutAnchorMarker.remove(); } catch (e) {}
        pendingCalloutAnchorMarker = null;
    }
}

function updateCalloutLeaderLines(route) {
    const callouts = Array.isArray(route?.callouts) ? route.callouts : [];
    const features = [];
    callouts.forEach(item => {
        if (
            !item ||
            !Array.isArray(item.anchorLngLat) || item.anchorLngLat.length < 2 ||
            !Array.isArray(item.boxLngLat) || item.boxLngLat.length < 2
        ) {
            return;
        }
        const aLng = Number(item.anchorLngLat[0]);
        const aLat = Number(item.anchorLngLat[1]);
        const bLng = Number(item.boxLngLat[0]);
        const bLat = Number(item.boxLngLat[1]);
        if (isNaN(aLng) || isNaN(aLat) || isNaN(bLng) || isNaN(bLat)) return;

        const theme = getCalloutThemeConfig(item.style);
        features.push({
            type: 'Feature',
            properties: {
                id: item.id || '',
                color: theme.lineColor
            },
            geometry: {
                type: 'LineString',
                coordinates: [
                    [aLng, aLat],
                    [bLng, bLat]
                ]
            }
        });
    });

    cachedCalloutLinesGeoJSON = {
        type: 'FeatureCollection',
        features
    };
    if (!map) return;
    try {
        ensureCustomRouteSourcesAndLayers();
        const src = map.getSource('callout-lines-source');
        if (src && typeof src.setData === 'function') {
            src.setData(cachedCalloutLinesGeoJSON);
        }
    } catch (e) {}
}

// 渲染路線的所有「📌 引線備忘框」（editable = true 為編輯模式可自由拖移/縮放/編輯/刪除；editable = false 為導航/重播/預覽唯讀鎖定模式）
function renderRouteCallouts(route, editable = false, autoFocusCalloutId = null) {
    if (!route) {
        updateCalloutLeaderLines(null);
        return;
    }
    if (!Array.isArray(route.callouts)) {
        route.callouts = [];
    }
    updateCalloutLeaderLines(route);

    route.callouts.forEach((callout, cIdx) => {
        if (
            !callout ||
            !Array.isArray(callout.anchorLngLat) || callout.anchorLngLat.length < 2 ||
            !Array.isArray(callout.boxLngLat) || callout.boxLngLat.length < 2
        ) {
            return;
        }

        const theme = getCalloutThemeConfig(callout.style);
        const boxW = Math.min(Math.max(Number(callout.width) || 156, 105), 340);
        const boxH = Math.min(Math.max(Number(callout.height) || 84, 52), 260);
        callout.width = boxW;
        callout.height = boxH;
        callout.style = theme.id;

        // 1. 錨點圓點 Marker（外層 .callout-anchor-marker 禁止設 transform）
        const anchorWrapEl = document.createElement('div');
        anchorWrapEl.className = 'callout-anchor-marker';
        const anchorDotEl = document.createElement('div');
        anchorDotEl.className = `callout-anchor-dot theme-${theme.id} ${editable ? 'is-editable' : ''}`;
        anchorDotEl.title = editable ? '按住可拖曳調整引線錨點位置' : '';
        anchorWrapEl.appendChild(anchorDotEl);

        const anchorMarker = new maplibregl.Marker({
            element: anchorWrapEl,
            anchor: 'center',
            draggable: Boolean(editable),
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        })
            .setLngLat([Number(callout.anchorLngLat[0]), Number(callout.anchorLngLat[1])])
            .addTo(map);

        if (editable) {
            anchorWrapEl.addEventListener('click', (ev) => ev.stopPropagation());
            anchorMarker.on('dragstart', () => {
                pushEditUndoSnapshot(route);
            });
            anchorMarker.on('drag', () => {
                const pos = anchorMarker.getLngLat();
                callout.anchorLngLat = [Number(pos.lng.toFixed(6)), Number(pos.lat.toFixed(6))];
                updateCalloutLeaderLines(route);
            });
            anchorMarker.on('dragend', () => {
                const pos = anchorMarker.getLngLat();
                callout.anchorLngLat = [Number(pos.lng.toFixed(6)), Number(pos.lat.toFixed(6))];
                updateCalloutLeaderLines(route);
            });
        }
        domMarkers.push(anchorMarker);

        // 2. 文字框本體 Marker（外層 .callout-box-marker 禁止設 transform）
        const boxMarkerEl = document.createElement('div');
        boxMarkerEl.className = 'callout-box-marker';
        if (!editable) {
            // 導航與重播模式下鎖定不可誤觸拖動，同時允許手指直接在上方滑動地圖
            boxMarkerEl.style.pointerEvents = 'none';
        }

        const cardEl = document.createElement('div');
        cardEl.className = `callout-box-card theme-${theme.id}`;
        cardEl.style.width = `${boxW}px`;
        cardEl.style.height = `${boxH}px`;

        if (editable) {
            boxMarkerEl.addEventListener('click', (ev) => ev.stopPropagation());

            // 頂部拖曳與樣式工具列（✥ 引線備忘）
            const headerEl = document.createElement('div');
            headerEl.className = 'callout-box-header';
            headerEl.title = '按住此處（或外框邊緣）拖曳移動文字框位置';

            const dragLabel = document.createElement('span');
            dragLabel.className = 'flex items-center gap-1 truncate select-none';
            dragLabel.innerHTML = '<span class="text-xs leading-none">✥</span><span>引線備忘</span>';

            const btnGroup = document.createElement('div');
            btnGroup.className = 'flex items-center gap-1 flex-shrink-0';

            // 樣式切換按鈕（黃底黑字 ➔ 紅框白底 ➔ 藍框白底）
            const styleBtn = document.createElement('button');
            styleBtn.type = 'button';
            styleBtn.className = 'px-1.5 py-0.5 rounded bg-black/10 hover:bg-black/20 text-[10px] font-black leading-none active:scale-90 transition-transform';
            styleBtn.textContent = theme.label;
            styleBtn.title = '切換框線與底色樣式（黃底黑字／紅框白底／藍框白底）';
            ['pointerdown', 'mousedown', 'touchstart'].forEach(evtName => {
                styleBtn.addEventListener(evtName, (ev) => ev.stopPropagation(), { passive: true });
            });
            styleBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                pushEditUndoSnapshot(route);
                const curIdx = CALLOUT_STYLE_THEMES.findIndex(t => t.id === callout.style);
                const nextTheme = CALLOUT_STYLE_THEMES[(curIdx + 1) % CALLOUT_STYLE_THEMES.length];
                callout.style = nextTheme.id;
                cardEl.className = `callout-box-card theme-${nextTheme.id}`;
                anchorDotEl.className = `callout-anchor-dot theme-${nextTheme.id} is-editable`;
                styleBtn.textContent = nextTheme.label;
                updateCalloutLeaderLines(route);
            });

            // 右上角刪除按鈕
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'w-4 h-4 rounded-full bg-red-600 hover:bg-red-700 text-white text-[10px] font-black flex items-center justify-center leading-none active:scale-90';
            delBtn.innerHTML = '✕';
            delBtn.title = '刪除此引線備忘框';
            ['pointerdown', 'mousedown', 'touchstart'].forEach(evtName => {
                delBtn.addEventListener(evtName, (ev) => ev.stopPropagation(), { passive: true });
            });
            delBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                pushEditUndoSnapshot(route);
                route.callouts.splice(cIdx, 1);
                vibrate(25);
                renderEditableRouteMarkers(route);
                const promptEl = document.getElementById('editPromptText');
                if (promptEl && editSubMode === 'callout') {
                    promptEl.innerText = '🗑️ 已刪除引線備忘框！可繼續點擊目標地點新增，或按「↩️ 上一步」復原';
                }
            });

            btnGroup.appendChild(styleBtn);
            btnGroup.appendChild(delBtn);
            headerEl.appendChild(dragLabel);
            headerEl.appendChild(btnGroup);
            cardEl.appendChild(headerEl);

            // 多行文字輸入框（解除事件攔截：pointer-events: auto、user-select: text，明確 stopPropagation + focus，絕不呼叫 preventDefault）
            const textareaEl = document.createElement('textarea');
            textareaEl.className = 'callout-box-textarea';
            textareaEl.style.pointerEvents = 'auto';
            textareaEl.style.userSelect = 'text';
            textareaEl.style.webkitUserSelect = 'text';
            textareaEl.placeholder = '輸入多行備忘細節...\n(如：巷窄倒車進入)';
            textareaEl.value = callout.text || '';

            let hasRecordedTextUndo = false;
            const syncTextareaValue = () => {
                if (!hasRecordedTextUndo) {
                    pushEditUndoSnapshot(route);
                    hasRecordedTextUndo = true;
                }
                callout.text = textareaEl.value;
            };

            textareaEl.oninput = syncTextareaValue;
            textareaEl.onchange = syncTextareaValue;
            textareaEl.addEventListener('input', syncTextareaValue);
            textareaEl.addEventListener('change', syncTextareaValue);

            textareaEl.addEventListener('focus', () => {
                hasRecordedTextUndo = false;
                boxMarkerEl.classList.add('is-editing-active');
            });
            textareaEl.addEventListener('blur', () => {
                callout.text = textareaEl.value;
                boxMarkerEl.classList.remove('is-editing-active');
            });

            // 點擊或觸控 <textarea> 時明確執行 e.stopPropagation() 與 textareaEl.focus()，絕不呼叫 e.preventDefault()
            const handleTextareaActivate = (ev) => {
                ev.stopPropagation();
                if (document.activeElement !== textareaEl) {
                    try { textareaEl.focus(); } catch (err) {}
                }
            };
            textareaEl.addEventListener('pointerdown', handleTextareaActivate);
            textareaEl.addEventListener('mousedown', handleTextareaActivate);
            textareaEl.addEventListener('touchstart', handleTextareaActivate, { passive: true });
            textareaEl.addEventListener('click', handleTextareaActivate);
            textareaEl.addEventListener('dblclick', (ev) => ev.stopPropagation());
            textareaEl.addEventListener('keydown', (ev) => ev.stopPropagation());
            cardEl.appendChild(textareaEl);

            // 右下角自由縮放手把 (Resize Handle)
            const resizeHandleEl = document.createElement('div');
            resizeHandleEl.className = 'callout-resize-handle';
            resizeHandleEl.title = '按住右下角拖曳調整文字框寬度與高度';
            cardEl.appendChild(resizeHandleEl);

            boxMarkerEl.appendChild(cardEl);

            const boxMarker = new maplibregl.Marker({
                element: boxMarkerEl,
                anchor: 'center',
                draggable: false,
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            })
                .setLngLat([Number(callout.boxLngLat[0]), Number(callout.boxLngLat[1])])
                .addTo(map);

            // --- 限制拖曳觸發區域：僅當按住頂部標題列（✥ 引線備忘）或外框邊緣 (cardEl border) 時才觸發拖曳移動文字框；點擊中間 <textarea> 一律為純文字輸入與選取模式 ---
            const startBoxDrag = (ev) => {
                if (ev.button !== undefined && ev.button !== 0) return;
                const target = ev.target;
                // 若點擊在 <textarea>、按鈕或右下角縮放手把上，一律不觸發拖曳
                if (
                    !target ||
                    target === textareaEl ||
                    textareaEl.contains(target) ||
                    target === resizeHandleEl ||
                    resizeHandleEl.contains(target) ||
                    (target.closest && target.closest('textarea, button, .callout-resize-handle'))
                ) {
                    return;
                }
                // 僅允許頂部標題列 (headerEl) 或外框邊緣 (target === cardEl) 觸發拖曳
                const isHeaderOrBorder = (target === cardEl || target === headerEl || headerEl.contains(target));
                if (!isHeaderOrBorder) return;

                ev.stopPropagation();
                ev.preventDefault();
                pushEditUndoSnapshot(route);
                boxMarkerEl.classList.add('is-editing-active');
                try { map.dragPan.disable(); } catch (err) {}

                const startClientX = ev.clientX;
                const startClientY = ev.clientY;
                const startScreenPt = map.project([Number(callout.boxLngLat[0]), Number(callout.boxLngLat[1])]);

                const onPointerMove = (moveEv) => {
                    const dx = moveEv.clientX - startClientX;
                    const dy = moveEv.clientY - startClientY;
                    const nextLngLat = map.unproject([startScreenPt.x + dx, startScreenPt.y + dy]);
                    callout.boxLngLat = [
                        Number(nextLngLat.lng.toFixed(6)),
                        Number(nextLngLat.lat.toFixed(6))
                    ];
                    boxMarker.setLngLat(callout.boxLngLat);
                    updateCalloutLeaderLines(route);
                };

                const onPointerUp = () => {
                    window.removeEventListener('pointermove', onPointerMove);
                    window.removeEventListener('pointerup', onPointerUp);
                    window.removeEventListener('pointercancel', onPointerUp);
                    boxMarkerEl.classList.remove('is-editing-active');
                    try { map.dragPan.enable(); } catch (err) {}
                    ensureEditorMapZoomEnabled();
                };

                window.addEventListener('pointermove', onPointerMove);
                window.addEventListener('pointerup', onPointerUp);
                window.addEventListener('pointercancel', onPointerUp);
            };

            cardEl.addEventListener('pointerdown', startBoxDrag);

            // --- 拖曳右下角縮放手把 (Resize Handle) 自由調整文字框 width 與 height ---
            resizeHandleEl.addEventListener('pointerdown', (ev) => {
                if (ev.button !== undefined && ev.button !== 0) return;
                ev.stopPropagation();
                ev.preventDefault();
                pushEditUndoSnapshot(route);
                boxMarkerEl.classList.add('is-editing-active');
                try { map.dragPan.disable(); } catch (err) {}

                const startX = ev.clientX;
                const startY = ev.clientY;
                const startW = Number(callout.width) || 156;
                const startH = Number(callout.height) || 84;

                const onResizeMove = (moveEv) => {
                    const nextW = Math.round(Math.min(Math.max(startW + (moveEv.clientX - startX), 105), 340));
                    const nextH = Math.round(Math.min(Math.max(startH + (moveEv.clientY - startY), 52), 260));
                    callout.width = nextW;
                    callout.height = nextH;
                    cardEl.style.width = `${nextW}px`;
                    cardEl.style.height = `${nextH}px`;
                };

                const onResizeUp = () => {
                    window.removeEventListener('pointermove', onResizeMove);
                    window.removeEventListener('pointerup', onResizeUp);
                    window.removeEventListener('pointercancel', onResizeUp);
                    boxMarkerEl.classList.remove('is-editing-active');
                    try { map.dragPan.enable(); } catch (err) {}
                    ensureEditorMapZoomEnabled();
                };

                window.addEventListener('pointermove', onResizeMove);
                window.addEventListener('pointerup', onResizeUp);
                window.addEventListener('pointercancel', onResizeUp);
            });

            domMarkers.push(boxMarker);

            if (autoFocusCalloutId && callout.id === autoFocusCalloutId) {
                setTimeout(() => {
                    try { textareaEl.focus(); } catch (e) {}
                }, 60);
            }
        } else {
            // 導航／重播／預覽唯讀模式（鎖定不可誤觸拖動或縮放）
            const textDiv = document.createElement('div');
            textDiv.className = 'callout-box-readonly-text';
            textDiv.textContent = (callout.text && callout.text.trim()) ? callout.text : '📌 備忘提醒';
            cardEl.appendChild(textDiv);
            boxMarkerEl.appendChild(cardEl);

            const boxMarker = new maplibregl.Marker({
                element: boxMarkerEl,
                anchor: 'center',
                draggable: false,
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            })
                .setLngLat([Number(callout.boxLngLat[0]), Number(callout.boxLngLat[1])])
                .addTo(map);
            domMarkers.push(boxMarker);
        }
    });
}

// 🔍 管理員待審路線「審核預覽／直接微調」專用暫存狀態（不寫入本機 savedRoutes，微調後可直接一鍵核准發布正式版）
let isReviewingPendingMode = false;
let reviewingPendingId = null;
let targetRouteId = null;
let reviewingPendingRoute = null;

function getActiveWorkingRoute() {
    if (isReviewingPendingMode && reviewingPendingRoute) {
        return reviewingPendingRoute;
    }
    return savedRoutes[selectedRouteIdx];
}

// ✍️ 手繪延伸／剪接狀態變數與 10 步復原堆疊
const MAX_EDIT_UNDO_STEPS = 10;
let freehandUndoStack = [];
let isFreehandDrawing = false;
let freehandStartIndex = -1;
let freehandStrokeCoords = [];
let freehandSpliceStartIdx = -1;
let freehandDraftCoords = [];

const modeMarkerBtn = document.getElementById('modeMarkerBtn');
const modePathBtn = document.getElementById('modePathBtn');
const modeFreehandBtn = document.getElementById('modeFreehandBtn');
const modeCalloutBtn = document.getElementById('modeCalloutBtn');
const btnUndoFreehand = document.getElementById('btnUndoFreehand');
const undoStepCountBadge = document.getElementById('undoStepCountBadge');
const editorLiveDistText = document.getElementById('editorLiveDistText');
const editorLiveNodesText = document.getElementById('editorLiveNodesText');
const nodeTrimActionPanel = document.getElementById('nodeTrimActionPanel');
const selectedNodeInfoText = document.getElementById('selectedNodeInfoText');
const btnCloseNodeTrimPanel = document.getElementById('btnCloseNodeTrimPanel');
const btnDeleteSingleNode = document.getElementById('btnDeleteSingleNode');
const btnTrimBeforeNode = document.getElementById('btnTrimBeforeNode');
const btnTrimAfterNode = document.getElementById('btnTrimAfterNode');
const btnEditorZoomIn = document.getElementById('btnEditorZoomIn');
const btnEditorZoomOut = document.getElementById('btnEditorZoomOut');
const btnManualZoomIn = document.getElementById('btnManualZoomIn');
const btnManualZoomOut = document.getElementById('btnManualZoomOut');
const pendingReviewBanner = document.getElementById('pendingReviewBanner');
const pendingReviewRouteTitle = document.getElementById('pendingReviewRouteTitle');
const pendingReviewMetaText = document.getElementById('pendingReviewMetaText');
const btnExitPendingReview = document.getElementById('btnExitPendingReview');
const normalEditActionRow = document.getElementById('normalEditActionRow');
const pendingReviewActionRow = document.getElementById('pendingReviewActionRow');
const btnApproveAndPublishReview = document.getElementById('btnApproveAndPublishReview');
const btnRejectAndDeleteReview = document.getElementById('btnRejectAndDeleteReview');

function ensureEditorMapZoomEnabled() {
    try { map.touchZoomRotate.enable(); } catch (e) {}
    try { map.scrollZoom.enable(); } catch (e) {}
    try { map.doubleClickZoom.enable(); } catch (e) {}
}

if (btnEditorZoomIn) btnEditorZoomIn.onclick = () => { ensureEditorMapZoomEnabled(); map.zoomIn({ duration: 220 }); };
if (btnEditorZoomOut) btnEditorZoomOut.onclick = () => { ensureEditorMapZoomEnabled(); map.zoomOut({ duration: 220 }); };
if (btnManualZoomIn) btnManualZoomIn.onclick = () => { ensureEditorMapZoomEnabled(); map.zoomIn({ duration: 220 }); };
if (btnManualZoomOut) btnManualZoomOut.onclick = () => { ensureEditorMapZoomEnabled(); map.zoomOut({ duration: 220 }); };

function clearPathEditMarkers() {
    pathEditMarkers.forEach(m => {
        try { m.remove(); } catch (e) {}
    });
    pathEditMarkers = [];
}

function ensureFreehandTempLayer() {
    if (!map || !map.isStyleLoaded()) return false;
    if (!map.getSource('freehand-temp-source')) {
        map.addSource('freehand-temp-source', { type: 'geojson', data: emptyGeoJSON() });
    }
    if (!map.getLayer('freehand-temp-layer')) {
        map.addLayer({
            id: 'freehand-temp-layer',
            type: 'line',
            source: 'freehand-temp-source',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#f97316', 'line-width': 6, 'line-dasharray': [2, 1.5], 'line-opacity': 0.95 }
        });
    }
    return true;
}

function updateFreehandTempLayer(coords) {
    if (!ensureFreehandTempLayer()) return;
    if (!Array.isArray(coords) || coords.length < 2) {
        map.getSource('freehand-temp-source')?.setData(emptyGeoJSON());
        return;
    }
    map.getSource('freehand-temp-source')?.setData({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords }
        }]
    });
}

function cancelActiveFreehandStroke(clearSpliceDraft = false) {
    isFreehandDrawing = false;
    freehandStartIndex = -1;
    freehandStrokeCoords = [];
    if (clearSpliceDraft) {
        freehandSpliceStartIdx = -1;
        freehandDraftCoords = [];
    }
    updateFreehandTempLayer(freehandDraftCoords.length >= 2 ? freehandDraftCoords : []);
    try { map.dragPan.enable(); } catch (e) {}
    ensureEditorMapZoomEnabled();
}

function pushEditUndoSnapshot(route) {
    if (!route || !Array.isArray(route.points)) return;
    freehandUndoStack.push({
        points: JSON.parse(JSON.stringify(route.points)),
        events: JSON.parse(JSON.stringify(route.events || [])),
        callouts: JSON.parse(JSON.stringify(route.callouts || [])),
        selectedEditNodeIdx,
        freehandSpliceStartIdx
    });
    if (freehandUndoStack.length > MAX_EDIT_UNDO_STEPS) {
        freehandUndoStack.shift();
    }
    updateUndoFreehandBtnUI();
}

function updateUndoFreehandBtnUI() {
    if (!btnUndoFreehand) return;
    const count = freehandUndoStack.length;
    btnUndoFreehand.disabled = (count === 0);
    if (undoStepCountBadge) {
        if (count > 0) {
            undoStepCountBadge.textContent = String(count);
            undoStepCountBadge.classList.remove('hidden');
        } else {
            undoStepCountBadge.classList.add('hidden');
        }
    }
}

function updateEditorLiveStatsUI(route) {
    if (!route || !Array.isArray(route.points)) return;
    let totalKm = 0;
    for (let i = 1; i < route.points.length; i++) {
        totalKm += getDistanceKm(
            route.points[i - 1].lng,
            route.points[i - 1].lat,
            route.points[i].lng,
            route.points[i].lat
        );
    }
    route.distance = totalKm.toFixed(2);
    if (editorLiveDistText) editorLiveDistText.textContent = route.distance;
    if (editorLiveNodesText) editorLiveNodesText.textContent = String(route.points.length);
    const detailDistEl = document.getElementById('detailDist');
    if (detailDistEl) detailDistEl.innerText = `${route.distance} km`;
}

let activeNodeTrimBubbleMarker = null;
let activeNodeTrimBubblePlacedBelow = false;
let isNodeTrimDrawerExpanded = false;

function removeActiveNodeTrimBubble() {
    if (activeNodeTrimBubbleMarker) {
        try { activeNodeTrimBubbleMarker.remove(); } catch (e) {}
        activeNodeTrimBubbleMarker = null;
    }
}

function updateNodeTrimPanelUI(route) {
    removeActiveNodeTrimBubble();
    if (!isEditingMode || editSubMode !== 'path' || !route || !Array.isArray(route.points) || selectedEditNodeIdx < 0 || selectedEditNodeIdx >= route.points.length) {
        isNodeTrimDrawerExpanded = false;
        return;
    }

    const pt = route.points[selectedEditNodeIdx];
    if (!pt || typeof pt.lng !== 'number' || typeof pt.lat !== 'number') return;

    const visualPts = computeVisualRightOffsetCoords(route.points);
    const vPt = visualPts[selectedEditNodeIdx] || pt;

    // 判斷節點是否靠近螢幕上緣（y < 140px 時自動改為彈出在節點正下方）
    let placeBelow = false;
    try {
        const screenPt = map.project([vPt.lng, vPt.lat]);
        if (screenPt && screenPt.y < 140) {
            placeBelow = true;
        }
    } catch (e) {}
    activeNodeTrimBubblePlacedBelow = placeBelow;

    const wrapperEl = document.createElement('div');
    wrapperEl.className = 'node-trim-bubble-wrapper';

    const arrowEl = document.createElement('div');
    arrowEl.className = placeBelow ? 'node-trim-bubble-arrow-up' : 'node-trim-bubble-arrow-down';

    // 阻止氣泡點擊穿透至底層地圖
    ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown'].forEach(evtName => {
        wrapperEl.addEventListener(evtName, (ev) => ev.stopPropagation());
    });

    if (!isNodeTrimDrawerExpanded) {
        // 1. 預設收合為迷你小膠囊抽屜鈕（例如：✂️ #89 ▸），完全不遮擋周圍路線視野
        const miniBtn = document.createElement('button');
        miniBtn.type = 'button';
        miniBtn.className = 'node-trim-mini-pill';
        miniBtn.title = '點擊展開節點修剪抽屜';
        miniBtn.innerHTML = `<span>✂️ #${selectedEditNodeIdx + 1}</span><span class="text-amber-400 text-[10px] ml-0.5">▸</span>`;
        miniBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            isNodeTrimDrawerExpanded = true;
            vibrate(15);
            const curRoute = getActiveWorkingRoute();
            updateNodeTrimPanelUI(curRoute);
        });

        if (placeBelow) {
            wrapperEl.appendChild(arrowEl);
            wrapperEl.appendChild(miniBtn);
        } else {
            wrapperEl.appendChild(miniBtn);
            wrapperEl.appendChild(arrowEl);
        }
    } else {
        // 2. 點擊小膠囊後才向旁滑開展開完整的修剪抽屜（🗑️ 刪點 ｜ ✂️ 刪前 ｜ ✂️ 刪後 ｜ ◂ 收合）
        const cardEl = document.createElement('div');
        cardEl.className = 'node-trim-bubble-card';
        cardEl.innerHTML = `
            <span class="text-amber-300 font-black text-[11px] px-1.5 select-none">#${selectedEditNodeIdx + 1}</span>
            <span class="text-slate-500 text-[10px] select-none">｜</span>
            <button type="button" data-trim-act="delete" class="text-white hover:text-amber-200 active:scale-95 font-black text-[11px] px-1.5 py-0.5 rounded-full bg-amber-600/85 hover:bg-amber-600 transition-all">🗑️ 刪點</button>
            <span class="text-slate-500 text-[10px] select-none">｜</span>
            <button type="button" data-trim-act="before" class="text-white hover:text-rose-200 active:scale-95 font-black text-[11px] px-1.5 py-0.5 rounded-full bg-rose-600/85 hover:bg-rose-600 transition-all">✂️ 刪前</button>
            <span class="text-slate-500 text-[10px] select-none">｜</span>
            <button type="button" data-trim-act="after" class="text-white hover:text-rose-200 active:scale-95 font-black text-[11px] px-1.5 py-0.5 rounded-full bg-rose-600/85 hover:bg-rose-600 transition-all">✂️ 刪後</button>
            <span class="text-slate-500 text-[10px] select-none">｜</span>
            <button type="button" data-trim-act="collapse" class="text-amber-200 hover:text-white active:scale-95 font-black text-[11px] px-1.5 py-0.5 rounded-full bg-slate-700/90 hover:bg-slate-600 flex items-center justify-center transition-all" title="收合回迷你小膠囊">◂ 收合</button>
        `;

        if (placeBelow) {
            wrapperEl.appendChild(arrowEl);
            wrapperEl.appendChild(cardEl);
        } else {
            wrapperEl.appendChild(cardEl);
            wrapperEl.appendChild(arrowEl);
        }

        cardEl.querySelector('[data-trim-act="delete"]')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            isNodeTrimDrawerExpanded = false;
            executeDeleteSingleSelectedNode();
        });
        cardEl.querySelector('[data-trim-act="before"]')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            isNodeTrimDrawerExpanded = false;
            executeTrimBeforeSelectedNode();
        });
        cardEl.querySelector('[data-trim-act="after"]')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            isNodeTrimDrawerExpanded = false;
            executeTrimAfterSelectedNode();
        });
        cardEl.querySelector('[data-trim-act="collapse"]')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            isNodeTrimDrawerExpanded = false;
            vibrate(10);
            const curRoute = getActiveWorkingRoute();
            updateNodeTrimPanelUI(curRoute);
        });
    }

    activeNodeTrimBubbleMarker = new maplibregl.Marker({
        element: wrapperEl,
        anchor: placeBelow ? 'top' : 'bottom',
        offset: placeBelow ? [0, 12] : [0, -12],
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport'
    })
        .setLngLat([vPt.lng, vPt.lat])
        .addTo(map);
}

// 當鏡頭移動結束後，若選取節點靠近螢幕頂部狀態改變，自動翻轉氣泡上下方向
map.on('moveend', () => {
    if (!activeNodeTrimBubbleMarker || !isEditingMode || editSubMode !== 'path') return;
    const route = getActiveWorkingRoute();
    if (!route || !Array.isArray(route.points) || selectedEditNodeIdx < 0 || selectedEditNodeIdx >= route.points.length) return;
    const pt = route.points[selectedEditNodeIdx];
    if (!pt) return;
    try {
        const screenPt = map.project([pt.lng, pt.lat]);
        const shouldPlaceBelow = Boolean(screenPt && screenPt.y < 140);
        if (shouldPlaceBelow !== activeNodeTrimBubblePlacedBelow) {
            updateNodeTrimPanelUI(route);
        }
    } catch (e) {}
});

// 重新計算路線總距離、每個軌跡點的車頭角 bearing，並重新綁定所有語音標記點與時刻站牌的路徑索引 ptIdx
// 若 dropTrimmedOutliers = true（例如修剪頭尾後），自動剔除距離剩餘路線超過 55 公尺的已裁切區段標記點
function syncRouteMarkersAndIndicesAfterSpline(route, preservedStops = null, dropTrimmedOutliers = false) {
    if (!route || !Array.isArray(route.points) || route.points.length === 0) return;
    const pts = route.points;

    // 若未傳入 preservedStops，自動由現有 points 收集
    const stopsToRestore = Array.isArray(preservedStops)
        ? preservedStops
        : pts.filter(p => p.is_stop).map(p => ({
            lng: p.lng,
            lat: p.lat,
            stop_name: p.stop_name,
            scheduled_time: p.scheduled_time
        }));

    // 1. 重新計算每個點的 bearing、遞增時間戳記與總距離 (km)
    let curTime = pts[0].time || Date.now();
    let totalDistKm = 0;
    for (let i = 0; i < pts.length; i++) {
        const isMusic = Boolean(pts[i].musicActive);
        pts[i].musicActive = isMusic;
        pts[i].music = isMusic;
        if (i > 0) {
            const prev = pts[i - 1];
            const dKm = getDistanceKm(prev.lng, prev.lat, pts[i].lng, pts[i].lat);
            totalDistKm += dKm;
            if (dKm * 1000 > 0.05) {
                pts[i].bearing = getBearing(prev.lng, prev.lat, pts[i].lng, pts[i].lat);
            } else {
                pts[i].bearing = prev.bearing || 0;
            }
            curTime += Math.max(400, Math.round((dKm / 20) * 3600 * 1000));
            pts[i].time = curTime;
        }
    }
    if (pts.length >= 2) {
        pts[0].bearing = pts[1].bearing || 0;
    }
    route.distance = totalDistKm.toFixed(2);

    // 2. 重新匹配時刻站牌 (is_stop) 至最近的路線節點
    pts.forEach(p => {
        delete p.is_stop;
        delete p.stop_name;
        delete p.scheduled_time;
    });
    if (stopsToRestore.length > 0) {
        stopsToRestore.forEach(st => {
            let minD = Infinity, bestIdx = 0;
            for (let i = 0; i < pts.length; i++) {
                const d = getDistanceKm(st.lng, st.lat, pts[i].lng, pts[i].lat);
                if (d < minD) { minD = d; bestIdx = i; }
            }
            if (dropTrimmedOutliers && minD * 1000 > 55) return;
            pts[bestIdx].is_stop = true;
            pts[bestIdx].stop_name = st.stop_name;
            pts[bestIdx].scheduled_time = st.scheduled_time;
        });
    }

    // 3. 重新匹配黃色提醒點 (alert) 的最近路線點索引，並依新的 musicActive 狀態自動重建 A/B 音樂開關事件與索引
    const updatedAlerts = [];
    (route.events || []).forEach(ev => {
        if (!ev || ev.type !== 'alert') return;
        let minD = Infinity, bestIdx = 0;
        for (let i = 0; i < pts.length; i++) {
            const d = getDistanceKm(ev.lng, ev.lat, pts[i].lng, pts[i].lat);
            if (d < minD) { minD = d; bestIdx = i; }
        }
        if (dropTrimmedOutliers && minD * 1000 > 55) return;
        updatedAlerts.push({
            ...ev,
            ptIdx: bestIdx,
            bearing: pts[bestIdx].bearing || 0
        });
    });

    const rebuiltMusicEvents = [];
    let currentMusic = Boolean(pts[0].musicActive);
    if (currentMusic) {
        rebuiltMusicEvents.push({
            type: 'on',
            lng: pts[0].lng,
            lat: pts[0].lat,
            ptIdx: 0,
            bearing: pts[0].bearing || 0
        });
    }
    for (let i = 1; i < pts.length; i++) {
        const m = Boolean(pts[i].musicActive);
        if (m !== currentMusic) {
            currentMusic = m;
            rebuiltMusicEvents.push({
                type: currentMusic ? 'on' : 'off',
                lng: pts[i].lng,
                lat: pts[i].lat,
                ptIdx: i,
                bearing: pts[i].bearing || 0
            });
        }
    }

    route.events = [...rebuiltMusicEvents, ...updatedAlerts];
    updateEditorLiveStatsUI(route);
}

// 萃取路線上的關鍵轉折節點索引（讓密集的 GPS 軌跡也能清爽顯示可拖曳關鍵點與「+ 虛擬中點」）
function computeRouteKeyNodeIndices(pts) {
    if (!Array.isArray(pts) || pts.length === 0) return [];
    const n = pts.length;
    if (n <= 45) {
        return pts.map((_, i) => i);
    }

    const keySet = new Set([0, n - 1]);
    if (selectedEditNodeIdx >= 0 && selectedEditNodeIdx < n) {
        keySet.add(selectedEditNodeIdx);
    }
    if (freehandSpliceStartIdx >= 0 && freehandSpliceStartIdx < n) {
        keySet.add(freehandSpliceStartIdx);
    }

    const stepStride = Math.max(2, Math.floor(n / 36));
    let lastAddedIdx = 0;

    for (let i = 1; i < n - 1; i++) {
        const p = pts[i];
        if (p.isKeyNode || p.is_stop) {
            keySet.add(i);
            lastAddedIdx = i;
            continue;
        }
        // 轉角變化明顯處自動保留為關鍵節點
        const prev = pts[Math.max(0, i - 2)];
        const next = pts[Math.min(n - 1, i + 2)];
        const b1 = getBearing(prev.lng, prev.lat, p.lng, p.lat);
        const b2 = getBearing(p.lng, p.lat, next.lng, next.lat);
        const angleDiff = getAngleDiff(b1, b2);
        if (angleDiff >= 18 && (i - lastAddedIdx >= 2)) {
            keySet.add(i);
            lastAddedIdx = i;
            continue;
        }
        if (i - lastAddedIdx >= stepStride) {
            keySet.add(i);
            lastAddedIdx = i;
        }
    }

    return Array.from(keySet).sort((a, b) => a - b);
}

// 渲染「🖐️ 拖曳微調」模式的關鍵節點與兩節點間的「+ 虛擬中點」
function renderPathEditNodes(route) {
    clearPathEditMarkers();
    if (!isEditingMode || !route || !Array.isArray(route.points) || route.points.length === 0) return;

    if (editSubMode === 'freehand') {
        renderFreehandSpliceNodes(route);
        return;
    }
    if (editSubMode !== 'path') return;

    const pts = route.points;
    const keyIndices = computeRouteKeyNodeIndices(pts);
    const visualPts = computeVisualRightOffsetCoords(pts);

    // 1. 渲染兩關鍵節點之間的「+ 虛擬中點」（跟隨右側平行偏移後的視覺線條位置，插入時仍寫入真實道路中心線座標）
    for (let k = 0; k < keyIndices.length - 1; k++) {
        const idxA = keyIndices[k];
        const idxB = keyIndices[k + 1];
        const ptA = pts[idxA];
        const ptB = pts[idxB];
        const segDistM = getDistanceKm(ptA.lng, ptA.lat, ptB.lng, ptB.lat) * 1000;
        if (segDistM < 5) continue;

        const midLng = Number(((ptA.lng + ptB.lng) / 2).toFixed(6));
        const midLat = Number(((ptA.lat + ptB.lat) / 2).toFixed(6));

        const vA = visualPts[idxA] || ptA;
        const vB = visualPts[idxB] || ptB;
        const midIdxForVis = Math.floor((idxA + idxB) / 2);
        const vMid = (idxB - idxA > 1 && visualPts[midIdxForVis])
            ? visualPts[midIdxForVis]
            : { lng: Number(((vA.lng + vB.lng) / 2).toFixed(6)), lat: Number(((vA.lat + vB.lat) / 2).toFixed(6)) };

        const midEl = document.createElement('button');
        midEl.type = 'button';
        midEl.title = '點擊插入新轉折點 (+ 虛擬中點)';
        midEl.className = 'w-5 h-5 rounded-full bg-white/95 hover:bg-emerald-50 text-emerald-700 border-2 border-emerald-500 shadow-md flex items-center justify-center font-black text-xs leading-none active:scale-90 transition-transform cursor-pointer z-10';
        midEl.innerHTML = '+';

        midEl.onclick = (ev) => {
            ev.stopPropagation();
            pushEditUndoSnapshot(route);

            const inheritedMusic = Boolean(ptA.musicActive);
            let newSelectedIdx;
            if (idxB - idxA > 1) {
                // 若兩關鍵點之間已有細分點，直接將中位點升級為關鍵轉折點並移至幾何中點
                const midIdx = Math.floor((idxA + idxB) / 2);
                pts[midIdx].lng = midLng;
                pts[midIdx].lat = midLat;
                pts[midIdx].isKeyNode = true;
                newSelectedIdx = midIdx;
            } else {
                const newPt = {
                    lng: midLng,
                    lat: midLat,
                    time: Date.now(),
                    musicActive: inheritedMusic,
                    music: inheritedMusic,
                    bearing: ptA.bearing || 0,
                    isKeyNode: true
                };
                pts.splice(idxA + 1, 0, newPt);
                newSelectedIdx = idxA + 1;
            }

            selectedEditNodeIdx = newSelectedIdx;
            isNodeTrimDrawerExpanded = false;
            syncRouteMarkersAndIndicesAfterSpline(route);
            vibrate(25);
            updateRouteLayers(route.points);
            renderEditableRouteMarkers(route);
            renderPathEditNodes(route);
            updateNodeTrimPanelUI(route);

            const promptEl = document.getElementById('editPromptText');
            if (promptEl) {
                promptEl.innerText = `➕ 已插入新轉折點 #${newSelectedIdx + 1}！可直接按住拖曳調整位置`;
            }
        };

        const midMarker = new maplibregl.Marker({
            element: midEl,
            anchor: 'center',
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        })
            .setLngLat([vMid.lng, vMid.lat])
            .addTo(map);
        pathEditMarkers.push(midMarker);
    }

    // 2. 渲染可拖曳、可點擊修剪的關鍵節點（跟隨右側平行偏移後的視覺位置顯示，拖曳時自動還原扣回偏移量以保存真實道路中心線座標）
    keyIndices.forEach((ptIdx, kPos) => {
        const pt = pts[ptIdx];
        if (!pt) return;
        const vPt = visualPts[ptIdx] || { lng: pt.lng, lat: pt.lat, dLng: 0, dLat: 0 };
        const initDLng = vPt.dLng || 0;
        const initDLat = vPt.dLat || 0;

        const isSelected = (ptIdx === selectedEditNodeIdx);
        const isEndpoint = (ptIdx === 0 || ptIdx === pts.length - 1);

        const prevKeyIdx = kPos > 0 ? keyIndices[kPos - 1] : ptIdx;
        const nextKeyIdx = kPos < keyIndices.length - 1 ? keyIndices[kPos + 1] : ptIdx;

        const el = document.createElement('div');
        if (isSelected) {
            el.className = 'w-6 h-6 bg-amber-300 border-[4px] border-red-600 ring-4 ring-amber-400/60 rounded-full shadow-xl cursor-grab active:cursor-grabbing z-30 flex items-center justify-center';
            el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-red-700"></span>';
        } else if (isEndpoint) {
            el.className = 'w-5 h-5 bg-white border-[5px] border-indigo-600 rounded-full shadow-lg cursor-grab active:cursor-grabbing z-20';
        } else {
            el.className = 'w-5 h-5 bg-white border-[5px] border-emerald-600 hover:border-amber-500 rounded-full shadow-md cursor-grab active:cursor-grabbing z-20';
        }
        el.title = `節點 #${ptIdx + 1}（按住拖曳位置，點擊顯示 ✂️ 迷你修剪小膠囊）`;

        const m = new maplibregl.Marker({
            element: el,
            anchor: 'center',
            draggable: true,
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        })
            .setLngLat([vPt.lng, vPt.lat])
            .addTo(map);
        m._ptIdx = ptIdx;

        m.on('dragstart', () => {
            pushEditUndoSnapshot(route);
            selectedEditNodeIdx = ptIdx;
            // 拖曳時自動收起回迷你小膠囊，確保拖曳微調時視野零遮擋
            isNodeTrimDrawerExpanded = false;
            updateNodeTrimPanelUI(route);
        });

        m.on('drag', () => {
            const lngLat = m.getLngLat();
            // 扣除視覺平行偏移量，確保實際寫入 route.points 的座標維持真實道路座標
            const newLng = Number((lngLat.lng - initDLng).toFixed(6));
            const newLat = Number((lngLat.lat - initDLat).toFixed(6));
            pt.lng = newLng;
            pt.lat = newLat;
            pt.isKeyNode = true;

            // 線性平滑插值相鄰關鍵點之間的細分點，避免拖曳單一節點時留下鋸齒舊軌跡點
            if (ptIdx > prevKeyIdx + 1) {
                const startPt = pts[prevKeyIdx];
                const span = ptIdx - prevKeyIdx;
                for (let s = 1; s < span; s++) {
                    const ratio = s / span;
                    pts[prevKeyIdx + s].lng = Number((startPt.lng + (newLng - startPt.lng) * ratio).toFixed(6));
                    pts[prevKeyIdx + s].lat = Number((startPt.lat + (newLat - startPt.lat) * ratio).toFixed(6));
                }
            }
            if (nextKeyIdx > ptIdx + 1) {
                const endPt = pts[nextKeyIdx];
                const span = nextKeyIdx - ptIdx;
                for (let s = 1; s < span; s++) {
                    const ratio = s / span;
                    pts[ptIdx + s].lng = Number((newLng + (endPt.lng - newLng) * ratio).toFixed(6));
                    pts[ptIdx + s].lat = Number((newLat + (endPt.lat - newLat) * ratio).toFixed(6));
                }
            }

            updateRouteLayers(route.points, 25);
            if (isNodeTrimDrawerExpanded) {
                isNodeTrimDrawerExpanded = false;
                updateNodeTrimPanelUI(route);
            }
            if (activeNodeTrimBubbleMarker && selectedEditNodeIdx === ptIdx) {
                activeNodeTrimBubbleMarker.setLngLat([lngLat.lng, lngLat.lat]);
            }
        });

        m.on('dragend', () => {
            isNodeTrimDrawerExpanded = false;
            syncRouteMarkersAndIndicesAfterSpline(route);
            updateRouteLayers(route.points);
            renderEditableRouteMarkers(route);
            renderPathEditNodes(route);
            updateNodeTrimPanelUI(route);
            const promptEl = document.getElementById('editPromptText');
            if (promptEl) {
                promptEl.innerText = `✅ 已微調節點 #${ptIdx + 1} 位置（總距離 ${route.distance} km）`;
            }
        });

        el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            selectedEditNodeIdx = ptIdx;
            isNodeTrimDrawerExpanded = false; // 點選節點時預設收合為 ✂️ #N ▸ 迷你小膠囊
            vibrate(20);
            renderPathEditNodes(route);
            updateNodeTrimPanelUI(route);
            const promptEl = document.getElementById('editPromptText');
            if (promptEl) {
                promptEl.innerText = `🎯 已選取節點 #${ptIdx + 1}：點擊上方「✂️ #${ptIdx + 1} ▸」可展開修剪抽屜`;
            }
        });

        pathEditMarkers.push(m);
    });
}

// 渲染「✍️ 手繪延伸／剪接」模式下的路線錨點（支援先點選舊節點再畫線/加點連回另一舊節點自動剪除替換，或從頭尾延伸）
function renderFreehandSpliceNodes(route) {
    clearPathEditMarkers();
    if (!isEditingMode || editSubMode !== 'freehand' || !route || !Array.isArray(route.points) || route.points.length === 0) return;

    const pts = route.points;
    const keyIndices = computeRouteKeyNodeIndices(pts);
    const visualPts = computeVisualRightOffsetCoords(pts);

    keyIndices.forEach(ptIdx => {
        const pt = pts[ptIdx];
        if (!pt) return;
        const vPt = visualPts[ptIdx] || pt;
        const isSpliceStart = (ptIdx === freehandSpliceStartIdx);
        const isHead = (ptIdx === 0);
        const isTail = (ptIdx === pts.length - 1);

        const el = document.createElement('div');
        if (isSpliceStart) {
            el.className = 'w-6 h-6 bg-orange-500 text-white border-[3px] border-white ring-4 ring-orange-400/70 rounded-full shadow-xl cursor-pointer z-30 flex items-center justify-center text-[10px] font-black';
            el.innerHTML = '✂️';
        } else if (isHead || isTail) {
            el.className = 'w-5 h-5 bg-amber-400 border-[4px] border-orange-700 rounded-full shadow-lg cursor-pointer z-20';
        } else {
            el.className = 'w-4 h-4 bg-white border-[4px] border-orange-500 hover:border-amber-400 rounded-full shadow cursor-pointer z-20';
        }
        el.title = isSpliceStart
            ? `剪接/延伸起點 #${ptIdx + 1}（請畫線或點選地圖加點，再點擊另一舊節點完成剪接）`
            : `節點 #${ptIdx + 1}（點擊設為手繪剪接/延伸起點，或作為剪接終點）`;

        el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            handleFreehandNodeClick(route, ptIdx);
        });

        const m = new maplibregl.Marker({
            element: el,
            anchor: 'center',
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        })
            .setLngLat([vPt.lng, vPt.lat])
            .addTo(map);
        pathEditMarkers.push(m);
    });
}

// 處理「手繪延伸／剪接」模式下點選舊節點的互動（選取剪接起點 A ➔ 畫線/加點 ➔ 點擊另一舊節點 B 自動剪除舊路徑並替換）
function handleFreehandNodeClick(route, clickedIdx) {
    if (!route || !Array.isArray(route.points)) return;
    const pts = route.points;
    const clickedPt = pts[clickedIdx];
    if (!clickedPt) return;
    const promptEl = document.getElementById('editPromptText');

    // 若已選取起點 A 且已畫出新路徑點 (freehandDraftCoords.length >= 2)，此時點擊另一個舊節點 B ➔ 立即剪除 A 與 B 之間的舊路徑並無縫替換！
    if (freehandSpliceStartIdx !== -1 && freehandSpliceStartIdx !== clickedIdx && freehandDraftCoords.length >= 2) {
        const endCoord = [Number(clickedPt.lng.toFixed(6)), Number(clickedPt.lat.toFixed(6))];
        const fullDraft = [...freehandDraftCoords, endCoord];
        applySpliceBetweenNodes(route, freehandSpliceStartIdx, clickedIdx, fullDraft);
        freehandSpliceStartIdx = -1;
        freehandDraftCoords = [];
        updateFreehandTempLayer([]);
        renderFreehandSpliceNodes(route);
        return;
    }

    // 否則將此舊節點設為新的「延伸／剪接起點」
    freehandSpliceStartIdx = clickedIdx;
    freehandDraftCoords = [[Number(clickedPt.lng.toFixed(6)), Number(clickedPt.lat.toFixed(6))]];
    updateFreehandTempLayer([]);
    vibrate(25);
    renderFreehandSpliceNodes(route);

    const isEndpoint = (clickedIdx === 0 || clickedIdx === pts.length - 1);
    if (promptEl) {
        promptEl.innerText = isEndpoint
            ? `🎯 已選取${clickedIdx === 0 ? '起點 S' : '終點 E'} (#${clickedIdx + 1})！可單指畫線或點擊地圖向外延伸，或連回另一舊節點剪接`
            : `✂️ 已鎖定舊節點 #${clickedIdx + 1}！請單指畫線（或點擊地圖加點）並連回另一個舊節點即可剪除中間舊路徑`;
    }
}

// 執行兩舊節點之間的剪接替換（將 idxA 與 idxB 之間的多餘舊路徑剪除，無縫替換為新畫的路徑）
function applySpliceBetweenNodes(route, startIdx, endIdx, rawCoords) {
    if (!route || !Array.isArray(route.points) || rawCoords.length < 2) return;
    const pts = route.points;
    const preservedStops = pts
        .filter(p => p.is_stop)
        .map(p => ({ lng: p.lng, lat: p.lat, stop_name: p.stop_name, scheduled_time: p.scheduled_time }));

    pushEditUndoSnapshot(route);

    const isForward = (startIdx <= endIdx);
    const idxStart = Math.min(startIdx, endIdx);
    const idxEnd = Math.max(startIdx, endIdx);

    const orderedCoords = isForward ? [...rawCoords] : [...rawCoords].reverse();
    orderedCoords[0] = [Number(pts[idxStart].lng.toFixed(6)), Number(pts[idxStart].lat.toFixed(6))];
    const endSnapCoord = [Number(pts[idxEnd].lng.toFixed(6)), Number(pts[idxEnd].lat.toFixed(6))];
    const lastDrawn = orderedCoords[orderedCoords.length - 1];
    if (getDistanceKm(lastDrawn[0], lastDrawn[1], endSnapCoord[0], endSnapCoord[1]) * 1000 > 0.5) {
        orderedCoords.push(endSnapCoord);
    } else {
        orderedCoords[orderedCoords.length - 1] = endSnapCoord;
    }

    const densified = densifyRoadCoordinates(orderedCoords, 5);
    const inheritedMusic = Boolean(pts[idxStart]?.musicActive);
    const newSegmentPoints = densified.map(([lng, lat], i) => ({
        lng,
        lat,
        time: Date.now(),
        musicActive: inheritedMusic,
        music: inheritedMusic,
        bearing: 0,
        isKeyNode: (i === 0 || i === densified.length - 1)
    }));

    pts.splice(idxStart, idxEnd - idxStart + 1, ...newSegmentPoints);
    syncRouteMarkersAndIndicesAfterSpline(route, preservedStops, true);
    vibrate([40, 30, 40]);
    updateRouteLayers(route.points);
    renderEditableRouteMarkers(route);
    renderFreehandSpliceNodes(route);

    const promptEl = document.getElementById('editPromptText');
    if (promptEl) {
        promptEl.innerText = `✅ 已剪除節點 #${idxStart + 1}～#${idxEnd + 1} 舊路徑並無縫替換為新路線！（總距離 ${route.distance} km）`;
    }
}

// 執行從頭尾端點向外延伸路線
function applyExtendFromEndpoint(route, anchorIdx, rawCoords) {
    if (!route || !Array.isArray(route.points) || rawCoords.length < 2) return;
    const pts = route.points;
    const preservedStops = pts
        .filter(p => p.is_stop)
        .map(p => ({ lng: p.lng, lat: p.lat, stop_name: p.stop_name, scheduled_time: p.scheduled_time }));

    pushEditUndoSnapshot(route);

    const distToHead = anchorIdx;
    const distToTail = (pts.length - 1) - anchorIdx;
    const inheritedMusic = Boolean(pts[anchorIdx]?.musicActive);

    if (distToTail <= distToHead) {
        // 往尾端 (E) 延伸
        const alignedCoords = [...rawCoords];
        alignedCoords[0] = [Number(pts[anchorIdx].lng.toFixed(6)), Number(pts[anchorIdx].lat.toFixed(6))];
        const densified = densifyRoadCoordinates(alignedCoords, 5);
        const newTailPoints = densified.map(([lng, lat], i) => ({
            lng,
            lat,
            time: Date.now(),
            musicActive: inheritedMusic,
            music: inheritedMusic,
            bearing: 0,
            isKeyNode: (i === densified.length - 1)
        }));
        pts.splice(anchorIdx, pts.length - anchorIdx, ...newTailPoints);
        freehandSpliceStartIdx = pts.length - 1;
    } else {
        // 往開頭 (S) 延伸
        const reversedCoords = [...rawCoords].reverse();
        reversedCoords[reversedCoords.length - 1] = [Number(pts[anchorIdx].lng.toFixed(6)), Number(pts[anchorIdx].lat.toFixed(6))];
        const densified = densifyRoadCoordinates(reversedCoords, 5);
        const newHeadPoints = densified.map(([lng, lat], i) => ({
            lng,
            lat,
            time: Date.now(),
            musicActive: inheritedMusic,
            music: inheritedMusic,
            bearing: 0,
            isKeyNode: (i === 0)
        }));
        pts.splice(0, anchorIdx + 1, ...newHeadPoints);
        freehandSpliceStartIdx = 0;
    }

    const newAnchorPt = pts[freehandSpliceStartIdx];
    freehandDraftCoords = newAnchorPt ? [[Number(newAnchorPt.lng.toFixed(6)), Number(newAnchorPt.lat.toFixed(6))]] : [];

    syncRouteMarkersAndIndicesAfterSpline(route, preservedStops, false);
    vibrate([40, 30, 40]);
    updateRouteLayers(route.points);
    renderEditableRouteMarkers(route);
    renderFreehandSpliceNodes(route);

    const promptEl = document.getElementById('editPromptText');
    if (promptEl) {
        promptEl.innerText = `✅ 已延伸路線至 ${route.distance} km！可繼續點擊/畫線延伸，或按「↩️ 上一步」復原`;
    }
}

// ==========================================
// ✂️ 刪除多餘路線（單點刪除 ／ 刪除此點之前 ／ 刪除此點之後 — 供跟隨節點懸浮修剪氣泡呼叫）
// ==========================================
function executeDeleteSingleSelectedNode() {
    const route = getActiveWorkingRoute();
    if (!isEditingMode || !route || !Array.isArray(route.points)) return;
    const pts = route.points;
    if (selectedEditNodeIdx < 0 || selectedEditNodeIdx >= pts.length) return;
    if (pts.length <= 2) {
        alert('⚠️ 路線至少需保留 2 個軌跡點，無法再刪除節點！');
        return;
    }

    pushEditUndoSnapshot(route);

    // 若為密集軌跡中的關鍵轉折點，找出前後相鄰關鍵點並一併抹平該偏移區段；若為一般點則直接移除該點
    const keyIndices = computeRouteKeyNodeIndices(pts);
    const kPos = keyIndices.indexOf(selectedEditNodeIdx);
    const removedNodeNum = selectedEditNodeIdx + 1;

    if (kPos > 0 && kPos < keyIndices.length - 1 && (keyIndices[kPos + 1] - keyIndices[kPos - 1] > 2) && (pts.length > 45)) {
        const prevIdx = keyIndices[kPos - 1];
        const nextIdx = keyIndices[kPos + 1];
        const removeCount = nextIdx - prevIdx - 1;
        if (pts.length - removeCount >= 2) {
            pts.splice(prevIdx + 1, removeCount);
            selectedEditNodeIdx = Math.min(prevIdx, pts.length - 1);
        } else {
            pts.splice(selectedEditNodeIdx, 1);
            selectedEditNodeIdx = Math.min(selectedEditNodeIdx, pts.length - 1);
        }
    } else {
        pts.splice(selectedEditNodeIdx, 1);
        selectedEditNodeIdx = Math.min(selectedEditNodeIdx, pts.length - 1);
    }

    syncRouteMarkersAndIndicesAfterSpline(route, null, true);
    vibrate(35);
    updateRouteLayers(route.points);
    renderEditableRouteMarkers(route);
    renderPathEditNodes(route);
    updateNodeTrimPanelUI(route);

    const promptEl = document.getElementById('editPromptText');
    if (promptEl) {
        promptEl.innerText = `🗑️ 已刪除偏移節點 #${removedNodeNum}（目前總距離 ${route.distance} km）`;
    }
}

function executeTrimBeforeSelectedNode() {
    const route = getActiveWorkingRoute();
    if (!isEditingMode || !route || !Array.isArray(route.points)) return;
    const pts = route.points;
    if (selectedEditNodeIdx < 0 || selectedEditNodeIdx >= pts.length) return;

    if (selectedEditNodeIdx === 0) {
        alert('ℹ️ 目前選取的已經是路線「起點 (S)」，前方沒有多餘路線可刪除！');
        return;
    }
    if (pts.length - selectedEditNodeIdx < 2) {
        alert('⚠️ 修剪後路線至少需保留 2 個軌跡點！請選擇更前面的節點。');
        return;
    }

    const cutCount = selectedEditNodeIdx;
    pushEditUndoSnapshot(route);

    pts.splice(0, cutCount);
    pts[0].isKeyNode = true;
    selectedEditNodeIdx = 0;

    syncRouteMarkersAndIndicesAfterSpline(route, null, true);
    vibrate([40, 30, 40]);
    updateRouteLayers(route.points);
    renderEditableRouteMarkers(route);
    renderPathEditNodes(route);
    updateNodeTrimPanelUI(route);

    const promptEl = document.getElementById('editPromptText');
    if (promptEl) {
        promptEl.innerText = `✂️ 已修剪開頭多餘路線（刪除前 ${cutCount} 點，新總距離 ${route.distance} km）`;
    }
}

function executeTrimAfterSelectedNode() {
    const route = getActiveWorkingRoute();
    if (!isEditingMode || !route || !Array.isArray(route.points)) return;
    const pts = route.points;
    if (selectedEditNodeIdx < 0 || selectedEditNodeIdx >= pts.length) return;

    if (selectedEditNodeIdx === pts.length - 1) {
        alert('ℹ️ 目前選取的已經是路線「終點 (E)」，後方沒有多餘路線可刪除！');
        return;
    }
    if (selectedEditNodeIdx < 1) {
        alert('⚠️ 修剪後路線至少需保留 2 個軌跡點！請選擇更後面的節點。');
        return;
    }

    const cutCount = (pts.length - 1) - selectedEditNodeIdx;
    pushEditUndoSnapshot(route);

    pts.splice(selectedEditNodeIdx + 1, cutCount);
    pts[pts.length - 1].isKeyNode = true;
    selectedEditNodeIdx = pts.length - 1;

    syncRouteMarkersAndIndicesAfterSpline(route, null, true);
    vibrate([40, 30, 40]);
    updateRouteLayers(route.points);
    renderEditableRouteMarkers(route);
    renderPathEditNodes(route);
    updateNodeTrimPanelUI(route);

    const promptEl = document.getElementById('editPromptText');
    if (promptEl) {
        promptEl.innerText = `✂️ 已修剪尾端多餘路線（刪除後 ${cutCount} 點，新總距離 ${route.distance} km）`;
    }
}

if (btnDeleteSingleNode) btnDeleteSingleNode.onclick = executeDeleteSingleSelectedNode;
if (btnTrimBeforeNode) btnTrimBeforeNode.onclick = executeTrimBeforeSelectedNode;
if (btnTrimAfterNode) btnTrimAfterNode.onclick = executeTrimAfterSelectedNode;

function setEditSubMode(mode) {
    editSubMode = mode;
    ensureEditorMapZoomEnabled();
    try { map.dragPan.enable(); } catch (e) {}

    const inactiveClass = "text-gray-600 hover:bg-white/70 font-black text-[11px] px-1 py-1.5 rounded-lg transition-all active:scale-95 whitespace-nowrap flex items-center justify-center";
    if (modePathBtn) modePathBtn.className = (mode === 'path')
        ? "bg-emerald-600 text-white font-black text-[11px] px-1 py-1.5 rounded-lg shadow-sm transition-all active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;
    if (modeFreehandBtn) modeFreehandBtn.className = (mode === 'freehand')
        ? "bg-orange-600 text-white font-black text-[11px] px-1 py-1.5 rounded-lg shadow-sm transition-all active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;
    if (modeMarkerBtn) modeMarkerBtn.className = (mode === 'marker')
        ? "bg-blue-600 text-white font-black text-[11px] px-1 py-1.5 rounded-lg shadow-sm transition-all active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;
    if (modeCalloutBtn) modeCalloutBtn.className = (mode === 'callout')
        ? "bg-rose-600 text-white font-black text-[11px] px-1 py-1.5 rounded-lg shadow-sm transition-all active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;

    const promptEl = document.getElementById('editPromptText');
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    clearPendingCalloutAnchor();
    editStep = 0;
    cancelActiveFreehandStroke(true);

    const route = getActiveWorkingRoute();

    if (mode === 'path') {
        if (promptEl) {
            promptEl.className = "bg-emerald-600 text-white font-extrabold text-xs px-4 py-1.5 rounded-full shadow-lg pointer-events-auto transition-colors text-center max-w-md";
            promptEl.innerText = "🖐️ 按住節點可拖曳微調，點擊「+」插入轉折點，點擊節點可刪除或修剪頭尾";
        }
        renderPathEditNodes(route);
        updateNodeTrimPanelUI(route);
    } else if (mode === 'freehand') {
        selectedEditNodeIdx = -1;
        updateNodeTrimPanelUI(route);
        if (promptEl) {
            promptEl.className = "bg-orange-600 text-white font-extrabold text-xs px-4 py-1.5 rounded-full shadow-lg pointer-events-auto transition-colors text-center max-w-md";
            promptEl.innerText = "✍️ 可自由雙指/滾輪縮放！單指從頭尾畫線延伸，或點選舊節點畫線連回另一舊節點剪接";
        }
        renderFreehandSpliceNodes(route);
    } else if (mode === 'marker') {
        selectedEditNodeIdx = -1;
        updateNodeTrimPanelUI(route);
        clearPathEditMarkers();
        if (promptEl) {
            promptEl.className = "bg-blue-600 text-white font-extrabold text-xs px-4 py-1.5 rounded-full shadow-lg pointer-events-auto transition-colors text-center max-w-md";
            promptEl.innerText = "📍 請點擊地圖軌跡，選擇音樂開關區段『起點 (A點)』或新增語音提醒/站牌";
        }
    } else if (mode === 'callout') {
        selectedEditNodeIdx = -1;
        updateNodeTrimPanelUI(route);
        clearPathEditMarkers();
        if (promptEl) {
            promptEl.className = "bg-rose-600 text-white font-extrabold text-xs px-4 py-1.5 rounded-full shadow-lg pointer-events-auto transition-colors text-center max-w-md";
            promptEl.innerText = "📌 請先點擊地圖上的目標地點（錨點），再點擊旁邊空位放置文字框";
        }
    }
    updateUndoFreehandBtnUI();
    if (route) updateEditorLiveStatsUI(route);
}

if (modeMarkerBtn) modeMarkerBtn.onclick = () => setEditSubMode('marker');
if (modePathBtn) modePathBtn.onclick = () => setEditSubMode('path');
if (modeFreehandBtn) modeFreehandBtn.onclick = () => setEditSubMode('freehand');
if (modeCalloutBtn) modeCalloutBtn.onclick = () => setEditSubMode('callout');

if (btnUndoFreehand) {
    btnUndoFreehand.onclick = () => {
        if (!isEditingMode || freehandUndoStack.length === 0) return;
        const route = getActiveWorkingRoute();
        if (!route) return;
        const prevState = freehandUndoStack.pop();
        route.points = prevState.points;
        route.events = prevState.events;
        route.callouts = Array.isArray(prevState.callouts) ? prevState.callouts : [];
        clearPendingCalloutAnchor();
        selectedEditNodeIdx = (prevState.selectedEditNodeIdx !== undefined && prevState.selectedEditNodeIdx < route.points.length)
            ? prevState.selectedEditNodeIdx
            : -1;
        cancelActiveFreehandStroke(true);
        syncRouteMarkersAndIndicesAfterSpline(route);
        vibrate(30);
        updateRouteLayers(route.points);
        renderEditableRouteMarkers(route);
        renderPathEditNodes(route);
        updateNodeTrimPanelUI(route);
        updateUndoFreehandBtnUI();
        const promptEl = document.getElementById('editPromptText');
        if (promptEl) {
            promptEl.innerText = `↩️ 已復原上一步！（剩餘可復原 ${freehandUndoStack.length} 步，總距離 ${route.distance} km）`;
        }
    };
}

// 綁定地圖容器的手繪延伸／剪接事件（嚴格遵守：絕不鎖定 touchZoomRotate 與 scrollZoom，僅在 e.touches.length === 1 單指觸控時畫線，偵測到 e.touches.length >= 2 雙指觸控時立刻中斷畫線並交還地圖縮放平移）
(function setupFreehandSplineDrawing() {
    const canvasContainer = map.getCanvasContainer();

    function getLngLatFromClientXY(clientX, clientY) {
        const rect = canvasContainer.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        return map.unproject([x, y]);
    }

    function handleStrokeStart(clientX, clientY, rawEvent) {
        if (!isEditingMode || editSubMode !== 'freehand') return;
        ensureEditorMapZoomEnabled();

        const targetEl = rawEvent?.target;
        if (targetEl && targetEl.closest && targetEl.closest('.music-marker, .shared-pin-wrapper, .fleet-truck-marker, .callout-box-marker, .callout-anchor-marker')) {
            return;
        }

        const route = getActiveWorkingRoute();
        if (!route || !Array.isArray(route.points) || route.points.length < 2) return;

        const lngLat = getLngLatFromClientXY(clientX, clientY);
        const pts = route.points;

        // 計算與當前編輯路線所有節點的最近距離
        let minStartDistM = Infinity;
        let closestStartIdx = -1;
        for (let i = 0; i < pts.length; i++) {
            const dM = getDistanceKm(lngLat.lng, lngLat.lat, pts[i].lng, pts[i].lat) * 1000;
            if (dM < minStartDistM) {
                minStartDistM = dM;
                closestStartIdx = i;
            }
        }

        // 若使用者已先點選了某個舊節點 (freehandSpliceStartIdx)，或手指在路線節點 45 公尺內按下，啟動單指手繪
        let activeStartIdx = -1;
        if (minStartDistM <= 45 && closestStartIdx !== -1) {
            activeStartIdx = closestStartIdx;
        } else if (freehandSpliceStartIdx >= 0 && freehandSpliceStartIdx < pts.length) {
            activeStartIdx = freehandSpliceStartIdx;
        } else {
            // 若在遠離路線的空白處單指滑動，保留地圖拖曳平移能力，不強行鎖死地圖
            try { map.dragPan.enable(); } catch (e) {}
            return;
        }

        // 單指開始在路線上畫線時，暫時停用單指 dragPan 避免畫面跟著單指跑，但保持 touchZoomRotate 與 scrollZoom 開啟
        try { map.dragPan.disable(); } catch (e) {}
        ensureEditorMapZoomEnabled();

        isFreehandDrawing = true;
        freehandStartIndex = activeStartIdx;
        const snapPt = pts[activeStartIdx];

        if (freehandSpliceStartIdx === activeStartIdx && freehandDraftCoords.length >= 2) {
            freehandStrokeCoords = [...freehandDraftCoords];
        } else {
            freehandStrokeCoords = [[Number(snapPt.lng.toFixed(6)), Number(snapPt.lat.toFixed(6))]];
        }

        if (getDistanceKm(snapPt.lng, snapPt.lat, lngLat.lng, lngLat.lat) * 1000 >= 3.5) {
            freehandStrokeCoords.push([Number(lngLat.lng.toFixed(6)), Number(lngLat.lat.toFixed(6))]);
        }
        updateFreehandTempLayer(freehandStrokeCoords);

        const promptEl = document.getElementById('editPromptText');
        if (promptEl) {
            promptEl.innerText = "✍️ 正在手繪新路徑... 連回另一舊節點可剪除中間舊路，或向頭尾外拉延伸";
        }
    }

    function handleStrokeMove(clientX, clientY) {
        if (!isFreehandDrawing || !isEditingMode || editSubMode !== 'freehand') return;
        if (freehandStrokeCoords.length === 0) return;

        const lngLat = getLngLatFromClientXY(clientX, clientY);
        const curLng = Number(lngLat.lng.toFixed(6));
        const curLat = Number(lngLat.lat.toFixed(6));
        const [lastLng, lastLat] = freehandStrokeCoords[freehandStrokeCoords.length - 1];
        const distM = getDistanceKm(lastLng, lastLat, curLng, curLat) * 1000;

        if (distM >= 4) {
            if (distM > 10) {
                const steps = Math.ceil(distM / 5);
                for (let s = 1; s <= steps; s++) {
                    const t = s / steps;
                    freehandStrokeCoords.push([
                        Number((lastLng + (curLng - lastLng) * t).toFixed(6)),
                        Number((lastLat + (curLat - lastLat) * t).toFixed(6))
                    ]);
                }
            } else {
                freehandStrokeCoords.push([curLng, curLat]);
            }
            updateFreehandTempLayer(freehandStrokeCoords);
        }
    }

    function handleStrokeEnd() {
        if (!isFreehandDrawing) return;
        isFreehandDrawing = false;
        try { map.dragPan.enable(); } catch (e) {}
        ensureEditorMapZoomEnabled();

        const route = getActiveWorkingRoute();
        const promptEl = document.getElementById('editPromptText');
        if (!route || !Array.isArray(route.points) || route.points.length < 2 || freehandStrokeCoords.length < 2) {
            updateFreehandTempLayer(freehandDraftCoords.length >= 2 ? freehandDraftCoords : []);
            freehandStrokeCoords = [];
            freehandStartIndex = -1;
            return;
        }

        const pts = route.points;
        const startIndex = freehandStartIndex;
        const [endLng, endLat] = freehandStrokeCoords[freehandStrokeCoords.length - 1];

        let strokeLenM = 0;
        for (let i = 1; i < freehandStrokeCoords.length; i++) {
            strokeLenM += getDistanceKm(
                freehandStrokeCoords[i - 1][0], freehandStrokeCoords[i - 1][1],
                freehandStrokeCoords[i][0], freehandStrokeCoords[i][1]
            ) * 1000;
        }
        // 若滑動距離極短 (< 6m)，視為單純點選節點而非畫線
        if (strokeLenM < 6) {
            updateFreehandTempLayer(freehandDraftCoords.length >= 2 ? freehandDraftCoords : []);
            freehandStrokeCoords = [];
            freehandStartIndex = -1;
            return;
        }

        // 計算手繪終點與原路線所有節點的最近距離
        let minEndDistM = Infinity;
        let closestEndIdx = -1;
        for (let i = 0; i < pts.length; i++) {
            const dM = getDistanceKm(endLng, endLat, pts[i].lng, pts[i].lat) * 1000;
            if (dM < minEndDistM) {
                minEndDistM = dM;
                closestEndIdx = i;
            }
        }

        // 情境 A（剪接替換）：終點連回原路線上另一個舊節點（距離 < 45 公尺且非同一點）➔ 自動剪除兩舊節點之間的多餘舊路徑並無縫替換
        if (minEndDistM < 45 && closestEndIdx !== -1 && closestEndIdx !== startIndex) {
            applySpliceBetweenNodes(route, startIndex, closestEndIdx, freehandStrokeCoords);
            freehandSpliceStartIdx = -1;
            freehandDraftCoords = [];
            updateFreehandTempLayer([]);
        }
        // 情境 B（頭尾延伸）：從路線頭尾端點附近（前後 6 點內）向外畫線延伸
        else if (startIndex <= 5 || startIndex >= pts.length - 6) {
            applyExtendFromEndpoint(route, startIndex, freehandStrokeCoords);
            updateFreehandTempLayer([]);
        }
        // 情境 C（分段剪接草稿）：從路線中段某個舊節點畫出新路徑但尚未連回另一舊節點，保留草稿讓使用者可雙指縮放平移後再點選目標舊節點完成剪接
        else {
            freehandSpliceStartIdx = startIndex;
            freehandDraftCoords = [...freehandStrokeCoords];
            updateFreehandTempLayer(freehandDraftCoords);
            renderFreehandSpliceNodes(route);
            if (promptEl) {
                promptEl.innerText = `✂️ 已從節點 #${startIndex + 1} 畫出新路徑草稿！可雙指縮放後點選路線上另一個舊節點完成剪接替換`;
            }
        }

        freehandStrokeCoords = [];
        freehandStartIndex = -1;
    }

    let isMultiTouchGestureActive = false;

    canvasContainer.addEventListener('touchstart', (e) => {
        if (!isEditingMode || editSubMode !== 'freehand') return;
        ensureEditorMapZoomEnabled();
        if (!e.touches) return;

        // 只要偵測到雙指觸控 (e.touches.length >= 2)，立刻中斷當前單指畫線判定，將控制權 100% 交還給地圖執行雙指平移與縮放！
        if (e.touches.length >= 2) {
            isMultiTouchGestureActive = true;
            if (isFreehandDrawing) {
                cancelActiveFreehandStroke(false);
            }
            try { map.dragPan.enable(); } catch (err) {}
            ensureEditorMapZoomEnabled();
            return;
        }

        if (isMultiTouchGestureActive) return;

        if (e.touches.length === 1) {
            const touch = e.touches[0];
            handleStrokeStart(touch.clientX, touch.clientY, e);
        }
    }, { passive: true });

    canvasContainer.addEventListener('touchmove', (e) => {
        if (!isEditingMode || editSubMode !== 'freehand') return;
        if (!e.touches) return;

        // 雙指觸控時立刻中斷單指畫線，絕不攔截事件、絕不呼叫 map.panBy，讓 MapLibre 原生 touchZoomRotate 順暢執行雙指縮放與平移
        if (e.touches.length >= 2) {
            isMultiTouchGestureActive = true;
            if (isFreehandDrawing) {
                cancelActiveFreehandStroke(false);
            }
            try { map.dragPan.enable(); } catch (err) {}
            ensureEditorMapZoomEnabled();
            return;
        }

        if (isMultiTouchGestureActive || !isFreehandDrawing) return;

        // 僅在單指觸控 (e.touches.length === 1) 且正在畫線時執行畫線
        if (e.touches.length === 1) {
            if (e.cancelable) e.preventDefault();
            const touch = e.touches[0];
            handleStrokeMove(touch.clientX, touch.clientY);
        }
    }, { passive: false });

    canvasContainer.addEventListener('touchend', (e) => {
        if (!isEditingMode || editSubMode !== 'freehand') {
            if (!e.touches || e.touches.length === 0) {
                isMultiTouchGestureActive = false;
            }
            return;
        }

        if (isMultiTouchGestureActive) {
            if (isFreehandDrawing) cancelActiveFreehandStroke(false);
            if (!e.touches || e.touches.length === 0) {
                isMultiTouchGestureActive = false;
                try { map.dragPan.enable(); } catch (err) {}
                ensureEditorMapZoomEnabled();
            }
            return;
        }

        if (!e.touches || e.touches.length === 0) {
            handleStrokeEnd();
        }
    }, { passive: true });

    canvasContainer.addEventListener('touchcancel', (e) => {
        if (isFreehandDrawing) cancelActiveFreehandStroke(false);
        if (!e.touches || e.touches.length === 0) {
            isMultiTouchGestureActive = false;
        }
        try { map.dragPan.enable(); } catch (err) {}
        ensureEditorMapZoomEnabled();
    }, { passive: true });

    // 滑鼠單擊拖曳畫線（滾輪縮放 map.scrollZoom 全程保持啟用）
    canvasContainer.addEventListener('mousedown', (e) => {
        if (!isEditingMode || editSubMode !== 'freehand' || e.button !== 0) return;
        handleStrokeStart(e.clientX, e.clientY, e);
    });

    window.addEventListener('mousemove', (e) => {
        if (!isEditingMode || editSubMode !== 'freehand' || !isFreehandDrawing) return;
        handleStrokeMove(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', () => {
        if (!isEditingMode || editSubMode !== 'freehand' || !isFreehandDrawing) return;
        handleStrokeEnd();
    });
})();

document.getElementById('editRouteBtn').onclick = () => {
    const route = savedRoutes[selectedRouteIdx];
    if (!route) return;

    isReviewingPendingMode = false;
    reviewingPendingId = null;
    targetRouteId = null;
    reviewingPendingRoute = null;
    if (pendingReviewBanner) pendingReviewBanner.classList.add('hidden');
    if (pendingReviewActionRow) pendingReviewActionRow.classList.add('hidden');
    if (normalEditActionRow) normalEditActionRow.classList.remove('hidden');

    isEditingMode = true;
    editStep = 0;
    selectedEditNodeIdx = -1;
    freehandUndoStack = [];
    freehandSpliceStartIdx = -1;
    freehandDraftCoords = [];
    if (!Array.isArray(route.callouts)) route.callouts = [];
    originalEventsBackup = JSON.parse(JSON.stringify(route.events || [])); 
    originalPointsBackup = JSON.parse(JSON.stringify(route.points || [])); 
    originalCalloutsBackup = JSON.parse(JSON.stringify(route.callouts || []));

    document.getElementById('routeDetailUI').classList.add('hidden');
    document.getElementById('editRouteBar').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = `編輯：${route.name}`;

    ensureEditorMapZoomEnabled();
    setEditSubMode('path');
    renderEditableRouteMarkers(route);
};

function renderEditableRouteMarkers(route, autoFocusCalloutId = null) {
    clearDomMarkers();
    const pts = route.points;
    if (!pts || pts.length === 0) return;
    addPinMarker([pts[0].lng, pts[0].lat], '<div class="pin-s"><span>S</span></div>');
    addPinMarker([pts[pts.length-1].lng, pts[pts.length-1].lat], '<div class="pin-e"><span>E</span></div>');

    (route.events || []).forEach((ev, idx) => {
        if (ev.type === 'alert') {
            createCompactAlertPinMarker(route, ev, idx);
            return;
        }
        const badgeClass = ev.type === 'on' ? 'music-on-pin' : 'music-off-pin';
        const iconClass = ev.type === 'on' ? 'fa-music' : 'fa-volume-xmark';
        const text = ev.type === 'on' ? '開' : '關';
        const wrapperEl = document.createElement('div');
        wrapperEl.className = 'pin-se-wrapper';
        const markerEl = document.createElement('div');
        markerEl.className = `music-marker ${badgeClass}`;
        markerEl.innerHTML = `<i class="fa-solid ${iconClass}"></i> ${text}`;
        wrapperEl.appendChild(markerEl);
        const m = new maplibregl.Marker({
            element: wrapperEl,
            anchor: 'center',
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        }).setLngLat([ev.lng, ev.lat]).addTo(map);
        domMarkers.push(m);
    });

    (route.points || []).forEach((p, idx) => {
        if (p.is_stop) {
            const wrapperEl = document.createElement('div');
            wrapperEl.className = 'pin-se-wrapper';
            const markerEl = document.createElement('div');
            markerEl.className = `music-marker bg-indigo-600 border border-white shadow-lg cursor-grab active:cursor-grabbing`;
            markerEl.innerHTML = `<i class="fa-regular fa-clock"></i> ${p.scheduled_time} <i class="fa-solid fa-pen ml-1 opacity-70"></i>`;
            wrapperEl.appendChild(markerEl);
            
            const m = new maplibregl.Marker({
                element: wrapperEl,
                anchor: 'center',
                draggable: true,
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            }).setLngLat([p.lng, p.lat]).addTo(map);

            m.on('dragstart', () => {
                pushEditUndoSnapshot(route);
            });

            m.on('dragend', () => {
                const newLngLat = m.getLngLat();
                let minDist = Infinity, newIdx = idx;
                route.points.forEach((rp, i) => {
                    let d = getDistanceKm(newLngLat.lng, newLngLat.lat, rp.lng, rp.lat);
                    if (d < minDist) { minDist = d; newIdx = i; }
                });
                
                if (newIdx !== idx) {
                    route.points[newIdx].is_stop = true;
                    route.points[newIdx].stop_name = p.stop_name;
                    route.points[newIdx].scheduled_time = p.scheduled_time;
                    delete route.points[idx].is_stop; delete route.points[idx].stop_name; delete route.points[idx].scheduled_time;
                }
                renderEditableRouteMarkers(route); 
            });

            markerEl.onclick = (e) => {
                e.stopPropagation();
                document.getElementById('editStopTimeInput').value = p.scheduled_time || "";
                document.getElementById('editStopNameInput').value = p.stop_name || "";
                
                const modal = document.getElementById('editStopModal');
                modal.classList.remove('hidden');

                document.getElementById('btnSaveStopEdit').onclick = () => {
                    const newTime = document.getElementById('editStopTimeInput').value;
                    const newName = document.getElementById('editStopNameInput').value;
                    if (newTime && newName) {
                        pushEditUndoSnapshot(route);
                        route.points[idx].scheduled_time = newTime; 
                        route.points[idx].stop_name = newName;
                        modal.classList.add('hidden');
                        renderEditableRouteMarkers(route);
                    } else { alert("時間與站名不可空白！"); }
                };

                document.getElementById('btnDeleteStop').onclick = () => {
                    if (confirm(`確定要刪除【${p.stop_name}】這個站牌嗎？`)) {
                        pushEditUndoSnapshot(route);
                        delete route.points[idx].is_stop; delete route.points[idx].stop_name; delete route.points[idx].scheduled_time;
                        modal.classList.add('hidden');
                        renderEditableRouteMarkers(route);
                    }
                };

                document.getElementById('btnCancelStopEdit').onclick = () => modal.classList.add('hidden');
            };
            domMarkers.push(m);
        }
    });

    renderRouteCallouts(route, true, autoFocusCalloutId);
}

// ==========================================
// ✏️ 手拉畫路線（手動規劃路線 + OSRM 道路吸附）核心引擎
// ==========================================
let isManualDrawingMode = false;
let manualDrawMusicActive = true; // 預設「🟢 音樂收運（畫綠線）」
let manualDrawSteps = []; // 儲存每一步點擊與該段細分軌跡，支援「↩️ 復原上一步」
let isManualDrawFetching = false;
let manualDrawActionSeq = 0;

const startManualDrawBtn = document.getElementById('startManualDrawBtn');
const manualDrawTopBanner = document.getElementById('manualDrawTopBanner');
const manualDrawPromptBadge = document.getElementById('manualDrawPromptBadge');
const manualDrawPromptText = document.getElementById('manualDrawPromptText');
const manualDrawUI = document.getElementById('manualDrawUI');
const manualDrawStatsNodes = document.getElementById('manualDrawStatsNodes');
const manualDrawStatsDist = document.getElementById('manualDrawStatsDist');
const btnManualMusicOn = document.getElementById('btnManualMusicOn');
const btnManualMusicOff = document.getElementById('btnManualMusicOff');
const btnManualUndo = document.getElementById('btnManualUndo');
const btnManualSave = document.getElementById('btnManualSave');
const btnManualCancel = document.getElementById('btnManualCancel');

function updateManualMusicSwitchUI() {
    if (!btnManualMusicOn || !btnManualMusicOff) return;
    if (manualDrawMusicActive) {
        btnManualMusicOn.className = 'bg-green-600 text-white font-extrabold py-2.5 px-2 rounded-xl text-xs sm:text-sm shadow-md active:scale-95 transition-all flex items-center justify-center gap-1';
        btnManualMusicOff.className = 'bg-transparent text-gray-600 hover:bg-white/60 font-extrabold py-2.5 px-2 rounded-xl text-xs sm:text-sm active:scale-95 transition-all flex items-center justify-center gap-1';
    } else {
        btnManualMusicOn.className = 'bg-transparent text-gray-600 hover:bg-white/60 font-extrabold py-2.5 px-2 rounded-xl text-xs sm:text-sm active:scale-95 transition-all flex items-center justify-center gap-1';
        btnManualMusicOff.className = 'bg-blue-600 text-white font-extrabold py-2.5 px-2 rounded-xl text-xs sm:text-sm shadow-md active:scale-95 transition-all flex items-center justify-center gap-1';
    }
}

if (btnManualMusicOn) {
    btnManualMusicOn.onclick = () => {
        manualDrawMusicActive = true;
        updateManualMusicSwitchUI();
        if (manualDrawSteps.length === 1) {
            manualDrawSteps[0].musicActive = true;
        }
    };
}
if (btnManualMusicOff) {
    btnManualMusicOff.onclick = () => {
        manualDrawMusicActive = false;
        updateManualMusicSwitchUI();
        if (manualDrawSteps.length === 1) {
            manualDrawSteps[0].musicActive = false;
        }
    };
}

// 將 OSRM 或直線的座標串列細分為每 6 公尺一個軌跡點（與高精度 GPS 實車錄製密度一致，確保事後編輯點擊、重播與導航偏離偵測 100% 順暢）
function densifyRoadCoordinates(rawCoords, maxStepMeters = 6) {
    if (!Array.isArray(rawCoords) || rawCoords.length === 0) return [];
    if (rawCoords.length === 1) {
        return [[Number(rawCoords[0][0].toFixed(6)), Number(rawCoords[0][1].toFixed(6))]];
    }

    const result = [[Number(rawCoords[0][0].toFixed(6)), Number(rawCoords[0][1].toFixed(6))]];
    for (let i = 0; i < rawCoords.length - 1; i++) {
        const [lng1, lat1] = rawCoords[i];
        const [lng2, lat2] = rawCoords[i + 1];
        const distMeters = getDistanceKm(lng1, lat1, lng2, lat2) * 1000;

        if (distMeters <= 0.1) continue;

        if (distMeters > maxStepMeters) {
            const steps = Math.ceil(distMeters / maxStepMeters);
            for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                const interpLng = Number((lng1 + (lng2 - lng1) * t).toFixed(6));
                const interpLat = Number((lat1 + (lat2 - lat1) * t).toFixed(6));
                result.push([interpLng, interpLat]);
            }
        } else {
            result.push([Number(lng2.toFixed(6)), Number(lat2.toFixed(6))]);
        }
    }
    return result;
}

// 規範化方位角為 0~360 整數（若無效則回傳 null）
function normalizeValidHeadingDeg(rawHeading) {
    if (typeof rawHeading !== 'number' || isNaN(rawHeading) || !isFinite(rawHeading)) {
        return null;
    }
    return ((Math.round(rawHeading) % 360) + 360) % 360;
}

// 呼叫 OSRM 道路吸附 API（強制 continue_straight=true 禁止途經點原地迴轉、approaches=curb 台灣靠右順向停靠、並支援起點 bearings 車頭方向角）
async function fetchOsrmRoadGeometry(lng1, lat1, lng2, lat2, options = {}) {
    const validHeading = normalizeValidHeadingDeg(options?.startHeading);
    const bearingsQuery = validHeading !== null ? `&bearings=${validHeading},45;` : '';
    const approachCandidates = [
        options?.originUnrestricted ? 'unrestricted;curb' : 'curb;curb',
        'unrestricted;curb'
    ];

    for (const approachesParam of approachCandidates) {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson&continue_straight=true&approaches=${approachesParam}${bearingsQuery}`;
        try {
            const res = await fetchWithTimeout(osrmUrl, {}, 4000);
            if (!res.ok) continue;
            const data = await res.json();
            const coords = data?.routes?.[0]?.geometry?.coordinates;
            if (data?.code === 'Ok' && Array.isArray(coords) && coords.length >= 2) {
                // 確保起點與前一段終點座標完全銜接無縫隙
                const alignedCoords = [[lng1, lat1], ...coords.slice(1)];
                let endHeading = validHeading;
                if (alignedCoords.length >= 2) {
                    const pPrev = alignedCoords[alignedCoords.length - 2];
                    const pLast = alignedCoords[alignedCoords.length - 1];
                    if (pPrev[0] !== pLast[0] || pPrev[1] !== pLast[1]) {
                        endHeading = getBearing(pPrev[0], pPrev[1], pLast[0], pLast[1]);
                    }
                }
                return { coords: alignedCoords, usedOsrm: true, endHeading };
            }
        } catch (err) {
            // 單次嘗試失敗或超時，繼續嘗試備援參數
        }
    }

    // 若帶入 bearings 在窄巷單行道無解，嘗試保留 continue_straight=true 與 approaches=unrestricted;curb
    try {
        const fallbackUrl = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson&continue_straight=true&approaches=unrestricted;curb`;
        const res = await fetchWithTimeout(fallbackUrl, {}, 3500);
        if (res.ok) {
            const data = await res.json();
            const coords = data?.routes?.[0]?.geometry?.coordinates;
            if (data?.code === 'Ok' && Array.isArray(coords) && coords.length >= 2) {
                const alignedCoords = [[lng1, lat1], ...coords.slice(1)];
                let endHeading = validHeading;
                if (alignedCoords.length >= 2) {
                    const pPrev = alignedCoords[alignedCoords.length - 2];
                    const pLast = alignedCoords[alignedCoords.length - 1];
                    if (pPrev[0] !== pLast[0] || pPrev[1] !== pLast[1]) {
                        endHeading = getBearing(pPrev[0], pPrev[1], pLast[0], pLast[1]);
                    }
                }
                return { coords: alignedCoords, usedOsrm: true, endHeading };
            }
        }
    } catch (e) {}

    return {
        coords: [[lng1, lat1], [lng2, lat2]],
        usedOsrm: false,
        endHeading: getBearing(lng1, lat1, lng2, lat2)
    };
}

// 由 manualDrawSteps 建構與 GPS 實車錄製 100% 相同結構的 points、events 與總距離
function buildManualRouteFromSteps() {
    if (manualDrawSteps.length === 0) {
        return { points: [], events: [], totalDistKm: 0 };
    }

    const baseTime = Date.now();
    let curTime = baseTime;
    const points = [];
    const events = [];
    let totalDistKm = 0;

    if (manualDrawSteps.length === 1) {
        const [lng0, lat0] = manualDrawSteps[0].clickLngLat;
        const m0 = Boolean(manualDrawSteps[0].musicActive);
        points.push({
            lng: lng0,
            lat: lat0,
            time: curTime,
            musicActive: m0,
            music: m0,
            bearing: 0
        });
        return { points, events, totalDistKm: 0 };
    }

    const firstStepMusic = Boolean(manualDrawSteps[1].musicActive);
    const startCoord = manualDrawSteps[1].densifiedCoords?.[0] || manualDrawSteps[0].clickLngLat;
    points.push({
        lng: startCoord[0],
        lat: startCoord[1],
        time: curTime,
        musicActive: firstStepMusic,
        music: firstStepMusic,
        bearing: 0
    });

    if (firstStepMusic) {
        events.push({
            type: 'on',
            lng: startCoord[0],
            lat: startCoord[1],
            ptIdx: 0,
            bearing: 0
        });
    }

    for (let sIdx = 1; sIdx < manualDrawSteps.length; sIdx++) {
        const step = manualDrawSteps[sIdx];
        const segMusic = Boolean(step.musicActive);
        const segCoords = step.densifiedCoords || [];
        const prevMusic = Boolean(points[points.length - 1].musicActive);

        if (sIdx > 1 && segMusic !== prevMusic) {
            const transIdx = points.length - 1;
            const transPt = points[transIdx];
            events.push({
                type: segMusic ? 'on' : 'off',
                lng: transPt.lng,
                lat: transPt.lat,
                ptIdx: transIdx,
                bearing: transPt.bearing || 0
            });
        }

        for (let cIdx = 1; cIdx < segCoords.length; cIdx++) {
            const [lng, lat] = segCoords[cIdx];
            const prevPt = points[points.length - 1];
            const dKm = getDistanceKm(prevPt.lng, prevPt.lat, lng, lat);
            if (dKm * 1000 < 0.05) continue;

            const segBearing = getBearing(prevPt.lng, prevPt.lat, lng, lat);
            totalDistKm += dKm;
            // 依約 20 km/h 清運車速遞增時間戳記
            const stepMs = Math.max(400, Math.round((dKm / 20) * 3600 * 1000));
            curTime += stepMs;

            points.push({
                lng,
                lat,
                time: curTime,
                musicActive: segMusic,
                music: segMusic,
                bearing: segBearing
            });
        }
    }

    if (points.length >= 2) {
        points[0].bearing = points[1].bearing || 0;
        if (events.length > 0 && events[0].ptIdx === 0) {
            events[0].bearing = points[0].bearing;
        }
    }

    return { points, events, totalDistKm };
}

function renderManualDrawPreview() {
    const { points, events, totalDistKm } = buildManualRouteFromSteps();
    const visualPts = computeVisualRightOffsetCoords(points);
    clearDomMarkers();
    updateRouteLayers(points);

    if (manualDrawSteps.length >= 1) {
        const startLngLat = visualPts.length > 0
            ? [visualPts[0].lng, visualPts[0].lat]
            : manualDrawSteps[0].clickLngLat;
        addPinMarker(startLngLat, '<div class="pin-s pointer-events-none"><span>S</span></div>');
    }

    // 標示各個手拉點擊節點與終點（若該段為來回重複路段，節點圖示同步對齊右側平行偏移線條）
    let cumulativePtIdx = 0;
    for (let i = 1; i < manualDrawSteps.length; i++) {
        const coords = manualDrawSteps[i].densifiedCoords || [];
        cumulativePtIdx = Math.min(points.length - 1, cumulativePtIdx + Math.max(1, coords.length - 1));
        const rawEndCoord = coords.length > 0 ? coords[coords.length - 1] : manualDrawSteps[i].clickLngLat;
        let displayEndCoord = rawEndCoord;
        if (visualPts.length > 0) {
            // 找出對應此步驟終點的最近軌跡點並套用相同視覺偏移
            let bestIdx = cumulativePtIdx;
            let minD = Infinity;
            for (let k = Math.max(0, cumulativePtIdx - 8); k < points.length; k++) {
                const d = getDistanceKm(rawEndCoord[0], rawEndCoord[1], points[k].lng, points[k].lat);
                if (d <= minD) {
                    minD = d;
                    bestIdx = k;
                }
            }
            if (visualPts[bestIdx]) {
                displayEndCoord = [visualPts[bestIdx].lng, visualPts[bestIdx].lat];
            }
        }
        const isLast = (i === manualDrawSteps.length - 1);
        const isMusic = Boolean(manualDrawSteps[i].musicActive);
        if (isLast) {
            addPinMarker(displayEndCoord, `<div class="w-6 h-6 rounded-full ${isMusic ? 'bg-green-600' : 'bg-blue-600'} text-white font-black text-[11px] border-2 border-white shadow-lg flex items-center justify-center pointer-events-none">${i}</div>`);
        } else {
            addPinMarker(displayEndCoord, `<div class="w-4 h-4 rounded-full bg-white border-[4px] ${isMusic ? 'border-green-600' : 'border-blue-600'} shadow pointer-events-none"></div>`);
        }
    }

    // 標示音樂開關切換點
    events.forEach(ev => {
        if (ev.type === 'on') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-on-pin pointer-events-none"><i class="fa-solid fa-music"></i> 開</div>`);
        } else if (ev.type === 'off') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-off-pin pointer-events-none"><i class="fa-solid fa-volume-xmark"></i> 關</div>`);
        }
    });

    if (manualDrawStatsNodes) {
        manualDrawStatsNodes.innerHTML = `<i class="fa-solid fa-location-dot"></i> 已點選 ${manualDrawSteps.length} 個節點`;
    }
    if (manualDrawStatsDist) {
        manualDrawStatsDist.textContent = `總距離 ${totalDistKm.toFixed(2)} km`;
    }
    if (btnManualUndo) {
        btnManualUndo.disabled = (manualDrawSteps.length === 0 && !isManualDrawFetching);
    }
}

function enterManualDrawMode() {
    if (isRecording) return;
    isManualDrawingMode = true;
    manualDrawMusicActive = true;
    manualDrawSteps = [];
    isManualDrawFetching = false;
    manualDrawActionSeq++;

    ensureEditorMapZoomEnabled();
    try { map.dragPan.enable(); } catch (e) {}
    updateManualMusicSwitchUI();
    setCameraFollow(false);

    document.getElementById('mainUI').classList.add('hidden');
    document.getElementById('routeDetailUI').classList.add('hidden');
    document.getElementById('playbackUI').classList.add('hidden');
    document.getElementById('topBackBtn').classList.add('hidden');

    if (manualDrawTopBanner) manualDrawTopBanner.classList.remove('hidden');
    if (manualDrawPromptText) manualDrawPromptText.textContent = '請依序點擊地圖上的起點與轉彎路口（支援雙指與滾輪縮放）';
    if (manualDrawUI) manualDrawUI.classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = '✏️ 手拉畫路線';

    clearDomMarkers();
    updateRouteLayers([]);
    map.getSource('bg-route')?.setData(emptyGeoJSON());
    renderManualDrawPreview();

    window.history.pushState({ pwa: true }, '');
}

function exitManualDrawModeToMain() {
    isManualDrawingMode = false;
    manualDrawSteps = [];
    isManualDrawFetching = false;
    manualDrawActionSeq++;

    if (manualDrawTopBanner) manualDrawTopBanner.classList.add('hidden');
    if (manualDrawUI) manualDrawUI.classList.add('hidden');
    backToMain();
}

if (startManualDrawBtn) {
    startManualDrawBtn.onclick = () => enterManualDrawMode();
}

if (btnManualUndo) {
    btnManualUndo.onclick = () => {
        if (!isManualDrawingMode) return;
        manualDrawActionSeq++;
        isManualDrawFetching = false;
        if (manualDrawSteps.length > 0) {
            manualDrawSteps.pop();
            vibrate(30);
        }
        if (manualDrawPromptText) {
            manualDrawPromptText.textContent = manualDrawSteps.length === 0
                ? '請依序點擊地圖上的起點與轉彎路口（支援雙指與滾輪縮放）'
                : '已復原上一步，請點擊下一個轉彎路口';
        }
        renderManualDrawPreview();
    };
}

if (btnManualCancel) {
    btnManualCancel.onclick = () => {
        if (!isManualDrawingMode) return;
        if (manualDrawSteps.length >= 2) {
            if (!confirm('確定要放棄目前手拉繪製的路線並返回主畫面嗎？')) return;
        }
        exitManualDrawModeToMain();
    };
}

if (btnManualSave) {
    btnManualSave.onclick = () => {
        if (!isManualDrawingMode) return;
        if (isManualDrawFetching) {
            alert('⏳ 正在貼齊最後一段道路，請稍候 1 秒再按完成儲存！');
            return;
        }

        const { points, events, totalDistKm } = buildManualRouteFromSteps();
        if (manualDrawSteps.length < 2 || points.length < 2) {
            alert('請至少在地圖上點擊 2 個位置（起點與轉彎路口）才能儲存路線！');
            return;
        }

        const defaultName = "鶯歌路線 " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const name = prompt("手拉路線規劃完成！請輸入路線名稱（如：尖山線第一趟）：", defaultName);
        if (!name || !name.trim()) return;

        const savedAuthor = localStorage.getItem('fleet_user_name') || localStorage.getItem('yinggeRouteLastAuthor') || '凱哥';
        const authorInput = prompt("請輸入這條路線的創作者署名：", savedAuthor);
        if (authorInput === null) return;
        const author = authorInput.trim() || "熱心隊員";
        localStorage.setItem('yinggeRouteLastAuthor', author);

        const estElapsedSec = Math.max(10, Math.round((totalDistKm / 20) * 3600));
        const mins = Math.floor(estElapsedSec / 60), secs = estElapsedSec % 60;
        const nowId = Date.now();
        const trimmedName = name.trim();

        const existingMatch = savedRoutes.find(r => !r?.isPendingPreview && isSameRouteIdentity(r, { name: trimmedName }));
        const nextVer = existingMatch ? (getRouteVersion(existingMatch) + 1) : 1;

        const newRoute = {
            id: existingMatch?.id || nowId,
            originId: existingMatch?.originId || nowId,
            routeId: existingMatch?.routeId || generateRouteId(),
            name: trimmedName,
            author,
            routeVersion: nextVer,
            updatedAt: nowId,
            date: new Date(nowId).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
            createdAt: new Date(nowId).toISOString(),
            distance: totalDistKm.toFixed(2),
            timeStr: `${mins}m ${secs}s`,
            points: points,
            events: events,
            alerts: [],
            warnings: []
        };

        const savedItem = upsertLocalRouteFromCloud(newRoute);
        persistSavedRoutesToStorage();

        // 退出手拉模式並直接進入該路線的預覽詳情頁（可立即點擊「編輯」進行拖曳微調、手繪剪接或刪除多餘路線）
        isManualDrawingMode = false;
        manualDrawSteps = [];
        isManualDrawFetching = false;
        manualDrawActionSeq++;
        if (manualDrawTopBanner) manualDrawTopBanner.classList.add('hidden');
        if (manualDrawUI) manualDrawUI.classList.add('hidden');

        const targetIdx = Math.max(0, savedRoutes.findIndex(r => r === savedItem || isSameRouteIdentity(r, savedItem)));
        window.openRouteDetail(targetIdx);
    };
}

async function handleManualDrawMapClick(e) {
    if (!isManualDrawingMode || isManualDrawFetching) return;
    const origTarget = e.originalEvent?.target;
    if (origTarget && origTarget.closest && origTarget.closest('.shared-pin-wrapper, .fleet-truck-marker')) {
        return;
    }

    const lng = Number(e.lngLat.lng.toFixed(6));
    const lat = Number(e.lngLat.lat.toFixed(6));

    // 第 1 個點：設定起點 (S)
    if (manualDrawSteps.length === 0) {
        manualDrawSteps.push({
            clickLngLat: [lng, lat],
            musicActive: manualDrawMusicActive,
            densifiedCoords: [[lng, lat]],
            usedOsrm: true
        });
        vibrate(30);
        if (manualDrawPromptText) {
            manualDrawPromptText.textContent = '請依序點擊地圖上的起點與轉彎路口（已設定起點 S）';
        }
        renderManualDrawPreview();
        return;
    }

    // 第 2 個點起：呼叫 OSRM 沿著道路自動貼齊（超時 3 秒自動降級為直線）
    const prevStep = manualDrawSteps[manualDrawSteps.length - 1];
    const prevCoords = prevStep.densifiedCoords || [prevStep.clickLngLat];
    const [lng1, lat1] = prevCoords[prevCoords.length - 1];
    const segMusic = manualDrawMusicActive;

    if (manualDrawSteps.length === 1) {
        manualDrawSteps[0].musicActive = segMusic;
    }

    isManualDrawFetching = true;
    const currentSeq = ++manualDrawActionSeq;
    if (btnManualUndo) btnManualUndo.disabled = false;
    if (manualDrawPromptText) {
        manualDrawPromptText.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> 正在沿道路自動貼齊路徑...';
    }

    const { coords: rawRoadCoords, usedOsrm } = await fetchOsrmRoadGeometry(lng1, lat1, lng, lat);
    if (!isManualDrawingMode || currentSeq !== manualDrawActionSeq) return;

    const densified = densifyRoadCoordinates(rawRoadCoords, 6);
    isManualDrawFetching = false;

    manualDrawSteps.push({
        clickLngLat: [lng, lat],
        musicActive: segMusic,
        densifiedCoords: densified.length >= 2 ? densified : [[lng1, lat1], [lng, lat]],
        usedOsrm
    });

    vibrate(30);
    if (manualDrawPromptText) {
        manualDrawPromptText.textContent = usedOsrm
            ? '請依序點擊地圖上的起點與轉彎路口（已自動沿馬路貼齊）'
            : '請依序點擊地圖上的起點與轉彎路口（已使用直線連接）';
    }
    renderManualDrawPreview();
}

map.on('click', (e) => {
    const origTarget = e.originalEvent?.target;
    if (origTarget && origTarget.closest && origTarget.closest('.alert-compact-pin, .alert-popup-wrapper, .callout-box-marker, .callout-anchor-marker, .furniture-pin-wrapper, .furniture-popup-wrapper')) {
        return;
    }
    // 點擊地圖空白處自動收合已展開的警示氣泡卡片與家具點位卡片
    if (activeAlertPopupMarker) {
        closeActiveAlertPopup();
    }
    if (typeof closeFurniturePinPopup === 'function') {
        closeFurniturePinPopup();
    }

    if (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive) {
        if (typeof handleFurnitureMapClick === 'function') {
            handleFurnitureMapClick(e);
        }
        return;
    }

    if (isManualDrawingMode) {
        handleManualDrawMapClick(e);
        return;
    }
    if (!isEditingMode) return;
    const route = getActiveWorkingRoute();
    if (!route || !Array.isArray(route.points) || route.points.length === 0) return;

    if (origTarget && origTarget.closest && origTarget.closest('.music-marker, .shared-pin-wrapper, .fleet-truck-marker, .alert-compact-pin, .alert-popup-wrapper, .callout-box-marker, .callout-anchor-marker')) {
        return;
    }

    if (editSubMode === 'callout') {
        const clickLng = Number(e.lngLat.lng.toFixed(6));
        const clickLat = Number(e.lngLat.lat.toFixed(6));
        const promptEl = document.getElementById('editPromptText');

        // 第一步（錨點）：點擊路線或路口設定 anchorLngLat（若點擊處距離路線節點 < 18m 則自動貼齊路線節點）
        if (!pendingCalloutAnchorLngLat) {
            let anchorLng = clickLng;
            let anchorLat = clickLat;
            let minSnapM = Infinity;
            let bestPt = null;
            for (let i = 0; i < route.points.length; i++) {
                const dM = getDistanceKm(clickLng, clickLat, route.points[i].lng, route.points[i].lat) * 1000;
                if (dM < minSnapM) {
                    minSnapM = dM;
                    bestPt = route.points[i];
                }
            }
            if (bestPt && minSnapM <= 18) {
                anchorLng = Number(bestPt.lng.toFixed(6));
                anchorLat = Number(bestPt.lat.toFixed(6));
            }

            clearPendingCalloutAnchor();
            pendingCalloutAnchorLngLat = [anchorLng, anchorLat];

            const wrapEl = document.createElement('div');
            wrapEl.className = 'callout-anchor-marker';
            const dotEl = document.createElement('div');
            dotEl.className = 'callout-anchor-dot is-pending';
            wrapEl.appendChild(dotEl);

            pendingCalloutAnchorMarker = new maplibregl.Marker({
                element: wrapEl,
                anchor: 'center',
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            })
                .setLngLat(pendingCalloutAnchorLngLat)
                .addTo(map);

            vibrate(25);
            if (promptEl) {
                promptEl.innerText = "📌 已設定錨點！現在請點擊旁邊空曠處放置備忘文字框";
            }
            return;
        }

        // 第二步（拉線與文字框）：點擊旁邊空曠處設定 boxLngLat，自動繪製高對比引線並建立可編輯文字框
        const anchorCoords = [...pendingCalloutAnchorLngLat];
        clearPendingCalloutAnchor();

        pushEditUndoSnapshot(route);
        if (!Array.isArray(route.callouts)) {
            route.callouts = [];
        }
        const newCalloutId = 'callout_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        route.callouts.push({
            id: newCalloutId,
            anchorLngLat: anchorCoords,
            boxLngLat: [clickLng, clickLat],
            text: '',
            width: 162,
            height: 88,
            style: 'yellow-black'
        });

        vibrate([30, 20, 30]);
        renderEditableRouteMarkers(route, newCalloutId);
        if (promptEl) {
            promptEl.innerText = "✅ 已放置引線備忘框！可直接輸入多行文字、按住標題列拖移或拉右下角調整大小（點地圖可新增下一個）";
        }
        return;
    } else if (editSubMode === 'marker') {
        let minDist = Infinity, closestIdx = -1;
        route.points.forEach((p, idx) => {
            let d = getDistanceKm(e.lngLat.lng, e.lngLat.lat, p.lng, p.lat);
            if (d < minDist) { minDist = d; closestIdx = idx; }
        });

        if (minDist * 1000 > 50) { alert("請點擊在路線軌跡附近！"); return; }

        if (editStep === 0) {
            editStartIndex = closestIdx; 
            if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
            const el = document.createElement('div');
            el.innerHTML = `<div class="music-marker bg-blue-600 border-2 border-white px-3 py-1 shadow-lg text-sm text-white">📍 選擇位置中...</div>`;
            tempMarkerA = new maplibregl.Marker({
                element: el,
                anchor: 'center',
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            }).setLngLat([route.points[closestIdx].lng, route.points[closestIdx].lat]).addTo(map);
            
            window.currentEditData = { route, editStartIndex };
            document.getElementById('customActionModal').classList.remove('hidden');
        } else if (editStep === 1) {
            pushEditUndoSnapshot(route);
            let editEndIndex = closestIdx;
            let start = Math.min(editStartIndex, editEndIndex);
            let end = Math.max(editStartIndex, editEndIndex);
            
            const action = window.currentEditData.action;
            const turnOn = (action === '1');
            for (let i = start; i <= end; i++) {
                route.points[i].musicActive = turnOn;
                route.points[i].music = turnOn;
            }
            
            syncRouteMarkersAndIndicesAfterSpline(route);

            if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
            editStep = 0;
            document.getElementById('editPromptText').innerText = "🛠️ 區段設定完成！請點擊軌跡選擇下一個『目標點』";
            updateRouteLayers(route.points); renderEditableRouteMarkers(route);
        }
    } else if (editSubMode === 'path') {
        // 點擊軌跡線條時：自動選取最近的節點（同時比對真實座標與右側平行偏移後的視覺座標）並顯示預設收合的迷你小膠囊抽屜鈕
        const visualPts = computeVisualRightOffsetCoords(route.points);
        let minDistToNode = Infinity;
        let closestNodeIdx = -1;
        for (let i = 0; i < route.points.length; i++) {
            const dRaw = getDistanceKm(e.lngLat.lng, e.lngLat.lat, route.points[i].lng, route.points[i].lat) * 1000;
            const vPt = visualPts[i] || route.points[i];
            const dVis = getDistanceKm(e.lngLat.lng, e.lngLat.lat, vPt.lng, vPt.lat) * 1000;
            const d = Math.min(dRaw, dVis);
            if (d < minDistToNode) {
                minDistToNode = d;
                closestNodeIdx = i;
            }
        }

        if (minDistToNode > 38 || closestNodeIdx === -1) {
            if (selectedEditNodeIdx !== -1) {
                selectedEditNodeIdx = -1;
                isNodeTrimDrawerExpanded = false;
                renderPathEditNodes(route);
                updateNodeTrimPanelUI(route);
                const promptEl = document.getElementById('editPromptText');
                if (promptEl) {
                    promptEl.innerText = "🖐️ 按住節點可拖曳微調，點擊「+」插入轉折點，點擊節點可刪除或修剪頭尾";
                }
            }
            return;
        }

        route.points[closestNodeIdx].isKeyNode = true;
        selectedEditNodeIdx = closestNodeIdx;
        isNodeTrimDrawerExpanded = false;
        vibrate(20);
        renderPathEditNodes(route);
        updateNodeTrimPanelUI(route);
        const promptEl = document.getElementById('editPromptText');
        if (promptEl) {
            promptEl.innerText = `🎯 已選取節點 #${closestNodeIdx + 1}：點擊上方「✂️ #${closestNodeIdx + 1} ▸」可展開修剪抽屜`;
        }
    } else if (editSubMode === 'freehand') {
        // 「手繪延伸／剪接」模式下點擊地圖：
        // 1. 若點擊處靠近路線既有節點 (< 30m，含右側平行偏移視覺位置)，視同點選該舊節點（設定剪接起點或完成剪接替換）
        const pts = route.points;
        const visualPts = computeVisualRightOffsetCoords(pts);
        let minDistM = Infinity;
        let closestIdx = -1;
        for (let i = 0; i < pts.length; i++) {
            const dRaw = getDistanceKm(e.lngLat.lng, e.lngLat.lat, pts[i].lng, pts[i].lat) * 1000;
            const vPt = visualPts[i] || pts[i];
            const dVis = getDistanceKm(e.lngLat.lng, e.lngLat.lat, vPt.lng, vPt.lat) * 1000;
            const dM = Math.min(dRaw, dVis);
            if (dM < minDistM) {
                minDistM = dM;
                closestIdx = i;
            }
        }

        if (minDistM <= 28 && closestIdx !== -1) {
            handleFreehandNodeClick(route, closestIdx);
            return;
        }

        const clickCoord = [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))];

        // 2. 若尚未選取舊節點，或目前選取的是頭尾端點 (0 或 pts.length - 1)，點擊地圖空白處直接從頭尾加點延伸！
        if (freehandSpliceStartIdx === -1 || freehandSpliceStartIdx === pts.length - 1 || freehandSpliceStartIdx === 0) {
            let anchorIdx = freehandSpliceStartIdx;
            if (anchorIdx === -1) {
                const dHead = getDistanceKm(clickCoord[0], clickCoord[1], pts[0].lng, pts[0].lat);
                const dTail = getDistanceKm(clickCoord[0], clickCoord[1], pts[pts.length - 1].lng, pts[pts.length - 1].lat);
                anchorIdx = (dHead < dTail * 0.6) ? 0 : (pts.length - 1);
            }
            const anchorPt = pts[anchorIdx];
            applyExtendFromEndpoint(route, anchorIdx, [
                [Number(anchorPt.lng.toFixed(6)), Number(anchorPt.lat.toFixed(6))],
                clickCoord
            ]);
            return;
        }

        // 3. 若已選取某個中段舊節點 A，點擊地圖空白處則依序累積剪接路徑草稿點，待點選另一舊節點 B 時一併剪除替換
        if (freehandDraftCoords.length === 0) {
            const startPt = pts[freehandSpliceStartIdx];
            freehandDraftCoords.push([Number(startPt.lng.toFixed(6)), Number(startPt.lat.toFixed(6))]);
        }
        freehandDraftCoords.push(clickCoord);
        updateFreehandTempLayer(freehandDraftCoords);
        vibrate(20);
        const promptEl = document.getElementById('editPromptText');
        if (promptEl) {
            promptEl.innerText = `✍️ 已加入新路徑折點（共 ${freehandDraftCoords.length - 1} 點），請再點選路線上另一個舊節點完成剪接替換`;
        }
    }
});

window.handleRouteAction = function(action) {
    document.getElementById('customActionModal').classList.add('hidden');
    if (!window.currentEditData) return;

    const { route, editStartIndex } = window.currentEditData;

    if (action === '1' || action === '2') {
        window.currentEditData.action = action;
        editStep = 1; 
        document.getElementById('editPromptText').innerText = "🎵 已選擇音樂動作！請點選軌跡另一處作為『區段終點 (B點)』";
        return;
    } 
    else if (action === '3') {
        pushEditUndoSnapshot(route);
        openAlertModalForCreate(route, editStartIndex);
        return;
    } 
    else if (action === '5') {
        const time = prompt("請輸入表定時間 (格式如 17:30)：", "17:00");
        const name = prompt("請輸入站點名稱 (如：火車站前)：", "新增定點");
        if (time && name) {
            pushEditUndoSnapshot(route);
            route.points[editStartIndex].is_stop = true;
            route.points[editStartIndex].scheduled_time = time;
            route.points[editStartIndex].stop_name = name;
        }
    }
    
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    editStep = 0;
    document.getElementById('editPromptText').innerText = "🛠️ 標記完成！請點擊地圖軌跡選擇下一個『目標點』";
    updateRouteLayers(route.points); renderEditableRouteMarkers(route);
};

document.getElementById('saveEditBtn').onclick = () => {
    isEditingMode = false;
    selectedEditNodeIdx = -1;
    clearPathEditMarkers();
    clearPendingCalloutAnchor();
    cancelActiveFreehandStroke(true);
    freehandUndoStack = [];
    updateUndoFreehandBtnUI();
    updateNodeTrimPanelUI(null);
    try { map.dragPan.enable(); } catch (e) {}
    ensureEditorMapZoomEnabled();
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    document.getElementById('editRouteBar').classList.add('hidden');

    const editedRoute = savedRoutes[selectedRouteIdx];
    if (editedRoute && Array.isArray(editedRoute.points) && editedRoute.points.length >= 2) {
        if (!Array.isArray(editedRoute.callouts)) {
            editedRoute.callouts = [];
        }
        // 自動重新計算總距離 (km) 與各語音標記點的對應路徑索引
        syncRouteMarkersAndIndicesAfterSpline(editedRoute, null, true);

        // 儲存自動升版：routeVersion + 1、更新 updatedAt 時間戳，並原地覆蓋本機舊檔
        const nowTs = Date.now();
        editedRoute.routeVersion = getRouteVersion(editedRoute) + 1;
        editedRoute.updatedAt = nowTs;
        editedRoute.date = new Date(nowTs).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        savedRoutes[selectedRouteIdx] = editedRoute;
    }

    deduplicateSavedRoutes(false);
    persistSavedRoutesToStorage().then(() => {
        renderHistoryList();
        document.getElementById('topBackBtn').classList.remove('hidden');
        window.openRouteDetail(selectedRouteIdx);
        if (editedRoute) {
            showNavAlert('✅', `已儲存「${editedRoute.name}」並自動升版為 v${editedRoute.routeVersion}！`, 'bg-emerald-600');
        }
    }).catch((err) => {
        alert("儲存失敗！可能是手機儲存空間不足，請清理後再試。");
        console.error(err);
    });
};

document.getElementById('cancelEditBtn').onclick = () => {
    isEditingMode = false;
    selectedEditNodeIdx = -1;
    clearPathEditMarkers();
    clearPendingCalloutAnchor();
    cancelActiveFreehandStroke(true);
    freehandUndoStack = [];
    updateUndoFreehandBtnUI();
    updateNodeTrimPanelUI(null);
    try { map.dragPan.enable(); } catch (e) {}
    ensureEditorMapZoomEnabled();
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    document.getElementById('editRouteBar').classList.add('hidden');
    
    savedRoutes[selectedRouteIdx].events = originalEventsBackup;
    savedRoutes[selectedRouteIdx].points = originalPointsBackup;
    savedRoutes[selectedRouteIdx].callouts = originalCalloutsBackup;
    syncRouteMarkersAndIndicesAfterSpline(savedRoutes[selectedRouteIdx]);
    
    document.getElementById('topBackBtn').classList.remove('hidden');
    window.openRouteDetail(selectedRouteIdx);
};

// 結束重播後自動歸位：將 isReplaying 設回 false，並立即將黃色垃圾車 Marker 與地圖鏡頭恢復對齊至使用者的最新真實 GPS 位置
function restoreRealGpsAfterReplay(alignCamera = true) {
    isReplaying = false;
    window.isReplaying = false;
    if (vehicleAnimFrameId !== null) {
        cancelAnimationFrame(vehicleAnimFrameId);
        vehicleAnimFrameId = null;
    }

    const applyRealGpsToMarkerAndCamera = (lng, lat, heading) => {
        lastKnownLngLat = [lng, lat];
        currentHeading = typeof heading === 'number' && !isNaN(heading) ? heading : 0;
        vehicleVisualLngLat = [lng, lat];
        vehicleVisualHeading = currentHeading;
        if (vehicleMarker) {
            vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);
        }
        if (alignCamera && map) {
            setCameraFollow(true);
            map.easeTo({
                center: lastKnownLngLat,
                zoom: Math.max(map.getZoom(), 17),
                bearing: isHeadingUpMode ? currentHeading : 0,
                offset: [0, 100],
                duration: 450
            });
        }
    };

    if (lastValidGpsLng !== null && lastValidGpsLat !== null) {
        applyRealGpsToMarkerAndCamera(lastValidGpsLng, lastValidGpsLat, lastRealGpsHeading);
    } else if ('geolocation' in navigator) {
        // 若尚未有歷史真實定位快取，立即主動請求一次最新 GPS 並同步歸位
        if (vehicleMarker && Array.isArray(lastKnownLngLat)) {
            vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);
        }
        navigator.geolocation.getCurrentPosition(pos => {
            const filtered = processFilteredGpsPosition(pos);
            const lng = filtered ? filtered.lng : pos.coords.longitude;
            const lat = filtered ? filtered.lat : pos.coords.latitude;
            const head = filtered ? filtered.heading : lastRealGpsHeading;
            if (!isReplaying && typeof lng === 'number' && typeof lat === 'number') {
                applyRealGpsToMarkerAndCamera(lng, lat, head);
            }
        }, () => {}, { enableHighAccuracy: true, timeout: 6000 });
    }
}

function backToMain() {
    const wasReplaying = isReplaying;
    stopSmoothPlayback();
    VoiceQueue.clear();
    activeFollowGpsHandler = null;
    if (followWatchId !== null) {
        navigator.geolocation.clearWatch(followWatchId);
        followWatchId = null;
    }
    if (window.tacticalTimer !== null) {
        clearInterval(window.tacticalTimer);
        window.tacticalTimer = null;
    }
    isEditingMode = false;
    isReviewingPendingMode = false;
    reviewingPendingId = null;
    targetRouteId = null;
    reviewingPendingRoute = null;
    if (pendingReviewBanner) pendingReviewBanner.classList.add('hidden');
    if (pendingReviewActionRow) pendingReviewActionRow.classList.add('hidden');
    if (normalEditActionRow) normalEditActionRow.classList.remove('hidden');
    document.getElementById('editRouteBar')?.classList.add('hidden');
    selectedEditNodeIdx = -1;
    clearPathEditMarkers();
    cancelActiveFreehandStroke(true);
    freehandUndoStack = [];
    updateUndoFreehandBtnUI();
    updateNodeTrimPanelUI(null);
    try { map.dragPan.enable(); } catch (e) {}
    ensureEditorMapZoomEnabled();
    isManualDrawingMode = false;
    manualDrawSteps = [];
    isManualDrawFetching = false;
    manualDrawActionSeq++;
    if (manualDrawTopBanner) manualDrawTopBanner.classList.add('hidden');
    if (manualDrawUI) manualDrawUI.classList.add('hidden');
    document.getElementById('startManualDrawBtn')?.classList.remove('hidden');
    document.getElementById('followStopBtn').classList.add('hidden');
    document.getElementById('tacticalStopBtn').classList.add('hidden');
    document.getElementById('tacticalQuickAlertBtn')?.classList.add('hidden');
    if (typeof closeQuickNavAlertModal === 'function') closeQuickNavAlertModal();
    document.getElementById('tacticalTimePanel').classList.add('hidden');
    document.getElementById('musicAlertBanner').classList.add('hidden');
    document.getElementById('routeDetailUI').classList.add('hidden');
    document.getElementById('playbackUI').classList.add('hidden');
    document.getElementById('topBackBtn').classList.add('hidden');
    document.getElementById('offRouteWarning').classList.add('hidden');
    if (typeof exitBlackPowerSaveMode === 'function') exitBlackPowerSaveMode(false);
    else document.getElementById('blackOverlay').classList.add('hidden');
    document.getElementById('mainUI').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = '鶯歌清運路線助手';
    clearDomMarkers(); updateRouteLayers([]);
    map.getSource('bg-route')?.setData(emptyGeoJSON());
    
    // 🚀 回到主畫面或離開重播時，將 isReplaying 設回 false，並將黃色垃圾車 Marker 與地圖鏡頭恢復對齊至最新真實 GPS 位置
    restoreRealGpsAfterReplay(wasReplaying || isFollowingCamera);
    
    releaseScreenWakeLockIfIdle();
    startIdleGPS();
}

document.getElementById('topBackBtn').onclick = (e) => {
    if (isReviewingPendingMode) {
        exitPendingReviewMode(true);
        return;
    }
    if (!document.getElementById('playbackUI').classList.contains('hidden')) {
        stopSmoothPlayback(); 
        VoiceQueue.clear(); 
        
        // 🚀 離開重播模式時，將 isReplaying 設回 false，先開啟路線預覽面板（不覆蓋鏡頭），再立即將黃色垃圾車與地圖鏡頭對齊真實 GPS 位置
        window.openRouteDetail(selectedRouteIdx, true);
        restoreRealGpsAfterReplay(true);
    } else if (!document.getElementById('followStopBtn').classList.contains('hidden') || !document.getElementById('tacticalStopBtn').classList.contains('hidden')) {
        document.getElementById('followStopBtn').click();
    } else if (!document.getElementById('routeDetailUI').classList.contains('hidden')) {
        document.getElementById('routeDetailUI').classList.add('hidden');
        document.getElementById('topBackBtn').classList.add('hidden');
        renderHistoryList(); document.getElementById('historyModal').classList.remove('hidden');
    } else {
        backToMain(); renderHistoryList(); document.getElementById('historyModal').classList.remove('hidden');
    }
};

// --- 5.8 📷 黃色提醒實景照片壓縮、編輯與檢視邏輯 ---
const editAlertModal = document.getElementById('editAlertModal');
const editAlertModalTitle = document.getElementById('editAlertModalTitle');
const editAlertNoteInput = document.getElementById('editAlertNoteInput');
const alertCameraInput = document.getElementById('alertCameraInput');
const alertGalleryInput = document.getElementById('alertGalleryInput');
const alertPhotoStatus = document.getElementById('alertPhotoStatus');
const alertPhotoPreviewWrap = document.getElementById('alertPhotoPreviewWrap');
const alertPhotoPreviewImg = document.getElementById('alertPhotoPreviewImg');
const btnRemoveAlertPhoto = document.getElementById('btnRemoveAlertPhoto');
const btnSaveAlertEdit = document.getElementById('btnSaveAlertEdit');
const btnDeleteAlert = document.getElementById('btnDeleteAlert');
const btnCancelAlertEdit = document.getElementById('btnCancelAlertEdit');

const viewAlertModal = document.getElementById('viewAlertModal');
const viewAlertNoteText = document.getElementById('viewAlertNoteText');
const viewAlertPhotoWrap = document.getElementById('viewAlertPhotoWrap');
const viewAlertPhotoImg = document.getElementById('viewAlertPhotoImg');

const photoLightboxModal = document.getElementById('photoLightboxModal');
const photoLightboxImg = document.getElementById('photoLightboxImg');

let currentAlertPhotoBase64 = '';

function resetAlertPhotoInputs() {
    if (alertCameraInput) alertCameraInput.value = '';
    if (alertGalleryInput) alertGalleryInput.value = '';
}

window.openPhotoLightbox = function(src) {
    if (!src) return;
    photoLightboxImg.src = src;
    photoLightboxModal.classList.remove('hidden');
};

photoLightboxModal.onclick = () => {
    photoLightboxModal.classList.add('hidden');
    photoLightboxImg.src = '';
};
document.getElementById('closePhotoLightboxBtn').onclick = (e) => {
    e.stopPropagation();
    photoLightboxModal.classList.add('hidden');
    photoLightboxImg.src = '';
};

alertPhotoPreviewImg.onclick = () => {
    if (currentAlertPhotoBase64) window.openPhotoLightbox(currentAlertPhotoBase64);
};
viewAlertPhotoImg.onclick = () => {
    if (viewAlertPhotoImg.src) window.openPhotoLightbox(viewAlertPhotoImg.src);
};

function openViewAlertModal(ev) {
    if (!ev) return;
    viewAlertNoteText.innerText = ev.note || '注意路況';
    if (ev.photo) {
        viewAlertPhotoImg.src = ev.photo;
        viewAlertPhotoWrap.classList.remove('hidden');
    } else {
        viewAlertPhotoImg.src = '';
        viewAlertPhotoWrap.classList.add('hidden');
    }
    viewAlertModal.classList.remove('hidden');
}

document.getElementById('btnCloseViewAlert').onclick = () => viewAlertModal.classList.add('hidden');
document.getElementById('btnCloseViewAlertTop').onclick = () => viewAlertModal.classList.add('hidden');

function updateAlertPhotoPreviewUI(base64Str, statusText = '') {
    currentAlertPhotoBase64 = base64Str || '';
    if (currentAlertPhotoBase64) {
        alertPhotoPreviewImg.src = currentAlertPhotoBase64;
        alertPhotoPreviewWrap.classList.remove('hidden');
        if (statusText) {
            alertPhotoStatus.innerText = statusText;
            alertPhotoStatus.classList.remove('hidden');
        } else {
            const kb = Math.round((currentAlertPhotoBase64.length * 0.75) / 1024);
            alertPhotoStatus.innerText = `✅ 已附加實景照片（約 ${kb} KB）`;
            alertPhotoStatus.classList.remove('hidden');
        }
    } else {
        alertPhotoPreviewImg.src = '';
        alertPhotoPreviewWrap.classList.add('hidden');
        alertPhotoStatus.innerText = '';
        alertPhotoStatus.classList.add('hidden');
    }
}

btnRemoveAlertPhoto.onclick = () => {
    resetAlertPhotoInputs();
    updateAlertPhotoPreviewUI('');
};

function renderSourceToCompressedBase64(source, srcWidth, srcHeight) {
    const maxWidth = 800;
    let targetW = srcWidth || 800;
    let targetH = srcHeight || 600;
    if (targetW > maxWidth) {
        targetH = Math.round(targetH * (maxWidth / targetW));
        targetW = maxWidth;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    // 填充白底，避免透明 PNG 轉 JPEG 時背景變黑
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(source, 0, 0, targetW, targetH);

    let quality = 0.7;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    let byteSize = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);

    // 防爆容量保護：確保壓縮後一定在 150KB 內
    while (byteSize > 150 * 1024 && quality > 0.3) {
        quality = Math.max(0.25, quality - 0.1);
        dataUrl = canvas.toDataURL('image/jpeg', quality);
        byteSize = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);
    }

    if (byteSize > 150 * 1024) {
        const scale = Math.sqrt((140 * 1024) / byteSize);
        canvas.width = Math.max(320, Math.round(targetW * scale));
        canvas.height = Math.max(240, Math.round(targetH * scale));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL('image/jpeg', 0.65);
        byteSize = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);
    }

    return { dataUrl, kb: Math.max(1, Math.round(byteSize / 1024)) };
}

function compressImageFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('讀取圖片檔案失敗'));
        reader.onload = (ev) => {
            const rawDataUrl = ev.target.result;
            const img = new Image();
            img.onload = () => {
                try {
                    const result = renderSourceToCompressedBase64(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
                    resolve(result);
                } catch (canvasErr) {
                    reject(canvasErr);
                }
            };
            img.onerror = async () => {
                // 自動降級處理 1：嘗試使用 createImageBitmap 解析特殊手機圖片格式
                if (typeof window.createImageBitmap === 'function') {
                    try {
                        const bitmap = await window.createImageBitmap(file);
                        const result = renderSourceToCompressedBase64(bitmap, bitmap.width, bitmap.height);
                        if (typeof bitmap.close === 'function') bitmap.close();
                        resolve(result);
                        return;
                    } catch (bmpErr) {
                        console.warn('createImageBitmap 降級解析失敗:', bmpErr);
                    }
                }
                // 自動降級處理 2：若原圖已小於 150KB 且為 data:image，直接安全採用
                if (typeof rawDataUrl === 'string' && rawDataUrl.startsWith('data:image/') && file.size <= 150 * 1024) {
                    resolve({ dataUrl: rawDataUrl, kb: Math.max(1, Math.round(file.size / 1024)) });
                    return;
                }
                reject(new Error('不支援的圖片格式或圖片損毀'));
            };
            img.src = rawDataUrl;
        };
        reader.readAsDataURL(file);
    });
}

async function handleAlertPhotoInputChange(e) {
    const inputEl = e.target;
    const file = inputEl.files && inputEl.files[0];
    // 立即重設 input.value 為空字串 ''，確保連續重選同一張或更換照片皆能觸發 onchange
    inputEl.value = '';
    if (!file) return;

    alertPhotoStatus.innerText = '⏳ 正在壓縮處理照片...';
    alertPhotoStatus.classList.remove('hidden');
    try {
        const { dataUrl, kb } = await compressImageFileToBase64(file);
        updateAlertPhotoPreviewUI(dataUrl, `✅ 照片已自動壓縮完成（${kb} KB ≤ 150 KB）`);
    } catch (err) {
        console.error('圖片處理異常:', err);
        alert('⚠️ 無法解析此照片格式（若為 iPhone 高效率原況檔案，建議直接點選「📷 現場拍照」或選擇一般 JPG/PNG 照片）！');
        if (!currentAlertPhotoBase64) {
            updateAlertPhotoPreviewUI('');
        } else {
            updateAlertPhotoPreviewUI(currentAlertPhotoBase64);
        }
    }
}

if (alertCameraInput) alertCameraInput.onchange = handleAlertPhotoInputChange;
if (alertGalleryInput) alertGalleryInput.onchange = handleAlertPhotoInputChange;

function finishAlertModalCleanup(route) {
    editAlertModal.classList.add('hidden');
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    editStep = 0;
    if (route) {
        if (isEditingMode) {
            document.getElementById('editPromptText').innerText = "🛠️ 標記完成！請點擊地圖軌跡選擇下一個『目標點』";
            updateRouteLayers(route.points);
            renderEditableRouteMarkers(route);
        } else {
            if (typeof persistSavedRoutesToStorage === 'function') {
                persistSavedRoutesToStorage();
            }
            refreshCurrentRouteMarkers(route);
        }
    }
}

function openAlertModalForCreate(route, ptIndex) {
    editAlertModalTitle.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 新增黃色提醒事項';
    editAlertNoteInput.value = '注意路段';
    resetAlertPhotoInputs();
    updateAlertPhotoPreviewUI('');
    btnDeleteAlert.classList.add('hidden');
    editAlertModal.classList.remove('hidden');

    btnSaveAlertEdit.onclick = () => {
        const note = editAlertNoteInput.value.trim();
        if (!note) {
            alert('請輸入提醒內容！');
            return;
        }
        route.events = route.events || [];
        const newEv = {
            type: 'alert',
            note,
            lng: route.points[ptIndex].lng,
            lat: route.points[ptIndex].lat,
            ptIdx: ptIndex,
            bearing: route.points[ptIndex].bearing || 0
        };
        if (currentAlertPhotoBase64) newEv.photo = currentAlertPhotoBase64;
        route.events.push(newEv);
        finishAlertModalCleanup(route);
    };

    btnCancelAlertEdit.onclick = () => {
        finishAlertModalCleanup(route);
    };
}

function openAlertModalForEdit(route, eventIdx) {
    const ev = route.events && route.events[eventIdx];
    if (!ev) return;

    editAlertModalTitle.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 編輯黃色提醒事項';
    editAlertNoteInput.value = ev.note || '注意路段';
    resetAlertPhotoInputs();
    updateAlertPhotoPreviewUI(ev.photo || '');
    btnDeleteAlert.classList.remove('hidden');
    editAlertModal.classList.remove('hidden');

    btnSaveAlertEdit.onclick = () => {
        const note = editAlertNoteInput.value.trim();
        if (!note) {
            alert('請輸入提醒內容！');
            return;
        }
        if (isEditingMode && typeof pushEditUndoSnapshot === 'function') {
            pushEditUndoSnapshot(route);
        }
        ev.note = note;
        if (currentAlertPhotoBase64) {
            ev.photo = currentAlertPhotoBase64;
        } else {
            delete ev.photo;
        }
        finishAlertModalCleanup(route);
    };

    btnDeleteAlert.onclick = () => {
        if (confirm(`確定要刪除【${ev.note || '提醒'}】這筆黃色提醒嗎？`)) {
            if (isEditingMode && typeof pushEditUndoSnapshot === 'function') {
                pushEditUndoSnapshot(route);
            }
            route.events.splice(eventIdx, 1);
            finishAlertModalCleanup(route);
        }
    };

    btnCancelAlertEdit.onclick = () => {
        editAlertModal.classList.add('hidden');
    };
}

// --- 6. 模擬重播引擎 ---
let animFrameId = null, isPlaying = false, playProgress = 0, lastFrameTime = 0;
let replayVoiceEvents = [];
let replayCumMeters = [];
const speedOptions = [1, 2, 4, 6];
let speedMultiplier = 1;

function getActivePlaybackOrFollowRoute() {
    if (window.isFurnitureNavOrReplayActive && window.activeFurnitureSyntheticRoute) {
        return window.activeFurnitureSyntheticRoute;
    }
    return savedRoutes[selectedRouteIdx];
}

const playbackSlider = document.getElementById('playbackSlider');
const playPauseBtn = document.getElementById('playPauseBtn');
const speedToggleBtn = document.getElementById('speedToggleBtn');

document.getElementById('startReplayBtn').onclick = () => {
    const route = getActivePlaybackOrFollowRoute();
    if (!route || !route.points || route.points.length < 2) return;

    stopSmoothPlayback();

    // 🛡️ 進入「重播複習」模式：開啟 isReplaying 鎖定車輛控制權，徹底隔離真實 GPS 定位回呼與補間動畫
    isReplaying = true;
    window.isReplaying = true;
    if (vehicleAnimFrameId !== null) {
        cancelAnimationFrame(vehicleAnimFrameId);
        vehicleAnimFrameId = null;
    }

    document.getElementById('routeDetailUI').classList.add('hidden');
    if (window.isFurnitureNavOrReplayActive) {
        document.getElementById('furnitureModeUI')?.classList.add('hidden');
        document.getElementById('furnitureLeftConnectControls')?.classList.add('hidden');
        document.getElementById('topBackBtn')?.classList.add('hidden');
    }
    document.getElementById('playbackUI').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = window.isFurnitureNavOrReplayActive ? '🛋️ 家具路線播放' : '路線重播複習';
    document.getElementById('playbackTitle').innerText = route.name;
    speedToggleBtn.innerText = `${speedMultiplier}x`;

    // 初始化累積里程與語音標記事件，重置所有 played / prePlayed 狀態
    replayCumMeters = buildCumulativeRouteMeters(route.points);
    replayVoiceEvents = prepareVoiceMarkerEvents(route, !window.isFurnitureNavOrReplayActive);

    // 初始狀態（currentTrackIndex = 0）：已行駛路段為空，未行駛路段完整高亮顯示
    updateProgressRouteLayers(route.points, 0, null, 0);
    if (window.isFurnitureNavOrReplayActive) {
        if (typeof renderAllFurnitureMapElements === 'function') renderAllFurnitureMapElements();
    } else {
        renderRouteMarkers(route);
    }

    playProgress = 0; playbackSlider.max = (route.points.length - 1) * 100; playbackSlider.value = 0;
    setCameraFollow(true);

    const startPt = route.points[0];
    lastKnownLngLat = [startPt.lng, startPt.lat];
    currentHeading = getRouteSegmentBearing(route.points, 0);
    vehicleVisualLngLat = [...lastKnownLngLat];
    vehicleVisualHeading = currentHeading;
    if (vehicleMarker) {
        vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);
    }
    map.jumpTo({
        center: lastKnownLngLat,
        zoom: 17.5,
        bearing: isHeadingUpMode ? currentHeading : 0,
        offset: [0, 100]
    });

    startSmoothPlayback();
};

function renderInterpolatedStep(floatIdx, forceLayerUpdate = false) {
    const route = getActivePlaybackOrFollowRoute();
    if (!route || !route.points || route.points.length < 2) return;
    const pts = route.points;
    const maxIdx = pts.length - 1;
    const clamped = Math.min(Math.max(floatIdx, 0), maxIdx);
    const currentTrackIndex = Math.min(Math.floor(clamped), maxIdx);
    const frac = clamped - currentTrackIndex;

    const p1 = pts[currentTrackIndex], p2 = pts[Math.min(currentTrackIndex + 1, maxIdx)];
    if (!p1 || !p2) return;
    const curLng = p1.lng + (p2.lng - p1.lng) * frac;
    const curLat = p1.lat + (p2.lat - p1.lat) * frac;
    lastKnownLngLat = [curLng, curLat];

    // 同步計算目前點位到下一個有效點位的方位角（Bearing），即時更新黃色垃圾車的車頭旋轉角度
    const segDistM = getDistanceKm(p1.lng, p1.lat, p2.lng, p2.lat) * 1000;
    if (currentTrackIndex < maxIdx && segDistM >= 0.05) {
        currentHeading = getBearing(p1.lng, p1.lat, p2.lng, p2.lat);
    } else {
        currentHeading = getRouteSegmentBearing(pts, currentTrackIndex);
    }

    // 確保任何殘留的真實 GPS 補間動畫不會干擾重播車輛
    if (vehicleAnimFrameId !== null) {
        cancelAnimationFrame(vehicleAnimFrameId);
        vehicleAnimFrameId = null;
    }
    vehicleVisualLngLat = [curLng, curLat];
    vehicleVisualHeading = currentHeading;
    if (vehicleMarker) {
        vehicleMarker.setLngLat([curLng, curLat]).setRotation(currentHeading);
    }

    // 👾 動態軌跡變色（小精靈吃路線）：0 ~ currentTrackIndex 為半透明淺灰，currentTrackIndex ~ 終點維持原色高亮
    updateProgressRouteLayers(
        pts,
        currentTrackIndex,
        { lng: curLng, lat: curLat, musicActive: p2.musicActive },
        forceLayerUpdate ? 0 : 40
    );

    const badge = document.getElementById('replayMusicBadge');
    if (window.isFurnitureNavOrReplayActive) {
        badge.className = "bg-violet-600 text-white text-xs font-extrabold px-4 py-1.5 rounded-full shadow-lg pointer-events-auto";
        badge.innerText = `🛋️ 家具清運路線播放中（共 ${(furnitureActiveData?.pins?.length || 0)} 站）`;
    } else if (p2.musicActive) {
        badge.className = "bg-green-600 text-white text-xs font-extrabold px-4 py-1.5 rounded-full shadow-lg pointer-events-auto";
        badge.innerText = "🎵 目前路段：播放回收音樂中";
    } else {
        badge.className = "bg-gray-800/90 text-white text-xs font-extrabold px-4 py-1.5 rounded-full shadow-lg pointer-events-auto";
        badge.innerText = "🔇 目前路段：音樂已關閉 (中斷移動)";
    }

    // 🔊 綁定路線進度的雙層語音預警（100m 預告 + 45m 確認 + 方向 ±30° + played 鎖定）
    evaluateVoiceMarkersWithProgress({
        events: replayVoiceEvents,
        pts,
        cumMeters: replayCumMeters,
        currentTrackIndex,
        lng: curLng,
        lat: curLat,
        vehicleBearing: currentHeading,
        onTriggerWake: false
    });

    if (isFollowingCamera) {
        map.jumpTo({
            center: [curLng, curLat],
            bearing: isHeadingUpMode ? currentHeading : 0,
            offset: [0, 100]
        });
    }
}

function playbackLoop(timestamp) {
    if (!isPlaying) return;
    const route = getActivePlaybackOrFollowRoute();
    if (!route || !route.points || route.points.length < 2) { stopSmoothPlayback(); return; }
    if (!lastFrameTime) lastFrameTime = timestamp;
    const deltaSec = Math.min(Math.max((timestamp - lastFrameTime) / 1000, 0), 0.1);
    lastFrameTime = timestamp;

    const maxIdx = route.points.length - 1;
    playProgress += deltaSec * 2.5 * speedMultiplier;

    if (playProgress >= maxIdx) {
        playProgress = maxIdx; renderInterpolatedStep(playProgress, true);
        playbackSlider.value = Math.round(playProgress * 100);
        stopSmoothPlayback(); playPauseBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
        return;
    }

    renderInterpolatedStep(playProgress, false);
    playbackSlider.value = Math.round(playProgress * 100);
    animFrameId = requestAnimationFrame(playbackLoop);
}

function startSmoothPlayback() {
    // 單一實例保護：啟動前先清除舊的動畫計時器
    if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
    isReplaying = true;
    window.isReplaying = true;
    const route = getActivePlaybackOrFollowRoute();
    if (route && playProgress >= route.points.length - 1) {
        playProgress = 0;
        replayVoiceEvents.forEach(ev => {
            ev.played = false;
            ev.prePlayed = false;
            if (ev.sourceEvent) {
                ev.sourceEvent.played = false;
                ev.sourceEvent.prePlayed = false;
            }
        });
    }
    isPlaying = true; lastFrameTime = 0;
    playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    animFrameId = requestAnimationFrame(playbackLoop);
}

function stopSmoothPlayback() {
    isPlaying = false;
    if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
    playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
}

playPauseBtn.onclick = () => isPlaying ? stopSmoothPlayback() : startSmoothPlayback();
playbackSlider.oninput = (e) => {
    isReplaying = true;
    window.isReplaying = true;
    playProgress = parseInt(e.target.value, 10) / 100;
    const scrubTrackIdx = Math.floor(playProgress);
    const curCumM = replayCumMeters[scrubTrackIdx] || 0;
    const confirmDist = Number(systemNavConfig.confirmDistMeters) || DEFAULT_SYSTEM_CONFIG.confirmDistMeters;
    const lookAheadDist = Number(systemNavConfig.lookAheadDistMeters) || DEFAULT_SYSTEM_CONFIG.lookAheadDistMeters;
    replayVoiceEvents.forEach(ev => {
        const evCumM = replayCumMeters[ev.ptIdx] || 0;
        const aheadM = evCumM - curCumM;
        if (aheadM > confirmDist + 5) {
            ev.played = false;
            if (ev.sourceEvent) ev.sourceEvent.played = false;
        }
        if (aheadM > lookAheadDist + 15) {
            ev.prePlayed = false;
            if (ev.sourceEvent) ev.sourceEvent.prePlayed = false;
        }
    });
    renderInterpolatedStep(playProgress, true);
};
speedToggleBtn.onclick = () => {
    const nextIdx = (speedOptions.indexOf(speedMultiplier) + 1) % speedOptions.length;
    speedMultiplier = speedOptions[nextIdx];
    speedToggleBtn.innerText = `${speedMultiplier}x`;
    if (isReplaying) {
        renderInterpolatedStep(playProgress, false);
    }
};
document.getElementById('stopPlaybackBtn').onclick = () => { 
    stopSmoothPlayback();
    VoiceQueue.clear();
    document.getElementById('playbackUI').classList.add('hidden'); 
    document.getElementById('musicAlertBanner').classList.add('hidden');

    if (window.isFurnitureNavOrReplayActive && typeof restoreFurnitureModeAfterNavOrReplay === 'function') {
        restoreFurnitureModeAfterNavOrReplay();
        restoreRealGpsAfterReplay(true);
        return;
    }

    document.getElementById('topBackBtn').classList.remove('hidden');
    // 🚀 結束重播後自動歸位：先渲染路線預覽面板（不覆蓋鏡頭），再立即將 isReplaying 設回 false 並將黃色垃圾車與地圖鏡頭對齊最新真實 GPS 位置
    window.openRouteDetail(selectedRouteIdx, true); 
    restoreRealGpsAfterReplay(true);
};

// --- 7. 🔥 Pro Max 級實戰導航引擎 ＆ 全螢幕純黑智慧省電模式 ---
let triggeredMusicIndices = new Set(), triggeredTurnIndices = new Set();

const blackOverlay = document.getElementById('blackOverlay');
const offRouteWarning = document.getElementById('offRouteWarning');
const banner = document.getElementById('musicAlertBanner');

// 喚醒畫面時同步恢復地圖重繪與最新位置
function syncMapRenderOnWake() {
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.style.visibility = 'visible';
    if (vehicleMarker && lastKnownLngLat) {
        vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);
    }
    if (isRecording && routePoints.length > 0) {
        document.getElementById('distanceText').innerText = totalDistanceKm.toFixed(2);
        updateRouteLayers(routePoints);
    }
    if (isFollowingCamera && lastKnownLngLat) {
        map.jumpTo({
            center: lastKnownLngLat,
            bearing: isHeadingUpMode ? currentHeading : map.getBearing(),
            offset: [0, 100]
        });
    }
    if (typeof fetchAndRenderFleetRadar === 'function') {
        fetchAndRenderFleetRadar();
    }
    if (typeof fetchAndRenderSharedMapPins === 'function') {
        fetchAndRenderSharedMapPins();
    }
}

// 進入全螢幕純黑 (#000000) 智慧省電模式
async function enterBlackPowerSaveMode(fromUserGesture = true) {
    ensurePureBlackSystemBars();
    isBlackScreenActive = true;
    isScreenAutoWoken = false;
    if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }

    blackOverlay.style.backgroundColor = '#000000';
    blackOverlay.classList.remove('hidden', 'opacity-0');

    // 暫停底層地圖畫面重繪，達到極致省電
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.style.visibility = 'hidden';

    // 嘗試於使用者點擊手勢中進入全螢幕（隱藏 Android 底部虛擬導覽列與頂部狀態列）
    if (fromUserGesture) {
        try {
            const docEl = document.documentElement;
            const reqFs = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.msRequestFullscreen;
            if (reqFs && !document.fullscreenElement && !document.webkitFullscreenElement) {
                Promise.resolve(reqFs.call(docEl)).catch(() => {});
            }
        } catch (e) {}
    }

    // 持續啟用螢幕喚醒鎖定（Wake Lock API）防止手機休眠斷網
    await requestScreenWakeLock();

    // 確保背景 GPS 追蹤與車隊雷達位置上傳持續運作不中斷
    if (!isRecording && followWatchId === null) startIdleGPS();
    if (typeof startFleetRadarSystem === 'function') startFleetRadarSystem();
}

// 退出全螢幕純黑省電模式
function exitBlackPowerSaveMode(fromUserGesture = true) {
    isBlackScreenActive = false;
    isScreenAutoWoken = false;
    if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }

    blackOverlay.classList.add('hidden');
    blackOverlay.classList.remove('opacity-0');
    ensurePureBlackSystemBars();

    // 恢復地圖畫面重繪並同步最新座標
    syncMapRenderOnWake();

    if (fromUserGesture) {
        try {
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
                if (exitFs) Promise.resolve(exitFs.call(document)).catch(() => {});
            }
        } catch (e) {}
    }

    releaseScreenWakeLockIfIdle();
}

document.getElementById('blackScreenBtn').onclick = () => enterBlackPowerSaveMode(true);
blackOverlay.onclick = () => exitBlackPowerSaveMode(true);

function autoWakeScreen() {
    if (!isBlackScreenActive || isScreenAutoWoken) return;
    isScreenAutoWoken = true;
    syncMapRenderOnWake();
    blackOverlay.classList.add('opacity-0');
    setTimeout(() => { if(isScreenAutoWoken) blackOverlay.classList.add('hidden'); }, 300);
    vibrate([100, 50, 100]);
}

function autoSleepScreen() {
    if (!isBlackScreenActive) return;
    if (sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
        if (isBlackScreenActive) {
            isScreenAutoWoken = false;
            ensurePureBlackSystemBars();
            blackOverlay.style.backgroundColor = '#000000';
            blackOverlay.classList.remove('hidden');
            const mapEl = document.getElementById('map');
            if (mapEl) mapEl.style.visibility = 'hidden';
            setTimeout(() => blackOverlay.classList.remove('opacity-0'), 10);
        }
    }, 5000);
}

let navAlertHideTimer = null;
function showNavAlert(iconHtml, text, bgColorClass, photoUrl = null) {
    if (text === undefined) {
        text = iconHtml;
        iconHtml = '⚠️';
        bgColorClass = 'bg-amber-600';
    }
    if (navAlertHideTimer) clearTimeout(navAlertHideTimer);
    if (text === '') {
        // 🚀 無文字模式 (轉彎專用)：水平置中圓角正方形大圖示
        banner.className = `fixed top-20 left-1/2 -translate-x-1/2 z-[60] rounded-3xl shadow-2xl text-white font-black nav-alert-pop border-4 border-white pointer-events-auto flex items-center justify-center w-28 h-28 ${bgColorClass}`;
        banner.innerHTML = `<span class="text-[72px] drop-shadow-lg leading-none">${iconHtml}</span>`;
    } else if (bgColorClass && bgColorClass.includes('amber')) {
        // ⚠️ 導航／重播模式下的黃色注意路段：頂部精簡橫幅（水平置中、寬度自適應、不擋兩側按鈕與車頭路線）
        banner.className = `fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-[60] w-fit max-w-[calc(100vw-140px)] rounded-2xl shadow-2xl text-white font-black nav-alert-pop border-2 border-white pointer-events-auto flex items-center justify-between px-4 py-2 max-h-[84px] overflow-hidden gap-2.5 ${bgColorClass}`;
        const thumbHtml = photoUrl
            ? `<button type="button" onclick="openPhotoLightbox(this.querySelector('img').src)" class="relative w-[52px] h-[52px] flex-shrink-0 rounded-xl overflow-hidden border-2 border-white shadow-md active:scale-95 focus:outline-none" title="點擊放大檢視照片">
                   <img src="${photoUrl}" alt="提醒縮圖" class="w-full h-full object-cover">
                   <span class="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[9px] leading-none px-1 py-0.5 rounded pointer-events-none">🔍</span>
               </button>`
            : '';
        banner.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="text-xl flex-shrink-0 drop-shadow">${iconHtml}</span>
                <span class="text-sm sm:text-base font-black leading-tight text-left break-words" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${text}</span>
            </div>
            ${thumbHtml}
        `;
    } else {
        // 🎵 開關音樂、抵達起點等橫幅：水平置中、寬度自適應內容、預留左右 140px 空間不遮擋右上角按鈕
        banner.className = `fixed top-20 left-1/2 -translate-x-1/2 z-[60] w-fit max-w-[calc(100vw-140px)] rounded-2xl shadow-2xl text-white font-black text-center nav-alert-pop border-2 border-white pointer-events-auto flex items-center justify-center px-4 py-2 gap-1.5 text-base sm:text-lg whitespace-nowrap ${bgColorClass}`;
        const displayStr = (iconHtml && !String(text).startsWith(iconHtml)) ? `${iconHtml} ${text}` : String(text);
        banner.innerHTML = `<span class="drop-shadow-sm truncate">${displayStr}</span>`;
    }
    
    banner.classList.remove('hidden');
    navAlertHideTimer = setTimeout(() => banner.classList.add('hidden'), photoUrl ? 8500 : 6000);
}

window.tacticalTimer = null;
function updateTacticalDisplay() {
    const nameEl = document.getElementById('nextStopName'), timeEl = document.getElementById('timeRemainingDisplay');
    if (!nameEl || !timeEl) return;

    if (!window.stopsQueue || window.currentStopIndex >= window.stopsQueue.length) {
        nameEl.innerText = "🚩 本路線所有定點清運已完成！"; timeEl.innerText = "--:--";
        timeEl.className = "text-3xl font-black text-gray-500 mt-0.5";
        if (window.tacticalTimer !== null) {
            clearInterval(window.tacticalTimer);
            window.tacticalTimer = null;
        }
        return;
    }

    const nextStop = window.stopsQueue[window.currentStopIndex];
    const timeStr = nextStop.scheduled_time || "00:00";
    nameEl.innerText = `下一站 (${window.currentStopIndex + 1}/${window.stopsQueue.length})：${nextStop.stop_name || '定點收運'}`;

    const now = new Date(), [hours, minutes] = timeStr.split(':'), targetTime = new Date();
    targetTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

    const diffSecs = Math.floor((targetTime - now) / 1000), absSecs = Math.abs(diffSecs);
    const m = Math.floor(absSecs / 60).toString().padStart(2, '0'), s = (absSecs % 60).toString().padStart(2, '0');

    if (diffSecs > 0) {
        timeEl.innerText = `+ ${m}:${s}`;
        timeEl.className = "text-4xl font-black tracking-wider text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.5)] font-mono mt-0.5";
    } else if (diffSecs === 0) {
        timeEl.innerText = "即將抵達";
        timeEl.className = "text-4xl font-black tracking-wider text-yellow-400 animate-pulse font-mono mt-0.5";
    } else {
        timeEl.innerText = `- ${m}:${s}`;
        timeEl.className = "text-4xl font-black tracking-wider text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.6)] font-mono mt-0.5";
    }
}

document.getElementById('startFollowBtn').onclick = async () => {
    isReplaying = false;
    window.isReplaying = false;
    stopSmoothPlayback();
    stopIdleGPS();
    // 單一實例保護：啟動前先清除舊的導航監聽與戰術計時器
    if (followWatchId !== null) {
        navigator.geolocation.clearWatch(followWatchId);
        followWatchId = null;
    }
    if (window.tacticalTimer !== null) {
        clearInterval(window.tacticalTimer);
        window.tacticalTimer = null;
    }

    const route = getActivePlaybackOrFollowRoute();
    if (!route) return;
    document.getElementById('routeDetailUI').classList.add('hidden');
    if (window.isFurnitureNavOrReplayActive) {
        document.getElementById('furnitureModeUI')?.classList.add('hidden');
        document.getElementById('furnitureLeftConnectControls')?.classList.add('hidden');
        document.getElementById('topBackBtn')?.classList.add('hidden');
    }
    // 顯示右下角的獨立結束按鈕與左下角的一鍵標記黃色注意點按鈕
    document.getElementById('tacticalStopBtn').classList.remove('hidden');
    if (window.isFurnitureNavOrReplayActive) {
        document.getElementById('tacticalQuickAlertBtn')?.classList.add('hidden');
    } else {
        document.getElementById('tacticalQuickAlertBtn')?.classList.remove('hidden');
    }
    document.getElementById('appStatusTitle').innerText = `導航：${route.name}`;
    
    let hasAnnouncedStart = false, hasAnnouncedEnd = false, wasOffRoute = false; 
    window.startGuidanceSpoken = true; window.lastOffRouteTime = 0;        

    triggeredMusicIndices.clear(); triggeredTurnIndices.clear();
    isBlackScreenActive = false; isScreenAutoWoken = false;

    const pts = route.points;
    const followCumMeters = buildCumulativeRouteMeters(pts);
    // 重新開始導航時，完整重置所有標記點的 played 與 prePlayed 狀態
    const mappedEvents = prepareVoiceMarkerEvents(route, false);
    window.activeFollowMappedEvents = mappedEvents;

    window.stopsQueue = (route.points || []).map((p, index) => ({ ...p, ptIdx: index })).filter(p => p.is_stop === true);
    window.currentStopIndex = 0;
    if (window.stopsQueue.length > 0) {
        document.getElementById('tacticalTimePanel').classList.remove('hidden');
        updateTacticalDisplay();
        window.tacticalTimer = setInterval(updateTacticalDisplay, 1000); 
    } else {
        document.getElementById('tacticalTimePanel').classList.add('hidden');
    }

    let currentTrackIndex = 0;
    updateProgressRouteLayers(route.points, 0, null, 0);
    if (window.isFurnitureNavOrReplayActive) {
        if (typeof renderAllFurnitureMapElements === 'function') renderAllFurnitureMapElements();
    } else {
        renderRouteMarkers(route);
    }
    setCameraFollow(true);

    // 🚀 按下導航瞬間，強制將鏡頭拉近到「實戰特寫視角」並傾斜
    map.flyTo({
        center: lastKnownLngLat,
        zoom: 18.5, // 💡 導航專用的超近視角 (數字越大越近，18.5 是最佳實戰比例)
        pitch: 50,  // 💡 視角稍微傾斜 50 度，看起來更像專業車載 3D 導航
        bearing: isHeadingUpMode ? currentHeading : 0,
        offset: [0, 100],
        duration: 1500 // 飛行過場動畫 1.5 秒
    });

    await requestScreenWakeLock();

    activeFollowGpsHandler = pos => {
        markGpsUpdateReceived();
        const filtered = processFilteredGpsPosition(pos);
        if (!filtered) return; // 剔除 accuracy > 45m 低精度與 > 160km/h 衛星反射瞬移

        const lng = filtered.lng, lat = filtered.lat;

        if (typeof window.onFleetPositionUpdate === 'function') {
            window.onFleetPositionUpdate(lat, lng);
        }

        if (!filtered.isStationary || filtered.isWakeupFix) {
            if (!isPowerSaveMapPaused()) {
                if (vehicleMarker) {
                    smoothMoveVehicleMarker(lastKnownLngLat, currentHeading, 750);
                }

                if (isFollowingCamera) {
                    const targetZoom = getDynamicZoomBySpeed(filtered.speedKmh);
                    map.easeTo({
                        center: lastKnownLngLat,
                        zoom: targetZoom,
                        bearing: isHeadingUpMode ? currentHeading : map.getBearing(),
                        offset: [0, 100],
                        duration: 600
                    });
                }
            }
        }

        // 即時計算路線進度索引 currentTrackIndex（採用前方滑動視窗 Sliding Window：往後最多 30 節點且沿線 150m 內，防止原路進出巷口跳號）
        const progressInfo = computeNextTrackIndex(pts, currentTrackIndex, lng, lat, currentHeading, !filtered.isStationary, followCumMeters);
        currentTrackIndex = progressInfo.trackIndex;
        const minDist = progressInfo.minDistMeters;
        let isOffRoute = true;

        // 👾 動態軌跡變色（小精靈吃路線）：0 ~ currentTrackIndex 渲染為半透明淺灰色，currentTrackIndex ~ 終點維持高亮原色
        if (!isPowerSaveMapPaused()) {
            updateProgressRouteLayers(pts, currentTrackIndex, null, 150);
        }

        const distToStart = getDistanceKm(lng, lat, pts[0].lng, pts[0].lat) * 1000;
        if (!hasAnnouncedStart) {
            if (distToStart <= 35 || minDist <= 25) {
                hasAnnouncedStart = true;
                document.getElementById('appStatusTitle').innerText = `導航：${route.name}`;
                showNavAlert('✅', '抵達路線，開始任務', 'bg-green-600');
                speakText("我們任務開始，路上請注意安全。");
                vibrate([200, 100, 200]);
            } else {
                document.getElementById('appStatusTitle').innerText = `前往起點 (${Math.round(distToStart)}m)`;
                return;
            }
        }

        if (window.stopsQueue && window.currentStopIndex < window.stopsQueue.length) {
            const targetStop = window.stopsQueue[window.currentStopIndex];
            const distToStop = getDistanceKm(lng, lat, targetStop.lng, targetStop.lat) * 1000;
            const indexDiff = currentTrackIndex - targetStop.ptIdx;
            
            // 🚀 核心修復：距離嚴格縮小為 15 公尺，並加入「軌跡進度鎖」(防止隔壁巷子誤觸)
            const isNearStop = (distToStop <= 15 && Math.abs(indexDiff) <= 30);
            const isPassedStop = (indexDiff >= 0 && indexDiff <= 15); // 順著軌跡剛好開過頭

            if (isNearStop || isPassedStop) {
                const nowTime = new Date(), [hours, minutes] = (targetStop.scheduled_time || "00:00").split(':');
                const targetTime = new Date(); targetTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
                
                const diffSecs = Math.floor((targetTime - nowTime) / 1000);
                let timeVoice = "";
                if (diffSecs > 60) timeVoice = `提早 ${Math.floor(diffSecs/60)} 分鐘`;
                else if (diffSecs < -60) timeVoice = `延遲 ${Math.floor(Math.abs(diffSecs)/60)} 分鐘`;
                else timeVoice = "準點";

                speakText(`抵達 ${targetStop.stop_name}，${timeVoice}`);
                window.currentStopIndex++; updateTacticalDisplay(); 
            }
        }

        if (!hasAnnouncedEnd && pts.length >= 2) {
            const totalPoints = pts.length;
            const totalRouteMeters = Array.isArray(followCumMeters) && followCumMeters.length === totalPoints
                ? (followCumMeters[totalPoints - 1] || 0)
                : 0;
            const traveledMeters = Array.isArray(followCumMeters) && followCumMeters.length === totalPoints
                ? (followCumMeters[currentTrackIndex] || 0)
                : 0;
            const remainingRouteMeters = Math.max(0, totalRouteMeters - traveledMeters);

            // 條件 1（節點進度門檻）：currentTrackIndex 已進入整條路線最後尾段（>= totalPoints - 15 或剩餘軌跡長度 < 80m，且至少已完成後半段路線）
            const minTailIndex = totalPoints > 20
                ? (totalPoints - 15)
                : Math.max(1, Math.ceil(totalPoints * 0.75));
            const isAtRouteTail = (
                currentTrackIndex >= minTailIndex ||
                (totalRouteMeters > 80 && remainingRouteMeters < 80 && currentTrackIndex >= Math.ceil(totalPoints * 0.6))
            );

            // 條件 2（實際距離門檻）：車輛與終點 E 的實際直線距離 < 25 公尺
            const distToEnd = getDistanceKm(lng, lat, pts[totalPoints - 1].lng, pts[totalPoints - 1].lat) * 1000;

            // 雙重鎖定：必須同時滿足「已進入路線尾段進度」與「距終點 E < 25m」才可播報導航結束
            if (isAtRouteTail && distToEnd < 25) {
                speakText("已抵達路線終點，本次清運任務結束，辛苦了！");
                hasAnnouncedEnd = true;
                document.getElementById('tacticalTimePanel').classList.add('hidden');
            }
        }

        if (minDist < 25) {
            isOffRoute = false; offRouteWarning.classList.add('hidden');
            if (wasOffRoute) { speakText("已重新回到原定路線。"); wasOffRoute = false; }
        } else {
            isOffRoute = true; wasOffRoute = true; offRouteWarning.classList.remove('hidden');
            if (Date.now() - window.lastOffRouteTime > 15000) {
                speakText("已偏離路線，請注意。"); vibrate([200, 100, 200]); autoWakeScreen();
                window.lastOffRouteTime = Date.now();
            }
        }

        if (!isOffRoute) {
            let lookAheadIdx = currentTrackIndex, scanDist = 0;
            while (lookAheadIdx < pts.length - 1 && scanDist < 30) {
                scanDist += (getDistanceKm(pts[lookAheadIdx].lng, pts[lookAheadIdx].lat, pts[lookAheadIdx+1].lng, pts[lookAheadIdx+1].lat) * 1000);
                lookAheadIdx++;
            }

            if (lookAheadIdx > currentTrackIndex && !triggeredTurnIndices.has(currentTrackIndex)) {
                const currentSegAngle = getBearing(pts[currentTrackIndex].lng, pts[currentTrackIndex].lat, pts[currentTrackIndex+1].lng, pts[currentTrackIndex+1].lat);
                const futureSegAngle = getBearing(pts[lookAheadIdx-1].lng, pts[lookAheadIdx-1].lat, pts[lookAheadIdx].lng, pts[lookAheadIdx].lat);
                const angleDiff = getAngleDiff(currentSegAngle, futureSegAngle);
                
                if (angleDiff > 40 && angleDiff < 140) {
                    for(let k = Math.max(0, currentTrackIndex - 3); k <= lookAheadIdx + 2; k++) triggeredTurnIndices.add(k);
                    autoWakeScreen(); 
                    // 🚀 換成 100% 絕對支援的基本大箭頭 (向右)
                    showNavAlert('<i class="fa-solid fa-arrow-right"></i>', '', 'bg-blue-600'); 
                    speakText("前方準備右轉"); 
                    autoSleepScreen();
                } else if (angleDiff < -40 && angleDiff > -140) {
                    for(let k = Math.max(0, currentTrackIndex - 3); k <= lookAheadIdx + 2; k++) triggeredTurnIndices.add(k);
                    autoWakeScreen(); 
                    // 🚀 換成 100% 絕對支援的基本大箭頭 (向左)
                    showNavAlert('<i class="fa-solid fa-arrow-left"></i>', '', 'bg-blue-600'); 
                    speakText("前方準備左轉"); 
                    autoSleepScreen();
                }
            }

            // 🔊 綁定路線進度的雙層語音預警（300m 簡短預告 + 50m 完整確認 + 方向 ±30° 一致 + played 鎖定防重複）
            evaluateVoiceMarkersWithProgress({
                events: mappedEvents,
                pts,
                cumMeters: followCumMeters,
                currentTrackIndex,
                lng,
                lat,
                vehicleBearing: currentHeading,
                onTriggerWake: true
            });
        }
    };

    followWatchId = navigator.geolocation.watchPosition(
        activeFollowGpsHandler,
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
};

const endFollowAction = () => {
    VoiceQueue.clear();
    activeFollowGpsHandler = null;
    if (followWatchId !== null) {
        navigator.geolocation.clearWatch(followWatchId);
        followWatchId = null;
    }
    if (window.tacticalTimer !== null) {
        clearInterval(window.tacticalTimer);
        window.tacticalTimer = null;
    }
    window.activeFollowMappedEvents = null;
    if (typeof closeQuickNavAlertModal === 'function') closeQuickNavAlertModal();
    document.getElementById('tacticalTimePanel').classList.add('hidden');
    // 隱藏右下角的獨立結束按鈕與左下角的一鍵標記按鈕
    document.getElementById('tacticalStopBtn').classList.add('hidden');
    document.getElementById('tacticalQuickAlertBtn')?.classList.add('hidden');
    document.getElementById('musicAlertBanner').classList.add('hidden');
    document.getElementById('offRouteWarning').classList.add('hidden');
    exitBlackPowerSaveMode(false);
    releaseScreenWakeLockIfIdle();

    if (window.isFurnitureNavOrReplayActive && typeof restoreFurnitureModeAfterNavOrReplay === 'function') {
        restoreFurnitureModeAfterNavOrReplay();
        startIdleGPS();
        return;
    }
    window.openRouteDetail(selectedRouteIdx);
};

document.getElementById('followStopBtn').onclick = endFollowAction;
document.getElementById('tacticalStopBtn').onclick = endFollowAction;

// --- 7.5 ⚠️ 遵循導航中「一鍵即時標記黃色注意點（預設自動啟動語音輸入，不自動彈出鍵盤）」 ---
const tacticalQuickAlertBtn = document.getElementById('tacticalQuickAlertBtn');
const quickNavAlertModal = document.getElementById('quickNavAlertModal');
const quickNavAlertInput = document.getElementById('quickNavAlertInput');
const quickNavAlertCoordBadge = document.getElementById('quickNavAlertCoordBadge');
const btnQuickNavVoiceInput = document.getElementById('btnQuickNavVoiceInput');
const quickNavVoiceIcon = document.getElementById('quickNavVoiceIcon');
const quickNavVoiceBtnText = document.getElementById('quickNavVoiceBtnText');
const quickNavVoiceStatus = document.getElementById('quickNavVoiceStatus');
const quickNavVoiceDot = document.getElementById('quickNavVoiceDot');
const quickNavVoiceStatusText = document.getElementById('quickNavVoiceStatusText');
const btnConfirmQuickNavAlert = document.getElementById('btnConfirmQuickNavAlert');
const btnCancelQuickNavAlert = document.getElementById('btnCancelQuickNavAlert');

let lockedQuickAlertLng = null;
let lockedQuickAlertLat = null;
let lockedQuickAlertPtIdx = 0;
let lockedQuickAlertBearing = 0;
let quickSpeechRecognition = null;
let isQuickSpeechListening = false;
let quickSpeechSessionId = 0;

function updateQuickVoiceStatusUI(mode, message) {
    if (!quickNavVoiceStatus) return;
    quickNavVoiceStatus.classList.remove('hidden');

    if (mode === 'listening') {
        quickNavVoiceStatus.className = 'voice-breathing-banner bg-red-50 border-2 border-red-300 text-red-600 rounded-2xl px-3.5 py-2.5 flex items-center justify-center gap-2 text-sm font-black text-center shadow-sm';
        if (quickNavVoiceDot) quickNavVoiceDot.className = 'voice-breathing-dot';
    } else if (mode === 'success') {
        quickNavVoiceStatus.className = 'bg-emerald-50 border-2 border-emerald-300 text-emerald-700 rounded-2xl px-3.5 py-2.5 flex items-center justify-center gap-2 text-xs sm:text-sm font-extrabold text-center shadow-sm';
        if (quickNavVoiceDot) quickNavVoiceDot.className = 'hidden';
    } else {
        quickNavVoiceStatus.className = 'bg-amber-50 border-2 border-amber-200 text-amber-700 rounded-2xl px-3.5 py-2.5 flex items-center justify-center gap-2 text-xs font-extrabold text-center shadow-sm';
        if (quickNavVoiceDot) quickNavVoiceDot.className = 'hidden';
    }

    if (quickNavVoiceStatusText) {
        quickNavVoiceStatusText.textContent = message;
    } else {
        quickNavVoiceStatus.textContent = message;
    }
}

function stopQuickSpeechRecognition() {
    isQuickSpeechListening = false;
    quickSpeechSessionId++;
    if (quickSpeechRecognition) {
        const recToStop = quickSpeechRecognition;
        quickSpeechRecognition = null;
        try {
            recToStop.onresult = null;
            recToStop.onerror = null;
            recToStop.onend = null;
            recToStop.stop();
        } catch (e) {}
    }
    if (btnQuickNavVoiceInput) {
        btnQuickNavVoiceInput.className = 'w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-2 border-indigo-200 font-extrabold py-3 px-4 rounded-2xl active:scale-95 transition-all flex items-center justify-center gap-2 text-sm shadow-sm';
    }
    if (quickNavVoiceIcon) {
        quickNavVoiceIcon.className = 'fa-solid fa-microphone-lines text-base text-indigo-600';
    }
    if (quickNavVoiceBtnText) {
        quickNavVoiceBtnText.textContent = '🎤 重新語音輸入';
    }
}

function startQuickSpeechRecognition(clearExisting = false) {
    stopQuickSpeechRecognition();

    if (clearExisting && quickNavAlertInput) {
        quickNavAlertInput.value = '';
    }

    // 暫停正在播報的 TTS 語音並清空排隊佇列，避免干擾麥克風收音
    VoiceQueue.clear();

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
        updateQuickVoiceStatusUI('warn', '⚠️ 此瀏覽器不支援自動語音收音，請點擊輸入框使用鍵盤語音或手動輸入');
        return;
    }

    try {
        const sessionId = ++quickSpeechSessionId;
        const rec = new SpeechRec();
        rec.lang = 'zh-TW';
        rec.continuous = false;
        rec.interimResults = true;
        quickSpeechRecognition = rec;
        isQuickSpeechListening = true;

        updateQuickVoiceStatusUI('listening', '🔴 正在聆聽中... 請直接說話');

        if (btnQuickNavVoiceInput) {
            btnQuickNavVoiceInput.className = 'w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-2 border-indigo-200 font-extrabold py-3 px-4 rounded-2xl active:scale-95 transition-all flex items-center justify-center gap-2 text-sm shadow-sm';
        }
        if (quickNavVoiceIcon) {
            quickNavVoiceIcon.className = 'fa-solid fa-rotate-right text-base text-indigo-600';
        }
        if (quickNavVoiceBtnText) {
            quickNavVoiceBtnText.textContent = '🎤 重新語音輸入';
        }

        rec.onresult = (event) => {
            if (sessionId !== quickSpeechSessionId) return;
            let transcript = '';
            for (let i = 0; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            const cleanTranscript = transcript.trim();
            if (quickNavAlertInput && cleanTranscript) {
                quickNavAlertInput.value = cleanTranscript;
            }
        };

        rec.onerror = () => {
            if (sessionId !== quickSpeechSessionId) return;
            stopQuickSpeechRecognition();
            const hasText = Boolean(quickNavAlertInput && quickNavAlertInput.value.trim());
            if (hasText) {
                updateQuickVoiceStatusUI('success', '✅ 語音辨識完成！可直接點擊「確定標記」');
            } else {
                updateQuickVoiceStatusUI('warn', '⚠️ 未偵測到語音，請按「🎤 重新語音輸入」再講一次，或點擊文字框手動輸入');
            }
        };

        rec.onend = () => {
            if (sessionId !== quickSpeechSessionId) return;
            stopQuickSpeechRecognition();
            const hasText = Boolean(quickNavAlertInput && quickNavAlertInput.value.trim());
            if (hasText) {
                updateQuickVoiceStatusUI('success', '✅ 語音辨識完成！可直接點擊下方「確定標記」');
            } else {
                updateQuickVoiceStatusUI('warn', '🎤 收音結束（未偵測到語音），可按「🎤 重新語音輸入」或直接點擊「確定標記」');
            }
        };

        rec.start();
    } catch (err) {
        stopQuickSpeechRecognition();
        updateQuickVoiceStatusUI('warn', '⚠️ 無法啟動麥克風，請按「🎤 重新語音輸入」重試或點擊文字框輸入');
    }
}

function closeQuickNavAlertModal() {
    stopQuickSpeechRecognition();
    if (quickNavAlertInput) {
        quickNavAlertInput.blur();
    }
    if (quickNavAlertModal) {
        quickNavAlertModal.classList.add('hidden');
    }
}

function openQuickNavAlertModal() {
    const route = savedRoutes[selectedRouteIdx];
    if (!route || !Array.isArray(route.points) || route.points.length === 0) return;

    // 點擊瞬間立即擷取並鎖定當下最新的 GPS 經緯度與對應路線進度點（避免講話期間車輛移動導致標記偏移）
    const curLng = Array.isArray(lastKnownLngLat) && typeof lastKnownLngLat[0] === 'number'
        ? lastKnownLngLat[0]
        : route.points[0].lng;
    const curLat = Array.isArray(lastKnownLngLat) && typeof lastKnownLngLat[1] === 'number'
        ? lastKnownLngLat[1]
        : route.points[0].lat;

    lockedQuickAlertLng = Number(curLng);
    lockedQuickAlertLat = Number(curLat);
    lockedQuickAlertBearing = Number(currentHeading) || 0;

    let minDist = Infinity;
    let closestIdx = 0;
    for (let i = 0; i < route.points.length; i++) {
        const d = getDistanceKm(lockedQuickAlertLng, lockedQuickAlertLat, route.points[i].lng, route.points[i].lat);
        if (d < minDist) {
            minDist = d;
            closestIdx = i;
        }
    }
    lockedQuickAlertPtIdx = closestIdx;

    vibrate(50);

    if (quickNavAlertCoordBadge) {
        quickNavAlertCoordBadge.textContent = `📍 已鎖定座標 (${lockedQuickAlertLat.toFixed(4)}, ${lockedQuickAlertLng.toFixed(4)})`;
    }
    if (quickNavAlertInput) {
        quickNavAlertInput.value = '';
        // 禁止自動彈出手機鍵盤：確保輸入框不處於 focus 狀態，讓整個提醒視窗與下方大按鈕完整露出
        quickNavAlertInput.blur();
    }

    if (quickNavAlertModal) {
        window.history.pushState({ pwa: true }, '');
        quickNavAlertModal.classList.remove('hidden');
    }

    // 點擊黃色 ⚠️ 按鈕打開彈窗的同時，立即自動呼叫 Web Speech API (zh-TW) 開始收音
    startQuickSpeechRecognition(true);
}

if (tacticalQuickAlertBtn) {
    tacticalQuickAlertBtn.onclick = (e) => {
        e.stopPropagation();
        openQuickNavAlertModal();
    };
}

if (btnQuickNavVoiceInput) {
    btnQuickNavVoiceInput.onclick = () => {
        // 保持軟鍵盤收起，直接重新啟動語音輸入（並清空前一次講錯的內容重新填入）
        if (quickNavAlertInput) {
            quickNavAlertInput.blur();
        }
        startQuickSpeechRecognition(true);
    };
}

function confirmQuickNavAlert() {
    const route = savedRoutes[selectedRouteIdx];
    if (!route || lockedQuickAlertLng === null || lockedQuickAlertLat === null) {
        closeQuickNavAlertModal();
        return;
    }

    const noteVal = (quickNavAlertInput?.value || '').trim() || '注意路段';
    route.events = route.events || [];

    const newAlertEv = {
        type: 'alert',
        note: noteVal,
        lng: lockedQuickAlertLng,
        lat: lockedQuickAlertLat,
        ptIdx: lockedQuickAlertPtIdx,
        bearing: lockedQuickAlertBearing || 0
    };

    route.events.push(newAlertEv);

    // 同步加入當下正在執行的導航事件陣列，並標記為本次已觸發（避免剛標記完原地立刻重複播報，下趟經過時即正常播報）
    if (Array.isArray(window.activeFollowMappedEvents)) {
        const newIdx = window.activeFollowMappedEvents.length;
        newAlertEv.played = true;
        newAlertEv.prePlayed = true;
        window.activeFollowMappedEvents.push({
            ...newAlertEv,
            segmentBearing: lockedQuickAlertBearing || 0,
            played: true,
            prePlayed: true,
            sourceEvent: newAlertEv
        });
        triggeredMusicIndices.add(newIdx);
    }

    // 同步儲存回大容量資料庫 (localforage) 與 localStorage
    localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).catch(() => {});
    try {
        localStorage.setItem('yinggeCleanRoutes_v2', JSON.stringify(savedRoutes));
    } catch (e) {}

    // 同步更新路線詳情面板上的標記數量
    const detailEventsEl = document.getElementById('detailEvents');
    if (detailEventsEl) {
        detailEventsEl.innerText = `${route.events.length} 處`;
    }

    // 立即於地圖上渲染出該黃色驚嘆號提醒標記
    renderRouteMarkers(route);

    closeQuickNavAlertModal();
    vibrate([100, 50, 100]);
    showNavAlert('⚠️', `已標記：${noteVal}`, 'bg-amber-600');
}

if (btnConfirmQuickNavAlert) {
    btnConfirmQuickNavAlert.onclick = confirmQuickNavAlert;
}
if (btnCancelQuickNavAlert) {
    btnCancelQuickNavAlert.onclick = closeQuickNavAlertModal;
}
if (quickNavAlertInput) {
    quickNavAlertInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            confirmQuickNavAlert();
        }
    };
}

// --- 8. 路線分享與匯入功能 ---
document.getElementById('exportRouteBtn').onclick = async () => {
    const route = savedRoutes[selectedRouteIdx];
    const routeData = JSON.stringify(route);
    const blob = new Blob([routeData], { type: 'text/plain' });
    const file = new File([blob], `${route.name}.txt`, { type: 'text/plain' });
    
    // 🚀 判斷：如果手機支援原生分享
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { 
            await navigator.share({ title: '分享清運路線', files: [file] }); 
            return; // 分享成功，直接結束
        } catch (err) {
            // 🚀 核心修復：如果按了取消或分享中斷，直接 return 結束，不要往下跑去下載！
            return; 
        }
    }
    
    // 只有在完全不支援分享的設備，才會走到傳統下載備案
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${route.name}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert(`✅ 已下載檔案：${route.name}.txt\n請到手機的「下載」資料夾，以傳送檔案的方式發到 LINE 群組。`);
};

document.getElementById('importRouteInput').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const route = JSON.parse(event.target.result);
            if (!route.points || !route.name) throw new Error("格式不對");
            const savedRoute = upsertLocalRouteFromCloud(route);
            persistSavedRoutesToStorage().then(() => {
                renderHistoryList();
                alert(`✅ 成功匯入【${savedRoute.author || '熱心隊員'}】精心製作的路線：${savedRoute.name}`);
            });
        } catch (err) { alert('❌ 匯入失敗！請確認您選擇的是正確的路線檔案 (.txt)。'); }
        e.target.value = ''; 
    };
    reader.readAsText(file);
};

// --- 8.5 ☁️ 車隊雲端路線共享 (雙節點：正式庫 shared_routes ＆ 待審核區 pending_routes ＋ 管理員審核) ---
const FIREBASE_BASE_URL = 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app';
const FIREBASE_ROUTES_URL = `${FIREBASE_BASE_URL}/shared_routes.json`;
const FIREBASE_PENDING_URL = `${FIREBASE_BASE_URL}/pending_routes.json`;

const cloudRoutesModal = document.getElementById('cloudRoutesModal');
const cloudRoutesList = document.getElementById('cloudRoutesList');
const cloudCountBadge = document.getElementById('cloudCountBadge');
const importAllCloudBtn = document.getElementById('importAllCloudBtn');
const refreshCloudIcon = document.getElementById('refreshCloudIcon');
const adminToggleBtn = document.getElementById('adminToggleBtn');
const cloudAdminTabBar = document.getElementById('cloudAdminTabBar');
const tabSharedRoutesBtn = document.getElementById('tabSharedRoutesBtn');
const tabPendingRoutesBtn = document.getElementById('tabPendingRoutesBtn');
const pendingCountPill = document.getElementById('pendingCountPill');
const uploadConflictModal = document.getElementById('uploadConflictModal');

let cachedCloudRoutes = [];
let cachedPendingRoutes = [];
let isAdminUnlocked = false;
let currentCloudTab = 'shared'; // 'shared' | 'pending'
let lastToastedUpdateSignature = '';
let isCheckingCloudUpdatesBg = false;

function getRouteTimestampKey(r) {
    return String(r.routeId || r.originId || r.id || r.uploadedAt || r.date || '').trim();
}

// 雲端清單自動去重（若雲端存在同名或同 ID 的重複節點，僅保留版本較高或更新時間較新的那一筆）
function deduplicateCloudRoutesList(cloudList) {
    if (!Array.isArray(cloudList)) return [];
    const uniqueCloud = [];
    for (let i = 0; i < cloudList.length; i++) {
        const item = cloudList[i];
        if (!item || !item.name) continue;
        const matchIdx = uniqueCloud.findIndex(existing => isSameRouteIdentity(existing, item));
        if (matchIdx !== -1) {
            const verA = getRouteVersion(uniqueCloud[matchIdx]);
            const verB = getRouteVersion(item);
            const updA = getRouteUpdatedAt(uniqueCloud[matchIdx]);
            const updB = getRouteUpdatedAt(item);
            if (verB > verA || (verB === verA && updB > updA)) {
                uniqueCloud[matchIdx] = item;
            }
        } else {
            uniqueCloud.push(item);
        }
    }
    return uniqueCloud;
}

// 尋找與本機路線對應的雲端正式庫路線（依原路線 id、routeId 或相同名稱 name.trim() 比對）
function findMatchingCloudRoute(localRoute, cloudList = cachedCloudRoutes) {
    if (!localRoute || localRoute.isPendingPreview || !Array.isArray(cloudList) || cloudList.length === 0) return null;
    const matches = cloudList.filter(cr => isSameRouteIdentity(localRoute, cr));
    if (matches.length === 0) return null;
    // 若雲端有多筆相符，取版本最高、時間最新的一筆
    return matches.reduce((best, cur) => {
        const bestVer = getRouteVersion(best);
        const curVer = getRouteVersion(cur);
        if (curVer > bestVer) return cur;
        if (curVer === bestVer && getRouteUpdatedAt(cur) > getRouteUpdatedAt(best)) return cur;
        return best;
    }, matches[0]);
}

// 判斷本機路線是否在雲端有新版本（routeVersion 比對）
function getCloudRouteUpdateInfo(localRoute, cloudList = cachedCloudRoutes) {
    const localVer = getRouteVersion(localRoute);
    const matchingCloud = findMatchingCloudRoute(localRoute, cloudList);
    if (!matchingCloud) {
        return { hasUpdate: false, localVer, cloudVer: null, cloudRoute: null, updateTimeText: '' };
    }
    const cloudVer = getRouteVersion(matchingCloud);
    const hasUpdate = cloudVer > localVer;
    return {
        hasUpdate,
        localVer,
        cloudVer,
        cloudRoute: matchingCloud,
        updateTimeText: formatRouteUpdateTimeText(matchingCloud)
    };
}

// 同步首頁「有更新」橘紅徽章、已儲存清單頂端「一鍵全部更新」列與頂部輕量提示條
function syncRouteUpdateBadgesAndAllBar(shouldShowTopToast = false) {
    const updatableList = [];
    if (Array.isArray(savedRoutes) && Array.isArray(cachedCloudRoutes) && cachedCloudRoutes.length > 0) {
        savedRoutes.forEach((localRoute, idx) => {
            const info = getCloudRouteUpdateInfo(localRoute);
            if (info.hasUpdate && info.cloudRoute) {
                updatableList.push({ localIdx: idx, localRoute, ...info });
            }
        });
    }

    const count = updatableList.length;
    const homeBadgeEl = document.getElementById('historyUpdateBadge');
    if (homeBadgeEl) {
        if (count > 0) {
            homeBadgeEl.textContent = `有更新 (${count})`;
            homeBadgeEl.classList.remove('hidden');
        } else {
            homeBadgeEl.classList.add('hidden');
        }
    }

    const updateAllBarEl = document.getElementById('historyUpdateAllBar');
    const updateAllTextEl = document.getElementById('historyUpdateAllText');
    if (updateAllBarEl) {
        if (count > 0) {
            if (updateAllTextEl) {
                updateAllTextEl.textContent = `偵測到 ${count} 條路線在雲端有新版本`;
            }
            updateAllBarEl.classList.remove('hidden');
        } else {
            updateAllBarEl.classList.add('hidden');
        }
    }

    if (shouldShowTopToast && count > 0) {
        const sig = updatableList.map(u => `${u.localRoute.routeId || u.localRoute.name}:${u.localVer}->${u.cloudVer}`).join('|');
        if (sig && sig !== lastToastedUpdateSignature) {
            lastToastedUpdateSignature = sig;
            showNavAlert('🔄', `偵測到 ${count} 條路線在雲端有新版本，請至已儲存路線更新`, 'bg-orange-600');
        }
    }

    return updatableList;
}

// 背景自動讀取雲端路線庫並比對版本
async function checkCloudRouteUpdatesInBackground(shouldShowTopToast = false) {
    if (!navigator.onLine || isCheckingCloudUpdatesBg) return;
    isCheckingCloudUpdatesBg = true;
    try {
        const rawShared = await fetchRawFirebaseList(FIREBASE_ROUTES_URL);
        rawShared.sort((a, b) => {
            const tA = getRouteUpdatedAt(a);
            const tB = getRouteUpdatedAt(b);
            return tB - tA;
        });
        cachedCloudRoutes = deduplicateCloudRoutesList(rawShared);
        syncRouteUpdateBadgesAndAllBar(shouldShowTopToast);
        if (historyModal && !historyModal.classList.contains('hidden')) {
            renderHistoryList();
        }
    } catch (e) {
        // 離線或逾時靜默略過
    } finally {
        isCheckingCloudUpdatesBg = false;
    }
}

// 單條路線一鍵升級至雲端最新版（原地覆蓋 In-Place Overwrite，保留原排序位置與本機 id）
function applySingleCloudRouteUpdate(localIdx, cloudRoute) {
    if (!cloudRoute) return;
    const targetBefore = (localIdx >= 0 && localIdx < savedRoutes.length) ? savedRoutes[localIdx] : null;
    const oldVer = targetBefore ? getRouteVersion(targetBefore) : 1;
    const updatedLocal = upsertLocalRouteFromCloud(cloudRoute, localIdx);

    persistSavedRoutesToStorage().then(() => {
        syncRouteUpdateBadgesAndAllBar(false);
        renderHistoryList();
        if (cloudRoutesModal && !cloudRoutesModal.classList.contains('hidden')) {
            renderCloudRoutesList();
        }
        showNavAlert('✅', `已將「${updatedLocal.name}」由 v${oldVer} 原地覆蓋更新至 v${updatedLocal.routeVersion} 最新版！`, 'bg-emerald-600');
    });
}

// 多條路線一鍵全部更新至雲端最新版（原地覆蓋 In-Place Overwrite，保留原排序位置與本機 id）
function applyAllCloudRouteUpdates() {
    const updatableList = syncRouteUpdateBadgesAndAllBar(false);
    if (updatableList.length === 0) return;

    updatableList.forEach(item => {
        if (item.cloudRoute) {
            upsertLocalRouteFromCloud(item.cloudRoute, item.localIdx);
        }
    });

    persistSavedRoutesToStorage().then(() => {
        syncRouteUpdateBadgesAndAllBar(false);
        renderHistoryList();
        if (cloudRoutesModal && !cloudRoutesModal.classList.contains('hidden')) {
            renderCloudRoutesList();
        }
        showNavAlert('✅', `已完成一鍵更新！共 ${updatableList.length} 條路線原地升級為雲端最新版`, 'bg-emerald-600');
    });
}

document.getElementById('btnUpdateAllLocalRoutes')?.addEventListener('click', () => {
    applyAllCloudRouteUpdates();
});

function isRouteAlreadyInLocal(cloudRoute) {
    if (!cloudRoute) return false;
    const cVer = getRouteVersion(cloudRoute);
    const cUpd = getRouteUpdatedAt(cloudRoute);

    return savedRoutes.some(local => {
        if (!local || local.isPendingPreview) return false;
        if (!isSameRouteIdentity(local, cloudRoute)) return false;
        const lVer = getRouteVersion(local);
        const lUpd = getRouteUpdatedAt(local);
        // 若雲端版本號大於本機版本號，或同版本但雲端更新時間較新，代表雲端有新版可覆蓋更新
        if (cVer > lVer) return false;
        if (cVer === lVer && cloudRoute.uploadedAt && local.uploadedAt && cloudRoute.uploadedAt !== local.uploadedAt && cUpd > lUpd) {
            return false;
        }
        return true;
    });
}

function askUploadConflictChoice(existingRoute, localRoute) {
    return new Promise((resolve) => {
        const descEl = document.getElementById('uploadConflictDesc');
        const matchReason = (existingRoute.routeId && existingRoute.routeId === localRoute.routeId)
            ? `相同路線 ID (${localRoute.routeId})`
            : `相同路線名稱【${existingRoute.name}】`;
        descEl.innerText = `雲端已存在${matchReason}（原創作者：${existingRoute.author || '隊員'}）。請選擇您要「覆蓋更新原路線」還是「另存為新路線」：`;
        uploadConflictModal.classList.remove('hidden');

        const cleanup = (choice) => {
            uploadConflictModal.classList.add('hidden');
            resolve(choice);
        };

        document.getElementById('btnConflictOverwrite').onclick = () => cleanup('overwrite');
        document.getElementById('btnConflictSaveNew').onclick = () => cleanup('new');
        document.getElementById('btnConflictCancel').onclick = () => cleanup(null);
    });
}

async function fetchRawFirebaseList(url) {
    const res = await fetchWithTimeout(url, { cache: 'no-store' }, 5000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];
    return Object.entries(data)
        .map(([firebaseKey, val]) => ({ ...val, firebaseKey }))
        .filter(item => item && item.name && Array.isArray(item.points) && item.points.length >= 2);
}

async function publishRouteToSharedDB(payload, overwriteMode = true) {
    if (!isAdminUnlocked) {
        throw new Error('PERMISSION_DENIED_ADMIN_REQUIRED');
    }

    const sharedList = await fetchRawFirebaseList(FIREBASE_ROUTES_URL);
    const cleanTargetName = (payload.name || '').replace(/^\[待審預覽\]\s*/, '').trim();
    const targetMatches = sharedList.filter(item =>
        (payload.routeId && item.routeId && item.routeId === payload.routeId) ||
        (payload.targetRouteId && item.routeId && item.routeId === payload.targetRouteId) ||
        ((item.name || '').trim().toLowerCase() === cleanTargetName.toLowerCase())
    );

    const nowTs = Date.now();
    const nowIso = new Date(nowTs).toISOString();
    const uploadedAtText = new Date(nowTs).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const cleanPayload = { ...payload, name: cleanTargetName };
    delete cleanPayload.firebaseKey;
    delete cleanPayload.uploadAction;
    delete cleanPayload.targetFirebaseKey;
    delete cleanPayload.targetRouteId;
    delete cleanPayload.isPendingPreview;

    if (overwriteMode && targetMatches.length > 0) {
        const primaryMatch = targetMatches[0];
        const primaryKey = primaryMatch.firebaseKey;
        const maxExistingCloudVer = targetMatches.reduce((maxV, item) => Math.max(maxV, getRouteVersion(item)), 1);
        // 雲端已存在同名或同 routeId 路線：自動將 routeVersion 在雲端現有版本基礎上 + 1
        const nextVer = maxExistingCloudVer + 1;

        cleanPayload.routeId = primaryMatch.routeId || payload.targetRouteId || cleanPayload.routeId || generateRouteId();
        cleanPayload.routeVersion = nextVer;
        cleanPayload.updatedAt = nowTs;
        cleanPayload.uploadedAt = nowIso;
        cleanPayload.uploadedAtText = uploadedAtText;
        cleanPayload.date = uploadedAtText;

        const putRes = await fetchWithTimeout(`${FIREBASE_BASE_URL}/shared_routes/${primaryKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cleanPayload)
        }, 5000);
        if (!putRes.ok) throw new Error(`PUT HTTP ${putRes.status}`);

        // 清理其餘重複的舊節點
        for (let i = 1; i < targetMatches.length; i++) {
            try {
                await fetchWithTimeout(`${FIREBASE_BASE_URL}/shared_routes/${targetMatches[i].firebaseKey}.json`, { method: 'DELETE' }, 5000);
            } catch (e) {}
        }
    } else {
        cleanPayload.routeId = payload.targetRouteId || cleanPayload.routeId || generateRouteId();
        cleanPayload.routeVersion = getRouteVersion(cleanPayload);
        cleanPayload.updatedAt = nowTs;
        cleanPayload.uploadedAt = cleanPayload.uploadedAt || nowIso;
        cleanPayload.uploadedAtText = cleanPayload.uploadedAtText || uploadedAtText;
        cleanPayload.date = cleanPayload.date || uploadedAtText;

        const postRes = await fetchWithTimeout(FIREBASE_ROUTES_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cleanPayload)
        }, 5000);
        if (!postRes.ok) throw new Error(`POST HTTP ${postRes.status}`);
    }

    // 同步將本機 localStorage / localforage 中對應的路線原地更新為剛發布的最新版本（不重複新增）
    for (let i = savedRoutes.length - 1; i >= 0; i--) {
        if (savedRoutes[i]?.isPendingPreview) {
            savedRoutes.splice(i, 1);
        }
    }
    upsertLocalRouteFromCloud(cleanPayload);
    await persistSavedRoutesToStorage();

    await checkCloudRouteUpdatesInBackground(false);
    return cleanPayload;
}

async function uploadRouteToCloud(routeIdx, btnEl) {
    const r = savedRoutes[routeIdx];
    if (!r) return;

    if (!navigator.onLine) {
        alert('⚠️ 目前無網路連線，請確認網路狀態後再上傳至雲端！');
        return;
    }

    // 確保具備唯一 routeId 與初始 routeVersion 並寫回本機
    if (!r.routeId) {
        r.routeId = generateRouteId();
    }
    r.routeVersion = getRouteVersion(r);
    r.updatedAt = getRouteUpdatedAt(r);
    await localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);

    if (!confirm(`確定要將路線【${r.name}】上傳至車隊雲端路線庫嗎？`)) return;

    const defaultAuthor = r.author || localStorage.getItem('fleet_user_name') || localStorage.getItem('yinggeRouteLastAuthor') || '凱哥';
    const authorInput = prompt('請輸入分享者（創作者）名稱：', defaultAuthor);
    if (authorInput === null) return;
    const finalAuthor = authorInput.trim() || defaultAuthor;
    localStorage.setItem('yinggeRouteLastAuthor', finalAuthor);

    if (r.author !== finalAuthor) {
        r.author = finalAuthor;
        localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => renderHistoryList());
    }

    const originalBtnHtml = btnEl ? btnEl.innerHTML : '⬆️ 上傳至雲端';
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 檢查中...';
        btnEl.classList.add('opacity-70');
    }

    try {
        // 1. 先檢查雲端正式庫是否已有相同 routeId 或相同名稱的路線
        const existingShared = await fetchRawFirebaseList(FIREBASE_ROUTES_URL);
        const conflictRoute = existingShared.find(item =>
            (item.routeId && item.routeId === r.routeId) ||
            ((item.name || '').trim().toLowerCase() === (r.name || '').trim().toLowerCase())
        );

        let uploadAction = 'new';
        let finalRouteId = r.routeId;
        let finalRouteName = r.name;
        let nextRouteVersion = getRouteVersion(r);

        if (conflictRoute) {
            const choice = await askUploadConflictChoice(conflictRoute, r);
            if (!choice) return; // 使用者取消上傳
            uploadAction = choice;
            if (choice === 'overwrite') {
                finalRouteId = conflictRoute.routeId || r.routeId;
                r.routeId = finalRouteId;
                // 雲端已存在同名或同 routeId 路線：自動將 routeVersion 在原本基礎上 + 1
                const cloudBaseVer = getRouteVersion(conflictRoute);
                nextRouteVersion = Math.max(cloudBaseVer, getRouteVersion(r)) + 1;
                await localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);
            } else if (choice === 'new') {
                finalRouteId = generateRouteId();
                r.routeId = finalRouteId;
                nextRouteVersion = 1;
                const newNameInput = prompt('您選擇「另存為新路線」，請確認或修改路線名稱：', r.name);
                if (newNameInput === null) return;
                if (newNameInput.trim()) {
                    finalRouteName = newNameInput.trim();
                    r.name = finalRouteName;
                }
                await localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);
                renderHistoryList();
            }
        }

        // 2. 嚴格權限隔離：非管理員（!isAdminUnlocked）點擊上傳時，一律寫入 pending_routes；
        // 僅在開啟管理員權限（isAdminUnlocked === true）下，才可直接覆蓋 shared_routes。
        const publishDirectlyAsAdmin = Boolean(isAdminUnlocked);

        if (btnEl) {
            btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 上傳中...';
        }

        const nowTs = Date.now();
        const nowIso = new Date(nowTs).toISOString();
        const uploadedAtText = new Date(nowTs).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const payload = {
            routeId: finalRouteId,
            targetRouteId: conflictRoute ? (conflictRoute.routeId || finalRouteId) : finalRouteId,
            id: r.id || nowTs,
            originId: r.originId || r.id || nowTs,
            name: finalRouteName,
            author: finalAuthor,
            routeVersion: nextRouteVersion,
            updatedAt: nowTs,
            date: r.date || uploadedAtText,
            uploadedAt: nowIso,
            uploadedAtText: uploadedAtText,
            distance: r.distance || '0.00',
            timeStr: r.timeStr || '0m 0s',
            uploadAction: uploadAction,
            targetFirebaseKey: conflictRoute ? conflictRoute.firebaseKey : null,
            points: r.points || [],
            events: r.events || [],
            callouts: Array.isArray(r.callouts) ? r.callouts : []
        };

        if (publishDirectlyAsAdmin) {
            const published = await publishRouteToSharedDB(payload, uploadAction === 'overwrite');
            renderHistoryList();
            alert(`✅ 管理員直通上架成功！\n路線【${finalRouteName}】(v${published.routeVersion}) 已${uploadAction === 'overwrite' ? '覆蓋更新至' : '新增至'}正式雲端路線庫。`);
        } else {
            // 一般隊員上傳至 pending_routes：不提前竄改本機正式版號，待管理員審核通過後再同步升級
            r.updatedAt = nowTs;
            r.uploadedAt = nowIso;
            r.uploadedAtText = uploadedAtText;
            await persistSavedRoutesToStorage();
            renderHistoryList();

            const res = await fetchWithTimeout(FIREBASE_PENDING_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }, 5000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            alert(`✅ 已提交至待審核區（pending_routes），待管理員審核確認後發布正式版！\n\n路線名稱：${finalRouteName} (目標版本 v${nextRouteVersion})\n分享隊員：${finalAuthor}\n提交模式：${uploadAction === 'overwrite' ? '🔄 覆蓋更新原路線' : '🆕 新增路線'}`);
        }
    } catch (err) {
        console.error('上傳雲端失敗:', err);
        alert('❌ 上傳失敗（網路不穩或連線逾時）！請檢查網路狀態後再試。');
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = originalBtnHtml;
            btnEl.classList.remove('opacity-70');
        }
    }
}

function setAdminModeUI(unlocked) {
    isAdminUnlocked = unlocked;
    if (isAdminUnlocked) {
        adminToggleBtn.className = "px-2.5 h-9 rounded-xl bg-amber-500 text-white border border-amber-600 text-xs font-extrabold flex items-center gap-1 shadow-sm active:scale-95 transition-all whitespace-nowrap";
        adminToggleBtn.innerHTML = '🔓 管理員';
        cloudAdminTabBar.classList.remove('hidden');
    } else {
        adminToggleBtn.className = "px-2.5 h-9 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-extrabold flex items-center gap-1 active:scale-95 transition-all whitespace-nowrap";
        adminToggleBtn.innerHTML = '🔑 管理員';
        cloudAdminTabBar.classList.add('hidden');
        currentCloudTab = 'shared';
        updateCloudTabButtons();
    }
}

function updateCloudTabButtons() {
    if (currentCloudTab === 'shared') {
        tabSharedRoutesBtn.className = "flex-1 py-2 rounded-xl text-xs font-extrabold bg-blue-600 text-white shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1";
        tabPendingRoutesBtn.className = "flex-1 py-2 rounded-xl text-xs font-extrabold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all active:scale-95 flex items-center justify-center gap-1.5";
    } else {
        tabSharedRoutesBtn.className = "flex-1 py-2 rounded-xl text-xs font-extrabold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all active:scale-95 flex items-center justify-center gap-1";
        tabPendingRoutesBtn.className = "flex-1 py-2 rounded-xl text-xs font-extrabold bg-amber-500 text-white shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1.5";
    }
}

adminToggleBtn.onclick = () => {
    if (!isAdminUnlocked) {
        const pwd = prompt('🔑 請輸入管理員密碼：');
        if (pwd === null) return;
        if (pwd.trim() === ADMIN_PASSWORD) {
            setAdminModeUI(true);
            fetchCloudRoutes();
            alert('✅ 管理員模式已解鎖！\n您現在可切換檢視「待審核投稿區」進行「🔍 審核預覽／微調」、一鍵核准發布或駁回刪除。');
        } else {
            alert('❌ 管理員密碼錯誤！');
        }
    } else {
        if (confirm('確定要退出管理員模式嗎？')) {
            setAdminModeUI(false);
            renderCloudRoutesList();
        }
    }
};

tabSharedRoutesBtn.onclick = () => {
    currentCloudTab = 'shared';
    updateCloudTabButtons();
    renderCloudRoutesList();
};

tabPendingRoutesBtn.onclick = () => {
    currentCloudTab = 'pending';
    updateCloudTabButtons();
    renderCloudRoutesList();
};

async function fetchCloudRoutes() {
    if (!navigator.onLine) {
        cloudCountBadge.innerText = '⚠️ 目前離線中';
        importAllCloudBtn.classList.add('hidden');
        cloudRoutesList.innerHTML = `
            <div class="text-center text-gray-400 py-14">
                <i class="fa-solid fa-wifi text-3xl mb-3 text-red-400"></i>
                <p class="text-sm font-extrabold text-gray-600">偵測不到網路連線</p>
                <p class="text-xs text-gray-400 mt-1">請開啟行動數據或 Wi-Fi 後點擊右上角重新整理</p>
            </div>`;
        alert('⚠️ 目前無網路連線，無法讀取雲端路線庫！');
        return;
    }

    cloudCountBadge.innerText = '⏳ 正在連線雲端資料庫...';
    importAllCloudBtn.classList.add('hidden');
    refreshCloudIcon?.classList.add('fa-spin');
    cloudRoutesList.innerHTML = `
        <div class="text-center text-gray-400 py-14">
            <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3 text-blue-500"></i>
            <p class="text-sm font-extrabold text-gray-600">正在載入車隊雲端路線...</p>
        </div>`;

    try {
        const [rawShared, rawPending] = await Promise.all([
            fetchRawFirebaseList(FIREBASE_ROUTES_URL),
            fetchRawFirebaseList(FIREBASE_PENDING_URL).catch(() => [])
        ]);

        // 排序正式庫（由新到舊）並自動去重
        rawShared.sort((a, b) => {
            const tA = getRouteUpdatedAt(a);
            const tB = getRouteUpdatedAt(b);
            return tB - tA;
        });
        cachedCloudRoutes = deduplicateCloudRoutesList(rawShared);

        // 排序待審核區（由新到舊）
        rawPending.sort((a, b) => {
            const tA = getRouteUpdatedAt(a);
            const tB = getRouteUpdatedAt(b);
            return tB - tA;
        });
        cachedPendingRoutes = rawPending;
        if (pendingCountPill) pendingCountPill.innerText = cachedPendingRoutes.length;

        syncRouteUpdateBadgesAndAllBar(false);
        renderHistoryList();
        renderCloudRoutesList();
    } catch (err) {
        console.error('讀取雲端路線失敗:', err);
        cloudCountBadge.innerText = '❌ 讀取失敗';
        importAllCloudBtn.classList.add('hidden');
        cloudRoutesList.innerHTML = `
            <div class="text-center text-gray-400 py-14">
                <i class="fa-solid fa-triangle-exclamation text-3xl mb-3 text-amber-500"></i>
                <p class="text-sm font-extrabold text-gray-600">無法讀取雲端路線庫</p>
                <p class="text-xs text-gray-400 mt-1">請確認網路連線正常，再點擊右上角重新整理</p>
            </div>`;
        alert('❌ 無法連線至雲端路線庫（連線逾時或網路不穩），請稍後再試！');
    } finally {
        refreshCloudIcon?.classList.remove('fa-spin');
    }
}

async function approvePendingRoute(pendingIdx, btnEl) {
    const pr = cachedPendingRoutes[pendingIdx];
    if (!pr || !isAdminUnlocked) return;

    const cleanName = (pr.name || '').replace(/^\[待審預覽\]\s*/, '').trim();
    const matchingShared = cachedCloudRoutes.find(item =>
        (pr.routeId && item.routeId && item.routeId === pr.routeId) ||
        (pr.targetRouteId && item.routeId && item.routeId === pr.targetRouteId) ||
        ((item.name || '').trim().toLowerCase() === cleanName.toLowerCase())
    );
    const isOverwrite = Boolean(matchingShared || pr.uploadAction === 'overwrite');
    const resolvedTargetId = matchingShared?.routeId || pr.targetRouteId || pr.routeId || generateRouteId();
    const modeText = isOverwrite ? '【原地覆蓋升版】正式庫路線' : '【新增發布】至正式路線庫';
    if (!confirm(`確定要核准【${pr.author || '隊員'}】投稿的路線「${cleanName}」並${modeText}嗎？`)) return;

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 發布中';
    }

    try {
        const payloadToPublish = {
            ...pr,
            name: cleanName,
            routeId: resolvedTargetId,
            targetRouteId: resolvedTargetId
        };
        const published = await publishRouteToSharedDB(payloadToPublish, true);
        const delRes = await fetchWithTimeout(`${FIREBASE_BASE_URL}/pending_routes/${pr.firebaseKey}.json`, { method: 'DELETE' }, 5000);
        if (!delRes.ok) throw new Error(`DELETE pending HTTP ${delRes.status}`);

        showNavAlert('✅', `已核准並發布「${cleanName}」(v${published.routeVersion})，並自動清除待審紀錄！`, 'bg-emerald-600');
        await fetchCloudRoutes();
    } catch (err) {
        console.error('核准失敗:', err);
        alert('❌ 核准上架失敗（網路不穩或逾時），請檢查網路連線後再試！');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '✅ 直接核准';
        }
    }
}

// 🔍 1. 新增「審核預覽／直接微調」入口：
// 點擊後直接在地圖載入該筆待審路線並進入「審核模式」（記錄 reviewingPendingId 與 targetRouteId），
// 嚴禁將它重複新增到本機 savedRoutes 清單，並直接使用現有路線編輯器（拖曳微調／手繪延伸剪接／標記編輯）進行二次修改
function previewPendingRoute(pendingIdx) {
    const pr = cachedPendingRoutes[pendingIdx];
    if (!pr || !isAdminUnlocked) {
        alert('⚠️ 僅限管理員權限可進入待審路線審核微調模式！');
        return;
    }

    const cleanBaseName = (pr.name || '未命名路線').replace(/^\[待審預覽\]\s*/, '').trim();
    const matchingOfficial = cachedCloudRoutes.find(item =>
        (pr.routeId && item.routeId && item.routeId === pr.routeId) ||
        (pr.targetRouteId && item.routeId && item.routeId === pr.targetRouteId) ||
        ((item.name || '').trim().toLowerCase() === cleanBaseName.toLowerCase())
    );

    reviewingPendingId = pr.firebaseKey;
    targetRouteId = matchingOfficial?.routeId || pr.targetRouteId || pr.routeId || generateRouteId();
    isReviewingPendingMode = true;

    reviewingPendingRoute = {
        ...JSON.parse(JSON.stringify(pr)),
        name: cleanBaseName,
        routeId: targetRouteId,
        targetRouteId: targetRouteId,
        author: pr.author || '熱心隊員',
        distance: pr.distance || '0.00',
        timeStr: pr.timeStr || '0m 0s',
        points: JSON.parse(JSON.stringify(pr.points || [])),
        events: JSON.parse(JSON.stringify(pr.events || [])),
        callouts: JSON.parse(JSON.stringify(pr.callouts || []))
    };

    // 確保距離、方位角與標記索引同步
    syncRouteMarkersAndIndicesAfterSpline(reviewingPendingRoute, null, false);

    // 關閉雲端彈窗與主畫面面板，直接進入地圖審核編輯器
    cloudRoutesModal.classList.add('hidden');
    historyModal.classList.add('hidden');
    document.getElementById('mainUI').classList.add('hidden');
    document.getElementById('routeDetailUI').classList.add('hidden');
    document.getElementById('playbackUI').classList.add('hidden');
    document.getElementById('topBackBtn').classList.remove('hidden');

    isEditingMode = true;
    editStep = 0;
    selectedEditNodeIdx = -1;
    freehandUndoStack = [];
    freehandSpliceStartIdx = -1;
    freehandDraftCoords = [];
    originalEventsBackup = JSON.parse(JSON.stringify(reviewingPendingRoute.events || []));
    originalPointsBackup = JSON.parse(JSON.stringify(reviewingPendingRoute.points || []));
    originalCalloutsBackup = JSON.parse(JSON.stringify(reviewingPendingRoute.callouts || []));

    // 切換編輯面板為「待審微調審核模式」專屬 UI
    if (pendingReviewBanner) pendingReviewBanner.classList.remove('hidden');
    if (pendingReviewRouteTitle) {
        const nextVerHint = matchingOfficial ? `覆蓋升版 ➔ v${getRouteVersion(matchingOfficial) + 1}` : '全新路線 v1';
        pendingReviewRouteTitle.textContent = `${cleanBaseName}（${nextVerHint}）`;
    }
    if (pendingReviewMetaText) {
        pendingReviewMetaText.textContent = `投稿隊員：${reviewingPendingRoute.author} · 可直接微調路線/標記後一鍵核准發布`;
    }
    if (normalEditActionRow) normalEditActionRow.classList.add('hidden');
    if (pendingReviewActionRow) pendingReviewActionRow.classList.remove('hidden');

    document.getElementById('editRouteBar').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = `🔍 審核微調：${cleanBaseName}`;

    map.getSource('bg-route')?.setData(emptyGeoJSON());
    updateRouteLayers(reviewingPendingRoute.points);
    ensureEditorMapZoomEnabled();
    setEditSubMode('path');
    renderEditableRouteMarkers(reviewingPendingRoute);

    if (Array.isArray(reviewingPendingRoute.points) && reviewingPendingRoute.points.length >= 2) {
        const bounds = new maplibregl.LngLatBounds();
        reviewingPendingRoute.points.forEach(p => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: { top: 90, bottom: 300, left: 50, right: 50 }, bearing: 0, duration: 500 });
    }

    showNavAlert('🔍', `已載入待審路線「${cleanBaseName}」，可直接微調後按底部「✅ 核准並發布正式版」`, 'bg-amber-600');
}

function exitPendingReviewMode(reopenCloudPendingModal = true) {
    isEditingMode = false;
    isReviewingPendingMode = false;
    reviewingPendingId = null;
    targetRouteId = null;
    reviewingPendingRoute = null;
    selectedEditNodeIdx = -1;

    clearPathEditMarkers();
    clearPendingCalloutAnchor();
    cancelActiveFreehandStroke(true);
    freehandUndoStack = [];
    updateUndoFreehandBtnUI();
    updateNodeTrimPanelUI(null);
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    try { map.dragPan.enable(); } catch (e) {}
    ensureEditorMapZoomEnabled();

    if (pendingReviewBanner) pendingReviewBanner.classList.add('hidden');
    if (pendingReviewActionRow) pendingReviewActionRow.classList.add('hidden');
    if (normalEditActionRow) normalEditActionRow.classList.remove('hidden');
    document.getElementById('editRouteBar').classList.add('hidden');
    document.getElementById('topBackBtn').classList.add('hidden');
    document.getElementById('mainUI').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = '鶯歌清運路線助手';

    clearDomMarkers();
    updateRouteLayers([]);
    map.getSource('bg-route')?.setData(emptyGeoJSON());

    if (reopenCloudPendingModal) {
        currentCloudTab = 'pending';
        updateCloudTabButtons();
        cloudRoutesModal.classList.remove('hidden');
        fetchCloudRoutes();
    }
}

if (btnExitPendingReview) {
    btnExitPendingReview.onclick = () => {
        exitPendingReviewMode(true);
    };
}

// ✅ 2. 「✅ 核准並發布正式版」一鍵自動化（免改名 ＋ 自動升版寫入 shared_routes ＋ 自動刪除 pending_routes ＋ 同步原地更新本機 localStorage）
async function approveAndPublishReviewedPendingRoute() {
    if (!isAdminUnlocked || !isReviewingPendingMode || !reviewingPendingRoute || !reviewingPendingId) {
        alert('⚠️ 僅限管理員在審核模式下執行核准發布！');
        return;
    }

    if (!navigator.onLine) {
        alert('⚠️ 目前無網路連線，請確認網路狀態後再核准發布！');
        return;
    }

    if (!Array.isArray(reviewingPendingRoute.points) || reviewingPendingRoute.points.length < 2) {
        alert('⚠️ 路線軌跡點不足 2 點，無法發布！');
        return;
    }

    // 1. 取得當前畫面上的最終路線資料（包含管理員剛剛順手做的所有微調、修剪、手繪與標記修改）
    syncRouteMarkersAndIndicesAfterSpline(reviewingPendingRoute, null, true);

    const cleanName = (reviewingPendingRoute.name || '未命名路線').replace(/^\[待審預覽\]\s*/, '').trim();
    const pendingKeyToDelete = reviewingPendingId;
    const finalTargetRouteId = targetRouteId || reviewingPendingRoute.routeId || generateRouteId();

    const originalBtnHtml = btnApproveAndPublishReview ? btnApproveAndPublishReview.innerHTML : '✅ 核准並發布正式版';
    if (btnApproveAndPublishReview) {
        btnApproveAndPublishReview.disabled = true;
        btnApproveAndPublishReview.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在核准並發布...';
    }
    if (btnRejectAndDeleteReview) btnRejectAndDeleteReview.disabled = true;

    try {
        // 2. 免修改路線名稱，直接以原路線的 routeId (targetRouteId) 寫入 Firebase shared_routes
        // 若已存在同 routeId 或同名路線則原地覆蓋並自動將 routeVersion + 1 與更新 updatedAt；若為全新路線則建立新 ID
        const payloadToPublish = {
            ...reviewingPendingRoute,
            name: cleanName,
            routeId: finalTargetRouteId,
            targetRouteId: finalTargetRouteId
        };

        const published = await publishRouteToSharedDB(payloadToPublish, true);

        // 3. 寫入成功後，自動呼叫 Firebase 刪除 pending_routes/${reviewingPendingId}，將該筆待審紀錄從待審區移除
        const delRes = await fetchWithTimeout(`${FIREBASE_BASE_URL}/pending_routes/${pendingKeyToDelete}.json`, {
            method: 'DELETE'
        }, 5000);
        if (!delRes.ok) throw new Error(`DELETE pending HTTP ${delRes.status}`);

        // 4. publishRouteToSharedDB 已同步透過 upsertLocalRouteFromCloud + persistSavedRoutesToStorage 將管理員本機 localStorage 對應路線原地更新為剛發布的最新版本
        renderHistoryList();

        exitPendingReviewMode(true);
        showNavAlert('✅', `已核准發布「${published.name}」正式版 (v${published.routeVersion})，並自動清除待審紀錄與同步更新本機！`, 'bg-emerald-600');
    } catch (err) {
        console.error('審核核准並發布失敗:', err);
        alert('❌ 核准並發布正式版失敗（網路不穩或連線逾時），請檢查網路後再試！');
    } finally {
        if (btnApproveAndPublishReview) {
            btnApproveAndPublishReview.disabled = false;
            btnApproveAndPublishReview.innerHTML = originalBtnHtml;
        }
        if (btnRejectAndDeleteReview) btnRejectAndDeleteReview.disabled = false;
    }
}

// 🗑️ 審核模式底部「🗑️ 駁回刪除」按鈕
async function rejectReviewedPendingRoute() {
    if (!isAdminUnlocked || !isReviewingPendingMode || !reviewingPendingRoute || !reviewingPendingId) {
        return;
    }

    const cleanName = (reviewingPendingRoute.name || '未命名路線').replace(/^\[待審預覽\]\s*/, '').trim();
    if (!confirm(`確定要駁回並從待審區永久刪除【${reviewingPendingRoute.author || '隊員'}】投稿的路線「${cleanName}」嗎？`)) {
        return;
    }

    const pendingKeyToDelete = reviewingPendingId;
    const originalBtnHtml = btnRejectAndDeleteReview ? btnRejectAndDeleteReview.innerHTML : '🗑️ 駁回刪除';
    if (btnRejectAndDeleteReview) {
        btnRejectAndDeleteReview.disabled = true;
        btnRejectAndDeleteReview.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 刪除中';
    }
    if (btnApproveAndPublishReview) btnApproveAndPublishReview.disabled = true;

    try {
        const res = await fetchWithTimeout(`${FIREBASE_BASE_URL}/pending_routes/${pendingKeyToDelete}.json`, {
            method: 'DELETE'
        }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // 清除本機若曾殘留的舊版待審預覽項目
        let removedLegacyPreview = false;
        for (let i = savedRoutes.length - 1; i >= 0; i--) {
            if (savedRoutes[i]?.isPendingPreview) {
                savedRoutes.splice(i, 1);
                removedLegacyPreview = true;
            }
        }
        if (removedLegacyPreview) {
            await persistSavedRoutesToStorage();
            renderHistoryList();
        }

        exitPendingReviewMode(true);
        showNavAlert('🗑️', `已駁回並刪除待審路線「${cleanName}」`, 'bg-rose-600');
    } catch (err) {
        console.error('駁回刪除待審路線失敗:', err);
        alert('❌ 駁回刪除失敗（網路不穩或逾時），請檢查網路連線後再試！');
    } finally {
        if (btnRejectAndDeleteReview) {
            btnRejectAndDeleteReview.disabled = false;
            btnRejectAndDeleteReview.innerHTML = originalBtnHtml;
        }
        if (btnApproveAndPublishReview) btnApproveAndPublishReview.disabled = false;
    }
}

if (btnApproveAndPublishReview) {
    btnApproveAndPublishReview.onclick = () => approveAndPublishReviewedPendingRoute();
}
if (btnRejectAndDeleteReview) {
    btnRejectAndDeleteReview.onclick = () => rejectReviewedPendingRoute();
}

async function rejectPendingRoute(pendingIdx, btnEl) {
    const pr = cachedPendingRoutes[pendingIdx];
    if (!pr || !isAdminUnlocked) return;

    if (!confirm(`確定要駁回刪除待審核路線【${pr.name}】（投稿者：${pr.author || '隊員'}）嗎？`)) return;

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
        const res = await fetchWithTimeout(`${FIREBASE_BASE_URL}/pending_routes/${pr.firebaseKey}.json`, { method: 'DELETE' }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        showNavAlert('🗑️', `已駁回刪除待審核路線【${pr.name}】`, 'bg-rose-600');
        await fetchCloudRoutes();
    } catch (err) {
        console.error('刪除待審核路線失敗:', err);
        alert('❌ 刪除失敗（網路不穩或逾時），請檢查網路連線後再試！');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '🗑️ 駁回刪除';
        }
    }
}

async function deleteSharedCloudRoute(sharedIdx, btnEl) {
    const cr = cachedCloudRoutes[sharedIdx];
    if (!cr || !isAdminUnlocked) return;

    if (!confirm(`⚠️ 管理員確認：\n確定要從「正式雲端路線庫」永久刪除【${cr.name}】嗎？`)) return;

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
        const res = await fetchWithTimeout(`${FIREBASE_BASE_URL}/shared_routes/${cr.firebaseKey}.json`, { method: 'DELETE' }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        alert(`🗑️ 已從正式雲端路線庫刪除【${cr.name}】。`);
        await fetchCloudRoutes();
    } catch (err) {
        console.error('刪除雲端路線失敗:', err);
        alert('❌ 刪除失敗（網路不穩或逾時），請檢查網路連線後再試！');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '🗑️ 刪除';
        }
    }
}

function renderCloudRoutesList() {
    cloudRoutesList.innerHTML = '';
    if (pendingCountPill) pendingCountPill.innerText = cachedPendingRoutes.length;

    // --- 管理員「待審核投稿區」視圖 ---
    if (isAdminUnlocked && currentCloudTab === 'pending') {
        importAllCloudBtn.classList.add('hidden');
        if (cachedPendingRoutes.length === 0) {
            cloudCountBadge.innerText = '目前共 0 條待審核路線';
            cloudRoutesList.innerHTML = `
                <div class="text-center text-gray-400 py-14">
                    <i class="fa-solid fa-clipboard-check text-3xl mb-2 opacity-40"></i>
                    <p class="text-sm font-bold">目前沒有待審核的投稿路線</p>
                </div>`;
            return;
        }

        cloudCountBadge.innerText = `⏳ 待審核投稿共 ${cachedPendingRoutes.length} 條`;
        cachedPendingRoutes.forEach((pr, idx) => {
            const stopsCount = (pr.points || []).filter(p => p.is_stop).length;
            const eventsCount = (pr.events || []).length;
            const timeDisplay = pr.uploadedAtText || pr.date || '未知時間';
            const cleanName = (pr.name || '').replace(/^\[待審預覽\]\s*/, '').trim();
            const matchingOfficial = cachedCloudRoutes.find(item =>
                (pr.routeId && item.routeId && item.routeId === pr.routeId) ||
                (pr.targetRouteId && item.routeId && item.routeId === pr.targetRouteId) ||
                ((item.name || '').trim().toLowerCase() === cleanName.toLowerCase())
            );
            const isOverwrite = Boolean(matchingOfficial || pr.uploadAction === 'overwrite');
            const actionBadge = isOverwrite
                ? `<span class="bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded-full font-extrabold">🔄 覆蓋升版${matchingOfficial ? ` (v${getRouteVersion(matchingOfficial)}➔v${getRouteVersion(matchingOfficial) + 1})` : ''}</span>`
                : `<span class="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded-full font-extrabold">🆕 新增路線 (v1)</span>`;

            const card = document.createElement('div');
            card.className = "bg-white p-3.5 rounded-2xl shadow-sm border-2 border-amber-200 flex flex-col gap-2.5";
            card.innerHTML = `
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-black text-gray-900 text-sm truncate">${cleanName}</span>
                            <span class="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap">
                                <i class="fa-solid fa-user-ninja mr-0.5"></i>${pr.author || '熱心隊員'}
                            </span>
                            ${actionBadge}
                        </div>
                        <div class="text-[11px] text-gray-400 mt-1">投稿時間：${timeDisplay}</div>
                        <div class="flex items-center gap-3 text-[11px] font-bold mt-1">
                            <span class="text-blue-600"><i class="fa-solid fa-route mr-1"></i>${pr.distance || '0.00'} km</span>
                            <span class="text-green-600"><i class="fa-solid fa-music mr-1"></i>${eventsCount} 處標記</span>
                            ${stopsCount > 0 ? `<span class="text-indigo-600"><i class="fa-regular fa-clock mr-1"></i>${stopsCount} 站牌</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 pt-1 border-t border-gray-100">
                    <button type="button" class="preview-pending-btn flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-2 px-2.5 rounded-xl text-xs shadow-sm active:scale-95 transition-all whitespace-nowrap">
                        🔍 審核預覽／微調
                    </button>
                    <button type="button" class="approve-pending-btn bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-3 py-2 rounded-xl text-xs shadow-sm active:scale-95 transition-all whitespace-nowrap">
                        ✅ 直接核准
                    </button>
                    <button type="button" class="reject-pending-btn bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-extrabold px-2.5 py-2 rounded-xl text-xs active:scale-95 transition-all whitespace-nowrap">
                        🗑️ 駁回刪除
                    </button>
                </div>
            `;

            const previewBtn = card.querySelector('.preview-pending-btn');
            const approveBtn = card.querySelector('.approve-pending-btn');
            const rejectBtn = card.querySelector('.reject-pending-btn');
            previewBtn.onclick = () => previewPendingRoute(idx);
            approveBtn.onclick = () => approvePendingRoute(idx, approveBtn);
            rejectBtn.onclick = () => rejectPendingRoute(idx, rejectBtn);
            cloudRoutesList.appendChild(card);
        });
        return;
    }

    // --- 「正式路線庫」視圖 ---
    if (cachedCloudRoutes.length === 0) {
        cloudCountBadge.innerText = '目前共 0 條雲端路線';
        importAllCloudBtn.classList.add('hidden');
        cloudRoutesList.innerHTML = `
            <div class="text-center text-gray-400 py-14">
                <i class="fa-solid fa-cloud text-3xl mb-2 opacity-40"></i>
                <p class="text-sm font-bold">雲端尚無共享的清運路線</p>
                <p class="text-xs text-gray-400 mt-1">可從本機路線卡片點擊「⬆️ 上傳至雲端」分享第一條路線！</p>
            </div>`;
        return;
    }

    cloudCountBadge.innerText = `共 ${cachedCloudRoutes.length} 條雲端共享路線`;
    importAllCloudBtn.classList.remove('hidden');

    cachedCloudRoutes.forEach((cr, idx) => {
        const alreadyLocal = isRouteAlreadyInLocal(cr);
        const cloudVer = getRouteVersion(cr);
        const stopsCount = (cr.points || []).filter(p => p.is_stop).length;
        const eventsCount = (cr.events || []).length;
        const timeDisplay = formatRouteUpdateTimeText(cr);

        const card = document.createElement('div');
        card.className = "bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between gap-2";
        card.innerHTML = `
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-black text-gray-900 text-sm truncate">${cr.name}</span>
                    <span class="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded-md font-extrabold whitespace-nowrap">v${cloudVer}</span>
                    <span class="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap">
                        <i class="fa-solid fa-user-ninja mr-0.5"></i>${cr.author || '熱心隊員'}
                    </span>
                </div>
                <div class="text-[11px] text-gray-400 mt-0.5">更新/建立：${timeDisplay}</div>
                <div class="flex items-center gap-3 text-[11px] font-bold mt-1">
                    <span class="text-blue-600"><i class="fa-solid fa-route mr-1"></i>${cr.distance || '0.00'} km</span>
                    <span class="text-green-600"><i class="fa-solid fa-music mr-1"></i>${eventsCount} 處標記</span>
                    ${stopsCount > 0 ? `<span class="text-indigo-600"><i class="fa-regular fa-clock mr-1"></i>${stopsCount} 站牌</span>` : ''}
                </div>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
                <button type="button" class="single-cloud-import-btn px-3 py-2 rounded-xl text-xs font-extrabold transition-all active:scale-95 ${
                    alreadyLocal
                        ? 'bg-gray-100 text-gray-400 border border-gray-200'
                        : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                }">
                    ${alreadyLocal ? '✅ 已是最新' : '⬇️ 匯入/更新'}
                </button>
                ${isAdminUnlocked ? `
                <button type="button" class="admin-delete-shared-btn bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-2.5 py-2 rounded-xl text-xs font-extrabold active:scale-95 transition-all" title="管理員刪除此雲端路線">
                    🗑️ 刪除
                </button>` : ''}
            </div>
        `;

        card.querySelector('.single-cloud-import-btn').onclick = () => importSingleCloudRoute(idx);
        const delBtn = card.querySelector('.admin-delete-shared-btn');
        if (delBtn) {
            delBtn.onclick = () => deleteSharedCloudRoute(idx, delBtn);
        }
        cloudRoutesList.appendChild(card);
    });
}

function cloneCloudRouteForLocal(cr, existingLocal = null) {
    const rawName = String(cr.name || existingLocal?.name || '未命名路線').trim();
    const cleanName = rawName.replace(/\s+[vV]\d+(\.\d+)?$/i, '').trim() || rawName;
    return {
        routeId: cr.routeId || existingLocal?.routeId || generateRouteId(),
        id: existingLocal?.id || cr.id || (Date.now() + Math.floor(Math.random() * 1000)),
        originId: existingLocal?.originId || existingLocal?.id || cr.originId || cr.id || Date.now(),
        name: cleanName,
        author: cr.author || existingLocal?.author || '熱心隊員',
        routeVersion: getRouteVersion(cr),
        updatedAt: getRouteUpdatedAt(cr),
        date: cr.date || cr.uploadedAtText || existingLocal?.date || new Date().toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        uploadedAt: cr.uploadedAt || existingLocal?.uploadedAt || '',
        uploadedAtText: cr.uploadedAtText || existingLocal?.uploadedAtText || '',
        distance: cr.distance || existingLocal?.distance || '0.00',
        timeStr: cr.timeStr || existingLocal?.timeStr || '0m 0s',
        points: JSON.parse(JSON.stringify(cr.points || [])),
        events: JSON.parse(JSON.stringify(cr.events || [])),
        callouts: JSON.parse(JSON.stringify(cr.callouts || []))
    };
}

// 原地覆蓋（In-Place Overwrite）：先以「原路線 id / routeId」或「相同的路線名稱（name.trim()）」比對本機清單
// 若已存在則直接 savedRoutes[index] = updatedRoute 原地替換（保留原本排序位置與本機 id），嚴禁重複新增；僅在完全找不到同名／同 ID 路線時才新增
function upsertLocalRouteFromCloud(cr, preferredLocalIdx = -1) {
    const matchingIndices = [];
    for (let i = 0; i < savedRoutes.length; i++) {
        const local = savedRoutes[i];
        if (!local || local.isPendingPreview) continue;
        if (isSameRouteIdentity(local, cr)) {
            matchingIndices.push(i);
        }
    }

    let targetIdx = -1;
    if (matchingIndices.length > 0) {
        // 優先保留最早出現的原始排序位置（若有多筆歷史殘留重複，以第一筆位置為準並清除後續重複項）
        targetIdx = matchingIndices[0];
    } else if (preferredLocalIdx >= 0 && preferredLocalIdx < savedRoutes.length && !savedRoutes[preferredLocalIdx]?.isPendingPreview) {
        targetIdx = preferredLocalIdx;
    }

    let savedItem;
    if (targetIdx !== -1) {
        const existingLocal = savedRoutes[targetIdx];
        savedItem = cloneCloudRouteForLocal(cr, existingLocal);
        savedRoutes[targetIdx] = savedItem;

        // 若本機清單曾有其餘同名/同 ID 的重複殘留項，一併從後往前移除
        for (let k = matchingIndices.length - 1; k >= 0; k--) {
            const dupIdx = matchingIndices[k];
            if (dupIdx !== targetIdx) {
                savedRoutes.splice(dupIdx, 1);
            }
        }
    } else {
        savedItem = cloneCloudRouteForLocal(cr, null);
        savedRoutes.unshift(savedItem);
    }

    deduplicateSavedRoutes(false);
    return savedItem;
}

function importSingleCloudRoute(cloudIdx) {
    const cr = cachedCloudRoutes[cloudIdx];
    if (!cr) return;

    if (isRouteAlreadyInLocal(cr)) {
        alert(`ℹ️ 路線【${cr.name}】已是最新版本並存在於本機路線庫中，無須重複匯入！`);
        renderCloudRoutesList();
        return;
    }

    const hadExisting = savedRoutes.some(local => !local?.isPendingPreview && isSameRouteIdentity(local, cr));
    const newRoute = upsertLocalRouteFromCloud(cr);
    persistSavedRoutesToStorage().then(() => {
        syncRouteUpdateBadgesAndAllBar(false);
        renderHistoryList();
        renderCloudRoutesList();
        alert(`✅ 成功${hadExisting ? '原地覆蓋更新' : '下載匯入'}【${newRoute.author}】分享的路線：${newRoute.name} (v${newRoute.routeVersion})`);
    });
}

importAllCloudBtn.onclick = () => {
    if (!cachedCloudRoutes || cachedCloudRoutes.length === 0) return;

    let addedCount = 0;
    let skippedCount = 0;

    // 由舊到新依序處理，已存在者原地覆蓋、全新路線維持最新在最上方
    [...cachedCloudRoutes].reverse().forEach(cr => {
        if (isRouteAlreadyInLocal(cr)) {
            skippedCount++;
        } else {
            upsertLocalRouteFromCloud(cr);
            addedCount++;
        }
    });

    if (addedCount === 0) {
        alert(`ℹ️ 雲端共 ${skippedCount} 條路線皆已存在於本機且為最新版，無須重複匯入！`);
        renderCloudRoutesList();
        return;
    }

    persistSavedRoutesToStorage().then(() => {
        syncRouteUpdateBadgesAndAllBar(false);
        renderHistoryList();
        renderCloudRoutesList();
        alert(`✅ 一鍵匯入/更新完成！\n成功新增或原地覆蓋 ${addedCount} 條路線${skippedCount > 0 ? `（已自動略過 ${skippedCount} 條已是最新版的路線）` : ''}。`);
    });
};

document.getElementById('openCloudModalBtn').onclick = () => {
    cloudRoutesModal.classList.remove('hidden');
    fetchCloudRoutes();
};
document.getElementById('refreshCloudBtn').onclick = () => fetchCloudRoutes();
document.getElementById('closeCloudModalBtn').onclick = () => cloudRoutesModal.classList.add('hidden');

document.getElementById('settingsBtn').onclick = () => document.getElementById('settingsModal').classList.remove('hidden');
document.getElementById('closeSettings').onclick = () => document.getElementById('settingsModal').classList.add('hidden');
window.setMode = function(sec, meters, text) {
    gpsFreqMs = sec * 1000; minMoveMeters = meters;
    document.getElementById('currentModeText').innerText = text;
    document.getElementById('settingsModal').classList.add('hidden');
};

// ==========================================
// 🚛 9. 全自動車隊支援定位雷達（全模式通用）＋ 👥 三層權限與人員門禁管理系統
// ==========================================
const LIVE_FLEET_BASE_URL = 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app/live_fleet';
const LIVE_FLEET_ALL_URL = `${LIVE_FLEET_BASE_URL}.json`;
const FLEET_USERS_BASE_URL = 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app/fleet_users';
const FLEET_USERS_ALL_URL = `${FLEET_USERS_BASE_URL}.json`;
const SYSTEM_CONFIG_URL = `${FIREBASE_BASE_URL}/system_config.json`;
const DEFAULT_RADAR_INTERVAL_SEC = 5;

let currentRadarIntervalSec = DEFAULT_RADAR_INTERVAL_SEC;
let selectedAdminInterval = DEFAULT_RADAR_INTERVAL_SEC;
let lastKnownCloudInterval = DEFAULT_RADAR_INTERVAL_SEC;

// 獨立的友車圖層群組（不受 clearDomMarkers 影響，進入導航或切換路線時依然保留）
const fleetLayerGroup = {};

let fleetDeviceId = localStorage.getItem('deviceId') || localStorage.getItem('fleet_device_id');
if (!fleetDeviceId) {
    fleetDeviceId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem('deviceId', fleetDeviceId);
    localStorage.setItem('fleet_device_id', fleetDeviceId);
} else {
    localStorage.setItem('deviceId', fleetDeviceId);
    localStorage.setItem('fleet_device_id', fleetDeviceId);
}

// 🔐 三層權限分級狀態：'normal'（一般模式：唯讀瀏覽／搜尋／導航）| 'manager'（管理者模式：可新增／修改／刪除社區大樓）| 'developer'（開發者模式：最高權限）
let localUserPermissionRole = localStorage.getItem('yingge_user_permission_role') || 'normal';
if (!['normal', 'manager', 'developer'].includes(localUserPermissionRole)) {
    localUserPermissionRole = 'normal';
}
let myCloudUserProfile = null;
let allCloudFleetUsersMap = {};

function isCurrentDeviceBlocked() {
    if (localUserPermissionRole === 'developer') return false;
    return Boolean(myCloudUserProfile && myCloudUserProfile.isBlocked === true);
}

function isCurrentDevicePendingApproval() {
    if (localUserPermissionRole === 'developer') return false;
    if (!systemNavConfig.requireUserApproval) return false;
    if (!myCloudUserProfile) return true;
    return myCloudUserProfile.isApproved !== true;
}

function isDeviceRestrictedByGatekeeper() {
    return isCurrentDeviceBlocked() || isCurrentDevicePendingApproval();
}

function canCurrentUserManageBuildings() {
    if (localUserPermissionRole === 'developer' || localUserPermissionRole === 'manager') {
        return true;
    }
    if (myCloudUserProfile && myCloudUserProfile.canManageBuildings === true && !myCloudUserProfile.isBlocked) {
        return true;
    }
    return false;
}

let fleetUserName = (localStorage.getItem('fleet_user_name') || '').trim();
let currentFleetLat = null;
let currentFleetLng = null;
let lastUploadedFleetLat = null;
let lastUploadedFleetLng = null;
let lastFleetUploadTime = 0;
let fleetRadarStarted = false;
let fleetPollTimer = null;
let fleetHeartbeatTimer = null;
let fleetRadarWatchId = null;
let isUploadingFleetLocation = false;
let isFetchingFleetRadar = false;

const fleetUserNameModal = document.getElementById('fleetUserNameModal');
const fleetUserNameInput = document.getElementById('fleetUserNameInput');
const btnSaveFleetUserName = document.getElementById('btnSaveFleetUserName');
const btnCancelFleetUserName = document.getElementById('btnCancelFleetUserName');
const fleetUserBadgeBtn = document.getElementById('fleetUserBadgeBtn');
const fleetUserBadgeText = document.getElementById('fleetUserBadgeText');
const settingsFleetNameText = document.getElementById('settingsFleetNameText');
const settingsEditFleetNameBtn = document.getElementById('settingsEditFleetNameBtn');
const welcomeProfileModal = document.getElementById('welcomeProfileModal');
const welcomeProfileTitle = document.getElementById('welcomeProfileTitle');
const btnCloseWelcomeModal = document.getElementById('btnCloseWelcomeModal');

function showWelcomeProfileModal(name) {
    if (!welcomeProfileModal || !welcomeProfileTitle) return;
    welcomeProfileTitle.textContent = `🎉 歡迎 ${name} 使用智能循跡導航系統！`;
    welcomeProfileModal.classList.remove('hidden');
}

if (btnCloseWelcomeModal) {
    btnCloseWelcomeModal.onclick = () => {
        if (welcomeProfileModal) welcomeProfileModal.classList.add('hidden');
    };
}
if (welcomeProfileModal) {
    welcomeProfileModal.onclick = (e) => {
        if (e.target === welcomeProfileModal) welcomeProfileModal.classList.add('hidden');
    };
}

function syncFleetUserNameUI() {
    const display = fleetUserName || '設定名稱';
    if (fleetUserBadgeText) fleetUserBadgeText.innerText = display;
    if (settingsFleetNameText) settingsFleetNameText.innerText = fleetUserName || '未設定';
    if (fleetUserName) {
        localStorage.setItem('yinggeRouteLastAuthor', fleetUserName);
    }
}

function openFleetUserNameModal(isInitial) {
    fleetUserNameInput.value = fleetUserName || localStorage.getItem('yinggeRouteLastAuthor') || '';
    if (isInitial) {
        btnCancelFleetUserName.classList.add('hidden');
    } else {
        btnCancelFleetUserName.classList.remove('hidden');
    }
    fleetUserNameModal.classList.remove('hidden');
    setTimeout(() => fleetUserNameInput.focus(), 100);
}

// 同步本機使用者資料至 Firebase fleet_users/{deviceId}（嚴格使用 PATCH 只更新 displayName 與 lastActiveAt，絕不覆蓋開發者單向標註的 originalName 或權限欄位）
async function syncMyFleetUserRecordToCloud(options = {}) {
    if (!fleetDeviceId || !navigator.onLine) return null;
    const cleanDisplayName = (options.displayName !== undefined ? String(options.displayName) : fleetUserName).trim();
    if (!cleanDisplayName) return null;

    const now = Date.now();
    try {
        // 先讀取雲端是否已有此裝置紀錄
        const getRes = await fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, { cache: 'no-store' }, 4500);
        const existing = getRes.ok ? await getRes.json() : null;

        let patchPayload;
        if (existing && typeof existing === 'object') {
            patchPayload = {
                displayName: cleanDisplayName,
                lastActiveAt: now
            };
            if (options.requestApproval === true && existing.isApproved !== true) {
                patchPayload.requestedAt = now;
            }
        } else {
            // 新裝置首次建立紀錄：若全站門禁開啟且非開發者，預設 isApproved: false（待核准）；否則預設 isApproved: true
            const defaultApproved = (localUserPermissionRole === 'developer') || !systemNavConfig.requireUserApproval;
            patchPayload = {
                displayName: cleanDisplayName,
                originalName: '',
                isApproved: defaultApproved,
                isBlocked: false,
                canManageBuildings: false,
                createdAt: now,
                lastActiveAt: now
            };
        }

        await fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchPayload)
        }, 4500);

        myCloudUserProfile = {
            ...(existing && typeof existing === 'object' ? existing : {}),
            ...patchPayload
        };
        if (typeof evaluateAndRenderAccessGateOverlay === 'function') {
            evaluateAndRenderAccessGateOverlay();
        }
        return myCloudUserProfile;
    } catch (e) {
        return myCloudUserProfile;
    }
}

function saveFleetUserNameFromModal() {
    const val = (fleetUserNameInput.value || '').trim();
    if (!val) {
        alert('請輸入您的名稱（例如：凱哥、阿翔）！');
        fleetUserNameInput.focus();
        return;
    }
    fleetUserName = val;
    localStorage.setItem('fleet_user_name', fleetUserName);
    localStorage.setItem('yinggeRouteLastAuthor', fleetUserName);
    syncFleetUserNameUI();
    fleetUserNameModal.classList.add('hidden');

    // 同步更新雲端 fleet_users 的 displayName（絕不影響開發者標註的 originalName）
    syncMyFleetUserRecordToCloud({ displayName: fleetUserName, requestApproval: true }).then(() => {
        if (isDeviceRestrictedByGatekeeper()) {
            if (typeof evaluateAndRenderAccessGateOverlay === 'function') {
                evaluateAndRenderAccessGateOverlay();
            }
            return;
        }
        showWelcomeProfileModal(fleetUserName);
        startFleetRadarSystem();
        if (currentFleetLat !== null && currentFleetLng !== null) {
            uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
        }
    });
}

btnSaveFleetUserName.onclick = saveFleetUserNameFromModal;
fleetUserNameInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        saveFleetUserNameFromModal();
    }
};
btnCancelFleetUserName.onclick = () => fleetUserNameModal.classList.add('hidden');

fleetUserBadgeBtn.onclick = () => openFleetUserNameModal(false);
if (settingsEditFleetNameBtn) {
    settingsEditFleetNameBtn.onclick = () => {
        document.getElementById('settingsModal').classList.add('hidden');
        openFleetUserNameModal(false);
    };
}

let pendingForcedFleetUpload = null;

async function uploadMyFleetLocation(lat, lng, forceUpload = false) {
    if (!fleetUserName || typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    if (!navigator.onLine) return;
    // 若此裝置已被封鎖或處於門禁待核准狀態，立即停止同步與車隊雷達廣播
    if (isDeviceRestrictedByGatekeeper()) return;
    if (isUploadingFleetLocation) {
        if (forceUpload) {
            pendingForcedFleetUpload = { lat, lng };
        }
        return;
    }

    const now = Date.now();
    const minUploadIntervalMs = (typeof currentRadarIntervalSec === 'number' && currentRadarIntervalSec > 0 ? currentRadarIntervalSec : 5) * 1000;
    if (!forceUpload && lastUploadedFleetLat !== null && lastUploadedFleetLng !== null) {
        if (now - lastFleetUploadTime < minUploadIntervalMs) return; // 依雲端設定秒數頻率上傳
        const distMeters = getDistanceKm(lastUploadedFleetLng, lastUploadedFleetLat, lng, lat) * 1000;
        // 若原地等待紅燈或定點清運超過 15 秒且手機處於前景接收 GPS，允許更新一次 updatedAt 保持 30 秒內鮮明在線狀態
        if (distMeters <= 5 && (now - lastFleetUploadTime < 15000)) return;
    }

    const prevLat = lastUploadedFleetLat;
    const prevLng = lastUploadedFleetLng;
    lastUploadedFleetLat = lat;
    lastUploadedFleetLng = lng;
    lastFleetUploadTime = now;
    isUploadingFleetLocation = true;

    const payload = {
        name: fleetUserName,
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        speedKmh: Math.round(Math.max(0, lastRecordedSpeedKmh || 0)),
        updatedAt: now
    };

    try {
        await fetchWithTimeout(`${LIVE_FLEET_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true
        }, 5000);
        // 順便每 25 秒更新一次 fleet_users 的 lastActiveAt 與 displayName（供開發者後台顯示 🟢 上線中 / ⚪ 離線）
        if (!myCloudUserProfile || (now - Number(myCloudUserProfile.lastActiveAt || 0) >= 25000)) {
            fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    displayName: fleetUserName,
                    lastActiveAt: now
                }),
                keepalive: true
            }, 4000).catch(() => {});
            if (myCloudUserProfile) myCloudUserProfile.lastActiveAt = now;
        }
    } catch (err) {
        // 巷弄斷網或超時靜默略過，還原座標基準以便下一週期自動恢復補傳
        lastUploadedFleetLat = prevLat;
        lastUploadedFleetLng = prevLng;
    } finally {
        isUploadingFleetLocation = false;
        if (pendingForcedFleetUpload) {
            const nextUpload = pendingForcedFleetUpload;
            pendingForcedFleetUpload = null;
            uploadMyFleetLocation(nextUpload.lat, nextUpload.lng, true);
        }
    }
}

window.onFleetPositionUpdate = function(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    currentFleetLat = lat;
    currentFleetLng = lng;
    if (fleetUserName && !isDeviceRestrictedByGatekeeper()) {
        uploadMyFleetLocation(lat, lng, false);
    }
};

// ==========================================
// 🟢 左上角「車隊雷達在線名單」即時清單（支援超過 3 人自動收折＋點擊快速 flyTo 追蹤隊友＋超過 30 秒休眠提示）
// ==========================================
let onlineFleetMembersList = [];
let isOnlineFleetListExpanded = false;
const FLEET_STALE_SLEEP_THRESHOLD_MS = 30 * 1000; // 超過 30 秒未更新視為手機休眠／過期座標
const FLEET_MAX_RETENTION_MS = 15 * 60 * 1000;    // 保留 15 分鐘內的隊員位置以顯示（X分前・休眠）防誤判

function getFleetStaleStatus(updatedAt, now = Date.now()) {
    const elapsedMs = Math.max(0, now - Number(updatedAt || 0));
    const isOver30s = elapsedMs > FLEET_STALE_SLEEP_THRESHOLD_MS;
    const rawStaleMinutes = isOver30s ? Math.max(1, Math.floor(elapsedMs / 60000)) : 0;

    // 開發者模式設定：休眠提示開關（預設開啟）與超過設定分鐘數自動屏蔽（預設 3 分鐘，設為 0 代表不屏蔽）
    const showSleepEnabled = systemNavConfig.showFleetSleepStatus !== false;
    const rawMaxMin = Number(systemNavConfig.fleetSleepMaxMinutes);
    const maxMinutes = isNaN(rawMaxMin) ? DEFAULT_SYSTEM_CONFIG.fleetSleepMaxMinutes : Math.max(0, rawMaxMin);
    const isExceededMaxMinutes = maxMinutes > 0 && elapsedMs > (maxMinutes * 60 * 1000);

    // 僅當「休眠提示開關為開啟」且「超過 30 秒」且「未超過設定上限分鐘數」時，才顯示（X分前・休眠）與半透明休眠樣式
    const isStale = Boolean(showSleepEnabled && isOver30s && !isExceededMaxMinutes);
    const staleMinutes = isStale ? rawStaleMinutes : 0;
    const staleText = isStale ? `（${staleMinutes}分前・休眠）` : '';

    return { isStale, isOver30s, isExceededMaxMinutes, staleMinutes, staleText, elapsedMs };
}

function updateFleetTruckMarkerAppearance(el, memberName, updatedAt, now = Date.now()) {
    if (!el) return;
    const cleanName = (memberName || '隊員').trim();
    const { isStale, staleText } = getFleetStaleStatus(updatedAt, now);
    const nameSpan = el.querySelector('.fleet-member-name');
    if (nameSpan) {
        nameSpan.textContent = isStale ? `${cleanName}${staleText}` : cleanName;
    }
    if (isStale) {
        el.classList.add('is-stale-sleeping');
    } else {
        el.classList.remove('is-stale-sleeping');
    }
}

function renderOnlineFleetListUI() {
    const container = document.getElementById('onlineFleetListContainer');
    if (!container) return;

    // 若管理員關閉「顯示左上角車隊在線名單」或目前無其他同事在線，自動隱藏不佔空間
    if (!systemNavConfig.showOnlineFleetList || !Array.isArray(onlineFleetMembersList) || onlineFleetMembersList.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = '';

    const now = Date.now();
    const totalOnline = onlineFleetMembersList.length;
    const maxVisible = 3;
    const shouldCollapse = totalOnline > maxVisible && !isOnlineFleetListExpanded;
    const visibleMembers = shouldCollapse
        ? onlineFleetMembersList.slice(0, maxVisible)
        : onlineFleetMembersList;

    visibleMembers.forEach(member => {
        const { isStale, staleText } = getFleetStaleStatus(member.updatedAt, now);
        const pillBtn = document.createElement('button');
        pillBtn.type = 'button';
        pillBtn.className = isStale
            ? 'bg-slate-100/90 hover:bg-slate-200/90 backdrop-blur px-3 py-1.5 rounded-xl shadow-sm text-xs font-extrabold text-slate-500 border border-slate-300 flex items-center gap-1.5 active:scale-95 transition-all whitespace-nowrap opacity-75'
            : 'bg-white/95 hover:bg-emerald-50 backdrop-blur px-3 py-1.5 rounded-xl shadow-md text-xs font-extrabold text-gray-800 border border-emerald-200 flex items-center gap-1.5 active:scale-95 transition-all whitespace-nowrap';
        pillBtn.title = isStale
            ? `${member.name} 目前可能鎖屏休眠，點擊查看最後回報位置`
            : `點擊追蹤 ${member.name} 的即時位置`;

        const dotSpan = document.createElement('span');
        dotSpan.textContent = isStale ? '⚪' : '🟢';
        dotSpan.className = 'text-[10px] leading-none';

        const textSpan = document.createElement('span');
        textSpan.textContent = isStale
            ? `${member.name}${staleText}`
            : `${member.name} · ${member.speedKmh} km/h`;

        pillBtn.appendChild(dotSpan);
        pillBtn.appendChild(textSpan);

        pillBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 暫時解除自己的車頭鎖定（按右側「置中」按鈕即可切回自己）
            setCameraFollow(false);
            map.flyTo({
                center: [member.lng, member.lat],
                zoom: Math.max(map.getZoom(), 16.5),
                duration: 900
            });
        });

        container.appendChild(pillBtn);
    });

    if (totalOnline > maxVisible) {
        const hiddenCount = totalOnline - maxVisible;
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'bg-white/90 hover:bg-amber-50 backdrop-blur px-3 py-1 rounded-xl shadow-md text-[11px] font-black text-emerald-700 border border-emerald-200 flex items-center gap-1 active:scale-95 transition-all whitespace-nowrap';
        toggleBtn.textContent = isOnlineFleetListExpanded
            ? `收合在線名單 ▴`
            : `+ 還有 ${hiddenCount} 位在線 ▾`;

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isOnlineFleetListExpanded = !isOnlineFleetListExpanded;
            renderOnlineFleetListUI();
        });

        container.appendChild(toggleBtn);
    }
}

function createFleetTruckMarkerElement(memberName, updatedAt = Date.now()) {
    const wrapper = document.createElement('div');
    wrapper.className = 'fleet-truck-marker flex flex-col items-center pointer-events-none select-none';
    wrapper.style.filter = 'drop-shadow(0 3px 6px rgba(0,0,0,0.38))';
    wrapper.innerHTML = `
        <div class="fleet-truck-pill bg-emerald-600 text-white px-2.5 py-1 rounded-full border-2 border-white font-black text-xs flex items-center gap-1.5 whitespace-nowrap shadow-md">
            <i class="fleet-truck-icon fa-solid fa-truck text-amber-300 text-xs"></i>
            <span class="fleet-member-name"></span>
        </div>
        <div class="fleet-truck-arrow w-2.5 h-2.5 bg-emerald-600 border-r-2 border-b-2 border-white transform rotate-45 -mt-1.5"></div>
    `;
    updateFleetTruckMarkerAppearance(wrapper, memberName, updatedAt);
    return wrapper;
}

async function fetchAndRenderFleetRadar() {
    if (!fleetUserName || !navigator.onLine || isFetchingFleetRadar) return;
    // 純黑省電模式下暫停地圖友車標記重繪，於喚醒畫面時立即同步更新
    if (isPowerSaveMapPaused()) return;
    isFetchingFleetRadar = true;
    try {
        const res = await fetchWithTimeout(LIVE_FLEET_ALL_URL, { cache: 'no-store' }, 5000);
        if (!res.ok) return;
        const data = await res.json();
        const now = Date.now();
        const activeIds = new Set();
        const nextOnlineMembers = [];

        if (data && typeof data === 'object') {
            Object.entries(data).forEach(([devId, info]) => {
                if (!info || devId === fleetDeviceId) return; // 排除自己
                const lat = Number(info.lat);
                const lng = Number(info.lng);
                const updatedAt = typeof info.updatedAt === 'number'
                    ? info.updatedAt
                    : new Date(info.updatedAt || 0).getTime();

                if (isNaN(lat) || isNaN(lng) || !updatedAt) return;
                // 保留 15 分鐘內有紀錄的友車：30 秒內顯示鮮明即時色彩，超過 30 秒自動轉為半透明灰階並標註（X分前・休眠）
                if (now - updatedAt > FLEET_MAX_RETENTION_MS) return;

                activeIds.add(devId);
                const memberName = (info.name || '隊員').trim();
                const isStaleMember = (now - updatedAt) > FLEET_STALE_SLEEP_THRESHOLD_MS;

                // 計算同事即時時速 (km/h)：優先採用雲端回報之 speedKmh，若超過 30 秒休眠則歸零
                let memberSpeedKmh = 0;
                const existingEntry = fleetLayerGroup[devId];
                if (isStaleMember) {
                    memberSpeedKmh = 0;
                } else if (typeof info.speedKmh === 'number' && !isNaN(info.speedKmh) && info.speedKmh >= 0) {
                    memberSpeedKmh = Math.round(info.speedKmh);
                } else if (existingEntry && existingEntry.lastLat !== undefined && existingEntry.lastUpdatedAt && updatedAt > existingEntry.lastUpdatedAt) {
                    const distKm = getDistanceKm(existingEntry.lastLng, existingEntry.lastLat, lng, lat);
                    const dtSec = Math.max(1, (updatedAt - existingEntry.lastUpdatedAt) / 1000);
                    const implied = (distKm / dtSec) * 3600;
                    const maxSpd = Number(systemNavConfig.maxSpeedKmh) || 160;
                    memberSpeedKmh = (distKm * 1000 < 5 || implied < 2) ? 0 : Math.round(Math.min(implied, maxSpd));
                } else if (existingEntry && typeof existingEntry.speedKmh === 'number' && (now - updatedAt <= 20000)) {
                    memberSpeedKmh = existingEntry.speedKmh;
                }

                if (existingEntry) {
                    existingEntry.marker.setLngLat([lng, lat]);
                    existingEntry.name = memberName;
                    existingEntry.lastLat = lat;
                    existingEntry.lastLng = lng;
                    existingEntry.lastUpdatedAt = updatedAt;
                    existingEntry.speedKmh = memberSpeedKmh;
                    updateFleetTruckMarkerAppearance(existingEntry.el, memberName, updatedAt, now);
                } else {
                    const el = createFleetTruckMarkerElement(memberName, updatedAt);
                    const marker = new maplibregl.Marker({
                        element: el,
                        anchor: 'bottom',
                        rotationAlignment: 'viewport',
                        pitchAlignment: 'viewport'
                    })
                        .setLngLat([lng, lat])
                        .addTo(map);
                    fleetLayerGroup[devId] = {
                        marker,
                        el,
                        name: memberName,
                        lastLat: lat,
                        lastLng: lng,
                        lastUpdatedAt: updatedAt,
                        speedKmh: memberSpeedKmh
                    };
                }

                nextOnlineMembers.push({
                    devId,
                    name: memberName,
                    lat,
                    lng,
                    speedKmh: memberSpeedKmh,
                    updatedAt,
                    isStale: isStaleMember
                });
            });
        }

        // 移除超過 15 分鐘未更新或已離線的友車標記
        Object.keys(fleetLayerGroup).forEach(devId => {
            if (!activeIds.has(devId)) {
                fleetLayerGroup[devId].marker.remove();
                delete fleetLayerGroup[devId];
            }
        });

        // 排序：30 秒內活躍隊員優先排前，休眠隊員排後，同狀態依名稱排序
        nextOnlineMembers.sort((a, b) => {
            if (a.isStale !== b.isStale) return a.isStale ? 1 : -1;
            return a.name.localeCompare(b.name, 'zh-Hant');
        });
        onlineFleetMembersList = nextOnlineMembers;
        renderOnlineFleetListUI();
    } catch (err) {
        // 巷弄斷網或 5 秒逾時靜默略過，不干擾導航，同時以本地時間即時刷新既有標記的休眠狀態
        const now = Date.now();
        Object.values(fleetLayerGroup).forEach(entry => {
            if (entry && entry.el && entry.lastUpdatedAt) {
                updateFleetTruckMarkerAppearance(entry.el, entry.name, entry.lastUpdatedAt, now);
            }
        });
        renderOnlineFleetListUI();
    } finally {
        isFetchingFleetRadar = false;
    }
}

function removeMyFleetLocationOnUnload() {
    if (!fleetDeviceId) return;
    const targetUrl = `${LIVE_FLEET_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`;
    try {
        fetchWithTimeout(targetUrl, {
            method: 'DELETE',
            keepalive: true
        }, 5000).catch(() => {});
    } catch (e) {}
}

// 僅於實際關閉分頁 (beforeunload) 時嘗試清除，移除 pagehide / visibilitychange 刪除動作，
// 避免司機切換至 LINE 或講電話時在地圖上瞬間消失
window.addEventListener('beforeunload', removeMyFleetLocationOnUnload);

// ==========================================
// 🔇 輕量級「背景無聲保活機制」(AudioContext + 靜音音軌循環)
// 降低手機切換至背景 (LINE / 通話) 或鎖屏時凍結 GPS 與車隊雷達上傳的機率
// ==========================================
let bgSilentAudioCtx = null;
let bgSilentAudioEl = null;
let bgSilentKeepAliveStarted = false;

function createSilentWavDataUri() {
    // 產生 1 秒、8000Hz、8-bit Mono 的極輕量無聲 WAV
    const sampleRate = 8000;
    const numSamples = sampleRate;
    const buffer = new ArrayBuffer(44 + numSamples);
    const view = new DataView(buffer);
    const writeStr = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true); // 8-bit
    writeStr(36, 'data');
    view.setUint32(40, numSamples, true);
    for (let i = 0; i < numSamples; i++) {
        view.setUint8(44 + i, 128); // 8-bit PCM 128 為完全靜音
    }
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return 'data:audio/wav;base64,' + btoa(binary);
}

function ensureBackgroundSilentKeepAlive() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            if (!bgSilentAudioCtx) {
                bgSilentAudioCtx = new AudioCtx();
                const osc = bgSilentAudioCtx.createOscillator();
                const gain = bgSilentAudioCtx.createGain();
                // 極微小增益 (0.00001) 完全無聲，同時防止瀏覽器判定為空音軌而休眠
                gain.gain.value = 0.00001;
                osc.connect(gain);
                gain.connect(bgSilentAudioCtx.destination);
                osc.start();
            }
            if (bgSilentAudioCtx.state === 'suspended') {
                bgSilentAudioCtx.resume().catch(() => {});
            }
        }
    } catch (e) {}

    try {
        if (!bgSilentAudioEl) {
            bgSilentAudioEl = new Audio(createSilentWavDataUri());
            bgSilentAudioEl.loop = true;
            bgSilentAudioEl.volume = 0.01;
            bgSilentAudioEl.setAttribute('playsinline', '');
            bgSilentAudioEl.setAttribute('webkit-playsinline', '');
        }
        if (bgSilentAudioEl.paused) {
            bgSilentAudioEl.play().catch(() => {});
        }
    } catch (e) {}

    bgSilentKeepAliveStarted = true;
}

['pointerdown', 'touchstart', 'click', 'keydown'].forEach(evtName => {
    window.addEventListener(evtName, function onFirstUserInteract() {
        ensureBackgroundSilentKeepAlive();
        if (bgSilentAudioCtx && bgSilentAudioCtx.state === 'running') {
            window.removeEventListener(evtName, onFirstUserInteract);
        }
    }, { passive: true });
});

// ==========================================
// 📍 共享地圖地標核心狀態變數（提前宣告以避免 startFleetRadarSystem 啟動時觸發 TDZ ReferenceError）
// ==========================================
const MAP_PINS_BASE_URL = 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app/map_pins';
const MAP_PINS_ALL_URL = `${MAP_PINS_BASE_URL}.json`;

// 獨立的共享地標圖層群組（不受 clearDomMarkers 影響，於一般、錄製、預覽、重播與導航模式皆保留）
const pinsLayerGroup = {};
window.pinsLayerGroup = pinsLayerGroup;

let mapPinsPollTimer = null;
let isFetchingMapPins = false;
let pendingMapPinLat = null;
let pendingMapPinLng = null;
let currentMapPinPhotoBase64 = '';
let activeViewingMapPin = null;
let activeDistanceGuidePin = null;
let pinDistanceGuideTimer = null;
let pinDistanceLineMarker = null;

function startFleetRadarGpsWatch() {
    if (!('geolocation' in navigator) || !fleetUserName) return;
    if (fleetRadarWatchId !== null) {
        navigator.geolocation.clearWatch(fleetRadarWatchId);
        fleetRadarWatchId = null;
    }
    fleetRadarWatchId = navigator.geolocation.watchPosition(pos => {
        markGpsUpdateReceived();
        const filtered = processFilteredGpsPosition(pos);
        if (!filtered) return;
        window.onFleetPositionUpdate(filtered.lat, filtered.lng);
    }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
}

// ==========================================
// 🍎 iOS 螢幕解鎖／切回前景「強制重啟 GPS 定位」＋「12 秒前景定位看門狗（Watchdog）」
// ==========================================
function forceRestartGpsAndPushLatestLocation(triggerReason = 'wakeup') {
    if (!('geolocation' in navigator)) return;
    const now = Date.now();
    // 防止 visibilitychange / pageshow / focus 於同一瞬間重複觸發取消剛建立的請求
    if (triggerReason !== 'watchdog' && (now - lastGpsForceRestartAt < 600)) {
        return;
    }
    lastGpsForceRestartAt = now;

    // 1. 立即呼叫 clearWatch() 清除所有可能已在 iOS 背景休眠假死的舊監聽器
    if (idleWatchId !== null) {
        navigator.geolocation.clearWatch(idleWatchId);
        idleWatchId = null;
    }
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    if (followWatchId !== null) {
        navigator.geolocation.clearWatch(followWatchId);
        followWatchId = null;
    }
    if (fleetRadarWatchId !== null) {
        navigator.geolocation.clearWatch(fleetRadarWatchId);
        fleetRadarWatchId = null;
    }

    // 2. 立刻重新啟動新的 watchPosition（強制設定 enableHighAccuracy: true, maximumAge: 0, timeout: 15000，不使用舊快取座標）
    if (isRecording && typeof activeRecordingGpsHandler === 'function') {
        watchId = navigator.geolocation.watchPosition(
            activeRecordingGpsHandler,
            () => {},
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
    } else if (typeof activeFollowGpsHandler === 'function') {
        followWatchId = navigator.geolocation.watchPosition(
            activeFollowGpsHandler,
            () => {},
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
    } else {
        startIdleGPS();
    }

    if (fleetRadarStarted && fleetUserName) {
        startFleetRadarGpsWatch();
    }

    // 3. 秒抓最新位置推上 Firebase：單次呼叫 getCurrentPosition 取得最新硬體座標，立即更新地圖車標並寫入 Firebase 車隊即時位置節點
    navigator.geolocation.getCurrentPosition(pos => {
        markGpsUpdateReceived();
        if (!pos || !pos.coords) return;
        const filtered = processFilteredGpsPosition(pos, { forceBaselineReset: true });
        const rawLat = Number(pos.coords.latitude);
        const rawLng = Number(pos.coords.longitude);
        if (isNaN(rawLat) || isNaN(rawLng)) return;

        const latestLat = filtered ? filtered.lat : rawLat;
        const latestLng = filtered ? filtered.lng : rawLng;
        const latestHeading = filtered ? filtered.heading : lastRealGpsHeading;
        const latestAcc = Math.round(
            filtered
                ? filtered.accuracy
                : (typeof pos.coords.accuracy === 'number' && !isNaN(pos.coords.accuracy) ? pos.coords.accuracy : 10)
        );

        if (!isReplaying) {
            lastKnownLngLat = [latestLng, latestLat];
            currentHeading = latestHeading;
            if (!isPowerSaveMapPaused()) {
                const accEl = document.getElementById('accuracyText');
                if (accEl) accEl.innerText = `± ${latestAcc} m`;
                const recAccEl = document.getElementById('recAccuracyText');
                if (recAccEl) recAccEl.innerText = `± ${latestAcc} m`;

                if (vehicleMarker) {
                    smoothMoveVehicleMarker([latestLng, latestLat], latestHeading, 450);
                }
                if (isFollowingCamera && map) {
                    const targetZoom = getDynamicZoomBySpeed(filtered ? filtered.speedKmh : 0);
                    map.easeTo({
                        center: [latestLng, latestLat],
                        zoom: targetZoom,
                        bearing: isHeadingUpMode ? latestHeading : map.getBearing(),
                        offset: [0, 100],
                        duration: 500
                    });
                }
            }
        }

        // 若正在錄製或導航中，同步將最新座標餵入當前狀態處理器
        if (isRecording && typeof activeRecordingGpsHandler === 'function') {
            activeRecordingGpsHandler(pos);
        } else if (typeof activeFollowGpsHandler === 'function') {
            activeFollowGpsHandler(pos);
        }

        // 立刻更新並強制寫入 Firebase 車隊即時位置節點
        currentFleetLat = latestLat;
        currentFleetLng = latestLng;
        if (fleetUserName) {
            uploadMyFleetLocation(latestLat, latestLng, true);
        }
    }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
}

function startForegroundGpsWatchdog() {
    if (gpsWatchdogTimer !== null) {
        clearInterval(gpsWatchdogTimer);
        gpsWatchdogTimer = null;
    }
    // 每 10 秒檢查一次前景 GPS 是否超過 12 秒未收到新座標
    gpsWatchdogTimer = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        if (!('geolocation' in navigator)) return;
        const isPositioningActive = Boolean(
            idleWatchId !== null ||
            isRecording ||
            watchId !== null ||
            typeof activeFollowGpsHandler === 'function' ||
            followWatchId !== null ||
            fleetRadarStarted ||
            fleetRadarWatchId !== null
        );
        if (!isPositioningActive) return;

        const now = Date.now();
        if (lastGpsUpdateTime === 0 || (now - lastGpsUpdateTime) > 12000) {
            forceRestartGpsAndPushLatestLocation('watchdog');
        }
    }, 10000);
}
startForegroundGpsWatchdog();

function startFleetRadarSystem() {
    if (!fleetUserName) return;

    // 單一實例保護：啟動前先清除舊的監聽 ID 與計時器，保證全域永遠只有單一實例在運作
    if (fleetRadarWatchId !== null) {
        navigator.geolocation.clearWatch(fleetRadarWatchId);
        fleetRadarWatchId = null;
    }
    if (fleetPollTimer !== null) {
        clearInterval(fleetPollTimer);
        fleetPollTimer = null;
    }
    if (fleetHeartbeatTimer !== null) {
        clearInterval(fleetHeartbeatTimer);
        fleetHeartbeatTimer = null;
    }

    fleetRadarStarted = true;

    // 啟動全模式定位監聽（maximumAge: 0, timeout: 15000）
    startFleetRadarGpsWatch();

    // 啟動瞬間立即單次抓取最新硬體座標並推上 Firebase
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(pos => {
            markGpsUpdateReceived();
            const filtered = processFilteredGpsPosition(pos, { forceBaselineReset: true });
            const lat = filtered ? filtered.lat : Number(pos?.coords?.latitude);
            const lng = filtered ? filtered.lng : Number(pos?.coords?.longitude);
            if (typeof lat === 'number' && !isNaN(lat) && typeof lng === 'number' && !isNaN(lng)) {
                currentFleetLat = lat;
                currentFleetLng = lng;
                uploadMyFleetLocation(lat, lng, true);
            }
        }, () => {
            if (lastKnownLngLat && Array.isArray(lastKnownLngLat) && currentFleetLat !== null) {
                uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
            }
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
    }

    // 靜默讀取 /live_fleet.json 更新友車圖層（依雲端動態秒數，預設 5 秒）
    fetchAndRenderFleetRadar();
    const pollIntervalMs = (typeof currentRadarIntervalSec === 'number' && currentRadarIntervalSec > 0 ? currentRadarIntervalSec : 5) * 1000;
    fleetPollTimer = setInterval(fetchAndRenderFleetRadar, pollIntervalMs);
    if (typeof fetchAndRenderSharedMapPins === 'function') {
        fetchAndRenderSharedMapPins();
    }

    // 前景活躍定點心跳機制：僅當手機處於前景顯示且近期有收到有效 GPS 時，每 15 秒補送一次 updatedAt 保持在線（若鎖屏休眠則停止補送，讓隊友端於 30 秒後正確顯示休眠狀態）
    fleetHeartbeatTimer = setInterval(() => {
        if (!fleetUserName || currentFleetLat === null || currentFleetLng === null) return;
        if (document.visibilityState !== 'visible') return;
        const now = Date.now();
        if (lastGpsUpdateTime > 0 && (now - lastGpsUpdateTime) <= 20000 && (now - lastFleetUploadTime) >= 15000) {
            uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
        }
    }, 5000);
}

// 初始化檢查使用者名稱與啟動車隊雷達
syncFleetUserNameUI();
if (fleetUserName) {
    startFleetRadarSystem();
} else {
    openFleetUserNameModal(true);
}

async function handlePageForegroundWakeup(sourceEvent = 'visibilitychange') {
    if (sourceEvent === 'visibilitychange' && document.visibilityState !== 'visible') return;
    if (bgSilentKeepAliveStarted) {
        ensureBackgroundSilentKeepAlive();
    }
    ensurePureBlackSystemBars();
    if (isBlackScreenActive || isRecording || followWatchId !== null || typeof activeFollowGpsHandler === 'function') {
        await requestScreenWakeLock();
    }
    // 強制清除舊 watchPosition、重啟新 watchPosition 並立刻以 getCurrentPosition 秒抓最新位置推上 Firebase
    forceRestartGpsAndPushLatestLocation(sourceEvent);
    fetchAndRenderFleetRadar();
    if (typeof fetchAndRenderSharedMapPins === 'function') {
        fetchAndRenderSharedMapPins();
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        handlePageForegroundWakeup('visibilitychange');
    }
});

window.addEventListener('focus', () => {
    if (document.visibilityState === 'visible') {
        handlePageForegroundWakeup('focus');
    }
});

window.addEventListener('pageshow', () => {
    handlePageForegroundWakeup('pageshow');
});

// ==========================================
// 📍 10. 全車隊共享地圖地標（藍色水滴髒亂點 ＋ 橘色水滴社區大樓）
// ==========================================
const longPressPinTypeModal = document.getElementById('longPressPinTypeModal');
const longPressPinTypeCoordsText = document.getElementById('longPressPinTypeCoordsText');
const btnChooseDirtySpotPin = document.getElementById('btnChooseDirtySpotPin');
const btnChooseBuildingPin = document.getElementById('btnChooseBuildingPin');
const btnCancelLongPressPinType = document.getElementById('btnCancelLongPressPinType');
const btnCloseLongPressTypeTop = document.getElementById('btnCloseLongPressTypeTop');

const createBuildingPinModal = document.getElementById('createBuildingPinModal');
const buildingPinModalTitle = document.getElementById('buildingPinModalTitle');
const buildingPinCoordsText = document.getElementById('buildingPinCoordsText');
const buildingPinNameInput = document.getElementById('buildingPinNameInput');
const btnSaveBuildingPin = document.getElementById('btnSaveBuildingPin');
const btnSaveBuildingPinText = document.getElementById('btnSaveBuildingPinText');
const btnCancelBuildingPin = document.getElementById('btnCancelBuildingPin');
const btnCloseBuildingPinTop = document.getElementById('btnCloseBuildingPinTop');
let editingBuildingPinTarget = null;

const createMapPinModal = document.getElementById('createMapPinModal');
const createMapPinCoordsText = document.getElementById('createMapPinCoordsText');
const mapPinTitleInput = document.getElementById('mapPinTitleInput');
const mapPinCameraInput = document.getElementById('mapPinCameraInput');
const mapPinGalleryInput = document.getElementById('mapPinGalleryInput');
const mapPinPhotoStatus = document.getElementById('mapPinPhotoStatus');
const mapPinPhotoPreviewWrap = document.getElementById('mapPinPhotoPreviewWrap');
const mapPinPhotoPreviewImg = document.getElementById('mapPinPhotoPreviewImg');
const btnRemoveMapPinPhoto = document.getElementById('btnRemoveMapPinPhoto');
const btnSaveMapPin = document.getElementById('btnSaveMapPin');
const btnCancelCreateMapPin = document.getElementById('btnCancelCreateMapPin');
const btnCloseCreateMapPinTop = document.getElementById('btnCloseCreateMapPinTop');

const viewMapPinModal = document.getElementById('viewMapPinModal');
const viewMapPinModalCard = document.getElementById('viewMapPinModalCard');
const viewMapPinCategoryBadge = document.getElementById('viewMapPinCategoryBadge');
const viewMapPinTitleText = document.getElementById('viewMapPinTitleText');
const viewMapPinAuthorText = document.getElementById('viewMapPinAuthorText');
const viewMapPinTimeText = document.getElementById('viewMapPinTimeText');
const viewMapPinPhotoWrap = document.getElementById('viewMapPinPhotoWrap');
const viewMapPinPhotoImg = document.getElementById('viewMapPinPhotoImg');
const btnGoogleNavMapPin = document.getElementById('btnGoogleNavMapPin');
const btnDistanceGuideMapPin = document.getElementById('btnDistanceGuideMapPin');
const viewMapPinBuildingNoteWrap = document.getElementById('viewMapPinBuildingNoteWrap');
const viewMapPinBuildingNoteInput = document.getElementById('viewMapPinBuildingNoteInput');
const btnSaveMapPinBuildingNote = document.getElementById('btnSaveMapPinBuildingNote');
const btnSaveMapPinBuildingNoteText = document.getElementById('btnSaveMapPinBuildingNoteText');
const viewMapPinNoteSavedStatus = document.getElementById('viewMapPinNoteSavedStatus');
const btnEditMapPinTitle = document.getElementById('btnEditMapPinTitle');
const btnDeleteMapPin = document.getElementById('btnDeleteMapPin');
const btnCloseViewMapPin = document.getElementById('btnCloseViewMapPin');
const btnCloseViewMapPinTop = document.getElementById('btnCloseViewMapPinTop');

const pinDistanceGuideBanner = document.getElementById('pinDistanceGuideBanner');
const pinDistanceGuideText = document.getElementById('pinDistanceGuideText');
const btnCancelPinDistanceGuideBanner = document.getElementById('btnCancelPinDistanceGuideBanner');

function ensurePinDistanceGuideLayer() {
    if (!map || !map.isStyleLoaded()) return false;
    if (!map.getSource('pin-distance-guide')) {
        map.addSource('pin-distance-guide', {
            type: 'geojson',
            data: emptyGeoJSON()
        });
    }
    if (!map.getLayer('pin-distance-guide-line')) {
        map.addLayer({
            id: 'pin-distance-guide-line',
            type: 'line',
            source: 'pin-distance-guide',
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#2563eb',
                'line-width': 4.5,
                'line-dasharray': [2, 2],
                'line-opacity': 0.92
            }
        });
    }
    return true;
}

function formatDistanceToPinText(distMeters) {
    const roundedM = Math.round(distMeters);
    if (roundedM >= 1000) {
        return `距離目標 ${(distMeters / 1000).toFixed(2)}km`;
    }
    return `距離目標 ${roundedM}m`;
}

function syncDistanceGuideButtonUI(pin) {
    if (!btnDistanceGuideMapPin) return;
    const isGuidingThisPin = Boolean(activeDistanceGuidePin && pin && activeDistanceGuidePin.id === pin.id);
    if (isGuidingThisPin) {
        btnDistanceGuideMapPin.className = 'bg-amber-500 hover:bg-amber-600 text-white font-extrabold py-3 px-2 rounded-2xl shadow-md active:scale-95 flex items-center justify-center gap-1.5 text-xs sm:text-sm';
        btnDistanceGuideMapPin.innerHTML = '🎯 取消距離指引';
    } else {
        btnDistanceGuideMapPin.className = 'bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-3 px-2 rounded-2xl shadow-md active:scale-95 flex items-center justify-center gap-1.5 text-xs sm:text-sm';
        btnDistanceGuideMapPin.innerHTML = '🎯 距離指引';
    }
}

function clearPinDistanceGuide() {
    activeDistanceGuidePin = null;
    if (pinDistanceGuideTimer !== null) {
        clearInterval(pinDistanceGuideTimer);
        pinDistanceGuideTimer = null;
    }
    if (pinDistanceLineMarker) {
        try { pinDistanceLineMarker.remove(); } catch (e) {}
        pinDistanceLineMarker = null;
    }
    try {
        map.getSource('pin-distance-guide')?.setData(emptyGeoJSON());
    } catch (e) {}
    if (pinDistanceGuideBanner) {
        pinDistanceGuideBanner.classList.add('hidden');
    }
    if (activeViewingMapPin) {
        syncDistanceGuideButtonUI(activeViewingMapPin);
    }
}

function updatePinDistanceGuideRender() {
    if (!activeDistanceGuidePin) return;
    if (isPowerSaveMapPaused()) return;

    const targetLat = Number(activeDistanceGuidePin.lat);
    const targetLng = Number(activeDistanceGuidePin.lng);
    if (isNaN(targetLat) || isNaN(targetLng)) {
        clearPinDistanceGuide();
        return;
    }

    const userLng = (typeof currentFleetLng === 'number' && !isNaN(currentFleetLng))
        ? currentFleetLng
        : (Array.isArray(lastKnownLngLat) ? Number(lastKnownLngLat[0]) : 121.346);
    const userLat = (typeof currentFleetLat === 'number' && !isNaN(currentFleetLat))
        ? currentFleetLat
        : (Array.isArray(lastKnownLngLat) ? Number(lastKnownLngLat[1]) : 24.954);

    const distMeters = getDistanceKm(userLng, userLat, targetLng, targetLat) * 1000;
    const distLabel = formatDistanceToPinText(distMeters);

    if (ensurePinDistanceGuideLayer()) {
        map.getSource('pin-distance-guide')?.setData({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [userLng, userLat],
                            [targetLng, targetLat]
                        ]
                    }
                }
            ]
        });
    }

    const midLng = (userLng + targetLng) / 2;
    const midLat = (userLat + targetLat) / 2;

    if (!pinDistanceLineMarker) {
        const badgeEl = document.createElement('div');
        badgeEl.className = 'pin-distance-line-badge';
        badgeEl.title = '點擊取消距離指引';
        badgeEl.onclick = (e) => {
            e.stopPropagation();
            clearPinDistanceGuide();
        };
        pinDistanceLineMarker = new maplibregl.Marker({
            element: badgeEl,
            anchor: 'center',
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        })
            .setLngLat([midLng, midLat])
            .addTo(map);
    } else {
        pinDistanceLineMarker.setLngLat([midLng, midLat]);
    }

    const badgeDom = pinDistanceLineMarker.getElement();
    if (badgeDom) {
        badgeDom.textContent = `🎯 ${distLabel}`;
    }

    if (pinDistanceGuideBanner && pinDistanceGuideText) {
        const shortTitle = (activeDistanceGuidePin.title || '目標地標').slice(0, 10);
        pinDistanceGuideText.textContent = `${shortTitle} · ${distLabel}`;
        pinDistanceGuideBanner.classList.remove('hidden');
    }
}

function togglePinDistanceGuide(pin) {
    if (!pin) return;
    if (activeDistanceGuidePin && activeDistanceGuidePin.id === pin.id) {
        clearPinDistanceGuide();
        return;
    }

    if (pinDistanceGuideTimer !== null) {
        clearInterval(pinDistanceGuideTimer);
        pinDistanceGuideTimer = null;
    }

    activeDistanceGuidePin = { ...pin };
    syncDistanceGuideButtonUI(pin);
    closeViewMapPinModal();

    updatePinDistanceGuideRender();
    pinDistanceGuideTimer = setInterval(updatePinDistanceGuideRender, 1000);
}

if (btnCancelPinDistanceGuideBanner) {
    btnCancelPinDistanceGuideBanner.onclick = () => clearPinDistanceGuide();
}

if (btnGoogleNavMapPin) {
    btnGoogleNavMapPin.onclick = () => {
        if (!activeViewingMapPin) return;
        const lat = Number(activeViewingMapPin.lat);
        const lng = Number(activeViewingMapPin.lng);
        if (isNaN(lat) || isNaN(lng)) return;
        const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
        window.open(navUrl, '_blank', 'noopener,noreferrer');
    };
}

if (btnDistanceGuideMapPin) {
    btnDistanceGuideMapPin.onclick = () => {
        if (!activeViewingMapPin) return;
        togglePinDistanceGuide(activeViewingMapPin);
    };
}

function formatPinCreatedAt(ts) {
    if (!ts) return '未知時間';
    const d = new Date(typeof ts === 'number' ? ts : Number(ts) || ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString('zh-TW', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function resetMapPinPhotoInputs() {
    if (mapPinCameraInput) mapPinCameraInput.value = '';
    if (mapPinGalleryInput) mapPinGalleryInput.value = '';
}

function updateMapPinPhotoPreviewUI(base64Str, statusText = '') {
    currentMapPinPhotoBase64 = base64Str || '';
    if (currentMapPinPhotoBase64) {
        if (mapPinPhotoPreviewImg) mapPinPhotoPreviewImg.src = currentMapPinPhotoBase64;
        if (mapPinPhotoPreviewWrap) mapPinPhotoPreviewWrap.classList.remove('hidden');
        if (mapPinPhotoStatus) {
            if (statusText) {
                mapPinPhotoStatus.innerText = statusText;
            } else {
                const kb = Math.max(1, Math.round((currentMapPinPhotoBase64.length * 0.75) / 1024));
                mapPinPhotoStatus.innerText = `✅ 已附加現場照片（約 ${kb} KB）`;
            }
            mapPinPhotoStatus.classList.remove('hidden');
        }
    } else {
        if (mapPinPhotoPreviewImg) mapPinPhotoPreviewImg.src = '';
        if (mapPinPhotoPreviewWrap) mapPinPhotoPreviewWrap.classList.add('hidden');
        if (mapPinPhotoStatus) {
            mapPinPhotoStatus.innerText = '';
            mapPinPhotoStatus.classList.add('hidden');
        }
    }
}

if (btnRemoveMapPinPhoto) {
    btnRemoveMapPinPhoto.onclick = () => {
        resetMapPinPhotoInputs();
        updateMapPinPhotoPreviewUI('');
    };
}
if (mapPinPhotoPreviewImg) {
    mapPinPhotoPreviewImg.onclick = () => {
        if (currentMapPinPhotoBase64) window.openPhotoLightbox(currentMapPinPhotoBase64);
    };
}
if (viewMapPinPhotoImg) {
    viewMapPinPhotoImg.onclick = () => {
        if (viewMapPinPhotoImg.src) window.openPhotoLightbox(viewMapPinPhotoImg.src);
    };
}

// 使用前端 <canvas> 自動等比例縮放壓縮至寬度最大 600px、JPEG 品質 0.7
function renderPinImageToCompressedBase64(source, srcWidth, srcHeight) {
    const maxWidth = 600;
    let targetW = srcWidth || 600;
    let targetH = srcHeight || 450;
    if (targetW > maxWidth) {
        targetH = Math.round(targetH * (maxWidth / targetW));
        targetW = maxWidth;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(source, 0, 0, targetW, targetH);

    let quality = 0.7;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    let byteSize = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);

    while (byteSize > 120 * 1024 && quality > 0.35) {
        quality = Math.max(0.3, quality - 0.1);
        dataUrl = canvas.toDataURL('image/jpeg', quality);
        byteSize = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);
    }

    return { dataUrl, kb: Math.max(1, Math.round(byteSize / 1024)) };
}

function compressMapPinImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('讀取照片失敗'));
        reader.onload = (ev) => {
            const rawDataUrl = ev.target.result;
            const img = new Image();
            img.onload = () => {
                try {
                    resolve(renderPinImageToCompressedBase64(img, img.naturalWidth || img.width, img.naturalHeight || img.height));
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = async () => {
                if (typeof window.createImageBitmap === 'function') {
                    try {
                        const bmp = await window.createImageBitmap(file);
                        const res = renderPinImageToCompressedBase64(bmp, bmp.width, bmp.height);
                        if (typeof bmp.close === 'function') bmp.close();
                        resolve(res);
                        return;
                    } catch (e) {}
                }
                reject(new Error('不支援的照片格式'));
            };
            img.src = rawDataUrl;
        };
        reader.readAsDataURL(file);
    });
}

async function handleMapPinPhotoInputChange(e) {
    const inputEl = e.target;
    const file = inputEl.files && inputEl.files[0];
    inputEl.value = '';
    if (!file) return;

    if (mapPinPhotoStatus) {
        mapPinPhotoStatus.innerText = '⏳ 正在縮放壓縮照片...';
        mapPinPhotoStatus.classList.remove('hidden');
    }
    try {
        const { dataUrl, kb } = await compressMapPinImageFile(file);
        updateMapPinPhotoPreviewUI(dataUrl, `✅ 照片已壓縮完成（${kb} KB · 寬度 ≤ 600px）`);
    } catch (err) {
        console.error('地標照片壓縮失敗:', err);
        alert('⚠️ 無法處理此照片格式，請改用相機拍照或選擇一般 JPG/PNG 圖片！');
        updateMapPinPhotoPreviewUI(currentMapPinPhotoBase64 || '');
    }
}

if (mapPinCameraInput) mapPinCameraInput.onchange = handleMapPinPhotoInputChange;
if (mapPinGalleryInput) mapPinGalleryInput.onchange = handleMapPinPhotoInputChange;

function openLongPressPinTypeModal(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    pendingMapPinLat = lat;
    pendingMapPinLng = lng;

    if (longPressPinTypeCoordsText) {
        longPressPinTypeCoordsText.innerText = `座標：${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
    if (longPressPinTypeModal) {
        window.history.pushState({ pwa: true }, '');
        longPressPinTypeModal.classList.remove('hidden');
    }
}

function closeLongPressPinTypeModal(clearCoords = true) {
    if (longPressPinTypeModal) longPressPinTypeModal.classList.add('hidden');
    if (clearCoords) {
        pendingMapPinLat = null;
        pendingMapPinLng = null;
    }
}

if (btnCancelLongPressPinType) btnCancelLongPressPinType.onclick = () => closeLongPressPinTypeModal(true);
if (btnCloseLongPressTypeTop) btnCloseLongPressTypeTop.onclick = () => closeLongPressPinTypeModal(true);

if (btnChooseDirtySpotPin) {
    btnChooseDirtySpotPin.onclick = () => {
        const lat = pendingMapPinLat;
        const lng = pendingMapPinLng;
        closeLongPressPinTypeModal(false);
        openCreateMapPinModal(lat, lng);
    };
}

if (btnChooseBuildingPin) {
    btnChooseBuildingPin.onclick = () => {
        if (!canCurrentUserManageBuildings()) {
            closeLongPressPinTypeModal(false);
            alert('🔒 目前為「一般模式（唯讀）」。\n若要新增／修改／刪除「🏢 社區大樓」，請輸入管理者密碼解鎖，或請開發者開啟您的「社區標註授權開關」！');
            openAdminPasswordModal();
            return;
        }
        const lat = pendingMapPinLat;
        const lng = pendingMapPinLng;
        closeLongPressPinTypeModal(false);
        openCreateBuildingPinModal(lat, lng, null);
    };
}

function openCreateBuildingPinModal(lat, lng, existingPin = null) {
    if (!canCurrentUserManageBuildings()) {
        alert('🔒 需具備「管理者模式」或「社區標註授權」權限才可新增或修改社區大樓！');
        openAdminPasswordModal();
        return;
    }
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    pendingMapPinLat = lat;
    pendingMapPinLng = lng;
    editingBuildingPinTarget = existingPin || null;

    if (buildingPinCoordsText) {
        buildingPinCoordsText.innerText = `座標：${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
    if (buildingPinModalTitle) {
        buildingPinModalTitle.innerHTML = existingPin
            ? '<span>🏢 修改社區大樓名稱</span>'
            : '<span>🏢 標記社區大樓（橘色水滴）</span>';
    }
    if (btnSaveBuildingPinText) {
        btnSaveBuildingPinText.textContent = existingPin
            ? '確認修改並同步全隊'
            : '確認標記並同步全隊';
    }
    if (buildingPinNameInput) {
        buildingPinNameInput.value = existingPin ? (existingPin.title || '') : '';
    }

    if (createBuildingPinModal) {
        window.history.pushState({ pwa: true }, '');
        createBuildingPinModal.classList.remove('hidden');
        setTimeout(() => {
            buildingPinNameInput?.focus();
            if (existingPin && buildingPinNameInput) {
                buildingPinNameInput.select();
            }
        }, 120);
    }
}

function closeCreateBuildingPinModal() {
    if (createBuildingPinModal) createBuildingPinModal.classList.add('hidden');
    editingBuildingPinTarget = null;
    pendingMapPinLat = null;
    pendingMapPinLng = null;
}

if (btnCancelBuildingPin) btnCancelBuildingPin.onclick = closeCreateBuildingPinModal;
if (btnCloseBuildingPinTop) btnCloseBuildingPinTop.onclick = closeCreateBuildingPinModal;

if (buildingPinNameInput) {
    buildingPinNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveBuildingMapPin();
        }
    });
}

async function saveBuildingMapPin() {
    if (!canCurrentUserManageBuildings()) {
        alert('🔒 需具備「管理者模式」或「社區標註授權」權限才可儲存社區大樓！');
        openAdminPasswordModal();
        return;
    }
    if (pendingMapPinLat === null || pendingMapPinLng === null) return;
    const buildingName = (buildingPinNameInput?.value || '').trim();
    if (!buildingName) {
        alert('請輸入社區或大樓名稱（例如：龍鳳呈祥、幸福社區）！');
        buildingPinNameInput?.focus();
        return;
    }
    if (!navigator.onLine) {
        alert('⚠️ 目前無網路連線，請確認網路狀態後再同步社區大樓標記！');
        return;
    }

    const isEditing = Boolean(editingBuildingPinTarget && editingBuildingPinTarget.id);
    const pinId = isEditing
        ? editingBuildingPinTarget.id
        : ('bldg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7));
    const authorName = (fleetUserName || localStorage.getItem('fleet_user_name') || localStorage.getItem('yinggeRouteLastAuthor') || '熱心隊員').trim();
    const now = Date.now();

    const pinData = {
        id: pinId,
        pinType: 'building',
        lat: Number(pendingMapPinLat.toFixed(6)),
        lng: Number(pendingMapPinLng.toFixed(6)),
        title: buildingName,
        note: isEditing ? (editingBuildingPinTarget.note || '') : '',
        photo: '',
        author: isEditing ? (editingBuildingPinTarget.author || authorName) : authorName,
        createdAt: isEditing ? (editingBuildingPinTarget.createdAt || now) : now,
        updatedAt: now
    };

    const origBtnHtml = btnSaveBuildingPin ? btnSaveBuildingPin.innerHTML : '';
    if (btnSaveBuildingPin) {
        btnSaveBuildingPin.disabled = true;
        btnSaveBuildingPin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在同步至全車隊地圖...';
    }

    try {
        const res = await fetchWithTimeout(`${MAP_PINS_BASE_URL}/${encodeURIComponent(pinId)}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pinData)
        }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        upsertPinMarkerOnMap(pinId, pinData);
        closeCreateBuildingPinModal();
        fetchAndRenderSharedMapPins();
    } catch (err) {
        console.error('上傳社區大樓標記失敗:', err);
        alert('❌ 儲存社區大樓標記失敗（網路不穩或 5 秒連線逾時），請稍後再試！');
    } finally {
        if (btnSaveBuildingPin) {
            btnSaveBuildingPin.disabled = false;
            btnSaveBuildingPin.innerHTML = origBtnHtml;
        }
    }
}

if (btnSaveBuildingPin) btnSaveBuildingPin.onclick = saveBuildingMapPin;

function openCreateMapPinModal(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    pendingMapPinLat = lat;
    pendingMapPinLng = lng;

    if (createMapPinCoordsText) {
        createMapPinCoordsText.innerText = `座標：${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
    if (mapPinTitleInput) {
        mapPinTitleInput.value = '';
    }
    resetMapPinPhotoInputs();
    updateMapPinPhotoPreviewUI('');

    if (createMapPinModal) {
        window.history.pushState({ pwa: true }, '');
        createMapPinModal.classList.remove('hidden');
        setTimeout(() => mapPinTitleInput?.focus(), 120);
    }
}

function closeCreateMapPinModal() {
    if (createMapPinModal) createMapPinModal.classList.add('hidden');
    pendingMapPinLat = null;
    pendingMapPinLng = null;
}

if (btnCancelCreateMapPin) btnCancelCreateMapPin.onclick = closeCreateMapPinModal;
if (btnCloseCreateMapPinTop) btnCloseCreateMapPinTop.onclick = closeCreateMapPinModal;

async function saveNewSharedMapPin() {
    if (pendingMapPinLat === null || pendingMapPinLng === null) return;
    const titleVal = (mapPinTitleInput?.value || '').trim();
    if (!titleVal) {
        alert('請輸入地標備註標題或說明（例如：巷口大型廢棄物堆置）！');
        mapPinTitleInput?.focus();
        return;
    }
    if (!navigator.onLine) {
        alert('⚠️ 目前無網路連線，請確認網路狀態後再新增共享地標！');
        return;
    }

    const pinId = 'pin_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
    const authorName = (fleetUserName || localStorage.getItem('fleet_user_name') || localStorage.getItem('yinggeRouteLastAuthor') || '熱心隊員').trim();
    const createdAt = Date.now();

    const pinData = {
        id: pinId,
        pinType: 'dirty',
        lat: Number(pendingMapPinLat.toFixed(6)),
        lng: Number(pendingMapPinLng.toFixed(6)),
        title: titleVal,
        photo: currentMapPinPhotoBase64 || '',
        author: authorName,
        createdAt: createdAt
    };

    const origBtnHtml = btnSaveMapPin ? btnSaveMapPin.innerHTML : '';
    if (btnSaveMapPin) {
        btnSaveMapPin.disabled = true;
        btnSaveMapPin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在上傳地標...';
    }

    try {
        const res = await fetchWithTimeout(`${MAP_PINS_BASE_URL}/${encodeURIComponent(pinId)}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pinData)
        }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        upsertPinMarkerOnMap(pinId, pinData);
        closeCreateMapPinModal();
        fetchAndRenderSharedMapPins();
    } catch (err) {
        console.error('上傳共享地標失敗:', err);
        alert('❌ 新增地標失敗（網路不穩或 5 秒連線逾時），請稍後再試！');
    } finally {
        if (btnSaveMapPin) {
            btnSaveMapPin.disabled = false;
            btnSaveMapPin.innerHTML = origBtnHtml;
        }
    }
}

if (btnSaveMapPin) btnSaveMapPin.onclick = saveNewSharedMapPin;

function openViewMapPinModal(pin) {
    if (!pin) return;
    activeViewingMapPin = pin;
    const isBuilding = pin.pinType === 'building';
    const hasBuildingAuth = canCurrentUserManageBuildings();

    if (viewMapPinModalCard) {
        viewMapPinModalCard.classList.toggle('border-orange-500', isBuilding);
        viewMapPinModalCard.classList.toggle('border-blue-500', !isBuilding);
    }
    if (viewMapPinCategoryBadge) {
        if (isBuilding) {
            viewMapPinCategoryBadge.className = 'bg-orange-100 text-orange-800 text-xs font-black px-3 py-1 rounded-full flex items-center gap-1.5';
            viewMapPinCategoryBadge.innerHTML = hasBuildingAuth
                ? '<i class="fa-solid fa-building text-orange-600"></i> 全車隊共享社區大樓（已授權管理）'
                : '<i class="fa-solid fa-building text-orange-600"></i> 全車隊共享社區大樓（一般唯讀）';
        } else {
            viewMapPinCategoryBadge.className = 'bg-blue-100 text-blue-800 text-xs font-black px-3 py-1 rounded-full flex items-center gap-1.5';
            viewMapPinCategoryBadge.innerHTML = '<i class="fa-solid fa-location-dot text-blue-600"></i> 全車隊共享現場地標';
        }
    }

    if (viewMapPinTitleText) viewMapPinTitleText.textContent = pin.title || (isBuilding ? '社區大樓' : '現場注意事項');
    if (viewMapPinAuthorText) viewMapPinAuthorText.textContent = pin.author || '熱心隊員';
    if (viewMapPinTimeText) viewMapPinTimeText.textContent = formatPinCreatedAt(pin.updatedAt || pin.createdAt);

    if (!isBuilding && pin.photo) {
        if (viewMapPinPhotoImg) viewMapPinPhotoImg.src = pin.photo;
        if (viewMapPinPhotoWrap) viewMapPinPhotoWrap.classList.remove('hidden');
    } else {
        if (viewMapPinPhotoImg) viewMapPinPhotoImg.src = '';
        if (viewMapPinPhotoWrap) viewMapPinPhotoWrap.classList.add('hidden');
    }

    if (viewMapPinBuildingNoteWrap) {
        if (isBuilding) {
            viewMapPinBuildingNoteWrap.classList.remove('hidden');
            if (viewMapPinBuildingNoteInput) {
                viewMapPinBuildingNoteInput.value = pin.note || '';
                viewMapPinBuildingNoteInput.readOnly = !hasBuildingAuth;
                viewMapPinBuildingNoteInput.placeholder = hasBuildingAuth
                    ? '可輸入社區收運注意事項（例如：警衛室旁、子母車位置）...'
                    : '（唯讀模式：需管理者權限或社區標註授權才可編輯備註）';
            }
            if (btnSaveMapPinBuildingNote) {
                btnSaveMapPinBuildingNote.classList.toggle('hidden', !hasBuildingAuth);
            }
            if (viewMapPinNoteSavedStatus) {
                viewMapPinNoteSavedStatus.classList.add('hidden');
            }
        } else {
            viewMapPinBuildingNoteWrap.classList.add('hidden');
        }
    }

    if (btnEditMapPinTitle) {
        if (isBuilding) {
            btnEditMapPinTitle.classList.remove('hidden');
            btnEditMapPinTitle.innerHTML = hasBuildingAuth ? '✏️ 編輯名稱' : '🔑 解鎖管理';
        } else {
            btnEditMapPinTitle.classList.add('hidden');
        }
    }

    if (btnDeleteMapPin) {
        if (isBuilding && !hasBuildingAuth) {
            btnDeleteMapPin.classList.add('hidden');
        } else {
            btnDeleteMapPin.classList.remove('hidden');
            btnDeleteMapPin.innerHTML = isBuilding
                ? '🗑️ 刪除'
                : '🗑️ 已清理／移除';
        }
    }

    syncDistanceGuideButtonUI(pin);

    if (viewMapPinModal) {
        window.history.pushState({ pwa: true }, '');
        viewMapPinModal.classList.remove('hidden');
    }
}

function closeViewMapPinModal() {
    if (viewMapPinModal) viewMapPinModal.classList.add('hidden');
    activeViewingMapPin = null;
}

if (btnCloseViewMapPin) btnCloseViewMapPin.onclick = closeViewMapPinModal;
if (btnCloseViewMapPinTop) btnCloseViewMapPinTop.onclick = closeViewMapPinModal;

if (viewMapPinBuildingNoteInput) {
    ['mousedown', 'touchstart', 'pointerdown', 'click'].forEach(evtName => {
        viewMapPinBuildingNoteInput.addEventListener(evtName, (e) => {
            e.stopPropagation();
        });
    });
}

if (btnSaveMapPinBuildingNote) {
    btnSaveMapPinBuildingNote.onclick = async (e) => {
        e.stopPropagation();
        if (!canCurrentUserManageBuildings()) {
            alert('🔒 需具備「管理者模式」或「社區標註授權」權限才可修改社區備註！');
            openAdminPasswordModal();
            return;
        }
        if (!activeViewingMapPin || !activeViewingMapPin.id) return;
        if (!navigator.onLine) {
            alert('⚠️ 目前無網路連線，無法儲存社區備註！');
            return;
        }
        const pinId = activeViewingMapPin.id;
        const noteText = (viewMapPinBuildingNoteInput?.value || '').trim();
        const now = Date.now();
        const updatedPinData = {
            ...activeViewingMapPin,
            id: pinId,
            pinType: 'building',
            note: noteText,
            updatedAt: now
        };

        const origHtml = btnSaveMapPinBuildingNote.innerHTML;
        btnSaveMapPinBuildingNote.disabled = true;
        btnSaveMapPinBuildingNote.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 同步中...';

        try {
            const res = await fetchWithTimeout(`${MAP_PINS_BASE_URL}/${encodeURIComponent(pinId)}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedPinData)
            }, 5000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            activeViewingMapPin.note = noteText;
            activeViewingMapPin.updatedAt = now;
            upsertPinMarkerOnMap(pinId, updatedPinData);
            if (viewMapPinTimeText) {
                viewMapPinTimeText.textContent = formatPinCreatedAt(now);
            }
            if (viewMapPinNoteSavedStatus) {
                viewMapPinNoteSavedStatus.textContent = '✅ 已同步';
                viewMapPinNoteSavedStatus.classList.remove('hidden');
            }
        } catch (err) {
            console.error('儲存社區備註失敗:', err);
            alert('❌ 儲存備註失敗（網路不穩或連線逾時），請稍後再試！');
        } finally {
            btnSaveMapPinBuildingNote.disabled = false;
            btnSaveMapPinBuildingNote.innerHTML = origHtml;
        }
    };
}

if (btnEditMapPinTitle) {
    btnEditMapPinTitle.onclick = () => {
        if (!activeViewingMapPin) return;
        if (!canCurrentUserManageBuildings()) {
            openAdminPasswordModal();
            return;
        }
        const targetPin = { ...activeViewingMapPin };
        closeViewMapPinModal();
        openCreateBuildingPinModal(Number(targetPin.lat), Number(targetPin.lng), targetPin);
    };
}

if (btnDeleteMapPin) {
    btnDeleteMapPin.onclick = async () => {
        if (!activeViewingMapPin || !activeViewingMapPin.id) return;
        const pinId = activeViewingMapPin.id;
        const isBuilding = activeViewingMapPin.pinType === 'building';
        if (isBuilding && !canCurrentUserManageBuildings()) {
            alert('🔒 需具備「管理者模式」或「社區標註授權」權限才可刪除社區大樓！');
            openAdminPasswordModal();
            return;
        }
        const pinTitle = activeViewingMapPin.title || (isBuilding ? '此社區大樓' : '此地標');

        const confirmMsg = isBuilding
            ? `確定要將社區大樓「${pinTitle}」從全車隊地圖同步移除嗎？`
            : `確定「${pinTitle}」已清理完畢，要從全車隊地圖同步移除嗎？`;
        if (!confirm(confirmMsg)) return;
        if (!navigator.onLine) {
            alert('⚠️ 目前無網路連線，無法同步移除雲端標記！');
            return;
        }

        const origHtml = btnDeleteMapPin.innerHTML;
        btnDeleteMapPin.disabled = true;
        btnDeleteMapPin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 移除中...';

        try {
            const res = await fetchWithTimeout(`${MAP_PINS_BASE_URL}/${encodeURIComponent(pinId)}.json`, {
                method: 'DELETE'
            }, 5000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            if (pinsLayerGroup[pinId]) {
                try { pinsLayerGroup[pinId].marker.remove(); } catch (e) {}
                delete pinsLayerGroup[pinId];
            }
            if (activeDistanceGuidePin && activeDistanceGuidePin.id === pinId) {
                clearPinDistanceGuide();
            }
            closeViewMapPinModal();
            fetchAndRenderSharedMapPins();
        } catch (err) {
            console.error('刪除共享地標失敗:', err);
            alert('❌ 移除標記失敗（網路不穩或連線逾時），請稍後再試！');
        } finally {
            btnDeleteMapPin.disabled = false;
            btnDeleteMapPin.innerHTML = origHtml;
        }
    };
}

function createSharedPinMarkerElement(pin) {
    const isBuilding = pin.pinType === 'building';
    const wrapper = document.createElement('div');
    wrapper.className = isBuilding ? 'shared-pin-wrapper is-building-pin' : 'shared-pin-wrapper';

    const scaleInner = document.createElement('div');
    scaleInner.className = 'shared-pin-scale-inner';

    const labelEl = document.createElement('div');
    labelEl.className = isBuilding ? 'shared-pin-label is-building' : 'shared-pin-label';
    labelEl.textContent = isBuilding
        ? `🏢 ${pin.title || '社區大樓'}`
        : (pin.title || '現場地標');
    scaleInner.appendChild(labelEl);

    const teardrop = document.createElement('div');
    teardrop.className = isBuilding ? 'shared-pin-teardrop is-building' : 'shared-pin-teardrop';

    const inner = document.createElement('div');
    inner.className = 'shared-pin-inner';

    if (isBuilding) {
        inner.innerHTML = '<i class="fa-solid fa-building text-white text-sm"></i>';
    } else if (pin.photo) {
        const img = document.createElement('img');
        img.src = pin.photo;
        img.alt = pin.title || '地標縮圖';
        inner.appendChild(img);
    } else {
        inner.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-white text-sm"></i>';
    }

    teardrop.appendChild(inner);
    scaleInner.appendChild(teardrop);
    wrapper.appendChild(scaleInner);

    if (isBuilding) {
        // 遠景 (zoom < 14.2) 專用 9px 橘紅色實心圓點
        const dotEl = document.createElement('div');
        dotEl.className = 'shared-pin-dot';
        wrapper.appendChild(dotEl);

        // 🏢 社區大樓水滴防誤觸（按住滿 0.5 秒 / 500ms 才開啟資訊卡，滑動超過 8px 或提早放開即取消）
        let holdTimer = null;
        let holdStartX = 0;
        let holdStartY = 0;

        const cancelBuildingHold = () => {
            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
            wrapper.classList.remove('is-pressing');
        };

        const startBuildingHold = (clientX, clientY) => {
            cancelBuildingHold();
            holdStartX = clientX;
            holdStartY = clientY;
            wrapper.classList.add('is-pressing');
            holdTimer = setTimeout(() => {
                holdTimer = null;
                wrapper.classList.remove('is-pressing');
                vibrate(35);
                if (pinsLayerGroup[pin.id]?.data) {
                    openViewMapPinModal(pinsLayerGroup[pin.id].data);
                } else {
                    openViewMapPinModal(pin);
                }
            }, 500);
        };

        wrapper.addEventListener('touchstart', (e) => {
            if (!e.touches || e.touches.length !== 1) {
                cancelBuildingHold();
                return;
            }
            const t = e.touches[0];
            startBuildingHold(t.clientX, t.clientY);
        }, { passive: true });

        wrapper.addEventListener('touchmove', (e) => {
            if (!holdTimer || !e.touches || e.touches.length === 0) return;
            const t = e.touches[0];
            if (Math.hypot(t.clientX - holdStartX, t.clientY - holdStartY) > 8) {
                cancelBuildingHold();
            }
        }, { passive: true });

        wrapper.addEventListener('touchend', cancelBuildingHold, { passive: true });
        wrapper.addEventListener('touchcancel', cancelBuildingHold, { passive: true });

        wrapper.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            startBuildingHold(e.clientX, e.clientY);
        });

        wrapper.addEventListener('mousemove', (e) => {
            if (!holdTimer) return;
            if (Math.hypot(e.clientX - holdStartX, e.clientY - holdStartY) > 8) {
                cancelBuildingHold();
            }
        });

        wrapper.addEventListener('mouseup', cancelBuildingHold);
        wrapper.addEventListener('mouseleave', cancelBuildingHold);

        wrapper.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    } else {
        // ⚠️ 一般藍色髒亂點水滴保留即點即開
        wrapper.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pinsLayerGroup[pin.id]?.data) {
                openViewMapPinModal(pinsLayerGroup[pin.id].data);
            } else {
                openViewMapPinModal(pin);
            }
        });
    }

    return wrapper;
}

function upsertPinMarkerOnMap(pinId, pinData) {
    const lat = Number(pinData.lat);
    const lng = Number(pinData.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    const normalizedPin = { ...pinData, id: pinId, lat, lng };
    const signature = `${normalizedPin.pinType || 'dirty'}|${normalizedPin.title || ''}|${Boolean(normalizedPin.photo)}|${(normalizedPin.photo || '').length}`;

    if (pinsLayerGroup[pinId]) {
        pinsLayerGroup[pinId].marker.setLngLat([lng, lat]);
        pinsLayerGroup[pinId].data = normalizedPin;
        if (pinsLayerGroup[pinId].signature !== signature) {
            try { pinsLayerGroup[pinId].marker.remove(); } catch (e) {}
            const el = createSharedPinMarkerElement(normalizedPin);
            const marker = new maplibregl.Marker({
                element: el,
                anchor: 'bottom',
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            })
                .setLngLat([lng, lat])
                .addTo(map);
            pinsLayerGroup[pinId] = { marker, el, data: normalizedPin, signature };
        }
    } else {
        const el = createSharedPinMarkerElement(normalizedPin);
        const marker = new maplibregl.Marker({
            element: el,
            anchor: 'bottom',
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        })
            .setLngLat([lng, lat])
            .addTo(map);
        pinsLayerGroup[pinId] = { marker, el, data: normalizedPin, signature };
    }
}

async function fetchAndRenderSharedMapPins() {
    if (!navigator.onLine || isFetchingMapPins) return;
    if (isPowerSaveMapPaused()) return;
    isFetchingMapPins = true;
    try {
        const res = await fetchWithTimeout(MAP_PINS_ALL_URL, { cache: 'no-store' }, 5000);
        if (!res.ok) return;
        const data = await res.json();
        const activePinIds = new Set();

        if (data && typeof data === 'object') {
            Object.entries(data).forEach(([key, pin]) => {
                if (!pin || typeof pin !== 'object') return;
                const pinId = pin.id || key;
                const lat = Number(pin.lat);
                const lng = Number(pin.lng);
                if (isNaN(lat) || isNaN(lng)) return;
                activePinIds.add(pinId);
                upsertPinMarkerOnMap(pinId, { ...pin, id: pinId });
            });
        }

        // 同步清除已被隊友銷案移除的地標
        Object.keys(pinsLayerGroup).forEach(pinId => {
            if (!activePinIds.has(pinId)) {
                try { pinsLayerGroup[pinId].marker.remove(); } catch (e) {}
                delete pinsLayerGroup[pinId];
                if (activeDistanceGuidePin && activeDistanceGuidePin.id === pinId) {
                    clearPinDistanceGuide();
                }
            }
        });
        if (activeDistanceGuidePin) {
            updatePinDistanceGuideRender();
        }
    } catch (err) {
        // 弱訊號或超時靜默略過，下週期自動恢復
    } finally {
        isFetchingMapPins = false;
    }
}

// 綁定長按 2 秒（2000ms）防誤觸與桌面長按／右鍵新增地標互動（彈出 ⚠️ 標記髒亂點 ／ 🏢 標記社區大樓 二選一選單）
(function setupMapLongPressForPins() {
    let longPressTimer = null;
    let startClientX = 0;
    let startClientY = 0;
    let pendingLngLat = null;
    const LONG_PRESS_DURATION_MS = 2000;

    function clearLongPressTimer() {
        if (longPressTimer !== null) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    function isIgnoredMarkerTarget(targetEl) {
        return Boolean(
            targetEl &&
            targetEl.closest &&
            targetEl.closest('.shared-pin-wrapper, .music-marker, .fleet-truck-marker, .pin-s, .pin-e, .furniture-pin-wrapper, .furniture-popup-wrapper, .callout-box-marker, .callout-anchor-dot')
        );
    }

    const canvasContainer = map.getCanvasContainer();

    canvasContainer.addEventListener('touchstart', (e) => {
        clearLongPressTimer();
        if (isEditingMode || isManualDrawingMode || (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive)) return;
        if (!e.touches || e.touches.length !== 1) return;
        if (isIgnoredMarkerTarget(e.target)) return;

        const touch = e.touches[0];
        startClientX = touch.clientX;
        startClientY = touch.clientY;

        const rect = canvasContainer.getBoundingClientRect();
        const pointX = touch.clientX - rect.left;
        const pointY = touch.clientY - rect.top;
        pendingLngLat = map.unproject([pointX, pointY]);

        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            if (isEditingMode || isManualDrawingMode || (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive) || !pendingLngLat) return;
            try { navigator.vibrate?.(50); } catch (err) {}
            openLongPressPinTypeModal(pendingLngLat.lat, pendingLngLat.lng);
        }, LONG_PRESS_DURATION_MS);
    }, { passive: true });

    canvasContainer.addEventListener('touchmove', (e) => {
        if (longPressTimer === null) return;
        if (!e.touches || e.touches.length !== 1) {
            clearLongPressTimer();
            return;
        }
        const touch = e.touches[0];
        const moveDist = Math.hypot(touch.clientX - startClientX, touch.clientY - startClientY);
        if (moveDist > 10) {
            clearLongPressTimer();
        }
    }, { passive: true });

    canvasContainer.addEventListener('touchend', clearLongPressTimer, { passive: true });
    canvasContainer.addEventListener('touchcancel', clearLongPressTimer, { passive: true });

    // 桌面滑鼠左鍵長按 2 秒支援
    canvasContainer.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        clearLongPressTimer();
        if (isEditingMode || isManualDrawingMode || (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive)) return;
        if (isIgnoredMarkerTarget(e.target)) return;

        startClientX = e.clientX;
        startClientY = e.clientY;
        const rect = canvasContainer.getBoundingClientRect();
        pendingLngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);

        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            if (isEditingMode || isManualDrawingMode || (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive) || !pendingLngLat) return;
            openLongPressPinTypeModal(pendingLngLat.lat, pendingLngLat.lng);
        }, LONG_PRESS_DURATION_MS);
    });

    canvasContainer.addEventListener('mousemove', (e) => {
        if (longPressTimer === null) return;
        const moveDist = Math.hypot(e.clientX - startClientX, e.clientY - startClientY);
        if (moveDist > 10) {
            clearLongPressTimer();
        }
    });

    canvasContainer.addEventListener('mouseup', clearLongPressTimer);

    ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart', 'wheel'].forEach(evtName => {
        map.on(evtName, clearLongPressTimer);
    });

    // 桌面端支援右鍵 contextmenu 觸發
    map.on('contextmenu', (e) => {
        clearLongPressTimer();
        if (isEditingMode || isManualDrawingMode || (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive)) return;
        const origTarget = e.originalEvent?.target;
        if (isIgnoredMarkerTarget(origTarget)) {
            return;
        }
        if (e.originalEvent) e.originalEvent.preventDefault();
        try { navigator.vibrate?.(50); } catch (err) {}
        if (e.lngLat) {
            openLongPressPinTypeModal(e.lngLat.lat, e.lngLat.lng);
        }
    });
})();

function startSharedMapPinsSystem() {
    if (mapPinsPollTimer !== null) {
        clearInterval(mapPinsPollTimer);
        mapPinsPollTimer = null;
    }
    fetchAndRenderSharedMapPins();
    mapPinsPollTimer = setInterval(fetchAndRenderSharedMapPins, 20000);
}

// 開啟 App 時立即讀取一次 /map_pins.json 並啟動定期同步
if (map.loaded()) {
    startSharedMapPinsSystem();
} else {
    map.once('load', startSharedMapPinsSystem);
}
startSharedMapPinsSystem();

// ==========================================
// ⚙️ 10. 管理員隱藏設定面板（三層權限驗證＋全隊導航參數＋👥 管理使用者雙向即時同步 v3.27）
// ==========================================
const ADMIN_SETTINGS_PASSWORD = '888888';

// --- 10.1 從 Firebase 讀取全隊系統參數設定（讀取不到時自動套用預設值） ---
async function fetchSystemConfig() {
    try {
        const res = await fetchWithTimeout(SYSTEM_CONFIG_URL, { cache: 'no-store' }, 5000);
        if (!res.ok) return normalizeSystemConfig(systemNavConfig);
        const data = await res.json();
        if (data && typeof data === 'object') {
            return normalizeSystemConfig(data);
        }
        return normalizeSystemConfig(DEFAULT_SYSTEM_CONFIG);
    } catch (e) {
        return normalizeSystemConfig(systemNavConfig);
    }
}

// --- 10.1.5 停止車隊雷達廣播與同步（當裝置被封鎖或進入門禁待核准時立即執行） ---
function stopAndClearMyFleetRadarImmediately() {
    if (fleetRadarWatchId !== null) {
        try { navigator.geolocation.clearWatch(fleetRadarWatchId); } catch (e) {}
        fleetRadarWatchId = null;
    }
    if (fleetPollTimer !== null) {
        clearInterval(fleetPollTimer);
        fleetPollTimer = null;
    }
    if (fleetHeartbeatTimer !== null) {
        clearInterval(fleetHeartbeatTimer);
        fleetHeartbeatTimer = null;
    }
    fleetRadarStarted = false;

    // 立即從雲端 live_fleet 移除本機廣播節點
    if (fleetDeviceId && navigator.onLine) {
        fetchWithTimeout(`${LIVE_FLEET_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, {
            method: 'DELETE',
            keepalive: true
        }, 4000).catch(() => {});
    }

    // 清除畫面上其他友車標記與在線名單
    Object.keys(fleetLayerGroup).forEach(devId => {
        try { fleetLayerGroup[devId].marker.remove(); } catch (e) {}
        delete fleetLayerGroup[devId];
    });
    onlineFleetMembersList = [];
    renderOnlineFleetListUI();
}

// --- 10.1.6 檢查本機在 fleet_users/{deviceId} 的核准／封鎖／社區標註授權狀態 ---
let isCheckingMyUserAccess = false;
async function checkMyFleetUserAccessStatus() {
    if (!fleetDeviceId || !navigator.onLine || isCheckingMyUserAccess) return;
    isCheckingMyUserAccess = true;
    try {
        const res = await fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, { cache: 'no-store' }, 4500);
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object') {
                myCloudUserProfile = data;
            } else if (fleetUserName) {
                // 若雲端紀錄還沒建立但已有本機名稱，自動補建一次
                await syncMyFleetUserRecordToCloud({ displayName: fleetUserName });
            } else {
                myCloudUserProfile = null;
            }
        }
        evaluateAndRenderAccessGateOverlay();
    } catch (e) {
    } finally {
        isCheckingMyUserAccess = false;
    }
}

function evaluateAndRenderAccessGateOverlay() {
    const overlay = document.getElementById('deviceAccessGateOverlay');
    if (!overlay) return;

    const iconWrap = document.getElementById('gateOverlayIconWrap');
    const iconEl = document.getElementById('gateOverlayIcon');
    const badgeEl = document.getElementById('gateOverlayStatusBadge');
    const titleEl = document.getElementById('gateOverlayTitle');
    const descEl = document.getElementById('gateOverlayDesc');
    const formWrap = document.getElementById('gateApplyFormWrap');
    const nameInput = document.getElementById('gateApplyNameInput');

    const blocked = isCurrentDeviceBlocked();
    const pendingApproval = !blocked && isCurrentDevicePendingApproval();

    if (blocked) {
        // 🚫 此裝置已被開發者封鎖：即時鎖定畫面並停止同步與車隊雷達廣播
        stopAndClearMyFleetRadarImmediately();
        if (iconWrap) iconWrap.className = 'w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3 text-3xl shadow-inner';
        if (iconEl) iconEl.className = 'fa-solid fa-ban';
        if (badgeEl) {
            badgeEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-800 mb-2';
            badgeEl.textContent = '🚫 裝置已封鎖鎖定';
        }
        if (titleEl) titleEl.textContent = '此裝置已被暫停使用權限';
        if (descEl) descEl.textContent = '系統管理員已封鎖此裝置的存取權限，已即時停止地圖同步與車隊雷達廣播。如需恢復請聯繫開發者（凱哥）。';
        formWrap?.classList.add('hidden');
        overlay.classList.remove('hidden');
        return;
    }

    if (pendingApproval) {
        // ⏳ 全站門禁開啟且尚未核准：進入待核准狀態並暫停雷達廣播
        stopAndClearMyFleetRadarImmediately();
        if (iconWrap) iconWrap.className = 'w-16 h-16 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-3 text-3xl shadow-inner';
        if (iconEl) iconEl.className = 'fa-solid fa-user-clock';
        if (badgeEl) {
            badgeEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800 mb-2';
            badgeEl.textContent = (myCloudUserProfile && myCloudUserProfile.displayName)
                ? `⏳ 待核准中（${myCloudUserProfile.displayName}）`
                : '⏳ 待開發者核准授權';
        }
        if (titleEl) titleEl.textContent = '需核准授權才可使用';
        if (descEl) descEl.textContent = '目前系統已開啟全站門禁管制。請輸入您的稱呼並送出申請，待開發者（凱哥）按核准後即可自動放行。';
        formWrap?.classList.remove('hidden');
        if (nameInput && !nameInput.value.trim()) {
            nameInput.value = fleetUserName || (myCloudUserProfile?.displayName || '');
        }
        overlay.classList.remove('hidden');
        return;
    }

    // 已核准且未封鎖：放行畫面，若原本雷達因門禁暫停且已有姓名，自動恢復啟動車隊雷達
    const wasGateVisible = !overlay.classList.contains('hidden');
    overlay.classList.add('hidden');
    if (wasGateVisible && fleetUserName && !fleetRadarStarted) {
        startFleetRadarSystem();
        if (currentFleetLat !== null && currentFleetLng !== null) {
            uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
        }
    }
}

// 綁定全站門禁遮罩按鈕事件
(function setupDeviceAccessGateOverlayEvents() {
    const nameInput = document.getElementById('gateApplyNameInput');
    const submitBtn = document.getElementById('btnSubmitGateApprovalRequest');
    const feedbackEl = document.getElementById('gateApplyFeedback');
    const checkNowBtn = document.getElementById('btnGateCheckNow');
    const devUnlockBtn = document.getElementById('btnGateDeveloperUnlock');

    submitBtn?.addEventListener('click', async () => {
        const val = (nameInput?.value || '').trim();
        if (!val) {
            alert('請輸入您的顯示名稱或稱呼！');
            nameInput?.focus();
            return;
        }
        fleetUserName = val;
        localStorage.setItem('fleet_user_name', fleetUserName);
        localStorage.setItem('yinggeRouteLastAuthor', fleetUserName);
        syncFleetUserNameUI();
        fleetUserNameModal?.classList.add('hidden');

        const origText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = '送出中...';
        try {
            await syncMyFleetUserRecordToCloud({ displayName: fleetUserName, requestApproval: true });
            if (feedbackEl) {
                feedbackEl.textContent = `✅ 已以「${fleetUserName}」送出申請！等待開發者核准放行中...`;
                feedbackEl.classList.remove('hidden');
            }
            evaluateAndRenderAccessGateOverlay();
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = origText;
        }
    });

    checkNowBtn?.addEventListener('click', async () => {
        const origHtml = checkNowBtn.innerHTML;
        checkNowBtn.disabled = true;
        checkNowBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>檢查中...';
        try {
            await checkAndApplyRadarInterval();
            await checkMyFleetUserAccessStatus();
        } finally {
            checkNowBtn.disabled = false;
            checkNowBtn.innerHTML = origHtml;
        }
    });

    devUnlockBtn?.addEventListener('click', () => {
        openAdminPasswordModal();
    });
})();

// --- 10.2 套用完整系統參數至當前導航與畫面 ---
function applySystemConfigToRuntime(newCfg) {
    const normalized = normalizeSystemConfig(newCfg);
    const prevDynamicZoom = systemNavConfig.enableDynamicZoom;
    const prevLowZoom = systemNavConfig.lowSpeedZoom;
    const prevHighZoom = systemNavConfig.highSpeedZoom;

    systemNavConfig = normalized;
    try {
        localStorage.setItem('yingge_system_nav_config_v31', JSON.stringify(normalized));
    } catch (e) {}

    // 1. 全隊頂部公告橫幅即時顯示／隱藏
    renderFleetAnnouncementBanner(normalized.announcementText);

    // 1.2 全站門禁總開關狀態同步檢查
    evaluateAndRenderAccessGateOverlay();
    syncAdminGateStatusBadgeUI(normalized.requireUserApproval);

    // 1.5 左上角車隊雷達在線名單與地圖友車標記休眠狀態即時同步套用
    if (typeof fleetLayerGroup === 'object' && fleetLayerGroup) {
        const now = Date.now();
        Object.values(fleetLayerGroup).forEach(entry => {
            if (entry && entry.el && entry.lastUpdatedAt) {
                updateFleetTruckMarkerAppearance(entry.el, entry.name, entry.lastUpdatedAt, now);
            }
        });
    }
    if (typeof renderOnlineFleetListUI === 'function') {
        renderOnlineFleetListUI();
    }

    // 3. 若跟隨中且縮放設定變更，平滑更新當前視野縮放
    if (
        isFollowingCamera &&
        !isPowerSaveMapPaused() &&
        normalized.enableDynamicZoom &&
        (prevDynamicZoom !== normalized.enableDynamicZoom ||
         prevLowZoom !== normalized.lowSpeedZoom ||
         prevHighZoom !== normalized.highSpeedZoom)
    ) {
        const targetZoom = getDynamicZoomBySpeed(lastRecordedSpeedKmh);
        try {
            map.easeTo({
                center: lastKnownLngLat,
                zoom: targetZoom,
                bearing: isHeadingUpMode ? currentHeading : map.getBearing(),
                offset: [0, 100],
                duration: 450
            });
        } catch (e) {}
    }

    // 4. 車隊雷達輪詢秒數變更時即時重啟計時器
    const cloudSec = normalized.radarIntervalSec;
    if (cloudSec && cloudSec !== currentRadarIntervalSec) {
        currentRadarIntervalSec = cloudSec;
        lastKnownCloudInterval = cloudSec;
        restartFleetRadarWithNewInterval(cloudSec);
        updateAdminIntervalDisplay(cloudSec);
    }
}

// --- 10.3 檢查雲端系統設定是否變更，若變更則即時套用（無須重開 App） ---
let isCheckingSystemConfig = false;
async function checkAndApplyRadarInterval() {
    if (isCheckingSystemConfig) return;
    isCheckingSystemConfig = true;
    try {
        const cloudCfg = await fetchSystemConfig();
        applySystemConfigToRuntime(cloudCfg);
        await checkMyFleetUserAccessStatus();
    } finally {
        isCheckingSystemConfig = false;
    }
}

// --- 10.4 以新秒數重新啟動車隊雷達輪詢（GPS 上傳 + 雷達讀取） ---
function restartFleetRadarWithNewInterval(intervalSec) {
    if (!fleetUserName || isDeviceRestrictedByGatekeeper()) return;

    if (fleetPollTimer !== null) {
        clearInterval(fleetPollTimer);
        fleetPollTimer = null;
    }
    const intervalMs = (intervalSec || DEFAULT_RADAR_INTERVAL_SEC) * 1000;
    fetchAndRenderFleetRadar();
    fleetPollTimer = setInterval(fetchAndRenderFleetRadar, intervalMs);
}

// --- 10.5 初始化：啟動時立即讀取雲端系統參數、門禁狀態、公告橫幅與雲端路線版本比對 ---
(async function initSystemConfigSync() {
    const cloudCfg = await fetchSystemConfig();
    currentRadarIntervalSec = cloudCfg.radarIntervalSec;
    lastKnownCloudInterval = cloudCfg.radarIntervalSec;
    applySystemConfigToRuntime(cloudCfg);

    if (fleetUserName) {
        await syncMyFleetUserRecordToCloud({ displayName: fleetUserName });
    }
    await checkMyFleetUserAccessStatus();

    if (fleetRadarStarted && fleetUserName && !isDeviceRestrictedByGatekeeper()) {
        restartFleetRadarWithNewInterval(cloudCfg.radarIntervalSec);
    }
    if (typeof checkCloudRouteUpdatesInBackground === 'function') {
        checkCloudRouteUpdatesInBackground(true);
    }
    window.addEventListener('online', () => {
        if (typeof checkCloudRouteUpdatesInBackground === 'function') {
            checkCloudRouteUpdatesInBackground(true);
        }
        checkMyFleetUserAccessStatus();
    });
    // 每 6 秒自動同步全隊系統參數、全站門禁與封鎖狀態（確保被封鎖或核准時秒級生效）
    setInterval(() => {
        checkAndApplyRadarInterval();
    }, 6000);
})();

// --- 10.6 在每次 fetchAndRenderFleetRadar 時一併檢查雲端參數與門禁是否變更 ---
const _originalFetchAndRenderFleetRadar = fetchAndRenderFleetRadar;
fetchAndRenderFleetRadar = async function() {
    if (isDeviceRestrictedByGatekeeper()) {
        stopAndClearMyFleetRadarImmediately();
        return;
    }
    await _originalFetchAndRenderFleetRadar();
    checkAndApplyRadarInterval();
};

// --- 10.7 點擊版本號（或標題連續點擊 5 次）觸發權限驗證 ---
(function setupAdminTitleTrigger() {
    const versionBadgeEl = document.getElementById('appVersionBadge');
    if (versionBadgeEl) {
        versionBadgeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            openAdminPasswordModal();
        });
    }

    const titleEl = document.getElementById('appStatusTitle');
    if (!titleEl) return;

    let tapCount = 0;
    let tapTimer = null;

    titleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        tapCount++;
        if (tapTimer) clearTimeout(tapTimer);
        tapTimer = setTimeout(() => { tapCount = 0; }, 3000);

        if (tapCount >= 5) {
            tapCount = 0;
            if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
            openAdminPasswordModal();
        }
    });
})();

// --- 10.8 三層權限密碼驗證彈窗（一般模式 / 管理者模式 / 開發者模式） ---
function syncAdminCurrentRoleBadgeUI() {
    const badgeEl = document.getElementById('adminCurrentRoleBadge');
    const logoutBtn = document.getElementById('btnLogoutAdminRole');
    const hasCloudBldgAuth = Boolean(myCloudUserProfile && myCloudUserProfile.canManageBuildings === true);

    if (badgeEl) {
        if (localUserPermissionRole === 'developer') {
            badgeEl.className = 'text-[11px] font-black px-2.5 py-0.5 rounded-lg bg-amber-500 text-white shadow-sm';
            badgeEl.textContent = '🛠️ 開發者模式（最高權限）';
        } else if (localUserPermissionRole === 'manager') {
            badgeEl.className = 'text-[11px] font-black px-2.5 py-0.5 rounded-lg bg-orange-500 text-white shadow-sm';
            badgeEl.textContent = '🏢 管理者模式（可管社區大樓）';
        } else if (hasCloudBldgAuth) {
            badgeEl.className = 'text-[11px] font-black px-2.5 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-300';
            badgeEl.textContent = '🏢 已獲社區標註授權';
        } else {
            badgeEl.className = 'text-[11px] font-black px-2.5 py-0.5 rounded-lg bg-gray-200 text-gray-700';
            badgeEl.textContent = '一般模式（唯讀）';
        }
    }
    if (logoutBtn) {
        logoutBtn.classList.toggle('hidden', localUserPermissionRole === 'normal');
    }
}

function setLocalUserPermissionRole(newRole) {
    localUserPermissionRole = ['normal', 'manager', 'developer'].includes(newRole) ? newRole : 'normal';
    try {
        localStorage.setItem('yingge_user_permission_role', localUserPermissionRole);
    } catch (e) {}
    syncAdminCurrentRoleBadgeUI();
    evaluateAndRenderAccessGateOverlay();
}

function openAdminPasswordModal() {
    const modal = document.getElementById('adminPasswordModal');
    const input = document.getElementById('adminPasswordInput');
    const errorEl = document.getElementById('adminPasswordError');
    if (!modal || !input) return;
    syncAdminCurrentRoleBadgeUI();
    input.value = '';
    errorEl?.classList.add('hidden');
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
}

document.getElementById('btnVerifyAdminPassword')?.addEventListener('click', () => {
    const input = document.getElementById('adminPasswordInput');
    const errorEl = document.getElementById('adminPasswordError');
    const pwd = (input?.value || '').trim();
    const managerPwd = (systemNavConfig.buildingManagerPassword || '666666').trim();

    if (pwd === ADMIN_SETTINGS_PASSWORD) {
        // 1. 開發者最高權限密碼（凱哥）
        setLocalUserPermissionRole('developer');
        document.getElementById('adminPasswordModal')?.classList.add('hidden');
        // 若自己這台裝置尚未核准或誤被封鎖，開發者登入時自動將本機設為核准且解除封鎖
        if (fleetDeviceId && navigator.onLine) {
            fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    displayName: fleetUserName || '凱哥(開發者)',
                    isApproved: true,
                    isBlocked: false,
                    canManageBuildings: true,
                    lastActiveAt: Date.now()
                })
            }, 4000).catch(() => {});
        }
        openAdminSettingsPanel();
    } else if (pwd && pwd === managerPwd) {
        // 2. 管理者模式獨立密碼（可新增／修改／刪除社區大樓）
        setLocalUserPermissionRole('manager');
        document.getElementById('adminPasswordModal')?.classList.add('hidden');
        vibrate([35, 30, 35]);
        alert('✅ 已解鎖「🏢 管理者模式」！\n您現在可以在地圖上長按新增、修改或刪除「社區大樓（橘色水滴）」標記。');
        if (activeViewingMapPin) {
            openViewMapPinModal(activeViewingMapPin);
        }
    } else {
        errorEl?.classList.remove('hidden');
        if (input) { input.value = ''; input.focus(); }
        try { navigator.vibrate?.(200); } catch (e) {}
    }
});

document.getElementById('btnLogoutAdminRole')?.addEventListener('click', () => {
    setLocalUserPermissionRole('normal');
    document.getElementById('adminPasswordModal')?.classList.add('hidden');
    alert('ℹ️ 已切回「一般模式（唯讀瀏覽／搜尋／導航）」。');
    if (activeViewingMapPin) {
        openViewMapPinModal(activeViewingMapPin);
    }
});

document.getElementById('adminPasswordInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('btnVerifyAdminPassword')?.click();
    }
});

document.getElementById('btnCancelAdminPassword')?.addEventListener('click', () => {
    document.getElementById('adminPasswordModal')?.classList.add('hidden');
});

// --- 10.8.5 開發者模式雙書籤頁切換（⚙️ 系統與 AI 參數 | 👥 管理使用者）與人員權限管理中心 ---
let activeAdminTab = 'system'; // 'system' | 'users'
let isFetchingAdminFleetUsers = false;

function switchAdminSettingsTab(tabName) {
    activeAdminTab = tabName === 'users' ? 'users' : 'system';
    const tabBtnSystem = document.getElementById('btnAdminTabSystem');
    const tabBtnUsers = document.getElementById('btnAdminTabUsers');
    const panelSystem = document.getElementById('adminTabPanelSystem');
    const panelUsers = document.getElementById('adminTabPanelUsers');

    if (activeAdminTab === 'users') {
        if (tabBtnUsers) {
            tabBtnUsers.className = 'py-2 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 bg-white text-amber-900 shadow-sm';
        }
        if (tabBtnSystem) {
            tabBtnSystem.className = 'py-2 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 text-amber-800/75 hover:text-amber-950';
        }
        panelSystem?.classList.add('hidden');
        panelUsers?.classList.remove('hidden');
        fetchAndRenderAdminFleetUsersList();
    } else {
        if (tabBtnSystem) {
            tabBtnSystem.className = 'py-2 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 bg-white text-amber-900 shadow-sm';
        }
        if (tabBtnUsers) {
            tabBtnUsers.className = 'py-2 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 text-amber-800/75 hover:text-amber-950';
        }
        panelUsers?.classList.add('hidden');
        panelSystem?.classList.remove('hidden');
    }
}

document.getElementById('btnAdminTabSystem')?.addEventListener('click', (e) => {
    e.stopPropagation();
    switchAdminSettingsTab('system');
});

document.getElementById('btnAdminTabUsers')?.addEventListener('click', (e) => {
    e.stopPropagation();
    switchAdminSettingsTab('users');
});

function syncAdminGateStatusBadgeUI(requireApproval) {
    const badgeEl = document.getElementById('adminGateStatusBadge');
    const checkboxEl = document.getElementById('adminRequireUserApprovalInput');
    if (checkboxEl) {
        checkboxEl.checked = Boolean(requireApproval);
    }
    if (badgeEl) {
        if (requireApproval) {
            badgeEl.className = 'text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 border border-amber-400';
            badgeEl.textContent = '🔒 需核准放行';
        } else {
            badgeEl.className = 'text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200';
            badgeEl.textContent = '🔓 自由進入';
        }
    }
}

async function saveAdminUserGateSettingsToCloud() {
    const reqApprovalEl = document.getElementById('adminRequireUserApprovalInput');
    const mgrPwdEl = document.getElementById('adminBuildingManagerPwdInput');
    const saveBtn = document.getElementById('btnSaveUserGateSettings');

    const nextRequireApproval = Boolean(reqApprovalEl?.checked);
    const nextManagerPwd = (mgrPwdEl?.value || '').trim() || '666666';
    if (mgrPwdEl) mgrPwdEl.value = nextManagerPwd;

    systemNavConfig.requireUserApproval = nextRequireApproval;
    systemNavConfig.buildingManagerPassword = nextManagerPwd;
    syncAdminGateStatusBadgeUI(nextRequireApproval);

    try {
        localStorage.setItem('yingge_system_nav_config_v31', JSON.stringify(systemNavConfig));
    } catch (e) {}

    const origText = saveBtn ? saveBtn.textContent : '儲存門禁設定';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '同步中...';
    }
    try {
        await fetchWithTimeout(SYSTEM_CONFIG_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...systemNavConfig,
                updatedAt: Date.now()
            })
        }, 5000);
        if (saveBtn) {
            saveBtn.textContent = '✓ 已同步';
            setTimeout(() => {
                saveBtn.disabled = false;
                saveBtn.textContent = origText;
            }, 1000);
        }
        fetchAndRenderAdminFleetUsersList();
    } catch (e) {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = origText;
        }
        alert('⚠️ 儲存門禁設定失敗，請檢查網路連線！');
    }
}

document.getElementById('adminRequireUserApprovalInput')?.addEventListener('change', () => {
    saveAdminUserGateSettingsToCloud();
});

document.getElementById('btnSaveUserGateSettings')?.addEventListener('click', (e) => {
    e.stopPropagation();
    saveAdminUserGateSettingsToCloud();
});

document.getElementById('btnRefreshFleetUsers')?.addEventListener('click', (e) => {
    e.stopPropagation();
    fetchAndRenderAdminFleetUsersList();
});

async function fetchAndRenderAdminFleetUsersList() {
    if (isFetchingAdminFleetUsers) return;
    isFetchingAdminFleetUsers = true;
    const listContainer = document.getElementById('adminUsersListContainer');
    const countSummaryEl = document.getElementById('adminUsersCountSummary');
    const pendingBadgeEl = document.getElementById('adminUsersPendingBadge');

    try {
        // 同時讀取 fleet_users 與 live_fleet，將目前有在雷達上的裝置也自動納管合併
        const [usersRes, liveRes] = await Promise.all([
            fetchWithTimeout(FLEET_USERS_ALL_URL, { cache: 'no-store' }, 5000).catch(() => null),
            fetchWithTimeout(LIVE_FLEET_ALL_URL, { cache: 'no-store' }, 5000).catch(() => null)
        ]);

        const rawUsers = (usersRes && usersRes.ok) ? (await usersRes.json() || {}) : {};
        const rawLive = (liveRes && liveRes.ok) ? (await liveRes.json() || {}) : {};
        const now = Date.now();

        const mergedMap = {};
        if (rawUsers && typeof rawUsers === 'object') {
            Object.entries(rawUsers).forEach(([devId, u]) => {
                if (!devId || !u || typeof u !== 'object') return;
                mergedMap[devId] = {
                    deviceId: devId,
                    displayName: String(u.displayName || '未命名隊員').trim(),
                    originalName: String(u.originalName || '').trim(),
                    isApproved: u.isApproved !== false,
                    isBlocked: Boolean(u.isBlocked),
                    canManageBuildings: Boolean(u.canManageBuildings),
                    lastActiveAt: Number(u.lastActiveAt || u.createdAt || 0),
                    createdAt: Number(u.createdAt || 0)
                };
            });
        }

        // 若 live_fleet 中有尚未寫入 fleet_users 的線上裝置，自動合併並回寫至 fleet_users
        if (rawLive && typeof rawLive === 'object') {
            Object.entries(rawLive).forEach(([devId, liveInfo]) => {
                if (!devId || !liveInfo || typeof liveInfo !== 'object') return;
                const liveTs = Number(liveInfo.updatedAt || 0);
                const liveName = String(liveInfo.name || '隊員').trim();
                if (mergedMap[devId]) {
                    if (liveTs > mergedMap[devId].lastActiveAt) {
                        mergedMap[devId].lastActiveAt = liveTs;
                    }
                    if (liveName && (!mergedMap[devId].displayName || mergedMap[devId].displayName === '未命名隊員')) {
                        mergedMap[devId].displayName = liveName;
                    }
                } else {
                    mergedMap[devId] = {
                        deviceId: devId,
                        displayName: liveName || '車隊隊員',
                        originalName: '',
                        isApproved: true,
                        isBlocked: false,
                        canManageBuildings: false,
                        lastActiveAt: liveTs || now,
                        createdAt: liveTs || now
                    };
                    fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(devId)}.json`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            displayName: liveName || '車隊隊員',
                            isApproved: true,
                            isBlocked: false,
                            lastActiveAt: liveTs || now
                        })
                    }, 4000).catch(() => {});
                }
            });
        }

        allCloudFleetUsersMap = mergedMap;
        if (fleetDeviceId && mergedMap[fleetDeviceId]) {
            myCloudUserProfile = mergedMap[fleetDeviceId];
        }

        const userList = Object.values(mergedMap);
        // 判斷「🟢 上線中 / ⚪ 離線」：距離最後心跳 <= 45 秒且未封鎖視為上線中
        const ONLINE_HEARTBEAT_MS = 45 * 1000;
        let onlineCount = 0;
        let pendingCount = 0;

        userList.forEach(u => {
            u.isOnline = !u.isBlocked && (now - Number(u.lastActiveAt || 0) <= ONLINE_HEARTBEAT_MS);
            if (u.isOnline) onlineCount++;
            if (!u.isApproved && !u.isBlocked) pendingCount++;
        });

        // 排序：1. 待核准優先 ➔ 2. 上線中優先 ➔ 3. 最後活躍時間由新到舊
        userList.sort((a, b) => {
            const aPending = (!a.isApproved && !a.isBlocked) ? 1 : 0;
            const bPending = (!b.isApproved && !b.isBlocked) ? 1 : 0;
            if (aPending !== bPending) return bPending - aPending;
            if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
            return (b.lastActiveAt || 0) - (a.lastActiveAt || 0);
        });

        if (countSummaryEl) {
            countSummaryEl.textContent = `(共 ${userList.length} 人・🟢 上線 ${onlineCount}${pendingCount > 0 ? `・⏳ 待核准 ${pendingCount}` : ''})`;
        }
        if (pendingBadgeEl) {
            if (pendingCount > 0) {
                pendingBadgeEl.textContent = String(pendingCount);
                pendingBadgeEl.classList.remove('hidden');
            } else {
                pendingBadgeEl.classList.add('hidden');
            }
        }

        if (!listContainer) return;
        listContainer.innerHTML = '';

        if (userList.length === 0) {
            listContainer.innerHTML = `
                <div class="bg-white border border-slate-200 rounded-2xl p-6 text-center text-xs font-bold text-slate-400">
                    目前尚無車隊裝置連線紀錄
                </div>
            `;
            return;
        }

        userList.forEach(user => {
            const isSelf = (user.deviceId === fleetDeviceId);
            const isPending = !user.isApproved && !user.isBlocked;

            const card = document.createElement('div');
            card.className = user.isBlocked
                ? 'bg-rose-50/80 border-2 border-rose-300 rounded-2xl p-3 space-y-2.5 shadow-sm'
                : isPending
                    ? 'bg-amber-50/90 border-2 border-amber-400 rounded-2xl p-3 space-y-2.5 shadow-sm'
                    : 'bg-white border border-slate-200 rounded-2xl p-3 space-y-2.5 shadow-sm';

            // 計算最後活躍時間文字（不顯示任何裝置 ID 亂碼！）
            const elapsedSec = Math.max(0, Math.floor((now - Number(user.lastActiveAt || 0)) / 1000));
            let activeTimeLabel = '剛剛活躍';
            if (!user.lastActiveAt) {
                activeTimeLabel = '尚無心跳';
            } else if (elapsedSec < 45) {
                activeTimeLabel = '即時在線';
            } else if (elapsedSec < 3600) {
                activeTimeLabel = `${Math.max(1, Math.floor(elapsedSec / 60))} 分鐘前`;
            } else if (elapsedSec < 86400) {
                activeTimeLabel = `${Math.floor(elapsedSec / 3600)} 小時前`;
            } else {
                activeTimeLabel = `${Math.floor(elapsedSec / 86400)} 天前`;
            }

            // 頂部資訊列：上線燈號 + 使用者自取顯示名稱 + 開發者單向原名標註（絕不顯示裝置 ID 亂碼）
            const topRow = document.createElement('div');
            topRow.className = 'flex items-start justify-between gap-2';

            const nameWrap = document.createElement('div');
            nameWrap.className = 'min-w-0 flex-1';

            const statusDotHtml = user.isOnline
                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">🟢 上線中</span>`
                : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">⚪ 離線 (${activeTimeLabel})</span>`;

            const selfBadgeHtml = isSelf
                ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-indigo-100 text-indigo-800">本機</span>`
                : '';

            const origNameBadgeHtml = user.originalName
                ? `<div class="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-100/90 border border-amber-300 text-amber-950 text-[11px] font-black">
                       <i class="fa-solid fa-tag text-amber-600 text-[10px]"></i>
                       <span>原名：${escapeHtmlSafe(user.originalName)}</span>
                   </div>`
                : `<div class="mt-1 text-[10px] font-bold text-slate-400">尚未標註原名（點右方「✏️ 標註／改原名」單向備註）</div>`;

            nameWrap.innerHTML = `
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-sm font-black text-slate-900 truncate">${escapeHtmlSafe(user.displayName || '隊員')}</span>
                    ${selfBadgeHtml}
                    ${statusDotHtml}
                </div>
                ${origNameBadgeHtml}
            `;

            // 右上角狀態徽章
            const stateBadge = document.createElement('div');
            stateBadge.className = 'flex flex-col items-end gap-1 flex-shrink-0';
            if (user.isBlocked) {
                stateBadge.innerHTML = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white">🚫 已封鎖鎖定</span>`;
            } else if (isPending) {
                stateBadge.innerHTML = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-white animate-pulse">⏳ 待核准申請</span>`;
            } else {
                stateBadge.innerHTML = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">✓ 准許使用</span>`;
            }

            topRow.appendChild(nameWrap);
            topRow.appendChild(stateBadge);
            card.appendChild(topRow);

            // 中間開關列：1. 准許使用／封鎖開關  2. 社區標註授權開關
            const togglesGrid = document.createElement('div');
            togglesGrid.className = 'grid grid-cols-2 gap-2 pt-1 border-t border-slate-100';

            // 控制項 A：准許使用／封鎖開關
            const accessToggleBox = document.createElement('div');
            accessToggleBox.className = 'bg-slate-50 border border-slate-200 rounded-xl p-2 flex items-center justify-between gap-1.5';
            const isAllowedActive = user.isApproved && !user.isBlocked;
            accessToggleBox.innerHTML = `
                <div class="min-w-0">
                    <div class="text-[11px] font-black text-slate-800">准許使用／封鎖</div>
                    <div class="text-[10px] font-bold ${user.isBlocked ? 'text-rose-600' : isPending ? 'text-amber-600' : 'text-emerald-600'}">
                        ${user.isBlocked ? '已封鎖(鎖定畫面)' : isPending ? '待核准放行' : '正常授權使用'}
                    </div>
                </div>
            `;
            const accessBtn = document.createElement('button');
            accessBtn.type = 'button';
            if (isPending) {
                accessBtn.className = 'bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black px-2.5 py-1.5 rounded-lg shadow active:scale-95 whitespace-nowrap';
                accessBtn.textContent = '✓ 核准';
            } else if (user.isBlocked) {
                accessBtn.className = 'bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-black px-2.5 py-1.5 rounded-lg shadow active:scale-95 whitespace-nowrap';
                accessBtn.textContent = '解除封鎖';
            } else {
                accessBtn.className = 'bg-rose-100 hover:bg-rose-200 text-rose-700 border border-rose-300 text-[11px] font-black px-2.5 py-1.5 rounded-lg active:scale-95 whitespace-nowrap';
                accessBtn.textContent = '🚫 封鎖';
            }
            accessBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                accessBtn.disabled = true;
                if (isPending || user.isBlocked) {
                    // 核准或解除封鎖 -> 准許使用
                    await updateCloudFleetUserFields(user.deviceId, {
                        isApproved: true,
                        isBlocked: false
                    });
                } else {
                    // 封鎖此裝置 -> 即時鎖定對方畫面並清除其 live_fleet 雷達節點
                    if (isSelf && !confirm('⚠️ 這是您目前操作的本機裝置，確定要測試封鎖嗎？')) {
                        accessBtn.disabled = false;
                        return;
                    }
                    await updateCloudFleetUserFields(user.deviceId, {
                        isBlocked: true
                    });
                    // 立即同步刪除該裝置在 live_fleet 的廣播節點
                    fetchWithTimeout(`${LIVE_FLEET_BASE_URL}/${encodeURIComponent(user.deviceId)}.json`, {
                        method: 'DELETE'
                    }, 4000).catch(() => {});
                }
                await fetchAndRenderAdminFleetUsersList();
            });
            accessToggleBox.appendChild(accessBtn);

            // 控制項 B：社區標註授權開關
            const bldgToggleBox = document.createElement('label');
            bldgToggleBox.className = 'bg-slate-50 border border-slate-200 rounded-xl p-2 flex items-center justify-between gap-1.5 cursor-pointer';
            bldgToggleBox.innerHTML = `
                <div class="min-w-0">
                    <div class="text-[11px] font-black text-slate-800">🏢 社區標註授權</div>
                    <div class="text-[10px] font-bold ${user.canManageBuildings ? 'text-orange-600' : 'text-slate-400'}">
                        ${user.canManageBuildings ? '可新增/改/刪社區' : '一般唯讀'}
                    </div>
                </div>
            `;
            const bldgCheckbox = document.createElement('input');
            bldgCheckbox.type = 'checkbox';
            bldgCheckbox.checked = Boolean(user.canManageBuildings);
            bldgCheckbox.className = 'w-5 h-5 accent-orange-600 rounded cursor-pointer flex-shrink-0';
            bldgCheckbox.addEventListener('change', async (e) => {
                e.stopPropagation();
                bldgCheckbox.disabled = true;
                await updateCloudFleetUserFields(user.deviceId, {
                    canManageBuildings: Boolean(bldgCheckbox.checked)
                });
                await fetchAndRenderAdminFleetUsersList();
            });
            bldgToggleBox.appendChild(bldgCheckbox);

            togglesGrid.appendChild(accessToggleBox);
            togglesGrid.appendChild(bldgToggleBox);
            card.appendChild(togglesGrid);

            // 底部動作按鈕列：✏️ 標註／改原名（單向，僅開發者可見與可改） ＋ 🗑️ 刪除紀錄
            const bottomActions = document.createElement('div');
            bottomActions.className = 'flex items-center justify-between gap-2 pt-1';

            const editOrigNameBtn = document.createElement('button');
            editOrigNameBtn.type = 'button';
            editOrigNameBtn.className = 'flex-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-black py-1.5 px-2.5 rounded-xl text-[11px] active:scale-95 transition flex items-center justify-center gap-1';
            editOrigNameBtn.innerHTML = '<span>✏️ 標註／改原名</span>';
            editOrigNameBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const currentOrig = user.originalName || '';
                const inputVal = prompt(
                    `✏️ 單向標註「${user.displayName}」的真實原名：\n（僅開發者可見，絕不覆蓋對方自己取的顯示名稱；對方後續改暱稱時仍會保留此原名對照）`,
                    currentOrig || user.displayName
                );
                if (inputVal === null) return;
                const cleanOrig = inputVal.trim();
                await updateCloudFleetUserFields(user.deviceId, {
                    originalName: cleanOrig
                });
                await fetchAndRenderAdminFleetUsersList();
            });

            const deleteRecordBtn = document.createElement('button');
            deleteRecordBtn.type = 'button';
            deleteRecordBtn.className = 'bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-black py-1.5 px-3 rounded-xl text-[11px] active:scale-95 transition flex items-center justify-center gap-1';
            deleteRecordBtn.innerHTML = '<span>🗑️ 刪除紀錄</span>';
            deleteRecordBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const label = user.originalName ? `${user.displayName}（原名：${user.originalName}）` : user.displayName;
                if (!confirm(`確定要刪除「${label}」的使用者紀錄嗎？`)) return;
                deleteRecordBtn.disabled = true;
                try {
                    await Promise.all([
                        fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(user.deviceId)}.json`, { method: 'DELETE' }, 4500).catch(() => {}),
                        fetchWithTimeout(`${LIVE_FLEET_BASE_URL}/${encodeURIComponent(user.deviceId)}.json`, { method: 'DELETE' }, 4500).catch(() => {})
                    ]);
                } finally {
                    await fetchAndRenderAdminFleetUsersList();
                }
            });

            bottomActions.appendChild(editOrigNameBtn);
            bottomActions.appendChild(deleteRecordBtn);
            card.appendChild(bottomActions);

            listContainer.appendChild(card);
        });
    } finally {
        isFetchingAdminFleetUsers = false;
    }
}

function escapeHtmlSafe(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function updateCloudFleetUserFields(targetDeviceId, patchFields) {
    if (!targetDeviceId || !patchFields || typeof patchFields !== 'object') return;
    try {
        await fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(targetDeviceId)}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...patchFields,
                updatedByAdminAt: Date.now()
            })
        }, 5000);
        if (targetDeviceId === fleetDeviceId) {
            await checkMyFleetUserAccessStatus();
        }
    } catch (e) {
        alert('⚠️ 更新使用者權限失敗，請檢查網路狀態！');
    }
}

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
            method: 'PUT',
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
    [noteInput, keyInput, document.getElementById('adminAnnouncementInput'), document.getElementById('adminBuildingManagerPwdInput')].forEach(inp => {
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

    // 同步「👥 管理使用者」書籤頁中的全站門禁開關與管理者密碼
    setChecked('adminRequireUserApprovalInput', c.requireUserApproval);
    setVal('adminBuildingManagerPwdInput', c.buildingManagerPassword || '666666');
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
        requireUserApproval: getChecked('adminRequireUserApprovalInput'),
        buildingManagerPassword: (getVal('adminBuildingManagerPwdInput') || '666666').trim()
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
        await fetchWithTimeout(SYSTEM_CONFIG_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }, 5000);

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

// ==========================================
// 🚀 【終極防誤關 App】攔截手機實體返回鍵
// ==========================================
(function setupAndroidBackButton() {
    // 1. 監聽實體返回鍵動作
    window.addEventListener('popstate', (e) => {
        const blackOverlay = document.getElementById('blackOverlay');
        const historyModal = document.getElementById('historyModal');
        const cloudRoutesModal = document.getElementById('cloudRoutesModal');
        const routeDetailUI = document.getElementById('routeDetailUI');
        const settingsModal = document.getElementById('settingsModal');
        const editStopModal = document.getElementById('editStopModal');
        const editAlertModal = document.getElementById('editAlertModal');
        const viewAlertModal = document.getElementById('viewAlertModal');
        const photoLightboxModal = document.getElementById('photoLightboxModal');
        const uploadConflictModal = document.getElementById('uploadConflictModal');
        const longPressPinTypeModal = document.getElementById('longPressPinTypeModal');
        const createBuildingPinModal = document.getElementById('createBuildingPinModal');
        const createMapPinModal = document.getElementById('createMapPinModal');
        const viewMapPinModal = document.getElementById('viewMapPinModal');
        const quickNavAlertModal = document.getElementById('quickNavAlertModal');
        const manualDrawUI = document.getElementById('manualDrawUI');
        const adminSettingsModal = document.getElementById('adminSettingsModal');
        const adminPasswordModal = document.getElementById('adminPasswordModal');
        const aiDispatchModal = document.getElementById('aiDispatchModal');

        // 依序檢查目前是哪個畫面在最上層，就模擬點擊它的「關閉/返回」按鈕
        if (aiDispatchModal && !aiDispatchModal.classList.contains('hidden')) {
            aiDispatchModal.classList.add('hidden');
        }
        else if (adminSettingsModal && !adminSettingsModal.classList.contains('hidden')) {
            adminSettingsModal.classList.add('hidden');
        }
        else if (adminPasswordModal && !adminPasswordModal.classList.contains('hidden')) {
            adminPasswordModal.classList.add('hidden');
        }
        else if (blackOverlay && !blackOverlay.classList.contains('hidden')) {
            exitBlackPowerSaveMode(false);
        }
        else if (photoLightboxModal && !photoLightboxModal.classList.contains('hidden')) {
            document.getElementById('closePhotoLightboxBtn').click();
        }
        else if (quickNavAlertModal && !quickNavAlertModal.classList.contains('hidden')) {
            document.getElementById('btnCancelQuickNavAlert').click();
        }
        else if (uploadConflictModal && !uploadConflictModal.classList.contains('hidden')) {
            document.getElementById('btnConflictCancel').click();
        }
        else if (viewMapPinModal && !viewMapPinModal.classList.contains('hidden')) {
            document.getElementById('btnCloseViewMapPin').click();
        }
        else if (createBuildingPinModal && !createBuildingPinModal.classList.contains('hidden')) {
            document.getElementById('btnCancelBuildingPin').click();
        }
        else if (createMapPinModal && !createMapPinModal.classList.contains('hidden')) {
            document.getElementById('btnCancelCreateMapPin').click();
        }
        else if (longPressPinTypeModal && !longPressPinTypeModal.classList.contains('hidden')) {
            document.getElementById('btnCancelLongPressPinType').click();
        }
        else if (viewAlertModal && !viewAlertModal.classList.contains('hidden')) {
            document.getElementById('btnCloseViewAlert').click();
        }
        else if (editAlertModal && !editAlertModal.classList.contains('hidden')) {
            document.getElementById('btnCancelAlertEdit').click();
        }
        else if (editStopModal && !editStopModal.classList.contains('hidden')) {
            document.getElementById('btnCancelStopEdit').click();
        }
        else if (cloudRoutesModal && !cloudRoutesModal.classList.contains('hidden')) {
            document.getElementById('closeCloudModalBtn').click();
        }
        else if (settingsModal && !settingsModal.classList.contains('hidden')) {
            document.getElementById('closeSettings').click();
        }
        else if (manualDrawUI && !manualDrawUI.classList.contains('hidden')) {
            document.getElementById('btnManualCancel').click();
        }
        else if (routeDetailUI && !routeDetailUI.classList.contains('hidden')) {
            document.getElementById('topBackBtn').click();
        }
        else if (historyModal && !historyModal.classList.contains('hidden')) {
            document.getElementById('closeHistory').click();
        }
    });

    function pushFakeHistory() {
        window.history.pushState({ pwa: true }, '');
    }

    const hBtn = document.getElementById('historyBtn');
    if (hBtn) hBtn.addEventListener('click', pushFakeHistory);

    const sBtn = document.getElementById('settingsBtn');
    if (sBtn) sBtn.addEventListener('click', pushFakeHistory);

    const cBtn = document.getElementById('openCloudModalBtn');
    if (cBtn) cBtn.addEventListener('click', pushFakeHistory);

    const bBtn = document.getElementById('blackScreenBtn');
    if (bBtn) bBtn.addEventListener('click', pushFakeHistory);

    if (typeof window.openRouteDetail === 'function') {
        const originalOpenRouteDetail = window.openRouteDetail;
        window.openRouteDetail = function(idx) {
            pushFakeHistory();
            originalOpenRouteDetail(idx);
        };
    }
})();

// ==========================================
// 🛋️ 11. 家具模式（單一共用作業空間 ＋ ✨ Gemini AI 智慧批次派工插針 ＋ 🔥 純木頭垃圾車支援火紅標記系統 v3.27）
// - 徹底移除所有「第 1/2/3 組」分組邏輯與文案，改為全隊單一共用作業空間
// - Firebase 路徑簡化為：furniture_collab/{YYYY-MM-DD}/active
// - 按下右下角「🗑️ 清空」時，提示訊息顯示為：「🗑️ 已清空家具定位針與路線」
// - 畫面頂部搜尋列右側配備「✨ AI 派工」按鈕，結合全隊已標註之「🏢 社區大樓（橘色水滴）」精確經緯度、OSM Nominatim 門牌定位與純木頭火紅標記自動批次插針
// ==========================================
let isFurnitureModeActive = false;
window.isFurnitureModeActive = false;

function getTodayDateString() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

let currentFurnitureDateStr = getTodayDateString();

// 單一共用家具作業空間資料結構
let furnitureActiveData = {
    pins: [],
    routeCoords: [],
    distanceKm: '0.00',
    updatedAt: 0,
    author: ''
};

let isLocalFurnitureDirty = false;
let furnitureDomMarkers = [];
let activeFurniturePopupMarker = null;
let furnitureSearchPreviewMarker = null;
let lastSelectedSearchCandidate = null;
let furnitureSearchDebounceTimer = null;
let furnitureToastTimer = null;

// 手動拉線串聯狀態
let isFurnitureManualConnecting = false;
let furnitureManualTargetPinIdx = 1;
let furnitureManualConnectedCoords = [];
let furnitureManualSegmentDraft = [];
let isFurnitureDrawingStroke = false;

// 左上角火紅提醒輪播索引
let woodSupportAlertCycleIdx = 0;

// 記錄切換進家具模式前的一般收運介面與路線圖層快照，以便切回時 100% 完整還原
let normalModeRestoreSnapshot = null;

function getLocalFurnitureStorageKey(dateStr = currentFurnitureDateStr) {
    return `yingge_furniture_active_${dateStr}`;
}

function saveLocalFurnitureBackup() {
    try {
        localStorage.setItem(
            getLocalFurnitureStorageKey(currentFurnitureDateStr),
            JSON.stringify(furnitureActiveData)
        );
    } catch (e) {}
}

function loadLocalFurnitureBackup() {
    try {
        const raw = localStorage.getItem(getLocalFurnitureStorageKey(currentFurnitureDateStr));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return normalizeFurniturePayload(parsed);
        }
    } catch (e) {}
    return null;
}

function normalizeFurniturePayload(raw) {
    const pins = Array.isArray(raw?.pins)
        ? raw.pins
            .filter(p => p && !isNaN(Number(p.lng)) && !isNaN(Number(p.lat)))
            .map((p, idx) => ({
                id: String(p.id || `fpin_${Date.now()}_${idx}`),
                lng: Number(Number(p.lng).toFixed(6)),
                lat: Number(Number(p.lat).toFixed(6)),
                label: String(p.label || `家具點位 #${idx + 1}`),
                note: String(p.note || ''),
                needsWoodTruckSupport: Boolean(p.needsWoodTruckSupport),
                collected: Boolean(p.collected),
                updatedAt: Number(p.updatedAt) || Date.now()
            }))
        : [];

    const routeCoords = Array.isArray(raw?.routeCoords)
        ? raw.routeCoords
            .filter(c => Array.isArray(c) && c.length >= 2 && !isNaN(Number(c[0])) && !isNaN(Number(c[1])))
            .map(c => [Number(Number(c[0]).toFixed(6)), Number(Number(c[1]).toFixed(6))])
        : [];

    let distKm = 0;
    for (let i = 1; i < routeCoords.length; i++) {
        distKm += getDistanceKm(routeCoords[i - 1][0], routeCoords[i - 1][1], routeCoords[i][0], routeCoords[i][1]);
    }

    return {
        pins,
        routeCoords,
        distanceKm: distKm.toFixed(2),
        updatedAt: Number(raw?.updatedAt) || 0,
        author: String(raw?.author || '')
    };
}

function computeCoordsDistanceKm(coords) {
    if (!Array.isArray(coords) || coords.length < 2) return '0.00';
    let km = 0;
    for (let i = 1; i < coords.length; i++) {
        km += getDistanceKm(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    }
    return km.toFixed(2);
}

// 顯示家具模式輕量快顯膠囊（如「🗑️ 已清空家具定位針與路線」）
function showFurnitureToast(message, durationMs = 2400) {
    const toastEl = document.getElementById('furnitureToastBanner');
    if (!toastEl) return;
    if (furnitureToastTimer) {
        clearTimeout(furnitureToastTimer);
        furnitureToastTimer = null;
    }
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    furnitureToastTimer = setTimeout(() => {
        toastEl.classList.add('hidden');
        furnitureToastTimer = null;
    }, durationMs);
}

function setFurniturePrompt(text) {
    if (text) {
        showFurnitureToast(text, 2400);
    }
}

function clearFurnitureDomMarkers() {
    closeFurniturePinPopup();
    furnitureDomMarkers.forEach(m => {
        try { m.remove(); } catch (e) {}
    });
    furnitureDomMarkers = [];
}

function closeFurniturePinPopup() {
    if (activeFurniturePopupMarker) {
        try { activeFurniturePopupMarker.remove(); } catch (e) {}
        activeFurniturePopupMarker = null;
    }
}

function clearFurnitureSearchPreviewMarker() {
    if (furnitureSearchPreviewMarker) {
        try { furnitureSearchPreviewMarker.remove(); } catch (e) {}
        furnitureSearchPreviewMarker = null;
    }
}

// 收集當日所有未處理的「🔥 需垃圾車支援（純木頭）」點位
function getActiveWoodSupportPinsList() {
    const list = [];
    if (!furnitureActiveData || !Array.isArray(furnitureActiveData.pins)) return list;
    furnitureActiveData.pins.forEach((pin, idx) => {
        if (pin && pin.needsWoodTruckSupport && !pin.collected) {
            list.push({
                pinIndex: idx,
                pinNumber: idx + 1,
                pin
            });
        }
    });
    return list;
}

// 更新螢幕左上角「🔥 需垃圾車支援：N 處」火紅色提醒徽章（無論在一般收運模式或家具模式皆即時提醒支援垃圾車司機！）
function updateWoodSupportTopLeftAlertUI() {
    const alertBtn = document.getElementById('furnitureWoodSupportAlertBtn');
    const titleEl = document.getElementById('furnitureWoodSupportAlertText');
    const subEl = document.getElementById('furnitureWoodSupportSubText');
    if (!alertBtn || !titleEl) return;

    const supportList = getActiveWoodSupportPinsList();
    if (supportList.length === 0) {
        alertBtn.classList.add('hidden');
        return;
    }

    alertBtn.classList.remove('hidden');
    titleEl.textContent = `需垃圾車支援：${supportList.length} 處`;
    const previewItem = supportList[woodSupportAlertCycleIdx % supportList.length];
    if (subEl && previewItem) {
        const shortAddr = (previewItem.pin.label || '').replace(/^新北市鶯歌區/, '').slice(0, 12);
        subEl.textContent = `#${previewItem.pinNumber} ${shortAddr || '純木頭'} · 點擊飛往`;
    }
}

// 點擊左上角火紅色提醒徽章：依序飛往各個「🔥 需垃圾車支援（純木頭）」點位並自動打開操作卡片
document.getElementById('furnitureWoodSupportAlertBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const supportList = getActiveWoodSupportPinsList();
    if (supportList.length === 0) return;

    const target = supportList[woodSupportAlertCycleIdx % supportList.length];
    woodSupportAlertCycleIdx = (woodSupportAlertCycleIdx + 1) % supportList.length;
    updateWoodSupportTopLeftAlertUI();

    setCameraFollow(false);
    map.flyTo({
        center: [target.pin.lng, target.pin.lat],
        zoom: Math.max(map.getZoom(), 17.5),
        duration: 650
    });

    renderAllFurnitureMapElements();
    setTimeout(() => {
        openFurniturePinActionPopup(target.pinIndex);
    }, 300);
});

// 更新家具模式左下角插針統計小膠囊（📍 0 支針 ｜ 0.00 km）與各邊角按鈕啟用狀態
function updateFurniturePanelUI() {
    const pinsCount = Array.isArray(furnitureActiveData.pins) ? furnitureActiveData.pins.length : 0;
    const hasConnectedRoute = Array.isArray(furnitureActiveData.routeCoords) && furnitureActiveData.routeCoords.length >= 2;
    furnitureActiveData.distanceKm = computeCoordsDistanceKm(furnitureActiveData.routeCoords);

    const pinCountBadge = document.getElementById('furniturePinCountBadge');
    const distBadge = document.getElementById('furnitureRouteDistBadge');
    if (pinCountBadge) pinCountBadge.textContent = `📍 ${pinsCount} 支針`;
    if (distBadge) distBadge.textContent = `${furnitureActiveData.distanceKm} km`;

    const undoBtn = document.getElementById('btnFurnitureUndoPin');
    const clearBtn = document.getElementById('btnFurnitureClearPins');
    const autoOsrmBtn = document.getElementById('btnFurnitureAutoOsrmConnect');
    const manualConnectBtn = document.getElementById('btnFurnitureManualConnect');
    const manualConnectText = document.getElementById('furnitureManualConnectBtnText');
    const routeNavBar = document.getElementById('furnitureRouteNavBar');

    if (undoBtn) undoBtn.disabled = (pinsCount === 0);
    if (clearBtn) clearBtn.disabled = (pinsCount === 0 && furnitureActiveData.routeCoords.length === 0);
    if (autoOsrmBtn) autoOsrmBtn.disabled = (pinsCount < 1);
    if (manualConnectBtn) {
        manualConnectBtn.disabled = (pinsCount < 2);
        if (isFurnitureManualConnecting) {
            manualConnectBtn.className = 'bg-amber-500/95 hover:bg-amber-600 backdrop-blur text-white font-black py-2.5 px-3.5 rounded-2xl text-xs shadow-lg border border-amber-200 active:scale-95 transition-all flex items-center gap-1.5 ring-2 ring-amber-300 whitespace-nowrap';
            if (manualConnectText) manualConnectText.textContent = `✅ 完成手拉 (#${Math.min(furnitureManualTargetPinIdx + 1, pinsCount)})`;
        } else {
            manualConnectBtn.className = 'bg-orange-600/95 hover:bg-orange-700 backdrop-blur text-white font-extrabold py-2.5 px-3.5 rounded-2xl text-xs shadow-lg border border-orange-300/80 active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-45 whitespace-nowrap';
            if (manualConnectText) manualConnectText.textContent = '✍️ 手動拉線串';
        }
    }

    // 二、家具路線串接完成後，動態顯示「🧭 循跡導航」與「▶️ 路線播放」兩顆按鈕
    if (routeNavBar) {
        if (hasConnectedRoute && !isFurnitureManualConnecting) {
            routeNavBar.classList.remove('hidden');
        } else {
            routeNavBar.classList.add('hidden');
        }
    }

    updateWoodSupportTopLeftAlertUI();
}

// 當長按 0.5 秒拖曳既有家具插針放開後，若已有串接好的路線，自動依目前插針順序重新更新 OSRM 順向靠右路線
async function refreshFurnitureRouteAfterPinDragged() {
    if (!Array.isArray(furnitureActiveData.routeCoords) || furnitureActiveData.routeCoords.length < 2) return;
    if (!Array.isArray(furnitureActiveData.pins) || furnitureActiveData.pins.length < 1) return;

    try {
        const origin = await resolveVehicleOriginForFurnitureOsrm();
        const waypoints = [];
        const p0 = furnitureActiveData.pins[0];
        const distOriginToFirstM = getDistanceKm(origin.lng, origin.lat, p0.lng, p0.lat) * 1000;
        if (distOriginToFirstM >= 12) {
            waypoints.push({ lng: origin.lng, lat: origin.lat, isOrigin: true });
        }
        furnitureActiveData.pins.forEach(p => {
            waypoints.push({ lng: p.lng, lat: p.lat, isOrigin: false });
        });

        if (waypoints.length >= 2) {
            const updatedCoords = await fetchOsrmMultiWaypointRoute(waypoints, origin.heading);
            if (Array.isArray(updatedCoords) && updatedCoords.length >= 2) {
                furnitureActiveData.routeCoords = updatedCoords;
                furnitureActiveData.distanceKm = computeCoordsDistanceKm(updatedCoords);
                furnitureActiveData.updatedAt = Date.now();
                isLocalFurnitureDirty = true;
                saveLocalFurnitureBackup();
                renderAllFurnitureMapElements();
                syncActiveFurnitureToFirebase(false);
            }
        }
    } catch (e) {}
}

// 渲染地圖上的家具路線圖層與所有定位針
function renderAllFurnitureMapElements() {
    if (!map) return;
    ensureCustomRouteSourcesAndLayers();

    clearFurnitureDomMarkers();

    if (!isFurnitureModeActive) {
        cachedFurnitureOwnRouteGeoJSON = emptyGeoJSON();
        cachedFurnitureManualDraftGeoJSON = emptyGeoJSON();
        try {
            map.getSource('furniture-own-route-source')?.setData(cachedFurnitureOwnRouteGeoJSON);
            map.getSource('furniture-manual-draft-source')?.setData(cachedFurnitureManualDraftGeoJSON);
        } catch (e) {}

        // 在一般收運模式下，仍把當日「未處理的火紅純木頭支援點」顯示在地圖上，方便垃圾車司機邊收運邊支援
        const activeSupportPins = getActiveWoodSupportPinsList();
        activeSupportPins.forEach(item => {
            createFurniturePinDomMarker(item.pin, item.pinIndex);
        });
        updateWoodSupportTopLeftAlertUI();
        return;
    }

    // 1. 建構共用家具路線 GeoJSON Feature
    const ownFeatures = [];
    if (Array.isArray(furnitureActiveData.routeCoords) && furnitureActiveData.routeCoords.length >= 2) {
        ownFeatures.push({
            type: 'Feature',
            properties: {
                color: '#7c3aed'
            },
            geometry: {
                type: 'LineString',
                coordinates: furnitureActiveData.routeCoords
            }
        });
    }
    cachedFurnitureOwnRouteGeoJSON = { type: 'FeatureCollection', features: ownFeatures };

    // 2. 手動拉線串聯草稿圖層
    const draftCoords = isFurnitureManualConnecting && furnitureManualSegmentDraft.length >= 2
        ? furnitureManualSegmentDraft
        : [];
    cachedFurnitureManualDraftGeoJSON = draftCoords.length >= 2
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: draftCoords } }] }
        : emptyGeoJSON();

    try {
        map.getSource('furniture-own-route-source')?.setData(cachedFurnitureOwnRouteGeoJSON);
        map.getSource('furniture-manual-draft-source')?.setData(cachedFurnitureManualDraftGeoJSON);
    } catch (e) {}

    // 3. 渲染所有家具定位針（預設鎖定防誤拉，長按 0.5 秒才解鎖拖曳）
    if (Array.isArray(furnitureActiveData.pins)) {
        furnitureActiveData.pins.forEach((pin, idx) => {
            createFurniturePinDomMarker(pin, idx);
        });
    }

    updateFurniturePanelUI();
}

function createFurniturePinDomMarker(pin, pinIdx) {
    const isUrgentWood = Boolean(pin.needsWoodTruckSupport && !pin.collected);
    const isCollected = Boolean(pin.collected);
    const pinNumber = pinIdx + 1;

    // 外層 wrapper 嚴禁設 CSS transform
    const wrapperEl = document.createElement('div');
    wrapperEl.className = `furniture-pin-wrapper ${isUrgentWood ? 'is-wood-support' : ''}`;

    const pillEl = document.createElement('div');
    pillEl.className = `furniture-pin-pill ${isUrgentWood ? 'is-wood-support' : ''} ${isCollected ? 'is-collected' : ''}`;

    let statusPrefix = '';
    if (isUrgentWood) statusPrefix = '🔥 ';
    else if (isCollected) statusPrefix = '✅ ';

    const shortLabel = (pin.label || '').replace(/^新北市鶯歌區/, '').trim();
    const displayAddr = shortLabel && !shortLabel.startsWith('點位') && !shortLabel.startsWith('家具點位')
        ? ` · ${Array.from(shortLabel).slice(0, 7).join('')}`
        : '';

    pillEl.innerHTML = `
        <span>${statusPrefix}#${pinNumber}</span>
        ${isUrgentWood ? '<span class="bg-yellow-300 text-red-900 text-[9px] font-black px-1 py-0.2 rounded">純木頭支援</span>' : (displayAddr ? `<span class="text-[10px] opacity-95">${displayAddr}</span>` : '')}
    `;

    const arrowEl = document.createElement('div');
    arrowEl.className = `furniture-pin-arrow ${isUrgentWood ? 'is-wood-support' : ''}`;

    wrapperEl.appendChild(pillEl);
    wrapperEl.appendChild(arrowEl);

    // 預設鎖定位置不可直接拖曳（draggable: false），防止瀏覽地圖時誤拉動
    const marker = new maplibregl.Marker({
        element: wrapperEl,
        anchor: 'bottom',
        offset: [0, -4],
        draggable: false,
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport'
    })
        .setLngLat([Number(pin.lng), Number(pin.lat)])
        .addTo(map);

    let suppressNextClick = false;
    let pinHoldTimer = null;
    let isPinDragUnlocked = false;
    let hasPinMovedAfterUnlock = false;
    let holdStartX = 0;
    let holdStartY = 0;

    function clearPinHoldTimer() {
        if (pinHoldTimer !== null) {
            clearTimeout(pinHoldTimer);
            pinHoldTimer = null;
        }
    }

    function unlockPinDrag() {
        pinHoldTimer = null;
        if (!isFurnitureModeActive || isFurnitureManualConnecting) return;
        isPinDragUnlocked = true;
        hasPinMovedAfterUnlock = false;
        suppressNextClick = true;
        closeFurniturePinPopup();
        wrapperEl.classList.add('is-drag-unlocked');
        pillEl.classList.add('is-drag-unlocked');
        try { map.dragPan.disable(); } catch (e) {}
        try { navigator.vibrate?.(45); } catch (e) {}
        showFurnitureToast(`🔓 已解鎖 #${pinNumber} 號針拖曳，滑動移至新位置後放開`);
    }

    function moveUnlockedPinToClientXY(clientX, clientY) {
        if (!isPinDragUnlocked) return;
        const canvasContainer = map.getCanvasContainer();
        const rect = canvasContainer.getBoundingClientRect();
        const lngLat = map.unproject([clientX - rect.left, clientY - rect.top]);
        if (lngLat && !isNaN(lngLat.lng) && !isNaN(lngLat.lat)) {
            hasPinMovedAfterUnlock = true;
            marker.setLngLat([lngLat.lng, lngLat.lat]);
        }
    }

    function finishPinHoldOrDrag() {
        clearPinHoldTimer();
        if (!isPinDragUnlocked) return;
        isPinDragUnlocked = false;
        wrapperEl.classList.remove('is-drag-unlocked');
        pillEl.classList.remove('is-drag-unlocked');
        try { map.dragPan.enable(); } catch (e) {}

        const pos = marker.getLngLat();
        const newLng = Number(pos.lng.toFixed(6));
        const newLat = Number(pos.lat.toFixed(6));
        const movedMeters = getDistanceKm(pin.lng, pin.lat, newLng, newLat) * 1000;

        if (hasPinMovedAfterUnlock && movedMeters >= 0.5) {
            pin.lng = newLng;
            pin.lat = newLat;
            pin.updatedAt = Date.now();
            furnitureActiveData.updatedAt = Date.now();
            isLocalFurnitureDirty = true;
            saveLocalFurnitureBackup();
            try { navigator.vibrate?.(30); } catch (e) {}
            renderAllFurnitureMapElements();
            syncActiveFurnitureToFirebase(false);
            showFurnitureToast(`📍 已更新 #${pinNumber} 號針位置並重新鎖定`);

            // 若已有串聯路線，同步自動更新路線
            if (Array.isArray(furnitureActiveData.routeCoords) && furnitureActiveData.routeCoords.length >= 2) {
                refreshFurnitureRouteAfterPinDragged();
            }
        } else {
            showFurnitureToast(`🔒 #${pinNumber} 號針已重新鎖定`);
        }

        setTimeout(() => {
            suppressNextClick = false;
        }, 120);
    }

    // 觸控長按 0.5 秒（500ms）解鎖拖曳
    wrapperEl.addEventListener('touchstart', (ev) => {
        if (!isFurnitureModeActive || isFurnitureManualConnecting) return;
        if (!ev.touches || ev.touches.length !== 1) {
            clearPinHoldTimer();
            return;
        }
        const touch = ev.touches[0];
        holdStartX = touch.clientX;
        holdStartY = touch.clientY;
        clearPinHoldTimer();
        pinHoldTimer = setTimeout(() => {
            unlockPinDrag();
        }, 500);
    }, { passive: true });

    wrapperEl.addEventListener('touchmove', (ev) => {
        if (!ev.touches || ev.touches.length !== 1) {
            clearPinHoldTimer();
            return;
        }
        const touch = ev.touches[0];
        if (isPinDragUnlocked) {
            if (ev.cancelable) ev.preventDefault();
            ev.stopPropagation();
            moveUnlockedPinToClientXY(touch.clientX, touch.clientY);
            return;
        }
        if (pinHoldTimer !== null) {
            const dist = Math.hypot(touch.clientX - holdStartX, touch.clientY - holdStartY);
            if (dist >= 10) {
                clearPinHoldTimer();
            }
        }
    }, { passive: false });

    wrapperEl.addEventListener('touchend', () => {
        finishPinHoldOrDrag();
    }, { passive: true });

    wrapperEl.addEventListener('touchcancel', () => {
        finishPinHoldOrDrag();
    }, { passive: true });

    // 滑鼠左鍵長按 0.5 秒（500ms）解鎖拖曳
    wrapperEl.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0 || !isFurnitureModeActive || isFurnitureManualConnecting) return;
        holdStartX = ev.clientX;
        holdStartY = ev.clientY;
        clearPinHoldTimer();

        const onWindowMouseMove = (moveEv) => {
            if (isPinDragUnlocked) {
                moveEv.preventDefault();
                moveUnlockedPinToClientXY(moveEv.clientX, moveEv.clientY);
                return;
            }
            if (pinHoldTimer !== null) {
                const dist = Math.hypot(moveEv.clientX - holdStartX, moveEv.clientY - holdStartY);
                if (dist >= 10) {
                    clearPinHoldTimer();
                }
            }
        };

        const onWindowMouseUp = () => {
            window.removeEventListener('mousemove', onWindowMouseMove);
            window.removeEventListener('mouseup', onWindowMouseUp);
            finishPinHoldOrDrag();
        };

        window.addEventListener('mousemove', onWindowMouseMove);
        window.addEventListener('mouseup', onWindowMouseUp);

        pinHoldTimer = setTimeout(() => {
            unlockPinDrag();
        }, 500);
    });

    wrapperEl.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (suppressNextClick) {
            suppressNextClick = false;
            return;
        }
        if (isFurnitureModeActive && isFurnitureManualConnecting) {
            handleManualConnectSnapToPin(pinIdx);
            return;
        }
        openFurniturePinActionPopup(pinIdx);
    });

    furnitureDomMarkers.push(marker);
    return marker;
}

// 點擊定位針彈出簡潔操作卡片：可切換「🔥 需垃圾車支援（純木頭）」或「✅ 已收運／解除支援」並即時同步 Firebase
function openFurniturePinActionPopup(pinIdx) {
    closeFurniturePinPopup();
    const pin = furnitureActiveData?.pins?.[pinIdx];
    if (!pin) return;

    const isUrgentWood = Boolean(pin.needsWoodTruckSupport && !pin.collected);
    const pinNumber = pinIdx + 1;

    const wrapper = document.createElement('div');
    wrapper.className = 'furniture-popup-wrapper';
    wrapper.addEventListener('click', (e) => e.stopPropagation());
    wrapper.addEventListener('pointerdown', (e) => e.stopPropagation());

    const card = document.createElement('div');
    card.className = `furniture-popup-card ${isUrgentWood ? 'is-wood-support' : ''}`;

    const headerRow = document.createElement('div');
    headerRow.className = 'flex items-center justify-between gap-2 pb-1.5 border-b border-gray-100';
    headerRow.innerHTML = `
        <div class="flex items-center gap-1.5 min-w-0">
            <span class="bg-violet-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap">家具點位 #${pinNumber}</span>
            ${isUrgentWood ? '<span class="bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full whitespace-nowrap">🔥 待垃圾車支援</span>' : (pin.collected ? '<span class="bg-emerald-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full whitespace-nowrap">✅ 已收運</span>' : '')}
        </div>
    `;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'w-5 h-5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 text-[11px] font-black flex items-center justify-center';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => closeFurniturePinPopup();
    headerRow.appendChild(closeBtn);
    card.appendChild(headerRow);

    const addrDiv = document.createElement('div');
    addrDiv.className = 'text-xs font-extrabold text-gray-800 mt-1.5 break-words leading-snug';
    addrDiv.textContent = pin.label || `大型家具點位 #${pinNumber}`;
    card.appendChild(addrDiv);

    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.value = pin.note || '';
    noteInput.placeholder = '備註（如：純木衣櫃3件、巷口電線桿旁）...';
    noteInput.className = 'mt-1.5 w-full bg-gray-50 border border-gray-200 focus:border-amber-500 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-800 outline-none';
    noteInput.addEventListener('change', async () => {
        pin.note = noteInput.value.trim();
        pin.updatedAt = Date.now();
        saveLocalFurnitureBackup();
        await syncActiveFurnitureToFirebase(false);
    });
    card.appendChild(noteInput);

    const actionsCol = document.createElement('div');
    actionsCol.className = 'flex flex-col gap-1.5 mt-2.5 pt-2 border-t border-gray-100';

    // 按鈕 1：🔥 需垃圾車支援（純木頭）
    const woodBtn = document.createElement('button');
    woodBtn.type = 'button';
    if (isUrgentWood) {
        woodBtn.className = 'w-full bg-red-100 hover:bg-red-200 text-red-800 border-2 border-red-500 font-black py-2 px-2.5 rounded-xl text-xs active:scale-95 transition-all flex items-center justify-center gap-1';
        woodBtn.innerHTML = '<span>🔥 已標記需垃圾車支援（點擊取消）</span>';
    } else {
        woodBtn.className = 'w-full bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white font-black py-2 px-2.5 rounded-xl text-xs shadow-md active:scale-95 transition-all flex items-center justify-center gap-1';
        woodBtn.innerHTML = '<span>🔥 需垃圾車支援（純木頭）</span>';
    }
    woodBtn.onclick = async () => {
        pin.note = noteInput.value.trim();
        if (isUrgentWood) {
            pin.needsWoodTruckSupport = false;
        } else {
            pin.needsWoodTruckSupport = true;
            pin.collected = false;
        }
        pin.updatedAt = Date.now();
        vibrate([35, 25, 35]);
        closeFurniturePinPopup();
        saveLocalFurnitureBackup();
        renderAllFurnitureMapElements();
        await syncActiveFurnitureToFirebase(true);
    };
    actionsCol.appendChild(woodBtn);

    // 按鈕 2：✅ 已收運／解除支援
    const collectedBtn = document.createElement('button');
    collectedBtn.type = 'button';
    collectedBtn.className = 'w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2 px-2.5 rounded-xl text-xs shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1';
    collectedBtn.innerHTML = isUrgentWood
        ? '<span>✅ 垃圾車已收運／解除火紅支援</span>'
        : (pin.collected ? '<span>↩️ 恢復為待收運狀態</span>' : '<span>✅ 標記已收運完成</span>');
    collectedBtn.onclick = async () => {
        pin.note = noteInput.value.trim();
        if (isUrgentWood) {
            pin.needsWoodTruckSupport = false;
            pin.collected = true;
        } else {
            pin.collected = !pin.collected;
            if (pin.collected) pin.needsWoodTruckSupport = false;
        }
        pin.updatedAt = Date.now();
        vibrate(30);
        closeFurniturePinPopup();
        saveLocalFurnitureBackup();
        renderAllFurnitureMapElements();
        await syncActiveFurnitureToFirebase(true);
    };
    actionsCol.appendChild(collectedBtn);

    // 底部列：Google 導航 ＋ 刪除此針
    const bottomRow = document.createElement('div');
    bottomRow.className = 'flex items-center gap-1.5 mt-0.5';

    const gNavBtn = document.createElement('button');
    gNavBtn.type = 'button';
    gNavBtn.className = 'flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-extrabold py-1.5 px-2 rounded-xl text-[11px] active:scale-95 flex items-center justify-center gap-1';
    gNavBtn.innerHTML = '<span>🧭 Google 導航</span>';
    gNavBtn.onclick = () => {
        const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}&travelmode=driving`;
        window.location.href = navUrl;
    };
    bottomRow.appendChild(gNavBtn);

    if (isFurnitureModeActive) {
        const delPinBtn = document.createElement('button');
        delPinBtn.type = 'button';
        delPinBtn.className = 'bg-gray-100 hover:bg-red-50 text-red-600 border border-gray-200 font-extrabold py-1.5 px-2.5 rounded-xl text-[11px] active:scale-95 flex items-center justify-center gap-1';
        delPinBtn.innerHTML = '<span>🗑️ 刪針</span>';
        delPinBtn.onclick = () => {
            furnitureActiveData.pins.splice(pinIdx, 1);
            if (furnitureActiveData.pins.length < 2) {
                furnitureActiveData.routeCoords = [];
                furnitureActiveData.distanceKm = '0.00';
            }
            isLocalFurnitureDirty = true;
            closeFurniturePinPopup();
            saveLocalFurnitureBackup();
            renderAllFurnitureMapElements();
            syncActiveFurnitureToFirebase(false);
        };
        bottomRow.appendChild(delPinBtn);
    }

    actionsCol.appendChild(bottomRow);
    card.appendChild(actionsCol);

    const arrow = document.createElement('div');
    arrow.className = 'alert-popup-arrow';
    wrapper.appendChild(card);
    wrapper.appendChild(arrow);

    activeFurniturePopupMarker = new maplibregl.Marker({
        element: wrapper,
        anchor: 'bottom',
        offset: [0, -34],
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport'
    })
        .setLngLat([Number(pin.lng), Number(pin.lat)])
        .addTo(map);
}

// 新增定位針至家具作業空間
function addFurniturePinToWorkspace(lng, lat, labelText = '', options = {}) {
    const cleanLng = Number(Number(lng).toFixed(6));
    const cleanLat = Number(Number(lat).toFixed(6));
    const nextNum = furnitureActiveData.pins.length + 1;

    furnitureActiveData.pins.push({
        id: `fpin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        lng: cleanLng,
        lat: cleanLat,
        label: labelText ? String(labelText).trim() : `家具點位 #${nextNum}`,
        note: options.note ? String(options.note).trim() : '',
        needsWoodTruckSupport: Boolean(options.needsWoodTruckSupport),
        collected: false,
        updatedAt: Date.now()
    });
    furnitureActiveData.updatedAt = Date.now();
    isLocalFurnitureDirty = true;
    saveLocalFurnitureBackup();
    if (!options.silent) {
        vibrate(40);
        renderAllFurnitureMapElements();
        syncActiveFurnitureToFirebase(false);
    }
}

// 家具模式下輕點地圖：取消單擊直接插針（防誤觸），僅在「手動拉線串」模式下保留點擊加點／吸附目標針
function handleFurnitureMapClick(e) {
    if (!isFurnitureModeActive || !e?.lngLat) return;
    if (isFurnitureManualConnecting) {
        const clickLng = Number(e.lngLat.lng.toFixed(6));
        const clickLat = Number(e.lngLat.lat.toFixed(6));
        handleFurnitureManualClickPoint(clickLng, clickLat);
    }
}

// 一、家具模式「長按地圖 0.5 秒（500ms）才插針」（移動距離 < 10px，防滑動或縮放地圖時誤插針）
(function setupFurnitureMapLongPressToPin() {
    const FURNITURE_HOLD_MS = 500;
    let mapHoldTimer = null;
    let startX = 0;
    let startY = 0;
    let holdLngLat = null;
    const canvasContainer = map.getCanvasContainer();

    function clearMapHoldTimer() {
        if (mapHoldTimer !== null) {
            clearTimeout(mapHoldTimer);
            mapHoldTimer = null;
        }
        holdLngLat = null;
    }

    function isPinOrPopupTarget(targetEl) {
        if (!targetEl || !targetEl.closest) return false;
        return Boolean(
            targetEl.closest('.furniture-pin-wrapper, .furniture-popup-wrapper, .shared-pin-wrapper, .fleet-truck-marker, .music-marker, .alert-compact-pin, .alert-popup-wrapper')
        );
    }

    canvasContainer.addEventListener('touchstart', (e) => {
        clearMapHoldTimer();
        if (!isFurnitureModeActive || isFurnitureManualConnecting || window.isFurnitureNavOrReplayActive) return;
        if (!e.touches || e.touches.length !== 1) return;
        if (isPinOrPopupTarget(e.target)) return;

        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        const rect = canvasContainer.getBoundingClientRect();
        holdLngLat = map.unproject([touch.clientX - rect.left, touch.clientY - rect.top]);

        mapHoldTimer = setTimeout(() => {
            mapHoldTimer = null;
            if (!isFurnitureModeActive || isFurnitureManualConnecting || window.isFurnitureNavOrReplayActive || !holdLngLat) return;
            const pinLng = Number(holdLngLat.lng.toFixed(6));
            const pinLat = Number(holdLngLat.lat.toFixed(6));
            closeFurniturePinPopup();
            try { navigator.vibrate?.(40); } catch (err) {}
            addFurniturePinToWorkspace(pinLng, pinLat, '');
            showFurnitureToast(`📍 已長按新增家具插針 #${furnitureActiveData.pins.length}`);
        }, FURNITURE_HOLD_MS);
    }, { passive: true });

    canvasContainer.addEventListener('touchmove', (e) => {
        if (mapHoldTimer === null) return;
        if (!e.touches || e.touches.length !== 1) {
            clearMapHoldTimer();
            return;
        }
        const touch = e.touches[0];
        if (Math.hypot(touch.clientX - startX, touch.clientY - startY) >= 10) {
            clearMapHoldTimer();
        }
    }, { passive: true });

    canvasContainer.addEventListener('touchend', clearMapHoldTimer, { passive: true });
    canvasContainer.addEventListener('touchcancel', clearMapHoldTimer, { passive: true });

    canvasContainer.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        clearMapHoldTimer();
        if (!isFurnitureModeActive || isFurnitureManualConnecting || window.isFurnitureNavOrReplayActive) return;
        if (isPinOrPopupTarget(e.target)) return;

        startX = e.clientX;
        startY = e.clientY;
        const rect = canvasContainer.getBoundingClientRect();
        holdLngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);

        mapHoldTimer = setTimeout(() => {
            mapHoldTimer = null;
            if (!isFurnitureModeActive || isFurnitureManualConnecting || window.isFurnitureNavOrReplayActive || !holdLngLat) return;
            const pinLng = Number(holdLngLat.lng.toFixed(6));
            const pinLat = Number(holdLngLat.lat.toFixed(6));
            closeFurniturePinPopup();
            try { navigator.vibrate?.(40); } catch (err) {}
            addFurniturePinToWorkspace(pinLng, pinLat, '');
            showFurnitureToast(`📍 已長按新增家具插針 #${furnitureActiveData.pins.length}`);
        }, FURNITURE_HOLD_MS);
    });

    canvasContainer.addEventListener('mousemove', (e) => {
        if (mapHoldTimer === null) return;
        if (Math.hypot(e.clientX - startX, e.clientY - startY) >= 10) {
            clearMapHoldTimer();
        }
    });

    canvasContainer.addEventListener('mouseup', clearMapHoldTimer);

    ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart', 'wheel'].forEach(evtName => {
        map.on(evtName, clearMapHoldTimer);
    });
})();

// ==========================================
// 🔍 免費 OSM Nominatim 地址／地標搜尋（400ms Debounce，優先偏向新北市鶯歌區範圍）
// ==========================================
const YINGGE_VIEWBOX = '121.30,24.99,121.39,24.92';

async function searchYinggeAddressNominatim(rawQuery) {
    const q = String(rawQuery || '').trim();
    if (!q) return [];

    const hasDistrictKeyword = /鶯歌|三峽|樹林|桃園|八德|新北/.test(q);
    const primaryQuery = hasDistrictKeyword ? q : `新北市鶯歌區 ${q}`;
    const urlPrimary = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=tw&limit=5&viewbox=${YINGGE_VIEWBOX}&bounded=0&q=${encodeURIComponent(primaryQuery)}`;

    try {
        const res = await fetchWithTimeout(urlPrimary, {
            headers: { 'Accept-Language': 'zh-TW,zh;q=0.9' }
        }, 4500);
        if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list) && list.length > 0) {
                return list;
            }
        }
    } catch (e) {}

    if (!hasDistrictKeyword) {
        try {
            const urlFallback = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=tw&limit=5&viewbox=${YINGGE_VIEWBOX}&bounded=0&q=${encodeURIComponent(q)}`;
            const res2 = await fetchWithTimeout(urlFallback, {
                headers: { 'Accept-Language': 'zh-TW,zh;q=0.9' }
            }, 4500);
            if (res2.ok) {
                const list2 = await res2.json();
                if (Array.isArray(list2)) return list2;
            }
        } catch (e) {}
    }
    return [];
}

function formatNominatimDisplayTitle(item) {
    if (!item) return '未知地點';
    const addr = item.address || {};
    const road = addr.road || addr.pedestrian || addr.suburb || addr.neighbourhood || '';
    const houseNum = addr.house_number || '';
    const amenity = item.name || addr.amenity || addr.building || addr.shop || '';
    const district = addr.city_district || addr.town || addr.county || '';
    let built = `${district}${road}${houseNum}`;
    if (amenity && !built.includes(amenity)) {
        built = built ? `${amenity}（${built}）` : amenity;
    }
    if (!built) {
        built = String(item.display_name || '').split(',').slice(0, 3).join(' ');
    }
    return built.trim();
}

function showFurnitureSearchPreviewPin(lng, lat, label) {
    clearFurnitureSearchPreviewMarker();
    const el = document.createElement('div');
    el.className = 'furniture-pin-wrapper';
    el.innerHTML = `
        <div class="bg-amber-500 text-white text-xs font-black px-3 py-1 rounded-full shadow-xl border-2 border-white flex items-center gap-1">
            <span>🔍 ${Array.from(label).slice(0, 12).join('')}</span>
        </div>
        <div class="furniture-pin-arrow"></div>
    `;
    furnitureSearchPreviewMarker = new maplibregl.Marker({
        element: el,
        anchor: 'bottom',
        offset: [0, -4],
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport'
    })
        .setLngLat([lng, lat])
        .addTo(map);
}

(function setupFurnitureAddressSearchUI() {
    const inputEl = document.getElementById('furnitureAddressSearchInput');
    const clearBtn = document.getElementById('btnClearFurnitureSearch');
    const resultsPanel = document.getElementById('furnitureSearchResultsPanel');
    const quickPinBtn = document.getElementById('btnQuickDropSearchPin');
    if (!inputEl || !resultsPanel) return;

    function renderSearchResults(items, queryText) {
        resultsPanel.innerHTML = '';
        if (!Array.isArray(items) || items.length === 0) {
            resultsPanel.innerHTML = `
                <div class="p-3 text-xs font-bold text-gray-500 text-center">
                    找不到「${queryText}」相關地址，可直接移動地圖點擊插針
                </div>
            `;
            resultsPanel.classList.remove('hidden');
            return;
        }

        items.forEach(item => {
            const lng = Number(parseFloat(item.lon).toFixed(6));
            const lat = Number(parseFloat(item.lat).toFixed(6));
            if (isNaN(lng) || isNaN(lat)) return;
            const title = formatNominatimDisplayTitle(item);
            const fullSub = String(item.display_name || '');

            const row = document.createElement('div');
            row.className = 'p-2.5 hover:bg-amber-50 flex items-center justify-between gap-2 cursor-pointer transition-colors';
            row.innerHTML = `
                <div class="min-w-0 flex-1">
                    <div class="text-xs font-black text-gray-900 truncate">📍 ${title}</div>
                    <div class="text-[10px] font-bold text-gray-400 truncate">${fullSub}</div>
                </div>
                <button type="button" class="bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-black px-2.5 py-1.5 rounded-xl shadow-sm active:scale-95 whitespace-nowrap flex-shrink-0">
                    📍 插針
                </button>
            `;

            row.addEventListener('click', (e) => {
                e.stopPropagation();
                lastSelectedSearchCandidate = { lng, lat, label: title };
                inputEl.value = title;
                resultsPanel.classList.add('hidden');
                quickPinBtn?.classList.remove('hidden');
                setCameraFollow(false);
                map.flyTo({ center: [lng, lat], zoom: 18, duration: 550 });
                showFurnitureSearchPreviewPin(lng, lat, title);
                showFurnitureToast(`🔍 已定位至「${title}」，點右側「📍 插針」加入`);
            });

            const directPinBtn = row.querySelector('button');
            directPinBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                resultsPanel.classList.add('hidden');
                clearFurnitureSearchPreviewMarker();
                quickPinBtn?.classList.add('hidden');
                inputEl.value = '';
                clearBtn?.classList.add('hidden');
                setCameraFollow(false);
                map.flyTo({ center: [lng, lat], zoom: 17.5, duration: 500 });
                addFurniturePinToWorkspace(lng, lat, title);
            });

            resultsPanel.appendChild(row);
        });

        resultsPanel.classList.remove('hidden');
    }

    inputEl.addEventListener('input', () => {
        const val = inputEl.value.trim();
        if (val.length > 0) {
            clearBtn?.classList.remove('hidden');
        } else {
            clearBtn?.classList.add('hidden');
            resultsPanel.classList.add('hidden');
            quickPinBtn?.classList.add('hidden');
            clearFurnitureSearchPreviewMarker();
            return;
        }

        if (furnitureSearchDebounceTimer) {
            clearTimeout(furnitureSearchDebounceTimer);
        }
        furnitureSearchDebounceTimer = setTimeout(async () => {
            const q = inputEl.value.trim();
            if (q.length < 2) return;
            resultsPanel.innerHTML = `<div class="p-3 text-xs font-bold text-amber-700 text-center"><i class="fa-solid fa-spinner fa-spin mr-1"></i> 正在搜尋鶯歌地址「${q}」...</div>`;
            resultsPanel.classList.remove('hidden');
            const results = await searchYinggeAddressNominatim(q);
            if (inputEl.value.trim() !== q) return;
            renderSearchResults(results, q);
        }, 400);
    });

    clearBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        inputEl.value = '';
        clearBtn.classList.add('hidden');
        resultsPanel.classList.add('hidden');
        quickPinBtn?.classList.add('hidden');
        lastSelectedSearchCandidate = null;
        clearFurnitureSearchPreviewMarker();
    });

    quickPinBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!lastSelectedSearchCandidate) return;
        const { lng, lat, label } = lastSelectedSearchCandidate;
        clearFurnitureSearchPreviewMarker();
        quickPinBtn.classList.add('hidden');
        inputEl.value = '';
        clearBtn?.classList.add('hidden');
        lastSelectedSearchCandidate = null;
        addFurniturePinToWorkspace(lng, lat, label);
    });

    document.addEventListener('pointerdown', (e) => {
        if (resultsPanel.classList.contains('hidden')) return;
        if (!resultsPanel.contains(e.target) && e.target !== inputEl) {
            resultsPanel.classList.add('hidden');
        }
    });
})();

// ==========================================
// 🤖 串聯方式 1：自動沿路串（OSRM 以目前車輛即時 GPS 位置與車頭方向角為起點，強制靠右順向停靠＋禁止原地 U 型迴轉）
// ==========================================
function getCurrentValidVehicleHeading() {
    if (typeof lastRealGpsHeading === 'number' && !isNaN(lastRealGpsHeading) && lastRealGpsHeading >= 0 && lastRealGpsHeading <= 360 && lastValidGpsTime > 0) {
        return normalizeValidHeadingDeg(lastRealGpsHeading);
    }
    if (typeof currentHeading === 'number' && !isNaN(currentHeading) && currentHeading >= 0 && currentHeading <= 360) {
        return normalizeValidHeadingDeg(currentHeading);
    }
    return null;
}

async function resolveVehicleOriginForFurnitureOsrm() {
    // 1. 優先使用目前已取得的即時有效 GPS 座標與車頭方向角
    if (typeof lastValidGpsLng === 'number' && typeof lastValidGpsLat === 'number' && !isNaN(lastValidGpsLng) && !isNaN(lastValidGpsLat)) {
        return {
            lng: Number(lastValidGpsLng.toFixed(6)),
            lat: Number(lastValidGpsLat.toFixed(6)),
            heading: getCurrentValidVehicleHeading(),
            source: 'gps'
        };
    }

    // 2. 嘗試即時向瀏覽器請求一次最新 GPS 座標（2.2 秒超時防卡死）
    if ('geolocation' in navigator) {
        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    maximumAge: 15000,
                    timeout: 2200
                });
            });
            if (pos && pos.coords && typeof pos.coords.longitude === 'number' && typeof pos.coords.latitude === 'number') {
                const lng = Number(pos.coords.longitude.toFixed(6));
                const lat = Number(pos.coords.latitude.toFixed(6));
                const hwHeading = (typeof pos.coords.heading === 'number' && !isNaN(pos.coords.heading) && pos.coords.heading >= 0 && pos.coords.heading <= 360)
                    ? normalizeValidHeadingDeg(pos.coords.heading)
                    : getCurrentValidVehicleHeading();
                lastValidGpsLng = lng;
                lastValidGpsLat = lat;
                lastKnownLngLat = [lng, lat];
                if (hwHeading !== null) {
                    lastRealGpsHeading = hwHeading;
                    currentHeading = hwHeading;
                }
                if (vehicleMarker) {
                    try { vehicleMarker.setLngLat([lng, lat]); } catch (e) {}
                }
                return { lng, lat, heading: hwHeading, source: 'gps' };
            }
        } catch (e) {}
    }

    // 3. 若無即時 GPS 定位，退回使用目前車輛圖示位置 / 地圖中心點或第一支針座標
    if (Array.isArray(lastKnownLngLat) && lastKnownLngLat.length === 2 && typeof lastKnownLngLat[0] === 'number' && typeof lastKnownLngLat[1] === 'number') {
        return {
            lng: Number(lastKnownLngLat[0].toFixed(6)),
            lat: Number(lastKnownLngLat[1].toFixed(6)),
            heading: getCurrentValidVehicleHeading(),
            source: 'vehicle_marker'
        };
    }
    if (map && typeof map.getCenter === 'function') {
        const c = map.getCenter();
        if (c && typeof c.lng === 'number' && typeof c.lat === 'number') {
            return { lng: Number(c.lng.toFixed(6)), lat: Number(c.lat.toFixed(6)), heading: null, source: 'map_center' };
        }
    }
    const p0 = furnitureActiveData.pins[0];
    return { lng: Number(p0.lng.toFixed(6)), lat: Number(p0.lat.toFixed(6)), heading: null, source: 'first_pin' };
}

// 兩階段多途經點 OSRM 順向靠右規劃：
// - 第一階段：先以無限制距離（不帶 curb 與 continue_straight）重排 #1～#N 順路順序並計算無限制基準距離
// - 第二階段：以排好順序套用 continue_straight=true 與 approaches=unrestricted;curb;curb... 實現台灣右側靠停，並設有死胡同距離暴增（超過 1.35 倍）自動放寬 curb 的保底機制
async function fetchOsrmMultiWaypointRoute(waypoints, originHeading = null) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
        return waypoints.map(w => [w.lng, w.lat]);
    }

    const coordStr = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
    const validHeading = normalizeValidHeadingDeg(originHeading);
    // 第 1 個點帶入 ${Math.round(heading)},45，其餘插針點全部留空（例如 bearings=180,45;;...）
    const bearingsParam = validHeading !== null
        ? `&bearings=${[`${validHeading},45`, ...waypoints.slice(1).map(() => '')].join(';')}`
        : '';

    // 先取得第一階段無限制基準路线與距離（不帶 curb 與 continue_straight），作為死胡同距離暴增 1.35 倍比較基準與保底路線
    const unrestrictedUrl = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    let baselineUnrestrictedCoords = null;
    let baselineUnrestrictedDistM = 0;
    try {
        const baseRes = await fetchWithTimeout(unrestrictedUrl, {}, 6000);
        if (baseRes.ok) {
            const baseData = await baseRes.json();
            const r0 = baseData?.routes?.[0];
            if (baseData?.code === 'Ok' && Array.isArray(r0?.geometry?.coordinates) && r0.geometry.coordinates.length >= 2) {
                baselineUnrestrictedCoords = r0.geometry.coordinates;
                baselineUnrestrictedDistM = Number(r0.distance) || (computeCoordsDistanceKm(baselineUnrestrictedCoords) * 1000);
            }
        }
    } catch (e) {}

    // 第二階段：套用 continue_straight=true 與 approaches=unrestricted;curb;curb...（以及全 curb）實現台灣右側順向靠停
    const originUnrestrictedApproaches = ['unrestricted', ...waypoints.slice(1).map(() => 'curb')].join(';');
    const allCurbApproaches = waypoints.map(() => 'curb').join(';');
    const stage2CurbUrls = [
        `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&continue_straight=true&approaches=${originUnrestrictedApproaches}${bearingsParam}`,
        `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&continue_straight=true&approaches=${allCurbApproaches}${bearingsParam}`,
        `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&continue_straight=true&approaches=${originUnrestrictedApproaches}`
    ];

    for (const osrmUrl of stage2CurbUrls) {
        try {
            const res = await fetchWithTimeout(osrmUrl, {}, 6500);
            if (!res.ok) continue;
            const data = await res.json();
            const routeObj = data?.routes?.[0];
            const coords = routeObj?.geometry?.coordinates;
            if (data?.code === 'Ok' && Array.isArray(coords) && coords.length >= 2) {
                const curbDistM = Number(routeObj.distance) || (computeCoordsDistanceKm(coords) * 1000);
                // 死胡同距離暴增保底機制：若套用 curb 後總距離超過無限制基準距離的 1.35 倍（且多繞超過 250m），代表遇到死巷或單向封閉強迫大繞遠路，自動放寬 curb
                if (
                    baselineUnrestrictedDistM > 50 &&
                    curbDistM > baselineUnrestrictedDistM * 1.35 &&
                    (curbDistM - baselineUnrestrictedDistM) > 250
                ) {
                    continue;
                }
                return densifyRoadCoordinates(coords, 8);
            }
        } catch (e) {}
    }

    // 保底放寬機制：若死胡同導致 curb 距離暴增超過 1.35 倍，優先退回僅帶 continue_straight=true（放寬 curb）或第一階段無限制順路路線
    try {
        const relaxedCurbUrl = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&continue_straight=true`;
        const res = await fetchWithTimeout(relaxedCurbUrl, {}, 6000);
        if (res.ok) {
            const data = await res.json();
            const r0 = data?.routes?.[0];
            const coords = r0?.geometry?.coordinates;
            if (data?.code === 'Ok' && Array.isArray(coords) && coords.length >= 2) {
                const relaxedDistM = Number(r0.distance) || (computeCoordsDistanceKm(coords) * 1000);
                if (!baselineUnrestrictedDistM || relaxedDistM <= baselineUnrestrictedDistM * 1.35) {
                    return densifyRoadCoordinates(coords, 8);
                }
            }
        }
    } catch (e) {}

    if (baselineUnrestrictedCoords && baselineUnrestrictedCoords.length >= 2) {
        return densifyRoadCoordinates(baselineUnrestrictedCoords, 8);
    }

    // 最終分段備援
    const combinedCoords = [[waypoints[0].lng, waypoints[0].lat]];
    let rollingHeading = validHeading;
    for (let i = 0; i < waypoints.length - 1; i++) {
        const pA = waypoints[i];
        const pB = waypoints[i + 1];
        const { coords, endHeading } = await fetchOsrmRoadGeometry(pA.lng, pA.lat, pB.lng, pB.lat, {
            startHeading: rollingHeading,
            originUnrestricted: (i === 0)
        });
        if (typeof endHeading === 'number' && !isNaN(endHeading)) {
            rollingHeading = endHeading;
        }
        const densified = densifyRoadCoordinates(coords, 8);
        for (let k = 1; k < densified.length; k++) {
            combinedCoords.push(densified[k]);
        }
    }
    return combinedCoords;
}

let isFurnitureOsrmBusy = false;
document.getElementById('btnFurnitureAutoOsrmConnect')?.addEventListener('click', async () => {
    if (isFurnitureOsrmBusy) return;
    if (!Array.isArray(furnitureActiveData.pins) || furnitureActiveData.pins.length < 1) return;

    if (isFurnitureManualConnecting) {
        stopFurnitureManualConnectMode(false);
    }

    isFurnitureOsrmBusy = true;
    const btn = document.getElementById('btnFurnitureAutoOsrmConnect');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>沿路串聯中...</span>';
    }
    showFurnitureToast('🤖 第一階段順路排序中，第二階段套用台灣靠右順向停靠...');

    try {
        const origin = await resolveVehicleOriginForFurnitureOsrm();

        // 【第一階段】：使用無限制純距離（不帶 curb、continue_straight 或方位角懲罰）重排 #1～#N 順路順序並更新號碼牌，避免最左與最右兩端點位跨區折返
        const remainingPins = [...furnitureActiveData.pins];
        const orderedPins = [];
        let curLng = origin.lng;
        let curLat = origin.lat;

        // 嘗試先向 OSRM table API 取得無限制純路網距離矩陣（若超時則以純直線距離最近鄰＋2-opt 順路優化）
        while (remainingPins.length > 0) {
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let i = 0; i < remainingPins.length; i++) {
                const dKm = getDistanceKm(curLng, curLat, remainingPins[i].lng, remainingPins[i].lat);
                if (dKm < bestDist) {
                    bestDist = dKm;
                    bestIdx = i;
                }
            }
            const nextPin = remainingPins.splice(bestIdx, 1)[0];
            orderedPins.push(nextPin);
            curLng = nextPin.lng;
            curLat = nextPin.lat;
        }

        // 針對排好的 orderedPins 進行無限制距離 2-opt 順路消除交叉折返（確保不會從最左跨區跳到最右再折返）
        if (orderedPins.length >= 3) {
            const getPtDist = (aLng, aLat, bLng, bLat) => getDistanceKm(aLng, aLat, bLng, bLat);
            let improved = true;
            let pass = 0;
            while (improved && pass < 12) {
                improved = false;
                pass++;
                for (let i = 0; i < orderedPins.length - 1; i++) {
                    const prevLng = (i === 0) ? origin.lng : orderedPins[i - 1].lng;
                    const prevLat = (i === 0) ? origin.lat : orderedPins[i - 1].lat;
                    for (let k = i + 1; k < orderedPins.length; k++) {
                        const nextAfterK = (k + 1 < orderedPins.length) ? orderedPins[k + 1] : null;
                        const currEdgeDist =
                            getPtDist(prevLng, prevLat, orderedPins[i].lng, orderedPins[i].lat) +
                            (nextAfterK ? getPtDist(orderedPins[k].lng, orderedPins[k].lat, nextAfterK.lng, nextAfterK.lat) : 0);
                        const swappedEdgeDist =
                            getPtDist(prevLng, prevLat, orderedPins[k].lng, orderedPins[k].lat) +
                            (nextAfterK ? getPtDist(orderedPins[i].lng, orderedPins[i].lat, nextAfterK.lng, nextAfterK.lat) : 0);
                        if (swappedEdgeDist + 0.002 < currEdgeDist) {
                            const reversedSeg = orderedPins.slice(i, k + 1).reverse();
                            orderedPins.splice(i, k - i + 1, ...reversedSeg);
                            improved = true;
                        }
                    }
                }
            }
        }

        // 更新 #1～#N 號碼牌順序
        furnitureActiveData.pins = orderedPins;
        renderAllFurnitureMapElements();

        // 【第二階段】：以第一階段排好的 #1～#N 順路順序，套用 continue_straight=true 與 approaches=unrestricted;curb;curb...（含 1.35 倍死胡同自動放寬保底）
        const waypoints = [];
        const distOriginToFirstM = getDistanceKm(origin.lng, origin.lat, orderedPins[0].lng, orderedPins[0].lat) * 1000;
        if (distOriginToFirstM >= 12) {
            waypoints.push({ lng: origin.lng, lat: origin.lat, isOrigin: true });
        }
        orderedPins.forEach(p => {
            waypoints.push({ lng: p.lng, lat: p.lat, isOrigin: false });
        });

        const combinedCoords = await fetchOsrmMultiWaypointRoute(waypoints, origin.heading);

        furnitureActiveData.routeCoords = combinedCoords;
        furnitureActiveData.distanceKm = computeCoordsDistanceKm(combinedCoords);
        furnitureActiveData.updatedAt = Date.now();
        isLocalFurnitureDirty = true;
        saveLocalFurnitureBackup();
        vibrate([40, 25, 40]);

        renderAllFurnitureMapElements();
        await syncActiveFurnitureToFirebase(false);
        showFurnitureToast(`✅ 已完成兩階段順路排序與靠右停靠路線（共 ${furnitureActiveData.distanceKm} km）`);
    } finally {
        isFurnitureOsrmBusy = false;
        if (btn) {
            btn.innerHTML = origHtml;
            btn.disabled = (furnitureActiveData.pins.length < 1);
        }
    }
});

// ==========================================
// ✍️ 串聯方式 2：手動拉線串（依序從 1 號針手繪或點連向 2、3… 號針，靠近目標針 25m 內自動吸附）
// ==========================================
function startFurnitureManualConnectMode() {
    if (!Array.isArray(furnitureActiveData.pins) || furnitureActiveData.pins.length < 2) return;

    isFurnitureManualConnecting = true;
    furnitureManualTargetPinIdx = 1;
    const p0 = furnitureActiveData.pins[0];
    furnitureManualConnectedCoords = [[p0.lng, p0.lat]];
    furnitureManualSegmentDraft = [[p0.lng, p0.lat]];
    isFurnitureDrawingStroke = false;

    furnitureActiveData.routeCoords = [...furnitureManualConnectedCoords];
    showFurnitureToast('✍️ 手動拉線串：請從 #1 號針拉線或點選路面連向 #2 號針');
    renderAllFurnitureMapElements();
}

function stopFurnitureManualConnectMode(commitDraft = true) {
    if (commitDraft && furnitureManualConnectedCoords.length >= 2) {
        furnitureActiveData.routeCoords = [...furnitureManualConnectedCoords];
        furnitureActiveData.distanceKm = computeCoordsDistanceKm(furnitureActiveData.routeCoords);
        furnitureActiveData.updatedAt = Date.now();
        isLocalFurnitureDirty = true;
        saveLocalFurnitureBackup();
        syncActiveFurnitureToFirebase(false);
    }
    isFurnitureManualConnecting = false;
    isFurnitureDrawingStroke = false;
    furnitureManualSegmentDraft = [];
    try { map.dragPan.enable(); } catch (e) {}
    renderAllFurnitureMapElements();
}

function handleManualConnectSnapToPin(targetIdx) {
    if (!isFurnitureManualConnecting) return;
    if (targetIdx < 1 || targetIdx >= furnitureActiveData.pins.length) return;

    const targetPin = furnitureActiveData.pins[targetIdx];
    const targetCoord = [targetPin.lng, targetPin.lat];
    const segCoords = furnitureManualSegmentDraft.length >= 1
        ? [...furnitureManualSegmentDraft, targetCoord]
        : [furnitureManualConnectedCoords[furnitureManualConnectedCoords.length - 1], targetCoord];

    const densified = densifyRoadCoordinates(segCoords, 8);
    for (let i = 1; i < densified.length; i++) {
        furnitureManualConnectedCoords.push(densified[i]);
    }

    furnitureActiveData.routeCoords = [...furnitureManualConnectedCoords];
    furnitureActiveData.distanceKm = computeCoordsDistanceKm(furnitureActiveData.routeCoords);
    furnitureActiveData.updatedAt = Date.now();
    isLocalFurnitureDirty = true;
    saveLocalFurnitureBackup();
    vibrate(35);

    if (targetIdx >= furnitureActiveData.pins.length - 1) {
        stopFurnitureManualConnectMode(true);
        showFurnitureToast(`🎉 已完成手動拉線串聯 1 ➔ ${furnitureActiveData.pins.length} 號針（${furnitureActiveData.distanceKm} km）`);
    } else {
        furnitureManualTargetPinIdx = targetIdx + 1;
        furnitureManualSegmentDraft = [targetCoord];
        renderAllFurnitureMapElements();
        showFurnitureToast(`✅ 已吸附 #${targetIdx + 1} 號針！請繼續連向 #${furnitureManualTargetPinIdx + 1} 號針`);
    }
}

function handleFurnitureManualClickPoint(lng, lat) {
    if (!isFurnitureManualConnecting) return;
    const targetPin = furnitureActiveData.pins[furnitureManualTargetPinIdx];
    if (!targetPin) return;

    const distToTargetM = getDistanceKm(lng, lat, targetPin.lng, targetPin.lat) * 1000;
    if (distToTargetM <= 25) {
        handleManualConnectSnapToPin(furnitureManualTargetPinIdx);
        return;
    }

    furnitureManualSegmentDraft.push([lng, lat]);
    furnitureManualConnectedCoords.push([lng, lat]);
    furnitureActiveData.routeCoords = [...furnitureManualConnectedCoords];
    furnitureActiveData.distanceKm = computeCoordsDistanceKm(furnitureActiveData.routeCoords);
    renderAllFurnitureMapElements();
}

(function setupFurnitureManualFreehandGesture() {
    const canvasContainer = map.getCanvasContainer();

    function getLngLat(clientX, clientY) {
        const rect = canvasContainer.getBoundingClientRect();
        return map.unproject([clientX - rect.left, clientY - rect.top]);
    }

    function onStart(clientX, clientY, rawEv) {
        if (!isFurnitureModeActive || !isFurnitureManualConnecting) return;
        const targetEl = rawEv?.target;
        if (targetEl && targetEl.closest && targetEl.closest('.furniture-pin-wrapper, .furniture-popup-wrapper')) return;
        if (furnitureManualConnectedCoords.length === 0) return;

        const lngLat = getLngLat(clientX, clientY);
        const lastAnchor = furnitureManualConnectedCoords[furnitureManualConnectedCoords.length - 1];
        const distFromAnchorM = getDistanceKm(lngLat.lng, lngLat.lat, lastAnchor[0], lastAnchor[1]) * 1000;
        if (distFromAnchorM > 55) return;

        isFurnitureDrawingStroke = true;
        furnitureManualSegmentDraft = [lastAnchor, [Number(lngLat.lng.toFixed(6)), Number(lngLat.lat.toFixed(6))]];
        try { map.dragPan.disable(); } catch (e) {}
    }

    function onMove(clientX, clientY) {
        if (!isFurnitureModeActive || !isFurnitureManualConnecting || !isFurnitureDrawingStroke) return;
        const targetPin = furnitureActiveData?.pins?.[furnitureManualTargetPinIdx];
        if (!targetPin) return;

        const lngLat = getLngLat(clientX, clientY);
        const curLng = Number(lngLat.lng.toFixed(6));
        const curLat = Number(lngLat.lat.toFixed(6));

        const [lastLng, lastLat] = furnitureManualSegmentDraft[furnitureManualSegmentDraft.length - 1];
        if (getDistanceKm(lastLng, lastLat, curLng, curLat) * 1000 >= 4) {
            furnitureManualSegmentDraft.push([curLng, curLat]);
            renderAllFurnitureMapElements();
        }

        const distToTargetM = getDistanceKm(curLng, curLat, targetPin.lng, targetPin.lat) * 1000;
        if (distToTargetM <= 25) {
            isFurnitureDrawingStroke = false;
            try { map.dragPan.enable(); } catch (e) {}
            handleManualConnectSnapToPin(furnitureManualTargetPinIdx);
        }
    }

    function onEnd() {
        if (!isFurnitureDrawingStroke) return;
        isFurnitureDrawingStroke = false;
        try { map.dragPan.enable(); } catch (e) {}
        if (furnitureManualSegmentDraft.length >= 2) {
            for (let i = 1; i < furnitureManualSegmentDraft.length; i++) {
                furnitureManualConnectedCoords.push(furnitureManualSegmentDraft[i]);
            }
            const lastPt = furnitureManualConnectedCoords[furnitureManualConnectedCoords.length - 1];
            furnitureManualSegmentDraft = [lastPt];
            furnitureActiveData.routeCoords = [...furnitureManualConnectedCoords];
            furnitureActiveData.distanceKm = computeCoordsDistanceKm(furnitureActiveData.routeCoords);
            renderAllFurnitureMapElements();
        }
    }

    canvasContainer.addEventListener('touchstart', (e) => {
        if (!isFurnitureModeActive || !isFurnitureManualConnecting) return;
        if (e.touches && e.touches.length >= 2) {
            isFurnitureDrawingStroke = false;
            try { map.dragPan.enable(); } catch (err) {}
            return;
        }
        if (e.touches && e.touches.length === 1) {
            onStart(e.touches[0].clientX, e.touches[0].clientY, e);
        }
    }, { passive: true });

    canvasContainer.addEventListener('touchmove', (e) => {
        if (!isFurnitureModeActive || !isFurnitureManualConnecting || !isFurnitureDrawingStroke) return;
        if (e.touches && e.touches.length >= 2) {
            isFurnitureDrawingStroke = false;
            try { map.dragPan.enable(); } catch (err) {}
            return;
        }
        if (e.touches && e.touches.length === 1) {
            if (e.cancelable) e.preventDefault();
            onMove(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: false });

    canvasContainer.addEventListener('touchend', () => onEnd(), { passive: true });
    canvasContainer.addEventListener('mousedown', (e) => {
        if (e.button === 0) onStart(e.clientX, e.clientY, e);
    });
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => onEnd());
})();

document.getElementById('btnFurnitureManualConnect')?.addEventListener('click', () => {
    if (isFurnitureManualConnecting) {
        stopFurnitureManualConnectMode(true);
        showFurnitureToast('✅ 已完成手動拉線串聯並同步雲端');
    } else {
        startFurnitureManualConnectMode();
    }
});

// ==========================================
// 🧭▶️ 二、家具路線串接完成後：「🧭 循跡導航」與「▶️ 路線播放」引擎接通
// ==========================================
function buildSyntheticRouteFromActiveFurniture() {
    if (!furnitureActiveData || !Array.isArray(furnitureActiveData.routeCoords) || furnitureActiveData.routeCoords.length < 2) {
        return null;
    }

    const points = furnitureActiveData.routeCoords.map((coord, idx) => ({
        lng: Number(coord[0]),
        lat: Number(coord[1]),
        time: Date.now() + idx * 1000,
        musicActive: true,
        music: true
    }));

    const events = (furnitureActiveData.pins || []).map((pin, idx) => {
        const cleanAddr = String(pin.label || `家具點位 #${idx + 1}`).replace(/^新北市鶯歌區/, '').trim();
        const notePart = pin.note ? `（${pin.note}）` : '';
        const woodPart = pin.needsWoodTruckSupport ? '，純木頭需垃圾車支援' : '';
        return {
            type: 'alert',
            lng: Number(pin.lng),
            lat: Number(pin.lat),
            note: `第 ${idx + 1} 站家具清運點：${cleanAddr}${notePart}${woodPart}`,
            played: false,
            prePlayed: false
        };
    });

    const pinsCount = Array.isArray(furnitureActiveData.pins) ? furnitureActiveData.pins.length : 0;
    return {
        id: `furniture_active_${currentFurnitureDateStr}`,
        name: `家具清運路線（${pinsCount} 站 · ${furnitureActiveData.distanceKm || '0.00'} km）`,
        date: currentFurnitureDateStr,
        distance: furnitureActiveData.distanceKm || computeCoordsDistanceKm(furnitureActiveData.routeCoords),
        timeStr: `${pinsCount} 站家具點位`,
        author: furnitureActiveData.author || '家具清運隊員',
        points,
        events,
        callouts: []
    };
}

function restoreFurnitureModeAfterNavOrReplay() {
    window.isFurnitureNavOrReplayActive = false;
    window.activeFurnitureSyntheticRoute = null;

    // 清除一般路線重播／導航殘留的進度線圖層与 S/E DOM 標記
    clearDomMarkers();
    cachedBgRouteGeoJSON = emptyGeoJSON();
    cachedSilentRouteGeoJSON = emptyGeoJSON();
    cachedMusicRouteGeoJSON = emptyGeoJSON();
    try {
        map.getSource('bg-route')?.setData(cachedBgRouteGeoJSON);
        map.getSource('route-Silent')?.setData(cachedSilentRouteGeoJSON);
        map.getSource('route-music')?.setData(cachedMusicRouteGeoJSON);
    } catch (e) {}

    isFurnitureModeActive = true;
    window.isFurnitureModeActive = true;

    document.getElementById('routeDetailUI')?.classList.add('hidden');
    document.getElementById('mainUI')?.classList.add('hidden');
    document.getElementById('playbackUI')?.classList.add('hidden');
    document.getElementById('topBackBtn')?.classList.add('hidden');

    const topNavHeaderBar = document.getElementById('topNavHeaderBar');
    if (topNavHeaderBar) {
        topNavHeaderBar.classList.remove('top-6', 'top-14');
        topNavHeaderBar.classList.add('top-16');
    }
    const appStatusTitle = document.getElementById('appStatusTitle');
    if (appStatusTitle) {
        appStatusTitle.innerText = '🛋️ 家具模式';
    }

    document.getElementById('furnitureModeUI')?.classList.remove('hidden');
    document.getElementById('furnitureLeftConnectControls')?.classList.remove('hidden');
    renderAllFurnitureMapElements();
}

document.getElementById('btnFurnitureStartFollowNav')?.addEventListener('click', () => {
    if (isFurnitureManualConnecting) {
        stopFurnitureManualConnectMode(true);
    }
    const syntheticRoute = buildSyntheticRouteFromActiveFurniture();
    if (!syntheticRoute) {
        showFurnitureToast('⚠️ 請先透過「自動沿路串」或「手動拉線串」建立家具路線');
        return;
    }
    closeFurniturePinPopup();
    window.activeFurnitureSyntheticRoute = syntheticRoute;
    window.isFurnitureNavOrReplayActive = true;
    vibrate(35);
    document.getElementById('startFollowBtn')?.click();
});

document.getElementById('btnFurnitureStartReplay')?.addEventListener('click', () => {
    if (isFurnitureManualConnecting) {
        stopFurnitureManualConnectMode(true);
    }
    const syntheticRoute = buildSyntheticRouteFromActiveFurniture();
    if (!syntheticRoute) {
        showFurnitureToast('⚠️ 請先透過「自動沿路串」或「手動拉線串」建立家具路線');
        return;
    }
    closeFurniturePinPopup();
    window.activeFurnitureSyntheticRoute = syntheticRoute;
    window.isFurnitureNavOrReplayActive = true;
    vibrate(35);
    document.getElementById('startReplayBtn')?.click();
});

// 撤銷上一支針與清空全部家具定位針按鈕
document.getElementById('btnFurnitureUndoPin')?.addEventListener('click', () => {
    if (!Array.isArray(furnitureActiveData.pins) || furnitureActiveData.pins.length === 0) return;
    if (isFurnitureManualConnecting) stopFurnitureManualConnectMode(false);
    furnitureActiveData.pins.pop();
    if (furnitureActiveData.pins.length < 2) {
        furnitureActiveData.routeCoords = [];
        furnitureActiveData.distanceKm = '0.00';
    }
    furnitureActiveData.updatedAt = Date.now();
    isLocalFurnitureDirty = true;
    saveLocalFurnitureBackup();
    vibrate(25);
    renderAllFurnitureMapElements();
    syncActiveFurnitureToFirebase(false);
    showFurnitureToast('↩️ 已撤銷上一支定位針');
});

document.getElementById('btnFurnitureClearPins')?.addEventListener('click', async () => {
    if (!furnitureActiveData) return;
    if (!confirm('確定要清空今日的家具定位針與路線嗎？')) return;
    if (isFurnitureManualConnecting) stopFurnitureManualConnectMode(false);
    furnitureActiveData.pins = [];
    furnitureActiveData.routeCoords = [];
    furnitureActiveData.distanceKm = '0.00';
    furnitureActiveData.updatedAt = Date.now();
    isLocalFurnitureDirty = false;
    saveLocalFurnitureBackup();
    renderAllFurnitureMapElements();
    await syncActiveFurnitureToFirebase(false);
    showFurnitureToast('🗑️ 已清空家具定位針與路線');
});

// ==========================================
// ☁️ Firebase 當日家具單一共用作業空間雙向同步：furniture_collab/{YYYY-MM-DD}/active
// ==========================================
function getFurnitureActiveFirebaseUrl(dateStr = currentFurnitureDateStr) {
    return `${FIREBASE_BASE_URL}/furniture_collab/${dateStr}/active.json`;
}

async function syncActiveFurnitureToFirebase(showToast = false) {
    if (!furnitureActiveData) return false;
    const authorName = localStorage.getItem('fleet_user_name') || localStorage.getItem('yinggeRouteLastAuthor') || '家具清運隊員';
    const payload = {
        author: authorName,
        updatedAt: Date.now(),
        distanceKm: computeCoordsDistanceKm(furnitureActiveData.routeCoords),
        pins: furnitureActiveData.pins || [],
        routeCoords: furnitureActiveData.routeCoords || []
    };

    try {
        const res = await fetchWithTimeout(getFurnitureActiveFirebaseUrl(currentFurnitureDateStr), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        furnitureActiveData.updatedAt = payload.updatedAt;
        furnitureActiveData.author = authorName;
        isLocalFurnitureDirty = false;
        saveLocalFurnitureBackup();
        updateWoodSupportTopLeftAlertUI();

        if (showToast) {
            showFurnitureToast('☁️ 已同步家具定位針與路線至全車隊');
        }
        return true;
    } catch (e) {
        if (showToast) {
            showFurnitureToast('⚠️ 網路訊號不佳，已先自動保存在本機');
        }
        return false;
    }
}

let isFetchingFurnitureCloud = false;
async function fetchAndSyncTodayFurnitureCollab() {
    if (isFetchingFurnitureCloud) return;
    isFetchingFurnitureCloud = true;

    const todayStr = getTodayDateString();
    if (todayStr !== currentFurnitureDateStr) {
        currentFurnitureDateStr = todayStr;
        furnitureActiveData = {
            pins: [],
            routeCoords: [],
            distanceKm: '0.00',
            updatedAt: 0,
            author: ''
        };
        isLocalFurnitureDirty = false;
    }

    try {
        if (isFurnitureModeActive && isLocalFurnitureDirty) {
            return;
        }
        const res = await fetchWithTimeout(getFurnitureActiveFirebaseUrl(currentFurnitureDateStr), { cache: 'no-store' }, 5000);
        if (!res.ok) return;
        const rawActive = await res.json();

        let hasAnyChange = false;
        if (rawActive && typeof rawActive === 'object') {
            const normalized = normalizeFurniturePayload(rawActive);
            const curUpdated = furnitureActiveData?.updatedAt || 0;
            if (normalized.updatedAt !== curUpdated || JSON.stringify(normalized.pins) !== JSON.stringify(furnitureActiveData?.pins)) {
                furnitureActiveData = normalized;
                saveLocalFurnitureBackup();
                hasAnyChange = true;
            }
        } else {
            const localBackup = loadLocalFurnitureBackup();
            if (localBackup && (furnitureActiveData?.pins?.length || 0) === 0 && localBackup.pins.length > 0) {
                furnitureActiveData = localBackup;
                hasAnyChange = true;
            } else if (!localBackup && ((furnitureActiveData?.pins?.length || 0) > 0 || (furnitureActiveData?.routeCoords?.length || 0) > 0)) {
                furnitureActiveData = { pins: [], routeCoords: [], distanceKm: '0.00', updatedAt: 0, author: '' };
                hasAnyChange = true;
            }
        }

        if (hasAnyChange) {
            renderAllFurnitureMapElements();
        } else {
            updateWoodSupportTopLeftAlertUI();
        }
    } catch (e) {
        if ((furnitureActiveData?.pins?.length || 0) === 0) {
            const backup = loadLocalFurnitureBackup();
            if (backup) furnitureActiveData = backup;
        }
        updateWoodSupportTopLeftAlertUI();
    } finally {
        isFetchingFurnitureCloud = false;
    }
}

// ==========================================
// ✨ 11.5 家具模式「✨ AI 批次派工自動插針」（結合全隊已標註橘色水滴社區大樓＋門牌定位＋純木頭火紅標記）
// ==========================================
async function fetchAllSharedCommunityBuildings() {
    const buildingMap = new Map();

    // 1. 先收錄目前已載入在記憶體 pinsLayerGroup 中的橘色水滴社區大樓
    if (typeof pinsLayerGroup === 'object' && pinsLayerGroup) {
        Object.values(pinsLayerGroup).forEach(entry => {
            const d = entry?.data;
            if (d && d.pinType === 'building' && d.title && !isNaN(Number(d.lat)) && !isNaN(Number(d.lng))) {
                const titleClean = String(d.title).trim();
                buildingMap.set(titleClean, {
                    title: titleClean,
                    lat: Number(Number(d.lat).toFixed(6)),
                    lng: Number(Number(d.lng).toFixed(6))
                });
            }
        });
    }

    // 2. 再從 Firebase 即時抓取最新 /map_pins.json 確保不漏掉任何社區大樓
    try {
        const res = await fetchWithTimeout(MAP_PINS_ALL_URL, { cache: 'no-store' }, 4500);
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object') {
                Object.values(data).forEach(pin => {
                    if (pin && pin.pinType === 'building' && pin.title && !isNaN(Number(pin.lat)) && !isNaN(Number(pin.lng))) {
                        const titleClean = String(pin.title).trim();
                        buildingMap.set(titleClean, {
                            title: titleClean,
                            lat: Number(Number(pin.lat).toFixed(6)),
                            lng: Number(Number(pin.lng).toFixed(6))
                        });
                    }
                });
            }
        }
    } catch (e) {}

    return Array.from(buildingMap.values());
}

// 取得按啟用順序排列的 API Key 候選清單（動態讀取畫面最新 .trim() 金鑰，當遇到 HTTP 429 時自動輪替下一組）
function getOrderedGeminiApiKeysForDispatch() {
    const mergedRaw = [];
    // 優先納入開發者面板正在編輯或已載入的金鑰清單（即便尚未按儲存並同步也立即生效）
    if (Array.isArray(editingAdminAiKeys) && editingAdminAiKeys.length > 0) {
        editingAdminAiKeys.forEach(k => {
            const cleanKey = String(k?.key || '').trim();
            if (cleanKey) {
                mergedRaw.push({
                    id: k.id,
                    key: cleanKey,
                    note: String(k.note || '').trim() || '自訂金鑰'
                });
            }
        });
    }
    // 合併 systemNavConfig 已存金鑰
    const savedKeys = normalizeAiApiKeysArray(systemNavConfig.aiApiKeys);
    savedKeys.forEach(k => {
        const cleanKey = String(k?.key || '').trim();
        if (cleanKey && !mergedRaw.some(existing => existing.key === cleanKey)) {
            mergedRaw.push({
                id: k.id,
                key: cleanKey,
                note: String(k.note || '').trim() || '自訂金鑰'
            });
        }
    });
    // 若新增金鑰輸入框中有未按「確認新增」的金鑰，也納入候選
    const pendingInputKey = (document.getElementById('adminNewAiKeyInput')?.value || '').trim();
    const pendingInputNote = (document.getElementById('adminNewAiKeyNoteInput')?.value || '').trim();
    if (pendingInputKey && !mergedRaw.some(existing => existing.key === pendingInputKey)) {
        mergedRaw.push({
            id: '__pending_input__',
            key: pendingInputKey,
            note: pendingInputNote || '新填入金鑰'
        });
    }

    const activeId = editingActiveAiKeyId || systemNavConfig.activeAiKeyId;
    const ordered = [];
    const activeObj = mergedRaw.find(k => k.id === activeId);
    if (activeObj) ordered.push(activeObj);
    mergedRaw.forEach(k => {
        if (!activeObj || k.key !== activeObj.key) {
            ordered.push(k);
        }
    });
    return ordered;
}

// 從 Gemini 回傳文字中提取合法 JSON 陣列
function extractJsonArrayFromGeminiText(rawText) {
    const cleaned = String(rawText || '')
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
    try {
        const direct = JSON.parse(cleaned);
        if (Array.isArray(direct)) return direct;
    } catch (e) {}

    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        const sub = cleaned.slice(firstBracket, lastBracket + 1);
        const parsed = JSON.parse(sub);
        if (Array.isArray(parsed)) return parsed;
    }
    throw new Error('AI 回傳格式非有效 JSON 陣列');
}

// 建立 Gemini 模型候選陣列（優先呼叫當前選中的 gemini-3.6-flash 或 gemini-4-hydrogen）
function getGeminiModelCandidates(selectedModel) {
    const primary = getCurrentSelectedAiModel(selectedModel);
    if (primary === 'gemini-4-hydrogen') {
        return ['gemini-4-hydrogen', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    }
    return ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];
}

// ⚡ 單組 API Key 純文字輕量連線測試（獨立 AbortController 20秒逾時＋明確 abort 原因＋保留完整 HTTP 狀態碼與 API 原始錯誤訊息）
async function testSingleGeminiApiKey(rawApiKey, rawModelName) {
    const apiKey = String(rawApiKey || '').trim();
    const selectedModel = getCurrentSelectedAiModel(rawModelName);
    const startMs = performance.now();
    const TIMEOUT_MS = 20000;
    const TIMEOUT_REASON = '連線逾時（超過 20 秒），請檢查網路狀態';

    // 封裝獨立綁定於本次測試點擊的 20 秒 AbortController 請求，確保 finally 必執行 clearTimeout
    const runSingleTestFetch = async (url, fetchOptions) => {
        const controller = new AbortController();
        const timerId = setTimeout(() => {
            controller.abort(TIMEOUT_REASON);
        }, TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                ...fetchOptions,
                signal: controller.signal
            });
            return response;
        } catch (fetchErr) {
            if (controller.signal.aborted) {
                const reason = controller.signal.reason;
                const msg = typeof reason === 'string' && reason.trim()
                    ? reason.trim()
                    : TIMEOUT_REASON;
                const abortError = new Error(msg);
                abortError.name = 'AbortError';
                abortError.isTimeout = true;
                throw abortError;
            }
            throw new Error(formatGeminiTestErrorMessage(fetchErr));
        } finally {
            clearTimeout(timerId);
        }
    };

    if (!apiKey) {
        // 若未提供自訂 Key，測試後端預設環境金鑰（同樣為純文字 ping、不含 google_search，逾時 20 秒）
        const res = await runSingleTestFetch('/api/gemini/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apiKey: '',
                model: selectedModel
            })
        });
        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            const elapsedSec = data?.elapsedSec || ((performance.now() - startMs) / 1000).toFixed(1);
            return {
                ok: true,
                elapsedSec,
                testedModel: selectedModel,
                actualEndpointModel: data?.testedModel || selectedModel
            };
        }
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || `HTTP ${res.status} 連線失敗`);
    }

    // 直接對標準 v1beta REST 端點發送最輕量純文字 "ping"（maxOutputTokens: 10，嚴禁附加 tools: [{ google_search: {} }]）
    const candidateModels = getGeminiModelCandidates(selectedModel);
    let lastStatus = 500;
    let lastDetailedReason = '未知錯誤';

    for (const modelId of candidateModels) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const resp = await runSingleTestFetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: 'ping' }] }],
                generationConfig: {
                    maxOutputTokens: 10
                }
            })
        });

        lastStatus = resp.status;
        if (resp.ok) {
            const elapsedSec = ((performance.now() - startMs) / 1000).toFixed(1);
            return {
                ok: true,
                elapsedSec,
                testedModel: selectedModel,
                actualEndpointModel: modelId
            };
        }

        const rawBodyText = await resp.text().catch(() => '');
        let errJson = null;
        try {
            errJson = rawBodyText ? JSON.parse(rawBodyText) : null;
        } catch (e) {}

        const apiErrStatus = errJson?.error?.status ? ` (${errJson.error.status})` : '';
        const apiErrMsg = errJson?.error?.message || rawBodyText.slice(0, 200) || `HTTP ${resp.status}`;
        lastDetailedReason = `HTTP ${resp.status}${apiErrStatus}：${apiErrMsg}`;

        // 若為無效金鑰或權限錯誤 (400 API_KEY_INVALID / 403 PERMISSION_DENIED) 則立即停止並顯示原始錯誤訊息
        if (resp.status === 400 || resp.status === 403) {
            if (/API_KEY_INVALID|key not valid|PERMISSION_DENIED|unregistered callers|API_KEY_SERVICE_BLOCKED/i.test(apiErrMsg + apiErrStatus)) {
                throw new Error(lastDetailedReason);
            }
        }
        // 若為 404 (自訂別名模型在官方端點需對應底層模型) 或 429，繼續嘗試下一個相容模型 ID
    }

    throw new Error(lastDetailedReason);
}

// 一、Gemini API 只負責「整理地址與社區名稱」（不掛載 google_search 工具以避免 429 錯誤，嚴禁由 AI 推測經緯度）
async function callGeminiRestDirectly(rawApiKey, rawModelName, dispatchText, communities) {
    const apiKey = String(rawApiKey || '').trim();
    const selectedModel = getCurrentSelectedAiModel(rawModelName);

    const validCommunityNames = Array.isArray(communities)
        ? communities.map(c => String(c.title || c.name || '').trim()).filter(Boolean)
        : [];

    const communityListJson = JSON.stringify(validCommunityNames);

    const promptText = `你是一個專業的新北市鶯歌區清潔隊大型家具清運派工單文字整理助手。
你只需要負責「整理地址與社區名稱」並去除電話號碼、聯絡人等雜訊，嚴禁自行推測或編造經緯度座標。

以下是全車隊目前已建檔的「已標註社區大樓名稱清單（共 ${validCommunityNames.length} 處）」：
${communityListJson}

以下是使用者貼上的今日大型家具派工單文字：
"""
${dispatchText.trim()}
"""

請嚴格遵照以下規則萃取每一筆清運地點：
1. 若該筆地點為社區大樓（或與上方「已標註社區大樓名稱清單」相符／高度相似）：
   - 將 matchedCommunity 填入匹配到的清單內標準社區名稱（若清單內無完全對應但明確為社區名稱，填入該社區名稱）。
   - 將 name 設為該社區名稱（例如 "龍鳳呈祥"）。
   - 將 fullAddress 設為 "新北市鶯歌區" 加上該社區或門牌地址（去除電話與雜訊）。
2. 若該筆為一般門牌地址、巷弄或路段：
   - 去除電話號碼、手機、聯絡人稱呼、時間等雜訊，若有明顯鶯歌路名同音錯別字請修正為正確路名。
   - 將 name 設為簡潔門牌地址（例如 "建國路120號"）。
   - 將 fullAddress 自動補齊前綴為完整標準門牌地址（必須以 "新北市鶯歌區" 開頭，例如 "新北市鶯歌區建國路120號"，並去除幾樓之幾等樓層尾綴以便門牌定位）。
   - 將 matchedCommunity 設為 ""。
3. 純木頭判斷 (isPureWood)：只要該站文字中有提及「純木頭」、「木頭」、「全木」、「純木」、「木櫃/木桌/木床（標明木頭）」、「垃圾車支援」或「需垃圾車」等關鍵字，請將 isPureWood 設為 true，否則設為 false。
4. 嚴格只回傳 JSON 陣列（不要加任何額外解說文字，也不要回傳 lat/lng），每筆物件包含以下欄位：
   - order：順序（數字 1, 2, 3...）
   - name：顯示名稱（字串，例如 "龍鳳呈祥" 或 "建國路120號"）
   - fullAddress：完整標準地址（字串，自動補齊前綴為 "新北市鶯歌區..."，已去除電話與樓層雜訊）
   - matchedCommunity：匹配到的社區大樓名稱（字串，若為一般門牌則為 ""）
   - isPureWood：是否純木頭需垃圾車支援（布林值 true 或 false）
   - note：家具品項與數量備註（字串，例如 "沙發1組、床墊1張"，若無則為 ""）

輸出範例格式：
[{"order":1,"name":"龍鳳呈祥","fullAddress":"新北市鶯歌區龍鳳呈祥","matchedCommunity":"龍鳳呈祥","isPureWood":false,"note":"沙發1組"},{"order":2,"name":"建國路120號","fullAddress":"新北市鶯歌區建國路120號","matchedCommunity":"","isPureWood":true,"note":"純木頭衣櫃x2"}]`;

    const candidateRestModels = getGeminiModelCandidates(selectedModel);
    let lastStatus = 500;
    let lastErrText = '';

    // 純文字呼叫標準 v1beta REST 端點（不帶 tools: [{ google_search: {} }]，徹底避免免費版工具配額 429）
    for (const restModel of candidateRestModels) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${restModel}:generateContent?key=${apiKey}`;
        const resp = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: {
                    temperature: 0.1
                }
            })
        }, 28000);

        lastStatus = resp.status;
        if (resp.ok) {
            const data = await resp.json();
            const parts = data?.candidates?.[0]?.content?.parts || [];
            const rawText = parts.map(p => p.text || '').join('\n').trim() || '[]';
            const items = extractJsonArrayFromGeminiText(rawText);
            return Array.isArray(items) ? items : [];
        }

        const errObj = await resp.json().catch(() => null);
        lastErrText = errObj?.error?.message || `HTTP ${resp.status}`;

        if ((resp.status === 400 || resp.status === 403) && /API_KEY_INVALID|key not valid|PERMISSION_DENIED/i.test(lastErrText)) {
            const authErr = new Error(`HTTP ${resp.status}：${lastErrText}`);
            authErr.status = resp.status;
            throw authErr;
        }
    }

    if (lastStatus === 429 || /RESOURCE_EXHAUSTED|quota/i.test(lastErrText)) {
        const err429 = new Error(`HTTP 429 RESOURCE_EXHAUSTED：${lastErrText || 'API Key 額度已達上限'}`);
        err429.status = 429;
        throw err429;
    }

    const err = new Error(`HTTP ${lastStatus}：${lastErrText || 'Gemini 派工單整理失敗'}`);
    err.status = lastStatus;
    throw err;
}

// 呼叫 AI 整理派工單地址與社區名稱（動態讀取當前選定模型，支援多組 API Key 遇 429 自動輪替下一組）
async function requestAiDispatchParseWithRotation(dispatchText, communities, onStatusUpdate) {
    const selectedModel = getCurrentSelectedAiModel();
    const orderedKeys = getOrderedGeminiApiKeysForDispatch();

    // 候選嘗試清單：若有設定自訂 API Key 則依序嘗試每一組，最後或無設定時也嘗試伺服器環境金鑰 ('')
    const attempts = orderedKeys.length > 0
        ? [...orderedKeys, { id: '__server_env__', key: '', note: '系統預設金鑰' }]
        : [{ id: '__server_env__', key: '', note: '系統預設金鑰' }];

    let lastError = null;

    for (let i = 0; i < attempts.length; i++) {
        const candidate = attempts[i];
        const cleanKey = String(candidate.key || '').trim();
        const keyNote = candidate.note || `金鑰 #${i + 1}`;
        const attemptStartMs = performance.now();

        if (i > 0 && typeof onStatusUpdate === 'function') {
            onStatusUpdate(`🔄 前一組金鑰額度達上限，自動切換至「${keyNote}」（模型：${selectedModel}）重試中...`);
        }

        // 若有自訂 API Key，優先直接呼叫標準 v1beta REST API（純文字輕量萃取地址與社區）
        if (cleanKey) {
            try {
                const items = await callGeminiRestDirectly(cleanKey, selectedModel, dispatchText, communities);
                const elapsedSec = ((performance.now() - attemptStartMs) / 1000).toFixed(1);
                if (candidate.id !== '__server_env__' && candidate.id !== '__pending_input__' && candidate.id !== systemNavConfig.activeAiKeyId) {
                    systemNavConfig.activeAiKeyId = candidate.id;
                    editingActiveAiKeyId = candidate.id;
                    persistAdminAiSettingsImmediately();
                }
                return {
                    items,
                    usedKeyNote: keyNote,
                    elapsedSec
                };
            } catch (restErr) {
                lastError = restErr;
                if (restErr && (restErr.status === 429 || /429|RESOURCE_EXHAUSTED/i.test(String(restErr.message || '')))) {
                    continue;
                }
            }
        }

        // 備援或使用系統預設金鑰時呼叫後端 /api/gemini/dispatch
        try {
            const res = await fetchWithTimeout('/api/gemini/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dispatchText,
                    model: selectedModel,
                    apiKey: cleanKey,
                    communities
                })
            }, 35000);

            if (res.status === 429) {
                const errData429 = await res.json().catch(() => ({}));
                lastError = new Error(errData429?.error || `HTTP 429：金鑰「${keyNote}」額度已達上限`);
                continue;
            }

            if (res.ok) {
                const payload = await res.json();
                const elapsedSec = ((performance.now() - attemptStartMs) / 1000).toFixed(1);
                if (candidate.id !== '__server_env__' && candidate.id !== '__pending_input__' && candidate.id !== systemNavConfig.activeAiKeyId) {
                    systemNavConfig.activeAiKeyId = candidate.id;
                    editingActiveAiKeyId = candidate.id;
                    persistAdminAiSettingsImmediately();
                }
                return {
                    items: Array.isArray(payload.items) ? payload.items : [],
                    usedKeyNote: keyNote,
                    elapsedSec
                };
            }

            const errData = await res.json().catch(() => ({}));
            if (errData?.code === 'RESOURCE_EXHAUSTED' || errData?.isQuotaError) {
                lastError = new Error(errData.error || `HTTP 429：金鑰「${keyNote}」額度限制`);
                continue;
            }
            if (!lastError) {
                lastError = new Error(errData?.error || `HTTP ${res.status}：AI 服務回應錯誤`);
            }
        } catch (err) {
            if (!lastError) {
                lastError = err;
            }
        }
    }

    throw lastError || new Error('HTTP 400 MISSING_API_KEY：無法完成 AI 派工查詢，請至開發者模式檢查或新增 Gemini API Key');
}

// ==========================================
// 🎯 二、三層優先定位機制（1. 社區大樓資料庫 -> 2. ArcGIS 台灣門牌接口 -> 3. OSM Nominatim 鶯歌範圍備援）
// ==========================================

// 規範化為以「新北市鶯歌區」開頭的標準門牌查詢字串（去除樓層與電話雜訊）
function normalizeYinggeFullAddress(rawAddr) {
    let addr = String(rawAddr || '').trim();
    if (!addr) return '';
    // 移除電話號碼、括號備註與幾樓之幾尾綴，保留到「X號(之X)」
    addr = addr
        .replace(/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, '')
        .replace(/02[-\s]?\d{4}[-\s]?\d{4}/g, '')
        .replace(/[（(][^）)]*[）)]/g, '')
        .replace(/(\d+號(?:之\d+)?)\s*\d+\s*[樓Ff].*$/g, '$1')
        .trim();
    if (!addr) return '';
    if (!/新北市|鶯歌區/.test(addr)) {
        addr = `新北市鶯歌區${addr}`;
    } else if (!addr.includes('新北市') && addr.includes('鶯歌區')) {
        addr = `新北市${addr}`;
    } else if (addr.includes('新北市') && !addr.includes('鶯歌區')) {
        addr = addr.replace('新北市', '新北市鶯歌區');
    }
    return addr;
}

// 【第一順位】最優先比對現有社區大樓資料庫（完全保留既有社區大樓資料結構與橘色標記邏輯）
function findMatchingCommunityBuilding(item, communities) {
    if (!Array.isArray(communities) || communities.length === 0) return null;
    const candidates = [
        String(item?.matchedCommunity || '').trim(),
        String(item?.name || '').trim(),
        String(item?.fullAddress || '').trim(),
        String(item?.rawName || '').trim(),
        String(item?.normalizedAddress || '').trim()
    ].filter(Boolean);

    for (const cText of candidates) {
        const cleanTarget = cText.replace(/社區|大樓|大廈|公寓|新北市|鶯歌區/g, '').trim();
        for (const b of communities) {
            const bTitle = String(b.title || '').trim();
            const bClean = bTitle.replace(/社區|大樓|大廈|公寓/g, '').trim();
            if (bTitle === cText || (bClean.length >= 2 && (cText.includes(bClean) || cleanTarget === bClean))) {
                return b;
            }
        }
    }
    return null;
}

// 【第二順位】純門牌交由 ArcGIS 台灣門牌接口查詢（score >= 70 即採用精準門牌座標）
async function geocodeAddressWithArcGIS(rawAddress) {
    const fullAddress = normalizeYinggeFullAddress(rawAddress);
    if (!fullAddress) return null;

    const queryVariants = [fullAddress];
    // 若含「之X號」或樓層殘留，加入基礎門牌號作為二次嘗試
    const baseHouseAddr = fullAddress.replace(/(號)之\d+.*$/, '$1');
    if (baseHouseAddr !== fullAddress) {
        queryVariants.push(baseHouseAddr);
    }

    for (const candidateAddr of queryVariants) {
        const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(candidateAddr)}&countryCode=TWN&searchExtent=121.30,24.92,121.39,25.01&location=121.348,24.955&outSr=4326&maxLocations=1&forStorage=false&f=json`;
        try {
            const res = await fetchWithTimeout(url, {}, 7000);
            if (!res.ok) continue;
            const data = await res.json();
            const topCandidate = data?.candidates?.[0];
            if (!topCandidate || !topCandidate.location) continue;

            const score = Number(topCandidate.score || 0);
            const lat = Number(topCandidate.location.y);
            const lng = Number(topCandidate.location.x);
            const isInYinggeBounds = (
                !isNaN(lat) &&
                !isNaN(lng) &&
                lat >= 24.90 &&
                lat <= 25.02 &&
                lng >= 121.29 &&
                lng <= 121.41
            );

            if (score >= 70 && isInYinggeBounds) {
                return {
                    lat: Number(lat.toFixed(6)),
                    lng: Number(lng.toFixed(6)),
                    score,
                    matchedAddr: topCandidate.address || candidateAddr
                };
            }
        } catch (e) {}
    }
    return null;
}

// 【第三順位】鶯歌區範圍備援：OpenStreetMap Nominatim（bounded=1&viewbox=121.30,25.01,121.39,24.92 限制在鶯歌區範圍內）
async function geocodeAddressWithNominatimBounded(rawAddress) {
    const fullAddress = normalizeYinggeFullAddress(rawAddress);
    if (!fullAddress) return null;

    // 先查完整門牌，若無結果再退回查該路名／巷弄以確保路段座標命中
    const queries = [fullAddress];
    const roadOnly = fullAddress.replace(/\d+號.*$/, '').trim();
    if (roadOnly && roadOnly !== fullAddress && roadOnly.length > 6) {
        queries.push(roadOnly);
    }

    for (const q of queries) {
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=tw&limit=1&bounded=1&viewbox=121.30,25.01,121.39,24.92&q=${encodeURIComponent(q)}`;
        try {
            const res = await fetchWithTimeout(url, {
                headers: { 'Accept-Language': 'zh-TW,zh;q=0.9' }
            }, 6500);
            if (!res.ok) continue;
            const list = await res.json();
            const first = Array.isArray(list) ? list[0] : null;
            if (!first) continue;

            const lat = Number(first.lat);
            const lng = Number(first.lon);
            const isInYinggeBounds = (
                !isNaN(lat) &&
                !isNaN(lng) &&
                lat >= 24.90 &&
                lat <= 25.02 &&
                lng >= 121.29 &&
                lng <= 121.41
            );
            if (isInYinggeBounds) {
                return {
                    lat: Number(lat.toFixed(6)),
                    lng: Number(lng.toFixed(6)),
                    matchedAddr: first.display_name || q
                };
            }
        } catch (e) {}
    }
    return null;
}

let cachedAiDispatchCommunities = [];

async function openAiDispatchModal() {
    const modal = document.getElementById('aiDispatchModal');
    const modelBadge = document.getElementById('aiDispatchActiveModelBadge');
    const communityBadge = document.getElementById('aiDispatchCommunityCountBadge');
    const resultBox = document.getElementById('aiDispatchResultBox');
    const textInput = document.getElementById('aiDispatchTextInput');

    if (!modal) return;
    if (modelBadge) {
        modelBadge.textContent = getCurrentSelectedAiModel();
    }
    if (resultBox) {
        resultBox.classList.add('hidden');
        resultBox.innerHTML = '';
    }

    window.history.pushState({ pwa: true }, '');
    modal.classList.remove('hidden');
    setTimeout(() => {
        textInput?.focus();
    }, 80);

    if (communityBadge) {
        communityBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在同步社區大樓...';
    }
    cachedAiDispatchCommunities = await fetchAllSharedCommunityBuildings();
    if (communityBadge) {
        communityBadge.innerHTML = `<i class="fa-solid fa-building"></i> 已同步社區大樓：${cachedAiDispatchCommunities.length} 處`;
    }
}

function closeAiDispatchModal() {
    document.getElementById('aiDispatchModal')?.classList.add('hidden');
}

(function setupAiDispatchModalEvents() {
    const modalEl = document.getElementById('aiDispatchModal');
    if (modalEl) {
        ['pointerdown', 'touchstart', 'mousedown', 'wheel'].forEach(evtName => {
            modalEl.addEventListener(evtName, (e) => {
                e.stopPropagation();
            }, { passive: true });
        });
    }

    const openBtn = document.getElementById('btnOpenAiDispatchModal');
    openBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        vibrate(20);
        openAiDispatchModal();
    });

    document.getElementById('btnCloseAiDispatchTop')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAiDispatchModal();
    });

    document.getElementById('btnCancelAiDispatch')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAiDispatchModal();
    });

    document.getElementById('btnClearAiDispatchText')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const ta = document.getElementById('aiDispatchTextInput');
        if (ta) {
            ta.value = '';
            ta.focus();
        }
        const resultBox = document.getElementById('aiDispatchResultBox');
        if (resultBox) resultBox.classList.add('hidden');
    });

    const taEl = document.getElementById('aiDispatchTextInput');
    if (taEl) {
        ['pointerdown', 'touchstart', 'mousedown', 'click'].forEach(evt => {
            taEl.addEventListener(evt, (e) => {
                e.stopPropagation();
            }, { passive: true });
        });
    }

    const runBtn = document.getElementById('btnRunAiDispatch');
    runBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const textInput = document.getElementById('aiDispatchTextInput');
        const resultBox = document.getElementById('aiDispatchResultBox');
        const replaceCheckbox = document.getElementById('aiDispatchReplaceExistingInput');
        const rawText = (textInput?.value || '').trim();

        if (!rawText) {
            if (resultBox) {
                resultBox.className = 'rounded-2xl p-3 text-xs font-extrabold leading-relaxed border bg-amber-50 border-amber-300 text-amber-800';
                resultBox.textContent = '⚠️ 請先在上方輸入框貼上今日派工單文字！';
                resultBox.classList.remove('hidden');
            }
            textInput?.focus();
            return;
        }

        const origBtnHtml = runBtn.innerHTML;
        runBtn.disabled = true;
        runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>AI 正在整理地址並精準定位...</span>';

        const showProgressStatus = (msg, style = 'info') => {
            if (!resultBox) return;
            resultBox.classList.remove('hidden');
            if (style === 'error') {
                resultBox.className = 'rounded-2xl p-3 text-xs font-extrabold leading-relaxed border bg-red-50 border-red-300 text-red-700';
            } else if (style === 'success') {
                resultBox.className = 'rounded-2xl p-3 text-xs font-extrabold leading-relaxed border bg-emerald-50 border-emerald-300 text-emerald-900';
            } else {
                resultBox.className = 'rounded-2xl p-3 text-xs font-extrabold leading-relaxed border bg-violet-50 border-violet-200 text-violet-800';
            }
            resultBox.innerHTML = msg;
        };

        try {
            const communities = cachedAiDispatchCommunities.length > 0
                ? cachedAiDispatchCommunities
                : await fetchAllSharedCommunityBuildings();

            showProgressStatus(
                `<i class="fa-solid fa-wand-magic-sparkles fa-spin mr-1"></i> 步驟 1/2：正在使用 Gemini（${getCurrentSelectedAiModel()}）整理派工地址與比對社區大樓（${communities.length} 處）...`
            );

            const { items: parsedItems, usedKeyNote, elapsedSec } = await requestAiDispatchParseWithRotation(
                rawText,
                communities,
                (rotMsg) => {
                    showProgressStatus(rotMsg, 'info');
                }
            );

            if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
                showProgressStatus(
                    `<div>🟢 Gemini 派工單解析完成（使用 Key：${usedKeyNote}｜耗時 ${elapsedSec}s）</div>` +
                    `<div class="mt-1 text-red-700">⚠️ AI 未能從文字中識別出任何有效地址或社區名稱，請確認派工單內容。</div>`,
                    'error'
                );
                return;
            }

            // 依 order 排序確保 1, 2, 3... 順序一致
            parsedItems.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

            if (replaceCheckbox?.checked) {
                furnitureActiveData.pins = [];
                furnitureActiveData.routeCoords = [];
                furnitureActiveData.distanceKm = '0.00';
            }

            const addedPins = [];
            const unresolvedItems = [];
            let woodCount = 0;

            for (let i = 0; i < parsedItems.length; i++) {
                const item = parsedItems[i];
                const rawLabel = String(item.name || item.matchedCommunity || item.fullAddress || item.rawName || item.normalizedAddress || `派工點 #${i + 1}`).trim();
                const fullAddrForGeocode = String(item.fullAddress || item.normalizedAddress || rawLabel).trim();
                const noteText = String(item.note || '').trim();
                const isWood = Boolean(
                    item.isPureWood ||
                    /純木|全木|木頭|垃圾車支援/.test(rawLabel) ||
                    /純木|全木|木頭|垃圾車支援/.test(noteText)
                );

                showProgressStatus(
                    `<i class="fa-solid fa-location-crosshairs fa-spin mr-1"></i> 步驟 2/2：正在執行三層精準定位 (${i + 1}/${parsedItems.length})「${rawLabel}」...`
                );

                // 【第一順位】最優先比對現有社區大樓資料庫（命中直接採用該社區原本精準座標）
                const matchedBld = findMatchingCommunityBuilding(item, communities);
                if (matchedBld) {
                    const pinNumber = (furnitureActiveData.pins?.length || 0) + 1;
                    addFurniturePinToWorkspace(matchedBld.lng, matchedBld.lat, `🏢 ${matchedBld.title}`, {
                        note: noteText,
                        needsWoodTruckSupport: isWood,
                        silent: true
                    });
                    if (isWood) woodCount++;
                    addedPins.push({
                        order: pinNumber,
                        lng: matchedBld.lng,
                        lat: matchedBld.lat,
                        label: matchedBld.title,
                        sourceLabel: '[社區庫]',
                        isWood
                    });
                    continue;
                }

                // 【第二順位】純門牌交由 ArcGIS 台灣門牌接口查詢（score >= 70 即採用該精準門牌座標）
                const arcgisHit = await geocodeAddressWithArcGIS(fullAddrForGeocode);
                if (arcgisHit) {
                    const pinNumber = (furnitureActiveData.pins?.length || 0) + 1;
                    const displayLabel = rawLabel.replace(/^新北市鶯歌區/, '').trim() || rawLabel;
                    addFurniturePinToWorkspace(arcgisHit.lng, arcgisHit.lat, displayLabel, {
                        note: noteText,
                        needsWoodTruckSupport: isWood,
                        silent: true
                    });
                    if (isWood) woodCount++;
                    addedPins.push({
                        order: pinNumber,
                        lng: arcgisHit.lng,
                        lat: arcgisHit.lat,
                        label: displayLabel,
                        sourceLabel: '[ArcGIS門牌]',
                        isWood
                    });
                    continue;
                }

                // 【第三順位】鶯歌區範圍備援：呼叫 OpenStreetMap Nominatim (bounded=1&viewbox=121.30,25.01,121.39,24.92)
                const osmHit = await geocodeAddressWithNominatimBounded(fullAddrForGeocode);
                if (osmHit) {
                    const pinNumber = (furnitureActiveData.pins?.length || 0) + 1;
                    const displayLabel = rawLabel.replace(/^新北市鶯歌區/, '').trim() || rawLabel;
                    addFurniturePinToWorkspace(osmHit.lng, osmHit.lat, displayLabel, {
                        note: noteText,
                        needsWoodTruckSupport: isWood,
                        silent: true
                    });
                    if (isWood) woodCount++;
                    addedPins.push({
                        order: pinNumber,
                        lng: osmHit.lng,
                        lat: osmHit.lat,
                        label: displayLabel,
                        sourceLabel: '[OSM備援]',
                        isWood
                    });
                    continue;
                }

                unresolvedItems.push(`${rawLabel}（查無鶯歌區對應社區或門牌座標）`);
            }

            renderAllFurnitureMapElements();
            await syncActiveFurnitureToFirebase(false);
            vibrate([40, 30, 50]);

            // 自動將地圖視野縮放涵蓋所有新插的定位針
            if (addedPins.length === 1) {
                setCameraFollow(false);
                map.flyTo({ center: [addedPins[0].lng, addedPins[0].lat], zoom: 17.5, duration: 650 });
            } else if (addedPins.length >= 2) {
                setCameraFollow(false);
                const bounds = new maplibregl.LngLatBounds();
                addedPins.forEach(p => bounds.extend([p.lng, p.lat]));
                map.fitBounds(bounds, { padding: { top: 90, bottom: 90, left: 60, right: 60 }, maxZoom: 17.5, duration: 700 });
            }

            // 組裝結果區頂部連線狀態列 ＋ 每筆插針來源明細 ([社區庫] / [ArcGIS門牌] / [OSM備援])
            const headerHtml = `<div class="pb-1.5 mb-1.5 border-b border-emerald-200 font-black text-emerald-900">🟢 AI 地址整理＋三層精準定位完成（Key：${usedKeyNote}｜AI 耗時 ${elapsedSec}s）</div>`;

            const pinsListHtml = addedPins.length > 0
                ? `<div class="space-y-1 max-h-40 overflow-y-auto pr-1">` +
                  addedPins.map(p => {
                      let badgeCls = 'bg-blue-100 text-blue-800 border-blue-300';
                      if (p.sourceLabel === '[社區庫]') {
                          badgeCls = 'bg-orange-100 text-orange-800 border-orange-300';
                      } else if (p.sourceLabel === '[OSM備援]') {
                          badgeCls = 'bg-amber-100 text-amber-800 border-amber-300';
                      }
                      const woodTag = p.isWood
                          ? '<span class="bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded ml-1">🔥純木頭</span>'
                          : '';
                      return `<div class="flex items-center justify-between gap-1.5 text-[11px] bg-white/85 px-2 py-1 rounded-lg border border-emerald-200/80">` +
                          `<span class="font-black text-gray-900 truncate">#${p.order} ${p.label}${woodTag}</span>` +
                          `<span class="text-[10px] font-black px-1.5 py-0.5 rounded border flex-shrink-0 ${badgeCls}">${p.sourceLabel}</span>` +
                          `</div>`;
                  }).join('') +
                  `</div>`
                : '';

            const outOfRangeHtml = unresolvedItems.length > 0
                ? `<div class="mt-2 pt-1.5 border-t border-amber-300 text-amber-800">` +
                  `⚠️ 以下 <b>${unresolvedItems.length}</b> 筆地址未能查得鶯歌區座標，請透過上方搜尋欄手動確認：` +
                  `<ul class="mt-1 ml-4 list-disc text-[11px]">${unresolvedItems.map(x => `<li>${x}</li>`).join('')}</ul>` +
                  `</div>`
                : '';

            showProgressStatus(
                headerHtml +
                `<div class="mb-1.5 text-emerald-800">✅ 已自動在地圖依序插針 <b>${addedPins.length}</b> 處${woodCount > 0 ? `（含 🔥 純木頭火紅標記 <b>${woodCount}</b> 處）` : ''}：</div>` +
                pinsListHtml +
                outOfRangeHtml,
                'success'
            );

            showFurnitureToast(`✨ 已精準插針 ${addedPins.length} 處${woodCount > 0 ? `（含 🔥 純木頭 ${woodCount} 處）` : ''}`);
        } catch (err) {
            showProgressStatus(
                `🔴 AI 派工失敗：${err?.message || '未知連線或解析錯誤，請檢查開發者模式 API Key 設定'}`,
                'error'
            );
        } finally {
            runBtn.disabled = false;
            runBtn.innerHTML = origBtnHtml;
        }
    });
})();

// ==========================================
// 🔀 開發者模式「🛋️ 家具模式」與「一般收運模式」嚴格隔離切換邏輯
// ==========================================
function syncAdminFurnitureEntryButtonUI() {
    const adminLaunchBtn = document.getElementById('btnAdminLaunchFurnitureMode');
    const adminBtnIcon = document.getElementById('adminFurnitureBtnIcon');
    const adminBtnLabel = document.getElementById('adminFurnitureBtnLabel');

    if (isFurnitureModeActive) {
        if (adminLaunchBtn) {
            adminLaunchBtn.className = 'bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-3.5 py-2.5 rounded-xl shadow-md active:scale-95 transition-all whitespace-nowrap flex-shrink-0 flex items-center gap-1.5';
        }
        if (adminBtnIcon) adminBtnIcon.textContent = '🚛';
        if (adminBtnLabel) adminBtnLabel.textContent = '返回一般收運';
    } else {
        if (adminLaunchBtn) {
            adminLaunchBtn.className = 'bg-amber-600 hover:bg-amber-700 text-white font-black text-xs px-3.5 py-2.5 rounded-xl shadow-md active:scale-95 transition-all whitespace-nowrap flex-shrink-0 flex items-center gap-1.5';
        }
        if (adminBtnIcon) adminBtnIcon.textContent = '🛋️';
        if (adminBtnLabel) adminBtnLabel.textContent = '切換家具模式';
    }
}

function setFurnitureModeActive(enable, options = {}) {
    const furnitureUI = document.getElementById('furnitureModeUI');
    const furnitureLeftConnectControls = document.getElementById('furnitureLeftConnectControls');
    const exitFurnitureBtn = document.getElementById('btnExitFurnitureMode');
    const topNavHeaderBar = document.getElementById('topNavHeaderBar');
    const mainUI = document.getElementById('mainUI');
    const routeDetailUI = document.getElementById('routeDetailUI');
    const editRouteBar = document.getElementById('editRouteBar');
    const playbackUI = document.getElementById('playbackUI');
    const manualDrawUI = document.getElementById('manualDrawUI');
    const manualDrawTopBanner = document.getElementById('manualDrawTopBanner');
    const topBackBtn = document.getElementById('topBackBtn');
    const appStatusTitle = document.getElementById('appStatusTitle');

    if (enable) {
        isFurnitureModeActive = true;
        window.isFurnitureModeActive = true;

        normalModeRestoreSnapshot = {
            mainHidden: mainUI ? mainUI.classList.contains('hidden') : false,
            detailHidden: routeDetailUI ? routeDetailUI.classList.contains('hidden') : true,
            editHidden: editRouteBar ? editRouteBar.classList.contains('hidden') : true,
            playbackHidden: playbackUI ? playbackUI.classList.contains('hidden') : true,
            manualHidden: manualDrawUI ? manualDrawUI.classList.contains('hidden') : true,
            manualBannerHidden: manualDrawTopBanner ? manualDrawTopBanner.classList.contains('hidden') : true,
            topBackHidden: topBackBtn ? topBackBtn.classList.contains('hidden') : true,
            statusTitle: appStatusTitle ? appStatusTitle.innerText : '鶯歌清運路線助手 Pro Max',
            bgGeoJSON: cachedBgRouteGeoJSON,
            silentGeoJSON: cachedSilentRouteGeoJSON,
            musicGeoJSON: cachedMusicRouteGeoJSON,
            calloutGeoJSON: cachedCalloutLinesGeoJSON
        };

        mainUI?.classList.add('hidden');
        routeDetailUI?.classList.add('hidden');
        editRouteBar?.classList.add('hidden');
        playbackUI?.classList.add('hidden');
        manualDrawUI?.classList.add('hidden');
        manualDrawTopBanner?.classList.add('hidden');
        topBackBtn?.classList.add('hidden');

        clearDomMarkers();
        cachedBgRouteGeoJSON = emptyGeoJSON();
        cachedSilentRouteGeoJSON = emptyGeoJSON();
        cachedMusicRouteGeoJSON = emptyGeoJSON();
        cachedCalloutLinesGeoJSON = emptyGeoJSON();
        try {
            map.getSource('bg-route')?.setData(cachedBgRouteGeoJSON);
            map.getSource('route-Silent')?.setData(cachedSilentRouteGeoJSON);
            map.getSource('route-music')?.setData(cachedMusicRouteGeoJSON);
            map.getSource('callout-lines-source')?.setData(cachedCalloutLinesGeoJSON);
        } catch (e) {}

        if (appStatusTitle) {
            appStatusTitle.innerText = '🛋️ 家具模式';
        }
        // 往下移至 top-16 (64px)，徹底避開頂部搜尋框與右側「✨ AI 派工」按鈕，確保手機窄螢幕絕不重疊遮擋
        if (topNavHeaderBar) {
            topNavHeaderBar.classList.remove('top-6', 'top-14');
            topNavHeaderBar.classList.add('top-16');
        }

        furnitureUI?.classList.remove('hidden');
        furnitureLeftConnectControls?.classList.remove('hidden');
        exitFurnitureBtn?.classList.remove('hidden');
        syncAdminFurnitureEntryButtonUI();
        fetchAndSyncTodayFurnitureCollab();
        renderAllFurnitureMapElements();
    } else {
        // 1. 自動結束家具模式的循跡導航或路線播放狀態
        if (window.isFurnitureNavOrReplayActive) {
            window.isFurnitureNavOrReplayActive = false;
            window.activeFurnitureSyntheticRoute = null;

            if (isReplaying) {
                stopSmoothPlayback();
                VoiceQueue.clear();
                document.getElementById('playbackUI')?.classList.add('hidden');
                document.getElementById('musicAlertBanner')?.classList.add('hidden');
                restoreRealGpsAfterReplay(true);
            }

            if (followWatchId !== null || activeFollowGpsHandler !== null) {
                VoiceQueue.clear();
                activeFollowGpsHandler = null;
                if (followWatchId !== null) {
                    navigator.geolocation.clearWatch(followWatchId);
                    followWatchId = null;
                }
                if (window.tacticalTimer !== null) {
                    clearInterval(window.tacticalTimer);
                    window.tacticalTimer = null;
                }
                window.activeFollowMappedEvents = null;
                document.getElementById('tacticalTimePanel')?.classList.add('hidden');
                document.getElementById('tacticalStopBtn')?.classList.add('hidden');
                document.getElementById('tacticalQuickAlertBtn')?.classList.add('hidden');
                document.getElementById('musicAlertBanner')?.classList.add('hidden');
                document.getElementById('offRouteWarning')?.classList.add('hidden');
                exitBlackPowerSaveMode(false);
                releaseScreenWakeLockIfIdle();
                startIdleGPS();
            }
        }

        // 2. 自動結束手動拉線、搜尋預覽與彈窗狀態
        if (isFurnitureManualConnecting) {
            stopFurnitureManualConnectMode(false);
        }
        clearFurnitureSearchPreviewMarker();
        closeFurniturePinPopup();
        closeAiDispatchModal();

        const searchInput = document.getElementById('furnitureAddressSearchInput');
        if (searchInput) searchInput.value = '';
        document.getElementById('btnClearFurnitureSearch')?.classList.add('hidden');
        document.getElementById('btnQuickDropSearchPin')?.classList.add('hidden');
        document.getElementById('furnitureSearchResultsPanel')?.classList.add('hidden');

        // 3. 將家具模式的暫存插針與未完成路線收起／清空
        if (options.clearTemporaryFurnitureState && furnitureActiveData) {
            // 保留已標記「🔥 需垃圾車支援（純木頭）」且未收運的點位供一般垃圾車檢視，其餘暫存插針與未完成路線全部清空收起
            const keptWoodSupportPins = Array.isArray(furnitureActiveData.pins)
                ? furnitureActiveData.pins.filter(p => p && p.needsWoodTruckSupport && !p.collected)
                : [];
            furnitureActiveData.pins = keptWoodSupportPins;
            furnitureActiveData.routeCoords = [];
            furnitureActiveData.distanceKm = '0.00';
            furnitureActiveData.updatedAt = Date.now();
            isLocalFurnitureDirty = false;
            saveLocalFurnitureBackup();
            syncActiveFurnitureToFirebase(false);
        }

        isFurnitureModeActive = false;
        window.isFurnitureModeActive = false;

        furnitureUI?.classList.add('hidden');
        furnitureLeftConnectControls?.classList.add('hidden');
        exitFurnitureBtn?.classList.add('hidden');
        document.getElementById('furnitureRouteNavBar')?.classList.add('hidden');

        if (topNavHeaderBar) {
            topNavHeaderBar.classList.remove('top-14', 'top-16');
            topNavHeaderBar.classList.add('top-6');
        }
        syncAdminFurnitureEntryButtonUI();

        if (normalModeRestoreSnapshot) {
            if (mainUI) mainUI.classList.toggle('hidden', normalModeRestoreSnapshot.mainHidden);
            if (routeDetailUI) routeDetailUI.classList.toggle('hidden', normalModeRestoreSnapshot.detailHidden);
            if (editRouteBar) editRouteBar.classList.toggle('hidden', normalModeRestoreSnapshot.editHidden);
            if (playbackUI) playbackUI.classList.toggle('hidden', normalModeRestoreSnapshot.playbackHidden);
            if (manualDrawUI) manualDrawUI.classList.toggle('hidden', normalModeRestoreSnapshot.manualHidden);
            if (manualDrawTopBanner) manualDrawTopBanner.classList.toggle('hidden', normalModeRestoreSnapshot.manualBannerHidden);
            if (topBackBtn) topBackBtn.classList.toggle('hidden', normalModeRestoreSnapshot.topBackHidden);
            if (appStatusTitle) appStatusTitle.innerText = normalModeRestoreSnapshot.statusTitle;

            cachedBgRouteGeoJSON = normalModeRestoreSnapshot.bgGeoJSON || emptyGeoJSON();
            cachedSilentRouteGeoJSON = normalModeRestoreSnapshot.silentGeoJSON || emptyGeoJSON();
            cachedMusicRouteGeoJSON = normalModeRestoreSnapshot.musicGeoJSON || emptyGeoJSON();
            cachedCalloutLinesGeoJSON = normalModeRestoreSnapshot.calloutGeoJSON || emptyGeoJSON();
            try {
                map.getSource('bg-route')?.setData(cachedBgRouteGeoJSON);
                map.getSource('route-Silent')?.setData(cachedSilentRouteGeoJSON);
                map.getSource('route-music')?.setData(cachedMusicRouteGeoJSON);
                map.getSource('callout-lines-source')?.setData(cachedCalloutLinesGeoJSON);
            } catch (e) {}

            if (!normalModeRestoreSnapshot.editHidden && isEditingMode) {
                const activeRoute = getActiveWorkingRoute();
                if (activeRoute) {
                    renderEditableRouteMarkers(activeRoute);
                    renderPathEditNodes(activeRoute);
                }
            } else if (!normalModeRestoreSnapshot.detailHidden && selectedRouteIdx >= 0 && savedRoutes[selectedRouteIdx]) {
                renderRouteMarkers(savedRoutes[selectedRouteIdx]);
            }
        } else {
            mainUI?.classList.remove('hidden');
            if (appStatusTitle) appStatusTitle.innerText = '鶯歌清運路線助手 Pro Max';
        }

        renderAllFurnitureMapElements();
    }
}

document.getElementById('btnAdminLaunchFurnitureMode')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('adminSettingsModal')?.classList.add('hidden');
    if (isFurnitureModeActive) {
        vibrate(30);
        setFurnitureModeActive(false, { clearTemporaryFurnitureState: true });
    } else {
        vibrate(30);
        setFurnitureModeActive(true);
    }
});

document.getElementById('btnExitFurnitureMode')?.addEventListener('click', (e) => {
    e.stopPropagation();
    vibrate(30);
    setFurnitureModeActive(false, { clearTemporaryFurnitureState: true });
});

// 啟動時載入當日本機備份並每 6 秒從 Firebase 同步當日家具路線與「🔥 需垃圾車支援（純木頭）」火紅標記
(function initFurnitureCollabSystem() {
    const localData = loadLocalFurnitureBackup();
    if (localData) {
        furnitureActiveData = localData;
    }
    updateFurniturePanelUI();
    fetchAndSyncTodayFurnitureCollab();
    setInterval(fetchAndSyncTodayFurnitureCollab, 6000);
})();
