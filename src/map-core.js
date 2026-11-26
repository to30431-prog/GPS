// ==========================================
// [Module 2/10] src/map-core.js
// MapLibre GL 初始化、6 種底圖切換、車輛補間動畫、動態縮放、文字 viewport 轉正、WebGL 自救、視角控制、語音佇列與雙層語音預警引擎
// ==========================================

// --- 1. 初始化 MapLibre GL 向量／圖磚旋轉地圖（預設採用 Google 地圖，支援 6 種免費免 Key 圖層隨時切換、localStorage 記憶偏好，向量圖層強制路名永遠水平 viewport） ---
const MAP_LAYER_STORAGE_KEY = 'selectedMapLayer';

function buildRasterMapStyle(tileUrl, layerTitle, attributionText = '© Google', maxZoom = 19, styleKey = 'default') {
    const safeKey = String(styleKey || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    const sourceId = `custom-raster-tiles-${safeKey}`;
    const layerId = `custom-raster-base-layer-${safeKey}`;
    const sourceDef = {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        attribution: attributionText
    };
    if (typeof maxZoom === 'number') {
        sourceDef.maxzoom = maxZoom;
    }
    return {
        version: 8,
        name: layerTitle,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
            [sourceId]: sourceDef
        },
        layers: [
            {
                id: layerId,
                type: 'raster',
                source: sourceId,
                minzoom: 0,
                maxzoom: 22
            }
        ]
    };
}

const MAP_LAYER_PRESETS = [
    {
        id: 'google_roadmap',
        name: 'Google 地圖（預設）',
        shortName: 'Google 地圖',
        desc: 'Google 標準街道地圖',
        icon: '🗺️',
        isVector: false,
        pureChineseOverride: false,
        getStyle: () => buildRasterMapStyle(
            'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
            'Google 地圖（預設）',
            '© Google',
            20,
            'google_roadmap'
        )
    },
    {
        id: 'google_hybrid',
        name: 'Google 衛星混合',
        shortName: 'Google 衛星',
        desc: 'Google 衛星實景＋道路門牌標記',
        icon: '🛰️',
        isVector: false,
        pureChineseOverride: false,
        getStyle: () => buildRasterMapStyle(
            'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
            'Google 衛星混合',
            '© Google',
            20,
            'google_hybrid'
        )
    },
    {
        id: 'nlsc_emap',
        name: '門牌詳細（國土測繪）',
        shortName: '門牌詳細',
        desc: '內政部國土測繪通用電子地圖',
        icon: '🏠',
        isVector: false,
        pureChineseOverride: false,
        getStyle: () => buildRasterMapStyle(
            'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',
            '門牌詳細（國土測繪）',
            '© 內政部國土測繪中心 NLSC',
            19,
            'nlsc_emap'
        )
    },
    {
        id: 'voyager',
        name: '清爽向量（路名轉正）',
        shortName: '清爽向量',
        desc: 'Carto Voyager 向量（路名永遠水平）',
        icon: '🌤️',
        isVector: true,
        pureChineseOverride: false,
        getStyle: () => 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
    },
    {
        id: 'positron',
        name: '極簡灰白（路名轉正）',
        shortName: '極簡灰白',
        desc: 'OpenFreeMap 極簡向量（路名永遠水平）',
        icon: '⚪',
        isVector: true,
        pureChineseOverride: true,
        getStyle: () => 'https://tiles.openfreemap.org/styles/positron'
    },
    {
        id: 'liberty',
        name: '標準立體（路名轉正）',
        shortName: '標準立體',
        desc: 'OpenFreeMap 立體向量（路名永遠水平）',
        icon: '🏙️',
        isVector: true,
        pureChineseOverride: true,
        getStyle: () => 'https://tiles.openfreemap.org/styles/liberty'
    }
];

function getSavedMapLayerPreset() {
    try {
        const savedId = localStorage.getItem(MAP_LAYER_STORAGE_KEY);
        if (savedId) {
            const found = MAP_LAYER_PRESETS.find(item => item.id === savedId);
            if (found) return found;
        }
    } catch (e) {}
    return MAP_LAYER_PRESETS[0]; // 未設定時一律預設載入 Google 地圖
}

let currentMapLayerPreset = getSavedMapLayerPreset();

const PURE_CHINESE_TEXT_FIELD = [
    'coalesce',
    ['get', 'name:zh-Hant'],
    ['get', 'name:zh'],
    ['get', 'name:nonlatin'],
    ['get', 'name']
];

// 記錄最後一次繪製的路線 GeoJSON 資料，確保切換任何底圖樣式 (map.setStyle) 後自動無縫重繪所有自訂路線圖層
let cachedBgRouteGeoJSON = { type: 'FeatureCollection', features: [] };
let cachedSilentRouteGeoJSON = { type: 'FeatureCollection', features: [] };
let cachedMusicRouteGeoJSON = { type: 'FeatureCollection', features: [] };
let cachedCalloutLinesGeoJSON = { type: 'FeatureCollection', features: [] };
let cachedBrushStrokesGeoJSON = { type: 'FeatureCollection', features: [] };
let cachedBrushDraftGeoJSON = { type: 'FeatureCollection', features: [] };
let cachedFurnitureOwnRouteGeoJSON = { type: 'FeatureCollection', features: [] };
let cachedFurnitureManualDraftGeoJSON = { type: 'FeatureCollection', features: [] };

// 📌 路線註記／備忘圖層顯示開關（預設開啟；控制預覽與導航模式下的畫筆記號、自訂插釘與引線備忘框）
let showRouteAnnotationsLayer = localStorage.getItem('yingge_show_route_annotations_v1') !== 'false';

function isRouteAnnotationsVisible() {
    return Boolean(showRouteAnnotationsLayer);
}

function toggleRouteAnnotationsVisibility() {
    showRouteAnnotationsLayer = !showRouteAnnotationsLayer;
    try {
        localStorage.setItem('yingge_show_route_annotations_v1', showRouteAnnotationsLayer ? 'true' : 'false');
    } catch (e) {}
    const activeRoute = (typeof getActiveWorkingRoute === 'function' ? getActiveWorkingRoute() : null)
        || (Array.isArray(savedRoutes) && selectedRouteIdx >= 0 ? savedRoutes[selectedRouteIdx] : null);
    if (activeRoute) {
        refreshCurrentRouteMarkers(activeRoute);
    } else {
        if (typeof updateRouteBrushStrokesLayer === 'function') updateRouteBrushStrokesLayer(null);
        if (typeof updateCalloutLeaderLines === 'function') updateCalloutLeaderLines(null);
    }
    if (typeof renderMapLayerMenuOptions === 'function') {
        renderMapLayerMenuOptions();
    }
    if (typeof showNavAlert === 'function') {
        showNavAlert(
            showRouteAnnotationsLayer ? '📌' : '🙈',
            showRouteAnnotationsLayer ? '已顯示路線畫筆記號、自訂插釘與備忘' : '已隱藏路線畫筆記號、自訂插釘與備忘',
            showRouteAnnotationsLayer ? 'bg-indigo-600' : 'bg-slate-700'
        );
    }
}
window.isRouteAnnotationsVisible = isRouteAnnotationsVisible;
window.toggleRouteAnnotationsVisibility = toggleRouteAnnotationsVisibility;

// 記錄外部模組綁定於 map.on(...) 與 map.getCanvasContainer().addEventListener(...) 的監聽器，
// 確保 WebGL Context Lost 真正重建 MapLibre 實例（map.remove() + new maplibregl.Map()）後自動無損重放所有互動與圖層同步事件
const recordedExternalMapOnListeners = [];
const recordedCanvasContainerListeners = [];
let isInternalMapBinding = false;
let hasBoundGlobalViewportResizeGuards = false;

function installMapInstanceListenerRecorder(targetMap) {
    if (!targetMap || targetMap.__listenerRecorderInstalled) return;
    targetMap.__listenerRecorderInstalled = true;

    const origOn = targetMap.on.bind(targetMap);
    const origOff = targetMap.off.bind(targetMap);

    targetMap.on = function patchedMapOn(type, layerOrListener, maybeListener) {
        if (!isInternalMapBinding && typeof type === 'string' && type !== 'load') {
            recordedExternalMapOnListeners.push({
                type,
                layerId: typeof layerOrListener === 'string' ? layerOrListener : null,
                listener: typeof layerOrListener === 'function' ? layerOrListener : maybeListener
            });
        }
        return maybeListener !== undefined
            ? origOn(type, layerOrListener, maybeListener)
            : origOn(type, layerOrListener);
    };

    targetMap.off = function patchedMapOff(type, layerOrListener, maybeListener) {
        const targetListener = typeof layerOrListener === 'function' ? layerOrListener : maybeListener;
        const targetLayer = typeof layerOrListener === 'string' ? layerOrListener : null;
        for (let i = recordedExternalMapOnListeners.length - 1; i >= 0; i--) {
            const entry = recordedExternalMapOnListeners[i];
            if (entry.type === type && entry.layerId === targetLayer && entry.listener === targetListener) {
                recordedExternalMapOnListeners.splice(i, 1);
            }
        }
        return maybeListener !== undefined
            ? origOff(type, layerOrListener, maybeListener)
            : origOff(type, layerOrListener);
    };

    const canvasContainer = targetMap.getCanvasContainer?.();
    if (canvasContainer && !canvasContainer.__listenerRecorderInstalled) {
        canvasContainer.__listenerRecorderInstalled = true;
        const origAdd = canvasContainer.addEventListener.bind(canvasContainer);
        const origRemove = canvasContainer.removeEventListener.bind(canvasContainer);

        canvasContainer.addEventListener = function patchedCanvasAdd(type, listener, options) {
            if (!isInternalMapBinding && typeof type === 'string' && typeof listener === 'function') {
                const exists = recordedCanvasContainerListeners.some(
                    entry => entry.type === type && entry.listener === listener
                );
                if (!exists) {
                    recordedCanvasContainerListeners.push({ type, listener, options });
                }
            }
            return origAdd(type, listener, options);
        };

        canvasContainer.removeEventListener = function patchedCanvasRemove(type, listener, options) {
            for (let i = recordedCanvasContainerListeners.length - 1; i >= 0; i--) {
                const entry = recordedCanvasContainerListeners[i];
                if (entry.type === type && entry.listener === listener) {
                    recordedCanvasContainerListeners.splice(i, 1);
                }
            }
            return origRemove(type, listener, options);
        };
    }
}

function replayExternalListenersToMapInstance(targetMap) {
    if (!targetMap) return;
    isInternalMapBinding = true;
    try {
        recordedExternalMapOnListeners.forEach(entry => {
            if (!entry || !entry.type || typeof entry.listener !== 'function') return;
            try {
                if (entry.layerId) {
                    targetMap.on(entry.type, entry.layerId, entry.listener);
                } else {
                    targetMap.on(entry.type, entry.listener);
                }
            } catch (e) {}
        });
        const canvasContainer = targetMap.getCanvasContainer?.();
        if (canvasContainer) {
            recordedCanvasContainerListeners.forEach(entry => {
                if (!entry || !entry.type || typeof entry.listener !== 'function') return;
                try {
                    canvasContainer.addEventListener(entry.type, entry.listener, entry.options);
                } catch (e) {}
            });
        }
    } finally {
        isInternalMapBinding = false;
    }
}

function bindCoreMapInstanceListeners(targetMap) {
    if (!targetMap) return;
    isInternalMapBinding = true;
    try {
        // 攔截 MapLibre GL 背景圖磚／字型請求瞬斷或取消時的預設 console.error，避免離線或切換視窗時拋出未處理的 Failed to fetch
        targetMap.on('error', (e) => {
            const errMsg = String(e?.error?.message || e?.message || '');
            if (
                errMsg.includes('Failed to fetch') ||
                errMsg.includes('AbortError') ||
                errMsg.includes('Load failed') ||
                errMsg.includes('NetworkError')
            ) {
                return;
            }
            console.warn('[MapLibre Warning]', errMsg || e);
        });

        targetMap.on('zoom', updateMapMarkersZoomScale);
        targetMap.on('load', updateMapMarkersZoomScale);

        targetMap.on('rotate', () => {
            const activeHeading = (typeof vehicleVisualHeading === 'number' && !isNaN(vehicleVisualHeading))
                ? vehicleVisualHeading
                : currentHeading;
            window.syncCarHeading?.(activeHeading, map ? map.getBearing() : 0);
            window.syncAllFleetMarkersHeading?.(true);
        });

        targetMap.on('style.load', () => {
            restoreCustomLayersAndAlignmentAfterStyleLoad();
        });

        ['dragstart', 'touchstart', 'wheel', 'rotatestart', 'pitchstart'].forEach(evt => {
            targetMap.on(evt, (e) => { if (e.originalEvent) setCameraFollow(false); });
        });
    } finally {
        isInternalMapBinding = false;
    }
}

let mapInstanceCreatedAt = Date.now();
let map = new maplibregl.Map({
    container: 'map',
    style: currentMapLayerPreset.getStyle(),
    center: [121.346, 24.954],
    zoom: 16, maxZoom: 21, bearing: 0, pitch: 0, dragRotate: true, touchZoomRotate: true
});
installMapInstanceListenerRecorder(map);
bindCoreMapInstanceListeners(map);

function updateMapMarkersZoomScale() {
    if (!map) return;
    const currentZoom = map.getZoom();
    const mapEl = map.getContainer();
    if (!mapEl) return;

    // 1. ⚠️ 警告膠囊、🎵 音樂開關與黃色引線備忘框：依 zoom 等比例縮小（下限 0.55 倍）
    const rawScale = Math.max(0.55, Math.min(1, Math.pow(1.25, currentZoom - 15.5)));
    mapEl.style.setProperty('--map-pin-scale', rawScale.toFixed(3));

    // 1.5 📸 測速照相標記：依 zoom 動態放大／縮小（下限 0.55 倍、上限 1.35 倍）
    const speedCamScale = Math.max(0.55, Math.min(1.35, Math.pow(1.22, currentZoom - 15.5)));
    mapEl.style.setProperty('--speed-cam-scale', speedCamScale.toFixed(3));

    // 2. 🏢 社區大樓三段式隨 zoom 變形 (zoom < 14.2 遠景小圓點 / 14.2~15.6 中景 0.65x 水滴無標籤 / >= 15.6 近景完整顯示)
    let tierClass = 'zoom-tier-near';
    if (currentZoom < 14.2) {
        tierClass = 'zoom-tier-far';
    } else if (currentZoom < 15.6) {
        tierClass = 'zoom-tier-mid';
    }
    if (!mapEl.classList.contains(tierClass)) {
        mapEl.classList.remove('zoom-tier-far', 'zoom-tier-mid', 'zoom-tier-near');
        mapEl.classList.add(tierClass);
    }
}
updateMapMarkersZoomScale();

setTimeout(() => { if (map) { map.resize(); updateMapMarkersZoomScale(); } }, 500);
window.addEventListener('resize', () => { if (map) map.resize(); });

if (typeof injectCarAnimations === 'function') {
    injectCarAnimations();
}

