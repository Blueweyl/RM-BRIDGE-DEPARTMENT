// Photos: processed once (in a background worker when the phone supports it), kept on the phone as
// JPEG Blobs in IndexedDB until the server has them, then uploaded to Google Drive.
// Limits are in photo-core.js (LIMITS).
import * as api from './api.js';
import { render, LIMITS } from './photo-core.js';

export { LIMITS };

let worker = null, seq = 0;
const waiting = new Map();
function getWorker() {
  if (worker !== null) return worker;
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('no worker');
    worker = new Worker(new URL('./photo.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); w(e.data); } };
    worker.onerror = () => { worker = false; waiting.forEach(w => w({ error: 'worker failed' })); waiting.clear(); };
  } catch (e) { worker = false; }
  return worker;
}
function inWorker(file, mark) {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('no worker'));
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('worker timeout')); }, 60000);
    waiting.set(id, r => { clearTimeout(timer); if (r.error) reject(new Error(r.error)); else resolve(r); });
    w.postMessage({ id, file, mark });
  });
}

/** Main-thread fallback (older phones): still one decode, async encode. */
async function onMainThread(file, mark) {
  let bmp;
  if (typeof createImageBitmap !== 'undefined') {
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bmp = null; }
  }
  let url = null;
  if (!bmp) {
    url = URL.createObjectURL(file);
    bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image')); i.src = url; });
  }
  try {
    return await render(bmp, mark,
      (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
      (c, q) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', q)));
  } finally { if (url) URL.revokeObjectURL(url); }
}

/**
 * A photo the leadman just took → { full: Blob, preview: Blob, capturedAt }. The full copy (max 1600 px,
 * stamped with BEFORE/AFTER, team, time and location) is what goes to Drive; the preview is for the screen.
 */
export async function prepare(file, { type, team, leadman, location }) {
  if (file.type && !/^image\//.test(file.type)) throw new Error('That file is not a photo.');
  if (file.size > LIMITS.maxInputBytes) throw new Error('That photo is too large. Take it again with the camera.');
  // Capture time: the photo file's own time if recent, else now (phone clock corrected by the server's), in Manila time.
  const recent = file.lastModified && Math.abs(Date.now() - file.lastModified) < 7 * 86400000;
  const capturedAt = api.manilaStamp(recent ? file.lastModified + api.clockSkew() : api.nowMs());
  const mark = [`${type === 'before' ? 'BEFORE' : 'AFTER'} WORK · ${team} · NLEX`, `${capturedAt} (Manila) · ${leadman || ''}`, (location || '').trim() || 'Location not entered yet'];
  let out;
  try { out = await inWorker(file, mark); } catch (e) {
    try { out = await onMainThread(file, mark); } catch (x) { throw new Error('Could not read that photo. Try again.'); }
  }
  if (out.full.size > LIMITS.hardMaxBytes) throw new Error('That photo is too large. Take it again.');
  return { full: out.full, preview: out.preview, capturedAt };
}

/** Blob (or an older saved data URL) → data URL, only at upload time. */
export function asDataUrl(v) {
  if (typeof v === 'string') return Promise.resolve(v);
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error || new Error('read failed')); r.readAsDataURL(v); });
}
/** A preview to show: an object URL for a Blob, or an older saved data URL as is. */
export function previewUrl(v) { return v && typeof v !== 'string' ? URL.createObjectURL(v) : v || ''; }
