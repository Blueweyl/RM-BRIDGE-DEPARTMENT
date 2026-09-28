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

const TONE = {
  warn: 'background:#FDEBD3;border:1px solid #F3C98F;color:#6B3A00;',
  info: 'background:#E3E9F2;border:1px solid #C5D2E2;color:#2B4A73;',
  err: 'background:#FBE0DD;border:1px solid #EDB3AC;color:#7E1C13;',
};

/** Where a record stands: Pending sync / Syncing / Conflict / Not accepted (server confirmed shows as the green banner). */
function SyncBox({ box }) {
  if (!box) return null;
  return (
    <div role="status" aria-live="polite" style={css(TONE[box.tone] + 'border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;')}>
      <span style={css('font-weight:800;font-size:15px;')}>{box.title}</span>
      <span style={css('font-size:14px;overflow-wrap:anywhere;')}>{box.text}</span>
      {box.actions && box.actions.length > 0 && (
        <div style={css('display:flex;gap:8px;flex-wrap:wrap;')}>
          {box.actions.map(a => <button key={a.label} onClick={a.go} style={css('min-height:44px;background:#FFFFFF;border:1.5px solid #0F2540;color:#0F2540;border-radius:8px;padding:0 14px;font-size:14px;font-weight:700;cursor:pointer;')}>{a.label}</button>)}
        </div>
      )}
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
              {login.checking && <div role="status" style={css('font-size:14px;font-weight:700;color:#2B4A73;')}>Checking PIN…</div>}
              {login.message && (
                <div role="alert" style={css('background:#FBE0DD;color:#A8261B;font-weight:700;font-size:14px;padding:8px 14px;border-radius:8px;text-align:center;')}>{login.message}</div>
              )}
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

        {login.demoPins}
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
          {admin.live ? (
            <>
              <button onClick={admin.refresh} style={css('white-space:nowrap;min-height:44px;background:transparent;border:1.5px solid #5E7593;color:#D5DEEA;font-weight:700;font-size:14px;padding:0 14px;border-radius:8px;cursor:pointer;')}>↻ Refresh</button>
              {admin.hasSheet && <a href={admin.sheetUrl} target="_blank" rel="noopener noreferrer" style={css('white-space:nowrap;min-height:44px;display:inline-flex;align-items:center;background:transparent;border:1.5px solid #5E7593;color:#D5DEEA;font-weight:700;font-size:14px;padding:0 14px;border-radius:8px;text-decoration:none;')}>Open Google Sheet</a>}
            </>
          ) : (
            <button type="button" disabled aria-disabled="true" aria-label="Import Excel, coming soon" title="Coming soon" style={css("white-space:nowrap;min-height:44px;background:transparent;border:1.5px dashed #5E7593;color:#AFC0D6;font-family:'Archivo',sans-serif;font-weight:700;font-size:14px;padding:0 16px;border-radius:8px;cursor:not-allowed;")}>Import Excel · Coming soon</button>
          )}
          <button onClick={admin.onExport} aria-label="Download report as CSV file for Excel" style={css("white-space:nowrap;min-height:44px;background:#E8760F;border:none;color:#FFFFFF;font-family:'Archivo',sans-serif;font-weight:700;font-size:14px;padding:0 16px;border-radius:8px;cursor:pointer;")}>{admin.exportLabel}</button>
          {admin.showReset && <button onClick={admin.resetDemo} style={css('white-space:nowrap;min-height:44px;background:transparent;border:1.5px solid #5E7593;color:#D5DEEA;font-weight:700;font-size:14px;padding:0 14px;border-radius:8px;cursor:pointer;')}>Reset demo data</button>}
          <button onClick={v.logout} style={css('white-space:nowrap;min-height:44px;background:#1B3A63;border:none;color:#FFFFFF;font-weight:700;font-size:14px;padding:0 14px;border-radius:8px;cursor:pointer;')}>Log out</button>
        </div>
      </div>

      <div style={css('display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 14px;background:#FFFFFF;border:1px solid #DDE2E8;border-radius:12px;padding:10px 14px;')}>
        <span style={css(admin.storageStyle)}>{admin.storageLine}</span>
        {admin.hasExport && (
          <div style={css('display:flex;align-items:center;gap:10px;flex-wrap:wrap;')}>
            <span style={css('font-size:13px;color:#33404F;overflow-wrap:anywhere;')}>{admin.exportLine}</span>
            <button onClick={admin.copyCsv} aria-label="Copy last export as CSV text" style={css('min-height:44px;background:#FFFFFF;border:1.5px solid #0F2540;color:#0F2540;border-radius:8px;padding:0 12px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;')}>Copy CSV</button>
            {admin.hasXlsx && <a href={admin.xlsxUrl} target="_blank" rel="noopener noreferrer" style={css('min-height:44px;display:inline-flex;align-items:center;background:#FFFFFF;border:1.5px solid #0F2540;color:#0F2540;border-radius:8px;padding:0 12px;font-size:13px;font-weight:700;white-space:nowrap;text-decoration:none;')}>Download .xlsx</a>}
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
          <div style={css('display:flex;align-items:baseline;gap:8px;')}><span style={css(KPI_NUM)}>{kpi.active}</span><span style={css(KPI_SUB)}>of {kpi.teamCount} teams</span></div>
        </div>
        <div style={css(kpi.pendingCard)}>
          <div style={css('font-size:12px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#8A4B00;')}>Pending submissions</div>
          <div style={css('display:flex;align-items:baseline;gap:8px;')}><span style={css(KPI_NUM + 'color:#0F2540;')}>{kpi.pending}</span><span style={css('font-size:15px;color:#6B3A00;font-weight:600;')}>need follow-up</span></div>
        </div>
      </div>

      {admin.auditWarn && <div role="alert" style={css(TONE.err + 'border-radius:12px;padding:12px 14px;font-weight:700;font-size:14px;')}>{admin.auditWarn}</div>}

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
        <div style={css('background:#DDF2E6;color:#17693F;border-radius:12px;padding:14px 16px;font-weight:700;font-size:15px;')}>✓ All {kpi.teamCount} teams have submitted attendance and activity reports today.</div>
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

      {admin.hasTools && <AdminTools t={admin.tools} />}

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

const TOOL_BTN = 'min-height:44px;background:#FFFFFF;border:1.5px solid #0F2540;color:#0F2540;border-radius:8px;padding:0 14px;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;';
const DATE_INPUT = 'min-height:44px;padding:0 10px;border:1.5px solid #C9D1DB;border-radius:8px;font-size:15px;color:#0F2540;background:#FFFFFF;';
const CELL = 'padding:10px 12px;font-size:13px;';

function AdminTools({ t }) {
  return (
    <div style={css('background:#FFFFFF;border:1px solid #DDE2E8;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px;')}>
      <div style={css("font-family:'Archivo',sans-serif;font-weight:700;font-size:16px;")}>Reports, history & audit</div>
      <div style={css('display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;')}>
        <label style={css(LABEL)}>From<input type="date" aria-label="From date" value={t.from} max={t.max} onChange={t.onFrom} style={css(DATE_INPUT)} /></label>
        <label style={css(LABEL)}>To<input type="date" aria-label="To date" value={t.to} max={t.max} onChange={t.onTo} style={css(DATE_INPUT)} /></label>
        <button onClick={t.showReports} style={css(TOOL_BTN)}>{t.reportsLabel}</button>
        <button onClick={t.showAudit} style={css(TOOL_BTN)}>{t.auditLabel}</button>
        <span style={css('font-size:13px;color:#5B6472;')}>Export CSV (top) uses this date range.</span>
      </div>

      {t.onReports && (
        <div style={css('display:flex;flex-direction:column;gap:8px;')}>
          <div style={css('display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:13px;font-weight:700;color:#33404F;')}><span>{t.reportsSummary}</span><button onClick={t.close} style={css(TOOL_BTN + 'min-height:36px;')}>Close</button></div>
          <div style={css('overflow-x:auto;')}>
            <div role="table" aria-label="Reports in date range" style={css('min-width:980px;')}>
              <div role="row" style={css('display:grid;grid-template-columns:120px 200px 110px minmax(160px,1fr) 190px 80px 70px 120px;background:#0F2540;')}>
                {['Date', 'Team', 'Report', 'Location', 'Attendance', 'Photos', 'Version', ''].map(h => <div role="columnheader" key={h} style={css(H_LABEL)}>{h}</div>)}
              </div>
              {t.reportRows.map((r, i) => (
                <div role="row" key={r.key} style={css(`display:grid;grid-template-columns:120px 200px 110px minmax(160px,1fr) 190px 80px 70px 120px;align-items:center;border-top:1px solid #E7EAEF;background:${i % 2 ? '#F9FAFB' : '#FFFFFF'};`)}>
                  <div style={css(CELL + 'font-weight:700;')}>{r.date}</div>
                  <div style={css(CELL + 'display:flex;flex-direction:column;')}><b>{r.team}</b><span style={css('color:#5B6472;')}>{r.leadman}</span></div>
                  <div style={css(CELL + 'display:flex;flex-direction:column;gap:4px;align-items:flex-start;')}><span style={css(r.stateStyle)}>{r.state}</span>{r.late && <span style={css(r.lateStyle)}>{r.lateLabel}</span>}{r.flags.map(f => <span key={f.label} title={f.title} style={css(f.style)}>{f.label}</span>)}</div>
                  <div style={css(CELL)}>{r.location}</div>
                  <div style={css(CELL + (r.attOk ? '' : 'color:#A8261B;font-weight:700;'))}>{r.attendance}</div>
                  <div style={css(CELL + (r.photosOk ? '' : 'color:#A8261B;font-weight:700;'))}>{r.photos}</div>
                  <div style={css(CELL)}>{r.version}</div>
                  <div style={css(CELL)}>{r.hasHistory && <button onClick={r.history} aria-label={`History for ${r.team} ${r.date}`} style={css(TOOL_BTN + 'min-height:36px;padding:0 10px;font-size:12px;')}>{r.historyLabel}</button>}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {t.hasRevisions && (
        <div style={css('border:1px solid #C5D2E2;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;background:#F7F9FC;')}>
          <div style={css('display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;')}><b style={css('font-size:14px;')}>{t.revisionsTitle}</b><button onClick={t.closeRevisions} style={css(TOOL_BTN + 'min-height:36px;')}>Close</button></div>
          {t.noRevisions && <span style={css('font-size:13px;color:#5B6472;')}>No revisions yet.</span>}
          {t.revisions.map(v => (
            <div key={v.key} style={css('background:#FFFFFF;border:1px solid #DDE2E8;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;font-size:13px;')}>
              <span style={css('font-weight:700;')}>{v.title}</span>
              <span style={css('color:#5B6472;')}>{v.meta}</span>
              {v.reason && <span>Reason / changes: {v.reason}</span>}
              {v.summary && <span style={css('color:#33404F;')}>{v.summary}</span>}
            </div>
          ))}
        </div>
      )}

      {t.onAudit && (
        <div style={css('display:flex;flex-direction:column;gap:8px;')}>
          <div style={css('display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:13px;font-weight:700;color:#33404F;')}><span>{t.auditSummary}</span><button onClick={t.close} style={css(TOOL_BTN + 'min-height:36px;')}>Close</button></div>
          <div style={css('overflow-x:auto;')}>
            <div role="table" aria-label="Audit log" style={css('min-width:900px;')}>
              <div role="row" style={css('display:grid;grid-template-columns:150px 180px 70px 200px minmax(240px,1fr);background:#0F2540;')}>
                {['Time', 'User', 'Team', 'Action', 'Detail'].map(h => <div role="columnheader" key={h} style={css(H_LABEL)}>{h}</div>)}
              </div>
              {t.auditRows.map((a, i) => (
                <div role="row" key={a.key} style={css(`display:grid;grid-template-columns:150px 180px 70px 200px minmax(240px,1fr);border-top:1px solid #E7EAEF;background:${a.denied ? '#FFF6F5' : i % 2 ? '#F9FAFB' : '#FFFFFF'};`)}>
                  <div style={css(CELL + "font-family:'JetBrains Mono',monospace;font-size:12px;")}>{a.at}</div>
                  <div style={css(CELL)}>{a.who}</div>
                  <div style={css(CELL)}>{a.team}</div>
                  <div style={css(CELL + 'font-weight:700;' + (a.denied ? 'color:#A8261B;' : ''))}>{a.action}</div>
                  <div style={css(CELL + 'overflow-wrap:anywhere;color:#33404F;')}>{a.detail}</div>
                </div>
              ))}
            </div>
          </div>
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
                <input type="time" value={cur.form.from} onChange={cur.set.from} style={css(cur.fs.from)} />
              </label>
              <label style={css(LABEL)}>To
                <input type="time" value={cur.form.to} onChange={cur.set.to} style={css(cur.fs.to)} />
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
                <input type="number" inputMode="decimal" min="0" max="100" step="any" value={cur.form.targetLoc} onChange={cur.set.targetLoc} style={css(cur.fs.targetLoc)} />
              </label>
              <label style={css(LABEL)}>Actual (KM / locations)
                <input type="number" inputMode="decimal" min="0" max="100" step="any" value={cur.form.actualLoc} onChange={cur.set.actualLoc} style={css(cur.fs.actualLoc)} />
              </label>
            </div>
            <div role="group" aria-label="Unit for target and actual" style={css('display:grid;grid-template-columns:auto 1fr 1fr;align-items:center;gap:8px;')}>
              <span style={css('font-size:13px;font-weight:700;color:#33404F;')}>Unit</span>
              <button type="button" aria-pressed={cur.isKM} onClick={cur.setKM} style={css(cur.kmStyle)}>KM</button>
              <button type="button" aria-pressed={cur.isLoc} onClick={cur.setLoc} style={css(cur.locStyle)}>Locations</button>
            </div>
          </div>

          <div style={css(CARD)}>
            <Step n="3" title="Manpower & equipment" />
            <div style={css('display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;')}>
              <label style={css(LABEL)}>Target manpower
                <input type="number" inputMode="numeric" min="1" max="60" step="1" value={cur.form.targetMH} onChange={cur.set.targetMH} style={css(cur.fs.targetMH)} />
              </label>
              <label style={css(LABEL)}>Actual manpower
                <input type="number" inputMode="numeric" min="1" max="60" step="1" value={cur.form.actualMH} onChange={cur.set.actualMH} style={css(cur.fs.actualMH)} />
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
            <Step n="4" title="Remarks" extra={<span style={css('font-size:13px;color:#5B6472;')}>{cur.remarksHint}</span>} />
            <textarea rows="2" aria-label="Remarks" placeholder="Issues, delays, materials needed…" value={cur.form.remarks} onChange={cur.set.remarks} style={css(cur.fs.remarks)} />
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
                    <>
                      <label aria-label={ph.takeAria} style={css(ph.dropStyle)}>
                        <input type="file" accept="image/*" capture="environment" onChange={ph.onFile} style={css('display:none;')} />
                        <span style={css('width:44px;height:44px;border-radius:50%;background:#0F2540;color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;line-height:1;')}>+</span>
                        <span style={css('font-size:15px;font-weight:800;color:#0F2540;')}>Take photo</span>
                        <span style={css('font-size:12px;color:#5B6472;text-align:center;')}>{ph.hint}</span>
                      </label>
                      <label aria-label={ph.galleryAria} style={css('min-height:44px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#2B4A73;text-decoration:underline;cursor:pointer;')}>
                        <input type="file" accept="image/*" onChange={ph.onFile} style={css('display:none;')} />
                        or choose from gallery
                      </label>
                    </>
                  )}
                  {ph.filled && (
                    <>
                      <div style={css('position:relative;height:150px;border-radius:10px;overflow:hidden;border:1px solid #C9D1DB;background:repeating-linear-gradient(45deg,#CDD5DF 0 8px,#DAE0E8 8px 16px);')}>
                        {ph.hasUrl && <div style={css(ph.previewStyle)} />}
                        {ph.noUrl && <div style={css("position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:11px;color:#3C4858;")}>site photo</div>}
                        <span style={css('position:absolute;left:8px;top:8px;background:#17693F;color:#FFFFFF;font-size:12px;font-weight:700;padding:3px 8px;border-radius:6px;')}>✓ {ph.time}</span>
                      </div>
                      <span style={css("font-family:'JetBrains Mono',monospace;font-size:11px;color:#5B6472;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;")}>{ph.name}</span>
                      {ph.hasError && <span role="alert" style={css('font-size:12px;font-weight:700;color:#A8261B;')}>{ph.errorText}</span>}
                      <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:6px;')}>
                        <label aria-label={ph.replaceAria} style={css(ph.replaceStyle)}>
                          <input type="file" accept="image/*" capture="environment" onChange={ph.onFile} style={css('display:none;')} />
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
        <SyncBox box={cur.actSyncBox} />
        {cur.actOpen && (
          <>
            <div role="status" aria-live="polite" style={css(cur.saveLineStyle)}>{cur.saveLine}</div>
            {cur.syncLine && <div role="status" style={css('font-size:13px;font-weight:700;color:#8A4B00;')}>{cur.syncLine}</div>}
            <div style={css('display:flex;gap:10px;')}>
              <button onClick={cur.saveDraft} style={css("flex:1;min-height:56px;background:#FFFFFF;border:1.5px solid #0F2540;color:#0F2540;border-radius:10px;font-family:'Archivo',sans-serif;font-weight:700;font-size:16px;cursor:pointer;")}>Save draft</button>
              <button onClick={cur.submitAct} disabled={cur.actBusy} aria-busy={cur.actBusy} style={css("flex:2;min-height:56px;background:#E8760F;border:none;color:#FFFFFF;border-radius:10px;font-family:'Archivo',sans-serif;font-weight:800;font-size:17px;cursor:pointer;" + (cur.actBusy ? 'opacity:0.6;cursor:progress;' : ''))}>{cur.submitLabel}</button>
            </div>
          </>
        )}
        {cur.actDone && (
          <div style={css('display:flex;gap:10px;')}>
            <div style={css('flex:2;display:flex;align-items:center;font-weight:800;font-size:15px;color:#17693F;')}>{cur.submittedLabel}</div>
            <button onClick={cur.editAct} disabled={cur.actBusy} style={css("flex:1;min-height:56px;background:#FFFFFF;border:1.5px solid #0F2540;color:#0F2540;border-radius:10px;font-family:'Archivo',sans-serif;font-weight:700;font-size:16px;cursor:pointer;")}>{cur.editLabel}</button>
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
        {cur.showAttErr && <div id="att-errors" role="alert" style={css('background:#FBE0DD;border:1px solid #EDB3AC;color:#7E1C13;border-radius:12px;padding:12px 14px;font-weight:700;font-size:15px;')}>Mark every crew member (Present or a reason), and write a note for "Other".</div>}
        {cur.attLocked && <div style={css('background:#E3E9F2;border:1px solid #C5D2E2;color:#2B4A73;border-radius:12px;padding:12px 14px;font-weight:700;font-size:14px;')}>{cur.attLockedNote}</div>}
        <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;background:#FFFFFF;border:1px solid #DDE2E8;border-radius:12px;padding:12px 14px;flex-wrap:wrap;')}>
          <div style={css('display:flex;gap:18px;')}>
            <div style={css('display:flex;flex-direction:column;')}><span style={css("font-family:'Archivo',sans-serif;font-weight:800;font-size:28px;color:#17693F;line-height:1;")}>{cur.presentCount}</span><span style={css('font-size:13px;font-weight:700;color:#33404F;')}>Present</span></div>
            <div style={css('display:flex;flex-direction:column;')}><span style={css("font-family:'Archivo',sans-serif;font-weight:800;font-size:28px;color:#A8261B;line-height:1;")}>{cur.notPresentCount}</span><span style={css('font-size:13px;font-weight:700;color:#33404F;')}>Not present</span></div>
            <div style={css('display:flex;flex-direction:column;')}><span style={css("font-family:'Archivo',sans-serif;font-weight:800;font-size:28px;color:#8A4B00;line-height:1;")}>{cur.unverifiedCount}</span><span style={css('font-size:13px;font-weight:700;color:#33404F;')}>Not verified</span></div>
          </div>
          {cur.hasUnverified && <button onClick={cur.markAll} style={css('min-height:48px;background:#0F2540;color:#FFFFFF;border:none;border-radius:10px;padding:0 16px;font-weight:700;font-size:15px;cursor:pointer;')}>Mark rest present</button>}
        </div>
        <div style={css('display:flex;flex-direction:column;gap:8px;')}>
          {cur.people.map(m => (
            <div key={m.name} style={css(m.rowStyle)}>
              <div style={css('display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;')}>
                <div style={css('display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 140px;')}>
                  <span style={css('font-size:16px;font-weight:700;')}>{m.name}</span>
                  <span style={css('display:flex;gap:6px;flex-wrap:wrap;')}>
                    <span style={css(m.roleTagStyle)}>{m.role}</span>
                    {m.unverified && <span style={css('font-size:11px;font-weight:700;padding:3px 8px;border-radius:5px;background:#FDEBD3;color:#8A4B00;')}>Not verified</span>}
                  </span>
                </div>
                <div role="group" aria-label={m.groupAria} style={css('display:flex;border:1.5px solid #C9D1DB;border-radius:10px;overflow:hidden;flex:none;margin-left:auto;')}>
                  <button aria-pressed={m.present} aria-label={m.pAria} onClick={m.setPresent} style={css(m.pStyle)}>Present</button>
                  <button aria-pressed={m.absent} aria-label={m.aAria} onClick={m.setAbsent} style={css(m.aStyle)}>Not present</button>
                </div>
              </div>
              {m.absent && (
                <div style={css('display:flex;flex-direction:column;gap:6px;')}>
                  <span style={css(m.reasonLabelStyle)}>Reason</span>
                  <div role="group" aria-label={`Reason for ${m.name}`} style={css('display:flex;flex-wrap:wrap;gap:6px;')}>
                    {m.reasons.map(r => <button key={r.label} aria-pressed={r.on} onClick={r.pick} style={css(r.style)}>{r.label}</button>)}
                  </div>
                  {m.isOther && <input type="text" aria-label={`Note for ${m.name}`} placeholder="Write the reason (required for Other)" value={m.note} onChange={m.onNote} style={css(m.noteStyle)} />}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div style={css('position:sticky;bottom:0;z-index:30;background:#FFFFFF;border-top:1px solid #DDE2E8;padding:12px 14px;box-shadow:0 -6px 18px rgba(15,37,64,0.08);display:flex;flex-direction:column;gap:8px;')}>
        <SyncBox box={cur.attSyncBox} />
        <button onClick={cur.submitAtt} disabled={cur.attDisabled} aria-disabled={cur.attDisabled} style={css("width:100%;min-height:56px;border:none;border-radius:10px;font-family:'Archivo',sans-serif;font-weight:800;font-size:17px;" + (cur.attDisabled ? 'background:#C9D1DB;color:#33404F;cursor:not-allowed;' : 'background:#E8760F;color:#FFFFFF;cursor:pointer;'))}>{cur.attBtn}</button>
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
      {v.offline && (
        <div role="status" style={css('position:sticky;top:0;z-index:70;min-height:40px;display:flex;align-items:center;justify-content:center;gap:8px;padding:6px 14px;background:#6B3A00;color:#FFFFFF;font-size:14px;font-weight:700;text-align:center;')}>
          No signal — keep working, everything is saved on this phone. Submitting needs signal.
        </div>
      )}
      {v.foreignWarn && (
        <div role="alert" style={css('padding:10px 14px;background:#A8261B;color:#FFFFFF;font-size:14px;font-weight:700;text-align:center;overflow-wrap:anywhere;')}>{v.foreignWarn}</div>
      )}
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
