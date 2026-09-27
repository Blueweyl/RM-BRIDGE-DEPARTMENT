// Photos waiting to upload live in IndexedDB (not localStorage): a phone can hold many
// full-size photos there, and a write that fails (storage full) is reported, never ignored.
const DB = 'bnlex', STORE = 'photos';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser cannot store photos offline.')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Phone storage is not available.'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
    let out;
    const r = fn(st);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onabort = t.onerror = () => reject(t.error || new Error('Phone storage error'));
  }));
}

export const put = (key, value) => tx('readwrite', st => st.put(value, key));
export const get = key => tx('readonly', st => st.get(key));
export const del = key => tx('readwrite', st => st.delete(key));
export const keys = () => tx('readonly', st => st.getAllKeys());

/** True when the error means the phone is out of space. */
export function isQuota(e) { return !!e && (e.name === 'QuotaExceededError' || /quota|space|full/i.test(String(e.message || ''))); }
