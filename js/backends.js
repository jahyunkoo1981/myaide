// Storage backends. Both expose the same small interface used by sync.js:
//   init()                         prepare folders
//   listChanged(cursor)            -> { items: [{ fileId, key, u, d }], cursor }
//   read(fileId)                   -> record JSON { col, id, data, updatedAt, deleted }
//   write(rec, fileId)             -> fileId
//   putBlob(id, blob) / getBlob(id)
//   saveBackup(name, blob) / listBackups() / deleteFile(fileId)
//
// Drive layout (My Drive):  MY AIDE/records/<col>--<id>.json   MY AIDE/files/<blob id>   MY AIDE/backups/*.json
// Each record file carries appProperties { k: "col/id", u: updatedAt, d: "1" if deleted } so changes can be
// listed without downloading every file.
import { kvGet, kvSet } from './db.js';
import { native } from './native.js';

const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const EPOCH = '1970-01-01T00:00:00.000Z';

export class DriveBackend {
  constructor(token) { this.token = token; this.kind = 'drive'; }

  async req(url, opts = {}, as = 'json') {
    const t = await this.token();
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
    if (res.status === 401) throw Object.assign(new Error('Google 연결이 만료되었습니다.'), { auth: true });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
      throw Object.assign(new Error('Google Drive 오류 (' + res.status + '): ' + msg), { status: res.status });
    }
    if (as === 'blob') return res.blob();
    if (as === 'none' || res.status === 204) return null;
    return res.json();
  }

  async findOrCreate(name, role, parent) {
    const q = `appProperties has { key='myaide' and value='${role}' } and mimeType='${FOLDER}' and trashed=false`;
    const r = await this.req(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`);
    if (r.files && r.files.length) return r.files[0].id;
    const meta = { name, mimeType: FOLDER, appProperties: { myaide: role } };
    if (parent) meta.parents = [parent];
    const c = await this.req(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
    return c.id;
  }

  async init() {
    let ids = await kvGet('drive.folders');
    if (!ids) {
      const root = await this.findOrCreate('MY AIDE', 'root');
      ids = {
        root,
        records: await this.findOrCreate('records', 'records', root),
        files: await this.findOrCreate('files', 'files', root),
        backups: await this.findOrCreate('backups', 'backups', root)
      };
      await kvSet('drive.folders', ids);
    }
    this.folders = ids;
  }

  async upload(meta, body, mime, fileId) {
    const b = 'myaide' + Math.random().toString(36).slice(2);
    const payload = new Blob([
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`,
      body, `\r\n--${b}--`
    ]);
    const url = fileId ? `${UP}/files/${fileId}?uploadType=multipart&fields=id` : `${UP}/files?uploadType=multipart&fields=id`;
    const r = await this.req(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body: payload });
    return r.id;
  }

  async listChanged(cursor) {
    const since = cursor || EPOCH;
    const q = `'${this.folders.records}' in parents and trashed=false and modifiedTime >= '${since}'`;
    const items = [];
    let pageToken = '', max = since;
    do {
      const r = await this.req(`${API}/files?q=${encodeURIComponent(q)}&pageSize=1000&fields=nextPageToken,files(id,appProperties,modifiedTime)` + (pageToken ? '&pageToken=' + pageToken : ''));
      for (const f of r.files || []) {
        const a = f.appProperties || {};
        if (!a.k) continue;
        items.push({ fileId: f.id, key: a.k, u: Number(a.u) || 0, d: a.d === '1' });
        if (f.modifiedTime > max) max = f.modifiedTime;
      }
      pageToken = r.nextPageToken || '';
    } while (pageToken);
    return { items, cursor: max };
  }

  async read(fileId) { return this.req(`${API}/files/${fileId}?alt=media`); }

  async write(rec, fileId) {
    const meta = { appProperties: { k: rec.col + '/' + rec.id, u: String(rec.updatedAt), d: rec.deleted ? '1' : '0' } };
    if (!fileId) { meta.name = `${rec.col}--${rec.id}.json`; meta.parents = [this.folders.records]; meta.mimeType = 'application/json'; }
    const body = JSON.stringify({ col: rec.col, id: rec.id, data: rec.data, updatedAt: rec.updatedAt, deleted: !!rec.deleted });
    return this.upload(meta, body, 'application/json', fileId);
  }

  async findBlob(id) {
    const q = `appProperties has { key='b' and value='${id.replace(/'/g, '')}' } and trashed=false`;
    const r = await this.req(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)`);
    return r.files && r.files[0] ? r.files[0].id : null;
  }
  async putBlob(id, blob, name) {
    const existing = await this.findBlob(id);
    const meta = existing ? {} : { name: name || id, parents: [this.folders.files], appProperties: { b: id } };
    return this.upload(meta, blob, blob.type || 'application/octet-stream', existing);
  }
  async getBlob(id) {
    const fileId = await this.findBlob(id);
    if (!fileId) throw new Error('Drive에서 파일을 찾지 못했습니다.');
    return this.req(`${API}/files/${fileId}?alt=media`, {}, 'blob');
  }

  async saveBackup(name, blob) {
    return this.upload({ name, parents: [this.folders.backups], appProperties: { myaide: 'backup' } }, blob, blob.type || 'application/json');
  }
  async listBackups() {
    const q = `'${this.folders.backups}' in parents and trashed=false`;
    const r = await this.req(`${API}/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&fields=files(id,name,createdTime,size)`);
    return (r.files || []).map(f => ({ fileId: f.id, name: f.name, time: f.createdTime, size: Number(f.size) || 0 }));
  }
  async readBackup(fileId) { return this.req(`${API}/files/${fileId}?alt=media`, {}, 'blob'); }
  async deleteFile(fileId) { await this.req(`${API}/files/${fileId}`, { method: 'DELETE' }, 'none'); }
  describe() { return 'Google Drive › 내 드라이브 › MY AIDE'; }
}

// Windows app "이 PC에만 저장" mode: the same files, kept in a local folder (works on networks without internet).
export class LocalFolderBackend {
  constructor() { this.kind = 'local'; }
  async init() { this.info = await native.call('store.init'); }
  async listChanged(cursor) { return native.call('store.list', { since: cursor || '' }); }
  async read(fileId) { return JSON.parse(await native.call('store.read', { fileId })); }
  async write(rec, fileId) {
    const body = JSON.stringify({ col: rec.col, id: rec.id, data: rec.data, updatedAt: rec.updatedAt, deleted: !!rec.deleted });
    return native.call('store.write', { key: rec.col + '/' + rec.id, u: rec.updatedAt, d: !!rec.deleted, body, fileId: fileId || '' });
  }
  async putBlob(id, blob) {
    const b64 = await blobToBase64(blob);
    return native.call('store.putBlob', { id, type: blob.type, data: b64 });
  }
  async getBlob(id) {
    const r = await native.call('store.getBlob', { id });
    return base64ToBlob(r.data, r.type);
  }
  async saveBackup(name, blob) { return native.call('store.saveBackup', { name, data: await blobToBase64(blob) }); }
  async listBackups() { return native.call('store.listBackups'); }
  async readBackup(fileId) { const r = await native.call('store.readBackup', { fileId }); return base64ToBlob(r.data, 'application/json'); }
  async deleteFile(fileId) { return native.call('store.deleteBackup', { fileId }); }
  describe() { return this.info && this.info.path ? this.info.path : '이 PC의 MY AIDE 데이터 폴더'; }
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}
