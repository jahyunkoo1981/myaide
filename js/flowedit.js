// Process diagram editor (Visio-style), used inside documents: 업무메모 etc. insert a diagram as a picture
// that keeps its drawing data, so double-clicking it opens this editor again.
// Shapes from the left palette (click or drag), connect by dragging from the blue dots, double-click to type.
import { h, uid, toast, download } from './util.js';

const COL = 'notes';
const NS = 'http://www.w3.org/2000/svg';
const GRID = 10;
const PAIRS = [
  ['#FFFFFF', '#8D92A6'], ['#EEF0FD', '#7480DD'], ['#E6F5EF', '#4FA98C'], ['#FDF3E7', '#E0A86A'],
  ['#FBEEF1', '#D9889C'], ['#F2EFF8', '#9A8BBE'], ['#E8F4FA', '#5AA6C8'], ['#F7F3E2', '#B9A34E'], ['#F3F4F9', '#B5B9C9']
];
const STROKE_OF = Object.fromEntries(PAIRS);
const SHAPES = {
  terminator: { label: '시작/끝', w: 140, h: 52, fill: '#E6F5EF', text: '시작' },
  process: { label: '처리', w: 160, h: 70, fill: '#EEF0FD', text: '처리' },
  decision: { label: '판단', w: 150, h: 96, fill: '#FDF3E7', text: '조건?' },
  data: { label: '입력/출력', w: 160, h: 66, fill: '#F2EFF8', text: '데이터' },
  document: { label: '문서', w: 150, h: 76, fill: '#E8F4FA', text: '문서' },
  database: { label: 'DB/시스템', w: 120, h: 86, fill: '#F7F3E2', text: 'DB' },
  prep: { label: '준비', w: 160, h: 64, fill: '#FBEEF1', text: '준비' },
  circle: { label: '연결점', w: 64, h: 64, fill: '#FFFFFF', text: 'A' },
  note: { label: '메모', w: 160, h: 80, fill: '#FFF7DA', stroke: '#E3C565', text: '메모' },
  text: { label: '글자', w: 140, h: 36, fill: 'none', stroke: 'none', text: '글자' },
  lane: { label: '구역(레인)', w: 640, h: 200, fill: '#F7F8FC', stroke: '#C9CDDD', text: '담당 부서' }
};

function shapePath(t, x, y, w, hh) {
  const r = Math.min(10, w / 4, hh / 4);
  switch (t) {
    case 'terminator': { const q = hh / 2; return `M${x + q},${y} H${x + w - q} A${q},${q} 0 0 1 ${x + w - q},${y + hh} H${x + q} A${q},${q} 0 0 1 ${x + q},${y} Z`; }
    case 'decision': return `M${x + w / 2},${y} L${x + w},${y + hh / 2} L${x + w / 2},${y + hh} L${x},${y + hh / 2} Z`;
    case 'data': { const s = Math.min(24, w * .18); return `M${x + s},${y} H${x + w} L${x + w - s},${y + hh} H${x} Z`; }
    case 'document': { const a = hh * .14; return `M${x},${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hh - a} C${x + w * .75},${y + hh - a * 2.6} ${x + w * .25},${y + hh + a * .9} ${x},${y + hh - a} Z`; }
    case 'database': { const e = Math.min(14, hh * .16); return `M${x},${y + e} A${w / 2},${e} 0 0 1 ${x + w},${y + e} V${y + hh - e} A${w / 2},${e} 0 0 1 ${x},${y + hh - e} Z M${x},${y + e} A${w / 2},${e} 0 0 0 ${x + w},${y + e}`; }
    case 'prep': { const s = Math.min(22, w * .16); return `M${x + s},${y} H${x + w - s} L${x + w},${y + hh / 2} L${x + w - s},${y + hh} H${x + s} L${x},${y + hh / 2} Z`; }
    case 'circle': return `M${x + w / 2},${y} A${w / 2},${hh / 2} 0 1 1 ${x + w / 2 - .01},${y} Z`;
    case 'note': { const f = 16; return `M${x},${y} H${x + w - f} L${x + w},${y + f} V${y + hh} H${x} Z M${x + w - f},${y} V${y + f} H${x + w}`; }
    case 'lane': return `M${x + 8},${y} H${x + w - 8} Q${x + w},${y} ${x + w},${y + 8} V${y + hh - 8} Q${x + w},${y + hh} ${x + w - 8},${y + hh} H${x + 8} Q${x},${y + hh} ${x},${y + hh - 8} V${y + 8} Q${x},${y} ${x + 8},${y} Z`;
    default: return `M${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hh - r} Q${x + w},${y + hh} ${x + w - r},${y + hh} H${x + r} Q${x},${y + hh} ${x},${y + hh - r} V${y + r} Q${x},${y} ${x + r},${y} Z`;
  }
}

const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v); return e; };
const measureCtx = document.createElement('canvas').getContext('2d');
function wrap(text, maxW, size, weight) {
  measureCtx.font = `${weight} ${size}px ${getComputedStyle(document.body).fontFamily}`;
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const ch of para.split(/(?<=\s)|(?=\s)/)) {
      // break long words character by character (Korean has few spaces)
      for (const piece of measureCtx.measureText(ch).width > maxW ? [...ch] : [ch]) {
        if (line && measureCtx.measureText(line + piece).width > maxW) { out.push(line.trim()); line = piece.trimStart(); }
        else line += piece;
      }
    }
    out.push(line.trim());
  }
  return out;
}

const blank = () => ({ nodes: [], edges: [] });
const starter = () => {
  const n = (type, x, y, text) => ({ id: uid(), type, x, y, w: SHAPES[type].w, h: SHAPES[type].h, text, fill: SHAPES[type].fill, stroke: SHAPES[type].stroke || STROKE_OF[SHAPES[type].fill] });
  const a = n('terminator', 90, 60, '요청 접수'), b = n('process', 80, 170, '내용 검토'), c = n('decision', 85, 300, '승인?'), d = n('process', 330, 313, '보완 요청'), e = n('terminator', 90, 460, '처리 완료');
  const E = (f, t, label = '') => ({ id: uid(), from: f.id, to: t.id, label, route: 'orth' });
  return { nodes: [a, b, c, d, e], edges: [E(a, b), E(b, c), E(c, e, 'OK'), E(c, d, 'NG'), E(d, b)] };
};


