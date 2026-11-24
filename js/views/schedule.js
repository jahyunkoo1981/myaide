import { h, uid, today, parseYmd, ymd, WEEK, pad2, dialog, confirmBox, toast, download } from '../util.js';
import * as db from '../db.js';
import { lunarToSolar, solarToLunar } from '../lunar.js';
import { native } from '../native.js';

export const TYPES = [
  { key: 'meeting', label: '업무회의', color: '#3346C8' },
  { key: 'anniv', label: '기념일', color: '#C8930A' },
  { key: 'birthday', label: '생일', color: '#C2477B' },
  { key: 'approval', label: '결재예정', color: '#1F7A4D' },
  { key: 'other', label: '기타', color: '#7C8C91' }
];
const typeLabel = k => (TYPES.find(t => t.key === k) || TYPES[4]).label;

// Expand events into concrete solar dates between from..to (inclusive, 'YYYY-MM-DD').
export function occurrences(events, from, to) {
  const out = [];
  const y0 = Number(from.slice(0, 4)) - 1, y1 = Number(to.slice(0, 4)) + 1;
  for (const e of events) {
    if (!e.date) continue;
    const [ey, em, ed] = e.date.split('-').map(Number);
    const years = e.yearly ? range(Math.max(y0, ey), y1) : [ey];
    for (const y of years) {
      let s;
      if (e.calendar === 'lunar') s = lunarToSolar(y, em, ed, e.leap && y === ey);
      else {
        const last = new Date(y, em, 0).getDate();
        s = `${y}-${pad2(em)}-${pad2(Math.min(ed, last))}`;
      }
      if (s && s >= from && s <= to) out.push({ ...e, on: s });
    }
  }
  return out.sort((a, b) => (a.on + (a.time || '')).localeCompare(b.on + (b.time || '')));
}
const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };

export async function upcoming(days = 30) {
  const events = await db.all('schedule');
  const from = today(), end = new Date(); end.setDate(end.getDate() + days);
  return occurrences(events, from, ymd(end));
}

