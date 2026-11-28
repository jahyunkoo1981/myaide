// 사용 승인: 관리자(구자현)만 가진 '관리자 키'로 서명한 승인 코드가 있어야 MY AIDE를 쓸 수 있습니다.
// - 승인 코드는 그 사람의 Google 이메일에 묶여 있어 다른 계정에서는 동작하지 않습니다.
// - 사용 중지한 코드 번호는 웹의 revoked.json에 올라가고, 앱은 인터넷에 연결될 때 확인합니다 (이메일은 공개되지 않음).
// - config.js에 adminPublicKey가 비어 있으면 승인 확인을 하지 않습니다(기존 사용 그대로).
// 서버가 없어서 앱 안에서 확인하므로, 프로그램을 고칠 줄 아는 사람은 우회할 수 있습니다(데이터·요금은 각자 것).
import * as db from './db.js';
import * as vault from './vault.js';
import { native } from './native.js';
import { auth } from './auth.js';

const cfg = () => window.MYAIDE_CONFIG || {};
export const enabled = () => !!cfg().adminPublicKey;
const ALG = { name: 'ECDSA', namedCurve: 'P-256' }, SIG = { name: 'ECDSA', hash: 'SHA-256' };
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const enc = s => new TextEncoder().encode(s);

// ---------- 관리자 키 ----------
const ADMIN_SECRET = 'admin-license-key';
export async function isAdmin() {
  if (!vault.isOpen()) return false;
  const k = await vault.getSecret(ADMIN_SECRET).catch(() => null);
  if (!k) return false;
  if (!enabled()) return true;
  try { return JSON.parse(k).pub === cfg().adminPublicKey; } catch { return false; }
}
export async function adminKey() { const k = await vault.getSecret(ADMIN_SECRET).catch(() => null); return k ? JSON.parse(k) : null; }
export async function createAdminKey() {
  const kp = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  await vault.setSecret(ADMIN_SECRET, JSON.stringify({ priv, pub }));
  return pub;
}
async function publicKey() { return crypto.subtle.importKey('raw', unb64u(cfg().adminPublicKey), ALG, false, ['verify']); }

// ---------- 승인 코드 ----------
// 형식: MYAIDE-<내용>.<서명>   내용 = { id, e(이메일), n(이름), t(만든 날) }
export async function issue(email, name) {
  const k = await adminKey(); if (!k) throw new Error('관리자 키가 없습니다.');
  const key = await crypto.subtle.importKey('jwk', k.priv, ALG, false, ['sign']);
  const body = { id: b64u(crypto.getRandomValues(new Uint8Array(6))), e: String(email || '').trim().toLowerCase(), n: String(name || '').trim().slice(0, 40), t: new Date().toISOString().slice(0, 10) };
  const p = b64u(enc(JSON.stringify(body)));
  return { ...body, code: `MYAIDE-${p}.${b64u(await crypto.subtle.sign(SIG, key, enc(p)))}` };
}
export async function verify(code) {
  const m = /^MYAIDE-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(code || '').replace(/\s+/g, ''));
  if (!m) throw new Error('승인 코드 형식이 아닙니다. MYAIDE- 로 시작하는 코드를 그대로 붙여 넣어 주세요.');
  const ok = await crypto.subtle.verify(SIG, await publicKey(), unb64u(m[2]), enc(m[1])).catch(() => false);
  if (!ok) throw new Error('승인 코드가 맞지 않습니다. 받은 코드를 다시 확인해 주세요.');
  return JSON.parse(new TextDecoder().decode(unb64u(m[1])));
}

// ---------- 내 Google 이메일 ----------
export async function myEmail({ interactive = false } = {}) {
  const cached = localStorage.getItem('myaide.email');
  if (await db.kvGet('mode') !== 'drive') return cached || '';
  try {
    const t = await auth.token();
    const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + t } });
    if (r.ok) { const j = await r.json(); if (j.email) { localStorage.setItem('myaide.email', j.email.toLowerCase()); return j.email.toLowerCase(); } }
    if ((r.status === 401 || r.status === 403) && interactive) {
      // 예전 로그인에는 '이메일 보기' 권한이 없음 → 한 번 더 동의
      if (native.available) { await native.call('auth.reconsent'); return myEmail(); }
      await auth.signIn(); return '';   // 웹: Google 화면으로 갔다가 돌아옴
    }
  } catch { }
  return cached || '';
}

// ---------- 저장된 내 승인 ----------
// settings/license 로 Drive에 동기화되어 새 기기에서도 다시 넣을 필요 없음
export async function saved() { return (await db.get('settings', 'license').catch(() => null)) || null; }
export async function save(code, info) { await db.put('settings', 'license', { code, id: info.id, e: info.e, n: info.n, at: Date.now() }); }

async function revokedIds() {
  const url = (cfg().publicUrl || location.origin + location.pathname.replace(/[^/]*$/, '')) + 'revoked.json';
  try {
    const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); localStorage.setItem('myaide.revoked', JSON.stringify(j.ids || [])); return j.ids || []; }
  } catch { }
  try { return JSON.parse(localStorage.getItem('myaide.revoked') || '[]'); } catch { return []; }
}

// 결과: { ok: true } | { ok: false, reason: 'none' | 'email' | 'revoked' | 'bad', email, info }
export async function check() {
  if (!enabled()) return { ok: true };
  if (await isAdmin()) return { ok: true, admin: true };
  const email = await myEmail({ interactive: true });
  const s = await saved();
  if (!s || !s.code) return { ok: false, reason: 'none', email };
  let info;
  try { info = await verify(s.code); } catch { return { ok: false, reason: 'bad', email }; }
  if (email && info.e && info.e !== email) return { ok: false, reason: 'email', email, info };
  if ((await revokedIds()).includes(info.id)) return { ok: false, reason: 'revoked', email, info };
  return { ok: true, info };
}
export async function recheckRevoked() {
  if (!enabled() || await isAdmin()) return true;
  const s = await saved(); if (!s) return false;
  return !(await revokedIds()).includes(s.id);
}

// ---------- 관리자: 사용 중지 목록을 웹(GitHub)에 올리기 ----------
const REPO = () => cfg().githubRepo || 'jahyunkoo1981/myaide';
export async function publishRevoked(ids) {
  const token = await vault.getSecret('github').catch(() => null);
  if (!token) throw Object.assign(new Error('GitHub 토큰이 없습니다.'), { needToken: true });
  const h = { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' };
  const api = `https://api.github.com/repos/${REPO()}/contents/revoked.json`;
  let sha;
  const g = await fetch(api, { headers: h });
  if (g.ok) sha = (await g.json()).sha; else if (g.status === 401) throw Object.assign(new Error('GitHub 토큰이 맞지 않습니다.'), { needToken: true });
  const content = btoa(unescape(encodeURIComponent(JSON.stringify({ ids, updated: new Date().toISOString() }, null, 1))));
  const r = await fetch(api, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'MY AIDE: 사용 중지 목록 갱신', content, ...(sha ? { sha } : {}) }) });
  if (!r.ok) throw new Error('GitHub에 올리지 못했습니다 (' + r.status + ').');
}
