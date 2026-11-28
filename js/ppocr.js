// 영수증 읽기 엔진 (PaddleOCR PP-OCRv5 한국어) — 이 기기 안에서만 동작, 사진은 밖으로 나가지 않음
// 처음 한 번 약 21MB(인식 모델)를 받고, 그 뒤로는 저장된 것을 씁니다.
let worker = null, seq = 0;
const waits = new Map();

function w() {
  if (!worker) {
    worker = new Worker(new URL('./ppocr.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const { id, result, error, progress } = e.data, p = waits.get(id); if (!p) return;
      if (progress !== undefined) { p.onProgress && p.onProgress(progress); return; }
      waits.delete(id); error ? p.reject(new Error(error)) : p.resolve(result);
    };
    worker.onerror = e => { const err = new Error(e.message || '글자 인식 엔진을 시작하지 못했습니다.'); waits.forEach(p => p.reject(err)); waits.clear(); worker = null; };
  }
  return worker;
}
function call(cmd, img, onProgress, opts) {
  return new Promise((resolve, reject) => {
    const id = ++seq; waits.set(id, { resolve, reject, onProgress });
    const msg = { id, cmd, img, opts };
    w().postMessage(msg, img ? [img.data.buffer] : []);
  });
}

// 카메라를 열 때 미리 모델을 받아 두기
export function warm() { call('warm').catch(() => {}); }

async function decode(blob) {
  if (self.createImageBitmap) { try { return await createImageBitmap(blob); } catch { } }
  const url = URL.createObjectURL(blob);
  try { return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('사진을 열지 못했습니다.')); i.src = url; }); }
  finally { URL.revokeObjectURL(url); }
}
// rot도 돌린 그림을 maxSide 크기로 (frac이면 가운데 일부만, crop=[x0,y0,x1,y1]이면 원본에서 그 부분만)
function pixels(img, rot, maxSide, frac = 1, mult32 = false, crop = null) {
  const IW = img.width || img.naturalWidth, IH = img.height || img.naturalHeight;
  const [cx0, cy0, cx1, cy1] = crop || [0, 0, 1, 1];
  const sx = cx0 * IW, sy = cy0 * IH, iw = (cx1 - cx0) * IW, ih = (cy1 - cy0) * IH;
  const s = Math.min(1, maxSide / Math.max(iw, ih) / frac);
  const w = Math.round(iw * s), h = Math.round(ih * s);
  const cw = rot % 180 ? h : w, ch = rot % 180 ? w : h;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch);
  g.translate(cw / 2, ch / 2); g.rotate(rot * Math.PI / 180); g.drawImage(img, sx, sy, iw, ih, -w / 2, -h / 2, w, h);
  let x = 0, y = 0, W = cw, H = ch;
  if (frac < 1) { W = Math.round(cw * frac); H = Math.round(ch * frac); x = (cw - W) >> 1; y = (ch - H) >> 1; }
  if (mult32) { W = Math.max(32, Math.floor(W / 32) * 32); H = Math.max(32, Math.floor(H / 32) * 32); }
  const d = g.getImageData(x, y, W, H);
  return { data: d.data, width: W, height: H, fx: W / cw, fy: H / ch };
}

// 사진 → 글자 상자 목록 [{text, score, frame}] (사진이 옆으로·거꾸로 찍혀도 바로 세워서 읽음)
export async function read(blob, onProgress = () => {}) {
  const img = await decode(blob);
  onProgress(0.05, '준비 중');
  const loaded = p => onProgress(0.05 + p * 0.3, '글자 인식 모델 받는 중 (처음 한 번, 약 21MB)');
  const small = pixels(img, 0, 640, 1, true), fx = small.fx, fy = small.fy;
  const o = await call('orient', small, loaded);
  // 영수증이 사진 가운데 일부만 차지하면 그 부분만 잘라서 크게 읽음
  let crop = null;
  if (o.box) { const m = 0.03; crop = [Math.max(0, o.box[0] * fx - m), Math.max(0, o.box[1] * fy - m), Math.min(1, o.box[2] * fx + m), Math.min(1, o.box[3] * fy + m)]; if ((crop[2] - crop[0]) * (crop[3] - crop[1]) > 0.85) crop = null; }
  onProgress(0.4, '사진 방향 확인 중');
  const cands = o.hor >= o.ver ? [0, 180] : [270, 90];
  let rot = cands[0], best = await call('score', pixels(img, cands[0], 420, 0.35));
  if (best < 15) { const s2 = await call('score', pixels(img, cands[1], 420, 0.35)); if (s2 > best) rot = cands[1]; }
  onProgress(0.5, '글자 읽는 중');
  let pct = 0.5; const tick = setInterval(() => { pct = Math.min(0.97, pct + (0.98 - pct) * 0.08); onProgress(pct, '글자 읽는 중'); }, 400);
  try {
    const full = pixels(img, rot, 2048, 1, false, crop);
    const lines = await call('read', full, null, { detection: { limitSideLen: 1600, limitType: 'max' } });
    return { lines, rot, width: full.width, height: full.height };
  } finally { clearInterval(tick); img.close && img.close(); }
}
