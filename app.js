// ==========================================
// 🔑 雲端路線庫管理員密碼設定（可於此處輕鬆修改）
// ==========================================
const ADMIN_PASSWORD = '5201314';

// ==========================================
// 🛡️ 行車弱訊號防凍結保護：5 秒超時中斷 Fetch 封裝
// ==========================================
async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        return response;
    } finally {
        clearTimeout(timerId);
    }
}

// 核心狀態變數
let idleWatchId = null;
let isFollowingCamera = true;
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
        if ('wakeLock' in navigator && !wakeLock) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                wakeLock = null;
            });
        }
    } catch (e) {}
}

async function releaseScreenWakeLockIfIdle() {
    if (isBlackScreenActive || isRecording || followWatchId !== null) return;
    try {
        if (wakeLock) {
            await wakeLock.release();
            wakeLock = null;
        }
    } catch (e) {
        wakeLock = null;
    }
}

function stopIdleGPS() {
    if (idleWatchId !== null) {
        navigator.geolocation.clearWatch(idleWatchId);
        idleWatchId = null;
    }
}

function startIdleGPS() {
    stopIdleGPS();
    if (!('geolocation' in navigator)) return;
    idleWatchId = navigator.geolocation.watchPosition(pos => {
        const lng = pos.coords.longitude, lat = pos.coords.latitude;
        lastKnownLngLat = [lng, lat];
        if (typeof window.onFleetPositionUpdate === 'function') window.onFleetPositionUpdate(lat, lng);
        if (!isPowerSaveMapPaused()) {
            if (vehicleMarker) vehicleMarker.setLngLat(lastKnownLngLat);
            const acc = Math.round(pos.coords.accuracy);
            const accEl = document.getElementById('accuracyText');
            if (accEl) accEl.innerText = `± ${acc} m`;
        }
    }, () => {}, { enableHighAccuracy: true });
}

let savedRoutes = [];
let selectedRouteIdx = -1;
let domMarkers = []; 

function generateRouteId() {
    return 'rt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

function ensureRoutesHaveRouteId(routes) {
    if (!Array.isArray(routes)) return false;
    let mutated = false;
    routes.forEach((r, idx) => {
        if (r && !r.routeId) {
            const seed = r.originId || r.id || (Date.now() + idx);
            r.routeId = 'rt_' + String(seed) + '_' + Math.random().toString(36).substring(2, 6);
            mutated = true;
        }
    });
    return mutated;
}

// 🚀 自動搬家與讀取大容量資料庫（自動補發唯一 routeId）
localforage.getItem('yinggeCleanRoutes_v2').then((value) => {
    const oldStorage = localStorage.getItem('yinggeCleanRoutes_v2');
    if (value && value.length > 0) {
        savedRoutes = value;
    } else if (oldStorage) {
        savedRoutes = JSON.parse(oldStorage);
        localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => {
            localStorage.removeItem('yinggeCleanRoutes_v2');
            console.log("✅ 舊路線已成功搬移至大容量資料庫！");
        });
    }
    if (ensureRoutesHaveRouteId(savedRoutes)) {
        localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);
    }
    document.getElementById('historyCount').innerText = savedRoutes.length;
}).catch((err) => console.log("讀取路線失敗:", err));

// --- 1. 初始化 MapLibre GL 向量旋轉地圖 ---
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            'google-maps': {
                type: 'raster',
                tiles: ['https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'],
                tileSize: 256,
                attribution: '© Google'
            }
        },
        layers: [{ id: 'google-maps-layer', type: 'raster', source: 'google-maps' }]
    },
    center: [121.346, 24.954],
    zoom: 16, bearing: 0, pitch: 0, dragRotate: true, touchZoomRotate: true
});

setTimeout(() => { map.resize(); }, 500);
window.addEventListener('resize', () => map.resize());

const puckEl = document.createElement('div');
puckEl.className = 'nav-puck';
puckEl.innerHTML = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 100" style="width:100%; height:100%; transform: rotate(0deg);">
    <rect x="4" y="15" width="8" height="20" rx="3" fill="#1f2937"/>
    <rect x="48" y="15" width="8" height="20" rx="3" fill="#1f2937"/>
    <rect x="4" y="65" width="8" height="20" rx="3" fill="#1f2937"/>
    <rect x="48" y="65" width="8" height="20" rx="3" fill="#1f2937"/>
    <rect x="8" y="5" width="44" height="90" rx="10" fill="#facc15" stroke="#ca8a04" stroke-width="2"/>
    <path d="M 14 30 L 46 30 L 42 12 L 18 12 Z" fill="#1e293b"/>
    <rect x="22" y="6" width="16" height="3" rx="1.5" fill="#ef4444"/>
    <rect x="12" y="62" width="36" height="30" rx="4" fill="#eab308" stroke="#ca8a04" stroke-width="1.5"/>
    <rect x="14" y="85" width="32" height="6" fill="#ffffff"/>
    <polygon points="14,91 22,85 30,91" fill="#ef4444"/>
    <polygon points="30,91 38,85 46,91" fill="#3b82f6"/>
