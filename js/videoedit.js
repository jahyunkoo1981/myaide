// 동영상 편집: cut, split, join, subtitles, mute — done with FFmpeg (WebAssembly) on this device.
// Streams are copied, not re-encoded: fast and no quality loss (cuts land on the nearest key frame).
import { h, toast, download as saveFile, pad2 } from './util.js';

let ffPromise = null;
async function ffmpeg(onLog) {
  if (!ffPromise) ffPromise = (async () => {
    const { FFmpeg } = await import('../vendor/ffmpeg/index.js');
    const ff = new FFmpeg();
    const base = new URL('../vendor/ffmpeg/', import.meta.url).href;
    await ff.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
    return ff;
  })().catch(e => { ffPromise = null; throw e; });
  const ff = await ffPromise;
  return ff;
}

const fmt = s => { s = Math.max(0, s || 0); return `${pad2(Math.floor(s / 60))}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const parse = v => { const p = String(v).trim().split(':').map(Number); if (p.some(isNaN)) return NaN; return p.reduce((a, b) => a * 60 + b, 0); };
const srtTime = s => { const ms = Math.round(s * 1000); return `${pad2(Math.floor(ms / 3600000))}:${pad2(Math.floor(ms / 60000) % 60)}:${pad2(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, '0')}`; };
const extOf = n => (n.match(/\.([a-z0-9]+)$/i) || [, 'mp4'])[1].toLowerCase();
const baseOf = n => n.replace(/\.[a-z0-9]+$/i, '');

function parseSrt(text) {
  const out = [];
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const m = block.match(/(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)\s*\n([\s\S]*)/);
    if (!m) continue;
    const t = s => { const [hh, mm, rest] = s.replace(',', '.').split(':'); return Number(hh) * 3600 + Number(mm) * 60 + Number(rest); };
    out.push({ start: t(m[1]), end: t(m[2]), text: m[3].trim() });
  }
  return out;
}

// items: media records; opts.download(item) -> Blob of the original. Resolves to File[] to add to 사진보관함.
export function openVideoEditor(items, { download }) {
  return new Promise(resolve => {
    const clips = items.map(it => ({ it, blob: null, url: null }));
    let cur = 0, mode = items.length > 1 ? 'join' : 'cut';
    const cut = { start: 0, end: 0 }, splits = [], subs = [];
    const results = [];

    const video = h('video', { controls: true, playsInline: true, preload: 'auto' });
    const status = h('div', { class: 've-status' });
    const list = h('div', { class: 've-clips' });
    const tools = h('div', { class: 've-tools' });
    const out = h('div', { class: 've-out' });
    const close = () => { clips.forEach(c => c.url && URL.revokeObjectURL(c.url)); wrap.remove(); document.removeEventListener('keydown', esc, true); resolve(results.length ? results : null); };
    const esc = e => { if (e.key === 'Escape' && !e.target.closest('input,textarea')) { e.preventDefault(); close(); } };
    const wrap = h('div', { class: 'fl-dialog ve', role: 'dialog', 'aria-modal': 'true', 'aria-label': '동영상 편집' },
      h('div', { class: 'fl-dialog-head' }, h('b', null, '동영상 편집'),
        h('span', { class: 'hint', style: { margin: 0 } }, '원본은 그대로 두고, 편집한 결과를 새 동영상으로 만듭니다. 다시 압축하지 않아 빠르고 화질이 그대로입니다.'),
        h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, '닫기')),
      h('div', { class: 've-body' },
        h('aside', { class: 've-side' }, h('div', { class: 'fl-sec-t' }, '동영상'), list, out),
        h('div', { class: 've-main' }, h('div', { class: 've-player' }, video), status, tools)));
    document.body.append(wrap);
    document.addEventListener('keydown', esc, true);

    async function ensure(i) {
      const c = clips[i];
      if (c.blob) return c;
      status.textContent = `원본 내려받는 중… ${c.it.name}`;
      c.blob = await download(c.it);
      c.url = URL.createObjectURL(c.blob);
      status.textContent = '';
      return c;
    }
    async function select(i) {
      cur = i; drawList();
      try {
        const c = await ensure(i);
        video.src = c.url;
        await new Promise(r => { video.onloadedmetadata = r; video.onerror = r; });
        if (!cut.end || cut.end > video.duration) { cut.start = 0; cut.end = video.duration || c.it.duration || 0; }
        drawTools();
      } catch (e) { status.textContent = '불러오지 못했습니다: ' + e.message; }
    }
    function drawList() {
      list.replaceChildren(...clips.map((c, i) => h('div', { class: 've-clip' + (i === cur ? ' on' : '') },
        h('button', { class: 've-clipname', onclick: () => select(i) }, `${i + 1}. ${c.it.name}`),
        clips.length > 1 ? h('span', { class: 'row', style: { gap: '2px' } },
          h('button', { class: 'btn small ghost', disabled: i === 0, title: '앞으로', onclick: () => { [clips[i - 1], clips[i]] = [clips[i], clips[i - 1]]; drawList(); } }, '↑'),
          h('button', { class: 'btn small ghost', disabled: i === clips.length - 1, title: '뒤로', onclick: () => { [clips[i + 1], clips[i]] = [clips[i], clips[i + 1]]; drawList(); } }, '↓')) : null)));
    }
    const timeIn = (val, onSet) => {
      const inp = h('input', { type: 'text', value: fmt(val), class: 've-time', onchange: e => { const v = parse(e.target.value); if (!isNaN(v)) onSet(v); else e.target.value = fmt(val); } });
      return inp;
    };
    function drawTools() {
      const tabs = [['cut', '자르기'], ['split', '나누기'], ['join', '합치기'], ['subs', '자막'], ['mute', '소리 빼기']];
      const seg = h('div', { class: 'seg' }, ...tabs.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(mode === k), onclick: () => { mode = k; drawTools(); } }, l)));
      const now = () => Math.round(video.currentTime * 10) / 10;
      let body;
      if (mode === 'cut') body = [
        h('p', { class: 'hint' }, '남길 부분의 시작과 끝을 정합니다. 영상을 재생하다가 버튼으로 현재 위치를 넣을 수 있습니다.'),
        h('div', { class: 'row' }, '시작', timeIn(cut.start, v => { cut.start = v; }), h('button', { class: 'btn small', onclick: () => { cut.start = now(); drawTools(); } }, '현재 위치'),
          h('span', { style: { width: '14px' } }), '끝', timeIn(cut.end, v => { cut.end = v; }), h('button', { class: 'btn small', onclick: () => { cut.end = now(); drawTools(); } }, '현재 위치')),
        h('button', { class: 'btn primary', onclick: () => run('cut') }, '이 부분만 새 동영상으로')];
      else if (mode === 'split') body = [
        h('p', { class: 'hint' }, '나눌 위치를 넣으면 여러 개의 동영상으로 나눕니다.'),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => { const t = now(); if (t > 0 && !splits.includes(t)) { splits.push(t); splits.sort((a, b) => a - b); } drawTools(); } }, '현재 위치에서 나누기'),
          ...splits.map((t, i) => h('span', { class: 'chip' }, fmt(t), h('button', { class: 've-x', onclick: () => { splits.splice(i, 1); drawTools(); } }, '✕')))),
        h('button', { class: 'btn primary', disabled: !splits.length, onclick: () => run('split') }, `${splits.length + 1}개로 나누기`)];
      else if (mode === 'join') body = [
        h('p', { class: 'hint' }, clips.length > 1 ? '왼쪽 순서대로 이어 붙입니다(↑↓로 순서 변경). 같은 휴대폰·같은 설정으로 찍은 영상끼리 합칠 수 있습니다.' : '합칠 동영상을 사진보관함 화면에서 두 개 이상 골라 ‘동영상 합치기·편집’을 누르세요.'),
        h('button', { class: 'btn primary', disabled: clips.length < 2, onclick: () => run('join') }, `${clips.length}개 합치기`)];
      else if (mode === 'subs') {
        const rows = h('div', { class: 've-subs' }, ...subs.map((s, i) => h('div', { class: 've-sub' },
          timeIn(s.start, v => { s.start = v; }), timeIn(s.end, v => { s.end = v; }),
          h('input', { type: 'text', value: s.text, placeholder: '자막 내용', oninput: e => { s.text = e.target.value; } }),
          h('button', { class: 'btn small ghost', onclick: () => { subs.splice(i, 1); drawTools(); } }, '삭제'))));
        const srt = h('input', { type: 'file', accept: '.srt', hidden: true, onchange: async e => { const fl = e.target.files[0]; if (fl) { subs.push(...parseSrt(await fl.text())); drawTools(); } } });
        body = [
          h('p', { class: 'hint' }, '켜고 끌 수 있는 자막으로 넣습니다(휴대폰·PC 플레이어에서 자막 켜기). 화면에 새기는 방식은 다시 압축해야 해서 이 버전에는 없습니다.'),
          h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => { const t = now(); subs.push({ start: t, end: t + 3, text: '' }); subs.sort((a, b) => a.start - b.start); drawTools(); } }, '＋ 현재 위치에 자막'),
            h('button', { class: 'btn small', onclick: () => srt.click() }, 'SRT 파일 불러오기'), srt),
          rows,
          h('button', { class: 'btn primary', disabled: !subs.length, onclick: () => run('subs') }, '자막 넣은 동영상 만들기')];
      } else body = [h('p', { class: 'hint' }, '소리만 빼고 영상은 그대로 둔 새 동영상을 만듭니다.'), h('button', { class: 'btn primary', onclick: () => run('mute') }, '소리 뺀 동영상 만들기')];
      tools.replaceChildren(seg, h('div', { class: 've-toolbody' }, ...body));
    }

    async function run(kind) {
      const c = clips[cur];
      try {
        status.textContent = '편집 도구를 불러오는 중… (처음 한 번은 약 30MB를 받습니다)';
        const ff = await ffmpeg();
        const prog = ({ progress }) => { if (progress > 0 && progress <= 1) status.textContent = `만드는 중… ${Math.round(progress * 100)}%`; };
        ff.on('progress', prog);
        const write = async (name, blob) => ff.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
        const made = [];
        const read = async (name, outName, type) => { const data = await ff.readFile(name); await ff.deleteFile(name).catch(() => {}); made.push(new File([data], outName, { type })); };
        status.textContent = '준비 중…';
        if (kind === 'join') {
          for (let i = 0; i < clips.length; i++) await ensure(i);
          const ext = extOf(clips[0].it.name);
          const names = [];
          for (let i = 0; i < clips.length; i++) { const n = `in${i}.${extOf(clips[i].it.name)}`; await write(n, clips[i].blob); names.push(n); }
          await ff.writeFile('list.txt', names.map(n => `file '${n}'`).join('\n'));
          const code = await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', 'out.' + ext]);
          if (code !== 0) throw new Error('합치지 못했습니다. 형식이나 해상도가 다른 영상은 합칠 수 없습니다.');
          await read('out.' + ext, `${baseOf(clips[0].it.name)}_합침.${ext}`, clips[0].it.mime);
          for (const n of names) await ff.deleteFile(n).catch(() => {});
        } else {
          await ensure(cur);
          const ext = extOf(c.it.name), inName = 'in.' + ext, type = c.it.mime || 'video/mp4';
          await write(inName, c.blob);
          if (kind === 'cut') {
            if (!(cut.end > cut.start)) throw new Error('끝 시각이 시작보다 뒤여야 합니다.');
            const code = await ff.exec(['-ss', String(cut.start), '-to', String(cut.end), '-i', inName, '-c', 'copy', '-map', '0', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', 'out.' + ext]);
            if (code !== 0) throw new Error('자르지 못했습니다.');
            await read('out.' + ext, `${baseOf(c.it.name)}_${fmt(cut.start).replace(/[:.]/g, '')}-${fmt(cut.end).replace(/[:.]/g, '')}.${ext}`, type);
          } else if (kind === 'split') {
            const pts = [0, ...splits, video.duration || c.it.duration || 1e9];
            for (let i = 0; i < pts.length - 1; i++) {
              const code = await ff.exec(['-ss', String(pts[i]), '-to', String(pts[i + 1]), '-i', inName, '-c', 'copy', '-map', '0', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', `out${i}.${ext}`]);
              if (code !== 0) throw new Error('나누지 못했습니다.');
              await read(`out${i}.${ext}`, `${baseOf(c.it.name)}_${i + 1}.${ext}`, type);
            }
          } else if (kind === 'subs') {
            const srt = subs.filter(s => s.text.trim() && s.end > s.start).map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text.trim()}\n`).join('\n');
            await ff.writeFile('subs.srt', new TextEncoder().encode(srt));
            const outExt = ext === 'mov' ? 'mov' : 'mp4';
            const code = await ff.exec(['-i', inName, '-i', 'subs.srt', '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=kor', '-movflags', '+faststart', 'out.' + outExt]);
            if (code !== 0) throw new Error('자막을 넣지 못했습니다.');
            await read('out.' + outExt, `${baseOf(c.it.name)}_자막.${outExt}`, outExt === 'mov' ? 'video/quicktime' : 'video/mp4');
            await ff.deleteFile('subs.srt').catch(() => {});
          } else if (kind === 'mute') {
            const code = await ff.exec(['-i', inName, '-c', 'copy', '-an', '-movflags', '+faststart', 'out.' + ext]);
            if (code !== 0) throw new Error('소리를 빼지 못했습니다.');
            await read('out.' + ext, `${baseOf(c.it.name)}_무음.${ext}`, type);
          }
          await ff.deleteFile(inName).catch(() => {});
        }
        ff.off('progress', prog);
        status.textContent = `완료 · ${made.length}개`;
        results.push(...made);
        drawOut();
      } catch (e) { status.textContent = ''; toast(e.message || String(e), 'err'); }
    }
    function drawOut() {
      out.replaceChildren(...(results.length ? [h('div', { class: 'fl-sec-t', style: { marginTop: '14px' } }, '만든 동영상'),
        ...results.map(fl => h('div', { class: 've-clip' }, h('span', { class: 've-clipname' }, fl.name), h('button', { class: 'btn small ghost', onclick: () => saveFile(fl.name, fl) }, '내려받기'))),
        h('p', { class: 'hint' }, '닫으면 만든 동영상이 사진보관함에 올라갑니다.')] : []));
    }
    drawList();
    select(0);
  });
}
