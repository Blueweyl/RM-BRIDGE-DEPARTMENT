/**
 * Bridge NLEX Daily Report — backend (Google Sheets + Google Drive + Apps Script).
 *
 * The Google Sheet this script is attached to is the database. Tabs:
 *   Teams         team list: Team ID, Team, Short Name, Leadman, Unit, Active
 *   Roster        crew per team, Active or Archived (edit it here; new rows get a Person ID automatically)
 *   Attendance    one row per person per team per day (history is kept)
 *   Reports       one row per team per day, important columns first, written when the leadman submits
 *   Photos        every photo uploaded to Drive, including replaced ones
 *   Audit         append-only, hash-chained: what happened, when, before/after, reason
 *   + the client report tabs (Accomplishment Report, team tabs, Bridge_Conso, attendance grids), filled automatically
 * Photos live in Drive: "Bridge NLEX Daily Report Photos/<yyyy-mm-dd>/<team>/" and stay private.
 *
 * The field app (frontend/) calls doPost() with JSON. There is no sign-in: the app only lets a
 * leadman pick a team and send that team's daily report. The server checks everything itself
 * (team is active, date is today or yesterday, every field, photos, one report per team per day)
 * and never trusts totals or IDs from the phone.
 *
 * Admin work (reopen a report, export, rebuild tabs, the app link) is NOT in the web API: it runs
 * from the Sheet's own "Daily Report" menu, so only people who can edit the Sheet can do it.
 * See docs/BACKEND.md for the full design.
 */

var TZ = 'Asia/Manila';
var PHOTO_ROOT = 'Bridge NLEX Daily Report Photos';
var APP_ADDRESS = 'https://bridge-nlex-report.netlify.app/';   // where the field app is hosted (Netlify)
// Leave both empty when the script is opened from the Sheet (Extensions → Apps Script).
// Fill them in for a stand-alone script project: the Sheet's ID and the photo folder's ID.
var SHEET_ID = '';
var PHOTO_FOLDER_ID = '';
// Your Web app URL (Deploy → Manage deployments → Web app → Copy). Only needed when the
// "Show the app link" menu says Apps Script gave the wrong address.
var WEB_APP_URL = '';

function db_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}
var MAX_PHOTO_BYTES = 6 * 1024 * 1024;
var MAX_PHOTOS_PER_DAY = 40;                            // per team per day (retakes included)
var ATT_STATUSES = ['Present', 'Sick', 'Leave', 'No Show', 'Other'];
var LATE_CUTOFF = '20:00';                              // submitted after this (or on a later day) = late
var MAX_QTY = { KM: 100, Locations: 100 };
var RECENT_DAYS = 14;                                   // "Previous reports" in the app

// [field key, column header]. Field keys are what the app sends and receives.
var TABLES = {
  Teams: [
    ['teamId', 'Team ID'], ['name', 'Team'], ['short', 'Short Name'], ['leadman', 'Leadman'], ['defaultUnit', 'Unit'], ['active', 'Active'],
  ],
  Roster: [
    ['personId', 'Person ID'], ['teamId', 'Team ID'], ['name', 'Name'], ['role', 'Role'], ['status', 'Status'],
    ['createdAt', 'Created'], ['updatedAt', 'Updated'], ['archivedAt', 'Archived'], ['editedBy', 'Edited By'],
    ['reportName', 'Report Name (LAST, FIRST M.)'],
  ],
  Attendance: [
    ['reportDate', 'Date'], ['team', 'Team'], ['name', 'Name'], ['role', 'Role'], ['status', 'Status'], ['note', 'Reason / Note'],
    ['submittedAt', 'Submitted'], ['teamId', 'Team ID'], ['personId', 'Person ID'], ['reportId', 'Report ID'], ['key', 'Key'],
    ['submittedBy', 'Submitted By'], ['createdAt', 'Created'], ['updatedAt', 'Updated'], ['rev', 'Revision'],
  ],
  Reports: [
    ['reportDate', 'Date'], ['team', 'Team'], ['location', 'Location'], ['activityDetails', 'Activity'], ['status', 'Status'],
    ['crewPresent', 'Present'], ['target', 'Target'], ['actual', 'Actual'], ['unit', 'Unit'],
    ['beforePreview', 'Before'], ['afterPreview', 'After'], ['submittedAt', 'Submitted'],
    ['fromTime', 'Start'], ['toTime', 'End'], ['actualManpower', 'Manpower'], ['absentList', 'Absent'],
    ['plateNumber', 'Equipment / Plate'], ['remarks', 'Remarks'], ['leadman', 'Leadman'], ['late', 'Late'], ['state', 'State'],
    ['reportId', 'Report ID'], ['key', 'Key'], ['teamId', 'Team ID'], ['version', 'Version'], ['rev', 'Revision'],
    ['targetManpower', 'Crew Size'], ['beforePhotoId', 'Before Photo ID'], ['afterPhotoId', 'After Photo ID'],
    ['firstSubmittedAt', 'First Submitted'], ['createdAt', 'Created'], ['updatedAt', 'Updated'], ['submittedBy', 'Submitted By'],
    ['editedBy', 'Edited By'], ['reopenReason', 'Reopen Reason'], ['lastRequestId', 'Request ID'], ['device', 'Device'],
  ],
  Photos: [
    ['photoId', 'Photo ID'], ['teamId', 'Team ID'], ['reportDate', 'Date'], ['type', 'Type'], ['status', 'Status'],
    ['fileId', 'Drive File ID'], ['fileUrl', 'File URL'], ['thumbnailUrl', 'Thumbnail URL'], ['originalFilename', 'Original Filename'],
    ['uploadedAt', 'Uploaded (server time)'], ['uploadedBy', 'Uploaded By'],
    ['reportId', 'Report ID'], ['clientId', 'Client Photo ID'], ['leadman', 'Leadman'], ['location', 'Location (typed on phone, not verified)'],
    ['capturedAt', 'Captured (phone clock, not verified)'], ['bytes', 'Bytes'], ['device', 'Device'],
  ],
  Audit: [
    ['auditId', 'Audit ID'], ['at', 'Time'], ['user', 'User'], ['role', 'Role'], ['teamId', 'Team ID'], ['action', 'Action'],
    ['entity', 'Entity'], ['entityId', 'Entity ID'], ['before', 'Before'], ['after', 'After'], ['reason', 'Reason / Detail'],
    ['requestId', 'Request ID'], ['device', 'Device'], ['hash', 'Chain Hash'], ['userId', 'User ID'], ['rev', 'Report Revision'],
  ],
};
var KEY_FIELD = { Teams: 'teamId', Roster: 'personId', Attendance: 'key', Reports: 'key', Photos: 'photoId' };
var FORMULA_FIELDS = { beforePreview: true, afterPreview: true };
// New header → older headers it replaces, used when setup() upgrades an existing Sheet.
var HEADER_ALIASES = {
  'Reason / Note': ['Note / Reason', 'Absence Reason'], 'Absent': ['Not Present (status)', 'Absent (reason)'], 'Uploaded (server time)': ['Uploaded'],
  'Location (typed on phone, not verified)': ['Location (at capture)'], 'Captured (phone clock, not verified)': ['Captured (phone clock)'],
  'Unit': ['Default Unit'], 'Active': ['Active (Yes/No)'], 'Activity': ['Activity Details'], 'Present': ['Crew Present'],
  'Before': ['Before Photo'], 'After': ['After Photo'], 'Submitted': ['Report Submitted'], 'Start': ['From'], 'End': ['To'],
  'Manpower': ['Actual Manpower'], 'Crew Size': ['Target Manpower'], 'Reopen Reason': ['Last Reopen Reason'], 'Request ID': ['Last Request ID'],
};
// Tabs of the old sign-in system: setup() removes them (after copying each leadman's name into Teams).
var OLD_AUTH_TABS = ['Users', 'Sessions', 'Devices'];
// Old history tabs no longer written: kept, hidden.
var OLD_HIDDEN_TABS = ['Revisions', 'Requests'];
var OLD_SECRETS = ['TOKEN_SECRET', 'PIN_SECRET', 'DEVICE_SECRET', 'LOGIN_LOCKED_UNTIL', 'SETUP_KEY', 'SETUP_KEY_EXPIRES'];