</svg>`;

let vehicleMarker = null;

map.on('load', () => {
    vehicleMarker = new maplibregl.Marker({ element: puckEl, rotationAlignment: 'map' }).setLngLat(lastKnownLngLat).addTo(map);
    
    map.addSource('bg-route', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'bg-route-line', type: 'line', source: 'bg-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#94a3b8', 'line-width': 6, 'line-opacity': 0.45 } });
    map.addSource('route-Silent', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'route-silent-line', type: 'line', source: 'route-Silent', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#3b82f6', 'line-width': 6, 'line-dasharray': [2, 2] } });
    map.addSource('route-music', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'route-music-line', type: 'line', source: 'route-music', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#16a34a', 'line-width': 7 } });
    map.addSource('freehand-temp-source', { type: 'geojson', data: emptyGeoJSON() });
    map.addLayer({ id: 'freehand-temp-layer', type: 'line', source: 'freehand-temp-source', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#f97316', 'line-width': 6, 'line-dasharray': [2, 1.5], 'line-opacity': 0.95 } });

    startIdleGPS();
    navigator.geolocation?.getCurrentPosition(pos => {
        map.jumpTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 17 });
    });
});

function emptyGeoJSON() { return { type: 'FeatureCollection', features: [] }; }

// --- 2. 視角操作 ---
['dragstart', 'touchstart', 'wheel', 'rotatestart', 'pitchstart'].forEach(evt => {
    map.on(evt, (e) => { if (e.originalEvent) setCameraFollow(false); });
});

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
    map.easeTo({
        center: lastKnownLngLat, zoom: Math.max(map.getZoom(), 17),
        bearing: isHeadingUpMode ? currentHeading : 0, offset: [0, 100], duration: 400
    });
};

document.getElementById('headingModeBtn').onclick = () => {
    isHeadingUpMode = !isHeadingUpMode;
    const btn = document.getElementById('headingModeBtn');
    const label = document.getElementById('headingLabel');
    if (isHeadingUpMode) {
        btn.className = "bg-blue-600 text-white w-11 h-11 rounded-2xl shadow-lg flex flex-col items-center justify-center active:scale-95";
        label.innerText = "車頭上";
        if (isFollowingCamera) map.easeTo({ bearing: currentHeading, duration: 300 });
    } else {
        btn.className = "bg-white text-gray-700 w-11 h-11 rounded-2xl shadow-lg flex flex-col items-center justify-center active:scale-95";
        label.innerText = "正北上";
        if (isFollowingCamera) map.easeTo({ bearing: 0, duration: 300 });
    }
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
// 🔊 強化語音播報穩定度（解決偶發無聲與 GC 切斷問題）
// ==========================================
let isVoiceEnabled = true;
window._activeSpeechUtterance = null;

function speakText(text) {
    // 如果開關被關掉，或是手機不支援語音，就直接中斷不講話！
    if (!isVoiceEnabled || !('speechSynthesis' in window) || !text) return;
    try {
        window.speechSynthesis.cancel();
        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
        }
        const u = new SpeechSynthesisUtterance(String(text));
        u.lang = 'zh-TW';
        u.rate = 1.05;
        u.onend = () => {
            if (window._activeSpeechUtterance === u) {
                window._activeSpeechUtterance = null;
            }
        };
        u.onerror = () => {
            if (window._activeSpeechUtterance === u) {
                window._activeSpeechUtterance = null;
            }
            try { window.speechSynthesis.cancel(); } catch (e) {}
        };
        // 將 SpeechSynthesisUtterance 實例保存於全域變數中，避免被瀏覽器垃圾回收機制中途切斷導致無聲
        window._activeSpeechUtterance = u;
        window.speechSynthesis.speak(u);
    } catch (e) {
        window._activeSpeechUtterance = null;
    }
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
        
        // 強制中斷目前正在唸的語音
        if ('speechSynthesis' in window) {
            try { window.speechSynthesis.cancel(); } catch (e) {}
        }
        window._activeSpeechUtterance = null;
    }
};

function vibrate(pattern) { if ('vibrate' in navigator) navigator.vibrate(pattern); }

// 優化軌跡圖層更新：合併連續同狀態線段，大幅減少 GeoJSON Feature 物件數量，防止長時間跑車或重播時手機發熱卡頓
function updateRouteLayers(points, throttleMs = 0) {
    if (throttleMs > 0) {
        const now = performance.now();
        if (now - lastRouteLayerRenderTime < throttleMs) return;
        lastRouteLayerRenderTime = now;
    } else {
        lastRouteLayerRenderTime = performance.now();
    }

    const musicFeatures = [], silentFeatures = [];
    if (Array.isArray(points) && points.length >= 2) {
        let currentCoords = [[points[0].lng, points[0].lat]];
        let currentIsMusic = Boolean(points[1].musicActive);

        for (let i = 1; i < points.length; i++) {
            const pt = points[i];
            const isMusic = Boolean(pt.musicActive);
            if (isMusic === currentIsMusic) {
                currentCoords.push([pt.lng, pt.lat]);
            } else {
                if (currentCoords.length >= 2) {
                    const feature = { type: 'Feature', geometry: { type: 'LineString', coordinates: currentCoords } };
                    if (currentIsMusic) musicFeatures.push(feature);
                    else silentFeatures.push(feature);
                }
                const prevPt = points[i - 1];
                currentCoords = [[prevPt.lng, prevPt.lat], [pt.lng, pt.lat]];
                currentIsMusic = isMusic;
            }
        }
        if (currentCoords.length >= 2) {
            const feature = { type: 'Feature', geometry: { type: 'LineString', coordinates: currentCoords } };
            if (currentIsMusic) musicFeatures.push(feature);
            else silentFeatures.push(feature);
        }
    }
    map.getSource('route-music')?.setData({ type: 'FeatureCollection', features: musicFeatures });
    map.getSource('route-Silent')?.setData({ type: 'FeatureCollection', features: silentFeatures });
}

function clearDomMarkers() {
    domMarkers.forEach(m => {
        try { m.remove(); } catch (e) {}
    });
    domMarkers = [];
}

function addPinMarker(lngLat, htmlContent) {
    const el = document.createElement('div');
    el.innerHTML = htmlContent;
    const m = new maplibregl.Marker({ element: el.firstElementChild }).setLngLat(lngLat).addTo(map);
    domMarkers.push(m);
}

// --- 4. 紀錄路線 ---
const musicToggleBtn = document.getElementById('musicToggleBtn');
function renderMusicButtonState() {
    const icon = document.getElementById('musicBtnIcon');
    const text = document.getElementById('musicBtnText');
    if (musicActive) {
        musicToggleBtn.className = "flex-1 bg-green-600 text-white font-extrabold py-3 px-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg animate-pulse active:scale-95 transition-all";
        icon.className = "fa-solid fa-music text-lg"; text.innerText = "音樂播放中 (點擊關閉)";
    } else {
        musicToggleBtn.className = "flex-1 bg-gray-700 text-white font-extrabold py-3 px-4 rounded-2xl flex items-center justify-center gap-2 shadow-inner active:scale-95 transition-all";
        icon.className = "fa-solid fa-volume-xmark text-lg"; text.innerText = "音樂關閉中 (點擊開啟)";
    }
}

musicToggleBtn.onclick = () => {
    if (!isRecording) return;
    musicActive = !musicActive;
    renderMusicButtonState();
    const evtType = musicActive ? 'on' : 'off';
    musicEvents.push({ type: evtType, lng: lastKnownLngLat[0], lat: lastKnownLngLat[1], bearing: currentHeading });
    
    const badgeHtml = musicActive 
        ? `<div class="music-marker music-on-pin"><i class="fa-solid fa-music"></i> 開音樂</div>`
        : `<div class="music-marker music-off-pin"><i class="fa-solid fa-volume-xmark"></i> 關音樂</div>`;
    addPinMarker(lastKnownLngLat, badgeHtml);
};

document.getElementById('recordBtn').onclick = async () => {
    stopIdleGPS();
    if (!isRecording) {
        // 單一實例保護：啟動前先清除可能殘留的計時器與定位監聽
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        if (timerInterval !== null) {
            clearInterval(timerInterval);
            timerInterval = null;
        }

        isRecording = true; musicActive = false; renderMusicButtonState();
        routePoints = []; musicEvents = []; totalDistanceKm = 0; elapsedSec = 0;
        clearDomMarkers(); updateRouteLayers([]);
        map.getSource('bg-route')?.setData(emptyGeoJSON());
        startTime = Date.now();

        document.getElementById('idleTopRow').classList.add('hidden');
        document.getElementById('recordingTopRow').classList.remove('hidden');
        document.getElementById('startManualDrawBtn')?.classList.add('hidden');
        document.getElementById('recordBtn').classList.replace('bg-green-700', 'bg-red-600');
        document.getElementById('recordBtnText').innerText = '停止紀錄並儲存';
        document.getElementById('recordBtn').querySelector('i').classList.replace('fa-play', 'fa-stop');
        document.getElementById('appStatusTitle').innerText = '路線紀錄中...';
        setCameraFollow(true);

        await requestScreenWakeLock();

        timerInterval = setInterval(() => {
            elapsedSec = Math.floor((Date.now() - startTime) / 1000);
            if (!isPowerSaveMapPaused()) {
                document.getElementById('timeText').innerText = new Date(elapsedSec * 1000).toISOString().substr(11, 8);
            }
        }, 1000);

        watchId = navigator.geolocation.watchPosition(pos => {
            const now = Date.now();
            const lng = pos.coords.longitude, lat = pos.coords.latitude;
            if (typeof window.onFleetPositionUpdate === 'function') window.onFleetPositionUpdate(lat, lng);
            const acc = Math.round(pos.coords.accuracy);
            if (!isPowerSaveMapPaused()) {
                document.getElementById('recAccuracyText').innerText = `± ${acc} m`;
                if (pos.coords.speed !== null) document.getElementById('speedText').innerText = (pos.coords.speed * 3.6).toFixed(1);
            }

            if (routePoints.length === 0) {
                lastKnownLngLat = [lng, lat];
                routePoints.push({ lng, lat, time: now, musicActive, music: musicActive, bearing: 0 });
                addPinMarker([lng, lat], '<div class="pin-s"><span>S</span></div>');
                if (!isPowerSaveMapPaused() && vehicleMarker) vehicleMarker.setLngLat([lng, lat]);
                lastRecordTime = now;
                return;
            }

            const prev = routePoints[routePoints.length - 1];
            const distKm = getDistanceKm(prev.lng, prev.lat, lng, lat);
            const distM = distKm * 1000;

            if (distM >= minMoveMeters || (now - lastRecordTime >= gpsFreqMs && distM >= 1.5)) {
                currentHeading = getBearing(prev.lng, prev.lat, lng, lat);
                totalDistanceKm += distKm;
                lastKnownLngLat = [lng, lat];
                routePoints.push({ lng, lat, time: now, musicActive, music: musicActive, bearing: currentHeading });

                if (!isPowerSaveMapPaused()) {
                    document.getElementById('distanceText').innerText = totalDistanceKm.toFixed(2);
                    if (vehicleMarker) vehicleMarker.setLngLat([lng, lat]).setRotation(currentHeading);
                    updateRouteLayers(routePoints, 250);

                    if (isFollowingCamera) {
                        map.easeTo({ center: [lng, lat], bearing: isHeadingUpMode ? currentHeading : map.getBearing(), offset: [0, 100], duration: 300 });
                    }
                }
                lastRecordTime = now;
            }
        }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });

    } else {
        if (!confirm("確定要「停止紀錄並儲存」這條路線嗎？\n\n(按「取消」可返回地圖繼續錄製)")) return;

        isRecording = false;
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        if (timerInterval !== null) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        releaseScreenWakeLockIfIdle();

        document.getElementById('recordingTopRow').classList.add('hidden');
        document.getElementById('idleTopRow').classList.remove('hidden');
        document.getElementById('startManualDrawBtn')?.classList.remove('hidden');
        document.getElementById('recordBtn').classList.replace('bg-red-600', 'bg-green-700');
        document.getElementById('recordBtnText').innerText = '開始紀錄路線';
        document.getElementById('recordBtn').querySelector('i').classList.replace('fa-stop', 'fa-play');
        document.getElementById('appStatusTitle').innerText = '鶯歌清運路線助手';

        if (routePoints.length >= 2) {
            const defaultName = "鶯歌路線 " + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            const name = prompt("路線紀錄完成！請輸入路線名稱（如：尖山線第一趟）：", defaultName);
            if (name) {
                const savedAuthor = localStorage.getItem('fleet_user_name') || localStorage.getItem('yinggeRouteLastAuthor') || '凱哥';
                const author = prompt("請輸入這條路線的創作者署名：", savedAuthor) || "熱心隊員";
                localStorage.setItem('yinggeRouteLastAuthor', author);

                const mins = Math.floor(elapsedSec / 60), secs = elapsedSec % 60;
                const nowId = Date.now();
                savedRoutes.unshift({
                    id: nowId, originId: nowId, routeId: generateRouteId(), name, author,
                    date: new Date().toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                    createdAt: new Date(nowId).toISOString(),
                    distance: totalDistanceKm.toFixed(2), timeStr: `${mins}m ${secs}s`,
                    points: routePoints, events: musicEvents,
                    alerts: [], warnings: []
                });
                localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);
                try { localStorage.setItem('yinggeCleanRoutes_v2', JSON.stringify(savedRoutes)); } catch (e) {}
                document.getElementById('historyCount').innerText = savedRoutes.length;
                window.openRouteDetail(0);
            }
        } else {
            alert("移動距離過短，未儲存路線。");
        }
        startIdleGPS();
    }
};

// --- 5. 歷史清單與路線預覽 ---
const historyModal = document.getElementById('historyModal');
const routeSearchInput = document.getElementById('routeSearchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');

if (routeSearchInput) {
    routeSearchInput.oninput = () => renderHistoryList();
}
if (clearSearchBtn) {
    clearSearchBtn.onclick = () => {
        if (routeSearchInput) {
            routeSearchInput.value = '';
            routeSearchInput.focus();
        }
        renderHistoryList();
    };
}

function renderHistoryList() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';

    const rawSearch = routeSearchInput ? routeSearchInput.value : '';
    if (clearSearchBtn) {
        if (rawSearch.length > 0) clearSearchBtn.classList.remove('hidden');
        else clearSearchBtn.classList.add('hidden');
    }
    const keyword = rawSearch.trim().toLowerCase();
    
    if (savedRoutes.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-400 mt-16"><p>尚無儲存的清運路線</p></div>';
        if (window.sortableInstance) { window.sortableInstance.destroy(); window.sortableInstance = null; }
        return;
    }

    const filteredRoutes = savedRoutes
        .map((r, originalIdx) => ({ route: r, originalIdx }))
        .filter(({ route }) => {
            if (!keyword) return true;
            const nameMatch = (route.name || '').toLowerCase().includes(keyword);
            const authorMatch = (route.author || '').toLowerCase().includes(keyword);
            return nameMatch || authorMatch;
        });

    if (filteredRoutes.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-400 mt-16"><i class="fa-solid fa-magnifying-glass text-2xl mb-2 opacity-40"></i><p class="text-sm font-bold">找不到符合的路線或創作者</p></div>';
        if (window.sortableInstance) { window.sortableInstance.destroy(); window.sortableInstance = null; }
        return;
    }

    filteredRoutes.forEach(({ route: r, originalIdx }) => {
        const card = document.createElement('div');
        card.className = "bg-white p-2.5 rounded-2xl shadow-sm border border-gray-100 flex items-stretch gap-2 active:scale-[0.99] transition-transform";
        const authorTag = r.author ? `<span class="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold ml-1.5 whitespace-nowrap"><i class="fa-solid fa-user-ninja mr-1"></i>${r.author}</span>` : '';
        
        card.innerHTML = `
            <div class="drag-handle text-gray-300 w-7 flex items-center justify-center cursor-grab active:cursor-grabbing hover:text-blue-500 flex-shrink-0">
                <i class="fa-solid fa-grip-vertical text-xl"></i>
            </div>
            <div class="route-card-info flex-1 min-w-0 py-1 cursor-pointer">
                <div class="font-black text-gray-900 text-base flex items-center"><span class="truncate">${r.name}</span> ${authorTag}</div>
                <div class="text-xs text-gray-400 mt-0.5 mb-1">${r.date || ''}</div>
                <div class="flex gap-3 text-[11px] font-bold">
                    <span class="text-blue-600"><i class="fa-solid fa-route mr-1"></i>${r.distance} km</span>
                    <span class="text-green-600"><i class="fa-solid fa-music mr-1"></i>${(r.events||[]).length} 處標記</span>
                </div>
            </div>
            <div class="flex flex-col justify-between items-end py-0.5 gap-1 flex-shrink-0">
                <button class="edit-name-btn text-gray-300 hover:text-amber-500 w-8 h-7 flex items-center justify-center rounded-xl active:bg-gray-50 transition-colors" title="更改名稱"><i class="fa-solid fa-pen text-xs"></i></button>
                <button class="upload-cloud-btn bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 px-2.5 py-1 rounded-xl text-[11px] font-extrabold flex items-center gap-1 active:scale-95 transition-all whitespace-nowrap" title="上傳分享至車隊雲端">
                    ⬆️ 上傳至雲端
                </button>
            </div>
        `;

        card.querySelector('.route-card-info').onclick = () => window.openRouteDetail(originalIdx);
        card.querySelector('.edit-name-btn').onclick = (e) => {
            e.stopPropagation();
            const newName = prompt('請輸入新的路線名稱：', r.name);
            if (newName && newName.trim() !== '') {
                savedRoutes[originalIdx].name = newName.trim();
                localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => renderHistoryList());
            }
        };
        const uploadBtn = card.querySelector('.upload-cloud-btn');
        uploadBtn.onclick = (e) => {
            e.stopPropagation();
            uploadRouteToCloud(originalIdx, uploadBtn);
        };
        list.appendChild(card);
    });

    if (window.sortableInstance) window.sortableInstance.destroy();
    window.sortableInstance = new Sortable(list, {
        handle: '.drag-handle', animation: 200, ghostClass: 'opacity-50',
        onEnd: function (evt) {
            if (evt.oldIndex === evt.newIndex) return;
            const fromIdx = filteredRoutes[evt.oldIndex]?.originalIdx;
            const toIdx = filteredRoutes[evt.newIndex]?.originalIdx;
            if (fromIdx === undefined || toIdx === undefined) return;
            const movedItem = savedRoutes.splice(fromIdx, 1)[0];
            savedRoutes.splice(toIdx, 0, movedItem);
            localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => renderHistoryList());
        }
    });
}

document.getElementById('historyBtn').onclick = () => { renderHistoryList(); historyModal.classList.remove('hidden'); };
document.getElementById('closeHistory').onclick = (e) => { 
    e.stopPropagation(); historyModal.classList.add('hidden'); backToMain(); 
};

function renderRouteMarkers(route) {
    clearDomMarkers();
    const pts = route.points;
    if (!pts || pts.length === 0) return;
    addPinMarker([pts[0].lng, pts[0].lat], '<div class="pin-s"><span>S</span></div>');
    addPinMarker([pts[pts.length-1].lng, pts[pts.length-1].lat], '<div class="pin-e"><span>E</span></div>');
    
    (route.events || []).forEach(ev => {
        if (ev.type === 'on') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-on-pin"><i class="fa-solid fa-music"></i> 開</div>`);
        } else if (ev.type === 'off') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-off-pin"><i class="fa-solid fa-volume-xmark"></i> 關</div>`);
        } else if (ev.type === 'alert') {
            const markerEl = document.createElement('div');
            markerEl.className = 'music-marker bg-amber-600 cursor-pointer active:scale-95';
            const camBadge = ev.photo ? '<i class="fa-solid fa-camera ml-1 text-amber-200"></i>' : '';
            markerEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${ev.note || '提醒'}${camBadge}`;
            markerEl.onclick = (e) => {
                e.stopPropagation();
                openViewAlertModal(ev);
            };
            const m = new maplibregl.Marker({ element: markerEl }).setLngLat([ev.lng, ev.lat]).addTo(map);
            domMarkers.push(m);
        }
    });

    (route.points || []).forEach(p => {
        if (p.is_stop) addPinMarker([p.lng, p.lat], `<div class="music-marker bg-indigo-600 border border-white shadow-lg"><i class="fa-regular fa-clock"></i> ${p.scheduled_time || ''}</div>`);
    });
}

function openRouteDetail(idx) {
    selectedRouteIdx = idx; const route = savedRoutes[idx];
    if (!route) return;
    historyModal.classList.add('hidden');
    document.getElementById('mainUI').classList.add('hidden');
    document.getElementById('playbackUI').classList.add('hidden');
    document.getElementById('routeDetailUI').classList.remove('hidden');
    document.getElementById('topBackBtn').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = '路線預覽';

    document.getElementById('detailTitle').innerText = route.name;
    document.getElementById('detailDate').innerText = `保存於 ${route.date} · 創作者：${route.author || '隊員'}`;
    document.getElementById('detailDist').innerText = `${route.distance} km`;
    document.getElementById('detailTime').innerText = route.timeStr;
    document.getElementById('detailEvents').innerText = `${(route.events || []).length} 處`;

    updateRouteLayers(route.points);
    renderRouteMarkers(route);

    const bounds = new maplibregl.LngLatBounds();
    route.points.forEach(p => bounds.extend([p.lng, p.lat]));
    map.fitBounds(bounds, { padding: { top: 80, bottom: 260, left: 50, right: 50 }, bearing: 0, duration: 500 });
}
window.openRouteDetail = openRouteDetail;

document.getElementById('deleteRouteBtn').ontouchend = (e) => {
    e.preventDefault(); e.stopPropagation();
    setTimeout(() => {
        if (confirm('確定要刪除這條清運路線嗎？')) {
            savedRoutes.splice(selectedRouteIdx, 1);
            localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);
            document.getElementById('historyCount').innerText = savedRoutes.length;
            
            document.getElementById('routeDetailUI').classList.add('hidden');
            document.getElementById('topBackBtn').classList.add('hidden');
            clearDomMarkers(); updateRouteLayers([]);
            map.getSource('bg-route')?.setData(emptyGeoJSON());
            
            renderHistoryList();
            document.getElementById('historyModal').classList.remove('hidden');
        }
    }, 100);
};

// --- 路線標記後製編輯引擎 ---
let isEditingMode = false, originalEventsBackup = [], originalPointsBackup = [];
let editStep = 0, editStartIndex = -1, tempMarkerA = null;
let editSubMode = 'marker', pathEditMarkers = [];

// ✍️ 手繪接軌狀態變數與復原堆疊
let freehandUndoStack = [];
let isFreehandDrawing = false;
let freehandStartIndex = -1;
let freehandStrokeCoords = [];

const modeMarkerBtn = document.getElementById('modeMarkerBtn');
const modePathBtn = document.getElementById('modePathBtn');
const modeFreehandBtn = document.getElementById('modeFreehandBtn');
const btnUndoFreehand = document.getElementById('btnUndoFreehand');

function clearPathEditMarkers() {
    pathEditMarkers.forEach(m => {
        try { m.remove(); } catch (e) {}
    });
    pathEditMarkers = [];
}

function ensureFreehandTempLayer() {
    if (!map || !map.isStyleLoaded()) return false;
    if (!map.getSource('freehand-temp-source')) {
        map.addSource('freehand-temp-source', { type: 'geojson', data: emptyGeoJSON() });
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
    return true;
}

function updateFreehandTempLayer(coords) {
    if (!ensureFreehandTempLayer()) return;
    if (!Array.isArray(coords) || coords.length < 2) {
        map.getSource('freehand-temp-source')?.setData(emptyGeoJSON());
        return;
    }
    map.getSource('freehand-temp-source')?.setData({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords }
        }]
    });
}

function cancelActiveFreehandStroke() {
    isFreehandDrawing = false;
    freehandStartIndex = -1;
    freehandStrokeCoords = [];
    updateFreehandTempLayer([]);
}

function updateUndoFreehandBtnUI() {
    if (!btnUndoFreehand) return;
    if (editSubMode === 'freehand' || freehandUndoStack.length > 0) {
        btnUndoFreehand.classList.remove('hidden');
    } else {
        btnUndoFreehand.classList.add('hidden');
    }
    btnUndoFreehand.disabled = (freehandUndoStack.length === 0);
}

function setEditSubMode(mode) {
    editSubMode = mode;
    const inactiveClass = "text-gray-400 font-extrabold text-xs sm:text-sm px-2 py-2 rounded-full transition-colors hover:bg-gray-100 active:scale-95 whitespace-nowrap flex items-center justify-center";
    if (modeMarkerBtn) modeMarkerBtn.className = (mode === 'marker')
        ? "bg-blue-100 text-blue-700 font-extrabold text-xs sm:text-sm px-2 py-2 rounded-full transition-colors active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;
    if (modePathBtn) modePathBtn.className = (mode === 'path')
        ? "bg-emerald-100 text-emerald-700 font-extrabold text-xs sm:text-sm px-2 py-2 rounded-full transition-colors active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;
    if (modeFreehandBtn) modeFreehandBtn.className = (mode === 'freehand')
        ? "bg-emerald-100 text-emerald-700 font-extrabold text-xs sm:text-sm px-2 py-2 rounded-full transition-colors active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;

    const promptEl = document.getElementById('editPromptText');
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    editStep = 0;
    cancelActiveFreehandStroke();

    if (mode === 'marker') {
        try { map.dragPan.enable(); } catch (e) {}
        clearPathEditMarkers();
        if (promptEl) {
            promptEl.className = "bg-amber-500 text-white font-extrabold text-xs px-4 py-1.5 rounded-full shadow-lg pointer-events-auto transition-colors text-center";
            promptEl.innerText = "🛠️ 請點擊地圖軌跡，選擇區段的『起點 (A點)』";
        }
    } else if (mode === 'path') {
        try { map.dragPan.enable(); } catch (e) {}
        if (promptEl) {
            promptEl.className = "bg-emerald-600 text-white font-extrabold text-xs px-4 py-1.5 rounded-full shadow-lg pointer-events-auto transition-colors text-center";
            promptEl.innerText = "🛣️ 點擊綠/藍色軌跡產生「編輯點」，並拖拉修改路線";
        }
    } else if (mode === 'freehand') {
        clearPathEditMarkers();
        try { map.dragPan.disable(); } catch (e) {}
        if (promptEl) {
            promptEl.className = "bg-emerald-600 text-white font-extrabold text-xs px-4 py-1.5 rounded-full shadow-lg pointer-events-auto transition-colors text-center";
            promptEl.innerText = "手指在路線附近按住滑動，放開後自動銜接原路線";
        }
    }
    updateUndoFreehandBtnUI();
}

if (modeMarkerBtn) modeMarkerBtn.onclick = () => setEditSubMode('marker');
if (modePathBtn) modePathBtn.onclick = () => setEditSubMode('path');
if (modeFreehandBtn) modeFreehandBtn.onclick = () => setEditSubMode('freehand');

if (btnUndoFreehand) {
    btnUndoFreehand.onclick = () => {
        if (!isEditingMode || freehandUndoStack.length === 0) return;
        const route = savedRoutes[selectedRouteIdx];
        if (!route) return;
        const prevState = freehandUndoStack.pop();
        route.points = prevState.points;
        route.events = prevState.events;
        cancelActiveFreehandStroke();
        vibrate(30);
        updateRouteLayers(route.points);
        renderEditableRouteMarkers(route);
        updateUndoFreehandBtnUI();
        const promptEl = document.getElementById('editPromptText');
        if (promptEl && editSubMode === 'freehand') {
            promptEl.innerText = "↩️ 已復原上一次手繪！手指在路線附近按住滑動可繼續接軌";
        }
    };
}

// 路線陣列長度改變後，重新計算車頭角 bearing，並同步更新「音樂開關 (A到B)」、「黃色提醒點」與「時刻站牌」綁定的路線索引
function syncRouteMarkersAndIndicesAfterSpline(route, preservedStops = []) {
    if (!route || !Array.isArray(route.points) || route.points.length === 0) return;
    const pts = route.points;

    // 1. 重新計算每個點的 bearing 與遞增時間戳記
    let curTime = pts[0].time || Date.now();
    for (let i = 0; i < pts.length; i++) {
        const isMusic = Boolean(pts[i].musicActive);
        pts[i].musicActive = isMusic;
        pts[i].music = isMusic;
        if (i > 0) {
            const prev = pts[i - 1];
            const dKm = getDistanceKm(prev.lng, prev.lat, pts[i].lng, pts[i].lat);
            if (dKm * 1000 > 0.05) {
                pts[i].bearing = getBearing(prev.lng, prev.lat, pts[i].lng, pts[i].lat);
            } else {
                pts[i].bearing = prev.bearing || 0;
            }
            curTime += Math.max(400, Math.round((dKm / 20) * 3600 * 1000));
            pts[i].time = curTime;
        }
    }
    if (pts.length >= 2) {
        pts[0].bearing = pts[1].bearing || 0;
    }

    // 2. 重新匹配時刻站牌 (is_stop) 至最近的路線節點
    if (Array.isArray(preservedStops) && preservedStops.length > 0) {
        pts.forEach(p => {
            delete p.is_stop;
            delete p.stop_name;
            delete p.scheduled_time;
        });
        preservedStops.forEach(st => {
            let minD = Infinity, bestIdx = 0;
            for (let i = 0; i < pts.length; i++) {
                const d = getDistanceKm(st.lng, st.lat, pts[i].lng, pts[i].lat);
                if (d < minD) { minD = d; bestIdx = i; }
            }
            pts[bestIdx].is_stop = true;
            pts[bestIdx].stop_name = st.stop_name;
            pts[bestIdx].scheduled_time = st.scheduled_time;
        });
    }

    // 3. 重新匹配黃色提醒點 (alert) 的最近路線點索引，並依新的 musicActive 狀態自動重建 A/B 音樂開關事件與索引
    const updatedAlerts = (route.events || [])
        .filter(ev => ev && ev.type === 'alert')
        .map(ev => {
            let minD = Infinity, bestIdx = 0;
            for (let i = 0; i < pts.length; i++) {
                const d = getDistanceKm(ev.lng, ev.lat, pts[i].lng, pts[i].lat);
                if (d < minD) { minD = d; bestIdx = i; }
            }
            return {
                ...ev,
                ptIdx: bestIdx,
                bearing: pts[bestIdx].bearing || 0
            };
        });

    const rebuiltMusicEvents = [];
    let currentMusic = Boolean(pts[0].musicActive);
    if (currentMusic) {
        rebuiltMusicEvents.push({
            type: 'on',
            lng: pts[0].lng,
            lat: pts[0].lat,
            ptIdx: 0,
            bearing: pts[0].bearing || 0
        });
    }
    for (let i = 1; i < pts.length; i++) {
        const m = Boolean(pts[i].musicActive);
        if (m !== currentMusic) {
            currentMusic = m;
            rebuiltMusicEvents.push({
                type: currentMusic ? 'on' : 'off',
                lng: pts[i].lng,
                lat: pts[i].lat,
                ptIdx: i,
                bearing: pts[i].bearing || 0
            });
        }
    }

    route.events = [...rebuiltMusicEvents, ...updatedAlerts];
}

// 綁定地圖容器的 touchstart/mousedown、touchmove/mousemove、touchend/mouseup 手繪接軌事件
(function setupFreehandSplineDrawing() {
    const canvasContainer = map.getCanvasContainer();

    function getLngLatFromClientXY(clientX, clientY) {
        const rect = canvasContainer.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        return map.unproject([x, y]);
    }

    function handleStrokeStart(clientX, clientY, rawEvent) {
        if (!isEditingMode || editSubMode !== 'freehand') return;
        const targetEl = rawEvent?.target;
        if (targetEl && targetEl.closest && targetEl.closest('.music-marker, .shared-pin-wrapper, .fleet-truck-marker')) {
            return;
        }

        const route = savedRoutes[selectedRouteIdx];
        if (!route || !Array.isArray(route.points) || route.points.length < 2) return;

        const lngLat = getLngLatFromClientXY(clientX, clientY);
        const pts = route.points;

        // 起點吸附：計算與當前編輯路線所有節點的最近距離（< 40 公尺自動吸附）
        let minStartDistM = Infinity;
        let closestStartIdx = -1;
        for (let i = 0; i < pts.length; i++) {
            const dM = getDistanceKm(lngLat.lng, lngLat.lat, pts[i].lng, pts[i].lat) * 1000;
            if (dM < minStartDistM) {
                minStartDistM = dM;
                closestStartIdx = i;
            }
        }

        const promptEl = document.getElementById('editPromptText');
        if (minStartDistM >= 40 || closestStartIdx === -1) {
            if (promptEl) {
                promptEl.innerText = "⚠️ 起點距離原路線超過 40m！請在路線附近按住開始滑動";
            }
            return;
        }

        isFreehandDrawing = true;
        freehandStartIndex = closestStartIdx;
        const snapPt = pts[closestStartIdx];
        freehandStrokeCoords = [[Number(snapPt.lng.toFixed(6)), Number(snapPt.lat.toFixed(6))]];

        if (minStartDistM >= 3.5) {
            freehandStrokeCoords.push([Number(lngLat.lng.toFixed(6)), Number(lngLat.lat.toFixed(6))]);
        }
        updateFreehandTempLayer(freehandStrokeCoords);

        if (promptEl) {
            promptEl.innerText = "✍️ 正在手繪軌跡... 放開手指後將自動吸附銜接原路線";
        }
    }

    function handleStrokeMove(clientX, clientY) {
        if (!isFreehandDrawing || !isEditingMode || editSubMode !== 'freehand') return;
        if (freehandStrokeCoords.length === 0) return;

        const lngLat = getLngLatFromClientXY(clientX, clientY);
        const curLng = Number(lngLat.lng.toFixed(6));
        const curLat = Number(lngLat.lat.toFixed(6));
        const [lastLng, lastLat] = freehandStrokeCoords[freehandStrokeCoords.length - 1];
        const distM = getDistanceKm(lastLng, lastLat, curLng, curLat) * 1000;

        // 距離過濾：每移動超過 4 公尺才記錄一個座標點，避免點位過密
        if (distM >= 4) {
            if (distM > 10) {
                // 若快速滑動跨距較大，自動以 5 公尺間距補點保持均勻密度
                const steps = Math.ceil(distM / 5);
                for (let s = 1; s <= steps; s++) {
                    const t = s / steps;
                    freehandStrokeCoords.push([
                        Number((lastLng + (curLng - lastLng) * t).toFixed(6)),
                        Number((lastLat + (curLat - lastLat) * t).toFixed(6))
                    ]);
                }
            } else {
                freehandStrokeCoords.push([curLng, curLat]);
            }
            updateFreehandTempLayer(freehandStrokeCoords);
        }
    }

    function handleStrokeEnd() {
        if (!isFreehandDrawing) return;
        isFreehandDrawing = false;
        updateFreehandTempLayer([]);

        const route = savedRoutes[selectedRouteIdx];
        const promptEl = document.getElementById('editPromptText');
        if (!route || !Array.isArray(route.points) || route.points.length < 2 || freehandStrokeCoords.length < 2) {
            if (promptEl && editSubMode === 'freehand') {
                promptEl.innerText = "手指在路線附近按住滑動，放開後自動銜接原路線";
            }
            freehandStrokeCoords = [];
            freehandStartIndex = -1;
            return;
        }

        const pts = route.points;
        const startIndex = freehandStartIndex;
        const [endLng, endLat] = freehandStrokeCoords[freehandStrokeCoords.length - 1];

        // 計算手繪總長度，過濾誤觸微移
        let strokeLenM = 0;
        for (let i = 1; i < freehandStrokeCoords.length; i++) {
            strokeLenM += getDistanceKm(
                freehandStrokeCoords[i - 1][0], freehandStrokeCoords[i - 1][1],
                freehandStrokeCoords[i][0], freehandStrokeCoords[i][1]
            ) * 1000;
        }
        if (strokeLenM < 6) {
            if (promptEl && editSubMode === 'freehand') {
                promptEl.innerText = "手指在路線附近按住滑動，放開後自動銜接原路線";
            }
            freehandStrokeCoords = [];
            freehandStartIndex = -1;
            return;
        }

        // 計算手繪終點與原路線所有節點的最近距離
        let minEndDistM = Infinity;
        let closestEndIdx = -1;
        for (let i = 0; i < pts.length; i++) {
            const dM = getDistanceKm(endLng, endLat, pts[i].lng, pts[i].lat) * 1000;
            if (dM < minEndDistM) {
                minEndDistM = dM;
                closestEndIdx = i;
            }
        }

        // 先備份現有時刻站牌座標，避免替換區段時遺失
        const preservedStops = pts
            .filter(p => p.is_stop)
            .map(p => ({ lng: p.lng, lat: p.lat, stop_name: p.stop_name, scheduled_time: p.scheduled_time }));

        // 情境 A（局部改道 / 切西瓜）：終點距離原路線小於 40 公尺
        if (minEndDistM < 40 && closestEndIdx !== -1) {
            freehandUndoStack.push({
                points: JSON.parse(JSON.stringify(route.points)),
                events: JSON.parse(JSON.stringify(route.events || []))
            });

            const isForward = (startIndex <= closestEndIdx);
            const idxStart = Math.min(startIndex, closestEndIdx);
            const idxEnd = Math.max(startIndex, closestEndIdx);

            const orderedCoords = isForward
                ? [...freehandStrokeCoords]
                : [...freehandStrokeCoords].reverse();

            // 強制首尾精準吸附至原路線節點，確保新舊路線完美無縫相連
            orderedCoords[0] = [Number(pts[idxStart].lng.toFixed(6)), Number(pts[idxStart].lat.toFixed(6))];
            const endSnapCoord = [Number(pts[idxEnd].lng.toFixed(6)), Number(pts[idxEnd].lat.toFixed(6))];
            const lastDrawn = orderedCoords[orderedCoords.length - 1];
            if (getDistanceKm(lastDrawn[0], lastDrawn[1], endSnapCoord[0], endSnapCoord[1]) * 1000 > 0.5) {
                orderedCoords.push(endSnapCoord);
            } else {
                orderedCoords[orderedCoords.length - 1] = endSnapCoord;
            }

            const densified = densifyRoadCoordinates(orderedCoords, 5);
            const inheritedMusic = Boolean(pts[idxStart]?.musicActive);
            const newSegmentPoints = densified.map(([lng, lat]) => ({
                lng,
                lat,
                time: Date.now(),
                musicActive: inheritedMusic,
                music: inheritedMusic,
                bearing: 0
            }));

            pts.splice(idxStart, idxEnd - idxStart + 1, ...newSegmentPoints);
            syncRouteMarkersAndIndicesAfterSpline(route, preservedStops);
            vibrate([40, 30, 40]);
            updateRouteLayers(route.points);
            renderEditableRouteMarkers(route);
            updateUndoFreehandBtnUI();

            if (promptEl) {
                promptEl.innerText = "✅ 已完成局部改道並自動縫合原路線！（可按「↩️ 復原手繪」退回）";
            }
        }
        // 情境 B（路線延伸）：起點吸附在原路線開頭或結尾附近（前後 5 個點內），且終點距離原路線 >= 40 公尺
        else if (minEndDistM >= 40 && (startIndex <= 4 || startIndex >= pts.length - 5)) {
            freehandUndoStack.push({
                points: JSON.parse(JSON.stringify(route.points)),
                events: JSON.parse(JSON.stringify(route.events || []))
            });

            const distToHead = startIndex;
            const distToTail = (pts.length - 1) - startIndex;
            const inheritedMusic = Boolean(pts[startIndex]?.musicActive);

            if (distToTail <= distToHead) {
                // 往路線尾端延伸
                const alignedCoords = [...freehandStrokeCoords];
                alignedCoords[0] = [Number(pts[startIndex].lng.toFixed(6)), Number(pts[startIndex].lat.toFixed(6))];
                const densified = densifyRoadCoordinates(alignedCoords, 5);
                const newTailPoints = densified.map(([lng, lat]) => ({
                    lng,
                    lat,
                    time: Date.now(),
                    musicActive: inheritedMusic,
                    music: inheritedMusic,
                    bearing: 0
                }));
                pts.splice(startIndex, pts.length - startIndex, ...newTailPoints);
            } else {
                // 往路線開頭延伸（反轉手繪陣列使其順向接入 startIndex）
                const reversedCoords = [...freehandStrokeCoords].reverse();
                reversedCoords[reversedCoords.length - 1] = [Number(pts[startIndex].lng.toFixed(6)), Number(pts[startIndex].lat.toFixed(6))];
                const densified = densifyRoadCoordinates(reversedCoords, 5);
                const newHeadPoints = densified.map(([lng, lat]) => ({
                    lng,
                    lat,
                    time: Date.now(),
                    musicActive: inheritedMusic,
                    music: inheritedMusic,
                    bearing: 0
                }));
                pts.splice(0, startIndex + 1, ...newHeadPoints);
            }

            syncRouteMarkersAndIndicesAfterSpline(route, preservedStops);
            vibrate([40, 30, 40]);
            updateRouteLayers(route.points);
            renderEditableRouteMarkers(route);
            updateUndoFreehandBtnUI();

            if (promptEl) {
                promptEl.innerText = "✅ 已完成路線延伸！（可按「↩️ 復原手繪」退回）";
            }
        } else {
            if (promptEl) {
                promptEl.innerText = "⚠️ 終點距離原路線超過 40m！局部改道請連回原路線，或從起終點延伸";
            }
        }

        freehandStrokeCoords = [];
        freehandStartIndex = -1;
    }

    // 觸控事件監聽
    canvasContainer.addEventListener('touchstart', (e) => {
        if (!isEditingMode || editSubMode !== 'freehand') return;
        if (!e.touches || e.touches.length !== 1) {
            if (isFreehandDrawing) cancelActiveFreehandStroke();
            return;
        }
        const touch = e.touches[0];
        handleStrokeStart(touch.clientX, touch.clientY, e);
    }, { passive: true });

    canvasContainer.addEventListener('touchmove', (e) => {
        if (!isEditingMode || editSubMode !== 'freehand' || !isFreehandDrawing) return;
        if (!e.touches || e.touches.length !== 1) {
            cancelActiveFreehandStroke();
            return;
        }
        if (e.cancelable) e.preventDefault();
        const touch = e.touches[0];
        handleStrokeMove(touch.clientX, touch.clientY);
    }, { passive: false });

    canvasContainer.addEventListener('touchend', () => {
        if (!isEditingMode || editSubMode !== 'freehand') return;
        handleStrokeEnd();
    }, { passive: true });

    canvasContainer.addEventListener('touchcancel', () => {
        if (isFreehandDrawing) cancelActiveFreehandStroke();
    }, { passive: true });

    // 滑鼠事件監聽
    canvasContainer.addEventListener('mousedown', (e) => {
        if (!isEditingMode || editSubMode !== 'freehand' || e.button !== 0) return;
        handleStrokeStart(e.clientX, e.clientY, e);
    });

    window.addEventListener('mousemove', (e) => {
        if (!isEditingMode || editSubMode !== 'freehand' || !isFreehandDrawing) return;
        handleStrokeMove(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', () => {
        if (!isEditingMode || editSubMode !== 'freehand' || !isFreehandDrawing) return;
        handleStrokeEnd();
    });
})();

document.getElementById('editRouteBtn').onclick = () => {
    const route = savedRoutes[selectedRouteIdx];
    if (!route) return;

    isEditingMode = true; editStep = 0;
    freehandUndoStack = [];
    originalEventsBackup = JSON.parse(JSON.stringify(route.events || [])); 
    originalPointsBackup = JSON.parse(JSON.stringify(route.points || [])); 

    document.getElementById('routeDetailUI').classList.add('hidden');
    document.getElementById('editRouteBar').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = `編輯：${route.name}`;

    setEditSubMode('marker');
    renderEditableRouteMarkers(route);
};

function renderEditableRouteMarkers(route) {
    clearDomMarkers();
    const pts = route.points;
    if (!pts || pts.length === 0) return;
    addPinMarker([pts[0].lng, pts[0].lat], '<div class="pin-s"><span>S</span></div>');
    addPinMarker([pts[pts.length-1].lng, pts[pts.length-1].lat], '<div class="pin-e"><span>E</span></div>');

    (route.events || []).forEach((ev, idx) => {
        let badgeClass = ev.type === 'on' ? 'music-on-pin' : 'music-off-pin';
        let iconClass = ev.type === 'on' ? 'fa-music' : 'fa-volume-xmark';
        let text = ev.type === 'on' ? '開' : '關';
        let isAlert = (ev.type === 'alert');
        
        if (isAlert) { badgeClass = 'bg-amber-600'; iconClass = 'fa-triangle-exclamation'; text = ev.note || '提醒'; }
        const markerEl = document.createElement('div');
        markerEl.className = `music-marker ${badgeClass} ${isAlert ? 'cursor-pointer active:scale-90' : ''}`;
        
        if (isAlert) {
            const camBadge = ev.photo ? ' <i class="fa-solid fa-camera text-amber-200"></i>' : '';
            markerEl.innerHTML = `<i class="fa-solid ${iconClass}"></i> ${text}${camBadge} <i class="fa-solid fa-pen ml-1 opacity-80"></i>`;
            markerEl.onclick = (e) => {
                e.stopPropagation();
                openAlertModalForEdit(route, idx);
            };
        } else {
            markerEl.innerHTML = `<i class="fa-solid ${iconClass}"></i> ${text}`;
        }
        const m = new maplibregl.Marker({ element: markerEl }).setLngLat([ev.lng, ev.lat]).addTo(map);
        domMarkers.push(m);
    });

    (route.points || []).forEach((p, idx) => {
        if (p.is_stop) {
            const markerEl = document.createElement('div');
            markerEl.className = `music-marker bg-indigo-600 border border-white shadow-lg cursor-grab active:cursor-grabbing`;
            markerEl.innerHTML = `<i class="fa-regular fa-clock"></i> ${p.scheduled_time} <i class="fa-solid fa-pen ml-1 opacity-70"></i>`;
            
            const m = new maplibregl.Marker({ element: markerEl, draggable: true }).setLngLat([p.lng, p.lat]).addTo(map);

            m.on('dragend', () => {
                const newLngLat = m.getLngLat();
                let minDist = Infinity, newIdx = idx;
                route.points.forEach((rp, i) => {
                    let d = getDistanceKm(newLngLat.lng, newLngLat.lat, rp.lng, rp.lat);
                    if (d < minDist) { minDist = d; newIdx = i; }
                });
                
                if (newIdx !== idx) {
                    route.points[newIdx].is_stop = true;
                    route.points[newIdx].stop_name = p.stop_name;
                    route.points[newIdx].scheduled_time = p.scheduled_time;
                    delete route.points[idx].is_stop; delete route.points[idx].stop_name; delete route.points[idx].scheduled_time;
                }
                renderEditableRouteMarkers(route); 
            });

            markerEl.onclick = (e) => {
                e.stopPropagation();
                document.getElementById('editStopTimeInput').value = p.scheduled_time || "";
                document.getElementById('editStopNameInput').value = p.stop_name || "";
                
                const modal = document.getElementById('editStopModal');
                modal.classList.remove('hidden');

                document.getElementById('btnSaveStopEdit').onclick = () => {
                    const newTime = document.getElementById('editStopTimeInput').value;
                    const newName = document.getElementById('editStopNameInput').value;
                    if (newTime && newName) {
                        route.points[idx].scheduled_time = newTime; 
                        route.points[idx].stop_name = newName;
                        modal.classList.add('hidden');
                        renderEditableRouteMarkers(route);
                    } else { alert("時間與站名不可空白！"); }
                };

                document.getElementById('btnDeleteStop').onclick = () => {
                    if (confirm(`確定要刪除【${p.stop_name}】這個站牌嗎？`)) {
                        delete route.points[idx].is_stop; delete route.points[idx].stop_name; delete route.points[idx].scheduled_time;
                        modal.classList.add('hidden');
                        renderEditableRouteMarkers(route);
                    }
                };

                document.getElementById('btnCancelStopEdit').onclick = () => modal.classList.add('hidden');
            };
            domMarkers.push(m);
        }
    });
}

// ==========================================
// ✏️ 手拉畫路線（手動規劃路線 + OSRM 道路吸附）核心引擎
// ==========================================
let isManualDrawingMode = false;
let manualDrawMusicActive = true; // 預設「🟢 音樂收運（畫綠線）」
let manualDrawSteps = []; // 儲存每一步點擊與該段細分軌跡，支援「↩️ 復原上一步」
let isManualDrawFetching = false;
let manualDrawActionSeq = 0;

const startManualDrawBtn = document.getElementById('startManualDrawBtn');
const manualDrawTopBanner = document.getElementById('manualDrawTopBanner');
const manualDrawPromptBadge = document.getElementById('manualDrawPromptBadge');
const manualDrawPromptText = document.getElementById('manualDrawPromptText');
const manualDrawUI = document.getElementById('manualDrawUI');
const manualDrawStatsNodes = document.getElementById('manualDrawStatsNodes');
const manualDrawStatsDist = document.getElementById('manualDrawStatsDist');
const btnManualMusicOn = document.getElementById('btnManualMusicOn');
const btnManualMusicOff = document.getElementById('btnManualMusicOff');
const btnManualUndo = document.getElementById('btnManualUndo');
const btnManualSave = document.getElementById('btnManualSave');
const btnManualCancel = document.getElementById('btnManualCancel');

function updateManualMusicSwitchUI() {
    if (!btnManualMusicOn || !btnManualMusicOff) return;
    if (manualDrawMusicActive) {
        btnManualMusicOn.className = 'bg-green-600 text-white font-extrabold py-2.5 px-2 rounded-xl text-xs sm:text-sm shadow-md active:scale-95 transition-all flex items-center justify-center gap-1';
        btnManualMusicOff.className = 'bg-transparent text-gray-600 hover:bg-white/60 font-extrabold py-2.5 px-2 rounded-xl text-xs sm:text-sm active:scale-95 transition-all flex items-center justify-center gap-1';
    } else {
        btnManualMusicOn.className = 'bg-transparent text-gray-600 hover:bg-white/60 font-extrabold py-2.5 px-2 rounded-xl text-xs sm:text-sm active:scale-95 transition-all flex items-center justify-center gap-1';
        btnManualMusicOff.className = 'bg-blue-600 text-white font-extrabold py-2.5 px-2 rounded-xl text-xs sm:text-sm shadow-md active:scale-95 transition-all flex items-center justify-center gap-1';
    }
}

if (btnManualMusicOn) {
    btnManualMusicOn.onclick = () => {
        manualDrawMusicActive = true;
        updateManualMusicSwitchUI();
        if (manualDrawSteps.length === 1) {
            manualDrawSteps[0].musicActive = true;
        }
    };
}
if (btnManualMusicOff) {
    btnManualMusicOff.onclick = () => {
        manualDrawMusicActive = false;
        updateManualMusicSwitchUI();
        if (manualDrawSteps.length === 1) {
            manualDrawSteps[0].musicActive = false;
        }
    };
}

// 將 OSRM 或直線的座標串列細分為每 6 公尺一個軌跡點（與高精度 GPS 實車錄製密度一致，確保事後編輯點擊、重播與導航偏離偵測 100% 順暢）
function densifyRoadCoordinates(rawCoords, maxStepMeters = 6) {
    if (!Array.isArray(rawCoords) || rawCoords.length === 0) return [];
    if (rawCoords.length === 1) {
        return [[Number(rawCoords[0][0].toFixed(6)), Number(rawCoords[0][1].toFixed(6))]];
    }

    const result = [[Number(rawCoords[0][0].toFixed(6)), Number(rawCoords[0][1].toFixed(6))]];
    for (let i = 0; i < rawCoords.length - 1; i++) {
        const [lng1, lat1] = rawCoords[i];
        const [lng2, lat2] = rawCoords[i + 1];
        const distMeters = getDistanceKm(lng1, lat1, lng2, lat2) * 1000;

        if (distMeters <= 0.1) continue;

        if (distMeters > maxStepMeters) {
            const steps = Math.ceil(distMeters / maxStepMeters);
            for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                const interpLng = Number((lng1 + (lng2 - lng1) * t).toFixed(6));
                const interpLat = Number((lat1 + (lat2 - lat1) * t).toFixed(6));
                result.push([interpLng, interpLat]);
            }
        } else {
            result.push([Number(lng2.toFixed(6)), Number(lat2.toFixed(6))]);
        }
    }
    return result;
}

// 呼叫 OSRM 道路吸附 API（3 秒超時自動降級為兩點直線連接）
async function fetchOsrmRoadGeometry(lng1, lat1, lng2, lat2) {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    try {
        const res = await fetchWithTimeout(osrmUrl, {}, 3000);
        if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
        const data = await res.json();
        const coords = data?.routes?.[0]?.geometry?.coordinates;
        if (data?.code === 'Ok' && Array.isArray(coords) && coords.length >= 2) {
            // 確保起點與前一段終點座標完全銜接無縫隙
            const alignedCoords = [[lng1, lat1], ...coords.slice(1)];
            return { coords: alignedCoords, usedOsrm: true };
        }
    } catch (err) {
        // OSRM 超時 3 秒或離線時，靜默降級為兩點直線連接
    }
    return { coords: [[lng1, lat1], [lng2, lat2]], usedOsrm: false };
}

// 由 manualDrawSteps 建構與 GPS 實車錄製 100% 相同結構的 points、events 與總距離
function buildManualRouteFromSteps() {
    if (manualDrawSteps.length === 0) {
        return { points: [], events: [], totalDistKm: 0 };
    }

    const baseTime = Date.now();
    let curTime = baseTime;
    const points = [];
    const events = [];
    let totalDistKm = 0;

    if (manualDrawSteps.length === 1) {
        const [lng0, lat0] = manualDrawSteps[0].clickLngLat;
        const m0 = Boolean(manualDrawSteps[0].musicActive);
        points.push({
            lng: lng0,
            lat: lat0,
            time: curTime,
            musicActive: m0,
            music: m0,
            bearing: 0
        });
        return { points, events, totalDistKm: 0 };
    }

    const firstStepMusic = Boolean(manualDrawSteps[1].musicActive);
    const startCoord = manualDrawSteps[1].densifiedCoords?.[0] || manualDrawSteps[0].clickLngLat;
    points.push({
        lng: startCoord[0],
        lat: startCoord[1],
        time: curTime,
        musicActive: firstStepMusic,
        music: firstStepMusic,
        bearing: 0
    });

    if (firstStepMusic) {
        events.push({
            type: 'on',
            lng: startCoord[0],
            lat: startCoord[1],
            ptIdx: 0,
            bearing: 0
        });
    }

    for (let sIdx = 1; sIdx < manualDrawSteps.length; sIdx++) {
        const step = manualDrawSteps[sIdx];
        const segMusic = Boolean(step.musicActive);
        const segCoords = step.densifiedCoords || [];
        const prevMusic = Boolean(points[points.length - 1].musicActive);

        if (sIdx > 1 && segMusic !== prevMusic) {
            const transIdx = points.length - 1;
            const transPt = points[transIdx];
            events.push({
                type: segMusic ? 'on' : 'off',
                lng: transPt.lng,
                lat: transPt.lat,
                ptIdx: transIdx,
                bearing: transPt.bearing || 0
            });
        }

        for (let cIdx = 1; cIdx < segCoords.length; cIdx++) {
            const [lng, lat] = segCoords[cIdx];
            const prevPt = points[points.length - 1];
            const dKm = getDistanceKm(prevPt.lng, prevPt.lat, lng, lat);
            if (dKm * 1000 < 0.05) continue;

            const segBearing = getBearing(prevPt.lng, prevPt.lat, lng, lat);
            totalDistKm += dKm;
            // 依約 20 km/h 清運車速遞增時間戳記
            const stepMs = Math.max(400, Math.round((dKm / 20) * 3600 * 1000));
            curTime += stepMs;

            points.push({
                lng,
                lat,
                time: curTime,
                musicActive: segMusic,
                music: segMusic,
                bearing: segBearing
            });
        }
    }

    if (points.length >= 2) {
        points[0].bearing = points[1].bearing || 0;
        if (events.length > 0 && events[0].ptIdx === 0) {
            events[0].bearing = points[0].bearing;
        }
    }

    return { points, events, totalDistKm };
}

function renderManualDrawPreview() {
    const { points, events, totalDistKm } = buildManualRouteFromSteps();
    clearDomMarkers();
    updateRouteLayers(points);

    if (manualDrawSteps.length >= 1) {
        const startLngLat = points.length > 0
            ? [points[0].lng, points[0].lat]
            : manualDrawSteps[0].clickLngLat;
        addPinMarker(startLngLat, '<div class="pin-s pointer-events-none"><span>S</span></div>');
    }

    // 標示各個手拉點擊節點與終點
    for (let i = 1; i < manualDrawSteps.length; i++) {
        const coords = manualDrawSteps[i].densifiedCoords || [];
        const endCoord = coords.length > 0 ? coords[coords.length - 1] : manualDrawSteps[i].clickLngLat;
        const isLast = (i === manualDrawSteps.length - 1);
        const isMusic = Boolean(manualDrawSteps[i].musicActive);
        if (isLast) {
            addPinMarker(endCoord, `<div class="w-6 h-6 rounded-full ${isMusic ? 'bg-green-600' : 'bg-blue-600'} text-white font-black text-[11px] border-2 border-white shadow-lg flex items-center justify-center pointer-events-none">${i}</div>`);
        } else {
            addPinMarker(endCoord, `<div class="w-4 h-4 rounded-full bg-white border-[4px] ${isMusic ? 'border-green-600' : 'border-blue-600'} shadow pointer-events-none"></div>`);
        }
    }

    // 標示音樂開關切換點
    events.forEach(ev => {
        if (ev.type === 'on') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-on-pin pointer-events-none"><i class="fa-solid fa-music"></i> 開</div>`);
        } else if (ev.type === 'off') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-off-pin pointer-events-none"><i class="fa-solid fa-volume-xmark"></i> 關</div>`);
        }
    });

    if (manualDrawStatsNodes) {
        manualDrawStatsNodes.innerHTML = `<i class="fa-solid fa-location-dot"></i> 已點選 ${manualDrawSteps.length} 個節點`;
    }
    if (manualDrawStatsDist) {
        manualDrawStatsDist.textContent = `總距離 ${totalDistKm.toFixed(2)} km`;
    }
    if (btnManualUndo) {
        btnManualUndo.disabled = (manualDrawSteps.length === 0 && !isManualDrawFetching);
    }
}

