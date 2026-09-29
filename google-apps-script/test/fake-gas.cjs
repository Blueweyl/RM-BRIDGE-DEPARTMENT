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
  const sheets = {}, files = {}, props = {}, cache = {}, exports_ = {};
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
    setValue(v) { this.put(0, 0, v); return this; } merge() { return this; } setFontSize() { return this; } setHorizontalAlignment() { return this; }
    setVerticalAlignment() { return this; } setWrap() { return this; } clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) if (this.at(i, j) !== undefined) this.put(i, j, ''); return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
    getLastRow() { let n = this.data.length; while (n > 0 && !(this.data[n - 1] || []).some(v => cellStr(v) !== '')) n--; return n; }
    getMaxRows() { return this.maxRows; } insertRowsAfter(a, n) { this.maxRows += n; }
    setFrozenRows() {} setColumnWidth() {} setRowHeight() {} hideColumns() {}
    deleteRow(r) { this.data.splice(r - 1, 1); }
    getLastColumn() { return Math.max(0, ...this.data.slice(0, this.getLastRow()).map(r => { let n = r.length; while (n > 0 && cellStr(r[n - 1]) === '') n--; return n; })); }
    clearContents() { this.data = []; return this; }
    setName(n) { delete sheets[this.name]; this.name = n; sheets[n] = this; return this; }
    protect() { return { setDescription() { return this; }, setWarningOnly() { return this; } }; }
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
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss,
      create: name => { const id = 'xsheet' + (++seq); const sh = new Sheet('Sheet1'); const x = exports_[id] = { id, name, sheet: sh, getId: () => id, getSheets: () => [sh] }; return x; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache[k] && cache[k].exp > Date.now() ? cache[k].v : null), put: (k, v, s) => { cache[k] = { v, exp: Date.now() + s * 1000 }; }, remove: k => { delete cache[k]; } }) },
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
      getFoldersByName: n => ({ hasNext: () => !!roots[n], next: () => roots[n] }), createFolder: n => (roots[n] = mkFolder(n)),
      getFileById: id => ({ moveTo: f => { if (exports_[id]) exports_[id].folder = f; } }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST-DEPLOYMENT/exec' }) },
    Logger: { log() {} }, console, Date, JSON, Math, Object, String, Number, Array, Error, RegExp, Buffer,
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), env);
  const raw = body => JSON.parse(env.doPost({ postData: { contents: JSON.stringify(body) } }).s);
  // Test helper: a login without a deviceKey enrols `body.device` once with the real setup key.
  const devices = {};
  const deviceKey = name => devices[name] || (devices[name] = raw({ action: 'enroll', setupKey: props.SETUP_KEY, deviceLabel: name }).deviceKey);
  // Test helper: a token is sent with the device key of the phone that signed in (as the app does),
  // and writes that need one get a fresh request ID unless the test sets its own.
  const tokenDevice = {};
  const IDEM = ['saveAttendance', 'submitReport', 'reopenReport'];
  const call = body => {
    if (body.action === 'login' && body.deviceKey === undefined) body = { ...body, deviceKey: deviceKey(body.device || 'test') };
    else if (body.token && body.deviceKey === undefined && tokenDevice[body.token]) body = { ...body, deviceKey: tokenDevice[body.token] };
    if (IDEM.includes(body.action) && body.requestId === undefined) body = { ...body, requestId: crypto.randomUUID() };
    const out = raw(body);
    if (body.action === 'login' && out.ok) tokenDevice[out.token] = body.deviceKey;
    return out;
  };
  return { env, sheets, files, props, cache, clock, call, raw, deviceKey, roots, exports: exports_ };
}
module.exports = { makeBackend };
