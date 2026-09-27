// The design passes styles around as CSS text ("background:#fff;color:#000;").
// React needs style objects, so parse once and cache. Splits on ';' outside
// quotes/parentheses so data: URLs inside url(...) survive.
const cache = new Map();

export function css(text) {
  if (!text) return undefined;
  const hit = cache.get(text);
  if (hit) return hit;
  const parts = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  const out = {};
  for (const p of parts) {
    const i = p.indexOf(':');
    if (i < 0) continue;
    const prop = p.slice(0, i).trim();
    if (!prop) continue;
    const key = prop.startsWith('--') ? prop : prop.replace(/^-webkit-/, 'Webkit-').replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    out[key] = p.slice(i + 1).trim();
  }
  if (cache.size > 2000) cache.clear();
  cache.set(text, out);
  return out;
}
