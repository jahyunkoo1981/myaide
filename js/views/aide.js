import { h, today, won, plain, ymd, toast, icon } from '../util.js';
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
  { label: '최근 마인드맵', run: async () => {
    const maps = (await db.all('mindmaps')).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
    return maps.length ? '최근 마인드맵:\n' + maps.map(m => `• ${m.title || '제목 없음'} (${(m.root && m.root.children || []).map(c => c.text).slice(0, 4).join(', ')})`).join('\n') : '아직 마인드맵이 없습니다.';
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
  return `오늘은 ${today()}입니다.\n\n# 최근 2주 업무일지\n${journal || '없음'}\n\n# 최근 업무메모\n${notes || '없음'}\n\n# 앞으로 2주 일정\n${sched || '없음'}`;
}

export async function mount(root) {
  let history = await db.kvGet('aide.history', []);
  const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  const input = h('textarea', { rows: 1, placeholder: '무엇이든 물어보세요', 'aria-label': '질문' });
  const useRecords = h('input', { type: 'checkbox', checked: true });
  const site = h('select', { style: { width: 'auto', minHeight: '32px' }, 'aria-label': '외부 AI', onchange: () => savePrefs({ aiSite: site.value }) }, AI_SITES.map(s => h('option', { value: s.key, selected: s.key === prefs().aiSite }, s.name)));
  const wrap = h('div', { class: 'chat aide-chat' });

  const fit = () => { input.style.height = 'auto'; input.style.height = Math.min(180, input.scrollHeight) + 'px'; };
  input.addEventListener('input', fit);
  const started = () => wrap.classList.toggle('started', log.children.length > 0);
  const add = (role, text) => {
    log.append(h('div', { class: 'msg ' + (role === 'user' ? 'me' : 'ai') }, text));
    log.scrollTop = log.scrollHeight; started();
  };
  const persist = () => db.kvSet('aide.history', history.slice(-40));

  async function send(text) {
    text = text.trim(); if (!text) return;
    input.value = ''; fit();
    add('user', text); history.push({ role: 'user', content: text });
    const wait = h('div', { class: 'msg ai muted' }, '생각하는 중…'); log.append(wait); log.scrollTop = log.scrollHeight;
    try {
      const sys = '당신은 MY AIDE라는 개인 업무 비서입니다. 한국어로 간결하고 실무적으로 답하세요.' + (useRecords.checked ? '\n\n아래는 사용자의 업무 기록입니다. 질문과 관련될 때만 참고하고, 기록에 없는 사실을 지어내지 마세요.\n\n' + await recordsContext() : '');
      const answer = await chat([{ role: 'system', content: sys }, ...history.slice(-12)]);
      wait.remove(); add('assistant', answer); history.push({ role: 'assistant', content: answer }); persist();
    } catch (e) { wait.remove(); add('assistant', e.message); history.pop(); }
  }
  // Same question in ChatGPT / Claude (they accept ?q=); Gemini has no such link, so the text is copied first.
  function openOutside() {
    const q = input.value.trim(), s = aiSite(site.value);
    let url = s.url;
    if (q && s.key === 'chatgpt') url = 'https://chatgpt.com/?q=' + encodeURIComponent(q);
    else if (q && s.key === 'claude') url = 'https://claude.ai/new?q=' + encodeURIComponent(q);
    else if (q) { navigator.clipboard?.writeText(q).catch(() => {}); toast('질문을 복사했습니다. 열린 창에 붙여 넣으세요'); }
    window.open(url, '_blank', 'noopener');
  }

  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); } });
  const quick = h('div', { class: 'chips', style: { justifyContent: 'center' } }, QUICK.map(q => h('button', { class: 'chip', onclick: async () => { add('user', q.label); add('assistant', await q.run()); } }, q.label)));
  const hero = h('div', { class: 'hero-search' },
    h('h2', null, '무엇을 도와드릴까요?'),
    h('p', { class: 'sub' }, '내 업무일지·메모·일정을 참고해서 답합니다. Enter로 보내고 Shift+Enter로 줄을 바꿉니다.'),
    h('div', { class: 'hero-box' }, icon('aide'), input, h('button', { class: 'btn primary', onclick: () => send(input.value) }, '보내기')),
    h('div', { class: 'opts' },
      h('label', { class: 'check', style: { fontSize: '13.5px', color: 'var(--ink-2)' } }, useRecords, '내 업무 기록 참고'),
      h('span', { class: 'muted' }, '·'),
      site, h('button', { class: 'btn small', onclick: openOutside, title: '입력한 질문을 그 사이트에서 엽니다' }, '에서 묻기'),
      h('button', { class: 'btn small ghost', onclick: async () => { history = []; await persist(); log.replaceChildren(); started(); input.focus(); } }, '대화 지우기')),
    quick);

  wrap.append(h('div', { class: 'view-head' }, h('h1', null, 'AIDE')), log, hero);
  root.append(wrap);
  history.forEach(m => add(m.role, m.content));
  started();
  setTimeout(() => input.focus(), 0);
  return { open: () => input.focus() };
}
