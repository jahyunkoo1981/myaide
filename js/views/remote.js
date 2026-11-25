// 원격지원 (지원하는 쪽): make a link, the other person opens it and shares the screen (PC) or camera (phone).
// Pointer marks, chat and voice need nothing installed. Mouse/keyboard control works when the other PC runs
// the small 원격지원 도우미 (MyAideSupport.exe) — a separate program with no MY AIDE data.
import { h, toast, copyText } from '../util.js';

let S = null;   // the live session survives switching menus

const VK = {
  Backspace: 8, Tab: 9, Enter: 13, NumpadEnter: 13, ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17, AltLeft: 18, AltRight: 18,
  Pause: 19, CapsLock: 20, Escape: 27, Space: 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  PrintScreen: 44, Insert: 45, Delete: 46, MetaLeft: 91, MetaRight: 92, ContextMenu: 93, Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190,
  Slash: 191, Backquote: 192, BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222, Lang1: 21, Lang2: 25
};
function vkOf(code) {
  if (VK[code]) return VK[code];
  let m;
  if ((m = code.match(/^Key([A-Z])$/))) return m[1].charCodeAt(0);
  if ((m = code.match(/^Digit(\d)$/))) return 48 + Number(m[1]);
  if ((m = code.match(/^Numpad(\d)$/))) return 96 + Number(m[1]);
  if ((m = code.match(/^F(\d{1,2})$/))) return 111 + Number(m[1]);
  return 0;
}

function base() {
  const cfg = window.MYAIDE_CONFIG || {};
  if (location.protocol === 'https:' && location.hostname.endsWith('github.io')) return location.origin + location.pathname.replace(/[^/]*$/, '');
  return cfg.publicUrl || 'https://jahyunkoo1981.github.io/myaide/';
}
function loadPeer() {
  if (window.Peer) return Promise.resolve();
  // VisualCode's editor installs an AMD `define`; hide it so the library sets window.Peer as usual.
  const amd = window.define; window.define = undefined;
  const back = () => { if (amd) window.define = amd; };
  return new Promise((res, rej) => { const s = h('script', { src: 'vendor/peerjs.min.js' }); s.onload = () => { back(); res(); }; s.onerror = () => { back(); rej(new Error('연결 모듈을 불러오지 못했습니다.')); }; document.head.append(s); });
}
const rid = () => 'myaide-' + [...crypto.getRandomValues(new Uint8Array(9))].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');

