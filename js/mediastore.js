// 사진·동영상 storage: originals go to Google Drive untouched (MY AIDE/media), uploaded in large resumable
// chunks with several files at once; downloads fetch byte ranges in parallel. Each item also gets a small
// thumbnail and a screen-size preview (JPEG) so every device can browse without downloading originals —
// the same idea as iCloud "저장 공간 최적화".
import * as sync from './sync.js';
import * as db from './db.js';
import { kvGet, kvSet } from './db.js';

const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
const CHUNK = 16 * 1024 * 1024;        // multiple of 256 KiB
const DL_PART = 8 * 1024 * 1024;
const DL_PARALLEL = 4;

export function backend() {
  const b = sync.state.backend;
  if (!b || b.kind !== 'drive') throw new Error('사진·동영상은 Google Drive에 저장할 때 쓸 수 있습니다. (업무망 ‘이 PC에만 저장’ 모드에서는 쓸 수 없습니다)');
  return b;
}

async function mediaFolder() {
  const b = backend();
  let id = await kvGet('drive.mediaFolder');
  if (!id) {
    await b.init();
    id = await b.findOrCreate('media', 'media', b.folders.root);
    await kvSet('drive.mediaFolder', id);
  }
  return id;
}

// ---------- upload (resumable, chunked, with progress) ----------
function xhr(method, url, { headers = {}, body = null, onProgress, responseType = 'text' } = {}) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.responseType = responseType;
    if (onProgress && x.upload) x.upload.onprogress = e => onProgress(e.loaded);
    x.onload = () => resolve(x);
    x.onerror = () => reject(Object.assign(new Error('네트워크 오류'), { network: true }));
    x.ontimeout = () => reject(Object.assign(new Error('시간 초과'), { network: true }));
    x.send(body);
  });
}

export async function uploadOriginal(file, meta, onProgress) {
  const b = backend();
  const parent = await mediaFolder();
  const token = await b.token();
  const type = file.type || 'application/octet-stream';
  const start = await fetch(`${UP}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(file.size) },
    body: JSON.stringify({ name: meta.name, parents: [parent], appProperties: { m: meta.id, v: 'orig' } })
  });
  if (start.status === 401) throw Object.assign(new Error('Google 연결이 만료되었습니다.'), { auth: true });
  if (!start.ok) throw new Error('업로드를 시작하지 못했습니다 (' + start.status + ')');
  const session = start.headers.get('Location');
  if (!session) throw new Error('업로드 주소를 받지 못했습니다.');
  let offset = 0, tries = 0;
  if (file.size === 0) {
    const r = await xhr('PUT', session, { headers: { 'Content-Range': 'bytes */0' } });
    return JSON.parse(r.responseText).id;
  }
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK, file.size);
    try {
      const r = await xhr('PUT', session, {
        headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${file.size}` },
        body: file.slice(offset, end),
        onProgress: n => onProgress && onProgress(offset + n, file.size)
      });
      if (r.status === 200 || r.status === 201) { onProgress && onProgress(file.size, file.size); return JSON.parse(r.responseText).id; }
      if (r.status === 308) {
        const range = r.getResponseHeader('Range');
        offset = range ? Number(range.split('-')[1]) + 1 : 0;
        tries = 0; continue;
      }
      if (r.status >= 500 || r.status === 429) throw Object.assign(new Error('서버가 바쁩니다'), { network: true });
      throw new Error('업로드 실패 (' + r.status + ')');
    } catch (e) {
      if (!e.network || ++tries > 6) throw e;
      await new Promise(res => setTimeout(res, 1000 * tries * tries));
      // ask the server how far it got, then carry on from there
      try {
        const q = await xhr('PUT', session, { headers: { 'Content-Range': `bytes */${file.size}` } });
        if (q.status === 200 || q.status === 201) return JSON.parse(q.responseText).id;
        const range = q.getResponseHeader('Range');
        offset = range ? Number(range.split('-')[1]) + 1 : 0;
      } catch {}
    }
  }
  throw new Error('업로드를 끝내지 못했습니다.');
}

export async function uploadSmall(blob, meta) {
  const b = backend();
  const parent = await mediaFolder();
  return b.upload({ name: meta.name, parents: [parent], appProperties: { m: meta.id, v: meta.v } }, blob, blob.type || 'image/jpeg');
}

// ---------- download (parallel byte ranges) ----------
export async function download(fileId, size, type, onProgress) {
  const b = backend();
  const token = await b.token();
  const url = `${API}/files/${fileId}?alt=media`;
  if (!size || size <= DL_PART) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('내려받지 못했습니다 (' + r.status + ')');
    const blob = await r.blob(); onProgress && onProgress(blob.size, blob.size);
    return new Blob([blob], { type: type || blob.type });
  }
  const parts = [];
  for (let s = 0; s < size; s += DL_PART) parts.push([s, Math.min(s + DL_PART, size) - 1]);
  const out = new Array(parts.length);
  let done = 0, next = 0;
  const worker = async () => {
    while (next < parts.length) {
      const i = next++, [s, e] = parts[i];
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Range: `bytes=${s}-${e}` } });
          if (!r.ok && r.status !== 206) throw new Error('내려받지 못했습니다 (' + r.status + ')');
          out[i] = await r.blob(); done += out[i].size; onProgress && onProgress(done, size);
          break;
        } catch (err) { if (attempt >= 4) throw err; await new Promise(res => setTimeout(res, 800 * (attempt + 1))); }
      }
    }
  };
  await Promise.all(Array.from({ length: DL_PARALLEL }, worker));
  return new Blob(out, { type: type || 'application/octet-stream' });
}

