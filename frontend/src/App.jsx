// Bridge NLEX Daily Report — app logic.
// Ported from the Claude Design prototype (prototype/Bridge NLEX Daily Report.dc.html, v3).
// The class body is the design's logic; lines marked `live` hand off to live.js when a
// Google backend is configured (see docs/BACKEND.md). Without one it runs as the offline demo.
import React from 'react';
import View from './View.jsx';
import * as api from './api.js';
import { liveMethods } from './live.js';

// Attendance is { status, note } per person; no entry means "not verified yet".
const OLD_REASON = { 'No show': 'Absent', Sick: 'Sick', Leave: 'Leave', Other: 'Other' };
function normAtt(a) {
  if (!a) return null;
  if (a.status) return { status: a.status, note: a.note || '' };
  if (a.present === true) return { status: 'Present', note: '' };
  if (a.present === false && a.reason) return { status: OLD_REASON[a.reason] || 'Other', note: '' };
  return null;
}
const isNum = v => /^\d+(\.\d{1,3})?$/.test(String(v == null ? '' : v).trim());
const isInt = v => /^\d+$/.test(String(v == null ? '' : v).trim());
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export default class Component extends React.Component {
  static defaultProps = { startScreen: 'login', afterPhotoAlwaysRequired: false, prototypeNav: true };

  static T = [
    { id: 'team1', short: 'RM Team 1', name: 'Bridge RM_Team 1', leadman: 'Pijay Tanjeco', pin: '1111', unit: 'Locations',
      crew: [['Justin Billones','Skilled'],['Ignacio Alcoriza Jr.','Crew'],['Alvin Angelo','Crew'],['Joven Blanza','Crew'],['Rocky Miranda','Crew'],['Richard Candelaria','Crew'],['Crisostomo Sebuc','Crew']],
      absent: { 'Rocky Miranda': 'Sick' },
      seed: { att: '6:58 AM', act: '3:42 PM', before: true, after: true },
      form: { from: '07:00', to: '16:00', location: 'SAPANG BAGO RIVER BRIDGE', details: 'Parapet cleaning, Deck slab cleaning, Girder and pier cleaning, Slope protection cleaning, Grass cutting, Trimming trees', status: 'COMPLETE', targetLoc: '1', actualLoc: '1', plate: 'NFJ 6654', targetMH: '8', actualMH: '7', remarks: 'Area turned over clean. Tree trimmings hauled to stockpile.' },
      history: [
        { date: '2026-09-26', location: 'MABALACAT RIVER BRIDGE', details: 'Parapet cleaning, Grass cutting, Trimming trees', status: 'COMPLETE', att: '7/8', photos: 2 },
        { date: '2026-09-25', location: 'STO. TOMAS RIVER BRIDGE', details: 'Deck slab cleaning, Slope protection cleaning', status: 'COMPLETE', att: '8/8', photos: 2 },
        { date: '2026-09-23', location: 'PAMPANGA RIVER BRIDGE North bound', details: 'Girder and pier cleaning, Grass cutting', status: 'COMPLETE', att: '7/8', photos: 2 } ] },
    { id: 'team2', short: 'Segment 10', name: 'Segment 10 Scupper Drain', leadman: 'Glenn Butiong', pin: '2222', unit: 'KM',
      crew: [['Glen Jorick De Mesa','Skilled'],['Justine Gregg Baylon','Skilled'],['John Christian Bernardo','Crew'],['Ian Enriquez','Crew'],['Joanner Royce Quilao','Crew'],['Rolando Faustino','Crew'],['Richard Santiago','Crew'],['Abraham Balmeo','Crew']],
      absent: { 'Abraham Balmeo': 'Leave', 'Rolando Faustino': 'No show' },
      seed: { att: '7:05 AM', act: null, before: true, after: false },
      form: { from: '07:00', to: '16:00', location: 'Km.11+000 to km.10+020 C3 exit ramp', details: 'Cleaning of clogged scupper drain', status: 'COMPLETE', targetLoc: '1', actualLoc: '1', plate: 'NKU 8624', targetMH: '8', actualMH: '7', remarks: 'After photo pending — crew still flushing the last scupper.' },
      history: [
        { date: '2026-09-26', location: 'Km.10+020 to Km.9+400 C3 exit ramp', details: 'Cleaning of clogged scupper drain', status: 'COMPLETE', att: '8/9', photos: 2 },
        { date: '2026-09-25', location: 'Km.12+500 NB main line', details: 'Cleaning of clogged scupper drain, debris removal', status: 'COMPLETE', att: '9/9', photos: 2 },
        { date: '2026-09-23', location: 'Km.9+400 to Km.8+800 C4 entry ramp', details: 'Cleaning of clogged scupper drain', status: 'ONGOING', att: '7/9', photos: 1 } ] },
    { id: 'team3', short: 'Epoxy 1', name: 'Bridge Epoxy 1', leadman: 'Allan Miranda', pin: '3333', unit: 'Locations',
      crew: [['Elmer Dordulo','Skilled'],['Edwin Lozano','Skilled'],['R-Jay John Aquino','Crew'],['Mark Joseph De Guzman','Crew'],['Edbryan Dela Cruz','Crew'],['Mark Ian Dungca','Crew'],['Johnry Manese','Crew'],['Eroll Pangilinan','Crew']],
      absent: { 'Eroll Pangilinan': 'Sick' },
      seed: { att: null, act: null, before: true, after: false },
      form: { from: '07:00', to: '17:00', location: 'CANDABA VIADUCT North bound', details: 'Inject epoxy girder 3-4-5, Pier 111-112', status: 'ONGOING', targetLoc: '3', actualLoc: '2', plate: 'NCG 5500', targetMH: '8', actualMH: '8', remarks: '' },
      history: [
        { date: '2026-09-26', location: 'CANDABA VIADUCT North bound', details: 'Inject epoxy girder 1-2, Pier 109-110', status: 'ONGOING', att: '9/9', photos: 2 },
        { date: '2026-09-25', location: 'CANDABA VIADUCT South bound', details: 'Inject epoxy girder 6-7, Pier 113-114', status: 'COMPLETE', att: '8/9', photos: 2 },
        { date: '2026-09-23', location: 'CANDABA VIADUCT South bound', details: 'Surface preparation, crack sealing', status: 'COMPLETE', att: '8/9', photos: 2 } ] },
    { id: 'team4', short: 'Epoxy 2', name: 'Bridge Epoxy 2', leadman: 'Gilbert Rivera', pin: '4444', unit: 'Locations',
      crew: [['Alvin Galang','Skilled'],['Ivan Cabunag','Crew'],['AJ Enriquez','Crew'],['Jaypee Occidental','Crew'],['Edgar Ortillo','Crew'],['Voltaire Rotamula','Crew'],['Joshua Andrei Tayco','Crew']],
      absent: { 'Voltaire Rotamula': 'Leave' },
      seed: { att: '7:10 AM', act: null, before: true, after: true },
      form: { from: '07:00', to: '17:00', location: 'CANDABA VIADUCT North bound', details: 'Dismantle remaining half of scaffolding, moving to pier 110-111', status: 'ONGOING', targetLoc: '2', actualLoc: '1', plate: 'NEO 5124', targetMH: '8', actualMH: '7', remarks: 'Scaffolding to be re-erected at pier 110-111 tomorrow.' },
      history: [
        { date: '2026-09-26', location: 'CANDABA VIADUCT North bound', details: 'Dismantle scaffolding pier 108-109', status: 'ONGOING', att: '7/8', photos: 2 },
        { date: '2026-09-25', location: 'CANDABA VIADUCT North bound', details: 'Erect scaffolding pier 110-111', status: 'COMPLETE', att: '8/8', photos: 2 },
        { date: '2026-09-23', location: 'CANDABA VIADUCT South bound', details: 'Dismantle remaining scaffolding pier 105-106', status: 'COMPLETE', att: '6/8', photos: 2 } ] },
  ];
  static NOT_PRESENT = [['Absent', 'No show'], ['Leave', 'Leave'], ['Rest Day', 'Rest Day'], ['Sick', 'Sick'], ['Other', 'Other']];
  static CHIP = {
    submitted: ['Submitted', '#DDF2E6', '#17693F'],
    draft: ['Draft', '#E3E9F2', '#2B4A73'],
    missing: ['Missing Attendance', '#FBE0DD', '#A8261B'],
    photos: ['Needs Photos', '#FDEBD3', '#8A4B00'],
  };

  static K = 'bnlex.v3.';
  dayKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  lsGet(k) { try { const v = localStorage.getItem(Component.K + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  lsSet(k, v) { try { localStorage.setItem(Component.K + k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  constructor(props) {
    super(props);
    const T = Component.T, crews = {}, att = {}, attAt = {}, actAt = {}, forms = {}, photos = {}, tabs = {}, showErr = {}, attErr = {}, newMember = {}, draftAt = {}, attDirty = {};
    const md = this.stamp(), today = this.dayKey();
    this.live = api.isLive();                                   // live
    const sess = this.live ? api.session() : null;              // live
    const R = this.lsGet('roster') || {}, D = this.lsGet('day.' + today) || {};
    this.arch = this.lsGet('archive') || {};
    const meta = this.lsGet('meta'); if (!meta) this.lsSet('meta', { firstDay: today });
    const demoDay = !this.live && (!meta || meta.firstDay === today), last = demoDay ? null : this.lastDay(today);
    const has = (o, id) => !!o && Object.prototype.hasOwnProperty.call(o, id);
    T.forEach(t => {
      crews[t.id] = has(R.crews, t.id) ? R.crews[t.id] : [{ name: t.leadman, role: 'Leadman' }].concat(t.crew.map(([name, role]) => ({ name, role })));
      const a = {};
      // A new day starts with everyone NOT verified; the leadman marks each person explicitly.
      crews[t.id].forEach(m => { const r = demoDay ? t.absent[m.name] : null; a[m.name] = demoDay ? { status: r ? (OLD_REASON[r] || r) : 'Present', note: '' } : null; });
      if (has(D.att, t.id)) Object.keys(D.att[t.id]).forEach(n => { if (n in a) a[n] = normAtt(D.att[t.id][n]); });
      attDirty[t.id] = !!(D.attDirty && D.attDirty[t.id]);
      att[t.id] = a;
      const lf = last && last.forms && last.forms[t.id];
      const blank = { from: (lf && lf.from) || t.form.from, to: (lf && lf.to) || t.form.to, location: '', details: '', status: 'ONGOING', targetLoc: '', actualLoc: '', plate: (lf && lf.plate) || t.form.plate, targetMH: (lf && lf.targetMH) || t.form.targetMH, actualMH: '', remarks: '' };
      attAt[t.id] = has(D.attAt, t.id) ? D.attAt[t.id] : (demoDay ? t.seed.att : null);
      actAt[t.id] = has(D.actAt, t.id) ? D.actAt[t.id] : (demoDay ? t.seed.act : null);
      forms[t.id] = { unit: (lf && lf.unit) || t.unit, ...(demoDay ? t.form : blank), ...(has(D.forms, t.id) ? D.forms[t.id] : {}) };
      photos[t.id] = has(D.photos, t.id) ? D.photos[t.id] : !demoDay ? { before: null, after: null } : {
        before: t.seed.before ? { name: `BEFORE_${md}_0712.jpg`, url: null, time: '7:12 AM' } : null,
        after: t.seed.after ? { name: `AFTER_${md}_1538.jpg`, url: null, time: '3:38 PM' } : null,
      };
      draftAt[t.id] = has(D.draftAt, t.id) ? D.draftAt[t.id] : null;
      tabs[t.id] = 'activity'; showErr[t.id] = false; attErr[t.id] = false; newMember[t.id] = '';
    });
    const saved = JSON.parse(JSON.stringify(forms));
    this.state = { screen: this.live ? (sess ? this.liveUser(sess.user).screen : 'login') : (props.startScreen || 'login'), pin: '', pinError: false, user: sess ? this.liveUser(sess.user) : null,
      online: api.online(), busy: null, loading: false, loginMsg: null, lastLoad: null, loadErr: null, sheetUrl: '', adminTab: 'all', tabs, crews, removed: R.removed || [], att, attAt, actAt, forms, saved, photos, draftAt, showErr, attErr, newMember, confirmRemove: null, toast: null, today, lastExport: null, storagePct: 0,
      attDirty, rev: {}, adminRange: { from: this.shift(today, -30), to: today }, adminView: null, adminData: {} };
  }
  componentDidMount() {
    this._flush = () => this.flushDrafts();
    this._vis = () => { if (document.visibilityState === 'hidden') this.flushDrafts(); };
    window.addEventListener('pagehide', this._flush); window.addEventListener('beforeunload', this._flush); document.addEventListener('visibilitychange', this._vis);
    this.setState({ storagePct: this.storagePct() });
    this.checkQuota();
    if (this.live) this.liveMount();
  }
  componentWillUnmount() {
    clearTimeout(this._t); clearTimeout(this._cr); Object.values(this._as || {}).forEach(clearTimeout);
    window.removeEventListener('pagehide', this._flush); window.removeEventListener('beforeunload', this._flush); document.removeEventListener('visibilitychange', this._vis);
    if (this.live) this.liveUnmount();
    this.flushDrafts();
  }
  flushDrafts() {
    const s = this.state; if (!s) return;
    const dirty = Component.T.filter(t => !s.actAt[t.id] && JSON.stringify(s.forms[t.id]) !== JSON.stringify(s.saved[t.id]));
    if (!dirty.length) return;
    const saved = { ...s.saved }, draftAt = { ...s.draftAt }, at = this.now();
    dirty.forEach(t => { saved[t.id] = { ...s.forms[t.id] }; draftAt[t.id] = at; });
    this.lsSet('day.' + s.today, { att: s.att, attAt: s.attAt, actAt: s.actAt, forms: saved, photos: this.photosForStore(s.photos), draftAt, attDirty: s.attDirty });
  }
  /** Live mode keeps photo pixels in IndexedDB; localStorage only gets the small metadata. */
  photosForStore(photos) {
    if (!this.live) return photos;
    const o = {};
    Object.keys(photos).forEach(id => { o[id] = {}; ['before', 'after'].forEach(k => { const p = photos[id][k]; o[id][k] = p && p.url && p.url.indexOf('data:') === 0 ? { ...p, url: null } : p; }); });
    return o;
  }
  /** Whole-phone storage (IndexedDB + localStorage) as a percentage of what the browser allows. */
  async checkQuota() {
    try {
      if (!navigator.storage || !navigator.storage.estimate) return;
      const e = await navigator.storage.estimate();
      if (e.quota) { const pct = Math.round(e.usage / e.quota * 100); if (pct > (this.state.storagePct || 0)) this.setState({ storagePct: pct }); }
    } catch (e) {}
  }
  shift(iso, days) { const [y, m, d] = iso.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + days)); return x.toISOString().slice(0, 10); }
  scheduleAutosave(id) { this._as = this._as || {}; clearTimeout(this._as[id]); this._as[id] = setTimeout(() => this.saveDraft(id, true), 1200); }
  storagePct() { let n = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(Component.K) === 0) n += k.length + (localStorage.getItem(k) || '').length; } } catch (e) {} return Math.min(100, Math.round(n / 5000000 * 100)); }
  lastDay(today) {
    const p = Component.K + 'day.'; let best = null;
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(p) === 0) { const d = k.slice(p.length); if (d < today && (!best || d > best)) best = d; } } } catch (e) {}
    return best ? this.lsGet('day.' + best) : null;
  }
  persist() {
    const s = this.state;
    const ok = this.lsSet('day.' + s.today, { att: s.att, attAt: s.attAt, actAt: s.actAt, forms: s.saved, photos: this.photosForStore(s.photos), draftAt: s.draftAt, attDirty: s.attDirty }) && this.lsSet('roster', { crews: s.crews, removed: s.removed });
    if (!ok) this.toast('Phone storage full — last change NOT saved on this phone. Free up space.', 'err');
    const pct = this.storagePct(); if (pct !== s.storagePct) this.setState({ storagePct: pct });
    return ok;
  }
  upP(key, id, fn, msg, kind) { this.setState(s => ({ [key]: { ...s[key], [id]: fn(s[key][id]) } }), () => { if (this.persist() && msg) this.toast(msg, kind); }); }
  photoCount(id, s) { return (s.photos[id].before ? 1 : 0) + (s.photos[id].after ? 1 : 0); }
  scrollToId(elId) { const el = document.getElementById(elId); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 120, behavior: 'smooth' }); }
  fmtDate(iso, wd) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', wd ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' }); }
  historyFor(t, s) {
    const map = {};
    (this.live ? [] : t.history).forEach(h => { map[h.date] = { ...h }; });   // live: history comes from the Sheet
    Object.values(this.arch || {}).forEach(a => { if (a.teamId === t.id && a.date !== s.today) map[a.date] = { date: a.date, location: a.location, details: a.details, status: a.status, att: a.att, photos: a.photos, submittedAt: a.submittedAt }; });
    return Object.values(map).sort((a, b) => b.date.localeCompare(a.date));
  }

  stamp() { const d = new Date(); return String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }
  now() { return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  toast(msg, kind = 'ok') { clearTimeout(this._t); this.setState({ toast: { msg, kind } }); this._t = setTimeout(() => this.setState({ toast: null }), 2800); }
  up(key, id, fn) { this.setState(s => ({ [key]: { ...s[key], [id]: fn(s[key][id]) } })); }

  lookup(pin) {
    if (pin === '0000') return { name: 'Operations Admin', initials: 'OA', role: 'Admin', team: 'All teams · NLEX', screen: 'admin', cta: 'Open command center' };
    const t = Component.T.find(x => x.pin === pin);
    return t ? { name: t.leadman, initials: this.initials(t.leadman), role: 'Leadman', team: t.name, screen: t.id, cta: "Start today's report" } : null;
  }
  initials(n) { return n.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
  press(k) {
    if (this.state.user) return;
    if (this.state.pinError && this.state.pin.length === 4) return;
    if (k === 'del') return this.setState(s => ({ pin: s.pin.slice(0, -1), pinError: false }));
    const pin = (this.state.pin + k).slice(0, 4);
    if (pin.length < 4) return this.setState({ pin, pinError: false, loginMsg: null });
    if (this.live) return this.state.busy ? null : this.livePress(pin);   // live: PIN checked by the server
    const user = this.lookup(pin);
    if (user) this.setState({ pin, user, pinError: false });
    else { this.setState({ pin, pinError: true }); setTimeout(() => this.setState({ pin: '', pinError: false }), 900); }
  }
  logout = () => this.live ? this.liveLogout() : this.setState({ screen: 'login', user: null, pin: '', pinError: false });

  photosOk(id, s) {
    const p = s.photos[id]; const needAfter = this.props.afterPhotoAlwaysRequired || s.forms[id].status === 'COMPLETE';
    return !!p.before && (!needAfter || !!p.after);
  }
  teamStatus(id, s) {
    if (s.attAt[id] && s.actAt[id]) return 'submitted';
    if (!s.attAt[id]) return 'missing';
    if (!this.photosOk(id, s)) return 'photos';
    return 'draft';
  }
  chip(kind) { const c = Component.CHIP[kind]; return `display:inline-flex;align-items:center;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;white-space:nowrap;background:${c[1]};color:${c[2]};`; }
  statusChip(st) { return st === 'COMPLETE' ? 'display:inline-flex;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;background:#DDF2E6;color:#17693F;' : 'display:inline-flex;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;background:#FDEBD3;color:#8A4B00;'; }
  roleTag(role) {
    const c = role === 'Leadman' ? 'background:#0F2540;color:#FFFFFF;' : role === 'Skilled' ? 'background:#E8760F;color:#FFFFFF;' : 'background:#E3E7EC;color:#0F2540;';
    return `align-self:flex-start;flex:none;font-size:11px;font-weight:700;padding:3px 8px;border-radius:5px;letter-spacing:0.3px;${c}`;
  }
  counts(id, s) {
    const list = s.crews[id], a = s.att[id] || {};
    let present = 0, verified = 0;
    list.forEach(m => { const x = a[m.name]; if (x && x.status) { verified++; if (x.status === 'Present') present++; } });
    return { present, total: list.length, verified, unverified: list.length - verified };
  }
  /** Same rules the server enforces (google-apps-script/Code.gs validateReport_), shown before sending. */
  validate(id, s) {
    const f = s.forms[id], p = s.photos[id], needAfter = this.props.afterPhotoAlwaysRequired || f.status === 'COMPLETE', c = this.counts(id, s);
    const qtyOk = v => isNum(v) && Number(v) <= 100 && (f.unit !== 'Locations' || isInt(v));
    const manOk = v => isInt(v) && Number(v) >= 1 && Number(v) <= 60;
    const why = f.status !== 'COMPLETE' || (qtyOk(f.targetLoc) && qtyOk(f.actualLoc) && Number(f.actualLoc) < Number(f.targetLoc)) || (manOk(f.actualMH) && !!s.attAt[id] && Number(f.actualMH) > c.present);
    const flags = { att: !s.attAt[id], times: !(HHMM.test(f.from || '') && HHMM.test(f.to || '') && f.from < f.to), location: !f.location.trim(), details: !f.details.trim(),
      target: !qtyOk(f.targetLoc), actual: !qtyOk(f.actualLoc), targetMH: !manOk(f.targetMH), actualMH: !manOk(f.actualMH), plate: !f.plate.trim(),
      remarks: why && !f.remarks.trim(), before: !p.before, after: needAfter && !p.after };
    const unitWord = f.unit === 'Locations' ? 'a whole number of locations' : 'a number of KM';
    const labels = { att: 'Submit attendance first (Attendance tab)', times: 'Enter valid times — "From" must be before "To"', location: 'Enter the location', details: 'Describe the work done',
      target: `Enter the target (${unitWord}, max 100)`, actual: `Enter the actual (${unitWord}, max 100)`, targetMH: 'Enter target manpower (1–60)', actualMH: 'Enter actual manpower (1–60)',
      plate: 'Enter equipment / plate number', remarks: 'Add remarks: explain why the work is Ongoing, below target, or manpower is above attendance',
      before: 'Add a Before Work photo', after: 'Add an After Work photo (required when Complete)' };
    return { flags, list: Object.keys(labels).filter(k => flags[k]).map(k => ({ label: labels[k] })) };
  }

  submitAct(id) {
    const v = this.validate(id, this.state);
    if (this.live) return this.state.busy ? null : this.liveSubmitAct(id);   // live
    if (v.list.length) { this.up('showErr', id, () => true); this.toast(v.list.length > 1 ? `${v.list.length} items need attention` : '1 item needs attention', 'err'); setTimeout(() => this.scrollToId('act-errors'), 60); return; }
    const at = this.now();
    this.setState(s => ({ actAt: { ...s.actAt, [id]: at }, showErr: { ...s.showErr, [id]: false }, saved: { ...s.saved, [id]: { ...s.forms[id] } }, draftAt: { ...s.draftAt, [id]: at } }), () => {
      const s = this.state, c = this.counts(id, s);
      this.arch = { ...this.arch, [s.today + '|' + id]: { date: s.today, teamId: id, ...s.forms[id], submittedAt: at, att: `${c.present}/${c.total}`, photos: this.photoCount(id, s) } };
      if (this.persist() && this.lsSet('archive', this.arch)) this.toast('Report submitted and saved');
    });
  }
  saveDraft(id, silent) {
    if (this.state.actAt[id]) return;
    if (this._as) clearTimeout(this._as[id]);
    const at = this.now();
    this.setState(s => ({ saved: { ...s.saved, [id]: { ...s.forms[id] } }, draftAt: { ...s.draftAt, [id]: at } }), () => { if (this.persist() && !silent) this.toast(`Draft saved on this phone · ${at}`, 'info'); });
  }
  copyCsv() {
    const le = this.state.lastExport; if (!le) return;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(le.csv.replace(/^\ufeff/, '')).then(() => this.toast('CSV copied — paste into Excel'), () => this.toast('Copy blocked by this browser', 'err'));
    else this.toast('Copy not supported on this browser', 'err');
  }
  editAct(id) {
    if (this.live) return this.state.busy ? null : this.liveEditAct(id);   // live
    this.setState(s => ({ actAt: { ...s.actAt, [id]: null } }), () => {
      const a = { ...this.arch }; delete a[this.state.today + '|' + id]; this.arch = a; this.lsSet('archive', a);
      if (this.persist()) this.toast('Report unlocked — submit again when done', 'info');
    });
  }
  submitAtt(id) {
    const s = this.state, c = this.counts(id, s);
    const needNote = s.crews[id].some(m => { const a = s.att[id][m.name]; return a && a.status === 'Other' && !(a.note || '').trim(); });
    if (c.unverified || needNote) { this.up('attErr', id, () => true); this.toast(c.unverified ? `${c.unverified} crew not marked yet` : 'Write a note for "Other"', 'err'); setTimeout(() => this.scrollToId('att-errors'), 60); return; }
    if (this.live) { this.up('attErr', id, () => false); return this.state.busy ? null : this.liveSubmitAtt(id); }   // live
    this.up('attErr', id, () => false); this.upP('attAt', id, () => this.now(), 'Attendance submitted and saved');
  }
  /** Resized JPEG as a data URL. `mark` (lines of text) stamps an evidence band on the bottom of the photo. */
  thumb(file, max = 560, quality = 0.7, mark) {
    return new Promise((resolve, reject) => {
      const src = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        try {
          const sc = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
          const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
          if (mark && mark.length) {
            const fs = Math.max(11, Math.round(c.width / 42)), lh = Math.round(fs * 1.35), h = lh * mark.length + fs;
            g.fillStyle = 'rgba(15,37,64,0.78)'; g.fillRect(0, c.height - h, c.width, h);
            g.fillStyle = '#FFFFFF'; g.font = `700 ${fs}px sans-serif`; g.textBaseline = 'top';
            mark.forEach((line, i) => g.fillText(String(line).slice(0, 90), Math.round(fs * 0.6), c.height - h + Math.round(fs / 2) + i * lh, c.width - fs));
          }
          resolve(c.toDataURL('image/jpeg', quality));
        }
        catch (e) { reject(e); } finally { URL.revokeObjectURL(src); }
      };
      img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('bad image')); };
      img.src = src;
    });
  }
  async onFile(id, key, e) {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    if (!/^image\//.test(f.type)) return this.toast('That file is not a photo', 'err');
    if (this.live) return this.liveOnFile(id, key, f);   // live: upload to Google Drive
    let url; try { url = await this.thumb(f); } catch (err) { return this.toast('Could not read that photo — try again', 'err'); }
    const old = this.state.photos[id][key]; if (old && old.url && old.url.indexOf('blob:') === 0) URL.revokeObjectURL(old.url);
    this.setState(s => ({ photos: { ...s.photos, [id]: { ...s.photos[id], [key]: { name: f.name, url, time: this.now() } } } }), () => {
      if (!this.persist()) return;
      const pct = this.storagePct(), label = key === 'before' ? 'Before photo saved' : 'After photo saved';
      if (pct >= 70) this.toast(`${label} · phone storage ${pct}% full — ask admin to export & reset soon`, 'err'); else this.toast(label);
    });
  }
  addMember(id) {
    const name = (this.state.newMember[id] || '').trim();
    if (!name) return this.toast('Type a name first', 'err');
    if (this.state.crews[id].some(m => m.name.toLowerCase() === name.toLowerCase())) return this.toast('Already on this crew', 'err');
    if (this.live) return this.liveRoster('addMember', { teamId: id, name }, `${name} added`).then(ok => ok && this.up('newMember', id, () => ''));   // live
    this.setState(s => ({ crews: { ...s.crews, [id]: s.crews[id].concat({ name, role: 'Crew' }) }, att: { ...s.att, [id]: { ...s.att[id], [name]: null } }, newMember: { ...s.newMember, [id]: '' } }),
      () => { if (this.persist()) this.toast(`${name} added`); });
  }
  removeMember(id, m) {
    const key = id + '|' + m.name;
    if (this.state.confirmRemove !== key) { clearTimeout(this._cr); this.setState({ confirmRemove: key }); this._cr = setTimeout(() => this.setState({ confirmRemove: null }), 4000); return; }
    clearTimeout(this._cr);
    if (this.live) { this.setState({ confirmRemove: null }); return this.liveRoster('archiveMember', { personId: m.id }, `${m.name} removed · archived`); }   // live
    this.setState(s => {
      const a = { ...s.att[id] }, last = a[m.name] || null; delete a[m.name];
      return { confirmRemove: null, crews: { ...s.crews, [id]: s.crews[id].filter(x => x.name !== m.name) }, att: { ...s.att, [id]: a },
        removed: s.removed.concat({ teamId: id, name: m.name, role: m.role, removedOn: s.today, removedAt: this.now(), lastAttendance: last }) };
    }, () => { if (this.persist()) this.toast(`${m.name} removed · archived`, 'info'); });
  }
  restoreMember(id, r) {
    if (this.live) return this.liveRoster('restoreMember', { personId: r.id }, `${r.name} restored`);   // live
    if (this.state.crews[id].some(m => m.name === r.name)) return this.toast('Already on this crew', 'err');
    this.setState(s => ({ crews: { ...s.crews, [id]: s.crews[id].concat({ name: r.name, role: r.role }) },
      att: { ...s.att, [id]: { ...s.att[id], [r.name]: normAtt(r.lastAttendance) } },
      removed: s.removed.filter(x => !(x.teamId === id && x.name === r.name)) }), () => { if (this.persist()) this.toast(`${r.name} restored`); });
  }
  exportCsv() {
    if (this.live) return this.state.busy ? null : this.liveExport();   // live: CSV built from the Sheet
    const s = this.state, T = Component.T, rows = [];
    const head = ['Date', 'Team', 'Leadman', 'Location', 'Activity Details', 'Status', 'From', 'To', 'Target (KM/Loc)', 'Actual (KM/Loc)', 'Target Manpower', 'Actual Manpower', 'Crew Present', 'Absent (reason)', 'Equipment / Plate', 'Photos', 'Remarks', 'Report State', 'Submitted At'];
    T.forEach(t => {
      const id = t.id, f = s.actAt[id] ? s.forms[id] : s.saved[id], c = this.counts(id, s), st = this.teamStatus(id, s);
      const abs = s.crews[id].filter(m => !s.att[id][m.name] || s.att[id][m.name].status !== 'Present').map(m => { const x = s.att[id][m.name]; return `${m.name} (${x ? (x.status === 'Absent' ? 'No show' : x.status) + (x.note ? ': ' + x.note : '') : 'not verified'})`; }).join('; ');
      rows.push([s.today, t.name, t.leadman, f.location, f.details, f.status, f.from, f.to, f.targetLoc, f.actualLoc, f.targetMH, f.actualMH, s.attAt[id] ? `${c.present}/${c.total}` : 'Not submitted', abs, f.plate, this.photoCount(id, s), f.remarks, Component.CHIP[st][0], s.actAt[id] || '']);
    });
    T.forEach(t => this.historyFor(t, s).forEach(h => rows.push([h.date, t.name, t.leadman, h.location, h.details, h.status, '', '', '', '', '', '', h.att, '', '', h.photos, '', 'Submitted', h.submittedAt || ''])));
    const esc = v => { let x = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return /[",\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    const csv = '\ufeff' + [head].concat(rows).map(r => r.map(esc).join(',')).join('\r\n');
    const name = `NLEX_Daily_Report_${s.today}.csv`;
    if (head.length !== 19 || rows.some(r => r.length !== head.length)) return this.toast('Export stopped: column count mismatch', 'err');
    const le = { name, rows: rows.length, at: this.now(), csv, ok: false };
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      if (!blob.size) throw new Error('empty');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name;
      if (!('download' in a)) throw new Error('no download support');
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      le.ok = true;
      this.setState({ lastExport: le });
      this.toast(`Download requested: ${name} (${rows.length} rows). No file? Use Copy CSV.`, 'info');
    } catch (e) { this.setState({ lastExport: le }); this.toast('Download failed on this device — use Copy CSV', 'err'); }
  }
  resetDemo() {
    if (!window.confirm('Reset all demo data on this device? Drafts, submissions, photos and roster changes will be cleared.')) return;
    try { Object.keys(localStorage).filter(k => k.indexOf(Component.K) === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    window.location.reload();
  }

  /** Admin (live): date range, export, report overview with missing/late flags, revision history, audit log. */
  adminTools(s) {
    const d = s.adminData || {}, rg = s.adminRange;
    const setRange = k => e => { const v = e.target.value; this.setState(st => ({ adminRange: { ...st.adminRange, [k]: v } })); };
    const chip = (bg, fg) => `display:inline-flex;align-items:center;font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap;background:${bg};color:${fg};`;
    const stateChip = { Submitted: chip('#DDF2E6', '#17693F'), Draft: chip('#E3E9F2', '#2B4A73'), Missing: chip('#FBE0DD', '#A8261B') };
    const rep = d.reports, rev = d.revisions, aud = d.audit;
    const reportRows = rep && s.adminView === 'reports' ? rep.rows.filter(r => s.adminTab === 'all' || r.teamId === s.adminTab).map(r => ({
      key: r.teamId + r.reportDate, date: this.fmtDate(r.reportDate, true), team: r.team, leadman: r.leadman, state: r.state, stateStyle: stateChip[r.state],
      late: r.late, lateLabel: r.state === 'Submitted' ? 'Late' : 'Overdue', lateStyle: chip('#FDEBD3', '#8A4B00'),
      attendance: r.attendanceRows ? `${r.attendanceRows}/${r.rosterSize} marked · ${r.crewPresent || '—'} present` : 'No attendance',
      attOk: r.attendanceRows >= r.rosterSize && r.rosterSize > 0,
      photos: `${r.photos}/${r.photosNeeded}`, photosOk: r.photos >= r.photosNeeded,
      version: r.version !== '0' ? 'v' + r.version : '—', location: r.location || '—',
      hasHistory: !!r.reportId, historyLabel: `History (${r.revisions})`, history: () => this.liveRevisions(r.reportId), reportId: r.reportId })) : [];
    const kindLabel = { submitted: 'Submitted', reopened: 'Reopened', 'attendance before update': 'Attendance changed' };
    const revisions = rev && rev.revisions ? rev.revisions.map(v => ({ key: v.revisionId, title: `${kindLabel[v.kind] || v.kind} · v${v.version} · rev ${v.rev}`, meta: `${v.at} · ${v.by}`, reason: v.reason,
      summary: [v.snapshot.status, v.snapshot.location, v.snapshot.crewPresent && 'crew ' + v.snapshot.crewPresent, v.snapshot.actualManpower && 'manpower ' + v.snapshot.actualManpower].filter(Boolean).join(' · ') })) : [];
    const auditRows = aud && s.adminView === 'audit' ? aud.rows.map(a => ({ key: a.auditId, at: a.at, who: `${a.user}${a.role ? ' (' + a.role + ')' : ''}`, team: a.teamId || '—', action: a.action,
      denied: /^DENIED/.test(a.action), detail: [a.reason, a.before && 'before: ' + a.before, a.after && 'after: ' + a.after].filter(Boolean).join(' · ').slice(0, 400), entity: a.entityId })) : [];
    const missingN = rep ? rep.rows.filter(r => r.state !== 'Submitted' && r.overdue).length : 0, lateN = rep ? rep.rows.filter(r => r.state === 'Submitted' && r.late).length : 0;
    return {
      from: rg.from, to: rg.to, onFrom: setRange('from'), onTo: setRange('to'), max: s.today,
      showReports: () => this.liveAdminReports(), showAudit: () => this.liveAuditLog(), close: () => this.setState({ adminView: null }),
      reportsLabel: s.busy === 'reports' ? 'Loading…' : 'Show reports', auditLabel: s.busy === 'audit' ? 'Loading…' : 'Audit log',
      onReports: s.adminView === 'reports' && !!rep, onAudit: s.adminView === 'audit' && !!aud,
      reportRows, reportsSummary: rep ? `${rep.from} to ${rep.to} · ${missingN} missing/overdue · ${lateN} submitted late` : '',
      hasRevisions: !!(rev && rev.reportId), revisionsTitle: rev ? `Revision history · ${rev.reportId}` : '', revisions, noRevisions: !!(rev && rev.revisions && !rev.revisions.length),
      closeRevisions: () => this.setState(st => ({ adminData: { ...st.adminData, revisions: null } })),
      auditRows, auditSummary: aud ? `${aud.from} to ${aud.to}${s.adminTab !== 'all' ? ' · ' + s.adminTab : ''} · showing ${aud.rows.length} of ${aud.total}` : '',
    };
  }

  renderVals() {
    const s = this.state, T = Component.T, CH = Component.CHIP;
    const d0 = new Date();
    const todayLong = d0.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const short = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const todayShort = short(d0);
    const photoCount = id => this.photoCount(id, s);

    const pill = on => `min-height:36px;border:none;border-radius:999px;padding:0 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:Archivo,sans-serif;${on ? 'background:#E8760F;color:#FFFFFF;' : 'background:#1B3A63;color:#D5DEEA;'}`;
    const navItems = [['login', 'Login'], ['admin', 'Admin']].concat(T.map(t => [t.id, t.short])).map(([id, label]) => ({ label, style: pill(s.screen === id), go: () => this.setState({ screen: id, ...(id === 'login' ? { user: null, pin: '', pinError: false } : {}) }) }));

    const keys = ['1','2','3','4','5','6','7','8','9','','0','del'].map(k => ({
      label: k === 'del' ? '⌫ Delete' : k,
      aria: k === 'del' ? 'Delete last digit' : k ? 'Digit ' + k : 'blank',
      press: () => k && this.press(k),
      style: k === '' ? 'visibility:hidden;' : `min-height:60px;background:#F2F4F7;border:1px solid #DDE2E8;border-radius:12px;font-family:Archivo,sans-serif;font-weight:700;color:#0F2540;cursor:pointer;font-size:${k === 'del' ? '14px' : '24px'};`,
    }));
    const dots = [0, 1, 2, 3].map(i => ({ style: `width:18px;height:18px;border-radius:50%;border:2.5px solid ${s.pinError ? '#C62828' : '#0F2540'};background:${s.pin.length > i ? (s.pinError ? '#C62828' : '#0F2540') : 'transparent'};` }));
    const login = { entering: !s.user, confirmed: !!s.user, error: s.pinError, keys, dots, user: s.user || {}, proceed: () => s.user && (this.live ? this.liveProceed() : this.setState({ screen: s.user.screen })), reset: () => { if (this.live) api.clearSession(); this.setState({ user: null, pin: '' }); },
      message: s.pinError ? null : s.loginMsg, checking: s.busy === 'login', showDemoPins: !this.live };

    const statuses = {}; T.forEach(t => { statuses[t.id] = this.teamStatus(t.id, s); });
    const submittedN = T.filter(t => statuses[t.id] === 'submitted').length;
    const manpower = T.reduce((a, t) => a + (s.attAt[t.id] ? this.counts(t.id, s).present : 0), 0);
    const planned = T.reduce((a, t) => a + (Number(s.forms[t.id].targetMH) || 0), 0);
    const completed = T.filter(t => s.actAt[t.id] && s.forms[t.id].status === 'COMPLETE').length;
    const ongoing = T.filter(t => s.actAt[t.id] && s.forms[t.id].status !== 'COMPLETE').length;
    const pendingN = 4 - submittedN;
    const kpi = {
      manpower, planned, completed, ongoingLabel: `${ongoing} ongoing reported`, active: T.filter(t => s.attAt[t.id]).length, pending: pendingN,
      manBar: `height:100%;background:#E8760F;width:${planned ? Math.min(100, Math.round(manpower / planned * 100)) : 0}%;`,
      pendingCard: `border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:8px;${pendingN ? 'background:#FFF3E3;border:1px solid #F3C98F;' : 'background:#FFFFFF;border:1px solid #DDE2E8;'}`,
    };

    const notes = { missing: 'Attendance not submitted', photos: 'Photos missing on draft', draft: 'Activity report not sent' };
    const pending = T.filter(t => statuses[t.id] !== 'submitted').map(t => ({ team: t.name, leadman: t.leadman, note: notes[statuses[t.id]], chip: CH[statuses[t.id]][0], chipStyle: this.chip(statuses[t.id]), open: () => this.setState({ adminTab: t.id }) }));
    const tabBase = on => `display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:190px;min-height:84px;padding:12px 14px;border-radius:12px;cursor:pointer;text-align:left;flex:none;${on ? 'background:#0F2540;color:#FFFFFF;border:1.5px solid #0F2540;' : 'background:#FFFFFF;color:#0F2540;border:1.5px solid #DDE2E8;'}`;
    const subSt = on => `font-size:13px;${on ? 'color:#C5D2E2;' : 'color:#5B6472;'}`;
    const adminTabs = [{ id: 'all', label: 'All Teams', sub: `${submittedN} of 4 submitted`, hasChip: false }]
      .concat(T.map(t => ({ id: t.id, label: t.name, sub: t.leadman, hasChip: true, chip: CH[statuses[t.id]][0], chipAria: 'Status: ' + CH[statuses[t.id]][0], chipStyle: this.chip(statuses[t.id]) })))
      .map(a => ({ ...a, style: tabBase(s.adminTab === a.id), subStyle: subSt(s.adminTab === a.id), select: () => this.setState({ adminTab: a.id }) }));

    const cols = 'display:grid;grid-template-columns:200px 90px 210px minmax(280px,1fr) 110px 110px 120px 80px 160px;border-top:1px solid #E7EAEF;';
    const todayRow = t => {
      const id = t.id, f = s.forms[id], done = !!s.actAt[id], st = statuses[id], c = this.counts(id, s);
      return { team: t.name, leadman: t.leadman, date: todayShort, location: done ? f.location : '—',
        details: done ? f.details : (st === 'missing' ? 'Waiting for attendance and activity report' : 'Activity report not submitted yet'),
        detailsStyle: `padding:12px 14px;font-size:14px;line-height:1.4;${done ? 'color:#33404F;' : 'color:#8A4B00;font-style:italic;'}`,
        hasStatus: done, statusLabel: f.status === 'COMPLETE' ? 'Complete' : 'Ongoing', statusStyle: this.statusChip(f.status),
        targetActual: done ? `${f.targetLoc || '—'} / ${f.actualLoc || '—'}${this.live && f.unit ? ' ' + f.unit : ''}` : '—', manpower: s.attAt[id] ? `${c.present} / ${f.targetMH}` : 'No attendance',
        photos: `${photoCount(id)} / 2`, reportLabel: CH[st][0], reportStyle: this.chip(st) };
    };
    let rows;
    if (s.adminTab === 'all') rows = T.map(todayRow);
    else {
      const t = T.find(x => x.id === s.adminTab);
      rows = [todayRow(t)].concat(this.historyFor(t, s).map(h => ({ team: t.name, leadman: t.leadman, date: this.fmtDate(h.date), location: h.location, details: h.details, detailsStyle: 'padding:12px 14px;font-size:14px;line-height:1.4;color:#33404F;', hasStatus: true, statusLabel: h.status === 'COMPLETE' ? 'Complete' : 'Ongoing', statusStyle: this.statusChip(h.status), targetActual: '—', manpower: h.att, photos: `${h.photos} / 2`, reportLabel: 'Submitted', reportStyle: this.chip('submitted') })));
    }
    rows = rows.map((r, i) => ({ ...r, rowStyle: cols + `background:${i % 2 ? '#F9FAFB' : '#FFFFFF'};` }));

    let roster = null;
    if (s.adminTab !== 'all') {
      const id = s.adminTab, t = T.find(x => x.id === id);
      roster = { name: t.name, count: s.crews[id].length, newVal: s.newMember[id],
        onNew: e => { const v = e.target.value; this.up('newMember', id, () => v); },
        onKey: e => { if (e.key === 'Enter') this.addMember(id); },
        add: () => this.addMember(id),
        members: s.crews[id].map(m => { const conf = s.confirmRemove === id + '|' + m.name; return { ...m, roleTagStyle: this.roleTag(m.role), removable: m.role !== 'Leadman',
          removeLabel: conf ? 'Tap to confirm' : 'Remove', removeAria: conf ? `Confirm removing ${m.name}` : `Remove ${m.name} from crew`,
          removeStyle: `min-height:44px;border-radius:8px;padding:0 12px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;${conf ? 'background:#A8261B;color:#FFFFFF;border:1px solid #A8261B;' : 'background:#FFFFFF;color:#A8261B;border:1px solid #E0B4AF;'}`,
          remove: () => this.removeMember(id, m) }; }),
        archived: s.removed.filter(r => r.teamId === id).map(r => ({ name: r.name, meta: `${r.role} · removed ${this.fmtDate(r.removedOn)}, ${r.removedAt}`, aria: `Restore ${r.name} to crew`, restore: () => this.restoreMember(id, r) })),
        hasArchived: s.removed.some(r => r.teamId === id) };
    }
    const admin = {
      hasPending: pending.length > 0, allDone: pending.length === 0, pending, tabs: adminTabs, rows, hasRoster: !!roster, roster: roster || {},
      tableTitle: s.adminTab === 'all' ? `Today's reports · ${todayShort}` : `${T.find(x => x.id === s.adminTab).name} · today + recent`,
      onExport: () => this.exportCsv(), resetDemo: () => this.resetDemo(), copyCsv: () => this.copyCsv(),
      hasExport: !!s.lastExport,
      exportLine: s.lastExport ? `${s.lastExport.ok ? 'Download requested' : 'Download failed'} · ${s.lastExport.name} · ${s.lastExport.rows} rows · ${s.lastExport.at}` : '',
      storageLine: this.live ? `Google Sheet · ${s.loading ? 'updating…' : s.lastLoad ? 'last updated ' + s.lastLoad : 'not loaded yet'}${s.loadErr && !s.loading ? ' · ' + s.loadErr : ''}` : `Report storage on this device: ${s.storagePct || 0}% of ~5 MB`,
      live: this.live, refresh: () => this.refresh(), sheetUrl: s.sheetUrl, hasSheet: !!s.sheetUrl,
      xlsxUrl: s.lastExport && s.lastExport.xlsxUrl, hasXlsx: !!(s.lastExport && s.lastExport.xlsxUrl),
      exportLabel: s.busy === 'export' ? 'Exporting…' : 'Export CSV (Excel)',
      storageStyle: `font-size:13px;font-weight:700;${(s.storagePct || 0) >= 70 ? 'color:#A8261B;' : 'color:#33404F;'}`,
      tools: this.live ? this.adminTools(s) : null, hasTools: this.live,
    };

    let cur = {};
    const t = T.find(x => x.id === s.screen);
    if (t) {
      const id = t.id, f = s.forms[id], st = statuses[id], c = this.counts(id, s), v = this.validate(id, s);
      const pendingN = ['before', 'after'].filter(k => s.photos[id][k] && s.photos[id][k].pending).length;
      const err = s.showErr[id] ? v.flags : {};
      const locked = !!s.actAt[id], dirty = JSON.stringify(f) !== JSON.stringify(s.saved[id]);
      const lockBtn = (danger, lk) => `min-height:44px;display:flex;align-items:center;justify-content:center;padding:0 12px;background:${lk ? '#EEF1F4' : '#FFFFFF'};border:1.5px solid ${lk ? '#DDE2E8' : danger ? '#E0B4AF' : '#0F2540'};color:${lk ? '#5B6472' : danger ? '#A8261B' : '#0F2540'};border-radius:8px;font-weight:700;font-size:14px;cursor:${lk ? 'not-allowed' : 'pointer'};`;
      const set = {}; ['from','to','location','details','targetLoc','actualLoc','plate','targetMH','actualMH','remarks'].forEach(k => { set[k] = e => { const val = e.target.value; this.up('forms', id, o => ({ ...o, [k]: val })); this.scheduleAutosave(id); }; });
      const INP = 'width:100%;min-height:48px;padding:0 12px;border:1.5px solid #C9D1DB;border-radius:8px;font-size:16px;color:#0F2540;background:#FFFFFF;';
      const bad = b => b ? 'border-color:#C62828;background:#FFF6F5;' : '';
      const TIME = 'width:100%;min-height:48px;padding:0 8px;border:1.5px solid #C9D1DB;border-radius:8px;font-size:16px;color:#0F2540;background:#FFFFFF;';
      const NUM = INP + 'font-size:18px;font-weight:700;';
      const AREA = 'width:100%;padding:12px;border:1.5px solid #C9D1DB;border-radius:8px;font-size:16px;color:#0F2540;background:#FFFFFF;resize:vertical;line-height:1.4;';
      const fs = {
        from: TIME + bad(err.times), to: TIME + bad(err.times),
        location: INP + 'font-weight:700;' + bad(err.location),
        details: AREA + 'min-height:96px;' + bad(err.details),
        targetLoc: NUM + bad(err.target), actualLoc: NUM + bad(err.actual), targetMH: NUM + bad(err.targetMH),
        plate: INP + 'font-weight:700;text-transform:uppercase;' + bad(err.plate),
        actualMH: NUM + bad(err.actualMH),
        remarks: AREA + 'min-height:72px;' + bad(err.remarks),
      };
      const remarksNeeded = f.status !== 'COMPLETE' || (isNum(f.targetLoc) && isNum(f.actualLoc) && Number(f.actualLoc) < Number(f.targetLoc)) || (!!s.attAt[id] && isInt(f.actualMH) && Number(f.actualMH) > c.present);
      const seg = (on, color) => `min-height:52px;border-radius:10px;font-family:Archivo,sans-serif;font-weight:800;font-size:16px;cursor:pointer;${on ? `background:${color};color:#FFFFFF;border:2px solid ${color};` : 'background:#FFFFFF;color:#33404F;border:2px solid #C9D1DB;'}`;
      const needAfter = this.props.afterPhotoAlwaysRequired || f.status === 'COMPLETE';
      const photoList = ['before', 'after'].map(k => {
        const p = s.photos[id][k], req = k === 'before' || needAfter, b = err[k], lbl = k === 'before' ? 'Before Work' : 'After Work';
        const warn = p && (p.lost || (p.pending && p.error));
        return { label: k === 'before' ? 'Before Work' : 'After Work', hint: k === 'before' ? 'Take before the crew starts' : 'Take when work is finished',
          empty: !p, filled: !!p, hasUrl: !!(p && p.url), noUrl: !!(p && !p.url), previewStyle: p && p.url ? `position:absolute;inset:0;background:url("${p.url}") center/cover no-repeat;` : '', name: p ? p.name : '', time: p ? p.time : '',
          reqLabel: p ? (p.lost ? 'Missing — retake' : p.pending ? (p.error ? 'Upload failed · retrying' : 'Not uploaded yet') : 'Uploaded') : (req ? 'Required' : 'Optional'),
          reqStyle: `font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;${warn ? 'background:#FBE0DD;color:#A8261B;' : p && p.pending ? 'background:#FDEBD3;color:#8A4B00;' : p ? 'background:#DDF2E6;color:#17693F;' : req ? 'background:#FBE0DD;color:#A8261B;' : 'background:#E3E7EC;color:#33404F;'}`,
          errorText: p && p.pending && p.error ? p.error : '', hasError: !!(p && p.pending && p.error),
          dropStyle: `height:196px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px;border-radius:10px;${locked ? 'cursor:not-allowed;opacity:0.55;' : 'cursor:pointer;'}${b ? 'border:2px dashed #C62828;background:#FFF6F5;' : 'border:2px dashed #8795A8;background:#F7F8FA;'}`,
          onFile: e => this.onFile(id, k, e),
          takeAria: locked ? `${lbl} photo, locked` : `Take ${lbl} photo with camera`, galleryAria: locked ? `${lbl} photo from gallery, locked` : `Upload ${lbl} photo`,
          replaceAria: locked ? `Replace ${lbl} photo, locked` : `Replace ${lbl} photo`, removeAria: locked ? `Remove ${lbl} photo, locked` : `Remove ${lbl} photo`,
          replaceStyle: lockBtn(false, locked), removeStyle: lockBtn(true, locked),
          remove: () => {
            if (locked) return;
            if (!window.confirm(`Remove the ${lbl} photo?` + (p && p.pending ? ' It has not been uploaded, so it will be deleted from this phone.' : ''))) return;
            if (this.live) return this.liveRemovePhoto(id, k);
            const old = s.photos[id][k]; if (old && old.url && old.url.indexOf('blob:') === 0) URL.revokeObjectURL(old.url); this.upP('photos', id, o => ({ ...o, [k]: null }), 'Photo removed', 'info');
          } };
      });
      const attLocked = this.live && !!s.actAt[id];
      const setAtt = (name, val) => {
        if (attLocked) return this.toast('Report already submitted — tap Edit report first to change attendance', 'err');
        this.setState(st => ({ att: { ...st.att, [id]: { ...st.att[id], [name]: val } }, attDirty: { ...st.attDirty, [id]: true } }), () => this.persist());
      };
      const people = s.crews[id].map(m => {
        const a = s.att[id][m.name], st = a && a.status, present = st === 'Present', absent = !!st && !present, unverified = !st;
        const needR = st === 'Other' && !(a.note || '').trim() && s.attErr[id];
        const half = `min-height:44px;min-width:78px;border:none;font-weight:700;font-size:14px;cursor:pointer;`;
        return { name: m.name, role: m.role, roleTagStyle: this.roleTag(m.role), absent, present, unverified,
          pAria: `Mark ${m.name} present`, aAria: `Mark ${m.name} not present`, groupAria: `Attendance for ${m.name}`,
          rowStyle: `display:flex;flex-direction:column;gap:10px;border-radius:12px;padding:12px;${unverified ? (s.attErr[id] ? 'background:#FFF6F5;border:2px dashed #C62828;' : 'background:#FFFBF2;border:1.5px dashed #D9A55B;') : absent ? 'background:#FFF6F5;border:1.5px solid #EDB3AC;' : 'background:#FFFFFF;border:1.5px solid #DDE2E8;'}`,
          pStyle: half + (present ? 'background:#17693F;color:#FFFFFF;' : 'background:#FFFFFF;color:#5B6472;'),
          aStyle: half + (absent ? 'background:#A8261B;color:#FFFFFF;' : 'background:#FFFFFF;color:#5B6472;'),
          setPresent: () => setAtt(m.name, { status: 'Present', note: '' }),
          setAbsent: () => setAtt(m.name, absent ? a : { status: 'Absent', note: '' }),
          reasonLabelStyle: `font-size:13px;font-weight:700;${needR ? 'color:#A8261B;' : 'color:#33404F;'}`,
          reasons: Component.NOT_PRESENT.map(([val, label]) => ({ label, on: st === val, pick: () => setAtt(m.name, { status: val, note: val === 'Other' ? (a && a.note) || '' : '' }),
            style: `min-height:44px;padding:0 16px;border-radius:999px;font-size:14px;font-weight:700;cursor:pointer;${st === val ? 'background:#0F2540;color:#FFFFFF;border:1.5px solid #0F2540;' : 'background:#FFFFFF;color:#0F2540;border:1.5px solid #C9D1DB;'}` })),
          isOther: st === 'Other', note: (a && a.note) || '', onNote: e => setAtt(m.name, { status: 'Other', note: e.target.value.slice(0, 200) }),
          noteStyle: 'width:100%;min-height:44px;padding:0 12px;border:1.5px solid ' + (needR ? '#C62828' : '#C9D1DB') + ';border-radius:8px;font-size:16px;' };
      });
      const photosOk = this.photosOk(id, s);
      const stepsDef = [['Attendance', !!s.attAt[id]], ['Activity', !!(f.location.trim() && f.details.trim())], ['Photos', photosOk], ['Submitted', !!s.actAt[id]]];
      const steps = stepsDef.map(([label, done]) => ({ label: (done ? '✓ ' : '') + label, aria: `${label}: ${done ? 'done' : 'not done'}`, bar: `height:5px;border-radius:3px;background:${done ? '#F2A65A' : '#2E4B72'};`, labelStyle: `font-size:12px;font-weight:700;${done ? 'color:#FFFFFF;' : 'color:#9FB2CA;'}` }));
      const tabSt = on => `flex:1;min-height:52px;border:none;background:none;display:flex;align-items:center;justify-content:center;gap:6px;font-family:Archivo,sans-serif;font-size:15px;font-weight:700;cursor:pointer;${on ? 'color:#0F2540;box-shadow:inset 0 -3px 0 #E8760F;' : 'color:#5B6472;'}`;
      const tab = s.tabs[id];
      const tabs = [['activity', 'Activity', !s.actAt[id]], ['attendance', 'Attendance', !s.attAt[id]], ['history', 'History', false]].map(([k, label, dot]) => ({ label, dot, selected: tab === k, aria: label + (dot ? ', not submitted' : ''), style: tabSt(tab === k), go: () => this.up('tabs', id, () => k) }));
      const hist = [];
      if (s.actAt[id]) hist.push({ date: `Today · ${todayShort}`, location: f.location, details: f.details, statusLabel: f.status === 'COMPLETE' ? 'Complete' : 'Ongoing', statusStyle: this.statusChip(f.status), leadman: t.leadman, att: `${c.present}/${c.total}`, photos: `${photoCount(id)} photos` });
      this.historyFor(t, s).forEach(h => hist.push({ date: this.fmtDate(h.date, true), location: h.location, details: h.details, statusLabel: h.status === 'COMPLETE' ? 'Complete' : 'Ongoing', statusStyle: this.statusChip(h.status), leadman: t.leadman, att: h.att, photos: `${h.photos} photo${h.photos === 1 ? '' : 's'}` }));

      cur = { ...t, initials: this.initials(t.leadman), chip: CH[st][0], chipStyle: this.chip(st), steps, tabs,
        onActivity: tab === 'activity', onAttendance: tab === 'attendance', onHistory: tab === 'history',
        form: f, set, fs, photoList,
        ongoingStyle: seg(f.status === 'ONGOING', '#B35F00') + (locked ? 'cursor:not-allowed;opacity:0.6;' : ''), completeStyle: seg(f.status === 'COMPLETE', '#17693F') + (locked ? 'cursor:not-allowed;opacity:0.6;' : ''),
        isOngoing: f.status === 'ONGOING', isComplete: f.status === 'COMPLETE',
        isKM: f.unit !== 'Locations', isLoc: f.unit === 'Locations',
        kmStyle: seg(f.unit !== 'Locations', '#0F2540') + 'min-height:44px;font-size:14px;' + (locked ? 'cursor:not-allowed;opacity:0.6;' : ''), locStyle: seg(f.unit === 'Locations', '#0F2540') + 'min-height:44px;font-size:14px;' + (locked ? 'cursor:not-allowed;opacity:0.6;' : ''),
        setKM: () => { this.up('forms', id, o => ({ ...o, unit: 'KM' })); this.scheduleAutosave(id); }, setLoc: () => { this.up('forms', id, o => ({ ...o, unit: 'Locations' })); this.scheduleAutosave(id); },
        submitLabel: s.busy === 'act' ? 'Submitting…' : 'Submit report', editLabel: s.busy === 'edit' ? 'Unlocking…' : 'Edit report',
        actBusy: s.busy === 'act' || s.busy === 'edit', remarksHint: remarksNeeded ? '(required: Ongoing, below target, or manpower above attendance)' : '(optional)',
        syncLine: [pendingN ? `${pendingN} photo${pendingN > 1 ? 's' : ''} waiting to upload` : '', this.live && this.unconfirmed('act|' + id + '|' + s.today) && !s.actAt[id] ? 'Last submit was not confirmed — tap Submit report again' : ''].filter(Boolean).join(' · '),
        chipAria: 'Report status: ' + CH[st][0],
        useBtnStyle: lockBtn(false, locked) + 'font-size:13px;',
        saveLine: dirty ? '● Unsaved — autosaving…' : s.draftAt[id] ? `✓ Saved on this phone · ${s.draftAt[id]}` : 'Not saved yet',
        saveLineStyle: `font-size:13px;font-weight:700;${dirty ? 'color:#8A4B00;' : 'color:#17693F;'}`,
        setOngoing: () => { this.up('forms', id, o => ({ ...o, status: 'ONGOING' })); this.scheduleAutosave(id); }, setComplete: () => { this.up('forms', id, o => ({ ...o, status: 'COMPLETE' })); this.scheduleAutosave(id); },
        storageWarn: (s.storagePct || 0) >= 60, storageHint: `Phone storage ${s.storagePct || 0}% full. Ask admin to export & reset soon.`,
        presentCount: c.present, absentCount: c.total - c.present,
        useAttendance: () => { this.up('forms', id, o => ({ ...o, actualMH: String(c.present) })); this.scheduleAutosave(id); },
        locked: !!s.actAt[id], actDone: !!s.actAt[id], actOpen: !s.actAt[id], actAt: s.actAt[id],
        showActErr: s.showErr[id] && v.list.length > 0, missing: v.list,
        submittedLabel: '✓ Submitted ' + (s.actAt[id] || ''), reportSubmittedLabel: '✓ Report submitted at ' + (s.actAt[id] || ''), attSubmittedLabel: '✓ Attendance submitted at ' + (s.attAt[id] || ''),
        saveDraft: () => this.saveDraft(id),
        submitAct: () => this.submitAct(id), editAct: () => this.editAct(id),
        attDone: !!s.attAt[id], attOpen: !s.attAt[id], attAt: s.attAt[id], showAttErr: s.attErr[id],
        attBtn: s.busy === 'att' ? 'Submitting…' : c.unverified ? `Mark everyone first (${c.unverified} left)` : s.attAt[id] ? 'Update attendance' : `Submit attendance (${c.present}/${c.total})`,
        attDisabled: !!s.busy || c.unverified > 0 || attLocked, unverifiedCount: c.unverified, hasUnverified: c.unverified > 0, notPresentCount: c.verified - c.present,
        attLocked, attLockedNote: 'Report is submitted — tap Edit report on the Activity tab to change attendance.',
        markAll: () => {
          if (!c.unverified) return;
          if (!window.confirm(`Mark the ${c.unverified} remaining crew as Present?`)) return;
          s.crews[id].forEach(m => { if (!(s.att[id][m.name] && s.att[id][m.name].status)) setAtt(m.name, { status: 'Present', note: '' }); });
          this.toast('Remaining crew marked present', 'info');
        },
        submitAtt: () => this.submitAtt(id), people, history: hist, noToday: !s.actAt[id] };
    }

    const tc = { ok: '#17693F', err: '#A8261B', info: '#0F2540' };
    return {
      navItems, todayLong, todayShort, login, kpi, admin, cur, logout: this.logout,
      showNav: !this.live && this.props.prototypeNav !== false,   // live: prototype screen bar never shows
      offline: this.live && !s.online,
      tabsBarStyle: `position:sticky;top:${(!this.live && this.props.prototypeNav !== false ? 52 : 0) + (this.live && !s.online ? 40 : 0)}px;z-index:40;display:flex;background:#FFFFFF;border-bottom:1px solid #DDE2E8;`,
      isLogin: s.screen === 'login', isAdmin: s.screen === 'admin', isTeam: !!t,
      hasToast: !!s.toast, toastMsg: s.toast ? s.toast.msg : '',
      toastStyle: `background:${s.toast ? tc[s.toast.kind] : '#0F2540'};color:#FFFFFF;font-weight:700;font-size:15px;padding:12px 18px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.25);text-align:center;overflow-wrap:anywhere;word-break:break-word;width:max-content;max-width:100%;`,
    };
  }

  render() { return <View v={this.renderVals()} />; }
}

Object.assign(Component.prototype, liveMethods);
