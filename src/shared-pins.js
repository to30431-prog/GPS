// ==========================================
// [Module 6/10] src/shared-pins.js
// 全車隊共享地圖地標（map_pins：藍色水滴髒亂點 ＋ 橘色水滴社區大樓）與距離指引
// ==========================================

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
const btnResolveMapPin = document.getElementById('btnResolveMapPin');
const btnCloseViewMapPin = document.getElementById('btnCloseViewMapPin');
const btnCloseViewMapPinTop = document.getElementById('btnCloseViewMapPinTop');
const viewMapPinAlertMetaRow = document.getElementById('viewMapPinAlertMetaRow');
const viewMapPinAlertStatusText = document.getElementById('viewMapPinAlertStatusText');
const viewMapPinAlertExpiryText = document.getElementById('viewMapPinAlertExpiryText');

const roadAlertTypeSelector = document.getElementById('roadAlertTypeSelector');
const roadAlertExpirySelector = document.getElementById('roadAlertExpirySelector');

const roadAlertMiniWidget = document.getElementById('roadAlertMiniWidget');
const roadAlertMiniMainBtn = document.getElementById('roadAlertMiniMainBtn');
const roadAlertMiniIcon = document.getElementById('roadAlertMiniIcon');
const roadAlertMiniTypeText = document.getElementById('roadAlertMiniTypeText');
const roadAlertMiniCountBadge = document.getElementById('roadAlertMiniCountBadge');
const roadAlertMiniTitleText = document.getElementById('roadAlertMiniTitleText');
const roadAlertMiniNextBtn = document.getElementById('roadAlertMiniNextBtn');

const pinDistanceGuideBanner = document.getElementById('pinDistanceGuideBanner');
const pinDistanceGuideText = document.getElementById('pinDistanceGuideText');
const btnCancelPinDistanceGuideBanner = document.getElementById('btnCancelPinDistanceGuideBanner');

// ==========================================
// ⚠️ 路段警示插釘類型設定（封閉／施工／喜喪／活動／其他）與時效過濾
// ==========================================
const ROAD_ALERT_TYPES = {
    closure: {
        key: 'closure',
        label: '封閉',
        defaultTitle: '路段封閉',
        iconClass: 'fa-solid fa-triangle-exclamation',
        iconTextClass: 'text-white',
        color: '#dc2626',
        cssClass: 'alert-type-closure',
        modalBorderClass: 'border-red-500',
        badgeClass: 'bg-red-100 text-red-800',
        badgeIconClass: 'text-red-600',
        miniBtnClass: 'bg-red-600/95 hover:bg-red-700 text-white',
        miniIconBgClass: 'bg-white/20 text-white'
    },
    construction: {
        key: 'construction',
        label: '施工',
        defaultTitle: '道路施工',
        iconClass: 'fa-solid fa-person-digging',
        iconTextClass: 'text-gray-950',
        color: '#d97706',
        cssClass: 'alert-type-construction',
        modalBorderClass: 'border-yellow-500',
        badgeClass: 'bg-yellow-100 text-yellow-900',
        badgeIconClass: 'text-yellow-700',
        miniBtnClass: 'bg-yellow-400/95 hover:bg-yellow-500 text-gray-950',
        miniIconBgClass: 'bg-gray-950/15 text-gray-950'
    },
    ceremony: {
        key: 'ceremony',
        label: '喜喪',
        defaultTitle: '喜喪管制',
        iconClass: 'fa-solid fa-ribbon',
        iconTextClass: 'text-white',
        color: '#9333ea',
        cssClass: 'alert-type-ceremony',
        modalBorderClass: 'border-purple-500',
        badgeClass: 'bg-purple-100 text-purple-800',
        badgeIconClass: 'text-purple-600',
        miniBtnClass: 'bg-purple-600/95 hover:bg-purple-700 text-white',
        miniIconBgClass: 'bg-white/20 text-white'
    },
    event: {
        key: 'event',
        label: '活動',
        defaultTitle: '活動管制',
        iconClass: 'fa-solid fa-bullhorn',
        iconTextClass: 'text-white',
        color: '#0284c7',
        cssClass: 'alert-type-event',
        modalBorderClass: 'border-sky-500',
        badgeClass: 'bg-sky-100 text-sky-800',
        badgeIconClass: 'text-sky-600',
        miniBtnClass: 'bg-sky-600/95 hover:bg-sky-700 text-white',
        miniIconBgClass: 'bg-white/20 text-white'
    },
    other: {
        key: 'other',
        label: '其他警示',
        defaultTitle: '路段警示',
        iconClass: 'fa-solid fa-circle-exclamation',
        iconTextClass: 'text-white',
        color: '#2563eb',
        cssClass: 'alert-type-other',
        modalBorderClass: 'border-blue-500',
        badgeClass: 'bg-blue-100 text-blue-800',
        badgeIconClass: 'text-blue-600',
        miniBtnClass: 'bg-blue-600/95 hover:bg-blue-700 text-white',
        miniIconBgClass: 'bg-white/20 text-white'
    }
};

