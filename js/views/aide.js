import { h, today, won, plain, ymd, toast } from '../util.js';
import * as db from '../db.js';
import { chat } from '../openai.js';
import { prefs, save as savePrefs, AI_SITES, aiSite } from '../prefs.js';
import { monthSummary } from './ledger.js';
import { upcoming } from './schedule.js';

const QUICK = [
  { label: '이번 달 지출', run: async () => { const s = await monthSummary(today().slice(0, 7)); return `이번 달 지출은 ${won(s.expense)}입니다.` + topCats(s); } },
  { label: '지난달과 지출 비교', run: async () => {
    const s = await monthSummary(today().slice(0, 7)); const d = s.expense - s.prevExpense;
    return `이번 달 ${won(s.expense)}, 지난달 ${won(s.prevExpense)}입니다. ` + (d === 0 ? '같습니다.' : `${won(Math.abs(d))} ${d > 0 ? '더 썼습니다' : '덜 썼습니다'}.`);
  } },
  { label: '오늘 일정', run: async () => {
    const list = (await upcoming(0)).filter(o => o.on === today());
    return list.length ? '오늘 일정:\n' + list.map(o => `• ${o.time ? o.time + ' ' : ''}${o.title}`).join('\n') : '오늘 잡힌 일정이 없습니다.';
  } },
  { label: '이번 주 일정', run: async () => {
    const list = await upcoming(7);
    return list.length ? '앞으로 7일:\n' + list.map(o => `• ${o.on.slice(5)} ${o.time ? o.time + ' ' : ''}${o.title}`).join('\n') : '7일 안에 잡힌 일정이 없습니다.';
  } },
  { label: '기한 다가온 마일스톤', run: async () => {
    const end = new Date(); end.setDate(end.getDate() + 14);
    const ms = (await db.all('milestones')).filter(m => m.stage !== 'done' && m.due && m.due <= ymd(end)).sort((a, b) => a.due.localeCompare(b.due));
    return ms.length ? '2주 안에 기한인 마일스톤:\n' + ms.map(m => `• ${m.due} ${m.title}${m.due < today() ? ' (지남)' : ''}`).join('\n') : '2주 안에 기한인 마일스톤이 없습니다.';
  } }
];
const topCats = s => { const t = [...s.cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3); return t.length ? '\n많이 쓴 항목: ' + t.map(([c, v]) => `${c} ${won(v)}`).join(', ') : ''; };

async function recordsContext() {
  const since = new Date(); since.setDate(since.getDate() - 14);
  const journal = (await db.all('journal')).filter(j => j.id >= ymd(since)).sort((a, b) => a.id.localeCompare(b.id))
    .map(j => `[${j.id}] ${plain(j.body).slice(0, 800)}`).join('\n');
  const notes = (await db.all('notes')).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 15)
    .map(n => `- (${n.date}) ${n.title}: ${plain(n.body).slice(0, 300)}`).join('\n');
  const sched = (await upcoming(14)).map(o => `- ${o.on} ${o.time || ''} ${o.title}`).join('\n');
  const ms = (await db.all('milestones')).filter(m => m.stage !== 'done').map(m => `- ${m.title} (기한 ${m.due || '없음'})`).join('\n');
  return `오늘은 ${today()}입니다.\n\n# 최근 2주 업무일지\n${journal || '없음'}\n\n# 최근 업무메모\n${notes || '없음'}\n\n# 앞으로 2주 일정\n${sched || '없음'}\n\n# 진행 중 마일스톤\n${ms || '없음'}`;
}

export async function mount(root) {
  let history = await db.kvGet('aide.history', []);
  const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  const input = h('textarea', { rows: 2, placeholder: '무엇이든 물어보세요. Enter로 보내고, Shift+Enter로 줄을 바꿉니다.' });
  const useRecords = h('input', { type: 'checkbox', checked: true });
  const site = h('select', { style: { width: 'auto' }, onchange: () => savePrefs({ aiSite: site.value }) }, AI_SITES.map(s => h('option', { value: s.key, selected: s.key === prefs().aiSite }, s.name)));

  const add = (role, text) => {
    log.append(h('div', { class: 'msg ' + (role === 'user' ? 'me' : 'ai') }, text));
    log.scrollTop = log.scrollHeight;
  };
  const persist = () => db.kvSet('aide.history', history.slice(-40));

  async function send(text) {
    text = text.trim(); if (!text) return;
    input.value = '';
    add('user', text); history.push({ role: 'user', content: text });
    const wait = h('div', { class: 'msg ai muted' }, '생각하는 중…'); log.append(wait); log.scrollTop = log.scrollHeight;
    try {
      const sys = '당신은 MY AIDE라는 개인 업무 비서입니다. 한국어로 간결하고 실무적으로 답하세요.' + (useRecords.checked ? '\n\n아래는 사용자의 업무 기록입니다. 질문과 관련될 때만 참고하고, 기록에 없는 사실을 지어내지 마세요.\n\n' + await recordsContext() : '');
      const answer = await chat([{ role: 'system', content: sys }, ...history.slice(-12)]);
      wait.remove(); add('assistant', answer); history.push({ role: 'assistant', content: answer }); persist();
    } catch (e) { wait.remove(); add('assistant', e.message); history.pop(); }
  }

  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); } });
  const quick = h('div', { class: 'chips' }, QUICK.map(q => h('button', { class: 'chip', onclick: async () => { add('user', q.label); add('assistant', await q.run()); } }, q.label)));

  root.append(h('div', { class: 'chat' },
    h('div', { class: 'view-head' }, h('h1', null, 'AIDE'),
      h('label', { class: 'row', style: { gap: '6px' } }, site, h('button', { class: 'btn small', onclick: () => window.open(aiSite(site.value).url, '_blank', 'noopener') }, '열기')),
      h('button', { class: 'btn small ghost', onclick: async () => { history = []; await persist(); log.replaceChildren(intro()); } }, '대화 지우기')),
    log,
    h('div', { class: 'chat-input' }, quick, input,
      h('div', { class: 'row' }, h('label', { class: 'check' }, useRecords, '내 업무 기록 참고 (최근 2주 일지·메모·일정)'), h('span', { class: 'grow' }),
        h('button', { class: 'btn primary', onclick: () => send(input.value) }, '보내기')))));

  const intro = () => h('div', { class: 'msg ai' }, '빠른 질문은 기록에서 바로 답합니다. 자유 질문은 OpenAI API 키가 있어야 합니다(설정 › AI 연결).');
  log.append(intro());
  history.forEach(m => add(m.role, m.content));
  input.focus();
}
