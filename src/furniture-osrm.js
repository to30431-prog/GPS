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
let furnitureManualSelectedPinIndices = [];
let furnitureManualRollingHeading = null;
let isFurnitureManualRouting = false;

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
    const smartSortBtn = document.getElementById('btnFurnitureSmartSortConnect');
    const manualConnectBtn = document.getElementById('btnFurnitureManualConnect');
    const manualConnectText = document.getElementById('furnitureManualConnectBtnText');
    const routeNavBar = document.getElementById('furnitureRouteNavBar');

    if (undoBtn) undoBtn.disabled = (pinsCount === 0);
    if (clearBtn) clearBtn.disabled = (pinsCount === 0 && furnitureActiveData.routeCoords.length === 0);
    if (autoOsrmBtn) autoOsrmBtn.disabled = (pinsCount < 1);
    if (smartSortBtn) smartSortBtn.disabled = (pinsCount < 1);
    if (manualConnectBtn) {
        manualConnectBtn.disabled = (pinsCount < 2);
        if (isFurnitureManualConnecting) {
            manualConnectBtn.className = 'bg-amber-500/95 hover:bg-amber-600 backdrop-blur text-white font-black py-2.5 px-3.5 rounded-2xl text-xs shadow-lg border border-amber-200 active:scale-95 transition-all flex items-center gap-1.5 ring-2 ring-amber-300 whitespace-nowrap';
            if (manualConnectText) manualConnectText.textContent = `✅ 完成手拉 (${furnitureManualSelectedPinIndices.length}/${pinsCount})`;
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
// - 完全獨立於一般路線編輯器（src/route-editor.js），不共用或覆蓋任何一般畫線狀態與 OSRM 函式
// ==========================================
function normalizeFurnitureHeadingDeg(rawHeading) {
    if (typeof rawHeading !== 'number' || isNaN(rawHeading) || !isFinite(rawHeading)) {
        return null;
    }
    return ((Math.round(rawHeading) % 360) + 360) % 360;
}

// 家具模式 OSRM 雙軌距離比對門檻：順向抑制迴轉 (路徑A) 若比允許迴轉保底 (路徑B) 多繞超過 400 公尺，即改採路徑B
const FURNITURE_OSRM_DETOUR_THRESHOLD_M = 400;
const FURNITURE_OSRM_SNAP_RADIUS_M = 50;

function parseFurnitureOsrmRoutePayload(data, startLng, startLat, fallbackHeading) {
    const routeObj = data?.routes?.[0];
    const coords = routeObj?.geometry?.coordinates;
    if (data?.code !== 'Ok' || !Array.isArray(coords) || coords.length < 2) {
        return null;
    }
    const alignedCoords = (typeof startLng === 'number' && typeof startLat === 'number')
        ? [[startLng, startLat], ...coords.slice(1)]
        : coords;
    const distM = (typeof routeObj.distance === 'number' && isFinite(routeObj.distance) && routeObj.distance > 0)
        ? Number(routeObj.distance)
        : (computeCoordsDistanceKm(alignedCoords) * 1000);
    let endHeading = fallbackHeading;
    if (alignedCoords.length >= 2) {
        const pPrev = alignedCoords[alignedCoords.length - 2];
        const pLast = alignedCoords[alignedCoords.length - 1];
        if (pPrev[0] !== pLast[0] || pPrev[1] !== pLast[1]) {
            endHeading = getBearing(pPrev[0], pPrev[1], pLast[0], pLast[1]);
        }
    }
    return { coords: alignedCoords, distM, endHeading };
}

// 家具模式專屬：兩點間 OSRM driving 雙軌比對（路徑A：continue_straight=true 順向抑制迴轉 vs 路徑B：不強制直行允許迴轉保底，門檻 400 公尺，並附 radiuses 吸附容許半徑）
async function fetchFurnitureOsrmSegmentGeometry(lng1, lat1, lng2, lat2, options = {}) {
    const validHeading = normalizeFurnitureHeadingDeg(options?.startHeading);
    const bearingsQuery = validHeading !== null ? `&bearings=${validHeading},45;` : '';
    const snapRadius = (typeof options?.snapRadiusM === 'number' && options.snapRadiusM > 0)
        ? Math.round(options.snapRadiusM)
        : FURNITURE_OSRM_SNAP_RADIUS_M;
    const radiusesQuery = `&radiuses=${snapRadius};${snapRadius}`;

    // 1. 請求路徑 B（允許迴轉保底版：不帶 continue_straight=true 與強制航向，優先帶 radiuses 避免門牌微偏跨街繞路，失敗時退回無 radiuses）
    const pathBUrls = [
        `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson${radiusesQuery}`,
        `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`
    ];
    const fetchPathBPromise = (async () => {
        for (const pathBUrl of pathBUrls) {
            try {
                const res = await fetchWithTimeout(pathBUrl, {}, 4000);
                if (!res.ok) continue;
                const data = await res.json();
                const parsed = parseFurnitureOsrmRoutePayload(data, lng1, lat1, validHeading);
                if (parsed) return parsed;
            } catch (e) {}
        }
        return null;
    })();

    // 2. 請求路徑 A（順向抑制迴轉版：補上 continue_straight=true、radiuses 與起點車頭方位角 bearings，取得順向距離 D_順向）
    const pathAUrls = [
        `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson&continue_straight=true&approaches=${options?.originUnrestricted ? 'unrestricted;curb' : 'curb;curb'}${bearingsQuery}${radiusesQuery}`,
        `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson&continue_straight=true${bearingsQuery}${radiusesQuery}`,
        `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson&continue_straight=true${radiusesQuery}`,
        `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson&continue_straight=true`
    ];

    let routeA = null;
    for (const osrmUrl of pathAUrls) {
        try {
            const res = await fetchWithTimeout(osrmUrl, {}, 4000);
            if (!res.ok) continue;
            const data = await res.json();
            const parsed = parseFurnitureOsrmRoutePayload(data, lng1, lat1, validHeading);
            if (parsed) {
                routeA = parsed;
                break;
            }
        } catch (err) {
            // 單次嘗試失敗或超時，繼續嘗試下一組順向參數
        }
    }

    const routeB = await fetchPathBPromise;

    // 決策規則：
    // - 若路徑 A 與路徑 B 皆成功：當 (D_順向 - D_最短) > 400 公尺時採用路徑 B（允許迴轉保底），<= 400 公尺時採用路徑 A（順向不迴轉）
    // - 若路徑 A 算不出路線（如死巷盡頭 NoRoute），自動退回採用路徑 B
    if (routeA && routeB) {
        const detourDiffM = routeA.distM - routeB.distM;
        const chosen = (detourDiffM > FURNITURE_OSRM_DETOUR_THRESHOLD_M) ? routeB : routeA;
        return { coords: chosen.coords, usedOsrm: true, endHeading: chosen.endHeading };
    }
    if (routeA) {
        return { coords: routeA.coords, usedOsrm: true, endHeading: routeA.endHeading };
    }
    if (routeB) {
        return { coords: routeB.coords, usedOsrm: true, endHeading: routeB.endHeading };
    }

    return {
        coords: [[lng1, lat1], [lng2, lat2]],
        usedOsrm: false,
        endHeading: getBearing(lng1, lat1, lng2, lat2)
    };
}

function getCurrentValidVehicleHeading() {
    if (typeof lastRealGpsHeading === 'number' && !isNaN(lastRealGpsHeading) && lastRealGpsHeading >= 0 && lastRealGpsHeading <= 360 && lastValidGpsTime > 0) {
        return normalizeFurnitureHeadingDeg(lastRealGpsHeading);
    }
    if (typeof currentHeading === 'number' && !isNaN(currentHeading) && currentHeading >= 0 && currentHeading <= 360) {
        return normalizeFurnitureHeadingDeg(currentHeading);
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
                    ? normalizeFurnitureHeadingDeg(pos.coords.heading)
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

// 家具模式多點分段 OSRM 雙軌距離比對規劃（維持原本分段拆解架構，每段獨立進行「路徑A 順向不迴轉 vs 路徑B 允許迴轉保底」之 400 公尺繞路門檻決策）：
async function fetchOsrmMultiWaypointRoute(waypoints, originHeading = null) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
        return (waypoints || []).map(w => [w.lng, w.lat]);
    }

    const validHeading = normalizeFurnitureHeadingDeg(originHeading);

    // 依序逐段拆解計算：每段皆攜帶前一段抵達時的真實車頭航向 rollingHeading，並執行「路徑A (continue_straight=true + bearings) vs 路徑B (無強制直行)」雙軌 400 公尺門檻比對
    const combinedCoords = [[waypoints[0].lng, waypoints[0].lat]];
    let rollingHeading = validHeading;
    for (let i = 0; i < waypoints.length - 1; i++) {
        const pA = waypoints[i];
        const pB = waypoints[i + 1];
        const { coords, endHeading } = await fetchFurnitureOsrmSegmentGeometry(pA.lng, pA.lat, pB.lng, pB.lat, {
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

// 計算兩方位角之夾角差（0° ~ 180°，越接近 180° 代表原地折返／掉頭）
function getFurnitureTurnAngleDiffDeg(headingFrom, headingTo) {
    if (typeof headingFrom !== 'number' || typeof headingTo !== 'number' || isNaN(headingFrom) || isNaN(headingTo)) {
        return 0;
    }
    return Math.abs(((headingFrom - headingTo + 540) % 360) - 180);
}

// 評估單段點位銜接成本（距離 km ＋ 順向折返懲罰權重：當轉折夾角接近 180° 急轉／掉頭時附加折返懲罰）
function computeFurnitureStepTransitionCostKm(fromLng, fromLat, toLng, toLat, prevHeading = null) {
    const distKm = getDistanceKm(fromLng, fromLat, toLng, toLat);
    if (distKm < 0.003 || prevHeading === null || typeof prevHeading !== 'number' || isNaN(prevHeading)) {
        return distKm;
    }
    const stepBearing = getBearing(fromLng, fromLat, toLng, toLat);
    const turnDiffDeg = getFurnitureTurnAngleDiffDeg(prevHeading, stepBearing);

    // 夾角 > 110° 開始累加折返懲罰；接近 180° 掉頭時施加顯著懲罰（固定掉頭成本 + 距離比例懲罰），優先引導順向推進
    let turnPenaltyKm = 0;
    if (turnDiffDeg >= 145) {
        const ratio = (turnDiffDeg - 145) / 35; // 145°~180° -> 0~1
        turnPenaltyKm = 0.18 + 0.27 * ratio + distKm * (0.25 + 0.35 * ratio);
    } else if (turnDiffDeg >= 110) {
        const ratio = (turnDiffDeg - 110) / 35; // 110°~145° -> 0~1
        turnPenaltyKm = 0.05 * ratio + distKm * (0.12 * ratio);
    }
    return distKm + turnPenaltyKm;
}

// 評估整條候選點位序列之總成本（含起點銜接、各段距離與每段順向折返懲罰）
function evaluateFurnitureSequenceTotalCost(seqPins, anchorLng, anchorLat, initialHeading = null) {
    if (!Array.isArray(seqPins) || seqPins.length === 0) return 0;
    let totalCost = 0;
    let curLng = anchorLng;
    let curLat = anchorLat;
    let curHeading = normalizeFurnitureHeadingDeg(initialHeading);

    for (let i = 0; i < seqPins.length; i++) {
        const p = seqPins[i];
        const segDistKm = getDistanceKm(curLng, curLat, p.lng, p.lat);
        if (segDistKm >= 0.002) {
            totalCost += computeFurnitureStepTransitionCostKm(curLng, curLat, p.lng, p.lat, curHeading);
            curHeading = getBearing(curLng, curLat, p.lng, p.lat);
        }
        curLng = p.lng;
        curLat = p.lat;
    }
    return totalCost;
}

// 對候選序列執行輕量 2-opt 路徑反轉交換優化（消除路徑交叉與跨區來回折返）
function optimizeFurnitureSequenceWith2Opt(initialSeq, anchorLng, anchorLat, initialHeading = null, lockFirstPin = false) {
    if (!Array.isArray(initialSeq) || initialSeq.length <= 2) {
        return Array.isArray(initialSeq) ? [...initialSeq] : [];
    }

    let bestSeq = [...initialSeq];
    let bestCost = evaluateFurnitureSequenceTotalCost(bestSeq, anchorLng, anchorLat, initialHeading);
    const startSwapIdx = lockFirstPin ? 1 : 0;
    const n = bestSeq.length;
    const maxPasses = Math.min(24, n * 3);

    for (let pass = 0; pass < maxPasses; pass++) {
        let improved = false;
        for (let i = startSwapIdx; i < n - 1; i++) {
            for (let k = i + 1; k < n; k++) {
                // 反轉區間 [i..k]
                const candidate = [
                    ...bestSeq.slice(0, i),
                    ...bestSeq.slice(i, k + 1).reverse(),
                    ...bestSeq.slice(k + 1)
                ];
                const candidateCost = evaluateFurnitureSequenceTotalCost(candidate, anchorLng, anchorLat, initialHeading);
                if (candidateCost + 1e-6 < bestCost) {
                    bestSeq = candidate;
                    bestCost = candidateCost;
                    improved = true;
                }
            }
        }
        if (!improved) break;
    }
    return bestSeq;
}

// ⚡ 獨立前置排序函式：固定起點（第一點／當前出發點），結合「環線角度掃描（Sweep 順/逆時針）＋順向折返懲罰最近鄰＋2-opt 消除交叉折返」
function sortFurniturePinsByNearestNeighbor(pins, origin = null) {
    if (!Array.isArray(pins) || pins.length <= 1) {
        return Array.isArray(pins) ? [...pins] : [];
    }

    // 若有即時出發點 (origin) 且距離第一點 >= 12m，以當前出發點為固定起點；否則固定第一支插針 (pins[0]) 為起點排列後續點位
    const useOriginAsAnchor = Boolean(
        origin &&
        typeof origin.lng === 'number' &&
        typeof origin.lat === 'number' &&
        (origin.source === 'gps' || origin.source === 'vehicle_marker') &&
        (getDistanceKm(origin.lng, origin.lat, pins[0].lng, pins[0].lat) * 1000 >= 12)
    );

    const anchorLng = useOriginAsAnchor ? origin.lng : pins[0].lng;
    const anchorLat = useOriginAsAnchor ? origin.lat : pins[0].lat;
    const initialHeading = useOriginAsAnchor ? normalizeFurnitureHeadingDeg(origin?.heading) : null;
    const fixedFirstPin = useOriginAsAnchor ? null : pins[0];
    const sortablePool = useOriginAsAnchor ? [...pins] : pins.slice(1);

    if (sortablePool.length <= 1) {
        return fixedFirstPin ? [fixedFirstPin, ...sortablePool] : [...sortablePool];
    }

    const candidateSequences = [];

    // 候選策略 1：含順向折返懲罰權重的啟發式最近鄰（Greedy Nearest Neighbor with Turn Penalty）
    {
        const rem = [...sortablePool];
        const seq = fixedFirstPin ? [fixedFirstPin] : [];
        let curLng = anchorLng;
        let curLat = anchorLat;
        let curHeading = initialHeading;

        while (rem.length > 0) {
            let bestIdx = 0;
            let bestStepCost = Infinity;
            for (let i = 0; i < rem.length; i++) {
                const stepCost = computeFurnitureStepTransitionCostKm(curLng, curLat, rem[i].lng, rem[i].lat, curHeading);
                if (stepCost < bestStepCost) {
                    bestStepCost = stepCost;
                    bestIdx = i;
                }
            }
            const nextPin = rem.splice(bestIdx, 1)[0];
            if (getDistanceKm(curLng, curLat, nextPin.lng, nextPin.lat) >= 0.002) {
                curHeading = getBearing(curLng, curLat, nextPin.lng, nextPin.lat);
            }
            seq.push(nextPin);
            curLng = nextPin.lng;
            curLat = nextPin.lat;
        }
        candidateSequences.push(seq);
    }

    // 候選策略 2 & 3：環線角度掃描（Centroid Polar Sweep 順時針 CW 與逆時針 CCW）
    if (sortablePool.length >= 3) {
        let sumLng = anchorLng;
        let sumLat = anchorLat;
        for (let i = 0; i < sortablePool.length; i++) {
            sumLng += sortablePool[i].lng;
            sumLat += sortablePool[i].lat;
        }
        const centroidLng = sumLng / (sortablePool.length + 1);
        const centroidLat = sumLat / (sortablePool.length + 1);
        const baseAngle = getBearing(centroidLng, centroidLat, anchorLng, anchorLat);

        const annotated = sortablePool.map(p => {
            const rawAngle = getBearing(centroidLng, centroidLat, p.lng, p.lat);
            const cwDelta = ((rawAngle - baseAngle) % 360 + 360) % 360;
            const ccwDelta = ((baseAngle - rawAngle) % 360 + 360) % 360;
            const distFromAnchor = getDistanceKm(anchorLng, anchorLat, p.lng, p.lat);
            return { pin: p, cwDelta, ccwDelta, distFromAnchor };
        });

        const cwSorted = [...annotated]
            .sort((a, b) => (Math.abs(a.cwDelta - b.cwDelta) > 2 ? a.cwDelta - b.cwDelta : a.distFromAnchor - b.distFromAnchor))
            .map(item => item.pin);
        const ccwSorted = [...annotated]
            .sort((a, b) => (Math.abs(a.ccwDelta - b.ccwDelta) > 2 ? a.ccwDelta - b.ccwDelta : a.distFromAnchor - b.distFromAnchor))
            .map(item => item.pin);

        candidateSequences.push(fixedFirstPin ? [fixedFirstPin, ...cwSorted] : cwSorted);
        candidateSequences.push(fixedFirstPin ? [fixedFirstPin, ...ccwSorted] : ccwSorted);

        // 候選策略 4 & 5：以起點為圓心之相對方位角扇形掃描（Anchor Azimuth Sweep CW & CCW）
        const refNearest = [...sortablePool].sort(
            (a, b) => getDistanceKm(anchorLng, anchorLat, a.lng, a.lat) - getDistanceKm(anchorLng, anchorLat, b.lng, b.lat)
        )[0];
        const anchorBaseBearing = initialHeading !== null
            ? initialHeading
            : getBearing(anchorLng, anchorLat, refNearest.lng, refNearest.lat);

        const anchorAnnotated = sortablePool.map(p => {
            const b = getBearing(anchorLng, anchorLat, p.lng, p.lat);
            const cw = ((b - anchorBaseBearing) % 360 + 360) % 360;
            const ccw = ((anchorBaseBearing - b) % 360 + 360) % 360;
            const d = getDistanceKm(anchorLng, anchorLat, p.lng, p.lat);
            return { pin: p, cw, ccw, d };
        });

        const anchorCw = [...anchorAnnotated]
            .sort((a, b) => (Math.abs(a.cw - b.cw) > 3 ? a.cw - b.cw : a.d - b.d))
            .map(item => item.pin);
        const anchorCcw = [...anchorAnnotated]
            .sort((a, b) => (Math.abs(a.ccw - b.ccw) > 3 ? a.ccw - b.ccw : a.d - b.d))
            .map(item => item.pin);

        candidateSequences.push(fixedFirstPin ? [fixedFirstPin, ...anchorCw] : anchorCw);
        candidateSequences.push(fixedFirstPin ? [fixedFirstPin, ...anchorCcw] : anchorCcw);
    }

    // 對所有候選序列執行 2-opt 消除路徑交叉與折返，選出總成本（距離＋順向折返懲罰）最低的最優序列
    const lockFirstPin = Boolean(fixedFirstPin);
    let globalBestSeq = null;
    let globalBestCost = Infinity;

    for (const candidate of candidateSequences) {
        const optimized = optimizeFurnitureSequenceWith2Opt(candidate, anchorLng, anchorLat, initialHeading, lockFirstPin);
        const cost = evaluateFurnitureSequenceTotalCost(optimized, anchorLng, anchorLat, initialHeading);
        if (cost < globalBestCost) {
            globalBestCost = cost;
            globalBestSeq = optimized;
        }
    }

    return globalBestSeq || [...pins];
}

// ==========================================
// ⚡ OSRM /table/v1/driving/ 實際行車距離矩陣（meters）＋ 開放式最短路徑排序（Nearest Neighbor + 2-opt）
// ==========================================
async function fetchFurnitureOsrmDistanceMatrix(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const coordStr = points.map(p => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`).join(';');
    const radiusStr = points.map(() => String(FURNITURE_OSRM_SNAP_RADIUS_M)).join(';');
    const tableUrls = [
        `https://router.project-osrm.org/table/v1/driving/${coordStr}?annotations=distance&radiuses=${radiusStr}`,
        `https://router.project-osrm.org/table/v1/driving/${coordStr}?annotations=distance`
    ];

    for (const url of tableUrls) {
        try {
            const res = await fetchWithTimeout(url, {}, 5500);
            if (!res.ok) continue;
            const data = await res.json();
            if (data?.code === 'Ok' && Array.isArray(data.distances) && data.distances.length === points.length) {
                const n = points.length;
                const matrix = Array.from({ length: n }, (_, i) =>
                    Array.from({ length: n }, (_, j) => {
                        if (i === j) return 0;
                        const raw = data.distances[i]?.[j];
                        if (typeof raw === 'number' && isFinite(raw) && raw >= 0) {
                            return raw;
                        }
                        return getDistanceKm(points[i].lng, points[i].lat, points[j].lng, points[j].lat) * 1000;
                    })
                );
                return matrix;
            }
        } catch (e) {
            // 嘗試下一組備援 URL
        }
    }
    return null;
}

function computeOpenPathMatrixDistanceM(order, matrix) {
    let total = 0;
    for (let i = 0; i < order.length - 1; i++) {
        total += matrix[order[i]][order[i + 1]];
    }
    return total;
}

function optimizeOpenOrderWithNNAnd2Opt(n, matrix) {
    if (n <= 2) return Array.from({ length: n }, (_, i) => i);

    // 1. 開放式最近鄰（Nearest Neighbor）：固定索引 0 為起點，不返回起點
    const visited = new Array(n).fill(false);
    const order = [0];
    visited[0] = true;
    let cur = 0;

    for (let step = 1; step < n; step++) {
        let bestNext = -1;
        let bestDist = Infinity;
        for (let cand = 1; cand < n; cand++) {
            if (visited[cand]) continue;
            const d = matrix[cur][cand];
            if (d < bestDist) {
                bestDist = d;
                bestNext = cand;
            }
        }
        if (bestNext === -1) break;
        visited[bestNext] = true;
        order.push(bestNext);
        cur = bestNext;
    }

    // 2. 開放式 2-opt 局部交換優化（固定索引 0 不動，支援非對稱單行道矩陣精準重算開放總距離）
    let bestOrder = order;
    let bestDist = computeOpenPathMatrixDistanceM(bestOrder, matrix);
    const maxPasses = Math.min(30, n * 3);

    for (let pass = 0; pass < maxPasses; pass++) {
        let improved = false;
        for (let i = 1; i < bestOrder.length - 1; i++) {
            for (let k = i + 1; k < bestOrder.length; k++) {
                const candidate = [
                    ...bestOrder.slice(0, i),
                    ...bestOrder.slice(i, k + 1).reverse(),
                    ...bestOrder.slice(k + 1)
                ];
                const candDist = computeOpenPathMatrixDistanceM(candidate, matrix);
                if (candDist + 0.5 < bestDist) {
                    bestOrder = candidate;
                    bestDist = candDist;
                    improved = true;
                }
            }
        }
        if (!improved) break;
    }

    return bestOrder;
}

async function sortFurniturePinsWithOsrmTable(pins, origin = null) {
    if (!Array.isArray(pins) || pins.length <= 1) {
        return {
            sortedPins: Array.isArray(pins) ? [...pins] : [],
            usedOsrmTable: false,
            usedGpsOrigin: Boolean(origin && (origin.source === 'gps' || origin.source === 'vehicle_marker'))
        };
    }

    // 僅在已取得 GPS／車輛即時定位座標時，強制作為第 0 站起點（不納入插針編號）；完全無 GPS 時才退回第 1 支插針
    const hasGpsOrigin = Boolean(
        origin &&
        typeof origin.lng === 'number' &&
        typeof origin.lat === 'number' &&
        !isNaN(origin.lng) &&
        !isNaN(origin.lat) &&
        (origin.source === 'gps' || origin.source === 'vehicle_marker')
    );

    const matrixPoints = hasGpsOrigin
        ? [{ lng: origin.lng, lat: origin.lat }, ...pins]
        : [...pins];

    const distMatrix = await fetchFurnitureOsrmDistanceMatrix(matrixPoints);
    if (distMatrix) {
        const bestOrder = optimizeOpenOrderWithNNAnd2Opt(matrixPoints.length, distMatrix);
        const sortedPins = hasGpsOrigin
            ? bestOrder.slice(1).map(idx => pins[idx - 1])
            : bestOrder.map(idx => pins[idx]);
        return { sortedPins, usedOsrmTable: true, usedGpsOrigin: hasGpsOrigin };
    }

    // OSRM /table/v1/driving/ 失敗或逾時時，優雅退回既有直線／順向 2-opt 排序
    const fallbackOrigin = hasGpsOrigin ? origin : null;
    return {
        sortedPins: sortFurniturePinsByNearestNeighbor(pins, fallbackOrigin),
        usedOsrmTable: false,
        usedGpsOrigin: hasGpsOrigin
    };
}

let isFurnitureOsrmBusy = false;

async function executeFurnitureOsrmConnect(options = {}) {
    const shouldSortNearestNeighbor = Boolean(options?.sortNearestNeighbor);
    if (isFurnitureOsrmBusy) return;
    if (!Array.isArray(furnitureActiveData.pins) || furnitureActiveData.pins.length < 1) return;

    if (isFurnitureManualConnecting) {
        stopFurnitureManualConnectMode(false);
    }

    isFurnitureOsrmBusy = true;
    const autoBtn = document.getElementById('btnFurnitureAutoOsrmConnect');
    const sortBtn = document.getElementById('btnFurnitureSmartSortConnect');
    const origAutoHtml = autoBtn ? autoBtn.innerHTML : '';
    const origSortHtml = sortBtn ? sortBtn.innerHTML : '';

    if (autoBtn) autoBtn.disabled = true;
    if (sortBtn) sortBtn.disabled = true;

    if (shouldSortNearestNeighbor) {
        if (sortBtn) sortBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>順排中...</span>';
        showFurnitureToast('⚡ 正在以車輛 GPS 為起點計算 OSRM 道路距離矩陣與 2-opt 順排...');
    } else {
        if (autoBtn) autoBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>沿路串聯中...</span>';
        showFurnitureToast('🤖 維持目前點位順序，進行 OSRM 順向 vs 400m 繞路門檻雙軌串接...');
    }

    try {
        const origin = await resolveVehicleOriginForFurnitureOsrm();
        const hasGpsOrigin = Boolean(
            origin &&
            typeof origin.lng === 'number' &&
            typeof origin.lat === 'number' &&
            (origin.source === 'gps' || origin.source === 'vehicle_marker')
        );

        let sortResult = { usedOsrmTable: false, usedGpsOrigin: hasGpsOrigin };
        // 僅在使用者主動點擊「⚡ 順排」時才重新排列 furnitureActiveData.pins；未點擊時完全維持原本手動順序
        if (shouldSortNearestNeighbor && furnitureActiveData.pins.length >= 2) {
            sortResult = await sortFurniturePinsWithOsrmTable(furnitureActiveData.pins, origin);
            furnitureActiveData.pins = sortResult.sortedPins;
            renderAllFurnitureMapElements();
        }

        const activePins = furnitureActiveData.pins;
        const waypoints = [];
        const distOriginToFirstM = getDistanceKm(origin.lng, origin.lat, activePins[0].lng, activePins[0].lat) * 1000;
        if (shouldSortNearestNeighbor) {
            // 「⚡ 順排」：有 GPS 時強制從 GPS 起點連到第 1 針（除非與第 1 針完全重疊 < 1m）；無 GPS 時才從第 1 針起算
            if (hasGpsOrigin && distOriginToFirstM >= 1) {
                waypoints.push({ lng: origin.lng, lat: origin.lat, isOrigin: true });
            }
        } else if (distOriginToFirstM >= 12) {
            waypoints.push({ lng: origin.lng, lat: origin.lat, isOrigin: true });
        }
        activePins.forEach(p => {
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
        showFurnitureToast(
            shouldSortNearestNeighbor
                ? (sortResult.usedGpsOrigin
                    ? `⚡ 已從車輛 GPS 起點完成 OSRM ${sortResult.usedOsrmTable ? '距離矩陣 + 2-opt' : '備援'} 順排與沿路串接（共 ${furnitureActiveData.distanceKm} km）`
                    : `⚡ 尚未取得 GPS，已從 #1 號針完成 OSRM 順排與沿路串接（共 ${furnitureActiveData.distanceKm} km）`)
                : `✅ 已依目前順序完成 OSRM 雙軌路線串接（共 ${furnitureActiveData.distanceKm} km）`
        );
    } finally {
        isFurnitureOsrmBusy = false;
        const hasPins = Array.isArray(furnitureActiveData.pins) && furnitureActiveData.pins.length >= 1;
        if (autoBtn) {
            autoBtn.innerHTML = origAutoHtml;
            autoBtn.disabled = !hasPins;
        }
        if (sortBtn) {
            sortBtn.innerHTML = origSortHtml;
            sortBtn.disabled = !hasPins;
        }
    }
}

document.getElementById('btnFurnitureAutoOsrmConnect')?.addEventListener('click', () => {
    executeFurnitureOsrmConnect({ sortNearestNeighbor: false });
});

document.getElementById('btnFurnitureSmartSortConnect')?.addEventListener('click', () => {
    executeFurnitureOsrmConnect({ sortNearestNeighbor: true });
});

// ==========================================
// ✍️ 串聯方式 2：手動拉線串（依序點選插針 A ➔ B ➔ C，立即透過 OSRM 雙軌道路規則自動依附實際道路最短路徑）
// ==========================================
function startFurnitureManualConnectMode() {
    if (!Array.isArray(furnitureActiveData.pins) || furnitureActiveData.pins.length < 2) return;

    isFurnitureManualConnecting = true;
    isFurnitureManualRouting = false;
    furnitureManualSelectedPinIndices = [];
    furnitureManualRollingHeading = getCurrentValidVehicleHeading();
    furnitureManualTargetPinIdx = 0;
    furnitureManualConnectedCoords = [];
    furnitureManualSegmentDraft = [];
    isFurnitureDrawingStroke = false;

    furnitureActiveData.routeCoords = [];
    showFurnitureToast('✍️ 手動拉線串：請依序點選插針（A ➔ B ➔ C），將自動依附道路最短路徑繪製');
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
    isFurnitureManualRouting = false;
    isFurnitureDrawingStroke = false;
    furnitureManualSegmentDraft = [];
    furnitureManualSelectedPinIndices = [];
    furnitureManualRollingHeading = null;
    try { map.dragPan.enable(); } catch (e) {}
    renderAllFurnitureMapElements();
}

async function handleManualConnectSnapToPin(targetIdx) {
    if (!isFurnitureManualConnecting) return;
    if (targetIdx < 0 || targetIdx >= furnitureActiveData.pins.length) return;
    if (isFurnitureManualRouting) {
        showFurnitureToast('⏳ 正在計算上一段道路路徑，請稍候...');
        return;
    }

    const targetPin = furnitureActiveData.pins[targetIdx];
    const targetCoord = [targetPin.lng, targetPin.lat];

    // 1. 點選第 1 支起點插針（A）
    if (furnitureManualSelectedPinIndices.length === 0) {
        furnitureManualSelectedPinIndices.push(targetIdx);
        furnitureManualConnectedCoords = [targetCoord];
        furnitureManualSegmentDraft = [targetCoord];
        furnitureManualTargetPinIdx = 1;
        furnitureActiveData.routeCoords = [...furnitureManualConnectedCoords];
        vibrate(25);
        renderAllFurnitureMapElements();
        showFurnitureToast(`📍 已設定起點 #${targetIdx + 1} 號針！請點選下一支要串接的插針`);
        return;
    }

    // 避免連續重複點擊同一支針
    const prevIdx = furnitureManualSelectedPinIndices[furnitureManualSelectedPinIndices.length - 1];
    if (targetIdx === prevIdx) {
        showFurnitureToast(`ℹ️ 目前已停在 #${targetIdx + 1} 號針，請點選其他插針`);
        return;
    }

    const prevPin = furnitureActiveData.pins[prevIdx];
    isFurnitureManualRouting = true;
    showFurnitureToast(`🛣️ 正在依附道路串接 #${prevIdx + 1} ➔ #${targetIdx + 1}...`);

    try {
        const { coords, usedOsrm, endHeading } = await fetchFurnitureOsrmSegmentGeometry(
            prevPin.lng,
            prevPin.lat,
            targetPin.lng,
            targetPin.lat,
            {
                startHeading: furnitureManualRollingHeading,
                originUnrestricted: (furnitureManualSelectedPinIndices.length === 1),
                snapRadiusM: FURNITURE_OSRM_SNAP_RADIUS_M
            }
        );

        // 若等待 OSRM 回傳期間使用者已結束手動模式，安全中止不覆寫
        if (!isFurnitureManualConnecting) return;

        if (typeof endHeading === 'number' && !isNaN(endHeading)) {
            furnitureManualRollingHeading = endHeading;
        }

        const densified = densifyRoadCoordinates(coords, 8);
        if (furnitureManualConnectedCoords.length === 0 && densified.length > 0) {
            furnitureManualConnectedCoords.push(densified[0]);
        }
        for (let i = 1; i < densified.length; i++) {
            furnitureManualConnectedCoords.push(densified[i]);
        }

        furnitureManualSelectedPinIndices.push(targetIdx);
        furnitureManualTargetPinIdx = furnitureManualSelectedPinIndices.length;
        furnitureManualSegmentDraft = [targetCoord];

        furnitureActiveData.routeCoords = [...furnitureManualConnectedCoords];
        furnitureActiveData.distanceKm = computeCoordsDistanceKm(furnitureActiveData.routeCoords);
        furnitureActiveData.updatedAt = Date.now();
        isLocalFurnitureDirty = true;
        saveLocalFurnitureBackup();
        vibrate(35);

        const uniqueSelectedCount = new Set(furnitureManualSelectedPinIndices).size;
        if (uniqueSelectedCount >= furnitureActiveData.pins.length) {
            const totalKm = furnitureActiveData.distanceKm;
            const totalCount = furnitureManualSelectedPinIndices.length;
            stopFurnitureManualConnectMode(true);
            showFurnitureToast(
                usedOsrm
                    ? `🎉 已完成手動沿路串聯（共 ${totalCount} 針，${totalKm} km）`
                    : `⚠️ 末段道路算路逾時改以直線保底，已完成手動串聯（${totalKm} km）`
            );
        } else {
            renderAllFurnitureMapElements();
            showFurnitureToast(
                usedOsrm
                    ? `✅ 已沿路串接 #${prevIdx + 1} ➔ #${targetIdx + 1}（累計 ${furnitureActiveData.distanceKm} km），請點選下一支針或按「完成手拉」`
                    : `⚠️ #${prevIdx + 1} ➔ #${targetIdx + 1} 道路算路逾時／失敗，已暫以直線連接該段`
            );
        }
    } finally {
        isFurnitureManualRouting = false;
    }
}

function handleFurnitureManualClickPoint(lng, lat) {
    if (!isFurnitureManualConnecting || isFurnitureManualRouting) return;
    if (!Array.isArray(furnitureActiveData.pins) || furnitureActiveData.pins.length === 0) return;

    // 點擊地圖時自動搜尋 35m 內最近的插針並觸發道路吸附串接（不再繪製任意直線飛鳥線）
    let nearestIdx = -1;
    let nearestDistM = 35;
    for (let i = 0; i < furnitureActiveData.pins.length; i++) {
        const p = furnitureActiveData.pins[i];
        const d = getDistanceKm(lng, lat, p.lng, p.lat) * 1000;
        if (d <= nearestDistM) {
            nearestDistM = d;
            nearestIdx = i;
        }
    }
    if (nearestIdx !== -1) {
        handleManualConnectSnapToPin(nearestIdx);
    }
}

(function setupFurnitureManualFreehandGesture() {
    // 手動拉線串已升級為「點選插針自動依附 OSRM 道路最短路徑」，保留地圖正常拖曳縮放，不再攔截手繪直線
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

