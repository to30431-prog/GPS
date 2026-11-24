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

// 入口 A（路線紀錄中「⚠️ 標註注意」）：立即鎖定當下 GPS 座標與時間戳記並開啟共用表單，背景 GPS 錄製 100% 不中斷
const recordCautionBtn = document.getElementById('recordCautionBtn');
if (recordCautionBtn) {
    recordCautionBtn.onclick = () => {
        if (!isRecording) return;
        const lockedLng = (typeof lastValidGpsLng === 'number' && !isNaN(lastValidGpsLng))
            ? lastValidGpsLng
            : (Array.isArray(lastKnownLngLat) ? lastKnownLngLat[0] : null);
        const lockedLat = (typeof lastValidGpsLat === 'number' && !isNaN(lastValidGpsLat))
            ? lastValidGpsLat
            : (Array.isArray(lastKnownLngLat) ? lastKnownLngLat[1] : null);
        if (typeof lockedLng !== 'number' || typeof lockedLat !== 'number') {
            alert('尚未取得有效 GPS 定位座標，請稍候再試！');
            return;
        }
        const lockedTime = Date.now();
        const lockedPtIdx = Math.max(0, routePoints.length - 1);
        const lockedBearing = Number(currentHeading) || 0;
        vibrate(35);

        if (window.CautionEditor && typeof window.CautionEditor.openForm === 'function') {
            window.CautionEditor.openForm({
                title: '紀錄中：標註注意點',
                initialNote: '',
                initialPhoto: '',
                lockedCoord: [lockedLng, lockedLat],
                lockedTime,
                onSave: ({ note, photo }) => {
                    const newAlertEv = {
                        type: 'alert',
                        note,
                        lng: lockedLng,
                        lat: lockedLat,
                        ptIdx: lockedPtIdx,
                        bearing: lockedBearing,
                        createdAt: lockedTime
                    };
                    if (photo) newAlertEv.photo = photo;
                    musicEvents.push(newAlertEv);
                    addPinMarker([lockedLng, lockedLat], `<div class="music-marker bg-amber-500 border-2 border-white shadow-lg text-white font-black"><i class="fa-solid fa-triangle-exclamation"></i> ${note.slice(0, 6)}</div>`);
                    vibrate([40, 25, 40]);
                    if (typeof showNavAlert === 'function') {
                        showNavAlert('⚠️', `已標註注意點：${note}`, 'bg-amber-600');
                    }
                }
            });
        }
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

// ==========================================
// ↕️ 鶯歌清運路線庫：跨平台原生輕量拖曳排序引擎（iOS Safari / WebKit ＋ Android Chrome）
// - 嚴格鎖定觸發手勢之 touchId / pointerId，阻絕多點觸控與背景重繪中斷拖拽
// - 僅鎖定把柄與拖曳中卡片，完整保留 #historyList 清單原生捲動
// - 單一 requestAnimationFrame 迴圈統一驅動 GPU translate3d 位移、插入指示線與 64px 邊界自動捲動
// - 拖曳中零 DOM 重建；僅在放開手時一次性換位並持久化存檔
// - 完整監聽 pointerup/pointercancel/touchend/touchcancel/blur/visibilitychange 徹底清理狀態
// ==========================================
const historyDragState = {
    active: false,
    inputMode: null, // 'touch' | 'pointer'
    pointerId: null,
    touchId: null,
    handleEl: null,
    listEl: null,
    filteredRoutes: null,
    draggedCard: null,
    floatingEl: null,
    indicatorEl: null,
    startIndex: -1,
    targetIndex: -1,
    startClientY: 0,
    currentClientY: 0,
    needsVisualUpdate: false,
    autoScrollRaf: null,
    listenersBound: false,
    pendingRerenderAfterDrag: false,
    lastFinishedAt: 0
};

function getHistoryCardElements(listEl) {
    if (!listEl) return [];
    return Array.from(listEl.children).filter(el => el.classList && el.classList.contains('route-lib-card'));
}

function updateHistoryDragVisualAndTarget() {
    if (!historyDragState.active || !historyDragState.listEl || !historyDragState.floatingEl) return;

    const dy = historyDragState.currentClientY - historyDragState.startClientY;
    historyDragState.floatingEl.style.transform = `translate3d(0, ${Math.round(dy)}px, 0) scale(1.015)`;

    const cards = getHistoryCardElements(historyDragState.listEl);
    if (cards.length === 0) return;

    const listRect = historyDragState.listEl.getBoundingClientRect();
    let nextTarget = cards.length;
    let indicatorY = listRect.bottom - 2;

    for (let i = 0; i < cards.length; i++) {
        const rect = cards[i].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (historyDragState.currentClientY < midY) {
            nextTarget = i;
            indicatorY = rect.top - 4;
            break;
        }
        indicatorY = rect.bottom + 4;
    }

    historyDragState.targetIndex = nextTarget;

    if (historyDragState.indicatorEl) {
        const clampedTop = Math.min(listRect.bottom - 3, Math.max(listRect.top + 1, Math.round(indicatorY)));
        const leftPx = Math.round(listRect.left + 12);
        const widthPx = Math.max(40, Math.round(listRect.width - 24));
        historyDragState.indicatorEl.style.width = `${widthPx}px`;
        historyDragState.indicatorEl.style.transform = `translate3d(${leftPx}px, ${clampedTop}px, 0)`;
    }
}

// 單一 requestAnimationFrame 迴圈：每幀合併處理位移、指示線與 64px 邊界自動捲動
function startHistoryDragFrameLoop() {
    if (historyDragState.autoScrollRaf !== null) {
        cancelAnimationFrame(historyDragState.autoScrollRaf);
        historyDragState.autoScrollRaf = null;
    }

    const edgeZonePx = 64;
    const maxStepPx = 14;

    const tick = () => {
        if (!historyDragState.active || !historyDragState.listEl || !historyDragState.listEl.isConnected) {
            historyDragState.autoScrollRaf = null;
            return;
        }
        const listEl = historyDragState.listEl;
        const rect = listEl.getBoundingClientRect();
        const y = historyDragState.currentClientY;
        const distTop = y - rect.top;
        const distBottom = rect.bottom - y;
        let scrolled = false;

        if (distTop < edgeZonePx && listEl.scrollTop > 0) {
            const ratio = Math.min(1, Math.max(0, (edgeZonePx - distTop) / edgeZonePx));
            const step = Math.max(2, Math.round(ratio * maxStepPx));
            const nextTop = Math.max(0, listEl.scrollTop - step);
            if (nextTop !== listEl.scrollTop) {
                listEl.scrollTop = nextTop;
                scrolled = true;
            }
        } else if (distBottom < edgeZonePx) {
            const maxScrollTop = Math.max(0, listEl.scrollHeight - listEl.clientHeight);
            if (listEl.scrollTop < maxScrollTop) {
                const ratio = Math.min(1, Math.max(0, (edgeZonePx - distBottom) / edgeZonePx));
                const step = Math.max(2, Math.round(ratio * maxStepPx));
                const nextTop = Math.min(maxScrollTop, listEl.scrollTop + step);
                if (nextTop !== listEl.scrollTop) {
                    listEl.scrollTop = nextTop;
                    scrolled = true;
                }
            }
        }

        if (historyDragState.needsVisualUpdate || scrolled) {
            historyDragState.needsVisualUpdate = false;
            updateHistoryDragVisualAndTarget();
        }
        historyDragState.autoScrollRaf = requestAnimationFrame(tick);
    };

    historyDragState.autoScrollRaf = requestAnimationFrame(tick);
}

function findMatchingTouch(touchList, targetId) {
    if (!touchList || targetId === null) return null;
    for (let i = 0; i < touchList.length; i++) {
        if (touchList[i].identifier === targetId) {
            return touchList[i];
        }
    }
    return null;
}

function onHistoryDragTouchMove(e) {
    if (!historyDragState.active || historyDragState.inputMode !== 'touch') return;
    // 嚴格僅追蹤起始觸控手指 identifier，忽略其他多指觸碰，絕不跳位
    const matchedTouch = findMatchingTouch(e.touches, historyDragState.touchId);
    if (!matchedTouch) return;
    if (e.cancelable) e.preventDefault();
    historyDragState.currentClientY = matchedTouch.clientY;
    historyDragState.needsVisualUpdate = true;
}

function onHistoryDragTouchEnd(e) {
    if (!historyDragState.active || historyDragState.inputMode !== 'touch') return;
    // 僅當起始拖曳的手指真正離開或被取消時才結束，忽略其他輔助手指的放開事件
    const endedMatch = findMatchingTouch(e.changedTouches, historyDragState.touchId);
    if (!endedMatch) return;

    const movedEnough = Math.abs(historyDragState.currentClientY - historyDragState.startClientY) > 16;
    const shouldCommit = e.type === 'touchend' || (e.type === 'touchcancel' && movedEnough);
    finishHistoryCardDrag(shouldCommit);
}

function onHistoryDragPointerMove(e) {
    if (!historyDragState.active || historyDragState.inputMode !== 'pointer') return;
    if (historyDragState.pointerId !== null && e.pointerId !== historyDragState.pointerId) return;
    if (e.cancelable) e.preventDefault();
    historyDragState.currentClientY = e.clientY;
    historyDragState.needsVisualUpdate = true;
}

function onHistoryDragPointerEnd(e) {
    if (!historyDragState.active || historyDragState.inputMode !== 'pointer') return;
    if (historyDragState.pointerId !== null && e.pointerId !== historyDragState.pointerId) return;

    const movedEnough = Math.abs(historyDragState.currentClientY - historyDragState.startClientY) > 16;
    const shouldCommit = e.type === 'pointerup' || (e.type === 'pointercancel' && movedEnough);
    finishHistoryCardDrag(shouldCommit);
}

function onHistoryDragInterrupt() {
    if (historyDragState.active) {
        const movedEnough = Math.abs(historyDragState.currentClientY - historyDragState.startClientY) > 16;
        finishHistoryCardDrag(movedEnough);
    }
}

function onHistoryDragVisibilityChange() {
    if (document.visibilityState === 'hidden' && historyDragState.active) {
        finishHistoryCardDrag(false);
    }
}

function bindHistoryDragGlobalListeners() {
    if (historyDragState.listenersBound) return;
    historyDragState.listenersBound = true;
    window.addEventListener('touchmove', onHistoryDragTouchMove, { passive: false });
    window.addEventListener('touchend', onHistoryDragTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onHistoryDragTouchEnd, { passive: true });
    window.addEventListener('pointermove', onHistoryDragPointerMove, { passive: false });
    window.addEventListener('pointerup', onHistoryDragPointerEnd, { passive: true });
    window.addEventListener('pointercancel', onHistoryDragPointerEnd, { passive: true });
    window.addEventListener('blur', onHistoryDragInterrupt);
    document.addEventListener('visibilitychange', onHistoryDragVisibilityChange);
}

function unbindHistoryDragGlobalListeners() {
    if (!historyDragState.listenersBound) return;
    historyDragState.listenersBound = false;
    window.removeEventListener('touchmove', onHistoryDragTouchMove, { passive: false });
    window.removeEventListener('touchend', onHistoryDragTouchEnd, { passive: true });
    window.removeEventListener('touchcancel', onHistoryDragTouchEnd, { passive: true });
    window.removeEventListener('pointermove', onHistoryDragPointerMove, { passive: false });
    window.removeEventListener('pointerup', onHistoryDragPointerEnd, { passive: true });
    window.removeEventListener('pointercancel', onHistoryDragPointerEnd, { passive: true });
    window.removeEventListener('blur', onHistoryDragInterrupt);
    document.removeEventListener('visibilitychange', onHistoryDragVisibilityChange);
}

function stopHistoryDragAutoScroll(listEl) {
    if (historyDragState.active) {
        finishHistoryCardDrag(false);
        return;
    }
    if (historyDragState.autoScrollRaf !== null) {
        cancelAnimationFrame(historyDragState.autoScrollRaf);
        historyDragState.autoScrollRaf = null;
    }
    unbindHistoryDragGlobalListeners();
    if (listEl) {
        listEl.classList.remove('is-sorting-routes');
    }
}

function finishHistoryCardDrag(commitDrop = false) {
    const wasActive = historyDragState.active;
    const listEl = historyDragState.listEl;
    const filteredRoutes = historyDragState.filteredRoutes;
    const draggedCard = historyDragState.draggedCard;
    const handleEl = historyDragState.handleEl;
    const prevPointerId = historyDragState.pointerId;
    const startIndex = historyDragState.startIndex;
    const rawTargetIndex = historyDragState.targetIndex;
    const shouldRerenderAfter = historyDragState.pendingRerenderAfterDrag;

    historyDragState.active = false;
    historyDragState.inputMode = null;
    historyDragState.pointerId = null;
    historyDragState.touchId = null;
    historyDragState.handleEl = null;
    historyDragState.needsVisualUpdate = false;
    historyDragState.pendingRerenderAfterDrag = false;
    if (wasActive) {
        historyDragState.lastFinishedAt = Date.now();
    }

    if (handleEl && prevPointerId !== null && typeof handleEl.releasePointerCapture === 'function') {
        try { handleEl.releasePointerCapture(prevPointerId); } catch (e) {}
    }

    if (historyDragState.autoScrollRaf !== null) {
        cancelAnimationFrame(historyDragState.autoScrollRaf);
        historyDragState.autoScrollRaf = null;
    }
    unbindHistoryDragGlobalListeners();

    if (historyDragState.floatingEl && historyDragState.floatingEl.parentNode) {
        historyDragState.floatingEl.parentNode.removeChild(historyDragState.floatingEl);
    }
    if (historyDragState.indicatorEl && historyDragState.indicatorEl.parentNode) {
        historyDragState.indicatorEl.parentNode.removeChild(historyDragState.indicatorEl);
    }
    historyDragState.floatingEl = null;
    historyDragState.indicatorEl = null;

    if (draggedCard) {
        draggedCard.classList.remove('route-card-drag-ghost', 'route-card-drag-unlocked');
    }

    historyDragState.listEl = null;
    historyDragState.filteredRoutes = null;
    historyDragState.draggedCard = null;
    historyDragState.startIndex = -1;
    historyDragState.targetIndex = -1;

    let didReorder = false;
    if (wasActive && commitDrop && listEl && Array.isArray(filteredRoutes) && draggedCard) {
        const cards = getHistoryCardElements(listEl);
        if (startIndex >= 0 && startIndex < cards.length && rawTargetIndex >= 0) {
            let finalIndex = rawTargetIndex > startIndex ? rawTargetIndex - 1 : rawTargetIndex;
            finalIndex = Math.max(0, Math.min(cards.length - 1, finalIndex));

            if (finalIndex !== startIndex) {
                const fromIdx = filteredRoutes[startIndex]?.originalIdx;
                const toIdx = filteredRoutes[finalIndex]?.originalIdx;
                if (fromIdx !== undefined && toIdx !== undefined) {
                    // 1. 放開後一次性移動 DOM 節點，避免拖曳期間反覆重排
                    const referenceNode = rawTargetIndex < cards.length ? cards[rawTargetIndex] : null;
                    if (referenceNode && referenceNode !== draggedCard) {
                        listEl.insertBefore(draggedCard, referenceNode);
                    } else if (!referenceNode) {
                        listEl.appendChild(draggedCard);
                    }

                    // 2. 更新 savedRoutes 與 filteredRoutes 排序陣列並原地同步每張卡片索引
                    const movedItem = savedRoutes.splice(fromIdx, 1)[0];
                    savedRoutes.splice(toIdx, 0, movedItem);
                    const [movedFiltered] = filteredRoutes.splice(startIndex, 1);
                    filteredRoutes.splice(finalIndex, 0, movedFiltered);

                    const updatedCards = getHistoryCardElements(listEl);
                    filteredRoutes.forEach((entry, i) => {
                        const syncedIdx = savedRoutes.indexOf(entry.route);
                        entry.originalIdx = syncedIdx;
                        if (updatedCards[i]) {
                            updatedCards[i].dataset.routeIdx = String(syncedIdx);
                        }
                    });

                    didReorder = true;

                    // 3. 確實儲存最新排序至 localforage
                    localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).catch((err) => {
                        console.error('[RouteSort] 儲存路線排序失敗:', err);
                        if (typeof showToast === 'function') {
                            showToast('⚠️ 路線排序儲存失敗，請稍後再試');
                        }
                    });
                }
            }
        }
    }

    // 若拖拽期間有背景更新要求重繪清單，待放開完成存檔後再安全補繪（不干擾拖拽手感）
    if (shouldRerenderAfter) {
        setTimeout(() => {
            if (!historyDragState.active && typeof renderHistoryList === 'function') {
                renderHistoryList();
            }
        }, didReorder ? 120 : 0);
    }
}

function startHistoryCardDrag({ listEl, filteredRoutes, card, handleEl = null, clientY, inputMode, pointerId = null, touchId = null }) {
    if (!listEl || !card || !Array.isArray(filteredRoutes)) return;
    if (historyDragState.active) {
        finishHistoryCardDrag(false);
    }

    const cards = getHistoryCardElements(listEl);
    const startIndex = cards.indexOf(card);
    if (startIndex < 0) return;

    const rect = card.getBoundingClientRect();
    const floatingEl = card.cloneNode(true);
    floatingEl.classList.remove('route-card-drag-ghost');
    floatingEl.classList.add('route-card-drag-fallback', 'route-card-drag-unlocked');
    floatingEl.style.position = 'fixed';
    floatingEl.style.left = `${Math.round(rect.left)}px`;
    floatingEl.style.top = `${Math.round(rect.top)}px`;
    floatingEl.style.width = `${Math.round(rect.width)}px`;
    floatingEl.style.height = `${Math.round(rect.height)}px`;
    floatingEl.style.transform = 'translate3d(0, 0, 0) scale(1.015)';
    document.body.appendChild(floatingEl);

    const indicatorEl = document.createElement('div');
    indicatorEl.className = 'route-card-drop-indicator';
    document.body.appendChild(indicatorEl);

    card.classList.add('route-card-drag-ghost');

    historyDragState.active = true;
    historyDragState.inputMode = inputMode;
    historyDragState.pointerId = pointerId;
    historyDragState.touchId = touchId;
    historyDragState.handleEl = handleEl;
    historyDragState.listEl = listEl;
    historyDragState.filteredRoutes = filteredRoutes;
    historyDragState.draggedCard = card;
    historyDragState.floatingEl = floatingEl;
    historyDragState.indicatorEl = indicatorEl;
    historyDragState.startIndex = startIndex;
    historyDragState.targetIndex = startIndex;
    historyDragState.startClientY = clientY;
    historyDragState.currentClientY = clientY;
    historyDragState.needsVisualUpdate = true;
    historyDragState.pendingRerenderAfterDrag = false;

    if (inputMode === 'pointer' && handleEl && pointerId !== null && typeof handleEl.setPointerCapture === 'function') {
        try { handleEl.setPointerCapture(pointerId); } catch (e) {}
    }

    try { vibrate(20); } catch (e) {}
    bindHistoryDragGlobalListeners();
    updateHistoryDragVisualAndTarget();
    startHistoryDragFrameLoop();
}

function renderHistoryList() {
    const list = document.getElementById('historyList');
    if (!list) return;
    // 嚴禁在手指按住拖拽排序期間重建整份清單 DOM，改為標記待拖拽結束後自動補繪
    if (historyDragState.active) {
        historyDragState.pendingRerenderAfterDrag = true;
        return;
    }
    stopHistoryDragAutoScroll(list);
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
        card.dataset.routeIdx = String(originalIdx);
        card.className = updateInfo.hasUpdate
            ? "route-lib-card route-lib-card-has-update bg-gradient-to-r from-white to-orange-50/50 px-2.5 py-1.5 rounded-xl shadow-sm border-2 border-orange-300 flex items-stretch gap-1 transition-transform"
            : "route-lib-card bg-white px-2.5 py-1.5 rounded-xl shadow-sm border border-gray-100 flex items-stretch gap-1 transition-transform";

        const authorTag = r.author
            ? `<span class="route-lib-author-badge bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0"><i class="fa-solid fa-user-ninja mr-0.5"></i>${r.author}</span>`
            : '';

        const versionBadgeHtml = updateInfo.hasUpdate
            ? `<span class="bg-gradient-to-r from-orange-500 to-red-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-black whitespace-nowrap shadow-sm animate-pulse flex-shrink-0">v${updateInfo.localVer}➔v${updateInfo.cloudVer}</span>`
            : `<span class="route-lib-ver-badge bg-gray-100 text-gray-600 text-[10px] px-1.5 py-0.5 rounded-md font-extrabold whitespace-nowrap flex-shrink-0">v${updateInfo.localVer}</span>`;

        const cloudTimeHtml = updateInfo.hasUpdate
            ? `<span class="text-[10px] font-extrabold text-orange-600 whitespace-nowrap flex-shrink-0">☁️ ${updateInfo.updateTimeText}</span>`
            : `<span class="route-lib-date text-[10px] font-bold text-gray-400 whitespace-nowrap flex-shrink-0">${r.date || ''}</span>`;

        const editBtnHtml = (typeof canCurrentUserManageRoutes === 'function' && canCurrentUserManageRoutes())
            ? `<button type="button" class="edit-name-btn text-gray-400 hover:text-amber-500 w-6 h-6 flex items-center justify-center rounded-lg active:bg-gray-100 transition-colors flex-shrink-0" title="更改名稱"><i class="fa-solid fa-pen text-[11px]"></i></button>`
            : '';

        card.innerHTML = `
            <div class="drag-handle text-red-400 w-7 min-h-[36px] -ml-1 -my-1 px-1 flex items-center justify-center cursor-grab active:cursor-grabbing hover:text-red-500 flex-shrink-0 rounded-l-xl" title="按住拖曳排序">
                <i class="fa-solid fa-grip-vertical text-base pointer-events-none"></i>
            </div>
            <div class="route-card-info flex-1 min-w-0 flex flex-col justify-center gap-1 cursor-pointer">
                <div class="flex items-center justify-between gap-1.5 min-w-0">
                    <div class="flex items-center gap-1 flex-wrap min-w-0 flex-1">
                        <span class="route-lib-title font-black text-gray-900 text-[13.5px] leading-tight break-words">${r.name}</span>
                        ${versionBadgeHtml}
                        ${authorTag}
                    </div>
                    <div class="flex items-center gap-1 flex-shrink-0">
                        ${cloudTimeHtml}
                        ${editBtnHtml}
                    </div>
                </div>
                <div class="flex items-center justify-between gap-1.5 min-w-0">
                    <div class="route-lib-stats flex items-center gap-2.5 flex-wrap text-[11px] font-bold min-w-0">
                        <span class="route-lib-stat-dist text-blue-600 whitespace-nowrap"><i class="fa-solid fa-route mr-0.5"></i>${r.distance} km</span>
                        <span class="route-lib-stat-events text-green-600 whitespace-nowrap"><i class="fa-solid fa-music mr-0.5"></i>${(r.events||[]).length} 處標記</span>
                    </div>
                    <div class="flex items-center gap-1 flex-shrink-0">
                        ${updateInfo.hasUpdate ? `
                        <button type="button" class="update-from-cloud-btn bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white px-2 py-0.5 rounded-lg text-[10.5px] font-black shadow-sm flex items-center gap-0.5 active:scale-95 transition-all whitespace-nowrap" title="立即覆蓋更新為雲端最新版">
                            🔄 更新路線
                        </button>` : ''}
                        <button type="button" class="upload-cloud-btn bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 px-2 py-0.5 rounded-lg text-[10.5px] font-extrabold flex items-center gap-0.5 active:scale-95 transition-all whitespace-nowrap" title="上傳分享至車隊雲端">
                            ⬆️ 上傳至雲端
                        </button>
                    </div>
                </div>
            </div>
        `;

        card.querySelector('.route-card-info').onclick = () => {
            if (historyDragState.active || (Date.now() - historyDragState.lastFinishedAt) < 300) return;
            const idx = Number(card.dataset.routeIdx);
            if (!isNaN(idx)) window.openRouteDetail(idx);
        };
        const editNameBtn = card.querySelector('.edit-name-btn');
        if (editNameBtn) {
            editNameBtn.onclick = (e) => {
                e.stopPropagation();
                if (typeof canCurrentUserManageRoutes === 'function' && !canCurrentUserManageRoutes()) return;
                const idx = Number(card.dataset.routeIdx);
                const targetRoute = savedRoutes[idx];
                if (!targetRoute) return;
                const newName = prompt('請輸入新的路線名稱：', targetRoute.name);
                if (newName && newName.trim() !== '') {
                    targetRoute.name = newName.trim();
                    targetRoute.updatedAt = Date.now();
                    localforage.setItem('yinggeCleanRoutes_v2', savedRoutes).then(() => renderHistoryList());
                }
            };
        }
        const updateCloudBtn = card.querySelector('.update-from-cloud-btn');
        if (updateCloudBtn && updateInfo.hasUpdate && updateInfo.cloudRoute) {
            updateCloudBtn.onclick = (e) => {
                e.stopPropagation();
                const idx = Number(card.dataset.routeIdx);
                if (!isNaN(idx)) applySingleCloudRouteUpdate(idx, updateInfo.cloudRoute);
            };
        }
        const uploadBtn = card.querySelector('.upload-cloud-btn');
        uploadBtn.onclick = (e) => {
            e.stopPropagation();
            const idx = Number(card.dataset.routeIdx);
            if (!isNaN(idx)) uploadRouteToCloud(idx, uploadBtn);
        };
        const dragHandle = card.querySelector('.drag-handle');
        if (dragHandle) {
            dragHandle.addEventListener('contextmenu', (e) => e.preventDefault());
            dragHandle.addEventListener('selectstart', (e) => e.preventDefault());
            dragHandle.addEventListener('touchstart', (e) => {
                if (!e.changedTouches || e.changedTouches.length === 0) return;
                if (e.touches && e.touches.length > 1) return;
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
                const touch = e.changedTouches[0];
                startHistoryCardDrag({
                    listEl: list,
                    filteredRoutes,
                    card,
                    handleEl: dragHandle,
                    clientY: touch.clientY,
                    inputMode: 'touch',
                    touchId: touch.identifier
                });
            }, { passive: false });
            dragHandle.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'touch') return; // 觸控統一由 { passive: false } touchstart/touchmove 接管，相容 iOS Safari 與 Android Chrome
                if (e.button !== undefined && e.button !== 0) return;
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
                startHistoryCardDrag({
                    listEl: list,
                    filteredRoutes,
                    card,
                    handleEl: dragHandle,
                    clientY: e.clientY,
                    inputMode: 'pointer',
                    pointerId: e.pointerId
                });
            });
        }
        list.appendChild(card);
    });

    if (window.sortableInstance) {
        try { window.sortableInstance.destroy(); } catch (e) {}
        window.sortableInstance = null;
    }
}