let selectedRoadAlertType = 'closure';
let selectedRoadAlertExpiryHours = 24;
let roadAlertMiniCycleIdx = 0;

function getRoadAlertTypeMeta(alertType) {
    if (alertType && ROAD_ALERT_TYPES[alertType]) {
        return ROAD_ALERT_TYPES[alertType];
    }
    return ROAD_ALERT_TYPES.other;
}

function isRoadAlertPinActive(pin, now = Date.now()) {
    if (!pin || pin.pinType === 'building') return false;
    if (pin.status === 'resolved' || Number(pin.resolvedAt) > 0) return false;
    const expiresAt = Number(pin.expiresAt || 0);
    if (expiresAt > 0 && now > expiresAt) return false;
    return true;
}

function formatAlertRemainingTime(expiresAt) {
    const ts = Number(expiresAt || 0);
    if (!ts || ts <= 0) return '長期有效';
    const diffMs = ts - Date.now();
    if (diffMs <= 0) return '已過期';
    const diffMin = Math.ceil(diffMs / 60000);
    if (diffMin < 60) return `剩餘約 ${diffMin} 分鐘`;
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 48) return `剩餘約 ${diffHours} 小時`;
    const diffDays = Math.round(diffHours / 24);
    return `剩餘約 ${diffDays} 天`;
}

function getActiveRoadAlertPins() {
    const now = Date.now();
    const list = [];
    if (typeof pinsLayerGroup === 'object' && pinsLayerGroup) {
        Object.values(pinsLayerGroup).forEach(entry => {
            const pin = entry && entry.data;
            if (pin && isRoadAlertPinActive(pin, now)) {
                list.push(pin);
            }
        });
    }
    list.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
    return list;
}

function resolvePinGuideOriginLngLat(fallbackOrigin) {
    if (typeof currentFleetLng === 'number' && !isNaN(currentFleetLng) &&
        typeof currentFleetLat === 'number' && !isNaN(currentFleetLat)) {
        return [currentFleetLng, currentFleetLat];
    }
    if (typeof lastValidGpsLng === 'number' && !isNaN(lastValidGpsLng) &&
        typeof lastValidGpsLat === 'number' && !isNaN(lastValidGpsLat)) {
        return [lastValidGpsLng, lastValidGpsLat];
    }
    if (Array.isArray(fallbackOrigin) && fallbackOrigin.length >= 2 &&
        !isNaN(Number(fallbackOrigin[0])) && !isNaN(Number(fallbackOrigin[1]))) {
        return [Number(fallbackOrigin[0]), Number(fallbackOrigin[1])];
    }
    if (typeof map !== 'undefined' && map && typeof map.getCenter === 'function') {
        const c = map.getCenter();
        if (c && !isNaN(c.lng) && !isNaN(c.lat)) {
            return [c.lng, c.lat];
        }
    }
    return Array.isArray(lastKnownLngLat) ? [Number(lastKnownLngLat[0]), Number(lastKnownLngLat[1])] : [121.346, 24.954];
}

function getPinGuideLineColor(pin) {
    if (!pin || pin.pinType === 'building') return '#2563eb';
    return getRoadAlertTypeMeta(pin.alertType).color || '#2563eb';
}

function ensurePinDistanceGuideLayer(lineColor = '#2563eb') {
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
                'line-color': lineColor,
                'line-width': 4.5,
                'line-dasharray': [2, 2],
                'line-opacity': 0.94
            }
        });
    } else {
        try {
            map.setPaintProperty('pin-distance-guide-line', 'line-color', lineColor);
        } catch (e) {}
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
        btnDistanceGuideMapPin.className = 'bg-amber-500 hover:bg-amber-600 text-white font-extrabold py-2.5 px-2 rounded-2xl shadow-md active:scale-95 flex items-center justify-center gap-1.5 text-xs sm:text-sm';
        btnDistanceGuideMapPin.innerHTML = '🎯 取消距離指引';
    } else {
        btnDistanceGuideMapPin.className = 'bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-2.5 px-2 rounded-2xl shadow-md active:scale-95 flex items-center justify-center gap-1.5 text-xs sm:text-sm';
        btnDistanceGuideMapPin.innerHTML = '🎯 距離指引';
    }
}

