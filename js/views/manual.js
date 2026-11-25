import { h } from '../util.js';
import { renderMarkdown } from '../md.js';

// 사용 설명서 + 설치 매뉴얼 (Google Drive, Google Cloud, GitHub, Git, .NET).
const DOCS = [['manual', '사용 설명서', 'manual.md'], ['setup', '설치 매뉴얼', 'setup.md']];
let last = 'manual';

export async function mount(root, ctx) {
  const box = h('div', { class: 'pad manual md' });
  const seg = h('div', { class: 'seg' });
  const show = async key => {
    last = key;
    [...seg.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === key)));
    box.replaceChildren(h('p', { class: 'muted' }, '불러오는 중…'));
    try {
      const text = await (await fetch(DOCS.find(d => d[0] === key)[2], { cache: 'no-cache' })).text();
      box.innerHTML = renderMarkdown(text.replace(/^# .*\n/, ''));
      box.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
    } catch { box.replaceChildren(h('p', { class: 'error' }, '설명서를 불러오지 못했습니다.')); }
  };
  DOCS.forEach(([k, label]) => seg.append(h('button', { type: 'button', 'data-k': k, onclick: () => show(k) }, label)));
  root.append(h('div', { class: 'view-head' }, h('h1', null, '사용 설명서'), seg), box);
  await show(ctx.param === 'setup' ? 'setup' : last);
  return { open: p => show(p === 'setup' ? 'setup' : 'manual') };
}
