// ==========================================
// [Module 3/10] src/route-editor.js
// 紀錄路線（三欄防誤觸）、歷史清單預覽、統一版路線編輯引擎、手拉畫路線（OSRM 道路吸附）與黃色提醒實景照片模組
// ==========================================

// --- 4. 紀錄路線（v3.27 三欄防誤觸橫排：左欄停止紀錄長按 1 秒＋確認 ｜ 中欄 GPS 精度隔離牆 ｜ 右欄音樂開關高頻盲操） ---
const musicToggleBtn = document.getElementById('musicToggleBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const stopRecordProgressFill = document.getElementById('stopRecordProgressFill');
const stopRecordSubHint = document.getElementById('stopRecordSubHint');

function renderMusicButtonState() {
    if (!musicToggleBtn) return;
    const icon = document.getElementById('musicBtnIcon');
    const text = document.getElementById('musicBtnText');
    const subHint = document.getElementById('musicBtnSubHint');
    if (musicActive) {
        musicToggleBtn.className = "w-full bg-green-600 text-white font-black py-2 px-1.5 rounded-2xl flex flex-col items-center justify-center shadow-lg animate-pulse active:scale-95 transition-all select-none";
        if (icon) icon.className = "fa-solid fa-volume-high text-xs";
        if (text) text.innerText = "🔊 音樂播放中";
        if (subHint) {
            subHint.innerText = "點擊切換關閉";
            subHint.className = "text-[9px] text-green-100 font-bold leading-tight mt-0.5 truncate max-w-full";
        }
    } else {
        musicToggleBtn.className = "w-full bg-gray-700 text-white font-black py-2 px-1.5 rounded-2xl flex flex-col items-center justify-center shadow-inner active:scale-95 transition-all select-none";
        if (icon) icon.className = "fa-solid fa-volume-xmark text-xs";
        if (text) text.innerText = "🔇 音樂關閉中";
        if (subHint) {
            subHint.innerText = "點擊切換開啟";
            subHint.className = "text-[9px] text-gray-300 font-bold leading-tight mt-0.5 truncate max-w-full";
        }
    }
}

if (musicToggleBtn) {
    musicToggleBtn.onclick = () => {
        if (!isRecording) return;
        musicActive = !musicActive;
        renderMusicButtonState();
        vibrate(25);
        const evtType = musicActive ? 'on' : 'off';
        musicEvents.push({ type: evtType, lng: lastKnownLngLat[0], lat: lastKnownLngLat[1], bearing: currentHeading });

        const badgeHtml = musicActive
            ? `<div class="music-marker music-on-pin"><i class="fa-solid fa-music"></i> 開音樂</div>`
            : `<div class="music-marker music-off-pin"><i class="fa-solid fa-volume-xmark"></i> 關音樂</div>`;
        addPinMarker(lastKnownLngLat, badgeHtml);
    };
}

function restoreIdleRecordingUILayout() {
    document.getElementById('recordingTopRow')?.classList.add('hidden');
    document.getElementById('idleTopRow')?.classList.remove('hidden');
    document.getElementById('idleActionRow')?.classList.remove('hidden');
    document.getElementById('startManualDrawBtn')?.classList.remove('hidden');
    const recBtn = document.getElementById('recordBtn');
    if (recBtn) {
        recBtn.classList.remove('bg-red-600');
        recBtn.classList.add('bg-green-700');
        const iconEl = recBtn.querySelector('i');
        if (iconEl) {
            iconEl.classList.remove('fa-stop');
            iconEl.classList.add('fa-play');
        }
    }
    const recBtnText = document.getElementById('recordBtnText');
    if (recBtnText) recBtnText.innerText = '開始紀錄路線';
    const titleEl = document.getElementById('appStatusTitle');
    if (titleEl) titleEl.innerText = '鶯歌清運路線助手 Pro Max';
}

async function stopAndSaveActiveRecording() {
    if (!isRecording) return;

    // 二次確認彈窗（「確定要結束紀錄並儲存路線嗎？」）
    if (!confirm("確定要結束紀錄並儲存路線嗎？\n\n(按「取消」可返回地圖繼續錄製)")) {
        return;
    }

    // 當有效軌跡點不足 2 點（例如靜止測試 0.00 km）時，直接停止錄製狀態、安全釋放 WakeLock 並彈出明確提示
    if (routePoints.length < 2) {
        isRecording = false;
        activeRecordingGpsHandler = null;
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        if (timerInterval !== null) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        try {
            if (wakeLock) {
                await wakeLock.release();
                wakeLock = null;
            }
        } catch (err) {
            wakeLock = null;
        }
        await releaseScreenWakeLockIfIdle(true);

        clearDomMarkers();
        updateRouteLayers([]);
        document.getElementById('distanceText').innerText = '0.00';
        document.getElementById('timeText').innerText = '00:00:00';
        document.getElementById('speedText').innerText = '0.0';

        restoreIdleRecordingUILayout();
        showNavAlert('移動距離過短（不足 2 個軌跡點），已取消本次紀錄');
        startIdleGPS();
        return;
    }

    isRecording = false;
    activeRecordingGpsHandler = null;
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    try {
        if (wakeLock) {
            await wakeLock.release();
            wakeLock = null;
        }
    } catch (err) {
        wakeLock = null;
    }
    await releaseScreenWakeLockIfIdle(true);

    restoreIdleRecordingUILayout();

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
            routeVersion: 1, updatedAt: nowId,
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
    startIdleGPS();
}

// 綁定左欄「⏹️ 停止紀錄並儲存」按鈕：長按 1 秒（顯示進度填充動畫）＋跳出二次確認彈窗雙重防誤觸保護
(function setupStopRecordLongPressProtection() {
    if (!stopRecordBtn) return;
    let holdTimer = null;
    let holdTriggered = false;
    let isPressing = false;

    function resetHoldVisual(customHint) {
        if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
        }
        isPressing = false;
        if (stopRecordProgressFill) {
            stopRecordProgressFill.style.transition = 'width 120ms ease-out';
            stopRecordProgressFill.style.width = '0%';
        }
        if (stopRecordSubHint) {
            stopRecordSubHint.innerText = customHint || '長按 1 秒防誤觸';
        }
    }

    function startHold(e) {
        if (!isRecording) return;
        if (e.type === 'mousedown' && e.button !== 0) return;
        isPressing = true;
        holdTriggered = false;
        if (holdTimer) clearTimeout(holdTimer);

        if (stopRecordSubHint) {
            stopRecordSubHint.innerText = '⏳ 按住滿 1 秒停止...';
        }
        if (stopRecordProgressFill) {
            stopRecordProgressFill.style.transition = 'none';
            stopRecordProgressFill.style.width = '0%';
            void stopRecordProgressFill.offsetWidth;
            stopRecordProgressFill.style.transition = 'width 1000ms linear';
            stopRecordProgressFill.style.width = '100%';
        }

        holdTimer = setTimeout(() => {
            if (!isPressing || !isRecording) return;
            holdTriggered = true;
            vibrate([45, 30, 45]);
            resetHoldVisual('長按 1 秒防誤觸');
            stopAndSaveActiveRecording();
        }, 1000);
    }

    function endHold(e) {
        if (!isPressing) return;
        const wasTriggered = holdTriggered;
        resetHoldVisual(wasTriggered ? '長按 1 秒防誤觸' : '⚠️ 請按住滿 1 秒');
        if (!wasTriggered && isRecording) {
            vibrate(15);
            showNavAlert('🛡️', '防誤觸保護：請按住左側「停止紀錄」滿 1 秒以結束錄製', 'bg-rose-600');
            setTimeout(() => {
                if (stopRecordSubHint && isRecording && !isPressing) {
                    stopRecordSubHint.innerText = '長按 1 秒防誤觸';
                }
            }, 1800);
        }
    }

    stopRecordBtn.addEventListener('touchstart', startHold, { passive: true });
    stopRecordBtn.addEventListener('touchend', endHold, { passive: true });
    stopRecordBtn.addEventListener('touchcancel', () => resetHoldVisual('長按 1 秒防誤觸'), { passive: true });
    stopRecordBtn.addEventListener('mousedown', startHold);
    stopRecordBtn.addEventListener('mouseup', endHold);
    stopRecordBtn.addEventListener('mouseleave', () => {
        if (isPressing && !holdTriggered) resetHoldVisual('長按 1 秒防誤觸');
    });
})();

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

        document.getElementById('idleTopRow')?.classList.add('hidden');
        document.getElementById('idleActionRow')?.classList.add('hidden');
        document.getElementById('recordingTopRow')?.classList.remove('hidden');
        if (stopRecordProgressFill) {
            stopRecordProgressFill.style.transition = 'none';
            stopRecordProgressFill.style.width = '0%';
        }
        if (stopRecordSubHint) {
            stopRecordSubHint.innerText = '長按 1 秒防誤觸';
        }
        document.getElementById('appStatusTitle').innerText = '路線紀錄中...';
        setCameraFollow(true);

        await requestScreenWakeLock();

        timerInterval = setInterval(() => {
            elapsedSec = Math.floor((Date.now() - startTime) / 1000);
            if (!isPowerSaveMapPaused()) {
                document.getElementById('timeText').innerText = new Date(elapsedSec * 1000).toISOString().substr(11, 8);
            }
        }, 1000);

        activeRecordingGpsHandler = pos => {
            markGpsUpdateReceived();
            const filtered = processFilteredGpsPosition(pos);
            if (!filtered) return; // 剔除 accuracy > 45m 低精度與 > 160km/h 衛星反射瞬移

            const now = Date.now();
            const lng = filtered.lng, lat = filtered.lat;
            const acc = Math.round(filtered.accuracy);
            if (!isPowerSaveMapPaused()) {
                document.getElementById('recAccuracyText').innerText = `± ${acc} m`;
                document.getElementById('speedText').innerText = filtered.isStationary ? '0.0' : filtered.speedKmh.toFixed(1);
            }

            if (typeof window.onFleetPositionUpdate === 'function') {
                window.onFleetPositionUpdate(lat, lng);
            }

            if (routePoints.length === 0) {
                if (typeof filtered.heading === 'number' && !isNaN(filtered.heading)) {
                    currentHeading = filtered.heading;
                }
                lastKnownLngLat = [lng, lat];
                vehicleVisualLngLat = [lng, lat];
                vehicleVisualHeading = currentHeading;
                routePoints.push({ lng, lat, time: now, musicActive, music: musicActive, bearing: currentHeading });
                addPinMarker([lng, lat], '<div class="pin-s"><span>S</span></div>');
                if (!isPowerSaveMapPaused()) {
                    if (vehicleMarker) vehicleMarker.setLngLat([lng, lat]);
                    window.syncCarHeading?.(currentHeading, map ? map.getBearing() : 0);
                }
                lastRecordTime = now;
                return;
            }

            // 停車防抖動鎖定：靜止狀態下凍結位置與車頭朝向更新
            if (filtered.isStationary) return;

            const prev = routePoints[routePoints.length - 1];
            const distKm = getDistanceKm(prev.lng, prev.lat, lng, lat);
            const distM = distKm * 1000;

            if (distM >= minMoveMeters || (now - lastRecordTime >= gpsFreqMs && distM >= 1.5)) {
                const minLockSpeed = Number(systemNavConfig.minLockSpeedKmh) || DEFAULT_SYSTEM_CONFIG.minLockSpeedKmh;
                // 有實際移動時計算兩點方位角，同步更新 currentHeading 與 vehicleVisualHeading
                if (distM >= 2 && (filtered.speedKmh >= minLockSpeed || distM >= 4)) {
                    currentHeading = getBearing(prev.lng, prev.lat, lng, lat);
                } else if (typeof filtered.heading === 'number' && !isNaN(filtered.heading)) {
                    currentHeading = filtered.heading;
                }
                vehicleVisualHeading = currentHeading;
                totalDistanceKm += distKm;
                lastKnownLngLat = [lng, lat];
                routePoints.push({ lng, lat, time: now, musicActive, music: musicActive, bearing: currentHeading });

                if (!isPowerSaveMapPaused()) {
                    document.getElementById('distanceText').innerText = totalDistanceKm.toFixed(2);
                    if (vehicleMarker) smoothMoveVehicleMarker([lng, lat], currentHeading, 750);
                    window.syncCarHeading?.(currentHeading, map ? map.getBearing() : 0);
                    updateRouteLayers(routePoints, 250);

                    if (isFollowingCamera) {
                        const targetZoom = getDynamicZoomBySpeed(filtered.speedKmh);
                        map.easeTo({
                            center: [lng, lat],
                            zoom: targetZoom,
                            bearing: isHeadingUpMode ? currentHeading : map.getBearing(),
                            offset: [0, 100],
                            duration: 600
                        });
                    }
                }
                lastRecordTime = now;
            }
        };

        watchId = navigator.geolocation.watchPosition(
            activeRecordingGpsHandler,
            () => {},
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );

    } else {
        await stopAndSaveActiveRecording();
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
    if (!list) return;
    list.innerHTML = '';

    // 每次讀取並渲染「鶯歌清運路線庫」本機清單時，自動執行去重過濾並寫回儲存空間清除重複殘留
    if (typeof deduplicateSavedRoutes === 'function') {
        deduplicateSavedRoutes(true);
    }

    if (typeof syncRouteUpdateBadgesAndAllBar === 'function') {
        syncRouteUpdateBadgesAndAllBar(false);
    }

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
        const updateInfo = (typeof getCloudRouteUpdateInfo === 'function')
            ? getCloudRouteUpdateInfo(r)
            : { hasUpdate: false, localVer: getRouteVersion(r) };

        const card = document.createElement('div');
        card.className = updateInfo.hasUpdate
            ? "route-lib-card route-lib-card-has-update bg-gradient-to-r from-white to-orange-50/50 p-2.5 rounded-2xl shadow-md border-2 border-orange-300 flex items-stretch gap-2 active:scale-[0.99] transition-transform"
            : "route-lib-card bg-white p-2.5 rounded-2xl shadow-sm border border-gray-100 flex items-stretch gap-2 active:scale-[0.99] transition-transform";

        const authorTag = r.author
            ? `<span class="route-lib-author-badge bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap"><i class="fa-solid fa-user-ninja mr-1"></i>${r.author}</span>`
            : '';

        const versionBadgeHtml = updateInfo.hasUpdate
            ? `<span class="bg-gradient-to-r from-orange-500 to-red-600 text-white text-[10px] px-2 py-0.5 rounded-full font-black whitespace-nowrap shadow-sm animate-pulse">v${updateInfo.localVer} ➔ v${updateInfo.cloudVer} 有新版</span>`
            : `<span class="route-lib-ver-badge bg-gray-100 text-gray-600 text-[10px] px-1.5 py-0.5 rounded-md font-extrabold whitespace-nowrap">v${updateInfo.localVer}</span>`;

        const cloudTimeHtml = updateInfo.hasUpdate
            ? `<div class="text-[11px] font-extrabold text-orange-600 mt-0.5">☁️ 最新版更新於：${updateInfo.updateTimeText}</div>`
            : `<div class="route-lib-date text-xs text-gray-400 mt-0.5 mb-1">${r.date || ''}</div>`;

        card.innerHTML = `
            <div class="drag-handle text-gray-300 w-7 flex items-center justify-center cursor-grab active:cursor-grabbing hover:text-blue-500 flex-shrink-0" title="長按 0.5 秒解鎖拖曳排序">
                <i class="fa-solid fa-grip-vertical text-xl"></i>
            </div>
            <div class="route-card-info flex-1 min-w-0 py-1 cursor-pointer">
                <div class="route-lib-title font-black text-gray-900 text-base flex items-center gap-1.5 flex-wrap">
                    <span class="truncate max-w-full">${r.name}</span>
                    ${versionBadgeHtml}
                    ${authorTag}
                </div>
                ${cloudTimeHtml}
                <div class="route-lib-stats flex gap-3 text-[11px] font-bold mt-1">
                    <span class="route-lib-stat-dist text-blue-600"><i class="fa-solid fa-route mr-1"></i>${r.distance} km</span>
                    <span class="route-lib-stat-events text-green-600"><i class="fa-solid fa-music mr-1"></i>${(r.events||[]).length} 處標記</span>
                </div>
            </div>
            <div class="flex flex-col justify-between items-end py-0.5 gap-1.5 flex-shrink-0">
                <div class="flex items-center gap-1">
                    ${(typeof canCurrentUserManageRoutes === 'function' && canCurrentUserManageRoutes())
                        ? `<button class="edit-name-btn text-gray-300 hover:text-amber-500 w-7 h-7 flex items-center justify-center rounded-xl active:bg-gray-50 transition-colors" title="更改名稱"><i class="fa-solid fa-pen text-xs"></i></button>`
                        : ''}
                </div>
                <div class="flex flex-col items-end gap-1">
                    ${updateInfo.hasUpdate ? `
                    <button type="button" class="update-from-cloud-btn bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white px-2.5 py-1.5 rounded-xl text-[11px] font-black shadow-md flex items-center gap-1 active:scale-95 transition-all whitespace-nowrap" title="立即覆蓋更新為雲端最新版">
                        🔄 更新路線
                    </button>` : ''}
                    <button type="button" class="upload-cloud-btn bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 px-2.5 py-1 rounded-xl text-[11px] font-extrabold flex items-center gap-1 active:scale-95 transition-all whitespace-nowrap" title="上傳分享至車隊雲端">
                        ⬆️ 上傳至雲端
                    </button>
                </div>
            </div>
        `;

        card.querySelector('.route-card-info').onclick = () => window.openRouteDetail(originalIdx);
        const editNameBtn = card.querySelector('.edit-name-btn');
        if (editNameBtn) {
            editNameBtn.onclick = (e) => {
                e.stopPropagation();
                if (typeof canCurrentUserManageRoutes === 'function' && !canCurrentUserManageRoutes()) return;
                const newName = prompt('請輸入新的路線名稱：', r.name);
                if (newName && newName.trim() !== '') {
                    savedRoutes[originalIdx].name = newName.trim();
                    savedRoutes[originalIdx].updatedAt = Date.now();
                    localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => renderHistoryList());
                }
            };
        }
        const updateCloudBtn = card.querySelector('.update-from-cloud-btn');
        if (updateCloudBtn && updateInfo.hasUpdate && updateInfo.cloudRoute) {
            updateCloudBtn.onclick = (e) => {
                e.stopPropagation();
                applySingleCloudRouteUpdate(originalIdx, updateInfo.cloudRoute);
            };
        }
        const uploadBtn = card.querySelector('.upload-cloud-btn');
        uploadBtn.onclick = (e) => {
            e.stopPropagation();
            uploadRouteToCloud(originalIdx, uploadBtn);
        };
        list.appendChild(card);
    });

    if (window.sortableInstance) window.sortableInstance.destroy();
    window.sortableInstance = new Sortable(list, {
        handle: '.drag-handle',
        delay: 500, // 必須按住左側 ⋮⋮ 六點抓手滿 0.5 秒才正式解除鎖定進入拖曳排序
        delayOnTouchOnly: false,
        touchStartThreshold: 8, // 期間手指上下移動超過 8px 立即取消計時並改為正常捲動列表
        animation: 200,
        ghostClass: 'opacity-50',
        chosenClass: 'route-card-drag-unlocked',
        onChoose: function (evt) {
            try { vibrate(35); } catch (e) {}
            if (evt.item) evt.item.classList.add('route-card-drag-unlocked');
        },
        onUnchoose: function (evt) {
            if (evt.item) evt.item.classList.remove('route-card-drag-unlocked');
        },
        onEnd: function (evt) {
            if (evt.item) evt.item.classList.remove('route-card-drag-unlocked');
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

document.getElementById('historyBtn').onclick = () => {
    renderHistoryList();
    historyModal.classList.remove('hidden');
    if (typeof checkCloudRouteUpdatesInBackground === 'function') {
        checkCloudRouteUpdatesInBackground(false);
    }
};
document.getElementById('closeHistory').onclick = (e) => { 
    e.stopPropagation(); historyModal.classList.add('hidden'); backToMain(); 
};

function renderRouteMarkers(route) {
    clearDomMarkers();
    const pts = route.points;
    if (!pts || pts.length === 0) return;
    addPinMarker([pts[0].lng, pts[0].lat], '<div class="pin-s"><span>S</span></div>');
    addPinMarker([pts[pts.length-1].lng, pts[pts.length-1].lat], '<div class="pin-e"><span>E</span></div>');
    
    (route.events || []).forEach((ev, idx) => {
        if (ev.type === 'on') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-on-pin"><i class="fa-solid fa-music"></i> 開</div>`);
        } else if (ev.type === 'off') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-off-pin"><i class="fa-solid fa-volume-xmark"></i> 關</div>`);
        } else if (ev.type === 'alert') {
            createCompactAlertPinMarker(route, ev, idx);
        }
    });

    (route.points || []).forEach(p => {
        if (p.is_stop) addPinMarker([p.lng, p.lat], `<div class="music-marker bg-indigo-600 border border-white shadow-lg"><i class="fa-regular fa-clock"></i> ${p.scheduled_time || ''}</div>`);
    });

    renderRouteCallouts(route, false);
}

function openRouteDetail(idx, skipFitBounds = false) {
    selectedRouteIdx = idx; const route = savedRoutes[idx];
    if (!route) return;
    historyModal.classList.add('hidden');
    document.getElementById('mainUI').classList.add('hidden');
    document.getElementById('playbackUI').classList.add('hidden');
    document.getElementById('routeDetailUI').classList.remove('hidden');
    document.getElementById('topBackBtn').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = '路線預覽';

    // 依本機 Device ID 路線管理員／開發者授權狀態動態顯示或隱藏「編輯」與「刪除」按鈕
    const hasRouteManageAuth = typeof canCurrentUserManageRoutes === 'function' ? canCurrentUserManageRoutes() : false;
    document.getElementById('editRouteBtn')?.classList.toggle('hidden', !hasRouteManageAuth);
    document.getElementById('deleteRouteBtn')?.classList.toggle('hidden', !hasRouteManageAuth);

    const curVer = getRouteVersion(route);
    document.getElementById('detailTitle').innerText = `${route.name} (v${curVer})`;
    document.getElementById('detailDate').innerText = `更新於 ${route.date} · 創作者：${route.author || '隊員'}`;
    document.getElementById('detailDist').innerText = `${route.distance} km`;
    document.getElementById('detailTime').innerText = route.timeStr;
    document.getElementById('detailEvents').innerText = `${(route.events || []).length} 處`;

    map.getSource('bg-route')?.setData(emptyGeoJSON());
    updateRouteLayers(route.points);
    renderRouteMarkers(route);

    if (!skipFitBounds) {
        const bounds = new maplibregl.LngLatBounds();
        route.points.forEach(p => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: { top: 80, bottom: 260, left: 50, right: 50 }, bearing: 0, duration: 500 });
    }
}
window.openRouteDetail = openRouteDetail;

