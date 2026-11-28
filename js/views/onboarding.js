// 처음 쓰는 사람을 위한 설정 안내 (한 번만): 환영 → 폰 메뉴 → AI 연결(선택) → 다른 기기에서 쓰기
import { h, dialog, toast, copyText } from '../util.js';
import * as db from '../db.js';
import * as vault from '../vault.js';
import { native } from '../native.js';
import { prefs, save as savePrefs } from '../prefs.js';
import { PROVIDERS } from '../openai.js';
import { phoneMenuEditor } from './phonemenu.js';

export async function maybeOnboard() {
  if (await db.kvGet('onboarded')) return;
  const n = (await db.all('journal')).length + (await db.all('notes')).length + (await db.all('schedule')).length;
  if (n > 3) { await db.kvSet('onboarded', true); return; }   // 이미 쓰던 사람
  await runOnboarding();
  await db.kvSet('onboarded', true);
}

export async function runOnboarding() {
  const C = window.MYAIDE_CONFIG || {};
  const phone = matchMedia('(max-width: 760px)').matches;
  const url = C.publicUrl || location.href.replace(/#.*$/, '');
  const steps = [];
  steps.push({ title: 'MY AIDE에 오신 것을 환영합니다', body: () => h('div', { class: 'ob' },
    h('p', null, 'MY AIDE는 업무일지·메모·일정·가계부·회의록을 한곳에서 쓰고, AI가 내 기록을 찾아 답해 주는 개인 비서입니다.'),
    h('ul', null, h('li', null, '기록은 ', h('b', null, '내 Google Drive'), '에만 저장됩니다. 관리자도 볼 수 없습니다.'),
      h('li', null, '폰·PC·태블릿에서 같은 기록을 이어 씁니다.'), h('li', null, '몇 단계만 고르면 바로 쓸 수 있어요. 나중에 설정에서 언제든 바꿀 수 있습니다.'))) });
  if (phone) {
    let ed;
    steps.push({ title: '폰에서 쓸 메뉴 고르기', body: () => { ed = phoneMenuEditor(); return h('div', { class: 'ob' }, h('p', { class: 'hint' }, '고른 메뉴가 큰 타일로 홈 화면에 나옵니다. 위에서부터 순서대로예요.'), ed.el); }, next: () => ed.save() });
  }
  let provSel, keyIn, prov;
  steps.push({ title: 'AI 연결 (선택)', body: () => {
    provSel = h('select', null, Object.entries(PROVIDERS).map(([k, v]) => h('option', { value: k, selected: k === (prefs().aiProvider || 'openai') }, v.name)));
    keyIn = h('input', { type: 'password', placeholder: 'API 키 붙여 넣기', autocomplete: 'off' });
    const link = h('a', { target: '_blank', rel: 'noopener' });
    const setLink = () => { prov = PROVIDERS[provSel.value]; link.href = 'https://' + prov.keyUrl; link.textContent = prov.keyUrl + ' 에서 키 만들기'; keyIn.placeholder = prov.keyHint; };
    provSel.onchange = setLink; setLink();
    return h('div', { class: 'ob' },
      h('p', null, 'AIDE 질문, 회의 요약, 영수증 AI 읽기 같은 기능은 각자의 AI 키로 동작합니다. 쓴 만큼만 각자 결제합니다(질문 하나에 보통 1~3원).'),
      h('label', { class: 'field' }, 'AI 회사', provSel), link, h('label', { class: 'field' }, 'API 키', keyIn),
      h('p', { class: 'hint' }, '키가 없어도 AI를 뺀 모든 기능은 그대로 쓸 수 있어요. 나중에 설정 › AI 연결에서 넣어도 됩니다. 처음이라면 결제 화면에서 자동 충전을 끄고 5달러 정도만 충전하세요.'));
  }, next: async () => {
    const k = keyIn.value.trim();
    if (!k) return true;
    await vault.setSecret(PROVIDERS[provSel.value].secret, k);
    await savePrefs({ aiProvider: provSel.value });
    toast('AI 키를 저장했습니다'); return true;
  }, skip: '나중에' });
  steps.push({ title: '다른 기기에서도 쓰기', body: () => h('div', { class: 'ob' },
    h('p', null, h('b', null, '폰·태블릿'), ': 아래 주소를 Safari(아이폰)나 Chrome(안드로이드)으로 열고, 같은 Google 계정과 MY AIDE 비밀번호로 로그인하세요. 공유 버튼 › ', h('b', null, '홈 화면에 추가'), '를 누르면 앱처럼 쓸 수 있어요.'),
    h('div', { class: 'us-code' }, url), h('button', { class: 'btn small', onclick: () => copyText(url, '주소를 복사했습니다') }, '주소 복사'),
    !native.available ? h('p', null, h('b', null, 'Windows PC'), ': 화면 캡처·PC 파일 찾기·위젯까지 쓰려면 ', h('a', { href: url + 'download.html', target: '_blank', rel: 'noopener' }, 'Windows 앱 받기'), '.') : null,
    h('p', { class: 'hint' }, '쓰다가 불편한 점은 메뉴의 ‘의견 보내기’로 알려 주세요.')) });

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const r = await dialog({ title: `${s.title}  (${i + 1}/${steps.length})`, body: s.body(),
      actions: [i > 0 ? { label: '이전', value: 'back' } : { label: '건너뛰기', value: 'quit' },
        s.skip ? { label: s.skip, value: 'skip' } : null,
        { label: i === steps.length - 1 ? '시작하기' : '다음', kind: 'primary', value: 'next', run: async () => s.next ? ((await s.next()) !== false) : true }].filter(Boolean) });
    if (r === 'quit' || r === undefined) return;
    if (r === 'back') i -= 2;
  }
}
