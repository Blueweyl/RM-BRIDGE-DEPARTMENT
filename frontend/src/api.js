// Talks to the Google Apps Script backend (google-apps-script/Code.gs) and keeps small values on the phone.
//
// The backend's address comes from the build (VITE_BACKEND_URL) or, once per phone, from the app link
// the office shares (Sheet menu → Daily Report → Show the app link):
//   https://<app address>/?backend=<Apps Script web app URL>
// There is no sign-in. Demo builds (`npm run dev`, `npm run build:demo`) without a backend use demo.js.
import { demoCall } from './demo.js';

/* global __DEMO__ */
const DEMO_BUILD = __DEMO__;
const P = 'bnlex.live.';
// Apps Script web app URL (personal accounts: /macros/s/…/exec; Google Workspace: /a/macros/<domain>/s/…/exec).
const URL_RE = /^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+\/|macros\/)s\/[\w-]+\/exec$/;

/** Keys found damaged since the app started (a copy is kept; the app shows a warning). */
export const quarantined = [];

/**
 * Saved data that cannot be read is never silently thrown away: a copy is kept under
 * "bnlex.quarantine" (last 5) for recovery. Returns false when even the copy could not be kept.
 */
export function quarantine(key, raw) {
  try {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('bnlex.quarantine') || '[]'); if (!Array.isArray(list)) list = []; } catch (e) { list = []; }
    list.push({ key, at: new Date().toISOString(), raw: String(raw).slice(0, 200000) });
    localStorage.setItem('bnlex.quarantine', JSON.stringify(list.slice(-5)));
    quarantined.push(key);
    return true;
  } catch (e) { quarantined.push(key); return false; }
}

/** A small JSON value saved on the phone (null when missing or damaged). */
export function loadLocal(k) {
  let v = null;
  try { v = localStorage.getItem(P + k); } catch (e) { return null; }
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { quarantine(P + k, v); try { localStorage.removeItem(P + k); } catch (x) {} return null; }
}
/** Save (or with null, remove) a small JSON value. Returns false when the phone's storage is full. */
export function saveLocal(k, v) {
  try { if (v == null) localStorage.removeItem(P + k); else localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; }
}
/** Every saved key starting with `prefix` (without the app prefix). */
export function localKeys(prefix) {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(P + prefix)) out.push(k.slice(P.length)); } } catch (e) {}
  return out;
}

/** Store a backend URL passed as ?backend=… (the app link), then remove it from the address bar. */
export function captureAppLink() {
  try {
    const q = new URLSearchParams(window.location.search);
    const b = q.get('backend');
    if (!b && !q.has('key')) return;
    if (b === 'off') saveLocal('url', null);
    else if (b && URL_RE.test(b)) saveLocal('url', b);
    q.delete('backend'); q.delete('key');           // `key` was the old one-time setup key: no longer used
    const rest = q.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? '?' + rest : '') + window.location.hash);
  } catch (e) {}
}

/**
 * The old version signed people in and kept a separate queue. Its sign-in data is removed; an unsent
 * queue is kept as a copy for the office (returns true so the app can say so once).
 */
