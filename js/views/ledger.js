import { h, uid, today, won, dialog, confirmBox, toast, pad2, shrinkImage, icon } from '../util.js';
import * as db from '../db.js';
import * as sync from '../sync.js';

export const DEFAULT_CATS = {
  income: ['급여', '상여금', '보험금', '기타 수입'],
  expense: ['식재료·식품 구입비', '외식비', '미용·개인용품', '가정용 소모품', '병원비', '차량 유지비', '온라인 쇼핑', '교육비', '주거·관리비', '통신비', '경조사비', '기타 지출']
};

export async function categories() {
  const c = await db.get('ledgerCats', 'list');
  return c || DEFAULT_CATS;
}
const ym = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const prevYm = s => { const [y, m] = s.split('-').map(Number); return ym(new Date(y, m - 2, 1)); };

export async function monthSummary(month) {
  const all = await db.all('ledger');
  const sum = (mm, kind) => all.filter(e => e.date.startsWith(mm) && e.kind === kind).reduce((s, e) => s + Number(e.amount || 0), 0);
  const byCat = mm => {
    const m = new Map();
    all.filter(e => e.date.startsWith(mm) && e.kind === 'out').forEach(e => m.set(e.cat, (m.get(e.cat) || 0) + Number(e.amount || 0)));
    return m;
  };
  const p = prevYm(month);
  const budget = await db.get('ledgerBudget', month);
  return { income: sum(month, 'in'), expense: sum(month, 'out'), prevIncome: sum(p, 'in'), prevExpense: sum(p, 'out'), cats: byCat(month), prevCats: byCat(p), budget: budget ? Number(budget.amount) : 0, entries: all.filter(e => e.date.startsWith(month)) };
}

