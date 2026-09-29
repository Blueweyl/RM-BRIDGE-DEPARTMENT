// Client for the Google Apps Script backend (google-apps-script/Code.gs).
//
// "Live" mode is on when a backend URL is configured, either at build time
// (VITE_BACKEND_URL in frontend/.env) or once per phone with a setup link:
//   https://<app address>/?backend=<Apps Script web app URL>&key=<single-use setup link token>
// The link (from the backend's showSetupLink(), one per phone) is never built into the app. It is
// exchanged once for a signed per-phone device key and then deleted from the phone.
// Without a backend URL the app runs as the offline demo (browser storage only).

const P = 'bnlex.live.';
const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

function get(k) {
  let v = null;
  try { v = localStorage.getItem(P + k); } catch (e) { return null; }
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { quarantine(P + k, v); return null; }
}

/**
 * Saved data that cannot be read is never silently thrown away or turned into an empty record:
 * a copy is kept under "bnlex.quarantine" (last 5) for recovery, and the app loads the server copy.
 * Returns false when even the copy could not be kept (phone storage full).
 */
export function quarantine(key, raw) {
  try {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('bnlex.quarantine') || '[]'); if (!Array.isArray(list)) list = []; } catch (e) { list = []; }
    list.push({ key, at: new Date().toISOString(), raw: String(raw).slice(0, 200000) });
    localStorage.setItem('bnlex.quarantine', JSON.stringify(list.slice(-5)));
    quarantined.push(key);
    return true;
  } catch (e) { quarantined.push(key + ' (copy NOT kept: storage full)'); return false; }
}
/** Keys found damaged since the app started (for the warning shown to the user). */
export const quarantined = [];
function put(k, v) { try { if (v == null) localStorage.removeItem(P + k); else localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) {} }

/** Store a backend URL passed as ?backend=… (setup link), then remove it from the address bar. */
export function captureSetupLink() {
  try {
    const q = new URLSearchParams(window.location.search);
    const b = q.get('backend'), k = q.get('key');
    if (b === 'off') { put('url', null); put('session', null); put('key', null); put('deviceKey', null); }
    else if (b && URL_RE.test(b)) { put('url', b); if (k) put('key', k); }
    else if (k && /^[a-z0-9]{8,64}$/i.test(k)) { put('key', k); }
    else return;
    q.delete('backend'); q.delete('key');
    const rest = q.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? '?' + rest : '') + window.location.hash);
  } catch (e) {}
}

export function backendUrl() {
  const u = get('url') || (import.meta.env && import.meta.env.VITE_BACKEND_URL) || '';
  return URL_RE.test(u) ? u : '';
}
export function isLive() { return !!backendUrl(); }

/** Random ID for idempotent requests and photos (retries reuse the same ID). */
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return [...b].map((x, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + x.toString(16).padStart(2, '0')).join('');
}

/**
 * A phone opened with a setup link swaps it for its own device key, then forgets the link. Links work once:
 * the phone's random enrolment ID lets it retry after a lost reply and still get its key.
 */
export async function enrollIfNeeded() {
  const k = get('key');
  if (!k || get('deviceKey') || !isLive()) return;
  let eid = get('enrollId');
  if (!eid || eid.k !== k) { eid = { k, id: uuid() }; put('enrollId', eid); }
  let j;
  try { j = await call('enroll', { setupKey: k, enrollId: eid.id, deviceLabel: (navigator.userAgent || '').slice(0, 60) }); }
  // A bad/used/expired link is not retried on every start; its reason is kept to show at sign-in.
  catch (e) { if (e.notSetUp) { put('key', null); put('enrollId', null); put('enrollErr', e.message); } throw e; }
  put('deviceKey', j.deviceKey);
  put('key', null); put('enrollId', null); put('enrollErr', null);
}
export function hasDevice() { return !!(get('deviceKey') || get('key')); }

/** The saved sign-in, or null. A damaged or edited copy is treated as signed out (the server decides anyway). */
export function session() {
  const s = get('session');
  const valid = s && typeof s === 'object' && typeof s.token === 'string' && typeof s.expiresAt === 'number' && s.user && typeof s.user === 'object' && typeof s.user.role === 'string';
  return valid && s.expiresAt > nowMs() ? s : null;   // server-corrected clock: a wrong phone clock neither ends nor extends it
}
export function clearSession() { put('session', null); }
export function setSessionUser(user) { const s = session(); if (s) put('session', { ...s, user }); }

