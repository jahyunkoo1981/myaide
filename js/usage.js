// AI 사용량·요금: 단가표, 보내기 전 예상 금액 확인, 실제 사용 토큰 기록.
// 기록은 'usage' 모음에 "월-기기" 단위로 저장되어 Drive로 동기화됩니다(PC·폰 합계를 함께 봄).
// 금액은 MY AIDE가 계산한 추정치입니다. 실제 청구액은 각 회사 콘솔의 Usage 화면이 기준입니다.
import { h, dialog, uid } from './util.js';
import * as db from './db.js';
import { prefs, save as savePrefs, device } from './prefs.js';
import { native } from './native.js';
import * as privacy from './privacy.js';

// USD per 1M tokens [입력, 출력]. 2026-11 기준 공개 단가. 설정에서 모델별로 고칠 수 있습니다.
const after2027 = () => Date.now() >= Date.UTC(2027, 0, 1);
export const BASE_PRICES = [
  // OpenAI
  [/^gpt-5\.6-sol|^gpt-5\.6$/, () => [5, 30]],
  [/^gpt-5\.6-terra/, () => [2, 12]],
  [/^gpt-5\.6-luna/, () => [0.2, 1.2]],
  [/^gpt-5\.5-pro/, () => [30, 180]],
  [/^gpt-5\.5/, () => [5, 30]],
  [/^gpt-5\.4-mini/, () => [0.75, 4.5]],
  [/^gpt-5\.4-nano/, () => [0.2, 1.25]],
  [/^gpt-4o-mini-transcribe/, () => [1.25, 5]],
  [/^gpt-4o-mini/, () => [0.15, 0.6]],
  [/^gpt-4o/, () => [2.5, 10]],
  [/^text-embedding-3-small/, () => [0.02, 0]],
  // Anthropic
  [/^claude-opus-5-5/, () => [4, 20]],
  [/^claude-opus/, () => [5, 25]],
  [/^claude-sonnet/, () => [2, 10]],
  [/^claude-haiku-5-5/, (inTok) => inTok > 100000 ? [0.5, 2.5] : [0.1, 0.5]],
  [/^claude-haiku/, () => [1, 5]],
  [/^claude-fable|^claude-mythos/, () => [10, 50]],
  // Google
  [/^gemini-3\.[67]-flash(?!-lite)/, () => after2027() ? [1.5, 7.5] : [0.75, 3.75]],
  [/^gemini-3\.5-flash-lite/, () => [0.15, 1.25]],
  [/^gemini-3\.5-flash/, () => [1.5, 9]],
  [/^gemini-.*-pro/, (inTok) => inTok > 200000 ? [4, 18] : [2, 12]],
  [/^gemini-.*flash-lite/, () => [0.25, 1.5]],
  [/^gemini/, () => [1.5, 7.5]]
];
const PER_MIN_TRANSCRIBE = 0.003;   // USD per audio minute (gpt-4o-mini-transcribe)

// Returns { in, out, known } — USD per 1M tokens.
export function priceFor(model, inTok = 0) {
  const o = (prefs().aiPrices || {})[model];
  if (o && o.length === 2) return { in: +o[0], out: +o[1], known: true, custom: true };
  const hit = BASE_PRICES.find(([re]) => re.test(model || ''));
  if (hit) { const [i, x] = hit[1](inTok); return { in: i, out: x, known: true }; }
  return { in: 5, out: 30, known: false };   // 모르는 모델은 비싼 쪽으로 잡아 둠
}
export const rate = () => +prefs().usdKrw || 1350;
export const usd = (model, inTok, outTok) => { const p = priceFor(model, inTok); return (inTok * p.in + outTok * p.out) / 1e6; };
export function krw(usdAmount) {
  const v = usdAmount * rate();
  if (v === 0) return '0원';
  if (v < 0.1) return '0.1원 미만';
  if (v < 10) return v.toFixed(1).replace(/\.0$/, '') + '원';
  return Math.round(v).toLocaleString('ko-KR') + '원';
}
export const fmtTok = n => (Math.round(n) || 0).toLocaleString('ko-KR');

