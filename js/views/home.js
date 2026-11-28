// 폰 홈: 큼지막한 타일. 폰 메뉴(설정 › 폰 메뉴)에서 고른 메뉴만, 고른 순서대로.
import { h, icon, today, won, dialog, WEEK } from '../util.js';
import * as db from '../db.js';
import { TABS, prefs, prefsEvents } from '../prefs.js';
import { phoneMenuEditor } from './phonemenu.js';

const SUB = {
  schedule: async () => { const { upcoming } = await import('./schedule.js'); const n = (await upcoming(0)).filter(o => o.on === today()).length; return n ? `오늘 일정 ${n}건` : '오늘 일정 없음'; },
  ledger: async () => { const { monthSummary } = await import('./ledger.js'); const s = await monthSummary(today().slice(0, 7)); return `이번 달 지출 ${won(s.expense)}`; },
  journal: async () => (await db.get('journal', today())) ? '오늘 일지 씀' : '오늘 일지 쓰기',
  aide: async () => '무엇이든 물어보기',
  meetings: async () => '녹음·회의록',
  notes: async () => { const n = (await db.all('notes')).length; return n ? `메모 ${n}개` : '메모 쓰기'; },
  media: async () => '사진·동영상 보기',
  mindmap: async () => '생각 정리'
};

export async function mount(root, ctx) {
  const d = new Date();
  const grid = h('div', { class: 'ph-grid' });
  const camIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    window.__pendingReceipt = f; ctx.go('ledger');
  } });
  const draw = () => {
    const keys = (prefs().phoneTabs || []).filter(k => TABS.some(t => t.key === k));
    grid.replaceChildren(
      keys.includes('ledger') ? h('button', { class: 'ph-tile ph-quick', onclick: () => { camIn.click(); import('../receipt.js').then(R => R.warm()).catch(() => {}); } },
        h('span', { class: 'ph-ico' }, icon('camera')), h('b', null, '영수증 찍기'), h('small', null, '찍으면 가계부에 바로')) : null,
      keys.includes('aide') ? h('button', { class: 'ph-tile ph-quick alt', onclick: () => ctx.go('aide') },
        h('span', { class: 'ph-ico' }, icon('aide')), h('b', null, 'AIDE에 묻기'), h('small', null, '내 기록에서 찾아 답함')) : null,
      ...keys.filter(k => k !== 'aide').map(k => { const t = TABS.find(x => x.key === k); const sub = h('small', null, '');
        SUB[k]?.().then(s => { sub.textContent = s; }).catch(() => {});
        return h('button', { class: 'ph-tile g-' + t.group, onclick: () => ctx.go(k) }, h('span', { class: 'ph-ico' }, icon(t.icon)), h('b', null, t.label), sub); }));
  };
  const edit = async () => {
    const ed = phoneMenuEditor(draw);
    await dialog({ title: '폰 메뉴 고르기', body: ed.el, actions: [{ label: '취소' }, { label: '저장', kind: 'primary', run: async () => (await ed.save()) ? true : false }] });
  };
  root.append(h('div', { class: 'ph' },
    h('div', { class: 'ph-head' }, h('div', null, h('div', { class: 'ph-date' }, `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일`), h('h1', null, 'MY AIDE')),
      h('button', { class: 'ph-edit', onclick: edit }, '메뉴 고르기')),
    grid, camIn));
  draw();
  const onPrefs = () => draw();
  prefsEvents.addEventListener('change', onPrefs);
  return { cleanup: () => prefsEvents.removeEventListener('change', onPrefs) };
}
