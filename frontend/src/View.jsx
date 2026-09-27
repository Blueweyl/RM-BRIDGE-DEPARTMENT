// Bridge NLEX Daily Report — screens.
// Markup follows the Claude Design v3 template one-to-one; all values and
// style strings come from Component.renderVals().
import React from 'react';
import { css } from './css.js';

const LOGO = './savvice-logo.png';
const H_LABEL = "padding:11px 14px;color:#FFFFFF;font-family:'Archivo',sans-serif;font-weight:700;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;";
const CARD = 'background:#FFFFFF;border:1px solid #DDE2E8;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:14px;';
const STEP_NUM = "width:26px;height:26px;border-radius:50%;background:#0F2540;color:#FFFFFF;font-family:'Archivo',sans-serif;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;";
const STEP_TITLE = "font-family:'Archivo',sans-serif;font-weight:800;font-size:17px;";
const LABEL = 'display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:700;color:#33404F;';
const NUM_INPUT = 'width:100%;min-height:48px;padding:0 12px;border:1.5px solid #C9D1DB;border-radius:8px;font-size:18px;font-weight:700;color:#0F2540;background:#FFFFFF;';
const TIME_INPUT = 'width:100%;min-height:48px;padding:0 8px;border:1.5px solid #C9D1DB;border-radius:8px;font-size:16px;color:#0F2540;background:#FFFFFF;';
const KPI_CARD = 'background:#FFFFFF;border:1px solid #DDE2E8;border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:8px;';
const KPI_LABEL = 'font-size:12px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#5B6472;';
const KPI_NUM = "font-family:'Archivo',sans-serif;font-weight:800;font-size:40px;line-height:1;";
const KPI_SUB = 'font-size:15px;color:#5B6472;font-weight:600;';
const HIST_K = 'font-size:11px;font-weight:700;color:#5B6472;text-transform:uppercase;letter-spacing:0.5px;';

function Step({ n, title, extra }) {
  return (
    <div style={css('display:flex;align-items:center;gap:8px;')}>
      <span style={css(STEP_NUM)}>{n}</span><span style={css(STEP_TITLE)}>{title}</span>{extra}
    </div>
  );
}

function PrototypeNav({ v }) {
  return (
    <nav aria-label="Prototype screen jumper — not part of the real app" style={css('position:sticky;top:0;z-index:60;height:52px;background:#0A1B30;display:flex;align-items:center;gap:6px;padding:0 12px;overflow-x:auto;border-bottom:2px dashed #F2A65A;')}>
      <span style={css("font-family:'JetBrains Mono',monospace;font-size:10px;color:#F2A65A;letter-spacing:1px;text-transform:uppercase;white-space:nowrap;margin-right:4px;")}>Prototype only ›</span>
      {v.navItems.map(n => <button key={n.label} onClick={n.go} style={css(n.style)}>{n.label}</button>)}
    </nav>
  );
}

