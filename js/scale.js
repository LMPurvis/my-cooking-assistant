// Pure scaling / unit helpers. Used by the app and by scripts/verify_scaling.mjs (Node).
export const LB = 453.59237;
export const OZ = 28.349523125;
export const ML = { tsp: 4.92892159375, tbsp: 14.78676478125, cup: 236.5882365, floz: 29.5735295625, ml: 1, l: 1000 };
export const G = { g: 1, kg: 1000, oz: OZ, lb: LB };

export function toGrams(value, unit) {
  return (Number(value) || 0) * (G[unit] ?? 1);
}

/** factor for a basis {type, base, cureRate?} given user value + unit */
export function factorFor(basis, value, unit) {
  if (!basis) return 1;
  const v = Number(value);
  if (!isFinite(v) || v <= 0) return 1;
  if (basis.type === 'weight') return toGrams(v, unit || 'g') / basis.base;
  return v / basis.base;
}

/** value to show in the basis input at factor 1 */
export function baseValue(basis, unit) {
  if (basis.type === 'weight') return basis.base / (G[unit] ?? 1);
  return basis.base;
}

export function round(n, d = 1) { const p = 10 ** d; return Math.round(n * p) / p; }

export function fmtNum(n, d = 1) {
  const r = round(n, d);
  return r.toLocaleString('en-US', { maximumFractionDigits: d });
}

export function fmtGrams(g) {
  if (g == null || !isFinite(g)) return '';
  if (g >= 100) return fmtNum(g, 0) + ' g';
  return fmtNum(g, 1) + ' g';
}

/** Format grams as a readable lb/oz line for meat and other weight-measured ingredients.
 *  Examples: 454 → "1 lb", 227 → "8 oz", 680 → "1 lb 8 oz", 100 → "3.5 oz" */
export function fmtLbOz(g) {
  if (g == null || !isFinite(g) || g <= 0) return '';
  const totalOz = g / OZ;
  if (totalOz < 0.05) return fmtGrams(g); // tiny amounts stay as grams
  // Prefer whole/half ounces under 1 lb
  if (totalOz < 16 - 1e-6) {
    const oz = totalOz >= 10 ? round(totalOz, 0) : (totalOz >= 1 ? round(totalOz, 1) : round(totalOz, 2));
    return fmtNum(oz, oz >= 10 ? 0 : (oz >= 1 ? 1 : 2)) + ' oz';
  }
  const lbs = totalOz / 16;
  // Exact or near-exact pounds
  const whole = Math.floor(lbs + 1e-9);
  const remOz = totalOz - whole * 16;
  if (remOz < 0.25) return fmtNum(whole, 0) + (whole === 1 ? ' lb' : ' lb');
  if (Math.abs(remOz - 16) < 0.25) return fmtNum(whole + 1, 0) + ' lb';
  // Half-pound friendly
  if (Math.abs(remOz - 8) < 0.35) return whole + ' lb 8 oz';
  // Otherwise "X lb Y oz" with Y rounded to whole oz, or decimal lb if cleaner
  const y = round(remOz, 0);
  if (y === 0) return whole + (whole === 1 ? ' lb' : ' lb');
  if (y === 16) return (whole + 1) + ' lb';
  return whole + ' lb ' + y + ' oz';
}

/** Kitchen volume units — these keep the volume line and do NOT get an lb/oz secondary. */
export function isKitchenVolume(vol) {
  if (!vol) return false;
  return /\b(cups?|tbsp|tsp|teaspoons?|tablespoons?|ml|mL|fl\.?\s*oz|cloves?|eggs?|whites?|onion|medium|large|small|pats?|pinch)\b/i.test(vol)
    || /\d\s*\/\s*\d\s*cup/i.test(vol);
}