// Real crews. setup() copies them into the Sheet once (only when the tabs are empty).
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
// Sheet menu (admin). Everything here runs as the person using the Sheet, never over the web.
// ════════════════════════════════════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Daily Report')
    .addItem('Show the app link', 'showAppLink')
    .addItem('Reopen a submitted report…', 'reopenReportFromMenu')
    .addItem('Export reports (Excel)…', 'exportReportsFromMenu')
    .addSeparator()
    .addItem('Give new Roster rows an ID', 'tidyRosterFromMenu')
    .addItem('Rebuild the client report tabs', 'rebuildAllFromMenu')
    .addItem('Check the audit log', 'checkAuditFromMenu')
    .addSeparator()
    .addItem('Set up / upgrade the Sheet', 'setup')
    .addToUi();
}

/** Show a message: a pop-up in the Sheet, or the log when run from the editor. */
function say_(msg) {
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}
/** Ask for text in the Sheet. Returns null when cancelled or when there is no Sheet window. */
function ask_(title, prompt) {
  try {
    var ui = SpreadsheetApp.getUi(), r = ui.prompt(title, prompt, ui.ButtonSet.OK_CANCEL);
    return r.getSelectedButton() === ui.Button.OK ? String(r.getResponseText() || '').trim() : null;
  } catch (e) { return null; }
}

function reopenReportFromMenu() {
  var team = ask_('Reopen a report', 'Team ID (from the Teams tab, e.g. team2):'); if (team == null) return;
  var date = ask_('Reopen a report', 'Date (yyyy-mm-dd, today or yesterday):'); if (date == null) return;
  var reason = ask_('Reopen a report', 'Why does it need to change? (kept in the audit log)'); if (reason == null) return;
  try { reopenReport(team, date, reason); say_('Reopened. The leadman can now change the report on the phone and submit it again.'); }
  catch (e) { say_('Not reopened: ' + (e && e.message || e)); }
}

function exportReportsFromMenu() {
  var from = ask_('Export reports', 'From date (yyyy-mm-dd). Leave empty for the last 30 days:'); if (from == null) return;
  var to = from ? ask_('Export reports', 'To date (yyyy-mm-dd). Leave empty for today:') : ''; if (to == null) return;
  try {
    var r = exportReports(from, to);
    say_(r.rows + ' reports exported (' + r.from + ' to ' + r.to + ').\n\nExcel file: ' + (r.xlsxUrl || 'could not be made: ' + r.xlsxError) + '\n\nA copy is in the photo folder, under "Exports".');
  } catch (e) { say_('Export failed: ' + (e && e.message || e)); }
}

function tidyRosterFromMenu() { var n = withLock_(tidyRoster_); say_(n ? n + ' Roster row(s) got a Person ID.' : 'Every Roster row already has a Person ID.'); }
function rebuildAllFromMenu() { var a = withLock_(rebuildAccomplishmentReport), b = withLock_(rebuildClientTabs); say_('Rebuilt: ' + a + ' rows in Accomplishment Report, ' + b + ' reports in the client tabs.'); }
function checkAuditFromMenu() {
  var r = verifyAuditLog(), f = auditFailures_();
  say_((r.ok ? 'Audit log intact: ' + r.rows + ' entries.' : 'AUDIT LOG NOT INTACT: ' + r.reason) +
    (f && f.count ? '\n\n' + f.count + ' audit entr' + (f.count === 1 ? 'y' : 'ies') + ' could not be written (last ' + f.last + ': ' + f.error + '). After checking, run clearAuditFailures.' : ''));
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('The app is busy saving a report. Try again in a minute.');
  LOCKED = true;
  try { CACHE = {}; return fn(); } finally { LOCKED = false; lock.releaseLock(); }
}

// ════════════════════════════════════════════════════════════════════════════
// Setup (run once from the editor or the menu; safe to run again after updating the code)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Creates the tabs (upgrading an older Sheet in place), fills in teams and crew when empty, and removes
 * the old sign-in system (PINs, sessions, phone setup links). Nothing a leadman entered is deleted.
 */
