// Small Markdown renderer (headings, emphasis, code, lists, quotes, links, tables, [[wiki links]]).
// Output is built from escaped text, so note content can't inject markup.
import { escapeHtml } from './util.js';

function inline(s, wiki) {
  let t = escapeHtml(s);
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = t.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => wiki(target.trim(), (label || target).trim()));
  t = t.replace(/!\[([^\]]*)\]\((https:[^)\s]+)\)/g, '<img alt="$1" src="$2">');
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>').replace(/==([^=]+)==/g, '<mark>$1</mark>');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  return t;
}

export function renderMarkdown(src, { exists = () => true } = {}) {
  const wiki = (target, label) =>
    `<a class="wiki${exists(target) ? '' : ' missing'}" data-wiki="${escapeHtml(target)}">${label}</a>`;
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`); continue;
    }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { const n = m[1].length; out.push(`<h${n}>${inline(m[2], wiki)}</h${n}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${buf.map(b => inline(b, wiki)).join('<br>')}</blockquote>`); continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const buf = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        const task = item.match(/^\[( |x|X)\]\s+(.*)$/);
        buf.push(task ? `<li>${task[1] === ' ' ? '☐' : '☑'} ${inline(task[2], wiki)}</li>` : `<li>${inline(item, wiki)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${buf.join('')}</${ordered ? 'ol' : 'ul'}>`); continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line); i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table class="data"><thead><tr>${head.map(c => `<th>${inline(c, wiki)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c, wiki)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+\.)\s|\|)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]);
    out.push(`<p>${buf.map(b => inline(b, wiki)).join('<br>')}</p>`);
  }
  return out.join('\n');
}

export function wikiLinks(src) {
  const set = new Set();
  String(src || '').replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_, t) => { set.add(t.trim()); return ''; });
  return [...set];
}
