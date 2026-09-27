/**
 * Bridge NLEX Daily Report — backend (Google Sheets + Google Drive + Apps Script).
 *
 * The Google Sheet this script is attached to is the database. Tabs:
 *   Users         who can sign in: admin + one leadman per team, PIN (stored hashed), role, team
 *   Teams         team list (name, short name, default unit, active)
 *   Roster        crew per team, Active or Archived, with a stable personId
 *   Attendance    one row per person per team per day (status is always chosen explicitly)
 *   DailyReports  one row per team per day, with a server-made reportId, version and revision
 *   Photos        every photo uploaded to Drive, including replaced/removed ones
 *   Revisions     snapshot of a report each time it is submitted, reopened or its attendance changes
 *   AuditLog      append-only, hash-chained: who did what, when, before/after, reason
 *   Sessions      one row per sign-in; revoked on logout, PIN change or signOutEveryone()
 * Photos live in Drive: "Bridge NLEX Daily Report Photos/<yyyy-mm-dd>/<team>/".
 *
 * The web app (frontend/) calls doPost() with JSON. The server never trusts the client for
 * who the user is, which team they belong to, totals, state, versions or IDs: every action runs
 *   token → session → user → role → authorised team → allowed action
 * See docs/BACKEND.md for the full design.
 */

var TZ = 'Asia/Manila';
var PHOTO_ROOT = 'Bridge NLEX Daily Report Photos';
// Leave both empty when the script is opened from the Sheet (Extensions → Apps Script).
// Fill them in for a stand-alone script project: the Sheet's ID and the photo folder's ID.
var SHEET_ID = '';
var PHOTO_FOLDER_ID = '';

function db_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}
var SESSION_HOURS = { leadman: 14 * 24, admin: 12 };   // leadmen work offline for days; admin sessions are short
var SETUP_KEY_DAYS = 7;                                 // a setup link can enrol new phones for this long
var MAX_PHOTO_BYTES = 6 * 1024 * 1024;
var LOGIN_LIMITS = { perDevice: 5, global: 20, minutes: 15 };
var ATT_STATUSES = ['Present', 'Absent', 'Leave', 'Rest Day', 'Sick', 'Other'];
var LATE_CUTOFF = '20:00';                              // submitted after this (or on a later day) = late
var MAX_MANPOWER = 60, MAX_QTY = { KM: 100, Locations: 100 };

// [field key, column header]. Field keys are what the app sends and receives.
var TABLES = {
  Users: [
    ['userId', 'User ID'], ['name', 'Name'], ['role', 'Role (admin/leadman)'], ['teamId', 'Team ID'],
    ['pin', 'PIN (type 4 digits to change; hidden after next sign-in)'], ['active', 'Active (Yes/No)'], ['createdAt', 'Created'], ['updatedAt', 'Updated'],
  ],
  Teams: [
    ['teamId', 'Team ID'], ['name', 'Team'], ['short', 'Short Name'], ['defaultUnit', 'Default Unit'], ['active', 'Active (Yes/No)'],
  ],
  Roster: [
    ['personId', 'Person ID'], ['teamId', 'Team ID'], ['name', 'Name'], ['role', 'Role'], ['status', 'Status'],
    ['createdAt', 'Created'], ['updatedAt', 'Updated'], ['archivedAt', 'Archived'], ['editedBy', 'Edited By'],
  ],
  Attendance: [
    ['key', 'Key'], ['reportId', 'Report ID'], ['reportDate', 'Date'], ['teamId', 'Team ID'], ['personId', 'Person ID'], ['name', 'Name'], ['role', 'Role'],
    ['status', 'Status'], ['note', 'Note / Reason'], ['submittedAt', 'Submitted'], ['submittedBy', 'Submitted By'],
    ['createdAt', 'Created'], ['updatedAt', 'Updated'], ['rev', 'Revision'],
  ],
  DailyReports: [
    ['key', 'Key'], ['reportDate', 'Date'], ['teamId', 'Team ID'], ['team', 'Team'], ['leadman', 'Leadman'], ['state', 'State'],
    ['fromTime', 'From'], ['toTime', 'To'], ['location', 'Location'], ['activityDetails', 'Activity Details'], ['status', 'Status'],
    ['target', 'Target'], ['actual', 'Actual'], ['unit', 'Unit'], ['targetManpower', 'Target Manpower'], ['actualManpower', 'Actual Manpower'],
    ['plateNumber', 'Equipment / Plate'], ['remarks', 'Remarks'], ['crewPresent', 'Crew Present'], ['absentList', 'Not Present (status)'],
    ['beforePreview', 'Before Photo'], ['afterPreview', 'After Photo'], ['beforePhotoId', 'Before Photo ID'], ['afterPhotoId', 'After Photo ID'],
    ['attendanceSubmittedAt', 'Attendance Submitted'], ['submittedAt', 'Report Submitted'], ['submittedBy', 'Submitted By'],
    ['createdAt', 'Created'], ['updatedAt', 'Updated'], ['editedBy', 'Edited By'], ['version', 'Version'],
    ['reportId', 'Report ID'], ['rev', 'Revision'], ['firstSubmittedAt', 'First Submitted'], ['late', 'Late'],
    ['reopenReason', 'Last Reopen Reason'], ['lastRequestId', 'Last Request ID'],
  ],
  Photos: [
    ['photoId', 'Photo ID'], ['teamId', 'Team ID'], ['reportDate', 'Date'], ['type', 'Type'], ['status', 'Status'],
    ['fileId', 'Drive File ID'], ['fileUrl', 'File URL'], ['thumbnailUrl', 'Thumbnail URL'], ['originalFilename', 'Original Filename'],
    ['uploadedAt', 'Uploaded'], ['uploadedBy', 'Uploaded By'],
    ['reportId', 'Report ID'], ['clientId', 'Client Photo ID'], ['leadman', 'Leadman'], ['location', 'Location (at capture)'],
    ['capturedAt', 'Captured (phone clock)'], ['bytes', 'Bytes'],
  ],
  Revisions: [
    ['revisionId', 'Revision ID'], ['reportId', 'Report ID'], ['teamId', 'Team ID'], ['reportDate', 'Date'], ['rev', 'Revision'], ['version', 'Version'],
    ['kind', 'Kind'], ['at', 'Time'], ['by', 'By'], ['reason', 'Reason'], ['snapshot', 'Snapshot (JSON)'],
  ],
  AuditLog: [
    ['auditId', 'Audit ID'], ['at', 'Time'], ['user', 'User'], ['role', 'Role'], ['teamId', 'Team ID'], ['action', 'Action'],
    ['entity', 'Entity'], ['entityId', 'Entity ID'], ['before', 'Before'], ['after', 'After'], ['reason', 'Reason / Detail'],
    ['requestId', 'Request ID'], ['device', 'Device'], ['hash', 'Chain Hash'],
  ],
  Sessions: [
    ['sessionId', 'Session ID'], ['userId', 'User ID'], ['role', 'Role'], ['teamId', 'Team ID'], ['device', 'Device'],
    ['createdAt', 'Created'], ['expiresAt', 'Expires'], ['revokedAt', 'Revoked'], ['revokedReason', 'Revoked Reason'],
  ],
};
var KEY_FIELD = { Users: 'userId', Teams: 'teamId', Roster: 'personId', Attendance: 'key', DailyReports: 'key', Photos: 'photoId', Revisions: 'revisionId', Sessions: 'sessionId' };
var FORMULA_FIELDS = { beforePreview: true, afterPreview: true };
// Old header → new header, used when setup() upgrades an existing Sheet.
var HEADER_ALIASES = { 'Note / Reason': ['Absence Reason'], 'Not Present (status)': ['Absent (reason)'] };
var PROTECTED_TABS = ['Users', 'AuditLog', 'Revisions', 'Sessions'];

