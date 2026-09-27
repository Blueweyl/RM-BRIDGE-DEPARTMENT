// In-memory stand-ins for the Google services Code.gs uses (SpreadsheetApp, DriveApp,
// Utilities, CacheService, ...). Lets the real backend code run in Node for tests.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), path = require('path');

function fmtDate(d, tz, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(p => [p.type, p.value]));
  return pattern.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
}

function makeBackend(opts = {}) {
  const codePath = opts.code || path.join(__dirname, '..', 'Code.gs');
  const sheets = {}, files = {}, props = {}, cache = {};
  let seq = 0;
  const clock = { offsetDays: 0 };
  const cellStr = v => (v == null ? '' : String(v));
  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr: nr || 1, nc: nc || 1 }); }
    at(i, j) { const row = this.sh.data[this.r - 1 + i] || []; return row[this.c - 1 + j]; }
    grid(f) { const o = []; for (let i = 0; i < this.nr; i++) { const r = []; for (let j = 0; j < this.nc; j++) r.push(f(this.at(i, j))); o.push(r); } return o; }
    getDisplayValues() { return this.grid(v => { v = cellStr(v); if (v[0] === '=') return ''; if (v[0] === "'") return v.slice(1); return v; }); }
    getFormulas() { return this.grid(v => { v = cellStr(v); return v[0] === '=' ? v : ''; }); }
    put(i, j, v) { if (this.r + i > this.sh.maxRows) throw new Error('Range out of bounds'); while (this.sh.data.length < this.r + i) this.sh.data.push([]); this.sh.data[this.r - 1 + i][this.c - 1 + j] = v; }
    setValues(vs) { if (vs.length !== this.nr || vs[0].length !== this.nc) throw new Error('setValues size mismatch'); vs.forEach((row, i) => row.forEach((v, j) => this.put(i, j, v))); return this; }
    setNumberFormats() { return this; } setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
    getLastRow() { let n = this.data.length; while (n > 0 && !(this.data[n - 1] || []).some(v => cellStr(v) !== '')) n--; return n; }
    getMaxRows() { return this.maxRows; } insertRowsAfter(a, n) { this.maxRows += n; }
    setFrozenRows() {} setColumnWidth() {} setRowHeight() {}
    deleteRow(r) { this.data.splice(r - 1, 1); }
  }
  const ss = { getName: () => 'NLEX Daily Report DB', getId: () => 'SHEETID', getUrl: () => 'https://docs.google.com/spreadsheets/d/SHEETID/edit',
    getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), getSheets: () => Object.values(sheets), deleteSheet: s => { delete sheets[s.name]; } };
  const folders = {};
  const mkFolder = name => { const id = 'folder' + (++seq); const f = { id, name, subs: {}, getId: () => id,
    getFoldersByName: n => ({ hasNext: () => !!f.subs[n], next: () => f.subs[n] }), createFolder: n => (f.subs[n] = mkFolder(n)),
    createFile: blob => { const fid = 'file' + (++seq); const file = files[fid] = { id: fid, folder: f, blob, shared: false, getId: () => fid, setSharing() { file.shared = true; }, setDescription(d) { file.description = d; } }; return file; } };
    folders[id] = f; return f; };
  const roots = {};
  const env = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache[k] && cache[k].exp > Date.now() ? cache[k].v : null), put: (k, v, s) => { cache[k] = { v, exp: Date.now() + s * 1000 }; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, p) => fmtDate(new Date(d.getTime() + clock.offsetDays * 86400000), tz, p),
      base64Decode: s => [...Buffer.from(s, 'base64')], base64EncodeWebSafe: b => Buffer.from(typeof b === 'string' ? b : Uint8Array.from(b)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => [...Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')],
      computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', k).update(v).digest()],
      newBlob: (b, t, n) => ({ bytes: b, type: t, name: n, getDataAsString: () => Buffer.from(b).toString('utf8') }),
    },
    DriveApp: { Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 },
      getFolderById: id => { if (!folders[id]) throw new Error('not found'); return folders[id]; },
      getFoldersByName: n => ({ hasNext: () => !!roots[n], next: () => roots[n] }), createFolder: n => (roots[n] = mkFolder(n)) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST-DEPLOYMENT/exec' }) },
    Logger: { log() {} }, console, Date, JSON, Math, Object, String, Number, Array, Error, RegExp, Buffer,
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), env);
  const call = body => JSON.parse(env.doPost({ postData: { contents: JSON.stringify(body.action === 'login' && body.setupKey === undefined ? { ...body, setupKey: props.SETUP_KEY } : body) } }).s);
  return { env, sheets, files, props, cache, clock, call, roots };
}
module.exports = { makeBackend };