// ---------- token estimate (before sending) ----------
// 한글은 글자당 약 1토큰, 영문·숫자·기호는 약 4글자당 1토큰. 쓸수록 실제 값으로 보정됩니다.
export function countText(s) {
  s = String(s || '');
  const hangul = (s.match(/[ㄱ-ㆎ가-힣]/g) || []).length;
  return Math.ceil(hangul * 0.95 + (s.length - hangul) / 3.8);
}
export function estimateMessages(messages) {
  let n = 0, images = 0;
  for (const m of messages) {
    n += 4;
    if (typeof m.content === 'string') n += countText(m.content);
    else for (const c of m.content || []) { if (c.type === 'text') n += countText(c.text); else { images++; n += 300; } }
  }
  return { tokens: n, images };
}
async function calib(provider) { const c = await db.kvGet('usage-calib', {}); return c[provider] || 1; }
async function learn(provider, estimated, actual) {
  if (!(estimated > 50 && actual > 0)) return;
  const c = await db.kvGet('usage-calib', {}), r = Math.min(3, Math.max(0.3, actual / estimated));
  c[provider] = c[provider] ? c[provider] * 0.7 + r * 0.3 : r;
  await db.kvSet('usage-calib', c);
}
async function outAvg(kind) { const a = await db.kvGet('usage-out', {}); return a[kind]; }
async function learnOut(kind, n) {
  if (!(n > 0)) return;
  const a = await db.kvGet('usage-out', {}); a[kind] = a[kind] ? Math.round(a[kind] * 0.7 + n * 0.3) : n;
  await db.kvSet('usage-out', a);
}
const OUT_HINT = { chat: 700, summary: 1500, mindmap: 1200, code: 2500, vision: 150, embed: 0 };

// ---------- records ----------
const month = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
function deviceId() { let id = device.get('id'); if (!id) { id = uid(); device.set('id', id); } return id; }
const deviceName = () => native.available ? 'PC' : (/iPhone|Android.+Mobile/.test(navigator.userAgent) ? '폰' : /iPad|Android/.test(navigator.userAgent) ? '태블릿' : '브라우저');
export const usageEvents = new EventTarget();
const KIND_LABEL = { chat: 'AIDE 대화', summary: '회의 요약', mindmap: '마인드맵', code: 'VisualCode', vision: '사진 설명', embed: '의미 검색', transcribe: '받아쓰기' };
export const kindLabel = k => KIND_LABEL[k] || k || '기타';

let queue = Promise.resolve();
export function record(e) {
  // e: { provider, model, kind, inTok, outTok, usd, estUsd?, seconds? }
  const at = Date.now(), id = `${month(at)}-${deviceId()}`;
  e = { at, ...e };
  queue = queue.then(async () => {
    const r = (await db.get('usage', id)) || { month: month(at), device: deviceName(), total: { calls: 0, inTok: 0, outTok: 0, usd: 0 }, byModel: {}, byKind: {}, recent: [] };
    const add = (o) => { o.calls = (o.calls || 0) + 1; o.inTok = (o.inTok || 0) + (e.inTok || 0); o.outTok = (o.outTok || 0) + (e.outTok || 0); o.usd = (o.usd || 0) + (e.usd || 0); };
    add(r.total);
    add(r.byModel[e.model] = r.byModel[e.model] || { provider: e.provider });
    add(r.byKind[e.kind] = r.byKind[e.kind] || {});
    r.recent = [e, ...(r.recent || [])].slice(0, 60);
    r.device = deviceName();
    await db.put('usage', id, r);
  }).catch(() => {});
  usageEvents.dispatchEvent(new CustomEvent('call', { detail: e }));
  return queue;
}
// 한 달 합계 (모든 기기)
export async function monthTotal(m = month()) {
  const rows = (await db.all('usage')).filter(r => r.month === m);
  const t = { calls: 0, inTok: 0, outTok: 0, usd: 0, byModel: {}, byKind: {}, byDevice: [], recent: [] };
  for (const r of rows) {
    for (const k of ['calls', 'inTok', 'outTok', 'usd']) t[k] += r.total[k] || 0;
    for (const [name, v] of Object.entries(r.byModel || {})) { const o = t.byModel[name] = t.byModel[name] || { provider: v.provider, calls: 0, inTok: 0, outTok: 0, usd: 0 }; for (const k of ['calls', 'inTok', 'outTok', 'usd']) o[k] += v[k] || 0; }
    for (const [name, v] of Object.entries(r.byKind || {})) { const o = t.byKind[name] = t.byKind[name] || { calls: 0, usd: 0 }; o.calls += v.calls || 0; o.usd += v.usd || 0; }
    t.byDevice.push({ device: r.device, usd: r.total.usd, calls: r.total.calls });
    t.recent.push(...(r.recent || []).map(x => ({ ...x, device: r.device })));
  }
  t.recent.sort((a, b) => b.at - a.at);
  return t;
}
export async function months() { return [...new Set((await db.all('usage')).map(r => r.month))].sort().reverse(); }

// ---------- ask before sending ----------
export class Cancelled extends Error { constructor() { super('요청을 취소했습니다. 사용료는 나가지 않았습니다.'); this.cancelled = true; } }