const puckEl = document.createElement('div');
puckEl.id = 'my-puck';
puckEl.className = 'nav-puck my-car-marker';
puckEl.style.cursor = 'pointer';
puckEl.style.pointerEvents = 'auto';
puckEl.title = '點擊切換車款';

let isMyVehicleMovingAnim = false;
let vehicleMarker = null;
let lastRecordedSpeedKmh = 0;
let vehicleAnimFrameId = null;
let vehicleVisualLngLat = [...lastKnownLngLat];
let vehicleVisualHeading = currentHeading;

function renderMyVehicleCarSvg() {
    if (typeof getCarSvg === 'function' && typeof getMyCarType === 'function') {
        puckEl.innerHTML = getCarSvg(getMyCarType(), isMyVehicleMovingAnim);
    }
    const svgEl = puckEl.querySelector('svg');
    if (svgEl) {
        svgEl.style.width = '100%';
        svgEl.style.height = '100%';
        svgEl.style.display = 'block';
    }
    window.syncCarMovingState?.(isMyVehicleMovingAnim);
    const activeHeading = (typeof vehicleVisualHeading === 'number' && !isNaN(vehicleVisualHeading))
        ? vehicleVisualHeading
        : currentHeading;
    const currentBearing = (typeof map !== 'undefined' && map && typeof map.getBearing === 'function')
        ? map.getBearing()
        : 0;
    window.syncCarHeading?.(activeHeading, currentBearing);
}

function setMyVehicleMovingState(isMoving) {
    const nextState = Boolean(isMoving);
    isMyVehicleMovingAnim = nextState;
    const animSvg = puckEl.querySelector('.vehicle-anim');
    if (animSvg) {
        animSvg.classList.toggle('is-moving', nextState);
    }
    window.syncCarMovingState?.(nextState);
}

renderMyVehicleCarSvg();

// 🚗 確保本機車輛標記永遠已建立、可見且掛載於目前最新的 MapLibre map 實例上（防止實例重建或冷啟動競態導致車輛消失）
function ensureVehicleMarkerOnMap(lngLatOverride = null, headingOverride = null) {
    if (!map) return null;
    const targetLngLat = (Array.isArray(lngLatOverride) && lngLatOverride.length >= 2 && Number.isFinite(lngLatOverride[0]) && Number.isFinite(lngLatOverride[1]))
        ? [lngLatOverride[0], lngLatOverride[1]]
        : ((Array.isArray(vehicleVisualLngLat) && vehicleVisualLngLat.length >= 2 && Number.isFinite(vehicleVisualLngLat[0]) && Number.isFinite(vehicleVisualLngLat[1]))
            ? [vehicleVisualLngLat[0], vehicleVisualLngLat[1]]
            : ((Array.isArray(lastKnownLngLat) && lastKnownLngLat.length >= 2) ? [lastKnownLngLat[0], lastKnownLngLat[1]] : [121.346, 24.954]));
    const targetHeading = (typeof headingOverride === 'number' && !isNaN(headingOverride))
        ? headingOverride
        : ((typeof vehicleVisualHeading === 'number' && !isNaN(vehicleVisualHeading)) ? vehicleVisualHeading : currentHeading);

    if (!puckEl.innerHTML || !puckEl.innerHTML.trim()) {
        renderMyVehicleCarSvg();
    }
    puckEl.style.display = 'flex';
    puckEl.style.opacity = '1';
    puckEl.style.visibility = 'visible';
    puckEl.style.zIndex = '35';

    if (!vehicleMarker) {
        vehicleMarker = new maplibregl.Marker({ element: puckEl, rotationAlignment: 'viewport', pitchAlignment: 'viewport' })
            .setLngLat(targetLngLat)
            .setRotation(0)
            .addTo(map);
        vehicleMarker.setRotation = function (headingDeg) {
            const h = (typeof headingDeg === 'number' && !isNaN(headingDeg)) ? headingDeg : currentHeading;
            window.syncCarHeading?.(h, map ? map.getBearing() : 0);
            return this;
        };
    } else {
        const el = vehicleMarker.getElement?.();
        if (!el || !el.isConnected || vehicleMarker._map !== map) {
            try { vehicleMarker.addTo(map); } catch (e) {}
        }
        try { vehicleMarker.setLngLat(targetLngLat); } catch (e) {}
    }

    vehicleVisualLngLat = [...targetLngLat];
    vehicleVisualHeading = targetHeading;
    window.syncCarHeading?.(targetHeading, map ? map.getBearing() : 0);
    return vehicleMarker;
}

// 頁面初始化即掛載車輛標記，不等候 map.once('load')，避免冷啟動或前景重建競態導致 vehicleMarker 為 null
ensureVehicleMarkerOnMap();

// 🚗 點擊自己車輛 Marker 彈出橫向「換車選單」（選單內動態展示烏龜划水與千陽號破浪）
function closeCarModelPickerMenu() {
    const overlay = document.getElementById('carModelPickerOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function openCarModelPickerMenu() {
    if (typeof window.CAR_MODELS !== 'object' || !window.CAR_MODELS) return;
    if (typeof injectCarAnimations === 'function') injectCarAnimations();

    let overlay = document.getElementById('carModelPickerOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'carModelPickerOverlay';
        overlay.className = 'fixed inset-0 z-[100001] bg-black/45 backdrop-blur-[2px] flex items-end justify-center pb-24 px-3 pointer-events-auto';
        overlay.innerHTML = `
            <div id="carModelPickerSheet" class="w-full max-w-md bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl border-2 border-amber-300 p-3.5">
                <div class="flex items-center justify-between mb-2.5 px-1">
                    <div class="flex items-center gap-1.5">
                        <span class="text-base">🚗</span>
                        <span class="text-sm font-black text-slate-900">切換專屬車款</span>
                        <span class="text-[10px] font-bold text-slate-400">全車隊雷達同步顯示</span>
                    </div>
                    <button type="button" id="btnCloseCarModelPicker" class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center active:scale-90">
                        <i class="fa-solid fa-xmark text-xs"></i>
                    </button>
                </div>
                <div id="carModelPickerList" class="flex items-stretch gap-2.5 overflow-x-auto pb-1.5 pt-0.5 px-0.5 snap-x"></div>
            </div>
        `;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeCarModelPickerMenu();
        });
        document.body.appendChild(overlay);
        overlay.querySelector('#btnCloseCarModelPicker')?.addEventListener('click', (e) => {
            e.stopPropagation();
            closeCarModelPickerMenu();
        });
    }

    const listEl = overlay.querySelector('#carModelPickerList');
    const currentId = typeof getMyCarType === 'function' ? getMyCarType() : 'garbage_yellow';
    if (listEl) {
        listEl.innerHTML = '';
        Object.values(window.CAR_MODELS).forEach(model => {
            const isSelected = model.id === currentId;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = isSelected
                ? 'flex-shrink-0 w-[86px] snap-center flex flex-col items-center justify-between gap-1.5 p-2 rounded-2xl bg-amber-50 border-2 border-amber-500 shadow-md active:scale-95 transition-all'
                : 'flex-shrink-0 w-[86px] snap-center flex flex-col items-center justify-between gap-1.5 p-2 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 active:scale-95 transition-all';
            btn.innerHTML = `
                <div class="w-12 h-16 flex items-center justify-center pointer-events-none">
                    ${getCarSvg(model.id, true)}
                </div>
                <div class="text-[11px] font-black leading-tight text-center ${isSelected ? 'text-amber-800' : 'text-slate-700'} truncate w-full">${model.name}</div>
            `;
            const previewSvg = btn.querySelector('svg');
            if (previewSvg) {
                previewSvg.style.width = '100%';
                previewSvg.style.height = '100%';
            }
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof setMyCarType === 'function') setMyCarType(model.id);
                renderMyVehicleCarSvg();
                ensureVehicleMarkerOnMap();
                try { navigator.vibrate?.(25); } catch (_) {}
                if (typeof window.broadcastRadarNow === 'function') {
                    window.broadcastRadarNow();
                }
                closeCarModelPickerMenu();
                if (typeof showMapRefreshToast === 'function') {
                    showMapRefreshToast(`🚗 已切換為「${model.name}」並同步車隊雷達`, 2000);
                }
            });
            listEl.appendChild(btn);
        });
    }

    overlay.classList.remove('hidden');
}

puckEl.addEventListener('click', (e) => {
    e.stopPropagation();
    openCarModelPickerMenu();
});

window.setMyVehicleMovingState = setMyVehicleMovingState;
window.renderMyVehicleCarSvg = renderMyVehicleCarSvg;
window.openCarModelPickerMenu = openCarModelPickerMenu;
window.closeCarModelPickerMenu = closeCarModelPickerMenu;

