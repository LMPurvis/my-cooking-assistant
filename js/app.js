import { LB, G, factorFor, baseValue, scaleIngredient, fmtNum, fmtGrams, fmtLbOz, isMassIngredient, isKitchenVolume, fToC, cToF, convertAll, UNITS, cureGrams, toGrams, round } from './scale.js';
import { fetchVault, unlockWithStoredKey, unlockWithPassphrase, forgetKey, hasCrypto } from './vault.js';
import { canRecognize, recognitionBlocked, micErrorText, canSpeak, isIOS, speak, stopSpeaking, createCommandListener, createDictation, canWakeLock, requestWakeLock, releaseWakeLock, wakeLockWanted } from './speech.js';

let PRIVATE = { email: '', equipment: [] }; // filled from the encrypted vault
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// tiny safe markdown: **bold**, *italic*, [text](url)
const md = (s) => esc(s)
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
const flagify = (s) => esc(s).replace(/\(est\.?\)|\best\.(?=[,)\s]|$)/g, '<span class="badge est">est.</span>').replace(/\bTBD\b/g, '<span class="badge tbd">TBD</span>');

const store = {
  get(k, d) { try { const v = localStorage.getItem('mca.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mca.' + k, JSON.stringify(v)); } catch {} },
};

let DATA = null, REF = null;
const state = { q: store.get('q', ''), cat: 'All', fav: false, tag: '' };
const view = $('#view');

function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }

// ---------------------------------------------------------------- theme
function cycleTheme() {
  const order = ['auto', 'dark', 'light'];
  const cur = document.documentElement.dataset.theme || 'auto';
  const next = order[(order.indexOf(cur) + 1) % 3];
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('mca.theme', next); } catch {}
  toast(next === 'auto' ? 'Theme: match device' : next === 'dark' ? 'Theme: dark' : 'Theme: light');
}
$('#themeBtn').addEventListener('click', cycleTheme);
$('#backBtn').addEventListener('click', () => { if (history.length > 1) history.back(); else location.hash = '#/'; });

// ---------------------------------------------------------------- data
function applyPayload(p) { DATA = p.recipes; REF = p.reference; PRIVATE = p.private || PRIVATE; }

// ---------------------------------------------------------------- lock screen
function showLock(vault) {
  return new Promise((resolve) => {
    document.body.classList.add('locked');
    const lock = $('#lock'); lock.hidden = false;
    const form = $('#lockForm'), pass = $('#lockPass'), err = $('#lockErr'), btn = $('#lockBtn');
    err.textContent = hasCrypto ? '' : 'This browser can’t decrypt (WebCrypto needs HTTPS).';
    setTimeout(() => pass.focus(), 50);
    const tog = $('#lockToggle');
    if (tog) tog.onclick = () => {
      const show = pass.type === 'password';
      pass.type = show ? 'text' : 'password';
      tog.textContent = show ? 'Hide' : 'Show';
      tog.setAttribute('aria-pressed', show ? 'true' : 'false');
      tog.setAttribute('aria-label', show ? 'Hide passphrase' : 'Show passphrase');
      pass.focus();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const phrase = pass.value.trim();
      if (!phrase) { err.textContent = 'Please enter the passphrase.'; return; }
      btn.disabled = true; btn.textContent = 'Unlocking…'; err.textContent = '';
      try {
        const payload = await unlockWithPassphrase(vault, phrase, $('#lockRemember').checked);
        pass.value = ''; lock.hidden = true; document.body.classList.remove('locked');
        resolve(payload);
      } catch (ex) {
        err.textContent = ex.message === 'bad-passphrase'
          ? 'That passphrase didn’t work. It’s case-sensitive — check for auto-capitalized letters and try again.'
          : 'Couldn’t unlock: ' + ex.message;
        pass.select();
      } finally { btn.disabled = false; btn.textContent = 'Unlock'; }
    };
  });
}
function lockNow() {
  forgetKey(); stopSpeaking(); closeCook(true); closeSheet();
  DATA = REF = null; PRIVATE = { email: '', equipment: [] };
  location.hash = '#/'; location.reload();
}
function openSettings() {
  const s = openSheet(`<h3>Settings <button class="icon-btn" id="stClose" aria-label="Close">×</button></h3>
    <div class="settings-list">
      <button class="btn" id="stTheme">◐ Theme: ${esc(document.documentElement.dataset.theme || 'auto')}</button>
      <button class="btn" id="stLock">🔒 Lock</button>
      <p class="note-sm">Lock forgets the key saved on this device. You’ll need the passphrase to open the recipes again.</p>
      <p class="note-sm">Recipes: ${DATA ? DATA.recipes.length : 0} · data built ${esc(DATA?.meta?.generated || '')}</p>
    </div>`);
  $('#stClose', s).onclick = closeSheet;
  $('#stTheme', s).onclick = () => { cycleTheme(); $('#stTheme', s).textContent = '◐ Theme: ' + document.documentElement.dataset.theme; };
  $('#stLock', s).onclick = lockNow;
}
$('#settingsBtn').addEventListener('click', openSettings);

async function load() {
  const vault = await fetchVault();
  const payload = (await unlockWithStoredKey(vault)) || (await showLock(vault));
  applyPayload(payload);
}

