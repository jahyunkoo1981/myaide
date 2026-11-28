// 카카오톡 '대화 내용 내보내기' 파일 읽기 + 농구 일정·결과·기사 링크 뽑기 (AI 없이 규칙으로)
// 지원 형식: iPhone·안드로이드(“2026. 11. 21. 오후 6:16, 이름 : 내용”, “2026년 11월 21일 오후 6:16, 이름 : 내용”),
//           PC(“--------------- 2026년 11월 21일 토요일 ---------------” 다음 줄 “[이름] [오후 6:16] 내용”)

const pad = n => String(n).padStart(2, '0');
const ymdOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const h24 = (ap, h) => { h = +h; if (ap === '오후' && h < 12) h += 12; if (ap === '오전' && h === 12) h = 0; return h; };

// ---------- 1. 파일 → 메시지 목록 ----------
export function parseChat(text) {
  text = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const lines = text.split('\n');
  let room = '';
  const head = lines.slice(0, 3).join('\n');
  const rm = head.match(/^(.+?)\s*(?:님과)?\s*카카오톡 대화/m) || head.match(/^(.+?)\s+\d+\s*카카오톡 대화/m);
  if (rm) room = rm[1].replace(/\s+\d+$/, '').trim();
  const msgs = [];
  let pcDay = null, last = null;
  const MOBILE = /^(\d{4})[.년]\s*(\d{1,2})[.월]\s*(\d{1,2})[.일]?\s*(?:[(\s][월화수목금토일][)]?\s*)?(오전|오후)?\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*,\s*(.+?)\s*:\s?(.*)$/;
  const MOBILE_SYS = /^(\d{4})[.년]\s*(\d{1,2})[.월]\s*(\d{1,2})[.일]?\s*(오전|오후)?\s*(\d{1,2}):(\d{2})\s*[:,]\s*(.*)$/;
  const PC_DAY = /^-{3,}\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일.*-{3,}\s*$/;
  const PC_MSG = /^\[(.+?)\]\s*\[(오전|오후)\s*(\d{1,2}):(\d{2})\]\s?(.*)$/;
  const DAY_ONLY = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*[월화수목금토일]요일\s*$/;
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '');
    let m;
    if ((m = l.match(PC_DAY)) || (m = l.match(DAY_ONLY))) { pcDay = new Date(+m[1], +m[2] - 1, +m[3]); last = null; continue; }
    if ((m = l.match(MOBILE))) {
      const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? h24(m[4], m[5]) : +m[5], +m[6]);
      last = { ts: d.getTime(), who: m[7].trim(), text: m[8] }; msgs.push(last); continue;
    }
    if (pcDay && (m = l.match(PC_MSG))) {
      const d = new Date(pcDay); d.setHours(h24(m[2], m[3]), +m[4]);
      last = { ts: d.getTime(), who: m[1].trim(), text: m[5] }; msgs.push(last); continue;
    }
    if (MOBILE_SYS.test(l)) { last = null; continue; }   // 입장·퇴장 같은 안내 줄
    if (last && l) last.text += '\n' + l;               // 여러 줄짜리 메시지
  }
  return { room, msgs };
}

// ---------- 2. 메시지 → 농구 정보 ----------
export const HOOPS = /경기|대회|연습|훈련|시합|리그|예선|본선|결승|[248]강|토너먼트|대진|집합|체육관|코트|유니폼|농구|교류전|친선|디비전|U-?\d{1,2}\b|스코어|점수|이겼|졌|우승|준우승|\bvs\b|VS/i;
const REGIONS = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기도', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
  '아산', '천안', '청주', '충주', '제천', '원주', '춘천', '강릉', '수원', '용인', '성남', '고양', '화성', '평택', '안산', '안양', '부천', '김포', '파주', '의정부', '남양주',
  '세종', '공주', '보령', '서산', '당진', '논산', '홍성', '예산', '전주', '군산', '익산', '여수', '순천', '목포', '포항', '경주', '구미', '안동', '창원', '김해', '진주', '양산', '거제', '통영', '속초', '동해', '삼척', '태백', '영월', '홍천', '횡성', '음성', '진천', '증평', '괴산', '보은', '옥천', '영동', '단양'];
