// 네이버 캘린더 ⇄ 일정관리 two-way sync over CalDAV (the same way iPhone Calendar connects to Naver).
// Naver's server can't be called from a browser, so the requests travel through the Windows app
// (native 'caldav.request'). Phones keep working with MY AIDE as usual; their changes reach Naver the
// next time the PC app syncs (every 5 minutes while it runs, and right after an edit).
//
// State (synced with the rest of MY AIDE): settings/naver = { enabled, user, calendarUrl, calendarName,
//   lastSync, lastError, map: { uid: { id, href, etag, at } } }   (password: vault secret 'naver')
// Rule when both sides changed since the last sync: the newer change wins.
import * as db from './db.js';
import * as vault from './vault.js';
import { native } from './native.js';
import { uid } from './util.js';
import * as sync from './sync.js';

const HOST = 'https://caldav.calendar.naver.com';
export const naverEvents = new EventTarget();
const STATE = ['settings', 'naver'];
export async function getState() { return (await db.get(...STATE)) || { enabled: false, map: {} }; }
async function putState(s) { const { id, updatedAt, ...rest } = s; await db.put(...STATE, rest); naverEvents.dispatchEvent(new Event('change')); }

// ---------- HTTP through the Windows app ----------
async function dav(method, url, { body, headers = {}, auth } = {}) {
  if (!native.available) throw new Error('네이버 캘린더 동기화는 Windows 앱(MY AIDE.exe)에서 실행됩니다.');
  const full = url.startsWith('http') ? url : HOST + url;
  const basic = 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(`${auth.user}:${auth.pass}`)));
  let r = await native.call('caldav.request', { url: full, method, body, headers: { Authorization: basic, ...headers } });
  if ([301, 302, 307, 308].includes(r.status) && r.headers.location) r = await native.call('caldav.request', { url: new URL(r.headers.location, full).href, method, body, headers: { Authorization: basic, ...headers } });
  if (r.status === 401) throw new Error('네이버 아이디 또는 애플리케이션 비밀번호가 맞지 않습니다.');
  return r;
}
const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const byLocal = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const text1 = (node, name) => byLocal(node, name)[0]?.textContent?.trim() || '';

