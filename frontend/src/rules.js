// The report rules the app shows before sending. The server checks the same rules again
// (google-apps-script/Code.gs: submitReport_ / validateReport_) and is the one that decides.

export const ABSENT_REASONS = ['Sick', 'Leave', 'No Show', 'Other'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isNum = v => /^\d+(\.\d{1,3})?$/.test(String(v == null ? '' : v).trim());

/** Attendance with everyone Present unless marked otherwise. */
export function attendanceOf(roster, att) {
  return roster.map(m => {
    const a = att && att[m.personId];
    return { ...m, status: a && a.status ? a.status : 'Present', note: (a && a.note) || '' };
  });
}

export function counts(roster, att) {
  const list = attendanceOf(roster, att);
  const present = list.filter(p => p.status === 'Present').length;
  return { present, total: list.length, absent: list.filter(p => p.status !== 'Present') };
}

/** What still needs doing, per step: [{ step, field, text }]. Step 0 attendance, 1 work, 2 photos. */
export function problems(draft, roster) {
  const out = [], w = draft.work, add = (step, field, text) => out.push({ step, field, text });
  const list = attendanceOf(roster, draft.att);
  list.filter(p => p.status === 'Absent').forEach(p => add(0, 'att-' + p.personId, `Choose why ${p.name} is absent`));
  if (roster.length && !list.some(p => p.status === 'Present')) add(0, 'att', 'Mark at least one person Present');
  if (!HHMM.test(w.start || '') || !HHMM.test(w.end || '')) add(1, 'time', 'Enter the start and end time');
  else if (w.start >= w.end) add(1, 'time', 'Start time must be before end time');
  if (!(w.location || '').trim()) add(1, 'location', 'Enter the location');
  if (!(w.details || '').trim()) add(1, 'details', 'Describe the work done');
  if (w.status !== 'Ongoing' && w.status !== 'Complete') add(1, 'status', 'Choose Ongoing or Complete');
  const qty = (k, label) => {
    const v = String(w[k] == null ? '' : w[k]).trim();
    if (!isNum(v)) add(1, k, `Enter the ${label} as a number`);
    else if (Number(v) > 100) add(1, k, `${label[0].toUpperCase() + label.slice(1)} looks wrong (max 100)`);
    else if (w.unit === 'Locations' && Number(v) !== Math.floor(Number(v))) add(1, k, `${label[0].toUpperCase() + label.slice(1)} must be a whole number of locations`);
  };
  qty('target', 'target'); qty('actual', 'actual');
  if ((w.plate || '').trim() && !/^[A-Z0-9 .\/-]{2,20}$/.test(w.plate.trim().toUpperCase())) add(1, 'plate', 'Equipment / plate: letters, numbers, spaces and - / only');
  const ph = draft.photos || {};
  const bad = p => p && (p.lost || p.refused);
  if (!ph.before || bad(ph.before)) add(2, 'before', ph.before ? 'Take the Before photo again' : 'Add the Before photo');
  if (w.status === 'Complete' && (!ph.after || bad(ph.after))) add(2, 'after', ph.after ? 'Take the After photo again' : 'Add the After photo (needed when the work is Complete)');
  else if (w.status !== 'Complete' && bad(ph.after)) add(2, 'after', 'Take the After photo again, or remove it');
  return out;
}