function enterManualDrawMode() {
    if (isRecording) return;
    isManualDrawingMode = true;
    manualDrawMusicActive = true;
    manualDrawSteps = [];
    isManualDrawFetching = false;
    manualDrawActionSeq++;

    updateManualMusicSwitchUI();
    setCameraFollow(false);

    document.getElementById('mainUI').classList.add('hidden');
    document.getElementById('routeDetailUI').classList.add('hidden');
    document.getElementById('playbackUI').classList.add('hidden');
    document.getElementById('topBackBtn').classList.add('hidden');

    if (manualDrawTopBanner) manualDrawTopBanner.classList.remove('hidden');
    if (manualDrawPromptText) manualDrawPromptText.textContent = '請依序點擊地圖上的起點與轉彎路口';
    if (manualDrawUI) manualDrawUI.classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = '✏️ 手拉畫路線';

    clearDomMarkers();
    updateRouteLayers([]);
    map.getSource('bg-route')?.setData(emptyGeoJSON());
    renderManualDrawPreview();

    window.history.pushState({ pwa: true }, '');
}

function exitManualDrawModeToMain() {
    isManualDrawingMode = false;
    manualDrawSteps = [];
    isManualDrawFetching = false;
    manualDrawActionSeq++;

    if (manualDrawTopBanner) manualDrawTopBanner.classList.add('hidden');
    if (manualDrawUI) manualDrawUI.classList.add('hidden');
    backToMain();
}

if (startManualDrawBtn) {
    startManualDrawBtn.onclick = () => enterManualDrawMode();
}

if (btnManualUndo) {
    btnManualUndo.onclick = () => {
        if (!isManualDrawingMode) return;
        manualDrawActionSeq++;
        isManualDrawFetching = false;
        if (manualDrawSteps.length > 0) {
            manualDrawSteps.pop();
            vibrate(30);
        }
        if (manualDrawPromptText) {
            manualDrawPromptText.textContent = manualDrawSteps.length === 0
                ? '請依序點擊地圖上的起點與轉彎路口'
                : '已復原上一步，請點擊下一個轉彎路口';
        }
        renderManualDrawPreview();
    };
}

if (btnManualCancel) {
    btnManualCancel.onclick = () => {
        if (!isManualDrawingMode) return;
        if (manualDrawSteps.length >= 2) {
            if (!confirm('確定要放棄目前手拉繪製的路線並返回主畫面嗎？')) return;
        }
        exitManualDrawModeToMain();
    };
}

if (btnManualSave) {
    btnManualSave.onclick = () => {
        if (!isManualDrawingMode) return;
        if (isManualDrawFetching) {
            alert('⏳ 正在貼齊最後一段道路，請稍候 1 秒再按完成儲存！');
            return;
        }

        const { points, events, totalDistKm } = buildManualRouteFromSteps();
        if (manualDrawSteps.length < 2 || points.length < 2) {
            alert('請至少在地圖上點擊 2 個位置（起點與轉彎路口）才能儲存路線！');
            return;
        }

        const defaultName = "鶯歌路線 " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const name = prompt("手拉路線規劃完成！請輸入路線名稱（如：尖山線第一趟）：", defaultName);
        if (!name || !name.trim()) return;

        const savedAuthor = localStorage.getItem('fleet_user_name') || localStorage.getItem('yinggeRouteLastAuthor') || '凱哥';
        const authorInput = prompt("請輸入這條路線的創作者署名：", savedAuthor);
        if (authorInput === null) return;
        const author = authorInput.trim() || "熱心隊員";
        localStorage.setItem('yinggeRouteLastAuthor', author);

        const estElapsedSec = Math.max(10, Math.round((totalDistKm / 20) * 3600));
        const mins = Math.floor(estElapsedSec / 60), secs = estElapsedSec % 60;
        const nowId = Date.now();

        const newRoute = {
            id: nowId,
            originId: nowId,
            routeId: generateRouteId(),
            name: name.trim(),
            author,
            date: new Date().toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
            createdAt: new Date(nowId).toISOString(),
            distance: totalDistKm.toFixed(2),
            timeStr: `${mins}m ${secs}s`,
            points: points,
            events: events,
            alerts: [],
            warnings: []
        };

        savedRoutes.unshift(newRoute);
        localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).catch(() => {});
        try {
            localStorage.setItem('yinggeCleanRoutes_v2', JSON.stringify(savedRoutes));
        } catch (e) {}
        document.getElementById('historyCount').innerText = savedRoutes.length;

        // 退出手拉模式並直接進入該路線的預覽詳情頁（可立即事後編輯、補加黃色提醒點或開始導航）
        isManualDrawingMode = false;
        manualDrawSteps = [];
        isManualDrawFetching = false;
        manualDrawActionSeq++;
        if (manualDrawTopBanner) manualDrawTopBanner.classList.add('hidden');
        if (manualDrawUI) manualDrawUI.classList.add('hidden');

        window.openRouteDetail(0);
    };
}

async function handleManualDrawMapClick(e) {
    if (!isManualDrawingMode || isManualDrawFetching) return;
    const origTarget = e.originalEvent?.target;
    if (origTarget && origTarget.closest && origTarget.closest('.shared-pin-wrapper, .fleet-truck-marker')) {
        return;
    }

    const lng = Number(e.lngLat.lng.toFixed(6));
    const lat = Number(e.lngLat.lat.toFixed(6));

    // 第 1 個點：設定起點 (S)
    if (manualDrawSteps.length === 0) {
        manualDrawSteps.push({
            clickLngLat: [lng, lat],
            musicActive: manualDrawMusicActive,
            densifiedCoords: [[lng, lat]],
            usedOsrm: true
        });
        vibrate(30);
        if (manualDrawPromptText) {
            manualDrawPromptText.textContent = '請依序點擊地圖上的起點與轉彎路口（已設定起點 S）';
        }
        renderManualDrawPreview();
        return;
    }

    // 第 2 個點起：呼叫 OSRM 沿著道路自動貼齊（超時 3 秒自動降級為直線）
    const prevStep = manualDrawSteps[manualDrawSteps.length - 1];
    const prevCoords = prevStep.densifiedCoords || [prevStep.clickLngLat];
    const [lng1, lat1] = prevCoords[prevCoords.length - 1];
    const segMusic = manualDrawMusicActive;

    if (manualDrawSteps.length === 1) {
        manualDrawSteps[0].musicActive = segMusic;
    }

    isManualDrawFetching = true;
    const currentSeq = ++manualDrawActionSeq;
    if (btnManualUndo) btnManualUndo.disabled = false;
    if (manualDrawPromptText) {
        manualDrawPromptText.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> 正在沿道路自動貼齊路徑...';
    }

    const { coords: rawRoadCoords, usedOsrm } = await fetchOsrmRoadGeometry(lng1, lat1, lng, lat);
    if (!isManualDrawingMode || currentSeq !== manualDrawActionSeq) return;

    const densified = densifyRoadCoordinates(rawRoadCoords, 6);
    isManualDrawFetching = false;

    manualDrawSteps.push({
        clickLngLat: [lng, lat],
        musicActive: segMusic,
        densifiedCoords: densified.length >= 2 ? densified : [[lng1, lat1], [lng, lat]],
        usedOsrm
    });

    vibrate(30);
    if (manualDrawPromptText) {
        manualDrawPromptText.textContent = usedOsrm
            ? '請依序點擊地圖上的起點與轉彎路口（已自動沿馬路貼齊）'
            : '請依序點擊地圖上的起點與轉彎路口（已使用直線連接）';
    }
    renderManualDrawPreview();
}

