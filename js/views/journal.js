import { h, today, parseYmd, ymd, WEEK, plain, debounce, pad2 } from '../util.js';
import * as db from '../db.js';
import { richEditor } from '../editor.js';

export async function mount(root, ctx) {
  let date = ctx.param || today();
  let month = parseYmd(date); month.setDate(1);
  let entries = new Map();
  let ed = null, dirty = false;

  const cal = h('div', { class: 'mini-cal' });
  const search = h('input', { type: 'search', placeholder: '일지 검색' });
  const list = h('div', { class: 'list' });
  const editorPane = h('section', { class: 'editor-pane' });
  const split = h('div', { class: 'split has-open' },
    h('aside', { class: 'list-pane' }, cal, h('div', { class: 'list-tools' }, search), list), editorPane);
  root.append(split);

  const loadEntries = async () => {
    entries = new Map((await db.all('journal')).map(e => [e.id, e]));
  };

  const drawCal = () => {
    const y = month.getFullYear(), m = month.getMonth();
    const start = new Date(y, m, 1 - new Date(y, m, 1).getDay());
    const rows = [];
    const weeks = Math.ceil((new Date(y, m, 1).getDay() + new Date(y, m + 1, 0).getDate()) / 7);
    for (let w = 0; w < weeks; w++) {
      const cells = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
        const k = ymd(day);
        const e = entries.get(k);
        cells.push(h('td', { class: day.getMonth() !== m ? 'out' : '' }, h('button', {
          type: 'button', class: [e && plain(e.body) ? 'has' : '', k === today() ? 'today' : '', k === date ? 'sel' : ''].join(' '),
          'aria-label': k, onclick: () => ctx.go('journal', k)
        }, day.getDate())));
      }
      rows.push(h('tr', null, cells));
    }
    cal.replaceChildren(
      h('div', { class: 'mh' },
        h('button', { class: 'btn small ghost', onclick: () => { month.setMonth(m - 1); drawCal(); }, 'aria-label': '이전 달' }, '‹'),
        `${y}년 ${m + 1}월`,
        h('button', { class: 'btn small ghost', onclick: () => { month.setMonth(m + 1); drawCal(); }, 'aria-label': '다음 달' }, '›')),
      h('table', null, h('thead', null, h('tr', null, WEEK.map(w => h('th', null, w)))), h('tbody', null, rows)),
      h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn small', onclick: () => ctx.go('journal', today()) }, '오늘')));
  };

  const drawList = () => {
    const q = search.value.trim().toLowerCase();
    const items = [...entries.values()].filter(e => plain(e.body)).filter(e => !q || plain(e.body).toLowerCase().includes(q))
      .sort((a, b) => b.id.localeCompare(a.id)).slice(0, q ? 200 : 60);
    list.replaceChildren(...(items.length ? items.map(e => {
      const d = parseYmd(e.id);
      return h('button', { class: 'list-item', 'aria-selected': String(e.id === date), onclick: () => ctx.go('journal', e.id) },
        h('div', { class: 'd' }, `${e.id} (${WEEK[d.getDay()]})`),
        h('div', { class: 's' }, plain(e.body).slice(0, 80)));
    }) : [h('div', { class: 'list-empty' }, q ? '검색 결과가 없습니다.' : '아직 쓴 일지가 없습니다. 오늘 한 일을 적어 보세요.')]));
  };

  const saveNow = async () => {
    if (!dirty || !ed) return;
    dirty = false;
    const body = ed.get();
    if (!plain(body) && !body.includes('<img')) { if (entries.has(date)) await db.remove('journal', date); }
    else await db.put('journal', date, { date, body });
    state.textContent = '저장됨';
  };
  const save = debounce(saveNow, 700);
  const state = h('span', { class: 'save-state' });

  const openDate = async d => {
    if (ed) save.flush();
    split.classList.add('has-open');
    date = d;
    const dd = parseYmd(d);
    if (dd.getMonth() !== month.getMonth() || dd.getFullYear() !== month.getFullYear()) { month = new Date(dd); month.setDate(1); }
    const e = await db.get('journal', d);
    ed = richEditor({ value: e ? e.body : '', placeholder: '오늘 한 일, 이슈, 내일 할 일을 적어 보세요.', onChange: () => { dirty = true; state.textContent = '저장 중…'; save(); } });
    const isToday = d === today();
    editorPane.replaceChildren(
      h('div', { class: 'stamp' },
        h('span', { class: 'day' }, pad2(dd.getDate())),
        h('span', { class: 'rest' },
          h('span', { class: 'ym' }, `${dd.getFullYear()}년 ${dd.getMonth() + 1}월`),
          h('span', { class: 'wd' }, WEEK[dd.getDay()] + '요일', isToday ? h('span', { class: 'today' }, '오늘') : null)),
        h('span', { class: 'stamp-nav' },
          h('button', { class: 'btn small ghost back-btn', onclick: () => split.classList.remove('has-open') }, '‹ 날짜 목록'),
          h('span', { class: 'grow' }), state,
          h('button', { class: 'btn small ghost', onclick: () => { const p = new Date(dd); p.setDate(p.getDate() - 1); ctx.go('journal', ymd(p)); }, 'aria-label': '전날' }, '‹ 전날'),
          h('button', { class: 'btn small ghost', onclick: () => { const p = new Date(dd); p.setDate(p.getDate() + 1); ctx.go('journal', ymd(p)); }, 'aria-label': '다음날' }, '다음날 ›'))),
      h('div', { style: { height: '12px' } }),
      ed.toolbar, h('div', { class: 'doc-body' }, ed.body));
    state.textContent = e ? '' : '새 일지';
    drawCal(); drawList();
  };

  search.addEventListener('input', drawList);
  const onChange = async ev => {
    if (ev.detail.col !== 'journal') return;
    await loadEntries(); drawCal(); drawList();
    if (ev.detail.id === date && ed && document.activeElement !== ed.body && !dirty) {
      const e = await db.get('journal', date);
      ed.set(e ? e.body : '');
    }
  };
  db.events.addEventListener('change', onChange);
  const onHide = () => save.flush();
  window.addEventListener('pagehide', onHide);

  await loadEntries();
  await openDate(date);
  return {
    open: p => openDate(p || today()),
    cleanup: () => { save.flush(); db.events.removeEventListener('change', onChange); window.removeEventListener('pagehide', onHide); }
  };
}
