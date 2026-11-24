// Handwriting pad: pen strokes kept as vectors so they can be re-opened, erased stroke by stroke, or cleared.
import { h, dialog } from './util.js';

const W = 1200, H = 700;
const COLORS = ['#1D2A30', '#3346C8', '#E5484D', '#1F7A4D'];

export function openInkPad(initial) {
  let strokes = Array.isArray(initial) ? JSON.parse(JSON.stringify(initial)) : [];
  let tool = 'pen', color = COLORS[0], width = 3, drawing = null;
  const canvas = h('canvas', { width: W, height: H, 'aria-label': '손글씨 영역' });
  const ctx = canvas.getContext('2d');

  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#EEF2F1'; ctx.lineWidth = 1;
    for (let y = 50; y < H; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    for (const s of strokes) paint(s);
  };
  const paint = s => {
    ctx.strokeStyle = s.c; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 1; i < s.p.length; i++) {
      const [x0, y0, p0] = s.p[i - 1], [x1, y1, p1] = s.p[i];
      ctx.lineWidth = s.w * (0.6 + ((p0 + p1) / 2) * 0.8);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    if (s.p.length === 1) { ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(s.p[0][0], s.p[0][1], s.w / 2, 0, 7); ctx.fill(); }
  };
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) * W / r.width), Math.round((e.clientY - r.top) * H / r.height), e.pressure && e.pointerType !== 'mouse' ? e.pressure : 0.5];
  };
  const eraseAt = ([x, y]) => {
    const before = strokes.length;
    strokes = strokes.filter(s => !s.p.some(([px, py]) => Math.hypot(px - x, py - y) < 14));
    if (strokes.length !== before) draw();
  };
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    if (tool === 'erase' || e.button === 5) { drawing = 'erase'; eraseAt(p); return; }
    drawing = { c: color, w: width, p: [p] }; strokes.push(drawing); paint(drawing);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    for (const ev of e.getCoalescedEvents ? e.getCoalescedEvents() : [e]) {
      const p = pos(ev);
      if (drawing === 'erase') { eraseAt(p); continue; }
      drawing.p.push(p);
      const n = drawing.p.length;
      ctx.strokeStyle = drawing.c; ctx.lineWidth = drawing.w * (0.6 + p[2] * 0.8); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(drawing.p[n - 2][0], drawing.p[n - 2][1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    }
  });
  const end = () => { drawing = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);

  const toolSeg = h('div', { class: 'seg' });
  const setTool = t => { tool = t; [...toolSeg.children].forEach(b => b.setAttribute('aria-pressed', b.dataset.t === t)); };
  toolSeg.append(h('button', { type: 'button', 'data-t': 'pen', onclick: () => setTool('pen') }, '펜'),
    h('button', { type: 'button', 'data-t': 'erase', onclick: () => setTool('erase') }, '획 지우개'));
  setTool('pen');
  const swatches = COLORS.map(c => h('button', { type: 'button', class: 'swatch', style: { background: c }, 'aria-label': '펜 색', 'aria-pressed': String(c === color),
    onclick: e => { color = c; setTool('pen'); swatches.forEach(s => s.setAttribute('aria-pressed', String(s === e.currentTarget))); } }));
  const widthSel = h('select', { style: { width: 'auto' }, onchange: e => { width = Number(e.target.value); } },
    [['2', '가늘게'], ['3', '보통'], ['6', '굵게']].map(([v, t]) => h('option', { value: v, selected: v === '3' }, t)));

  draw();
  return dialog({
    title: '손글씨', wide: true,
    body: h('div', { class: 'inkpad' },
      h('div', { class: 'row' }, toolSeg, ...swatches, widthSel,
        h('button', { class: 'btn small', type: 'button', onclick: () => { strokes.pop(); draw(); } }, '되돌리기'),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => { strokes = []; draw(); } }, '전체 지우기')),
      canvas,
      h('p', { class: 'hint' }, '애플 펜슬·펜은 필압이 반영됩니다. 넣은 손글씨는 문서에서 두 번 눌러 다시 고칠 수 있습니다.')),
    actions: [{ label: '취소', value: null }, { label: '넣기', kind: 'primary', run: () => {} , value: 'ok' }]
  }).then(v => {
    if (v !== 'ok') return null;
    if (!strokes.length) return { strokes: [], dataUrl: '' };
    // Crop to the written area so the image doesn't carry a big blank page.
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const s of strokes) for (const [x, y] of s.p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const m = 24; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W, x1 + m); y1 = Math.min(H, y1 + m);
    const out = document.createElement('canvas'); out.width = x1 - x0; out.height = y1 - y0;
    // Export on white without the guide lines.
    const o = out.getContext('2d');
    o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height);
    o.translate(-x0, -y0);
    for (const s of strokes) {
      o.strokeStyle = s.c; o.lineCap = 'round'; o.lineJoin = 'round';
      for (let i = 1; i < s.p.length; i++) { const [a, b, p0] = s.p[i - 1], [c, d, p1] = s.p[i]; o.lineWidth = s.w * (0.6 + ((p0 + p1) / 2) * 0.8); o.beginPath(); o.moveTo(a, b); o.lineTo(c, d); o.stroke(); }
      if (s.p.length === 1) { o.fillStyle = s.c; o.beginPath(); o.arc(s.p[0][0], s.p[0][1], s.w / 2, 0, 7); o.fill(); }
    }
    return { strokes, dataUrl: out.toDataURL('image/png') };
  });
}