map.on('click', (e) => {
    if (isManualDrawingMode) {
        handleManualDrawMapClick(e);
        return;
    }
    if (!isEditingMode) return;
    const route = savedRoutes[selectedRouteIdx];
    if (!route) return;

    if (editSubMode === 'marker') {
        let minDist = Infinity, closestIdx = -1;
        route.points.forEach((p, idx) => {
            let d = getDistanceKm(e.lngLat.lng, e.lngLat.lat, p.lng, p.lat);
            if (d < minDist) { minDist = d; closestIdx = idx; }
        });

        if (minDist * 1000 > 50) { alert("請點擊在路線軌跡附近！"); return; }

        if (editStep === 0) {
            editStartIndex = closestIdx; 
            if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
            // 🚀 流程翻轉：點擊 A 點後，直接跳出大選單！不用先選 B 點！
            const el = document.createElement('div');
            el.innerHTML = `<div class="music-marker bg-blue-600 border-2 border-white px-3 py-1 shadow-lg text-sm text-white">📍 選擇位置中...</div>`;
            tempMarkerA = new maplibregl.Marker({ element: el }).setLngLat([route.points[closestIdx].lng, route.points[closestIdx].lat]).addTo(map);
            
            window.currentEditData = { route, editStartIndex };
            document.getElementById('customActionModal').classList.remove('hidden');
        } else if (editStep === 1) {
            // 🚀 這裡是專門留給「音樂開關」選 B 點用的
            let editEndIndex = closestIdx;
            let start = Math.min(editStartIndex, editEndIndex);
            let end = Math.max(editStartIndex, editEndIndex);
            
            const action = window.currentEditData.action;
            const turnOn = (action === '1');
            for (let i = start; i <= end; i++) {
                route.points[i].musicActive = turnOn;
                route.points[i].music = turnOn;
            }
            
            let newEvents = (route.events || []).filter(ev => ev.type === 'alert'); 
            let currentMusic = route.points[0].musicActive;
            if (currentMusic) newEvents.push({ type: 'on', lng: route.points[0].lng, lat: route.points[0].lat, ptIdx: 0 });
            
            for (let i = 1; i < route.points.length; i++) {
                if (route.points[i].musicActive !== currentMusic) {
                    currentMusic = route.points[i].musicActive;
                    let evtType = currentMusic ? 'on' : 'off';
                    newEvents.push({ type: evtType, lng: route.points[i].lng, lat: route.points[i].lat, ptIdx: i, bearing: route.points[i].bearing || 0 });
                }
            }
            route.events = newEvents;

            if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
            editStep = 0;
            document.getElementById('editPromptText').innerText = "🛠️ 區段設定完成！請點擊軌跡選擇下一個『目標點』";
            updateRouteLayers(route.points); renderEditableRouteMarkers(route);
        }
    } else if (editSubMode === 'path') {
        const bbox = [ [e.point.x - 20, e.point.y - 20], [e.point.x + 20, e.point.y + 20] ];
        const features = map.queryRenderedFeatures(bbox, { layers: ['bg-route-line', 'route-silent-line', 'route-music-line'] });
        
        if (features.length === 0) { alert("請確實點擊在『軌跡線條』上才能進行編輯喔！"); return; }

        // 🚀 1. 先尋找點擊位置附近有沒有「現有的轉角節點」
        let minDistToNode = Infinity;
        let closestNodeIdx = -1;
        for (let i = 0; i < route.points.length; i++) {
            const d = getDistanceKm(e.lngLat.lng, e.lngLat.lat, route.points[i].lng, route.points[i].lat) * 1000;
            if (d < minDistToNode) {
                minDistToNode = d;
                closestNodeIdx = i;
            }
        }

        let targetPoint = null;
        let isExistingNode = false;

        // 🚀 2. 智慧判定：如果點擊位置距離某個現有轉角很近 (20公尺內)，就直接抓取那個舊轉角！
        if (minDistToNode <= 20) {
            targetPoint = route.points[closestNodeIdx];
            isExistingNode = true;
        } else {
            // 🚀 3. 如果附近沒有轉角 (點在長直線中間)，就執行原本的插入新點邏輯
            let bestScore = Infinity, insertIndex = -1;
            for (let i = 0; i < route.points.length - 1; i++) {
                const d1 = getDistanceKm(e.lngLat.lng, e.lngLat.lat, route.points[i].lng, route.points[i].lat);
                const d2 = getDistanceKm(e.lngLat.lng, e.lngLat.lat, route.points[i+1].lng, route.points[i+1].lat);
                const segL = getDistanceKm(route.points[i].lng, route.points[i].lat, route.points[i+1].lng, route.points[i+1].lat);
                const score = (d1 + d2) - segL;
                if (score < bestScore) { bestScore = score; insertIndex = i + 1; }
            }
            
            const inheritedMusic = Boolean(route.points[insertIndex-1].musicActive);
            targetPoint = { lng: e.lngLat.lng, lat: e.lngLat.lat, musicActive: inheritedMusic, music: inheritedMusic };
            route.points.splice(insertIndex, 0, targetPoint);
        }

        updateRouteLayers(route.points);

        // 防止同一個節點重複疊加多個 DOM Marker
        if (pathEditMarkers.some(m => m._targetPoint === targetPoint)) return;
        
        // 創造編輯圓點 (舊轉角用橘色，新插入的點用綠色，方便凱哥辨識！)
        const el = document.createElement('div');
        el.className = isExistingNode 
            ? 'w-5 h-5 bg-white border-[5px] border-amber-500 rounded-full shadow-md cursor-grab active:cursor-grabbing' 
            : 'w-5 h-5 bg-white border-[5px] border-emerald-500 rounded-full shadow-md cursor-grab active:cursor-grabbing';
        
        const m = new maplibregl.Marker({ element: el, draggable: true })
            .setLngLat([targetPoint.lng, targetPoint.lat])
            .addTo(map);
        m._targetPoint = targetPoint;
            
        m.on('drag', () => {
            const lngLat = m.getLngLat();
            targetPoint.lng = lngLat.lng; 
            targetPoint.lat = lngLat.lat;
            updateRouteLayers(route.points, 30); 
        });
        m.on('dragend', () => {
            updateRouteLayers(route.points);
        });
        
        pathEditMarkers.push(m);
    }
});

window.handleRouteAction = function(action) {
    document.getElementById('customActionModal').classList.add('hidden');
    if (!window.currentEditData) return;

    const { route, editStartIndex } = window.currentEditData;

    if (action === '1' || action === '2') {
        // 🚀 動作 1&2 (音樂開關)：需要區段，所以進入 step 1 等待使用者點選 B 點
        window.currentEditData.action = action;
        editStep = 1; 
        document.getElementById('editPromptText').innerText = "🎵 已選擇音樂動作！請點選軌跡另一處作為『區段終點 (B點)』";
        return; // 直接中斷離開，等待使用者點擊地圖 B 點！
    } 
    else if (action === '3') {
        // 🚀 動作 3 (黃色提醒)：開啟支援實景拍照與自動壓縮的專用設定彈窗
        openAlertModalForCreate(route, editStartIndex);
        return;
    } 
    else if (action === '5') {
        // 🚀 動作 5 (時刻站牌)：單點作業，直接秒殺處理！
        const time = prompt("請輸入表定時間 (格式如 17:30)：", "17:00");
        const name = prompt("請輸入站點名稱 (如：火車站前)：", "新增定點");
        if (time && name) {
            route.points[editStartIndex].is_stop = true;
            route.points[editStartIndex].scheduled_time = time;
            route.points[editStartIndex].stop_name = name;
        }
    }
    
    // 🌟 單點作業處理完畢，或是按了取消，一律收尾重置！
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    editStep = 0;
    document.getElementById('editPromptText').innerText = "🛠️ 標記完成！請點擊地圖軌跡選擇下一個『目標點』";
    updateRouteLayers(route.points); renderEditableRouteMarkers(route);
};

document.getElementById('saveEditBtn').onclick = () => {
    isEditingMode = false;
    clearPathEditMarkers();
    cancelActiveFreehandStroke();
    freehandUndoStack = [];
    if (btnUndoFreehand) btnUndoFreehand.classList.add('hidden');
    try { map.dragPan.enable(); } catch (e) {}
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    document.getElementById('editRouteBar').classList.add('hidden');

    const editedRoute = savedRoutes[selectedRouteIdx];
    if (editedRoute && Array.isArray(editedRoute.points) && editedRoute.points.length >= 2) {
        let recalcDistKm = 0;
        for (let i = 1; i < editedRoute.points.length; i++) {
            recalcDistKm += getDistanceKm(
                editedRoute.points[i - 1].lng,
                editedRoute.points[i - 1].lat,
                editedRoute.points[i].lng,
                editedRoute.points[i].lat
            );
        }
        editedRoute.distance = recalcDistKm.toFixed(2);
    }

    try {
        localStorage.setItem('yinggeCleanRoutes_v2', JSON.stringify(savedRoutes));
    } catch (e) {}

    localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => {
        document.getElementById('topBackBtn').classList.remove('hidden');
        window.openRouteDetail(selectedRouteIdx); 
    }).catch((err) => {
        alert("儲存失敗！可能是手機儲存空間不足，請清理後再試。");
        console.error(err);
    });
};

document.getElementById('cancelEditBtn').onclick = () => {
    isEditingMode = false;
    clearPathEditMarkers();
    cancelActiveFreehandStroke();
    freehandUndoStack = [];
    if (btnUndoFreehand) btnUndoFreehand.classList.add('hidden');
    try { map.dragPan.enable(); } catch (e) {}
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    document.getElementById('editRouteBar').classList.add('hidden');
    
    savedRoutes[selectedRouteIdx].events = originalEventsBackup;
    savedRoutes[selectedRouteIdx].points = originalPointsBackup;
    
    document.getElementById('topBackBtn').classList.remove('hidden');
    window.openRouteDetail(selectedRouteIdx);
};

function backToMain() {
    stopSmoothPlayback();
    if (followWatchId !== null) {
        navigator.geolocation.clearWatch(followWatchId);
        followWatchId = null;
    }
    if (window.tacticalTimer !== null) {
        clearInterval(window.tacticalTimer);
        window.tacticalTimer = null;
    }
    isEditingMode = false;
    clearPathEditMarkers();
    cancelActiveFreehandStroke();
    freehandUndoStack = [];
    if (btnUndoFreehand) btnUndoFreehand.classList.add('hidden');
    try { map.dragPan.enable(); } catch (e) {}
    isManualDrawingMode = false;
    manualDrawSteps = [];
    isManualDrawFetching = false;
    manualDrawActionSeq++;
    if (manualDrawTopBanner) manualDrawTopBanner.classList.add('hidden');
    if (manualDrawUI) manualDrawUI.classList.add('hidden');
    document.getElementById('startManualDrawBtn')?.classList.remove('hidden');
    document.getElementById('followStopBtn').classList.add('hidden');
    document.getElementById('tacticalStopBtn').classList.add('hidden');
    document.getElementById('tacticalQuickAlertBtn')?.classList.add('hidden');
    if (typeof closeQuickNavAlertModal === 'function') closeQuickNavAlertModal();
    document.getElementById('tacticalTimePanel').classList.add('hidden');
    document.getElementById('musicAlertBanner').classList.add('hidden');
    document.getElementById('routeDetailUI').classList.add('hidden');
    document.getElementById('playbackUI').classList.add('hidden');
    document.getElementById('topBackBtn').classList.add('hidden');
    document.getElementById('offRouteWarning').classList.add('hidden');
    if (typeof exitBlackPowerSaveMode === 'function') exitBlackPowerSaveMode(false);
    else document.getElementById('blackOverlay').classList.add('hidden');
    document.getElementById('mainUI').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = '鶯歌清運路線助手';
    clearDomMarkers(); updateRouteLayers([]);
    map.getSource('bg-route')?.setData(emptyGeoJSON());
    releaseScreenWakeLockIfIdle();
    startIdleGPS();
}

document.getElementById('topBackBtn').onclick = (e) => {
    if (!document.getElementById('playbackUI').classList.contains('hidden')) {
        stopSmoothPlayback(); window.openRouteDetail(selectedRouteIdx);
    } else if (!document.getElementById('followStopBtn').classList.contains('hidden') || !document.getElementById('tacticalStopBtn').classList.contains('hidden')) {
        document.getElementById('followStopBtn').click();
    } else if (!document.getElementById('routeDetailUI').classList.contains('hidden')) {
        document.getElementById('routeDetailUI').classList.add('hidden');
        document.getElementById('topBackBtn').classList.add('hidden');
        renderHistoryList(); document.getElementById('historyModal').classList.remove('hidden');
    } else {
        backToMain(); renderHistoryList(); document.getElementById('historyModal').classList.remove('hidden');
    }
};

// --- 5.8 📷 黃色提醒實景照片壓縮、編輯與檢視邏輯 ---
const editAlertModal = document.getElementById('editAlertModal');
const editAlertModalTitle = document.getElementById('editAlertModalTitle');
const editAlertNoteInput = document.getElementById('editAlertNoteInput');
const alertCameraInput = document.getElementById('alertCameraInput');
const alertGalleryInput = document.getElementById('alertGalleryInput');
const alertPhotoStatus = document.getElementById('alertPhotoStatus');
const alertPhotoPreviewWrap = document.getElementById('alertPhotoPreviewWrap');
const alertPhotoPreviewImg = document.getElementById('alertPhotoPreviewImg');
const btnRemoveAlertPhoto = document.getElementById('btnRemoveAlertPhoto');
const btnSaveAlertEdit = document.getElementById('btnSaveAlertEdit');
const btnDeleteAlert = document.getElementById('btnDeleteAlert');
const btnCancelAlertEdit = document.getElementById('btnCancelAlertEdit');

const viewAlertModal = document.getElementById('viewAlertModal');
const viewAlertNoteText = document.getElementById('viewAlertNoteText');
const viewAlertPhotoWrap = document.getElementById('viewAlertPhotoWrap');
const viewAlertPhotoImg = document.getElementById('viewAlertPhotoImg');

const photoLightboxModal = document.getElementById('photoLightboxModal');
const photoLightboxImg = document.getElementById('photoLightboxImg');

let currentAlertPhotoBase64 = '';

function resetAlertPhotoInputs() {
    if (alertCameraInput) alertCameraInput.value = '';
    if (alertGalleryInput) alertGalleryInput.value = '';
}

window.openPhotoLightbox = function(src) {
    if (!src) return;
    photoLightboxImg.src = src;
    photoLightboxModal.classList.remove('hidden');
};

photoLightboxModal.onclick = () => {
    photoLightboxModal.classList.add('hidden');
    photoLightboxImg.src = '';
};
document.getElementById('closePhotoLightboxBtn').onclick = (e) => {
    e.stopPropagation();
    photoLightboxModal.classList.add('hidden');
    photoLightboxImg.src = '';
};

alertPhotoPreviewImg.onclick = () => {
    if (currentAlertPhotoBase64) window.openPhotoLightbox(currentAlertPhotoBase64);
};
viewAlertPhotoImg.onclick = () => {
    if (viewAlertPhotoImg.src) window.openPhotoLightbox(viewAlertPhotoImg.src);
};

function openViewAlertModal(ev) {
    if (!ev) return;
    viewAlertNoteText.innerText = ev.note || '注意路況';
    if (ev.photo) {
        viewAlertPhotoImg.src = ev.photo;
        viewAlertPhotoWrap.classList.remove('hidden');
    } else {
        viewAlertPhotoImg.src = '';
        viewAlertPhotoWrap.classList.add('hidden');
    }
    viewAlertModal.classList.remove('hidden');
}

document.getElementById('btnCloseViewAlert').onclick = () => viewAlertModal.classList.add('hidden');
document.getElementById('btnCloseViewAlertTop').onclick = () => viewAlertModal.classList.add('hidden');

function updateAlertPhotoPreviewUI(base64Str, statusText = '') {
    currentAlertPhotoBase64 = base64Str || '';
    if (currentAlertPhotoBase64) {
        alertPhotoPreviewImg.src = currentAlertPhotoBase64;
        alertPhotoPreviewWrap.classList.remove('hidden');
        if (statusText) {
            alertPhotoStatus.innerText = statusText;
            alertPhotoStatus.classList.remove('hidden');
        } else {
            const kb = Math.round((currentAlertPhotoBase64.length * 0.75) / 1024);
            alertPhotoStatus.innerText = `✅ 已附加實景照片（約 ${kb} KB）`;
            alertPhotoStatus.classList.remove('hidden');
        }
    } else {
        alertPhotoPreviewImg.src = '';
        alertPhotoPreviewWrap.classList.add('hidden');
        alertPhotoStatus.innerText = '';
        alertPhotoStatus.classList.add('hidden');
    }
}

btnRemoveAlertPhoto.onclick = () => {
    resetAlertPhotoInputs();
    updateAlertPhotoPreviewUI('');
};

function renderSourceToCompressedBase64(source, srcWidth, srcHeight) {
    const maxWidth = 800;
    let targetW = srcWidth || 800;
    let targetH = srcHeight || 600;
    if (targetW > maxWidth) {
        targetH = Math.round(targetH * (maxWidth / targetW));
        targetW = maxWidth;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    // 填充白底，避免透明 PNG 轉 JPEG 時背景變黑
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(source, 0, 0, targetW, targetH);

    let quality = 0.7;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    let byteSize = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);

    // 防爆容量保護：確保壓縮後一定在 150KB 內
    while (byteSize > 150 * 1024 && quality > 0.3) {
        quality = Math.max(0.25, quality - 0.1);
        dataUrl = canvas.toDataURL('image/jpeg', quality);
        byteSize = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);
    }

    if (byteSize > 150 * 1024) {
        const scale = Math.sqrt((140 * 1024) / byteSize);
        canvas.width = Math.max(320, Math.round(targetW * scale));
        canvas.height = Math.max(240, Math.round(targetH * scale));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL('image/jpeg', 0.65);
        byteSize = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);
    }

    return { dataUrl, kb: Math.max(1, Math.round(byteSize / 1024)) };
}

function compressImageFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('讀取圖片檔案失敗'));
        reader.onload = (ev) => {
            const rawDataUrl = ev.target.result;
            const img = new Image();
            img.onload = () => {
                try {
                    const result = renderSourceToCompressedBase64(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
                    resolve(result);
                } catch (canvasErr) {
                    reject(canvasErr);
                }
            };
            img.onerror = async () => {
                // 自動降級處理 1：嘗試使用 createImageBitmap 解析特殊手機圖片格式
                if (typeof window.createImageBitmap === 'function') {
                    try {
                        const bitmap = await window.createImageBitmap(file);
                        const result = renderSourceToCompressedBase64(bitmap, bitmap.width, bitmap.height);
                        if (typeof bitmap.close === 'function') bitmap.close();
                        resolve(result);
                        return;
                    } catch (bmpErr) {
                        console.warn('createImageBitmap 降級解析失敗:', bmpErr);
                    }
                }
                // 自動降級處理 2：若原圖已小於 150KB 且為 data:image，直接安全採用
                if (typeof rawDataUrl === 'string' && rawDataUrl.startsWith('data:image/') && file.size <= 150 * 1024) {
                    resolve({ dataUrl: rawDataUrl, kb: Math.max(1, Math.round(file.size / 1024)) });
                    return;
                }
                reject(new Error('不支援的圖片格式或圖片損毀'));
            };
            img.src = rawDataUrl;
        };
        reader.readAsDataURL(file);
    });
}

async function handleAlertPhotoInputChange(e) {
    const inputEl = e.target;
    const file = inputEl.files && inputEl.files[0];
    // 立即重設 input.value 為空字串 ''，確保連續重選同一張或更換照片皆能觸發 onchange
    inputEl.value = '';
    if (!file) return;

    alertPhotoStatus.innerText = '⏳ 正在壓縮處理照片...';
    alertPhotoStatus.classList.remove('hidden');
    try {
        const { dataUrl, kb } = await compressImageFileToBase64(file);
        updateAlertPhotoPreviewUI(dataUrl, `✅ 照片已自動壓縮完成（${kb} KB ≤ 150 KB）`);
    } catch (err) {
        console.error('圖片處理異常:', err);
        alert('⚠️ 無法解析此照片格式（若為 iPhone 高效率原況檔案，建議直接點選「📷 現場拍照」或選擇一般 JPG/PNG 照片）！');
        if (!currentAlertPhotoBase64) {
            updateAlertPhotoPreviewUI('');
        } else {
            updateAlertPhotoPreviewUI(currentAlertPhotoBase64);
        }
    }
}

if (alertCameraInput) alertCameraInput.onchange = handleAlertPhotoInputChange;
if (alertGalleryInput) alertGalleryInput.onchange = handleAlertPhotoInputChange;

function finishAlertModalCleanup(route) {
    editAlertModal.classList.add('hidden');
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    editStep = 0;
    if (route) {
        document.getElementById('editPromptText').innerText = "🛠️ 標記完成！請點擊地圖軌跡選擇下一個『目標點』";
        updateRouteLayers(route.points);
        renderEditableRouteMarkers(route);
    }
}

function openAlertModalForCreate(route, ptIndex) {
    editAlertModalTitle.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 新增黃色提醒事項';
    editAlertNoteInput.value = '注意路段';
    resetAlertPhotoInputs();
    updateAlertPhotoPreviewUI('');
    btnDeleteAlert.classList.add('hidden');
    editAlertModal.classList.remove('hidden');

    btnSaveAlertEdit.onclick = () => {
        const note = editAlertNoteInput.value.trim();
        if (!note) {
            alert('請輸入提醒內容！');
            return;
        }
        route.events = route.events || [];
        const newEv = {
            type: 'alert',
            note,
            lng: route.points[ptIndex].lng,
            lat: route.points[ptIndex].lat,
            ptIdx: ptIndex,
            bearing: route.points[ptIndex].bearing || 0
        };
        if (currentAlertPhotoBase64) newEv.photo = currentAlertPhotoBase64;
        route.events.push(newEv);
        finishAlertModalCleanup(route);
    };

    btnCancelAlertEdit.onclick = () => {
        finishAlertModalCleanup(route);
    };
}

function openAlertModalForEdit(route, eventIdx) {
    const ev = route.events && route.events[eventIdx];
    if (!ev) return;

    editAlertModalTitle.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 編輯黃色提醒事項';
    editAlertNoteInput.value = ev.note || '注意路段';
    resetAlertPhotoInputs();
    updateAlertPhotoPreviewUI(ev.photo || '');
    btnDeleteAlert.classList.remove('hidden');
    editAlertModal.classList.remove('hidden');

    btnSaveAlertEdit.onclick = () => {
        const note = editAlertNoteInput.value.trim();
        if (!note) {
            alert('請輸入提醒內容！');
            return;
        }
        ev.note = note;
        if (currentAlertPhotoBase64) {
            ev.photo = currentAlertPhotoBase64;
        } else {
            delete ev.photo;
        }
        finishAlertModalCleanup(route);
    };

    btnDeleteAlert.onclick = () => {
        if (confirm(`確定要刪除【${ev.note || '提醒'}】這筆黃色提醒嗎？`)) {
            route.events.splice(eventIdx, 1);
            finishAlertModalCleanup(route);
        }
    };

    btnCancelAlertEdit.onclick = () => {
        editAlertModal.classList.add('hidden');
    };
}

// --- 6. 模擬重播引擎 ---
let animFrameId = null, isPlaying = false, playProgress = 0, lastFrameTime = 0;
let replayMappedAlerts = [], replayTriggeredAlertSet = new Set();
let replayMappedMusicEvents = [], replayTriggeredMusicSet = new Set();
const speedOptions = [1, 2, 4, 6];
let speedMultiplier = 1;

const playbackSlider = document.getElementById('playbackSlider');
const playPauseBtn = document.getElementById('playPauseBtn');
const speedToggleBtn = document.getElementById('speedToggleBtn');

document.getElementById('startReplayBtn').onclick = () => {
    const route = savedRoutes[selectedRouteIdx];
    if (!route || !route.points || route.points.length < 2) return;

    stopSmoothPlayback();

    document.getElementById('routeDetailUI').classList.add('hidden');
    document.getElementById('playbackUI').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = '路線重播複習';
    document.getElementById('playbackTitle').innerText = route.name;
    speedToggleBtn.innerText = `${speedMultiplier}x`;

    replayMappedAlerts = (route.events || [])
        .filter(ev => ev.type === 'alert')
        .map(ev => {
            let minEvDist = Infinity, evPtIdx = typeof ev.ptIdx === 'number' ? ev.ptIdx : 0;
            for (let i = 0; i < route.points.length; i++) {
                const d = getDistanceKm(ev.lng, ev.lat, route.points[i].lng, route.points[i].lat);
                if (d < minEvDist) { minEvDist = d; evPtIdx = i; }
            }
            return { ...ev, ptIdx: evPtIdx };
        });
    replayTriggeredAlertSet.clear();

    const rawMusicEvents = (route.events || [])
        .filter(ev => ev.type === 'on' || ev.type === 'off')
        .map(ev => {
            let minEvDist = Infinity, evPtIdx = typeof ev.ptIdx === 'number' ? ev.ptIdx : 0;
            if (typeof ev.ptIdx !== 'number') {
                for (let i = 0; i < route.points.length; i++) {
                    const d = getDistanceKm(ev.lng, ev.lat, route.points[i].lng, route.points[i].lat);
                    if (d < minEvDist) { minEvDist = d; evPtIdx = i; }
                }
            }
            return { ...ev, ptIdx: evPtIdx };
        });

    for (let i = 1; i < route.points.length; i++) {
        const currActive = Boolean(route.points[i].musicActive);
        const prevActive = Boolean(route.points[i - 1].musicActive);
        if (currActive !== prevActive) {
            const evtType = currActive ? 'on' : 'off';
            const alreadyExists = rawMusicEvents.some(e => e.type === evtType && Math.abs(e.ptIdx - i) <= 2);
            if (!alreadyExists) {
                rawMusicEvents.push({
                    type: evtType,
                    lng: route.points[i].lng,
                    lat: route.points[i].lat,
                    ptIdx: i
                });
            }
        }
    }
    replayMappedMusicEvents = rawMusicEvents.sort((a, b) => a.ptIdx - b.ptIdx);
    replayTriggeredMusicSet.clear();

    map.getSource('bg-route')?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: route.points.map(p => [p.lng, p.lat]) } }]
    });
    updateRouteLayers([]); renderRouteMarkers(route);

    playProgress = 0; playbackSlider.max = (route.points.length - 1) * 100; playbackSlider.value = 0;
    setCameraFollow(true);

    const startPt = route.points[0];
    lastKnownLngLat = [startPt.lng, startPt.lat];
    if (vehicleMarker) vehicleMarker.setLngLat(lastKnownLngLat);
    map.jumpTo({ center: lastKnownLngLat, zoom: 17.5, offset: [0, 100] });

    startSmoothPlayback();
};

