// 영수증 학습
// ① 개인: 저장할 때 처음 읽은 값과 사용자가 고친 값을 비교해 기억 → 다음 영수증에 자동 적용.
//    - 가게 이름 바로잡기 (이마트 아산잠 → 이마트 아산점), 가게별 항목, 가게별 '합계' 줄 이름, 금액 숫자 오인식(B→8 등)
//    - 내 Google Drive(settings/ocrLearn)에 저장되어 폰·PC에서 같이 씀
// ② 공동: 참여에 동의한 사용자의 '규칙'만(가게 이름·항목·합계 줄 이름·글자 오인식) 익명으로 관리자 설문지에 보냄.
//    사진·금액·날짜·이메일은 보내지 않음. 관리자가 검토해 ocr-rules.json으로 올리면 모든 사용자가 받아 씀.
import * as db from './db.js';
import { prefs, save as savePrefs } from './prefs.js';

const REC = ['settings', 'ocrLearn'];
export const norm = s => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const pub = () => (window.MYAIDE_CONFIG || {}).publicUrl || location.origin + location.pathname.replace(/[^/]*$/, '');

export async function mine() { return (await db.get(...REC).catch(() => null)) || { stores: {}, conf: {} }; }
async function saveMine(m) { const { id, updatedAt, ...rest } = m; await db.put(...REC, rest); }

