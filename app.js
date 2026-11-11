// Find a time: a small group availability poll.
// Every time slot is stored as a UTC timestamp (milliseconds), so each person
// sees the same moments laid out in their own time zone.

const CFG = window.POLL_CONFIG || {};
const SITE = CFG.siteName || 'Find a time';
const MAX_SLOTS = 2000;
const REFRESH_MS = 5000;

const app = document.getElementById('app');
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

/* ------------------------------------------------------------------ */
/* Time zones                                                          */
/* ------------------------------------------------------------------ */

const fmtCache = new Map();
function zoneFmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}
function partsIn(ms, tz) {
  const o = {};
  for (const p of zoneFmt(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: (+o.hour) % 24, min: +o.minute };
}
const keyOf = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
function offsetMs(ms, tz) {
  const p = partsIn(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - (ms - (ms % 60000));
}
// Wall-clock time in a zone -> UTC milliseconds. `mins` may run past 1440 (next day).
function zonedToUtc(y, m, d, mins, tz) {
  const guess = Date.UTC(y, m - 1, d, 0, mins);
  const o1 = offsetMs(guess, tz);
  let utc = guess - o1;
  const o2 = offsetMs(utc, tz);
  if (o2 !== o1) utc = guess - o2;
  return utc;
}
function isValidTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return !!tz; } catch { return false; }
}
function detectTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}
function gmtLabel(tz, ms = Date.now()) {
  const off = Math.round(offsetMs(ms, tz) / 60000);
  if (off === 0) return 'GMT';
  const a = Math.abs(off);
  return `GMT${off < 0 ? '-' : '+'}${Math.floor(a / 60)}${a % 60 ? ':' + pad(a % 60) : ''}`;
}
const tzName = (tz) => tz.replace(/_/g, ' ');
function allZones(extra) {
  let list = [];
  try { list = Intl.supportedValuesOf('timeZone'); } catch { /* older browser */ }
  if (!list.length) list = ['UTC', 'Europe/Dublin', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
  const set = new Set(list);
  for (const z of extra) if (z && isValidTz(z)) set.add(z);
  return [...set].sort();
}
function zoneOptions(selected) {
  return allZones([selected, 'UTC']).map((z) => `<option value="${esc(z)}"${z === selected ? ' selected' : ''}>${esc(tzName(z))}</option>`).join('');
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
const fmtTime = (mins) => timeFmt.format(new Date(Date.UTC(2000, 0, 1, 0, mins)));
function fmtDay(key, opts) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, d)));
}

/* ------------------------------------------------------------------ */
/* Storage: Supabase (shared) or this browser only (demo)              */
/* ------------------------------------------------------------------ */

function makeSupabaseStore({ url, key }) {
  const base = url.replace(/\/+$/, '').replace(/\/rest\/v1$/, '') + '/rest/v1';
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // legacy anon JWT keys

  async function call(path, opts = {}) {
    const res = await fetch(base + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { const j = await res.json(); msg = j.message || j.hint || msg; } catch { /* no body */ }
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const q = encodeURIComponent;
  const fromRow = (r) => ({ id: r.id, name: r.name, tz: r.tz, slots: (r.slots || []).map(Number), updatedAt: r.updated_at });

  return {
    mode: 'supabase',
    async createPoll(id, p) {
      await call('/polls', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ id, title: p.title, tz: p.tz, dates: p.dates, start_min: p.startMin, end_min: p.endMin, step: p.step, slots: p.slots }),
      });
    },
    async getPoll(id) {
      const rows = await call(`/polls?id=eq.${q(id)}&select=*`);
      const r = rows && rows[0];
      if (!r) return null;
      return { title: r.title, tz: r.tz, dates: r.dates, startMin: r.start_min, endMin: r.end_min, step: r.step, slots: (r.slots || []).map(Number), createdAt: r.created_at };
    },
    async listResponses(pollId) {
      const rows = await call(`/responses?poll_id=eq.${q(pollId)}&select=*&order=updated_at.asc`);
      return (rows || []).map(fromRow);
    },
    async saveResponse(pollId, rid, d) {
      await call('/responses?on_conflict=poll_id,id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ poll_id: pollId, id: rid, name: d.name, tz: d.tz, slots: d.slots, updated_at: new Date().toISOString() }),
      });
    },
    async deleteResponse(pollId, rid) {
      await call(`/responses?poll_id=eq.${q(pollId)}&id=eq.${q(rid)}`, { method: 'DELETE' });
    },
  };
}

