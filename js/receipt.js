// 영수증 읽기: 기본은 이 기기 안에서 Tesseract(무료, 인터넷 없이, 사진이 밖으로 나가지 않음)로 글자를 읽고,
// 날짜·합계·가게 이름을 찾아 가계부 칸을 채웁니다. 원하면 'AI로 정확하게 읽기'(OpenAI, 1장 약 1원)를 쓸 수 있습니다.
import { today } from './util.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
let workerP = null;

function loadScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((res, rej) => {
    const saved = window.define; window.define = undefined;   // VisualCode(Monaco)의 AMD define과 충돌 방지
    const s = document.createElement('script'); s.src = src;
    s.onload = () => { window.define = saved; res(window[global]); };
    s.onerror = () => { window.define = saved; rej(new Error('글자 인식 프로그램을 불러오지 못했습니다.')); };
    document.head.append(s);
  });
}

let progressCb = null;
async function worker() {
  if (!workerP) workerP = (async () => {
    const T = await loadScript(BASE + 'tesseract.min.js', 'Tesseract');
    const w = await T.createWorker(['kor', 'eng'], 1, {   // 1 = LSTM만 (작고 빠름)
      workerPath: BASE + 'worker.min.js', corePath: BASE + 'core/', langPath: BASE + 'lang/', gzip: true,
      logger: m => progressCb && progressCb(m)
    });
    await w.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
    return w;
  })().catch(e => { workerP = null; throw e; });
  return workerP;
}

// 카메라 버튼을 누르는 순간 미리 준비해 두면, 사진을 찍고 나서 기다리는 시간이 줄어듦
export function warm() { worker().catch(() => {}); }

// 사진을 읽기 좋게: 적당한 크기로 맞추고 흑백 + 대비 높이기
export async function prepareImage(blob, maxSide = 2000) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('사진을 열지 못했습니다.')); i.src = url; });
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = long > maxSide ? maxSide / long : Math.min(2.5, 1800 / long);   // 작은 사진은 키우고 큰 사진은 줄임
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    let lo = 255, hi = 0; const gray = new Uint8ClampedArray(p.length / 4);
    for (let i = 0, j = 0; i < p.length; i += 4, j++) { const v = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000; gray[j] = v; }
    const hist = new Uint32Array(256); gray.forEach(v => hist[v]++);
    let acc = 0; const n = gray.length; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
    acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
    const k = 255 / Math.max(1, hi - lo);
    for (let i = 0, j = 0; i < p.length; i += 4, j++) { const v = Math.max(0, Math.min(255, (gray[j] - lo) * k)); p[i] = p[i + 1] = p[i + 2] = v; }
    g.putImageData(d, 0, 0);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

export async function ocr(blob, onProgress) {
  progressCb = m => {
    if (!onProgress) return;
    if (m.status === 'recognizing text') onProgress(0.3 + m.progress * 0.7, '글자 읽는 중');
    else if (/load|initializ/.test(m.status)) onProgress(Math.min(0.3, (m.progress || 0) * 0.3), m.status.includes('language') ? '한글 인식 데이터 준비 중 (처음 한 번)' : '준비 중');
  };
  const canvas = await prepareImage(blob);
  const w = await worker();
  const { data } = await w.recognize(canvas);
  progressCb = null;
  return data.text || '';
}

// ---------- 글자에서 날짜·합계·가게 찾기 ----------
const AMT = /(?<![\d.])(\d{1,3}(?:[,.]\d{3})+|\d{3,8})(?![\d,]*\d)\s*원?/g;
const toNum = s => Number(String(s).replace(/[,.](?=\d{3}(\D|$))/g, '').replace(/[^\d]/g, ''));
const TOTAL_KEYS = ['결제금액', '승인금액', '받을금액', '청구금액', '결제할금액', '합계금액', '총결제금액', '총금액', '판매금액', '합계', '총액', '카드결제', '신용카드', '현금', 'TOTAL', '합 계'];