const deleteRouteBtnEl = document.getElementById('deleteRouteBtn');
if (deleteRouteBtnEl) {
    const handleDeleteLocalRoute = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof canCurrentUserManageRoutes === 'function' && !canCurrentUserManageRoutes()) {
            alert('🔒 目前為唯讀權限，僅限「🛡️ 路線管理員」或「🛠️ 開發者」可刪除路線！');
            return;
        }
        setTimeout(() => {
            if (confirm('確定要刪除這條清運路線嗎？')) {
                savedRoutes.splice(selectedRouteIdx, 1);
                persistSavedRoutesToStorage();

                document.getElementById('routeDetailUI').classList.add('hidden');
                document.getElementById('topBackBtn').classList.add('hidden');
                clearDomMarkers();
                updateRouteLayers([]);
                map.getSource('bg-route')?.setData(emptyGeoJSON());

                renderHistoryList();
                document.getElementById('historyModal').classList.remove('hidden');
            }
        }, 100);
    };
    deleteRouteBtnEl.onclick = handleDeleteLocalRoute;
    deleteRouteBtnEl.ontouchend = handleDeleteLocalRoute;
}

// ==========================================
// 🛠️ 統一版路線編輯引擎（拖曳微調 ＋ 虛擬中點 ＋ 節點修剪 ＋ 手繪延伸/剪接 ＋ 引線備忘框 ＋ 10步Undo）
// ==========================================
let isEditingMode = false, originalEventsBackup = [], originalPointsBackup = [], originalCalloutsBackup = [];
let editStep = 0, editStartIndex = -1, tempMarkerA = null;
let editSubMode = 'path', pathEditMarkers = [];
let selectedEditNodeIdx = -1;

// 📌 引線備忘框（Callout Annotation）暫存狀態
let pendingCalloutAnchorLngLat = null;
let pendingCalloutAnchorMarker = null;

const CALLOUT_STYLE_THEMES = [
    { id: 'yellow-black', label: '黃底黑字', lineColor: '#d97706' },
    { id: 'red-white', label: '紅框白底', lineColor: '#dc2626' },
    { id: 'blue-white', label: '藍框白底', lineColor: '#2563eb' }
];

function getCalloutThemeConfig(styleId) {
    return CALLOUT_STYLE_THEMES.find(t => t.id === styleId) || CALLOUT_STYLE_THEMES[0];
}

function clearPendingCalloutAnchor() {
    pendingCalloutAnchorLngLat = null;
    if (pendingCalloutAnchorMarker) {
        try { pendingCalloutAnchorMarker.remove(); } catch (e) {}
        pendingCalloutAnchorMarker = null;
    }
}

function updateCalloutLeaderLines(route) {
    const callouts = Array.isArray(route?.callouts) ? route.callouts : [];
    const features = [];
    callouts.forEach(item => {
        if (
            !item ||
            !Array.isArray(item.anchorLngLat) || item.anchorLngLat.length < 2 ||
            !Array.isArray(item.boxLngLat) || item.boxLngLat.length < 2
        ) {
            return;
        }
        const aLng = Number(item.anchorLngLat[0]);
        const aLat = Number(item.anchorLngLat[1]);
        const bLng = Number(item.boxLngLat[0]);
        const bLat = Number(item.boxLngLat[1]);
        if (isNaN(aLng) || isNaN(aLat) || isNaN(bLng) || isNaN(bLat)) return;

        const theme = getCalloutThemeConfig(item.style);
        features.push({
            type: 'Feature',
            properties: {
                id: item.id || '',
                color: theme.lineColor
            },
            geometry: {
                type: 'LineString',
                coordinates: [
                    [aLng, aLat],
                    [bLng, bLat]
                ]
            }
        });
    });

    cachedCalloutLinesGeoJSON = {
        type: 'FeatureCollection',
        features
    };
    if (!map) return;
    try {
        ensureCustomRouteSourcesAndLayers();
        const src = map.getSource('callout-lines-source');
        if (src && typeof src.setData === 'function') {
            src.setData(cachedCalloutLinesGeoJSON);
        }
    } catch (e) {}
}

// 渲染路線的所有「📌 引線備忘框」（editable = true 為編輯模式可自由拖移/縮放/編輯/刪除；editable = false 為導航/重播/預覽唯讀鎖定模式）
function renderRouteCallouts(route, editable = false, autoFocusCalloutId = null) {
    if (!route) {
        updateCalloutLeaderLines(null);
        return;
    }
    if (!Array.isArray(route.callouts)) {
        route.callouts = [];
    }
    updateCalloutLeaderLines(route);

    route.callouts.forEach((callout, cIdx) => {
        if (
            !callout ||
            !Array.isArray(callout.anchorLngLat) || callout.anchorLngLat.length < 2 ||
            !Array.isArray(callout.boxLngLat) || callout.boxLngLat.length < 2
        ) {
            return;
        }

        const theme = getCalloutThemeConfig(callout.style);
        const boxW = Math.min(Math.max(Number(callout.width) || 156, 105), 340);
        const boxH = Math.min(Math.max(Number(callout.height) || 84, 52), 260);
        callout.width = boxW;
        callout.height = boxH;
        callout.style = theme.id;

        // 1. 錨點圓點 Marker（外層 .callout-anchor-marker 禁止設 transform）
        const anchorWrapEl = document.createElement('div');
        anchorWrapEl.className = 'callout-anchor-marker';
        const anchorDotEl = document.createElement('div');
        anchorDotEl.className = `callout-anchor-dot theme-${theme.id} ${editable ? 'is-editable' : ''}`;
        anchorDotEl.title = editable ? '按住可拖曳調整引線錨點位置' : '';
        anchorWrapEl.appendChild(anchorDotEl);

        const anchorMarker = new maplibregl.Marker({
            element: anchorWrapEl,
            anchor: 'center',
            draggable: Boolean(editable),
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        })
            .setLngLat([Number(callout.anchorLngLat[0]), Number(callout.anchorLngLat[1])])
            .addTo(map);

        if (editable) {
            anchorWrapEl.addEventListener('click', (ev) => ev.stopPropagation());
            anchorMarker.on('dragstart', () => {
                pushEditUndoSnapshot(route);
            });
            anchorMarker.on('drag', () => {
                const pos = anchorMarker.getLngLat();
                callout.anchorLngLat = [Number(pos.lng.toFixed(6)), Number(pos.lat.toFixed(6))];
                updateCalloutLeaderLines(route);
            });
            anchorMarker.on('dragend', () => {
                const pos = anchorMarker.getLngLat();
                callout.anchorLngLat = [Number(pos.lng.toFixed(6)), Number(pos.lat.toFixed(6))];
                updateCalloutLeaderLines(route);
            });
        }
        domMarkers.push(anchorMarker);

        // 2. 文字框本體 Marker（外層 .callout-box-marker 禁止設 transform）
        const boxMarkerEl = document.createElement('div');
        boxMarkerEl.className = 'callout-box-marker';
        if (!editable) {
            // 導航與重播模式下鎖定不可誤觸拖動，同時允許手指直接在上方滑動地圖
            boxMarkerEl.style.pointerEvents = 'none';
        }

        const cardEl = document.createElement('div');
        cardEl.className = `callout-box-card theme-${theme.id}`;
        cardEl.style.width = `${boxW}px`;
        cardEl.style.height = `${boxH}px`;

        if (editable) {
            boxMarkerEl.addEventListener('click', (ev) => ev.stopPropagation());

            // 頂部拖曳與樣式工具列（✥ 引線備忘）
            const headerEl = document.createElement('div');
            headerEl.className = 'callout-box-header';
            headerEl.title = '按住此處（或外框邊緣）拖曳移動文字框位置';

            const dragLabel = document.createElement('span');
            dragLabel.className = 'flex items-center gap-1 truncate select-none';
            dragLabel.innerHTML = '<span class="text-xs leading-none">✥</span><span>引線備忘</span>';

            const btnGroup = document.createElement('div');
            btnGroup.className = 'flex items-center gap-1 flex-shrink-0';

            // 樣式切換按鈕（黃底黑字 ➔ 紅框白底 ➔ 藍框白底）
            const styleBtn = document.createElement('button');
            styleBtn.type = 'button';
            styleBtn.className = 'px-1.5 py-0.5 rounded bg-black/10 hover:bg-black/20 text-[10px] font-black leading-none active:scale-90 transition-transform';
            styleBtn.textContent = theme.label;
            styleBtn.title = '切換框線與底色樣式（黃底黑字／紅框白底／藍框白底）';
            ['pointerdown', 'mousedown', 'touchstart'].forEach(evtName => {
                styleBtn.addEventListener(evtName, (ev) => ev.stopPropagation(), { passive: true });
            });
            styleBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                pushEditUndoSnapshot(route);
                const curIdx = CALLOUT_STYLE_THEMES.findIndex(t => t.id === callout.style);
                const nextTheme = CALLOUT_STYLE_THEMES[(curIdx + 1) % CALLOUT_STYLE_THEMES.length];
                callout.style = nextTheme.id;
                cardEl.className = `callout-box-card theme-${nextTheme.id}`;
                anchorDotEl.className = `callout-anchor-dot theme-${nextTheme.id} is-editable`;
                styleBtn.textContent = nextTheme.label;
                updateCalloutLeaderLines(route);
            });

            // 右上角刪除按鈕
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'w-4 h-4 rounded-full bg-red-600 hover:bg-red-700 text-white text-[10px] font-black flex items-center justify-center leading-none active:scale-90';
            delBtn.innerHTML = '✕';
            delBtn.title = '刪除此引線備忘框';
            ['pointerdown', 'mousedown', 'touchstart'].forEach(evtName => {
                delBtn.addEventListener(evtName, (ev) => ev.stopPropagation(), { passive: true });
            });
            delBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                pushEditUndoSnapshot(route);
                route.callouts.splice(cIdx, 1);
                vibrate(25);
                renderEditableRouteMarkers(route);
                const promptEl = document.getElementById('editPromptText');
                if (promptEl && editSubMode === 'callout') {
                    promptEl.innerText = '🗑️ 已刪除引線備忘框！可繼續點擊目標地點新增，或按「↩️ 上一步」復原';
                }
            });

            btnGroup.appendChild(styleBtn);
            btnGroup.appendChild(delBtn);
            headerEl.appendChild(dragLabel);
            headerEl.appendChild(btnGroup);
            cardEl.appendChild(headerEl);

            // 多行文字輸入框（解除事件攔截：pointer-events: auto、user-select: text，明確 stopPropagation + focus，絕不呼叫 preventDefault）
            const textareaEl = document.createElement('textarea');
            textareaEl.className = 'callout-box-textarea';
            textareaEl.style.pointerEvents = 'auto';
            textareaEl.style.userSelect = 'text';
            textareaEl.style.webkitUserSelect = 'text';
            textareaEl.placeholder = '輸入多行備忘細節...\n(如：巷窄倒車進入)';
            textareaEl.value = callout.text || '';

            let hasRecordedTextUndo = false;
            const syncTextareaValue = () => {
                if (!hasRecordedTextUndo) {
                    pushEditUndoSnapshot(route);
                    hasRecordedTextUndo = true;
                }
                callout.text = textareaEl.value;
            };

            textareaEl.oninput = syncTextareaValue;
            textareaEl.onchange = syncTextareaValue;
            textareaEl.addEventListener('input', syncTextareaValue);
            textareaEl.addEventListener('change', syncTextareaValue);

            textareaEl.addEventListener('focus', () => {
                hasRecordedTextUndo = false;
                boxMarkerEl.classList.add('is-editing-active');
            });
            textareaEl.addEventListener('blur', () => {
                callout.text = textareaEl.value;
                boxMarkerEl.classList.remove('is-editing-active');
            });

            // 點擊或觸控 <textarea> 時明確執行 e.stopPropagation() 與 textareaEl.focus()，絕不呼叫 e.preventDefault()
            const handleTextareaActivate = (ev) => {
                ev.stopPropagation();
                if (document.activeElement !== textareaEl) {
                    try { textareaEl.focus(); } catch (err) {}
                }
            };
            textareaEl.addEventListener('pointerdown', handleTextareaActivate);
            textareaEl.addEventListener('mousedown', handleTextareaActivate);
            textareaEl.addEventListener('touchstart', handleTextareaActivate, { passive: true });
            textareaEl.addEventListener('click', handleTextareaActivate);
            textareaEl.addEventListener('dblclick', (ev) => ev.stopPropagation());
            textareaEl.addEventListener('keydown', (ev) => ev.stopPropagation());
            cardEl.appendChild(textareaEl);

            // 右下角自由縮放手把 (Resize Handle)
            const resizeHandleEl = document.createElement('div');
            resizeHandleEl.className = 'callout-resize-handle';
            resizeHandleEl.title = '按住右下角拖曳調整文字框寬度與高度';
            cardEl.appendChild(resizeHandleEl);

            boxMarkerEl.appendChild(cardEl);

            const boxMarker = new maplibregl.Marker({
                element: boxMarkerEl,
                anchor: 'center',
                draggable: false,
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            })
                .setLngLat([Number(callout.boxLngLat[0]), Number(callout.boxLngLat[1])])
                .addTo(map);

            // --- 限制拖曳觸發區域：僅當按住頂部標題列（✥ 引線備忘）或外框邊緣 (cardEl border) 時才觸發拖曳移動文字框；點擊中間 <textarea> 一律為純文字輸入與選取模式 ---
            const startBoxDrag = (ev) => {
                if (ev.button !== undefined && ev.button !== 0) return;
                const target = ev.target;
                // 若點擊在 <textarea>、按鈕或右下角縮放手把上，一律不觸發拖曳
                if (
                    !target ||
                    target === textareaEl ||
                    textareaEl.contains(target) ||
                    target === resizeHandleEl ||
                    resizeHandleEl.contains(target) ||
                    (target.closest && target.closest('textarea, button, .callout-resize-handle'))
                ) {
                    return;
                }
                // 僅允許頂部標題列 (headerEl) 或外框邊緣 (target === cardEl) 觸發拖曳
                const isHeaderOrBorder = (target === cardEl || target === headerEl || headerEl.contains(target));
                if (!isHeaderOrBorder) return;

                ev.stopPropagation();
                ev.preventDefault();
                pushEditUndoSnapshot(route);
                boxMarkerEl.classList.add('is-editing-active');
                try { map.dragPan.disable(); } catch (err) {}

                const startClientX = ev.clientX;
                const startClientY = ev.clientY;
                const startScreenPt = map.project([Number(callout.boxLngLat[0]), Number(callout.boxLngLat[1])]);

                const onPointerMove = (moveEv) => {
                    const dx = moveEv.clientX - startClientX;
                    const dy = moveEv.clientY - startClientY;
                    const nextLngLat = map.unproject([startScreenPt.x + dx, startScreenPt.y + dy]);
                    callout.boxLngLat = [
                        Number(nextLngLat.lng.toFixed(6)),
                        Number(nextLngLat.lat.toFixed(6))
                    ];
                    boxMarker.setLngLat(callout.boxLngLat);
                    updateCalloutLeaderLines(route);
                };

                const onPointerUp = () => {
                    window.removeEventListener('pointermove', onPointerMove);
                    window.removeEventListener('pointerup', onPointerUp);
                    window.removeEventListener('pointercancel', onPointerUp);
                    boxMarkerEl.classList.remove('is-editing-active');
                    try { map.dragPan.enable(); } catch (err) {}
                    ensureEditorMapZoomEnabled();
                };

                window.addEventListener('pointermove', onPointerMove);
                window.addEventListener('pointerup', onPointerUp);
                window.addEventListener('pointercancel', onPointerUp);
            };

            cardEl.addEventListener('pointerdown', startBoxDrag);

            // --- 拖曳右下角縮放手把 (Resize Handle) 自由調整文字框 width 與 height ---
            resizeHandleEl.addEventListener('pointerdown', (ev) => {
                if (ev.button !== undefined && ev.button !== 0) return;
                ev.stopPropagation();
                ev.preventDefault();
                pushEditUndoSnapshot(route);
                boxMarkerEl.classList.add('is-editing-active');
                try { map.dragPan.disable(); } catch (err) {}

                const startX = ev.clientX;
                const startY = ev.clientY;
                const startW = Number(callout.width) || 156;
                const startH = Number(callout.height) || 84;

                const onResizeMove = (moveEv) => {
                    const nextW = Math.round(Math.min(Math.max(startW + (moveEv.clientX - startX), 105), 340));
                    const nextH = Math.round(Math.min(Math.max(startH + (moveEv.clientY - startY), 52), 260));
                    callout.width = nextW;
                    callout.height = nextH;
                    cardEl.style.width = `${nextW}px`;
                    cardEl.style.height = `${nextH}px`;
                };

                const onResizeUp = () => {
                    window.removeEventListener('pointermove', onResizeMove);
                    window.removeEventListener('pointerup', onResizeUp);
                    window.removeEventListener('pointercancel', onResizeUp);
                    boxMarkerEl.classList.remove('is-editing-active');
                    try { map.dragPan.enable(); } catch (err) {}
                    ensureEditorMapZoomEnabled();
                };

                window.addEventListener('pointermove', onResizeMove);
                window.addEventListener('pointerup', onResizeUp);
                window.addEventListener('pointercancel', onResizeUp);
            });

            domMarkers.push(boxMarker);

            if (autoFocusCalloutId && callout.id === autoFocusCalloutId) {
                setTimeout(() => {
                    try { textareaEl.focus(); } catch (e) {}
                }, 60);
            }
        } else {
            // 導航／重播／預覽唯讀模式（鎖定不可誤觸拖動或縮放）
            const textDiv = document.createElement('div');
            textDiv.className = 'callout-box-readonly-text';
            textDiv.textContent = (callout.text && callout.text.trim()) ? callout.text : '📌 備忘提醒';
            cardEl.appendChild(textDiv);
            boxMarkerEl.appendChild(cardEl);

            const boxMarker = new maplibregl.Marker({
                element: boxMarkerEl,
                anchor: 'center',
                draggable: false,
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            })
                .setLngLat([Number(callout.boxLngLat[0]), Number(callout.boxLngLat[1])])
                .addTo(map);
            domMarkers.push(boxMarker);
        }
    });
}