// ==========================================
// 🏎️ 車輛 Marker 補間動畫（requestAnimationFrame 平滑位移與轉向，消除一秒跳一格瞬移感）
// ==========================================
function smoothMoveVehicleMarker(targetLngLat, targetHeading, durationMs = 750) {
    // 🛡️ 重播期間嚴禁真實 GPS 補間動畫介入移動黃色垃圾車 Marker
    if (isReplaying) {
        if (vehicleAnimFrameId !== null) {
            cancelAnimationFrame(vehicleAnimFrameId);
            vehicleAnimFrameId = null;
        }
        return;
    }
    if (!Array.isArray(targetLngLat) || targetLngLat.length < 2) return;
    if (!vehicleMarker || !vehicleMarker.getElement?.()?.isConnected || vehicleMarker._map !== map) {
        ensureVehicleMarkerOnMap(targetLngLat, targetHeading);
    }
    if (!vehicleMarker) return;
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
        vehicleMarker.setLngLat(vehicleVisualLngLat);
        window.syncCarHeading?.(vehicleVisualHeading, map ? map.getBearing() : 0);
        return;
    }

    const deltaHeading = getAngleDiff(startHeading, endHeading);
    const startTimePerf = performance.now();

    function stepFrame(nowPerf) {
        if (isReplaying) {
            vehicleAnimFrameId = null;
            return;
        }
        const elapsed = nowPerf - startTimePerf;
        const t = Math.min(Math.max(elapsed / durationMs, 0), 1);
        const curLng = startLng + (endLng - startLng) * t;
        const curLat = startLat + (endLat - startLat) * t;
        const curHead = (startHeading + deltaHeading * t + 360) % 360;

        vehicleVisualLngLat = [curLng, curLat];
        vehicleVisualHeading = curHead;
        if (vehicleMarker) {
            vehicleMarker.setLngLat(vehicleVisualLngLat);
        }
        window.syncCarHeading?.(vehicleVisualHeading, map ? map.getBearing() : 0);

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
// - 時速 < 20 km/h（低速／巷弄區間）：較原級別再放大 +1.0（預設低速 Zoom 18.5，巷弄慢行／遵循導航低速最高平滑放大至 Zoom 19.5）
// - 時速 20~60 km/h：線性平滑過渡
// - 自動縮放上限放寬至 DYNAMIC_ZOOM_MAX_LIMIT = 19.5（地圖 maxZoom = 21）
// - 若管理員關閉「車速動態縮放」，則維持當前地圖縮放倍率不自動變動
// ==========================================
const DYNAMIC_ZOOM_MAX_LIMIT = 19.5;

function getDynamicZoomBySpeed(speedKmh) {
    const spd = typeof speedKmh === 'number' && !isNaN(speedKmh) ? Math.max(0, speedKmh) : 0;
    lastRecordedSpeedKmh = spd;

    const rawCfgLow = Number(systemNavConfig.lowSpeedZoom) || DEFAULT_SYSTEM_CONFIG.lowSpeedZoom;
    const lowZoom = Math.min(DYNAMIC_ZOOM_MAX_LIMIT, rawCfgLow === 17.5 ? 18.5 : rawCfgLow);
    const alleyMaxZoom = Math.min(DYNAMIC_ZOOM_MAX_LIMIT, lowZoom + 1.0);
    const highZoom = Number(systemNavConfig.highSpeedZoom) || DEFAULT_SYSTEM_CONFIG.highSpeedZoom;

    if (!systemNavConfig.enableDynamicZoom) {
        return map ? map.getZoom() : lowZoom;
    }

    if (spd >= 60) {
        return Number(highZoom.toFixed(2));
    }
    if (spd <= 20) {
        // 低速／巷弄區間（0 ~ 20 km/h）：遵循導航或 <= 10 km/h 巷弄慢行放大至 alleyMaxZoom (19.5)，10~20 km/h 平滑過渡至 lowZoom (18.5)
        const isActiveFollowNav = (typeof followWatchId !== 'undefined' && followWatchId !== null);
        if (spd <= 10) {
            return Number((isActiveFollowNav ? alleyMaxZoom : Math.min(DYNAMIC_ZOOM_MAX_LIMIT, lowZoom + 0.5)).toFixed(2));
        }
        const alleyFactor = (20 - spd) / 10; // 10km/h -> 1, 20km/h -> 0
        const peakLowZoom = isActiveFollowNav ? alleyMaxZoom : Math.min(DYNAMIC_ZOOM_MAX_LIMIT, lowZoom + 0.5);
        return Number((lowZoom + (peakLowZoom - lowZoom) * alleyFactor).toFixed(2));
    }
    // 20 ~ 60 km/h：由 lowZoom (18.5) 線性平滑過渡至 highZoom (14.5)
    const midFactor = (spd - 20) / 40;
    return Number((lowZoom + (highZoom - lowZoom) * midFactor).toFixed(2));
}

// ==========================================
// 🛣️ 自訂路線圖層（保留「音樂開（綠色）／音樂關（藍色）／已行駛（半透明淺灰）」分段顏色與俐落外框邊線 line-casing）
// 支援在任何底圖切換 (map.setStyle) 後自動重建並無縫還原所有路線與標記資料
// ==========================================
function ensureCustomRouteSourcesAndLayers() {
    if (!map) return;
    try {
        const currentStyle = map.getStyle();
        if (!currentStyle) return;
    } catch (e) {
        return;
    }

    try {
        // 0. 在 OpenFreeMap (openmaptiles) 樣式上補齊放大時的門牌號碼圖層 (housenumber-label)
        if (map.getSource('openmaptiles') && !map.getLayer('housenumber-label')) {
            map.addLayer({
                id: 'housenumber-label',
                type: 'symbol',
                source: 'openmaptiles',
                'source-layer': 'housenumber',
                minzoom: 17,
                layout: {
                    'text-rotation-alignment': 'viewport',
                    'icon-rotation-alignment': 'viewport',
                    'text-pitch-alignment': 'viewport',
                    'icon-pitch-alignment': 'viewport',
                    'text-keep-upright': true,
                    'text-field': '{housenumber}',
                    'text-font': ['Noto Sans Regular'],
                    'text-size': 10.5,
                    'text-padding': 4
                },
                paint: {
                    'text-color': '#64748b',
                    'text-halo-color': 'rgba(255,255,255,0.95)',
                    'text-halo-width': 1.8
                }
            });
        }

        // 1. 已行駛路段（半透明淺灰色 + 柔和外框）
        if (!map.getSource('bg-route')) {
            map.addSource('bg-route', { type: 'geojson', data: cachedBgRouteGeoJSON || emptyGeoJSON() });
        }
        if (!map.getLayer('bg-route-casing')) {
            map.addLayer({
                id: 'bg-route-casing',
                type: 'line',
                source: 'bg-route',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 9,
                    'line-opacity': 0.5,
                    'line-blur': 0.5
                }
            });
        }
        if (!map.getLayer('bg-route-line')) {
            map.addLayer({
                id: 'bg-route-line',
                type: 'line',
                source: 'bg-route',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#94a3b8',
                    'line-width': 6,
                    'line-opacity': 0.45
                }
            });
        }

        // 2. 音樂關閉路段（藍色虛線 + 俐落外框邊線 line-casing）
        if (!map.getSource('route-Silent')) {
            map.addSource('route-Silent', { type: 'geojson', data: cachedSilentRouteGeoJSON || emptyGeoJSON() });
        }
        if (!map.getLayer('route-silent-casing')) {
            map.addLayer({
                id: 'route-silent-casing',
                type: 'line',
                source: 'route-Silent',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 9,
                    'line-opacity': 0.85,
                    'line-blur': 0.5
                }
            });
        }
        if (!map.getLayer('route-silent-line')) {
            map.addLayer({
                id: 'route-silent-line',
                type: 'line',
                source: 'route-Silent',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#3b82f6',
                    'line-width': 6,
                    'line-dasharray': [2, 2]
                }
            });
        }

        // 3. 音樂開啟清運路段（綠色實線 + 俐落外框邊線 line-casing）
        if (!map.getSource('route-music')) {
            map.addSource('route-music', { type: 'geojson', data: cachedMusicRouteGeoJSON || emptyGeoJSON() });
        }
        if (!map.getLayer('route-music-casing')) {
            map.addLayer({
                id: 'route-music-casing',
                type: 'line',
                source: 'route-music',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 10.5,
                    'line-opacity': 0.9,
                    'line-blur': 0.5
                }
            });
        }
        if (!map.getLayer('route-music-line')) {
            map.addLayer({
                id: 'route-music-line',
                type: 'line',
                source: 'route-music',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#16a34a',
                    'line-width': 7
                }
            });
        }

        // 4. 📌 引線備忘框高對比引線圖層（含白色外框與主題顏色引線）
        if (!map.getSource('callout-lines-source')) {
            map.addSource('callout-lines-source', {
                type: 'geojson',
                data: cachedCalloutLinesGeoJSON || emptyGeoJSON()
            });
        }
        if (!map.getLayer('callout-lines-casing')) {
            map.addLayer({
                id: 'callout-lines-casing',
                type: 'line',
                source: 'callout-lines-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 6.5,
                    'line-opacity': 0.92
                }
            });
        }
        if (!map.getLayer('callout-lines-layer')) {
            map.addLayer({
                id: 'callout-lines-layer',
                type: 'line',
                source: 'callout-lines-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': ['coalesce', ['get', 'color'], '#d97706'],
                    'line-width': 3.5,
                    'line-dasharray': [2, 1.2],
                    'line-opacity': 0.98
                }
            });
        }

        // 4.5 ✏️ 路線畫筆記號圖層（獨立儲存於路線 brushStrokes，不影響清運主軌跡與距離）
        if (!map.getSource('route-brush-strokes-source')) {
            map.addSource('route-brush-strokes-source', {
                type: 'geojson',
                data: cachedBrushStrokesGeoJSON || emptyGeoJSON()
            });
        }
        if (!map.getLayer('route-brush-strokes-casing')) {
            map.addLayer({
                id: 'route-brush-strokes-casing',
                type: 'line',
                source: 'route-brush-strokes-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': ['case', ['==', ['get', 'color'], '#ffffff'], '#0f172a', '#ffffff'],
                    'line-width': 8.5,
                    'line-opacity': 0.92
                }
            });
        }
        if (!map.getLayer('route-brush-strokes-layer')) {
            map.addLayer({
                id: 'route-brush-strokes-layer',
                type: 'line',
                source: 'route-brush-strokes-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': ['coalesce', ['get', 'color'], '#ef4444'],
                    'line-width': ['coalesce', ['get', 'width'], 5],
                    'line-opacity': 0.98
                }
            });
        }

        if (!map.getSource('route-brush-draft-source')) {
            map.addSource('route-brush-draft-source', {
                type: 'geojson',
                data: cachedBrushDraftGeoJSON || emptyGeoJSON()
            });
        }
        if (!map.getLayer('route-brush-draft-casing')) {
            map.addLayer({
                id: 'route-brush-draft-casing',
                type: 'line',
                source: 'route-brush-draft-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': ['case', ['==', ['get', 'color'], '#ffffff'], '#0f172a', '#ffffff'],
                    'line-width': 8.5,
                    'line-opacity': 0.92
                }
            });
        }
        if (!map.getLayer('route-brush-draft-layer')) {
            map.addLayer({
                id: 'route-brush-draft-layer',
                type: 'line',
                source: 'route-brush-draft-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': ['coalesce', ['get', 'color'], '#ef4444'],
                    'line-width': 5,
                    'line-dasharray': [1.8, 1.2],
                    'line-opacity': 0.98
                }
            });
        }

        if (!map.getSource('freehand-temp-source')) {
            map.addSource('freehand-temp-source', {
                type: 'geojson',
                data: (typeof freehandDraftCoords !== 'undefined' && Array.isArray(freehandDraftCoords) && freehandDraftCoords.length >= 2)
                    ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: freehandDraftCoords } }] }
                    : emptyGeoJSON()
            });
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

        if (!map.getSource('custom-route-symbols')) {
            map.addSource('custom-route-symbols', { type: 'geojson', data: emptyGeoJSON() });
        }
        if (!map.getLayer('custom-route-symbols-layer')) {
            map.addLayer({
                id: 'custom-route-symbols-layer',
                type: 'symbol',
                source: 'custom-route-symbols',
                layout: {
                    'text-rotation-alignment': 'viewport',
                    'icon-rotation-alignment': 'viewport',
                    'text-pitch-alignment': 'viewport',
                    'icon-pitch-alignment': 'viewport',
                    'text-keep-upright': true,
                    'text-field': ['get', 'label'],
                    'text-font': ['Noto Sans Regular'],
                    'text-size': 12,
                    'text-offset': [0, 1.2]
                },
                paint: {
                    'text-color': '#0f172a',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2
                }
            });
        }

        // 5. 🛋️ 家具模式專屬圖層（共用主路線＋手動拉線草稿）
        if (!map.getSource('furniture-own-route-source')) {
            map.addSource('furniture-own-route-source', {
                type: 'geojson',
                data: cachedFurnitureOwnRouteGeoJSON || emptyGeoJSON()
            });
        }
        if (!map.getLayer('furniture-own-route-casing')) {
            map.addLayer({
                id: 'furniture-own-route-casing',
                type: 'line',
                source: 'furniture-own-route-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 11,
                    'line-opacity': 0.92
                }
            });
        }
        if (!map.getLayer('furniture-own-route-line')) {
            map.addLayer({
                id: 'furniture-own-route-line',
                type: 'line',
                source: 'furniture-own-route-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': ['coalesce', ['get', 'color'], '#9333ea'],
                    'line-width': 7,
                    'line-opacity': 0.96
                }
            });
        }

        if (!map.getSource('furniture-manual-draft-source')) {
            map.addSource('furniture-manual-draft-source', {
                type: 'geojson',
                data: cachedFurnitureManualDraftGeoJSON || emptyGeoJSON()
            });
        }
        if (!map.getLayer('furniture-manual-draft-layer')) {
            map.addLayer({
                id: 'furniture-manual-draft-layer',
                type: 'line',
                source: 'furniture-manual-draft-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#f97316',
                    'line-width': 5.5,
                    'line-dasharray': [2, 1.2],
                    'line-opacity': 0.95
                }
            });
        }

        if (typeof activeDistanceGuidePin !== 'undefined' && activeDistanceGuidePin && typeof updatePinDistanceGuideRender === 'function') {
            updatePinDistanceGuideRender();
        }
    } catch (e) {
        console.warn('建立自訂路線圖層時發生例外:', e);
    }
}

// ==========================================
// 🗺️ 地圖路名、地名、地標文字與自訂符號圖層永遠與手機螢幕水平對齊 (viewport + text-keep-upright: true)
// ==========================================
function fixSymbolTextAlignment() {
    try {
        const style = map.getStyle();
        if (!style || !style.layers) return;
        const usePureChinese = Boolean(currentMapLayerPreset?.pureChineseOverride);

        style.layers.forEach(layer => {
            if (layer.type === 'symbol') {
                const lid = String(layer.id || '');

                if (usePureChinese && lid.includes('shield')) {
                    try {
                        map.setLayoutProperty(lid, 'visibility', 'none');
                    } catch (e) {}
                    return;
                }

                try {
                    map.setLayoutProperty(lid, 'text-rotation-alignment', 'viewport');
                    map.setLayoutProperty(lid, 'icon-rotation-alignment', 'viewport');
                    map.setLayoutProperty(lid, 'text-pitch-alignment', 'viewport');
                    map.setLayoutProperty(lid, 'icon-pitch-alignment', 'viewport');
                    map.setLayoutProperty(lid, 'text-keep-upright', true);
                } catch (e) {}

                if (
                    usePureChinese &&
                    lid !== 'custom-route-symbols-layer' &&
                    lid !== 'housenumber-label' &&
                    !lid.includes('one_way_arrow') &&
                    layer.layout &&
                    layer.layout['text-field']
                ) {
                    try {
                        map.setLayoutProperty(lid, 'text-field', PURE_CHINESE_TEXT_FIELD);
                    } catch (e) {}
                }
            }
        });
    } catch (e) {
        console.error("修正字體對齊時發生錯誤:", e);
    }
}

// 確保所有 DOM Marker（黃色垃圾車、橘黃色警示膠囊、起終點、隊友雷達、共享地標、編輯節點、家具插針）在底圖切換或前景回切後完整保留且座標不偏移
function ensureDomMarkersIntactAfterStyleSwitch() {
    try {
        ensureVehicleMarkerOnMap();
        const reconnectMarkerList = (list) => {
            if (!Array.isArray(list)) return;
            list.forEach(m => {
                if (m && typeof m.getElement === 'function') {
                    const el = m.getElement();
                    if (el && !el.isConnected) m.addTo(map);
                    else if (typeof m.getLngLat === 'function') m.setLngLat(m.getLngLat());
                }
            });
        };
        if (typeof domMarkers !== 'undefined') reconnectMarkerList(domMarkers);
        if (typeof pathEditMarkers !== 'undefined') reconnectMarkerList(pathEditMarkers);
        if (typeof editNodeMarkers !== 'undefined') reconnectMarkerList(editNodeMarkers);
        if (typeof manualDrawMarkers !== 'undefined') reconnectMarkerList(manualDrawMarkers);
        if (typeof furnitureDomMarkers !== 'undefined') reconnectMarkerList(furnitureDomMarkers);

        if (typeof fleetLayerGroup === 'object' && fleetLayerGroup) {
            if (typeof pruneOfflineFleetMarkers === 'function') {
                pruneOfflineFleetMarkers(Date.now());
            }
            Object.values(fleetLayerGroup).forEach(entry => {
                const m = entry?.marker;
                if (m && typeof m.getElement === 'function') {
                    const el = m.getElement();
                    if (el && !el.isConnected) m.addTo(map);
                    else if (typeof m.getLngLat === 'function') m.setLngLat(m.getLngLat());
                }
            });
        }
        if (typeof pinsLayerGroup === 'object' && pinsLayerGroup) {
            Object.values(pinsLayerGroup).forEach(entry => {
                const m = entry?.marker;
                if (m && typeof m.getElement === 'function') {
                    const el = m.getElement();
                    if (el && !el.isConnected) m.addTo(map);
                    else if (typeof m.getLngLat === 'function') m.setLngLat(m.getLngLat());
                }
            });
        }
        if (window.SpeedCameraManager && typeof window.SpeedCameraManager.ensureMarkersIntact === 'function') {
            window.SpeedCameraManager.ensureMarkersIntact();
        }

        const singleMarkers = [
            typeof furnitureSearchPreviewMarker !== 'undefined' ? furnitureSearchPreviewMarker : null,
            typeof activeFurniturePopupMarker !== 'undefined' ? activeFurniturePopupMarker : null,
            typeof activeAlertPopupMarker !== 'undefined' ? activeAlertPopupMarker : null,
            typeof activeNodeTrimBubbleMarker !== 'undefined' ? activeNodeTrimBubbleMarker : null,
            typeof pendingCalloutAnchorMarker !== 'undefined' ? pendingCalloutAnchorMarker : null,
            typeof tempMarkerA !== 'undefined' ? tempMarkerA : null,
            typeof pinDistanceLineMarker !== 'undefined' ? pinDistanceLineMarker : null
        ];
        singleMarkers.forEach(m => {
            if (m && typeof m.getElement === 'function') {
                const el = m.getElement();
                if (el && !el.isConnected) m.addTo(map);
                else if (typeof m.getLngLat === 'function') m.setLngLat(m.getLngLat());
            }
        });
    } catch (e) {}
}

let isRestoringCustomStyleLayers = false;
function restoreCustomLayersAndAlignmentAfterStyleLoad() {
    if (isRestoringCustomStyleLayers) return;
    isRestoringCustomStyleLayers = true;
    try {
        ensureCustomRouteSourcesAndLayers();
        map.getSource('bg-route')?.setData(cachedBgRouteGeoJSON || emptyGeoJSON());
        map.getSource('route-Silent')?.setData(cachedSilentRouteGeoJSON || emptyGeoJSON());
        map.getSource('route-music')?.setData(cachedMusicRouteGeoJSON || emptyGeoJSON());
        map.getSource('callout-lines-source')?.setData(cachedCalloutLinesGeoJSON || emptyGeoJSON());
        map.getSource('route-brush-strokes-source')?.setData(cachedBrushStrokesGeoJSON || emptyGeoJSON());
        map.getSource('route-brush-draft-source')?.setData(cachedBrushDraftGeoJSON || emptyGeoJSON());
        map.getSource('furniture-own-route-source')?.setData(cachedFurnitureOwnRouteGeoJSON || emptyGeoJSON());
        map.getSource('furniture-manual-draft-source')?.setData(cachedFurnitureManualDraftGeoJSON || emptyGeoJSON());
        if (currentMapLayerPreset?.isVector) {
            fixSymbolTextAlignment();
        }
        ensureDomMarkersIntactAfterStyleSwitch();
        if (typeof renderAllFurnitureMapElements === 'function') {
            renderAllFurnitureMapElements();
        }
    } finally {
        isRestoringCustomStyleLayers = false;
    }
}

// ==========================================
// 🛡️ WebGL Context Lost 偵測、前景恢復重繪與真正 MapLibre 實例重建引擎
// ==========================================
let isMapWebglContextLost = false;
let isRebuildingMapInstance = false;
let mapRebuildSafetyUnlockTimer = null;
let mapRefreshToastTimer = null;
let mapWakeupResizeTimer = null;
let mapWakeupSecondaryTimer = null;
let mapViewportResizeTimer = null;

