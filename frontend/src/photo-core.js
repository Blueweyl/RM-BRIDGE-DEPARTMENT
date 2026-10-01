// Photo processing shared by the background worker (photo.worker.js) and the main-thread fallback (photo.js).
// One decode per photo: the camera file is decoded once, drawn once at upload size with the evidence
// stamp, and the small preview is drawn from that canvas (no second decode of the 12 MP original).

export const LIMITS = {
  maxInputBytes: 40 * 1024 * 1024,   // larger files are refused ("take it again with the camera")
  fullSide: 1600, fullQuality: 0.8,   // what goes to Google Drive (~150–450 KB for a normal site photo)
  softMaxBytes: 1.2 * 1024 * 1024,    // above this, re-encode smaller (1280 px, quality 0.65)
  smallSide: 1280, smallQuality: 0.65,
  hardMaxBytes: 5.5 * 1024 * 1024,    // the server refuses over 6 MB
  previewSide: 480, previewQuality: 0.6, // on-screen preview only, never uploaded
};

const fit = (w, h, side) => { const s = Math.min(1, side / Math.max(w, h)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]; };

function stamp(g, w, h, mark) {
  if (!mark || !mark.length) return;
  const fs = Math.max(11, Math.round(w / 42)), lh = Math.round(fs * 1.35), bh = lh * mark.length + fs;
  g.fillStyle = 'rgba(15,37,64,0.78)'; g.fillRect(0, h - bh, w, bh);
  g.fillStyle = '#FFFFFF'; g.font = `700 ${fs}px sans-serif`; g.textBaseline = 'top';
  mark.forEach((line, i) => g.fillText(String(line).slice(0, 90), Math.round(fs * 0.6), h - bh + Math.round(fs / 2) + i * lh, w - fs));
}

/**
 * bitmap: a decoded image (ImageBitmap or <img>) with width/height. makeCanvas(w, h) → canvas,
 * toBlob(canvas, quality) → Promise<Blob>. Returns { full, preview } as JPEG Blobs.
 */
export async function render(bitmap, mark, makeCanvas, toBlob) {
  const W = bitmap.width, H = bitmap.height;
  if (!W || !H) throw new Error('bad image');
  const [fw, fh] = fit(W, H, LIMITS.fullSide);
  const c = makeCanvas(fw, fh), g = c.getContext('2d');
  g.imageSmoothingQuality = 'medium';
  g.drawImage(bitmap, 0, 0, fw, fh);
  if (bitmap.close) bitmap.close();                 // free the big decoded original at once
  // Preview from the full canvas, before the stamp (the stamp is unreadable that small anyway).
  const [pw, ph] = fit(fw, fh, LIMITS.previewSide);
  const pc = makeCanvas(pw, ph);
  pc.getContext('2d').drawImage(c, 0, 0, pw, ph);
  stamp(g, fw, fh, mark);
  let full = await toBlob(c, LIMITS.fullQuality);
  if (full.size > LIMITS.softMaxBytes) {
    const [sw, sh] = fit(fw, fh, LIMITS.smallSide);
    const sc = makeCanvas(sw, sh);
    sc.getContext('2d').drawImage(c, 0, 0, sw, sh);
    full = await toBlob(sc, LIMITS.smallQuality);
  }
  const preview = await toBlob(pc, LIMITS.previewQuality);
  return { full, preview };
}
