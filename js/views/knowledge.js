import { h, uid, debounce, confirmBox, toast, fmtTime, listItem } from '../util.js';
import * as db from '../db.js';
import { renderMarkdown, wikiLinks } from '../md.js';

export async function mount(root, ctx) {
  let notes = [], openId = null, current = null, dirty = false;
  const search = h('input', { type: 'search', placeholder: '제목·내용·#태그 검색' });
  const list = h('div', { class: 'list' });
  const pane = h('section', { class: 'editor-pane' });
  const split = h('div', { class: 'split' },
    h('aside', { class: 'list-pane' },
      h('div', { class: 'list-tools' },
        h('div', { class: 'row' }, h('strong', { class: 'grow', style: { fontSize: '17px' } }, '지식노트'),
          h('button', { class: 'btn small primary', onclick: () => create('') }, '+ 새 노트')),
        search),
      list),
    pane);
  root.append(split);

  const byTitle = t => notes.find(n => (n.title || '').trim().toLowerCase() === t.trim().toLowerCase());
  const load = async () => { notes = (await db.all('knowledge')).sort((a, b) => b.updatedAt - a.updatedAt); };

  async function removeNote(n) {
    if (!await confirmBox(`‘${n.title || '제목 없음'}’ 노트를 삭제할까요?`, '삭제', true)) return;
    if (n.id === openId) { save.cancel(); dirty = false; }
    await db.remove('knowledge', n.id); toast('삭제했습니다');
    notes = notes.filter(x => x.id !== n.id);
    if (n.id === openId) ctx.go('knowledge'); else drawList();
  }

  function drawList() {
    const q = search.value.trim().toLowerCase();
    const shown = notes.filter(n => !q || (n.title || '').toLowerCase().includes(q) || (n.md || '').toLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown.map(n => listItem({ selected: n.id === openId, onOpen: () => ctx.go('knowledge', n.id), onDelete: () => removeNote(n),
      date: fmtTime(n.updatedAt), title: n.title || '제목 없음', sub: (n.md || '').replace(/[#>*`\[\]]/g, '').slice(0, 70) })) : [h('div', { class: 'list-empty' }, q ? '검색 결과가 없습니다.' : 'Markdown으로 지식을 쌓아 보세요. [[노트 제목]]으로 노트끼리 연결됩니다.')]));
  }

  async function create(title) {
    const id = uid();
    await db.put('knowledge', id, { title, md: title ? `# ${title}\n\n` : '' });
    ctx.go('knowledge', id);
  }

  const state = h('span', { class: 'save-state' });
  const save = debounce(async () => {
    if (!dirty) return; dirty = false;
    const { id, updatedAt, ...data } = current;
    await db.put('knowledge', openId, data); state.textContent = '저장됨';
  }, 700);

  async function open(id) {
    save.flush();
    openId = id; split.classList.toggle('has-open', !!id);
    if (!id) { pane.replaceChildren(h('div', { class: 'pad empty' }, h('b', null, '지식노트'), '노트를 고르거나 새로 만드세요.')); drawList(); return; }
    const data = await db.get('knowledge', id);
    if (!data) { pane.replaceChildren(h('div', { class: 'pad empty' }, h('b', null, '찾을 수 없습니다'), '삭제되었거나 아직 동기화되지 않았습니다.')); return; }
    current = { ...data };
    const title = h('input', { class: 'doc-title', value: data.title || '', placeholder: '노트 제목', oninput: e => { current.title = e.target.value; touch(); } });
    const text = h('textarea', { 'aria-label': 'Markdown 본문', spellcheck: 'false', placeholder: '# 제목\n\n- 목록\n**굵게**, `코드`, [[다른 노트]]' }, data.md || '');
    const preview = h('div', { class: 'preview md' });
    const backlinks = h('div', { class: 'backlinks' });
    const mdSplit = h('div', { class: 'md-split' }, text, preview);
    const draw = () => {
      preview.innerHTML = renderMarkdown(current.md, { exists: t => !!byTitle(t) });
      const mine = (current.title || '').trim().toLowerCase();
      const incoming = mine ? notes.filter(n => n.id !== openId && wikiLinks(n.md).some(t => t.toLowerCase() === mine)) : [];
      const outgoing = wikiLinks(current.md);
      backlinks.replaceChildren(
        h('div', null, h('b', null, '이 노트를 가리키는 노트 '), incoming.length ? incoming.map(n => h('button', { class: 'chip', style: { margin: '2px' }, onclick: () => ctx.go('knowledge', n.id) }, n.title || '제목 없음')) : h('span', { class: 'muted' }, '없음')),
        h('div', { style: { marginTop: '6px' } }, h('b', null, '연결한 노트 '), outgoing.length ? outgoing.map(t => h('button', { class: 'chip', style: { margin: '2px' }, onclick: () => follow(t) }, t + (byTitle(t) ? '' : ' (새로 만들기)'))) : h('span', { class: 'muted' }, '없음')));
    };
    const redraw = debounce(draw, 250);
    const touch = () => { dirty = true; state.textContent = '저장 중…'; save(); redraw(); };
    text.addEventListener('input', () => { current.md = text.value; touch(); });
    text.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
    });
    preview.addEventListener('click', e => { const a = e.target.closest('a[data-wiki]'); if (a) follow(a.dataset.wiki); });
    const toggle = h('button', { class: 'btn small', onclick: () => { mdSplit.classList.toggle('show-preview'); toggle.textContent = mdSplit.classList.contains('show-preview') ? '편집' : '미리보기'; } }, '미리보기');
    pane.replaceChildren(
      h('div', { class: 'doc-head' },
        h('div', { class: 'doc-meta' }, h('button', { class: 'btn small ghost back-btn', onclick: () => ctx.go('knowledge') }, '‹ 목록'), state, h('span', { class: 'grow' }), toggle,
          h('button', { class: 'btn small ghost danger', onclick: async () => {
            if (!await confirmBox(`‘${current.title || '제목 없음'}’ 노트를 삭제할까요?`, '삭제', true)) return;
            save.cancel(); dirty = false; await db.remove('knowledge', openId); toast('삭제했습니다'); ctx.go('knowledge');
          } }, '삭제')),
        title),
      mdSplit, backlinks);
    draw(); drawList();
  }

  async function follow(t) {
    const n = byTitle(t);
    if (n) ctx.go('knowledge', n.id);
    else if (await confirmBox(`‘${t}’ 노트가 없습니다. 새로 만들까요?`, '만들기')) create(t);
  }

  search.addEventListener('input', drawList);
  const onChange = async e => { if (e.detail.col === 'knowledge') { await load(); drawList(); } };
  db.events.addEventListener('change', onChange);
  window.addEventListener('pagehide', save.flush);
  await load();
  await open(ctx.param);
  return { open, cleanup: () => { save.flush(); db.events.removeEventListener('change', onChange); window.removeEventListener('pagehide', save.flush); } };
}