function makeLocalStore() {
  const rkey = (id) => 'findatime:resp:' + id;
  return {
    mode: 'local',
    async createPoll(id, p) { const all = ls.get('findatime:polls', {}); all[id] = p; ls.set('findatime:polls', all); },
    async getPoll(id) { return ls.get('findatime:polls', {})[id] || null; },
    async listResponses(id) { return Object.values(ls.get(rkey(id), {})); },
    async saveResponse(id, rid, d) { const all = ls.get(rkey(id), {}); all[rid] = { id: rid, ...d, updatedAt: Date.now() }; ls.set(rkey(id), all); },
    async deleteResponse(id, rid) { const all = ls.get(rkey(id), {}); delete all[rid]; ls.set(rkey(id), all); },
  };
}

/* ------------------------------------------------------------------ */
/* Poll maths                                                          */
/* ------------------------------------------------------------------ */

function buildSlots(dates, startMin, endMin, step, tz) {
  const out = new Set();
  for (const k of dates) {
    const [y, m, d] = k.split('-').map(Number);
    for (let t = startMin; t < endMin; t += step) out.add(zonedToUtc(y, m, d, t, tz));
  }
  return [...out].sort((a, b) => a - b);
}

// Lay the poll's UTC slots out as a grid of local dates x local times.
// If the hours wrap past midnight in this zone (an evening poll, or a big time
// difference), the grid starts after the longest quiet gap, so late-night
// times stay in the same column as the evening they belong to.
function prevDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
function buildLayout(slots, tz, step) {
  const local = slots.map((ms) => { const p = partsIn(ms, tz); return { ms, key: keyOf(p), tod: p.h * 60 + p.min }; });
  const tods = [...new Set(local.map((s) => s.tod))].sort((a, b) => a - b);
  let dayStart = 0;
  if (tods.length > 1) {
    let best = -1, bestIdx = tods.length - 1;
    tods.forEach((t, i) => {
      const gap = i < tods.length - 1 ? tods[i + 1] - t : tods[0] + 1440 - t;
      if (gap > best) { best = gap; bestIdx = i; }
    });
    dayStart = tods[(bestIdx + 1) % tods.length];
  }
  const colSet = new Set();
  const rowSet = new Set();
  const placed = [];
  for (const s of local) {
    const col = s.tod < dayStart ? prevDayKey(s.key) : s.key;
    const row = (s.tod - dayStart + 1440) % 1440; // minutes since the grid's first row
    colSet.add(col); rowSet.add(row);
    placed.push({ ms: s.ms, col, row });
  }
  const cols = [...colSet].sort();
  const rows = [...rowSet].sort((a, b) => a - b);
  const ci = new Map(cols.map((c, i) => [c, i]));
  const ri = new Map(rows.map((r, i) => [r, i]));
  const ms = rows.map(() => cols.map(() => null));
  const pos = new Map();
  for (const s of placed) {
    const r = ri.get(s.row), c = ci.get(s.col);
    ms[r][c] = s.ms;
    pos.set(s.ms, { r, c });
  }
  return { cols, rows, ms, pos, step, dayStart };
}

function bestTimes(slots, people, step) {
  if (!people.length) return [];
  const len = step * 60000;
  const blocks = [];
  let cur = null;
  for (const ms of slots) {
    const avail = people.filter((p) => p.set.has(ms));
    const sig = avail.map((p) => p.id).join('\u0000');
    if (cur && ms === cur.end && sig === cur.sig) cur.end = ms + len;
    else {
      if (cur) blocks.push(cur);
      cur = { start: ms, end: ms + len, sig, avail };
    }
  }
  if (cur) blocks.push(cur);
  return blocks
    .filter((b) => b.avail.length > 0)
    .sort((a, b) => b.avail.length - a.avail.length || (b.end - b.start) - (a.end - a.start) || a.start - b.start)
    .slice(0, 6);
}

