// Outline editing for the rich editor (업무일지·업무메모):
// type "# ", "1. ", "- ", "[] ", "> " to start a heading / list / checklist / note,
// Tab and Shift+Tab move a line one level in or out, Alt+↑/↓ moves it with its sub-items,
// headings and list items can be folded, and a table of contents follows the headings.
import { h } from './util.js';
import { prefs, save as savePrefs, prefsEvents } from './prefs.js';

// Numbering style: 'num' = 1. → 1) → ①,  'report' = 1. → 1.1 → 1.1.1  (applies to every document)
const applyStyle = () => document.documentElement.classList.toggle('list-report', prefs().listStyle === 'report');
applyStyle(); prefsEvents.addEventListener('change', applyStyle);

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const isList = n => n && (n.tagName === 'OL' || n.tagName === 'UL');
const BLOCKS = new Set(['P', 'DIV', 'H2', 'H3', 'LI', 'BLOCKQUOTE', 'PRE']);

export function outline(body, changed) {
  const sel = () => getSelection();
  const caretNode = () => { const s = sel(); return s.rangeCount && body.contains(s.anchorNode) ? s.anchorNode : null; };
  const closest = (n, test) => { while (n && n !== body) { if (n.nodeType === 1 && test(n)) return n; n = n.parentNode; } return null; };
  const blockOf = n => closest(n, x => BLOCKS.has(x.tagName));
  const liOf = n => closest(n, x => x.tagName === 'LI');
  const keepCaret = fn => {
    const s = sel(); const r = s.rangeCount ? s.getRangeAt(0) : null;
    const a = r && [r.startContainer, r.startOffset, r.endContainer, r.endOffset];
    fn();
    if (a) { try { const nr = document.createRange(); nr.setStart(a[0], a[1]); nr.setEnd(a[2], a[3]); s.removeAllRanges(); s.addRange(nr); } catch { /* caret lost */ } }
  };
  // Older lists made by the browser put a sub-list straight inside a list; move it into the item above.
  const tidy = () => body.querySelectorAll('ol > ol, ol > ul, ul > ol, ul > ul').forEach(l => { const p = l.previousElementSibling; if (p && p.tagName === 'LI') p.append(l); });

  function indent(li) {
    const prev = li.previousElementSibling;
    if (!prev || prev.tagName !== 'LI') return false;
    keepCaret(() => {
      let sub = [...prev.children].reverse().find(isList);
      if (!sub) { sub = document.createElement(li.parentElement.tagName); if (li.parentElement.classList.contains('check')) sub.className = 'check'; prev.append(sub); }
      sub.append(li);
    });
    return true;
  }
  function outdent(li) {
    const list = li.parentElement, parentLi = list.parentElement;
    if (!parentLi || parentLi.tagName !== 'LI') return false;
    keepCaret(() => {
      const after = []; let n = li.nextElementSibling; while (n) { after.push(n); n = n.nextElementSibling; }
      if (after.length) {
        let sub = [...li.children].reverse().find(isList);
        if (!sub) { sub = document.createElement(list.tagName); if (list.classList.contains('check')) sub.className = 'check'; li.append(sub); }
        sub.append(...after);
      }
      parentLi.after(li);
      if (!list.children.length) list.remove();
    });
    return true;
  }
  function move(dir) {
    const n = caretNode(); if (!n) return;
    let item = liOf(n) || blockOf(n);
    if (!item) return;
    while (item.parentNode !== body && item.tagName !== 'LI') item = item.parentNode;
    const other = dir < 0 ? item.previousElementSibling : item.nextElementSibling;
    if (!other) return;
    keepCaret(() => dir < 0 ? other.before(item) : other.after(item));
    item.scrollIntoView({ block: 'nearest' }); changed(); refresh();
  }
  // Replace the typed marker at the start of a block with a real heading / list.
  function autoFormat() {
    const s = sel(); if (!s.isCollapsed) return;
    const node = s.anchorNode; if (!node || node.nodeType !== 3) return;
    const block = blockOf(node);
    if (block) { const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); if (w.nextNode() !== node) return; }
    else {   // bare text straight in the document (first line): it must start the line
      if (node.parentNode !== body) return;
      const pv = node.previousSibling; if (pv && !(pv.nodeType === 1 && (pv.tagName === 'BR' || BLOCKS.has(pv.tagName) || isList(pv)))) return;
    }
    const typed = node.data.slice(0, s.anchorOffset).replace(/ /g, ' ');
    const m = typed.match(/^(#{1,2}|\d{1,2}[.)]|[-*•]|\[ ?\]|>) $/); if (!m) return;
    const mark = m[1];
    const r = document.createRange(); r.setStart(node, 0); r.setEnd(node, s.anchorOffset);
    s.removeAllRanges(); s.addRange(r); document.execCommand('delete');
    const inLi = liOf(node);
    if (mark[0] === '#') document.execCommand('formatBlock', false, mark.length === 1 ? 'H2' : 'H3');
    else if (mark === '>') document.execCommand('formatBlock', false, 'BLOCKQUOTE');
    else {
      const want = /\d/.test(mark) ? 'OL' : 'UL';
      if (inLi) {   // already a list: switch this level's type
        const list = inLi.parentElement;
        if (list.tagName !== want) keepCaret(() => { const nl = document.createElement(want); for (const a of list.attributes) nl.setAttribute(a.name, a.value); nl.append(...list.childNodes); list.replaceWith(nl); });
      } else document.execCommand(want === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
      const li = liOf(sel().anchorNode);
      if (li) li.parentElement.classList.toggle('check', /\[/.test(mark));
      tidy();
    }
    changed(); refresh();
  }

  body.addEventListener('input', e => { if (e.inputType === 'insertText' && e.data === ' ') autoFormat(); else if (e.inputType === 'insertCompositionText' || e.inputType === 'insertText') { /* nothing */ } refreshSoon(); });
  body.addEventListener('compositionend', () => setTimeout(autoFormat, 0));
  body.addEventListener('keydown', e => {
    if (e.isComposing) return;
    const n = caretNode();
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const li = n && liOf(n);
      if (li) { if (e.shiftKey ? outdent(li) : indent(li)) { changed(); refresh(); } else if (e.shiftKey) { document.execCommand('outdent'); changed(); } }
      else if (!e.shiftKey) document.execCommand('insertText', false, '    ');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && n) {
      const bq = closest(n, x => x.tagName === 'BLOCKQUOTE');
      if (bq) {   // a memo box keeps growing line by line; Enter on an empty last line leaves it
        e.preventDefault();
        const txt = bq.textContent.replace(/\u200b/g, '');
        const r = sel().getRangeAt(0), tail = document.createRange(); tail.selectNodeContents(bq); tail.setStart(r.endContainer, r.endOffset);
        const atEnd = !tail.toString().trim();
        if (!txt.trim()) { document.execCommand('formatBlock', false, 'P'); changed(); return; }
        if (atEnd && /\n$|^$/.test(bq.innerText.slice(bq.innerText.trimEnd().length - 0)) && bq.lastChild && bq.lastChild.nodeName === 'BR' && (!bq.lastChild.previousSibling || bq.lastChild.previousSibling.nodeName === 'BR')) {
          while (bq.lastChild && bq.lastChild.nodeName === 'BR' && bq.childNodes.length > 1) bq.lastChild.remove();
          const p = document.createElement('p'); p.append(document.createElement('br')); bq.after(p);
          const nr = document.createRange(); nr.setStart(p, 0); nr.collapse(true); sel().removeAllRanges(); sel().addRange(nr);
        } else document.execCommand('insertLineBreak');
        changed(); return;
      }
      const li = liOf(n);
      if (li && !li.textContent.replace(/​/g, '').trim() && !li.querySelector('img') && li.parentElement.parentElement.tagName === 'LI') {
        e.preventDefault(); outdent(li); changed(); refresh(); return;   // empty line inside a sub-list: step one level out
      }
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(e.key === 'ArrowUp' ? -1 : 1); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'Digit7') { e.preventDefault(); listCmd('OL'); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'Digit8') { e.preventDefault(); listCmd('UL'); return; }
    if ((e.ctrlKey || e.metaKey) && (e.code === 'BracketRight' || e.code === 'BracketLeft')) { e.preventDefault(); step(e.code === 'BracketRight' ? 1 : -1); }
  });
  // Checklist: click the box to tick an item.
  body.addEventListener('mousedown', e => {
    const li = e.target.tagName === 'LI' ? e.target : null;
    if (li && li.parentElement.classList.contains('check') && e.offsetX < 24) { e.preventDefault(); li.classList.toggle('done'); changed(); }
  });

  const listCmd = tag => {
    body.focus();
    const li = liOf(caretNode());
    if (li && li.parentElement.tagName !== tag) keepCaret(() => { const list = li.parentElement, nl = document.createElement(tag); nl.append(...list.childNodes); list.replaceWith(nl); });
    else document.execCommand(tag === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
    tidy(); changed(); refresh();
  };
  const checkCmd = () => {
    body.focus();
    let li = liOf(caretNode());
    if (!li) { document.execCommand('insertUnorderedList'); li = liOf(caretNode()); }
    else if (li.parentElement.tagName !== 'UL') listCmd('UL');
    li = liOf(caretNode()); if (li) li.parentElement.classList.toggle('check');
    changed();
  };
  const step = dir => {
    body.focus();
    const li = liOf(caretNode());
    if (li) { if (dir > 0 ? indent(li) : outdent(li)) { changed(); refresh(); } else if (dir < 0) { document.execCommand('outdent'); changed(); } }
  };

  // ---- folding ----
  const level = el => el.tagName === 'H2' ? 1 : el.tagName === 'H3' ? 2 : 9;
  function applyFolds() {
    const kids = [...body.children];
    let hideUntil = 0;   // heading level that started the fold, 0 = none
    for (const k of kids) {
      const lv = level(k);
      if (hideUntil && lv <= hideUntil) hideUntil = 0;
      k.classList.toggle('ol-hidden', !!hideUntil);
      if (!hideUntil && lv < 9 && k.classList.contains('fold')) hideUntil = lv;
    }
    body.querySelectorAll('li').forEach(li => li.classList.toggle('has-sub', !![...li.children].find(isList)));
  }
  const foldBtn = h('button', { type: 'button', class: 'ol-fold', tabindex: -1, 'aria-label': '접기/펼치기', onmousedown: e => e.preventDefault(),
    onclick: () => { const t = foldBtn._t; if (!t) return; t.classList.toggle('fold'); if (!t.classList.length) t.removeAttribute('class'); changed(); refresh(); place(t); } });
  const place = t => {
    foldBtn._t = t;
    if (!t) { foldBtn.style.display = 'none'; return; }
    const r = t.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(t).lineHeight) || 24;
    foldBtn.textContent = t.classList.contains('fold') ? '▸' : '▾';
    foldBtn.style.display = 'block';
    foldBtn.style.left = (r.left - (t.tagName === 'LI' ? 50 : 24)) + 'px';
    foldBtn.style.top = (r.top + Math.min(lh, r.height) / 2 - 11) + 'px';
  };
  document.querySelectorAll('.ol-fold').forEach(b => b.remove());   // one editor on screen at a time
  document.body.append(foldBtn);
  body.addEventListener('mousemove', e => {
    let t = e.target;
    while (t && t !== body && !(t.tagName === 'H2' || t.tagName === 'H3' || (t.tagName === 'LI' && t.classList.contains('has-sub')))) t = t.parentNode;
    if (t && t !== body) {   // in a list item, only the item's own first line counts (not its children)
      if (t.tagName === 'LI') { const sub = [...t.children].find(isList); if (sub && e.clientY > sub.getBoundingClientRect().top && !t.classList.contains('fold')) t = null; }
      place(t && t !== body ? t : null);
    } else if (!foldBtn.matches(':hover')) place(null);
  });
  body.addEventListener('mouseleave', e => { if (e.relatedTarget !== foldBtn) place(null); });
  body.addEventListener('scroll', () => place(null), true);
  body.closest && setTimeout(() => body.parentElement?.addEventListener('scroll', () => place(null)), 0);

  // ---- table of contents ----
  const toc = h('nav', { class: 'ol-toc', 'aria-label': '목차' });
  function drawToc() {
    const hs = [...body.querySelectorAll('h2, h3')].filter(x => x.textContent.trim());
    toc.classList.toggle('empty', !hs.length);
    toc.replaceChildren(h('div', { class: 'ol-toc-t' }, '목차'), ...hs.map(x => h('a', { href: '#', class: x.tagName === 'H3' ? 'sub' : '', onclick: e => {
      e.preventDefault();
      if (x.classList.contains('ol-hidden')) { let p = x.previousElementSibling; while (p) { if (p.classList.contains('fold')) { p.classList.remove('fold'); break; } p = p.previousElementSibling; } applyFolds(); }
      x.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const r = document.createRange(); r.selectNodeContents(x); r.collapse(false); const s = sel(); s.removeAllRanges(); s.addRange(r);
    } }, x.textContent.trim())));
  }
  function refresh() { applyFolds(); drawToc(); }
  let t0 = null; const refreshSoon = () => { clearTimeout(t0); t0 = setTimeout(refresh, 250); };

  // ---- paste: plain text written with 1. / - / # becomes a real outline ----
  body.addEventListener('paste', e => {
    const html = e.clipboardData?.getData('text/html'); if (html) return;
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!/^\s*(#{1,2}\s|\d{1,2}[.)]\s|[-*•]\s|\[ ?\]\s)/m.test(text)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    document.execCommand('insertHTML', false, textToHtml(text));
    tidy(); changed(); refresh();
  }, true);
  // ---- copy: keep the numbers and indents when pasted as plain text (메일·메신저) ----
  body.addEventListener('copy', e => {
    const s = sel(); if (!s.rangeCount || s.isCollapsed) return;
    const wrap = document.createElement('div'); wrap.append(s.getRangeAt(0).cloneContents());
    if (!wrap.querySelector('li, h2, h3')) return;
    e.preventDefault();
    e.clipboardData.setData('text/html', wrap.innerHTML);
    e.clipboardData.setData('text/plain', htmlToText(wrap));
  });

  // ---- help ----
  const help = () => {
    const cur = prefs().listStyle === 'report' ? 'report' : 'num';
    const opt = (v, label, ex) => h('label', { class: 'ol-opt' + (cur === v ? ' on' : '') },
      h('input', { type: 'radio', name: 'ol-style', checked: cur === v, onchange: () => { savePrefs({ listStyle: v }); box.querySelectorAll('.ol-opt').forEach(o => o.classList.toggle('on', o.contains(document.activeElement) || o.querySelector('input').checked)); } }),
      h('b', null, label), h('span', null, ex));
    const k = t => h('kbd', null, t);
    const box = h('div', { class: 'ol-help-bg', onclick: e => { if (e.target === box) box.remove(); } },
      h('div', { class: 'ol-help', role: 'dialog', 'aria-label': '목록·제목 사용법' },
        h('div', { class: 'ol-help-head' }, h('b', null, '목록·제목 사용법'), h('button', { class: 'btn small ghost', onclick: () => box.remove() }, '닫기')),
        h('div', { class: 'ol-help-grid' },
          h('section', null, h('h5', null, '기호를 치면 자동 변환'),
            ...[['# ', '큰 제목'], ['## ', '중간 제목'], ['1. ', '번호 목록'], ['- ', '• 글머리 목록'], ['[] ', '☐ 체크 목록'], ['> ', '메모 박스']].map(([a, b]) => h('div', { class: 'ol-row' }, h('code', null, a.replace(' ', '␣')), h('span', { class: 'ar' }, '→'), b)),
            h('p', { class: 'hint' }, '줄 맨 앞에서 기호를 치고 스페이스를 누르면 바뀝니다.')),
          h('section', null, h('h5', null, '단계 이동'),
            h('div', { class: 'ol-row' }, k('Tab'), ' 한 단계 안으로'),
            h('div', { class: 'ol-row' }, k('Shift'), '+', k('Tab'), ' 한 단계 밖으로'),
            h('div', { class: 'ol-row' }, '빈 줄에서 ', k('Enter'), ' 한 단계씩 빠져나옴'),
            h('div', { class: 'ol-row' }, k('Alt'), '+', k('↑'), k('↓'), ' 하위 항목째 위아래로'),
            h('div', { class: 'ol-row' }, k('Ctrl'), '+', k('Shift'), '+', k('7'), ' 번호 · ', k('8'), ' 글머리'),
            h('p', { class: 'hint' }, '폰·아이패드는 툴바의 ◀ ▶ 버튼으로 단계를 바꿉니다.')),
          h('section', null, h('h5', null, '정리하기'),
            h('p', { class: 'ol-li' }, '제목·항목에 마우스를 올리면 왼쪽에 ▾ 가 나옵니다. 누르면 아래 내용을 접고 펼칩니다.'),
            h('p', { class: 'ol-li' }, '체크 목록은 네모를 누르면 완료로 표시됩니다.'),
            h('p', { class: 'ol-li' }, '오른쪽 목차에서 제목을 누르면 그 위치로 갑니다.'),
            h('p', { class: 'ol-li' }, '메모장에서 1. / - 로 쓴 글을 붙여넣으면 목록이 되고, 복사해 메일에 붙이면 번호·들여쓰기가 그대로 갑니다.'))),
        h('h5', { style: { margin: '14px 0 8px' } }, '번호 스타일 (모든 문서에 적용)'),
        h('div', { class: 'ol-opts' }, opt('num', '숫자·기호식', '1.  →  1)  →  ①'), opt('report', '보고서식', '1.  →  1.1  →  1.1.1')),
        h('p', { class: 'hint' }, '글머리는 단계마다 •  →  ◦  →  ▪ 으로 바뀝니다.')));
    document.body.append(box);
  };

  const tb = (label, title, fn, cls) => h('button', { type: 'button', title, 'aria-label': title, class: cls || null, onmousedown: e => e.preventDefault(), onclick: fn }, label);
  const tools = [
    tb('제목', '제목 (# + 스페이스)', () => { body.focus(); const b = blockOf(caretNode()); document.execCommand('formatBlock', false, b && b.tagName === 'H2' ? 'H3' : b && b.tagName === 'H3' ? 'P' : 'H2'); changed(); refresh(); }),
    tb('1. 번호', '번호 목록 (1. + 스페이스 · Ctrl+Shift+7)', () => listCmd('OL')),
    tb('• 글머리', '글머리 목록 (- + 스페이스 · Ctrl+Shift+8)', () => listCmd('UL')),
    tb('☐ 체크', '체크 목록 ([] + 스페이스)', checkCmd),
    tb('◀', '내어쓰기 (Shift+Tab)', () => step(-1)),
    tb('▶', '들여쓰기 (Tab)', () => step(1)),
    tb('?', '목록·제목 사용법', help, 'ol-q')
  ];
  tidy(); refresh();
  return { tools, toc, refresh, help, destroy: () => foldBtn.remove() };
}

// ---------- plain text ⇄ outline ----------
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export function textToHtml(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  let out = '', stack = [];   // [{tag, indent, cls}]
  const close = to => { while (stack.length > to) { out += `</li></${stack.pop().tag.toLowerCase()}>`; } };
  for (const raw of lines) {
    const ind = (raw.match(/^[ \t　]*/)[0]).replace(/\t/g, '    ').replace(/　/g, '  ').length;
    const s = raw.trim();
    let m;
    if ((m = s.match(/^(#{1,2})\s+(.*)$/))) { close(0); out += `<h${m[1].length + 1}>${esc(m[2])}</h${m[1].length + 1}>`; continue; }
    m = s.match(/^(\d{1,2}[.)]|\d+(\.\d+)+\.?|[가-하][.)]|\(\d{1,2}\)|[①-⑳]|[-*•◦▪·]|\[( |x|X)?\])\s*(.*)$/);
    if (m && (m[4] || '').length) {
      const ordered = !/^[-*•◦▪·[]/.test(m[1]);
      const tag = ordered ? 'OL' : 'UL', cls = m[1][0] === '[' ? ' class="check"' : '';
      const done = /\[[xX]\]/.test(m[1]) ? ' class="done"' : '';
      while (stack.length && ind < stack[stack.length - 1].indent) close(stack.length - 1);
      const top = stack[stack.length - 1];
      if (!top || ind > top.indent) { out += `<${tag.toLowerCase()}${cls}>`; stack.push({ tag, indent: ind }); }
      else { out += '</li>'; if (top.tag !== tag) { out += `</${top.tag.toLowerCase()}><${tag.toLowerCase()}${cls}>`; top.tag = tag; } }
      out += `<li${done}>${esc(m[4])}`;
      continue;
    }
    close(0);
    out += s ? `<p>${esc(s)}</p>` : '<p><br></p>';
  }
  close(0);
  return out;
}
export function htmlToText(root) {
  const report = document.documentElement.classList.contains('list-report');
  const lines = [];
  const inline = el => { let t = ''; for (const c of el.childNodes) { if (c.nodeType === 3) t += c.data; else if (c.nodeType === 1 && !isList(c)) t += c.tagName === 'BR' ? ' ' : inline(c); } return t.replace(/ /g, ' ').trim(); };
  const walkList = (list, depth, nums, olDepth) => {
    let i = 0;
    for (const li of list.children) {
      if (li.tagName !== 'LI') continue;
      i++;
      const ol = list.tagName === 'OL', d = olDepth + (ol ? 1 : 0);
      let mark;
      if (list.classList.contains('check')) mark = li.classList.contains('done') ? '☑' : '☐';
      else if (!ol) mark = ['•', '◦', '▪'][depth % 3];
      else if (report) mark = [...nums, i].join('.') + (d === 1 ? '.' : '');
      else mark = d === 1 ? i + '.' : d === 2 ? i + ')' : (CIRCLED[i - 1] || `(${i})`);
      lines.push('  '.repeat(depth) + mark + ' ' + inline(li));
      for (const sub of li.children) if (isList(sub)) walkList(sub, depth + 1, ol ? [...nums, i] : nums, d);
    }
  };
  const blocks = parent => {
    let run = '';
    const flush = () => { if (run.trim()) lines.push(run.replace(/\u00a0/g, ' ').trim()); run = ''; };
    for (const n of parent.childNodes) {
      if (n.nodeType === 3) { run += n.data; continue; }
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'BR') { flush(); continue; }
      if (/^(SPAN|B|STRONG|I|EM|U|MARK|A|S|SUB|SUP|CODE)$/.test(n.tagName)) { run += n.textContent; continue; }
      flush();
      if (isList(n)) walkList(n, 0, [], 0);
      else if (n.tagName === 'H2') lines.push('# ' + inline(n));
      else if (n.tagName === 'H3') lines.push('## ' + inline(n));
      else if (n.tagName === 'LI') lines.push('• ' + inline(n));
      else if (n.querySelector('ol, ul, h2, h3, p, div, blockquote')) blocks(n);
      else { const t = inline(n); lines.push(n.tagName === 'BLOCKQUOTE' ? '> ' + t : t); }
    }
    flush();
  };
  blocks(root);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