export async function mount(root) {
  const body = h('div', { class: 'rs' });
  root.append(h('div', { class: 'view-head' }, h('h1', null, '원격지원'),
    h('button', { class: 'btn small ghost', onclick: () => location.hash = '#/manual' }, '사용법')), body);
  const ui = {};   // live elements while this view is open
  if (S) S.ui = ui;

  function draw() {
    if (!S) return drawStart();
    if (!S.guest) return drawWaiting();
    drawSession();
  }

  function drawStart() {
    body.replaceChildren(h('div', { class: 'hero-search', style: { paddingTop: '48px' } },
      h('h2', null, '링크 하나로 원격 지원'),
      h('p', { class: 'sub', style: { maxWidth: '560px', textAlign: 'center' } }, '링크를 만들어 상대에게 보내세요. 상대가 링크를 열고 ‘화면 공유 시작’을 누르면 바로 화면이 보입니다. 설치는 필요 없습니다.'),
      h('button', { class: 'btn primary', style: { minHeight: '50px', padding: '0 28px', fontSize: '16px' }, onclick: start }, '지원 링크 만들기')),
      h('div', { class: 'pad rs-notes' },
        h('div', { class: 'rs-note' }, h('b', null, 'PC (Windows·Mac)'), '화면 보기 · 채팅 · 음성 · 빨간 포인터로 위치 짚기. Windows는 상대가 ‘원격지원 도우미’를 실행하면 마우스·키보드 조작까지 됩니다.'),
        h('div', { class: 'rs-note' }, h('b', null, '휴대폰·태블릿'), '휴대폰 브라우저는 화면 공유를 막아 둡니다. 상대가 카메라로 비춰 주는 화면, 음성, 채팅으로 지원합니다.'),
        h('div', { class: 'rs-note' }, h('b', null, '나는 어디서든'), '지원하는 쪽은 PC·iPhone·iPad·Android 어디서나 이 메뉴로 할 수 있습니다.')));
  }

  async function start() {
    try { await loadPeer(); } catch (e) { toast(e.message, 'err'); return; }
    const id = rid();
    S = { id, link: base() + 'remote.html#' + id, peer: null, conn: null, guest: null, stream: null, mic: null, ctl: false, mode: 'pointer', chat: [], ui };
    const opts = (window.MYAIDE_CONFIG || {}).peer;
    const peer = S.peer = opts ? new window.Peer(id, opts) : new window.Peer(id);
    peer.on('error', e => { toast('연결 오류: ' + (e.type || e.message), 'err'); });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
    peer.on('connection', c => {
      if (S.conn && S.conn.open) { c.on('open', () => { c.send({ t: 'chat', text: '이미 다른 분과 연결되어 있습니다.' }); setTimeout(() => c.close(), 500); }); return; }
      S.conn = c;
      c.on('data', onData);
      c.on('close', () => { if (S && S.conn === c) { S.guest = null; S.stream = null; S.ctl = false; S.conn = null; note('상대가 나갔습니다. 같은 링크로 다시 들어올 수 있습니다.'); draw(); } });
    });
    peer.on('call', call => {
      call.answer(S.mic || undefined);
      call.on('stream', s => { S.stream = s; S.call = call; draw(); });
      call.on('close', () => { if (S && S.call === call) { S.stream = null; draw(); } });
    });
    draw();
  }

  function onData(d) {
    if (!S || !d) return;
    if (d.t === 'hello') { S.guest = d; note(d.device === 'pc' ? '상대가 연결했습니다. 상대가 ‘화면 공유 시작’을 누르면 화면이 보입니다.' : '상대가 휴대폰·태블릿으로 연결했습니다. 카메라 화면과 음성으로 지원할 수 있습니다.'); draw(); }
    if (d.t === 'info') { S.info = d; if (d.kind === 'none') S.stream = null; draw(); }
    if (d.t === 'ctl') { S.ctl = !!d.on; if (!S.ctl && S.mode === 'control') S.mode = 'pointer'; note(S.ctl ? '원격지원 도우미가 연결되어 마우스·키보드를 조작할 수 있습니다.' : '원격지원 도우미 연결이 끝났습니다.'); draw(); }
    if (d.t === 'chat') { S.chat.push({ who: 'them', text: d.text }); drawChat(); if (document.hidden) toast('원격지원: ' + d.text); }
    if (d.t === 'bye') note('상대가 페이지를 닫았습니다.');
  }
  const send = o => { if (S && S.conn && S.conn.open) S.conn.send(o); };
  const note = text => { if (!S) return; S.chat.push({ who: 'sys', text }); drawChat(); };

  function linkCard() {
    return h('div', { class: 'rs-link' },
      h('input', { type: 'text', readOnly: true, value: S.link, onclick: e => e.target.select() }),
      h('button', { class: 'btn primary', onclick: () => copyText(S.link, '링크를 복사했습니다. 상대에게 보내세요') }, '링크 복사'),
      navigator.share ? h('button', { class: 'btn', onclick: () => navigator.share({ title: '원격 지원', text: '원격 지원 링크입니다. 열고 ‘화면 공유 시작’을 눌러 주세요.', url: S.link }).catch(() => {}) }, '보내기') : null);
  }

  function drawWaiting() {
    body.replaceChildren(h('div', { class: 'hero-search', style: { paddingTop: '36px' } },
      h('h2', null, '상대가 링크를 열기를 기다리는 중'),
      h('p', { class: 'sub' }, '카카오톡·문자·메일로 링크를 보내세요. 이 화면을 열어 둔 동안 연결을 받습니다.'),
      linkCard(),
      h('div', { class: 'rs-wait' }, h('i'), '대기 중'),
      h('button', { class: 'btn ghost danger', onclick: end }, '지원 끝내기')));
  }

  function drawSession() {
    const g = S.guest, info = S.info || {};
    const video = h('video', { autoplay: true, playsInline: true, muted: false });
    const stage = h('div', { class: 'rs-stage' + (S.mode === 'control' ? ' control' : ''), tabindex: '0' }, video,
      !S.stream ? h('div', { class: 'rs-empty' }, g.device === 'pc' ? '상대가 ‘화면 공유 시작’을 누르면 여기에 화면이 보입니다.' : '상대가 ‘카메라로 보여주기’를 누르면 여기에 보입니다.') : null);
    if (S.stream) { video.srcObject = S.stream; video.play().catch(() => {}); }
    ui.video = video; ui.stage = stage;
    wireStage(stage, video);

    const modeSeg = h('div', { class: 'seg' },
      h('button', { type: 'button', 'aria-pressed': String(S.mode === 'pointer'), onclick: () => { S.mode = 'pointer'; draw(); } }, '포인터'),
      h('button', { type: 'button', 'aria-pressed': String(S.mode === 'control'), disabled: !S.ctl, title: S.ctl ? '마우스·키보드 조작' : '상대가 원격지원 도우미를 실행하면 켤 수 있습니다', onclick: () => { S.mode = 'control'; draw(); setTimeout(() => stage.focus(), 0); } }, '조작'));
    const textIn = h('input', { type: 'text', placeholder: '상대 PC에 입력할 글자 (한글 가능) → Enter', disabled: !S.ctl });
    textIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && textIn.value) { send({ t: 'text', s: textIn.value }); textIn.value = ''; } });
    const keyBtn = (label, vks) => h('button', { class: 'btn small', disabled: !S.ctl, onclick: () => { vks.forEach(v => send({ t: 'key', vk: v, down: true })); [...vks].reverse().forEach(v => send({ t: 'key', vk: v, down: false })); stage.focus(); } }, label);
    const voiceBtn = h('button', { class: 'btn small' + (S.mic ? ' primary' : ''), onclick: toggleVoice }, S.mic ? '음성 끄기' : '음성 켜기');

    body.replaceChildren(h('div', { class: 'rs-session' },
      h('div', { class: 'rs-main' },
        h('div', { class: 'rs-bar' },
          h('span', { class: 'rs-who' }, h('i', { class: S.stream ? 'on' : '' }), g.device === 'pc' ? '상대 PC' : '상대 휴대폰', ' · ',
            S.stream ? (info.kind === 'camera' ? '카메라' : info.kind === 'audio' ? '음성만' : '화면 공유 중') : '연결됨'),
          h('span', { class: 'grow' }), modeSeg, voiceBtn,
          h('button', { class: 'btn small', onclick: () => (stage.requestFullscreen ? stage.requestFullscreen() : video.webkitEnterFullscreen?.()) }, '전체 화면'),
          h('button', { class: 'btn small ghost danger', onclick: end }, '끝내기')),
        stage,
        S.ctl ? h('div', { class: 'rs-keys' }, textIn, keyBtn('Enter', [13]), keyBtn('Tab', [9]), keyBtn('Esc', [27]), keyBtn('⌫', [8]),
          keyBtn('Ctrl+C', [17, 67]), keyBtn('Ctrl+V', [17, 86]), keyBtn('Ctrl+Z', [17, 90]), keyBtn('Alt+Tab', [18, 9]), keyBtn('Win', [91]), keyBtn('한/영', [21])) :
          h('p', { class: 'hint', style: { margin: '6px 2px 0' } }, g.device === 'pc'
            ? (g.windows ? '포인터 모드: 화면을 누르면 상대 화면에 빨간 표시가 나타납니다. 마우스·키보드 조작은 상대가 링크 페이지에서 ‘원격지원 도우미’를 실행하면 켜집니다.' : '포인터 모드: 화면을 누르면 상대 페이지에 빨간 표시가 나타납니다. (Mac은 조작 도우미가 없습니다)')
            : '휴대폰은 조작할 수 없습니다. 카메라 화면·음성·채팅으로 안내해 주세요.')),
      h('aside', { class: 'rs-side' },
        h('div', { class: 'fl-sec-t' }, '상대에게 보낸 링크'), linkCard(),
        h('div', { class: 'fl-sec-t', style: { marginTop: '8px' } }, '채팅'),
        ui.log = h('div', { class: 'rs-log' }),
        chatInput())));
    drawChat();
  }

  function chatInput() {
    const inp = h('input', { type: 'text', placeholder: '메시지', autocomplete: 'off' });
    const go = () => { const t = inp.value.trim(); if (!t) return; send({ t: 'chat', text: t }); S.chat.push({ who: 'me', text: t }); inp.value = ''; drawChat(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) go(); });
    return h('div', { class: 'row' }, h('div', { class: 'grow' }, inp), h('button', { class: 'btn primary', onclick: go }, '보내기'));
  }
  function drawChat() {
    const log = S && S.ui && S.ui.log; if (!log || !log.isConnected) return;
    log.replaceChildren(...S.chat.slice(-80).map(m => h('div', { class: 'msg ' + (m.who === 'me' ? 'me' : 'ai') + (m.who === 'sys' ? ' muted' : '') }, m.text)));
    log.scrollTop = log.scrollHeight;
  }

  // Map a pointer on the (letter-boxed) video to 0..1 of the shared screen.
  function norm(e, video) {
    const r = video.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return null;
    const k = Math.min(r.width / vw, r.height / vh), w = vw * k, hh = vh * k;
    const x = (e.clientX - r.left - (r.width - w) / 2) / w, y = (e.clientY - r.top - (r.height - hh) / 2) / hh;
    return x < 0 || y < 0 || x > 1 || y > 1 ? null : { x: +x.toFixed(4), y: +y.toFixed(4) };
  }
  function wireStage(stage, video) {
    let lastMove = 0, pressTimer = null, touchStart = null;
    const btnOf = e => e.button === 2 ? 2 : e.button === 1 ? 1 : 0;
    stage.addEventListener('contextmenu', e => e.preventDefault());
    stage.addEventListener('pointerdown', e => {
      const p = norm(e, video); if (!p) return;
      stage.focus({ preventScroll: true });
      if (S.mode !== 'control') { send({ t: 'ptr', ...p }); ripple(e); return; }
      if (e.pointerType === 'touch') { touchStart = p; pressTimer = setTimeout(() => { send({ t: 'mouse', a: 'click', b: 2, ...p }); touchStart = null; }, 600); return; }
      stage.setPointerCapture(e.pointerId);
      send({ t: 'mouse', a: 'down', b: btnOf(e), ...p });
    });
    stage.addEventListener('pointermove', e => {
      if (S.mode !== 'control' || e.pointerType === 'touch') return;
      const now = performance.now(); if (now - lastMove < 33) return; lastMove = now;
      const p = norm(e, video); if (p) send({ t: 'mouse', a: 'move', ...p });
    });
    stage.addEventListener('pointerup', e => {
      if (S.mode !== 'control') return;
      const p = norm(e, video) || touchStart; if (!p) return;
      if (e.pointerType === 'touch') { clearTimeout(pressTimer); if (touchStart) send({ t: 'mouse', a: 'click', b: 0, ...p }); touchStart = null; return; }
      send({ t: 'mouse', a: 'up', b: btnOf(e), ...p });
    });
    stage.addEventListener('wheel', e => {
      if (S.mode !== 'control') return; e.preventDefault();
      const p = norm(e, video); if (p) send({ t: 'mouse', a: 'wheel', dy: Math.round(e.deltaY), ...p });
    }, { passive: false });
    stage.addEventListener('keydown', e => {
      if (S.mode !== 'control' || e.isComposing || e.key === 'Process') return;
      const vk = vkOf(e.code); if (!vk) return;
      e.preventDefault(); send({ t: 'key', vk, down: true });
    });
    stage.addEventListener('keyup', e => {
      if (S.mode !== 'control') return;
      const vk = vkOf(e.code); if (!vk) return;
      e.preventDefault(); send({ t: 'key', vk, down: false });
    });
  }
  function ripple(e) {
    const r = ui.stage.getBoundingClientRect();
    const d = h('span', { class: 'rs-ripple', style: { left: (e.clientX - r.left) + 'px', top: (e.clientY - r.top) + 'px' } });
    ui.stage.append(d); setTimeout(() => d.remove(), 900);
  }

  async function toggleVoice() {
    if (S.mic) { S.mic.getTracks().forEach(t => t.stop()); S.mic = null; if (S.voiceCall) { try { S.voiceCall.close(); } catch {} S.voiceCall = null; } draw(); return; }
    try {
      S.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (S.conn) S.voiceCall = S.peer.call(S.conn.peer, S.mic);
      draw();
    } catch (e) { toast('마이크를 쓸 수 없습니다: ' + e.message, 'err'); }
  }

  function end() {
    if (!S) return;
    send({ t: 'chat', text: '지원을 마칩니다. 감사합니다.' });
    setTimeout(() => {
      if (!S) return;
      try { S.mic && S.mic.getTracks().forEach(t => t.stop()); } catch {}
      try { S.peer.destroy(); } catch {}
      S = null; draw();
    }, 300);
  }

  draw();
  return { cleanup: () => { if (S) S.ui = {}; } };
}
