/* format.js — money, dates and the Indian conventions Kontour speaks in. */

const NF = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const NF0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** 188630 -> "1,88,630" (Indian grouping, paise only when they exist) */
export function num(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? NF0.format(v) : NF.format(v);
}

/** 188630 -> "₹1,88,630" */
export function inr(n) {
  return '₹' + num(n);
}

/** Compact for tight spots: 561388 -> "5.61 L", 24500180 -> "2.45 Cr" */
export function inrShort(n) {
  const v = Math.abs(Number(n) || 0);
  const sign = (Number(n) || 0) < 0 ? '-' : '';
  if (v >= 1e7) return sign + '₹' + (v / 1e7).toFixed(2).replace(/\.00$/, '') + ' Cr';
  if (v >= 1e5) return sign + '₹' + (v / 1e5).toFixed(2).replace(/\.00$/, '') + ' L';
  if (v >= 1e3) return sign + '₹' + NF0.format(Math.round(v));
  return sign + '₹' + num(v);
}

/** Splits currency symbol from digits so the symbol can be styled smaller. */
export function inrParts(n) {
  return { cur: '₹', val: num(Math.abs(Number(n) || 0)), neg: (Number(n) || 0) < 0 };
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** "₹1,88,630" or "1,88,630.50" back to 188630 — whatever a money
    input displays when it isn't focused, read back as a number. */
export function parseNum(str) {
  const cleaned = String(str == null ? '' : str).replace(/[^\d.]/g, '');
  return Number(cleaned) || 0;
}

/* ── Dates ─────────────────────────────────────────────────── */

export function todayISO() {
  const d = new Date();
  return isoOf(d);
}

export function isoOf(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "19/08/2026" */
export function dmy(iso) {
  const d = fromISO(iso);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "19 Aug" or "19 Aug 2025" when it is not the current year */
export function dayLabel(iso) {
  const d = fromISO(iso);
  const now = new Date();
  const base = `${d.getDate()} ${MON[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "Today" / "Yesterday" / "Tue, 19 Aug" */
export function dayHeading(iso) {
  const t = todayISO();
  if (iso === t) return 'Today';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === isoOf(y)) return 'Yesterday';
  const d = fromISO(iso);
  return `${DAY[d.getDay()]}, ${dayLabel(iso)}`;
}

/** "2026-08" */
export function monthKey(iso) {
  return String(iso).slice(0, 7);
}

export function thisMonthKey() {
  return monthKey(todayISO());
}

/** "2026-08" -> "August 2026" */
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const full = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  return `${full[(m || 1) - 1]} ${y}`;
}

/** "2026-08" -> "Aug 2026" */
export function monthShort(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MON[(m || 1) - 1]} ${y}`;
}

export function shiftMonth(key, by) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Indian financial year of a date: Apr 2026–Mar 2027 -> "FY 2026-27" */
/* The year a financial year starts in: April 2026 → 2026, and
   February 2026 → 2025, because the Indian FY runs April to March. */
export function fyStartYear(iso) {
  const d = fromISO(iso);
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

export function fyOf(iso) {
  const d = fromISO(iso);
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export function fyRange(iso) {
  const d = fromISO(iso);
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31`, label: fyOf(iso) };
}

/** "2 min ago" / "3 h ago" / date */
export function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return dayLabel(isoOf(new Date(ts)));
}
