// Live (backend) behaviour for the app's Component.
//
// The design's logic in App.jsx stays as it was; each action that must reach
// the server checks `this.live` and hands off to the methods here. Rules:
//  - Nothing is shown as submitted until the server confirms it.
//  - With no signal, form fields and photos stay on the phone as a draft.
//  - Photos upload as soon as there is signal; pending ones upload before submit.
import * as api from './api.js';

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

export const liveMethods = {
  liveUser(u) {
    if (!u) return null;
    if (u.role === 'admin') return { name: u.name, initials: 'OA', role: 'Admin', team: u.team, screen: 'admin', cta: 'Open command center' };
    return { name: u.name, initials: this.initials(u.name), role: 'Leadman', team: u.team, screen: u.teamId, cta: "Start today's report" };
  },

  liveMount() {
    this._online = () => { this.setState({ online: true }); this.uploadPendingPhotos(); this.refresh(true); };
    this._offline = () => this.setState({ online: false });
    window.addEventListener('online', this._online);
    window.addEventListener('offline', this._offline);
    // Admin screen follows the field in near real time; leadman screens refresh less often.
    this._poll = setInterval(() => {
      if (!api.session() || !api.online() || this.state.busy) return;
      if (this.state.screen === 'admin' || Date.now() - (this._lastLoad || 0) > 300000) this.refresh(true);
    }, 60000);
    if (api.session()) this.refresh(true);
  },
  liveUnmount() {
    window.removeEventListener('online', this._online);
    window.removeEventListener('offline', this._offline);
    clearInterval(this._poll);
  },

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
      this.applyServer(d);
      if (!quiet) this.toast('Updated from Google Sheet', 'info');
    } catch (e) {
      this.setState({ loadErr: e.message });
      if (!quiet || e.auth) this.liveError(e);
    } finally { this.setState({ loading: false }); }
  },

  /** Replace team data with what the server has. Unsent local drafts and not-yet-uploaded photos are kept. */
  applyServer(d) {
    const today = d.today;
    this.setState(s => {
      // App left open past midnight: start a clean day. The previous day's draft stays
      // saved on the phone under its own date.
      const newDay = today !== s.today;
      if (newDay) {
        s = { ...s, forms: { ...s.forms }, saved: { ...s.saved }, photos: { ...s.photos }, att: { ...s.att }, draftAt: {} };
        this.constructor.T.forEach(t => {
          const f = s.forms[t.id] || {};
          s.forms[t.id] = { from: f.from, to: f.to, location: '', details: '', status: 'ONGOING', targetLoc: '', actualLoc: '', unit: f.unit || t.unit, plate: f.plate, targetMH: f.targetMH, actualMH: '', remarks: '' };
          s.saved[t.id] = { ...s.forms[t.id] };
          s.photos[t.id] = { before: null, after: null };
          s.att[t.id] = {};
        });
      }
      const next = { crews: { ...s.crews }, att: { ...s.att }, attAt: { ...s.attAt }, actAt: { ...s.actAt }, forms: { ...s.forms }, saved: { ...s.saved }, photos: { ...s.photos } };
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
        const rows = d.attendance.filter(a => a.teamId === id && a.reportDate === today);
        const a = {};
        next.crews[id].forEach(m => {
          const row = rows.find(r => r.personId === m.id);
          a[m.name] = row ? { present: row.status === 'Present', reason: row.absenceReason || null } : ((s.att[id] || {})[m.name] || { present: true, reason: null });
        });
        next.att[id] = a;
        next.attAt[id] = rep && rep.attendanceSubmittedAt ? api.timeOf(rep.attendanceSubmittedAt) : null;
        const submitted = !!(rep && rep.state === 'submitted');
        next.actAt[id] = submitted ? api.timeOf(rep.submittedAt) : null;
        if (submitted || (rep && Number(rep.version) > 0 && !s.draftAt[id])) {
          next.forms[id] = fromServerForm(rep, s.forms[id]);
          next.saved[id] = { ...next.forms[id] };
        }
        const ph = { ...(s.photos[id] || {}) };
        ['before', 'after'].forEach(k => {
          const local = ph[k];
          if (local && local.pending) return;                       // taken offline, not uploaded yet
          const p = d.photos.find(x => x.teamId === id && x.reportDate === today && x.type === k);
          ph[k] = p ? { name: p.originalFilename || k + '.jpg', time: api.timeOf(p.uploadedAt), url: local && local.photoId === p.photoId && local.url ? local.url : p.thumbnailUrl, photoId: p.photoId, uploaded: true } : null;
        });
        next.photos[id] = ph;
        Object.keys(arch).forEach(k => { if (arch[k].teamId === id) delete arch[k]; });
        d.reports.filter(r => r.teamId === id && r.reportDate < today && r.state === 'submitted').forEach(r => {
          arch[r.reportDate + '|' + id] = { date: r.reportDate, teamId: id, location: r.location, details: r.activityDetails, status: r.status === 'Complete' ? 'COMPLETE' : 'ONGOING',
            att: r.crewPresent, photos: (r.beforePhotoId ? 1 : 0) + (r.afterPhotoId ? 1 : 0), submittedAt: api.timeOf(r.submittedAt) };
        });
      });
      this.arch = arch;
      return { ...next, removed, today, ...(newDay ? { draftAt: {}, showErr: {}, attErr: {} } : {}), sheetUrl: d.sheetUrl || s.sheetUrl, lastLoad: this.now(), loadErr: null };
    }, () => { this.persist(); this.lsSet('archive', this.arch); });
  },

  async livePress(pin) {
    if (!api.online()) { this.setState({ pin: '', loginMsg: 'No signal. Signing in needs signal the first time.' }); return; }
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
    api.clearSession();
    this.setState({ screen: 'login', user: null, pin: '', pinError: false, loginMsg: null });
  },

  async liveSubmitAtt(id) {
    const s = this.state;
    if (!api.online()) return this.toast('No signal — attendance NOT submitted. Your marks are saved on this phone; submit again when you have signal.', 'err');
    const people = s.crews[id].map(m => { const a = s.att[id][m.name] || { present: true }; return { personId: m.id, status: a.present ? 'Present' : 'Absent', absenceReason: a.present ? '' : a.reason }; });
    if (people.some(p => !p.personId)) { this.refresh(true); return this.toast('Loading the crew list from Google Sheet — try again in a moment', 'err'); }
    this.setState({ busy: 'att' });
    try {
      const r = await api.call('saveAttendance', { teamId: id, reportDate: s.today, people });
      this.up('attErr', id, () => false);
      this.upP('attAt', id, () => api.timeOf(r.attendanceSubmittedAt), 'Attendance submitted and saved to Google Sheet');
    } catch (e) { this.liveError(e, 'Attendance not submitted'); }
    finally { this.setState({ busy: null }); }
  },

  async liveOnFile(id, key, f) {
    let preview, full;
    try { preview = await this.thumb(f); full = await this.thumb(f, 1600, 0.82); }
    catch (err) { return this.toast('Could not read that photo — try again', 'err'); }
    const photo = { name: f.name, url: preview, time: this.now(), pending: full, uploaded: false, date: this.state.today };
    this.setState(s => ({ photos: { ...s.photos, [id]: { ...s.photos[id], [key]: photo } } }), () => {
      this.persist();
      if (api.online()) this.uploadPhoto(id, key);
      else this.toast('No signal — photo kept on this phone. It uploads when you have signal.', 'info');
    });
  },

  async uploadPhoto(id, key) {
    const p = this.state.photos[id][key];
    if (!p || !p.pending) return true;
    this._uploading = this._uploading || {};
    const tag = id + key;
    if (this._uploading[tag]) return this._uploading[tag];
    const job = (async () => {
      try {
        const r = await api.call('uploadPhoto', { teamId: id, reportDate: p.date || this.state.today, type: key, dataUrl: p.pending, originalFilename: p.name }, { timeout: 90000 });
        await new Promise(res => this.setState(s => {
          const cur = s.photos[id][key];
          if (!cur || cur.pending !== p.pending) return null;        // replaced meanwhile
          return { photos: { ...s.photos, [id]: { ...s.photos[id], [key]: { name: p.name, url: p.url, time: api.timeOf(r.photo.uploadedAt), photoId: r.photo.photoId, uploaded: true } } } };
        }, res));
        this.persist();
        this.toast((key === 'before' ? 'Before' : 'After') + ' photo uploaded to Google Drive');
        return true;
      } catch (e) {
        this.liveError(e, 'Photo not uploaded yet — it stays on this phone');
        return false;
      } finally { delete this._uploading[tag]; }
    })();
    this._uploading[tag] = job;
    return job;
  },

  async uploadPendingPhotos() {
    const s = this.state;
    if (!api.session() || !api.online()) return true;
    let ok = true;
    for (const t of this.constructor.T) for (const k of ['before', 'after']) {
      const p = s.photos[t.id] && s.photos[t.id][k];
      if (p && p.pending) ok = (await this.uploadPhoto(t.id, k)) && ok;
    }
    return ok;
  },

  async liveRemovePhoto(id, k) {
    const p = this.state.photos[id][k];
    if (p && p.uploaded) {
      if (!api.online()) return this.toast('No signal — cannot remove an uploaded photo now', 'err');
      try { await api.call('removePhoto', { teamId: id, reportDate: this.state.today, type: k }); }
      catch (e) { return this.liveError(e, 'Photo not removed'); }
    }
    this.upP('photos', id, o => ({ ...o, [k]: null }), 'Photo removed', 'info');
  },

  async liveSubmitAct(id) {
    const v = this.validate(id, this.state);
    if (v.list.length) { this.up('showErr', id, () => true); this.toast(v.list.length > 1 ? `${v.list.length} items need attention` : '1 item needs attention', 'err'); setTimeout(() => this.scrollToId('act-errors'), 60); return; }
    this.saveDraft(id, true);
    if (!api.online()) return this.toast('No signal — report NOT submitted. It is saved on this phone as a draft; submit again when you have signal.', 'err');
    this.setState({ busy: 'act' });
    try {
      for (const k of ['before', 'after']) {
        if (this.state.photos[id][k] && this.state.photos[id][k].pending && !(await this.uploadPhoto(id, k))) throw new Error('Photos did not upload — report NOT submitted. Try again.');
      }
      const r = await api.call('submitReport', { teamId: id, reportDate: this.state.today, report: toServerForm(this.state.forms[id]) });
      const at = api.timeOf(r.submittedAt);
      this.setState(s => ({ actAt: { ...s.actAt, [id]: at }, showErr: { ...s.showErr, [id]: false }, saved: { ...s.saved, [id]: { ...s.forms[id] } }, draftAt: { ...s.draftAt, [id]: at } }), () => {
        this.persist();
        this.toast('Report submitted — admin can see it now');
      });
    } catch (e) {
      if (e.missing) { this.up('showErr', id, () => true); this.toast(e.message, 'err'); }
      else this.liveError(e, 'Report not submitted');
    } finally { this.setState({ busy: null }); }
  },

  async liveEditAct(id) {
    if (!api.online()) return this.toast('No signal — the report stays submitted. Try again when you have signal.', 'err');
    this.setState({ busy: 'edit' });
    try {
      await api.call('reopenReport', { teamId: id, reportDate: this.state.today });
      this.setState(s => ({ actAt: { ...s.actAt, [id]: null } }), () => { if (this.persist()) this.toast('Report unlocked — submit again when done', 'info'); });
    } catch (e) { this.liveError(e, 'Could not unlock the report'); }
    finally { this.setState({ busy: null }); }
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
    this.setState({ busy: 'export' });
    try {
      const r = await api.call('exportCsv', {}, { timeout: 90000 });
      const csv = '﻿' + r.csv;
      const le = { name: r.filename, rows: r.rows, at: this.now(), csv, ok: false, xlsxUrl: r.xlsxUrl };
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = r.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      le.ok = true;
      this.setState({ lastExport: le });
      this.toast(`Download requested: ${r.filename} (${r.rows} reports, last 30 days)`, 'info');
    } catch (e) { this.liveError(e, 'Export failed'); }
    finally { this.setState({ busy: null }); }
  },
};