function renderInterpolatedStep(floatIdx, forceLayerUpdate = false) {
    const route = savedRoutes[selectedRouteIdx];
    if (!route || !route.points || route.points.length < 2) return;
    const pts = route.points;
    const maxIdx = pts.length - 1;
    const clamped = Math.min(Math.max(floatIdx, 0), maxIdx);
    const i = Math.min(Math.floor(clamped), maxIdx);
    const frac = clamped - i;

    const p1 = pts[i], p2 = pts[Math.min(i + 1, maxIdx)];
    if (!p1 || !p2) return;
    const curLng = p1.lng + (p2.lng - p1.lng) * frac;
    const curLat = p1.lat + (p2.lat - p1.lat) * frac;
    lastKnownLngLat = [curLng, curLat];

    if (i < maxIdx && (p1.lng !== p2.lng || p1.lat !== p2.lat)) currentHeading = getBearing(p1.lng, p1.lat, p2.lng, p2.lat);
    if (vehicleMarker) vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);

    const walkedPoints = pts.slice(0, i + 1).concat([{ lng: curLng, lat: curLat, musicActive: p2.musicActive }]);
    updateRouteLayers(walkedPoints, forceLayerUpdate ? 0 : 50);

    const badge = document.getElementById('replayMusicBadge');
    if (p2.musicActive) {
        badge.className = "bg-green-600 text-white text-xs font-extrabold px-4 py-1.5 rounded-full shadow-lg pointer-events-auto";
        badge.innerText = "🎵 目前路段：播放回收音樂中";
    } else {
        badge.className = "bg-gray-800/90 text-white text-xs font-extrabold px-4 py-1.5 rounded-full shadow-lg pointer-events-auto";
        badge.innerText = "🔇 目前路段：音樂已關閉 (中斷移動)";
    }

    const triggerWindow = Math.max(2.5, speedMultiplier * 0.8);

    if (replayMappedMusicEvents.length > 0) {
        replayMappedMusicEvents.forEach((ev, idx) => {
            if (replayTriggeredMusicSet.has(idx)) return;
            if (clamped >= ev.ptIdx && clamped - ev.ptIdx <= triggerWindow) {
                replayTriggeredMusicSet.add(idx);
                if (ev.type === 'on') {
                    showNavAlert('🎵', '開啟回收音樂！', 'bg-green-600');
                    speakText('請開啟音樂');
                } else if (ev.type === 'off') {
                    showNavAlert('🔇', '關閉回收音樂！', 'bg-red-600');
                    speakText('請關閉音樂');
                }
            }
        });
    }

    if (replayMappedAlerts.length > 0) {
        replayMappedAlerts.forEach((ev, idx) => {
            if (replayTriggeredAlertSet.has(idx)) return;
            if (clamped >= ev.ptIdx && clamped - ev.ptIdx <= triggerWindow) {
                replayTriggeredAlertSet.add(idx);
                showNavAlert('⚠️', ev.note || '注意路況', 'bg-amber-600', ev.photo || null);
                speakText(`前方提醒，${ev.note || '注意路況'}`);
            }
        });
    }

    if (isFollowingCamera) map.jumpTo({ center: lastKnownLngLat, bearing: isHeadingUpMode ? currentHeading : map.getBearing(), offset: [0, 100] });
}

function playbackLoop(timestamp) {
    if (!isPlaying) return;
    const route = savedRoutes[selectedRouteIdx];
    if (!route || !route.points || route.points.length < 2) { stopSmoothPlayback(); return; }
    if (!lastFrameTime) lastFrameTime = timestamp;
    const deltaSec = Math.min(Math.max((timestamp - lastFrameTime) / 1000, 0), 0.1);
    lastFrameTime = timestamp;

    const maxIdx = route.points.length - 1;
    playProgress += deltaSec * 2.5 * speedMultiplier;

    if (playProgress >= maxIdx) {
        playProgress = maxIdx; renderInterpolatedStep(playProgress, true);
        playbackSlider.value = Math.round(playProgress * 100);
        stopSmoothPlayback(); playPauseBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
        return;
    }

    renderInterpolatedStep(playProgress, false);
    playbackSlider.value = Math.round(playProgress * 100);
    animFrameId = requestAnimationFrame(playbackLoop);
}

function startSmoothPlayback() {
    // 單一實例保護：啟動前先清除舊的動畫計時器
    if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
    if (playProgress >= savedRoutes[selectedRouteIdx].points.length - 1) {
        playProgress = 0;
        replayTriggeredAlertSet.clear();
        replayTriggeredMusicSet.clear();
    }
    isPlaying = true; lastFrameTime = 0;
    playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    animFrameId = requestAnimationFrame(playbackLoop);
}

function stopSmoothPlayback() {
    isPlaying = false;
    if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
    playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
}

playPauseBtn.onclick = () => isPlaying ? stopSmoothPlayback() : startSmoothPlayback();
playbackSlider.oninput = (e) => {
    playProgress = parseInt(e.target.value, 10) / 100;
    const triggerWindow = Math.max(2.5, speedMultiplier * 0.8);
    replayMappedAlerts.forEach((ev, idx) => {
        if (playProgress < ev.ptIdx) replayTriggeredAlertSet.delete(idx);
        else if (playProgress - ev.ptIdx > triggerWindow) replayTriggeredAlertSet.add(idx);
    });
    replayMappedMusicEvents.forEach((ev, idx) => {
        if (playProgress < ev.ptIdx) replayTriggeredMusicSet.delete(idx);
        else if (playProgress - ev.ptIdx > triggerWindow) replayTriggeredMusicSet.add(idx);
    });
    renderInterpolatedStep(playProgress, true);
};
speedToggleBtn.onclick = () => {
    const nextIdx = (speedOptions.indexOf(speedMultiplier) + 1) % speedOptions.length;
    speedMultiplier = speedOptions[nextIdx]; speedToggleBtn.innerText = `${speedMultiplier}x`;
};
document.getElementById('stopPlaybackBtn').onclick = () => { 
    stopSmoothPlayback();
    if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    window._activeSpeechUtterance = null;
    document.getElementById('playbackUI').classList.add('hidden'); 
    document.getElementById('musicAlertBanner').classList.add('hidden');
    document.getElementById('topBackBtn').classList.remove('hidden');
    window.openRouteDetail(selectedRouteIdx); 
};

// --- 7. 🔥 Pro Max 級實戰導航引擎 ＆ 全螢幕純黑智慧省電模式 ---
let triggeredMusicIndices = new Set(), triggeredTurnIndices = new Set();

const blackOverlay = document.getElementById('blackOverlay');
const offRouteWarning = document.getElementById('offRouteWarning');
const banner = document.getElementById('musicAlertBanner');

// 喚醒畫面時同步恢復地圖重繪與最新位置
function syncMapRenderOnWake() {
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.style.visibility = 'visible';
    if (vehicleMarker && lastKnownLngLat) {
        vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);
    }
    if (isRecording && routePoints.length > 0) {
        document.getElementById('distanceText').innerText = totalDistanceKm.toFixed(2);
        updateRouteLayers(routePoints);
    }
    if (isFollowingCamera && lastKnownLngLat) {
        map.jumpTo({
            center: lastKnownLngLat,
            bearing: isHeadingUpMode ? currentHeading : map.getBearing(),
            offset: [0, 100]
        });
    }
    if (typeof fetchAndRenderFleetRadar === 'function') {
        fetchAndRenderFleetRadar();
    }
    if (typeof fetchAndRenderSharedMapPins === 'function') {
        fetchAndRenderSharedMapPins();
    }
}

// 進入全螢幕純黑 (#000000) 智慧省電模式
async function enterBlackPowerSaveMode(fromUserGesture = true) {
    ensurePureBlackSystemBars();
    isBlackScreenActive = true;
    isScreenAutoWoken = false;
    if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }

    blackOverlay.style.backgroundColor = '#000000';
    blackOverlay.classList.remove('hidden', 'opacity-0');

    // 暫停底層地圖畫面重繪，達到極致省電
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.style.visibility = 'hidden';

    // 嘗試於使用者點擊手勢中進入全螢幕（隱藏 Android 底部虛擬導覽列與頂部狀態列）
    if (fromUserGesture) {
        try {
            const docEl = document.documentElement;
            const reqFs = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.msRequestFullscreen;
            if (reqFs && !document.fullscreenElement && !document.webkitFullscreenElement) {
                Promise.resolve(reqFs.call(docEl)).catch(() => {});
            }
        } catch (e) {}
    }

    // 持續啟用螢幕喚醒鎖定（Wake Lock API）防止手機休眠斷網
    await requestScreenWakeLock();

    // 確保背景 GPS 追蹤與車隊雷達位置上傳持續運作不中斷
    if (!isRecording && followWatchId === null) startIdleGPS();
    if (typeof startFleetRadarSystem === 'function') startFleetRadarSystem();
}

// 退出全螢幕純黑省電模式
function exitBlackPowerSaveMode(fromUserGesture = true) {
    isBlackScreenActive = false;
    isScreenAutoWoken = false;
    if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }

    blackOverlay.classList.add('hidden');
    blackOverlay.classList.remove('opacity-0');
    ensurePureBlackSystemBars();

    // 恢復地圖畫面重繪並同步最新座標
    syncMapRenderOnWake();

    if (fromUserGesture) {
        try {
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
                if (exitFs) Promise.resolve(exitFs.call(document)).catch(() => {});
            }
        } catch (e) {}
    }

    releaseScreenWakeLockIfIdle();
}

document.getElementById('blackScreenBtn').onclick = () => enterBlackPowerSaveMode(true);
blackOverlay.onclick = () => exitBlackPowerSaveMode(true);

function autoWakeScreen() {
    if (!isBlackScreenActive || isScreenAutoWoken) return;
    isScreenAutoWoken = true;
    syncMapRenderOnWake();
    blackOverlay.classList.add('opacity-0');
    setTimeout(() => { if(isScreenAutoWoken) blackOverlay.classList.add('hidden'); }, 300);
    vibrate([100, 50, 100]);
}

function autoSleepScreen() {
    if (!isBlackScreenActive) return;
    if (sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
        if (isBlackScreenActive) {
            isScreenAutoWoken = false;
            ensurePureBlackSystemBars();
            blackOverlay.style.backgroundColor = '#000000';
            blackOverlay.classList.remove('hidden');
            const mapEl = document.getElementById('map');
            if (mapEl) mapEl.style.visibility = 'hidden';
            setTimeout(() => blackOverlay.classList.remove('opacity-0'), 10);
        }
    }, 5000);
}