document.getElementById('historyBtn').onclick = () => {
    renderHistoryList();
    historyModal.classList.remove('hidden');
    if (typeof checkCloudRouteUpdatesInBackground === 'function') {
        checkCloudRouteUpdatesInBackground(false);
    }
};
document.getElementById('closeHistory').onclick = (e) => { 
    e.stopPropagation();
    stopHistoryDragAutoScroll(document.getElementById('historyList'));
    historyModal.classList.add('hidden');
    backToMain(); 
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

const detailUploadCloudBtnEl = document.getElementById('detailUploadCloudBtn');
if (detailUploadCloudBtnEl) {
    detailUploadCloudBtnEl.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (selectedRouteIdx >= 0 && selectedRouteIdx < savedRoutes.length && typeof uploadRouteToCloud === 'function') {
            uploadRouteToCloud(selectedRouteIdx, detailUploadCloudBtnEl);
        }
    };
}

// ==========================================
// 🛠️ 統一版路線編輯引擎（拖曳微調 ＋ 虛擬中點 ＋ 節點修剪 ＋ 手繪延伸/剪接 ＋ 引線備忘框 ＋ 10步Undo）
// ==========================================
let isEditingMode = false, originalEventsBackup = [], originalPointsBackup = [], originalCalloutsBackup = [];
let editStep = 0, editStartIndex = -1, tempMarkerA = null;
let editSubMode = 'path', pathEditMarkers = [];
let selectedEditNodeIdx = -1;
let activeDraggingEditNodeIdx = -1;
let lastEditNodeDragEndTime = 0;

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
    if (!map) return false;
    try {
        if (!map.getStyle()) return false;
    } catch (e) {
        return false;
    }
    try {
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
    } catch (e) {
        return false;
    }
}