// Find the person's calendars: principal → calendar-home-set → list.
export async function discover(auth) {
  const p1 = await dav('PROPFIND', '/', { auth, headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>' });
  const principal = byLocal(xml(p1.body), 'current-user-principal').map(n => text1(n, 'href'))[0];
  if (!principal) throw new Error('네이버 캘린더에 연결하지 못했습니다 (' + p1.status + ').');
  const p2 = await dav('PROPFIND', principal, { auth, headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>' });
  const home = byLocal(xml(p2.body), 'calendar-home-set').map(n => text1(n, 'href'))[0] || principal;
  const p3 = await dav('PROPFIND', home, { auth, headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>' });
  return byLocal(xml(p3.body), 'response').filter(r => byLocal(r, 'calendar').length && (!byLocal(r, 'comp').length || byLocal(r, 'comp').some(c => c.getAttribute('name') === 'VEVENT')))
    .map(r => ({ url: new URL(text1(r, 'href'), HOST).href, name: text1(r, 'displayname') || '캘린더', readOnly: !byLocal(r, 'write').length && byLocal(r, 'privilege').length > 0 }));
}

// ---------- iCalendar ----------
const unfold = s => s.replace(/\r?\n[ \t]/g, '');
const unesc = v => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const esc = v => String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function veventBlock(ics) { const m = unfold(ics).match(/BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT/); return m ? m[0] : ''; }
function prop(block, name) {
  const re = new RegExp('^' + name + '((?:;[^:\\r\\n]*)?):(.*)$', 'mi');
  const m = block.match(re); if (!m) return null;
  const params = {}; m[1].split(';').filter(Boolean).forEach(p => { const [k, v] = p.split('='); params[k.toUpperCase()] = (v || '').replace(/"/g, ''); });
  return { params, value: m[2].replace(/\r$/, '') };
}
const pad = n => String(n).padStart(2, '0');
const kst = d => new Date(d.getTime() + 9 * 3600e3);   // Korea has no daylight saving
// DTSTART → { date: 'YYYY-MM-DD', time: 'HH:MM' | '' } in Korean time
function readStart(p) {
  if (!p) return null;
  const v = p.value.trim();
  if (p.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, time: '' };
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/); if (!m) return null;
  if (m[7] === 'Z') { const d = kst(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]))); return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }; }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };   // TZID=Asia/Seoul or floating
}
function parseEvent(ics) {
  const b = veventBlock(ics); if (!b) return null;
  const st = readStart(prop(b, 'DTSTART')); if (!st) return null;
  const rr = prop(b, 'RRULE')?.value || '';
  const lm = prop(b, 'LAST-MODIFIED')?.value || prop(b, 'DTSTAMP')?.value || '';
  const lmT = lm.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/) ? Date.UTC(+lm.slice(0, 4), +lm.slice(4, 6) - 1, +lm.slice(6, 8), +lm.slice(9, 11), +lm.slice(11, 13), +lm.slice(13, 15)) : 0;
  return { uid: prop(b, 'UID')?.value, title: unesc(prop(b, 'SUMMARY')?.value || ''), memo: unesc(prop(b, 'DESCRIPTION')?.value || ''),
    date: st.date, time: st.time, rrule: rr, yearly: /FREQ=YEARLY/.test(rr), lastModified: lmT, recurrenceId: !!prop(b, 'RECURRENCE-ID') };
}
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
function dtLines(ev) {
  if (!ev.time) {
    const d = ev.date.replace(/-/g, ''); const n = new Date(ev.date + 'T00:00:00Z'); n.setUTCDate(n.getUTCDate() + 1);
    return [`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${n.toISOString().slice(0, 10).replace(/-/g, '')}`];
  }
  const s = new Date(`${ev.date}T${ev.time}:00+09:00`), e = new Date(s.getTime() + 3600e3);
  const z = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return [`DTSTART:${z(s)}`, `DTEND:${z(e)}`];
}
function newIcs(ev, id) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MY AIDE//KO', 'BEGIN:VEVENT', `UID:${id}`, `DTSTAMP:${stamp()}`, `LAST-MODIFIED:${stamp()}`,
    ...dtLines(ev), `SUMMARY:${esc(ev.title)}`, ev.memo ? `DESCRIPTION:${esc(ev.memo)}` : null, ev.yearly ? 'RRULE:FREQ=YEARLY' : null,
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n') + '\r\n';
}
// Change only what MY AIDE knows (title, time, memo, yearly) and keep everything else Naver stored.
function patchIcs(ics, ev, remote) {
  const lines = unfold(ics).split(/\r?\n/);
  const s = lines.findIndex(l => l === 'BEGIN:VEVENT'), e = lines.findIndex((l, i) => i > s && l === 'END:VEVENT');
  if (s < 0 || e < 0) return newIcs(ev, remote.uid);
  const drop = /^(DTSTART|DTEND|DURATION|SUMMARY|DESCRIPTION|LAST-MODIFIED|DTSTAMP)[;:]/i;
  let body = lines.slice(s + 1, e).filter(l => !drop.test(l));
  const timeChanged = ev.date !== remote.date || ev.time !== remote.time;
  const keepDt = !timeChanged ? lines.slice(s + 1, e).filter(l => /^(DTSTART|DTEND|DURATION)[;:]/i.test(l)) : dtLines(ev);
  if (ev.yearly && !remote.rrule) body.push('RRULE:FREQ=YEARLY');
  if (!ev.yearly && remote.yearly) body = body.filter(l => !/^RRULE[;:]/i.test(l));
  const add = [`DTSTAMP:${stamp()}`, `LAST-MODIFIED:${stamp()}`, ...keepDt, `SUMMARY:${esc(ev.title)}`, ev.memo ? `DESCRIPTION:${esc(ev.memo)}` : null].filter(Boolean);
  return [...lines.slice(0, s + 1), ...body, ...add, ...lines.slice(e)].filter(l => l !== '').join('\r\n') + '\r\n';
}

// ---------- sync ----------
const WINDOW_BACK = 400, WINDOW_AHEAD = 760;   // days
const inWindow = date => { const t = new Date(date + 'T00:00:00+09:00').getTime(), now = Date.now(); return t > now - WINDOW_BACK * 864e5 && t < now + WINDOW_AHEAD * 864e5; };
// 네이버 일정 읽기. 1) 기간 검색(calendar-query) → 내용이 안 오면 2) 목록(PROPFIND) + 묶음 읽기(multiget) → 3) 하나씩 GET.
// 어떤 길로 몇 개를 읽었는지 diag에 남겨 연동 창에 보여 줍니다.
const sameUrl = (a, b) => decodeURIComponent(new URL(a, HOST).pathname).replace(/\/$/, '') === decodeURIComponent(new URL(b, HOST).pathname).replace(/\/$/, '');
function collect(body, out, seen) {
  let n = 0;
  for (const resp of byLocal(xml(body), 'response')) {
    const ics = text1(resp, 'calendar-data'); if (!ics) continue;
    n++;
    const ev = parseEvent(ics); if (!ev || !ev.uid || ev.recurrenceId || seen.has(ev.uid)) continue;
    seen.add(ev.uid);
    out.push({ ...ev, href: new URL(text1(resp, 'href'), HOST).href, etag: text1(resp, 'getetag').replace(/^W\//, ''), ics });
  }
  return n;
}
export async function listItems(calendarUrl, auth) {
  const r = await dav('PROPFIND', calendarUrl, { auth, headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getcontenttype/><d:resourcetype/></d:prop></d:propfind>' });
  if (r.status >= 400) return { status: r.status, items: [] };
  const items = byLocal(xml(r.body), 'response').filter(x => !byLocal(x, 'collection').length && !sameUrl(text1(x, 'href'), calendarUrl))
    .map(x => ({ href: new URL(text1(x, 'href'), HOST).href, etag: text1(x, 'getetag').replace(/^W\//, ''), type: text1(x, 'getcontenttype') }))
    .filter(x => !x.type || /calendar/i.test(x.type) || /\.ics$/i.test(x.href));
  return { status: r.status, items };
}
async function fetchRemote(st, auth) {
  const z = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const from = new Date(Date.now() - WINDOW_BACK * 864e5), to = new Date(Date.now() + WINDOW_AHEAD * 864e5);
  const out = [], seen = new Set(), diag = { at: Date.now() };
  const r = await dav('REPORT', st.calendarUrl, { auth, headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${z(from)}" end="${z(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>` });
  diag.query = r.status; diag.queryResp = r.status < 400 ? byLocal(xml(r.body), 'response').length : 0;
  diag.queryData = r.status < 400 ? collect(r.body, out, seen) : 0;
  diag.how = '기간 검색';
  if (!diag.queryData) {
    // 기간 검색으로 내용이 오지 않음 → 전체 목록을 받아 묶음으로 읽기
    const li = await listItems(st.calendarUrl, auth);
    diag.list = li.status; diag.listN = li.items.length;
    if (r.status >= 400 && li.status >= 400) throw new Error(`네이버 일정을 읽지 못했습니다 (검색 ${r.status}, 목록 ${li.status}).`);
    for (let i = 0; i < li.items.length; i += 40) {
      const part = li.items.slice(i, i + 40);
      const m = await dav('REPORT', st.calendarUrl, { auth, headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
        body: `<?xml version="1.0"?><c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>${part.map(x => `<d:href>${new URL(x.href).pathname}</d:href>`).join('')}</c:calendar-multiget>` });
      const got = m.status < 400 ? collect(m.body, out, seen) : 0;
      diag.multi = m.status; diag.how = '묶음 읽기';
      if (!got) {   // 묶음 읽기도 안 되면 하나씩
        diag.how = '하나씩 읽기';
        for (const x of part) {
          const g = await dav('GET', x.href, { auth });
          if (g.status >= 400 || !/BEGIN:VEVENT/.test(g.body || '')) continue;
          const ev = parseEvent(g.body); if (!ev || !ev.uid || ev.recurrenceId || seen.has(ev.uid)) continue;
          seen.add(ev.uid); out.push({ ...ev, href: x.href, etag: (g.headers.etag || x.etag || '').replace(/^W\//, ''), ics: g.body });
        }
      }
    }
  }
  diag.got = out.length;
  return { items: out, diag };
}
const localFields = ev => ({ title: ev.title, date: ev.date, time: ev.time, yearly: ev.yearly, memo: ev.memo });
const same = (a, b) => a.title === b.title && a.date === b.date && (a.time || '') === (b.time || '') && !!a.yearly === !!b.yearly && (a.memo || '') === (b.memo || '');

let running = null, lastEnd = 0;
const startedAt = Date.now();
export function syncNaver({ quiet } = {}) {
  // 같은 PC의 다른 창(위젯 등)과 동시에 돌지 않도록 잠금
  const locked = () => navigator.locks ? navigator.locks.request('myaide-naver-sync', () => doSync()) : doSync();
  if (!running) running = locked().finally(() => { running = null; lastEnd = Date.now(); });
  return quiet ? running.catch(() => null) : running;
}
async function doSync() {
  const st = await getState();
  if (!st.enabled || !st.calendarUrl || !native.available) return null;
  if (!vault.isOpen()) return null;
  const pass = await vault.getSecret('naver');
  if (!pass) throw new Error('네이버 애플리케이션 비밀번호가 없습니다.');
  const auth = { user: st.user, pass };
  const stats = { in: 0, out: 0, del: 0 };
  // Only after this PC has caught up with Google Drive — otherwise not-yet-downloaded 일정 would look deleted.
  if (await db.kvGet('mode') === 'drive' && (!sync.state.lastSync || sync.state.lastSync < startedAt)) { await sync.syncNow().catch(() => {}); if (!sync.state.lastSync || sync.state.lastSync < startedAt) throw new Error('Google Drive 동기화가 끝난 뒤에 네이버와 맞춥니다. 잠시 후 다시 시도해 주세요.'); }
  try {
    let { items: remote, diag } = await fetchRemote(st, auth);
    await putState({ ...(await getState()), lastDiag: diag });
    const map = { ...(st.map || {}) }, next = {}, mappedIds = new Set();
    const dd = await removeDuplicates(map, auth);
    stats.dup = dd.n; remote = remote.filter(r => !dd.gone.has(r.uid));   // 방금 네이버에서 지운 사본은 다시 가져오지 않음
    const local = new Map((await db.all('schedule')).map(r => [r.id, r]));
    const goneHere = Object.values(map).filter(m => !local.has(m.id)).length;
    // 네이버 쪽이 한꺼번에 비어 보이면(읽기 실패일 수 있음) MY AIDE 일정을 지우지 않고 멈춤
    const remoteUidSet = new Set(remote.map(r => r.uid));
    const goneThere = Object.entries(map).filter(([u, m]) => !remoteUidSet.has(u) && local.has(m.id)).length;
    if (((goneThere > 3 && goneThere > Object.keys(map).length / 2) || (!remote.length && goneThere > 0)) && !st.allowMassDelete)
      throw new Error(`네이버에서 연동된 일정 ${goneThere}개가 한꺼번에 안 보여서, MY AIDE 일정을 지우지 않고 멈췄습니다. 네이버에서 일부러 지운 것이면 ‘그래도 동기화’를 누르세요.`);
    if (goneHere > 5 && goneHere > Object.keys(map).length / 2 && !st.allowMassDelete)
      throw new Error(`MY AIDE에서 연동된 일정 ${goneHere}개가 한꺼번에 사라져서, 네이버 쪽을 지우지 않고 멈췄습니다. 일부러 지운 것이면 ‘네이버 연동’에서 ‘그래도 동기화’를 누르세요.`);
    const putLocal = async (id, base, ev, nv) => {
      const { id: _i, updatedAt, ...rest } = base || { type: 'other', calendar: 'solar', leap: false, remind: '' };
      await db.put('schedule', id, { ...rest, ...localFields(ev), naverUid: nv });
      return (await db.get('schedule', id))?.updatedAt || Date.now();
    };
    for (const r of remote) {
      const m = map[r.uid], L = m && local.get(m.id);
      if (m && L) {
        mappedIds.add(L.id);
        const localChanged = L.updatedAt > m.at, remoteChanged = r.etag !== m.etag;
        let entry = { ...m, href: r.href };
        if (remoteChanged && (!localChanged || r.lastModified >= L.updatedAt)) {
          if (!same(L, r)) { entry.at = await putLocal(L.id, L, r, r.uid); stats.in++; } else entry.at = L.updatedAt;
          entry.etag = r.etag;
        } else if (localChanged && !same(L, r) && L.calendar !== 'lunar') {
          const res = await dav('PUT', r.href, { auth, body: patchIcs(r.ics, L, r), headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-Match': r.etag } });
          if (res.status >= 400) throw new Error(`‘${L.title}’을(를) 네이버에 저장하지 못했습니다 (${res.status}).`);
          entry.etag = res.headers.etag || (await headEtag(r.href, auth)); entry.at = L.updatedAt; stats.out++;
        } else { entry.etag = r.etag; entry.at = L.updatedAt; }
        next[r.uid] = entry;
      } else if (m && !L) {
        // removed in MY AIDE → remove on Naver
        const res = await dav('DELETE', r.href, { auth, headers: { 'If-Match': r.etag } });
        if (res.status < 400 || res.status === 404) stats.del++; else next[r.uid] = m;
      } else {
        // 연동 기록에 없는 네이버 일정: 이미 MY AIDE에 같은 일정이 있으면 새로 만들지 않고 이어 줌
        const mappedNow = new Set([...Object.values(map).map(x => x.id), ...mappedIds]);
        const twin = [...local.values()].find(L => !mappedNow.has(L.id) && L.naverUid === r.uid)
          || [...local.values()].find(L => !mappedNow.has(L.id) && L.calendar !== 'lunar' && same(L, r));
        if (twin) {
          mappedIds.add(twin.id);
          const at = twin.naverUid === r.uid ? twin.updatedAt : await putLocal(twin.id, twin, { ...localFields(twin) }, r.uid);
          next[r.uid] = { id: twin.id, href: r.href, etag: r.etag, at };
          continue;
        }
        const id = uid();
        const at = await putLocal(id, null, r, r.uid);
        next[r.uid] = { id, href: r.href, etag: r.etag, at }; mappedIds.add(id); stats.in++;
      }
    }
    const remoteUids = new Set(remote.map(r => r.uid));
    // mapped earlier but gone from Naver (inside the window we read): removed on Naver → remove here, unless edited here since
    for (const [u, m] of Object.entries(map)) {
      if (remoteUids.has(u)) continue;
      const L = local.get(m.id);
      if (!L) continue;
      const visible = L.yearly || inWindow(L.date);
      if (!visible) { next[u] = m; mappedIds.add(L.id); continue; }
      if (L.updatedAt > m.at) continue;   // edited in MY AIDE after Naver deleted it: push again below as new
      await db.remove('schedule', L.id); stats.del++; mappedIds.add(L.id);
    }
    // new in MY AIDE → new on Naver (양력 일정만; 음력은 네이버 표준 형식으로 옮길 수 없음)
    for (const L of local.values()) {
      if (mappedIds.has(L.id) || L.calendar === 'lunar' || !L.title) continue;
      if (L.naverUid && remoteUids.has(L.naverUid)) continue;   // 이미 네이버에 있는 일정 — 다시 올리지 않음
      const u = L.naverUid && !remoteUids.has(L.naverUid) && !map[L.naverUid] ? L.naverUid : `myaide-${L.id}`;
      const href = st.calendarUrl.replace(/\/?$/, '/') + encodeURIComponent(u) + '.ics';
      const res = await dav('PUT', href, { auth, body: newIcs(L, u), headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' } });
      if (res.status >= 400 && res.status !== 412) throw new Error(`‘${L.title}’을(를) 네이버에 올리지 못했습니다 (${res.status}).`);
      next[u] = { id: L.id, href, etag: res.headers.etag || (await headEtag(href, auth)), at: L.updatedAt }; stats.out++;
    }
    await putState({ ...(await getState()), map: next, lastSync: Date.now(), lastError: '', lastStats: { ...stats, remote: remote.length, local: local.size }, allowMassDelete: false });
    return stats;
  } catch (e) {
    await putState({ ...(await getState()), lastError: e.message, lastTry: Date.now() });
    throw e;
  }
}
// 같은 네이버 일정(naverUid)이 MY AIDE에 여러 개 있으면 하나만 남김.
// 연동 기록을 잃었을 때 생긴 사본이 네이버에 'myaide-…'로 올라가 있으면 그 사본도 네이버에서 지움.
async function removeDuplicates(map, auth) {
  const all = await db.all('schedule'), groups = new Map();
  for (const r of all) if (r.naverUid) { if (!groups.has(r.naverUid)) groups.set(r.naverUid, []); groups.get(r.naverUid).push(r); }
  let n = 0; const gone = new Set();
  for (const [u, list] of groups) {
    if (list.length < 2) continue;
    const keep = list.find(r => map[u] && map[u].id === r.id) || list.slice().sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))[0];
    for (const r of list) {
      if (r.id === keep.id) continue;
      const key = Object.keys(map).find(k => map[k].id === r.id);
      if (key && key !== u && map[key].href) {
        const res = await dav('DELETE', map[key].href, { auth }).catch(() => null);
        if (res && res.status >= 400 && res.status !== 404) continue;   // 네이버 사본을 못 지우면 이쪽도 그대로 둠
      }
      if (key) { if (key !== u) gone.add(key); delete map[key]; }
      await db.remove('schedule', r.id); n++;
    }
  }
  return { n, gone };
}
async function headEtag(href, auth) {
  const r = await dav('PROPFIND', href, { auth, headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>' });
  return text1(xml(r.body), 'getetag');
}

// Windows app: sync every 5 minutes and shortly after any 일정 change.
let timer = null, soon = null;
export function startAutoSync() {
  if (!native.available || timer) return;
  timer = setInterval(() => syncNaver({ quiet: true }), 5 * 60 * 1000);
  db.events.addEventListener('change', e => {
    if (e.detail.col !== 'schedule' || running || Date.now() - lastEnd < 3000) return;
    clearTimeout(soon); soon = setTimeout(() => syncNaver({ quiet: true }), 4000);
  });
  setTimeout(() => syncNaver({ quiet: true }), 3000);
}
export { parseEvent, patchIcs, newIcs };