let navAlertHideTimer = null;
function showNavAlert(iconHtml, text, bgColorClass, photoUrl = null) {
    if (navAlertHideTimer) clearTimeout(navAlertHideTimer);
    if (text === '') {
        // 🚀 無文字模式 (轉彎專用)：變成 36x36 的完美圓角正方形大圖示
        banner.className = `fixed top-24 left-1/2 -translate-x-1/2 z-[60] rounded-[2rem] shadow-2xl text-white font-black nav-alert-pop border-4 border-white pointer-events-auto flex items-center justify-center w-36 h-36 ${bgColorClass}`;
        banner.innerHTML = `<span class="text-[90px] drop-shadow-lg leading-none">${iconHtml}</span>`;
    } else if (bgColorClass && bgColorClass.includes('amber')) {
        // ⚠️ 導航／重播模式下的黃色注意路段：頂部精簡橫幅（最大高度 84px，不擋車頭路線）
        banner.className = `fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-[60] rounded-2xl shadow-2xl text-white font-black nav-alert-pop border-2 border-white pointer-events-auto flex items-center justify-between px-3.5 py-2 w-11/12 max-w-sm max-h-[84px] overflow-hidden gap-2.5 ${bgColorClass}`;
        const thumbHtml = photoUrl
            ? `<button type="button" onclick="openPhotoLightbox(this.querySelector('img').src)" class="relative w-[56px] h-[56px] flex-shrink-0 rounded-xl overflow-hidden border-2 border-white shadow-md active:scale-95 focus:outline-none" title="點擊放大檢視照片">
                   <img src="${photoUrl}" alt="提醒縮圖" class="w-full h-full object-cover">
                   <span class="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[9px] leading-none px-1 py-0.5 rounded pointer-events-none">🔍</span>
               </button>`
            : '';
        banner.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="text-2xl flex-shrink-0 drop-shadow">${iconHtml}</span>
                <span class="text-base sm:text-lg font-black leading-tight text-left break-words" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${text}</span>
            </div>
            ${thumbHtml}
        `;
    } else {
        // 其他有文字模式 (開關音樂、抵達起點等橫幅)
        banner.className = `fixed top-20 left-1/2 -translate-x-1/2 z-[60] rounded-3xl shadow-2xl text-white font-black text-center nav-alert-pop border-4 border-white pointer-events-auto flex flex-col items-center justify-center p-4 w-11/12 max-w-sm gap-2 text-2xl ${bgColorClass}`;
        banner.innerHTML = `<div class="flex items-center justify-center gap-2"><span class="text-3xl drop-shadow-md">${iconHtml}</span> <span>${text}</span></div>`;
    }
    
    banner.classList.remove('hidden');
    navAlertHideTimer = setTimeout(() => banner.classList.add('hidden'), photoUrl ? 8500 : 6000);
}

window.tacticalTimer = null;
function updateTacticalDisplay() {
    const nameEl = document.getElementById('nextStopName'), timeEl = document.getElementById('timeRemainingDisplay');
    if (!nameEl || !timeEl) return;

    if (!window.stopsQueue || window.currentStopIndex >= window.stopsQueue.length) {
        nameEl.innerText = "🚩 本路線所有定點清運已完成！"; timeEl.innerText = "--:--";
        timeEl.className = "text-3xl font-black text-gray-500 mt-0.5";
        if (window.tacticalTimer !== null) {
            clearInterval(window.tacticalTimer);
            window.tacticalTimer = null;
        }
        return;
    }

    const nextStop = window.stopsQueue[window.currentStopIndex];
    const timeStr = nextStop.scheduled_time || "00:00";
    nameEl.innerText = `下一站 (${window.currentStopIndex + 1}/${window.stopsQueue.length})：${nextStop.stop_name || '定點收運'}`;

    const now = new Date(), [hours, minutes] = timeStr.split(':'), targetTime = new Date();
    targetTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

    const diffSecs = Math.floor((targetTime - now) / 1000), absSecs = Math.abs(diffSecs);
    const m = Math.floor(absSecs / 60).toString().padStart(2, '0'), s = (absSecs % 60).toString().padStart(2, '0');

    if (diffSecs > 0) {
        timeEl.innerText = `+ ${m}:${s}`;
        timeEl.className = "text-4xl font-black tracking-wider text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.5)] font-mono mt-0.5";
    } else if (diffSecs === 0) {
        timeEl.innerText = "即將抵達";
        timeEl.className = "text-4xl font-black tracking-wider text-yellow-400 animate-pulse font-mono mt-0.5";
    } else {
        timeEl.innerText = `- ${m}:${s}`;
        timeEl.className = "text-4xl font-black tracking-wider text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.6)] font-mono mt-0.5";
    }
}

document.getElementById('startFollowBtn').onclick = async () => {
    stopIdleGPS();
    // 單一實例保護：啟動前先清除舊的導航監聽與戰術計時器
    if (followWatchId !== null) {
        navigator.geolocation.clearWatch(followWatchId);
        followWatchId = null;
    }
    if (window.tacticalTimer !== null) {
        clearInterval(window.tacticalTimer);
        window.tacticalTimer = null;
    }

    const route = savedRoutes[selectedRouteIdx];
    if (!route) return;
    document.getElementById('routeDetailUI').classList.add('hidden');
    // 顯示右下角的獨立結束按鈕與左下角的一鍵標記黃色注意點按鈕
    document.getElementById('tacticalStopBtn').classList.remove('hidden');
    document.getElementById('tacticalQuickAlertBtn')?.classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = `導航：${route.name}`;
    
    let hasAnnouncedStart = false, hasAnnouncedEnd = false, wasOffRoute = false; 
    window.startGuidanceSpoken = true; window.lastOffRouteTime = 0;        

    triggeredMusicIndices.clear(); triggeredTurnIndices.clear();
    isBlackScreenActive = false; isScreenAutoWoken = false;

    const pts = route.points;
    const mappedEvents = (route.events || []).map(ev => {
        let minEvDist = Infinity, evPtIdx = 0;
        for(let i = 0; i < route.points.length; i++) {
            let d = getDistanceKm(ev.lng, ev.lat, route.points[i].lng, route.points[i].lat);
            if(d < minEvDist) { minEvDist = d; evPtIdx = i; }
        }
        return { ...ev, ptIdx: evPtIdx };
    });
    window.activeFollowMappedEvents = mappedEvents;

    window.stopsQueue = (route.points || []).map((p, index) => ({ ...p, ptIdx: index })).filter(p => p.is_stop === true);
    window.currentStopIndex = 0;
    if (window.stopsQueue.length > 0) {
        document.getElementById('tacticalTimePanel').classList.remove('hidden');
        updateTacticalDisplay();
        window.tacticalTimer = setInterval(updateTacticalDisplay, 1000); 
    } else {
        document.getElementById('tacticalTimePanel').classList.add('hidden');
    }

    let currentNavIdx = 0; 
    updateRouteLayers(route.points); renderRouteMarkers(route);
    setCameraFollow(true);

    // 🚀 按下導航瞬間，強制將鏡頭拉近到「實戰特寫視角」並傾斜
    map.flyTo({
        center: lastKnownLngLat,
        zoom: 18.5, // 💡 導航專用的超近視角 (數字越大越近，18.5 是最佳實戰比例)
        pitch: 50,  // 💡 視角稍微傾斜 50 度，看起來更像專業車載 3D 導航
        bearing: isHeadingUpMode ? currentHeading : 0,
        offset: [0, 100],
        duration: 1500 // 飛行過場動畫 1.5 秒
    });

    await requestScreenWakeLock();

    followWatchId = navigator.geolocation.watchPosition(pos => {
        const lng = pos.coords.longitude, lat = pos.coords.latitude;
        if (typeof window.onFleetPositionUpdate === 'function') window.onFleetPositionUpdate(lat, lng);
        if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) {
            currentHeading = pos.coords.heading;
        } else if (lastKnownLngLat[0] !== lng || lastKnownLngLat[1] !== lat) {
            if (pos.coords.speed > 1) currentHeading = getBearing(lastKnownLngLat[0], lastKnownLngLat[1], lng, lat);
        }
        
        lastKnownLngLat = [lng, lat];
        if (!isPowerSaveMapPaused()) {
            if (vehicleMarker) vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);

            if (isFollowingCamera) {
                map.easeTo({ center: lastKnownLngLat, bearing: isHeadingUpMode ? currentHeading : map.getBearing(), offset: [0, 100], duration: 300 });
            }
        }

        let isOffRoute = true, closestPtIdx = currentNavIdx, minDist = Infinity;

        for (let i = 0; i < pts.length; i++) {
            const d = getDistanceKm(lng, lat, pts[i].lng, pts[i].lat) * 1000;
            if (d < minDist) { minDist = d; closestPtIdx = i; }
        }
        currentNavIdx = closestPtIdx;

        const distToStart = getDistanceKm(lng, lat, pts[0].lng, pts[0].lat) * 1000;
        if (!hasAnnouncedStart) {
            if (distToStart <= 35 || minDist <= 25) {
                hasAnnouncedStart = true;
                document.getElementById('appStatusTitle').innerText = `導航：${route.name}`;
                showNavAlert('✅', '抵達路線，開始任務', 'bg-green-600');
                speakText("我們任務開始，路上請注意安全。");
                vibrate([200, 100, 200]);
            } else {
                document.getElementById('appStatusTitle').innerText = `前往起點 (${Math.round(distToStart)}m)`;
                return;
            }
        }

        if (window.stopsQueue && window.currentStopIndex < window.stopsQueue.length) {
            const targetStop = window.stopsQueue[window.currentStopIndex];
            const distToStop = getDistanceKm(lng, lat, targetStop.lng, targetStop.lat) * 1000;
            const indexDiff = currentNavIdx - targetStop.ptIdx;
            
            // 🚀 核心修復：距離嚴格縮小為 15 公尺，並加入「軌跡進度鎖」(防止隔壁巷子誤觸)
            const isNearStop = (distToStop <= 15 && Math.abs(indexDiff) <= 30);
            const isPassedStop = (indexDiff >= 0 && indexDiff <= 15); // 順著軌跡剛好開過頭

            if (isNearStop || isPassedStop) {
                const nowTime = new Date(), [hours, minutes] = (targetStop.scheduled_time || "00:00").split(':');
                const targetTime = new Date(); targetTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
                
                const diffSecs = Math.floor((targetTime - nowTime) / 1000);
                let timeVoice = "";
                if (diffSecs > 60) timeVoice = `提早 ${Math.floor(diffSecs/60)} 分鐘`;
                else if (diffSecs < -60) timeVoice = `延遲 ${Math.floor(Math.abs(diffSecs)/60)} 分鐘`;
                else timeVoice = "準點";

                speakText(`抵達 ${targetStop.stop_name}，${timeVoice}`);
                window.currentStopIndex++; updateTacticalDisplay(); 
            }
        }

        if (!hasAnnouncedEnd) {
            const distToEnd = getDistanceKm(lng, lat, pts[pts.length-1].lng, pts[pts.length-1].lat) * 1000;
            if (distToEnd <= 40 || currentNavIdx >= pts.length - 3) {
                speakText("已抵達路線終點，本次清運任務結束，辛苦了！");
                hasAnnouncedEnd = true; document.getElementById('tacticalTimePanel').classList.add('hidden');
            }
        }

        if (minDist < 25) {
            isOffRoute = false; offRouteWarning.classList.add('hidden');
            if (wasOffRoute) { speakText("已重新回到原定路線。"); wasOffRoute = false; }
        } else {
            isOffRoute = true; wasOffRoute = true; offRouteWarning.classList.remove('hidden');
            if (Date.now() - window.lastOffRouteTime > 15000) {
                speakText("已偏離路線，請注意。"); vibrate([200, 100, 200]); autoWakeScreen();
                window.lastOffRouteTime = Date.now();
            }
        }

        if (!isOffRoute) {
            let lookAheadIdx = closestPtIdx, scanDist = 0;
            while (lookAheadIdx < pts.length - 1 && scanDist < 30) {
                scanDist += (getDistanceKm(pts[lookAheadIdx].lng, pts[lookAheadIdx].lat, pts[lookAheadIdx+1].lng, pts[lookAheadIdx+1].lat) * 1000);
                lookAheadIdx++;
            }

            if (lookAheadIdx > closestPtIdx && !triggeredTurnIndices.has(closestPtIdx)) {
                const currentSegAngle = getBearing(pts[closestPtIdx].lng, pts[closestPtIdx].lat, pts[closestPtIdx+1].lng, pts[closestPtIdx+1].lat);
                const futureSegAngle = getBearing(pts[lookAheadIdx-1].lng, pts[lookAheadIdx-1].lat, pts[lookAheadIdx].lng, pts[lookAheadIdx].lat);
                const angleDiff = getAngleDiff(currentSegAngle, futureSegAngle);
                
                if (angleDiff > 40 && angleDiff < 140) {
                    for(let k = Math.max(0, closestPtIdx - 3); k <= lookAheadIdx + 2; k++) triggeredTurnIndices.add(k);
                    autoWakeScreen(); 
                    // 🚀 換成 100% 絕對支援的基本大箭頭 (向右)
                    showNavAlert('<i class="fa-solid fa-arrow-right"></i>', '', 'bg-blue-600'); 
                    speakText("前方準備右轉"); 
                    autoSleepScreen();
                } else if (angleDiff < -40 && angleDiff > -140) {
                    for(let k = Math.max(0, closestPtIdx - 3); k <= lookAheadIdx + 2; k++) triggeredTurnIndices.add(k);
                    autoWakeScreen(); 
                    // 🚀 換成 100% 絕對支援的基本大箭頭 (向左)
                    showNavAlert('<i class="fa-solid fa-arrow-left"></i>', '', 'bg-blue-600'); 
                    speakText("前方準備左轉"); 
                    autoSleepScreen();
                }
            }

            mappedEvents.forEach((ev, idx) => {
                if (triggeredMusicIndices.has(idx)) return;
                // 🚀 軌跡進度誤差稍微放寬，但物理距離嚴格縮小到 15 公尺
                if (Math.abs(currentNavIdx - ev.ptIdx) <= 25) {
                    const distMeters = getDistanceKm(lng, lat, ev.lng, ev.lat) * 1000;
                    if (distMeters <= 15) {
                        triggeredMusicIndices.add(idx); autoWakeScreen();
                        if (ev.type === 'on') { showNavAlert('🎵', '開啟回收音樂！', 'bg-green-600'); speakText("請開啟音樂"); }
                        else if (ev.type === 'off') { showNavAlert('🔇', '關閉回收音樂！', 'bg-red-600'); speakText("請關閉音樂"); }
                        else if (ev.type === 'alert') { showNavAlert('⚠️', ev.note || '注意路況', 'bg-amber-600', ev.photo || null); speakText(`前方提醒，${ev.note}`); }
                        autoSleepScreen();
                    }
                }
            });
        }
    }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
};

const endFollowAction = () => {
    if (followWatchId !== null) {
        navigator.geolocation.clearWatch(followWatchId);
        followWatchId = null;
    }
    if (window.tacticalTimer !== null) {
        clearInterval(window.tacticalTimer);
        window.tacticalTimer = null;
    }
    window.activeFollowMappedEvents = null;
    if (typeof closeQuickNavAlertModal === 'function') closeQuickNavAlertModal();
    document.getElementById('tacticalTimePanel').classList.add('hidden');
    // 隱藏右下角的獨立結束按鈕與左下角的一鍵標記按鈕
    document.getElementById('tacticalStopBtn').classList.add('hidden');
    document.getElementById('tacticalQuickAlertBtn')?.classList.add('hidden');
    document.getElementById('musicAlertBanner').classList.add('hidden');
    document.getElementById('offRouteWarning').classList.add('hidden');
    exitBlackPowerSaveMode(false);
    releaseScreenWakeLockIfIdle();
    window.openRouteDetail(selectedRouteIdx);
};

document.getElementById('followStopBtn').onclick = endFollowAction;
document.getElementById('tacticalStopBtn').onclick = endFollowAction;

// --- 7.5 ⚠️ 遵循導航中「一鍵即時標記黃色注意點（預設自動啟動語音輸入，不自動彈出鍵盤）」 ---
const tacticalQuickAlertBtn = document.getElementById('tacticalQuickAlertBtn');
const quickNavAlertModal = document.getElementById('quickNavAlertModal');
const quickNavAlertInput = document.getElementById('quickNavAlertInput');
const quickNavAlertCoordBadge = document.getElementById('quickNavAlertCoordBadge');
const btnQuickNavVoiceInput = document.getElementById('btnQuickNavVoiceInput');
const quickNavVoiceIcon = document.getElementById('quickNavVoiceIcon');
const quickNavVoiceBtnText = document.getElementById('quickNavVoiceBtnText');
const quickNavVoiceStatus = document.getElementById('quickNavVoiceStatus');
const quickNavVoiceDot = document.getElementById('quickNavVoiceDot');
const quickNavVoiceStatusText = document.getElementById('quickNavVoiceStatusText');
const btnConfirmQuickNavAlert = document.getElementById('btnConfirmQuickNavAlert');
const btnCancelQuickNavAlert = document.getElementById('btnCancelQuickNavAlert');

let lockedQuickAlertLng = null;
let lockedQuickAlertLat = null;
let lockedQuickAlertPtIdx = 0;
let lockedQuickAlertBearing = 0;
let quickSpeechRecognition = null;
let isQuickSpeechListening = false;
let quickSpeechSessionId = 0;

function updateQuickVoiceStatusUI(mode, message) {
    if (!quickNavVoiceStatus) return;
    quickNavVoiceStatus.classList.remove('hidden');

    if (mode === 'listening') {
        quickNavVoiceStatus.className = 'voice-breathing-banner bg-red-50 border-2 border-red-300 text-red-600 rounded-2xl px-3.5 py-2.5 flex items-center justify-center gap-2 text-sm font-black text-center shadow-sm';
        if (quickNavVoiceDot) quickNavVoiceDot.className = 'voice-breathing-dot';
    } else if (mode === 'success') {
        quickNavVoiceStatus.className = 'bg-emerald-50 border-2 border-emerald-300 text-emerald-700 rounded-2xl px-3.5 py-2.5 flex items-center justify-center gap-2 text-xs sm:text-sm font-extrabold text-center shadow-sm';
        if (quickNavVoiceDot) quickNavVoiceDot.className = 'hidden';
    } else {
        quickNavVoiceStatus.className = 'bg-amber-50 border-2 border-amber-200 text-amber-700 rounded-2xl px-3.5 py-2.5 flex items-center justify-center gap-2 text-xs font-extrabold text-center shadow-sm';
        if (quickNavVoiceDot) quickNavVoiceDot.className = 'hidden';
    }

    if (quickNavVoiceStatusText) {
        quickNavVoiceStatusText.textContent = message;
    } else {
        quickNavVoiceStatus.textContent = message;
    }
}

function stopQuickSpeechRecognition() {
    isQuickSpeechListening = false;
    quickSpeechSessionId++;
    if (quickSpeechRecognition) {
        const recToStop = quickSpeechRecognition;
        quickSpeechRecognition = null;
        try {
            recToStop.onresult = null;
            recToStop.onerror = null;
            recToStop.onend = null;
            recToStop.stop();
        } catch (e) {}
    }
    if (btnQuickNavVoiceInput) {
        btnQuickNavVoiceInput.className = 'w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-2 border-indigo-200 font-extrabold py-3 px-4 rounded-2xl active:scale-95 transition-all flex items-center justify-center gap-2 text-sm shadow-sm';
    }
    if (quickNavVoiceIcon) {
        quickNavVoiceIcon.className = 'fa-solid fa-microphone-lines text-base text-indigo-600';
    }
    if (quickNavVoiceBtnText) {
        quickNavVoiceBtnText.textContent = '🎤 重新語音輸入';
    }
}

function startQuickSpeechRecognition(clearExisting = false) {
    stopQuickSpeechRecognition();

    if (clearExisting && quickNavAlertInput) {
        quickNavAlertInput.value = '';
    }

    // 暫停正在播報的 TTS 語音，避免干擾麥克風收音
    if ('speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
        updateQuickVoiceStatusUI('warn', '⚠️ 此瀏覽器不支援自動語音收音，請點擊輸入框使用鍵盤語音或手動輸入');
        return;
    }

    try {
        const sessionId = ++quickSpeechSessionId;
        const rec = new SpeechRec();
        rec.lang = 'zh-TW';
        rec.continuous = false;
        rec.interimResults = true;
        quickSpeechRecognition = rec;
        isQuickSpeechListening = true;

        updateQuickVoiceStatusUI('listening', '🔴 正在聆聽中... 請直接說話');

        if (btnQuickNavVoiceInput) {
            btnQuickNavVoiceInput.className = 'w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-2 border-indigo-200 font-extrabold py-3 px-4 rounded-2xl active:scale-95 transition-all flex items-center justify-center gap-2 text-sm shadow-sm';
        }
        if (quickNavVoiceIcon) {
            quickNavVoiceIcon.className = 'fa-solid fa-rotate-right text-base text-indigo-600';
        }
        if (quickNavVoiceBtnText) {
            quickNavVoiceBtnText.textContent = '🎤 重新語音輸入';
        }

        rec.onresult = (event) => {
            if (sessionId !== quickSpeechSessionId) return;
            let transcript = '';
            for (let i = 0; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            const cleanTranscript = transcript.trim();
            if (quickNavAlertInput && cleanTranscript) {
                quickNavAlertInput.value = cleanTranscript;
            }
        };

        rec.onerror = () => {
            if (sessionId !== quickSpeechSessionId) return;
            stopQuickSpeechRecognition();
            const hasText = Boolean(quickNavAlertInput && quickNavAlertInput.value.trim());
            if (hasText) {
                updateQuickVoiceStatusUI('success', '✅ 語音辨識完成！可直接點擊「確定標記」');
            } else {
                updateQuickVoiceStatusUI('warn', '⚠️ 未偵測到語音，請按「🎤 重新語音輸入」再講一次，或點擊文字框手動輸入');
            }
        };

        rec.onend = () => {
            if (sessionId !== quickSpeechSessionId) return;
            stopQuickSpeechRecognition();
            const hasText = Boolean(quickNavAlertInput && quickNavAlertInput.value.trim());
            if (hasText) {
                updateQuickVoiceStatusUI('success', '✅ 語音辨識完成！可直接點擊下方「確定標記」');
            } else {
                updateQuickVoiceStatusUI('warn', '🎤 收音結束（未偵測到語音），可按「🎤 重新語音輸入」或直接點擊「確定標記」');
            }
        };

        rec.start();
    } catch (err) {
        stopQuickSpeechRecognition();
        updateQuickVoiceStatusUI('warn', '⚠️ 無法啟動麥克風，請按「🎤 重新語音輸入」重試或點擊文字框輸入');
    }
}

function closeQuickNavAlertModal() {
    stopQuickSpeechRecognition();
    if (quickNavAlertInput) {
        quickNavAlertInput.blur();
    }
    if (quickNavAlertModal) {
        quickNavAlertModal.classList.add('hidden');
    }
}

function openQuickNavAlertModal() {
    const route = savedRoutes[selectedRouteIdx];
    if (!route || !Array.isArray(route.points) || route.points.length === 0) return;

    // 點擊瞬間立即擷取並鎖定當下最新的 GPS 經緯度與對應路線進度點（避免講話期間車輛移動導致標記偏移）
    const curLng = Array.isArray(lastKnownLngLat) && typeof lastKnownLngLat[0] === 'number'
        ? lastKnownLngLat[0]
        : route.points[0].lng;
    const curLat = Array.isArray(lastKnownLngLat) && typeof lastKnownLngLat[1] === 'number'
        ? lastKnownLngLat[1]
        : route.points[0].lat;

    lockedQuickAlertLng = Number(curLng);
    lockedQuickAlertLat = Number(curLat);
    lockedQuickAlertBearing = Number(currentHeading) || 0;

    let minDist = Infinity;
    let closestIdx = 0;
    for (let i = 0; i < route.points.length; i++) {
        const d = getDistanceKm(lockedQuickAlertLng, lockedQuickAlertLat, route.points[i].lng, route.points[i].lat);
        if (d < minDist) {
            minDist = d;
            closestIdx = i;
        }
    }
    lockedQuickAlertPtIdx = closestIdx;

    vibrate(50);

    if (quickNavAlertCoordBadge) {
        quickNavAlertCoordBadge.textContent = `📍 已鎖定座標 (${lockedQuickAlertLat.toFixed(4)}, ${lockedQuickAlertLng.toFixed(4)})`;
    }
    if (quickNavAlertInput) {
        quickNavAlertInput.value = '';
        // 禁止自動彈出手機鍵盤：確保輸入框不處於 focus 狀態，讓整個提醒視窗與下方大按鈕完整露出
        quickNavAlertInput.blur();
    }

    if (quickNavAlertModal) {
        window.history.pushState({ pwa: true }, '');
        quickNavAlertModal.classList.remove('hidden');
    }

    // 點擊黃色 ⚠️ 按鈕打開彈窗的同時，立即自動呼叫 Web Speech API (zh-TW) 開始收音
    startQuickSpeechRecognition(true);
}

if (tacticalQuickAlertBtn) {
    tacticalQuickAlertBtn.onclick = (e) => {
        e.stopPropagation();
        openQuickNavAlertModal();
    };
}

if (btnQuickNavVoiceInput) {
    btnQuickNavVoiceInput.onclick = () => {
        // 保持軟鍵盤收起，直接重新啟動語音輸入（並清空前一次講錯的內容重新填入）
        if (quickNavAlertInput) {
            quickNavAlertInput.blur();
        }
        startQuickSpeechRecognition(true);
    };
}

function confirmQuickNavAlert() {
    const route = savedRoutes[selectedRouteIdx];
    if (!route || lockedQuickAlertLng === null || lockedQuickAlertLat === null) {
        closeQuickNavAlertModal();
        return;
    }

    const noteVal = (quickNavAlertInput?.value || '').trim() || '注意路段';
    route.events = route.events || [];

    const newAlertEv = {
        type: 'alert',
        note: noteVal,
        lng: lockedQuickAlertLng,
        lat: lockedQuickAlertLat,
        ptIdx: lockedQuickAlertPtIdx,
        bearing: lockedQuickAlertBearing || 0
    };

    route.events.push(newAlertEv);

    // 同步加入當下正在執行的導航事件陣列，並標記為本次已觸發（避免剛標記完原地立刻重複播報，下趟經過時即正常播報）
    if (Array.isArray(window.activeFollowMappedEvents)) {
        const newIdx = window.activeFollowMappedEvents.length;
        window.activeFollowMappedEvents.push({ ...newAlertEv });
        triggeredMusicIndices.add(newIdx);
    }

    // 同步儲存回大容量資料庫 (localforage) 與 localStorage
    localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).catch(() => {});
    try {
        localStorage.setItem('yinggeCleanRoutes_v2', JSON.stringify(savedRoutes));
    } catch (e) {}

    // 同步更新路線詳情面板上的標記數量
    const detailEventsEl = document.getElementById('detailEvents');
    if (detailEventsEl) {
        detailEventsEl.innerText = `${route.events.length} 處`;
    }

    // 立即於地圖上渲染出該黃色驚嘆號提醒標記
    renderRouteMarkers(route);

    closeQuickNavAlertModal();
    vibrate([100, 50, 100]);
    showNavAlert('⚠️', `已標記：${noteVal}`, 'bg-amber-600');
}

if (btnConfirmQuickNavAlert) {
    btnConfirmQuickNavAlert.onclick = confirmQuickNavAlert;
}
if (btnCancelQuickNavAlert) {
    btnCancelQuickNavAlert.onclick = closeQuickNavAlertModal;
}
if (quickNavAlertInput) {
    quickNavAlertInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            confirmQuickNavAlert();
        }
    };
}

// --- 8. 路線分享與匯入功能 ---
document.getElementById('exportRouteBtn').onclick = async () => {
    const route = savedRoutes[selectedRouteIdx];
    const routeData = JSON.stringify(route);
    const blob = new Blob([routeData], { type: 'text/plain' });
    const file = new File([blob], `${route.name}.txt`, { type: 'text/plain' });
    
    // 🚀 判斷：如果手機支援原生分享
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { 
            await navigator.share({ title: '分享清運路線', files: [file] }); 
            return; // 分享成功，直接結束
        } catch (err) {
            // 🚀 核心修復：如果按了取消或分享中斷，直接 return 結束，不要往下跑去下載！
            return; 
        }
    }
    
    // 只有在完全不支援分享的設備，才會走到傳統下載備案
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${route.name}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert(`✅ 已下載檔案：${route.name}.txt\n請到手機的「下載」資料夾，以傳送檔案的方式發到 LINE 群組。`);
};

document.getElementById('importRouteInput').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const route = JSON.parse(event.target.result);
            if (!route.points || !route.name) throw new Error("格式不對");
            route.originId = route.originId || route.id || Date.now();
            route.routeId = route.routeId || generateRouteId();
            route.id = Date.now(); 
            savedRoutes.unshift(route);
            localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);
            document.getElementById('historyCount').innerText = savedRoutes.length;
            renderHistoryList();
            alert(`✅ 成功匯入【${route.author || '熱心隊員'}】精心製作的路線：${route.name}`);
        } catch (err) { alert('❌ 匯入失敗！請確認您選擇的是正確的路線檔案 (.txt)。'); }
        e.target.value = ''; 
    };
    reader.readAsText(file);
};

// --- 8.5 ☁️ 車隊雲端路線共享 (雙節點：正式庫 shared_routes ＆ 待審核區 pending_routes ＋ 管理員審核) ---
const FIREBASE_BASE_URL = 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app';
const FIREBASE_ROUTES_URL = `${FIREBASE_BASE_URL}/shared_routes.json`;
const FIREBASE_PENDING_URL = `${FIREBASE_BASE_URL}/pending_routes.json`;

const cloudRoutesModal = document.getElementById('cloudRoutesModal');
const cloudRoutesList = document.getElementById('cloudRoutesList');
const cloudCountBadge = document.getElementById('cloudCountBadge');
const importAllCloudBtn = document.getElementById('importAllCloudBtn');
const refreshCloudIcon = document.getElementById('refreshCloudIcon');
const adminToggleBtn = document.getElementById('adminToggleBtn');
const cloudAdminTabBar = document.getElementById('cloudAdminTabBar');
const tabSharedRoutesBtn = document.getElementById('tabSharedRoutesBtn');
const tabPendingRoutesBtn = document.getElementById('tabPendingRoutesBtn');
const pendingCountPill = document.getElementById('pendingCountPill');
const uploadConflictModal = document.getElementById('uploadConflictModal');

let cachedCloudRoutes = [];
let cachedPendingRoutes = [];
let isAdminUnlocked = false;
let currentCloudTab = 'shared'; // 'shared' | 'pending'

function getRouteTimestampKey(r) {
    return String(r.routeId || r.originId || r.id || r.uploadedAt || r.date || '').trim();
}

function isRouteAlreadyInLocal(cloudRoute) {
    const cRouteId = (cloudRoute.routeId || '').trim();
    const cName = (cloudRoute.name || '').trim().toLowerCase();
    const cId = cloudRoute.originId || cloudRoute.id;
    const cDate = (cloudRoute.date || '').trim();
    const cUpload = (cloudRoute.uploadedAt || '').trim();

    return savedRoutes.some(local => {
        const lRouteId = (local.routeId || '').trim();
        const lName = (local.name || '').trim().toLowerCase();
        const lUpload = (local.uploadedAt || '').trim();
        const lDate = (local.date || '').trim();
        const lId = local.originId || local.id;

        if (cRouteId && lRouteId && cRouteId === lRouteId) {
            // 若雲端版本有更新時間戳記且與本機不同，允許匯入覆蓋更新
            if (cUpload && lUpload && cUpload !== lUpload) return false;
            return true;
        }
        if (lName !== cName) return false;
        if (cId && lId && String(cId) === String(lId)) return true;
        if (cId && local.id && String(cId) === String(local.id)) return true;
        if (cloudRoute.id && lId && String(cloudRoute.id) === String(lId)) return true;
        if (cUpload && lUpload && cUpload === lUpload) return true;
        if (cDate && lDate && cDate === lDate) return true;
        return false;
    });
}

function askUploadConflictChoice(existingRoute, localRoute) {
    return new Promise((resolve) => {
        const descEl = document.getElementById('uploadConflictDesc');
        const matchReason = (existingRoute.routeId && existingRoute.routeId === localRoute.routeId)
            ? `相同路線 ID (${localRoute.routeId})`
            : `相同路線名稱【${existingRoute.name}】`;
        descEl.innerText = `雲端已存在${matchReason}（原創作者：${existingRoute.author || '隊員'}）。請選擇您要「覆蓋更新原路線」還是「另存為新路線」：`;
        uploadConflictModal.classList.remove('hidden');

        const cleanup = (choice) => {
            uploadConflictModal.classList.add('hidden');
            resolve(choice);
        };

        document.getElementById('btnConflictOverwrite').onclick = () => cleanup('overwrite');
        document.getElementById('btnConflictSaveNew').onclick = () => cleanup('new');
        document.getElementById('btnConflictCancel').onclick = () => cleanup(null);
    });
}

async function fetchRawFirebaseList(url) {
    const res = await fetchWithTimeout(url, { cache: 'no-store' }, 5000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];
    return Object.entries(data)
        .map(([firebaseKey, val]) => ({ ...val, firebaseKey }))
        .filter(item => item && item.name && Array.isArray(item.points) && item.points.length >= 2);
}

async function publishRouteToSharedDB(payload, overwriteMode) {
    const sharedList = await fetchRawFirebaseList(FIREBASE_ROUTES_URL);
    const targetMatches = sharedList.filter(item =>
        (payload.routeId && item.routeId && item.routeId === payload.routeId) ||
        ((item.name || '').trim().toLowerCase() === (payload.name || '').trim().toLowerCase())
    );

    const cleanPayload = { ...payload };
    delete cleanPayload.firebaseKey;
    delete cleanPayload.uploadAction;
    delete cleanPayload.targetFirebaseKey;

    if (overwriteMode && targetMatches.length > 0) {
        const primaryKey = targetMatches[0].firebaseKey;
        const putRes = await fetchWithTimeout(`${FIREBASE_BASE_URL}/shared_routes/${primaryKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cleanPayload)
        }, 5000);
        if (!putRes.ok) throw new Error(`PUT HTTP ${putRes.status}`);

        // 清理其餘重複的舊節點
        for (let i = 1; i < targetMatches.length; i++) {
            try {
                await fetchWithTimeout(`${FIREBASE_BASE_URL}/shared_routes/${targetMatches[i].firebaseKey}.json`, { method: 'DELETE' }, 5000);
            } catch (e) {}
        }
    } else {
        const postRes = await fetchWithTimeout(FIREBASE_ROUTES_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cleanPayload)
        }, 5000);
        if (!postRes.ok) throw new Error(`POST HTTP ${postRes.status}`);
    }
}

async function uploadRouteToCloud(routeIdx, btnEl) {
    const r = savedRoutes[routeIdx];
    if (!r) return;

    if (!navigator.onLine) {
        alert('⚠️ 目前無網路連線，請確認網路狀態後再上傳至雲端！');
        return;
    }

    // 確保具備唯一 routeId 並寫回本機
    if (!r.routeId) {
        r.routeId = generateRouteId();
        await localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);
    }

    if (!confirm(`確定要將路線【${r.name}】上傳至車隊雲端路線庫嗎？`)) return;

    const defaultAuthor = r.author || localStorage.getItem('fleet_user_name') || localStorage.getItem('yinggeRouteLastAuthor') || '凱哥';
    const authorInput = prompt('請輸入分享者（創作者）名稱：', defaultAuthor);
    if (authorInput === null) return;
    const finalAuthor = authorInput.trim() || defaultAuthor;
    localStorage.setItem('yinggeRouteLastAuthor', finalAuthor);

    if (r.author !== finalAuthor) {
        r.author = finalAuthor;
        localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => renderHistoryList());
    }

    const originalBtnHtml = btnEl ? btnEl.innerHTML : '⬆️ 上傳至雲端';
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 檢查中...';
        btnEl.classList.add('opacity-70');
    }

    try {
        // 1. 先檢查雲端正式庫是否已有相同 routeId 或相同名稱的路線
        const existingShared = await fetchRawFirebaseList(FIREBASE_ROUTES_URL);
        const conflictRoute = existingShared.find(item =>
            (item.routeId && item.routeId === r.routeId) ||
            ((item.name || '').trim().toLowerCase() === (r.name || '').trim().toLowerCase())
        );

        let uploadAction = 'new';
        let finalRouteId = r.routeId;
        let finalRouteName = r.name;

        if (conflictRoute) {
            const choice = await askUploadConflictChoice(conflictRoute, r);
            if (!choice) return; // 使用者取消上傳
            uploadAction = choice;
            if (choice === 'overwrite') {
                finalRouteId = conflictRoute.routeId || r.routeId;
                r.routeId = finalRouteId;
                await localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);
            } else if (choice === 'new') {
                finalRouteId = generateRouteId();
                r.routeId = finalRouteId;
                const newNameInput = prompt('您選擇「另存為新路線」，請確認或修改路線名稱：', r.name);
                if (newNameInput === null) return;
                if (newNameInput.trim()) {
                    finalRouteName = newNameInput.trim();
                    r.name = finalRouteName;
                }
                await localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);
                renderHistoryList();
            }
        }

        // 2. 判斷是否具有管理員權限（已解鎖管理員，或於提示框輸入管理員密碼）
        let publishDirectlyAsAdmin = isAdminUnlocked;
        if (!publishDirectlyAsAdmin) {
            const pwdInput = prompt('【一般隊員請直接按「確定」】送交至待審核區；\n🔑 若您是管理員，請輸入管理員密碼直接上架正式庫：', '');
            if (pwdInput === null) return; // 按取消則中止上傳
            if (pwdInput.trim() === ADMIN_PASSWORD) {
                publishDirectlyAsAdmin = true;
                setAdminModeUI(true);
            } else if (pwdInput.trim() !== '') {
                alert('⚠️ 管理員密碼不正確，將以一般隊員身分提交至「待審核區」。');
            }
        }

        if (btnEl) {
            btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 上傳中...';
        }

        const nowIso = new Date().toISOString();
        const uploadedAtText = new Date().toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const payload = {
            routeId: finalRouteId,
            id: r.id || Date.now(),
            originId: r.originId || r.id || Date.now(),
            name: finalRouteName,
            author: finalAuthor,
            date: r.date || uploadedAtText,
            uploadedAt: nowIso,
            uploadedAtText: uploadedAtText,
            distance: r.distance || '0.00',
            timeStr: r.timeStr || '0m 0s',
            uploadAction: uploadAction,
            targetFirebaseKey: conflictRoute ? conflictRoute.firebaseKey : null,
            points: r.points || [],
            events: r.events || []
        };

        r.uploadedAt = nowIso;
        r.uploadedAtText = uploadedAtText;
        await localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);

        if (publishDirectlyAsAdmin) {
            await publishRouteToSharedDB(payload, uploadAction === 'overwrite');
            alert(`✅ 管理員直通上架成功！\n路線【${finalRouteName}】已${uploadAction === 'overwrite' ? '覆蓋更新至' : '新增至'}正式雲端路線庫。`);
        } else {
            const res = await fetchWithTimeout(FIREBASE_PENDING_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }, 5000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            alert(`✅ 已提交至待審核區，待管理員確認後上架！\n\n路線名稱：${finalRouteName}\n分享隊員：${finalAuthor}\n提交模式：${uploadAction === 'overwrite' ? '🔄 覆蓋更新原路線' : '🆕 新增路線'}`);
        }
    } catch (err) {
        console.error('上傳雲端失敗:', err);
        alert('❌ 上傳失敗（網路不穩或連線逾時）！請檢查網路狀態後再試。');
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = originalBtnHtml;
            btnEl.classList.remove('opacity-70');
        }
    }
}

