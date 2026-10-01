const CACHE = 'sudoku-live-v1.3.0-data-tools';
const SHELL = ['./','./index.html','./admin.html','./styles.css','./app.js','./admin.js','./manifest.json','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.hostname === 'suduko.mdmsportal.uk') return;
  event.respondWith(fetch(event.request).then(response => { const clone=response.clone(); caches.open(CACHE).then(c=>c.put(event.request,clone)); return response; }).catch(()=>caches.match(event.request).then(r=>r||caches.match('./index.html'))));
});