// ---------------------------------------------------------------- router
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(qs || '') };
}
function setTab(t) { $$('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === t)); }
function setTitle(t, back) { $('#pageTitle').innerHTML = back ? esc(t) : '<a href="#/">My Cooking Assistant</a>'; $('#backBtn').hidden = !back; document.title = back ? `${t} · My Cooking Assistant` : 'My Cooking Assistant'; }

function route() {
  const { parts, params } = parseHash();
  if (parts[0] !== 'r' || parts[2] !== 'cook') closeCook(true);
  closeSheet();
  if (parts[0] === 'r' && parts[1]) {
    const r = DATA.recipes.find((x) => x.id === parts[1]);
    if (!r) { view.innerHTML = '<p class="empty">Recipe not found.</p>'; return; }
    renderRecipe(r, params);
    if (parts[2] === 'cook') openCook(r, +(params.get('step') || 1) - 1);
    return;
  }
  if (parts[0] === 'tools') { renderTools(); return; }
  state.fav = parts[0] === 'favorites';
  renderHome();
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- favorites (sheet seed + per-device overrides)
const favOverrides = store.get('favs', {});
function isFav(r) { return Object.prototype.hasOwnProperty.call(favOverrides, r.id) ? !!favOverrides[r.id] : !!r.favorite; }
function setFav(r, v) { if (v === !!r.favorite) delete favOverrides[r.id]; else favOverrides[r.id] = v; store.set('favs', favOverrides); }
function favBtnHTML(r, big) {
  const on = isFav(r);
  return `<button class="fav-btn${big ? ' big' : ''}" data-fav="${r.id}" aria-pressed="${on}" aria-label="${on ? 'Remove from' : 'Add to'} favorites" title="${on ? 'Favorite (tap to remove)' : 'Add to favorites'}">${on ? '★' : '☆'}</button>`;
}
function wireFavBtn(b) {
  b.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const r = DATA.recipes.find((x) => x.id === b.dataset.fav); if (!r) return;
    setFav(r, !isFav(r));
    const on = isFav(r);
    b.textContent = on ? '★' : '☆'; b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} favorites`);
    toast(on ? '★ Added to Favorites' : 'Removed from Favorites', 1500);
    if (state.fav && $('#cards')) renderCards();
  });
}

// ---------------------------------------------------------------- home
function renderHome() {
  setTab(state.fav ? 'favorites' : 'home'); setTitle('', false);
  const cats = ['All', ...DATA.meta.categories];
  view.innerHTML = `
    <div class="search"><input id="q" type="search" inputmode="search" autocomplete="off" placeholder="Search recipes, ingredients, tags…" aria-label="Search recipes" value="${esc(state.q)}">
      <button class="clear" id="qClear" aria-label="Clear search" ${state.q ? '' : 'hidden'}>×</button></div>
    <div class="chips" role="group" aria-label="Categories">
      <button class="chip fav" id="favChip" aria-pressed="${state.fav}">★ Favorites</button>
      ${cats.map((c) => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${state.cat === c}">${esc(c)}</button>`).join('')}
    </div>
    <div class="filters">
      <select id="tagSel" aria-label="Filter by tag"><option value="">All tags</option>${DATA.meta.tags.map((t) => `<option ${state.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    </div>
    <div class="count" id="count"></div>
    <div class="cards" id="cards"></div>`;
  const q = $('#q');
  q.addEventListener('input', () => { state.q = q.value; store.set('q', state.q); $('#qClear').hidden = !state.q; renderCards(); });
  $('#qClear').addEventListener('click', () => { state.q = ''; q.value = ''; store.set('q', ''); $('#qClear').hidden = true; renderCards(); q.focus(); });
  $('#favChip').addEventListener('click', () => { location.hash = state.fav ? '#/' : '#/favorites'; });
  $$('.chip[data-cat]').forEach((b) => b.addEventListener('click', () => { state.cat = b.dataset.cat; $$('.chip[data-cat]').forEach((x) => x.setAttribute('aria-pressed', x === b)); renderCards(); }));
  $('#tagSel').addEventListener('change', (e) => { state.tag = e.target.value; renderCards(); });
  renderCards();
}

function haystack(r) {
  return [r.name, r.category, r.origin, r.source, r.yield, ...r.tags, ...r.ingredients.map((i) => i.name)].join(' ').toLowerCase();
}
function renderCards() {
  const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = DATA.recipes.filter((r) =>
    (state.cat === 'All' || r.category === state.cat) && (!state.fav || isFav(r)) &&
    (!state.tag || r.tags.some((t) => t.toLowerCase() === state.tag)) &&
    terms.every((t) => haystack(r).includes(t)));
  list.sort((a, b) => (isFav(b) - isFav(a)) || a.name.localeCompare(b.name));
  $('#count').textContent = `${list.length} recipe${list.length === 1 ? '' : 's'}`;
  $('#cards').innerHTML = list.length ? list.map((r) => `
    <div class="card-wrap"><a class="card" href="#/r/${r.id}">
      <div class="cat">${esc(r.category)}</div>
      <h2>${esc(r.name)}</h2>
      <div class="yield">${flagify(r.yield)}</div>
      <div class="tags">${r.tags.slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
        ${r.steps.length && r.steps.every((s) => /TBD|not recorded/i.test(s.text)) ? '<span class="badge tbd">steps TBD</span>' : ''}</div>
    </a>${favBtnHTML(r)}</div>`).join('') : `<div class="empty">No recipes match.${state.fav ? ' Tap ☆ on any recipe to add it to Favorites.' : ''}</div>`;
  $$('#cards .fav-btn').forEach(wireFavBtn);
}

// ---------------------------------------------------------------- recipe
function scaleKey(r) { return 'scale.' + r.id; }
function getScale(r, params) {
  const b = r.scaling;
  const saved = store.get(scaleKey(r), null);
  let unit = b.type === 'weight' ? (saved?.unit || b.unit || 'g') : null;
  let value = saved?.value ?? (b.start != null ? (b.type === 'weight' ? b.start / G[unit] : b.start) : baseValue(b, unit));
  const secs = { ...(saved?.secs || {}) };
  if (params?.get('unit')) unit = params.get('unit');
  if (params?.get('scale')) value = +params.get('scale');
  for (const [k, v] of params || []) if (k.startsWith('sec.')) secs[k.slice(4)] = +v;
  return { unit, value, secs };
}
function factors(r, sc) {
  const main = factorFor(r.scaling, sc.value, sc.unit);
  const sec = {};
  for (const [name, sb] of Object.entries(r.scaling.sections || {})) sec[name] = factorFor(sb, sc.secs[name] ?? sb.base, sb.unit);
  return { main, sec, for: (ing) => (ing.section in sec ? sec[ing.section] : main) };
}

function ingRowHTML(ing, f, sc, r, big = false) {
  const s = scaleIngredient(ing, f);
  let g = s.gramsText || (s.weightText ? esc(s.weightText) : '');
  if (ing.isBasis && r.scaling.type === 'weight') {
    const bg = toGrams(sc.value, sc.unit);
    g = fmtGrams(bg) + ' <small>(your weight)</small>';
    s.massText = fmtLbOz(bg);
  }
  const flags = `${ing.est ? ' <span class="badge est">est.</span>' : ''}${ing.tbd ? ' <span class="badge tbd">TBD</span>' : ''}${ing.toTaste ? ' <span class="tag">to taste</span>' : ''}`;
  const sub = [];
  // Secondary line: kitchen volume (tbsp/cup/…) OR lb/oz for meat & other weight items (never cups for those).
  const scaledFlag = (orig, cur) => Math.abs(f - 1) > 1e-6 && cur !== orig ? ' <span class="scaled-flag">scaled</span>' : '';
  if (s.volumeText && isKitchenVolume(ing.volume)) {
    sub.push(`<span>${flagify(s.volumeText)}${scaledFlag(ing.volume, s.volumeText)}</span>`);
  } else {
    if (s.massText) sub.push(`<span>${esc(s.massText)}${Math.abs(f - 1) > 1e-6 ? ' <span class="scaled-flag">scaled</span>' : ''}</span>`);
    if (s.volumeText) sub.push(`<span>${flagify(s.volumeText)}${scaledFlag(ing.volume, s.volumeText)}</span>`);
  }
  if (ing.pct) { const lb = ing.pct.label.replace(/\s*\(.*\)/, ''); sub.push(`<span>${lb.startsWith('%') ? flagify(ing.pct.value) + ' ' + esc(lb.slice(1).trim()) : esc(lb.replace(/\s*%$/, '')) + ' ' + flagify(ing.pct.value)}</span>`); }
  if (ing.notes) sub.push(`<span>${flagify(ing.notes)}</span>`);
  return `<li class="${ing.isTotal ? 'total' : ''} ${ing.isBasis ? 'basis' : ''}">
    <span class="nm">${esc(ing.name)}${flags}</span><span class="g">${g || '—'}</span>
    ${sub.length ? `<span class="v">${sub.join(' <span class="sep">·</span> ')}</span>` : ''}</li>`;
}
function ingredientsHTML(r, sc, big = false) {
  const F = factors(r, sc);
  const groups = [];
  for (const ing of r.ingredients) {
    let g = groups.find((x) => x.name === ing.section);
    if (!g) groups.push(g = { name: ing.section, items: [] });
    g.items.push(ing);
  }
  return groups.map((g) => `${g.name ? `<h4>${esc(g.name)}</h4>` : ''}<ul class="ing ${big ? 'big-ing' : ''}">${g.items.map((i) => ingRowHTML(i, F.for(i), sc, r, big)).join('')}</ul>`).join('');
}

function scalerHTML(r, sc) {
  const b = r.scaling;
  const units = ['lb', 'g', 'kg', 'oz'];
  const unitSeg = b.type === 'weight' ? `<div class="seg" role="group" aria-label="Unit">${units.map((u) => `<button data-unit="${u}" aria-pressed="${sc.unit === u}">${u}</button>`).join('')}</div>` : (b.unit && b.type !== 'multiplier' ? `<div class="pill" style="align-self:center">${esc(b.unit)}</div>` : '<div class="pill" style="align-self:center">×</div>');
  const secHTML = Object.entries(b.sections || {}).map(([name, sb]) => `
    <div class="scale-row" style="margin-top:14px"><label for="sec-${esc(name)}">${esc(sb.label)} <small>(${esc(name)})</small></label>
    <input id="sec-${esc(name)}" data-sec="${esc(name)}" type="number" inputmode="decimal" step="any" min="0" value="${round(sc.secs[name] ?? sb.base, 2)}"><div class="pill" style="align-self:center">${esc(sb.unit)}</div></div>
    ${sb.note ? `<div class="note-sm">${esc(sb.note)}</div>` : ''}`).join('');
  return `<section class="panel" aria-labelledby="scaleH">
    <h3 id="scaleH">Scale${b.type === 'weight' ? ' by weight' : b.type === 'count' ? '' : ' by batch'}</h3>
    <div class="scale-row"><label for="scaleIn">${esc(b.label)}</label>
      <input id="scaleIn" type="number" inputmode="decimal" step="any" min="0" value="${round(sc.value, 3)}">${unitSeg}</div>
    <div class="quick">${[0.5, 1, 1.5, 2, 3].map((m) => `<button data-mult="${m}">${m === 1 ? (b.start != null ? 'Default' : 'Original') : m + '×'}</button>`).join('')}</div>
    <div class="factor" id="factorOut"></div>
    ${b.note ? `<div class="note-sm">${esc(b.note)}</div>` : ''}
    ${secHTML}
  </section>`;
}

function renderRecipe(r, params) {
  setTab(''); setTitle(r.name, true);
  const sc = getScale(r, params);
  const link = (u, t) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`;
  const vids = r.videos || [];
  const credit = [['Source', r.source && r.sourceUrl ? link(r.sourceUrl, r.source) : r.source && md(r.source)], ...vids.map((v) => ['Video', link(v.url, '▶ ' + v.label)]),
    ['Adapted from', r.adaptedFrom && md(r.adaptedFrom)], ['Origin', r.origin && esc(r.origin)], ['Date added', r.dateAdded && esc(r.dateAdded)]].filter((x) => x[1]);
  const groupedSteps = (steps) => { let html = '', cur; for (const s of steps) { if (s.group !== cur) { if (cur !== undefined) html += '</ol>'; cur = s.group; html += `${s.group ? `<h4>${esc(s.group)}</h4>` : ''}<ol class="steps">`; } html += `<li>${flagify(s.text)}</li>`; } return html + (steps.length ? '</ol>' : ''); };
  const listMd = (arr) => arr.length ? `<div class="md"><ul>${arr.map((t) => `<li>${md(t)}</li>`).join('')}</ul></div>` : '<p class="note-sm">None recorded yet.</p>';
  view.innerHTML = `
    <article>
      <div class="r-head">
        <div class="cat">${esc(r.category)}</div>
        <div class="r-title"><h2>${esc(r.name)}</h2>${favBtnHTML(r, true)}</div>
        ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ''}
        <div class="meta-row"><span class="pill">Yield: ${flagify(r.yield)}</span>${r.origin ? `<span class="pill">${esc(r.origin)}</span>` : ''}</div>
        <div class="tags">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      </div>
      <div class="actions">
        <a class="btn primary" href="#/r/${r.id}/cook">▶ Start cook mode</a>
        <a class="btn" href="${esc(r.docUrl)}" target="_blank" rel="noopener">📄 Open doc</a>
        <button class="btn" id="voiceNoteBtn">🎤 Voice note</button>
        ${r.calculator ? `<a class="btn small" href="${esc(r.calculator.url)}" target="_blank" rel="noopener">🧮 Sheet calculator</a>` : ''}
        ${vids.map((v, i) => `<a class="btn small video-link" href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(v.label)}">▶ ${vids.length > 1 ? `Video ${i + 1}` : 'Watch video'}</a>`).join('')}
        ${r.photosUrl ? `<a class="btn small" href="${esc(r.photosUrl)}" target="_blank" rel="noopener">📷 Photos</a>` : ''}
      </div>
      ${scalerHTML(r, sc)}
      <section class="panel"><h3>Ingredients <small style="font-weight:500;color:var(--muted);font-size:15px">grams first · volume second</small></h3>
        <div id="ingList">${ingredientsHTML(r, sc)}</div>
        ${r.ingredientNotes.length ? `<div class="md note-sm" style="margin-top:10px">${r.ingredientNotes.map((t) => `<p>${md(t)}</p>`).join('')}</div>` : ''}
      </section>
      <section class="panel"><h3>Steps</h3>${r.stepNotes.map((t) => `<p class="note-sm">${md(t)}</p>`).join('')}${groupedSteps(r.steps)}</section>
      <section class="panel"><h3>Tips &amp; Variations</h3>${listMd(r.tips)}</section>
      <section class="panel"><h3>Notes</h3>${r.notes.length ? `<div class="md">${r.notes.map((t) => `<p>${md(t)}</p>`).join('')}</div>` : '<p class="note-sm">None.</p>'}
        ${r.indexNotes ? `<p class="note-sm"><b>Index note:</b> ${flagify(r.indexNotes)}</p>` : ''}</section>
      ${Object.entries(r.extraSections).map(([k, v]) => `<section class="panel"><h3>${esc(k)}</h3>${listMd(v)}</section>`).join('')}
      <section class="panel"><h3>My Notes</h3>${r.myNotes.length ? listMd(r.myNotes) : '<p class="note-sm">No dated notes yet. Use 🎤 Voice note to dictate one.</p>'}</section>
      <section class="panel"><h3>Source credit</h3><dl class="credit">${credit.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></section>
    </article>`;

  const update = () => {
    $('#ingList').innerHTML = ingredientsHTML(r, sc);
    const F = factors(r, sc);
    let txt = `Scale factor <b>${fmtNum(F.main, 3)}×</b>`;
    if (r.scaling.type === 'weight') txt += ` · ${fmtGrams(toGrams(sc.value, sc.unit))} (${fmtNum(toGrams(sc.value, sc.unit) / LB, 2)} lb)`;
    if (r.scaling.cureRate) txt += ` · total cure ${fmtGrams(toGrams(sc.value, sc.unit) * r.scaling.cureRate)}`;
    for (const [n, f] of Object.entries(F.sec)) txt += ` · ${esc(n)} <b>${fmtNum(f, 3)}×</b>`;
    $('#factorOut').innerHTML = txt;
    store.set(scaleKey(r), sc);
  };
  $('#scaleIn').addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (v > 0) { sc.value = v; update(); } });
  $$('[data-unit]').forEach((b) => b.addEventListener('click', () => {
    const g = toGrams(sc.value, sc.unit); sc.unit = b.dataset.unit; sc.value = round(g / G[sc.unit], sc.unit === 'g' ? 0 : 3);
    $('#scaleIn').value = sc.value; $$('[data-unit]').forEach((x) => x.setAttribute('aria-pressed', x === b)); update();
  }));
  $$('[data-mult]').forEach((b) => b.addEventListener('click', () => {
    const m = +b.dataset.mult;
    const ref = r.scaling.start != null ? (r.scaling.type === 'weight' ? r.scaling.start / G[sc.unit] : r.scaling.start) : baseValue(r.scaling, sc.unit);
    sc.value = round(ref * m, 3);
    for (const [n, sb] of Object.entries(r.scaling.sections || {})) sc.secs[n] = round(sb.base * m, 3);
    $('#scaleIn').value = sc.value; $$('[data-sec]').forEach((i) => { i.value = sc.secs[i.dataset.sec]; }); update();
  }));
  $$('[data-sec]').forEach((i) => i.addEventListener('input', () => { const v = parseFloat(i.value); if (v > 0) { sc.secs[i.dataset.sec] = v; update(); } }));
  $('#voiceNoteBtn').addEventListener('click', () => openVoiceNote(r));
  $$('.r-title .fav-btn').forEach(wireFavBtn);
  update();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- sheet helpers
function openSheet(html) { const s = $('#sheet'); s.innerHTML = `<div class="sheet-inner">${html}</div>`; s.hidden = false; s.onclick = (e) => { if (e.target === s) closeSheet(); }; return s; }
function closeSheet() { const s = $('#sheet'); try { dictation?.abort(); } catch (_) {} dictation = null; if (!s.hidden) { s.hidden = true; s.innerHTML = ''; } }

// ---------------------------------------------------------------- voice note
let dictation = null;
function openVoiceNote(r) {
  const key = 'note.' + r.id;
  const noMicMsg = recognitionBlocked
    ? 'In-app dictation doesn’t work in iPhone home-screen apps. Tap in the box above, then tap the 🎤 on your keyboard to dictate. Your note saves as you go.'
    : 'In-app dictation isn’t available in this browser. Tap in the box above, then use the keyboard’s 🎤 key to dictate.';
  const s = openSheet(`
    <h3>Voice note <button class="icon-btn" id="vnClose" aria-label="Close">×</button></h3>
    <p class="note-sm">${esc(r.name)} · ${new Date().toLocaleDateString()}</p>
    <textarea class="note" id="vnText" placeholder="${canRecognize ? 'Tap Dictate and speak, or type…' : 'Tap here, then tap 🎤 on your keyboard to dictate…'}">${esc(store.get(key, ''))}</textarea>
    <div id="vnStatus" class="note-sm" role="status" aria-live="polite">${canRecognize ? '' : noMicMsg}</div>
    <div class="row-btns">
      ${canRecognize ? '<button class="btn primary" id="vnMic" style="grid-column:1/-1">🎤 Dictate</button>' : ''}
      <button class="btn" id="vnCopy">📋 Copy</button>
      <a class="btn" id="vnMail" href="#">✉️ Email to me</a>
    </div>
    <p class="note-sm">Notes are kept on this device only. Saving to the recipe doc in Drive comes in a later version.</p>`);
  const ta = $('#vnText', s);
  const save = () => store.set(key, ta.value);
  ta.addEventListener('input', save);
  $('#vnClose', s).onclick = closeSheet;
  $('#vnCopy', s).onclick = async () => {
    try { await navigator.clipboard.writeText(ta.value); toast('Copied'); } catch { ta.select(); document.execCommand('copy'); toast('Copied'); }
  };
  const mail = $('#vnMail', s);
  const setMail = () => { mail.href = `mailto:${encodeURIComponent(PRIVATE.email || '')}?subject=${encodeURIComponent(`Cooking note: ${r.name} (${new Date().toLocaleDateString()})`)}&body=${encodeURIComponent(`${ta.value}\n\n— ${r.name}\n${r.docUrl}`)}`; };
  ta.addEventListener('input', setMail); setMail();
  if (canRecognize) {
    let baseText = ta.value;
    const m = $('#vnMic', s), st = $('#vnStatus', s);
    dictation = createDictation({
      onText: (t, final) => { if (final) { baseText = (baseText ? baseText.replace(/\s*$/, ' ') : '') + t; ta.value = baseText; save(); setMail(); } else ta.value = (baseText ? baseText + ' ' : '') + t; },
      onState: (state, err) => {
        if (!m.isConnected) return;
        if (state === 'starting') { m.textContent = '■ Cancel'; m.dataset.state = 'starting'; st.textContent = 'Starting microphone…'; }
        else if (state === 'on') { m.textContent = '■ Stop'; m.dataset.state = 'on'; st.innerHTML = '<span class="mic-live">● Listening…</span>'; }
        else if (state === 'error') { if (micErrorText(err) && !['no-speech', 'aborted'].includes(err)) st.textContent = micErrorText(err); }
        else { m.textContent = '🎤 Dictate'; m.dataset.state = 'off'; if (!err && st.textContent.startsWith('Starting')) st.textContent = ''; if (!err && st.querySelector('.mic-live')) st.textContent = ''; ta.value = baseText || ta.value; }
      },
    });
    ta.addEventListener('input', () => { if (!dictation?.active) baseText = ta.value; });
    m.onclick = () => { if (dictation.active) dictation.stop(); else { baseText = ta.value; st.textContent = ''; dictation.start(); } };
  }
}

const cook = { r: null, i: 0, listener: null, sc: null };
function openCook(r, start = 0) {
  cook.r = r; cook.sc = getScale(r); cook.i = Math.max(0, Math.min(start, r.steps.length - 1));
  const el = $('#cook');
  el.hidden = false; document.body.style.overflow = 'hidden';
  el.innerHTML = `
    <div>
      <div class="cook-top">
        <button class="icon-btn" id="ckClose" aria-label="Exit cook mode">×</button>
        <div class="ttl"><b>${esc(r.name)}</b><span id="ckPos"></span></div>
        <button class="icon-btn" id="ckIng" aria-label="Show ingredients" title="Ingredients">🧂</button>
        <button class="icon-btn" id="ckRead" aria-label="Read step aloud" title="Read step" ${canSpeak ? '' : 'disabled'}>🔊</button>
        <button class="icon-btn" id="ckMic" aria-label="Voice commands" title="${canRecognize ? 'Voice commands' : 'Voice commands not supported in this browser'}">🎙️</button>
      </div>
      <div class="progress"><i id="ckProg"></i></div>
    </div>
    <div class="cook-body" id="ckBody"><div class="cook-group" id="ckGroup"></div><div class="cook-step" id="ckStep" aria-live="polite"></div><div class="cook-status" id="ckStatus"></div></div>
    <div class="cook-nav"><button class="prev" id="ckPrev">‹ Back</button><button class="next" id="ckNext">Next ›</button></div>`;
  $('#ckClose').onclick = () => { location.hash = `#/r/${r.id}`; };
  $('#ckPrev').onclick = () => go(-1);
  $('#ckNext').onclick = () => go(1);
  $('#ckRead').onclick = () => readStep();
  $('#ckIng').onclick = () => showCookIngredients();
  $('#ckMic').onclick = toggleMic;
  document.addEventListener('keydown', cookKeys);
  requestWakeLock(wakeStatus);
  document.addEventListener('visibilitychange', reWake);
  status(canRecognize ? 'Tip: tap 🎙️ and say “next”, “back”, “repeat”, “ingredients” or “read step”.' : `Voice commands aren’t supported here${isIOS ? ' (iOS Safari limits speech recognition)' : ''}. Use the big buttons${canSpeak ? '; 🔊 still reads steps aloud' : ''}.`);
  showStep();
}
function wakeStatus(on, why) {
  cook.wake = on;
  const msg = on ? '🔆 Screen will stay on' : why === 'unsupported' ? 'Screen Wake Lock not supported here; your screen may sleep.' : '';
  if (msg) { const s = $('#ckStatus'); if (s && !s.dataset.busy) { s.dataset.wake = msg; s.textContent = [msg, s.dataset.msg].filter(Boolean).join(' · '); } }
}
function reWake() { if (document.visibilityState === 'visible' && wakeLockWanted() && !$('#cook').hidden) requestWakeLock(wakeStatus); }
function status(msg) { const s = $('#ckStatus'); if (!s) return; s.dataset.msg = msg; s.textContent = [s.dataset.wake, msg].filter(Boolean).join(' · '); }
function cookKeys(e) {
  if ($('#cook').hidden) return;
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
  else if (e.key === 'Escape') { if (!$('#sheet').hidden) closeSheet(); else location.hash = `#/r/${cook.r.id}`; }
}
function showStep() {
  const r = cook.r, n = r.steps.length, s = r.steps[cook.i];
  $('#ckPos').textContent = `Step ${cook.i + 1} of ${n}`;
  $('#ckGroup').textContent = s?.group || '';
  $('#ckStep').innerHTML = s ? flagify(s.text) : 'No steps recorded.';
  $('#ckProg').style.width = `${((cook.i + 1) / Math.max(n, 1)) * 100}%`;
  $('#ckPrev').disabled = cook.i === 0;
  $('#ckNext').textContent = cook.i >= n - 1 ? 'Done ✓' : 'Next ›';
  history.replaceState(null, '', `#/r/${r.id}/cook?step=${cook.i + 1}`);
}
function go(d) {
  const n = cook.r.steps.length;
  if (d > 0 && cook.i >= n - 1) { status('Last step. Tap × to exit cook mode.'); toast('That was the last step'); return; }
  cook.i = Math.max(0, Math.min(n - 1, cook.i + d)); stopSpeaking(); showStep();
}
function stepSpeech() { const s = cook.r.steps[cook.i]; return `Step ${cook.i + 1}. ${s ? s.text.replace(/°F/g, ' degrees Fahrenheit').replace(/°C/g, ' degrees Celsius') : ''}`; }
function readStep() { if (!speak(stepSpeech())) toast('Text-to-speech not available'); }
function showCookIngredients() {
  const s = openSheet(`<h3>Ingredients <button class="icon-btn" id="ciClose" aria-label="Close">×</button></h3>${ingredientsHTML(cook.r, cook.sc, true)}`);
  $('#ciClose', s).onclick = closeSheet;
}
function readIngredients() {
  const F = factors(cook.r, cook.sc);
  const parts = cook.r.ingredients.filter((i) => !i.isTotal).map((i) => { const s = scaleIngredient(i, F.for(i)); return `${i.name}, ${s.gramsText ? s.gramsText.replace(/ g$/, ' grams') : s.volumeText || s.weightText || ''}`; });
  speak('Ingredients. ' + parts.join('. '));
}
function toggleMic() {
  if (!canRecognize) { toast(recognitionBlocked ? 'Voice commands don’t work in iPhone home-screen apps. Use the big buttons (🔊 still reads steps).' : 'Voice commands not supported in this browser. Use the buttons.', 4000); return; }
  if (!cook.listener) cook.listener = createCommandListener({
    onCommand: (c) => {
      if (c === 'next') go(1); else if (c === 'back') go(-1);
      else if (c === 'repeat' || c === 'read') readStep();
      else if (c === 'ingredients') { showCookIngredients(); readIngredients(); }
      else if (c === 'close') { closeSheet(); stopSpeaking(); }
      else if (c === 'stop') { stopSpeaking(); }
      status(`Heard: “${c}”`);
    },
    onHeard: (t) => { const s = $('#ckStatus'); if (s) s.title = t; },
    onState: (st, err) => { $('#ckMic')?.classList.toggle('on', st === 'on' || st === 'starting'); if (st === 'starting') status('Starting microphone… tap 🎙️ again to cancel'); else if (st === 'on') status('🎙️ Listening for: next, back, repeat, ingredients, read step'); else if (st === 'error' && err !== 'no-speech' && err !== 'aborted') status(micErrorText(err) + ' Use the big buttons.'); else if (st === 'off' && !err) status('Voice commands off.'); },
  });
  if (cook.listener.active) cook.listener.stop(); else cook.listener.start();
}
function closeCook(silent) {
  const el = $('#cook'); if (el.hidden) return;
  el.hidden = true; el.innerHTML = ''; document.body.style.overflow = '';
  try { cook.listener?.abort(); } catch (_) {} cook.listener = null; stopSpeaking(); releaseWakeLock();
  document.removeEventListener('keydown', cookKeys); document.removeEventListener('visibilitychange', reWake);
}

// ---------------------------------------------------------------- tools
function renderTools() {
  setTab('tools'); setTitle('Temps & Tools', true); $('#backBtn').hidden = true;
  const c = (f) => `${Math.round(fToC(f))}°C`;
  const tempCell = (t, nums) => `${esc(t)}<small>${nums.length ? nums.map((n) => c(n)).join('–') + (/\+/.test(t) ? '+' : '') : ''}</small>`;
  const cureRows = store.get('cureRows', [{ n: 'Salt', p: 2 }, { n: 'Sugar', p: 1 }, { n: 'Pink salt #1', p: 0.25 }]);
  const meat = store.get('cureMeat', { v: 5, u: 'lb' });
  view.innerHTML = `
    <div class="tools-grid">
    <div>
    ${REF.doneness.map((d) => `<section class="panel"><h3>${esc(d.meat)} doneness</h3>
      ${(() => { const hasDesc = d.rows.some((r) => r.Description && r.Description !== '—'); return `<table class="tbl"><thead><tr><th>Doneness</th><th>Internal</th>${hasDesc ? '<th>Description</th>' : ''}</tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td>${esc(r.Doneness)}</td><td class="t">${tempCell(r['Internal temp'], r.tempF)}</td>${hasDesc ? `<td>${esc(r.Description)}</td>` : ''}</tr>`).join('')}`; })()}
      </tbody></table></section>`).join('')}
    <p class="note-sm">${REF.donenessNotes.map(md).join('<br>')}</p>
    <section class="panel"><h3>Chicken grilling times</h3>
      <table class="tbl"><thead><tr><th>Cut</th><th>Time (est.)</th><th>Heat</th><th>Grill</th></tr></thead><tbody>
      ${REF.chicken.rows.map((r) => `<tr><td>${esc(r.Cut)}</td><td class="t">${esc(r['Time (est.)'])}</td><td>${esc(r.Heat)}</td><td class="t">${esc(r['Grill temp'])}<small>${c(parseInt(r['Grill temp']))}</small></td></tr>`).join('')}
      </tbody></table>
      <div class="md note-sm" style="margin-top:8px"><ul>${REF.chicken.tips.map((t) => `<li>${md(t)}</li>`).join('')}</ul>${REF.chicken.notes.map((t) => `<p>${md(t)}</p>`).join('')}</div>
    </section>
    </div><div>
    <section class="panel"><h3>°F ⇄ °C</h3>
      <div class="conv"><div class="field"><label for="tf">°F</label><input id="tf" type="number" inputmode="decimal" step="any" value="225"></div>
      <div class="field"><label for="tc">°C</label><input id="tc" type="number" inputmode="decimal" step="any" value="${round(fToC(225), 1)}"></div></div>
      <div class="quick">${[135, 145, 165, 203, 225, 275, 350, 375, 400, 450].map((f) => `<button data-f="${f}">${f}°</button>`).join('')}</div>
    </section>
    <section class="panel"><h3>Unit converter</h3>
      <div class="conv"><div class="field"><label for="ua">Amount</label><input id="ua" type="number" inputmode="decimal" step="any" value="1"></div>
      <div class="field"><label for="uu">From</label><select id="uu">${Object.entries(UNITS).map(([k, u]) => `<option value="${k}" ${k === 'cup' ? 'selected' : ''}>${u.label}</option>`).join('')}</select></div></div>
      <div class="results" id="ures"></div>
      <p class="note-sm">Volume ⇄ weight needs the ingredient’s density, so mass and volume convert separately. US cup = 236.6 mL, tbsp = 14.8 mL, tsp = 4.93 mL.</p>
    </section>
    <section class="panel"><h3>Cure / % calculator</h3>
      <p class="note-sm" style="margin-top:0">Meat weight × % = grams. Example: bacon cure at 3%, salt at 2%, Prague Powder #1 at 0.25%.</p>
      <div class="conv"><div class="field"><label for="cm">Meat weight</label><input id="cm" type="number" inputmode="decimal" step="any" value="${meat.v}"></div>
      <div class="field"><label>Unit</label><div class="seg" role="group" aria-label="Meat unit" style="width:100%">${['lb', 'g', 'kg'].map((u) => `<button style="flex:1" data-cu="${u}" aria-pressed="${meat.u === u}">${u}</button>`).join('')}</div></div></div>
      <div class="cure-row" style="margin-top:12px;font-size:14px;color:var(--muted);font-weight:700"><span>Ingredient</span><span>% of meat</span><span style="text-align:right">Grams</span><span></span></div>
      <div class="cure-rows" id="cureRows"></div>
      <div class="cure-total"><span>Total</span><span id="cureTot"></span></div>
      <div class="quick"><button id="cureAdd">+ Add row</button><button data-preset="bacon">Bacon 3%</button><button data-preset="sausage">Sausage salt 1.8%</button></div>
      <p class="note-sm">Pink salt #1 (6.25% sodium nitrite) at 0.25% of meat ≈ 156 ppm ingoing nitrite. Double-check against your cure’s label.</p>
    </section>
    <section class="panel"><h3>My equipment</h3><div class="tags">${(PRIVATE.equipment || []).map((t) => `<span class="tag" style="font-size:15px">${t}</span>`).join('')}</div>
      ${Object.entries(REF.notes).filter(([k]) => k !== 'Chicken Grilling Times').map(([k, v]) => `<h4>${esc(k)}</h4><div class="md note-sm"><ul>${v.map((t) => `<li>${md(t)}</li>`).join('')}</ul></div>`).join('')}
      <p class="note-sm">From <a href="${esc(REF.source.url)}" target="_blank" rel="noopener">${esc(REF.source.name)}</a>.</p></section>
    </div></div>
    ${sheetRefsHTML()}`;

  const tf = $('#tf'), tc = $('#tc');
  tf.oninput = () => { const v = parseFloat(tf.value); if (isFinite(v)) tc.value = round(fToC(v), 1); };
  tc.oninput = () => { const v = parseFloat(tc.value); if (isFinite(v)) tf.value = round(cToF(v), 1); };
  $$('[data-f]').forEach((b) => b.onclick = () => { tf.value = b.dataset.f; tf.oninput(); });

  const ua = $('#ua'), uu = $('#uu');
  const conv = () => { const a = parseFloat(ua.value) || 0; $('#ures').innerHTML = convertAll(a, uu.value).map((r) => `<div><b>${fmtNum(r.value, r.value < 10 ? 2 : 1)}</b>${r.label}</div>`).join(''); };
  ua.oninput = conv; uu.onchange = conv; conv();

  let rows = cureRows; let mu = meat.u;
  const cm = $('#cm');
  const drawCure = () => {
    const g = toGrams(parseFloat(cm.value) || 0, mu);
    $('#cureRows').innerHTML = rows.map((r, i) => `<div class="cure-row"><input aria-label="Ingredient" data-i="${i}" data-k="n" value="${esc(r.n)}"><input aria-label="Percent" data-i="${i}" data-k="p" type="number" inputmode="decimal" step="any" value="${r.p}"><span class="out">${fmtGrams(cureGrams(g, r.p))}</span><button data-del="${i}" aria-label="Remove row">×</button></div>`).join('');
    $('#cureTot').textContent = `${fmtGrams(rows.reduce((s, r) => s + cureGrams(g, +r.p || 0), 0))} · ${fmtNum(rows.reduce((s, r) => s + (+r.p || 0), 0), 3)}%`;
    store.set('cureRows', rows); store.set('cureMeat', { v: parseFloat(cm.value) || 0, u: mu });
    $$('#cureRows input').forEach((inp) => inp.oninput = () => { rows[inp.dataset.i][inp.dataset.k] = inp.dataset.k === 'p' ? parseFloat(inp.value) || 0 : inp.value; updateOuts(); });
    $$('[data-del]').forEach((b) => b.onclick = () => { rows.splice(+b.dataset.del, 1); drawCure(); });
  };
  const updateOuts = () => { const g = toGrams(parseFloat(cm.value) || 0, mu); $$('#cureRows .out').forEach((o, i) => { o.textContent = fmtGrams(cureGrams(g, rows[i].p)); }); $('#cureTot').textContent = `${fmtGrams(rows.reduce((s, r) => s + cureGrams(g, +r.p || 0), 0))} · ${fmtNum(rows.reduce((s, r) => s + (+r.p || 0), 0), 3)}%`; store.set('cureRows', rows); store.set('cureMeat', { v: parseFloat(cm.value) || 0, u: mu }); };
  cm.oninput = updateOuts;
  $$('[data-cu]').forEach((b) => b.onclick = () => { const g = toGrams(parseFloat(cm.value) || 0, mu); mu = b.dataset.cu; cm.value = round(g / G[mu], mu === 'g' ? 0 : 3); $$('[data-cu]').forEach((x) => x.setAttribute('aria-pressed', x === b)); updateOuts(); });
  $('#cureAdd').onclick = () => { rows.push({ n: 'Ingredient', p: 1 }); drawCure(); };
  $$('[data-preset]').forEach((b) => b.onclick = () => {
    if (b.dataset.preset === 'bacon') {
      // built from the (decrypted) bacon recipe: % of meat column
      const bacon = DATA.recipes.find((r) => r.scaling.cureRate);
      const rate = (bacon?.scaling.cureRate || 0.03) * 100;
      rows = [{ n: 'Cure mix (total)', p: rate }, ...(bacon ? bacon.ingredients.filter((i) => !i.isTotal && !i.isBasis && i.grams).map((i) => ({ n: '↳ ' + i.name, p: round(i.grams / (bacon.ingredients.find((t) => t.isTotal)?.grams || 1) * rate, 3) })) : [])];
    } else rows = [{ n: 'Salt', p: 1.8 }, { n: 'Black pepper', p: 0.3 }, { n: 'Water', p: 5 }];
    drawCure();
  });
  drawCure();
  wireSheetRefs();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- sheet reference tabs (from the vault)
const SR = () => REF.sheet || {};
const col = (t, name) => t.headers.findIndex((h) => h.toLowerCase().startsWith(name.toLowerCase()));
const heatClass = (h) => `heat h${Math.min(5, Math.max(1, Math.ceil((+h || 1) / 2)))}`;
const tierClass = (t) => `tier ${({ 'very high': 'vh', high: 'hi', medium: 'md', low: 'lo' })[String(t).toLowerCase()] || 'na'}`;
const detailRows = (t, row, skip) => `<dl class="ref-dl">${t.headers.map((h, i) => skip.includes(i) || !row[i] ? '' : `<dt>${esc(h)}</dt><dd>${esc(row[i])}</dd>`).join('')}</dl>`;
const refNotes = (t) => t.notes.length ? `<div class="note-sm ref-notes">${t.notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>` : '';

function chileItems(order) {
  const t = SR().chiles, H = col(t, 'Heat'), F = col(t, 'Fresh'), D = col(t, 'Dried'), lo = col(t, 'SHU low'), hi = col(t, 'SHU high');
  const rows = t.rows.map((r, i) => ({ r, i }));
  if (order === 'hot') rows.sort((a, b) => (+b.r[H] - +a.r[H]) || (+b.r[hi] - +a.r[hi]));
  else if (order === 'mild') rows.sort((a, b) => (+a.r[H] - +b.r[H]) || (+a.r[lo] - +b.r[lo]));
  return rows.map(({ r }) => `<details class="ref-item"><summary><span class="${heatClass(r[H])}" title="Heat ${esc(r[H])} of 10">${esc(r[H])}</span><span class="ref-name">${esc(r[F])}<small>→ ${esc(r[D])}</small></span><span class="ref-side">${(+r[lo]).toLocaleString()}–${(+r[hi]).toLocaleString()} SHU</span></summary>${detailRows(t, r, [F, D, H])}</details>`).join('');
}
function sheetRefsHTML() {
  const s = SR(); let html = '';
  if (s.sausage) html += `<details class="panel ref-panel" id="refSausage" open><summary><h3>${esc(s.sausage.title)}</h3></summary>${sausageHTML()}</details>`;
  if (s.chiles) html += `<details class="panel ref-panel" id="refChiles"><summary><h3>Chiles Reference <small>${s.chiles.rows.length}</small></h3></summary>
    <div class="heat-legend">${[1, 3, 5, 7, 9].map((h) => `<span class="${heatClass(h)}">${h}–${h + 1}</span>`).join('')}<span class="note-sm">heat 1–10</span></div>
    <div class="seg" role="group" aria-label="Sort chiles" style="margin:8px 0">${[['sheet', 'Sheet order'], ['mild', 'Mild → hot'], ['hot', 'Hot → mild']].map(([k, l]) => `<button data-csort="${k}" aria-pressed="${k === 'sheet'}" style="padding:0 12px">${l}</button>`).join('')}</div>
    <div id="chileList">${chileItems('sheet')}</div>${refNotes(s.chiles)}</details>`;
  if (s.spices) { const t = s.spices, N = col(t, 'Name'), T = col(t, 'Type'), W = col(t, 'Approx. g');
    html += `<details class="panel ref-panel" id="refSpices"><summary><h3>Spices &amp; Herbs Reference <small>${t.rows.length}</small></h3></summary>
    <input class="ref-filter" id="spiceFilter" type="search" placeholder="Filter spices & herbs…" aria-label="Filter spices and herbs" autocomplete="off">
    <div id="spiceList">${t.rows.map((r) => `<details class="ref-item" data-q="${esc(r.join(' ').toLowerCase())}"><summary><span class="ref-name">${esc(r[N])}<small>${esc(r[T])}</small></span><span class="ref-side">${esc(r[W])}</span></summary>${detailRows(t, r, [N, T])}</details>`).join('')}</div>${refNotes(t)}</details>`; }
  if (s.fats) { const t = s.fats, N = col(t, 'Name'), T = col(t, 'Smoke tier'), F = col(t, 'Smoke point °F'), Y = col(t, 'Type');
    html += `<details class="panel ref-panel" id="refFats"><summary><h3>Fats &amp; Oils Reference <small>${t.rows.length}</small></h3></summary>
    <div class="heat-legend">${['Low', 'Medium', 'High', 'Very high'].map((x) => `<span class="${tierClass(x)}">${x}</span>`).join('')}<span class="note-sm">smoke tier</span></div>
    <div>${t.rows.map((r) => `<details class="ref-item"><summary><span class="${tierClass(r[T])}">${esc(r[T])}</span><span class="ref-name">${esc(r[N])}<small>${esc(r[Y])}</small></span><span class="ref-side">${esc(r[F])}${/^\d|~/.test(r[F]) ? '°F' : ''}</span></summary>${detailRows(t, r, [N, T, Y])}</details>`).join('')}</div>${refNotes(t)}</details>`; }
  return html;
}

const TIER_OPTS = ['Primary', 'Secondary', 'Third', 'Custom'];
function sausageState() {
  const d = SR().sausage.defaults;
  const st = store.get('sausageCalc', null);
  return st && st.v === 1 ? st : { v: 1, amt: d.grams, unit: 'g', salt: d.saltPct, cure: d.cure, binderType: d.binderType, binder: d.binderPct, liquid: d.liquidPct, fat: d.fatPct,
    spices: SR().sausage.spices.map((x) => ({ n: x.name, t: x.tier, o: '' })) };
}
function sausageHTML() {
  const S = SR().sausage, st = sausageState(), h = S.hints, num = (id, label, v, hint) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="decimal" step="any" value="${v}">${hint ? `<small class="hint">${esc(hint)}</small>` : ''}</div>`;
  return `<p class="note-sm" style="margin-top:0">Enter total meat + fat. Everything is a % of that weight. Tiers: Primary ${S.tiers.Primary}% · Secondary ${S.tiers.Secondary}% · Third ${S.tiers.Third}%.</p>
    <div class="conv">${num('sgAmt', 'Meat + fat', st.amt, '')}
      <div class="field"><label>Unit</label><div class="seg" role="group" aria-label="Sausage unit" style="width:100%">${['g', 'lb'].map((u) => `<button style="flex:1" data-su="${u}" aria-pressed="${st.unit === u}">${u}</button>`).join('')}</div></div></div>
    <div class="conv">${num('sgSalt', 'Salt %', st.salt, h['Salt %'])}${num('sgFat', 'Fat target %', st.fat, h['Fat target %'])}</div>
    <div class="conv">${num('sgBinder', 'Binder %', st.binder, h['Binder %'])}<div class="field"><label for="sgBinderType">Binder type</label><input id="sgBinderType" value="${esc(st.binderType)}"></div></div>
    <div class="conv">${num('sgLiquid', 'Liquid %', st.liquid, h['Liquid %'])}<div class="field"><label for="sgCure">Cure #1 (${S.defaults.curePct}%)</label><label class="toggle"><input id="sgCure" type="checkbox" ${st.cure ? 'checked' : ''}> <span>Add pink salt</span></label><small class="hint">${esc(h['Cure #1 (Yes/No)'] || '')}</small></div></div>
    <table class="tbl sg-out"><thead><tr><th>Ingredient</th><th>%</th><th class="num">Grams</th><th class="num">oz</th></tr></thead><tbody id="sgRows"></tbody></table>
    <h4>Spices</h4><div id="sgSpices"></div><div class="quick"><button id="sgAddSpice">+ Add spice</button><button id="sgReset">Reset to sheet defaults</button></div>
    <div class="note-sm ref-notes">${S.notes.filter(Boolean).map((n) => `<p>${md(n)}</p>`).join('')}</div>`;
}
function wireSausage() {
  const S = SR().sausage; if (!S || !$('#sgAmt')) return;
  let st = sausageState();
  const tierPct = (x) => x.t === 'Custom' ? (parseFloat(x.o) || 0) : (S.tiers[x.t] || 0);
  const g1 = (n) => fmtNum(round(n, 1), 1);
  const draw = () => {
    const tot = toGrams(parseFloat(st.amt) || 0, st.unit);
    const pct = (p) => round(tot * p / 100, 1);
    const fat = round(tot * st.fat / 100, 1), lean = round(tot * (1 - st.fat / 100), 1);
    const rows = [['lean', 'Lean meat', 100 - st.fat, lean], ['fat', 'Fat', st.fat, fat], ['salt', 'Salt', st.salt, pct(st.salt)],
      ['cure', 'Cure #1 (pink salt)', st.cure ? S.defaults.curePct : 0, st.cure ? pct(S.defaults.curePct) : 0],
      ['binder', `Binder${st.binderType ? ' — ' + st.binderType : ''}`, st.binder, pct(st.binder)], ['liquid', 'Liquid (water)', st.liquid, pct(st.liquid)]];
    $('#sgRows').innerHTML = rows.map(([k, l, p, g]) => `<tr data-k="${k}"${k === 'cure' && !st.cure ? ' class="off"' : ''}><td>${esc(l)}</td><td>${fmtNum(p, 2)}%</td><td class="num"><b class="g">${g1(g)}</b> g${g >= 454 ? `<small>${esc(fmtLbOz(g))}</small>` : ''}</td><td class="num">${fmtNum(g / OZ_, 2)}</td></tr>`).join('')
      + `<tr class="sub"><td>Total meat+fat</td><td></td><td class="num"><b>${g1(tot)}</b> g<small>${esc(fmtLbOz(tot))}</small></td><td class="num">${fmtNum(tot / OZ_, 1)}</td></tr>`;
    $$('#sgSpices .sg-sp').forEach((el, i) => { const x = st.spices[i]; el.querySelector('.out').innerHTML = `<b>${g1(pct(tierPct(x)))}</b> g · ${fmtNum(tierPct(x), 2)}%`; });
    store.set('sausageCalc', st);
  };
  const drawSpices = () => {
    $('#sgSpices').innerHTML = st.spices.map((x, i) => `<div class="sg-sp"><input aria-label="Spice" data-i="${i}" data-k="n" value="${esc(x.n)}"><select aria-label="Tier" data-i="${i}" data-k="t">${TIER_OPTS.map((o) => `<option ${o === x.t ? 'selected' : ''}>${o}</option>`).join('')}</select><input aria-label="Custom %" data-i="${i}" data-k="o" type="number" inputmode="decimal" step="any" placeholder="%" value="${esc(x.o)}" ${x.t === 'Custom' ? '' : 'hidden'}><span class="out"></span><button data-sdel="${i}" aria-label="Remove spice">×</button></div>`).join('');
    $$('#sgSpices [data-k]').forEach((el) => el[el.tagName === 'SELECT' ? 'onchange' : 'oninput'] = () => { st.spices[el.dataset.i][el.dataset.k] = el.value; if (el.dataset.k === 't') drawSpices(); else draw(); });
    $$('[data-sdel]').forEach((b) => b.onclick = () => { st.spices.splice(+b.dataset.sdel, 1); drawSpices(); });
    draw();
  };
  const bind = (id, k, f = (v) => parseFloat(v) || 0) => { $(id).oninput = () => { st[k] = f($(id).value); draw(); }; };
  bind('#sgAmt', 'amt'); bind('#sgSalt', 'salt'); bind('#sgFat', 'fat'); bind('#sgBinder', 'binder'); bind('#sgLiquid', 'liquid'); bind('#sgBinderType', 'binderType', (v) => v);
  $('#sgCure').onchange = () => { st.cure = $('#sgCure').checked; draw(); };
  $$('[data-su]').forEach((b) => b.onclick = () => { const g = toGrams(parseFloat(st.amt) || 0, st.unit); st.unit = b.dataset.su; st.amt = round(g / G[st.unit], st.unit === 'g' ? 0 : 3); $('#sgAmt').value = st.amt; $$('[data-su]').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); });
  $('#sgAddSpice').onclick = () => { st.spices.push({ n: 'Spice', t: 'Secondary', o: '' }); drawSpices(); };
  $('#sgReset').onclick = () => { store.set('sausageCalc', null); $('#refSausage').innerHTML = `<summary><h3>${esc(S.title)}</h3></summary>${sausageHTML()}`; wireSausage(); };
  drawSpices();
}
function wireSheetRefs() {
  wireSausage();
  $$('[data-csort]').forEach((b) => b.onclick = () => { $('#chileList').innerHTML = chileItems(b.dataset.csort); $$('[data-csort]').forEach((x) => x.setAttribute('aria-pressed', x === b)); });
  const f = $('#spiceFilter'); if (f) f.oninput = () => { const q = f.value.trim().toLowerCase(); $$('#spiceList .ref-item').forEach((el) => { el.hidden = !!q && !el.dataset.q.includes(q); }); };
}
const OZ_ = 28.349523125;


// ---------------------------------------------------------------- boot
(async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  try { await load(); } catch (e) { document.body.classList.remove('locked'); view.innerHTML = `<p class="empty">Couldn’t load recipes (${esc(e.message)}).</p>`; return; }
  route();
})();
