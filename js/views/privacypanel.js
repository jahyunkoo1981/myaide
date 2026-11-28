// 설정 › AI 정보 보호
import { h, toast } from '../util.js';
import { prefs, save as savePrefs } from '../prefs.js';
import { CATS, maskPrefs, maskText, newSession, splitTokens } from '../privacy.js';

export function privacySection() {
  const chips = h('div', { class: 'priv-words' });
  const wordIn = h('input', { placeholder: '가릴 단어 (예: 드림텍)', style: { width: '200px' } });
  const catSel = h('select', { style: { width: 'auto' } }, CATS.map(c => h('option', { value: c }, c)));
  const tryIn = h('textarea', { rows: 3, placeholder: '여기에 문장을 넣으면 AI로 어떻게 나가는지 바로 보여 줍니다.\n예) 드림텍 김영주 파트장 010-1234-5678, 예산 1,250만원' });
  const tryOut = h('div', { class: 'priv-prev', 'aria-live': 'polite' });

  const saveMask = async patch => { await savePrefs({ aiMask: { ...maskPrefs(), ...patch } }); drawWords(); drawTry(); };
  const toggle = (key, label, sub) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!maskPrefs()[key], onchange: e => saveMask({ [key]: e.target.checked }) }), label, sub ? h('small', { class: 'muted' }, ' ' + sub) : null);
  const ptoggle = (key, label, def) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: prefs()[key] ?? def, onchange: async e => { await savePrefs({ [key]: e.target.checked }); toast('저장했습니다'); } }), label);

  function drawWords() {
    const words = maskPrefs().words || [];
    chips.replaceChildren(...(words.length ? words.map((x, i) => h('span', { class: 'priv-chip' }, h('b', null, x.w), h('span', { class: 'muted' }, ' → ' + x.cat),
      h('button', { type: 'button', class: 'priv-x', 'aria-label': x.w + ' 지우기', onclick: () => saveMask({ words: words.filter((_, j) => j !== i) }) }, '×')))
      : [h('span', { class: 'muted', style: { fontSize: '13px' } }, '아직 등록한 단어가 없습니다. 회사명, 거래처, 자주 나오는 사람 이름, 내부 시스템 이름을 넣어 두세요.')]));
  }
  function drawTry() {
    const s = maskText(tryIn.value, newSession(), maskPrefs());
    tryOut.replaceChildren(...(tryIn.value ? splitTokens(s).map((p, i) => i % 2 ? h('mark', { class: 'priv-tag' }, p) : p) : [h('span', { class: 'muted' }, '결과가 여기에 보입니다.')]));
  }
  const addWord = () => {
    const w = wordIn.value.trim();
    if (!w) return;
    if (w.length > 60) return toast('60자 이하로 넣어 주세요.', 'err');
    const words = maskPrefs().words || [];
    if (words.some(x => x.w.toLowerCase() === w.toLowerCase())) return toast('이미 등록한 단어입니다.');
    saveMask({ words: [...words, { w, cat: catSel.value }] }); wordIn.value = ''; wordIn.focus();
  };
  wordIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addWord(); } });
  tryIn.addEventListener('input', drawTry);
  drawWords(); drawTry();

  return h('section', null, h('h2', null, 'AI 정보 보호'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: maskPrefs().on, onchange: e => saveMask({ on: e.target.checked }) }), h('b', null, '보내기 전에 민감한 정보 가리기'),
      h('small', { class: 'muted' }, ' AI 회사로는 [회사1] 같은 표시만 가고, 답은 이 기기에서 원래 단어로 되돌립니다.')),
    h('div', { class: 'use-opts' },
      h('b', null, '항상 가릴 단어'),
      chips,
      h('div', { class: 'row', style: { gap: '6px' } }, wordIn, catSel, h('button', { class: 'btn small primary', onclick: addWord }, '추가')),
      h('b', { style: { marginTop: '6px' } }, '자동으로 찾아 가리기'),
      toggle('contact', '전화번호 · 이메일 · 주민/계좌번호 · 인터넷 주소 · IP'),
      toggle('money', '금액', '(1,250만원, $300 등)'),
      toggle('secret', '비밀번호 · API 키처럼 보이는 문자열'),
      toggle('names', '직함 앞의 사람 이름', '(김영주 파트장 → [사람1] 파트장 · 틀릴 수 있어 기본 꺼짐)')),
    h('div', { class: 'use-opts' },
      h('b', null, '시험해 보기'), tryIn, tryOut),
    h('div', { class: 'use-opts' },
      h('b', null, '학습 위험'),
      ptoggle('aiGeminiPaid', 'Gemini 키는 결제를 연결한 유료 등급입니다 (체크하지 않으면 Gemini로 보낼 때마다 경고)', false),
      ptoggle('aiBlockRecordsOnRisk', '학습 위험이 있는 연결에는 업무 기록(일지·메모·일정)을 보내지 않기', true),
      h('p', { class: 'hint', style: { margin: 0 } }, 'OpenAI는 platform.openai.com › Organization settings › Data controls에서 입력·출력을 OpenAI와 공유하는 옵션이 꺼져 있는지 확인하세요. Claude API는 기본적으로 학습에 쓰지 않습니다.')),
    h('p', { class: 'hint' }, '업무일지·업무메모 화면의 ‘AI 제외’ 버튼을 누른 글은 AIDE 참고 자료에서 빠집니다. 녹음 받아쓰기와 사진 설명은 소리·사진을 그대로 보내야 해서 가릴 수 없습니다(받아쓴 글을 요약할 때부터 가립니다). 문장 속 업무 내용 자체는 가려지지 않으니, 정말 민감한 내용은 AI에 보내지 마세요. 단어 목록은 설정과 함께 내 Google Drive에 저장되어 다른 기기에서도 같이 쓰입니다.'));
}
