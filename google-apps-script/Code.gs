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
 *   Accomplishment Report   the team's weekly report layout, one row per submitted report (filled automatically)
 *   Requests      idempotency ledger: every accepted write's request ID and its answer (a retry gets the same answer)
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
// Sessions are short and bound to the phone that signed in. Work queued offline is kept on the phone
// and sent after the next sign-in, so a short leadman session never loses data.
var SESSION_HOURS = { leadman: 72, admin: 8 };
var ENROLL_HOURS = 24;                                  // a setup link connects ONE phone, once, within this time
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
    ['reportName', 'Report Name (LAST, FIRST M.)'],
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
    ['uploadedAt', 'Uploaded (server time)'], ['uploadedBy', 'Uploaded By'],
    ['reportId', 'Report ID'], ['clientId', 'Client Photo ID'], ['leadman', 'Leadman'], ['location', 'Location (typed on phone, not verified)'],
    ['capturedAt', 'Captured (phone clock, not verified)'], ['bytes', 'Bytes'],
  ],
  Revisions: [
    ['revisionId', 'Revision ID'], ['reportId', 'Report ID'], ['teamId', 'Team ID'], ['reportDate', 'Date'], ['rev', 'Revision'], ['version', 'Version'],
    ['kind', 'Kind'], ['at', 'Time'], ['by', 'By'], ['reason', 'Reason'], ['snapshot', 'Snapshot (JSON)'],
  ],
  AuditLog: [
    ['auditId', 'Audit ID'], ['at', 'Time'], ['user', 'User'], ['role', 'Role'], ['teamId', 'Team ID'], ['action', 'Action'],
    ['entity', 'Entity'], ['entityId', 'Entity ID'], ['before', 'Before'], ['after', 'After'], ['reason', 'Reason / Detail'],
    ['requestId', 'Request ID'], ['device', 'Device'], ['hash', 'Chain Hash'], ['userId', 'User ID'], ['rev', 'Report Revision'],
  ],
  Sessions: [
    ['sessionId', 'Session ID'], ['userId', 'User ID'], ['role', 'Role'], ['teamId', 'Team ID'], ['device', 'Device'],
    ['createdAt', 'Created'], ['expiresAt', 'Expires'], ['revokedAt', 'Revoked'], ['revokedReason', 'Revoked Reason'],
  ],
  Devices: [
    ['deviceId', 'Device ID'], ['label', 'Phone (as its browser reports it)'], ['enrolledAt', 'Enrolled'], ['link', 'Setup Link'],
    ['revokedAt', 'Disconnected'], ['revokedBy', 'Disconnected By'], ['revokedReason', 'Reason'],
  ],
  Requests: [
    ['key', 'Key'], ['userId', 'User ID'], ['action', 'Action'], ['requestId', 'Request ID'], ['bodyHash', 'Body Hash'], ['at', 'Time'], ['result', 'Answer (JSON)'],
  ],
};
var KEY_FIELD = { Users: 'userId', Teams: 'teamId', Roster: 'personId', Attendance: 'key', DailyReports: 'key', Photos: 'photoId', Revisions: 'revisionId', Sessions: 'sessionId', Devices: 'deviceId', Requests: 'key' };
var FORMULA_FIELDS = { beforePreview: true, afterPreview: true };
// Old header → new header, used when setup() upgrades an existing Sheet.
var HEADER_ALIASES = { 'Note / Reason': ['Absence Reason'], 'Not Present (status)': ['Absent (reason)'], 'Uploaded (server time)': ['Uploaded'],
  'Location (typed on phone, not verified)': ['Location (at capture)'], 'Captured (phone clock, not verified)': ['Captured (phone clock)'] };
var PROTECTED_TABS = ['Users', 'AuditLog', 'Revisions', 'Sessions', 'Devices', 'Requests'];

// Real crews. setup() copies them into the Sheet once (only when the tabs are empty).
// No PINs here: setup() makes random ones and prints them once.
var SEED = [
  ['team1', 'Bridge RM_Team 1', 'RM Team 1', 'Pijay Tanjeco', 'Locations',
    [['Justin Billones', 'Skilled'], ['Ignacio Alcoriza Jr.', 'Crew'], ['Alvin Angelo', 'Crew'], ['Joven Blanza', 'Crew'], ['Rocky Miranda', 'Crew'], ['Richard Candelaria', 'Crew'], ['Crisostomo Sebuc', 'Crew']]],
  ['team2', 'Segment 10 Scupper Drain', 'Segment 10', 'Glenn Butiong', 'KM',
    [['Glen Jorick De Mesa', 'Skilled'], ['Justine Gregg Baylon', 'Skilled'], ['John Christian Bernardo', 'Crew'], ['Ian Enriquez', 'Crew'], ['Joanner Royce Quilao', 'Crew'], ['Rolando Faustino', 'Crew'], ['Richard Santiago', 'Crew'], ['Abraham Balmeo', 'Crew']]],
  ['team3', 'Bridge Epoxy 1', 'Epoxy 1', 'Allan Miranda', 'Locations',
    [['Elmer Dordulo', 'Skilled'], ['Edwin Lozano', 'Skilled'], ['R-Jay John Aquino', 'Crew'], ['Mark Joseph De Guzman', 'Crew'], ['Edbryan Dela Cruz', 'Crew'], ['Mark Ian Dungca', 'Crew'], ['Johnry Manese', 'Crew'], ['Eroll Pangilinan', 'Crew']]],
  ['team4', 'Bridge Epoxy 2', 'Epoxy 2', 'Gilbert Rivera', 'Locations',
    [['Alvin Galang', 'Skilled'], ['Ivan Cabunag', 'Crew'], ['AJ Enriquez', 'Crew'], ['Jaypee Occidental', 'Crew'], ['Edgar Ortillo', 'Crew'], ['Voltaire Rotamula', 'Crew'], ['Joshua Andrei Tayco', 'Crew']]],
];

// ════════════════════════════════════════════════════════════════════════════
// Setup (run once from the editor; safe to run again after updating the code)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Creates the tabs (upgrading an older Sheet in place), fills in teams and crew when empty,
 * and gives the admin and each leadman a new random PIN. The PINs are printed in the log ONCE;
 * the Users tab only keeps a hash. `options.pins` (automated tests only) fixes the new PINs: admin first, then one per team.
 */
function setup(options) {
  var fixedPins = options && Array.isArray(options.pins) && options.pins.length === SEED.length + 1 ? options.pins.map(String) : null;
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
    SEED.forEach(function (t) { upsert_('Teams', t[0], { teamId: t[0], name: t[1], short: t[2], defaultUnit: t[4], active: 'Yes' }); });
  }
  if (readAll_('Users').length === 0) {
    if (legacy.length) {
      legacy.forEach(function (u) { upsert_('Users', u.userId, u, { createdAt: now, updatedAt: now }); });
    } else {
      var fresh = fixedPins || randomPins_(SEED.length + 1);
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
      [[t[3], 'Leadman']].concat(t[5]).forEach(function (m) {
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

  // The old shared setup link (one key for every phone, 7 days) stops working. Phones already connected
  // keep their device key; each new phone gets its own single-use link from showSetupLink().
  props.deleteProperty('SETUP_KEY'); props.deleteProperty('SETUP_KEY_EXPIRES');
  purgeSetupLinks_(false);
  photoRoot_();
  accSheet_();
  // Photos are private: files shared "anyone with the link" by older versions are made private again.
  var priv = makePhotosPrivate_(120000);
  if (priv.left) Logger.log(priv.left + ' photos still shared by link — run makePhotosPrivate to finish.');
  // Crew names as written in the client's reports (LAST, FIRST M.), filled once; editable in the Roster tab.
  readAll_('Roster').forEach(function (m) { if (!m.reportName && REPORT_NAMES[m.personId]) upsert_('Roster', m.personId, { reportName: REPORT_NAMES[m.personId] }); });
  // Client report tabs (created if missing; their rows are rewritten from the data, never typed in).
  TEAM_TABS.forEach(function (t) { teamReportSheet_(t); });
  consoSheet_();
  monthlyWrite_();
  summaryWrite_();
  ATTENDANCE_TABS.forEach(function (cfg) { attendanceTabWrite_(cfg); });
  // Photo cells written by older versions used =IMAGE(link) (needs public files): rewrite them once as private links.
  if (!props.getProperty('PREVIEWS_PRIVATE')) {
    readAll_('DailyReports').forEach(function (r) {
      if (!r.beforePhotoId && !r.afterPhotoId) return;
      var b = row_('Photos', r.beforePhotoId), a = row_('Photos', r.afterPhotoId);
      upsert_('DailyReports', r.key, { beforePreview: photoCell_(b), afterPreview: photoCell_(a) });
    });
    rebuildAccomplishmentReport();
    rebuildClientTabs();
    props.setProperty('PREVIEWS_PRIVATE', '1');
  }
  audit_({ name: 'setup', role: 'system' }, '', 'setup', 'system', '', null, null, 'setup() run');
  Logger.log('Setup complete. Write the PINs above down now — the Users tab only keeps a hash.');
  Logger.log('Next: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone), then run showSetupLink.');
  return { pins: pins };
}

/**
 * Print a setup link for ONE new phone. Run from the editor after deploying (run it again for each phone).
 * The link works once, within ENROLL_HOURS; a leaked, used or expired link cannot connect another phone.
 */
function showSetupLink() {
  var APP_ADDRESS = 'https://bridge-nlex-report.netlify.app/';   // where the app is hosted (Netlify)
  // Your Web app URL: Deploy → Manage deployments → Web app → Copy. It ends in /exec.
  // (Apps Script sometimes reports its test address, ending in /dev, which phones cannot use.)
  var WEB_APP_URL = '';
  var url = String(WEB_APP_URL || ScriptApp.getService().getUrl() || '').trim();
  if (!WEB_APP_URL_RE.test(url)) {
    Logger.log('NO LINK MADE. Apps Script gave this address: ' + (url || '(none)') + ' — phones need the Web app URL ending in /exec.');
    Logger.log('Fix: Deploy → Manage deployments → copy the Web app URL, paste it between the quotes of WEB_APP_URL in showSetupLink, save, run showSetupLink again.');
    return;
  }
  var link = newSetupLink_();
  Logger.log(APP_ADDRESS + '?backend=' + encodeURIComponent(url) + '&key=' + link.token);
  Logger.log('This link connects ONE phone, once, until ' + Utilities.formatDate(new Date(link.exp), TZ, 'yyyy-MM-dd HH:mm') + ' (Manila). Run showSetupLink again for the next phone.');
}

var WEB_APP_URL_RE = /^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+\/|macros\/)s\/[\w-]+\/exec$/;

/** Cancel every setup link not used yet. Phones already connected keep working. */
function cancelSetupLinks() { Logger.log(purgeSetupLinks_(true) + ' unused setup link(s) cancelled.'); }

/**
 * Single-use setup links. Only a keyed hash of the link's token is kept (script properties, not the Sheet),
 * with its expiry and, once used, which phone used it.
 */
function setupLinkKey_(token) { return 'ENR_' + hmac_('enroll|' + token, 'DEVICE_SECRET').slice(0, 32); }

function newSetupLink_() {
  purgeSetupLinks_(false);
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
  var exp = Date.now() + ENROLL_HOURS * 3600000;
  PropertiesService.getScriptProperties().setProperty(setupLinkKey_(token), JSON.stringify({ exp: exp, made: now_() }));
  return { token: token, exp: exp };
}

/** Remove expired setup links (and, with `all`, every unused one). Returns how many were removed. */
function purgeSetupLinks_(all) {
  var props = PropertiesService.getScriptProperties(), n = 0, keys = Object.keys(props.getProperties());
  keys.forEach(function (k) {
    if (k.indexOf('ENR_') !== 0) return;
    var rec = null; try { rec = JSON.parse(props.getProperty(k)); } catch (e) {}
    // A used link is kept until it expires, so its phone can retry after a dropped reply and a replay is recognised.
    if (!rec || Number(rec.exp) < Date.now() || (all && !rec.usedAt)) { props.deleteProperty(k); if (!rec || !rec.usedAt) n++; }
  });
  return n;
}

/** n different random 4-digit PINs, avoiding weak ones (all digits the same, or a run like 1234). */
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
  purgeSetupLinks_(true);
  PropertiesService.getScriptProperties().setProperty('DEVICE_SECRET', Utilities.getUuid() + Utilities.getUuid());
  signOutEveryone();
}

/**
 * Make every evidence photo private (older versions shared them "anyone with the link").
 * Stops after `budgetMs` (Apps Script runs are limited to 6 minutes) and continues on the next run.
 */
function makePhotosPrivate() { var r = makePhotosPrivate_(300000); Logger.log(r.done + ' photo files made private, ' + r.left + ' left' + (r.left ? ' — run again.' : '.')); }

function makePhotosPrivate_(budgetMs) {
  var props = PropertiesService.getScriptProperties(), start = Date.now();
  var rows = readAll_('Photos'), i = Number(props.getProperty('PHOTOS_PRIVATE_UPTO') || 0), done = 0;
  for (; i < rows.length; i++) {
    if (Date.now() - start > budgetMs) break;
    if (!rows[i].fileId) continue;
    try { DriveApp.getFileById(rows[i].fileId).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); done++; }
    catch (e) { Logger.log('Could not make photo ' + rows[i].photoId + ' private: ' + e); }
  }
  props.setProperty('PHOTOS_PRIVATE_UPTO', String(i));
  return { done: done, left: rows.length - i };
}

