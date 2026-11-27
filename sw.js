const CACHE_VERSION = 'v3.93';
const TILE_CACHE_NAME = 'yingge-map-tiles-v3.93';
const CACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './src/config-state.js',
  './src/carModels.js',
  './src/map-core.js',
  './src/caution-editor.js',
  './src/route-editor.js',
  './src/navigation.js',
  './src/approach-nav.js',
  './src/firebase-fleet.js',
  './src/shared-pins.js',
  './src/firebase-auth.js',
  './src/ai-settings.js',
  './src/furniture-osrm.js',
  './src/bgm-player.js',
  './src/speed-cameras.js',
  './src/fleet-radio-ptt.js',
  './src/main.js',
  './manifest.json',
  './icon-512.png',
  './garbage-truck.png',
  './assets/cars/garbage_yellow.png',
  './assets/cars/recycle_white.png',
  './assets/cars/claw_truck.png',
  './assets/cars/thousand_sunny.png',
  './assets/cars/turtle.png',
  './assets/cars/sports_car.png',
  './assets/cars/santa_sleigh_1.png',
  './assets/cars/santa_sleigh_2.png',
  './assets/cars/santa_sleigh_3.png',
  './assets/cars/lion_dance_1.png',
  './assets/cars/lion_dance_2.png',
  './assets/cars/lion_dance_3.png',
  './assets/cars/lion_dance_4.png',
  './assets/cars/pumpkin_carriage_1.png',
  './assets/cars/pumpkin_carriage_2.png',
  './assets/cars/pumpkin_carriage_3.png'
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

    let url;
    try {
        url = new URL(req.url);
    } catch (e) {
        return;
    }

    // 外部 API（Firebase、OSRM、ArcGIS、Gemini、CDN 等）直接走原生瀏覽器網路，不經 Service Worker 攔截
    if (url.origin !== self.location.origin && !isMapTileRequest(url)) {
        return;
    }

    // 🗺️ MapLibre GL 圖磚：僅在已快取時提供離線備援，網路請求失敗且無快取時不傳回 undefined
    if (isMapTileRequest(url)) {
        event.respondWith(
            caches.open(TILE_CACHE_NAME).then(function(cache) {
                return cache.match(req).then(function(cachedRes) {
                    const networkFetch = fetch(req)
                        .then(function(networkRes) {
                            if (networkRes && networkRes.status === 200) {
                                cache.put(req, networkRes.clone()).catch(function() {});
                            }
                            return networkRes;
                        })
                        .catch(function() {
                            if (cachedRes) return cachedRes;
                            return new Response('', { status: 204, statusText: 'No Tile Content' });
                        });
                    return cachedRes || networkFetch;
                });
            })
        );
        return;
    }

    // 本機核心靜態資源採用 Network-First 策略：有網路時強制略過陳舊 HTTP 快取取最新檔案並更新快取，斷網時降級使用離線快取
    event.respondWith(
        fetch(req, { cache: 'no-cache' })
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
                return caches.match(req).then(function(cached) {
                    if (cached) return cached;
                    return caches.match(req, { ignoreSearch: true }).then(function(fallbackCached) {
                        return fallbackCached || new Response('', { status: 503, statusText: 'Offline' });
                    });
                });
            })
    );
});
