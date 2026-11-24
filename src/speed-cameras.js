// ==========================================
// [Module 12] src/speed-cameras.js
// 鶯歌及周邊區域固定式測速照相圖標圖層、Firebase 全車隊同步、開發者定位校正與行車接近語音／畫面提醒引擎
// ==========================================

(function initSpeedCameraModule() {
    const STORAGE_KEY_VISIBLE = 'yingge_show_speed_cameras_v1';
    const STORAGE_KEY_CALIBRATION = 'yingge_dev_speed_cam_calibration_v1';
    const STORAGE_KEY_CACHE = 'yingge_speed_cameras_cache_v1';
    const TRIGGER_DISTANCE_M = 300;
    const RESET_DISTANCE_M = 400;
    const COOLDOWN_MS = 3 * 60 * 1000; // 3 分鐘內同點位不重複播報
    const BEARING_TOLERANCE_DEG = 60;  // 行進方向朝向測速點容許誤差 ±60 度
    const CLOUD_SYNC_INTERVAL_MS = 60 * 1000;

    // 新北市政府警察局交通警察大隊公開資料佐證之鶯歌區固定式測速照相預設基底清單
    const DEFAULT_SPEED_CAMERAS = [
        { id: 'ntpc_yg_zz3_193',     lat: 24.939499, lng: 121.335570, road: '鶯歌區 中正三路193巷口',         direction: '往大溪（東北向西南）', limit: 40 },
        { id: 'ntpc_yg_huanhe_205',  lat: 24.929586, lng: 121.337790, road: '鶯歌區 環河路205389號燈桿旁',    direction: '雙向／西向東',         limit: 40 },
        { id: 'ntpc_yg_xihu_191',    lat: 24.963926, lng: 121.338390, road: '鶯歌區 西湖街191號前',           direction: '往樹林（北向南）',     limit: 50 },
        { id: 'ntpc_yg_zz2_204463',  lat: 24.949121, lng: 121.344030, road: '鶯歌區 中正二路204463號燈桿旁',  direction: '往鶯歌（西南向東北）', limit: 50 },
        { id: 'ntpc_yg_zhongshan',   lat: 24.957010, lng: 121.347030, road: '鶯歌區 中山路196號',             direction: '雙向／東向西',         limit: 50 },
        { id: 'ntpc_yg_zz1_426',     lat: 24.957020, lng: 121.361280, road: '鶯歌區 中正一路426號前',         direction: '往樹林（西向東）',     limit: 50 },
        { id: 'ntpc_yg_guanqian_24', lat: 24.958023, lng: 121.371360, road: '鶯歌區 館前路2.4公里處',         direction: '往樹林（西南向東北）', limit: 50 }
    ];

    function getSpeedCamerasCloudBaseUrl() {
        const base = (typeof FIREBASE_BASE_URL === 'string' && FIREBASE_BASE_URL)
            ? FIREBASE_BASE_URL
            : 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app';
        return `${base}/system_config/speed_cameras`;
    }

    function normalizeCameraItem(raw, fallbackId = '') {
        if (!raw || typeof raw !== 'object' || raw.deleted === true) return null;
        const lat = Number(raw.lat);
        const lng = Number(raw.lng);
        if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
        const id = String(raw.id || fallbackId || `cam_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`).trim();
        const road = String(raw.road || '測速照相').trim() || '測速照相';
        const direction = String(raw.direction || '').trim();
        const limitNum = Math.round(Number(raw.limit));
        const limit = (isFinite(limitNum) && limitNum >= 20 && limitNum <= 120) ? limitNum : 50;
        return {
            id,
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
            road,
            direction,
            limit,
            updatedAt: Number(raw.updatedAt) || 0
        };
    }

    let activeSpeedCameras = DEFAULT_SPEED_CAMERAS.map(c => ({ ...c }));
    let hasCloudSpeedCameraData = false;
    let isSyncingSpeedCameras = false;
    let lastCloudSyncAt = 0;

    // 啟動時先讀取本機快取（若有）避免離線白空
    try {
        const cachedStr = localStorage.getItem(STORAGE_KEY_CACHE);
        if (cachedStr) {
            const parsed = JSON.parse(cachedStr);
            if (Array.isArray(parsed)) {
                const validCached = parsed.map(c => normalizeCameraItem(c)).filter(Boolean);
                activeSpeedCameras = validCached;
                hasCloudSpeedCameraData = true;
            }
        }
    } catch (e) {}

    let isSpeedCameraLayerVisible = true;
    try {
        if (localStorage.getItem(STORAGE_KEY_VISIBLE) === 'false') {
            isSpeedCameraLayerVisible = false;
        }
    } catch (e) {}

    let calibrationTogglePref = false;
    try {
        if (localStorage.getItem(STORAGE_KEY_CALIBRATION) === 'true') {
            calibrationTogglePref = true;
        }
    } catch (e) {}

    function isDeveloperUser() {
        return (typeof localUserPermissionRole !== 'undefined' && localUserPermissionRole === 'developer');
    }

    function isCalibrationModeActive() {
        return Boolean(isDeveloperUser() && calibrationTogglePref);
    }

    const speedCameraMarkers = new Map();
    const cameraAlertState = new Map(); // id -> { triggeredAt: number, awaitingExit: boolean }
    let editingCameraId = null;

    function persistLocalCache() {
        try {
            localStorage.setItem(STORAGE_KEY_CACHE, JSON.stringify(activeSpeedCameras));
        } catch (e) {}
    }

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
        return Math.abs(((a - b) % 360 + 540) % 360 - 180);
    }

    const MIN_SPEED_CAM_SCALE = 0.55;
    const MAX_SPEED_CAM_SCALE = 1.35;
    const BASE_SPEED_CAM_ZOOM = 15.5;
    let boundZoomMapRef = null;

    function getCurrentSpeedCamZoomScale() {
        const z = (typeof map !== 'undefined' && map && typeof map.getZoom === 'function')
            ? Number(map.getZoom())
            : BASE_SPEED_CAM_ZOOM;
        const safeZoom = isFinite(z) ? z : BASE_SPEED_CAM_ZOOM;
        return Math.max(MIN_SPEED_CAM_SCALE, Math.min(MAX_SPEED_CAM_SCALE, Math.pow(1.22, safeZoom - BASE_SPEED_CAM_ZOOM)));
    }

    function applyZoomScaleToCameraRing(ringEl, scaleVal) {
        if (!ringEl) return;
        const s = (typeof scaleVal === 'number' && isFinite(scaleVal)) ? scaleVal : getCurrentSpeedCamZoomScale();
        ringEl.style.transformOrigin = 'center center';
        ringEl.style.transform = `scale(${s.toFixed(3)})`;
    }

    function syncSpeedCameraMarkersZoomScale() {
        const s = getCurrentSpeedCamZoomScale();
        if (typeof map !== 'undefined' && map && typeof map.getContainer === 'function') {
            const mapEl = map.getContainer();
            if (mapEl && mapEl.style) {
                mapEl.style.setProperty('--speed-cam-scale', s.toFixed(3));
            }
        }
        speedCameraMarkers.forEach((marker) => {
            const el = (marker && typeof marker.getElement === 'function') ? marker.getElement() : null;
            const ring = el ? el.querySelector('.speed-cam-ring') : null;
            if (ring) {
                applyZoomScaleToCameraRing(ring, s);
            }
        });
    }

    function ensureSpeedCamZoomListenerBound() {
        if (typeof map === 'undefined' || !map || typeof map.on !== 'function') return;
        if (boundZoomMapRef === map) return;
        boundZoomMapRef = map;
        map.on('zoom', syncSpeedCameraMarkersZoomScale);
    }

    function updateMarkerVisualState(el, cam) {
        if (!el || !cam) return;
        const calOn = isCalibrationModeActive();
        el.title = calOn
            ? `🛠️ 點擊校正：${cam.road}（速限 ${cam.limit} km/h）`
            : `${cam.road}${cam.direction ? `（${cam.direction}）` : ''}・速限 ${cam.limit} km/h`;
        const ring = el.querySelector('.speed-cam-ring');
        if (ring) {
            ring.className = calOn
                ? 'speed-cam-ring relative flex items-center justify-center w-9 h-9 rounded-full bg-amber-50 border-[3px] border-amber-500 shadow-lg ring-2 ring-rose-500/50 transition-transform duration-100 ease-out'
                : 'speed-cam-ring relative flex items-center justify-center w-8 h-8 rounded-full bg-white border-[2.5px] border-rose-600 shadow-md transition-transform duration-100 ease-out';
            applyZoomScaleToCameraRing(ring);
        }
        const limitPill = el.querySelector('.speed-cam-limit-pill');
        if (limitPill) {
            limitPill.textContent = String(cam.limit);
        }
    }

    function createSpeedCameraMarkerEl(cam) {
        const el = document.createElement('div');
        el.className = 'speed-camera-marker flex flex-col items-center cursor-pointer select-none';
        el.dataset.camId = cam.id;
        el.innerHTML = `
            <div class="speed-cam-ring relative flex items-center justify-center w-8 h-8 rounded-full bg-white border-[2.5px] border-rose-600 shadow-md">
                <span class="text-[13px] leading-none">📸</span>
                <span class="speed-cam-limit-pill absolute -bottom-1.5 -right-1.5 min-w-[18px] h-[16px] px-1 rounded-full bg-rose-600 text-white text-[9px] font-black leading-[16px] text-center border border-white shadow-sm">${cam.limit}</span>
            </div>
        `;
        updateMarkerVisualState(el, cam);
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentCam = activeSpeedCameras.find(item => item.id === cam.id) || cam;
            if (isCalibrationModeActive()) {
                openSpeedCameraEditorModal(currentCam, null);
                return;
            }
            if (typeof showNavAlert === 'function') {
                const dirText = currentCam.direction ? `・${currentCam.direction}` : '';
                showNavAlert('📸', `${currentCam.road}（速限 ${currentCam.limit} 公里${dirText}）`, 'bg-rose-600');
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
        ensureSpeedCamZoomListenerBound();
        if (!isSpeedCameraLayerVisible) {
            clearSpeedCameraMarkers();
            return;
        }
        const currentScale = getCurrentSpeedCamZoomScale();
        const activeIdSet = new Set();
        activeSpeedCameras.forEach(cam => {
            activeIdSet.add(cam.id);
            const existing = speedCameraMarkers.get(cam.id);
            if (existing) {
                const el = typeof existing.getElement === 'function' ? existing.getElement() : null;
                if (el) {
                    updateMarkerVisualState(el, cam);
                    if (!el.isConnected) {
                        try { existing.addTo(map); } catch (e) {}
                    }
                }
                try { existing.setLngLat([cam.lng, cam.lat]); } catch (e) {}
                return;
            }
            const el = createSpeedCameraMarkerEl(cam);
            const ring = el.querySelector('.speed-cam-ring');
            if (ring) applyZoomScaleToCameraRing(ring, currentScale);
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

        // 移除已被刪除的相機圖標
        for (const [id, marker] of speedCameraMarkers.entries()) {
            if (!activeIdSet.has(id)) {
                try { marker.remove(); } catch (e) {}
                speedCameraMarkers.delete(id);
                cameraAlertState.delete(id);
            }
        }
        syncSpeedCameraMarkersZoomScale();
    }

    // ☁️ 從 Firebase system_config/speed_cameras 同步全車隊測速照相點位
    async function syncSpeedCamerasFromCloud(force = false) {
        if (!navigator.onLine || isSyncingSpeedCameras) return;
        const now = Date.now();
        if (!force && (now - lastCloudSyncAt < CLOUD_SYNC_INTERVAL_MS)) return;
        isSyncingSpeedCameras = true;
        try {
            const url = `${getSpeedCamerasCloudBaseUrl()}.json`;
            const res = (typeof fetchWithTimeout === 'function')
                ? await fetchWithTimeout(url, { cache: 'no-store' }, 5000)
                : await fetch(url, { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            lastCloudSyncAt = Date.now();

            if (data && typeof data === 'object') {
                const parsedList = [];
                Object.entries(data).forEach(([key, val]) => {
                    if (key === '_meta') return;
                    const normalized = normalizeCameraItem(val, key);
                    if (normalized) parsedList.push(normalized);
                });
                activeSpeedCameras = parsedList;
                hasCloudSpeedCameraData = true;
                persistLocalCache();
            } else {
                // Firebase 尚無自訂測速資料時，以預設官方清單為基底
                activeSpeedCameras = DEFAULT_SPEED_CAMERAS.map(c => ({ ...c }));
                hasCloudSpeedCameraData = false;
            }
            renderSpeedCameraMarkers();
        } catch (e) {
            // 網路異常靜默略過，保留現有點位
        } finally {
            isSyncingSpeedCameras = false;
        }
    }

    // ☁️ 將目前完整測速相機清單寫入 Firebase（確保新增、修改、刪除同步至全車隊）
    async function persistAllSpeedCamerasToCloud() {
        if (!navigator.onLine) {
            throw new Error('目前無網路連線');
        }
        const payload = {
            _meta: {
                initialized: true,
                updatedAt: Date.now()
            }
        };
        activeSpeedCameras.forEach(cam => {
            payload[cam.id] = {
                id: cam.id,
                lat: Number(cam.lat.toFixed(6)),
                lng: Number(cam.lng.toFixed(6)),
                road: cam.road,
                direction: cam.direction || '',
                limit: cam.limit,
                updatedAt: cam.updatedAt || Date.now()
            };
        });
        const url = `${getSpeedCamerasCloudBaseUrl()}.json`;
        const opts = {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        };
        const res = (typeof fetchWithTimeout === 'function')
            ? await fetchWithTimeout(url, opts, 6000)
            : await fetch(url, opts);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        hasCloudSpeedCameraData = true;
        lastCloudSyncAt = Date.now();
        persistLocalCache();
    }

    function setSpeedCameraLayerVisible(visible) {
        isSpeedCameraLayerVisible = Boolean(visible);
        try {
            localStorage.setItem(STORAGE_KEY_VISIBLE, isSpeedCameraLayerVisible ? 'true' : 'false');
        } catch (e) {}
        renderSpeedCameraMarkers();
        if (typeof renderMapLayerMenuOptions === 'function') {
            renderMapLayerMenuOptions();
        }
    }

    function toggleSpeedCameraLayer() {
        setSpeedCameraLayerVisible(!isSpeedCameraLayerVisible);
    }

    function setCalibrationMode(enabled) {
        calibrationTogglePref = Boolean(enabled);
        try {
            localStorage.setItem(STORAGE_KEY_CALIBRATION, calibrationTogglePref ? 'true' : 'false');
        } catch (e) {}
        syncCalibrationToggleUI();
        renderSpeedCameraMarkers();
    }

    function syncCalibrationToggleUI() {
        const inputEl = document.getElementById('adminSpeedCameraCalibrationInput');
        if (inputEl) {
            inputEl.checked = isCalibrationModeActive();
        }
        const badgeEl = document.getElementById('adminSpeedCamCalStatusBadge');
        if (badgeEl) {
            const active = isCalibrationModeActive();
            badgeEl.className = active
                ? 'text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-600 text-white'
                : 'text-[10px] font-black px-2 py-0.5 rounded-full bg-gray-200 text-gray-600';
            badgeEl.textContent = active ? '🛠️ 校正中' : '已關閉';
        }
    }

    // 🛠️ 測速相機新增／編輯／移動／刪除彈窗控制
    function closeSpeedCameraEditorModal() {
        const modal = document.getElementById('speedCameraEditorModal');
        if (modal) modal.classList.add('hidden');
        editingCameraId = null;
    }

    function openSpeedCameraEditorModal(existingCam = null, initialCoords = null) {
        if (!isCalibrationModeActive()) {
            alert('🔒 請先在「開發者模式控制中心」開啟「測速相機定位校正」開關！');
            return;
        }
        const modal = document.getElementById('speedCameraEditorModal');
        const titleEl = document.getElementById('speedCamModalTitle');
        const roadInput = document.getElementById('speedCamRoadInput');
        const dirInput = document.getElementById('speedCamDirectionInput');
        const limitInput = document.getElementById('speedCamLimitInput');
        const latInput = document.getElementById('speedCamLatInput');
        const lngInput = document.getElementById('speedCamLngInput');
        const moveBtn = document.getElementById('btnMoveSpeedCamToLongPress');
        const deleteBtn = document.getElementById('btnDeleteSpeedCam');
        if (!modal) return;

        if (existingCam) {
            editingCameraId = existingCam.id;
            if (titleEl) titleEl.textContent = '📸 校正／編輯測速相機';
            if (roadInput) roadInput.value = existingCam.road || '';
            if (dirInput) dirInput.value = existingCam.direction || '';
            if (limitInput) limitInput.value = String(existingCam.limit || 50);
            if (latInput) latInput.value = Number(existingCam.lat).toFixed(6);
            if (lngInput) lngInput.value = Number(existingCam.lng).toFixed(6);
            if (deleteBtn) deleteBtn.classList.remove('hidden');

            const lp = window._lastLongPressCoords;
            if (moveBtn) {
                if (lp && isFinite(lp.lat) && isFinite(lp.lng)) {
                    moveBtn.classList.remove('hidden');
                    moveBtn.textContent = `📍 移至目前長按位置 (${lp.lat.toFixed(6)}, ${lp.lng.toFixed(6)})`;
                } else {
                    moveBtn.classList.add('hidden');
                }
            }
        } else {
            editingCameraId = null;
            if (titleEl) titleEl.textContent = '📸 新增固定式測速相機';
            if (roadInput) roadInput.value = '';
            if (dirInput) dirInput.value = '';
            if (limitInput) limitInput.value = '50';
            const latVal = initialCoords?.lat ?? window._lastLongPressCoords?.lat ?? (Array.isArray(lastKnownLngLat) ? lastKnownLngLat[1] : 24.954);
            const lngVal = initialCoords?.lng ?? window._lastLongPressCoords?.lng ?? (Array.isArray(lastKnownLngLat) ? lastKnownLngLat[0] : 121.354);
            if (latInput) latInput.value = Number(latVal).toFixed(6);
            if (lngInput) lngInput.value = Number(lngVal).toFixed(6);
            if (moveBtn) moveBtn.classList.add('hidden');
            if (deleteBtn) deleteBtn.classList.add('hidden');
        }

        modal.classList.remove('hidden');
        setTimeout(() => roadInput?.focus(), 80);
    }

    function bindSpeedCameraUIEvents() {
        const calInput = document.getElementById('adminSpeedCameraCalibrationInput');
        if (calInput) {
            calInput.addEventListener('change', () => {
                setCalibrationMode(calInput.checked);
                if (typeof showNavAlert === 'function') {
                    showNavAlert(
                        '📸',
                        calInput.checked
                            ? '已開啟「測速相機定位校正」：長按地圖可複製經緯度／新增相機，點擊相機可調整或刪除'
                            : '已關閉「測速相機定位校正」',
                        calInput.checked ? 'bg-rose-600' : 'bg-slate-700'
                    );
                }
            });
        }

        const btnCloseTop = document.getElementById('btnCloseSpeedCamModalTop');
        const btnCancel = document.getElementById('btnCancelSpeedCam');
        const modal = document.getElementById('speedCameraEditorModal');
        const btnSave = document.getElementById('btnSaveSpeedCam');
        const btnDelete = document.getElementById('btnDeleteSpeedCam');
        const btnMove = document.getElementById('btnMoveSpeedCamToLongPress');

        btnCloseTop?.addEventListener('click', closeSpeedCameraEditorModal);
        btnCancel?.addEventListener('click', closeSpeedCameraEditorModal);
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) closeSpeedCameraEditorModal();
        });

        document.querySelectorAll('.speed-cam-limit-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const limitInput = document.getElementById('speedCamLimitInput');
                if (limitInput) limitInput.value = btn.dataset.limit || '50';
            });
        });

        btnMove?.addEventListener('click', (e) => {
            e.stopPropagation();
            const lp = window._lastLongPressCoords;
            if (!lp || !isFinite(lp.lat) || !isFinite(lp.lng)) return;
            const latInput = document.getElementById('speedCamLatInput');
            const lngInput = document.getElementById('speedCamLngInput');
            if (latInput) latInput.value = lp.lat.toFixed(6);
            if (lngInput) lngInput.value = lp.lng.toFixed(6);
        });

        btnSave?.addEventListener('click', async () => {
            if (!isCalibrationModeActive()) return;
            const road = String(document.getElementById('speedCamRoadInput')?.value || '').trim();
            const direction = String(document.getElementById('speedCamDirectionInput')?.value || '').trim();
            const limit = Math.round(Number(document.getElementById('speedCamLimitInput')?.value));
            const lat = Number(document.getElementById('speedCamLatInput')?.value);
            const lng = Number(document.getElementById('speedCamLngInput')?.value);

            if (!road) {
                alert('請輸入路名或位置備註！');
                document.getElementById('speedCamRoadInput')?.focus();
                return;
            }
            if (!isFinite(limit) || limit < 20 || limit > 120) {
                alert('請輸入有效速限（20～120 km/h）！');
                return;
            }
            if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                alert('請輸入有效的經緯度座標！');
                return;
            }

            const prevSnapshot = activeSpeedCameras.map(c => ({ ...c }));
            const origText = btnSave.innerHTML;
            btnSave.disabled = true;
            btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>同步中...';

            const now = Date.now();
            if (editingCameraId) {
                const idx = activeSpeedCameras.findIndex(c => c.id === editingCameraId);
                if (idx !== -1) {
                    activeSpeedCameras[idx] = {
                        ...activeSpeedCameras[idx],
                        lat: Number(lat.toFixed(6)),
                        lng: Number(lng.toFixed(6)),
                        road,
                        direction,
                        limit,
                        updatedAt: now
                    };
                }
            } else {
                activeSpeedCameras.push({
                    id: `cam_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                    lat: Number(lat.toFixed(6)),
                    lng: Number(lng.toFixed(6)),
                    road,
                    direction,
                    limit,
                    updatedAt: now
                });
            }

            try {
                await persistAllSpeedCamerasToCloud();
                renderSpeedCameraMarkers();
                closeSpeedCameraEditorModal();
                if (typeof showNavAlert === 'function') {
                    showNavAlert('📸', `已同步測速相機：${road}（速限 ${limit} km/h）`, 'bg-emerald-600');
                }
            } catch (err) {
                activeSpeedCameras = prevSnapshot;
                renderSpeedCameraMarkers();
                alert(`❌ 同步測速相機至 Firebase 失敗：${err?.message || '請檢查網路連線'}`);
            } finally {
                btnSave.disabled = false;
                btnSave.innerHTML = origText;
            }
        });

        btnDelete?.addEventListener('click', async () => {
            if (!isCalibrationModeActive() || !editingCameraId) return;
            const target = activeSpeedCameras.find(c => c.id === editingCameraId);
            if (!target) return;
            if (!confirm(`確定要刪除測速相機「${target.road}（速限 ${target.limit} km/h）」並同步全車隊嗎？`)) {
                return;
            }

            const prevSnapshot = activeSpeedCameras.map(c => ({ ...c }));
            const origText = btnDelete.innerHTML;
            btnDelete.disabled = true;
            btnDelete.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>刪除中...';

            activeSpeedCameras = activeSpeedCameras.filter(c => c.id !== editingCameraId);
            try {
                await persistAllSpeedCamerasToCloud();
                renderSpeedCameraMarkers();
                closeSpeedCameraEditorModal();
                if (typeof showNavAlert === 'function') {
                    showNavAlert('🗑️', `已刪除測速相機「${target.road}」並同步全車隊`, 'bg-rose-600');
                }
            } catch (err) {
                activeSpeedCameras = prevSnapshot;
                renderSpeedCameraMarkers();
                alert(`❌ 刪除失敗：${err?.message || '請檢查網路連線'}`);
            } finally {
                btnDelete.disabled = false;
                btnDelete.innerHTML = origText;
            }
        });

        syncCalibrationToggleUI();
    }

    function checkSpeedCamerasForPosition(lat, lng, headingDeg, speedKmh = 0, isStationary = false) {
        if (typeof isReplaying !== 'undefined' && isReplaying) return;
        if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;

        const now = Date.now();
        const hasValidHeading = typeof headingDeg === 'number' && !isNaN(headingDeg);
        let closestCandidate = null;
        let closestDistM = Infinity;

        for (let i = 0; i < activeSpeedCameras.length; i++) {
            const cam = activeSpeedCameras[i];
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
        syncSpeedCamerasFromCloud(true);
    }

    bindSpeedCameraUIEvents();
    attachWhenMapReady();

    window.DEFAULT_SPEED_CAMERAS = DEFAULT_SPEED_CAMERAS;
    window.SpeedCameraManager = {
        getCameras: () => activeSpeedCameras,
        isVisible: () => isSpeedCameraLayerVisible,
        setVisible: setSpeedCameraLayerVisible,
        toggle: toggleSpeedCameraLayer,
        isCalibrationMode: isCalibrationModeActive,
        setCalibrationMode: setCalibrationMode,
        syncCalibrationUI: () => {
            syncCalibrationToggleUI();
            renderSpeedCameraMarkers();
        },
        openEditorModal: openSpeedCameraEditorModal,
        closeEditorModal: closeSpeedCameraEditorModal,
        syncFromCloud: syncSpeedCamerasFromCloud,
        ensureMarkersIntact: renderSpeedCameraMarkers,
        checkPosition: checkSpeedCamerasForPosition
    };

    if (typeof renderMapLayerMenuOptions === 'function') {
        renderMapLayerMenuOptions();
    }
})();