/** Lift a sign-in lockout early (after too many wrong PINs). */
function clearLoginLock() { PropertiesService.getScriptProperties().deleteProperty('LOGIN_LOCKED_UNTIL'); }

/** After checking the cause, clear the "audit entries could not be written" warning on the admin screen. */
function clearAuditFailures() { PropertiesService.getScriptProperties().deleteProperty('AUDIT_FAILURES'); }

/** Rebuild every client report tab (team activity tabs + attendance tabs) from the saved data. */
function rebuildClientTabs() {
  CACHE = {};
  var n = 0;
  var clear = function (sh, ncols) { var last = sh.getLastRow(); if (last > 1) sh.getRange(2, 1, last - 1, ncols).clearContent(); };
  TEAM_TABS.forEach(function (t) { clear(teamReportSheet_(t), TR_COLS); });
  clear(consoSheet_(), CONSO_COLS);
  submittedReports_().sort(function (a, b) { return (a.reportDate + (a.firstSubmittedAt || '')).localeCompare(b.reportDate + (b.firstSubmittedAt || '')); }).forEach(function (r) {
    var t = teamTab_(r.teamId);
    if (t) sheetRowWrite_(teamReportSheet_(t), TR_COLS, r.reportId, reportRow_(r, t));
    sheetRowWrite_(consoSheet_(), CONSO_COLS, r.reportId, consoRow_(r));
    n++;
  });
  monthlyWrite_();
  summaryWrite_();
  ATTENDANCE_TABS.forEach(function (cfg) { attendanceTabWrite_(cfg); });
  Logger.log('Client tabs rebuilt: ' + n + ' reports.');
  return n;
}

/** Rebuild the Accomplishment Report tab from every submitted report (e.g. after editing it by hand). */
function rebuildAccomplishmentReport() {
  CACHE = {};
  var sh = accSheet_(), last = sh.getLastRow();
  if (last > ACC_FIRST_ROW - 1) sh.getRange(ACC_FIRST_ROW, 1, last - ACC_FIRST_ROW + 1, ACC_HEAD.length).clearContent();
  var reps = readAll_('DailyReports').filter(function (r) { return r.state === 'submitted' || Number(r.version) > 0; })
    .sort(function (a, b) { return (a.reportDate + (a.firstSubmittedAt || '')).localeCompare(b.reportDate + (b.firstSubmittedAt || '')); });
  reps.forEach(function (r) { accWrite_(r); });
  Logger.log('Accomplishment Report rebuilt: ' + reps.length + ' rows.');
  return reps.length;
}

/**
 * Check the audit log has not been changed by hand. The hash chain catches edited, reordered or inserted
 * rows; the checkpoint (kept in script properties, outside the Sheet) catches rows deleted from the end.
 */
function verifyAuditLog() {
  CACHE = {};
  var rows = readAll_('AuditLog'), prev = '', fail = function (row, why) { Logger.log('AUDIT LOG NOT INTACT: ' + why); return { ok: false, row: row, reason: why }; };
  for (var i = 0; i < rows.length; i++) {
    if (auditHash_(prev, rows[i]) !== rows[i].hash) return fail(i + 2, 'changed by hand at row ' + (i + 2) + ' (' + rows[i].auditId + ')');
    prev = rows[i].hash;
  }
  var cp = auditCheckpoint_(), tamper = auditTamper_();
  if (cp && !cp.valid) return fail(0, 'the audit checkpoint itself was changed');
  if (cp && rows.length < cp.n) return fail(rows.length + 2, (cp.n - rows.length) + ' entr' + (cp.n - rows.length === 1 ? 'y' : 'ies') + ' deleted from the end (checkpoint expects ' + cp.n + ')');
  if (cp && rows.length > cp.n) return fail(cp.n + 2, (rows.length - cp.n) + ' entr' + (rows.length - cp.n === 1 ? 'y' : 'ies') + ' after the checkpoint (added outside the app, or the checkpoint could not be saved)');
  if (cp && cp.n && rows[cp.n - 1].hash !== cp.h) return fail(cp.n + 1, 'the last entry does not match the checkpoint');
  if (tamper) return fail(0, 'earlier tampering was detected at ' + tamper.at + ': ' + tamper.what + ' (run resetAuditCheckpoint after checking)');
  Logger.log('Audit log intact: ' + rows.length + ' entries' + (cp ? ', matches the checkpoint.' : ' (no checkpoint yet — it is made with the next entry).'));
  return { ok: true, rows: rows.length, checkpoint: !!cp };
}

/** After investigating a tampering warning: accept the audit log as it is now and start a new checkpoint (itself audited). */
function resetAuditCheckpoint() {
  var props = PropertiesService.getScriptProperties(), old = auditTamper_();
  props.deleteProperty('AUDIT_TAMPER'); props.deleteProperty('AUDIT_CHECKPOINT');
  audit_({ name: 'script editor', role: 'system' }, '', 'audit checkpoint reset', 'system', '', old, null, 'resetAuditCheckpoint() run');
  Logger.log('Audit checkpoint reset.');
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
    var sess = fn.public ? null : verify_(req.token, req.deviceKey);
    if (sess) REQ.device = sess.device;
    if (fn.admin && !isAdmin_(sess)) deny_(sess, req.action, 'admin-only action');
    if (fn.idem && !REQ.requestId) throw new Error('Missing request ID — update the app, then try again.');
    // A retried write (same user + action + request ID) gets the first answer back and changes nothing.
    var idem = fn.writes && sess && REQ.requestId ? idemCheck_(sess, req) : null;
    if (idem && idem.answer) return out_(idem.answer);
    var result = fn.run(sess, req);
    if (idem && result && result.ok) idemStore_(idem, result);
    return out_(result);
  } catch (err) {
    var msg = String(err && err.message || err);
    var o = { ok: false, error: msg.replace(/^(AUTH|CONFLICT|DENIED): /, '') };
    msg = msg.replace(/^DEVICE: /, function () { o.notSetUp = true; return 'AUTH: '; });
    o.error = msg.replace(/^(AUTH|CONFLICT|DENIED): /, '');
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
  saveAttendance: { run: saveAttendance_, writes: true, idem: true },
  uploadPhoto:    { run: uploadPhoto_, writes: true },                  // idempotent by the phone's photo ID (clientId)
  photoView:      { run: photoView_ },                                  // private photo bytes for a signed-in, authorised user
  removePhoto:    { run: removePhoto_, writes: true },
  submitReport:   { run: submitReport_, writes: true, idem: true },
  reopenReport:   { run: reopenReport_, writes: true, idem: true },
  addMember:      { run: addMember_, writes: true, admin: true },
  archiveMember:  { run: archiveMember_, writes: true, admin: true },
  restoreMember:  { run: restoreMember_, writes: true, admin: true },
  exportCsv:      { run: exportCsv_, writes: true, admin: true },
  adminReports:   { run: adminReports_, admin: true },
  revisions:      { run: revisions_, admin: true },
  auditLog:       { run: auditLog_, admin: true },
  devices:        { run: devices_, admin: true },
  revokeDevice:   { run: revokeDevice_, writes: true, admin: true },
};

/** Canonical JSON (sorted keys) so the same request always hashes the same. */
function canon_(v) {
  if (Array.isArray(v)) return '[' + v.map(canon_).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon_(v[k]); }).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

/**
 * Idempotency: the answer to an accepted write is kept in the Requests tab (durable) and the script
 * cache (fast). The same request ID again returns that answer; the same ID with different data is refused.
 */
function idemCheck_(s, req) {
  var body = {};
  Object.keys(req).forEach(function (k) { if (k !== 'token' && k !== 'deviceKey' && k !== 'requestId') body[k] = req[k]; });
  var key = s.user.userId + '|' + req.action + '|' + REQ.requestId, hash = hmac_(canon_(body), 'AUDIT_SECRET').slice(0, 24);
  var hit = null, c = CacheService.getScriptCache().get('rq:' + key);
  if (c) { try { hit = JSON.parse(c); } catch (e) {} }
  if (!hit) { var row = row_('Requests', key); if (row) { try { hit = { hash: row.bodyHash, result: JSON.parse(row.result) }; } catch (e) {} } }
  if (hit) {
    if (hit.hash !== hash) deny_(s, req.action, 'This request ID was already used for different data.');
    var o = hit.result; o.replay = true;
    return { answer: o };
  }
  return { key: key, hash: hash, action: req.action, userId: s.user.userId };
}

function idemStore_(idem, result) {
  var json = JSON.stringify(result);
  upsert_('Requests', idem.key, { key: idem.key, userId: idem.userId, action: idem.action, requestId: REQ.requestId, bodyHash: idem.hash, at: now_(), result: json.slice(0, 45000) });
  try { CacheService.getScriptCache().put('rq:' + idem.key, JSON.stringify({ hash: idem.hash, result: result }), 21600); } catch (e) { Logger.log('request cache: ' + e); }
}

// ════════════════════════════════════════════════════════════════════════════
// Auth: device enrolment → PIN sign-in → server-side session
// ════════════════════════════════════════════════════════════════════════════

/**
 * Single-use setup link → a signed per-phone device key. The link's token is not kept on the phone.
 * A link works once: a replay (the link was leaked, forwarded or reused) is refused and audited. The phone's
 * own random enrolment ID lets that same phone retry after a dropped reply and get its device key again.
 */
