// Live (backend) behaviour for the app's Component.
//
// The design's logic in App.jsx stays as it was; each action that must reach
// the server checks `this.live` and hands off to the methods here. Rules:
//  - The server is the source of truth. Nothing is shown as submitted until the server confirms it.
//  - Every submit is a record in the phone's outbox with a fixed request ID:
//      Draft → Pending sync → Syncing → Server confirmed   (or Conflict / Refused, with the entries kept)
//    Pending records survive reloads and crashes and are re-sent automatically when there is signal.
//    A re-send reuses the request ID, so the server never saves it twice.
//  - Each record carries the revision the phone started from; if another device changed the report
//    since, the server refuses (Conflict) instead of overwriting.
//  - Photos wait in IndexedDB and upload as soon as the server answers.
//  - Queued work belongs to the person who queued it: it is only ever sent with their own sign-in.
import * as api from './api.js';
import * as idb from './idb.js';

const toServerForm = f => ({
  fromTime: f.from, toTime: f.to, location: f.location, activityDetails: f.details,
  status: f.status === 'COMPLETE' ? 'Complete' : 'Ongoing', target: f.targetLoc, actual: f.actualLoc,
  unit: f.unit === 'Locations' ? 'Locations' : 'KM', targetManpower: f.targetMH, actualManpower: f.actualMH,
  plateNumber: f.plate, remarks: f.remarks,
});

const fromServerForm = (r, base) => ({
  ...base,
  from: r.fromTime || base.from, to: r.toTime || base.to, location: r.location, details: r.activityDetails,
  status: r.status === 'Complete' ? 'COMPLETE' : 'ONGOING', targetLoc: r.target, actualLoc: r.actual,
  unit: r.unit || base.unit, targetMH: r.targetManpower, actualMH: r.actualManpower, plate: r.plateNumber, remarks: r.remarks,
});

/** Server team rows → the app's team list. */
export const teamsFrom = list => (Array.isArray(list) ? list : []).filter(t => t && typeof t.teamId === 'string' && t.teamId)
  .map(t => ({ id: t.teamId, name: String(t.name || t.teamId), short: String(t.short || t.name || t.teamId), leadman: String(t.leadman || ''), unit: t.defaultUnit === 'Locations' ? 'Locations' : 'KM' }));

const ROLE_ORDER = { Leadman: 0, Skilled: 1, Crew: 2 };
const KINDS = { att: 'Attendance', act: 'Report' };
const STATES = ['pending', 'syncing', 'conflict', 'rejected'];
const KEY_RE = /^(att|act)\|[\w-]+\|\d{4}-\d{2}-\d{2}$/;
const MAX_UPLOAD = 5.5 * 1024 * 1024;

