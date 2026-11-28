import { h, toast, confirmBox, dialog } from '../util.js';
import * as db from '../db.js';
import { TABS, GROUPS, prefs, save as savePrefs, AI_SITES, device } from '../prefs.js';
import { FONT_SIZES, COLORS } from '../imageeditor.js';
import { native } from '../native.js';
import { auth } from '../auth.js';
import * as vault from '../vault.js';
import * as sync from '../sync.js';
import { unlockVaultPrompt, PROVIDERS, currentAi, listModels } from '../openai.js';
import { usageSection } from './usagepanel.js';
import { privacySection } from './privacypanel.js';
import { themeMode, applyTheme } from '../theme.js';

export async function mount(root) {
  const body = h('div', { class: 'pad settings' });
  root.append(h('div', { class: 'view-head' }, h('h1', null, '설정')), body);
  const p = prefs();

  // Tabs
  const hidden = new Set(p.hiddenTabs || []);
  const tabChecks = TABS.map(t => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !hidden.has(t.key), 'data-k': t.key }), t.label));
  const saveTabs = async () => {
    const off = tabChecks.map(l => l.querySelector('input')).filter(i => !i.checked).map(i => i.dataset.k);
    if (off.length === TABS.length) { toast('탭을 하나 이상 남겨 주세요.', 'err'); return; }
    await savePrefs({ hiddenTabs: off }); toast('탭 설정을 저장했습니다. 모든 기기에 적용됩니다.');
  };

  // Capture defaults
  const allScreens = h('input', { type: 'checkbox', checked: !!p.capture.allScreens });
  const size = h('input', { type: 'number', min: 8, max: 200, value: p.capture.fontSize, list: 'set-sizes', style: { width: '90px' } });
  const sizes = h('datalist', { id: 'set-sizes' }, FONT_SIZES.map(s => h('option', { value: s })));
  const color = h('select', { style: { width: 'auto' } }, COLORS.map(([n, c]) => h('option', { value: c, selected: c === p.capture.color }, n)));

  // AI
  const site = h('select', { style: { width: 'auto' } }, AI_SITES.map(s => h('option', { value: s.key, selected: s.key === p.aiSite }, s.name)));
  // AI 선택 → 그 AI의 모델 목록 (키가 있으면 실제로 쓸 수 있는 목록을 받아 옴)
  const cur = currentAi();
  const provSel = h('select', { style: { width: 'auto' } }, Object.entries(PROVIDERS).map(([k, v]) => h('option', { value: k, selected: k === cur.provider }, v.name)));
  const modelSel = h('select', { style: { width: 'auto', minWidth: '220px' } });
  const modelState = h('span', { class: 'muted' });
  const keyState = h('span', { class: 'muted' });
  const keyBtn = h('button', { class: 'btn small', onclick: () => setKey() });
  const chosenModel = prov => (prefs().aiModels || {})[prov] || (prov === 'openai' ? prefs().aiModel : null) || PROVIDERS[prov].fallback[0];
  async function fillModels(fromServer) {
    const prov = provSel.value, want = modelSel.value && modelSel.dataset.prov === prov ? modelSel.value : chosenModel(prov);
    keyBtn.textContent = PROVIDERS[prov].name.split(' ')[0] + ' API 키 입력·변경';
    let list = PROVIDERS[prov].fallback, note = '기본 목록';
    if (fromServer !== false && vault.isOpen()) {
      const key = await vault.getSecret(PROVIDERS[prov].secret).catch(() => null);
      keyState.textContent = key ? '키가 저장되어 있습니다.' : '키가 없습니다.';
      if (key) {
        modelState.textContent = '목록을 받는 중…';
        try { const got = await listModels(prov, key); if (got.length) { list = got; note = `쓸 수 있는 모델 ${got.length}개`; } }
        catch (e) { note = '목록을 받지 못해 기본 목록을 보여 줍니다 — ' + e.message; }
      }
    } else keyState.textContent = vault.isOpen() ? '' : '잠겨 있어 키를 확인하지 못했습니다.';
    if (want && !list.includes(want)) list = [want, ...list];
    modelSel.dataset.prov = prov;
    modelSel.replaceChildren(...list.map(m => h('option', { value: m, selected: m === want }, m)));
    modelState.textContent = note;
  }
  provSel.onchange = () => fillModels();
  const saveAi = async () => {
    const prov = provSel.value;
    await savePrefs({ aiSite: site.value, aiProvider: prov, aiModels: { ...(prefs().aiModels || {}), [prov]: modelSel.value }, ...(prov === 'openai' ? { aiModel: modelSel.value } : {}) });
    toast(`AI: ${PROVIDERS[prov].name} · ${modelSel.value} 로 저장했습니다`);
  };
  const drawKeyState = () => fillModels();


  // 자동 로그인 (이 기기)
  const autoChk = h('input', { type: 'checkbox', checked: !!(await db.kvGet('auto-login')), onchange: async e => {
    try {
      if (e.target.checked) { if (!await unlockVaultPrompt('자동 로그인을 켜려면 MY AIDE 비밀번호가 필요합니다.')) { e.target.checked = false; return; } await vault.rememberDevice(); await db.kvSet('auto-login', true); toast('이 기기는 자동으로 로그인합니다'); }
      else { await vault.forgetDevice(); await db.kvSet('auto-login', false); toast('자동 로그인을 껐습니다'); }
    } catch (err) { toast(err.message, 'err'); e.target.checked = !e.target.checked; }
  } });

  // 화면 테마 (이 기기에만 적용)
  const themeCard = (mode, label, sub) => h('button', { type: 'button', class: 'theme-card t-' + mode, 'aria-pressed': String(themeMode() === mode), onclick: e => {
    applyTheme(mode); e.currentTarget.parentElement.querySelectorAll('.theme-card').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
  } }, h('span', { class: 'theme-prev' }, h('i'), h('i'), h('i')), h('b', null, label), h('span', null, sub));
  body.append(...[
    h('section', null, h('h2', null, '화면 테마'),
      h('div', { class: 'theme-cards' }, themeCard('light', '화이트', '밝은 화면'), themeCard('dark', '다크', '어두운 화면, 밤에 편함'), themeCard('system', '시스템 설정', 'PC·폰 설정을 따라 자동')),
      h('p', { class: 'hint' }, '이 기기에만 적용됩니다. PC는 화이트, 폰은 다크처럼 기기마다 다르게 쓸 수 있습니다.')),
    h('section', null, h('h2', null, '사용할 탭'), GROUPS.filter(g => TABS.some(t => t.group === g.key)).map(g => h('div', null, h('div', { class: 'nav-label', style: { padding: '0 0 4px' } }, g.label), h('div', { class: 'checks' }, tabChecks.filter((_, i) => TABS[i].group === g.key)))),
      h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: saveTabs }, '탭 설정 저장')),
      h('p', { class: 'hint' }, '숨긴 탭의 기록은 지워지지 않습니다.')),

    h('section', null, h('h2', null, '화면 캡처'),
      h('label', { class: 'check' }, allScreens, '모든 모니터를 한 번에 캡처 (듀얼 모니터)'),
      h('div', { class: 'row' }, h('label', { class: 'row', style: { gap: '6px' } }, '기본 글자 크기', size, sizes), h('label', { class: 'row', style: { gap: '6px' } }, '기본 색상', color)),
      h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: async () => {
        const s = Number(size.value);
        if (!(s >= 8 && s <= 200)) { toast('글자 크기는 8~200 사이로 입력해 주세요.', 'err'); return; }
        await savePrefs({ capture: { allScreens: allScreens.checked, fontSize: s, color: color.value } }); toast('캡처 기본값을 저장했습니다');
      } }, '캡처 기본값 저장')),
      h('p', { class: 'hint' }, 'Windows 앱: Ctrl+Shift+F10은 위 설정 범위로, Ctrl+Shift+F11은 항상 모든 모니터를 캡처합니다.')),

    h('section', null, h('h2', null, 'AI 연결'),
      h('div', { class: 'ai-pick' },
        h('label', { class: 'field' }, 'AI 선택', provSel),
        h('label', { class: 'field' }, '모델', modelSel),
        h('button', { class: 'btn small ghost', title: '이 키로 쓸 수 있는 모델 목록을 다시 받습니다', onclick: () => fillModels() }, '↻ 목록')),
      modelState,
      h('div', { class: 'row' }, keyBtn, keyState),
      h('div', { class: 'row' }, h('label', { class: 'row', style: { gap: '6px' } }, '‘에서 묻기’로 열 사이트', site), h('span', { class: 'grow' }), h('button', { class: 'btn small primary', onclick: saveAi }, 'AI 설정 저장')),
      h('p', { class: 'hint' }, '보내기 전에 예상 토큰·금액을 보여 주고 확인을 받습니다. 사용량과 확인 방식은 아래 ‘AI 사용량·요금’에서 정합니다. AIDE 대화·마인드맵·회의 요약·VisualCode 도우미가 고른 AI와 모델을 씁니다. 녹음 받아쓰기·사진 AI 설명·사진 의미 검색은 OpenAI 키로만 동작합니다. 키는 MY AIDE 비밀번호로 암호화되어 저장됩니다.')),

    usageSection(),

    privacySection(),

    h('section', null, h('h2', null, '비밀번호'),
      h('p', { class: 'hint', style: { margin: 0 } }, 'MY AIDE에 로그인하는 비밀번호입니다. 모든 기기에서 같은 비밀번호를 쓰고, 계정정보와 API 키는 이 비밀번호로 암호화됩니다.'),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: changePw }, '비밀번호 변경')),
      h('p', { class: 'hint' }, '비밀번호를 잊었다면 왼쪽 아래 ‘잠금’을 누른 뒤 로그인 화면의 ‘비밀번호를 잊었어요’를 누르세요. 앱을 30분 넘게 쓰지 않으면 자동으로 잠깁니다.')),

    native.available ? null : h('section', null, h('h2', null, '로그인'),
      h('label', { class: 'check' }, autoChk, '이 기기에서 자동 로그인 (MY AIDE 비밀번호를 다시 묻지 않음)'),
      h('p', { class: 'hint' }, '폰·태블릿처럼 나만 쓰는 기기에서 켜 두세요. 계정정보를 열 때만 비밀번호를 한 번 더 확인합니다. 왼쪽 위 자물쇠로 직접 잠그면 다음에 비밀번호가 필요합니다.')),

    native.available ? h('section', null, h('h2', null, 'Windows'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: device.get('autostart', true), onchange: async e => {
        try { await native.call('app.autostart', { enabled: e.target.checked }); device.set('autostart', e.target.checked); toast(e.target.checked ? 'Windows 시작 시 자동 실행합니다' : '자동 실행을 껐습니다'); }
        catch (err) { toast(err.message, 'err'); e.target.checked = !e.target.checked; }
      } }), 'Windows 시작 시 MY AIDE 자동 실행')) : null,

    h('section', null, h('h2', null, '계정과 저장소'),
      h('p', { style: { margin: 0 } }, sync.state.backend ? sync.state.backend.describe() : ''),
      h('div', { class: 'row' },
        sync.state.backend && sync.state.backend.kind === 'drive' ? h('button', { class: 'btn small', onclick: async () => {
          if (!await confirmBox('Google 계정에서 로그아웃할까요? 이 기기에 저장된 기록은 남아 있고, 다시 로그인하면 이어서 동기화합니다.', '로그아웃')) return;
          await auth.signOut(); vault.lock(); location.reload();
        } }, 'Google 로그아웃') : null,
        h('button', { class: 'btn small danger', onclick: wipe }, '이 기기에서 데이터 지우기')),
      h('p', { class: 'hint' }, '이 기기에서 지우기는 Drive의 데이터를 건드리지 않습니다. 공용 PC를 쓴 뒤나 기기를 바꿀 때 쓰세요.'))].filter(Boolean));

  async function setKey() {
    const prov = provSel.value, P = PROVIDERS[prov];
    if (!await unlockVaultPrompt('API 키를 저장하려면 MY AIDE 비밀번호가 필요합니다.')) return;
    const input = h('input', { type: 'password', placeholder: P.keyHint, autocomplete: 'off' });
    const r = await dialog({ title: P.name + ' API 키', body: [input, h('p', { class: 'hint' }, `${P.keyUrl} 에서 만든 키(${P.keyHint})를 붙여 넣으세요. 비워 두고 저장하면 키를 지웁니다.`)],
      onOpen: () => input.focus(), actions: [{ label: '취소' }, { label: '저장', kind: 'primary', value: 'ok' }] });
    if (r !== 'ok') return;
    await vault.setSecret(P.secret, input.value.trim()); toast(input.value.trim() ? 'API 키를 저장했습니다' : 'API 키를 지웠습니다'); fillModels();
  }

  async function changePw() {
    const a = h('input', { type: 'password' }), b = h('input', { type: 'password' }), c = h('input', { type: 'password' });
    const err = h('p', { class: 'error' });
    const r = await dialog({ title: '비밀번호 변경', body: [h('label', { class: 'field' }, '지금 비밀번호', a), h('label', { class: 'field' }, '새 비밀번호 (6자 이상)', b), h('label', { class: 'field' }, '새 비밀번호 확인', c), err],
      onOpen: () => a.focus(),
      actions: [{ label: '취소' }, { label: '변경', kind: 'primary', value: 'ok', run: async () => {
        if (b.value !== c.value) { err.textContent = '새 비밀번호가 서로 다릅니다.'; return false; }
        try { err.textContent = '바꾸는 중…'; await vault.changePassword(a.value, b.value); } catch (e) { err.textContent = e.message; return false; }
      } }] });
    if (r === 'ok') toast('비밀번호를 바꿨습니다. 다른 기기에서도 새 비밀번호로 로그인하세요.');
  }

  async function wipe() {
    if (!await confirmBox('이 기기에 저장된 MY AIDE 데이터를 지울까요? 아직 Drive로 올라가지 않은 기록은 사라집니다.', '지우기', true)) return;
    if (sync.state.pending && !await confirmBox(`전송 대기 중인 기록이 ${sync.state.pending}건 있습니다. 그래도 지울까요?`, '그래도 지우기', true)) return;
    await db.wipeAll(); localStorage.clear(); location.reload();
  }

  drawKeyState();
}
