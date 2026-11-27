// ==========================================
// [Module 4/10] src/navigation.js
// 模擬重播引擎、Pro Max 實戰導航引擎、OLED 純黑省電模式、導航中快速語音標記與路線匯出/匯入
// ==========================================

// --- 6. 模擬重播引擎 ---
let animFrameId = null, isPlaying = false, playProgress = 0, lastFrameTime = 0;
let replayVoiceEvents = [];
let replayCumMeters = [];
const speedOptions = [1, 2, 4, 6];
let speedMultiplier = 1;

// ==========================================
// 🎮 左側遊戲化垂直路線進度條（Route Progress HUD，僅一般清運遵循導航／路線重播顯示）
// ==========================================
let routeProgressHudEls = null;
let routeProgressHudTickEls = [];

function getOrCreateRouteProgressHud() {
    if (routeProgressHudEls && routeProgressHudEls.root?.isConnected) {
        return routeProgressHudEls;
    }
    const root = document.createElement('div');
    root.id = 'routeProgressHud';
    root.className = 'route-progress-hud hidden';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
        <div class="route-progress-hud-top">
            <span class="route-progress-hud-flag">🏁</span>
            <span class="route-progress-hud-pct">0%</span>
        </div>
        <div class="route-progress-hud-track-wrap">
            <div class="route-progress-hud-track">
                <div class="route-progress-hud-fill"></div>
            </div>
            <div class="route-progress-hud-ticks"></div>
            <div class="route-progress-hud-cursor">🚛</div>
        </div>
        <div class="route-progress-hud-start">S</div>
    `;
    document.body.appendChild(root);
    routeProgressHudEls = {
        root,
        pctEl: root.querySelector('.route-progress-hud-pct'),
        fillEl: root.querySelector('.route-progress-hud-fill'),
        ticksEl: root.querySelector('.route-progress-hud-ticks'),
        cursorEl: root.querySelector('.route-progress-hud-cursor')
    };
    return routeProgressHudEls;
}

function showRouteProgressHud(route) {
    if (!route || !Array.isArray(route.points) || route.points.length < 2) return;
    const hud = getOrCreateRouteProgressHud();
    const totalPts = route.points.length;
    const denom = Math.max(1, totalPts - 1);

    // 萃取時刻站牌與注意／音樂提醒的關卡刻度點（依路線點索引比例定位）
    const milestones = [];
    route.points.forEach((p, idx) => {
        if (p && p.is_stop) {
            milestones.push({ ratio: Math.min(1, Math.max(0, idx / denom)), kind: 'stop' });
        }
    });
    (route.events || []).forEach(ev => {
        if (!ev || (ev.type !== 'alert' && ev.type !== 'on' && ev.type !== 'off')) return;
        let ptIdx = -1;
        if (typeof ev.pointIndex === 'number' && ev.pointIndex >= 0 && ev.pointIndex < totalPts) {
            ptIdx = ev.pointIndex;
        } else if (typeof ev.ptIdx === 'number' && ev.ptIdx >= 0 && ev.ptIdx < totalPts) {
            ptIdx = ev.ptIdx;
        } else {
            let bestD = Infinity;
            for (let i = 0; i < totalPts; i++) {
                const d = getDistanceKm(ev.lng, ev.lat, route.points[i].lng, route.points[i].lat);
                if (d < bestD) { bestD = d; ptIdx = i; }
            }
        }
        if (ptIdx >= 0) {
            milestones.push({
                ratio: Math.min(1, Math.max(0, ptIdx / denom)),
                kind: ev.type === 'alert' ? 'alert' : 'music'
            });
        }
    });
    milestones.sort((a, b) => a.ratio - b.ratio);

    hud.ticksEl.innerHTML = '';
    routeProgressHudTickEls = [];
    let lastRatio = -1;
    for (let i = 0; i < milestones.length; i++) {
        const ms = milestones[i];
        if (ms.ratio <= 0.02 || ms.ratio >= 0.98) continue;
        // 若刻度間距過近（< 1.8%），優先保留站牌或警示點，避免視覺堆疊雜亂
        if (lastRatio >= 0 && (ms.ratio - lastRatio) < 0.018 && ms.kind === 'music') continue;
        lastRatio = ms.ratio;
        const tick = document.createElement('div');
        tick.className = `route-progress-hud-tick${ms.kind === 'stop' ? ' is-stop' : (ms.kind === 'alert' ? ' is-alert' : '')}`;
        tick.style.bottom = `${(ms.ratio * 100).toFixed(2)}%`;
        tick.dataset.ratio = String(ms.ratio);
        hud.ticksEl.appendChild(tick);
        routeProgressHudTickEls.push({ el: tick, ratio: ms.ratio });
    }

    hud.root.classList.remove('hidden');
    updateRouteProgressHud(0, totalPts);
}

function updateRouteProgressHud(currentIdx, totalPoints) {
    if (!routeProgressHudEls || !routeProgressHudEls.root || routeProgressHudEls.root.classList.contains('hidden')) return;
    const denom = Math.max(1, (totalPoints || 2) - 1);
    const ratio = Math.min(1, Math.max(0, (Number(currentIdx) || 0) / denom));
    const pctStr = `${(ratio * 100).toFixed(2)}%`;
    routeProgressHudEls.fillEl.style.height = pctStr;
    routeProgressHudEls.cursorEl.style.bottom = pctStr;
    routeProgressHudEls.pctEl.textContent = `${Math.round(ratio * 100)}%`;

    for (let i = 0; i < routeProgressHudTickEls.length; i++) {
        const item = routeProgressHudTickEls[i];
        const passed = ratio >= item.ratio;
        if (item.el.classList.contains('is-passed') !== passed) {
            item.el.classList.toggle('is-passed', passed);
        }
    }
}

function hideRouteProgressHud() {
    if (!routeProgressHudEls || !routeProgressHudEls.root) return;
    routeProgressHudEls.root.classList.add('hidden');
    if (routeProgressHudEls.ticksEl) routeProgressHudEls.ticksEl.innerHTML = '';
    routeProgressHudTickEls = [];
}

function getActivePlaybackOrFollowRoute() {
    if (window.isFurnitureNavOrReplayActive && window.activeFurnitureSyntheticRoute) {
        return window.activeFurnitureSyntheticRoute;
    }
    return savedRoutes[selectedRouteIdx];
}

const playbackSlider = document.getElementById('playbackSlider');
const playPauseBtn = document.getElementById('playPauseBtn');
const speedToggleBtn = document.getElementById('speedToggleBtn');

document.getElementById('startReplayBtn').onclick = () => {
    const route = getActivePlaybackOrFollowRoute();
    if (!route || !route.points || route.points.length < 2) return;

    stopSmoothPlayback();

    // 🛡️ 進入「重播複習」模式：開啟 isReplaying 鎖定車輛控制權，徹底隔離真實 GPS 定位回呼與補間動畫
    isReplaying = true;
    window.isReplaying = true;
    if (vehicleAnimFrameId !== null) {
        cancelAnimationFrame(vehicleAnimFrameId);
        vehicleAnimFrameId = null;
    }

    document.getElementById('routeDetailUI').classList.add('hidden');
    if (window.isFurnitureNavOrReplayActive) {
        document.getElementById('furnitureModeUI')?.classList.add('hidden');
        document.getElementById('furnitureLeftConnectControls')?.classList.add('hidden');
        document.getElementById('topBackBtn')?.classList.add('hidden');
    }
    document.getElementById('playbackUI').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = window.isFurnitureNavOrReplayActive ? '🛋️ 家具路線播放' : '路線重播複習';
    document.getElementById('playbackTitle').innerText = route.name;
    speedToggleBtn.innerText = `${speedMultiplier}x`;

    // 初始化累積里程與語音標記事件，重置所有 played / prePlayed 狀態
    replayCumMeters = buildCumulativeRouteMeters(route.points);
    replayVoiceEvents = prepareVoiceMarkerEvents(route, !window.isFurnitureNavOrReplayActive);
    if (typeof resetPassedRouteReminders === 'function') resetPassedRouteReminders();

    // 初始狀態（currentTrackIndex = 0）：已行駛路段為空，未行駛路段完整高亮顯示
    updateProgressRouteLayers(route.points, 0, null, 0);
    if (window.isFurnitureNavOrReplayActive) {
        hideRouteProgressHud();
        if (typeof renderAllFurnitureMapElements === 'function') renderAllFurnitureMapElements();
    } else {
        renderRouteMarkers(route);
        showRouteProgressHud(route);
    }

    playProgress = 0; playbackSlider.max = (route.points.length - 1) * 100; playbackSlider.value = 0;
    setCameraFollow(true);

    const startPt = route.points[0];
    lastKnownLngLat = [startPt.lng, startPt.lat];
    currentHeading = getRouteSegmentBearing(route.points, 0);
    vehicleVisualLngLat = [...lastKnownLngLat];
    vehicleVisualHeading = currentHeading;
    if (vehicleMarker) {
        vehicleMarker.setLngLat(lastKnownLngLat);
    }
    const targetBearing = isHeadingUpMode ? currentHeading : 0;
    map.jumpTo({
        center: lastKnownLngLat,
        zoom: 17.5,
        bearing: targetBearing,
        offset: [0, 100]
    });
    window.syncCarHeading?.(currentHeading, map.getBearing());

    startSmoothPlayback();
};

function renderInterpolatedStep(floatIdx, forceLayerUpdate = false) {
    const route = getActivePlaybackOrFollowRoute();
    if (!route || !route.points || route.points.length < 2) return;
    const pts = route.points;
    const maxIdx = pts.length - 1;
    const clamped = Math.min(Math.max(floatIdx, 0), maxIdx);
    const currentTrackIndex = Math.min(Math.floor(clamped), maxIdx);
    const frac = clamped - currentTrackIndex;

    const p1 = pts[currentTrackIndex], p2 = pts[Math.min(currentTrackIndex + 1, maxIdx)];
    if (!p1 || !p2) return;
    const curLng = p1.lng + (p2.lng - p1.lng) * frac;
    const curLat = p1.lat + (p2.lat - p1.lat) * frac;
    lastKnownLngLat = [curLng, curLat];

    // 同步計算目前點位到下一個有效點位的方位角（Bearing），即時更新黃色垃圾車的車頭旋轉角度
    const segDistM = getDistanceKm(p1.lng, p1.lat, p2.lng, p2.lat) * 1000;
    if (currentTrackIndex < maxIdx && segDistM >= 0.05) {
        currentHeading = getBearing(p1.lng, p1.lat, p2.lng, p2.lat);
    } else {
        currentHeading = getRouteSegmentBearing(pts, currentTrackIndex);
    }

    // 確保任何殘留的真實 GPS 補間動畫不會干擾重播車輛
    if (vehicleAnimFrameId !== null) {
        cancelAnimationFrame(vehicleAnimFrameId);
        vehicleAnimFrameId = null;
    }
    vehicleVisualLngLat = [curLng, curLat];
    vehicleVisualHeading = currentHeading;
    if (vehicleMarker) {
        vehicleMarker.setLngLat([curLng, curLat]);
    }

    // 👾 動態軌跡變色（小精靈吃路線）：0 ~ currentTrackIndex 為半透明淺灰，currentTrackIndex ~ 終點維持原色高亮
    updateProgressRouteLayers(
        pts,
        currentTrackIndex,
        { lng: curLng, lat: curLat, musicActive: p2.musicActive },
        forceLayerUpdate ? 0 : 40
    );
    if (!window.isFurnitureNavOrReplayActive) {
        updateRouteProgressHud(clamped, pts.length);
    }

    const badge = document.getElementById('replayMusicBadge');
    if (window.isFurnitureNavOrReplayActive) {
        badge.className = "bg-violet-600 text-white text-xs font-extrabold px-4 py-1.5 rounded-full shadow-lg pointer-events-auto";
        badge.innerText = `🛋️ 家具清運路線播放中（共 ${(furnitureActiveData?.pins?.length || 0)} 站）`;
    } else if (p2.musicActive) {
        badge.className = "bg-green-600 text-white text-xs font-extrabold px-4 py-1.5 rounded-full shadow-lg pointer-events-auto";
        badge.innerText = "🎵 目前路段：播放回收音樂中";
    } else {
        badge.className = "bg-gray-800/90 text-white text-xs font-extrabold px-4 py-1.5 rounded-full shadow-lg pointer-events-auto";
        badge.innerText = "🔇 目前路段：音樂已關閉 (中斷移動)";
    }

    // 🔊 綁定路線進度的雙層語音預警（100m 預告 + 45m 確認 + 方向 ±30° + played 鎖定）
    evaluateVoiceMarkersWithProgress({
        events: replayVoiceEvents,
        pts,
        cumMeters: replayCumMeters,
        currentTrackIndex,
        lng: curLng,
        lat: curLat,
        vehicleBearing: currentHeading,
        onTriggerWake: false
    });
    if (typeof updatePassedRouteReminders === 'function') {
        updatePassedRouteReminders({
            events: replayVoiceEvents,
            pts,
            cumMeters: replayCumMeters,
            currentTrackIndex,
            lng: curLng,
            lat: curLat
        });
    }

    if (isFollowingCamera) {
        map.jumpTo({
            center: [curLng, curLat],
            bearing: isHeadingUpMode ? currentHeading : 0,
            offset: [0, 100]
        });
    }
    window.syncCarHeading?.(currentHeading, map.getBearing());
}

function playbackLoop(timestamp) {
    if (!isPlaying) return;
    const route = getActivePlaybackOrFollowRoute();
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
    isReplaying = true;
    window.isReplaying = true;
    const route = getActivePlaybackOrFollowRoute();
    if (route && playProgress >= route.points.length - 1) {
        playProgress = 0;
        replayVoiceEvents.forEach(ev => {
            ev.played = false;
            ev.prePlayed = false;
            if (ev.sourceEvent) {
                ev.sourceEvent.played = false;
                ev.sourceEvent.prePlayed = false;
            }
        });
        if (typeof resetPassedRouteReminders === 'function') resetPassedRouteReminders();
        if (!window.isFurnitureNavOrReplayActive) updateRouteProgressHud(0, route.points.length);
    }
    isPlaying = true; lastFrameTime = 0;
    if (typeof window.setMyVehicleMovingState === 'function') window.setMyVehicleMovingState(true);
    playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    animFrameId = requestAnimationFrame(playbackLoop);
}

function stopSmoothPlayback() {
    isPlaying = false;
    if (typeof window.setMyVehicleMovingState === 'function') window.setMyVehicleMovingState(false);
    if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
    playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
}

playPauseBtn.onclick = () => isPlaying ? stopSmoothPlayback() : startSmoothPlayback();
playbackSlider.oninput = (e) => {
    isReplaying = true;
    window.isReplaying = true;
    playProgress = parseInt(e.target.value, 10) / 100;
    const scrubTrackIdx = Math.floor(playProgress);
    const curCumM = replayCumMeters[scrubTrackIdx] || 0;
    const confirmDist = Number(systemNavConfig.confirmDistMeters) || DEFAULT_SYSTEM_CONFIG.confirmDistMeters;
    const lookAheadDist = Number(systemNavConfig.lookAheadDistMeters) || DEFAULT_SYSTEM_CONFIG.lookAheadDistMeters;
    replayVoiceEvents.forEach(ev => {
        const evCumM = replayCumMeters[ev.ptIdx] || 0;
        const aheadM = evCumM - curCumM;
        if (aheadM > confirmDist + 5) {
            ev.played = false;
            if (ev.sourceEvent) ev.sourceEvent.played = false;
        }
        if (aheadM > lookAheadDist + 15) {
            ev.prePlayed = false;
            if (ev.sourceEvent) ev.sourceEvent.prePlayed = false;
        }
    });
    if (typeof resetPassedRouteReminders === 'function') resetPassedRouteReminders();
    renderInterpolatedStep(playProgress, true);
};
speedToggleBtn.onclick = () => {
    const nextIdx = (speedOptions.indexOf(speedMultiplier) + 1) % speedOptions.length;
    speedMultiplier = speedOptions[nextIdx];
    speedToggleBtn.innerText = `${speedMultiplier}x`;
    if (isReplaying) {
        renderInterpolatedStep(playProgress, false);
    }
};
document.getElementById('stopPlaybackBtn').onclick = () => { 
    stopSmoothPlayback();
    VoiceQueue.clear();
    hideRouteProgressHud();
    if (typeof resetPassedRouteReminders === 'function') resetPassedRouteReminders();
    document.getElementById('playbackUI').classList.add('hidden'); 
    document.getElementById('musicAlertBanner').classList.add('hidden');

    if (window.isFurnitureNavOrReplayActive && typeof restoreFurnitureModeAfterNavOrReplay === 'function') {
        restoreFurnitureModeAfterNavOrReplay();
        restoreRealGpsAfterReplay(true);
        return;
    }

    document.getElementById('topBackBtn').classList.remove('hidden');
    // 🚀 結束重播後自動歸位：先渲染路線預覽面板（不覆蓋鏡頭），再立即將 isReplaying 設回 false 並將黃色垃圾車與地圖鏡頭對齊最新真實 GPS 位置
    window.openRouteDetail(selectedRouteIdx, true); 
    restoreRealGpsAfterReplay(true);
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
        vehicleMarker.setLngLat(lastKnownLngLat);
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
    window.syncCarHeading?.(currentHeading, map.getBearing());
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
    document.body?.classList.add('power-saving');
    window.syncCarMovingState?.(false);
    window.syncFestivalThemeSnowState?.();
    window.BgmPlayer?.syncPlaybackState();
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
    document.body?.classList.remove('power-saving');
    window.syncCarMovingState?.(Boolean(isPlaying || (typeof lastRecordedSpeedKmh === 'number' && lastRecordedSpeedKmh > 1.8)));
    window.syncFestivalThemeSnowState?.();
    window.BgmPlayer?.syncPlaybackState();
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
    if (text === undefined) {
        text = iconHtml;
        iconHtml = '⚠️';
        bgColorClass = 'bg-amber-600';
    }
    if (navAlertHideTimer) clearTimeout(navAlertHideTimer);
    if (text === '') {
        // 🚀 無文字模式 (轉彎專用)：水平置中圓角正方形大圖示
        banner.className = `fixed top-20 left-1/2 -translate-x-1/2 z-[60] rounded-3xl shadow-2xl text-white font-black nav-alert-pop border-4 border-white pointer-events-auto flex items-center justify-center w-28 h-28 ${bgColorClass}`;
        banner.innerHTML = `<span class="text-[72px] drop-shadow-lg leading-none">${iconHtml}</span>`;
    } else if (bgColorClass && bgColorClass.includes('amber')) {
        // ⚠️ 導航／重播模式下的黃色注意路段：頂部精簡橫幅（水平置中、寬度自適應、不擋兩側按鈕與車頭路線）
        banner.className = `fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-[60] w-fit max-w-[calc(100vw-140px)] rounded-2xl shadow-2xl text-white font-black nav-alert-pop border-2 border-white pointer-events-auto flex items-center justify-between px-4 py-2 max-h-[84px] overflow-hidden gap-2.5 ${bgColorClass}`;
        const thumbHtml = photoUrl
            ? `<button type="button" onclick="openPhotoLightbox(this.querySelector('img').src)" class="relative w-[52px] h-[52px] flex-shrink-0 rounded-xl overflow-hidden border-2 border-white shadow-md active:scale-95 focus:outline-none" title="點擊放大檢視照片">
                   <img src="${photoUrl}" alt="提醒縮圖" class="w-full h-full object-cover">
                   <span class="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[9px] leading-none px-1 py-0.5 rounded pointer-events-none">🔍</span>
               </button>`
            : '';
        banner.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="text-xl flex-shrink-0 drop-shadow">${iconHtml}</span>
                <span class="text-sm sm:text-base font-black leading-tight text-left break-words" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${text}</span>
            </div>
            ${thumbHtml}
        `;
    } else {
        // 🎵 開關音樂、抵達起點等橫幅：水平置中、寬度自適應內容、預留左右 140px 空間不遮擋右上角按鈕
        banner.className = `fixed top-20 left-1/2 -translate-x-1/2 z-[60] w-fit max-w-[calc(100vw-140px)] rounded-2xl shadow-2xl text-white font-black text-center nav-alert-pop border-2 border-white pointer-events-auto flex items-center justify-center px-4 py-2 gap-1.5 text-base sm:text-lg whitespace-nowrap ${bgColorClass}`;
        const displayStr = (iconHtml && !String(text).startsWith(iconHtml)) ? `${iconHtml} ${text}` : String(text);
        banner.innerHTML = `<span class="drop-shadow-sm truncate">${displayStr}</span>`;
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

// ==========================================
// 🔊 遵循導航前方轉彎預先偵測與轉入路名解析（提前約 20 公尺播報「前方20公尺左轉／右轉＋路名」）
// ==========================================
const turnRoadNameCache = new Map();

function sanitizeDetectedRoadName(rawName) {
    if (!rawName || typeof rawName !== 'string') return '';
    let s = rawName.trim();
    if (!s || s === 'undefined' || s === 'null') return '';
    // 剔除純郵遞區號、門牌號碼或無意義泛稱
    s = s.replace(/^\d{3,6}\s*/, '').trim();
    if (/^(unnamed|road|street|path|track|service|無名路|未命名|前方道路)$/i.test(s)) return '';
    // 若包含逗號或斜線（如 Nominatim 地址串），取最前面的道路名
    if (s.includes(',')) s = s.split(',')[0].trim();
    if (s.includes('；')) s = s.split('；')[0].trim();
    return s;
}

// 1. 同步嘗試由向量底圖（若當前為向量圖層）或路線本身的點位屬性擷取轉入路段路名
function lookupRoadNameFromMapOrPoint(pts, afterTurnIdx, targetBearing) {
    for (let k = afterTurnIdx; k <= Math.min(pts.length - 1, afterTurnIdx + 3); k++) {
        const ptName = sanitizeDetectedRoadName(pts[k]?.roadName || pts[k]?.streetName || pts[k]?.street);
        if (ptName) return ptName;
    }
    try {
        if (typeof map !== 'undefined' && map && typeof map.queryRenderedFeatures === 'function' && typeof map.project === 'function') {
            const samplePt = pts[Math.min(pts.length - 1, afterTurnIdx)];
            if (samplePt) {
                const scr = map.project([samplePt.lng, samplePt.lat]);
                if (scr && typeof scr.x === 'number' && typeof scr.y === 'number') {
                    const bbox = [
                        [scr.x - 26, scr.y - 26],
                        [scr.x + 26, scr.y + 26]
                    ];
                    const features = map.queryRenderedFeatures(bbox) || [];
                    for (const f of features) {
                        const props = f?.properties;
                        if (!props) continue;
                        const layerId = String(f?.layer?.id || '').toLowerCase();
                        const srcLayer = String(f?.sourceLayer || '').toLowerCase();
                        if (
                            layerId.includes('road') || layerId.includes('street') || layerId.includes('transportation') ||
                            layerId.includes('highway') || srcLayer.includes('transportation') || srcLayer.includes('road')
                        ) {
                            const raw = props['name:zh-Hant'] || props['name:zh'] || props.name || props.ref || '';
                            const clean = sanitizeDetectedRoadName(String(raw));
                            if (clean) return clean;
                        }
                    }
                }
            }
        }
    } catch (e) {}
    return '';
}

// 2. 非同步向 OSRM nearest（附帶轉彎後行進方向 bearing 鎖定轉入道路）或 Nominatim 查詢轉入路段路名並寫入快取
async function fetchTurnTargetRoadNameAsync(lng, lat, outBearing) {
    const cacheKey = `${lng.toFixed(5)},${lat.toFixed(5)},${Math.round((outBearing || 0) / 15)}`;
    if (turnRoadNameCache.has(cacheKey)) {
        return turnRoadNameCache.get(cacheKey) || '';
    }

    // 優先使用 OSRM nearest API + bearings 鎖定轉彎後進入的目標道路名稱（極快且精準對應轉入方向）
    try {
        const bDeg = Math.round(((outBearing % 360) + 360) % 360);
        const osrmUrl = `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1&bearings=${bDeg},45`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1400);
        const res = await fetch(osrmUrl, { signal: ctrl.signal });
        clearTimeout(timer);
        if (res && res.ok) {
            const data = await res.json();
            const wpName = sanitizeDetectedRoadName(data?.waypoints?.[0]?.name || '');
            if (wpName) {
                turnRoadNameCache.set(cacheKey, wpName);
                return wpName;
            }
        }
    } catch (e) {}

    // 備援：使用 Nominatim reverse geocoding 查詢該轉入座標的 road / pedestrian / residential 名稱
    try {
        const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=zh-TW`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        const res = await fetch(nomUrl, { signal: ctrl.signal });
        clearTimeout(timer);
        if (res && res.ok) {
            const data = await res.json();
            const addr = data?.address || {};
            const rd = sanitizeDetectedRoadName(
                addr.road || addr.pedestrian || addr.residential || addr.living_street || addr.cycleway || data?.name || ''
            );
            if (rd) {
                turnRoadNameCache.set(cacheKey, rd);
                return rd;
            }
        }
    } catch (e) {}

    turnRoadNameCache.set(cacheKey, '');
    return '';
}

// 3. 預先掃描整條遵循路線，精準找出所有真實左右轉彎頂點（turnIdx）、轉入後延伸點（afterIdx）與轉入方向角（outBearing）
function precomputeFollowRouteTurns(pts, cumMeters) {
    if (!Array.isArray(pts) || pts.length < 3 || !Array.isArray(cumMeters) || cumMeters.length !== pts.length) {
        return [];
    }
    const n = pts.length;
    const turns = [];
    let lastTurnDistM = -999;

    for (let i = 1; i < n - 1; i++) {
        if (pts[i]?.isSegmentStart) continue;
        const cornerDistM = cumMeters[i] || 0;
        // 同一路口轉彎叢集冷卻至少 28 公尺，避免單一彎道拆成多個點
        if (cornerDistM - lastTurnDistM < 28) continue;

        // 往前找距離頂點 i 約 8~18 公尺的進入起點 inIdx
        let inIdx = i - 1;
        while (inIdx > 0 && !pts[inIdx + 1]?.isSegmentStart && (cornerDistM - (cumMeters[inIdx] || 0)) < 12) {
            inIdx--;
        }
        const inSpanM = cornerDistM - (cumMeters[inIdx] || 0);
        if (inSpanM < 4) continue;

        // 往後找距離頂點 i 約 10~20 公尺的轉出終點 outIdx（此處亦是查詢「轉入後道路名稱」的最佳採樣點）
        let outIdx = i + 1;
        while (outIdx < n - 1 && !pts[outIdx]?.isSegmentStart && ((cumMeters[outIdx] || 0) - cornerDistM) < 15) {
            outIdx++;
        }
        if (pts[outIdx]?.isSegmentStart) continue;
        const outSpanM = (cumMeters[outIdx] || 0) - cornerDistM;
        if (outSpanM < 4) continue;

        const inBearing = getBearing(pts[inIdx].lng, pts[inIdx].lat, pts[i].lng, pts[i].lat);
        const outBearing = getBearing(pts[i].lng, pts[i].lat, pts[outIdx].lng, pts[outIdx].lat);
        const angleDiff = getAngleDiff(inBearing, outBearing);
        const absAngle = Math.abs(angleDiff);

        // 轉角介於 40° ~ 155° 判定為有效左右轉
        if (absAngle > 40 && absAngle < 155) {
            // 往後微調 1~3 點找出彎道中轉折最尖銳的局部峰值頂點
            let bestCornerIdx = i;
            let bestAbsAngle = absAngle;
            let bestAngleDiff = angleDiff;
            let bestOutIdx = outIdx;
            let bestOutBearing = outBearing;

            for (let c = i + 1; c <= Math.min(n - 2, i + 4); c++) {
                if (pts[c]?.isSegmentStart) break;
                const cDist = cumMeters[c] || 0;
                if (cDist - cornerDistM > 12) break;
                let cIn = c - 1;
                while (cIn > 0 && !pts[cIn + 1]?.isSegmentStart && (cDist - (cumMeters[cIn] || 0)) < 12) cIn--;
                let cOut = c + 1;
                while (cOut < n - 1 && !pts[cOut]?.isSegmentStart && ((cumMeters[cOut] || 0) - cDist) < 15) cOut++;
                const bIn = getBearing(pts[cIn].lng, pts[cIn].lat, pts[c].lng, pts[c].lat);
                const bOut = getBearing(pts[c].lng, pts[c].lat, pts[cOut].lng, pts[cOut].lat);
                const diff = getAngleDiff(bIn, bOut);
                if (Math.abs(diff) > bestAbsAngle && Math.abs(diff) < 160 && Math.sign(diff) === Math.sign(angleDiff)) {
                    bestAbsAngle = Math.abs(diff);
                    bestAngleDiff = diff;
                    bestCornerIdx = c;
                    bestOutIdx = cOut;
                    bestOutBearing = bOut;
                }
            }

            const dir = bestAngleDiff > 0 ? 'right' : 'left';
            const turnDistM = cumMeters[bestCornerIdx] || 0;
            lastTurnDistM = turnDistM;
            i = bestCornerIdx;

            const samplePt = pts[bestOutIdx] || pts[bestCornerIdx];
            const initialRoadName = lookupRoadNameFromMapOrPoint(pts, bestOutIdx, bestOutBearing);

            turns.push({
                turnIdx: bestCornerIdx,
                afterIdx: bestOutIdx,
                turnDistM,
                dir,
                actionZh: dir === 'right' ? '右轉' : '左轉',
                iconHtml: dir === 'right'
                    ? '<i class="fa-solid fa-arrow-right"></i>'
                    : '<i class="fa-solid fa-arrow-left"></i>',
                outBearing: bestOutBearing,
                sampleLng: samplePt.lng,
                sampleLat: samplePt.lat,
                roadName: initialRoadName,
                prefetching: false,
                announced: false
            });
        }
    }

    return turns;
}

// ==========================================
// 🧭 一般清運遵循導航：軌跡進度吸附（Map Matching）、防偏離滯後、未行駛方向箭頭引導
// ==========================================
const FOLLOW_SUBDIVIDE_MAX_SEG_METERS = 15;
const FOLLOW_SNAP_RADIUS_METERS = 45;
const FOLLOW_VISIT_RADIUS_METERS = 35;
const FOLLOW_MAX_HEADING_DIFF_DEG = 75;
const FOLLOW_SKIP_WARN_MIN_METERS = 50;
const FOLLOW_OFF_ROUTE_BASE_METERS = 52;
const FOLLOW_OFF_ROUTE_MAX_METERS = 65;
const FOLLOW_OFF_ROUTE_MIN_SPEED_KMH = 3;
const FOLLOW_OFF_ROUTE_STREAK_LIMIT = 3;
const FOLLOW_OFF_ROUTE_DURATION_MS = 4500;
const FOLLOW_DIR_ARROW_SOURCE_ID = 'follow-untraveled-arrows-src';
const FOLLOW_DIR_ARROW_LAYER_ID = 'follow-untraveled-arrows-layer';
const FOLLOW_DIR_ARROW_ICON_ID = 'follow-untraveled-arrow-icon';
const FOLLOW_SKIPPED_SOURCE_ID = 'follow-skipped-segments-src';
const FOLLOW_SKIPPED_CASING_LAYER_ID = 'follow-skipped-segments-casing';
const FOLLOW_SKIPPED_LINE_LAYER_ID = 'follow-skipped-segments-line';
let lastFollowArrowRenderTime = 0;
let lastFollowSkippedRenderTime = 0;

function buildFollowMatchTrack(pts) {
    const segments = [];
    if (!Array.isArray(pts) || pts.length < 2) return segments;
    let cumM = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        if (!p1 || !p2 || p2.isSegmentStart) continue;
        const segLenM = getDistanceKm(p1.lng, p1.lat, p2.lng, p2.lat) * 1000;
        if (segLenM < 0.2) continue;
        const steps = segLenM > FOLLOW_SUBDIVIDE_MAX_SEG_METERS
            ? Math.ceil(segLenM / FOLLOW_SUBDIVIDE_MAX_SEG_METERS)
            : 1;
        const bearing = getBearing(p1.lng, p1.lat, p2.lng, p2.lat);
        const musicActive = Boolean(p2.musicActive);
        const stepLenM = segLenM / steps;
        for (let s = 0; s < steps; s++) {
            const t0 = s / steps;
            const t1 = (s + 1) / steps;
            segments.push({
                aLng: p1.lng + (p2.lng - p1.lng) * t0,
                aLat: p1.lat + (p2.lat - p1.lat) * t0,
                bLng: p1.lng + (p2.lng - p1.lng) * t1,
                bLat: p1.lat + (p2.lat - p1.lat) * t1,
                origIdx: i,
                cumM,
                lenM: stepLenM,
                bearing,
                musicActive
            });
            cumM += stepLenM;
        }
    }
    return segments;
}

function projectPointOntoSegment(lng, lat, seg) {
    const cosLat = Math.cos(lat * Math.PI / 180);
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * cosLat;
    const ax = (seg.aLng - lng) * mPerDegLng;
    const ay = (seg.aLat - lat) * mPerDegLat;
    const bx = (seg.bLng - lng) * mPerDegLng;
    const by = (seg.bLat - lat) * mPerDegLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 1e-6 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lenSq)) : 0;
    const px = ax + dx * t;
    const py = ay + dy * t;
    return {
        t,
        distMeters: Math.hypot(px, py),
        projLng: seg.aLng + (seg.bLng - seg.aLng) * t,
        projLat: seg.aLat + (seg.bLat - seg.aLat) * t
    };
}

function matchGpsToFollowTrackWindow(matchSegments, currentMatchIdx, lng, lat, gpsHeading, isMoving, maxForwardM = 85) {
    if (!Array.isArray(matchSegments) || matchSegments.length === 0) return null;
    const maxSegIdx = matchSegments.length - 1;
    const anchorIdx = Math.min(Math.max(currentMatchIdx || 0, 0), maxSegIdx);
    const anchorCumM = matchSegments[anchorIdx].cumM;
    const clampedForwardM = Math.min(Math.max(maxForwardM || 85, 35), 95);

    // 限制局部搜尋窗口：禁止大幅跨段跳躍（後退 <= 20m、單次向前 <= 35~95m），防止迴轉壓線或重疊去回程跳線
    let startIdx = anchorIdx;
    while (startIdx > 0 && (anchorCumM - matchSegments[startIdx - 1].cumM) <= 20 && (anchorIdx - startIdx) < 3) {
        startIdx--;
    }
    let endIdx = anchorIdx;
    while (endIdx < maxSegIdx && ((matchSegments[endIdx + 1].cumM - anchorCumM) <= clampedForwardM || (endIdx - anchorIdx) < 4)) {
        endIdx++;
        if (endIdx - anchorIdx >= 20) break;
    }

    let bestScore = Infinity;
    let bestResult = null;
    const hasHeading = isMoving && typeof gpsHeading === 'number' && !isNaN(gpsHeading);

    for (let i = startIdx; i <= endIdx; i++) {
        const seg = matchSegments[i];
        const proj = projectPointOntoSegment(lng, lat, seg);
        let score = proj.distMeters;
        let angleDiff = 0;

        if (hasHeading && seg.lenM >= 1.2) {
            angleDiff = Math.abs(getAngleDiff(gpsHeading, seg.bearing));
            if (angleDiff > 110) {
                score += 60;
            } else if (angleDiff > FOLLOW_MAX_HEADING_DIFF_DEG) {
                score += 28;
            }
        }
        if (i < anchorIdx) {
            score += 6;
        }

        if (score < bestScore) {
            bestScore = score;
            bestResult = {
                matchIdx: i,
                origIdx: seg.origIdx,
                projLng: proj.projLng,
                projLat: proj.projLat,
                distMeters: proj.distMeters,
                bearing: seg.bearing,
                musicActive: seg.musicActive,
                angleDiff,
                hasHeading,
                headingAligned: (!hasHeading || angleDiff <= FOLLOW_MAX_HEADING_DIFF_DEG),
                t: proj.t
            };
        }
    }
    return bestResult;
}

// 導航「啟動當下」專用一次性全域對齊（支援中途開導航不強迫回起點，且優先順向匹配）
function findInitialBestMatchSegment(matchSegments, lng, lat, gpsHeading, isMoving, preferStartRange = false) {
    if (!Array.isArray(matchSegments) || matchSegments.length === 0) return null;
    const hasHeading = isMoving && typeof gpsHeading === 'number' && !isNaN(gpsHeading);
    let bestScore = Infinity;
    let bestResult = null;
    const startCumM = matchSegments[0].cumM;

    for (let i = 0; i < matchSegments.length; i++) {
        const seg = matchSegments[i];
        if (preferStartRange && (seg.cumM - startCumM) > 120 && i > 15) break;
        const proj = projectPointOntoSegment(lng, lat, seg);
        let score = proj.distMeters;
        let angleDiff = 0;
        if (hasHeading && seg.lenM >= 1.2) {
            angleDiff = Math.abs(getAngleDiff(gpsHeading, seg.bearing));
            if (angleDiff > 110) score += 50;
            else if (angleDiff > FOLLOW_MAX_HEADING_DIFF_DEG) score += 20;
        }
        if (score < bestScore) {
            bestScore = score;
            bestResult = {
                matchIdx: i,
                origIdx: seg.origIdx,
                projLng: proj.projLng,
                projLat: proj.projLat,
                distMeters: proj.distMeters,
                bearing: seg.bearing,
                musicActive: seg.musicActive,
                angleDiff,
                hasHeading,
                headingAligned: (!hasHeading || angleDiff <= FOLLOW_MAX_HEADING_DIFF_DEG),
                t: proj.t
            };
        }
    }
    return bestResult;
}

// 偏離繞路後重新接回前方路線專用（僅嚴格向前搜尋、需距離 <= 35m 且方向順向 <= 65°）
function findDetourReattachMatchSegment(matchSegments, currentMatchIdx, lng, lat, gpsHeading, isMoving) {
    if (!Array.isArray(matchSegments) || matchSegments.length === 0) return null;
    const startIdx = Math.min(Math.max((currentMatchIdx || 0) + 1, 0), matchSegments.length - 1);
    const hasHeading = isMoving && typeof gpsHeading === 'number' && !isNaN(gpsHeading);
    let bestDist = Infinity;
    let bestResult = null;

    for (let i = startIdx; i < matchSegments.length; i++) {
        const seg = matchSegments[i];
        const proj = projectPointOntoSegment(lng, lat, seg);
        if (proj.distMeters > FOLLOW_VISIT_RADIUS_METERS) continue;
        const angleDiff = (hasHeading && seg.lenM >= 1.2) ? Math.abs(getAngleDiff(gpsHeading, seg.bearing)) : 0;
        if (hasHeading && angleDiff > 65) continue;
        if (proj.distMeters < bestDist) {
            bestDist = proj.distMeters;
            bestResult = {
                matchIdx: i,
                origIdx: seg.origIdx,
                projLng: proj.projLng,
                projLat: proj.projLat,
                distMeters: proj.distMeters,
                bearing: seg.bearing,
                musicActive: seg.musicActive,
                angleDiff,
                hasHeading,
                headingAligned: true,
                t: proj.t
            };
        }
    }
    return bestResult;
}

function findInitialMatchSegmentIdx(matchSegments, origTrackIdx) {
    if (!Array.isArray(matchSegments) || matchSegments.length === 0) return 0;
    for (let i = 0; i < matchSegments.length; i++) {
        if (matchSegments[i].origIdx >= origTrackIdx) return i;
    }
    return matchSegments.length - 1;
}

function ensureFollowSkippedSegmentsLayer() {
    if (!map || !map.isStyleLoaded?.()) return false;
    try {
        if (!map.getSource(FOLLOW_SKIPPED_SOURCE_ID)) {
            map.addSource(FOLLOW_SKIPPED_SOURCE_ID, {
                type: 'geojson',
                data: emptyGeoJSON()
            });
        }
        const beforeLayerId = map.getLayer(FOLLOW_DIR_ARROW_LAYER_ID) ? FOLLOW_DIR_ARROW_LAYER_ID : undefined;
        if (!map.getLayer(FOLLOW_SKIPPED_CASING_LAYER_ID)) {
            map.addLayer({
                id: FOLLOW_SKIPPED_CASING_LAYER_ID,
                type: 'line',
                source: FOLLOW_SKIPPED_SOURCE_ID,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 11,
                    'line-opacity': 0.95
                }
            }, beforeLayerId);
        }
        if (!map.getLayer(FOLLOW_SKIPPED_LINE_LAYER_ID)) {
            map.addLayer({
                id: FOLLOW_SKIPPED_LINE_LAYER_ID,
                type: 'line',
                source: FOLLOW_SKIPPED_SOURCE_ID,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#f97316',
                    'line-width': 7,
                    'line-dasharray': [1.8, 1.4],
                    'line-opacity': 0.98
                }
            }, beforeLayerId);
        }
        return true;
    } catch (e) {
        return false;
    }
}

function updateFollowSkippedSegmentsLayer(matchSegments, visitedSegFlags, currentMatchIdx, throttleMs = 250) {
    if (!map) return;
    if (throttleMs > 0) {
        const now = performance.now();
        if (now - lastFollowSkippedRenderTime < throttleMs) return;
        lastFollowSkippedRenderTime = now;
    } else {
        lastFollowSkippedRenderTime = performance.now();
    }
    if (!ensureFollowSkippedSegmentsLayer()) return;
    const src = map.getSource(FOLLOW_SKIPPED_SOURCE_ID);
    if (!src) return;

    if (!Array.isArray(matchSegments) || !visitedSegFlags || currentMatchIdx <= 0) {
        src.setData(emptyGeoJSON());
        return;
    }

    const limit = Math.min(currentMatchIdx, matchSegments.length);
    const features = [];
    let coords = [];
    for (let i = 0; i < limit; i++) {
        if (visitedSegFlags[i] === 0) {
            const seg = matchSegments[i];
            if (coords.length === 0) {
                coords.push([seg.aLng, seg.aLat], [seg.bLng, seg.bLat]);
            } else {
                const prev = coords[coords.length - 1];
                if (Math.abs(prev[0] - seg.aLng) > 1e-6 || Math.abs(prev[1] - seg.aLat) > 1e-6) {
                    if (coords.length >= 2) {
                        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });
                    }
                    coords = [[seg.aLng, seg.aLat], [seg.bLng, seg.bLat]];
                } else {
                    coords.push([seg.bLng, seg.bLat]);
                }
            }
        } else if (coords.length >= 2) {
            features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });
            coords = [];
        } else {
            coords = [];
        }
    }
    if (coords.length >= 2) {
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });
    }
    src.setData({ type: 'FeatureCollection', features });
}

function clearFollowSkippedSegmentsLayer() {
    lastFollowSkippedRenderTime = 0;
    try {
        map?.getSource(FOLLOW_SKIPPED_SOURCE_ID)?.setData(emptyGeoJSON());
    } catch (e) {}
}

function getOrCreateTacticalUndoProgressBtn() {
    let btn = document.getElementById('tacticalUndoProgressBtn');
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'tacticalUndoProgressBtn';
    btn.type = 'button';
    btn.className = 'hidden absolute bottom-[5.75rem] left-4 z-[60] bg-slate-800/90 hover:bg-slate-700 text-white px-3 py-2 rounded-full shadow-2xl flex items-center gap-1.5 text-xs font-extrabold active:scale-95 pointer-events-auto border-2 border-white whitespace-nowrap';
    btn.title = '一鍵回退導航進度至上一個路口';
    btn.innerHTML = '<span>↩️</span><span>進度回退</span>';
    document.body.appendChild(btn);
    return btn;
}

function ensureFollowDirectionArrowsLayer() {
    if (!map || !map.isStyleLoaded?.()) return false;
    try {
        if (!map.hasImage(FOLLOW_DIR_ARROW_ICON_ID)) {
            const size = 32;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, size, size);
                ctx.beginPath();
                ctx.moveTo(size / 2, 5);
                ctx.lineTo(size - 6, size - 7);
                ctx.lineTo(size / 2, size - 13);
                ctx.lineTo(6, size - 7);
                ctx.closePath();
                ctx.lineJoin = 'round';
                ctx.lineWidth = 4.5;
                ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
                ctx.stroke();
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                const imgData = ctx.getImageData(0, 0, size, size);
                map.addImage(
                    FOLLOW_DIR_ARROW_ICON_ID,
                    { width: size, height: size, data: new Uint8Array(imgData.data.buffer) },
                    { pixelRatio: 2 }
                );
            }
        }
        if (!map.getSource(FOLLOW_DIR_ARROW_SOURCE_ID)) {
            map.addSource(FOLLOW_DIR_ARROW_SOURCE_ID, {
                type: 'geojson',
                data: emptyGeoJSON()
            });
        }
        if (!map.getLayer(FOLLOW_DIR_ARROW_LAYER_ID)) {
            map.addLayer({
                id: FOLLOW_DIR_ARROW_LAYER_ID,
                type: 'symbol',
                source: FOLLOW_DIR_ARROW_SOURCE_ID,
                layout: {
                    'icon-image': FOLLOW_DIR_ARROW_ICON_ID,
                    'icon-size': [
                        'interpolate', ['linear'], ['zoom'],
                        14, 0.65,
                        17, 0.85,
                        19.5, 1.0
                    ],
                    'icon-rotate': ['get', 'bearing'],
                    'icon-rotation-alignment': 'map',
                    'icon-pitch-alignment': 'map',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true
                },
                paint: {
                    'icon-opacity': 0.92
                }
            });
        }
        return true;
    } catch (e) {
        return false;
    }
}

function updateFollowDirectionArrows(matchSegments, currentMatchIdx, throttleMs = 350) {
    if (!map) return;
    if (throttleMs > 0) {
        const now = performance.now();
        if (now - lastFollowArrowRenderTime < throttleMs) return;
        lastFollowArrowRenderTime = now;
    } else {
        lastFollowArrowRenderTime = performance.now();
    }
    if (!ensureFollowDirectionArrowsLayer()) return;
    const src = map.getSource(FOLLOW_DIR_ARROW_SOURCE_ID);
    if (!src) return;

    if (!Array.isArray(matchSegments) || matchSegments.length === 0) {
        src.setData(emptyGeoJSON());
        return;
    }

    const startIdx = Math.min(Math.max(currentMatchIdx || 0, 0), matchSegments.length - 1);
    const baseCumM = matchSegments[startIdx].cumM;
    const features = [];
    let nextArrowDistM = baseCumM + 18;
    const maxLookaheadM = 900;

    for (let i = startIdx; i < matchSegments.length; i++) {
        const seg = matchSegments[i];
        const segEndCumM = seg.cumM + seg.lenM;
        const aheadM = seg.cumM - baseCumM;
        if (aheadM > maxLookaheadM || features.length >= 45) break;

        while (nextArrowDistM <= segEndCumM && features.length < 45) {
            const frac = seg.lenM > 0 ? Math.min(1, Math.max(0, (nextArrowDistM - seg.cumM) / seg.lenM)) : 0.5;
            const arrowLng = seg.aLng + (seg.bLng - seg.aLng) * frac;
            const arrowLat = seg.aLat + (seg.bLat - seg.aLat) * frac;
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [arrowLng, arrowLat] },
                properties: { bearing: seg.bearing }
            });
            // 前方 280m 內較密（每 24m 一個箭頭），更遠處每 45m 一個箭頭
            const stepM = (nextArrowDistM - baseCumM) < 280 ? 24 : 45;
            nextArrowDistM += stepM;
        }
    }

    src.setData({ type: 'FeatureCollection', features });
}

function clearFollowDirectionArrows() {
    lastFollowArrowRenderTime = 0;
    try {
        map?.getSource(FOLLOW_DIR_ARROW_SOURCE_ID)?.setData(emptyGeoJSON());
    } catch (e) {}
}

document.getElementById('startFollowBtn').onclick = async () => {
    window.BgmPlayer?.unlockAndSync();
    isReplaying = false;
    window.isReplaying = false;
    stopSmoothPlayback();
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

    const route = getActivePlaybackOrFollowRoute();
    if (!route) return;
    document.getElementById('routeDetailUI').classList.add('hidden');
    if (window.isFurnitureNavOrReplayActive) {
        document.getElementById('furnitureModeUI')?.classList.add('hidden');
        document.getElementById('furnitureLeftConnectControls')?.classList.add('hidden');
        document.getElementById('topBackBtn')?.classList.add('hidden');
    }
    // 顯示右下角的獨立結束按鈕與左下角的一鍵標記黃色注意點按鈕
    document.getElementById('tacticalStopBtn').classList.remove('hidden');
    if (window.isFurnitureNavOrReplayActive) {
        document.getElementById('tacticalQuickAlertBtn')?.classList.add('hidden');
    } else {
        document.getElementById('tacticalQuickAlertBtn')?.classList.remove('hidden');
    }
    document.getElementById('appStatusTitle').innerText = `導航：${route.name}`;
    
    let hasAnnouncedStart = false, hasAnnouncedEnd = false, wasOffRoute = false; 
    window.startGuidanceSpoken = true; window.lastOffRouteTime = 0;        

    triggeredMusicIndices.clear(); triggeredTurnIndices.clear();
    isBlackScreenActive = false; isScreenAutoWoken = false;

    const pts = route.points;
    const isGeneralFollowNav = !window.isFurnitureNavOrReplayActive;
    const followCumMeters = buildCumulativeRouteMeters(pts);
    const followMatchSegments = isGeneralFollowNav ? buildFollowMatchTrack(pts) : [];
    const visitedSegFlags = isGeneralFollowNav ? new Uint8Array(followMatchSegments.length) : null;
    const precomputedTurns = precomputeFollowRouteTurns(pts, followCumMeters);
    // 重新開始導航時，完整重置所有標記點（含語音開關與一般提醒點）的 played 與 prePlayed 狀態
    const mappedEvents = prepareVoiceMarkerEvents(route, !window.isFurnitureNavOrReplayActive);
    window.activeFollowMappedEvents = mappedEvents;
    if (typeof resetPassedRouteReminders === 'function') resetPassedRouteReminders();

    window.stopsQueue = (route.points || []).map((p, index) => ({ ...p, ptIdx: index })).filter(p => p.is_stop === true);
    window.currentStopIndex = 0;
    if (window.stopsQueue.length > 0) {
        document.getElementById('tacticalTimePanel').classList.remove('hidden');
        updateTacticalDisplay();
        window.tacticalTimer = setInterval(updateTacticalDisplay, 1000); 
    } else {
        document.getElementById('tacticalTimePanel').classList.add('hidden');
    }

    let currentTrackIndex = 0;
    let currentMatchIdx = 0;
    let initialStartMatchIdx = 0;
    let hasInitializedTrackIndex = false;
    let isSnappedToRoute = false;
    let offRouteStreakCount = 0;
    let offRouteFirstExceedMs = 0;
    let lastFollowGpsTimeMs = 0;
    let lastSkipWarnTimeMs = 0;
    const warnedSkipGapKeys = new Set();
    const progressCheckpoints = [];

    const recordProgressCheckpoint = (mIdx, tIdx, force = false) => {
        if (!isGeneralFollowNav || !followMatchSegments.length) return;
        const safeMIdx = Math.min(Math.max(mIdx, 0), followMatchSegments.length - 1);
        const curCumM = followMatchSegments[safeMIdx].cumM;
        const lastCp = progressCheckpoints[progressCheckpoints.length - 1];
        if (!force && lastCp && Math.abs(curCumM - lastCp.cumM) < 40) return;
        progressCheckpoints.push({ matchIdx: safeMIdx, trackIdx: tIdx, cumM: curCumM });
        if (progressCheckpoints.length > 30) progressCheckpoints.shift();
    };

    const undoProgressBtn = getOrCreateTacticalUndoProgressBtn();
    if (isGeneralFollowNav) {
        undoProgressBtn.classList.remove('hidden');
        undoProgressBtn.onclick = () => {
            if (!followMatchSegments.length || !visitedSegFlags) return;
            const curCumM = followMatchSegments[Math.min(currentMatchIdx, followMatchSegments.length - 1)]?.cumM || 0;
            let targetMatchIdx = initialStartMatchIdx;
            let targetTrackIdx = followMatchSegments[initialStartMatchIdx]?.origIdx || 0;

            // 優先回退至前一個距離目前超過 25m 的紀錄點（含跳段前存檔點）
            while (progressCheckpoints.length > 1) {
                const top = progressCheckpoints[progressCheckpoints.length - 1];
                if (top.matchIdx >= currentMatchIdx || (curCumM - top.cumM) < 25) {
                    progressCheckpoints.pop();
                } else {
                    break;
                }
            }
            if (progressCheckpoints.length > 0 && progressCheckpoints[progressCheckpoints.length - 1].matchIdx < currentMatchIdx) {
                const cp = progressCheckpoints.pop();
                targetMatchIdx = Math.max(initialStartMatchIdx, cp.matchIdx);
                targetTrackIdx = cp.trackIdx;
            } else {
                // 若無更早紀錄點，往回退約 60 公尺（不超過啟動初始點）
                let backIdx = currentMatchIdx;
                while (backIdx > initialStartMatchIdx && (curCumM - followMatchSegments[backIdx].cumM) < 60) {
                    backIdx--;
                }
                targetMatchIdx = Math.max(initialStartMatchIdx, backIdx);
                targetTrackIdx = followMatchSegments[targetMatchIdx]?.origIdx || 0;
            }

            currentMatchIdx = targetMatchIdx;
            currentTrackIndex = targetTrackIdx;
            window.activeFollowCurrentTrackIndex = currentTrackIndex;

            // 還原回退位置之後的已通過標記與跳段警告紀錄
            for (let k = currentMatchIdx + 1; k < visitedSegFlags.length; k++) {
                if (visitedSegFlags[k] === 1) visitedSegFlags[k] = 0;
            }
            warnedSkipGapKeys.clear();
            offRouteStreakCount = 0;
            offRouteFirstExceedMs = 0;

            // 還原回退點之後的轉彎與提醒播報狀態
            mappedEvents.forEach(ev => {
                if ((ev.ptIdx || 0) >= currentTrackIndex) {
                    ev.played = false;
                    ev.prePlayed = false;
                    if (ev.sourceEvent) {
                        ev.sourceEvent.played = false;
                        ev.sourceEvent.prePlayed = false;
                    }
                }
            });
            precomputedTurns.forEach(t => {
                if (t.turnIdx >= currentTrackIndex) {
                    t.announced = false;
                    triggeredTurnIndices.delete(t.turnIdx);
                }
            });

            if (!isPowerSaveMapPaused()) {
                updateProgressRouteLayers(pts, currentTrackIndex, null, 0);
                updateFollowSkippedSegmentsLayer(followMatchSegments, visitedSegFlags, currentMatchIdx, 0);
                updateFollowDirectionArrows(followMatchSegments, currentMatchIdx, 0);
                updateRouteProgressHud(currentTrackIndex, pts.length);
            }
            vibrate([80, 40, 80]);
            showNavAlert('↩️', '已回退至上一路段進度', 'bg-amber-600');
        };
    } else {
        undoProgressBtn.classList.add('hidden');
        undoProgressBtn.onclick = null;
    }

    window.activeFollowCurrentTrackIndex = 0;
    updateProgressRouteLayers(route.points, 0, null, 0);
    clearFollowSkippedSegmentsLayer();
    if (isGeneralFollowNav) {
        updateFollowDirectionArrows(followMatchSegments, 0, 0);
    } else {
        clearFollowDirectionArrows();
    }
    if (window.isFurnitureNavOrReplayActive) {
        hideRouteProgressHud();
        if (typeof renderAllFurnitureMapElements === 'function') renderAllFurnitureMapElements();
    } else {
        renderRouteMarkers(route);
        showRouteProgressHud(route);
    }
    setCameraFollow(true);
    window.ApproachNav?.onFollowStart(route, lastKnownLngLat);

    // 🚀 按下導航瞬間，強制將鏡頭拉近到「實戰特寫視角」並傾斜
    const initBearing = isHeadingUpMode ? currentHeading : 0;
    vehicleVisualHeading = currentHeading;
    map.flyTo({
        center: lastKnownLngLat,
        zoom: 19.5, // 💡 導航專用的超近巷弄特寫視角（較原 18.5 再放大 +1.0 級）
        pitch: 50,  // 💡 視角稍微傾斜 50 度，看起來更像專業車載 3D 導航
        bearing: initBearing,
        offset: [0, 100],
        duration: 1500 // 飛行過場動畫 1.5 秒
    });
    window.syncCarHeading?.(currentHeading, initBearing);

    await requestScreenWakeLock();

    activeFollowGpsHandler = pos => {
        markGpsUpdateReceived();
        const filtered = processFilteredGpsPosition(pos);
        if (!filtered) return; // 剔除 accuracy > 45m 低精度與 > 160km/h 衛星反射瞬移

        const lng = filtered.lng, lat = filtered.lat;
        const rawGpsHeading = (typeof pos?.coords?.heading === 'number' && !isNaN(pos.coords.heading) && pos.coords.heading >= 0)
            ? pos.coords.heading
            : null;
        const heading = (typeof filtered.heading === 'number' && !isNaN(filtered.heading))
            ? filtered.heading
            : (rawGpsHeading !== null ? rawGpsHeading : currentHeading);
        currentHeading = heading;
        vehicleVisualHeading = heading;

        if (typeof window.onFleetPositionUpdate === 'function') {
            window.onFleetPositionUpdate(lat, lng);
        }

        const updateFollowVehicleAndCamera = (targetLngLat, targetHeading, forceUpdate = false) => {
            if (isPowerSaveMapPaused()) return;
            if (forceUpdate || !filtered.isStationary || filtered.isWakeupFix) {
                if (vehicleMarker) {
                    smoothMoveVehicleMarker(targetLngLat, targetHeading, 750);
                }

                if (isFollowingCamera) {
                    const targetZoom = getDynamicZoomBySpeed(filtered.speedKmh);
                    const targetBearing = isHeadingUpMode ? targetHeading : map.getBearing();
                    map.easeTo({
                        center: targetLngLat,
                        zoom: targetZoom,
                        bearing: targetBearing,
                        offset: [0, 100],
                        duration: 600
                    });
                }
            }
            window.syncCarHeading?.(targetHeading, map ? map.getBearing() : 0);
        };

        if (!isGeneralFollowNav) {
            updateFollowVehicleAndCamera(lastKnownLngLat, heading, false);
        }

        // 計算距起點與距正式路線最短距離（一般清運同時計算細分線段垂直投影距離，避免節點較疏時在路線上卻誤判離線而卡在前往起點階段）
        const distToStart = getDistanceKm(lng, lat, pts[0].lng, pts[0].lat) * 1000;
        let minDistToFormalRoute = Infinity;
        for (let i = 0; i < pts.length; i++) {
            const dM = getDistanceKm(lng, lat, pts[i].lng, pts[i].lat) * 1000;
            if (dM < minDistToFormalRoute) minDistToFormalRoute = dM;
        }
        const preStartRouteMatch = (isGeneralFollowNav && !hasAnnouncedStart && followMatchSegments.length > 0)
            ? findInitialBestMatchSegment(followMatchSegments, lng, lat, heading, !filtered.isStationary, distToStart <= 80)
            : null;
        if (preStartRouteMatch && preStartRouteMatch.distMeters < minDistToFormalRoute) {
            minDistToFormalRoute = preStartRouteMatch.distMeters;
        }

        window.ApproachNav?.onGpsUpdate({
            lng,
            lat,
            heading,
            speedKmh: filtered.speedKmh,
            rawSpeedMps: (typeof pos?.coords?.speed === 'number' ? pos.coords.speed : null),
            route,
            minDistToRoute: minDistToFormalRoute,
            distToStart,
            hasAnnouncedStart
        });

        // 🛡️ 前往起點導航中：若車輛已實際進入起點（<= 45m）或順向行經正式路線區段（垂直距離 <= 35m），立即無縫切換至正式遵循導航並啟動經過變灰
        let justTransitionedFromApproach = false;
        if (window.ApproachNav?.isActive()) {
            const enteredRouteDuringApproach = (
                distToStart <= 45 ||
                (preStartRouteMatch && preStartRouteMatch.distMeters <= FOLLOW_VISIT_RADIUS_METERS && preStartRouteMatch.headingAligned)
            );
            if (enteredRouteDuringApproach) {
                window.ApproachNav.stop(false);
                justTransitionedFromApproach = true;
            } else {
                if (isGeneralFollowNav) updateFollowVehicleAndCamera(lastKnownLngLat, heading, false);
                return;
            }
        }

        // 尚未抵達起點或正式路線前（待命前往起點階段）：抵達起點或正式路線 45m 內即啟動正式任務與經過變灰
        if (!hasAnnouncedStart) {
            if (justTransitionedFromApproach || distToStart <= 45 || minDistToFormalRoute <= 45) {
                hasAnnouncedStart = true;
                justTransitionedFromApproach = true;
                window.ApproachNav?.onGpsUpdate({
                    lng,
                    lat,
                    heading,
                    speedKmh: filtered.speedKmh,
                    rawSpeedMps: (typeof pos?.coords?.speed === 'number' ? pos.coords.speed : null),
                    route,
                    minDistToRoute: minDistToFormalRoute,
                    distToStart,
                    hasAnnouncedStart: true
                });
                document.getElementById('appStatusTitle').innerText = `導航：${route.name}`;
                showNavAlert('✅', '抵達路線，開始任務', 'bg-green-600');
                speakText("我們任務開始，路上請注意安全。");
                vibrate([200, 100, 200]);
            } else {
                if (isGeneralFollowNav) updateFollowVehicleAndCamera(lastKnownLngLat, heading, false);
                if (!window.ApproachNav?.isPromptVisible?.()) {
                    document.getElementById('appStatusTitle').innerText = `前往起點 (${Math.round(distToStart)}m)`;
                }
                return;
            }
        }

        // 即時計算路線進度索引 currentTrackIndex（僅於真正抵達起點並進入正式遵循導航後才開始更新）：
        // 1. 初次進入導航：起點 80m 內優先由起點端匹配；半路切入則找最近軌跡段（排除終點末端）
        // 2. 導航進行中：嚴格限制在前方滑動視窗（沿線約 150~250m 內）順序推進，防止折返重疊跳號
        const prevTrackIndex = currentTrackIndex;
        const nowGpsMs = Date.now();
        const dtGpsSec = lastFollowGpsTimeMs > 0 ? Math.min(Math.max((nowGpsMs - lastFollowGpsTimeMs) / 1000, 0.5), 6) : 1.5;
        lastFollowGpsTimeMs = nowGpsMs;
        const rawSpeedKmh = (typeof pos?.coords?.speed === 'number' && !isNaN(pos.coords.speed) && pos.coords.speed > 0)
            ? pos.coords.speed * 3.6
            : 0;
        const estSpeedKmh = Math.max(typeof filtered.speedKmh === 'number' ? filtered.speedKmh : 0, rawSpeedKmh);
        // 依車速與時間差動態限制單次最大前進距離（35m ~ 90m），徹底禁止迴轉壓線跳躍至遠端路段
        const maxSingleStepForwardM = Math.min(90, Math.max(35, (estSpeedKmh / 3.6) * dtGpsSec * 1.8 + 25));

        let progressInfo;
        let matchResult = null;
        if (!hasInitializedTrackIndex) {
            if (isGeneralFollowNav && followMatchSegments.length > 0) {
                // 🚀 啟動導航當下：允許一次性全域順向對齊（支援中途才開導航，不會強迫回起點或誤報漏段）
                const preferStart = (distToStart <= 80);
                matchResult = findInitialBestMatchSegment(followMatchSegments, lng, lat, heading, !filtered.isStationary, preferStart);
                if (matchResult) {
                    initialStartMatchIdx = matchResult.matchIdx;
                    currentMatchIdx = matchResult.matchIdx;
                    currentTrackIndex = matchResult.origIdx;
                    if (visitedSegFlags) {
                        for (let k = 0; k < initialStartMatchIdx; k++) {
                            visitedSegFlags[k] = 2; // 導航啟動前已過段（不視為漏段）
                        }
                        if (matchResult.distMeters <= FOLLOW_VISIT_RADIUS_METERS) {
                            visitedSegFlags[currentMatchIdx] = 1;
                        }
                    }
                    recordProgressCheckpoint(currentMatchIdx, currentTrackIndex, true);
                }
                progressInfo = {
                    trackIndex: currentTrackIndex,
                    minDistMeters: matchResult ? matchResult.distMeters : minDistToFormalRoute
                };
            } else {
                progressInfo = (typeof findInitialFollowTrackIndex === 'function')
                    ? findInitialFollowTrackIndex(pts, lng, lat, heading, !filtered.isStationary, followCumMeters)
                    : computeNextTrackIndex(pts, currentTrackIndex, lng, lat, heading, !filtered.isStationary, followCumMeters);
                currentTrackIndex = progressInfo.trackIndex;
            }
            hasInitializedTrackIndex = true;
            // 若為半路切入（距起點 > 80m 且起算索引 > 0），將起始點之前的舊事件與舊轉彎標記為已略過避免回溯誤報
            if (currentTrackIndex > 0) {
                mappedEvents.forEach(ev => {
                    if ((ev.ptIdx || 0) < currentTrackIndex - 2) {
                        ev.played = true;
                        ev.prePlayed = true;
                    }
                });
                precomputedTurns.forEach(t => {
                    if (t.turnIdx <= currentTrackIndex) {
                        t.announced = true;
                        triggeredTurnIndices.add(t.turnIdx);
                    }
                });
            }
        } else if (isGeneralFollowNav && followMatchSegments.length > 0) {
            const prevMatchIdx = currentMatchIdx;
            matchResult = matchGpsToFollowTrackWindow(
                followMatchSegments,
                currentMatchIdx,
                lng,
                lat,
                heading,
                !filtered.isStationary,
                maxSingleStepForwardM
            );

            // 若目前處於繞路偏離狀態，嘗試向前重新銜接（嚴格要求 <= 35m 且方向順向 <= 65°）
            let didDetourReattach = false;
            if ((!matchResult || matchResult.distMeters > FOLLOW_SNAP_RADIUS_METERS) && wasOffRoute) {
                const reattach = findDetourReattachMatchSegment(
                    followMatchSegments,
                    currentMatchIdx,
                    lng,
                    lat,
                    heading,
                    !filtered.isStationary
                );
                if (reattach) {
                    recordProgressCheckpoint(prevMatchIdx, currentTrackIndex, true);
                    matchResult = reattach;
                    didDetourReattach = true;
                }
            }

            // 🛡️ 防迴轉壓線跳段核心：僅在「距離合理」且「行進方向順向（夾角 <= 75°）」時才允許推進進度與標記實際經過
            if (matchResult && matchResult.distMeters <= FOLLOW_SNAP_RADIUS_METERS && matchResult.headingAligned) {
                const nextMatchIdx = matchResult.matchIdx;
                if (nextMatchIdx >= currentMatchIdx) {
                    const prevCumM = followMatchSegments[prevMatchIdx]?.cumM || 0;
                    const nextCumM = followMatchSegments[nextMatchIdx]?.cumM || 0;
                    const advanceM = nextCumM - prevCumM;

                    currentMatchIdx = nextMatchIdx;
                    currentTrackIndex = Math.max(currentTrackIndex, matchResult.origIdx);

                    // 逐段實際經過驗證：只有車輛實際靠近（<= 35m）且順向通過的線段才標記為已通過 (1)
                    if (visitedSegFlags && matchResult.distMeters <= FOLLOW_VISIT_RADIUS_METERS) {
                        visitedSegFlags[currentMatchIdx] = 1;
                        if (!didDetourReattach && advanceM <= 45) {
                            for (let k = prevMatchIdx; k <= currentMatchIdx; k++) {
                                if (visitedSegFlags[k] === 0) visitedSegFlags[k] = 1;
                            }
                        }
                    }
                    recordProgressCheckpoint(currentMatchIdx, currentTrackIndex, didDetourReattach);
                } else if (visitedSegFlags && matchResult.distMeters <= FOLLOW_VISIT_RADIUS_METERS) {
                    // 若駕駛繞回補收先前被跳過的橘紅警示路段，實際壓過後即標記已通過
                    visitedSegFlags[nextMatchIdx] = 1;
                }
            }

            // 檢查啟動點至目前進度之間是否存在 > 50 公尺的連續未實際經過路段（跳段漏收主動語音＋畫面防呆）
            if (visitedSegFlags && currentMatchIdx > initialStartMatchIdx) {
                let gapMeters = 0;
                let gapStartIdx = -1;
                for (let k = initialStartMatchIdx; k < currentMatchIdx; k++) {
                    if (visitedSegFlags[k] === 0) {
                        if (gapStartIdx === -1) gapStartIdx = k;
                        gapMeters += followMatchSegments[k].lenM;
                    } else {
                        if (gapMeters > FOLLOW_SKIP_WARN_MIN_METERS) {
                            const gapKey = `${gapStartIdx}_${k}`;
                            if (!warnedSkipGapKeys.has(gapKey) && (nowGpsMs - lastSkipWarnTimeMs) > 20000) {
                                warnedSkipGapKeys.add(gapKey);
                                lastSkipWarnTimeMs = nowGpsMs;
                                autoWakeScreen();
                                showNavAlert('⚠️', '注意：中間有路段未經過，請確認是否漏收', 'bg-orange-600');
                                speakText('注意，中間有路段未經過，請確認是否漏收');
                                vibrate([250, 100, 250]);
                                autoSleepScreen();
                            }
                        }
                        gapMeters = 0;
                        gapStartIdx = -1;
                    }
                }
                if (gapMeters > FOLLOW_SKIP_WARN_MIN_METERS && gapStartIdx !== -1) {
                    const gapKey = `${gapStartIdx}_${currentMatchIdx}`;
                    if (!warnedSkipGapKeys.has(gapKey) && (nowGpsMs - lastSkipWarnTimeMs) > 20000) {
                        warnedSkipGapKeys.add(gapKey);
                        lastSkipWarnTimeMs = nowGpsMs;
                        autoWakeScreen();
                        showNavAlert('⚠️', '注意：中間有路段未經過，請確認是否漏收', 'bg-orange-600');
                        speakText('注意，中間有路段未經過，請確認是否漏收');
                        vibrate([250, 100, 250]);
                        autoSleepScreen();
                    }
                }
            }

            progressInfo = {
                trackIndex: currentTrackIndex,
                minDistMeters: matchResult ? matchResult.distMeters : computeNextTrackIndex(pts, currentTrackIndex, lng, lat, heading, !filtered.isStationary, followCumMeters).minDistMeters
            };
        } else {
            progressInfo = computeNextTrackIndex(pts, currentTrackIndex, lng, lat, heading, !filtered.isStationary, followCumMeters);
            currentTrackIndex = progressInfo.trackIndex;
        }
        window.activeFollowCurrentTrackIndex = currentTrackIndex;
        const minDist = progressInfo.minDistMeters;
        let isOffRoute = true;

        if (isGeneralFollowNav) {
            const rawDistToTrack = matchResult ? matchResult.distMeters : minDist;
            const gpsAcc = (typeof filtered.accuracy === 'number' && !isNaN(filtered.accuracy)) ? filtered.accuracy : 0;
            const accBufferM = gpsAcc > 15
                ? Math.min(FOLLOW_OFF_ROUTE_MAX_METERS - FOLLOW_OFF_ROUTE_BASE_METERS, (gpsAcc - 15) * 0.5)
                : 0;
            const offRouteThresholdM = Math.min(FOLLOW_OFF_ROUTE_MAX_METERS, FOLLOW_OFF_ROUTE_BASE_METERS + accBufferM);
            const rawHardwareKmh = (typeof pos?.coords?.speed === 'number' && !isNaN(pos.coords.speed) && pos.coords.speed > 0)
                ? pos.coords.speed * 3.6
                : 0;
            const speedKmhForOffRoute = Math.max(typeof filtered.speedKmh === 'number' ? filtered.speedKmh : 0, rawHardwareKmh);

            const wasAlreadySnapped = isSnappedToRoute;
            if (matchResult && rawDistToTrack <= FOLLOW_SNAP_RADIUS_METERS) {
                isSnappedToRoute = true;
                offRouteStreakCount = 0;
                offRouteFirstExceedMs = 0;
                isOffRoute = false;
                offRouteWarning.classList.add('hidden');
                if (wasOffRoute) {
                    speakText("已重新回到原定路線。");
                    wasOffRoute = false;
                }
            } else if (rawDistToTrack > offRouteThresholdM) {
                if (speedKmhForOffRoute > FOLLOW_OFF_ROUTE_MIN_SPEED_KMH) {
                    offRouteStreakCount++;
                    if (offRouteFirstExceedMs === 0) offRouteFirstExceedMs = Date.now();
                    const offRouteElapsedMs = Date.now() - offRouteFirstExceedMs;
                    if (offRouteStreakCount >= FOLLOW_OFF_ROUTE_STREAK_LIMIT || offRouteElapsedMs >= FOLLOW_OFF_ROUTE_DURATION_MS) {
                        isSnappedToRoute = false;
                        isOffRoute = true;
                        wasOffRoute = true;
                        offRouteWarning.classList.remove('hidden');
                        if (Date.now() - window.lastOffRouteTime > 15000) {
                            speakText("已偏離路線，請注意。");
                            vibrate([200, 100, 200]);
                            autoWakeScreen();
                            window.lastOffRouteTime = Date.now();
                        }
                    } else {
                        isOffRoute = wasOffRoute;
                    }
                } else {
                    isOffRoute = wasOffRoute;
                }
            } else {
                // 磁吸滯後緩衝區（45m ~ offRouteThresholdM）：維持原吸附狀態不抖動
                isOffRoute = !isSnappedToRoute && wasOffRoute;
            }

            if (isSnappedToRoute && matchResult && matchResult.headingAligned) {
                const snappedLngLat = [matchResult.projLng, matchResult.projLat];
                const snappedHeading = matchResult.bearing;
                lastKnownLngLat = snappedLngLat;
                currentHeading = snappedHeading;
                updateFollowVehicleAndCamera(snappedLngLat, snappedHeading, !wasAlreadySnapped);
            } else {
                updateFollowVehicleAndCamera([lng, lat], heading, wasAlreadySnapped);
            }
        }

        // 👾 動態軌跡變色（小精靈吃路線）：0 ~ currentTrackIndex 渲染為半透明淺灰色，currentTrackIndex ~ 終點維持高亮原色；未實際經過的跳過路段另以醒目橘紅虛線覆蓋防呆
        if (!isPowerSaveMapPaused()) {
            const exactSnapPos = (isGeneralFollowNav && isSnappedToRoute && matchResult && matchResult.headingAligned)
                ? { lng: matchResult.projLng, lat: matchResult.projLat, musicActive: matchResult.musicActive }
                : null;
            updateProgressRouteLayers(pts, currentTrackIndex, exactSnapPos, justTransitionedFromApproach ? 0 : 150);
            if (isGeneralFollowNav && followMatchSegments.length > 0) {
                updateFollowSkippedSegmentsLayer(followMatchSegments, visitedSegFlags, currentMatchIdx, justTransitionedFromApproach ? 0 : 250);
                updateFollowDirectionArrows(followMatchSegments, currentMatchIdx, justTransitionedFromApproach ? 0 : 350);
                updateRouteProgressHud(currentTrackIndex, pts.length);
            }
        }

        if (window.stopsQueue && window.currentStopIndex < window.stopsQueue.length) {
            const targetStop = window.stopsQueue[window.currentStopIndex];
            const distToStop = getDistanceKm(lng, lat, targetStop.lng, targetStop.lat) * 1000;
            const indexDiff = currentTrackIndex - targetStop.ptIdx;
            
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

        if (!hasAnnouncedEnd && pts.length >= 2) {
            const totalPoints = pts.length;
            const totalRouteMeters = Array.isArray(followCumMeters) && followCumMeters.length === totalPoints
                ? (followCumMeters[totalPoints - 1] || 0)
                : 0;
            const traveledMeters = Array.isArray(followCumMeters) && followCumMeters.length === totalPoints
                ? (followCumMeters[currentTrackIndex] || 0)
                : 0;
            const remainingRouteMeters = Math.max(0, totalRouteMeters - traveledMeters);

            // 條件 1（節點進度門檻）：currentTrackIndex 已進入整條路線最後尾段（>= totalPoints - 15 或剩餘軌跡長度 < 80m，且至少已完成後半段路線）
            const minTailIndex = totalPoints > 20
                ? (totalPoints - 15)
                : Math.max(1, Math.ceil(totalPoints * 0.75));
            const isAtRouteTail = (
                currentTrackIndex >= minTailIndex ||
                (totalRouteMeters > 80 && remainingRouteMeters < 80 && currentTrackIndex >= Math.ceil(totalPoints * 0.6))
            );

            // 條件 2（實際距離門檻）：車輛與終點 E 的實際直線距離 < 25 公尺
            const distToEnd = getDistanceKm(lng, lat, pts[totalPoints - 1].lng, pts[totalPoints - 1].lat) * 1000;

            // 雙重鎖定：必須同時滿足「已進入路線尾段進度」與「距終點 E < 25m」才可播報導航結束
            if (isAtRouteTail && distToEnd < 25) {
                speakText("已抵達路線終點，本次清運任務結束，辛苦了！");
                hasAnnouncedEnd = true;
                document.getElementById('tacticalTimePanel').classList.add('hidden');
            }
        }

        if (!isGeneralFollowNav) {
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
        }

        if (!isOffRoute && precomputedTurns.length > 0) {
            const currentAlongM = (Array.isArray(followCumMeters) && followCumMeters.length === pts.length)
                ? (followCumMeters[currentTrackIndex] || 0)
                : 0;

            for (let tIdx = 0; tIdx < precomputedTurns.length; tIdx++) {
                const turnItem = precomputedTurns[tIdx];
                if (turnItem.announced || triggeredTurnIndices.has(turnItem.turnIdx)) continue;

                // 若車輛進度已超過該轉彎頂點超過 8 公尺，直接標記已通過不再補報
                const alongToTurnM = turnItem.turnDistM - currentAlongM;
                if (currentTrackIndex > turnItem.turnIdx + 2 || alongToTurnM < -8) {
                    turnItem.announced = true;
                    triggeredTurnIndices.add(turnItem.turnIdx);
                    continue;
                }

                // 距離轉彎頂點進入 130 公尺內時，預先在背景查詢轉入路段路名並快取，確保抵達速度補償播報點（48~75m）時立即可用不延遲
                if (!turnItem.roadName && !turnItem.prefetching && alongToTurnM <= 130 && alongToTurnM >= 0) {
                    turnItem.roadName = lookupRoadNameFromMapOrPoint(pts, turnItem.afterIdx, turnItem.outBearing);
                    if (!turnItem.roadName) {
                        turnItem.prefetching = true;
                        fetchTurnTargetRoadNameAsync(turnItem.sampleLng, turnItem.sampleLat, turnItem.outBearing)
                            .then(resolvedName => {
                                if (resolvedName && !turnItem.roadName) {
                                    turnItem.roadName = resolvedName;
                                }
                            })
                            .catch(() => {});
                    }
                }

                // 計算車輛目前實際座標到轉彎頂點 (pts[turnItem.turnIdx]) 的精確距離
                const cornerPt = pts[turnItem.turnIdx];
                const directToCornerM = cornerPt
                    ? getDistanceKm(lng, lat, cornerPt.lng, cornerPt.lat) * 1000
                    : alongToTurnM;
                // 結合沿線剩餘距離與直線距離（避免節點較疏時沿線距離跳階）
                const effectiveDistToTurnM = Math.min(alongToTurnM, directToCornerM);

                // 結合車速前瞻補償（speed * 2.0 秒，低速約 48m、中高速 55~75m 上限）抵銷 GPS 與畫面平滑延遲，同一轉彎僅播報一次
                const speedMpsForTurn = Math.max(0, (estSpeedKmh || 0) / 3.6);
                const dynamicTurnTriggerM = Math.min(75, Math.max(48, 45 + speedMpsForTurn * 2.0));
                if (alongToTurnM <= (dynamicTurnTriggerM + 10) && effectiveDistToTurnM <= dynamicTurnTriggerM && effectiveDistToTurnM >= 0) {
                    turnItem.announced = true;
                    for (let k = Math.max(0, turnItem.turnIdx - 4); k <= Math.min(pts.length - 1, turnItem.afterIdx + 2); k++) {
                        triggeredTurnIndices.add(k);
                    }

                    if (!turnItem.roadName) {
                        turnItem.roadName = lookupRoadNameFromMapOrPoint(pts, turnItem.afterIdx, turnItem.outBearing);
                    }
                    const cleanRoad = sanitizeDetectedRoadName(turnItem.roadName);
                    const voiceMsg = cleanRoad
                        ? `前方${turnItem.actionZh}進${cleanRoad}`
                        : `前方${turnItem.actionZh}`;

                    autoWakeScreen();
                    showNavAlert(turnItem.iconHtml, '', 'bg-blue-600');
                    speakText(voiceMsg);
                    autoSleepScreen();
                    break;
                }

                // 只處理前方最近的一個未播報轉彎，若距離尚超過 135m 則跳出迴圈
                if (alongToTurnM > 135) break;
            }
        }

        // 🔊 遵循路線提醒點雙重防呆觸發（半徑 >= 35~45m 容錯 OR 路線進度越過提醒點），即便 GPS 飄移仍必定觸發不漏接
        if (minDist <= 85) {
            evaluateVoiceMarkersWithProgress({
                events: mappedEvents,
                pts,
                cumMeters: followCumMeters,
                currentTrackIndex,
                prevTrackIndex,
                lng,
                lat,
                vehicleBearing: heading,
                onTriggerWake: true,
                isFollowMode: true
            });
        }
        if (typeof updatePassedRouteReminders === 'function') {
            updatePassedRouteReminders({
                events: mappedEvents,
                pts,
                cumMeters: followCumMeters,
                currentTrackIndex,
                lng,
                lat
            });
        }
    };

    followWatchId = navigator.geolocation.watchPosition(
        activeFollowGpsHandler,
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
};

const endFollowAction = () => {
    window.ApproachNav?.stop(true);
    VoiceQueue.clear();
    hideRouteProgressHud();
    clearFollowDirectionArrows();
    clearFollowSkippedSegmentsLayer();
    const undoBtnEl = document.getElementById('tacticalUndoProgressBtn');
    if (undoBtnEl) {
        undoBtnEl.classList.add('hidden');
        undoBtnEl.onclick = null;
    }
    if (typeof resetPassedRouteReminders === 'function') resetPassedRouteReminders();
    activeFollowGpsHandler = null;
    window.activeFollowCurrentTrackIndex = null;
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

    if (window.isFurnitureNavOrReplayActive && typeof restoreFurnitureModeAfterNavOrReplay === 'function') {
        restoreFurnitureModeAfterNavOrReplay();
        startIdleGPS();
        return;
    }
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

    // 暫停正在播報的 TTS 語音並清空排隊佇列，避免干擾麥克風收音
    VoiceQueue.clear();

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

    if (typeof window.activeFollowCurrentTrackIndex === 'number' && window.activeFollowCurrentTrackIndex >= 0 && window.activeFollowCurrentTrackIndex < route.points.length) {
        lockedQuickAlertPtIdx = window.activeFollowCurrentTrackIndex;
    } else {
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
    }

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
        newAlertEv.played = true;
        newAlertEv.prePlayed = true;
        window.activeFollowMappedEvents.push({
            ...newAlertEv,
            segmentBearing: lockedQuickAlertBearing || 0,
            played: true,
            prePlayed: true,
            sourceEvent: newAlertEv
        });
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
            const savedRoute = upsertLocalRouteFromCloud(route);
            persistSavedRoutesToStorage().then(() => {
                renderHistoryList();
                alert(`✅ 成功匯入【${savedRoute.author || '熱心隊員'}】精心製作的路線：${savedRoute.name}`);
            });
        } catch (err) { alert('❌ 匯入失敗！請確認您選擇的是正確的路線檔案 (.txt)。'); }
        e.target.value = ''; 
    };
    reader.readAsText(file);
};