function rangeLabel(start, end, tz) {
  const a = partsIn(start, tz), b = partsIn(end, tz);
  const aMin = a.h * 60 + a.min, bMin = b.h * 60 + b.min;
  const nextDay = keyOf(a) !== keyOf(b) && bMin !== 0;
  return {
    day: fmtDay(keyOf(a), { weekday: 'short', day: 'numeric', month: 'short' }),
    time: `${fmtTime(aMin)} – ${fmtTime(bMin)}${nextDay ? ' (next day)' : ''}`,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function newId() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}
const nameKey = (name) => 'p_' + name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[\/\\?#&%]/g, '-').slice(0, 60);
function addRecent(id, title) {
  const list = ls.get('findatime:recent', []).filter((r) => r.id !== id);
  list.unshift({ id, title, at: Date.now() });
  ls.set('findatime:recent', list.slice(0, 8));
}
function savedTz() {
  const t = ls.get('findatime:tz', null);
  return t && isValidTz(t) ? t : detectTz();
}
function messageView(title, body) {
  return `<section class="message"><h1>${esc(title)}</h1><p>${body}</p></section>`;
}

// Arrow-key movement across a grid of cells, skipping empty positions.
function moveFocus(els, r, c, dr, dc) {
  let nr = r + dr, nc = c + dc;
  while (nr >= 0 && nr < els.length && nc >= 0 && nc < els[0].length) {
    if (els[nr][nc]) return els[nr][nc];
    nr += dr; nc += dc;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Create a poll                                                       */
/* ------------------------------------------------------------------ */

function showCreate(store) {
  const tz = detectTz();
  const now = partsIn(Date.now(), tz);
  const todayKey = keyOf(now);
  const selected = new Set();
  let month = { y: now.y, m: now.m };

  const hourOpts = (from, to, sel) => {
    let h = '';
    for (let t = from; t <= to; t += 30) h += `<option value="${t}"${t === sel ? ' selected' : ''}>${t === 1440 ? 'Midnight' : fmtTime(t)}</option>`;
    return h;
  };
  const recent = ls.get('findatime:recent', []);

  app.innerHTML = `
    <section class="create">
      <div class="create-intro">
        <h1>Find a time that works for everyone</h1>
        <p class="lede">Pick the days and hours you're considering. Everyone marks when they're free, and each person sees the times in their own time zone.</p>
      </div>
      <form class="card create-form" novalidate>
        <label class="field">
          <span>What's it for?</span>
          <input name="title" maxlength="100" placeholder="Session planning" autocomplete="off" required>
        </label>

        <fieldset class="field">
          <legend>Which days?</legend>
          <div class="cal" aria-label="Choose dates"></div>
          <p class="hint"><span class="date-count">No days picked yet.</span> Click or drag across days to pick them.</p>
        </fieldset>

        <div class="field-row">
          <label class="field"><span>From</span><select name="start">${hourOpts(0, 1410, 540)}</select></label>
          <label class="field"><span>Until</span><select name="end">${hourOpts(30, 1440, 1260)}</select></label>
          <label class="field"><span>Slots of</span>
            <select name="step"><option value="15">15 minutes</option><option value="30" selected>30 minutes</option><option value="60">1 hour</option></select>
          </label>
        </div>
        <p class="hint overnight" hidden>The end time is before the start, so each day runs past midnight.</p>

        <label class="field">
          <span>Those hours are in</span>
          <select name="tz">${zoneOptions(tz)}</select>
        </label>

        <p class="form-error" role="alert" hidden></p>
        <button class="btn primary" type="submit">Create poll</button>
      </form>
      ${recent.length ? `
        <aside class="recent">
          <h2>Your recent polls</h2>
          <ul>${recent.map((r) => `<li><a href="?poll=${esc(r.id)}">${esc(r.title)}</a></li>`).join('')}</ul>
        </aside>` : ''}
    </section>`;

  const form = app.querySelector('form');
  const cal = app.querySelector('.cal');
  const countEl = app.querySelector('.date-count');
  const errEl = app.querySelector('.form-error');
  const overnightEl = app.querySelector('.overnight');

  const updateCount = () => {
    countEl.textContent = selected.size ? `${selected.size} day${selected.size === 1 ? '' : 's'} picked.` : 'No days picked yet.';
  };
  const updateOvernight = () => { overnightEl.hidden = +form.end.value > +form.start.value; };
  form.start.addEventListener('change', updateOvernight);
  form.end.addEventListener('change', updateOvernight);

  function renderCal() {
    const { y, m } = month;
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const atStart = y === now.y && m === now.m;
    const wk = [];
    for (let i = 0; i < 7; i++) wk.push(fmtDay(`2024-01-${pad(1 + i)}`, { weekday: 'short' })); // 1 Jan 2024 was a Monday
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const k = `${y}-${pad(m)}-${pad(d)}`;
      const past = k < todayKey;
      cells += `<button type="button" class="day${selected.has(k) ? ' on' : ''}${k === todayKey ? ' today' : ''}" data-key="${k}" ${past ? 'disabled' : ''} aria-pressed="${selected.has(k)}">${d}</button>`;
    }
    cal.innerHTML = `
      <div class="cal-head">
        <button type="button" class="icon-btn" data-nav="-1" ${atStart ? 'disabled' : ''} aria-label="Previous month">‹</button>
        <strong>${fmtDay(`${y}-${pad(m)}-01`, { month: 'long', year: 'numeric' })}</strong>
        <button type="button" class="icon-btn" data-nav="1" aria-label="Next month">›</button>
      </div>
      <div class="cal-grid">${wk.map((w) => `<span class="wk">${esc(w)}</span>`).join('')}${cells}</div>`;
  }

  let dragMode = null;
  const setDay = (btn, on) => {
    const k = btn.dataset.key;
    if (on) selected.add(k); else selected.delete(k);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on);
    updateCount();
  };
  cal.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const n = +nav.dataset.nav;
      let { y, m } = month;
      m += n; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      month = { y, m };
      renderCal();
      return;
    }
    const day = e.target.closest('.day');
    if (day && e.detail === 0) setDay(day, !selected.has(day.dataset.key)); // keyboard
  });
  cal.addEventListener('pointerdown', (e) => {
    const day = e.target.closest('.day:not([disabled])');
    if (!day || e.button > 0) return;
    e.preventDefault();
    cal.setPointerCapture(e.pointerId);
    dragMode = !selected.has(day.dataset.key);
    setDay(day, dragMode);
  });
  cal.addEventListener('pointermove', (e) => {
    if (dragMode === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const day = el && el.closest && el.closest('.day:not([disabled])');
    if (day && cal.contains(day)) setDay(day, dragMode);
  });
  const endDrag = () => { dragMode = null; };
  cal.addEventListener('pointerup', endDrag);
  cal.addEventListener('pointercancel', endDrag);

  renderCal();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fail = (msg) => { errEl.textContent = msg; errEl.hidden = false; };
    errEl.hidden = true;
    const title = form.title.value.trim();
    if (!title) { form.title.focus(); return fail('Give the poll a name so people know what it is.'); }
    if (!selected.size) return fail('Pick at least one day.');
    const start = +form.start.value;
    let end = +form.end.value;
    if (end <= start) end += 1440;
    const step = +form.step.value;
    const zone = form.tz.value;
    const dates = [...selected].sort();
    const slots = buildSlots(dates, start, end, step, zone);
    if (slots.length > MAX_SLOTS) return fail(`That's ${slots.length.toLocaleString()} time slots, and the limit is ${MAX_SLOTS.toLocaleString()}. Pick fewer days, a shorter time range or longer slots.`);
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Creating poll…';
    try {
      const id = newId();
      await store.createPoll(id, { title, tz: zone, dates, startMin: start, endMin: end, step, slots, createdAt: Date.now() });
      addRecent(id, title);
      location.href = `?poll=${id}`;
    } catch (err) {
      console.error(err);
      btn.disabled = false; btn.textContent = 'Create poll';
      fail(`The poll wasn't created: ${err.message}. Check the Supabase settings in config.js and try again.`);
    }
  });
}

