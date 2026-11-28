// AI 정보 보호: 보내기 직전에 민감한 단어·번호를 [회사1] 같은 표시로 바꾸고, 답이 오면 원래대로 되돌립니다.
// 대응표(드림텍 ↔ [회사1])는 이 기기 메모리/IndexedDB에만 있고 AI 회사로는 표시만 나갑니다.
import { prefs, save as savePrefs } from './prefs.js';

export const CATS = ['회사', '거래처', '사람', '시스템', '기타'];          // 직접 등록하는 단어 종류
const AUTO_CATS = ['전화', '이메일', '번호', '금액', '주소', '비밀'];
const ALL = [...CATS, ...AUTO_CATS];
const TOKEN_RE = new RegExp(`\\[(${ALL.join('|')})(\\d+)\\]`, 'g');

export const DEFAULT_MASK = { on: true, words: [], contact: true, money: true, secret: true, names: false };
export function maskPrefs() { return { ...DEFAULT_MASK, ...(prefs().aiMask || {}) }; }

// Gemini 무료 등급 키는 보낸 내용이 Google 서비스 개선에 쓰일 수 있음
export function trainRisk(provider) { return provider === 'gemini' && !prefs().aiGeminiPaid; }

export function newSession(style) { return { map: {}, next: {}, ...(style ? { style } : {}) }; }

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TITLES = '파트장|팀장|그룹장|센터장|실장|본부장|사업부장|프로|과장|대리|부장|차장|사원|주임|매니저|선임|책임|수석|이사|상무|전무|대표|사장|회장|님|씨';
const JOSA = '께서|께|한테|에게|이랑|랑|으로|로|이|가|은|는|을|를|과|와|도|의|만|님';
const NOT_NAMES = new Set(['담당자', '고객', '관리자', '작업자', '운영자', '사용자', '협력사', '업체', '여러분', '선생', '교수', '부서', '팀원', '모두', '다들', '우리', '해당', '현장']);