function setAdminModeUI(unlocked) {
    isAdminUnlocked = unlocked;
    if (isAdminUnlocked) {
        adminToggleBtn.className = "px-2.5 h-9 rounded-xl bg-amber-500 text-white border border-amber-600 text-xs font-extrabold flex items-center gap-1 shadow-sm active:scale-95 transition-all whitespace-nowrap";
        adminToggleBtn.innerHTML = '🔓 管理員';
        cloudAdminTabBar.classList.remove('hidden');
    } else {
        adminToggleBtn.className = "px-2.5 h-9 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-extrabold flex items-center gap-1 active:scale-95 transition-all whitespace-nowrap";
        adminToggleBtn.innerHTML = '🔑 管理員';
        cloudAdminTabBar.classList.add('hidden');
        currentCloudTab = 'shared';
        updateCloudTabButtons();
    }
}

function updateCloudTabButtons() {
    if (currentCloudTab === 'shared') {
        tabSharedRoutesBtn.className = "flex-1 py-2 rounded-xl text-xs font-extrabold bg-blue-600 text-white shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1";
        tabPendingRoutesBtn.className = "flex-1 py-2 rounded-xl text-xs font-extrabold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all active:scale-95 flex items-center justify-center gap-1.5";
    } else {
        tabSharedRoutesBtn.className = "flex-1 py-2 rounded-xl text-xs font-extrabold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all active:scale-95 flex items-center justify-center gap-1";
        tabPendingRoutesBtn.className = "flex-1 py-2 rounded-xl text-xs font-extrabold bg-amber-500 text-white shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1.5";
    }
}

adminToggleBtn.onclick = () => {
    if (!isAdminUnlocked) {
        const pwd = prompt('🔑 請輸入管理員密碼：');
        if (pwd === null) return;
        if (pwd.trim() === ADMIN_PASSWORD) {
            setAdminModeUI(true);
            fetchCloudRoutes();
            alert('✅ 管理員模式已解鎖！\n您現在可切換檢視「待審核投稿區」核准/退回路線，或直接刪除正式庫路線。');
        } else {
            alert('❌ 管理員密碼錯誤！');
        }
    } else {
        if (confirm('確定要退出管理員模式嗎？')) {
            setAdminModeUI(false);
            renderCloudRoutesList();
        }
    }
};

tabSharedRoutesBtn.onclick = () => {
    currentCloudTab = 'shared';
    updateCloudTabButtons();
    renderCloudRoutesList();
};

tabPendingRoutesBtn.onclick = () => {
    currentCloudTab = 'pending';
    updateCloudTabButtons();
    renderCloudRoutesList();
};

async function fetchCloudRoutes() {
    if (!navigator.onLine) {
        cloudCountBadge.innerText = '⚠️ 目前離線中';
        importAllCloudBtn.classList.add('hidden');
        cloudRoutesList.innerHTML = `
            <div class="text-center text-gray-400 py-14">
                <i class="fa-solid fa-wifi text-3xl mb-3 text-red-400"></i>
                <p class="text-sm font-extrabold text-gray-600">偵測不到網路連線</p>
                <p class="text-xs text-gray-400 mt-1">請開啟行動數據或 Wi-Fi 後點擊右上角重新整理</p>
            </div>`;
        alert('⚠️ 目前無網路連線，無法讀取雲端路線庫！');
        return;
    }

    cloudCountBadge.innerText = '⏳ 正在連線雲端資料庫...';
    importAllCloudBtn.classList.add('hidden');
    refreshCloudIcon?.classList.add('fa-spin');
    cloudRoutesList.innerHTML = `
        <div class="text-center text-gray-400 py-14">
            <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3 text-blue-500"></i>
            <p class="text-sm font-extrabold text-gray-600">正在載入車隊雲端路線...</p>
        </div>`;

    try {
        const [rawShared, rawPending] = await Promise.all([
            fetchRawFirebaseList(FIREBASE_ROUTES_URL),
            fetchRawFirebaseList(FIREBASE_PENDING_URL).catch(() => [])
        ]);

        // 排序正式庫（由新到舊）
        rawShared.sort((a, b) => {
            const tA = new Date(a.uploadedAt || 0).getTime() || Number(a.id) || 0;
            const tB = new Date(b.uploadedAt || 0).getTime() || Number(b.id) || 0;
            return tB - tA;
        });
        cachedCloudRoutes = rawShared;

        // 排序待審核區（由新到舊）
        rawPending.sort((a, b) => {
            const tA = new Date(a.uploadedAt || 0).getTime() || Number(a.id) || 0;
            const tB = new Date(b.uploadedAt || 0).getTime() || Number(b.id) || 0;
            return tB - tA;
        });
        cachedPendingRoutes = rawPending;
        if (pendingCountPill) pendingCountPill.innerText = cachedPendingRoutes.length;

        renderCloudRoutesList();
    } catch (err) {
        console.error('讀取雲端路線失敗:', err);
        cloudCountBadge.innerText = '❌ 讀取失敗';
        importAllCloudBtn.classList.add('hidden');
        cloudRoutesList.innerHTML = `
            <div class="text-center text-gray-400 py-14">
                <i class="fa-solid fa-triangle-exclamation text-3xl mb-3 text-amber-500"></i>
                <p class="text-sm font-extrabold text-gray-600">無法讀取雲端路線庫</p>
                <p class="text-xs text-gray-400 mt-1">請確認網路連線正常，再點擊右上角重新整理</p>
            </div>`;
        alert('❌ 無法連線至雲端路線庫（連線逾時或網路不穩），請稍後再試！');
    } finally {
        refreshCloudIcon?.classList.remove('fa-spin');
    }
}

async function approvePendingRoute(pendingIdx, btnEl) {
    const pr = cachedPendingRoutes[pendingIdx];
    if (!pr || !isAdminUnlocked) return;

    const cleanName = (pr.name || '').replace(/^\[待審預覽\]\s*/, '');
    const isOverwrite = pr.uploadAction === 'overwrite';
    const modeText = isOverwrite ? '【覆蓋更新】正式庫舊版路線' : '【新增上架】至正式路線庫';
    if (!confirm(`確定要核准【${pr.author || '隊員'}】投稿的路線「${cleanName}」並${modeText}嗎？`)) return;

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 核准中';
    }

    try {
        const payloadToPublish = { ...pr, name: cleanName };
        await publishRouteToSharedDB(payloadToPublish, isOverwrite);
        const delRes = await fetchWithTimeout(`${FIREBASE_BASE_URL}/pending_routes/${pr.firebaseKey}.json`, { method: 'DELETE' }, 5000);
        if (!delRes.ok) throw new Error(`DELETE pending HTTP ${delRes.status}`);

        alert(`✅ 已核准上架路線【${cleanName}】！`);
        await fetchCloudRoutes();
    } catch (err) {
        console.error('核准失敗:', err);
        alert('❌ 核准上架失敗（網路不穩或逾時），請檢查網路連線後再試！');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '✅ 核准上架';
        }
    }
}

function previewPendingRoute(pendingIdx) {
    const pr = cachedPendingRoutes[pendingIdx];
    if (!pr || !isAdminUnlocked) return;

    const cleanBaseName = (pr.name || '未命名路線').replace(/^\[待審預覽\]\s*/, '');
    const previewName = `[待審預覽] ${cleanBaseName}`;
    const previewRouteId = `preview_${pr.firebaseKey || pr.routeId || Date.now()}`;

    const previewRouteObj = {
        routeId: previewRouteId,
        id: Date.now(),
        originId: pr.originId || pr.id || Date.now(),
        name: previewName,
        author: pr.author || '熱心隊員',
        date: pr.date || pr.uploadedAtText || new Date().toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        uploadedAt: pr.uploadedAt || '',
        uploadedAtText: pr.uploadedAtText || '',
        distance: pr.distance || '0.00',
        timeStr: pr.timeStr || '0m 0s',
        isPendingPreview: true,
        points: JSON.parse(JSON.stringify(pr.points || [])),
        events: JSON.parse(JSON.stringify(pr.events || []))
    };

    const existingPreviewIdx = savedRoutes.findIndex(r => r.routeId === previewRouteId || r.name === previewName);
    if (existingPreviewIdx !== -1) {
        savedRoutes.splice(existingPreviewIdx, 1);
    }
    savedRoutes.unshift(previewRouteObj);

    localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => {
        document.getElementById('historyCount').innerText = savedRoutes.length;
        renderHistoryList();
        renderCloudRoutesList();
        alert('已匯入本機清單，請關閉雲端視窗後點擊該路線進行地圖預覽');
    });
}

async function rejectPendingRoute(pendingIdx, btnEl) {
    const pr = cachedPendingRoutes[pendingIdx];
    if (!pr || !isAdminUnlocked) return;

    if (!confirm(`確定要刪除/退回待審核路線【${pr.name}】（投稿者：${pr.author || '隊員'}）嗎？`)) return;

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
        const res = await fetchWithTimeout(`${FIREBASE_BASE_URL}/pending_routes/${pr.firebaseKey}.json`, { method: 'DELETE' }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        alert(`🗑️ 已刪除/退回待審核路線【${pr.name}】。`);
        await fetchCloudRoutes();
    } catch (err) {
        console.error('刪除待審核路線失敗:', err);
        alert('❌ 刪除失敗（網路不穩或逾時），請檢查網路連線後再試！');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '🗑️ 刪除/退回';
        }
    }
}

async function deleteSharedCloudRoute(sharedIdx, btnEl) {
    const cr = cachedCloudRoutes[sharedIdx];
    if (!cr || !isAdminUnlocked) return;

    if (!confirm(`⚠️ 管理員確認：\n確定要從「正式雲端路線庫」永久刪除【${cr.name}】嗎？`)) return;

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
        const res = await fetchWithTimeout(`${FIREBASE_BASE_URL}/shared_routes/${cr.firebaseKey}.json`, { method: 'DELETE' }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        alert(`🗑️ 已從正式雲端路線庫刪除【${cr.name}】。`);
        await fetchCloudRoutes();
    } catch (err) {
        console.error('刪除雲端路線失敗:', err);
        alert('❌ 刪除失敗（網路不穩或逾時），請檢查網路連線後再試！');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '🗑️ 刪除';
        }
    }
}

function renderCloudRoutesList() {
    cloudRoutesList.innerHTML = '';
    if (pendingCountPill) pendingCountPill.innerText = cachedPendingRoutes.length;

    // --- 管理員「待審核投稿區」視圖 ---
    if (isAdminUnlocked && currentCloudTab === 'pending') {
        importAllCloudBtn.classList.add('hidden');
        if (cachedPendingRoutes.length === 0) {
            cloudCountBadge.innerText = '目前共 0 條待審核路線';
            cloudRoutesList.innerHTML = `
                <div class="text-center text-gray-400 py-14">
                    <i class="fa-solid fa-clipboard-check text-3xl mb-2 opacity-40"></i>
                    <p class="text-sm font-bold">目前沒有待審核的投稿路線</p>
                </div>`;
            return;
        }

        cloudCountBadge.innerText = `⏳ 待審核投稿共 ${cachedPendingRoutes.length} 條`;
        cachedPendingRoutes.forEach((pr, idx) => {
            const stopsCount = (pr.points || []).filter(p => p.is_stop).length;
            const eventsCount = (pr.events || []).length;
            const timeDisplay = pr.uploadedAtText || pr.date || '未知時間';
            const isOverwrite = pr.uploadAction === 'overwrite';
            const actionBadge = isOverwrite
                ? `<span class="bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded-full font-extrabold">🔄 覆蓋更新原路線</span>`
                : `<span class="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded-full font-extrabold">🆕 新增路線</span>`;

            const card = document.createElement('div');
            card.className = "bg-white p-3.5 rounded-2xl shadow-sm border-2 border-amber-200 flex flex-col gap-2.5";
            card.innerHTML = `
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-black text-gray-900 text-sm truncate">${pr.name}</span>
                            <span class="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap">
                                <i class="fa-solid fa-user-ninja mr-0.5"></i>${pr.author || '熱心隊員'}
                            </span>
                            ${actionBadge}
                        </div>
                        <div class="text-[11px] text-gray-400 mt-1">投稿時間：${timeDisplay}</div>
                        <div class="flex items-center gap-3 text-[11px] font-bold mt-1">
                            <span class="text-blue-600"><i class="fa-solid fa-route mr-1"></i>${pr.distance || '0.00'} km</span>
                            <span class="text-green-600"><i class="fa-solid fa-music mr-1"></i>${eventsCount} 處標記</span>
                            ${stopsCount > 0 ? `<span class="text-indigo-600"><i class="fa-regular fa-clock mr-1"></i>${stopsCount} 站牌</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 pt-1 border-t border-gray-100">
                    <button type="button" class="preview-pending-btn flex-1 bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-2 rounded-xl text-xs shadow-sm active:scale-95 transition-all whitespace-nowrap">
                        📥 下載試看
                    </button>
                    <button type="button" class="approve-pending-btn flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-2 rounded-xl text-xs shadow-sm active:scale-95 transition-all whitespace-nowrap">
                        ✅ 核准上架
                    </button>
                    <button type="button" class="reject-pending-btn bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-extrabold px-3 py-2 rounded-xl text-xs active:scale-95 transition-all whitespace-nowrap">
                        🗑️ 刪除/退回
                    </button>
                </div>
            `;

            const previewBtn = card.querySelector('.preview-pending-btn');
            const approveBtn = card.querySelector('.approve-pending-btn');
            const rejectBtn = card.querySelector('.reject-pending-btn');
            previewBtn.onclick = () => previewPendingRoute(idx);
            approveBtn.onclick = () => approvePendingRoute(idx, approveBtn);
            rejectBtn.onclick = () => rejectPendingRoute(idx, rejectBtn);
            cloudRoutesList.appendChild(card);
        });
        return;
    }

    // --- 「正式路線庫」視圖 ---
    if (cachedCloudRoutes.length === 0) {
        cloudCountBadge.innerText = '目前共 0 條雲端路線';
        importAllCloudBtn.classList.add('hidden');
        cloudRoutesList.innerHTML = `
            <div class="text-center text-gray-400 py-14">
                <i class="fa-solid fa-cloud text-3xl mb-2 opacity-40"></i>
                <p class="text-sm font-bold">雲端尚無共享的清運路線</p>
                <p class="text-xs text-gray-400 mt-1">可從本機路線卡片點擊「⬆️ 上傳至雲端」分享第一條路線！</p>
            </div>`;
        return;
    }

    cloudCountBadge.innerText = `共 ${cachedCloudRoutes.length} 條雲端共享路線`;
    importAllCloudBtn.classList.remove('hidden');

    cachedCloudRoutes.forEach((cr, idx) => {
        const alreadyLocal = isRouteAlreadyInLocal(cr);
        const stopsCount = (cr.points || []).filter(p => p.is_stop).length;
        const eventsCount = (cr.events || []).length;
        const timeDisplay = cr.uploadedAtText || cr.date || '未知時間';

        const card = document.createElement('div');
        card.className = "bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between gap-2";
        card.innerHTML = `
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-black text-gray-900 text-sm truncate">${cr.name}</span>
                    <span class="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap">
                        <i class="fa-solid fa-user-ninja mr-0.5"></i>${cr.author || '熱心隊員'}
                    </span>
                </div>
                <div class="text-[11px] text-gray-400 mt-0.5">上傳/建立：${timeDisplay}</div>
                <div class="flex items-center gap-3 text-[11px] font-bold mt-1">
                    <span class="text-blue-600"><i class="fa-solid fa-route mr-1"></i>${cr.distance || '0.00'} km</span>
                    <span class="text-green-600"><i class="fa-solid fa-music mr-1"></i>${eventsCount} 處標記</span>
                    ${stopsCount > 0 ? `<span class="text-indigo-600"><i class="fa-regular fa-clock mr-1"></i>${stopsCount} 站牌</span>` : ''}
                </div>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
                <button type="button" class="single-cloud-import-btn px-3 py-2 rounded-xl text-xs font-extrabold transition-all active:scale-95 ${
                    alreadyLocal
                        ? 'bg-gray-100 text-gray-400 border border-gray-200'
                        : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                }">
                    ${alreadyLocal ? '✅ 已匯入' : '⬇️ 選擇匯入'}
                </button>
                ${isAdminUnlocked ? `
                <button type="button" class="admin-delete-shared-btn bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-2.5 py-2 rounded-xl text-xs font-extrabold active:scale-95 transition-all" title="管理員刪除此雲端路線">
                    🗑️ 刪除
                </button>` : ''}
            </div>
        `;

        card.querySelector('.single-cloud-import-btn').onclick = () => importSingleCloudRoute(idx);
        const delBtn = card.querySelector('.admin-delete-shared-btn');
        if (delBtn) {
            delBtn.onclick = () => deleteSharedCloudRoute(idx, delBtn);
        }
        cloudRoutesList.appendChild(card);
    });
}

function cloneCloudRouteForLocal(cr) {
    return {
        routeId: cr.routeId || generateRouteId(),
        id: cr.id || Date.now() + Math.floor(Math.random() * 1000),
        originId: cr.originId || cr.id || Date.now(),
        name: cr.name,
        author: cr.author || '熱心隊員',
        date: cr.date || cr.uploadedAtText || new Date().toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        uploadedAt: cr.uploadedAt || '',
        uploadedAtText: cr.uploadedAtText || '',
        distance: cr.distance || '0.00',
        timeStr: cr.timeStr || '0m 0s',
        points: JSON.parse(JSON.stringify(cr.points || [])),
        events: JSON.parse(JSON.stringify(cr.events || []))
    };
}

function upsertLocalRouteFromCloud(cr) {
    const newRoute = cloneCloudRouteForLocal(cr);
    const existingIdx = savedRoutes.findIndex(local =>
        (local.routeId && newRoute.routeId && local.routeId === newRoute.routeId)
    );
    if (existingIdx !== -1) {
        savedRoutes[existingIdx] = newRoute;
    } else {
        savedRoutes.unshift(newRoute);
    }
    return newRoute;
}

function importSingleCloudRoute(cloudIdx) {
    const cr = cachedCloudRoutes[cloudIdx];
    if (!cr) return;

    if (isRouteAlreadyInLocal(cr)) {
        alert(`ℹ️ 路線【${cr.name}】已是最新版本並存在於本機路線庫中，無須重複匯入！`);
        renderCloudRoutesList();
        return;
    }

    const newRoute = upsertLocalRouteFromCloud(cr);
    localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => {
        document.getElementById('historyCount').innerText = savedRoutes.length;
        renderHistoryList();
        renderCloudRoutesList();
        alert(`✅ 成功匯入【${newRoute.author}】分享的路線：${newRoute.name}`);
    });
}

importAllCloudBtn.onclick = () => {
    if (!cachedCloudRoutes || cachedCloudRoutes.length === 0) return;

    let addedCount = 0;
    let skippedCount = 0;

    // 由舊到新依序處理，確保最新路線維持在最上方
    [...cachedCloudRoutes].reverse().forEach(cr => {
        if (isRouteAlreadyInLocal(cr)) {
            skippedCount++;
        } else {
            upsertLocalRouteFromCloud(cr);
            addedCount++;
        }
    });

    if (addedCount === 0) {
        alert(`ℹ️ 雲端共 ${skippedCount} 條路線皆已存在於本機，無須重複匯入！`);
        renderCloudRoutesList();
        return;
    }

    localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => {
        document.getElementById('historyCount').innerText = savedRoutes.length;
        renderHistoryList();
        renderCloudRoutesList();
        alert(`✅ 一鍵匯入完成！\n成功新增/更新 ${addedCount} 條路線${skippedCount > 0 ? `（已自動略過 ${skippedCount} 條重複路線）` : ''}。`);
    });
};

document.getElementById('openCloudModalBtn').onclick = () => {
    cloudRoutesModal.classList.remove('hidden');
    fetchCloudRoutes();
};
document.getElementById('refreshCloudBtn').onclick = () => fetchCloudRoutes();
document.getElementById('closeCloudModalBtn').onclick = () => cloudRoutesModal.classList.add('hidden');

document.getElementById('settingsBtn').onclick = () => document.getElementById('settingsModal').classList.remove('hidden');
document.getElementById('closeSettings').onclick = () => document.getElementById('settingsModal').classList.add('hidden');
window.setMode = function(sec, meters, text) {
    gpsFreqMs = sec * 1000; minMoveMeters = meters;
    document.getElementById('currentModeText').innerText = text;
    document.getElementById('settingsModal').classList.add('hidden');
};

// ==========================================
// 🚛 9. 全自動車隊支援定位雷達（全模式通用）
// ==========================================
const LIVE_FLEET_BASE_URL = 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app/live_fleet';
const LIVE_FLEET_ALL_URL = `${LIVE_FLEET_BASE_URL}.json`;

// 獨立的友車圖層群組（不受 clearDomMarkers 影響，進入導航或切換路線時依然保留）
const fleetLayerGroup = {};

let fleetDeviceId = localStorage.getItem('deviceId') || localStorage.getItem('fleet_device_id');
if (!fleetDeviceId) {
    fleetDeviceId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem('deviceId', fleetDeviceId);
    localStorage.setItem('fleet_device_id', fleetDeviceId);
} else {
    localStorage.setItem('deviceId', fleetDeviceId);
    localStorage.setItem('fleet_device_id', fleetDeviceId);
}

let fleetUserName = (localStorage.getItem('fleet_user_name') || '').trim();
let currentFleetLat = null;
let currentFleetLng = null;
let lastUploadedFleetLat = null;
let lastUploadedFleetLng = null;
let lastFleetUploadTime = 0;
let fleetRadarStarted = false;
let fleetPollTimer = null;
let fleetHeartbeatTimer = null;
let fleetRadarWatchId = null;
let isUploadingFleetLocation = false;
let isFetchingFleetRadar = false;

const fleetUserNameModal = document.getElementById('fleetUserNameModal');
const fleetUserNameInput = document.getElementById('fleetUserNameInput');
const btnSaveFleetUserName = document.getElementById('btnSaveFleetUserName');
const btnCancelFleetUserName = document.getElementById('btnCancelFleetUserName');
const fleetUserBadgeBtn = document.getElementById('fleetUserBadgeBtn');
const fleetUserBadgeText = document.getElementById('fleetUserBadgeText');
const settingsFleetNameText = document.getElementById('settingsFleetNameText');
const settingsEditFleetNameBtn = document.getElementById('settingsEditFleetNameBtn');
const welcomeProfileModal = document.getElementById('welcomeProfileModal');
const welcomeProfileTitle = document.getElementById('welcomeProfileTitle');
const btnCloseWelcomeModal = document.getElementById('btnCloseWelcomeModal');

function showWelcomeProfileModal(name) {
    if (!welcomeProfileModal || !welcomeProfileTitle) return;
    welcomeProfileTitle.textContent = `🎉 歡迎 ${name} 使用智能循跡導航系統！`;
    welcomeProfileModal.classList.remove('hidden');
}

if (btnCloseWelcomeModal) {
    btnCloseWelcomeModal.onclick = () => {
        if (welcomeProfileModal) welcomeProfileModal.classList.add('hidden');
    };
}
if (welcomeProfileModal) {
    welcomeProfileModal.onclick = (e) => {
        if (e.target === welcomeProfileModal) welcomeProfileModal.classList.add('hidden');
    };
}

function syncFleetUserNameUI() {
    const display = fleetUserName || '設定名稱';
    if (fleetUserBadgeText) fleetUserBadgeText.innerText = display;
    if (settingsFleetNameText) settingsFleetNameText.innerText = fleetUserName || '未設定';
    if (fleetUserName) {
        localStorage.setItem('yinggeRouteLastAuthor', fleetUserName);
    }
}

function openFleetUserNameModal(isInitial) {
    fleetUserNameInput.value = fleetUserName || localStorage.getItem('yinggeRouteLastAuthor') || '';
    if (isInitial) {
        btnCancelFleetUserName.classList.add('hidden');
    } else {
        btnCancelFleetUserName.classList.remove('hidden');
    }
    fleetUserNameModal.classList.remove('hidden');
    setTimeout(() => fleetUserNameInput.focus(), 100);
}

function saveFleetUserNameFromModal() {
    const val = (fleetUserNameInput.value || '').trim();
    if (!val) {
        alert('請輸入您的名稱（例如：凱哥、阿翔）！');
        fleetUserNameInput.focus();
        return;
    }
    fleetUserName = val;
    localStorage.setItem('fleet_user_name', fleetUserName);
    localStorage.setItem('yinggeRouteLastAuthor', fleetUserName);
    syncFleetUserNameUI();
    fleetUserNameModal.classList.add('hidden');

    // 立即跳出醒目美觀的歡迎提示框
    showWelcomeProfileModal(fleetUserName);

    // 在背景正常啟動原本的連線功能
    startFleetRadarSystem();
    if (currentFleetLat !== null && currentFleetLng !== null) {
        uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
    }
}

btnSaveFleetUserName.onclick = saveFleetUserNameFromModal;
fleetUserNameInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        saveFleetUserNameFromModal();
    }
};
btnCancelFleetUserName.onclick = () => fleetUserNameModal.classList.add('hidden');

fleetUserBadgeBtn.onclick = () => openFleetUserNameModal(false);
if (settingsEditFleetNameBtn) {
    settingsEditFleetNameBtn.onclick = () => {
        document.getElementById('settingsModal').classList.add('hidden');
        openFleetUserNameModal(false);
    };
}

async function uploadMyFleetLocation(lat, lng, forceUpload = false) {
    if (!fleetUserName || typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    if (!navigator.onLine || isUploadingFleetLocation) return;

    const now = Date.now();
    if (!forceUpload && lastUploadedFleetLat !== null && lastUploadedFleetLng !== null) {
        const distMeters = getDistanceKm(lastUploadedFleetLng, lastUploadedFleetLat, lng, lat) * 1000;
        if (distMeters <= 10) return; // 移動未超過 10 公尺不重複上傳
    }

    const prevLat = lastUploadedFleetLat;
    const prevLng = lastUploadedFleetLng;
    lastUploadedFleetLat = lat;
    lastUploadedFleetLng = lng;
    lastFleetUploadTime = now;
    isUploadingFleetLocation = true;

    const payload = {
        name: fleetUserName,
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        updatedAt: now
    };

    try {
        await fetchWithTimeout(`${LIVE_FLEET_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true
        }, 5000);
    } catch (err) {
        // 巷弄斷網或超時靜默略過，還原座標基準以便下一週期自動恢復補傳
        lastUploadedFleetLat = prevLat;
        lastUploadedFleetLng = prevLng;
    } finally {
        isUploadingFleetLocation = false;
    }
}