/* ------------------------------------------------------------------ */
/* View and answer a poll                                              */
/* ------------------------------------------------------------------ */

async function showPoll(store, id) {
  app.innerHTML = '<p class="loading">Loading poll…</p>';
  let poll;
  try { poll = await store.getPoll(id); } catch (err) {
    console.error(err);
    app.innerHTML = messageView("This poll didn't load", `The database said: ${esc(err.message)}. Check your connection and reload the page.`);
    return;
  }
  if (!poll) {
    app.innerHTML = messageView('There is no poll at this link', 'Check the link you were sent, or <a href="./">create a new poll</a>.');
    return;
  }
  addRecent(id, poll.title);
  document.title = `${poll.title} | ${SITE}`;

  const S = {
    id, poll,
    step: poll.step,
    slots: poll.slots.slice().sort((a, b) => a - b),
    tz: savedTz(),
    responses: [],
    loaded: false,
    me: ls.get('findatime:me:' + id, null),
    mine: new Set(),
    mineLoaded: false,
    L: null,
    mineEls: [], groupEls: [], groupByMs: new Map(),
    hover: null,
    removeArmed: false,
  };

  app.innerHTML = `
    <section class="poll">
      <div class="poll-head">
        <h1 class="poll-title">${esc(poll.title)}</h1>
        <button class="btn" type="button" data-act="copy">Copy link</button>
      </div>
      <div class="tzline">
        <label for="tz-select">Showing times in</label>
        <select id="tz-select">${zoneOptions(S.tz)}</select>
        <span class="gmt"></span>
      </div>

      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-tab="mine" aria-selected="true">Your availability</button>
        <button type="button" role="tab" data-tab="group" aria-selected="false">Group</button>
      </div>

      <div class="board" data-tab="mine">
        <section class="panel mine-panel" aria-labelledby="mine-h">
          <div class="panel-head">
            <h2 id="mine-h">Your availability</h2>
            <div class="me-line"></div>
          </div>
          <div class="mine-body"></div>
        </section>

        <section class="panel group-panel" aria-labelledby="group-h">
          <div class="panel-head">
            <h2 id="group-h">Group availability</h2>
            <div class="legend" aria-hidden="true"><span class="legend-lo">0</span><span class="legend-bar"></span><span class="legend-hi">0</span></div>
          </div>
          <div class="grid-wrap"><div class="grid group-grid"></div></div>
        </section>

        <aside class="side">
          <div class="detail" aria-live="polite"></div>
          <div class="side-block">
            <h2>Best times</h2>
            <ol class="best"></ol>
          </div>
          <div class="side-block">
            <h2 class="people-h">Responses</h2>
            <ul class="people"></ul>
          </div>
        </aside>
      </div>
    </section>`;

  const $ = (s) => app.querySelector(s);
  const board = $('.board');
  const mineBody = $('.mine-body');
  const meLine = $('.me-line');
  const groupGrid = $('.group-grid');
  const detail = $('.detail');

  /* ---- people, counts ---- */
  function people() {
    const list = S.responses
      .filter((r) => !S.me || r.id !== S.me.key)
      .map((r) => ({ id: r.id, name: r.name, tz: r.tz, set: new Set(r.slots) }));
    if (S.me) {
      const saved = S.responses.some((r) => r.id === S.me.key);
      if (saved || S.mine.size) list.push({ id: S.me.key, name: S.me.name, tz: S.tz, set: S.mine, me: true });
    }
    return list;
  }

  /* ---- grid markup shared by both grids ---- */
  function gridHtml(kind) {
    const L = S.L;
    const rows = L.rows;
    let h = '<div class="corner"></div>';
    for (const c of L.cols) {
      h += `<div class="colhead"><span class="dow">${esc(fmtDay(c, { weekday: 'short' }))}</span><span class="dom">${esc(fmtDay(c, { day: 'numeric', month: 'short' }))}</span></div>`;
    }
    let anchor = rows[0];
    rows.forEach((off, r) => {
      if (r > 0 && off - rows[r - 1] > S.step) {
        h += '<div class="gap" aria-hidden="true"></div>';
        anchor = off;
      }
      const tod = (off + L.dayStart) % 1440;
      const nextDay = off + L.dayStart >= 1440;
      const label = (off - anchor) % 60 === 0 ? fmtTime(tod) : '';
      const hourEnd = (off + S.step - anchor) % 60 === 0;
      h += `<div class="tl${nextDay && label ? ' next' : ''}"${nextDay && label ? ' title="Next day"' : ''}>${esc(label)}</div>`;
      L.cols.forEach((col, c) => {
        if (L.ms[r][c] == null) { h += '<div class="cell off" aria-hidden="true"></div>'; return; }
        const realDay = nextDay ? keyOf(partsIn(L.ms[r][c], S.tz)) : col;
        const aria = `${fmtDay(realDay, { weekday: 'long', day: 'numeric', month: 'long' })}, ${fmtTime(tod)}`;
        h += `<button type="button" class="cell${hourEnd ? ' hr' : ''}" data-r="${r}" data-c="${c}" tabindex="-1" aria-label="${esc(aria)}"${kind === 'mine' ? ' aria-pressed="false"' : ''}></button>`;
      });
    });
    return h;
  }
  function collect(grid) {
    const els = S.L.rows.map(() => S.L.cols.map(() => null));
    grid.querySelectorAll('.cell[data-r]').forEach((el) => { els[+el.dataset.r][+el.dataset.c] = el; });
    const first = grid.querySelector('.cell[data-r]');
    if (first) first.tabIndex = 0;
    return els;
  }
  function setGridColumns(grid) {
    grid.style.gridTemplateColumns = `var(--tl-w) repeat(${S.L.cols.length}, minmax(var(--cell-min), 1fr))`;
  }

  /* ---- your availability ---- */
  function renderMine() {
    if (!S.me) {
      meLine.innerHTML = '';
      mineBody.innerHTML = `
        <form class="name-form">
          <label class="field">
            <span>Type your name to add your times</span>
            <input name="name" maxlength="60" autocomplete="name" placeholder="Your name" required>
          </label>
          <button class="btn primary" type="submit">Continue</button>
          <p class="hint">Already answered? Type the same name to edit your times.</p>
        </form>`;
      const f = mineBody.querySelector('form');
      f.name.focus({ preventScroll: true });
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = f.name.value.trim().replace(/\s+/g, ' ');
        if (!name) return;
        S.me = { name, key: nameKey(name) };
        ls.set('findatime:me:' + id, S.me);
        S.mine = new Set();
        S.mineLoaded = false;
        loadMyResponse();
        renderMine();
        renderGroup();
      });
      return;
    }
    meLine.innerHTML = `
      <span>Marking as <strong>${esc(S.me.name)}</strong></span>
      <button type="button" class="link-btn" data-act="change-name">Not you?</button>`;
    mineBody.innerHTML = `
      <p class="hint">Drag across the grid to mark when you're free. Drag over marked times to clear them.</p>
      <div class="grid-wrap"><div class="grid mine-grid"></div></div>
      <div class="mine-foot">
        <span class="save-status" aria-live="polite"></span>
        <button type="button" class="link-btn danger" data-act="remove">Remove my response</button>
      </div>`;
    const grid = mineBody.querySelector('.mine-grid');
    setGridColumns(grid);
    grid.innerHTML = gridHtml('mine');
    S.mineEls = collect(grid);
    paintMine();
    wireMineGrid(grid);
  }

  function paintMine(preview) {
    S.mineEls.forEach((row, r) => row.forEach((el, c) => {
      if (!el) return;
      const ms = S.L.ms[r][c];
      let on = S.mine.has(ms);
      if (preview && r >= preview.rMin && r <= preview.rMax && c >= preview.cMin && c <= preview.cMax) on = preview.add;
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', on);
    }));
  }

  function wireMineGrid(grid) {
    let drag = null;
    const rect = () => ({
      rMin: Math.min(drag.r0, drag.r1), rMax: Math.max(drag.r0, drag.r1),
      cMin: Math.min(drag.c0, drag.c1), cMax: Math.max(drag.c0, drag.c1), add: drag.add,
    });
    grid.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.cell[data-r]');
      if (!cell || e.button > 0) return;
      e.preventDefault();
      grid.setPointerCapture(e.pointerId);
      const r = +cell.dataset.r, c = +cell.dataset.c;
      drag = { r0: r, c0: c, r1: r, c1: c, add: !S.mine.has(S.L.ms[r][c]) };
      paintMine(rect());
    });
    grid.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el && el.closest && el.closest('.cell[data-r]');
      if (!cell || !grid.contains(cell)) return;
      const r = +cell.dataset.r, c = +cell.dataset.c;
      if (r === drag.r1 && c === drag.c1) return;
      drag.r1 = r; drag.c1 = c;
      paintMine(rect());
    });
    const finish = () => {
      if (!drag) return;
      const R = rect();
      for (let r = R.rMin; r <= R.rMax; r++) for (let c = R.cMin; c <= R.cMax; c++) {
        const ms = S.L.ms[r][c];
        if (ms == null) continue;
        if (R.add) S.mine.add(ms); else S.mine.delete(ms);
      }
      drag = null;
      paintMine();
      mineChanged();
    };
    grid.addEventListener('pointerup', finish);
    grid.addEventListener('pointercancel', finish);
    grid.addEventListener('lostpointercapture', finish);
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell[data-r]');
      if (!cell || e.detail !== 0) return; // keyboard activation only
      const ms = S.L.ms[+cell.dataset.r][+cell.dataset.c];
      if (S.mine.has(ms)) S.mine.delete(ms); else S.mine.add(ms);
      paintMine();
      mineChanged();
    });
    grid.addEventListener('keydown', (e) => gridKeys(e, S.mineEls));
  }

  function gridKeys(e, els) {
    const cell = e.target.closest('.cell[data-r]');
    if (!cell) return;
    const dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault();
    const next = moveFocus(els, +cell.dataset.r, +cell.dataset.c, d[0], d[1]);
    if (next) { cell.tabIndex = -1; next.tabIndex = 0; next.focus(); }
  }

  let saveTimer = null;
  function mineChanged() {
    renderGroup();
    setStatus('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }
  async function save() {
    if (!S.me) return;
    const me = S.me;
    try {
      await store.saveResponse(id, me.key, { name: me.name, tz: S.tz, slots: [...S.mine].sort((a, b) => a - b) });
      const existing = S.responses.find((r) => r.id === me.key);
      if (existing) existing.slots = [...S.mine];
      else S.responses.push({ id: me.key, name: me.name, tz: S.tz, slots: [...S.mine] });
      setStatus(S.mine.size ? 'Saved' : 'Saved with no times marked');
    } catch (err) {
      console.error(err);
      setStatus(`Not saved: ${err.message}. Your changes will retry on your next edit.`, true);
    }
  }
  function setStatus(text, isError) {
    const el = mineBody.querySelector('.save-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  function loadMyResponse() {
    if (!S.me || S.mineLoaded || !S.loaded) return;
    const r = S.responses.find((x) => x.id === S.me.key);
    if (r) {
      S.me.name = r.name;
      S.mine = new Set(r.slots.filter((ms) => S.L.pos.has(ms)));
    }
    S.mineLoaded = true;
  }

  /* ---- group availability ---- */
  function renderGroup() {
    const P = people();
    const N = P.length;
    if (!groupGrid.dataset.built) {
      setGridColumns(groupGrid);
      groupGrid.innerHTML = gridHtml('group');
      S.groupEls = collect(groupGrid);
      S.groupByMs = new Map();
      S.groupEls.forEach((row, r) => row.forEach((el, c) => { if (el) S.groupByMs.set(S.L.ms[r][c], el); }));
      groupGrid.dataset.built = '1';
      wireGroupGrid();
    }
    for (const [ms, el] of S.groupByMs) {
      const n = P.reduce((a, p) => a + (p.set.has(ms) ? 1 : 0), 0);
      el.style.setProperty('--hp', N ? `${Math.round((n / N) * 100)}%` : '0%');
      el.classList.toggle('all', N > 0 && n === N);
      el.dataset.n = n;
      const base = el.getAttribute('aria-label').replace(/, \d+ of \d+ free$/, '');
      el.setAttribute('aria-label', `${base}, ${n} of ${N} free`);
    }
    $('.legend-hi').textContent = `${N} of ${N} free`;
    $('.legend-lo').textContent = '0';
    renderSide(P);
  }

  function wireGroupGrid() {
    groupGrid.addEventListener('pointerover', (e) => {
      const cell = e.target.closest('.cell[data-r]');
      if (cell) { S.hover = S.L.ms[+cell.dataset.r][+cell.dataset.c]; renderDetail(); }
    });
    groupGrid.addEventListener('pointerleave', () => { S.hover = null; renderDetail(); });
    groupGrid.addEventListener('focusin', (e) => {
      const cell = e.target.closest('.cell[data-r]');
      if (cell) { S.hover = S.L.ms[+cell.dataset.r][+cell.dataset.c]; renderDetail(); }
    });
    groupGrid.addEventListener('keydown', (e) => gridKeys(e, S.groupEls));
  }

  function renderDetail() {
    const P = people();
    const N = P.length;
    if (S.hover == null) {
      detail.innerHTML = N
        ? '<p class="detail-empty">Point at or tap a time in the group grid to see who can make it.</p>'
        : '<p class="detail-empty">Nobody has added their times yet. Copy the link and send it to your group.</p>';
      return;
    }
    const lbl = rangeLabel(S.hover, S.hover + S.step * 60000, S.tz);
    const yes = P.filter((p) => p.set.has(S.hover));
    const no = P.filter((p) => !p.set.has(S.hover));
    detail.innerHTML = `
      <p class="detail-when"><span>${esc(lbl.day)}</span> <strong>${esc(lbl.time)}</strong></p>
      <p class="detail-count">${yes.length} of ${N} can make it</p>
      <div class="detail-cols">
        <div><h3>Free</h3><ul>${yes.map((p) => `<li>${esc(p.name)}</li>`).join('') || '<li class="none">Nobody</li>'}</ul></div>
        <div><h3>Not free</h3><ul>${no.map((p) => `<li>${esc(p.name)}</li>`).join('') || '<li class="none">Nobody</li>'}</ul></div>
      </div>`;
  }

  function renderSide(P) {
    renderDetail();
    const N = P.length;
    const best = bestTimes(S.slots, P, S.step);
    const bestEl = $('.best');
    if (!N) {
      bestEl.innerHTML = '<li class="best-empty">The best times show up here once people add their availability.</li>';
    } else {
      bestEl.innerHTML = best.map((b, i) => {
        const lbl = rangeLabel(b.start, b.end, S.tz);
        const missing = P.filter((p) => !b.avail.includes(p));
        const who = missing.length === 0 ? 'Everyone can make it'
          : missing.length <= 3 ? `Everyone except ${missing.map((p) => esc(p.name)).join(', ')}`
          : `${b.avail.map((p) => esc(p.name)).join(', ')}`;
        return `
          <li data-i="${i}" tabindex="0">
            <div class="best-main">
              <span class="best-day">${esc(lbl.day)}</span>
              <span class="best-time">${esc(lbl.time)}</span>
              <span class="best-who">${who}</span>
            </div>
            <span class="best-n${b.avail.length === N ? ' full' : ''}" aria-label="${b.avail.length} of ${N} free">${b.avail.length}/${N}</span>
          </li>`;
      }).join('') || '<li class="best-empty">No overlapping times yet.</li>';
      bestEl.querySelectorAll('li[data-i]').forEach((li) => {
        const b = best[+li.dataset.i];
        const on = () => highlight(b.start, b.end, true);
        const off = () => highlight(b.start, b.end, false);
        li.addEventListener('pointerenter', on);
        li.addEventListener('pointerleave', off);
        li.addEventListener('focus', on);
        li.addEventListener('blur', off);
      });
    }
    $('.people-h').textContent = `Responses (${N})`;
    $('.people').innerHTML = P.length
      ? P.map((p) => `<li><span class="person">${esc(p.name)}${p.me ? ' <span class="you">(you)</span>' : ''}</span><span class="person-tz">${esc(p.tz ? tzName(p.tz.split('/').pop()) : '')}</span></li>`).join('')
      : '<li class="none">No responses yet.</li>';
  }

  function highlight(start, end, on) {
    for (const [ms, el] of S.groupByMs) if (ms >= start && ms < end) el.classList.toggle('hl', on);
  }

  /* ---- time zone ---- */
  function applyTz() {
    S.L = buildLayout(S.slots, S.tz, S.step);
    $('.gmt').textContent = `${gmtLabel(S.tz)}${S.tz !== poll.tz ? `. The poll was set up in ${tzName(poll.tz)}.` : ''}`;
    delete groupGrid.dataset.built;
    renderMine();
    renderGroup();
  }
  $('#tz-select').addEventListener('change', (e) => {
    S.tz = e.target.value;
    ls.set('findatime:tz', S.tz);
    applyTz();
    if (S.me && S.mineLoaded && S.responses.some((r) => r.id === S.me.key)) save(); // keep their listed zone current
  });

  /* ---- actions ---- */
  app.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'copy') {
      const url = location.href;
      try { await navigator.clipboard.writeText(url); act.textContent = 'Link copied'; }
      catch { window.prompt('Copy this link:', url); }
      setTimeout(() => { act.textContent = 'Copy link'; }, 2000);
    }
    if (a === 'change-name') {
      clearTimeout(saveTimer);
      S.me = null; S.mine = new Set(); S.mineLoaded = false;
      ls.del('findatime:me:' + id);
      renderMine(); renderGroup();
    }
    if (a === 'remove') {
      if (!S.removeArmed) {
        S.removeArmed = true;
        act.textContent = 'Click again to remove your times';
        setTimeout(() => { S.removeArmed = false; if (act.isConnected) act.textContent = 'Remove my response'; }, 4000);
        return;
      }
      S.removeArmed = false;
      clearTimeout(saveTimer);
      try {
        await store.deleteResponse(id, S.me.key);
        S.responses = S.responses.filter((r) => r.id !== S.me.key);
        S.me = null; S.mine = new Set(); S.mineLoaded = false;
        ls.del('findatime:me:' + id);
        renderMine(); renderGroup();
      } catch (err) {
        setStatus(`Not removed: ${err.message}`, true);
      }
    }
  });

  app.querySelectorAll('.tabs [data-tab]').forEach((t) => t.addEventListener('click', () => {
    board.dataset.tab = t.dataset.tab;
    app.querySelectorAll('.tabs [data-tab]').forEach((x) => x.setAttribute('aria-selected', x === t));
  }));

  /* ---- live refresh ---- */
  async function refresh() {
    try {
      const list = await store.listResponses(id);
      // Keep local edits that haven't been saved yet.
      S.responses = list;
      S.loaded = true;
      if (S.me && !S.mineLoaded) { loadMyResponse(); renderMine(); }
      renderGroup();
    } catch (err) {
      console.error(err);
      detail.innerHTML = `<p class="detail-empty error">Couldn't load responses: ${esc(err.message)}</p>`;
    }
  }

  applyTz();
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('storage', (e) => { if (store.mode === 'local' && e.key === 'findatime:resp:' + id) refresh(); });
}

/* ------------------------------------------------------------------ */

async function main() {
  document.title = SITE;
  document.querySelectorAll('[data-site-name]').forEach((el) => { el.textContent = SITE; });
  const sb = CFG.supabase || {};
  let store;
  if (sb.url && sb.key) store = makeSupabaseStore(sb);
  else { store = makeLocalStore(); document.getElementById('demo-banner').hidden = false; }
  const id = new URLSearchParams(location.search).get('poll');
  if (id) await showPoll(store, id.trim());
  else showCreate(store);
}

main();
