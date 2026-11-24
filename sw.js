// Offline app shell: the app opens without a connection; data lives in IndexedDB, not here.
const VERSION = 'myaide-v2.0.0';
const SHELL = [
  './', 'index.html', 'app.css', 'config.js', 'manifest.webmanifest', 'manual.md',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/korean-lunar-calendar.mjs',
  'js/main.js', 'js/util.js', 'js/db.js', 'js/native.js', 'js/auth.js', 'js/backends.js', 'js/sync.js', 'js/vault.js',
  'js/prefs.js', 'js/conflicts.js', 'js/lock.js', 'js/editor.js', 'js/inkpad.js', 'js/imageeditor.js', 'js/lunar.js', 'js/md.js', 'js/openai.js',
  'js/views/journal.js', 'js/views/docs.js', 'js/views/knowledge.js', 'js/views/schedule.js', 'js/views/milestones.js',
  'js/views/ledger.js', 'js/views/accounts.js', 'js/views/meetings.js', 'js/views/aide.js', 'js/views/files.js',
  'js/views/remote.js', 'js/views/backup.js', 'js/views/settings.js', 'js/views/manual.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Same-origin GETs: serve from cache, refresh in the background. Google and OpenAI calls are never cached.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const key = e.request.mode === 'navigate' ? 'index.html' : e.request;
    const hit = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(e.request).then(res => { if (res.ok && e.request.mode !== 'navigate') cache.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || fresh;
  }));
});
