(function () {
'use strict';

/* ---------- state & storage ---------- */
const KEY = 'stitchwell:v1';
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return Object.assign({ projects: [], yarns: [], sessions: [], active: null, lastBackup: null }, d);
    }
  } catch (e) {}
  return { projects: [], yarns: [], sessions: [], active: null, lastBackup: null };
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('Could not save. Storage may be full. Export a backup.'); }
}
const proj = id => S.projects.find(p => p.id === id);
const yarn = id => S.yarns.find(y => y.id === id);

if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(() => {}); }

/* ---------- helpers ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
const clock = secs => {
  secs = Math.max(0, Math.floor(secs));
  const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};
const dur = secs => {
  secs = Math.round(secs);
  if (secs < 60) return secs + 's';
  const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const fmtG = g => (Math.round(g * 10) / 10) + ' g';
const projTime = id => S.sessions.filter(s => s.pid === id).reduce((a, s) => a + s.secs, 0);
const projGrams = p => (p.yarnUse || []).reduce((a, u) => a + u.grams, 0);
const yarnUsed = id => S.projects.reduce((a, p) => a + (p.yarnUse || []).filter(u => u.yarnId === id).reduce((b, u) => b + u.grams, 0), 0);
const elapsed = () => {
  const a = S.active; if (!a) return 0;
  return a.acc + (a.since ? (Date.now() - a.since) / 1000 : 0);
};
const STATUS = { wip: 'In progress', paused: 'On hold', finished: 'Finished' };
const WEIGHTS = ['Lace', 'Fingering', 'Sport', 'DK', 'Worsted', 'Aran', 'Bulky', 'Super bulky'];

/* ---------- sheets (modal forms) ---------- */
function fieldHtml(f, vals) {
  const v = vals && vals[f.name] != null ? vals[f.name] : (f.value != null ? f.value : '');
  const id = 'f_' + f.name;
  let input;
  if (f.type === 'select') {
    input = `<select id="${id}" name="${f.name}">${f.options.map(o => {
      const [val, label] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
  } else if (f.type === 'number') {
    input = `<input id="${id}" name="${f.name}" type="number" inputmode="decimal" step="any" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}">`;
  } else {
    input = `<input id="${id}" name="${f.name}" type="text" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}"${f.required ? ' required' : ''}>`;
  }
  return `<label for="${id}">${esc(f.label)}</label>${input}`;
}
function closeSheet() { const s = $('.sheet-bg'); if (s) s.remove(); }
function sheet(title, fields, vals, onSubmit, opts = {}) {
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<form class="sheet"><h2>${esc(title)}</h2>${opts.intro ? `<p class="muted">${opts.intro}</p>` : ''}
    ${fields.map(f => fieldHtml(f, vals)).join('')}
    <div class="actions">
      <button type="button" class="btn" data-close>Cancel</button>
      ${opts.danger ? `<button type="button" class="btn danger" data-danger>${esc(opts.danger.label)}</button>` : ''}
      <button type="submit" class="btn primary">${esc(opts.submit || 'Save')}</button>
    </div></form>`;
  document.body.appendChild(bg);
  const form = $('form', bg);
  bg.addEventListener('click', e => { if (e.target === bg || e.target.hasAttribute('data-close')) closeSheet(); });
  if (opts.danger) $('[data-danger]', bg).addEventListener('click', () => {
    if (confirm(opts.danger.confirm || 'Are you sure?')) { closeSheet(); opts.danger.fn(); }
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const o = {}; new FormData(form).forEach((v, k) => { o[k] = v; });
    if (onSubmit(o) !== false) closeSheet();
  });
  const first = $('input[type=text],textarea', form);
  if (first && !opts.noFocus) setTimeout(() => first.focus(), 50);
}

/* ---------- views ---------- */
let homeFilter = 'wip';

function viewHome() {
  const list = S.projects.filter(p => homeFilter === 'all' || (homeFilter === 'wip' ? p.status !== 'finished' : p.status === 'finished'))
    .sort((a, b) => (b.touched || 0) - (a.touched || 0));
  const chip = (k, l) => `<button class="chip${homeFilter === k ? ' on' : ''}" data-a="filter" data-k="${k}">${l}</button>`;
  return `<h1>Projects</h1>
  <div class="chips">${chip('wip', 'Active')}${chip('finished', 'Finished')}${chip('all', 'All')}</div>
  ${list.length ? list.map(p => `<a class="card proj" href="#/p/${p.id}/counter">
      <div class="row between"><span class="name">${esc(p.name)}</span><span class="badge ${p.status}">${STATUS[p.status]}</span></div>
      <div class="muted small">${p.type === 'crochet' ? 'Crochet' : 'Knitting'}${p.needles ? ' · ' + esc(p.needles) : ''}</div>
      <div class="stats-line"><span>${p.rows || 0} rows</span><span>${dur(projTime(p.id))}</span><span>${fmtG(projGrams(p))}</span></div>
    </a>`).join('') : `<div class="empty">${S.projects.length ? 'Nothing here yet.' : 'No projects yet. Tap New project to start one.'}</div>`}
  <button class="fab" data-a="newProject">+ New project</button>`;
}

function viewProject(p, tab) {
  const tabs = [['counter', 'Counter'], ['pattern', 'Pattern'], ['notes', 'Notes'], ['yarn', 'Yarn']];
  let body = '';
  if (tab === 'pattern') body = tabPattern(p);
  else if (tab === 'notes') body = tabNotes(p);
  else if (tab === 'yarn') body = tabYarn(p);
  else body = tabCounter(p);
  return `<div class="top"><a class="icon-btn" href="#/">&lsaquo; Projects</a><button class="icon-btn" data-a="editProject" data-id="${p.id}">Edit</button></div>
  <h1 style="margin-top:0">${esc(p.name)}</h1>
  <div class="muted small">${p.type === 'crochet' ? 'Crochet' : 'Knitting'}${p.needles ? ' · ' + esc(p.needles) : ''} · ${STATUS[p.status]}</div>
  <div class="tabs">${tabs.map(([k, l]) => `<a href="#/p/${p.id}/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
  ${body}`;
}

function tabCounter(p) {
  const a = S.active && S.active.pid === p.id ? S.active : null;
  const other = S.active && S.active.pid !== p.id;
  const sessionCard = a
    ? `<div class="card"><div class="row between"><div><div class="count-label">Session</div><div class="timer" data-timer>${clock(elapsed())}</div></div>
        <div class="row">${a.since
          ? `<button class="btn" data-a="pause">Pause</button>`
          : `<button class="btn" data-a="resume">Resume</button>`}
          <button class="btn primary" data-a="stop">Finish</button></div></div>
        <div class="muted small">${a.rows} rows this session</div></div>`
    : `<div class="card row between"><div><div class="count-label">Session</div><div class="muted small">${other ? 'Another project has a session running.' : 'Track your knitting time.'}</div></div>
        <button class="btn primary" data-a="start" data-id="${p.id}">${other ? 'Switch here' : 'Start'}</button></div>`;
  const counters = p.counters || [];
  return `${sessionCard}
  <div class="card count-card">
    <div class="count-label">Rows</div>
    <div class="count-num" data-rows="${p.id}" data-a="setRows" data-id="${p.id}">${p.rows || 0}</div>
    <button class="tap" data-a="inc" data-id="${p.id}">+1</button>
    <div class="ctr-row"><button class="btn" data-a="dec" data-id="${p.id}">&minus;1</button>
      <button class="btn" data-a="setRows" data-id="${p.id}">Set</button>
      <button class="btn danger" data-a="resetRows" data-id="${p.id}">Reset</button></div>
  </div>
  <div class="card"><div class="row between"><h3 style="margin:0">Other counters</h3><button class="btn small" data-a="addCounter" data-id="${p.id}">+ Add</button></div>
    <p class="muted small" style="margin-top:4px">For repeats, stitch counts, increases, or anything else you track alongside the main row count.</p>
    ${counters.map(c => `<div class="mini${c.target && c.count >= c.target ? ' complete' : ''}">
        <div class="lbl" data-a="editCounter" data-id="${p.id}" data-cid="${c.id}">${esc(c.label)}${c.target ? `<div class="muted small">goal ${c.target}</div>` : ''}</div>
        <button class="round" data-a="cdec" data-id="${p.id}" data-cid="${c.id}">&minus;</button>
        <div class="val">${c.count}</div>
        <button class="round plus" data-a="cinc" data-id="${p.id}" data-cid="${c.id}">+</button></div>`).join('') || '<div class="muted small">None yet.</div>'}
  </div>
  <div class="card row between"><div><b>Keep screen awake</b><div class="muted small">Stops your phone from locking while you knit.</div></div>
    <button class="btn small" data-a="wake">${wakeLock ? 'On' : 'Off'}</button></div>`;
}

function tabPattern(p) {
  const st = p.steps || [];
  if (!st.length) {
    return `<div class="card"><h3>Pattern steps</h3>
      <p class="muted">Paste your pattern with one instruction per line, for example one row or round per line. You can fix it up later.</p>
      <textarea id="pat-text" rows="10" placeholder="Row 1 (RS): K2, *yo, k2tog; rep from * to end&#10;Row 2: Purl all sts"></textarea>
      <button class="btn primary block gap" data-a="importSteps" data-id="${p.id}">Create steps</button></div>`;
  }
  const done = st.filter(s => s.done).length;
  const cur = Math.min(p.cur || 0, st.length - 1);
  const finished = done === st.length;
  return `<div class="card">
    <div class="row between"><div class="count-label">${finished ? 'Pattern complete' : `Step ${cur + 1} of ${st.length}`}</div><span class="muted small">${done} done</span></div>
    <div class="bar gap" style="margin-top:8px"><i style="width:${Math.round(done / st.length * 100)}%"></i></div>
    <div class="step-now">${finished ? 'All steps done.' : esc(st[cur].text)}</div>
    <div class="ctr-row"><button class="btn" data-a="stepBack" data-id="${p.id}">Back</button>
      <button class="btn primary" style="flex:2" data-a="stepNext" data-id="${p.id}">${finished ? 'Start over' : 'Done, next'}</button></div>
  </div>
  <div class="card"><div class="row between"><h3 style="margin:0">All steps</h3>
      <div class="row"><button class="btn small" data-a="editSteps" data-id="${p.id}">Edit</button></div></div>
    <ul class="steps gap">${st.map((s, i) => `<li class="${s.done ? 'done' : ''}${i === cur && !finished ? ' cur' : ''}" data-a="goStep" data-id="${p.id}" data-i="${i}">
      <span class="check" data-a="toggleStep" data-id="${p.id}" data-i="${i}"></span><span class="n">${i + 1}</span><span class="t">${esc(s.text)}</span></li>`).join('')}</ul>
  </div>`;
}

function tabNotes(p) {
  const notes = (p.notes || []).slice().sort((a, b) => b.ts - a.ts);
  return `<div class="card"><h3>Add a note</h3>
    <textarea id="note-input" rows="3" placeholder="Modifications, mistakes, gauge, ideas for next time"></textarea>
    <button class="btn primary block gap" data-a="addNote" data-id="${p.id}">Save note</button></div>
  <div class="card">${notes.map(n => `<div class="note"><p>${esc(n.text)}</p>
      <div class="row between"><span class="muted small">${new Date(n.ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
      <button class="icon-btn small" data-a="delNote" data-id="${p.id}" data-nid="${n.id}">Delete</button></div></div>`).join('') || '<div class="muted small">No notes yet.</div>'}</div>`;
}

function tabYarn(p) {
  const use = p.yarnUse || [];
  return `<div class="card"><div class="row between"><h3 style="margin:0">Yarn used</h3><button class="btn small" data-a="addUse" data-id="${p.id}">+ Add</button></div>
    <p class="muted small" style="margin-top:4px">Total: <b>${fmtG(projGrams(p))}</b></p>
    ${use.map(u => {
      const y = u.yarnId ? yarn(u.yarnId) : null;
      return `<div class="mini"><div class="lbl">${esc(y ? y.name : u.label || 'Yarn')}${y && (y.color || y.brand) ? `<div class="muted small">${esc([y.brand, y.color].filter(Boolean).join(' · '))}</div>` : ''}</div>
        <div class="val" style="min-width:70px;font-size:18px">${fmtG(u.grams)}</div>
        <button class="icon-btn" data-a="delUse" data-id="${p.id}" data-uid="${u.id}">Remove</button></div>`;
    }).join('') || '<div class="muted small">Nothing logged yet.</div>'}</div>`;
}

function viewStash() {
  return `<h1>Yarn stash</h1>
  ${S.yarns.map(y => {
    const used = yarnUsed(y.id), left = (y.grams || 0) - used;
    return `<div class="card" data-a="editYarn" data-id="${y.id}">
      <div class="row between"><b>${esc(y.name)}</b><span class="badge">${esc(y.weight || '')}</span></div>
      <div class="muted small">${esc([y.brand, y.color].filter(Boolean).join(' · '))}</div>
      <div class="stats-line"><span>${fmtG(y.grams || 0)} total</span><span>${fmtG(used)} used</span><span style="color:${left < 0 ? 'var(--danger)' : 'inherit'}">${fmtG(left)} left</span></div></div>`;
  }).join('') || '<div class="empty">No yarn yet. Add what you have and it will track usage across projects.</div>'}
  <button class="fab" data-a="addYarn">+ Add yarn</button>`;
}

function viewStats() {
  const total = S.sessions.reduce((a, s) => a + s.secs, 0);
  const rows = S.projects.reduce((a, p) => a + (p.rows || 0), 0);
  const fin = S.projects.filter(p => p.status === 'finished').length;
  const grams = S.projects.reduce((a, p) => a + projGrams(p), 0);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const end = d.getTime() + 86400000;
    const secs = S.sessions.filter(s => s.date >= d.getTime() && s.date < end).reduce((a, s) => a + s.secs, 0);
    days.push({ d, secs });
  }
  const max = Math.max(60, ...days.map(x => x.secs));
  const byProj = S.projects.map(p => ({ p, t: projTime(p.id) })).filter(x => x.t > 0).sort((a, b) => b.t - a.t);
  return `<h1>Stats</h1>
  <div class="grid2">
    <div class="stat"><span class="muted small">Time knitting</span><b>${dur(total)}</b></div>
    <div class="stat"><span class="muted small">Sessions</span><b>${S.sessions.length}</b></div>
    <div class="stat"><span class="muted small">Rows counted</span><b>${rows}</b></div>
    <div class="stat"><span class="muted small">Finished projects</span><b>${fin}</b></div>
    <div class="stat"><span class="muted small">Yarn used</span><b>${fmtG(grams)}</b></div>
    <div class="stat"><span class="muted small">Projects</span><b>${S.projects.length}</b></div>
  </div>
  <div class="card gap"><h3>Last 14 days</h3>
    <div class="chart">${days.map(x => `<div title="${dur(x.secs)}"><i style="height:${Math.round(x.secs / max * 90)}%"></i>${x.d.getDate()}</div>`).join('')}</div></div>
  <div class="card"><h3>Time by project</h3>${byProj.map(x => `<div class="row between" style="padding:6px 0"><span>${esc(x.p.name)}</span><b>${dur(x.t)}</b></div>`).join('') || '<div class="muted small">Start a session on a project to see this.</div>'}</div>`;
}

function viewSettings() {
  return `<h1>Settings</h1>
  <div class="card"><h3>Backup</h3>
    <p class="muted">Everything is stored on this device only. Export a backup now and then, especially before clearing Safari data or changing phones.</p>
    <p class="muted small">${S.lastBackup ? 'Last export: ' + new Date(S.lastBackup).toLocaleString() : 'You have not exported a backup yet.'}</p>
    <button class="btn primary block" data-a="export">Export backup</button>
    <button class="btn block gap" data-a="import">Import backup</button>
    <input type="file" id="import-file" accept="application/json,.json" hidden></div>
  <div class="card"><h3>Reset</h3><p class="muted">Deletes all projects, stash, and stats on this device.</p>
    <button class="btn danger block" data-a="wipe">Delete all data</button></div>
  <p class="muted small" style="text-align:center">Stitchwell. A personal knitting and crochet tracker.</p>`;
}

/* ---------- render / routing ---------- */
function render() {
  const r = location.hash.replace(/^#\/?/, '').split('/');
  const y = window.scrollY;
  let html, nav = 'home';
  if (r[0] === 'p' && proj(r[1])) html = viewProject(proj(r[1]), r[2] || 'counter');
  else if (r[0] === 'stash') { html = viewStash(); nav = 'stash'; }
  else if (r[0] === 'stats') { html = viewStats(); nav = 'stats'; }
  else if (r[0] === 'settings') { html = viewSettings(); nav = 'settings'; }
  else html = viewHome();
  $('#app').innerHTML = html;
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === nav));
  window.scrollTo(0, y);
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

/* ---------- screen wake lock ---------- */
let wakeLock = null;
async function setWake(on) {
  try {
    if (on) {
      if (!('wakeLock' in navigator)) { toast('Your browser does not support keeping the screen awake.'); return; }
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { /* released by system */ });
    } else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; toast('Could not keep the screen awake.'); }
  render();
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && wakeLock && wakeLock.released) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; }
  }
});