function Login({ v }) {
  const { login } = v;
  return (
    <div style={css('min-height:calc(100vh - 52px);background:#0F2540;display:flex;align-items:center;justify-content:center;padding:28px 16px;')}>
      <div style={css('width:100%;max-width:380px;display:flex;flex-direction:column;gap:20px;')}>
        <div style={css('display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;')}>
          <div style={css('background:#FFFFFF;border-radius:14px;padding:12px 18px;box-shadow:0 10px 30px rgba(0,0,0,0.25);')}>
            <img src={LOGO} alt="Savvice Corporation — A Metro Pacific Tollway Company" style={css('display:block;height:64px;width:auto;max-width:100%;')} />
          </div>
          <div>
            <div style={css("font-family:'Archivo',sans-serif;font-weight:800;font-size:20px;color:#FFFFFF;letter-spacing:0.3px;line-height:1.1;")}>Bridge NLEX Daily Report</div>
            <div style={css('font-size:13px;color:#AFC0D6;font-weight:600;margin-top:4px;')}>Savvice · NLEX Maintenance</div>
          </div>
        </div>

        <div style={css('background:#FFFFFF;border-radius:16px;padding:26px 22px;box-shadow:0 20px 50px rgba(0,0,0,0.35);')}>
          {login.entering && (
            <div style={css('display:flex;flex-direction:column;align-items:center;gap:18px;')}>
              <div style={css('text-align:center;')}>
                <div style={css("font-family:'Archivo',sans-serif;font-weight:800;font-size:20px;color:#0F2540;")}>Enter your 4-digit PIN</div>
                <div style={css('font-size:14px;color:#5B6472;margin-top:4px;')}>{v.todayLong}</div>
              </div>
              <div style={css('display:flex;gap:16px;')}>
                {login.dots.map((d, i) => <div key={i} style={css(d.style)} />)}
              </div>
              {login.error && (
                <div role="alert" style={css('background:#FBE0DD;color:#A8261B;font-weight:700;font-size:14px;padding:8px 14px;border-radius:8px;text-align:center;white-space:nowrap;')}>Wrong PIN. Please try again.</div>
              )}
              <div style={css('display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:100%;')}>
                {login.keys.map((k, i) => <button key={i} onClick={k.press} aria-label={k.aria} style={css(k.style)}>{k.label}</button>)}
              </div>
            </div>
          )}
          {login.confirmed && (
            <div style={css('display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center;')}>
              <div style={css("width:72px;height:72px;border-radius:50%;background:#0F2540;color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-family:'Archivo',sans-serif;font-weight:800;font-size:26px;")}>{login.user.initials}</div>
              <div>
                <div style={css('font-size:14px;color:#17693F;font-weight:700;')}>✓ PIN accepted</div>
                <div style={css("font-family:'Archivo',sans-serif;font-weight:800;font-size:22px;color:#0F2540;margin-top:4px;")}>{login.user.name}</div>
              </div>
              <div style={css('display:flex;flex-direction:column;gap:6px;width:100%;background:#F2F4F7;border-radius:10px;padding:12px 14px;text-align:left;')}>
                <div style={css('display:flex;justify-content:space-between;gap:10px;font-size:14px;')}><span style={css('color:#5B6472;')}>Role</span><span style={css('font-weight:700;')}>{login.user.role}</span></div>
                <div style={css('display:flex;justify-content:space-between;gap:10px;font-size:14px;')}><span style={css('color:#5B6472;')}>Team</span><span style={css('font-weight:700;text-align:right;')}>{login.user.team}</span></div>
                <div style={css('display:flex;justify-content:space-between;gap:10px;font-size:14px;')}><span style={css('color:#5B6472;')}>Date</span><span style={css('font-weight:700;')}>{v.todayLong}</span></div>
              </div>
              <button onClick={login.proceed} style={css("width:100%;min-height:56px;background:#E8760F;color:#FFFFFF;border:none;border-radius:10px;font-family:'Archivo',sans-serif;font-weight:800;font-size:17px;cursor:pointer;")}>{login.user.cta}</button>
              <button onClick={login.reset} style={css('background:none;border:none;color:#2B4A73;font-size:14px;font-weight:700;text-decoration:underline;cursor:pointer;min-height:44px;')}>Not you? Enter a different PIN</button>
            </div>
          )}
        </div>

        <div style={css('background:#1B3A63;border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;')}>
          <div style={css("font-family:'JetBrains Mono',monospace;font-size:10px;color:#AFC0D6;letter-spacing:1px;text-transform:uppercase;")}>Demo PINs</div>
          <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:13px;color:#FFFFFF;')}>
            <span>0000 · Admin</span><span>1111 · RM Team 1</span><span>2222 · Segment 10</span><span>3333 · Epoxy 1</span><span>4444 · Epoxy 2</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Admin({ v }) {
  const { admin, kpi } = v;
  const r = admin.roster;
  return (
    <div style={css('max-width:1400px;margin:0 auto;padding:20px 16px 60px;display:flex;flex-direction:column;gap:18px;')}>
      <div style={css('background:#0F2540;border-radius:14px;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;')}>
        <div style={css('display:flex;align-items:center;gap:16px;flex-wrap:wrap;')}>
          <div style={css('background:#FFFFFF;border-radius:10px;padding:8px 12px;flex:none;')}>
            <img src={LOGO} alt="Savvice Corporation" style={css('display:block;height:40px;width:auto;')} />
          </div>
          <div>
            <div style={css("font-family:'JetBrains Mono',monospace;font-size:11px;color:#F2A65A;letter-spacing:1.5px;text-transform:uppercase;")}>Operations Command</div>
            <div style={css("font-family:'Archivo',sans-serif;font-weight:800;font-size:24px;color:#FFFFFF;margin-top:2px;")}>Today · {v.todayLong}</div>
          </div>
        </div>
        <div style={css('display:flex;gap:10px;flex-wrap:wrap;')}>
          <button type="button" disabled aria-disabled="true" aria-label="Import Excel, coming soon" title="Coming soon" style={css("white-space:nowrap;min-height:44px;background:transparent;border:1.5px dashed #5E7593;color:#AFC0D6;font-family:'Archivo',sans-serif;font-weight:700;font-size:14px;padding:0 16px;border-radius:8px;cursor:not-allowed;")}>Import Excel · Coming soon</button>
          <button onClick={admin.onExport} aria-label="Download report as CSV file for Excel" style={css("white-space:nowrap;min-height:44px;background:#E8760F;border:none;color:#FFFFFF;font-family:'Archivo',sans-serif;font-weight:700;font-size:14px;padding:0 16px;border-radius:8px;cursor:pointer;")}>Export CSV (Excel)</button>
          <button onClick={admin.resetDemo} style={css('white-space:nowrap;min-height:44px;background:transparent;border:1.5px solid #5E7593;color:#D5DEEA;font-weight:700;font-size:14px;padding:0 14px;border-radius:8px;cursor:pointer;')}>Reset demo data</button>
          <button onClick={v.logout} style={css('white-space:nowrap;min-height:44px;background:#1B3A63;border:none;color:#FFFFFF;font-weight:700;font-size:14px;padding:0 14px;border-radius:8px;cursor:pointer;')}>Log out</button>
        </div>
      </div>

      <div style={css('display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 14px;background:#FFFFFF;border:1px solid #DDE2E8;border-radius:12px;padding:10px 14px;')}>
        <span style={css(admin.storageStyle)}>{admin.storageLine}</span>
        {admin.hasExport && (
          <div style={css('display:flex;align-items:center;gap:10px;flex-wrap:wrap;')}>
            <span style={css('font-size:13px;color:#33404F;overflow-wrap:anywhere;')}>{admin.exportLine}</span>
            <button onClick={admin.copyCsv} aria-label="Copy last export as CSV text" style={css('min-height:44px;background:#FFFFFF;border:1.5px solid #0F2540;color:#0F2540;border-radius:8px;padding:0 12px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;')}>Copy CSV</button>
          </div>
        )}
      </div>

      <div style={css('display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;')}>
        <div style={css(KPI_CARD)}>
          <div style={css(KPI_LABEL)}>Manpower on site</div>
          <div style={css('display:flex;align-items:baseline;gap:8px;')}><span style={css(KPI_NUM)}>{kpi.manpower}</span><span style={css(KPI_SUB)}>/ {kpi.planned} planned</span></div>
          <div style={css('height:6px;border-radius:3px;background:#E7EAEF;overflow:hidden;')}><div style={css(kpi.manBar)} /></div>
        </div>
        <div style={css(KPI_CARD)}>
          <div style={css(KPI_LABEL)}>Jobs completed</div>
          <div style={css('display:flex;align-items:baseline;gap:8px;')}><span style={css(KPI_NUM)}>{kpi.completed}</span><span style={css(KPI_SUB)}>{kpi.ongoingLabel}</span></div>
        </div>
        <div style={css(KPI_CARD)}>
          <div style={css(KPI_LABEL)}>Active crews</div>
          <div style={css('display:flex;align-items:baseline;gap:8px;')}><span style={css(KPI_NUM)}>{kpi.active}</span><span style={css(KPI_SUB)}>of 4 teams</span></div>
        </div>
        <div style={css(kpi.pendingCard)}>
          <div style={css('font-size:12px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#8A4B00;')}>Pending submissions</div>
          <div style={css('display:flex;align-items:baseline;gap:8px;')}><span style={css(KPI_NUM + 'color:#0F2540;')}>{kpi.pending}</span><span style={css('font-size:15px;color:#6B3A00;font-weight:600;')}>need follow-up</span></div>
        </div>
      </div>

      {admin.hasPending && (
        <div style={css('background:#FFFFFF;border:1px solid #DDE2E8;border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;')}>
          <div style={css("font-family:'Archivo',sans-serif;font-weight:700;font-size:16px;")}>Needs attention</div>
          <div style={css('display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:8px;')}>
            {admin.pending.map(p => (
              <button key={p.team} onClick={p.open} style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:56px;background:#F7F8FA;border:1px solid #DDE2E8;border-radius:10px;padding:10px 12px;cursor:pointer;text-align:left;')}>
                <span style={css('display:flex;flex-direction:column;gap:2px;min-width:0;')}>
                  <span style={css('font-weight:700;font-size:14px;color:#0F2540;')}>{p.team}</span>
                  <span style={css('font-size:13px;color:#5B6472;')}>{p.leadman} · {p.note}</span>
                </span>
                <span style={css(p.chipStyle)}>{p.chip}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {admin.allDone && (
        <div style={css('background:#DDF2E6;color:#17693F;border-radius:12px;padding:14px 16px;font-weight:700;font-size:15px;')}>✓ All 4 teams have submitted attendance and activity reports today.</div>
      )}

      <div style={css('display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;')}>
        {admin.tabs.map(at => (
          <button key={at.id} onClick={at.select} style={css(at.style)}>
            <span style={css("font-family:'Archivo',sans-serif;font-weight:700;font-size:14px;")}>{at.label}</span>
            <span style={css(at.subStyle)}>{at.sub}</span>
            {at.hasChip && <span aria-label={at.chipAria} style={css(at.chipStyle)}>{at.chip}</span>}
          </button>
        ))}
      </div>

      <div style={css('background:#FFFFFF;border:1px solid #DDE2E8;border-radius:12px;overflow:hidden;')}>
        <div style={css('display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #DDE2E8;flex-wrap:wrap;')}>
          <div style={css("font-family:'Archivo',sans-serif;font-weight:700;font-size:16px;")}>{admin.tableTitle}</div>
          <div style={css('font-size:13px;color:#5B6472;')}>Scroll sideways for all columns →</div>
        </div>
        <div style={css('overflow-x:auto;-webkit-overflow-scrolling:touch;')}>
          <div style={css('min-width:1320px;')}>
            <div style={css('display:grid;grid-template-columns:200px 90px 210px minmax(280px,1fr) 110px 110px 120px 80px 160px;background:#0F2540;')}>
              {['Team / Leadman', 'Date', 'Location', 'Activity Details', 'Status', 'Target / Actual', 'Manpower', 'Photos', 'Report'].map(h => <div key={h} style={css(H_LABEL)}>{h}</div>)}
            </div>
            {admin.rows.map((row, i) => (
              <div key={i} style={css(row.rowStyle)}>
                <div style={css('padding:12px 14px;display:flex;flex-direction:column;gap:2px;')}><span style={css('font-weight:700;font-size:14px;')}>{row.team}</span><span style={css('font-size:13px;color:#5B6472;')}>{row.leadman}</span></div>
                <div style={css('padding:12px 14px;font-size:14px;')}>{row.date}</div>
                <div style={css('padding:12px 14px;font-size:14px;font-weight:700;')}>{row.location}</div>
                <div style={css(row.detailsStyle)}>{row.details}</div>
                <div style={css('padding:12px 14px;')}>{row.hasStatus && <span style={css(row.statusStyle)}>{row.statusLabel}</span>}</div>
                <div style={css('padding:12px 14px;font-size:14px;')}>{row.targetActual}</div>
                <div style={css('padding:12px 14px;font-size:14px;')}>{row.manpower}</div>
                <div style={css('padding:12px 14px;font-size:14px;')}>{row.photos}</div>
                <div style={css('padding:12px 14px;')}><span style={css(row.reportStyle)}>{row.reportLabel}</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {admin.hasRoster && (
        <div style={css('background:#FFFFFF;border:1px solid #DDE2E8;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:14px;')}>
          <div style={css('display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;')}>
            <div style={css("font-family:'Archivo',sans-serif;font-weight:700;font-size:16px;")}>Crew roster — {r.name}</div>
            <div style={css('font-size:13px;color:#5B6472;')}>{r.count} people</div>
          </div>
          <div style={css('display:flex;gap:8px;flex-wrap:wrap;')}>
            <input type="text" placeholder="New crew member full name" value={r.newVal} onChange={r.onNew} onKeyDown={r.onKey} style={css('flex:1 1 240px;min-height:48px;padding:0 12px;border:1.5px solid #C9D1DB;border-radius:8px;font-size:16px;')} />
            <button onClick={r.add} style={css('min-height:48px;background:#0F2540;color:#FFFFFF;border:none;border-radius:8px;padding:0 18px;font-weight:700;font-size:15px;cursor:pointer;')}>+ Add to crew</button>
          </div>
          <div style={css('display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:8px;')}>
            {r.members.map(m => (
              <div key={m.name} style={css('display:flex;align-items:center;justify-content:space-between;gap:8px;background:#F7F8FA;border:1px solid #E4E8ED;border-radius:10px;padding:8px 8px 8px 12px;min-height:52px;')}>
                <div style={css('display:flex;align-items:center;gap:10px;min-width:0;')}>
                  <span style={css(m.roleTagStyle)}>{m.role}</span>
                  <span style={css('font-size:14px;font-weight:600;')}>{m.name}</span>
                </div>
                {m.removable && <button onClick={m.remove} aria-label={m.removeAria} style={css(m.removeStyle)}>{m.removeLabel}</button>}
              </div>
            ))}
          </div>
          {r.hasArchived && (
            <div style={css('display:flex;flex-direction:column;gap:6px;border-top:1px solid #E7EAEF;padding-top:12px;')}>
              <span style={css('font-size:13px;font-weight:700;color:#33404F;')}>Archived — removed crew (attendance records kept)</span>
              {r.archived.map(a => (
                <div key={a.name} style={css('display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;background:#F7F8FA;border:1px dashed #C9D1DB;border-radius:10px;padding:8px 8px 8px 12px;')}>
                  <span style={css('font-size:14px;color:#33404F;')}><b>{a.name}</b> · {a.meta}</span>
                  <button onClick={a.restore} aria-label={a.aria} style={css('min-height:44px;background:#FFFFFF;border:1.5px solid #0F2540;color:#0F2540;border-radius:8px;padding:0 12px;font-size:13px;font-weight:700;cursor:pointer;')}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityTab({ cur }) {
  return (
    <>
      <div style={css('padding:14px 14px 20px;display:flex;flex-direction:column;gap:14px;')}>
        {cur.actDone && (
          <div style={css('background:#DDF2E6;border:1px solid #A9DBBF;color:#17693F;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:2px;')}>
            <span style={css('font-weight:800;font-size:16px;')}>{cur.reportSubmittedLabel}</span>
            <span style={css('font-size:14px;')}>Fields are locked and saved on this phone. Tap Edit report below to make changes.</span>
          </div>
        )}
        {cur.showActErr && (
          <div id="act-errors" role="alert" style={css('background:#FBE0DD;border:1px solid #EDB3AC;color:#7E1C13;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;')}>
            <span style={css('font-weight:800;font-size:16px;')}>Can't submit yet. Please fix:</span>
            {cur.missing.map(mi => <span key={mi.label} style={css('font-size:14px;font-weight:600;')}>• {mi.label}</span>)}
          </div>
        )}

        <fieldset disabled={cur.locked} style={css('border:none;margin:0;padding:0;min-width:0;display:flex;flex-direction:column;gap:14px;')}>
          <div style={css(CARD)}>
            <Step n="1" title="When & where" />
            <div style={css('display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px 10px;min-height:44px;padding:8px 12px;border-radius:8px;background:#EEF1F4;')}>
              <span style={css('font-size:13px;font-weight:700;color:#33404F;')}>Date (auto-filled)</span>
              <span style={css('font-size:15px;font-weight:700;color:#0F2540;')}>{cur.todayLong}</span>
            </div>
            <div style={css('display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;')}>
              <label style={css(LABEL)}>From
                <input type="time" value={cur.form.from} onChange={cur.set.from} style={css(TIME_INPUT)} />
              </label>
              <label style={css(LABEL)}>To
                <input type="time" value={cur.form.to} onChange={cur.set.to} style={css(TIME_INPUT)} />
              </label>
            </div>
            <label style={css(LABEL)}>Location
              <input type="text" placeholder="e.g. CANDABA VIADUCT North bound" value={cur.form.location} onChange={cur.set.location} style={css(cur.fs.location)} />
            </label>
          </div>

          <div style={css(CARD)}>
            <Step n="2" title="Work done" />
            <label style={css(LABEL)}>Activity details
              <textarea rows="3" placeholder="What did the crew do today?" value={cur.form.details} onChange={cur.set.details} style={css(cur.fs.details)} />
            </label>
            <div style={css('display:flex;flex-direction:column;gap:6px;')}>
              <span style={css('font-size:13px;font-weight:700;color:#33404F;')}>Status</span>
              <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:8px;')}>
                <button type="button" aria-pressed={cur.isOngoing} onClick={cur.setOngoing} style={css(cur.ongoingStyle)}>Ongoing</button>
                <button type="button" aria-pressed={cur.isComplete} onClick={cur.setComplete} style={css(cur.completeStyle)}>Complete</button>
              </div>
            </div>
            <div style={css('display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;')}>
              <label style={css(LABEL)}>Target (KM / locations)
                <input type="number" inputMode="decimal" value={cur.form.targetLoc} onChange={cur.set.targetLoc} style={css(NUM_INPUT)} />
              </label>
              <label style={css(LABEL)}>Actual (KM / locations)
                <input type="number" inputMode="decimal" value={cur.form.actualLoc} onChange={cur.set.actualLoc} style={css(NUM_INPUT)} />
              </label>
            </div>
          </div>

          <div style={css(CARD)}>
            <Step n="3" title="Manpower & equipment" />
            <div style={css('display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;')}>
              <label style={css(LABEL)}>Target manpower
                <input type="number" inputMode="numeric" value={cur.form.targetMH} onChange={cur.set.targetMH} style={css(NUM_INPUT)} />
              </label>
              <label style={css(LABEL)}>Actual manpower
                <input type="number" inputMode="numeric" value={cur.form.actualMH} onChange={cur.set.actualMH} style={css(cur.fs.actualMH)} />
              </label>
            </div>
            <div style={css('display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;background:#F2F4F7;border-radius:8px;padding:8px 10px;')}>
              <span style={css('font-size:14px;color:#33404F;')}>Attendance shows <b>{cur.presentCount} present</b></span>
              <button type="button" aria-label="Set actual manpower to attendance present count" onClick={cur.useAttendance} style={css(cur.useBtnStyle)}>Use this number</button>
            </div>
            <label style={css(LABEL)}>Equipment / plate number
              <input type="text" placeholder="e.g. NCG 5500" value={cur.form.plate} onChange={cur.set.plate} style={css(cur.fs.plate)} />
            </label>
          </div>

          <div style={css(CARD)}>
            <Step n="4" title="Remarks" extra={<span style={css('font-size:13px;color:#5B6472;')}>(optional)</span>} />
            <textarea rows="2" placeholder="Issues, delays, materials needed…" value={cur.form.remarks} onChange={cur.set.remarks} style={css('width:100%;min-height:72px;padding:12px;border:1.5px solid #C9D1DB;border-radius:8px;font-size:16px;color:#0F2540;background:#FFFFFF;resize:vertical;line-height:1.4;')} />
          </div>

          <div style={css(CARD)}>
            <Step n="5" title="Site photos" />
            {cur.storageWarn && (
              <div role="alert" style={css('background:#FDEBD3;border:1px solid #F3C98F;color:#6B3A00;border-radius:8px;padding:8px 10px;font-size:14px;font-weight:700;')}>{cur.storageHint}</div>
            )}
            <div style={css('display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;')}>
              {cur.photoList.map(ph => (
                <div key={ph.label} style={css('display:flex;flex-direction:column;gap:8px;min-width:0;')}>
                  <div style={css('display:flex;justify-content:space-between;align-items:center;gap:6px;')}>
                    <span style={css('font-size:15px;font-weight:800;')}>{ph.label}</span>
                    <span style={css(ph.reqStyle)}>{ph.reqLabel}</span>
                  </div>
                  {ph.empty && (
                    <label aria-label={ph.takeAria} style={css(ph.dropStyle)}>
                      <input type="file" accept="image/*" onChange={ph.onFile} style={css('display:none;')} />
                      <span style={css('width:44px;height:44px;border-radius:50%;background:#0F2540;color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;line-height:1;')}>+</span>
                      <span style={css('font-size:15px;font-weight:800;color:#0F2540;')}>Upload photo</span>
                      <span style={css('font-size:12px;color:#5B6472;text-align:center;')}>{ph.hint}</span>
                    </label>
                  )}
                  {ph.filled && (
                    <>
                      <div style={css('position:relative;height:150px;border-radius:10px;overflow:hidden;border:1px solid #C9D1DB;background:repeating-linear-gradient(45deg,#CDD5DF 0 8px,#DAE0E8 8px 16px);')}>
                        {ph.hasUrl && <div style={css(ph.previewStyle)} />}
                        {ph.noUrl && <div style={css("position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:11px;color:#3C4858;")}>site photo</div>}
                        <span style={css('position:absolute;left:8px;top:8px;background:#17693F;color:#FFFFFF;font-size:12px;font-weight:700;padding:3px 8px;border-radius:6px;')}>✓ {ph.time}</span>
                      </div>
                      <span style={css("font-family:'JetBrains Mono',monospace;font-size:11px;color:#5B6472;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;")}>{ph.name}</span>
                      <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:6px;')}>
                        <label aria-label={ph.replaceAria} style={css(ph.replaceStyle)}>
                          <input type="file" accept="image/*" onChange={ph.onFile} style={css('display:none;')} />
                          Replace
                        </label>
                        <button type="button" onClick={ph.remove} aria-label={ph.removeAria} style={css(ph.removeStyle)}>Remove</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </fieldset>
      </div>
      <div style={css('position:sticky;bottom:0;z-index:30;background:#FFFFFF;border-top:1px solid #DDE2E8;padding:10px 14px 12px;display:flex;flex-direction:column;gap:8px;box-shadow:0 -6px 18px rgba(15,37,64,0.08);')}>
        {cur.actOpen && (
          <>
            <div role="status" aria-live="polite" style={css(cur.saveLineStyle)}>{cur.saveLine}</div>
            <div style={css('display:flex;gap:10px;')}>
              <button onClick={cur.saveDraft} style={css("flex:1;min-height:56px;background:#FFFFFF;border:1.5px solid #0F2540;color:#0F2540;border-radius:10px;font-family:'Archivo',sans-serif;font-weight:700;font-size:16px;cursor:pointer;")}>Save draft</button>
              <button onClick={cur.submitAct} style={css("flex:2;min-height:56px;background:#E8760F;border:none;color:#FFFFFF;border-radius:10px;font-family:'Archivo',sans-serif;font-weight:800;font-size:17px;cursor:pointer;")}>Submit report</button>
            </div>
          </>
        )}
        {cur.actDone && (
          <div style={css('display:flex;gap:10px;')}>
            <div style={css('flex:2;display:flex;align-items:center;font-weight:800;font-size:15px;color:#17693F;')}>{cur.submittedLabel}</div>
            <button onClick={cur.editAct} style={css("flex:1;min-height:56px;background:#FFFFFF;border:1.5px solid #0F2540;color:#0F2540;border-radius:10px;font-family:'Archivo',sans-serif;font-weight:700;font-size:16px;cursor:pointer;")}>Edit report</button>
          </div>
        )}
      </div>
    </>
  );
}

function AttendanceTab({ cur }) {
  return (
    <>
      <div style={css('padding:14px 14px 20px;display:flex;flex-direction:column;gap:12px;')}>
        {cur.attDone && <div style={css('background:#DDF2E6;border:1px solid #A9DBBF;color:#17693F;border-radius:12px;padding:12px 14px;font-weight:700;font-size:15px;')}>{cur.attSubmittedLabel}</div>}
        {cur.attOpen && <div style={css('background:#FDEBD3;border:1px solid #F3C98F;color:#6B3A00;border-radius:12px;padding:12px 14px;font-size:15px;')}><b>Not submitted yet.</b> Admin sees this team as Missing Attendance.</div>}
        {cur.showAttErr && <div id="att-errors" role="alert" style={css('background:#FBE0DD;border:1px solid #EDB3AC;color:#7E1C13;border-radius:12px;padding:12px 14px;font-weight:700;font-size:15px;')}>Choose a reason for every absent crew member.</div>}
        <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;background:#FFFFFF;border:1px solid #DDE2E8;border-radius:12px;padding:12px 14px;flex-wrap:wrap;')}>
          <div style={css('display:flex;gap:18px;')}>
            <div style={css('display:flex;flex-direction:column;')}><span style={css("font-family:'Archivo',sans-serif;font-weight:800;font-size:28px;color:#17693F;line-height:1;")}>{cur.presentCount}</span><span style={css('font-size:13px;font-weight:700;color:#33404F;')}>Present</span></div>
            <div style={css('display:flex;flex-direction:column;')}><span style={css("font-family:'Archivo',sans-serif;font-weight:800;font-size:28px;color:#A8261B;line-height:1;")}>{cur.absentCount}</span><span style={css('font-size:13px;font-weight:700;color:#33404F;')}>Absent</span></div>
          </div>
          <button onClick={cur.markAll} style={css('min-height:48px;background:#0F2540;color:#FFFFFF;border:none;border-radius:10px;padding:0 16px;font-weight:700;font-size:15px;cursor:pointer;')}>Mark all present</button>
        </div>
        <div style={css('display:flex;flex-direction:column;gap:8px;')}>
          {cur.people.map(m => (
            <div key={m.name} style={css(m.rowStyle)}>
              <div style={css('display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;')}>
                <div style={css('display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 140px;')}>
                  <span style={css('font-size:16px;font-weight:700;')}>{m.name}</span>
                  <span style={css(m.roleTagStyle)}>{m.role}</span>
                </div>
                <div role="group" aria-label={m.groupAria} style={css('display:flex;border:1.5px solid #C9D1DB;border-radius:10px;overflow:hidden;flex:none;margin-left:auto;')}>
                  <button aria-pressed={m.present} aria-label={m.pAria} onClick={m.setPresent} style={css(m.pStyle)}>Present</button>
                  <button aria-pressed={m.absent} aria-label={m.aAria} onClick={m.setAbsent} style={css(m.aStyle)}>Absent</button>
                </div>
              </div>
              {m.absent && (
                <div style={css('display:flex;flex-direction:column;gap:6px;')}>
                  <span style={css(m.reasonLabelStyle)}>Reason for absence</span>
                  <div style={css('display:flex;flex-wrap:wrap;gap:6px;')}>
                    {m.reasons.map(r => <button key={r.label} aria-pressed={r.on} onClick={r.pick} style={css(r.style)}>{r.label}</button>)}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div style={css('position:sticky;bottom:0;z-index:30;background:#FFFFFF;border-top:1px solid #DDE2E8;padding:12px 14px;box-shadow:0 -6px 18px rgba(15,37,64,0.08);')}>
        <button onClick={cur.submitAtt} style={css("width:100%;min-height:56px;background:#E8760F;border:none;color:#FFFFFF;border-radius:10px;font-family:'Archivo',sans-serif;font-weight:800;font-size:17px;cursor:pointer;")}>{cur.attBtn}</button>
      </div>
    </>
  );
}

function HistoryTab({ cur }) {
  return (
    <div style={css('padding:14px 14px 28px;display:flex;flex-direction:column;gap:10px;')}>
      {cur.history.map(h => (
        <div key={h.date} style={css('background:#FFFFFF;border:1px solid #DDE2E8;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;')}>
          <div style={css('display:flex;justify-content:space-between;align-items:center;gap:8px;')}>
            <span style={css('font-size:14px;font-weight:700;color:#33404F;')}>{h.date}</span>
            <span style={css(h.statusStyle)}>{h.statusLabel}</span>
          </div>
          <div style={css("font-family:'Archivo',sans-serif;font-weight:800;font-size:16px;")}>{h.location}</div>
          <div style={css('font-size:14px;color:#33404F;line-height:1.45;')}>{h.details}</div>
          <div style={css('display:grid;grid-template-columns:repeat(3,1fr);gap:8px;border-top:1px solid #E7EAEF;padding-top:10px;')}>
            <div style={css('display:flex;flex-direction:column;gap:2px;')}><span style={css(HIST_K)}>Leadman</span><span style={css('font-size:13px;font-weight:700;')}>{h.leadman}</span></div>
            <div style={css('display:flex;flex-direction:column;gap:2px;')}><span style={css(HIST_K)}>Crew present</span><span style={css('font-size:13px;font-weight:700;')}>{h.att}</span></div>
            <div style={css('display:flex;flex-direction:column;gap:2px;')}><span style={css(HIST_K)}>Photos</span><span style={css('font-size:13px;font-weight:700;')}>{h.photos}</span></div>
          </div>
        </div>
      ))}
      {cur.noToday && <div style={css('border:1.5px dashed #C9D1DB;border-radius:12px;padding:14px;text-align:center;font-size:14px;color:#5B6472;')}>Today's report will appear here after you submit it.</div>}
    </div>
  );
}

function Team({ v }) {
  const cur = { ...v.cur, todayLong: v.todayLong };
  return (
    <div style={css('max-width:560px;margin:0 auto;background:#F4F6F9;min-height:calc(100vh - 52px);box-shadow:0 0 0 1px #DDE2E8;')}>
      <div style={css('background:#FFFFFF;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:3px solid #E8760F;')}>
        <img src={LOGO} alt="Savvice Corporation" style={css('display:block;height:30px;width:auto;')} />
        <span style={css("font-family:'Archivo',sans-serif;font-weight:800;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#0F2540;text-align:right;")}>NLEX Daily Report</span>
      </div>
      <div style={css('background:#0F2540;padding:16px 16px 14px;display:flex;flex-direction:column;gap:14px;')}>
        <div style={css('display:flex;align-items:center;gap:12px;')}>
          <div style={css("width:48px;height:48px;border-radius:50%;background:#E8760F;display:flex;align-items:center;justify-content:center;font-family:'Archivo',sans-serif;font-weight:800;color:#0F2540;font-size:17px;flex:none;")}>{cur.initials}</div>
          <div style={css('flex:1;min-width:0;')}>
            <div style={css("font-family:'Archivo',sans-serif;font-weight:800;font-size:17px;color:#FFFFFF;")}>{cur.leadman}</div>
            <div style={css('font-size:14px;color:#C5D2E2;')}>Leadman · {cur.name}</div>
          </div>
          <button onClick={v.logout} style={css('min-height:44px;background:#1B3A63;border:none;color:#FFFFFF;font-weight:700;font-size:13px;padding:0 12px;border-radius:8px;cursor:pointer;flex:none;')}>Log out</button>
        </div>
        <div style={css('display:flex;justify-content:space-between;align-items:center;gap:10px;')}>
          <span style={css('font-size:14px;color:#FFFFFF;font-weight:600;')}>{v.todayLong}</span>
          <span role="status" aria-label={cur.chipAria} style={css(cur.chipStyle)}>{cur.chip}</span>
        </div>
        <div role="list" aria-label="Report progress" style={css('display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;')}>
          {cur.steps.map(st => (
            <div key={st.aria} role="listitem" aria-label={st.aria} style={css('display:flex;flex-direction:column;gap:5px;min-width:0;')}>
              <div aria-hidden="true" style={css(st.bar)} />
              <span style={css(st.labelStyle)}>{st.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div role="tablist" aria-label="Report sections" style={css(v.tabsBarStyle)}>
        {cur.tabs.map(tb => (
          <button key={tb.label} role="tab" aria-selected={tb.selected} aria-label={tb.aria} onClick={tb.go} style={css(tb.style)}>
            {tb.label}
            {tb.dot && <span style={css('width:8px;height:8px;border-radius:50%;background:#C62828;display:inline-block;')} />}
          </button>
        ))}
      </div>

      {cur.onActivity && <ActivityTab cur={cur} />}
      {cur.onAttendance && <AttendanceTab cur={cur} />}
      {cur.onHistory && <HistoryTab cur={cur} />}

    </div>
  );
}

export default function View({ v }) {
  return (
    <>
      {v.showNav && <PrototypeNav v={v} />}
      {v.isLogin && <Login v={v} />}
      {v.isAdmin && <Admin v={v} />}
      {v.isTeam && <Team key={v.cur.id} v={v} />}
      {v.hasToast && (
        <div style={css('position:fixed;left:16px;right:16px;bottom:92px;z-index:100;display:flex;justify-content:center;pointer-events:none;')}>
          <div role="status" aria-live="polite" style={css(v.toastStyle)}>{v.toastMsg}</div>
        </div>
      )}
    </>
  );
}
