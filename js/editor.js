// Rich-text document editor used by 업무일지, 업무메모 and AIMD.
import { h, shrinkImage, toast } from './util.js';
import { openInkPad } from './inkpad.js';
import { outline } from './outline.js';

const ALLOWED = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'MARK', 'IMG', 'A', 'HR',
  'BLOCKQUOTE', 'SPAN', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'PRE', 'CODE', 'S', 'SUB', 'SUP']);

// Text colour, highlight colour and size are the only styles kept (on SPAN / MARK / FONT), with checked values.
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/i;
const SIZE_RE = /^(\d{1,2}(\.\d+)?)(px|pt)$/i;
function cleanStyle(el) {
  const out = [];
  const c = el.style.color, b = el.style.backgroundColor, f = el.style.fontSize;
  if (c && COLOR_RE.test(c.trim())) out.push('color:' + c.trim());
  if (b && COLOR_RE.test(b.trim())) out.push('background-color:' + b.trim());
  if (f && SIZE_RE.test(f.trim())) { const v = parseFloat(f); const px = /pt$/i.test(f) ? v * 4 / 3 : v; if (px >= 8 && px <= 72) out.push('font-size:' + Math.round(px) + 'px'); }
  return out.join(';');
}

// Keep only plain structure; drops scripts, event handlers, other styles and unknown tags (their text stays).
export function sanitize(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  const walk = node => {
    for (let child of [...node.childNodes]) {
      if (child.nodeType === 8) { child.remove(); continue; }
      if (child.nodeType !== 1) continue;
      if (child.tagName === 'FONT') {   // old-style colour tags from pasting: turn into a styled span
        const span = document.createElement('span');
        const col = child.getAttribute('color'); if (col && COLOR_RE.test(col)) span.style.color = col;
        span.setAttribute('style', [span.getAttribute('style'), child.getAttribute('style')].filter(Boolean).join(';'));
        span.append(...child.childNodes); child.replaceWith(span); child = span;
      }
      if (!ALLOWED.has(child.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META'].includes(child.tagName)) { child.remove(); continue; }
        walk(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      const st = (child.tagName === 'SPAN' || child.tagName === 'MARK') ? cleanStyle(child) : '';
      for (const a of [...child.attributes]) {
        const n = a.name.toLowerCase();
        const keep = (child.tagName === 'IMG' && (n === 'src' && /^(data:image\/|https:)/i.test(a.value) || n === 'data-ink' || n === 'data-flow' || n === 'alt' || n === 'width' && /^\d{1,4}$/.test(a.value) || (n === 'class' && (a.value === 'ink' || a.value === 'flow'))))
          || (child.tagName === 'A' && n === 'href' && /^(https?:|mailto:)/i.test(a.value))
          || ((child.tagName === 'TD' || child.tagName === 'TH') && (n === 'colspan' || n === 'rowspan'));
        if (n === 'class' && !keep && /^(UL|LI|H2|H3)$/.test(child.tagName)) {   // outline state: checklist, done, folded
          const ok = a.value.split(/\s+/).filter(c => (child.tagName === 'UL' ? c === 'check' : child.tagName === 'LI' ? c === 'done' || c === 'fold' : c === 'fold'));
          if (ok.length) { child.setAttribute('class', ok.join(' ')); continue; }
        }
        if (!keep) child.removeAttribute(a.name);
      }
      if (st) child.setAttribute('style', st);
      if (child.tagName === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener'); }
      walk(child);
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

export function richEditor({ value = '', placeholder = '', onChange, extraTools = [] }) {
  const body = h('div', { class: 'rich', contenteditable: 'true', 'data-placeholder': placeholder, spellcheck: 'false' });
  body.innerHTML = sanitize(value);
  const changed = () => onChange && onChange();
  const cmd = (c, v) => { body.focus(); document.execCommand(c, false, v); changed(); };

  const insertHtml = html => { body.focus(); document.execCommand('insertHTML', false, html); changed(); };
  const insertImage = (src, ink) => insertHtml(`<p><img src="${src}"${ink ? ` class="ink" data-ink="${encodeURIComponent(JSON.stringify(ink))}"` : ''} alt=""></p><p><br></p>`);
  // A process diagram sits in the text as a picture that remembers its drawing; double-click to edit it.
  // Remember where the caret was in this document, so a picture made in a dialog lands there.
  let lastRange = null;
  const track = () => { const s = getSelection(); if (s.rangeCount && body.contains(s.anchorNode)) lastRange = s.getRangeAt(0).cloneRange(); };
  document.addEventListener('selectionchange', track);
  const process = async img => {
    track();
    // Save the caret as a path of child positions: the page may be re-rendered (sync) while the dialog is open.
    const pathOf = (node, off) => { const p = []; while (node && node !== body) { p.unshift([...node.parentNode.childNodes].indexOf(node)); node = node.parentNode; } return node === body ? { p, off } : null; };
    const saved = lastRange && body.contains(lastRange.startContainer) ? pathOf(lastRange.startContainer, lastRange.startOffset) : null;
    const rangeFrom = s0 => { if (!s0) return null; let n = body; for (const i of s0.p) { n = n.childNodes[i]; if (!n) return null; } const r = document.createRange(); try { r.setStart(n, Math.min(s0.off, n.nodeType === 3 ? n.length : n.childNodes.length)); } catch { return null; } r.collapse(true); return r; };
    const { openFlowDialog } = await import('./flowedit.js');
    const prev = img ? JSON.parse(decodeURIComponent(img.dataset.flow || '%7B%7D')) : null;
    const sel = getSelection();
    const r = await openFlowDialog(prev);
    if (!r) return;
    const data = encodeURIComponent(JSON.stringify(r.flow));
    const w = Math.min(r.width, 900);
    if (img) { img.src = r.dataUrl; img.dataset.flow = data; img.setAttribute('width', w); changed(); return; }
    body.focus();
    const at = rangeFrom(saved) || (() => { const r = document.createRange(); r.selectNodeContents(body); r.collapse(false); return r; })();
    sel.removeAllRanges(); sel.addRange(at);
    insertHtml(`<p><img class="flow" src="${r.dataUrl}" data-flow="${data}" width="${w}" alt="프로세스"></p><p><br></p>`);
  };

  const pickImage = () => {
    const input = h('input', { type: 'file', accept: 'image/*' });
    input.onchange = async () => { if (input.files[0]) insertImage(await shrinkImage(input.files[0])); };
    input.click();
  };
  const handwrite = async (img) => {
    const prev = img ? JSON.parse(decodeURIComponent(img.dataset.ink || '%5B%5D')) : null;
    const r = await openInkPad(prev);
    if (!r) return;
    if (img) {
      if (!r.strokes.length) img.closest('p') ? img.closest('p').remove() : img.remove();
      else { img.src = r.dataUrl; img.dataset.ink = encodeURIComponent(JSON.stringify(r.strokes)); }
      changed();
    } else if (r.strokes.length) insertImage(r.dataUrl, r.strokes);
  };

  const ol = outline(body, changed);
  const tb = (label, title, fn) => h('button', { type: 'button', title, 'aria-label': title, onmousedown: e => e.preventDefault(), onclick: fn }, label);
  const needSel = what => { const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed || !body.contains(sel.anchorNode)) { toast(what + ' 바꿀 글자를 먼저 선택하세요.'); return false; } return true; };
  const styled = (c, v) => { body.focus(); document.execCommand('styleWithCSS', false, true); document.execCommand(c, false, v); document.execCommand('styleWithCSS', false, false); };
  // Small palette that opens under its button; the text selection stays because buttons don't take focus.
  let pop = null;
  const closePop = () => { if (pop) { pop.remove(); pop = null; } };
  const palette = (anchor, colors, onPick, clearLabel) => {
    if (pop) { const same = pop.anchor === anchor; closePop(); if (same) return; }
    pop = h('div', { class: 'color-pop', role: 'menu' },
      ...colors.map(([c, name]) => h('button', { type: 'button', class: 'swatch', title: name, 'aria-label': name, style: { background: c }, onmousedown: e => e.preventDefault(), onclick: () => { onPick(c); closePop(); } })),
      clearLabel ? h('button', { type: 'button', class: 'btn small ghost', onmousedown: e => e.preventDefault(), onclick: () => { onPick(null); closePop(); } }, clearLabel) : null);
    pop.anchor = anchor;
    anchor.parentElement.append(pop);
    const r = anchor.getBoundingClientRect(), pr = anchor.parentElement.getBoundingClientRect();
    pop.style.left = (r.left - pr.left) + 'px'; pop.style.top = (r.bottom - pr.top + 4) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function away(e) { if (pop && !pop.contains(e.target) && e.target !== anchor) { closePop(); } document.removeEventListener('mousedown', away); }), 0);
  };
  const TEXT_COLORS = [['#262A3B', '검정'], ['#8D92A6', '회색'], ['#D93F4C', '빨강'], ['#E07A2E', '주황'], ['#2F8467', '초록'], ['#3346C8', '파랑'], ['#7B4FC4', '보라'], ['#B5546B', '자주']];
  const MARKS = [['#FFF1A8', '노랑'], ['#C9F2D6', '연두'], ['#FFD3DC', '분홍'], ['#CFE6FF', '하늘'], ['#FFDDBE', '주황'], ['#E5D9FF', '보라']];
  const SIZES = [11, 12, 14, 16, 18, 20, 24, 28, 32, 40];
  const colorBtn = tb(h('span', { class: 'tb-color' }, '가', h('i', { style: { background: '#D93F4C' } })), '글자 색', e => {
    palette(e.currentTarget, TEXT_COLORS, c => { if (!needSel('글자 색을')) return; styled('foreColor', c || '#262A3B'); colorBtn.querySelector('i').style.background = c || '#262A3B'; changed(); }, '기본 색');
  });
  const markBtn = tb(h('span', { class: 'tb-color' }, '형광펜', h('i', { style: { background: '#FFF1A8' } })), '형광펜', e => {
    palette(e.currentTarget, MARKS, c => {
      if (!needSel('형광펜을')) return;
      styled('hiliteColor', c || 'transparent');
      if (!c) body.querySelectorAll('mark').forEach(m => { if (getSelection().containsNode(m, true)) m.replaceWith(...m.childNodes); });
      else markBtn.querySelector('i').style.background = c;
      changed();
    }, '형광펜 지우기');
  });
  const sizeSel = h('select', { class: 'tb-size', title: '글자 크기', 'aria-label': '글자 크기',
    onmousedown: () => { const sel = getSelection(); sizeSel._range = sel.rangeCount && body.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null; },
    onchange: () => {
      const v = Number(sizeSel.value); sizeSel.value = '';
      const range = sizeSel._range; if (!v) return;
      const sel = getSelection(); if (range) { sel.removeAllRanges(); sel.addRange(range); }
      if (!needSel('글자 크기를')) return;
      styled('fontSize', 7);
      body.querySelectorAll('span[style*="xxx-large"], font[size="7"]').forEach(x => { const sp = document.createElement('span'); sp.style.fontSize = v + 'px'; if (x.style.color) sp.style.color = x.style.color; if (x.style.backgroundColor) sp.style.backgroundColor = x.style.backgroundColor; sp.append(...x.childNodes); x.replaceWith(sp); });
      changed();
    } }, h('option', { value: '' }, '크기'), ...SIZES.map(v => h('option', { value: v }, v + 'px')));
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': '서식' },
    tb(h('b', null, 'B'), '굵게 (Ctrl+B)', () => cmd('bold')),
    tb(h('i', null, 'I'), '기울임 (Ctrl+I)', () => cmd('italic')),
    tb(h('u', null, 'U'), '밑줄 (Ctrl+U)', () => cmd('underline')),
    tb('본문', '본문 줄', () => cmd('formatBlock', 'P')),
    h('span', { class: 'gap' }),
    ...ol.tools.slice(0, -1),
    h('span', { class: 'gap' }),
    sizeSel, colorBtn, markBtn,
    h('span', { class: 'gap' }),
    tb('이미지', '이미지 넣기', pickImage),
    tb('손글씨', '손글씨 쓰기', () => handwrite(null)),
    tb('프로세스', '프로세스(흐름도) 넣기 — 넣은 뒤 그림을 더블클릭하면 고칩니다', () => process(null)),
    ...extraTools.map(t => tb(t.label, t.title || t.label, t.run)),
    h('span', { class: 'grow' }), ol.tools[ol.tools.length - 1]);

  body.addEventListener('input', changed);
  body.addEventListener('paste', async e => {
    const items = [...(e.clipboardData?.items || [])];
    const img = items.find(i => i.type.startsWith('image/'));
    if (img) { e.preventDefault(); insertImage(await shrinkImage(img.getAsFile())); return; }
    const html = e.clipboardData?.getData('text/html');
    if (html) { e.preventDefault(); insertHtml(sanitize(html)); }
  });
  body.addEventListener('drop', async e => {
    const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); insertImage(await shrinkImage(file)); }
  });
  body.addEventListener('dblclick', e => { if (e.target.matches('img.ink')) handwrite(e.target); if (e.target.matches('img.flow')) process(e.target); });
  body.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank', 'noopener');
  });

  return {
    body, toolbar,
    get: () => sanitize(body.innerHTML),
    set: v => { body.innerHTML = sanitize(v); ol.refresh(); },
    toc: ol.toc, help: ol.help,
    insertImage, insertHtml,
    focus: () => body.focus()
  };
}
