// 사용자 관리 (관리자 전용): 승인 코드 만들기 · 목록 · 사용 중지/재개.
// 목록은 관리자 본인의 Google Drive('licenses')에만 저장됩니다. 웹에는 중지한 코드 번호만 올라갑니다(이메일 없음).
import { h, toast, dialog, confirmBox, copyText, listItem } from '../util.js';
import * as db from '../db.js';
import * as vault from '../vault.js';
import * as L from '../license.js';
import { unlockVaultPrompt } from '../openai.js';

const COL = 'licenses';

export async function mount(root) {
  const body = h('div', { class: 'pad us', style: { maxWidth: '980px' } });
  root.append(h('div', { class: 'view-head' }, h('h1', null, '사용자 관리')), body);
  if (!await unlockVaultPrompt('사용자 관리는 MY AIDE 비밀번호를 확인한 뒤 열립니다.')) { body.append(h('p', { class: 'hint' }, '비밀번호를 확인하지 않아 열 수 없습니다.')); return; }
  const cfgPub = (window.MYAIDE_CONFIG || {}).adminPublicKey || '';

  async function draw() {
    const key = await L.adminKey();
    // 1) 관리자 키가 아직 없음
    if (!key) {
      if (cfgPub) { body.replaceChildren(h('div', { class: 'empty' }, h('b', null, '관리자만 열 수 있습니다'), '이 계정에는 관리자 키가 없습니다.')); return; }
      body.replaceChildren(h('section', { class: 'us-card' },
        h('h2', null, '처음 한 번: 관리자 키 만들기'),
        h('p', null, '관리자 키로 승인 코드에 서명합니다. 키는 MY AIDE 비밀번호로 암호화되어 내 Google Drive에만 저장되고, 내 다른 기기에서도 같이 쓰입니다.'),
        h('button', { class: 'btn primary', onclick: async () => { await L.createAdminKey(); toast('관리자 키를 만들었습니다'); draw(); } }, '관리자 키 만들기')));
      return;
    }
    const list = (await db.all(COL)).sort((a, b) => (b.t || '').localeCompare(a.t || ''));
    const active = list.filter(x => x.status !== 'revoked').length;
    const email = h('input', { type: 'email', placeholder: '사용할 사람의 Google 이메일' });
    const name = h('input', { type: 'text', placeholder: '이름' });
    const memo = h('input', { type: 'text', placeholder: '메모 (선택, 예: 회사 동료)' });
    const err = h('p', { class: 'error' });
    const add = async () => {
      err.textContent = '';
      const e = email.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { err.textContent = 'Google 이메일을 정확히 넣어 주세요.'; return; }
      if (!name.value.trim()) { err.textContent = '이름을 넣어 주세요.'; return; }
      const old = list.find(x => x.e === e && x.status !== 'revoked');
      if (old && !await confirmBox(`${e}에게는 이미 승인 코드가 있습니다. 새로 만들까요?`, '새로 만들기')) return;
      const lic = await L.issue(e, name.value);
      await db.put(COL, lic.id, { ...lic, memo: memo.value.trim(), status: 'active' });
      showCode(lic); draw();
    };
    body.replaceChildren(
      !cfgPub ? h('section', { class: 'us-card warn' },
        h('h2', null, '마지막 단계: 공개 키를 배포본에 넣기'),
        h('p', null, '아래 공개 키를 Claude에게 보내 주시면 배포본(config.js)에 넣어 드립니다. 공개 키는 비밀이 아닙니다. 넣기 전까지는 승인 확인이 꺼져 있어 누구나 쓸 수 있습니다.'),
        h('div', { class: 'us-code' }, key.pub), h('button', { class: 'btn small', onclick: () => copyText(key.pub, '공개 키를 복사했습니다') }, '공개 키 복사')) : null,
      h('section', { class: 'us-card' },
        h('h2', null, '새 사용자 승인'),
        h('div', { class: 'us-form' }, email, name, memo, h('button', { class: 'btn primary', onclick: add }, '승인 코드 만들기')), err,
        h('p', { class: 'hint', style: { margin: 0 } }, '사용자가 MY AIDE 첫 화면에서 보낸 승인 요청의 이메일을 그대로 넣으세요. 승인 코드는 그 Google 계정에서만 동작합니다.')),
      h('section', { class: 'us-card' },
        h('div', { class: 'row' }, h('h2', { class: 'grow', style: { margin: 0 } }, `사용자 ${active}명`), list.some(x => x.status === 'revoked') ? h('span', { class: 'muted' }, `중지 ${list.length - active}명`) : null),
        list.length ? h('table', { class: 'data us-table' },
          h('thead', null, h('tr', null, ...['이름', 'Google 이메일', '승인일', '메모', '상태', ''].map(t => h('th', null, t)))),
          h('tbody', null, ...list.map(x => h('tr', { class: x.status === 'revoked' ? 'off' : '' },
            h('td', null, x.n), h('td', null, x.e), h('td', null, x.t), h('td', { class: 'muted' }, x.memo || ''),
            h('td', null, x.status === 'revoked' ? h('span', { class: 'us-badge off' }, '중지') : h('span', { class: 'us-badge' }, '사용 중')),
            h('td', { class: 'us-acts' },
              h('button', { class: 'btn small ghost', onclick: () => showCode(x) }, '코드'),
              h('button', { class: 'btn small ghost' + (x.status === 'revoked' ? '' : ' danger'), onclick: () => toggle(x) }, x.status === 'revoked' ? '다시 허용' : '사용 중지')))))) :
          h('p', { class: 'muted' }, '아직 승인한 사용자가 없습니다.')),
      h('section', { class: 'us-card' },
        h('h2', null, '사용 중지 반영 (GitHub)'),
        h('p', { class: 'hint', style: { margin: 0 } }, '사용 중지한 코드 번호를 웹에 올려야 그 사람 앱이 잠깁니다. 이메일은 올라가지 않습니다. GitHub 토큰은 처음 한 번만 넣으면 됩니다.'),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: setToken }, 'GitHub 토큰 넣기·바꾸기'), h('button', { class: 'btn small', onclick: () => publish(true) }, '지금 반영하기'))));
  }

  function showCode(x) {
    const text = `[MY AIDE 승인 코드]\n${x.n}님 (${x.e})\n\nMY AIDE 첫 화면의 '승인 코드 넣기' 칸에 아래 코드를 붙여 넣으세요.\n\n${x.code}`;
    dialog({ title: `${x.n}님 승인 코드`, wide: true, body: [h('div', { class: 'us-code' }, x.code), h('p', { class: 'hint' }, `${x.e} 계정에서만 동작합니다. 카톡이나 메일로 보내 주세요.`)],
      actions: [{ label: '코드만 복사', run: () => { copyText(x.code, '승인 코드를 복사했습니다'); return false; } },
        navigator.share ? { label: '공유', run: async () => { try { await navigator.share({ title: 'MY AIDE 승인 코드', text }); } catch { } return false; } } : null,
        { label: '안내문까지 복사', kind: 'primary', run: () => { copyText(text, '안내문과 코드를 복사했습니다'); return false; } }, { label: '닫기' }].filter(Boolean) });
  }
  async function toggle(x) {
    const off = x.status !== 'revoked';
    if (off && !await confirmBox(`${x.n}님(${x.e})의 사용을 중지할까요? 그 사람 앱이 다음에 인터넷에 연결될 때 잠깁니다. 기록은 그 사람 Drive에 남습니다.`, '사용 중지', true)) return;
    const { id, updatedAt, ...d } = x;
    await db.put(COL, id, { ...d, status: off ? 'revoked' : 'active' });
    await draw(); await publish(false);
  }
  async function publish(manual) {
    const ids = (await db.all(COL)).filter(x => x.status === 'revoked').map(x => x.id);
    try { await L.publishRevoked(ids); toast('사용 중지 목록을 웹에 반영했습니다 (1~2분 뒤 적용)'); }
    catch (e) {
      if (e.needToken) { if (manual || await confirmBox('사용 중지를 웹에 반영하려면 GitHub 토큰이 필요합니다. 지금 넣을까요?', '토큰 넣기')) { if (await setToken()) publish(true); } }
      else toast(e.message, 'err');
    }
  }
  async function setToken() {
    const input = h('input', { type: 'password', placeholder: 'github_pat_… 또는 ghp_…', autocomplete: 'off' });
    const r = await dialog({ title: 'GitHub 토큰', body: [input,
      h('ol', { class: 'hint' },
        h('li', null, 'github.com 로그인 › 오른쪽 위 사진 › Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token'),
        h('li', null, 'Repository access: Only select repositories › myaide 선택'),
        h('li', null, 'Permissions › Repository permissions › Contents: Read and write'),
        h('li', null, '만든 토큰을 여기에 붙여 넣기 (MY AIDE 비밀번호로 암호화되어 저장)'))],
      onOpen: () => input.focus(), actions: [{ label: '취소' }, { label: '저장', kind: 'primary', value: 'ok' }] });
    if (r !== 'ok' || !input.value.trim()) return false;
    await vault.setSecret('github', input.value.trim()); toast('GitHub 토큰을 저장했습니다'); return true;
  }
  draw();
  return {};
}
