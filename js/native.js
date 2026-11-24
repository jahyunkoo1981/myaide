// Bridge to the Windows app (WebView2). In a normal browser `native.available` is false and every
// Windows-only feature shows a short explanation instead.

const pending = new Map();
let seq = 0;
const listeners = new Map();
const webview = window.chrome && window.chrome.webview;

if (webview) {
  webview.addEventListener('message', e => {
    let msg = e.data;
    if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch { return; } }
    if (msg && msg.reply != null && pending.has(msg.reply)) {
      const { resolve, reject } = pending.get(msg.reply);
      pending.delete(msg.reply);
      if (msg.ok) resolve(msg.result); else reject(new Error(msg.error || '작업을 완료하지 못했습니다.'));
    } else if (msg && msg.event) {
      (listeners.get(msg.event) || []).forEach(fn => fn(msg.data));
    }
  });
}

export const native = {
  available: !!webview,
  call(method, args = {}) {
    if (!webview) return Promise.reject(new Error('Windows 앱에서만 쓸 수 있는 기능입니다.'));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      webview.postMessage(JSON.stringify({ id, method, args }));
    });
  },
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(fn);
  }
};