export function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }

// ── Time ─────────────────────────────────────────────────────────────────
// Operational dates and times are always Manila time, whatever time zone the phone is set to, and
// corrected by the server clock (the phone clock can be wrong). Audit times are stamped by the server.
export const TZ = 'Asia/Manila';
let skew = Number(get('skew')) || 0;
/** Remember how far the phone clock is from the server clock (sent with every load and sign-in). */
export function setServerTime(ms) {
  if (typeof ms !== 'number' || !isFinite(ms)) return;
  const next = ms - Date.now();
  if (Math.abs(next - skew) > 2000) { skew = next; put('skew', skew); }
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
export function fmtDay(iso, opts) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}

export class ApiError extends Error {
  constructor(msg, extra) { super(msg); Object.assign(this, extra || {}); }
}

/**
 * POST one action. Throws ApiError with .offline, .auth, .wrongPin, .conflict or .missing set when relevant.
 * navigator.onLine is only a hint: a phone can report "online" with no route to Google, so every
 * failure to get a proper JSON answer is treated as "not confirmed" and the caller keeps its data.
 */
export async function call(action, data = {}, { timeout = 45000 } = {}) {
  if (!online()) throw new ApiError('No signal. Nothing was sent.', { offline: true, notSent: true });
  const s = session();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    // text/plain keeps this a "simple" CORS request, which Apps Script web apps accept.
    res = await fetch(backendUrl(), {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      // The token only works together with this phone's device key (sessions are device-bound).
      body: JSON.stringify({ ...data, action, token: s ? s.token : undefined, deviceKey: data.deviceKey || (s ? get('deviceKey') || undefined : undefined) }),
    });
  } catch (e) {
    throw new ApiError(e && e.name === 'AbortError' ? 'Google did not answer in time. Nothing was confirmed — try again.' : 'Cannot reach the server. Check your signal and try again.', { offline: true });
  } finally { clearTimeout(timer); }
  let j;
  try { j = await res.json(); } catch (e) { throw new ApiError('Unexpected reply from the server (' + res.status + '). Nothing was confirmed — try again.', { offline: true }); }
  if (!j || typeof j !== 'object') throw new ApiError('Unexpected reply from the server. Nothing was confirmed — try again.', { offline: true });
  if (j.serverTime) setServerTime(j.serverTime);
  if (!j.ok) {
    if (j.auth) clearSession();
    if (j.notSetUp) put('deviceKey', null);
    throw new ApiError(j.error || 'Request failed', { auth: !!j.auth, wrongPin: !!j.wrongPin, notSetUp: !!j.notSetUp, missing: j.missing, conflict: !!j.conflict, denied: !!j.denied, retry: !!j.retry, needReason: !!j.needReason });
  }
  return j;
}

export async function login(pin) {
  await enrollIfNeeded();
  if (!get('deviceKey')) throw new ApiError(get('enrollErr') ? 'The setup link did not work: ' + get('enrollErr') : 'This phone is not set up yet. Open the setup link from your admin.', { notSetUp: true });
  const j = await call('login', { pin, deviceKey: get('deviceKey') });
  if (!saveLocal('session', { token: j.token, user: j.user, expiresAt: j.expiresAt })) throw new ApiError('Phone storage is full — cannot stay signed in. Free up space and try again.');
  return j.user;
}

/** "2026-09-27 15:42:10" → "3:42 PM" */
export function timeOf(stamp) {
  const m = /(\d{2}):(\d{2})/.exec(String(stamp || '').slice(11));
  if (!m) return stamp ? String(stamp) : null;
  const h = Number(m[1]);
  return (h % 12 || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
}

/** Sign out here and on the server (best effort: the local session is cleared either way). */
export async function logout() {
  const s = session();
  clearSession();
  if (s && online()) { try { await fetch(backendUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'logout', token: s.token, deviceKey: get('deviceKey') }) }); } catch (e) {} }
}

/** Small JSON values in localStorage (drafts, outbox). Returns false when the phone's storage is full. */
export function saveLocal(k, v) {
  try { if (v == null) localStorage.removeItem(P + k); else localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; }
}
export function loadLocal(k) { return get(k); }
