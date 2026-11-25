// 업무메모 (dated memos) and AIMD (prompt library): titled rich-text pages.
import { h, uid, today, plain, debounce, confirmBox, copyText, toast } from '../util.js';
import * as db from '../db.js';
import { richEditor } from '../editor.js';

const KINDS = {
  notes: { title: '업무메모', newLabel: '새 메모', empty: '메모가 없습니다. ‘새 메모’로 시작하세요.', placeholder: '메모 내용을 적으세요. 도구 막대의 ‘프로세스’로 흐름도를 중간에 넣을 수 있습니다.' },
  aimd: { title: 'AIMD', newLabel: '새 AIMD', empty: '저장한 프롬프트가 없습니다. 자주 쓰는 AI 지시문을 모아 두세요.', placeholder: 'AI에게 줄 지시문을 적으세요.' }
};

export async function mount(root, ctx) {
  const col = ctx.key, K = KINDS[col];
  let items = [], openId = null, ed = null, dirty = false, current = null;

  const search = h('input', { type: 'search', placeholder: K.title + ' 검색' });
  const list = h('div', { class: 'list' });
  const pane = h('section', { class: 'editor-pane' });
  const split = h('div', { class: 'split' },
    h('aside', { class: 'list-pane' },
      h('div', { class: 'list-tools' },
        h('div', { class: 'row' }, h('strong', { class: 'grow', style: { fontSize: '17px' } }, K.title),
          h('button', { class: 'btn small primary', onclick: create }, '+ ' + K.newLabel)),
        search),
      list),
    pane);
  root.append(split);

  async function load() {
    items = (await db.all(col)).sort((a, b) => col === 'notes'
      ? (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt
      : (a.title || '').localeCompare(b.title || '', 'ko'));
  }
  function drawList() {
    const q = search.value.trim().toLowerCase();
    const shown = items.filter(i => !q || (i.title || '').toLowerCase().includes(q) || plain(i.body).toLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown.map(i => h('button', { class: 'list-item', 'aria-selected': String(i.id === openId), onclick: () => ctx.go(col, i.id) },
      col === 'notes' ? h('div', { class: 'd' }, i.date || '') : null,
      h('div', { class: 't' }, i.title || '제목 없음'),
      h('div', { class: 's' }, plain(i.body).slice(0, 70) || ' '))) : [h('div', { class: 'list-empty' }, q ? '검색 결과가 없습니다.' : K.empty)]));
  }

  async function create() {
    const id = uid();
    const data = { title: '', body: '', createdAt: Date.now() };
    if (col === 'notes') data.date = today();   // 업무메모: the day it was written is recorded automatically
    await db.put(col, id, data);
    ctx.go(col, id);
  }

  const state = h('span', { class: 'save-state' });
  const saveNow = async () => {
    if (!dirty || !current) return;
    dirty = false;
    current.body = ed.get();
    await db.put(col, openId, strip(current));
    state.textContent = '저장됨';
  };
  const save = debounce(saveNow, 700);
  const strip = o => { const { id, updatedAt, ...rest } = o; return rest; };
  const touch = () => { dirty = true; state.textContent = '저장 중…'; save(); };

  async function open(id) {
    if (ed) save.flush();
    openId = id;
    split.classList.toggle('has-open', !!id);
    if (!id) { pane.replaceChildren(h('div', { class: 'pad empty' }, h('b', null, K.title), '왼쪽 목록에서 고르거나 새로 만드세요.')); drawList(); return; }
    const data = await db.get(col, id);
    if (!data) { pane.replaceChildren(h('div', { class: 'pad empty' }, h('b', null, '찾을 수 없습니다'), '삭제되었거나 아직 동기화되지 않았습니다.')); drawList(); return; }
    current = { ...data };
    // 업무메모 made while it was a diagram-only page: put that diagram into the text as an editable picture.
    let upgraded = false;
    if (data.flow && data.flow.nodes && data.flow.nodes.length) {
      try {
        const { renderFlow } = await import('../flowedit.js');
        const r = await renderFlow(data.flow);
        data.body = `<p><img class="flow" src="${r.dataUrl}" data-flow="${encodeURIComponent(JSON.stringify(data.flow))}" width="${Math.min(r.width, 900)}" alt="프로세스"></p>` + (data.body || '');
        upgraded = true;
      } catch (e) { console.warn(e); }
    }
    delete current.flow;
    const title = h('input', { class: 'doc-title', value: data.title || '', placeholder: '제목', 'aria-label': '제목',
      oninput: e => { current.title = e.target.value; touch(); } });
    const extra = col === 'aimd' ? [{ label: '본문 복사', title: '본문을 복사해서 AI에 붙여 넣기', run: () => copyText(plainWithBreaks(ed.get()), '본문을 복사했습니다') }] : [];
    ed = richEditor({ value: data.body, placeholder: K.placeholder, onChange: touch, extraTools: extra });
    const meta = h('div', { class: 'doc-meta' },
      h('button', { class: 'btn small ghost back-btn', onclick: () => ctx.go(col) }, '‹ 목록'),
      col === 'notes' ? h('label', { class: 'row', style: { gap: '6px' } }, '작성일',
        h('input', { type: 'date', value: data.date || today(), onchange: e => { if (e.target.value) { current.date = e.target.value; touch(); save.flush(); } } })) : null,
      state, h('span', { class: 'grow' }),
      h('button', { class: 'btn small ghost danger', onclick: async () => {
        if (!await confirmBox(`‘${current.title || '제목 없음'}’을(를) 삭제할까요?`, '삭제', true)) return;
        save.cancel(); dirty = false;
        await db.remove(col, id); toast('삭제했습니다'); ctx.go(col);
      } }, '삭제'));
    pane.replaceChildren(h('div', { class: 'doc-head' }, meta, title), ed.toolbar, h('div', { class: 'doc-wrap' }, h('div', { class: 'doc-body' }, ed.body), ed.toc));
    if (!data.title) title.focus();
    if (upgraded) { touch(); save.flush(); }
    drawList();
  }

  search.addEventListener('input', drawList);
  const onChange = async ev => {
    if (ev.detail.col !== col) return;
    await load(); drawList();
    if (ev.detail.id === openId && !dirty && ed && document.activeElement !== ed.body) {
      const d = await db.get(col, openId);
      if (d) { current = { ...d }; ed.set(d.body); }
    }
  };
  db.events.addEventListener('change', onChange);
  window.addEventListener('pagehide', save.flush);

  await load();
  await open(ctx.param);
  return { open, cleanup: () => { save.flush(); db.events.removeEventListener('change', onChange); window.removeEventListener('pagehide', save.flush); } };
}

function plainWithBreaks(html) {
  const div = document.createElement('div');
  div.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h2|h3|li)>/gi, '\n');
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}
