// 의견 보내기: 불편한 점·오류·바라는 기능을 관리자에게. 폰은 공유 창(카톡·메일, 캡처 첨부), PC는 메일·복사.
import { h, toast, shrinkImage, copyText, download } from '../util.js';
import { native } from '../native.js';
import { APP_VERSION } from './devtools.js';

const KINDS = ['불편해요', '오류가 나요', '이런 기능이 있으면', '기타'];
export async function mount(root) {
  const C = window.MYAIDE_CONFIG || {};
  let kind = KINDS[0], shots = [];
  const chips = h('div', { class: 'rc-cats' });
  const drawChips = () => chips.replaceChildren(...KINDS.map(k => h('button', { type: 'button', class: 'rc-cat', role: 'radio', 'aria-checked': String(k === kind), onclick: () => { kind = k; drawChips(); } }, k)));
  drawChips();
  const text = h('textarea', { rows: 7, placeholder: '어느 화면에서 무엇을 했을 때 어땠는지 적어 주세요.\n예) 가계부에서 영수증을 찍었는데 금액이 0원으로 나와요.' });
  const thumbs = h('div', { class: 'aide-tray' });
  const drawThumbs = () => thumbs.replaceChildren(...shots.map((s, i) => h('span', { class: 'aide-thumb' }, h('img', { src: s.url, alt: '캡처' }), h('button', { type: 'button', 'aria-label': '빼기', onclick: () => { shots.splice(i, 1); drawThumbs(); } }, '×'))));
  const addFiles = async fs => { for (const f of fs) if (/^image\//.test(f.type) && shots.length < 4) { const url = await shrinkImage(f, 1600, .85); shots.push({ url, blob: await (await fetch(url)).blob() }); } drawThumbs(); };
  const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: e => { addFiles([...e.target.files]); e.target.value = ''; } });
  text.addEventListener('paste', e => { const fs = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()); if (fs.length) { e.preventDefault(); addFiles(fs); } });
  const env = () => `MY AIDE ${APP_VERSION} · ${native.available ? 'Windows 앱' : /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone/iPad' : /Android/.test(navigator.userAgent) ? 'Android' : '브라우저'} · ${screen.width}×${screen.height} · ${new Date().toLocaleString('ko-KR')}`;
  const body = () => `[MY AIDE 의견 · ${kind}]\n\n${text.value.trim()}\n\n---\n${env()}`;
  const err = h('p', { class: 'error' });
  const ok = () => { if (!text.value.trim()) { err.textContent = '내용을 적어 주세요.'; text.focus(); return false; } err.textContent = ''; return true; };
  const share = async () => {
    if (!ok()) return;
    const files = shots.map((s, i) => new File([s.blob], `캡처${i + 1}.jpg`, { type: 'image/jpeg' }));
    try {
      if (navigator.canShare && navigator.canShare({ files })) await navigator.share({ title: 'MY AIDE 의견', text: body(), files });
      else await navigator.share({ title: 'MY AIDE 의견', text: body() });
      done();
    } catch (e) { if (e.name !== 'AbortError') toast('공유하지 못했습니다: ' + e.message, 'err'); }
  };
  const mail = () => {
    if (!ok()) return;
    shots.forEach((s, i) => download(`MYAIDE_캡처${i + 1}.jpg`, s.blob));
    location.href = `mailto:${C.adminEmail}?subject=${encodeURIComponent('MY AIDE 의견 · ' + kind)}&body=${encodeURIComponent(body() + (shots.length ? `\n\n(캡처 ${shots.length}장을 내려받았습니다. 메일에 첨부해 주세요.)` : ''))}`;
    done();
  };
  const done = () => { toast('고맙습니다! 의견을 보냈습니다'); text.value = ''; shots = []; drawThumbs(); };
  const canShare = !!navigator.share && /iPhone|iPad|Android/.test(navigator.userAgent);
  root.append(h('div', { class: 'view-head' }, h('h1', null, '의견 보내기')),
    h('div', { class: 'pad fb' },
      h('p', { class: 'hint', style: { margin: 0 } }, '불편한 점, 오류, 바라는 기능을 알려 주세요. MY AIDE를 고치는 데 그대로 씁니다. 화면 캡처가 있으면 훨씬 빨리 고칠 수 있어요.'),
      h('div', { class: 'field' }, '종류', chips),
      h('label', { class: 'field' }, '내용', text),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => fileIn.click() }, '화면 캡처 첨부'), h('span', { class: 'muted', style: { fontSize: '13px' } }, 'PC는 Ctrl+V로 붙여 넣어도 됩니다'), fileIn),
      thumbs, err,
      h('div', { class: 'row fb-acts' },
        canShare ? h('button', { class: 'btn primary', onclick: share }, '보내기 (카톡·메일)') : null,
        !canShare && C.adminEmail ? h('button', { class: 'btn primary', onclick: mail }, '메일로 보내기') : null,
        h('button', { class: 'btn', onclick: () => { if (ok()) { copyText(body(), '내용을 복사했습니다. 카톡·메일에 붙여 넣어 보내 주세요'); } } }, '내용 복사')),
      h('p', { class: 'hint', style: { margin: 0 } }, '함께 보내는 정보: ' + env() + '. 내 기록 내용은 보내지 않습니다.')));
  return {};
}