function updateFreehandTempLayer(coords) {
    if (!map) return;
    const isClearing = (!Array.isArray(coords) || coords.length < 2);
    if (isClearing) {
        try {
            const src = map.getSource('freehand-temp-source');
            if (src) {
                src.setData(emptyGeoJSON());
                if (typeof map.triggerRepaint === 'function') map.triggerRepaint();
            }
        } catch (e) {}
        return;
    }
    if (!ensureFreehandTempLayer()) return;
    try {
        map.getSource('freehand-temp-source')?.setData({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords }
            }]
        });
    } catch (e) {}
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
    if (isEditingMode && editSubMode === 'freehand') {
        try { map.dragPan.disable(); } catch (e) {}
    } else {
        try { map.dragPan.enable(); } catch (e) {}
    }
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
        const isMusic = Boolean(pts[i].musicActive !== undefined ? pts[i].musicActive : pts[i].music);
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
// 單一節點拖曳後的純局部更新：只重算受影響相鄰區段的方位角與總里程，絕不重算整條路線、不更動既有音樂樣式 (musicActive/music)、不重建 events 或站牌
function updateLocalRouteAfterNodeDrag(route, affectedStartIdx, affectedEndIdx) {
    if (!route || !Array.isArray(route.points) || route.points.length === 0) return;
    const pts = route.points;
    const fromIdx = Math.max(1, Number(affectedStartIdx) || 1);
    const toIdx = Math.min(pts.length - 1, (Number(affectedEndIdx) || (pts.length - 1)) + 1);

    for (let i = fromIdx; i <= toIdx; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const dKm = getDistanceKm(prev.lng, prev.lat, curr.lng, curr.lat);
        if (dKm * 1000 > 0.05) {
            curr.bearing = getBearing(prev.lng, prev.lat, curr.lng, curr.lat);
        }
    }
    if (pts.length >= 2 && fromIdx <= 1) {
        pts[0].bearing = pts[1].bearing || 0;
    }

    let totalDistKm = 0;
    for (let i = 1; i < pts.length; i++) {
        totalDistKm += getDistanceKm(pts[i - 1].lng, pts[i - 1].lat, pts[i].lng, pts[i].lat);
    }
    route.distance = totalDistKm.toFixed(2);
}

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

        let dragOrigNodeLng = pt.lng;
        let dragOrigNodeLat = pt.lat;
        let dragLocalWindowOrig = null;
        let dragAffectedMinIdx = prevKeyIdx;
        let dragAffectedMaxIdx = nextKeyIdx;
        let dragPrev1Dense = false;
        let dragPrev2Dense = false;
        let dragNext1Dense = false;
        let dragNext2Dense = false;

        m.on('dragstart', () => {
            // 嚴格鎖定單一拖曳頂點：若已有另一顆頂點正在拖曳中，禁止中途切換或搶走焦點
            if (activeDraggingEditNodeIdx !== -1 && activeDraggingEditNodeIdx !== ptIdx) return;
            activeDraggingEditNodeIdx = ptIdx;
            pushEditUndoSnapshot(route);
            selectedEditNodeIdx = ptIdx;
            dragOrigNodeLng = pt.lng;
            dragOrigNodeLat = pt.lat;

            // 暫時停用其餘鄰近節點的 pointer-events，避免手指滑過相鄰節點（如 #680/#681/#682）時誤搶焦點
            pathEditMarkers.forEach(otherM => {
                if (otherM !== m) {
                    try {
                        const otherEl = otherM.getElement();
                        if (otherEl) otherEl.style.pointerEvents = 'none';
                    } catch (err) {}
                }
            });

            // 記錄受影響局部範圍原始座標（含前後關鍵區段與相鄰 1～2 個頂點）
            dragAffectedMinIdx = Math.max(0, Math.min(prevKeyIdx, ptIdx - 2));
            dragAffectedMaxIdx = Math.min(pts.length - 1, Math.max(nextKeyIdx, ptIdx + 2));
            dragLocalWindowOrig = new Map();
            for (let k = dragAffectedMinIdx; k <= dragAffectedMaxIdx; k++) {
                if (pts[k]) {
                    dragLocalWindowOrig.set(k, { lng: pts[k].lng, lat: pts[k].lat });
                }
            }

            // 判斷前後 1～2 個相鄰頂點是否屬於「相鄰點距 < 15 公尺」的密集軌跡段
            // （僅密集段啟用鄰點微幅平滑防 V 字折角；點距 >= 15m 的手繪轉折點保持原折角不強行拉圓）
            const DENSE_NEIGHBOR_MAX_METERS = 15;
            dragPrev1Dense = false;
            dragPrev2Dense = false;
            dragNext1Dense = false;
            dragNext2Dense = false;

            if (ptIdx - 1 > 0 && pts[ptIdx - 1] && !pts[ptIdx - 1].is_stop) {
                const dPrev1 = getDistanceKm(pt.lng, pt.lat, pts[ptIdx - 1].lng, pts[ptIdx - 1].lat) * 1000;
                if (dPrev1 < DENSE_NEIGHBOR_MAX_METERS) {
                    dragPrev1Dense = true;
                    if (ptIdx - 2 > 0 && pts[ptIdx - 2] && !pts[ptIdx - 2].is_stop) {
                        const dPrev2 = getDistanceKm(pts[ptIdx - 1].lng, pts[ptIdx - 1].lat, pts[ptIdx - 2].lng, pts[ptIdx - 2].lat) * 1000;
                        if (dPrev2 < DENSE_NEIGHBOR_MAX_METERS) {
                            dragPrev2Dense = true;
                        }
                    }
                }
            }
            if (ptIdx + 1 < pts.length - 1 && pts[ptIdx + 1] && !pts[ptIdx + 1].is_stop) {
                const dNext1 = getDistanceKm(pt.lng, pt.lat, pts[ptIdx + 1].lng, pts[ptIdx + 1].lat) * 1000;
                if (dNext1 < DENSE_NEIGHBOR_MAX_METERS) {
                    dragNext1Dense = true;
                    if (ptIdx + 2 < pts.length - 1 && pts[ptIdx + 2] && !pts[ptIdx + 2].is_stop) {
                        const dNext2 = getDistanceKm(pts[ptIdx + 1].lng, pts[ptIdx + 1].lat, pts[ptIdx + 2].lng, pts[ptIdx + 2].lat) * 1000;
                        if (dNext2 < DENSE_NEIGHBOR_MAX_METERS) {
                            dragNext2Dense = true;
                        }
                    }
                }
            }

            // 拖曳時自動收起回迷你小膠囊，確保拖曳微調時視野零遮擋
            isNodeTrimDrawerExpanded = false;
            updateNodeTrimPanelUI(route);
        });

        m.on('drag', () => {
            if (activeDraggingEditNodeIdx !== ptIdx) return;
            const lngLat = m.getLngLat();
            // 扣除視覺平行偏移量，確保實際寫入 route.points 的座標維持真實道路座標且不跳位
            const newLng = Number((lngLat.lng - initDLng).toFixed(6));
            const newLat = Number((lngLat.lat - initDLat).toFixed(6));
            const deltaLng = newLng - dragOrigNodeLng;
            const deltaLat = newLat - dragOrigNodeLat;

            pt.lng = newLng;
            pt.lat = newLat;
            pt.isKeyNode = true;

            // 局部平滑位移：合併關鍵區段線性權重與密集段（< 15m）前後 1～2 鄰點防 V 字折角平滑權重
            if (dragLocalWindowOrig) {
                for (let idx = dragAffectedMinIdx; idx <= dragAffectedMaxIdx; idx++) {
                    if (idx === ptIdx) continue;
                    const orig = dragLocalWindowOrig.get(idx);
                    if (!orig || !pts[idx]) continue;

                    let spanWeight = 0;
                    if (idx > prevKeyIdx && idx < ptIdx && ptIdx > prevKeyIdx + 1) {
                        spanWeight = (idx - prevKeyIdx) / (ptIdx - prevKeyIdx);
                    } else if (idx > ptIdx && idx < nextKeyIdx && nextKeyIdx > ptIdx + 1) {
                        spanWeight = (nextKeyIdx - idx) / (nextKeyIdx - ptIdx);
                    }

                    let denseWeight = 0;
                    if (idx === ptIdx - 1 && dragPrev1Dense) denseWeight = 0.55;
                    else if (idx === ptIdx - 2 && dragPrev2Dense) denseWeight = 0.25;
                    else if (idx === ptIdx + 1 && dragNext1Dense) denseWeight = 0.55;
                    else if (idx === ptIdx + 2 && dragNext2Dense) denseWeight = 0.25;

                    const weight = Math.max(spanWeight, denseWeight);
                    if (weight > 0) {
                        pts[idx].lng = Number((orig.lng + deltaLng * weight).toFixed(6));
                        pts[idx].lat = Number((orig.lat + deltaLat * weight).toFixed(6));
                    }
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
            if (activeDraggingEditNodeIdx !== ptIdx) return;
            activeDraggingEditNodeIdx = -1;
            lastEditNodeDragEndTime = Date.now();
            dragLocalWindowOrig = null;
            isNodeTrimDrawerExpanded = false;
            // 僅執行局部距離與方位角更新，嚴禁二次回彈或重算整條路線
            updateLocalRouteAfterNodeDrag(route, dragAffectedMinIdx, dragAffectedMaxIdx);
            updateRouteLayers(route.points, 0);
            renderPathEditNodes(route);
            updateNodeTrimPanelUI(route);
            const promptEl = document.getElementById('editPromptText');
            if (promptEl) {
                promptEl.innerText = `✅ 已局部微調節點 #${ptIdx + 1} 位置（總距離 ${route.distance} km）`;
            }
        });

        el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (activeDraggingEditNodeIdx !== -1 || (Date.now() - lastEditNodeDragEndTime < 220)) return;
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

// 執行兩舊節點之間的剪接替換（將 minIdx 與 maxIdx 之間的多餘舊路徑真正刪除並替換為橘色手繪新座標，強制重繪綠線並清空草稿圖層）
function applySpliceBetweenNodes(route, startIdx, endIdx, rawCoords) {
    if (!route || !Array.isArray(route.points) || !Array.isArray(rawCoords) || rawCoords.length < 2) return;
    const pts = route.points;
    if (startIdx < 0 || endIdx < 0 || startIdx >= pts.length || endIdx >= pts.length || startIdx === endIdx) return;

    const preservedStops = pts
        .filter(p => p.is_stop)
        .map(p => ({ lng: p.lng, lat: p.lat, stop_name: p.stop_name, scheduled_time: p.scheduled_time }));

    pushEditUndoSnapshot(route);

    // 正確比較起點索引 startIdx 與終點索引 endIdx（若反向選取則自動反轉手繪草稿順向對齊）
    const isForward = (startIdx <= endIdx);
    const idxStart = Math.min(startIdx, endIdx);
    const idxEnd = Math.max(startIdx, endIdx);

    const orderedCoords = isForward ? rawCoords.map(c => [Number(c[0]), Number(c[1])]) : rawCoords.map(c => [Number(c[0]), Number(c[1])]).reverse();
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
        lng: Number(lng),
        lat: Number(lat),
        time: Date.now(),
        musicActive: inheritedMusic,
        music: inheritedMusic,
        bearing: 0,
        isKeyNode: (i === 0 || i === densified.length - 1)
    }));

    // 真正刪除主路線座標陣列中 idxStart..idxEnd 的舊節點，替換為新的手繪草稿座標點
    pts.splice(idxStart, idxEnd - idxStart + 1, ...newSegmentPoints);
    route.points = pts;

    // 立即重置所有手繪剪修草稿狀態並清空橘色虛線圖層（避免橘色虛線與暫存起終點殘留）
    isFreehandDrawing = false;
    freehandStartIndex = -1;
    freehandStrokeCoords = [];
    freehandSpliceStartIdx = -1;
    freehandDraftCoords = [];
    updateFreehandTempLayer([]);

    // 重新計算總距離、方位角與標記點索引
    syncRouteMarkersAndIndicesAfterSpline(route, preservedStops, true);
    vibrate([40, 30, 40]);

    // 強制非節流重繪主路線（綠線／藍線／灰線）與清除草稿來源，確保地圖立刻貼合新形狀
    updateRouteLayers(route.points, 0);
    try {
        map.getSource('bg-route')?.setData(cachedBgRouteGeoJSON || emptyGeoJSON());
        map.getSource('route-music')?.setData(cachedMusicRouteGeoJSON || emptyGeoJSON());
        map.getSource('route-Silent')?.setData(cachedSilentRouteGeoJSON || emptyGeoJSON());
        map.getSource('freehand-temp-source')?.setData(emptyGeoJSON());
        if (typeof map.triggerRepaint === 'function') map.triggerRepaint();
    } catch (e) {}

    renderEditableRouteMarkers(route);
    renderFreehandSpliceNodes(route);

    // 確保手繪模式維持「單指畫線、雙指縮放平移」手勢狀態
    if (isEditingMode && editSubMode === 'freehand') {
        try { map.dragPan.disable(); } catch (e) {}
    }
    ensureEditorMapZoomEnabled();

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
    activeDraggingEditNodeIdx = -1;
    ensureEditorMapZoomEnabled();
    if (mode === 'freehand') {
        // 啟用「✍️ 手繪」模式：預設單指畫線、雙指平移／縮放（停用單指 dragPan，保留 touchZoomRotate）
        try { map.dragPan.disable(); } catch (e) {}
    } else {
        try { map.dragPan.enable(); } catch (e) {}
    }

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

