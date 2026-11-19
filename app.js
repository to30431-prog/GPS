// ==========================================
// 🔑 雲端路線庫管理員密碼設定（可於此處輕鬆修改）
// ==========================================
const ADMIN_PASSWORD = '5201314';

// ==========================================
// 🛡️ 行車弱訊號防凍結保護：5 秒超時中斷 Fetch 封裝
// ==========================================
async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        return response;
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
const DEFAULT_SYSTEM_CONFIG = {
    radarIntervalSec: 5,
    lookAheadDistMeters: 100,
    confirmDistMeters: 45,
    bearingToleranceDeg: 30,
    voiceRate: 1.1,
    lowSpeedZoom: 17.5,
    highSpeedZoom: 14.5,
    enableDynamicZoom: true,
    enableAutoNightMode: true,
    showOnlineFleetList: true,
    maxAccuracyMeters: 45,
    maxSpeedKmh: 160,
    minLockSpeedKmh: 4,
    announcementText: ''
};

function clampNum(val, min, max, fallback) {
    const n = Number(val);
    if (isNaN(n)) return fallback;
    return Math.min(Math.max(n, min), max);
}

function normalizeSystemConfig(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    return {
        radarIntervalSec: clampNum(src.radarIntervalSec, 2, 120, DEFAULT_SYSTEM_CONFIG.radarIntervalSec),
        lookAheadDistMeters: clampNum(src.lookAheadDistMeters, 20, 600, DEFAULT_SYSTEM_CONFIG.lookAheadDistMeters),
        confirmDistMeters: clampNum(src.confirmDistMeters, 10, 200, DEFAULT_SYSTEM_CONFIG.confirmDistMeters),
        bearingToleranceDeg: clampNum(src.bearingToleranceDeg, 5, 180, DEFAULT_SYSTEM_CONFIG.bearingToleranceDeg),
        voiceRate: Number(clampNum(src.voiceRate, 0.8, 1.5, DEFAULT_SYSTEM_CONFIG.voiceRate).toFixed(2)),
        lowSpeedZoom: Number(clampNum(src.lowSpeedZoom, 12, 21, DEFAULT_SYSTEM_CONFIG.lowSpeedZoom).toFixed(2)),
        highSpeedZoom: Number(clampNum(src.highSpeedZoom, 10, 20, DEFAULT_SYSTEM_CONFIG.highSpeedZoom).toFixed(2)),
        enableDynamicZoom: typeof src.enableDynamicZoom === 'boolean' ? src.enableDynamicZoom : DEFAULT_SYSTEM_CONFIG.enableDynamicZoom,
        enableAutoNightMode: typeof src.enableAutoNightMode === 'boolean' ? src.enableAutoNightMode : DEFAULT_SYSTEM_CONFIG.enableAutoNightMode,
        showOnlineFleetList: typeof src.showOnlineFleetList === 'boolean' ? src.showOnlineFleetList : DEFAULT_SYSTEM_CONFIG.showOnlineFleetList,
        maxAccuracyMeters: clampNum(src.maxAccuracyMeters, 5, 300, DEFAULT_SYSTEM_CONFIG.maxAccuracyMeters),
        maxSpeedKmh: clampNum(src.maxSpeedKmh, 30, 300, DEFAULT_SYSTEM_CONFIG.maxSpeedKmh),
        minLockSpeedKmh: Number(clampNum(src.minLockSpeedKmh, 0.5, 30, DEFAULT_SYSTEM_CONFIG.minLockSpeedKmh).toFixed(1)),
        announcementText: typeof src.announcementText === 'string' ? src.announcementText.trim() : DEFAULT_SYSTEM_CONFIG.announcementText
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

function processFilteredGpsPosition(pos) {
    if (!pos || !pos.coords) return null;
    const rawLat = Number(pos.coords.latitude);
    const rawLng = Number(pos.coords.longitude);
    if (isNaN(rawLat) || isNaN(rawLng)) return null;

    const accuracy = typeof pos.coords.accuracy === 'number' && !isNaN(pos.coords.accuracy)
        ? pos.coords.accuracy
        : 10;

    const maxAccuracyMeters = Number(systemNavConfig.maxAccuracyMeters) || DEFAULT_SYSTEM_CONFIG.maxAccuracyMeters;
    const maxSpeedKmh = Number(systemNavConfig.maxSpeedKmh) || DEFAULT_SYSTEM_CONFIG.maxSpeedKmh;
    const minLockSpeedKmh = Number(systemNavConfig.minLockSpeedKmh) || DEFAULT_SYSTEM_CONFIG.minLockSpeedKmh;

    // 1. 剔除低精度飄移點：保留 accuracy <= maxAccuracyMeters (預設 45 公尺)，超過直接捨棄
    if (accuracy > maxAccuracyMeters) {
        return null;
    }

    const now = Date.now();
    // 防止多個 watchPosition 監聽器在極短時間內收到同一筆硬體座標時重複計算造成誤判靜止
    const fixKey = `${rawLat.toFixed(6)},${rawLng.toFixed(6)}`;
    if (fixKey === lastRawGpsFixKey && (now - lastRawGpsFixWallTime) < 350 && lastFilteredGpsResult) {
        return lastFilteredGpsResult;
    }

    const rawSpeed = (typeof pos.coords.speed === 'number' && !isNaN(pos.coords.speed) && pos.coords.speed >= 0)
        ? pos.coords.speed
        : null;

    // 首次取得合格高精度定位：直接初始化基準點（不使用電子羅盤 heading）
    if (lastValidGpsLat === null || lastValidGpsLng === null) {
        lastValidGpsLat = rawLat;
        lastValidGpsLng = rawLng;
        lastValidGpsTime = now;
        lastKnownLngLat = [rawLng, rawLat];
        const firstRes = {
            lng: rawLng,
            lat: rawLat,
            heading: currentHeading,
            speedKmh: rawSpeed !== null ? (rawSpeed * 3.6) : 0,
            accuracy,
            isStationary: false,
            isFirstFix: true
        };
        lastRawGpsFixKey = fixKey;
        lastRawGpsFixWallTime = now;
        lastFilteredGpsResult = firstRes;
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

    // 3. 停車與低速防抖動鎖定：當車速 < minLockSpeedKmh (預設 4 km/h) 或位移 < 5m 時，鎖死最後車頭角度（currentHeading）
    if (distMeters < 5 || effectiveSpeedKmh < minLockSpeedKmh) {
        lastKnownLngLat = [lastValidGpsLng, lastValidGpsLat];
        const stationaryRes = {
            lng: lastValidGpsLng,
            lat: lastValidGpsLat,
            heading: currentHeading,
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
    currentHeading = getBearing(lastValidGpsLng, lastValidGpsLat, smoothedLng, smoothedLat);

    lastValidGpsLng = smoothedLng;
    lastValidGpsLat = smoothedLat;
    lastValidGpsTime = now;
    lastKnownLngLat = [smoothedLng, smoothedLat];

    const movingSpeedKmh = Math.min(effectiveSpeedKmh, maxSpeedKmh);
    const movingRes = {
        lng: smoothedLng,
        lat: smoothedLat,
        heading: currentHeading,
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

function startIdleGPS() {
    stopIdleGPS();
    if (!('geolocation' in navigator)) return;
    idleWatchId = navigator.geolocation.watchPosition(pos => {
        const filtered = processFilteredGpsPosition(pos);
        if (!filtered) return; // 誤差 > 45m 或 > 160km/h 暴衝跳點直接捨棄

        checkAndApplyAutoDayNightMode(filtered.lat, filtered.lng);

        if (!isPowerSaveMapPaused()) {
            const acc = Math.round(filtered.accuracy);
            const accEl = document.getElementById('accuracyText');
            if (accEl) accEl.innerText = `± ${acc} m`;
            if (vehicleMarker) {
                smoothMoveVehicleMarker(lastKnownLngLat, filtered.heading, 750);
            }
            if (!filtered.isStationary && isFollowingCamera) {
                const targetZoom = getDynamicZoomBySpeed(filtered.speedKmh);
                map.easeTo({
                    center: lastKnownLngLat,
                    zoom: targetZoom,
                    bearing: isHeadingUpMode ? filtered.heading : map.getBearing(),
                    offset: [0, 100],
                    duration: 600
                });
            }
        }
        if (!filtered.isStationary && typeof window.onFleetPositionUpdate === 'function') {
            window.onFleetPositionUpdate(filtered.lat, filtered.lng);
        }
    }, () => {}, { enableHighAccuracy: true });
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

// --- 1. 初始化 MapLibre GL 向量旋轉地圖（無字底圖 ＋ 獨立向量文字標註層，確保「車頭朝上」旋轉時所有路名、地名、地標文字永遠與螢幕水平直立） ---
const VIEWPORT_SYMBOL_ALIGNMENT_LAYOUT = {
    'text-rotation-alignment': 'viewport',
    'icon-rotation-alignment': 'viewport',
    'text-pitch-alignment': 'viewport',
    'icon-pitch-alignment': 'viewport',
    'text-keep-upright': true
};

const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
            'google-maps': {
                type: 'raster',
                // 移除底圖圖片內嵌的死文字 (s.e:l|p.v:off)，改由下方 MapLibre 向量 Symbol 圖層動態渲染並強制 viewport 螢幕水平對齊
                tiles: ['https://mt1.google.com/vt/lyrs=m&apistyle=s.e:l%7Cp.v:off&x={x}&y={y}&z={z}'],
                tileSize: 256,
                attribution: '© Google, © OpenStreetMap'
            },
            'openmaptiles': {
                type: 'vector',
                url: 'https://tiles.openfreemap.org/planet'
            }
        },
        layers: [
            {
                id: 'google-maps-layer',
                type: 'raster',
                source: 'google-maps'
            },
            {
                id: 'highway-name-path',
                type: 'symbol',
                source: 'openmaptiles',
                'source-layer': 'transportation_name',
                minzoom: 15.5,
                filter: ['==', ['get', 'class'], 'path'],
                layout: {
                    ...VIEWPORT_SYMBOL_ALIGNMENT_LAYOUT,
                    'symbol-placement': 'point',
                    'text-field': ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name:latin'], ['get', 'name']],
                    'text-font': ['Noto Sans Regular'],
                    'text-size': 12,
                    'text-max-width': 9
                },
                paint: {
                    'text-color': '#475569',
                    'text-halo-color': 'rgba(255,255,255,0.95)',
                    'text-halo-width': 2
                }
            },
            {
                id: 'highway-name-minor',
                type: 'symbol',
                source: 'openmaptiles',
                'source-layer': 'transportation_name',
                minzoom: 14,
                filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track']]],
                layout: {
                    ...VIEWPORT_SYMBOL_ALIGNMENT_LAYOUT,
                    'symbol-placement': 'point',
                    'text-field': ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name:latin'], ['get', 'name']],
                    'text-font': ['Noto Sans Bold'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 14, 12, 17, 14, 19, 15.5],
                    'text-max-width': 10,
                    'text-padding': 14
                },
                paint: {
                    'text-color': '#1e293b',
                    'text-halo-color': 'rgba(255,255,255,0.96)',
                    'text-halo-width': 2.2
                }
            },
            {
                id: 'highway-name-major',
                type: 'symbol',
                source: 'openmaptiles',
                'source-layer': 'transportation_name',
                minzoom: 11.5,
                filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'trunk', 'motorway']]],
                layout: {
                    ...VIEWPORT_SYMBOL_ALIGNMENT_LAYOUT,
                    'symbol-placement': 'point',
                    'text-field': ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name:latin'], ['get', 'name']],
                    'text-font': ['Noto Sans Bold'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 12, 12.5, 15, 14.5, 18, 16.5],
                    'text-max-width': 10,
                    'text-padding': 16
                },
                paint: {
                    'text-color': '#0f172a',
                    'text-halo-color': 'rgba(255,255,255,0.98)',
                    'text-halo-width': 2.5
                }
            },
            {
                id: 'housenumber-label',
                type: 'symbol',
                source: 'openmaptiles',
                'source-layer': 'housenumber',
                minzoom: 17.2,
                layout: {
                    ...VIEWPORT_SYMBOL_ALIGNMENT_LAYOUT,
                    'text-field': '{housenumber}',
                    'text-font': ['Noto Sans Regular'],
                    'text-size': 10.5,
                    'text-padding': 4
                },
                paint: {
                    'text-color': '#475569',
                    'text-halo-color': 'rgba(255,255,255,0.92)',
                    'text-halo-width': 1.6
                }
            },
            {
                id: 'poi-label',
                type: 'symbol',
                source: 'openmaptiles',
                'source-layer': 'poi',
                minzoom: 14.5,
                filter: ['has', 'name'],
                layout: {
                    ...VIEWPORT_SYMBOL_ALIGNMENT_LAYOUT,
                    'text-field': ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name:latin'], ['get', 'name']],
                    'text-font': ['Noto Sans Regular'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 14.5, 11.5, 17, 13],
                    'text-max-width': 8,
                    'text-padding': 8
                },
                paint: {
                    'text-color': '#b45309',
                    'text-halo-color': 'rgba(255,255,255,0.96)',
                    'text-halo-width': 2
                }
            },
            {
                id: 'place-village-label',
                type: 'symbol',
                source: 'openmaptiles',
                'source-layer': 'place',
                minzoom: 12,
                filter: ['in', ['get', 'class'], ['literal', ['village', 'suburb', 'neighbourhood', 'quarter', 'hamlet']]],
                layout: {
                    ...VIEWPORT_SYMBOL_ALIGNMENT_LAYOUT,
                    'text-field': ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name:latin'], ['get', 'name']],
                    'text-font': ['Noto Sans Bold'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 12, 12.5, 16, 15],
                    'text-max-width': 8,
                    'text-padding': 10
                },
                paint: {
                    'text-color': '#334155',
                    'text-halo-color': 'rgba(255,255,255,0.96)',
                    'text-halo-width': 2.2
                }
            },
            {
                id: 'place-town-label',
                type: 'symbol',
                source: 'openmaptiles',
                'source-layer': 'place',
                minzoom: 9,
                maxzoom: 16,
                filter: ['in', ['get', 'class'], ['literal', ['town', 'city']]],
                layout: {
                    ...VIEWPORT_SYMBOL_ALIGNMENT_LAYOUT,
                    'text-field': ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name:latin'], ['get', 'name']],
                    'text-font': ['Noto Sans Bold'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 9, 13, 14, 17],
                    'text-max-width': 8
                },
                paint: {
                    'text-color': '#0f172a',
                    'text-halo-color': 'rgba(255,255,255,0.98)',
                    'text-halo-width': 2.4
                }
            }
        ]
    },
    center: [121.346, 24.954],
    zoom: 16, bearing: 0, pitch: 0, dragRotate: true, touchZoomRotate: true
});

setTimeout(() => { map.resize(); }, 500);
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
// 🌗 自動日夜模式（依裝置經緯度與當下日期時間計算日出／日落，天黑自動切換暗色系夜間地圖樣式）
// ==========================================
let isNightMapStyleActive = null;

function computeSunriseSunset(lat = 24.954, lng = 121.346, date = new Date()) {
    const toRad = d => d * Math.PI / 180;
    const toDeg = r => r * 180 / Math.PI;

    const startOfYear = new Date(date.getFullYear(), 0, 0);
    const diffMs = date - startOfYear;
    const dayOfYear = Math.floor(diffMs / 86400000);

    // 太陽赤緯角 (Solar Declination)
    const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (date.getHours() - 12) / 24);
    const eqTime = 229.18 * (
        0.000075 +
        0.001868 * Math.cos(gamma) -
        0.032077 * Math.sin(gamma) -
        0.014615 * Math.cos(2 * gamma) -
        0.040849 * Math.sin(2 * gamma)
    );
    const decl = 0.006918 -
        0.399912 * Math.cos(gamma) +
        0.070257 * Math.sin(gamma) -
        0.006758 * Math.cos(2 * gamma) +
        0.000907 * Math.sin(2 * gamma) -
        0.002697 * Math.cos(3 * gamma) +
        0.00148 * Math.sin(3 * gamma);

    const zenith = 90.833;
    const cosHa = (Math.cos(toRad(zenith)) / (Math.cos(toRad(lat)) * Math.cos(decl))) -
                  (Math.tan(toRad(lat)) * Math.tan(decl));

    // 極晝／極夜防呆 fallback（台灣緯度不會發生，預設 06:00 ~ 18:00）
    if (cosHa > 1 || cosHa < -1 || isNaN(cosHa)) {
        const curHr = date.getHours() + date.getMinutes() / 60;
        return { sunriseHour: 6.0, sunsetHour: 18.0, isNight: (curHr < 6.0 || curHr >= 18.0) };
    }

    const haDeg = toDeg(Math.acos(cosHa));
    const tzOffsetHours = -date.getTimezoneOffset() / 60;
    const solarNoonMin = 720 - (4 * lng) - eqTime + (tzOffsetHours * 60);
    const sunriseMin = solarNoonMin - haDeg * 4;
    const sunsetMin = solarNoonMin + haDeg * 4;

    const sunriseHour = sunriseMin / 60;
    const sunsetHour = sunsetMin / 60;
    const currentLocalHour = date.getHours() + date.getMinutes() / 60;
    const isNight = (currentLocalHour < sunriseHour || currentLocalHour >= sunsetHour);

    return { sunriseHour, sunsetHour, isNight };
}

