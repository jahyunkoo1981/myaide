// Sync engine: pull changes from the backend, detect clashes, push local edits.
// A clash happens when this device edited a record offline and another device saved the same record
// after the version this device last saw. Clashed records are held until the user decides (conflicts.js).
import * as db from './db.js';

export const state = { status: 'idle', message: '', lastSync: 0, pending: 0, conflicts: 0, needsAuth: false, backend: null };
export const syncEvents = new EventTarget();
let running = null, again = false, timer = null;

function set(patch) { Object.assign(state, patch); syncEvents.dispatchEvent(new Event('state')); }

export function useBackend(backend) { state.backend = backend; }

export async function counts() {
  const dirty = await db.dirtyRecords();
  const blobs = await db.pendingBlobs();
  const all = await db.rawAll();
  set({ pending: dirty.filter(r => !r.conflict).length + blobs.length, conflicts: all.filter(r => r.conflict).length });
}

export function schedule(ms = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow().catch(() => {}), ms);
}

export function syncNow() {
  if (!state.backend) return Promise.resolve();
  if (running) { again = true; return running; }
  running = run().finally(() => {
    running = null;
    if (again) { again = false; schedule(300); }
  });
  return running;
}

async function run() {
  const b = state.backend;
  if (!navigator.onLine && b.kind === 'drive') { set({ status: 'offline', message: '오프라인 · 이 기기에 저장 중' }); await counts(); return; }
  set({ status: 'busy', message: '동기화 중…' });
  try {
    if (!b.folders && b.init) await b.init();
    await pull(b);
    await push(b);
    await pushBlobs(b);
    await counts();
    set({ status: 'ok', lastSync: Date.now(), needsAuth: false, message: state.conflicts ? `확인 필요 ${state.conflicts}건` : '동기화됨' });
  } catch (e) {
    await counts();
    if (e.auth) set({ status: 'auth', needsAuth: true, message: 'Google 다시 연결 필요' });
    else if (e.status === 404 && b.kind === 'drive') { await db.kvSet('drive.folders', null); b.folders = null; set({ status: 'error', message: 'Drive 폴더를 다시 찾는 중' }); schedule(500); }
    else set({ status: navigator.onLine ? 'error' : 'offline', message: navigator.onLine ? e.message : '오프라인 · 이 기기에 저장 중' });
    throw e;
  }
}

async function pull(b) {
  const cursorKey = 'sync.cursor.' + b.kind;
  const { items, cursor } = await b.listChanged(await db.kvGet(cursorKey));
  const queue = [];
  for (const it of items) {
    const [col, ...rest] = it.key.split('/');
    const id = rest.join('/');
    const local = await db.getRecord(col, id);
    if (!local) { queue.push({ it, col, id, local: null }); continue; }
    if (!local.fileId && it.fileId) { local.fileId = it.fileId; await db.putRaw(local, { silent: true }); }
    if (it.u <= local.base) continue;               // already seen (or our own upload)
    if (local.conflict && local.conflict.updatedAt === it.u) continue;
    queue.push({ it, col, id, local });
  }
  // Download in small parallel batches.
  for (let i = 0; i < queue.length; i += 6) {
    await Promise.all(queue.slice(i, i + 6).map(async ({ it, col, id }) => {
      const remote = await b.read(it.fileId);
      const local = await db.getRecord(col, id);   // re-read: the user may have typed meanwhile
      const key = col + '/' + id;
      const incoming = { key, col, id, data: remote.data, updatedAt: remote.updatedAt || it.u, deleted: !!remote.deleted, dirty: false, base: remote.updatedAt || it.u, fileId: it.fileId };
      if (!local || !local.dirty) { await db.putRaw(incoming); return; }
      if (sameData(local, incoming)) { local.base = incoming.base; local.fileId = it.fileId; local.dirty = false; local.conflict = null; await db.putRaw(local, { silent: true }); return; }
      local.conflict = { data: remote.data, deleted: !!remote.deleted, updatedAt: incoming.updatedAt };
      local.fileId = it.fileId;
      await db.putRaw(local);
    }));
  }
  await db.kvSet(cursorKey, cursor);
}

function sameData(a, b) {
  if (!!a.deleted !== !!b.deleted) return false;
  return JSON.stringify(a.data) === JSON.stringify(b.data);
}

async function push(b) {
  const dirty = (await db.dirtyRecords()).filter(r => !r.conflict);
  for (const r of dirty) {
    const fileId = await b.write(r, r.fileId);
    await db.markClean(r.key, r.updatedAt, fileId);
  }
}

async function pushBlobs(b) {
  for (const row of await db.pendingBlobs()) {
    await b.putBlob(row.id, row.blob, row.name);
    await db.markBlob(row.id, { uploaded: true });
  }
}

export async function getBlob(id) {
  const row = await db.getBlobRow(id);
  if (row) return row.blob;
  if (!state.backend) throw new Error('저장소가 연결되지 않았습니다.');
  const blob = await state.backend.getBlob(id);
  await db.putBlob(id, blob, { uploaded: true });
  return blob;
}

// ---------- conflict resolution ----------
export async function conflicts() { return (await db.rawAll()).filter(r => r.conflict); }

// choice: 'mine' keep this device's version | 'theirs' take the other version | 'both' merge text (documents)
export async function resolve(key, choice, mergedData) {
  const [col, ...rest] = key.split('/');
  const r = await db.getRecord(col, rest.join('/'));
  if (!r || !r.conflict) return;
  const c = r.conflict;
  if (choice === 'theirs') {
    await db.putRaw({ ...r, data: c.data, deleted: c.deleted, updatedAt: c.updatedAt, base: c.updatedAt, dirty: false, conflict: null });
  } else {
    const data = choice === 'both' && mergedData ? mergedData : r.data;
    await db.putRaw({ ...r, data, deleted: choice === 'both' ? false : r.deleted, updatedAt: Math.max(Date.now(), c.updatedAt + 1), base: c.updatedAt, dirty: true, conflict: null });
  }
  await counts();
  schedule(200);
}

db.events.addEventListener('dirty', () => { counts(); schedule(); });
window.addEventListener('online', () => schedule(300));