// est: { provider, model, kind, inTok, outTok, usd, count?, note? }
export async function confirmCost(est) {
  const p = prefs(), budget = +p.aiBudget || 0, mode = p.aiAsk || 'always', limit = +p.aiAskOver || 0;
  const spent = (await monthTotal()).usd, estKrw = est.usd * rate(), spentKrw = spent * rate();
  const over = budget > 0 && spentKrw + estKrw > budget;
  if (!over && !est.trainRisk && (mode === 'never' || (mode === 'over' && estKrw <= limit))) return true;
  const price = priceFor(est.model, est.inTok);
  const skip = h('input', { type: 'checkbox' });
  const row = (k, v, sub) => h('div', { class: 'cost-row' }, h('span', null, k), h('b', null, v), sub ? h('small', null, sub) : null);
  const body = h('div', { class: 'cost-box' },
    h('div', { class: 'cost-big' }, h('small', null, est.count > 1 ? `${est.count}건 예상 금액` : '이번 요청 예상 금액'), h('strong', null, '약 ' + krw(est.usd)),
      est.maxUsd ? h('small', null, `답변이 길어지면 최대 약 ${krw(est.maxUsd)}`) : null),
    row('AI · 모델', est.model, est.provider === 'openai' ? 'OpenAI' : est.provider === 'anthropic' ? 'Claude' : est.provider === 'gemini' ? 'Gemini' : ''),
    est.seconds ? row('녹음 길이', `${Math.round(est.seconds / 60 * 10) / 10}분`, `분당 ${PER_MIN_TRANSCRIBE}달러`) :
      row('토큰', `입력 약 ${fmtTok(est.inTok)} + 답변 약 ${fmtTok(est.outTok)}`, `단가 100만 토큰당 입력 $${price.in} · 출력 $${price.out}${price.known ? '' : ' (모르는 모델이라 높게 잡음)'}`),
    row('이번 달 사용', `${krw(spent)}${budget ? ` / 한도 ${budget.toLocaleString('ko-KR')}원` : ''}`),
    over ? h('p', { class: 'error', style: { margin: 0 } }, '이 요청을 보내면 MY AIDE에 정한 월 한도를 넘습니다.') : null,
    est.note ? h('p', { class: 'hint', style: { margin: 0 } }, est.note) : null,
    est.trainRisk ? h('div', { class: 'priv-warn' }, h('b', null, '학습 위험'), ' 이 Gemini 키가 무료 등급이면 보낸 내용이 Google 서비스 개선(학습)에 쓰일 수 있습니다. 결제를 연결한 유료 키라면 설정 › AI 정보 보호에서 ‘유료 등급’을 체크하세요.') : null,
    est.privacy ? previewBox(est.privacy) : null,
    !over ? h('label', { class: 'check', style: { fontSize: '13px' } }, skip, `앞으로 ${Math.max(10, Math.ceil(estKrw / 10) * 10)}원 이하는 묻지 않기`) : null);
  const r = await dialog({ title: 'AI 사용료 확인', body, actions: [{ label: '취소', value: false }, { label: over ? '한도를 넘어도 보내기' : '보내기', kind: over ? 'danger' : 'primary', value: true }],
    onOpen: d => d.querySelector('.btn.primary,.btn.danger')?.focus() });
  if (r === true && skip.checked) await savePrefs({ aiAsk: 'over', aiAskOver: Math.max(10, Math.ceil(estKrw / 10) * 10) });
  return r === true;
}

