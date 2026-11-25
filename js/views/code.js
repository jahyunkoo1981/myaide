// VisualCode: a VS Code–style workspace for markdown and code.
// Files live in two places: 내 드라이브 (synced through Google Drive like every other record, phone included)
// and PC folders (real files; Windows app, or Chrome/Edge via the folder picker).
// Windows app extras: terminal + run, git changes/commit. Everywhere: tabs, search, markdown preview,
// version history (드라이브), AI helper (OpenAI key from 설정).
import { h, toast, icon, uid, debounce, confirmBox, promptBox, copyText, escapeHtml } from '../util.js';
import * as db from '../db.js';
import { native } from '../native.js';
import { renderMarkdown } from '../md.js';
import { chat } from '../openai.js';

const COL = 'code';
const BASE = new URL('vendor/monaco/', location.href).href;
let monacoP = null;
function loadMonaco() {
  if (monacoP) return monacoP;
  monacoP = new Promise((res, rej) => {
    window.MonacoEnvironment = { getWorkerUrl: () => 'data:text/javascript;charset=utf-8,' + encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${BASE}'};importScripts('${BASE}vs/base/worker/workerMain.js');`) };
    const go = () => {
      window.require.config({ paths: { vs: BASE + 'vs' }, 'vs/nls': { availableLanguages: { '*': 'ko' } } });
      window.require(['vs/editor/editor.main'], () => {
        const m = window.monaco;
        m.editor.defineTheme('myaide', { base: 'vs', inherit: true, rules: [{ token: 'comment', foreground: '8D92A6', fontStyle: 'italic' }, { token: 'keyword', foreground: '5A4FCF' }, { token: 'string', foreground: '2F8467' }, { token: 'number', foreground: 'C2673A' }],
          colors: { 'editor.background': '#FFFFFF', 'editor.lineHighlightBackground': '#F5F6FC', 'editorLineNumber.foreground': '#B4B8C8', 'editorLineNumber.activeForeground': '#6B74D6', 'editor.selectionBackground': '#DCE0FB', 'editorCursor.foreground': '#6B74D6', 'editorIndentGuide.background1': '#ECEEF5' } });
        res(m);
      }, rej);
    };
    if (window.require && window.require.config) return go();
    const s = document.createElement('script'); s.src = BASE + 'vs/loader.js'; s.onload = go; s.onerror = () => rej(new Error('편집기를 불러오지 못했습니다.')); document.head.append(s);
  });
  return monacoP;
}

const EXT_LANG = { md: 'markdown', markdown: 'markdown', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less', py: 'python', cs: 'csharp', java: 'java', kt: 'kotlin', go: 'go', rs: 'rust', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', sql: 'sql', xml: 'xml', yml: 'yaml', yaml: 'yaml', sh: 'shell', bat: 'bat', cmd: 'bat', ps1: 'powershell', php: 'php', rb: 'ruby', swift: 'swift', vb: 'vb', ini: 'ini', toml: 'ini', dockerfile: 'dockerfile', txt: 'plaintext', csv: 'plaintext', log: 'plaintext', r: 'r', lua: 'lua', dart: 'dart' };
const extOf = name => { const n = name.toLowerCase(); if (n === 'dockerfile') return 'dockerfile'; const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1) : ''; };
const langOf = name => EXT_LANG[extOf(name)] || 'plaintext';
const LANG_LABEL = { markdown: 'Markdown', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', csharp: 'C#', plaintext: '일반 텍스트', html: 'HTML', css: 'CSS', json: 'JSON', sql: 'SQL', powershell: 'PowerShell', bat: 'Batch', java: 'Java', cpp: 'C++', c: 'C', go: 'Go', yaml: 'YAML', xml: 'XML', shell: 'Shell' };
const RUN = { py: f => `python "${f}"`, js: f => `node "${f}"`, mjs: f => `node "${f}"`, ts: f => `npx -y tsx "${f}"`, ps1: f => `powershell -ExecutionPolicy Bypass -File "${f}"`, bat: f => `call "${f}"`, cmd: f => `call "${f}"`, go: f => `go run "${f}"`, java: f => `java "${f}"`, rb: f => `ruby "${f}"`, php: f => `php "${f}"`, sh: f => `bash "${f}"`, r: f => `Rscript "${f}"`, lua: f => `lua "${f}"` };
const baseName = p => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
const dirName = p => { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i > 0 ? p.slice(0, i) : ''; };
const stripAnsi = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r(?!\n)/g, '');
const FILE_ICON = { md: '📝', py: '🐍', js: '📜', ts: '📘', json: '🧾', html: '🌐', css: '🎨', cs: '#️⃣', sql: '🗃️', ps1: '⚡', bat: '⚙️', txt: '📄' };
const fileIcon = n => FILE_ICON[extOf(n)] || '📄';