// 🔍 管理員待審路線「審核預覽／直接微調」專用暫存狀態（不寫入本機 savedRoutes，微調後可直接一鍵核准發布正式版）
let isReviewingPendingMode = false;
let reviewingPendingId = null;
let targetRouteId = null;
let reviewingPendingRoute = null;

function getActiveWorkingRoute() {
    if (isReviewingPendingMode && reviewingPendingRoute) {
        return reviewingPendingRoute;
    }
    return savedRoutes[selectedRouteIdx];
}

// ✍️ 手繪延伸／剪接狀態變數與 10 步復原堆疊
const MAX_EDIT_UNDO_STEPS = 10;
let freehandUndoStack = [];
let isFreehandDrawing = false;
let freehandStartIndex = -1;
let freehandStrokeCoords = [];
let freehandSpliceStartIdx = -1;
let freehandDraftCoords = [];

const modeMarkerBtn = document.getElementById('modeMarkerBtn');
const modePathBtn = document.getElementById('modePathBtn');
const modeFreehandBtn = document.getElementById('modeFreehandBtn');
const modeCalloutBtn = document.getElementById('modeCalloutBtn');
const btnUndoFreehand = document.getElementById('btnUndoFreehand');
const undoStepCountBadge = document.getElementById('undoStepCountBadge');
const editorLiveDistText = document.getElementById('editorLiveDistText');
const editorLiveNodesText = document.getElementById('editorLiveNodesText');
const nodeTrimActionPanel = document.getElementById('nodeTrimActionPanel');
const selectedNodeInfoText = document.getElementById('selectedNodeInfoText');
const btnCloseNodeTrimPanel = document.getElementById('btnCloseNodeTrimPanel');
const btnDeleteSingleNode = document.getElementById('btnDeleteSingleNode');
const btnTrimBeforeNode = document.getElementById('btnTrimBeforeNode');
const btnTrimAfterNode = document.getElementById('btnTrimAfterNode');
const btnEditorZoomIn = document.getElementById('btnEditorZoomIn');
const btnEditorZoomOut = document.getElementById('btnEditorZoomOut');
const btnManualZoomIn = document.getElementById('btnManualZoomIn');
const btnManualZoomOut = document.getElementById('btnManualZoomOut');
const pendingReviewBanner = document.getElementById('pendingReviewBanner');
const pendingReviewRouteTitle = document.getElementById('pendingReviewRouteTitle');
const pendingReviewMetaText = document.getElementById('pendingReviewMetaText');
const btnExitPendingReview = document.getElementById('btnExitPendingReview');
const normalEditActionRow = document.getElementById('normalEditActionRow');
const pendingReviewActionRow = document.getElementById('pendingReviewActionRow');
const btnApproveAndPublishReview = document.getElementById('btnApproveAndPublishReview');
const btnRejectAndDeleteReview = document.getElementById('btnRejectAndDeleteReview');

function ensureEditorMapZoomEnabled() {
    try { map.touchZoomRotate.enable(); } catch (e) {}
    try { map.scrollZoom.enable(); } catch (e) {}
    try { map.doubleClickZoom.enable(); } catch (e) {}
}

if (btnEditorZoomIn) btnEditorZoomIn.onclick = () => { ensureEditorMapZoomEnabled(); map.zoomIn({ duration: 220 }); };
if (btnEditorZoomOut) btnEditorZoomOut.onclick = () => { ensureEditorMapZoomEnabled(); map.zoomOut({ duration: 220 }); };
if (btnManualZoomIn) btnManualZoomIn.onclick = () => { ensureEditorMapZoomEnabled(); map.zoomIn({ duration: 220 }); };
if (btnManualZoomOut) btnManualZoomOut.onclick = () => { ensureEditorMapZoomEnabled(); map.zoomOut({ duration: 220 }); };

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

function cancelActiveFreehandStroke(clearSpliceDraft = false) {
    isFreehandDrawing = false;
    freehandStartIndex = -1;
    freehandStrokeCoords = [];
    if (clearSpliceDraft) {
        freehandSpliceStartIdx = -1;
        freehandDraftCoords = [];
    }
    updateFreehandTempLayer(freehandDraftCoords.length >= 2 ? freehandDraftCoords : []);
    try { map.dragPan.enable(); } catch (e) {}
    ensureEditorMapZoomEnabled();
}

function pushEditUndoSnapshot(route) {
    if (!route || !Array.isArray(route.points)) return;
    freehandUndoStack.push({
        points: JSON.parse(JSON.stringify(route.points)),
        events: JSON.parse(JSON.stringify(route.events || [])),
        callouts: JSON.parse(JSON.stringify(route.callouts || [])),
        selectedEditNodeIdx,
        freehandSpliceStartIdx
    });
    if (freehandUndoStack.length > MAX_EDIT_UNDO_STEPS) {
        freehandUndoStack.shift();
    }
    updateUndoFreehandBtnUI();
}

function updateUndoFreehandBtnUI() {
    if (!btnUndoFreehand) return;
    const count = freehandUndoStack.length;
    btnUndoFreehand.disabled = (count === 0);
    if (undoStepCountBadge) {
        if (count > 0) {
            undoStepCountBadge.textContent = String(count);
            undoStepCountBadge.classList.remove('hidden');
        } else {
            undoStepCountBadge.classList.add('hidden');
        }
    }
}

function updateEditorLiveStatsUI(route) {
    if (!route || !Array.isArray(route.points)) return;
    let totalKm = 0;
    for (let i = 1; i < route.points.length; i++) {
        totalKm += getDistanceKm(
            route.points[i - 1].lng,
            route.points[i - 1].lat,
            route.points[i].lng,
            route.points[i].lat
        );
    }
    route.distance = totalKm.toFixed(2);
    if (editorLiveDistText) editorLiveDistText.textContent = route.distance;
    if (editorLiveNodesText) editorLiveNodesText.textContent = String(route.points.length);
    const detailDistEl = document.getElementById('detailDist');
    if (detailDistEl) detailDistEl.innerText = `${route.distance} km`;
}

let activeNodeTrimBubbleMarker = null;
let activeNodeTrimBubblePlacedBelow = false;
let isNodeTrimDrawerExpanded = false;

function removeActiveNodeTrimBubble() {
    if (activeNodeTrimBubbleMarker) {
        try { activeNodeTrimBubbleMarker.remove(); } catch (e) {}
        activeNodeTrimBubbleMarker = null;
    }
}

function updateNodeTrimPanelUI(route) {
    removeActiveNodeTrimBubble();
    if (!isEditingMode || editSubMode !== 'path' || !route || !Array.isArray(route.points) || selectedEditNodeIdx < 0 || selectedEditNodeIdx >= route.points.length) {
        isNodeTrimDrawerExpanded = false;
        return;
    }

    const pt = route.points[selectedEditNodeIdx];
    if (!pt || typeof pt.lng !== 'number' || typeof pt.lat !== 'number') return;

    const visualPts = computeVisualRightOffsetCoords(route.points);
    const vPt = visualPts[selectedEditNodeIdx] || pt;

    // 判斷節點是否靠近螢幕上緣（y < 140px 時自動改為彈出在節點正下方）
    let placeBelow = false;
    try {
        const screenPt = map.project([vPt.lng, vPt.lat]);
        if (screenPt && screenPt.y < 140) {
            placeBelow = true;
        }
    } catch (e) {}
    activeNodeTrimBubblePlacedBelow = placeBelow;

    const wrapperEl = document.createElement('div');
    wrapperEl.className = 'node-trim-bubble-wrapper';

    const arrowEl = document.createElement('div');
    arrowEl.className = placeBelow ? 'node-trim-bubble-arrow-up' : 'node-trim-bubble-arrow-down';

    // 阻止氣泡點擊穿透至底層地圖
    ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown'].forEach(evtName => {
        wrapperEl.addEventListener(evtName, (ev) => ev.stopPropagation());
    });

    if (!isNodeTrimDrawerExpanded) {
        // 1. 預設收合為迷你小膠囊抽屜鈕（例如：✂️ #89 ▸），完全不遮擋周圍路線視野
        const miniBtn = document.createElement('button');
        miniBtn.type = 'button';
        miniBtn.className = 'node-trim-mini-pill';
        miniBtn.title = '點擊展開節點修剪抽屜';
        miniBtn.innerHTML = `<span>✂️ #${selectedEditNodeIdx + 1}</span><span class="text-amber-400 text-[10px] ml-0.5">▸</span>`;
        miniBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            isNodeTrimDrawerExpanded = true;
            vibrate(15);
            const curRoute = getActiveWorkingRoute();
            updateNodeTrimPanelUI(curRoute);
        });

        if (placeBelow) {
            wrapperEl.appendChild(arrowEl);
            wrapperEl.appendChild(miniBtn);
        } else {
            wrapperEl.appendChild(miniBtn);
            wrapperEl.appendChild(arrowEl);
        }
    } else {
        // 2. 點擊小膠囊後才向旁滑開展開完整的修剪抽屜（🗑️ 刪點 ｜ ✂️ 刪前 ｜ ✂️ 刪後 ｜ ◂ 收合）
        const cardEl = document.createElement('div');
        cardEl.className = 'node-trim-bubble-card';
        cardEl.innerHTML = `
            <span class="text-amber-300 font-black text-[11px] px-1.5 select-none">#${selectedEditNodeIdx + 1}</span>
            <span class="text-slate-500 text-[10px] select-none">｜</span>
            <button type="button" data-trim-act="delete" class="text-white hover:text-amber-200 active:scale-95 font-black text-[11px] px-1.5 py-0.5 rounded-full bg-amber-600/85 hover:bg-amber-600 transition-all">🗑️ 刪點</button>
            <span class="text-slate-500 text-[10px] select-none">｜</span>
            <button type="button" data-trim-act="before" class="text-white hover:text-rose-200 active:scale-95 font-black text-[11px] px-1.5 py-0.5 rounded-full bg-rose-600/85 hover:bg-rose-600 transition-all">✂️ 刪前</button>
            <span class="text-slate-500 text-[10px] select-none">｜</span>
            <button type="button" data-trim-act="after" class="text-white hover:text-rose-200 active:scale-95 font-black text-[11px] px-1.5 py-0.5 rounded-full bg-rose-600/85 hover:bg-rose-600 transition-all">✂️ 刪後</button>
            <span class="text-slate-500 text-[10px] select-none">｜</span>
            <button type="button" data-trim-act="collapse" class="text-amber-200 hover:text-white active:scale-95 font-black text-[11px] px-1.5 py-0.5 rounded-full bg-slate-700/90 hover:bg-slate-600 flex items-center justify-center transition-all" title="收合回迷你小膠囊">◂ 收合</button>
        `;

        if (placeBelow) {
            wrapperEl.appendChild(arrowEl);
            wrapperEl.appendChild(cardEl);
        } else {
            wrapperEl.appendChild(cardEl);
            wrapperEl.appendChild(arrowEl);
        }

        cardEl.querySelector('[data-trim-act="delete"]')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            isNodeTrimDrawerExpanded = false;
            executeDeleteSingleSelectedNode();
        });
        cardEl.querySelector('[data-trim-act="before"]')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            isNodeTrimDrawerExpanded = false;
            executeTrimBeforeSelectedNode();
        });
        cardEl.querySelector('[data-trim-act="after"]')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            isNodeTrimDrawerExpanded = false;
            executeTrimAfterSelectedNode();
        });
        cardEl.querySelector('[data-trim-act="collapse"]')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            isNodeTrimDrawerExpanded = false;
            vibrate(10);
            const curRoute = getActiveWorkingRoute();
            updateNodeTrimPanelUI(curRoute);
        });
    }

    activeNodeTrimBubbleMarker = new maplibregl.Marker({
        element: wrapperEl,
        anchor: placeBelow ? 'top' : 'bottom',
        offset: placeBelow ? [0, 12] : [0, -12],
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport'
    })
        .setLngLat([vPt.lng, vPt.lat])
        .addTo(map);
}

// 當鏡頭移動結束後，若選取節點靠近螢幕頂部狀態改變，自動翻轉氣泡上下方向
map.on('moveend', () => {
    if (!activeNodeTrimBubbleMarker || !isEditingMode || editSubMode !== 'path') return;
    const route = getActiveWorkingRoute();
    if (!route || !Array.isArray(route.points) || selectedEditNodeIdx < 0 || selectedEditNodeIdx >= route.points.length) return;
    const pt = route.points[selectedEditNodeIdx];
    if (!pt) return;
    try {
        const screenPt = map.project([pt.lng, pt.lat]);
        const shouldPlaceBelow = Boolean(screenPt && screenPt.y < 140);
        if (shouldPlaceBelow !== activeNodeTrimBubblePlacedBelow) {
            updateNodeTrimPanelUI(route);
        }
    } catch (e) {}
});

