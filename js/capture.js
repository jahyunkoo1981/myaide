// 화면 캡처: press the button (or Ctrl+Shift+F10/F11 in the Windows app) → drag the area → annotate → save.
import { h, uid, today, fmtTime, toast, download } from './util.js';
import * as db from './db.js';
import { native } from './native.js';
import { prefs } from './prefs.js';
import { openImageEditor } from './imageeditor.js';

let busy = false;

export async function startCapture(all) {
  if (busy) return;
  busy = true;
  try {
    let dataUrl;
    if (native.available) {
      // The Windows app hides itself, freezes the screen and shows a drag-to-select overlay.
      const r = await native.call('capture.region', { all: all ?? !!prefs().capture.allScreens });
      if (!r || r.cancelled) return;
      dataUrl = r.dataUrl;
    } else {
      const frame = await grabFrame();
      if (!frame) return;
      dataUrl = await pickRegion(frame);
      if (!dataUrl) return;
    }
    await openCapture({ dataUrl });
  } catch (e) {
    if (e.name !== 'NotAllowedError') toast(e.message, 'err');
  } finally { busy = false; }
}

// Browser: one frame through the screen-share picker (desktop Chrome, Edge, Safari on Mac).
async function grabFrame() {
  if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) {
    toast('이 기기에서는 화면 캡처를 쓸 수 없습니다. 기기 스크린샷을 찍어 메모에 넣어 주세요.', 'err');
    return null;
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' }, audio: false, preferCurrentTab: false });
  try {
    const video = h('video', { muted: true, playsinline: true });
    video.srcObject = stream; await video.play();
    await new Promise(r => setTimeout(r, 300));
    const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    return c;
  } finally { stream.getTracks().forEach(t => t.stop()); }
}

// Browser: full-window overlay to drag the area to keep. Esc cancels, Enter keeps the whole frame.
function pickRegion(frame) {
  return new Promise(resolve => {
    const overlay = h('div', { class: 'region-overlay', tabindex: '-1' });
    const img = h('img', { src: frame.toDataURL('image/png'), alt: '', draggable: false });
    const box = h('div', { class: 'region-box', hidden: true });
    const tip = h('div', { class: 'region-tip' }, '드래그해서 캡처할 영역을 고르세요 · Enter 전체 · Esc 취소');
    overlay.append(img, box, tip);
    document.body.append(overlay);
    overlay.focus();
    let start = null, rect = null;
    const scale = () => frame.width / img.getBoundingClientRect().width;
    const finish = r => { overlay.remove(); resolve(r); };
    const crop = r => {
      const s = scale(), ir = img.getBoundingClientRect();
      const x = Math.max(0, (r.x - ir.left) * s), y = Math.max(0, (r.y - ir.top) * s);
      const w = Math.min(frame.width - x, r.w * s), hgt = Math.min(frame.height - y, r.h * s);
      const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(hgt);
      c.getContext('2d').drawImage(frame, x, y, w, hgt, 0, 0, w, hgt);
      return c.toDataURL('image/png');
    };
    overlay.addEventListener('pointerdown', e => { start = { x: e.clientX, y: e.clientY }; overlay.setPointerCapture(e.pointerId); box.hidden = false; tip.hidden = true; });
    overlay.addEventListener('pointermove', e => {
      if (!start) return;
      rect = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
      Object.assign(box.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
    });
    overlay.addEventListener('pointerup', () => { if (rect && rect.w > 6 && rect.h > 6) finish(crop(rect)); else { start = null; box.hidden = true; tip.hidden = false; } });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') finish(null);
      if (e.key === 'Enter') finish(frame.toDataURL('image/png'));
    });
  });
}

// Annotate the captured area, then save it where the user chooses.
export async function openCapture({ dataUrl }) {
  const r = await openImageEditor(dataUrl, { title: '화면 캡처', actions: [
    { label: '취소', value: null },
    { label: 'PNG 저장', value: 'png' },
    { label: '복사', value: 'copy' },
    { label: '오늘 업무일지에 넣기', value: 'journal' },
    { label: '업무메모로 저장', kind: 'primary', value: 'note' }
  ] });
  if (!r) return;
  const img = `<p><img src="${r.dataUrl}" alt=""></p><p><br></p>`;
  if (r.action === 'png') download(`캡처 ${fmtTime(Date.now()).replace(/[: ]/g, '-')}.png`, await (await fetch(r.dataUrl)).blob());
  if (r.action === 'copy') {
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': await (await fetch(r.dataUrl)).blob() })]); toast('이미지를 복사했습니다'); }
    catch { toast('이미지를 복사하지 못했습니다. PNG 저장을 써 주세요.', 'err'); }
  }
  if (r.action === 'note') {
    const id = uid();
    await db.put('notes', id, { title: '화면 캡처 ' + fmtTime(Date.now()), body: img, date: today(), createdAt: Date.now() });
    toast('업무메모로 저장했습니다'); location.hash = '#/notes/' + id;
  }
  if (r.action === 'journal') {
    const j = await db.get('journal', today());
    await db.put('journal', today(), { date: today(), body: (j ? j.body : '') + img });
    toast('오늘 업무일지에 넣었습니다'); location.hash = '#/journal/' + today();
  }
}
