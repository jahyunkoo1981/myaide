// 문서 가리기: 엑셀·워드·파워포인트·PDF·CSV·텍스트 파일의 실제 데이터를 회사1 / [회사1] / *림* 처럼 바꾼 사본을 만듭니다.
// 파일은 이 기기 안에서만 처리되고 어디에도 올라가지 않습니다.
import { h, toast, download, copyText } from '../util.js';
import { CATS, maskPrefs, maskText, newSession, tokenOf, restoreAny, splitTokens } from '../privacy.js';
import { prefs, save as savePrefs } from '../prefs.js';

const COL_CATS = [...CATS, '전화', '이메일', '번호', '주소', '금액'];
const HEAD_RULES = [
  [/거래처|고객|협력|공급|업체|벤더|vendor|customer|supplier|client|partner/i, '거래처'],
  [/회사|법인|company|corp/i, '회사'],
  [/성명|이름|담당|작성자|승인자|요청자|사원|직원|name|user|owner|person|manager/i, '사람'],
  [/전화|연락처|휴대|핸드폰|폰|phone|tel|mobile|fax/i, '전화'],
  [/메일|email|e-mail/i, '이메일'],
  [/주소|address|addr/i, '주소'],
  [/계좌|주민|사업자|등록번호|카드번호|account|ssn/i, '번호'],
  [/금액|단가|매출|매입|가격|원가|price|amount|cost|revenue|salary|급여/i, '금액']
];
const guessCat = head => { const s = String(head || ''); for (const [re, c] of HEAD_RULES) if (re.test(s)) return c; return null; };

