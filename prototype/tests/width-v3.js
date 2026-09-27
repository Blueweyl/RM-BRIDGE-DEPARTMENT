(async () => {
  const R = []; window.__W = R;
  const tick = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
  const nav = t => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === t); b && b.click(); };
  const tabBtn = t => { const b = [...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim().startsWith(t)); b && b.click(); };
  window.dispatchEvent(new Event('pagehide'));
  const inScroller = el => { let p = el.parentElement; while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; p = p.parentElement; } return false; };
  const screens = [['Login', null], ['Admin', null], ['RM Team 1', 'Activity'], ['RM Team 1', 'Attendance'], ['RM Team 1', 'History'], ['Epoxy 1', 'Activity']];
  for (const w of [320, 360, 390, 430]) {
    document.body.style.width = w + 'px'; document.body.style.overflowX = 'visible';
    const row = [];
    for (const [s, tab] of screens) {
      nav(s); await settle(); if (tab) { tabBtn(tab); await settle(); }
      if (s === 'Epoxy 1') { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Submit report'); b && b.click(); await settle(); }
      const over = [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > w + 1 && !inScroller(el) && getComputedStyle(el).position !== 'fixed'; });
      const small = [...document.querySelectorAll('button:not([disabled]), label[aria-label], input, select, textarea')].filter(el => { if (el.closest('nav')) return false; const r = el.getBoundingClientRect(); if (!r.width || getComputedStyle(el).visibility === 'hidden' || el.type === 'file') return false; return r.height < 43.5; });
      const tag = s + (tab ? '/' + tab : '');
      row.push(tag + ': ' + (over.length ? 'OVERFLOW ' + over.length + ' (' + over.slice(0, 2).map(e => e.tagName + ':' + (e.textContent || '').trim().slice(0, 18)).join(' | ') + ')' : 'no overflow') + ', small targets ' + small.length + (small.length ? ' (' + small.slice(0, 3).map(e => (e.textContent || e.placeholder || e.type).trim().slice(0, 14) + ' ' + Math.round(e.getBoundingClientRect().height)).join(' | ') + ')' : ''));
    }
    R.push(w + 'px'); row.forEach(x => R.push('   ' + x));
  }
  document.body.style.width = ''; document.body.style.overflowX = '';
  R.push('DONE');
})();
