// 사용자 관리 (관리자 전용): 승인 코드 만들기 · 목록 · 사용 중지/재개.
// 목록은 관리자 본인의 Google Drive('licenses')에만 저장됩니다. 웹에는 중지한 코드 번호만 올라갑니다(이메일 없음).
import { h, toast, dialog, confirmBox, copyText, listItem } from '../util.js';
import * as db from '../db.js';
import * as vault from '../vault.js';
import * as L from '../license.js';
import { unlockVaultPrompt } from '../openai.js';

const COL = 'licenses';
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

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
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: setToken }, 'GitHub 토큰 넣기·바꾸기'), h('button', { class: 'btn small', onclick: () => publish(true) }, '지금 반영하기'))),
      await communityCard());
  }

  // ---------- 영수증 공동 학습 ----------
  async function communityCard() {
    const cfg = (await db.get('settings', 'communityAdmin').catch(() => null)) || {};
    const pre = h('input', { type: 'url', value: cfg.prefilled || '', placeholder: 'https://docs.google.com/forms/d/e/…/viewform?usp=pp_url&entry.123…' });
    const csv = h('input', { type: 'url', value: cfg.csvUrl || '', placeholder: 'https://docs.google.com/spreadsheets/d/e/…/pub?output=csv' });
    const out = h('div', { class: 'us-review' });
    const fileIn = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: async e => { const f = e.target.files[0]; e.target.value = ''; if (f) review(await f.text()); } });
    const connect = async () => {
      const m = /forms\/d\/e\/([^/]+)\/viewform[^#]*?[?&](entry\.\d+)=/.exec(pre.value);
      if (!m) { toast('미리 채운 링크에서 설문지 주소를 찾지 못했습니다. 4단계의 링크를 그대로 붙여 넣어 주세요.', 'err'); return; }
      const { id, updatedAt, ...rest } = cfg;
      await db.put('settings', 'communityAdmin', { ...rest, prefilled: pre.value.trim(), csvUrl: csv.value.trim() });
      try { await L.publishJson('community.json', { formAction: `https://docs.google.com/forms/d/e/${m[1]}/formResponse`, entry: m[2] }, 'MY AIDE: 공동 학습 설문지 연결'); toast('공동 학습을 열었습니다. 사용자 앱에 1~2분 뒤 반영됩니다'); }
      catch (e) { if (e.needToken && await setToken()) connect(); else if (!e.needToken) toast(e.message, 'err'); }
    };
    const load = async () => {
      if (!csv.value.trim()) { fileIn.click(); return; }
      try { const r = await fetch(csv.value.trim() + (csv.value.includes('?') ? '&' : '?') + 't=' + Date.now()); if (!r.ok) throw new Error(r.status); review(await r.text()); }
      catch { toast('시트를 바로 읽지 못했습니다. 시트에서 CSV로 내려받아 파일로 넣어 주세요.', 'err'); fileIn.click(); }
    };
    async function review(text) {
      const rows = parseCsv(text).slice(1).map(r => { try { return JSON.parse(r[r.length - 1]); } catch { return null; } }).filter(x => x && x.name);
      const { norm } = await import('../ocrlearn.js');
      const groups = new Map();
      for (const r of rows) {
        const k = norm(r.name); const g = groups.get(k) || { names: {}, from: new Set(), cat: {}, tk: {}, n: 0 };
        g.n++; g.names[r.name] = (g.names[r.name] || 0) + 1; if (r.from) g.from.add(r.from);
        if (r.cat) g.cat[r.cat] = (g.cat[r.cat] || 0) + 1; if (r.tk) g.tk[r.tk] = (g.tk[r.tk] || 0) + 1;
        groups.set(k, g);
      }
      const confVotes = {}; rows.forEach(r => (r.cf || []).forEach(([a, b]) => { confVotes[a + '>' + b] = (confVotes[a + '>' + b] || 0) + 1; }));
      const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0];
      const items = [...groups.entries()].map(([k, g]) => ({ k, name: top(g.names)[0], from: [...g.from], cat: top(g.cat), tk: top(g.tk), n: g.n })).sort((a, b) => b.n - a.n);
      const checks = items.map(it => h('input', { type: 'checkbox', checked: it.n >= 2 }));
      const confChecks = Object.entries(confVotes).map(([k, n]) => [k, n, h('input', { type: 'checkbox', checked: n >= 2 })]);
      out.replaceChildren(...[h('p', { class: 'hint', style: { margin: 0 } }, `모인 의견 ${rows.length}건 · 가게 ${items.length}곳. 두 명 이상이 같은 내용을 보낸 것은 미리 골라 두었습니다.`),
        items.length ? h('table', { class: 'data us-table' }, h('thead', null, h('tr', null, ...['', '가게', '잘못 읽힌 글자', '항목', '합계 줄', '건수'].map(t => h('th', null, t)))),
          h('tbody', null, ...items.map((it, i) => h('tr', null, h('td', null, checks[i]), h('td', null, it.name), h('td', { class: 'muted' }, it.from.slice(0, 3).join(', ')),
            h('td', null, it.cat ? `${it.cat[0]} (${it.cat[1]})` : ''), h('td', null, it.tk ? `${it.tk[0]} (${it.tk[1]})` : ''), h('td', { class: 'num' }, String(it.n)))))) : null,
        confChecks.length ? h('div', { class: 'row' }, '숫자 오인식:', ...confChecks.map(([k, n, c]) => h('label', { class: 'check' }, c, `${k.replace('>', '→')} (${n})`))) : null,
        items.length || confChecks.length ? h('button', { class: 'btn primary', onclick: async () => {
          const stores = {}, keys = new Set();
          items.forEach((it, i) => { if (!checks[i].checked) return; const v = { name: it.name, ...(it.cat ? { cat: it.cat[0] } : {}), ...(it.tk ? { totalKey: it.tk[0] } : {}) };
            stores[it.k] = v; it.from.forEach(f => { stores[norm(f)] = v; }); if (it.tk) keys.add(it.tk[0]); });
          const conf = confChecks.filter(([, , c]) => c.checked).map(([k]) => k.split('>'));
          try { await L.publishJson('ocr-rules.json', { v: 1, updated: new Date().toISOString(), stores, totalKeys: [...keys], conf }, 'MY AIDE: 영수증 공통 규칙 갱신'); toast(`공통 규칙 ${Object.keys(stores).length}개를 모든 사용자에게 올렸습니다`); }
          catch (e) { if (e.needToken) { if (await setToken()) toast('토큰을 저장했습니다. 다시 눌러 주세요'); } else toast(e.message, 'err'); }
        } }, '고른 규칙을 모든 사용자에게 적용') : null].filter(Boolean));
    }
    return h('section', { class: 'us-card' },
      h('h2', null, '영수증 공동 학습'),
      h('p', { class: 'hint', style: { margin: 0 } }, '참여에 동의한 사용자가 고친 가게 이름·항목·합계 줄 이름이 익명으로 내 Google 설문지에 모입니다. 여기서 훑어보고 고른 것만 모든 사용자에게 적용합니다.'),
      h('details', { open: !cfg.prefilled }, h('summary', null, '처음 한 번: 설문지 연결하기'),
        h('ol', { class: 'hint' },
          h('li', null, h('a', { href: 'https://forms.new', target: '_blank', rel: 'noopener' }, 'forms.new'), '에서 새 설문지를 만들고 제목을 “MY AIDE 영수증 학습”으로 정합니다.'),
          h('li', null, '질문을 하나만 두고 종류를 ‘장문형’으로 바꿉니다. 설정에서 ‘이메일 주소 수집’은 끕니다.'),
          h('li', null, '응답 탭 › ‘스프레드시트에 연결’을 누르고, 열린 시트에서 파일 › 공유 › 웹에 게시 › 쉼표로 구분된 값(.csv) › 게시 → 나온 주소를 아래 두 번째 칸에 넣습니다.'),
          h('li', null, '설문지 오른쪽 위 ⋮ › ‘미리 채워진 링크 가져오기’에서 답 칸에 아무 글자(예: test)를 넣고 ‘링크 가져오기’ → 복사한 링크를 아래 첫 번째 칸에 넣습니다.')),
        h('label', { class: 'field' }, '미리 채운 링크', pre), h('label', { class: 'field' }, '응답 시트 CSV 주소', csv),
        h('button', { class: 'btn small primary', onclick: connect }, '연결하고 사용자에게 열기')),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: load }, '모인 의견 불러오기'), fileIn), out);
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