export function cleanUpOldVersion() {
  ['session', 'deviceKey', 'key', 'enrollId', 'enrollErr', 'reqs', 'base', 'failedPhotos'].forEach(k => saveLocal(k, null));
  let oldQueue = false;
  try {
    const raw = localStorage.getItem(P + 'outbox');
    if (raw && raw !== '{}' && /"(att|act)\|/.test(raw)) { quarantine(P + 'outbox', raw); oldQueue = true; }
    if (raw && /"(att|act)\|/.test(raw)) localStorage.removeItem(P + 'outbox');
  } catch (e) {}
  return oldQueue;
}

export function backendUrl() {
  const u = loadLocal('url') || (import.meta.env && import.meta.env.VITE_BACKEND_URL) || '';
  return URL_RE.test(u) ? u : '';
}
/** True when the app can reach a backend (or is the demo build). */
export function isConnected() { return !!backendUrl() || DEMO_BUILD; }

/** Random ID for idempotent requests and photos (retries reuse the same ID). */
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return [...b].map((x, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + x.toString(16).padStart(2, '0')).join('');
}

/** A random label for this phone, kept on it. Not a password: it only shows in the audit log which phone sent what. */
export function deviceId() {
  let d = loadLocal('device');
  if (typeof d !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(d)) { d = 'ph-' + uuid().slice(0, 18); saveLocal('device', d); }
  return d;
}

export function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }

// ── Time ─────────────────────────────────────────────────────────────────
// Report dates and times are Manila time, whatever time zone the phone is set to, and corrected by
// the server clock (the phone clock can be wrong).
export const TZ = 'Asia/Manila';
let skew = Number(loadLocal('skew')) || 0;
export function setServerTime(ms) {
  if (typeof ms !== 'number' || !isFinite(ms)) return;
  const next = ms - Date.now();
  if (Math.abs(next - skew) > 2000) { skew = next; saveLocal('skew', skew); }
}
export function clockSkew() { return skew; }
export function nowMs() { return Date.now() + skew; }
function mnlParts(ms) {
  const o = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
  return o;
}
/** "2026-09-28" in Manila. */
export function manilaDay(ms = nowMs()) { const p = mnlParts(ms); return `${p.year}-${p.month}-${p.day}`; }
/** "2026-09-28 15:42" in Manila. */
export function manilaStamp(ms = nowMs()) { const p = mnlParts(ms); return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`; }
/** "3:42 PM" in Manila. */
export function manilaTime(ms = nowMs()) { return new Date(ms).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }); }
/** Format a calendar date ("2026-09-28") without letting the phone's time zone shift it. */
export function fmtDay(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}
export function shiftDay(iso, days) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); }
/** "2026-09-27 15:42:10" → "3:42 PM" */
export function timeOf(stamp) {
  const m = /(\d{2}):(\d{2})/.exec(String(stamp || '').slice(11));
  if (!m) return stamp ? String(stamp) : '';
  const h = Number(m[1]);
  return (h % 12 || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
}

export class ApiError extends Error {
  constructor(msg, extra) { super(msg); Object.assign(this, extra || {}); }
}

/**
 * POST one action. Throws ApiError; `.offline` means nothing was confirmed (no signal, timeout, odd reply),
 * so the caller keeps its data and tries again later. Other errors carry the server's plain-language message.
 */
export async function call(action, data = {}, { timeout = 45000 } = {}) {
  const body = { ...data, action, deviceId: deviceId() };
  if (DEMO_BUILD && !backendUrl()) return demoCall(body);
  if (!backendUrl()) throw new ApiError('This phone is not connected to the office yet. Open the app link from the office once.', { notConnected: true });
  if (!online()) throw new ApiError('No signal.', { offline: true, notSent: true });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    // text/plain keeps this a "simple" CORS request, which Apps Script web apps accept.
    res = await fetch(backendUrl(), { method: 'POST', redirect: 'follow', signal: ctl.signal, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  } catch (e) {
    throw new ApiError(e && e.name === 'AbortError' ? 'The office did not answer in time.' : 'Could not reach the office.', { offline: true });
  } finally { clearTimeout(timer); }
  let j;
  try { j = await res.json(); } catch (e) { throw new ApiError('Could not reach the office.', { offline: true }); }
  if (!j || typeof j !== 'object') throw new ApiError('Could not reach the office.', { offline: true });
  if (j.serverTime) setServerTime(j.serverTime);
  if (!j.ok) throw new ApiError(j.error || 'Something went wrong.', { offline: !!j.retry, missing: j.missing, alreadySubmitted: !!j.alreadySubmitted, rosterChanged: !!j.rosterChanged, answer: j });
  return j;
}