// ---------- 공동 규칙 (관리자가 올린 것, 하루 한 번 새로 받음) ----------
let sharedCache = null;
export async function shared() {
  if (sharedCache) return sharedCache;
  try {
    const c = JSON.parse(localStorage.getItem('myaide.ocrRules') || 'null');
    if (c && Date.now() - c.at < 86400000) return (sharedCache = c.rules);
  } catch { }
  try {
    const r = await fetch(pub() + 'ocr-rules.json?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) { const rules = await r.json(); localStorage.setItem('myaide.ocrRules', JSON.stringify({ at: Date.now(), rules })); return (sharedCache = rules); }
  } catch { }
  try { return (sharedCache = JSON.parse(localStorage.getItem('myaide.ocrRules') || 'null')?.rules || { stores: {}, totalKeys: [], conf: [] }); } catch { return { stores: {}, totalKeys: [], conf: [] }; }
}

// ---------- 비슷한 가게 찾기 (글자 1~2개 틀려도) ----------
function lev(a, b) {
  const m = a.length, n = b.length; if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
function findStore(stores, name) {
  const k = norm(name); if (!k) return null;
  if (stores[k]) return stores[k];
  let best = null, score = 0;
  for (const [key, v] of Object.entries(stores)) {
    if (key.length < 3 || Math.abs(key.length - k.length) > 2) continue;
    const s = 1 - lev(key, k) / Math.max(key.length, k.length);
    if (s > score) { score = s; best = v; }
  }
  return score >= 0.75 ? best : null;
}

// 읽기 전에 쓸 추가 규칙 (합계 줄 이름, 숫자 오인식)
export async function parseOptions() {
  const m = await mine(), s = await shared();
  const conf = [...Object.entries(m.conf || {}).filter(([, n]) => n >= 1).map(([k]) => k.split('>')), ...(s.conf || [])];
  return { totalKeys: [...new Set(Object.values(m.stores || {}).map(v => v.totalKey).filter(Boolean).concat(s.totalKeys || []))], conf };
}

// 읽은 결과에 학습한 내용 적용 → { fields, applied: ['가게 이름', '항목', ...] }
export async function apply(fields, rawText, parse) {
  const m = await mine(), s = await shared();
  const hit = findStore(m.stores || {}, fields.store) || findStore(s.stores || {}, fields.store);
  const applied = [];
  if (!hit) return { fields, applied };
  const out = { ...fields };
  if (hit.name && hit.name !== fields.store) { out.store = hit.name; applied.push('가게 이름'); }
  if (hit.cat) { out.category = hit.cat; applied.push('항목'); }
  if (hit.totalKey && parse) {
    const again = parse(rawText, { totalKeys: [hit.totalKey], strictFirst: true });
    if (again.amount && again.amount !== fields.amount) { out.amount = again.amount; applied.push('합계 금액'); }
  }
  return { fields: out, applied };
}

// ---------- 저장할 때: 고친 내용을 비교해서 기억 ----------
const CONFUSABLE = /[OoDQlI|!SsBZzgqG]/;
function learnConfusions(raw, amount) {
  const want = String(amount), pairs = [];
  for (const tok of raw.match(/[0-9OoDQlI|!SsBZzgqG][0-9OoDQlI|!SsBZzgqG,.]{2,}/g) || []) {
    const t = tok.replace(/[,.]/g, '');
    if (t.length !== want.length || !CONFUSABLE.test(t) || /^[A-Za-z]+$/.test(t)) continue;
    let ok = true; const ps = [];
    for (let i = 0; i < t.length; i++) { if (t[i] === want[i]) continue; if (/\d/.test(t[i])) { ok = false; break; } ps.push([t[i], want[i]]); }
    if (ok && ps.length && ps.length <= 2) { pairs.push(...ps); break; }
  }
  return pairs;
}
const LOOK = { O: '0', o: '0', D: '0', Q: '0', l: '1', I: '1', '|': '1', '!': '1', S: '5', s: '5', B: '8', Z: '2', z: '2', g: '9', q: '9', G: '6' };
const digitsish = line => line.replace(/\s/g, '').replace(/(?<=[\d,.])[OoDQlI|!SsBZzgqG]|[OoDQlI|!SsBZzgqG](?=[\d,.])/g, c => LOOK[c]);
function totalKeyFor(raw, amount) {
  const fmt = [Number(amount).toLocaleString('ko-KR'), String(amount)];
  for (const line of raw.split(/\r?\n/)) {
    if (!fmt.some(f => digitsish(line).includes(f))) continue;
    const words = (line.match(/[가-힣A-Za-z]{2,}/g) || []).filter(w => !/^(원|krw|won)$/i.test(w));
    if (words.length) return words.sort((a, b) => b.length - a.length)[0];
  }
  return null;
}
// before: 처음 읽은 값(학습 적용 전), after: 저장한 값 → 새로 배운 규칙(없으면 null)
export async function learn(before, after, rawText) {
  const m = await mine(); m.stores = m.stores || {}; m.conf = m.conf || {};
  const rule = { v: 1 };
  const name = (after.store || '').trim(), from = (before.store || '').trim();
  if (!name || name.length < 2) return null;
  const entry = { ...(findStore(m.stores, from) || findStore(m.stores, name) || {}) };
  if (from && norm(from) !== norm(name)) { rule.from = from; rule.name = name; }
  entry.name = name;
  if (after.cat && after.cat !== entry.cat) { entry.cat = after.cat; rule.cat = after.cat; rule.name = name; }
  if (after.amount && before.amount !== after.amount && rawText) {
    const tk = totalKeyFor(rawText, after.amount);
    if (tk) { entry.totalKey = tk; rule.tk = tk; rule.name = name; }
    const cf = learnConfusions(rawText, after.amount);
    cf.forEach(([a, b]) => { m.conf[a + '>' + b] = (m.conf[a + '>' + b] || 0) + 1; });
    if (cf.length) rule.cf = cf;
  }
  entry.n = (entry.n || 0) + 1; entry.at = Date.now();
  m.stores[norm(name)] = entry;
  if (from && norm(from) !== norm(name)) m.stores[norm(from)] = entry;   // 다음에 똑같이 잘못 읽어도 찾도록
  const keys = Object.keys(m.stores);
  if (keys.length > 600) keys.sort((a, b) => (m.stores[a].at || 0) - (m.stores[b].at || 0)).slice(0, keys.length - 600).forEach(k => delete m.stores[k]);
  await saveMine(m);
  return Object.keys(rule).length > 1 ? rule : null;
}

export async function forget(key) { const m = await mine(); const e = m.stores[key]; for (const [k, v] of Object.entries(m.stores)) if (k === key || (e && v.name === e.name)) delete m.stores[k]; await saveMine(m); }
export async function forgetAll() { await saveMine({ stores: {}, conf: {} }); }

// ---------- 공동 학습에 보내기 ----------
let community = null;
async function communityCfg() {
  if (community) return community;
  try { const r = await fetch(pub() + 'community.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) return (community = await r.json()); } catch { }
  return (community = {});
}
export async function canShare() { const c = await communityCfg(); return !!(c.formAction && c.entry); }
export async function contribute(rule) {
  if (!rule || prefs().ocrShare !== true) return false;
  const c = await communityCfg(); if (!c.formAction || !c.entry) return false;
  try { await fetch(c.formAction, { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ [c.entry]: JSON.stringify(rule) }) }); return true; } catch { return false; }
}
export async function setShare(on) { await savePrefs({ ocrShare: !!on }); }