/** True when we should show an lb/oz line under grams (meat, belly, canned oz, sausage batches, etc.). */
export function isMassIngredient(ing) {
  if (isKitchenVolume(ing.volume)) return false;
  const wt = ing.weightText || '';
  const vol = ing.volume || '';
  const src = ing.gramsSource || '';
  if (/\b(oz|lbs?|kg)\b/i.test(wt)) return true;
  if (/^(oz|lb|g|kg)/.test(src)) return true;
  if (ing.grams != null && !vol) return true;
  if (/\b(oz|lbs?|kg)\b/i.test(vol)) return true;
  return false;
}


const UNI = { '¼': .25, '½': .5, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875 };
const QTY = String.raw`(\d+\s+\d+\/\d+|\d+\/\d+|\d*[¼½¾⅓⅔⅛⅜⅝⅞]|\d+(?:\.\d+)?)`;

export function parseQty(s) {
  s = s.trim();
  for (const [k, v] of Object.entries(UNI)) if (s.includes(k)) { const w = s.replace(k, '').trim(); return (w ? +w : 0) + v; }
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/); if (m) return +m[1] + m[2] / m[3];
  m = s.match(/^(\d+)\/(\d+)$/); if (m) return m[1] / m[2];
  return parseFloat(s);
}

const FRAC_OUT = [[0, ''], [0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾'], [1, '']];
export function fmtFrac(n, allowEighth = true) {
  let whole = Math.floor(n), f = n - whole, best = FRAC_OUT[0], bd = 9;
  for (const c of FRAC_OUT) { if (!allowEighth && c[0] === 0.125) continue; const dd = Math.abs(f - c[0]); if (dd < bd) { bd = dd; best = c; } }
  if (best[0] === 1) { whole += 1; best = FRAC_OUT[0]; }
  if (Math.abs(f - best[0]) > 0.07 && n < 10) return fmtNum(n, 2);
  return (whole ? String(whole) : (best[1] ? '' : '0')) + best[1];
}

const UNIT_RE = /^(tsp|teaspoons?|tbsp|tbls?|tablespoons?|Tbsp|cups?|c\.)\b/i;
function unitKey(u) {
  u = u.toLowerCase();
  if (u.startsWith('t') && (u.startsWith('tsp') || u.startsWith('teas'))) return 'tsp';
  if (u.startsWith('tb') || u.startsWith('tab')) return 'tbsp';
  return 'cup';
}

/** readable US volume from teaspoons, like the sheet's "readable volume" columns */
export function fmtTsp(t) {
  if (t < 0.1) return 'pinch';
  const parts = [];
  if (t >= 12) {
    const q = Math.floor(t / 12 + 1e-9); t -= q * 12;
    parts.push(fmtFrac(q / 4) + (q / 4 > 1 ? ' cups' : ' cup'));
  }
  if (t >= 3 - 1e-9) { const tb = Math.floor(t / 3 + 1e-9); t -= tb * 3; parts.push(tb + ' tbsp'); }
  const ts = Math.round(t * 4) / 4;
  if (ts > 0) parts.push(fmtFrac(ts, false) + ' tsp');
  return parts.join(' + ') || 'pinch';
}

/**
 * Scale a free-text amount ("1 1/2 tsp", "2 tbsp + 2¼ tsp", "2-3 whites", "1 can").
 * Returns {text, scaled:boolean}. Volumes in tsp/tbsp/cup are re-expressed readably.
 */
export function scaleText(text, factor) {
  if (!text) return { text: '', scaled: false };
  if (Math.abs(factor - 1) < 1e-9) return { text, scaled: false };
  const t = text.trim().replace(/^~\s*/, '');
  // pure volume expression: qty unit (+ qty unit)*
  const volRe = new RegExp(String.raw`^` + QTY + String.raw`\s*(tsp|teaspoons?|tbsp|tbls?|tablespoons?|cups?)\b`, 'i');
  let rest = t, tsp = 0, matched = false;
  for (;;) {
    const m = rest.match(volRe);
    if (!m) break;
    matched = true;
    const q = parseQty(m[1]); const u = unitKey(m[2]);
    tsp += q * (u === 'tsp' ? 1 : u === 'tbsp' ? 3 : 48);
    rest = rest.slice(m[0].length).trim();
    const plus = rest.match(/^(\+|and)\s*/); if (plus) rest = rest.slice(plus[0].length); else break;
  }
  if (matched && tsp > 0) {
    // drop parenthetical grams/mL that no longer apply
    const tail = rest.replace(/\([^)]*\d+(\.\d+)?\s*(g|ml|mL)\b[^)]*\)/g, '').replace(/^\/\s*[\d.]+\s*g\b(\s*\(est\.\))?/, '').trim();
    return { text: fmtTsp(tsp * factor) + (tail ? ' ' + tail : ''), scaled: true };
  }
  // generic leading quantity or range ("2-3 whites", "1 can", "6 medium")
  const gen = t.match(new RegExp('^' + QTY + String.raw`(?:\s*[-–]\s*` + QTY + ')?'));
  if (gen) {
    const a = parseQty(gen[1]) * factor, b = gen[2] ? parseQty(gen[2]) * factor : null;
    const f = (x) => (x >= 10 ? fmtNum(x, 0) : fmtFrac(x));
    return { text: f(a) + (b != null ? '–' + f(b) : '') + t.slice(gen[0].length).replace(/\([^)]*\d+(\.\d+)?\s*(g|ml|mL)\b[^)]*\)/g, ''), scaled: true };
  }
  return { text, scaled: false };
}