function enroll_(_, req) {
  // Wrong links are limited on their own counter: they cannot lock PIN sign-in for everyone
  // (a link is 160 random bits, so guessing one is not a practical attack).
  var cache = CacheService.getScriptCache(), bad = Number(cache.get('fail:enroll') || 0);
  if (bad >= 50) throw new Error('Too many attempts. Wait ' + LOGIN_LIMITS.minutes + ' minutes, then try again.');
  var props = PropertiesService.getScriptProperties(), token = String(req.setupKey || '');
  var key = /^[a-z0-9]{8,64}$/i.test(token) ? setupLinkKey_(token) : '', rec = null;
  if (key) { try { rec = JSON.parse(props.getProperty(key) || 'null'); } catch (e) {} }
  if (!rec) {
    cache.put('fail:enroll', String(bad + 1), LOGIN_LIMITS.minutes * 60);
    return { ok: false, error: 'This setup link is not valid. Ask the admin for a new one.', notSetUp: true };
  }
  var nonce = /^[A-Za-z0-9-]{8,64}$/.test(String(req.enrollId || '')) ? hmac_('eid|' + req.enrollId, 'DEVICE_SECRET').slice(0, 24) : '';
  var label = String(req.deviceLabel || '').replace(/[^\w .,()\/;:-]/g, '').slice(0, 60);
  if (rec.usedAt) {
    // Same phone retrying (its reply was lost): same device, same key. Anyone else: refused.
    if (nonce && rec.by === nonce && Number(rec.exp) >= Date.now()) return { ok: true, deviceKey: signed_({ d: rec.device, iat: rec.usedAt }, 'DEVICE_SECRET'), replay: true };
    cache.put('fail:enroll', String(bad + 1), LOGIN_LIMITS.minutes * 60);
    audit_({ name: 'unknown phone', role: 'device' }, '', 'DENIED setup link used again', 'device', rec.device, null, null, 'Link first used ' + rec.usedOn + '; new attempt from: ' + label);
    return { ok: false, error: 'This setup link was already used. Ask the admin for a new one.', notSetUp: true };
  }
  if (Number(rec.exp) < Date.now()) {
    props.deleteProperty(key);
    return { ok: false, error: 'This setup link has expired. Ask the admin for a new one.', notSetUp: true };
  }
  var device = 'dev-' + Utilities.getUuid().slice(0, 13), now = now_();
  rec.usedAt = Date.now(); rec.usedOn = now; rec.by = nonce || 'none'; rec.device = device;
  props.setProperty(key, JSON.stringify(rec));
  REQ.device = device;
  upsert_('Devices', device, { deviceId: device, label: label, enrolledAt: now, link: key.slice(4, 12) });
  audit_({ name: 'new phone', role: 'device' }, '', 'device enrolled', 'device', device, null, null, label);
  return { ok: true, deviceKey: signed_({ d: device, iat: rec.usedAt }, 'DEVICE_SECRET') };
}

/** A phone the admin disconnected (Devices tab) cannot sign in or use a session any more. */
function deviceRevoked_(deviceId) {
  if (!db_().getSheetByName('Devices')) return false;   // new code pasted, setup() not run yet: nothing can be disconnected yet
  var d = row_('Devices', deviceId);
  return !!(d && d.revokedAt);
}

function login_(_, req) {
  var dk = unsign_(req.deviceKey, 'DEVICE_SECRET');
  if (!dk || !dk.d) return { ok: false, error: 'This phone is not set up yet. Open the setup link from your admin.', notSetUp: true };
  loginGate_(dk.d);
  if (deviceRevoked_(dk.d)) {
    REQ.device = dk.d;
    audit_({ name: 'disconnected phone', role: 'device' }, '', 'DENIED sign-in from disconnected phone', 'device', dk.d, null, null, '');
    return { ok: false, error: 'This phone was disconnected by the admin. Ask for a new setup link.', notSetUp: true };
  }
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
  return { ok: true, token: signed_({ s: sid, u: u.userId, exp: exp, pv: pinTag_(u.pin) }, 'TOKEN_SECRET'), user: user, expiresAt: exp, serverTime: Date.now(), today: today_() };
}

function logout_(s) {
  upsert_('Sessions', s.sid, { revokedAt: now_(), revokedReason: 'logout' });
  audit_(s.user, s.user.teamId, 'logout', 'session', s.sid, null, null, '');
  return { ok: true };
}

/** Admin: every connected phone with its last sign-in, so a lost or shared phone can be disconnected. */
function devices_(s) {
  var by = {};
  readAll_('Devices').forEach(function (d) { by[d.deviceId] = { deviceId: d.deviceId, label: d.label, enrolledAt: d.enrolledAt, revokedAt: d.revokedAt, revokedBy: d.revokedBy, revokedReason: d.revokedReason }; });
  var names = {};
  readAll_('Users').forEach(function (u) { names[u.userId] = u.name; });
  readAll_('Sessions').forEach(function (x) {
    if (!x.device) return;
    var d = by[x.device] || (by[x.device] = { deviceId: x.device, label: '(connected before the device list)', enrolledAt: '' });
    if (!d.lastSignIn || x.createdAt > d.lastSignIn) { d.lastSignIn = x.createdAt; d.lastUser = names[x.userId] || x.userId; }
    if (!x.revokedAt && Number(x.expiresAt) > Date.now()) d.activeSessions = (d.activeSessions || 0) + 1;
  });
  var list = Object.keys(by).map(function (k) { var d = by[k]; d.thisDevice = k === s.device; d.activeSessions = d.activeSessions || 0; return d; });
  list.sort(function (a, b) { return String(b.lastSignIn || b.enrolledAt).localeCompare(String(a.lastSignIn || a.enrolledAt)); });
  return { ok: true, devices: list };
}

/**
 * Admin: disconnect ONE phone. Its sessions end now and it cannot sign in again without a new setup link.
 * The user's PIN and their other phones are not affected.
 */
function revokeDevice_(s, req) {
  var id = String(req.deviceId || ''), reason = String(req.reason || '').trim().slice(0, 300);
  if (!/^dev-[A-Za-z0-9-]{4,40}$/.test(id)) throw new Error('Choose a phone to disconnect.');
  if (reason.length < 3) throw new Error('Give a reason (kept in the audit log).');
  if (id === s.device) throw new Error('This is the device you are using now — disconnect it from another device.');
  var known = row_('Devices', id), sessions = readAll_('Sessions').filter(function (x) { return x.device === id; });
  if (!known && !sessions.length) throw new Error('Phone not found — refresh the list.');
  if (known && known.revokedAt) return { ok: true, already: true };
  var now = now_(), ended = 0;
  upsert_('Devices', id, { revokedAt: now, revokedBy: s.user.name, revokedReason: reason }, { label: '(connected before the device list)' });
  sessions.forEach(function (x) { if (!x.revokedAt) { upsert_('Sessions', x.sessionId, { revokedAt: now, revokedReason: 'phone disconnected by admin' }); ended++; } });
  audit_(s.user, '', 'device disconnected', 'device', id, null, { sessionsEnded: ended }, reason);
  return { ok: true, sessionsEnded: ended };
}

function userFor_(u) {
  if (u.role === 'admin') return { userId: u.userId, role: 'admin', teamId: '', name: u.name || 'Operations Admin', team: 'All teams · NLEX' };
  var t = row_('Teams', u.teamId) || {};
  return { userId: u.userId, role: 'leadman', teamId: u.teamId, name: u.name, team: t.name || u.teamId, short: t.short || '' };
}

