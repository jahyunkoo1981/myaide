import { h, icon, toast, dialog, $, fmtTime } from './util.js';
import { applyTheme } from './theme.js';
applyTheme();
import * as db from './db.js';
import * as sync from './sync.js';
import { auth, clientId, setClientId } from './auth.js';
import { DriveBackend, LocalFolderBackend } from './backends.js';
import { native } from './native.js';
import { TABS, FIXED, GROUPS, MOBILE_FAVORITES, groupOf, load as loadPrefs, prefs, prefsEvents } from './prefs.js';
import { showConflicts } from './conflicts.js';
import * as vault from './vault.js';

const VIEWS = {
  journal: () => import('./views/journal.js'),
  notes: () => import('./views/docs.js'),
  aimd: () => import('./views/code.js'),
  devtools: () => import('./views/devtools.js'),
  masker: () => import('./views/masker.js'),
  users: () => import('./views/users.js'),
  home: () => import('./views/home.js'),
  feedback: () => import('./views/feedback.js'),
  knowledge: () => import('./views/knowledge.js'),
  schedule: () => import('./views/schedule.js'),
  mindmap: () => import('./views/mindmap.js'),
  media: () => import('./views/media.js'),
  milestones: () => import('./views/milestones.js'),
  widgets: () => import('./views/widgets.js'),
  ledger: () => import('./views/ledger.js'),
  accounts: () => import('./views/accounts.js'),
  meetings: () => import('./views/meetings.js'),
  aide: () => import('./views/aide.js'),
  search: () => import('./views/search.js'),
  remote: () => import('./views/remote.js'),
  backup: () => import('./views/backup.js'),
  settings: () => import('./views/settings.js'),
  manual: () => import('./views/manual.js')
};
const ALIASES = { files: 'search' };
const LOCK_AFTER_MS = 30 * 60 * 1000;   // lock again after 30 minutes in the background

const app = document.getElementById('app');
let current = { key: null, cleanup: null };
let mode = null;

// ---------- boot ----------
async function boot() {
  const widgetKey = new URLSearchParams(location.search).get('widget');
  if (widgetKey && native.available) return bootWidget(widgetKey);
  auth.takeRedirect();
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !native.available)
    navigator.serviceWorker.register('sw.js').catch(() => {});

  mode = await db.kvGet('mode');
  if (!mode) mode = await setupGate();

  await loadPrefs();
  const backend = mode === 'local' ? new LocalFolderBackend() : new DriveBackend(() => auth.token());
  sync.useBackend(backend);

  if (mode === 'drive' && !native.available && !auth.hasToken() && auth.canTrySilent() && !sessionStorage.getItem('myaide.reset')) {
    await auth.signIn({ silent: true });   // quick round trip to Google; comes back to this page
  }

  await passwordGate();
  await licenseGate();
  // a recording cut off by a power-off / closed window goes back into 회의록
  if (native.available) import('./naver.js').then(m => m.startAutoSync()).catch(() => {});   // 네이버 캘린더 (Windows 앱)
  import('./recorder.js').then(m => m.recoverAtStart(sec => toast(`끊겼던 녹음 ${Math.floor(sec / 60)}분 ${sec % 60}초를 회의록에 복구했습니다`))).catch(() => {});
  shareSession();
  renderShell();
  sync.counts();
  sync.syncNow().catch(() => {});
  setInterval(() => { if (document.visibilityState === 'visible') sync.syncNow().catch(() => {}); }, 60000);
  let hiddenAt = 0;
  let autoLogin = !!(await db.kvGet('auto-login'));
  vault.vaultEvents.addEventListener('change', async () => { autoLogin = !!(await db.kvGet('auto-login')); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && !vault.autoUnlocked && !autoLogin) lockNow();
    else {
      // web: a Google token lasts an hour — on coming back, renew it quietly so the phone stays connected
      if (mode === 'drive' && !native.available && !auth.hasToken() && auth.canTrySilent()) { auth.signIn({ silent: true }); return; }
      sync.schedule(200);
    }
  });
  window.addEventListener('hashchange', route);
  route();
  if (native.available) {
    const pushPref = () => native.call('app.capturePref', { allScreens: !!prefs().capture.allScreens }).catch(() => {});
    pushPref(); prefsEvents.addEventListener('change', pushPref);
    native.on('navigate', d => { location.hash = '#/' + d.view + (d.param ? '/' + encodeURIComponent(d.param) : ''); });
    native.on('capture', d => import('./capture.js').then(m => m.openCapture(d)));
  }
  maybeAutoBackup();
  setTimeout(() => import('./views/onboarding.js').then(m => m.maybeOnboard()).catch(() => {}), 800);   // 처음 쓰는 사람 안내
  if (native.available) setTimeout(checkUpdate, 8000);
}