// Real crews from the prototype. setup() copies them into the Sheet once.
var SEED = [
  ['team1', 'Bridge RM_Team 1', 'RM Team 1', 'Pijay Tanjeco', '1111', 'Locations',
    [['Justin Billones', 'Skilled'], ['Ignacio Alcoriza Jr.', 'Crew'], ['Alvin Angelo', 'Crew'], ['Joven Blanza', 'Crew'], ['Rocky Miranda', 'Crew'], ['Richard Candelaria', 'Crew'], ['Crisostomo Sebuc', 'Crew']]],
  ['team2', 'Segment 10 Scupper Drain', 'Segment 10', 'Glenn Butiong', '2222', 'KM',
    [['Glen Jorick De Mesa', 'Skilled'], ['Justine Gregg Baylon', 'Skilled'], ['John Christian Bernardo', 'Crew'], ['Ian Enriquez', 'Crew'], ['Joanner Royce Quilao', 'Crew'], ['Rolando Faustino', 'Crew'], ['Richard Santiago', 'Crew'], ['Abraham Balmeo', 'Crew']]],
  ['team3', 'Bridge Epoxy 1', 'Epoxy 1', 'Allan Miranda', '3333', 'Locations',
    [['Elmer Dordulo', 'Skilled'], ['Edwin Lozano', 'Skilled'], ['R-Jay John Aquino', 'Crew'], ['Mark Joseph De Guzman', 'Crew'], ['Edbryan Dela Cruz', 'Crew'], ['Mark Ian Dungca', 'Crew'], ['Johnry Manese', 'Crew'], ['Eroll Pangilinan', 'Crew']]],
  ['team4', 'Bridge Epoxy 2', 'Epoxy 2', 'Gilbert Rivera', '4444', 'Locations',
    [['Alvin Galang', 'Skilled'], ['Ivan Cabunag', 'Crew'], ['AJ Enriquez', 'Crew'], ['Jaypee Occidental', 'Crew'], ['Edgar Ortillo', 'Crew'], ['Voltaire Rotamula', 'Crew'], ['Joshua Andrei Tayco', 'Crew']]],
];

// ════════════════════════════════════════════════════════════════════════════
// Setup (run once from the editor; safe to run again after updating the code)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Creates the tabs (upgrading an older Sheet in place), fills in teams and crew when empty,
 * and gives the admin and each leadman a new random PIN. The PINs are printed in the log ONCE;
 * the Users tab only keeps a hash. `options.demoPins` (tests only) keeps the demo PINs 0000–4444.
 */
function setup(options) {
  var demoPins = !!(options && options.demoPins === true);
  CACHE = {};
  var ss = db_(), props = PropertiesService.getScriptProperties();
  ['TOKEN_SECRET', 'PIN_SECRET', 'DEVICE_SECRET', 'AUDIT_SECRET'].forEach(function (k) {
    if (!props.getProperty(k)) props.setProperty(k, Utilities.getUuid() + Utilities.getUuid());
  });
  var legacy = migrate_();
  Object.keys(TABLES).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = TABLES[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(function (c) { return c[1]; })])
      .setFontWeight('bold').setBackground('#0F2540').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    formatRows_(sh, name, 2, sh.getMaxRows() - 1);
  });
  CACHE = {};
  var now = now_(), pins = {};
  if (readAll_('Teams').length === 0) {
    SEED.forEach(function (t) { upsert_('Teams', t[0], { teamId: t[0], name: t[1], short: t[2], defaultUnit: t[5], active: 'Yes' }); });
  }
  if (readAll_('Users').length === 0) {
    if (legacy.length) {
      legacy.forEach(function (u) { upsert_('Users', u.userId, u, { createdAt: now, updatedAt: now }); });
    } else {
      var fresh = demoPins ? ['0000'].concat(SEED.map(function (t) { return t[4]; })) : randomPins_(SEED.length + 1);
      upsert_('Users', 'admin', { userId: 'admin', name: 'Operations Admin', role: 'admin', teamId: '', pin: fresh[0], active: 'Yes', createdAt: now, updatedAt: now });
      pins.admin = fresh[0];
      SEED.forEach(function (t, i) {
        var id = 'lead-' + t[0];
        upsert_('Users', id, { userId: id, name: t[3], role: 'leadman', teamId: t[0], pin: fresh[i + 1], active: 'Yes', createdAt: now, updatedAt: now });
        pins[id] = fresh[i + 1];
      });
    }
  }
  readAll_('Users').forEach(function (u) {
    if (/^\d{4}$/.test(u.pin)) Logger.log('PIN ' + u.pin + ' — ' + u.name + (u.teamId ? ' (' + u.teamId + ')' : ' (admin)'));
  });
  normalizePins_();
  if (readAll_('Roster').length === 0) {
    SEED.forEach(function (t) {
      [[t[3], 'Leadman']].concat(t[6]).forEach(function (m) {
        var id = newPersonId_(t[0], m[0]);
        upsert_('Roster', id, { personId: id, teamId: t[0], name: m[0], role: m[1], status: 'Active', createdAt: now, updatedAt: now, editedBy: 'setup' });
      });
    });
  }
  // Older rows get a server-made report ID.
  readAll_('DailyReports').forEach(function (r) {
    if (!r.reportId) upsert_('DailyReports', r.key, { reportId: newReportId_(r.teamId, r.reportDate), rev: r.rev || r.version || '0' });
  });
  var rep = ss.getSheetByName('DailyReports');
  rep.setColumnWidth(col_('DailyReports', 'beforePreview'), 110);
  rep.setColumnWidth(col_('DailyReports', 'afterPreview'), 110);
  PROTECTED_TABS.forEach(function (n) {
    try { var p = ss.getSheetByName(n).protect(); p.setDescription('Written by the app only. Do not edit by hand.'); p.setWarningOnly(true); } catch (e) {}
  });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  if (!props.getProperty('SETUP_KEY')) newSetupKey_();
  // Upgrading: phones already holding the old setup link get a week to switch to a device key.
  else if (!props.getProperty('SETUP_KEY_EXPIRES')) props.setProperty('SETUP_KEY_EXPIRES', String(Date.now() + SETUP_KEY_DAYS * 86400000));
  photoRoot_();
  audit_({ name: 'setup', role: 'system' }, '', 'setup', 'system', '', null, null, 'setup() run');
  Logger.log('Setup complete. Write the PINs above down now — the Users tab only keeps a hash.');
  Logger.log('Next: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone), then run showSetupLink.');
  return { pins: pins };
}

/** Print the setup link to send to phones. Run from the editor after deploying; paste your app address below. */
function showSetupLink() {
  var APP_ADDRESS = 'https://YOUR-APP-ADDRESS/';            // where frontend/dist is hosted
  var props = PropertiesService.getScriptProperties();
  if (Number(props.getProperty('SETUP_KEY_EXPIRES') || 0) < Date.now()) newSetupKey_();
  var url = ScriptApp.getService().getUrl();
  Logger.log(APP_ADDRESS + '?backend=' + encodeURIComponent(url) + '&key=' + props.getProperty('SETUP_KEY'));
  Logger.log('This link can connect new phones until ' + Utilities.formatDate(new Date(Number(props.getProperty('SETUP_KEY_EXPIRES'))), TZ, 'yyyy-MM-dd HH:mm') + ' (Manila).');
}

/** New setup key: old setup links stop working. Phones already connected keep working. */
function newSetupKey() { newSetupKey_(); showSetupLink(); }

function newSetupKey_() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SETUP_KEY', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8));
  props.setProperty('SETUP_KEY_EXPIRES', String(Date.now() + SETUP_KEY_DAYS * 86400000));
}

/** n different 4-digit PINs, avoiding obvious ones like 0000, 1111 or 1234. */
function randomPins_(n) {
  var out = [], weak = /^(\d)\1{3}$|^(0123|1234|2345|3456|4567|5678|6789|9876|4321)$/;
  while (out.length < n) {
    var p = ('000' + Math.floor(Math.random() * 10000)).slice(-4);
    if (!weak.test(p) && out.indexOf(p) < 0) out.push(p);
  }
  return out;
}

/** Sign everyone out (e.g. a phone was lost). Run from the editor. */
function signOutEveryone() {
  PropertiesService.getScriptProperties().setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
}

/** Disconnect every phone: each one needs a new setup link before anyone can sign in on it. */
function forgetAllPhones() {
  PropertiesService.getScriptProperties().setProperty('DEVICE_SECRET', Utilities.getUuid() + Utilities.getUuid());
  signOutEveryone();
}

/** Lift a sign-in lockout early (after too many wrong PINs). */
function clearLoginLock() { PropertiesService.getScriptProperties().deleteProperty('LOGIN_LOCKED_UNTIL'); }

/** Check the audit log has not been edited by hand. Logs the first broken row, if any. */
function verifyAuditLog() {
  CACHE = {};
  var rows = readAll_('AuditLog'), prev = '';
  for (var i = 0; i < rows.length; i++) {
    if (auditHash_(prev, rows[i]) !== rows[i].hash) {
      Logger.log('Audit log changed by hand at row ' + (i + 2) + ' (' + rows[i].auditId + ')');
      return { ok: false, row: i + 2 };
    }
    prev = rows[i].hash;
  }
  Logger.log('Audit log intact: ' + rows.length + ' entries.');
  return { ok: true, rows: rows.length };
}

// ════════════════════════════════════════════════════════════════════════════
// HTTP entry points
// ════════════════════════════════════════════════════════════════════════════

function doGet() {
  return out_({ ok: true, app: 'Bridge NLEX Daily Report API', time: now_() });
}

var REQ = { requestId: '', device: '' };
var LOCKED = false;

