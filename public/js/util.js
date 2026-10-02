// Pure helpers: formatting, money maths, storage.
import { state } from './state.js';

export const CATEGORIES = { food: '🍜', stay: '🏠', travel: '🚕', fun: '🎟️', groceries: '🛒', other: '✨' };
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD'];
export const SPLIT_LABELS = { equal: 'Equal', exact: 'Exact', percent: '%', shares: 'Shares' };
export const catColor = (c) => `var(--c-${c})`;
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const sum = (arr) => arr.reduce((a, b) => a + b, 0);
export const isoDay = (d) => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const localToday = () => isoDay(new Date());
export const niceDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Friendly heading for a day in the expense list. */
export function dayLabel(iso) {
  const days = Math.round((Date.parse(localToday()) - Date.parse(iso)) / 864e5);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: days < 7 && days > 0 ? 'long' : undefined, month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function fmt(cents, opts = {}) {
  const cur = state.g?.group.currency || 'USD';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, ...opts }).format(cents / 100);
}
export const money = (c) => fmt(c);
export const short = (c) => fmt(c, { notation: 'compact', maximumFractionDigits: 1 });

/** Largest-remainder split, mirrors src/balance.js so previews match what the server stores. */
export function allocate(total, weights) {
  const s = sum(weights);
  if (!(s > 0)) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / s);
  const out = raw.map(Math.floor);
  const left = total - sum(out);
  raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i], k) => { if (k < left) out[i]++; });
  return out;
}

/** localStorage wrapper: store(key) reads, store(key, value) writes. Never throws. */
export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage unavailable, fine */ }
  return null;
}

export const recent = {
  get: () => store('starsplit:recent') || [],
  add(code, name) { store('starsplit:recent', [{ code, name }, ...this.get().filter((r) => r.code !== code)].slice(0, 6)); },
  remove(code) { store('starsplit:recent', this.get().filter((r) => r.code !== code)); },
};

export const initial = (name) => esc(name.trim()[0]?.toUpperCase() || '?');
export const avatar = (m, cls = '') => `<span class="avatar ${cls}" style="--c:${m.color}">${initial(m.name)}</span>`;