function showMapRefreshToast(message, durationMs = 2300) {
    let banner = document.getElementById('mapRefreshToastBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'mapRefreshToastBanner';
        banner.className = 'fixed top-20 left-1/2 -translate-x-1/2 bg-slate-900/92 backdrop-blur-md text-white text-xs font-extrabold px-4 py-2 rounded-full shadow-2xl border border-sky-400/40 pointer-events-none whitespace-nowrap z-[99999] transition-opacity duration-200';
        document.body.appendChild(banner);
    }
    if (mapRefreshToastTimer) {
        clearTimeout(mapRefreshToastTimer);
        mapRefreshToastTimer = null;
    }
    banner.textContent = message;
    banner.classList.remove('hidden');
    mapRefreshToastTimer = setTimeout(() => {
        banner.classList.add('hidden');
        mapRefreshToastTimer = null;
    }, durationMs);
}

function isMapWebglContextBroken() {
    if (isMapWebglContextLost) return true;
    try {
        if (!map) return true;
        const canvas = map.getCanvas?.();
        if (!canvas || !canvas.isConnected || canvas.width === 0 || canvas.height === 0) return true;
        const gl = map?.painter?.context?.gl;
        if (!gl) return true;
        if (typeof gl.isContextLost === 'function' && gl.isContextLost()) {
            return true;
        }
    } catch (e) {
        return true;
    }
    return false;
}

function isMapBaseStyleAbnormal() {
    if (!map) return true;
    if (isMapWebglContextBroken()) return true;
    // 實例剛建立 2.5 秒內正處於正常初始載入期，避免 pageshow/focus 誤判 isStyleLoaded()=false 而打斷首次載入
    if ((Date.now() - mapInstanceCreatedAt) < 2500) return false;
    try {
        if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) return true;
        const style = map.getStyle?.();
        if (!style || !Array.isArray(style.layers) || style.layers.length === 0) return true;
        const hasBaseSource = style.sources && Object.keys(style.sources).length > 0;
        if (!hasBaseSource) return true;
    } catch (e) {
        return true;
    }
    return false;
}

let lastMapStyleRebuildAt = 0;

// 🔄 真正的 MapLibre 實例重建（map.remove() + new maplibregl.Map()）：
// 徹底釋放壞死的 WebGL Context 並無損還原座標、底圖樣式、錄製/預覽/編輯路線、黃色提醒、車隊雷達、測速照相與純黑省電狀態
function rebuildMapInstanceAndRestoreAllState(reason = 'webgl-recovery') {
    if (!currentMapLayerPreset) return false;
    if (isRebuildingMapInstance) return false;

    const now = Date.now();
    const isManualTrigger = (reason === 'toolbar-button' || reason === 'menu-button' || reason === 'manual');
    if (!isManualTrigger && (now - lastMapStyleRebuildAt) < 1600) return false;

    isRebuildingMapInstance = true;
    lastMapStyleRebuildAt = now;
    if (mapRebuildSafetyUnlockTimer) {
        clearTimeout(mapRebuildSafetyUnlockTimer);
        mapRebuildSafetyUnlockTimer = null;
    }
    // 最長 4.5 秒自動解鎖，防止極端弱網環境下鎖死無法再次觸發
    mapRebuildSafetyUnlockTimer = setTimeout(() => {
        isRebuildingMapInstance = false;
        mapRebuildSafetyUnlockTimer = null;
    }, 4500);

    try {
        window.scrollTo(0, 0);

        // 1. 完整保存當前視角與狀態
        let savedCenter = [121.346, 24.954];
        let savedZoom = 16;
        let savedBearing = 0;
        let savedPitch = 0;
        try {
            const c = map?.getCenter?.();
            if (c && Number.isFinite(c.lng) && Number.isFinite(c.lat)) {
                savedCenter = [c.lng, c.lat];
            } else if (Array.isArray(lastKnownLngLat) && lastKnownLngLat.length >= 2) {
                savedCenter = [lastKnownLngLat[0], lastKnownLngLat[1]];
            }
            const z = map?.getZoom?.();
            if (typeof z === 'number' && Number.isFinite(z)) savedZoom = z;
            const b = map?.getBearing?.();
            if (typeof b === 'number' && Number.isFinite(b)) savedBearing = b;
            const p = map?.getPitch?.();
            if (typeof p === 'number' && Number.isFinite(p)) savedPitch = p;
        } catch (e) {}

        const oldMap = map;
        const containerEl = document.getElementById('map');

        // 2. 徹底銷毀舊壞死 MapLibre 實例並清空殘留 canvas DOM
        if (oldMap) {
            try { oldMap.remove(); } catch (e) {}
        }
        if (containerEl) {
            containerEl.innerHTML = '';
        }

        // 3. 重新建立全新的 MapLibre 實例（取得嶄新健康的 WebGL Context）
        mapInstanceCreatedAt = Date.now();
        const nextMap = new maplibregl.Map({
            container: 'map',
            style: currentMapLayerPreset.getStyle(),
            center: savedCenter,
            zoom: savedZoom,
            maxZoom: 21,
            bearing: savedBearing,
            pitch: savedPitch,
            dragRotate: true,
            touchZoomRotate: true
        });
        map = nextMap;
        ensureVehicleMarkerOnMap();

        // 4. 掛載事件紀錄代理、核心監聽器、WebGL 監聽與自動重放所有外部模組監聽器
        installMapInstanceListenerRecorder(nextMap);
        bindCoreMapInstanceListeners(nextMap);
        attachMapWebglAndViewportGuards(nextMap);
        replayExternalListenersToMapInstance(nextMap);

        let restoredOnce = false;
        const restoreAllAfterInstanceLoad = () => {
            if (map !== nextMap) return;
            isMapWebglContextLost = false;
            if (!restoredOnce) {
                restoredOnce = true;
                isRebuildingMapInstance = false;
                if (mapRebuildSafetyUnlockTimer) {
                    clearTimeout(mapRebuildSafetyUnlockTimer);
                    mapRebuildSafetyUnlockTimer = null;
                }
            }
            try {
                restoreCustomLayersAndAlignmentAfterStyleLoad();
                nextMap.jumpTo({
                    center: savedCenter,
                    zoom: savedZoom,
                    bearing: savedBearing,
                    pitch: savedPitch
                });
                ensureDomMarkersIntactAfterStyleSwitch();
                if (typeof ensurePureBlackSystemBars === 'function') {
                    ensurePureBlackSystemBars();
                }
                updateMapMarkersZoomScale();
                nextMap.resize();
                nextMap.triggerRepaint();
            } catch (err) {
                console.warn('[MapRecovery] 實例重建後還原圖層時發生例外:', err);
            }
        };

        nextMap.once('load', restoreAllAfterInstanceLoad);

        // 二次與三次補償（吸收弱網 style 載入較慢或系統列高度變化）
        setTimeout(() => {
            if (map !== nextMap) return;
            restoreCustomLayersAndAlignmentAfterStyleLoad();
            ensureDomMarkersIntactAfterStyleSwitch();
            updateMapMarkersZoomScale();
            nextMap.resize();
            nextMap.triggerRepaint();
        }, 420);

        setTimeout(() => {
            if (map !== nextMap) return;
            if (!restoredOnce) restoreAllAfterInstanceLoad();
            else {
                ensureDomMarkersIntactAfterStyleSwitch();
                updateMapMarkersZoomScale();
                nextMap.resize();
                nextMap.triggerRepaint();
            }
        }, 1100);

        return true;
    } catch (e) {
        isRebuildingMapInstance = false;
        if (mapRebuildSafetyUnlockTimer) {
            clearTimeout(mapRebuildSafetyUnlockTimer);
            mapRebuildSafetyUnlockTimer = null;
        }
        console.warn(`[MapRecovery:${reason}] 重建 MapLibre 實例時發生例外:`, e);
        return false;
    }
}

// 保持向下相容別名（既有呼叫點直接受惠於真正 MapLibre 實例重建）
function rebuildMapStyleAndRestoreAllState(reason = 'webgl-recovery') {
    return rebuildMapInstanceAndRestoreAllState(reason);
}

function refreshMapCanvasAndLayers({ forceRebuildStyle = false, showToast = false, reason = 'manual' } = {}) {
    if (!map && !currentMapLayerPreset) return;
    try {
        window.scrollTo(0, 0);
        const refreshIcon = document.getElementById('refreshMapIcon');
        if (showToast && refreshIcon) {
            refreshIcon.style.transform = 'rotate(360deg)';
            setTimeout(() => {
                refreshIcon.style.transform = 'rotate(0deg)';
            }, 520);
        }

        const shouldRebuildInstance = Boolean(forceRebuildStyle || isMapBaseStyleAbnormal());
        if (shouldRebuildInstance) {
            const started = rebuildMapInstanceAndRestoreAllState(reason);
            if (showToast) {
                showMapRefreshToast(
                    started
                        ? '🔄 已重建地圖引擎與圖層（完整保留路線、地標與車輛狀態）'
                        : '⏳ 地圖引擎正在重建中，請稍候...'
                );
            }
            return;
        }

        map.resize();
        restoreCustomLayersAndAlignmentAfterStyleLoad();
        updateMapMarkersZoomScale();
        map.triggerRepaint();

        // 二次穩定重算（吸收 iOS / Android 系統列或螢幕旋轉動畫完成後的高度差）
        setTimeout(() => {
            try {
                if (!map || isRebuildingMapInstance) return;
                window.scrollTo(0, 0);
                map.resize();
                ensureDomMarkersIntactAfterStyleSwitch();
                updateMapMarkersZoomScale();
                map.triggerRepaint();
            } catch (err) {}
        }, 260);

        if (showToast) {
            showMapRefreshToast('🔄 地圖尺寸與圖層已重整（已保留目前路線狀態）');
        }
    } catch (e) {
        console.warn('輕量重整地圖時發生例外:', e);
    }
}

function attachMapWebglAndViewportGuards(targetMap = map) {
    if (!targetMap) return;
    const canvas = targetMap.getCanvas?.();
    if (canvas && !canvas.__webglGuardAttached) {
        canvas.__webglGuardAttached = true;
        canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            isMapWebglContextLost = true;
            console.warn('[WebGL] 偵測到 webglcontextlost，待返回前景時自動重建 MapLibre 實例');
        }, false);

        canvas.addEventListener('webglcontextrestored', () => {
            isMapWebglContextLost = false;
            setTimeout(() => {
                if (document.visibilityState === 'visible') {
                    rebuildMapInstanceAndRestoreAllState('webglcontextrestored');
                }
            }, 160);
        }, false);
    }

    isInternalMapBinding = true;
    try {
        targetMap.on('webglcontextlost', () => {
            isMapWebglContextLost = true;
        });
        targetMap.on('webglcontextrestored', () => {
            isMapWebglContextLost = false;
            setTimeout(() => {
                if (document.visibilityState === 'visible') {
                    rebuildMapInstanceAndRestoreAllState('map-webglcontextrestored');
                }
            }, 160);
        });
    } finally {
        isInternalMapBinding = false;
    }

    if (hasBoundGlobalViewportResizeGuards) return;
    hasBoundGlobalViewportResizeGuards = true;

    const scheduleViewportMapResize = (source = 'resize') => {
        if (mapViewportResizeTimer) {
            clearTimeout(mapViewportResizeTimer);
        }
        mapViewportResizeTimer = setTimeout(() => {
            mapViewportResizeTimer = null;
            if (document.visibilityState === 'visible' && !isRebuildingMapInstance) {
                refreshMapCanvasAndLayers({ forceRebuildStyle: false, showToast: false, reason: source });
            }
        }, 150);
    };

    window.addEventListener('orientationchange', () => {
        scheduleViewportMapResize('orientationchange');
        setTimeout(() => scheduleViewportMapResize('orientationchange-late'), 380);
    });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            scheduleViewportMapResize('visualViewport-resize');
        });
    }
}
attachMapWebglAndViewportGuards(map);

// ==========================================
// 🗺️ 右上角「圖層」雙書籤分頁面板（🗺️ 地圖圖層 / ⚙️ 功能開關）渲染與切換邏輯
// ==========================================
let currentMapLayerMenuTab = 'layers'; // 'layers'（預設顯示）| 'features'

function syncMapLayerMenuTabUI() {
    const isLayersTab = (currentMapLayerMenuTab !== 'features');
    const tabBtnLayers = document.getElementById('mapLayerTabBtnLayers');
    const tabBtnFeatures = document.getElementById('mapLayerTabBtnFeatures');
    const panelLayers = document.getElementById('mapLayerTabPanelLayers');
    const panelFeatures = document.getElementById('mapLayerTabPanelFeatures');

    if (tabBtnLayers) {
        tabBtnLayers.className = isLayersTab
            ? 'px-2.5 py-1.5 rounded-lg text-xs font-black flex items-center justify-center gap-1 transition-all active:scale-95 bg-emerald-600 text-white shadow-sm'
            : 'px-2.5 py-1.5 rounded-lg text-xs font-black flex items-center justify-center gap-1 transition-all active:scale-95 text-gray-600 hover:bg-white/70';
    }
    if (tabBtnFeatures) {
        tabBtnFeatures.className = !isLayersTab
            ? 'px-2.5 py-1.5 rounded-lg text-xs font-black flex items-center justify-center gap-1 transition-all active:scale-95 bg-indigo-600 text-white shadow-sm'
            : 'px-2.5 py-1.5 rounded-lg text-xs font-black flex items-center justify-center gap-1 transition-all active:scale-95 text-gray-600 hover:bg-white/70';
    }
    if (panelLayers) {
        panelLayers.classList.toggle('hidden', !isLayersTab);
    }
    if (panelFeatures) {
        panelFeatures.classList.toggle('hidden', isLayersTab);
    }
}

function switchMapLayerMenuTab(tabKey) {
    currentMapLayerMenuTab = (tabKey === 'features') ? 'features' : 'layers';
    syncMapLayerMenuTabUI();
    positionMapLayerMenuPanel();
}

