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

