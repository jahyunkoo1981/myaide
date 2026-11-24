// Rich-text document editor used by 업무일지, 업무메모 and AIMD.
import { h, shrinkImage, toast } from './util.js';
import { openInkPad } from './inkpad.js';

const ALLOWED = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'MARK', 'IMG', 'A', 'HR',
  'BLOCKQUOTE', 'SPAN', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'PRE', 'CODE', 'S', 'SUB', 'SUP']);

// Keep only plain structure; drops scripts, event handlers, styles and unknown tags (their text stays).
export function sanitize(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  const walk = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) { child.remove(); continue; }
      if (child.nodeType !== 1) continue;
      if (!ALLOWED.has(child.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META'].includes(child.tagName)) { child.remove(); continue; }
        walk(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const a of [...child.attributes]) {
        const n = a.name.toLowerCase();
        const keep = (child.tagName === 'IMG' && (n === 'src' && /^(data:image\/|https:)/i.test(a.value) || n === 'data-ink' || n === 'alt' || (n === 'class' && a.value === 'ink')))
          || (child.tagName === 'A' && n === 'href' && /^(https?:|mailto:)/i.test(a.value))
          || ((child.tagName === 'TD' || child.tagName === 'TH') && (n === 'colspan' || n === 'rowspan'));
        if (!keep) child.removeAttribute(a.name);
      }
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

  const tb = (label, title, fn) => h('button', { type: 'button', title, 'aria-label': title, onmousedown: e => e.preventDefault(), onclick: fn }, label);
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': '서식' },
    tb(h('b', null, 'B'), '굵게 (Ctrl+B)', () => cmd('bold')),
    tb(h('i', null, 'I'), '기울임 (Ctrl+I)', () => cmd('italic')),
    tb(h('u', null, 'U'), '밑줄 (Ctrl+U)', () => cmd('underline')),
    tb('제목', '제목 줄', () => cmd('formatBlock', 'H2')),
    tb('본문', '본문 줄', () => cmd('formatBlock', 'P')),
    h('span', { class: 'gap' }),
    tb('• 목록', '글머리표', () => cmd('insertUnorderedList')),
    tb('1. 목록', '번호 목록', () => cmd('insertOrderedList')),
    tb('형광펜', '형광펜', () => {
      const sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return toast('형광펜을 칠할 글자를 먼저 선택하세요.');
      const text = sel.toString();
      insertHtml('<mark>' + text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>') + '</mark>');
    }),
    h('span', { class: 'gap' }),
    tb('이미지', '이미지 넣기', pickImage),
    tb('손글씨', '손글씨 쓰기', () => handwrite(null)),
    ...extraTools.map(t => tb(t.label, t.title || t.label, t.run)));

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
  body.addEventListener('dblclick', e => { if (e.target.matches('img.ink')) handwrite(e.target); });
  body.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank', 'noopener');
  });

  return {
    body, toolbar,
    get: () => sanitize(body.innerHTML),
    set: v => { body.innerHTML = sanitize(v); },
    insertImage,
    focus: () => body.focus()
  };
}
