// Bridge NLEX Daily Report — the screens. Plain components: every value and action comes from App.jsx.
// The busy ones are wrapped in React.memo and get stable handlers from App.jsx, so a tap or a key
// only re-draws what changed (one person's row, one field), which keeps typing smooth on slow phones.
import React, { memo } from 'react';
import { ABSENT_REASONS } from './rules.js';

const LOGO = './savvice-logo.png';
export const STEPS = ['Attendance', 'Work details', 'Photos', 'Review'];

export const Header = memo(function Header({ team, onChangeTeam, saved, dateLabel }) {
  return (
    <header className="top">
      <div className="top-row">
        <img src={LOGO} alt="Savvice" className="top-logo" width="69" height="30" />
        <div className="top-title">
          <div className="top-app">Daily Report</div>
          {team && <div className="top-team">{team}</div>}
        </div>
        {onChangeTeam && <button className="link light" onClick={onChangeTeam}>Change team</button>}
      </div>
      {(dateLabel || saved) && (
        <div className="top-sub">
          <span>{dateLabel}</span>
          {saved && <span className="saved" role="status">✓ Saved automatically</span>}
        </div>
      )}
    </header>
  );
});

export function Banner({ tone = 'info', title, children, action, actionLabel, second, secondLabel }) {
  return (
    <div className={'banner ' + tone} role={tone === 'err' ? 'alert' : 'status'}>
      {title && <b>{title}</b>}
      {children && <span>{children}</span>}
      {(action || second) && (
        <div className="banner-actions">
          {action && <button className="btn small" onClick={action}>{actionLabel}</button>}
          {second && <button className="btn small ghost" onClick={second}>{secondLabel}</button>}
        </div>
      )}
    </div>
  );
}

export function TeamPicker({ teams, loading, error, onPick, onRetry, connected, current }) {
  return (
    <main className="page">
      <h1 className="h1">Choose your team</h1>
      <p className="hint">This phone remembers it. You can change it later.</p>
      {!connected && <Banner tone="err" title="Not connected to the office yet">Open the app link from the office once on this phone.</Banner>}
      {connected && loading && !teams.length && <p className="hint" role="status">Loading teams…</p>}
      {connected && error && <Banner tone="err" title="Could not load the teams" action={onRetry} actionLabel="Try again">{error}</Banner>}
      <div className="list">
        {teams.map(t => (
          <button key={t.teamId} className={'team-btn' + (t.teamId === current ? ' on' : '')} onClick={() => onPick(t.teamId)} aria-label={`Choose ${t.name}${t.leadman ? ', leadman ' + t.leadman : ''}`}>
            <span className="team-name">{t.name}</span>
            {t.leadman && <span className="team-lead">Leadman: {t.leadman}</span>}
          </button>
        ))}
      </div>
    </main>
  );
}

export const StepBar = memo(function StepBar({ step, onGo, done: doneKey }) {
  const done = String(doneKey || '').split(',').map(x => x === '1');   // a string, so memo can compare it
  return (
    <nav className="steps" aria-label="Report steps">
      {STEPS.map((label, i) => (
        <button key={label} className={'step' + (i === step ? ' on' : '') + (done[i] ? ' done' : '')} onClick={() => onGo(i)} aria-current={i === step ? 'step' : undefined}>
          <span className="step-num">{done[i] && i !== step ? '✓' : i + 1}</span>
          <span className="step-label">{label}</span>
        </button>
      ))}
    </nav>
  );
});