function renderMapLayerMenuOptions() {
    const listEl = document.getElementById('mapLayerOptionList');
    const featureListEl = document.getElementById('mapFeatureSwitchList');
    const badgeEl = document.getElementById('currentMapLayerBadge');
    if (badgeEl && currentMapLayerPreset) {
        badgeEl.textContent = currentMapLayerPreset.shortName;
    }

    syncMapLayerMenuTabUI();

    // --------------------------------------------------
    // 分頁 2（「⚙️ 功能開關」）：集中放置聖誕節主題（含音樂開關）、測速照相、車隊無線電對講
    // --------------------------------------------------
    const targetFeatureContainer = featureListEl || listEl;
    if (targetFeatureContainer) {
        if (featureListEl) {
            featureListEl.innerHTML = '';
        } else if (listEl) {
            listEl.innerHTML = '';
        }

        // 🎄 1. 使用者節慶主題開關（耶誕節主題開啟時，右側內嵌專屬「水晶音樂開／關」切換膠囊）
        if (typeof getEffectiveFestivalThemeState === 'function') {
            const themeState = getEffectiveFestivalThemeState();
            const themeMeta = themeState.themeMeta;
            const isThemeOn = Boolean(themeState.isActive);
            const showXmasMusicBtn = Boolean(isThemeOn && themeState.themeKey === 'christmas');
            const isBgmOn = Boolean(window.BgmPlayer && typeof window.BgmPlayer.isEnabled === 'function' && window.BgmPlayer.isEnabled());

            const themeCard = document.createElement('div');
            themeCard.setAttribute('role', 'button');
            themeCard.setAttribute('tabindex', '0');
            themeCard.id = 'mapLayerFestivalThemeToggleBtn';
            themeCard.className = isThemeOn
                ? 'w-full text-left px-3 py-2 rounded-xl bg-red-50 border-2 border-red-400 text-red-900 flex items-center justify-between gap-2 transition-all active:scale-[0.98] cursor-pointer select-none'
                : 'w-full text-left px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-800 flex items-center justify-between gap-2 transition-all active:scale-[0.98] cursor-pointer select-none';

            themeCard.innerHTML = `
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <span class="text-base flex-shrink-0">${themeMeta.icon}</span>
                    <div class="min-w-0">
                        <div class="text-xs font-black truncate ${isThemeOn ? 'text-red-800' : 'text-gray-800'}">${themeMeta.name}</div>
                        <div class="text-[10px] font-bold truncate ${isThemeOn ? 'text-red-600' : 'text-gray-400'}">${isThemeOn ? '已開啟 · 點擊關閉' : '已關閉 · 點擊開啟'}</div>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 flex-shrink-0">
                    ${showXmasMusicBtn ? `
                    <button type="button" id="mapLayerXmasBgmBtn" class="px-2 py-1 rounded-full text-[10px] font-black flex items-center gap-1 shadow-sm active:scale-90 transition-all whitespace-nowrap border ${
                        isBgmOn
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-400'
                            : 'bg-white hover:bg-gray-100 text-gray-600 border-gray-300'
                    }" title="${isBgmOn ? '點擊關閉聖誕水晶音樂' : '點擊開啟聖誕水晶音樂'}">
                        <span>${isBgmOn ? '🎵 音樂開' : '🔇 音樂關'}</span>
                    </button>` : ''}
                    <span class="text-[10px] font-black px-2 py-0.5 rounded-full flex-shrink-0 ${isThemeOn ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-600'}">${isThemeOn ? '開' : '關'}</span>
                </div>
            `;

            themeCard.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof toggleUserFestivalTheme === 'function') {
                    toggleUserFestivalTheme();
                }
            });

            const xmasBgmBtn = themeCard.querySelector('#mapLayerXmasBgmBtn');
            if (xmasBgmBtn) {
                xmasBgmBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.BgmPlayer?.toggle();
                });
            }

            targetFeatureContainer.appendChild(themeCard);
        }

        // 📸 2. 固定式測速照相圖標開關（預設開啟）
        if (window.SpeedCameraManager && typeof window.SpeedCameraManager.isVisible === 'function') {
            const isCamOn = Boolean(window.SpeedCameraManager.isVisible());
            const camBtn = document.createElement('button');
            camBtn.type = 'button';
            camBtn.id = 'mapLayerSpeedCameraToggleBtn';
            camBtn.className = isCamOn
                ? 'w-full text-left px-3 py-2 rounded-xl bg-rose-50 border-2 border-rose-400 text-rose-900 flex items-center justify-between gap-2 transition-all active:scale-[0.98]'
                : 'w-full text-left px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-800 flex items-center justify-between gap-2 transition-all active:scale-[0.98]';
            camBtn.innerHTML = `
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <span class="text-base flex-shrink-0">📸</span>
                    <div class="min-w-0">
                        <div class="text-xs font-black truncate ${isCamOn ? 'text-rose-800' : 'text-gray-800'}">測速照相</div>
                        <div class="text-[10px] font-bold truncate ${isCamOn ? 'text-rose-600' : 'text-gray-400'}">${isCamOn ? '已顯示 · 接近 300m 語音提醒' : '已隱藏 · 點擊開啟圖標'}</div>
                    </div>
                </div>
                <span class="text-[10px] font-black px-2 py-0.5 rounded-full flex-shrink-0 ${isCamOn ? 'bg-rose-600 text-white' : 'bg-gray-200 text-gray-600'}">${isCamOn ? '開' : '關'}</span>
            `;
            camBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.SpeedCameraManager.toggle();
            });
            targetFeatureContainer.appendChild(camBtn);
        }

        // 🎙️ 3. 車隊無線電對講開關（預設開啟）
        if (window.FleetRadioPTT && typeof window.FleetRadioPTT.isEnabled === 'function') {
            const isRadioOn = Boolean(window.FleetRadioPTT.isEnabled());
            const radioBtn = document.createElement('button');
            radioBtn.type = 'button';
            radioBtn.id = 'mapLayerFleetRadioToggleBtn';
            radioBtn.className = isRadioOn
                ? 'w-full text-left px-3 py-2 rounded-xl bg-sky-50 border-2 border-sky-400 text-sky-900 flex items-center justify-between gap-2 transition-all active:scale-[0.98]'
                : 'w-full text-left px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-800 flex items-center justify-between gap-2 transition-all active:scale-[0.98]';
            radioBtn.innerHTML = `
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <span class="text-base flex-shrink-0">🎙️</span>
                    <div class="min-w-0">
                        <div class="text-xs font-black truncate ${isRadioOn ? 'text-sky-800' : 'text-gray-800'}">車隊無線電對講</div>
                        <div class="text-[10px] font-bold truncate ${isRadioOn ? 'text-sky-600' : 'text-gray-400'}">${isRadioOn ? '已開啟 · 顯示對講鈕並接收語音' : '已關閉 · 隱藏對講鈕並停止收音'}</div>
                    </div>
                </div>
                <span class="text-[10px] font-black px-2 py-0.5 rounded-full flex-shrink-0 ${isRadioOn ? 'bg-sky-600 text-white' : 'bg-gray-200 text-gray-600'}">${isRadioOn ? '開' : '關'}</span>
            `;
            radioBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.FleetRadioPTT.toggle();
            });
            targetFeatureContainer.appendChild(radioBtn);
        }

        // 🧭 4. 自由導航開關（預設關閉；開啟時長按地圖可預覽路線並啟動導航）
        if (window.ApproachNav && typeof window.ApproachNav.isFreeNavEnabled === 'function') {
            const isFreeNavOn = Boolean(window.ApproachNav.isFreeNavEnabled());
            const freeNavBtn = document.createElement('button');
            freeNavBtn.type = 'button';
            freeNavBtn.id = 'mapLayerFreeNavToggleBtn';
            freeNavBtn.className = isFreeNavOn
                ? 'w-full text-left px-3 py-2 rounded-xl bg-cyan-50 border-2 border-cyan-400 text-cyan-900 flex items-center justify-between gap-2 transition-all active:scale-[0.98]'
                : 'w-full text-left px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-800 flex items-center justify-between gap-2 transition-all active:scale-[0.98]';
            freeNavBtn.innerHTML = `
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <span class="text-base flex-shrink-0">🧭</span>
                    <div class="min-w-0">
                        <div class="text-xs font-black truncate ${isFreeNavOn ? 'text-cyan-800' : 'text-gray-800'}">自由導航</div>
                        <div class="text-[10px] font-bold truncate ${isFreeNavOn ? 'text-cyan-600' : 'text-gray-400'}">${isFreeNavOn ? '已開啟 · 長按地圖設定目的地' : '已關閉 · 點擊開啟長按導航'}</div>
                    </div>
                </div>
                <span class="text-[10px] font-black px-2 py-0.5 rounded-full flex-shrink-0 ${isFreeNavOn ? 'bg-cyan-600 text-white' : 'bg-gray-200 text-gray-600'}">${isFreeNavOn ? '開' : '關'}</span>
            `;
            freeNavBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.ApproachNav.toggleFreeNav();
            });
            targetFeatureContainer.appendChild(freeNavBtn);
        }

        // 🏢 5. 社區名稱開關（預設開啟；關閉時一併隱藏地圖上所有社區名稱文字與橘色水滴標記）
        {
            const isBuildingOn = (window.BuildingPinManager && typeof window.BuildingPinManager.isVisible === 'function')
                ? Boolean(window.BuildingPinManager.isVisible())
                : (localStorage.getItem('yingge_show_building_pins_v1') !== 'false');
            const buildingBtn = document.createElement('button');
            buildingBtn.type = 'button';
            buildingBtn.id = 'mapLayerBuildingPinsToggleBtn';
            buildingBtn.className = isBuildingOn
                ? 'w-full text-left px-3 py-2 rounded-xl bg-orange-50 border-2 border-orange-400 text-orange-900 flex items-center justify-between gap-2 transition-all active:scale-[0.98]'
                : 'w-full text-left px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-800 flex items-center justify-between gap-2 transition-all active:scale-[0.98]';
            buildingBtn.innerHTML = `
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <span class="text-base flex-shrink-0">🏢</span>
                    <div class="min-w-0">
                        <div class="text-xs font-black truncate ${isBuildingOn ? 'text-orange-800' : 'text-gray-800'}">社區名稱</div>
                        <div class="text-[10px] font-bold truncate ${isBuildingOn ? 'text-orange-600' : 'text-gray-400'}">${isBuildingOn ? '已顯示 · 社區名稱與橘色水滴標記' : '已隱藏 · 點擊顯示社區與橘色水滴'}</div>
                    </div>
                </div>
                <span class="text-[10px] font-black px-2 py-0.5 rounded-full flex-shrink-0 ${isBuildingOn ? 'bg-orange-600 text-white' : 'bg-gray-200 text-gray-600'}">${isBuildingOn ? '開' : '關'}</span>
            `;
            buildingBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.BuildingPinManager && typeof window.BuildingPinManager.toggle === 'function') {
                    window.BuildingPinManager.toggle();
                }
            });
            targetFeatureContainer.appendChild(buildingBtn);
        }

        // 📌 6. 路線註記／備忘開關（預設開啟；控制預覽與導航模式下的畫筆記號、自訂插釘與引線備忘框）
        {
            const isAnnotOn = isRouteAnnotationsVisible();
            const annotBtn = document.createElement('button');
            annotBtn.type = 'button';
            annotBtn.id = 'mapLayerRouteAnnotationsToggleBtn';
            annotBtn.className = isAnnotOn
                ? 'w-full text-left px-3 py-2 rounded-xl bg-indigo-50 border-2 border-indigo-400 text-indigo-900 flex items-center justify-between gap-2 transition-all active:scale-[0.98]'
                : 'w-full text-left px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-800 flex items-center justify-between gap-2 transition-all active:scale-[0.98]';
            annotBtn.innerHTML = `
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <span class="text-base flex-shrink-0">📌</span>
                    <div class="min-w-0">
                        <div class="text-xs font-black truncate ${isAnnotOn ? 'text-indigo-800' : 'text-gray-800'}">路線註記／插釘</div>
                        <div class="text-[10px] font-bold truncate ${isAnnotOn ? 'text-indigo-600' : 'text-gray-400'}">${isAnnotOn ? '已顯示 · 畫筆記號、自訂插釘與備忘' : '已隱藏 · 點擊顯示畫筆、插釘與備忘'}</div>
                    </div>
                </div>
                <span class="text-[10px] font-black px-2 py-0.5 rounded-full flex-shrink-0 ${isAnnotOn ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-600'}">${isAnnotOn ? '開' : '關'}</span>
            `;
            annotBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleRouteAnnotationsVisibility();
            });
            targetFeatureContainer.appendChild(annotBtn);
        }
    }

    // --------------------------------------------------
    // 分頁 1（「🗺️ 地圖圖層」預設顯示）：集中放置 6 種底圖樣式切換
    // --------------------------------------------------
    if (!listEl) return;
    if (featureListEl) {
        listEl.innerHTML = '';
    }

    MAP_LAYER_PRESETS.forEach(preset => {
        const isSelected = (preset.id === currentMapLayerPreset?.id);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = isSelected
            ? 'w-full text-left px-3 py-2 rounded-xl bg-emerald-50 border-2 border-emerald-500 text-emerald-900 flex items-center justify-between gap-2 transition-all active:scale-95'
            : 'w-full text-left px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-800 flex items-center justify-between gap-2 transition-all active:scale-95';

        btn.innerHTML = `
            <div class="flex items-center gap-2.5 min-w-0">
                <span class="text-base flex-shrink-0">${preset.icon}</span>
                <div class="min-w-0">
                    <div class="text-xs font-black truncate ${isSelected ? 'text-emerald-800' : 'text-gray-800'}">${preset.name}</div>
                    <div class="text-[10px] font-bold truncate ${isSelected ? 'text-emerald-600' : 'text-gray-400'}">${preset.desc}</div>
                </div>
            </div>
            ${isSelected ? '<i class="fa-solid fa-circle-check text-emerald-600 text-sm flex-shrink-0"></i>' : ''}
        `;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            switchMapBaseLayer(preset.id);
            document.getElementById('mapLayerMenuPanel')?.classList.add('hidden');
        });
        listEl.appendChild(btn);
    });
}

function switchMapBaseLayer(layerId) {
    const targetPreset = MAP_LAYER_PRESETS.find(item => item.id === layerId);
    if (!targetPreset || !map) return;

    currentMapLayerPreset = targetPreset;
    try {
        localStorage.setItem(MAP_LAYER_STORAGE_KEY, targetPreset.id);
    } catch (e) {}

    renderMapLayerMenuOptions();

    // 若目前 WebGL Context 已遺失或底圖異常，直接走完整 MapLibre 實例重建即可立即以新底圖復活
    if (isMapWebglContextBroken()) {
        rebuildMapInstanceAndRestoreAllState('layer-switch-recovery');
        return;
    }

    // 一律使用 { diff: false } 強制完整重載樣式，確保不同網格／向量底圖切換必定觸發 map.on('style.load') 並依序重建所有自訂路線、插針、社區與車隊雷達圖層
    try {
        map.setStyle(targetPreset.getStyle(), { diff: false });
    } catch (e) {
        console.error('切換底圖圖層時發生錯誤:', e);
        rebuildMapInstanceAndRestoreAllState('layer-switch-error');
    }
}

function positionMapLayerMenuPanel() {
    const switchBtn = document.getElementById('mapLayerSwitchBtn');
    const menuPanel = document.getElementById('mapLayerMenuPanel');
    if (!switchBtn || !menuPanel || menuPanel.classList.contains('hidden')) return;

    const btnRect = switchBtn.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 360;
    const vh = window.innerHeight || document.documentElement.clientHeight || 640;
    const panelHeight = menuPanel.offsetHeight || 360;
    const rightPx = Math.max(12, Math.round(vw - btnRect.left + 8));
    const maxTop = Math.max(12, vh - panelHeight - 14);
    const topPx = Math.max(12, Math.min(Math.round(btnRect.top), maxTop));

    menuPanel.style.right = `${rightPx}px`;
    menuPanel.style.top = `${topPx}px`;
}