export async function remove(fileId) {
  if (!fileId) return;
  try { await backend().deleteFile(fileId); } catch (e) { if (e.status !== 404) throw e; }
}

// Thumbnails/previews are cached on this device (small); originals are not.
export async function cachedImage(fileId, cacheKey) {
  if (!fileId) return null;
  const row = await db.getBlobRow(cacheKey);
  if (row) return row.blob;
  const blob = await download(fileId, 0, 'image/jpeg');
  await db.putBlob(cacheKey, blob, { uploaded: true, cache: true });
  return blob;
}

// ---------- reading files on this device ----------
export async function quickHash(file) {
  const MB = 1024 * 1024;
  const parts = [new TextEncoder().encode(String(file.size)), new Uint8Array(await file.slice(0, MB).arrayBuffer())];
  if (file.size > MB) parts.push(new Uint8Array(await file.slice(Math.max(MB, file.size - MB)).arrayBuffer()));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return [...d.slice(0, 16)].map(x => x.toString(16).padStart(2, '0')).join('');
}

const isVideo = f => (f.type || '').startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(f.name);
const isHeic = f => /image\/hei[cf]/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);
export { isVideo, isHeic };

async function decodeImage(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.decoding = 'async'; img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function scaled(src, w, h, max, quality) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(b => r({ blob: b, canvas: c }), 'image/jpeg', quality));
}

// 64-bit difference hash of a picture, for spotting near-identical photos
function dhash(src, w, h) {
  const c = document.createElement('canvas'); c.width = 9; c.height = 8;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, 9, 8);
  const d = g.getImageData(0, 0, 9, 8).data;
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const i = (y * 9 + x) * 4, j = i + 4;
    bits += (d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11) > (d[j] * .3 + d[j + 1] * .59 + d[j + 2] * .11) ? '1' : '0';
  }
  let hex = ''; for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let n = 0; for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { n += x & 1; x >>= 1; } }
  return n;
}

// MP4/MOV creation time from the 'mvhd' box (seconds since 1904)
async function mp4Created(file) {
  const scan = async (start, len) => {
    const buf = new Uint8Array(await file.slice(start, start + len).arrayBuffer());
    for (let i = 4; i < buf.length - 24; i++) {
      if (buf[i] === 0x6d && buf[i + 1] === 0x76 && buf[i + 2] === 0x68 && buf[i + 3] === 0x64) {
        const v = buf[i + 4], dv = new DataView(buf.buffer, buf.byteOffset + i + 8);
        const secs = v === 1 ? Number(dv.getBigUint64(0)) : dv.getUint32(0);
        if (secs > 0) { const t = new Date((secs - 2082844800) * 1000); if (t.getFullYear() > 1990 && t.getFullYear() < 2100) return t; }
      }
    }
    return null;
  };
  try { return await scan(0, 4 * 1024 * 1024) || (file.size > 4 * 1024 * 1024 ? await scan(file.size - 4 * 1024 * 1024, 4 * 1024 * 1024) : null); } catch { return null; }
}

function videoFrame(file) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = r => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(r); };
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3); };
    v.onseeked = () => finish({ el: v, w: v.videoWidth, h: v.videoHeight, duration: v.duration });
    v.onerror = () => finish(null);
    setTimeout(() => finish(v.videoWidth ? { el: v, w: v.videoWidth, h: v.videoHeight, duration: v.duration } : null), 15000);
  });
}

// Everything we can learn on this device before uploading: dates, camera, size, thumbnail, preview, hashes.
export async function inspect(file) {
  const info = { name: file.name, mime: file.type || (isHeic(file) ? 'image/heic' : isVideo(file) ? 'video/mp4' : 'application/octet-stream'), size: file.size, type: isVideo(file) ? 'video' : 'image', hash: await quickHash(file) };
  let taken = null;
  if (info.type === 'image') {
    try {
      const exifr = (await import('../vendor/exifr.mjs')).default;
      const x = await exifr.parse(file, { tiff: true, exif: true, gps: true, ifd1: false, xmp: false, icc: false, iptc: false, translateValues: true, reviveValues: true });
      if (x) {
        taken = x.DateTimeOriginal || x.CreateDate || x.ModifyDate || null;
        info.camera = [x.Make, x.Model].filter(Boolean).join(' ').trim() || undefined;
        if (typeof x.latitude === 'number') info.gps = [+x.latitude.toFixed(5), +x.longitude.toFixed(5)];
        if (x.ExifImageWidth) { info.width = x.ExifImageWidth; info.height = x.ExifImageHeight; }
      }
    } catch {}
    try {
      const img = await decodeImage(file);
      const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
      info.width = w; info.height = h;
      info.thumb = (await scaled(img, w, h, 400, .78)).blob;
      if (Math.max(w, h) > 400) info.preview = (await scaled(img, w, h, 2048, .86)).blob;
      info.phash = dhash(img, w, h);
      if (img.close) img.close();
    } catch { info.noPreview = true; }
  } else {
    taken = await mp4Created(file);
    const f = await videoFrame(file);
    if (f) {
      info.width = f.w; info.height = f.h; info.duration = Math.round(f.duration * 10) / 10;
      try { info.thumb = (await scaled(f.el, f.w, f.h, 400, .78)).blob; info.preview = (await scaled(f.el, f.w, f.h, 1280, .82)).blob; info.phash = dhash(f.el, f.w, f.h); } catch { info.noPreview = true; }
    } else info.noPreview = true;
  }
  const t = taken instanceof Date && !isNaN(taken) ? taken : new Date(file.lastModified || Date.now());
  info.taken = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 19);   // local time, no zone
  info.dateSource = taken ? 'meta' : 'file';
  return info;
}
