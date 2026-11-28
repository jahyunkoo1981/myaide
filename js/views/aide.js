import { h, today, won, toast, icon, shrinkImage, WEEK } from '../util.js';
import * as db from '../db.js';
import { chatTools } from '../openai.js';
import { TOOLS, runTool, describeCall } from '../recordtools.js';
import { krw, fmtTok, monthTotal, usageEvents } from '../usage.js';
import { newSession, trainRisk } from '../privacy.js';
import { currentAi } from '../openai.js';
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

export async function mount(root) {
  let history = await db.kvGet('aide.history', []);
  let maskSession = await db.kvGet('aide.mask', null) || newSession();   // 대화 내내 같은 단어 → 같은 표시
  const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  const input = h('textarea', { rows: 1, placeholder: '무엇이든 물어보세요', 'aria-label': '질문' });
  const useRecords = h('input', { type: 'checkbox', checked: true });
  const site = h('select', { style: { width: 'auto', minHeight: '32px' }, 'aria-label': '외부 AI', onchange: () => savePrefs({ aiSite: site.value }) }, AI_SITES.map(s => h('option', { value: s.key, selected: s.key === prefs().aiSite }, s.name)));
  const wrap = h('div', { class: 'chat aide-chat' });

  const fit = () => { input.style.height = 'auto'; input.style.height = Math.min(180, input.scrollHeight) + 'px'; };
  input.addEventListener('input', fit);
  const started = () => wrap.classList.toggle('started', log.children.length > 0);
  const add = (role, text, use, imgs, calls) => {
    log.append(h('div', { class: 'msg ' + (role === 'user' ? 'me' : 'ai') },
      imgs && imgs.length ? h('div', { class: 'msg-imgs' }, ...imgs.map(u => h('img', { src: u, alt: '첨부한 사진' }))) : null,
      text, calls && calls.length ? h('div', { class: 'msg-refs' }, '참고한 기록: ' + calls.join(' · ')) : null, use ? usageLine(use) : null));
    log.scrollTop = log.scrollHeight; started();
  };
  const usageLine = u => h('div', { class: 'msg-use', title: u.estimated ? '응답에 사용량이 없어 추정치로 기록했습니다' : '서비스가 알려 준 실제 사용 토큰입니다' },
    `${u.model} · 입력 ${fmtTok(u.inTok)} · 출력 ${fmtTok(u.outTok)} 토큰 · ${krw(u.usd)}${u.estimated ? ' (추정)' : ''}`,
    u.masked ? h('span', { class: 'priv-ok' }, ` · 가린 정보 ${u.masked}곳 복원됨`) : null,
    u.noRecords ? h('span', { class: 'priv-warn-t' }, ' · 학습 위험 연결이라 업무 기록은 보내지 않음') : null);
  const monthChip = h('button', { class: 'chip use-chip', title: '설정 › AI 사용량에서 자세히 봅니다', onclick: () => location.hash = '#settings' });
  const drawMonth = async () => { const t = await monthTotal(); monthChip.textContent = `이번 달 AI ${krw(t.usd)} · ${fmtTok(t.inTok + t.outTok)}토큰`; };
  usageEvents.addEventListener('call', () => setTimeout(drawMonth, 300)); drawMonth();
  const persist = () => db.kvSet('aide.history', history.slice(-40));

  // ---------- 사진·캡처 첨부 (붙여넣기 · 끌어다 놓기 · 버튼) ----------
  let attach = [];   // data URL
  const tray = h('div', { class: 'aide-tray', hidden: true });
  const drawTray = () => { tray.hidden = !attach.length; tray.replaceChildren(...attach.map((u, i) => h('span', { class: 'aide-thumb' }, h('img', { src: u, alt: '첨부 ' + (i + 1) }),
    h('button', { type: 'button', 'aria-label': '첨부 빼기', onclick: () => { attach.splice(i, 1); drawTray(); } }, '×')))); };
  async function addImages(files) {
    for (const f of files) {
      if (!f || !/^image\//.test(f.type)) continue;
      if (attach.length >= 5) { toast('사진은 한 번에 5장까지 보낼 수 있습니다.'); break; }
      try { attach.push(await shrinkImage(f, 1568, 0.85)); } catch { toast('사진을 읽지 못했습니다.', 'err'); }
    }
    drawTray(); input.focus();
  }
  const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: e => { addImages([...e.target.files]); e.target.value = ''; } });
  const clip = h('button', { class: 'btn ghost aide-clip', type: 'button', title: '사진·캡처 첨부 (Ctrl+V로 붙여넣기도 됩니다)', 'aria-label': '사진 첨부', onclick: () => fileIn.click() }, icon('clip'));
  input.addEventListener('paste', e => { const fs = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file' && /^image\//.test(i.type)).map(i => i.getAsFile()); if (fs.length) { e.preventDefault(); addImages(fs); } });
  wrap.addEventListener('dragover', e => { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) { e.preventDefault(); wrap.classList.add('drop'); } });
  wrap.addEventListener('dragleave', e => { if (e.target === wrap) wrap.classList.remove('drop'); });
  wrap.addEventListener('drop', e => { wrap.classList.remove('drop'); const fs = [...(e.dataTransfer?.files || [])].filter(f => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); addImages(fs); } });

  const SYS_TOOLS = () => `당신은 MY AIDE라는 개인 업무 비서입니다. 한국어로 간결하고 실무적으로 답하세요. 오늘은 ${today()} (${WEEK[new Date().getDay()]}요일)입니다.
사용자의 기록(업무일지·업무메모·지식노트·회의록·마인드맵·일정·가계부·사진 설명·VisualCode 파일·마일스톤)에 관한 질문이면 추측하지 말고 반드시 도구로 찾아 확인한 뒤 답하세요.
- 날짜·기간이 있는 일정 질문은 get_schedule, 돈은 ledger_summary, 그 밖에는 search_records로 찾고 필요하면 read_record로 원문을 읽으세요.
- 찾아봐도 없으면 없다고 말하고, 지어내지 마세요. 답할 때 근거가 된 기록의 날짜나 제목을 함께 알려 주세요.`;
  const SYS_PLAIN = () => `당신은 MY AIDE라는 개인 업무 비서입니다. 한국어로 간결하고 실무적으로 답하세요. 오늘은 ${today()}입니다.`;

  async function send(text) {
    text = text.trim();
    const imgs = attach.slice();
    if (!text && !imgs.length) return;
    if (!text) text = '이 사진을 보고 설명해 주세요.';
    input.value = ''; fit(); attach = []; drawTray();
    add('user', text, null, imgs); history.push({ role: 'user', content: text, imgs: imgs.length || undefined });
    const wait = h('div', { class: 'msg ai muted' }, '생각하는 중…'); log.append(wait); log.scrollTop = log.scrollHeight;
    try {
      // 학습에 쓰일 수 있는 연결(Gemini 무료 키 등)이면 업무 기록은 보내지 않음
      const risky = trainRisk(currentAi().provider) && prefs().aiBlockRecordsOnRisk !== false;
      const useTools = useRecords.checked && !risky;
      const past = history.slice(-12, -1).map(({ role, content, imgs: n }) => ({ role, content: n ? content + `\n(사진 ${n}장 첨부했었음)` : content }));
      const now = imgs.length ? [{ type: 'text', text }, ...imgs.map(u => ({ type: 'image_url', image_url: { url: u } }))] : text;
      let use = null, masked = 0, calls = [];
      const answer = await chatTools([{ role: 'system', content: useTools ? SYS_TOOLS() : SYS_PLAIN() }, ...past, { role: 'user', content: now }],
        useTools ? TOOLS : [], runTool,
        { kind: 'chat', maskSession, onUsage: u => use = u, onPrivacy: i => masked = i.total,
          onTool: (n, a) => { wait.textContent = '기록 찾는 중… ' + describeCall(n, a); },
          onCalls: c => calls = c.map(x => describeCall(x.name, x.args)) });
      db.kvSet('aide.mask', maskSession);
      if (use) use = { ...use, masked, noRecords: risky && useRecords.checked };
      wait.remove(); add('assistant', answer, use, null, calls); history.push({ role: 'assistant', content: answer, use, calls: calls.length ? calls : undefined }); persist();
    } catch (e) {
      wait.remove(); history.pop();
      if (e.cancelled) { log.lastElementChild?.remove(); started(); input.value = text; attach = imgs; drawTray(); fit(); input.focus(); toast(e.message); }
      else add('assistant', e.message);
    }
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
    h('p', { class: 'sub' }, 'MY AIDE의 모든 기록(일지·메모·일정·회의록·가계부 등)을 찾아보고 답합니다. 사진·캡처는 Ctrl+V로 붙여 넣거나 끌어다 놓으세요.'),
    tray,
    h('div', { class: 'hero-box' }, icon('aide'), input, clip, fileIn, h('button', { class: 'btn primary', onclick: () => send(input.value) }, '보내기')),
    h('div', { class: 'opts' },
      h('label', { class: 'check', style: { fontSize: '13.5px', color: 'var(--ink-2)' }, title: '켜면 AI가 답하는 동안 MY AIDE 기록을 찾아 읽습니다' }, useRecords, '내 기록 찾아보기'),
      h('span', { class: 'muted' }, '·'),
      site, h('button', { class: 'btn small', onclick: openOutside, title: '입력한 질문을 그 사이트에서 엽니다 (MY AIDE가 쓰는 AI와는 별개)' }, '에서 묻기'),
      monthChip,
      h('button', { class: 'btn small ghost', onclick: async () => { history = []; maskSession = newSession(); db.kvSet('aide.mask', maskSession); await persist(); log.replaceChildren(); started(); input.focus(); } }, '대화 지우기')),
    quick);

  wrap.append(h('div', { class: 'view-head' }, h('h1', null, 'AIDE')), log, hero);
  root.append(wrap);
  history.forEach(m => add(m.role, m.content + (m.imgs ? `\n(사진 ${m.imgs}장)` : ''), m.use, null, m.calls));
  started();
  setTimeout(() => input.focus(), 0);
  return { open: () => input.focus() };
}
