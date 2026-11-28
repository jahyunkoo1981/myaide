// 영수증 읽기: 이 기기 안에서 PaddleOCR(PP-OCRv5 한국어 모델, 무료, 사진이 밖으로 나가지 않음)로 글자를 읽고,
// 날짜·합계·가게 이름을 찾아 가계부 칸을 채웁니다. 엔진을 못 쓰는 기기에서는 Tesseract로 읽습니다.
// 원하면 'AI로 정확하게 읽기'(OpenAI, 1장 약 1원)를 쓸 수 있습니다.
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
export function warm() { import('./ppocr.js').then(P => P.warm()).catch(() => worker().catch(() => {})); }

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

// 글자 읽기 → { text(줄로 묶은 글자), boxes(글자 상자와 위치), engine }
export async function ocrFull(blob, onProgress) {
  try {
    const P = await import('./ppocr.js');
    const r = await P.read(blob, onProgress);
    return { text: rowsFromLines(r.lines), boxes: r.lines, engine: 'ppocr' };
  } catch (e) {
    console.warn('PP-OCR 실패, Tesseract로 읽음:', e);
    return { text: await ocrTesseract(blob, onProgress), boxes: null, engine: 'tesseract' };
  }
}
export async function ocr(blob, onProgress) { return (await ocrFull(blob, onProgress)).text; }