function updateRoadAlertMiniWidgetUI() {
    if (!roadAlertMiniWidget || !roadAlertMiniMainBtn) return;
    const activeAlerts = getActiveRoadAlertPins();
    if (activeAlerts.length === 0) {
        roadAlertMiniWidget.classList.add('hidden');
        roadAlertMiniCycleIdx = 0;
        return;
    }

    if (roadAlertMiniCycleIdx >= activeAlerts.length) {
        roadAlertMiniCycleIdx = 0;
    }
    const currentAlert = activeAlerts[roadAlertMiniCycleIdx];
    const meta = getRoadAlertTypeMeta(currentAlert.alertType);
    const isGuidingCurrent = Boolean(activeDistanceGuidePin && activeDistanceGuidePin.id === currentAlert.id);

    roadAlertMiniWidget.classList.remove('hidden');
    roadAlertMiniMainBtn.className = `road-alert-mini-btn ${meta.miniBtnClass} px-2.5 py-1.5 rounded-2xl shadow-xl border-2 border-white flex items-center gap-2 active:scale-95 transition-all min-w-0 ${isGuidingCurrent ? 'is-guiding' : ''}`;

    if (roadAlertMiniIcon) {
        roadAlertMiniIcon.className = `w-6 h-6 rounded-full ${meta.miniIconBgClass} flex items-center justify-center text-xs flex-shrink-0`;
        roadAlertMiniIcon.innerHTML = `<i class="${meta.iconClass}"></i>`;
    }
    if (roadAlertMiniTypeText) {
        roadAlertMiniTypeText.textContent = meta.label;
    }
    if (roadAlertMiniCountBadge) {
        if (activeAlerts.length > 1) {
            roadAlertMiniCountBadge.textContent = `${roadAlertMiniCycleIdx + 1}/${activeAlerts.length}`;
            roadAlertMiniCountBadge.classList.remove('hidden');
        } else {
            roadAlertMiniCountBadge.classList.add('hidden');
        }
    }
    if (roadAlertMiniTitleText) {
        const displayTitle = (currentAlert.title || meta.defaultTitle).trim();
        roadAlertMiniTitleText.textContent = isGuidingCurrent
            ? `${displayTitle} · 再次點擊收合`
            : displayTitle;
    }
    if (roadAlertMiniNextBtn) {
        roadAlertMiniNextBtn.classList.toggle('hidden', activeAlerts.length <= 1);
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
    updateRoadAlertMiniWidgetUI();
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

    const [userLng, userLat] = resolvePinGuideOriginLngLat(activeDistanceGuidePin._fallbackOrigin);
    const lineColor = getPinGuideLineColor(activeDistanceGuidePin);

    const distMeters = getDistanceKm(userLng, userLat, targetLng, targetLat) * 1000;
    const distLabel = formatDistanceToPinText(distMeters);

    if (ensurePinDistanceGuideLayer(lineColor)) {
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
        badgeDom.style.background = lineColor;
    }

    if (pinDistanceGuideBanner && pinDistanceGuideText) {
        const shortTitle = (activeDistanceGuidePin.title || '目標地標').slice(0, 10);
        pinDistanceGuideText.textContent = `${shortTitle} · ${distLabel}`;
        pinDistanceGuideBanner.style.backgroundColor = lineColor;
        pinDistanceGuideBanner.classList.remove('hidden');
    }
}

function startPinDistanceGuide(pin, options = {}) {
    if (!pin) return;
    if (pinDistanceGuideTimer !== null) {
        clearInterval(pinDistanceGuideTimer);
        pinDistanceGuideTimer = null;
    }

    const fallbackOrigin = options.fallbackOrigin || (() => {
        if (typeof map !== 'undefined' && map && typeof map.getCenter === 'function') {
            const c = map.getCenter();
            if (c && !isNaN(c.lng) && !isNaN(c.lat)) return [c.lng, c.lat];
        }
        return null;
    })();

    activeDistanceGuidePin = { ...pin, _fallbackOrigin: fallbackOrigin };
    syncDistanceGuideButtonUI(pin);
    if (options.closeModal !== false) {
        closeViewMapPinModal();
    }

    updatePinDistanceGuideRender();
    pinDistanceGuideTimer = setInterval(updatePinDistanceGuideRender, 1000);
    updateRoadAlertMiniWidgetUI();
}

function togglePinDistanceGuide(pin) {
    if (!pin) return;
    if (activeDistanceGuidePin && activeDistanceGuidePin.id === pin.id) {
        clearPinDistanceGuide();
        return;
    }
    startPinDistanceGuide(pin, { closeModal: true });
}

function focusAndGuideRoadAlertPin(pin) {
    if (!pin) return;
    const targetLng = Number(pin.lng);
    const targetLat = Number(pin.lat);
    if (isNaN(targetLng) || isNaN(targetLat)) return;

    // 先擷取飛往前的畫面中心作為無 GPS 時的虛線起點，避免飛到目標後起終點重疊
    let preFlyCenter = null;
    if (typeof map !== 'undefined' && map && typeof map.getCenter === 'function') {
        const c = map.getCenter();
        if (c && !isNaN(c.lng) && !isNaN(c.lat)) {
            preFlyCenter = [c.lng, c.lat];
        }
    }

    if (typeof setCameraFollow === 'function') {
        setCameraFollow(false);
    }
    if (typeof map !== 'undefined' && map && typeof map.flyTo === 'function') {
        map.flyTo({
            center: [targetLng, targetLat],
            zoom: Math.max(map.getZoom(), 16.5),
            duration: 750
        });
    }

    startPinDistanceGuide(pin, { fallbackOrigin: preFlyCenter, closeModal: false });
}

if (roadAlertMiniMainBtn) {
    roadAlertMiniMainBtn.onclick = (e) => {
        e.stopPropagation();
        const activeAlerts = getActiveRoadAlertPins();
        if (activeAlerts.length === 0) {
            updateRoadAlertMiniWidgetUI();
            return;
        }
        if (roadAlertMiniCycleIdx >= activeAlerts.length) {
            roadAlertMiniCycleIdx = 0;
        }
        const currentAlert = activeAlerts[roadAlertMiniCycleIdx];
        if (activeDistanceGuidePin && activeDistanceGuidePin.id === currentAlert.id) {
            clearPinDistanceGuide();
            return;
        }
        focusAndGuideRoadAlertPin(currentAlert);
    };
}

if (roadAlertMiniNextBtn) {
    roadAlertMiniNextBtn.onclick = (e) => {
        e.stopPropagation();
        const activeAlerts = getActiveRoadAlertPins();
        if (activeAlerts.length <= 1) return;
        roadAlertMiniCycleIdx = (roadAlertMiniCycleIdx + 1) % activeAlerts.length;
        const nextAlert = activeAlerts[roadAlertMiniCycleIdx];
        focusAndGuideRoadAlertPin(nextAlert);
    };
}

// 確保切換任何底圖 style 後，若目前有啟用中的虛線引導線也能自動重繪恢復
if (typeof map !== 'undefined' && map && typeof map.on === 'function') {
    map.on('style.load', () => {
        if (activeDistanceGuidePin) {
            setTimeout(() => {
                if (activeDistanceGuidePin) updatePinDistanceGuideRender();
            }, 60);
        }
    });
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
    window._lastLongPressCoords = { lat, lng };

    const isCalMode = Boolean(window.SpeedCameraManager && typeof window.SpeedCameraManager.isCalibrationMode === 'function' && window.SpeedCameraManager.isCalibrationMode());
    if (longPressPinTypeCoordsText) {
        longPressPinTypeCoordsText.innerText = isCalMode
            ? `座標：${lat.toFixed(6)}, ${lng.toFixed(6)}`
            : `座標：${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
    const speedCamSec = document.getElementById('longPressSpeedCamSection');
    const precisionValEl = document.getElementById('longPressPrecisionCoordsValue');
    const copyBtn = document.getElementById('btnCopyLongPressCoords');
    if (speedCamSec) {
        if (isCalMode) {
            speedCamSec.classList.remove('hidden');
            if (precisionValEl) precisionValEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            if (copyBtn) copyBtn.textContent = '📋 一鍵複製';
        } else {
            speedCamSec.classList.add('hidden');
        }
    }
    if (longPressPinTypeModal) {
        window.history.pushState({ pwa: true }, '');
        longPressPinTypeModal.classList.remove('hidden');
    }
}

document.getElementById('btnCopyLongPressCoords')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const coordsText = (typeof pendingMapPinLat === 'number' && typeof pendingMapPinLng === 'number')
        ? `${pendingMapPinLat.toFixed(6)}, ${pendingMapPinLng.toFixed(6)}`
        : '';
    if (!coordsText) return;
    const copyBtn = e.currentTarget;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(coordsText);
        } else {
            const ta = document.createElement('textarea');
            ta.value = coordsText;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        if (copyBtn) copyBtn.textContent = '✅ 已複製';
    } catch (_) {
        if (copyBtn) copyBtn.textContent = '⚠️ 複製失敗';
    }
});

document.getElementById('btnChooseSpeedCameraPin')?.addEventListener('click', () => {
    const lat = pendingMapPinLat;
    const lng = pendingMapPinLng;
    closeLongPressPinTypeModal(false);
    if (window.SpeedCameraManager && typeof window.SpeedCameraManager.openEditorModal === 'function') {
        window.SpeedCameraManager.openEditorModal(null, { lat, lng });
    }
});

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
            alert('🔒 目前此裝置為「一般使用者（唯讀）」。\n若要新增／修改／刪除「🏢 社區大樓」，請聯繫開發者於「👥 管理使用者」開啟您的「🏢 僅社區標註」或「🛡️ 路線管理（含社區）」授權開關！');
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
        alert('🔒 需具備「🏢 社區標註員」或「🛡️ 路線管理員」裝置授權才可新增或修改社區大樓！');
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
        alert('🔒 需具備「🏢 社區標註員」或「🛡️ 路線管理員」裝置授權才可儲存社區大樓！');
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

function syncRoadAlertTypeSelectorUI() {
    if (!roadAlertTypeSelector) return;
    const buttons = roadAlertTypeSelector.querySelectorAll('.road-alert-type-btn');
    buttons.forEach(btn => {
        const typeKey = btn.getAttribute('data-alert-type');
        const isSelected = (typeKey === selectedRoadAlertType);
        btn.classList.remove(
            'border-red-500', 'bg-red-50', 'text-red-700',
            'border-yellow-500', 'bg-yellow-50', 'text-yellow-900',
            'border-purple-500', 'bg-purple-50', 'text-purple-800',
            'border-sky-500', 'bg-sky-50', 'text-sky-800',
            'border-blue-500', 'bg-blue-50', 'text-blue-800',
            'border-gray-200', 'bg-gray-50', 'text-gray-700',
            'ring-2', 'ring-offset-1', 'ring-red-300', 'ring-yellow-300', 'ring-purple-300', 'ring-sky-300', 'ring-blue-300'
        );
        if (isSelected) {
            const activeMap = {
                closure: ['border-red-500', 'bg-red-50', 'text-red-700', 'ring-2', 'ring-offset-1', 'ring-red-300'],
                construction: ['border-yellow-500', 'bg-yellow-50', 'text-yellow-900', 'ring-2', 'ring-offset-1', 'ring-yellow-300'],
                ceremony: ['border-purple-500', 'bg-purple-50', 'text-purple-800', 'ring-2', 'ring-offset-1', 'ring-purple-300'],
                event: ['border-sky-500', 'bg-sky-50', 'text-sky-800', 'ring-2', 'ring-offset-1', 'ring-sky-300'],
                other: ['border-blue-500', 'bg-blue-50', 'text-blue-800', 'ring-2', 'ring-offset-1', 'ring-blue-300']
            };
            btn.classList.add(...(activeMap[typeKey] || activeMap.other));
        } else {
            btn.classList.add('border-gray-200', 'bg-gray-50', 'text-gray-700');
        }
    });
}

function syncRoadAlertExpirySelectorUI() {
    if (!roadAlertExpirySelector) return;
    const buttons = roadAlertExpirySelector.querySelectorAll('.road-alert-expiry-btn');
    buttons.forEach(btn => {
        const hours = Number(btn.getAttribute('data-expiry-hours'));
        const isSelected = (hours === selectedRoadAlertExpiryHours);
        if (isSelected) {
            btn.className = 'road-alert-expiry-btn py-1.5 px-1 rounded-xl border-2 border-blue-600 bg-blue-50 text-blue-700 text-[11px] font-black active:scale-95';
        } else {
            btn.className = 'road-alert-expiry-btn py-1.5 px-1 rounded-xl border border-gray-200 bg-gray-50 text-gray-600 text-[11px] font-extrabold active:scale-95';
        }
    });
}

if (roadAlertTypeSelector) {
    roadAlertTypeSelector.addEventListener('click', (e) => {
        const btn = e.target.closest('.road-alert-type-btn');
        if (!btn) return;
        const typeKey = btn.getAttribute('data-alert-type');
        if (typeKey && ROAD_ALERT_TYPES[typeKey]) {
            selectedRoadAlertType = typeKey;
            syncRoadAlertTypeSelectorUI();
        }
    });
}

if (roadAlertExpirySelector) {
    roadAlertExpirySelector.addEventListener('click', (e) => {
        const btn = e.target.closest('.road-alert-expiry-btn');
        if (!btn) return;
        const hours = Number(btn.getAttribute('data-expiry-hours'));
        if (!isNaN(hours) && hours >= 0) {
            selectedRoadAlertExpiryHours = hours;
            syncRoadAlertExpirySelectorUI();
        }
    });
}

function openCreateMapPinModal(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    pendingMapPinLat = lat;
    pendingMapPinLng = lng;
    selectedRoadAlertType = 'closure';
    selectedRoadAlertExpiryHours = 24;
    syncRoadAlertTypeSelectorUI();
    syncRoadAlertExpirySelectorUI();

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
    const typeMeta = getRoadAlertTypeMeta(selectedRoadAlertType);
    const noteVal = (mapPinTitleInput?.value || '').trim();
    const titleVal = noteVal || typeMeta.defaultTitle;

    if (!navigator.onLine) {
        alert('⚠️ 目前無網路連線，請確認網路狀態後再新增路段警示！');
        return;
    }

    const pinId = 'pin_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
    const authorName = (fleetUserName || localStorage.getItem('fleet_user_name') || localStorage.getItem('yinggeRouteLastAuthor') || '熱心隊員').trim();
    const createdAt = Date.now();
    const expiresAt = selectedRoadAlertExpiryHours > 0
        ? createdAt + selectedRoadAlertExpiryHours * 3600 * 1000
        : 0;

    const pinData = {
        id: pinId,
        pinType: 'dirty',
        alertType: typeMeta.key,
        status: 'active',
        expiresAt: expiresAt,
        lat: Number(pendingMapPinLat.toFixed(6)),
        lng: Number(pendingMapPinLng.toFixed(6)),
        title: titleVal,
        note: noteVal,
        photo: currentMapPinPhotoBase64 || '',
        author: authorName,
        createdAt: createdAt,
        updatedAt: createdAt
    };

    const origBtnHtml = btnSaveMapPin ? btnSaveMapPin.innerHTML : '';
    if (btnSaveMapPin) {
        btnSaveMapPin.disabled = true;
        btnSaveMapPin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在上傳警示...';
    }

    try {
        const res = await fetchWithTimeout(`${MAP_PINS_BASE_URL}/${encodeURIComponent(pinId)}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pinData)
        }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        upsertPinMarkerOnMap(pinId, pinData);
        updateRoadAlertMiniWidgetUI();
        closeCreateMapPinModal();
        fetchAndRenderSharedMapPins();
    } catch (err) {
        console.error('上傳路段警示失敗:', err);
        alert('❌ 新增警示失敗（網路不穩或 5 秒連線逾時），請稍後再試！');
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
    const alertMeta = isBuilding ? null : getRoadAlertTypeMeta(pin.alertType);
    const isAlertActive = !isBuilding && isRoadAlertPinActive(pin);

    if (viewMapPinModalCard) {
        viewMapPinModalCard.classList.remove('border-orange-500', 'border-blue-500', 'border-red-500', 'border-yellow-500', 'border-purple-500', 'border-sky-500');
        viewMapPinModalCard.classList.add(isBuilding ? 'border-orange-500' : alertMeta.modalBorderClass);
    }
    if (viewMapPinCategoryBadge) {
        if (isBuilding) {
            viewMapPinCategoryBadge.className = 'bg-orange-100 text-orange-800 text-xs font-black px-3 py-1 rounded-full flex items-center gap-1.5';
            viewMapPinCategoryBadge.innerHTML = hasBuildingAuth
                ? '<i class="fa-solid fa-building text-orange-600"></i> 全車隊共享社區大樓（已授權管理）'
                : '<i class="fa-solid fa-building text-orange-600"></i> 全車隊共享社區大樓（一般唯讀）';
        } else {
            viewMapPinCategoryBadge.className = `${alertMeta.badgeClass} text-xs font-black px-3 py-1 rounded-full flex items-center gap-1.5`;
            viewMapPinCategoryBadge.innerHTML = `<i class="${alertMeta.iconClass} ${alertMeta.badgeIconClass}"></i> 路段警示 · ${alertMeta.label}`;
        }
    }

    if (viewMapPinTitleText) viewMapPinTitleText.textContent = pin.title || (isBuilding ? '社區大樓' : alertMeta.defaultTitle);
    if (viewMapPinAuthorText) viewMapPinAuthorText.textContent = pin.author || '熱心隊員';
    if (viewMapPinTimeText) viewMapPinTimeText.textContent = formatPinCreatedAt(pin.updatedAt || pin.createdAt);

    if (viewMapPinAlertMetaRow) {
        if (!isBuilding) {
            viewMapPinAlertMetaRow.classList.remove('hidden');
            if (viewMapPinAlertStatusText) {
                viewMapPinAlertStatusText.textContent = isAlertActive ? '🟢 狀態：有效中' : '⚪ 狀態：已解除／過期';
            }
            if (viewMapPinAlertExpiryText) {
                viewMapPinAlertExpiryText.textContent = formatAlertRemainingTime(pin.expiresAt);
            }
        } else {
            viewMapPinAlertMetaRow.classList.add('hidden');
        }
    }

    if (btnResolveMapPin) {
        btnResolveMapPin.classList.toggle('hidden', isBuilding || !isAlertActive);
    }

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
                    : '（唯讀模式：需社區標註員或路線管理員授權才可編輯備註）';
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
        if (isBuilding && hasBuildingAuth) {
            btnEditMapPinTitle.classList.remove('hidden');
            btnEditMapPinTitle.innerHTML = '✏️ 編輯名稱';
        } else {
            btnEditMapPinTitle.classList.add('hidden');
        }
    }

    if (btnDeleteMapPin) {
        if (isBuilding && !hasBuildingAuth) {
            btnDeleteMapPin.classList.add('hidden');
        } else {
            btnDeleteMapPin.classList.remove('hidden');
            btnDeleteMapPin.innerHTML = '🗑️ 刪除';
        }
    }

    syncDistanceGuideButtonUI(pin);

    if (viewMapPinModal) {
        window.history.pushState({ pwa: true }, '');
        viewMapPinModal.classList.remove('hidden');
    }
}

