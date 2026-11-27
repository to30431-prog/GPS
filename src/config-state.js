// ==========================================
// [Module 1/10] src/config-state.js
// 全域版本常數、fetchWithTimeout、系統預設參數、狀態變數、Wake Lock、GPS 過濾引擎與本機路線載入
// ==========================================

// ==========================================
// 🛡️ 裝置角色自動授權與全域版本常數設定
// ==========================================
const APP_VERSION = 'v3.96';
window.APP_VERSION = APP_VERSION;

// 確保畫面上所有版本號膠囊同步顯示為 v3.96
const appVersionBadgeEl = document.getElementById('appVersionBadge');
if (appVersionBadgeEl) {
    appVersionBadgeEl.textContent = APP_VERSION;
}
const settingsVersionTextEl = document.getElementById('settingsVersionText');
if (settingsVersionTextEl) {
    settingsVersionTextEl.textContent = `版本 ${APP_VERSION}`;
}

// ==========================================
// 📅 單一路線支線星期排程（daySegments）共用工具函數（向下相容未設定之舊路線）
// ==========================================
const ROUTE_WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 週一～週日顯示順序
const ROUTE_WEEKDAY_NAMES_ZH = ['日', '一', '二', '三', '四', '五', '六'];
window.activeRoutePreviewWeekday = null; // null = 自動讀取系統今日星期；0~6 = 預覽面板模擬星期

function getEffectiveRouteWeekday() {
    if (typeof window.activeRoutePreviewWeekday === 'number' && window.activeRoutePreviewWeekday >= 0 && window.activeRoutePreviewWeekday <= 6) {
        return window.activeRoutePreviewWeekday;
    }
    return new Date().getDay();
}

function getWeekdayLabelZh(dayNum) {
    const idx = Number(dayNum);
    return (idx >= 0 && idx <= 6) ? ROUTE_WEEKDAY_NAMES_ZH[idx] : '';
}

function formatDaySegmentDaysZh(days) {
    if (!Array.isArray(days) || days.length === 0) return '無執行日';
    const unique = new Set(days.map(d => Number(d)).filter(d => d >= 0 && d <= 6));
    if (unique.size >= 7) return '每日';
    return ROUTE_WEEKDAY_ORDER.filter(d => unique.has(d)).map(d => ROUTE_WEEKDAY_NAMES_ZH[d]).join('');
}

function normalizeRouteDaySegments(rawList, pointsLen = Infinity) {
    if (!Array.isArray(rawList) || rawList.length === 0) return [];
    const maxIdx = Number.isFinite(pointsLen) && pointsLen > 0 ? pointsLen - 1 : Infinity;
    const result = [];
    rawList.forEach((seg, idx) => {
        if (!seg || typeof seg !== 'object') return;
        let s = Math.max(0, Math.floor(Number(seg.startIdx)));
        let e = Math.max(0, Math.floor(Number(seg.endIdx)));
        if (isNaN(s) || isNaN(e)) return;
        if (s > e) { const tmp = s; s = e; e = tmp; }
        if (Number.isFinite(maxIdx)) {
            s = Math.min(maxIdx, s);
            e = Math.min(maxIdx, e);
        }
        if (e <= s) return;
        const rawDays = Array.isArray(seg.days) ? seg.days : [0, 1, 2, 3, 4, 5, 6];
        const cleanDays = Array.from(new Set(rawDays.map(d => Number(d)).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)));
        result.push({
            id: typeof seg.id === 'string' && seg.id.trim() ? seg.id.trim() : `dseg_${Date.now()}_${idx}`,
            startIdx: s,
            endIdx: e,
            days: cleanDays,
            label: typeof seg.label === 'string' ? seg.label.trim().slice(0, 24) : ''
        });
    });
    return result;
}

function getInactiveDaySegmentsForRoute(route, weekday = getEffectiveRouteWeekday()) {
    if (!route || !Array.isArray(route.daySegments) || route.daySegments.length === 0) return [];
    const ptsLen = Array.isArray(route.points) ? route.points.length : Infinity;
    const normalized = normalizeRouteDaySegments(route.daySegments, ptsLen);
    return normalized.filter(seg => !seg.days.includes(weekday));
}

