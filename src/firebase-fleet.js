// ==========================================
// [Module 5/10] src/firebase-fleet.js
// Firebase 雲端路線庫（shared_routes / pending_routes）、全自動車隊即時雷達（live_fleet）、背景保活與前景 GPS 自救看門狗
// ==========================================

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
let lastToastedUpdateSignature = '';
let isCheckingCloudUpdatesBg = false;

function getRouteTimestampKey(r) {
    return String(r.routeId || r.originId || r.id || r.uploadedAt || r.date || '').trim();
}

// 雲端清單自動去重（若雲端存在同名或同 ID 的重複節點，僅保留版本較高或更新時間較新的那一筆）
function deduplicateCloudRoutesList(cloudList) {
    if (!Array.isArray(cloudList)) return [];
    const uniqueCloud = [];
    for (let i = 0; i < cloudList.length; i++) {
        const item = cloudList[i];
        if (!item || !item.name) continue;
        const matchIdx = uniqueCloud.findIndex(existing => isSameRouteIdentity(existing, item));
        if (matchIdx !== -1) {
            const verA = getRouteVersion(uniqueCloud[matchIdx]);
            const verB = getRouteVersion(item);
            const updA = getRouteUpdatedAt(uniqueCloud[matchIdx]);
            const updB = getRouteUpdatedAt(item);
            if (verB > verA || (verB === verA && updB > updA)) {
                uniqueCloud[matchIdx] = item;
            }
        } else {
            uniqueCloud.push(item);
        }
    }
    return uniqueCloud;
}

// 尋找與本機路線對應的雲端正式庫路線（依原路線 id、routeId 或相同名稱 name.trim() 比對）
function findMatchingCloudRoute(localRoute, cloudList = cachedCloudRoutes) {
    if (!localRoute || localRoute.isPendingPreview || !Array.isArray(cloudList) || cloudList.length === 0) return null;
    const matches = cloudList.filter(cr => isSameRouteIdentity(localRoute, cr));
    if (matches.length === 0) return null;
    // 若雲端有多筆相符，取版本最高、時間最新的一筆
    return matches.reduce((best, cur) => {
        const bestVer = getRouteVersion(best);
        const curVer = getRouteVersion(cur);
        if (curVer > bestVer) return cur;
        if (curVer === bestVer && getRouteUpdatedAt(cur) > getRouteUpdatedAt(best)) return cur;
        return best;
    }, matches[0]);
}

// 判斷本機路線是否在雲端有新版本（routeVersion 比對）
function getCloudRouteUpdateInfo(localRoute, cloudList = cachedCloudRoutes) {
    const localVer = getRouteVersion(localRoute);
    const matchingCloud = findMatchingCloudRoute(localRoute, cloudList);
    if (!matchingCloud) {
        return { hasUpdate: false, localVer, cloudVer: null, cloudRoute: null, updateTimeText: '' };
    }
    const cloudVer = getRouteVersion(matchingCloud);
    const hasUpdate = cloudVer > localVer;
    return {
        hasUpdate,
        localVer,
        cloudVer,
        cloudRoute: matchingCloud,
        updateTimeText: formatRouteUpdateTimeText(matchingCloud)
    };
}

// 同步首頁「有更新」橘紅徽章、已儲存清單頂端「一鍵全部更新」列與頂部輕量提示條
function syncRouteUpdateBadgesAndAllBar(shouldShowTopToast = false) {
    const updatableList = [];
    if (Array.isArray(savedRoutes) && Array.isArray(cachedCloudRoutes) && cachedCloudRoutes.length > 0) {
        savedRoutes.forEach((localRoute, idx) => {
            const info = getCloudRouteUpdateInfo(localRoute);
            if (info.hasUpdate && info.cloudRoute) {
                updatableList.push({ localIdx: idx, localRoute, ...info });
            }
        });
    }

    const count = updatableList.length;
    const homeBadgeEl = document.getElementById('historyUpdateBadge');
    if (homeBadgeEl) {
        if (count > 0) {
            homeBadgeEl.textContent = `有更新 (${count})`;
            homeBadgeEl.classList.remove('hidden');
        } else {
            homeBadgeEl.classList.add('hidden');
        }
    }

    const updateAllBarEl = document.getElementById('historyUpdateAllBar');
    const updateAllTextEl = document.getElementById('historyUpdateAllText');
    if (updateAllBarEl) {
        if (count > 0) {
            if (updateAllTextEl) {
                updateAllTextEl.textContent = `偵測到 ${count} 條路線在雲端有新版本`;
            }
            updateAllBarEl.classList.remove('hidden');
        } else {
            updateAllBarEl.classList.add('hidden');
        }
    }

    if (shouldShowTopToast && count > 0) {
        const sig = updatableList.map(u => `${u.localRoute.routeId || u.localRoute.name}:${u.localVer}->${u.cloudVer}`).join('|');
        if (sig && sig !== lastToastedUpdateSignature) {
            lastToastedUpdateSignature = sig;
            showNavAlert('🔄', `偵測到 ${count} 條路線在雲端有新版本，請至已儲存路線更新`, 'bg-orange-600');
        }
    }

    return updatableList;
}

// 背景自動讀取雲端路線庫並比對版本
async function checkCloudRouteUpdatesInBackground(shouldShowTopToast = false) {
    if (!navigator.onLine || isCheckingCloudUpdatesBg) return;
    isCheckingCloudUpdatesBg = true;
    try {
        const rawShared = await fetchRawFirebaseList(FIREBASE_ROUTES_URL);
        rawShared.sort((a, b) => {
            const tA = getRouteUpdatedAt(a);
            const tB = getRouteUpdatedAt(b);
            return tB - tA;
        });
        cachedCloudRoutes = deduplicateCloudRoutesList(rawShared);
        syncRouteUpdateBadgesAndAllBar(shouldShowTopToast);
        if (historyModal && !historyModal.classList.contains('hidden')) {
            renderHistoryList();
        }
    } catch (e) {
        // 離線或逾時靜默略過
    } finally {
        isCheckingCloudUpdatesBg = false;
    }
}

// 單條路線一鍵升級至雲端最新版（原地覆蓋 In-Place Overwrite，保留原排序位置與本機 id）
function applySingleCloudRouteUpdate(localIdx, cloudRoute) {
    if (!cloudRoute) return;
    const targetBefore = (localIdx >= 0 && localIdx < savedRoutes.length) ? savedRoutes[localIdx] : null;
    const oldVer = targetBefore ? getRouteVersion(targetBefore) : 1;
    const updatedLocal = upsertLocalRouteFromCloud(cloudRoute, localIdx);

    persistSavedRoutesToStorage().then(() => {
        syncRouteUpdateBadgesAndAllBar(false);
        renderHistoryList();
        if (cloudRoutesModal && !cloudRoutesModal.classList.contains('hidden')) {
            renderCloudRoutesList();
        }
        showNavAlert('✅', `已將「${updatedLocal.name}」由 v${oldVer} 原地覆蓋更新至 v${updatedLocal.routeVersion} 最新版！`, 'bg-emerald-600');
    });
}

// 多條路線一鍵全部更新至雲端最新版（原地覆蓋 In-Place Overwrite，保留原排序位置與本機 id）
function applyAllCloudRouteUpdates() {
    const updatableList = syncRouteUpdateBadgesAndAllBar(false);
    if (updatableList.length === 0) return;

    updatableList.forEach(item => {
        if (item.cloudRoute) {
            upsertLocalRouteFromCloud(item.cloudRoute, item.localIdx);
        }
    });

    persistSavedRoutesToStorage().then(() => {
        syncRouteUpdateBadgesAndAllBar(false);
        renderHistoryList();
        if (cloudRoutesModal && !cloudRoutesModal.classList.contains('hidden')) {
            renderCloudRoutesList();
        }
        showNavAlert('✅', `已完成一鍵更新！共 ${updatableList.length} 條路線原地升級為雲端最新版`, 'bg-emerald-600');
    });
}

document.getElementById('btnUpdateAllLocalRoutes')?.addEventListener('click', () => {
    applyAllCloudRouteUpdates();
});