function verify_(token, deviceKey) {
  var p = unsign_(token, 'TOKEN_SECRET');
  if (!p || !p.s || !p.u) throw new Error('AUTH: Please sign in again.');
  if (!p.exp || p.exp < Date.now()) throw new Error('AUTH: Session expired. Please sign in again.');
  var ses = row_('Sessions', p.s);
  if (ses && ses.userId === p.u && deviceRevoked_(ses.device)) throw new Error('DEVICE: This phone was disconnected by the admin. Ask for a new setup link.');
  if (!ses || ses.userId !== p.u || ses.revokedAt || Number(ses.expiresAt) < Date.now()) throw new Error('AUTH: Please sign in again.');
  var u = row_('Users', p.u);
  // Changing a PIN in the Users tab (or setting Active = No) signs that person out everywhere.
  if (!u || u.active === 'No' || pinTag_(u.pin) !== p.pv || (u.role !== 'admin' && u.role !== 'leadman')) throw new Error('AUTH: Please sign in again.');
  if (u.role === 'leadman') { var t = row_('Teams', u.teamId); if (!t || t.active === 'No') throw new Error('AUTH: Please sign in again.'); }
  // Device-bound: the token only works together with the device key of the phone that signed in.
  var dk = unsign_(deviceKey, 'DEVICE_SECRET');
  if (!dk || dk.d !== ses.device) {
    REQ.device = dk && dk.d ? dk.d : 'unknown';
    audit_(userFor_(u), u.teamId || '', 'DENIED session used from another device', 'session', p.s, null, null, 'Token presented without the device key of the phone that signed in');
    throw new Error('AUTH: This sign-in belongs to another phone. Please sign in again.');
  }
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

/**
 * The app sends the revision it last saw. A mismatch means another device (or the admin) saved
 * this report since. The save still goes through (newest save wins), so nobody is ever locked out;
 * the mismatch is written to the audit log so the admin can see what was overwritten.
 */
function needRev_(s, rep, baseRev, action) {
  var cur = rep ? String(rep.rev || '0') : '0', sent = String(baseRev == null ? '' : baseRev);
  if (sent !== cur) {
    audit_(s.user, rep ? rep.teamId : '', 'CONFLICT ' + action, 'report', rep ? rep.reportId : '', { serverRev: cur }, { phoneRev: sent }, 'Changed on another device first; saved anyway (newest save wins)', cur);
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
  if (!isAdmin_(s) && Array.isArray(req.outbox)) notePhoneQueue_(s, req.outbox);
  return {
    ok: true, user: s.user, today: today_(), serverTime: Date.now(),
    teams: teams,
    roster: readAll_('Roster').filter(mine),
    attendance: readAll_('Attendance').filter(function (a) { return a.reportDate >= since && mine(a); }),
    reports: reports,
    photos: photos,
    sheetUrl: isAdmin_(s) ? db_().getUrl() : '',
    phoneQueue: isAdmin_(s) ? phoneQueues_(teams) : {},
    auditFailures: isAdmin_(s) ? auditFailures_() : null,
  };
}

var QUEUE_KINDS = { att: 'Attendance', act: 'Activity report', photo: 'Photo' };
var QUEUE_STATES = { pending: 'Pending sync', syncing: 'Syncing', conflict: 'Conflict', rejected: 'Needs fixing', failed: 'Upload failed' };

/**
 * What a leadman's phone still holds unsent (it reports this each time it loads). Kept for 6 hours
 * in the script cache so the admin can see stuck or conflicting work before it reaches the Sheet.
 */
function notePhoneQueue_(s, list) {
  var items = (Array.isArray(list) ? list : []).slice(0, 20).map(function (x) {
    x = x || {};
    return { kind: QUEUE_KINDS[x.kind] ? x.kind : '', date: validDate_(x.date) ? x.date : '', state: QUEUE_STATES[x.state] ? x.state : '', error: String(x.error || '').slice(0, 160) };
  }).filter(function (x) { return x.kind && x.date && x.state; });
  var cache = CacheService.getScriptCache(), k = 'queue:' + s.user.teamId;
  if (!items.length) { cache.remove(k); return; }
  cache.put(k, JSON.stringify({ at: now_(), by: s.user.name, items: items }), 21600);
}

function phoneQueues_(teams) {
  var cache = CacheService.getScriptCache(), o = {};
  teams.forEach(function (t) { var v = cache.get('queue:' + t.teamId); if (v) { try { o[t.teamId] = JSON.parse(v); } catch (e) {} } });
  return o;
}

function auditFailures_() {
  var v = PropertiesService.getScriptProperties().getProperty('AUDIT_FAILURES'), o = null;
  try { o = v ? JSON.parse(v) : null; } catch (e) {}
  var t = auditTamper_();
  if (t) { o = o || { count: 0 }; o.tamper = t.what + ' (detected ' + t.at + ')'; }
  return o;
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
  // Attendance is locked once the report is submitted, for everyone: reopen it (with a reason) first.
  if (rep && rep.state === 'submitted') throw new Error('Report already submitted. Tap Edit report first to change attendance.');
  needRev_(s, rep, req.baseRev, 'attendance');

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

  var beforeRows = {};
  readAll_('Attendance').forEach(function (a) { if (a.teamId === teamId && a.reportDate === date) beforeRows[a.personId] = a; });
  var hadAttendance = !!(rep && rep.attendanceSubmittedAt);
  var changes = [], was = {}, now_is = {};
  rows.forEach(function (r) {
    var old = beforeRows[r.m.personId];
    if (hadAttendance && (!old || old.status !== r.status || old.note !== r.note)) {
      changes.push(r.m.name + ': ' + (old ? old.status + (old.note ? ' (' + old.note + ')' : '') : 'not marked') + ' → ' + r.status + (r.note ? ' (' + r.note + ')' : ''));
      was[r.m.name] = old ? { status: old.status, note: old.note } : null;
      now_is[r.m.name] = { status: r.status, note: r.note };
    }
  });
  // Sending the same marks again changes nothing and does not bump the revision.
  if (hadAttendance && !changes.length) {
    return { ok: true, unchanged: true, attendanceSubmittedAt: rep.attendanceSubmittedAt, crewPresent: rep.crewPresent, rev: rep.rev, reportId: rep.reportId };
  }
  var reason = String(req.reason || '').trim().slice(0, 500);
  if (hadAttendance && reason.length < 3) {
    return { ok: false, error: 'Give a reason for changing attendance that was already submitted.', needReason: true, missing: ['Reason for the attendance change'] };
  }

  rep = ensureReport_(teamId, date, s.user.name);
  var now = now_(), by = s.user.name;
  if (hadAttendance) revision_(s, rep, 'attendance before update', reason);
  var rev = String(Number(rep.rev || 0) + 1);
  // One write for the whole crew (a Sheets call per person made a first submit slow enough for phones to time out).
  upsertMany_('Attendance', rows.map(function (r) {
    var k = key + '|' + r.m.personId;
    return { key: k, data: {
      key: k, reportId: rep.reportId, reportDate: date, teamId: teamId, personId: r.m.personId, name: r.m.name, role: r.m.role,
      status: r.status, note: r.note, submittedAt: now, submittedBy: by, updatedAt: now, rev: rev,
    }, defaults: { createdAt: now } };
  }));
  var present = rows.filter(function (r) { return r.status === 'Present'; }).length;
  var absentList = rows.filter(function (r) { return r.status !== 'Present'; }).map(function (r) { return r.m.name + ' (' + r.status + (r.note ? ': ' + r.note : '') + ')'; }).join('; ');
  upsert_('DailyReports', key, {
    leadman: leadmen_()[teamId] || rep.leadman, crewPresent: present + '/' + rows.length, absentList: absentList,
    attendanceSubmittedAt: now, updatedAt: now, editedBy: by, rev: rev, lastRequestId: REQ.requestId,
  });
  // Audit: per person old value → new value, who (session user), when (server clock), and why.
  audit_(s.user, teamId, hadAttendance ? 'attendance updated' : 'attendance submitted', 'report', rep.reportId,
    hadAttendance ? was : null,
    hadAttendance ? now_is : { crewPresent: present + '/' + rows.length, notPresent: absentList },
    hadAttendance ? reason + ' — ' + changes.join('; ') : '', rev);
  clientTabs_(s, teamId, null);
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
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error('Photo is too large (6 MB max).');
  if (bytes.length < 100) throw new Error('Photo is empty or damaged — take it again.');
  // The declared type is only a claim: the file's own first bytes must say the same thing.
  var kind = imageKind_(bytes);
  if (!kind || kind !== m[2].toLowerCase()) throw new Error('That file is not a real JPEG, PNG or WebP photo — take it again.');
  // ...and its structure must be a complete, sane image of that type (no truncation, no data hidden after it).
  var dims = imageDims_(bytes, kind);
  if (!dims) {
    audit_(s.user, teamId, 'DENIED photo refused', 'photo', clientId, null, null, 'Damaged or disguised ' + kind + ' (' + bytes.length + ' bytes)');
    throw new Error('That photo file is damaged or not a real photo — take it again.');
  }

  rep = ensureReport_(teamId, date, s.user.name);
  var team = row_('Teams', teamId), now = now_();
  var folder = subFolder_(subFolder_(photoRoot_(), date), team.short || team.teamId);
  var ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
  var photoId = 'ph-' + Utilities.getUuid().slice(0, 13);
  var name = date + '_' + (team.short || team.teamId).replace(/[^A-Za-z0-9]+/g, '') + '_' + req.type.toUpperCase() + '_' + now.slice(11).replace(/:/g, '') + '_' + photoId.slice(3, 9) + '.' + ext;
  // The file stays private (never shared by link): the app shows it through photoView to signed-in users of
  // that team (and admins); the Sheet links to it for the Drive owner.
  var file = folder.createFile(Utilities.newBlob(bytes, m[1], name));
  // Capture time and location come from the phone: kept as its claim, labelled "not verified", and never used
  // for the report date, the audit time or any decision. The server's own time is uploadedAt.
  var captured = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(String(req.capturedAt || '')) ? String(req.capturedAt) : '';
  var location = String(req.location || '').trim().slice(0, 200);
  file.setDescription('Report ' + rep.reportId + ' · ' + team.name + ' · ' + req.type.toUpperCase() + ' · uploaded (server time) ' + now + ' by ' + s.user.name +
    (captured ? ' · phone clock at capture (not verified) ' + captured : '') + (location ? ' · location typed on phone (not verified): ' + location : '') +
    ' · ' + dims.w + '×' + dims.h + ' · original filename: ' + String(req.originalFilename || '').slice(0, 120));

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
    replaced.length ? { photoId: replaced.join(',') } : null, { photoId: photoId, reportId: rep.reportId, bytes: bytes.length }, photo.originalFilename, rep.rev);
  return { ok: true, photo: photo };
}

/** 'jpeg' | 'png' | 'webp' from the file's magic bytes, or '' when it is not one of those. */
function imageKind_(bytes) {
  var b = function (i) { return bytes[i] & 0xFF; };
  if (b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return 'jpeg';
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47 && b(4) === 0x0D && b(5) === 0x0A && b(6) === 0x1A && b(7) === 0x0A) return 'png';
  if (String.fromCharCode(b(0), b(1), b(2), b(3)) === 'RIFF' && String.fromCharCode(b(8), b(9), b(10), b(11)) === 'WEBP') return 'webp';
  return '';
}

var MAX_PHOTO_SIDE = 12000, MIN_PHOTO_SIDE = 16, MAX_PHOTO_PIXELS = 50e6;

/**
 * Walk the file's structure (no pixel decoding: Apps Script has no image decoder) and return its size
 * {w, h}, or null when it is truncated, malformed, has data appended after the image, or has absurd dimensions.
 *  - JPEG: segment chain from SOI through a frame header (SOF) to scan data (SOS), ending exactly at EOI.
 *  - PNG: IHDR first (CRC checked), chunk chain with image data (IDAT) ending exactly at IEND.
 *  - WebP: RIFF size matches the file; VP8 / VP8L / VP8X header with its dimensions.
 */
function imageDims_(bytes, kind) {
  var n = bytes.length, b = function (i) { return bytes[i] & 0xFF; }, w = 0, h = 0, i;
  var u32 = function (i) { return ((b(i) << 24) >>> 0) + (b(i + 1) << 16) + (b(i + 2) << 8) + b(i + 3); };
  if (kind === 'jpeg') {
    var sos = false;
    for (i = 2; i + 4 <= n;) {
      if (b(i) !== 0xFF) return null;
      var mk = b(i + 1);
      if (mk === 0xFF) { i++; continue; }
      if (mk === 0x01 || (mk >= 0xD0 && mk <= 0xD7)) { i += 2; continue; }
      if (mk === 0xD8 || mk === 0xD9) return null;                  // second start, or end before any image data
      var len = (b(i + 2) << 8) | b(i + 3);
      if (len < 2 || i + 2 + len > n) return null;
      if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) { if (len < 8) return null; h = (b(i + 5) << 8) | b(i + 6); w = (b(i + 7) << 8) | b(i + 8); }
      if (mk === 0xDA) { sos = true; break; }
      i += 2 + len;
    }
    if (!sos || !w || !h) return null;
    if (b(n - 2) !== 0xFF || b(n - 1) !== 0xD9) return null;        // must end exactly at EOI (nothing appended)
  } else if (kind === 'png') {
    if (n < 45 || u32(8) !== 13 || String.fromCharCode(b(12), b(13), b(14), b(15)) !== 'IHDR') return null;
    if (crc32_(bytes, 12, 29) !== u32(29)) return null;                 // CRC over "IHDR" + its 13 data bytes
    w = u32(16); h = u32(20);
    var idat = false, end = false;
    for (i = 8; i + 12 <= n;) {
      var clen = u32(i), type = String.fromCharCode(b(i + 4), b(i + 5), b(i + 6), b(i + 7));
      if (clen > n || i + 12 + clen > n || !/^[A-Za-z]{4}$/.test(type)) return null;
      if (type === 'IDAT') idat = true;
      i += 12 + clen;
      if (type === 'IEND') { end = i === n; break; }
    }
    if (!idat || !end) return null;
  } else if (kind === 'webp') {
    var riff = b(4) + (b(5) << 8) + (b(6) << 16) + (b(7) << 24 >>> 0);
    if (riff + 8 !== n || n < 30) return null;
    var fourcc = String.fromCharCode(b(12), b(13), b(14), b(15));
    if (fourcc === 'VP8X') { w = 1 + (b(24) | (b(25) << 8) | (b(26) << 16)); h = 1 + (b(27) | (b(28) << 8) | (b(29) << 16)); }
    else if (fourcc === 'VP8 ') { if (b(23) !== 0x9D || b(24) !== 0x01 || b(25) !== 0x2A) return null; w = (b(26) | (b(27) << 8)) & 0x3FFF; h = (b(28) | (b(29) << 8)) & 0x3FFF; }
    else if (fourcc === 'VP8L') { if (b(20) !== 0x2F) return null; w = 1 + (((b(22) & 0x3F) << 8) | b(21)); h = 1 + (((b(24) & 0x0F) << 10) | (b(23) << 2) | ((b(22) & 0xC0) >> 6)); }
    else return null;
  } else return null;
  if (w < MIN_PHOTO_SIDE || h < MIN_PHOTO_SIDE || w > MAX_PHOTO_SIDE || h > MAX_PHOTO_SIDE || w * h > MAX_PHOTO_PIXELS) return null;
  return { w: w, h: h };
}