function setup() {
  CACHE = {};
  var ss = db_(), props = PropertiesService.getScriptProperties();
  if (!props.getProperty('AUDIT_SECRET')) props.setProperty('AUDIT_SECRET', Utilities.getUuid() + Utilities.getUuid());
  var oldUsers = migrate_();
  Object.keys(TABLES).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = TABLES[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(function (c) { return c[1]; })])
      .setFontWeight('bold').setBackground('#0F2540').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    formatRows_(sh, name, 2, sh.getMaxRows() - 1);
  });
  CACHE = {};
  var now = now_();
  if (readAll_('Teams').length === 0) {
    SEED.forEach(function (t) { upsert_('Teams', t[0], { teamId: t[0], name: t[1], short: t[2], leadman: t[3], defaultUnit: t[4], active: 'Yes' }); });
  }
  if (readAll_('Roster').length === 0) {
    SEED.forEach(function (t) {
      [[t[3], 'Leadman']].concat(t[5]).forEach(function (m) {
        var id = newPersonId_(t[0], m[0]);
        upsert_('Roster', id, { personId: id, teamId: t[0], name: m[0], role: m[1], status: 'Active', createdAt: now, updatedAt: now, editedBy: 'setup' });
      });
    });
  }
  tidyRoster_();
  // Each team's leadman: from the old Users tab, else the Roster's Leadman.
  readAll_('Teams').forEach(function (t) {
    if (!t.teamId || t.leadman) return;
    var lead = oldUsers[t.teamId] || (readAll_('Roster').filter(function (m) { return m.teamId === t.teamId && m.role === 'Leadman' && m.status !== 'Archived'; })[0] || {}).name || '';
    if (lead) upsert_('Teams', t.teamId, { leadman: lead });
  });
  // Older rows: a report ID, the team name on attendance rows.
  var teamName = {};
  readAll_('Teams').forEach(function (t) { teamName[t.teamId] = t.name; });
  readAll_('Reports').forEach(function (r) {
    if (r.key && !r.reportId) upsert_('Reports', r.key, { reportId: newReportId_(r.teamId, r.reportDate), rev: r.rev || r.version || '0' });
  });
  fillColumn_('Attendance', 'team', function (a) { return a.team || teamName[a.teamId] || ''; });

  // The old sign-in system is gone: its tabs and secrets are removed, old history tabs are hidden.
  OLD_AUTH_TABS.forEach(function (n) { var sh = ss.getSheetByName(n); if (sh) ss.deleteSheet(sh); });
  OLD_HIDDEN_TABS.forEach(function (n) { var sh = ss.getSheetByName(n); if (sh) { try { sh.hideSheet(); } catch (e) {} } });
  OLD_SECRETS.forEach(function (k) { props.deleteProperty(k); });
  Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf('ENR_') === 0) props.deleteProperty(k); });

  var rep = ss.getSheetByName('Reports');
  rep.setColumnWidth(col_('Reports', 'beforePreview'), 110);
  rep.setColumnWidth(col_('Reports', 'afterPreview'), 110);
  try { var p = ss.getSheetByName('Audit').protect(); p.setDescription('Written by the app only. Do not edit by hand.'); p.setWarningOnly(true); } catch (e) {}
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  photoRoot_();
  accSheet_();
  // Photos are private: files shared "anyone with the link" by older versions are made private again.
  var priv = makePhotosPrivate_(120000);
  if (priv.left) Logger.log(priv.left + ' photos still shared by link — run makePhotosPrivate to finish.');
  // Crew names as written in the client's reports (LAST, FIRST M.), filled once; editable in the Roster tab.
  readAll_('Roster').forEach(function (m) { if (m.personId && !m.reportName && REPORT_NAMES[m.personId]) upsert_('Roster', m.personId, { reportName: REPORT_NAMES[m.personId] }); });
  // Client report tabs (created if missing; their rows are rewritten from the data, never typed in).
  TEAM_TABS.forEach(function (t) { teamReportSheet_(t); });
  consoSheet_();
  monthlyWrite_();
  summaryWrite_();
  ATTENDANCE_TABS.forEach(function (cfg) { attendanceTabWrite_(cfg); });
  // Photo cells written by older versions used =IMAGE(link) (needs public files): rewrite them once as private links.
  if (!props.getProperty('PREVIEWS_PRIVATE')) {
    readAll_('Reports').forEach(function (r) {
      if (!r.key || (!r.beforePhotoId && !r.afterPhotoId)) return;
      upsert_('Reports', r.key, { beforePreview: photoCell_(row_('Photos', r.beforePhotoId)), afterPreview: photoCell_(row_('Photos', r.afterPhotoId)) });
    });
    rebuildAccomplishmentReport();
    rebuildClientTabs();
    props.setProperty('PREVIEWS_PRIVATE', '1');
  }
  audit_({ name: 'setup', role: 'system' }, '', 'setup', 'system', '', null, null, 'setup() run');
  Logger.log('Setup complete.');
  Logger.log('Next: Deploy → New deployment (or Manage deployments → Edit → New version) → Web app (Execute as: Me, Who has access: Anyone). Then Daily Report menu → Show the app link.');
  return { ok: true };
}

/** The address to open on each phone: the app with this backend's Web app URL. */
function appLink() {
  var url = String(WEB_APP_URL || ScriptApp.getService().getUrl() || '').trim();
  if (!WEB_APP_URL_RE.test(url)) return { ok: false, url: url };
  return { ok: true, link: APP_ADDRESS + '?backend=' + encodeURIComponent(url) };
}

/** Show the link that connects a phone to this Sheet. The same link works for every phone. */
function showAppLink() {
  var a = appLink();
  if (!a.ok) {
    say_('No link made. Apps Script gave this address: ' + (a.url || '(none)') + ' — phones need the Web app URL ending in /exec.\n\n' +
      'Fix: Deploy → Manage deployments → copy the Web app URL, paste it between the quotes of WEB_APP_URL at the top of Code.gs, save, then try again.');
    return '';
  }
  say_('The app: ' + APP_ADDRESS + '\nAnyone with that address can use it, once this Web app URL is built into the app:\n\n' +
    String(WEB_APP_URL || ScriptApp.getService().getUrl()) + '\n\n(For a copy of the app hosted elsewhere, this link also works: ' + a.link + ')');
  return a.link;
}

var WEB_APP_URL_RE = /^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+\/|macros\/)s\/[\w-]+\/exec$/;

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

/** After checking the cause, clear the "audit entries could not be written" warning. */
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
  var reps = submittedReports_().sort(function (a, b) { return (a.reportDate + (a.firstSubmittedAt || '')).localeCompare(b.reportDate + (b.firstSubmittedAt || '')); });
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
  var rows = readAll_('Audit'), prev = '', fail = function (row, why) { Logger.log('AUDIT LOG NOT INTACT: ' + why); return { ok: false, row: row, reason: why }; };
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
// Field app API (doPost). Four actions, no sign-in.
// ════════════════════════════════════════════════════════════════════════════

function doGet() {
  return out_({ ok: true, app: 'Bridge NLEX Daily Report API', time: now_() });
}

var REQ = { requestId: '', device: '' };
var LOCKED = false;

var ACTIONS = {
  teams:        { run: teams_ },
  team:         { run: team_ },
  uploadPhoto:  { run: uploadPhoto_, writes: true },     // idempotent by the phone's photo ID (clientId)
  submitReport: { run: submitReport_, writes: true },    // idempotent by request ID; one report per team per day
};

