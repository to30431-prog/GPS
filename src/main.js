// ==========================================
// [Module 10/10] src/main.js
// 應用程式主進入點：實體返回鍵攔截與各核心模組依序初始化啟動
// ==========================================

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
        const longPressPinTypeModal = document.getElementById('longPressPinTypeModal');
        const createBuildingPinModal = document.getElementById('createBuildingPinModal');
        const createMapPinModal = document.getElementById('createMapPinModal');
        const viewMapPinModal = document.getElementById('viewMapPinModal');
        const quickNavAlertModal = document.getElementById('quickNavAlertModal');
        const manualDrawUI = document.getElementById('manualDrawUI');
        const adminSettingsModal = document.getElementById('adminSettingsModal');
        const adminPasswordModal = document.getElementById('adminPasswordModal');
        const aiDispatchModal = document.getElementById('aiDispatchModal');
        const speedCameraEditorModal = document.getElementById('speedCameraEditorModal');

        // 依序檢查目前是哪個畫面在最上層，就模擬點擊它的「關閉/返回」按鈕
        if (speedCameraEditorModal && !speedCameraEditorModal.classList.contains('hidden')) {
            window.SpeedCameraManager?.closeEditorModal();
        }
        else if (aiDispatchModal && !aiDispatchModal.classList.contains('hidden')) {
            aiDispatchModal.classList.add('hidden');
        }
        else if (adminSettingsModal && !adminSettingsModal.classList.contains('hidden')) {
            adminSettingsModal.classList.add('hidden');
        }
        else if (adminPasswordModal && !adminPasswordModal.classList.contains('hidden')) {
            adminPasswordModal.classList.add('hidden');
        }
        else if (blackOverlay && !blackOverlay.classList.contains('hidden')) {
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
        else if (createBuildingPinModal && !createBuildingPinModal.classList.contains('hidden')) {
            document.getElementById('btnCancelBuildingPin').click();
        }
        else if (createMapPinModal && !createMapPinModal.classList.contains('hidden')) {
            document.getElementById('btnCancelCreateMapPin').click();
        }
        else if (longPressPinTypeModal && !longPressPinTypeModal.classList.contains('hidden')) {
            document.getElementById('btnCancelLongPressPinType').click();
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
            document.getElementById('topBackBtn').click();
        }
        else if (historyModal && !historyModal.classList.contains('hidden')) {
            document.getElementById('closeHistory').click();
        }
    });

    function pushFakeHistory() {
        window.history.pushState({ pwa: true }, '');
    }

    const hBtn = document.getElementById('historyBtn');
    if (hBtn) hBtn.addEventListener('click', pushFakeHistory);

    const sBtn = document.getElementById('settingsBtn');
    if (sBtn) sBtn.addEventListener('click', pushFakeHistory);

    const cBtn = document.getElementById('openCloudModalBtn');
    if (cBtn) cBtn.addEventListener('click', pushFakeHistory);

    const bBtn = document.getElementById('blackScreenBtn');
    if (bBtn) bBtn.addEventListener('click', pushFakeHistory);

    if (typeof window.openRouteDetail === 'function') {
        const originalOpenRouteDetail = window.openRouteDetail;
        window.openRouteDetail = function(idx) {
            pushFakeHistory();
            originalOpenRouteDetail(idx);
        };
    }
})();

// 初始化檢查使用者名稱與啟動車隊雷達
syncFleetUserNameUI();
if (fleetUserName) {
    startFleetRadarSystem();
} else {
    openFleetUserNameModal(true);
}

// 開啟 App 時立即讀取一次 /map_pins.json 並啟動定期同步
if (map.loaded()) {
    startSharedMapPinsSystem();
} else {
    map.once('load', startSharedMapPinsSystem);
}
startSharedMapPinsSystem();

// --- 10.5 初始化：啟動時立即讀取雲端系統參數、門禁狀態、公告橫幅與雲端路線版本比對 ---
(async function initSystemConfigSync() {
    const cloudCfg = await fetchSystemConfig();
    currentRadarIntervalSec = cloudCfg.radarIntervalSec;
    lastKnownCloudInterval = cloudCfg.radarIntervalSec;
    applySystemConfigToRuntime(cloudCfg);

    if (fleetUserName) {
        await syncMyFleetUserRecordToCloud({ displayName: fleetUserName });
    }
    await checkMyFleetUserAccessStatus();

    if (fleetRadarStarted && fleetUserName && !isDeviceRestrictedByGatekeeper()) {
        restartFleetRadarWithNewInterval(cloudCfg.radarIntervalSec);
    }
    if (typeof checkCloudRouteUpdatesInBackground === 'function') {
        checkCloudRouteUpdatesInBackground(true);
    }
    window.addEventListener('online', () => {
        if (typeof checkCloudRouteUpdatesInBackground === 'function') {
            checkCloudRouteUpdatesInBackground(true);
        }
        checkMyFleetUserAccessStatus();
    });
    // 每 6 秒自動同步全隊系統參數、全站門禁與角色權限狀態（確保權限切換或封鎖時秒級生效）
    setInterval(() => {
        checkAndApplyRadarInterval();
    }, 6000);
})();

// 啟動時載入當日本機備份並每 6 秒從 Firebase 同步當日家具路線與「🔥 需垃圾車支援（純木頭）」火紅標記
(function initFurnitureCollabSystem() {
    const localData = loadLocalFurnitureBackup();
    if (localData) {
        furnitureActiveData = localData;
    }
    updateFurniturePanelUI();
    fetchAndSyncTodayFurnitureCollab();
    setInterval(fetchAndSyncTodayFurnitureCollab, 6000);
})();
