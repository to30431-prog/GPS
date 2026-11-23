// ==========================================
// [Module 12] src/speed-cameras.js
// 鶯歌及周邊區域固定式測速照相圖標圖層與行車接近語音／畫面提醒引擎
// ==========================================

(function initSpeedCameraModule() {
    const STORAGE_KEY = 'yingge_show_speed_cameras_v1';
    const TRIGGER_DISTANCE_M = 300;
    const RESET_DISTANCE_M = 400;
    const COOLDOWN_MS = 3 * 60 * 1000; // 3 分鐘內同點位不重複播報
    const BEARING_TOLERANCE_DEG = 60;  // 行進方向朝向測速點容許誤差 ±60 度

    // 新北市鶯歌區及鄰近主要聯絡道（樹林、三峽、桃園八德／龜山交界）常見固定式測速照相點位
    const SPEED_CAMERAS = [
        { id: 'yg_yingtao_182',   lat: 24.9612, lng: 121.3396, road: '鶯歌區 鶯桃路 182 號前',         direction: '往桃園／鶯歌方向',     limit: 50 },
        { id: 'yg_yingtao_413',   lat: 24.9668, lng: 121.3338, road: '鶯歌區 鶯桃路 413 號前',         direction: '往桃園八德方向',       limit: 50 },
        { id: 'yg_yingtao_fude',  lat: 24.9695, lng: 121.3302, road: '鶯歌區 鶯桃路近福德一路口',      direction: '往八德／鶯歌雙向',     limit: 50 },
        { id: 'yg_zz1_jianguo',   lat: 24.9568, lng: 121.3574, road: '鶯歌區 中正一路近建國路口',      direction: '往樹林方向',           limit: 50 },
        { id: 'yg_zz1_350',       lat: 24.9615, lng: 121.3652, road: '鶯歌區 中正一路 350 號前',       direction: '往樹林／鶯歌方向',     limit: 50 },
        { id: 'yg_zz2_bade',      lat: 24.9498, lng: 121.3458, road: '鶯歌區 中正二路近八德路口',      direction: '往大溪／三峽方向',     limit: 50 },
        { id: 'yg_zz3_154',       lat: 24.9436, lng: 121.3404, road: '鶯歌區 中正三路 154 號前',       direction: '往大溪方向',           limit: 50 },
        { id: 'yg_zz3_376',       lat: 24.9378, lng: 121.3348, road: '鶯歌區 中正三路 376 號前',       direction: '往桃園大溪方向',       limit: 50 },
        { id: 'yg_guanqian_mus',  lat: 24.9496, lng: 121.3518, road: '鶯歌區 館前路（陶博館前）',      direction: '往三鶯大橋／環河路',   limit: 50 },
        { id: 'yg_guanqian_brg',  lat: 24.9472, lng: 121.3556, road: '鶯歌區 館前路近三鶯大橋引道',    direction: '往三峽方向',           limit: 50 },
        { id: 'yg_huanhe_mid',    lat: 24.9554, lng: 121.3628, road: '鶯歌區 環河路（山水步道段）',    direction: '往樹林柑園方向',       limit: 60 },
        { id: 'yg_huanhe_gan',    lat: 24.9632, lng: 121.3735, road: '鶯歌區 環河路近柑園大橋段',      direction: '往樹林／板橋方向',     limit: 60 },
        { id: 'yg_dahu_185',      lat: 24.9628, lng: 121.3502, road: '鶯歌區 大湖路 185 號前',         direction: '往桃園龜山方向',       limit: 50 },
        { id: 'yg_dahu_338',      lat: 24.9718, lng: 121.3474, road: '鶯歌區 大湖路 338 號前',         direction: '往龜山工業區方向',     limit: 50 },
        { id: 'sx_sanying_south', lat: 24.9412, lng: 121.3638, road: '三峽區 三鶯大橋南端（文化路口）', direction: '往三峽市區方向',       limit: 50 },
        { id: 'sx_fuxing_238',    lat: 24.9388, lng: 121.3705, road: '三峽區 復興路 238 號前',         direction: '往三峽市區方向',       limit: 50 },
        { id: 'sx_jieshou_1',     lat: 24.9345, lng: 121.3792, road: '三峽區 介壽路一段近大同路口',    direction: '往土城／大溪方向',     limit: 50 },
        { id: 'sl_jiayuan_2',     lat: 24.9605, lng: 121.3842, road: '樹林區 佳園路二段（柑園段）',    direction: '往樹林／三峽方向',     limit: 50 },
        { id: 'sl_zhongshan_3',   lat: 24.9722, lng: 121.3924, road: '樹林區 中山路三段（山佳段）',    direction: '往樹林市區方向',       limit: 50 },
        { id: 'ty_taoying_bd',    lat: 24.9742, lng: 121.3248, road: '桃園八德／龜山交界 桃鶯路段',   direction: '往桃園市區方向',       limit: 50 }
    ];

    let isSpeedCameraLayerVisible = true;
    try {
        const savedPref = localStorage.getItem(STORAGE_KEY);
        if (savedPref === 'false') {
            isSpeedCameraLayerVisible = false;
        }
    } catch (e) {}

    const speedCameraMarkers = new Map();
    const cameraAlertState = new Map(); // id -> { triggeredAt: number, awaitingExit: boolean }

    function calcDistanceMeters(lat1, lng1, lat2, lng2) {
        if (typeof getDistanceKm === 'function') {
            return getDistanceKm(lng1, lat1, lng2, lat2) * 1000;
        }
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function calcBearingDeg(lat1, lng1, lat2, lng2) {
        const rad = Math.PI / 180;
        const p1 = lat1 * rad;
        const p2 = lat2 * rad;
        const dl = (lng2 - lng1) * rad;
        const y = Math.sin(dl) * Math.cos(p2);
        const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    function angularDiffDeg(a, b) {
        const diff = Math.abs(((a - b) % 360 + 540) % 360 - 180);
        return diff;
    }

    function createSpeedCameraMarkerEl(cam) {
        const el = document.createElement('div');
        el.className = 'speed-camera-marker flex flex-col items-center cursor-pointer select-none';
        el.title = `${cam.road}（${cam.direction}・速限 ${cam.limit} km/h）`;
        el.innerHTML = `
            <div class="relative flex items-center justify-center w-8 h-8 rounded-full bg-white border-[2.5px] border-rose-600 shadow-md">
                <span class="text-[13px] leading-none">📸</span>
                <span class="absolute -bottom-1.5 -right-1.5 min-w-[18px] h-[16px] px-1 rounded-full bg-rose-600 text-white text-[9px] font-black leading-[16px] text-center border border-white shadow-sm">${cam.limit}</span>
            </div>
        `;
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof showNavAlert === 'function') {
                showNavAlert('📸', `${cam.road}（速限 ${cam.limit} 公里・${cam.direction}）`, 'bg-rose-600');
            }
        });
        return el;
    }

    function clearSpeedCameraMarkers() {
        speedCameraMarkers.forEach(marker => {
            try { marker.remove(); } catch (e) {}
        });
        speedCameraMarkers.clear();
    }

    function renderSpeedCameraMarkers() {
        if (typeof map === 'undefined' || !map) return;
        if (!isSpeedCameraLayerVisible) {
            clearSpeedCameraMarkers();
            return;
        }
        SPEED_CAMERAS.forEach(cam => {
            const existing = speedCameraMarkers.get(cam.id);
            if (existing) {
                const el = typeof existing.getElement === 'function' ? existing.getElement() : null;
                if (el && !el.isConnected) {
                    try { existing.addTo(map); } catch (e) {}
                } else {
                    try { existing.setLngLat([cam.lng, cam.lat]); } catch (e) {}
                }
                return;
            }
            const el = createSpeedCameraMarkerEl(cam);
            const marker = new maplibregl.Marker({
                element: el,
                anchor: 'center',
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            })
                .setLngLat([cam.lng, cam.lat])
                .addTo(map);
            speedCameraMarkers.set(cam.id, marker);
        });
    }

    function setSpeedCameraLayerVisible(visible) {
        isSpeedCameraLayerVisible = Boolean(visible);
        try {
            localStorage.setItem(STORAGE_KEY, isSpeedCameraLayerVisible ? 'true' : 'false');
        } catch (e) {}
        renderSpeedCameraMarkers();
        if (typeof renderMapLayerMenuOptions === 'function') {
            renderMapLayerMenuOptions();
        }
    }

    function toggleSpeedCameraLayer() {
        setSpeedCameraLayerVisible(!isSpeedCameraLayerVisible);
    }

    function checkSpeedCamerasForPosition(lat, lng, headingDeg, speedKmh = 0, isStationary = false) {
        if (typeof isReplaying !== 'undefined' && isReplaying) return;
        if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;

        const now = Date.now();
        const hasValidHeading = typeof headingDeg === 'number' && !isNaN(headingDeg);
        let closestCandidate = null;
        let closestDistM = Infinity;

        for (let i = 0; i < SPEED_CAMERAS.length; i++) {
            const cam = SPEED_CAMERAS[i];
            const distM = calcDistanceMeters(lat, lng, cam.lat, cam.lng);
            let state = cameraAlertState.get(cam.id);
            if (!state) {
                state = { triggeredAt: 0, awaitingExit: false };
                cameraAlertState.set(cam.id, state);
            }

            // 離開該測速點超過 400 公尺後，重置可再次觸發狀態
            if (state.awaitingExit && distM > RESET_DISTANCE_M) {
                state.awaitingExit = false;
            }

            // 仍在同一次通過範圍內或 3 分鐘冷卻期內，不重複播報
            if (state.awaitingExit) continue;
            if (state.triggeredAt > 0 && (now - state.triggeredAt) < COOLDOWN_MS) continue;

            // 距離超過 300 公尺不觸發
            if (distM > TRIGGER_DISTANCE_M) continue;

            // 靜止不動或無有效行進方向時不誤報
            if (isStationary || !hasValidHeading || speedKmh < 3) continue;

            // 確認行進方向朝向該測速點（容許誤差 ±60 度）
            const bearingToCam = calcBearingDeg(lat, lng, cam.lat, cam.lng);
            const angleDiff = angularDiffDeg(headingDeg, bearingToCam);
            if (angleDiff <= BEARING_TOLERANCE_DEG && distM < closestDistM) {
                closestDistM = distM;
                closestCandidate = { cam, state, distM };
            }
        }

        if (closestCandidate) {
            const { cam, state } = closestCandidate;
            state.triggeredAt = now;
            state.awaitingExit = true;

            const alertText = `前方有測速照相（速限 ${cam.limit} 公里）`;
            if (typeof showNavAlert === 'function') {
                showNavAlert('📸', alertText, 'bg-rose-600');
            }
            if (typeof VoiceQueue !== 'undefined' && VoiceQueue && typeof VoiceQueue.enqueue === 'function') {
                VoiceQueue.enqueue(`前方有測速照相，速限 ${cam.limit} 公里`);
            }
        }
    }

    // 地圖載入完成後自動繪製測速照相圖標
    function attachWhenMapReady() {
        if (typeof map === 'undefined' || !map) {
            setTimeout(attachWhenMapReady, 400);
            return;
        }
        if (typeof map.loaded === 'function' && map.loaded()) {
            renderSpeedCameraMarkers();
        } else {
            map.once('load', () => renderSpeedCameraMarkers());
        }
    }
    attachWhenMapReady();

    window.SPEED_CAMERAS = SPEED_CAMERAS;
    window.SpeedCameraManager = {
        cameras: SPEED_CAMERAS,
        isVisible: () => isSpeedCameraLayerVisible,
        setVisible: setSpeedCameraLayerVisible,
        toggle: toggleSpeedCameraLayer,
        ensureMarkersIntact: renderSpeedCameraMarkers,
        checkPosition: checkSpeedCamerasForPosition
    };

    if (typeof renderMapLayerMenuOptions === 'function') {
        renderMapLayerMenuOptions();
    }
})();