// 重新計算路線總距離、每個軌跡點的車頭角 bearing，並重新綁定所有語音標記點與時刻站牌的路徑索引 ptIdx
// 若 dropTrimmedOutliers = true（例如修剪頭尾後），自動剔除距離剩餘路線超過 55 公尺的已裁切區段標記點
function syncRouteMarkersAndIndicesAfterSpline(route, preservedStops = null, dropTrimmedOutliers = false) {
    if (!route || !Array.isArray(route.points) || route.points.length === 0) return;
    const pts = route.points;

    // 若未傳入 preservedStops，自動由現有 points 收集
    const stopsToRestore = Array.isArray(preservedStops)
        ? preservedStops
        : pts.filter(p => p.is_stop).map(p => ({
            lng: p.lng,
            lat: p.lat,
            stop_name: p.stop_name,
            scheduled_time: p.scheduled_time
        }));

    // 1. 重新計算每個點的 bearing、遞增時間戳記與總距離 (km)
    let curTime = pts[0].time || Date.now();
    let totalDistKm = 0;
    for (let i = 0; i < pts.length; i++) {
        const isMusic = Boolean(pts[i].musicActive);
        pts[i].musicActive = isMusic;
        pts[i].music = isMusic;
        if (i > 0) {
            const prev = pts[i - 1];
            const dKm = getDistanceKm(prev.lng, prev.lat, pts[i].lng, pts[i].lat);
            totalDistKm += dKm;
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
    route.distance = totalDistKm.toFixed(2);

    // 2. 重新匹配時刻站牌 (is_stop) 至最近的路線節點
    pts.forEach(p => {
        delete p.is_stop;
        delete p.stop_name;
        delete p.scheduled_time;
    });
    if (stopsToRestore.length > 0) {
        stopsToRestore.forEach(st => {
            let minD = Infinity, bestIdx = 0;
            for (let i = 0; i < pts.length; i++) {
                const d = getDistanceKm(st.lng, st.lat, pts[i].lng, pts[i].lat);
                if (d < minD) { minD = d; bestIdx = i; }
            }
            if (dropTrimmedOutliers && minD * 1000 > 55) return;
            pts[bestIdx].is_stop = true;
            pts[bestIdx].stop_name = st.stop_name;
            pts[bestIdx].scheduled_time = st.scheduled_time;
        });
    }

    // 3. 重新匹配黃色提醒點 (alert) 的最近路線點索引，並依新的 musicActive 狀態自動重建 A/B 音樂開關事件與索引
    const updatedAlerts = [];
    (route.events || []).forEach(ev => {
        if (!ev || ev.type !== 'alert') return;
        let minD = Infinity, bestIdx = 0;
        for (let i = 0; i < pts.length; i++) {
            const d = getDistanceKm(ev.lng, ev.lat, pts[i].lng, pts[i].lat);
            if (d < minD) { minD = d; bestIdx = i; }
        }
        if (dropTrimmedOutliers && minD * 1000 > 55) return;
        updatedAlerts.push({
            ...ev,
            ptIdx: bestIdx,
            bearing: pts[bestIdx].bearing || 0
        });
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
    updateEditorLiveStatsUI(route);
}

// 萃取路線上的關鍵轉折節點索引（讓密集的 GPS 軌跡也能清爽顯示可拖曳關鍵點與「+ 虛擬中點」）
function computeRouteKeyNodeIndices(pts) {
    if (!Array.isArray(pts) || pts.length === 0) return [];
    const n = pts.length;
    if (n <= 45) {
        return pts.map((_, i) => i);
    }

    const keySet = new Set([0, n - 1]);
    if (selectedEditNodeIdx >= 0 && selectedEditNodeIdx < n) {
        keySet.add(selectedEditNodeIdx);
    }
    if (freehandSpliceStartIdx >= 0 && freehandSpliceStartIdx < n) {
        keySet.add(freehandSpliceStartIdx);
    }

    const stepStride = Math.max(2, Math.floor(n / 36));
    let lastAddedIdx = 0;

    for (let i = 1; i < n - 1; i++) {
        const p = pts[i];
        if (p.isKeyNode || p.is_stop) {
            keySet.add(i);
            lastAddedIdx = i;
            continue;
        }
        // 轉角變化明顯處自動保留為關鍵節點
        const prev = pts[Math.max(0, i - 2)];
        const next = pts[Math.min(n - 1, i + 2)];
        const b1 = getBearing(prev.lng, prev.lat, p.lng, p.lat);
        const b2 = getBearing(p.lng, p.lat, next.lng, next.lat);
        const angleDiff = getAngleDiff(b1, b2);
        if (angleDiff >= 18 && (i - lastAddedIdx >= 2)) {
            keySet.add(i);
            lastAddedIdx = i;
            continue;
        }
        if (i - lastAddedIdx >= stepStride) {
            keySet.add(i);
            lastAddedIdx = i;
        }
    }

    return Array.from(keySet).sort((a, b) => a - b);
}

// 渲染「🖐️ 拖曳微調」模式的關鍵節點與兩節點間的「+ 虛擬中點」
function renderPathEditNodes(route) {
    clearPathEditMarkers();
    if (!isEditingMode || !route || !Array.isArray(route.points) || route.points.length === 0) return;

    if (editSubMode === 'freehand') {
        renderFreehandSpliceNodes(route);
        return;
    }
    if (editSubMode !== 'path') return;

    const pts = route.points;
    const keyIndices = computeRouteKeyNodeIndices(pts);
    const visualPts = computeVisualRightOffsetCoords(pts);

    // 1. 渲染兩關鍵節點之間的「+ 虛擬中點」（跟隨右側平行偏移後的視覺線條位置，插入時仍寫入真實道路中心線座標）
    for (let k = 0; k < keyIndices.length - 1; k++) {
        const idxA = keyIndices[k];
        const idxB = keyIndices[k + 1];
        const ptA = pts[idxA];
        const ptB = pts[idxB];
        const segDistM = getDistanceKm(ptA.lng, ptA.lat, ptB.lng, ptB.lat) * 1000;
        if (segDistM < 5) continue;

        const midLng = Number(((ptA.lng + ptB.lng) / 2).toFixed(6));
        const midLat = Number(((ptA.lat + ptB.lat) / 2).toFixed(6));

        const vA = visualPts[idxA] || ptA;
        const vB = visualPts[idxB] || ptB;
        const midIdxForVis = Math.floor((idxA + idxB) / 2);
        const vMid = (idxB - idxA > 1 && visualPts[midIdxForVis])
            ? visualPts[midIdxForVis]
            : { lng: Number(((vA.lng + vB.lng) / 2).toFixed(6)), lat: Number(((vA.lat + vB.lat) / 2).toFixed(6)) };

        const midEl = document.createElement('button');
        midEl.type = 'button';
        midEl.title = '點擊插入新轉折點 (+ 虛擬中點)';
        midEl.className = 'w-5 h-5 rounded-full bg-white/95 hover:bg-emerald-50 text-emerald-700 border-2 border-emerald-500 shadow-md flex items-center justify-center font-black text-xs leading-none active:scale-90 transition-transform cursor-pointer z-10';
        midEl.innerHTML = '+';

        midEl.onclick = (ev) => {
            ev.stopPropagation();
            pushEditUndoSnapshot(route);

            const inheritedMusic = Boolean(ptA.musicActive);
            let newSelectedIdx;
            if (idxB - idxA > 1) {
                // 若兩關鍵點之間已有細分點，直接將中位點升級為關鍵轉折點並移至幾何中點
                const midIdx = Math.floor((idxA + idxB) / 2);
                pts[midIdx].lng = midLng;
                pts[midIdx].lat = midLat;
                pts[midIdx].isKeyNode = true;
                newSelectedIdx = midIdx;
            } else {
                const newPt = {
                    lng: midLng,
                    lat: midLat,
                    time: Date.now(),
                    musicActive: inheritedMusic,
                    music: inheritedMusic,
                    bearing: ptA.bearing || 0,
                    isKeyNode: true
                };
                pts.splice(idxA + 1, 0, newPt);
                newSelectedIdx = idxA + 1;
            }

            selectedEditNodeIdx = newSelectedIdx;
            isNodeTrimDrawerExpanded = false;
            syncRouteMarkersAndIndicesAfterSpline(route);
            vibrate(25);
            updateRouteLayers(route.points);
            renderEditableRouteMarkers(route);
            renderPathEditNodes(route);
            updateNodeTrimPanelUI(route);

            const promptEl = document.getElementById('editPromptText');
            if (promptEl) {
                promptEl.innerText = `➕ 已插入新轉折點 #${newSelectedIdx + 1}！可直接按住拖曳調整位置`;
            }
        };

        const midMarker = new maplibregl.Marker({
            element: midEl,
            anchor: 'center',
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        })
            .setLngLat([vMid.lng, vMid.lat])
            .addTo(map);
        pathEditMarkers.push(midMarker);
    }

    // 2. 渲染可拖曳、可點擊修剪的關鍵節點（跟隨右側平行偏移後的視覺位置顯示，拖曳時自動還原扣回偏移量以保存真實道路中心線座標）
    keyIndices.forEach((ptIdx, kPos) => {
        const pt = pts[ptIdx];
        if (!pt) return;
        const vPt = visualPts[ptIdx] || { lng: pt.lng, lat: pt.lat, dLng: 0, dLat: 0 };
        const initDLng = vPt.dLng || 0;
        const initDLat = vPt.dLat || 0;

        const isSelected = (ptIdx === selectedEditNodeIdx);
        const isEndpoint = (ptIdx === 0 || ptIdx === pts.length - 1);

        const prevKeyIdx = kPos > 0 ? keyIndices[kPos - 1] : ptIdx;
        const nextKeyIdx = kPos < keyIndices.length - 1 ? keyIndices[kPos + 1] : ptIdx;

        const el = document.createElement('div');
        if (isSelected) {
            el.className = 'w-6 h-6 bg-amber-300 border-[4px] border-red-600 ring-4 ring-amber-400/60 rounded-full shadow-xl cursor-grab active:cursor-grabbing z-30 flex items-center justify-center';
            el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-red-700"></span>';
        } else if (isEndpoint) {
            el.className = 'w-5 h-5 bg-white border-[5px] border-indigo-600 rounded-full shadow-lg cursor-grab active:cursor-grabbing z-20';
        } else {
            el.className = 'w-5 h-5 bg-white border-[5px] border-emerald-600 hover:border-amber-500 rounded-full shadow-md cursor-grab active:cursor-grabbing z-20';
        }
        el.title = `節點 #${ptIdx + 1}（按住拖曳位置，點擊顯示 ✂️ 迷你修剪小膠囊）`;

        const m = new maplibregl.Marker({
            element: el,
            anchor: 'center',
            draggable: true,
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        })
            .setLngLat([vPt.lng, vPt.lat])
            .addTo(map);
        m._ptIdx = ptIdx;

        m.on('dragstart', () => {
            pushEditUndoSnapshot(route);
            selectedEditNodeIdx = ptIdx;
            // 拖曳時自動收起回迷你小膠囊，確保拖曳微調時視野零遮擋
            isNodeTrimDrawerExpanded = false;
            updateNodeTrimPanelUI(route);
        });

        m.on('drag', () => {
            const lngLat = m.getLngLat();
            // 扣除視覺平行偏移量，確保實際寫入 route.points 的座標維持真實道路座標
            const newLng = Number((lngLat.lng - initDLng).toFixed(6));
            const newLat = Number((lngLat.lat - initDLat).toFixed(6));
            pt.lng = newLng;
            pt.lat = newLat;
            pt.isKeyNode = true;

            // 線性平滑插值相鄰關鍵點之間的細分點，避免拖曳單一節點時留下鋸齒舊軌跡點
            if (ptIdx > prevKeyIdx + 1) {
                const startPt = pts[prevKeyIdx];
                const span = ptIdx - prevKeyIdx;
                for (let s = 1; s < span; s++) {
                    const ratio = s / span;
                    pts[prevKeyIdx + s].lng = Number((startPt.lng + (newLng - startPt.lng) * ratio).toFixed(6));
                    pts[prevKeyIdx + s].lat = Number((startPt.lat + (newLat - startPt.lat) * ratio).toFixed(6));
                }
            }
            if (nextKeyIdx > ptIdx + 1) {
                const endPt = pts[nextKeyIdx];
                const span = nextKeyIdx - ptIdx;
                for (let s = 1; s < span; s++) {
                    const ratio = s / span;
                    pts[ptIdx + s].lng = Number((newLng + (endPt.lng - newLng) * ratio).toFixed(6));
                    pts[ptIdx + s].lat = Number((newLat + (endPt.lat - newLat) * ratio).toFixed(6));
                }
            }

            updateRouteLayers(route.points, 25);
            if (isNodeTrimDrawerExpanded) {
                isNodeTrimDrawerExpanded = false;
                updateNodeTrimPanelUI(route);
            }
            if (activeNodeTrimBubbleMarker && selectedEditNodeIdx === ptIdx) {
                activeNodeTrimBubbleMarker.setLngLat([lngLat.lng, lngLat.lat]);
            }
        });

        m.on('dragend', () => {
            isNodeTrimDrawerExpanded = false;
            syncRouteMarkersAndIndicesAfterSpline(route);
            updateRouteLayers(route.points);
            renderEditableRouteMarkers(route);
            renderPathEditNodes(route);
            updateNodeTrimPanelUI(route);
            const promptEl = document.getElementById('editPromptText');
            if (promptEl) {
                promptEl.innerText = `✅ 已微調節點 #${ptIdx + 1} 位置（總距離 ${route.distance} km）`;
            }
        });

        el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            selectedEditNodeIdx = ptIdx;
            isNodeTrimDrawerExpanded = false; // 點選節點時預設收合為 ✂️ #N ▸ 迷你小膠囊
            vibrate(20);
            renderPathEditNodes(route);
            updateNodeTrimPanelUI(route);
            const promptEl = document.getElementById('editPromptText');
            if (promptEl) {
                promptEl.innerText = `🎯 已選取節點 #${ptIdx + 1}：點擊上方「✂️ #${ptIdx + 1} ▸」可展開修剪抽屜`;
            }
        });

        pathEditMarkers.push(m);
    });
}

// 渲染「✍️ 手繪延伸／剪接」模式下的路線錨點（支援先點選舊節點再畫線/加點連回另一舊節點自動剪除替換，或從頭尾延伸）
function renderFreehandSpliceNodes(route) {
    clearPathEditMarkers();
    if (!isEditingMode || editSubMode !== 'freehand' || !route || !Array.isArray(route.points) || route.points.length === 0) return;

    const pts = route.points;
    const keyIndices = computeRouteKeyNodeIndices(pts);
    const visualPts = computeVisualRightOffsetCoords(pts);

    keyIndices.forEach(ptIdx => {
        const pt = pts[ptIdx];
        if (!pt) return;
        const vPt = visualPts[ptIdx] || pt;
        const isSpliceStart = (ptIdx === freehandSpliceStartIdx);
        const isHead = (ptIdx === 0);
        const isTail = (ptIdx === pts.length - 1);

        const el = document.createElement('div');
        if (isSpliceStart) {
            el.className = 'w-6 h-6 bg-orange-500 text-white border-[3px] border-white ring-4 ring-orange-400/70 rounded-full shadow-xl cursor-pointer z-30 flex items-center justify-center text-[10px] font-black';
            el.innerHTML = '✂️';
        } else if (isHead || isTail) {
            el.className = 'w-5 h-5 bg-amber-400 border-[4px] border-orange-700 rounded-full shadow-lg cursor-pointer z-20';
        } else {
            el.className = 'w-4 h-4 bg-white border-[4px] border-orange-500 hover:border-amber-400 rounded-full shadow cursor-pointer z-20';
        }
        el.title = isSpliceStart
            ? `剪接/延伸起點 #${ptIdx + 1}（請畫線或點選地圖加點，再點擊另一舊節點完成剪接）`
            : `節點 #${ptIdx + 1}（點擊設為手繪剪接/延伸起點，或作為剪接終點）`;

        el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            handleFreehandNodeClick(route, ptIdx);
        });

        const m = new maplibregl.Marker({
            element: el,
            anchor: 'center',
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        })
            .setLngLat([vPt.lng, vPt.lat])
            .addTo(map);
        pathEditMarkers.push(m);
    });
}

// 處理「手繪延伸／剪接」模式下點選舊節點的互動（選取剪接起點 A ➔ 畫線/加點 ➔ 點擊另一舊節點 B 自動剪除舊路徑並替換）
function handleFreehandNodeClick(route, clickedIdx) {
    if (!route || !Array.isArray(route.points)) return;
    const pts = route.points;
    const clickedPt = pts[clickedIdx];
    if (!clickedPt) return;
    const promptEl = document.getElementById('editPromptText');

    // 若已選取起點 A 且已畫出新路徑點 (freehandDraftCoords.length >= 2)，此時點擊另一個舊節點 B ➔ 立即剪除 A 與 B 之間的舊路徑並無縫替換！
    if (freehandSpliceStartIdx !== -1 && freehandSpliceStartIdx !== clickedIdx && freehandDraftCoords.length >= 2) {
        const endCoord = [Number(clickedPt.lng.toFixed(6)), Number(clickedPt.lat.toFixed(6))];
        const fullDraft = [...freehandDraftCoords, endCoord];
        applySpliceBetweenNodes(route, freehandSpliceStartIdx, clickedIdx, fullDraft);
        freehandSpliceStartIdx = -1;
        freehandDraftCoords = [];
        updateFreehandTempLayer([]);
        renderFreehandSpliceNodes(route);
        return;
    }

    // 否則將此舊節點設為新的「延伸／剪接起點」
    freehandSpliceStartIdx = clickedIdx;
    freehandDraftCoords = [[Number(clickedPt.lng.toFixed(6)), Number(clickedPt.lat.toFixed(6))]];
    updateFreehandTempLayer([]);
    vibrate(25);
    renderFreehandSpliceNodes(route);

    const isEndpoint = (clickedIdx === 0 || clickedIdx === pts.length - 1);
    if (promptEl) {
        promptEl.innerText = isEndpoint
            ? `🎯 已選取${clickedIdx === 0 ? '起點 S' : '終點 E'} (#${clickedIdx + 1})！可單指畫線或點擊地圖向外延伸，或連回另一舊節點剪接`
            : `✂️ 已鎖定舊節點 #${clickedIdx + 1}！請單指畫線（或點擊地圖加點）並連回另一個舊節點即可剪除中間舊路徑`;
    }
}

// 執行兩舊節點之間的剪接替換（將 idxA 與 idxB 之間的多餘舊路徑剪除，無縫替換為新畫的路徑）
function applySpliceBetweenNodes(route, startIdx, endIdx, rawCoords) {
    if (!route || !Array.isArray(route.points) || rawCoords.length < 2) return;
    const pts = route.points;
    const preservedStops = pts
        .filter(p => p.is_stop)
        .map(p => ({ lng: p.lng, lat: p.lat, stop_name: p.stop_name, scheduled_time: p.scheduled_time }));

    pushEditUndoSnapshot(route);

    const isForward = (startIdx <= endIdx);
    const idxStart = Math.min(startIdx, endIdx);
    const idxEnd = Math.max(startIdx, endIdx);

    const orderedCoords = isForward ? [...rawCoords] : [...rawCoords].reverse();
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
    const newSegmentPoints = densified.map(([lng, lat], i) => ({
        lng,
        lat,
        time: Date.now(),
        musicActive: inheritedMusic,
        music: inheritedMusic,
        bearing: 0,
        isKeyNode: (i === 0 || i === densified.length - 1)
    }));

    pts.splice(idxStart, idxEnd - idxStart + 1, ...newSegmentPoints);
    syncRouteMarkersAndIndicesAfterSpline(route, preservedStops, true);
    vibrate([40, 30, 40]);
    updateRouteLayers(route.points);
    renderEditableRouteMarkers(route);
    renderFreehandSpliceNodes(route);

    const promptEl = document.getElementById('editPromptText');
    if (promptEl) {
        promptEl.innerText = `✅ 已剪除節點 #${idxStart + 1}～#${idxEnd + 1} 舊路徑並無縫替換為新路線！（總距離 ${route.distance} km）`;
    }
}