function crc32_(bytes, from, to) {
  var c, crc = 0xFFFFFFFF;
  for (var i = from; i < to; i++) {
    c = (crc ^ bytes[i]) & 0xFF;
    for (var k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Sheet cell for a photo: a link to the private Drive file (opens for the Drive owner / people it is shared with). */
function photoCell_(p) {
  if (!p || !/^[\w-]+$/.test(String(p.fileId || ''))) return '';
  return '=HYPERLINK("https://drive.google.com/file/d/' + p.fileId + '/view","' + (p.type === 'after' ? 'After' : 'Before') + ' photo")';
}

/**
 * The photo itself, for the app's preview. Files are private in Drive; the server reads them for a signed-in
 * user of the photo's own team, or an admin. Anyone else is refused and audited.
 */
function photoView_(s, req) {
  var p = row_('Photos', String(req.photoId || ''));
  if (!p) throw new Error('Photo not found — refresh and try again.');
  if (!isAdmin_(s) && p.teamId !== s.user.teamId) deny_(s, 'photoView', 'photo of another team (' + p.photoId + ')');
  var blob;
  try { blob = DriveApp.getFileById(p.fileId).getBlob(); } catch (e) { throw new Error('The photo file could not be opened in Drive.'); }
  var bytes = blob.getBytes();
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error('Photo too large to preview.');
  return { ok: true, photoId: p.photoId, dataUrl: 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(bytes) };
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
  needRev_(s, old, req.baseRev, 'submit');

  var present = null, errs = [];
  if (!old || !old.attendanceSubmittedAt) errs.push('Submit attendance first (Attendance tab)');
  else {
    // Everyone on the crew today must have a verified status (someone added after attendance was sent counts too).
    var att = attendanceFor_(teamId, date), marked = {};
    att.forEach(function (a) { if (ATT_STATUSES.indexOf(a.status) >= 0) marked[a.personId] = true; });
    var unmarked = readAll_('Roster').filter(function (m) { return m.teamId === teamId && m.status === 'Active' && !marked[m.personId]; }).map(function (m) { return m.name; });
    if (unmarked.length) errs.push('Attendance is missing for: ' + unmarked.join(', ') + ' — update attendance first');
    present = att.filter(function (a) { return a.status === 'Present'; }).length;
  }
  var v = validateReport_(f, { present: present }), clean = v.clean;
  errs = errs.concat(v.errs);

  // The photos must be exactly the ones this report holds on the server.
  var before = activePhoto_(teamId, date, 'before'), after = activePhoto_(teamId, date, 'after');
  if (!before) errs.push('Add a Before Work photo');
  if (clean.status === 'Complete' && !after) errs.push('Add an After Work photo (required when Complete)');
  if (errs.length) return { ok: false, error: 'Cannot submit yet: ' + errs.join('; '), missing: errs };
  // The phone names each photo by the server ID, or (queued offline) by its own photo ID.
  var same = function (p, id, cid) { return p ? (String(id || '') === p.photoId || (!!cid && String(cid) === p.clientId)) : !id && !cid; };
  // Photos replaced on another device: the report uses the photos the server holds now (the newest), and the admin can see it in the audit log.
  if (!same(before, req.beforePhotoId, req.beforeClientId) || !same(after, req.afterPhotoId, req.afterClientId)) {
    audit_(s.user, teamId, 'CONFLICT photos', 'report', old.reportId, { phoneBefore: String(req.beforePhotoId || req.beforeClientId || ''), phoneAfter: String(req.afterPhotoId || req.afterClientId || '') },
      { before: before.photoId, after: after ? after.photoId : '' }, 'Photos changed on another device; submitted with the newest photos', old.rev);
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
    beforePreview: photoCell_(before), afterPreview: photoCell_(after),
    submittedAt: now, submittedBy: s.user.name, updatedAt: now, editedBy: s.user.name,
    version: String((Number(old.version) || 0) + 1), rev: String((Number(old.rev) || 0) + 1),
    firstSubmittedAt: first, late: (first.slice(0, 10) > date || first.slice(11, 16) > LATE_CUTOFF) ? 'Yes' : 'No',
    lastRequestId: REQ.requestId,
  };
  REPORT_FIELDS.forEach(function (k) { row[k] = clean[k]; });
  upsert_('DailyReports', key, row);
  var rep = row_('DailyReports', key);
  revision_(s, rep, 'submitted', row.version === '1' ? '' : changes.join('; '));
  accUpdate_(s, rep);
  clientTabs_(s, rep.teamId, rep);
  audit_(s.user, teamId, row.version === '1' ? 'report submitted' : 'report resubmitted (v' + row.version + ')', 'report', rep.reportId,
    old.version > 0 ? beforeVals : null, afterVals, (old.reopenReason && row.version !== '1' ? 'Reopened because: ' + old.reopenReason + ' — ' : '') + (changes.length ? changes.join('; ') : (row.version === '1' ? clean.status + ' · ' + short_(clean.location) : 'no field changes')), row.rev);
  return { ok: true, submittedAt: now, submittedBy: s.user.name, version: row.version, rev: row.rev, reportId: rep.reportId, late: row.late };
}

function reopenReport_(s, req) {
  var teamId = teamFor_(s, req.teamId), date = writableDate_(s, req.reportDate);
  var key = teamId + '|' + date, old = row_('DailyReports', key);
  if (!old || old.state !== 'submitted') throw new Error('This report is not submitted, so there is nothing to reopen.');
  var reason = String(req.reason || '').trim().slice(0, 500);
  if (reason.length < 3) throw new Error('Give a reason for editing the submitted report.');
  if (REQ.requestId && old.lastRequestId === REQ.requestId) return { ok: true, replay: true, rev: old.rev };
  needRev_(s, old, req.baseRev, 'reopen');
  revision_(s, old, 'reopened', reason);
  var rev = String(Number(old.rev || 0) + 1);
  upsert_('DailyReports', key, { state: 'draft', updatedAt: now_(), editedBy: s.user.name, rev: rev, reopenReason: reason, lastRequestId: REQ.requestId });
  audit_(s.user, teamId, 'report reopened for editing', 'report', old.reportId, { state: 'submitted', version: old.version, rev: old.rev }, { state: 'draft', rev: rev }, reason, rev);
  return { ok: true, rev: rev };
}

// ════════════════════════════════════════════════════════════════════════════
// Accomplishment Report tab — same layout as the team's "Bridge Team Accomplishment Report"
// (Weekly Report) sheet, filled automatically: one row per submitted report, updated in place
// when a report is edited and submitted again. Column P (hidden) holds the report ID.
// ════════════════════════════════════════════════════════════════════════════

var ACC_TAB = 'Accomplishment Report';
var ACC_TITLE = 'Bridge Team Accomplishment Report | NLEX';
var ACC_HEAD = ['#', 'Date', 'From', 'To', 'Location', 'Activity', 'Status', 'Before', 'After', 'Qty', 'Equipment', 'Qty', 'Manpower', 'Qty', 'Leadman/Driver', 'Report ID'];
var ACC_FIRST_ROW = 4;

/** The tab, created with its title and two header rows if missing. Never clears existing rows. */
function accSheet_() {
  var ss = db_(), sh = ss.getSheetByName(ACC_TAB);
  if (sh && sh.getLastRow() >= 3) return sh;
  if (!sh) sh = ss.insertSheet(ACC_TAB);
  var navy = '#0F2540';
  sh.getRange(1, 1, 1, 15).merge().setValue(ACC_TITLE).setFontWeight('bold').setFontSize(14).setHorizontalAlignment('center').setBackground(navy).setFontColor('#FFFFFF');
  sh.getRange(2, 1, 1, 16).setValues([['#', 'Schedule', '', '', 'Activities', '', '', 'Photos', '', 'Actual Resources Deploy for the Week', '', '', '', '', '', '']]);
  [[2, 2, 3], [2, 5, 3], [2, 8, 2], [2, 10, 6]].forEach(function (m) { sh.getRange(m[0], m[1], 1, m[2]).merge(); });
  sh.getRange(3, 1, 1, ACC_HEAD.length).setValues([ACC_HEAD]);
  sh.getRange(2, 1, 2, ACC_HEAD.length).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#DDE4EE').setFontColor(navy);
  sh.setFrozenRows(3);
  [40, 90, 55, 55, 220, 260, 90, 130, 130, 40, 90, 40, 200, 40, 130].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.hideColumns(16);
  return sh;
}

/** Row values for one report, in the tab's column order. */
function accValues_(r) {
  var photos = {};
  readAll_('Photos').forEach(function (p) { photos[p.photoId] = p; });
  var img = function (id) { return photoCell_(photos[id]); };
  // Who was present that day (including anyone removed from the crew since), leadman in his own column.
  var crew = readAll_('Attendance').filter(function (a) { return a.teamId === r.teamId && a.reportDate === r.reportDate && a.status === 'Present' && a.role !== 'Leadman'; })
    .map(function (a) { return safeCell_(a.name); });
  return [r.reportDate, r.fromTime, r.toTime, safeCell_(r.location), safeCell_(r.activityDetails), String(r.status || '').toUpperCase(),
    img(r.beforePhotoId), img(r.afterPhotoId), r.plateNumber ? '1' : '', safeCell_(r.plateNumber), String(crew.length), crew.join('\n'), r.leadman ? '1' : '', safeCell_(r.leadman), r.reportId];
}

/** Write (or rewrite) the row for this report. */
function accWrite_(r) {
  var sh = accSheet_(), last = sh.getLastRow(), row = 0;
  if (last >= ACC_FIRST_ROW) {
    var ids = sh.getRange(ACC_FIRST_ROW, 16, last - ACC_FIRST_ROW + 1, 1).getDisplayValues();
    for (var i = 0; i < ids.length; i++) if (ids[i][0] === r.reportId) { row = ACC_FIRST_ROW + i; break; }
  }
  if (!row) row = Math.max(last + 1, ACC_FIRST_ROW);
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  var v = accValues_(r);
  // Text format keeps dates, times and plate numbers exactly as entered; the photo columns stay General for the photo links.
  sh.getRange(row, 1, 1, ACC_HEAD.length).setNumberFormats([ACC_HEAD.map(function (h, i) { return i === 7 || i === 8 ? 'General' : '@'; })]);
  sh.getRange(row, 1, 1, ACC_HEAD.length).setValues([[String(row - ACC_FIRST_ROW + 1)].concat(v)]);
  sh.getRange(row, 1, 1, ACC_HEAD.length).setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(row, 110);
  return row;
}

/** After a report is submitted: update its row. A failure here never undoes the submit, but is recorded. */
function accUpdate_(s, rep) {
  try { accWrite_(rep); }
  catch (e) {
    Logger.log('Accomplishment Report update failed: ' + e);
    audit_(s.user, rep.teamId, 'accomplishment report update failed', 'report', rep.reportId, null, null, String(e && e.message || e).slice(0, 300), rep.rev);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Client report tabs — the per-team layouts from the client workbook (BRIDGE NLEX SAMPLE.xlsx):
//   "<team>" activity tab   one row per submitted report (Days, Date, From, To, Location, ...)
//   "Attendance <team>"     a month grid: crew × day, 1 = present, 0 = not present, totals,
//                           equipment and vehicle rows
// Both are rewritten automatically from the app's data; nobody types into them.
// ════════════════════════════════════════════════════════════════════════════

// Per-team activity tabs. `acc` = the accomplishment columns' headings; `kind` says where the
// accomplishment goes in Bridge_Conso: 'station' → Target/Actual (KM) Station (I/J), 'km' → V/W, 'loc' → X/Y.
var TEAM_TABS = [
  { tab: 'Bridge RM_Team 1', teams: ['team1'], acc: ['Target (KM)', 'Actual (KM)'], kind: 'km' },
  { tab: 'Segment 10 Scupper Drain', teams: ['team2'], acc: ['Target (KM)\nStation', 'Actual (KM)\nStation'], kind: 'station' },
  { tab: 'Bridge Epoxy', teams: ['team3', 'team4'], acc: ['Target (Loc)', 'Actual (Loc)'], kind: 'loc', upperLeadman: true },
];
var ATTENDANCE_TABS = [
  { tab: 'Attendance Bridge RM', teams: ['team1'], label: 'Bridge RM', equipTitle: 'BRIDGE RM EQUIPMENT', vehicleTitle: 'BRIDGE RM VEHICLE',
    equipment: [['Grass Cutter', '', 1], ['Pressure washer', '', 1]], vehicles: [['NFJ 6654', 'team1']] },
  { tab: 'Attendance Segment 10', teams: ['team2'], label: 'Segment 10', equipTitle: 'BRIDGE SEG 10 EQUIPMENT', vehicleTitle: 'BRIDGE SEG 10 VEHICLE',
    equipment: [['Grass Cutter', '', 1], ['Pressure washer', '', 1]], vehicles: [['NKU 8624', 'team2']] },
  { tab: 'Attendance Epoxy 1-2', teams: ['team3', 'team4'], label: 'Bridge Epoxy 1', equipTitle: 'BRIDGE EPOXY 1-2 EQUIPMENT', vehicleTitle: 'BRIDGE EPOXY 1-2 SERVICE VEHICLE',
    // [name, code, value on a work day] — the app does not track equipment yet, so these are the usual values.
    equipment: [['Genset Optimax 5kva', 'RM-GS-1', 1], ['Wagner Epoxy injection pump', 'RM-IJM-01', 0], ['Bosch Grinder GWS060', 'RM-G-01', 1],
      ['Bosch Blower', 'RM-HBM-01', 0], ['Bosch Rotary drill GBH2-24 RE', 'RM-RD-01', 0]],
    vehicles: [['EPOXY 1 - NCG 5500', 'team3'], ['EPOXY 2 - NEO 5124', 'team4']] },
];
var CONSO_TAB = 'Bridge_Conso', MONTHLY_TAB = 'Monthly Summary(Raw)', SUMMARY_TAB = 'Summary per Activity';
var ATT_TITLE = 'BRIDGE CONNECTOR NLEX - ACCOMPLISHMENT REPORT';
var ATT_SLOTS = { Skilled: 2, Crew: 6 };            // per team: 1 driver/leadman + 2 skilled + 6 non-skilled = 9
var TR_COLS = 22;                                   // 21 client columns + hidden Report ID
var CONSO_COLS = 27;                                // 26 client columns + hidden Report ID
var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Full names as they appear in the client's attendance sheets.
var REPORT_NAMES = {
  'team1-pijay-tanjeco': 'TANJECO, PIJAY C.', 'team1-justin-billones': 'BILLONES, JUSTIN B.', 'team1-ignacio-alcoriza-jr': 'ALCORIZA, IGNACIO JR. C.',
  'team1-alvin-angelo': 'ANGELO, ALVIN G.', 'team1-joven-blanza': 'BLANZA, JOVEN B.', 'team1-rocky-miranda': 'MIRANDA, ROCKY B.',
  'team1-richard-candelaria': 'CANDELARIA, RICHARD S.', 'team1-crisostomo-sebuc': 'SEBUC, CRISOSTOMO G.',
  'team2-glenn-butiong': 'BUTIONG, GLENN A.', 'team2-glen-jorick-de-mesa': 'DE MESA, GLEN JORICK M.', 'team2-justine-gregg-baylon': 'BAYLON, JUSTINE GREGG F.',
  'team2-john-christian-bernardo': 'BERNARDO, JOHN CHRISTIAN R.', 'team2-ian-enriquez': 'ENRIQUEZ, IAN T.', 'team2-joanner-royce-quilao': 'QUILAO, JOANNER ROYCE R.',
  'team2-rolando-faustino': 'FAUSTINO, ROLANDO G.', 'team2-richard-santiago': 'SANTIAGO, RICHARD A.', 'team2-abraham-balmeo': 'BALMEO, ABRAHAM P.',
  'team3-allan-miranda': 'MIRANDA, ALLAN P.', 'team3-elmer-dordulo': 'DORDULO, ELMER M.', 'team3-edwin-lozano': 'LOZANO, EDWIN S.',
  'team3-r-jay-john-aquino': 'AQUINO, R-JAY JOHN C.', 'team3-mark-joseph-de-guzman': 'DE GUZMAN, MARK JOSEPH F.', 'team3-edbryan-dela-cruz': 'DELA CRUZ, EDBRYAN P.',
  'team3-mark-ian-dungca': 'DUNGCA, MARK IAN T.', 'team3-johnry-manese': 'MANESE, JOHNRY C.', 'team3-eroll-pangilinan': 'PANGILINAN, EROLL M.',
  'team4-gilbert-rivera': 'RIVERA, GILBERT O.', 'team4-alvin-galang': 'GALANG, ALVIN G.', 'team4-ivan-cabunag': 'CABUNAG, IVAN P.',
  'team4-aj-enriquez': 'ENRIQUEZ, AJ D.', 'team4-jaypee-occidental': 'OCCIDENTAL, JAYPEE T.', 'team4-edgar-ortillo': 'ORTILLO, EDGAR A.',
  'team4-voltaire-rotamula': 'ROTAMULA, VOLTAIRE O.', 'team4-joshua-andrei-tayco': 'TAYCO, JOSHUA ANDREI A.',
};

/** "Justin Billones" → "BILLONES, JUSTIN" (used until the Roster's Report Name is filled in). */
function reportName_(m) {
  if (m && m.reportName) return m.reportName;
  var parts = String(m && m.name || '').trim().split(/\s+/), suffix = '';
  if (parts.length > 2 && /^(jr|sr|ii|iii|iv)\.?$/i.test(parts[parts.length - 1])) suffix = ' ' + parts.pop();
  if (parts.length < 2) return String(m && m.name || '').toUpperCase();
  var last = parts.pop();
  return (last + ', ' + parts.join(' ') + suffix).toUpperCase();
}

function weekday_(iso) { var p = iso.split('-').map(Number); return WEEKDAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()]; }
function monthName_(iso) { return MONTHS[Number(iso.slice(5, 7)) - 1]; }
function teamTab_(teamId) { for (var i = 0; i < TEAM_TABS.length; i++) if (TEAM_TABS[i].teams.indexOf(teamId) >= 0) return TEAM_TABS[i]; return null; }
/** Where a team's accomplishment goes: 'station', 'km' or 'loc' (teams not configured: from their unit). */
function accKind_(teamId) { var t = teamTab_(teamId); if (t) return t.kind; var tm = row_('Teams', teamId); return tm && tm.defaultUnit === 'KM' ? 'km' : 'loc'; }

/** Run after a report, attendance or the crew is saved. A failure never undoes the save, but is recorded. */
function clientTabs_(s, teamId, rep) {
  try {
    if (rep) {
      var t = teamTab_(teamId);
      if (t) sheetRowWrite_(teamReportSheet_(t), TR_COLS, rep.reportId, reportRow_(rep, t));
      sheetRowWrite_(consoSheet_(), CONSO_COLS, rep.reportId, consoRow_(rep));
      monthlyWrite_();
    }
    ATTENDANCE_TABS.forEach(function (cfg) { if (cfg.teams.indexOf(teamId) >= 0) attendanceTabWrite_(cfg); });
  } catch (e) {
    Logger.log('client tab update failed: ' + e);
    audit_(s.user, teamId, 'client report tab update failed', 'report', rep ? rep.reportId : '', null, null, String(e && e.message || e).slice(0, 300), rep ? rep.rev : '');
  }
}

var TR_HEAD = ['Days', 'Date', 'From', 'To', 'Location ', 'Activity', 'Activity Details', 'Status', '', '', 'Before', 'After', 'Target (EQP)', 'Actual (EQP',
  'Plate Number', 'Target (Manpower)', 'Actual (Manpower)', 'Team', 'Target (Leadman)', 'Actual (Leadman)', 'Leadman/Driver'];
var TR_FMT = ['@', 'dd-mmm-yy', 'h:mm AM/PM', 'h:mm AM/PM', '@', '@', '@', '@', 'General', 'General', 'General', 'General', 'General', 'General', '@', 'General', 'General', '@', 'General', 'General', '@'];
var TR_WIDTHS = [15, 22, 10, 9, 32, 20, 34, 15, 18, 18, 34, 35, 19, 18, 21, 28, 34, 35, 25, 23, 24];

function headSheet_(name, head, widths, hideCol) {
  var ss = db_(), sh = ss.getSheetByName(name);
  if (sh && sh.getLastRow() >= 1) return sh;
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sh.setFrozenRows(1);
  (widths || []).forEach(function (w, i) { sh.setColumnWidth(i + 1, Math.round(w * 7)); });
  if (hideCol) sh.hideColumns(hideCol);
  return sh;
}
function teamReportSheet_(t) {
  var head = TR_HEAD.slice(); head[8] = t.acc[0]; head[9] = t.acc[1];
  return headSheet_(t.tab, head.concat(['Report ID']), TR_WIDTHS, TR_COLS);
}
function consoSheet_() {
  var head = TR_HEAD.slice(); head[8] = 'Target (KM)\nStation'; head[9] = 'Actual (KM)\nStation';
  return headSheet_(CONSO_TAB, head.concat(['Target (KM)', 'Actual (KM)', 'Target (Loc)', 'Actual (Loc)', 'Month', 'Report ID']), TR_WIDTHS.concat([14, 14, 14, 14, 12]), CONSO_COLS);
}

/** The shared facts of one report, as the client's sheets show them. */
function reportFacts_(r) {
  var photos = {}, byId = {};
  readAll_('Photos').forEach(function (p) { photos[p.photoId] = p; });
  readAll_('Roster').forEach(function (m) { byId[m.personId] = m; });
  var att = readAll_('Attendance').filter(function (a) { return a.teamId === r.teamId && a.reportDate === r.reportDate; });
  var lead = att.filter(function (a) { return a.role === 'Leadman'; })[0];
  var leadIn = lead ? (lead.status === 'Present' ? '1' : '0') : '';
  var img = function (id) { return photoCell_(photos[id]); };
  var t = teamTab_(r.teamId);
  return {
    crew: att.filter(function (a) { return a.status === 'Present' && a.role !== 'Leadman'; }).map(function (a) { return safeCell_(reportName_(byId[a.personId] || { name: a.name })); }).join('\n'),
    leadIn: leadIn, eqpIn: leadIn,           // the vehicle goes out with its driver/leadman
    before: img(r.beforePhotoId), after: img(r.afterPhotoId),
    leadman: safeCell_(t && t.upperLeadman ? String(r.leadman || '').toUpperCase() : r.leadman),
    status: String(r.status || '').toUpperCase(),
  };
}
function reportRow_(r, t) {
  var f = reportFacts_(r);
  return [weekday_(r.reportDate), r.reportDate, r.fromTime, r.toTime, safeCell_(r.location), safeCell_(r.team), safeCell_(r.activityDetails), f.status,
    r.target, r.actual, f.before, f.after, '1', f.eqpIn, safeCell_(r.plateNumber), r.targetManpower, r.actualManpower, f.crew, '1', f.leadIn, f.leadman, r.reportId];
}
function consoRow_(r) {
  var row = reportRow_(r, teamTab_(r.teamId) || { acc: [] }), kind = accKind_(r.teamId);
  var st = kind === 'station', km = kind === 'km', loc = kind === 'loc';
  row[8] = st ? r.target : ''; row[9] = st ? r.actual : '';
  row.pop();                                                         // report ID goes last, after the extra columns
  return row.concat([km ? r.target : '', km ? r.actual : '', loc ? r.target : '', loc ? r.actual : '', monthName_(r.reportDate), r.reportId]);
}

/** Write (or rewrite) the row keyed by report ID (in the last, hidden column). */
function sheetRowWrite_(sh, ncols, reportId, values) {
  var last = sh.getLastRow(), row = 0;
  if (last >= 2) {
    var ids = sh.getRange(2, ncols, last - 1, 1).getDisplayValues();
    for (var i = 0; i < ids.length; i++) if (ids[i][0] === reportId) { row = 2 + i; break; }
  }
  if (!row) row = Math.max(last + 1, 2);
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  var fmt = TR_FMT.concat(['General', 'General', 'General', 'General', '@', '@', '@']).slice(0, ncols);
  fmt[ncols - 1] = '@';
  var range = sh.getRange(row, 1, 1, ncols);
  range.setNumberFormats([fmt]);
  range.setValues([values]);
  range.setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(row, 160);
  return row;
}

function submittedReports_() {
  return readAll_('DailyReports').filter(function (r) { return r.state === 'submitted' || Number(r.version) > 0; });
}

/** Monthly Summary(Raw): one row per report, grouped by activity, with a Grand Total row. Rewritten each time. */
function monthlyWrite_() {
  var head = ['Date', 'Month', 'Activity', 'Target (Accomplishment)', 'Actual (Accomplishment)', ' Target (EQP)', 'Actual (EQP)', 'Manpower (Target)', 'Manpower (Actual)',
    ' Target (Leadman)', ' Actual (Leadman)', ' Target (Loc)', ' Actual (Loc)'];
  var sh = headSheet_(MONTHLY_TAB, head, [12, 10, 26, 16, 16, 12, 12, 14, 14, 14, 14, 12, 12]);
  var rows = submittedReports_().sort(function (a, b) { return (a.team + a.reportDate).localeCompare(b.team + b.reportDate); }).map(function (r) {
    var f = reportFacts_(r), loc = accKind_(r.teamId) === 'loc';
    return [r.reportDate, monthName_(r.reportDate), safeCell_(String(r.team || '').toUpperCase()), loc ? '' : r.target, loc ? '' : r.actual, '1', f.eqpIn,
      r.targetManpower, r.actualManpower, '1', f.leadIn, loc ? r.target : '', loc ? r.actual : ''];
  });
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, head.length).clearContent();
  var n = rows.length, total = ['Grand Total', '', ''];
  for (var c = 4; c <= head.length; c++) { var L = columnLetter_(c); total.push(n ? '=SUM(' + L + '2:' + L + (n + 1) + ')' : '0'); }
  rows.push(total);
  if (rows.length + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
  var fmt = rows.map(function () { return ['yyyy-mm-dd', '@', '@', 'General', 'General', 'General', 'General', 'General', 'General', 'General', 'General', 'General', 'General']; });
  sh.getRange(2, 1, rows.length, head.length).setNumberFormats(fmt).setValues(rows);
  sh.getRange(rows.length + 1, 1, 1, head.length).setFontWeight('bold');
}

/**
 * Summary per Activity: the client's pivot (sums per activity), as live formulas over Bridge_Conso.
 * Type a month name (e.g. September) in B1 to filter, or All.
 */
function summaryWrite_() {
  var ss = db_(), sh = ss.getSheetByName(SUMMARY_TAB) || ss.insertSheet(SUMMARY_TAB);
  var keepMonth = sh.getLastRow() >= 1 ? String(sh.getRange(1, 2).getDisplayValues()[0][0] || '') : '';
  var acts = readAll_('Teams').filter(function (t) { return t.active !== 'No'; }).map(function (t) { return String(t.name); }).sort(function (a, b) { return a.toUpperCase().localeCompare(b.toUpperCase()); });
  // [heading, Bridge_Conso column]
  var cols = [[' Target (Loc)', 'X'], [' Actual (Loc)', 'Y'], [' Target (KM)', 'V'], [' Actual (KM)', 'W'], [' Target (EQP)', 'M'], [' Actual (EQP', 'N'],
    [' Target (Manpower)', 'P'], [' Actual (Manpower)', 'Q'], [' Target (Leadman)', 'S'], [' Actual (Leadman)', 'T']];
  var grid = [['Date', keepMonth || 'All', 'Type a month name (e.g. September) or All'].concat(cols.slice(2).map(function () { return ''; })), cols.map(function () { return ''; }).concat(['']), ['Activity'].concat(cols.map(function (c) { return c[0]; }))];
  var crit = 'IF($B$1="All","*",$B$1)';
  acts.forEach(function (a, i) {
    var r = 4 + i;
    grid.push([safeCell_(a.toUpperCase().indexOf('EPOXY') >= 0 ? a.toUpperCase() : a)].concat(cols.map(function (c) {
      return '=SUMIFS(\'' + CONSO_TAB + '\'!$' + c[1] + ':$' + c[1] + ',\'' + CONSO_TAB + '\'!$F:$F,$A' + r + ',\'' + CONSO_TAB + '\'!$Z:$Z,' + crit + ')';
    })));
  });
  var end = 3 + acts.length;
  grid.push(['Grand Total'].concat(cols.map(function (c, j) { var L = columnLetter_(j + 2); return '=SUM(' + L + '4:' + L + end + ')'; })));
  sh.clearContents();
  if (sh.getMaxRows() < grid.length) sh.insertRowsAfter(sh.getMaxRows(), grid.length - sh.getMaxRows());
  sh.getRange(1, 1, grid.length, cols.length + 1).setValues(grid);
  sh.getRange(3, 1, 1, cols.length + 1).setFontWeight('bold');
  sh.getRange(grid.length, 1, 1, cols.length + 1).setFontWeight('bold');
  sh.setColumnWidth(1, 200);
}

function columnLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/** Rewrite an attendance grid (people × days, one block per team) from the Attendance tab. */
function attendanceTabWrite_(cfg) {
  var ss = db_(), sh = ss.getSheetByName(cfg.tab) || ss.insertSheet(cfg.tab);
  var marks = {}, dates = {}, teamDates = {};
  readAll_('Attendance').forEach(function (a) {
    if (cfg.teams.indexOf(a.teamId) < 0) return;
    marks[a.personId + '|' + a.reportDate] = a.status === 'Present' ? 1 : 0;
    dates[a.reportDate] = true; teamDates[a.teamId + '|' + a.reportDate] = true;
  });
  // Columns: from the 1st of the first month with attendance to the end of the current month.
  var first = Object.keys(dates).sort()[0] || today_(), start = first.slice(0, 8) + '01';
  var end = shiftDate_(shiftDate_(today_().slice(0, 8) + '01', 32).slice(0, 8) + '01', -1), days = [];
  for (var d = start; d <= end; d = shiftDate_(d, 1)) days.push(d);
  var width = 3 + days.length;
  var blank = function () { var r = []; for (var i = 0; i < width; i++) r.push(''); return r; };
  var line = function (a, b, c, vals) { return [a, b, c].concat(vals); };
  var grid = [blank(), line(ATT_TITLE, '', '', days), line('No.', cfg.label, 'NAME', days.map(weekday_))];
  var val = function (m, dd) { var x = m ? marks[m.personId + '|' + dd] : undefined; return x === undefined ? '' : x; };
  var workDay = function (dd) { return !!dates[dd]; };
  var all = [], leadOf = {};
  // One block per team: leadman, then skilled and crew slots (at least 2 and 6), including anyone archived who worked in the period.
  cfg.teams.forEach(function (teamId, bi) {
    var roster = readAll_('Roster').filter(function (m) { return m.teamId === teamId; });
    var worked = function (m) { return m.status === 'Active' || days.some(function (dd) { return marks[m.personId + '|' + dd] !== undefined; }); };
    var group = function (role) { return roster.filter(function (m) { return m.role === role && worked(m); }); };
    var slots = group('Leadman').map(function (m) { return ['Driver/Leadman', m]; });
    if (!slots.length) slots.push(['Driver/Leadman', null]);
    leadOf[teamId] = slots[0][1];
    ['Skilled', 'Crew'].forEach(function (role) { var g = group(role); for (var i = 0; i < Math.max(ATT_SLOTS[role], g.length); i++) slots.push([role, g[i] || null]); });
    if (bi > 0) grid.push(blank());
    slots.forEach(function (sl, i) {
      grid.push(line(String(i + 1), sl[0], sl[1] ? safeCell_(reportName_(sl[1])) : '', days.map(function (dd) { return val(sl[1], dd); })));
    });
    all = all.concat(slots);
  });
  var total = function (role) { return days.map(function (dd) { if (!workDay(dd)) return ''; var n = 0; all.forEach(function (sl) { if (sl[0] === role && sl[1]) n += Number(val(sl[1], dd) || 0); }); return n; }); };
  grid.push(blank(), blank());
  grid.push(line('TOTAL MANPOWER REQUIRED', '', '', days.map(function (dd) { return workDay(dd) ? cfg.teams.length * (1 + ATT_SLOTS.Skilled + ATT_SLOTS.Crew) : ''; })));
  grid.push(line('Driver (6 days, day shift, 8 hours shift per pax) ', '', '', total('Driver/Leadman')));
  grid.push(line('Skilled labor (6 days, 8 hours shift per pax) AM shift', '', '', total('Skilled')));
  grid.push(line('Non-Skilled labor (6 days, 8 hours shift per pax) AM shift', '', '', total('Crew')));
  grid.push(blank(), blank());
  grid.push(line(cfg.equipTitle, '', '', days.map(function () { return ''; })));
  cfg.equipment.forEach(function (eq, i) { grid.push(line(String(i + 1), eq[0], eq[1], days.map(function (dd) { return workDay(dd) ? eq[2] : ''; }))); });
  grid.push(blank());
  grid.push(line('', cfg.vehicleTitle, '', days.map(function () { return ''; })));
  cfg.vehicles.forEach(function (v, i) { grid.push(line(String(i + 1), v[0], '', days.map(function (dd) { return val(leadOf[v[1]], dd); }))); });

  sh.clearContents();
  if (sh.getMaxRows() < grid.length) sh.insertRowsAfter(sh.getMaxRows(), grid.length - sh.getMaxRows());
  sh.getRange(1, 1, grid.length, width).setValues(grid);
  sh.getRange(2, 4, 1, days.length).setNumberFormat('d-mmm-yy');
  sh.getRange(2, 1, 1, 3).merge();
  sh.getRange(2, 1, 2, width).setFontWeight('bold').setHorizontalAlignment('center');
  sh.setFrozenRows(3);
  return grid.length;
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
  clientTabs_(s, teamId, null);
  return { ok: true, personId: id };
}

function archiveMember_(s, req) {
  var m = row_('Roster', String(req.personId || ''));
  if (!m) throw new Error('Person not found');
  if (m.role === 'Leadman') throw new Error('The leadman cannot be removed here — change the leadman in the Users tab.');
  var now = now_();
  upsert_('Roster', m.personId, { status: 'Archived', archivedAt: now, updatedAt: now, editedBy: s.user.name });
  audit_(s.user, m.teamId, 'crew archived', 'person', m.personId, { status: m.status }, { status: 'Archived' }, m.name + ' (attendance history kept)');
  clientTabs_(s, m.teamId, null);
  return { ok: true };
}

function restoreMember_(s, req) {
  var m = row_('Roster', String(req.personId || ''));
  if (!m) throw new Error('Person not found');
  upsert_('Roster', m.personId, { status: 'Active', archivedAt: '', updatedAt: now_(), editedBy: s.user.name });
  audit_(s.user, m.teamId, 'crew restored', 'person', m.personId, { status: m.status }, { status: 'Active' }, m.name);
  clientTabs_(s, m.teamId, null);
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
  var revCount = {};
  readAll_('Revisions').forEach(function (v) { revCount[v.reportId] = (revCount[v.reportId] || 0) + 1; });
  var head = ['Date', 'Report ID', 'Revision', 'Version', 'Team', 'Leadman', 'State', 'Late', 'From', 'To', 'Location', 'Activity Details', 'Status', 'Target', 'Actual', 'Unit',
    'Target Manpower', 'Actual Manpower', 'Crew Present', 'Not Present (status)', 'Equipment / Plate', 'Remarks',
    'Before Photo', 'After Photo', 'Attendance Submitted', 'First Submitted', 'Report Submitted', 'Submitted By', 'Saved Revisions', 'Last Reopen Reason'];
  var rows = readAll_('DailyReports').filter(function (x) { return x.reportDate >= from && x.reportDate <= to; })
    .sort(function (a, b) { return a.reportDate === b.reportDate ? a.teamId.localeCompare(b.teamId) : a.reportDate.localeCompare(b.reportDate); })
    .map(function (x) {
      var bp = photos[x.beforePhotoId], ap = photos[x.afterPhotoId];
      return [x.reportDate, x.reportId, x.rev || '0', x.version || '0', x.team, x.leadman, x.state === 'submitted' ? 'Submitted' : (x.attendanceSubmittedAt ? 'Draft (attendance only)' : 'Draft'), x.late,
        x.fromTime, x.toTime, x.location, x.activityDetails, x.status, x.target, x.actual, x.unit,
        x.targetManpower, x.actualManpower, x.crewPresent, x.absentList, x.plateNumber, x.remarks,
        bp ? bp.fileUrl : '', ap ? ap.fileUrl : '', x.attendanceSubmittedAt, x.firstSubmittedAt, x.submittedAt, x.submittedBy, String(revCount[x.reportId] || 0), x.reopenReason];
    });
  var csv = [head].concat(rows).map(function (x) { return x.map(csvCell_).join(','); }).join('\r\n');
  var name = 'NLEX_Daily_Report_' + from + '_to_' + to;
  var x = exportXlsx_(name, [head].concat(rows));
  audit_(s.user, '', 'export', 'export', '', null, { from: from, to: to, rows: rows.length }, x.error ? 'xlsx failed: ' + x.error : '');
  return { ok: true, csv: csv, rows: rows.length, from: from, to: to, filename: name + '.csv', xlsxUrl: x.url, xlsxError: x.error };
}

/**
 * The same rows as the CSV, in a Google Sheet of their own (in the photo folder's "Exports"
 * subfolder), so the .xlsx download never contains the Users, Sessions or AuditLog tabs.
 */
function exportXlsx_(name, grid) {
  try {
    var x = SpreadsheetApp.create(name), sh = x.getSheets()[0];
    var safe = grid.map(function (r) { return r.map(safeCell_); });
    sh.getRange(1, 1, safe.length, safe[0].length).setNumberFormats(safe.map(function (r) { return r.map(function () { return '@'; }); })).setValues(safe);
    DriveApp.getFileById(x.getId()).moveTo(subFolder_(photoRoot_(), 'Exports'));
    return { url: 'https://docs.google.com/spreadsheets/d/' + x.getId() + '/export?format=xlsx', error: '' };
  } catch (e) {
    Logger.log('xlsx export failed: ' + e);
    return { url: '', error: String(e && e.message || e).slice(0, 200) };
  }
}

/** Every team × day in the range: submitted / draft / missing, late, attendance and photo completeness. */
function adminReports_(s, req) {
  var r = range_(req, 62);
  var reports = {}, att = {}, photos = {}, revs = {};
  readAll_('DailyReports').forEach(function (x) { if (x.reportDate >= r.from && x.reportDate <= r.to) reports[x.teamId + '|' + x.reportDate] = x; });
  readAll_('Attendance').forEach(function (a) { if (a.reportDate >= r.from && a.reportDate <= r.to) { var k = a.teamId + '|' + a.reportDate; att[k] = (att[k] || 0) + 1; } });
  readAll_('Photos').forEach(function (p) { if (p.status === 'Active' && p.reportDate >= r.from && p.reportDate <= r.to) { var k = p.teamId + '|' + p.reportDate; photos[k] = (photos[k] || 0) + 1; } });
  readAll_('Revisions').forEach(function (v) { revs[v.reportId] = (revs[v.reportId] || 0) + 1; });
  var conflicts = {};
  readAll_('AuditLog').forEach(function (a) { if (/^CONFLICT /.test(a.action) && a.entityId) conflicts[a.entityId] = (conflicts[a.entityId] || 0) + 1; });
  var roster = {};
  readAll_('Roster').forEach(function (m) { if (m.status === 'Active') roster[m.teamId] = (roster[m.teamId] || 0) + 1; });
  var leadOf = leadmen_(), out = [];
  var teams = readAll_('Teams').filter(function (t) { return t.active !== 'No'; });
  var queues = phoneQueues_(teams);
  for (var d = r.to; d >= r.from; d = shiftDate_(d, -1)) {
    teams.forEach(function (t) {
      var k = t.teamId + '|' + d, x = reports[k] || {};
      var q = queues[t.teamId], onPhone = q ? q.items.filter(function (i) { return i.date === d; }) : [];
      var state = x.state === 'submitted' ? 'Submitted' : x.attendanceSubmittedAt ? 'Draft' : 'Missing';
      var overdue = state !== 'Submitted' && (d < today_() || now_().slice(11, 16) > LATE_CUTOFF);
      out.push({ reportDate: d, teamId: t.teamId, team: t.name, leadman: x.leadman || leadOf[t.teamId] || '', reportId: x.reportId || '',
        state: state, late: x.late === 'Yes' || overdue, overdue: overdue, version: x.version || '0', revisions: x.reportId ? (revs[x.reportId] || 0) : 0,
        attendanceRows: att[k] || 0, rosterSize: roster[t.teamId] || 0, crewPresent: x.crewPresent || '', photos: photos[k] || 0,
        photosNeeded: x.status === 'Complete' ? 2 : 1, status: x.status || '', location: x.location || '', submittedAt: x.submittedAt || '', firstSubmittedAt: x.firstSubmittedAt || '',
        rev: x.rev || '0', conflicts: x.reportId ? (conflicts[x.reportId] || 0) : 0, reopened: !!x.reopenReason && x.state !== 'submitted',
        onPhone: onPhone.map(function (i) { return QUEUE_KINDS[i.kind] + ': ' + QUEUE_STATES[i.state] + (i.error ? ' (' + i.error + ')' : ''); }), onPhoneAt: onPhone.length ? q.at : '' });
    });
  }
  return { ok: true, from: r.from, to: r.to, rows: out, auditFailures: auditFailures_() };
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

/**
 * upsert_ for many rows: existing rows are updated one by one (as upsert_), new rows are appended with a
 * single format + write call. `list`: [{ key, data, defaults }].
 */
function upsertMany_(name, list) {
  readAll_(name);
  var has = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined; };
  var fresh = list.filter(function (x) { return CACHE[name].index[x.key] == null; });
  list.forEach(function (x) { if (CACHE[name].index[x.key] != null) upsert_(name, x.key, x.data, x.defaults); });
  if (!fresh.length) return;
  var sh = sheet_(name), cols = TABLES[name], kf = KEY_FIELD[name];
  var first = CACHE[name].rows.length + 2, last = first + fresh.length - 1;
  if (last > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), Math.max(500, last - sh.getMaxRows()));
  formatRows_(sh, name, first, fresh.length);
  var merged = fresh.map(function (x) {
    var m = {};
    cols.forEach(function (c) { var k = c[0]; m[k] = k === kf ? x.key : has(x.data, k) ? x.data[k] : has(x.defaults, k) ? x.defaults[k] : ''; });
    return m;
  });
  sh.getRange(first, 1, merged.length, cols.length).setValues(merged.map(function (m) {
    return cols.map(function (c) { var v = m[c[0]] == null ? '' : String(m[c[0]]); return FORMULA_FIELDS[c[0]] ? v : safeCell_(v); });
  }));
  merged.forEach(function (m) {
    var stored = {};
    cols.forEach(function (c) { stored[c[0]] = FORMULA_FIELDS[c[0]] ? '' : String(m[c[0]] == null ? '' : m[c[0]]); });
    CACHE[name].index[m[kf]] = CACHE[name].rows.length; CACHE[name].rows.push(stored);
  });
}

function deleteRow_(name, key) {
  readAll_(name);
  var i = CACHE[name].index[key];
  if (i == null) return;
  sheet_(name).deleteRow(i + 2);
  delete CACHE[name];
}

/** Latest audit row count + hash, HMAC-signed, in script properties (Sheet editors cannot change it). */
function auditCheckpoint_() {
  var v = PropertiesService.getScriptProperties().getProperty('AUDIT_CHECKPOINT'), cp = null;
  if (!v) return null;
  try { cp = JSON.parse(v); } catch (e) { return { valid: false }; }
  cp.valid = !!cp && cp.sig === hmac_('cp|' + cp.n + '|' + cp.h, 'AUDIT_SECRET');
  return cp;
}
function auditTamper_() {
  var v = PropertiesService.getScriptProperties().getProperty('AUDIT_TAMPER');
  try { return v ? JSON.parse(v) : null; } catch (e) { return { at: '?', what: 'unreadable tamper record' }; }
}

function auditHash_(prev, a) {
  var body = [prev, a.auditId, a.at, a.user, a.role, a.teamId, a.action, a.entity, a.entityId, a.before, a.after, a.reason, a.requestId, a.device].join('␞');
  // User ID and revision were added later: rows written before that keep their original hash.
  if (a.userId || a.rev) body += '␞' + (a.userId || '') + '␞' + (a.rev || '');
  return hmac_(body, 'AUDIT_SECRET').slice(0, 24);
}

/**
 * Append one audit entry: who (name, role, user ID), what, when (server clock), which entity and report
 * revision, before/after, reason. Rows are only ever
 * appended; each carries a hash of the previous one, so verifyAuditLog() spots hand edits.
 */
function audit_(user, teamId, action, entity, entityId, before, after, reason, rev) {
  var lock = null;
  try {
    if (!LOCKED) { lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) lock = null; }
    var sh = sheet_('AuditLog'), last = sh.getLastRow(), props = PropertiesService.getScriptProperties();
    var prev = last > 1 ? String(sh.getRange(last, col_('AuditLog', 'hash')).getDisplayValues()[0][0] || '') : '';
    // The log must still end where the app last left it; otherwise rows were deleted, added or replaced by hand.
    // The warning stays (admin screen + verifyAuditLog) even after new rows are appended.
    var cp = auditCheckpoint_();
    if (cp && (!cp.valid || cp.n !== last - 1 || cp.h !== prev) && !props.getProperty('AUDIT_TAMPER')) {
      props.setProperty('AUDIT_TAMPER', JSON.stringify({ at: now_(), what: !cp.valid ? 'audit checkpoint changed'
        : last - 1 < cp.n ? (cp.n - last + 1) + ' audit entries deleted from the end' : 'audit log does not end where the app left it (' + (last - 1) + ' rows, expected ' + cp.n + ')' }));
    }
    var j = function (o) { return o == null ? '' : (typeof o === 'string' ? o : JSON.stringify(o)).slice(0, 5000); };
    var a = { auditId: 'au-' + Utilities.getUuid().slice(0, 13), at: now_(), user: user.name || '', role: user.role || '', teamId: teamId || '',
      action: action, entity: entity || '', entityId: entityId || '', before: j(before), after: j(after), reason: String(reason || '').slice(0, 2000),
      requestId: REQ.requestId || '', device: REQ.device || '', userId: user.userId || '', rev: rev == null ? '' : String(rev) };
    a.hash = auditHash_(prev, a);
    var row = last + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
    formatRows_(sh, 'AuditLog', row, 1);
    sh.getRange(row, 1, 1, TABLES.AuditLog.length).setValues([TABLES.AuditLog.map(function (c) { return safeCell_(a[c[0]]); })]);
    delete CACHE.AuditLog;
    props.setProperty('AUDIT_CHECKPOINT', JSON.stringify({ n: row - 1, h: a.hash, at: a.at, sig: hmac_('cp|' + (row - 1) + '|' + a.hash, 'AUDIT_SECRET') }));
  } catch (e) {
    // Never silent: the admin screen shows how many audit entries could not be written, and the last error.
    Logger.log('audit failed: ' + e);
    try {
      var props = PropertiesService.getScriptProperties(), prev = auditFailures_() || { count: 0 };
      props.setProperty('AUDIT_FAILURES', JSON.stringify({ count: prev.count + 1, last: now_(), action: action, error: String(e && e.message || e).slice(0, 200) }));
    } catch (e2) {}
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