export function createFlowEditor(initial, { onChange, name = '프로세스' } = {}) {
  let flow = JSON.parse(JSON.stringify(initial && initial.nodes ? initial : blank()));
  let sel = new Set(), selEdge = null, selLabel = null, view = { x: 40, y: 30, k: 1 };
  let lastPtr = 'mouse';   // 'touch' on phones/tablets
  let undo = [], redo = [];
  let lastSnap = JSON.stringify(flow);
  const snapshot = () => { const s = JSON.stringify(flow); if (s !== lastSnap) { undo.push(lastSnap); if (undo.length > 80) undo.shift(); redo = []; lastSnap = s; } };
  const commit = () => { snapshot(); onChange && onChange(); draw(); };
  const restore = s => { flow = JSON.parse(s || JSON.stringify(blank())); lastSnap = s; sel = new Set([...sel].filter(id => byId(id))); selEdge = null; onChange && onChange(); draw(); };
  const doUndo = () => { if (!undo.length) return; redo.push(lastSnap); restore(undo.pop()); };
  const doRedo = () => { if (!redo.length) return; undo.push(lastSnap); restore(redo.pop()); };
  const byId = id => flow.nodes.find(n => n.id === id);
  const snap = v => Math.round(v / GRID) * GRID;

  // ---------- canvas ----------
  const svg = el('svg', { class: 'fl-svg', tabindex: '0' });
  svg.innerHTML = `<defs>
    <pattern id="fl-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#DADDE8"/></pattern>
    <filter id="fl-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#262A3B" flood-opacity=".10"/></filter>
    <marker id="fl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 Z" fill="context-stroke"/></marker>
    <marker id="fl-arrow-c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 Z" fill="#8D92A6"/></marker>
    <marker id="fl-arrow-s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 Z" fill="#6B74D6"/></marker>
  </defs>`;
  const gridRect = el('rect', { x: -5000, y: -5000, width: 10000, height: 10000, fill: 'url(#fl-grid)' });
  const world = el('g');
  const gLanes = el('g'), gEdges = el('g'), gNodes = el('g'), gUi = el('g');
  world.append(gridRect, gLanes, gEdges, gNodes, gUi);
  svg.append(world);
  const applyView = () => world.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  const toWorld = e => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }; };

  // Connection points sit on the drawn outline, not the bounding box (slanted and wavy shapes are inset).
  const portPt = (n, p) => {
    let inX = 0, botY = n.y + n.h;
    if (n.type === 'data') inX = Math.min(24, n.w * .18) / 2;
    if (n.type === 'document') botY = n.y + n.h - n.h * .14 * .8875;
    return ({ top: { x: n.x + n.w / 2, y: n.y, d: [0, -1] }, right: { x: n.x + n.w - inX, y: n.y + n.h / 2, d: [1, 0] }, bottom: { x: n.x + n.w / 2, y: botY, d: [0, 1] }, left: { x: n.x + inX, y: n.y + n.h / 2, d: [-1, 0] } })[p];
  };
  const PORTS = ['top', 'right', 'bottom', 'left'];
  const nearPort = (n, p, reach) => { let best = null, bd = reach; for (const k of PORTS) { const q = portPt(n, k); const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = k; } } return best; };
  // Lines leaving a 판단(조건) shape get OK / NG automatically; the user can change or delete them.
  function newEdge(from, fromPort, to) {
    const e = { id: uid(), from, fromPort, to, route: 'orth' };
    const src = byId(from);
    if (src && src.type === 'decision') {
      const used = new Set(flow.edges.filter(x => x.from === from).map(x => (x.label || '').toUpperCase()));
      e.label = !used.has('OK') ? 'OK' : !used.has('NG') ? 'NG' : '';
    }
    return e;
  }
  const autoPorts = (a, b) => {
    const dx = (b.x + b.w / 2) - (a.x + a.w / 2), dy = (b.y + b.h / 2) - (a.y + a.h / 2);
    if (Math.abs(dy) >= Math.abs(dx) * .8) return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
    return dx > 0 ? ['right', 'left'] : ['left', 'right'];
  };
  function edgePoints(e) {
    const a = byId(e.from), b = byId(e.to); if (!a || !b) return null;
    const [ap, bp] = autoPorts(a, b);
    const p1 = portPt(a, e.fromPort || ap), p2 = portPt(b, e.toPort || bp);
    if (e.route === 'straight') return [p1, p2];
    // Ports facing each other with a gap between them: go straight across (one bend in the middle if offset).
    if (p1.d[0] && p2.d[0] === -p1.d[0] && (p2.x - p1.x) * p1.d[0] > 4) {
      if (Math.abs(p1.y - p2.y) < 1) return [p1, { x: p2.x, y: p1.y }];
      const mx = (p1.x + p2.x) / 2; return [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
    }
    if (p1.d[1] && p2.d[1] === -p1.d[1] && (p2.y - p1.y) * p1.d[1] > 4) {
      if (Math.abs(p1.x - p2.x) < 1) return [p1, { x: p1.x, y: p2.y }];
      const my = (p1.y + p2.y) / 2; return [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
    }
    const G = 18;
    const s = { x: p1.x + p1.d[0] * G, y: p1.y + p1.d[1] * G }, t = { x: p2.x + p2.d[0] * G, y: p2.y + p2.d[1] * G };
    let mid;
    if (p1.d[0] !== 0 && p2.d[0] !== 0) { const mx = (s.x + t.x) / 2; mid = [{ x: mx, y: s.y }, { x: mx, y: t.y }]; }
    else if (p1.d[1] !== 0 && p2.d[1] !== 0) { const my = (s.y + t.y) / 2; mid = [{ x: s.x, y: my }, { x: t.x, y: my }]; }
    else if (p1.d[0] !== 0) mid = [{ x: t.x, y: s.y }];
    else mid = [{ x: s.x, y: t.y }];
    const clean = pts => pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > .5 || Math.abs(p.y - pts[i - 1].y) > .5);
    const simple = clean([p1, s, ...mid, t, p2]);
    // Lines never run through a shape: if the quick route would, find a way around (shapes padded by M).
    const M = 12;
    const obs = flow.nodes.filter(n => n.type !== 'lane').map(n => ({ x0: n.x - M, y0: n.y - M, x1: n.x + n.w + M, y1: n.y + n.h + M }))
      .filter(r => !(s.x > r.x0 && s.x < r.x1 && s.y > r.y0 && s.y < r.y1) && !(t.x > r.x0 && t.x < r.x1 && t.y > r.y0 && t.y < r.y1));
    const hits = (a, b) => obs.some(r => Math.abs(a.y - b.y) < .5
      ? a.y > r.y0 && a.y < r.y1 && Math.max(a.x, b.x) > r.x0 && Math.min(a.x, b.x) < r.x1
      : a.x > r.x0 && a.x < r.x1 && Math.max(a.y, b.y) > r.y0 && Math.min(a.y, b.y) < r.y1);
    const inner = simple.slice(1, -1);
    let bad = false; for (let i = 1; i < inner.length; i++) if (hits(inner[i - 1], inner[i])) { bad = true; break; }
    if (!bad) return simple;
    const way = routeAround(s, t, p1.d, p2.d, obs, hits);
    return way ? clean([p1, ...way, p2]) : simple;
  }
  // Shortest orthogonal path from s to t over a sparse grid made of the padded shape edges; each turn costs extra.
  function routeAround(s, t, d1, d2, obs, hits) {
    const uniq = a => [...new Set(a.map(v => Math.round(v * 2) / 2))].sort((m, n) => m - n);
    let X = [s.x, t.x, (s.x + t.x) / 2], Y = [s.y, t.y, (s.y + t.y) / 2];
    for (const r of obs) X.push(r.x0, r.x1), Y.push(r.y0, r.y1);
    X = uniq(X); Y = uniq(Y);
    const nx = X.length, ny = Y.length, DX = [1, 0, -1, 0], DY = [0, 1, 0, -1], BEND = 40;
    const dirOf = d => d[0] > 0 ? 0 : d[1] > 0 ? 1 : d[0] < 0 ? 2 : 3;
    const si = X.indexOf(Math.round(s.x * 2) / 2), sj = Y.indexOf(Math.round(s.y * 2) / 2);
    const ti = X.indexOf(Math.round(t.x * 2) / 2), tj = Y.indexOf(Math.round(t.y * 2) / 2);
    if (si < 0 || sj < 0 || ti < 0 || tj < 0) return null;
    const endDir = dirOf([-d2[0], -d2[1]]);
    const N = nx * ny * 4, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const heap = []; // [cost, state]
    const push = (c, st) => { heap.push([c, st]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const S0 = ((sj * nx) + si) * 4 + dirOf(d1); dist[S0] = 0; push(0, S0);
    let best = -1, bestCost = Infinity;
    while (heap.length) {
      const [c, st] = pop(); if (c > dist[st] || c >= bestCost) continue;
      const dir = st & 3, cell = st >> 2, i = cell % nx, j = (cell / nx) | 0;
      if (i === ti && j === tj && dir !== (endDir + 2) % 4) { const f = c + (dir === endDir ? 0 : BEND); if (f < bestCost) { bestCost = f; best = st; } continue; }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (dir + 2) % 4) continue;
        const ni = i + DX[nd], nj = j + DY[nd]; if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        const a = { x: X[i], y: Y[j] }, b = { x: X[ni], y: Y[nj] };
        if (hits(a, b)) continue;
        const nc = c + Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + (nd === dir ? 0 : BEND), ns = ((nj * nx) + ni) * 4 + nd;
        if (nc < dist[ns]) { dist[ns] = nc; prev[ns] = st; push(nc, ns); }
      }
    }
    if (best < 0) return null;
    const out = []; for (let st = best; st >= 0; st = prev[st]) { const cell = st >> 2; out.push({ x: X[cell % nx], y: Y[(cell / nx) | 0] }); }
    out.reverse();
    return out.filter((p, k) => { const a = out[k - 1], b = out[k + 1]; return !a || !b || !((Math.abs(a.x - p.x) < .5 && Math.abs(b.x - p.x) < .5) || (Math.abs(a.y - p.y) < .5 && Math.abs(b.y - p.y) < .5)); });
  }
  // Visio-style line jumps: where a horizontal piece of a line crosses a vertical piece of another line,
  // the horizontal one hops over it with a small arc.
  const HOP = 8;
  function computeHops(all) {
    const segs = [];   // vertical pieces of every orthogonal line
    all.forEach(({ e, pts }) => { if ((e.route || 'orth') === 'curve') return; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; if (Math.abs(a.x - b.x) < .5 && Math.abs(a.y - b.y) > .5) segs.push({ id: e.id, x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) }); } });
    const out = new Map();
    all.forEach(({ e, pts }) => {
      if ((e.route || 'orth') === 'curve') return;
      const hops = {};
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (Math.abs(a.y - b.y) > .5 || Math.abs(a.x - b.x) < .5) continue;
        const lo = Math.min(a.x, b.x) + HOP + 1, hi = Math.max(a.x, b.x) - HOP - 1;   // corners next to a jump get tighter (see pathOf)
        const xs = segs.filter(v => v.id !== e.id && v.x > lo && v.x < hi && a.y > v.y0 + 2 && a.y < v.y1 - 2).map(v => v.x);
        const uniq = [...new Set(xs.map(x => Math.round(x)))].sort((m, n) => b.x > a.x ? m - n : n - m);
        const kept = []; for (const x of uniq) if (!kept.length || Math.abs(x - kept[kept.length - 1]) >= HOP * 2 + 2) kept.push(x);
        if (kept.length) hops[i] = kept;
      }
      out.set(e.id, hops);
    });
    return out;
  }
  function hopSeg(from, to, xs) {
    if (!xs || Math.abs(from.y - to.y) > .5) return '';
    const dir = to.x > from.x ? 1 : -1; let d = '';
    for (const x of xs) {
      if ((x - from.x) * dir <= HOP || (to.x - x) * dir <= HOP) continue;
      d += ` L${x - dir * HOP},${to.y} A${HOP},${HOP} 0 0 ${dir > 0 ? 1 : 0} ${x + dir * HOP},${to.y}`;
    }
    return d;
  }
  function pathOf(pts, route, hops = {}) {
    if (route === 'curve' && pts.length >= 2) {
      const a = pts[0], b = pts[pts.length - 1], d = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 2.5);
      const p1 = pts[1] || a, p2 = pts[pts.length - 2] || b;
      const c1 = { x: a.x + Math.sign(p1.x - a.x) * d * (p1.x !== a.x ? 1 : 0), y: a.y + Math.sign(p1.y - a.y) * d * (p1.y !== a.y ? 1 : 0) };
      const c2 = { x: b.x + Math.sign(p2.x - b.x) * d * (p2.x !== b.x ? 1 : 0), y: b.y + Math.sign(p2.y - b.y) * d * (p2.y !== b.y ? 1 : 0) };
      return `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`;
    }
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = pts[i + 1];
      const prev = pts[i - 1];
      d += hopSeg(prev, p, hops[i]);
      if (!q || route === 'straight') { d += ` L${p.x},${p.y}`; continue; }
      let r = Math.min(10, Math.hypot(p.x - prev.x, p.y - prev.y) / 2, Math.hypot(q.x - p.x, q.y - p.y) / 2);
      // keep the rounded corner clear of a jump arc on either side of it
      for (const x of [...(hops[i] || []), ...(hops[i + 1] || [])]) r = Math.min(r, Math.max(0, Math.abs(p.x - x) - HOP - .5));
      const a = { x: p.x - Math.sign(p.x - prev.x) * r, y: p.y - Math.sign(p.y - prev.y) * r };
      const b = { x: p.x + Math.sign(q.x - p.x) * r, y: p.y + Math.sign(q.y - p.y) * r };
      d += ` L${a.x},${a.y} Q${p.x},${p.y} ${b.x},${b.y}`;
    }
    return d;
  }
  // Where an edge's words go: just below a horizontal line, just left of a vertical one; the user can drag them.
  const LABEL_H = 22;
  function labelBox(e, pts) {
    let L = 0; const seg = []; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(l); L += l; }
    let half = L / 2, m = pts[0], vertical = false;
    for (let i = 1; i < pts.length; i++) { if (half <= seg[i - 1]) { const t = half / (seg[i - 1] || 1); m = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }; vertical = Math.abs(pts[i].x - pts[i - 1].x) < .5; break; } half -= seg[i - 1]; }
    measureCtx.font = `600 12.5px ${getComputedStyle(document.body).fontFamily}`;
    const w = measureCtx.measureText(e.label || '').width + 16;
    const cx = vertical ? m.x - 6 - w / 2 : m.x, cy = vertical ? m.y : m.y + 6 + LABEL_H / 2;
    return { x: cx + (e.lx || 0), y: cy + (e.ly || 0), w, h: LABEL_H };
  }
  const midOf = pts => { // point halfway along the polyline, for labels
    let L = 0; const seg = []; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(l); L += l; }
    let half = L / 2; for (let i = 1; i < pts.length; i++) { if (half <= seg[i - 1]) { const t = half / (seg[i - 1] || 1); return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }; } half -= seg[i - 1]; }
    return pts[0];
  };

  function drawNode(n) {
    const S = SHAPES[n.type] || SHAPES.process;
    const g = el('g', { class: 'fl-node' + (sel.has(n.id) ? ' sel' : ''), 'data-id': n.id });
    const fill = n.fill || S.fill, stroke = n.stroke || S.stroke || STROKE_OF[fill] || '#8D92A6';
    if (n.type === 'lane') {
      g.append(el('path', { d: shapePath('lane', n.x, n.y, n.w, n.h), fill, stroke, 'stroke-width': 1.5, 'stroke-dasharray': '6 4' }));
      g.append(el('path', { d: `M${n.x + 8},${n.y} H${n.x + 36} V${n.y + n.h} H${n.x + 8} Q${n.x},${n.y + n.h} ${n.x},${n.y + n.h - 8} V${n.y + 8} Q${n.x},${n.y} ${n.x + 8},${n.y} Z`, fill: stroke, opacity: .18 }));
      const t = el('text', { x: n.x + 18, y: n.y + n.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 14, 'font-weight': 700, fill: '#565C72', transform: `rotate(-90 ${n.x + 18} ${n.y + n.h / 2})` });
      t.textContent = n.text || ''; g.append(t);
      return g;
    }
    const sh = el('path', { d: shapePath(n.type, n.x, n.y, n.w, n.h), fill: fill === 'none' ? 'transparent' : fill, stroke: stroke === 'none' ? 'transparent' : stroke, 'stroke-width': n.type === 'text' ? 0 : 1.6, filter: ['text', 'circle'].includes(n.type) ? null : 'url(#fl-shadow)', 'stroke-linejoin': 'round' });
    g.append(sh);
    const size = n.fontSize || 14, weight = n.bold ? 700 : 560;
    const pad = n.type === 'decision' ? n.w * .22 : n.type === 'data' || n.type === 'prep' ? 22 : 12;
    const lines = wrap(n.text, Math.max(20, n.w - pad * 2), size, weight);
    const lh = size * 1.35, top = n.y + n.h / 2 - (lines.length - 1) * lh / 2 - (n.type === 'document' ? n.h * .05 : 0) + (n.type === 'database' ? 5 : 0);
    const t = el('text', { 'text-anchor': 'middle', 'font-size': size, 'font-weight': weight, fill: n.color || '#262A3B' });
    lines.forEach((line, i) => { const sp = el('tspan', { x: n.x + n.w / 2, y: top + i * lh, 'dominant-baseline': 'middle' }); sp.textContent = line; t.append(sp); });
    g.append(t);
    return g;
  }
  function draw() {
    if (!flow) return;
    gLanes.replaceChildren(); gNodes.replaceChildren(); gEdges.replaceChildren(); gUi.replaceChildren();
    for (const n of flow.nodes) (n.type === 'lane' ? gLanes : gNodes).append(drawNode(n));
    const routed = flow.edges.map(e => ({ e, pts: edgePoints(e) })).filter(r => r.pts);
    const hopMap = flow.jumps === false ? new Map() : computeHops(routed);
    const bridges = [];
    for (const { e, pts } of routed) {
      if (drag && drag.kind === 'end' && drag.e === e) continue;
      const d = pathOf(pts, e.route || 'orth', hopMap.get(e.id));
      const g = el('g', { class: 'fl-edge' + (selEdge === e.id ? ' sel' : ''), 'data-edge': e.id });
      const color = selEdge === e.id ? '#6B74D6' : (e.color || '#8D92A6');
      g.append(el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 14, class: 'hit' }));
      g.append(el('path', { d, fill: 'none', stroke: color, 'stroke-width': selEdge === e.id ? 2.4 : 1.8, 'stroke-dasharray': e.dash ? '6 5' : null, 'marker-end': e.arrow === 'none' ? null : (selEdge === e.id ? 'url(#fl-arrow-s)' : 'url(#fl-arrow-c)'), 'marker-start': e.arrow === 'both' ? (selEdge === e.id ? 'url(#fl-arrow-s)' : 'url(#fl-arrow-c)') : null, 'stroke-linejoin': 'round' }));
      if (e.label) {
        const b = labelBox(e, pts), on = selLabel === e.id;
        const lg = el('g', { class: 'fl-label' + (on ? ' sel' : ''), 'data-label': e.id });
        lg.append(el('rect', { x: b.x - b.w / 2, y: b.y - b.h / 2, width: b.w, height: b.h, rx: 11, fill: on ? '#EEF0FD' : '#fff', stroke: on ? '#6B74D6' : '#E3E5EE', 'stroke-width': on ? 1.6 : 1 }));
        const t = el('text', { x: b.x, y: b.y + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 12.5, 'font-weight': 650, fill: /^(NG|아니오|NO)$/i.test(e.label) ? '#B5546B' : /^(OK|예|YES)$/i.test(e.label) ? '#2F8467' : '#565C72' }); t.textContent = e.label; lg.append(t);
        g.append(lg);
      }
      gEdges.append(g);
      // the bridge: a white gap under each jump hides the line passing beneath, then the arc on top
      const hops = hopMap.get(e.id);
      if (hops) {
        let arcs = '';
        for (const [i, xs] of Object.entries(hops)) {
          const a = pts[i - 1], b = pts[i], dir = b.x > a.x ? 1 : -1;
          for (const x of xs) arcs += `M${x - dir * HOP},${b.y} A${HOP},${HOP} 0 0 ${dir > 0 ? 1 : 0} ${x + dir * HOP},${b.y} `;
        }
        if (arcs) bridges.push([arcs, color, selEdge === e.id ? 2.4 : 1.8, e.dash]);
      }
    }
    for (const [d, color, w, dash] of bridges) {
      gEdges.append(el('path', { d, fill: 'none', stroke: '#FDFDFF', 'stroke-width': 7, 'stroke-linecap': 'butt', 'pointer-events': 'none' }));
      gEdges.append(el('path', { d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-dasharray': dash ? '6 5' : null, 'pointer-events': 'none' }));
    }
    // selection chrome
    const k = view.k;
    const se = selEdge && flow.edges.find(x => x.id === selEdge);
    if (se && !(drag && drag.kind === 'end')) {
      const pts = edgePoints(se);
      if (pts) for (const [end, q] of [['from', pts[0]], ['to', pts[pts.length - 1]]])
        gUi.append(el('circle', { cx: q.x, cy: q.y, r: 6.5 / k, fill: '#6B74D6', stroke: '#fff', 'stroke-width': 2 / k, class: 'fl-end', 'data-end': end, style: 'cursor:move' }));
    }
    for (const id of sel) {
      const n = byId(id); if (!n) continue;
      gUi.append(el('rect', { x: n.x - 4, y: n.y - 4, width: n.w + 8, height: n.h + 8, rx: 6, fill: 'none', stroke: '#6B74D6', 'stroke-width': 1.4 / k, 'stroke-dasharray': `${4 / k} ${3 / k}`, 'pointer-events': 'none' }));
      if (sel.size === 1) for (const [hx, hy, c] of [[n.x, n.y, 'nw'], [n.x + n.w, n.y, 'ne'], [n.x, n.y + n.h, 'sw'], [n.x + n.w, n.y + n.h, 'se']])
        gUi.append(el('rect', { x: hx - 5 / k, y: hy - 5 / k, width: 10 / k, height: 10 / k, rx: 2 / k, fill: '#fff', stroke: '#6B74D6', 'stroke-width': 1.5 / k, class: 'fl-handle', 'data-handle': c, style: `cursor:${c}-resize` }));
    }
    // phones have no hover: the selected shape shows its (bigger) connection dots instead
    const portNode = hoverId && byId(hoverId) ? hoverId : (lastPtr === 'touch' && sel.size === 1 && !typing ? [...sel][0] : null);
    if (portNode && byId(portNode) && byId(portNode).type !== 'lane') {
      const n = byId(portNode), pr = (lastPtr === 'touch' ? 10 : 5.5) / k;
      for (const p of ['top', 'right', 'bottom', 'left']) { const pt = portPt(n, p); gUi.append(el('circle', { cx: pt.x, cy: pt.y, r: pr, fill: '#fff', stroke: '#6B74D6', 'stroke-width': 2 / k, class: 'fl-port', 'data-port': p, 'data-node': n.id })); }
    }
    if (guides.length) for (const gd of guides) gUi.append(el('line', { ...gd, stroke: '#D9889C', 'stroke-width': 1 / k, 'stroke-dasharray': `${4 / k} ${3 / k}` }));
    if (wire) gUi.append(el('path', { d: `M${wire.x1},${wire.y1} L${wire.x2},${wire.y2}`, stroke: '#6B74D6', 'stroke-width': 1.8 / k, 'stroke-dasharray': `${5 / k} ${4 / k}`, 'marker-end': 'url(#fl-arrow-s)' }));
    if (marquee) { const r = normRect(marquee); gUi.append(el('rect', { ...r, fill: 'rgba(107,116,214,.08)', stroke: '#6B74D6', 'stroke-width': 1 / k })); }
    drawPanel();
  }
  const normRect = m => ({ x: Math.min(m.x1, m.x2), y: Math.min(m.y1, m.y2), width: Math.abs(m.x2 - m.x1), height: Math.abs(m.y2 - m.y1) });

  // ---------- pointer interaction ----------
  let hoverId = null, guides = [], wire = null, marquee = null, drag = null, spaceDown = false;
  const nodeAt = (p, skipLanes) => { for (let i = flow.nodes.length - 1; i >= 0; i--) { const n = flow.nodes[i]; if (skipLanes && n.type === 'lane') continue; if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h) { if (n.type === 'lane' && p.x > n.x + 36 && !skipLanes) continue; return n; } } return null; };

  svg.addEventListener('pointermove', e => {
    if (!flow) return;
    const p = toWorld(e);
    if (drag) return onDrag(e, p);
    const t = e.target;
    const over = t.closest?.('.fl-node')?.dataset.id || (t.classList?.contains('fl-port') ? t.dataset.node : null) || null;
    const n = over || (nodeAt(p, true)?.id ?? null);
    if (n !== hoverId) { hoverId = n; draw(); }
  });
  // Phones: no double-click and the keyboard only opens when a text box is focused during the tap itself,
  // so double-taps are detected here and editing starts inside the pointerup handler.
  let down = null, lastTap = null;
  const tapId = t => { const lg = t.closest?.('.fl-label'); if (lg) return 'e:' + lg.dataset.label; const eg = t.closest?.('.fl-edge'); if (eg) return 'e:' + eg.dataset.edge; const ng = t.closest?.('.fl-node'); return ng ? 'n:' + ng.dataset.id : null; };
  svg.addEventListener('pointerdown', e => {
    if (!flow) return;
    lastPtr = e.pointerType || 'mouse';
    down = { x: e.clientX, y: e.clientY, id: tapId(e.target) };
    if (lastPtr !== 'touch') svg.focus({ preventScroll: true });
    commitText();
    const p = toWorld(e), t = e.target;
    svg.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || spaceDown) { drag = { kind: 'pan', sx: e.clientX - view.x, sy: e.clientY - view.y }; svg.classList.add('panning'); return; }
    if (t.classList.contains('fl-end')) {
      const ed = flow.edges.find(x => x.id === selEdge); const pts = edgePoints(ed);
      const fixed = t.dataset.end === 'to' ? pts[0] : pts[pts.length - 1];
      drag = { kind: 'end', e: ed, end: t.dataset.end };
      wire = { from: null, fx: fixed.x, fy: fixed.y, x1: fixed.x, y1: fixed.y, x2: p.x, y2: p.y, end: t.dataset.end };
      draw(); return;
    }
    if (t.classList.contains('fl-port')) { const n = byId(t.dataset.node), pt = portPt(n, t.dataset.port); wire = { from: n.id, port: t.dataset.port, x1: pt.x, y1: pt.y, x2: p.x, y2: p.y }; drag = { kind: 'wire' }; return; }
    if (t.classList.contains('fl-handle')) { const n = byId([...sel][0]); drag = { kind: 'resize', c: t.dataset.handle, n, o: { ...n } }; return; }
    const labelG = t.closest('.fl-label');
    if (labelG) {
      const ed = flow.edges.find(x => x.id === labelG.dataset.label);
      selLabel = ed.id; selEdge = null; sel.clear();
      drag = { kind: 'label', e: ed, p0: p, lx: ed.lx || 0, ly: ed.ly || 0, moved: false };
      draw(); return;
    }
    selLabel = null;
    const edgeG = t.closest('.fl-edge');
    if (edgeG) { selEdge = edgeG.dataset.edge; sel.clear(); draw(); return; }
    const nodeG = t.closest('.fl-node');
    const n = nodeG ? byId(nodeG.dataset.id) : null;
    if (n) {
      selEdge = null;
      if (e.shiftKey || e.ctrlKey) { sel.has(n.id) ? sel.delete(n.id) : sel.add(n.id); draw(); return; }
      if (!sel.has(n.id)) { sel = new Set([n.id]); }
      // moving a lane carries the shapes inside it
      const moving = new Set(sel);
      for (const id of sel) { const L = byId(id); if (L.type === 'lane') flow.nodes.forEach(m => { if (m.type !== 'lane' && m.x >= L.x && m.x + m.w <= L.x + L.w && m.y >= L.y && m.y + m.h <= L.y + L.h) moving.add(m.id); }); }
      drag = { kind: 'move', p0: p, start: [...moving].map(id => ({ id, x: byId(id).x, y: byId(id).y })), moved: false };
      draw(); return;
    }
    selEdge = null; selLabel = null; if (!e.shiftKey) sel.clear();
    marquee = { x1: p.x, y1: p.y, x2: p.x, y2: p.y }; drag = { kind: 'marquee' }; draw();
  });
  svg.addEventListener('contextmenu', e => e.preventDefault());
  function onDrag(e, p) {
    if (drag.kind === 'label') {
      const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
      if (!drag.moved && Math.hypot(dx, dy) * view.k < 3) return;
      drag.moved = true; drag.e.lx = Math.round(drag.lx + dx); drag.e.ly = Math.round(drag.ly + dy); draw(); return;
    }
    if (drag.kind === 'pan') { view.x = e.clientX - drag.sx; view.y = e.clientY - drag.sy; applyView(); return; }
    if (drag.kind === 'end') {
      const n = nodeAt(p, true); hoverId = n ? n.id : null;
      const pp = n && nearPort(n, p, 22 / view.k);
      const q = pp ? portPt(n, pp) : p;
      if (wire.end === 'to') { wire.x1 = wire.fx; wire.y1 = wire.fy; wire.x2 = q.x; wire.y2 = q.y; }
      else { wire.x1 = q.x; wire.y1 = q.y; wire.x2 = wire.fx; wire.y2 = wire.fy; }
      draw(); return;
    }
    if (drag.kind === 'wire') { wire.x2 = p.x; wire.y2 = p.y; const n = nodeAt(p, true); hoverId = n ? n.id : wire.from; draw(); return; }
    if (drag.kind === 'marquee') { marquee.x2 = p.x; marquee.y2 = p.y; const r = normRect(marquee); sel = new Set(flow.nodes.filter(n => n.x >= r.x && n.y >= r.y && n.x + n.w <= r.x + r.width && n.y + n.h <= r.y + r.height).map(n => n.id)); draw(); return; }
    if (drag.kind === 'resize') {
      const { n, o, c } = drag; const min = 30;
      let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
      if (c.includes('w')) x0 = Math.min(snap(p.x), x1 - min); if (c.includes('e')) x1 = Math.max(snap(p.x), x0 + min);
      if (c.includes('n')) y0 = Math.min(snap(p.y), y1 - min); if (c.includes('s')) y1 = Math.max(snap(p.y), y0 + min);
      Object.assign(n, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }); draw(); return;
    }
    if (drag.kind === 'move') {
      let dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
      if (!drag.moved && Math.hypot(dx, dy) * view.k < 3) return;
      drag.moved = true; guides = [];
      // smart guides: line the dragged shape up with others (centres and edges)
      const lead = drag.start[0], ln = byId(lead.id);
      let nx = snap(lead.x + dx), ny = snap(lead.y + dy);
      if (drag.start.length === 1 || sel.size === 1) {
        const others = flow.nodes.filter(m => !drag.start.some(s => s.id === m.id) && m.type !== 'lane');
        const xs = [[nx + ln.w / 2, 'c'], [nx, 'l'], [nx + ln.w, 'r']], ys = [[ny + ln.h / 2, 'c'], [ny, 't'], [ny + ln.h, 'b']];
        let bx = null, by = null;
        for (const m of others) {
          for (const [v, kind] of xs) for (const tv of [m.x + m.w / 2, m.x, m.x + m.w]) if (Math.abs(v - tv) < 6 / view.k && (!bx || Math.abs(v - tv) < bx.d)) bx = { d: Math.abs(v - tv), shift: tv - v, line: tv, m };
          for (const [v, kind] of ys) for (const tv of [m.y + m.h / 2, m.y, m.y + m.h]) if (Math.abs(v - tv) < 6 / view.k && (!by || Math.abs(v - tv) < by.d)) by = { d: Math.abs(v - tv), shift: tv - v, line: tv, m };
        }
        if (bx) { nx += bx.shift; guides.push({ x1: bx.line, x2: bx.line, y1: Math.min(ny, bx.m.y) - 20, y2: Math.max(ny + ln.h, bx.m.y + bx.m.h) + 20 }); }
        if (by) { ny += by.shift; guides.push({ y1: by.line, y2: by.line, x1: Math.min(nx, by.m.x) - 20, x2: Math.max(nx + ln.w, by.m.x + by.m.w) + 20 }); }
      }
      dx = nx - lead.x; dy = ny - lead.y;
      for (const s of drag.start) { const m = byId(s.id); m.x = s.x + dx; m.y = s.y + dy; }
      draw();
    }
  }
  svg.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch') {
      const still = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12;
      if (still && down.id) {
        if (lastTap && lastTap.id === down.id && Date.now() - lastTap.t < 450) {
          lastTap = null; const id = down.id.slice(2);
          if (drag) { drag = null; guides = []; draw(); }
          if (down.id[0] === 'n') { const n = byId(id); if (n) editText(n); }
          else editEdgeLabel(flow.edges.find(x => x.id === id));
          return;
        }
        lastTap = { id: down.id, t: Date.now() };
      } else lastTap = null;
    } else setTimeout(focusKeys, 0);
    if (!drag) return;
    const p = toWorld(e), d = drag; drag = null; svg.classList.remove('panning');
    if (d.kind === 'end') {
      const target = nodeAt(p, true); wire = null; hoverId = null;
      const ed = d.e, other = d.end === 'to' ? ed.from : ed.to;
      if (target && target.id !== other) {
        const pp = nearPort(target, p, 22 / view.k);
        if (d.end === 'to') { ed.to = target.id; if (pp) ed.toPort = pp; else delete ed.toPort; }
        else { ed.from = target.id; if (pp) ed.fromPort = pp; else delete ed.fromPort; }
        commit(); return;
      }
      draw(); return;
    }
    if (d.kind === 'wire') {
      const target = nodeAt(p, true);
      if (target && target.id !== wire.from) { const ne = newEdge(wire.from, wire.port, target.id); const tp = nearPort(target, p, 22 / view.k); if (tp) ne.toPort = tp; flow.edges.push(ne); wire = null; commit(); return; }
      if (!target) { // dropped on empty space: create a new shape of the same kind there, already connected
        const src = byId(wire.from); const type = ['decision', 'terminator', 'note', 'text'].includes(src.type) ? 'process' : src.type; const S = SHAPES[type];
        const n = { id: uid(), type, x: snap(p.x - S.w / 2), y: snap(p.y - S.h / 2), w: S.w, h: S.h, text: '', fill: src.fill || S.fill, stroke: src.stroke };
        flow.nodes.push(n); flow.edges.push(newEdge(src.id, wire.port, n.id));
        wire = null; sel = new Set([n.id]); commit(); editText(n); return;
      }
      wire = null; draw(); return;
    }
    if (d.kind === 'marquee') { marquee = null; draw(); return; }
    if (d.kind === 'label') { if (d.moved) commit(); return; }
    guides = [];
    if (d.kind === 'move' && !d.moved) { draw(); return; }
    if (d.kind === 'move' || d.kind === 'resize') commit();
  });
  svg.addEventListener('dblclick', e => {
    const p = toWorld(e);
    const labelG = e.target.closest('.fl-label');
    const edgeG = labelG || e.target.closest('.fl-edge');
    if (edgeG) { editEdgeLabel(flow.edges.find(x => x.id === (edgeG.dataset.label || edgeG.dataset.edge))); return; }
    const n = nodeAt(p, false) || nodeAt(p, true);
    if (n) editText(n);
    else { const S = SHAPES.process; const m = { id: uid(), type: 'process', x: snap(p.x - S.w / 2), y: snap(p.y - S.h / 2), w: S.w, h: S.h, text: '', fill: S.fill }; flow.nodes.push(m); sel = new Set([m.id]); commit(); editText(m); }
  });
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = svg.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const k = Math.min(3, Math.max(.2, view.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      view.x = px - (px - view.x) * k / view.k; view.y = py - (py - view.y) * k / view.k; view.k = k;
    } else { view.x -= e.shiftKey ? e.deltaY : e.deltaX; view.y -= e.shiftKey ? 0 : e.deltaY; }
    applyView(); draw();
  }, { passive: false });

  // ---------- typing in shapes ----------
  let typing = null;
  const holder = h('div', { class: 'fl-holder' });
  function editText(n, initial, adopt) {
    commitText();
    const r = svg.getBoundingClientRect(), hr = holder.getBoundingClientRect();
    const ta = adopt || h('textarea', { spellcheck: 'false' });
    if (adopt) newCatcher();
    ta.className = 'fl-type';
    Object.assign(ta.style, { left: (r.left - hr.left + view.x + n.x * view.k) + 'px', top: (r.top - hr.top + view.y + n.y * view.k) + 'px', width: n.w * view.k + 'px', height: n.h * view.k + 'px', fontSize: (lastPtr === 'touch' ? Math.max(16, (n.fontSize || 14) * view.k) : (n.fontSize || 14) * view.k) + 'px', fontWeight: n.bold ? 700 : 560, paddingTop: Math.max(4, (n.h * view.k - (n.fontSize || 14) * view.k * 1.35) / 2) + 'px' });
    if (!adopt) ta.value = n.text || '';
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); commitText(); } if (e.key === 'Escape') { ta.value = n.text || ''; commitText(); } });
    ta.addEventListener('blur', () => setTimeout(commitText, 0));
    if (!adopt) holder.append(ta);
    typing = { ta, n }; sel = new Set([n.id]); draw();
    if (adopt) return;   // Korean typing already in progress inside it
    if (initial != null) { ta.value = initial; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    else { ta.focus(); ta.select(); }
  }
  function commitText() {
    if (!typing) return;
    const { ta, n } = typing; typing = null; ta.remove();
    if (ta.value !== (n.text || '')) { n.text = ta.value; commit(); }
    setTimeout(focusKeys, 0);
  }
  let labelEditor = null;   // only one open at a time
  function editEdgeLabel(e, initial, adopt) {
    if (!e) return;
    if (labelEditor) labelEditor();
    const pts = edgePoints(e); const b = labelBox({ ...e, label: e.label || 'OK' }, pts);
    const r = svg.getBoundingClientRect(), hr = holder.getBoundingClientRect();
    const inp = adopt || h('input', { type: 'text' });
    if (adopt) newCatcher();
    inp.className = 'fl-type fl-type-label'; inp.placeholder = '예: OK / NG';
    Object.assign(inp.style, { left: (r.left - hr.left + view.x + b.x * view.k - 60) + 'px', top: (r.top - hr.top + view.y + b.y * view.k - 15) + 'px' });
    if (!adopt) inp.value = initial != null ? initial : (e.label || '');
    let finished = false;
    const done = () => { if (finished) return; finished = true; if (labelEditor === done) labelEditor = null; inp.remove(); const v = inp.value.trim(); if (v !== (e.label || '')) { e.label = v; if (!v) { delete e.lx; delete e.ly; selLabel = null; } else selLabel = e.id; commit(); } setTimeout(focusKeys, 0); };
    inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); done(); } if (ev.key === 'Escape') { inp.value = e.label || ''; done(); } });
    inp.addEventListener('blur', done);
    labelEditor = done;
    if (!adopt) holder.append(inp);
    if (adopt) return;
    if (lastPtr === 'touch') inp.style.fontSize = '16px';
    if (initial != null) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    else if (lastPtr === 'touch') { inp.focus(); inp.select(); }   // must happen inside the tap for the keyboard to open
    else setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }

  // ---------- keyboard ----------
  let clip = null;
  // Keys go to a hidden text box while something is selected, so Korean (IME) typing can start editing
  // right away: when composition begins, that same box becomes the visible editor.
  let catcher;
  function newCatcher() {
    const me = catcher = h('textarea', { class: 'fl-catch', 'aria-hidden': 'true', tabindex: '-1', spellcheck: 'false' });
    const idle = () => me.classList.contains('fl-catch');
    const target = () => selLabel ? flow.edges.find(x => x.id === selLabel) : selEdge ? flow.edges.find(x => x.id === selEdge) : null;
    me.addEventListener('keydown', e => { if (!idle() || e.isComposing || e.key === 'Process') return; onKey(e); if (e.defaultPrevented) me.value = ''; });
    me.addEventListener('compositionstart', () => {
      if (!idle()) return;
      const ed = target();
      if (ed) editEdgeLabel(ed, null, me);
      else if (sel.size === 1) editText(byId([...sel][0]), null, me);
    });
    me.addEventListener('input', e => {
      if (!idle() || e.isComposing || !me.value) return;
      const v = me.value; me.value = '';
      if (!v.trim()) return;
      const ed = target();
      if (ed) editEdgeLabel(ed, v); else if (sel.size === 1) editText(byId([...sel][0]), v);
    });
    holder.append(me);
  }
  newCatcher();
  function focusKeys() {
    if (!flow || typing || lastPtr === 'touch') return;
    if (sel.size === 1 || selLabel || selEdge) { catcher.value = ''; catcher.focus({ preventScroll: true }); }
    else svg.focus({ preventScroll: true });
  }
  svg.addEventListener('keydown', onKey);
  function onKey(e) {
    if (e.key === ' ') { spaceDown = true; svg.classList.add('can-pan'); e.preventDefault(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); sel = new Set(flow.nodes.map(n => n.id)); draw(); return; }
    if (mod && e.key.toLowerCase() === 'c') { clip = copySel(); return; }
    if (mod && e.key.toLowerCase() === 'v') { if (clip) paste(clip); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); paste(copySel()); return; }
    if (selLabel) {
      const ed = flow.edges.find(x => x.id === selLabel);
      if (ed && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); ed.label = ''; delete ed.lx; delete ed.ly; selLabel = null; commit(); return; }
      if (ed && (e.key === 'Enter' || e.key === 'F2')) { e.preventDefault(); editEdgeLabel(ed); return; }
      if (ed && e.key.startsWith('Arrow')) { e.preventDefault(); const st = e.shiftKey ? 10 : 2; const [dx, dy] = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key]; ed.lx = (ed.lx || 0) + dx; ed.ly = (ed.ly || 0) + dy; commit(); return; }
      if (ed && e.key.length === 1 && !mod && !e.altKey && e.key !== ' ') { e.preventDefault(); editEdgeLabel(ed, e.key); return; }
    }
    if (selEdge && !mod && e.key.length === 1 && e.key !== ' ') { e.preventDefault(); editEdgeLabel(flow.edges.find(x => x.id === selEdge), e.key); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(); return; }
    if (e.key === 'F2' || (e.key === 'Enter' && sel.size === 1)) { e.preventDefault(); editText(byId([...sel][0])); return; }
    if (e.key.startsWith('Arrow') && sel.size) {
      e.preventDefault(); const st = e.shiftKey ? GRID * 2 : (e.altKey ? 1 : GRID);
      const [dx, dy] = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
      sel.forEach(id => { const n = byId(id); n.x += dx; n.y += dy; }); commit(); return;
    }
    if (e.key.length === 1 && !mod && !e.altKey && sel.size === 1 && e.key !== ' ') { e.preventDefault(); editText(byId([...sel][0]), e.key); }
  }
  svg.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; svg.classList.remove('can-pan'); } });
  holder.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; svg.classList.remove('can-pan'); } });
  const copySel = () => ({ nodes: flow.nodes.filter(n => sel.has(n.id)).map(n => ({ ...n })), edges: flow.edges.filter(x => sel.has(x.from) && sel.has(x.to)).map(x => ({ ...x })) });
  function paste(c) {
    if (!c.nodes.length) return;
    const map = new Map();
    const nodes = c.nodes.map(n => { const id = uid(); map.set(n.id, id); return { ...n, id, x: n.x + 30, y: n.y + 30 }; });
    flow.nodes.push(...nodes);
    flow.edges.push(...c.edges.map(x => ({ ...x, id: uid(), from: map.get(x.from), to: map.get(x.to) })));
    sel = new Set(nodes.map(n => n.id)); clip = { nodes: nodes.map(n => ({ ...n })), edges: [] }; commit();
  }
  function removeSel() {
    if (selEdge) { flow.edges = flow.edges.filter(x => x.id !== selEdge); selEdge = null; commit(); return; }
    if (!sel.size) return;
    flow.nodes = flow.nodes.filter(n => !sel.has(n.id));
    flow.edges = flow.edges.filter(x => !sel.has(x.from) && !sel.has(x.to));
    sel.clear(); commit();
  }

  // ---------- palette & properties ----------
  function addShape(type, at) {
    const S = SHAPES[type];
    const r = svg.getBoundingClientRect();
    const c = at || { x: (r.width / 2 - view.x) / view.k, y: (r.height / 2 - view.y) / view.k };
    const n = { id: uid(), type, x: snap(c.x - S.w / 2), y: snap(c.y - S.h / 2), w: S.w, h: S.h, text: S.text, fill: S.fill, stroke: S.stroke };
    if (type === 'lane') flow.nodes.unshift(n); else flow.nodes.push(n);
    sel = new Set([n.id]); selEdge = null; commit();
    return n;
  }
  const palette = h('div', { class: 'fl-palette' }, h('div', { class: 'fl-pal-title' }, '도형'),
    ...Object.entries(SHAPES).map(([type, S]) => {
      const ic = el('svg', { viewBox: '0 0 44 30', width: 44, height: 30 });
      const sw = type === 'lane' ? 40 : type === 'circle' ? 22 : type === 'database' ? 24 : 38, sh = type === 'circle' ? 22 : type === 'database' ? 26 : 22;
      ic.append(el('path', { d: shapePath(type === 'text' ? 'process' : type, (44 - sw) / 2, (30 - sh) / 2, sw, sh), fill: S.fill === 'none' ? '#fff' : S.fill, stroke: type === 'text' ? '#C9CDDD' : (S.stroke || STROKE_OF[S.fill]), 'stroke-width': 1.4, 'stroke-dasharray': type === 'text' || type === 'lane' ? '3 2' : null }));
      if (type === 'text') { const t = el('text', { x: 22, y: 19, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#565C72' }); t.textContent = 'Aa'; ic.append(t); }
      const b = h('button', { type: 'button', class: 'fl-pal', title: S.label + ' — 누르거나 캔버스로 끌어다 놓기' }, ic, h('span', null, S.label));
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        let placed = null;
        const mv = ev => {
          const r = svg.getBoundingClientRect();
          if (!placed && ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom) {
            placed = addShape(type, toWorld(ev));
            drag = { kind: 'move', p0: toWorld(ev), start: [{ id: placed.id, x: placed.x, y: placed.y }], moved: true };
          } else if (placed) onDrag(ev, toWorld(ev));
        };
        const up = ev => {
          document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up);
          if (placed) { drag = null; guides = []; commit(); focusKeys(); }
          else if (ev.target.closest('.fl-pal') === b) addShape(type);
        };
        document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
      });
      return b;
    }));

  const panel = h('div', { class: 'fl-panel' });
  const mbar = h('div', { class: 'fl-mbar', hidden: true });
  const mb = (label, fn, cls) => h('button', { type: 'button', class: 'btn small' + (cls ? ' ' + cls : ''), onclick: fn }, label);
  function drawMbar() {
    const nodes = [...sel].map(byId).filter(Boolean);
    const edge = (selEdge || selLabel) && flow.edges.find(x => x.id === (selEdge || selLabel));
    let kids = [];
    if (!typing && nodes.length === 1) kids = [mb('✎ 글자', () => editText(nodes[0]), 'primary'), mb('복제', () => paste(copySel())), mb('삭제', removeSel, 'ghost danger')];
    else if (!typing && nodes.length > 1) kids = [mb('복제', () => paste(copySel())), mb('삭제', removeSel, 'ghost danger')];
    else if (!typing && edge) kids = [mb(edge.label ? '✎ 글자' : '✎ 글자 넣기', () => editEdgeLabel(edge), 'primary'),
      edge.label ? mb('글자 지우기', () => { edge.label = ''; delete edge.lx; delete edge.ly; selLabel = null; commit(); }) : null,
      mb('선 삭제', () => { flow.edges = flow.edges.filter(x => x.id !== edge.id); selEdge = selLabel = null; commit(); }, 'ghost danger')].filter(Boolean);
    mbar.hidden = !kids.length; mbar.replaceChildren(...kids);
  }
  function drawPanel() {
    if (!flow) return;
    drawMbar();
    const nodes = [...sel].map(byId).filter(Boolean);
    const edgeId = selEdge || selLabel, edge = edgeId && flow.edges.find(x => x.id === edgeId);
    const sec = (title, ...kids) => h('div', { class: 'fl-sec' }, h('div', { class: 'fl-sec-t' }, title), ...kids);
    const set = (fn) => { nodes.forEach(fn); commit(); };
    if (edge) {
      const routeSeg = h('div', { class: 'seg' }, [['orth', '직각'], ['curve', '곡선'], ['straight', '직선']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String((edge.route || 'orth') === k), onclick: () => { edge.route = k; commit(); } }, l)));
      const arrowSeg = h('div', { class: 'seg' }, [['end', '→'], ['both', '↔'], ['none', '—']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String((edge.arrow || 'end') === k), onclick: () => { edge.arrow = k; commit(); } }, l)));
      panel.replaceChildren(sec('연결선', routeSeg, arrowSeg,
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!edge.dash, onchange: e => { edge.dash = e.target.checked; commit(); } }), '점선'),
        h('div', { class: 'fl-sec-t' }, '선 글자'),
        h('div', { class: 'row' }, ...['OK', 'NG', '예', '아니오'].map(t => h('button', { class: 'btn small', 'aria-pressed': String(edge.label === t), onclick: () => { edge.label = t; commit(); } }, t))),
        h('p', { class: 'fl-tip' }, '글자는 바로 클릭해서 고릅니다. 끌어서 옮기고, 더블클릭이나 타자로 고치고, Delete로 지웁니다.'),
        edge.label && (edge.lx || edge.ly) ? h('button', { class: 'btn small', onclick: () => { delete edge.lx; delete edge.ly; commit(); } }, '글자 위치 처음대로') : null,
        h('button', { class: 'btn small', onclick: () => { [edge.from, edge.to] = [edge.to, edge.from]; [edge.fromPort, edge.toPort] = [edge.toPort, edge.fromPort]; commit(); } }, '방향 바꾸기'),
        h('button', { class: 'btn small ghost danger', onclick: removeSel }, '선 삭제')));
      return;
    }
    if (!nodes.length) {
      panel.replaceChildren(sec('선 겹침',
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: flow.jumps !== false, onchange: e => { flow.jumps = e.target.checked; commit(); } }), '교차하는 선은 다리처럼 넘어가기')),
        sec('사용법',
        h('p', { class: 'fl-tip' }, '왼쪽 도형을 누르거나 끌어다 놓습니다.'),
        h('p', { class: 'fl-tip' }, '도형에 마우스를 올리면 파란 점이 생깁니다. 점을 끌어 다른 도형에 놓으면 연결되고, 빈 곳에 놓으면 새 도형이 이어집니다.'),
        h('p', { class: 'fl-tip' }, '더블클릭하거나 바로 타자를 치면 글자를 넣습니다. 빈 곳 더블클릭은 새 ‘처리’ 도형. 폰에서는 도형을 두 번 톡 누르거나 아래 ✎ 글자 버튼.'),
        h('p', { class: 'fl-tip' }, 'Ctrl+Z 되돌리기 · Ctrl+D 복제 · Delete 삭제 · 방향키 이동 · Ctrl+휠 확대 · Space+끌기 화면 이동')));
      return;
    }
    const n0 = nodes[0];
    const fills = h('div', { class: 'fl-swatches' }, PAIRS.map(([f, s]) => h('button', { type: 'button', class: 'swatch', title: '채우기', style: { background: f, boxShadow: `0 0 0 1.5px ${s}` }, 'aria-pressed': String(n0.fill === f),
      onclick: () => set(n => { if (n.type === 'text') return; n.fill = f; n.stroke = s; }) })));
    const sizeSel = h('select', { style: { width: 'auto', minHeight: '32px' }, onchange: e => set(n => { n.fontSize = Number(e.target.value); }) },
      [11, 12, 13, 14, 16, 18, 20, 24, 28].map(v => h('option', { value: v, selected: (n0.fontSize || 14) === v }, v + 'pt')));
    const textColors = h('div', { class: 'fl-swatches' }, ['#262A3B', '#565C72', '#4F5BC4', '#2F8467', '#B5546B', '#B77A3E'].map(c => h('button', { type: 'button', class: 'swatch', style: { background: c, width: '20px', height: '20px' }, 'aria-pressed': String((n0.color || '#262A3B') === c), onclick: () => set(n => { n.color = c; }) })));
    const typeSel = h('select', { style: { minHeight: '32px' }, onchange: e => set(n => { if (n.type !== 'lane' && e.target.value !== 'lane') n.type = e.target.value; }) },
      Object.entries(SHAPES).filter(([k]) => k !== 'lane').map(([k, S]) => h('option', { value: k, selected: n0.type === k }, S.label)));
    const align = (fn, label) => h('button', { class: 'btn small', type: 'button', disabled: nodes.length < 2, onclick: () => { fn(); commit(); } }, label);
    const minX = () => Math.min(...nodes.map(n => n.x)), maxR = () => Math.max(...nodes.map(n => n.x + n.w));
    const cx = () => (minX() + maxR()) / 2, minY = () => Math.min(...nodes.map(n => n.y)), cy = () => (minY() + Math.max(...nodes.map(n => n.y + n.h))) / 2;
    const distribute = axis => { const s = [...nodes].sort((a, b) => axis === 'x' ? a.x - b.x : a.y - b.y); if (s.length < 3) return; const k = axis === 'x' ? 'w' : 'h'; const total = s.reduce((a, n) => a + n[k], 0); const span = (s[s.length - 1][axis] + s[s.length - 1][k]) - s[0][axis]; const gap = (span - total) / (s.length - 1); let pos = s[0][axis]; s.forEach(n => { n[axis] = snap(pos); pos += n[k] + gap; }); };
    panel.replaceChildren(
      sec(nodes.length > 1 ? `도형 ${nodes.length}개` : (SHAPES[n0.type]?.label || '도형'),
        nodes.length === 1 && n0.type !== 'lane' ? typeSel : null, fills),
      sec('글자', h('div', { class: 'row' }, sizeSel, h('button', { class: 'btn small', 'aria-pressed': String(!!n0.bold), onclick: () => set(n => { n.bold = !n0.bold; }) }, h('b', null, '굵게'))), textColors,
        nodes.length === 1 ? h('button', { class: 'btn small', onclick: () => editText(n0) }, '글자 고치기') : null),
      sec('정렬', h('div', { class: 'fl-grid2' },
        align(() => { const x = minX(); nodes.forEach(n => { n.x = x; }); }, '왼쪽'), align(() => { const c = cx(); nodes.forEach(n => { n.x = snap(c - n.w / 2); }); }, '가운데'),
        align(() => { const y = minY(); nodes.forEach(n => { n.y = y; }); }, '위쪽'), align(() => { const c = cy(); nodes.forEach(n => { n.y = snap(c - n.h / 2); }); }, '중간'),
        align(() => distribute('x'), '가로 간격'), align(() => distribute('y'), '세로 간격'),
        align(() => { const w = Math.max(...nodes.map(n => n.w)), hh = Math.max(...nodes.map(n => n.h)); nodes.forEach(n => { if (n.type !== 'lane') { n.w = w; n.h = hh; } }); }, '크기 맞추기'))),
      sec('순서', h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => { flow.nodes = flow.nodes.filter(n => !sel.has(n.id)).concat(nodes); commit(); } }, '맨 앞으로'),
        h('button', { class: 'btn small', onclick: () => { flow.nodes = nodes.concat(flow.nodes.filter(n => !sel.has(n.id))); commit(); } }, '맨 뒤로')),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => paste(copySel()) }, '복제'), h('button', { class: 'btn small ghost danger', onclick: removeSel }, '삭제'))));
  }

  // ---------- view helpers & export ----------
  const bounds = () => {
    if (!flow.nodes.length) return { x: 0, y: 0, w: 400, h: 300 };
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    flow.nodes.forEach(n => { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); });
    flow.edges.forEach(e => { const pts = edgePoints(e); if (pts) pts.forEach(p => { x0 = Math.min(x0, p.x - 4); y0 = Math.min(y0, p.y - 4); x1 = Math.max(x1, p.x + 4); y1 = Math.max(y1, p.y + 4); }); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const fit = () => {
    const r = svg.getBoundingClientRect(), b = bounds();
    if (!r.width) return;
    const k = Math.min(1.25, Math.max(.3, Math.min((r.width - 80) / b.w, (r.height - 80) / b.h)));
    view = { k, x: r.width / 2 - (b.x + b.w / 2) * k, y: r.height / 2 - (b.y + b.h / 2) * k }; applyView(); draw();
  };
  const zoomBy = f => { const r = svg.getBoundingClientRect(), px = r.width / 2, py = r.height / 2; const k = Math.min(3, Math.max(.2, view.k * f)); view.x = px - (px - view.x) * k / view.k; view.y = py - (py - view.y) * k / view.k; view.k = k; applyView(); draw(); };
  function exportSvgText() {
    const b = bounds(), P = 30;
    const keep = { sel, hoverId, selEdge, selLabel }; sel = new Set(); hoverId = null; selEdge = null; selLabel = null; draw();
    const clone = svg.cloneNode(true);
    sel = keep.sel; hoverId = keep.hoverId; selEdge = keep.selEdge; selLabel = keep.selLabel; draw();
    clone.removeAttribute('class'); clone.removeAttribute('tabindex');
    const g = clone.querySelector('g'); g.setAttribute('transform', '');
    g.firstChild.remove(); // grid
    clone.setAttribute('xmlns', NS); clone.setAttribute('viewBox', `${b.x - P} ${b.y - P} ${b.w + P * 2} ${b.h + P * 2}`);
    clone.setAttribute('width', b.w + P * 2); clone.setAttribute('height', b.h + P * 2);
    clone.setAttribute('font-family', '"Pretendard Variable", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif');
    clone.insertBefore(el('rect', { x: b.x - P, y: b.y - P, width: b.w + P * 2, height: b.h + P * 2, fill: '#FFFFFF' }), g);
    return { text: new XMLSerializer().serializeToString(clone), w: b.w + P * 2, h: b.h + P * 2 };
  }
  async function exportPng(toClipboard) {
    const { text, w, h: hh } = exportSvgText();
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text); });
    const c = document.createElement('canvas'); c.width = w * 2; c.height = hh * 2;
    const g = c.getContext('2d'); g.scale(2, 2); g.drawImage(img, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    if (toClipboard) { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('그림으로 복사했습니다. 메일·문서에 붙여 넣으세요'); } catch { toast('복사하지 못했습니다. PNG 저장을 써 주세요.', 'err'); } return; }
    download((name || '프로세스') + '.png', blob);
  }

  async function pngDataUrl() {
    commitText();
    const { text, w, h: hh } = exportSvgText();
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text); });
    const c = document.createElement('canvas'); c.width = Math.round(w * 2); c.height = Math.round(hh * 2);
    const g = c.getContext('2d'); g.scale(2, 2); g.drawImage(img, 0, 0);
    return { dataUrl: c.toDataURL('image/png'), width: Math.round(w), height: Math.round(hh) };
  }

  const tools = h('div', { class: 'fl-top' },
    h('button', { class: 'btn small ghost', title: '되돌리기 (Ctrl+Z)', onclick: doUndo }, '↶'), h('button', { class: 'btn small ghost', title: '다시 하기 (Ctrl+Y)', onclick: doRedo }, '↷'),
    h('button', { class: 'btn small ghost', onclick: () => zoomBy(1 / 1.2) }, '－'), h('button', { class: 'btn small ghost', onclick: fit }, '맞추기'), h('button', { class: 'btn small ghost', onclick: () => zoomBy(1.2) }, '＋'),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn small', onclick: () => exportPng(true) }, '그림 복사'),
    h('button', { class: 'btn small', onclick: () => exportPng(false) }, 'PNG'),
    h('button', { class: 'btn small', onclick: () => { const s = exportSvgText(); download(name + '.svg', new Blob([s.text], { type: 'image/svg+xml' })); } }, 'SVG'));
  const element = h('div', { class: 'fl-editor' }, tools, h('div', { class: 'fl-body' }, palette, h('div', { class: 'fl-canvas' }, svg, holder, mbar), panel));
  const start = () => { applyView(); draw(); requestAnimationFrame(() => { if (flow.nodes.length) fit(); else { view = { x: 60, y: 40, k: 1 }; applyView(); draw(); } focusKeys(); }); };
  const load = f => { flow = JSON.parse(JSON.stringify(f)); sel = new Set(); selEdge = null; selLabel = null; commit(); requestAnimationFrame(fit); };
  return { element, start, load, isEmpty: () => !flow.nodes.length, get: () => { commitText(); return JSON.parse(JSON.stringify(flow)); }, pngDataUrl, fit, finish: commitText };
}