function isRouteAlreadyInLocal(cloudRoute) {
    if (!cloudRoute) return false;
    const cVer = getRouteVersion(cloudRoute);
    const cUpd = getRouteUpdatedAt(cloudRoute);

    return savedRoutes.some(local => {
        if (!local || local.isPendingPreview) return false;
        if (!isSameRouteIdentity(local, cloudRoute)) return false;
        const lVer = getRouteVersion(local);
        const lUpd = getRouteUpdatedAt(local);
        // 若雲端版本號大於本機版本號，或同版本但雲端更新時間較新，代表雲端有新版可覆蓋更新
        if (cVer > lVer) return false;
        if (cVer === lVer && cloudRoute.uploadedAt && local.uploadedAt && cloudRoute.uploadedAt !== local.uploadedAt && cUpd > lUpd) {
            return false;
        }
        return true;
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

async function publishRouteToSharedDB(payload, overwriteMode = true) {
    if (!isAdminUnlocked) {
        throw new Error('PERMISSION_DENIED_ADMIN_REQUIRED');
    }

    const sharedList = await fetchRawFirebaseList(FIREBASE_ROUTES_URL);
    const cleanTargetName = (payload.name || '').replace(/^\[待審預覽\]\s*/, '').trim();
    const targetMatches = sharedList.filter(item =>
        (payload.routeId && item.routeId && item.routeId === payload.routeId) ||
        (payload.targetRouteId && item.routeId && item.routeId === payload.targetRouteId) ||
        ((item.name || '').trim().toLowerCase() === cleanTargetName.toLowerCase())
    );

    const nowTs = Date.now();
    const nowIso = new Date(nowTs).toISOString();
    const uploadedAtText = new Date(nowTs).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const cleanPayload = { ...payload, name: cleanTargetName };
    delete cleanPayload.firebaseKey;
    delete cleanPayload.uploadAction;
    delete cleanPayload.targetFirebaseKey;
    delete cleanPayload.targetRouteId;
    delete cleanPayload.isPendingPreview;

    if (overwriteMode && targetMatches.length > 0) {
        const primaryMatch = targetMatches[0];
        const primaryKey = primaryMatch.firebaseKey;
        const maxExistingCloudVer = targetMatches.reduce((maxV, item) => Math.max(maxV, getRouteVersion(item)), 1);
        // 雲端已存在同名或同 routeId 路線：自動將 routeVersion 在雲端現有版本基礎上 + 1
        const nextVer = maxExistingCloudVer + 1;

        cleanPayload.routeId = primaryMatch.routeId || payload.targetRouteId || cleanPayload.routeId || generateRouteId();
        cleanPayload.routeVersion = nextVer;
        cleanPayload.updatedAt = nowTs;
        cleanPayload.uploadedAt = nowIso;
        cleanPayload.uploadedAtText = uploadedAtText;
        cleanPayload.date = uploadedAtText;

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
        cleanPayload.routeId = payload.targetRouteId || cleanPayload.routeId || generateRouteId();
        cleanPayload.routeVersion = getRouteVersion(cleanPayload);
        cleanPayload.updatedAt = nowTs;
        cleanPayload.uploadedAt = cleanPayload.uploadedAt || nowIso;
        cleanPayload.uploadedAtText = cleanPayload.uploadedAtText || uploadedAtText;
        cleanPayload.date = cleanPayload.date || uploadedAtText;

        const postRes = await fetchWithTimeout(FIREBASE_ROUTES_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cleanPayload)
        }, 5000);
        if (!postRes.ok) throw new Error(`POST HTTP ${postRes.status}`);
    }

    // 同步將本機 localStorage / localforage 中對應的路線原地更新為剛發布的最新版本（不重複新增）
    for (let i = savedRoutes.length - 1; i >= 0; i--) {
        if (savedRoutes[i]?.isPendingPreview) {
            savedRoutes.splice(i, 1);
        }
    }
    upsertLocalRouteFromCloud(cleanPayload);
    await persistSavedRoutesToStorage();

    await checkCloudRouteUpdatesInBackground(false);
    return cleanPayload;
}

async function uploadRouteToCloud(routeIdx, btnEl) {
    const r = savedRoutes[routeIdx];
    if (!r) return;

    if (!navigator.onLine) {
        alert('⚠️ 目前無網路連線，請確認網路狀態後再上傳至雲端！');
        return;
    }

    // 確保具備唯一 routeId 與初始 routeVersion 並寫回本機
    if (!r.routeId) {
        r.routeId = generateRouteId();
    }
    r.routeVersion = getRouteVersion(r);
    r.updatedAt = getRouteUpdatedAt(r);
    await localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);

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
        let nextRouteVersion = getRouteVersion(r);

        if (conflictRoute) {
            const choice = await askUploadConflictChoice(conflictRoute, r);
            if (!choice) return; // 使用者取消上傳
            uploadAction = choice;
            if (choice === 'overwrite') {
                finalRouteId = conflictRoute.routeId || r.routeId;
                r.routeId = finalRouteId;
                // 雲端已存在同名或同 routeId 路線：自動將 routeVersion 在原本基礎上 + 1
                const cloudBaseVer = getRouteVersion(conflictRoute);
                nextRouteVersion = Math.max(cloudBaseVer, getRouteVersion(r)) + 1;
                await localforage.setItem('yinggeCleanRoutes_v2', savedRoutes);
            } else if (choice === 'new') {
                finalRouteId = generateRouteId();
                r.routeId = finalRouteId;
                nextRouteVersion = 1;
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

        // 2. 嚴格權限隔離：非管理員（!isAdminUnlocked）點擊上傳時，一律寫入 pending_routes；
        // 僅在開啟管理員權限（isAdminUnlocked === true）下，才可直接覆蓋 shared_routes。
        const publishDirectlyAsAdmin = Boolean(isAdminUnlocked);

        if (btnEl) {
            btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 上傳中...';
        }

        const nowTs = Date.now();
        const nowIso = new Date(nowTs).toISOString();
        const uploadedAtText = new Date(nowTs).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const payload = {
            routeId: finalRouteId,
            targetRouteId: conflictRoute ? (conflictRoute.routeId || finalRouteId) : finalRouteId,
            id: r.id || nowTs,
            originId: r.originId || r.id || nowTs,
            name: finalRouteName,
            author: finalAuthor,
            routeVersion: nextRouteVersion,
            updatedAt: nowTs,
            date: r.date || uploadedAtText,
            uploadedAt: nowIso,
            uploadedAtText: uploadedAtText,
            distance: r.distance || '0.00',
            timeStr: r.timeStr || '0m 0s',
            uploadAction: uploadAction,
            targetFirebaseKey: conflictRoute ? conflictRoute.firebaseKey : null,
            points: r.points || [],
            events: r.events || [],
            callouts: Array.isArray(r.callouts) ? r.callouts : []
        };

        if (publishDirectlyAsAdmin) {
            const published = await publishRouteToSharedDB(payload, uploadAction === 'overwrite');
            renderHistoryList();
            alert(`✅ 管理員直通上架成功！\n路線【${finalRouteName}】(v${published.routeVersion}) 已${uploadAction === 'overwrite' ? '覆蓋更新至' : '新增至'}正式雲端路線庫。`);
        } else {
            // 一般隊員上傳至 pending_routes：不提前竄改本機正式版號，待管理員審核通過後再同步升級
            r.updatedAt = nowTs;
            r.uploadedAt = nowIso;
            r.uploadedAtText = uploadedAtText;
            await persistSavedRoutesToStorage();
            renderHistoryList();

            const res = await fetchWithTimeout(FIREBASE_PENDING_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }, 5000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            alert(`✅ 已提交至待審核區（pending_routes），待管理員審核確認後發布正式版！\n\n路線名稱：${finalRouteName} (目標版本 v${nextRouteVersion})\n分享隊員：${finalAuthor}\n提交模式：${uploadAction === 'overwrite' ? '🔄 覆蓋更新原路線' : '🆕 新增路線'}`);
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
    isAdminUnlocked = Boolean(unlocked);
    if (!adminToggleBtn) return;

    const isDev = (typeof localUserPermissionRole !== 'undefined' && localUserPermissionRole === 'developer');
    const isCommunityOnly = !isAdminUnlocked && (typeof canCurrentUserManageBuildings === 'function' && canCurrentUserManageBuildings());

    if (isAdminUnlocked) {
        adminToggleBtn.className = "px-2.5 h-9 rounded-xl bg-indigo-600 text-white border border-indigo-700 text-xs font-extrabold flex items-center gap-1 shadow-sm active:scale-95 transition-all whitespace-nowrap";
        adminToggleBtn.innerHTML = isDev ? '🛠️ 開發者管理' : '🛡️ 路線管理員';
        cloudAdminTabBar?.classList.remove('hidden');
    } else if (isCommunityOnly) {
        adminToggleBtn.className = "px-2.5 h-9 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-300 text-xs font-extrabold flex items-center gap-1 active:scale-95 transition-all whitespace-nowrap";
        adminToggleBtn.innerHTML = '🏢 社區標註員';
        cloudAdminTabBar?.classList.add('hidden');
        currentCloudTab = 'shared';
        updateCloudTabButtons();
    } else {
        // 一般使用者不顯示「一般唯讀」徽章與鎖頭圖示
        adminToggleBtn.className = "hidden";
        adminToggleBtn.innerHTML = '';
        cloudAdminTabBar?.classList.add('hidden');
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
    const isDev = (typeof localUserPermissionRole !== 'undefined' && localUserPermissionRole === 'developer');
    const hasRouteAuth = typeof canCurrentUserManageRoutes === 'function' && canCurrentUserManageRoutes();
    const hasBldgAuth = typeof canCurrentUserManageBuildings === 'function' && canCurrentUserManageBuildings();
    if (hasRouteAuth) {
        alert(isDev ? '本裝置已獲得開發者管理授權' : '本裝置已獲得管理授權');
    } else if (hasBldgAuth) {
        alert('本裝置已獲得社區標註授權');
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

        // 排序正式庫（由新到舊）並自動去重
        rawShared.sort((a, b) => {
            const tA = getRouteUpdatedAt(a);
            const tB = getRouteUpdatedAt(b);
            return tB - tA;
        });
        cachedCloudRoutes = deduplicateCloudRoutesList(rawShared);

        // 排序待審核區（由新到舊）
        rawPending.sort((a, b) => {
            const tA = getRouteUpdatedAt(a);
            const tB = getRouteUpdatedAt(b);
            return tB - tA;
        });
        cachedPendingRoutes = rawPending;
        if (pendingCountPill) pendingCountPill.innerText = cachedPendingRoutes.length;

        syncRouteUpdateBadgesAndAllBar(false);
        renderHistoryList();
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

    const cleanName = (pr.name || '').replace(/^\[待審預覽\]\s*/, '').trim();
    const matchingShared = cachedCloudRoutes.find(item =>
        (pr.routeId && item.routeId && item.routeId === pr.routeId) ||
        (pr.targetRouteId && item.routeId && item.routeId === pr.targetRouteId) ||
        ((item.name || '').trim().toLowerCase() === cleanName.toLowerCase())
    );
    const isOverwrite = Boolean(matchingShared || pr.uploadAction === 'overwrite');
    const resolvedTargetId = matchingShared?.routeId || pr.targetRouteId || pr.routeId || generateRouteId();
    const modeText = isOverwrite ? '【原地覆蓋升版】正式庫路線' : '【新增發布】至正式路線庫';
    if (!confirm(`確定要核准【${pr.author || '隊員'}】投稿的路線「${cleanName}」並${modeText}嗎？`)) return;

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 發布中';
    }

    try {
        const payloadToPublish = {
            ...pr,
            name: cleanName,
            routeId: resolvedTargetId,
            targetRouteId: resolvedTargetId
        };
        const published = await publishRouteToSharedDB(payloadToPublish, true);
        const delRes = await fetchWithTimeout(`${FIREBASE_BASE_URL}/pending_routes/${pr.firebaseKey}.json`, { method: 'DELETE' }, 5000);
        if (!delRes.ok) throw new Error(`DELETE pending HTTP ${delRes.status}`);

        showNavAlert('✅', `已核准並發布「${cleanName}」(v${published.routeVersion})，並自動清除待審紀錄！`, 'bg-emerald-600');
        await fetchCloudRoutes();
    } catch (err) {
        console.error('核准失敗:', err);
        alert('❌ 核准上架失敗（網路不穩或逾時），請檢查網路連線後再試！');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '✅ 直接核准';
        }
    }
}

// 🔍 1. 新增「審核預覽／直接微調」入口：
// 點擊後直接在地圖載入該筆待審路線並進入「審核模式」（記錄 reviewingPendingId 與 targetRouteId），
// 嚴禁將它重複新增到本機 savedRoutes 清單，並直接使用現有路線編輯器（拖曳微調／手繪延伸剪接／標記編輯）進行二次修改
function previewPendingRoute(pendingIdx) {
    const pr = cachedPendingRoutes[pendingIdx];
    if (!pr || !isAdminUnlocked) {
        alert('⚠️ 僅限管理員權限可進入待審路線審核微調模式！');
        return;
    }

    const cleanBaseName = (pr.name || '未命名路線').replace(/^\[待審預覽\]\s*/, '').trim();
    const matchingOfficial = cachedCloudRoutes.find(item =>
        (pr.routeId && item.routeId && item.routeId === pr.routeId) ||
        (pr.targetRouteId && item.routeId && item.routeId === pr.targetRouteId) ||
        ((item.name || '').trim().toLowerCase() === cleanBaseName.toLowerCase())
    );

    reviewingPendingId = pr.firebaseKey;
    targetRouteId = matchingOfficial?.routeId || pr.targetRouteId || pr.routeId || generateRouteId();
    isReviewingPendingMode = true;

    reviewingPendingRoute = {
        ...JSON.parse(JSON.stringify(pr)),
        name: cleanBaseName,
        routeId: targetRouteId,
        targetRouteId: targetRouteId,
        author: pr.author || '熱心隊員',
        distance: pr.distance || '0.00',
        timeStr: pr.timeStr || '0m 0s',
        points: JSON.parse(JSON.stringify(pr.points || [])),
        events: JSON.parse(JSON.stringify(pr.events || [])),
        callouts: JSON.parse(JSON.stringify(pr.callouts || []))
    };

    // 確保距離、方位角與標記索引同步
    syncRouteMarkersAndIndicesAfterSpline(reviewingPendingRoute, null, false);

    // 關閉雲端彈窗與主畫面面板，直接進入地圖審核編輯器
    cloudRoutesModal.classList.add('hidden');
    historyModal.classList.add('hidden');
    document.getElementById('mainUI').classList.add('hidden');
    document.getElementById('routeDetailUI').classList.add('hidden');
    document.getElementById('playbackUI').classList.add('hidden');
    document.getElementById('topBackBtn').classList.remove('hidden');

    isEditingMode = true;
    editStep = 0;
    selectedEditNodeIdx = -1;
    freehandUndoStack = [];
    freehandSpliceStartIdx = -1;
    freehandDraftCoords = [];
    originalEventsBackup = JSON.parse(JSON.stringify(reviewingPendingRoute.events || []));
    originalPointsBackup = JSON.parse(JSON.stringify(reviewingPendingRoute.points || []));
    originalCalloutsBackup = JSON.parse(JSON.stringify(reviewingPendingRoute.callouts || []));

    // 切換編輯面板為「待審微調審核模式」專屬 UI
    if (pendingReviewBanner) pendingReviewBanner.classList.remove('hidden');
    if (pendingReviewRouteTitle) {
        const nextVerHint = matchingOfficial ? `覆蓋升版 ➔ v${getRouteVersion(matchingOfficial) + 1}` : '全新路線 v1';
        pendingReviewRouteTitle.textContent = `${cleanBaseName}（${nextVerHint}）`;
    }
    if (pendingReviewMetaText) {
        pendingReviewMetaText.textContent = `投稿隊員：${reviewingPendingRoute.author} · 可直接微調路線/標記後一鍵核准發布`;
    }
    if (normalEditActionRow) normalEditActionRow.classList.add('hidden');
    if (pendingReviewActionRow) pendingReviewActionRow.classList.remove('hidden');

    document.getElementById('editRouteBar').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = `🔍 審核微調：${cleanBaseName}`;

    map.getSource('bg-route')?.setData(emptyGeoJSON());
    updateRouteLayers(reviewingPendingRoute.points);
    ensureEditorMapZoomEnabled();
    setEditSubMode('path');
    renderEditableRouteMarkers(reviewingPendingRoute);

    if (Array.isArray(reviewingPendingRoute.points) && reviewingPendingRoute.points.length >= 2) {
        const bounds = new maplibregl.LngLatBounds();
        reviewingPendingRoute.points.forEach(p => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: { top: 90, bottom: 300, left: 50, right: 50 }, bearing: 0, duration: 500 });
    }

    showNavAlert('🔍', `已載入待審路線「${cleanBaseName}」，可直接微調後按底部「✅ 核准並發布正式版」`, 'bg-amber-600');
}

function exitPendingReviewMode(reopenCloudPendingModal = true) {
    isEditingMode = false;
    isReviewingPendingMode = false;
    reviewingPendingId = null;
    targetRouteId = null;
    reviewingPendingRoute = null;
    selectedEditNodeIdx = -1;

    clearPathEditMarkers();
    clearPendingCalloutAnchor();
    cancelActiveFreehandStroke(true);
    freehandUndoStack = [];
    updateUndoFreehandBtnUI();
    updateNodeTrimPanelUI(null);
    if (tempMarkerA) { tempMarkerA.remove(); tempMarkerA = null; }
    try { map.dragPan.enable(); } catch (e) {}
    ensureEditorMapZoomEnabled();

    if (pendingReviewBanner) pendingReviewBanner.classList.add('hidden');
    if (pendingReviewActionRow) pendingReviewActionRow.classList.add('hidden');
    if (normalEditActionRow) normalEditActionRow.classList.remove('hidden');
    document.getElementById('editRouteBar').classList.add('hidden');
    document.getElementById('topBackBtn').classList.add('hidden');
    document.getElementById('mainUI').classList.remove('hidden');
    document.getElementById('appStatusTitle').innerText = '鶯歌清運路線助手';

    clearDomMarkers();
    updateRouteLayers([]);
    map.getSource('bg-route')?.setData(emptyGeoJSON());

    if (reopenCloudPendingModal) {
        currentCloudTab = 'pending';
        updateCloudTabButtons();
        cloudRoutesModal.classList.remove('hidden');
        fetchCloudRoutes();
    }
}

if (btnExitPendingReview) {
    btnExitPendingReview.onclick = () => {
        exitPendingReviewMode(true);
    };
}

// ✅ 2. 「✅ 核准並發布正式版」一鍵自動化（免改名 ＋ 自動升版寫入 shared_routes ＋ 自動刪除 pending_routes ＋ 同步原地更新本機 localStorage）
async function approveAndPublishReviewedPendingRoute() {
    if (!isAdminUnlocked || !isReviewingPendingMode || !reviewingPendingRoute || !reviewingPendingId) {
        alert('⚠️ 僅限管理員在審核模式下執行核准發布！');
        return;
    }

    if (!navigator.onLine) {
        alert('⚠️ 目前無網路連線，請確認網路狀態後再核准發布！');
        return;
    }

    if (!Array.isArray(reviewingPendingRoute.points) || reviewingPendingRoute.points.length < 2) {
        alert('⚠️ 路線軌跡點不足 2 點，無法發布！');
        return;
    }

    // 1. 取得當前畫面上的最終路線資料（包含管理員剛剛順手做的所有微調、修剪、手繪與標記修改）
    syncRouteMarkersAndIndicesAfterSpline(reviewingPendingRoute, null, true);

    const cleanName = (reviewingPendingRoute.name || '未命名路線').replace(/^\[待審預覽\]\s*/, '').trim();
    const pendingKeyToDelete = reviewingPendingId;
    const finalTargetRouteId = targetRouteId || reviewingPendingRoute.routeId || generateRouteId();

    const originalBtnHtml = btnApproveAndPublishReview ? btnApproveAndPublishReview.innerHTML : '✅ 核准並發布正式版';
    if (btnApproveAndPublishReview) {
        btnApproveAndPublishReview.disabled = true;
        btnApproveAndPublishReview.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在核准並發布...';
    }
    if (btnRejectAndDeleteReview) btnRejectAndDeleteReview.disabled = true;

    try {
        // 2. 免修改路線名稱，直接以原路線的 routeId (targetRouteId) 寫入 Firebase shared_routes
        // 若已存在同 routeId 或同名路線則原地覆蓋並自動將 routeVersion + 1 與更新 updatedAt；若為全新路線則建立新 ID
        const payloadToPublish = {
            ...reviewingPendingRoute,
            name: cleanName,
            routeId: finalTargetRouteId,
            targetRouteId: finalTargetRouteId
        };

        const published = await publishRouteToSharedDB(payloadToPublish, true);

        // 3. 寫入成功後，自動呼叫 Firebase 刪除 pending_routes/${reviewingPendingId}，將該筆待審紀錄從待審區移除
        const delRes = await fetchWithTimeout(`${FIREBASE_BASE_URL}/pending_routes/${pendingKeyToDelete}.json`, {
            method: 'DELETE'
        }, 5000);
        if (!delRes.ok) throw new Error(`DELETE pending HTTP ${delRes.status}`);

        // 4. publishRouteToSharedDB 已同步透過 upsertLocalRouteFromCloud + persistSavedRoutesToStorage 將管理員本機 localStorage 對應路線原地更新為剛發布的最新版本
        renderHistoryList();

        exitPendingReviewMode(true);
        showNavAlert('✅', `已核准發布「${published.name}」正式版 (v${published.routeVersion})，並自動清除待審紀錄與同步更新本機！`, 'bg-emerald-600');
    } catch (err) {
        console.error('審核核准並發布失敗:', err);
        alert('❌ 核准並發布正式版失敗（網路不穩或連線逾時），請檢查網路後再試！');
    } finally {
        if (btnApproveAndPublishReview) {
            btnApproveAndPublishReview.disabled = false;
            btnApproveAndPublishReview.innerHTML = originalBtnHtml;
        }
        if (btnRejectAndDeleteReview) btnRejectAndDeleteReview.disabled = false;
    }
}

// 🗑️ 審核模式底部「🗑️ 駁回刪除」按鈕
async function rejectReviewedPendingRoute() {
    if (!isAdminUnlocked || !isReviewingPendingMode || !reviewingPendingRoute || !reviewingPendingId) {
        return;
    }

    const cleanName = (reviewingPendingRoute.name || '未命名路線').replace(/^\[待審預覽\]\s*/, '').trim();
    if (!confirm(`確定要駁回並從待審區永久刪除【${reviewingPendingRoute.author || '隊員'}】投稿的路線「${cleanName}」嗎？`)) {
        return;
    }

    const pendingKeyToDelete = reviewingPendingId;
    const originalBtnHtml = btnRejectAndDeleteReview ? btnRejectAndDeleteReview.innerHTML : '🗑️ 駁回刪除';
    if (btnRejectAndDeleteReview) {
        btnRejectAndDeleteReview.disabled = true;
        btnRejectAndDeleteReview.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 刪除中';
    }
    if (btnApproveAndPublishReview) btnApproveAndPublishReview.disabled = true;

    try {
        const res = await fetchWithTimeout(`${FIREBASE_BASE_URL}/pending_routes/${pendingKeyToDelete}.json`, {
            method: 'DELETE'
        }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // 清除本機若曾殘留的舊版待審預覽項目
        let removedLegacyPreview = false;
        for (let i = savedRoutes.length - 1; i >= 0; i--) {
            if (savedRoutes[i]?.isPendingPreview) {
                savedRoutes.splice(i, 1);
                removedLegacyPreview = true;
            }
        }
        if (removedLegacyPreview) {
            await persistSavedRoutesToStorage();
            renderHistoryList();
        }

        exitPendingReviewMode(true);
        showNavAlert('🗑️', `已駁回並刪除待審路線「${cleanName}」`, 'bg-rose-600');
    } catch (err) {
        console.error('駁回刪除待審路線失敗:', err);
        alert('❌ 駁回刪除失敗（網路不穩或逾時），請檢查網路連線後再試！');
    } finally {
        if (btnRejectAndDeleteReview) {
            btnRejectAndDeleteReview.disabled = false;
            btnRejectAndDeleteReview.innerHTML = originalBtnHtml;
        }
        if (btnApproveAndPublishReview) btnApproveAndPublishReview.disabled = false;
    }
}

if (btnApproveAndPublishReview) {
    btnApproveAndPublishReview.onclick = () => approveAndPublishReviewedPendingRoute();
}
if (btnRejectAndDeleteReview) {
    btnRejectAndDeleteReview.onclick = () => rejectReviewedPendingRoute();
}

async function rejectPendingRoute(pendingIdx, btnEl) {
    const pr = cachedPendingRoutes[pendingIdx];
    if (!pr || !isAdminUnlocked) return;

    if (!confirm(`確定要駁回刪除待審核路線【${pr.name}】（投稿者：${pr.author || '隊員'}）嗎？`)) return;

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
        const res = await fetchWithTimeout(`${FIREBASE_BASE_URL}/pending_routes/${pr.firebaseKey}.json`, { method: 'DELETE' }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        showNavAlert('🗑️', `已駁回刪除待審核路線【${pr.name}】`, 'bg-rose-600');
        await fetchCloudRoutes();
    } catch (err) {
        console.error('刪除待審核路線失敗:', err);
        alert('❌ 刪除失敗（網路不穩或逾時），請檢查網路連線後再試！');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = '🗑️ 駁回刪除';
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
            const cleanName = (pr.name || '').replace(/^\[待審預覽\]\s*/, '').trim();
            const matchingOfficial = cachedCloudRoutes.find(item =>
                (pr.routeId && item.routeId && item.routeId === pr.routeId) ||
                (pr.targetRouteId && item.routeId && item.routeId === pr.targetRouteId) ||
                ((item.name || '').trim().toLowerCase() === cleanName.toLowerCase())
            );
            const isOverwrite = Boolean(matchingOfficial || pr.uploadAction === 'overwrite');
            const actionBadge = isOverwrite
                ? `<span class="bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded-full font-extrabold">🔄 覆蓋升版${matchingOfficial ? ` (v${getRouteVersion(matchingOfficial)}➔v${getRouteVersion(matchingOfficial) + 1})` : ''}</span>`
                : `<span class="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded-full font-extrabold">🆕 新增路線 (v1)</span>`;

            const card = document.createElement('div');
            card.className = "bg-white p-3.5 rounded-2xl shadow-sm border-2 border-amber-200 flex flex-col gap-2.5";
            card.innerHTML = `
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-black text-gray-900 text-sm truncate">${cleanName}</span>
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
                    <button type="button" class="preview-pending-btn flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-2 px-2.5 rounded-xl text-xs shadow-sm active:scale-95 transition-all whitespace-nowrap">
                        🔍 審核預覽／微調
                    </button>
                    <button type="button" class="approve-pending-btn bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-3 py-2 rounded-xl text-xs shadow-sm active:scale-95 transition-all whitespace-nowrap">
                        ✅ 直接核准
                    </button>
                    <button type="button" class="reject-pending-btn bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-extrabold px-2.5 py-2 rounded-xl text-xs active:scale-95 transition-all whitespace-nowrap">
                        🗑️ 駁回刪除
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
        const cloudVer = getRouteVersion(cr);
        const stopsCount = (cr.points || []).filter(p => p.is_stop).length;
        const eventsCount = (cr.events || []).length;
        const timeDisplay = formatRouteUpdateTimeText(cr);

        const card = document.createElement('div');
        card.className = "route-lib-card bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between gap-2";
        card.innerHTML = `
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="route-lib-title font-black text-gray-900 text-sm truncate">${cr.name}</span>
                    <span class="route-lib-ver-badge bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded-md font-extrabold whitespace-nowrap">v${cloudVer}</span>
                    <span class="route-lib-author-badge bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap">
                        <i class="fa-solid fa-user-ninja mr-0.5"></i>${cr.author || '熱心隊員'}
                    </span>
                </div>
                <div class="route-lib-date text-[11px] text-gray-400 mt-0.5">更新/建立：${timeDisplay}</div>
                <div class="route-lib-stats flex items-center gap-3 text-[11px] font-bold mt-1">
                    <span class="route-lib-stat-dist text-blue-600"><i class="fa-solid fa-route mr-1"></i>${cr.distance || '0.00'} km</span>
                    <span class="route-lib-stat-events text-green-600"><i class="fa-solid fa-music mr-1"></i>${eventsCount} 處標記</span>
                    ${stopsCount > 0 ? `<span class="route-lib-stat-stops text-indigo-600"><i class="fa-regular fa-clock mr-1"></i>${stopsCount} 站牌</span>` : ''}
                </div>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
                <button type="button" class="single-cloud-import-btn px-3 py-2 rounded-xl text-xs font-extrabold transition-all active:scale-95 ${
                    alreadyLocal
                        ? 'bg-gray-100 text-gray-400 border border-gray-200'
                        : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                }">
                    ${alreadyLocal ? '✅ 已是最新' : '⬇️ 匯入/更新'}
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

function cloneCloudRouteForLocal(cr, existingLocal = null) {
    const rawName = String(cr.name || existingLocal?.name || '未命名路線').trim();
    const cleanName = rawName.replace(/\s+[vV]\d+(\.\d+)?$/i, '').trim() || rawName;
    return {
        routeId: cr.routeId || existingLocal?.routeId || generateRouteId(),
        id: existingLocal?.id || cr.id || (Date.now() + Math.floor(Math.random() * 1000)),
        originId: existingLocal?.originId || existingLocal?.id || cr.originId || cr.id || Date.now(),
        name: cleanName,
        author: cr.author || existingLocal?.author || '熱心隊員',
        routeVersion: getRouteVersion(cr),
        updatedAt: getRouteUpdatedAt(cr),
        date: cr.date || cr.uploadedAtText || existingLocal?.date || new Date().toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        uploadedAt: cr.uploadedAt || existingLocal?.uploadedAt || '',
        uploadedAtText: cr.uploadedAtText || existingLocal?.uploadedAtText || '',
        distance: cr.distance || existingLocal?.distance || '0.00',
        timeStr: cr.timeStr || existingLocal?.timeStr || '0m 0s',
        points: JSON.parse(JSON.stringify(cr.points || [])),
        events: JSON.parse(JSON.stringify(cr.events || [])),
        callouts: JSON.parse(JSON.stringify(cr.callouts || []))
    };
}

// 原地覆蓋（In-Place Overwrite）：先以「原路線 id / routeId」或「相同的路線名稱（name.trim()）」比對本機清單
// 若已存在則直接 savedRoutes[index] = updatedRoute 原地替換（保留原本排序位置與本機 id），嚴禁重複新增；僅在完全找不到同名／同 ID 路線時才新增
function upsertLocalRouteFromCloud(cr, preferredLocalIdx = -1) {
    const matchingIndices = [];
    for (let i = 0; i < savedRoutes.length; i++) {
        const local = savedRoutes[i];
        if (!local || local.isPendingPreview) continue;
        if (isSameRouteIdentity(local, cr)) {
            matchingIndices.push(i);
        }
    }

    let targetIdx = -1;
    if (matchingIndices.length > 0) {
        // 優先保留最早出現的原始排序位置（若有多筆歷史殘留重複，以第一筆位置為準並清除後續重複項）
        targetIdx = matchingIndices[0];
    } else if (preferredLocalIdx >= 0 && preferredLocalIdx < savedRoutes.length && !savedRoutes[preferredLocalIdx]?.isPendingPreview) {
        targetIdx = preferredLocalIdx;
    }

    let savedItem;
    if (targetIdx !== -1) {
        const existingLocal = savedRoutes[targetIdx];
        savedItem = cloneCloudRouteForLocal(cr, existingLocal);
        savedRoutes[targetIdx] = savedItem;

        // 若本機清單曾有其餘同名/同 ID 的重複殘留項，一併從後往前移除
        for (let k = matchingIndices.length - 1; k >= 0; k--) {
            const dupIdx = matchingIndices[k];
            if (dupIdx !== targetIdx) {
                savedRoutes.splice(dupIdx, 1);
            }
        }
    } else {
        savedItem = cloneCloudRouteForLocal(cr, null);
        savedRoutes.unshift(savedItem);
    }

    deduplicateSavedRoutes(false);
    return savedItem;
}

function importSingleCloudRoute(cloudIdx) {
    const cr = cachedCloudRoutes[cloudIdx];
    if (!cr) return;

    if (isRouteAlreadyInLocal(cr)) {
        alert(`ℹ️ 路線【${cr.name}】已是最新版本並存在於本機路線庫中，無須重複匯入！`);
        renderCloudRoutesList();
        return;
    }

    const hadExisting = savedRoutes.some(local => !local?.isPendingPreview && isSameRouteIdentity(local, cr));
    const newRoute = upsertLocalRouteFromCloud(cr);
    persistSavedRoutesToStorage().then(() => {
        syncRouteUpdateBadgesAndAllBar(false);
        renderHistoryList();
        renderCloudRoutesList();
        alert(`✅ 成功${hadExisting ? '原地覆蓋更新' : '下載匯入'}【${newRoute.author}】分享的路線：${newRoute.name} (v${newRoute.routeVersion})`);
    });
}

importAllCloudBtn.onclick = () => {
    if (!cachedCloudRoutes || cachedCloudRoutes.length === 0) return;

    let addedCount = 0;
    let skippedCount = 0;

    // 由舊到新依序處理，已存在者原地覆蓋、全新路線維持最新在最上方
    [...cachedCloudRoutes].reverse().forEach(cr => {
        if (isRouteAlreadyInLocal(cr)) {
            skippedCount++;
        } else {
            upsertLocalRouteFromCloud(cr);
            addedCount++;
        }
    });

    if (addedCount === 0) {
        alert(`ℹ️ 雲端共 ${skippedCount} 條路線皆已存在於本機且為最新版，無須重複匯入！`);
        renderCloudRoutesList();
        return;
    }

    persistSavedRoutesToStorage().then(() => {
        syncRouteUpdateBadgesAndAllBar(false);
        renderHistoryList();
        renderCloudRoutesList();
        alert(`✅ 一鍵匯入/更新完成！\n成功新增或原地覆蓋 ${addedCount} 條路線${skippedCount > 0 ? `（已自動略過 ${skippedCount} 條已是最新版的路線）` : ''}。`);
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
// 🚛 9. 全自動車隊支援定位雷達（全模式通用）＋ 👥 三層權限與人員門禁管理系統
// ==========================================
const LIVE_FLEET_BASE_URL = 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app/live_fleet';
const LIVE_FLEET_ALL_URL = `${LIVE_FLEET_BASE_URL}.json`;
// 使用 Firebase RTDB 已開放讀寫權限的 /system_config/users 作為正式使用者權限節點（並同步寫入 live_fleet/{uid} 確保多端點一致）
const FLEET_USERS_BASE_URL = 'https://route-warehouse-default-rtdb.asia-southeast1.firebasedatabase.app/system_config/users';
const FLEET_USERS_ALL_URL = `${FLEET_USERS_BASE_URL}.json`;
const SYSTEM_CONFIG_URL = `${FIREBASE_BASE_URL}/system_config.json`;
const DEFAULT_RADAR_INTERVAL_SEC = 5;

let currentRadarIntervalSec = DEFAULT_RADAR_INTERVAL_SEC;
let selectedAdminInterval = DEFAULT_RADAR_INTERVAL_SEC;
let lastKnownCloudInterval = DEFAULT_RADAR_INTERVAL_SEC;

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

// 🔐 Device ID 自動辨識權限架構（移除管理員密碼，僅保留開發者模式密碼）：
// 1. 一般使用者（canManageRoute !== true 且 canEditCommunity !== true）：唯讀瀏覽地圖、搜尋、播放與導航
// 2. 社區標註員（canEditCommunity === true 且 canManageRoute !== true）：僅解鎖社區大樓新增、修改、刪除權限
// 3. 路線管理員（canManageRoute === true）：解鎖路線審核、修改、刪除權限，並同時具備社區大樓新增、修改、刪除權限
// 4. 開發者模式（輸入開發者密碼 localUserPermissionRole === 'developer'）：全站最高權限
let localUserPermissionRole = localStorage.getItem('yingge_user_permission_role') || 'normal';
if (localUserPermissionRole !== 'developer') {
    localUserPermissionRole = 'normal';
}
let myCloudUserProfile = null;
let allCloudFleetUsersMap = {};

function isCurrentDeviceBlocked() {
    if (localUserPermissionRole === 'developer') return false;
    if (!myCloudUserProfile) return false;
    // 當開發者將「准許使用／封鎖」開關切為關閉時，blocked 會設為 true（同時 approved 設為 false），立即鎖定畫面
    if (myCloudUserProfile.blocked === true || myCloudUserProfile.isBlocked === true) {
        return true;
    }
    return false;
}

function isCurrentDevicePendingApproval() {
    if (localUserPermissionRole === 'developer') return false;
    const gateRequired = Boolean(systemNavConfig.requireApproval || systemNavConfig.requireUserApproval);
    if (!gateRequired) return false;
    if (!myCloudUserProfile) return true;
    const approvedVal = (myCloudUserProfile.approved !== undefined) ? myCloudUserProfile.approved : myCloudUserProfile.isApproved;
    return approvedVal !== true;
}

function isDeviceRestrictedByGatekeeper() {
    return isCurrentDeviceBlocked() || isCurrentDevicePendingApproval();
}

// 🛡️ 路線管理權限判斷：開發者模式 或 雲端 canManageRoute === true（免密碼自動解鎖路線審核、修改、刪除）
function canCurrentUserManageRoutes() {
    if (localUserPermissionRole === 'developer') {
        return true;
    }
    if (isDeviceRestrictedByGatekeeper()) {
        return false;
    }
    return Boolean(myCloudUserProfile && myCloudUserProfile.canManageRoute === true);
}

// 🏢 社區大樓標註權限判斷：開發者模式 或 路線管理員(canManageRoute === true) 或 社區標註員(canEditCommunity === true)
function canCurrentUserManageBuildings() {
    if (localUserPermissionRole === 'developer') {
        return true;
    }
    if (isDeviceRestrictedByGatekeeper()) {
        return false;
    }
    if (
        myCloudUserProfile &&
        (myCloudUserProfile.canManageRoute === true ||
         myCloudUserProfile.canEditCommunity === true ||
         myCloudUserProfile.canManageBuildings === true)
    ) {
        return true;
    }
    return false;
}

// 即時同步路線管理與社區標註相關 UI 按鈕顯示／隱藏狀態（當雲端權限開啟或收回時立即生效）
function syncRoutePermissionControlsUI() {
    const hasRouteAuth = canCurrentUserManageRoutes();
    isAdminUnlocked = hasRouteAuth;

    const editBtnEl = document.getElementById('editRouteBtn');
    const delBtnEl = document.getElementById('deleteRouteBtn');
    if (editBtnEl) {
        editBtnEl.classList.toggle('hidden', !hasRouteAuth);
    }
    if (delBtnEl) {
        delBtnEl.classList.toggle('hidden', !hasRouteAuth);
    }

    // 若原本正在路線編輯模式或正在審核待審路線，但路線管理權限被即時收回，立即退出編輯／審核
    if (!hasRouteAuth) {
        if (typeof isEditingRoute !== 'undefined' && isEditingRoute && typeof exitEditRouteMode === 'function') {
            exitEditRouteMode();
        }
        if (typeof currentReviewingPendingRoute !== 'undefined' && currentReviewingPendingRoute && typeof closePendingReviewMode === 'function') {
            closePendingReviewMode();
        }
    }

    if (typeof setAdminModeUI === 'function') {
        setAdminModeUI(hasRouteAuth);
    }

    const historyModalEl = document.getElementById('historyModal');
    if (historyModalEl && !historyModalEl.classList.contains('hidden') && typeof renderHistoryList === 'function') {
        renderHistoryList(document.getElementById('searchInput')?.value || '');
    }

    const cloudModalEl = document.getElementById('cloudRoutesModal');
    if (cloudModalEl && !cloudModalEl.classList.contains('hidden')) {
        if (!hasRouteAuth && currentCloudModalTab === 'pending') {
            currentCloudModalTab = 'shared';
        }
        if (typeof renderCloudRoutesList === 'function') {
            renderCloudRoutesList();
        }
    }

    if (typeof activeViewingMapPin !== 'undefined' && activeViewingMapPin && typeof openViewMapPinModal === 'function') {
        const viewModalEl = document.getElementById('viewMapPinModal');
        if (viewModalEl && !viewModalEl.classList.contains('hidden')) {
            openViewMapPinModal(activeViewingMapPin);
        }
    }
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

// 同步本機使用者資料至 Firebase system_config/users/{deviceId}（嚴格使用 PATCH 只更新 displayName 與 lastSeen/lastActiveAt，絕不覆蓋開發者設定的 canManageRoute、canEditCommunity、realName/originalName 或權限欄位）
async function syncMyFleetUserRecordToCloud(options = {}) {
    if (!fleetDeviceId || !navigator.onLine) return null;
    const cleanDisplayName = (options.displayName !== undefined ? String(options.displayName) : fleetUserName).trim();
    if (!cleanDisplayName) return null;

    const now = Date.now();
    try {
        // 先讀取雲端是否已有此裝置紀錄
        const getRes = await fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, { cache: 'no-store' }, 4500);
        const existing = getRes.ok ? await getRes.json() : null;

        let patchPayload;
        if (existing && typeof existing === 'object') {
            patchPayload = {
                displayName: cleanDisplayName,
                lastSeen: now,
                lastActiveAt: now
            };
            const existingApproved = (existing.approved !== undefined) ? existing.approved : existing.isApproved;
            if (options.requestApproval === true && existingApproved !== true) {
                patchPayload.requestedAt = now;
            }
        } else {
            // 新裝置首次建立紀錄：若全站門禁開啟且非開發者，預設 approved: false（待核准）；否則預設 approved: true
            const gateRequired = Boolean(systemNavConfig.requireApproval || systemNavConfig.requireUserApproval);
            const defaultApproved = (localUserPermissionRole === 'developer') || !gateRequired;
            patchPayload = {
                displayName: cleanDisplayName,
                realName: '',
                originalName: '',
                approved: defaultApproved,
                isApproved: defaultApproved,
                blocked: false,
                isBlocked: false,
                canManageRoute: false,
                canEditCommunity: false,
                canManageBuildings: false,
                createdAt: now,
                lastSeen: now,
                lastActiveAt: now,
                updatedAt: now
            };
        }

        const writeRes = await fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchPayload)
        }, 4500);
        if (!writeRes.ok) {
            throw new Error(`HTTP ${writeRes.status}`);
        }

        myCloudUserProfile = {
            ...(existing && typeof existing === 'object' ? existing : {}),
            ...patchPayload
        };
        syncAdminCurrentRoleBadgeUI();
        syncRoutePermissionControlsUI();
        if (typeof evaluateAndRenderAccessGateOverlay === 'function') {
            evaluateAndRenderAccessGateOverlay();
        }
        return myCloudUserProfile;
    } catch (e) {
        return myCloudUserProfile;
    }
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

    // 同步更新雲端使用者的 displayName（絕不影響開發者標註的 realName/originalName、canManageRoute 或 canEditCommunity）
    syncMyFleetUserRecordToCloud({ displayName: fleetUserName, requestApproval: true }).then(() => {
        if (isDeviceRestrictedByGatekeeper()) {
            if (typeof evaluateAndRenderAccessGateOverlay === 'function') {
                evaluateAndRenderAccessGateOverlay();
            }
            return;
        }
        showWelcomeProfileModal(fleetUserName);
        startFleetRadarSystem();
        if (currentFleetLat !== null && currentFleetLng !== null) {
            uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
        }
    });
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

let pendingForcedFleetUpload = null;

async function uploadMyFleetLocation(lat, lng, forceUpload = false) {
    if (!fleetUserName || typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    if (!navigator.onLine) return;
    // 若此裝置已被封鎖或處於門禁待核准狀態，立即停止同步與車隊雷達廣播
    if (isDeviceRestrictedByGatekeeper()) return;
    if (isUploadingFleetLocation) {
        if (forceUpload) {
            pendingForcedFleetUpload = { lat, lng };
        }
        return;
    }

    const now = Date.now();
    const minUploadIntervalMs = (typeof currentRadarIntervalSec === 'number' && currentRadarIntervalSec > 0 ? currentRadarIntervalSec : 5) * 1000;
    if (!forceUpload && lastUploadedFleetLat !== null && lastUploadedFleetLng !== null) {
        if (now - lastFleetUploadTime < minUploadIntervalMs) return; // 依雲端設定秒數頻率上傳
        const distMeters = getDistanceKm(lastUploadedFleetLng, lastUploadedFleetLat, lng, lat) * 1000;
        // 若原地等待紅燈或定點清運超過 15 秒且手機處於前景接收 GPS，允許更新一次 updatedAt 保持在線狀態
        if (distMeters <= 5 && (now - lastFleetUploadTime < 15000)) return;
    }

    const prevLat = lastUploadedFleetLat;
    const prevLng = lastUploadedFleetLng;
    lastUploadedFleetLat = lat;
    lastUploadedFleetLng = lng;
    lastFleetUploadTime = now;
    isUploadingFleetLocation = true;

    const currentSpeedRounded = Math.round(Math.max(0, lastRecordedSpeedKmh || 0));
    const payload = {
        name: fleetUserName,
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        speedKmh: currentSpeedRounded,
        speed: currentSpeedRounded,
        carType: (typeof getMyCarType === 'function') ? getMyCarType() : 'garbage_yellow',
        ...(myCloudUserProfile && myCloudUserProfile.hiddenFromRadar !== undefined
            ? { hiddenFromRadar: Boolean(myCloudUserProfile.hiddenFromRadar) }
            : {}),
        updatedAt: now
    };

    try {
        // 重要：使用 PATCH 而非 PUT，避免覆蓋 live_fleet/{deviceId} 上的 canManageRoute / canEditCommunity / realName 等擴充屬性
        await fetchWithTimeout(`${LIVE_FLEET_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true
        }, 5000);
        // 順便每 25 秒更新一次 system_config/users 的 lastSeen/lastActiveAt 與 displayName（僅局部更新，絕不覆蓋權限欄位）
        if (!myCloudUserProfile || (now - Number(myCloudUserProfile.lastSeen || myCloudUserProfile.lastActiveAt || 0) >= 25000)) {
            fetchWithTimeout(`${FLEET_USERS_BASE_URL}/${encodeURIComponent(fleetDeviceId)}.json`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    displayName: fleetUserName,
                    lastSeen: now,
                    lastActiveAt: now
                }),
                keepalive: true
            }, 4000).catch(() => {});
            if (myCloudUserProfile) {
                myCloudUserProfile.lastSeen = now;
                myCloudUserProfile.lastActiveAt = now;
            }
        }
    } catch (err) {
        // 巷弄斷網或超時靜默略過，還原座標基準以便下一週期自動恢復補傳
        lastUploadedFleetLat = prevLat;
        lastUploadedFleetLng = prevLng;
    } finally {
        isUploadingFleetLocation = false;
        if (pendingForcedFleetUpload) {
            const nextUpload = pendingForcedFleetUpload;
            pendingForcedFleetUpload = null;
            uploadMyFleetLocation(nextUpload.lat, nextUpload.lng, true);
        }
    }
}

window.onFleetPositionUpdate = function(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    currentFleetLat = lat;
    currentFleetLng = lng;
    if (fleetUserName && !isDeviceRestrictedByGatekeeper()) {
        uploadMyFleetLocation(lat, lng, false);
    }
};

window.broadcastRadarNow = function() {
    if (!fleetUserName || isDeviceRestrictedByGatekeeper()) return;
    const lat = (typeof currentFleetLat === 'number' && !isNaN(currentFleetLat))
        ? currentFleetLat
        : (Array.isArray(lastKnownLngLat) ? Number(lastKnownLngLat[1]) : null);
    const lng = (typeof currentFleetLng === 'number' && !isNaN(currentFleetLng))
        ? currentFleetLng
        : (Array.isArray(lastKnownLngLat) ? Number(lastKnownLngLat[0]) : null);
    if (typeof lat === 'number' && !isNaN(lat) && typeof lng === 'number' && !isNaN(lng)) {
        uploadMyFleetLocation(lat, lng, true);
    }
};

// ==========================================
// 🟢 左上角「車隊雷達在線名單」即時清單（支援超過 3 人自動收折＋點擊快速 flyTo 追蹤隊友＋超過 30 秒休眠提示）
// ==========================================
let onlineFleetMembersList = [];
let isOnlineFleetListExpanded = false;
const FLEET_STALE_SLEEP_THRESHOLD_MS = 30 * 1000; // 超過 30 秒未更新視為手機休眠／過期座標
const FLEET_MAX_RETENTION_MS = 15 * 60 * 1000;    // 保留 15 分鐘內的隊員位置以顯示（X分前・休眠）防誤判

function getFleetStaleStatus(updatedAt, now = Date.now()) {
    const elapsedMs = Math.max(0, now - Number(updatedAt || 0));
    const isOver30s = elapsedMs > FLEET_STALE_SLEEP_THRESHOLD_MS;
    const rawStaleMinutes = isOver30s ? Math.max(1, Math.floor(elapsedMs / 60000)) : 0;

    // 開發者模式設定：休眠提示開關（預設開啟）與超過設定分鐘數自動屏蔽（預設 3 分鐘，設為 0 代表不屏蔽）
    const showSleepEnabled = systemNavConfig.showFleetSleepStatus !== false;
    const rawMaxMin = Number(systemNavConfig.fleetSleepMaxMinutes);
    const maxMinutes = isNaN(rawMaxMin) ? DEFAULT_SYSTEM_CONFIG.fleetSleepMaxMinutes : Math.max(0, rawMaxMin);
    const isExceededMaxMinutes = maxMinutes > 0 && elapsedMs > (maxMinutes * 60 * 1000);

    // 僅當「休眠提示開關為開啟」且「超過 30 秒」且「未超過設定上限分鐘數」時，才顯示（X分前・休眠）與半透明休眠樣式
    const isStale = Boolean(showSleepEnabled && isOver30s && !isExceededMaxMinutes);
    const staleMinutes = isStale ? rawStaleMinutes : 0;
    const staleText = isStale ? `（${staleMinutes}分前・休眠）` : '';

    return { isStale, isOver30s, isExceededMaxMinutes, staleMinutes, staleText, elapsedMs };
}

function updateFleetTruckMarkerAppearance(el, memberName, updatedAt, now = Date.now(), peerCarType = null, peerIsMoving = false) {
    if (!el) return;
    const cleanName = (memberName || '隊員').trim();
    const { isStale, staleText } = getFleetStaleStatus(updatedAt, now);
    const nameSpan = el.querySelector('.fleet-member-name');
    if (nameSpan) {
        nameSpan.textContent = isStale ? `${cleanName}${staleText}` : cleanName;
    }
    if (isStale) {
        el.classList.add('is-stale-sleeping');
    } else {
        el.classList.remove('is-stale-sleeping');
    }

    const carWrap = el.querySelector('.fleet-car-svg-wrap');
    if (carWrap && typeof getCarSvg === 'function') {
        const effectiveCarType = (peerCarType && window.CAR_MODELS && window.CAR_MODELS[peerCarType])
            ? peerCarType
            : (el.dataset.carType || 'garbage_yellow');
        const effectiveMoving = !isStale && Boolean(peerIsMoving) && !document.body.classList.contains('power-saving');
        if (el.dataset.carType !== effectiveCarType || !carWrap.firstElementChild) {
            el.dataset.carType = effectiveCarType;
            carWrap.innerHTML = getCarSvg(effectiveCarType, effectiveMoving);
            const stageEl = carWrap.querySelector('.vehicle-puck-stage');
            if (stageEl) {
                stageEl.style.width = '48px';
                stageEl.style.height = '48px';
            }
            const rotatorEl = carWrap.querySelector('.vehicle-heading-rotator');
            if (rotatorEl) {
                rotatorEl.style.width = '48px';
                rotatorEl.style.height = '48px';
                rotatorEl.style.transform = 'rotate(0deg)';
            }
            const svgEl = carWrap.querySelector('svg');
            if (svgEl) {
                svgEl.style.width = '48px';
                svgEl.style.height = '48px';
                svgEl.style.display = 'block';
            }
            const imgEl = carWrap.querySelector('img');
            if (imgEl) {
                imgEl.style.width = '48px';
                imgEl.style.height = '48px';
                imgEl.style.maxWidth = '48px';
                imgEl.style.maxHeight = '48px';
                imgEl.style.objectFit = 'contain';
                imgEl.style.display = 'block';
            }
        } else {
            const animEls = carWrap.querySelectorAll('.vehicle-anim, .vehicle-img-wrap');
            animEls.forEach((animEl) => {
                animEl.classList.toggle('is-moving', effectiveMoving);
            });
        }
        carWrap.querySelectorAll('.turtle-anim-el').forEach((anim) => {
            try {
                if (effectiveMoving) anim.beginElement();
                else anim.endElement();
            } catch (_) {}
        });
    }
}

function renderOnlineFleetListUI() {
    const container = document.getElementById('onlineFleetListContainer');
    if (!container) return;

    // 若管理員關閉「顯示左上角車隊在線名單」或目前無其他同事在線，自動隱藏不佔空間
    if (!systemNavConfig.showOnlineFleetList || !Array.isArray(onlineFleetMembersList) || onlineFleetMembersList.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = '';

    const now = Date.now();
    const totalOnline = onlineFleetMembersList.length;
    const maxVisible = 3;
    const shouldCollapse = totalOnline > maxVisible && !isOnlineFleetListExpanded;
    const visibleMembers = shouldCollapse
        ? onlineFleetMembersList.slice(0, maxVisible)
        : onlineFleetMembersList;

    visibleMembers.forEach(member => {
        const { isStale, staleText } = getFleetStaleStatus(member.updatedAt, now);
        const pillBtn = document.createElement('button');
        pillBtn.type = 'button';
        pillBtn.className = isStale
            ? 'bg-slate-100/90 hover:bg-slate-200/90 backdrop-blur px-3 py-1.5 rounded-xl shadow-sm text-xs font-extrabold text-slate-500 border border-slate-300 flex items-center gap-1.5 active:scale-95 transition-all whitespace-nowrap opacity-75'
            : 'bg-white/95 hover:bg-emerald-50 backdrop-blur px-3 py-1.5 rounded-xl shadow-md text-xs font-extrabold text-gray-800 border border-emerald-200 flex items-center gap-1.5 active:scale-95 transition-all whitespace-nowrap';
        pillBtn.title = isStale
            ? `${member.name} 目前可能鎖屏休眠，點擊查看最後回報位置`
            : `點擊追蹤 ${member.name} 的即時位置`;

        const dotSpan = document.createElement('span');
        dotSpan.textContent = isStale ? '⚪' : '🟢';
        dotSpan.className = 'text-[10px] leading-none';

        const textSpan = document.createElement('span');
        textSpan.textContent = isStale
            ? `${member.name}${staleText}`
            : `${member.name} · ${member.speedKmh} km/h`;

        pillBtn.appendChild(dotSpan);
        pillBtn.appendChild(textSpan);

        pillBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 暫時解除自己的車頭鎖定（按右側「置中」按鈕即可切回自己）
            setCameraFollow(false);
            map.flyTo({
                center: [member.lng, member.lat],
                zoom: Math.max(map.getZoom(), 16.5),
                duration: 900
            });
        });

        container.appendChild(pillBtn);
    });

    if (totalOnline > maxVisible) {
        const hiddenCount = totalOnline - maxVisible;
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'bg-white/90 hover:bg-amber-50 backdrop-blur px-3 py-1 rounded-xl shadow-md text-[11px] font-black text-emerald-700 border border-emerald-200 flex items-center gap-1 active:scale-95 transition-all whitespace-nowrap';
        toggleBtn.textContent = isOnlineFleetListExpanded
            ? `收合在線名單 ▴`
            : `+ 還有 ${hiddenCount} 位在線 ▾`;

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isOnlineFleetListExpanded = !isOnlineFleetListExpanded;
            renderOnlineFleetListUI();
        });

        container.appendChild(toggleBtn);
    }
}

function createFleetTruckMarkerElement(memberName, updatedAt = Date.now(), peerCarType = 'garbage_yellow', peerIsMoving = false) {
    const wrapper = document.createElement('div');
    wrapper.className = 'fleet-truck-marker flex flex-col items-center pointer-events-none select-none';
    wrapper.style.filter = 'drop-shadow(0 3px 6px rgba(0,0,0,0.38))';
    wrapper.innerHTML = `
        <div class="fleet-truck-pill bg-emerald-600 text-white px-2.5 py-0.5 rounded-full border-2 border-white font-black text-[11px] flex items-center gap-1 whitespace-nowrap shadow-md mb-1">
            <span class="fleet-member-name"></span>
        </div>
        <div class="fleet-car-svg-wrap w-12 h-12 flex items-center justify-center"></div>
    `;
    updateFleetTruckMarkerAppearance(wrapper, memberName, updatedAt, Date.now(), peerCarType, peerIsMoving);
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
        const nextOnlineMembers = [];

        if (data && typeof data === 'object') {
            Object.entries(data).forEach(([devId, info]) => {
                if (!info || devId === fleetDeviceId) return; // 排除自己
                // 👻 雷達隱身過濾：hiddenFromRadar === true 者對所有其他使用者完全不可見（不顯示車標、不列在線名單、不計入在線人數）
                if (info.hiddenFromRadar === true || (typeof allCloudFleetUsersMap === 'object' && allCloudFleetUsersMap && allCloudFleetUsersMap[devId]?.hiddenFromRadar === true)) {
                    return;
                }
                const lat = Number(info.lat);
                const lng = Number(info.lng);
                const updatedAt = typeof info.updatedAt === 'number'
                    ? info.updatedAt
                    : new Date(info.updatedAt || 0).getTime();

                if (isNaN(lat) || isNaN(lng) || !updatedAt) return;
                // 保留 15 分鐘內有紀錄的友車：30 秒內顯示鮮明即時色彩，超過 30 秒自動轉為半透明灰階並標註（X分前・休眠）
                if (now - updatedAt > FLEET_MAX_RETENTION_MS) return;

                activeIds.add(devId);
                const memberName = (info.name || '隊員').trim();
                const isStaleMember = (now - updatedAt) > FLEET_STALE_SLEEP_THRESHOLD_MS;

                // 計算同事即時時速 (km/h)：優先採用雲端回報之 speedKmh / speed，若超過 30 秒休眠則歸零
                let memberSpeedKmh = 0;
                const existingEntry = fleetLayerGroup[devId];
                const rawCloudSpeed = (typeof info.speedKmh === 'number' && !isNaN(info.speedKmh))
                    ? info.speedKmh
                    : ((typeof info.speed === 'number' && !isNaN(info.speed)) ? info.speed : null);
                if (isStaleMember) {
                    memberSpeedKmh = 0;
                } else if (rawCloudSpeed !== null && rawCloudSpeed >= 0) {
                    memberSpeedKmh = Math.round(rawCloudSpeed);
                } else if (existingEntry && existingEntry.lastLat !== undefined && existingEntry.lastUpdatedAt && updatedAt > existingEntry.lastUpdatedAt) {
                    const distKm = getDistanceKm(existingEntry.lastLng, existingEntry.lastLat, lng, lat);
                    const dtSec = Math.max(1, (updatedAt - existingEntry.lastUpdatedAt) / 1000);
                    const implied = (distKm / dtSec) * 3600;
                    const maxSpd = Number(systemNavConfig.maxSpeedKmh) || 160;
                    memberSpeedKmh = (distKm * 1000 < 5 || implied < 2) ? 0 : Math.round(Math.min(implied, maxSpd));
                } else if (existingEntry && typeof existingEntry.speedKmh === 'number' && (now - updatedAt <= 20000)) {
                    memberSpeedKmh = existingEntry.speedKmh;
                }

                const peerCarType = (info.carType && window.CAR_MODELS && window.CAR_MODELS[info.carType])
                    ? info.carType
                    : 'garbage_yellow';
                const peerIsMoving = !isStaleMember && memberSpeedKmh > 1.8;

                if (existingEntry) {
                    existingEntry.marker.setLngLat([lng, lat]);
                    existingEntry.name = memberName;
                    existingEntry.lastLat = lat;
                    existingEntry.lastLng = lng;
                    existingEntry.lastUpdatedAt = updatedAt;
                    existingEntry.speedKmh = memberSpeedKmh;
                    existingEntry.carType = peerCarType;
                    updateFleetTruckMarkerAppearance(existingEntry.el, memberName, updatedAt, now, peerCarType, peerIsMoving);
                } else {
                    const el = createFleetTruckMarkerElement(memberName, updatedAt, peerCarType, peerIsMoving);
                    const marker = new maplibregl.Marker({
                        element: el,
                        anchor: 'bottom',
                        rotationAlignment: 'viewport',
                        pitchAlignment: 'viewport'
                    })
                        .setLngLat([lng, lat])
                        .addTo(map);
                    fleetLayerGroup[devId] = {
                        marker,
                        el,
                        name: memberName,
                        lastLat: lat,
                        lastLng: lng,
                        lastUpdatedAt: updatedAt,
                        speedKmh: memberSpeedKmh,
                        carType: peerCarType
                    };
                }

                nextOnlineMembers.push({
                    devId,
                    name: memberName,
                    lat,
                    lng,
                    speedKmh: memberSpeedKmh,
                    updatedAt,
                    isStale: isStaleMember
                });
            });
        }

        // 移除超過 15 分鐘未更新或已離線的友車標記
        Object.keys(fleetLayerGroup).forEach(devId => {
            if (!activeIds.has(devId)) {
                fleetLayerGroup[devId].marker.remove();
                delete fleetLayerGroup[devId];
            }
        });

        // 排序：30 秒內活躍隊員優先排前，休眠隊員排後，同狀態依名稱排序
        nextOnlineMembers.sort((a, b) => {
            if (a.isStale !== b.isStale) return a.isStale ? 1 : -1;
            return a.name.localeCompare(b.name, 'zh-Hant');
        });
        onlineFleetMembersList = nextOnlineMembers;
        renderOnlineFleetListUI();
    } catch (err) {
        // 巷弄斷網或 5 秒逾時靜默略過，不干擾導航，同時以本地時間即時刷新既有標記的休眠狀態
        const now = Date.now();
        Object.values(fleetLayerGroup).forEach(entry => {
            if (entry && entry.el && entry.lastUpdatedAt) {
                updateFleetTruckMarkerAppearance(entry.el, entry.name, entry.lastUpdatedAt, now);
            }
        });
        renderOnlineFleetListUI();
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
// 避免司機切換至 LINE 或講電話時在地圖上瞬間消失
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

// ==========================================
// 📍 共享地圖地標核心狀態變數（提前宣告以避免 startFleetRadarSystem 啟動時觸發 TDZ ReferenceError）
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
let activeDistanceGuidePin = null;
let pinDistanceGuideTimer = null;
let pinDistanceLineMarker = null;

function startFleetRadarGpsWatch() {
    if (!('geolocation' in navigator) || !fleetUserName) return;
    if (fleetRadarWatchId !== null) {
        navigator.geolocation.clearWatch(fleetRadarWatchId);
        fleetRadarWatchId = null;
    }
    fleetRadarWatchId = navigator.geolocation.watchPosition(pos => {
        markGpsUpdateReceived();
        const filtered = processFilteredGpsPosition(pos);
        if (!filtered) return;
        window.onFleetPositionUpdate(filtered.lat, filtered.lng);
    }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
}

// ==========================================
// 🍎 iOS 螢幕解鎖／切回前景「強制重啟 GPS 定位」＋「12 秒前景定位看門狗（Watchdog）」
// ==========================================
function forceRestartGpsAndPushLatestLocation(triggerReason = 'wakeup') {
    if (!('geolocation' in navigator)) return;
    const now = Date.now();
    // 防止 visibilitychange / pageshow / focus 於同一瞬間重複觸發取消剛建立的請求
    if (triggerReason !== 'watchdog' && (now - lastGpsForceRestartAt < 600)) {
        return;
    }
    lastGpsForceRestartAt = now;

    // 1. 立即呼叫 clearWatch() 清除所有可能已在 iOS 背景休眠假死的舊監聽器
    if (idleWatchId !== null) {
        navigator.geolocation.clearWatch(idleWatchId);
        idleWatchId = null;
    }
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    if (followWatchId !== null) {
        navigator.geolocation.clearWatch(followWatchId);
        followWatchId = null;
    }
    if (fleetRadarWatchId !== null) {
        navigator.geolocation.clearWatch(fleetRadarWatchId);
        fleetRadarWatchId = null;
    }

    // 2. 立刻重新啟動新的 watchPosition（強制設定 enableHighAccuracy: true, maximumAge: 0, timeout: 15000，不使用舊快取座標）
    if (isRecording && typeof activeRecordingGpsHandler === 'function') {
        watchId = navigator.geolocation.watchPosition(
            activeRecordingGpsHandler,
            () => {},
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
    } else if (typeof activeFollowGpsHandler === 'function') {
        followWatchId = navigator.geolocation.watchPosition(
            activeFollowGpsHandler,
            () => {},
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
    } else {
        startIdleGPS();
    }

    if (fleetRadarStarted && fleetUserName) {
        startFleetRadarGpsWatch();
    }

    // 3. 秒抓最新位置推上 Firebase：單次呼叫 getCurrentPosition 取得最新硬體座標，立即更新地圖車標並寫入 Firebase 車隊即時位置節點
    navigator.geolocation.getCurrentPosition(pos => {
        markGpsUpdateReceived();
        if (!pos || !pos.coords) return;
        const filtered = processFilteredGpsPosition(pos, { forceBaselineReset: true });
        const rawLat = Number(pos.coords.latitude);
        const rawLng = Number(pos.coords.longitude);
        if (isNaN(rawLat) || isNaN(rawLng)) return;

        const latestLat = filtered ? filtered.lat : rawLat;
        const latestLng = filtered ? filtered.lng : rawLng;
        const latestHeading = filtered ? filtered.heading : lastRealGpsHeading;
        const latestAcc = Math.round(
            filtered
                ? filtered.accuracy
                : (typeof pos.coords.accuracy === 'number' && !isNaN(pos.coords.accuracy) ? pos.coords.accuracy : 10)
        );

        if (!isReplaying) {
            lastKnownLngLat = [latestLng, latestLat];
            currentHeading = latestHeading;
            if (!isPowerSaveMapPaused()) {
                const accEl = document.getElementById('accuracyText');
                if (accEl) accEl.innerText = `± ${latestAcc} m`;
                const recAccEl = document.getElementById('recAccuracyText');
                if (recAccEl) recAccEl.innerText = `± ${latestAcc} m`;

                if (vehicleMarker) {
                    smoothMoveVehicleMarker([latestLng, latestLat], latestHeading, 450);
                }
                if (isFollowingCamera && map) {
                    const targetZoom = getDynamicZoomBySpeed(filtered ? filtered.speedKmh : 0);
                    map.easeTo({
                        center: [latestLng, latestLat],
                        zoom: targetZoom,
                        bearing: isHeadingUpMode ? latestHeading : map.getBearing(),
                        offset: [0, 100],
                        duration: 500
                    });
                }
            }
        }

        // 若正在錄製或導航中，同步將最新座標餵入當前狀態處理器
        if (isRecording && typeof activeRecordingGpsHandler === 'function') {
            activeRecordingGpsHandler(pos);
        } else if (typeof activeFollowGpsHandler === 'function') {
            activeFollowGpsHandler(pos);
        }

        // 立刻更新並強制寫入 Firebase 車隊即時位置節點
        currentFleetLat = latestLat;
        currentFleetLng = latestLng;
        if (fleetUserName) {
            uploadMyFleetLocation(latestLat, latestLng, true);
        }
    }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
}

function startForegroundGpsWatchdog() {
    if (gpsWatchdogTimer !== null) {
        clearInterval(gpsWatchdogTimer);
        gpsWatchdogTimer = null;
    }
    // 每 10 秒檢查一次前景 GPS 是否超過 12 秒未收到新座標
    gpsWatchdogTimer = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        if (!('geolocation' in navigator)) return;
        const isPositioningActive = Boolean(
            idleWatchId !== null ||
            isRecording ||
            watchId !== null ||
            typeof activeFollowGpsHandler === 'function' ||
            followWatchId !== null ||
            fleetRadarStarted ||
            fleetRadarWatchId !== null
        );
        if (!isPositioningActive) return;

        const now = Date.now();
        if (lastGpsUpdateTime === 0 || (now - lastGpsUpdateTime) > 12000) {
            forceRestartGpsAndPushLatestLocation('watchdog');
        }
    }, 10000);
}
startForegroundGpsWatchdog();

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

    // 啟動全模式定位監聽（maximumAge: 0, timeout: 15000）
    startFleetRadarGpsWatch();

    // 啟動瞬間立即單次抓取最新硬體座標並推上 Firebase
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(pos => {
            markGpsUpdateReceived();
            const filtered = processFilteredGpsPosition(pos, { forceBaselineReset: true });
            const lat = filtered ? filtered.lat : Number(pos?.coords?.latitude);
            const lng = filtered ? filtered.lng : Number(pos?.coords?.longitude);
            if (typeof lat === 'number' && !isNaN(lat) && typeof lng === 'number' && !isNaN(lng)) {
                currentFleetLat = lat;
                currentFleetLng = lng;
                uploadMyFleetLocation(lat, lng, true);
            }
        }, () => {
            if (lastKnownLngLat && Array.isArray(lastKnownLngLat) && currentFleetLat !== null) {
                uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
            }
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
    }

    // 靜默讀取 /live_fleet.json 更新友車圖層（依雲端動態秒數，預設 5 秒）
    fetchAndRenderFleetRadar();
    const pollIntervalMs = (typeof currentRadarIntervalSec === 'number' && currentRadarIntervalSec > 0 ? currentRadarIntervalSec : 5) * 1000;
    fleetPollTimer = setInterval(fetchAndRenderFleetRadar, pollIntervalMs);
    if (typeof fetchAndRenderSharedMapPins === 'function') {
        fetchAndRenderSharedMapPins();
    }

    // 前景活躍定點心跳機制：僅當手機處於前景顯示且近期有收到有效 GPS 時，每 15 秒補送一次 updatedAt 保持在線（若鎖屏休眠則停止補送，讓隊友端於 30 秒後正確顯示休眠狀態）
    fleetHeartbeatTimer = setInterval(() => {
        if (!fleetUserName || currentFleetLat === null || currentFleetLng === null) return;
        if (document.visibilityState !== 'visible') return;
        const now = Date.now();
        if (lastGpsUpdateTime > 0 && (now - lastGpsUpdateTime) <= 20000 && (now - lastFleetUploadTime) >= 15000) {
            uploadMyFleetLocation(currentFleetLat, currentFleetLng, true);
        }
    }, 5000);
}

async function handlePageForegroundWakeup(sourceEvent = 'visibilitychange') {
    if (sourceEvent === 'visibilitychange' && document.visibilityState !== 'visible') return;
    if (bgSilentKeepAliveStarted) {
        ensureBackgroundSilentKeepAlive();
    }
    ensurePureBlackSystemBars();

    // 切回前台後延遲 150ms 執行 map.resize() 與 map.triggerRepaint()；若偵測到 webglcontextlost 則自動重建底圖渲染避免白屏
    if (mapWakeupResizeTimer) {
        clearTimeout(mapWakeupResizeTimer);
        mapWakeupResizeTimer = null;
    }
    if (mapWakeupSecondaryTimer) {
        clearTimeout(mapWakeupSecondaryTimer);
        mapWakeupSecondaryTimer = null;
    }
    mapWakeupResizeTimer = setTimeout(() => {
        mapWakeupResizeTimer = null;
        if (document.visibilityState === 'hidden') return;
        if (map) {
            window.scrollTo(0, 0);
            map.resize();
            if (typeof isMapBaseStyleAbnormal === 'function' ? isMapBaseStyleAbnormal() : isMapWebglContextBroken()) {
                rebuildMapStyleAndRestoreAllState(`wakeup-${sourceEvent}`);
            } else {
                restoreCustomLayersAndAlignmentAfterStyleLoad();
                updateMapMarkersZoomScale();
                map.triggerRepaint();
            }
        }
    }, 150);

    // 二次穩定檢查（420ms）：吸收 iOS Safari / Android Chrome 切換 App 時頂部/底部系統列動畫收合延遲；若底圖仍未載入或異常則觸發完整底圖重載
    mapWakeupSecondaryTimer = setTimeout(() => {
        mapWakeupSecondaryTimer = null;
        if (document.visibilityState === 'hidden' || !map) return;
        window.scrollTo(0, 0);
        map.resize();
        if (typeof isMapBaseStyleAbnormal === 'function' && isMapBaseStyleAbnormal()) {
            rebuildMapStyleAndRestoreAllState(`wakeup-late-${sourceEvent}`);
        } else {
            ensureDomMarkersIntactAfterStyleSwitch();
            updateMapMarkersZoomScale();
            map.triggerRepaint();
        }
    }, 420);

    if (isBlackScreenActive || isRecording || followWatchId !== null || typeof activeFollowGpsHandler === 'function') {
        await requestScreenWakeLock();
    }
    // 強制清除舊 watchPosition、重啟新 watchPosition 並立刻以 getCurrentPosition 秒抓最新位置推上 Firebase
    forceRestartGpsAndPushLatestLocation(sourceEvent);
    fetchAndRenderFleetRadar();
    if (typeof fetchAndRenderSharedMapPins === 'function') {
        fetchAndRenderSharedMapPins();
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        handlePageForegroundWakeup('visibilitychange');
    }
});

window.addEventListener('focus', () => {
    handlePageForegroundWakeup('focus');
});

window.addEventListener('pageshow', () => {
    handlePageForegroundWakeup('pageshow');
});

