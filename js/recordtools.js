// AIDE가 답하는 동안 AI가 MY AIDE 기록을 직접 찾아 읽는 도구들.
// 계정정보(비밀번호)·API 키·설정은 대상이 아니며, 'AI 제외'로 표시한 글은 빠집니다.
// 도구가 돌려준 내용도 보내기 전에 AI 정보 보호(가리기) 규칙이 똑같이 적용됩니다 (openai.js chatTools).
import * as db from './db.js';
import { plain, ymd, today } from './util.js';
import { occurrences } from './views/schedule.js';

const day = t => t ? ymd(new Date(t)) : '';
const treeText = (n, d = 0) => n ? '  '.repeat(d) + '- ' + (n.text || '') + '\n' + (n.children || []).map(c => treeText(c, d + 1)).join('') : '';
const won = n => (Math.round(Number(n) || 0)).toLocaleString('ko-KR') + '원';

export const KINDS = {
  journal: { label: '업무일지', date: r => r.id, title: r => `${r.id} 업무일지`, text: r => plain(r.body || '') },
  notes: { label: '업무메모', date: r => r.date || day(r.updatedAt), title: r => r.title || '제목 없음', text: r => plain(r.body || '') },
  knowledge: { label: '지식노트', date: r => day(r.updatedAt), title: r => r.title || '제목 없음', text: r => r.md || '' },
  meetings: { label: '회의록', date: r => r.date, title: r => r.title || '제목 없는 회의', text: r => [r.summary && '요약:\n' + r.summary, r.transcript && '녹취:\n' + r.transcript].filter(Boolean).join('\n\n') },
  mindmaps: { label: 'AI 마인드맵', date: r => day(r.updatedAt), title: r => r.title || (r.root && r.root.text) || '마인드맵', text: r => treeText(r.root) },
  schedule: { label: '일정', date: r => r.date, title: r => r.title, text: r => [r.calendar === 'lunar' ? '음력' : '', r.yearly ? '매년' : '', r.time || '', r.memo || ''].filter(Boolean).join(' ') },
  ledger: { label: '가계부', date: r => r.date, title: r => `${r.kind === 'in' ? '수입' : '지출'} ${r.cat || ''} ${won(r.amount)}`, text: r => r.memo || '' },
  media: { label: '사진·동영상', date: r => (r.taken || '').slice(0, 10) || day(r.updatedAt), title: r => r.name || '사진', text: r => [r.folder, (r.themes || []).join(' '), r.aiDesc, (r.aiTags || []).join(' '), r.memo, r.place].filter(Boolean).join(' / ') },
  code: { label: 'VisualCode 파일', date: r => day(r.updatedAt), title: r => r.path || r.id, text: r => r.content || '' },
  milestones: { label: '마일스톤', date: r => r.due || day(r.updatedAt), title: r => r.title || '', text: r => [r.stage, r.memo].filter(Boolean).join(' ') }
};
const KIND_KEYS = Object.keys(KINDS);