// Old AIMD pages (rich text) → standard Markdown.
function htmlToMd(root) {
  const out = [];
  const inl = el => { let t = ''; for (const c of el.childNodes) { if (c.nodeType === 3) t += c.data; else if (c.nodeType === 1 && !/^(OL|UL)$/.test(c.tagName)) { const x = inl(c); t += /^(B|STRONG)$/.test(c.tagName) && x.trim() ? `**${x}**` : c.tagName === 'BR' ? '  \n' : c.tagName === 'A' && c.href ? `[${x}](${c.href})` : x; } } return t.replace(/\u00a0/g, ' '); };
  const list = (l, depth) => { let n = 0; for (const li of l.children) { if (li.tagName !== 'LI') continue; n++; const mark = l.classList.contains('check') ? (li.classList.contains('done') ? '- [x]' : '- [ ]') : l.tagName === 'OL' ? n + '.' : '-'; out.push('   '.repeat(depth) + mark + ' ' + inl(li).trim()); for (const s of li.children) if (/^(OL|UL)$/.test(s.tagName)) list(s, depth + 1); } };
  const walk = el => { for (const n of el.childNodes) {
    if (n.nodeType === 3) { if (n.data.trim()) out.push(n.data.trim()); continue; }
    if (n.nodeType !== 1) continue;
    if (/^(OL|UL)$/.test(n.tagName)) { list(n, 0); out.push(''); }
    else if (n.tagName === 'H2') out.push('## ' + inl(n).trim(), '');
    else if (n.tagName === 'H3') out.push('### ' + inl(n).trim(), '');
    else if (n.tagName === 'BLOCKQUOTE') out.push(...inl(n).split('\n').map(x => '> ' + x.trim()), '');
    else if (n.tagName === 'PRE') out.push('```', n.textContent, '```', '');
    else if (n.tagName === 'IMG') out.push('(그림)');
    else if (n.querySelector('ol, ul, h2, h3, p, div, blockquote, pre')) walk(n);
    else { const t = inl(n).trim(); out.push(t, ''); }
  } };
  walk(root);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export async function mount(root, ctx) {
  // ---------- state ----------
  let monaco = null, editor = null, diffEd = null;
  const tabs = [];                 // {key, kind:'d'|'p'|'f', name, path, model, saved, mtime, encoding, recId, rootIdx, handle}
  let active = null;
  const expanded = new Set(JSON.parse(await db.kvGet('vc-expanded', '[]') || '[]'));
  let pcRoots = [];                // [{path, name, items:[rel...]}] (Windows app)
  const fsaRoots = [];             // [{name, handle, items:[{rel, handle, dir}]}] (Chrome/Edge)
  let driveRecs = [];
  let side = 'files';

  // ---------- AIMD → VisualCode (once): old prompt notes become markdown files under AIMD/ ----------
  if (!await db.kvGet('vc-aimd-migrated')) {
    const old = await db.all('aimd');
    const have = new Set((await db.all(COL)).map(r => r.path));
    for (const r of old) {
      const div = document.createElement('div'); div.innerHTML = r.body || '';
      let name = (r.title || '제목 없음').replace(/[\\/:*?"<>|]/g, ' ').trim() || '제목 없음', path = `AIMD/${name}.md`, n = 2;
      while (have.has(path)) path = `AIMD/${name} (${n++}).md`;
      have.add(path);
      await db.put(COL, uid(), { path, content: (r.title ? `# ${r.title}\n\n` : '') + htmlToMd(div), hist: [] });
    }
    await db.kvSet('vc-aimd-migrated', true);
  }

  // ---------- layout ----------
  const actBtn = (key, ic, label) => h('button', { class: 'vc-act' + (side === key ? ' on' : ''), title: label, 'aria-label': label, 'data-side': key, onclick: () => showSide(key) }, h('span', { class: 'vc-ico', html: ic }));
  const IC = {
    files: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg>',
    git: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="9" r="2.4"/><path d="M6 8.4v7.2M18 11.4c0 3-4 3.6-10 5"/></svg>',
    ai: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.6L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.9z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>',
    term: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7 10 3 2.5L7 15M12.5 15H17"/></svg>',
    help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.4M12 17h.01"/></svg>'
  };
  const activity = h('nav', { class: 'vc-activity' },
    actBtn('files', IC.files, '탐색기 (Ctrl+Shift+E)'), actBtn('search', IC.search, '검색 (Ctrl+Shift+F)'), actBtn('git', IC.git, '변경·기록'), actBtn('ai', IC.ai, 'AI 코드 도우미'),
    h('span', { class: 'grow' }),
    h('button', { class: 'vc-act', title: '터미널 (Ctrl+`)', 'aria-label': '터미널', onclick: () => toggleTerm() }, h('span', { class: 'vc-ico', html: IC.term })),
    h('button', { class: 'vc-act', title: '사용법·단축키', 'aria-label': '사용법', onclick: () => help() }, h('span', { class: 'vc-ico', html: IC.help })));
  const sidePane = h('aside', { class: 'vc-side' });
  const tabBar = h('div', { class: 'vc-tabs', role: 'tablist' });
  const tabTools = h('div', { class: 'vc-tabtools' });
  const edHost = h('div', { class: 'vc-ed' });
  const preview = h('div', { class: 'vc-preview md-body', hidden: true });
  const welcome = h('div', { class: 'vc-welcome' });
  const diffBar = h('div', { class: 'vc-diffbar', hidden: true });
  const diffHost = h('div', { class: 'vc-diff', hidden: true });
  const termOut = h('pre', { class: 'vc-term-out', tabindex: 0 });
  const termIn = h('input', { class: 'vc-term-in', placeholder: native.available ? '명령을 입력하고 Enter  (예: python --version)' : '', spellcheck: false, autocomplete: 'off' });
  const shellSel = h('select', { class: 'vc-shell', title: '셸' }, h('option', { value: 'cmd' }, 'cmd'), h('option', { value: 'powershell' }, 'PowerShell'));
  const termPanel = h('section', { class: 'vc-term', hidden: true },
    h('div', { class: 'vc-term-head' }, h('b', null, '터미널'), shellSel,
      h('button', { class: 'btn small ghost', onclick: () => startTerm(true) }, '새로 시작'),
      h('button', { class: 'btn small ghost', title: '실행 중인 것을 멈춥니다 (Ctrl+C 대신)', onclick: () => startTerm(true, '중지했습니다') }, '■ 중지'),
      h('button', { class: 'btn small ghost', onclick: () => { termOut.textContent = ''; } }, '지우기'),
      h('span', { class: 'grow' }), h('button', { class: 'btn small ghost', 'aria-label': '터미널 닫기', onclick: () => toggleTerm(false) }, '✕')),
    termOut, h('div', { class: 'vc-term-line' }, h('span', { class: 'vc-term-pr' }, '›'), termIn));
  const status = h('footer', { class: 'vc-status' });
  const main = h('section', { class: 'vc-main' },
    h('div', { class: 'vc-tabrow' }, h('button', { class: 'vc-sidebtn', 'aria-label': '사이드 열기/닫기', title: '사이드 열기/닫기 (Ctrl+B)', onclick: () => wrap.classList.toggle('side-off') }, '☰'), tabBar, tabTools),
    h('div', { class: 'vc-work' }, welcome, edHost, preview, h('div', { class: 'vc-diffwrap' }, diffBar, diffHost)),
    termPanel, status);
  const wrap = h('div', { class: 'vc' }, activity, sidePane, main);
  root.replaceChildren(wrap);
  if (matchMedia('(max-width: 820px)').matches) wrap.classList.add('side-off');

  welcome.append(h('div', { class: 'vc-wel-in' },
    h('h2', null, 'VisualCode'),
    h('p', { class: 'hint' }, 'Markdown 문서와 코드를 VS Code처럼 관리합니다.'),
    h('div', { class: 'vc-wel-acts' },
      h('button', { class: 'btn primary', onclick: () => newFile('d', '') }, '새 파일 (내 드라이브)'),
      h('button', { class: 'btn', onclick: openPcFolder }, 'PC 폴더 열기'),
      h('button', { class: 'btn ghost', onclick: quickOpen }, '파일 찾기  Ctrl+P')),
    h('ul', { class: 'vc-wel-tips' },
      h('li', null, h('b', null, '내 드라이브'), ' — 구글드라이브에 저장되어 PC·폰 어디서나 같은 파일. 저장할 때마다 변경 기록이 남습니다.'),
      h('li', null, h('b', null, 'PC 폴더'), ' — 내 PC의 실제 프로젝트 폴더를 열어 편집. Windows 앱에서는 터미널·실행·Git까지 됩니다.'),
      h('li', null, h('b', null, 'AI 도우미'), ' — 코드를 선택하고 설명·고치기·주석·테스트를 요청하면 바뀐 부분을 비교해서 보여 줍니다.'))));

  // ---------- data: 내 드라이브 ----------
  async function loadDrive() { driveRecs = (await db.all(COL)).sort((a, b) => a.path.localeCompare(b.path, 'ko')); }
  async function loadPc() {
    if (!native.available) return;
    try {
      const roots = await native.call('code.roots');
      pcRoots = await Promise.all((roots || []).map(async r => { try { const l = await native.call('code.list', { root: r.path }); return { path: r.path, name: r.name, items: l.items, truncated: l.truncated }; } catch (e) { return { path: r.path, name: r.name, items: [], error: e.message }; } }));
    } catch (e) { toast(e.message, 'err'); }
  }
  async function listFsa(r) {
    const items = [];
    async function walk(dir, rel, depth) {
      if (depth > 12 || items.length > 8000) return;
      const ents = []; for await (const [n, hd] of dir.entries()) ents.push([n, hd]);
      ents.sort((a, b) => (a[1].kind === b[1].kind ? a[0].localeCompare(b[0]) : a[1].kind === 'directory' ? -1 : 1));
      for (const [n, hd] of ents) {
        if (hd.kind === 'directory') { items.push({ rel: rel + n + '/', handle: hd, dir: true }); if (!['.git', 'node_modules', 'bin', 'obj', '__pycache__', '.venv', 'dist'].includes(n)) await walk(hd, rel + n + '/', depth + 1); }
        else items.push({ rel: rel + n, handle: hd });
      }
    }
    await walk(r.handle, '', 0); r.items = items;
  }

  // ---------- explorer ----------
  const saveExpanded = debounce(() => db.kvSet('vc-expanded', JSON.stringify([...expanded])), 400);
  function treeFrom(paths) {   // paths like 'a/b.md', 'a/' -> nested
    const rootN = { dirs: new Map(), files: [] };
    for (const p of paths) {
      const isDir = p.path.endsWith('/'); const parts = p.path.replace(/\/$/, '').split('/');
      let n = rootN;
      for (let i = 0; i < parts.length - (isDir ? 0 : 1); i++) { const part = parts[i]; if (!n.dirs.has(part)) n.dirs.set(part, { dirs: new Map(), files: [], rel: parts.slice(0, i + 1).join('/') + '/' }); n = n.dirs.get(part); }
      if (!isDir) n.files.push({ name: parts[parts.length - 1], ...p });
    }
    return rootN;
  }
  function drawTree(node, scope, depth, openFile, ctxMenu) {
    const out = [];
    const dirs = [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'));
    for (const [name, d] of dirs) {
      const id = scope + ':' + d.rel, open = expanded.has(id);
      out.push(h('div', { class: 'vc-row dir' + (open ? ' open' : ''), style: { paddingLeft: 8 + depth * 14 + 'px' }, title: d.rel,
        onclick: () => { open ? expanded.delete(id) : expanded.add(id); saveExpanded(); drawSide(); },
        oncontextmenu: e => ctxMenu(e, { dir: true, rel: d.rel, name }) },
        h('span', { class: 'vc-tw' }, open ? '▾' : '▸'), h('span', { class: 'vc-fi' }, open ? '📂' : '📁'), h('span', { class: 'vc-nm' }, name)));
      if (open) out.push(...drawTree(d, scope, depth + 1, openFile, ctxMenu));
    }
    for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name, 'ko'))) {
      const key = f.key;
      out.push(h('div', { class: 'vc-row file' + (active && active.key === key ? ' on' : ''), style: { paddingLeft: 22 + depth * 14 + 'px' }, title: f.path,
        onclick: () => openFile(f), oncontextmenu: e => ctxMenu(e, { dir: false, rel: f.path, name: f.name, f }) },
        h('span', { class: 'vc-fi' }, fileIcon(f.name)), h('span', { class: 'vc-nm' }, f.name), tabs.find(t => t.key === key && isDirty(t)) ? h('span', { class: 'vc-dot' }, '●') : null));
    }
    return out;
  }
  const sectionHead = (title, sub, acts, cls) => h('div', { class: 'vc-sec ' + (cls || '') }, h('div', { class: 'vc-sec-t' }, h('b', null, title), sub ? h('span', null, sub) : null), h('div', { class: 'vc-sec-acts' }, ...acts));
  const mini = (label, title, fn) => h('button', { class: 'vc-mini', title, 'aria-label': title, onclick: e => { e.stopPropagation(); fn(); } }, label);

  function drawFiles() {
    const parts = [h('div', { class: 'vc-side-t' }, '탐색기')];
    // 내 드라이브
    const dTree = treeFrom(driveRecs.map(r => ({ path: r.folder ? r.path : r.path, key: 'd:' + r.id, recId: r.id, folder: r.folder })).filter(r => r.folder ? true : true));
    parts.push(sectionHead('내 드라이브', 'PC·폰 동기화', [mini('＋', '새 파일', () => newFile('d', '')), mini('▣', '새 폴더', () => newFolder('d', '')), mini('↻', '새로 고침', async () => { await loadDrive(); drawSide(); })], 'drive'));
    const dRows = drawTree(dTree, 'd', 0, f => openTab({ kind: 'd', recId: f.recId }), (e, it) => menu(e, 'd', it));
    parts.push(dRows.length ? h('div', { class: 'vc-tree' }, ...dRows) : h('p', { class: 'vc-empty' }, '파일이 없습니다. ＋ 로 만들어 보세요.'));
    // PC folders (Windows app)
    pcRoots.forEach((r, i) => {
      parts.push(sectionHead(r.name, r.path, [mini('＋', '새 파일', () => newFile('p', '', r)), mini('▣', '새 폴더', () => newFolder('p', '', r)), mini('↻', '새로 고침', () => refreshPc(r)), mini('⌨', '이 폴더에서 터미널', () => { toggleTerm(true); startTerm(true, null, r.path); }), mini('✕', '목록에서 닫기 (파일은 그대로)', () => closePc(r))], 'pc'));
      const tr = treeFrom(r.items.map(rel => ({ path: rel, key: 'p:' + r.path + '\\' + rel.replace(/\//g, '\\') })));
      const rows = drawTree(tr, 'p' + i, 0, f => openTab({ kind: 'p', path: r.path + '\\' + f.path.replace(/\//g, '\\') }), (e, it) => menu(e, 'p', it, r));
      parts.push(r.error ? h('p', { class: 'vc-empty err' }, r.error) : h('div', { class: 'vc-tree' }, ...rows));
    });
    // PC folders (browser)
    fsaRoots.forEach((r, i) => {
      parts.push(sectionHead(r.name, '이 브라우저에서 연 폴더', [mini('＋', '새 파일', () => newFile('f', '', r)), mini('↻', '새로 고침', async () => { await listFsa(r); drawSide(); }), mini('✕', '목록에서 닫기', () => { fsaRoots.splice(fsaRoots.indexOf(r), 1); drawSide(); })], 'pc'));
      const tr = treeFrom(r.items.map(it => ({ path: it.rel, key: 'f:' + i + ':' + it.rel, it })));
      parts.push(h('div', { class: 'vc-tree' }, ...drawTree(tr, 'f' + i, 0, f => openTab({ kind: 'f', root: r, rel: f.path }), (e, it) => menu(e, 'f', it, r))));
    });
    parts.push(h('div', { class: 'vc-openpc' }, h('button', { class: 'btn small', onclick: openPcFolder }, '＋ PC 폴더 열기'),
      !native.available && !('showDirectoryPicker' in window) ? h('p', { class: 'hint' }, '폰·사파리에서는 내 드라이브 파일만 쓸 수 있습니다.') : null));
    return parts;
  }

  function menu(e, kind, it, r) {
    e.preventDefault();
    document.querySelectorAll('.vc-menu').forEach(m => m.remove());
    const base = it.dir ? it.rel : dirName(it.rel.replace(/\\/g, '/')) + (dirName(it.rel) ? '/' : '');
    const items = [];
    if (it.dir) items.push(['새 파일', () => newFile(kind, it.rel, r)], ['새 폴더', () => newFolder(kind, it.rel, r)]);
    if (kind !== 'f') items.push(['이름 바꾸기', () => renameItem(kind, it, r)]);
    items.push(['삭제', () => deleteItem(kind, it, r)]);
    if (kind === 'p') items.push(['경로 복사', () => copyText(r.path + '\\' + it.rel.replace(/\//g, '\\').replace(/\\$/, ''), '경로를 복사했습니다')],
      ['탐색기에서 보기', () => native.call('shell.reveal', { path: r.path + '\\' + it.rel.replace(/\//g, '\\').replace(/\\$/, '') }).catch(x => toast(x.message, 'err'))]);
    if (kind === 'p' && it.dir) items.push(['여기서 터미널', () => { toggleTerm(true); startTerm(true, null, r.path + '\\' + it.rel.replace(/\//g, '\\').replace(/\\$/, '')); }]);
    void base;
    const m = h('div', { class: 'vc-menu', role: 'menu', style: { left: e.clientX + 'px', top: e.clientY + 'px' } }, ...items.map(([l, fn]) => h('button', { role: 'menuitem', onclick: () => { m.remove(); fn(); } }, l)));
    document.body.append(m);
    setTimeout(() => document.addEventListener('mousedown', function away(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('mousedown', away); } }), 0);
  }

  const cleanName = s => (s || '').trim().replace(/^[\\/]+|[\\/]+$/g, '').replace(/\\/g, '/');
  async function newFile(kind, dir, r) {
    const name = cleanName(await promptBox('새 파일 이름', '', { hint: '확장자로 종류가 정해집니다. 예: 메모.md, test.py, 폴더/파일.js', placeholder: '이름.md' })); if (!name) return;
    if (kind === 'd') {
      const path = (dir || '') + name;
      if (driveRecs.some(x => x.path === path)) return toast('같은 이름의 파일이 있습니다.', 'err');
      const id = uid(); await db.put(COL, id, { path, content: '', hist: [] }); await loadDrive();
      dir && expanded.add('d:' + dir); drawSide(); openTab({ kind: 'd', recId: id });
    } else if (kind === 'p') {
      const full = r.path + '\\' + ((dir || '') + name).replace(/\//g, '\\');
      try { await native.call('code.create', { path: full, dir: false }); await refreshPc(r); openTab({ kind: 'p', path: full }); } catch (e) { toast(e.message, 'err'); }
    } else {
      try { let d = r.handle; const parts = ((dir || '') + name).split('/'); for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true }); await d.getFileHandle(parts[parts.length - 1], { create: true }); await listFsa(r); drawSide(); openTab({ kind: 'f', root: r, rel: (dir || '') + name }); } catch (e) { toast(e.message, 'err'); }
    }
  }
  async function newFolder(kind, dir, r) {
    const name = cleanName(await promptBox('새 폴더 이름', '')); if (!name) return;
    if (kind === 'd') { await db.put(COL, uid(), { path: (dir || '') + name + '/', folder: true }); await loadDrive(); expanded.add('d:' + (dir || '') + name + '/'); drawSide(); }
    else if (kind === 'p') { try { await native.call('code.create', { path: r.path + '\\' + ((dir || '') + name).replace(/\//g, '\\'), dir: true }); await refreshPc(r); } catch (e) { toast(e.message, 'err'); } }
  }
  async function renameItem(kind, it, r) {
    const nn = cleanName(await promptBox('새 이름', it.name)); if (!nn || nn === it.name) return;
    if (kind === 'd') {
      const from = it.rel, to = (dirName(it.rel.replace(/\/$/, '')) ? dirName(it.rel.replace(/\/$/, '')) + '/' : '') + nn + (it.dir ? '/' : '');
      for (const rec of driveRecs.filter(x => it.dir ? x.path.startsWith(from) : x.path === from)) {
        const { id, updatedAt, ...data } = rec; await db.put(COL, id, { ...data, path: to + rec.path.slice(from.length) });
        const t = tabs.find(t => t.recId === id); if (t) { t.path = to + rec.path.slice(from.length); t.name = baseName(t.path); }
      }
      await loadDrive(); drawSide(); drawTabs(); drawStatus();
    } else {
      const from = r.path + '\\' + it.rel.replace(/\//g, '\\').replace(/\\$/, ''), to = dirName(from) + '\\' + nn;
      try {
        await native.call('code.rename', { from, to });
        for (const t of tabs.filter(t => t.kind === 'p' && (t.path === from || t.path.startsWith(from + '\\')))) { t.path = to + t.path.slice(from.length); t.key = 'p:' + t.path; t.name = baseName(t.path); }
        await refreshPc(r); drawTabs(); drawStatus();
      } catch (e) { toast(e.message, 'err'); }
    }
  }
  async function deleteItem(kind, it, r) {
    if (!await confirmBox(`'${it.name}'${it.dir ? ' 폴더와 그 안의 파일' : ''}을(를) 삭제할까요?${kind === 'p' ? '\n(PC 파일은 휴지통으로 갑니다)' : kind === 'd' ? '\n(내 드라이브에서 지워지고 다른 기기에서도 사라집니다)' : ''}`, '삭제', true)) return;
    if (kind === 'd') {
      for (const rec of driveRecs.filter(x => it.dir ? x.path.startsWith(it.rel) : x.path === it.rel)) { await db.remove(COL, rec.id); const t = tabs.find(t => t.recId === rec.id); if (t) closeTab(t, true); }
      await loadDrive(); drawSide();
    } else if (kind === 'p') {
      const full = r.path + '\\' + it.rel.replace(/\//g, '\\').replace(/\\$/, '');
      try { await native.call('code.delete', { path: full }); tabs.filter(t => t.kind === 'p' && (t.path === full || t.path.startsWith(full + '\\'))).forEach(t => closeTab(t, true)); await refreshPc(r); } catch (e) { toast(e.message, 'err'); }
    } else {
      try { const parts = it.rel.replace(/\/$/, '').split('/'); let d = r.handle; for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p); await d.removeEntry(parts[parts.length - 1], { recursive: true }); await listFsa(r); drawSide(); } catch (e) { toast(e.message, 'err'); }
    }
  }
  async function refreshPc(r) { try { const l = await native.call('code.list', { root: r.path }); r.items = l.items; r.error = null; } catch (e) { r.error = e.message; } drawSide(); }
  async function closePc(r) { await native.call('code.closeFolder', { path: r.path }); await loadPc(); drawSide(); }
  async function openPcFolder() {
    if (native.available) { try { const roots = await native.call('code.openFolder'); if (roots) { await loadPc(); showSide('files'); } } catch (e) { toast(e.message, 'err'); } return; }
    if ('showDirectoryPicker' in window) {
      try { const handle = await window.showDirectoryPicker({ mode: 'readwrite' }); const r = { name: handle.name, handle, items: [] }; await listFsa(r); fsaRoots.push(r); showSide('files'); } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'err'); }
      return;
    }
    toast('이 기기(폰·사파리)에서는 PC 폴더를 열 수 없습니다. 내 드라이브를 써 주세요.');
  }

  // ---------- tabs & editor ----------
  const isDirty = t => t.model && t.model.getAlternativeVersionId() !== t.saved;
  async function openTab(spec, opts = {}) {
    let t = tabs.find(x => (spec.kind === 'd' && x.recId === spec.recId) || (spec.kind === 'p' && x.path === spec.path) || (spec.kind === 'f' && x.root === spec.root && x.rel === spec.rel));
    if (!t) {
      monaco = monaco || await loadMonaco();
      let text = '', name, info = {};
      try {
        if (spec.kind === 'd') { const rec = await db.get(COL, spec.recId); if (!rec) return toast('파일이 없습니다.', 'err'); text = rec.content || ''; name = baseName(rec.path); info = { path: rec.path }; }
        else if (spec.kind === 'p') {
          const r = await native.call('code.read', { path: spec.path });
          if (r.binary) { if (await confirmBox(`'${baseName(spec.path)}'은(는) 글자 파일이 아닙니다${r.tooBig ? ' (8MB 초과)' : ''}. 기본 프로그램으로 열까요?`, '열기')) native.call('shell.open', { path: spec.path }); return; }
          text = r.text; name = baseName(spec.path); info = { path: spec.path, mtime: r.mtime, encoding: r.encoding, eol: r.eol };
        } else { const it = spec.root.items.find(i => i.rel === spec.rel); const f = await it.handle.getFile(); if (f.size > 8e6) return toast('8MB가 넘는 파일은 열 수 없습니다.', 'err'); text = await f.text(); name = baseName(spec.rel); info = { path: spec.root.name + '/' + spec.rel, handle: it.handle }; }
      } catch (e) { return toast(e.message, 'err'); }
      const key = spec.kind === 'd' ? 'd:' + spec.recId : spec.kind === 'p' ? 'p:' + spec.path : 'f:' + fsaRoots.indexOf(spec.root) + ':' + spec.rel;
      const model = monaco.editor.createModel(text.replace(/\r\n/g, '\n'), langOf(name), monaco.Uri.from({ scheme: 'myaide', path: '/' + uid() + '/' + name }));
      t = { ...spec, ...info, key, name, model, saved: model.getAlternativeVersionId(), view: null };
      model.onDidChangeContent(() => { drawTabs(); drawStatus(); if (t.kind === 'd') autoSave(t); if (t === active && !preview.hidden) drawPreview(); });
      tabs.push(t);
    }
    activate(t);
    if (opts.line) { editor.revealLineInCenter(opts.line); editor.setPosition({ lineNumber: opts.line, column: opts.col || 1 }); if (opts.len) editor.setSelection(new monaco.Selection(opts.line, opts.col, opts.line, opts.col + opts.len)); editor.focus(); }
    persistTabs();
  }
  function ensureEditor() {
    if (editor) return;
    editor = monaco.editor.create(edHost, { theme: 'myaide', automaticLayout: true, fontSize: 14, fontFamily: '"D2Coding", "Cascadia Code", Consolas, "Pretendard Variable", monospace', minimap: { enabled: innerWidth > 1100 }, wordWrap: 'on', renderWhitespace: 'selection', smoothScrolling: true, scrollBeyondLastLine: false, tabSize: 4, bracketPairColorization: { enabled: true }, stickyScroll: { enabled: true }, unicodeHighlight: { ambiguousCharacters: false } });
    editor.onDidChangeCursorPosition(drawStatus);
    editor.onDidChangeCursorSelection(() => { if (side === 'ai') drawAiCtx(); });
    const K = monaco.KeyMod, C = monaco.KeyCode;
    editor.addCommand(K.CtrlCmd | C.KeyS, () => save(active));
    editor.addCommand(K.CtrlCmd | C.KeyP, quickOpen);
    editor.addCommand(K.CtrlCmd | C.Backquote, () => toggleTerm());
    editor.addCommand(K.CtrlCmd | K.Shift | C.KeyF, () => showSide('search'));
    editor.addCommand(K.CtrlCmd | C.KeyB, () => wrap.classList.toggle('side-off'));
    editor.addCommand(K.CtrlCmd | K.Shift | C.KeyV, togglePreview);
    editor.addCommand(C.F5, runActive);
    editor.addCommand(K.CtrlCmd | C.KeyW, () => active && closeTab(active));
    editor.addAction({ id: 'vc-ai-explain', label: 'AI: 선택한 코드 설명', contextMenuGroupId: '9_ai', run: () => { showSide('ai'); aiRun('explain'); } });
    editor.addAction({ id: 'vc-ai-fix', label: 'AI: 선택한 코드 고치기', contextMenuGroupId: '9_ai', run: () => { showSide('ai'); aiRun('fix'); } });
  }
  function activate(t) {
    if (active && editor) active.view = editor.saveViewState();
    active = t;
    closeDiff();
    welcome.hidden = !!t; edHost.hidden = !t;
    if (t) { ensureEditor(); editor.setModel(t.model); if (t.view) editor.restoreViewState(t.view); editor.focus(); }
    const md = t && extOf(t.name) === 'md';
    if (!md) preview.hidden = true; else if (t.previewOn) { preview.hidden = false; drawPreview(); } else preview.hidden = true;
    wrap.classList.toggle('with-preview', !preview.hidden);
    drawTabs(); drawStatus(); if (side === 'files') drawSide(); if (side === 'ai') drawAiCtx(); if (side === 'git') drawSide();
  }
  async function closeTab(t, force) {
    if (!force && isDirty(t) && t.kind !== 'd') {
      const r = await confirmBox(`'${t.name}'의 바뀐 내용을 저장할까요?`, '저장');
      if (r) { if (!await save(t)) return; }
    }
    if (t.kind === 'd' && isDirty(t)) await save(t);
    const i = tabs.indexOf(t); tabs.splice(i, 1);
    if (active === t) { active = null; activate(tabs[Math.min(i, tabs.length - 1)] || null); if (!tabs.length && editor) editor.setModel(null); }
    t.model.dispose(); drawTabs(); persistTabs(); if (side === 'files') drawSide();
  }
  function drawTabs() {
    tabBar.replaceChildren(...tabs.map(t => h('div', { class: 'vc-tab' + (t === active ? ' on' : '') + (isDirty(t) ? ' dirty' : ''), role: 'tab', title: t.kind === 'd' ? '내 드라이브 · ' + t.path : t.path,
      onclick: () => activate(t), onauxclick: e => { if (e.button === 1) closeTab(t); } },
      h('span', { class: 'vc-fi' }, fileIcon(t.name)), h('span', { class: 'vc-tab-n' }, t.name), t.kind === 'd' ? h('span', { class: 'vc-tab-k' }, '☁') : null,
      h('button', { class: 'vc-tab-x', 'aria-label': t.name + ' 닫기', onclick: e => { e.stopPropagation(); closeTab(t); } }, isDirty(t) ? '●' : '✕'))));
    const md = active && extOf(active.name) === 'md';
    const runnable = active && native.available && RUN[extOf(active.name)];
    tabTools.replaceChildren(...[
      md ? h('button', { class: 'btn small ghost' + (!preview.hidden ? ' on' : ''), title: '미리보기 (Ctrl+Shift+V)', onclick: togglePreview }, '미리보기') : null,
      runnable ? h('button', { class: 'btn small ghost run', title: '실행 (F5)', onclick: runActive }, '▶ 실행') : null,
      active && active.kind !== 'd' ? h('button', { class: 'btn small ghost', disabled: !isDirty(active), title: '저장 (Ctrl+S)', onclick: () => save(active) }, '저장') : null].filter(Boolean));
  }
  function drawStatus() {
    if (!active || !editor) { status.replaceChildren(h('span', null, 'VisualCode'), h('span', { class: 'grow' }), h('span', null, native.available ? 'Windows 앱' : '브라우저')); return; }
    const p = editor.getPosition() || { lineNumber: 1, column: 1 };
    const s = editor.getSelection(); const selN = s && !s.isEmpty() ? editor.getModel().getValueInRange(s).length : 0;
    status.replaceChildren(
      h('span', { class: 'vc-st-loc' }, active.kind === 'd' ? '☁ 내 드라이브 · ' + active.path : active.kind === 'p' ? '💻 ' + active.path : '💻 ' + active.path),
      h('span', { class: 'grow' }),
      h('span', null, `줄 ${p.lineNumber}, 칸 ${p.column}` + (selN ? ` (${selN}자 선택)` : '')),
      h('span', null, (active.encoding || 'utf-8').toUpperCase().replace('-BOM', ' BOM')),
      h('span', null, LANG_LABEL[active.model.getLanguageId()] || active.model.getLanguageId()),
      h('span', { class: isDirty(active) ? 'dirty' : '' }, isDirty(active) ? (active.kind === 'd' ? '저장 중…' : '수정됨 · Ctrl+S') : '저장됨'));
  }
  const persistTabs = debounce(() => db.kvSet('vc-tabs', JSON.stringify(tabs.map(t => ({ kind: t.kind, recId: t.recId, path: t.path })).filter(t => t.kind !== 'f'))), 500);

  // ---------- saving ----------
  const timers = new Map();
  function autoSave(t) { clearTimeout(timers.get(t)); timers.set(t, setTimeout(() => save(t), 900)); }
  async function save(t) {
    if (!t) return false;
    const text = t.model.getValue(), ver = t.model.getAlternativeVersionId();
    try {
      if (t.kind === 'd') {
        const rec = await db.get(COL, t.recId) || { path: t.path, hist: [] };
        const hist = (rec.hist || []).slice();
        const last = hist[hist.length - 1];
        // a version is kept when the file was last changed more than 10 minutes ago (at most 30)
        if (rec.content != null && rec.content !== text && (!last || Date.now() - last.t > 10 * 60 * 1000)) { hist.push({ t: Date.now(), c: rec.content }); while (hist.length > 30) hist.shift(); }
        await db.put(COL, t.recId, { ...rec, path: t.path, content: text, hist });
      } else if (t.kind === 'p') {
        const out = t.eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
        try { const r = await native.call('code.write', { path: t.path, text: out, mtime: t.mtime || 0, encoding: t.encoding || 'utf-8' }); t.mtime = r.mtime; }
        catch (e) {
          if (!/^CHANGED:/.test(e.message)) throw e;
          if (!await confirmBox('다른 프로그램에서 이 파일이 바뀌었습니다. 내 내용으로 덮어쓸까요?', '덮어쓰기', true)) return false;
          const r = await native.call('code.write', { path: t.path, text: out, mtime: 0, encoding: t.encoding || 'utf-8' }); t.mtime = r.mtime;
        }
      } else { const w = await t.handle.createWritable(); await w.write(text); await w.close(); }
      t.saved = ver; drawTabs(); drawStatus(); if (side === 'files') drawSide();
      if (t.kind === 'd') loadDrive();
      return true;
    } catch (e) { toast('저장하지 못했습니다: ' + e.message, 'err'); return false; }
  }
  // Someone else (another device) changed a 드라이브 file I have open and haven't touched: take theirs.
  const onDb = async ev => {
    if (ev.detail.col !== COL) return;
    await loadDrive(); if (side === 'files') drawSide();
    const t = tabs.find(x => x.kind === 'd' && x.recId === ev.detail.id);
    if (t && !isDirty(t)) { const rec = await db.get(COL, t.recId); if (rec && rec.content !== t.model.getValue()) { const v = editor && active === t ? editor.saveViewState() : null; t.model.setValue(rec.content || ''); t.saved = t.model.getAlternativeVersionId(); if (v) editor.restoreViewState(v); } }
  };
  db.events.addEventListener('change', onDb);

  // ---------- markdown preview ----------
  function togglePreview() {
    if (!active || extOf(active.name) !== 'md') return;
    active.previewOn = preview.hidden; preview.hidden = !preview.hidden;
    wrap.classList.toggle('with-preview', !preview.hidden);
    if (!preview.hidden) drawPreview(); drawTabs();
  }
  const drawPreview = debounce(() => {
    if (!active || preview.hidden) return;
    preview.innerHTML = renderMarkdown(active.model.getValue());
    preview.querySelectorAll('pre code').forEach(c => { const lang = (c.className.match(/language-(\w+)/) || [])[1]; if (lang && monaco) monaco.editor.colorize(c.textContent, EXT_LANG[lang] || lang, {}).then(html => { c.innerHTML = html; }).catch(() => {}); });
  }, 200);

  // ---------- diff view (git / 기록 / AI) ----------
  function openDiff(original, modified, lang, title, actions = []) {
    monaco = monaco; if (!monaco) return;
    if (!diffEd) diffEd = monaco.editor.createDiffEditor(diffHost, { theme: 'myaide', automaticLayout: true, readOnly: true, renderSideBySide: innerWidth > 900, fontSize: 13.5, originalEditable: false, minimap: { enabled: false }, wordWrap: 'on' });
    const o = monaco.editor.createModel(original, lang), m = monaco.editor.createModel(modified, lang);
    const prev = diffEd.getModel(); diffEd.setModel({ original: o, modified: m }); if (prev) { prev.original.dispose(); prev.modified.dispose(); }
    diffBar.replaceChildren(h('b', null, title), h('span', { class: 'grow' }), ...actions, h('button', { class: 'btn small', onclick: closeDiff }, '닫기'));
    diffBar.hidden = diffHost.hidden = false; wrap.classList.add('diffing');
  }
  function closeDiff() { diffBar.hidden = diffHost.hidden = true; wrap.classList.remove('diffing'); }

  // ---------- side panels ----------
  function showSide(key) {
    if (side === key && !wrap.classList.contains('side-off')) { if (innerWidth <= 820) wrap.classList.add('side-off'); }
    else wrap.classList.remove('side-off');
    side = key; activity.querySelectorAll('[data-side]').forEach(b => b.classList.toggle('on', b.dataset.side === key));
    drawSide();
    if (key === 'search') setTimeout(() => sidePane.querySelector('input')?.focus(), 0);
  }
  function drawSide() {
    if (side === 'files') sidePane.replaceChildren(...drawFiles());
    else if (side === 'search') drawSearch();
    else if (side === 'git') drawGit();
    else if (side === 'ai') drawAi();
  }

  // search
  let sq = '', sRegex = false, sCase = false, sResults = null, sBusy = false;
  function drawSearch() {
    const inp = h('input', { type: 'search', class: 'vc-sin', value: sq, placeholder: '모든 파일에서 찾기', onkeydown: e => { if (e.key === 'Enter') { sq = inp.value; runSearch(); } } });
    const tog = (label, title, on, fn) => h('button', { class: 'vc-tog' + (on ? ' on' : ''), title, onclick: fn }, label);
    const res = h('div', { class: 'vc-sres' });
    if (sBusy) res.append(h('p', { class: 'vc-empty' }, '찾는 중…'));
    else if (sResults) {
      const n = sResults.reduce((a, f) => a + f.matches.length, 0);
      res.append(h('p', { class: 'vc-empty' }, n ? `${sResults.length}개 파일에서 ${n}건` : '찾은 결과가 없습니다.'));
      for (const f of sResults) {
        res.append(h('div', { class: 'vc-sfile' }, h('span', { class: 'vc-fi' }, fileIcon(f.name)), h('b', null, f.name), h('span', { class: 'vc-sdir' }, f.where)));
        for (const m of f.matches.slice(0, 50)) {
          const t = m.text, a = Math.max(0, m.col - 1 - 30);
          res.append(h('div', { class: 'vc-sline', onclick: () => openTab(f.spec, { line: m.line, col: m.col, len: m.len }) },
            h('span', { class: 'vc-ln' }, m.line), h('span', { html: escapeHtml((a ? '…' : '') + t.slice(a, m.col - 1)) + '<mark>' + escapeHtml(t.substr(m.col - 1, m.len)) + '</mark>' + escapeHtml(t.slice(m.col - 1 + m.len, m.col - 1 + m.len + 80)) })));
        }
      }
    }
    sidePane.replaceChildren(h('div', { class: 'vc-side-t' }, '검색'),
      h('div', { class: 'vc-sbox' }, inp, tog('.*', '정규식', sRegex, () => { sRegex = !sRegex; drawSearch(); }), tog('Aa', '대소문자 구분', sCase, () => { sCase = !sCase; drawSearch(); })),
      h('p', { class: 'hint', style: { margin: '6px 12px' } }, '내 드라이브와 열어 둔 PC 폴더를 모두 찾습니다. Enter로 검색.'), res);
  }
  async function runSearch() {
    if (!sq.trim()) return;
    sBusy = true; drawSearch();
    let rx; try { rx = new RegExp(sRegex ? sq : sq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), sCase ? '' : 'i'); } catch { sBusy = false; toast('정규식이 올바르지 않습니다.', 'err'); drawSearch(); return; }
    const out = [];
    for (const r of driveRecs.filter(r => !r.folder)) {
      const lines = (r.content || '').split('\n'), matches = [];
      lines.forEach((l, i) => { const m = rx.exec(l); if (m) matches.push({ line: i + 1, col: m.index + 1, len: m[0].length || 1, text: l }); });
      if (matches.length || rx.test(r.path)) out.push({ name: baseName(r.path), where: '내 드라이브/' + dirName(r.path), matches, spec: { kind: 'd', recId: r.id } });
    }
    for (const r of pcRoots) {
      try { const res = await native.call('code.search', { root: r.path, query: sq, regex: sRegex, matchCase: sCase }); for (const f of res) out.push({ name: baseName(f.path), where: dirName(f.path).slice(r.path.length - r.name.length), matches: f.matches, spec: { kind: 'p', path: f.path } }); } catch (e) { toast(e.message, 'err'); }
    }
    for (const r of fsaRoots) for (const it of r.items.filter(i => !i.dir)) {
      try { const f = await it.handle.getFile(); if (f.size > 2e6) continue; const lines = (await f.text()).split('\n'), matches = []; lines.forEach((l, i) => { const m = rx.exec(l); if (m) matches.push({ line: i + 1, col: m.index + 1, len: m[0].length || 1, text: l }); }); if (matches.length) out.push({ name: baseName(it.rel), where: r.name + '/' + dirName(it.rel), matches, spec: { kind: 'f', root: r, rel: it.rel } }); } catch { }
    }
    sResults = out; sBusy = false; drawSearch();
  }

  // git / history
  async function drawGit() {
    const box = h('div', { class: 'vc-git' }, h('div', { class: 'vc-side-t' }, '변경·기록'));
    sidePane.replaceChildren(box);
    // current file history
    if (active) {
      box.append(sectionHead('이 파일의 기록', active.name, []));
      const list = h('div', { class: 'vc-hist' }); box.append(list);
      if (active.kind === 'd') {
        const rec = await db.get(COL, active.recId); const hist = (rec && rec.hist) || [];
        if (!hist.length) list.append(h('p', { class: 'vc-empty' }, '아직 이전 버전이 없습니다. (10분 넘게 지난 뒤 고치면 이전 버전이 남습니다)'));
        for (const v of hist.slice().reverse()) list.append(h('div', { class: 'vc-hrow', onclick: () => {
          const cur = active;
          openDiff(v.c, cur.model.getValue(), cur.model.getLanguageId(), `${new Date(v.t).toLocaleString('ko-KR')} 버전 ↔ 지금`, [h('button', { class: 'btn small', onclick: async () => { if (await confirmBox('이 버전으로 되돌릴까요? (지금 내용은 기록에 남습니다)', '되돌리기')) { cur.model.pushEditOperations([], [{ range: cur.model.getFullModelRange(), text: v.c }], () => null); closeDiff(); } } }, '이 버전으로 되돌리기')]);
        } }, h('b', null, new Date(v.t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })), h('span', null, `${v.c.length.toLocaleString()}자`)));
      } else if (active.kind === 'p') {
        try {
          const log = await native.call('git.log', { path: active.path });
          if (!log.length) list.append(h('p', { class: 'vc-empty' }, 'Git 기록이 없습니다.'));
          for (const c of log) list.append(h('div', { class: 'vc-hrow', title: c.msg, onclick: async () => {
            const cur = active; const r = await native.call('git.show', { path: cur.path, rev: c.rev });
            openDiff(r.text.replace(/\r\n/g, '\n'), cur.model.getValue(), cur.model.getLanguageId(), `${c.rev} (${c.date}) ↔ 지금`);
          } }, h('b', null, c.msg), h('span', null, `${c.date} · ${c.author} · ${c.rev}`)));
        } catch (e) { list.append(h('p', { class: 'vc-empty' }, /^GIT:|Git 저장소/.test(e.message) ? 'Git 저장소가 아닌 폴더입니다.' : e.message)); }
      } else list.append(h('p', { class: 'vc-empty' }, '브라우저에서 연 폴더는 기록을 볼 수 없습니다.'));
    }
    // git changes per PC folder
    if (!native.available) { box.append(h('p', { class: 'hint', style: { margin: '12px' } }, 'Git 변경 비교·커밋은 Windows 앱에서 씁니다.')); return; }
    for (const r of pcRoots) {
      const sec = h('div'); box.append(sectionHead(r.name, 'Git', [mini('↻', '새로 고침', drawGit)]), sec);
      try {
        const st = await native.call('git.status', { root: r.path });
        if (!st.repo) { sec.append(h('p', { class: 'vc-empty' }, 'Git 저장소가 아닙니다. '), h('button', { class: 'btn small', style: { margin: '0 12px 10px' }, onclick: async () => { try { await native.call('git.init', { root: r.path }); drawGit(); } catch (e) { toast(e.message.replace(/^GIT:/, ''), 'err'); } } }, 'Git 시작 (git init)')); continue; }
        sec.append(h('p', { class: 'vc-branch' }, '브랜치 ', h('b', null, st.branch || '(없음)'), ` · 바뀐 파일 ${st.changes.length}개`));
        const LBL = { M: '수정', A: '추가', D: '삭제', R: '이름', '?': '새 파일', U: '충돌' };
        for (const c of st.changes) {
          const k = (c.code.trim()[0] || 'M');
          sec.append(h('div', { class: 'vc-chg', onclick: async () => {
            const head = await native.call('git.show', { path: c.path, rev: 'HEAD' });
            let now = ''; try { const r2 = await native.call('code.read', { path: c.path }); now = r2.text || ''; } catch { }
            openDiff((head.text || '').replace(/\r\n/g, '\n'), now.replace(/\r\n/g, '\n'), langOf(c.path), `${baseName(c.path)} — 마지막 커밋 ↔ 지금`, [h('button', { class: 'btn small', onclick: () => openTab({ kind: 'p', path: c.path }) }, '파일 열기')]);
          } }, h('span', { class: 'vc-fi' }, fileIcon(c.path)), h('span', { class: 'vc-nm' }, baseName(c.path)), h('span', { class: 'vc-sdir' }, dirName(c.path).slice(r.path.length)), h('span', { class: 'vc-code k' + k.replace('?', 'N') }, LBL[k] || k)));
        }
        if (st.changes.length) {
          const msg = h('textarea', { class: 'vc-commit', rows: 2, placeholder: '커밋 메시지 (무엇을 바꿨는지)' });
          sec.append(msg, h('button', { class: 'btn small primary', style: { margin: '0 12px 12px' }, onclick: async () => {
            if (tabs.some(t => t.kind === 'p' && isDirty(t) && t.path.startsWith(r.path)) && await confirmBox('저장 안 한 파일이 있습니다. 모두 저장하고 커밋할까요?', '저장 후 커밋')) for (const t of tabs.filter(t => t.kind === 'p' && isDirty(t))) await save(t);
            try { await native.call('git.commit', { root: r.path, message: msg.value }); toast('커밋했습니다'); drawGit(); } catch (e) { toast(e.message.replace(/^GIT:/, ''), 'err'); }
          } }, '모두 커밋'));
        }
      } catch (e) { sec.append(h('p', { class: 'vc-empty err' }, e.message.replace(/^GIT:/, ''))); }
    }
    if (!pcRoots.length) box.append(h('p', { class: 'hint', style: { margin: '12px' } }, 'PC 폴더를 열면 Git 변경 내용이 여기 나옵니다.'));
  }

  // AI helper
  const aiCtx = h('div', { class: 'vc-aictx' });
  const aiOut = h('div', { class: 'vc-aiout md-body' });
  const aiAsk = h('textarea', { class: 'vc-aiask', rows: 4, placeholder: '예: 이 함수에 예외 처리를 넣어줘 / 엑셀 읽어서 합계 내는 파이썬 코드 만들어줘 / 이 문서를 보고서 형식으로 정리해줘' });
  let aiBusy = false;
  function drawAiCtx() {
    if (!active || !editor) { aiCtx.textContent = '파일을 열면 그 내용을 바탕으로 도와줍니다.'; return; }
    const s = editor.getSelection(); const n = s && !s.isEmpty() ? s.endLineNumber - s.startLineNumber + 1 : 0;
    aiCtx.replaceChildren(h('b', null, active.name), n ? ` · 선택한 ${n}줄` : ' · 선택 없음 (파일 전체)');
  }
  function drawAi() {
    drawAiCtx();
    const qb = (label, mode) => h('button', { class: 'btn small', disabled: aiBusy, onclick: () => aiRun(mode) }, label);
    sidePane.replaceChildren(h('div', { class: 'vc-side-t' }, 'AI 코드 도우미'), h('div', { class: 'vc-ai' }, aiCtx,
      h('div', { class: 'vc-aiq' }, qb('설명', 'explain'), qb('고치기·개선', 'fix'), qb('주석 달기', 'comment'), qb('테스트 만들기', 'test')),
      aiAsk,
      h('div', { class: 'vc-aiq' }, h('button', { class: 'btn small primary', disabled: aiBusy, onclick: () => aiRun('edit') }, '코드에 반영'), h('button', { class: 'btn small', disabled: aiBusy, onclick: () => aiRun('ask') }, '답변만 받기')),
      h('p', { class: 'hint' }, '‘코드에 반영’은 바뀐 부분을 비교 화면으로 먼저 보여 주고, ‘적용’을 눌러야 바뀝니다. 코드는 OpenAI로 전송됩니다.'),
      aiOut));
  }
  async function aiRun(mode) {
    if (aiBusy) return;
    if (!active || !editor) { if (mode === 'edit' || mode === 'ask') { /* new code without a file */ } else return toast('먼저 파일을 열어 주세요.'); }
    const t = active, model = t ? t.model : null;
    const sel = editor && t ? editor.getSelection() : null;
    const hasSel = sel && !sel.isEmpty();
    const range = model ? (hasSel ? new monaco.Range(sel.startLineNumber, 1, sel.endLineNumber, model.getLineMaxColumn(sel.endLineNumber)) : model.getFullModelRange()) : null;
    const code = model ? model.getValueInRange(range) : '';
    const lang = model ? (LANG_LABEL[model.getLanguageId()] || model.getLanguageId()) : '';
    const ask = aiAsk.value.trim();
    if ((mode === 'edit' || mode === 'ask') && !ask) return toast('무엇을 원하는지 적어 주세요.');
    const task = { explain: '이 코드가 하는 일을 한국어로 쉽게 설명하세요. 핵심 흐름, 주의할 점, 개선할 점 순서로.', fix: '버그·예외 처리·가독성을 고쳐 더 나은 코드로 바꾸세요.', comment: '동작은 그대로 두고 한국어 주석을 알맞게 다세요.', test: '이 코드를 검증하는 테스트 코드를 같은 언어로 작성하세요(같은 파일 끝에 붙일 수 있는 형태).', edit: ask, ask }[mode];
    const editMode = ['fix', 'comment', 'edit'].includes(mode) && model;
    const sys = editMode
      ? `당신은 숙련된 개발자입니다. 사용자가 준 ${lang} ${hasSel ? '코드 일부' : '파일 전체'}를 요청대로 고친 결과를 내놓습니다. 반드시 고친 ${hasSel ? '부분' : '파일'} 전체를 코드 블록(\`\`\`) 하나로만 출력하고, 그 밖의 말은 코드 블록 아래 3줄 이내 한국어 요약만 쓰세요.`
      : '당신은 친절한 한국어 개발 도우미입니다. Markdown으로 간결하게 답하고, 코드는 코드 블록으로 보여 주세요.';
    const user = model ? `요청: ${task}\n\n파일: ${t.name} (${lang})\n\`\`\`\n${code.slice(0, 60000)}\n\`\`\`` : `요청: ${task}`;
    aiBusy = true; drawAi(); aiOut.innerHTML = '<p class="hint">AI가 작업 중입니다…</p>';
    try {
      const ans = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }]);
      if (editMode) {
        const m = ans.match(/```[^\n]*\n([\s\S]*?)```/);
        if (!m) { aiOut.innerHTML = renderMarkdown(ans); return; }
        let neu = m[1].replace(/\n$/, '');
        const note = ans.slice(ans.indexOf(m[0]) + m[0].length).trim();
        aiOut.innerHTML = renderMarkdown(note || '바뀐 부분을 비교 화면에서 확인하고 ‘적용’을 누르세요.');
        const ver = model.getAlternativeVersionId();
        openDiff(code, neu, model.getLanguageId(), `AI 제안 — ${t.name}${hasSel ? ' (선택 부분)' : ''}`, [h('button', { class: 'btn small primary', onclick: () => {
          if (model.isDisposed()) return toast('파일이 닫혀 적용할 수 없습니다.', 'err');
          if (model.getAlternativeVersionId() !== ver && !confirm('그 사이에 파일이 바뀌었습니다. 그래도 적용할까요?')) return;
          if (active !== t) activate(t);
          editor.pushUndoStop(); editor.executeEdits('ai', [{ range, text: neu }]); editor.pushUndoStop(); closeDiff(); toast('적용했습니다 (Ctrl+Z로 되돌리기)');
        } }, '적용')]);
      } else if (mode === 'test' && model) {
        aiOut.innerHTML = renderMarkdown(ans);
        aiOut.prepend(h('p', null, h('button', { class: 'btn small', onclick: () => { const m = ans.match(/```[^\n]*\n([\s\S]*?)```/); if (m) { const end = model.getFullModelRange().getEndPosition(); editor.executeEdits('ai', [{ range: new monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column), text: '\n\n' + m[1] }]); toast('파일 끝에 붙였습니다'); } } }, '테스트 코드를 파일 끝에 붙이기')));
      } else aiOut.innerHTML = renderMarkdown(ans);
      aiOut.querySelectorAll('pre').forEach(p => p.append(h('button', { class: 'vc-copy', onclick: () => copyText(p.querySelector('code')?.textContent || p.textContent, '코드를 복사했습니다') }, '복사')));
    } catch (e) { aiOut.innerHTML = ''; aiOut.append(h('p', { class: 'error' }, e.message)); }
    finally { aiBusy = false; const keep = aiOut.cloneNode(true); drawAi(); aiOut.replaceChildren(...keep.childNodes); }
  }

  // ---------- terminal (Windows app) ----------
  const TERM_ID = 'vc-' + uid();
  let termOn = false, termCwd = null, termStarted = false;
  const hist = []; let hi = 0;
  function toggleTerm(on) {
    termOn = on == null ? !termOn : on;
    termPanel.hidden = !termOn; wrap.classList.toggle('with-term', termOn);
    if (termOn) {
      if (!native.available) { termOut.textContent = '터미널과 실행은 Windows 앱(MY AIDE.exe)에서만 쓸 수 있습니다.\n브라우저·폰에서는 편집·미리보기·검색·AI 도우미를 쓸 수 있습니다.'; termIn.disabled = true; return; }
      if (!termStarted) startTerm(false);
      setTimeout(() => termIn.focus(), 0);
    }
  }
  async function startTerm(restart, note, cwd) {
    if (!native.available) return;
    if (cwd) termCwd = cwd;
    if (!termCwd) termCwd = active && active.kind === 'p' ? dirName(active.path) : (pcRoots[0] && pcRoots[0].path) || '';
    try {
      if (note) termOut.append(document.createTextNode(`\n[${note}]\n`));
      const r = await native.call('term.start', { id: TERM_ID, cwd: termCwd, shell: shellSel.value });
      termStarted = true; if (restart) termOut.append(document.createTextNode(`\n— ${shellSel.value} · ${r.cwd} —\n`));
    } catch (e) { termOut.append(document.createTextNode('\n' + e.message + '\n')); }
  }
  shellSel.onchange = () => startTerm(true);
  const onTerm = d => {
    if (!d || d.id !== TERM_ID) return;
    if (d.exit != null) { termStarted = false; termOut.append(document.createTextNode(`\n[종료됨: ${d.exit}]\n`)); return; }
    const atBottom = termOut.scrollTop + termOut.clientHeight >= termOut.scrollHeight - 30;
    const span = document.createElement('span'); if (d.err) span.className = 'err'; span.textContent = stripAnsi(d.data); termOut.append(span);
    while (termOut.childNodes.length > 4000) termOut.firstChild.remove();
    if (atBottom) termOut.scrollTop = termOut.scrollHeight;
  };
  native.on('term', onTerm);
  async function send(cmd) {
    if (!termStarted) await startTerm(false);
    try { await native.call('term.input', { id: TERM_ID, text: cmd + '\r\n' }); } catch (e) { termOut.append(document.createTextNode('\n' + e.message + '\n')); }
  }
  termIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const v = termIn.value; termIn.value = ''; if (v.trim()) { hist.push(v); hi = hist.length; } if (v.trim() === 'cls' || v.trim() === 'clear') { termOut.textContent = ''; } send(v); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (hi > 0) termIn.value = hist[--hi]; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (hi < hist.length - 1) termIn.value = hist[++hi]; else { hi = hist.length; termIn.value = ''; } }
    else if (e.key === 'c' && e.ctrlKey && !termIn.selectionStart && !window.getSelection().toString()) { e.preventDefault(); startTerm(true, '중지했습니다'); }
  });
  async function runActive() {
    if (!active) return;
    if (!native.available) return toast('실행은 Windows 앱에서만 됩니다.');
    const mk = RUN[extOf(active.name)]; if (!mk) return toast('이 종류의 파일은 바로 실행할 수 없습니다.');
    let file;
    if (active.kind === 'p') { if (isDirty(active) && !await save(active)) return; file = active.path; }
    else { const r = await native.call('code.tempWrite', { name: active.name, text: active.model.getValue() }); file = r.path; }
    toggleTerm(true);
    const dir = dirName(file);
    if (termCwd !== dir) { termCwd = dir; await startTerm(true); }
    send(mk(file));
  }

  // ---------- quick open (Ctrl+P) ----------
  function allFiles() {
    const out = driveRecs.filter(r => !r.folder).map(r => ({ name: baseName(r.path), where: '☁ ' + r.path, spec: { kind: 'd', recId: r.id } }));
    for (const r of pcRoots) for (const rel of r.items) if (!rel.endsWith('/')) out.push({ name: baseName(rel), where: '💻 ' + r.name + '/' + rel, spec: { kind: 'p', path: r.path + '\\' + rel.replace(/\//g, '\\') } });
    for (const r of fsaRoots) for (const it of r.items) if (!it.dir) out.push({ name: baseName(it.rel), where: '💻 ' + r.name + '/' + it.rel, spec: { kind: 'f', root: r, rel: it.rel } });
    return out;
  }
  function quickOpen() {
    document.querySelectorAll('.vc-qo-bg').forEach(x => x.remove());
    const files = allFiles(); let sel = 0, shown = [];
    const inp = h('input', { class: 'vc-qo-in', placeholder: '파일 이름으로 찾기', spellcheck: false });
    const list = h('div', { class: 'vc-qo-list' });
    const score = (f, q) => { const n = f.name.toLowerCase(), w = f.where.toLowerCase(); if (!q) return 1; if (n.startsWith(q)) return 4; if (n.includes(q)) return 3; let i = 0; for (const c of w) if (c === q[i]) i++; return i === q.length ? 1 : 0; };
    const draw = () => {
      const q = inp.value.toLowerCase().trim();
      shown = files.map(f => [score(f, q), f]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).slice(0, 60).map(x => x[1]);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.replaceChildren(...shown.map((f, i) => h('div', { class: 'vc-qo-row' + (i === sel ? ' on' : ''), onclick: () => pick(f) }, h('span', { class: 'vc-fi' }, fileIcon(f.name)), h('b', null, f.name), h('span', null, f.where))));
      if (!shown.length) list.append(h('p', { class: 'vc-empty' }, '찾는 파일이 없습니다.'));
    };
    const pick = f => { bg.remove(); openTab(f.spec); };
    inp.addEventListener('input', () => { sel = 0; draw(); });
    inp.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); } else if (e.key === 'Enter' && shown[sel]) pick(shown[sel]); else if (e.key === 'Escape') bg.remove(); });
    const bg = h('div', { class: 'vc-qo-bg', onclick: e => { if (e.target === bg) bg.remove(); } }, h('div', { class: 'vc-qo' }, inp, list));
    wrap.append(bg); draw(); inp.focus();
  }

  // ---------- help ----------
  function help() {
    const k = (...ks) => h('span', null, ...ks.flatMap((x, i) => [i ? '+' : '', h('kbd', null, x)]));
    const rows = [[k('Ctrl', 'P'), '파일 이름으로 바로 열기'], [k('Ctrl', 'S'), '저장 (내 드라이브는 자동 저장)'], [k('Ctrl', 'Shift', 'F'), '모든 파일에서 찾기'], [k('Ctrl', 'F'), '이 파일에서 찾기 · ', k('Ctrl', 'H'), ' 바꾸기'], [k('Ctrl', 'Shift', 'V'), 'Markdown 미리보기'], [k('F5'), '실행 (Windows 앱: Python·Node·PowerShell·배치 등)'], [k('Ctrl', '`'), '터미널 열기/닫기'], [k('Ctrl', 'B'), '사이드 열기/닫기'], [k('Ctrl', 'W'), '탭 닫기'], [k('Alt', '↑↓'), '줄 이동 · ', k('Shift', 'Alt', '↓'), ' 줄 복사'], [k('Ctrl', '/'), '주석 넣기/빼기'], [k('Ctrl', 'D'), '같은 단어 여러 개 동시 편집'], [k('F1'), '모든 명령 보기']];
    const bg = h('div', { class: 'ol-help-bg', onclick: e => { if (e.target === bg) bg.remove(); } },
      h('div', { class: 'ol-help', role: 'dialog', 'aria-label': 'VisualCode 사용법' },
        h('div', { class: 'ol-help-head' }, h('b', null, 'VisualCode 사용법'), h('button', { class: 'btn small ghost', onclick: () => bg.remove() }, '닫기')),
        h('div', { class: 'ol-help-grid', style: { gridTemplateColumns: '1.2fr 1fr' } },
          h('section', null, h('h5', null, '단축키'), ...rows.map(([a, b]) => h('div', { class: 'vc-hk' }, a, h('span', null, b)))),
          h('section', null, h('h5', null, '파일 위치'),
            h('p', { class: 'ol-li' }, h('b', null, '☁ 내 드라이브'), ' — 구글드라이브에 저장, PC·폰 어디서나 같은 파일. 10분 넘게 지나 고치면 이전 버전이 ‘변경·기록’에 남습니다.'),
            h('p', { class: 'ol-li' }, h('b', null, '💻 PC 폴더'), ' — 실제 파일을 직접 고칩니다. Ctrl+S로 저장, 지운 파일은 휴지통으로. Git 저장소면 바뀐 부분 비교와 커밋이 됩니다.'),
            h('p', { class: 'ol-li' }, h('b', null, 'AI 도우미'), ' — 코드를 선택하고 ‘고치기·개선’ 등을 누르면 비교 화면을 보여 주고, ‘적용’을 눌러야 바뀝니다.'),
            h('p', { class: 'ol-li' }, '예전 AIMD 글은 내 드라이브의 ', h('b', null, 'AIMD'), ' 폴더에 .md 파일로 옮겨져 있습니다.')))));
    wrap.append(bg);
  }

  // global keys while VisualCode is open (when the editor doesn't have focus)
  const onKey = e => {
    if (!document.body.contains(wrap)) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); quickOpen(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'Backquote') { e.preventDefault(); toggleTerm(); }
    else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyF' && !e.target.closest('.monaco-editor')) { e.preventDefault(); showSide('search'); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS' && !e.target.closest('.monaco-editor')) { e.preventDefault(); save(active); }
  };
  document.addEventListener('keydown', onKey);
  const beforeUnload = e => { if (tabs.some(t => t.kind !== 'd' && isDirty(t))) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  // ---------- start ----------
  await loadDrive(); await loadPc();
  drawSide(); drawTabs(); drawStatus();
  try {
    const saved = JSON.parse(await db.kvGet('vc-tabs', '[]') || '[]');
    if (saved.length) { monaco = await loadMonaco(); for (const s of saved) { if (s.kind === 'd' && !driveRecs.some(r => r.id === s.recId)) continue; await openTab(s).catch(() => {}); } }
    else loadMonaco().then(m => { monaco = m; }).catch(() => {});
  } catch (e) { toast(e.message, 'err'); }
  if (ctx && ctx.param) { const r = driveRecs.find(x => x.id === ctx.param); if (r) openTab({ kind: 'd', recId: r.id }); }

  return { cleanup: () => {
    for (const t of tabs) if (t.kind === 'd' && isDirty(t)) save(t);
    db.events.removeEventListener('change', onDb);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', beforeUnload);
    if (native.available && termStarted) native.call('term.kill', { id: TERM_ID }).catch(() => {});
    if (editor) editor.dispose(); if (diffEd) diffEd.dispose();
    tabs.forEach(t => t.model.dispose());
    document.querySelectorAll('.vc-menu').forEach(m => m.remove());
  } };
}