const PLACE = /([가-힣A-Za-z0-9]{2,20}\s?(?:실내체육관|국민체육센터|체육센터|스포츠센터|체육관|체육공원|초등학교|중학교|고등학교|대학교|경기장|아레나|농구장|코트|돔))/;
const SCHOOL_SHORT = /([가-힣]{2,8}(?:초|중|고))(?=\s|에서|,|$)/;
const TOUR = /((?:[가-힣A-Za-z0-9·]+\s){0,3}[가-힣A-Za-z0-9·]{1,20}(?:배|컵|리그|대회|챔피언십|페스티벌|교류전|협회장기|연맹전))(?=[\s,.!)]|$)/;
const tourName = t => { const m = t.match(TOUR); if (!m) return ''; const w = m[1].split(/\s+/); while (w.length > 1 && /^\(|\)$|\d+[월일]|^\d|^(이번|다음|오늘|내일|모레|주말|토요일|일요일|공지|\[공지\])/.test(w[0])) w.shift(); return w.join(' '); };
const URLRE = /https?:\/\/[^\s<>"')]+/g;
const WEEKDAY = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

function findDate(t, base) {
  const by = base.getFullYear();
  const mk = (y, m, d) => { const x = new Date(y, m - 1, d); return x.getMonth() === m - 1 ? x : null; };
  let m;
  if ((m = t.match(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/))) return mk(+m[1], +m[2], +m[3]);
  if ((m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)) || (m = t.match(/(?<![\d.:])(\d{1,2})[./](\d{1,2})(?![\d.:/])\s*(?:\(?[월화수목금토일]\)?)?/))) {
    let d = mk(by, +m[1], +m[2]); if (!d) return null;
    if (d < new Date(base.getTime() - 60 * 864e5)) d = mk(by + 1, +m[1], +m[2]);   // 12월에 '1/5' → 내년
    return d;
  }
  const rel = (n) => { const x = new Date(base); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + n); return x; };
  if (/모레/.test(t)) return rel(2);
  if (/내일/.test(t)) return rel(1);
  if (/오늘/.test(t) && HOOPS.test(t)) return rel(0);
  if ((m = t.match(/(이번\s*주|다음\s*주|담주|차주)?\s*([월화수목금토일])요일/))) {
    const want = WEEKDAY[m[2]], b = rel(0), cur = b.getDay();
    let diff = (want - cur + 7) % 7;
    if (m[1] && /다음|담|차/.test(m[1])) diff = (7 - cur) + want;   // 다음 주 X요일
    else if (m[1] && /이번/.test(m[1])) diff = want - cur < 0 ? diff : want - cur;
    return rel(diff);
  }
  if ((m = t.match(/(?<![\d월./])(\d{1,2})\s*일\s*\(?([월화수목금토일])\)?/))) {
    let d = mk(by, base.getMonth() + 1, +m[1]); if (d && d < rel(-3)) d = mk(by, base.getMonth() + 2, +m[1]);
    return d;
  }
  return null;
}
function findTime(t) {
  let m;
  if ((m = t.match(/(오전|오후|아침|낮|저녁|밤)\s*(\d{1,2})\s*(?:시|:)\s*(?:(\d{1,2})\s*분?|(반))?/))) {
    let hh = +m[2]; if (/오후|저녁|밤/.test(m[1]) && hh < 12) hh += 12; if (/낮/.test(m[1]) && hh < 7) hh += 12;
    return `${pad(hh)}:${m[4] ? '30' : pad(m[3] || 0)}`;
  }
  if ((m = t.match(/(?<![\d.])([01]?\d|2[0-3]):([0-5]\d)(?!\d)/))) { let hh = +m[1]; if (hh >= 1 && hh <= 7) hh += 12; return `${pad(hh)}:${m[2]}`; }
  if ((m = t.match(/(?<![\d.])(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|(반))?/))) { let hh = +m[1]; if (hh >= 1 && hh <= 7) hh += 12; return `${pad(hh)}:${m[3] ? '30' : pad(m[2] || 0)}`; }
  return '';
}
function kindOf(t) {
  if (/연습|훈련|트레이닝|레슨/.test(t) && !/대회|경기|시합|리그/.test(t)) return '연습';
  if (tourName(t) || /대회|리그|토너먼트|예선|본선|결승|[248]강/.test(t)) return '대회';
  if (/경기|시합|교류전|친선|\bvs\b|VS/i.test(t)) return '경기';
  return '기타';
}
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