function fixDigits(line) {   // 숫자 사이에 섞인 O/o/l/I/S 같은 오인식 바로잡기
  return line.replace(/(?<=\d)[Oo](?=\d|,)|(?<=,)[Oo]/g, '0').replace(/(?<=\d)[lI|](?=\d)/g, '1').replace(/(?<=\d)S(?=\d)/g, '5');
}
// opts: { now, totalKeys: 먼저 볼 합계 줄 이름(학습한 것), conf: [['B','8'], …] 숫자 오인식 }
export function parseReceipt(text, opts = {}) {
  if (opts instanceof Date) opts = { now: opts };
  const now = opts.now || new Date();
  const confFix = l => (opts.conf || []).reduce((s, [a, b]) => s.replace(new RegExp(`(?<=[\\d,])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\d,]|$)|(?<=^|\\s)${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\d)`, 'g'), b), l);
  const lines = String(text || '').split(/\r?\n/).map(l => fixDigits(confFix(l.trim()))).filter(Boolean);
  const flat = lines.map(l => l.replace(/\s+/g, ''));
  // 날짜
  let date = null;
  const Y = now.getFullYear();
  const okDate = (y, m, d) => { y = y < 100 ? 2000 + y : y; if (y < 2000 || y > Y + 1 || m < 1 || m > 12 || d < 1 || d > 31) return null; const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return s <= today() || y === Y ? s : null; };
  for (const l of lines) {
    const m = l.match(/(20\d{2}|\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
    if (m) { date = okDate(+m[1], +m[2], +m[3]); if (date) break; }
  }
  // 합계
  let amount = null, why = '';
  outer: for (const key of [...(opts.totalKeys || []), ...TOTAL_KEYS]) {
    const kk = key.replace(/\s/g, '').toLowerCase();
    for (let i = 0; i < flat.length; i++) {
      if (!flat[i].toLowerCase().includes(kk)) continue;
      const nums = [...lines[i].matchAll(AMT)].map(x => toNum(x[1])).filter(v => v >= 100 && v < 100000000);
      const nxt = !nums.length && lines[i + 1] ? [...lines[i + 1].matchAll(AMT)].map(x => toNum(x[1])).filter(v => v >= 100 && v < 100000000) : [];
      const v = (nums.length ? nums : nxt).pop();
      if (v) { amount = v; why = key; break outer; }
    }
  }
  if (!amount) {
    const all = lines.flatMap(l => [...l.matchAll(AMT)].filter(x => /[,.]\d{3}/.test(x[1]) || /원/.test(x[0])).map(x => toNum(x[1]))).filter(v => v >= 100 && v < 10000000);
    if (all.length) { amount = Math.max(...all); why = '가장 큰 금액'; }
  }
  // 가게 이름
  let store = '';
  for (const l of lines) { const m = l.match(/(?:상호|가맹점|매장|점포)\s*(?:명)?\s*[:：]?\s*(.{2,30})/); if (m) { store = m[1]; break; } }
  if (!store) {
    for (const l of lines.slice(0, 6)) {
      const t = l.replace(/[^\p{L}\p{N}()&·\s-]/gu, '').trim();
      if ((t.match(/[가-힣A-Za-z]/g) || []).length < 2) continue;
      if (/영수증|receipt|전화|tel|사업자|대표|주소|번호|일시|날짜|pos|카드|고객|감사/i.test(t)) continue;
      store = t; break;
    }
  }
  store = store.replace(/\s{2,}/g, ' ').replace(/\b\d{3}-\d{2}-\d{5}\b.*$/, '').trim().slice(0, 30);
  return { date, amount, store, why };
}

// 가게 이름으로 항목 짐작 (사용자 항목 목록 안에서만 고름)
const CAT_HINTS = [
  ['외식비', /식당|카페|커피|스타벅스|투썸|이디야|메가|빽다방|컴포즈|치킨|피자|버거|맥도날드|롯데리아|맘스터치|분식|김밥|국밥|레스토랑|베이커리|파리바게|뚜레쥬르|배달|떡볶이|횟집|고기|족발|중화|반점|초밥|돈까스|냉면/],
  ['식재료·식품 구입비', /마트|이마트|홈플러스|롯데마트|코스트코|트레이더스|농협|하나로|식자재|정육|청과|GS25|CU|씨유|세븐일레븐|이마트24|편의점|슈퍼|노브랜드/i],
  ['차량 유지비', /주유|오일|에너지|칼텍스|S-?OIL|현대오일|알뜰|세차|정비|카센터|주차|타이어/i],
  ['병원비', /병원|의원|약국|치과|한의원|안과|내과|소아과|정형외과|피부과/],
  ['미용·개인용품', /미용|헤어|네일|올리브영|화장품|이니스프리|아리따움/],
  ['가정용 소모품', /다이소|생활용품|철물|세탁/],
  ['교육비', /학원|교육|서점|교보|영풍|문고|학습/],
  ['온라인 쇼핑', /쿠팡|11번가|G마켓|지마켓|옥션|네이버페이|SSG|무신사/i],
  ['통신비', /SKT|KT |LG ?U\+|텔레콤|통신/i],
  ['경조사비', /꽃|플라워|축의|부의/]
];
export function guessCategory(store, text, list) {
  const hay = (store || '') + ' ' + String(text || '').slice(0, 300);
  for (const [cat, re] of CAT_HINTS) if (re.test(hay) && list.includes(cat)) return cat;
  return null;
}
