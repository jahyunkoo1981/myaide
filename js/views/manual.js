import { h } from '../util.js';
import { renderMarkdown } from '../md.js';

export async function mount(root) {
  const box = h('div', { class: 'pad manual md' }, h('p', { class: 'muted' }, '불러오는 중…'));
  root.append(h('div', { class: 'view-head' }, h('h1', null, '사용 설명서')), box);
  try {
    const text = await (await fetch('manual.md')).text();
    box.innerHTML = renderMarkdown(text.replace(/^# .*\n/, ''));
  } catch { box.replaceChildren(h('p', { class: 'error' }, '설명서를 불러오지 못했습니다.')); }
}