const PersonRow = memo(function PersonRow({ personId, name, role, status, note, showErr, onSet }) {
  const away = status !== 'Present', needReason = status === 'Absent';
  return (
    <li className={'person' + (away ? ' away' : '') + (needReason && showErr ? ' err' : '')}>
      <div className="person-row">
        <span className="person-name">{name}{role === 'Leadman' && <span className="tag">Leadman</span>}</span>
        <div className="toggle" role="group" aria-label={'Attendance for ' + name}>
          <button className={!away ? 'on ok' : ''} aria-pressed={!away} onClick={() => onSet(personId, { status: 'Present', note: '' })}>Present</button>
          <button className={away ? 'on bad' : ''} aria-pressed={away} onClick={() => !away && onSet(personId, { status: 'Absent', note: '' })}>Absent</button>
        </div>
      </div>
      {away && (
        <div className="reasons" role="group" aria-label={'Why is ' + name + ' absent?'}>
          <span className={'reason-q' + (needReason && showErr ? ' err-text' : '')}>Why?</span>
          {ABSENT_REASONS.map(r => (
            <button key={r} className={'chip' + (status === r ? ' on' : '')} aria-pressed={status === r} onClick={() => onSet(personId, { status: r, note: r === 'Other' ? note : '' })}>{r}</button>
          ))}
          {status === 'Other' && (
            <input className="input" placeholder="Reason (optional)" maxLength={200} value={note} aria-label={'Reason for ' + name}
              onChange={e => onSet(personId, { status: 'Other', note: e.target.value })} />
          )}
        </div>
      )}
    </li>
  );
});

export function AttendanceStep({ people, present, total, onSet, showErr }) {
  return (
    <section className="card">
      <div className="sec-head">
        <h2 className="h2">Who is here today?</h2>
        <div className="count" aria-live="polite"><b>{present}</b> of {total} present</div>
      </div>
      <p className="hint">Everyone is marked Present. Tap <b>Absent</b> only for people who are not here.</p>
      <ul className="people">
        {people.map(p => <PersonRow key={p.personId} personId={p.personId} name={p.name} role={p.role} status={p.status} note={p.note} showErr={showErr} onSet={onSet} />)}
      </ul>
      {!people.length && <p className="hint">No crew list yet. It loads when there is signal.</p>}
    </section>
  );
}

function Field({ label, hint, err, children }) {
  return (
    <label className={'field' + (err ? ' err' : '')}>
      <span className="label">{label}{hint && <span className="label-hint"> {hint}</span>}</span>
      {children}
    </label>
  );
}

function Seg({ label, value, options, onPick, err }) {
  return (
    <div className={'field' + (err ? ' err' : '')}>
      <span className="label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map(([v, text, tone]) => (
          <button key={v} className={value === v ? 'on ' + (tone || '') : ''} aria-pressed={value === v} onClick={() => onPick(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

export function WorkStep({ work, set, templates, onTemplate, manpower, errs }) {
  const ch = k => e => set(k, e.target.value);
  return (
    <section className="card">
      <h2 className="h2">What did you do?</h2>
      <div className="two">
        <Field label="Start" err={errs.time}><input className="input" type="time" value={work.start} onChange={ch('start')} /></Field>
        <Field label="End" err={errs.time}><input className="input" type="time" value={work.end} onChange={ch('end')} /></Field>
      </div>
      <Field label="Location" err={errs.location}>
        <input className="input" value={work.location} onChange={ch('location')} maxLength={200} placeholder="e.g. Km.11+000 C3 exit ramp" />
      </Field>
      <Field label="Work performed" err={errs.details}>
        <select className="input" value="" onChange={e => { onTemplate(e.target.value); e.target.value = ''; }} aria-label="Pick common work">
          <option value="">Pick common work (optional)…</option>
          {templates.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <textarea className="input area" value={work.details} onChange={ch('details')} maxLength={2000} placeholder="What did the crew do?" />
      </Field>
      <Seg label="Status" value={work.status} err={errs.status} onPick={v => set('status', v)} options={[['Ongoing', 'Ongoing', 'warn'], ['Complete', 'Complete', 'ok']]} />
      <Seg label="Unit" value={work.unit} onPick={v => set('unit', v)} options={[['KM', 'KM'], ['Locations', 'Locations']]} />
      <div className="two">
        <Field label="Target" hint={'(' + work.unit + ')'} err={errs.target}><input className="input num" inputMode="decimal" value={work.target} onChange={ch('target')} /></Field>
        <Field label="Actual" hint={'(' + work.unit + ')'} err={errs.actual}><input className="input num" inputMode="decimal" value={work.actual} onChange={ch('actual')} /></Field>
      </div>
      <div className="readonly" aria-label="Manpower from attendance">Manpower: <b>{manpower}</b> <span className="hint">(from attendance)</span></div>
      <Field label="Equipment / Plate" hint="(optional)" err={errs.plate}>
        <input className="input caps" value={work.plate} onChange={ch('plate')} maxLength={20} placeholder="e.g. NCG 5500" />
      </Field>
      <Field label="Remarks" hint="(optional)">
        <textarea className="input area small" value={work.remarks} onChange={ch('remarks')} maxLength={1000} />
      </Field>
    </section>
  );
}

const PhotoSlot = memo(function PhotoSlot({ label, type, need, photo, preview, uploading, onFile, onRemove, err }) {
  const state = !photo ? (need ? 'Required' : 'Optional')
    : photo.lost ? 'Missing — take it again' : photo.refused ? 'Not accepted — take it again'
    : photo.uploaded ? '✓ Saved' : uploading ? 'Uploading…' : 'Will upload when there is signal';
  const tone = !photo ? (need ? 'need' : '') : photo.lost || photo.refused ? 'bad' : photo.uploaded ? 'ok' : 'wait';
  return (
    <div className={'photo' + (err ? ' err' : '')}>
      <div className="photo-head"><b>{label}</b><span className={'pill ' + tone}>{state}</span></div>
      {photo && preview && <img className="photo-img" src={preview} alt={label + ' photo'} decoding="async" />}
      {photo && !preview && <div className="photo-img empty">{photo.uploaded ? 'Photo saved' : 'Photo'}</div>}
      {photo && photo.refused && <span className="err-text">{photo.refused}</span>}
      <div className="photo-btns">
        <label className="btn" aria-label={(photo ? 'Retake ' : 'Take ') + label + ' photo'}>
          {photo ? 'Retake' : 'Take photo'}
          <input type="file" accept="image/*" capture="environment" hidden onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) onFile(type, f); }} />
        </label>
        <label className="btn ghost" aria-label={'Choose ' + label + ' photo from gallery'}>
          Gallery
          <input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) onFile(type, f); }} />
        </label>
        {photo && <button className="btn ghost danger" onClick={() => onRemove(type)}>Remove</button>}
      </div>
    </div>
  );
});

