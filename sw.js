const CACHE_VERSION = 'v3.22';
const TILE_CACHE_NAME = 'yingge-map-tiles-v3.22';
const CACHE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon-512.png',
    './garbage-truck.png'
];

// 判斷是否為 MapLibre GL 向量圖磚 (*.pbf, *.mvt) 或地圖圖磚請求
function isMapTileRequest(url) {
    const path = url.pathname.toLowerCase();
    const href = url.href.toLowerCase();
    return (
        path.endsWith('.pbf') ||
        path.endsWith('.mvt') ||
        href.includes('.pbf?') ||
        href.includes('.mvt?') ||
        url.hostname.includes('tiles.openfreemap.org') ||
        url.hostname.includes('mt0.google.com') ||
        url.hostname.includes('mt1.google.com') ||
        url.hostname.includes('mt2.google.com') ||
        url.hostname.includes('mt3.google.com') ||
        path.includes('/tiles/')
    );
}

self.addEventListener('install', function(event) {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_VERSION).then(function(cache) {
            return cache.addAll(CACHE_ASSETS);
        }).catch(function() {})
    );
});

self.addEventListener('activate', function(event) {
    const allowedCaches = [CACHE_VERSION, TILE_CACHE_NAME];
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.map(function(key) {
                    if (!allowedCaches.includes(key)) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', function(event) {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Firebase 即時資料庫永遠直接走網路，不進靜態快取
    if (url.hostname.includes('firebasedatabase.app')) {
        return;
    }

    // 🗺️ MapLibre GL 向量圖磚 (*.pbf / *.mvt) 與地圖圖磚：採用 Stale-While-Revalidate (SWR) 動態快取
    // 確保車子開進山區或無網路死角時優先秒讀快取圖磚、地圖不變空白，有網路時背景靜默更新
    if (isMapTileRequest(url)) {
        event.respondWith(
            caches.open(TILE_CACHE_NAME).then(function(cache) {
                return cache.match(req).then(function(cachedRes) {
                    const networkFetch = fetch(req)
                        .then(function(networkRes) {
                            if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
                                cache.put(req, networkRes.clone()).catch(function() {});
                            }
                            return networkRes;
                        })
                        .catch(function() {
                            return cachedRes;
                        });
                    return cachedRes || networkFetch;
                });
            })
        );
        return;
    }

    // 應用程式核心資源採用 Network-First 策略：有網路時優先取最新檔案並更新快取，斷網時自動降級使用離線快取
    event.respondWith(
        fetch(req)
            .then(function(networkRes) {
                if (networkRes && networkRes.status === 200 && url.origin === self.location.origin) {
                    const resClone = networkRes.clone();
                    caches.open(CACHE_VERSION).then(function(cache) {
                        cache.put(req, resClone);
                    }).catch(function() {});
                }
                return networkRes;
            })
            .catch(function() {
                return caches.match(req);
            })
    );
});
