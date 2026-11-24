import KoreanLunarCalendar from '../vendor/korean-lunar-calendar.mjs';
import { pad2 } from './util.js';

const cal = new KoreanLunarCalendar();

// Lunar date -> solar 'YYYY-MM-DD', or null when that lunar date doesn't exist (e.g. a 30th in a short month).
export function lunarToSolar(y, m, d, leap = false) {
  if (!cal.setLunarDate(y, m, d, !!leap)) {
    if (d === 30 && cal.setLunarDate(y, m, 29, !!leap)) { const s = cal.getSolarCalendar(); return `${s.year}-${pad2(s.month)}-${pad2(s.day)}`; }
    return null;
  }
  const s = cal.getSolarCalendar();
  return `${s.year}-${pad2(s.month)}-${pad2(s.day)}`;
}

export function solarToLunar(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!cal.setSolarDate(y, m, d)) return null;
  const l = cal.getLunarCalendar();
  return { y: l.year, m: l.month, d: l.day, leap: !!l.intercalation };
}
