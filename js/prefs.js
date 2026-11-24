// Settings shared by all devices (synced) and settings for this device only (localStorage).
import * as db from './db.js';

export const TABS = [
  { key: 'journal', label: '업무일지', icon: 'journal' },
  { key: 'notes', label: '업무메모', icon: 'notes' },
  { key: 'aimd', label: 'AIMD', icon: 'aimd' },
  { key: 'schedule', label: '일정관리', icon: 'schedule' },
  { key: 'knowledge', label: '지식노트', icon: 'knowledge' },
  { key: 'milestones', label: '마일스톤', icon: 'milestones' },
  { key: 'ledger', label: '가계부', icon: 'ledger' },
  { key: 'accounts', label: '계정정보', icon: 'accounts' },
  { key: 'meetings', label: '회의록', icon: 'meetings' },
  { key: 'aide', label: 'AIDE', icon: 'aide' },
  { key: 'files', label: '파일·캡처', icon: 'files' },
  { key: 'remote', label: '원격지원', icon: 'remote' },
  { key: 'backup', label: '백업', icon: 'backup' }
];

const DEFAULTS = {
  hiddenTabs: [],
  capture: { allScreens: false, fontSize: 32, color: '#E5484D' },
  aiSite: 'chatgpt',
  aiModel: 'gpt-4o-mini',
  transcribeModel: 'gpt-4o-mini-transcribe',
  autoBackupDays: 1,
  keepBackups: 30
};

let cache = null;
export const prefsEvents = new EventTarget();

export async function load() {
  const saved = await db.get('settings', 'prefs');
  cache = { ...DEFAULTS, ...(saved || {}), capture: { ...DEFAULTS.capture, ...((saved && saved.capture) || {}) } };
  return cache;
}
export function prefs() { return cache || DEFAULTS; }
export async function save(patch) {
  cache = { ...prefs(), ...patch };
  await db.put('settings', 'prefs', cache);
  prefsEvents.dispatchEvent(new Event('change'));
}
db.events.addEventListener('change', e => {
  if (e.detail.col === 'settings' && e.detail.id === 'prefs') load().then(() => prefsEvents.dispatchEvent(new Event('change')));
});

export const device = {
  get(k, d) { try { const v = localStorage.getItem('myaide.dev.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { localStorage.setItem('myaide.dev.' + k, JSON.stringify(v)); }
};

export const AI_SITES = [
  { key: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { key: 'claude', name: 'Claude', url: 'https://claude.ai/' },
  { key: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/' }
];
export function aiSite(key) { return AI_SITES.find(s => s.key === key) || AI_SITES[0]; }
