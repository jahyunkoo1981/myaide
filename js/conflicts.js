// "동기화 확인 필요" dialog: shows each clashing record side by side and applies only what the user confirms.
import { h, dialog, plain, fmtTime, toast } from './util.js';
import * as sync from './sync.js';

const NAMES = {
  journal: '업무일지', notes: '업무메모', aimd: 'AIMD', knowledge: '지식노트', schedule: '일정', milestones: '마일스톤',
  ledger: '가계부', ledgerCats: '가계부 항목', accounts: '계정정보', meetings: '회의록', settings: '설정', vault: '금고', secrets: '금고 비밀값', chats: 'AIDE 대화'
};
const DOCS = new Set(['journal', 'notes', 'aimd', 'knowledge', 'meetings']);

function summary(col, data, deleted) {
  if (deleted || !data) return '(삭제됨)';
  if (col === 'accounts' || col === 'secrets' || col === 'vault') return '(암호화된 내용)';
  const title = data.title || data.name || data.date || '';
  const body = data.body != null ? plain(data.body) : data.md != null ? data.md : data.summary || data.memo || '';
  const extra = data.amount != null ? ` ${Number(data.amount).toLocaleString('ko-KR')}원` : '';
  return (title ? title + extra + '\n' : extra ? extra + '\n' : '') + String(body).slice(0, 400);
}

function merge(col, mine, theirs) {
  if (!DOCS.has(col) || !mine || !theirs) return null;
  if (mine.body != null && theirs.body != null)
    return { ...theirs, body: theirs.body + '<hr><p><b>다른 기기에서 쓴 내용</b></p>' + mine.body };
  if (mine.md != null && theirs.md != null) return { ...theirs, md: theirs.md + '\n\n---\n\n' + mine.md };
  if (mine.summary != null) return { ...theirs, summary: [theirs.summary, mine.summary].filter(Boolean).join('\n\n---\n\n') };
  return null;
}

export async function showConflicts() {
  const list = await sync.conflicts();
  if (!list.length) { toast('확인할 동기화 충돌이 없습니다.'); return; }
  const body = h('div', { style: { display: 'grid', gap: '12px' } },
    h('p', { class: 'hint', style: { margin: 0 } },
      '이 기기에서 오프라인으로 고친 기록을 다른 기기에서도 먼저 고쳤습니다. 어느 쪽을 반영할지 골라 주세요. 고르기 전까지는 두 내용이 모두 보관됩니다.'));
  const render = async () => {
    const items = await sync.conflicts();
    body.querySelectorAll('.conflict').forEach(n => n.remove());
    if (!items.length) { body.append(h('p', { class: 'conflict', style: { border: 0 } }, '모두 정리했습니다.')); return; }
    for (const r of items) {
      const merged = merge(r.col, r.data, r.conflict.data);
      const act = async (choice) => { await sync.resolve(r.key, choice, merged); toast('반영했습니다'); render(); };
      body.append(h('div', { class: 'conflict' },
        h('b', null, (NAMES[r.col] || r.col) + ' · ' + (r.data?.title || r.data?.name || r.data?.date || r.conflict.data?.title || r.id)),
        h('div', { class: 'sides' },
          h('div', { class: 'side' }, h('b', null, '이 기기 · ' + fmtTime(r.updatedAt)), summary(r.col, r.data, r.deleted)),
          h('div', { class: 'side' }, h('b', null, '다른 기기 · ' + fmtTime(r.conflict.updatedAt)), summary(r.col, r.conflict.data, r.conflict.deleted))),
        h('div', { class: 'row' },
          h('button', { class: 'btn small primary', onclick: () => act('mine') }, '이 기기 내용으로 반영'),
          h('button', { class: 'btn small', onclick: () => act('theirs') }, '다른 기기 내용 유지'),
          merged ? h('button', { class: 'btn small', onclick: () => act('both') }, '둘 다 합치기') : null)));
    }
  };
  await render();
  await dialog({ title: '동기화 확인 필요', body, wide: true, actions: [{ label: '나중에 확인' }] });
}