// msgs: parseChat().msgs, opts: { since (ts), team } → { events, results, links, notes }
export function extract(msgs, opts = {}) {
  const since = opts.since || 0;
  const events = [], results = [], links = [], notes = [];
  for (const m of msgs) {
    if (m.ts <= since) continue;
    const t = m.text || '';
    if (/^(사진|동영상|이모티콘|파일:|삭제된 메시지입니다)/.test(t.trim()) && t.length < 30) continue;
    for (const u of t.match(URLRE) || []) {
      const host = (u.match(/^https?:\/\/([^/]+)/) || [])[1] || '';
      const video = /youtu\.?be|tv\.naver|tv\.kakao|vimeo/.test(host);
      const news = /news|sports|article|press|times|ilbo|daily|media|basket|kbl|jumpball|rookie|spotv|mk\.co|chosun|joongang|donga|hani|yna|newsis|nocut|ohmy/.test(u);
      if (video || news || HOOPS.test(t)) links.push({ ts: m.ts, who: m.who, url: u, kind: video ? '영상' : '기사', note: clean(t.replace(URLRE, '')).slice(0, 120) });
    }
    if (!HOOPS.test(t)) continue;
    notes.push({ ts: m.ts, who: m.who, text: t });
    const base = new Date(m.ts);
    // 경기 결과 (예: 45:32 승, 우리 32-28 상대, 아산 41 대 30 천안)
    const sc = t.match(/(\d{1,3})\s*(?:[:：]|대|-|ㅡ)\s*(\d{1,3})\s*(?:로\s*)?(승|패|승리|패배|이겼|졌)?/);
    if (sc && (/승|패|이겼|졌|결과|스코어|점수|최종|우승|준우승/.test(t)) && +sc[1] < 200 && +sc[2] < 200 && !/:\d{2}\s*(?:에|까지|부터|시작|집합)/.test(t)) {
      let us = +sc[1], them = +sc[2];
      if (/패|졌/.test(sc[3] || '') && us > them) [us, them] = [them, us];
      if (/승|이겼/.test(sc[3] || '') && us < them) [us, them] = [them, us];
      const opp = (t.match(/(?:vs\.?|VS|상대|대)\s*[:：]?\s*([가-힣A-Za-z0-9]{2,15})/) || [])[1] || '';
      results.push({ ts: m.ts, date: ymdOf(findDate(t, base) || base), us, them, opponent: opp, text: t });
      continue;
    }
    const d = findDate(t, base);
    if (!d) continue;
    const time = findTime(t);
    const place = clean((t.match(PLACE) || t.match(SCHOOL_SHORT) || [])[1]);
    const region = REGIONS.find(r => t.includes(r)) || '';
    const tour = clean(tourName(t));
    const opponent = clean((t.match(/(?:vs\.?|VS)\s*([가-힣A-Za-z0-9]{2,15})/) || t.match(/상대\s*(?:팀)?\s*[:：은는]?\s*([가-힣A-Za-z0-9]{2,15})/) || [])[1]);
    const kind = kindOf(t);
    if (kind === '기타' && !time && !place) continue;
    const firstLine = clean(t.split('\n').find(x => HOOPS.test(x)) || t.split('\n')[0]).slice(0, 60);
    const title = tour ? tour + (opponent ? ` vs ${opponent}` : '') : kind === '연습' ? '농구 연습' : opponent ? `vs ${opponent}` : firstLine;
    events.push({ ts: m.ts, who: m.who, date: ymdOf(d), time, place, region, tour, opponent, kind, title, text: t, sure: !!(time || place) });
  }
  // 같은 날 같은 시간·장소는 하나로 (나중에 온 공지가 이김)
  const seen = new Map();
  for (const e of events) {
    const k = e.date + '|' + (e.time || '') + '|' + (e.kind === '연습' ? '연습' : '');
    const p = seen.get(k);
    if (!p) { seen.set(k, e); continue; }
    seen.set(k, { ...p, ...Object.fromEntries(Object.entries(e).filter(([, v]) => v)), text: p.text === e.text ? e.text : p.text + '\n—\n' + e.text });
  }
  return { events: [...seen.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)), results, links, notes };
}
