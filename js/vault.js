// Account vault: passwords and API keys are encrypted on the device (AES-GCM, key from PBKDF2-SHA256)
// before they are saved or synced. Google Drive only ever stores ciphertext.
import * as db from './db.js';

const ITER = 310000;
const te = new TextEncoder(), td = new TextDecoder();
let key = null, lockTimer = null;
export const vaultEvents = new EventTarget();

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function derive(password, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function encWith(k, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, te.encode(JSON.stringify(value)));
  return { iv: b64(iv), ct: b64(ct) };
}
async function decWith(k, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, k, unb64(box.ct));
  return JSON.parse(td.decode(pt));
}

export async function exists() { return !!(await db.get('vault', 'main')); }
export function isOpen() { return !!key; }

// The vault stays open for the signed-in session; main.js locks it on 잠금 or after long inactivity.
function touch() { clearTimeout(lockTimer); }

export async function create(password) {
  if (!password || password.length < 6) throw new Error('비밀번호는 6자 이상으로 정해 주세요.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const k = await derive(password, salt);
  await db.put('vault', 'main', { salt: b64(salt), check: await encWith(k, 'myaide-ok'), iter: ITER });
  key = k; touch();
  vaultEvents.dispatchEvent(new Event('change'));
}

export async function unlock(password) {
  const meta = await db.get('vault', 'main');
  if (!meta) throw new Error('비밀번호가 아직 없습니다.');
  const k = await derive(password, unb64(meta.salt));
  try { if (await decWith(k, meta.check) !== 'myaide-ok') throw 0; }
  catch { throw new Error('비밀번호가 맞지 않습니다.'); }
  key = k; touch();
  vaultEvents.dispatchEvent(new Event('change'));
}

// Desktop widgets run in their own windows: the main window hands them the open key through the app (memory only).
export async function exportSession() { return key ? b64(await crypto.subtle.exportKey('raw', key)) : null; }
export async function importSession(raw) {
  key = raw ? await crypto.subtle.importKey('raw', unb64(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']) : null;
  vaultEvents.dispatchEvent(new Event('change'));
}

export function lock() { key = null; clearTimeout(lockTimer); vaultEvents.dispatchEvent(new Event('change')); }

export async function seal(value) {
  if (!key) throw new Error('잠겨 있습니다. 다시 로그인해 주세요.');
  touch();
  return encWith(key, value);
}
export async function open(box) {
  if (!key) throw new Error('잠겨 있습니다. 다시 로그인해 주세요.');
  touch();
  return decWith(key, box);
}

// Change the password: re-encrypt every sealed record with the new key.
export async function changePassword(oldPw, newPw) {
  await unlock(oldPw);
  const accounts = await db.all('accounts');
  const secrets = await db.all('secrets');
  const plainA = await Promise.all(accounts.map(async a => ({ id: a.id, v: await open(a.box) })));
  const plainS = await Promise.all(secrets.map(async s => ({ id: s.id, v: await open(s.box) })));
  await create(newPw);
  for (const a of plainA) await db.put('accounts', a.id, { box: await seal(a.v) });
  for (const s of plainS) await db.put('secrets', s.id, { box: await seal(s.v) });
}

// Forgotten password: nothing can be decrypted, so sealed data is deleted and a new vault starts.
export async function reset(newPw) {
  for (const a of await db.all('accounts')) await db.remove('accounts', a.id);
  for (const s of await db.all('secrets')) await db.remove('secrets', s.id);
  await create(newPw);
}

export async function getSecret(id) {
  const r = await db.get('secrets', id);
  if (!r) return null;
  return open(r.box);
}
export async function setSecret(id, value) {
  if (!value) { await db.remove('secrets', id); return; }
  await db.put('secrets', id, { box: await seal(value) });
}
