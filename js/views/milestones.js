import { h, uid, today, parseYmd, dialog, confirmBox, toast } from '../util.js';
import * as db from '../db.js';

const STAGES = [{ key: 'todo', label: '예정' }, { key: 'doing', label: '진행 중' }, { key: 'done', label: '완료' }];

export async function mount(root) {
  const board = h('div', { class: 'stages' });
  root.append(h('div', { class: 'view-head' }, h('h1', null, '마일스톤'), h('button', { class: 'btn small primary', onclick: () => edit(null) }, '+ 마일스톤 추가')),
    h('div', { class: 'pad' }, board));

  const draw = async () => {
    const items = (await db.all('milestones')).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    board.replaceChildren(...STAGES.map(s => {
      const mine = items.filter(i => (i.stage || 'todo') === s.key);
      return h('div', { class: 'stage' },
        h('h3', null, s.label, h('span', null, mine.length)),
        mine.length ? mine.map(card) : h('p', { class: 'muted', style: { fontSize: '14px' } }, s.key === 'todo' ? '예정된 마일스톤이 없습니다.' : '없음'));
    }));
  };
  const card = m => {
    const late = m.due && m.due < today() && m.stage !== 'done';
    const left = m.due ? Math.round((parseYmd(m.due) - parseYmd(today())) / 86400000) : null;
    const idx = STAGES.findIndex(s => s.key === (m.stage || 'todo'));
    return h('div', { class: 'ms', tabindex: '0', onclick: e => { if (!e.target.closest('button')) edit(m); }, onkeydown: e => { if (e.key === 'Enter') edit(m); } },
      h('div', { class: 't' }, m.title),
      m.due ? h('div', { class: 'due' + (late ? ' late' : '') }, m.due + (m.stage === 'done' ? '' : late ? ` · ${-left}일 지남` : left === 0 ? ' · 오늘' : ` · ${left}일 남음`)) : null,
      m.memo ? h('div', { class: 'muted', style: { fontSize: '13.5px', marginTop: '4px' } }, m.memo.slice(0, 90)) : null,
      h('div', { class: 'row', style: { marginTop: '6px' } },
        idx > 0 ? h('button', { class: 'btn small ghost', onclick: () => move(m, STAGES[idx - 1].key) }, '‹ ' + STAGES[idx - 1].label) : null,
        idx < 2 ? h('button', { class: 'btn small ghost', onclick: () => move(m, STAGES[idx + 1].key) }, STAGES[idx + 1].label + ' ›') : null));
  };
  const move = async (m, stage) => { const { id, updatedAt, ...d } = m; await db.put('milestones', id, { ...d, stage }); };

  async function edit(m) {
    const title = h('input', { type: 'text', value: m ? m.title : '' });
    const due = h('input', { type: 'date', value: m ? m.due || '' : '' });
    const stage = h('select', null, STAGES.map(s => h('option', { value: s.key, selected: (m ? m.stage : 'todo') === s.key }, s.label)));
    const memo = h('textarea', { rows: 4 }, m ? m.memo || '' : '');
    const err = h('p', { class: 'error' });
    const r = await dialog({
      title: m ? '마일스톤 수정' : '마일스톤 추가',
      body: [h('label', { class: 'field' }, '제목', title), h('div', { class: 'grid2' }, h('label', { class: 'field' }, '기한', due), h('label', { class: 'field' }, '진행 단계', stage)), h('label', { class: 'field' }, '메모', memo), err],
      onOpen: () => title.focus(),
      actions: [
        m ? { label: '삭제', kind: 'danger', run: async close => { if (await confirmBox('이 마일스톤을 삭제할까요?', '삭제', true)) { await db.remove('milestones', m.id); close('x'); } return false; } } : null,
        { label: '취소' },
        { label: '저장', kind: 'primary', value: 'ok', run: async () => {
          if (!title.value.trim()) { err.textContent = '제목을 입력해 주세요.'; return false; }
          await db.put('milestones', m ? m.id : uid(), { title: title.value.trim(), due: due.value, stage: stage.value, memo: memo.value.trim() });
        } }
      ].filter(Boolean)
    });
    if (r === 'ok') toast('저장했습니다');
  }

  const onChange = e => { if (e.detail.col === 'milestones') draw(); };
  db.events.addEventListener('change', onChange);
  await draw();
  return { cleanup: () => db.events.removeEventListener('change', onChange) };
}