async function rows(kind) {
  const list = await db.all(kind).catch(() => []);
  return list.filter(r => !r.noAi);
}
const inRange = (d, from, to) => (!from || (d && d >= from)) && (!to || (d && d <= to));
function snippet(text, terms, n = 240) {
  const t = text.replace(/\s+/g, ' ').trim();
  const low = t.toLowerCase();
  let at = -1;
  for (const w of terms) { const i = low.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const s = Math.max(0, (at < 0 ? 0 : at) - 60);
  return (s ? '…' : '') + t.slice(s, s + n) + (t.length > s + n ? '…' : '');
}
// 한국어 조사가 붙어도 찾도록 낱말 끝 1글자를 뗀 형태도 봄 (회의는 → 회의)
const termsOf = q => String(q || '').toLowerCase().split(/[\s,·/]+/).map(w => w.trim()).filter(Boolean)
  .map(w => w.length >= 3 && /[가-힣]$/.test(w) ? [w, w.slice(0, -1)] : [w]);

export const TOOLS = [
  { name: 'search_records', description: '사용자의 MY AIDE 기록 전체에서 낱말로 찾습니다. 종류: ' + KIND_KEYS.map(k => `${k}(${KINDS[k].label})`).join(', ') + '. 기간만 주고 query를 비우면 그 기간의 기록을 날짜순으로 보여 줍니다. 결과는 요약이며, 전체 내용은 read_record로 읽습니다.',
    parameters: { type: 'object', properties: {
      query: { type: 'string', description: '찾을 낱말들 (띄어쓰기로 여러 개). 비워도 됨' },
      kinds: { type: 'array', items: { type: 'string', enum: KIND_KEYS }, description: '찾을 종류. 비우면 전부' },
      from: { type: 'string', description: '시작 날짜 YYYY-MM-DD (선택)' },
      to: { type: 'string', description: '끝 날짜 YYYY-MM-DD (선택)' },
      limit: { type: 'integer', description: '최대 결과 수 (기본 15, 최대 40)' } } } },
  { name: 'get_schedule', description: '일정관리의 일정을 기간으로 가져옵니다. 매년 반복(생일·기념일)과 음력 일정도 그 기간의 실제 날짜로 펼쳐서 줍니다.',
    parameters: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['from', 'to'] } },
  { name: 'read_record', description: 'search_records에서 찾은 기록 하나의 전체 내용을 읽습니다.',
    parameters: { type: 'object', properties: { kind: { type: 'string', enum: KIND_KEYS }, id: { type: 'string' } }, required: ['kind', 'id'] } },
  { name: 'ledger_summary', description: '가계부의 한 달 수입·지출 합계, 항목별 지출, 지난달 비교, 그 달의 내역을 줍니다.',
    parameters: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' } }, required: ['month'] } },
  { name: 'count_records', description: '종류별 기록 개수와 가장 오래된·최근 날짜를 알려 줍니다. 무엇이 얼마나 있는지 모를 때 먼저 씁니다.',
    parameters: { type: 'object', properties: {} } }
];

// 화면에 보여 줄 짧은 설명 ("일정 2026-08-01~2026-08-31")
export function describeCall(name, a = {}) {
  if (name === 'search_records') return `${(a.kinds || []).map(k => KINDS[k]?.label || k).join('·') || '전체 기록'} 검색${a.query ? ` ‘${a.query}’` : ''}${a.from || a.to ? ` (${a.from || ''}~${a.to || ''})` : ''}`;
  if (name === 'get_schedule') return `일정 ${a.from}~${a.to}`;
  if (name === 'read_record') return `${KINDS[a.kind]?.label || a.kind} 읽기`;
  if (name === 'ledger_summary') return `가계부 ${a.month}`;
  if (name === 'count_records') return '기록 개수 확인';
  return name;
}

export async function runTool(name, a = {}) {
  if (name === 'count_records') {
    const out = {};
    for (const k of KIND_KEYS) { const r = await rows(k); const ds = r.map(x => KINDS[k].date(x)).filter(Boolean).sort(); out[k] = { label: KINDS[k].label, count: r.length, oldest: ds[0] || null, newest: ds[ds.length - 1] || null }; }
    return { today: today(), records: out };
  }
  if (name === 'get_schedule') {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(a.from || '') ? a.from : today(), to = /^\d{4}-\d{2}-\d{2}$/.test(a.to || '') ? a.to : from;
    const list = occurrences(await rows('schedule'), from, to);
    return { from, to, count: list.length, events: list.slice(0, 300).map(o => ({ date: o.on, time: o.time || '', title: o.title, memo: o.memo || o.ev?.memo || undefined })) };
  }
  if (name === 'ledger_summary') {
    const { monthSummary } = await import('./views/ledger.js');
    const m = /^\d{4}-\d{2}$/.test(a.month || '') ? a.month : today().slice(0, 7);
    const s = await monthSummary(m);
    return { month: m, income: s.income, expense: s.expense, prevIncome: s.prevIncome, prevExpense: s.prevExpense, budget: s.budget || undefined,
      byCategory: Object.fromEntries([...s.cats.entries()].sort((x, y) => y[1] - x[1])),
      entries: s.entries.filter(e => !e.noAi).slice(0, 150).map(e => ({ date: e.date, kind: e.kind === 'in' ? '수입' : '지출', cat: e.cat, amount: e.amount, memo: e.memo || undefined })) };
  }
  if (name === 'read_record') {
    const K = KINDS[a.kind]; if (!K) return { error: '알 수 없는 종류' };
    const r = await db.get(a.kind, String(a.id)); if (!r || r.noAi) return { error: '기록이 없거나 AI 제외로 표시된 글입니다.' };
    const text = K.text(r);
    return { kind: a.kind, id: r.id, date: K.date(r), title: K.title(r), text: text.slice(0, 12000), truncated: text.length > 12000 || undefined };
  }
  if (name === 'search_records') {
    const kinds = (a.kinds && a.kinds.length ? a.kinds : KIND_KEYS).filter(k => KINDS[k]);
    const terms = termsOf(a.query), limit = Math.min(40, Math.max(1, Number(a.limit) || 15));
    const hits = [];
    for (const k of kinds) {
      const K = KINDS[k];
      for (const r of await rows(k)) {
        const d = K.date(r);
        if (!inRange(d, a.from, a.to)) continue;
        const title = K.title(r), text = K.text(r), hay = (title + '\n' + text).toLowerCase();
        let score = 0;
        if (terms.length) {
          for (const alts of terms) { const w = alts.find(x => hay.includes(x)); if (!w) continue; score += 2 + Math.min(5, hay.split(w).length - 2) + (title.toLowerCase().includes(w) ? 3 : 0); }
          if (!score) continue;
        }
        hits.push({ kind: k, label: K.label, id: r.id, date: d, title, snippet: snippet(text, terms.flat()), score });
      }
    }
    hits.sort((x, y) => (y.score - x.score) || String(y.date).localeCompare(String(x.date)));
    return { query: a.query || '', total: hits.length, results: hits.slice(0, limit).map(({ score, ...x }) => x), more: hits.length > limit || undefined };
  }
  return { error: '알 수 없는 도구' };
}