(function initMapLayerSwitcherUI() {
    const switchBtn = document.getElementById('mapLayerSwitchBtn');
    const menuPanel = document.getElementById('mapLayerMenuPanel');
    const refreshMapBtn = document.getElementById('refreshMapBtn');
    const menuRefreshMapBtn = document.getElementById('menuRefreshMapBtn');
    const tabBtnLayers = document.getElementById('mapLayerTabBtnLayers');
    const tabBtnFeatures = document.getElementById('mapLayerTabBtnFeatures');

    if (tabBtnLayers) {
        tabBtnLayers.addEventListener('click', (e) => {
            e.stopPropagation();
            switchMapLayerMenuTab('layers');
        });
    }
    if (tabBtnFeatures) {
        tabBtnFeatures.addEventListener('click', (e) => {
            e.stopPropagation();
            switchMapLayerMenuTab('features');
        });
    }

    renderMapLayerMenuOptions();

    if (switchBtn && menuPanel) {
        switchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const willOpen = menuPanel.classList.contains('hidden');
            if (willOpen) {
                currentMapLayerMenuTab = 'layers';
                renderMapLayerMenuOptions();
                menuPanel.classList.remove('hidden');
                positionMapLayerMenuPanel();
            } else {
                menuPanel.classList.add('hidden');
            }
        });
    }

    window.addEventListener('resize', () => {
        positionMapLayerMenuPanel();
    });

    if (refreshMapBtn) {
        refreshMapBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            menuPanel?.classList.add('hidden');
            refreshMapCanvasAndLayers({ forceRebuildStyle: true, showToast: true, reason: 'toolbar-button' });
        });
    }

    if (menuRefreshMapBtn) {
        menuRefreshMapBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            menuPanel?.classList.add('hidden');
            refreshMapCanvasAndLayers({ forceRebuildStyle: true, showToast: true, reason: 'menu-button' });
        });
    }

    // 點擊面板與圖層按鈕外部任意處自動關閉圖層選單
    document.addEventListener('pointerdown', (e) => {
        if (!menuPanel || menuPanel.classList.contains('hidden')) return;
        const clickedInsideMenu = menuPanel.contains(e.target);
        const clickedSwitchBtn = switchBtn && switchBtn.contains(e.target);
        if (!clickedInsideMenu && !clickedSwitchBtn) {
            menuPanel.classList.add('hidden');
        }
    });
})();

map.once('load', () => {
    ensureVehicleMarkerOnMap();
    restoreCustomLayersAndAlignmentAfterStyleLoad();

    startIdleGPS();
    navigator.geolocation?.getCurrentPosition(pos => {
        if (!isReplaying && map) {
            const lngLat = [pos.coords.longitude, pos.coords.latitude];
            lastKnownLngLat = lngLat;
            ensureVehicleMarkerOnMap(lngLat, currentHeading);
            map.jumpTo({ center: lngLat, zoom: 17 });
            window.syncCarHeading?.(currentHeading, map.getBearing());
        }
    });
});

function emptyGeoJSON() { return { type: 'FeatureCollection', features: [] }; }

// --- 2. 視角操作 ---
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
    const activeHeading = (typeof vehicleVisualHeading === 'number' && !isNaN(vehicleVisualHeading))
        ? vehicleVisualHeading
        : currentHeading;
    currentHeading = activeHeading;
    vehicleVisualHeading = activeHeading;
    const targetBearing = isHeadingUpMode ? activeHeading : 0;
    map.easeTo({
        center: lastKnownLngLat, zoom: resumeZoom,
        bearing: targetBearing, offset: [0, 100], duration: 400
    });
    window.syncCarHeading?.(activeHeading, map.getBearing());
};

document.getElementById('headingModeBtn').onclick = () => {
    isHeadingUpMode = !isHeadingUpMode;
    const btn = document.getElementById('headingModeBtn');
    const label = document.getElementById('headingLabel');
    const activeHeading = (typeof vehicleVisualHeading === 'number' && !isNaN(vehicleVisualHeading))
        ? vehicleVisualHeading
        : currentHeading;
    currentHeading = activeHeading;
    vehicleVisualHeading = activeHeading;
    const targetBearing = isHeadingUpMode ? activeHeading : 0;
    if (isHeadingUpMode) {
        btn.className = "bg-blue-600 text-white w-11 h-11 rounded-2xl shadow-lg flex flex-col items-center justify-center active:scale-95";
        label.innerText = "車頭上";
        if (isFollowingCamera) map.easeTo({ bearing: targetBearing, duration: 300 });
    } else {
        btn.className = "bg-white text-gray-700 w-11 h-11 rounded-2xl shadow-lg flex flex-col items-center justify-center active:scale-95";
        label.innerText = "正北上";
        if (isFollowingCamera) map.easeTo({ bearing: targetBearing, duration: 300 });
    }
    window.syncCarHeading?.(activeHeading, map.getBearing());
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
                if (this.queue.length === 0) {
                    window.BgmPlayer?.setVoiceDucking(false);
                    try {
                        if ('speechSynthesis' in window && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
                            window.speechSynthesis.cancel();
                        }
                    } catch (e) {}
                }
                this.processNext();
            };

            u.onstart = () => {
                window.BgmPlayer?.setVoiceDucking(true);
            };
            u.onend = onComplete;
            u.onerror = onComplete;

            // 安全保底：防止行動裝置瀏覽器偶發未觸發 onend 卡住佇列
            this._watchdogTimer = setTimeout(onComplete, 12000);

            // 將 SpeechSynthesisUtterance 實例保存於全域變數中，避免被瀏覽器垃圾回收機制中途切斷導致無聲
            window._activeSpeechUtterance = u;
            window.BgmPlayer?.setVoiceDucking(true);
            window.speechSynthesis.speak(u);
        } catch (e) {
            window._activeSpeechUtterance = null;
            this.isSpeaking = false;
            window.BgmPlayer?.setVoiceDucking(false);
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
        window.BgmPlayer?.setVoiceDucking(false);
        if ('speechSynthesis' in window) {
            try { window.speechSynthesis.cancel(); } catch (e) {}
        }
    }
};
window.VoiceQueue = VoiceQueue;

function unlockSpeechSynthesis() {
    // 嚴禁預先發送空白 SpeechSynthesisUtterance('')，避免尚未實際播報語音前就觸發手機系統 TTS Audio Ducking 壓低外部背景音樂
}
window.unlockSpeechSynthesis = unlockSpeechSynthesis;

function speakText(text) {
    if (!isVoiceEnabled || !text) return;
    if ('speechSynthesis' in window) {
        try {
            if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
            }
        } catch (e) {}
    }
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

// ==========================================
// 🛣️ 來回重複路段「往右側平行偏移（雙線分離顯示）」視覺座標引擎
// - 資料與距離維持真實道路中心線座標不變（不汙染 route.points 與距離計算）
// - 在 MapLibre 路線圖層與編輯/手繪節點渲染時，自動偵測同一條路線上與既有線段重疊或反向折返（距離 < 15m）的路段，
//   依該段行進方向往右側平行偏移（約 5.5px 隨地圖縮放比例適度錯開），讓去程與回程雙線並排清楚可辨識
// ==========================================
function pointToSegmentDistMeters(pLng, pLat, aLng, aLat, bLng, bLat) {
    const cosLat = Math.cos(((pLat + aLat) * 0.5 * Math.PI) / 180);
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * cosLat;

    const px = (pLng - aLng) * mPerDegLng;
    const py = (pLat - aLat) * mPerDegLat;
    const bx = (bLng - aLng) * mPerDegLng;
    const by = (bLat - aLat) * mPerDegLat;

    const lenSq = bx * bx + by * by;
    if (lenSq <= 0.0001) {
        return Math.hypot(px, py);
    }
    const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
    const projX = t * bx;
    const projY = t * by;
    return Math.hypot(px - projX, py - projY);
}

function computeVisualRightOffsetCoords(points) {
    if (!Array.isArray(points) || points.length === 0) return [];
    const n = points.length;
    if (n < 2) {
        return points.map(p => ({ lng: p.lng, lat: p.lat, dLng: 0, dLat: 0, isOffset: false }));
    }

    // 1. 計算累積里程 (cumM) 與每個點的穩定前進方向角 (bearings)
    const cumM = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
        if (points[i].isSegmentStart) {
            cumM[i] = cumM[i - 1];
        } else {
            cumM[i] = cumM[i - 1] + getDistanceKm(points[i - 1].lng, points[i - 1].lat, points[i].lng, points[i].lat) * 1000;
        }
    }

    const bearings = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        let found = false;
        for (let k = i + 1; k < n; k++) {
            if (points[k].isSegmentStart) break;
            const dM = cumM[k] - cumM[i];
            if (dM >= 1.2) {
                bearings[i] = getBearing(points[i].lng, points[i].lat, points[k].lng, points[k].lat);
                found = true;
                break;
            }
        }
        if (!found) {
            for (let k = i - 1; k >= 0; k--) {
                if (points[k + 1]?.isSegmentStart) break;
                const dM = cumM[i] - cumM[k];
                if (dM >= 1.2) {
                    bearings[i] = getBearing(points[k].lng, points[k].lat, points[i].lng, points[i].lat);
                    found = true;
                    break;
                }
            }
        }
        if (!found && typeof points[i].bearing === 'number') {
            bearings[i] = points[i].bearing;
        }
    }

    // 2. 偵測每個節點是否與先前已走過的線段重疊或反向折返（距離 < 15m）
    const rawOverlapLevel = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
        const pI = points[i];
        const bI = bearings[i];
        let isOverlappingEarlier = false;

        for (let j = 0; j < i - 1; j++) {
            if (points[j + 1]?.isSegmentStart) continue;
            const pathGapM = cumM[i] - cumM[j + 1];
            if (pathGapM < 10) break;

            // 快速經緯度 Bounding Box 過濾（約 22m 範圍）
            if (Math.abs(pI.lat - points[j].lat) > 0.00022 && Math.abs(pI.lat - points[j + 1].lat) > 0.00022) continue;
            if (Math.abs(pI.lng - points[j].lng) > 0.00025 && Math.abs(pI.lng - points[j + 1].lng) > 0.00025) continue;

            const segDistM = pointToSegmentDistMeters(
                pI.lng, pI.lat,
                points[j].lng, points[j].lat,
                points[j + 1].lng, points[j + 1].lat
            );

            if (segDistM < 15) {
                const angleDiff = getAngleDiff(bI, bearings[j]);
                // 若為反向折返 (angleDiff >= 90°)，只要路徑間隔 >= 10m 即判定為回程折返；
                // 若為同向重疊 (angleDiff < 90°)，路徑間隔 >= 42m 判定為重疊繞回
                if ((angleDiff >= 90 && pathGapM >= 10) || pathGapM >= 42) {
                    isOverlappingEarlier = true;
                    break;
                }
            }
        }

        if (isOverlappingEarlier) {
            rawOverlapLevel[i] = 1;
        }
    }

    // 3. 針對短暫 1~2 點缺口進行填補並做平滑過渡，避免路口或折返頂點出現鋸齒跳動
    const filledLevel = [...rawOverlapLevel];
    for (let i = 1; i < n - 1; i++) {
        if (filledLevel[i] === 0 && filledLevel[i - 1] === 1 && filledLevel[i + 1] === 1) {
            filledLevel[i] = 1;
        }
    }
    const smoothFactor = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        const prev = filledLevel[Math.max(0, i - 1)];
        const curr = filledLevel[i];
        const next = filledLevel[Math.min(n - 1, i + 1)];
        smoothFactor[i] = prev * 0.22 + curr * 0.56 + next * 0.22;
    }

    // 4. 依當前地圖縮放層級換算約 5.5px 對應的實際公尺偏移量（限制於 3.6m ~ 8.5m 之間）
    let currentZoom = 16.8;
    try {
        if (typeof map !== 'undefined' && map && typeof map.getZoom === 'function') {
            currentZoom = map.getZoom();
        }
    } catch (e) {}
    const metersPerPx = (156543.03392 * Math.cos((24.95 * Math.PI) / 180)) / Math.pow(2, currentZoom + 1);
    const baseOffsetMeters = Math.max(3.6, Math.min(8.5, metersPerPx * 5.8));

    const result = new Array(n);
    for (let i = 0; i < n; i++) {
        const pt = points[i];
        const factor = smoothFactor[i];
        if (factor <= 0.02) {
            result[i] = { lng: pt.lng, lat: pt.lat, dLng: 0, dLat: 0, isOffset: false };
            continue;
        }

        const offsetM = baseOffsetMeters * factor;
        const rightRad = (((bearings[i] + 90) % 360) * Math.PI) / 180;
        const eastM = offsetM * Math.sin(rightRad);
        const northM = offsetM * Math.cos(rightRad);

        const dLat = northM / 111320;
        const cosLat = Math.max(0.2, Math.cos((pt.lat * Math.PI) / 180));
        const dLng = eastM / (111320 * cosLat);

        result[i] = {
            lng: Number((pt.lng + dLng).toFixed(6)),
            lat: Number((pt.lat + dLat).toFixed(6)),
            dLng,
            dLat,
            isOffset: true
        };
    }

    return result;
}