export async function mount(root) {
  let month = ym(new Date());
  const head = h('div', { class: 'view-head' });
  const body = h('div', { class: 'pad' });
  root.append(head, body);

  const draw = async () => {
    const s = await monthSummary(month);
    const cats = await categories();
    const [y, m] = month.split('-').map(Number);
    head.replaceChildren(
      h('h1', null, `${y}년 ${m}월 가계부`),
      h('button', { class: 'btn small primary rc-btn', onclick: () => snap() }, icon('camera'), ' 영수증 찍기'),
      h('button', { class: 'btn small ghost', 'aria-label': '이전 달', onclick: () => { month = prevYm(month); draw(); } }, '‹'),
      h('button', { class: 'btn small', onclick: () => { month = ym(new Date()); draw(); } }, '이번 달'),
      h('button', { class: 'btn small ghost', 'aria-label': '다음 달', onclick: () => { month = ym(new Date(y, m, 1)); draw(); } }, '›'),
      h('button', { class: 'btn small', onclick: editCats }, '항목 관리'),
      h('button', { class: 'btn small', onclick: () => editBudget(s.budget) }, '예산 설정'),
      h('button', { class: 'btn small', onclick: () => edit(null, 'in') }, '+ 수입'),
      h('button', { class: 'btn small', onclick: () => edit(null, 'out') }, '+ 지출'));
    // Spending more is shown in red; income changes stay neutral.
    const diff = (a, b, spending) => { const d = a - b; return d === 0 ? h('span', { class: 'd muted' }, '전월과 같음') : h('span', { class: 'd ' + (spending ? (d > 0 ? 'up' : 'down') : 'flat') }, `전월보다 ${won(Math.abs(d))} ${d > 0 ? '많음' : '적음'}`); };
    const used = s.budget ? Math.round(s.expense / s.budget * 100) : 0;
    const catRows = [...new Set([...s.cats.keys(), ...s.prevCats.keys()])].map(c => ({ c, v: s.cats.get(c) || 0, p: s.prevCats.get(c) || 0 })).sort((a, b) => b.v - a.v);
    const max = Math.max(1, ...catRows.map(r => r.v));
    body.replaceChildren(
      h('div', { class: 'figures' },
        h('div', { class: 'figure' }, h('div', { class: 'k' }, '총수입'), h('div', { class: 'v' }, won(s.income)), diff(s.income, s.prevIncome, false)),
        h('div', { class: 'figure' }, h('div', { class: 'k' }, '총지출'), h('div', { class: 'v' }, won(s.expense)), diff(s.expense, s.prevExpense, true)),
        h('div', { class: 'figure' }, h('div', { class: 'k' }, '남은 돈'), h('div', { class: 'v' }, won(s.income - s.expense))),
        h('div', { class: 'figure' }, h('div', { class: 'k' }, '예산 대비'),
          s.budget ? [h('div', { class: 'v' + (used > 100 ? ' up' : '') }, used + '%'), h('div', { class: 'bar' + (used > 100 ? ' over' : ''), style: { marginTop: '6px' } }, h('span', { style: { width: Math.min(100, used) + '%' } })),
            h('div', { class: 'd muted' }, `예산 ${won(s.budget)} · ${s.budget >= s.expense ? won(s.budget - s.expense) + ' 남음' : won(s.expense - s.budget) + ' 초과'}`)]
            : h('button', { class: 'btn small', style: { marginTop: '8px' }, onclick: () => editBudget(0) }, '예산 정하기'))),
      h('section', { class: 'block' }, h('h2', null, '항목별 지출'),
        catRows.length ? h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, '항목'), h('th', { style: { width: '40%' } }), h('th', { class: 'num' }, '이번 달'), h('th', { class: 'num' }, '전월'), h('th', { class: 'num' }, '증감'))),
          h('tbody', null, catRows.map(r => h('tr', null, h('td', null, r.c), h('td', null, h('div', { class: 'bar' }, h('span', { style: { width: (r.v / max * 100) + '%' } }))),
            h('td', { class: 'num' }, won(r.v)), h('td', { class: 'num muted' }, won(r.p)),
            h('td', { class: 'num ' + (r.v > r.p ? 'up' : r.v < r.p ? 'down' : 'muted') }, r.v === r.p ? '-' : (r.v > r.p ? '+' : '−') + won(Math.abs(r.v - r.p)))))))
          : h('p', { class: 'muted' }, '이번 달 지출이 없습니다.')),
      h('section', { class: 'block' }, h('h2', null, `내역 ${s.entries.length}건`),
        s.entries.length ? h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, '날짜'), h('th', null, '구분'), h('th', null, '항목'), h('th', null, '메모'), h('th', { class: 'num' }, '금액'))),
          h('tbody', null, s.entries.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt).map(e => h('tr', { class: 'clickable', onclick: () => edit(e, e.kind) },
            h('td', null, e.date.slice(5)), h('td', { class: e.kind === 'in' ? 'down' : '' }, e.kind === 'in' ? '수입' : '지출'), h('td', null, e.cat), h('td', { class: 'muted' }, e.receipt ? h('span', { class: 'rc-mark', title: '영수증 사진 있음' }, '🧾 ') : null, e.memo || ''),
            h('td', { class: 'num' }, (e.kind === 'in' ? '+' : '') + won(e.amount))))))
          : h('div', { class: 'empty' }, h('b', null, '기록이 없습니다'), '영수증을 찍거나 ‘+ 지출’로 첫 내역을 넣어 보세요.')));
    void cats;
  };

  // ---------- 영수증 찍기 → 글자 읽기 → 칸 채우기 → 저장 ----------
  const camIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) receiptSheet(f); } });
  const albumIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) receiptSheet(f); } });
  root.append(camIn, albumIn,
    h('button', { class: 'rc-fab', 'aria-label': '영수증 찍기', onclick: () => snap() }, icon('camera')));
  if (window.__pendingReceipt) { const f = window.__pendingReceipt; window.__pendingReceipt = null; setTimeout(() => receiptSheet(f), 50); }   // 폰 홈의 '영수증 찍기'
  function snap() { camIn.click(); import('../receipt.js').then(R => R.warm()).catch(() => {}); }

  async function receiptSheet(file) {
    const R = await import('../receipt.js');
    const OL = await import('../ocrlearn.js');
    let before = {};   // 학습 적용 전에 처음 읽은 값 (저장할 때 고친 것과 비교)
    const cats = await categories(), list = cats.expense;
    const shot = await shrinkImage(file, 1600, 0.82);   // 저장용 (data URL)
    let touched = new Set(), rawText = '';
    const photo = h('img', { class: 'rc-photo', src: shot, alt: '영수증 사진', onclick: () => photo.classList.toggle('big') });
    const bar = h('i'), statusText = h('span', null, '영수증 글자 읽는 중…');
    const status = h('div', { class: 'rc-status' }, h('div', { class: 'rc-prog' }, bar), statusText);
    const amount = h('input', { type: 'text', inputmode: 'numeric', class: 'rc-amount', placeholder: '0', 'aria-label': '금액',
      oninput: ev => { touched.add('amount'); const v = ev.target.value.replace(/[^\d]/g, ''); ev.target.value = v ? Number(v).toLocaleString('ko-KR') : ''; } });
    const date = h('input', { type: 'date', value: today(), oninput: () => touched.add('date') });
    const memo = h('input', { type: 'text', placeholder: '가게 이름', oninput: () => touched.add('memo') });
    let catVal = list.includes('기타 지출') ? '기타 지출' : list[list.length - 1];
    const chips = h('div', { class: 'rc-cats', role: 'radiogroup', 'aria-label': '항목' });
    const drawChips = () => chips.replaceChildren(...list.map(c => h('button', { type: 'button', class: 'rc-cat', role: 'radio', 'aria-checked': String(c === catVal), onclick: () => { catVal = c; touched.add('cat'); drawChips(); } }, c)));
    drawChips();
    const rawBox = h('pre', { class: 'rc-raw' });
    const err = h('p', { class: 'error' });
    const fill = (f, src) => {
      if (f.amount && !touched.has('amount')) amount.value = Number(f.amount).toLocaleString('ko-KR');
      if (f.date && !touched.has('date')) date.value = f.date;
      if (f.store && !touched.has('memo')) memo.value = f.store;
      const g = f.category && list.includes(f.category) ? f.category : R.guessCategory(f.store, rawText, list);
      if (g && !touched.has('cat')) { catVal = g; drawChips(); }
      const miss = [!f.amount && '금액', !f.date && '날짜'].filter(Boolean);
      statusText.textContent = (src === 'ai' ? 'AI가 읽었습니다' : '다 읽었습니다') + (f.applied && f.applied.length ? ` · 지난번에 고친 것 적용(${f.applied.join('·')})` : '') + (miss.length ? ` · ${miss.join('·')}을(를) 못 찾았어요. 직접 넣어 주세요.` : ' · 맞는지 확인하고 저장하세요.');
      status.classList.add('done'); status.classList.toggle('warn', !!miss.length);
    };
    const readLocal = async () => {
      status.classList.remove('done', 'warn'); bar.style.width = '3%'; statusText.textContent = '영수증 글자 읽는 중…';
      try {
        const got = await R.ocrFull(file, (p, label) => { bar.style.width = Math.round(p * 100) + '%'; statusText.textContent = `${label}… ${Math.round(p * 100)}%`; });
        rawText = got.text;
        rawBox.textContent = rawText.trim() || '(읽은 글자가 없습니다)';
        const opts = { ...(await OL.parseOptions()), boxes: got.boxes };
        const parsed = R.parseReceipt(rawText, opts);
        before = { ...parsed };
        const { fields, applied } = await OL.apply(parsed, rawText, (t, o) => R.parseReceipt(t, { ...opts, totalKeys: [...(o.totalKeys || []), ...opts.totalKeys] }));
        fill({ ...fields, applied }, 'local');
      } catch (e2) { statusText.textContent = '글자를 읽지 못했습니다: ' + e2.message + ' — 직접 넣거나 AI로 읽어 보세요.'; status.classList.add('done', 'warn'); }
    };
    const readAI = async () => {
      const { chat, visionModel } = await import('../openai.js');
      status.classList.remove('done', 'warn'); bar.style.width = '40%'; statusText.textContent = 'AI가 영수증을 읽는 중…';
      try {
        const out = await chat([
          { role: 'system', content: '영수증 사진에서 정보를 뽑습니다. 반드시 JSON 하나만 출력: {"store":"가게 이름","date":"YYYY-MM-DD 또는 null","total":최종 결제 금액 숫자,"category":"아래 목록 중 하나 또는 null","items":[{"name":"상품","price":숫자}]}. 항목 목록: ' + list.join(', ') },
          { role: 'user', content: [{ type: 'text', text: '이 영수증을 읽어 주세요. 오늘은 ' + today() + '입니다.' }, { type: 'image_url', image_url: { url: shot, detail: 'high' } }] }
        ], visionModel(), { kind: 'vision', ask: true, mask: false, outHint: 400 });
        const j = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
        rawText = (j.items || []).map(i => `${i.name}  ${Number(i.price || 0).toLocaleString('ko-KR')}`).join('\n');
        rawBox.textContent = [j.store, j.date, ...(rawText ? [rawText] : []), '합계 ' + (j.total || '')].filter(Boolean).join('\n');
        touched = new Set([...touched].filter(k => k === 'amount' && amount.value));   // AI 결과로 다시 채움 (직접 고친 금액은 유지)
        const ai = { amount: Number(j.total) || null, date: /^\d{4}-\d{2}-\d{2}$/.test(j.date || '') ? j.date : null, store: j.store || '', category: j.category };
        before = { ...before, ...ai };
        const { fields, applied } = await OL.apply(ai, '', null);
        fill({ ...fields, applied }, 'ai');
      } catch (e2) { statusText.textContent = e2.cancelled ? 'AI 읽기를 취소했습니다.' : 'AI로 읽지 못했습니다: ' + e2.message; status.classList.add('done', 'warn'); }
    };
    const valid = () => {
      if (!Number(amount.value.replace(/[^\d]/g, ''))) { err.textContent = '금액을 넣어 주세요.'; amount.focus(); return false; }
      if (!date.value) { err.textContent = '날짜를 골라 주세요.'; return false; }
      return true;
    };
    const save = async () => {
      if (!valid()) return false;
      const v = Number(amount.value.replace(/[^\d]/g, ''));
      const blobId = 'rcpt-' + uid();
      await db.putBlob(blobId, await (await fetch(shot)).blob(), { name: `영수증 ${date.value} ${memo.value.trim() || ''}.jpg`.replace(/\s+\.jpg$/, '.jpg') });
      await db.put('ledger', uid(), { date: date.value, kind: 'out', cat: catVal, amount: v, memo: memo.value.trim(), receipt: blobId });
      // 고친 내용 기억 (다음 영수증에 자동 적용) + 동의했으면 공동 학습에 익명으로 보냄
      let rule = null;
      try { rule = await OL.learn(before, { store: memo.value.trim(), cat: catVal, amount: v }, rawText); } catch { }
      toast(`${won(v)} 지출을 저장했습니다` + (rule ? ' · 고친 내용을 기억했어요' : ''));
      if (rule) setTimeout(async () => {
        const { prefs } = await import('../prefs.js');
        if (prefs().ocrShare === undefined && await OL.canShare()) {
          const yes = await confirmBox('영수증 인식을 다 같이 좋게 만들까요? 고친 가게 이름·항목·합계 줄 이름만 익명으로 보냅니다. 사진·금액·날짜·이메일은 보내지 않습니다. (설정에서 언제든 끌 수 있음)', '함께하기');
          await OL.setShare(yes);
        }
        OL.contribute(rule);
      }, 400);
      return true;
    };
    const r = await dialog({ title: '영수증으로 지출 넣기', wide: true,
      body: h('div', { class: 'rc-sheet' },
        h('div', { class: 'rc-left' }, photo, status),
        h('div', { class: 'rc-form' },
          h('label', { class: 'field' }, '금액 (원)', amount),
          h('div', { class: 'grid2' }, h('label', { class: 'field' }, '날짜', date), h('label', { class: 'field' }, '가게·메모', memo)),
          h('div', { class: 'field' }, '항목', chips),
          h('details', { class: 'rc-details' }, h('summary', null, '읽은 글자 보기'), rawBox),
          h('div', { class: 'row rc-tools' },
            h('button', { type: 'button', class: 'btn small ghost', onclick: () => { albumIn.click(); } }, '앨범에서 고르기'),
            h('button', { type: 'button', class: 'btn small', title: 'OpenAI로 더 정확하게 읽습니다 (1장 약 1원, 사진이 OpenAI로 전송됨)', onclick: readAI }, '✦ AI로 정확하게 읽기')),
          err)),
      actions: [{ label: '다시 찍기', run: () => { camIn.click(); return true; }, value: 'again' },
        { label: '저장하고 다음 영수증', run: async () => { if (!valid()) return false; camIn.click(); return (await save()) ? true : false; }, value: 'next' },
        { label: '저장', kind: 'primary', run: async () => (await save()) ? true : false, value: 'ok' }],
      onOpen: () => { readLocal(); } });
    if (r === 'ok' || r === 'next') draw();
  }

  function receiptThumb(id) {
    const img = h('img', { class: 'rc-thumb', alt: '영수증 사진' });
    const box = h('button', { type: 'button', class: 'rc-thumbbox', title: '크게 보기', onclick: () => { if (img.src) dialog({ title: '영수증', wide: true, body: h('img', { src: img.src, class: 'rc-full', alt: '영수증 사진' }), actions: [{ label: '닫기', kind: 'primary' }] }); } }, img, h('span', null, '🧾 영수증 사진'));
    sync.getBlob(id).then(b => { img.src = URL.createObjectURL(b); }).catch(() => { box.lastChild.textContent = '영수증 사진을 불러오지 못했습니다'; });
    return box;
  }
  async function edit(e, kind) {
    const cats = await categories();
    const list = kind === 'in' ? cats.income : cats.expense;
    const date = h('input', { type: 'date', value: e ? e.date : (month === ym(new Date()) ? today() : month + '-01') });
    const amount = h('input', { type: 'text', inputmode: 'numeric', value: e ? Number(e.amount).toLocaleString('ko-KR') : '', placeholder: '0',
      oninput: ev => { const v = ev.target.value.replace(/[^\d]/g, ''); ev.target.value = v ? Number(v).toLocaleString('ko-KR') : ''; } });
    const cat = h('select', null, list.map(c => h('option', { value: c, selected: e && e.cat === c }, c)));
    if (e && !list.includes(e.cat)) cat.append(h('option', { value: e.cat, selected: true }, e.cat));
    const memo = h('input', { type: 'text', value: e ? e.memo || '' : '', placeholder: '예: 마트, 주유' });
    const err = h('p', { class: 'error' });
    const r = await dialog({
      title: (e ? '' : '새 ') + (kind === 'in' ? '수입' : '지출') + (e ? ' 수정' : ''),
      body: [h('div', { class: 'grid2' }, h('label', { class: 'field' }, '날짜', date), h('label', { class: 'field' }, '금액 (원)', amount)), h('label', { class: 'field' }, '항목', cat), h('label', { class: 'field' }, '메모', memo),
        e && e.receipt ? receiptThumb(e.receipt) : null, err],
      onOpen: () => amount.focus(),
      actions: [
        e ? { label: '삭제', kind: 'danger', run: async close => { if (await confirmBox('이 내역을 삭제할까요?', '삭제', true)) { await db.remove('ledger', e.id); close('x'); } return false; } } : null,
        { label: '취소' },
        { label: '저장', kind: 'primary', value: 'ok', run: async () => {
          const v = Number(amount.value.replace(/[^\d]/g, ''));
          if (!v) { err.textContent = '금액을 입력해 주세요.'; return false; }
          if (!date.value) { err.textContent = '날짜를 골라 주세요.'; return false; }
          await db.put('ledger', e ? e.id : uid(), { date: date.value, kind, cat: cat.value, amount: v, memo: memo.value.trim(), ...(e && e.receipt ? { receipt: e.receipt } : {}) });
        } }
      ].filter(Boolean)
    });
    if (r === 'ok') toast('저장했습니다');
  }

  async function editBudget(current) {
    const v = h('input', { type: 'text', inputmode: 'numeric', value: current ? current.toLocaleString('ko-KR') : '',
      oninput: ev => { const x = ev.target.value.replace(/[^\d]/g, ''); ev.target.value = x ? Number(x).toLocaleString('ko-KR') : ''; } });
    const r = await dialog({ title: `${month} 지출 예산`, body: [h('label', { class: 'field' }, '월 지출 예산 (원)', v), h('p', { class: 'hint' }, '비워 두고 저장하면 이달 예산을 지웁니다.')],
      onOpen: () => v.focus(), actions: [{ label: '취소' }, { label: '저장', kind: 'primary', value: 'ok' }] });
    if (r !== 'ok') return;
    const n = Number(v.value.replace(/[^\d]/g, ''));
    if (n) await db.put('ledgerBudget', month, { amount: n }); else await db.remove('ledgerBudget', month);
    toast('예산을 저장했습니다');
  }

  // 항목 관리: each item has its own delete button; add new ones at the bottom of each list.
  async function editCats() {
    const cats = await categories();
    const work = { income: [...cats.income], expense: [...cats.expense] };
    const all = await db.all('ledger');
    const used = (kind, name) => all.filter(e => e.kind === (kind === 'income' ? 'in' : 'out') && e.cat === name).length;
    const col = kind => {
      const box = h('div', { class: 'cat-list' });
      const input = h('input', { type: 'text', placeholder: kind === 'income' ? '새 수입 항목' : '새 지출 항목' });
      const add = () => { const v = input.value.trim(); if (!v) return; if (!work[kind].includes(v)) work[kind].push(v); input.value = ''; draw(); input.focus(); };
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });
      const draw = () => box.replaceChildren(...work[kind].map((name, i) => {
        const n = used(kind, name);
        return h('div', { class: 'cat-row' },
          h('span', { class: 'grow' }, name, n ? h('span', { class: 'muted', style: { fontSize: '12px', marginLeft: '6px' } }, `기록 ${n}건`) : null),
          h('button', { type: 'button', class: 'btn small ghost', title: '위로', disabled: i === 0, onclick: () => { [work[kind][i - 1], work[kind][i]] = [work[kind][i], work[kind][i - 1]]; draw(); } }, '↑'),
          h('button', { type: 'button', class: 'btn small ghost danger', title: name + ' 삭제', onclick: () => { work[kind].splice(i, 1); draw(); } }, '삭제'));
      }));
      draw();
      return h('div', { class: 'field' }, h('b', null, kind === 'income' ? '수입 항목' : '지출 항목'), box, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, input, h('button', { type: 'button', class: 'btn small', onclick: add }, '추가')));
    };
    const r = await dialog({ title: '수입·지출 항목 관리', wide: true,
      body: [h('p', { class: 'hint' }, '항목을 지워도 이미 기록한 내역은 그대로 남습니다(그 내역의 항목 이름만 목록에서 빠짐).'), h('div', { class: 'grid2' }, col('income'), col('expense'))],
      actions: [{ label: '기본값으로', run: close => { work.income = [...DEFAULT_CATS.income]; work.expense = [...DEFAULT_CATS.expense]; close('reset'); return false; } }, { label: '취소' }, { label: '저장', kind: 'primary', value: 'ok' }] });
    if (r === 'reset') { await db.put('ledgerCats', 'list', { income: [...DEFAULT_CATS.income], expense: [...DEFAULT_CATS.expense] }); toast('기본 항목으로 되돌렸습니다'); return; }
    if (r !== 'ok') return;
    await db.put('ledgerCats', 'list', { income: work.income.length ? work.income : DEFAULT_CATS.income, expense: work.expense.length ? work.expense : DEFAULT_CATS.expense });
    toast('항목을 저장했습니다');
  }

  const onChange = e => { if (['ledger', 'ledgerCats', 'ledgerBudget'].includes(e.detail.col)) draw(); };
  db.events.addEventListener('change', onChange);
  await draw();
  return { cleanup: () => db.events.removeEventListener('change', onChange) };
}
