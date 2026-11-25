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

    // 初始狀態（currentTrackIndex = 0）：已行駛路段為空，未行駛路段完整高亮顯示
    updateProgressRouteLayers(route.points, 0, null, 0);
    if (window.isFurnitureNavOrReplayActive) {
        if (typeof renderAllFurnitureMapElements === 'function') renderAllFurnitureMapElements();
    } else {
        renderRouteMarkers(route);
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
    const followCumMeters = buildCumulativeRouteMeters(pts);
    // 重新開始導航時，完整重置所有標記點（含語音開關與一般提醒點）的 played 與 prePlayed 狀態
    const mappedEvents = prepareVoiceMarkerEvents(route, !window.isFurnitureNavOrReplayActive);
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

    let currentTrackIndex = 0;
    let hasInitializedTrackIndex = false;
    window.activeFollowCurrentTrackIndex = 0;
    updateProgressRouteLayers(route.points, 0, null, 0);
    if (window.isFurnitureNavOrReplayActive) {
        if (typeof renderAllFurnitureMapElements === 'function') renderAllFurnitureMapElements();
    } else {
        renderRouteMarkers(route);
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

        if (!isPowerSaveMapPaused()) {
            if (!filtered.isStationary || filtered.isWakeupFix) {
                if (vehicleMarker) {
                    smoothMoveVehicleMarker(lastKnownLngLat, heading, 750);
                }

                if (isFollowingCamera) {
                    const targetZoom = getDynamicZoomBySpeed(filtered.speedKmh);
                    const targetBearing = isHeadingUpMode ? heading : map.getBearing();
                    map.easeTo({
                        center: lastKnownLngLat,
                        zoom: targetZoom,
                        bearing: targetBearing,
                        offset: [0, 100],
                        duration: 600
                    });
                }
            }
            window.syncCarHeading?.(heading, map ? map.getBearing() : 0);
        }

        // 純唯讀計算距起點與距正式路線最短距離（絕不提前推進 currentTrackIndex 或把正式路線變灰）
        const distToStart = getDistanceKm(lng, lat, pts[0].lng, pts[0].lat) * 1000;
        let minDistToFormalRoute = Infinity;
        for (let i = 0; i < pts.length; i++) {
            const dM = getDistanceKm(lng, lat, pts[i].lng, pts[i].lat) * 1000;
            if (dM < minDistToFormalRoute) minDistToFormalRoute = dM;
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

        // 🛡️ 前往起點導航中：完全隔離正式路線進度與灰色已通過渲染，保持原本清運路線顏色正常
        if (window.ApproachNav?.isActive()) return;

        // 尚未抵達起點或正式路線前（待命前往起點階段）：同樣不提前推進 currentTrackIndex 或將正式路線變灰
        if (!hasAnnouncedStart) {
            if (distToStart <= 45 || minDistToFormalRoute <= 45) {
                hasAnnouncedStart = true;
                document.getElementById('appStatusTitle').innerText = `導航：${route.name}`;
                showNavAlert('✅', '抵達路線，開始任務', 'bg-green-600');
                speakText("我們任務開始，路上請注意安全。");
                vibrate([200, 100, 200]);
            } else {
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
        let progressInfo;
        if (!hasInitializedTrackIndex) {
            progressInfo = (typeof findInitialFollowTrackIndex === 'function')
                ? findInitialFollowTrackIndex(pts, lng, lat, heading, !filtered.isStationary, followCumMeters)
                : computeNextTrackIndex(pts, currentTrackIndex, lng, lat, heading, !filtered.isStationary, followCumMeters);
            currentTrackIndex = progressInfo.trackIndex;
            hasInitializedTrackIndex = true;
            // 若為半路切入（距起點 > 80m 且起算索引 > 0），將起始點之前的舊事件標記為已略過避免回溯誤報
            if (currentTrackIndex > 0) {
                mappedEvents.forEach(ev => {
                    if ((ev.ptIdx || 0) < currentTrackIndex - 2) {
                        ev.played = true;
                        ev.prePlayed = true;
                    }
                });
            }
        } else {
            progressInfo = computeNextTrackIndex(pts, currentTrackIndex, lng, lat, heading, !filtered.isStationary, followCumMeters);
            currentTrackIndex = progressInfo.trackIndex;
        }
        window.activeFollowCurrentTrackIndex = currentTrackIndex;
        const minDist = progressInfo.minDistMeters;
        let isOffRoute = true;

        // 👾 動態軌跡變色（小精靈吃路線）：0 ~ currentTrackIndex 渲染為半透明淺灰色，currentTrackIndex ~ 終點維持高亮原色
        if (!isPowerSaveMapPaused()) {
            updateProgressRouteLayers(pts, currentTrackIndex, null, 150);
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
            let lookAheadIdx = currentTrackIndex, scanDist = 0;
            while (lookAheadIdx < pts.length - 1 && scanDist < 30) {
                scanDist += (getDistanceKm(pts[lookAheadIdx].lng, pts[lookAheadIdx].lat, pts[lookAheadIdx+1].lng, pts[lookAheadIdx+1].lat) * 1000);
                lookAheadIdx++;
            }

            if (lookAheadIdx > currentTrackIndex && !triggeredTurnIndices.has(currentTrackIndex)) {
                const currentSegAngle = getBearing(pts[currentTrackIndex].lng, pts[currentTrackIndex].lat, pts[currentTrackIndex+1].lng, pts[currentTrackIndex+1].lat);
                const futureSegAngle = getBearing(pts[lookAheadIdx-1].lng, pts[lookAheadIdx-1].lat, pts[lookAheadIdx].lng, pts[lookAheadIdx].lat);
                const angleDiff = getAngleDiff(currentSegAngle, futureSegAngle);
                
                if (angleDiff > 40 && angleDiff < 140) {
                    for(let k = Math.max(0, currentTrackIndex - 3); k <= lookAheadIdx + 2; k++) triggeredTurnIndices.add(k);
                    autoWakeScreen(); 
                    // 🚀 換成 100% 絕對支援的基本大箭頭 (向右)
                    showNavAlert('<i class="fa-solid fa-arrow-right"></i>', '', 'bg-blue-600'); 
                    speakText("前方準備右轉"); 
                    autoSleepScreen();
                } else if (angleDiff < -40 && angleDiff > -140) {
                    for(let k = Math.max(0, currentTrackIndex - 3); k <= lookAheadIdx + 2; k++) triggeredTurnIndices.add(k);
                    autoWakeScreen(); 
                    // 🚀 換成 100% 絕對支援的基本大箭頭 (向左)
                    showNavAlert('<i class="fa-solid fa-arrow-left"></i>', '', 'bg-blue-600'); 
                    speakText("前方準備左轉"); 
                    autoSleepScreen();
                }
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