function doPost(e) {
  CACHE = {}; LOCKED = false; REQ = { requestId: '', device: '' };
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Bad request' }); }
  if (!req || typeof req !== 'object' || Array.isArray(req)) return out_({ ok: false, error: 'Bad request' });
  var fn = ACTIONS[req.action];
  if (!fn) return out_({ ok: false, error: 'This app needs updating. Close it and open it again.' });
  REQ.requestId = /^[A-Za-z0-9-]{8,64}$/.test(String(req.requestId || '')) ? String(req.requestId) : '';
  REQ.device = /^[A-Za-z0-9-]{8,64}$/.test(String(req.deviceId || '')) ? String(req.deviceId).slice(0, 40) : '';
  var lock = null;
  try {
    if (fn.writes) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) return out_({ ok: false, error: 'The office system is busy. Trying again…', retry: true });
      LOCKED = true;
    }
    return out_(fn.run(req));
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally {
    if (lock) { LOCKED = false; lock.releaseLock(); }
  }
}

/** Active teams, for the "Choose your team" screen. */
function teams_() {
  var list = readAll_('Teams').filter(function (t) { return t.teamId && t.active !== 'No'; }).map(teamOut_);
  return { ok: true, teams: list, today: today_(), serverTime: Date.now() };
}

function teamOut_(t) {
  return { teamId: t.teamId, name: t.name || t.teamId, short: t.short || t.name || t.teamId, leadman: t.leadman || '', unit: t.defaultUnit === 'KM' ? 'KM' : 'Locations' };
}

/** One team: crew list, and the team's submitted reports of the last two weeks (to lock today's and show previous ones). */
function team_(req) {
  var t = activeTeam_(req.teamId);
  // Rows typed into the Roster tab by hand get their Person ID here (needs the write lock).
  if (readAll_('Roster').some(function (m) { return !m.personId && m.name && m.teamId; })) {
    var lock = LockService.getScriptLock();
    if (lock.tryLock(10000)) { LOCKED = true; try { tidyRoster_(); } finally { LOCKED = false; lock.releaseLock(); } }
  }
  // Normal start: only today's and yesterday's state (is it sent?). The last 2 weeks only when the leadman opens Previous reports.
  var since = req.history ? shiftDate_(today_(), -RECENT_DAYS) : yesterday_();
  var reports = readAll_('Reports').filter(function (r) { return r.teamId === t.teamId && r.reportDate >= since && r.state === 'submitted'; })
    .sort(function (a, b) { return b.reportDate.localeCompare(a.reportDate); })
    .map(function (r) {
      return { reportDate: r.reportDate, reportId: r.reportId, location: r.location, activity: r.activityDetails, status: r.status, present: r.crewPresent,
        target: r.target, actual: r.actual, unit: r.unit, start: r.fromTime, end: r.toTime, submittedAt: r.submittedAt, before: !!r.beforePhotoId, after: !!r.afterPhotoId };
    });
  return { ok: true, today: today_(), serverTime: Date.now(), team: teamOut_(t), roster: activeRoster_(t.teamId).map(function (m) { return { personId: m.personId, name: m.name, role: m.role }; }), reports: reports };
}

// ════════════════════════════════════════════════════════════════════════════
// Shared rules
// ════════════════════════════════════════════════════════════════════════════

function activeTeam_(teamId) {
  var t = row_('Teams', String(teamId || ''));
  if (!t || !t.teamId || t.active === 'No') throw new Error('This team is not in the list any more. Choose your team again.');
  return t;
}

var ROLE_ORDER = { Leadman: 0, Skilled: 1, Crew: 2 };
function activeRoster_(teamId) {
  return readAll_('Roster').filter(function (m) { return m.personId && m.teamId === teamId && m.status !== 'Archived'; })
    .sort(function (a, b) { return (ROLE_ORDER[a.role] == null ? 3 : ROLE_ORDER[a.role]) - (ROLE_ORDER[b.role] == null ? 3 : ROLE_ORDER[b.role]); });
}

/** The phone may report for today or yesterday (Manila time): yesterday's report can still go out after midnight. */
function writableDate_(date) {
  if (!validDate_(date)) throw new Error('Missing or bad date');
  if (date > today_()) throw new Error('This phone\'s date is ahead. Check the date and time on the phone.');
  if (date < yesterday_()) throw new Error('Reports older than yesterday can no longer be sent from the app. Tell the office.');
  return date;
}

function validDate_(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) return false;
  return shiftDate_(d, 0) === d && d >= '2020-01-01';
}

function newReportId_(teamId, date) {
  return 'R' + String(date).replace(/-/g, '') + '-' + teamId + '-' + Utilities.getUuid().slice(0, 6);
}

function attendanceFor_(teamId, date) {
  var ids = {};
  activeRoster_(teamId).forEach(function (m) { ids[m.personId] = true; });
  return readAll_('Attendance').filter(function (a) { return a.teamId === teamId && a.reportDate === date && ids[a.personId]; });
}

/** Who did it, for the audit log: there is no sign-in, so it is the team's leadman, using the field app. */
function fieldUser_(t) { return { name: t.leadman || t.name, role: 'field app', userId: '' }; }

// ════════════════════════════════════════════════════════════════════════════
// Photos
// ════════════════════════════════════════════════════════════════════════════

