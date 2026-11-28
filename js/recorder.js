// Safe recording for 회의록: every few seconds the new audio is written to this device, so a PC that
// switches off, a closed window, a lock or a log-out loses at most the last few seconds. Whatever was
// kept is put back into its meeting (or a new "복구된 녹음" meeting) the next time MY AIDE opens.
import * as db from './db.js';
import { uid, today } from './util.js';

const LIVE = 'rec-live';                       // { id, meetingId, mime, start, n, last }
const chunkKey = (id, i) => `rec-chunk:${id}:${i}`;
const localDay = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

let active = null;   // id of the recording running in this window (never "recovered" while it runs)
export const release = () => { active = null; };

export async function begin(meetingId, mime) {
  await recoverPending();   // an older unfinished one goes back to its meeting first
  const live = { id: uid(), meetingId, mime, start: Date.now(), n: 0, last: Date.now() };
  active = live.id;
  await db.kvSet(LIVE, live);
  return live;
}
// Called for each piece MediaRecorder hands over (every 3 s).
export async function keep(live, blob) {
  const i = live.n++;
  live.last = Date.now();
  await db.kvSet(chunkKey(live.id, i), blob);
  await db.kvSet(LIVE, { ...live });
}
async function clear(live) {
  for (let i = 0; i < live.n; i++) await db.kvDel(chunkKey(live.id, i));
  await db.kvDel(LIVE);
}
// Normal end: the caller saves the audio itself, so only the safety copy goes.
export async function finish(live) { active = null; if (live) await clear(live); }

// Put an unfinished recording back into its meeting. Returns seconds recovered (0 when there was nothing).
let running = null;
// `force` is for this window's own recording that just stopped; otherwise a recording that wrote less than
// 15 s ago is still running in another window (or a widget) and is left alone.
export function recoverPending({ force = false } = {}) {
  if (!running) running = (async () => {
    const live = await db.kvGet(LIVE);
    if (!live || live.id === active) return 0;
    if (!force && Date.now() - (live.last || 0) < 15000) return 0;
    if (!live.n) { await clear(live); return 0; }
    const parts = [];
    for (let i = 0; i < live.n; i++) { const b = await db.kvGet(chunkKey(live.id, i)); if (b) parts.push(b); }
    if (!parts.length) { await clear(live); return 0; }
    const blob = new Blob(parts, { type: live.mime || parts[0].type || 'audio/webm' });
    const blobId = 'audio-' + uid();
    const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
    await db.putBlob(blobId, blob, { name: `복구된 녹음 ${today()}.${ext}` });
    const duration = Math.max(1, Math.round((live.last - live.start) / 1000));
    const entry = { blobId, duration, mime: blob.type, at: live.start, recovered: true };
    const m = live.meetingId && await db.get('meetings', live.meetingId);
    if (m) { const { id, updatedAt, ...data } = m; await db.put('meetings', live.meetingId, { ...data, audio: [...(data.audio || []), entry] }); }
    else await db.put('meetings', uid(), { title: '복구된 녹음', date: localDay(live.start), transcript: '', summary: '', audio: [entry] });
    await clear(live);
    return duration;
  })().finally(() => { running = null; });
  return running;
}

// At start-up: recover now, or — when the last piece is only seconds old (the window was just closed or
// another window is still recording) — look again once that recording should have gone quiet.
export async function recoverAtStart(onDone) {
  const sec = await recoverPending();
  if (sec) return onDone(sec);
  const live = await db.kvGet(LIVE);
  if (live && live.id !== active && live.n) setTimeout(() => recoverAtStart(onDone), Math.max(1000, 16000 - (Date.now() - (live.last || 0))));
}