async function ocrTesseract(blob, onProgress) {
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

// ---------- 글자 상자(위치 포함)를 줄로 묶기 ----------
// lines: [{text, score, frame:{left, top, width, height}}] → 같은 높이에 있는 글자를 한 줄로 (왼쪽→오른쪽)
export function rowsFromLines(lines) {
  const items = (lines || []).filter(l => l && l.text && l.frame).map(l => ({ t: l.text.trim(), x: l.frame.left, y: l.frame.top, h: l.frame.height, c: l.frame.top + l.frame.height / 2 }))
    .filter(l => l.t).sort((a, b) => a.c - b.c);
  const rows = [];
  for (const it of items) {
    let best = null, bo = 0;
    for (const r of rows.slice(-6)) {
      const top = Math.max(r.y0, it.y), bot = Math.min(r.y1, it.y + it.h), ov = (bot - top) / Math.min(r.h, it.h);
      if (ov > 0.45 && ov > bo && Math.abs(r.c - it.c) < Math.max(r.h, it.h) * 0.7) { best = r; bo = ov; }
    }
    if (best) { best.items.push(it); best.y0 = Math.min(best.y0, it.y); best.y1 = Math.max(best.y1, it.y + it.h); }
    else rows.push(best = { items: [it], y0: it.y, y1: it.y + it.h, h: it.h, c: it.c });
  }
  return rows.map(r => r.items.sort((a, b) => a.x - b.x).map(i => i.t).join('  ')).join('\n');
}

// ---------- 글자에서 날짜·합계·가게 찾기 ----------
const AMT = /(?<![\d.\-/])(\d{1,3}(?:[,.]\d{3})+|\d{3,8})(?![\d,]*\d)(?![-./]\d)\s*[원월]?/g;
const isMoney = x => /[,.]\d{3}/.test(x[1]) || /[원월]/.test(x[0]);

// 글자 상자로 합계 찾기: 이름 상자(또는 '합'+'계'처럼 나뉜 두 상자) 오른쪽, 세로 가운데가 가장 가까운 금액
function boxesOf(lines, fix = s => s) {
  return lines.filter(l => l && l.text && l.frame).map(l => { const f = l.frame; return { t: fix(l.text), f: l.text.replace(/\s/g, '').toLowerCase(), x0: f.left, x1: f.left + f.width, y0: f.top, y1: f.top + f.height, h: f.height, c: f.top + f.height / 2 }; });
}
// '상호' 글자 오른쪽 같은 높이의 이름
function storeFromBoxes(lines) {
  const B = boxesOf(lines);
  for (const b of B) {
    let L = null;
    if (/^(상호|상호명|가맹점명?|주문매장|매장|매장명|점포명)[:：]?$/.test(b.f)) L = b;
    else if (b.f === '상') { const nx = B.find(o => o.f === '호' && o.x0 >= b.x1 - 2 && o.x0 - b.x1 < b.h * 5 && Math.abs(o.c - b.c) < b.h * 0.5); if (nx) L = { ...b, x1: nx.x1 }; }
    if (!L) continue;
    const v = B.filter(o => o.x0 >= L.x1 - 2 && Math.abs(o.c - L.c) < L.h * 0.6 && (o.t.match(/[가-힣A-Za-z]/g) || []).length >= 2).sort((p, q) => p.x0 - q.x0)[0];
    if (v) return v.t.replace(/^[:：]\s*/, '').trim();
  }
  return null;
}
function amountFromBoxes(lines, keys, fix) {   // keys: 한 개 또는 여러 개
  const B = boxesOf(lines, fix);
  if (!B.length) return null;
  const W = Math.max(...B.map(b => b.x1));
  const money = b => [...b.t.matchAll(AMT)].filter(isMoney).map(x => ({ v: toNum(x[1]), i: x.index })).filter(o => o.v >= 100 && o.v < 100000000);
  // 같은 줄에서 바로 옆에 붙은 상자끼리 합친 이름 후보
  const labels = [];
  for (const b of B) {
    labels.push({ ...b });
    const nx = B.filter(o => o !== b && o.x0 >= b.x1 - 2 && o.x0 - b.x1 < b.h * 4 && Math.abs(o.c - b.c) < b.h * 0.5).sort((p, q) => p.x0 - q.x0)[0];
    if (nx && b.f.length <= 3) labels.push({ ...b, f: b.f + nx.f, t: b.t + nx.t, x1: nx.x1, y0: Math.min(b.y0, nx.y0), y1: Math.max(b.y1, nx.y1), joined: nx });
  }
  for (const key of keys) {
    const kk = key.replace(/\s/g, '').toLowerCase();
    for (const L of labels.filter(l => l.f.includes(kk) && l.f.length <= kk.length + 14)) {
      const own = money({ t: L.t.slice(L.t.replace(/\s/g, '').toLowerCase().indexOf(kk) + kk.length) });
      if (own.length) return { amount: own[0].v, why: key };
      let best = null;
      for (const o of B) {
        if (o === L.joined || o.x0 < L.x1 - L.h * 0.5 || o.f === L.f) continue;
        const m = money(o); if (!m.length) continue;
        const dy = Math.abs(o.c - (L.y0 + L.y1) / 2); if (dy > Math.max(o.h, L.y1 - L.y0) * 0.8) continue;
        const s = dy / Math.max(o.h, L.h) * 3 + (o.x0 - L.x1) / W;
        if (!best || s < best.s) best = { s, v: m[0].v };
      }
      if (best) return { amount: best.v, why: key };
    }
  }
  return null;
}
const toNum = s => Number(String(s).replace(/[,.](?=\d{3}(\D|$))/g, '').replace(/[^\d]/g, ''));
// 앞에 있을수록 먼저 봄 (병원 '납부할 금액', 약국 '합계', 배달 '총 결제금액' …)
const TOTAL_KEYS = ['총결제금액', '실결제금액', '받을금액', '납부할금액', '결제금액', '승인금액', '청구금액', '결제할금액', '총합계', '매출합계', '총금액', '합계', '합계금액', '총액', '판매금액', '카드결제', '신용카드', '카드금액', '카드', '주문금액', 'TOTAL'];
const DATE_GOOD = /발행일|발행|조제일자|결제일|거래일|승인일|판매일|계산일|진료기간|진료일|주문일|접수|구매|일시|날짜/;
const DATE_BAD = /다음|내방|방문예정|유효|만료|일전|생년|교부번호|반품기한|기한|쿠폰|기간\s*[:：]?\s*20\d\d.{0,8}~/;
const SHOP = /[가-힣A-Za-z0-9]{1,20}(?:약국|병원|의원|치과|한의원|마트|편의점|상회|식당|카페|커피|베이커리|정육점|문구|서점|주유소|미용실|헤어|학원|스토어|마켓|슈퍼|반찬|떡집|분식|치킨|피자|배달|국수|김밥|백화점)/;

function fixDigits(line) {   // 숫자 사이에 섞인 O/o/l/I/S 같은 오인식 바로잡기, '12. 000'처럼 벌어진 금액 붙이기
  return line.replace(/(?<![\d,.])(\d{1,3})[,.]\s{1,3}(\d{3})(?![\d])/g, '$1,$2').replace(/(?<=\d)[Oo](?=\d|,)|(?<=,)[Oo]/g, '0').replace(/(?<=\d)[lI|](?=\d)/g, '1').replace(/(?<=\d)S(?=\d)/g, '5');
}
// opts: { now, totalKeys: 먼저 볼 합계 줄 이름(학습한 것), conf: [['B','8'], …] 숫자 오인식 }
export function parseReceipt(text, opts = {}) {
  if (opts instanceof Date) opts = { now: opts };
  const now = opts.now || new Date();
  const confFix = l => (opts.conf || []).reduce((s, [a, b]) => s.replace(new RegExp(`(?<=[\\d,])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\d,]|$)|(?<=^|\\s)${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\d)`, 'g'), b), l);
  // 한 글자씩 띄어 찍힌 제목(예: '아 산 충 무 병 원', '합 계')은 붙여서 읽음
  const joinSpaced = l => l.replace(/(?:^|(?<=\s))((?:[가-힣]\s{1,3}){1,}[가-힣])(?=\s|$)/g, m => m.replace(/\s+/g, ''));
  const lines = String(text || '').split(/\r?\n/).map(l => joinSpaced(fixDigits(confFix(l.trim())))).filter(Boolean);
  const flat = lines.map(l => l.replace(/\s+/g, ''));
  // 날짜: '발행일·조제일자·결제일' 같은 줄을 먼저, '다음 내방일' 같은 줄은 빼고
  let date = null;
  const Y = now.getFullYear();
  const okDate = (y, m, d) => { y = y < 100 ? 2000 + y : y; if (y < 2000 || y > Y + 1 || m < 1 || m > 12 || d < 1 || d > 31) return null; const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return s <= today() || y === Y ? s : null; };
  const DRE = /(20\d{2}|\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/g;
  const dates = [];
  lines.forEach((l, i) => {
    for (const m of l.matchAll(DRE)) {
      const before = l.slice(Math.max(0, m.index - 14), m.index), head = l.slice(0, m.index);
      const lastBad = Math.max(-1, ...[...head.matchAll(new RegExp(DATE_BAD.source, 'g'))].map(x => x.index)), lastGood = Math.max(-1, ...[...head.matchAll(new RegExp(DATE_GOOD.source, 'g'))].map(x => x.index));
      if (/\d\s*[~\-]\s*$/.test(head) && /20\d{2}|\d{2}[-./]\d{1,2}[-./]\d{1,2}/.test(head.slice(-14))) continue;   // 기간의 끝 날짜(…~2025-10-20)
      if (lastBad > lastGood || /^\(?\d{2}-/.test(l.slice(m.index - 1)) && /일전/.test(l)) continue;
      const v = okDate(+m[1], +m[2], +m[3]); if (!v) continue;
      dates.push({ v, s: (DATE_GOOD.test(before) || DATE_GOOD.test(lines[i - 1] || '') ? 10 : 0) + (m[1].length === 4 ? 2 : 0) - i * 0.01 });
    }
  });
  if (dates.length) date = dates.sort((a, b) => b.s - a.s)[0].v;
  // 합계: 글자 위치를 알면 '합계' 글자 오른쪽, 같은 높이에 있는 금액 → 아니면 같은 줄 / 다음 줄
  let amount = null, why = '';
  const amtsAfter =(l, from) => [...l.slice(from).matchAll(AMT)].filter(x => /[,.]\d{3}/.test(x[1]) || /[원월]/.test(x[0]) || toNum(x[1]) >= 1000).map(x => toNum(x[1])).filter(v => v >= 100 && v < 100000000);
  const hasBoxes = opts.boxes && opts.boxes.length;
  outer: for (const key of [...(opts.totalKeys || []), ...TOTAL_KEYS]) {
    if (hasBoxes) { const r = amountFromBoxes(opts.boxes, [key], t => fixDigits(confFix(t))); if (r) { ({ amount, why } = r); break; } }
    const kk = key.replace(/\s/g, '').toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      const at = flat[i].toLowerCase().indexOf(kk); if (at < 0) continue;
      // 띄어쓰기를 지운 위치를 원래 줄 위치로 되돌림
      let pos = 0, cnt = 0; while (pos < lines[i].length && cnt < at + kk.length) { if (!/\s/.test(lines[i][pos])) cnt++; pos++; }
      const nums = amtsAfter(lines[i], pos);
      const v = nums.length ? nums[0] : (lines[i + 1] ? amtsAfter(lines[i + 1], 0)[0] : null);
      if (v) { amount = v; why = key; break outer; }
    }
  }
  if (!amount) {
    const all = lines.flatMap(l => [...l.matchAll(AMT)].filter(x => /[,.]\d{3}/.test(x[1]) || /원/.test(x[0])).map(x => toNum(x[1]))).filter(v => v >= 100 && v < 10000000);
    if (all.length) { amount = Math.max(...all); why = '가장 큰 금액'; }
  }
  // 가게 이름: '상호·매장' 칸 → 약국·병원·카페 같은 이름 → 'OO점' → 맨 위 줄
  let store = '';
  const isPharm = /약제비/.test(flat.join(''));
  const LABEL = /(?:^|\s)(?:상호명?|가맹점명?|주문매장|매장명?|점포명?)\s*[:：]\s*([^\s].{1,30})|(?:^|\s)(?:상호명?|가맹점명|주문매장|매장명|점포명)\s+([^\s].{1,30})/;
  const fromLabel = () => {
    if (opts.boxes && opts.boxes.length) { const v = storeFromBoxes(opts.boxes); if (v) return v; }
    for (const l of lines) {
      const m = l.replace(/(^|\s)상\s*호(?=\s|[:：]|$)/, '$1상호').match(LABEL);
      const v = m && (m[1] || m[2]); if (v && /[가-힣A-Za-z]{2}/.test(v) && !/번호|전화|작용/.test(v)) return v.split(/\s{2,}/).find(x => /[가-힣A-Za-z]{2}/.test(x)) || '';
    }
    return '';
  };
  const fromNames = () => {
    const cands = [], N = Math.max(1, lines.length);
    lines.forEach((l, i) => l.split(/\s{2,}/).forEach(seg => {
      const z = seg.replace(/\s/g, '');
      if (/고객센터|APP|다운로드|어플|홈페이지|www|http|요양기관|기관종류/i.test(z)) return;
      let v = null, s = 0;
      const m = z.match(SHOP);
      if (m && !/^(상호|정보|병원|약국|의원)$/.test(m[0]) && !/^[형급]/.test(z.slice(m.index + m[0].length)) && !/(색|종합|상급)(의원|병원)$/.test(m[0]) && !/서비스|앱|카드|포인트|상품권/.test(z.slice(m.index + m[0].length, m.index + m[0].length + 4))) { v = m[0]; s = 10; }
      else if (i < N * 0.3 && /^[가-힣A-Za-z0-9()·&]{1,12}\s?[가-힣A-Za-z0-9()]{0,12}점$/.test(seg.trim()) && /[가-힣]{2}/.test(seg) && !/번호|포인트|적립|재출력|매점|가맹점/.test(z)) { v = seg.trim(); s = 7; }
      if (!v) return;
      if (isPharm) { if (!/약국$/.test(v)) return; s += 5; }
      s -= (i / N) * 8;
      if (/주소|[시구동]\s|[로길]\s*\d|\d+층/.test(l)) s -= 6;
      if (/정보|처방|병원정보|발행기관|진료예약/.test(seg) || /정보\s*[:：]/.test(l)) s -= 8;
      cands.push({ v: v.replace(/^(상호|가맹점명?)[:：]?/, ''), s });
    }));
    return cands.length ? cands.sort((p, q) => q.s - p.s)[0].v : '';
  };
  store = isPharm ? (fromNames() || fromLabel()) : (fromLabel() || fromNames());
  if (!store) {
    for (const l of lines.slice(0, 6)) {
      const t = l.replace(/[^\p{L}\p{N}()&·\s-]/gu, '').trim();
      if ((t.match(/[가-힣A-Za-z]/g) || []).length < 2) continue;
      if (/영수증|receipt|전화|tel|사업자|대표|주소|번호|빈호|일시|날짜|pos|카드|고객|감사/i.test(t)) continue;
      store = t.replace(/\s*(주문전표|주문서|고객용|영수증)\s*/g, ' ').trim(); if (store) break;
    }
  }
  store = store.replace(/^(상호명?|매장명?|가맹점명?|주문매장|점포명?)\s*[:：]?\s*/, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/\b\d{3}-\d{2}-\d{5}\b.*$/, '').trim().slice(0, 30);
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
