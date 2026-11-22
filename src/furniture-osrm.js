// ==========================================
// [Module 9/10] src/furniture-osrm.js
// 家具模式（0.5s 長按插針與拖曳解鎖、OSRM 兩階段順路＋靠右保護＋1.35x 死胡同保底、手動拉線、循跡導航/播放接通、AI 派工與三層定位）
// ==========================================

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

// 家具模式下點擊「🏢 社區大樓（橘色水滴）」：直接標註為收運點（不開啟社區編輯彈窗）
function handleFurnitureBuildingPinClick(buildingPin) {
    if (!isFurnitureModeActive || !buildingPin) return;
    if (window.isFurnitureNavOrReplayActive) return;

    const cleanLng = Number(Number(buildingPin.lng).toFixed(6));
    const cleanLat = Number(Number(buildingPin.lat).toFixed(6));
    if (isNaN(cleanLng) || isNaN(cleanLat)) return;

    const buildingTitle = String(buildingPin.title || '社區大樓').trim();

    if (!Array.isArray(furnitureActiveData.pins)) {
        furnitureActiveData.pins = [];
    }

    // 檢查該社區水滴是否已被標註為收運點（座標 8m 內，或同名且 30m 內）
    const existingIdx = furnitureActiveData.pins.findIndex(p => {
        if (!p) return false;
        const distM = getDistanceKm(Number(p.lng), Number(p.lat), cleanLng, cleanLat) * 1000;
        if (distM <= 8) return true;
        if (buildingTitle && p.label && p.label.trim() === buildingTitle && distM <= 30) return true;
        return false;
    });

    // 若目前正處於「手動拉線串」模式
    if (isFurnitureManualConnecting) {
        if (existingIdx !== -1) {
            handleManualConnectSnapToPin(existingIdx);
            return;
        }
        closeFurniturePinPopup();
        addFurniturePinToWorkspace(cleanLng, cleanLat, buildingTitle, {
            note: buildingPin.note || ''
        });
        showFurnitureToast(`📍 已標註收運點 #${furnitureActiveData.pins.length}：${buildingTitle}`);
        return;
    }

    if (existingIdx !== -1) {
        vibrate(20);
        showFurnitureToast(`ℹ️ 「${buildingTitle}」已標註為收運點（#${existingIdx + 1} 號針）`);
        return;
    }

    closeFurniturePinPopup();
    addFurniturePinToWorkspace(cleanLng, cleanLat, buildingTitle, {
        note: buildingPin.note || ''
    });
    showFurnitureToast(`📍 已標註收運點 #${furnitureActiveData.pins.length}：${buildingTitle}`);

    // 若目前已有串接好的路線，依既有串接模式自動連動更新 OSRM 路線
    if (Array.isArray(furnitureActiveData.routeCoords) && furnitureActiveData.routeCoords.length >= 2 && !isFurnitureOsrmBusy) {
        refreshFurnitureRouteAfterPinDragged();
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