// 優化軌跡圖層更新：合併連續同狀態線段，並套用來回重複路段右側平行偏移視覺座標（若遇到 isSegmentStart 獨立手繪線段則斷開不自動接頭尾）
function buildRouteLayerFeatures(points) {
    const musicFeatures = [], silentFeatures = [];
    if (Array.isArray(points) && points.length >= 2) {
        const visualPts = computeVisualRightOffsetCoords(points);
        let currentCoords = [[visualPts[0].lng, visualPts[0].lat]];
        let currentIsMusic = Boolean(points[1].musicActive);

        for (let i = 1; i < points.length; i++) {
            const pt = points[i];
            const vPt = visualPts[i];
            const isMusic = Boolean(pt.musicActive);

            // 若為獨立手繪筆畫起點 (isSegmentStart === true)，先結束前一段，嚴禁將前段尾巴與新筆畫起點連成跨區直線
            if (pt.isSegmentStart) {
                if (currentCoords.length >= 2) {
                    const feature = { type: 'Feature', geometry: { type: 'LineString', coordinates: currentCoords } };
                    if (currentIsMusic) musicFeatures.push(feature);
                    else silentFeatures.push(feature);
                }
                currentCoords = [[vPt.lng, vPt.lat]];
                const nextMusic = (i + 1 < points.length && !points[i + 1].isSegmentStart)
                    ? Boolean(points[i + 1].musicActive)
                    : isMusic;
                currentIsMusic = nextMusic;
                continue;
            }

            if (isMusic === currentIsMusic) {
                currentCoords.push([vPt.lng, vPt.lat]);
            } else {
                if (currentCoords.length >= 2) {
                    const feature = { type: 'Feature', geometry: { type: 'LineString', coordinates: currentCoords } };
                    if (currentIsMusic) musicFeatures.push(feature);
                    else silentFeatures.push(feature);
                }
                const prevVPt = visualPts[i - 1];
                currentCoords = [[prevVPt.lng, prevVPt.lat], [vPt.lng, vPt.lat]];
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
    cachedBgRouteGeoJSON = emptyGeoJSON();
    cachedMusicRouteGeoJSON = { type: 'FeatureCollection', features: musicFeatures };
    cachedSilentRouteGeoJSON = { type: 'FeatureCollection', features: silentFeatures };
    ensureCustomRouteSourcesAndLayers();
    map.getSource('bg-route')?.setData(cachedBgRouteGeoJSON);
    map.getSource('route-music')?.setData(cachedMusicRouteGeoJSON);
    map.getSource('route-Silent')?.setData(cachedSilentRouteGeoJSON);
}

// ==========================================
// 👾 動態軌跡變色（小精靈吃路線）與路線進度／雙層語音預警核心輔助函數
// - 已行駛路段（索引 0 至 currentTrackIndex）：渲染於 bg-route（日間半透明淺灰，夜間高亮度綠色 #22c55e）
// - 未行駛路段（索引 currentTrackIndex 至終點）：日間維持高亮綠/藍，夜間改為高對比螢光天藍色 (#00E5FF) 並加粗 1px
// ==========================================
function updateProgressRouteLayers(points, currentTrackIndex, exactPos = null, throttleMs = 0) {
    if (throttleMs > 0) {
        const now = performance.now();
        if (now - lastRouteLayerRenderTime < throttleMs) return;
        lastRouteLayerRenderTime = now;
    } else {
        lastRouteLayerRenderTime = performance.now();
    }

    ensureCustomRouteSourcesAndLayers();

    if (!Array.isArray(points) || points.length < 2) {
        cachedBgRouteGeoJSON = emptyGeoJSON();
        cachedMusicRouteGeoJSON = emptyGeoJSON();
        cachedSilentRouteGeoJSON = emptyGeoJSON();
        map.getSource('bg-route')?.setData(cachedBgRouteGeoJSON);
        map.getSource('route-music')?.setData(cachedMusicRouteGeoJSON);
        map.getSource('route-Silent')?.setData(cachedSilentRouteGeoJSON);
        return;
    }

    const maxIdx = points.length - 1;
    const clampedIdx = Math.min(Math.max(Math.floor(currentTrackIndex), 0), maxIdx);

    // 1. 已行駛路段（0 至 currentTrackIndex）：日間半透明淺灰色 / 夜間高亮度綠色 (bg-route)
    const traveledFeatures = [];
    let currentTraveledCoords = [];
    for (let i = 0; i <= clampedIdx; i++) {
        if (i > 0 && points[i].isSegmentStart) {
            if (currentTraveledCoords.length >= 2) {
                traveledFeatures.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: currentTraveledCoords } });
            }
            currentTraveledCoords = [[points[i].lng, points[i].lat]];
        } else {
            currentTraveledCoords.push([points[i].lng, points[i].lat]);
        }
    }
    if (exactPos && typeof exactPos.lng === 'number' && typeof exactPos.lat === 'number') {
        const lastC = currentTraveledCoords[currentTraveledCoords.length - 1];
        if (!lastC || lastC[0] !== exactPos.lng || lastC[1] !== exactPos.lat) {
            currentTraveledCoords.push([exactPos.lng, exactPos.lat]);
        }
    }
    if (currentTraveledCoords.length >= 2) {
        traveledFeatures.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: currentTraveledCoords } });
    }
    if (traveledFeatures.length > 0) {
        cachedBgRouteGeoJSON = {
            type: 'FeatureCollection',
            features: traveledFeatures
        };
    } else {
        cachedBgRouteGeoJSON = emptyGeoJSON();
    }
    map.getSource('bg-route')?.setData(cachedBgRouteGeoJSON);

    // 2. 未行駛路段（currentTrackIndex 至終點）：夜間高對比螢光天藍色 (#00E5FF) 加粗 1px ／ 日間原色
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
    cachedMusicRouteGeoJSON = { type: 'FeatureCollection', features: musicFeatures };
    cachedSilentRouteGeoJSON = { type: 'FeatureCollection', features: silentFeatures };
    map.getSource('route-music')?.setData(cachedMusicRouteGeoJSON);
    map.getSource('route-Silent')?.setData(cachedSilentRouteGeoJSON);
}

