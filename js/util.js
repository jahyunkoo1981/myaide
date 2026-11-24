// Small DOM and formatting helpers shared by every view.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function uid() {
  const t = Date.now().toString(36);
  const r = crypto.getRandomValues(new Uint8Array(6));
  return t + [...r].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export const pad2 = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const today = () => ymd(new Date());
export function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export const won = n => (Math.round(n) || 0).toLocaleString('ko-KR') + '원';
export function fmtTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
export function plain(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(text, kind) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast' + (kind === 'err' ? ' err' : '') }, text);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 5000 : 2600);
}

// Dialog helper: returns a promise that resolves with the value passed to close().
export function dialog({ title, body, actions = [], wide = false, onOpen }) {
  return new Promise(resolve => {
    const dlg = h('dialog', { class: wide ? 'wide' : '' });
    const close = v => { dlg.close(); dlg.remove(); resolve(v); };
    const foot = h('div', { class: 'dlg-foot' }, actions.map(a => h('button', {
      class: 'btn ' + (a.kind || ''), type: 'button',
      onclick: async () => { if (a.run) { const r = await a.run(close); if (r === false) return; } if (!a.keepOpen) close(a.value); }
    }, a.label)));
    dlg.append(h('div', { class: 'dlg' },
      title ? h('div', { class: 'dlg-head' }, title) : null,
      h('div', { class: 'dlg-body' }, body),
      actions.length ? foot : null));
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(undefined); });
    document.body.append(dlg);
    dlg.showModal();
    if (onOpen) onOpen(dlg, close);
  });
}

export async function confirmBox(text, okLabel = '확인', danger = false) {
  return await dialog({
    title: text, body: [],
    actions: [{ label: '취소', value: false }, { label: okLabel, kind: danger ? 'danger' : 'primary', value: true }]
  }) === true;
}

export async function promptBox(title, value = '', { type = 'text', hint, placeholder } = {}) {
  const input = h('input', { type, value, placeholder: placeholder || '' });
  const r = await dialog({
    title, body: [input, hint ? h('p', { class: 'hint' }, hint) : null],
    actions: [{ label: '취소', value: null }, { label: '확인', kind: 'primary', run: () => input.value }],
    onOpen: () => { input.focus(); input.select(); input.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest('dialog').querySelector('.btn.primary').click(); }); }
  });
  return r === undefined || r === null ? null : input.value;
}

export async function copyText(text, label = '복사했습니다') {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { toast('복사하지 못했습니다. 길게 눌러 직접 복사해 주세요.', 'err'); }
}

export function download(name, blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function blobToDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}

// Downscale large pasted images so documents stay small enough to sync quickly on phones.
export async function shrinkImage(blob, max = 1600, quality = 0.86) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const png = blob.type === 'image/png' && c.width * c.height < 900000;
    return c.toDataURL(png ? 'image/png' : 'image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}

export const icons = {
  journal: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
  notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/>',
  aimd: '<path d="M4 6h16v10H9l-5 4z"/><path d="M8 10h8M8 13h5"/>',
  knowledge: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="10" cy="18" r="2.5"/><path d="M8 7.5l7.6 1M7 8.3l2.2 7.4M16.4 10l-4.6 6.2"/>',
  schedule: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  milestones: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  ledger: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/>',
  accounts: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  meetings: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  aide: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
  files: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  capture: '<path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3"/><circle cx="12" cy="12" r="3"/>',
  remote: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  backup: '<path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M12 12v6M9.5 14.5L12 12l2.5 2.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  manual: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M9 8h6"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'
};
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = icons[name] || '';
  return s;
}
