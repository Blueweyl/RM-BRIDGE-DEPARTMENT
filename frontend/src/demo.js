// Demo ONLY: a pretend office backend that lives in this browser, for `npm run dev` and `npm run build:demo`
// (training, trying the app with no Google Sheet). The production build (`npm run build`) does not contain
// this file: api.js only calls it behind the build-time constant __DEMO__ (see vite.config.js).
// It follows the same rules as google-apps-script/Code.gs, in short.

const K = 'bnlex.demo.';
const TEAMS = [
  { teamId: 'demo1', name: 'Demo Bridge Team', short: 'Demo Bridge', leadman: 'Juan Santos', unit: 'Locations',
    crew: [['Juan Santos', 'Leadman'], ['Pedro Reyes', 'Skilled'], ['Jose Cruz', 'Crew'], ['Mario Lopez', 'Crew'], ['Ramon Garcia', 'Crew'], ['Andres Bautista', 'Crew']] },
  { teamId: 'demo2', name: 'Demo Drainage Team', short: 'Demo Drainage', leadman: 'Carlo Mendoza', unit: 'KM',
    crew: [['Carlo Mendoza', 'Leadman'], ['Rafael Torres', 'Skilled'], ['Miguel Flores', 'Crew'], ['Antonio Ramos', 'Crew'], ['Luis Navarro', 'Crew']] },
];
const STATUSES = ['Present', 'Sick', 'Leave', 'No Show', 'Other'];

const get = k => { try { return JSON.parse(localStorage.getItem(K + k) || 'null'); } catch (e) { return null; } };
const put = (k, v) => { try { localStorage.setItem(K + k, JSON.stringify(v)); } catch (e) {} };
const pad = n => String(n).padStart(2, '0');
const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const roster = t => t.crew.map(([name, role]) => ({ personId: t.teamId + '-' + name.toLowerCase().replace(/[^a-z]+/g, '-'), name, role }));
const out = t => ({ teamId: t.teamId, name: t.name, short: t.short, leadman: t.leadman, unit: t.unit });
const fail = (error, extra) => { const e = new Error(error); e.missing = extra && extra.missing; e.alreadySubmitted = extra && extra.alreadySubmitted; e.rosterChanged = extra && extra.rosterChanged; return e; };

export async function demoCall(req) {
  await new Promise(r => setTimeout(r, 250));
  const today = stamp().slice(0, 10);
  const reports = get('reports') || {};
  const team = TEAMS.find(t => t.teamId === req.teamId);
  if (req.action === 'teams') return { ok: true, teams: TEAMS.map(out), today };
  if (!team) throw fail('This team is not in the list any more. Choose your team again.');
  if (req.action === 'team') {
    const list = Object.values(reports).filter(r => r.teamId === team.teamId).sort((a, b) => b.reportDate.localeCompare(a.reportDate));
    return { ok: true, today, team: out(team), roster: roster(team), reports: list };
  }
  const key = team.teamId + '|' + req.reportDate, done = reports[key];
  if (req.action === 'uploadPhoto') {
    if (done) throw fail('This team\'s report was already sent.', { alreadySubmitted: true });
    return { ok: true, photo: { photoId: 'demo-' + String(req.clientId).slice(0, 8), clientId: req.clientId, type: req.type, uploadedAt: stamp() } };
  }
  if (req.action === 'submitReport') {
    if (done) {
      if (done.requestId === req.requestId) return { ok: true, replay: true, ...done };
      throw fail(`This team's report for ${req.reportDate} was already sent.`, { alreadySubmitted: true });
    }
    const people = roster(team), att = {};
    (req.attendance || []).forEach(a => { att[a.personId] = a; });
    if (people.some(p => !att[p.personId] || !STATUSES.includes(att[p.personId].status))) throw fail('Check attendance again.', { rosterChanged: true, missing: ['Check attendance again'] });
    const present = people.filter(p => att[p.personId].status === 'Present').length, f = req.report || {};
    const missing = [];
    if (!present) missing.push('Mark at least one person Present');
    if (!f.location) missing.push('Enter the location');
    if (!req.beforePhotoId && !req.beforeClientId) missing.push('Add the Before photo');
    if (f.status === 'Complete' && !req.afterPhotoId && !req.afterClientId) missing.push('Add the After photo (needed when the work is Complete)');
    if (missing.length) throw fail('Please fix: ' + missing.join('; '), { missing });
    const r = { teamId: team.teamId, reportDate: req.reportDate, reportId: 'DEMO-' + req.reportDate.replace(/-/g, '') + '-' + team.teamId, submittedAt: stamp(), crewPresent: present + '/' + people.length,
      present: present + '/' + people.length, location: f.location, activity: f.activityDetails, status: f.status, target: f.target, actual: f.actual, unit: f.unit, start: f.fromTime, end: f.toTime,
      before: true, after: !!(req.afterPhotoId || req.afterClientId), requestId: req.requestId, version: '1', late: 'No' };
    reports[key] = r; put('reports', reports);
    return { ok: true, ...r };
  }
  throw fail('This app needs updating. Close it and open it again.');
}
