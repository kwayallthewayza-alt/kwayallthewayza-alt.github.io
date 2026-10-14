// Formatting helpers shared by the copy generator, renderer and validator.
// Every number or contact detail that appears in a creative goes through
// these functions so the poster, caption and record always agree.

export const CURRENCIES = {
  ZAR: { symbol: 'R', locale: 'en-ZA' },
  USD: { symbol: '$', locale: 'en-US' },
  EUR: { symbol: '€', locale: 'en-IE' },
  GBP: { symbol: '£', locale: 'en-GB' },
  NAD: { symbol: 'N$', locale: 'en-ZA' },
  BWP: { symbol: 'P', locale: 'en-ZA' },
  KES: { symbol: 'KSh', locale: 'en-KE' },
  NGN: { symbol: '₦', locale: 'en-NG' },
  AUD: { symbol: 'A$', locale: 'en-AU' },
};

/** Format an amount as e.g. "R385,000" (no decimals for whole amounts). */
export function formatMoney(amount, currency = 'ZAR') {
  if (amount === null || amount === undefined || amount === '' || Number.isNaN(Number(amount))) return '';
  const n = Number(amount);
  const { symbol } = CURRENCIES[currency] || { symbol: currency + ' ' };
  const whole = Number.isInteger(n);
  const body = n.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${body}`;
}

/** The price line exactly as it must appear on every asset. */
export function priceLine(price) {
  if (!price) return '';
  if (price.type === 'poa') return 'Price on application';
  const money = formatMoney(price.amount, price.currency);
  if (!money) return '';
  return price.type === 'from' ? `Starting from ${money}` : money;
}

/** Digits only, keeping a leading + for international numbers. */
export function normalisePhone(phone) {
  if (!phone) return '';
  const trimmed = String(phone).trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/\D/g, '');
}

export function isPlausiblePhone(phone) {
  const digits = normalisePhone(phone).replace('+', '');
  return digits.length >= 9 && digits.length <= 15;
}

export function isPlausibleEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
}

/** Extract money-looking strings from free text, e.g. "R385 000", "$1,299.99". */
export function findMoney(text) {
  if (!text) return [];
  const symbols = Object.values(CURRENCIES)
    .map((c) => c.symbol.replace(/[$]/g, '\\$'))
    .sort((a, b) => b.length - a.length)
    .join('|');
  const re = new RegExp(`(?:${symbols})\\s?\\d[\\d,\\s.]*\\d|(?:${symbols})\\s?\\d`, 'g');
  return (String(text).match(re) || []).map((m) => m.trim());
}

/** Parse "R385 000" / "R385,000.00" into 385000. */
export function parseMoney(str) {
  const cleaned = String(str).replace(/[^\d.,]/g, '').replace(/\s/g, '');
  // Treat a trailing ".dd" or ",dd" as decimals; everything else is grouping.
  const m = cleaned.match(/^(.*?)[.,](\d{2})$/);
  if (m) return Number(m[1].replace(/[.,]/g, '') + '.' + m[2]);
  return Number(cleaned.replace(/[.,]/g, ''));
}

/** Extract phone-looking strings (9+ digits, allowing spaces, dashes, brackets). */
export function findPhones(text) {
  if (!text) return [];
  const re = /\+?\(?\d[\d\s\-()]{7,}\d/g;
  return (String(text).match(re) || [])
    .map((m) => m.trim())
    .filter((m) => normalisePhone(m).replace('+', '').length >= 9);
}

export function daysBetween(a, b) {
  const ms = new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

export function todayISO(now = new Date()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** WCAG relative luminance contrast ratio between two hex colours. */
export function contrastRatio(hexA, hexB) {
  const lum = (hex) => {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const a = lum(hexA);
  const b = lum(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Pick black or white text for a background, whichever contrasts more. */
export function readableOn(bgHex) {
  return contrastRatio(bgHex, '#ffffff') >= contrastRatio(bgHex, '#111111') ? '#ffffff' : '#111111';
}

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

/** Small stable hash, used to fingerprint the product data an approval used. */
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