function doPost(e) {
  CACHE = {}; LOCKED = false; REQ = { requestId: '', device: '' };
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Bad request' }); }
  if (!req || typeof req !== 'object') return out_({ ok: false, error: 'Bad request' });
  var fn = ACTIONS[req.action];
  if (!fn) return out_({ ok: false, error: 'Unknown action' });
  var lock = null;
  try {
    if (fn.writes) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) return out_({ ok: false, error: 'Server busy — please try again.', retry: true });
      LOCKED = true;
    }
    REQ.requestId = /^[A-Za-z0-9-]{8,64}$/.test(String(req.requestId || '')) ? String(req.requestId) : '';
    var sess = fn.public ? null : verify_(req.token);
    if (sess) REQ.device = sess.device;
    if (fn.admin && !isAdmin_(sess)) deny_(sess, req.action, 'admin-only action');
    return out_(fn.run(sess, req));
  } catch (err) {
    var msg = String(err && err.message || err);
    var o = { ok: false, error: msg.replace(/^(AUTH|CONFLICT|DENIED): /, '') };
    if (msg.indexOf('AUTH: ') === 0) o.auth = true;
    if (msg.indexOf('CONFLICT: ') === 0) o.conflict = true;
    if (msg.indexOf('DENIED: ') === 0) o.denied = true;
    return out_(o);
  } finally {
    if (lock) { LOCKED = false; lock.releaseLock(); }
  }
}

var ACTIONS = {
  enroll:         { run: enroll_, public: true, writes: true },
  login:          { run: login_, public: true, writes: true },
  logout:         { run: logout_, writes: true },
  me:             { run: function (s) { return { ok: true, user: s.user }; } },
  load:           { run: load_ },
  saveAttendance: { run: saveAttendance_, writes: true },
  uploadPhoto:    { run: uploadPhoto_, writes: true },
  removePhoto:    { run: removePhoto_, writes: true },
  submitReport:   { run: submitReport_, writes: true },
  reopenReport:   { run: reopenReport_, writes: true },
  addMember:      { run: addMember_, writes: true, admin: true },
  archiveMember:  { run: archiveMember_, writes: true, admin: true },
  restoreMember:  { run: restoreMember_, writes: true, admin: true },
  exportCsv:      { run: exportCsv_, writes: true, admin: true },
  adminReports:   { run: adminReports_, admin: true },
  revisions:      { run: revisions_, admin: true },
  auditLog:       { run: auditLog_, admin: true },
};

// ════════════════════════════════════════════════════════════════════════════
// Auth: device enrolment → PIN sign-in → server-side session
// ════════════════════════════════════════════════════════════════════════════

/** Setup link key → a signed per-phone device key. The setup key itself is not kept on the phone. */
function enroll_(_, req) {
  // Wrong setup keys are limited on their own counter: they cannot lock PIN sign-in for everyone
  // (the key is 160 random bits, so guessing it is not a practical attack).
  var cache = CacheService.getScriptCache(), bad = Number(cache.get('fail:enroll') || 0);
  if (bad >= 50) throw new Error('Too many attempts. Wait ' + LOGIN_LIMITS.minutes + ' minutes, then try again.');
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('SETUP_KEY'), exp = Number(props.getProperty('SETUP_KEY_EXPIRES') || 0);
  if (!key || String(req.setupKey || '') !== key) {
    cache.put('fail:enroll', String(bad + 1), LOGIN_LIMITS.minutes * 60);
    return { ok: false, error: 'This setup link is not valid. Ask the admin for a new one.', notSetUp: true };
  }
  if (exp < Date.now()) return { ok: false, error: 'This setup link has expired. Ask the admin for a new one.', notSetUp: true };
  var device = 'dev-' + Utilities.getUuid().slice(0, 13);
  var label = String(req.deviceLabel || '').replace(/[^\w .,()\/-]/g, '').slice(0, 60);
  audit_({ name: 'new phone', role: 'device' }, '', 'device enrolled', 'device', device, null, null, label);
  return { ok: true, deviceKey: signed_({ d: device, iat: Date.now() }, 'DEVICE_SECRET') };
}

function login_(_, req) {
  var dk = unsign_(req.deviceKey, 'DEVICE_SECRET');
  if (!dk || !dk.d) return { ok: false, error: 'This phone is not set up yet. Open the setup link from your admin.', notSetUp: true };
  loginGate_(dk.d);
  var pin = String(req.pin || '');
  normalizePins_();
  var matches = /^\d{4}$/.test(pin) ? readAll_('Users').filter(function (u) { return u.active !== 'No' && u.pin === pinHash_(u.userId, pin); }) : [];
  if (matches.length > 1) return { ok: false, error: 'This PIN is shared by two accounts. Ask the admin to change one of them.' };
  var u = matches[0];
  if (u && u.role === 'leadman') { var t = row_('Teams', u.teamId); if (!t || t.active === 'No') u = null; }
  if (!u) {
    loginFail_(dk.d);
    return { ok: false, error: 'Wrong PIN. Please try again.', wrongPin: true };
  }
  CacheService.getScriptCache().remove('fail:d:' + dk.d);
  var user = userFor_(u), now = now_();
  var exp = Date.now() + (SESSION_HOURS[u.role] || 12) * 3600000;
  var sid = 'ses-' + Utilities.getUuid();
  // Drop sessions that ended more than a week ago so the tab stays small.
  var old = Date.now() - 7 * 86400000;
  readAll_('Sessions').forEach(function (x) { if (Number(x.expiresAt) < old) deleteRow_('Sessions', x.sessionId); });
  upsert_('Sessions', sid, { sessionId: sid, userId: u.userId, role: u.role, teamId: u.teamId || '', device: dk.d, createdAt: now, expiresAt: String(exp) });
  REQ.device = dk.d;
  audit_(user, user.teamId, 'login', 'session', sid, null, null, 'Signed in');
  return { ok: true, token: signed_({ s: sid, u: u.userId, exp: exp, pv: pinTag_(u.pin) }, 'TOKEN_SECRET'), user: user, expiresAt: exp };
}

function logout_(s) {
  upsert_('Sessions', s.sid, { revokedAt: now_(), revokedReason: 'logout' });
  audit_(s.user, s.user.teamId, 'logout', 'session', s.sid, null, null, '');
  return { ok: true };
}

function userFor_(u) {
  if (u.role === 'admin') return { userId: u.userId, role: 'admin', teamId: '', name: u.name || 'Operations Admin', team: 'All teams · NLEX' };
  var t = row_('Teams', u.teamId) || {};
  return { userId: u.userId, role: 'leadman', teamId: u.teamId, name: u.name, team: t.name || u.teamId, short: t.short || '' };
}

function verify_(token) {
  var p = unsign_(token, 'TOKEN_SECRET');
  if (!p || !p.s || !p.u) throw new Error('AUTH: Please sign in again.');
  if (!p.exp || p.exp < Date.now()) throw new Error('AUTH: Session expired. Please sign in again.');
  var ses = row_('Sessions', p.s);
  if (!ses || ses.userId !== p.u || ses.revokedAt || Number(ses.expiresAt) < Date.now()) throw new Error('AUTH: Please sign in again.');
  var u = row_('Users', p.u);
  // Changing a PIN in the Users tab (or setting Active = No) signs that person out everywhere.
  if (!u || u.active === 'No' || pinTag_(u.pin) !== p.pv || (u.role !== 'admin' && u.role !== 'leadman')) throw new Error('AUTH: Please sign in again.');
  if (u.role === 'leadman') { var t = row_('Teams', u.teamId); if (!t || t.active === 'No') throw new Error('AUTH: Please sign in again.'); }
  return { user: userFor_(u), sid: p.s, device: ses.device };
}

function signed_(obj, secretName) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, '');
  return body + '.' + hmac_(body, secretName);
}

function unsign_(tok, secretName) {
  var parts = String(tok || '').split('.');
  if (parts.length !== 2 || !parts[0] || hmac_(parts[0], secretName) !== parts[1]) return null;
  try {
    var b = parts[0]; while (b.length % 4) b += '=';
    var o = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b)).getDataAsString());
    return o && typeof o === 'object' ? o : null;
  } catch (e) { return null; }
}

function hmac_(s, secretName) {
  var secret = PropertiesService.getScriptProperties().getProperty(secretName);
  if (!secret) throw new Error('Backend not set up — run setup() in the Apps Script editor.');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, secret)).replace(/=+$/, '');
}

function pinHash_(userId, pin) { return 'h:' + hmac_(userId + '|' + pin, 'PIN_SECRET').slice(0, 32); }
function pinTag_(storedPin) { return hmac_('pv:' + storedPin, 'TOKEN_SECRET').slice(0, 10); }

