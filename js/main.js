import { h, icon, toast, dialog, $, fmtTime } from './util.js';
import * as db from './db.js';
import * as sync from './sync.js';
import { auth, clientId, setClientId } from './auth.js';
import { DriveBackend, LocalFolderBackend } from './backends.js';
import { native } from './native.js';
import { TABS, load as loadPrefs, prefs, prefsEvents } from './prefs.js';
import { lock } from './lock.js';
import { showConflicts } from './conflicts.js';
import * as vault from './vault.js';

const VIEWS = {
  journal: () => import('./views/journal.js'),
  notes: () => import('./views/docs.js'),
  aimd: () => import('./views/docs.js'),
  knowledge: () => import('./views/knowledge.js'),
  schedule: () => import('./views/schedule.js'),
  milestones: () => import('./views/milestones.js'),
  ledger: () => import('./views/ledger.js'),
  accounts: () => import('./views/accounts.js'),
  meetings: () => import('./views/meetings.js'),
  aide: () => import('./views/aide.js'),
  files: () => import('./views/files.js'),
  remote: () => import('./views/remote.js'),
  backup: () => import('./views/backup.js'),
  settings: () => import('./views/settings.js'),
  manual: () => import('./views/manual.js')
};
const EXTRA = [{ key: 'settings', label: '설정', icon: 'settings' }, { key: 'manual', label: '사용 설명서', icon: 'manual' }];

const app = document.getElementById('app');
let current = { key: null, cleanup: null };

// ---------- boot ----------
async function boot() {
  auth.takeRedirect();
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !native.available)
    navigator.serviceWorker.register('sw.js').catch(() => {});

  let mode = await db.kvGet('mode');
  if (!mode) mode = await setupGate();
  if (lock.enabled()) await lockGate();

  await loadPrefs();
  const backend = mode === 'local' ? new LocalFolderBackend() : new DriveBackend(() => auth.token());
  sync.useBackend(backend);

  if (mode === 'drive' && !auth.hasToken() && !native.available && auth.canTrySilent()) {
    await auth.signIn({ silent: true });   // quick round trip to Google; returns to this page
  }
  renderShell();
  sync.counts();
  sync.syncNow().catch(() => {});
  setInterval(() => { if (document.visibilityState === 'visible') sync.syncNow().catch(() => {}); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync.schedule(200); });
  window.addEventListener('hashchange', route);
  route();
  if (native.available) {
    const pushPref = () => native.call('app.capturePref', { allScreens: !!prefs().capture.allScreens }).catch(() => {});
    pushPref(); prefsEvents.addEventListener('change', pushPref);
    native.on('navigate', d => { location.hash = '#/' + d.view + (d.param ? '/' + encodeURIComponent(d.param) : ''); });
    native.on('capture', d => import('./views/files.js').then(m => m.openCapture(d)));
  }
  maybeAutoBackup();
}

