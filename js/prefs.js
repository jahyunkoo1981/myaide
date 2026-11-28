// Settings shared by all devices (synced) and settings for this device only (localStorage).
import * as db from './db.js';

// Menu groups: 업무 (work), 개인 (personal), 시스템 (system). Settings and manual are always shown.
export const GROUPS = [
  { key: 'work', label: '업무' },
  { key: 'personal', label: '개인' },
  { key: 'system', label: '시스템' }
];
export const TABS = [
  { key: 'journal', label: '업무일지', icon: 'journal', group: 'work' },
  { key: 'notes', label: '업무메모', icon: 'flow', group: 'work' },
  { key: 'mindmap', label: 'AI 마인드맵', icon: 'mindmap', group: 'work' },
  { key: 'knowledge', label: '지식노트', icon: 'knowledge', group: 'work' },
  { key: 'meetings', label: '회의록', icon: 'meetings', group: 'work' },
  { key: 'search', label: 'MyPC Search', icon: 'files', group: 'work' },
  { key: 'remote', label: '원격지원', icon: 'remote', group: 'work' },
  { key: 'schedule', label: '일정관리', icon: 'schedule', group: 'personal' },
  { key: 'media', label: '사진보관함', icon: 'photos', group: 'personal' },
  { key: 'hoops', label: '농구', icon: 'hoops', group: 'personal' },
  { key: 'ledger', label: '가계부', icon: 'ledger', group: 'personal' },
  { key: 'aide', label: 'AIDE', icon: 'aide', group: 'personal' },
  { key: 'aimd', label: 'VisualCode', icon: 'code', group: 'personal' },
  { key: 'masker', label: '문서 가리기', icon: 'shield', group: 'personal' },
  { key: 'accounts', label: '계정정보', icon: 'accounts', group: 'personal' },
  { key: 'backup', label: '백업', icon: 'backup', group: 'system' },
  { key: 'widgets', label: '바탕화면 위젯', icon: 'widget', group: 'system' },
  { key: 'devtools', label: '개발도구', icon: 'devtools', group: 'system' }
];
export const FIXED = [
  { key: 'settings', label: '설정', icon: 'settings', group: 'system' },
  { key: 'manual', label: '사용 설명서', icon: 'manual', group: 'system' },
  { key: 'feedback', label: '의견 보내기', icon: 'feedback', group: 'system' }
];
// Bottom bar on phones.
export function groupOf(key) { const t = TABS.concat(FIXED).find(t => t.key === key); return t ? t.group : 'work'; }
export const MOBILE_FAVORITES = ['journal', 'schedule', 'ledger', 'media', 'notes'];

const DEFAULTS = {
  hiddenTabs: [],
  capture: { allScreens: false, fontSize: 32, color: '#E5484D' },
  aiSite: 'chatgpt',
  aiModel: 'gpt-4o-mini',
  aiProvider: 'openai',   // openai | anthropic | gemini
  aiModels: {},           // chosen model per provider
  transcribeModel: 'gpt-4o-mini-transcribe',
  aiAsk: 'always',        // always | over | never — AI에 보내기 전 사용료 확인
  aiAskOver: 10,          // 'over'일 때 기준 금액(원)
  aiBudget: 0,            // MY AIDE 월 한도(원), 0 = 없음
  usdKrw: 1350,
  aiPrices: {},
  aiMask: { on: true, words: [], contact: true, money: true, secret: true, names: false },   // AI 정보 보호
  aiGeminiPaid: false,
  phoneTabs: ['schedule', 'ledger', 'journal', 'aide', 'media', 'hoops', 'notes', 'meetings', 'mindmap'],   // 폰에서 쓸 메뉴(순서대로) — 설정 › 폰 메뉴
  aiBlockRecordsOnRisk: true,           // 모델별 단가 직접 입력 {model: [입력, 출력]} USD/1M
  autoBackupDays: 1,
  keepBackups: 30
};

let cache = null;
export const prefsEvents = new EventTarget();

export async function load() {
  const saved = await db.get('settings', 'prefs');
  cache = { ...DEFAULTS, ...(saved || {}), capture: { ...DEFAULTS.capture, ...((saved && saved.capture) || {}) } };
  if ((cache.hiddenTabs || []).includes('files')) cache.hiddenTabs = cache.hiddenTabs.filter(k => k !== 'files').concat('search');
  if ((cache.hiddenTabs || []).includes('milestones')) cache.hiddenTabs = cache.hiddenTabs.filter(k => k !== 'milestones').concat('mindmap');
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
