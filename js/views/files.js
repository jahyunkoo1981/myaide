import { h, uid, today, fmtTime, copyText, toast, download } from '../util.js';
import * as db from '../db.js';
import { native } from '../native.js';
import { prefs } from '../prefs.js';
import { openImageEditor } from '../imageeditor.js';

// Opens the annotator for a screenshot and saves the result where the user chooses.
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
    catch { toast('이 브라우저는 이미지 복사를 지원하지 않습니다. PNG 저장을 써 주세요.', 'err'); }
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

// Browser fallback: grab one frame through the screen-share picker (desktop Chrome, Edge, Safari on Mac).
async function browserCapture() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' }, audio: false });
  try {
    const video = h('video', { muted: true, playsinline: true });
    video.srcObject = stream; await video.play();
    await new Promise(r => setTimeout(r, 250));
    const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    return c.toDataURL('image/png');
  } finally { stream.getTracks().forEach(t => t.stop()); }
}

export async function mount(root) {
  const head = h('div', { class: 'view-head' }, h('h1', null, '파일 검색·화면 캡처'));
  const body = h('div', { class: 'pad' });
  root.append(head, body);

  const capture = async all => {
    try {
      const dataUrl = native.available ? (await native.call('capture.screen', { all })).dataUrl : await browserCapture();
      await openCapture({ dataUrl });
    } catch (e) { if (e.name !== 'NotAllowedError') toast(e.message, 'err'); }
  };
  const canBrowserCapture = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  body.append(h('section', { class: 'block' }, h('h2', null, '화면 캡처'),
    native.available
      ? [h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => capture(prefs().capture.allScreens) }, prefs().capture.allScreens ? '모든 모니터 캡처' : '현재 화면 캡처'),
          h('button', { class: 'btn', onclick: () => capture(true) }, '모든 모니터 캡처 (듀얼)')),
        h('p', { class: 'hint' }, '어디서든 ', h('span', { class: 'kbd' }, 'Ctrl+Shift+F10'), ' 설정한 범위 캡처, ', h('span', { class: 'kbd' }, 'Ctrl+Shift+F11'), ' 모든 모니터 캡처. 캡처 뒤 글자·화살표·가리기를 넣어 업무메모나 일지로 저장합니다.')]
      : canBrowserCapture
        ? [h('button', { class: 'btn primary', onclick: () => capture(false) }, '화면 캡처'),
          h('p', { class: 'hint' }, '화면 공유 창에서 캡처할 화면을 고르면 한 장을 찍습니다. 단축키와 듀얼 모니터 한 번에 찍기는 Windows 앱에서 쓸 수 있습니다.')]
        : h('p', { class: 'muted' }, '이 기기에서는 화면 캡처를 쓸 수 없습니다. iPhone·iPad는 기기 스크린샷을 찍은 뒤 업무메모의 ‘이미지’로 넣어 주세요.')));

  if (!native.available) {
    body.append(h('section', { class: 'block' }, h('h2', null, '파일 검색'),
      h('p', { class: 'muted' }, 'PC 파일 검색은 Windows 앱에서 쓸 수 있습니다. 웹 브라우저는 보안상 PC 파일을 검색할 수 없습니다.')));
    return;
  }

  const q = h('input', { type: 'search', placeholder: '파일 이름 또는 내용 (예: 보고서 *.pdf)' });
  const scope = h('select', { style: { width: 'auto' } },
    h('option', { value: 'index' }, 'Windows 검색 색인 (빠름)'), h('option', { value: 'folder' }, '특정 폴더'), h('option', { value: 'all' }, '전체 드라이브'));
  const folder = h('input', { type: 'text', placeholder: '폴더 경로', hidden: true });
  const pick = h('button', { class: 'btn small', hidden: true, onclick: async () => { const p = await native.call('shell.pickFolder').catch(() => null); if (p) folder.value = p; } }, '폴더 선택');
  scope.addEventListener('change', () => { folder.hidden = pick.hidden = scope.value !== 'folder'; });
  const results = h('div');
  const status = h('p', { class: 'hint' });
  const run = async () => {
    if (!q.value.trim()) return;
    status.textContent = scope.value === 'all' ? '전체 드라이브를 찾는 중… 시간이 걸릴 수 있습니다.' : '찾는 중…';
    results.replaceChildren();
    try {
      const r = await native.call('files.search', { query: q.value.trim(), scope: scope.value, folder: folder.value.trim() });
      status.textContent = r.items.length ? `${r.items.length}개${r.truncated ? ' (처음 500개만 표시)' : ''}` : '찾은 파일이 없습니다.' + (scope.value === 'index' ? ' 색인되지 않은 폴더라면 ‘특정 폴더’로 찾아 보세요.' : '');
      results.replaceChildren(...r.items.map(f => h('div', { class: 'file-row' },
        h('div', null, h('div', null, f.name), h('div', { class: 'p' }, f.path + ' · ' + (f.modified || '') + (f.size != null ? ' · ' + fmtSize(f.size) : ''))),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: () => native.call('shell.open', { path: f.path }).catch(e => toast(e.message, 'err')) }, '열기'),
          h('button', { class: 'btn small', onclick: () => native.call('shell.reveal', { path: f.path }).catch(e => toast(e.message, 'err')) }, '위치 열기'),
          h('button', { class: 'btn small ghost', onclick: () => copyText(f.path, '경로를 복사했습니다') }, '경로 복사')))));
    } catch (e) { status.textContent = ''; toast(e.message, 'err'); }
  };
  q.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  body.append(h('section', { class: 'block' }, h('h2', null, '파일 검색'),
    h('div', { class: 'row' }, h('div', { class: 'grow', style: { minWidth: '220px' } }, q), scope, h('button', { class: 'btn primary', onclick: run }, '검색')),
    h('div', { class: 'row', style: { marginTop: '8px' } }, folder, pick), status, results));
  q.focus();
}

const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