function uploadPhoto_(req) {
  var t = activeTeam_(req.teamId), teamId = t.teamId, date = writableDate_(req.reportDate);
  if (req.type !== 'before' && req.type !== 'after') throw new Error('Photo type must be before or after');
  var clientId = String(req.clientId || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(clientId)) throw new Error('This app needs updating. Close it and open it again.');
  // Retries of the same photo return the photo already stored, never a second copy.
  var dup = readAll_('Photos').filter(function (p) { return p.clientId === clientId; })[0];
  if (dup) {
    if (dup.teamId !== teamId || dup.reportDate !== date || dup.type !== req.type) throw new Error('This photo belongs to another report. Take it again.');
    return { ok: true, photo: photoOut_(dup), replay: true };
  }
  var rep = row_('Reports', teamId + '|' + date);
  if (rep && rep.state === 'submitted') return sentAlready_(rep);
  if (readAll_('Photos').filter(function (p) { return p.teamId === teamId && p.reportDate === date; }).length >= MAX_PHOTOS_PER_DAY) {
    throw new Error('Too many photos for this report today. Tell the office.');
  }
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
    audit_(fieldUser_(t), teamId, 'photo refused', 'photo', clientId, null, null, 'Damaged or disguised ' + kind + ' (' + bytes.length + ' bytes)');
    throw new Error('That photo file is damaged or not a real photo — take it again.');
  }

  var now = now_();
  var folder = subFolder_(subFolder_(photoRoot_(), date), t.short || t.teamId);
  var ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
  var photoId = 'ph-' + Utilities.getUuid().slice(0, 13);
  var name = date + '_' + (t.short || t.teamId).replace(/[^A-Za-z0-9]+/g, '') + '_' + req.type.toUpperCase() + '_' + now.slice(11).replace(/:/g, '') + '_' + photoId.slice(3, 9) + '.' + ext;
  // The file stays private (never shared by link); the Sheet links to it for the Drive owner.
  var file = folder.createFile(Utilities.newBlob(bytes, m[1], name));
  // Capture time and location come from the phone: kept as its claim, labelled "not verified", and never used
  // for the report date, the audit time or any decision. The server's own time is uploadedAt.
  var captured = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(String(req.capturedAt || '')) ? String(req.capturedAt) : '';
  var location = String(req.location || '').trim().slice(0, 200);
  file.setDescription(t.name + ' · ' + date + ' · ' + req.type.toUpperCase() + ' · uploaded (server time) ' + now +
    (captured ? ' · phone clock at capture (not verified) ' + captured : '') + (location ? ' · location typed on phone (not verified): ' + location : '') +
    ' · ' + dims.w + '×' + dims.h + ' · original filename: ' + String(req.originalFilename || '').slice(0, 120));

  // The newest photo of each type is the one in use until the report is submitted.
  var replaced = markPhotos_(teamId, date, req.type, 'Replaced');
  var photo = {
    photoId: photoId, clientId: clientId, reportId: rep ? rep.reportId : '', teamId: teamId, reportDate: date, type: req.type, status: 'Active',
    leadman: t.leadman || '', location: location, capturedAt: captured,
    fileId: file.getId(), fileUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800',
    originalFilename: String(req.originalFilename || '').slice(0, 200), uploadedAt: now, uploadedBy: 'field app', bytes: String(bytes.length), device: REQ.device,
  };
  upsert_('Photos', photoId, photo);
  audit_(fieldUser_(t), teamId, req.type + ' photo ' + (replaced.length ? 'replaced' : 'uploaded'), 'photo', photoId,
    replaced.length ? { photoId: replaced.join(',') } : null, { photoId: photoId, date: date, bytes: bytes.length }, photo.originalFilename);
  return { ok: true, photo: photoOut_(photo) };
}

function photoOut_(p) { return { photoId: p.photoId, clientId: p.clientId, type: p.type, uploadedAt: p.uploadedAt }; }

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

/** Mark the active photo(s) of this type as Replaced. Files stay in Drive for the audit trail. */
function markPhotos_(teamId, date, type, status, keepId) {
  var ids = [];
  readAll_('Photos').forEach(function (p) {
    if (p.teamId === teamId && p.reportDate === date && p.type === type && p.status === 'Active' && p.photoId !== keepId) {
      upsert_('Photos', p.photoId, { status: status }); ids.push(p.photoId);
    }
  });
  return ids;
}

/** The photo the phone names (by the server's photo ID, or the phone's own ID when it was queued offline). */
function namedPhoto_(teamId, date, type, photoId, clientId) {
  photoId = String(photoId || ''); clientId = String(clientId || '');
  if (!photoId && !clientId) return null;
  return readAll_('Photos').filter(function (p) {
    return p.teamId === teamId && p.reportDate === date && p.type === type && ((photoId && p.photoId === photoId) || (clientId && p.clientId === clientId));
  })[0] || null;
}

// ════════════════════════════════════════════════════════════════════════════
// Daily report: attendance + work + photos, submitted together
// ════════════════════════════════════════════════════════════════════════════

var REPORT_FIELDS = ['fromTime', 'toTime', 'location', 'activityDetails', 'status', 'target', 'actual', 'unit', 'plateNumber', 'remarks'];

/** Every work rule, enforced here so a report can never be accepted half-filled or with impossible values. */
function validateReport_(f) {
  var c = {}, errs = [];
  f = f && typeof f === 'object' ? f : {};
  REPORT_FIELDS.forEach(function (k) { c[k] = String(f[k] == null ? '' : f[k]).trim(); });
  c.plateNumber = c.plateNumber.toUpperCase().replace(/\s+/g, ' ');
  var hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!hhmm.test(c.fromTime) || !hhmm.test(c.toTime)) errs.push('Enter the start and end time');
  else if (c.fromTime >= c.toTime) errs.push('Start time must be before end time');
  if (!c.location) errs.push('Enter the location');
  else if (c.location.length > 200) errs.push('Location is too long (200 characters max)');
  if (!c.activityDetails) errs.push('Describe the work done');
  else if (c.activityDetails.length > 2000) errs.push('Work description is too long (2000 characters max)');
  if (c.remarks.length > 1000) errs.push('Remarks are too long (1000 characters max)');
  if (c.status !== 'Complete' && c.status !== 'Ongoing') errs.push('Choose Ongoing or Complete');
  if (c.unit !== 'KM' && c.unit !== 'Locations') errs.push('Choose the unit (KM or Locations)');
  var qMax = MAX_QTY[c.unit] || 100, whole = c.unit === 'Locations';
  ['target', 'actual'].forEach(function (k) {
    var label = k === 'target' ? 'Target' : 'Actual';
    if (!/^\d+(\.\d{1,3})?$/.test(c[k])) { errs.push('Enter the ' + label.toLowerCase() + ' as a number'); return; }
    var n = Number(c[k]);
    if (n > qMax) errs.push(label + ' looks wrong (max ' + qMax + ')');
    else if (whole && n !== Math.floor(n)) errs.push(label + ' must be a whole number of locations');
    else c[k] = String(n);
  });
  if (c.plateNumber && !/^[A-Z0-9 .\/-]{2,20}$/.test(c.plateNumber)) errs.push('Equipment / plate: letters, numbers, spaces and - / only');
  return { clean: c, errs: errs };
}

/** The answer when this team's report for the day is already in. */
function sentAlready_(rep) {
  return { ok: false, alreadySubmitted: true, reportDate: rep.reportDate, submittedAt: rep.submittedAt, reportId: rep.reportId,
    error: 'This team\'s report for ' + rep.reportDate + ' was already sent at ' + timeOf_(rep.submittedAt) + '.' };
}