// Windows 앱: 새 배포본이 있으면 알림 (웹앱은 서비스 워커가 알아서 새로 받음)
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkUpdate() {
  try {
    const C = window.MYAIDE_CONFIG || {};
    const r = await fetch((C.publicUrl || '') + 'version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const v = await r.json(), me = await native.call('app.version');
    if (!v.version || !newer(v.version, me.version) || localStorage.getItem('myaide.skipVersion') === v.version) return;
    const a = await dialog({ title: `새 버전 ${v.version}이 나왔습니다`, body: [h('p', { style: { margin: 0 } }, v.notes || ''), h('p', { class: 'hint' }, `지금 버전 ${me.version}${v.sizeMB ? ` · 받을 크기 약 ${v.sizeMB}MB` : ''}. 업데이트해도 기록은 그대로입니다.`)],
      actions: [{ label: '이 버전 건너뛰기', value: 'skip' }, { label: '나중에' }, { label: me.installed ? '지금 업데이트' : '내려받기', kind: 'primary', value: 'go' }] });
    if (a === 'skip') localStorage.setItem('myaide.skipVersion', v.version);
    if (a !== 'go') return;
    if (me.installed) { toast('새 버전을 내려받는 중입니다. 다 받으면 MY AIDE가 잠깐 닫혔다 다시 열립니다'); await native.call('app.update', { url: v.url }); }
    else window.open((C.publicUrl || '') + 'download.html', '_blank');
  } catch { }
}

// First run on this device: where to keep the data.
async function setupGate() {
  return new Promise(resolve => {
    const card = h('div', { class: 'gate-card' });
    const err = h('p', { class: 'error' }, auth.error || '');
    const idInput = h('input', { type: 'text', placeholder: '000000-xxxx.apps.googleusercontent.com' });
    const deskId = h('input', { type: 'text', placeholder: '데스크톱 클라이언트 ID' });
    const deskSecret = h('input', { type: 'password', placeholder: '클라이언트 보안 비밀번호' });
    const desk = h('div', { class: 'grid2', hidden: true }, deskId, deskSecret);
    const start = async choice => {
      err.textContent = '';
      if (choice === 'drive' && native.available) {
        // Windows app: finds the downloaded client_secret_*.json by itself; typing is only a fallback.
        const st = await native.call('auth.status');
        if (!st.configured) {
          if (!desk.hidden && deskId.value.trim()) {
            try { await native.call('auth.config', { clientId: deskId.value.trim(), clientSecret: deskSecret.value.trim() }); }
            catch (e) { err.textContent = e.message; return; }
          } else {
            desk.hidden = false;
            err.textContent = '바탕화면이나 다운로드 폴더에서 client_secret_….json 파일을 찾지 못했습니다. 파일을 바탕화면에 두고 다시 누르거나, 두 값을 직접 넣어 주세요.';
            return;
          }
        }
        err.textContent = '브라우저에서 Google 로그인을 마쳐 주세요…';
        try { await auth.signIn(); } catch (e) { err.textContent = e.message; return; }
        await db.kvSet('mode', 'drive');
        resolve('drive'); return;
      }
      if (choice === 'drive') {
        if (!clientId()) {
          const v = idInput.value.trim();
          if (!v.endsWith('.apps.googleusercontent.com')) { err.textContent = 'Google 클라이언트 ID를 확인해 주세요. …apps.googleusercontent.com 으로 끝납니다.'; return; }
          setClientId(v);
        }
        await db.kvSet('mode', 'drive');
        try { await auth.signIn(); } catch (e) { err.textContent = e.message; }
        return;
      }
      await db.kvSet('mode', 'local');
      resolve('local');
    };
    card.append(...[
      h('h1', null, 'MY AIDE'),
      h('p', { class: 'lead' }, '처음 한 번만 저장 위치를 정합니다. 다음부터는 비밀번호만 입력하면 됩니다.'),
      !native.available && !clientId() ? h('label', { class: 'field' }, 'Google 클라이언트 ID (설정 가이드 참고)', idInput) : null,
      h('button', { class: 'choice', onclick: () => start('drive') },
        h('b', null, 'Google Drive에 저장'),
        h('span', null, '내 Google Drive의 MY AIDE 폴더에 저장하고 iPhone, iPad, Mac, Android, Windows에서 함께 씁니다.')),
      desk,
      native.available ? h('button', { class: 'choice', onclick: () => start('local') },
        h('b', null, '이 PC에만 저장 (업무망)'),
        h('span', null, '인터넷이 막힌 PC용입니다. 데이터를 이 PC 폴더에만 저장하고 다른 기기와 동기화하지 않습니다.')) : null,
      err].filter(Boolean));
    app.replaceChildren(h('div', { class: 'gate' }, card));
  });
}

// ---------- password login ----------
// One MY AIDE password: it opens the app and is the key that encrypts 계정정보 and the OpenAI key.
async function passwordGate() {
  // A new device needs the vault record from Drive before it can tell "log in" from "create".
  if (!await vault.exists()) await sync.syncNow().catch(() => {});
  if (sessionStorage.getItem('myaide.reset') && auth.freshSignIn()) {
    sessionStorage.removeItem('myaide.reset');
    return newPasswordScreen(true);
  }
  sessionStorage.removeItem('myaide.reset');
  if (await vault.exists()) {
    if (await db.kvGet('auto-login') && await vault.autoUnlock()) return;   // 자동 로그인 (이 기기)
    await loginScreen();
    if (await db.kvGet('auto-login')) await vault.rememberDevice().catch(() => {});
    else await offerAutoLogin();
    return;
  }
  if (mode === 'drive' && !sync.state.lastSync) return needSyncScreen();
  return newPasswordScreen(false);
}

// Phones/tablets: ask once whether this device should stay logged in.
async function offerAutoLogin() {
  if (native.available || await db.kvGet('auto-login-asked')) return;
  if (!matchMedia('(pointer: coarse)').matches) return;
  await db.kvSet('auto-login-asked', true);
  const r = await dialog({ title: '이 기기에서 자동 로그인할까요?',
    body: [h('p', null, '켜 두면 이 폰에서는 MY AIDE 비밀번호를 다시 묻지 않습니다. 계정정보를 열 때만 한 번 더 확인합니다.'), h('p', { class: 'hint' }, '설정 › 로그인에서 언제든 끌 수 있습니다.')],
    actions: [{ label: '나중에', value: null }, { label: '자동 로그인 켜기', kind: 'primary', value: 'ok' }] });
  if (r === 'ok') { await db.kvSet('auto-login', true); await vault.rememberDevice().catch(() => {}); toast('이 기기는 자동으로 로그인합니다'); }
}

// ---------- 사용 승인 (관리자가 승인한 사람만) ----------
async function licenseGate() {
  const L = await import('./license.js');
  if (!L.enabled()) return;
  let r = await L.check();
  if (r.ok) { setInterval(async () => { if (navigator.onLine && !(await L.recheckRevoked())) location.reload(); }, 6 * 3600 * 1000); return; }
  const C = window.MYAIDE_CONFIG || {};
  await new Promise(resolve => {
    const email = h('input', { type: 'email', value: r.email || '', placeholder: 'Google 이메일', readOnly: !!r.email });
    const name = h('input', { type: 'text', placeholder: '이름 (예: 홍길동)' });
    const code = h('textarea', { rows: 3, placeholder: 'MYAIDE-로 시작하는 승인 코드를 붙여 넣으세요' });
    const err = h('p', { class: 'error' });
    const msg = { none: '처음 오셨네요. MY AIDE는 관리자가 승인한 분만 쓸 수 있습니다. 아래에서 승인을 요청하고, 받은 승인 코드를 넣어 주세요.',
      bad: '저장된 승인 코드가 올바르지 않습니다. 승인 코드를 다시 받아 넣어 주세요.',
      email: `이 승인 코드는 ${r.info?.e || '다른 계정'} 용입니다. 지금 로그인한 Google 계정(${r.email})용 코드를 받아 주세요.`,
      revoked: '관리자가 이 계정의 사용을 중지했습니다. 기록은 내 Google Drive에 그대로 남아 있습니다. 다시 쓰려면 관리자에게 문의하세요.' }[r.reason];
    const reqText = () => `[MY AIDE 사용 승인 요청]\n이름: ${name.value.trim() || '(이름)'}\nGoogle 이메일: ${email.value.trim() || '(이메일)'}\n기기: ${native.available ? 'Windows 앱' : /iPhone|Android/.test(navigator.userAgent) ? '폰' : '브라우저'}`;
    const request = async () => {
      if (!email.value.trim() || !name.value.trim()) { err.textContent = '이름과 이메일을 넣어 주세요.'; return; }
      const text = reqText();
      if (navigator.share && /iPhone|iPad|Android/.test(navigator.userAgent)) { try { await navigator.share({ title: 'MY AIDE 사용 승인 요청', text }); return; } catch { } }
      if (C.adminEmail) location.href = `mailto:${C.adminEmail}?subject=${encodeURIComponent('MY AIDE 사용 승인 요청')}&body=${encodeURIComponent(text)}`;
      else { await navigator.clipboard?.writeText(text).catch(() => {}); err.textContent = ''; toast('요청 내용을 복사했습니다. 관리자에게 카톡·메일로 보내 주세요'); }
    };
    const apply = async () => {
      err.textContent = '';
      try {
        const info = await L.verify(code.value);
        const me = (email.value || '').trim().toLowerCase();
        if (me && info.e && info.e !== me) { err.textContent = `이 코드는 ${info.e} 용입니다. 지금 계정(${me})용 코드를 받아 주세요.`; return; }
        await L.save(code.value.replace(/\s+/g, ''), info);
        const again = await L.check();
        if (!again.ok) { err.textContent = again.reason === 'revoked' ? '이 코드는 사용이 중지되었습니다.' : '승인을 확인하지 못했습니다.'; return; }
        toast(`${info.n || ''}님, 승인되었습니다`); resolve();
      } catch (e) { err.textContent = e.message; }
    };
    gate(h('p', { class: 'lead' }, msg),
      r.reason !== 'revoked' ? h('div', { class: 'lic-step' }, h('b', null, '1. 승인 요청 보내기'),
        h('label', { class: 'field' }, '이름', name), h('label', { class: 'field' }, 'Google 이메일', email),
        h('button', { class: 'btn', onclick: request }, C.adminEmail ? '승인 요청 보내기' : '요청 내용 복사')) : null,
      h('div', { class: 'lic-step' }, h('b', null, (r.reason !== 'revoked' ? '2. ' : '') + '승인 코드 넣기'), code,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: apply }, '확인'), h('span', { class: 'grow' }),
          mode === 'drive' ? h('button', { class: 'btn small ghost', onclick: async () => { await auth.signOut(); vault.lock(); location.reload(); } }, '다른 Google 계정으로') : null)),
      err);
  });
}

