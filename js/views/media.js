// 사진·동영상: originals kept as-is in Google Drive, browsed by day / month / year, folders and themes,
// duplicate check, fast index search and AI (meaning-based) search, plus the video editor.
import { h, uid, toast, confirmBox, promptBox, dialog, download, blobToDataUrl, icon, debounce, pad2 } from '../util.js';
import * as db from '../db.js';
import * as ms from '../mediastore.js';
import { describeImage, embed, apiKey, visionModel } from '../openai.js';
import { confirmCost, usd as usdOf, rate } from '../usage.js';

const COL = 'media';
const NOFOLDER = '미분류';
const UPLOADS_AT_ONCE = 3;
const PAGE = 400;

// thumbnails are drawn as they scroll into view, a few at a time
const urlCache = new Map();
const thumbQueue = [];
let thumbBusy = 0;
function loadThumb(img, it) {
  const key = 'mt:' + it.id;
  if (urlCache.has(key)) { img.src = urlCache.get(key); return; }
  thumbQueue.push([img, it]); pumpThumbs();
}
function pumpThumbs() {
  while (thumbBusy < 6 && thumbQueue.length) {
    const [img, it] = thumbQueue.shift();
    if (!img.isConnected) continue;
    thumbBusy++;
    ms.cachedImage(it.thumbId, 'mt:' + it.id)
      .then(b => { if (b) { const u = URL.createObjectURL(b); urlCache.set('mt:' + it.id, u); img.src = u; } else img.closest('.md-tile')?.classList.add('nothumb'); })
      .catch(() => img.closest('.md-tile')?.classList.add('nothumb'))
      .finally(() => { thumbBusy--; pumpThumbs(); });
  }
}
const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { io.unobserve(e.target); loadThumb(e.target, e.target._item); }
}), { rootMargin: '400px' }) : null;

const fmtSize = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1e3)) + 'KB';
const fmtDur = s => !s ? '' : `${Math.floor(s / 60)}:${pad2(Math.floor(s % 60))}`;
const dayLabel = d => { const [y, m, dd] = d.split('-').map(Number); const w = '일월화수목금토'[new Date(y, m - 1, dd).getDay()]; return `${y}년 ${m}월 ${dd}일 (${w})`; };
const haystack = it => [it.name, it.folder, (it.themes || []).join(' '), it.camera, it.aiDesc, (it.aiTags || []).join(' '), it.memo,
  it.taken && it.taken.slice(0, 10), it.taken && (Number(it.taken.slice(5, 7)) + '월'), it.taken && it.taken.slice(0, 4) + '년', it.type === 'video' ? '동영상 영상 비디오' : '사진'].filter(Boolean).join(' ').toLowerCase();

function b64ToVec(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Float32Array(u.buffer); }
function vecToB64(v) { const u = new Uint8Array(new Float32Array(v).buffer); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
const cosine = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x * y) || 1); };