function rules(mp) {
  const r = [];
  if (mp.secret) {
    r.push(['비밀', /((?:password|passwd|pwd|pw|비밀번호|비번|암호)\s*[:=]\s*)([^\s,;'"]+)/gi, 2]);
    r.push(['비밀', /\b(?:sk-ant-|sk-|AIza|ghp_|github_pat_|xox[bpa]-)[A-Za-z0-9_\-]{12,}/g]);
    r.push(['비밀', /\b(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{32,}\b/g]);
  }
  if (mp.contact) {
    r.push(['이메일', /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g]);
    r.push(['주소', /\bhttps?:\/\/[^\s<>"'`)\]]+/g]);
    r.push(['주소', /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?\b/g]);
    r.push(['번호', /(?<!\d)\d{6}-[1-8]\d{6}(?!\d)/g]);                                   // 주민·외국인 등록번호
    r.push(['전화', /(?<![\d-])(?:\+82[-. ]?)?0\d{1,2}[-. )]\d{3,4}[-. ]\d{4}(?![\d-])/g]);
    r.push(['전화', /(?<!\d)01[016789]\d{7,8}(?!\d)/g]);
    r.push(['번호', /(?<![\d-])\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,6})?(?![\d-])/g, 0, m => !/^\d{4}-\d{1,2}-\d{1,2}$/.test(m)]);   // 계좌 등 (날짜 제외)
  }
  if (mp.money) r.push(['금액', /(?:(?:US)?\$|₩)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:만|억|천만|백만))?|(?<![\d,.])\d[\d,]*(?:\.\d+)?\s?(?:조|억|천만|백만|만|천)?\s?(?:원|달러|USD|KRW)(?![가-힣A-Za-z])/g]);
  if (mp.names) r.push(['사람', new RegExp(`(?<![가-힣])([가-힣]{2,4})(?=\\s?(?:${TITLES})(?:${JOSA})?(?![가-힣]))`, 'g'), 1, m => !NOT_NAMES.has(m)]);
  return r;
}

// 부분 가리기 (*림*, 010-****-5678, k***@mail.com …) — 문서 가리기에서 씀
export function partial(cat, s) {
  s = String(s);
  if (cat === '전화') return s.replace(/^(\D*\d{2,3}\D?)([\d\D]*?)(\d{4})$/, (m, a, b, c) => a + b.replace(/\d/g, '*') + c);
  if (cat === '이메일') return s.replace(/^(.)([^@]*)@/, (m, a, b) => a + '*'.repeat(Math.max(2, b.length)) + '@');
  if (cat === '번호') { const d = s.replace(/\D/g, '').length; let k = 0; return s.replace(/\d/g, c => ++k > d - 4 ? c : '*'); }
  if (cat === '금액') return s.replace(/\d/g, '*');
  if (cat === '비밀') return '****';
  if (cat === '주소') return /^\d/.test(s) ? s.replace(/^(\d+)\.\d+\.\d+\.(\d+)/, '$1.*.*.$2') : s.replace(/^(https?:\/\/)[^/]+/, '$1***');
  const ch = [...s];
  if (ch.length <= 1) return '*';
  if (ch.length === 2) return ch[0] + '*';
  return ch.map((c, i) => i === 0 || i === ch.length - 1 || (ch.length > 5 && (i === 1 || i === ch.length - 2)) ? (/\s/.test(c) ? c : '*') : c).join('');
}

// style: 'bracket' → [회사1], 'plain' → 회사1, 'partial' → *림*
function tokenFor(sess, cat, original, key) {
  key = key || cat + ':' + original;
  if (sess.map[key]) return sess.map[key].t;
  sess.next[cat] = (sess.next[cat] || 0) + 1;
  const st = sess.style || 'bracket';
  const t = st === 'partial' ? partial(cat, original) : st === 'plain' ? `${cat}${sess.next[cat]}` : `[${cat}${sess.next[cat]}]`;
  sess.map[key] = { t, o: original, c: cat };
  return t;
}
export const tokenOf = (sess, cat, value) => tokenFor(sess, cat, value);
// 대응표를 써서 어떤 표시 방식이든 원래 값으로 되돌림 (긴 표시부터)
export function restoreAny(text, sess) {
  const list = Object.values(sess.map).filter(v => v.t && v.t !== v.o).sort((a, b) => b.t.length - a.t.length);
  if (!list.length) return text;
  const re = new RegExp(list.map(v => esc(v.t) + (/\d$/.test(v.t) ? '(?!\\d)' : '')).join('|'), 'g');
  const back = Object.fromEntries(list.map(v => [v.t, v.o]));
  return String(text).replace(re, m => back[m] ?? m);
}

export function maskText(text, sess, mp = maskPrefs()) {
  if (!text || !mp.on) return text;
  let s = String(text);
  // 1) 직접 등록한 단어 (긴 것부터, 대소문자 무시)
  const words = (mp.words || []).filter(x => x && x.w && x.w.trim().length >= 1).sort((a, b) => b.w.length - a.w.length);
  for (const { w, cat } of words) {
    const word = w.trim(), c = CATS.includes(cat) ? cat : '기타';
    s = s.replace(new RegExp(esc(word), 'gi'), m => tokenFor(sess, c, word, c + ':' + word.toLowerCase()));
  }
  // 2) 형태로 찾는 정보 — 이미 바뀐 [표시]는 건드리지 않도록 조각으로 나눠 처리
  for (const [cat, re, group, keep] of rules(mp)) {
    s = s.split(splitter).map((part, i) => i % 2 ? part : part.replace(re, (...a) => {
      const m = a[0];
      if (group === 2) return a[1] + tokenFor(sess, cat, a[2]);
      const target = group === 1 ? a[1] : m;
      if (keep && !keep(target)) return m;
      return tokenFor(sess, cat, target);
    })).join('');
  }
  return s;
}
const splitter = new RegExp(`(\\[(?:${ALL.join('|')})\\d+\\])`);

export function unmaskText(text, sess) {
  if (!text || !sess) return text;
  const back = {};
  for (const v of Object.values(sess.map)) back[v.t] = v.o;
  return String(text).replace(TOKEN_RE, m => back[m] ?? m);
}

const mapContent = (c, f) => typeof c === 'string' ? f(c) : Array.isArray(c) ? c.map(x => x.type === 'text' ? { ...x, text: f(x.text) } : x) : c;
const textOf = c => typeof c === 'string' ? c : (c || []).filter(x => x.type === 'text').map(x => x.text).join('\n');

// 한 번의 AI 호출을 위한 준비. sess를 넘기면 대화가 이어져도 같은 단어에 같은 표시를 씁니다.
export function prepare(messages, sess) {
  const mp = maskPrefs();
  if (!mp.on) return null;
  const p = { session: sess || newSession(), original: messages };
  p.refresh = () => {
    const now = maskPrefs();
    p.messages = messages.map(m => ({ ...m, content: mapContent(m.content, t => maskText(t, p.session, now)) }));
    const used = new Map();
    for (const m of p.messages) for (const x of textOf(m.content).matchAll(TOKEN_RE)) used.set(x[0], x[1]);
    p.info = { total: used.size, byCat: [...used.values()].reduce((o, c) => (o[c] = (o[c] || 0) + 1, o), {}) };
    return p;
  };
  p.unmask = t => unmaskText(t, p.session);
  p.addWord = async (w, cat = '기타') => {
    w = String(w || '').trim();
    if (!w || w.length > 60 || splitter.test(w)) return false;
    const cur = maskPrefs();
    if (!(cur.words || []).some(x => x.w.toLowerCase() === w.toLowerCase())) await savePrefs({ aiMask: { ...cur, words: [...(cur.words || []), { w, cat }] } });
    p.refresh(); return true;
  };
  return p.refresh();
}
export const infoText = info => info && info.total ? `가린 정보 ${info.total}곳 · ` + Object.entries(info.byCat).map(([c, n]) => `${c} ${n}`).join(', ') : '';
export const TOKEN_PATTERN = TOKEN_RE;
export const splitTokens = s => String(s || '').split(splitter);   // 홀수 칸이 [표시]