// 보낼 내용 미리 보기 (가린 표시는 색으로, 원문 보기 전환, 선택한 글자 더 가리기)
function previewBox(priv) {
  let showOriginal = false;
  const info = h('div', { class: 'priv-info' });
  const box = h('div', { class: 'priv-prev', tabindex: '0', 'aria-label': '보낼 내용' });
  const textOf = c => typeof c === 'string' ? c : (c || []).map(x => x.type === 'text' ? x.text : '[사진]').join('\n');
  const paint = (el, s) => el.replaceChildren(...privacy.splitTokens(s).map((part, i) => i % 2 ? h('mark', { class: 'priv-tag' }, part) : part));
  const toggle = h('button', { class: 'btn small ghost', type: 'button' });
  const cat = h('select', { class: 'priv-cat', 'aria-label': '종류' }, privacy.CATS.map(c => h('option', { value: c, selected: c === '기타' }, c)));
  const err = h('small', { class: 'muted' });
  const draw = () => {
    const msgs = showOriginal ? priv.original : priv.messages;
    const sys = msgs.filter(m => m.role === 'system').map(m => textOf(m.content)).join('\n\n');
    const turns = msgs.filter(m => m.role !== 'system'), last = turns[turns.length - 1];
    const lastEl = h('div', { class: 'priv-last' }), sysEl = h('div', { class: 'priv-sys' }), histEl = h('div', { class: 'priv-sys' });
    paint(lastEl, last ? textOf(last.content) : '');
    paint(sysEl, sys);
    paint(histEl, turns.slice(0, -1).map(m => (m.role === 'assistant' ? 'AI: ' : '나: ') + textOf(m.content)).join('\n\n'));
    box.replaceChildren(...[lastEl,
      turns.length > 1 ? h('details', null, h('summary', null, `앞선 대화 ${turns.length - 1}개`), histEl) : null,
      sys ? h('details', null, h('summary', null, `지시문·참고 자료 (${sys.length.toLocaleString('ko-KR')}자)`), sysEl) : null].filter(Boolean));
    box.classList.toggle('orig', showOriginal);
    const t = privacy.infoText(priv.info);
    info.replaceChildren(...[h('span', { class: t ? 'ok' : 'none' }, t || '가릴 정보를 찾지 못했습니다'), showOriginal ? h('small', null, ' · 지금은 원문을 보는 중 (AI로는 가린 글이 갑니다)') : null].filter(Boolean));
    toggle.textContent = showOriginal ? '가린 글 보기' : '원문 보기';
  };
  toggle.onclick = () => { showOriginal = !showOriginal; draw(); };
  // 버튼을 누르는 순간 선택이 풀릴 수 있어서, 미리 보기 안에서 마지막으로 고른 글자를 기억해 둠
  let picked = '';
  const onSel = () => {
    if (!box.isConnected) return document.removeEventListener('selectionchange', onSel);
    const sel = window.getSelection();
    if (sel && sel.rangeCount && box.contains(sel.anchorNode)) picked = sel.toString().trim();
  };
  document.addEventListener('selectionchange', onSel);
  const add = h('button', { class: 'btn small', type: 'button', onmousedown: e => e.preventDefault(), onclick: async () => {
    const s = (window.getSelection()?.toString() || '').trim() || picked;
    if (!s) { err.textContent = '위 글에서 가릴 부분을 마우스로 끌어 선택한 뒤 누르세요.'; return; }
    if (s.length > 60) { err.textContent = '60자 이하로 선택해 주세요.'; return; }
    if (!await priv.addWord(s, cat.value)) { err.textContent = '이미 가린 표시는 다시 가릴 수 없습니다.'; return; }
    picked = ''; err.textContent = `‘${s}’을(를) ${cat.value}(으)로 등록했습니다. 다음부터 자동으로 가립니다.`; showOriginal = false; draw();
  } }, '선택한 글자 가리기');
  draw();
  return h('div', { class: 'priv-wrap' }, h('div', { class: 'row', style: { gap: '6px' } }, info, h('span', { class: 'grow' }), toggle),
    box, h('div', { class: 'row', style: { gap: '6px' } }, cat, add, err));
}

// Build an estimate for a chat call, ask, and return a finisher that records the real usage.
export async function guardChat({ provider, model, kind = 'chat', messages, ask = true, outHint, privacy: priv, trainRisk }) {
  const raw = estimateMessages(messages), inTok = Math.ceil(raw.tokens * await calib(provider));
  // 답변 길이: 직접 준 값 → 이 기능에서 실제로 나온 평균(쓸수록 정확) → 기본값
  const outTok = outHint ?? (await outAvg(kind)) ?? OUT_HINT[kind] ?? 700;
  const est = { provider, model, kind, inTok, outTok, usd: usd(model, inTok, outTok), maxUsd: kind === 'vision' || kind === 'embed' ? 0 : usd(model, inTok, outTok * 4), privacy: priv || null, trainRisk: !!trainRisk };
  if (ask && !await confirmCost(est)) throw new Cancelled();
  return (u) => {   // u: { inTok, outTok } from the reply (missing → estimate)
    const real = u && (u.inTok || u.outTok);
    const e = { provider, model, kind, inTok: real ? u.inTok : inTok, outTok: real ? u.outTok : outTok, estimated: !real };
    e.usd = usd(model, e.inTok, e.outTok); e.estUsd = est.usd;
    if (real) { learn(provider, raw.tokens, u.inTok); if (outHint == null) learnOut(kind, u.outTok); }
    record(e);
    return e;
  };
}
export function transcribeCost(seconds) { return (seconds / 60) * PER_MIN_TRANSCRIBE; }
export async function guardTranscribe({ model, seconds, ask = true }) {
  const est = { provider: 'openai', model, kind: 'transcribe', inTok: 0, outTok: 0, seconds, usd: transcribeCost(seconds || 60) };
  if (ask && !await confirmCost(est)) throw new Cancelled();
  return (u) => {
    const e = { provider: 'openai', model, kind: 'transcribe', inTok: u?.inTok || 0, outTok: u?.outTok || 0, seconds, estimated: !u };
    e.usd = u && (u.inTok || u.outTok) ? usd(model, u.inTok, u.outTok) : est.usd;
    record(e); return e;
  };
}