export async function mount(root, ctx) {
  let items = [], meta = { folders: [], themes: [] };
  const f = { view: 'day', type: 'all', folder: null, theme: null, fav: false, month: null, q: '', ai: false };
  let sel = new Set(), shownLimit = PAGE, aiRank = null;

  const load = async () => {
    items = (await db.all(COL)).map(it => ({ ...it, _hay: haystack(it) })).sort((a, b) => (b.taken || '').localeCompare(a.taken || ''));
    meta = (await db.get('mediaMeta', 'lists')) || { folders: [], themes: [] };
  };
  const saveMeta = () => db.put('mediaMeta', 'lists', { folders: meta.folders, themes: meta.themes });
  const allFolders = () => [...new Set([...meta.folders, ...items.map(i => i.folder).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'ko'));
  const allThemes = () => [...new Set([...meta.themes, ...items.flatMap(i => i.themes || [])])].sort((a, b) => a.localeCompare(b, 'ko'));

  // ---------- layout ----------
  const side = h('aside', { class: 'md-side' });
  const searchIn = h('input', { type: 'search', placeholder: '사진 검색 — 예: 바다, 2025-08, 생일, 아이폰', 'aria-label': '사진·동영상 검색' });
  const aiChk = h('input', { type: 'checkbox' });
  const fileIn = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*,.heic,.heif,.mov,.mp4', hidden: true });
  const viewSeg = h('div', { class: 'seg' });
  const typeSeg = h('div', { class: 'seg' });
  const selBar = h('div', { class: 'md-selbar', hidden: true });
  // 전체 선택 (everything the current filter shows) + 휴지통
  const selAll = h('input', { type: 'checkbox', 'aria-label': '전체 선택', onchange: () => {
    const list = filtered();
    if (selAll.checked) list.forEach(i => sel.add(i.id)); else sel.clear();
    draw();
  } });
  const selAllLbl = h('label', { class: 'check md-selall-box' }, selAll, h('span', null, '전체 선택'));
  const trashBtn = h('button', { type: 'button', class: 'md-trash', title: '선택한 항목 삭제', 'aria-label': '선택한 항목 삭제', disabled: true, html: TRASH_SVG,
    onclick: () => removeItems(items.filter(i => sel.has(i.id))) });
  const grid = h('div', { class: 'md-grid-wrap' });
  const upPanel = h('div', { class: 'md-uploads', hidden: true });
  const head = h('div', { class: 'md-head' },
    h('div', { class: 'md-searchrow' },
      h('div', { class: 'hero-box md-search' }, icon('files'), searchIn),
      h('label', { class: 'check md-aichk', title: 'AI가 만든 사진 설명으로 뜻이 비슷한 사진까지 찾습니다' }, aiChk, 'AI 검색'),
      h('button', { class: 'btn primary', onclick: () => fileIn.click() }, '＋ 올리기')),
    h('div', { class: 'md-filters' }, h('button', { class: 'btn small md-mobside', onclick: () => side.classList.toggle('open') }, '폴더·테마'), viewSeg, typeSeg,
      h('button', { class: 'btn small ghost', 'aria-pressed': 'false', onclick: e => { f.fav = !f.fav; e.currentTarget.setAttribute('aria-pressed', String(f.fav)); draw(); } }, '♥ 즐겨찾기'),
      h('span', { class: 'grow' }),
      h('div', { class: 'md-pick' }, selAllLbl, trashBtn),
      h('button', { class: 'btn small', onclick: findDuplicates }, '중복 찾기'),
      h('button', { class: 'btn small', onclick: () => aiTagAll() }, '✦ AI 설명 만들기'),
      h('button', { class: 'btn small ghost', onclick: storageInfo }, '저장공간')),
    selBar);
  const mainCol = h('section', { class: 'md-main' }, head, upPanel, grid);
  root.append(h('div', { class: 'media-wrap' }, side, mainCol), fileIn);
  root.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); root.classList.add('md-drop'); } });
  root.addEventListener('dragleave', e => { if (e.target === root || !root.contains(e.relatedTarget)) root.classList.remove('md-drop'); });
  root.addEventListener('drop', e => { e.preventDefault(); root.classList.remove('md-drop'); const fs = [...(e.dataTransfer?.files || [])].filter(x => /^(image|video)\//.test(x.type) || /\.(heic|heif|mov)$/i.test(x.name)); if (fs.length) addFiles(fs); });
  fileIn.onchange = () => { const fs = [...fileIn.files]; fileIn.value = ''; if (fs.length) addFiles(fs); };

  const drawSegs = () => {
    viewSeg.replaceChildren(...[['day', '일'], ['month', '월'], ['year', '년']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(f.view === k), onclick: () => { f.view = k; if (k !== 'day') f.month = null; shownLimit = PAGE; draw(); } }, l)));
    typeSeg.replaceChildren(...[['all', '전체'], ['image', '사진'], ['video', '동영상']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(f.type === k), onclick: () => { f.type = k; draw(); } }, l)));
  };

  // ---------- side: folders & themes ----------
  function drawSide() {
    const count = pred => items.filter(pred).length;
    const folders = allFolders();
    const tree = new Map();   // nested by "/"
    for (const p of folders) { const parts = p.split('/'); for (let i = 1; i <= parts.length; i++) tree.set(parts.slice(0, i).join('/'), i - 1); }
    const fBtn = (label, val, n, depth = 0) => h('button', { class: 'md-sidebtn', 'aria-current': String(f.folder === val), style: { paddingLeft: 10 + depth * 14 + 'px' },
      onclick: () => { f.folder = f.folder === val ? null : val; shownLimit = PAGE; side.classList.remove('open'); draw(); } }, h('span', { class: 'grow' }, label), h('span', { class: 'n' }, n));
    side.replaceChildren(
      h('div', { class: 'md-sidesec' }, h('div', { class: 'md-sidehead' }, '모두'),
        fBtn('전체 사진·동영상', null, items.length)),
      h('div', { class: 'md-sidesec' },
        h('div', { class: 'md-sidehead' }, '폴더', h('button', { class: 'btn small ghost', onclick: newFolder }, '＋')),
        ...[...tree.keys()].sort((a, b) => a.localeCompare(b, 'ko')).map(p => fBtn(p.split('/').pop(), p, count(i => i.folder === p || (i.folder || '').startsWith(p + '/')), tree.get(p))),
        fBtn(NOFOLDER, NOFOLDER, count(i => !i.folder)),
        f.folder && f.folder !== NOFOLDER ? h('div', { class: 'row md-folderacts' },
          h('button', { class: 'btn small ghost', onclick: () => renameFolder(f.folder) }, '이름 바꾸기'),
          h('button', { class: 'btn small ghost danger', onclick: () => deleteFolder(f.folder) }, '폴더 삭제')) : null),
      h('div', { class: 'md-sidesec' },
        h('div', { class: 'md-sidehead' }, '테마', h('button', { class: 'btn small ghost', onclick: newTheme }, '＋')),
        h('div', { class: 'md-themes' }, ...allThemes().map(t => h('button', { class: 'chip', 'aria-pressed': String(f.theme === t), onclick: () => { f.theme = f.theme === t ? null : t; draw(); } }, '#' + t, h('span', { class: 'n' }, count(i => (i.themes || []).includes(t))))),
          allThemes().length ? null : h('p', { class: 'hint', style: { margin: 0 } }, '여행, 가족, 업무 현장처럼 주제로 묶어 보세요.')),
        f.theme ? h('div', { class: 'row md-folderacts' }, h('button', { class: 'btn small ghost danger', onclick: () => deleteTheme(f.theme) }, '테마 지우기')) : null));
  }
  async function newFolder() {
    const name = (await promptBox('새 폴더 이름', f.folder && f.folder !== NOFOLDER ? f.folder + '/' : '', { hint: '‘가족/2026 제주’처럼 / 로 하위 폴더를 만듭니다.' }) || '').trim().replace(/\/+$/, '');
    if (!name) return;
    if (!meta.folders.includes(name)) { meta.folders.push(name); await saveMeta(); }
    f.folder = name; draw();
  }
  async function renameFolder(old) {
    const name = (await promptBox('폴더 이름 바꾸기', old) || '').trim().replace(/\/+$/, '');
    if (!name || name === old) return;
    const moved = items.filter(i => i.folder === old || (i.folder || '').startsWith(old + '/'));
    for (const it of moved) await saveItem(it, { folder: name + it.folder.slice(old.length) });
    meta.folders = meta.folders.map(p => p === old || p.startsWith(old + '/') ? name + p.slice(old.length) : p); await saveMeta();
    f.folder = name; toast(`${moved.length}개를 옮겼습니다`);
  }
  async function deleteFolder(p) {
    const inside = items.filter(i => i.folder === p || (i.folder || '').startsWith(p + '/'));
    if (!await confirmBox(`‘${p}’ 폴더를 지울까요? 안의 ${inside.length}개는 지워지지 않고 ‘${NOFOLDER}’로 옮겨집니다.`, '폴더 삭제', true)) return;
    for (const it of inside) await saveItem(it, { folder: '' });
    meta.folders = meta.folders.filter(x => x !== p && !x.startsWith(p + '/')); await saveMeta();
    f.folder = null;
  }
  async function newTheme() {
    const t = (await promptBox('새 테마', '', { placeholder: '예: 여행, 아이들, 현장 사진' }) || '').trim().replace(/^#/, '');
    if (!t) return;
    if (!meta.themes.includes(t)) { meta.themes.push(t); await saveMeta(); }
    drawSide();
  }
  async function deleteTheme(t) {
    const tagged = items.filter(i => (i.themes || []).includes(t));
    if (!await confirmBox(`‘#${t}’ 테마를 지울까요? 사진은 그대로 있고 테마 표시만 빠집니다 (${tagged.length}개).`, '테마 지우기', true)) return;
    for (const it of tagged) await saveItem(it, { themes: it.themes.filter(x => x !== t) });
    meta.themes = meta.themes.filter(x => x !== t); await saveMeta(); f.theme = null;
  }

  // ---------- filtering & search ----------
  function filtered() {
    let list = items;
    if (f.type !== 'all') list = list.filter(i => i.type === f.type);
    if (f.folder === NOFOLDER) list = list.filter(i => !i.folder);
    else if (f.folder) list = list.filter(i => i.folder === f.folder || (i.folder || '').startsWith(f.folder + '/'));
    if (f.theme) list = list.filter(i => (i.themes || []).includes(f.theme));
    if (f.fav) list = list.filter(i => i.fav);
    if (f.month) list = list.filter(i => (i.taken || '').startsWith(f.month));
    const q = f.q.trim().toLowerCase();
    if (q) {
      const words = q.split(/\s+/);
      const kw = list.filter(i => words.every(w => i._hay.includes(w)));
      if (aiRank) {
        const seen = new Set(kw.map(i => i.id));
        const extra = list.filter(i => !seen.has(i.id) && (aiRank.get(i.id) || 0) >= 0.32).sort((a, b) => aiRank.get(b.id) - aiRank.get(a.id));
        list = kw.concat(extra);
      } else list = kw;
    }
    return list;
  }
  const runAi = debounce(async () => {
    aiRank = null;
    const q = f.q.trim();
    if (!f.ai || !q) { draw(); return; }
    try {
      const [v] = await embed([q]);
      aiRank = new Map(items.filter(i => i.aiVec).map(i => [i.id, cosine(v, b64ToVec(i.aiVec))]));
      if (!aiRank.size) toast('AI 설명이 있는 사진이 없습니다. ‘✦ AI 설명 만들기’를 먼저 해 주세요.');
    } catch (e) { toast(e.message, 'err'); }
    draw();
  }, 450);
  searchIn.addEventListener('input', () => { f.q = searchIn.value; shownLimit = PAGE; aiRank = null; draw(); if (f.ai) runAi(); });
  aiChk.addEventListener('change', () => { f.ai = aiChk.checked; aiRank = null; if (f.ai) runAi(); else draw(); });

  // ---------- grid ----------
  function tile(it) {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
    img._item = it;
    if (io) io.observe(img); else loadThumb(img, it);
    const t = h('div', { class: 'md-tile' + (sel.has(it.id) ? ' sel' : '') + (it.type === 'video' ? ' video' : ''), tabindex: '0', 'data-id': it.id, title: it.name },
      img,
      h('span', { class: 'md-ph' }, it.type === 'video' ? '동영상' : (it.mime || '').split('/')[1]?.toUpperCase() || '사진'),
      it.type === 'video' ? h('span', { class: 'md-dur' }, '▶ ' + fmtDur(it.duration)) : null,
      it.fav ? h('span', { class: 'md-fav' }, '♥') : null,
      h('button', { class: 'md-check', type: 'button', 'aria-label': '선택', onclick: e => { e.stopPropagation(); toggleSel(it.id, e.shiftKey); } }, '✓'));
    t.addEventListener('click', e => { if (sel.size || e.ctrlKey || e.metaKey) { toggleSel(it.id, e.shiftKey); return; } openViewer(it); });
    t.addEventListener('keydown', e => { if (e.key === 'Enter') openViewer(it); if (e.key === ' ') { e.preventDefault(); toggleSel(it.id); } });
    return t;
  }
  let lastClicked = null;
  function toggleSel(id, range) {
    const list = filtered();
    if (range && lastClicked) {
      const a = list.findIndex(i => i.id === lastClicked), b = list.findIndex(i => i.id === id);
      if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(list[i].id);
    } else sel.has(id) ? sel.delete(id) : sel.add(id);
    lastClicked = id; drawSel();
    grid.querySelectorAll('.md-tile').forEach(t => t.classList.toggle('sel', sel.has(t.dataset.id)));
  }

  function draw() {
    drawSegs(); drawSide(); drawSel();
    const list = filtered();
    if (!items.length) {
      grid.replaceChildren(h('div', { class: 'empty md-empty' }, h('b', null, '사진과 동영상을 올려 보세요'),
        '‘＋ 올리기’를 누르거나 이 화면에 끌어다 놓으면 원본 그대로 Google Drive에 저장됩니다. 휴대폰에서는 사진첩에서 여러 장을 한꺼번에 고를 수 있습니다.',
        h('button', { class: 'btn primary', style: { marginTop: '12px' }, onclick: () => fileIn.click() }, '＋ 올리기')));
      return;
    }
    if (!list.length) { grid.replaceChildren(h('div', { class: 'empty md-empty' }, h('b', null, '조건에 맞는 사진이 없습니다'), f.q ? (f.ai ? '' : 'AI 검색을 켜면 뜻이 비슷한 사진도 찾습니다.') : '')); return; }
    const info = h('div', { class: 'md-count' }, `${list.length.toLocaleString('ko-KR')}개` + (f.month ? ` · ${f.month.replace('-', '년 ')}월` : '') + (f.folder ? ` · 폴더 ${f.folder}` : '') + (f.theme ? ` · #${f.theme}` : ''),
      f.month ? h('button', { class: 'btn small ghost', onclick: () => { f.month = null; draw(); } }, '월 선택 해제') : null);
    if (f.view === 'year' && !f.q) {
      const years = new Map();
      for (const it of list) { const y = (it.taken || '????').slice(0, 4), m = (it.taken || '').slice(0, 7); if (!years.has(y)) years.set(y, new Map()); const mm = years.get(y); if (!mm.has(m)) mm.set(m, []); mm.get(m).push(it); }
      grid.replaceChildren(info, ...[...years.entries()].map(([y, months]) => h('section', { class: 'md-group' },
        h('h3', null, `${y}년`, h('span', { class: 'n' }, [...months.values()].reduce((n, a) => n + a.length, 0) + '개')),
        h('div', { class: 'md-months' }, ...[...months.entries()].map(([m, arr]) => {
          const cover = tile(arr[0]); cover.classList.add('md-cover');
          const card = h('button', { class: 'md-month', type: 'button', onclick: () => { f.view = 'day'; f.month = m; shownLimit = PAGE; draw(); grid.scrollTop = 0; } },
            cover, h('span', { class: 'md-month-l' }, Number(m.slice(5, 7)) + '월', h('span', { class: 'n' }, arr.length + '개')));
          cover.onclick = null; return card;
        })))));
      return;
    }
    const keyOf = it => !it.taken ? '날짜 없음' : f.view === 'month' ? it.taken.slice(0, 7) : it.taken.slice(0, 10);
    const label = k => k === '날짜 없음' ? k : k.length === 7 ? `${k.slice(0, 4)}년 ${Number(k.slice(5))}월` : dayLabel(k);
    const shown = f.q ? list.slice(0, shownLimit) : list.slice(0, shownLimit);
    const groups = [];
    if (f.q && aiRank) groups.push(['검색 결과', shown]);
    else for (const it of shown) { const k = keyOf(it); if (!groups.length || groups[groups.length - 1][0] !== k) groups.push([k, []]); groups[groups.length - 1][1].push(it); }
    grid.replaceChildren(info, ...groups.map(([k, arr]) => h('section', { class: 'md-group' },
      h('h3', null, k === '검색 결과' ? k : label(k), h('span', { class: 'n' }, arr.length + '개'),
        h('button', { class: 'btn small ghost md-selall', onclick: () => { arr.forEach(i => sel.add(i.id)); draw(); } }, '모두 선택'),
        f.view === 'month' && k.length === 7 ? h('button', { class: 'btn small ghost md-selall', onclick: () => { f.view = 'day'; f.month = k; draw(); } }, '날짜별 보기') : null),
      h('div', { class: 'md-grid' + (f.view === 'month' ? ' small' : '') }, ...arr.map(tile)))),
      list.length > shownLimit ? h('button', { class: 'btn md-more', onclick: () => { shownLimit += PAGE; draw(); } }, `더 보기 (${(list.length - shownLimit).toLocaleString('ko-KR')}개 남음)`) : null);
  }

  // ---------- selection actions ----------
  function drawSel() {
    const shownNow = filtered();
    const nSel = shownNow.filter(i => sel.has(i.id)).length;
    selAll.checked = !!shownNow.length && nSel === shownNow.length;
    selAll.indeterminate = nSel > 0 && nSel < shownNow.length;
    trashBtn.disabled = !sel.size;
    trashBtn.title = sel.size ? `선택한 ${sel.size}개 삭제` : '삭제할 항목을 먼저 고르세요';
    selBar.hidden = !sel.size;
    if (!sel.size) return;
    const chosen = items.filter(i => sel.has(i.id));
    const vids = chosen.filter(i => i.type === 'video');
    selBar.replaceChildren(...[h('b', null, `${sel.size}개 선택`),
      h('button', { class: 'btn small', onclick: () => downloadItems(chosen) }, '원본 다운로드'),
      h('button', { class: 'btn small', onclick: () => moveTo(chosen) }, '폴더로 이동'),
      h('button', { class: 'btn small', onclick: () => tagThemes(chosen) }, '테마 지정'),
      h('button', { class: 'btn small', onclick: async () => { const on = !chosen.every(i => i.fav); for (const it of chosen) await saveItem(it, { fav: on }); } }, '♥'),
      h('button', { class: 'btn small', onclick: () => aiTagAll(chosen) }, '✦ AI 설명'),
      vids.length ? h('button', { class: 'btn small', onclick: () => editVideos(vids) }, vids.length > 1 ? '동영상 합치기·편집' : '동영상 편집') : null,
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'md-trash', title: `선택한 ${chosen.length}개 삭제`, 'aria-label': `선택한 ${chosen.length}개 삭제`, html: TRASH_SVG, onclick: () => removeItems(chosen) }),
      h('button', { class: 'btn small ghost', onclick: () => { sel.clear(); draw(); } }, '선택 해제')].filter(Boolean));
  }
  async function moveTo(list) {
    const opts = allFolders();
    const input = h('input', { type: 'text', list: 'md-folders', placeholder: '폴더 이름 (비우면 미분류)', value: f.folder && f.folder !== NOFOLDER ? f.folder : '' });
    const dl = h('datalist', { id: 'md-folders' }, ...opts.map(o => h('option', { value: o })));
    const r = await dialog({ title: `${list.length}개를 폴더로 이동`, body: [input, dl], onOpen: () => input.focus(), actions: [{ label: '취소' }, { label: '이동', kind: 'primary', value: 'ok' }] });
    if (r !== 'ok') return;
    const to = input.value.trim().replace(/\/+$/, '');
    for (const it of list) await saveItem(it, { folder: to });
    if (to && !meta.folders.includes(to)) { meta.folders.push(to); await saveMeta(); }
    sel.clear(); toast('옮겼습니다');
  }
  async function tagThemes(list) {
    const themes = allThemes();
    const picks = new Set(themes.filter(t => list.every(i => (i.themes || []).includes(t))));
    const box = h('div', { class: 'md-themes' }, ...themes.map(t => { const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(picks.has(t)), onclick: () => { picks.has(t) ? picks.delete(t) : picks.add(t); b.setAttribute('aria-pressed', String(picks.has(t))); } }, '#' + t); return b; }));
    const add = h('input', { type: 'text', placeholder: '새 테마 (쉼표로 여러 개)' });
    const r = await dialog({ title: `${list.length}개에 테마 지정`, body: [box, add], actions: [{ label: '취소' }, { label: '저장', kind: 'primary', value: 'ok' }] });
    if (r !== 'ok') return;
    add.value.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean).forEach(t => picks.add(t));
    for (const it of list) {
      const keep = (it.themes || []).filter(t => !themes.includes(t) || picks.has(t));
      await saveItem(it, { themes: [...new Set([...keep, ...picks])] });
    }
    for (const t of picks) if (!meta.themes.includes(t)) meta.themes.push(t);
    await saveMeta(); sel.clear(); toast('테마를 저장했습니다');
  }
  // Delete: the tiles vanish at once, then 6 items at a time are removed from Drive (original, thumbnail and
  // preview of one item in parallel). The screen is redrawn once at the end instead of after every item.
  let bulk = false;
  async function removeItems(list) {
    if (!list.length) return;
    if (!await confirmBox(`${list.length}개를 삭제할까요? Google Drive의 원본도 지워집니다 (Drive 휴지통에 들어가지 않습니다).`, '삭제', true)) return;
    const ids = new Set(list.map(i => i.id));
    bulk = true; items = items.filter(i => !ids.has(i.id)); sel.clear(); draw();
    const t = progressToast(`삭제하는 중 0/${list.length}`);
    const queue = [...list], fails = [];
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift();
        try {
          await Promise.all([ms.remove(it.driveId), ms.remove(it.thumbId), ms.remove(it.previewId)]);
          await db.remove(COL, it.id);
          db.deleteBlob('mt:' + it.id).catch(() => {}); db.deleteBlob('mp:' + it.id).catch(() => {});
        } catch (e) { fails.push(`${it.name}: ${e.message}`); }
        done++; t.set(done / list.length); t.text(`삭제하는 중 ${done}/${list.length}`);
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker)); }
    finally { t.done(); bulk = false; await load(); draw(); }
    if (fails.length) toast(`${list.length - fails.length}개 삭제, ${fails.length}개 실패 — ${fails[0]}`, 'err');
    else toast(`${list.length}개를 삭제했습니다`);
  }
  async function downloadItems(list) {
    let i = 0;
    for (const it of list) {
      i++;
      const t = progressToast(`원본 내려받는 중 (${i}/${list.length}) ${it.name}`);
      try { const blob = await ms.download(it.driveId, it.size, it.mime, (d, n) => t.set(d / n)); download(it.name, blob); }
      catch (e) { toast(`${it.name}: ${e.message}`, 'err'); }
      finally { t.done(); }
    }
  }
  const saveItem = async (it, patch) => { const { _hay, ...rest } = { ...it, ...patch }; await db.put(COL, it.id, stripId(rest)); };
  const stripId = o => { const { id, updatedAt, ...r } = o; return r; };

  // ---------- uploading ----------
  const queue = [];
  let active = 0, upStats = { done: 0, total: 0, skipped: 0, failed: 0, bytes: 0, sent: 0 };
  async function addFiles(files) {
    try { ms.backend(); } catch (e) { toast(e.message, 'err'); return; }
    const known = new Set(items.map(i => i.hash));
    upPanel.hidden = false;
    for (const file of files) {
      const row = { file, status: '대기', pct: 0, el: null };
      row.el = h('div', { class: 'md-uprow' }, h('span', { class: 'grow md-upname' }, file.name), h('span', { class: 'md-upst' }, '대기'), h('span', { class: 'md-bar' }, h('i')));
      row.known = known;
      queue.push(row); upStats.total++; upStats.bytes += file.size;
    }
    drawUploads(); pumpUploads();
  }
  function drawUploads() {
    const pending = queue.filter(r => r.status !== '완료' && r.status !== '중복' && !r.error);
    const pct = upStats.bytes ? Math.round(upStats.sent / upStats.bytes * 100) : 0;
    upPanel.replaceChildren(
      h('div', { class: 'md-uphead' }, h('b', null, pending.length ? `올리는 중 ${upStats.done}/${upStats.total} · ${pct}%` : `올리기 끝 · ${upStats.done}개`),
        upStats.skipped ? h('span', { class: 'muted' }, ` · 중복 ${upStats.skipped}개 건너뜀`) : null,
        upStats.failed ? h('span', { class: 'error' }, ` · 실패 ${upStats.failed}개`) : null,
        h('span', { class: 'grow' }),
        !pending.length ? h('button', { class: 'btn small ghost', onclick: () => { queue.length = 0; upStats = { done: 0, total: 0, skipped: 0, failed: 0, bytes: 0, sent: 0 }; upPanel.hidden = true; } }, '닫기') : null),
      h('div', { class: 'md-uplist' }, ...queue.slice(-60).map(r => r.el)));
  }
  function pumpUploads() {
    while (active < UPLOADS_AT_ONCE) {
      const row = queue.find(r => r.status === '대기'); if (!row) break;
      active++; row.status = '준비';
      uploadOne(row).finally(() => { active--; drawUploads(); pumpUploads(); });
    }
  }
  const setRow = (row, st, pct) => { row.status = st; row.el.querySelector('.md-upst').textContent = st; if (pct != null) row.el.querySelector('.md-bar i').style.width = Math.round(pct * 100) + '%'; };
  async function uploadOne(row) {
    const { file } = row;
    let counted = 0;
    try {
      setRow(row, '확인 중', 0);
      const info = await ms.inspect(file);
      if (row.known.has(info.hash) || items.some(i => i.hash === info.hash)) { setRow(row, '중복', 1); row.el.classList.add('skip'); upStats.skipped++; upStats.sent += file.size; return; }
      row.known.add(info.hash);
      const id = uid();
      setRow(row, '올리는 중', 0);
      const driveId = await ms.uploadOriginal(file, { id, name: file.name }, (d, n) => { const delta = d - counted; counted = d; upStats.sent += delta; setRow(row, '올리는 중 ' + Math.round(d / n * 100) + '%', d / n); if (Math.random() < .2) drawUploadsHead(); });
      const thumbId = info.thumb ? await ms.uploadSmall(info.thumb, { id, name: file.name + '.thumb.jpg', v: 'thumb' }) : null;
      const previewId = info.preview ? await ms.uploadSmall(info.preview, { id, name: file.name + '.preview.jpg', v: 'preview' }) : null;
      if (info.thumb) await db.putBlob('mt:' + id, info.thumb, { uploaded: true, cache: true });
      const folder = f.folder && f.folder !== NOFOLDER ? f.folder : '';
      const rec = { name: file.name, type: info.type, mime: info.mime, size: file.size, hash: info.hash, phash: info.phash || '', taken: info.taken, dateSource: info.dateSource,
        width: info.width || 0, height: info.height || 0, duration: info.duration || 0, camera: info.camera || '', gps: info.gps || null,
        folder, themes: f.theme ? [f.theme] : [], fav: false, driveId, thumbId, previewId, addedAt: Date.now() };
      await db.put(COL, id, rec);
      setRow(row, '완료', 1); row.el.classList.add('ok'); upStats.done++;
    } catch (e) {
      row.error = true; upStats.failed++; setRow(row, '실패: ' + e.message); row.el.classList.add('fail');
      upStats.sent += Math.max(0, file.size - counted);
    }
  }
  const drawUploadsHead = () => { const hd = upPanel.querySelector('.md-uphead b'); if (hd) hd.textContent = `올리는 중 ${upStats.done}/${upStats.total} · ${upStats.bytes ? Math.round(upStats.sent / upStats.bytes * 100) : 0}%`; };

  // ---------- viewer ----------
  let viewer = null;
  async function openViewer(it) {
    closeViewer();
    const list = filtered();
    let idx = list.findIndex(i => i.id === it.id);
    const stage = h('div', { class: 'md-vstage' });
    const infoBox = h('aside', { class: 'md-vinfo' });
    const wrap = h('div', { class: 'md-viewer', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' },
      h('div', { class: 'md-vtop' },
        h('button', { class: 'btn small ghost', onclick: closeViewer }, '✕ 닫기'), h('span', { class: 'grow md-vname' }),
        h('button', { class: 'btn small ghost', onclick: () => step(-1), title: '이전 (←)' }, '‹'), h('button', { class: 'btn small ghost', onclick: () => step(1), title: '다음 (→)' }, '›')),
      h('div', { class: 'md-vbody' }, stage, infoBox));
    document.body.append(wrap); wrap.focus();
    let objectUrls = [];
    const step = d => { const n = idx + d; if (n >= 0 && n < list.length) { idx = n; show(list[idx]); } };
    const onKey = e => { if (e.target.closest('input,textarea')) return; if (e.key === 'Escape') closeViewer(); if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); };
    wrap.addEventListener('keydown', onKey);
    viewer = { wrap, cleanup: () => objectUrls.forEach(u => URL.revokeObjectURL(u)) };

    async function show(cur) {
      cur = items.find(i => i.id === cur.id) || cur;
      wrap.querySelector('.md-vname').textContent = cur.name;
      objectUrls.forEach(u => URL.revokeObjectURL(u)); objectUrls = [];
      const prog = h('div', { class: 'md-vprog' });
      stage.replaceChildren(prog);
      try {
        const prev = cur.previewId ? await ms.cachedImage(cur.previewId, 'mp:' + cur.id) : cur.thumbId ? await ms.cachedImage(cur.thumbId, 'mt:' + cur.id) : null;
        if (prev && list[idx].id === cur.id) { const u = URL.createObjectURL(prev); objectUrls.push(u); stage.replaceChildren(h('img', { src: u, alt: cur.name }), prog); }
        if (cur.type === 'video') stage.append(h('button', { class: 'md-play', onclick: () => playVideo(cur) }, '▶ 재생'));
      } catch (e) { stage.replaceChildren(h('p', { class: 'error' }, '미리보기를 불러오지 못했습니다: ' + e.message)); }
      drawInfo(cur);
    }
    async function playVideo(cur) {
      const prog = stage.querySelector('.md-vprog') || stage.appendChild(h('div', { class: 'md-vprog' }));
      try {
        prog.textContent = '동영상 내려받는 중…';
        const blob = await ms.download(cur.driveId, cur.size, cur.mime, (d, n) => { prog.textContent = `동영상 내려받는 중… ${Math.round(d / n * 100)}%`; });
        const u = URL.createObjectURL(blob); objectUrls.push(u);
        stage.replaceChildren(h('video', { src: u, controls: true, autoplay: true, playsInline: true }));
      } catch (e) { prog.textContent = '재생하지 못했습니다: ' + e.message; }
    }
    function drawInfo(cur) {
      const save = patch => saveItem(cur, patch).then(() => { Object.assign(cur, patch); drawInfo(cur); });
      const themeIn = h('input', { type: 'text', placeholder: '테마 추가 + Enter', list: 'md-themelist' });
      themeIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && themeIn.value.trim()) { const t = themeIn.value.trim().replace(/^#/, ''); save({ themes: [...new Set([...(cur.themes || []), t])] }); if (!meta.themes.includes(t)) { meta.themes.push(t); saveMeta(); } } });
      const folderIn = h('input', { type: 'text', value: cur.folder || '', list: 'md-folderlist', placeholder: NOFOLDER, onchange: e => save({ folder: e.target.value.trim().replace(/\/+$/, '') }) });
      const dateIn = h('input', { type: 'datetime-local', value: (cur.taken || '').slice(0, 16), onchange: e => e.target.value && save({ taken: e.target.value + ':00', dateSource: 'user' }) });
      const row = (k, v) => v ? h('div', { class: 'md-kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v)) : null;
      infoBox.replaceChildren(
        h('div', { class: 'row' },
          h('button', { class: 'btn small' + (cur.fav ? ' primary' : ''), onclick: () => save({ fav: !cur.fav }) }, cur.fav ? '♥ 즐겨찾기' : '♡ 즐겨찾기'),
          h('button', { class: 'btn small', onclick: () => downloadItems([cur]) }, '원본 다운로드'),
          cur.type === 'video' ? h('button', { class: 'btn small', onclick: () => { closeViewer(); editVideos([cur]); } }, '동영상 편집') : null,
          h('button', { class: 'btn small ghost danger', onclick: async () => { await removeItems([cur]); if (!items.find(i => i.id === cur.id)) closeViewer(); } }, '삭제')),
        h('label', { class: 'field' }, '찍은 날짜', dateIn, cur.dateSource === 'file' ? h('span', { class: 'hint', style: { margin: 0 } }, '사진 정보에 날짜가 없어 파일 날짜를 썼습니다') : null),
        h('label', { class: 'field' }, '폴더', folderIn, h('datalist', { id: 'md-folderlist' }, ...allFolders().map(o => h('option', { value: o })))),
        h('div', { class: 'field' }, '테마', h('div', { class: 'md-themes' }, ...(cur.themes || []).map(t => h('button', { class: 'chip', title: '빼기', onclick: () => save({ themes: cur.themes.filter(x => x !== t) }) }, '#' + t, ' ✕'))), themeIn,
          h('datalist', { id: 'md-themelist' }, ...allThemes().map(o => h('option', { value: o })))),
        h('div', { class: 'md-kvs' },
          row('크기', fmtSize(cur.size) + ' (원본)'),
          row('해상도', cur.width ? `${cur.width} × ${cur.height}` : ''),
          row('길이', fmtDur(cur.duration)),
          row('기기', cur.camera),
          row('형식', cur.mime),
          cur.gps ? h('div', { class: 'md-kv' }, h('span', { class: 'k' }, '위치'), h('a', { href: `https://maps.google.com/?q=${cur.gps[0]},${cur.gps[1]}`, target: '_blank', rel: 'noopener' }, '지도에서 보기'))  : null),
        h('div', { class: 'field' }, 'AI 설명',
          cur.aiDesc ? h('p', { class: 'md-ai' }, cur.aiDesc, h('br'), ...(cur.aiTags || []).map(t => h('span', { class: 'md-tag' }, t))) : h('p', { class: 'hint', style: { margin: 0 } }, '아직 없습니다.'),
          h('button', { class: 'btn small', onclick: async () => { await aiTagAll([cur], true); const n = items.find(i => i.id === cur.id); if (n) drawInfo(n); } }, cur.aiDesc ? '✦ 다시 만들기' : '✦ AI 설명 만들기')));
    }
    show(list[idx] || it);
  }
  function closeViewer() { if (!viewer) return; viewer.cleanup(); viewer.wrap.remove(); viewer = null; }

  // ---------- duplicates ----------
  async function findDuplicates() {
    const groups = [];
    const used = new Set();
    const by = key => { const m = new Map(); for (const it of items) { const k = key(it); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(it); } return [...m.values()].filter(a => a.length > 1); };
    for (const g of by(i => i.hash)) { groups.push({ why: '완전히 같은 파일', list: g }); g.forEach(i => used.add(i.id)); }
    for (const g of by(i => i.taken && i.dateSource === 'meta' && i.width ? `${i.taken}|${i.camera}|${i.width}x${i.height}` : '')) {
      const rest = g.filter(i => !used.has(i.id)); if (rest.length > 1) { groups.push({ why: '찍은 시각·기기·해상도가 같음', list: rest }); rest.forEach(i => used.add(i.id)); }
    }
    const imgs = items.filter(i => i.phash && !used.has(i.id) && i.type === 'image').sort((a, b) => (a.taken || '').localeCompare(b.taken || ''));
    for (let i = 0; i < imgs.length; i++) {
      if (used.has(imgs[i].id)) continue;
      const g = [imgs[i]];
      for (let j = i + 1; j < imgs.length && j < i + 40; j++) {
        if (used.has(imgs[j].id)) continue;
        const d = ms.hamming(imgs[i].phash, imgs[j].phash);
        const close = imgs[i].taken && imgs[j].taken && Math.abs(new Date(imgs[i].taken) - new Date(imgs[j].taken)) < 10 * 60 * 1000;
        if (d <= 5 || (close && d <= 10)) g.push(imgs[j]);
      }
      if (g.length > 1) { groups.push({ why: '거의 같은 사진 (연속 촬영 등)', list: g }); g.forEach(x => used.add(x.id)); }
    }
    if (!groups.length) { toast('중복으로 보이는 사진이 없습니다'); return; }
    const pick = new Set();
    groups.forEach(g => { const keep = [...g.list].sort((a, b) => b.size - a.size)[0]; g.list.forEach(i => { if (i !== keep) pick.add(i.id); }); });
    const body = h('div', { class: 'md-dups' }, h('p', { class: 'hint' }, `${groups.length}묶음을 찾았습니다. 묶음마다 가장 큰 파일 하나를 남기고 나머지를 골라 두었습니다. 지울 것을 확인하세요.`),
      ...groups.map(g => h('div', { class: 'md-dupgroup' }, h('div', { class: 'md-dupwhy' }, g.why),
        h('div', { class: 'md-grid small' }, ...g.list.map(it => {
          const t = tile(it); t.onclick = null;
          const chk = h('input', { type: 'checkbox', checked: pick.has(it.id), onchange: e => e.target.checked ? pick.add(it.id) : pick.delete(it.id) });
          return h('label', { class: 'md-dupitem' }, t, h('span', { class: 'row' }, chk, h('span', { class: 'muted' }, `${fmtSize(it.size)} · ${(it.taken || '').slice(0, 16).replace('T', ' ')}`)));
        })))));
    const r = await dialog({ title: '중복 사진·동영상', wide: true, body, actions: [{ label: '닫기' }, { label: '고른 것 삭제', kind: 'danger', value: 'del' }] });
    if (r === 'del' && pick.size) await removeItems(items.filter(i => pick.has(i.id)));
  }

  // ---------- AI descriptions ----------
  let aiJob = null;
  async function aiTagAll(list, force = false) {
    if (aiJob) { aiJob.stop = true; return; }
    try { await apiKey(); } catch (e) { toast(e.message, 'err'); return; }
    const todo = (list || items).filter(i => force || !i.aiDesc);
    if (!todo.length) { toast('모든 사진에 AI 설명이 있습니다'); return; }
    // 사진 1장 ≈ 입력 450토큰(지시문+작은 사진) + 출력 150토큰, 의미 검색용 임베딩은 거의 0
    const vm = visionModel(), one = usdOf(vm, 450, 150) + usdOf('text-embedding-3-small', 60, 0);
    if (!await confirmCost({ provider: 'openai', model: vm, kind: 'vision', inTok: 450 * todo.length, outTok: 150 * todo.length, usd: one * todo.length, count: todo.length,
      note: `${todo.length}장에 AI 설명을 만듭니다(1장 약 ${(one * rate()).toFixed(2)}원). 진행 중에 버튼을 한 번 더 누르면 멈춥니다.` })) return;
    aiJob = { stop: false };
    const t = progressToast('AI 설명을 만드는 중…');
    let n = 0;
    const work = async () => {
      while (todo.length && !aiJob.stop) {
        const it = todo.shift();
        try {
          const blob = await ms.cachedImage(it.thumbId, 'mt:' + it.id);
          if (!blob) continue;
          const r = await describeImage(await blobToDataUrl(blob), [it.type === 'video' ? '동영상의 한 장면' : '', it.folder, (it.themes || []).join(',')].filter(Boolean).join(' / '));
          const [v] = await embed([r.desc + ' ' + r.tags.join(' ') + ' ' + (it.themes || []).join(' ')]);
          await saveItem(items.find(i => i.id === it.id) || it, { aiDesc: r.desc, aiTags: r.tags, aiVec: vecToB64(v) });
          n++; t.text(`AI 설명을 만드는 중… ${n}개 완료`);
        } catch (e) { toast(`${it.name}: ${e.message}`, 'err'); if (/키|401/.test(e.message)) aiJob.stop = true; }
      }
    };
    await Promise.all([work(), work()]);
    t.done(); toast(aiJob.stop ? `멈췄습니다 · ${n}개 완료` : `AI 설명 ${n}개를 만들었습니다`); aiJob = null;
  }

  // ---------- video editor ----------
  async function editVideos(list) {
    const { openVideoEditor } = await import('../videoedit.js');
    const out = await openVideoEditor(list, { download: it => ms.download(it.driveId, it.size, it.mime) });
    if (out && out.length) { toast(`편집한 동영상 ${out.length}개를 올립니다`); addFiles(out); }
  }

  // ---------- storage ----------
  async function storageInfo() {
    const total = items.reduce((n, i) => n + (i.size || 0), 0);
    const cache = (await db.cacheSize?.()) || 0;
    let quota = '';
    try {
      const b = ms.backend();
      const r = await b.req('https://www.googleapis.com/drive/v3/about?fields=storageQuota');
      const q = r.storageQuota; if (q && q.limit) quota = `Google 저장공간 ${fmtSize(Number(q.usage))} / ${fmtSize(Number(q.limit))} 사용 중`;
      else if (q) quota = `Google 저장공간 ${fmtSize(Number(q.usage))} 사용 중`;
    } catch {}
    const r = await dialog({ title: '저장공간', body: [
      h('div', { class: 'md-kvs' },
        h('div', { class: 'md-kv' }, h('span', { class: 'k' }, '사진·동영상 원본'), h('span', { class: 'v' }, `${items.length.toLocaleString('ko-KR')}개 · ${fmtSize(total)} (Google Drive)`)),
        quota ? h('div', { class: 'md-kv' }, h('span', { class: 'k' }, '계정 전체'), h('span', { class: 'v' }, quota)) : null,
        h('div', { class: 'md-kv' }, h('span', { class: 'k' }, '이 기기에 둔 미리보기'), h('span', { class: 'v' }, fmtSize(cache)))),
      h('p', { class: 'hint' }, '원본은 Google Drive에만 있고, 이 기기에는 작은 미리보기만 둡니다(iCloud ‘저장 공간 최적화’와 같은 방식). 미리보기를 비워도 다시 볼 때 자동으로 받아옵니다.')],
      actions: [{ label: '닫기' }, { label: '이 기기 미리보기 비우기', kind: 'danger', value: 'clear' }] });
    if (r === 'clear') { await db.clearCache?.(); urlCache.clear(); toast('미리보기를 비웠습니다'); draw(); }
  }

  // ---------- live updates ----------
  const onChange = async e => { if (bulk || (e.detail.col !== COL && e.detail.col !== 'mediaMeta')) return; await load(); draw(); };
  const redraw = debounce(onChange, 300);
  db.events.addEventListener('change', redraw);
  await load();
  draw();
  setTimeout(() => searchIn.focus(), 0);
  return { open: () => {}, cleanup: () => { closeViewer(); db.events.removeEventListener('change', redraw); }, addFiles };
}

const TRASH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.9 11.6A1.5 1.5 0 0 0 8.9 20h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10.2 11v5.2M13.8 11v5.2"/></svg>';

function progressToast(text) {
  const bar = h('i');
  const label = h('span', null, text);
  const t = h('div', { class: 'toast md-ptoast' }, label, h('span', { class: 'md-bar' }, bar));
  document.getElementById('toasts').append(t);
  return { set: p => { bar.style.width = Math.round(p * 100) + '%'; }, text: s => { label.textContent = s; }, done: () => t.remove() };
}