window.onFleetPositionUpdate = function(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    currentFleetLat = lat;
    currentFleetLng = lng;
    if (fleetUserName) {
        uploadMyFleetLocation(lat, lng, false);
    }
};

function createFleetTruckMarkerElement(memberName) {
    const wrapper = document.createElement('div');
    wrapper.className = 'fleet-truck-marker flex flex-col items-center pointer-events-none select-none';
    wrapper.style.filter = 'drop-shadow(0 3px 6px rgba(0,0,0,0.38))';
    wrapper.innerHTML = `
        <div class="bg-emerald-600 text-white px-2.5 py-1 rounded-full border-2 border-white font-black text-xs flex items-center gap-1.5 whitespace-nowrap shadow-md">
            <i class="fa-solid fa-truck text-amber-300 text-xs"></i>
            <span class="fleet-member-name"></span>
        </div>
        <div class="w-2.5 h-2.5 bg-emerald-600 border-r-2 border-b-2 border-white transform rotate-45 -mt-1.5"></div>
    `;
    wrapper.querySelector('.fleet-member-name').textContent = memberName || '隊員';
    return wrapper;
}

async function fetchAndRenderFleetRadar() {
    if (!fleetUserName || !navigator.onLine || isFetchingFleetRadar) return;
    // 純黑省電模式下暫停地圖友車標記重繪，於喚醒畫面時立即同步更新
    if (isPowerSaveMapPaused()) return;
    isFetchingFleetRadar = true;
    try {
        const res = await fetchWithTimeout(LIVE_FLEET_ALL_URL, { cache: 'no-store' }, 5000);
        if (!res.ok) return;
        const data = await res.json();
        const now = Date.now();
        const activeIds = new Set();

        if (data && typeof data === 'object') {
            Object.entries(data).forEach(([devId, info]) => {
                if (!info || devId === fleetDeviceId) return; // 排除自己
                const lat = Number(info.lat);
                const lng = Number(info.lng);
                const updatedAt = typeof info.updatedAt === 'number'
                    ? info.updatedAt
                    : new Date(info.updatedAt || 0).getTime();

                if (isNaN(lat) || isNaN(lng) || !updatedAt) return;
                // 僅顯示 3 分鐘（180 秒）內有更新的線上友車
                if (now - updatedAt > 180 * 1000) return;

                activeIds.add(devId);
                const memberName = (info.name || '隊員').trim();

                if (fleetLayerGroup[devId]) {
                    fleetLayerGroup[devId].marker.setLngLat([lng, lat]);
                    if (fleetLayerGroup[devId].name !== memberName) {
                        const nameSpan = fleetLayerGroup[devId].el.querySelector('.fleet-member-name');
                        if (nameSpan) nameSpan.textContent = memberName;
                        fleetLayerGroup[devId].name = memberName;
                    }
                } else {
                    const el = createFleetTruckMarkerElement(memberName);
                    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
                        .setLngLat([lng, lat])
                        .addTo(map);
                    fleetLayerGroup[devId] = { marker, el, name: memberName };
                }
            });
        }

        // 移除超過 3 分鐘未更新或已離線的友車標記
        Object.keys(fleetLayerGroup).forEach(devId => {
            if (!activeIds.has(devId)) {
                fleetLayerGroup[devId].marker.remove();
                delete fleetLayerGroup[devId];
            }
        });
    } catch (err) {
        // 巷弄斷網或 5 秒逾時靜默略過，不干擾導航並於下週期自動恢復
    } finally {
        isFetchingFleetRadar = false;
    }
}

function removeMyFleetLocationOnUnload() {
    if (!fleetDeviceId) return;
    const targetUrl = `${LIVE_FLEET_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`;
    try {
        fetchWithTimeout(targetUrl, {
            method: 'DELETE',
            keepalive: true
        }, 5000).catch(() => {});
    } catch (e) {}
}

// 僅於實際關閉分頁 (beforeunload) 時嘗試清除，移除 pagehide / visibilitychange 刪除動作，
// 避免司機切換至 LINE 或講電話時在地圖上瞬間消失（異常斷線亦由雲端 3 分鐘逾時機制自動清除）
window.addEventListener('beforeunload', removeMyFleetLocationOnUnload);

// ==========================================
// 🔇 輕量級「背景無聲保活機制」(AudioContext + 靜音音軌循環)
// 降低手機切換至背景 (LINE / 通話) 或鎖屏時凍結 GPS 與車隊雷達上傳的機率
// ==========================================
let bgSilentAudioCtx = null;
let bgSilentAudioEl = null;
let bgSilentKeepAliveStarted = false;

function createSilentWavDataUri() {
    // 產生 1 秒、8000Hz、8-bit Mono 的極輕量無聲 WAV
    const sampleRate = 8000;
    const numSamples = sampleRate;
    const buffer = new ArrayBuffer(44 + numSamples);
    const view = new DataView(buffer);
    const writeStr = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true); // 8-bit
    writeStr(36, 'data');
    view.setUint32(40, numSamples, true);
    for (let i = 0; i < numSamples; i++) {
        view.setUint8(44 + i, 128); // 8-bit PCM 128 為完全靜音
    }
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return 'data:audio/wav;base64,' + btoa(binary);
}

function ensureBackgroundSilentKeepAlive() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            if (!bgSilentAudioCtx) {
                bgSilentAudioCtx = new AudioCtx();
                const osc = bgSilentAudioCtx.createOscillator();
                const gain = bgSilentAudioCtx.createGain();
                // 極微小增益 (0.00001) 完全無聲，同時防止瀏覽器判定為空音軌而休眠
                gain.gain.value = 0.00001;
                osc.connect(gain);
                gain.connect(bgSilentAudioCtx.destination);
                osc.start();
            }
            if (bgSilentAudioCtx.state === 'suspended') {
                bgSilentAudioCtx.resume().catch(() => {});
            }
        }
    } catch (e) {}

    try {
        if (!bgSilentAudioEl) {
            bgSilentAudioEl = new Audio(createSilentWavDataUri());
            bgSilentAudioEl.loop = true;
            bgSilentAudioEl.volume = 0.01;
            bgSilentAudioEl.setAttribute('playsinline', '');
            bgSilentAudioEl.setAttribute('webkit-playsinline', '');
        }
        if (bgSilentAudioEl.paused) {
            bgSilentAudioEl.play().catch(() => {});
        }
    } catch (e) {}

    bgSilentKeepAliveStarted = true;
}

['pointerdown', 'touchstart', 'click', 'keydown'].forEach(evtName => {
    window.addEventListener(evtName, function onFirstUserInteract() {
        ensureBackgroundSilentKeepAlive();
        if (bgSilentAudioCtx && bgSilentAudioCtx.state === 'running') {
            window.removeEventListener(evtName, onFirstUserInteract);
        }
    }, { passive: true });
});

function startFleetRadarSystem() {
    if (!fleetUserName) return;

    // 單一實例保護：啟動前先清除舊的監聽 ID 與計時器，保證全域永遠只有單一實例在運作
    if (fleetRadarWatchId !== null) {
        navigator.geolocation.clearWatch(fleetRadarWatchId);
        fleetRadarWatchId = null;
    }
    if (fleetPollTimer !== null) {
        clearInterval(fleetPollTimer);
        fleetPollTimer = null;
    }
    if (fleetHeartbeatTimer !== null) {
        clearInterval(fleetHeartbeatTimer);
        fleetHeartbeatTimer = null;
    }

    fleetRadarStarted = true;

    // 啟動全模式背景定位監聽（確保即使在預覽或切換畫面時也能持續更新座標）
    if ('geolocation' in navigator) {
        fleetRadarWatchId = navigator.geolocation.watchPosition(pos => {
            window.onFleetPositionUpdate(pos.coords.latitude, pos.coords.longitude);
        }, () => {}, { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 });
    }

    // 若目前已有定位座標，立即進行首次上線回報
    if (lastKnownLngLat && Array.isArray(lastKnownLngLat) && currentFleetLat !== null) {
        uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
    } else if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(pos => {
            window.onFleetPositionUpdate(pos.coords.latitude, pos.coords.longitude);
        }, () => {}, { enableHighAccuracy: true });
    }

    // 每 8 秒靜默讀取 /live_fleet.json 更新友車圖層
    fetchAndRenderFleetRadar();
    fleetPollTimer = setInterval(fetchAndRenderFleetRadar, 8000);
    if (typeof fetchAndRenderSharedMapPins === 'function') {
        fetchAndRenderSharedMapPins();
    }

    // 60 秒定點心跳保活機制：若超過 60 秒未觸發移動上傳，原地補送一次 updatedAt
    fleetHeartbeatTimer = setInterval(() => {
        if (!fleetUserName || currentFleetLat === null || currentFleetLng === null) return;
        if (Date.now() - lastFleetUploadTime >= 60000) {
            uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
        }
    }, 10000);
}

// 初始化檢查使用者名稱與啟動車隊雷達
syncFleetUserNameUI();
if (fleetUserName) {
    startFleetRadarSystem();
} else {
    openFleetUserNameModal(true);
}

document.addEventListener('visibilitychange', async () => {
    if (bgSilentKeepAliveStarted) {
        ensureBackgroundSilentKeepAlive();
    }
    if (document.visibilityState === 'visible') {
        ensurePureBlackSystemBars();
        if (isBlackScreenActive || isRecording || followWatchId !== null) {
            await requestScreenWakeLock();
        }
        if (fleetUserName && currentFleetLat !== null && currentFleetLng !== null) {
            uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
        }
        fetchAndRenderFleetRadar();
        if (typeof fetchAndRenderSharedMapPins === 'function') {
            fetchAndRenderSharedMapPins();
        }
    }
});

// ==========================================
// 📍 10. 全車隊共享地圖地標（藍色水滴＋縮圖照片）
// ==========================================
const MAP_PINS_BASE_URL = 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app/map_pins';
const MAP_PINS_ALL_URL = `${MAP_PINS_BASE_URL}.json`;

// 獨立的共享地標圖層群組（不受 clearDomMarkers 影響，於一般、錄製、預覽、重播與導航模式皆保留）
const pinsLayerGroup = {};
window.pinsLayerGroup = pinsLayerGroup;

let mapPinsPollTimer = null;
let isFetchingMapPins = false;
let pendingMapPinLat = null;
let pendingMapPinLng = null;
let currentMapPinPhotoBase64 = '';
let activeViewingMapPin = null;

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
const viewMapPinTitleText = document.getElementById('viewMapPinTitleText');
const viewMapPinAuthorText = document.getElementById('viewMapPinAuthorText');
const viewMapPinTimeText = document.getElementById('viewMapPinTimeText');
const viewMapPinPhotoWrap = document.getElementById('viewMapPinPhotoWrap');
const viewMapPinPhotoImg = document.getElementById('viewMapPinPhotoImg');
const btnGoogleNavMapPin = document.getElementById('btnGoogleNavMapPin');
const btnDistanceGuideMapPin = document.getElementById('btnDistanceGuideMapPin');
const btnDeleteMapPin = document.getElementById('btnDeleteMapPin');
const btnCloseViewMapPin = document.getElementById('btnCloseViewMapPin');
const btnCloseViewMapPinTop = document.getElementById('btnCloseViewMapPinTop');

const pinDistanceGuideBanner = document.getElementById('pinDistanceGuideBanner');
const pinDistanceGuideText = document.getElementById('pinDistanceGuideText');
const btnCancelPinDistanceGuideBanner = document.getElementById('btnCancelPinDistanceGuideBanner');

let activeDistanceGuidePin = null;
let pinDistanceGuideTimer = null;
let pinDistanceLineMarker = null;

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
        pinDistanceLineMarker = new maplibregl.Marker({ element: badgeEl, anchor: 'center' })
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

    if (viewMapPinTitleText) viewMapPinTitleText.textContent = pin.title || '現場注意事項';
    if (viewMapPinAuthorText) viewMapPinAuthorText.textContent = pin.author || '熱心隊員';
    if (viewMapPinTimeText) viewMapPinTimeText.textContent = formatPinCreatedAt(pin.createdAt);

    if (pin.photo) {
        if (viewMapPinPhotoImg) viewMapPinPhotoImg.src = pin.photo;
        if (viewMapPinPhotoWrap) viewMapPinPhotoWrap.classList.remove('hidden');
    } else {
        if (viewMapPinPhotoImg) viewMapPinPhotoImg.src = '';
        if (viewMapPinPhotoWrap) viewMapPinPhotoWrap.classList.add('hidden');
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

if (btnDeleteMapPin) {
    btnDeleteMapPin.onclick = async () => {
        if (!activeViewingMapPin || !activeViewingMapPin.id) return;
        const pinId = activeViewingMapPin.id;
        const pinTitle = activeViewingMapPin.title || '此地標';

        if (!confirm(`確定「${pinTitle}」已清理完畢，要從全車隊地圖同步移除嗎？`)) return;
        if (!navigator.onLine) {
            alert('⚠️ 目前無網路連線，無法同步移除雲端地標！');
            return;
        }

        const origHtml = btnDeleteMapPin.innerHTML;
        btnDeleteMapPin.disabled = true;
        btnDeleteMapPin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在同步銷案...';

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
            alert('❌ 移除地標失敗（網路不穩或連線逾時），請稍後再試！');
        } finally {
            btnDeleteMapPin.disabled = false;
            btnDeleteMapPin.innerHTML = origHtml;
        }
    };
}

function createSharedPinMarkerElement(pin) {
    const wrapper = document.createElement('div');
    wrapper.className = 'shared-pin-wrapper';

    const labelEl = document.createElement('div');
    labelEl.className = 'shared-pin-label';
    labelEl.textContent = pin.title || '現場地標';
    wrapper.appendChild(labelEl);

    const teardrop = document.createElement('div');
    teardrop.className = 'shared-pin-teardrop';

    const inner = document.createElement('div');
    inner.className = 'shared-pin-inner';

    if (pin.photo) {
        const img = document.createElement('img');
        img.src = pin.photo;
        img.alt = pin.title || '地標縮圖';
        inner.appendChild(img);
    } else {
        inner.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-white text-sm"></i>';
    }

    teardrop.appendChild(inner);
    wrapper.appendChild(teardrop);

    wrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pinsLayerGroup[pin.id]?.data) {
            openViewMapPinModal(pinsLayerGroup[pin.id].data);
        } else {
            openViewMapPinModal(pin);
        }
    });

    return wrapper;
}

function upsertPinMarkerOnMap(pinId, pinData) {
    const lat = Number(pinData.lat);
    const lng = Number(pinData.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    const normalizedPin = { ...pinData, id: pinId, lat, lng };
    const signature = `${normalizedPin.title || ''}|${Boolean(normalizedPin.photo)}|${(normalizedPin.photo || '').length}`;

    if (pinsLayerGroup[pinId]) {
        pinsLayerGroup[pinId].marker.setLngLat([lng, lat]);
        pinsLayerGroup[pinId].data = normalizedPin;
        if (pinsLayerGroup[pinId].signature !== signature) {
            try { pinsLayerGroup[pinId].marker.remove(); } catch (e) {}
            const el = createSharedPinMarkerElement(normalizedPin);
            const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
                .setLngLat([lng, lat])
                .addTo(map);
            pinsLayerGroup[pinId] = { marker, el, data: normalizedPin, signature };
        }
    } else {
        const el = createSharedPinMarkerElement(normalizedPin);
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
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

// 綁定長按 1.5 秒（1500ms）防誤觸與桌面右鍵新增地標互動
(function setupMapLongPressForPins() {
    let longPressTimer = null;
    let startClientX = 0;
    let startClientY = 0;
    let pendingLngLat = null;

    function clearLongPressTimer() {
        if (longPressTimer !== null) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    const canvasContainer = map.getCanvasContainer();

    canvasContainer.addEventListener('touchstart', (e) => {
        clearLongPressTimer();
        if (isEditingMode || isManualDrawingMode) return;
        if (!e.touches || e.touches.length !== 1) return;

        const targetEl = e.target;
        if (targetEl && targetEl.closest && targetEl.closest('.shared-pin-wrapper, .music-marker, .fleet-truck-marker, .pin-s, .pin-e')) {
            return;
        }

        const touch = e.touches[0];
        startClientX = touch.clientX;
        startClientY = touch.clientY;

        const rect = canvasContainer.getBoundingClientRect();
        const pointX = touch.clientX - rect.left;
        const pointY = touch.clientY - rect.top;
        pendingLngLat = map.unproject([pointX, pointY]);

        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            if (isEditingMode || isManualDrawingMode || !pendingLngLat) return;
            try { navigator.vibrate?.(50); } catch (err) {}
            openCreateMapPinModal(pendingLngLat.lat, pendingLngLat.lng);
        }, 1500);
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

    ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart', 'wheel'].forEach(evtName => {
        map.on(evtName, clearLongPressTimer);
    });

    // 桌面端支援右鍵 contextmenu 觸發
    map.on('contextmenu', (e) => {
        clearLongPressTimer();
        if (isEditingMode || isManualDrawingMode) return;
        const origTarget = e.originalEvent?.target;
        if (origTarget && origTarget.closest && origTarget.closest('.shared-pin-wrapper, .music-marker, .fleet-truck-marker')) {
            return;
        }
        if (e.originalEvent) e.originalEvent.preventDefault();
        try { navigator.vibrate?.(50); } catch (err) {}
        if (e.lngLat) {
            openCreateMapPinModal(e.lngLat.lat, e.lngLat.lng);
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

// 開啟 App 時立即讀取一次 /map_pins.json 並啟動定期同步
if (map.loaded()) {
    startSharedMapPinsSystem();
} else {
    map.once('load', startSharedMapPinsSystem);
}
startSharedMapPinsSystem();

// ==========================================
// 🚀 【終極防誤關 App】攔截手機實體返回鍵
// ==========================================
(function setupAndroidBackButton() {
    // 1. 監聽實體返回鍵動作
    window.addEventListener('popstate', (e) => {
        const blackOverlay = document.getElementById('blackOverlay');
        const historyModal = document.getElementById('historyModal');
        const cloudRoutesModal = document.getElementById('cloudRoutesModal');
        const routeDetailUI = document.getElementById('routeDetailUI');
        const settingsModal = document.getElementById('settingsModal');
        const editStopModal = document.getElementById('editStopModal');
        const editAlertModal = document.getElementById('editAlertModal');
        const viewAlertModal = document.getElementById('viewAlertModal');
        const photoLightboxModal = document.getElementById('photoLightboxModal');
        const uploadConflictModal = document.getElementById('uploadConflictModal');
        const createMapPinModal = document.getElementById('createMapPinModal');
        const viewMapPinModal = document.getElementById('viewMapPinModal');
        const quickNavAlertModal = document.getElementById('quickNavAlertModal');
        const manualDrawUI = document.getElementById('manualDrawUI');

        // 依序檢查目前是哪個畫面在最上層，就模擬點擊它的「關閉/返回」按鈕
        if (blackOverlay && !blackOverlay.classList.contains('hidden')) {
            exitBlackPowerSaveMode(false);
        }
        else if (photoLightboxModal && !photoLightboxModal.classList.contains('hidden')) {
            document.getElementById('closePhotoLightboxBtn').click();
        }
        else if (quickNavAlertModal && !quickNavAlertModal.classList.contains('hidden')) {
            document.getElementById('btnCancelQuickNavAlert').click();
        }
        else if (uploadConflictModal && !uploadConflictModal.classList.contains('hidden')) {
            document.getElementById('btnConflictCancel').click();
        }
        else if (viewMapPinModal && !viewMapPinModal.classList.contains('hidden')) {
            document.getElementById('btnCloseViewMapPin').click();
        }
        else if (createMapPinModal && !createMapPinModal.classList.contains('hidden')) {
            document.getElementById('btnCancelCreateMapPin').click();
        }
        else if (viewAlertModal && !viewAlertModal.classList.contains('hidden')) {
            document.getElementById('btnCloseViewAlert').click();
        }
        else if (editAlertModal && !editAlertModal.classList.contains('hidden')) {
            document.getElementById('btnCancelAlertEdit').click();
        }
        else if (editStopModal && !editStopModal.classList.contains('hidden')) {
            document.getElementById('btnCancelStopEdit').click();
        }
        else if (cloudRoutesModal && !cloudRoutesModal.classList.contains('hidden')) {
            document.getElementById('closeCloudModalBtn').click();
        }
        else if (settingsModal && !settingsModal.classList.contains('hidden')) {
            document.getElementById('closeSettings').click();
        }
        else if (manualDrawUI && !manualDrawUI.classList.contains('hidden')) {
            document.getElementById('btnManualCancel').click();
        }
        else if (routeDetailUI && !routeDetailUI.classList.contains('hidden')) {
            // 如果在路線詳情頁，就觸發左上角返回鍵
            document.getElementById('topBackBtn').click();
        }
        else if (historyModal && !historyModal.classList.contains('hidden')) {
            // 如果在清單頁，就觸發首頁圖示的關閉鍵
            document.getElementById('closeHistory').click();
        } 
    });

    // 2. 製造假歷史紀錄的函數 (讓手機能有東西可以"返回")
    function pushFakeHistory() {
        window.history.pushState({ pwa: true }, '');
    }

    // 3. 用「外掛監聽」的方式，綁定到現有的按鈕上 (不用動你原本的代碼)
    const hBtn = document.getElementById('historyBtn');
    if(hBtn) hBtn.addEventListener('click', pushFakeHistory);
    
    const sBtn = document.getElementById('settingsBtn');
    if(sBtn) sBtn.addEventListener('click', pushFakeHistory);

    const cBtn = document.getElementById('openCloudModalBtn');
    if(cBtn) cBtn.addEventListener('click', pushFakeHistory);

    const bBtn = document.getElementById('blackScreenBtn');
    if(bBtn) bBtn.addEventListener('click', pushFakeHistory);

    // 4. 攔截開啟路線詳情的函數
    if (typeof window.openRouteDetail === 'function') {
        const originalOpenRouteDetail = window.openRouteDetail;
        window.openRouteDetail = function(idx) {
            pushFakeHistory(); // 先推入歷史紀錄騙過手機
            originalOpenRouteDetail(idx); // 再執行原本的開畫面動作
        };
    }
})();