// UMD 스크립트(ExcelJS, JSZip) 불러오기 — VisualCode(Monaco)의 AMD define과 충돌하지 않게 잠시 숨김
const loaded = {};
function loadScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return loaded[src] || (loaded[src] = new Promise((res, rej) => {
    const saved = window.define; window.define = undefined;
    const s = document.createElement('script'); s.src = src;
    s.onload = () => { window.define = saved; res(window[global]); };
    s.onerror = () => { window.define = saved; delete loaded[src]; rej(new Error(src + '을(를) 불러오지 못했습니다.')); };
    document.head.append(s);
  }));
}
const excelLib = () => loadScript('vendor/exceljs/exceljs.min.js', 'ExcelJS');
const zipLib = () => loadScript('vendor/jszip/jszip.min.js', 'JSZip');
async function pdfLib() {
  const pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

const kindOf = name => {
  const e = (name.split('.').pop() || '').toLowerCase();
  if (['xlsx', 'xlsm'].includes(e)) return 'excel';
  if (e === 'csv' || e === 'tsv') return 'csv';
  if (e === 'docx') return 'docx';
  if (e === 'pptx') return 'pptx';
  if (e === 'pdf') return 'pdf';
  if (['txt', 'md', 'json', 'sql', 'log', 'xml', 'html', 'htm', 'yaml', 'yml', 'ini', 'cfg', 'js', 'ts', 'py', 'cs', 'java'].includes(e)) return 'text';
  if (e === 'xls' || e === 'doc' || e === 'ppt' || e === 'hwp') return 'old';
  return null;
};
const KIND_LABEL = { excel: '엑셀', csv: 'CSV', docx: '워드', pptx: '파워포인트', pdf: 'PDF', text: '텍스트' };

function decodeText(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder('utf-8').decode(u8.subarray(3));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch { return new TextDecoder('euc-kr').decode(u8); }
}
function parseCsv(text, sep) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const csvCell = (v, sep) => /["\n\r]/.test(v) || v.includes(sep) ? '"' + v.replace(/"/g, '""') + '"' : v;
const stem = name => name.replace(/\.[^.]+$/, '');
const extOf = name => (name.match(/\.[^.]+$/) || [''])[0];

// 같은 금액은 같은 비율로 흐리게 (0.7~1.3배)
function fuzz(n) {
  let x = Math.abs(Math.round(n * 100)) || 1; x = ((x * 2654435761) >>> 0) % 1000;
  const v = n * (0.7 + x / 1666);
  return Number.isInteger(n) ? Math.round(v) : Math.round(v * 100) / 100;
}

export async function mount(root, ctx) {
  const files = [];       // { file, kind, name, buf, tables?: [{name, head, rows, cols: Map(colIndex → cat)}], result? }
  let style = prefs().maskDocStyle || 'plain';
  let session = null;

  const input = h('input', { type: 'file', multiple: true, accept: '.xlsx,.xlsm,.csv,.tsv,.docx,.pptx,.pdf,.txt,.md,.json,.sql,.log,.xml,.html,.yaml,.yml,.ini', hidden: true, onchange: e => add([...e.target.files]) });
  const drop = h('div', { class: 'mk-drop', tabindex: '0', role: 'button', onclick: () => input.click(), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } },
    h('b', null, '파일을 여기에 끌어다 놓거나 눌러서 고르세요'),
    h('span', null, '엑셀(xlsx) · CSV · 워드(docx) · 파워포인트(pptx) · PDF · 텍스트·코드 파일'));
  ['dragover', 'dragenter'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', e => { e.preventDefault(); add([...e.dataTransfer.files]); });

  const styleCards = h('div', { class: 'mk-styles', role: 'radiogroup', 'aria-label': '표시 방식' });
  const STYLES = [['plain', '회사1', '드림텍 → 회사1', '개발용 데이터에 가장 무난'], ['bracket', '[회사1]', '드림텍 → [회사1]', 'AI에게 가린 값임을 알려 줌'], ['partial', '*림*', '드림텍 → *림*, 010-****-5678', '원래 모양을 어느 정도 남김']];
  const drawStyles = () => styleCards.replaceChildren(...STYLES.map(([k, t, ex, sub]) => h('button', { type: 'button', class: 'mk-style', role: 'radio', 'aria-checked': String(style === k), onclick: () => { style = k; savePrefs({ maskDocStyle: k }); drawStyles(); clearResults(); } },
    h('b', null, t), h('span', null, ex), h('small', null, sub))));
  drawStyles();

  const wordIn = h('input', { placeholder: '이번에 더 가릴 단어 (예: 거래처 이름)', style: { width: '220px' } });
  const catSel = h('select', { style: { width: 'auto' } }, CATS.map(c => h('option', { value: c }, c)));
  const wordsEl = h('div', { class: 'priv-words' });
  const drawWords = () => {
    const ws = maskPrefs().words || [];
    wordsEl.replaceChildren(...(ws.length ? ws.map((x, i) => h('span', { class: 'priv-chip' }, h('b', null, x.w), h('span', { class: 'muted' }, ' → ' + x.cat),
      h('button', { type: 'button', class: 'priv-x', 'aria-label': x.w + ' 지우기', onclick: async () => { await savePrefs({ aiMask: { ...maskPrefs(), words: ws.filter((_, j) => j !== i) } }); drawWords(); clearResults(); } }, '×')))
      : [h('span', { class: 'muted', style: { fontSize: '13px' } }, '등록한 단어가 없습니다. 아래 표에서 열을 고르거나 단어를 추가하세요.')]));
  };
  const addWord = async () => {
    const w = wordIn.value.trim(); if (!w) return;
    const ws = maskPrefs().words || [];
    if (!ws.some(x => x.w.toLowerCase() === w.toLowerCase())) await savePrefs({ aiMask: { ...maskPrefs(), words: [...ws, { w, cat: catSel.value }] } });
    wordIn.value = ''; drawWords(); clearResults();
  };
  wordIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addWord(); } });
  drawWords();

  const list = h('div', { class: 'mk-files' });
  const runBtn = h('button', { class: 'btn primary', onclick: run }, '가린 파일 만들기');
  const out = h('div', { class: 'mk-out' });

  async function add(fs) {
    for (const file of fs) {
      const kind = kindOf(file.name);
      if (!kind) { toast(`${file.name}: 이 형식은 아직 지원하지 않습니다.`, 'err'); continue; }
      if (kind === 'old') { toast(`${file.name}: 예전 형식(xls·doc·ppt·hwp)은 열 수 없습니다. 새 형식(xlsx·docx·pptx)으로 저장한 뒤 넣어 주세요.`, 'err'); continue; }
      if (file.size > 60 * 1024 * 1024) { toast(`${file.name}: 60MB가 넘어 처리할 수 없습니다.`, 'err'); continue; }
      const f = { file, kind, name: file.name, buf: await file.arrayBuffer() };
      try { if (kind === 'excel' || kind === 'csv') f.tables = await readTables(f); }
      catch (e) { toast(`${file.name}: 읽지 못했습니다 — ${e.message}`, 'err'); continue; }
      files.push(f);
    }
    input.value = ''; clearResults(); drawFiles();
  }

  async function readTables(f) {
    if (f.kind === 'csv') {
      const text = decodeText(f.buf), sep = f.name.toLowerCase().endsWith('.tsv') ? '\t' : (text.split('\n')[0].split(';').length > text.split('\n')[0].split(',').length ? ';' : ',');
      f.text = text; f.sep = sep;
      const rows = parseCsv(text, sep);
      return [table(f.name, rows)];
    }
    const ExcelJS = await excelLib();
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(f.buf);
    const out = [];
    wb.eachSheet(ws => {
      const rows = [];
      ws.eachRow({ includeEmpty: false }, (row, r) => { if (rows.length < 400) rows.push({ r, v: (row.values || []).slice(1).map(cellText) }); });
      const headRow = rows[0];
      out.push({ name: ws.name, head: headRow ? headRow.v : [], headR: headRow ? headRow.r : 1, rows: rows.slice(1, 7).map(x => x.v), cols: autoCols(headRow ? headRow.v : []) });
    });
    return out;
  }
  const table = (name, rows) => ({ name, head: rows[0] || [], headR: 1, rows: rows.slice(1, 7), cols: autoCols(rows[0] || []) });
  function autoCols(head) { const m = new Map(); head.forEach((x, i) => { const c = guessCat(x); if (c) m.set(i, c); }); return m; }

  function drawFiles() {
    list.replaceChildren(...files.map((f, fi) => h('div', { class: 'mk-file' },
      h('div', { class: 'row' }, h('span', { class: 'mk-kind k-' + f.kind }, KIND_LABEL[f.kind]), h('b', { class: 'grow' }, f.name), h('small', { class: 'muted' }, (f.buf.byteLength / 1024).toFixed(0) + 'KB'),
        h('button', { class: 'btn small ghost', 'aria-label': f.name + ' 빼기', onclick: () => { files.splice(fi, 1); clearResults(); drawFiles(); } }, '빼기')),
      f.kind === 'pdf' ? h('p', { class: 'hint', style: { margin: 0 } }, 'PDF는 글자를 뽑아 가린 뒤 텍스트(.txt) 파일로 만듭니다. 표·그림 배치는 남지 않고, 스캔한 그림 PDF는 글자를 읽을 수 없습니다.') : null,
      f.kind === 'docx' || f.kind === 'pptx' ? h('p', { class: 'hint', style: { margin: 0 } }, '같은 형식으로 만듭니다. 가린 글이 있는 문단은 그 문단 첫 글자의 서식(굵게·색 등)으로 통일될 수 있습니다.') : null,
      ...(f.tables || []).map(t => tableEl(t)))));
    runBtn.disabled = !files.length;
    out.hidden = !files.length && !out.childElementCount;
  }
  function tableEl(t) {
    const n = Math.max(t.head.length, ...t.rows.map(r => r.length), 0);
    if (!n) return h('p', { class: 'hint' }, `‘${t.name}’ 시트는 비어 있습니다.`);
    const headCells = [], picks = [];
    for (let i = 0; i < n; i++) {
      const sel = h('select', { class: 'mk-colcat', 'aria-label': `${t.head[i] || i + 1}열 가리기`, onchange: e => { e.target.value ? t.cols.set(i, e.target.value) : t.cols.delete(i); clearResults(); th.classList.toggle('on', !!e.target.value); tds(i).forEach(td => td.classList.toggle('on', !!e.target.value)); } },
        h('option', { value: '' }, '그대로'), COL_CATS.map(c => h('option', { value: c, selected: t.cols.get(i) === c }, c + '로 가림')));
      const th = h('th', { class: t.cols.has(i) ? 'on' : '' }, h('div', null, String(t.head[i] ?? '')), sel);
      headCells.push(th); picks.push(sel);
    }
    const body = t.rows.map(r => h('tr', null, ...Array.from({ length: n }, (_, i) => h('td', { class: t.cols.has(i) ? 'on' : '', 'data-c': i }, String(r[i] ?? '').slice(0, 40)))));
    const tbl = h('table', { class: 'mk-table' }, h('thead', null, h('tr', null, ...headCells)), h('tbody', null, ...body));
    const tds = i => tbl.querySelectorAll(`td[data-c="${i}"]`);
    return h('div', { class: 'mk-sheet' }, h('div', { class: 'mk-sheet-name' }, `${t.name} — 열을 통째로 가리려면 제목 아래에서 종류를 고르세요 (제목 보고 자동으로 골라 둠)`), h('div', { class: 'mk-scroll' }, tbl));
  }

  function clearResults() { out.replaceChildren(); files.forEach(f => delete f.result); session = null; }

  async function run() {
    if (!files.length) return;
    runBtn.disabled = true; runBtn.textContent = '만드는 중…';
    session = newSession(style);
    const mp = { ...maskPrefs(), on: true };
    try {
      for (const f of files) {
        try { f.result = await processFile(f, mp); }
        catch (e) { console.warn(e); f.result = { error: e.message || String(e) }; }
      }
      drawResults();
    } finally { runBtn.disabled = false; runBtn.textContent = '가린 파일 만들기'; }
  }

  const mt = s => maskText(s, session, { ...maskPrefs(), on: true });
  const colToken = (cat, v) => {
    if (v == null || v === '') return v;
    if (cat === '금액') { const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) && String(v).match(/\d/) ? (typeof v === 'number' ? fuzz(n) : String(v).replace(/[\d,.]+/, fuzz(n).toLocaleString('ko-KR'))) : v; }
    return tokenOf(session, cat, String(v).trim());
  };

  async function processFile(f) {
    if (f.kind === 'text') { const text = mt(decodeText(f.buf)); return { blob: new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }), name: stem(f.name) + '_가림' + extOf(f.name), preview: text.slice(0, 1500) }; }
    if (f.kind === 'csv') {
      const rows = parseCsv(f.text, f.sep), t = f.tables[0];
      const outRows = rows.map((r, ri) => r.map((v, ci) => ri >= t.headR ? (t.cols.has(ci) ? String(colToken(t.cols.get(ci), v)) : mt(v)) : mt(v)));
      const text = outRows.map(r => r.map(v => csvCell(v, f.sep)).join(f.sep)).join('\r\n');
      return { blob: new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), name: stem(f.name) + '_가림' + extOf(f.name), preview: outRows.slice(0, 8) };
    }
    if (f.kind === 'excel') return processExcel(f);
    if (f.kind === 'docx' || f.kind === 'pptx') return processOffice(f);
    if (f.kind === 'pdf') return processPdf(f);
  }

  async function processExcel(f) {
    const ExcelJS = await excelLib();
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(f.buf);
    wb.creator = ''; wb.lastModifiedBy = ''; wb.company = ''; wb.manager = '';
    let preview = null;
    const tables = f.tables || [];
    wb.eachSheet((ws, idx) => {
      const t = tables.find(x => x.name === ws.name) || { cols: new Map(), headR: 1 };
      ws.eachRow({ includeEmpty: false }, (row, r) => {
        row.eachCell({ includeEmpty: false }, (cell, c) => {
          const cat = r > t.headR ? t.cols.get(c - 1) : null;
          const v = cell.value;
          if (v == null) return;
          if (cat) {
            if (typeof v === 'number' || typeof v === 'string') cell.value = colToken(cat, v);
            else if (v.richText || v.text) cell.value = colToken(cat, cellText(v));
            else if (v.formula && v.result != null) cell.value = { formula: v.formula, result: colToken(cat, v.result) };
          } else if (typeof v === 'string') cell.value = mt(v);
          else if (v.richText) { const s = v.richText.map(x => x.text).join(''), m = mt(s); if (m !== s) cell.value = m; }
          else if (v.hyperlink) cell.value = { text: mt(String(v.text || '')), hyperlink: mt(String(v.hyperlink)) };
          else if (v.formula && typeof v.result === 'string') cell.value = { formula: v.formula, result: mt(v.result) };
          if (cell.note) cell.note = typeof cell.note === 'string' ? mt(cell.note) : mt((cell.note.texts || []).map(x => x.text).join(''));
        });
      });
      const nm = mt(ws.name).replace(/[\[\]:*?/\\]/g, '').slice(0, 31);
      if (nm && nm !== ws.name && !wb.worksheets.some(o => o !== ws && o.name === nm)) ws.name = nm;
      if (!preview) { preview = []; ws.eachRow({ includeEmpty: false }, row => { if (preview.length < 8) preview.push((row.values || []).slice(1).map(cellText)); }); }
    });
    const buf = await wb.xlsx.writeBuffer();
    return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name: stem(f.name) + '_가림' + extOf(f.name), preview };
  }

  async function processOffice(f) {
    const JSZip = await zipLib();
    const zip = await JSZip.loadAsync(f.buf);
    const isDoc = f.kind === 'docx';
    const parts = Object.keys(zip.files).filter(p => isDoc ? /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(p) : /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(p));
    const P = 'p', T = 't';
    let previewLines = [];
    for (const path of parts) {
      const xml = await zip.file(path).async('string');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const paras = doc.getElementsByTagNameNS('*', P);
      for (const p of [...paras]) {
        const ts = [...p.getElementsByTagNameNS('*', T)].filter(t => nearestPara(t) === p);   // 안쪽 문단(표 등)의 글자는 그 문단에서 처리
        if (!ts.length) continue;
        const s = ts.map(t => t.textContent).join(''), m = mt(s);
        if (previewLines.length < 30 && s.trim()) previewLines.push(m);
        if (m === s) continue;
        ts[0].textContent = m; ts[0].setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        ts.slice(1).forEach(t => { t.textContent = ''; });
      }
      zip.file(path, new XMLSerializer().serializeToString(doc));
    }
    if (zip.file('docProps/core.xml')) {
      let core = await zip.file('docProps/core.xml').async('string');
      core = core.replace(/(<dc:creator>)[\s\S]*?(<\/dc:creator>)/, '$1$2').replace(/(<cp:lastModifiedBy>)[\s\S]*?(<\/cp:lastModifiedBy>)/, '$1$2').replace(/(<dc:title>)([\s\S]*?)(<\/dc:title>)/, (m, a, b, c) => a + mt(b) + c);
      zip.file('docProps/core.xml', core);
    }
    const blob = await zip.generateAsync({ type: 'blob', mimeType: isDoc ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    return { blob, name: stem(f.name) + '_가림' + extOf(f.name), preview: previewLines.join('\n') };
  }
  function nearestPara(n) { while (n && n.parentNode) { n = n.parentNode; if (n.localName === 'p') return n; } return null; }

  async function processPdf(f) {
    const pdfjs = await pdfLib();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(f.buf.slice(0)), cMapUrl: new URL('../../vendor/pdfjs/cmaps/', import.meta.url).href, cMapPacked: true, isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      pages.push(tc.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : '')).join(''));
    }
    const text = mt(pages.map((p, i) => `===== ${i + 1}쪽 =====\n${p.trim()}`).join('\n\n'));
    if (!pages.some(p => p.trim())) throw new Error('글자를 찾지 못했습니다. 스캔한 그림 PDF로 보입니다.');
    return { blob: new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }), name: stem(f.name) + '_가림.txt', preview: text.slice(0, 1500) };
  }

  function drawResults() {
    const map = Object.values(session.map);
    const byCat = map.reduce((o, v) => (o[v.c] = (o[v.c] || 0) + 1, o), {});
    const restoreIn = h('textarea', { rows: 4, placeholder: 'AI가 이 자료로 만든 코드·답변을 붙여 넣으면 회사1 같은 표시를 원래 값으로 되돌립니다.' });
    const restoreOut = h('div', { class: 'priv-prev' });
    restoreIn.addEventListener('input', () => { restoreOut.textContent = restoreIn.value ? restoreAny(restoreIn.value, session) : ''; });
    const tag = s => splitTokens(s).map((p, i) => i % 2 ? h('mark', { class: 'priv-tag' }, p) : p);
    out.replaceChildren(
      h('div', { class: 'mk-sum' }, h('b', null, `가린 값 ${map.length}개`), ' ', Object.entries(byCat).map(([c, n]) => `${c} ${n}`).join(' · '),
        h('span', { class: 'grow' }),
        files.filter(f => f.result && f.result.blob).length > 1 ? h('button', { class: 'btn small', onclick: () => files.forEach((f, i) => f.result?.blob && setTimeout(() => download(f.result.name, f.result.blob), i * 400)) }, '모두 다운로드') : null,
        h('button', { class: 'btn small ghost', onclick: () => downloadMap() }, '대응표 다운로드')),
      ...files.map(f => h('div', { class: 'mk-res' + (f.result?.error ? ' err' : '') },
        h('div', { class: 'row' }, h('span', { class: 'mk-kind k-' + f.kind }, KIND_LABEL[f.kind]), h('b', { class: 'grow' }, f.result?.error ? f.name : f.result.name),
          f.result?.error ? h('span', { class: 'error' }, f.result.error) : h('button', { class: 'btn small primary', onclick: () => download(f.result.name, f.result.blob) }, '다운로드')),
        !f.result || f.result.error ? null : Array.isArray(f.result.preview)
          ? h('div', { class: 'mk-scroll' }, h('table', { class: 'mk-table' }, h('tbody', null, ...f.result.preview.map(r => h('tr', null, ...r.map(v => h('td', null, String(v ?? '').slice(0, 40))))))))
          : h('div', { class: 'priv-prev' }, ...tag(f.result.preview || '')))),
      style === 'partial' ? h('p', { class: 'hint' }, '부분 가리기(*림*)는 서로 다른 값이 같은 모양이 될 수 있어 되돌리기를 쓸 수 없습니다. 대응표는 받을 수 있습니다.') :
        h('details', { class: 'mk-restore' }, h('summary', null, 'AI 결과를 원래 값으로 되돌리기'), restoreIn, restoreOut,
          h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => copyText(restoreOut.textContent, '되돌린 글을 복사했습니다') }, '복사'))),
      h('p', { class: 'hint' }, '대응표(원래 값 ↔ 표시)는 이 화면을 닫으면 사라집니다. 나중에 되돌려야 하면 대응표를 내려받아 내 PC에만 보관하세요. AI에게는 보내지 마세요.'));
    out.hidden = false;
  }
  function downloadMap() {
    const rows = [['표시', '원래 값', '종류'], ...Object.values(session.map).map(v => [v.t, v.o, v.c])];
    const text = rows.map(r => r.map(v => csvCell(String(v), ',')).join(',')).join('\r\n');
    download('가리기_대응표.csv', new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  }

  root.append(h('div', { class: 'mk pad' },
    h('div', { class: 'view-head' }, h('h1', null, '문서 가리기')),
    h('p', { class: 'hint', style: { margin: '0 0 12px' } }, 'AI에게 개발을 맡기기 전에 실제 데이터를 가린 사본을 만듭니다. 파일은 이 기기 안에서만 처리되고 어디에도 올라가지 않습니다. 원본은 바뀌지 않습니다.'),
    drop, input,
    h('section', { class: 'mk-opts' },
      h('h2', null, '표시 방식'), styleCards,
      h('h2', null, '가릴 단어'), wordsEl,
      h('div', { class: 'row', style: { gap: '6px' } }, wordIn, catSel, h('button', { class: 'btn small', onclick: addWord }, '추가'),
        h('span', { class: 'grow' }), h('a', { href: '#/settings', class: 'muted', style: { fontSize: '13px' } }, '자동 규칙(전화·이메일·금액 등)은 설정 › AI 정보 보호')),
      h('p', { class: 'hint', style: { margin: 0 } }, '여기서 추가한 단어는 AI 정보 보호 목록에도 들어가 AIDE·VisualCode에서도 함께 가려집니다.')),
    list,
    h('div', { class: 'row' }, h('span', { class: 'grow' }), runBtn),
    out));
  drawFiles();
  return {};
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v !== 'object') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v.richText) return v.richText.map(x => x.text).join('');
  if (v.text != null) return String(v.text);
  if (v.result != null) return String(v.result);
  if (v.error) return v.error;
  return '';
}