function gate(...children) {
  app.replaceChildren(h('div', { class: 'gate' }, h('div', { class: 'gate-card' }, h('h1', null, 'MY AIDE'), ...children)));
}

function loginScreen() {
  return new Promise(resolve => {
    const pw = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': '비밀번호', placeholder: '비밀번호' });
    const err = h('p', { class: 'error' });
    const btn = h('button', { class: 'btn primary', onclick: go }, '로그인');
    async function go() {
      if (!pw.value) { err.textContent = '비밀번호를 입력해 주세요.'; return; }
      btn.disabled = true; err.textContent = '';
      try { await vault.unlock(pw.value); resolve(); }
      catch (e) { err.textContent = e.message; pw.select(); }
      btn.disabled = false;
    }
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    gate(h('p', { class: 'lead' }, '비밀번호를 입력해 주세요.'), pw, err,
      h('div', { class: 'row' }, btn,
        native.available ? h('button', { class: 'btn ghost', onclick: () => native.call('app.exit') }, '종료') : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn small ghost', onclick: forgot }, '비밀번호를 잊었어요')));
    pw.focus();
  });
}

async function forgot() {
  const ok = await dialog({
    title: '비밀번호 초기화',
    body: [h('p', { style: { margin: 0 } }, '비밀번호를 새로 정합니다. 업무일지·메모·일정·가계부 등 기록은 그대로 남습니다.'),
      h('p', { class: 'error', style: { margin: 0 } }, '다만 비밀번호로 암호화된 계정정보(아이디·비밀번호)와 OpenAI API 키는 되살릴 수 없어 지워집니다.'),
      h('p', { class: 'hint', style: { margin: 0 } }, native.available ? '본인 확인을 위해 Windows Hello(또는 Windows 로그인)를 거칩니다.' : '본인 확인을 위해 Google 계정을 한 번 더 고릅니다.')],
    actions: [{ label: '취소', value: false }, { label: '계속', kind: 'danger', value: true }]
  });
  if (!ok) return;
  if (native.available) {
    try {
      const r = await native.call('hello.verify', { message: 'MY AIDE 비밀번호 초기화' });
      if (!r.ok) { toast(r.message || '본인 확인을 하지 못했습니다.', 'err'); return; }
    } catch (e) { toast(e.message, 'err'); return; }
    await newPasswordScreen(true);
    location.reload();
    return;
  }
  sessionStorage.setItem('myaide.reset', '1');
  await auth.signIn({ chooseAccount: true });
}

function newPasswordScreen(isReset) {
  return new Promise(resolve => {
    const a = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '새 비밀번호 (6자 이상)' });
    const b = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '한 번 더' });
    const err = h('p', { class: 'error' });
    const go = async () => {
      if (a.value !== b.value) { err.textContent = '두 비밀번호가 다릅니다.'; return; }
      try { if (isReset) await vault.reset(a.value); else await vault.create(a.value); }
      catch (e) { err.textContent = e.message; return; }
      sync.syncNow().catch(() => {});
      toast(isReset ? '비밀번호를 새로 정했습니다' : '비밀번호를 만들었습니다');
      resolve();
    };
    b.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    gate(h('p', { class: 'lead' }, isReset ? '새 비밀번호를 정해 주세요.' : 'MY AIDE에 로그인할 비밀번호를 정해 주세요.'),
      h('p', { class: 'hint', style: { margin: 0 } }, '모든 기기(PC·휴대폰·태블릿)에서 같은 비밀번호를 씁니다. 계정정보는 이 비밀번호로 암호화되어 저장됩니다. 8자 이상, 숫자와 문자를 섞어 쓰기를 권장합니다.'),
      a, b, err, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: go }, isReset ? '새 비밀번호 저장' : '비밀번호 만들기')));
    a.focus();
  });
}