/** scale one ingredient; returns display data */
export function scaleIngredient(ing, factor) {
  const out = { grams: null, gramsMax: null, gramsText: '', massText: '', volumeText: '', weightText: '' };
  if (ing.grams != null) {
    out.grams = ing.grams * factor;
    out.gramsMax = ing.gramsMax != null ? ing.gramsMax * factor : null;
    out.gramsText = out.gramsMax != null ? `${fmtNum(out.grams, out.grams < 100 ? 1 : 0)}–${fmtGrams(out.gramsMax)}` : fmtGrams(out.grams);
    if (isMassIngredient(ing)) {
      out.massText = out.gramsMax != null
        ? `${fmtLbOz(out.grams)}–${fmtLbOz(out.gramsMax)}`
        : fmtLbOz(out.grams);
    }
  } else if (ing.weightText) {
    out.weightText = scaleText(ing.weightText, factor).text;
  }
  if (ing.volume) {
    const isPctLike = /%$/.test(ing.volume.trim());
    out.volumeText = isPctLike ? ing.volume : scaleText(ing.volume, factor).text;
  }
  return out;
}

// ---- converters
export const fToC = (f) => (f - 32) * 5 / 9;
export const cToF = (c) => c * 9 / 5 + 32;

export const UNITS = {
  g: { dim: 'mass', k: 1, label: 'g' }, kg: { dim: 'mass', k: 1000, label: 'kg' },
  oz: { dim: 'mass', k: OZ, label: 'oz' }, lb: { dim: 'mass', k: LB, label: 'lb' },
  ml: { dim: 'vol', k: 1, label: 'mL' }, l: { dim: 'vol', k: 1000, label: 'L' },
  tsp: { dim: 'vol', k: ML.tsp, label: 'tsp' }, tbsp: { dim: 'vol', k: ML.tbsp, label: 'tbsp' },
  floz: { dim: 'vol', k: ML.floz, label: 'fl oz' }, cup: { dim: 'vol', k: ML.cup, label: 'cup' },
};
export function convertAll(amount, from) {
  const u = UNITS[from]; if (!u) return [];
  const base = amount * u.k;
  return Object.entries(UNITS).filter(([k, v]) => v.dim === u.dim && k !== from)
    .map(([k, v]) => ({ unit: k, label: v.label, value: base / v.k }));
}

export const cureGrams = (meatGrams, pct) => meatGrams * pct / 100;