export const liveMethods = {
  liveUser(u) {
    if (!u) return null;
    if (u.role === 'admin') return { name: u.name, initials: 'OA', role: 'Admin', team: u.team, screen: 'admin', cta: 'Open command center' };
    return { name: u.name, initials: this.initials(u.name), role: 'Leadman', team: u.team, screen: u.teamId, cta: "Start today's report" };
  },

  liveMount() {
    this._reqs = api.loadLocal('reqs') || {};
    this._failedPhotos = api.loadLocal('failedPhotos') || {};
    this._sending = {};
    this._online = () => { this.setState({ online: true }); this.uploadPendingPhotos(true); this.refresh(true); };
    this._offline = () => this.setState({ online: false });
    window.addEventListener('online', this._online);
    window.addEventListener('offline', this._offline);
    // Admin screen follows the field in near real time; leadman screens refresh less often.
    // Photos that failed to upload and pending records are retried every minute.
    this._poll = setInterval(() => {
      if (!api.session() || !api.online()) return;
      this.uploadPendingPhotos(true);
      this.flushOutbox();
      if (this.state.busy) return;
      if (this.state.screen === 'admin' || Date.now() - (this._lastLoad || 0) > 300000) this.refresh(true);
    }, 60000);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    api.enrollIfNeeded().catch(e => this.setState({ loginMsg: e.message }));
    this.loadPhotoPreviews();
    if (api.session()) this.refresh(true);
  },
  liveUnmount() {
    window.removeEventListener('online', this._online);
    window.removeEventListener('offline', this._offline);
    clearInterval(this._poll);
  },

  // ── Outbox ──────────────────────────────────────────────────────────────

  /** Pending records saved on the phone. A record cut off mid-send (crash, reload) is pending again, marked as possibly sent. */
  loadOutbox() {
    const raw = api.loadLocal('outbox'), ob = {};
    if (raw && typeof raw === 'object') Object.keys(raw).forEach(k => {
      const it = raw[k];
      const good = KEY_RE.test(k) && it && typeof it === 'object' && it.payload && typeof it.payload === 'object' && typeof it.reqId === 'string'
        && typeof it.teamId === 'string' && typeof it.date === 'string' && typeof it.userId === 'string' && STATES.includes(it.state);
      if (!good) { this.damaged = true; return; }
      ob[k] = it.state === 'syncing' ? { ...it, state: 'pending', sent: true } : it;
    });
    else if (raw != null) this.damaged = true;
    this._ob = ob;
    this._base = {};
    const b = api.loadLocal('base');
    if (b && typeof b === 'object') Object.keys(b).forEach(k => { if (KEY_RE.test(k) && typeof b[k] === 'string') this._base[k] = b[k]; });
    return ob;
  },
  /** Change one outbox record (null removes it). Returns false when the phone could not save it. */
  obSet(key, item) {
    const next = { ...this._ob };
    if (item) next[key] = item; else delete next[key];
    const ok = api.saveLocal('outbox', next);
    if (!ok && item) { this.toast('Phone storage full — NOT saved on this phone. Free up space, then try again.', 'err'); return false; }
    this._ob = next;
    this.setState({ outbox: next });
    return true;
  },
  /** Revision of the server copy an edit started from (for conflict detection). */
  baseSet(key, rev) {
    const next = { ...this._base };
    if (rev == null) delete next[key]; else next[key] = String(rev);
    this._base = next;
    api.saveLocal('base', next);
  },
  markEdit(kind, id) {
    const key = kind + '|' + id + '|' + this.state.today;
    if (this._base && this._base[key] == null) this.baseSet(key, (this.state.rev || {})[id] || '0');
  },
  /** This phone's own write moved the report from revision `from` to `to`: drafts that started from `from` carry on from `to`. */
  bumpBase(teamId, date, from, to) {
    ['att', 'act'].forEach(kind => {
      const k = kind + '|' + teamId + '|' + date;
      if (this._base[k] === String(from)) this.baseSet(k, to);
      const it = this._ob[k];
      if (it && it.baseRev === String(from)) this.obSet(k, { ...it, baseRev: String(to) });
    });
    if (date === this.state.today) this.setState(s => ({ rev: { ...s.rev, [teamId]: String(to) } }), () => this.persist());
  },

  syncOf(kind, id, s) {
    const it = s.outbox && s.outbox[kind + '|' + id + '|' + s.today];
    if (it) return it.state;
    if (kind === 'att') return s.attAt[id] && !s.attDirty[id] ? 'confirmed' : 'draft';
    return s.actAt[id] ? 'confirmed' : 'draft';
  },

  /** What the sync-state box on the Activity / Attendance tab shows (null when there is nothing to say). */
  syncBox(kind, id, s) {
    const key = kind + '|' + id + '|' + s.today, it = s.outbox && s.outbox[key];
    const older = Object.keys(s.outbox || {}).filter(k => k.startsWith(kind + '|' + id + '|') && k !== key).map(k => s.outbox[k]);
    const what = KINDS[kind];
    const olderLine = older.length ? older.map(o => `${what} for ${this.fmtDate(o.date)}: ${o.state === 'pending' || o.state === 'syncing' ? 'waiting to send' : o.state === 'conflict' ? 'CONFLICT' : 'refused'}${o.error ? ' — ' + o.error : ''}`).join(' · ') : '';
    const olderActions = older.filter(o => o.state === 'conflict' || o.state === 'rejected').map(o => ({ label: `Discard ${this.fmtDate(o.date)}`, go: () => this.discardItem(kind + '|' + id + '|' + o.date) }));
    if (!it) return olderLine ? { tone: 'warn', title: 'Earlier day not sent', text: olderLine, actions: olderActions } : null;
    const act = [];
    if (it.state === 'pending') {
      if (s.online) act.push({ label: 'Send now', go: () => this.sendItem(key, true) });
      if (!it.sent) act.push({ label: 'Edit before sending', go: () => this.editBeforeSending(key) });
    }
    const box = {
      pending: { tone: 'warn', title: `⏳ ${what}: Pending sync`, text: (it.sent ? 'Sent, but the server has not confirmed it yet. It is re-sent automatically and can never be saved twice.' : 'Saved on this phone. It sends automatically when there is signal.') + (it.error ? ' Last try: ' + it.error : '') },
      syncing: { tone: 'info', title: `${what}: Syncing…`, text: 'Sending to Google Sheet. Keep the app open.' },
      conflict: { tone: 'err', title: `${what}: Conflict — NOT saved`, text: (it.error || 'Changed on another device.') + ' Your entries are kept on this phone. Check them, then submit again.' },
      rejected: { tone: 'err', title: `${what}: Not accepted by the server`, text: (it.error || '') + ' Fix it, then submit again.' },
    }[it.state];
    return { ...box, text: box.text + (olderLine ? ' · ' + olderLine : ''), actions: act.concat(olderActions) };
  },

  /** Put a submit in the outbox. Returns the key, or null when the phone could not save it. */
  queue(kind, id, payload) {
    const s = this.state, key = kind + '|' + id + '|' + s.today, sess = api.session();
    const baseRev = this._base[key] != null ? this._base[key] : String((s.rev || {})[id] || '0');
    const item = { kind, teamId: id, date: s.today, userId: sess ? sess.user.userId : '', reqId: api.uuid(), baseRev, payload, state: 'pending', sent: false, error: '', at: api.manilaStamp() };
    return this.obSet(key, item) ? key : null;
  },

  editBeforeSending(key) {
    const it = this._ob[key];
    if (!it || it.sent || it.state !== 'pending') return;
    if (!window.confirm('Take it back to edit? It has not been sent yet.')) return;
    this.obSet(key, null);
    this.toast('Back to draft — submit again when ready', 'info');
  },
  discardItem(key) {
    const it = this._ob[key];
    if (!it) return;
    if (!window.confirm(`Discard the unsent ${KINDS[it.kind].toLowerCase()} for ${this.fmtDate(it.date)}? It was NOT accepted by the server and will be deleted from this phone.`)) return;
    this.obSet(key, null);
    this.baseSet(key, null);
  },

  /** Send every pending record (oldest day first, attendance before its report). */
  async flushOutbox() {
    if (this._flushing || !api.session() || !api.online()) return;
    this._flushing = true;
    try {
      const order = k => this._ob[k].date + (this._ob[k].kind === 'att' ? '0' : '1');
      for (const key of Object.keys(this._ob).sort((a, b) => order(a).localeCompare(order(b)))) {
        const it = this._ob[key];
        if (it && it.state === 'pending') await this.sendItem(key, false);
        if (!api.session()) break;
      }
    } finally { this._flushing = false; }
  },

  /** Send one record. Only the person who queued it can send it. */
  sendItem(key, manual) {
    if (this._sending[key]) return this._sending[key];
    const job = (async () => {
      const it = this._ob[key], sess = api.session();
      if (!it || !sess) return;
      if (it.userId !== sess.user.userId) { if (manual) this.toast('This was queued by someone else — they need to sign in to send it', 'err'); return; }
      if (!api.online()) { this.obSet(key, { ...it, state: 'pending', error: 'No signal' }); if (manual) this.toast(`No signal — ${KINDS[it.kind].toLowerCase()} stays Pending sync and sends automatically`, 'info'); return; }
      this.obSet(key, { ...it, state: 'syncing', error: '' });
      if (manual) this.setState({ busy: it.kind });
      let sentNow = false;
      try {
        let action, body;
        if (it.kind === 'att') { action = 'saveAttendance'; body = { people: it.payload.people, reason: it.payload.reason || '' }; }
        else {
          action = 'submitReport';
          await this.uploadPhotosFor(it.teamId, it.date);
          const ph = it.date === this.state.today ? this.state.photos[it.teamId] || {} : null;
          const idOf = (k, f) => (ph ? (ph[k] && ph[k][f]) || '' : it.payload[k + (f === 'photoId' ? 'PhotoId' : 'ClientId')] || '');
          body = { report: it.payload.report, beforePhotoId: idOf('before', 'photoId'), beforeClientId: idOf('before', 'clientId'), afterPhotoId: idOf('after', 'photoId'), afterClientId: idOf('after', 'clientId') };
        }
        sentNow = true;
        const r = await api.call(action, { teamId: it.teamId, reportDate: it.date, ...body, baseRev: it.baseRev, requestId: it.reqId });
        this.confirmItem(key, it, r);
      } catch (e) {
        this.failItem(key, { ...it, sent: it.sent || (sentNow && !e.notSent) }, e, manual);
      } finally { if (manual) this.setState({ busy: null }); }
    })();
    this._sending[key] = job;
    job.finally(() => { delete this._sending[key]; });
    return job;
  },

  confirmItem(key, it, r) {
    this.obSet(key, null);
    this.baseSet(key, null);
    this.bumpBase(it.teamId, it.date, it.baseRev, r.rev);
    const id = it.teamId, today = it.date === this.state.today;
    if (it.kind === 'att') {
      if (today) this.setState(s => {
        const same = (s.crews[id] || []).every(m => { const a = s.att[id][m.name], p = it.payload.people.find(x => x.personId === m.id); return p && a && a.status === p.status && (a.note || '') === (p.note || ''); });
        return { attAt: { ...s.attAt, [id]: api.timeOf(r.attendanceSubmittedAt) }, attDirty: { ...s.attDirty, [id]: same ? false : s.attDirty[id] }, attErr: { ...s.attErr, [id]: false } };
      }, () => this.persist());
      this.toast(r.unchanged ? 'Attendance unchanged — already saved in Google Sheet' : today ? 'Attendance submitted and saved to Google Sheet' : `Attendance for ${this.fmtDate(it.date)} saved to Google Sheet`);
    } else {
      if (today) {
        const at = api.timeOf(r.submittedAt);
        this.setState(s => ({ actAt: { ...s.actAt, [id]: at }, showErr: { ...s.showErr, [id]: false }, saved: { ...s.saved, [id]: { ...s.forms[id] } }, draftAt: { ...s.draftAt, [id]: at } }), () => this.persist());
      }
      this.toast(today ? 'Report submitted — admin can see it now' : `Report for ${this.fmtDate(it.date)} submitted to Google Sheet`);
    }
    if (r.replay) this.refresh(true);
  },

  failItem(key, it, e, manual) {
    const what = KINDS[it.kind], today = it.date === this.state.today;
    if (e.offline || e.retry) {
      this.obSet(key, { ...it, state: 'pending', error: e.message });
      if (manual) this.toast(`${what} NOT confirmed — ${e.message} It stays on this phone as Pending sync and is re-sent automatically.`, 'err');
    } else if (e.auth) {
      this.obSet(key, { ...it, state: 'pending', error: 'Sign in again to send' });
      this.liveError(e);
    } else if (e.conflict) {
      this.obSet(key, { ...it, state: 'conflict', error: e.message });
      this.toast(e.message, 'err');
      // Once the phone has the server's copy, the next deliberate submit is judged against it.
      this.refresh(true).then(() => { if (today) this.baseSet(key, (this.state.rev || {})[it.teamId] || '0'); });
    } else {
      this.obSet(key, { ...it, state: 'rejected', error: e.message });
      if (today && e.missing) this.up(it.kind === 'att' ? 'attErr' : 'showErr', it.teamId, () => true);
      this.toast(e.message, 'err');
      if (e.needReason || /already submitted/i.test(e.message)) this.refresh(true);
    }
  },

  /** What is still on this phone, for the admin's view (sent with each load). */
  queueSummary() {
    const out = Object.values(this._ob || {}).map(it => ({ kind: it.kind, date: it.date, state: it.state, error: it.error || '' }));
    const s = this.state;
    this.constructor.T.forEach(t => ['before', 'after'].forEach(k => {
      const p = s.photos[t.id] && s.photos[t.id][k];
      if (p && p.pending) out.push({ kind: 'photo', date: p.date || s.today, state: p.rejected ? 'failed' : 'pending', error: p.rejected || p.error || '' });
    }));
    Object.values(this._failedPhotos || {}).forEach(f => out.push({ kind: 'photo', date: f.date, state: 'failed', error: f.error }));
    return out.slice(0, 20);
  },

  /** Request IDs for one-off actions (reopen) survive a crash or reload. */
  reqId(key) {
    if (!this._reqs[key]) { this._reqs[key] = api.uuid(); api.saveLocal('reqs', this._reqs); }
    return this._reqs[key];
  },
  doneReq(key) { delete this._reqs[key]; api.saveLocal('reqs', this._reqs); },

  liveError(e, fallback) {
    if (e && e.auth) {
      this.setState({ screen: 'login', user: null, pin: '', pinError: false, loginMsg: e.message });
      return;
    }
    this.toast((e && e.message) || fallback || 'Something went wrong', 'err');
  },

  async refresh(quiet) {
    if (!api.session()) return;
    if (!api.online()) { if (!quiet) this.toast('No signal — showing what is saved on this phone', 'err'); return; }
    try {
      this.setState({ loading: true });
      const d = await api.call('load', { days: 30, outbox: this.queueSummary() });
      this._lastLoad = Date.now();
      // Who is signed in comes from the server, not from the copy kept in localStorage.
      const u = this.liveUser(d.user), cur = this.state.user;
      if (u && (!cur || cur.screen !== u.screen || cur.role !== u.role)) {
        api.setSessionUser(d.user);
        this.setState(s => ({ user: u, screen: s.screen === 'login' ? s.screen : u.screen }));
      }
      await new Promise(res => this.applyServer(d, res));
      if (!quiet) this.toast('Updated from Google Sheet', 'info');
      this.flushOutbox();
    } catch (e) {
      this.setState({ loadErr: e.message });
      if (!quiet || e.auth) this.liveError(e);
    } finally { this.setState({ loading: false }); }
  },

  /** Use the server's team list (it may have changed); teams new to this phone get a fresh slice of state. */
  useTeams(s, list) {
    const T = teamsFrom(list);
    if (!T.length) return s;
    this.constructor.T = T;
    api.saveLocal('teams', list);
    const missing = T.filter(t => !s.crews[t.id]);
    if (!missing.length) return s;
    const o = { crews: {}, att: {}, attAt: {}, actAt: {}, forms: {}, photos: {}, tabs: {}, showErr: {}, attErr: {}, newMember: {}, draftAt: {}, attDirty: {} };
    const D = this.lsGet('day.' + s.today), R = this.lsGet('roster');
    missing.forEach(t => this.teamSlices(t, D && typeof D === 'object' ? D : {}, R && typeof R === 'object' ? R : {}, o));
    const next = { ...s, saved: { ...s.saved } };
    Object.keys(o).forEach(k => { next[k] = { ...s[k], ...o[k] }; });
    missing.forEach(t => { next.saved[t.id] = { ...o.forms[t.id] }; });
    return next;
  },

  /** Replace team data with what the server has. Unsent drafts, attendance marks, photos and queued records are kept. */
  applyServer(d, done) {
    const today = d.today;
    this.setState(s0 => {
      let s = this.useTeams(s0, d.teams);
      // App left open past midnight: start a clean day. The previous day's draft stays saved on
      // the phone under its own date, and its queued records still send for their own date.
      const newDay = today !== s.today;
      if (newDay) {
        s = { ...s, forms: { ...s.forms }, saved: { ...s.saved }, photos: { ...s.photos }, att: { ...s.att }, attDirty: {}, draftAt: {}, attAt: {}, actAt: {} };
        this.constructor.T.forEach(t => {
          const f = s.forms[t.id] || {};
          s.forms[t.id] = { from: f.from, to: f.to, location: '', details: '', status: 'ONGOING', targetLoc: '', actualLoc: '', unit: f.unit || t.unit, plate: f.plate, targetMH: f.targetMH, actualMH: '', remarks: '' };
          s.saved[t.id] = { ...s.forms[t.id] };
          // Photos still waiting to upload stay in IndexedDB and upload for their own day (see uploadPendingPhotos).
          s.photos[t.id] = { before: null, after: null };
          s.att[t.id] = {};
        });
      }
      const next = { crews: { ...s.crews }, att: { ...s.att }, attAt: { ...s.attAt }, actAt: { ...s.actAt }, forms: { ...s.forms }, saved: { ...s.saved }, photos: { ...s.photos }, rev: { ...s.rev } };
      let removed = s.removed.slice();
      const arch = { ...this.arch };
      this.constructor.T.forEach(t => {
        const id = t.id, team = d.teams.find(x => x.teamId === id);
        if (!team) return;
        const roster = d.roster.filter(m => m.teamId === id);
        if (roster.length) {
          next.crews[id] = roster.filter(m => m.status === 'Active')
            .sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3))
            .map(m => ({ name: m.name, role: m.role, id: m.personId }));
          removed = removed.filter(r => r.teamId !== id).concat(roster.filter(m => m.status === 'Archived').map(m => ({
            teamId: id, name: m.name, role: m.role, id: m.personId, removedOn: (m.archivedAt || today).slice(0, 10), removedAt: api.timeOf(m.archivedAt) || '', lastAttendance: null })));
        }
        const rep = d.reports.find(r => r.teamId === id && r.reportDate === today);
        next.rev[id] = rep ? String(rep.rev || '0') : '0';
        const rows = d.attendance.filter(a => a.teamId === id && a.reportDate === today);
        const local = (newDay ? {} : s.att[id]) || {}, a = {};
        next.crews[id].forEach(m => {
          const row = rows.find(r => r.personId === m.id);
          // Marks changed on this phone and not yet sent win over the server copy.
          a[m.name] = s.attDirty[id] && local[m.name] ? local[m.name] : row ? { status: row.status, note: row.note || '' } : (local[m.name] || null);
        });
        next.att[id] = a;
        next.attAt[id] = rep && rep.attendanceSubmittedAt ? api.timeOf(rep.attendanceSubmittedAt) : null;
        const submitted = !!(rep && rep.state === 'submitted');
        next.actAt[id] = submitted ? api.timeOf(rep.submittedAt) : null;
        // A queued report is never dropped here, even if the server shows one as submitted: re-sending it
        // (same request ID) confirms it if it was this phone's, or shows "Not accepted" if another phone's.
        if (submitted || (rep && Number(rep.version) > 0 && !s.draftAt[id])) {
          next.forms[id] = fromServerForm(rep, s.forms[id]);
          next.saved[id] = { ...next.forms[id] };
        }
        const ph = { ...(s.photos[id] || {}) };
        ['before', 'after'].forEach(k => {
          const cur = ph[k];
          if (cur && cur.pending) return;                           // taken offline, not uploaded yet
          const p = d.photos.find(x => x.teamId === id && x.reportDate === today && x.type === k);
          ph[k] = p ? { name: p.originalFilename || k + '.jpg', time: api.timeOf(p.uploadedAt), url: cur && cur.photoId === p.photoId && cur.url ? cur.url : p.thumbnailUrl, photoId: p.photoId, clientId: p.clientId, uploaded: true } : null;
        });
        next.photos[id] = ph;
        Object.keys(arch).forEach(k => { if (arch[k].teamId === id) delete arch[k]; });
        d.reports.filter(r => r.teamId === id && r.reportDate < today && r.state === 'submitted').forEach(r => {
          arch[r.reportDate + '|' + id] = { date: r.reportDate, teamId: id, location: r.location, details: r.activityDetails, status: r.status === 'Complete' ? 'COMPLETE' : 'ONGOING',
            att: r.crewPresent, photos: (r.beforePhotoId ? 1 : 0) + (r.afterPhotoId ? 1 : 0), submittedAt: api.timeOf(r.submittedAt) };
        });
      });
      this.arch = arch;
      const added = s !== s0 ? { tabs: s.tabs, showErr: s.showErr, attErr: s.attErr, newMember: s.newMember, draftAt: s.draftAt, attDirty: s.attDirty } : {};
      return { ...added, ...next, removed, today, ...(newDay ? { draftAt: {}, attDirty: {}, showErr: {}, attErr: {} } : {}), sheetUrl: d.sheetUrl || s.sheetUrl, lastLoad: this.now(), loadErr: null,
        phoneQueue: d.phoneQueue || {}, auditFailures: d.auditFailures || null };
    }, () => {
      // Forget conflict-check bases from earlier days that have nothing queued.
      Object.keys(this._base).forEach(k => { if (!k.endsWith('|' + today) && !this._ob[k]) this.baseSet(k, null); });
      this.persist(); this.lsSet('archive', this.arch);
      if (done) done();
    });
  },

  /** Previews of photos waiting to upload are kept in IndexedDB; put them back on screen after a reload. */
  async loadPhotoPreviews() {
    for (const t of this.constructor.T) for (const k of ['before', 'after']) {
      const p = this.state.photos[t.id] && this.state.photos[t.id][k];
      if (!p || !p.pending || !p.clientId || p.url) continue;
      let rec = null;
      try { rec = await idb.get('ph:' + p.clientId); } catch (e) {}
      this.setState(s => {
        const cur = s.photos[t.id][k];
        if (!cur || cur.clientId !== p.clientId) return null;
        return { photos: { ...s.photos, [t.id]: { ...s.photos[t.id], [k]: rec && typeof rec.preview === 'string' ? { ...cur, url: rec.preview } : { ...cur, lost: true } } } };
      });
    }
  },

  async livePress(pin) {
    if (!api.online()) { this.setState({ pin: '', loginMsg: 'No signal. Signing in needs signal.' }); return; }
    this.setState({ pin, busy: 'login', loginMsg: null });
    try {
      const u = await api.login(pin);
      // A leadman's own team is known straight away (the full list arrives with the first load).
      if (u.role === 'leadman' && !this.constructor.T.some(t => t.id === u.teamId)) {
        this.setState(s => this.useTeams(s, [{ teamId: u.teamId, name: u.team, short: u.short, leadman: u.name }]));
      }
      this.setState({ user: this.liveUser(u), pinError: false, busy: null });
    } catch (e) {
      if (e.wrongPin) { this.setState({ pinError: true, busy: null }); setTimeout(() => this.setState({ pin: '', pinError: false }), 900); }
      else this.setState({ pin: '', busy: null, loginMsg: e.message });
    }
  },

  liveProceed() {
    const u = this.state.user; if (!u) return;
    this.setState({ screen: u.screen });
    this.refresh(true);
  },

  liveLogout() {
    const s = this.state;
    const waiting = this.constructor.T.some(t => ['before', 'after'].some(k => s.photos[t.id] && s.photos[t.id][k] && s.photos[t.id][k].pending));
    const queued = Object.keys(this._ob || {}).length;
    if ((waiting || queued) && !window.confirm(`${queued ? queued + ' report/attendance record(s) not confirmed by the server yet' : 'Some photos have not uploaded yet'}. They stay on this phone and send after you sign in again. Log out?`)) return;
    api.logout();
    this.setState({ screen: 'login', user: null, pin: '', pinError: false, loginMsg: null });
  },

  async liveSubmitAtt(id) {
    if (this._inflight) return;                      // a double tap sends once
    const s = this.state, key = 'att|' + id + '|' + s.today, cur = this._ob[key];
    if (cur && (cur.state === 'pending' || cur.state === 'syncing')) return this.sendItem(key, true);
    const people = s.crews[id].map(m => { const a = s.att[id][m.name]; return { personId: m.id, status: a ? a.status : '', note: a ? a.note || '' : '' }; });
    if (people.some(p => !p.personId)) { this.refresh(true); return this.toast('Loading the crew list from Google Sheet — try again in a moment', 'err'); }
    let reason = '';
    if (s.attAt[id]) {
      reason = (window.prompt('Attendance was already submitted. Why is it changing? (kept in the audit log)') || '').trim();
      if (reason.length < 3) return this.toast('Attendance NOT changed — a reason is needed', 'info');
    }
    this._inflight = true;
    try {
      if (!this.queue('att', id, { people, reason })) return;
      if (!api.online()) return this.toast('No signal — attendance saved on this phone as Pending sync. It sends automatically when there is signal.', 'info');
      await this.sendItem(key, true);
    } finally { this._inflight = false; }
  },

  /** Text stamped on the uploaded evidence copy of a photo. */
  watermark(id, key, captured) {
    const t = this.constructor.T.find(x => x.id === id), f = this.state.forms[id];
    const u = this.state.user;
    return [`${key === 'before' ? 'BEFORE' : 'AFTER'} WORK · ${t.short} · NLEX`, `${captured} (Manila) · ${u ? u.name : t.leadman}`, (f.location || '').trim() || 'Location not entered yet'];
  },

  async liveOnFile(id, key, f) {
    const s = this.state, sess = api.session();
    // Capture time: the photo file's own time if recent, else now — phone clock corrected by the server's, in Manila time.
    const recent = f.lastModified && Math.abs(Date.now() - f.lastModified) < 7 * 86400000;
    const captured = api.manilaStamp(recent ? f.lastModified + api.clockSkew() : api.nowMs());
    let preview, full;
    try {
      preview = await this.thumb(f);
      full = await this.thumb(f, 1600, 0.82, this.watermark(id, key, captured));
      if (full.length * 0.75 > MAX_UPLOAD) full = await this.thumb(f, 1280, 0.6, this.watermark(id, key, captured));
      if (full.length * 0.75 > MAX_UPLOAD) return this.toast('That photo is too large even after compressing — take it again', 'err');
    } catch (err) { return this.toast('Could not read that photo — try again (JPEG, PNG or WebP)', 'err'); }
    const clientId = api.uuid();
    const rec = { clientId, teamId: id, date: s.today, type: key, dataUrl: full, preview, name: f.name, capturedAt: captured, location: (s.forms[id].location || '').trim(), userId: sess ? sess.user.userId : '' };
    try { await idb.put('ph:' + clientId, rec); }
    catch (e) { return this.toast(idb.isQuota(e) ? 'Phone storage full — photo NOT saved. Free up space, then take it again.' : 'Could not save the photo on this phone — try again', 'err'); }
    const old = this.state.photos[id][key];
    if (old && old.pending && old.clientId) idb.del('ph:' + old.clientId).catch(() => {});
    const photo = { name: f.name, url: preview, time: this.now(), clientId, pending: true, uploaded: false, date: s.today, capturedAt: captured, userId: rec.userId };
    this.setState(st => ({ photos: { ...st.photos, [id]: { ...st.photos[id], [key]: photo } } }), () => {
      this.persist();
      if (api.online()) this.uploadPhoto(id, key);
      else this.toast('No signal — photo kept on this phone. It uploads when you have signal.', 'info');
    });
  },

  /** A pending photo may only be uploaded with the sign-in of the person who took it. */
  mayUpload(rec) {
    const sess = api.session(); if (!sess) return false;
    return rec.userId ? rec.userId === sess.user.userId : sess.user.role === 'leadman' && rec.teamId === sess.user.teamId;
  },

  async uploadPhoto(id, key, quiet) {
    const p = this.state.photos[id][key];
    if (!p || !p.pending) return true;
    if (p.rejected || p.lost) return false;
    this._uploading = this._uploading || {};
    const tag = id + key;
    if (this._uploading[tag]) return this._uploading[tag];
    const setCur = patch => new Promise(res => this.setState(s => {
      const cur = s.photos[id][key];
      if (!cur || cur.clientId !== p.clientId) return null;       // replaced meanwhile
      return { photos: { ...s.photos, [id]: { ...s.photos[id], [key]: patch(cur) } } };
    }, res));
    const job = (async () => {
      let rec = null;
      try { rec = await idb.get('ph:' + p.clientId); } catch (e) {}
      if (!rec || typeof rec.dataUrl !== 'string') {
        await setCur(cur => ({ ...cur, lost: true, error: 'Photo is missing on this phone — take it again' }));
        this.persist();
        if (!quiet) this.toast('Photo is missing on this phone — take it again', 'err');
        return false;
      }
      if (!this.mayUpload({ ...rec, userId: rec.userId || p.userId })) return false;
      try {
        const r = await api.call('uploadPhoto', { teamId: id, reportDate: rec.date, type: key, clientId: rec.clientId, dataUrl: rec.dataUrl,
          originalFilename: rec.name, capturedAt: rec.capturedAt, location: rec.location }, { timeout: 90000 });
        await setCur(cur => ({ name: p.name, url: cur.url, time: api.timeOf(r.photo.uploadedAt), photoId: r.photo.photoId, clientId: p.clientId, uploaded: true }));
        idb.del('ph:' + p.clientId).catch(() => {});
        this.persist();
        this.toast((key === 'before' ? 'Before' : 'After') + ' photo uploaded to Google Drive');
        return true;
      } catch (e) {
        // No signal / server busy: retried automatically. Refused by the server: never retried (retake or remove it).
        const refused = !(e.offline || e.retry || e.auth);
        await setCur(cur => ({ ...cur, error: e.message, ...(refused ? { rejected: e.message } : {}) }));
        this.persist();
        if (e.auth) this.liveError(e);
        else if (refused) this.toast('Photo refused by the server: ' + e.message, 'err');
        else if (!quiet) this.toast('Photo not uploaded yet — it stays on this phone and retries automatically. ' + (e.offline ? '' : e.message), 'err');
        return false;
      } finally { delete this._uploading[tag]; }
    })();
    this._uploading[tag] = job;
    return job;
  },

  /** Before a report is sent: upload that day's photos first (the server checks they are there). */
  async uploadPhotosFor(teamId, date) {
    if (date !== this.state.today) return this.uploadPendingPhotos(true);
    for (const k of ['before', 'after']) {
      const p = this.state.photos[teamId] && this.state.photos[teamId][k];
      if (p && p.pending && !p.rejected && !p.lost && !(await this.uploadPhoto(teamId, k, true))) {
        const now = this.state.photos[teamId][k];
        if (!(now && now.rejected)) throw new api.ApiError('Photos have not uploaded yet — the report waits for them.', { offline: true, notSent: true });
      }
    }
    return true;
  },

  /**
   * Upload everything waiting in IndexedDB. Photos on today's form update the screen; photos from an
   * earlier day (app left open past midnight, or state lost in a crash) still upload for their own day.
   */
  async uploadPendingPhotos(quiet) {
    if (!api.session() || !api.online() || this._sweeping) return true;
    this._sweeping = true;
    let ok = true;
    try {
      for (const t of this.constructor.T) for (const k of ['before', 'after']) {
        const p = this.state.photos[t.id] && this.state.photos[t.id][k];
        if (p && p.pending && !p.lost && !p.rejected) ok = (await this.uploadPhoto(t.id, k, quiet)) && ok;
      }
      let keys = [];
      try { keys = await idb.keys(); } catch (e) { return ok; }
      for (const key of keys) {
        if (typeof key !== 'string' || !key.startsWith('ph:')) continue;
        const rec = await idb.get(key).catch(() => null);
        if (!rec || typeof rec.dataUrl !== 'string' || this._failedPhotos[rec.clientId] || !this.mayUpload(rec)) continue;
        const cur = this.state.photos[rec.teamId] && this.state.photos[rec.teamId][rec.type];
        if (cur && cur.clientId === rec.clientId) continue;       // on screen: handled above
        try {
          await api.call('uploadPhoto', { teamId: rec.teamId, reportDate: rec.date, type: rec.type, clientId: rec.clientId, dataUrl: rec.dataUrl,
            originalFilename: rec.name, capturedAt: rec.capturedAt, location: rec.location }, { timeout: 90000 });
          await idb.del(key);
        } catch (e) {
          ok = false;
          if (e.auth) { this.liveError(e); break; }
          // Refused (e.g. that day is now locked): stop retrying, keep the file, and tell the admin.
          if (!(e.offline || e.retry)) { this._failedPhotos[rec.clientId] = { date: rec.date, error: e.message.slice(0, 120) }; api.saveLocal('failedPhotos', this._failedPhotos); }
        }
      }
    } finally { this._sweeping = false; }
    return ok;
  },

  async liveRemovePhoto(id, k) {
    const p = this.state.photos[id][k];
    if (p && p.uploaded) {
      if (!api.online()) return this.toast('No signal — cannot remove an uploaded photo now', 'err');
      try { await api.call('removePhoto', { teamId: id, reportDate: this.state.today, photoId: p.photoId }); }
      catch (e) { return this.liveError(e, 'Photo not removed'); }
    } else if (p && p.clientId) idb.del('ph:' + p.clientId).catch(() => {});
    this.upP('photos', id, o => ({ ...o, [k]: null }), 'Photo removed', 'info');
  },

  async liveSubmitAct(id) {
    if (this._inflight) return;                      // a double tap sends once
    const key = 'act|' + id + '|' + this.state.today, cur = this._ob[key];
    if (cur && (cur.state === 'pending' || cur.state === 'syncing')) return this.sendItem(key, true);
    const v = this.validate(id, this.state);
    if (v.list.length) { this.up('showErr', id, () => true); this.toast(v.list.length > 1 ? `${v.list.length} items need attention` : '1 item needs attention', 'err'); setTimeout(() => this.scrollToId('act-errors'), 60); return; }
    const attKey = 'att|' + id + '|' + this.state.today, att = this._ob[attKey];
    if (att && att.state !== 'pending' && att.state !== 'syncing') return this.toast('Attendance was not accepted — fix it on the Attendance tab first', 'err');
    this.saveDraft(id, true);
    this._inflight = true;
    try {
      const ph = this.state.photos[id];
      const pid = (k, f) => (ph[k] && ph[k][f]) || '';
      if (!this.queue('act', id, { report: toServerForm(this.state.forms[id]), beforePhotoId: pid('before', 'photoId'), beforeClientId: pid('before', 'clientId'), afterPhotoId: pid('after', 'photoId'), afterClientId: pid('after', 'clientId') })) return;
      if (!api.online()) return this.toast('No signal — report saved on this phone as Pending sync. It sends automatically when there is signal (NOT submitted yet).', 'info');
      if (att) await this.sendItem(attKey, false);   // attendance goes first
      await this.sendItem(key, true);
    } finally { this._inflight = false; }
  },

  async liveEditAct(id) {
    if (this._inflight) return;
    if (!api.online()) return this.toast('No signal — the report stays submitted. Try again when you have signal.', 'err');
    const reason = (window.prompt('Why does the submitted report need to change? (kept in the audit log)') || '').trim();
    if (reason.length < 3) return this.toast('Report stays submitted — a reason is needed to edit it', 'info');
    const s = this.state, rk = 'reopen|' + id + '|' + s.today, from = (s.rev || {})[id] || '0';
    this._inflight = true;
    this.setState({ busy: 'edit' });
    try {
      const r = await api.call('reopenReport', { teamId: id, reportDate: s.today, reason, baseRev: from, requestId: this.reqId(rk) });
      this.doneReq(rk);
      this.baseSet('act|' + id + '|' + s.today, r.rev);
      this.bumpBase(id, s.today, from, r.rev);
      this.setState(st => ({ actAt: { ...st.actAt, [id]: null } }), () => { if (this.persist()) this.toast('Report unlocked — submit again when done', 'info'); });
    } catch (e) {
      if (!(e.offline || e.retry)) this.doneReq(rk);
      if (e.conflict) { this.toast(e.message, 'err'); this.refresh(true); }
      else this.liveError(e, 'Could not unlock the report');
    } finally { this._inflight = false; this.setState({ busy: null }); }
  },

  async liveRoster(action, data, okMsg) {
    if (!api.online()) return this.toast('No signal — crew changes need signal', 'err');
    this.setState({ busy: 'roster' });
    try { await api.call(action, data); this.toast(okMsg); await this.refresh(true); return true; }
    catch (e) { this.liveError(e); return false; }
    finally { this.setState({ busy: null }); }
  },

  async liveExport() {
    if (!api.online()) return this.toast('No signal — export needs signal', 'err');
    const { from, to } = this.state.adminRange;
    this.setState({ busy: 'export' });
    try {
      const r = await api.call('exportCsv', { from, to }, { timeout: 90000 });
      const csv = '﻿' + r.csv;
      const le = { name: r.filename, rows: r.rows, at: this.now(), csv, ok: false, xlsxUrl: r.xlsxUrl };
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = r.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      le.ok = true;
      this.setState({ lastExport: le });
      this.toast(`Download requested: ${r.filename} (${r.rows} reports, ${r.from} to ${r.to})`, 'info');
    } catch (e) { this.liveError(e, 'Export failed'); }
    finally { this.setState({ busy: null }); }
  },

  async liveAdminCall(view, action, data) {
    if (!api.online()) return this.toast('No signal — try again when you have signal', 'err');
    this.setState({ busy: view });
    try {
      const r = await api.call(action, data, { timeout: 90000 });
      this.setState(s => ({ adminView: view === 'revisions' ? s.adminView : view, adminData: { ...s.adminData, [view]: r }, ...(r.auditFailures !== undefined ? { auditFailures: r.auditFailures } : {}) }));
    } catch (e) { this.liveError(e); }
    finally { this.setState({ busy: null }); }
  },
  liveAdminReports() { const { from, to } = this.state.adminRange; return this.liveAdminCall('reports', 'adminReports', { from, to }); },
  liveAuditLog() { const { from, to } = this.state.adminRange; return this.liveAdminCall('audit', 'auditLog', { from, to, teamId: this.state.adminTab === 'all' ? '' : this.state.adminTab }); },
  liveRevisions(reportId) { return this.liveAdminCall('revisions', 'revisions', { reportId }); },
};