// 執行從頭尾端點向外延伸路線
function applyExtendFromEndpoint(route, anchorIdx, rawCoords) {
    if (!route || !Array.isArray(route.points) || rawCoords.length < 2) return;
    const pts = route.points;
    const preservedStops = pts
        .filter(p => p.is_stop)
        .map(p => ({ lng: p.lng, lat: p.lat, stop_name: p.stop_name, scheduled_time: p.scheduled_time }));

    pushEditUndoSnapshot(route);

    const distToHead = anchorIdx;
    const distToTail = (pts.length - 1) - anchorIdx;
    const inheritedMusic = Boolean(pts[anchorIdx]?.musicActive);

    if (distToTail <= distToHead) {
        // 往尾端 (E) 延伸
        const alignedCoords = [...rawCoords];
        alignedCoords[0] = [Number(pts[anchorIdx].lng.toFixed(6)), Number(pts[anchorIdx].lat.toFixed(6))];
        const densified = densifyRoadCoordinates(alignedCoords, 5);
        const newTailPoints = densified.map(([lng, lat], i) => ({
            lng,
            lat,
            time: Date.now(),
            musicActive: inheritedMusic,
            music: inheritedMusic,
            bearing: 0,
            isKeyNode: (i === densified.length - 1)
        }));
        pts.splice(anchorIdx, pts.length - anchorIdx, ...newTailPoints);
        freehandSpliceStartIdx = pts.length - 1;
    } else {
        // 往開頭 (S) 延伸
        const reversedCoords = [...rawCoords].reverse();
        reversedCoords[reversedCoords.length - 1] = [Number(pts[anchorIdx].lng.toFixed(6)), Number(pts[anchorIdx].lat.toFixed(6))];
        const densified = densifyRoadCoordinates(reversedCoords, 5);
        const newHeadPoints = densified.map(([lng, lat], i) => ({
            lng,
            lat,
            time: Date.now(),
            musicActive: inheritedMusic,
            music: inheritedMusic,
            bearing: 0,
            isKeyNode: (i === 0)
        }));
        pts.splice(0, anchorIdx + 1, ...newHeadPoints);
        freehandSpliceStartIdx = 0;
    }

    const newAnchorPt = pts[freehandSpliceStartIdx];
    freehandDraftCoords = newAnchorPt ? [[Number(newAnchorPt.lng.toFixed(6)), Number(newAnchorPt.lat.toFixed(6))]] : [];

    syncRouteMarkersAndIndicesAfterSpline(route, preservedStops, false);
    vibrate([40, 30, 40]);
    updateRouteLayers(route.points);
    renderEditableRouteMarkers(route);
    renderFreehandSpliceNodes(route);

    const promptEl = document.getElementById('editPromptText');
    if (promptEl) {
        promptEl.innerText = `✅ 已延伸路線至 ${route.distance} km！可繼續點擊/畫線延伸，或按「↩️ 上一步」復原`;
    }
}

// ==========================================
// ✂️ 刪除多餘路線（單點刪除 ／ 刪除此點之前 ／ 刪除此點之後 — 供跟隨節點懸浮修剪氣泡呼叫）
// ==========================================
function executeDeleteSingleSelectedNode() {
    const route = getActiveWorkingRoute();
    if (!isEditingMode || !route || !Array.isArray(route.points)) return;
    const pts = route.points;
    if (selectedEditNodeIdx < 0 || selectedEditNodeIdx >= pts.length) return;
    if (pts.length <= 2) {
        alert('⚠️ 路線至少需保留 2 個軌跡點，無法再刪除節點！');
        return;
    }

    pushEditUndoSnapshot(route);

    // 若為密集軌跡中的關鍵轉折點，找出前後相鄰關鍵點並一併抹平該偏移區段；若為一般點則直接移除該點
    const keyIndices = computeRouteKeyNodeIndices(pts);
    const kPos = keyIndices.indexOf(selectedEditNodeIdx);
    const removedNodeNum = selectedEditNodeIdx + 1;

    if (kPos > 0 && kPos < keyIndices.length - 1 && (keyIndices[kPos + 1] - keyIndices[kPos - 1] > 2) && (pts.length > 45)) {
        const prevIdx = keyIndices[kPos - 1];
        const nextIdx = keyIndices[kPos + 1];
        const removeCount = nextIdx - prevIdx - 1;
        if (pts.length - removeCount >= 2) {
            pts.splice(prevIdx + 1, removeCount);
            selectedEditNodeIdx = Math.min(prevIdx, pts.length - 1);
        } else {
            pts.splice(selectedEditNodeIdx, 1);
            selectedEditNodeIdx = Math.min(selectedEditNodeIdx, pts.length - 1);
        }
    } else {
        pts.splice(selectedEditNodeIdx, 1);
        selectedEditNodeIdx = Math.min(selectedEditNodeIdx, pts.length - 1);
    }

    syncRouteMarkersAndIndicesAfterSpline(route, null, true);
    vibrate(35);
    updateRouteLayers(route.points);
    renderEditableRouteMarkers(route);
    renderPathEditNodes(route);
    updateNodeTrimPanelUI(route);

    const promptEl = document.getElementById('editPromptText');
    if (promptEl) {
        promptEl.innerText = `🗑️ 已刪除偏移節點 #${removedNodeNum}（目前總距離 ${route.distance} km）`;
    }
}

function executeTrimBeforeSelectedNode() {
    const route = getActiveWorkingRoute();
    if (!isEditingMode || !route || !Array.isArray(route.points)) return;
    const pts = route.points;
    if (selectedEditNodeIdx < 0 || selectedEditNodeIdx >= pts.length) return;

    if (selectedEditNodeIdx === 0) {
        alert('ℹ️ 目前選取的已經是路線「起點 (S)」，前方沒有多餘路線可刪除！');
        return;
    }
    if (pts.length - selectedEditNodeIdx < 2) {
        alert('⚠️ 修剪後路線至少需保留 2 個軌跡點！請選擇更前面的節點。');
        return;
    }

    const cutCount = selectedEditNodeIdx;
    pushEditUndoSnapshot(route);

    pts.splice(0, cutCount);
    pts[0].isKeyNode = true;
    selectedEditNodeIdx = 0;

    syncRouteMarkersAndIndicesAfterSpline(route, null, true);
    vibrate([40, 30, 40]);
    updateRouteLayers(route.points);
    renderEditableRouteMarkers(route);
    renderPathEditNodes(route);
    updateNodeTrimPanelUI(route);

    const promptEl = document.getElementById('editPromptText');
    if (promptEl) {
        promptEl.innerText = `✂️ 已修剪開頭多餘路線（刪除前 ${cutCount} 點，新總距離 ${route.distance} km）`;
    }
}

function executeTrimAfterSelectedNode() {
    const route = getActiveWorkingRoute();
    if (!isEditingMode || !route || !Array.isArray(route.points)) return;
    const pts = route.points;
    if (selectedEditNodeIdx < 0 || selectedEditNodeIdx >= pts.length) return;

    if (selectedEditNodeIdx === pts.length - 1) {
        alert('ℹ️ 目前選取的已經是路線「終點 (E)」，後方沒有多餘路線可刪除！');
        return;
    }
    if (selectedEditNodeIdx < 1) {
        alert('⚠️ 修剪後路線至少需保留 2 個軌跡點！請選擇更後面的節點。');
        return;
    }

    const cutCount = (pts.length - 1) - selectedEditNodeIdx;
    pushEditUndoSnapshot(route);

    pts.splice(selectedEditNodeIdx + 1, cutCount);
    pts[pts.length - 1].isKeyNode = true;
    selectedEditNodeIdx = pts.length - 1;

    syncRouteMarkersAndIndicesAfterSpline(route, null, true);
    vibrate([40, 30, 40]);
    updateRouteLayers(route.points);
    renderEditableRouteMarkers(route);
    renderPathEditNodes(route);
    updateNodeTrimPanelUI(route);

    const promptEl = document.getElementById('editPromptText');
    if (promptEl) {
        promptEl.innerText = `✂️ 已修剪尾端多餘路線（刪除後 ${cutCount} 點，新總距離 ${route.distance} km）`;
    }
}

if (btnDeleteSingleNode) btnDeleteSingleNode.onclick = executeDeleteSingleSelectedNode;
if (btnTrimBeforeNode) btnTrimBeforeNode.onclick = executeTrimBeforeSelectedNode;
if (btnTrimAfterNode) btnTrimAfterNode.onclick = executeTrimAfterSelectedNode;

function setEditSubMode(mode) {
    editSubMode = mode;
    ensureEditorMapZoomEnabled();
    try { map.dragPan.enable(); } catch (e) {}

    const inactiveClass = "text-gray-600 hover:bg-white/70 font-black text-[11px] px-1 py-1.5 rounded-lg transition-all active:scale-95 whitespace-nowrap flex items-center justify-center";
    if (modePathBtn) modePathBtn.className = (mode === 'path')
        ? "bg-emerald-600 text-white font-black text-[11px] px-1 py-1.5 rounded-lg shadow-sm transition-all active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;
    if (modeFreehandBtn) modeFreehandBtn.className = (mode === 'freehand')
        ? "bg-orange-600 text-white font-black text-[11px] px-1 py-1.5 rounded-lg shadow-sm transition-all active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;
    if (modeMarkerBtn) modeMarkerBtn.className = (mode === 'marker')
        ? "bg-blue-600 text-white font-black text-[11px] px-1 py-1.5 rounded-lg shadow-sm transition-all active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;
    if (modeCalloutBtn) modeCalloutBtn.className = (mode === 'callout')
        ? "bg-rose-600 text-white font-black text-[11px] px-1 py-1.5 rounded-lg shadow-sm transition-all active:scale-95 whitespace-nowrap flex items-center justify-center"
        : inactiveClass;

    const promptEl = document.getElementById('editPromptText');
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    clearPendingCalloutAnchor();
    editStep = 0;
    cancelActiveFreehandStroke(true);

    const route = getActiveWorkingRoute();

    if (mode === 'path') {
        if (promptEl) {
            promptEl.className = "bg-emerald-600 text-white font-extrabold text-xs px-4 py-1.5 rounded-full shadow-lg pointer-events-auto transition-colors text-center max-w-md";
            promptEl.innerText = "🖐️ 按住節點可拖曳微調，點擊「+」插入轉折點，點擊節點可刪除或修剪頭尾";
        }
        renderPathEditNodes(route);
        updateNodeTrimPanelUI(route);
    } else if (mode === 'freehand') {
        selectedEditNodeIdx = -1;
        updateNodeTrimPanelUI(route);
        if (promptEl) {
            promptEl.className = "bg-orange-600 text-white font-extrabold text-xs px-4 py-1.5 rounded-full shadow-lg pointer-events-auto transition-colors text-center max-w-md";
            promptEl.innerText = "✍️ 可自由雙指/滾輪縮放！單指從頭尾畫線延伸，或點選舊節點畫線連回另一舊節點剪接";
        }
        renderFreehandSpliceNodes(route);
    } else if (mode === 'marker') {
        selectedEditNodeIdx = -1;
        updateNodeTrimPanelUI(route);
        clearPathEditMarkers();
        if (promptEl) {
            promptEl.className = "bg-blue-600 text-white font-extrabold text-xs px-4 py-1.5 rounded-full shadow-lg pointer-events-auto transition-colors text-center max-w-md";
            promptEl.innerText = "📍 請點擊地圖軌跡，選擇音樂開關區段『起點 (A點)』或新增語音提醒/站牌";
        }
    } else if (mode === 'callout') {
        selectedEditNodeIdx = -1;
        updateNodeTrimPanelUI(route);
        clearPathEditMarkers();
        if (promptEl) {
            promptEl.className = "bg-rose-600 text-white font-extrabold text-xs px-4 py-1.5 rounded-full shadow-lg pointer-events-auto transition-colors text-center max-w-md";
            promptEl.innerText = "📌 請先點擊地圖上的目標地點（錨點），再點擊旁邊空位放置文字框";
        }
    }
    updateUndoFreehandBtnUI();
    if (route) updateEditorLiveStatsUI(route);
}

if (modeMarkerBtn) modeMarkerBtn.onclick = () => setEditSubMode('marker');
if (modePathBtn) modePathBtn.onclick = () => setEditSubMode('path');
if (modeFreehandBtn) modeFreehandBtn.onclick = () => setEditSubMode('freehand');
if (modeCalloutBtn) modeCalloutBtn.onclick = () => setEditSubMode('callout');

if (btnUndoFreehand) {
    btnUndoFreehand.onclick = () => {
        if (!isEditingMode || freehandUndoStack.length === 0) return;
        const route = getActiveWorkingRoute();
        if (!route) return;
        const prevState = freehandUndoStack.pop();
        route.points = prevState.points;
        route.events = prevState.events;
        route.callouts = Array.isArray(prevState.callouts) ? prevState.callouts : [];
        clearPendingCalloutAnchor();
        selectedEditNodeIdx = (prevState.selectedEditNodeIdx !== undefined && prevState.selectedEditNodeIdx < route.points.length)
            ? prevState.selectedEditNodeIdx
            : -1;
        cancelActiveFreehandStroke(true);
        syncRouteMarkersAndIndicesAfterSpline(route);
        vibrate(30);
        updateRouteLayers(route.points);
        renderEditableRouteMarkers(route);
        renderPathEditNodes(route);
        updateNodeTrimPanelUI(route);
        updateUndoFreehandBtnUI();
        const promptEl = document.getElementById('editPromptText');
        if (promptEl) {
            promptEl.innerText = `↩️ 已復原上一步！（剩餘可復原 ${freehandUndoStack.length} 步，總距離 ${route.distance} km）`;
        }
    };
}

