// Background photo processing: decode, resize, stamp and JPEG-encode off the main thread,
// so the screen never freezes after the camera returns (low-end Android phones).
import { render } from './photo-core.js';

self.onmessage = async e => {
  const { id, file, mark } = e.data;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const out = await render(bmp, mark, (w, h) => new OffscreenCanvas(w, h), (c, q) => c.convertToBlob({ type: 'image/jpeg', quality: q }));
    self.postMessage({ id, ...out });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