export async function mount(root, ctx) {
  let month = new Date(); month.setDate(1);
  let events = [];
  const head = h('div', { class: 'view-head' });
  const grid = h('div', { class: 'cal', role: 'grid' });
  const side = h('div');
  root.append(head, h('div', { class: 'pad', style: { maxWidth: '1300px' } }, grid, side));

  const load = async () => { events = await db.all('schedule'); };

  const draw = () => {
    const y = month.getFullYear(), m = month.getMonth();
    head.replaceChildren(
      h('h1', null, `${y}년 ${m + 1}월`),
      h('button', { class: 'btn small ghost', 'aria-label': '이전 달', onclick: () => { month.setMonth(m - 1); draw(); } }, '‹'),
      h('button', { class: 'btn small', onclick: () => { month = new Date(); month.setDate(1); draw(); } }, '이번 달'),
      h('button', { class: 'btn small ghost', 'aria-label': '다음 달', onclick: () => { month.setMonth(m + 1); draw(); } }, '›'),
      h('button', { class: 'btn small', onclick: importIcs }, '가져오기'),
      h('button', { class: 'btn small', onclick: exportIcs }, '내보내기'),
      h('button', { class: 'btn small primary', onclick: () => edit(null, today()) }, '+ 일정 추가'));
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const weeks = Math.ceil((first.getDay() + new Date(y, m + 1, 0).getDate()) / 7);
    const end = new Date(start); end.setDate(start.getDate() + weeks * 7 - 1);
    const occ = occurrences(events, ymd(start), ymd(end));
    const byDay = new Map();
    occ.forEach(o => { if (!byDay.has(o.on)) byDay.set(o.on, []); byDay.get(o.on).push(o); });
    grid.replaceChildren(...WEEK.map((w, i) => h('div', { class: 'wh' + (i === 0 ? ' sun' : '') }, w)));
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const k = ymd(d), l = solarToLunar(k);
      const evs = byDay.get(k) || [];
      grid.append(h('div', {
        class: 'cell' + (d.getMonth() !== m ? ' out' : '') + (k === today() ? ' today' : '') + (d.getDay() === 0 ? ' sun' : ''),
        role: 'gridcell', tabindex: '0', 'aria-label': k + (evs.length ? `, 일정 ${evs.length}개` : ''),
        onclick: e => { if (!e.target.closest('.ev')) edit(null, k); },
        onkeydown: e => { if (e.key === 'Enter') edit(null, k); }
      },
        h('div', { class: 'num' }, h('span', null, d.getDate()), l ? h('span', { class: 'lunar' }, l.d === 1 || l.d === 15 ? `음 ${l.m}.${l.d}` : '') : null),
        evs.slice(0, 4).map(o => h('div', { class: 'ev ' + (o.type || 'other'), title: o.title, onclick: () => edit(o, o.on) },
          (o.time ? o.time + ' ' : '') + o.title)),
        evs.length > 4 ? h('div', { class: 'muted', style: { fontSize: '12px' } }, `+${evs.length - 4}`) : null));
    }
    drawSide();
  };

  const drawSide = async () => {
    const list = await upcoming(30);
    const reminders = list.filter(o => o.remind != null && o.remind !== '' && daysUntil(o.on) <= Number(o.remind));
    side.replaceChildren(...[
      h('div', { class: 'legend', style: { margin: '12px 0 24px' } }, TYPES.map(t => h('span', null, h('i', { style: { background: t.color } }), t.label))),
      reminders.length ? h('section', { class: 'block' }, h('h2', null, '알림'),
        h('table', { class: 'data' }, h('tbody', null, reminders.map(o => h('tr', { class: 'clickable', onclick: () => edit(o, o.on) },
          h('td', { style: { width: '120px' } }, dday(o.on)), h('td', null, o.title), h('td', { class: 'muted' }, typeLabel(o.type))))))) : null,
      h('section', { class: 'block' }, h('h2', null, '앞으로 30일'),
        list.length ? h('table', { class: 'data' }, h('tbody', null, list.map(o => h('tr', { class: 'clickable', onclick: () => edit(o, o.on) },
          h('td', { style: { width: '150px' } }, `${o.on} (${WEEK[parseYmd(o.on).getDay()]})`),
          h('td', null, (o.time ? o.time + ' ' : '') + o.title, o.calendar === 'lunar' ? h('span', { class: 'muted' }, ' · 음력') : null),
          h('td', { class: 'muted' }, typeLabel(o.type)))))) : h('p', { class: 'muted' }, '30일 안에 잡힌 일정이 없습니다.'))].filter(Boolean));
  };

  async function edit(ev, onDate) {
    const isNew = !ev;
    const d = ev ? { ...ev } : { title: '', type: 'meeting', calendar: 'solar', date: onDate, time: '', yearly: false, remind: '', memo: '', leap: false };
    if (isNew) {
      const l = solarToLunar(onDate);
      d.lunarHint = l;
    }
    const title = h('input', { type: 'text', value: d.title, placeholder: '예: 공정회의, 결혼기념일' });
    const type = h('select', null, TYPES.map(t => h('option', { value: t.key, selected: t.key === d.type }, t.label)));
    const calSel = h('select', null, h('option', { value: 'solar', selected: d.calendar !== 'lunar' }, '양력'), h('option', { value: 'lunar', selected: d.calendar === 'lunar' }, '음력'));
    const date = h('input', { type: 'date', value: d.calendar === 'lunar' ? '' : d.date });
    const ly = h('input', { type: 'number', min: 1900, max: 2050, style: { width: '90px' } });
    const lm = h('input', { type: 'number', min: 1, max: 12, style: { width: '70px' } });
    const ld = h('input', { type: 'number', min: 1, max: 30, style: { width: '70px' } });
    const leap = h('input', { type: 'checkbox' });
    const lunarRow = h('div', { class: 'row' }, ly, '년', lm, '월', ld, '일', h('label', { class: 'check' }, leap, '윤달'));
    const conv = h('p', { class: 'hint' });
    const time = h('input', { type: 'time', value: d.time || '' });
    const yearly = h('input', { type: 'checkbox', checked: !!d.yearly });
    const remind = h('select', null, [['', '알림 없음'], ['0', '당일'], ['1', '1일 전부터'], ['3', '3일 전부터'], ['7', '7일 전부터'], ['14', '14일 전부터'], ['30', '30일 전부터']]
      .map(([v, t]) => h('option', { value: v, selected: String(d.remind ?? '') === v }, t)));
    const memo = h('textarea', { rows: 3 }, d.memo || '');
    if (d.calendar === 'lunar') { const [a, b, c] = d.date.split('-').map(Number); ly.value = a; lm.value = b; ld.value = c; leap.checked = !!d.leap; }
    else { const l = solarToLunar(d.date); if (l) { ly.value = l.y; lm.value = l.m; ld.value = l.d; leap.checked = l.leap; } }
    const sync = () => {
      const lunar = calSel.value === 'lunar';
      date.parentElement.hidden = lunar; lunarRow.parentElement.hidden = !lunar;
      if (lunar) { const s = lunarToSolar(+ly.value, +lm.value, +ld.value, leap.checked); conv.textContent = s ? `올해 기준 양력 ${s}` : '없는 음력 날짜입니다.'; }
      else { const l = date.value && solarToLunar(date.value); conv.textContent = l ? `음력 ${l.y}.${l.m}.${l.d}${l.leap ? ' (윤)' : ''}` : ''; }
    };
    [calSel, date, ly, lm, ld, leap].forEach(x => x.addEventListener('input', sync));
    if (['anniv', 'birthday'].includes(d.type) && isNew) yearly.checked = true;
    type.addEventListener('change', () => { if (['anniv', 'birthday'].includes(type.value)) yearly.checked = true; });
    const err = h('p', { class: 'error' });
    const body = [
      h('label', { class: 'field' }, '제목', title),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, '구분', type), h('label', { class: 'field' }, '달력', calSel)),
      h('label', { class: 'field' }, '날짜', date), h('label', { class: 'field' }, '음력 날짜', lunarRow), conv,
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, '시간 (선택)', time), h('label', { class: 'field' }, '미리 알림', remind)),
      h('label', { class: 'check' }, yearly, '매년 반복'),
      h('label', { class: 'field' }, '메모', memo), err,
      h('p', { class: 'hint' }, '알림은 MY AIDE를 열 때와 Windows 앱이 켜져 있는 동안 표시됩니다.')
    ];
    const r = await dialog({
      title: isNew ? '일정 추가' : '일정 수정', body,
      onOpen: () => { sync(); title.focus(); },
      actions: [
        !isNew ? { label: '삭제', kind: 'danger', run: async close => { if (await confirmBox('이 일정을 삭제할까요?', '삭제', true)) { await db.remove('schedule', ev.id); close('deleted'); } return false; } } : null,
        { label: '취소' },
        { label: '저장', kind: 'primary', run: async () => {
          if (!title.value.trim()) { err.textContent = '제목을 입력해 주세요.'; return false; }
          const lunar = calSel.value === 'lunar';
          let dateStr;
          if (lunar) {
            if (!lunarToSolar(+ly.value, +lm.value, +ld.value, leap.checked)) { err.textContent = '음력 날짜를 확인해 주세요.'; return false; }
            dateStr = `${ly.value}-${pad2(lm.value)}-${pad2(ld.value)}`;
          } else {
            if (!date.value) { err.textContent = '날짜를 골라 주세요.'; return false; }
            dateStr = date.value;
          }
          await db.put('schedule', ev ? ev.id : uid(), {
            title: title.value.trim(), type: type.value, calendar: lunar ? 'lunar' : 'solar', date: dateStr, leap: lunar && leap.checked,
            time: time.value, yearly: yearly.checked, remind: remind.value, memo: memo.value.trim()
          });
          return true;
        }, value: 'saved' }
      ].filter(Boolean)
    });
    if (r === 'saved') toast('저장했습니다');
    if (r === 'deleted') toast('삭제했습니다');
  }

  async function exportIcs() {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MY AIDE//KO', 'CALSCALE:GREGORIAN'];
    const now = new Date(); const end = new Date(); end.setFullYear(end.getFullYear() + 3);
    const occ = occurrences(events, ymd(now), ymd(end));
    for (const o of occ) {
      const day = o.on.replace(/-/g, '');
      lines.push('BEGIN:VEVENT', `UID:${o.id}-${day}@myaide`, `DTSTAMP:${stamp(now)}`);
      if (o.time) {
        const [hh, mm] = o.time.split(':');
        const endT = new Date(parseYmd(o.on)); endT.setHours(+hh, +mm + 60);
        lines.push(`DTSTART;TZID=Asia/Seoul:${day}T${hh}${mm}00`, `DTEND;TZID=Asia/Seoul:${ymd(endT).replace(/-/g, '')}T${pad2(endT.getHours())}${pad2(endT.getMinutes())}00`);
      } else {
        const next = parseYmd(o.on); next.setDate(next.getDate() + 1);
        lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${ymd(next).replace(/-/g, '')}`);
      }
      lines.push('SUMMARY:' + icsText(o.title), 'DESCRIPTION:' + icsText(`[${typeLabel(o.type)}] ${o.memo || ''}`), 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    download(`MY AIDE 일정 ${today()}.ics`, new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
    toast(`앞으로 3년치 일정 ${occ.length}건을 내보냈습니다`);
  }

  async function importIcs() {
    const input = h('input', { type: 'file', accept: '.ics,text/calendar' });
    input.onchange = async () => {
      const f = input.files[0]; if (!f) return;
      const evs = parseIcs(await f.text());
      if (!evs.length) { toast('가져올 일정이 없습니다.', 'err'); return; }
      const existing = new Set(events.map(e => e.date + '|' + e.title));
      let n = 0;
      for (const e of evs) { if (existing.has(e.date + '|' + e.title)) continue; await db.put('schedule', uid(), e); n++; }
      toast(`일정 ${n}건을 가져왔습니다` + (evs.length > n ? ` (중복 ${evs.length - n}건 제외)` : ''));
    };
    input.click();
  }

  const onChange = async e => { if (e.detail.col === 'schedule') { await load(); draw(); } };
  db.events.addEventListener('change', onChange);
  await load(); draw();
  notifyDue();
  return { cleanup: () => db.events.removeEventListener('change', onChange) };
}

const daysUntil = s => Math.round((parseYmd(s) - parseYmd(today())) / 86400000);
const dday = s => { const n = daysUntil(s); return n === 0 ? '오늘' : `D-${n}`; };
const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

export function parseIcs(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const out = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const get = k => { const m = block.match(new RegExp('^' + k + '(?:;[^:\\n]*)?:(.*)$', 'm')); return m ? m[1].trim() : ''; };
    const start = get('DTSTART'); if (!start) continue;
    const date = `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`;
    const time = start.length >= 13 && start[8] === 'T' ? `${start.slice(9, 11)}:${start.slice(11, 13)}` : '';
    const title = get('SUMMARY').replace(/\\n/g, ' ').replace(/\\([,;\\])/g, '$1') || '(제목 없음)';
    out.push({ title, type: 'other', calendar: 'solar', date, leap: false, time, yearly: /FREQ=YEARLY/.test(get('RRULE')), remind: '', memo: get('DESCRIPTION').replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1') });
  }
  return out;
}

// Show today's due reminders once a day (browser notification, or a Windows toast in the app).
export async function notifyDue() {
  const key = 'remind.shown.' + today();
  if (await db.kvGet(key)) return;
  const due = (await upcoming(31)).filter(o => o.remind !== '' && o.remind != null && daysUntil(o.on) <= Number(o.remind));
  if (!due.length) return;
  await db.kvSet(key, 1);
  const text = due.slice(0, 5).map(o => `${dday(o.on)} ${o.title}`).join('\n');
  if (native.available) native.call('notify', { title: 'MY AIDE 일정 알림', text }).catch(() => {});
  else if ('Notification' in window && Notification.permission === 'granted') new Notification('MY AIDE 일정 알림', { body: text });
  else toast('일정 알림: ' + due.map(o => `${dday(o.on)} ${o.title}`).slice(0, 3).join(', '));
}