/* ---------- sessions ---------- */
function stopSession(silent) {
  const a = S.active; if (!a) return;
  const secs = Math.round(elapsed());
  if (secs >= 5) S.sessions.push({ id: uid(), pid: a.pid, date: a.start, secs, rows: a.rows });
  S.active = null; save();
  if (!silent) toast(secs >= 5 ? `Session saved: ${dur(secs)}` : 'Session too short to save.');
}
setInterval(() => { $$('[data-timer]').forEach(el => { el.textContent = clock(elapsed()); }); }, 1000);

/* ---------- actions ---------- */
function bump(p, d) {
  p.rows = Math.max(0, (p.rows || 0) + d);
  p.touched = Date.now();
  if (S.active && S.active.pid === p.id) S.active.rows = Math.max(0, S.active.rows + d);
  save();
  $$(`[data-rows="${p.id}"]`).forEach(el => { el.textContent = p.rows; });
  if (navigator.vibrate) navigator.vibrate(d > 0 ? 12 : 6);
}
function counterFields() {
  return [{ name: 'label', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Pattern repeat, Increases' },
          { name: 'target', label: 'Goal (optional)', type: 'number', placeholder: 'e.g. 8' }];
}
function projectFields() {
  return [{ name: 'name', label: 'Project name', type: 'text', required: true },
          { name: 'type', label: 'Craft', type: 'select', options: [['knit', 'Knitting'], ['crochet', 'Crochet']] },
          { name: 'needles', label: 'Needles or hook (optional)', type: 'text', placeholder: 'e.g. 4 mm circular' }];
}
function yarnFields() {
  return [{ name: 'name', label: 'Yarn name', type: 'text', required: true },
          { name: 'brand', label: 'Brand', type: 'text' },
          { name: 'color', label: 'Colorway', type: 'text' },
          { name: 'weight', label: 'Weight', type: 'select', options: WEIGHTS },
          { name: 'grams', label: 'Total amount owned (grams)', type: 'number' }];
}
const linesToSteps = (txt, old = []) => txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  .map((t, i) => ({ id: uid(), text: t, done: !!(old[i] && old[i].text === t && old[i].done) }));

const actions = {
  filter: d => { homeFilter = d.k; render(); },
  newProject: () => sheet('New project', projectFields(), { type: 'knit' }, o => {
    if (!o.name.trim()) return false;
    const p = { id: uid(), name: o.name.trim(), type: o.type, needles: o.needles.trim(), status: 'wip', rows: 0, counters: [], steps: [], cur: 0, notes: [], yarnUse: [], created: Date.now(), touched: Date.now() };
    S.projects.push(p); save(); location.hash = `#/p/${p.id}/counter`;
  }, { submit: 'Create' }),
  editProject: d => { const p = proj(d.id); sheet('Edit project', projectFields().concat([{ name: 'status', label: 'Status', type: 'select', options: Object.entries(STATUS) }]), p, o => {
    if (!o.name.trim()) return false;
    Object.assign(p, { name: o.name.trim(), type: o.type, needles: o.needles.trim(), status: o.status });
    if (p.status === 'finished' && !p.finishedAt) p.finishedAt = Date.now();
    save(); render();
  }, { danger: { label: 'Delete', confirm: 'Delete this project and its notes?', fn: () => {
    if (S.active && S.active.pid === p.id) S.active = null;
    S.projects = S.projects.filter(x => x.id !== p.id); S.sessions = S.sessions.filter(s => s.pid !== p.id); save(); location.hash = '#/';
  } } }); },

  inc: d => bump(proj(d.id), 1),
  dec: d => bump(proj(d.id), -1),
  setRows: d => { const p = proj(d.id); sheet('Set row count', [{ name: 'rows', label: 'Rows', type: 'number' }], { rows: p.rows || 0 }, o => {
    p.rows = Math.max(0, Math.round(num(o.rows))); save(); render();
  }, { noFocus: false }); setTimeout(() => { const i = $('.sheet input'); if (i) i.select(); }, 80); },
  resetRows: d => { if (confirm('Reset the row count to 0?')) { const p = proj(d.id); p.rows = 0; save(); render(); } },

  addCounter: d => sheet('New counter', counterFields(), {}, o => {
    const p = proj(d.id); p.counters.push({ id: uid(), label: o.label.trim() || 'Counter', count: 0, target: Math.max(0, Math.round(num(o.target))) }); save(); render();
  }, { submit: 'Add' }),
  editCounter: d => { const p = proj(d.id), c = p.counters.find(x => x.id === d.cid);
    sheet('Edit counter', counterFields().concat([{ name: 'count', label: 'Current count', type: 'number' }]), c, o => {
      c.label = o.label.trim() || c.label; c.target = Math.max(0, Math.round(num(o.target))); c.count = Math.max(0, Math.round(num(o.count))); save(); render();
    }, { danger: { label: 'Delete', confirm: 'Delete this counter?', fn: () => { p.counters = p.counters.filter(x => x.id !== c.id); save(); render(); } } }); },
  cinc: d => { const c = proj(d.id).counters.find(x => x.id === d.cid); c.count++; save(); render(); if (navigator.vibrate) navigator.vibrate(10); },
  cdec: d => { const c = proj(d.id).counters.find(x => x.id === d.cid); c.count = Math.max(0, c.count - 1); save(); render(); },

  start: d => { if (S.active) stopSession(true); S.active = { pid: d.id, start: Date.now(), acc: 0, since: Date.now(), rows: 0 }; save(); render(); },
  pause: () => { const a = S.active; if (a && a.since) { a.acc += (Date.now() - a.since) / 1000; a.since = null; save(); render(); } },
  resume: () => { const a = S.active; if (a && !a.since) { a.since = Date.now(); save(); render(); } },
  stop: () => { stopSession(); render(); },
  wake: () => setWake(!wakeLock),

  importSteps: d => {
    const txt = ($('#pat-text') || {}).value || '';
    const steps = linesToSteps(txt);
    if (!steps.length) { toast('Paste some pattern text first.'); return; }
    const p = proj(d.id); p.steps = steps; p.cur = 0; save(); render();
  },
  stepNext: d => { const p = proj(d.id), st = p.steps;
    if (st.every(s => s.done)) { st.forEach(s => { s.done = false; }); p.cur = 0; }
    else { st[p.cur || 0].done = true; const nx = st.findIndex((s, i) => i > (p.cur || 0) && !s.done); p.cur = nx >= 0 ? nx : st.findIndex(s => !s.done) >= 0 ? st.findIndex(s => !s.done) : st.length - 1; }
    p.touched = Date.now(); save(); render(); },
  stepBack: d => { const p = proj(d.id); const c = Math.min(p.cur || 0, p.steps.length - 1);
    if (c > 0) { p.cur = c - 1; p.steps[p.cur].done = false; } save(); render(); },
  goStep: (d, e) => { if (e.target.closest('.check')) return; const p = proj(d.id); p.cur = +d.i; save(); render(); },
  toggleStep: d => { const p = proj(d.id), s = p.steps[+d.i]; s.done = !s.done; save(); render(); },
  editSteps: d => { const p = proj(d.id);
    sheet('Edit steps', [{ name: 'txt', label: 'One step per line', type: 'textarea', rows: 12 }], { txt: p.steps.map(s => s.text).join('\n') }, o => {
      p.steps = linesToSteps(o.txt, p.steps); p.cur = Math.min(p.cur || 0, Math.max(0, p.steps.length - 1)); save(); render();
    }, { danger: { label: 'Clear', confirm: 'Remove all pattern steps?', fn: () => { p.steps = []; p.cur = 0; save(); render(); } }, noFocus: true }); },

  addNote: d => { const el = $('#note-input'), t = el.value.trim(); if (!t) return;
    proj(d.id).notes.push({ id: uid(), ts: Date.now(), text: t }); save(); render(); },
  delNote: d => { if (!confirm('Delete this note?')) return; const p = proj(d.id); p.notes = p.notes.filter(n => n.id !== d.nid); save(); render(); },

  addUse: d => {
    const opts = [['', 'Not in my stash']].concat(S.yarns.map(y => [y.id, y.name + (y.color ? ' (' + y.color + ')' : '')]));
    sheet('Add yarn used', [{ name: 'yarnId', label: 'Yarn', type: 'select', options: opts },
      { name: 'label', label: 'Name (if not in stash)', type: 'text' }, { name: 'grams', label: 'Grams used', type: 'number' }], {}, o => {
      const g = num(o.grams); if (g <= 0) { toast('Enter how many grams.'); return false; }
      if (!o.yarnId && !o.label.trim()) { toast('Pick a yarn or type a name.'); return false; }
      proj(d.id).yarnUse.push({ id: uid(), yarnId: o.yarnId || null, label: o.label.trim(), grams: g }); save(); render();
    }, { submit: 'Add', noFocus: true });
  },
  delUse: d => { const p = proj(d.id); p.yarnUse = p.yarnUse.filter(u => u.id !== d.uid); save(); render(); },

  addYarn: () => sheet('Add yarn', yarnFields(), { weight: 'DK' }, o => {
    if (!o.name.trim()) return false;
    S.yarns.push({ id: uid(), name: o.name.trim(), brand: o.brand.trim(), color: o.color.trim(), weight: o.weight, grams: num(o.grams) }); save(); render();
  }, { submit: 'Add' }),
  editYarn: d => { const y = yarn(d.id); sheet('Edit yarn', yarnFields(), y, o => {
    if (!o.name.trim()) return false;
    Object.assign(y, { name: o.name.trim(), brand: o.brand.trim(), color: o.color.trim(), weight: o.weight, grams: num(o.grams) }); save(); render();
  }, { danger: { label: 'Delete', confirm: 'Delete this yarn? Logged usage stays on projects.', fn: () => {
    S.projects.forEach(p => (p.yarnUse || []).forEach(u => { if (u.yarnId === y.id) { u.label = y.name; u.yarnId = null; } }));
    S.yarns = S.yarns.filter(x => x.id !== y.id); save(); render();
  } } }); },

  export: async () => {
    const json = JSON.stringify({ app: 'stitchwell', exported: new Date().toISOString(), data: S }, null, 2);
    const name = `stitchwell-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([json], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Stitchwell backup' });
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
      S.lastBackup = Date.now(); save(); render();
    } catch (e) { if (e && e.name !== 'AbortError') toast('Export failed.'); }
  },
  import: () => $('#import-file').click(),
  wipe: () => { if (confirm('Delete everything on this device? This cannot be undone.') && confirm('Really delete all projects, stash, and stats?')) {
    S = { projects: [], yarns: [], sessions: [], active: null, lastBackup: null }; save(); location.hash = '#/'; render(); } }
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]');
  if (!t || !actions[t.dataset.a]) return;
  actions[t.dataset.a](t.dataset, e);
});
document.addEventListener('change', e => {
  if (e.target.id !== 'import-file' || !e.target.files[0]) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const j = JSON.parse(rd.result);
      const d = j && j.data;
      if (!d || !Array.isArray(d.projects)) throw new Error('bad');
      if (!confirm('Replace everything on this device with this backup?')) return;
      S = Object.assign({ projects: [], yarns: [], sessions: [], active: null, lastBackup: null }, d); save(); render(); toast('Backup restored.');
    } catch (err) { toast('That file is not a Stitchwell backup.'); }
  };
  rd.readAsText(e.target.files[0]);
});

/* ---------- boot ---------- */
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
})();