// New device that hasn't reached Drive yet: don't create a second, separate password.
function needSyncScreen() {
  return new Promise(resolve => {
    const err = h('p', { class: 'error' }, sync.state.message && sync.state.status !== 'ok' ? sync.state.message : '');
    const retry = async () => {
      err.textContent = '연결 중…';
      if (sync.state.needsAuth || !auth.hasToken()) { try { await auth.signIn(); } catch (e) { err.textContent = e.message; return; } }
      await sync.syncNow().catch(e => { err.textContent = e.message; });
      if (sync.state.lastSync) passwordGate().then(resolve);
    };
    gate(h('p', { class: 'lead' }, '처음 시작할 때는 Google Drive 연결이 필요합니다.'),
      h('p', { class: 'hint', style: { margin: 0 } }, '다른 기기에서 이미 비밀번호를 만들었다면 그 비밀번호를 가져옵니다.'),
      err, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: retry }, 'Google 연결')));
  });
}

async function lockNow() {
  vault.lock();
  shareSession();
  if (current.cleanup) try { current.cleanup(); } catch {}
  current = { key: null, cleanup: null };
  await loginScreen();
  shareSession();
  renderShell();
  route();
}

// ---------- desktop widgets (Windows app) ----------
async function shareSession() {
  if (!native.available) return;
  try { await native.call('session.set', { key: await vault.exportSession() }); } catch {}
}

