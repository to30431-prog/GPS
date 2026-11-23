// ==========================================
// [Module] src/approach-nav.js
// 獨立「前往起點導航」模組 ＋ 右側功能按鈕列「一鍵收合／展開（預設關）」
// - 手動啟動（防重繪吃點擊）：距起點 > 100m 時顯示左上角「前往起點 (XXXXm) · 按我導航」，事件綁定外層固定容器，刷新僅更新距離文字
// - OSRM 分段轉彎引導：steps=true&overview=full、出發 bearings 容差 45°、起點緩衝半徑 30m、3.5s 逾時降級直線方位與距離、偏離 > 40m 且間隔 > 10s 靜默重算
// - 頂部轉彎提示卡＋語音：currentStepIndex 單向推進＋每段播報旗標防重複；獨立圖層與狀態，不誤觸正式路線音樂與 END
// - 接近起點 <= 80m 高優先級插播「即將抵達起始點，準備清運」（每趟僅一次）；抵達 <= 30m 或踩上正式路線 <= 20m 自動切回遵循畫面且不切斷抵達語音
// ==========================================

(function initApproachNavAndRightToolbarModule() {
    'use strict';

    // --- 核心參數常數 ---
    const MANUAL_PROMPT_THRESHOLD_M = 100;
    const OSRM_TIMEOUT_MS = 3500;
    const OSRM_ORIGIN_RADIUS_M = 30;
    const OSRM_BEARING_TOLERANCE_DEG = 45;
    const OFF_ROUTE_RECALC_DIST_M = 40;
    const OFF_ROUTE_RECALC_INTERVAL_MS = 10000;
    const NEAR_START_VOICE_DIST_M = 80;
    const ARRIVE_START_SWITCH_DIST_M = 30;
    const ON_MAIN_ROUTE_SWITCH_DIST_M = 20;

    const APPROACH_SOURCE_ID = 'approach-nav-route-source';
    const APPROACH_CASING_LAYER_ID = 'approach-nav-route-casing';
    const APPROACH_LINE_LAYER_ID = 'approach-nav-route-line';

    // --- 模組私有狀態（完全獨立，不汙染正式路線狀態） ---
    let activeTargetRoute = null;
    let targetStartLngLat = null;
    let isFollowSessionActive = false;
    let isApproachPromptVisible = false;
    let isApproachActive = false;
    let isApproachFallbackMode = false;
    let isFetchingOsrm = false;
    let fetchSeqId = 0;

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
    let rightToolbarToggleBtn = null;
    let isRightToolbarCollapsed = true; // 預設收合（關）

    // ==========================================
    // 1. 右側功能按鈕列「一鍵收合／展開（預設關）」（非侵入式 CSS Class 切換）
    // ==========================================
    function setRightToolbarCollapsed(collapsed) {
        const toolbar = document.getElementById('rightMapToolbar');
        if (!toolbar) return;
        isRightToolbarCollapsed = Boolean(collapsed);
        toolbar.classList.toggle('is-collapsed', isRightToolbarCollapsed);

        if (isRightToolbarCollapsed) {
            // 收起工具列時同步收合圖層彈出選單，避免懸浮殘留
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
        if (!toolbar || document.getElementById('rightToolbarToggleBtn')) return;

        const btn = document.createElement('button');
        btn.id = 'rightToolbarToggleBtn';
        btn.type = 'button';
        btn.innerHTML = '<i class="fa-solid fa-sliders text-sm"></i><span class="text-[9px] font-bold leading-none mt-0.5">工具列</span>';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleRightToolbar();
        });

        toolbar.insertBefore(btn, toolbar.firstChild);
        rightToolbarToggleBtn = btn;

        // 預設關（收合狀態）
        setRightToolbarCollapsed(true);
    }

    // ==========================================
    // 2. 幾何與方位輔助工具（完全自足，無額外依賴）
    // ==========================================
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

    // ==========================================
    // 3. 獨立地圖圖層（approach-nav-route-*）
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

    // 切換底圖樣式後自動重建前往起點引導線圖層
    function attachStyleDataListener() {
        if (typeof map === 'undefined' || !map) return;
        map.on('styledata', () => {
            if (isApproachActive && cachedApproachGeoJSON.features.length > 0) {
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
    // 4. 頂部既有狀態膠囊掛載（綁定一次於外層固定容器，不新增第二顆按鈕，防重繪吃點擊）
    // ==========================================
    function ensureStatusPillApproachBinding() {
        if (isStatusPillBound && statusPillContainerEl && statusTitleEl) return;
        const titleEl = document.getElementById('appStatusTitle');
        const pillEl = titleEl?.parentElement;
        if (!titleEl || !pillEl) return;

        statusTitleEl = titleEl;
        statusPillContainerEl = pillEl;
        isStatusPillBound = true;

        // 點擊事件以 capture 階段永久綁定於既有的頂部狀態膠囊外層固定容器，
        // 每秒與 GPS 刷新僅更新標題距離文字，絕不重繪容器或覆蓋按鈕事件
        statusPillContainerEl.addEventListener('click', (e) => {
            if (!isApproachPromptVisible || isApproachActive || !isFollowSessionActive || !targetStartLngLat) return;
            // 保留版本號膠囊點擊開啟開發者模式不衝突
            if (e.target && e.target.closest && e.target.closest('#appVersionBadge')) return;
            e.preventDefault();
            e.stopPropagation();
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

        // 保留原本頂部狀態膠囊的樣式與位置，僅加上可點擊視覺提示
        statusPillContainerEl.classList.add('cursor-pointer', 'ring-2', 'ring-blue-500/70', 'active:scale-95', 'transition-transform');
        statusPillContainerEl.setAttribute('role', 'button');
        statusPillContainerEl.title = '點擊啟動前往起點導航';
        updateStatusPillPromptText(distM);

        // 每秒僅更新距離數字（不重繪外層狀態膠囊、不覆蓋點擊事件）
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
        if (statusPillContainerEl) {
            statusPillContainerEl.classList.remove('cursor-pointer', 'ring-2', 'ring-blue-500/70', 'active:scale-95', 'transition-transform');
            statusPillContainerEl.removeAttribute('role');
            statusPillContainerEl.removeAttribute('title');
        }
    }

    function ensureTurnCardDOM() {
        if (turnCardEl) return;

        const card = document.createElement('div');
        card.id = 'approachTurnCard';
        card.className = 'hidden fixed top-[4.8rem] left-1/2 -translate-x-1/2 z-[58] w-[calc(100vw-116px)] max-w-[350px] bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border-2 border-cyan-400 px-3.5 py-2.5 pointer-events-auto select-none';
        card.innerHTML = `
            <div class="flex items-center gap-3">
                <div id="approachTurnIconBox" class="w-12 h-12 rounded-xl bg-cyan-500/20 border border-cyan-400/60 flex items-center justify-center flex-shrink-0 text-cyan-300">
                    <i id="approachTurnIcon" class="fa-solid fa-arrow-up text-2xl"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-baseline gap-1.5">
                        <span id="approachTurnDist" class="text-xl font-black text-cyan-300 tracking-tight leading-none">-- 公尺</span>
                        <span id="approachTurnAction" class="text-sm font-black text-white truncate">規劃中...</span>
                    </div>
                    <div id="approachTurnRoad" class="text-xs font-bold text-slate-200 truncate mt-1">正在計算前往起點路線</div>
                    <div class="flex items-center gap-1.5 mt-1">
                        <span id="approachStartRem" class="text-[10px] font-extrabold text-slate-400">距起點 -- 公尺</span>
                        <span id="approachModeBadge" class="hidden text-[10px] font-black bg-amber-500/25 text-amber-300 border border-amber-400/50 px-1.5 py-0.2 rounded-full">直線方位</span>
                    </div>
                </div>
                <button id="approachCancelBtn" type="button" class="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 flex items-center justify-center flex-shrink-0 active:scale-90" title="結束前往起點導航">
                    <i class="fa-solid fa-xmark text-xs"></i>
                </button>
            </div>
        `;

        card.querySelector('#approachCancelBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            exitApproachToWaitingOrFollow(false);
        });

        document.body.appendChild(card);
        turnCardEl = card;
        turnIconEl = card.querySelector('#approachTurnIcon');
        turnDistEl = card.querySelector('#approachTurnDist');
        turnActionEl = card.querySelector('#approachTurnAction');
        turnRoadEl = card.querySelector('#approachTurnRoad');
        turnStartRemEl = card.querySelector('#approachStartRem');
        turnModeBadgeEl = card.querySelector('#approachModeBadge');
    }

    function updateTurnCardUI({ iconClass, distText, actionText, roadText, startRemM, isFallback }) {
        ensureTurnCardDOM();
        if (!turnCardEl) return;
        if (turnIconEl && iconClass) turnIconEl.className = `${iconClass} text-2xl`;
        if (turnDistEl && distText !== undefined) turnDistEl.textContent = distText;
        if (turnActionEl && actionText !== undefined) turnActionEl.textContent = actionText;
        if (turnRoadEl && roadText !== undefined) turnRoadEl.textContent = roadText;
        if (turnStartRemEl && isFinite(startRemM)) {
            turnStartRemEl.textContent = `距路線起點 ${formatDistanceText(startRemM)}`;
        }
        if (turnModeBadgeEl) {
            turnModeBadgeEl.classList.toggle('hidden', !isFallback);
        }
        turnCardEl.classList.remove('hidden');
    }

    function hideTurnCardUI() {
        if (turnCardEl) {
            turnCardEl.classList.add('hidden');
        }
    }

    // ==========================================
    // 5. OSRM Maneuver 轉中文指令與圖示
    // ==========================================
    function parseOsrmManeuver(step) {
        const m = step?.maneuver || {};
        const type = String(m.type || '').toLowerCase();
        const mod = String(m.modifier || '').toLowerCase();
        const exitNum = Number(m.exit) || 0;

        if (type === 'arrive') {
            return { actionText: '抵達路線起點', iconClass: 'fa-solid fa-flag-checkered' };
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
        if (mod === 'uturn') {
            return { actionText: '前方迴轉', iconClass: 'fa-solid fa-rotate-left' };
        }
        if (mod === 'sharp left') {
            return { actionText: '大幅左轉', iconClass: 'fa-solid fa-arrow-left' };
        }
        if (mod === 'left') {
            return { actionText: '左轉', iconClass: 'fa-solid fa-arrow-left' };
        }
        if (mod === 'slight left') {
            return { actionText: '靠左轉', iconClass: 'fa-solid fa-arrow-up-left' };
        }
        if (mod === 'sharp right') {
            return { actionText: '大幅右轉', iconClass: 'fa-solid fa-arrow-right' };
        }
        if (mod === 'right') {
            return { actionText: '右轉', iconClass: 'fa-solid fa-arrow-right' };
        }
        if (mod === 'slight right') {
            return { actionText: '靠右轉', iconClass: 'fa-solid fa-arrow-up-right' };
        }
        return { actionText: '直行', iconClass: 'fa-solid fa-arrow-up' };
    }

    // ==========================================
    // 6. 語音播報（含 80m 高優先級插播，切換時絕不切斷）
    // ==========================================
    function enqueueRoutineApproachVoice(text) {
        if (!text || hasSpokenNearStart80m) return;
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
                // 清空排隊中的舊轉向提示，確保高優先級插播立即執行
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
    // 7. OSRM 路線請求（3.5s 逾時降級直線方位與距離）
    // ==========================================
    async function fetchApproachOsrmRoute(originLng, originLat, destLng, destLat, headingDeg, isSilentRecalc = false) {
        if (isFetchingOsrm) return;
        isFetchingOsrm = true;
        lastRecalcTimestamp = Date.now();
        const mySeq = ++fetchSeqId;

        const validHeading = normalizeValidHeading(headingDeg);
        const startTs = Date.now();

        const candidateUrls = [];
        if (validHeading !== null) {
            candidateUrls.push(
                `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?steps=true&overview=full&geometries=geojson&bearings=${validHeading},${OSRM_BEARING_TOLERANCE_DEG};&radiuses=${OSRM_ORIGIN_RADIUS_M};unlimited`
            );
        }
        candidateUrls.push(
            `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?steps=true&overview=full&geometries=geojson&radiuses=${OSRM_ORIGIN_RADIUS_M};unlimited`
        );

        let osrmRoute = null;

        for (const url of candidateUrls) {
            const remainingMs = OSRM_TIMEOUT_MS - (Date.now() - startTs);
            if (remainingMs < 350) break;

            try {
                const res = (typeof fetchWithTimeout === 'function')
                    ? await fetchWithTimeout(url, {}, remainingMs)
                    : await fetch(url);
                if (mySeq !== fetchSeqId || !isApproachActive) {
                    isFetchingOsrm = false;
                    return;
                }
                if (!res || !res.ok) continue;
                const data = await res.json();
                if (data?.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
                    osrmRoute = data.routes[0];
                    break;
                }
            } catch (err) {
                // 單次請求逾時或失敗，依剩餘時間嘗試備援或降級直線
            }
        }

        isFetchingOsrm = false;
        if (mySeq !== fetchSeqId || !isApproachActive) return;

        if (osrmRoute && Array.isArray(osrmRoute.geometry?.coordinates) && osrmRoute.geometry.coordinates.length >= 2) {
            isApproachFallbackMode = false;
            approachPolylineCoords = osrmRoute.geometry.coordinates;

            const rawSteps = osrmRoute.legs?.[0]?.steps || [];
            approachSteps = rawSteps.map((st, idx) => {
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
                    maneuverLocation: loc,
                    stepCoords: Array.isArray(st.geometry?.coordinates) ? st.geometry.coordinates : [],
                    _preSpoken: false,
                    _turnSpoken: false
                };
            });

            // currentStepIndex 指向第一個前方轉向動作（略過起點 depart）
            currentStepIndex = (approachSteps.length > 1 && approachSteps[0].type === 'depart') ? 1 : 0;

            setApproachMapLine(approachPolylineCoords, false);
            evaluateApproachGuidance(originLng, originLat, !isSilentRecalc);
        } else {
            // 3.5s 逾時或無路網結果：優雅降級為直線方位與距離提示
            activateStraightLineFallback(originLng, originLat, !isSilentRecalc);
        }
    }

    function activateStraightLineFallback(curLng, curLat, announceNow = false) {
        if (!targetStartLngLat) return;
        isApproachFallbackMode = true;
        approachPolylineCoords = [[curLng, curLat], [targetStartLngLat[0], targetStartLngLat[1]]];
        approachSteps = [];
        currentStepIndex = 0;

        setApproachMapLine(approachPolylineCoords, true);

        const distM = calcDistMeters(curLng, curLat, targetStartLngLat[0], targetStartLngLat[1]);
        const bearing = calcBearingDeg(curLng, curLat, targetStartLngLat[0], targetStartLngLat[1]);
        const dirZh = bearingToCompassZh(bearing);

        updateTurnCardUI({
            iconClass: 'fa-solid fa-compass',
            distText: formatDistanceText(distM),
            actionText: `往${dirZh}方前進`,
            roadText: `直線前往「${activeTargetRoute?.name || '路線起點'}」`,
            startRemM: distM,
            isFallback: true
        });

        const now = Date.now();
        if (announceNow || (now - lastFallbackSpokenTime > 20000 && !hasSpokenNearStart80m)) {
            lastFallbackSpokenTime = now;
            enqueueRoutineApproachVoice(`路網逾時，請往${dirZh}方前往起點，距離約 ${Math.round(distM)} 公尺`);
        }
    }

    // ==========================================
    // 8. 單向推進轉向提示與防跳針語音引擎
    // ==========================================
    function evaluateApproachGuidance(curLng, curLat, isInitialAfterFetch = false) {
        if (!isApproachActive || !targetStartLngLat) return;

        const distToStartM = calcDistMeters(curLng, curLat, targetStartLngLat[0], targetStartLngLat[1]);

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

            // 若已通過目前轉彎點（<= 18m），推進至下一步
            if (dToCurManeuver <= 18) {
                currentStepIndex++;
                continue;
            }

            // 若車輛已明顯進入下一段幾何線段（距下段 <= 18m 且比目前段更近）
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
        const roadLabel = step.roadName || (step.type === 'arrive' ? (activeTargetRoute?.name || '路線起點') : '前方道路');
        const roadVoiceSuffix = step.roadName ? `，進入 ${step.roadName}` : '';

        updateTurnCardUI({
            iconClass: step.iconClass,
            distText: formatDistanceText(distToManeuverM),
            actionText: step.actionText,
            roadText: roadLabel,
            startRemM: distToStartM,
            isFallback: false
        });

        // 若已觸發 80m 抵達起點專屬語音，不再插播一般轉向語音
        if (hasSpokenNearStart80m) return;

        // 剛規劃完成時：若第一個轉彎點在合理範圍內，播報一次出發引導
        if (isInitialAfterFetch && !step._preSpoken && !step._turnSpoken) {
            if (distToManeuverM <= 45) {
                step._preSpoken = true;
                step._turnSpoken = true;
                enqueueRoutineApproachVoice(`開始前往起點，前方準備${step.actionText}${roadVoiceSuffix}`);
            } else {
                step._preSpoken = true;
                const rounded = distToManeuverM >= 1000
                    ? `${(distToManeuverM / 1000).toFixed(1)} 公里`
                    : `${Math.max(10, Math.round(distToManeuverM / 10) * 10)} 公尺`;
                enqueueRoutineApproachVoice(`開始前往起點，前方 ${rounded} ${step.actionText}${roadVoiceSuffix}`);
            }
            return;
        }

        // 每段各自獨立的雙層播報旗標，杜絕重複跳針
        if (distToManeuverM <= 150 && distToManeuverM > 45 && !step._preSpoken) {
            step._preSpoken = true;
            const roundedM = Math.max(50, Math.round(distToManeuverM / 10) * 10);
            enqueueRoutineApproachVoice(`前方 ${roundedM} 公尺，${step.actionText}${roadVoiceSuffix}`);
        } else if (distToManeuverM <= 45 && !step._turnSpoken) {
            step._preSpoken = true;
            step._turnSpoken = true;
            enqueueRoutineApproachVoice(`前方準備${step.actionText}${roadVoiceSuffix}`);
        }
    }

    // ==========================================
    // 9. 啟動／自動切回／結束生命週期
    // ==========================================
    function startApproachNavigation() {
        if (!isFollowSessionActive || !activeTargetRoute || !targetStartLngLat) return;

        isApproachActive = true;
        isApproachFallbackMode = false;
        approachPolylineCoords = [];
        approachSteps = [];
        currentStepIndex = 0;
        lastRecalcTimestamp = 0;
        lastFallbackSpokenTime = 0;

        hidePromptButton();

        // 進入前往起點導航時預設收合右側功能按鈕列（關），點按可展開或收起
        setRightToolbarCollapsed(true);

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

        const originLng = lastVehicleLngLat ? lastVehicleLngLat[0] : (Array.isArray(lastKnownLngLat) ? lastKnownLngLat[0] : null);
        const originLat = lastVehicleLngLat ? lastVehicleLngLat[1] : (Array.isArray(lastKnownLngLat) ? lastKnownLngLat[1] : null);

        if (typeof originLng !== 'number' || typeof originLat !== 'number') {
            updateTurnCardUI({
                iconClass: 'fa-solid fa-satellite-dish',
                distText: '定位中',
                actionText: '等待 GPS',
                roadText: '取得目前位置後自動規劃前往起點路線',
                startRemM: NaN,
                isFallback: false
            });
            return;
        }

        const curDistM = calcDistMeters(originLng, originLat, targetStartLngLat[0], targetStartLngLat[1]);
        updateTurnCardUI({
            iconClass: 'fa-solid fa-spinner fa-spin',
            distText: formatDistanceText(curDistM),
            actionText: '規劃中...',
            roadText: `正在規劃前往「${activeTargetRoute.name || '起點'}」`,
            startRemM: curDistM,
            isFallback: false
        });

        fetchApproachOsrmRoute(
            originLng,
            originLat,
            targetStartLngLat[0],
            targetStartLngLat[1],
            lastVehicleHeading,
            false
        );
    }

    // 無縫切回遵循畫面（嚴禁呼叫 speechSynthesis.cancel() 或 VoiceQueue.clear()，保留抵達提示語音完整念完）
    function switchBackToFollowNavigation() {
        fetchSeqId++;
        isFetchingOsrm = false;
        isApproachActive = false;
        isApproachFallbackMode = false;
        approachPolylineCoords = [];
        approachSteps = [];
        currentStepIndex = 0;

        clearApproachMapLine();
        hideTurnCardUI();
        hidePromptButton();

        const titleEl = document.getElementById('appStatusTitle');
        if (titleEl && activeTargetRoute?.name) {
            titleEl.innerText = `導航：${activeTargetRoute.name}`;
        }
    }

    function exitApproachToWaitingOrFollow(forceFullStop = false) {
        fetchSeqId++;
        isFetchingOsrm = false;
        isApproachActive = false;
        isApproachFallbackMode = false;
        approachPolylineCoords = [];
        approachSteps = [];
        currentStepIndex = 0;

        clearApproachMapLine();
        hideTurnCardUI();

        if (forceFullStop) {
            isFollowSessionActive = false;
            activeTargetRoute = null;
            targetStartLngLat = null;
            hasSpokenNearStart80m = false;
            lastDistToStartM = Infinity;
            hidePromptButton();
            return;
        }

        // 手動關閉前往起點引導卡片，若仍距起點 > 100m 則回到待命手動啟動狀態（頂部狀態膠囊恢復「前往起點 (XXXXm) · 按我導航」）
        if (isFollowSessionActive && isFinite(lastDistToStartM) && lastDistToStartM > MANUAL_PROMPT_THRESHOLD_M) {
            showPromptButton(lastDistToStartM);
        } else {
            hidePromptButton();
        }
    }

    // ==========================================
    // 10. 對外掛載介面（供 navigation.js 最小限度呼叫）
    // ==========================================
    const ApproachNavAPI = {
        onFollowStart(route, currentLngLat) {
            exitApproachToWaitingOrFollow(true);
            if (!route || !Array.isArray(route.points) || route.points.length === 0) return;

            isFollowSessionActive = true;
            activeTargetRoute = route;
            targetStartLngLat = [Number(route.points[0].lng), Number(route.points[0].lat)];
            hasSpokenNearStart80m = false;

            if (Array.isArray(currentLngLat) && currentLngLat.length >= 2 &&
                typeof currentLngLat[0] === 'number' && typeof currentLngLat[1] === 'number') {
                lastVehicleLngLat = [currentLngLat[0], currentLngLat[1]];
                const distM = calcDistMeters(
                    currentLngLat[0], currentLngLat[1],
                    targetStartLngLat[0], targetStartLngLat[1]
                );
                lastDistToStartM = distM;
                // 距起點 > 100m：不自動啟動，僅於左上角顯示手動啟動按鈕
                if (distM > MANUAL_PROMPT_THRESHOLD_M) {
                    showPromptButton(distM);
                }
            }
        },

        onGpsUpdate(payload) {
            if (!isFollowSessionActive || !payload || !targetStartLngLat) return;
            const { lng, lat, heading, minDistToRoute, distToStart, hasAnnouncedStart } = payload;
            if (typeof lng !== 'number' || typeof lat !== 'number') return;

            lastVehicleLngLat = [lng, lat];
            const validH = normalizeValidHeading(heading);
            if (validH !== null) lastVehicleHeading = validH;

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
                        // 僅更新頂部狀態膠囊的距離文字，絕不重繪外層容器或覆蓋點擊事件
                        updateStatusPillPromptText(curDistToStartM);
                    }
                } else {
                    hidePromptButton();
                }
                return;
            }

            // B. 「前往起點導航」進行中
            // B1. 接近起點 <= 80m：每趟僅一次高優先級插播專屬語音
            if (!hasSpokenNearStart80m && curDistToStartM <= NEAR_START_VOICE_DIST_M) {
                hasSpokenNearStart80m = true;
                speakHighPriorityNearStartVoice();
            }

            // B2. 抵達起點 <= 30m 或直接踩上正式路線 <= 20m：自動清除引導線與轉彎卡，無縫切回遵循畫面（不切斷語音）
            if (curDistToStartM <= ARRIVE_START_SWITCH_DIST_M || curMinDistRouteM <= ON_MAIN_ROUTE_SWITCH_DIST_M) {
                switchBackToFollowNavigation();
                return;
            }

            // B3. 若尚未有路線資料（例如剛啟動時還沒定位），立即補發一次請求
            if (!isFetchingOsrm && approachPolylineCoords.length < 2 && !isApproachFallbackMode) {
                fetchApproachOsrmRoute(lng, lat, targetStartLngLat[0], targetStartLngLat[1], lastVehicleHeading, false);
                return;
            }

            // B4. 偏離引導線 > 40m 且距上次重算間隔 > 10s：靜默重算 OSRM
            const now = Date.now();
            if (!isFetchingOsrm && (now - lastRecalcTimestamp) > OFF_ROUTE_RECALC_INTERVAL_MS) {
                const distFromApproachLineM = isApproachFallbackMode
                    ? Infinity
                    : calcPointToPolylineDistM(lng, lat, approachPolylineCoords);
                if (isApproachFallbackMode || distFromApproachLineM > OFF_ROUTE_RECALC_DIST_M) {
                    fetchApproachOsrmRoute(lng, lat, targetStartLngLat[0], targetStartLngLat[1], lastVehicleHeading, true);
                    return;
                }
            }

            // B5. 正常單向推進轉彎卡片與語音提示
            evaluateApproachGuidance(lng, lat, false);
        },

        isActive() {
            return Boolean(isApproachActive);
        },

        isPromptVisible() {
            return Boolean(isApproachPromptVisible && !isApproachActive);
        },

        stop(isManualExit = true) {
            exitApproachToWaitingOrFollow(Boolean(isManualExit));
        },

        setRightToolbarCollapsed,
        toggleRightToolbar
    };

    window.ApproachNav = ApproachNavAPI;

    // 初始化右側工具列收合開關（預設關）與地圖樣式監聽
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setupRightToolbarCollapseControl();
            attachStyleDataListener();
        });
    } else {
        setupRightToolbarCollapseControl();
        attachStyleDataListener();
    }
})();
