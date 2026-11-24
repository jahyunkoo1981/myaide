// Screenshot / image annotator: text (size + colour defaults from settings), pen, arrow, box, blur-out, crop.
import { h, dialog, toast } from './util.js';
import { prefs, save as savePrefs } from './prefs.js';

export const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 84, 96, 120];
export const COLORS = [
  ['빨강', '#E5484D'], ['파랑', '#3346C8'], ['초록', '#1F7A4D'], ['노랑', '#F5C84C'],
  ['검정', '#1D2A30'], ['흰색', '#FFFFFF'], ['주황', '#F27B1A'], ['보라', '#7B4FC9']
];

export async function openImageEditor(src, { title = '캡처 편집', actions } = {}) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('이미지를 열지 못했습니다.')); i.src = src; });
  const cap = prefs().capture;
  let tool = 'text', color = cap.color, fontSize = cap.fontSize;
  let shapes = [], crop = null, live = null;
  const canvas = h('canvas', { width: img.width, height: img.height });
  const ctx = canvas.getContext('2d');
  const view = Math.min(1, 1400 / img.width);
  canvas.style.width = Math.round(img.width * view) + 'px';

  const render = (target = ctx, forExport = false) => {
    target.drawImage(img, 0, 0);
    for (const s of shapes.concat(live && live.kind !== 'crop' ? [live] : [])) drawShape(target, s);
    const c = live && live.kind === 'crop' ? live : crop;
    if (c && !forExport) {
      target.save(); target.fillStyle = 'rgba(29,42,48,.45)';
      const r = norm(c);
      target.beginPath(); target.rect(0, 0, img.width, img.height); target.rect(r.x, r.y, r.w, r.h); target.fill('evenodd');
      target.strokeStyle = '#fff'; target.setLineDash([8, 6]); target.lineWidth = 2; target.strokeRect(r.x, r.y, r.w, r.h); target.restore();
    }
  };
  const norm = s => ({ x: Math.min(s.x0, s.x1), y: Math.min(s.y0, s.y1), w: Math.abs(s.x1 - s.x0), h: Math.abs(s.y1 - s.y0) });
  const drawShape = (g, s) => {
    g.save(); g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = s.width || 4; g.lineCap = 'round'; g.lineJoin = 'round';
    if (s.kind === 'pen') { g.beginPath(); s.p.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); }
    if (s.kind === 'box') { const r = norm(s); g.strokeRect(r.x, r.y, r.w, r.h); }
    if (s.kind === 'arrow') {
      const a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0), L = 14 + g.lineWidth * 3;
      g.beginPath(); g.moveTo(s.x0, s.y0); g.lineTo(s.x1, s.y1); g.stroke();
      g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x1 - L * Math.cos(a - .45), s.y1 - L * Math.sin(a - .45)); g.lineTo(s.x1 - L * Math.cos(a + .45), s.y1 - L * Math.sin(a + .45)); g.closePath(); g.fill();
    }
    if (s.kind === 'hide') {
      const r = norm(s); if (r.w < 2 || r.h < 2) { g.restore(); return; }
      // Pixelate the area so sensitive text is unreadable.
      const block = Math.max(8, Math.round(Math.min(r.w, r.h) / 8));
      const t = document.createElement('canvas'); t.width = Math.max(1, Math.ceil(r.w / block)); t.height = Math.max(1, Math.ceil(r.h / block));
      t.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, t.width, t.height);
      g.imageSmoothingEnabled = false; g.drawImage(t, 0, 0, t.width, t.height, r.x, r.y, r.w, r.h);
    }
    if (s.kind === 'text') {
      g.font = `700 ${s.size}px ${getComputedStyle(document.body).fontFamily}`; g.textBaseline = 'top';
      const lines = s.text.split('\n');
      lines.forEach((line, i) => {
        g.lineWidth = Math.max(2, s.size / 9); g.strokeStyle = s.color.toUpperCase() === '#FFFFFF' ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.9)';
        g.strokeText(line, s.x, s.y + i * s.size * 1.25); g.fillText(line, s.x, s.y + i * s.size * 1.25);
      });
    }
    g.restore();
  };
  const pos = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * img.width / r.width, (e.clientY - r.top) * img.height / r.height]; };

  canvas.addEventListener('pointerdown', async e => {
    const [x, y] = pos(e);
    if (tool === 'text') {
      const text = await askText();
      if (text) { shapes.push({ kind: 'text', x, y, text, size: fontSize, color }); render(); }
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    live = tool === 'pen' ? { kind: 'pen', p: [[x, y]], color, width: Math.max(3, fontSize / 8) }
      : { kind: tool, x0: x, y0: y, x1: x, y1: y, color, width: Math.max(3, fontSize / 8) };
  });
  canvas.addEventListener('pointermove', e => {
    if (!live) return;
    const [x, y] = pos(e);
    if (live.kind === 'pen') live.p.push([x, y]); else { live.x1 = x; live.y1 = y; }
    render();
  });
  canvas.addEventListener('pointerup', () => {
    if (!live) return;
    if (live.kind === 'crop') { const r = norm(live); crop = r.w > 10 && r.h > 10 ? live : null; }
    else shapes.push(live);
    live = null; render();
  });

  const askText = () => {
    const ta = h('textarea', { rows: 3, style: { fontSize: '16px' } });
    return dialog({ title: '글자 넣기', body: [ta, h('p', { class: 'hint' }, `크기 ${fontSize} · 줄바꿈은 Enter`)],
      actions: [{ label: '취소', value: '' }, { label: '넣기', kind: 'primary', run: () => {}, value: 'ok' }],
      onOpen: () => ta.focus() }).then(v => v === 'ok' ? ta.value.trim() : '');
  };

  const toolSeg = h('div', { class: 'seg' });
  const TOOLS = [['text', '글자'], ['pen', '펜'], ['arrow', '화살표'], ['box', '사각형'], ['hide', '가리기'], ['crop', '자르기']];
  const setTool = t => { tool = t; [...toolSeg.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === t))); };
  TOOLS.forEach(([k, l]) => toolSeg.append(h('button', { type: 'button', 'data-t': k, onclick: () => setTool(k) }, l)));
  setTool(tool);

  const sizeInput = h('input', { type: 'number', min: 8, max: 200, value: fontSize, style: { width: '76px' }, list: 'myaide-sizes', title: '글자 크기 (8~200)',
    onchange: e => { const v = Number(e.target.value); if (v >= 8 && v <= 200) fontSize = v; else e.target.value = fontSize; } });
  const sizeList = h('datalist', { id: 'myaide-sizes' }, FONT_SIZES.map(s => h('option', { value: s })));
  const swatches = COLORS.map(([name, c]) => h('button', { type: 'button', class: 'swatch', title: name, 'aria-label': name, style: { background: c }, 'aria-pressed': String(c === color),
    onclick: e => { color = c; swatches.forEach(s => s.setAttribute('aria-pressed', String(s === e.currentTarget))); } }));

  const exportUrl = () => {
    const r = crop ? norm(crop) : { x: 0, y: 0, w: img.width, h: img.height };
    const full = document.createElement('canvas'); full.width = img.width; full.height = img.height;
    render(full.getContext('2d'), true);
    const out = document.createElement('canvas'); out.width = Math.round(r.w); out.height = Math.round(r.h);
    out.getContext('2d').drawImage(full, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    render();
    return out.toDataURL('image/png');
  };

  render();
  const result = await dialog({
    title, wide: true,
    body: h('div', { class: 'imged' },
      h('div', { class: 'row' }, toolSeg, h('label', { class: 'row', style: { gap: '4px' } }, '크기', sizeInput, sizeList), ...swatches,
        h('button', { class: 'btn small', type: 'button', onclick: () => { shapes.pop(); render(); } }, '되돌리기'),
        h('button', { class: 'btn small ghost', type: 'button', title: '지금 크기와 색을 다음 캡처의 기본값으로', onclick: async () => {
          await savePrefs({ capture: { ...prefs().capture, fontSize, color } }); toast('기본 글자 크기와 색을 저장했습니다');
        } }, '기본값으로')),
      h('div', { class: 'stage-wrap' }, canvas)),
    actions: (actions || [{ label: '취소', value: null }, { label: '완료', kind: 'primary', value: 'done' }]).map(a => ({ ...a, run: a.value ? () => { lastUrl = exportUrl(); } : undefined }))
  });
  return result ? { action: result, dataUrl: lastUrl } : null;
}
let lastUrl = '';
