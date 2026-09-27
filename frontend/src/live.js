// Live (backend) behaviour for the app's Component.
//
// The design's logic in App.jsx stays as it was; each action that must reach
// the server checks `this.live` and hands off to the methods here. Rules:
//  - Nothing is shown as submitted until the server confirms it.
//  - With no signal (or no answer from Google), form fields, attendance marks and photos stay
//    on the phone. Photos wait in IndexedDB and upload as soon as the server answers.
//  - Every write carries a request ID that is reused on retry, and the revision the phone last
//    saw, so a retry or a double tap never saves twice and another device's changes are not overwritten.
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

const ROLE_ORDER = { Leadman: 0, Skilled: 1, Crew: 2 };
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const liveMethods = {
  liveUser(u) {
    if (!u) return null;
    if (u.role === 'admin') return { name: u.name, initials: 'OA', role: 'Admin', team: u.team, screen: 'admin', cta: 'Open command center' };
    return { name: u.name, initials: this.initials(u.name), role: 'Leadman', team: u.team, screen: u.teamId, cta: "Start today's report" };
  },

  liveMount() {
    this._reqs = api.loadLocal('reqs') || {};
    this._online = () => { this.setState({ online: true }); this.uploadPendingPhotos(true); this.refresh(true); };
    this._offline = () => this.setState({ online: false });
    window.addEventListener('online', this._online);
    window.addEventListener('offline', this._offline);
    // Admin screen follows the field in near real time; leadman screens refresh less often.
    // Photos that failed to upload are retried every minute.
    this._poll = setInterval(() => {
      if (!api.session() || !api.online()) return;
      this.uploadPendingPhotos(true);
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

  /** Request IDs survive a crash or reload, so the retry of an unconfirmed submit is recognised by the server. */
  reqId(key) {
    if (!this._reqs[key]) { this._reqs[key] = api.uuid(); api.saveLocal('reqs', this._reqs); }
    return this._reqs[key];
  },
  doneReq(key) { delete this._reqs[key]; api.saveLocal('reqs', this._reqs); },
  unconfirmed(key) { return !!(this._reqs && this._reqs[key]); },

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
      const d = await api.call('load', { days: 30 });
      this._lastLoad = Date.now();
      // Who is signed in comes from the server, not from the copy kept in localStorage.
      const u = this.liveUser(d.user), cur = this.state.user;
      if (u && (!cur || cur.screen !== u.screen || cur.role !== u.role)) {
        api.setSessionUser(d.user);
        this.setState(s => ({ user: u, screen: s.screen === 'login' ? s.screen : u.screen }));
      }
      this.applyServer(d);
      if (!quiet) this.toast('Updated from Google Sheet', 'info');
    } catch (e) {
      this.setState({ loadErr: e.message });
      if (!quiet || e.auth) this.liveError(e);
    } finally { this.setState({ loading: false }); }
  },

  /** Replace team data with what the server has. Unsent drafts, attendance marks and photos are kept. */
  applyServer(d) {
    const today = d.today;
    this.setState(s => {
      // App left open past midnight: start a clean day. The previous day's draft stays
      // saved on the phone under its own date.
      const newDay = today !== s.today;
      if (newDay) {
        s = { ...s, forms: { ...s.forms }, saved: { ...s.saved }, photos: { ...s.photos }, att: { ...s.att }, attDirty: {}, draftAt: {} };
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
        if (submitted) this.doneReq('act|' + id + '|' + today);
        if (submitted || (rep && Number(rep.version) > 0 && !s.draftAt[id])) {
          next.forms[id] = fromServerForm(rep, s.forms[id]);
          next.saved[id] = { ...next.forms[id] };
        }
        const ph = { ...(s.photos[id] || {}) };
        ['before', 'after'].forEach(k => {
          const cur = ph[k];
          if (cur && cur.pending) return;                           // taken offline, not uploaded yet
          const p = d.photos.find(x => x.teamId === id && x.reportDate === today && x.type === k);
          ph[k] = p ? { name: p.originalFilename || k + '.jpg', time: api.timeOf(p.uploadedAt), url: cur && cur.photoId === p.photoId && cur.url ? cur.url : p.thumbnailUrl, photoId: p.photoId, uploaded: true } : null;
        });
        next.photos[id] = ph;
        Object.keys(arch).forEach(k => { if (arch[k].teamId === id) delete arch[k]; });
        d.reports.filter(r => r.teamId === id && r.reportDate < today && r.state === 'submitted').forEach(r => {
          arch[r.reportDate + '|' + id] = { date: r.reportDate, teamId: id, location: r.location, details: r.activityDetails, status: r.status === 'Complete' ? 'COMPLETE' : 'ONGOING',
            att: r.crewPresent, photos: (r.beforePhotoId ? 1 : 0) + (r.afterPhotoId ? 1 : 0), submittedAt: api.timeOf(r.submittedAt) };
        });
      });
      this.arch = arch;
      return { ...next, removed, today, ...(newDay ? { draftAt: {}, attDirty: {}, showErr: {}, attErr: {} } : {}), sheetUrl: d.sheetUrl || s.sheetUrl, lastLoad: this.now(), loadErr: null };
    }, () => { this.persist(); this.lsSet('archive', this.arch); });
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
        return { photos: { ...s.photos, [t.id]: { ...s.photos[t.id], [k]: rec ? { ...cur, url: rec.preview } : { ...cur, lost: true } } } };
      });
    }
  },

  async livePress(pin) {
    if (!api.online()) { this.setState({ pin: '', loginMsg: 'No signal. Signing in needs signal.' }); return; }
    this.setState({ pin, busy: 'login', loginMsg: null });
    try {
      const u = await api.login(pin);
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
    if (waiting && !window.confirm('Some photos have not uploaded yet. They stay on this phone and upload after you sign in again. Log out?')) return;
    api.logout();
    this.setState({ screen: 'login', user: null, pin: '', pinError: false, loginMsg: null });
  },

  async liveSubmitAtt(id) {
    if (this._inflight) return;
    const s = this.state;
    if (!api.online()) return this.toast('No signal — attendance NOT submitted. Your marks are saved on this phone; submit again when you have signal.', 'err');
    const people = s.crews[id].map(m => { const a = s.att[id][m.name]; return { personId: m.id, status: a ? a.status : '', note: a ? a.note || '' : '' }; });
    if (people.some(p => !p.personId)) { this.refresh(true); return this.toast('Loading the crew list from Google Sheet — try again in a moment', 'err'); }
    const key = 'att|' + id + '|' + s.today;
    this._inflight = true;
    this.setState({ busy: 'att' });
    try {
      const r = await api.call('saveAttendance', { teamId: id, reportDate: s.today, people, baseRev: s.rev[id] || '0', requestId: this.reqId(key) });
      this.doneReq(key);
      this.setState(st => ({ rev: { ...st.rev, [id]: r.rev }, attDirty: { ...st.attDirty, [id]: false }, attErr: { ...st.attErr, [id]: false } }));
      this.upP('attAt', id, () => api.timeOf(r.attendanceSubmittedAt), 'Attendance submitted and saved to Google Sheet');
      if (r.replay) this.refresh(true);
    } catch (e) {
      if (e.conflict) { this.doneReq(key); this.toast(e.message, 'err'); this.refresh(true); }
      else if (e.missing) { this.up('attErr', id, () => true); this.toast(e.message, 'err'); }
      else if (e.offline) this.toast('Attendance NOT confirmed — ' + e.message + ' Your marks are saved on this phone.', 'err');
      else this.liveError(e, 'Attendance not submitted');
    } finally { this._inflight = false; this.setState({ busy: null }); }
  },

  /** Text stamped on the uploaded evidence copy of a photo. */
  watermark(id, key, captured) {
    const t = this.constructor.T.find(x => x.id === id), f = this.state.forms[id];
    const u = this.state.user;
    return [`${key === 'before' ? 'BEFORE' : 'AFTER'} WORK · ${t.short} · NLEX`, `${captured} · ${u ? u.name : t.leadman}`, (f.location || '').trim() || 'Location not entered yet'];
  },

  async liveOnFile(id, key, f) {
    const s = this.state;
    const captured = stamp(new Date(f.lastModified && Math.abs(Date.now() - f.lastModified) < 7 * 86400000 ? f.lastModified : Date.now()));
    let preview, full;
    try { preview = await this.thumb(f); full = await this.thumb(f, 1600, 0.82, this.watermark(id, key, captured)); }
    catch (err) { return this.toast('Could not read that photo — try again', 'err'); }
    const clientId = api.uuid();
    const rec = { clientId, teamId: id, date: s.today, type: key, dataUrl: full, preview, name: f.name, capturedAt: captured, location: (s.forms[id].location || '').trim() };
    try { await idb.put('ph:' + clientId, rec); }
    catch (e) { return this.toast(idb.isQuota(e) ? 'Phone storage full — photo NOT saved. Free up space, then take it again.' : 'Could not save the photo on this phone — try again', 'err'); }
    const old = this.state.photos[id][key];
    if (old && old.pending && old.clientId) idb.del('ph:' + old.clientId).catch(() => {});
    const photo = { name: f.name, url: preview, time: this.now(), clientId, pending: true, uploaded: false, date: s.today, capturedAt: captured };
    this.setState(st => ({ photos: { ...st.photos, [id]: { ...st.photos[id], [key]: photo } } }), () => {
      this.persist();
      if (api.online()) this.uploadPhoto(id, key);
      else this.toast('No signal — photo kept on this phone. It uploads when you have signal.', 'info');
    });
  },

  async uploadPhoto(id, key, quiet) {
    const p = this.state.photos[id][key];
    if (!p || !p.pending) return true;
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
      if (!rec) {
        await setCur(cur => ({ ...cur, lost: true, error: 'Photo is missing on this phone — take it again' }));
        this.persist();
        if (!quiet) this.toast('Photo is missing on this phone — take it again', 'err');
        return false;
      }
      try {
        const r = await api.call('uploadPhoto', { teamId: id, reportDate: rec.date, type: key, clientId: rec.clientId, dataUrl: rec.dataUrl,
          originalFilename: rec.name, capturedAt: rec.capturedAt, location: rec.location }, { timeout: 90000 });
        await setCur(cur => ({ name: p.name, url: cur.url, time: api.timeOf(r.photo.uploadedAt), photoId: r.photo.photoId, clientId: p.clientId, uploaded: true }));
        idb.del('ph:' + p.clientId).catch(() => {});
        this.persist();
        this.toast((key === 'before' ? 'Before' : 'After') + ' photo uploaded to Google Drive');
        return true;
      } catch (e) {
        await setCur(cur => ({ ...cur, error: e.message }));
        this.persist();
        if (e.auth) this.liveError(e);
        else if (!quiet) this.toast('Photo not uploaded yet — it stays on this phone and retries automatically. ' + (e.offline ? '' : e.message), 'err');
        return false;
      } finally { delete this._uploading[tag]; }
    })();
    this._uploading[tag] = job;
    return job;
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
        if (p && p.pending && !p.lost) ok = (await this.uploadPhoto(t.id, k, quiet)) && ok;
      }
      let keys = [];
      try { keys = await idb.keys(); } catch (e) { return ok; }
      for (const key of keys) {
        if (typeof key !== 'string' || !key.startsWith('ph:')) continue;
        const rec = await idb.get(key).catch(() => null);
        if (!rec) continue;
        const cur = this.state.photos[rec.teamId] && this.state.photos[rec.teamId][rec.type];
        if (cur && cur.clientId === rec.clientId) continue;       // on screen: handled above
        try {
          await api.call('uploadPhoto', { teamId: rec.teamId, reportDate: rec.date, type: rec.type, clientId: rec.clientId, dataUrl: rec.dataUrl,
            originalFilename: rec.name, capturedAt: rec.capturedAt, location: rec.location }, { timeout: 90000 });
          await idb.del(key);
        } catch (e) { ok = false; if (e.auth) { this.liveError(e); break; } }
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
    if (this._inflight) return;
    const v = this.validate(id, this.state);
    if (v.list.length) { this.up('showErr', id, () => true); this.toast(v.list.length > 1 ? `${v.list.length} items need attention` : '1 item needs attention', 'err'); setTimeout(() => this.scrollToId('act-errors'), 60); return; }
    this.saveDraft(id, true);
    if (!api.online()) return this.toast('No signal — report NOT submitted. It is saved on this phone as a draft; submit again when you have signal.', 'err');
    const key = 'act|' + id + '|' + this.state.today;
    this._inflight = true;
    this.setState({ busy: 'act' });
    try {
      for (const k of ['before', 'after']) {
        if (this.state.photos[id][k] && this.state.photos[id][k].pending && !(await this.uploadPhoto(id, k))) throw new api.ApiError('Photos did not upload — report NOT submitted. They stay on this phone; try again.');
      }
      const ph = this.state.photos[id];
      const r = await api.call('submitReport', { teamId: id, reportDate: this.state.today, report: toServerForm(this.state.forms[id]), baseRev: this.state.rev[id] || '0',
        beforePhotoId: ph.before ? ph.before.photoId : '', afterPhotoId: ph.after ? ph.after.photoId : '', requestId: this.reqId(key) });
      this.doneReq(key);
      const at = api.timeOf(r.submittedAt);
      this.setState(s => ({ actAt: { ...s.actAt, [id]: at }, rev: { ...s.rev, [id]: r.rev }, showErr: { ...s.showErr, [id]: false }, saved: { ...s.saved, [id]: { ...s.forms[id] } }, draftAt: { ...s.draftAt, [id]: at } }), () => {
        this.persist();
        this.toast('Report submitted — admin can see it now');
      });
      if (r.replay) this.refresh(true);
    } catch (e) {
      if (e.missing) { this.up('showErr', id, () => true); this.toast(e.message, 'err'); }
      else if (e.conflict) { this.toast(e.message, 'err'); this.refresh(true); }
      else if (e.offline) this.toast('Report NOT confirmed — ' + e.message + ' It is saved on this phone; tap Submit again.', 'err');
      else this.liveError(e, 'Report not submitted');
    } finally { this._inflight = false; this.setState({ busy: null }); }
  },

  async liveEditAct(id) {
    if (this._inflight) return;
    if (!api.online()) return this.toast('No signal — the report stays submitted. Try again when you have signal.', 'err');
    const reason = (window.prompt('Why does the submitted report need to change? (kept in the audit log)') || '').trim();
    if (reason.length < 3) return this.toast('Report stays submitted — a reason is needed to edit it', 'info');
    this._inflight = true;
    this.setState({ busy: 'edit' });
    try {
      const r = await api.call('reopenReport', { teamId: id, reportDate: this.state.today, reason, baseRev: this.state.rev[id] || '0', requestId: api.uuid() });
      this.setState(s => ({ actAt: { ...s.actAt, [id]: null }, rev: { ...s.rev, [id]: r.rev } }), () => { if (this.persist()) this.toast('Report unlocked — submit again when done', 'info'); });
    } catch (e) {
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
      this.setState(s => ({ adminView: view === 'revisions' ? s.adminView : view, adminData: { ...s.adminData, [view]: r } }));
    } catch (e) { this.liveError(e); }
    finally { this.setState({ busy: null }); }
  },
  liveAdminReports() { const { from, to } = this.state.adminRange; return this.liveAdminCall('reports', 'adminReports', { from, to }); },
  liveAuditLog() { const { from, to } = this.state.adminRange; return this.liveAdminCall('audit', 'auditLog', { from, to, teamId: this.state.adminTab === 'all' ? '' : this.state.adminTab }); },
  liveRevisions(reportId) { return this.liveAdminCall('revisions', 'revisions', { reportId }); },
};