function submitReport_(req) {
  var t = activeTeam_(req.teamId), teamId = t.teamId, date = writableDate_(req.reportDate);
  if (!REQ.requestId) throw new Error('This app needs updating. Close it and open it again.');
  var key = teamId + '|' + date, old = row_('Reports', key), user = fieldUser_(t);
  if (old && old.state === 'submitted') {
    // The same submit sent again (no signal, retry, double tap): the first answer back, nothing written.
    if (old.lastRequestId === REQ.requestId) return { ok: true, replay: true, reportId: old.reportId, submittedAt: old.submittedAt, version: old.version, crewPresent: old.crewPresent, late: old.late };
    audit_(user, teamId, 'duplicate report refused', 'report', old.reportId, null, null, 'A second report for ' + date + ' was sent; the first one is kept.');
    return sentAlready_(old);
  }

  // Attendance: everyone on the crew list has a status; actual manpower is counted here, never taken from the phone.
  var errs = [], roster = activeRoster_(teamId), sent = {}, unknown = 0;
  (Array.isArray(req.attendance) ? req.attendance : []).forEach(function (p) { if (p && typeof p === 'object') sent[String(p.personId)] = p; });
  var byId = {}; roster.forEach(function (m) { byId[m.personId] = true; });
  Object.keys(sent).forEach(function (id) { if (!byId[id]) unknown++; });
  var rows = [], missing = [];
  roster.forEach(function (m) {
    var p = sent[m.personId], status = p ? String(p.status || '') : '';
    if (ATT_STATUSES.indexOf(status) < 0) { missing.push(m.name); return; }
    rows.push({ m: m, status: status, note: status === 'Present' ? '' : String(p.note || '').trim().slice(0, 200) });
  });
  if (unknown || missing.length) {
    return { ok: false, rosterChanged: true, error: 'The crew list was changed by the office. Check attendance again, then submit.',
      missing: ['Check attendance again' + (missing.length ? ': ' + missing.join(', ') : '')] };
  }
  var present = rows.filter(function (r) { return r.status === 'Present'; }).length;
  if (!present) errs.push('Mark at least one person Present');

  var v = validateReport_(req.report), clean = v.clean;
  errs = errs.concat(v.errs);
  var before = namedPhoto_(teamId, date, 'before', req.beforePhotoId, req.beforeClientId);
  var after = namedPhoto_(teamId, date, 'after', req.afterPhotoId, req.afterClientId);
  if (!before) errs.push('Add the Before photo');
  if (clean.status === 'Complete' && !after) errs.push('Add the After photo (needed when the work is Complete)');
  if (errs.length) return { ok: false, error: 'Please fix: ' + errs.join('; '), missing: errs };

  var now = now_(), reportId = old && old.reportId ? old.reportId : newReportId_(teamId, date);
  var version = String((Number(old && old.version) || 0) + 1), rev = String((Number(old && old.rev) || 0) + 1);
  var first = (old && old.firstSubmittedAt) || now;
  var absentList = rows.filter(function (r) { return r.status !== 'Present'; }).map(function (r) { return r.m.name + ' (' + r.status + (r.note ? ': ' + r.note : '') + ')'; }).join('; ');

  // One write for the whole crew.
  var beforeAtt = {};
  readAll_('Attendance').forEach(function (a) { if (a.teamId === teamId && a.reportDate === date) beforeAtt[a.personId] = a; });
  upsertMany_('Attendance', rows.map(function (r) {
    var k = key + '|' + r.m.personId;
    return { key: k, data: {
      key: k, reportId: reportId, reportDate: date, team: t.name, teamId: teamId, personId: r.m.personId, name: r.m.name, role: r.m.role,
      status: r.status, note: r.note, submittedAt: now, submittedBy: user.name, updatedAt: now, rev: rev,
    }, defaults: { createdAt: now } };
  }));
  // The photos named in the report are the ones in use; any other photo of that type for the day is marked Replaced.
  [['before', before], ['after', after]].forEach(function (x) {
    if (x[1]) { upsert_('Photos', x[1].photoId, { status: 'Active', reportId: reportId }); markPhotos_(teamId, date, x[0], 'Replaced', x[1].photoId); }
    else markPhotos_(teamId, date, x[0], 'Replaced');
  });

  var row = {
    key: key, reportDate: date, teamId: teamId, team: t.name, leadman: t.leadman || '', state: 'submitted',
    crewPresent: present + '/' + rows.length, actualManpower: String(present), targetManpower: String(rows.length), absentList: absentList,
    beforePhotoId: before.photoId, afterPhotoId: after ? after.photoId : '',
    beforePreview: photoCell_(before), afterPreview: photoCell_(after),
    submittedAt: now, submittedBy: user.name + ' (field app)', updatedAt: now, editedBy: user.name, version: version, rev: rev, reportId: reportId,
    firstSubmittedAt: first, late: (first.slice(0, 10) > date || first.slice(11, 16) > LATE_CUTOFF) ? 'Yes' : 'No',
    lastRequestId: REQ.requestId, device: REQ.device,
  };
  REPORT_FIELDS.forEach(function (k) { row[k] = clean[k]; });
  upsert_('Reports', key, row, { createdAt: now });
  var rep = row_('Reports', key);

  // Audit: the whole report the first time; on a resubmit after the office reopened it, what changed.
  var afterVals = {}, beforeVals = null, changes = [];
  REPORT_FIELDS.forEach(function (k) { afterVals[k] = clean[k]; });
  afterVals.crewPresent = row.crewPresent; afterVals.absent = absentList;
  if (old && Number(old.version) > 0) {
    beforeVals = {};
    REPORT_FIELDS.forEach(function (k) { if (String(old[k]) !== clean[k]) { changes.push(k + ': "' + short_(old[k]) + '" → "' + short_(clean[k]) + '"'); beforeVals[k] = old[k]; } });
    if (old.crewPresent !== row.crewPresent) { changes.push('present: ' + old.crewPresent + ' → ' + row.crewPresent); beforeVals.crewPresent = old.crewPresent; }
    rows.forEach(function (r) { var a = beforeAtt[r.m.personId]; if (a && a.status !== r.status) changes.push(r.m.name + ': ' + a.status + ' → ' + r.status); });
    if (old.beforePhotoId !== before.photoId) changes.push('before photo replaced');
    if ((old.afterPhotoId || '') !== (after ? after.photoId : '')) changes.push('after photo changed');
  }
  audit_(user, teamId, version === '1' ? 'report submitted' : 'report resubmitted (v' + version + ')', 'report', reportId, beforeVals, afterVals,
    version === '1' ? clean.status + ' · ' + short_(clean.location) + ' · present ' + row.crewPresent
      : (old.reopenReason ? 'Reopened because: ' + old.reopenReason + ' — ' : '') + (changes.length ? changes.join('; ') : 'no changes'), rev);
  accUpdate_(user, rep);
  clientTabs_(user, teamId, rep);
  return { ok: true, reportId: reportId, submittedAt: now, version: version, crewPresent: row.crewPresent, late: row.late };
}

/**
 * Admin (Sheet menu or editor): let the leadman change a submitted report. Only today's or yesterday's
 * report can be reopened (older ones are corrected in the Reports tab directly). The submitted version is
 * kept in the audit log.
 */
