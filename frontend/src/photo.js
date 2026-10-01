// Photos: compressed on the phone, kept in IndexedDB until the server has them, then uploaded to Google Drive.
import * as api from './api.js';

const MAX_UPLOAD = 5.5 * 1024 * 1024;

/** Resized JPEG as a data URL. `mark` (lines of text) stamps an evidence band on the bottom of the photo. */
export function compress(file, max = 560, quality = 0.7, mark) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      try {
        const sc = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
        if (mark && mark.length) {
          const fs = Math.max(11, Math.round(c.width / 42)), lh = Math.round(fs * 1.35), h = lh * mark.length + fs;
          g.fillStyle = 'rgba(15,37,64,0.78)'; g.fillRect(0, c.height - h, c.width, h);
          g.fillStyle = '#FFFFFF'; g.font = `700 ${fs}px sans-serif`; g.textBaseline = 'top';
          mark.forEach((line, i) => g.fillText(String(line).slice(0, 90), Math.round(fs * 0.6), c.height - h + Math.round(fs / 2) + i * lh, c.width - fs));
        }
        resolve(c.toDataURL('image/jpeg', quality));
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(src); }
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('bad image')); };
    img.src = src;
  });
}

/**
 * A photo the leadman just took → { preview, full, capturedAt }. The full copy (1600 px, stamped with
 * BEFORE/AFTER, team, time and location) is what goes to Drive; the small one is for the screen.
 */
export async function prepare(file, { type, team, leadman, location }) {
  if (file.type && !/^image\//.test(file.type)) throw new Error('That file is not a photo.');
  if (file.size > 40 * 1024 * 1024) throw new Error('That photo is too large. Take it again with the camera.');
  // Capture time: the photo file's own time if recent, else now (phone clock corrected by the server's), in Manila time.
  const recent = file.lastModified && Math.abs(Date.now() - file.lastModified) < 7 * 86400000;
  const capturedAt = api.manilaStamp(recent ? file.lastModified + api.clockSkew() : api.nowMs());
  const mark = [`${type === 'before' ? 'BEFORE' : 'AFTER'} WORK · ${team} · NLEX`, `${capturedAt} (Manila) · ${leadman || ''}`, (location || '').trim() || 'Location not entered yet'];
  let preview, full;
  try {
    preview = await compress(file);
    full = await compress(file, 1600, 0.82, mark);
    if (full.length * 0.75 > MAX_UPLOAD) full = await compress(file, 1280, 0.6, mark);
  } catch (e) { throw new Error('Could not read that photo. Try again.'); }
  if (full.length * 0.75 > MAX_UPLOAD) throw new Error('That photo is too large. Take it again.');
  return { preview, full, capturedAt };
}