// Full-screen editor; resolves { flow, dataUrl, width, height } when 완료 is pressed, null when cancelled.
export function openFlowDialog(initial, { title = '프로세스 그리기' } = {}) {
  return new Promise(resolve => {
    let changed = false;
    const ed = createFlowEditor(initial && initial.nodes && initial.nodes.length ? initial : (initial === 'example' ? starter() : blank()), { onChange: () => { changed = true; } });
    const close = async ok => {
      if (ok) {
        const flow = ed.get();
        if (!flow.nodes.length) { toast('도형을 하나 이상 넣어 주세요.'); return; }
        const png = await ed.pngDataUrl();
        resolve({ flow, ...png });
      } else {
        if (changed && !confirm('그린 내용을 버리고 닫을까요?')) return;
        resolve(null);
      }
      document.removeEventListener('keydown', esc, true);
      wrap.remove();
    };
    const esc = e => { if (e.key === 'Escape' && !e.target.closest('.fl-type')) { e.preventDefault(); close(false); } };
    const wrap = h('div', { class: 'fl-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'fl-dialog-head' }, h('b', null, title),
        h('span', { class: 'hint', style: { margin: 0 } }, '도형을 끌어다 놓고, 파란 점을 끌어 연결하세요. 완료를 누르면 문서에 그림으로 들어갑니다.'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn small ghost', onclick: () => { if (ed.isEmpty() || confirm('지금 그림을 예시로 바꿀까요?')) ed.load(starter()); } }, '예시로 시작'),
        h('button', { class: 'btn', onclick: () => close(false) }, '취소'),
        h('button', { class: 'btn primary', onclick: () => close(true) }, '완료')),
      ed.element);
    document.body.append(wrap);
    document.addEventListener('keydown', esc, true);
    ed.start();
  });
}

// Draws a stored diagram off-screen and returns its picture (used to convert older 업무메모).
export async function renderFlow(flow) {
  const ed = createFlowEditor(flow);
  const box = h('div', { style: { position: 'fixed', left: '-10000px', top: '0', width: '1200px', height: '800px' } }, ed.element);
  document.body.append(box);
  ed.start(); await new Promise(r => requestAnimationFrame(r));
  try { return await ed.pngDataUrl(); } finally { box.remove(); }
}
