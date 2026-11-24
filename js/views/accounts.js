import { h, uid, dialog, confirmBox, copyText, toast } from '../util.js';
import * as db from '../db.js';
import * as vault from '../vault.js';
import * as sync from '../sync.js';
import { native } from '../native.js';

export async function mount(root) {
  const head = h('div', { class: 'view-head' }, h('h1', null, '계정정보'));
  const body = h('div', { class: 'pad' });
  root.append(head, body);
  let armedId = null;

  const draw = async () => {
    if (!await vault.exists()) {
      // Make sure another device hasn't already created the vault before starting a new one.
      await sync.syncNow().catch(() => {});
    }
    if (!await vault.exists()) return drawCreate();
    if (!vault.isOpen()) return drawUnlock();
    drawTiles();
  };

  function drawCreate() {
    const pw = h('input', { type: 'password', autocomplete: 'new-password' });
    const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const err = h('p', { class: 'error' });
    head.replaceChildren(h('h1', null, '계정정보'));
    body.replaceChildren(h('div', { class: 'gate-card', style: { maxWidth: '460px' } },
      h('h2', { style: { margin: 0 } }, '계정 금고 만들기'),
      h('p', { class: 'muted', style: { margin: 0 } }, '아이디와 비밀번호는 이 금고 암호로 암호화된 뒤 저장됩니다. Google Drive에도 암호화된 내용만 올라갑니다. 금고 암호를 잊으면 저장한 계정정보를 되살릴 수 없습니다.'),
      h('label', { class: 'field' }, '금고 암호 (8자 이상)', pw), h('label', { class: 'field' }, '한 번 더', pw2), err,
      h('button', { class: 'btn primary', onclick: async () => {
        if (pw.value !== pw2.value) { err.textContent = '두 암호가 다릅니다.'; return; }
        try { await vault.create(pw.value); draw(); } catch (e) { err.textContent = e.message; }
      } }, '금고 만들기')));
    pw.focus();
  }

  function drawUnlock() {
    const pw = h('input', { type: 'password', autocomplete: 'current-password' });
    const err = h('p', { class: 'error' });
    const go = async () => { err.textContent = '확인 중…'; try { await vault.unlock(pw.value); draw(); } catch (e) { err.textContent = e.message; pw.select(); } };
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    head.replaceChildren(h('h1', null, '계정정보'));
    body.replaceChildren(h('div', { class: 'gate-card', style: { maxWidth: '420px' } },
      h('h2', { style: { margin: 0 } }, '금고가 잠겨 있습니다'),
      h('label', { class: 'field' }, '금고 암호', pw), err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: go }, '열기')),
      h('p', { class: 'hint' }, '암호를 잊었다면 설정 › 금고 암호에서 초기화할 수 있습니다. 초기화하면 저장한 계정정보는 지워집니다.')));
    pw.focus();
  }

  async function drawTiles() {
    const rows = await db.all('accounts');
    const items = [];
    for (const r of rows) { try { items.push({ id: r.id, ...(await vault.open(r.box)) }); } catch { items.push({ id: r.id, name: '(열 수 없는 항목)', broken: true }); } }
    items.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
    const search = h('input', { type: 'search', placeholder: '계정 검색', style: { maxWidth: '260px' } });
    head.replaceChildren(h('h1', null, '계정정보'), search,
      h('button', { class: 'btn small', onclick: () => { vault.lock(); } }, '잠그기'),
      h('button', { class: 'btn small primary', onclick: () => edit(null) }, '+ 계정 추가'));
    const grid = h('div', { class: 'tiles' });
    const hint = native.available
      ? h('p', { class: 'hint', style: { marginBottom: '14px' } }, '타일에서 ‘자동 입력’을 누른 뒤, 로그인 화면의 칸을 클릭하고 ', h('span', { class: 'kbd' }, 'Ctrl+Shift+F7'), ' 아이디, ', h('span', { class: 'kbd' }, 'Ctrl+Shift+F8'), ' 비밀번호를 입력합니다. 2분 뒤 자동으로 해제됩니다.')
      : h('p', { class: 'hint', style: { marginBottom: '14px' } }, '단축키 자동 입력과 프로그램 실행은 Windows 앱에서 쓸 수 있습니다.');
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const shown = items.filter(i => !q || [i.name, i.user, i.url, i.memo].some(v => (v || '').toLowerCase().includes(q)));
      grid.replaceChildren(...(shown.length ? shown.map(tile) : [h('div', { class: 'empty' }, h('b', null, q ? '찾는 계정이 없습니다' : '저장한 계정이 없습니다'), q ? '' : '‘+ 계정 추가’로 자주 쓰는 사이트와 프로그램 계정을 모아 두세요.')]));
    };
    search.addEventListener('input', render);
    body.replaceChildren(hint, grid);
    render();
  }

  const tile = a => h('div', { class: 'tile' },
    h('div', { class: 'name' }, h('span', { class: 'fav' }, (a.name || '?').slice(0, 1).toUpperCase()), a.name || '이름 없음', armedId === a.id ? h('span', { class: 'today', style: { background: 'var(--marker)', fontSize: '12px', padding: '0 6px', borderRadius: '3px' } }, '입력 준비됨') : null),
    a.user ? h('div', { class: 'user' }, a.user) : null,
    a.memo ? h('div', { class: 'muted', style: { fontSize: '13px' } }, a.memo) : null,
    h('div', { class: 'acts' },
      a.url ? h('button', { class: 'btn small', onclick: () => window.open(a.url, '_blank', 'noopener') }, '사이트 열기') : null,
      a.program && native.available ? h('button', { class: 'btn small', onclick: () => native.call('shell.run', { path: a.program }).catch(e => toast(e.message, 'err')) }, '프로그램 실행') : null,
      a.user ? h('button', { class: 'btn small', onclick: () => copyText(a.user, '아이디를 복사했습니다') }, '아이디 복사') : null,
      a.password ? h('button', { class: 'btn small', onclick: () => { copyText(a.password, '비밀번호를 복사했습니다 (30초 뒤 지워짐)'); clearLater(a.password); } }, '비밀번호 복사') : null,
      native.available && (a.user || a.password) ? h('button', { class: 'btn small', onclick: async () => {
        try { await native.call('accounts.arm', { user: a.user || '', password: a.password || '' }); armedId = a.id; toast('자동 입력 준비 · 로그인 칸 클릭 후 Ctrl+Shift+F7 / F8'); drawTiles(); setTimeout(() => { if (armedId === a.id) { armedId = null; drawTiles(); } }, 120000); }
        catch (e) { toast(e.message, 'err'); }
      } }, '자동 입력') : null,
      h('button', { class: 'btn small ghost', onclick: () => edit(a) }, '편집')));

  const clearLater = pw => setTimeout(async () => {
    try { if (await navigator.clipboard.readText() === pw) await navigator.clipboard.writeText(''); } catch {}
  }, 30000);

  async function edit(a) {
    const f = { name: '', user: '', password: '', url: '', program: '', memo: '', ...(a || {}) };
    const name = h('input', { type: 'text', value: f.name, placeholder: '예: SAP, 사내 메일, 네이버' });
    const user = h('input', { type: 'text', value: f.user, autocomplete: 'off' });
    const pw = h('input', { type: 'password', value: f.password, autocomplete: 'new-password' });
    const show = h('button', { class: 'btn small', type: 'button', onclick: () => { pw.type = pw.type === 'password' ? 'text' : 'password'; show.textContent = pw.type === 'password' ? '보기' : '숨기기'; } }, '보기');
    const url = h('input', { type: 'url', value: f.url, placeholder: 'https://' });
    const program = h('input', { type: 'text', value: f.program, placeholder: 'C:\\Program Files\\…\\app.exe 또는 바로가기(.lnk)' });
    const pick = native.available ? h('button', { class: 'btn small', type: 'button', onclick: async () => { const p = await native.call('shell.pickProgram').catch(() => null); if (p) program.value = p; } }, '찾아보기') : null;
    const memo = h('textarea', { rows: 2 }, f.memo);
    const err = h('p', { class: 'error' });
    const r = await dialog({
      title: a ? '계정 편집' : '계정 추가',
      body: [h('label', { class: 'field' }, '이름', name), h('label', { class: 'field' }, '아이디 또는 이메일', user),
        h('label', { class: 'field' }, '비밀번호', h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, pw, show)),
        h('label', { class: 'field' }, '웹사이트 주소 (선택)', url),
        h('label', { class: 'field' }, '프로그램 또는 바로가기 (선택, Windows 앱)', h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, program, pick)),
        h('label', { class: 'field' }, '참고 메모', memo), err],
      onOpen: () => name.focus(),
      actions: [
        a ? { label: '삭제', kind: 'danger', run: async close => { if (await confirmBox(`‘${f.name}’ 계정을 삭제할까요?`, '삭제', true)) { await db.remove('accounts', a.id); close('x'); } return false; } } : null,
        { label: '취소' },
        { label: '저장', kind: 'primary', value: 'ok', run: async () => {
          if (!name.value.trim()) { err.textContent = '이름을 입력해 주세요.'; return false; }
          let u = url.value.trim(); if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
          await db.put('accounts', a ? a.id : uid(), { box: await vault.seal({ name: name.value.trim(), user: user.value.trim(), password: pw.value, url: u, program: program.value.trim(), memo: memo.value.trim() }) });
        } }
      ].filter(Boolean)
    });
    if (r === 'ok') toast('저장했습니다');
  }

  const onChange = e => { if (['accounts', 'vault'].includes(e.detail.col) && vault.isOpen()) drawTiles(); };
  const onVault = () => draw();
  db.events.addEventListener('change', onChange);
  vault.vaultEvents.addEventListener('change', onVault);
  await draw();
  return { cleanup: () => { db.events.removeEventListener('change', onChange); vault.vaultEvents.removeEventListener('change', onVault); } };
}