/** A 4-digit PIN typed into the Users tab is replaced by its hash. */
function normalizePins_() {
  readAll_('Users').forEach(function (u) {
    if (/^\d{4}$/.test(u.pin)) upsert_('Users', u.userId, { pin: pinHash_(u.userId, u.pin), updatedAt: now_() });
  });
}

/** Refuse sign-in while this phone, or sign-in as a whole, is locked out after wrong PINs. */
function loginGate_(device) {
  var until = Number(PropertiesService.getScriptProperties().getProperty('LOGIN_LOCKED_UNTIL') || 0);
  var cache = CacheService.getScriptCache();
  if (until > Date.now() || (device && Number(cache.get('fail:d:' + device) || 0) >= LOGIN_LIMITS.perDevice)) {
    throw new Error('Too many wrong PINs. Wait ' + LOGIN_LIMITS.minutes + ' minutes, then try again.');
  }
}

/** Wrong PIN from an enrolled phone: counts toward that phone's lock and the all-phones lock. */
function loginFail_(device) {
  var cache = CacheService.getScriptCache(), ttl = LOGIN_LIMITS.minutes * 60;
  cache.put('fail:d:' + device, String(Number(cache.get('fail:d:' + device) || 0) + 1), ttl);
  var all = Number(cache.get('fail:all') || 0) + 1;
  cache.put('fail:all', String(all), ttl);
  if (all >= LOGIN_LIMITS.global) {
    PropertiesService.getScriptProperties().setProperty('LOGIN_LOCKED_UNTIL', String(Date.now() + ttl * 1000));
    cache.put('fail:all', '0', ttl);
    audit_({ name: 'system', role: 'system' }, '', 'sign-in locked', 'system', '', null, null, all + ' wrong PINs in ' + LOGIN_LIMITS.minutes + ' min');
  }
}

function isAdmin_(s) { return !!(s && s.user.role === 'admin'); }

/** Record a refused request, then stop. */
function deny_(s, action, why) {
  audit_(s ? s.user : { name: 'unknown', role: '' }, s ? s.user.teamId : '', 'DENIED ' + action, 'request', '', null, null, why);
  throw new Error('DENIED: ' + (why === 'admin-only action' ? 'Admin only.' : why));
}

/** The team this request may touch. A leadman is always their own team, whatever the app sends. */
function teamFor_(s, requested) {
  var teamId = String(requested || '');
  if (!isAdmin_(s)) {
    if (teamId && teamId !== s.user.teamId) deny_(s, 'team access', 'You can only access your own team.');
    teamId = s.user.teamId;
  }
  var t = row_('Teams', teamId);
  if (!t || t.active === 'No') throw new Error('Unknown team');
  return teamId;
}

/** Leadmen may write today and yesterday (Manila time); older days are locked. Admin may write any past day. */
function writableDate_(s, date) {
  if (!validDate_(date)) throw new Error('Missing or bad date');
  if (date > today_()) throw new Error('Cannot report a future date.');
  if (!isAdmin_(s) && date < yesterday_()) throw new Error('This report is locked. Ask the admin to reopen it.');
  return date;
}

function validDate_(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) return false;
  return shiftDate_(d, 0) === d && d >= '2020-01-01';
}

