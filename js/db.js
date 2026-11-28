// Local-first store on IndexedDB. Every view reads and writes here; sync.js moves records to and from the backend.
// Record shape: { key, col, id, data, updatedAt, deleted, dirty, base, fileId, conflict }
//   updatedAt  last local edit time (ms)          base     remote updatedAt last seen (ms)
//   dirty      needs upload                        conflict remote copy that clashed with a local edit

const DB_NAME = 'myaide';
let dbp;
export const events = new EventTarget();

function open() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const rec = db.createObjectStore('records', { keyPath: 'key' });
      rec.createIndex('col', 'col');
      rec.createIndex('dirty', 'dirtyFlag');
      db.createObjectStore('blobs', { keyPath: 'id' });
      db.createObjectStore('kv', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('저장이 취소되었습니다.'));
  }));
}

const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// ---------- records ----------
export async function getRecord(col, id) {
  return tx('records', 'readonly', s => req2p(s.get(col + '/' + id)));
}
export async function get(col, id) {
  const r = await getRecord(col, id);
  return r && !r.deleted ? r.data : null;
}
export async function all(col) {
  const rows = await tx('records', 'readonly', s => req2p(s.index('col').getAll(col)));
  return rows.filter(r => !r.deleted).map(r => ({ id: r.id, updatedAt: r.updatedAt, ...r.data }));
}
export async function rawAll() { return tx('records', 'readonly', s => req2p(s.getAll())); }
export async function dirtyRecords() { return tx('records', 'readonly', s => req2p(s.index('dirty').getAll(1))); }

// Other windows of the same app (desktop widgets, other browser tabs) hear about changes too.
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('myaide-db') : null;
if (bc) bc.onmessage = e => {
  const m = e.data || {};
  if (m.t === 'change') events.dispatchEvent(new CustomEvent('change', { detail: { col: m.col, id: m.id, remote: true } }));
  if (m.t === 'dirty') events.dispatchEvent(new Event('dirty'));
};
function emit(col, id) { events.dispatchEvent(new CustomEvent('change', { detail: { col, id } })); bc?.postMessage({ t: 'change', col, id }); }
function dirtied() { events.dispatchEvent(new Event('dirty')); bc?.postMessage({ t: 'dirty' }); }

export async function put(col, id, data) {
  const key = col + '/' + id;
  await tx('records', 'readwrite', async s => {
    const old = await req2p(s.get(key));
    const now = Math.max(Date.now(), (old?.updatedAt || 0) + 1);
    s.put({ ...(old || { key, col, id, base: 0 }), data, updatedAt: now, deleted: false, dirty: true, dirtyFlag: 1 });
  });
  emit(col, id);
  dirtied();
}

export async function remove(col, id) {
  const key = col + '/' + id;
  await tx('records', 'readwrite', async s => {
    const old = await req2p(s.get(key));
    if (!old) return;
    s.put({ ...old, data: null, deleted: true, updatedAt: Math.max(Date.now(), old.updatedAt + 1), dirty: true, dirtyFlag: 1 });
  });
  emit(col, id);
  dirtied();
}

// Used by sync only: write a record exactly as given (no timestamp bump).
export async function putRaw(rec, { silent } = {}) {
  rec.dirtyFlag = rec.dirty ? 1 : 0;
  await tx('records', 'readwrite', s => s.put(rec));
  if (!silent) emit(rec.col, rec.id);
}

// Mark a record uploaded, unless the user edited it again while the upload was running.
export async function markClean(key, uploadedAt, fileId) {
  let changed = false;
  await tx('records', 'readwrite', async s => {
    const r = await req2p(s.get(key));
    if (!r) return;
    r.fileId = fileId || r.fileId;
    r.base = uploadedAt;
    if (r.updatedAt === uploadedAt) { r.dirty = false; r.dirtyFlag = 0; changed = true; }
    s.put(r);
  });
  return changed;
}

// ---------- blobs (audio, large files) ----------
export async function putBlob(id, blob, meta = {}) {
  await tx('blobs', 'readwrite', s => s.put({ id, blob, type: blob.type, uploaded: false, ...meta }));
  if (!meta.uploaded) dirtied();
}
// Picture previews kept on this device only (사진·동영상); can be cleared at any time.
export async function cacheSize() {
  const rows = await tx('blobs', 'readonly', s => req2p(s.getAll()));
  return rows.filter(r => r.cache).reduce((n, r) => n + (r.blob?.size || 0), 0);
}
export async function clearCache() {
  const rows = await tx('blobs', 'readonly', s => req2p(s.getAll()));
  await tx('blobs', 'readwrite', s => rows.filter(r => r.cache).forEach(r => s.delete(r.id)));
}
export async function getBlobRow(id) { return tx('blobs', 'readonly', s => req2p(s.get(id))); }
export async function pendingBlobs() {
  const rows = await tx('blobs', 'readonly', s => req2p(s.getAll()));
  return rows.filter(r => !r.uploaded);
}
export async function markBlob(id, fields) {
  await tx('blobs', 'readwrite', async s => { const r = await req2p(s.get(id)); if (r) s.put({ ...r, ...fields }); });
}
export async function deleteBlob(id) { await tx('blobs', 'readwrite', s => s.delete(id)); }

// ---------- key/value (per device, never synced) ----------
export async function kvGet(k, fallback = null) {
  const r = await tx('kv', 'readonly', s => req2p(s.get(k)));
  return r ? r.v : fallback;
}
export async function kvSet(k, v) { await tx('kv', 'readwrite', s => s.put({ k, v })); }
export async function kvDel(k) { await tx('kv', 'readwrite', s => s.delete(k)); }

export async function wipeAll() {
  const db = await open();
  db.close(); dbp = null;
  await new Promise((res, rej) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = res; r.onerror = () => rej(r.error); r.onblocked = res; });
}