if (btnResolveMapPin) {
    btnResolveMapPin.onclick = async () => {
        if (!activeViewingMapPin || !activeViewingMapPin.id) return;
        if (activeViewingMapPin.pinType === 'building') return;
        if (!navigator.onLine) {
            alert('⚠️ 目前無網路連線，無法同步解除警示！');
            return;
        }

        const pinId = activeViewingMapPin.id;
        const now = Date.now();
        const resolvedPinData = {
            ...activeViewingMapPin,
            id: pinId,
            status: 'resolved',
            resolvedAt: now,
            updatedAt: now
        };

        const origHtml = btnResolveMapPin.innerHTML;
        btnResolveMapPin.disabled = true;
        btnResolveMapPin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>正在同步解除...</span>';

        try {
            const res = await fetchWithTimeout(`${MAP_PINS_BASE_URL}/${encodeURIComponent(pinId)}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(resolvedPinData)
            }, 5000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            if (pinsLayerGroup[pinId]) {
                try { pinsLayerGroup[pinId].marker.remove(); } catch (e) {}
                delete pinsLayerGroup[pinId];
            }
            if (activeDistanceGuidePin && activeDistanceGuidePin.id === pinId) {
                clearPinDistanceGuide();
            }
            updateRoadAlertMiniWidgetUI();
            closeViewMapPinModal();
            fetchAndRenderSharedMapPins();
        } catch (err) {
            console.error('標記路段警示已解除失敗:', err);
            alert('❌ 解除警示失敗（網路不穩或連線逾時），請稍後再試！');
        } finally {
            btnResolveMapPin.disabled = false;
            btnResolveMapPin.innerHTML = origHtml;
        }
    };
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
            alert('🔒 需具備「🏢 社區標註員」或「🛡️ 路線管理員」裝置授權才可修改社區備註！');
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
            alert('🔒 需具備「🏢 社區標註員」或「🛡️ 路線管理員」裝置授權才可修改社區大樓名稱！');
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
            alert('🔒 需具備「🏢 社區標註員」或「🛡️ 路線管理員」裝置授權才可刪除社區大樓！');
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
            updateRoadAlertMiniWidgetUI();
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
    const alertMeta = isBuilding ? null : getRoadAlertTypeMeta(pin.alertType);
    const wrapper = document.createElement('div');
    wrapper.className = isBuilding
        ? 'shared-pin-wrapper is-building-pin'
        : `shared-pin-wrapper is-road-alert ${alertMeta.cssClass}`;

    const scaleInner = document.createElement('div');
    scaleInner.className = 'shared-pin-scale-inner';

    const labelEl = document.createElement('div');
    labelEl.className = isBuilding
        ? 'shared-pin-label is-building'
        : `shared-pin-label ${alertMeta.cssClass}`;
    if (isBuilding) {
        labelEl.textContent = `🏢 ${pin.title || '社區大樓'}`;
    } else {
        const rawTitle = (pin.title || alertMeta.defaultTitle).trim();
        labelEl.textContent = rawTitle.startsWith(alertMeta.label) || rawTitle.startsWith(`[${alertMeta.label}]`)
            ? rawTitle
            : `[${alertMeta.label}] ${rawTitle}`;
    }
    scaleInner.appendChild(labelEl);

    const teardrop = document.createElement('div');
    teardrop.className = isBuilding
        ? 'shared-pin-teardrop is-building'
        : `shared-pin-teardrop ${alertMeta.cssClass}`;
    teardrop.style.position = 'relative';

    const inner = document.createElement('div');
    inner.className = 'shared-pin-inner';

    if (isBuilding) {
        inner.innerHTML = '<i class="fa-solid fa-building text-white text-sm"></i>';
    } else if (pin.photo) {
        const img = document.createElement('img');
        img.src = pin.photo;
        img.alt = pin.title || alertMeta.defaultTitle;
        inner.appendChild(img);

        const cornerBadge = document.createElement('span');
        cornerBadge.className = 'shared-pin-type-corner';
        cornerBadge.style.backgroundColor = alertMeta.color;
        cornerBadge.innerHTML = `<i class="${alertMeta.iconClass} ${alertMeta.iconTextClass}"></i>`;
        inner.style.position = 'relative';
        inner.style.overflow = 'visible';
        inner.appendChild(cornerBadge);
    } else {
        inner.innerHTML = `<i class="${alertMeta.iconClass} ${alertMeta.iconTextClass} text-base"></i>`;
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
            // 🛋️ 家具模式下點擊社區水滴改為標註收運點，停用長按開啟社區資訊／編輯視窗
            if (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive) {
                return;
            }
            holdStartX = clientX;
            holdStartY = clientY;
            wrapper.classList.add('is-pressing');
            holdTimer = setTimeout(() => {
                holdTimer = null;
                wrapper.classList.remove('is-pressing');
                if (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive) {
                    return;
                }
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
            if (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive) {
                const targetPin = pinsLayerGroup[pin.id]?.data || pin;
                if (typeof handleFurnitureBuildingPinClick === 'function') {
                    handleFurnitureBuildingPinClick(targetPin);
                }
            }
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

    if (isBuilding && !isBuildingPinsVisible) {
        wrapper.style.setProperty('display', 'none', 'important');
    }

    return wrapper;
}

const BUILDING_PINS_VISIBLE_STORAGE_KEY = 'yingge_show_building_pins_v1';
let isBuildingPinsVisible = true;
try {
    if (localStorage.getItem(BUILDING_PINS_VISIBLE_STORAGE_KEY) === 'false') {
        isBuildingPinsVisible = false;
    }
} catch (e) {}

function applyBuildingPinsVisibilityState() {
    if (document.body) {
        document.body.classList.toggle('hide-building-pins', !isBuildingPinsVisible);
    }
    if (typeof pinsLayerGroup === 'object' && pinsLayerGroup) {
        Object.values(pinsLayerGroup).forEach((entry) => {
            if (!entry || !entry.el) return;
            const isBuilding = entry.data?.pinType === 'building' || entry.el.classList.contains('is-building-pin');
            if (!isBuilding) return;
            if (isBuildingPinsVisible) {
                entry.el.style.removeProperty('display');
            } else {
                entry.el.style.setProperty('display', 'none', 'important');
            }
        });
    }
}

window.BuildingPinManager = {
    isVisible() {
        return Boolean(isBuildingPinsVisible);
    },
    setVisible(visible) {
        isBuildingPinsVisible = Boolean(visible);
        try {
            localStorage.setItem(BUILDING_PINS_VISIBLE_STORAGE_KEY, isBuildingPinsVisible ? 'true' : 'false');
        } catch (e) {}
        applyBuildingPinsVisibilityState();
        if (typeof renderMapLayerMenuOptions === 'function') {
            renderMapLayerMenuOptions();
        }
        return isBuildingPinsVisible;
    },
    toggle() {
        const next = !isBuildingPinsVisible;
        this.setVisible(next);
        try { if (typeof vibrate === 'function') vibrate(20); } catch (e) {}
        if (typeof showNavAlert === 'function') {
            showNavAlert(
                '🏢',
                next ? '社區名稱與橘色水滴標記已顯示' : '社區名稱與橘色水滴標記已隱藏',
                next ? 'bg-orange-600' : 'bg-gray-700'
            );
        }
        return next;
    }
};

applyBuildingPinsVisibilityState();
if (typeof renderMapLayerMenuOptions === 'function') {
    renderMapLayerMenuOptions();
}

function upsertPinMarkerOnMap(pinId, pinData) {
    const lat = Number(pinData.lat);
    const lng = Number(pinData.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    const normalizedPin = { ...pinData, id: pinId, lat, lng };
    const signature = `${normalizedPin.pinType || 'dirty'}|${normalizedPin.alertType || 'other'}|${normalizedPin.status || 'active'}|${normalizedPin.expiresAt || 0}|${normalizedPin.title || ''}|${Boolean(normalizedPin.photo)}|${(normalizedPin.photo || '').length}`;

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
        } else if (normalizedPin.pinType === 'building' && pinsLayerGroup[pinId].el) {
            if (isBuildingPinsVisible) {
                pinsLayerGroup[pinId].el.style.removeProperty('display');
            } else {
                pinsLayerGroup[pinId].el.style.setProperty('display', 'none', 'important');
            }
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
        const now = Date.now();

        if (data && typeof data === 'object') {
            Object.entries(data).forEach(([key, pin]) => {
                if (!pin || typeof pin !== 'object') return;
                const pinId = pin.id || key;
                const lat = Number(pin.lat);
                const lng = Number(pin.lng);
                if (isNaN(lat) || isNaN(lng)) return;

                // 非社區大樓之路段警示套用狀態與時效過濾（已解除或已過期自動隱藏）
                if (pin.pinType !== 'building' && !isRoadAlertPinActive(pin, now)) {
                    return;
                }

                activePinIds.add(pinId);
                upsertPinMarkerOnMap(pinId, { ...pin, id: pinId });
            });
        }

        // 同步清除已被隊友銷案、已解除或已過期的地標
        Object.keys(pinsLayerGroup).forEach(pinId => {
            if (!activePinIds.has(pinId)) {
                try { pinsLayerGroup[pinId].marker.remove(); } catch (e) {}
                delete pinsLayerGroup[pinId];
                if (activeDistanceGuidePin && activeDistanceGuidePin.id === pinId) {
                    clearPinDistanceGuide();
                }
            }
        });
        updateRoadAlertMiniWidgetUI();
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
        if (isEditingMode || isManualDrawingMode || (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive) || window.ApproachNav?.isFreeNavEnabled?.()) return;
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
            if (isEditingMode || isManualDrawingMode || (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive) || window.ApproachNav?.isFreeNavEnabled?.() || !pendingLngLat) return;
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
        if (isEditingMode || isManualDrawingMode || (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive) || window.ApproachNav?.isFreeNavEnabled?.()) return;
        if (isIgnoredMarkerTarget(e.target)) return;

        startClientX = e.clientX;
        startClientY = e.clientY;
        const rect = canvasContainer.getBoundingClientRect();
        pendingLngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);

        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            if (isEditingMode || isManualDrawingMode || (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive) || window.ApproachNav?.isFreeNavEnabled?.() || !pendingLngLat) return;
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
        if (isEditingMode || isManualDrawingMode || (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive) || window.ApproachNav?.isFreeNavEnabled?.()) return;
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

function pruneExpiredRoadAlertPins() {
    const now = Date.now();
    let changed = false;
    Object.keys(pinsLayerGroup).forEach(pinId => {
        const pin = pinsLayerGroup[pinId]?.data;
        if (pin && pin.pinType !== 'building' && !isRoadAlertPinActive(pin, now)) {
            try { pinsLayerGroup[pinId].marker.remove(); } catch (e) {}
            delete pinsLayerGroup[pinId];
            if (activeDistanceGuidePin && activeDistanceGuidePin.id === pinId) {
                clearPinDistanceGuide();
            }
            changed = true;
        }
    });
    if (changed) {
        updateRoadAlertMiniWidgetUI();
    }
}

function startSharedMapPinsSystem() {
    if (mapPinsPollTimer !== null) {
        clearInterval(mapPinsPollTimer);
        mapPinsPollTimer = null;
    }
    fetchAndRenderSharedMapPins();
    mapPinsPollTimer = setInterval(() => {
        pruneExpiredRoadAlertPins();
        fetchAndRenderSharedMapPins();
    }, 20000);
}

