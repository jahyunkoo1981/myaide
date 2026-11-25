// 원격 지원 — the page the other person opens from the link. No login, no MY AIDE data.
// PC: shares the screen (getDisplayMedia). Phones/tablets: browsers can't share the screen, so the camera is offered.
// Mouse/keyboard control is relayed to the small MyAideSupport.exe on 127.0.0.1 if the person runs it.
(function () {
  'use strict';
  var id = decodeURIComponent((location.hash || '').slice(1));
  var $ = function (s) { return document.getElementById(s); };
  var statusEl = $('status'), actions = $('actions'), log = $('log'), msg = $('msg');
  var peer = null, conn = null, call = null, stream = null, ws = null, wsTimer = null, kind = null;
  var canScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  var isWindows = /Windows/i.test(navigator.userAgent);

  function setStatus(text, cls) {
    statusEl.className = 'rg-status' + (cls ? ' ' + cls : '');
    statusEl.lastElementChild.textContent = text;
  }
  function btn(label, cls, fn) { var b = document.createElement('button'); b.className = 'btn ' + (cls || ''); b.textContent = label; b.onclick = fn; return b; }
  function say(who, text) {
    var d = document.createElement('div'); d.className = 'msg ' + (who === 'me' ? 'me' : 'ai'); d.textContent = text;
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  function send(o) { if (conn && conn.open) conn.send(o); }

  if (!/^myaide-[A-Za-z0-9_-]{6,40}$/.test(id)) {
    $('lead').textContent = '링크가 올바르지 않습니다. 받은 링크 전체를 다시 열어 주세요.';
    setStatus('연결할 수 없음', 'err');
    $('micRow').hidden = true;
    return;
  }
  if (typeof Peer === 'undefined') { setStatus('연결 모듈을 불러오지 못했습니다. 새로고침해 주세요.', 'err'); return; }

  function connect() {
    setStatus('지원하는 분과 연결하는 중…');
    var opts = (window.MYAIDE_CONFIG && window.MYAIDE_CONFIG.peer) || undefined;
    peer = opts ? new Peer(opts) : new Peer();
    peer.on('open', function () {
      conn = peer.connect(id, { reliable: true });
      conn.on('open', function () {
        setStatus('연결되었습니다. 아래 버튼으로 화면을 보여 주세요.', 'ok');
        send({ t: 'hello', device: canScreen ? 'pc' : 'mobile', os: navigator.platform || '', windows: isWindows });
        drawActions();
      });
      conn.on('data', onData);
      conn.on('close', function () { setStatus('연결이 끝났습니다.', 'err'); stopAll(); });
    });
    peer.on('call', function (c) { c.answer(); c.on('stream', function (s) { $('remoteAudio').srcObject = s; }); });
    peer.on('error', function (e) {
      if (e.type === 'peer-unavailable') setStatus('지원하는 분이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.', 'err');
      else setStatus('연결하지 못했습니다: ' + (e.type || e.message), 'err');
      actions.innerHTML = '';
      actions.appendChild(btn('다시 연결', 'primary big', function () { try { peer.destroy(); } catch (x) {} connect(); }));
    });
  }

  function drawActions() {
    actions.innerHTML = '';
    if (stream) {
      actions.appendChild(btn('공유 멈추기', 'big', function () { stopShare(); drawActions(); }));
      return;
    }
    if (canScreen) {
      actions.appendChild(btn('화면 공유 시작', 'primary big', startScreen));
      actions.appendChild(btn('카메라로 보여주기', 'big', function () { startCamera(); }));
    } else {
      actions.appendChild(btn('카메라로 보여주기', 'primary big', function () { startCamera(); }));
      actions.appendChild(btn('음성만 연결', 'big', startVoiceOnly));
      $('lead').textContent = '휴대폰·태블릿 브라우저는 화면 공유를 지원하지 않습니다. 카메라로 화면이나 물건을 비추고, 음성·채팅으로 도움을 받으세요.';
    }
  }

  function withMic(s) {
    if (!$('mic').checked) return Promise.resolve(s);
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(function (a) { a.getAudioTracks().forEach(function (t) { s.addTrack(t); }); return s; })
      .catch(function () { say('ai', '마이크를 쓸 수 없어 음성 없이 공유합니다.'); return s; });
  }

  function startScreen() {
    navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15, displaySurface: 'monitor' }, audio: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include' })
      .then(withMic).then(function (s) { begin(s, 'screen'); })
      .catch(function (e) { if (e && e.name !== 'NotAllowedError') say('ai', '화면을 공유하지 못했습니다: ' + e.message); });
  }
  function startCamera() {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: $('mic').checked })
      .then(function (s) { begin(s, 'camera'); })
      .catch(function (e) { say('ai', '카메라를 켜지 못했습니다: ' + e.message); });
  }
  function startVoiceOnly() {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (s) { begin(s, 'audio'); })
      .catch(function (e) { say('ai', '마이크를 켜지 못했습니다: ' + e.message); });
  }

  function begin(s, k) {
    stream = s; kind = k;
    var v = s.getVideoTracks()[0];
    $('local').srcObject = s;
    $('preview').classList.toggle('on', !!v);
    $('micRow').hidden = true;
    call = peer.call(id, s);
    call.on('stream', function (rs) { $('remoteAudio').srcObject = rs; });
    var info = { t: 'info', kind: k };
    if (v) {
      var st = v.getSettings();
      info.w = st.width; info.h = st.height; info.surface = st.displaySurface || (k === 'camera' ? 'camera' : '');
      v.addEventListener('ended', function () { stopShare(); drawActions(); });
    }
    send(info);
    setStatus(k === 'screen' ? '화면을 공유하고 있습니다.' : k === 'camera' ? '카메라 화면을 보내고 있습니다.' : '음성으로 연결되었습니다.', 'ok');
    $('ctl').hidden = !(k === 'screen' && isWindows);
    if (k === 'screen' && isWindows) { tryHelper(); if (info.surface && info.surface !== 'monitor') say('ai', '마우스 조작까지 받으려면 ‘전체 화면’을 골라 공유해 주세요.'); }
    drawActions();
  }

  function stopShare() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (call) { try { call.close(); } catch (x) {} call = null; }
    $('preview').classList.remove('on');
    $('micRow').hidden = false;
    send({ t: 'info', kind: 'none' });
    closeHelper();
    $('ctl').hidden = true;
  }
  function stopAll() { stopShare(); actions.innerHTML = ''; }

  // ---------- helper (MyAideSupport.exe) ----------
  function tryHelper() {
    clearTimeout(wsTimer);
    if (!stream || kind !== 'screen' || (ws && ws.readyState <= 1)) return;
    try { ws = new WebSocket('ws://127.0.0.1:47811'); } catch (x) { wsTimer = setTimeout(tryHelper, 3000); return; }
    ws.onopen = function () {
      $('ctlState').textContent = '도우미 연결됨 · 상대가 조작할 수 있습니다';
      var v = stream && stream.getVideoTracks()[0];
      if (v) { var st = v.getSettings(); ws.send(JSON.stringify({ t: 'surface', w: st.width, h: st.height })); }
      send({ t: 'ctl', on: true });
      say('ai', '원격지원 도우미가 연결되었습니다. 도우미 창을 닫으면 조작이 끝납니다.');
    };
    ws.onclose = function () {
      if ($('ctlState').textContent) { send({ t: 'ctl', on: false }); $('ctlState').textContent = ''; }
      ws = null; if (stream && kind === 'screen') wsTimer = setTimeout(tryHelper, 3000);
    };
    ws.onerror = function () {};
  }
  function closeHelper() { clearTimeout(wsTimer); if (ws) { try { ws.close(); } catch (x) {} ws = null; } }

  function onData(d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'chat') { say('ai', d.text); if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('원격 지원', { body: d.text }); return; }
    if (d.t === 'ptr') showDot(d.x, d.y);
    if ((d.t === 'ptr' || d.t === 'mouse' || d.t === 'key' || d.t === 'text') && ws && ws.readyState === 1) ws.send(JSON.stringify(d));
  }
  var dotTimer = null;
  function showDot(x, y) {
    var v = $('local'), dot = $('dot');
    if (!v.videoWidth) return;
    var r = v.getBoundingClientRect(), k = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    var w = v.videoWidth * k, h = v.videoHeight * k, ox = (r.width - w) / 2, oy = (r.height - h) / 2;
    dot.style.left = (ox + x * w) + 'px'; dot.style.top = (oy + y * h) + 'px'; dot.style.display = 'block';
    clearTimeout(dotTimer); dotTimer = setTimeout(function () { dot.style.display = 'none'; }, 2500);
  }

  function sendChat() {
    var t = msg.value.trim(); if (!t) return;
    send({ t: 'chat', text: t }); say('me', t); msg.value = '';
  }
  $('send').onclick = sendChat;
  msg.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) sendChat(); });
  window.addEventListener('beforeunload', function () { send({ t: 'bye' }); });
  connect();
})();