function applyDayNightMapTheme(isNight) {
    if (!map || !map.getLayer('google-maps-layer')) return;
    if (isNightMapStyleActive === isNight) return;
    isNightMapStyleActive = isNight;

    try {
        if (isNight) {
            // 🌙 夜間暗色系護眼地圖樣式：壓低底圖反光亮度與飽和度，同時讓綠色／藍色清運路線與標記維持高對比清晰度
            map.setPaintProperty('google-maps-layer', 'raster-brightness-max', 0.42);
            map.setPaintProperty('google-maps-layer', 'raster-brightness-min', 0.04);
            map.setPaintProperty('google-maps-layer', 'raster-saturation', -0.45);
            map.setPaintProperty('google-maps-layer', 'raster-contrast', 0.18);
            document.body?.classList.add('night-map-mode');
        } else {
            // ☀️ 日間高清晰明亮地圖樣式
            map.setPaintProperty('google-maps-layer', 'raster-brightness-max', 1.0);
            map.setPaintProperty('google-maps-layer', 'raster-brightness-min', 0.0);
            map.setPaintProperty('google-maps-layer', 'raster-saturation', 0.0);
            map.setPaintProperty('google-maps-layer', 'raster-contrast', 0.0);
            document.body?.classList.remove('night-map-mode');
        }
    } catch (e) {}
}

function checkAndApplyAutoDayNightMode(lat, lng, date = new Date()) {
    const useLat = (typeof lat === 'number' && !isNaN(lat)) ? lat : (lastKnownLngLat?.[1] ?? 24.954);
    const useLng = (typeof lng === 'number' && !isNaN(lng)) ? lng : (lastKnownLngLat?.[0] ?? 121.346);
    if (!systemNavConfig.enableAutoNightMode) {
        applyDayNightMapTheme(false);
        return { sunriseHour: 6.0, sunsetHour: 18.0, isNight: false };
    }
    const sunInfo = computeSunriseSunset(useLat, useLng, date);
    applyDayNightMapTheme(sunInfo.isNight);
    return sunInfo;
}
window.checkAndApplyAutoDayNightMode = checkAndApplyAutoDayNightMode;
setInterval(() => {
    checkAndApplyAutoDayNightMode();
}, 60000);

// ==========================================
// 🗺️ 地圖路名、地名、地標文字與自訂符號圖層永遠與手機螢幕水平對齊 (viewport + text-keep-upright: true)
// 徹底防止「車頭朝上」旋轉地圖時文字或圖標跟著傾斜、顛倒
// ==========================================
function fixSymbolTextAlignment() {
    try {
        const style = map.getStyle();
        if (!style || !style.layers) return;

        style.layers.forEach(layer => {
            if (layer.type === 'symbol') {
                try {
                    map.setLayoutProperty(layer.id, 'text-rotation-alignment', 'viewport');
                    map.setLayoutProperty(layer.id, 'icon-rotation-alignment', 'viewport');
                    map.setLayoutProperty(layer.id, 'text-pitch-alignment', 'viewport');
                    map.setLayoutProperty(layer.id, 'icon-pitch-alignment', 'viewport');
                    map.setLayoutProperty(layer.id, 'text-keep-upright', true);
                } catch (e) {}
            }
        });
    } catch (e) {
        console.error("修正字體對齊時發生錯誤:", e);
    }
}

