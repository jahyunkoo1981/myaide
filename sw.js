// Offline app shell: the app opens without a connection; data lives in IndexedDB, not here.
const VERSION = 'myaide-v3.1.0';
const SHELL = [
  './', 'index.html', 'app.css', 'config.js', 'manifest.webmanifest', 'manual.md',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/korean-lunar-calendar.mjs',
  'js/main.js', 'js/util.js', 'js/db.js', 'js/native.js', 'js/auth.js', 'js/backends.js', 'js/sync.js', 'js/vault.js',
  'js/prefs.js', 'js/conflicts.js', 'js/capture.js', 'js/editor.js', 'js/outline.js', 'js/naver.js', 'js/recorder.js', 'js/theme.js', 'dark.css', 'js/views/code.js', 'js/views/devtools.js', 'js/inkpad.js', 'js/imageeditor.js', 'js/lunar.js', 'js/md.js', 'js/openai.js', 'js/usage.js', 'js/views/usagepanel.js', 'js/privacy.js', 'js/views/privacypanel.js', 'js/views/masker.js', 'js/recordtools.js', 'js/receipt.js', 'js/license.js', 'js/views/users.js', 'js/views/home.js', 'js/views/phonemenu.js', 'js/views/feedback.js', 'js/views/onboarding.js', 'js/ocrlearn.js', 'js/views/receiptlearnpanel.js',
  'js/views/journal.js', 'js/views/docs.js', 'js/views/knowledge.js', 'js/views/schedule.js', 'js/views/milestones.js',
  'js/views/ledger.js', 'js/views/accounts.js', 'js/views/meetings.js', 'js/views/aide.js', 'js/views/search.js', 'privacy.html',
  'js/views/remote.js', 'js/views/backup.js', 'js/views/settings.js', 'js/views/manual.js',
  'js/flowedit.js', 'js/views/mindmap.js', 'js/views/widgets.js', 'setup.md', 'vendor/fonts/PretendardVariable.woff2',
  'remote.html', 'js/remote-guest.js', 'vendor/peerjs.min.js',
  'js/views/media.js', 'js/mediastore.js', 'js/videoedit.js', 'vendor/exifr.mjs'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Same-origin GETs: network first so updates show up right away; the cache is the offline fallback.
// Google and OpenAI calls are never touched.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const nav = e.request.mode === 'navigate';
    const key = nav && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) ? 'index.html' : nav ? url.pathname.split('/').pop() : e.request;
    if (url.pathname.endsWith('.exe')) return fetch(e.request);
    try {
      const res = await fetch(e.request, { cache: 'no-cache' });
      if (res.ok) cache.put(key, res.clone());
      return res;
    } catch {
      return (await cache.match(key, { ignoreSearch: true })) || Response.error();
    }
  }));
});
