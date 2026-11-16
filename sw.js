const CACHE_VERSION = 'yingge-clean-route-v2.1.0';
const CACHE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon-512.png',
    './garbage-truck.png'
];

self.addEventListener('install', function(event) {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_VERSION).then(function(cache) {
            return cache.addAll(CACHE_ASSETS);
        }).catch(function() {})
    );
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.map(function(key) {
                    if (key !== CACHE_VERSION) {
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
    // 只要有這個 fetch 監聽器，Chrome 就會承認它是合格的 App
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    // Firebase 即時資料庫與外部圖磚直接走網路，不進靜態快取
    if (url.hostname.includes('firebasedatabase.app') || url.hostname.includes('google.com')) {
        return;
    }

    // 採用 Network-First 策略：有網路時優先取最新檔案並更新快取，斷網時自動降級使用離線快取
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
