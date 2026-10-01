// Bridge NLEX Daily Report — field app. One guided report per team per day:
//   Choose team → Attendance → Work details → Photos → Review → SUBMIT DAILY REPORT → Success.
//
// Everything is kept on the phone as it is typed (localStorage), photos wait in IndexedDB until the
// office has them, and a submitted report waits in a small queue until the server confirms it.
// The server (google-apps-script/Code.gs) checks every rule again and allows one report per team per day.
import React from 'react';
import * as api from './api.js';
import * as idb from './idb.js';
import { prepare } from './photo.js';
import { attendanceOf, counts, problems } from './rules.js';
import { templatesFor } from './templates.js';
import {
  Header, Banner, TeamPicker, StepBar, AttendanceStep, WorkStep, PhotosStep, ReviewStep,
  Success, SentView, WaitingView, Previous, BottomBar,
} from './screens.jsx';

const KEEP_DAYS = 14;
const photoKey = clientId => 'ph:' + clientId;
const blankWork = unit => ({ start: '', end: '', location: '', details: '', status: '', target: '', actual: '', unit: unit === 'Locations' ? 'Locations' : 'KM', plate: '', remarks: '' });

function newDraft(teamId, date, unit) {
  return { teamId, date, step: 0, att: {}, work: blankWork(unit), photos: {}, touched: false };
}
/** A saved draft from an older or damaged copy is repaired, never trusted blindly. */
function cleanDraft(d, teamId, date, unit) {
  if (!d || typeof d !== 'object' || d.teamId !== teamId || d.date !== date) return null;
  const base = newDraft(teamId, date, unit);
  return {
    ...base, ...d,
    step: Math.max(0, Math.min(3, Number(d.step) || 0)),
    att: d.att && typeof d.att === 'object' ? d.att : {},
    work: { ...base.work, ...(d.work && typeof d.work === 'object' ? d.work : {}) },
    photos: d.photos && typeof d.photos === 'object' ? d.photos : {},
  };
}
const asMap = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export default class App extends React.Component {
  constructor(props) {
    super(props);
    const oldQueue = api.cleanUpOldVersion();
    const teamId = api.loadLocal('team') || '';
    const today = api.manilaDay();
    this.state = {
      today, date: today,
      online: api.online(),
      connected: api.isConnected(),
      teams: Array.isArray(api.loadLocal('teams')) ? api.loadLocal('teams') : [],
      teamsLoading: false, teamsError: '',
      teamId,
      teamData: teamId ? api.loadLocal('teamData.' + teamId) : null,
      view: teamId ? 'report' : 'teams',
      draft: null,
      previews: {},
      queue: asMap(api.loadLocal('queue')),
      sent: asMap(api.loadLocal('sent')),
      sending: {},
      showErr: [false, false, false, false],
      serverProblems: [],
      justSent: '',
      notice: oldQueue ? 'This phone had unsent work from the old version of the app. A copy was kept on this phone. Tell the office.' : '',
      photoError: '',
      storageFull: false,
      busyPhoto: '',
    };
    if (teamId) this.state.draft = this.loadDraft(teamId, today, this.state.teamData);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  componentDidMount() {
    this.alive = true;
    this.onOnline = () => { this.setState({ online: true }); this.refresh(); this.sendAll(); };
    this.onOffline = () => this.setState({ online: false });
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.onVisible = () => { if (document.visibilityState === 'visible') { this.checkDay(); this.sendAll(); } };
    document.addEventListener('visibilitychange', this.onVisible);
    this.timer = setInterval(() => { this.checkDay(); this.sendAll(); }, 60000);
    this.loadPreviews();
    this.cleanOld();
    this.refresh();
    this.sendAll();
  }
  componentWillUnmount() {
    this.alive = false;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
    clearInterval(this.timer);
  }
  set(patch, cb) { if (this.alive !== false) this.setState(patch, cb); }

  /** Load the teams list and this team's crew list (when there is signal). */
  refresh() {
    if (!api.isConnected()) return;
    this.loadTeams();
    if (this.state.teamId) this.loadTeam(this.state.teamId);
  }
  loadTeams() {
    this.set({ teamsLoading: true, teamsError: '' });
    api.call('teams').then(r => {
      const teams = Array.isArray(r.teams) ? r.teams : [];
      api.saveLocal('teams', teams);
      this.set({ teams, teamsLoading: false });
    }).catch(e => this.set({ teamsLoading: false, teamsError: e.offline ? 'No signal. Try again when there is signal.' : e.message }));
  }
  loadTeam(teamId) {
    return api.call('team', { teamId }).then(r => {
      const data = { team: r.team, roster: r.roster || [], reports: r.reports || [], at: Date.now() };
      api.saveLocal('teamData.' + teamId, data);
      if (this.state.teamId !== teamId) return;
      this.set(s => {
        let draft = s.draft && s.draft.teamId === teamId ? s.draft : this.loadDraft(teamId, s.date, data);
        // A fresh draft takes the team's usual unit.
        if (draft && !draft.touched && r.team && r.team.unit) draft = { ...draft, work: { ...draft.work, unit: r.team.unit === 'Locations' ? 'Locations' : 'KM' } };
        return { teamData: data, draft };
      });
    }).catch(e => {
      if (!e.offline && /not in the list/i.test(e.message) && this.state.teamId === teamId) {
        api.saveLocal('team', null);
        this.set({ teamId: '', teamData: null, draft: null, view: 'teams', notice: e.message });
      }
    });
  }

  checkDay() {
    const today = api.manilaDay();
    if (today === this.state.today) return;
    this.set(s => {
      // Still on yesterday's unfinished report? Keep it open; otherwise move on to the new day.
      const keep = s.date === s.today && s.draft && s.draft.touched && !this.isLocked(s, s.date);
      const date = keep ? s.date : today;
      return { today, date, draft: s.teamId ? this.loadDraft(s.teamId, date, s.teamData) : null, justSent: '', serverProblems: [], showErr: [false, false, false, false] };
    }, () => this.loadPreviews());
    this.cleanOld();
  }

  /** Forget old sent records and old photos that are no longer needed on this phone. */
  cleanOld() {
    const cutoff = api.shiftDay(api.manilaDay(), -KEEP_DAYS), yesterday = api.shiftDay(api.manilaDay(), -1);
    const sent = { ...this.state.sent };
    let changed = false;
    Object.keys(sent).forEach(k => { if (k.split('|')[1] < cutoff) { delete sent[k]; changed = true; } });
    if (changed) { api.saveLocal('sent', sent); this.set({ sent }); }
    api.localKeys('draft.').forEach(k => { const d = k.split('|')[1]; if (d && d < yesterday) api.saveLocal(k, null); });
    // Photos are kept only while a draft or the queue still needs them, or for today's sent report screen.
    idb.keys().then(keys => {
      const need = new Set();
      api.localKeys('draft.').forEach(k => { const d = api.loadLocal(k); Object.values((d && d.photos) || {}).forEach(p => p && need.add(photoKey(p.clientId))); });
      Object.values(this.state.queue).forEach(q => Object.values(q.draft.photos || {}).forEach(p => p && need.add(photoKey(p.clientId))));
      Object.values(this.state.sent).forEach(s => { if (s.date >= yesterday) Object.values((s.draft && s.draft.photos) || {}).forEach(p => p && need.add(photoKey(p.clientId))); });
      (keys || []).forEach(k => { if (String(k).startsWith('ph:') && !need.has(k)) idb.del(k).catch(() => {}); });
    }).catch(() => {});
  }

  // ── Drafts ─────────────────────────────────────────────────────────────
  draftKey(teamId, date) { return 'draft.' + teamId + '|' + date; }
  loadDraft(teamId, date, teamData) {
    const unit = teamData && teamData.team && teamData.team.unit;
    return cleanDraft(api.loadLocal(this.draftKey(teamId, date)), teamId, date, unit) || newDraft(teamId, date, unit);
  }
  /** Every change goes through here: saved on the phone at once. */
  change(fn) {
    this.set(s => {
      if (!s.draft) return null;
      const draft = { ...fn(s.draft), touched: true };
      const ok = api.saveLocal(this.draftKey(draft.teamId, draft.date), draft);
      return { draft, storageFull: !ok };
    });
  }
  loadPreviews() {
    const want = [];
    const add = d => Object.values((d && d.photos) || {}).forEach(p => p && p.clientId && want.push(p.clientId));
    add(this.state.draft);
    const k = this.state.teamId + '|' + this.state.date;
    if (this.state.queue[k]) add(this.state.queue[k].draft);
    if (this.state.sent[k]) add(this.state.sent[k].draft);
    want.filter(id => !this.state.previews[id]).forEach(id => {
      idb.get(photoKey(id)).then(v => { if (v && v.preview) this.set(s => ({ previews: { ...s.previews, [id]: v.preview } })); }).catch(() => {});
    });
  }

  // ── Team ───────────────────────────────────────────────────────────────
  pickTeam(teamId) {
    api.saveLocal('team', teamId);
    const teamData = api.loadLocal('teamData.' + teamId);
    const date = this.state.today;
    this.set({ teamId, teamData, date, view: 'report', draft: this.loadDraft(teamId, date, teamData), justSent: '', serverProblems: [], showErr: [false, false, false, false], notice: '' },
      () => { this.loadPreviews(); window.scrollTo(0, 0); });
    this.loadTeam(teamId);
  }

  // ── Photos ─────────────────────────────────────────────────────────────
  async addPhoto(type, file) {
    const s = this.state, d = s.draft, t = this.teamInfo();
    this.set({ busyPhoto: type, photoError: '' });
    try {
      const p = await prepare(file, { type, team: t.name, leadman: t.leadman, location: d.work.location });
      const clientId = api.uuid();
      try {
        await idb.put(photoKey(clientId), { full: p.full, preview: p.preview, teamId: d.teamId, date: d.date, type, capturedAt: p.capturedAt });
      } catch (e) {
        throw new Error(idb.isQuota(e) ? 'This phone is out of space. Delete some old photos or videos, then try again.' : 'Could not save the photo on this phone. Try again.');
      }
      const old = d.photos[type];
      this.set(st => ({ previews: { ...st.previews, [clientId]: p.preview } }));
      this.change(dr => ({ ...dr, photos: { ...dr.photos, [type]: { clientId, time: p.capturedAt, uploaded: false } } }));
      if (old && old.clientId) idb.del(photoKey(old.clientId)).catch(() => {});
      this.set({ busyPhoto: '' });
      this.uploadPhoto(d.teamId, d.date, type, clientId).catch(() => {});
    } catch (e) {
      this.set({ busyPhoto: '', photoError: e.message || 'Could not add that photo. Try again.' });
    }
  }
  removePhoto(type) {
    const old = this.state.draft.photos[type];
    this.change(dr => { const photos = { ...dr.photos }; delete photos[type]; return { ...dr, photos }; });
    if (old && old.clientId) idb.del(photoKey(old.clientId)).catch(() => {});
  }
  /** Send one photo to the office. Returns the photo's server info; throws like api.call. */
  async uploadPhoto(teamId, date, type, clientId) {
    const stored = await idb.get(photoKey(clientId)).catch(() => null);
    if (!stored || !stored.full) { this.markPhoto(teamId, date, clientId, { lost: true }); const e = new Error('A photo is missing on this phone. Take it again.'); e.photoLost = true; throw e; }
    try {
      const r = await api.call('uploadPhoto', { teamId, reportDate: date, type, clientId, dataUrl: stored.full }, { timeout: 90000 });
      this.markPhoto(teamId, date, clientId, { uploaded: true, photoId: r.photo && r.photo.photoId, refused: '' });
      return r.photo;
    } catch (e) {
      if (!e.offline && !e.notConnected && !e.alreadySubmitted) this.markPhoto(teamId, date, clientId, { refused: e.message });
      throw e;
    }
  }
  /** Update a photo in the draft (if it is still the one in the draft). */
  markPhoto(teamId, date, clientId, patch) {
    const d = this.state.draft;
    if (d && d.teamId === teamId && d.date === date) {
      const type = Object.keys(d.photos).find(k => d.photos[k] && d.photos[k].clientId === clientId);
      if (type) this.change(dr => ({ ...dr, photos: { ...dr.photos, [type]: { ...dr.photos[type], ...patch } } }));
      return;
    }
    const k = this.draftKey(teamId, date), saved = api.loadLocal(k);
    if (saved && saved.photos) {
      const type = Object.keys(saved.photos).find(t => saved.photos[t] && saved.photos[t].clientId === clientId);
      if (type) { saved.photos[type] = { ...saved.photos[type], ...patch }; api.saveLocal(k, saved); }
    }
  }

  // ── Submit and the waiting queue ───────────────────────────────────────
  submit() {
    const s = this.state, d = s.draft, roster = this.roster();
    const probs = problems(d, roster);
    if (probs.length) { this.set({ showErr: [true, true, true, true] }); window.scrollTo(0, 0); return; }
    if (!roster.length) { this.set({ serverProblems: ['The crew list has not loaded yet. Try again when there is signal.'] }); return; }
    const key = d.teamId + '|' + d.date;
    if (s.queue[key]) return;
    const item = {
      key, teamId: d.teamId, date: d.date, requestId: api.uuid(), reached: false, error: '',
      draft: { ...d, att: Object.fromEntries(attendanceOf(roster, d.att).map(p => [p.personId, { status: p.status, note: p.note }])) },
      teamName: this.teamInfo().name, total: roster.length, names: Object.fromEntries(roster.map(p => [p.personId, p.name])),
    };
    const queue = { ...s.queue, [key]: item };
    if (!api.saveLocal('queue', queue)) { this.set({ storageFull: true }); return; }
    this.set({ queue, serverProblems: [] }, () => this.send(key));
  }
  sendAll() { Object.keys(this.state.queue).forEach(k => this.send(k)); }

  async send(key) {
    const item = this.state.queue[key];
    if (!item || this.state.sending[key]) return;
    this.set(s => ({ sending: { ...s.sending, [key]: true } }));
    const done = patch => this.set(s => { const sending = { ...s.sending }; delete sending[key]; return { sending, ...(patch || {}) }; });
    const reached = e => !(e && (e.notSent || e.notConnected));
    try {
      // 1. Photos first (the server dedupes retries by clientId).
      const photos = { ...item.draft.photos };
      for (const type of ['before', 'after']) {
        const p = photos[type];
        if (!p || p.uploaded) continue;
        let r;
        try { r = await this.uploadPhoto(item.teamId, item.date, type, p.clientId); } catch (e) { e.photoType = type; throw e; }
        photos[type] = { ...p, uploaded: true, photoId: r && r.photoId };
        this.updateQueued(key, { draft: { ...item.draft, photos } });
      }
      // 2. The report.
      const d = item.draft, w = d.work;
      const r = await api.call('submitReport', {
        teamId: item.teamId, reportDate: item.date, requestId: item.requestId,
        attendance: Object.keys(d.att).map(personId => ({ personId, status: d.att[personId].status, note: d.att[personId].note || '' })),
        report: { fromTime: w.start, toTime: w.end, location: w.location, activityDetails: w.details, status: w.status, target: w.target, actual: w.actual, unit: w.unit, plateNumber: w.plate, remarks: w.remarks },
        beforePhotoId: photos.before && photos.before.photoId, beforeClientId: photos.before && photos.before.clientId,
        afterPhotoId: photos.after && photos.after.photoId, afterClientId: photos.after && photos.after.clientId,
      });
      this.finishSent(key, { ...item, draft: { ...d, photos } }, { submittedAt: r.submittedAt, reportId: r.reportId });
      done();
    } catch (e) {
      const cur = this.state.queue[key] || item;
      if (e.alreadySubmitted) {
        // Another phone (or an earlier try) already sent this team's report: the first one is kept.
        this.finishSent(key, cur, { submittedAt: e.answer && e.answer.submittedAt, reportId: e.answer && e.answer.reportId, other: true });
        done(); this.loadTeam(cur.teamId);
      } else if (e.offline || e.notConnected) {
        this.updateQueued(key, { error: e.message, reached: cur.reached || reached(e) });
        done();
      } else {
        // The office could not accept it as it is: back to editing, with what to fix.
        this.backToEditing(key, cur, e);
        done();
      }
    }
  }
  updateQueued(key, patch) {
    this.set(s => {
      if (!s.queue[key]) return null;
      const queue = { ...s.queue, [key]: { ...s.queue[key], ...patch } };
      api.saveLocal('queue', queue);
      return { queue };
    });
  }
  finishSent(key, item, info) {
    this.set(s => {
      const queue = { ...s.queue }; delete queue[key];
      const sent = { ...s.sent, [key]: { date: item.date, teamId: item.teamId, submittedAt: info.submittedAt || '', reportId: info.reportId || '', other: !!info.other, draft: info.other ? null : item.draft, total: item.total, names: item.names, teamName: item.teamName } };
      api.saveLocal('queue', queue); api.saveLocal('sent', sent);
      api.saveLocal(this.draftKey(item.teamId, item.date), null);
      const here = s.teamId === item.teamId && s.date === item.date;
      return { queue, sent, justSent: here && !info.other ? key : s.justSent };
    });
    if (!info.other) this.loadTeam(item.teamId);
  }
  backToEditing(key, item, e) {
    const d = { ...item.draft, photos: { ...item.draft.photos } };
    const t = e.photoType;
    if (t && d.photos[t]) d.photos[t] = { ...d.photos[t], ...(e.photoLost ? { lost: true } : { refused: e.message }) };
    const list = e.rosterChanged ? [e.message] : e.missing && e.missing.length ? e.missing : [e.message || 'The office could not accept this report.'];
    const step = e.rosterChanged ? 0 : t ? 2 : 3;
    api.saveLocal(this.draftKey(item.teamId, item.date), { ...d, step });
    this.set(s => {
      const queue = { ...s.queue }; delete queue[key];
      api.saveLocal('queue', queue);
      const here = s.teamId === item.teamId && s.date === item.date;
      return { queue, ...(here ? { draft: { ...d, step }, serverProblems: list } : {}) };
    });
    if (e.rosterChanged) this.loadTeam(item.teamId);
  }
  /** Take a waiting report back for editing (only if the office never saw it). */
  editWaiting(key) {
    const item = this.state.queue[key];
    if (!item || item.reached || this.state.sending[key]) return;
    const d = { ...item.draft, step: 3 };
    api.saveLocal(this.draftKey(item.teamId, item.date), d);
    this.set(s => { const queue = { ...s.queue }; delete queue[key]; api.saveLocal('queue', queue); return { queue, draft: d }; });
  }

  // ── Helpers for rendering ──────────────────────────────────────────────
  roster() { return (this.state.teamData && this.state.teamData.roster) || []; }
  teamInfo() {
    const s = this.state, fromData = s.teamData && s.teamData.team, fromList = s.teams.find(t => t.teamId === s.teamId);
    return fromData || fromList || { teamId: s.teamId, name: 'Your team', leadman: '' };
  }
  isLocked(s, date) {
    const key = s.teamId + '|' + date;
    return !!(s.sent[key] || this.serverReport(s, date));
  }
  serverReport(s, date) {
    const r = s.teamData && (s.teamData.reports || []).find(x => x.reportDate === date);
    return r || null;
  }
  summaryFor(d, roster, extra) {
    const c = counts(roster, d.att);
    return { team: this.teamInfo().name, dateLabel: api.fmtDay(d.date, { weekday: 'long', month: 'long', day: 'numeric' }), work: d.work, present: c.present, total: c.total, absent: c.absent, photos: d.photos, previews: this.state.previews, ...extra };
  }
  /** Summary of a queued or sent copy (attendance kept as a snapshot with names). */
  snapshotSummary(item) {
    const roster = Object.keys(item.draft.att).map(personId => ({ personId, name: (item.names && item.names[personId]) || personId }));
    return this.summaryFor(item.draft, roster);
  }
  goStep(step) {
    this.change(d => ({ ...d, step }));
    window.scrollTo(0, 0);
  }
  next() {
    const s = this.state, step = s.draft.step;
    const mine = problems(s.draft, this.roster()).filter(p => p.step === step);
    if (mine.length) { const showErr = [...s.showErr]; showErr[step] = true; this.set({ showErr }); return; }
    this.goStep(step + 1);
  }

  // ── Render ─────────────────────────────────────────────────────────────
  render() {
    const s = this.state;
    const banners = (
      <>
        {s.notice && <Banner tone="warn" action={() => this.set({ notice: '' })} actionLabel="OK">{s.notice}</Banner>}
        {api.quarantined.length > 0 && <Banner tone="warn">Some saved information on this phone could not be read. A copy was kept. Tell the office.</Banner>}
        {s.storageFull && <Banner tone="err" title="This phone is out of space">Your last change may not be saved. Delete some old photos or videos.</Banner>}
        {!s.online && <Banner tone="warn">No signal. Everything is saved on this phone.</Banner>}
      </>
    );

    if (s.view === 'teams' || !s.teamId) {
      return (
        <>
          <Header />
          {banners}
          <TeamPicker teams={s.teams} loading={s.teamsLoading} error={s.teamsError} connected={s.connected} current={s.teamId}
            onPick={id => this.pickTeam(id)} onRetry={() => this.loadTeams()} />
          {s.teamId && <BottomBar><button className="btn ghost wide" onClick={() => this.set({ view: 'report' })}>Back</button></BottomBar>}
        </>
      );
    }

    const team = this.teamInfo(), key = s.teamId + '|' + s.date;
    const dateLabel = (s.date === s.today ? 'Today, ' : 'Yesterday, ') + api.fmtDay(s.date, { weekday: 'short', month: 'short', day: 'numeric' });
    const header = <Header team={team.name} onChangeTeam={() => this.set({ view: 'teams' }, () => this.loadTeams())} dateLabel={dateLabel} saved={s.view === 'report' && s.draft && s.draft.touched && !s.queue[key] && !this.isLocked(s, s.date)} />;

    if (s.view === 'previous') {
      const local = Object.values(s.sent).filter(x => x.teamId === s.teamId && x.draft);
      const reports = ((s.teamData && s.teamData.reports) || []).map(r => ({ ...r, sentTime: api.timeOf(r.submittedAt) }));
      local.forEach(x => {
        if (reports.some(r => r.reportDate === x.date)) return;
        const c = Object.values(x.draft.att).filter(a => a.status === 'Present').length, w = x.draft.work;
        reports.push({ reportDate: x.date, location: w.location, activity: w.details, status: w.status, present: c + '/' + x.total, target: w.target, actual: w.actual, unit: w.unit, after: !!x.draft.photos.after, sentTime: api.timeOf(x.submittedAt) });
      });
      reports.sort((a, b) => b.reportDate.localeCompare(a.reportDate));
      return <>{header}{banners}<Previous reports={reports} team={team.name} fmt={d => api.fmtDay(d)} onBack={() => this.set({ view: 'report' })} /></>;
    }
    const toPrevious = () => this.set({ view: 'previous' }, () => window.scrollTo(0, 0));

    // Yesterday's report was started here but never sent: offer to finish it (the office accepts yesterday's report).
    const yesterday = api.shiftDay(s.today, -1), yKey = s.teamId + '|' + yesterday;
    const yDraft = s.date === s.today ? cleanDraft(api.loadLocal(this.draftKey(s.teamId, yesterday)), s.teamId, yesterday) : null;
    const yBanner = yDraft && yDraft.touched && !s.queue[yKey] && !this.isLocked(s, yesterday)
      ? <Banner tone="warn" title="Yesterday's report was not sent" action={() => this.set({ date: yesterday, draft: yDraft, justSent: '', serverProblems: [], showErr: [false, false, false, false] }, () => this.loadPreviews())} actionLabel="Finish yesterday's report" />
      : null;
    const backToToday = s.date !== s.today
      ? <Banner tone="info" action={() => this.set({ date: s.today, draft: this.loadDraft(s.teamId, s.today, s.teamData), justSent: '', serverProblems: [] }, () => this.loadPreviews())} actionLabel="Go to today's report">You are finishing yesterday's report.</Banner>
      : null;

    // Just sent: the success screen.
    if (s.justSent === key && s.sent[key]) {
      const x = s.sent[key];
      return (
        <>{header}
          <Success title="Report sent" line={`${team.name} · ${dateLabel} · sent ${api.timeOf(x.submittedAt)}`} summary={x.draft && this.snapshotSummary(x)}
            onDone={() => this.set({ justSent: '' }, () => window.scrollTo(0, 0))} onPrevious={toPrevious} />
        </>
      );
    }

    // Sent (by this phone or another): locked.
    if (this.isLocked(s, s.date)) {
      const x = s.sent[key], r = this.serverReport(s, s.date);
      const at = (x && x.submittedAt) || (r && r.submittedAt);
      const line = `${dateLabel} · sent ${api.timeOf(at)}` + (x && x.other ? ' (from another phone)' : '');
      const summary = x && x.draft ? this.snapshotSummary(x) : null;
      const extra = !summary && r ? <div className="card summary"><div className="kv"><span>Location</span><b>{r.location}</b></div><div className="kv"><span>Work</span><b>{r.activity}</b></div><div className="kv"><span>Present</span><b>{r.present}</b></div><div className="kv"><span>Status</span><b>{r.status}</b></div></div> : null;
      return <>{header}{banners}{backToToday}{yBanner}<SentView line={line} summary={summary} extra={extra} onPrevious={toPrevious} /></>;
    }

    // Submitted on this phone, waiting for the office to confirm.
    if (s.queue[key]) {
      const item = s.queue[key], sending = !!s.sending[key];
      return (
        <>{header}{banners}{backToToday}
          <WaitingView item={item} sending={sending} online={s.online} onRetry={() => this.send(key)}
            onChange={!item.reached && !sending ? () => this.editWaiting(key) : null} summary={this.snapshotSummary(item)} />
        </>
      );
    }

    // The guided report.
    const d = s.draft || this.loadDraft(s.teamId, s.date, s.teamData);
    const roster = this.roster();
    const people = attendanceOf(roster, d.att);
    const c = counts(roster, d.att);
    const probs = problems(d, roster);
    const errsFor = step => (s.showErr[step] ? Object.fromEntries(probs.filter(p => p.step === step).map(p => [p.field, true])) : {});
    const done = [0, 1, 2].map(i => d.touched && !probs.some(p => p.step === i)).concat([false]);
    const step = d.step;
    const stepErrors = s.showErr[step] && step < 3 ? probs.filter(p => p.step === step) : [];

    let body;
    if (step === 0) {
      body = roster.length || !s.online
        ? <AttendanceStep people={people} present={c.present} total={c.total} showErr={s.showErr[0]}
            onSet={(personId, v) => this.change(dr => ({ ...dr, att: { ...dr.att, [personId]: v } }))} />
        : <section className="card"><p className="hint" role="status">Loading the crew list…</p></section>;
    } else if (step === 1) {
      body = <WorkStep work={d.work} errs={errsFor(1)} manpower={c.present} templates={templatesFor(s.teamId)}
        set={(k, v) => this.change(dr => ({ ...dr, work: { ...dr.work, [k]: v } }))}
        onTemplate={t => t && this.change(dr => ({ ...dr, work: { ...dr.work, details: t } }))} />;
    } else if (step === 2) {
      body = (
        <>
          {s.busyPhoto && <Banner tone="info">Preparing the photo…</Banner>}
          {s.photoError && <Banner tone="err">{s.photoError}</Banner>}
          <PhotosStep photos={d.photos} previews={s.previews} complete={d.work.status === 'Complete'} errs={errsFor(2)}
            onFile={(type, f) => this.addPhoto(type, f)} onRemove={type => this.removePhoto(type)} />
        </>
      );
    } else {
      body = <ReviewStep summary={this.summaryFor(d, roster)} problems={s.showErr[3] ? probs : []} serverProblems={s.serverProblems} onFix={i => this.goStep(i)} />;
    }

    return (
      <>
        {header}
        <StepBar step={step} done={done} onGo={i => this.goStep(i)} />
        <main className="page">
          {banners}{backToToday}{yBanner}
          {step < 3 && s.serverProblems.length > 0 && <Banner tone="err">{s.serverProblems.join(' ')}</Banner>}
          {stepErrors.length > 0 && <Banner tone="err" title="Please fix:">{stepErrors.map(p => p.text).join('. ')}.</Banner>}
          {body}
          {step === 0 && <button className="link" onClick={toPrevious}>Previous reports</button>}
        </main>
        <BottomBar>
          {step > 0 && <button className="btn ghost" onClick={() => this.goStep(step - 1)}>Back</button>}
          {step < 3
            ? <button className="btn primary wide" onClick={() => this.next()}>Next: {['Work details', 'Photos', 'Review'][step]}</button>
            : <button className="btn primary wide" onClick={() => this.submit()} disabled={!!s.busyPhoto}>SUBMIT DAILY REPORT</button>}
        </BottomBar>
      </>
    );
  }
}