function reopenReport(teamId, date, reason) {
  return withLock_(function () {
    var t = activeTeam_(String(teamId || '').trim());
    date = String(date || '').trim();
    if (!validDate_(date)) throw new Error('Write the date as yyyy-mm-dd.');
    var old = row_('Reports', t.teamId + '|' + date);
    if (date < yesterday_() || date > today_()) throw new Error('Only today\'s or yesterday\'s report can be reopened. Correct older reports in the Reports tab.');
    if (!old || old.state !== 'submitted') throw new Error('There is no submitted report for ' + t.name + ' on ' + date + '.');
    reason = String(reason || '').trim().slice(0, 500);
    if (reason.length < 3) throw new Error('Give a reason (kept in the audit log).');
    var snap = {};
    TABLES.Reports.forEach(function (c) { if (!FORMULA_FIELDS[c[0]]) snap[c[0]] = old[c[0]]; });
    snap.attendance = attendanceFor_(t.teamId, date).map(function (a) { return a.name + ': ' + a.status + (a.note ? ' (' + a.note + ')' : ''); });
    var rev = String(Number(old.rev || 0) + 1);
    upsert_('Reports', old.key, { state: 'reopened', updatedAt: now_(), editedBy: 'office (Sheet)', rev: rev, reopenReason: reason, lastRequestId: '' });
    audit_({ name: adminName_(), role: 'admin' }, t.teamId, 'report reopened', 'report', old.reportId,
      snap, { state: 'reopened', rev: rev }, reason, rev);
    return { ok: true, rev: rev };
  });
}

/** The Google account using the Sheet (when Google shares it), for the audit log. */
function adminName_() {
  try { var e = Session.getActiveUser().getEmail(); if (e) return e; } catch (x) {}
  return 'office (Sheet)';
}

// ════════════════════════════════════════════════════════════════════════════
// Accomplishment Report tab — same layout as the team's "Bridge Team Accomplishment Report"
// (Weekly Report) sheet, filled automatically: one row per submitted report, updated in place
// when a report is reopened and submitted again. Column P (hidden) holds the report ID.
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
function accUpdate_(user, rep) {
  try { accWrite_(rep); }
  catch (e) {
    Logger.log('Accomplishment Report update failed: ' + e);
    audit_(user, rep.teamId, 'accomplishment report update failed', 'report', rep.reportId, null, null, String(e && e.message || e).slice(0, 300), rep.rev);
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

/** Run after a report is saved. A failure never undoes the save, but is recorded. */
function clientTabs_(user, teamId, rep) {
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
    audit_(user, teamId, 'client report tab update failed', 'report', rep ? rep.reportId : '', null, null, String(e && e.message || e).slice(0, 300), rep ? rep.rev : '');
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

/** Reports that were submitted at least once (a reopened report keeps its place until it is sent again). */
function submittedReports_() {
  return readAll_('Reports').filter(function (r) { return r.key && (r.state === 'submitted' || Number(r.version) > 0); });
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
  var acts = readAll_('Teams').filter(function (t) { return t.teamId && t.active !== 'No'; }).map(function (t) { return String(t.name); }).sort(function (a, b) { return a.toUpperCase().localeCompare(b.toUpperCase()); });
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
    var roster = readAll_('Roster').filter(function (m) { return m.personId && m.teamId === teamId; });
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
// Roster: edited by hand in the Roster tab
// ════════════════════════════════════════════════════════════════════════════

/**
 * Rows typed into the Roster tab get a Person ID (and Status Active, and the created time).
 * Run under the script lock. Returns how many rows were fixed.
 */
function tidyRoster_() {
  var sh = sheet_('Roster'), n = sh.getLastRow() - 1, cols = TABLES.Roster;
  if (n < 1) return 0;
  var grid = sh.getRange(2, 1, n, cols.length).getDisplayValues(), ci = function (k) { return col_('Roster', k) - 1; };
  var fixed = 0, taken = {};
  grid.forEach(function (r) { if (r[ci('personId')]) taken[r[ci('personId')]] = true; });
  grid.forEach(function (r, i) {
    var name = String(r[ci('name')] || '').trim(), team = String(r[ci('teamId')] || '').trim();
    if (r[ci('personId')] || !name || !team) return;
    var base = team + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30), id = base, k = 2;
    while (taken[id]) id = base + '-' + (k++);
    taken[id] = true;
    r[ci('personId')] = id;
    if (!r[ci('status')]) r[ci('status')] = 'Active';
    if (!r[ci('role')]) r[ci('role')] = 'Crew';
    if (!r[ci('createdAt')]) r[ci('createdAt')] = now_();
    sh.getRange(i + 2, 1, 1, cols.length).setValues([r.map(safeCell_)]);
    audit_({ name: 'Roster tab', role: 'admin' }, team, 'crew added (Roster tab)', 'person', id, null, { name: name, role: r[ci('role')] }, '');
    fixed++;
  });
  CACHE = {};
  return fixed;
}

/** Write one column for every row of a tab (one Sheets call). */
function fillColumn_(name, field, fn) {
  var rows = readAll_(name);
  if (!rows.length) return;
  var vals = rows.map(function (r) { return [safeCell_(fn(r))]; });
  sheet_(name).getRange(2, col_(name, field), vals.length, 1).setValues(vals);
  CACHE = {};
}

// ════════════════════════════════════════════════════════════════════════════
// Export (Sheet menu)
// ════════════════════════════════════════════════════════════════════════════

/** Validated from/to (default: last 30 days), at most `maxDays` long. */
function range_(from, to, maxDays) {
  to = to ? String(to).trim() : today_(); from = from ? String(from).trim() : shiftDate_(to, -30);
  if (!validDate_(from) || !validDate_(to)) throw new Error('Write the dates as yyyy-mm-dd.');
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

/** Every submitted report in the date range, as CSV text and as an Excel file in the photo folder's "Exports" subfolder. */
function exportReports(from, to) {
  var r = range_(from, to, 366);
  var photos = {};
  readAll_('Photos').forEach(function (p) { photos[p.photoId] = p; });
  var head = ['Date', 'Team', 'Location', 'Activity', 'Status', 'Present', 'Target', 'Actual', 'Unit', 'Before Photo', 'After Photo', 'Submitted',
    'Start', 'End', 'Manpower', 'Absent', 'Equipment / Plate', 'Remarks', 'Leadman', 'Late', 'State', 'Report ID', 'Version', 'Reopen Reason'];
  var rows = readAll_('Reports').filter(function (x) { return x.key && x.reportDate >= r.from && x.reportDate <= r.to; })
    .sort(function (a, b) { return a.reportDate === b.reportDate ? a.teamId.localeCompare(b.teamId) : a.reportDate.localeCompare(b.reportDate); })
    .map(function (x) {
      var bp = photos[x.beforePhotoId], ap = photos[x.afterPhotoId];
      return [x.reportDate, x.team, x.location, x.activityDetails, x.status, x.crewPresent, x.target, x.actual, x.unit, bp ? bp.fileUrl : '', ap ? ap.fileUrl : '', x.submittedAt,
        x.fromTime, x.toTime, x.actualManpower, x.absentList, x.plateNumber, x.remarks, x.leadman, x.late, x.state === 'submitted' ? 'Submitted' : x.state === 'reopened' ? 'Reopened' : 'Not submitted', x.reportId, x.version || '0', x.reopenReason];
    });
  var csv = [head].concat(rows).map(function (x) { return x.map(csvCell_).join(','); }).join('\r\n');
  var name = 'NLEX_Daily_Report_' + r.from + '_to_' + r.to;
  var x = exportXlsx_(name, [head].concat(rows));
  audit_({ name: adminName_(), role: 'admin' }, '', 'export', 'export', '', null, { from: r.from, to: r.to, rows: rows.length }, x.error ? 'xlsx failed: ' + x.error : '');
  return { ok: true, csv: csv, rows: rows.length, from: r.from, to: r.to, filename: name + '.csv', xlsxUrl: x.url, xlsxError: x.error };
}

/** The same rows as the CSV, in a Google Sheet of their own, so the .xlsx download holds only the export rows. */
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
/** "2026-09-27 15:42:10" → "3:42 PM" */
function timeOf_(stamp) {
  var m = /(\d{2}):(\d{2})/.exec(String(stamp || '').slice(11));
  if (!m) return String(stamp || '');
  var h = Number(m[1]);
  return (h % 12 || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
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
  if (!sh) throw new Error('The office Sheet needs updating (tab "' + name + '" is missing). Tell the office to run setup.');
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
 * Upgrade tabs made by an older version, in place:
 *  - DailyReports → Reports, AuditLog → Audit (a v1 "Audit" tab is kept as "Audit (v1)"),
 *  - every tab's columns rewritten to the new layout by header name,
 * and returns each team's leadman name from the old Users tab (or a v1 Teams tab), so it can be copied into Teams.
 */
function migrate_() {
  var ss = db_(), lead = {};
  var heads = function (sh) { return sh && sh.getLastRow() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0] : []; };
  var audit = ss.getSheetByName('Audit');
  if (audit && heads(audit)[0] !== 'Audit ID' && !ss.getSheetByName('Audit (v1)')) audit.setName('Audit (v1)');
  if (ss.getSheetByName('AuditLog') && !ss.getSheetByName('Audit')) ss.getSheetByName('AuditLog').setName('Audit');
  if (ss.getSheetByName('DailyReports')) {
    var old = ss.getSheetByName('Reports');
    if (old && !ss.getSheetByName('Reports (v1)')) old.setName('Reports (v1)');
    if (!ss.getSheetByName('Reports')) ss.getSheetByName('DailyReports').setName('Reports');
  }
  var users = ss.getSheetByName('Users');
  if (users && users.getLastRow() > 1) {
    var g = users.getRange(1, 1, users.getLastRow(), users.getLastColumn()).getDisplayValues(), h = g[0];
    var iName = h.indexOf('Name'), iTeam = h.indexOf('Team ID'), iRole = h.indexOf('Role (admin/leadman)'), iAct = h.indexOf('Active (Yes/No)');
    g.slice(1).forEach(function (r) { if (r[iRole] === 'leadman' && r[iTeam] && r[iAct] !== 'No' && !lead[r[iTeam]]) lead[r[iTeam]] = r[iName]; });
  }
  Object.keys(TABLES).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 0) relayout_(sh, name);
  });
  CACHE = {};
  // v1 kept the admin as a row of the Teams tab.
  if (ss.getSheetByName('Teams') && row_('Teams', 'admin')) deleteRow_('Teams', 'admin');
  return lead;
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
    cols.forEach(function (c, i) { o[c[0]] = v[i] == null ? '' : String(v[i]).trim(); });
    return o;
  });
  var index = {}, kf = KEY_FIELD[name];
  if (kf) rows.forEach(function (r, i) { if (r[kf]) index[r[kf]] = i; });
  CACHE[name] = { rows: rows, index: index };
  return rows.map(function (r) { return Object.assign({}, r); });
}

