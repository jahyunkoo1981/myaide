// 화이트 / 다크 / 시스템 설정 따르기. The choice is kept in localStorage so index.html can apply it before
// the first paint (no white flash), and mirrored to prefs so it follows the person to their other devices.
const KEY = 'myaide.theme';
const mq = matchMedia('(prefers-color-scheme: dark)');
export const themeEvents = new EventTarget();
export function themeMode() { try { return localStorage.getItem(KEY) || 'light'; } catch { return 'light'; } }
export function isDark() { return document.documentElement.dataset.theme === 'dark'; }
export function applyTheme(mode = themeMode()) {
  try { localStorage.setItem(KEY, mode); } catch { }
  const dark = mode === 'dark' || (mode === 'system' && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = dark ? '#14161E' : '#F3F4F9';
  themeEvents.dispatchEvent(new Event('change'));
}
mq.addEventListener?.('change', () => { if (themeMode() === 'system') applyTheme('system'); });