// A widget window shows one menu. It never signs in by itself: it opens while MY AIDE is logged in.
async function bootWidget(key) {
  document.body.classList.add('widget');
  const tint = c => { if (c && /^#[0-9a-f]{6}$/i.test(c)) document.body.style.setProperty('--wbg', c); else document.body.style.removeProperty('--wbg'); };
  tint(new URLSearchParams(location.search).get('color'));
  native.on('widgetColor', d => tint(d && d.color));
  mode = await db.kvGet('mode');
  await loadPrefs();
  const wait = msg => app.replaceChildren(h('div', { class: 'widget-wait' }, h('div', null, h('b', { style: { display: 'block', color: 'var(--ink)', marginBottom: '4px' } }, 'MY AIDE'), msg)));
  const start = async raw => {
    await vault.importSession(raw);
    if (!raw) { wait('MY AIDE에 로그인하면 내용이 보입니다.'); return; }
    const k = ALIASES[key] || key;
    if (!VIEWS[k]) { wait('이 메뉴는 위젯으로 열 수 없습니다.'); return; }
    const main = h('main', { class: 'main', id: 'main' });
    app.replaceChildren(h('div', { class: 'shell widget-shell', 'data-group': groupOf(k) }, main));
    if (!location.hash.startsWith('#/' + k)) history.replaceState(null, '', '#/' + k);
    current = { key: null, cleanup: null };
    route();
  };
  native.on('session', d => start(d && d.key));
  window.addEventListener('hashchange', route);
  let raw = null;
  try { raw = (await native.call('session.get')).key; } catch {}
  await start(raw);
}

// ---------- shell ----------
// 폰: 설정 › 폰 메뉴에서 고른 메뉴만 (기준정보, 모든 기기 공통으로 Drive에 저장)
const isPhone = () => matchMedia('(max-width: 760px)').matches;
const phoneTabs = () => (prefs().phoneTabs || []).map(k => TABS.find(t => t.key === k)).filter(Boolean);
function visibleTabs() {
  const hidden = new Set(prefs().hiddenTabs || []);
  return TABS.filter(t => !hidden.has(t.key));
}

function renderShell() {
  const nav = h('nav', { class: 'nav', 'aria-label': '메뉴' });
  const pill = h('button', { class: 'sync-pill', onclick: onPill }, h('span', { class: 'dot' }), h('span', { class: 'txt' }, '준비 중'));
  const foot = h('div', { class: 'rail-foot' }, pill);
  const topActs = h('div', { class: 'brand-acts' },
    h('button', { class: 'icon-btn', onclick: lockNow, title: '잠그기', 'aria-label': '잠그기' }, icon('lock')),
    native.available ? h('button', { class: 'icon-btn', onclick: () => native.call('app.exit'), title: 'MY AIDE 종료', 'aria-label': '종료' }, icon('power')) : null);
  const canCapture = native.available || !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  const captureBtn = canCapture ? h('button', { class: 'capture-btn', onclick: () => import('./capture.js').then(m => m.startCapture()),
    title: native.available ? '드래그해서 캡처 · Ctrl+Shift+F10 (모든 모니터 Ctrl+Shift+F11)' : '드래그해서 캡처' }, icon('capture'), '화면 캡처') : null;
  const rail = h('aside', { class: 'rail' }, h('div', { class: 'brand' }, h('img', { src: 'icons/icon.svg', alt: '' }), h('span', { class: 'grow' }, 'MY AIDE'), topActs), captureBtn, nav, foot);
  const view = h('main', { class: 'main', id: 'main' });
  const bar = h('nav', { class: 'mobile-bar', 'aria-label': '메뉴' });
  const mPill = h('button', { class: 'sync-pill mobile-pill', onclick: onPill }, h('span', { class: 'dot' }), h('span', { class: 'txt' }));
  app.replaceChildren(h('div', { class: 'shell' }, rail, view, bar), mPill);

  const navBtn = t => h('button', { 'data-key': t.key, onclick: () => go(t.key) }, icon(t.icon), t.label);
  const drawNav = () => {
    const tabs = visibleTabs().concat(FIXED);
    nav.replaceChildren(...GROUPS.map(g => {
      const items = tabs.filter(t => t.group === g.key);
      return items.length ? h('div', { class: 'nav-group nav-' + g.key }, h('div', { class: 'nav-label' }, g.label), ...items.map(navBtn)) : null;
    }).filter(Boolean));
    // 폰 아래 막대: 홈 + 폰 메뉴 앞의 3개 + 전체
    const fav = phoneTabs().slice(0, 3);
    bar.replaceChildren(h('button', { 'data-key': 'home', onclick: () => go('home') }, icon('home'), '홈'),
      ...fav.map(t => h('button', { 'data-key': t.key, onclick: () => go(t.key) }, icon(t.icon), t.label)),
      h('button', { 'data-key': '_more', onclick: moreSheet }, icon('more'), '전체'));
    markCurrent();
  };
  drawNav();
  prefsEvents.addEventListener('change', drawNav);

  const drawPill = () => {
    const s = sync.state;
    pill.className = 'sync-pill' + (s.status === 'busy' ? ' busy' : '') + (s.status === 'offline' ? ' off' : '') + (s.conflicts || s.needsAuth || s.status === 'error' ? ' attn' : '');
    let text = s.message || '준비 중';
    if (s.conflicts) text = `동기화 확인 필요 ${s.conflicts}건`;
    else if (s.needsAuth) text = 'Google 다시 연결';
    else if (s.pending && s.status !== 'busy') text = `전송 대기 ${s.pending}건` + (s.status === 'offline' ? ' · 오프라인' : '');
    else if (s.status === 'ok') text = '동기화됨 · ' + fmtTime(s.lastSync).slice(11);
    pill.querySelector('.txt').textContent = text;
    pill.title = s.backend ? s.backend.describe() : '';
    mPill.className = pill.className + ' mobile-pill';
    mPill.querySelector('.txt').textContent = text;
    mPill.hidden = s.status === 'ok' && !s.pending && !s.conflicts;
  };
  sync.syncEvents.addEventListener('state', drawPill);
  drawPill();
  let shownConflicts = 0;
  sync.syncEvents.addEventListener('state', () => {
    if (sync.state.conflicts > shownConflicts) { shownConflicts = sync.state.conflicts; showConflicts(); }
    if (!sync.state.conflicts) shownConflicts = 0;
  });
}

async function onPill() {
  const s = sync.state;
  if (s.conflicts) return showConflicts();
  if (s.needsAuth) { try { await auth.signIn(); sync.syncNow().catch(() => {}); } catch (e) { toast(e.message, 'err'); } return; }
  try { await sync.syncNow(); toast('동기화했습니다'); } catch (e) { if (!e.auth) toast(e.message, 'err'); }
}

async function moreSheet() {
  const tabs = (isPhone() ? phoneTabs() : visibleTabs()).concat(FIXED);
  await dialog({
    title: '전체 메뉴',
    body: h('div', { class: 'nav' }, h('div', { class: 'row', style: { justifyContent: 'flex-end', marginBottom: '4px' } },
        h('button', { class: 'btn small', onclick: e => { e.target.closest('dialog').close(); lockNow(); } }, icon('lock'), '잠그기')), GROUPS.map(g => {
      const items = tabs.filter(t => t.group === g.key);
      return items.length ? h('div', { class: 'nav-group nav-' + g.key }, h('div', { class: 'nav-label' }, g.label),
        ...items.map(t => h('button', { onclick: e => { e.target.closest('dialog').close(); go(t.key); } }, icon(t.icon), t.label))) : null;
    })),
    actions: [{ label: '닫기' }]
  });
  document.querySelectorAll('dialog').forEach(d => { if (!d.open) d.remove(); });
}

export function go(key, param) {
  const next = '#/' + key + (param ? '/' + encodeURIComponent(param) : '');
  if (location.hash === next) route(); else location.hash = next;
}

function markCurrent() {
  const shell = document.querySelector('.shell');
  if (shell && current.key) shell.dataset.group = groupOf(current.key);
  document.querySelectorAll('[data-key]').forEach(b => {
    if (b.dataset.key === current.key) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}

async function route() {
  let [, key0, param] = (location.hash.match(/^#\/([^/]+)(?:\/(.+))?/) || []);
  key0 = ALIASES[key0] || key0;
  const wk = document.body.classList.contains('widget') ? new URLSearchParams(location.search).get('widget') : null;
  let key = wk ? (ALIASES[wk] || wk) : VIEWS[key0] ? key0 : isPhone() ? 'home' : (visibleTabs()[0] || TABS[0]).key;
  // 폰에서 폰 메뉴에 없는 메뉴를 열면 안내
  if (!wk && isPhone() && TABS.some(t => t.key === key) && !phoneTabs().some(t => t.key === key)) {
    const t = TABS.find(x => x.key === key), main = $('#main');
    if (current.cleanup) try { current.cleanup(); } catch {}
    current = { key: '_blocked', cleanup: null, instance: null };
    if (main) main.replaceChildren(h('div', { class: 'pad' }, h('div', { class: 'empty' }, h('b', null, `‘${t.label}’은(는) 폰 메뉴에 없습니다`), '설정 › 폰 메뉴에서 넣으면 폰에서도 쓸 수 있습니다.',
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } },
        h('button', { class: 'btn primary', onclick: async () => { const { save } = await import('./prefs.js'); await save({ phoneTabs: [...(prefs().phoneTabs || []), key] }); route(); } }, '폰 메뉴에 넣기'),
        h('button', { class: 'btn', onclick: () => go('home') }, '홈으로')))));
    return;
  }
  if (wk && key0 && key0 !== key) param = null;
  const main = $('#main');
  if (!main) return;
  if (current.key === key && current.instance && current.instance.open) {
    current.instance.open(param ? decodeURIComponent(param) : null);
    return;
  }
  if (current.cleanup) try { current.cleanup(); } catch {}
  current = { key, cleanup: null, instance: null };
  markCurrent();
  try {
    const mod = await VIEWS[key]();
    if (current.key !== key) return;
    const view = h('div', { class: 'view' });
    main.replaceChildren(view);
    const inst = await mod.mount(view, { key, param: param ? decodeURIComponent(param) : null, go });
    current.instance = inst || null;
    current.cleanup = inst && inst.cleanup;
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('div', { class: 'pad' }, h('p', { class: 'error' }, '화면을 열지 못했습니다: ' + e.message)));
  }
}

async function maybeAutoBackup() {
  const days = prefs().autoBackupDays;
  if (!days) return;
  const last = await db.kvGet('backup.last', 0);
  if (Date.now() - last < days * 86400000) return;
  setTimeout(async () => {
    try { const m = await import('./views/backup.js'); await m.snapshotToStore(true); } catch {}
  }, 20000);
}

boot().catch(e => {
  console.error(e);
  app.replaceChildren(h('div', { class: 'gate' }, h('div', { class: 'gate-card' }, h('h1', null, 'MY AIDE'), h('p', { class: 'error' }, '시작하지 못했습니다: ' + e.message))));
});
