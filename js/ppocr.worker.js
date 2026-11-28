// 영수증 글자 읽기 엔진 (PaddleOCR PP-OCRv5 한국어, WebAssembly) — 화면이 멈추지 않도록 따로 도는 일꾼
import init, { RtenOcrPipeline, RtenModel } from '../vendor/ppocr/rusto_rten.js';

const BASE = new URL('../vendor/ppocr/', import.meta.url).href;
let ready = null, pipe = null, det = null;

async function get(name, onLoaded) {
  const r = await fetch(BASE + name);
  if (!r.ok) throw new Error(name + ' ' + r.status);
  const v = name.endsWith('.txt') ? await r.text() : new Uint8Array(await r.arrayBuffer());
  onLoaded && onLoaded(name);
  return v;
}
function load(progress) {
  if (!ready) ready = (async () => {
    let n = 0; const done = () => progress && progress(++n / 4);
    const [, d, r, t] = await Promise.all([init({ module_or_path: BASE + 'rusto_rten_bg.wasm' }).then(done), get('det.rten', done), get('rec.rten', done), get('dict.txt', done)]);
    pipe = new RtenOcrPipeline(d, r, t);
    det = new RtenModel(d);
  })().catch(e => { ready = null; throw e; });
  return ready;
}

// 글자 영역 지도에서 글줄이 가로인지 세로인지 (사진이 옆으로 누웠는지)
function orient({ data, width: W, height: H }) {
  const f = new Float32Array(3 * W * H), m = [0.485, 0.456, 0.406], sd = [0.229, 0.224, 0.225];
  for (let i = 0; i < W * H; i++) for (let ch = 0; ch < 3; ch++) f[ch * W * H + i] = (data[i * 4 + (2 - ch)] / 255 - m[ch]) / sd[ch];
  const o = det.run(new Uint32Array([1, 3, H, W]), f); const p = o.data, w = o.shape[3], h = o.shape[2]; o.free && o.free();
  const seen = new Uint8Array(w * h); let hor = 0, ver = 0, bx0 = 1, by0 = 1, bx1 = 0, by1 = 0;
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || p[i] < 0.3) continue;
    let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1, n = 0; const st = [i]; seen[i] = 1;
    while (st.length) {
      const j = st.pop(), yy = (j / w) | 0, xx = j % w; n++;
      if (xx < minx) minx = xx; if (xx > maxx) maxx = xx; if (yy < miny) miny = yy; if (yy > maxy) maxy = yy;
      for (const k of [j - 1, j + 1, j - w, j + w]) if (k >= 0 && k < w * h && !seen[k] && p[k] >= 0.3 && Math.abs((k % w) - xx) <= 1) { seen[k] = 1; st.push(k); }
    }
    if (n < 12) continue;
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    if (bw > bh * 2) hor += n; else if (bh > bw * 2) ver += n;
    bx0 = Math.min(bx0, minx / w); by0 = Math.min(by0, miny / h); bx1 = Math.max(bx1, (maxx + 1) / w); by1 = Math.max(by1, (maxy + 1) / h);
  }
  return { hor, ver, box: bx1 > bx0 ? [bx0, by0, bx1, by1] : null };   // 글자가 있는 범위 (영수증만 잘라 크게 읽기)
}
function read({ data, width, height }, opts) {
  const out = JSON.parse(pipe.detectText(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width, height, 4, null, JSON.stringify({ output: 'lines', ...(opts || {}) })));
  return Array.isArray(out) ? out.map(o => ({ text: o.text, score: o.score, frame: o.frame })) : [];
}
function hangulScore(lines) { let s = 0; for (const o of lines) for (const ch of o.text) if (ch >= '가' && ch <= '힣') s += o.score; return s; }

self.onmessage = async e => {
  const { id, cmd, img, opts } = e.data;
  try {
    await load(p => self.postMessage({ id, progress: p }));
    let result = null;
    if (cmd === 'orient') result = orient(img);
    else if (cmd === 'score') result = hangulScore(read(img));
    else if (cmd === 'read') result = read(img, opts);
    self.postMessage({ id, result });
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
