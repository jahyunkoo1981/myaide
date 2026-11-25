// AI 마인드맵: organise thoughts as a map. Keyboard first (Tab = 하위, Enter = 형제, F2/더블클릭 = 고치기),
// and AI can turn free-form notes into a map, grow a branch, or summarise the map.
import { h, uid, debounce, confirmBox, toast, dialog, download, copyText } from '../util.js';
import * as db from '../db.js';
import { chat } from '../openai.js';

const COL = 'mindmaps';
const BRANCH = ['#7480DD', '#4FA98C', '#D9889C', '#E0A86A', '#9A8BBE', '#5AA6C8', '#B9A34E', '#C77FB8'];
const SOFT = { '#7480DD': '#EEF0FD', '#4FA98C': '#E6F5EF', '#D9889C': '#FBEEF1', '#E0A86A': '#FDF3E7', '#9A8BBE': '#F2EFF8', '#5AA6C8': '#E8F4FA', '#B9A34E': '#F7F3E2', '#C77FB8': '#F9EDF6' };
const H_GAP = 56, V_GAP = 14;

const newNode = text => ({ id: uid(), text, children: [] });

export async function mount(root, ctx) {
  let items = [], openId = null, map = null, sel = null, editing = null;
  let view = { x: 0, y: 0, k: 1 };
  const list = h('div', { class: 'list' });
  const search = h('input', { type: 'search', placeholder: '마인드맵 검색' });
  const pane = h('section', { class: 'editor-pane mm-pane' });
  const split = h('div', { class: 'split' },
    h('aside', { class: 'list-pane' },
      h('div', { class: 'list-tools' },
        h('div', { class: 'row' }, h('strong', { class: 'grow', style: { fontSize: '17px' } }, 'AI 마인드맵'),
          h('button', { class: 'btn small primary', onclick: () => create() }, '+ 새 맵')),
        h('button', { class: 'btn small', onclick: fromThoughts }, '✦ 생각을 붙여 넣고 AI로 정리'),
        search),
      list),
    pane);
  root.append(split);

  const load = async () => { items = (await db.all(COL)).sort((a, b) => b.updatedAt - a.updatedAt); };
  const drawList = () => {
    const q = search.value.trim().toLowerCase();
    const shown = items.filter(i => !q || JSON.stringify(i.root || {}).toLowerCase().includes(q) || (i.title || '').toLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown.map(i => h('button', { class: 'list-item', 'aria-selected': String(i.id === openId), onclick: () => ctx.go('mindmap', i.id) },
      h('div', { class: 't' }, i.title || i.root?.text || '제목 없음'),
      h('div', { class: 's' }, (i.root?.children || []).map(c => c.text).join(' · ') || ' '))) : [h('div', { class: 'list-empty' }, q ? '검색 결과가 없습니다.' : '‘새 맵’을 만들거나, 머릿속 생각을 그대로 붙여 넣고 AI로 정리해 보세요.')]));
  };

  async function create(rootNode) {
    const id = uid();
    const r = rootNode || { ...newNode('중심 생각'), children: [newNode('생각 1'), newNode('생각 2'), newNode('생각 3')] };
    await db.put(COL, id, { title: r.text, root: r, createdAt: Date.now() });
    ctx.go('mindmap', id);
  }

  // ---------- saving ----------
  const state = h('span', { class: 'save-state' });
  const saveNow = async () => { if (!map || !openId) return; map.title = map.root.text; await db.put(COL, openId, { title: map.title, root: map.root, createdAt: map.createdAt || Date.now() }); state.textContent = '저장됨'; };
  const save = debounce(saveNow, 600);
  const changed = () => { state.textContent = '저장 중…'; save(); render(); };

  // ---------- tree helpers ----------
  const walk = (n, fn, parent = null, depth = 0, branch = null) => { fn(n, parent, depth, branch); (n.children || []).forEach((c, i) => walk(c, fn, n, depth + 1, depth === 0 ? (c.color || BRANCH[i % BRANCH.length]) : branch)); };
  const find = id => { let r = null; walk(map.root, (n, p) => { if (n.id === id) r = { n, p }; }); return r; };

  // ---------- canvas ----------
  const stage = h('div', { class: 'mm-stage' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('mm-links');
  const layer = h('div', { class: 'mm-layer' }, svg);
  stage.append(layer);
  const applyView = () => { layer.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`; };

  let boxes = new Map();   // id -> {x, y, w, h, side, depth, color}
  function render() {
    if (!map) return;
    // 1) draw node elements and measure them
    const seen = new Set();
    walk(map.root, (n, p, depth, color) => {
      const hidden = isHidden(n.id);
      let el = layer.querySelector(`[data-id="${n.id}"]`);
      if (hidden) { if (el) el.remove(); return; }
      seen.add(n.id);
      if (!el) {
        el = h('div', { class: 'mm-node', 'data-id': n.id, tabindex: '-1' });
        el.addEventListener('pointerdown', e => { e.stopPropagation(); select(n.id); });
        el.addEventListener('dblclick', e => { e.stopPropagation(); edit(n.id); });
        layer.append(el);
      }
      el.className = 'mm-node d' + Math.min(depth, 3) + (sel === n.id ? ' sel' : '') + (n.collapsed && n.children.length ? ' folded' : '');
      el.style.setProperty('--c', depth === 0 ? '#6B74D6' : color);
      el.style.setProperty('--cs', depth === 0 ? '#EEF0FD' : SOFT[color] || '#F3F4F9');
      if (editing !== n.id) el.textContent = n.text || ' ';
      if (n.collapsed && n.children.length) el.dataset.count = countAll(n); else delete el.dataset.count;
    });
    layer.querySelectorAll('.mm-node').forEach(el => { if (!seen.has(el.dataset.id)) el.remove(); });
    // 2) layout: first-level branches alternate right / left, each side stacked by subtree height
    boxes = new Map();
    const size = n => { const el = layer.querySelector(`[data-id="${n.id}"]`); return { w: el.offsetWidth, h: el.offsetHeight }; };
    const kids = n => n.collapsed ? [] : n.children;
    const heightOf = n => { const s = size(n); const k = kids(n); if (!k.length) return s.h; return Math.max(s.h, k.reduce((a, c) => a + heightOf(c), 0) + V_GAP * (k.length - 1)); };
    const place = (n, x, yTop, side, depth, color) => {
      const s = size(n), hh = heightOf(n);
      const y = yTop + hh / 2 - s.h / 2;
      const bx = side > 0 ? x : x - s.w;
      boxes.set(n.id, { x: bx, y, w: s.w, h: s.h, side, depth, color });
      let cy = yTop + (hh - (kids(n).reduce((a, c) => a + heightOf(c), 0) + V_GAP * Math.max(0, kids(n).length - 1))) / 2;
      for (const c of kids(n)) { const ch = heightOf(c); place(c, side > 0 ? bx + s.w + H_GAP : bx - H_GAP, cy, side, depth + 1, color); cy += ch + V_GAP; }
    };
    const r = map.root, rs = size(r);
    boxes.set(r.id, { x: -rs.w / 2, y: -rs.h / 2, w: rs.w, h: rs.h, side: 0, depth: 0 });
    const right = [], left = [];
    kids(r).forEach((c, i) => (c.side ? (c.side > 0 ? right : left) : (i % 2 === 0 ? right : left)).push([c, c.color || BRANCH[i % BRANCH.length]]));
    for (const [arr, side] of [[right, 1], [left, -1]]) {
      const total = arr.reduce((a, [c]) => a + heightOf(c), 0) + V_GAP * 2 * Math.max(0, arr.length - 1);
      let y = -total / 2;
      for (const [c, col] of arr) { place(c, side > 0 ? rs.w / 2 + H_GAP + 10 : -rs.w / 2 - H_GAP - 10, y, side, 1, col); y += heightOf(c) + V_GAP * 2; }
    }
    // 3) position and connect
    let paths = '';
    walk(map.root, (n, p) => {
      const b = boxes.get(n.id); if (!b) return;
      const el = layer.querySelector(`[data-id="${n.id}"]`);
      el.style.transform = `translate(${b.x}px, ${b.y}px)`;
      if (!p) return;
      const a = boxes.get(p.id);
      const x1 = b.side > 0 ? a.x + a.w : a.x, y1 = a.y + a.h / 2;
      const x2 = b.side > 0 ? b.x : b.x + b.w, y2 = b.depth >= 2 ? b.y + b.h : b.y + b.h / 2;
      const mx = (x1 + x2) / 2;
      const w = b.depth === 1 ? 3.2 : 1.8;
      paths += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" stroke="${b.color}" stroke-width="${w}" fill="none" stroke-linecap="round" opacity="${b.depth === 1 ? .75 : .6}"/>`;
      if (b.depth >= 2) paths += `<path d="M${b.x},${y2} H${b.x + b.w}" stroke="${b.color}" stroke-width="1.8" opacity=".6"/>`;
    });
    svg.innerHTML = paths;
  }
  const countAll = n => n.children.reduce((a, c) => a + 1 + countAll(c), 0);
  const isHidden = id => { let hidden = false; const chk = (n, under) => { if (n.id === id) hidden = under; n.children.forEach(c => chk(c, under || n.collapsed)); }; chk(map.root, false); return hidden; };

  const center = () => { const r = stage.getBoundingClientRect(); view = { x: r.width / 2, y: r.height / 2, k: view.k || 1 }; applyView(); };
  const fitAll = () => {
    const r = stage.getBoundingClientRect(); let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    boxes.forEach(b => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
    const k = Math.min(1.2, Math.max(.35, Math.min((r.width - 60) / (x1 - x0 || 1), (r.height - 60) / (y1 - y0 || 1))));
    view = { k, x: r.width / 2 - (x0 + x1) / 2 * k, y: r.height / 2 - (y0 + y1) / 2 * k }; applyView();
  };

  // pan with drag, zoom with wheel
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('.mm-node')) return;
    commitEdit(); select(null);
    const sx = e.clientX - view.x, sy = e.clientY - view.y;
    stage.setPointerCapture(e.pointerId); stage.classList.add('panning');
    const mv = ev => { view.x = ev.clientX - sx; view.y = ev.clientY - sy; applyView(); };
    const up = () => { stage.removeEventListener('pointermove', mv); stage.classList.remove('panning'); };
    stage.addEventListener('pointermove', mv); stage.addEventListener('pointerup', up, { once: true });
  });
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const r = stage.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const k = Math.min(2.5, Math.max(.25, view.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    view.x = px - (px - view.x) * k / view.k; view.y = py - (py - view.y) * k / view.k; view.k = k; applyView();
  }, { passive: false });

  // ---------- selection & editing ----------
  function select(id) {
    sel = id;
    layer.querySelectorAll('.mm-node').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
    if (id) layer.querySelector(`[data-id="${id}"]`)?.focus({ preventScroll: true }); else stage.focus({ preventScroll: true });
  }
  function edit(id, selectAll = true) {
    commitEdit();
    const el = layer.querySelector(`[data-id="${id}"]`); if (!el) return;
    editing = id; select(id);
    el.contentEditable = 'plaintext-only'; el.classList.add('editing'); el.focus();
    const range = document.createRange(); range.selectNodeContents(el); if (!selectAll) range.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(range);
    el.oninput = () => render();
    el.onblur = () => commitEdit();
  }
  function commitEdit() {
    if (!editing) return;
    const id = editing; editing = null;
    const el = layer.querySelector(`[data-id="${id}"]`);
    const f = find(id);
    if (el) { el.contentEditable = 'false'; el.classList.remove('editing'); el.oninput = el.onblur = null; }
    if (f && el) { const t = el.textContent.replace(/\s+/g, ' ').trim(); if (t !== f.n.text) { f.n.text = t || '새 생각'; changed(); } else render(); }
  }
  function addChild(id) {
    const f = find(id || sel || map.root.id); if (!f) return;
    const n = newNode(''); f.n.collapsed = false; f.n.children.push(n);
    changed(); edit(n.id);
  }
  function addSibling() {
    const f = find(sel); if (!f) return;
    if (!f.p) return addChild(f.n.id);
    const n = newNode(''); f.p.children.splice(f.p.children.indexOf(f.n) + 1, 0, n);
    changed(); edit(n.id);
  }
  async function removeSel() {
    const f = find(sel); if (!f || !f.p) return;
    if (f.n.children.length && !await confirmBox(`‘${f.n.text}’과(와) 하위 ${countAll(f.n)}개를 지울까요?`, '삭제', true)) return;
    const i = f.p.children.indexOf(f.n); f.p.children.splice(i, 1);
    sel = (f.p.children[i] || f.p.children[i - 1] || f.p).id; changed(); select(sel);
  }
  const toggleFold = () => { const f = find(sel); if (f && f.n.children.length) { f.n.collapsed = !f.n.collapsed; changed(); } };
  function move(dir) {
    const f = find(sel); if (!f) { select(map.root.id); return; }
    const b = boxes.get(f.n.id);
    if (dir === 'up' || dir === 'down') {
      if (!f.p) return;
      const sibs = f.p.children.filter(c => boxes.get(c.id)?.side === b.side);
      const i = sibs.indexOf(f.n) + (dir === 'up' ? -1 : 1);
      if (sibs[i]) select(sibs[i].id);
      return;
    }
    const outward = (dir === 'right') === (b.side >= 0);
    if (outward) { const k = f.n.collapsed ? [] : f.n.children.filter(c => !f.p ? (boxes.get(c.id)?.side > 0) === (dir === 'right') : true); if (k[0]) select(k[0].id); }
    else if (f.p) select(f.p.id);
  }
  stage.tabIndex = 0;
  stage.addEventListener('keydown', e => {
    if (editing) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commitEdit(); select(sel); }
      if (e.key === 'Tab' && !e.isComposing) { e.preventDefault(); const id = editing; commitEdit(); addChild(id); }
      if (e.key === 'Escape') { e.preventDefault(); commitEdit(); select(sel); }
      return;
    }
    const k = e.key;
    if (k === 'Tab') { e.preventDefault(); addChild(); }
    else if (k === 'Enter') { e.preventDefault(); sel ? addSibling() : addChild(); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeSel(); }
    else if (k === 'F2') { e.preventDefault(); if (sel) edit(sel, false); }
    else if (k === ' ') { e.preventDefault(); toggleFold(); }
    else if (k.startsWith('Arrow')) { e.preventDefault(); move(k.slice(5).toLowerCase()); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && sel) { edit(sel); }
  });

  // ---------- AI ----------
  const mapToText = (n, d = 0) => '  '.repeat(d) + '- ' + n.text + '\n' + (n.children || []).map(c => mapToText(c, d + 1)).join('');
  const parseTree = txt => {
    const j = JSON.parse(txt.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    const conv = o => ({ id: uid(), text: String(o.text || o.title || '').slice(0, 120) || '생각', children: (o.children || []).slice(0, 12).map(conv) });
    return conv(j);
  };
  const TREE_RULE = '반드시 JSON 하나만 출력하세요: {"text":"...","children":[{"text":"...","children":[...]}]}. 각 text는 25자 이내 핵심어구로, 깊이는 3단계 이내, 한 가지당 하위는 2~6개로 하세요. 사용자가 말하지 않은 사실을 지어내지 말고 생각을 묶고 이름 붙이는 데 집중하세요.';
  async function busy(label, fn) {
    const t = h('div', { class: 'mm-busy' }, label); stage.append(t);
    try { return await fn(); } catch (e) { toast(e.message, 'err'); } finally { t.remove(); }
  }
  async function aiExpand() {
    const f = find(sel || map.root.id); if (!f) return;
    await busy('AI가 가지를 펼치는 중…', async () => {
      const out = await chat([{ role: 'system', content: '당신은 생각 정리를 돕는 코치입니다. 한국어로 답합니다. ' + TREE_RULE },
        { role: 'user', content: `아래 마인드맵에서 「${f.n.text}」 아래에 이어질 하위 생각 3~6개를 제안하세요. 이미 있는 하위 항목과 겹치지 않게 하세요. 루트 text는 「${f.n.text}」로 두세요.\n\n${mapToText(map.root)}` }]);
      const t = parseTree(out);
      f.n.collapsed = false; f.n.children.push(...t.children);
      changed(); toast(`${t.children.length}개를 추가했습니다`);
    });
  }
  async function aiSummary() {
    await busy('AI가 정리하는 중…', async () => {
      const out = await chat([{ role: 'system', content: '당신은 생각 정리를 돕는 코치입니다. 한국어로 간결하게 답합니다.' },
        { role: 'user', content: '이 마인드맵을 바탕으로 ①핵심 요약 3줄 ②빠진 관점이나 질문 2~3개 ③바로 할 일 3개를 정리해 주세요.\n\n' + mapToText(map.root) }]);
      await dialog({ title: 'AI 정리', wide: false, body: h('div', { class: 'msg ai', style: { whiteSpace: 'pre-wrap' } }, out),
        actions: [{ label: '복사', run: () => { copyText(out); return false; } }, { label: '닫기', kind: 'primary' }] });
    });
  }
  async function fromThoughts() {
    const ta = h('textarea', { rows: 10, placeholder: '머릿속 생각을 순서 없이 그대로 적거나 붙여 넣으세요.\n예) 다음 달 MES 개선… 설비 알람이 너무 많음… 현장 교육은 언제? 예산은 상반기에…' });
    const r = await dialog({ title: '생각을 AI로 정리', body: [ta, h('p', { class: 'hint', style: { margin: 0 } }, 'AI가 주제별로 묶어 마인드맵을 새로 만듭니다. OpenAI API 키가 필요합니다.')],
      onOpen: () => ta.focus(), actions: [{ label: '취소' }, { label: '마인드맵 만들기', kind: 'primary', value: 'ok' }] });
    if (r !== 'ok' || !ta.value.trim()) return;
    const t = h('div', { class: 'toast' }, 'AI가 생각을 정리하는 중…'); document.getElementById('toasts').append(t);
    try {
      const out = await chat([{ role: 'system', content: '당신은 생각 정리를 돕는 코치입니다. 한국어로 답합니다. 사용자의 생각 메모를 주제별로 묶어 마인드맵으로 만듭니다. 중심(root) text는 메모 전체를 대표하는 짧은 제목입니다. ' + TREE_RULE },
        { role: 'user', content: ta.value.slice(0, 12000) }]);
      await create(parseTree(out));
    } catch (e) { toast(e.message, 'err'); } finally { t.remove(); }
  }

  // ---------- export ----------
  function exportPng() {
    commitEdit();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    boxes.forEach(b => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
    const P = 40, S = 2;
    const c = document.createElement('canvas'); c.width = (x1 - x0 + P * 2) * S; c.height = (y1 - y0 + P * 2) * S;
    const g = c.getContext('2d'); g.scale(S, S); g.translate(P - x0, P - y0);
    g.fillStyle = '#FBFBFE'; g.fillRect(x0 - P, y0 - P, x1 - x0 + P * 2, y1 - y0 + P * 2);
    const img = new Image();
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${x1 - x0}" height="${y1 - y0}" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}">${svg.innerHTML}</svg>`;
    img.onload = () => {
      g.drawImage(img, x0, y0);
      const ff = getComputedStyle(document.body).fontFamily;
      layer.querySelectorAll('.mm-node').forEach(el => {
        const b = boxes.get(el.dataset.id); if (!b) return;
        const cs = getComputedStyle(el);
        g.save();
        if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') { g.fillStyle = cs.backgroundColor; roundRect(g, b.x, b.y, b.w, b.h, parseFloat(cs.borderTopLeftRadius) || 0); g.fill(); }
        if (parseFloat(cs.borderTopWidth)) { g.strokeStyle = cs.borderTopColor; g.lineWidth = parseFloat(cs.borderTopWidth); roundRect(g, b.x, b.y, b.w, b.h, parseFloat(cs.borderTopLeftRadius) || 0); g.stroke(); }
        g.fillStyle = cs.color; g.font = `${cs.fontWeight} ${cs.fontSize} ${ff}`; g.textBaseline = 'middle';
        g.fillText(el.textContent, b.x + parseFloat(cs.paddingLeft), b.y + b.h / 2);
        g.restore();
      });
      c.toBlob(bl => download((map.root.text || '마인드맵') + '.png', bl));
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  }

  // ---------- open ----------
  async function open(id) {
    if (map) save.flush();
    commitEdit();
    openId = id; map = null; sel = null;
    split.classList.toggle('has-open', !!id);
    if (!id) { pane.replaceChildren(h('div', { class: 'pad empty' }, h('b', null, 'AI 마인드맵'), '왼쪽에서 맵을 고르거나 새로 만드세요. 머릿속 생각을 붙여 넣으면 AI가 주제별로 묶어 줍니다.')); drawList(); return; }
    const data = await db.get(COL, id);
    if (!data) { pane.replaceChildren(h('div', { class: 'pad empty' }, h('b', null, '찾을 수 없습니다'), '삭제되었거나 아직 동기화되지 않았습니다.')); drawList(); return; }
    map = JSON.parse(JSON.stringify(data));
    layer.querySelectorAll('.mm-node').forEach(el => el.remove());
    const tb = (label, fn, title) => h('button', { type: 'button', title: title || label, onclick: () => { fn(); if (!editing) stage.focus({ preventScroll: true }); } }, label);
    const colorBtn = h('button', { type: 'button', title: '가지 색 바꾸기', onclick: () => {
      const f = find(sel); if (!f || !f.p) { toast('색을 바꿀 가지를 먼저 고르세요'); return; }
      let top = f; while (top.p && top.p !== map.root) top = find(top.p.id);
      const i = BRANCH.indexOf(top.n.color || BRANCH[map.root.children.indexOf(top.n) % BRANCH.length]);
      top.n.color = BRANCH[(i + 1) % BRANCH.length]; layer.querySelectorAll('.mm-node').forEach(el => el.remove()); changed();
    } }, '색');
    const sideBtn = h('button', { type: 'button', title: '선택한 큰 가지를 왼쪽/오른쪽으로 옮기기', onclick: () => {
      const f = find(sel); if (!f || f.p !== map.root) { toast('중심 바로 아래 가지를 고르세요'); return; }
      f.n.side = (boxes.get(f.n.id)?.side || 1) > 0 ? -1 : 1; changed();
    } }, '좌우');
    pane.replaceChildren(
      h('div', { class: 'doc-meta', style: { padding: '12px 18px 0' } },
        h('button', { class: 'btn small ghost back-btn', onclick: () => ctx.go('mindmap') }, '‹ 목록'), state, h('span', { class: 'grow' }),
        h('button', { class: 'btn small', onclick: exportPng }, 'PNG로 저장'),
        h('button', { class: 'btn small', onclick: () => copyText(mapToText(map.root), '목록 형태로 복사했습니다') }, '텍스트 복사'),
        h('button', { class: 'btn small ghost danger', onclick: async () => {
          if (!await confirmBox(`‘${map.root.text}’ 마인드맵을 삭제할까요?`, '삭제', true)) return;
          save.cancel(); await db.remove(COL, id); toast('삭제했습니다'); ctx.go('mindmap');
        } }, '삭제')),
      h('div', { class: 'toolbar mm-tools' },
        tb('+ 하위', () => addChild(), 'Tab'), tb('+ 같은 단계', addSibling, 'Enter'), tb('고치기', () => sel && edit(sel, false), 'F2 또는 더블클릭'),
        tb('접기/펴기', toggleFold, 'Space'), tb('삭제', removeSel, 'Delete'), colorBtn, sideBtn,
        h('span', { class: 'gap' }), tb('✦ AI로 가지 펼치기', aiExpand, '선택한 생각 아래에 AI가 이어질 생각을 제안'), tb('✦ AI 정리·할 일', aiSummary),
        h('span', { class: 'gap' }), tb('전체 보기', fitAll), tb('－', () => { view.k = Math.max(.25, view.k / 1.2); applyView(); }), tb('＋', () => { view.k = Math.min(2.5, view.k * 1.2); applyView(); })),
      stage,
      h('div', { class: 'mm-help' }, 'Tab 하위 · Enter 같은 단계 · F2 고치기 · Space 접기 · Delete 삭제 · 방향키 이동 · 빈 곳을 끌어 이동, 휠로 확대'));
    center(); render(); requestAnimationFrame(() => { render(); fitAll(); select(map.root.id); });
    drawList();
  }

  search.addEventListener('input', drawList);
  const onChange = async ev => {
    if (ev.detail.col !== COL) return;
    await load(); drawList();
    if (ev.detail.id === openId && !editing && state.textContent !== '저장 중…') {
      const d = await db.get(COL, openId);
      if (d && JSON.stringify(d.root) !== JSON.stringify(map.root)) { map = JSON.parse(JSON.stringify(d)); render(); }
    }
  };
  db.events.addEventListener('change', onChange);
  const onResize = () => map && render();
  window.addEventListener('resize', onResize);
  await load();
  await open(ctx.param);
  return { open, cleanup: () => { commitEdit(); save.flush(); db.events.removeEventListener('change', onChange); window.removeEventListener('resize', onResize); } };
}

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