// 計算路線各節點的累積里程（公尺），用於精準計算沿路線前瞻距離（Look-ahead Distance）
function buildCumulativeRouteMeters(pts) {
    if (!Array.isArray(pts) || pts.length === 0) return [];
    const cum = new Array(pts.length).fill(0);
    for (let i = 1; i < pts.length; i++) {
        if (pts[i].isSegmentStart) {
            cum[i] = cum[i - 1];
        } else {
            const segM = getDistanceKm(pts[i - 1].lng, pts[i - 1].lat, pts[i].lng, pts[i].lat) * 1000;
            cum[i] = cum[i - 1] + segM;
        }
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

// 進度鎖定追蹤器（前方滑動視窗 Sliding Window）：
// 初次進入「遵循路線」導航時決定起始進度索引：
// 1. 起點 80m 內優先從起點端開始匹配（防止與回程重疊誤跳後段）
// 2. 半路切入時僅從最接近的軌跡段起算，禁止直接跳至路線終點末端
function findInitialFollowTrackIndex(pts, lng, lat, vehicleHeading, isMoving, cumMeters = null) {
    if (!Array.isArray(pts) || pts.length === 0) return { trackIndex: 0, minDistMeters: Infinity };
    const maxIdx = pts.length - 1;
    const distToStart = getDistanceKm(lng, lat, pts[0].lng, pts[0].lat) * 1000;

    // 情況 1：起點在 80 公尺內 -> 僅於起點前端 80 公尺視窗內匹配
    if (distToStart <= 80) {
        let bestIdx = 0;
        let bestDist = distToStart;
        for (let i = 0; i <= maxIdx; i++) {
            const alongM = (Array.isArray(cumMeters) && cumMeters.length === pts.length)
                ? (cumMeters[i] || 0)
                : 0;
            if (i > 1 && alongM > 80) break;
            const d = getDistanceKm(lng, lat, pts[i].lng, pts[i].lat) * 1000;
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        return { trackIndex: bestIdx, minDistMeters: bestDist };
    }

    // 情況 2：半路切入 -> 搜尋最接近軌跡段，但排除路線終點最末端（避免直接跳至終點）
    const safeMaxInitialIdx = pts.length >= 15
        ? Math.max(0, Math.min(maxIdx - 5, Math.floor(maxIdx * 0.9)))
        : Math.max(0, maxIdx - 1);

    let bestIdx = 0;
    let bestScore = Infinity;
    let bestDist = Infinity;
    for (let i = 0; i <= safeMaxInitialIdx; i++) {
        const d = getDistanceKm(lng, lat, pts[i].lng, pts[i].lat) * 1000;
        let penalty = 0;
        if (isMoving) {
            const segB = getRouteSegmentBearing(pts, i);
            const angDiff = Math.abs(getAngleDiff(vehicleHeading, segB));
            if (angDiff > 60) penalty += 35;
        }
        const score = d + penalty;
        if (score < bestScore) {
            bestScore = score;
            bestIdx = i;
            bestDist = d;
        }
    }
    return { trackIndex: bestIdx, minDistMeters: bestDist };
}

// 僅從目前 prevTrackIndex 往前方合理視窗範圍（沿線約 220 公尺內、最多 60 個節點）順序搜尋下一進度點，
// 嚴禁無限制全域搜尋跳躍至後半段重疊軌跡，防止折返或重複路口瞬間跳過中間語音點
function computeNextTrackIndex(pts, prevTrackIndex, lng, lat, vehicleHeading, isMoving, cumMeters = null) {
    if (!Array.isArray(pts) || pts.length === 0) return { trackIndex: 0, minDistMeters: Infinity };
    const maxIdx = pts.length - 1;
    const startIdx = Math.min(Math.max(0, prevTrackIndex), maxIdx);
    const maxWindowNodeIdx = Math.min(maxIdx, startIdx + 60);
    const MAX_WINDOW_ALONG_METERS = 220;

    let bestLocalIdx = startIdx;
    let bestLocalScore = Infinity;
    let bestLocalDist = Infinity;
    let accumulatedAlongMeters = 0;

    for (let i = startIdx; i <= maxWindowNodeIdx; i++) {
        if (i > startIdx) {
            if (Array.isArray(cumMeters) && cumMeters.length === pts.length) {
                accumulatedAlongMeters = Math.max(0, (cumMeters[i] || 0) - (cumMeters[startIdx] || 0));
            } else {
                accumulatedAlongMeters += getDistanceKm(pts[i - 1].lng, pts[i - 1].lat, pts[i].lng, pts[i].lat) * 1000;
            }
            // 至少允許檢查緊鄰的下一個節點 (startIdx + 1)，超過沿線 220 公尺則停止往後擴張視窗
            if (i > startIdx + 1 && accumulatedAlongMeters > MAX_WINDOW_ALONG_METERS) {
                break;
            }
        }

        const d = getDistanceKm(lng, lat, pts[i].lng, pts[i].lat) * 1000;
        let penalty = (i - startIdx) * 0.25; // 微小順序權重：同距離時優先推進較近序號節點，不跨圈跳躍
        if (isMoving) {
            const segB = getRouteSegmentBearing(pts, i);
            const angDiff = Math.abs(getAngleDiff(vehicleHeading, segB));
            if (angDiff > 60) penalty += 35; // 逆向或垂直重疊路段加權懲罰，避免跳到回程
        }
        const score = d + penalty;
        if (score < bestLocalScore) {
            bestLocalScore = score;
            bestLocalIdx = i;
            bestLocalDist = d;
        }
    }

    // 僅在車輛位於前方滑動視窗軌跡附近 (<= 45m，容許現場 GPS 15~30m 飄移) 時順序推進 currentTrackIndex，絕不全域跳號
    if (bestLocalDist <= 45) {
        return {
            trackIndex: Math.max(startIdx, bestLocalIdx),
            minDistMeters: bestLocalDist
        };
    }

    return {
        trackIndex: startIdx,
        minDistMeters: bestLocalDist
    };
}

// 整理並重置路線所有語音標記點（包含開關音樂與黃色提醒點），重置 played / prePlayed 狀態
function prepareVoiceMarkerEvents(route, includeImplicitMusicTransitions = false) {
    const pts = route?.points || [];
    if (pts.length === 0) return [];

    const rawList = (route.events || []).map(ev => {
        ev.played = false;
        ev.prePlayed = false;

        const hasExplicitPointIndex = (
            typeof ev.pointIndex === 'number' &&
            Number.isInteger(ev.pointIndex) &&
            ev.pointIndex >= 0 &&
            ev.pointIndex < pts.length
        );
        let evPtIdx = hasExplicitPointIndex
            ? ev.pointIndex
            : ((typeof ev.ptIdx === 'number' && ev.ptIdx >= 0 && ev.ptIdx < pts.length) ? ev.ptIdx : -1);
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
            pointIndex: hasExplicitPointIndex ? ev.pointIndex : undefined,
            hasExplicitPointIndex,
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
    prevTrackIndex = null,
    lng,
    lat,
    vehicleBearing,
    onTriggerWake = false,
    isFollowMode = false
}) {
    if (!Array.isArray(events) || events.length === 0 || !Array.isArray(pts) || pts.length < 2) return;
    const maxIdx = pts.length - 1;
    const trackIdx = Math.min(Math.max(Math.floor(currentTrackIndex), 0), maxIdx);
    const prevIdx = (typeof prevTrackIndex === 'number' && !isNaN(prevTrackIndex))
        ? Math.min(Math.max(Math.floor(prevTrackIndex), 0), maxIdx)
        : trackIdx;
    const currentTrackCumM = cumMeters[trackIdx] || 0;
    const currentSegBearing = getRouteSegmentBearing(pts, trackIdx);

    const lookAheadDist = Number(systemNavConfig.lookAheadDistMeters) || DEFAULT_SYSTEM_CONFIG.lookAheadDistMeters;
    const rawConfirmDist = Number(systemNavConfig.confirmDistMeters) || DEFAULT_SYSTEM_CONFIG.confirmDistMeters;
    // 遵循導航模式確保至少 42 公尺（35~45m 區間）容錯半徑，吸收現場 GPS 飄移
    const confirmDist = isFollowMode ? Math.max(rawConfirmDist, 42) : rawConfirmDist;
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

        const REMINDER_POINT_INDEX_WINDOW = 20;
        const idxDeltaToEvent = Math.abs(trackIdx - evIdx);
        const isInPointIndexWindow = (!ev.hasExplicitPointIndex || idxDeltaToEvent <= REMINDER_POINT_INDEX_WINDOW);

        // --- 第二層：近距離確認提醒（含語音開啟、關閉、注意點） ---
        let shouldTriggerConfirm = false;
        if (isFollowMode) {
            // 雙重防呆觸發條件（具 pointIndex 時須同步落於前後 20 個節點窗口內，防止去回程重疊路線跨趟誤報）：
            // A. 實際座標進入容錯半徑（35~45m 以上），且位於該路段合理前後區間內
            const enteredRadius = (
                isInPointIndexWindow &&
                directDistMeters <= confirmDist &&
                ((aheadRouteMeters <= (confirmDist + 35) && aheadRouteMeters >= -75) || (!ev.hasExplicitPointIndex && idxDeltaToEvent <= 35))
            );
            // B. 路線進度索引已順序推進越過該提醒點所在軌跡位置（且該點尚未觸發過）
            const passedByProgress = (
                isInPointIndexWindow &&
                trackIdx >= evIdx &&
                (prevIdx <= evIdx || (trackIdx - evIdx) <= 20) &&
                aheadRouteMeters >= -90
            );
            shouldTriggerConfirm = (enteredRadius || passedByProgress);
        } else {
            // 重播模式維持原有嚴格三條件（具 pointIndex 時同步套用前後 20 個節點窗口保護）
            const isWithinConfirmRadius = (directDistMeters <= confirmDist && aheadRouteMeters <= (confirmDist + 5) && aheadRouteMeters >= -30);
            const bearingDiffConfirm = Math.abs(getAngleDiff(vehicleBearing, markerSegBearing));
            const isConfirmDirectionAligned = (bearingDiffConfirm <= bearingTol);
            const isConfirmIndexInZone = (isInPointIndexWindow && trackIdx <= evIdx + 12 && aheadRouteMeters <= (confirmDist + 5) && aheadRouteMeters >= -30);
            shouldTriggerConfirm = (isWithinConfirmRadius && isConfirmDirectionAligned && isConfirmIndexInZone);
        }

        if (shouldTriggerConfirm && ev.played !== true) {
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
                speakText(ev.note || '注意路況');
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
        const bearingDiffConfirm = Math.abs(getAngleDiff(vehicleBearing, markerSegBearing));
        const bearingDiffCurrentSeg = Math.abs(getAngleDiff(vehicleBearing, currentSegBearing));
        const isLookAheadDirectionAligned = isFollowMode
            ? (bearingDiffCurrentSeg <= Math.max(bearingTol, 60) || bearingDiffConfirm <= Math.max(bearingTol, 60))
            : (bearingDiffCurrentSeg <= bearingTol || bearingDiffConfirm <= bearingTol);
        // 條件 3：currentTrackIndex 位於標記點前瞻索引區間（trackIdx < evIdx）且尚未播報（具 pointIndex 時限制於合理前瞻節點範圍內）
        const isLookAheadIndexInZone = (trackIdx < evIdx && (!ev.hasExplicitPointIndex || (evIdx - trackIdx) <= 45));

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

// ==========================================
// 🔘 路線注意提醒與音樂提醒「已碰觸／已通過」變灰狀態管理
// ==========================================
const ROUTE_REMINDER_TOUCH_RADIUS_METERS = 30;
const passedReminderKeys = new Set();
let routeReminderMarkerEntries = [];

function buildRouteReminderKey(type, lng, lat) {
    if (type !== 'on' && type !== 'off' && type !== 'alert') return '';
    const lngNum = Number(lng);
    const latNum = Number(lat);
    if (!Number.isFinite(lngNum) || !Number.isFinite(latNum)) return '';
    return `${type}:${lngNum.toFixed(6)},${latNum.toFixed(6)}`;
}

function registerRouteReminderMarker(type, lng, lat, targetEl) {
    const key = buildRouteReminderKey(type, lng, lat);
    if (!key || !targetEl) return;
    routeReminderMarkerEntries.push({
        key,
        type,
        lng: Number(lng),
        lat: Number(lat),
        targetEl
    });
    if (passedReminderKeys.has(key)) {
        targetEl.classList.add('is-reminder-passed');
    }
}

function markRouteReminderKeyPassed(key) {
    if (!key || passedReminderKeys.has(key)) return;
    passedReminderKeys.add(key);
    for (let i = 0; i < routeReminderMarkerEntries.length; i++) {
        const entry = routeReminderMarkerEntries[i];
        if (entry.key === key && entry.targetEl) {
            entry.targetEl.classList.add('is-reminder-passed');
        }
    }
}

function resetPassedRouteReminders() {
    passedReminderKeys.clear();
    for (let i = 0; i < routeReminderMarkerEntries.length; i++) {
        const entry = routeReminderMarkerEntries[i];
        if (entry.targetEl) {
            entry.targetEl.classList.remove('is-reminder-passed');
        }
    }
}

function updatePassedRouteReminders({
    events,
    pts,
    cumMeters,
    currentTrackIndex,
    lng,
    lat,
    touchRadiusMeters = ROUTE_REMINDER_TOUCH_RADIUS_METERS
}) {
    if (!Array.isArray(events) || events.length === 0 || !Array.isArray(pts) || pts.length < 2) return;
    const maxIdx = pts.length - 1;
    const trackIdx = Math.min(Math.max(Math.floor(currentTrackIndex), 0), maxIdx);
    const currentTrackCumM = (Array.isArray(cumMeters) && cumMeters.length > trackIdx) ? (cumMeters[trackIdx] || 0) : 0;

    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (!ev || (ev.type !== 'on' && ev.type !== 'off' && ev.type !== 'alert')) continue;
        const key = buildRouteReminderKey(ev.type, ev.lng, ev.lat);
        if (!key || passedReminderKeys.has(key)) continue;

        const evIdx = Math.min(Math.max(typeof ev.ptIdx === 'number' ? ev.ptIdx : 0, 0), maxIdx);
        const evCumM = (Array.isArray(cumMeters) && cumMeters.length > evIdx) ? (cumMeters[evIdx] || 0) : 0;
        const aheadRouteMeters = evCumM - currentTrackCumM;
        const directDistMeters = getDistanceKm(lng, lat, ev.lng, ev.lat) * 1000;

        // 雙重條件（不干擾原語音觸發時機；具 pointIndex 時嚴格限定前後 20 個節點窗口內才允許觸發變灰，避免重疊路段跨趟提前變灰）：
        const idxDelta = Math.abs(evIdx - trackIdx);
        const withinPointWindow = (!ev.hasExplicitPointIndex || idxDelta <= 20);
        // 1. 車輛座標進入合理觸發半徑（約 30 公尺）且位於該提醒對應的軌跡進度區間內
        const enteredTouchRadius = (
            withinPointWindow &&
            directDistMeters <= touchRadiusMeters &&
            ((aheadRouteMeters <= (touchRadiusMeters + 35) && aheadRouteMeters >= -60) || (!ev.hasExplicitPointIndex && idxDelta <= 25))
        );
        // 2. 路線行進／重播進度已通過該提醒綁定的軌跡節點
        const passedTrackNode = (trackIdx >= evIdx && (!ev.hasExplicitPointIndex || (trackIdx - evIdx) <= 20));

        if (enteredTouchRadius || passedTrackNode) {
            markRouteReminderKeyPassed(key);
        }
    }
}

let activeAlertPopupMarker = null;
let activeAlertPopupKey = null;
let activeAlertPinElement = null;

function closeActiveAlertPopup() {
    if (activeAlertPopupMarker) {
        try { activeAlertPopupMarker.remove(); } catch (e) {}
        activeAlertPopupMarker = null;
    }
    activeAlertPopupKey = null;
    if (activeAlertPinElement) {
        activeAlertPinElement.classList.remove('is-active');
        activeAlertPinElement = null;
    }
}

function refreshCurrentRouteMarkers(route) {
    if (!route) return;
    const detailEventsEl = document.getElementById('detailEvents');
    if (detailEventsEl) {
        detailEventsEl.innerText = `${(route.events || []).length} 處`;
    }
    if (isEditingMode) {
        renderEditableRouteMarkers(route);
    } else {
        renderRouteMarkers(route);
    }
}

function openAlertPopupCard(route, ev, eventIdx, pinEl) {
    if (!route || !ev) return;
    const key = `${eventIdx}_${ev.lng}_${ev.lat}`;
    if (activeAlertPopupKey === key && activeAlertPopupMarker) {
        closeActiveAlertPopup();
        return;
    }

    closeActiveAlertPopup();
    activeAlertPopupKey = key;
    if (pinEl) {
        pinEl.classList.add('is-active');
        activeAlertPinElement = pinEl;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'alert-popup-wrapper';
    wrapper.onclick = (e) => e.stopPropagation();

    const card = document.createElement('div');
    card.className = 'alert-popup-card';

    // 頂部標題列與關閉按鈕
    const headerRow = document.createElement('div');
    headerRow.className = 'flex items-center justify-between gap-2 pb-1 border-b border-amber-100';
    headerRow.innerHTML = `
        <span class="text-[11px] font-black text-amber-700 flex items-center gap-1">
            <i class="fa-solid fa-triangle-exclamation text-amber-500"></i> 警示提醒
        </span>
    `;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'w-5 h-5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center text-[11px] font-black active:scale-90';
    closeBtn.innerHTML = '✕';
    closeBtn.title = '收合';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeActiveAlertPopup();
    };
    headerRow.appendChild(closeBtn);
    card.appendChild(headerRow);

    // 完整警示文字（自動換行 max-width: 220px, white-space: normal, word-break: break-word）
    const noteEl = document.createElement('div');
    noteEl.className = 'alert-popup-note';
    noteEl.textContent = ev.note || '注意路況';
    card.appendChild(noteEl);

    // 若附有實景照片，顯示縮圖供點擊放大
    if (ev.photo) {
        const photoBtn = document.createElement('button');
        photoBtn.type = 'button';
        photoBtn.className = 'w-full h-24 mb-2 rounded-xl overflow-hidden border border-amber-200 relative block active:scale-[0.98] transition-transform';
        photoBtn.title = '點擊放大檢視照片';
        const img = document.createElement('img');
        img.src = ev.photo;
        img.alt = '提醒照片';
        img.className = 'w-full h-full object-cover';
        const badge = document.createElement('span');
        badge.className = 'absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md';
        badge.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus mr-0.5"></i>放大照片';
        photoBtn.appendChild(img);
        photoBtn.appendChild(badge);
        photoBtn.onclick = (e) => {
            e.stopPropagation();
            if (typeof window.openPhotoLightbox === 'function') {
                window.openPhotoLightbox(ev.photo);
            }
        };
        card.appendChild(photoBtn);
    }

    // 底部操作按鈕列（✏️ 編輯 / 🗑️ 刪除）：僅限在「路線編輯模式」(isEditingMode === true) 下顯示；
    // 在「遵循導航」與一般「路線預覽」模式下完全隱藏，避免行車或預覽途中誤觸修改或刪除路線提醒
    if (typeof isEditingMode !== 'undefined' && isEditingMode) {
        const actionRow = document.createElement('div');
        actionRow.className = 'flex items-center gap-1.5 pt-1 border-t border-gray-100';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'flex-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-xl py-1.5 px-2 text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95 transition-all';
        editBtn.innerHTML = '<span>✏️ 編輯</span>';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            closeActiveAlertPopup();
            openAlertModalForEdit(route, eventIdx);
        };

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl py-1.5 px-2.5 text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95 transition-all';
        delBtn.innerHTML = '<i class="fa-regular fa-trash-can"></i><span>刪除</span>';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (!confirm(`確定要刪除【${ev.note || '提醒'}】這筆黃色提醒嗎？`)) return;
            closeActiveAlertPopup();
            if (isEditingMode && typeof pushEditUndoSnapshot === 'function') {
                pushEditUndoSnapshot(route);
            }
            if (Array.isArray(route.events) && eventIdx >= 0 && eventIdx < route.events.length) {
                route.events.splice(eventIdx, 1);
            }
            refreshCurrentRouteMarkers(route);
        };

        actionRow.appendChild(editBtn);
        actionRow.appendChild(delBtn);
        card.appendChild(actionRow);
    }

    const arrow = document.createElement('div');
    arrow.className = 'alert-popup-arrow';

    wrapper.appendChild(card);
    wrapper.appendChild(arrow);

    activeAlertPopupMarker = new maplibregl.Marker({
        element: wrapper,
        anchor: 'bottom',
        offset: [0, -40],
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport'
    }).setLngLat([ev.lng, ev.lat]).addTo(map);
}

function formatCompactAlertShortText(rawNote) {
    const clean = String(rawNote || '提醒').trim() || '提醒';
    const chars = Array.from(clean);
    return chars.length > 5 ? `${chars.slice(0, 5).join('')}...` : clean;
}

function createCompactAlertPinMarker(route, ev, eventIdx, options = {}) {
    // 外層 markerEl 作為傳給 new maplibregl.Marker({ element: markerEl }) 的根容器，
    // 嚴禁在外層設定 CSS transform 或負 margin，避免干擾 MapLibre 的 translate3d 經緯度定位！
    const markerEl = document.createElement('div');
    markerEl.className = 'alert-compact-pin';
    markerEl.title = '點擊展開完整警示內容';

    // 內層膠囊（⚠️ ＋ 前 5 字 ＋ 22x22 照片縮圖），點擊與 active 縮放效果皆寫在內層
    const pillEl = document.createElement('div');
    pillEl.className = 'alert-compact-pill';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'text-xs leading-none flex-shrink-0';
    iconSpan.textContent = '⚠️';
    pillEl.appendChild(iconSpan);

    const textSpan = document.createElement('span');
    textSpan.textContent = formatCompactAlertShortText(ev.note);
    pillEl.appendChild(textSpan);

    if (ev.photo) {
        const thumbImg = document.createElement('img');
        thumbImg.src = ev.photo;
        thumbImg.alt = '縮圖';
        thumbImg.className = 'alert-compact-thumb';
        pillEl.appendChild(thumbImg);
    }

    // 正下方小橘色倒三角形指標，讓指標尖端精準對齊綠色路線上的觸發點 [ev.lng, ev.lat]
    const arrowEl = document.createElement('div');
    arrowEl.className = 'alert-compact-arrow';

    // 內層等比例縮放容器（transform-origin: bottom center），確保縮放時尖端不偏移且不覆蓋外層 MapLibre translate3d
    const scaleWrapEl = document.createElement('div');
    scaleWrapEl.className = 'alert-compact-scale-wrap';
    scaleWrapEl.appendChild(pillEl);
    scaleWrapEl.appendChild(arrowEl);

    markerEl.appendChild(scaleWrapEl);

    markerEl.onclick = (e) => {
        e.stopPropagation();
        openAlertPopupCard(route, ev, eventIdx, markerEl);
    };
    const renderLngLat = (Array.isArray(options?.lngLat) && options.lngLat.length >= 2)
        ? options.lngLat
        : [ev.lng, ev.lat];
    const offsetY = (typeof options?.offsetY === 'number' && !isNaN(options.offsetY))
        ? options.offsetY
        : -4;
    const m = new maplibregl.Marker({
        element: markerEl,
        anchor: 'bottom',
        offset: [0, offsetY],
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport'
    }).setLngLat(renderLngLat).addTo(map);
    domMarkers.push(m);
    registerRouteReminderMarker('alert', ev.lng, ev.lat, markerEl);
    return m;
}

function clearDomMarkers() {
    closeActiveAlertPopup();
    if (typeof closeActiveCustomRoutePinPopup === 'function') {
        closeActiveCustomRoutePinPopup();
    }
    if (typeof clearPendingCalloutAnchor === 'function') {
        clearPendingCalloutAnchor();
    }
    if (typeof updateCalloutLeaderLines === 'function') {
        updateCalloutLeaderLines(null);
    }
    if (typeof updateRouteBrushStrokesLayer === 'function') {
        updateRouteBrushStrokesLayer(null);
    }
    if (typeof updateBrushDraftLayer === 'function') {
        updateBrushDraftLayer([]);
    }
    domMarkers.forEach(m => {
        try { m.remove(); } catch (e) {}
    });
    domMarkers = [];
    routeReminderMarkerEntries = [];
    const isActiveRouteRun = Boolean(
        (typeof isReplaying !== 'undefined' && isReplaying) ||
        (typeof followWatchId !== 'undefined' && followWatchId !== null)
    );
    if (!isActiveRouteRun) {
        passedReminderKeys.clear();
    }
}

function addPinMarker(lngLat, htmlContent, options = {}) {
    // 使用乾淨無 transform 的外層 el 傳給 MapLibre Marker，避免內層 .pin-s / .pin-e 的 rotate(-45deg) 與 MapLibre translate3d 衝突
    const el = document.createElement('div');
    el.className = options?.wrapperClass || 'pin-se-wrapper';
    el.innerHTML = htmlContent;
    const m = new maplibregl.Marker({
        element: el,
        anchor: options?.anchor || 'center',
        offset: Array.isArray(options?.offset) ? options.offset : [0, 0],
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport'
    }).setLngLat(lngLat).addTo(map);
    domMarkers.push(m);
    const musicBadgeEl = el.querySelector('.music-marker.music-on-pin, .music-marker.music-off-pin');
    const keyLngLat = (Array.isArray(options?.rawLngLat) && options.rawLngLat.length >= 2) ? options.rawLngLat : lngLat;
    if (musicBadgeEl && Array.isArray(keyLngLat) && keyLngLat.length >= 2) {
        const reminderType = musicBadgeEl.classList.contains('music-on-pin') ? 'on' : 'off';
        registerRouteReminderMarker(reminderType, keyLngLat[0], keyLngLat[1], musicBadgeEl);
    }
}