async function setupGate() {
  return new Promise(resolve => {
    const card = h('div', { class: 'gate-card' });
    const err = h('p', { class: 'error' }, auth.error || '');
    const start = async mode => {
      if (mode === 'drive' && native.available) {
        // Windows app signs in with a "Desktop app" OAuth client (system browser + loopback).
        const st = await native.call('auth.status');
        if (!st.configured) {
          if (!desk.hidden && deskId.value.trim()) {
            try { await native.call('auth.config', { clientId: deskId.value.trim(), clientSecret: deskSecret.value.trim() }); }
            catch (e) { err.textContent = e.message; return; }
          } else { desk.hidden = false; err.textContent = 'Google Cloud의 ‘데스크톱 앱’ 클라이언트 ID와 보안 비밀을 넣고 다시 눌러 주세요.'; return; }
        }
        err.textContent = '브라우저에서 Google 로그인을 마쳐 주세요…';
        try { await auth.signIn(); } catch (e) { err.textContent = e.message; return; }
        await db.kvSet('mode', 'drive');
        resolve(mode); return;
      }
      if (mode === 'drive') {
        if (!native.available && !clientId()) {
          const v = idInput.value.trim();
          if (!v.endsWith('.apps.googleusercontent.com')) { err.textContent = 'Google 클라이언트 ID를 확인해 주세요. …apps.googleusercontent.com 으로 끝납니다.'; return; }
          setClientId(v);
        }
        await db.kvSet('mode', 'drive');
        try { await auth.signIn(); } catch (e) { err.textContent = e.message; return; }
      } else await db.kvSet('mode', 'local');
      resolve(mode);
    };
    const idInput = h('input', { type: 'text', placeholder: '000000-xxxx.apps.googleusercontent.com' });
    const deskId = h('input', { type: 'text', placeholder: '데스크톱 클라이언트 ID' });
    const deskSecret = h('input', { type: 'password', placeholder: '클라이언트 보안 비밀번호' });
    const desk = h('div', { class: 'grid2', hidden: true }, deskId, deskSecret);
    card.append(...[
      h('h1', null, 'MY AIDE'),
      h('p', { class: 'lead' }, '업무일지, 메모, 일정, 가계부를 한곳에 기록하고 모든 기기에서 이어서 씁니다.'),
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

async function lockGate() {
  return new Promise(resolve => {
    const msg = h('p', { class: 'error' });
    const btn = h('button', { class: 'btn primary', onclick: tryUnlock }, native.available ? 'Windows Hello로 로그인' : 'Face ID / 지문으로 열기');
    async function tryUnlock() {
      msg.textContent = '';
      try { await lock.verify(); resolve(); }
      catch (e) { msg.textContent = e.name === 'NotAllowedError' ? '확인이 취소되었습니다. 다시 눌러 주세요.' : e.message; }
    }
    app.replaceChildren(h('div', { class: 'gate' }, h('div', { class: 'gate-card' },
      h('h1', null, 'MY AIDE'), h('p', { class: 'lead' }, '잠겨 있습니다.'), h('div', { class: 'row' }, btn,
        native.available ? h('button', { class: 'btn', onclick: () => native.call('app.exit') }, '종료') : null), msg)));
    if (native.available) tryUnlock();
  });
}

// ---------- shell ----------
function visibleTabs() {
  const hidden = new Set(prefs().hiddenTabs || []);
  return TABS.filter(t => !hidden.has(t.key));
}

function renderShell() {
  const nav = h('nav', { class: 'nav', 'aria-label': '메뉴' });
  const pill = h('button', { class: 'sync-pill', onclick: onPill }, h('span', { class: 'dot' }), h('span', { class: 'txt' }, '준비 중'));
  const foot = h('div', { class: 'rail-foot' }, pill,
    h('div', { class: 'row' },
      h('button', { class: 'btn small ghost', onclick: lockNow, title: '잠그기' }, icon('lock'), '잠금'),
      native.available ? h('button', { class: 'btn small ghost', onclick: () => native.call('app.exit') }, '종료') : null));
  const rail = h('aside', { class: 'rail' }, h('div', { class: 'brand' }, h('img', { src: 'icons/icon.svg', alt: '' }), 'MY AIDE'), nav, foot);
  const view = h('main', { class: 'main', id: 'main' });
  // Phones: the rail is hidden, so a small status chip shows up whenever sync needs attention.
  const mPill = h('button', { class: 'sync-pill mobile-pill', onclick: onPill }, h('span', { class: 'dot' }), h('span', { class: 'txt' }));
  const bar = h('nav', { class: 'mobile-bar', 'aria-label': '메뉴' });
  app.replaceChildren(h('div', { class: 'shell' }, rail, view, bar), mPill);

  const drawNav = () => {
    const tabs = visibleTabs();
    nav.replaceChildren(...tabs.map(navBtn), h('div', { class: 'sep' }), ...EXTRA.map(navBtn));
    const first = tabs.slice(0, 4);
    bar.replaceChildren(...first.map(t => h('button', { 'data-key': t.key, onclick: () => go(t.key) }, icon(t.icon), t.label)),
      h('button', { 'data-key': '_more', onclick: moreSheet }, icon('more'), '더보기'));
    markCurrent();
  };
  const navBtn = t => h('button', { 'data-key': t.key, onclick: () => go(t.key) }, icon(t.icon), t.label);
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

async function lockNow() {
  vault.lock();
  if (lock.enabled()) { await lockGate(); renderShell(); route(); }
  else toast('잠금은 설정 › 기기 잠금에서 켤 수 있습니다.');
}

async function moreSheet() {
  const tabs = visibleTabs().slice(4).concat(EXTRA);
  await dialog({
    title: '전체 메뉴',
    body: h('div', { class: 'nav' }, tabs.map(t => h('button', { onclick: e => { e.target.closest('dialog').close(); go(t.key); } }, icon(t.icon), t.label))),
    actions: [{ label: '닫기' }]
  });
  document.querySelectorAll('dialog').forEach(d => { if (!d.open) d.remove(); });
}

export function go(key, param) {
  const next = '#/' + key + (param ? '/' + encodeURIComponent(param) : '');
  if (location.hash === next) route(); else location.hash = next;
}

function markCurrent() {
  document.querySelectorAll('[data-key]').forEach(b => {
    if (b.dataset.key === current.key) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}

async function route() {
  const [, key0, param] = (location.hash.match(/^#\/([^/]+)(?:\/(.+))?/) || []);
  const key = VIEWS[key0] ? key0 : (visibleTabs()[0] || TABS[0]).key;
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