/** Optimistic concurrency: the app sends the revision it last saw. */
function needRev_(rep, baseRev) {
  var cur = rep ? String(rep.rev || '0') : '0';
  if (String(baseRev == null ? '' : baseRev) !== cur) {
    throw new Error('CONFLICT: This report was changed on another device. Your entries are kept on this phone — check them and submit again.');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Read
// ════════════════════════════════════════════════════════════════════════════

/** Everything a screen needs. Admin gets all teams; a leadman only gets their own team. */
function load_(s, req) {
  var days = Math.max(1, Math.min(Number(req.days) || 30, isAdmin_(s) ? 120 : 31));
  var since = shiftDate_(today_(), -days);
  var mine = function (r) { return isAdmin_(s) || r.teamId === s.user.teamId; };
  var leadOf = leadmen_();
  var teams = readAll_('Teams').filter(function (t) { return t.active !== 'No' && mine(t); })
    .map(function (t) { return { teamId: t.teamId, name: t.name, short: t.short, leadman: leadOf[t.teamId] || '', defaultUnit: t.defaultUnit || 'KM' }; });
  var photos = readAll_('Photos').filter(function (p) { return p.status === 'Active' && p.reportDate >= since && mine(p); });
  var reports = readAll_('DailyReports').filter(function (r) { return r.reportDate >= since && mine(r); }).map(function (r) {
    delete r.beforePreview; delete r.afterPreview; delete r.lastRequestId;
    r.lockedForLeadman = r.reportDate < yesterday_();
    return r;
  });
  return {
    ok: true, user: s.user, today: today_(),
    teams: teams,
    roster: readAll_('Roster').filter(mine),
    attendance: readAll_('Attendance').filter(function (a) { return a.reportDate >= since && mine(a); }),
    reports: reports,
    photos: photos,
    sheetUrl: isAdmin_(s) ? db_().getUrl() : '',
  };
}

function leadmen_() {
  var o = {};
  readAll_('Users').forEach(function (u) { if (u.role === 'leadman' && u.active !== 'No') o[u.teamId] = u.name; });
  return o;
}

// ════════════════════════════════════════════════════════════════════════════
// Reports: shared helpers
// ════════════════════════════════════════════════════════════════════════════

function newReportId_(teamId, date) {
  return 'R' + String(date).replace(/-/g, '') + '-' + teamId + '-' + Utilities.getUuid().slice(0, 6);
}

/** The team/day report row, created as an empty draft with a new report ID if missing. */
function ensureReport_(teamId, date, by) {
  var key = teamId + '|' + date, rep = row_('DailyReports', key);
  if (rep) return rep;
  var team = row_('Teams', teamId), now = now_();
  upsert_('DailyReports', key, {
    key: key, reportDate: date, teamId: teamId, team: team.name, leadman: leadmen_()[teamId] || '', state: 'draft',
    unit: team.defaultUnit || 'KM', version: '0', rev: '0', reportId: newReportId_(teamId, date), createdAt: now, updatedAt: now, editedBy: by,
  });
  return row_('DailyReports', key);
}

function attendanceFor_(teamId, date) {
  var ids = {};
  readAll_('Roster').forEach(function (m) { if (m.teamId === teamId && m.status === 'Active') ids[m.personId] = true; });
  return readAll_('Attendance').filter(function (a) { return a.teamId === teamId && a.reportDate === date && ids[a.personId]; });
}

function activePhoto_(teamId, date, type) {
  return readAll_('Photos').filter(function (p) { return p.teamId === teamId && p.reportDate === date && p.type === type && p.status === 'Active'; })[0] || null;
}

function snapshot_(rep) {
  var o = {};
  TABLES.DailyReports.forEach(function (c) { if (!FORMULA_FIELDS[c[0]] && c[0] !== 'lastRequestId') o[c[0]] = rep[c[0]]; });
  o.attendance = attendanceFor_(rep.teamId, rep.reportDate).map(function (a) { return { personId: a.personId, name: a.name, status: a.status, note: a.note }; });
  return o;
}

function revision_(s, rep, kind, reason) {
  var id = 'rv-' + Utilities.getUuid().slice(0, 13);
  upsert_('Revisions', id, { revisionId: id, reportId: rep.reportId, teamId: rep.teamId, reportDate: rep.reportDate, rev: rep.rev, version: rep.version,
    kind: kind, at: now_(), by: s.user.name, reason: String(reason || '').slice(0, 500), snapshot: JSON.stringify(snapshot_(rep)).slice(0, 45000) });
}

// ════════════════════════════════════════════════════════════════════════════
// Attendance
// ════════════════════════════════════════════════════════════════════════════

function saveAttendance_(s, req) {
  var teamId = teamFor_(s, req.teamId), date = writableDate_(s, req.reportDate);
  var key = teamId + '|' + date, rep = row_('DailyReports', key);
  if (rep && REQ.requestId && rep.lastRequestId === REQ.requestId) {
    return { ok: true, replay: true, attendanceSubmittedAt: rep.attendanceSubmittedAt, crewPresent: rep.crewPresent, rev: rep.rev, reportId: rep.reportId };
  }
  if (rep && rep.state === 'submitted' && !isAdmin_(s)) throw new Error('Report already submitted. Tap Edit report first to change attendance.');
  needRev_(rep, req.baseRev);

  var active = readAll_('Roster').filter(function (m) { return m.teamId === teamId && m.status === 'Active'; });
  var byId = {}; active.forEach(function (m) { byId[m.personId] = m; });
  var sent = {};
  if (!Array.isArray(req.people)) throw new Error('Missing attendance list');
  req.people.forEach(function (p) {
    if (!p || !byId[p.personId]) throw new Error('Unknown crew member in attendance — refresh and try again.');
    sent[p.personId] = p;
  });
  var unverified = [], needNote = [], rows = [];
  active.forEach(function (m) {
    var p = sent[m.personId], status = p ? String(p.status || '') : '', note = p ? String(p.note || '').trim().slice(0, 200) : '';
    if (ATT_STATUSES.indexOf(status) < 0) { unverified.push(m.name); return; }
    if (status === 'Other' && !note) needNote.push(m.name);
    rows.push({ m: m, status: status, note: status === 'Present' ? '' : note });
  });
  if (unverified.length) return { ok: false, error: 'Mark every crew member first. Not verified: ' + unverified.join(', '), missing: ['Not verified: ' + unverified.join(', ')] };
  if (needNote.length) return { ok: false, error: 'Write a note for "Other": ' + needNote.join(', '), missing: ['Note needed: ' + needNote.join(', ')] };

  rep = ensureReport_(teamId, date, s.user.name);
  var now = now_(), by = s.user.name, changes = [], beforeRows = {};
  readAll_('Attendance').forEach(function (a) { if (a.teamId === teamId && a.reportDate === date) beforeRows[a.personId] = a; });
  var hadAttendance = !!rep.attendanceSubmittedAt;
  if (hadAttendance) revision_(s, rep, 'attendance before update', '');
  var rev = String(Number(rep.rev || 0) + 1);
  rows.forEach(function (r) {
    var k = key + '|' + r.m.personId, old = beforeRows[r.m.personId];
    if (old && (old.status !== r.status || old.note !== r.note)) changes.push(r.m.name + ': ' + old.status + (old.note ? ' (' + old.note + ')' : '') + ' → ' + r.status + (r.note ? ' (' + r.note + ')' : ''));
    upsert_('Attendance', k, {
      key: k, reportId: rep.reportId, reportDate: date, teamId: teamId, personId: r.m.personId, name: r.m.name, role: r.m.role,
      status: r.status, note: r.note, submittedAt: now, submittedBy: by, updatedAt: now, rev: rev,
    }, { createdAt: now });
  });
  var present = rows.filter(function (r) { return r.status === 'Present'; }).length;
  var absentList = rows.filter(function (r) { return r.status !== 'Present'; }).map(function (r) { return r.m.name + ' (' + r.status + (r.note ? ': ' + r.note : '') + ')'; }).join('; ');
  upsert_('DailyReports', key, {
    leadman: leadmen_()[teamId] || rep.leadman, crewPresent: present + '/' + rows.length, absentList: absentList,
    attendanceSubmittedAt: now, updatedAt: now, editedBy: by, rev: rev, lastRequestId: REQ.requestId,
  });
  audit_(s.user, teamId, hadAttendance ? 'attendance updated' : 'attendance submitted', 'report', rep.reportId,
    hadAttendance ? { crewPresent: rep.crewPresent, absent: rep.absentList } : null, { crewPresent: present + '/' + rows.length, absent: absentList },
    changes.join('; '));
  return { ok: true, attendanceSubmittedAt: now, crewPresent: present + '/' + rows.length, rev: rev, reportId: rep.reportId };
}

// ════════════════════════════════════════════════════════════════════════════
// Photos
// ════════════════════════════════════════════════════════════════════════════

function uploadPhoto_(s, req) {
  var teamId = teamFor_(s, req.teamId), date = writableDate_(s, req.reportDate);
  if (req.type !== 'before' && req.type !== 'after') throw new Error('Photo type must be before or after');
  var clientId = String(req.clientId || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(clientId)) throw new Error('Missing photo ID — update the app and try again.');
  // Retries of the same photo return the photo already stored, never a second copy.
  var dup = readAll_('Photos').filter(function (p) { return p.clientId === clientId; })[0];
  if (dup) {
    if (dup.teamId !== teamId || dup.reportDate !== date || dup.type !== req.type) deny_(s, 'uploadPhoto', 'Photo ID belongs to another report.');
    return { ok: true, photo: dup, replay: true };
  }
  var rep = row_('DailyReports', teamId + '|' + date);
  if (rep && rep.state === 'submitted' && !isAdmin_(s)) throw new Error('Report already submitted. Tap Edit report first.');
  var m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/i.exec(req.dataUrl || '');
  if (!m) throw new Error('That file is not a photo (JPEG, PNG or WebP only).');
  var bytes = Utilities.base64Decode(m[3]);
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error('Photo is too large.');
  if (bytes.length < 100) throw new Error('Photo is empty or damaged — take it again.');

  rep = ensureReport_(teamId, date, s.user.name);
  var team = row_('Teams', teamId), now = now_();
  var folder = subFolder_(subFolder_(photoRoot_(), date), team.short || team.teamId);
  var ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
  var photoId = 'ph-' + Utilities.getUuid().slice(0, 13);
  var name = date + '_' + (team.short || team.teamId).replace(/[^A-Za-z0-9]+/g, '') + '_' + req.type.toUpperCase() + '_' + now.slice(11).replace(/:/g, '') + '_' + photoId.slice(3, 9) + '.' + ext;
  var file = folder.createFile(Utilities.newBlob(bytes, m[1], name));
  var captured = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(String(req.capturedAt || '')) ? String(req.capturedAt) : '';
  var location = String(req.location || '').trim().slice(0, 200);
  file.setDescription('Report ' + rep.reportId + ' · ' + team.name + ' · ' + req.type.toUpperCase() + ' · uploaded by ' + s.user.name + ' ' + now +
    (captured ? ' · captured ' + captured : '') + (location ? ' · ' + location : '') + ' · original filename: ' + String(req.originalFilename || '').slice(0, 120));
  // Link sharing lets the app and the Sheet show a preview. Workspace domains may block it;
  // the photo is still stored and admins can open it from Drive.
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

  var replaced = markPhotos_(teamId, date, req.type, 'Replaced');
  var photo = {
    photoId: photoId, clientId: clientId, reportId: rep.reportId, teamId: teamId, reportDate: date, type: req.type, status: 'Active',
    leadman: leadmen_()[teamId] || '', location: location, capturedAt: captured,
    fileId: file.getId(), fileUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800',
    originalFilename: String(req.originalFilename || '').slice(0, 200), uploadedAt: now, uploadedBy: s.user.name, bytes: String(bytes.length),
  };
  upsert_('Photos', photoId, photo);
  audit_(s.user, teamId, req.type + ' photo ' + (replaced.length ? 'replaced' : 'uploaded'), 'photo', photoId,
    replaced.length ? { photoId: replaced.join(',') } : null, { photoId: photoId, reportId: rep.reportId, bytes: bytes.length }, photo.originalFilename);
  return { ok: true, photo: photo };
}

function removePhoto_(s, req) {
  var teamId = teamFor_(s, req.teamId), date = writableDate_(s, req.reportDate);
  var p = row_('Photos', String(req.photoId || ''));
  if (!p) throw new Error('Photo not found — refresh and try again.');
  if (p.teamId !== teamId || p.reportDate !== date) deny_(s, 'removePhoto', 'That photo belongs to another report.');
  var rep = row_('DailyReports', teamId + '|' + date);
  if (rep && rep.state === 'submitted' && !isAdmin_(s)) throw new Error('Report already submitted. Tap Edit report first.');
  if (p.status !== 'Active') return { ok: true };
  upsert_('Photos', p.photoId, { status: 'Removed' });
  audit_(s.user, teamId, p.type + ' photo removed', 'photo', p.photoId, { status: 'Active' }, { status: 'Removed' }, 'File kept in Drive');
  return { ok: true };
}

/** Mark the active photo(s) of this type as Replaced/Removed. Files stay in Drive for the audit trail. */
function markPhotos_(teamId, date, type, status) {
  var ids = [];
  readAll_('Photos').forEach(function (p) {
    if (p.teamId === teamId && p.reportDate === date && p.type === type && p.status === 'Active') {
      upsert_('Photos', p.photoId, { status: status }); ids.push(p.photoId);
    }
  });
  return ids;
}

// ════════════════════════════════════════════════════════════════════════════
// Activity report
// ════════════════════════════════════════════════════════════════════════════

var REPORT_FIELDS = ['fromTime', 'toTime', 'location', 'activityDetails', 'status', 'target', 'actual', 'unit', 'targetManpower', 'actualManpower', 'plateNumber', 'remarks'];

/** Every report rule, enforced here so a report can never be accepted half-filled or with impossible values. */
function validateReport_(f, ctx) {
  var c = {}, errs = [];
  REPORT_FIELDS.forEach(function (k) { c[k] = String(f[k] == null ? '' : f[k]).trim(); });
  c.plateNumber = c.plateNumber.toUpperCase().replace(/\s+/g, ' ');
  var hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!hhmm.test(c.fromTime) || !hhmm.test(c.toTime)) errs.push('Enter valid From and To times');
  else if (c.fromTime >= c.toTime) errs.push('"From" time must be before "To" time');
  if (!c.location) errs.push('Enter the location');
  else if (c.location.length > 200) errs.push('Location is too long (200 characters max)');
  if (!c.activityDetails) errs.push('Describe the work done');
  else if (c.activityDetails.length > 2000) errs.push('Activity details are too long (2000 characters max)');
  if (c.remarks.length > 1000) errs.push('Remarks are too long (1000 characters max)');
  if (c.status !== 'Complete' && c.status !== 'Ongoing') errs.push('Choose Ongoing or Complete');
  if (c.unit !== 'KM' && c.unit !== 'Locations') errs.push('Choose the unit (KM or Locations)');
  var num = function (k, label, max, integer) {
    if (!/^\d+(\.\d{1,3})?$/.test(c[k])) { errs.push('Enter ' + label + ' as a number'); return null; }
    var n = Number(c[k]);
    if (n > max) { errs.push(label.charAt(0).toUpperCase() + label.slice(1) + ' looks wrong (max ' + max + ')'); return null; }
    if (integer && n !== Math.floor(n)) { errs.push(label.charAt(0).toUpperCase() + label.slice(1) + ' must be a whole number'); return null; }
    c[k] = String(n);
    return n;
  };
  var qMax = MAX_QTY[c.unit] || 100, whole = c.unit === 'Locations';
  var target = num('target', 'target', qMax, whole), actual = num('actual', 'actual', qMax, whole);
  var tMan = num('targetManpower', 'target manpower', MAX_MANPOWER, true), aMan = num('actualManpower', 'actual manpower', MAX_MANPOWER, true);
  if (aMan === 0) errs.push('Enter actual manpower');
  if (tMan === 0) errs.push('Enter target manpower');
  if (!c.plateNumber) errs.push('Enter equipment / plate number');
  else if (!/^[A-Z0-9 .\/-]{2,20}$/.test(c.plateNumber)) errs.push('Plate number: letters, numbers, spaces and - / only');
  var why = [];
  if (c.status === 'Ongoing') why.push('the work is Ongoing');
  if (target != null && actual != null && actual < target) why.push('actual is below target');
  if (aMan != null && ctx.present != null && aMan > ctx.present) why.push('actual manpower (' + aMan + ') is more than present in attendance (' + ctx.present + ')');
  if (why.length && !c.remarks) errs.push('Add remarks explaining why ' + why.join(' and '));
  return { clean: c, errs: errs };
}

function submitReport_(s, req) {
  var teamId = teamFor_(s, req.teamId), date = writableDate_(s, req.reportDate);
  var key = teamId + '|' + date, old = row_('DailyReports', key), f = req.report || {};
  if (old && REQ.requestId && old.lastRequestId === REQ.requestId && old.state === 'submitted') {
    return { ok: true, replay: true, submittedAt: old.submittedAt, submittedBy: old.submittedBy, version: old.version, rev: old.rev, reportId: old.reportId };
  }
  if (old && old.state === 'submitted') throw new Error('Report is already submitted.');
  needRev_(old, req.baseRev);

  var present = null;
  if (old && old.attendanceSubmittedAt) present = attendanceFor_(teamId, date).filter(function (a) { return a.status === 'Present'; }).length;
  var v = validateReport_(f, { present: present }), clean = v.clean, errs = [];
  if (!old || !old.attendanceSubmittedAt) errs.push('Submit attendance first (Attendance tab)');
  errs = errs.concat(v.errs);

  // The photos must be exactly the ones this report holds on the server.
  var before = activePhoto_(teamId, date, 'before'), after = activePhoto_(teamId, date, 'after');
  if (!before) errs.push('Add a Before Work photo');
  if (clean.status === 'Complete' && !after) errs.push('Add an After Work photo (required when Complete)');
  if (errs.length) return { ok: false, error: 'Cannot submit yet: ' + errs.join('; '), missing: errs };
  if (String(req.beforePhotoId || '') !== before.photoId || String(req.afterPhotoId || '') !== (after ? after.photoId : '')) {
    throw new Error('CONFLICT: The photos on this report changed on another device. Check the photos and submit again.');
  }

  var now = now_();
  var changes = [], beforeVals = {}, afterVals = {};
  if (old && Number(old.version) > 0) {
    REPORT_FIELDS.forEach(function (k) {
      if (String(old[k]) !== clean[k]) { changes.push(k + ': "' + short_(old[k]) + '" → "' + short_(clean[k]) + '"'); beforeVals[k] = old[k]; afterVals[k] = clean[k]; }
    });
    if (old.beforePhotoId !== before.photoId) changes.push('before photo replaced');
    if (after && old.afterPhotoId !== after.photoId) changes.push('after photo replaced');
  } else {
    REPORT_FIELDS.forEach(function (k) { afterVals[k] = clean[k]; });
  }
  var first = old.firstSubmittedAt || now;
  var row = {
    leadman: leadmen_()[teamId] || old.leadman, state: 'submitted',
    beforePhotoId: before.photoId, afterPhotoId: after ? after.photoId : '',
    beforePreview: '=IMAGE("' + before.thumbnailUrl + '")', afterPreview: after ? '=IMAGE("' + after.thumbnailUrl + '")' : '',
    submittedAt: now, submittedBy: s.user.name, updatedAt: now, editedBy: s.user.name,
    version: String((Number(old.version) || 0) + 1), rev: String((Number(old.rev) || 0) + 1),
    firstSubmittedAt: first, late: (first.slice(0, 10) > date || first.slice(11, 16) > LATE_CUTOFF) ? 'Yes' : 'No',
    lastRequestId: REQ.requestId,
  };
  REPORT_FIELDS.forEach(function (k) { row[k] = clean[k]; });
  upsert_('DailyReports', key, row);
  var rep = row_('DailyReports', key);
  revision_(s, rep, 'submitted', row.version === '1' ? '' : changes.join('; '));
  audit_(s.user, teamId, row.version === '1' ? 'report submitted' : 'report resubmitted (v' + row.version + ')', 'report', rep.reportId,
    old.version > 0 ? beforeVals : null, afterVals, changes.length ? changes.join('; ') : (row.version === '1' ? clean.status + ' · ' + short_(clean.location) : 'no field changes'));
  return { ok: true, submittedAt: now, submittedBy: s.user.name, version: row.version, rev: row.rev, reportId: rep.reportId, late: row.late };
}

function reopenReport_(s, req) {
  var teamId = teamFor_(s, req.teamId), date = writableDate_(s, req.reportDate);
  var key = teamId + '|' + date, old = row_('DailyReports', key);
  if (!old || old.state !== 'submitted') throw new Error('This report is not submitted, so there is nothing to reopen.');
  var reason = String(req.reason || '').trim().slice(0, 500);
  if (reason.length < 3) throw new Error('Give a reason for editing the submitted report.');
  if (REQ.requestId && old.lastRequestId === REQ.requestId) return { ok: true, replay: true, rev: old.rev };
  needRev_(old, req.baseRev);
  revision_(s, old, 'reopened', reason);
  var rev = String(Number(old.rev || 0) + 1);
  upsert_('DailyReports', key, { state: 'draft', updatedAt: now_(), editedBy: s.user.name, rev: rev, reopenReason: reason, lastRequestId: REQ.requestId });
  audit_(s.user, teamId, 'report reopened for editing', 'report', old.reportId, { state: 'submitted', version: old.version }, { state: 'draft' }, reason);
  return { ok: true, rev: rev };
}

// ════════════════════════════════════════════════════════════════════════════
// Roster (admin)
// ════════════════════════════════════════════════════════════════════════════

function addMember_(s, req) {
  var teamId = teamFor_(s, req.teamId);
  var name = String(req.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!name) throw new Error('Type a name first');
  if (/^[=+\-@\t\r]/.test(name)) throw new Error('A name cannot start with = + - or @');
  var clash = readAll_('Roster').filter(function (m) { return m.teamId === teamId && m.status === 'Active' && m.name.toLowerCase() === name.toLowerCase(); });
  if (clash.length) throw new Error('Already on this crew');
  var now = now_(), id = newPersonId_(teamId, name);
  var role = req.role === 'Skilled' ? 'Skilled' : 'Crew';
  upsert_('Roster', id, { personId: id, teamId: teamId, name: name, role: role, status: 'Active', createdAt: now, updatedAt: now, editedBy: s.user.name });
  audit_(s.user, teamId, 'crew added', 'person', id, null, { name: name, role: role }, '');
  return { ok: true, personId: id };
}

function archiveMember_(s, req) {
  var m = row_('Roster', String(req.personId || ''));
  if (!m) throw new Error('Person not found');
  if (m.role === 'Leadman') throw new Error('The leadman cannot be removed here — change the leadman in the Users tab.');
  var now = now_();
  upsert_('Roster', m.personId, { status: 'Archived', archivedAt: now, updatedAt: now, editedBy: s.user.name });
  audit_(s.user, m.teamId, 'crew archived', 'person', m.personId, { status: m.status }, { status: 'Archived' }, m.name + ' (attendance history kept)');
  return { ok: true };
}

function restoreMember_(s, req) {
  var m = row_('Roster', String(req.personId || ''));
  if (!m) throw new Error('Person not found');
  upsert_('Roster', m.personId, { status: 'Active', archivedAt: '', updatedAt: now_(), editedBy: s.user.name });
  audit_(s.user, m.teamId, 'crew restored', 'person', m.personId, { status: m.status }, { status: 'Active' }, m.name);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Admin: export, report overview, revisions, audit log
// ════════════════════════════════════════════════════════════════════════════

/** Validated from/to (default: last 30 days), at most `maxDays` long. */
function range_(req, maxDays) {
  var to = req.to ? String(req.to) : today_(), from = req.from ? String(req.from) : shiftDate_(to, -30);
  if (!validDate_(from) || !validDate_(to)) throw new Error('Choose valid From and To dates.');
  if (from > to) throw new Error('"From" date must be on or before "To" date.');
  if (shiftDate_(from, maxDays) < to) throw new Error('Choose at most ' + maxDays + ' days at a time.');
  return { from: from, to: to };
}

/** Text safe to open in Excel/Sheets: a cell starting with = + - @ tab or CR is never run as a formula. */
function csvCell_(v) {
  var x = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(x)) x = "'" + x;
  return /[",\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
}

function exportCsv_(s, req) {
  var r = range_(req, 366), from = r.from, to = r.to;
  var photos = {};
  readAll_('Photos').forEach(function (p) { photos[p.photoId] = p; });
  var head = ['Date', 'Report ID', 'Team', 'Leadman', 'State', 'Late', 'From', 'To', 'Location', 'Activity Details', 'Status', 'Target', 'Actual', 'Unit',
    'Target Manpower', 'Actual Manpower', 'Crew Present', 'Not Present (status)', 'Equipment / Plate', 'Remarks',
    'Before Photo', 'After Photo', 'Attendance Submitted', 'First Submitted', 'Report Submitted', 'Submitted By', 'Version'];
  var rows = readAll_('DailyReports').filter(function (x) { return x.reportDate >= from && x.reportDate <= to; })
    .sort(function (a, b) { return a.reportDate === b.reportDate ? a.teamId.localeCompare(b.teamId) : a.reportDate.localeCompare(b.reportDate); })
    .map(function (x) {
      var bp = photos[x.beforePhotoId], ap = photos[x.afterPhotoId];
      return [x.reportDate, x.reportId, x.team, x.leadman, x.state === 'submitted' ? 'Submitted' : (x.attendanceSubmittedAt ? 'Draft (attendance only)' : 'Draft'), x.late,
        x.fromTime, x.toTime, x.location, x.activityDetails, x.status, x.target, x.actual, x.unit,
        x.targetManpower, x.actualManpower, x.crewPresent, x.absentList, x.plateNumber, x.remarks,
        bp ? bp.fileUrl : '', ap ? ap.fileUrl : '', x.attendanceSubmittedAt, x.firstSubmittedAt, x.submittedAt, x.submittedBy, x.version];
    });
  var csv = [head].concat(rows).map(function (x) { return x.map(csvCell_).join(','); }).join('\r\n');
  audit_(s.user, '', 'export', 'export', '', null, { from: from, to: to, rows: rows.length }, '');
  var id = db_().getId();
  return { ok: true, csv: csv, rows: rows.length, from: from, to: to, filename: 'NLEX_Daily_Report_' + from + '_to_' + to + '.csv',
    xlsxUrl: 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx' };
}

/** Every team × day in the range: submitted / draft / missing, late, attendance and photo completeness. */
function adminReports_(s, req) {
  var r = range_(req, 62);
  var reports = {}, att = {}, photos = {}, revs = {};
  readAll_('DailyReports').forEach(function (x) { if (x.reportDate >= r.from && x.reportDate <= r.to) reports[x.teamId + '|' + x.reportDate] = x; });
  readAll_('Attendance').forEach(function (a) { if (a.reportDate >= r.from && a.reportDate <= r.to) { var k = a.teamId + '|' + a.reportDate; att[k] = (att[k] || 0) + 1; } });
  readAll_('Photos').forEach(function (p) { if (p.status === 'Active' && p.reportDate >= r.from && p.reportDate <= r.to) { var k = p.teamId + '|' + p.reportDate; photos[k] = (photos[k] || 0) + 1; } });
  readAll_('Revisions').forEach(function (v) { revs[v.reportId] = (revs[v.reportId] || 0) + 1; });
  var roster = {};
  readAll_('Roster').forEach(function (m) { if (m.status === 'Active') roster[m.teamId] = (roster[m.teamId] || 0) + 1; });
  var leadOf = leadmen_(), out = [];
  var teams = readAll_('Teams').filter(function (t) { return t.active !== 'No'; });
  for (var d = r.to; d >= r.from; d = shiftDate_(d, -1)) {
    teams.forEach(function (t) {
      var k = t.teamId + '|' + d, x = reports[k] || {};
      var state = x.state === 'submitted' ? 'Submitted' : x.attendanceSubmittedAt ? 'Draft' : 'Missing';
      var overdue = state !== 'Submitted' && (d < today_() || now_().slice(11, 16) > LATE_CUTOFF);
      out.push({ reportDate: d, teamId: t.teamId, team: t.name, leadman: x.leadman || leadOf[t.teamId] || '', reportId: x.reportId || '',
        state: state, late: x.late === 'Yes' || overdue, overdue: overdue, version: x.version || '0', revisions: x.reportId ? (revs[x.reportId] || 0) : 0,
        attendanceRows: att[k] || 0, rosterSize: roster[t.teamId] || 0, crewPresent: x.crewPresent || '', photos: photos[k] || 0,
        photosNeeded: x.status === 'Complete' ? 2 : 1, status: x.status || '', location: x.location || '', submittedAt: x.submittedAt || '', firstSubmittedAt: x.firstSubmittedAt || '' });
    });
  }
  return { ok: true, from: r.from, to: r.to, rows: out };
}

function revisions_(s, req) {
  var id = String(req.reportId || '');
  var list = readAll_('Revisions').filter(function (v) { return v.reportId === id; }).map(function (v) {
    var snap = {}; try { snap = JSON.parse(v.snapshot); } catch (e) {}
    return { revisionId: v.revisionId, rev: v.rev, version: v.version, kind: v.kind, at: v.at, by: v.by, reason: v.reason, snapshot: snap };
  });
  var audit = readAll_('AuditLog').filter(function (a) { return a.entityId === id; });
  return { ok: true, reportId: id, revisions: list.reverse(), audit: audit.reverse() };
}

function auditLog_(s, req) {
  var r = range_(req, 366), team = String(req.teamId || '');
  var rows = readAll_('AuditLog').filter(function (a) {
    var d = a.at.slice(0, 10);
    return d >= r.from && d <= r.to && (!team || a.teamId === team);
  });
  var total = rows.length;
  return { ok: true, from: r.from, to: r.to, total: total, rows: rows.reverse().slice(0, Math.min(Number(req.limit) || 300, 1000)) };
}

// ════════════════════════════════════════════════════════════════════════════
// Sheet helpers
// ════════════════════════════════════════════════════════════════════════════

var CACHE = {};

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function yesterday_() { return shiftDate_(today_(), -1); }
function shiftDate_(iso, days) {
  var p = iso.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
function short_(v) { v = String(v == null ? '' : v); return v.length > 60 ? v.slice(0, 57) + '…' : v; }
/** Stored text is never run as a formula by Sheets. */
function safeCell_(v) { v = v == null ? '' : String(v); return /^[=+\-@\t\r]/.test(v) ? "'" + v : v; }

function col_(name, field) {
  var cols = TABLES[name];
  for (var i = 0; i < cols.length; i++) if (cols[i][0] === field) return i + 1;
  throw new Error('No column ' + field);
}

function sheet_(name) {
  var sh = db_().getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" is missing — run setup() in the Apps Script editor.');
  return sh;
}

/** Text format everywhere (so dates/times/plate numbers stay exactly as typed), except photo preview formulas. */
function formatRows_(sh, name, fromRow, count) {
  if (count < 1) return;
  var fmts = TABLES[name].map(function (c) { return FORMULA_FIELDS[c[0]] ? 'General' : '@'; });
  var grid = [];
  for (var i = 0; i < count; i++) grid.push(fmts);
  sh.getRange(fromRow, 1, count, fmts.length).setNumberFormats(grid);
}

/**
 * Upgrade tabs made by an older version: rename Reports → DailyReports, keep the old Audit tab
 * as "Audit (v1)", move PINs from Teams to Users, and rewrite each tab's columns to the new
 * layout by header name. Returns the users found in an old Teams tab.
 */
function migrate_() {
  var ss = db_(), users = [];
  var oldRep = ss.getSheetByName('Reports');
  if (oldRep && !ss.getSheetByName('DailyReports')) oldRep.setName('DailyReports');
  var oldAudit = ss.getSheetByName('Audit');
  if (oldAudit && !ss.getSheetByName('Audit (v1)')) oldAudit.setName('Audit (v1)');
  var teams = ss.getSheetByName('Teams');
  if (teams && teams.getLastRow() > 1) {
    var g = teams.getRange(1, 1, teams.getLastRow(), teams.getLastColumn()).getDisplayValues(), h = g[0];
    var iPin = h.indexOf('PIN (4 digits)'), iId = h.indexOf('Team ID'), iLead = h.indexOf('Leadman'), iName = h.indexOf('Team'), iAct = h.indexOf('Active (Yes/No)');
    if (iPin >= 0) {
      g.slice(1).forEach(function (r) {
        if (!r[iId]) return;
        var admin = r[iId] === 'admin';
        users.push({ userId: admin ? 'admin' : 'lead-' + r[iId], name: admin ? (r[iName] || 'Operations Admin') : r[iLead], role: admin ? 'admin' : 'leadman',
          teamId: admin ? '' : r[iId], pin: r[iPin], active: r[iAct] === 'No' ? 'No' : 'Yes' });
      });
    }
  }
  Object.keys(TABLES).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 0) relayout_(sh, name);
  });
  CACHE = {};
  if (users.length && ss.getSheetByName('Teams')) { if (row_('Teams', 'admin')) deleteRow_('Teams', 'admin'); }
  return users;
}

function relayout_(sh, name) {
  var cols = TABLES[name], want = cols.map(function (c) { return c[1]; });
  var nr = sh.getLastRow(), nc = sh.getLastColumn();
  var range = sh.getRange(1, 1, nr, nc), grid = range.getDisplayValues(), formulas = range.getFormulas(), have = grid[0];
  if (have.slice(0, want.length).join('|') === want.join('|') && nc <= want.length) return;
  var idx = want.map(function (h) {
    var i = have.indexOf(h);
    (HEADER_ALIASES[h] || []).forEach(function (a) { if (i < 0) i = have.indexOf(a); });
    return i;
  });
  var rows = grid.slice(1).map(function (r, ri) {
    return idx.map(function (i, j) {
      if (i < 0) return '';
      return FORMULA_FIELDS[cols[j][0]] ? formulas[ri + 1][i] : safeCell_(r[i]);
    });
  });
  sh.clearContents();
  if (sh.getMaxRows() < nr + 1) sh.insertRowsAfter(sh.getMaxRows(), nr + 1 - sh.getMaxRows());
  formatRows_(sh, name, 2, Math.max(1, rows.length));
  sh.getRange(1, 1, 1, want.length).setValues([want]);
  if (rows.length) sh.getRange(2, 1, rows.length, want.length).setValues(rows);
}

function readAll_(name) {
  if (CACHE[name]) return CACHE[name].rows.map(function (r) { return Object.assign({}, r); });
  var sh = sheet_(name), n = sh.getLastRow() - 1, cols = TABLES[name];
  var rows = n < 1 ? [] : sh.getRange(2, 1, n, cols.length).getDisplayValues().map(function (v) {
    var o = {};
    cols.forEach(function (c, i) { o[c[0]] = v[i] == null ? '' : String(v[i]); });
    return o;
  });
  var index = {}, kf = KEY_FIELD[name];
  if (kf) rows.forEach(function (r, i) { index[r[kf]] = i; });
  CACHE[name] = { rows: rows, index: index };
  return rows.map(function (r) { return Object.assign({}, r); });
}

function row_(name, key) {
  readAll_(name);
  var i = CACHE[name].index[key];
  return i == null ? null : Object.assign({}, CACHE[name].rows[i]);
}

/**
 * Insert or update one row by key. Only fields present in `data` change;
 * `defaults` are used for new rows only. Whole row is written in one call.
 */
function upsert_(name, key, data, defaults) {
  var sh = sheet_(name), cols = TABLES[name], kf = KEY_FIELD[name];
  readAll_(name);
  var i = CACHE[name].index[key], isNew = i == null;
  var rowNum = isNew ? CACHE[name].rows.length + 2 : i + 2;
  var current;
  if (isNew) {
    current = {};
    if (rowNum > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
    formatRows_(sh, name, rowNum, 1);
  } else {
    current = CACHE[name].rows[i];
    var formulas = sh.getRange(rowNum, 1, 1, cols.length).getFormulas()[0];
    cols.forEach(function (c, j) { if (FORMULA_FIELDS[c[0]]) current[c[0]] = formulas[j] || ''; });
  }
  var merged = {};
  cols.forEach(function (c) {
    var k = c[0];
    if (k === kf) merged[k] = key;
    else if (data && Object.prototype.hasOwnProperty.call(data, k) && data[k] !== undefined) merged[k] = data[k];
    else if (isNew && defaults && Object.prototype.hasOwnProperty.call(defaults, k)) merged[k] = defaults[k];
    else merged[k] = current[k] == null ? '' : current[k];
  });
  var values = cols.map(function (c) {
    var v = merged[c[0]] == null ? '' : String(merged[c[0]]);
    return FORMULA_FIELDS[c[0]] ? v : safeCell_(v);
  });
  sh.getRange(rowNum, 1, 1, cols.length).setValues([values]);
  if (name === 'DailyReports') sh.setRowHeight(rowNum, 72);
  var stored = {};
  cols.forEach(function (c) { stored[c[0]] = FORMULA_FIELDS[c[0]] ? '' : String(merged[c[0]] == null ? '' : merged[c[0]]); });
  if (isNew) { CACHE[name].index[key] = CACHE[name].rows.length; CACHE[name].rows.push(stored); }
  else CACHE[name].rows[i] = stored;
  return rowNum;
}

function deleteRow_(name, key) {
  readAll_(name);
  var i = CACHE[name].index[key];
  if (i == null) return;
  sheet_(name).deleteRow(i + 2);
  delete CACHE[name];
}

function auditHash_(prev, a) {
  var body = [prev, a.auditId, a.at, a.user, a.role, a.teamId, a.action, a.entity, a.entityId, a.before, a.after, a.reason, a.requestId, a.device].join('␞');
  return hmac_(body, 'AUDIT_SECRET').slice(0, 24);
}

/**
 * Append one audit entry: who, what, when, which entity, before/after, reason. Rows are only ever
 * appended; each carries a hash of the previous one, so verifyAuditLog() spots hand edits.
 */
function audit_(user, teamId, action, entity, entityId, before, after, reason) {
  var lock = null;
  try {
    if (!LOCKED) { lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) lock = null; }
    var sh = sheet_('AuditLog'), last = sh.getLastRow();
    var prev = last > 1 ? String(sh.getRange(last, col_('AuditLog', 'hash')).getDisplayValues()[0][0] || '') : '';
    var j = function (o) { return o == null ? '' : (typeof o === 'string' ? o : JSON.stringify(o)).slice(0, 5000); };
    var a = { auditId: 'au-' + Utilities.getUuid().slice(0, 13), at: now_(), user: user.name || '', role: user.role || '', teamId: teamId || '',
      action: action, entity: entity || '', entityId: entityId || '', before: j(before), after: j(after), reason: String(reason || '').slice(0, 2000),
      requestId: REQ.requestId || '', device: REQ.device || '' };
    a.hash = auditHash_(prev, a);
    var row = last + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
    formatRows_(sh, 'AuditLog', row, 1);
    sh.getRange(row, 1, 1, TABLES.AuditLog.length).setValues([TABLES.AuditLog.map(function (c) { return safeCell_(a[c[0]]); })]);
    delete CACHE.AuditLog;
  } catch (e) {
    Logger.log('audit failed: ' + e);
  } finally {
    if (lock) lock.releaseLock();
  }
}

function newPersonId_(teamId, name) {
  var base = teamId + '-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  var id = base, n = 2;
  while (row_('Roster', id)) id = base + '-' + (n++);
  return id;
}

function photoRoot_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID') || PHOTO_FOLDER_ID;
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(PHOTO_ROOT);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_ROOT);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function subFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
