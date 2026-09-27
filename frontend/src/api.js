// Client for the Google Apps Script backend (google-apps-script/Code.gs).
//
// "Live" mode is on when a backend URL is configured, either at build time
// (VITE_BACKEND_URL in frontend/.env) or once per phone with a setup link:
//   https://<app address>/?backend=<Apps Script web app URL>&key=<setup key>
// The setup key (from the backend's showSetupLink()) is never built into the app.
// Without a backend URL the app runs as the offline demo (browser storage only).

const P = 'bnlex.live.';
const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

function get(k) { try { const v = localStorage.getItem(P + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function put(k, v) { try { if (v == null) localStorage.removeItem(P + k); else localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) {} }

/** Store a backend URL passed as ?backend=… (setup link), then remove it from the address bar. */
export function captureSetupLink() {
  try {
    const q = new URLSearchParams(window.location.search);
    const b = q.get('backend'), k = q.get('key');
    if (b === 'off') { put('url', null); put('session', null); put('key', null); }
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

export function deviceId() {
  let id = get('device');
  if (!id) { id = 'device-' + Math.random().toString(36).slice(2, 10); put('device', id); }
  return id;
}

export function session() {
  const s = get('session');
  return s && s.token && s.expiresAt > Date.now() ? s : null;
}
export function clearSession() { put('session', null); }

export function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }

export class ApiError extends Error {
  constructor(msg, extra) { super(msg); Object.assign(this, extra || {}); }
}

/** POST one action. Throws ApiError with .offline, .auth, .wrongPin or .missing set when relevant. */
export async function call(action, data = {}, { timeout = 45000 } = {}) {
  if (!online()) throw new ApiError('No signal. Nothing was sent.', { offline: true });
  const s = session();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    // text/plain keeps this a "simple" CORS request, which Apps Script web apps accept.
    res = await fetch(backendUrl(), {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...data, action, token: s ? s.token : undefined, device: deviceId() }),
    });
  } catch (e) {
    throw new ApiError(e && e.name === 'AbortError' ? 'Google did not answer in time. Nothing was confirmed — try again.' : 'Cannot reach the server. Check your signal and try again.', { offline: true });
  } finally { clearTimeout(timer); }
  let j;
  try { j = await res.json(); } catch (e) { throw new ApiError('Unexpected reply from the server (' + res.status + ').'); }
  if (!j.ok) {
    if (j.auth) clearSession();
    throw new ApiError(j.error || 'Request failed', { auth: !!j.auth, wrongPin: !!j.wrongPin, notSetUp: !!j.notSetUp, missing: j.missing });
  }
  return j;
}

export async function login(pin) {
  const j = await call('login', { pin, setupKey: get('key') || '' });
  put('session', { token: j.token, user: j.user, expiresAt: j.expiresAt });
  return j.user;
}

/** "2026-09-27 15:42:10" → "3:42 PM" */
export function timeOf(stamp) {
  const m = /(\d{2}):(\d{2})/.exec(String(stamp || '').slice(11));
  if (!m) return stamp ? String(stamp) : null;
  const h = Number(m[1]);
  return (h % 12 || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
}
