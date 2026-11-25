// MyPC Search: find files on this PC by name.
// Windows app: Windows Search index (fast), a chosen folder, or every drive.
// Chrome/Edge without the app: only inside a folder the user picks (browser security limit).
import { h, copyText, toast, icon, debounce } from '../util.js';
import { native } from '../native.js';

const MAX = 500;
let lastQuery = '', lastScope = 'index', lastFolder = '';

export async function mount(root) {
  const canPick = !native.available && 'showDirectoryPicker' in window;
  let scope = native.available ? lastScope : 'folder';
  let folder = lastFolder, dirHandle = null, items = [], selected = -1, running = null;

  const query = h('input', { type: 'search', value: lastQuery, placeholder: '찾을 파일 이름을 입력하세요  (예: 보고서 *.pdf, 설비 점검)', 'aria-label': '검색어', autocomplete: 'off' });
  const searchBtn = h('button', { class: 'btn primary', onclick: run }, '검색');
  const stopBtn = h('button', { class: 'btn', hidden: true, onclick: () => { if (running) running.cancelled = true; } }, '중지');
  const scopeSeg = h('div', { class: 'seg' });
  const folderLabel = h('span', { class: 'muted', style: { fontSize: '13.5px' } });
  const status = h('p', { class: 'hint', style: { margin: '10px 0 6px' } });
  const tbody = h('tbody');
  const acts = {
    open: h('button', { class: 'btn small', disabled: true, onclick: () => act('open') }, '파일 열기'),
    reveal: h('button', { class: 'btn small', disabled: true, onclick: () => act('reveal') }, '파일 위치 열기'),
    copy: h('button', { class: 'btn small', disabled: true, onclick: () => act('copy') }, '경로 복사')
  };

  const scopes = native.available
    ? [['index', '빠른 검색'], ['folder', '폴더 지정'], ['all', '전체 드라이브']]
    : [['folder', '폴더 지정']];
  // 전체 드라이브 uses a file list the app builds in the background and keeps up to date.
  let catalog = null, waitingForCatalog = false;
  const catalogText = () => !catalog ? '모든 드라이브에서 찾습니다'
    : catalog.ready ? `전체 파일 목록 ${Number(catalog.count).toLocaleString('ko-KR')}개 · ${catalog.builtAt.slice(5)} 기준` + (catalog.building ? ' · 새로 읽는 중…' : '')
    : catalog.building ? `전체 파일 목록을 처음 만드는 중… ${Number(catalog.count).toLocaleString('ko-KR')}개 확인 (몇 분 걸릴 수 있음)` : '전체 파일 목록을 아직 만들지 않았습니다';
  const drawScope = () => {
    scopeSeg.replaceChildren(...scopes.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(scope === k), onclick: () => setScope(k) }, l)));
    folderLabel.replaceChildren(scope === 'folder' ? (folder ? '폴더: ' + folder : '폴더를 골라 주세요') : scope === 'all' ? catalogText() : 'Windows 검색 색인에서 찾습니다',
      scope === 'all' && catalog && !catalog.building ? h('button', { class: 'btn small ghost', style: { marginLeft: '6px' }, onclick: async () => { catalog = await native.call('files.rebuild'); drawScope(); } }, '다시 읽기') : '');
  };
  if (native.available) {
    native.call('files.catalog').then(c => { catalog = c; drawScope(); }).catch(() => {});
    native.on('catalog', c => {
      catalog = c; if (folderLabel.isConnected) drawScope();
      if (c.ready && !c.building && waitingForCatalog && scope === 'all' && query.value.trim()) { waitingForCatalog = false; run(); }
    });
  }
  async function setScope(k) {
    if (k === 'folder') {
      try {
        if (native.available) { const p = await native.call('shell.pickFolder'); if (!p) return; folder = p; }
        else { dirHandle = await window.showDirectoryPicker({ mode: 'read' }); folder = dirHandle.name; }
      } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'err'); return; }
    }
    scope = k; lastScope = k; lastFolder = folder;
    drawScope(); query.focus();
  }

  const select = i => {
    selected = i;
    [...tbody.children].forEach((tr, j) => tr.setAttribute('aria-selected', String(j === i)));
    Object.values(acts).forEach(b => { b.disabled = i < 0; });
    if (!native.available) { acts.reveal.disabled = true; acts.copy.disabled = i < 0; }
  };
  const drawRows = () => {
    tbody.replaceChildren(...items.map((f, i) => h('tr', { class: 'clickable', tabindex: '0', onclick: () => select(i), ondblclick: () => { select(i); act('open'); },
      onkeydown: e => { if (e.key === 'Enter') { select(i); act('open'); } } },
      h('td', null, f.name), h('td', { class: 'muted path' }, f.folder), h('td', { class: 'num muted' }, f.modified || ''), h('td', { class: 'num muted' }, f.size != null ? fmtSize(f.size) : ''))));
    select(-1);
  };

  async function run() {
    const q = query.value.trim();
    if (!q) { query.focus(); return; }
    if (running && native.available) return;
    lastQuery = q;
    if (scope === 'folder' && !folder) { await setScope('folder'); if (!folder) return; }
    items = []; drawRows();
    const job = running = { cancelled: false };
    searchBtn.disabled = true; stopBtn.hidden = native.available;
    status.textContent = '찾는 중…';
    try {
      let truncated = false;
      if (native.available) {
        const r = await native.call('files.search', { query: q, scope, folder });
        items = r.items.map(f => ({ ...f, folder: f.path.slice(0, f.path.length - f.name.length).replace(/\\$/, '') }));
        truncated = r.truncated;
        if (r.catalog) { catalog = r.catalog; drawScope(); waitingForCatalog = !r.catalog.ready; }
      } else {
        truncated = await scanHandle(dirHandle, q, job, n => { status.textContent = `찾는 중… 파일 ${n.toLocaleString('ko-KR')}개 확인`; });
      }
      if (job.cancelled) status.textContent = `중지했습니다 · ${items.length}개`;
      else if (scope === 'all' && waitingForCatalog) status.textContent = `지금은 Windows 색인 결과 ${items.length}개입니다. 전체 파일 목록이 준비되면 자동으로 다시 찾습니다.`;
      else status.textContent = items.length ? `${items.length}개` + (truncated ? ` (처음 ${MAX}개만 표시 · 검색어를 더 좁혀 보세요)` : '') + ' · 두 번 누르면 파일이 열립니다.'
        : '찾은 파일이 없습니다.' + (scope === 'index' ? ' 색인되지 않은 폴더라면 ‘폴더 지정’이나 ‘전체 드라이브’로 찾아 보세요.' : '');
      drawRows();
    } catch (e) { status.textContent = ''; toast(e.message, 'err'); }
    finally { searchBtn.disabled = false; stopBtn.hidden = true; running = null; if (native.available && scope !== 'folder' && query.value.trim() !== lastQuery) live(); }
  }

  // Browser fallback: walk the picked folder.
  async function scanHandle(dir, q, job, progress) {
    const match = matcher(q);
    let seen = 0;
    const walk = async (handle, path) => {
      for await (const entry of handle.values()) {
        if (job.cancelled || items.length >= MAX) return;
        if (entry.kind === 'directory') { await walk(entry, path + '/' + entry.name); continue; }
        if (++seen % 500 === 0) progress(seen);
        if (!match(entry.name)) continue;
        const file = await entry.getFile().catch(() => null);
        items.push({ name: entry.name, folder: path, handle: entry, size: file ? file.size : null, modified: file ? fmtDate(file.lastModified) : '' });
      }
    };
    await walk(dir, dir.name);
    return items.length >= MAX;
  }

  async function act(kind) {
    const f = items[selected];
    if (!f) return;
    try {
      if (native.available) {
        if (kind === 'open') await native.call('shell.open', { path: f.path });
        if (kind === 'reveal') await native.call('shell.reveal', { path: f.path });
        if (kind === 'copy') copyText(f.path, '경로를 복사했습니다');
      } else {
        if (kind === 'open') { const file = await f.handle.getFile(); window.open(URL.createObjectURL(file), '_blank'); }
        if (kind === 'copy') copyText(f.folder + '/' + f.name, '경로를 복사했습니다');
      }
    } catch (e) { toast(e.message, 'err'); }
  }

  query.addEventListener('keydown', e => { if (e.key === 'Enter') { live.cancel(); run(); } if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); select(0); tbody.children[0].focus(); } });
  // Windows index search is fast enough to run as you type.
  const live = debounce(() => { if (native.available && (scope === 'index' || scope === 'all' && catalog && catalog.ready) && query.value.trim().length >= 2) run(); }, 380);
  query.addEventListener('input', live);
  drawScope();

  const supported = native.available || canPick;
  const hero = h('div', { class: 'hero-search' },
    h('h2', null, 'MyPC Search'),
    h('p', { class: 'sub' }, native.available ? '입력하는 대로 이 PC에서 파일을 찾습니다.' : supported ? '고른 폴더 안에서 파일을 찾습니다.' : '이 기기에서는 PC 파일을 찾을 수 없습니다. Windows 앱이나 PC의 Chrome·Edge에서 써 주세요.'),
    h('div', { class: 'hero-box' }, icon('files'), query, searchBtn, stopBtn),
    supported ? h('div', { class: 'opts' }, scopeSeg, folderLabel) : null);
  const results = supported ? [
      !native.available ? h('p', { class: 'hint' }, '브라우저에서는 고른 폴더 안만 찾을 수 있습니다. 빠른 검색(Windows 색인)과 전체 드라이브 검색은 Windows 앱(MY AIDE.exe)에서 쓸 수 있습니다.') : null,
      status,
      h('div', { class: 'row', style: { marginBottom: '6px' } }, acts.open, native.available ? acts.reveal : null, acts.copy),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data results' },
        h('thead', null, h('tr', null, h('th', null, '파일명'), h('th', null, '폴더'), h('th', { class: 'num' }, '수정일'), h('th', { class: 'num' }, '크기'))), tbody))] : [];
  if (!supported) { query.disabled = true; searchBtn.disabled = true; }

  root.append(hero, h('div', { class: 'pad', style: { paddingTop: '4px', maxWidth: 'none' } }, ...results.filter(Boolean)));
  setTimeout(() => query.focus(), 0);
  return { open: () => query.focus(), cleanup: () => live.cancel() };
}

function matcher(q) {
  const tests = q.split(/\s+/).filter(Boolean).map(t => {
    if (/[*?]/.test(t)) {
      const rx = new RegExp('^' + t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
      return n => rx.test(n);
    }
    const lower = t.toLowerCase();
    return n => n.toLowerCase().includes(lower);
  });
  return name => tests.every(t => t(name));
}
const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const fmtDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