export function PhotosStep({ photos, previews, uploading = {}, complete, onFile, onRemove, errs }) {
  return (
    <section className="card">
      <h2 className="h2">Photos</h2>
      <PhotoSlot label="Before" type="before" need photo={photos.before} preview={photos.before && previews[photos.before.clientId]} uploading={!!(photos.before && uploading[photos.before.clientId])} onFile={onFile} onRemove={onRemove} err={errs.before} />
      <PhotoSlot label="After" type="after" need={complete} photo={photos.after} preview={photos.after && previews[photos.after.clientId]} uploading={!!(photos.after && uploading[photos.after.clientId])} onFile={onFile} onRemove={onRemove} err={errs.after} />
      <p className="hint">{complete ? 'After photo is needed because the work is Complete.' : 'After photo is optional while the work is Ongoing.'}</p>
    </section>
  );
}

function Row({ k, v }) { return <div className="kv"><span>{k}</span><b>{v || '—'}</b></div>; }

export function Summary({ team, dateLabel, work, present, total, absent, photos, previews }) {
  return (
    <>
      <Row k="Team" v={team} />
      <Row k="Date" v={dateLabel} />
      <Row k="Present" v={`${present} of ${total}`} />
      {absent.length > 0 && <Row k="Absent" v={absent.map(p => `${p.name} (${p.status}${p.note ? ': ' + p.note : ''})`).join(', ')} />}
      <Row k="Time" v={work.start && work.end ? `${work.start} – ${work.end}` : ''} />
      <Row k="Location" v={work.location} />
      <Row k="Work" v={work.details} />
      <Row k="Status" v={work.status} />
      <Row k="Target / Actual" v={`${work.target || '—'} / ${work.actual || '—'} ${work.unit}`} />
      {work.plate && <Row k="Equipment" v={work.plate.toUpperCase()} />}
      {work.remarks && <Row k="Remarks" v={work.remarks} />}
      {photos && (
        <div className="thumbs">
          {['before', 'after'].map(k => photos[k] ? (
            previews[photos[k].clientId] ? <img key={k} src={previews[photos[k].clientId]} alt={k + ' photo'} decoding="async" /> : <div key={k} className="thumb-empty">{k === 'before' ? 'Before' : 'After'} ✓</div>
          ) : null)}
        </div>
      )}
    </>
  );
}

