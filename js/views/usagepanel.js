// 설정 › AI 사용량·요금
import { h, dialog, toast } from '../util.js';
import { prefs, save as savePrefs } from '../prefs.js';
import { PROVIDERS } from '../openai.js';
import { monthTotal, months, krw, fmtTok, kindLabel, priceFor, usageEvents, rate } from '../usage.js';

const CONSOLES = [['OpenAI', 'https://platform.openai.com/usage'], ['Claude', 'https://platform.claude.com/usage'], ['Gemini', 'https://aistudio.google.com/usage']];

export function usageSection() {
  const p = prefs();
  const monthSel = h('select', { style: { width: 'auto' }, onchange: () => draw() });
  const out = h('div', { class: 'use-panel' });

  // 보내기 전 확인 방식
  const askName = 'ai-ask-' + Math.random().toString(36).slice(2);
  const overIn = h('input', { type: 'number', min: 1, step: 1, value: p.aiAskOver || 10, style: { width: '80px' } });
  const askOpt = (v, label) => h('label', { class: 'check' }, h('input', { type: 'radio', name: askName, value: v, checked: (p.aiAsk || 'always') === v }), label);
  const budgetIn = h('input', { type: 'number', min: 0, step: 1000, value: p.aiBudget || 0, style: { width: '110px' } });
  const rateIn = h('input', { type: 'number', min: 100, step: 10, value: p.usdKrw || 1350, style: { width: '90px' } });
  const saveOpts = async () => {
    const ask = document.querySelector(`input[name="${askName}"]:checked`)?.value || 'always';
    await savePrefs({ aiAsk: ask, aiAskOver: Math.max(1, +overIn.value || 10), aiBudget: Math.max(0, +budgetIn.value || 0), usdKrw: Math.max(100, +rateIn.value || 1350) });
    toast('사용료 설정을 저장했습니다'); draw();
  };

  async function draw() {
    const list = await months(), now = new Date(), cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const want = monthSel.value || cur;
    const all = list.includes(cur) ? list : [cur, ...list];
    monthSel.replaceChildren(...all.map(m => h('option', { value: m, selected: m === want }, m.replace('-', '년 ') + '월')));
    const t = await monthTotal(want), budget = +prefs().aiBudget || 0, spentKrw = t.usd * rate();
    const pct = budget ? Math.min(100, spentKrw / budget * 100) : 0;
    const models = Object.entries(t.byModel).sort((a, b) => b[1].usd - a[1].usd);
    const kinds = Object.entries(t.byKind).sort((a, b) => b[1].usd - a[1].usd);
    out.replaceChildren(...[
      h('div', { class: 'use-sum' },
        h('div', { class: 'use-big' }, h('small', null, '사용 금액 (추정)'), h('strong', null, krw(t.usd)), h('small', null, `$${t.usd.toFixed(4)} · 환율 ${rate().toLocaleString('ko-KR')}원`)),
        h('div', { class: 'use-stat' }, h('small', null, '입력 토큰'), h('b', null, fmtTok(t.inTok))),
        h('div', { class: 'use-stat' }, h('small', null, '출력 토큰'), h('b', null, fmtTok(t.outTok))),
        h('div', { class: 'use-stat' }, h('small', null, '요청 수'), h('b', null, fmtTok(t.calls)))),
      budget ? h('div', { class: 'use-bar' + (pct >= 100 ? ' over' : pct >= 80 ? ' warn' : '') }, h('i', { style: { width: pct + '%' } }), h('span', null, `월 한도 ${budget.toLocaleString('ko-KR')}원 중 ${Math.round(pct)}%`)) : null,
      models.length ? h('table', { class: 'use-table' },
        h('thead', null, h('tr', null, ...['모델', '요청', '입력', '출력', '금액'].map(x => h('th', null, x)))),
        h('tbody', null, ...models.map(([m, v]) => h('tr', null, h('td', null, m), h('td', null, fmtTok(v.calls)), h('td', null, fmtTok(v.inTok)), h('td', null, fmtTok(v.outTok)), h('td', null, krw(v.usd)))))) :
        h('p', { class: 'hint', style: { margin: 0 } }, '이 달에는 AI를 쓴 기록이 없습니다.'),
      kinds.length ? h('div', { class: 'chips' }, ...kinds.map(([k, v]) => h('span', { class: 'chip static' }, `${kindLabel(k)} ${fmtTok(v.calls)}회 · ${krw(v.usd)}`)),
        ...(t.byDevice.length > 1 ? t.byDevice.map(d => h('span', { class: 'chip static' }, `${d.device} ${krw(d.usd)}`)) : [])) : null,
      t.recent.length ? h('details', { class: 'use-recent' }, h('summary', null, `최근 요청 ${Math.min(30, t.recent.length)}건`),
        h('table', { class: 'use-table' }, h('tbody', null, ...t.recent.slice(0, 30).map(e => h('tr', null,
          h('td', null, new Date(e.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
          h('td', null, `${kindLabel(e.kind)}${e.device ? ' · ' + e.device : ''}`), h('td', null, e.model),
          h('td', null, e.seconds && !e.inTok ? `${Math.round(e.seconds / 6) / 10}분` : `${fmtTok(e.inTok)} / ${fmtTok(e.outTok)}`),
          h('td', null, krw(e.usd) + (e.estimated ? '*' : ''))))))) : null].filter(Boolean));
  }

  async function editPrices() {
    const t = await monthTotal();
    const names = [...new Set([...Object.values(PROVIDERS).flatMap(v => v.fallback), ...Object.keys((prefs().aiModels) || {}).map(k => prefs().aiModels[k]), ...Object.keys(t.byModel), 'gpt-4o-mini-transcribe', 'text-embedding-3-small'])].filter(Boolean);
    const rows = names.map(m => {
      const pr = priceFor(m), i = h('input', { type: 'number', step: 'any', min: 0, value: pr.in }), o = h('input', { type: 'number', step: 'any', min: 0, value: pr.out });
      return { m, i, o, pr, el: h('tr', null, h('td', null, m, pr.known ? null : h('small', { class: 'muted' }, ' (단가 모름)'), pr.custom ? h('small', { class: 'muted' }, ' (직접 입력)') : null), h('td', null, i), h('td', null, o)) };
    });
    const r = await dialog({ title: 'AI 단가표 (100만 토큰당 달러)', wide: true, body: [
      h('p', { class: 'hint', style: { margin: 0 } }, '2026년 11월 공개 단가가 들어 있습니다. 회사가 값을 바꾸면 여기서 고치세요. 받아쓰기는 분당 0.003달러로 계산합니다.'),
      h('div', { class: 'use-prices' }, h('table', { class: 'use-table' }, h('thead', null, h('tr', null, h('th', null, '모델'), h('th', null, '입력'), h('th', null, '출력'))), h('tbody', null, ...rows.map(x => x.el))))],
      actions: [{ label: '기본값으로', value: 'reset' }, { label: '취소' }, { label: '저장', kind: 'primary', value: 'ok' }] });
    if (r === 'reset') { await savePrefs({ aiPrices: {} }); toast('단가를 기본값으로 되돌렸습니다'); draw(); return; }
    if (r !== 'ok') return;
    const custom = { ...(prefs().aiPrices || {}) };
    for (const x of rows) {
      const a = +x.i.value, b = +x.o.value;
      if (a !== x.pr.in || b !== x.pr.out) custom[x.m] = [a, b];
    }
    await savePrefs({ aiPrices: custom }); toast('단가표를 저장했습니다'); draw();
  }

  usageEvents.addEventListener('call', () => setTimeout(() => out.isConnected && draw(), 400));
  draw();
  return h('section', null, h('h2', null, 'AI 사용량·요금'),
    h('div', { class: 'row' }, monthSel, h('span', { class: 'grow' }), h('button', { class: 'btn small ghost', onclick: () => draw() }, '↻'), h('button', { class: 'btn small', onclick: editPrices }, '단가표')),
    out,
    h('div', { class: 'use-opts' },
      h('b', null, 'AI에 보내기 전 사용료 확인'),
      askOpt('always', '항상 예상 금액을 보여 주고 확인받기'),
      h('label', { class: 'check' }, h('input', { type: 'radio', name: askName, value: 'over', checked: p.aiAsk === 'over' }), '예상 금액이 ', overIn, '원을 넘을 때만 확인받기'),
      askOpt('never', '묻지 않고 기록만 하기'),
      h('div', { class: 'row' }, h('label', { class: 'row', style: { gap: '6px' } }, 'MY AIDE 월 한도', budgetIn, '원'), h('label', { class: 'row', style: { gap: '6px' } }, '환율 1달러 =', rateIn, '원'),
        h('span', { class: 'grow' }), h('button', { class: 'btn small primary', onclick: saveOpts }, '사용료 설정 저장')),
      h('p', { class: 'hint', style: { margin: 0 } }, '월 한도를 0보다 크게 정하면, 한도를 넘는 요청은 위 설정과 관계없이 항상 한 번 더 묻습니다. 0이면 한도 없음.')),
    h('p', { class: 'hint' }, '금액은 각 서비스가 알려 준 실제 토큰 수에 단가표를 곱한 추정치입니다(* 표시는 토큰 수를 받지 못해 추정한 값). 정확한 청구액은 ',
      ...CONSOLES.flatMap(([n, u], i) => [i ? ', ' : '', h('a', { href: u, target: '_blank', rel: 'noopener' }, n)]), ' 사용량 화면에서 확인하세요. 사진 검색(의미 검색)은 1회 0.001원 미만이라 묻지 않고 기록만 합니다.'));
}