map.on('load', () => {
    // 僅有黃色清運車輛 Marker (vehicleMarker) 保留 rotationAlignment: 'map' 隨車頭方位角旋轉
    vehicleMarker = new maplibregl.Marker({ element: puckEl, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(lastKnownLngLat).addTo(map);
    vehicleVisualLngLat = [...lastKnownLngLat];
    vehicleVisualHeading = currentHeading;
    
    map.addSource('bg-route', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'bg-route-line', type: 'line', source: 'bg-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#94a3b8', 'line-width': 6, 'line-opacity': 0.45 } });
    map.addSource('route-Silent', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'route-silent-line', type: 'line', source: 'route-Silent', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#3b82f6', 'line-width': 6, 'line-dasharray': [2, 2] } });
    map.addSource('route-music', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'route-music-line', type: 'line', source: 'route-music', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#16a34a', 'line-width': 7 } });
    map.addSource('freehand-temp-source', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'freehand-temp-layer', type: 'line', source: 'freehand-temp-source', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#f97316', 'line-width': 6, 'line-dasharray': [2, 1.5], 'line-opacity': 0.95 } });

    // 自訂標記點與起終點 Symbol Layer 防斜保護（強制 viewport 螢幕水平對齊）
    map.addSource('custom-route-symbols', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({
        id: 'custom-route-symbols-layer',
        type: 'symbol',
        source: 'custom-route-symbols',
        layout: {
            "text-rotation-alignment": "viewport",
            "icon-rotation-alignment": "viewport",
            "text-pitch-alignment": "viewport",
            "icon-pitch-alignment": "viewport",
            "text-keep-upright": true,
            "text-field": ["get", "label"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 12,
            "text-offset": [0, 1.2]
        },
        paint: {
            "text-color": "#0f172a",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2
        }
    });

    // 修正地圖所有文字與符號圖層對齊（避免車頭朝上模式文字傾斜或倒立）並根據日出日落套用自動日夜模式
    fixSymbolTextAlignment();
    checkAndApplyAutoDayNightMode();

    startIdleGPS();
    navigator.geolocation?.getCurrentPosition(pos => {
        checkAndApplyAutoDayNightMode(pos.coords.latitude, pos.coords.longitude);
        map.jumpTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 17 });
    });
});

// 切換或更新地圖樣式後重新強制所有 symbol 圖層螢幕水平對齊
map.on('style.load', () => {
    fixSymbolTextAlignment();
    isNightMapStyleActive = null;
    checkAndApplyAutoDayNightMode();
});
map.on('styledata', () => {
    fixSymbolTextAlignment();
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

// 優化軌跡圖層更新：合併連續同狀態線段，大幅減少 GeoJSON Feature 物件數量，防止長時間跑車或重播時手機發熱卡頓
function buildRouteLayerFeatures(points) {
    const musicFeatures = [], silentFeatures = [];
    if (Array.isArray(points) && points.length >= 2) {
        let currentCoords = [[points[0].lng, points[0].lat]];
        let currentIsMusic = Boolean(points[1].musicActive);

        for (let i = 1; i < points.length; i++) {
            const pt = points[i];
            const isMusic = Boolean(pt.musicActive);
            if (isMusic === currentIsMusic) {
                currentCoords.push([pt.lng, pt.lat]);
            } else {
                if (currentCoords.length >= 2) {
                    const feature = { type: 'Feature', geometry: { type: 'LineString', coordinates: currentCoords } };
                    if (currentIsMusic) musicFeatures.push(feature);
                    else silentFeatures.push(feature);
                }
                const prevPt = points[i - 1];
                currentCoords = [[prevPt.lng, prevPt.lat], [pt.lng, pt.lat]];
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
    map.getSource('route-music')?.setData({ type: 'FeatureCollection', features: musicFeatures });
    map.getSource('route-Silent')?.setData({ type: 'FeatureCollection', features: silentFeatures });
}

// ==========================================
// 👾 動態軌跡變色（小精靈吃路線）與路線進度／雙層語音預警核心輔助函數
// - 已行駛路段（索引 0 至 currentTrackIndex）：渲染於 bg-route（半透明淺灰色）
// - 未行駛路段（索引 currentTrackIndex 至終點）：維持原本高亮綠色（音樂收運）／藍色（音樂關閉）
// ==========================================
function updateProgressRouteLayers(points, currentTrackIndex, exactPos = null, throttleMs = 0) {
    if (throttleMs > 0) {
        const now = performance.now();
        if (now - lastRouteLayerRenderTime < throttleMs) return;
        lastRouteLayerRenderTime = now;
    } else {
        lastRouteLayerRenderTime = performance.now();
    }

    if (!Array.isArray(points) || points.length < 2) {
        map.getSource('bg-route')?.setData(emptyGeoJSON());
        map.getSource('route-music')?.setData(emptyGeoJSON());
        map.getSource('route-Silent')?.setData(emptyGeoJSON());
        return;
    }

    const maxIdx = points.length - 1;
    const clampedIdx = Math.min(Math.max(Math.floor(currentTrackIndex), 0), maxIdx);

    // 1. 已行駛路段（0 至 currentTrackIndex）：半透明淺灰色 (bg-route)
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
        map.getSource('bg-route')?.setData({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: traveledCoords } }]
        });
    } else {
        map.getSource('bg-route')?.setData(emptyGeoJSON());
    }

    // 2. 未行駛路段（currentTrackIndex 至終點）：維持高亮綠色／原色
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
    map.getSource('route-music')?.setData({ type: 'FeatureCollection', features: musicFeatures });
    map.getSource('route-Silent')?.setData({ type: 'FeatureCollection', features: silentFeatures });
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

// 進度鎖定追蹤器：計算車輛目前在路線座標陣列中的 currentTrackIndex，防止去回程重疊路口跳號
function computeNextTrackIndex(pts, prevTrackIndex, lng, lat, vehicleHeading, isMoving) {
    if (!Array.isArray(pts) || pts.length === 0) return { trackIndex: 0, minDistMeters: Infinity };
    const maxIdx = pts.length - 1;
    const startIdx = Math.max(0, prevTrackIndex - 3);
    const endIdx = Math.min(maxIdx, prevTrackIndex + 45);

    let bestLocalIdx = prevTrackIndex;
    let bestLocalScore = Infinity;
    let bestLocalDist = Infinity;

    for (let i = startIdx; i <= endIdx; i++) {
        const d = getDistanceKm(lng, lat, pts[i].lng, pts[i].lat) * 1000;
        let penalty = 0;
        if (isMoving) {
            const segB = getRouteSegmentBearing(pts, i);
            const angDiff = Math.abs(getAngleDiff(vehicleHeading, segB));
            if (angDiff > 60) penalty = 35; // 逆向或垂直重疊路段加權懲罰，避免跳到回程
        }
        const score = d + penalty;
        if (score < bestLocalScore) {
            bestLocalScore = score;
            bestLocalIdx = i;
            bestLocalDist = d;
        }
    }

    if (bestLocalDist <= 40) {
        return {
            trackIndex: Math.max(prevTrackIndex, bestLocalIdx),
            minDistMeters: bestLocalDist
        };
    }

    // 若偏離局部視窗超過 40m（例如中途切入路線），進行全路線搜尋並優先匹配同向路段
    let bestGlobalIdx = prevTrackIndex;
    let bestGlobalScore = Infinity;
    let bestGlobalDist = Infinity;
    for (let i = 0; i <= maxIdx; i++) {
        const d = getDistanceKm(lng, lat, pts[i].lng, pts[i].lat) * 1000;
        let penalty = 0;
        if (isMoving) {
            const segB = getRouteSegmentBearing(pts, i);
            const angDiff = Math.abs(getAngleDiff(vehicleHeading, segB));
            if (angDiff > 60) penalty = 30;
        }
        const score = d + penalty;
        if (score < bestGlobalScore) {
            bestGlobalScore = score;
            bestGlobalIdx = i;
            bestGlobalDist = d;
        }
    }

    if (bestGlobalDist <= 35) {
        return {
            trackIndex: bestGlobalIdx,
            minDistMeters: bestGlobalDist
        };
    }

    return {
        trackIndex: prevTrackIndex,
        minDistMeters: Math.min(bestLocalDist, bestGlobalDist)
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

function clearDomMarkers() {
    domMarkers.forEach(m => {
        try { m.remove(); } catch (e) {}
    });
    domMarkers = [];
}

function addPinMarker(lngLat, htmlContent) {
    const el = document.createElement('div');
    el.innerHTML = htmlContent;
    const m = new maplibregl.Marker({
        element: el.firstElementChild,
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport'
    }).setLngLat(lngLat).addTo(map);
    domMarkers.push(m);
}

// --- 4. 紀錄路線 ---
const musicToggleBtn = document.getElementById('musicToggleBtn');
function renderMusicButtonState() {
    const icon = document.getElementById('musicBtnIcon');
    const text = document.getElementById('musicBtnText');
    if (musicActive) {
        musicToggleBtn.className = "flex-1 bg-green-600 text-white font-extrabold py-2.5 px-3 rounded-2xl flex items-center justify-center gap-2 shadow-lg animate-pulse active:scale-95 transition-all";
        icon.className = "fa-solid fa-music text-base"; text.innerText = "音樂播放中 (點擊關閉)";
    } else {
        musicToggleBtn.className = "flex-1 bg-gray-700 text-white font-extrabold py-2.5 px-3 rounded-2xl flex items-center justify-center gap-2 shadow-inner active:scale-95 transition-all";
        icon.className = "fa-solid fa-volume-xmark text-base"; text.innerText = "音樂關閉中 (點擊開啟)";
    }
}

musicToggleBtn.onclick = () => {
    if (!isRecording) return;
    musicActive = !musicActive;
    renderMusicButtonState();
    const evtType = musicActive ? 'on' : 'off';
    musicEvents.push({ type: evtType, lng: lastKnownLngLat[0], lat: lastKnownLngLat[1], bearing: currentHeading });
    
    const badgeHtml = musicActive 
        ? `<div class="music-marker music-on-pin"><i class="fa-solid fa-music"></i> 開音樂</div>`
        : `<div class="music-marker music-off-pin"><i class="fa-solid fa-volume-xmark"></i> 關音樂</div>`;
    addPinMarker(lastKnownLngLat, badgeHtml);
};

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

        document.getElementById('idleTopRow').classList.add('hidden');
        document.getElementById('recordingTopRow').classList.remove('hidden');
        document.getElementById('startManualDrawBtn')?.classList.add('hidden');
        document.getElementById('recordBtn').classList.replace('bg-green-700', 'bg-red-600');
        document.getElementById('recordBtnText').innerText = '停止紀錄並儲存';
        document.getElementById('recordBtn').querySelector('i').classList.replace('fa-play', 'fa-stop');
        document.getElementById('appStatusTitle').innerText = '路線紀錄中...';
        setCameraFollow(true);

        await requestScreenWakeLock();

        timerInterval = setInterval(() => {
            elapsedSec = Math.floor((Date.now() - startTime) / 1000);
            if (!isPowerSaveMapPaused()) {
                document.getElementById('timeText').innerText = new Date(elapsedSec * 1000).toISOString().substr(11, 8);
            }
        }, 1000);

        watchId = navigator.geolocation.watchPosition(pos => {
            const filtered = processFilteredGpsPosition(pos);
            if (!filtered) return; // 剔除 accuracy > 35m 低精度與 > 120km/h 衛星反射瞬移

            const now = Date.now();
            const lng = filtered.lng, lat = filtered.lat;
            const acc = Math.round(filtered.accuracy);
            if (!isPowerSaveMapPaused()) {
                document.getElementById('recAccuracyText').innerText = `± ${acc} m`;
                document.getElementById('speedText').innerText = filtered.isStationary ? '0.0' : filtered.speedKmh.toFixed(1);
            }

            if (!filtered.isStationary && typeof window.onFleetPositionUpdate === 'function') {
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
        }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });

    } else {
        // 當有效軌跡點不足 2 點（例如靜止測試 0.00 km）時，直接停止錄製狀態、安全釋放 WakeLock 並彈出明確提示
        if (routePoints.length < 2) {
            isRecording = false;
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

            document.getElementById('recordingTopRow').classList.add('hidden');
            document.getElementById('idleTopRow').classList.remove('hidden');
            document.getElementById('startManualDrawBtn')?.classList.remove('hidden');
            document.getElementById('recordBtn').classList.replace('bg-red-600', 'bg-green-700');
            document.getElementById('recordBtnText').innerText = '開始紀錄路線';
            document.getElementById('recordBtn').querySelector('i').classList.replace('fa-stop', 'fa-play');
            document.getElementById('appStatusTitle').innerText = '鶯歌清運路線助手 Pro Max';

            showNavAlert('移動距離過短（不足 2 個軌跡點），已取消本次紀錄');
            startIdleGPS();
            return;
        }

        if (!confirm("確定要「停止紀錄並儲存」這條路線嗎？\n\n(按「取消」可返回地圖繼續錄製)")) return;

        isRecording = false;
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

        document.getElementById('recordingTopRow').classList.add('hidden');
        document.getElementById('idleTopRow').classList.remove('hidden');
        document.getElementById('startManualDrawBtn')?.classList.remove('hidden');
        document.getElementById('recordBtn').classList.replace('bg-red-600', 'bg-green-700');
        document.getElementById('recordBtnText').innerText = '開始紀錄路線';
        document.getElementById('recordBtn').querySelector('i').classList.replace('fa-stop', 'fa-play');
        document.getElementById('appStatusTitle').innerText = '鶯歌清運路線助手 Pro Max';

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
            <div class="drag-handle text-gray-300 w-7 flex items-center justify-center cursor-grab active:cursor-grabbing hover:text-blue-500 flex-shrink-0">
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
        handle: '.drag-handle', animation: 200, ghostClass: 'opacity-50',
        onEnd: function (evt) {
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
    
    (route.events || []).forEach(ev => {
        if (ev.type === 'on') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-on-pin"><i class="fa-solid fa-music"></i> 開</div>`);
        } else if (ev.type === 'off') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-off-pin"><i class="fa-solid fa-volume-xmark"></i> 關</div>`);
        } else if (ev.type === 'alert') {
            const markerEl = document.createElement('div');
            markerEl.className = 'music-marker bg-amber-600 cursor-pointer active:scale-95';
            const camBadge = ev.photo ? '<i class="fa-solid fa-camera ml-1 text-amber-200"></i>' : '';
            markerEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${ev.note || '提醒'}${camBadge}`;
            markerEl.onclick = (e) => {
                e.stopPropagation();
                openViewAlertModal(ev);
            };
            const m = new maplibregl.Marker({
                element: markerEl,
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            }).setLngLat([ev.lng, ev.lat]).addTo(map);
            domMarkers.push(m);
        }
    });

    (route.points || []).forEach(p => {
        if (p.is_stop) addPinMarker([p.lng, p.lat], `<div class="music-marker bg-indigo-600 border border-white shadow-lg"><i class="fa-regular fa-clock"></i> ${p.scheduled_time || ''}</div>`);
    });
}

function openRouteDetail(idx) {
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

    const bounds = new maplibregl.LngLatBounds();
    route.points.forEach(p => bounds.extend([p.lng, p.lat]));
    map.fitBounds(bounds, { padding: { top: 80, bottom: 260, left: 50, right: 50 }, bearing: 0, duration: 500 });
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
// 🛠️ 統一版路線編輯引擎（拖曳微調 ＋ 虛擬中點 ＋ 節點修剪 ＋ 手繪延伸/剪接 ＋ 10步Undo）
// ==========================================
let isEditingMode = false, originalEventsBackup = [], originalPointsBackup = [];
let editStep = 0, editStartIndex = -1, tempMarkerA = null;
let editSubMode = 'path', pathEditMarkers = [];
let selectedEditNodeIdx = -1;

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

function updateNodeTrimPanelUI(route) {
    if (!nodeTrimActionPanel) return;
    if (!isEditingMode || editSubMode !== 'path' || !route || !Array.isArray(route.points) || selectedEditNodeIdx < 0 || selectedEditNodeIdx >= route.points.length) {
        nodeTrimActionPanel.classList.add('hidden');
        return;
    }
    nodeTrimActionPanel.classList.remove('hidden');
    const total = route.points.length;
    let roleLabel = '';
    if (selectedEditNodeIdx === 0) roleLabel = '（起點 S）';
    else if (selectedEditNodeIdx === total - 1) roleLabel = '（終點 E）';
    if (selectedNodeInfoText) {
        selectedNodeInfoText.textContent = `🎯 已選取節點 #${selectedEditNodeIdx + 1} / 共 ${total} 點 ${roleLabel}`;
    }
}

if (btnCloseNodeTrimPanel) {
    btnCloseNodeTrimPanel.onclick = () => {
        selectedEditNodeIdx = -1;
        const route = savedRoutes[selectedRouteIdx];
        updateNodeTrimPanelUI(route);
        if (route) renderPathEditNodes(route);
    };
}

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

    // 1. 渲染兩關鍵節點之間的「+ 虛擬中點」
    for (let k = 0; k < keyIndices.length - 1; k++) {
        const idxA = keyIndices[k];
        const idxB = keyIndices[k + 1];
        const ptA = pts[idxA];
        const ptB = pts[idxB];
        const segDistM = getDistanceKm(ptA.lng, ptA.lat, ptB.lng, ptB.lat) * 1000;
        if (segDistM < 5) continue;

        const midLng = Number(((ptA.lng + ptB.lng) / 2).toFixed(6));
        const midLat = Number(((ptA.lat + ptB.lat) / 2).toFixed(6));

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
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        })
            .setLngLat([midLng, midLat])
            .addTo(map);
        pathEditMarkers.push(midMarker);
    }

    // 2. 渲染可拖曳、可點擊修剪的關鍵節點
    keyIndices.forEach((ptIdx, kPos) => {
        const pt = pts[ptIdx];
        if (!pt) return;
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
        el.title = `節點 #${ptIdx + 1}（按住拖曳位置，點擊開啟修剪選單）`;

        const m = new maplibregl.Marker({
            element: el,
            draggable: true,
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        })
            .setLngLat([pt.lng, pt.lat])
            .addTo(map);
        m._ptIdx = ptIdx;

        m.on('dragstart', () => {
            pushEditUndoSnapshot(route);
            selectedEditNodeIdx = ptIdx;
            updateNodeTrimPanelUI(route);
        });

        m.on('drag', () => {
            const lngLat = m.getLngLat();
            const newLng = Number(lngLat.lng.toFixed(6));
            const newLat = Number(lngLat.lat.toFixed(6));
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
        });

        m.on('dragend', () => {
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
            vibrate(20);
            renderPathEditNodes(route);
            updateNodeTrimPanelUI(route);
            const promptEl = document.getElementById('editPromptText');
            if (promptEl) {
                promptEl.innerText = `🎯 已選取節點 #${ptIdx + 1}：可於下方選單刪除此點或修剪頭尾多餘路線`;
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

    keyIndices.forEach(ptIdx => {
        const pt = pts[ptIdx];
        if (!pt) return;
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
            el.className = 'w-4 h-4 bg-white border-[4px] border-orange-500 hover:scale-125 rounded-full shadow cursor-pointer z-20 transition-transform';
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
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        })
            .setLngLat([pt.lng, pt.lat])
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
// ✂️ 刪除多餘路線（單點刪除 ／ 刪除此點之前 ／ 刪除此點之後）
// ==========================================
if (btnDeleteSingleNode) {
    btnDeleteSingleNode.onclick = () => {
        const route = savedRoutes[selectedRouteIdx];
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
    };
}

if (btnTrimBeforeNode) {
    btnTrimBeforeNode.onclick = () => {
        const route = savedRoutes[selectedRouteIdx];
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
    };
}

if (btnTrimAfterNode) {
    btnTrimAfterNode.onclick = () => {
        const route = savedRoutes[selectedRouteIdx];
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
    };
}

function setEditSubMode(mode) {
    editSubMode = mode;
    ensureEditorMapZoomEnabled();
    try { map.dragPan.enable(); } catch (e) {}

    const inactiveClass = "text-gray-600 hover:bg-white/70 font-extrabold text-[11px] sm:text-xs px-2 py-2 rounded-xl transition-all active:scale-95 whitespace-nowrap flex items-center justify-center";
    if (modePathBtn) modePathBtn.className = (mode === 'path')
        ? "bg-emerald-600 text-white font-extrabold text-[11px] sm:text-xs px-2 py-2 rounded-xl shadow-sm transition-all active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;
    if (modeFreehandBtn) modeFreehandBtn.className = (mode === 'freehand')
        ? "bg-orange-600 text-white font-extrabold text-[11px] sm:text-xs px-2 py-2 rounded-xl shadow-sm transition-all active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;
    if (modeMarkerBtn) modeMarkerBtn.className = (mode === 'marker')
        ? "bg-blue-600 text-white font-extrabold text-[11px] sm:text-xs px-2 py-2 rounded-xl shadow-sm transition-all active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;

    const promptEl = document.getElementById('editPromptText');
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    editStep = 0;
    cancelActiveFreehandStroke(true);

    const route = savedRoutes[selectedRouteIdx];

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
    }
    updateUndoFreehandBtnUI();
    if (route) updateEditorLiveStatsUI(route);
}

if (modeMarkerBtn) modeMarkerBtn.onclick = () => setEditSubMode('marker');
if (modePathBtn) modePathBtn.onclick = () => setEditSubMode('path');
if (modeFreehandBtn) modeFreehandBtn.onclick = () => setEditSubMode('freehand');

if (btnUndoFreehand) {
    btnUndoFreehand.onclick = () => {
        if (!isEditingMode || freehandUndoStack.length === 0) return;
        const route = savedRoutes[selectedRouteIdx];
        if (!route) return;
        const prevState = freehandUndoStack.pop();
        route.points = prevState.points;
        route.events = prevState.events;
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
        if (targetEl && targetEl.closest && targetEl.closest('.music-marker, .shared-pin-wrapper, .fleet-truck-marker')) {
            return;
        }

        const route = savedRoutes[selectedRouteIdx];
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

        const route = savedRoutes[selectedRouteIdx];
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

    isEditingMode = true;
    editStep = 0;
    selectedEditNodeIdx = -1;
    freehandUndoStack = [];
    freehandSpliceStartIdx = -1;
    freehandDraftCoords = [];
    originalEventsBackup = JSON.parse(JSON.stringify(route.events || [])); 
    originalPointsBackup = JSON.parse(JSON.stringify(route.points || [])); 

    document.getElementById('routeDetailUI').classList.add('hidden');
    document.getElementById('editRouteBar').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = `編輯：${route.name}`;

    ensureEditorMapZoomEnabled();
    setEditSubMode('path');
    renderEditableRouteMarkers(route);
};

function renderEditableRouteMarkers(route) {
    clearDomMarkers();
    const pts = route.points;
    if (!pts || pts.length === 0) return;
    addPinMarker([pts[0].lng, pts[0].lat], '<div class="pin-s"><span>S</span></div>');
    addPinMarker([pts[pts.length-1].lng, pts[pts.length-1].lat], '<div class="pin-e"><span>E</span></div>');

    (route.events || []).forEach((ev, idx) => {
        let badgeClass = ev.type === 'on' ? 'music-on-pin' : 'music-off-pin';
        let iconClass = ev.type === 'on' ? 'fa-music' : 'fa-volume-xmark';
        let text = ev.type === 'on' ? '開' : '關';
        let isAlert = (ev.type === 'alert');
        
        if (isAlert) { badgeClass = 'bg-amber-600'; iconClass = 'fa-triangle-exclamation'; text = ev.note || '提醒'; }
        const markerEl = document.createElement('div');
        markerEl.className = `music-marker ${badgeClass} ${isAlert ? 'cursor-pointer active:scale-90' : ''}`;
        
        if (isAlert) {
            const camBadge = ev.photo ? ' <i class="fa-solid fa-camera text-amber-200"></i>' : '';
            markerEl.innerHTML = `<i class="fa-solid ${iconClass}"></i> ${text}${camBadge} <i class="fa-solid fa-pen ml-1 opacity-80"></i>`;
            markerEl.onclick = (e) => {
                e.stopPropagation();
                openAlertModalForEdit(route, idx);
            };
        } else {
            markerEl.innerHTML = `<i class="fa-solid ${iconClass}"></i> ${text}`;
        }
        const m = new maplibregl.Marker({
            element: markerEl,
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        }).setLngLat([ev.lng, ev.lat]).addTo(map);
        domMarkers.push(m);
    });

    (route.points || []).forEach((p, idx) => {
        if (p.is_stop) {
            const markerEl = document.createElement('div');
            markerEl.className = `music-marker bg-indigo-600 border border-white shadow-lg cursor-grab active:cursor-grabbing`;
            markerEl.innerHTML = `<i class="fa-regular fa-clock"></i> ${p.scheduled_time} <i class="fa-solid fa-pen ml-1 opacity-70"></i>`;
            
            const m = new maplibregl.Marker({
                element: markerEl,
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

// 呼叫 OSRM 道路吸附 API（3 秒超時自動降級為兩點直線連接）
async function fetchOsrmRoadGeometry(lng1, lat1, lng2, lat2) {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    try {
        const res = await fetchWithTimeout(osrmUrl, {}, 3000);
        if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
        const data = await res.json();
        const coords = data?.routes?.[0]?.geometry?.coordinates;
        if (data?.code === 'Ok' && Array.isArray(coords) && coords.length >= 2) {
            // 確保起點與前一段終點座標完全銜接無縫隙
            const alignedCoords = [[lng1, lat1], ...coords.slice(1)];
            return { coords: alignedCoords, usedOsrm: true };
        }
    } catch (err) {
        // OSRM 超時 3 秒或離線時，靜默降級為兩點直線連接
    }
    return { coords: [[lng1, lat1], [lng2, lat2]], usedOsrm: false };
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
    clearDomMarkers();
    updateRouteLayers(points);

    if (manualDrawSteps.length >= 1) {
        const startLngLat = points.length > 0
            ? [points[0].lng, points[0].lat]
            : manualDrawSteps[0].clickLngLat;
        addPinMarker(startLngLat, '<div class="pin-s pointer-events-none"><span>S</span></div>');
    }

    // 標示各個手拉點擊節點與終點
    for (let i = 1; i < manualDrawSteps.length; i++) {
        const coords = manualDrawSteps[i].densifiedCoords || [];
        const endCoord = coords.length > 0 ? coords[coords.length - 1] : manualDrawSteps[i].clickLngLat;
        const isLast = (i === manualDrawSteps.length - 1);
        const isMusic = Boolean(manualDrawSteps[i].musicActive);
        if (isLast) {
            addPinMarker(endCoord, `<div class="w-6 h-6 rounded-full ${isMusic ? 'bg-green-600' : 'bg-blue-600'} text-white font-black text-[11px] border-2 border-white shadow-lg flex items-center justify-center pointer-events-none">${i}</div>`);
        } else {
            addPinMarker(endCoord, `<div class="w-4 h-4 rounded-full bg-white border-[4px] ${isMusic ? 'border-green-600' : 'border-blue-600'} shadow pointer-events-none"></div>`);
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
    if (isManualDrawingMode) {
        handleManualDrawMapClick(e);
        return;
    }
    if (!isEditingMode) return;
    const route = savedRoutes[selectedRouteIdx];
    if (!route || !Array.isArray(route.points) || route.points.length === 0) return;

    const origTarget = e.originalEvent?.target;
    if (origTarget && origTarget.closest && origTarget.closest('.music-marker, .shared-pin-wrapper, .fleet-truck-marker')) {
        return;
    }

    if (editSubMode === 'marker') {
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
        // 點擊軌跡線條時：自動選取最近的節點（若距離過遠則不動作），並展開快速修剪選單
        let minDistToNode = Infinity;
        let closestNodeIdx = -1;
        for (let i = 0; i < route.points.length; i++) {
            const d = getDistanceKm(e.lngLat.lng, e.lngLat.lat, route.points[i].lng, route.points[i].lat) * 1000;
            if (d < minDistToNode) {
                minDistToNode = d;
                closestNodeIdx = i;
            }
        }

        if (minDistToNode > 45 || closestNodeIdx === -1) return;

        route.points[closestNodeIdx].isKeyNode = true;
        selectedEditNodeIdx = closestNodeIdx;
        vibrate(20);
        renderPathEditNodes(route);
        updateNodeTrimPanelUI(route);
        const promptEl = document.getElementById('editPromptText');
        if (promptEl) {
            promptEl.innerText = `🎯 已選取節點 #${closestNodeIdx + 1}：可按住拖曳位置，或使用下方修剪選單刪除多餘路線`;
        }
    } else if (editSubMode === 'freehand') {
        // 「手繪延伸／剪接」模式下點擊地圖：
        // 1. 若點擊處靠近路線既有節點 (< 30m)，視同點選該舊節點（設定剪接起點或完成剪接替換）
        const pts = route.points;
        let minDistM = Infinity;
        let closestIdx = -1;
        for (let i = 0; i < pts.length; i++) {
            const dM = getDistanceKm(e.lngLat.lng, e.lngLat.lat, pts[i].lng, pts[i].lat) * 1000;
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
    syncRouteMarkersAndIndicesAfterSpline(savedRoutes[selectedRouteIdx]);
    
    document.getElementById('topBackBtn').classList.remove('hidden');
    window.openRouteDetail(selectedRouteIdx);
};

function backToMain() {
    stopSmoothPlayback();
    VoiceQueue.clear();
    if (followWatchId !== null) {
        navigator.geolocation.clearWatch(followWatchId);
        followWatchId = null;
    }
    if (window.tacticalTimer !== null) {
        clearInterval(window.tacticalTimer);
        window.tacticalTimer = null;
    }
    isEditingMode = false;
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
    
    // 🚀 新增：回到主畫面時，強制將車子座標拉回最後一次紀錄的真實 GPS 位置
    if (lastValidGpsLng !== null && lastValidGpsLat !== null) {
        lastKnownLngLat = [lastValidGpsLng, lastValidGpsLat];
        if (vehicleMarker) vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);
    }
    
    releaseScreenWakeLockIfIdle();
    startIdleGPS();
}

document.getElementById('topBackBtn').onclick = (e) => {
    if (!document.getElementById('playbackUI').classList.contains('hidden')) {
        stopSmoothPlayback(); 
        VoiceQueue.clear(); 
        
        // 🚀 新增：按左上角返回中斷重播時，拉回真實位置
        if (lastValidGpsLng !== null && lastValidGpsLat !== null) {
            lastKnownLngLat = [lastValidGpsLng, lastValidGpsLat];
            if (vehicleMarker) vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);
        }
        
        window.openRouteDetail(selectedRouteIdx);
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
        document.getElementById('editPromptText').innerText = "🛠️ 標記完成！請點擊地圖軌跡選擇下一個『目標點』";
        updateRouteLayers(route.points);
        renderEditableRouteMarkers(route);
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

const playbackSlider = document.getElementById('playbackSlider');
const playPauseBtn = document.getElementById('playPauseBtn');
const speedToggleBtn = document.getElementById('speedToggleBtn');

document.getElementById('startReplayBtn').onclick = () => {
    const route = savedRoutes[selectedRouteIdx];
    if (!route || !route.points || route.points.length < 2) return;

    stopSmoothPlayback();

    document.getElementById('routeDetailUI').classList.add('hidden');
    document.getElementById('playbackUI').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = '路線重播複習';
    document.getElementById('playbackTitle').innerText = route.name;
    speedToggleBtn.innerText = `${speedMultiplier}x`;

    // 初始化累積里程與語音標記事件，重置所有 played / prePlayed 狀態
    replayCumMeters = buildCumulativeRouteMeters(route.points);
    replayVoiceEvents = prepareVoiceMarkerEvents(route, true);

    // 初始狀態（currentTrackIndex = 0）：已行駛路段為空，未行駛路段完整高亮顯示
    updateProgressRouteLayers(route.points, 0, null, 0);
    renderRouteMarkers(route);

    playProgress = 0; playbackSlider.max = (route.points.length - 1) * 100; playbackSlider.value = 0;
    setCameraFollow(true);

    const startPt = route.points[0];
    lastKnownLngLat = [startPt.lng, startPt.lat];
    currentHeading = getRouteSegmentBearing(route.points, 0);
    if (vehicleMarker) vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);
    map.jumpTo({ center: lastKnownLngLat, zoom: 17.5, bearing: isHeadingUpMode ? currentHeading : 0, offset: [0, 100] });

    startSmoothPlayback();
};

function renderInterpolatedStep(floatIdx, forceLayerUpdate = false) {
    const route = savedRoutes[selectedRouteIdx];
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

    if (currentTrackIndex < maxIdx && (p1.lng !== p2.lng || p1.lat !== p2.lat)) {
        currentHeading = getBearing(p1.lng, p1.lat, p2.lng, p2.lat);
    } else {
        currentHeading = getRouteSegmentBearing(pts, currentTrackIndex);
    }
    if (vehicleMarker) vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);

    // 👾 動態軌跡變色（小精靈吃路線）：0 ~ currentTrackIndex 為半透明淺灰，currentTrackIndex ~ 終點維持原色高亮
    updateProgressRouteLayers(
        pts,
        currentTrackIndex,
        { lng: curLng, lat: curLat, musicActive: p2.musicActive },
        forceLayerUpdate ? 0 : 40
    );

    const badge = document.getElementById('replayMusicBadge');
    if (p2.musicActive) {
        badge.className = "bg-green-600 text-white text-xs font-extrabold px-4 py-1.5 rounded-full shadow-lg pointer-events-auto";
        badge.innerText = "🎵 目前路段：播放回收音樂中";
    } else {
        badge.className = "bg-gray-800/90 text-white text-xs font-extrabold px-4 py-1.5 rounded-full shadow-lg pointer-events-auto";
        badge.innerText = "🔇 目前路段：音樂已關閉 (中斷移動)";
    }

    // 🔊 綁定路線進度的雙層語音預警（300m 預告 + 50m 確認 + 方向 ±30° + played 鎖定）
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
        map.jumpTo({ center: lastKnownLngLat, bearing: isHeadingUpMode ? currentHeading : map.getBearing(), offset: [0, 100] });
    }
}

function playbackLoop(timestamp) {
    if (!isPlaying) return;
    const route = savedRoutes[selectedRouteIdx];
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
    const route = savedRoutes[selectedRouteIdx];
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
    speedMultiplier = speedOptions[nextIdx]; speedToggleBtn.innerText = `${speedMultiplier}x`;
};
document.getElementById('stopPlaybackBtn').onclick = () => { 
    stopSmoothPlayback();
    VoiceQueue.clear();
    document.getElementById('playbackUI').classList.add('hidden'); 
    document.getElementById('musicAlertBanner').classList.add('hidden');
    document.getElementById('topBackBtn').classList.remove('hidden');
    
    // 🚀 新增：退出重播時，瞬間把車子拉回真實位置
    if (lastValidGpsLng !== null && lastValidGpsLat !== null) {
        lastKnownLngLat = [lastValidGpsLng, lastValidGpsLat];
        if (vehicleMarker) vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);
    }
    
    window.openRouteDetail(selectedRouteIdx); 
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

    const route = savedRoutes[selectedRouteIdx];
    if (!route) return;
    document.getElementById('routeDetailUI').classList.add('hidden');
    // 顯示右下角的獨立結束按鈕與左下角的一鍵標記黃色注意點按鈕
    document.getElementById('tacticalStopBtn').classList.remove('hidden');
    document.getElementById('tacticalQuickAlertBtn')?.classList.remove('hidden');
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
    renderRouteMarkers(route);
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

    followWatchId = navigator.geolocation.watchPosition(pos => {
        const filtered = processFilteredGpsPosition(pos);
        if (!filtered) return; // 剔除 accuracy > 45m 低精度與 > 160km/h 衛星反射瞬移

        const lng = filtered.lng, lat = filtered.lat;
        checkAndApplyAutoDayNightMode(lat, lng);

        if (!filtered.isStationary) {
            if (typeof window.onFleetPositionUpdate === 'function') window.onFleetPositionUpdate(lat, lng);
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

        // 即時計算路線進度索引 currentTrackIndex（含去回程方向權重保護）
        const progressInfo = computeNextTrackIndex(pts, currentTrackIndex, lng, lat, currentHeading, !filtered.isStationary);
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

        if (!hasAnnouncedEnd) {
            const distToEnd = getDistanceKm(lng, lat, pts[pts.length-1].lng, pts[pts.length-1].lat) * 1000;
            if (distToEnd <= 40 || currentTrackIndex >= pts.length - 3) {
                speakText("已抵達路線終點，本次清運任務結束，辛苦了！");
                hasAnnouncedEnd = true; document.getElementById('tacticalTimePanel').classList.add('hidden');
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
    }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
};

const endFollowAction = () => {
    VoiceQueue.clear();
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

async function publishRouteToSharedDB(payload, overwriteMode) {
    const sharedList = await fetchRawFirebaseList(FIREBASE_ROUTES_URL);
    const targetMatches = sharedList.filter(item =>
        (payload.routeId && item.routeId && item.routeId === payload.routeId) ||
        ((item.name || '').trim().toLowerCase() === (payload.name || '').trim().toLowerCase())
    );

    const nowTs = Date.now();
    const cleanPayload = { ...payload };
    delete cleanPayload.firebaseKey;
    delete cleanPayload.uploadAction;
    delete cleanPayload.targetFirebaseKey;

    if (overwriteMode && targetMatches.length > 0) {
        const primaryMatch = targetMatches[0];
        const primaryKey = primaryMatch.firebaseKey;
        const maxExistingCloudVer = targetMatches.reduce((maxV, item) => Math.max(maxV, getRouteVersion(item)), 1);
        const requestedVer = parseInt(cleanPayload.routeVersion, 10);
        const nextVer = (!isNaN(requestedVer) && requestedVer > maxExistingCloudVer)
            ? requestedVer
            : (maxExistingCloudVer + 1);

        cleanPayload.routeId = primaryMatch.routeId || cleanPayload.routeId;
        cleanPayload.routeVersion = nextVer;
        cleanPayload.updatedAt = nowTs;

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
        cleanPayload.routeVersion = getRouteVersion(cleanPayload);
        cleanPayload.updatedAt = cleanPayload.updatedAt || nowTs;

        const postRes = await fetchWithTimeout(FIREBASE_ROUTES_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cleanPayload)
        }, 5000);
        if (!postRes.ok) throw new Error(`POST HTTP ${postRes.status}`);
    }

    // 同步更新本機該路線的版本號與 updatedAt，確保上傳者本機版本與雲端一致
    let localMutated = false;
    savedRoutes.forEach(local => {
        if (local.isPendingPreview) return;
        const idMatch = local.routeId && cleanPayload.routeId && local.routeId === cleanPayload.routeId;
        const nameMatch = (local.name || '').trim().toLowerCase() === (cleanPayload.name || '').trim().toLowerCase();
        if (idMatch || nameMatch) {
            local.routeId = cleanPayload.routeId;
            local.routeVersion = cleanPayload.routeVersion;
            local.updatedAt = cleanPayload.updatedAt;
            local.uploadedAt = cleanPayload.uploadedAt;
            local.uploadedAtText = cleanPayload.uploadedAtText;
            localMutated = true;
        }
    });
    if (localMutated) {
        await localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);
        try { localStorage.setItem('yinggeCleanRoutes_v2', JSON.stringify(savedRoutes)); } catch (e) {}
    }

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

        // 2. 判斷是否具有管理員權限（已解鎖管理員，或於提示框輸入管理員密碼）
        let publishDirectlyAsAdmin = isAdminUnlocked;
        if (!publishDirectlyAsAdmin) {
            const pwdInput = prompt('【一般隊員請直接按「確定」】送交至待審核區；\n🔑 若您是管理員，請輸入管理員密碼直接上架正式庫：', '');
            if (pwdInput === null) return; // 按取消則中止上傳
            if (pwdInput.trim() === ADMIN_PASSWORD) {
                publishDirectlyAsAdmin = true;
                setAdminModeUI(true);
            } else if (pwdInput.trim() !== '') {
                alert('⚠️ 管理員密碼不正確，將以一般隊員身分提交至「待審核區」。');
            }
        }

        if (btnEl) {
            btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 上傳中...';
        }

        const nowTs = Date.now();
        const nowIso = new Date(nowTs).toISOString();
        const uploadedAtText = new Date(nowTs).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const payload = {
            routeId: finalRouteId,
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
            events: r.events || []
        };

        r.routeVersion = nextRouteVersion;
        r.updatedAt = nowTs;
        r.uploadedAt = nowIso;
        r.uploadedAtText = uploadedAtText;
        await localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);
        try { localStorage.setItem('yinggeCleanRoutes_v2', JSON.stringify(savedRoutes)); } catch (e) {}
        renderHistoryList();

        if (publishDirectlyAsAdmin) {
            const published = await publishRouteToSharedDB(payload, uploadAction === 'overwrite');
            renderHistoryList();
            alert(`✅ 管理員直通上架成功！\n路線【${finalRouteName}】(v${published.routeVersion}) 已${uploadAction === 'overwrite' ? '覆蓋更新至' : '新增至'}正式雲端路線庫。`);
        } else {
            const res = await fetchWithTimeout(FIREBASE_PENDING_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }, 5000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            alert(`✅ 已提交至待審核區，待管理員確認後上架！\n\n路線名稱：${finalRouteName} (目標版本 v${nextRouteVersion})\n分享隊員：${finalAuthor}\n提交模式：${uploadAction === 'overwrite' ? '🔄 覆蓋更新原路線' : '🆕 新增路線'}`);
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
            alert('✅ 管理員模式已解鎖！\n您現在可切換檢視「待審核投稿區」核准/退回路線，或直接刪除正式庫路線。');
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

    const cleanName = (pr.name || '').replace(/^\[待審預覽\]\s*/, '');
    const isOverwrite = pr.uploadAction === 'overwrite';
    const modeText = isOverwrite ? '【覆蓋更新】正式庫舊版路線' : '【新增上架】至正式路線庫';
    if (!confirm(`確定要核准【${pr.author || '隊員'}】投稿的路線「${cleanName}」並${modeText}嗎？`)) return;

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 核准中';
    }

    try {
        const payloadToPublish = { ...pr, name: cleanName };
        await publishRouteToSharedDB(payloadToPublish, isOverwrite);
        const delRes = await fetchWithTimeout(`${FIREBASE_BASE_URL}/pending_routes/${pr.firebaseKey}.json`, { method: 'DELETE' }, 5000);
        if (!delRes.ok) throw new Error(`DELETE pending HTTP ${delRes.status}`);

        alert(`✅ 已核准上架路線【${cleanName}】！`);
        await fetchCloudRoutes();
    } catch (err) {
        console.error('核准失敗:', err);
        alert('❌ 核准上架失敗（網路不穩或逾時），請檢查網路連線後再試！');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '✅ 核准上架';
        }
    }
}

function previewPendingRoute(pendingIdx) {
    const pr = cachedPendingRoutes[pendingIdx];
    if (!pr || !isAdminUnlocked) return;

    const cleanBaseName = (pr.name || '未命名路線').replace(/^\[待審預覽\]\s*/, '');
    const previewName = `[待審預覽] ${cleanBaseName}`;
    const previewRouteId = `preview_${pr.firebaseKey || pr.routeId || Date.now()}`;

    const previewRouteObj = {
        routeId: previewRouteId,
        id: Date.now(),
        originId: pr.originId || pr.id || Date.now(),
        name: previewName,
        author: pr.author || '熱心隊員',
        date: pr.date || pr.uploadedAtText || new Date().toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        uploadedAt: pr.uploadedAt || '',
        uploadedAtText: pr.uploadedAtText || '',
        distance: pr.distance || '0.00',
        timeStr: pr.timeStr || '0m 0s',
        isPendingPreview: true,
        points: JSON.parse(JSON.stringify(pr.points || [])),
        events: JSON.parse(JSON.stringify(pr.events || []))
    };

    const existingPreviewIdx = savedRoutes.findIndex(r => r.routeId === previewRouteId || r.name === previewName);
    if (existingPreviewIdx !== -1) {
        savedRoutes.splice(existingPreviewIdx, 1);
    }
    savedRoutes.unshift(previewRouteObj);

    localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => {
        document.getElementById('historyCount').innerText = savedRoutes.length;
        renderHistoryList();
        renderCloudRoutesList();
        alert('已匯入本機清單，請關閉雲端視窗後點擊該路線進行地圖預覽');
    });
}

async function rejectPendingRoute(pendingIdx, btnEl) {
    const pr = cachedPendingRoutes[pendingIdx];
    if (!pr || !isAdminUnlocked) return;

    if (!confirm(`確定要刪除/退回待審核路線【${pr.name}】（投稿者：${pr.author || '隊員'}）嗎？`)) return;

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
        const res = await fetchWithTimeout(`${FIREBASE_BASE_URL}/pending_routes/${pr.firebaseKey}.json`, { method: 'DELETE' }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        alert(`🗑️ 已刪除/退回待審核路線【${pr.name}】。`);
        await fetchCloudRoutes();
    } catch (err) {
        console.error('刪除待審核路線失敗:', err);
        alert('❌ 刪除失敗（網路不穩或逾時），請檢查網路連線後再試！');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '🗑️ 刪除/退回';
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
            const isOverwrite = pr.uploadAction === 'overwrite';
            const actionBadge = isOverwrite
                ? `<span class="bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded-full font-extrabold">🔄 覆蓋更新原路線</span>`
                : `<span class="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded-full font-extrabold">🆕 新增路線</span>`;

            const card = document.createElement('div');
            card.className = "bg-white p-3.5 rounded-2xl shadow-sm border-2 border-amber-200 flex flex-col gap-2.5";
            card.innerHTML = `
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-black text-gray-900 text-sm truncate">${pr.name}</span>
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
                    <button type="button" class="preview-pending-btn flex-1 bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-2 rounded-xl text-xs shadow-sm active:scale-95 transition-all whitespace-nowrap">
                        📥 下載試看
                    </button>
                    <button type="button" class="approve-pending-btn flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-2 rounded-xl text-xs shadow-sm active:scale-95 transition-all whitespace-nowrap">
                        ✅ 核准上架
                    </button>
                    <button type="button" class="reject-pending-btn bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-extrabold px-3 py-2 rounded-xl text-xs active:scale-95 transition-all whitespace-nowrap">
                        🗑️ 刪除/退回
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
        events: JSON.parse(JSON.stringify(cr.events || []))
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
// 🚛 9. 全自動車隊支援定位雷達（全模式通用）
// ==========================================
const LIVE_FLEET_BASE_URL = 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app/live_fleet';
const LIVE_FLEET_ALL_URL = `${LIVE_FLEET_BASE_URL}.json`;
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

    // 立即跳出醒目美觀的歡迎提示框
    showWelcomeProfileModal(fleetUserName);

    // 在背景正常啟動原本的連線功能
    startFleetRadarSystem();
    if (currentFleetLat !== null && currentFleetLng !== null) {
        uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
    }
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

async function uploadMyFleetLocation(lat, lng, forceUpload = false) {
    if (!fleetUserName || typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    if (!navigator.onLine || isUploadingFleetLocation) return;

    const now = Date.now();
    const minUploadIntervalMs = (typeof currentRadarIntervalSec === 'number' && currentRadarIntervalSec > 0 ? currentRadarIntervalSec : 5) * 1000;
    if (!forceUpload && lastUploadedFleetLat !== null && lastUploadedFleetLng !== null) {
        if (now - lastFleetUploadTime < minUploadIntervalMs) return; // 依雲端設定秒數頻率上傳
        const distMeters = getDistanceKm(lastUploadedFleetLng, lastUploadedFleetLat, lng, lat) * 1000;
        if (distMeters <= 5) return; // 移動未超過 5 公尺不重複上傳
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
    } catch (err) {
        // 巷弄斷網或超時靜默略過，還原座標基準以便下一週期自動恢復補傳
        lastUploadedFleetLat = prevLat;
        lastUploadedFleetLng = prevLng;
    } finally {
        isUploadingFleetLocation = false;
    }
}

window.onFleetPositionUpdate = function(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    currentFleetLat = lat;
    currentFleetLng = lng;
    if (fleetUserName) {
        uploadMyFleetLocation(lat, lng, false);
    }
};

// ==========================================
// 🟢 左上角「車隊雷達在線名單」即時清單（支援超過 3 人自動收折＋點擊快速 flyTo 追蹤隊友）
// ==========================================
let onlineFleetMembersList = [];
let isOnlineFleetListExpanded = false;

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

    const totalOnline = onlineFleetMembersList.length;
    const maxVisible = 3;
    const shouldCollapse = totalOnline > maxVisible && !isOnlineFleetListExpanded;
    const visibleMembers = shouldCollapse
        ? onlineFleetMembersList.slice(0, maxVisible)
        : onlineFleetMembersList;

    visibleMembers.forEach(member => {
        const pillBtn = document.createElement('button');
        pillBtn.type = 'button';
        pillBtn.className = 'bg-white/95 hover:bg-emerald-50 backdrop-blur px-3 py-1.5 rounded-xl shadow-md text-xs font-extrabold text-gray-800 border border-emerald-200 flex items-center gap-1.5 active:scale-95 transition-all whitespace-nowrap';
        pillBtn.title = `點擊追蹤 ${member.name} 的即時位置`;

        const dotSpan = document.createElement('span');
        dotSpan.textContent = '🟢';
        dotSpan.className = 'text-[10px] leading-none';

        const textSpan = document.createElement('span');
        textSpan.textContent = `${member.name} · ${member.speedKmh} km/h`;

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

function createFleetTruckMarkerElement(memberName) {
    const wrapper = document.createElement('div');
    wrapper.className = 'fleet-truck-marker flex flex-col items-center pointer-events-none select-none';
    wrapper.style.filter = 'drop-shadow(0 3px 6px rgba(0,0,0,0.38))';
    wrapper.innerHTML = `
        <div class="bg-emerald-600 text-white px-2.5 py-1 rounded-full border-2 border-white font-black text-xs flex items-center gap-1.5 whitespace-nowrap shadow-md">
            <i class="fa-solid fa-truck text-amber-300 text-xs"></i>
            <span class="fleet-member-name"></span>
        </div>
        <div class="w-2.5 h-2.5 bg-emerald-600 border-r-2 border-b-2 border-white transform rotate-45 -mt-1.5"></div>
    `;
    wrapper.querySelector('.fleet-member-name').textContent = memberName || '隊員';
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
                // 僅顯示 3 分鐘（180 秒）內有更新的線上友車
                if (now - updatedAt > 180 * 1000) return;

                activeIds.add(devId);
                const memberName = (info.name || '隊員').trim();

                // 計算同事即時時速 (km/h)：優先採用雲端回報之 speedKmh，若舊版未帶則依前後座標差推算
                let memberSpeedKmh = 0;
                const existingEntry = fleetLayerGroup[devId];
                if (typeof info.speedKmh === 'number' && !isNaN(info.speedKmh) && info.speedKmh >= 0) {
                    memberSpeedKmh = (now - updatedAt > 30000) ? 0 : Math.round(info.speedKmh);
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
                    if (existingEntry.name !== memberName) {
                        const nameSpan = existingEntry.el.querySelector('.fleet-member-name');
                        if (nameSpan) nameSpan.textContent = memberName;
                        existingEntry.name = memberName;
                    }
                    existingEntry.lastLat = lat;
                    existingEntry.lastLng = lng;
                    existingEntry.lastUpdatedAt = updatedAt;
                    existingEntry.speedKmh = memberSpeedKmh;
                } else {
                    const el = createFleetTruckMarkerElement(memberName);
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
                    updatedAt
                });
            });
        }

        // 移除超過 3 分鐘未更新或已離線的友車標記
        Object.keys(fleetLayerGroup).forEach(devId => {
            if (!activeIds.has(devId)) {
                fleetLayerGroup[devId].marker.remove();
                delete fleetLayerGroup[devId];
            }
        });

        // 依名稱排序保持清單穩定不跳動，並更新左上角在線名單 UI
        nextOnlineMembers.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
        onlineFleetMembersList = nextOnlineMembers;
        renderOnlineFleetListUI();
    } catch (err) {
        // 巷弄斷網或 5 秒逾時靜默略過，不干擾導航並於下週期自動恢復
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
// 避免司機切換至 LINE 或講電話時在地圖上瞬間消失（異常斷線亦由雲端 3 分鐘逾時機制自動清除）
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

    // 啟動全模式背景定位監聽（確保即使在預覽或切換畫面時也能持續更新座標）
    if ('geolocation' in navigator) {
        fleetRadarWatchId = navigator.geolocation.watchPosition(pos => {
            const filtered = processFilteredGpsPosition(pos);
            if (!filtered || filtered.isStationary) return;
            window.onFleetPositionUpdate(filtered.lat, filtered.lng);
        }, () => {}, { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 });
    }

    // 若目前已有定位座標，立即進行首次上線回報
    if (lastKnownLngLat && Array.isArray(lastKnownLngLat) && currentFleetLat !== null) {
        uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
    } else if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(pos => {
            const filtered = processFilteredGpsPosition(pos);
            if (!filtered) return;
            window.onFleetPositionUpdate(filtered.lat, filtered.lng);
        }, () => {}, { enableHighAccuracy: true });
    }

    // 靜默讀取 /live_fleet.json 更新友車圖層（依雲端動態秒數，預設 5 秒）
    fetchAndRenderFleetRadar();
    const pollIntervalMs = (typeof currentRadarIntervalSec === 'number' && currentRadarIntervalSec > 0 ? currentRadarIntervalSec : 5) * 1000;
    fleetPollTimer = setInterval(fetchAndRenderFleetRadar, pollIntervalMs);
    if (typeof fetchAndRenderSharedMapPins === 'function') {
        fetchAndRenderSharedMapPins();
    }

    // 60 秒定點心跳保活機制：若超過 60 秒未觸發移動上傳，原地補送一次 updatedAt
    fleetHeartbeatTimer = setInterval(() => {
        if (!fleetUserName || currentFleetLat === null || currentFleetLng === null) return;
        if (Date.now() - lastFleetUploadTime >= 60000) {
            uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
        }
    }, 10000);
}

// 初始化檢查使用者名稱與啟動車隊雷達
syncFleetUserNameUI();
if (fleetUserName) {
    startFleetRadarSystem();
} else {
    openFleetUserNameModal(true);
}

document.addEventListener('visibilitychange', async () => {
    if (bgSilentKeepAliveStarted) {
        ensureBackgroundSilentKeepAlive();
    }
    if (document.visibilityState === 'visible') {
        ensurePureBlackSystemBars();
        if (isBlackScreenActive || isRecording || followWatchId !== null) {
            await requestScreenWakeLock();
        }
        if (fleetUserName && currentFleetLat !== null && currentFleetLng !== null) {
            uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
        }
        fetchAndRenderFleetRadar();
        if (typeof fetchAndRenderSharedMapPins === 'function') {
            fetchAndRenderSharedMapPins();
        }
    }
});

// ==========================================
// 📍 10. 全車隊共享地圖地標（藍色水滴＋縮圖照片）
// ==========================================
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
const viewMapPinTitleText = document.getElementById('viewMapPinTitleText');
const viewMapPinAuthorText = document.getElementById('viewMapPinAuthorText');
const viewMapPinTimeText = document.getElementById('viewMapPinTimeText');
const viewMapPinPhotoWrap = document.getElementById('viewMapPinPhotoWrap');
const viewMapPinPhotoImg = document.getElementById('viewMapPinPhotoImg');
const btnGoogleNavMapPin = document.getElementById('btnGoogleNavMapPin');
const btnDistanceGuideMapPin = document.getElementById('btnDistanceGuideMapPin');
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

    if (viewMapPinTitleText) viewMapPinTitleText.textContent = pin.title || '現場注意事項';
    if (viewMapPinAuthorText) viewMapPinAuthorText.textContent = pin.author || '熱心隊員';
    if (viewMapPinTimeText) viewMapPinTimeText.textContent = formatPinCreatedAt(pin.createdAt);

    if (pin.photo) {
        if (viewMapPinPhotoImg) viewMapPinPhotoImg.src = pin.photo;
        if (viewMapPinPhotoWrap) viewMapPinPhotoWrap.classList.remove('hidden');
    } else {
        if (viewMapPinPhotoImg) viewMapPinPhotoImg.src = '';
        if (viewMapPinPhotoWrap) viewMapPinPhotoWrap.classList.add('hidden');
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

if (btnDeleteMapPin) {
    btnDeleteMapPin.onclick = async () => {
        if (!activeViewingMapPin || !activeViewingMapPin.id) return;
        const pinId = activeViewingMapPin.id;
        const pinTitle = activeViewingMapPin.title || '此地標';

        if (!confirm(`確定「${pinTitle}」已清理完畢，要從全車隊地圖同步移除嗎？`)) return;
        if (!navigator.onLine) {
            alert('⚠️ 目前無網路連線，無法同步移除雲端地標！');
            return;
        }

        const origHtml = btnDeleteMapPin.innerHTML;
        btnDeleteMapPin.disabled = true;
        btnDeleteMapPin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在同步銷案...';

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
            alert('❌ 移除地標失敗（網路不穩或連線逾時），請稍後再試！');
        } finally {
            btnDeleteMapPin.disabled = false;
            btnDeleteMapPin.innerHTML = origHtml;
        }
    };
}

function createSharedPinMarkerElement(pin) {
    const wrapper = document.createElement('div');
    wrapper.className = 'shared-pin-wrapper';

    const labelEl = document.createElement('div');
    labelEl.className = 'shared-pin-label';
    labelEl.textContent = pin.title || '現場地標';
    wrapper.appendChild(labelEl);

    const teardrop = document.createElement('div');
    teardrop.className = 'shared-pin-teardrop';

    const inner = document.createElement('div');
    inner.className = 'shared-pin-inner';

    if (pin.photo) {
        const img = document.createElement('img');
        img.src = pin.photo;
        img.alt = pin.title || '地標縮圖';
        inner.appendChild(img);
    } else {
        inner.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-white text-sm"></i>';
    }

    teardrop.appendChild(inner);
    wrapper.appendChild(teardrop);

    wrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pinsLayerGroup[pin.id]?.data) {
            openViewMapPinModal(pinsLayerGroup[pin.id].data);
        } else {
            openViewMapPinModal(pin);
        }
    });

    return wrapper;
}

function upsertPinMarkerOnMap(pinId, pinData) {
    const lat = Number(pinData.lat);
    const lng = Number(pinData.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    const normalizedPin = { ...pinData, id: pinId, lat, lng };
    const signature = `${normalizedPin.title || ''}|${Boolean(normalizedPin.photo)}|${(normalizedPin.photo || '').length}`;

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

// 綁定長按 1.5 秒（1500ms）防誤觸與桌面右鍵新增地標互動
(function setupMapLongPressForPins() {
    let longPressTimer = null;
    let startClientX = 0;
    let startClientY = 0;
    let pendingLngLat = null;

    function clearLongPressTimer() {
        if (longPressTimer !== null) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    const canvasContainer = map.getCanvasContainer();

    canvasContainer.addEventListener('touchstart', (e) => {
        clearLongPressTimer();
        if (isEditingMode || isManualDrawingMode) return;
        if (!e.touches || e.touches.length !== 1) return;

        const targetEl = e.target;
        if (targetEl && targetEl.closest && targetEl.closest('.shared-pin-wrapper, .music-marker, .fleet-truck-marker, .pin-s, .pin-e')) {
            return;
        }

        const touch = e.touches[0];
        startClientX = touch.clientX;
        startClientY = touch.clientY;

        const rect = canvasContainer.getBoundingClientRect();
        const pointX = touch.clientX - rect.left;
        const pointY = touch.clientY - rect.top;
        pendingLngLat = map.unproject([pointX, pointY]);

        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            if (isEditingMode || isManualDrawingMode || !pendingLngLat) return;
            try { navigator.vibrate?.(50); } catch (err) {}
            openCreateMapPinModal(pendingLngLat.lat, pendingLngLat.lng);
        }, 1500);
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

    ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart', 'wheel'].forEach(evtName => {
        map.on(evtName, clearLongPressTimer);
    });

    // 桌面端支援右鍵 contextmenu 觸發
    map.on('contextmenu', (e) => {
        clearLongPressTimer();
        if (isEditingMode || isManualDrawingMode) return;
        const origTarget = e.originalEvent?.target;
        if (origTarget && origTarget.closest && origTarget.closest('.shared-pin-wrapper, .music-marker, .fleet-truck-marker')) {
            return;
        }
        if (e.originalEvent) e.originalEvent.preventDefault();
        try { navigator.vibrate?.(50); } catch (err) {}
        if (e.lngLat) {
            openCreateMapPinModal(e.lngLat.lat, e.lngLat.lng);
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
// ⚙️ 10. 管理員隱藏設定面板（6 位數密碼驗證＋全隊導航參數與公告橫幅雙向即時同步 v3.1）
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

// --- 10.2 套用完整系統參數至當前導航與畫面 ---
function applySystemConfigToRuntime(newCfg) {
    const normalized = normalizeSystemConfig(newCfg);
    const prevNightSetting = systemNavConfig.enableAutoNightMode;
    const prevDynamicZoom = systemNavConfig.enableDynamicZoom;
    const prevLowZoom = systemNavConfig.lowSpeedZoom;
    const prevHighZoom = systemNavConfig.highSpeedZoom;

    systemNavConfig = normalized;
    try {
        localStorage.setItem('yingge_system_nav_config_v31', JSON.stringify(normalized));
    } catch (e) {}

    // 1. 全隊頂部公告橫幅即時顯示／隱藏
    renderFleetAnnouncementBanner(normalized.announcementText);

    // 1.5 左上角車隊雷達在線名單顯示開關即時同步套用
    if (typeof renderOnlineFleetListUI === 'function') {
        renderOnlineFleetListUI();
    }

    // 2. 日出日落自動夜間模式即時套用
    if (prevNightSetting !== normalized.enableAutoNightMode) {
        checkAndApplyAutoDayNightMode();
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
    } finally {
        isCheckingSystemConfig = false;
    }
}

// --- 10.4 以新秒數重新啟動車隊雷達輪詢（GPS 上傳 + 雷達讀取） ---
function restartFleetRadarWithNewInterval(intervalSec) {
    if (!fleetUserName) return;

    if (fleetPollTimer !== null) {
        clearInterval(fleetPollTimer);
        fleetPollTimer = null;
    }
    const intervalMs = (intervalSec || DEFAULT_RADAR_INTERVAL_SEC) * 1000;
    fetchAndRenderFleetRadar();
    fleetPollTimer = setInterval(fetchAndRenderFleetRadar, intervalMs);
}

// --- 10.5 初始化：啟動時立即讀取雲端系統參數、公告橫幅與雲端路線版本比對 ---
(async function initSystemConfigSync() {
    const cloudCfg = await fetchSystemConfig();
    currentRadarIntervalSec = cloudCfg.radarIntervalSec;
    lastKnownCloudInterval = cloudCfg.radarIntervalSec;
    applySystemConfigToRuntime(cloudCfg);
    if (fleetRadarStarted && fleetUserName) {
        restartFleetRadarWithNewInterval(cloudCfg.radarIntervalSec);
    }
    if (typeof checkCloudRouteUpdatesInBackground === 'function') {
        checkCloudRouteUpdatesInBackground(true);
    }
    window.addEventListener('online', () => {
        if (typeof checkCloudRouteUpdatesInBackground === 'function') {
            checkCloudRouteUpdatesInBackground(true);
        }
    });
    // 確保即使尚未設定車隊名稱的裝置，也能每 10 秒自動同步全隊頂部公告與最新導航參數
    setInterval(() => {
        checkAndApplyRadarInterval();
    }, 10000);
})();

// --- 10.6 在每次 fetchAndRenderFleetRadar 時一併檢查雲端參數是否變更 ---
const _originalFetchAndRenderFleetRadar = fetchAndRenderFleetRadar;
fetchAndRenderFleetRadar = async function() {
    await _originalFetchAndRenderFleetRadar();
    checkAndApplyRadarInterval();
};

// --- 10.7 點擊版本號（或標題連續點擊 5 次）觸發管理員設定驗證 ---
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

// --- 10.8 密碼驗證彈窗 ---
function openAdminPasswordModal() {
    const modal = document.getElementById('adminPasswordModal');
    const input = document.getElementById('adminPasswordInput');
    const errorEl = document.getElementById('adminPasswordError');
    if (!modal || !input) return;
    input.value = '';
    errorEl?.classList.add('hidden');
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
}

document.getElementById('btnVerifyAdminPassword')?.addEventListener('click', () => {
    const input = document.getElementById('adminPasswordInput');
    const errorEl = document.getElementById('adminPasswordError');
    const pwd = (input?.value || '').trim();
    if (pwd === ADMIN_SETTINGS_PASSWORD) {
        document.getElementById('adminPasswordModal')?.classList.add('hidden');
        openAdminSettingsPanel();
    } else {
        errorEl?.classList.remove('hidden');
        if (input) { input.value = ''; input.focus(); }
        try { navigator.vibrate?.(200); } catch (e) {}
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

// --- 10.9 管理員設定面板表單渲染與雙向同步 ---
function populateAdminSettingsForm(cfg) {
    const c = normalizeSystemConfig(cfg);
    selectedAdminInterval = c.radarIntervalSec;
    updateAdminIntervalDisplay(c.radarIntervalSec);
    highlightAdminIntervalBtn(c.radarIntervalSec);

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
    setChecked('adminEnableAutoNightInput', c.enableAutoNightMode);
    setChecked('adminShowOnlineFleetListInput', c.showOnlineFleetList);
    setVal('adminMaxAccuracyInput', c.maxAccuracyMeters);
    setVal('adminMaxSpeedInput', c.maxSpeedKmh);
    setVal('adminMinLockSpeedInput', c.minLockSpeedKmh);
}

function readAdminSettingsForm() {
    const getVal = (id) => document.getElementById(id)?.value;
    const getChecked = (id) => Boolean(document.getElementById(id)?.checked);

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
        enableAutoNightMode: getChecked('adminEnableAutoNightInput'),
        showOnlineFleetList: getChecked('adminShowOnlineFleetListInput'),
        maxAccuracyMeters: getVal('adminMaxAccuracyInput'),
        maxSpeedKmh: getVal('adminMaxSpeedInput'),
        minLockSpeedKmh: getVal('adminMinLockSpeedInput')
    });
}

async function openAdminSettingsPanel() {
    const modal = document.getElementById('adminSettingsModal');
    if (!modal) return;

    // 先以目前本機有效設定立即渲染，再從 Firebase 拉取最新雲端設定覆蓋
    populateAdminSettingsForm(systemNavConfig);
    modal.classList.remove('hidden');

    const cloudCfg = await fetchSystemConfig();
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

// 一鍵清空公告按鈕
document.getElementById('btnClearAdminAnnouncement')?.addEventListener('click', () => {
    const input = document.getElementById('adminAnnouncementInput');
    if (input) {
        input.value = '';
        input.focus();
    }
});

// 恢復預設值按鈕
document.getElementById('btnResetAdminDefaults')?.addEventListener('click', () => {
    populateAdminSettingsForm(DEFAULT_SYSTEM_CONFIG);
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

        // 本機立即套用所有新參數與公告橫幅
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
        const createMapPinModal = document.getElementById('createMapPinModal');
        const viewMapPinModal = document.getElementById('viewMapPinModal');
        const quickNavAlertModal = document.getElementById('quickNavAlertModal');
        const manualDrawUI = document.getElementById('manualDrawUI');
        const adminSettingsModal = document.getElementById('adminSettingsModal');
        const adminPasswordModal = document.getElementById('adminPasswordModal');

        // 依序檢查目前是哪個畫面在最上層，就模擬點擊它的「關閉/返回」按鈕
        if (adminSettingsModal && !adminSettingsModal.classList.contains('hidden')) {
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
        else if (createMapPinModal && !createMapPinModal.classList.contains('hidden')) {
            document.getElementById('btnCancelCreateMapPin').click();
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
            // 如果在路線詳情頁，就觸發左上角返回鍵
            document.getElementById('topBackBtn').click();
        }
        else if (historyModal && !historyModal.classList.contains('hidden')) {
            // 如果在清單頁，就觸發首頁圖示的關閉鍵
            document.getElementById('closeHistory').click();
        } 
    });

    // 2. 製造假歷史紀錄的函數 (讓手機能有東西可以"返回")
    function pushFakeHistory() {
        window.history.pushState({ pwa: true }, '');
    }

    // 3. 用「外掛監聽」的方式，綁定到現有的按鈕上 (不用動你原本的代碼)
    const hBtn = document.getElementById('historyBtn');
    if(hBtn) hBtn.addEventListener('click', pushFakeHistory);
    
    const sBtn = document.getElementById('settingsBtn');
    if(sBtn) sBtn.addEventListener('click', pushFakeHistory);

    const cBtn = document.getElementById('openCloudModalBtn');
    if(cBtn) cBtn.addEventListener('click', pushFakeHistory);

    const bBtn = document.getElementById('blackScreenBtn');
    if(bBtn) bBtn.addEventListener('click', pushFakeHistory);

    // 4. 攔截開啟路線詳情的函數
    if (typeof window.openRouteDetail === 'function') {
        const originalOpenRouteDetail = window.openRouteDetail;
        window.openRouteDetail = function(idx) {
            pushFakeHistory(); // 先推入歷史紀錄騙過手機
            originalOpenRouteDetail(idx); // 再執行原本的開畫面動作
        };
    }
})();