function buildInactiveDayEdgeMaskForRoute(route, weekday = getEffectiveRouteWeekday()) {
    if (!route || !Array.isArray(route.points) || route.points.length < 2) return null;
    const inactiveSegs = getInactiveDaySegmentsForRoute(route, weekday);
    if (inactiveSegs.length === 0) return null;
    const mask = new Uint8Array(route.points.length);
    for (let s = 0; s < inactiveSegs.length; s++) {
        const seg = inactiveSegs[s];
        const from = Math.max(1, seg.startIdx + 1);
        const to = Math.min(route.points.length - 1, seg.endIdx);
        for (let i = from; i <= to; i++) {
            mask[i] = 1;
        }
    }
    return mask;
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
let isTemporarilyPanning = false;
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

const FESTIVAL_THEMES = {
    christmas: {
        id: 'christmas',
        name: '耶誕節主題',
        icon: '🎄',
        desc: '滿版飄雪＋聖誕按鈕裝飾',
        bodyClass: 'theme-christmas',
        hasSnow: true
    },
    night: {
        id: 'night',
        name: '夜間暗色主題',
        icon: '🌙',
        desc: '高對比深色介面＋舒緩音樂',
        bodyClass: 'theme-night',
        hasSnow: false
    }
};

const DEFAULT_SYSTEM_CONFIG = {
    radarIntervalSec: 5,
    lookAheadDistMeters: 100,
    confirmDistMeters: 45,
    bearingToleranceDeg: 30,
    voiceRate: 1.1,
    lowSpeedZoom: 18.5,
    highSpeedZoom: 14.5,
    enableDynamicZoom: true,
    showOnlineFleetList: true,
    onlineFleetListDevOnly: false,
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
    buildingManagerPassword: '666666',
    festivalThemeEnabled: false,
    festivalTheme: 'christmas'
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
    const rawFestivalTheme = typeof src.festivalTheme === 'string' ? src.festivalTheme.trim() : '';
    const festivalTheme = FESTIVAL_THEMES[rawFestivalTheme] ? rawFestivalTheme : DEFAULT_SYSTEM_CONFIG.festivalTheme;

    // 若雲端或本機舊快取仍為舊預設 17.5，自動升級 +1.0 至 18.5
    const rawLowZoomNum = Number(src.lowSpeedZoom);
    const effectiveRawLowZoom = (rawLowZoomNum === 17.5) ? 18.5 : src.lowSpeedZoom;

    return {
        radarIntervalSec: clampNum(src.radarIntervalSec, 2, 120, DEFAULT_SYSTEM_CONFIG.radarIntervalSec),
        lookAheadDistMeters: clampNum(src.lookAheadDistMeters, 20, 600, DEFAULT_SYSTEM_CONFIG.lookAheadDistMeters),
        confirmDistMeters: clampNum(src.confirmDistMeters, 10, 200, DEFAULT_SYSTEM_CONFIG.confirmDistMeters),
        bearingToleranceDeg: clampNum(src.bearingToleranceDeg, 5, 180, DEFAULT_SYSTEM_CONFIG.bearingToleranceDeg),
        voiceRate: Number(clampNum(src.voiceRate, 0.8, 1.5, DEFAULT_SYSTEM_CONFIG.voiceRate).toFixed(2)),
        lowSpeedZoom: Number(clampNum(effectiveRawLowZoom, 12, 21.5, DEFAULT_SYSTEM_CONFIG.lowSpeedZoom).toFixed(2)),
        highSpeedZoom: Number(clampNum(src.highSpeedZoom, 10, 20, DEFAULT_SYSTEM_CONFIG.highSpeedZoom).toFixed(2)),
        enableDynamicZoom: typeof src.enableDynamicZoom === 'boolean' ? src.enableDynamicZoom : DEFAULT_SYSTEM_CONFIG.enableDynamicZoom,
        showOnlineFleetList: typeof src.showOnlineFleetList === 'boolean' ? src.showOnlineFleetList : DEFAULT_SYSTEM_CONFIG.showOnlineFleetList,
        onlineFleetListDevOnly: typeof src.onlineFleetListDevOnly === 'boolean' ? src.onlineFleetListDevOnly : DEFAULT_SYSTEM_CONFIG.onlineFleetListDevOnly,
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
        buildingManagerPassword,
        festivalThemeEnabled: typeof src.festivalThemeEnabled === 'boolean' ? src.festivalThemeEnabled : DEFAULT_SYSTEM_CONFIG.festivalThemeEnabled,
        festivalTheme
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

// ==========================================
// 🎄 節慶主題系統（開發者全隊開啟與選定主題 ＋ 隊員於「圖層」選單第一項自行開關 ＋ 滿版輕量飄雪引擎）
// ==========================================
const FESTIVAL_THEME_USER_PREF_KEY = 'yingge_festival_theme_user_pref_v1';
let festivalSnowRafId = null;
let festivalSnowFlakes = [];
let festivalSnowLastTs = 0;

function getEffectiveFestivalThemeState() {
    const fleetEnabled = Boolean(systemNavConfig && systemNavConfig.festivalThemeEnabled);
    const themeKey = (systemNavConfig && FESTIVAL_THEMES[systemNavConfig.festivalTheme])
        ? systemNavConfig.festivalTheme
        : 'christmas';
    const themeMeta = FESTIVAL_THEMES[themeKey] || FESTIVAL_THEMES.christmas;

    let userPref = null;
    try {
        const raw = localStorage.getItem(FESTIVAL_THEME_USER_PREF_KEY);
        if (raw === 'on' || raw === 'off') userPref = raw;
    } catch (e) {}

    const isFeatureAllowed = (typeof isUserFeatureAllowed !== 'function') || isUserFeatureAllowed('festivalTheme');
    const isActive = !isFeatureAllowed
        ? false
        : ((userPref === 'off')
            ? false
            : (userPref === 'on' ? true : fleetEnabled));

    return { isActive, themeKey, themeMeta, fleetEnabled, userPref };
}

function toggleUserFestivalTheme() {
    const state = getEffectiveFestivalThemeState();
    const nextActive = !state.isActive;
    try {
        if (nextActive === state.fleetEnabled) {
            localStorage.removeItem(FESTIVAL_THEME_USER_PREF_KEY);
        } else {
            localStorage.setItem(FESTIVAL_THEME_USER_PREF_KEY, nextActive ? 'on' : 'off');
        }
    } catch (e) {}

    applyFestivalThemeToRuntime();
    window.BgmPlayer?.unlockAndSync();
    if (typeof renderMapLayerMenuOptions === 'function') {
        renderMapLayerMenuOptions();
    }
    return nextActive;
}

function stopFestivalSnowAnimation(hideCanvas = true) {
    if (festivalSnowRafId !== null) {
        cancelAnimationFrame(festivalSnowRafId);
        festivalSnowRafId = null;
    }
    festivalSnowLastTs = 0;
    if (hideCanvas) {
        const canvas = document.getElementById('festivalSnowCanvas');
        if (canvas) {
            canvas.classList.add('hidden');
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
}

function initFestivalSnowFlakes(width, height) {
    const count = Math.max(36, Math.min(72, Math.round((width * height) / 14000)));
    festivalSnowFlakes = [];
    for (let i = 0; i < count; i++) {
        const radius = 1.4 + Math.random() * 2.8;
        festivalSnowFlakes.push({
            x: Math.random() * width,
            y: Math.random() * height,
            r: radius,
            speedY: 22 + radius * 13 + Math.random() * 14,
            driftAmp: 10 + Math.random() * 18,
            driftPhase: Math.random() * Math.PI * 2,
            driftFreq: 0.55 + Math.random() * 0.85,
            alpha: 0.45 + Math.random() * 0.48
        });
    }
}

function syncFestivalThemeSnowState() {
    const state = getEffectiveFestivalThemeState();
    const isPowerSave = Boolean(document.body && document.body.classList.contains('power-saving'));
    const shouldRun = Boolean(state.isActive && state.themeMeta.hasSnow && !isPowerSave && !document.hidden);

    if (!shouldRun) {
        stopFestivalSnowAnimation(true);
        return;
    }

    const canvas = document.getElementById('festivalSnowCanvas');
    if (!canvas) return;
    canvas.classList.remove('hidden');

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = window.innerWidth || document.documentElement.clientWidth || 360;
    const height = window.innerHeight || document.documentElement.clientHeight || 640;
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        initFestivalSnowFlakes(width, height);
    } else if (festivalSnowFlakes.length === 0) {
        initFestivalSnowFlakes(width, height);
    }

    if (festivalSnowRafId !== null) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tick = (now) => {
        if (document.hidden || (document.body && document.body.classList.contains('power-saving'))) {
            stopFestivalSnowAnimation(true);
            return;
        }
        const curState = getEffectiveFestivalThemeState();
        if (!curState.isActive || !curState.themeMeta.hasSnow) {
            stopFestivalSnowAnimation(true);
            return;
        }

        const dt = festivalSnowLastTs ? Math.min(0.05, (now - festivalSnowLastTs) / 1000) : 0.016;
        festivalSnowLastTs = now;

        const w = window.innerWidth || width;
        const h = window.innerHeight || height;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        for (let i = 0; i < festivalSnowFlakes.length; i++) {
            const f = festivalSnowFlakes[i];
            f.y += f.speedY * dt;
            f.driftPhase += f.driftFreq * dt;
            const drawX = f.x + Math.sin(f.driftPhase) * f.driftAmp;

            if (f.y - f.r > h) {
                f.y = -f.r - Math.random() * 12;
                f.x = Math.random() * w;
            }

            ctx.beginPath();
            ctx.arc(drawX, f.y, f.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${f.alpha.toFixed(2)})`;
            ctx.fill();

            if (f.r >= 3.1) {
                ctx.beginPath();
                ctx.arc(drawX, f.y, f.r * 1.9, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(224, 242, 254, ${(f.alpha * 0.24).toFixed(2)})`;
                ctx.fill();
            }
        }

        festivalSnowRafId = requestAnimationFrame(tick);
    };

    festivalSnowLastTs = 0;
    festivalSnowRafId = requestAnimationFrame(tick);
}

function applyFestivalThemeToRuntime() {
    const state = getEffectiveFestivalThemeState();
    const activeThemeKey = state.isActive ? state.themeKey : 'default';
    if (document.body) {
        Object.values(FESTIVAL_THEMES).forEach(t => {
            if (t.bodyClass) document.body.classList.remove(t.bodyClass);
        });
        if (state.isActive && state.themeMeta.bodyClass) {
            document.body.classList.add(state.themeMeta.bodyClass);
        }
        document.body.setAttribute('data-theme', activeThemeKey);
    }
    syncFestivalThemeSnowState();
    window.BgmPlayer?.setTheme(activeThemeKey);
}

window.getEffectiveFestivalThemeState = getEffectiveFestivalThemeState;
window.toggleUserFestivalTheme = toggleUserFestivalTheme;
window.applyFestivalThemeToRuntime = applyFestivalThemeToRuntime;
window.syncFestivalThemeSnowState = syncFestivalThemeSnowState;

window.addEventListener('resize', () => {
    const state = getEffectiveFestivalThemeState();
    if (state.isActive && state.themeMeta.hasSnow) {
        const canvas = document.getElementById('festivalSnowCanvas');
        if (canvas) {
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            const w = window.innerWidth || 360;
            const h = window.innerHeight || 640;
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            initFestivalSnowFlakes(w, h);
        }
    }
});

document.addEventListener('visibilitychange', () => {
    syncFestivalThemeSnowState();
});

applyFestivalThemeToRuntime();

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
    const isApproachOrFreeNavActive = Boolean(
        window.ApproachNav?.isAnyNavActive?.() ||
        window.ApproachNav?.isActive?.()
    );
    if (!forceRelease && (isBlackScreenActive || isRecording || followWatchId !== null || isApproachOrFreeNavActive)) return;
    try {
        if (wakeLock) {
            await wakeLock.release();
            wakeLock = null;
        }
    } catch (e) {
        wakeLock = null;
    }
}

// 頁面由背景返回前景時，若任一導航模式（遵循導航／前往起點導航／自由導航）或錄製／省電進行中，自動重新申請 Wake Lock 維持螢幕恆亮
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const shouldKeepAwake = Boolean(
        isBlackScreenActive ||
        isRecording ||
        followWatchId !== null ||
        window.ApproachNav?.isAnyNavActive?.() ||
        window.ApproachNav?.isActive?.()
    );
    if (shouldKeepAwake) {
        requestScreenWakeLock();
    }
});

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
        if (!isReplaying && typeof window.setMyVehicleMovingState === 'function') {
            window.setMyVehicleMovingState(effectiveSpeedKmh > 1.8);
        }
        if (!isReplaying && window.SpeedCameraManager && typeof window.SpeedCameraManager.checkPosition === 'function') {
            window.SpeedCameraManager.checkPosition(stationaryRes.lat, stationaryRes.lng, stationaryRes.heading, stationaryRes.speedKmh, true);
        }
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
    if (!isReplaying && typeof window.setMyVehicleMovingState === 'function') {
        window.setMyVehicleMovingState(movingSpeedKmh > 1.8);
    }
    if (!isReplaying && window.SpeedCameraManager && typeof window.SpeedCameraManager.checkPosition === 'function') {
        window.SpeedCameraManager.checkPosition(movingRes.lat, movingRes.lng, movingRes.heading, movingRes.speedKmh, false);
    }
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

    window.ApproachNav?.onIdleGpsUpdate?.(
        filtered,
        typeof pos?.coords?.speed === 'number' ? pos.coords.speed : null
    );

    if (!isPowerSaveMapPaused()) {
        const acc = Math.round(filtered.accuracy);
        const accEl = document.getElementById('accuracyText');
        if (accEl) accEl.innerText = `± ${acc} m`;
        if (vehicleMarker) {
            smoothMoveVehicleMarker([filtered.lng, filtered.lat], filtered.heading, 750);
        }
        if ((!filtered.isStationary || filtered.isWakeupFix) && isFollowingCamera && !isTemporarilyPanning) {
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

// 取得路線基準版本號（baseVersion：從雲端載入/下載或上次同步成功時的雲端版本號）
function getRouteBaseVersion(r) {
    const bv = parseInt(r?.baseVersion, 10);
    if (!isNaN(bv) && bv >= 1) return bv;
    return getRouteVersion(r);
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
        baseVersion: getRouteBaseVersion(winner),
        hasLocalEdit: Boolean(winner.hasLocalEdit),
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
        const baseVer = getRouteBaseVersion(r);
        if (r.baseVersion !== baseVer) {
            r.baseVersion = baseVer;
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
    let routesToPersist = savedRoutes;
    if (
        typeof isEditingMode !== 'undefined' &&
        isEditingMode &&
        typeof isReviewingPendingMode !== 'undefined' &&
        !isReviewingPendingMode &&
        typeof originalRouteSnapshot !== 'undefined' &&
        originalRouteSnapshot &&
        typeof selectedRouteIdx === 'number' &&
        selectedRouteIdx >= 0 &&
        selectedRouteIdx < savedRoutes.length
    ) {
        routesToPersist = savedRoutes.map((r, idx) =>
            idx === selectedRouteIdx ? JSON.parse(JSON.stringify(originalRouteSnapshot)) : r
        );
    }
    try {
        localStorage.setItem('yinggeCleanRoutes_v2', JSON.stringify(routesToPersist));
    } catch (e) {}
    const countEl = document.getElementById('historyCount');
    if (countEl) countEl.innerText = routesToPersist.length;
    return localforage.setItem('yinggeCleanRoutes_v2', routesToPersist).catch(() => {});
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