// 綁定地圖容器的手繪延伸／剪接事件（嚴格遵守：絕不鎖定 touchZoomRotate 與 scrollZoom，僅在 e.touches.length === 1 單指觸控時畫線，偵測到 e.touches.length >= 2 雙指觸控時立刻中斷畫線並交還地圖縮放平移）
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
        ensureEditorMapZoomEnabled();

        const targetEl = rawEvent?.target;
        if (targetEl && targetEl.closest && targetEl.closest('.music-marker, .shared-pin-wrapper, .fleet-truck-marker, .callout-box-marker, .callout-anchor-marker')) {
            return;
        }

        const route = getActiveWorkingRoute();
        if (!route || !Array.isArray(route.points) || route.points.length < 2) return;

        const lngLat = getLngLatFromClientXY(clientX, clientY);
        const pts = route.points;

        // 計算與當前編輯路線所有節點的最近距離
        let minStartDistM = Infinity;
        let closestStartIdx = -1;
        for (let i = 0; i < pts.length; i++) {
            const dM = getDistanceKm(lngLat.lng, lngLat.lat, pts[i].lng, pts[i].lat) * 1000;
            if (dM < minStartDistM) {
                minStartDistM = dM;
                closestStartIdx = i;
            }
        }

        // 若使用者已先點選了某個舊節點 (freehandSpliceStartIdx)，或手指在路線節點 45 公尺內按下，啟動單指手繪
        let activeStartIdx = -1;
        if (minStartDistM <= 45 && closestStartIdx !== -1) {
            activeStartIdx = closestStartIdx;
        } else if (freehandSpliceStartIdx >= 0 && freehandSpliceStartIdx < pts.length) {
            activeStartIdx = freehandSpliceStartIdx;
        } else {
            // 若在遠離路線的空白處單指滑動，保留地圖拖曳平移能力，不強行鎖死地圖
            try { map.dragPan.enable(); } catch (e) {}
            return;
        }

        // 單指開始在路線上畫線時，暫時停用單指 dragPan 避免畫面跟著單指跑，但保持 touchZoomRotate 與 scrollZoom 開啟
        try { map.dragPan.disable(); } catch (e) {}
        ensureEditorMapZoomEnabled();

        isFreehandDrawing = true;
        freehandStartIndex = activeStartIdx;
        const snapPt = pts[activeStartIdx];

        if (freehandSpliceStartIdx === activeStartIdx && freehandDraftCoords.length >= 2) {
            freehandStrokeCoords = [...freehandDraftCoords];
        } else {
            freehandStrokeCoords = [[Number(snapPt.lng.toFixed(6)), Number(snapPt.lat.toFixed(6))]];
        }

        if (getDistanceKm(snapPt.lng, snapPt.lat, lngLat.lng, lngLat.lat) * 1000 >= 3.5) {
            freehandStrokeCoords.push([Number(lngLat.lng.toFixed(6)), Number(lngLat.lat.toFixed(6))]);
        }
        updateFreehandTempLayer(freehandStrokeCoords);

        const promptEl = document.getElementById('editPromptText');
        if (promptEl) {
            promptEl.innerText = "✍️ 正在手繪新路徑... 連回另一舊節點可剪除中間舊路，或向頭尾外拉延伸";
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

        if (distM >= 4) {
            if (distM > 10) {
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
        try { map.dragPan.enable(); } catch (e) {}
        ensureEditorMapZoomEnabled();

        const route = getActiveWorkingRoute();
        const promptEl = document.getElementById('editPromptText');
        if (!route || !Array.isArray(route.points) || route.points.length < 2 || freehandStrokeCoords.length < 2) {
            updateFreehandTempLayer(freehandDraftCoords.length >= 2 ? freehandDraftCoords : []);
            freehandStrokeCoords = [];
            freehandStartIndex = -1;
            return;
        }

        const pts = route.points;
        const startIndex = freehandStartIndex;
        const [endLng, endLat] = freehandStrokeCoords[freehandStrokeCoords.length - 1];

        let strokeLenM = 0;
        for (let i = 1; i < freehandStrokeCoords.length; i++) {
            strokeLenM += getDistanceKm(
                freehandStrokeCoords[i - 1][0], freehandStrokeCoords[i - 1][1],
                freehandStrokeCoords[i][0], freehandStrokeCoords[i][1]
            ) * 1000;
        }
        // 若滑動距離極短 (< 6m)，視為單純點選節點而非畫線
        if (strokeLenM < 6) {
            updateFreehandTempLayer(freehandDraftCoords.length >= 2 ? freehandDraftCoords : []);
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

        // 情境 A（剪接替換）：終點連回原路線上另一個舊節點（距離 < 45 公尺且非同一點）➔ 自動剪除兩舊節點之間的多餘舊路徑並無縫替換
        if (minEndDistM < 45 && closestEndIdx !== -1 && closestEndIdx !== startIndex) {
            applySpliceBetweenNodes(route, startIndex, closestEndIdx, freehandStrokeCoords);
            freehandSpliceStartIdx = -1;
            freehandDraftCoords = [];
            updateFreehandTempLayer([]);
        }
        // 情境 B（頭尾延伸）：從路線頭尾端點附近（前後 6 點內）向外畫線延伸
        else if (startIndex <= 5 || startIndex >= pts.length - 6) {
            applyExtendFromEndpoint(route, startIndex, freehandStrokeCoords);
            updateFreehandTempLayer([]);
        }
        // 情境 C（分段剪接草稿）：從路線中段某個舊節點畫出新路徑但尚未連回另一舊節點，保留草稿讓使用者可雙指縮放平移後再點選目標舊節點完成剪接
        else {
            freehandSpliceStartIdx = startIndex;
            freehandDraftCoords = [...freehandStrokeCoords];
            updateFreehandTempLayer(freehandDraftCoords);
            renderFreehandSpliceNodes(route);
            if (promptEl) {
                promptEl.innerText = `✂️ 已從節點 #${startIndex + 1} 畫出新路徑草稿！可雙指縮放後點選路線上另一個舊節點完成剪接替換`;
            }
        }

        freehandStrokeCoords = [];
        freehandStartIndex = -1;
    }

    let isMultiTouchGestureActive = false;

    canvasContainer.addEventListener('touchstart', (e) => {
        if (!isEditingMode || editSubMode !== 'freehand') return;
        ensureEditorMapZoomEnabled();
        if (!e.touches) return;

        // 只要偵測到雙指觸控 (e.touches.length >= 2)，立刻中斷當前單指畫線判定，將控制權 100% 交還給地圖執行雙指平移與縮放！
        if (e.touches.length >= 2) {
            isMultiTouchGestureActive = true;
            if (isFreehandDrawing) {
                cancelActiveFreehandStroke(false);
            }
            try { map.dragPan.enable(); } catch (err) {}
            ensureEditorMapZoomEnabled();
            return;
        }

        if (isMultiTouchGestureActive) return;

        if (e.touches.length === 1) {
            const touch = e.touches[0];
            handleStrokeStart(touch.clientX, touch.clientY, e);
        }
    }, { passive: true });

    canvasContainer.addEventListener('touchmove', (e) => {
        if (!isEditingMode || editSubMode !== 'freehand') return;
        if (!e.touches) return;

        // 雙指觸控時立刻中斷單指畫線，絕不攔截事件、絕不呼叫 map.panBy，讓 MapLibre 原生 touchZoomRotate 順暢執行雙指縮放與平移
        if (e.touches.length >= 2) {
            isMultiTouchGestureActive = true;
            if (isFreehandDrawing) {
                cancelActiveFreehandStroke(false);
            }
            try { map.dragPan.enable(); } catch (err) {}
            ensureEditorMapZoomEnabled();
            return;
        }

        if (isMultiTouchGestureActive || !isFreehandDrawing) return;

        // 僅在單指觸控 (e.touches.length === 1) 且正在畫線時執行畫線
        if (e.touches.length === 1) {
            if (e.cancelable) e.preventDefault();
            const touch = e.touches[0];
            handleStrokeMove(touch.clientX, touch.clientY);
        }
    }, { passive: false });

    canvasContainer.addEventListener('touchend', (e) => {
        if (!isEditingMode || editSubMode !== 'freehand') {
            if (!e.touches || e.touches.length === 0) {
                isMultiTouchGestureActive = false;
            }
            return;
        }

        if (isMultiTouchGestureActive) {
            if (isFreehandDrawing) cancelActiveFreehandStroke(false);
            if (!e.touches || e.touches.length === 0) {
                isMultiTouchGestureActive = false;
                try { map.dragPan.enable(); } catch (err) {}
                ensureEditorMapZoomEnabled();
            }
            return;
        }

        if (!e.touches || e.touches.length === 0) {
            handleStrokeEnd();
        }
    }, { passive: true });

    canvasContainer.addEventListener('touchcancel', (e) => {
        if (isFreehandDrawing) cancelActiveFreehandStroke(false);
        if (!e.touches || e.touches.length === 0) {
            isMultiTouchGestureActive = false;
        }
        try { map.dragPan.enable(); } catch (err) {}
        ensureEditorMapZoomEnabled();
    }, { passive: true });

    // 滑鼠單擊拖曳畫線（滾輪縮放 map.scrollZoom 全程保持啟用）
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
    if (typeof canCurrentUserManageRoutes === 'function' && !canCurrentUserManageRoutes()) {
        alert('🔒 目前為唯讀權限，僅限「🛡️ 路線管理員」或「🛠️ 開發者」可編輯路線！');
        return;
    }
    const route = savedRoutes[selectedRouteIdx];
    if (!route) return;

    isReviewingPendingMode = false;
    reviewingPendingId = null;
    targetRouteId = null;
    reviewingPendingRoute = null;
    if (pendingReviewBanner) pendingReviewBanner.classList.add('hidden');
    if (pendingReviewActionRow) pendingReviewActionRow.classList.add('hidden');
    if (normalEditActionRow) normalEditActionRow.classList.remove('hidden');

    isEditingMode = true;
    editStep = 0;
    selectedEditNodeIdx = -1;
    freehandUndoStack = [];
    freehandSpliceStartIdx = -1;
    freehandDraftCoords = [];
    if (!Array.isArray(route.callouts)) route.callouts = [];
    originalEventsBackup = JSON.parse(JSON.stringify(route.events || [])); 
    originalPointsBackup = JSON.parse(JSON.stringify(route.points || [])); 
    originalCalloutsBackup = JSON.parse(JSON.stringify(route.callouts || []));

    document.getElementById('routeDetailUI').classList.add('hidden');
    document.getElementById('editRouteBar').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = `編輯：${route.name}`;

    ensureEditorMapZoomEnabled();
    setEditSubMode('path');
    renderEditableRouteMarkers(route);
};

function renderEditableRouteMarkers(route, autoFocusCalloutId = null) {
    clearDomMarkers();
    const pts = route.points;
    if (!pts || pts.length === 0) return;
    addPinMarker([pts[0].lng, pts[0].lat], '<div class="pin-s"><span>S</span></div>');
    addPinMarker([pts[pts.length-1].lng, pts[pts.length-1].lat], '<div class="pin-e"><span>E</span></div>');

    (route.events || []).forEach((ev, idx) => {
        if (ev.type === 'alert') {
            createCompactAlertPinMarker(route, ev, idx);
            return;
        }
        const badgeClass = ev.type === 'on' ? 'music-on-pin' : 'music-off-pin';
        const iconClass = ev.type === 'on' ? 'fa-music' : 'fa-volume-xmark';
        const text = ev.type === 'on' ? '開' : '關';
        const wrapperEl = document.createElement('div');
        wrapperEl.className = 'pin-se-wrapper';
        const markerEl = document.createElement('div');
        markerEl.className = `music-marker ${badgeClass}`;
        markerEl.innerHTML = `<i class="fa-solid ${iconClass}"></i> ${text}`;
        wrapperEl.appendChild(markerEl);
        const m = new maplibregl.Marker({
            element: wrapperEl,
            anchor: 'center',
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
        }).setLngLat([ev.lng, ev.lat]).addTo(map);
        domMarkers.push(m);
    });

    (route.points || []).forEach((p, idx) => {
        if (p.is_stop) {
            const wrapperEl = document.createElement('div');
            wrapperEl.className = 'pin-se-wrapper';
            const markerEl = document.createElement('div');
            markerEl.className = `music-marker bg-indigo-600 border border-white shadow-lg cursor-grab active:cursor-grabbing`;
            markerEl.innerHTML = `<i class="fa-regular fa-clock"></i> ${p.scheduled_time} <i class="fa-solid fa-pen ml-1 opacity-70"></i>`;
            wrapperEl.appendChild(markerEl);
            
            const m = new maplibregl.Marker({
                element: wrapperEl,
                anchor: 'center',
                draggable: true,
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            }).setLngLat([p.lng, p.lat]).addTo(map);

            m.on('dragstart', () => {
                pushEditUndoSnapshot(route);
            });

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
                        pushEditUndoSnapshot(route);
                        route.points[idx].scheduled_time = newTime; 
                        route.points[idx].stop_name = newName;
                        modal.classList.add('hidden');
                        renderEditableRouteMarkers(route);
                    } else { alert("時間與站名不可空白！"); }
                };

                document.getElementById('btnDeleteStop').onclick = () => {
                    if (confirm(`確定要刪除【${p.stop_name}】這個站牌嗎？`)) {
                        pushEditUndoSnapshot(route);
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

    renderRouteCallouts(route, true, autoFocusCalloutId);
}

// ==========================================
// ✏️ 手繪自由畫路線（手指按住拖曳自由畫橘色線，放開直接轉為軌跡，不點路口、不自動繞路）
// ==========================================
let isManualDrawingMode = false;
let manualDrawMusicActive = true; // 預設「🟢 音樂收運（畫綠線）」
let manualDrawSteps = []; // 儲存每一筆自由手繪線段（{ clickLngLat, musicActive, densifiedCoords }），支援「↩️ 復原」與「🗑️ 重畫」
let isManualDrawFetching = false;
let manualDrawActionSeq = 0;
let isManualFreehandStrokeActive = false;
let manualFreehandStrokeCoords = [];

const startManualDrawBtn = document.getElementById('startManualDrawBtn');
const manualDrawTopBanner = document.getElementById('manualDrawTopBanner');
const manualDrawPromptBadge = document.getElementById('manualDrawPromptBadge');
const manualDrawPromptText = document.getElementById('manualDrawPromptText');
const manualDrawUI = document.getElementById('manualDrawUI');
const manualDrawStatsNodes = document.getElementById('manualDrawStatsNodes');
const manualDrawStatsDist = document.getElementById('manualDrawStatsDist');
const manualDrawQuickNavRow = document.getElementById('manualDrawQuickNavRow');
const btnManualMusicOn = document.getElementById('btnManualMusicOn');
const btnManualMusicOff = document.getElementById('btnManualMusicOff');
const btnManualUndo = document.getElementById('btnManualUndo');
const btnManualClear = document.getElementById('btnManualClear');
const btnManualSave = document.getElementById('btnManualSave');
const btnManualCancel = document.getElementById('btnManualCancel');
const btnManualStartFollow = document.getElementById('btnManualStartFollow');
const btnManualStartReplay = document.getElementById('btnManualStartReplay');

function updateManualMusicSwitchUI() {
    if (!btnManualMusicOn || !btnManualMusicOff) return;
    if (manualDrawMusicActive) {
        btnManualMusicOn.className = 'bg-green-600 text-white font-extrabold py-2 px-2 rounded-xl text-xs sm:text-sm shadow-md active:scale-95 transition-all flex items-center justify-center gap-1';
        btnManualMusicOff.className = 'bg-transparent text-gray-600 hover:bg-white/60 font-extrabold py-2 px-2 rounded-xl text-xs sm:text-sm active:scale-95 transition-all flex items-center justify-center gap-1';
    } else {
        btnManualMusicOn.className = 'bg-transparent text-gray-600 hover:bg-white/60 font-extrabold py-2 px-2 rounded-xl text-xs sm:text-sm active:scale-95 transition-all flex items-center justify-center gap-1';
        btnManualMusicOff.className = 'bg-blue-600 text-white font-extrabold py-2 px-2 rounded-xl text-xs sm:text-sm shadow-md active:scale-95 transition-all flex items-center justify-center gap-1';
    }
}

if (btnManualMusicOn) {
    btnManualMusicOn.onclick = () => {
        manualDrawMusicActive = true;
        updateManualMusicSwitchUI();
    };
}
if (btnManualMusicOff) {
    btnManualMusicOff.onclick = () => {
        manualDrawMusicActive = false;
        updateManualMusicSwitchUI();
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

// 規範化方位角為 0~360 整數（若無效則回傳 null）
function normalizeValidHeadingDeg(rawHeading) {
    if (typeof rawHeading !== 'number' || isNaN(rawHeading) || !isFinite(rawHeading)) {
        return null;
    }
    return ((Math.round(rawHeading) % 360) + 360) % 360;
}

// 呼叫 OSRM 道路吸附 API（強制 continue_straight=true 禁止途經點原地迴轉、approaches=curb 台灣靠右順向停靠、並支援起點 bearings 車頭方向角）
async function fetchOsrmRoadGeometry(lng1, lat1, lng2, lat2, options = {}) {
    const validHeading = normalizeValidHeadingDeg(options?.startHeading);
    const bearingsQuery = validHeading !== null ? `&bearings=${validHeading},45;` : '';
    const approachCandidates = [
        options?.originUnrestricted ? 'unrestricted;curb' : 'curb;curb',
        'unrestricted;curb'
    ];

    for (const approachesParam of approachCandidates) {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson&continue_straight=true&approaches=${approachesParam}${bearingsQuery}`;
        try {
            const res = await fetchWithTimeout(osrmUrl, {}, 4000);
            if (!res.ok) continue;
            const data = await res.json();
            const coords = data?.routes?.[0]?.geometry?.coordinates;
            if (data?.code === 'Ok' && Array.isArray(coords) && coords.length >= 2) {
                // 確保起點與前一段終點座標完全銜接無縫隙
                const alignedCoords = [[lng1, lat1], ...coords.slice(1)];
                let endHeading = validHeading;
                if (alignedCoords.length >= 2) {
                    const pPrev = alignedCoords[alignedCoords.length - 2];
                    const pLast = alignedCoords[alignedCoords.length - 1];
                    if (pPrev[0] !== pLast[0] || pPrev[1] !== pLast[1]) {
                        endHeading = getBearing(pPrev[0], pPrev[1], pLast[0], pLast[1]);
                    }
                }
                return { coords: alignedCoords, usedOsrm: true, endHeading };
            }
        } catch (err) {
            // 單次嘗試失敗或超時，繼續嘗試備援參數
        }
    }

    // 若帶入 bearings 在窄巷單行道無解，嘗試保留 continue_straight=true 與 approaches=unrestricted;curb
    try {
        const fallbackUrl = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson&continue_straight=true&approaches=unrestricted;curb`;
        const res = await fetchWithTimeout(fallbackUrl, {}, 3500);
        if (res.ok) {
            const data = await res.json();
            const coords = data?.routes?.[0]?.geometry?.coordinates;
            if (data?.code === 'Ok' && Array.isArray(coords) && coords.length >= 2) {
                const alignedCoords = [[lng1, lat1], ...coords.slice(1)];
                let endHeading = validHeading;
                if (alignedCoords.length >= 2) {
                    const pPrev = alignedCoords[alignedCoords.length - 2];
                    const pLast = alignedCoords[alignedCoords.length - 1];
                    if (pPrev[0] !== pLast[0] || pPrev[1] !== pLast[1]) {
                        endHeading = getBearing(pPrev[0], pPrev[1], pLast[0], pLast[1]);
                    }
                }
                return { coords: alignedCoords, usedOsrm: true, endHeading };
            }
        }
    } catch (e) {}

    return {
        coords: [[lng1, lat1], [lng2, lat2]],
        usedOsrm: false,
        endHeading: getBearing(lng1, lat1, lng2, lat2)
    };
}

// 由 manualDrawSteps 建構與 GPS 實車錄製 100% 相同結構的 points、events 與總距離（支援單筆或多筆自由手繪線段）
function buildManualRouteFromSteps() {
    if (manualDrawSteps.length === 0) {
        return { points: [], events: [], totalDistKm: 0 };
    }

    const baseTime = Date.now();
    let curTime = baseTime;
    const points = [];
    const events = [];
    let totalDistKm = 0;

    for (let sIdx = 0; sIdx < manualDrawSteps.length; sIdx++) {
        const step = manualDrawSteps[sIdx];
        const segMusic = Boolean(step.musicActive);
        const segCoords = Array.isArray(step.densifiedCoords) && step.densifiedCoords.length > 0
            ? step.densifiedCoords
            : (step.clickLngLat ? [step.clickLngLat] : []);
        if (segCoords.length === 0) continue;

        if (points.length === 0) {
            const [lng0, lat0] = segCoords[0];
            points.push({
                lng: lng0,
                lat: lat0,
                time: curTime,
                musicActive: segMusic,
                music: segMusic,
                bearing: 0
            });
            if (segMusic) {
                events.push({
                    type: 'on',
                    lng: lng0,
                    lat: lat0,
                    ptIdx: 0,
                    bearing: 0
                });
            }
        } else {
            const prevMusic = Boolean(points[points.length - 1].musicActive);
            if (segMusic !== prevMusic) {
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
        }

        const startIdx = (sIdx === 0) ? 1 : 0;
        for (let cIdx = startIdx; cIdx < segCoords.length; cIdx++) {
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

    // 同步至全域即時路線軌跡資料結構
    routePoints = points;
    musicEvents = events;
    totalDistanceKm = totalDistKm;

    const visualPts = computeVisualRightOffsetCoords(points);
    clearDomMarkers();
    updateRouteLayers(points);

    if (points.length >= 1) {
        const startLngLat = visualPts.length > 0
            ? [visualPts[0].lng, visualPts[0].lat]
            : [points[0].lng, points[0].lat];
        addPinMarker(startLngLat, '<div class="pin-s pointer-events-none"><span>S</span></div>');
    }

    if (points.length >= 2) {
        const lastIdx = points.length - 1;
        const endLngLat = visualPts.length > lastIdx
            ? [visualPts[lastIdx].lng, visualPts[lastIdx].lat]
            : [points[lastIdx].lng, points[lastIdx].lat];
        addPinMarker(endLngLat, '<div class="pin-e pointer-events-none"><span>E</span></div>');
    }

    // 標示音樂開關切換點
    events.forEach(ev => {
        if (ev.type === 'on') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-on-pin pointer-events-none"><i class="fa-solid fa-music"></i> 開</div>`);
        } else if (ev.type === 'off') {
            addPinMarker([ev.lng, ev.lat], `<div class="music-marker music-off-pin pointer-events-none"><i class="fa-solid fa-volume-xmark"></i> 關</div>`);
        }
    });

    const hasValidRoute = points.length >= 2;
    if (manualDrawStatsNodes) {
        manualDrawStatsNodes.innerHTML = hasValidRoute
            ? `<i class="fa-solid fa-pen-nib"></i> 已畫 ${manualDrawSteps.length} 筆（${points.length} 點）`
            : `<i class="fa-solid fa-pen-nib"></i> 尚未繪製軌跡`;
    }
    if (manualDrawStatsDist) {
        manualDrawStatsDist.textContent = `總距離 ${totalDistKm.toFixed(2)} km`;
    }
    if (btnManualUndo) {
        btnManualUndo.disabled = (manualDrawSteps.length === 0);
    }
    if (btnManualClear) {
        btnManualClear.disabled = (manualDrawSteps.length === 0);
    }
    if (btnManualSave) {
        btnManualSave.disabled = !hasValidRoute;
    }
    if (manualDrawQuickNavRow) {
        manualDrawQuickNavRow.classList.toggle('hidden', !hasValidRoute);
    }
}

function cancelActiveManualFreehandStroke() {
    isManualFreehandStrokeActive = false;
    manualFreehandStrokeCoords = [];
    updateFreehandTempLayer([]);
    try { map.dragPan.enable(); } catch (e) {}
    try { map.touchZoomRotate.enable(); } catch (e) {}
}

function commitManualFreehandStroke() {
    const rawCoords = manualFreehandStrokeCoords.slice();
    isManualFreehandStrokeActive = false;
    manualFreehandStrokeCoords = [];
    updateFreehandTempLayer([]);
    try { map.dragPan.enable(); } catch (e) {}

    if (!isManualDrawingMode || rawCoords.length < 2) return;

    // 計算該筆自由繪製長度，過短（< 3m）視為誤觸略過
    let strokeMeters = 0;
    for (let i = 1; i < rawCoords.length; i++) {
        strokeMeters += getDistanceKm(rawCoords[i - 1][0], rawCoords[i - 1][1], rawCoords[i][0], rawCoords[i][1]) * 1000;
    }
    if (strokeMeters < 3) return;

    // 若已有前一段手繪軌跡且新起點距離前段終點 <= 45m，無縫銜接前段終點
    let coordsToDensify = rawCoords;
    if (manualDrawSteps.length > 0) {
        const prevStep = manualDrawSteps[manualDrawSteps.length - 1];
        const prevCoords = prevStep.densifiedCoords || [];
        if (prevCoords.length > 0) {
            const prevEnd = prevCoords[prevCoords.length - 1];
            const gapM = getDistanceKm(prevEnd[0], prevEnd[1], rawCoords[0][0], rawCoords[0][1]) * 1000;
            if (gapM > 0.2 && gapM <= 45) {
                coordsToDensify = [prevEnd, ...rawCoords];
            }
        }
    }

    const densified = densifyRoadCoordinates(coordsToDensify, 6);
    if (densified.length < 2) return;

    const endCoord = densified[densified.length - 1];
    manualDrawSteps.push({
        clickLngLat: endCoord,
        musicActive: manualDrawMusicActive,
        densifiedCoords: densified,
        usedOsrm: false
    });

    vibrate(30);
    if (manualDrawPromptText) {
        manualDrawPromptText.textContent = '✅ 已轉為路線軌跡！可繼續補畫、按「重畫」清除，或直接導航／播放';
    }
    renderManualDrawPreview();
}

function buildManualRouteRecordObject(routeName, authorName) {
    const { points, events, totalDistKm } = buildManualRouteFromSteps();
    if (points.length < 2) return null;

    const estElapsedSec = Math.max(10, Math.round((totalDistKm / 20) * 3600));
    const mins = Math.floor(estElapsedSec / 60), secs = estElapsedSec % 60;
    const nowId = Date.now();
    const trimmedName = routeName.trim();

    const existingMatch = savedRoutes.find(r => !r?.isPendingPreview && isSameRouteIdentity(r, { name: trimmedName }));
    const nextVer = existingMatch ? (getRouteVersion(existingMatch) + 1) : 1;

    return {
        id: existingMatch?.id || nowId,
        originId: existingMatch?.originId || nowId,
        routeId: existingMatch?.routeId || generateRouteId(),
        name: trimmedName,
        author: authorName,
        routeVersion: nextVer,
        updatedAt: nowId,
        date: new Date(nowId).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        createdAt: new Date(nowId).toISOString(),
        distance: totalDistKm.toFixed(2),
        timeStr: `${mins}m ${secs}s`,
        points: points,
        events: events,
        alerts: [],
        warnings: []
    };
}

function finalizeManualDrawAndLaunch(actionType) {
    if (!isManualDrawingMode) return;
    cancelActiveManualFreehandStroke();

    const defaultName = '手繪路線 ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const author = (localStorage.getItem('fleet_user_name') || localStorage.getItem('yinggeRouteLastAuthor') || '熱心隊員').trim();
    const newRoute = buildManualRouteRecordObject(defaultName, author);
    if (!newRoute) {
        alert('請先用手指在地圖上按住拖曳畫出路線軌跡！');
        return;
    }

    const savedItem = upsertLocalRouteFromCloud(newRoute);
    persistSavedRoutesToStorage();

    isManualDrawingMode = false;
    manualDrawSteps = [];
    isManualDrawFetching = false;
    manualDrawActionSeq++;
    if (manualDrawTopBanner) manualDrawTopBanner.classList.add('hidden');
    if (manualDrawUI) manualDrawUI.classList.add('hidden');

    const targetIdx = Math.max(0, savedRoutes.findIndex(r => r === savedItem || isSameRouteIdentity(r, savedItem)));
    window.openRouteDetail(targetIdx);

    if (actionType === 'follow') {
        setTimeout(() => document.getElementById('startFollowBtn')?.click(), 60);
    } else if (actionType === 'replay') {
        setTimeout(() => document.getElementById('startReplayBtn')?.click(), 60);
    }
}

function enterManualDrawMode() {
    if (isRecording) return;
    isManualDrawingMode = true;
    manualDrawMusicActive = true;
    manualDrawSteps = [];
    isManualDrawFetching = false;
    manualDrawActionSeq++;
    cancelActiveManualFreehandStroke();

    ensureEditorMapZoomEnabled();
    try { map.dragPan.enable(); } catch (e) {}
    updateManualMusicSwitchUI();
    setCameraFollow(false);

    document.getElementById('mainUI').classList.add('hidden');
    document.getElementById('routeDetailUI').classList.add('hidden');
    document.getElementById('playbackUI').classList.add('hidden');
    document.getElementById('topBackBtn').classList.add('hidden');

    if (manualDrawTopBanner) manualDrawTopBanner.classList.remove('hidden');
    if (manualDrawPromptText) manualDrawPromptText.textContent = '✏️ 手指按住拖曳自由畫橘色線，放開即轉為軌跡（雙指可縮放）';
    if (manualDrawUI) manualDrawUI.classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = '✏️ 手繪自由路線';

    clearDomMarkers();
    updateRouteLayers([]);
    map.getSource('bg-route')?.setData(emptyGeoJSON());
    renderManualDrawPreview();

    window.history.pushState({ pwa: true }, '');
}

function exitManualDrawModeToMain() {
    cancelActiveManualFreehandStroke();
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
        cancelActiveManualFreehandStroke();
        if (manualDrawSteps.length > 0) {
            manualDrawSteps.pop();
            vibrate(30);
        }
        if (manualDrawPromptText) {
            manualDrawPromptText.textContent = manualDrawSteps.length === 0
                ? '✏️ 手指按住拖曳自由畫橘色線，放開即轉為軌跡（雙指可縮放）'
                : '↩️ 已復原上一筆，可繼續拖曳補畫';
        }
        renderManualDrawPreview();
    };
}

if (btnManualClear) {
    btnManualClear.onclick = () => {
        if (!isManualDrawingMode) return;
        cancelActiveManualFreehandStroke();
        if (manualDrawSteps.length === 0) return;
        manualDrawSteps = [];
        vibrate(35);
        if (manualDrawPromptText) {
            manualDrawPromptText.textContent = '🗑️ 已清除軌跡，請重新按住拖曳自由畫橘色線';
        }
        renderManualDrawPreview();
    };
}

if (btnManualStartFollow) {
    btnManualStartFollow.onclick = () => finalizeManualDrawAndLaunch('follow');
}

if (btnManualStartReplay) {
    btnManualStartReplay.onclick = () => finalizeManualDrawAndLaunch('replay');
}

if (btnManualCancel) {
    btnManualCancel.onclick = () => {
        if (!isManualDrawingMode) return;
        cancelActiveManualFreehandStroke();
        if (manualDrawSteps.length >= 1) {
            if (!confirm('確定要放棄目前手繪的路線並返回主畫面嗎？')) return;
        }
        exitManualDrawModeToMain();
    };
}

if (btnManualSave) {
    btnManualSave.onclick = () => {
        if (!isManualDrawingMode) return;
        cancelActiveManualFreehandStroke();

        const { points } = buildManualRouteFromSteps();
        if (points.length < 2) {
            alert('請先用手指在地圖上按住拖曳畫出路線軌跡才能儲存！');
            return;
        }

        const defaultName = "鶯歌路線 " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const name = prompt("手繪路線完成！請輸入路線名稱（如：尖山線第一趟）：", defaultName);
        if (!name || !name.trim()) return;

        const savedAuthor = localStorage.getItem('fleet_user_name') || localStorage.getItem('yinggeRouteLastAuthor') || '凱哥';
        const authorInput = prompt("請輸入這條路線的創作者署名：", savedAuthor);
        if (authorInput === null) return;
        const author = authorInput.trim() || "熱心隊員";
        localStorage.setItem('yinggeRouteLastAuthor', author);

        const newRoute = buildManualRouteRecordObject(name, author);
        if (!newRoute) return;

        const savedItem = upsertLocalRouteFromCloud(newRoute);
        persistSavedRoutesToStorage();

        // 退出手繪模式並進入該路線預覽詳情頁（可立即循跡導航、路線播放或進一步編輯）
        isManualDrawingMode = false;
        manualDrawSteps = [];
        isManualDrawFetching = false;
        manualDrawActionSeq++;
        if (manualDrawTopBanner) manualDrawTopBanner.classList.add('hidden');
        if (manualDrawUI) manualDrawUI.classList.add('hidden');

        const targetIdx = Math.max(0, savedRoutes.findIndex(r => r === savedItem || isSameRouteIdentity(r, savedItem)));
        window.openRouteDetail(targetIdx);
    };
}

// ✏️ 手繪模式自由畫線手勢引擎：按住拖曳時停用 map.dragPan 並即時繪製橘色線，放開立刻恢復 dragPan 並直接轉為路線軌跡
(function setupManualDrawFreehandGesture() {
    const canvasContainer = map.getCanvasContainer();
    if (!canvasContainer) return;

    function clientXYToLngLat(clientX, clientY) {
        const rect = canvasContainer.getBoundingClientRect();
        const lngLat = map.unproject([clientX - rect.left, clientY - rect.top]);
        if (!lngLat || isNaN(lngLat.lng) || isNaN(lngLat.lat)) return null;
        return [Number(lngLat.lng.toFixed(6)), Number(lngLat.lat.toFixed(6))];
    }

    function isIgnoredDrawTarget(targetEl) {
        if (!targetEl || !targetEl.closest) return false;
        return Boolean(targetEl.closest('.shared-pin-wrapper, .fleet-truck-marker, .furniture-pin-wrapper, .furniture-popup-wrapper, .alert-popup-wrapper'));
    }

    function pushStrokePoint(coord) {
        if (!coord) return;
        const prev = manualFreehandStrokeCoords[manualFreehandStrokeCoords.length - 1];
        if (!prev || getDistanceKm(prev[0], prev[1], coord[0], coord[1]) * 1000 >= 2.5) {
            manualFreehandStrokeCoords.push(coord);
            updateFreehandTempLayer(manualFreehandStrokeCoords);
        }
    }

    let isManualMultiTouchGesture = false;
    let lastTwoFingerMidX = null;
    let lastTwoFingerMidY = null;

    function getTwoFingerMidpoint(touches) {
        if (!touches || touches.length < 2) return null;
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    function resetManualMultiTouchState() {
        isManualMultiTouchGesture = false;
        lastTwoFingerMidX = null;
        lastTwoFingerMidY = null;
    }

    function enterManualMultiTouchNav(touches) {
        isManualMultiTouchGesture = true;
        if (isManualFreehandStrokeActive) {
            cancelActiveManualFreehandStroke();
        }
        try { map.dragPan.enable(); } catch (err) {}
        try { map.touchZoomRotate.enable(); } catch (err) {}
        const mid = getTwoFingerMidpoint(touches);
        if (mid) {
            lastTwoFingerMidX = mid.x;
            lastTwoFingerMidY = mid.y;
        }
    }

    // 觸控：僅單指按住拖曳時停用 dragPan 畫橘色線；一旦偵測雙指／多指立即中止未完成單指筆畫並啟用雙指平移與縮放
    canvasContainer.addEventListener('touchstart', (e) => {
        if (!isManualDrawingMode) return;
        if (!e.touches || e.touches.length === 0) return;

        if (e.touches.length >= 2) {
            enterManualMultiTouchNav(e.touches);
            return;
        }

        // 若剛從雙指抬起一指，等待所有手指離開螢幕再允許下一筆單指繪圖
        if (isManualMultiTouchGesture) return;
        if (isIgnoredDrawTarget(e.target)) return;

        const touch = e.touches[0];
        const coord = clientXYToLngLat(touch.clientX, touch.clientY);
        if (!coord) return;

        isManualFreehandStrokeActive = true;
        manualFreehandStrokeCoords = [coord];
        try { map.dragPan.disable(); } catch (err) {}
    }, { passive: true });

    canvasContainer.addEventListener('touchmove', (e) => {
        if (!isManualDrawingMode) return;
        if (!e.touches || e.touches.length === 0) return;

        // 雙指／多指手勢：立即確保中止單指繪圖並啟用 dragPan + touchZoomRotate，並以雙指中心點位移補齊平移（防止首指曾短暫停用 dragPan 導致 MapLibre 漏接雙指平移）
        if (e.touches.length >= 2) {
            if (!isManualMultiTouchGesture || isManualFreehandStrokeActive) {
                enterManualMultiTouchNav(e.touches);
                return;
            }
            const mid = getTwoFingerMidpoint(e.touches);
            if (mid && lastTwoFingerMidX !== null && lastTwoFingerMidY !== null) {
                const dx = mid.x - lastTwoFingerMidX;
                const dy = mid.y - lastTwoFingerMidY;
                const dragPanActive = Boolean(map.dragPan && typeof map.dragPan.isActive === 'function' && map.dragPan.isActive());
                if (!dragPanActive && (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2)) {
                    try { map.panBy([-dx, -dy], { animate: false }); } catch (err) {}
                }
            }
            if (mid) {
                lastTwoFingerMidX = mid.x;
                lastTwoFingerMidY = mid.y;
            }
            return;
        }

        if (isManualMultiTouchGesture || !isManualFreehandStrokeActive) return;
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();

        const touch = e.touches[0];
        pushStrokePoint(clientXYToLngLat(touch.clientX, touch.clientY));
    }, { passive: false });

    canvasContainer.addEventListener('touchend', (e) => {
        if (!isManualDrawingMode) return;
        const remaining = e.touches ? e.touches.length : 0;

        if (isManualMultiTouchGesture) {
            if (remaining === 0) {
                resetManualMultiTouchState();
                isManualFreehandStrokeActive = false;
                manualFreehandStrokeCoords = [];
                updateFreehandTempLayer([]);
                try { map.dragPan.enable(); } catch (err) {}
                try { map.touchZoomRotate.enable(); } catch (err) {}
            } else if (remaining < 2) {
                lastTwoFingerMidX = null;
                lastTwoFingerMidY = null;
            }
            return;
        }

        if (remaining === 0 && isManualFreehandStrokeActive) {
            commitManualFreehandStroke();
        }
    }, { passive: true });

    canvasContainer.addEventListener('touchcancel', (e) => {
        if (!isManualDrawingMode) return;
        const remaining = e.touches ? e.touches.length : 0;
        if (remaining === 0) {
            resetManualMultiTouchState();
        }
        if (isManualFreehandStrokeActive) {
            cancelActiveManualFreehandStroke();
        } else {
            try { map.dragPan.enable(); } catch (err) {}
            try { map.touchZoomRotate.enable(); } catch (err) {}
        }
    }, { passive: true });

    // 滑鼠左鍵：按住拖曳自由畫橘色線，放開即轉為軌跡並恢復 dragPan
    canvasContainer.addEventListener('mousedown', (e) => {
        if (!isManualDrawingMode || e.button !== 0) return;
        if (isIgnoredDrawTarget(e.target)) return;

        const coord = clientXYToLngLat(e.clientX, e.clientY);
        if (!coord) return;

        isManualFreehandStrokeActive = true;
        manualFreehandStrokeCoords = [coord];
        try { map.dragPan.disable(); } catch (err) {}
        updateFreehandTempLayer(manualFreehandStrokeCoords);
    });

    canvasContainer.addEventListener('mousemove', (e) => {
        if (!isManualDrawingMode || !isManualFreehandStrokeActive) return;
        e.preventDefault();
        pushStrokePoint(clientXYToLngLat(e.clientX, e.clientY));
    });

    window.addEventListener('mouseup', () => {
        if (!isManualDrawingMode || !isManualFreehandStrokeActive) return;
        commitManualFreehandStroke();
    });
})();

map.on('click', (e) => {
    const origTarget = e.originalEvent?.target;
    if (origTarget && origTarget.closest && origTarget.closest('.alert-compact-pin, .alert-popup-wrapper, .callout-box-marker, .callout-anchor-marker, .furniture-pin-wrapper, .furniture-popup-wrapper')) {
        return;
    }
    // 點擊地圖空白處自動收合已展開的警示氣泡卡片與家具點位卡片
    if (activeAlertPopupMarker) {
        closeActiveAlertPopup();
    }
    if (typeof closeFurniturePinPopup === 'function') {
        closeFurniturePinPopup();
    }

    if (typeof isFurnitureModeActive !== 'undefined' && isFurnitureModeActive) {
        if (typeof handleFurnitureMapClick === 'function') {
            handleFurnitureMapClick(e);
        }
        return;
    }

    if (isManualDrawingMode) {
        return;
    }
    if (!isEditingMode) return;
    const route = getActiveWorkingRoute();
    if (!route || !Array.isArray(route.points) || route.points.length === 0) return;

    if (origTarget && origTarget.closest && origTarget.closest('.music-marker, .shared-pin-wrapper, .fleet-truck-marker, .alert-compact-pin, .alert-popup-wrapper, .callout-box-marker, .callout-anchor-marker')) {
        return;
    }

    if (editSubMode === 'callout') {
        const clickLng = Number(e.lngLat.lng.toFixed(6));
        const clickLat = Number(e.lngLat.lat.toFixed(6));
        const promptEl = document.getElementById('editPromptText');

        // 第一步（錨點）：點擊路線或路口設定 anchorLngLat（若點擊處距離路線節點 < 18m 則自動貼齊路線節點）
        if (!pendingCalloutAnchorLngLat) {
            let anchorLng = clickLng;
            let anchorLat = clickLat;
            let minSnapM = Infinity;
            let bestPt = null;
            for (let i = 0; i < route.points.length; i++) {
                const dM = getDistanceKm(clickLng, clickLat, route.points[i].lng, route.points[i].lat) * 1000;
                if (dM < minSnapM) {
                    minSnapM = dM;
                    bestPt = route.points[i];
                }
            }
            if (bestPt && minSnapM <= 18) {
                anchorLng = Number(bestPt.lng.toFixed(6));
                anchorLat = Number(bestPt.lat.toFixed(6));
            }

            clearPendingCalloutAnchor();
            pendingCalloutAnchorLngLat = [anchorLng, anchorLat];

            const wrapEl = document.createElement('div');
            wrapEl.className = 'callout-anchor-marker';
            const dotEl = document.createElement('div');
            dotEl.className = 'callout-anchor-dot is-pending';
            wrapEl.appendChild(dotEl);

            pendingCalloutAnchorMarker = new maplibregl.Marker({
                element: wrapEl,
                anchor: 'center',
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            })
                .setLngLat(pendingCalloutAnchorLngLat)
                .addTo(map);

            vibrate(25);
            if (promptEl) {
                promptEl.innerText = "📌 已設定錨點！現在請點擊旁邊空曠處放置備忘文字框";
            }
            return;
        }

        // 第二步（拉線與文字框）：點擊旁邊空曠處設定 boxLngLat，自動繪製高對比引線並建立可編輯文字框
        const anchorCoords = [...pendingCalloutAnchorLngLat];
        clearPendingCalloutAnchor();

        pushEditUndoSnapshot(route);
        if (!Array.isArray(route.callouts)) {
            route.callouts = [];
        }
        const newCalloutId = 'callout_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        route.callouts.push({
            id: newCalloutId,
            anchorLngLat: anchorCoords,
            boxLngLat: [clickLng, clickLat],
            text: '',
            width: 162,
            height: 88,
            style: 'yellow-black'
        });

        vibrate([30, 20, 30]);
        renderEditableRouteMarkers(route, newCalloutId);
        if (promptEl) {
            promptEl.innerText = "✅ 已放置引線備忘框！可直接輸入多行文字、按住標題列拖移或拉右下角調整大小（點地圖可新增下一個）";
        }
        return;
    } else if (editSubMode === 'marker') {
        let minDist = Infinity, closestIdx = -1;
        route.points.forEach((p, idx) => {
            let d = getDistanceKm(e.lngLat.lng, e.lngLat.lat, p.lng, p.lat);
            if (d < minDist) { minDist = d; closestIdx = idx; }
        });

        if (minDist * 1000 > 50) { alert("請點擊在路線軌跡附近！"); return; }

        if (editStep === 0) {
            editStartIndex = closestIdx; 
            if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
            const el = document.createElement('div');
            el.innerHTML = `<div class="music-marker bg-blue-600 border-2 border-white px-3 py-1 shadow-lg text-sm text-white">📍 選擇位置中...</div>`;
            tempMarkerA = new maplibregl.Marker({
                element: el,
                anchor: 'center',
                rotationAlignment: 'viewport',
                pitchAlignment: 'viewport'
            }).setLngLat([route.points[closestIdx].lng, route.points[closestIdx].lat]).addTo(map);
            
            window.currentEditData = { route, editStartIndex };
            document.getElementById('customActionModal').classList.remove('hidden');
        } else if (editStep === 1) {
            pushEditUndoSnapshot(route);
            let editEndIndex = closestIdx;
            let start = Math.min(editStartIndex, editEndIndex);
            let end = Math.max(editStartIndex, editEndIndex);
            
            const action = window.currentEditData.action;
            const turnOn = (action === '1');
            for (let i = start; i <= end; i++) {
                route.points[i].musicActive = turnOn;
                route.points[i].music = turnOn;
            }
            
            syncRouteMarkersAndIndicesAfterSpline(route);

            if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
            editStep = 0;
            document.getElementById('editPromptText').innerText = "🛠️ 區段設定完成！請點擊軌跡選擇下一個『目標點』";
            updateRouteLayers(route.points); renderEditableRouteMarkers(route);
        }
    } else if (editSubMode === 'path') {
        // 點擊軌跡線條時：自動選取最近的節點（同時比對真實座標與右側平行偏移後的視覺座標）並顯示預設收合的迷你小膠囊抽屜鈕
        const visualPts = computeVisualRightOffsetCoords(route.points);
        let minDistToNode = Infinity;
        let closestNodeIdx = -1;
        for (let i = 0; i < route.points.length; i++) {
            const dRaw = getDistanceKm(e.lngLat.lng, e.lngLat.lat, route.points[i].lng, route.points[i].lat) * 1000;
            const vPt = visualPts[i] || route.points[i];
            const dVis = getDistanceKm(e.lngLat.lng, e.lngLat.lat, vPt.lng, vPt.lat) * 1000;
            const d = Math.min(dRaw, dVis);
            if (d < minDistToNode) {
                minDistToNode = d;
                closestNodeIdx = i;
            }
        }

        if (minDistToNode > 38 || closestNodeIdx === -1) {
            if (selectedEditNodeIdx !== -1) {
                selectedEditNodeIdx = -1;
                isNodeTrimDrawerExpanded = false;
                renderPathEditNodes(route);
                updateNodeTrimPanelUI(route);
                const promptEl = document.getElementById('editPromptText');
                if (promptEl) {
                    promptEl.innerText = "🖐️ 按住節點可拖曳微調，點擊「+」插入轉折點，點擊節點可刪除或修剪頭尾";
                }
            }
            return;
        }

        route.points[closestNodeIdx].isKeyNode = true;
        selectedEditNodeIdx = closestNodeIdx;
        isNodeTrimDrawerExpanded = false;
        vibrate(20);
        renderPathEditNodes(route);
        updateNodeTrimPanelUI(route);
        const promptEl = document.getElementById('editPromptText');
        if (promptEl) {
            promptEl.innerText = `🎯 已選取節點 #${closestNodeIdx + 1}：點擊上方「✂️ #${closestNodeIdx + 1} ▸」可展開修剪抽屜`;
        }
    } else if (editSubMode === 'freehand') {
        // 「手繪延伸／剪接」模式下點擊地圖：
        // 1. 若點擊處靠近路線既有節點 (< 30m，含右側平行偏移視覺位置)，視同點選該舊節點（設定剪接起點或完成剪接替換）
        const pts = route.points;
        const visualPts = computeVisualRightOffsetCoords(pts);
        let minDistM = Infinity;
        let closestIdx = -1;
        for (let i = 0; i < pts.length; i++) {
            const dRaw = getDistanceKm(e.lngLat.lng, e.lngLat.lat, pts[i].lng, pts[i].lat) * 1000;
            const vPt = visualPts[i] || pts[i];
            const dVis = getDistanceKm(e.lngLat.lng, e.lngLat.lat, vPt.lng, vPt.lat) * 1000;
            const dM = Math.min(dRaw, dVis);
            if (dM < minDistM) {
                minDistM = dM;
                closestIdx = i;
            }
        }

        if (minDistM <= 28 && closestIdx !== -1) {
            handleFreehandNodeClick(route, closestIdx);
            return;
        }

        const clickCoord = [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))];

        // 2. 若尚未選取舊節點，或目前選取的是頭尾端點 (0 或 pts.length - 1)，點擊地圖空白處直接從頭尾加點延伸！
        if (freehandSpliceStartIdx === -1 || freehandSpliceStartIdx === pts.length - 1 || freehandSpliceStartIdx === 0) {
            let anchorIdx = freehandSpliceStartIdx;
            if (anchorIdx === -1) {
                const dHead = getDistanceKm(clickCoord[0], clickCoord[1], pts[0].lng, pts[0].lat);
                const dTail = getDistanceKm(clickCoord[0], clickCoord[1], pts[pts.length - 1].lng, pts[pts.length - 1].lat);
                anchorIdx = (dHead < dTail * 0.6) ? 0 : (pts.length - 1);
            }
            const anchorPt = pts[anchorIdx];
            applyExtendFromEndpoint(route, anchorIdx, [
                [Number(anchorPt.lng.toFixed(6)), Number(anchorPt.lat.toFixed(6))],
                clickCoord
            ]);
            return;
        }

        // 3. 若已選取某個中段舊節點 A，點擊地圖空白處則依序累積剪接路徑草稿點，待點選另一舊節點 B 時一併剪除替換
        if (freehandDraftCoords.length === 0) {
            const startPt = pts[freehandSpliceStartIdx];
            freehandDraftCoords.push([Number(startPt.lng.toFixed(6)), Number(startPt.lat.toFixed(6))]);
        }
        freehandDraftCoords.push(clickCoord);
        updateFreehandTempLayer(freehandDraftCoords);
        vibrate(20);
        const promptEl = document.getElementById('editPromptText');
        if (promptEl) {
            promptEl.innerText = `✍️ 已加入新路徑折點（共 ${freehandDraftCoords.length - 1} 點），請再點選路線上另一個舊節點完成剪接替換`;
        }
    }
});

window.handleRouteAction = function(action) {
    document.getElementById('customActionModal').classList.add('hidden');
    if (!window.currentEditData) return;

    const { route, editStartIndex } = window.currentEditData;

    if (action === '1' || action === '2') {
        window.currentEditData.action = action;
        editStep = 1; 
        document.getElementById('editPromptText').innerText = "🎵 已選擇音樂動作！請點選軌跡另一處作為『區段終點 (B點)』";
        return;
    } 
    else if (action === '3') {
        pushEditUndoSnapshot(route);
        openAlertModalForCreate(route, editStartIndex);
        return;
    } 
    else if (action === '5') {
        const time = prompt("請輸入表定時間 (格式如 17:30)：", "17:00");
        const name = prompt("請輸入站點名稱 (如：火車站前)：", "新增定點");
        if (time && name) {
            pushEditUndoSnapshot(route);
            route.points[editStartIndex].is_stop = true;
            route.points[editStartIndex].scheduled_time = time;
            route.points[editStartIndex].stop_name = name;
        }
    }
    
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    editStep = 0;
    document.getElementById('editPromptText').innerText = "🛠️ 標記完成！請點擊地圖軌跡選擇下一個『目標點』";
    updateRouteLayers(route.points); renderEditableRouteMarkers(route);
};

document.getElementById('saveEditBtn').onclick = () => {
    isEditingMode = false;
    selectedEditNodeIdx = -1;
    clearPathEditMarkers();
    clearPendingCalloutAnchor();
    cancelActiveFreehandStroke(true);
    freehandUndoStack = [];
    updateUndoFreehandBtnUI();
    updateNodeTrimPanelUI(null);
    try { map.dragPan.enable(); } catch (e) {}
    ensureEditorMapZoomEnabled();
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    document.getElementById('editRouteBar').classList.add('hidden');

    const editedRoute = savedRoutes[selectedRouteIdx];
    if (editedRoute && Array.isArray(editedRoute.points) && editedRoute.points.length >= 2) {
        if (!Array.isArray(editedRoute.callouts)) {
            editedRoute.callouts = [];
        }
        // 自動重新計算總距離 (km) 與各語音標記點的對應路徑索引
        syncRouteMarkersAndIndicesAfterSpline(editedRoute, null, true);

        // 儲存自動升版：routeVersion + 1、更新 updatedAt 時間戳，並原地覆蓋本機舊檔
        const nowTs = Date.now();
        editedRoute.routeVersion = getRouteVersion(editedRoute) + 1;
        editedRoute.updatedAt = nowTs;
        editedRoute.date = new Date(nowTs).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        savedRoutes[selectedRouteIdx] = editedRoute;
    }

    deduplicateSavedRoutes(false);
    persistSavedRoutesToStorage().then(() => {
        renderHistoryList();
        document.getElementById('topBackBtn').classList.remove('hidden');
        window.openRouteDetail(selectedRouteIdx);
        if (editedRoute) {
            showNavAlert('✅', `已儲存「${editedRoute.name}」並自動升版為 v${editedRoute.routeVersion}！`, 'bg-emerald-600');
        }
    }).catch((err) => {
        alert("儲存失敗！可能是手機儲存空間不足，請清理後再試。");
        console.error(err);
    });
};

document.getElementById('cancelEditBtn').onclick = () => {
    isEditingMode = false;
    selectedEditNodeIdx = -1;
    clearPathEditMarkers();
    clearPendingCalloutAnchor();
    cancelActiveFreehandStroke(true);
    freehandUndoStack = [];
    updateUndoFreehandBtnUI();
    updateNodeTrimPanelUI(null);
    try { map.dragPan.enable(); } catch (e) {}
    ensureEditorMapZoomEnabled();
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    document.getElementById('editRouteBar').classList.add('hidden');
    
    savedRoutes[selectedRouteIdx].events = originalEventsBackup;
    savedRoutes[selectedRouteIdx].points = originalPointsBackup;
    savedRoutes[selectedRouteIdx].callouts = originalCalloutsBackup;
    syncRouteMarkersAndIndicesAfterSpline(savedRoutes[selectedRouteIdx]);
    
    document.getElementById('topBackBtn').classList.remove('hidden');
    window.openRouteDetail(selectedRouteIdx);
};

// 結束重播後自動歸位：將 isReplaying 設回 false，並立即將黃色垃圾車 Marker 與地圖鏡頭恢復對齊至使用者的最新真實 GPS 位置
function restoreRealGpsAfterReplay(alignCamera = true) {
    isReplaying = false;
    window.isReplaying = false;
    if (vehicleAnimFrameId !== null) {
        cancelAnimationFrame(vehicleAnimFrameId);
        vehicleAnimFrameId = null;
    }

    const applyRealGpsToMarkerAndCamera = (lng, lat, heading) => {
        lastKnownLngLat = [lng, lat];
        currentHeading = typeof heading === 'number' && !isNaN(heading) ? heading : 0;
        vehicleVisualLngLat = [lng, lat];
        vehicleVisualHeading = currentHeading;
        if (vehicleMarker) {
            vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);
        }
        if (alignCamera && map) {
            setCameraFollow(true);
            map.easeTo({
                center: lastKnownLngLat,
                zoom: Math.max(map.getZoom(), 17),
                bearing: isHeadingUpMode ? currentHeading : 0,
                offset: [0, 100],
                duration: 450
            });
        }
    };

    if (lastValidGpsLng !== null && lastValidGpsLat !== null) {
        applyRealGpsToMarkerAndCamera(lastValidGpsLng, lastValidGpsLat, lastRealGpsHeading);
    } else if ('geolocation' in navigator) {
        // 若尚未有歷史真實定位快取，立即主動請求一次最新 GPS 並同步歸位
        if (vehicleMarker && Array.isArray(lastKnownLngLat)) {
            vehicleMarker.setLngLat(lastKnownLngLat).setRotation(currentHeading);
        }
        navigator.geolocation.getCurrentPosition(pos => {
            const filtered = processFilteredGpsPosition(pos);
            const lng = filtered ? filtered.lng : pos.coords.longitude;
            const lat = filtered ? filtered.lat : pos.coords.latitude;
            const head = filtered ? filtered.heading : lastRealGpsHeading;
            if (!isReplaying && typeof lng === 'number' && typeof lat === 'number') {
                applyRealGpsToMarkerAndCamera(lng, lat, head);
            }
        }, () => {}, { enableHighAccuracy: true, timeout: 6000 });
    }
}

function backToMain() {
    const wasReplaying = isReplaying;
    stopSmoothPlayback();
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
    isEditingMode = false;
    isReviewingPendingMode = false;
    reviewingPendingId = null;
    targetRouteId = null;
    reviewingPendingRoute = null;
    if (pendingReviewBanner) pendingReviewBanner.classList.add('hidden');
    if (pendingReviewActionRow) pendingReviewActionRow.classList.add('hidden');
    if (normalEditActionRow) normalEditActionRow.classList.remove('hidden');
    document.getElementById('editRouteBar')?.classList.add('hidden');
    selectedEditNodeIdx = -1;
    clearPathEditMarkers();
    cancelActiveFreehandStroke(true);
    freehandUndoStack = [];
    updateUndoFreehandBtnUI();
    updateNodeTrimPanelUI(null);
    try { map.dragPan.enable(); } catch (e) {}
    ensureEditorMapZoomEnabled();
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
    
    // 🚀 回到主畫面或離開重播時，將 isReplaying 設回 false，並將黃色垃圾車 Marker 與地圖鏡頭恢復對齊至最新真實 GPS 位置
    restoreRealGpsAfterReplay(wasReplaying || isFollowingCamera);
    
    releaseScreenWakeLockIfIdle();
    startIdleGPS();
}

document.getElementById('topBackBtn').onclick = (e) => {
    if (isReviewingPendingMode) {
        exitPendingReviewMode(true);
        return;
    }
    if (!document.getElementById('playbackUI').classList.contains('hidden')) {
        stopSmoothPlayback(); 
        VoiceQueue.clear(); 
        
        // 🚀 離開重播模式時，將 isReplaying 設回 false，先開啟路線預覽面板（不覆蓋鏡頭），再立即將黃色垃圾車與地圖鏡頭對齊真實 GPS 位置
        window.openRouteDetail(selectedRouteIdx, true);
        restoreRealGpsAfterReplay(true);
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
        if (isEditingMode) {
            document.getElementById('editPromptText').innerText = "🛠️ 標記完成！請點擊地圖軌跡選擇下一個『目標點』";
            updateRouteLayers(route.points);
            renderEditableRouteMarkers(route);
        } else {
            if (typeof persistSavedRoutesToStorage === 'function') {
                persistSavedRoutesToStorage();
            }
            refreshCurrentRouteMarkers(route);
        }
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
        if (isEditingMode && typeof pushEditUndoSnapshot === 'function') {
            pushEditUndoSnapshot(route);
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
            if (isEditingMode && typeof pushEditUndoSnapshot === 'function') {
                pushEditUndoSnapshot(route);
            }
            route.events.splice(eventIdx, 1);
            finishAlertModalCleanup(route);
        }
    };

    btnCancelAlertEdit.onclick = () => {
        editAlertModal.classList.add('hidden');
    };
}

