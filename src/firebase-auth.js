// ==========================================
// [Module 7/10] src/firebase-auth.js
// 三層權限驗證、fleet_users/{deviceId} 全站門禁與即時封鎖中斷、路線管理與社區標註拆分權限、人員權限管理中心與雲端系統參數同步
// ==========================================

// ==========================================
// ⚙️ 10. 管理員隱藏設定面板（三層權限驗證＋全隊導航參數＋👥 管理使用者雙向即時同步 v3.27）
// ==========================================
const ADMIN_SETTINGS_PASSWORD = '888888';

// --- 10.1 從 Firebase 讀取全隊系統參數設定（讀取不到時自動套用預設值） ---
async function fetchSystemConfig() {
    try {
        const res = await fetchWithTimeout(SYSTEM_CONFIG_URL, { cache: 'no-store' }, 5000);
        if (!res.ok) return normalizeSystemConfig(systemNavConfig);
        const data = await res.json();
        if (data && typeof data === 'object') {
            return normalizeSystemConfig(data);
        }
        return normalizeSystemConfig(DEFAULT_SYSTEM_CONFIG);
    } catch (e) {
        return normalizeSystemConfig(systemNavConfig);
    }
}

// --- 10.1.5 停止車隊雷達廣播與同步（當裝置被封鎖或進入門禁待核准時立即執行） ---
function stopAndClearMyFleetRadarImmediately() {
    if (fleetRadarWatchId !== null) {
        try { navigator.geolocation.clearWatch(fleetRadarWatchId); } catch (e) {}
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
    fleetRadarStarted = false;

    // 立即從雲端 live_fleet 移除本機廣播節點
    if (fleetDeviceId && navigator.onLine) {
        fetchWithTimeout(`${LIVE_FLEET_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, {
            method: 'DELETE',
            keepalive: true
        }, 4000).catch(() => {});
    }

    // 清除畫面上其他友車標記與在線名單
    Object.keys(fleetLayerGroup).forEach(devId => {
        try { fleetLayerGroup[devId].marker.remove(); } catch (e) {}
        delete fleetLayerGroup[devId];
    });
    onlineFleetMembersList = [];
    renderOnlineFleetListUI();
}

// --- 10.1.6 檢查本機在 fleet_users/{deviceId} 的核准／封鎖／路線管理／社區標註授權狀態 ---
let isCheckingMyUserAccess = false;
async function checkMyFleetUserAccessStatus() {
    if (!fleetDeviceId || !navigator.onLine || isCheckingMyUserAccess) return;
    isCheckingMyUserAccess = true;
    try {
        const res = await fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, { cache: 'no-store' }, 4500);
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object') {
                myCloudUserProfile = data;
            } else if (fleetUserName) {
                // 若雲端紀錄還沒建立但已有本機名稱，自動補建一次
                await syncMyFleetUserRecordToCloud({ displayName: fleetUserName });
            } else {
                myCloudUserProfile = null;
            }
        }
        syncAdminCurrentRoleBadgeUI();
        syncRoutePermissionControlsUI();
        evaluateAndRenderAccessGateOverlay();
    } catch (e) {
    } finally {
        isCheckingMyUserAccess = false;
    }
}

function evaluateAndRenderAccessGateOverlay() {
    const overlay = document.getElementById('deviceAccessGateOverlay');
    if (!overlay) return;

    const iconWrap = document.getElementById('gateOverlayIconWrap');
    const iconEl = document.getElementById('gateOverlayIcon');
    const badgeEl = document.getElementById('gateOverlayStatusBadge');
    const titleEl = document.getElementById('gateOverlayTitle');
    const descEl = document.getElementById('gateOverlayDesc');
    const formWrap = document.getElementById('gateApplyFormWrap');
    const nameInput = document.getElementById('gateApplyNameInput');

    const blocked = isCurrentDeviceBlocked();
    const pendingApproval = !blocked && isCurrentDevicePendingApproval();

    if (blocked) {
        // 🚫 此裝置已被開發者封鎖：即時鎖定畫面並停止同步與車隊雷達廣播
        stopAndClearMyFleetRadarImmediately();
        if (iconWrap) iconWrap.className = 'w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3 text-3xl shadow-inner';
        if (iconEl) iconEl.className = 'fa-solid fa-ban';
        if (badgeEl) {
            badgeEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-800 mb-2';
            badgeEl.textContent = '🚫 裝置已封鎖鎖定';
        }
        if (titleEl) titleEl.textContent = '此裝置已被暫停使用權限';
        if (descEl) descEl.textContent = '系統管理員已封鎖此裝置的存取權限，已即時停止地圖同步與車隊雷達廣播。如需恢復請聯繫開發者（凱哥）。';
        formWrap?.classList.add('hidden');
        overlay.classList.remove('hidden');
        return;
    }

    if (pendingApproval) {
        // ⏳ 全站門禁開啟且尚未核准：進入待核准狀態並暫停雷達廣播
        stopAndClearMyFleetRadarImmediately();
        if (iconWrap) iconWrap.className = 'w-16 h-16 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-3 text-3xl shadow-inner';
        if (iconEl) iconEl.className = 'fa-solid fa-user-clock';
        if (badgeEl) {
            badgeEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800 mb-2';
            badgeEl.textContent = (myCloudUserProfile && myCloudUserProfile.displayName)
                ? `⏳ 待核准中（${myCloudUserProfile.displayName}）`
                : '⏳ 待開發者核准授權';
        }
        if (titleEl) titleEl.textContent = '需核准授權才可使用';
        if (descEl) descEl.textContent = '目前系統已開啟全站門禁管制。請輸入您的稱呼並送出申請，待開發者（凱哥）開啟准許使用後即可自動放行。';
        formWrap?.classList.remove('hidden');
        if (nameInput && !nameInput.value.trim()) {
            nameInput.value = fleetUserName || (myCloudUserProfile?.displayName || '');
        }
        overlay.classList.remove('hidden');
        return;
    }

    // 已核准且未封鎖：放行畫面，若原本雷達因門禁暫停且已有姓名，自動恢復啟動車隊雷達
    const wasGateVisible = !overlay.classList.contains('hidden');
    overlay.classList.add('hidden');
    if (wasGateVisible && fleetUserName && !fleetRadarStarted) {
        startFleetRadarSystem();
        if (currentFleetLat !== null && currentFleetLng !== null) {
            uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
        }
    }
}

// 綁定全站門禁遮罩按鈕事件
(function setupDeviceAccessGateOverlayEvents() {
    const nameInput = document.getElementById('gateApplyNameInput');
    const submitBtn = document.getElementById('btnSubmitGateApprovalRequest');
    const feedbackEl = document.getElementById('gateApplyFeedback');
    const checkNowBtn = document.getElementById('btnGateCheckNow');
    const devUnlockBtn = document.getElementById('btnGateDeveloperUnlock');

    submitBtn?.addEventListener('click', async () => {
        const val = (nameInput?.value || '').trim();
        if (!val) {
            alert('請輸入您的顯示名稱或稱呼！');
            nameInput?.focus();
            return;
        }
        fleetUserName = val;
        localStorage.setItem('fleet_user_name', fleetUserName);
        localStorage.setItem('yinggeRouteLastAuthor', fleetUserName);
        syncFleetUserNameUI();
        fleetUserNameModal?.classList.add('hidden');

        const origText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = '送出中...';
        try {
            await syncMyFleetUserRecordToCloud({ displayName: fleetUserName, requestApproval: true });
            if (feedbackEl) {
                feedbackEl.textContent = `✅ 已以「${fleetUserName}」送出申請！等待開發者核准放行中...`;
                feedbackEl.classList.remove('hidden');
            }
            evaluateAndRenderAccessGateOverlay();
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = origText;
        }
    });

    checkNowBtn?.addEventListener('click', async () => {
        const origHtml = checkNowBtn.innerHTML;
        checkNowBtn.disabled = true;
        checkNowBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>檢查中...';
        try {
            await checkAndApplyRadarInterval();
            await checkMyFleetUserAccessStatus();
        } finally {
            checkNowBtn.disabled = false;
            checkNowBtn.innerHTML = origHtml;
        }
    });

    devUnlockBtn?.addEventListener('click', () => {
        openAdminPasswordModal();
    });
})();

// --- 10.2 套用完整系統參數至當前導航與畫面 ---
function applySystemConfigToRuntime(newCfg) {
    const normalized = normalizeSystemConfig(newCfg);
    const prevDynamicZoom = systemNavConfig.enableDynamicZoom;
    const prevLowZoom = systemNavConfig.lowSpeedZoom;
    const prevHighZoom = systemNavConfig.highSpeedZoom;

    systemNavConfig = normalized;
    try {
        localStorage.setItem('yingge_system_nav_config_v31', JSON.stringify(normalized));
    } catch (e) {}

    // 1. 全隊頂部公告橫幅即時顯示／隱藏
    renderFleetAnnouncementBanner(normalized.announcementText);

    // 1.2 全站門禁總開關狀態同步檢查
    evaluateAndRenderAccessGateOverlay();
    syncAdminGateStatusBadgeUI(normalized.requireUserApproval);

    // 1.5 左上角車隊雷達在線名單與地圖友車標記休眠狀態即時同步套用
    if (typeof fleetLayerGroup === 'object' && fleetLayerGroup) {
        const now = Date.now();
        Object.values(fleetLayerGroup).forEach(entry => {
            if (entry && entry.el && entry.lastUpdatedAt) {
                updateFleetTruckMarkerAppearance(entry.el, entry.name, entry.lastUpdatedAt, now);
            }
        });
    }
    if (typeof renderOnlineFleetListUI === 'function') {
        renderOnlineFleetListUI();
    }

    // 3. 若跟隨中且縮放設定變更，平滑更新當前視野縮放
    if (
        isFollowingCamera &&
        !isPowerSaveMapPaused() &&
        normalized.enableDynamicZoom &&
        (prevDynamicZoom !== normalized.enableDynamicZoom ||
         prevLowZoom !== normalized.lowSpeedZoom ||
         prevHighZoom !== normalized.highSpeedZoom)
    ) {
        const targetZoom = getDynamicZoomBySpeed(lastRecordedSpeedKmh);
        try {
            map.easeTo({
                center: lastKnownLngLat,
                zoom: targetZoom,
                bearing: isHeadingUpMode ? currentHeading : map.getBearing(),
                offset: [0, 100],
                duration: 450
            });
        } catch (e) {}
    }

    // 4. 車隊雷達輪詢秒數變更時即時重啟計時器
    const cloudSec = normalized.radarIntervalSec;
    if (cloudSec && cloudSec !== currentRadarIntervalSec) {
        currentRadarIntervalSec = cloudSec;
        lastKnownCloudInterval = cloudSec;
        restartFleetRadarWithNewInterval(cloudSec);
        updateAdminIntervalDisplay(cloudSec);
    }
}

// --- 10.3 檢查雲端系統設定是否變更，若變更則即時套用（無須重開 App） ---
let isCheckingSystemConfig = false;
async function checkAndApplyRadarInterval() {
    if (isCheckingSystemConfig) return;
    isCheckingSystemConfig = true;
    try {
        const cloudCfg = await fetchSystemConfig();
        applySystemConfigToRuntime(cloudCfg);
        await checkMyFleetUserAccessStatus();
    } finally {
        isCheckingSystemConfig = false;
    }
}

// --- 10.4 以新秒數重新啟動車隊雷達輪詢（GPS 上傳 + 雷達讀取） ---
function restartFleetRadarWithNewInterval(intervalSec) {
    if (!fleetUserName || isDeviceRestrictedByGatekeeper()) return;

    if (fleetPollTimer !== null) {
        clearInterval(fleetPollTimer);
        fleetPollTimer = null;
    }
    const intervalMs = (intervalSec || DEFAULT_RADAR_INTERVAL_SEC) * 1000;
    fetchAndRenderFleetRadar();
    fleetPollTimer = setInterval(fetchAndRenderFleetRadar, intervalMs);
}

// --- 10.6 在每次 fetchAndRenderFleetRadar 時一併檢查雲端參數與門禁是否變更 ---
const _originalFetchAndRenderFleetRadar = fetchAndRenderFleetRadar;
fetchAndRenderFleetRadar = async function() {
    if (isDeviceRestrictedByGatekeeper()) {
        stopAndClearMyFleetRadarImmediately();
        return;
    }
    await _originalFetchAndRenderFleetRadar();
    checkAndApplyRadarInterval();
};

// --- 10.7 點擊版本號（或標題連續點擊 5 次）觸發開發者模式驗證 ---
(function setupAdminTitleTrigger() {
    const versionBadgeEl = document.getElementById('appVersionBadge');
    if (versionBadgeEl) {
        versionBadgeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            openAdminPasswordModal();
        });
    }

    const titleEl = document.getElementById('appStatusTitle');
    if (!titleEl) return;

    let tapCount = 0;
    let tapTimer = null;

    titleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        tapCount++;
        if (tapTimer) clearTimeout(tapTimer);
        tapTimer = setTimeout(() => { tapCount = 0; }, 3000);

        if (tapCount >= 5) {
            tapCount = 0;
            if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
            openAdminPasswordModal();
        }
    });
})();

// --- 10.8 開發者模式密碼驗證彈窗與裝置角色徽章同步 ---
function syncAdminCurrentRoleBadgeUI() {
    const badgeEl = document.getElementById('adminCurrentRoleBadge');
    const logoutBtn = document.getElementById('btnLogoutAdminRole');
    const hasRouteAuth = Boolean(!isDeviceRestrictedByGatekeeper() && myCloudUserProfile && myCloudUserProfile.canManageRoute === true);
    const hasBldgAuth = Boolean(!isDeviceRestrictedByGatekeeper() && myCloudUserProfile && (myCloudUserProfile.canEditCommunity === true || myCloudUserProfile.canManageBuildings === true));

    if (badgeEl) {
        if (localUserPermissionRole === 'developer') {
            badgeEl.className = 'text-[11px] font-black px-2.5 py-0.5 rounded-lg bg-amber-500 text-white shadow-sm';
            badgeEl.textContent = '🛠️ 開發者模式（最高權限）';
        } else if (hasRouteAuth) {
            badgeEl.className = 'text-[11px] font-black px-2.5 py-0.5 rounded-lg bg-indigo-600 text-white shadow-sm';
            badgeEl.textContent = '🛡️ 路線管理員（路線＋社區授權）';
        } else if (hasBldgAuth) {
            badgeEl.className = 'text-[11px] font-black px-2.5 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-300';
            badgeEl.textContent = '🏢 社區標註員（僅社區大樓授權）';
        } else {
            badgeEl.className = 'text-[11px] font-black px-2.5 py-0.5 rounded-lg bg-gray-200 text-gray-700';
            badgeEl.textContent = '一般使用者（唯讀）';
        }
    }
    if (logoutBtn) {
        logoutBtn.classList.toggle('hidden', localUserPermissionRole !== 'developer');
    }
}

function setLocalUserPermissionRole(newRole) {
    localUserPermissionRole = (newRole === 'developer') ? 'developer' : 'normal';
    try {
        localStorage.setItem('yingge_user_permission_role', localUserPermissionRole);
    } catch (e) {}
    syncAdminCurrentRoleBadgeUI();
    syncRoutePermissionControlsUI();
    evaluateAndRenderAccessGateOverlay();
}

function openAdminPasswordModal() {
    const modal = document.getElementById('adminPasswordModal');
    const input = document.getElementById('adminPasswordInput');
    const errorEl = document.getElementById('adminPasswordError');
    if (!modal || !input) return;
    syncAdminCurrentRoleBadgeUI();
    input.value = '';
    errorEl?.classList.add('hidden');
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
}

document.getElementById('btnVerifyAdminPassword')?.addEventListener('click', () => {
    const input = document.getElementById('adminPasswordInput');
    const errorEl = document.getElementById('adminPasswordError');
    const pwd = (input?.value || '').trim();

    if (pwd === ADMIN_SETTINGS_PASSWORD) {
        // 開發者最高權限密碼（凱哥）
        setLocalUserPermissionRole('developer');
        document.getElementById('adminPasswordModal')?.classList.add('hidden');
        // 若自己這台裝置尚未核准或誤被封鎖，開發者登入時自動將本機設為核准且解除封鎖
        if (fleetDeviceId && navigator.onLine) {
            const now = Date.now();
            fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    displayName: fleetUserName || '凱哥(開發者)',
                    approved: true,
                    isApproved: true,
                    blocked: false,
                    isBlocked: false,
                    canManageRoute: true,
                    canEditCommunity: true,
                    canManageBuildings: true,
                    lastSeen: now,
                    lastActiveAt: now
                })
            }, 4000).catch(() => {});
        }
        openAdminSettingsPanel();
    } else {
        errorEl?.classList.remove('hidden');
        if (input) { input.value = ''; input.focus(); }
        try { navigator.vibrate?.(200); } catch (e) {}
    }
});

document.getElementById('btnLogoutAdminRole')?.addEventListener('click', () => {
    setLocalUserPermissionRole('normal');
    document.getElementById('adminPasswordModal')?.classList.add('hidden');
    alert('ℹ️ 已退出開發者模式，切回依裝置授權自動辨識模式。');
    if (activeViewingMapPin) {
        openViewMapPinModal(activeViewingMapPin);
    }
});

document.getElementById('adminPasswordInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('btnVerifyAdminPassword')?.click();
    }
});

document.getElementById('btnCancelAdminPassword')?.addEventListener('click', () => {
    document.getElementById('adminPasswordModal')?.classList.add('hidden');
});

// --- 10.8.5 開發者模式雙書籤頁切換（⚙️ 系統與 AI 參數 | 👥 管理使用者）與人員權限管理中心 ---
let activeAdminTab = 'system'; // 'system' | 'users'
let isFetchingAdminFleetUsers = false;

function switchAdminSettingsTab(tabName) {
    activeAdminTab = tabName === 'users' ? 'users' : 'system';
    const tabBtnSystem = document.getElementById('btnAdminTabSystem');
    const tabBtnUsers = document.getElementById('btnAdminTabUsers');
    const panelSystem = document.getElementById('adminTabPanelSystem');
    const panelUsers = document.getElementById('adminTabPanelUsers');

    if (activeAdminTab === 'users') {
        if (tabBtnUsers) {
            tabBtnUsers.className = 'py-2 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 bg-white text-amber-900 shadow-sm';
        }
        if (tabBtnSystem) {
            tabBtnSystem.className = 'py-2 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 text-amber-800/75 hover:text-amber-950';
        }
        panelSystem?.classList.add('hidden');
        panelUsers?.classList.remove('hidden');
        fetchAndRenderAdminFleetUsersList();
    } else {
        if (tabBtnSystem) {
            tabBtnSystem.className = 'py-2 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 bg-white text-amber-900 shadow-sm';
        }
        if (tabBtnUsers) {
            tabBtnUsers.className = 'py-2 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 text-amber-800/75 hover:text-amber-950';
        }
        panelUsers?.classList.add('hidden');
        panelSystem?.classList.remove('hidden');
    }
}

document.getElementById('btnAdminTabSystem')?.addEventListener('click', (e) => {
    e.stopPropagation();
    switchAdminSettingsTab('system');
});

document.getElementById('btnAdminTabUsers')?.addEventListener('click', (e) => {
    e.stopPropagation();
    switchAdminSettingsTab('users');
});

function syncAdminGateStatusBadgeUI(requireApproval) {
    const badgeEl = document.getElementById('adminGateStatusBadge');
    const checkboxEl = document.getElementById('adminRequireUserApprovalInput');
    if (checkboxEl) {
        checkboxEl.checked = Boolean(requireApproval);
    }
    if (badgeEl) {
        if (requireApproval) {
            badgeEl.className = 'text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 border border-amber-400';
            badgeEl.textContent = '🔒 需核准放行';
        } else {
            badgeEl.className = 'text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200';
            badgeEl.textContent = '🔓 自由進入';
        }
    }
}

async function saveAdminUserGateSettingsToCloud() {
    const reqApprovalEl = document.getElementById('adminRequireUserApprovalInput');
    const nextRequireApproval = Boolean(reqApprovalEl?.checked);

    systemNavConfig.requireApproval = nextRequireApproval;
    systemNavConfig.requireUserApproval = nextRequireApproval;
    syncAdminGateStatusBadgeUI(nextRequireApproval);

    try {
        localStorage.setItem('yingge_system_nav_config_v31', JSON.stringify(systemNavConfig));
    } catch (e) {}

    try {
        const res = await fetchWithTimeout(SYSTEM_CONFIG_URL, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requireApproval: nextRequireApproval,
                requireUserApproval: nextRequireApproval,
                updatedAt: Date.now()
            })
        }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        showAdminUserActionToast(
            nextRequireApproval ? '🔒 已開啟全站門禁（需核准授權才可使用）' : '🔓 已關閉全站門禁（自由進入）',
            nextRequireApproval ? 'info' : 'success'
        );
        fetchAndRenderAdminFleetUsersList();
    } catch (e) {
        alert('⚠️ 儲存門禁設定失敗，請檢查網路連線！');
    }
}

document.getElementById('adminRequireUserApprovalInput')?.addEventListener('change', () => {
    saveAdminUserGateSettingsToCloud();
});

document.getElementById('btnRefreshFleetUsers')?.addEventListener('click', (e) => {
    e.stopPropagation();
    fetchAndRenderAdminFleetUsersList();
});

let pendingAdminFleetUsersRefresh = false;
let adminUserToastTimer = null;

function showAdminUserActionToast(message, tone = 'info') {
    let toastEl = document.getElementById('adminUserActionToast');
    const modalBox = document.querySelector('#adminSettingsModal > div') || document.body;
    if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'adminUserActionToast';
        modalBox.appendChild(toastEl);
    }
    const toneClasses = tone === 'danger'
        ? 'bg-rose-600 text-white border-rose-400'
        : tone === 'success'
            ? 'bg-emerald-600 text-white border-emerald-400'
            : 'bg-slate-900 text-white border-slate-700';

    toastEl.className = `fixed top-16 left-1/2 -translate-x-1/2 z-[1400] px-4 py-2 rounded-xl border shadow-xl text-xs font-black tracking-wide transition-all duration-200 pointer-events-none ${toneClasses}`;
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');

    if (adminUserToastTimer) clearTimeout(adminUserToastTimer);
    adminUserToastTimer = setTimeout(() => {
        toastEl?.classList.add('hidden');
    }, 2600);
}

function normalizeFleetUserRecord(devId, u, existingUser = null) {
    const base = (existingUser && typeof existingUser === 'object') ? existingUser : {};
    const raw = (u && typeof u === 'object') ? u : {};

    // 統一優先讀取標準欄位 blocked / approved / canManageRoute / canEditCommunity / realName / lastSeen
    const isBlockedVal = raw.blocked !== undefined
        ? Boolean(raw.blocked)
        : raw.isBlocked !== undefined
            ? Boolean(raw.isBlocked)
            : Boolean(base.blocked || base.isBlocked);

    let isApprovedVal;
    if (isBlockedVal) {
        isApprovedVal = false;
    } else if (raw.approved !== undefined) {
        isApprovedVal = Boolean(raw.approved);
    } else if (raw.isApproved !== undefined) {
        isApprovedVal = Boolean(raw.isApproved);
    } else if (base.approved !== undefined) {
        isApprovedVal = Boolean(base.approved);
    } else if (base.isApproved !== undefined) {
        isApprovedVal = Boolean(base.isApproved);
    } else {
        isApprovedVal = true;
    }

    const canManageRouteVal = isBlockedVal
        ? false
        : (raw.canManageRoute !== undefined
            ? Boolean(raw.canManageRoute)
            : Boolean(base.canManageRoute));

    const canEditVal = isBlockedVal
        ? false
        : (raw.canEditCommunity !== undefined
            ? Boolean(raw.canEditCommunity)
            : raw.canManageBuildings !== undefined
                ? Boolean(raw.canManageBuildings)
                : (base.canEditCommunity !== undefined
                    ? Boolean(base.canEditCommunity)
                    : Boolean(base.canManageBuildings)));

    const displayNameVal = String(raw.displayName || raw.name || base.displayName || '車隊隊員').trim() || '車隊隊員';
    const realNameVal = String(
        raw.realName !== undefined
            ? raw.realName
            : (raw.originalName !== undefined
                ? raw.originalName
                : (base.realName !== undefined ? base.realName : (base.originalName || '')))
    ).trim();

    const lastSeenVal = Number(
        raw.lastSeen || raw.lastActiveAt || raw.updatedAt || base.lastSeen || base.lastActiveAt || raw.createdAt || base.createdAt || 0
    );
    const createdAtVal = Number(raw.createdAt || base.createdAt || lastSeenVal || 0);
    const updatedAtVal = Number(raw.updatedAt || raw.updatedByAdminAt || base.updatedAt || lastSeenVal || 0);

    return {
        deviceId: devId,
        displayName: displayNameVal,
        realName: realNameVal,
        originalName: realNameVal,
        approved: isApprovedVal,
        isApproved: isApprovedVal,
        blocked: isBlockedVal,
        isBlocked: isBlockedVal,
        canManageRoute: canManageRouteVal,
        canEditCommunity: canEditVal,
        canManageBuildings: canEditVal,
        lastSeen: lastSeenVal,
        lastActiveAt: lastSeenVal,
        createdAt: createdAtVal,
        updatedAt: updatedAtVal
    };
}

function renderAdminFleetUsersCardsFromMap(mergedMap) {
    const listContainer = document.getElementById('adminUsersListContainer');
    const countSummaryEl = document.getElementById('adminUsersCountSummary');
    const pendingBadgeEl = document.getElementById('adminUsersPendingBadge');
    const now = Date.now();

    // 確保所有在 Firebase 使用者節點下的紀錄（不論權限開關為 true 或 false）皆完整顯示，絕不過濾隱藏
    const userList = Object.values(mergedMap || {}).filter(u => u && u.deviceId);

    // 60 秒內有心跳顯示 🟢 上線中，超過顯示 ⚪ 離線
    const ONLINE_HEARTBEAT_MS = 60 * 1000;
    let onlineCount = 0;
    let pendingCount = 0;

    userList.forEach(u => {
        const blocked = Boolean(u.blocked !== undefined ? u.blocked : u.isBlocked);
        const approved = (u.approved !== undefined ? Boolean(u.approved) : Boolean(u.isApproved));
        const lastTs = Number(u.lastSeen || u.lastActiveAt || 0);
        u.isOnline = !blocked && lastTs > 0 && (now - lastTs <= ONLINE_HEARTBEAT_MS);
        if (u.isOnline) onlineCount++;
        if (!approved && !blocked) pendingCount++;
    });

    // 排序：1. 待核准優先 ➔ 2. 上線中優先 ➔ 3. 最後活躍時間由新到舊（同時間則以 deviceId 穩定排序避免跳動）
    userList.sort((a, b) => {
        const aBlocked = Boolean(a.blocked !== undefined ? a.blocked : a.isBlocked);
        const bBlocked = Boolean(b.blocked !== undefined ? b.blocked : b.isBlocked);
        const aApproved = (a.approved !== undefined ? Boolean(a.approved) : Boolean(a.isApproved));
        const bApproved = (b.approved !== undefined ? Boolean(b.approved) : Boolean(b.isApproved));
        const aPending = (!aApproved && !aBlocked) ? 1 : 0;
        const bPending = (!bApproved && !bBlocked) ? 1 : 0;
        if (aPending !== bPending) return bPending - aPending;
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        const timeDiff = Number(b.lastSeen || b.lastActiveAt || 0) - Number(a.lastSeen || a.lastActiveAt || 0);
        if (timeDiff !== 0) return timeDiff;
        return String(a.deviceId).localeCompare(String(b.deviceId));
    });

    if (countSummaryEl) {
        countSummaryEl.textContent = `(共 ${userList.length} 人・🟢 上線 ${onlineCount}${pendingCount > 0 ? `・⏳ 待核准 ${pendingCount}` : ''})`;
    }
    if (pendingBadgeEl) {
        if (pendingCount > 0) {
            pendingBadgeEl.textContent = String(pendingCount);
            pendingBadgeEl.classList.remove('hidden');
        } else {
            pendingBadgeEl.classList.add('hidden');
        }
    }

    if (!listContainer) return;
    listContainer.innerHTML = '';

    if (userList.length === 0) {
        listContainer.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-2xl p-6 text-center text-xs font-bold text-slate-400">
                目前尚無車隊裝置連線紀錄
            </div>
        `;
        return;
    }

    userList.forEach(user => {
        const targetDeviceId = user.deviceId;
        const isSelf = (targetDeviceId === fleetDeviceId);
        // 統一讀取與寫入完全相同的欄位（approved / blocked / canManageRoute / canEditCommunity / realName）
        const isBlocked = Boolean(user.blocked !== undefined ? user.blocked : user.isBlocked);
        const isApproved = !isBlocked && (user.approved !== undefined ? Boolean(user.approved) : Boolean(user.isApproved));
        const isPending = !isApproved && !isBlocked;
        const canManageRoute = !isBlocked && Boolean(user.canManageRoute);
        const canEditCommunity = !isBlocked && Boolean(
            user.canEditCommunity !== undefined ? user.canEditCommunity : user.canManageBuildings
        );
        const annotatedRealName = String(user.realName || user.originalName || '').trim();

        const card = document.createElement('div');
        card.className = isBlocked
            ? 'bg-rose-50/90 border-2 border-rose-300 rounded-2xl p-3 space-y-2.5 shadow-sm transition-all'
            : isPending
                ? 'bg-amber-50/90 border-2 border-amber-400 rounded-2xl p-3 space-y-2.5 shadow-sm transition-all'
                : 'bg-white border border-slate-200 rounded-2xl p-3 space-y-2.5 shadow-sm transition-all';

        // 計算最後活躍時間文字（絕不顯示任何裝置 ID 亂碼！）
        const lastTs = Number(user.lastSeen || user.lastActiveAt || 0);
        const elapsedSec = Math.max(0, Math.floor((now - lastTs) / 1000));
        let activeTimeLabel = '剛剛活躍';
        if (!lastTs) {
            activeTimeLabel = '尚無心跳';
        } else if (elapsedSec <= 60) {
            activeTimeLabel = '即時在線';
        } else if (elapsedSec < 3600) {
            activeTimeLabel = `${Math.max(1, Math.floor(elapsedSec / 60))} 分鐘前`;
        } else if (elapsedSec < 86400) {
            activeTimeLabel = `${Math.floor(elapsedSec / 3600)} 小時前`;
        } else {
            activeTimeLabel = `${Math.floor(elapsedSec / 86400)} 天前`;
        }

        // 頂部資訊列：若已標註原名，主標題顯示原名、下方小字顯示目前暱稱；否則主標題顯示目前暱稱（絕不顯示裝置 ID 亂碼）
        const topRow = document.createElement('div');
        topRow.className = 'flex items-start justify-between gap-2';

        const nameWrap = document.createElement('div');
        nameWrap.className = 'min-w-0 flex-1';

        const statusDotHtml = user.isOnline
            ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">🟢 上線中</span>`
            : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">⚪ 離線 (${activeTimeLabel})</span>`;

        const selfBadgeHtml = isSelf
            ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-indigo-100 text-indigo-800">本機</span>`
            : '';

        const roleSummaryBadgeHtml = canManageRoute
            ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-800 border border-indigo-300">🛡️ 路線管理員（含社區）</span>`
            : canEditCommunity
                ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">🏢 社區標註員</span>`
                : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">🔒 一般唯讀</span>`;

        if (annotatedRealName) {
            nameWrap.innerHTML = `
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-sm font-black text-slate-900 truncate">🏷️ ${escapeHtmlSafe(annotatedRealName)}</span>
                    ${selfBadgeHtml}
                    ${statusDotHtml}
                    ${roleSummaryBadgeHtml}
                </div>
                <div class="mt-0.5 text-[11px] font-bold text-slate-500">
                    目前暱稱：<span class="text-slate-700 font-black">${escapeHtmlSafe(user.displayName || '隊員')}</span>
                </div>
            `;
        } else {
            nameWrap.innerHTML = `
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-sm font-black text-slate-900 truncate">${escapeHtmlSafe(user.displayName || '隊員')}</span>
                    ${selfBadgeHtml}
                    ${statusDotHtml}
                    ${roleSummaryBadgeHtml}
                </div>
                <div class="mt-0.5 text-[10px] font-bold text-slate-400">尚未標註原名（點下方「✏️ 標註／改原名」單向備註）</div>
            `;
        }

        topRow.appendChild(nameWrap);
        card.appendChild(topRow);

        // 中間 3 個獨立權限滑動開關列：
        // 1. 「准許使用／封鎖」開關 (控制 approved)
        // 2. 「🛡️ 路線管理（含社區）」開關 (控制 canManageRoute)
        // 3. 「🏢 僅社區標註」開關 (控制 canEditCommunity)
        const togglesGrid = document.createElement('div');
        togglesGrid.className = 'grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1.5 border-t border-slate-100';

        // 開關 1：「准許使用／封鎖」開關 (控制 approved，同步 blocked: !approved)
        const accessToggleBox = document.createElement('div');
        accessToggleBox.className = isBlocked
            ? 'bg-rose-100/80 border border-rose-300 rounded-xl p-2.5 flex items-center justify-between gap-2 cursor-pointer select-none'
            : isPending
                ? 'bg-amber-100/70 border border-amber-300 rounded-xl p-2.5 flex items-center justify-between gap-2 cursor-pointer select-none'
                : 'bg-emerald-50/60 border border-emerald-200 rounded-xl p-2.5 flex items-center justify-between gap-2 cursor-pointer select-none';

        const unifiedStatusHtml = isBlocked
            ? `<div class="text-[11px] font-black text-rose-600 mt-0.5">⛔ 已封鎖停用</div>`
            : isPending
                ? `<div class="text-[11px] font-black text-amber-600 mt-0.5 animate-pulse">⏳ 待核准放行</div>`
                : `<div class="text-[11px] font-black text-emerald-600 mt-0.5">✅ 准許正常使用</div>`;

        const accessTextCol = document.createElement('div');
        accessTextCol.className = 'min-w-0 flex-1';
        accessTextCol.innerHTML = `
            <div class="text-[11px] font-black text-slate-800">准許使用／封鎖</div>
            ${unifiedStatusHtml}
        `;

        const accessSwitchBtn = document.createElement('button');
        accessSwitchBtn.type = 'button';
        accessSwitchBtn.setAttribute('role', 'switch');
        accessSwitchBtn.setAttribute('aria-checked', isApproved ? 'true' : 'false');
        accessSwitchBtn.className = `admin-user-toggle-switch ${isApproved ? 'is-on' : 'is-off'}`;
        accessSwitchBtn.innerHTML = `<span class="admin-user-toggle-knob"></span>`;

        const handleToggleApprovedAccess = async (e) => {
            e.stopPropagation();
            if (accessSwitchBtn.disabled) return;
            accessSwitchBtn.disabled = true;
            try { navigator.vibrate?.(30); } catch (err) {}

            const nextApproved = !isApproved;
            if (nextApproved) {
                const ok = await updateCloudFleetUserFields(targetDeviceId, {
                    approved: true,
                    isApproved: true,
                    blocked: false,
                    isBlocked: false
                });
                if (ok) {
                    showAdminUserActionToast(`✅ 已開啟「${annotatedRealName || user.displayName}」准許使用`, 'success');
                }
            } else {
                // 關閉准許使用 -> 封鎖停用，並同步關閉路線管理與社區標註權限
                const ok = await updateCloudFleetUserFields(targetDeviceId, {
                    approved: false,
                    isApproved: false,
                    blocked: true,
                    isBlocked: true,
                    canManageRoute: false,
                    canEditCommunity: false,
                    canManageBuildings: false
                });
                if (ok) {
                    fetchWithTimeout(`${LIVE_FLEET_BASE_URL}/${encodeURIComponent(targetDeviceId)}.json`, {
                        method: 'DELETE'
                    }, 4000).catch(() => {});
                    showAdminUserActionToast(`⛔ 已封鎖「${annotatedRealName || user.displayName}」並暫停使用權限`, 'danger');
                }
            }
        };

        accessSwitchBtn.addEventListener('click', handleToggleApprovedAccess);
        accessToggleBox.addEventListener('click', handleToggleApprovedAccess);
        accessToggleBox.appendChild(accessTextCol);
        accessToggleBox.appendChild(accessSwitchBtn);

        // 開關 2：「🛡️ 路線管理（含社區）」開關 (控制 canManageRoute)
        const routeToggleBox = document.createElement('div');
        routeToggleBox.className = canManageRoute
            ? 'bg-indigo-50/80 border border-indigo-300 rounded-xl p-2.5 flex items-center justify-between gap-2 cursor-pointer select-none'
            : 'bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-center justify-between gap-2 cursor-pointer select-none';

        const routeStatusTextHtml = canManageRoute
            ? `<div class="text-[11px] font-black text-indigo-700 mt-0.5">✅ 可審核/改刪路線+社區</div>`
            : `<div class="text-[11px] font-bold text-slate-400 mt-0.5">🔒 無路線管理權限</div>`;

        const routeTextCol = document.createElement('div');
        routeTextCol.className = 'min-w-0 flex-1';
        routeTextCol.innerHTML = `
            <div class="text-[11px] font-black text-slate-800">🛡️ 路線管理（含社區）</div>
            ${routeStatusTextHtml}
        `;

        const routeSwitchBtn = document.createElement('button');
        routeSwitchBtn.type = 'button';
        routeSwitchBtn.setAttribute('role', 'switch');
        routeSwitchBtn.setAttribute('aria-checked', canManageRoute ? 'true' : 'false');
        routeSwitchBtn.className = `admin-user-toggle-switch ${canManageRoute ? 'is-on' : 'is-off'}`;
        routeSwitchBtn.innerHTML = `<span class="admin-user-toggle-knob"></span>`;

        const handleToggleRouteManagerAuth = async (e) => {
            e.stopPropagation();
            if (routeSwitchBtn.disabled) return;
            routeSwitchBtn.disabled = true;
            try { navigator.vibrate?.(25); } catch (err) {}

            const nextRouteState = !canManageRoute;
            const patchPayload = {
                canManageRoute: Boolean(nextRouteState),
                updatedAt: Date.now()
            };
            // 若開啟路線管理員權限時該帳號原本被封鎖或未核准，一併設為准許使用
            if (nextRouteState && (!isApproved || isBlocked)) {
                patchPayload.approved = true;
                patchPayload.isApproved = true;
                patchPayload.blocked = false;
                patchPayload.isBlocked = false;
            }

            const ok = await updateCloudFleetUserFields(targetDeviceId, patchPayload);
            if (ok) {
                showAdminUserActionToast(
                    nextRouteState
                        ? `🛡️ 已授權「${annotatedRealName || user.displayName}」路線管理員（含社區）`
                        : `🔒 已收回「${annotatedRealName || user.displayName}」路線管理員權限`,
                    nextRouteState ? 'success' : 'info'
                );
            }
        };

        routeSwitchBtn.addEventListener('click', handleToggleRouteManagerAuth);
        routeToggleBox.addEventListener('click', handleToggleRouteManagerAuth);
        routeToggleBox.appendChild(routeTextCol);
        routeToggleBox.appendChild(routeSwitchBtn);

        // 開關 3：「🏢 僅社區標註」開關 (控制 canEditCommunity)
        const bldgToggleBox = document.createElement('div');
        bldgToggleBox.className = canEditCommunity
            ? 'bg-emerald-50/70 border border-emerald-300 rounded-xl p-2.5 flex items-center justify-between gap-2 cursor-pointer select-none'
            : 'bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-center justify-between gap-2 cursor-pointer select-none';

        const bldgStatusTextHtml = canEditCommunity
            ? `<div class="text-[11px] font-black text-emerald-600 mt-0.5">✅ 已授權可標註社區</div>`
            : (canManageRoute
                ? `<div class="text-[11px] font-bold text-indigo-600 mt-0.5">🛡️ 已由路線管理員涵蓋</div>`
                : `<div class="text-[11px] font-bold text-slate-400 mt-0.5">🔒 禁止標註（一般唯讀）</div>`);

        const bldgTextCol = document.createElement('div');
        bldgTextCol.className = 'min-w-0 flex-1';
        bldgTextCol.innerHTML = `
            <div class="text-[11px] font-black text-slate-800">🏢 僅社區標註</div>
            ${bldgStatusTextHtml}
        `;

        const toggleSwitchBtn = document.createElement('button');
        toggleSwitchBtn.type = 'button';
        toggleSwitchBtn.setAttribute('role', 'switch');
        toggleSwitchBtn.setAttribute('aria-checked', canEditCommunity ? 'true' : 'false');
        toggleSwitchBtn.className = `admin-user-toggle-switch ${canEditCommunity ? 'is-on' : 'is-off'}`;
        toggleSwitchBtn.innerHTML = `<span class="admin-user-toggle-knob"></span>`;

        const handleToggleCommunityAuth = async (e) => {
            e.stopPropagation();
            if (toggleSwitchBtn.disabled) return;
            toggleSwitchBtn.disabled = true;
            try { navigator.vibrate?.(25); } catch (err) {}

            const nextState = !canEditCommunity;
            const patchPayload = {
                canEditCommunity: Boolean(nextState),
                canManageBuildings: Boolean(nextState),
                updatedAt: Date.now()
            };
            // 若開啟社區標註授權時該帳號原本被封鎖或未核准，一併解除封鎖並設為已核准
            if (nextState && (!isApproved || isBlocked)) {
                patchPayload.blocked = false;
                patchPayload.isBlocked = false;
                patchPayload.approved = true;
                patchPayload.isApproved = true;
            }

            const ok = await updateCloudFleetUserFields(targetDeviceId, patchPayload);
            if (ok) {
                showAdminUserActionToast(
                    nextState
                        ? `✅ 已開啟「${annotatedRealName || user.displayName}」僅社區標註授權`
                        : `🔒 已關閉「${annotatedRealName || user.displayName}」僅社區標註開關`,
                    nextState ? 'success' : 'info'
                );
            }
        };

        toggleSwitchBtn.addEventListener('click', handleToggleCommunityAuth);
        bldgToggleBox.addEventListener('click', handleToggleCommunityAuth);

        bldgToggleBox.appendChild(bldgTextCol);
        bldgToggleBox.appendChild(toggleSwitchBtn);

        togglesGrid.appendChild(accessToggleBox);
        togglesGrid.appendChild(routeToggleBox);
        togglesGrid.appendChild(bldgToggleBox);
        card.appendChild(togglesGrid);

        // 內嵌單向原名編輯列（預設隱藏，點擊「✏️ 標註／改原名」展開，修改 realName / originalName）
        const inlineOrigEditRow = document.createElement('div');
        inlineOrigEditRow.className = 'hidden bg-amber-50/90 border border-amber-300 rounded-xl p-2 space-y-1.5';
        inlineOrigEditRow.innerHTML = `
            <div class="text-[10px] font-black text-amber-900">✏️ 單向標註「${escapeHtmlSafe(user.displayName)}」的真實原名（僅開發者可見，不覆蓋對方自取名稱）：</div>
            <div class="flex items-center gap-1.5">
                <input type="text" class="admin-inline-orig-input flex-1 min-w-0 bg-white border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="輸入原名備註（如：阿翔）" value="${escapeHtmlSafe(annotatedRealName || user.displayName || '')}">
                <button type="button" class="admin-inline-orig-save bg-amber-600 hover:bg-amber-700 text-white font-black text-[11px] px-3 py-1.5 rounded-lg shadow active:scale-95 whitespace-nowrap">儲存</button>
                <button type="button" class="admin-inline-orig-cancel bg-white hover:bg-slate-100 text-slate-600 border border-slate-300 font-bold text-[11px] px-2.5 py-1.5 rounded-lg active:scale-95 whitespace-nowrap">取消</button>
            </div>
        `;
        card.appendChild(inlineOrigEditRow);

        const origInputEl = inlineOrigEditRow.querySelector('.admin-inline-orig-input');
        const origSaveBtn = inlineOrigEditRow.querySelector('.admin-inline-orig-save');
        const origCancelBtn = inlineOrigEditRow.querySelector('.admin-inline-orig-cancel');

        origSaveBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const cleanOrig = (origInputEl?.value || '').trim();
            origSaveBtn.disabled = true;
            const ok = await updateCloudFleetUserFields(targetDeviceId, {
                realName: cleanOrig,
                originalName: cleanOrig
            });
            if (ok) {
                showAdminUserActionToast(cleanOrig ? `🏷️ 已標註原名：${cleanOrig}` : '🏷️ 已清除原名標註', 'success');
            }
        });

        origCancelBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            inlineOrigEditRow.classList.add('hidden');
        });

        // 底部動作按鈕列：✏️ 標註／改原名（單向，僅開發者可見與可改） ＋ 🗑️ 刪除紀錄
        const bottomActions = document.createElement('div');
        bottomActions.className = 'flex items-center justify-between gap-2 pt-1';

        const editOrigNameBtn = document.createElement('button');
        editOrigNameBtn.type = 'button';
        editOrigNameBtn.className = 'flex-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-black py-1.5 px-2.5 rounded-xl text-[11px] active:scale-95 transition flex items-center justify-center gap-1 cursor-pointer';
        editOrigNameBtn.innerHTML = '<span>✏️ 標註／改原名</span>';
        editOrigNameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = inlineOrigEditRow.classList.contains('hidden');
            if (isHidden) {
                inlineOrigEditRow.classList.remove('hidden');
                setTimeout(() => {
                    origInputEl?.focus();
                    origInputEl?.select();
                }, 50);
            } else {
                inlineOrigEditRow.classList.add('hidden');
            }
        });

        const deleteRecordBtn = document.createElement('button');
        deleteRecordBtn.type = 'button';
        deleteRecordBtn.className = 'bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-black py-1.5 px-3 rounded-xl text-[11px] active:scale-95 transition flex items-center justify-center gap-1 cursor-pointer';
        deleteRecordBtn.innerHTML = '<span>🗑️ 刪除紀錄</span>';
        let deleteConfirmPending = false;
        let deleteResetTimer = null;
        deleteRecordBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!deleteConfirmPending) {
                deleteConfirmPending = true;
                deleteRecordBtn.className = 'bg-rose-600 hover:bg-rose-700 text-white border border-rose-700 font-black py-1.5 px-3 rounded-xl text-[11px] active:scale-95 transition flex items-center justify-center gap-1 cursor-pointer shadow';
                deleteRecordBtn.innerHTML = '<span>⚠️ 再點一次確認刪除</span>';
                if (deleteResetTimer) clearTimeout(deleteResetTimer);
                deleteResetTimer = setTimeout(() => {
                    deleteConfirmPending = false;
                    deleteRecordBtn.className = 'bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-black py-1.5 px-3 rounded-xl text-[11px] active:scale-95 transition flex items-center justify-center gap-1 cursor-pointer';
                    deleteRecordBtn.innerHTML = '<span>🗑️ 刪除紀錄</span>';
                }, 3500);
                return;
            }
            if (deleteResetTimer) clearTimeout(deleteResetTimer);
            deleteRecordBtn.disabled = true;
            deleteRecordBtn.innerHTML = '<span>刪除中...</span>';
            try {
                delete allCloudFleetUsersMap[targetDeviceId];
                renderAdminFleetUsersCardsFromMap(allCloudFleetUsersMap);
                await Promise.all([
                    fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(targetDeviceId)}.json`, { method: 'DELETE' }, 4500).catch(() => {}),
                    fetchWithTimeout(`${LIVE_FLEET_BASE_URL}/${encodeURIComponent(targetDeviceId)}.json`, { method: 'DELETE' }, 4500).catch(() => {})
                ]);
                showAdminUserActionToast(`🗑️ 已刪除「${annotatedRealName || user.displayName}」的使用者紀錄`, 'info');
            } finally {
                await fetchAndRenderAdminFleetUsersList();
            }
        });

        bottomActions.appendChild(editOrigNameBtn);
        bottomActions.appendChild(deleteRecordBtn);
        card.appendChild(bottomActions);

        listContainer.appendChild(card);
    });
}

async function fetchAndRenderAdminFleetUsersList() {
    if (isFetchingAdminFleetUsers) {
        pendingAdminFleetUsersRefresh = true;
        return;
    }
    isFetchingAdminFleetUsers = true;

    try {
        // 同時讀取 system_config/users（正式持久使用者權限節點）與 live_fleet（車隊即時雷達節點），確保所有使用者紀錄與權限狀態完整還原
        const [usersRes, liveRes] = await Promise.all([
            fetchWithTimeout(FLEET_USERS_ALL_URL, { cache: 'no-store' }, 5000).catch(() => null),
            fetchWithTimeout(LIVE_FLEET_ALL_URL, { cache: 'no-store' }, 5000).catch(() => null)
        ]);

        const rawUsers = (usersRes && usersRes.ok) ? (await usersRes.json() || {}) : {};
        const rawLive = (liveRes && liveRes.ok) ? (await liveRes.json() || {}) : {};
        const now = Date.now();

        const mergedMap = {};

        // 1. 先載入 Firebase system_config/users 節點中的所有使用者（嚴格以資料庫回傳的 canManageRoute / canEditCommunity / approved / realName 為準）
        if (rawUsers && typeof rawUsers === 'object') {
            Object.entries(rawUsers).forEach(([devId, u]) => {
                if (!devId || !u || typeof u !== 'object') return;
                mergedMap[devId] = normalizeFleetUserRecord(devId, u, null);
            });
        }

        // 2. 合併 live_fleet 中的線上裝置：若已在 system_config/users 中則只更新活躍時間（保留資料庫中的權限與原名）
        if (rawLive && typeof rawLive === 'object') {
            Object.entries(rawLive).forEach(([devId, liveInfo]) => {
                if (!devId || !liveInfo || typeof liveInfo !== 'object') return;
                const liveTs = Number(liveInfo.updatedAt || 0);
                const liveName = String(liveInfo.name || '車隊隊員').trim();
                if (mergedMap[devId]) {
                    if (liveTs > mergedMap[devId].lastSeen) {
                        mergedMap[devId].lastSeen = liveTs;
                        mergedMap[devId].lastActiveAt = liveTs;
                    }
                    if (liveName && (!mergedMap[devId].displayName || mergedMap[devId].displayName === '未命名隊員' || mergedMap[devId].displayName === '車隊隊員')) {
                        mergedMap[devId].displayName = liveName;
                    }
                    if (liveInfo.canManageRoute !== undefined && rawUsers?.[devId]?.canManageRoute === undefined) {
                        mergedMap[devId].canManageRoute = !mergedMap[devId].blocked && Boolean(liveInfo.canManageRoute);
                    }
                    if (liveInfo.canEditCommunity !== undefined && rawUsers?.[devId]?.canEditCommunity === undefined) {
                        const canEditFromLive = !mergedMap[devId].blocked && Boolean(liveInfo.canEditCommunity);
                        mergedMap[devId].canEditCommunity = canEditFromLive;
                        mergedMap[devId].canManageBuildings = canEditFromLive;
                    }
                } else {
                    const liveCanRoute = Boolean(liveInfo.canManageRoute);
                    const liveCanEdit = Boolean(liveInfo.canEditCommunity !== undefined ? liveInfo.canEditCommunity : liveInfo.canManageBuildings);
                    const liveBlocked = Boolean(liveInfo.blocked !== undefined ? liveInfo.blocked : liveInfo.isBlocked);
                    const liveApproved = liveBlocked ? false : (liveInfo.approved !== undefined ? Boolean(liveInfo.approved) : (liveInfo.isApproved !== undefined ? Boolean(liveInfo.isApproved) : true));
                    const liveRealName = String(liveInfo.realName || liveInfo.originalName || '').trim();
                    mergedMap[devId] = normalizeFleetUserRecord(devId, {
                        displayName: liveName || '車隊隊員',
                        realName: liveRealName,
                        originalName: liveRealName,
                        approved: liveApproved,
                        isApproved: liveApproved,
                        blocked: liveBlocked,
                        isBlocked: liveBlocked,
                        canManageRoute: liveBlocked ? false : liveCanRoute,
                        canEditCommunity: liveBlocked ? false : liveCanEdit,
                        canManageBuildings: liveBlocked ? false : liveCanEdit,
                        lastSeen: liveTs || now,
                        lastActiveAt: liveTs || now,
                        createdAt: liveTs || now,
                        updatedAt: liveTs || now
                    }, null);

                    // 自動將新發現的線上裝置寫入 system_config/users/{devId} 建檔持久化
                    fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(devId)}.json`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(mergedMap[devId])
                    }, 4000).catch(() => {});
                }
            });
        }

        allCloudFleetUsersMap = mergedMap;
        if (fleetDeviceId && mergedMap[fleetDeviceId]) {
            myCloudUserProfile = mergedMap[fleetDeviceId];
            syncAdminCurrentRoleBadgeUI();
            syncRoutePermissionControlsUI();
        }

        renderAdminFleetUsersCardsFromMap(mergedMap);
    } finally {
        isFetchingAdminFleetUsers = false;
        if (pendingAdminFleetUsersRefresh) {
            pendingAdminFleetUsersRefresh = false;
            fetchAndRenderAdminFleetUsersList();
        }
    }
}