// 綁定地圖容器的手繪延伸／剪接事件：
// - 手繪模式預設單指畫線（dragPan 停用）、雙指平移／縮放（touchZoomRotate 啟用）
// - 偵測到 >= 2 指立即取消未完成筆畫與暫存起點（防兩指時間差長出尖角）並交還地圖縮放平移；放開後完整重置狀態防卡死
// - 最小有效筆畫門檻 8 公尺（< 8m 視為誤觸自動取消）
(function setupFreehandSplineDrawing() {
    const canvasContainer = map.getCanvasContainer();
    const EDITOR_FREEHAND_MIN_STROKE_METERS = 8;

    function getLngLatFromClientXY(clientX, clientY) {
        const rect = canvasContainer.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        return map.unproject([x, y]);
    }

    function restoreFreehandModeMapGestures() {
        if (isEditingMode && editSubMode === 'freehand') {
            try { map.dragPan.disable(); } catch (e) {}
        } else {
            try { map.dragPan.enable(); } catch (e) {}
        }
        ensureEditorMapZoomEnabled();
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
        const visualPts = computeVisualRightOffsetCoords(pts);

        // 計算與當前編輯路線所有節點的最近距離（同時比對真實座標與視覺偏移座標）
        let minStartDistM = Infinity;
        let closestStartIdx = -1;
        for (let i = 0; i < pts.length; i++) {
            const dRaw = getDistanceKm(lngLat.lng, lngLat.lat, pts[i].lng, pts[i].lat) * 1000;
            const vPt = visualPts[i] || pts[i];
            const dVis = getDistanceKm(lngLat.lng, lngLat.lat, vPt.lng, vPt.lat) * 1000;
            const dM = Math.min(dRaw, dVis);
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
            return;
        }

        // 停用單指 dragPan 避免畫面跟著單指跑，同時保留 touchZoomRotate 與 scrollZoom 開啟
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
        // 不在 touchstart 當下立刻畫線，待實際單指移動（handleStrokeMove）才渲染橘色草稿，避免雙指落點時間差閃出尖角
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
        restoreFreehandModeMapGestures();

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
        // 最小有效筆畫門檻：移動距離小於 8 公尺視為誤觸自動取消，不修改路線
        if (strokeLenM < EDITOR_FREEHAND_MIN_STROKE_METERS) {
            updateFreehandTempLayer(freehandDraftCoords.length >= 2 ? freehandDraftCoords : []);
            freehandStrokeCoords = [];
            freehandStartIndex = -1;
            return;
        }

        // 計算手繪終點與原路線所有節點的最近距離（同時比對真實座標與視覺偏移座標）
        const visualPts = computeVisualRightOffsetCoords(pts);
        let minEndDistM = Infinity;
        let closestEndIdx = -1;
        for (let i = 0; i < pts.length; i++) {
            const dRaw = getDistanceKm(endLng, endLat, pts[i].lng, pts[i].lat) * 1000;
            const vPt = visualPts[i] || pts[i];
            const dVis = getDistanceKm(endLng, endLat, vPt.lng, vPt.lat) * 1000;
            const dM = Math.min(dRaw, dVis);
            if (dM < minEndDistM) {
                minEndDistM = dM;
                closestEndIdx = i;
            }
        }

        // 情境 A（剪接替換）：終點連回原路線上另一個舊節點（距離 < 45 公尺且非同一點）➔ 自動剪除兩舊節點之間的多餘舊路徑並無縫替換
        if (minEndDistM < 45 && closestEndIdx !== -1 && closestEndIdx !== startIndex) {
            const committedStroke = freehandStrokeCoords.slice();
            freehandStrokeCoords = [];
            freehandStartIndex = -1;
            applySpliceBetweenNodes(route, startIndex, closestEndIdx, committedStroke);
            return;
        }
        // 情境 B（頭尾延伸）：從路線頭尾端點附近（前後 6 點內）向外畫線延伸
        else if (startIndex <= 5 || startIndex >= pts.length - 6) {
            const committedStroke = freehandStrokeCoords.slice();
            freehandStrokeCoords = [];
            freehandStartIndex = -1;
            applyExtendFromEndpoint(route, startIndex, committedStroke);
            updateFreehandTempLayer([]);
            return;
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

    function abortStrokeForMultiTouch() {
        isMultiTouchGestureActive = true;
        // 立即取消／清除尚未完成的當前手繪筆畫與暫存起點（避免兩指落點時間差長出尖角）
        isFreehandDrawing = false;
        freehandStartIndex = -1;
        freehandStrokeCoords = [];
        updateFreehandTempLayer(freehandDraftCoords.length >= 2 ? freehandDraftCoords : []);
        // 雙指手勢期間交還控制權給地圖執行正常縮放平移
        try { map.dragPan.enable(); } catch (err) {}
        ensureEditorMapZoomEnabled();
    }

    canvasContainer.addEventListener('touchstart', (e) => {
        if (!isEditingMode || editSubMode !== 'freehand') return;
        ensureEditorMapZoomEnabled();
        if (!e.touches) return;

        // 只要螢幕上同時有 2 根以上手指（touches.length >= 2），立即取消未完成手繪並交還地圖縮放平移
        if (e.touches.length >= 2) {
            abortStrokeForMultiTouch();
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

        if (e.touches.length >= 2) {
            abortStrokeForMultiTouch();
            return;
        }

        if (isMultiTouchGestureActive || !isFreehandDrawing) return;

        if (e.touches.length === 1) {
            if (e.cancelable) e.preventDefault();
            const touch = e.touches[0];
            handleStrokeMove(touch.clientX, touch.clientY);
        }
    }, { passive: false });

    canvasContainer.addEventListener('touchend', (e) => {
        const remaining = e.touches ? e.touches.length : 0;
        if (!isEditingMode || editSubMode !== 'freehand') {
            if (remaining === 0) {
                isMultiTouchGestureActive = false;
                isFreehandDrawing = false;
                freehandStartIndex = -1;
                freehandStrokeCoords = [];
            }
            return;
        }

        if (isMultiTouchGestureActive) {
            isFreehandDrawing = false;
            freehandStartIndex = -1;
            freehandStrokeCoords = [];
            if (remaining === 0) {
                // 雙指結束放開：完整重置手繪狀態旗標與地圖手勢鎖定狀態，防卡住滑不動或畫不出線
                isMultiTouchGestureActive = false;
                restoreFreehandModeMapGestures();
            }
            return;
        }

        if (remaining === 0) {
            handleStrokeEnd();
        }
    }, { passive: true });

    canvasContainer.addEventListener('touchcancel', (e) => {
        const remaining = e.touches ? e.touches.length : 0;
        isFreehandDrawing = false;
        freehandStartIndex = -1;
        freehandStrokeCoords = [];
        updateFreehandTempLayer(freehandDraftCoords.length >= 2 ? freehandDraftCoords : []);
        if (remaining === 0) {
            isMultiTouchGestureActive = false;
            restoreFreehandModeMapGestures();
        }
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
// ✏️ 手繪自由路線 ＋ 📍 點到點拉線（邏輯徹底分離，各自獨立處理，且與家具串路線完全隔離）
// - 手繪自由畫路線：100% 忠實保留使用者手繪原始座標，嚴禁呼叫 OSRM Map Matching 或任何路網吸附演算法
// - 點到點自動貼齊：獨立呼叫 OSRM foot 小巷路網模式，並附帶 > 2.2 倍直線距離繞路防呆（自動改用直線）
// ==========================================
let isManualDrawingMode = false;
let manualDrawToolMode = 'freehand'; // 'freehand'（✏️ 手繪自由路線）| 'point2point'（📍 點到點拉線）
let manualP2pAutoSnapRoad = true;    // 點到點拉線「🧲 自動馬路貼齊」開關（預設開啟）
let manualDrawMusicActive = true;    // 預設「🟢 音樂收運（畫綠線）」
let manualDrawSteps = [];            // 儲存每一筆手繪線段或點到點區段，支援「↩️ 復原」與「🗑️ 重畫」
let isManualDrawFetching = false;
let manualDrawActionSeq = 0;
let isManualFreehandStrokeActive = false;
let manualFreehandStrokeCoords = [];
let manualFreehandSnappedToPrevEnd = false;
let manualFreehandPrevTailCoords = [];
let manualFreehandIncomingUnitVec = null;

const FREEHAND_SNAP_ENDPOINT_MAX_METERS = 20;
const MANUAL_FREEHAND_MIN_STROKE_METERS = 8;
const P2P_OSRM_MAX_DETOUR_RATIO = 2.2;

const startManualDrawBtn = document.getElementById('startManualDrawBtn');
const manualDrawTopBanner = document.getElementById('manualDrawTopBanner');
const manualDrawPromptBadge = document.getElementById('manualDrawPromptBadge');
const manualDrawPromptText = document.getElementById('manualDrawPromptText');
const manualDrawUI = document.getElementById('manualDrawUI');
const manualDrawStatsNodes = document.getElementById('manualDrawStatsNodes');
const manualDrawStatsDist = document.getElementById('manualDrawStatsDist');
const btnManualModeFreehand = document.getElementById('btnManualModeFreehand');
const btnManualModeP2P = document.getElementById('btnManualModeP2P');
const manualP2pAutoSnapRow = document.getElementById('manualP2pAutoSnapRow');
const manualP2pAutoSnapCheckbox = document.getElementById('manualP2pAutoSnapCheckbox');
const btnManualMusicOn = document.getElementById('btnManualMusicOn');
const btnManualMusicOff = document.getElementById('btnManualMusicOff');
const btnManualUndo = document.getElementById('btnManualUndo');
const btnManualClear = document.getElementById('btnManualClear');
const btnManualSave = document.getElementById('btnManualSave');
const btnManualCancel = document.getElementById('btnManualCancel');

function updateManualToolModeUI() {
    const isFreehand = (manualDrawToolMode === 'freehand');
    if (btnManualModeFreehand && btnManualModeP2P) {
        if (isFreehand) {
            btnManualModeFreehand.className = 'bg-orange-500 text-white font-black py-2 px-2 rounded-xl text-xs shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1';
            btnManualModeP2P.className = 'bg-transparent text-gray-600 hover:bg-white/70 font-black py-2 px-2 rounded-xl text-xs active:scale-95 transition-all flex items-center justify-center gap-1';
        } else {
            btnManualModeFreehand.className = 'bg-transparent text-gray-600 hover:bg-white/70 font-black py-2 px-2 rounded-xl text-xs active:scale-95 transition-all flex items-center justify-center gap-1';
            btnManualModeP2P.className = 'bg-indigo-600 text-white font-black py-2 px-2 rounded-xl text-xs shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1';
        }
    }
    if (manualP2pAutoSnapRow) {
        manualP2pAutoSnapRow.classList.toggle('hidden', isFreehand);
    }
    if (manualP2pAutoSnapCheckbox) {
        manualP2pAutoSnapCheckbox.checked = Boolean(manualP2pAutoSnapRoad);
    }
    if (manualDrawPromptBadge) {
        manualDrawPromptBadge.classList.toggle('bg-orange-600/95', isFreehand);
        manualDrawPromptBadge.classList.toggle('bg-indigo-600/95', !isFreehand);
    }
    if (isManualDrawingMode) {
        if (isFreehand) {
            try { map.dragPan.disable(); } catch (e) {}
        } else {
            try { map.dragPan.enable(); } catch (e) {}
        }
        ensureEditorMapZoomEnabled();
        document.getElementById('appStatusTitle').innerText = isFreehand ? '✏️ 手繪自由路線' : '📍 點到點拉線';
        if (manualDrawPromptText) {
            manualDrawPromptText.textContent = isFreehand
                ? '✏️ 手指按住拖曳自由畫橘色線，放開即轉為軌跡（雙指可縮放）'
                : (manualP2pAutoSnapRoad
                    ? '📍 依序點擊地圖起點與轉彎路口（已開啟自動馬路貼齊）'
                    : '📍 依序點擊地圖起點與轉彎路口（直線連接模式）');
        }
    }
}

if (btnManualModeFreehand) {
    btnManualModeFreehand.onclick = () => {
        if (manualDrawToolMode === 'freehand') return;
        manualDrawToolMode = 'freehand';
        manualDrawActionSeq++;
        isManualDrawFetching = false;
        cancelActiveManualFreehandStroke();
        updateManualToolModeUI();
        renderManualDrawPreview();
    };
}

if (btnManualModeP2P) {
    btnManualModeP2P.onclick = () => {
        if (manualDrawToolMode === 'point2point') return;
        manualDrawToolMode = 'point2point';
        cancelActiveManualFreehandStroke();
        try { map.dragPan.enable(); } catch (e) {}
        try { map.touchZoomRotate.enable(); } catch (e) {}
        updateManualToolModeUI();
        renderManualDrawPreview();
    };
}

if (manualP2pAutoSnapCheckbox) {
    manualP2pAutoSnapCheckbox.onchange = () => {
        manualP2pAutoSnapRoad = Boolean(manualP2pAutoSnapCheckbox.checked);
        updateManualToolModeUI();
    };
}

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

// 📍 點到點拉線專屬：獨立呼叫 OSRM foot 小巷路網模式（避免單行道／分隔島限制造成繞大圈）
// - 內建繞路防呆機制：當貼齊後路徑長度超過兩點直線距離的 2.2 倍時，自動捨棄繞路結果改用兩點直線連接
// - 與家具模式（src/furniture-osrm.js）及手繪自由畫路線完全分離
async function fetchPointToPointFootRoadGeometry(lng1, lat1, lng2, lat2) {
    const straightDistKm = getDistanceKm(lng1, lat1, lng2, lat2);
    if (straightDistKm * 1000 < 1) {
        return {
            coords: [[lng1, lat1], [lng2, lat2]],
            usedOsrm: false,
            detourFallback: false
        };
    }

    const osrmFootUrl = `https://router.project-osrm.org/route/v1/foot/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    try {
        const res = await fetchWithTimeout(osrmFootUrl, {}, 4000);
        if (res.ok) {
            const data = await res.json();
            const coords = data?.routes?.[0]?.geometry?.coordinates;
            if (data?.code === 'Ok' && Array.isArray(coords) && coords.length >= 2) {
                // 確保起點與前一段終點精準銜接無縫隙
                const alignedCoords = [[lng1, lat1], ...coords.slice(1)];
                let snappedDistKm = 0;
                for (let i = 1; i < alignedCoords.length; i++) {
                    snappedDistKm += getDistanceKm(
                        alignedCoords[i - 1][0], alignedCoords[i - 1][1],
                        alignedCoords[i][0], alignedCoords[i][1]
                    );
                }

                // 繞路防呆機制：若貼齊路徑長度 > 兩點直線距離的 2.2 倍，捨棄繞路改用兩點直線
                if (snappedDistKm > straightDistKm * P2P_OSRM_MAX_DETOUR_RATIO) {
                    return {
                        coords: [[lng1, lat1], [lng2, lat2]],
                        usedOsrm: false,
                        detourFallback: true
                    };
                }

                return {
                    coords: alignedCoords,
                    usedOsrm: true,
                    detourFallback: false
                };
            }
        }
    } catch (err) {
        // 網路超時或失敗時自動降級為兩點直線連接
    }

    return {
        coords: [[lng1, lat1], [lng2, lat2]],
        usedOsrm: false,
        detourFallback: false
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
        if (manualDrawToolMode === 'point2point') {
            manualDrawStatsNodes.innerHTML = manualDrawSteps.length > 0
                ? `<i class="fa-solid fa-location-dot"></i> 已點選 ${manualDrawSteps.length} 處（${points.length} 點）`
                : `<i class="fa-solid fa-location-dot"></i> 請點擊地圖設定起點`;
        } else {
            manualDrawStatsNodes.innerHTML = hasValidRoute
                ? `<i class="fa-solid fa-pen-nib"></i> 已畫 ${manualDrawSteps.length} 筆（${points.length} 點）`
                : `<i class="fa-solid fa-pen-nib"></i> 尚未繪製軌跡`;
        }
    }
    if (manualDrawStatsDist) {
        manualDrawStatsDist.textContent = `總距離 ${totalDistKm.toFixed(2)} km`;
    }
    if (btnManualUndo) {
        btnManualUndo.disabled = (manualDrawSteps.length === 0 && !isManualDrawFetching);
    }
    if (btnManualClear) {
        btnManualClear.disabled = (manualDrawSteps.length === 0 && !isManualDrawFetching);
    }
    if (btnManualSave) {
        btnManualSave.disabled = !hasValidRoute;
    }
}

// 取得目前畫布上已繪製路線的最後一個端點 E（[lng, lat]）
function getLastManualDrawEndpoint() {
    for (let i = manualDrawSteps.length - 1; i >= 0; i--) {
        const step = manualDrawSteps[i];
        const coords = Array.isArray(step?.densifiedCoords) && step.densifiedCoords.length > 0
            ? step.densifiedCoords
            : (Array.isArray(step?.clickLngLat) ? [step.clickLngLat] : []);
        if (coords.length > 0) {
            const last = coords[coords.length - 1];
            return [last[0], last[1]];
        }
    }
    return null;
}

// 收集前一段路線尾端約 maxTailMeters 公尺的座標串（依順序由舊到新，最後一點即為終點 E），供防折返重疊修剪比對
function getPreviousManualDrawTailCoords(maxTailMeters = 35) {
    const tailReversed = [];
    let accumMeters = 0;

    for (let sIdx = manualDrawSteps.length - 1; sIdx >= 0; sIdx--) {
        const step = manualDrawSteps[sIdx];
        const coords = Array.isArray(step?.densifiedCoords) && step.densifiedCoords.length > 0
            ? step.densifiedCoords
            : (Array.isArray(step?.clickLngLat) ? [step.clickLngLat] : []);
        for (let cIdx = coords.length - 1; cIdx >= 0; cIdx--) {
            const pt = coords[cIdx];
            if (tailReversed.length > 0) {
                const prev = tailReversed[tailReversed.length - 1];
                const dM = getDistanceKm(prev[0], prev[1], pt[0], pt[1]) * 1000;
                if (dM < 0.05) continue;
                accumMeters += dM;
            }
            tailReversed.push([pt[0], pt[1]]);
            if (accumMeters >= maxTailMeters) {
                return tailReversed.reverse();
            }
        }
    }
    return tailReversed.reverse();
}

// 計算前一段路線進入終點 E 的局部平面單位方向向量（指向 E）
function computeIncomingTailUnitVector(tailCoords) {
    if (!Array.isArray(tailCoords) || tailCoords.length < 2) return null;
    const endCoord = tailCoords[tailCoords.length - 1];
    const cosLat = Math.max(0.2, Math.cos((endCoord[1] * Math.PI) / 180));
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * cosLat;

    // 優先取距離終點 E 約 6m~15m 的前段參考點，避免單一微抖動點影響切線方向
    let refCoord = tailCoords[0];
    for (let i = tailCoords.length - 2; i >= 0; i--) {
        const dM = getDistanceKm(tailCoords[i][0], tailCoords[i][1], endCoord[0], endCoord[1]) * 1000;
        refCoord = tailCoords[i];
        if (dM >= 6) break;
    }

    const dx = (endCoord[0] - refCoord[0]) * mPerDegLng;
    const dy = (endCoord[1] - refCoord[1]) * mPerDegLat;
    const len = Math.hypot(dx, dy);
    if (len < 0.2) return null;
    return { x: dx / len, y: dy / len };
}

// 判斷接續繪製時的新座標點是否往回重疊到前一段路線尾巴（折返重疊判定）
function isPointBacktrackingOntoPrevTail(coord, prevEnd, prevTailCoords, incomingUnitVec) {
    if (!coord || !prevEnd || !incomingUnitVec || !Array.isArray(prevTailCoords) || prevTailCoords.length < 2) {
        return false;
    }
    const cosLat = Math.max(0.2, Math.cos((prevEnd[1] * Math.PI) / 180));
    const dx = (coord[0] - prevEnd[0]) * 111320 * cosLat;
    const dy = (coord[1] - prevEnd[1]) * 111320;
    const distFromE = Math.hypot(dx, dy);

    // 超出接續交界範圍（> 22m）即停止判定為起筆折返
    if (distFromE > 22) return false;
    if (distFromE < 0.3) return true;

    // 沿前段行進方向的投影：< -0.5m 代表落在終點 E 後方（往回折返）
    const proj = dx * incomingUnitVec.x + dy * incomingUnitVec.y;
    if (proj >= -0.5) return false;

    // 計算該點至前段尾巴各線段的最短距離（公尺）
    let minTailDistM = Infinity;
    for (let i = 0; i < prevTailCoords.length - 1; i++) {
        const a = prevTailCoords[i];
        const b = prevTailCoords[i + 1];
        const dM = (typeof pointToSegmentDistMeters === 'function')
            ? pointToSegmentDistMeters(coord[0], coord[1], a[0], a[1], b[0], b[1])
            : getDistanceKm(coord[0], coord[1], a[0], a[1]) * 1000;
        if (dM < minTailDistM) minTailDistM = dM;
    }

    // 距離前段尾巴 <= 8m 且確實沿著前段尾巴往回重疊（非垂直轉向旁巷）
    return minTailDistM <= 8 && minTailDistM <= Math.abs(proj) * 1.2 + 2;
}

// 接續手繪防折返重疊修剪：過濾掉交接處往回重疊前段尾巴與起筆毛刺折返點
function trimBacktrackingJunctionPoints(rawCoords, prevTailCoords) {
    if (!Array.isArray(rawCoords) || rawCoords.length < 2) return rawCoords || [];
    if (!Array.isArray(prevTailCoords) || prevTailCoords.length < 2) return rawCoords;

    const prevEnd = prevTailCoords[prevTailCoords.length - 1];
    const incomingVec = computeIncomingTailUnitVector(prevTailCoords);

    // 1. 濾除開頭往回重疊到前段尾巴的重複／折返觸控點
    let firstValidIdx = 1;
    while (firstValidIdx < rawCoords.length) {
        const candidate = rawCoords[firstValidIdx];
        const dFromEM = getDistanceKm(prevEnd[0], prevEnd[1], candidate[0], candidate[1]) * 1000;
        if (dFromEM < 0.3 || isPointBacktrackingOntoPrevTail(candidate, prevEnd, prevTailCoords, incomingVec)) {
            firstValidIdx++;
            continue;
        }
        break;
    }

    const cleaned = [[prevEnd[0], prevEnd[1]], ...rawCoords.slice(firstValidIdx)];
    if (cleaned.length < 3) return cleaned;

    // 2. 過濾交接處（距終點 E <= 12m）因落筆微抖動造成的尖銳髮夾折返毛刺
    const cosLat = Math.max(0.2, Math.cos((prevEnd[1] * Math.PI) / 180));
    const toLocalXY = (pt) => ({
        x: (pt[0] - prevEnd[0]) * 111320 * cosLat,
        y: (pt[1] - prevEnd[1]) * 111320
    });

    let i = 1;
    while (i < cleaned.length - 1 && i <= 6) {
        const pPrev = toLocalXY(cleaned[i - 1]);
        const pCurr = toLocalXY(cleaned[i]);
        const pNext = toLocalXY(cleaned[i + 1]);
        const distCurrE = Math.hypot(pCurr.x, pCurr.y);
        if (distCurrE > 12) break;

        const v1x = pCurr.x - pPrev.x, v1y = pCurr.y - pPrev.y;
        const v2x = pNext.x - pCurr.x, v2y = pNext.y - pCurr.y;
        const len1 = Math.hypot(v1x, v1y);
        const len2 = Math.hypot(v2x, v2y);
        const distNextE = Math.hypot(pNext.x, pNext.y);

        if (len1 > 0.1 && len2 > 0.1) {
            const cosAngle = (v1x * v2x + v1y * v2y) / (len1 * len2);
            if (cosAngle < -0.75 && distNextE < distCurrE) {
                cleaned.splice(i, 1);
                continue;
            }
        }
        i++;
    }

    return cleaned;
}

function cancelActiveManualFreehandStroke() {
    isManualFreehandStrokeActive = false;
    manualFreehandStrokeCoords = [];
    manualFreehandSnappedToPrevEnd = false;
    manualFreehandPrevTailCoords = [];
    manualFreehandIncomingUnitVec = null;
    updateFreehandTempLayer([]);
    if (isManualDrawingMode && manualDrawToolMode === 'freehand') {
        try { map.dragPan.disable(); } catch (e) {}
    } else {
        try { map.dragPan.enable(); } catch (e) {}
    }
    ensureEditorMapZoomEnabled();
}

function commitManualFreehandStroke() {
    const rawCoords = manualFreehandStrokeCoords.slice();
    const wasSnappedToPrevEnd = manualFreehandSnappedToPrevEnd;
    const prevTailSnapshot = manualFreehandPrevTailCoords.slice();

    isManualFreehandStrokeActive = false;
    manualFreehandStrokeCoords = [];
    manualFreehandSnappedToPrevEnd = false;
    manualFreehandPrevTailCoords = [];
    manualFreehandIncomingUnitVec = null;
    updateFreehandTempLayer([]);
    if (isManualDrawingMode && manualDrawToolMode === 'freehand') {
        try { map.dragPan.disable(); } catch (e) {}
    } else {
        try { map.dragPan.enable(); } catch (e) {}
    }
    ensureEditorMapZoomEnabled();

    if (!isManualDrawingMode || rawCoords.length < 2) return;

    // 若起點已磁吸對齊前一段終點 E（20 公尺內），執行防折返重疊修剪，確保銜接滑順無毛刺、不打結
    let finalFreehandCoords = rawCoords;
    if (wasSnappedToPrevEnd && prevTailSnapshot.length >= 2) {
        finalFreehandCoords = trimBacktrackingJunctionPoints(rawCoords, prevTailSnapshot);
        if (finalFreehandCoords.length < 2) return;
    }

    // 最小有效筆畫門檻（< 8m 視為誤觸或純折返抖動自動取消）
    let strokeMeters = 0;
    for (let i = 1; i < finalFreehandCoords.length; i++) {
        strokeMeters += getDistanceKm(
            finalFreehandCoords[i - 1][0], finalFreehandCoords[i - 1][1],
            finalFreehandCoords[i][0], finalFreehandCoords[i][1]
        ) * 1000;
    }
    if (strokeMeters < MANUAL_FREEHAND_MIN_STROKE_METERS) return;

    // 手繪自由畫路線存檔保護：
    // 嚴禁呼叫 OSRM Map Matching 或任何路網吸附演算法，僅做共線等距細分（直線 100% 維持筆直不扭曲，零偏移）
    const densified = densifyRoadCoordinates(finalFreehandCoords, 6);
    if (densified.length < 2) return;

    const endCoord = densified[densified.length - 1];
    manualDrawSteps.push({
        clickLngLat: endCoord,
        musicActive: manualDrawMusicActive,
        densifiedCoords: densified,
        usedOsrm: false,
        sourceMode: 'freehand'
    });

    vibrate(30);
    if (manualDrawPromptText) {
        manualDrawPromptText.textContent = wasSnappedToPrevEnd
            ? '✅ 已磁吸銜接前段終點並轉為軌跡！可繼續補畫或點擊「✅ 儲存」'
            : '✅ 已轉為路線軌跡！可繼續補畫、按「重畫」清除，或直接儲存';
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
    if (manualDrawUI) manualDrawUI.classList.remove('hidden');
    updateManualToolModeUI();

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
        manualDrawActionSeq++;
        isManualDrawFetching = false;
        cancelActiveManualFreehandStroke();
        if (manualDrawSteps.length > 0) {
            manualDrawSteps.pop();
            vibrate(30);
        }
        if (manualDrawPromptText) {
            if (manualDrawToolMode === 'point2point') {
                manualDrawPromptText.textContent = manualDrawSteps.length === 0
                    ? '📍 依序點擊地圖起點與轉彎路口連線'
                    : '↩️ 已復原上一步，請繼續點擊下一個路口';
            } else {
                manualDrawPromptText.textContent = manualDrawSteps.length === 0
                    ? '✏️ 手指按住拖曳自由畫橘色線，放開即轉為軌跡（雙指可縮放）'
                    : '↩️ 已復原上一筆，可繼續拖曳補畫';
            }
        }
        renderManualDrawPreview();
    };
}

const manualClearConfirmModal = document.getElementById('manualClearConfirmModal');
const btnConfirmManualClear = document.getElementById('btnConfirmManualClear');
const btnCancelManualClear = document.getElementById('btnCancelManualClear');

function closeManualClearConfirmModal() {
    if (manualClearConfirmModal) {
        manualClearConfirmModal.classList.add('hidden');
    }
}

function executeManualDrawClear() {
    if (!isManualDrawingMode) return;
    manualDrawActionSeq++;
    isManualDrawFetching = false;
    cancelActiveManualFreehandStroke();
    if (manualDrawSteps.length === 0) return;
    manualDrawSteps = [];
    vibrate(35);
    if (manualDrawPromptText) {
        manualDrawPromptText.textContent = manualDrawToolMode === 'point2point'
            ? '🗑️ 已清除軌跡，請重新點擊起點與路口'
            : '🗑️ 已清除軌跡，請重新按住拖曳自由畫橘色線';
    }
    renderManualDrawPreview();
}

if (btnConfirmManualClear) {
    btnConfirmManualClear.onclick = () => {
        closeManualClearConfirmModal();
        executeManualDrawClear();
    };
}

if (btnCancelManualClear) {
    btnCancelManualClear.onclick = () => {
        closeManualClearConfirmModal();
    };
}

if (manualClearConfirmModal) {
    manualClearConfirmModal.addEventListener('click', (e) => {
        if (e.target === manualClearConfirmModal) {
            closeManualClearConfirmModal();
        }
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && manualClearConfirmModal && !manualClearConfirmModal.classList.contains('hidden')) {
        closeManualClearConfirmModal();
    }
});

if (btnManualClear) {
    btnManualClear.onclick = () => {
        if (!isManualDrawingMode) return;
        const { points, totalDistKm } = buildManualRouteFromSteps();
        const hasDrawnTrack = manualDrawSteps.length > 0 || points.length > 0 || totalDistKm > 0;
        if (!hasDrawnTrack) {
            manualDrawActionSeq++;
            isManualDrawFetching = false;
            cancelActiveManualFreehandStroke();
            renderManualDrawPreview();
            return;
        }
        if (manualClearConfirmModal) {
            manualClearConfirmModal.classList.remove('hidden');
        } else if (confirm('確定要清除目前所有已繪製的軌跡重新畫嗎？')) {
            executeManualDrawClear();
        }
    };
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

        // 退出手繪模式並進入該路線預覽詳情頁（完整還原 MapLibre 互動開關與清空暫存圖層）
        isManualDrawingMode = false;
        manualDrawSteps = [];
        isManualDrawFetching = false;
        manualDrawActionSeq++;
        updateFreehandTempLayer([]);
        try { map.dragPan.enable(); } catch (e) {}
        ensureEditorMapZoomEnabled();
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

    function beginManualFreehandStroke(rawStartCoord) {
        if (!rawStartCoord) return false;
        isManualFreehandStrokeActive = true;
        manualFreehandSnappedToPrevEnd = false;
        manualFreehandPrevTailCoords = [];
        manualFreehandIncomingUnitVec = null;

        // 起點自動磁吸接點（Snap to Endpoint）：
        // 若畫布上已有前一段手繪路線（存在終點 E），落筆位置距離 E 在 20 公尺以內，自動將新線段第 1 點精準吸附對齊至 E
        const prevEnd = getLastManualDrawEndpoint();
        if (prevEnd) {
            const distToPrevEndM = getDistanceKm(prevEnd[0], prevEnd[1], rawStartCoord[0], rawStartCoord[1]) * 1000;
            if (distToPrevEndM <= FREEHAND_SNAP_ENDPOINT_MAX_METERS) {
                manualFreehandSnappedToPrevEnd = true;
                manualFreehandPrevTailCoords = getPreviousManualDrawTailCoords(35);
                manualFreehandIncomingUnitVec = computeIncomingTailUnitVector(manualFreehandPrevTailCoords);
                manualFreehandStrokeCoords = [[prevEnd[0], prevEnd[1]]];
                return true;
            }
        }

        manualFreehandStrokeCoords = [rawStartCoord];
        return true;
    }

    function pushStrokePoint(coord) {
        if (!coord) return;
        // 接續繪製防折返即時過濾：若已磁吸至前段終點 E，剛開始移動的前幾個點若仍往回重疊在前段尾巴上，直接過濾不加入草稿線
        if (manualFreehandSnappedToPrevEnd && manualFreehandStrokeCoords.length === 1) {
            if (isPointBacktrackingOntoPrevTail(
                coord,
                manualFreehandStrokeCoords[0],
                manualFreehandPrevTailCoords,
                manualFreehandIncomingUnitVec
            )) {
                return;
            }
        }
        const prev = manualFreehandStrokeCoords[manualFreehandStrokeCoords.length - 1];
        if (!prev || getDistanceKm(prev[0], prev[1], coord[0], coord[1]) * 1000 >= 2.5) {
            manualFreehandStrokeCoords.push(coord);
            updateFreehandTempLayer(manualFreehandStrokeCoords);
        }
    }

    // 明確三態手勢狀態機：'idle' | 'drawing' | 'multiTouchGesture'
    let manualFreehandGestureState = 'idle';

    function restoreManualFreehandMapControls() {
        if (isManualDrawingMode && manualDrawToolMode === 'freehand') {
            try { map.dragPan.disable(); } catch (err) {}
        } else {
            try { map.dragPan.enable(); } catch (err) {}
        }
        ensureEditorMapZoomEnabled();
    }

    function enterManualMultiTouchNav() {
        manualFreehandGestureState = 'multiTouchGesture';
        if (isManualFreehandStrokeActive) {
            isManualFreehandStrokeActive = false;
            manualFreehandStrokeCoords = [];
            manualFreehandSnappedToPrevEnd = false;
            manualFreehandPrevTailCoords = [];
            manualFreehandIncomingUnitVec = null;
            updateFreehandTempLayer([]);
        }
        try { map.dragPan.enable(); } catch (err) {}
        ensureEditorMapZoomEnabled();
    }

    // 觸控：僅單指（e.touches.length === 1）且處於「✏️ 手繪自由路線」模式時拖曳畫橘色線；
    // 一旦偵測雙指／多指（e.touches.length >= 2），立刻切換至 multiTouchGesture 取消未完成筆畫並鎖定，直到所有手指離開（touches.length === 0）才重置為 idle！
    canvasContainer.addEventListener('touchstart', (e) => {
        if (!isManualDrawingMode || manualDrawToolMode !== 'freehand') return;
        if (!e.touches || e.touches.length === 0) return;

        if (e.touches.length >= 2) {
            enterManualMultiTouchNav();
            return;
        }

        // 若剛從雙指抬起一指，鎖定直到所有手指離開螢幕（touches.length === 0）才允許重新起筆
        if (manualFreehandGestureState === 'multiTouchGesture') return;
        if (isIgnoredDrawTarget(e.target)) return;

        const touch = e.touches[0];
        const coord = clientXYToLngLat(touch.clientX, touch.clientY);
        if (!coord) return;

        if (beginManualFreehandStroke(coord)) {
            manualFreehandGestureState = 'drawing';
        }
    }, { passive: true });

    canvasContainer.addEventListener('touchmove', (e) => {
        if (!isManualDrawingMode || manualDrawToolMode !== 'freehand') return;
        if (!e.touches || e.touches.length === 0) return;

        if (e.touches.length >= 2) {
            enterManualMultiTouchNav();
            return;
        }

        if (manualFreehandGestureState !== 'drawing' || !isManualFreehandStrokeActive) return;

        try { map.dragPan.disable(); } catch (err) {}
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();

        const touch = e.touches[0];
        pushStrokePoint(clientXYToLngLat(touch.clientX, touch.clientY));
    }, { passive: false });

    canvasContainer.addEventListener('touchend', (e) => {
        const remaining = e.touches ? e.touches.length : 0;
        if (!isManualDrawingMode || manualDrawToolMode !== 'freehand') {
            if (remaining === 0) manualFreehandGestureState = 'idle';
            return;
        }

        if (manualFreehandGestureState === 'multiTouchGesture') {
            if (remaining === 0) {
                manualFreehandGestureState = 'idle';
                cancelActiveManualFreehandStroke();
                restoreManualFreehandMapControls();
            }
            return;
        }

        if (remaining === 0) {
            manualFreehandGestureState = 'idle';
            if (isManualFreehandStrokeActive) {
                commitManualFreehandStroke();
            }
            restoreManualFreehandMapControls();
        }
    }, { passive: true });

    canvasContainer.addEventListener('touchcancel', (e) => {
        const remaining = e.touches ? e.touches.length : 0;
        if (isManualFreehandStrokeActive) {
            cancelActiveManualFreehandStroke();
        }
        if (remaining === 0) {
            manualFreehandGestureState = 'idle';
            restoreManualFreehandMapControls();
        }
    }, { passive: true });

    // 滑鼠左鍵：僅「✏️ 手繪自由路線」模式按住拖曳自由畫橘色線，放開即轉為軌跡並恢復 dragPan
    canvasContainer.addEventListener('mousedown', (e) => {
        if (!isManualDrawingMode || manualDrawToolMode !== 'freehand' || e.button !== 0) return;
        if (isIgnoredDrawTarget(e.target)) return;

        const coord = clientXYToLngLat(e.clientX, e.clientY);
        if (!coord) return;

        if (!beginManualFreehandStroke(coord)) return;
        try { map.dragPan.disable(); } catch (err) {}
        updateFreehandTempLayer(manualFreehandStrokeCoords);
    });

    canvasContainer.addEventListener('mousemove', (e) => {
        if (!isManualDrawingMode || manualDrawToolMode !== 'freehand' || !isManualFreehandStrokeActive) return;
        e.preventDefault();
        pushStrokePoint(clientXYToLngLat(e.clientX, e.clientY));
    });

    window.addEventListener('mouseup', () => {
        if (!isManualDrawingMode || manualDrawToolMode !== 'freehand' || !isManualFreehandStrokeActive) return;
        commitManualFreehandStroke();
    });
})();

// 📍 點到點拉線（依序點擊起點與轉彎路口連線，支援「🧲 自動馬路貼齊」開關切換）
async function handleManualPointToPointClick(e) {
    if (!isManualDrawingMode || manualDrawToolMode !== 'point2point' || isManualDrawFetching) return;
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
            usedOsrm: false,
            sourceMode: 'point2point'
        });
        vibrate(30);
        if (manualDrawPromptText) {
            manualDrawPromptText.textContent = '📍 已設定起點 S，請點擊下一個轉彎路口';
        }
        renderManualDrawPreview();
        return;
    }

    const prevStep = manualDrawSteps[manualDrawSteps.length - 1];
    const prevCoords = prevStep.densifiedCoords || [prevStep.clickLngLat];
    const [lng1, lat1] = prevCoords[prevCoords.length - 1];
    const segMusic = manualDrawMusicActive;

    if (manualDrawSteps.length === 1 && prevCoords.length === 1) {
        manualDrawSteps[0].musicActive = segMusic;
    }

    if (!manualP2pAutoSnapRoad) {
        // 直線連接模式
        const densified = densifyRoadCoordinates([[lng1, lat1], [lng, lat]], 6);
        manualDrawSteps.push({
            clickLngLat: [lng, lat],
            musicActive: segMusic,
            densifiedCoords: densified.length >= 2 ? densified : [[lng1, lat1], [lng, lat]],
            usedOsrm: false,
            sourceMode: 'point2point'
        });
        vibrate(30);
        if (manualDrawPromptText) {
            manualDrawPromptText.textContent = '📍 已直線連接，請繼續點擊下一個轉彎路口';
        }
        renderManualDrawPreview();
        return;
    }

    // 自動馬路貼齊模式（獨立呼叫 OSRM foot 小巷路網模式，超時或繞路 > 2.2 倍直線距離自動改用兩點直線連接）
    isManualDrawFetching = true;
    const currentSeq = ++manualDrawActionSeq;
    if (btnManualUndo) btnManualUndo.disabled = false;
    if (manualDrawPromptText) {
        manualDrawPromptText.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> 正在沿小巷路網自動貼齊路徑...';
    }

    const { coords: rawRoadCoords, usedOsrm, detourFallback } = await fetchPointToPointFootRoadGeometry(lng1, lat1, lng, lat);
    if (!isManualDrawingMode || manualDrawToolMode !== 'point2point' || currentSeq !== manualDrawActionSeq) return;

    const densified = densifyRoadCoordinates(rawRoadCoords, 6);
    isManualDrawFetching = false;

    manualDrawSteps.push({
        clickLngLat: [lng, lat],
        musicActive: segMusic,
        densifiedCoords: densified.length >= 2 ? densified : [[lng1, lat1], [lng, lat]],
        usedOsrm,
        sourceMode: 'point2point'
    });

    vibrate(30);
    if (manualDrawPromptText) {
        if (usedOsrm) {
            manualDrawPromptText.textContent = '📍 已自動沿馬路貼齊（小巷模式），請繼續點擊下一個轉彎路口';
        } else if (detourFallback) {
            manualDrawPromptText.textContent = '📍 偵測到路網繞路超過 2.2 倍，已自動改用直線連接，請繼續點擊下一個路口';
        } else {
            manualDrawPromptText.textContent = '📍 已使用直線連接，請繼續點擊下一個轉彎路口';
        }
    }
    renderManualDrawPreview();
}

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
        if (manualDrawToolMode === 'point2point') {
            handleManualPointToPointClick(e);
        }
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
        if (activeDraggingEditNodeIdx !== -1 || (Date.now() - lastEditNodeDragEndTime < 220)) return;
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
    activeDraggingEditNodeIdx = -1;
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
    if (editedRoute) {
        const syncedIdx = savedRoutes.indexOf(editedRoute);
        if (syncedIdx !== -1) selectedRouteIdx = syncedIdx;
    }
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
    activeDraggingEditNodeIdx = -1;
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
    window.ApproachNav?.stop(true);
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
    activeDraggingEditNodeIdx = -1;
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
    if (window.CautionEditor && typeof window.CautionEditor.openForm === 'function') {
        const targetPt = route?.points?.[ptIndex];
        if (!targetPt) return;
        window.CautionEditor.openForm({
            title: '新增黃色提醒事項',
            initialNote: '注意路段',
            initialPhoto: '',
            lockedCoord: [targetPt.lng, targetPt.lat],
            lockedTime: Date.now(),
            onSave: ({ note, photo, lockedTime }) => {
                route.events = route.events || [];
                const newEv = {
                    type: 'alert',
                    note,
                    lng: targetPt.lng,
                    lat: targetPt.lat,
                    ptIdx: ptIndex,
                    bearing: targetPt.bearing || 0,
                    createdAt: lockedTime
                };
                if (photo) newEv.photo = photo;
                route.events.push(newEv);
                finishAlertModalCleanup(route);
            },
            onCancel: () => {
                finishAlertModalCleanup(route);
            }
        });
        return;
    }

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

    if (window.CautionEditor && typeof window.CautionEditor.openForm === 'function') {
        window.CautionEditor.openForm({
            title: '編輯黃色提醒事項',
            initialNote: ev.note || '注意路段',
            initialPhoto: ev.photo || '',
            lockedCoord: [ev.lng, ev.lat],
            lockedTime: ev.createdAt || Date.now(),
            onSave: ({ note, photo }) => {
                if (isEditingMode && typeof pushEditUndoSnapshot === 'function') {
                    pushEditUndoSnapshot(route);
                }
                ev.note = note;
                if (photo) {
                    ev.photo = photo;
                } else {
                    delete ev.photo;
                }
                finishAlertModalCleanup(route);
            },
            onDelete: () => {
                if (confirm(`確定要刪除【${ev.note || '提醒'}】這筆黃色提醒嗎？`)) {
                    if (isEditingMode && typeof pushEditUndoSnapshot === 'function') {
                        pushEditUndoSnapshot(route);
                    }
                    route.events.splice(eventIdx, 1);
                    finishAlertModalCleanup(route);
                    return true;
                }
                return false;
            },
            onCancel: () => {}
        });
        return;
    }

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