export function ReviewStep({ summary, problems, serverProblems, onFix }) {
  return (
    <section className="card">
      <h2 className="h2">Check and submit</h2>
      {(problems.length > 0 || serverProblems.length > 0) && (
        <div className="banner err" role="alert">
          <b>Before you can submit:</b>
          <ul className="fix-list">
            {problems.map(p => <li key={p.field}><button className="link" onClick={() => onFix(p.step)}>{p.text}</button></li>)}
            {serverProblems.map(t => <li key={t}>{t}</li>)}
          </ul>
        </div>
      )}
      <div className="summary">
        <Summary {...summary} />
      </div>
      <div className="edit-links">
        <button className="link" onClick={() => onFix(0)}>Edit attendance</button>
        <button className="link" onClick={() => onFix(1)}>Edit work</button>
        <button className="link" onClick={() => onFix(2)}>Edit photos</button>
      </div>
    </section>
  );
}

export function Success({ title, line, summary, onDone, onPrevious }) {
  return (
    <main className="page center">
      <div className="big-check" aria-hidden="true">✓</div>
      <h1 className="h1">{title}</h1>
      <p className="lead">{line}</p>
      {summary && <div className="card summary"><Summary {...summary} /></div>}
      <button className="btn primary wide" onClick={onDone}>Done</button>
      <button className="link" onClick={onPrevious}>Previous reports</button>
    </main>
  );
}

export function SentView({ line, summary, onPrevious, extra }) {
  return (
    <main className="page">
      <div className="sent-box" role="status">
        <div className="big-check small" aria-hidden="true">✓</div>
        <div><b>Report sent</b><div>{line}</div></div>
      </div>
      {extra}
      {summary && <div className="card summary"><Summary {...summary} /></div>}
      <p className="hint">Need to change something? Tell the office. They can open it again for you.</p>
      <button className="link" onClick={onPrevious}>Previous reports</button>
    </main>
  );
}

export function WaitingView({ item, sending, online, onRetry, onChange, summary }) {
  return (
    <main className="page">
      <div className={'banner ' + (sending ? 'info' : 'warn')} role="status">
        <b>{sending ? 'Sending your report…' : 'Report saved on this phone'}</b>
        <span>{sending ? 'Keep the app open.' : online ? 'It will send automatically. ' + (item.error ? '(' + item.error + ')' : '') : 'No signal. It will send automatically when there is signal.'}</span>
        {!sending && (
          <div className="banner-actions">
            {online && <button className="btn small" onClick={onRetry}>Try again now</button>}
            {onChange && <button className="btn small ghost" onClick={onChange}>Change something</button>}
          </div>
        )}
      </div>
      {summary && <div className="card summary"><Summary {...summary} /></div>}
    </main>
  );
}

export function Previous({ reports, onBack, team, fmt }) {
  return (
    <main className="page">
      <div className="sec-head"><h1 className="h1">Previous reports</h1><button className="link" onClick={onBack}>Back</button></div>
      <p className="hint">{team} · last 2 weeks</p>
      {!reports.length && <p className="hint">No reports yet.</p>}
      <ul className="list">
        {reports.map(r => (
          <li key={r.reportDate} className="card prev">
            <div className="sec-head"><b>{fmt(r.reportDate)}</b><span className={'pill ' + (r.status === 'Complete' ? 'ok' : 'wait')}>{r.status}</span></div>
            <div>{r.location}</div>
            <div className="hint">{r.activity}</div>
            <div className="hint">Present {r.present} · {r.target} / {r.actual} {r.unit} · photos: {r.after ? 'before + after' : 'before'} · sent {r.sentTime}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function BottomBar({ children }) {
  return <div className="bottom"><div className="bottom-in">{children}</div></div>;
}
