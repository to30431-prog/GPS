// ==========================================
// [Module] src/approach-nav.js
// 獨立「前往起點導航」＋「自由導航（長按地圖預覽／導航）」雙引擎（Valhalla 優先 → OSRM 無縫降級）模組
// ＋ 右側功能按鈕列「一鍵收合／展開（預設關）」
// - 統一雙引擎算路：Valhalla (auto, use_highways:0.3, precision 6 解碼) → 逾時 3.5s / CORS / 非200 / 解析失敗無縫降級 OSRM
// - 繞路偵測（路線總距 / 直線距 > 1.8 顯示「疑似繞遠路」）＋ 極簡引擎標記（· V / · O）
// - 頂部轉彎提示卡右側附「Google 導航」一鍵跳轉按鈕；完全不影響既有清運路線、雷達、家具與圖釘功能
// ==========================================

(function initApproachNavAndRightToolbarModule() {
    'use strict';

    // --- 核心參數常數 ---
    const MANUAL_PROMPT_THRESHOLD_M = 100;
    const ENGINE_TIMEOUT_MS = 3500;
    const OSRM_ORIGIN_RADIUS_M = 30;
    const OSRM_BEARING_TOLERANCE_DEG = 45;
    const OFF_ROUTE_RECALC_DIST_M = 40;
    const OFF_ROUTE_RECALC_INTERVAL_MS = 10000;
    const NEAR_START_VOICE_DIST_M = 80;
    const ARRIVE_START_SWITCH_DIST_M = 30;
    const ON_MAIN_ROUTE_SWITCH_DIST_M = 20;
    const FREE_NAV_ARRIVE_DIST_M = 25;
    const DETOUR_WARNING_RATIO = 1.8;
    const FREE_NAV_LONG_PRESS_MS = 650;
    const FREE_NAV_LONG_PRESS_MOVE_PX = 10;
    const MODE_SWITCH_COOLDOWN_MS = 800;
    const ROUTE_PREF_OPTIONS = {
        normal: { use_highways: 0.95, use_tolls: 0.5, shortest: false },
        shortcut: { use_highways: 0.05, use_tolls: 0.0, shortest: true }
    };

    const VALHALLA_API_URL = 'https://valhalla1.openstreetmap.de/route';
    const APPROACH_SOURCE_ID = 'approach-nav-route-source';
    const APPROACH_CASING_LAYER_ID = 'approach-nav-route-casing';
    const APPROACH_LINE_LAYER_ID = 'approach-nav-route-line';

    // --- 模組私有狀態（完全獨立，不汙染正式路線狀態） ---
    let activeNavMode = null; // null | 'approach' | 'free'
    let routePrefMode = 'normal'; // 'normal'（一般主幹道）| 'shortcut'（捷徑）
    let isSwitchingRoutePref = false;
    let lastModeSwitchClickTime = 0;

    let activeTargetRoute = null;
    let targetStartLngLat = null; // 正式路線起點座標 [lng, lat]
    let activeDestLngLat = null;  // 目前導航（前往起點或自由點）目的地座標 [lng, lat]
    let activeDestLabel = '';

    let isFollowSessionActive = false;
    let isApproachPromptVisible = false;
    let isApproachActive = false;
    let isApproachFallbackMode = false;
    let isFetchingRoute = false;
    let fetchSeqId = 0;

    let activeEngineCode = '';       // 'V' | 'O' | ''
    let isDetourSuspected = false;
    let activeRouteTotalDistM = 0;
    let activeRouteTotalDurationSec = 0;
    let latestRemainingDurationSec = 0;
    let latestRawSpeedMps = null;

    let lastVehicleLngLat = null;
    let lastVehicleHeading = null;
    let lastDistToStartM = Infinity;
    let lastRecalcTimestamp = 0;

    let approachPolylineCoords = [];
    let approachSteps = [];
    let currentStepIndex = 0;
    let hasSpokenNearStart80m = false;
    let lastFallbackSpokenTime = 0;
    let promptRefreshTimer = null;
    let hudEtaRefreshTimer = null;

    // 導航進行中畫面精簡快照（結束導航時精準還原原本顯示狀態）
    let isNavChromeImmersed = false;
    let wasMainUiHiddenBeforeNav = false;
    let wasQuickAlertHiddenBeforeNav = false;

    // 自由導航專屬狀態（預設關閉）
    let isFreeNavEnabled = false;
    let freeNavPendingConfirmLngLat = null;
    let freeNavPreviewRoute = null;
    let freeNavDestMarker = null;

    let cachedApproachGeoJSON = { type: 'FeatureCollection', features: [] };

    // DOM 元素參考（建立／綁定一次後永久複用，杜絕重繪吃點擊）
    let statusPillContainerEl = null;
    let statusTitleEl = null;
    let isStatusPillBound = false;

    let turnCardEl = null;
    let turnIconEl = null;
    let turnDistEl = null;
    let turnActionEl = null;
    let turnRoadEl = null;
    let turnStartRemEl = null;
    let turnModeBadgeEl = null;
    let turnDetourBadgeEl = null;
    let turnDetourRowEl = null;

    // 左下角行車儀表卡（時速 ＋ ETA）＆ 右下角導航懸浮控制區（一般/捷徑 ＋ 藍色 Google 導航）
    let drivingHudCardEl = null;
    let drivingHudSpeedEl = null;
    let drivingHudEtaEl = null;
    let bottomRightControlsEl = null;
    let floatingRoutePrefBtn = null;
    let floatingGoogleNavBtn = null;

    let freeNavConfirmModalEl = null;
    let freeNavConfirmCoordEl = null;
    let freeNavPreviewBarEl = null;
    let freeNavPreviewDistEl = null;
    let freeNavPreviewDetourEl = null;
    let freeNavPreviewCoordEl = null;
    let freeNavPreviewPrefBtn = null;
    let freeNavPreviewStartBtn = null;
    let freeNavPreviewGoogleBtn = null;

    let rightToolbarToggleBtn = null;
    let isRightToolbarCollapsed = true; // 預設收合（關）

    // ==========================================
    // 1. 右側功能按鈕列「一鍵收合／展開（預設關）」（非侵入式 CSS Class ＋ 內聯顯隱同步切換）
    // ==========================================
    function setRightToolbarCollapsed(collapsed) {
        const toolbar = document.getElementById('rightMapToolbar');
        if (!toolbar) return;
        isRightToolbarCollapsed = Boolean(collapsed);
        toolbar.classList.toggle('is-collapsed', isRightToolbarCollapsed);

        Array.from(toolbar.children).forEach((child) => {
            if (!child || child.id === 'rightToolbarToggleBtn' || child.id === 'followStopBtn') return;
            if (isRightToolbarCollapsed) {
                child.style.setProperty('display', 'none', 'important');
            } else {
                child.style.removeProperty('display');
            }
        });

        if (isRightToolbarCollapsed) {
            document.getElementById('mapLayerMenuPanel')?.classList.add('hidden');
        }

        if (rightToolbarToggleBtn) {
            const iconEl = rightToolbarToggleBtn.querySelector('i');
            const labelEl = rightToolbarToggleBtn.querySelector('span');
            if (isRightToolbarCollapsed) {
                rightToolbarToggleBtn.className = 'bg-slate-800/90 text-white w-11 h-11 rounded-2xl shadow-lg border-2 border-slate-500/80 flex flex-col items-center justify-center active:scale-95 transition-all';
                if (iconEl) iconEl.className = 'fa-solid fa-sliders text-sm';
                if (labelEl) labelEl.textContent = '工具列';
                rightToolbarToggleBtn.title = '展開右側功能按鈕列';
            } else {
                rightToolbarToggleBtn.className = 'bg-slate-700 text-amber-300 w-11 h-11 rounded-2xl shadow-lg border-2 border-amber-400/90 flex flex-col items-center justify-center active:scale-95 transition-all';
                if (iconEl) iconEl.className = 'fa-solid fa-chevron-up text-sm';
                if (labelEl) labelEl.textContent = '收合';
                rightToolbarToggleBtn.title = '收合右側功能按鈕列';
            }
        }
    }

    function toggleRightToolbar() {
        setRightToolbarCollapsed(!isRightToolbarCollapsed);
        try { if (typeof vibrate === 'function') vibrate(20); } catch (e) {}
    }

    function setupRightToolbarCollapseControl() {
        const toolbar = document.getElementById('rightMapToolbar');
        if (!toolbar) return;

        let btn = document.getElementById('rightToolbarToggleBtn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'rightToolbarToggleBtn';
            btn.type = 'button';
            btn.innerHTML = '<i class="fa-solid fa-sliders text-sm"></i><span class="text-[9px] font-bold leading-none mt-0.5">工具列</span>';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleRightToolbar();
            });
            toolbar.insertBefore(btn, toolbar.firstChild);
        }
        rightToolbarToggleBtn = btn;
        setRightToolbarCollapsed(true);

        // 進入或返回主畫面時確保維持預設收合狀態，僅在使用者主動點擊開關時展開
        ['btnCloseWelcomeModal', 'btnSaveFleetUserName', 'closeHistory', 'topBackBtn', 'btnManualCancel', 'btnExitFurnitureMode'].forEach((id) => {
            const el = document.getElementById(id);
            if (el && !el.dataset.rightToolbarResetBound) {
                el.dataset.rightToolbarResetBound = '1';
                el.addEventListener('click', () => {
                    setRightToolbarCollapsed(true);
                });
            }
        });
    }

    // ==========================================
    // 2. 幾何、座標驗證、Polyline6 解碼與方位輔助工具
    // ==========================================
    function isValidLngLat(lng, lat) {
        return (
            typeof lng === 'number' && typeof lat === 'number' &&
            isFinite(lng) && isFinite(lat) &&
            !isNaN(lng) && !isNaN(lat) &&
            lng >= -180 && lng <= 180 &&
            lat >= -90 && lat <= 90 &&
            (Math.abs(lng) > 0.001 || Math.abs(lat) > 0.001)
        );
    }

    function resolveValidGpsOrigin() {
        if (Array.isArray(lastVehicleLngLat) && lastVehicleLngLat.length >= 2 &&
            isValidLngLat(lastVehicleLngLat[0], lastVehicleLngLat[1])) {
            return { lng: lastVehicleLngLat[0], lat: lastVehicleLngLat[1] };
        }
        if (typeof lastValidGpsLng === 'number' && typeof lastValidGpsLat === 'number' &&
            isValidLngLat(lastValidGpsLng, lastValidGpsLat)) {
            return { lng: lastValidGpsLng, lat: lastValidGpsLat };
        }
        return null;
    }

    function notifyNoValidGps() {
        const msg = '尚未取得有效 GPS 定位，請稍候定位完成後再試';
        if (typeof showNavAlert === 'function') {
            showNavAlert('📡', msg, 'bg-amber-600');
        } else {
            try { alert(msg); } catch (e) {}
        }
    }

    function calcDistMeters(lng1, lat1, lng2, lat2) {
        if (typeof getDistanceKm === 'function') {
            return getDistanceKm(lng1, lat1, lng2, lat2) * 1000;
        }
        const R = 6371000;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLng = ((lng2 - lng1) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function calcPolylineLengthMeters(coords) {
        if (!Array.isArray(coords) || coords.length < 2) return 0;
        let totalM = 0;
        for (let i = 1; i < coords.length; i++) {
            totalM += calcDistMeters(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
        }
        return totalM;
    }

    function calcBearingDeg(lng1, lat1, lng2, lat2) {
        if (typeof getBearing === 'function') {
            return getBearing(lng1, lat1, lng2, lat2);
        }
        const toRad = d => (d * Math.PI) / 180;
        const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
        return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }

    function calcPointToPolylineDistM(lng, lat, coords) {
        if (!Array.isArray(coords) || coords.length === 0) return Infinity;
        if (coords.length === 1) return calcDistMeters(lng, lat, coords[0][0], coords[0][1]);
        let minM = Infinity;
        for (let i = 0; i < coords.length - 1; i++) {
            const a = coords[i];
            const b = coords[i + 1];
            const dM = (typeof pointToSegmentDistMeters === 'function')
                ? pointToSegmentDistMeters(lng, lat, a[0], a[1], b[0], b[1])
                : calcDistMeters(lng, lat, a[0], a[1]);
            if (dM < minM) minM = dM;
        }
        return minM;
    }

    function formatDistanceText(meters) {
        const m = Math.max(0, Math.round(Number(meters) || 0));
        if (m >= 1000) {
            return `${(m / 1000).toFixed(1)} 公里`;
        }
        return `${m} 公尺`;
    }

    function bearingToCompassZh(deg) {
        const dirs = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
        const norm = ((Number(deg) % 360) + 360) % 360;
        return dirs[Math.round(norm / 45) % 8];
    }

    function normalizeValidHeading(raw) {
        if (typeof raw !== 'number' || isNaN(raw) || !isFinite(raw) || raw < 0 || raw > 360) {
            return null;
        }
        return ((Math.round(raw) % 360) + 360) % 360;
    }

    // Valhalla Precision 6 (1e6) Encoded Polyline 解碼 → 回傳 GeoJSON [lng, lat] 座標陣列
    function decodePolyline6(encoded) {
        if (typeof encoded !== 'string' || !encoded.length) return [];
        const coords = [];
        let index = 0;
        let lat = 0;
        let lng = 0;
        const len = encoded.length;

        while (index < len) {
            let b = 0;
            let shift = 0;
            let result = 0;
            do {
                if (index >= len) break;
                b = encoded.charCodeAt(index++) - 63;
                result |= (b & 0x1f) << shift;
                shift += 5;
            } while (b >= 0x20);
            const dLat = (result & 1) ? ~(result >> 1) : (result >> 1);
            lat += dLat;

            shift = 0;
            result = 0;
            do {
                if (index >= len) break;
                b = encoded.charCodeAt(index++) - 63;
                result |= (b & 0x1f) << shift;
                shift += 5;
            } while (b >= 0x20);
            const dLng = (result & 1) ? ~(result >> 1) : (result >> 1);
            lng += dLng;

            coords.push([Number((lng / 1e6).toFixed(6)), Number((lat / 1e6).toFixed(6))]);
        }
        return coords;
    }

    function openExternalGoogleMapsNav(destLngLat) {
        if (!Array.isArray(destLngLat) || destLngLat.length < 2) return;
        const lng = Number(destLngLat[0]);
        const lat = Number(destLngLat[1]);
        if (!isValidLngLat(lng, lat)) return;
        const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
        try {
            const win = window.open(url, '_blank', 'noopener,noreferrer');
            if (!win) window.location.href = url;
        } catch (e) {
            window.location.href = url;
        }
    }

    function getEngineTagSuffix(engineCode) {
        if (engineCode === 'V') return ' · V';
        if (engineCode === 'O') return ' · O';
        return '';
    }

    // ==========================================
    // 3. 獨立地圖圖層（approach-nav-route-*）與自由點目的地標記
    // ==========================================
    function ensureApproachMapLayers() {
        if (typeof map === 'undefined' || !map) return;
        try {
            if (!map.getStyle()) return;
            if (!map.getSource(APPROACH_SOURCE_ID)) {
                map.addSource(APPROACH_SOURCE_ID, {
                    type: 'geojson',
                    data: cachedApproachGeoJSON
                });
            }
            if (!map.getLayer(APPROACH_CASING_LAYER_ID)) {
                map.addLayer({
                    id: APPROACH_CASING_LAYER_ID,
                    type: 'line',
                    source: APPROACH_SOURCE_ID,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': '#ffffff',
                        'line-width': 10,
                        'line-opacity': 0.9
                    }
                });
            }
            if (!map.getLayer(APPROACH_LINE_LAYER_ID)) {
                map.addLayer({
                    id: APPROACH_LINE_LAYER_ID,
                    type: 'line',
                    source: APPROACH_SOURCE_ID,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': '#06b6d4',
                        'line-width': 6,
                        'line-opacity': 0.95
                    }
                });
            }
        } catch (e) {}
    }

    function setApproachMapLine(coords, isFallback = false) {
        if (Array.isArray(coords) && coords.length >= 2) {
            cachedApproachGeoJSON = {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: { fallback: Boolean(isFallback) },
                    geometry: { type: 'LineString', coordinates: coords }
                }]
            };
        } else {
            cachedApproachGeoJSON = { type: 'FeatureCollection', features: [] };
        }
        ensureApproachMapLayers();
        try {
            map.getSource(APPROACH_SOURCE_ID)?.setData(cachedApproachGeoJSON);
            if (map.getLayer(APPROACH_LINE_LAYER_ID)) {
                map.setPaintProperty(APPROACH_LINE_LAYER_ID, 'line-color', isFallback ? '#38bdf8' : '#06b6d4');
                map.setPaintProperty(APPROACH_LINE_LAYER_ID, 'line-dasharray', isFallback ? [2, 2] : [1, 0]);
            }
        } catch (e) {}
    }

    function clearApproachMapLine() {
        cachedApproachGeoJSON = { type: 'FeatureCollection', features: [] };
        try {
            if (typeof map !== 'undefined' && map && map.getSource(APPROACH_SOURCE_ID)) {
                map.getSource(APPROACH_SOURCE_ID).setData(cachedApproachGeoJSON);
            }
        } catch (e) {}
    }

    function setFreeNavDestMarker(lngLat) {
        clearFreeNavDestMarker();
        if (typeof map === 'undefined' || !map || !Array.isArray(lngLat) || lngLat.length < 2) return;
        try {
            const el = document.createElement('div');
            el.className = 'pointer-events-none flex flex-col items-center';
            el.innerHTML = `
                <div class="bg-cyan-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg border-2 border-white whitespace-nowrap mb-0.5">🧭 目的地</div>
                <div class="w-4 h-4 rounded-full bg-cyan-500 border-[3px] border-white shadow-lg"></div>
            `;
            freeNavDestMarker = new maplibregl.Marker({
                element: el,
                anchor: 'bottom',
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            })
                .setLngLat([lngLat[0], lngLat[1]])
                .addTo(map);
        } catch (e) {}
    }

    function clearFreeNavDestMarker() {
        if (freeNavDestMarker) {
            try { freeNavDestMarker.remove(); } catch (e) {}
            freeNavDestMarker = null;
        }
    }

    function attachStyleDataListener() {
        if (typeof map === 'undefined' || !map) return;
        map.on('styledata', () => {
            if ((isApproachActive || freeNavPreviewRoute) && cachedApproachGeoJSON.features.length > 0) {
                setTimeout(() => {
                    ensureApproachMapLayers();
                    try {
                        map.getSource(APPROACH_SOURCE_ID)?.setData(cachedApproachGeoJSON);
                    } catch (e) {}
                }, 120);
            }
        });
    }

    // ==========================================
    // 4. 頂部既有狀態膠囊掛載（綁定一次於外層固定容器，不新增第二顆按鈕）
    // ==========================================
    let lastStatusPillClickTime = 0;

    function dismissResidualAdminOverlay() {
        const pwdModal = document.getElementById('adminPasswordModal');
        if (pwdModal && !pwdModal.classList.contains('hidden')) {
            pwdModal.classList.add('hidden');
        }
        const pwdInput = document.getElementById('adminPasswordInput');
        if (pwdInput && document.activeElement === pwdInput) {
            try { pwdInput.blur(); } catch (e) {}
        }
    }

    function ensureStatusPillApproachBinding() {
        if (isStatusPillBound && statusPillContainerEl && statusTitleEl) return;
        const titleEl = document.getElementById('appStatusTitle');
        const pillEl = document.getElementById('topStatusPill') || titleEl?.parentElement;
        if (!titleEl || !pillEl) return;

        statusTitleEl = titleEl;
        statusPillContainerEl = pillEl;
        isStatusPillBound = true;

        statusPillContainerEl.addEventListener('click', (e) => {
            if (!isApproachPromptVisible || isApproachActive || !isFollowSessionActive || !targetStartLngLat) return;
            // 徹底阻斷事件冒泡與同層開發者模式監聽，並防連點
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

            const now = Date.now();
            window._suppressAdminModalUntil = now + 1500;
            dismissResidualAdminOverlay();

            if (now - lastStatusPillClickTime < 800) return;
            lastStatusPillClickTime = now;

            try {
                if (typeof unlockSpeechSynthesis === 'function') unlockSpeechSynthesis();
            } catch (err) {}
            try { if (typeof vibrate === 'function') vibrate(35); } catch (err) {}
            startApproachNavigation();
        }, true);
    }

    function updateStatusPillPromptText(distM) {
        if (!statusTitleEl) statusTitleEl = document.getElementById('appStatusTitle');
        if (!statusTitleEl || !isFinite(distM)) return;
        statusTitleEl.textContent = `前往起點 (${Math.round(distM)}m) · 按我導航`;
    }

    function showPromptButton(distM) {
        ensureStatusPillApproachBinding();
        if (!statusPillContainerEl || !statusTitleEl) return;
        isApproachPromptVisible = true;

        // 顯示「按我導航」期間暫時停用版本號點擊並隱藏版本號，杜絕誤觸開發者密碼視窗
        const verBadge = document.getElementById('appVersionBadge');
        if (verBadge) {
            verBadge.classList.add('hidden', 'pointer-events-none');
        }

        statusPillContainerEl.classList.add('cursor-pointer', 'ring-2', 'ring-blue-500/70', 'active:scale-95', 'transition-transform');
        statusPillContainerEl.setAttribute('role', 'button');
        statusPillContainerEl.title = '點擊啟動前往起點導航';
        updateStatusPillPromptText(distM);

        if (!promptRefreshTimer) {
            promptRefreshTimer = setInterval(() => {
                if (!isApproachPromptVisible || isApproachActive || !isFollowSessionActive) {
                    clearInterval(promptRefreshTimer);
                    promptRefreshTimer = null;
                    return;
                }
                if (isFinite(lastDistToStartM)) {
                    updateStatusPillPromptText(lastDistToStartM);
                }
            }, 1000);
        }
    }

    function hidePromptButton() {
        isApproachPromptVisible = false;
        if (promptRefreshTimer) {
            clearInterval(promptRefreshTimer);
            promptRefreshTimer = null;
        }
        const verBadge = document.getElementById('appVersionBadge');
        if (verBadge) {
            verBadge.classList.remove('hidden', 'pointer-events-none');
        }
        if (statusPillContainerEl) {
            statusPillContainerEl.classList.remove('cursor-pointer', 'ring-2', 'ring-blue-500/70', 'active:scale-95', 'transition-transform');
            statusPillContainerEl.removeAttribute('role');
            statusPillContainerEl.removeAttribute('title');
        }
    }

    // ==========================================
    // 5. 頂部轉彎提示卡 DOM（乾淨寬敞：僅轉向圖示、距離／路名／引擎標記與右側 ✕ 關閉鈕）
    //    ＋ 左下角行車儀表卡（目前時速 ＋ ETA）
    //    ＋ 右下角懸浮控制區（一般/捷徑切換 ＋ 獨立藍色 Google 導航鈕）
    // ==========================================
    function formatEtaClockHHMM(remainingSeconds) {
        const sec = Math.max(0, Math.round(Number(remainingSeconds) || 0));
        const etaDate = new Date(Date.now() + sec * 1000);
        const hh = String(etaDate.getHours()).padStart(2, '0');
        const mm = String(etaDate.getMinutes()).padStart(2, '0');
        return `${hh}:${mm} 抵達`;
    }

    function computeDisplaySpeedKmh(rawSpeedMps) {
        if (typeof rawSpeedMps !== 'number' || !isFinite(rawSpeedMps) || isNaN(rawSpeedMps) || rawSpeedMps < 0) {
            return 0;
        }
        const kmh = rawSpeedMps * 3.6;
        return kmh < 2 ? 0 : Math.round(kmh);
    }

    function syncRoutePrefToggleButtonsUI(isBusy = false) {
        const isNormal = (routePrefMode === 'normal');
        const label = isBusy ? '重算中...' : (isNormal ? '🛣️ 一般' : '⚡ 捷徑');

        if (floatingRoutePrefBtn) {
            floatingRoutePrefBtn.disabled = Boolean(isBusy);
            floatingRoutePrefBtn.className = isNormal
                ? 'bg-slate-900/90 hover:bg-slate-800 backdrop-blur-md text-white text-xs font-black px-3 py-2 rounded-2xl shadow-xl border-2 border-slate-500/80 active:scale-95 transition-all flex items-center justify-center gap-1 whitespace-nowrap disabled:opacity-60'
                : 'bg-amber-600/95 hover:bg-amber-700 backdrop-blur-md text-white text-xs font-black px-3 py-2 rounded-2xl shadow-xl border-2 border-amber-300 active:scale-95 transition-all flex items-center justify-center gap-1 whitespace-nowrap disabled:opacity-60';
            floatingRoutePrefBtn.innerHTML = isBusy
                ? '<i class="fa-solid fa-spinner fa-spin text-[11px]"></i><span>重算中...</span>'
                : `<span>${label}</span>`;
        }

        if (freeNavPreviewPrefBtn) {
            freeNavPreviewPrefBtn.disabled = Boolean(isBusy);
            freeNavPreviewPrefBtn.className = isNormal
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 font-black text-[11px] px-2.5 py-1.5 rounded-xl active:scale-95 whitespace-nowrap flex items-center gap-1 flex-shrink-0 disabled:opacity-60'
                : 'bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-400 font-black text-[11px] px-2.5 py-1.5 rounded-xl active:scale-95 whitespace-nowrap flex items-center gap-1 flex-shrink-0 disabled:opacity-60';
            freeNavPreviewPrefBtn.innerHTML = isBusy
                ? '<i class="fa-solid fa-spinner fa-spin text-[10px]"></i><span>重算中</span>'
                : `<span>${label}</span>`;
        }
    }

    async function handleToggleRoutePrefMode() {
        const now = Date.now();
        if (isSwitchingRoutePref || isFetchingRoute || (now - lastModeSwitchClickTime) < MODE_SWITCH_COOLDOWN_MS) return;
        lastModeSwitchClickTime = now;
        const prevDistM = freeNavPreviewRoute?.totalDistanceMeters || activeRouteTotalDistM || 0;
        routePrefMode = (routePrefMode === 'normal') ? 'shortcut' : 'normal';
        try { if (typeof vibrate === 'function') vibrate(25); } catch (e) {}

        // 情境 1：目前處於自由導航預覽階段 → 立即重算預覽路線（帶入前次距離以觸發差異化備選）
        if (freeNavPreviewRoute && Array.isArray(freeNavPreviewRoute.destLngLat) && !isApproachActive) {
            isSwitchingRoutePref = true;
            syncRoutePrefToggleButtonsUI(true);
            try {
                await planFreeNavPreviewTo(freeNavPreviewRoute.destLngLat[0], freeNavPreviewRoute.destLngLat[1], true, prevDistM);
            } finally {
                isSwitchingRoutePref = false;
                syncRoutePrefToggleButtonsUI(false);
            }
            return;
        }

        // 情境 2：目前處於導航進行中（前往起點或自由導航）→ 立即重算導航路線（帶入前次距離以觸發差異化備選）
        if (isApproachActive) {
            const dest = activeDestLngLat || targetStartLngLat;
            const origin = resolveValidGpsOrigin();
            if (!dest || !origin) {
                syncRoutePrefToggleButtonsUI(false);
                if (!origin) notifyNoValidGps();
                return;
            }
            isSwitchingRoutePref = true;
            syncRoutePrefToggleButtonsUI(true);
            if (turnRoadEl) {
                turnRoadEl.textContent = `切換為「${routePrefMode === 'normal' ? '一般主幹道' : '捷徑'}」重算中...`;
            }
            try {
                await fetchAndApplyActiveNavigationRoute(
                    origin.lng,
                    origin.lat,
                    dest[0],
                    dest[1],
                    lastVehicleHeading,
                    false,
                    prevDistM
                );
            } finally {
                isSwitchingRoutePref = false;
                syncRoutePrefToggleButtonsUI(false);
            }
            return;
        }

        syncRoutePrefToggleButtonsUI(false);
    }

    function ensureDrivingHudAndFloatingControlsDOM() {
        if (!drivingHudCardEl) {
            const hud = document.createElement('div');
            hud.id = 'navDrivingHudCard';
            hud.className = 'hidden fixed bottom-5 left-3.5 z-[61] rounded-2xl px-3.5 py-2.5 pointer-events-none select-none min-w-[136px]';
            // 高對比深色底與明確 inline 色彩，防止被任何地圖或既有樣式覆蓋導致字色過淡
            hud.style.cssText = 'background: rgba(15, 23, 42, 0.95) !important; border: 2px solid rgba(148, 163, 184, 0.85) !important; color: #ffffff !important; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.48) !important; backdrop-filter: blur(8px);';
            hud.innerHTML = `
                <div class="flex items-baseline gap-1.5 leading-tight">
                    <span id="navDrivingHudSpeed" class="text-2xl font-black font-mono tracking-tight" style="color: #ffffff !important; text-shadow: 0 1px 3px rgba(0,0,0,0.7);">0</span>
                    <span class="text-xs font-black" style="color: #38bdf8 !important;">km/h</span>
                </div>
                <div id="navDrivingHudEta" class="text-xs font-black font-mono mt-1 whitespace-nowrap" style="color: #4ade80 !important; text-shadow: 0 1px 2px rgba(0,0,0,0.6);">--:-- 抵達</div>
            `;
            document.body.appendChild(hud);
            drivingHudCardEl = hud;
            drivingHudSpeedEl = hud.querySelector('#navDrivingHudSpeed');
            drivingHudEtaEl = hud.querySelector('#navDrivingHudEta');
        }

        if (!bottomRightControlsEl) {
            const box = document.createElement('div');
            box.id = 'navBottomRightControls';
            // 置於右下角紅色 ✕ 結束鈕（bottom-6, h-14）上方，保留安全間距
            box.className = 'hidden fixed bottom-[5.8rem] right-3.5 z-[61] flex flex-col items-end gap-2 pointer-events-auto select-none';
            box.innerHTML = `
                <button id="navFloatingRoutePrefBtn" type="button" title="切換一般主幹道 / 捷徑模式並重算">
                    <span>🛣️ 一般</span>
                </button>
                <button id="navFloatingGoogleBtn" type="button" class="bg-blue-600 hover:bg-blue-500 text-white text-xs font-black px-3 py-2.5 rounded-2xl shadow-xl border-2 border-white/90 active:scale-95 transition-all flex items-center gap-1.5 whitespace-nowrap" title="開啟 Google Maps 外部導航">
                    <i class="fa-solid fa-diamond-turn-right text-xs"></i>
                    <span>Google 導航</span>
                </button>
            `;

            box.querySelector('#navFloatingRoutePrefBtn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                handleToggleRoutePrefMode();
            });
            box.querySelector('#navFloatingGoogleBtn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const dest = activeDestLngLat || targetStartLngLat;
                openExternalGoogleMapsNav(dest);
            });

            document.body.appendChild(box);
            bottomRightControlsEl = box;
            floatingRoutePrefBtn = box.querySelector('#navFloatingRoutePrefBtn');
            floatingGoogleNavBtn = box.querySelector('#navFloatingGoogleBtn');
            syncRoutePrefToggleButtonsUI(false);
        }
    }

    function updateDrivingHudUI(rawSpeedMps, remainingDurationSec) {
        ensureDrivingHudAndFloatingControlsDOM();
        if (rawSpeedMps !== undefined) {
            latestRawSpeedMps = rawSpeedMps;
        }
        if (typeof remainingDurationSec === 'number' && isFinite(remainingDurationSec) && remainingDurationSec >= 0) {
            latestRemainingDurationSec = remainingDurationSec;
        }
        if (drivingHudSpeedEl) {
            drivingHudSpeedEl.textContent = String(computeDisplaySpeedKmh(latestRawSpeedMps));
        }
        if (drivingHudEtaEl) {
            drivingHudEtaEl.textContent = latestRemainingDurationSec > 0 || activeRouteTotalDurationSec > 0
                ? formatEtaClockHHMM(latestRemainingDurationSec)
                : '--:-- 抵達';
        }
    }

    function enterActiveNavChrome() {
        ensureDrivingHudAndFloatingControlsDOM();
        const mainUiEl = document.getElementById('mainUI');
        const quickAlertEl = document.getElementById('tacticalQuickAlertBtn');

        if (!isNavChromeImmersed) {
            wasMainUiHiddenBeforeNav = mainUiEl ? mainUiEl.classList.contains('hidden') : true;
            wasQuickAlertHiddenBeforeNav = quickAlertEl ? quickAlertEl.classList.contains('hidden') : true;
            isNavChromeImmersed = true;
        }

        // 統一隱藏底部白色控制面板與左下角黃色 +⚠️ 圖釘按鈕
        mainUiEl?.classList.add('hidden');
        quickAlertEl?.classList.add('hidden');

        // 顯示左下角精簡行車儀表卡與右下角懸浮控制區（一般/捷徑 ＋ 藍色 Google 導航）
        drivingHudCardEl?.classList.remove('hidden');
        bottomRightControlsEl?.classList.remove('hidden');
        syncRoutePrefToggleButtonsUI(isSwitchingRoutePref);
        updateDrivingHudUI(latestRawSpeedMps, latestRemainingDurationSec);

        if (!hudEtaRefreshTimer) {
            hudEtaRefreshTimer = setInterval(() => {
                if (!isApproachActive) {
                    clearInterval(hudEtaRefreshTimer);
                    hudEtaRefreshTimer = null;
                    return;
                }
                updateDrivingHudUI(latestRawSpeedMps, latestRemainingDurationSec);
            }, 15000);
        }
    }

    function exitActiveNavChrome() {
        if (hudEtaRefreshTimer) {
            clearInterval(hudEtaRefreshTimer);
            hudEtaRefreshTimer = null;
        }
        drivingHudCardEl?.classList.add('hidden');
        bottomRightControlsEl?.classList.add('hidden');

        if (isNavChromeImmersed) {
            isNavChromeImmersed = false;
            const mainUiEl = document.getElementById('mainUI');
            const quickAlertEl = document.getElementById('tacticalQuickAlertBtn');
            if (mainUiEl && !wasMainUiHiddenBeforeNav) {
                mainUiEl.classList.remove('hidden');
            }
            if (quickAlertEl && !wasQuickAlertHiddenBeforeNav) {
                quickAlertEl.classList.remove('hidden');
            }
        }
    }

    function ensureTurnCardDOM() {
        if (turnCardEl) return;

        const card = document.createElement('div');
        card.id = 'approachTurnCard';
        // 加大上方內距（pt-3.5）與行高，避免轉向／距離大字貼齊頂邊
        card.className = 'hidden fixed top-[4.8rem] left-1/2 -translate-x-1/2 z-[58] w-[calc(100vw-116px)] max-w-[360px] bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border-2 border-cyan-400 px-3.5 pt-3.5 pb-2.5 pointer-events-auto select-none';
        card.innerHTML = `
            <div class="flex items-center gap-3">
                <div id="approachTurnIconBox" class="w-12 h-12 rounded-xl bg-cyan-500/20 border border-cyan-400/60 flex items-center justify-center flex-shrink-0 text-cyan-300">
                    <i id="approachTurnIcon" class="fa-solid fa-arrow-up text-2xl"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-baseline gap-1.5 leading-snug">
                        <span id="approachTurnDist" class="text-xl font-black text-cyan-300 tracking-tight leading-snug whitespace-nowrap">-- 公尺</span>
                        <span id="approachTurnAction" class="text-sm font-black text-white leading-snug truncate">規劃中...</span>
                    </div>
                    <div id="approachTurnRoad" class="text-xs font-bold text-slate-200 truncate mt-0.5">正在計算導航路線</div>
                    <div class="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span id="approachStartRem" class="text-[10px] font-extrabold text-slate-300 whitespace-nowrap">距目標 -- 公尺</span>
                        <span id="approachModeBadge" class="hidden text-[9px] font-black bg-amber-500/25 text-amber-300 border border-amber-400/50 px-1.5 py-0.2 rounded-full whitespace-nowrap">直線方位</span>
                    </div>
                </div>
                <button id="approachCancelBtn" type="button" class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 flex items-center justify-center flex-shrink-0 active:scale-90" title="結束導航">
                    <i class="fa-solid fa-xmark text-sm"></i>
                </button>
            </div>
            <!-- 第二層繞路修正出路：僅在重算後仍 > 1.8 倍時顯示「疑似繞遠路」＋ 一鍵「改用 Google 導航」 -->
            <div id="approachDetourRow" class="hidden mt-2 pt-2 border-t border-slate-700/80 flex items-center justify-between gap-2">
                <span id="approachDetourBadge" class="text-[11px] font-black text-orange-300 flex items-center gap-1 whitespace-nowrap">
                    <span>⚠️</span> 疑似繞遠路
                </span>
                <button id="btnDetourSwitchGoogle" type="button" class="bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-black px-2.5 py-1 rounded-xl shadow active:scale-95 transition-all flex items-center gap-1 whitespace-nowrap border border-blue-300/70">
                    <i class="fa-solid fa-diamond-turn-right text-[10px]"></i>
                    <span>改用 Google 導航</span>
                </button>
            </div>
        `;

        card.querySelector('#approachCancelBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeNavMode === 'free') {
                stopFreeNavigationCompletely();
            } else {
                exitApproachToWaitingOrFollow(false);
            }
        });

        card.querySelector('#btnDetourSwitchGoogle')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const dest = activeDestLngLat || targetStartLngLat;
            openExternalGoogleMapsNav(dest);
        });

        document.body.appendChild(card);
        turnCardEl = card;
        turnIconEl = card.querySelector('#approachTurnIcon');
        turnDistEl = card.querySelector('#approachTurnDist');
        turnActionEl = card.querySelector('#approachTurnAction');
        turnRoadEl = card.querySelector('#approachTurnRoad');
        turnStartRemEl = card.querySelector('#approachStartRem');
        turnModeBadgeEl = card.querySelector('#approachModeBadge');
        turnDetourBadgeEl = card.querySelector('#approachDetourBadge');
        turnDetourRowEl = card.querySelector('#approachDetourRow');
    }

    function updateTurnCardUI({ iconClass, distText, actionText, roadText, startRemM, isFallback }) {
        ensureTurnCardDOM();
        if (!turnCardEl) return;
        if (turnIconEl && iconClass) turnIconEl.className = `${iconClass} text-2xl`;
        if (turnDistEl && distText !== undefined) turnDistEl.textContent = distText;
        if (turnActionEl && actionText !== undefined) turnActionEl.textContent = actionText;
        if (turnRoadEl && roadText !== undefined) turnRoadEl.textContent = roadText;
        if (turnStartRemEl && isFinite(startRemM)) {
            const labelPrefix = (activeNavMode === 'free') ? '距目的地' : '距路線起點';
            turnStartRemEl.textContent = `${labelPrefix} ${formatDistanceText(startRemM)}${getEngineTagSuffix(activeEngineCode)}`;
        }
        if (turnModeBadgeEl) {
            turnModeBadgeEl.classList.toggle('hidden', !isFallback);
        }
        if (turnDetourRowEl) {
            turnDetourRowEl.classList.toggle('hidden', !(isDetourSuspected && !isFallback));
        }
        turnCardEl.classList.remove('hidden');
    }

    function hideTurnCardUI() {
        if (turnCardEl) {
            turnCardEl.classList.add('hidden');
        }
    }

    // ==========================================
    // 6. 自由導航：長按確認彈窗 ＋ 預覽控制列 DOM
    // ==========================================
    function ensureFreeNavConfirmModalDOM() {
        if (freeNavConfirmModalEl) return;

        const modal = document.createElement('div');
        modal.id = 'freeNavConfirmModal';
        modal.className = 'hidden fixed inset-0 bg-black/55 z-[100002] flex items-center justify-center p-4 pointer-events-auto';
        modal.innerHTML = `
            <div class="bg-white w-full max-w-xs rounded-3xl p-4 shadow-2xl border-2 border-cyan-400 flex flex-col gap-3">
                <div class="flex items-center justify-between">
                    <h3 class="text-sm font-black text-cyan-800 flex items-center gap-1.5">
                        <span>🧭</span> 自由導航目的地
                    </h3>
                    <button type="button" id="btnCloseFreeNavConfirm" class="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center active:scale-90">
                        <i class="fa-solid fa-xmark text-xs"></i>
                    </button>
                </div>
                <div class="bg-cyan-50 border border-cyan-200 rounded-2xl px-3 py-2 text-center">
                    <div class="text-[10px] font-extrabold text-cyan-700">目標座標</div>
                    <div id="freeNavConfirmCoordText" class="text-xs font-black font-mono text-gray-800 mt-0.5">--</div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <button type="button" id="btnCancelFreeNavConfirm" class="bg-gray-100 hover:bg-gray-200 text-gray-700 font-extrabold py-2.5 rounded-2xl text-xs active:scale-95">
                        取消
                    </button>
                    <button type="button" id="btnConfirmFreeNavHere" class="bg-cyan-600 hover:bg-cyan-700 text-white font-black py-2.5 rounded-2xl text-xs shadow-md active:scale-95 flex items-center justify-center gap-1">
                        <i class="fa-solid fa-location-arrow text-[11px]"></i> 導航到此
                    </button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeFreeNavConfirmModal();
        });
        modal.querySelector('#btnCloseFreeNavConfirm')?.addEventListener('click', closeFreeNavConfirmModal);
        modal.querySelector('#btnCancelFreeNavConfirm')?.addEventListener('click', closeFreeNavConfirmModal);
        modal.querySelector('#btnConfirmFreeNavHere')?.addEventListener('click', () => {
            const target = freeNavPendingConfirmLngLat ? [...freeNavPendingConfirmLngLat] : null;
            closeFreeNavConfirmModal();
            if (target) {
                planFreeNavPreviewTo(target[0], target[1]);
            }
        });

        document.body.appendChild(modal);
        freeNavConfirmModalEl = modal;
        freeNavConfirmCoordEl = modal.querySelector('#freeNavConfirmCoordText');
    }

    function openFreeNavConfirmModal(lng, lat) {
        ensureFreeNavConfirmModalDOM();
        freeNavPendingConfirmLngLat = [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
        if (freeNavConfirmCoordEl) {
            freeNavConfirmCoordEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        }
        freeNavConfirmModalEl?.classList.remove('hidden');
    }

    function closeFreeNavConfirmModal() {
        freeNavPendingConfirmLngLat = null;
        freeNavConfirmModalEl?.classList.add('hidden');
    }

    function ensureFreeNavPreviewBarDOM() {
        if (freeNavPreviewBarEl) return;

        const bar = document.createElement('div');
        bar.id = 'freeNavPreviewBar';
        bar.className = 'hidden fixed bottom-4 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-full sm:max-w-md z-[62] bg-white/95 backdrop-blur-md rounded-3xl p-3.5 shadow-2xl border-2 border-cyan-400 pointer-events-auto flex flex-col gap-2.5';
        bar.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="text-xs font-black text-cyan-800">🧭 自由導航預覽</span>
                        <span id="freeNavPreviewDist" class="text-xs font-black bg-cyan-50 text-cyan-700 border border-cyan-200 px-2 py-0.5 rounded-full whitespace-nowrap">計算中...</span>
                        <span id="freeNavPreviewDetour" class="hidden text-[10px] font-black bg-orange-100 text-orange-700 border border-orange-300 px-2 py-0.5 rounded-full whitespace-nowrap">疑似繞遠路</span>
                    </div>
                    <div id="freeNavPreviewCoord" class="text-[10px] font-bold font-mono text-gray-500 truncate mt-0.5">--</div>
                </div>
                <div class="flex items-center gap-1.5 flex-shrink-0">
                    <button type="button" id="btnFreeNavPreviewPref" title="切換一般主幹道 / 捷徑模式並重算">
                        <span>🛣️ 一般</span>
                    </button>
                    <button type="button" id="btnFreeNavPreviewGoogle" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-black text-[11px] px-2.5 py-1.5 rounded-xl active:scale-95 whitespace-nowrap flex items-center gap-1 flex-shrink-0" title="開啟 Google Maps 外部導航">
                        <i class="fa-solid fa-diamond-turn-right text-[10px]"></i> Google 導航
                    </button>
                </div>
            </div>
            <div class="grid grid-cols-3 gap-2">
                <button type="button" id="btnFreeNavPreviewCancel" class="col-span-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-extrabold py-2.5 rounded-2xl text-xs active:scale-95">
                    取消
                </button>
                <button type="button" id="btnFreeNavPreviewStart" class="col-span-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white font-black py-2.5 rounded-2xl text-xs shadow-lg active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50">
                    <i class="fa-solid fa-play text-[11px]"></i> 開始導航
                </button>
            </div>
        `;

        bar.querySelector('#btnFreeNavPreviewPref')?.addEventListener('click', (e) => {
            e.stopPropagation();
            handleToggleRoutePrefMode();
        });

        bar.querySelector('#btnFreeNavPreviewCancel')?.addEventListener('click', (e) => {
            e.stopPropagation();
            stopFreeNavigationCompletely();
        });

        bar.querySelector('#btnFreeNavPreviewGoogle')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const dest = freeNavPreviewRoute?.destLngLat || activeDestLngLat;
            openExternalGoogleMapsNav(dest);
        });

        bar.querySelector('#btnFreeNavPreviewStart')?.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                if (typeof unlockSpeechSynthesis === 'function') unlockSpeechSynthesis();
            } catch (err) {}
            try { if (typeof vibrate === 'function') vibrate(35); } catch (err) {}
            startFreeNavigationFromPreview();
        });

        document.body.appendChild(bar);
        freeNavPreviewBarEl = bar;
        freeNavPreviewDistEl = bar.querySelector('#freeNavPreviewDist');
        freeNavPreviewDetourEl = bar.querySelector('#freeNavPreviewDetour');
        freeNavPreviewCoordEl = bar.querySelector('#freeNavPreviewCoord');
        freeNavPreviewPrefBtn = bar.querySelector('#btnFreeNavPreviewPref');
        freeNavPreviewStartBtn = bar.querySelector('#btnFreeNavPreviewStart');
        freeNavPreviewGoogleBtn = bar.querySelector('#btnFreeNavPreviewGoogle');
        syncRoutePrefToggleButtonsUI(false);
    }

    function hideFreeNavPreviewBar() {
        if (freeNavPreviewBarEl) {
            freeNavPreviewBarEl.classList.add('hidden');
        }
    }

    // ==========================================
    // 7. Valhalla 與 OSRM Maneuver 統一轉換為頂部轉彎提示卡與語音格式
    // ==========================================
    function parseValhallaManeuver(m, coords) {
        const type = Number(m?.type) || 0;
        let actionText = '直行';
        let iconClass = 'fa-solid fa-arrow-up';
        let normType = 'turn';

        switch (type) {
            case 1: case 2: case 3:
                actionText = '出發'; iconClass = 'fa-solid fa-arrow-up'; normType = 'depart'; break;
            case 4: case 5: case 6:
                actionText = (activeNavMode === 'free') ? '抵達目的地' : '抵達路線起點';
                iconClass = 'fa-solid fa-flag-checkered'; normType = 'arrive'; break;
            case 7: case 8:
                actionText = '直行'; iconClass = 'fa-solid fa-arrow-up'; break;
            case 9:
                actionText = '靠右轉'; iconClass = 'fa-solid fa-arrow-up-right'; break;
            case 10:
                actionText = '右轉'; iconClass = 'fa-solid fa-arrow-right'; break;
            case 11:
                actionText = '大幅右轉'; iconClass = 'fa-solid fa-arrow-right'; break;
            case 12: case 13:
                actionText = '前方迴轉'; iconClass = 'fa-solid fa-rotate-left'; break;
            case 14:
                actionText = '大幅左轉'; iconClass = 'fa-solid fa-arrow-left'; break;
            case 15:
                actionText = '左轉'; iconClass = 'fa-solid fa-arrow-left'; break;
            case 16:
                actionText = '靠左轉'; iconClass = 'fa-solid fa-arrow-up-left'; break;
            case 17:
                actionText = '直行上匝道'; iconClass = 'fa-solid fa-road'; break;
            case 18:
                actionText = '靠右上匝道'; iconClass = 'fa-solid fa-arrow-up-right'; break;
            case 19:
                actionText = '靠左上匝道'; iconClass = 'fa-solid fa-arrow-up-left'; break;
            case 20:
                actionText = '靠右下匝道'; iconClass = 'fa-solid fa-arrow-up-right'; break;
            case 21:
                actionText = '靠左下匝道'; iconClass = 'fa-solid fa-arrow-up-left'; break;
            case 22:
                actionText = '保持直行'; iconClass = 'fa-solid fa-arrow-up'; break;
            case 23:
                actionText = '靠右行駛'; iconClass = 'fa-solid fa-arrow-up-right'; break;
            case 24:
                actionText = '靠左行駛'; iconClass = 'fa-solid fa-arrow-up-left'; break;
            case 25: case 37: case 38:
                actionText = '匯入主線'; iconClass = 'fa-solid fa-code-merge'; break;
            case 26: {
                const exitNum = Number(m?.roundabout_exit_count) || 0;
                actionText = exitNum > 0 ? `第 ${exitNum} 出口駛出圓環` : '進入圓環';
                iconClass = 'fa-solid fa-arrows-spin';
                break;
            }
            case 27:
                actionText = '駛出圓環'; iconClass = 'fa-solid fa-arrows-spin'; break;
            default:
                actionText = '直行'; iconClass = 'fa-solid fa-arrow-up'; break;
        }

        const beginIdx = Math.max(0, Math.min(coords.length - 1, Number(m?.begin_shape_index) || 0));
        const endIdx = Math.max(beginIdx, Math.min(coords.length - 1, Number(m?.end_shape_index) || beginIdx));
        const roadName = (Array.isArray(m?.street_names) && m.street_names.length > 0)
            ? String(m.street_names[0] || '').trim()
            : '';

        return {
            type: normType,
            actionText,
            iconClass,
            roadName,
            distance: (Number(m?.length) || 0) * 1000, // 公里 × 1000 轉公尺
            durationSec: Number(m?.time) || 0,        // 秒
            maneuverLocation: coords[beginIdx] || coords[coords.length - 1],
            stepCoords: coords.slice(beginIdx, endIdx + 1),
            _preSpoken: false,
            _turnSpoken: false
        };
    }

    function parseOsrmManeuver(step) {
        const m = step?.maneuver || {};
        const type = String(m.type || '').toLowerCase();
        const mod = String(m.modifier || '').toLowerCase();
        const exitNum = Number(m.exit) || 0;

        if (type === 'arrive') {
            return {
                actionText: (activeNavMode === 'free') ? '抵達目的地' : '抵達路線起點',
                iconClass: 'fa-solid fa-flag-checkered'
            };
        }
        if (type === 'roundabout' || type === 'rotary') {
            const exitText = exitNum > 0 ? `第 ${exitNum} 出口駛出圓環` : '進入圓環';
            return { actionText: exitText, iconClass: 'fa-solid fa-arrows-spin' };
        }
        if (type === 'on ramp') {
            if (mod.includes('left')) return { actionText: '靠左上匝道', iconClass: 'fa-solid fa-arrow-up-left' };
            if (mod.includes('right')) return { actionText: '靠右上匝道', iconClass: 'fa-solid fa-arrow-up-right' };
            return { actionText: '上匝道', iconClass: 'fa-solid fa-road' };
        }
        if (type === 'off ramp') {
            if (mod.includes('left')) return { actionText: '靠左下匝道', iconClass: 'fa-solid fa-arrow-up-left' };
            if (mod.includes('right')) return { actionText: '靠右下匝道', iconClass: 'fa-solid fa-arrow-up-right' };
            return { actionText: '下匝道', iconClass: 'fa-solid fa-road' };
        }
        if (type === 'merge') {
            return { actionText: '匯入主線', iconClass: 'fa-solid fa-code-merge' };
        }
        if (type === 'fork') {
            if (mod.includes('left')) return { actionText: '靠左行駛', iconClass: 'fa-solid fa-arrow-up-left' };
            if (mod.includes('right')) return { actionText: '靠右行駛', iconClass: 'fa-solid fa-arrow-up-right' };
            return { actionText: '保持直行', iconClass: 'fa-solid fa-arrow-up' };
        }
        if (mod === 'uturn') return { actionText: '前方迴轉', iconClass: 'fa-solid fa-rotate-left' };
        if (mod === 'sharp left') return { actionText: '大幅左轉', iconClass: 'fa-solid fa-arrow-left' };
        if (mod === 'left') return { actionText: '左轉', iconClass: 'fa-solid fa-arrow-left' };
        if (mod === 'slight left') return { actionText: '靠左轉', iconClass: 'fa-solid fa-arrow-up-left' };
        if (mod === 'sharp right') return { actionText: '大幅右轉', iconClass: 'fa-solid fa-arrow-right' };
        if (mod === 'right') return { actionText: '右轉', iconClass: 'fa-solid fa-arrow-right' };
        if (mod === 'slight right') return { actionText: '靠右轉', iconClass: 'fa-solid fa-arrow-up-right' };
        return { actionText: '直行', iconClass: 'fa-solid fa-arrow-up' };
    }

    // ==========================================
    // 8. 統一雙引擎算路函式（Valhalla 第一順位 → OSRM 無縫降級）
    //    - 「一般 / 捷徑」差異化：拉開參數權重；若重算距離與前次相同，自動嘗試較短距離偏好或另一引擎並取較短者
    //    - 「疑似繞遠路（> 1.8x）」第一層自動修正：自動嘗試替代權重／另一引擎重算，能縮短則直接替換
    // ==========================================
    async function fetchValhallaRouteCandidate(originLng, originLat, destLng, destLat, headingDeg, autoOptions, straightDistanceMeters) {
        try {
            const originLoc = { lat: originLat, lon: originLng };
            const validHeading = normalizeValidHeading(headingDeg);
            if (validHeading !== null) {
                originLoc.heading = validHeading;
                originLoc.heading_tolerance = OSRM_BEARING_TOLERANCE_DEG;
            }
            const payload = {
                locations: [
                    originLoc,
                    { lat: destLat, lon: destLng }
                ],
                costing: 'auto',
                costing_options: {
                    auto: autoOptions
                },
                units: 'kilometers',
                language: 'zh-TW'
            };

            const valRes = (typeof fetchWithTimeout === 'function')
                ? await fetchWithTimeout(VALHALLA_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }, ENGINE_TIMEOUT_MS)
                : await fetch(VALHALLA_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

            if (valRes && valRes.ok && valRes.status === 200) {
                const valData = await valRes.json();
                const leg = valData?.trip?.legs?.[0];
                const shapeStr = leg?.shape;
                const decodedCoords = decodePolyline6(shapeStr);
                if (Array.isArray(decodedCoords) && decodedCoords.length >= 2) {
                    const rawManeuvers = Array.isArray(leg?.maneuvers) ? leg.maneuvers : [];
                    const steps = rawManeuvers.map((m, idx) => ({
                        index: idx,
                        ...parseValhallaManeuver(m, decodedCoords)
                    }));
                    const summaryKm = Number(leg?.summary?.length) || Number(valData?.trip?.summary?.length) || 0;
                    const totalDistanceMeters = summaryKm > 0
                        ? summaryKm * 1000
                        : calcPolylineLengthMeters(decodedCoords);
                    const totalDurationSec = Number(leg?.summary?.time) || Number(valData?.trip?.summary?.time) || Math.round(totalDistanceMeters / (25 / 3.6));
                    const detourRatio = straightDistanceMeters > 10
                        ? (totalDistanceMeters / straightDistanceMeters)
                        : 1;

                    return {
                        ok: true,
                        engine: 'V',
                        coords: decodedCoords,
                        steps,
                        totalDistanceMeters,
                        totalDurationSec,
                        straightDistanceMeters,
                        detourRatio,
                        isDetourSuspected: detourRatio > DETOUR_WARNING_RATIO
                    };
                }
            }
        } catch (err) {
            // 逾時、CORS 或解析失敗靜默返回 null
        }
        return null;
    }

    async function fetchOsrmRouteCandidate(originLng, originLat, destLng, destLat, headingDeg, straightDistanceMeters, relaxHeading = false) {
        const startTs = Date.now();
        const validHeading = relaxHeading ? null : normalizeValidHeading(headingDeg);
        const candidateUrls = [];
        if (validHeading !== null) {
            candidateUrls.push(
                `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?steps=true&overview=full&geometries=geojson&bearings=${validHeading},${OSRM_BEARING_TOLERANCE_DEG};&radiuses=${OSRM_ORIGIN_RADIUS_M};unlimited`
            );
        }
        candidateUrls.push(
            `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?steps=true&overview=full&geometries=geojson&radiuses=${OSRM_ORIGIN_RADIUS_M};unlimited`
        );

        for (const url of candidateUrls) {
            const remainingMs = ENGINE_TIMEOUT_MS - (Date.now() - startTs);
            if (remainingMs < 350) break;
            try {
                const res = (typeof fetchWithTimeout === 'function')
                    ? await fetchWithTimeout(url, {}, remainingMs)
                    : await fetch(url);
                if (!res || !res.ok) continue;
                const data = await res.json();
                const osrmRoute = data?.routes?.[0];
                const coords = osrmRoute?.geometry?.coordinates;
                if (data?.code === 'Ok' && Array.isArray(coords) && coords.length >= 2) {
                    const rawSteps = osrmRoute.legs?.[0]?.steps || [];
                    const steps = rawSteps.map((st, idx) => {
                        const parsed = parseOsrmManeuver(st);
                        const loc = Array.isArray(st.maneuver?.location) && st.maneuver.location.length >= 2
                            ? st.maneuver.location
                            : [destLng, destLat];
                        return {
                            index: idx,
                            type: String(st.maneuver?.type || ''),
                            actionText: parsed.actionText,
                            iconClass: parsed.iconClass,
                            roadName: String(st.name || st.ref || '').trim(),
                            distance: Number(st.distance) || 0,
                            durationSec: Number(st.duration) || 0,
                            maneuverLocation: loc,
                            stepCoords: Array.isArray(st.geometry?.coordinates) ? st.geometry.coordinates : [],
                            _preSpoken: false,
                            _turnSpoken: false
                        };
                    });
                    const totalDistanceMeters = Number(osrmRoute.distance) || calcPolylineLengthMeters(coords);
                    const totalDurationSec = Number(osrmRoute.duration) || Math.round(totalDistanceMeters / (25 / 3.6));
                    const detourRatio = straightDistanceMeters > 10
                        ? (totalDistanceMeters / straightDistanceMeters)
                        : 1;

                    return {
                        ok: true,
                        engine: 'O',
                        coords,
                        steps,
                        totalDistanceMeters,
                        totalDurationSec,
                        straightDistanceMeters,
                        detourRatio,
                        isDetourSuspected: detourRatio > DETOUR_WARNING_RATIO
                    };
                }
            } catch (e) {}
        }
        return null;
    }

    async function requestDualEngineRoute(originLng, originLat, destLng, destLat, headingDeg = null, options = {}) {
        if (!isValidLngLat(originLng, originLat) || !isValidLngLat(destLng, destLat)) {
            return { ok: false, noGps: true };
        }

        const straightDistanceMeters = calcDistMeters(originLng, originLat, destLng, destLat);
        const prefAutoOptions = ROUTE_PREF_OPTIONS[routePrefMode] || ROUTE_PREF_OPTIONS.normal;
        const prevDistanceMeters = Number(options?.prevDistanceMeters) || 0;

        // 1. 第一順位：Valhalla；失敗立即無縫降級 OSRM
        let bestResult = await fetchValhallaRouteCandidate(
            originLng, originLat, destLng, destLat, headingDeg, prefAutoOptions, straightDistanceMeters
        );
        if (!bestResult) {
            bestResult = await fetchOsrmRouteCandidate(
                originLng, originLat, destLng, destLat, headingDeg, straightDistanceMeters, false
            );
        }

        if (!bestResult) {
            return {
                ok: false,
                engine: '',
                totalDurationSec: Math.round(straightDistanceMeters / (25 / 3.6)),
                straightDistanceMeters,
                detourRatio: 1,
                isDetourSuspected: false
            };
        }

        const isSameAsPrevious = prevDistanceMeters > 0 && Math.abs(bestResult.totalDistanceMeters - prevDistanceMeters) < 15;
        const needsDetourRetry = Boolean(bestResult.isDetourSuspected);

        // 2. 模式切換距離相同 OR 疑似繞遠路（> 1.8x）：自動嘗試較短距離偏好與另一引擎，並取較短距離路線
        if (isSameAsPrevious || needsDetourRetry) {
            const altCandidates = [];
            const shorterValhallaOpts = { use_highways: 0.0, use_tolls: 0.0, shortest: true, maneuver_penalty: 0 };

            if (bestResult.engine === 'V') {
                // 先試極致最短距離偏好（放寬出發方向角避免被迫繞圈）與 OSRM 另一引擎
                const [altVal, altOsrm] = await Promise.all([
                    fetchValhallaRouteCandidate(originLng, originLat, destLng, destLat, null, shorterValhallaOpts, straightDistanceMeters),
                    fetchOsrmRouteCandidate(originLng, originLat, destLng, destLat, null, straightDistanceMeters, true)
                ]);
                if (altVal) altCandidates.push(altVal);
                if (altOsrm) altCandidates.push(altOsrm);
            } else {
                // 主結果為 OSRM 時，補試放寬方向角 OSRM 與 Valhalla 最短偏好
                const [altOsrmRelaxed, altVal] = await Promise.all([
                    fetchOsrmRouteCandidate(originLng, originLat, destLng, destLat, null, straightDistanceMeters, true),
                    fetchValhallaRouteCandidate(originLng, originLat, destLng, destLat, null, shorterValhallaOpts, straightDistanceMeters)
                ]);
                if (altOsrmRelaxed) altCandidates.push(altOsrmRelaxed);
                if (altVal) altCandidates.push(altVal);
            }

            for (const cand of altCandidates) {
                if (cand && cand.ok && cand.totalDistanceMeters + 15 < bestResult.totalDistanceMeters) {
                    bestResult = cand;
                }
            }
        }

        return bestResult;
    }

    // ==========================================
    // 9. 語音播報（含 80m 高優先級插播，切回時絕不切斷）
    // ==========================================
    function enqueueRoutineApproachVoice(text) {
        if (!text) return;
        if (activeNavMode === 'approach' && hasSpokenNearStart80m) return;
        if (typeof speakText === 'function') {
            speakText(text);
        } else if (window.VoiceQueue && typeof window.VoiceQueue.enqueue === 'function') {
            window.VoiceQueue.enqueue(text);
        }
    }

    function speakHighPriorityNearStartVoice() {
        const msg = '即將抵達起始點，準備清運';
        if (typeof isVoiceEnabled !== 'undefined' && !isVoiceEnabled) return;
        if (!('speechSynthesis' in window)) return;

        try {
            if (window.VoiceQueue) {
                window.VoiceQueue.queue.length = 0;
                if (window.VoiceQueue.isSpeaking) {
                    if (window.VoiceQueue._watchdogTimer) {
                        clearTimeout(window.VoiceQueue._watchdogTimer);
                        window.VoiceQueue._watchdogTimer = null;
                    }
                    window.VoiceQueue.isSpeaking = false;
                    window._activeSpeechUtterance = null;
                    try { window.speechSynthesis.cancel(); } catch (e) {}
                }
                window.VoiceQueue.recentHistory?.delete(msg);
                window.VoiceQueue.enqueue(msg);
                return;
            }
        } catch (e) {}

        if (typeof speakText === 'function') {
            speakText(msg);
        }
    }

    // ==========================================
    // 10. 進行中導航算路與單向推進引導（前往起點 & 自由導航共用）
    // ==========================================
    function computeRemainingDurationSec(curLng, curLat, distToDestM) {
        if (!isApproachFallbackMode && Array.isArray(approachSteps) && approachSteps.length > 0) {
            let remSec = 0;
            const curIdx = Math.min(currentStepIndex, approachSteps.length - 1);
            const curStep = approachSteps[curIdx];
            if (curStep) {
                const dToM = calcDistMeters(curLng, curLat, curStep.maneuverLocation[0], curStep.maneuverLocation[1]);
                const stepDist = Number(curStep.distance) || 0;
                const stepDur = Number(curStep.durationSec) || 0;
                if (stepDist > 1 && stepDur > 0) {
                    remSec += stepDur * Math.min(1, dToM / stepDist);
                } else {
                    remSec += stepDur;
                }
            }
            for (let i = curIdx + 1; i < approachSteps.length; i++) {
                remSec += Number(approachSteps[i]?.durationSec) || 0;
            }
            if (remSec > 0) return Math.round(remSec);
        }
        if (activeRouteTotalDurationSec > 0 && activeRouteTotalDistM > 1) {
            return Math.max(0, Math.round(activeRouteTotalDurationSec * Math.min(1, distToDestM / activeRouteTotalDistM)));
        }
        return Math.max(0, Math.round(distToDestM / (25 / 3.6)));
    }

    async function fetchAndApplyActiveNavigationRoute(originLng, originLat, destLng, destLat, headingDeg, isSilentRecalc = false, prevDistanceMeters = 0) {
        if (isFetchingRoute) return;
        isFetchingRoute = true;
        lastRecalcTimestamp = Date.now();
        const mySeq = ++fetchSeqId;

        const result = await requestDualEngineRoute(originLng, originLat, destLng, destLat, headingDeg, { prevDistanceMeters });

        isFetchingRoute = false;
        if (mySeq !== fetchSeqId || !isApproachActive) return;

        if (result.ok && Array.isArray(result.coords) && result.coords.length >= 2) {
            isApproachFallbackMode = false;
            activeEngineCode = result.engine;
            isDetourSuspected = Boolean(result.isDetourSuspected);
            activeRouteTotalDistM = Number(result.totalDistanceMeters) || calcPolylineLengthMeters(result.coords);
            activeRouteTotalDurationSec = Number(result.totalDurationSec) || Math.round(activeRouteTotalDistM / (25 / 3.6));
            approachPolylineCoords = result.coords;
            approachSteps = result.steps;
            currentStepIndex = (approachSteps.length > 1 && approachSteps[0].type === 'depart') ? 1 : 0;

            setApproachMapLine(approachPolylineCoords, false);
            evaluateActiveGuidance(originLng, originLat, !isSilentRecalc);
        } else {
            activeEngineCode = '';
            isDetourSuspected = false;
            activateStraightLineFallback(originLng, originLat, !isSilentRecalc);
        }
    }

    function activateStraightLineFallback(curLng, curLat, announceNow = false) {
        const dest = activeDestLngLat || targetStartLngLat;
        if (!dest) return;
        isApproachFallbackMode = true;
        activeEngineCode = '';
        isDetourSuspected = false;
        approachPolylineCoords = [[curLng, curLat], [dest[0], dest[1]]];
        approachSteps = [];
        currentStepIndex = 0;

        setApproachMapLine(approachPolylineCoords, true);

        const distM = calcDistMeters(curLng, curLat, dest[0], dest[1]);
        activeRouteTotalDistM = distM;
        activeRouteTotalDurationSec = Math.round(distM / (25 / 3.6));
        const bearing = calcBearingDeg(curLng, curLat, dest[0], dest[1]);
        const dirZh = bearingToCompassZh(bearing);
        const destName = activeDestLabel || activeTargetRoute?.name || '目的地';

        updateTurnCardUI({
            iconClass: 'fa-solid fa-compass',
            distText: formatDistanceText(distM),
            actionText: `往${dirZh}方前進`,
            roadText: `直線前往「${destName}」`,
            startRemM: distM,
            isFallback: true
        });
        updateDrivingHudUI(latestRawSpeedMps, activeRouteTotalDurationSec);

        const now = Date.now();
        if (announceNow || (now - lastFallbackSpokenTime > 20000 && !(activeNavMode === 'approach' && hasSpokenNearStart80m))) {
            lastFallbackSpokenTime = now;
            enqueueRoutineApproachVoice(`路網逾時，請往${dirZh}方前進，距離約 ${Math.round(distM)} 公尺`);
        }
    }

    function evaluateActiveGuidance(curLng, curLat, isInitialAfterFetch = false) {
        const dest = activeDestLngLat || targetStartLngLat;
        if (!isApproachActive || !dest) return;

        const distToDestM = calcDistMeters(curLng, curLat, dest[0], dest[1]);

        if (isApproachFallbackMode || approachSteps.length === 0) {
            activateStraightLineFallback(curLng, curLat, false);
            return;
        }

        // 單向推進 currentStepIndex（絕不往回跳針）
        while (currentStepIndex < approachSteps.length - 1) {
            const curStep = approachSteps[currentStepIndex];
            const nextStep = approachSteps[currentStepIndex + 1];
            const dToCurManeuver = calcDistMeters(
                curLng, curLat,
                curStep.maneuverLocation[0], curStep.maneuverLocation[1]
            );

            if (dToCurManeuver <= 18) {
                currentStepIndex++;
                continue;
            }

            if (nextStep.stepCoords.length >= 2) {
                const dToNextSeg = calcPointToPolylineDistM(curLng, curLat, nextStep.stepCoords);
                const prevSegCoords = approachSteps[Math.max(0, currentStepIndex - 1)]?.stepCoords || [];
                const dToPrevSeg = prevSegCoords.length >= 2
                    ? calcPointToPolylineDistM(curLng, curLat, prevSegCoords)
                    : Infinity;
                if (dToNextSeg <= 18 && dToNextSeg + 8 < dToPrevSeg && dToCurManeuver <= 45) {
                    currentStepIndex++;
                    continue;
                }
            }
            break;
        }

        const step = approachSteps[Math.min(currentStepIndex, approachSteps.length - 1)];
        if (!step) return;

        const distToManeuverM = calcDistMeters(
            curLng, curLat,
            step.maneuverLocation[0], step.maneuverLocation[1]
        );
        const fallbackLabel = (activeNavMode === 'free') ? '目的地' : (activeTargetRoute?.name || '路線起點');
        const cleanRoadName = (step.roadName && step.roadName !== 'undefined' && step.roadName !== 'null')
            ? String(step.roadName).trim()
            : '';
        const roadLabel = cleanRoadName || (step.type === 'arrive' ? fallbackLabel : '前方道路');
        const isTurnAction = step.actionText.includes('轉') || step.actionText.includes('迴轉');
        const actionWithRoadText = cleanRoadName
            ? (isTurnAction ? `${step.actionText}${cleanRoadName}` : `${step.actionText}，進入 ${cleanRoadName}`)
            : step.actionText;

        updateTurnCardUI({
            iconClass: step.iconClass,
            distText: formatDistanceText(distToManeuverM),
            actionText: step.actionText,
            roadText: roadLabel,
            startRemM: distToDestM,
            isFallback: false
        });
        const remSec = computeRemainingDurationSec(curLng, curLat, distToDestM);
        updateDrivingHudUI(latestRawSpeedMps, remSec);

        if (activeNavMode === 'approach' && hasSpokenNearStart80m) return;

        const startVoicePrefix = (activeNavMode === 'free') ? '開始導航' : '開始前往起點';
        if (isInitialAfterFetch && !step._preSpoken && !step._turnSpoken) {
            if (distToManeuverM <= 35) {
                step._preSpoken = true;
                step._turnSpoken = true;
                enqueueRoutineApproachVoice(`${startVoicePrefix}，前方20公尺${actionWithRoadText}`);
            } else {
                step._preSpoken = true;
                const rounded = distToManeuverM >= 1000
                    ? `${(distToManeuverM / 1000).toFixed(1)} 公里`
                    : `${Math.max(20, Math.round(distToManeuverM / 10) * 10)} 公尺`;
                enqueueRoutineApproachVoice(`${startVoicePrefix}，前方${rounded}${actionWithRoadText}`);
            }
            return;
        }

        if (distToManeuverM <= 150 && distToManeuverM > 38 && !step._preSpoken) {
            step._preSpoken = true;
            const roundedM = Math.max(50, Math.round(distToManeuverM / 10) * 10);
            enqueueRoutineApproachVoice(`前方${roundedM}公尺${actionWithRoadText}`);
        } else if (distToManeuverM <= 32 && !step._turnSpoken) {
            step._preSpoken = true;
            step._turnSpoken = true;
            enqueueRoutineApproachVoice(`前方20公尺${actionWithRoadText}`);
        }
    }

    // ==========================================
    // 11. 「前往起點導航」啟動／自動切回／結束生命週期
    // ==========================================
    function startApproachNavigation() {
        if (!isFollowSessionActive || !activeTargetRoute || !targetStartLngLat) return;

        const origin = resolveValidGpsOrigin();
        if (!origin) {
            notifyNoValidGps();
            return;
        }

        // 若有殘留自由導航預覽，先清理
        clearFreeNavPreviewOnly();

        activeNavMode = 'approach';
        activeDestLngLat = [targetStartLngLat[0], targetStartLngLat[1]];
        activeDestLabel = activeTargetRoute.name || '路線起點';
        isApproachActive = true;
        isApproachFallbackMode = false;
        activeEngineCode = '';
        isDetourSuspected = false;
        approachPolylineCoords = [];
        approachSteps = [];
        currentStepIndex = 0;
        lastRecalcTimestamp = 0;
        lastFallbackSpokenTime = 0;

        hidePromptButton();
        setRightToolbarCollapsed(true);
        enterActiveNavChrome();

        // 保底確認正式清運路線維持完整原色（未走過進度 index = 0），不被誤染為灰色
        try {
            if (typeof updateProgressRouteLayers === 'function' &&
                Array.isArray(activeTargetRoute?.points) &&
                activeTargetRoute.points.length >= 2 &&
                !(typeof isPowerSaveMapPaused === 'function' && isPowerSaveMapPaused())) {
                updateProgressRouteLayers(activeTargetRoute.points, 0, null, 0);
            }
        } catch (e) {}

        const titleEl = document.getElementById('appStatusTitle');
        if (titleEl) {
            titleEl.innerText = '前往起點導航中';
        }

        const curDistM = calcDistMeters(origin.lng, origin.lat, targetStartLngLat[0], targetStartLngLat[1]);
        updateTurnCardUI({
            iconClass: 'fa-solid fa-spinner fa-spin',
            distText: formatDistanceText(curDistM),
            actionText: '規劃中...',
            roadText: `正在規劃前往「${activeDestLabel}」`,
            startRemM: curDistM,
            isFallback: false
        });

        fetchAndApplyActiveNavigationRoute(
            origin.lng,
            origin.lat,
            targetStartLngLat[0],
            targetStartLngLat[1],
            lastVehicleHeading,
            false
        );
    }

    // 無縫切回遵循畫面（嚴禁呼叫 speechSynthesis.cancel() 或 VoiceQueue.clear()，保留抵達提示語音完整念完）
    function switchBackToFollowNavigation() {
        fetchSeqId++;
        isFetchingRoute = false;
        isApproachActive = false;
        activeNavMode = null;
        activeDestLngLat = null;
        activeDestLabel = '';
        isApproachFallbackMode = false;
        activeEngineCode = '';
        isDetourSuspected = false;
        approachPolylineCoords = [];
        approachSteps = [];
        currentStepIndex = 0;

        clearApproachMapLine();
        hideTurnCardUI();
        hidePromptButton();
        exitActiveNavChrome();

        const titleEl = document.getElementById('appStatusTitle');
        if (titleEl && activeTargetRoute?.name) {
            titleEl.innerText = `導航：${activeTargetRoute.name}`;
        }
    }

    function exitApproachToWaitingOrFollow(forceFullStop = false) {
        fetchSeqId++;
        isFetchingRoute = false;
        if (activeNavMode === 'approach') {
            isApproachActive = false;
            activeNavMode = null;
            activeDestLngLat = null;
            activeDestLabel = '';
            isApproachFallbackMode = false;
            activeEngineCode = '';
            isDetourSuspected = false;
            approachPolylineCoords = [];
            approachSteps = [];
            currentStepIndex = 0;
            clearApproachMapLine();
            hideTurnCardUI();
            exitActiveNavChrome();
        }

        if (forceFullStop) {
            isFollowSessionActive = false;
            activeTargetRoute = null;
            targetStartLngLat = null;
            hasSpokenNearStart80m = false;
            lastDistToStartM = Infinity;
            hidePromptButton();
            return;
        }

        if (isFollowSessionActive && isFinite(lastDistToStartM) && lastDistToStartM > MANUAL_PROMPT_THRESHOLD_M) {
            showPromptButton(lastDistToStartM);
        } else {
            hidePromptButton();
        }
    }

    // ==========================================
    // 12. 自由導航（功能開關 ＋ 長按地圖預覽 ＋ 開始導航 ＋ 完整清除）
    // ==========================================
    function clearFreeNavPreviewOnly() {
        freeNavPreviewRoute = null;
        hideFreeNavPreviewBar();
        if (activeNavMode !== 'free') {
            clearFreeNavDestMarker();
            if (!isApproachActive) {
                clearApproachMapLine();
            }
        }
    }

    function stopFreeNavigationCompletely() {
        fetchSeqId++;
        isFetchingRoute = false;
        closeFreeNavConfirmModal();
        freeNavPreviewRoute = null;
        hideFreeNavPreviewBar();
        clearFreeNavDestMarker();

        if (activeNavMode === 'free' || !isFollowSessionActive) {
            isApproachActive = false;
            activeNavMode = null;
            activeDestLngLat = null;
            activeDestLabel = '';
            isApproachFallbackMode = false;
            activeEngineCode = '';
            isDetourSuspected = false;
            approachPolylineCoords = [];
            approachSteps = [];
            currentStepIndex = 0;
            clearApproachMapLine();
            hideTurnCardUI();
            exitActiveNavChrome();
        }
    }

    async function planFreeNavPreviewTo(destLng, destLat, isPrefToggle = false, prevDistanceMeters = 0) {
        // 先清除先前殘留的預覽線、標記與狀態（切換模式重算時保留目的地標記與預覽列防閃爍）
        if (!isPrefToggle) {
            stopFreeNavigationCompletely();
        }

        const origin = resolveValidGpsOrigin();
        if (!origin) {
            notifyNoValidGps();
            return;
        }

        const mySeq = ++fetchSeqId;
        ensureFreeNavPreviewBarDOM();
        setFreeNavDestMarker([destLng, destLat]);

        if (freeNavPreviewDistEl) freeNavPreviewDistEl.textContent = isPrefToggle ? '重算中...' : '算路中...';
        if (freeNavPreviewDetourEl) freeNavPreviewDetourEl.classList.add('hidden');
        if (freeNavPreviewCoordEl) freeNavPreviewCoordEl.textContent = `目標：${destLat.toFixed(6)}, ${destLng.toFixed(6)}`;
        if (freeNavPreviewStartBtn) freeNavPreviewStartBtn.disabled = true;
        syncRoutePrefToggleButtonsUI(isPrefToggle);
        activeDestLngLat = [destLng, destLat];
        freeNavPreviewBarEl?.classList.remove('hidden');

        const result = await requestDualEngineRoute(origin.lng, origin.lat, destLng, destLat, lastVehicleHeading, { prevDistanceMeters });
        if (mySeq !== fetchSeqId) return;

        if (result.ok && Array.isArray(result.coords) && result.coords.length >= 2) {
            freeNavPreviewRoute = {
                ...result,
                destLngLat: [destLng, destLat],
                isFallback: false
            };
            setApproachMapLine(result.coords, false);
            if (freeNavPreviewDistEl) {
                freeNavPreviewDistEl.textContent = `${formatDistanceText(result.totalDistanceMeters)}${getEngineTagSuffix(result.engine)}`;
            }
            if (freeNavPreviewDetourEl) {
                freeNavPreviewDetourEl.classList.toggle('hidden', !result.isDetourSuspected);
            }
        } else {
            // 雙引擎皆失敗時降級直線預覽，仍可開始直線導航或跳轉 Google Maps
            const straightCoords = [[origin.lng, origin.lat], [destLng, destLat]];
            const straightM = calcDistMeters(origin.lng, origin.lat, destLng, destLat);
            freeNavPreviewRoute = {
                ok: false,
                engine: '',
                coords: straightCoords,
                steps: [],
                totalDistanceMeters: straightM,
                totalDurationSec: Math.round(straightM / (25 / 3.6)),
                straightDistanceMeters: straightM,
                detourRatio: 1,
                isDetourSuspected: false,
                destLngLat: [destLng, destLat],
                isFallback: true
            };
            setApproachMapLine(straightCoords, true);
            if (freeNavPreviewDistEl) {
                freeNavPreviewDistEl.textContent = `${formatDistanceText(straightM)} · 直線`;
            }
            if (freeNavPreviewDetourEl) {
                freeNavPreviewDetourEl.classList.add('hidden');
            }
        }

        if (freeNavPreviewStartBtn) freeNavPreviewStartBtn.disabled = false;
        syncRoutePrefToggleButtonsUI(false);

        // 適度縮放地圖視野涵蓋起點與目的地預覽線
        try {
            if (typeof map !== 'undefined' && map && Array.isArray(freeNavPreviewRoute.coords) && freeNavPreviewRoute.coords.length >= 2) {
                if (typeof setCameraFollow === 'function') setCameraFollow(false);
                const bounds = new maplibregl.LngLatBounds();
                freeNavPreviewRoute.coords.forEach(c => bounds.extend([c[0], c[1]]));
                map.fitBounds(bounds, { padding: { top: 90, bottom: 180, left: 45, right: 45 }, duration: 500 });
            }
        } catch (e) {}
    }

    function startFreeNavigationFromPreview() {
        if (!freeNavPreviewRoute || !Array.isArray(freeNavPreviewRoute.destLngLat)) return;

        const origin = resolveValidGpsOrigin();
        if (!origin) {
            notifyNoValidGps();
            return;
        }

        const preview = freeNavPreviewRoute;
        freeNavPreviewRoute = null;
        hideFreeNavPreviewBar();

        activeNavMode = 'free';
        activeDestLngLat = [preview.destLngLat[0], preview.destLngLat[1]];
        activeDestLabel = '自由目的地';
        isApproachActive = true;
        isApproachFallbackMode = Boolean(preview.isFallback);
        activeEngineCode = preview.engine || '';
        isDetourSuspected = Boolean(preview.isDetourSuspected);
        activeRouteTotalDistM = Number(preview.totalDistanceMeters) || calcPolylineLengthMeters(preview.coords);
        activeRouteTotalDurationSec = Number(preview.totalDurationSec) || Math.round(activeRouteTotalDistM / (25 / 3.6));
        approachPolylineCoords = Array.isArray(preview.coords) ? preview.coords.slice() : [];
        approachSteps = Array.isArray(preview.steps) ? preview.steps : [];
        currentStepIndex = (approachSteps.length > 1 && approachSteps[0].type === 'depart') ? 1 : 0;
        lastRecalcTimestamp = Date.now();
        lastFallbackSpokenTime = 0;

        setRightToolbarCollapsed(true);
        enterActiveNavChrome();
        if (typeof setCameraFollow === 'function') setCameraFollow(true);
        setApproachMapLine(approachPolylineCoords, isApproachFallbackMode);
        evaluateActiveGuidance(origin.lng, origin.lat, true);
    }

    function isOtherMapInteractionModeActive() {
        if (typeof isEditingMode !== 'undefined' && isEditingMode) return true;
        if (typeof isManualDrawingMode !== 'undefined' && isManualDrawingMode) return true;
        if (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive) return true;
        if (typeof isRecording !== 'undefined' && isRecording) return true;
        if (typeof isReplaying !== 'undefined' && isReplaying) return true;
        return false;
    }

    function setupFreeNavLongPressGesture() {
        if (typeof map === 'undefined' || !map) return;
        const canvasContainer = map.getCanvasContainer();
        if (!canvasContainer) return;

        let holdTimer = null;
        let startX = 0;
        let startY = 0;
        let pendingLngLat = null;

        function clearHold() {
            if (holdTimer !== null) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
            pendingLngLat = null;
        }

        function isIgnoredTarget(targetEl) {
            return Boolean(
                targetEl && targetEl.closest &&
                targetEl.closest('.shared-pin-wrapper, .music-marker, .fleet-truck-marker, .pin-s, .pin-e, .furniture-pin-wrapper, .furniture-popup-wrapper, .callout-box-marker, .callout-anchor-dot, .alert-compact-pin, .alert-popup-wrapper')
            );
        }

        canvasContainer.addEventListener('touchstart', (e) => {
            clearHold();
            if (!isFreeNavEnabled || isOtherMapInteractionModeActive()) return;
            if (!e.touches || e.touches.length !== 1) return;
            if (isIgnoredTarget(e.target)) return;

            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            const rect = canvasContainer.getBoundingClientRect();
            pendingLngLat = map.unproject([touch.clientX - rect.left, touch.clientY - rect.top]);

            holdTimer = setTimeout(() => {
                holdTimer = null;
                if (!isFreeNavEnabled || isOtherMapInteractionModeActive() || !pendingLngLat) return;
                try { if (typeof vibrate === 'function') vibrate(45); } catch (err) {}
                openFreeNavConfirmModal(pendingLngLat.lng, pendingLngLat.lat);
            }, FREE_NAV_LONG_PRESS_MS);
        }, { passive: true });

        canvasContainer.addEventListener('touchmove', (e) => {
            if (holdTimer === null) return;
            if (!e.touches || e.touches.length !== 1) {
                clearHold();
                return;
            }
            const touch = e.touches[0];
            if (Math.hypot(touch.clientX - startX, touch.clientY - startY) >= FREE_NAV_LONG_PRESS_MOVE_PX) {
                clearHold();
            }
        }, { passive: true });

        canvasContainer.addEventListener('touchend', clearHold, { passive: true });
        canvasContainer.addEventListener('touchcancel', clearHold, { passive: true });

        canvasContainer.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            clearHold();
            if (!isFreeNavEnabled || isOtherMapInteractionModeActive()) return;
            if (isIgnoredTarget(e.target)) return;

            startX = e.clientX;
            startY = e.clientY;
            const rect = canvasContainer.getBoundingClientRect();
            pendingLngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);

            holdTimer = setTimeout(() => {
                holdTimer = null;
                if (!isFreeNavEnabled || isOtherMapInteractionModeActive() || !pendingLngLat) return;
                openFreeNavConfirmModal(pendingLngLat.lng, pendingLngLat.lat);
            }, FREE_NAV_LONG_PRESS_MS);
        });

        canvasContainer.addEventListener('mousemove', (e) => {
            if (holdTimer === null) return;
            if (Math.hypot(e.clientX - startX, e.clientY - startY) >= FREE_NAV_LONG_PRESS_MOVE_PX) {
                clearHold();
            }
        });

        canvasContainer.addEventListener('mouseup', clearHold);
        ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart', 'wheel'].forEach(evtName => {
            map.on(evtName, clearHold);
        });

        map.on('contextmenu', (e) => {
            clearHold();
            if (!isFreeNavEnabled || isOtherMapInteractionModeActive()) return;
            if (isIgnoredTarget(e.originalEvent?.target)) return;
            if (e.originalEvent) e.originalEvent.preventDefault();
            if (e.lngLat) {
                try { if (typeof vibrate === 'function') vibrate(45); } catch (err) {}
                openFreeNavConfirmModal(e.lngLat.lng, e.lngLat.lat);
            }
        });
    }

    function handleFreeNavLiveGps(lng, lat, heading) {
        if (activeNavMode !== 'free' || !isApproachActive || !activeDestLngLat) return;
        const distToDestM = calcDistMeters(lng, lat, activeDestLngLat[0], activeDestLngLat[1]);

        if (distToDestM <= FREE_NAV_ARRIVE_DIST_M) {
            if (typeof speakText === 'function') speakText('已抵達目的地');
            if (typeof showNavAlert === 'function') showNavAlert('🏁', '已抵達自由導航目的地', 'bg-emerald-600');
            try { if (typeof vibrate === 'function') vibrate([120, 60, 120]); } catch (e) {}
            stopFreeNavigationCompletely();
            return;
        }

        const now = Date.now();
        if (!isFetchingRoute && (now - lastRecalcTimestamp) > OFF_ROUTE_RECALC_INTERVAL_MS) {
            const distFromLineM = isApproachFallbackMode
                ? Infinity
                : calcPointToPolylineDistM(lng, lat, approachPolylineCoords);
            if (isApproachFallbackMode || distFromLineM > OFF_ROUTE_RECALC_DIST_M) {
                fetchAndApplyActiveNavigationRoute(lng, lat, activeDestLngLat[0], activeDestLngLat[1], heading, true);
                return;
            }
        }

        evaluateActiveGuidance(lng, lat, false);
    }

    // ==========================================
    // 13. 對外掛載介面（供 navigation.js / map-core.js / config-state.js 最小限度呼叫）
    // ==========================================
    const ApproachNavAPI = {
        onFollowStart(route, currentLngLat) {
            stopFreeNavigationCompletely();
            exitApproachToWaitingOrFollow(true);
            if (!route || !Array.isArray(route.points) || route.points.length === 0) return;

            isFollowSessionActive = true;
            activeTargetRoute = route;
            targetStartLngLat = [Number(route.points[0].lng), Number(route.points[0].lat)];
            hasSpokenNearStart80m = false;

            const validOrigin = resolveValidGpsOrigin();
            const initOrigin = validOrigin || (
                Array.isArray(currentLngLat) && currentLngLat.length >= 2 && isValidLngLat(currentLngLat[0], currentLngLat[1]) &&
                typeof lastValidGpsLng === 'number' && typeof lastValidGpsLat === 'number'
                    ? { lng: currentLngLat[0], lat: currentLngLat[1] }
                    : null
            );

            if (initOrigin) {
                lastVehicleLngLat = [initOrigin.lng, initOrigin.lat];
                const distM = calcDistMeters(
                    initOrigin.lng, initOrigin.lat,
                    targetStartLngLat[0], targetStartLngLat[1]
                );
                lastDistToStartM = distM;
                if (distM > MANUAL_PROMPT_THRESHOLD_M) {
                    showPromptButton(distM);
                }
            }
        },

        onGpsUpdate(payload) {
            if (!payload) return;
            const { lng, lat, heading, rawSpeedMps, minDistToRoute, distToStart, hasAnnouncedStart } = payload;
            if (!isValidLngLat(lng, lat)) return;

            lastVehicleLngLat = [lng, lat];
            const validH = normalizeValidHeading(heading);
            if (validH !== null) lastVehicleHeading = validH;
            latestRawSpeedMps = (typeof rawSpeedMps === 'number' && isFinite(rawSpeedMps)) ? rawSpeedMps : null;
            if (isApproachActive) {
                updateDrivingHudUI(latestRawSpeedMps);
            }

            // 若目前處於自由導航進行中，獨立處理自由導航
            if (activeNavMode === 'free' && isApproachActive) {
                handleFreeNavLiveGps(lng, lat, lastVehicleHeading);
                return;
            }

            if (!isFollowSessionActive || !targetStartLngLat) return;

            const curDistToStartM = (typeof distToStart === 'number' && isFinite(distToStart))
                ? distToStart
                : calcDistMeters(lng, lat, targetStartLngLat[0], targetStartLngLat[1]);
            lastDistToStartM = curDistToStartM;

            const curMinDistRouteM = (typeof minDistToRoute === 'number' && isFinite(minDistToRoute))
                ? minDistToRoute
                : Infinity;

            // A. 若「前往起點導航」尚未手動啟動
            if (!isApproachActive) {
                if (hasAnnouncedStart || curDistToStartM <= ARRIVE_START_SWITCH_DIST_M || curMinDistRouteM <= ON_MAIN_ROUTE_SWITCH_DIST_M) {
                    hidePromptButton();
                    return;
                }
                if (curDistToStartM > MANUAL_PROMPT_THRESHOLD_M) {
                    if (!isApproachPromptVisible) {
                        showPromptButton(curDistToStartM);
                    } else {
                        updateStatusPillPromptText(curDistToStartM);
                    }
                } else {
                    hidePromptButton();
                }
                return;
            }

            // B. 「前往起點導航」進行中
            if (!hasSpokenNearStart80m && curDistToStartM <= NEAR_START_VOICE_DIST_M) {
                hasSpokenNearStart80m = true;
                speakHighPriorityNearStartVoice();
            }

            if (curDistToStartM <= ARRIVE_START_SWITCH_DIST_M || curMinDistRouteM <= ON_MAIN_ROUTE_SWITCH_DIST_M) {
                switchBackToFollowNavigation();
                return;
            }

            if (!isFetchingRoute && approachPolylineCoords.length < 2 && !isApproachFallbackMode) {
                fetchAndApplyActiveNavigationRoute(lng, lat, targetStartLngLat[0], targetStartLngLat[1], lastVehicleHeading, false);
                return;
            }

            const now = Date.now();
            if (!isFetchingRoute && (now - lastRecalcTimestamp) > OFF_ROUTE_RECALC_INTERVAL_MS) {
                const distFromApproachLineM = isApproachFallbackMode
                    ? Infinity
                    : calcPointToPolylineDistM(lng, lat, approachPolylineCoords);
                if (isApproachFallbackMode || distFromApproachLineM > OFF_ROUTE_RECALC_DIST_M) {
                    fetchAndApplyActiveNavigationRoute(lng, lat, targetStartLngLat[0], targetStartLngLat[1], lastVehicleHeading, true);
                    return;
                }
            }

            evaluateActiveGuidance(lng, lat, false);
        },

        onIdleGpsUpdate(filtered, rawSpeedMps = null) {
            if (!filtered || !isValidLngLat(filtered.lng, filtered.lat)) return;
            lastVehicleLngLat = [filtered.lng, filtered.lat];
            const validH = normalizeValidHeading(filtered.heading);
            if (validH !== null) lastVehicleHeading = validH;
            latestRawSpeedMps = (typeof rawSpeedMps === 'number' && isFinite(rawSpeedMps)) ? rawSpeedMps : null;

            if (activeNavMode === 'free' && isApproachActive) {
                updateDrivingHudUI(latestRawSpeedMps);
                handleFreeNavLiveGps(filtered.lng, filtered.lat, lastVehicleHeading);
            }
        },

        isActive() {
            // 僅在「前往起點導航」進行中回傳 true 以隔離正式清運路線進度與灰線渲染
            return Boolean(isApproachActive && activeNavMode === 'approach');
        },

        isPromptVisible() {
            return Boolean(isApproachPromptVisible && !isApproachActive);
        },

        isFreeNavEnabled() {
            return Boolean(isFreeNavEnabled);
        },

        toggleFreeNav() {
            isFreeNavEnabled = !isFreeNavEnabled;
            if (!isFreeNavEnabled) {
                stopFreeNavigationCompletely();
            }
            try { if (typeof vibrate === 'function') vibrate(25); } catch (e) {}
            if (typeof renderMapLayerMenuOptions === 'function') {
                renderMapLayerMenuOptions();
            }
            if (typeof showNavAlert === 'function') {
                showNavAlert(
                    '🧭',
                    isFreeNavEnabled ? '自由導航已開啟（長按地圖可設定目的地）' : '自由導航已關閉',
                    isFreeNavEnabled ? 'bg-cyan-600' : 'bg-gray-700'
                );
            }
            return isFreeNavEnabled;
        },

        stop(isManualExit = true) {
            if (isManualExit) {
                stopFreeNavigationCompletely();
            }
            exitApproachToWaitingOrFollow(Boolean(isManualExit));
        },

        requestDualEngineRoute,
        setRightToolbarCollapsed,
        toggleRightToolbar
    };

    window.ApproachNav = ApproachNavAPI;

    function bootModule() {
        setupRightToolbarCollapseControl();
        attachStyleDataListener();
        setupFreeNavLongPressGesture();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootModule);
    } else {
        bootModule();
    }
})();