function row_(name, key) {
  readAll_(name);
  var i = key ? CACHE[name].index[key] : null;
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
  if (name === 'Reports') sh.setRowHeight(rowNum, 72);
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

function hmac_(s, secretName) {
  var secret = PropertiesService.getScriptProperties().getProperty(secretName);
  if (!secret) throw new Error('The office Sheet needs updating. Tell the office to run setup.');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, secret)).replace(/=+$/, '');
}

function auditFailures_() {
  var v = PropertiesService.getScriptProperties().getProperty('AUDIT_FAILURES'), o = null;
  try { o = v ? JSON.parse(v) : null; } catch (e) {}
  var t = auditTamper_();
  if (t) { o = o || { count: 0 }; o.tamper = t.what + ' (detected ' + t.at + ')'; }
  return o;
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
 * Append one audit entry: who, what, when (server clock), which entity and report revision, before/after,
 * reason, request ID and the phone's device label. Rows are only ever appended; each carries a hash of the
 * previous one, so verifyAuditLog() spots hand edits.
 */
function audit_(user, teamId, action, entity, entityId, before, after, reason, rev) {
  var lock = null;
  try {
    if (!LOCKED) { lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) lock = null; }
    var sh = sheet_('Audit'), last = sh.getLastRow(), props = PropertiesService.getScriptProperties();
    var prev = last > 1 ? String(sh.getRange(last, col_('Audit', 'hash')).getDisplayValues()[0][0] || '') : '';
    // The log must still end where the app last left it; otherwise rows were deleted, added or replaced by hand.
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
    formatRows_(sh, 'Audit', row, 1);
    sh.getRange(row, 1, 1, TABLES.Audit.length).setValues([TABLES.Audit.map(function (c) { return safeCell_(a[c[0]]); })]);
    delete CACHE.Audit;
    props.setProperty('AUDIT_CHECKPOINT', JSON.stringify({ n: row - 1, h: a.hash, at: a.at, sig: hmac_('cp|' + (row - 1) + '|' + a.hash, 'AUDIT_SECRET') }));
  } catch (e) {
    // Never silent: "Check the audit log" in the Daily Report menu shows how many entries could not be written.
    Logger.log('audit failed: ' + e);
    try {
      var props2 = PropertiesService.getScriptProperties(), prevF = auditFailures_() || { count: 0 };
      props2.setProperty('AUDIT_FAILURES', JSON.stringify({ count: prevF.count + 1, last: now_(), action: action, error: String(e && e.message || e).slice(0, 200) }));
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