function escapeHtmlSafe(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function updateCloudFleetUserFields(targetDeviceId, patchFields) {
    if (!targetDeviceId || !patchFields || typeof patchFields !== 'object') return false;
    const now = Date.now();
    // 備份修改前的完整紀錄，若 Firebase 寫入失敗或遭拒時可精準還原開關狀態
    const previousRecord = allCloudFleetUsersMap[targetDeviceId]
        ? { ...allCloudFleetUsersMap[targetDeviceId] }
        : null;
    const existingRecord = previousRecord || {};

    // 建立局部更新欄位，同時保留既有 displayName / realName / lastSeen，並寫入明確的權限欄位與 updatedAt
    const syncedPatch = {
        ...(existingRecord.displayName ? { displayName: existingRecord.displayName } : {}),
        ...(existingRecord.realName !== undefined ? { realName: existingRecord.realName, originalName: existingRecord.realName } : {}),
        ...(existingRecord.lastSeen ? { lastSeen: existingRecord.lastSeen, lastActiveAt: existingRecord.lastSeen } : {}),
        ...(existingRecord.createdAt ? { createdAt: existingRecord.createdAt } : {}),
        ...patchFields,
        updatedAt: now,
        updatedByAdminAt: now
    };

    // 統一讀寫欄位名稱（realName <-> originalName、canManageRoute、canEditCommunity <-> canManageBuildings、approved <-> isApproved、blocked <-> isBlocked）
    if (patchFields.realName !== undefined || patchFields.originalName !== undefined) {
        const nameVal = String(patchFields.realName !== undefined ? patchFields.realName : patchFields.originalName).trim();
        syncedPatch.realName = nameVal;
        syncedPatch.originalName = nameVal;
    }
    if (patchFields.canManageRoute !== undefined) {
        syncedPatch.canManageRoute = Boolean(patchFields.canManageRoute);
    }
    if (patchFields.canEditCommunity !== undefined || patchFields.canManageBuildings !== undefined) {
        const val = Boolean(patchFields.canEditCommunity !== undefined ? patchFields.canEditCommunity : patchFields.canManageBuildings);
        syncedPatch.canEditCommunity = val;
        syncedPatch.canManageBuildings = val;
    }
    if (patchFields.approved !== undefined || patchFields.isApproved !== undefined) {
        const val = Boolean(patchFields.approved !== undefined ? patchFields.approved : patchFields.isApproved);
        syncedPatch.approved = val;
        syncedPatch.isApproved = val;
    }
    if (patchFields.blocked !== undefined || patchFields.isBlocked !== undefined) {
        const val = Boolean(patchFields.blocked !== undefined ? patchFields.blocked : patchFields.isBlocked);
        syncedPatch.blocked = val;
        syncedPatch.isBlocked = val;
    }

    // 1. 先更新前端 UI 狀態讓滑動開關流暢切換
    allCloudFleetUsersMap[targetDeviceId] = normalizeFleetUserRecord(targetDeviceId, syncedPatch, existingRecord);
    if (targetDeviceId === fleetDeviceId) {
        myCloudUserProfile = allCloudFleetUsersMap[targetDeviceId];
        syncAdminCurrentRoleBadgeUI();
        syncRoutePermissionControlsUI();
        evaluateAndRenderAccessGateOverlay();
    }
    renderAdminFleetUsersCardsFromMap(allCloudFleetUsersMap);

    // 2. 實際呼叫 Firebase PATCH (update) 寫入資料庫 system_config/users/{uid}
    try {
        const writeRes = await fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(targetDeviceId)}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(syncedPatch)
        }, 5000);

        if (!writeRes.ok) {
            let errDetail = `HTTP ${writeRes.status}`;
            try {
                const errJson = await writeRes.json();
                if (errJson && errJson.error) errDetail += ` (${errJson.error})`;
            } catch (_) {}
            throw new Error(errDetail);
        }

        const savedData = await writeRes.json();
        if (savedData && typeof savedData === 'object' && savedData.error) {
            throw new Error(savedData.error);
        }

        // 若該使用者並非封鎖狀態，一併把最新權限欄位局部同步到 live_fleet/{uid}（若有在線節點時作為雙重備援）
        if (!syncedPatch.blocked) {
            fetchWithTimeout(`${LIVE_FLEET_BASE_URL}/${encodeURIComponent(targetDeviceId)}.json`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    canManageRoute: Boolean(allCloudFleetUsersMap[targetDeviceId].canManageRoute),
                    canEditCommunity: Boolean(allCloudFleetUsersMap[targetDeviceId].canEditCommunity),
                    canManageBuildings: Boolean(allCloudFleetUsersMap[targetDeviceId].canEditCommunity),
                    approved: Boolean(allCloudFleetUsersMap[targetDeviceId].approved),
                    blocked: Boolean(allCloudFleetUsersMap[targetDeviceId].blocked),
                    ...(allCloudFleetUsersMap[targetDeviceId].realName !== undefined
                        ? { realName: allCloudFleetUsersMap[targetDeviceId].realName, originalName: allCloudFleetUsersMap[targetDeviceId].realName }
                        : {})
                })
            }, 4000).catch(() => {});
        }

        if (targetDeviceId === fleetDeviceId) {
            await checkMyFleetUserAccessStatus();
        }
        return true;
    } catch (e) {
        // 寫入失敗或權限遭拒時：立即將該使用者的開關狀態還原至修改前，並彈出明確錯誤提示
        if (previousRecord) {
            allCloudFleetUsersMap[targetDeviceId] = previousRecord;
        }
        if (targetDeviceId === fleetDeviceId && previousRecord) {
            myCloudUserProfile = previousRecord;
            syncAdminCurrentRoleBadgeUI();
            syncRoutePermissionControlsUI();
            evaluateAndRenderAccessGateOverlay();
        }
        renderAdminFleetUsersCardsFromMap(allCloudFleetUsersMap);

        const errMsg = e?.message || '網路異常或權限遭拒';
        showAdminUserActionToast(`⚠️ Firebase 寫入失敗 (${errMsg})，已自動還原開關狀態！`, 'danger');
        alert(`⚠️ 儲存使用者權限至 Firebase 失敗（${errMsg}）！\n系統已自動將開關還原為原本狀態，請確認網路連線後重試。`);
        return false;
    }
}

