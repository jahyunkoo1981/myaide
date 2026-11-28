// 설정 › 영수증 학습: 기억한 가게 목록 보기·지우기, 공동 학습 참여
import { h, toast, confirmBox } from '../util.js';
import { prefs } from '../prefs.js';
import * as OL from '../ocrlearn.js';

export function receiptLearnSection() {
  const list = h('div', { class: 'rl-list' });
  const share = h('input', { type: 'checkbox', checked: prefs().ocrShare === true, onchange: async e => { await OL.setShare(e.target.checked); toast(e.target.checked ? '공동 학습에 참여합니다' : '공동 학습 참여를 껐습니다'); } });
  const shareNote = h('span', { class: 'muted', style: { fontSize: '12.5px' } });
  OL.canShare().then(ok => { if (!ok) { share.disabled = true; shareNote.textContent = ' (관리자가 아직 공동 학습을 열지 않았습니다)'; } });
  async function draw() {
    const m = await OL.mine();
    const seen = new Set(), rows = [];
    for (const [k, v] of Object.entries(m.stores || {})) { if (seen.has(v.name)) continue; seen.add(v.name); rows.push([k, v]); }
    rows.sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    const conf = Object.entries(m.conf || {});
    list.replaceChildren(...(rows.length ? [h('table', { class: 'data rl-table' },
      h('thead', null, h('tr', null, ...['가게', '항목', '합계 줄', '횟수', ''].map(t => h('th', null, t)))),
      h('tbody', null, ...rows.slice(0, 200).map(([k, v]) => h('tr', null, h('td', null, v.name), h('td', null, v.cat || ''), h('td', { class: 'muted' }, v.totalKey || ''), h('td', { class: 'num' }, String(v.n || 1)),
        h('td', null, h('button', { class: 'btn small ghost', onclick: async () => { await OL.forget(k); draw(); } }, '지우기'))))))]
      : [h('p', { class: 'hint', style: { margin: 0 } }, '아직 기억한 것이 없습니다. 영수증을 찍고 가게 이름·항목·금액을 고쳐 저장하면 여기에 쌓입니다.')]),
      conf.length ? h('p', { class: 'hint', style: { margin: 0 } }, '숫자 오인식 바로잡기: ' + conf.map(([k, n]) => `${k.replace('>', '→')} (${n}번)`).join(', ')) : null);
  }
  draw();
  return h('section', null, h('h2', null, '영수증 학습'),
    h('p', { class: 'hint', style: { margin: 0 } }, '영수증을 저장할 때 고친 가게 이름·항목·합계 금액을 기억해서 다음부터 자동으로 맞춥니다. 내 Google Drive에 저장되어 폰·PC에서 같이 씁니다.'),
    list,
    h('label', { class: 'check' }, share, '영수증 인식 공동 학습에 참여', shareNote),
    h('p', { class: 'hint', style: { margin: 0 } }, '참여하면 고친 가게 이름·항목·합계 줄 이름만 익명으로 관리자에게 보냅니다. 사진·금액·날짜·이메일은 보내지 않습니다. 모인 규칙은 관리자가 확인한 뒤 모든 사용자에게 적용됩니다.'),
    h('div', { class: 'row' }, h('button', { class: 'btn small ghost danger', onclick: async () => { if (await confirmBox('기억한 영수증 규칙을 모두 지울까요?', '모두 지우기', true)) { await OL.forgetAll(); draw(); } } }, '모두 지우기')));
}
