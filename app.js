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

/* ------------------------------------------------------------------ */
/* Time zone search                                                    */
/* ------------------------------------------------------------------ */

// Extra names people search for that aren't in the zone IDs themselves.
const ZONE_ALIASES = {
  'Europe/Dublin': ['Ireland', 'Cork', 'Galway', 'Limerick', 'Belfast'],
  'Europe/London': ['United Kingdom', 'UK', 'Britain', 'England', 'Scotland', 'Wales', 'Manchester', 'Edinburgh', 'Glasgow', 'Birmingham', 'Bristol'],
  'Europe/Warsaw': ['Poland', 'Krakow', 'Wroclaw', 'Gdansk', 'Poznan', 'Czocha'],
  'Europe/Berlin': ['Germany', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne'],
  'Europe/Paris': ['France', 'Lyon', 'Marseille'],
  'Europe/Madrid': ['Spain', 'Barcelona', 'Valencia', 'Seville'],
  'Europe/Rome': ['Italy', 'Milan', 'Naples', 'Florence'],
  'Europe/Amsterdam': ['Netherlands', 'Holland', 'Rotterdam', 'The Hague', 'Utrecht'],
  'Europe/Brussels': ['Belgium', 'Antwerp'],
  'Europe/Stockholm': ['Sweden', 'Gothenburg'],
  'Europe/Oslo': ['Norway'],
  'Europe/Copenhagen': ['Denmark'],
  'Europe/Helsinki': ['Finland'],
  'Europe/Prague': ['Czechia', 'Czech Republic'],
  'Europe/Vienna': ['Austria'],
  'Europe/Zurich': ['Switzerland', 'Geneva', 'Basel'],
  'Europe/Lisbon': ['Portugal', 'Porto'],
  'Europe/Athens': ['Greece'],
  'Europe/Budapest': ['Hungary'],
  'Europe/Bucharest': ['Romania'],
  'Europe/Kiev': ['Ukraine', 'Kyiv'],
  'Europe/Kyiv': ['Ukraine', 'Kiev'],
  'Europe/Vilnius': ['Lithuania'],
  'Europe/Riga': ['Latvia'],
  'Europe/Tallinn': ['Estonia'],
  'Atlantic/Reykjavik': ['Iceland'],
  'America/New_York': ['USA Eastern', 'US Eastern', 'Boston', 'Washington DC', 'Philadelphia', 'Atlanta', 'Miami', 'Orlando', 'Pittsburgh', 'Baltimore', 'Charlotte'],
  'America/Chicago': ['USA Central', 'US Central', 'Dallas', 'Houston', 'Austin', 'San Antonio', 'Minneapolis', 'Nashville', 'New Orleans', 'St Louis', 'Kansas City'],
  'America/Denver': ['USA Mountain', 'US Mountain', 'Salt Lake City', 'Boulder', 'Albuquerque'],
  'America/Phoenix': ['Arizona'],
  'America/Los_Angeles': ['USA Pacific', 'US Pacific', 'California', 'San Francisco', 'Seattle', 'Portland', 'San Diego', 'Las Vegas', 'Sacramento'],
  'America/Anchorage': ['Alaska'],
  'Pacific/Honolulu': ['Hawaii'],
  'America/Toronto': ['Canada Eastern', 'Ottawa', 'Montreal', 'Quebec'],
  'America/Vancouver': ['Canada Pacific', 'British Columbia'],
  'America/Edmonton': ['Calgary', 'Alberta'],
  'America/Halifax': ['Nova Scotia'],
  'America/Mexico_City': ['Mexico'],
  'America/Sao_Paulo': ['Brazil', 'Rio de Janeiro'],
  'America/Buenos_Aires': ['Argentina'],
  'America/Argentina/Buenos_Aires': ['Argentina'],
  'America/Bogota': ['Colombia'],
  'America/Santiago': ['Chile'],
  'America/Lima': ['Peru'],
  'America/Port-au-Prince': ['Haiti'],
  'Asia/Kolkata': ['India', 'Mumbai', 'Delhi', 'New Delhi', 'Bangalore', 'Bengaluru', 'Chennai', 'Hyderabad'],
  'Asia/Calcutta': ['India', 'Mumbai', 'Delhi', 'New Delhi', 'Bangalore', 'Bengaluru', 'Chennai', 'Hyderabad', 'Kolkata'],
  'Asia/Tokyo': ['Japan', 'Osaka', 'Kyoto'],
  'Asia/Shanghai': ['China', 'Beijing', 'Shenzhen', 'Guangzhou'],
  'Asia/Hong_Kong': ['Hong Kong'],
  'Asia/Seoul': ['South Korea', 'Korea'],
  'Asia/Singapore': ['Singapore'],
  'Asia/Manila': ['Philippines'],
  'Asia/Jakarta': ['Indonesia'],
  'Asia/Bangkok': ['Thailand'],
  'Asia/Ho_Chi_Minh': ['Vietnam'],
  'Asia/Saigon': ['Vietnam', 'Ho Chi Minh City'],
  'Asia/Dubai': ['United Arab Emirates', 'UAE', 'Abu Dhabi'],
  'Asia/Jerusalem': ['Israel', 'Tel Aviv'],
  'Europe/Istanbul': ['Turkey', 'Ankara'],
  'Africa/Accra': ['Ghana'],
  'Africa/Lagos': ['Nigeria', 'Abuja'],
  'Africa/Nairobi': ['Kenya'],
  'Africa/Johannesburg': ['South Africa', 'Cape Town'],
  'Africa/Cairo': ['Egypt'],
  'Australia/Sydney': ['Australia Eastern', 'Canberra', 'New South Wales'],
  'Australia/Melbourne': ['Victoria'],
  'Australia/Brisbane': ['Queensland'],
  'Australia/Perth': ['Western Australia'],
  'Pacific/Auckland': ['New Zealand', 'Wellington', 'Christchurch'],
  'UTC': ['Coordinated Universal Time', 'Zulu'],
};
const POPULAR_ZONES = ['Europe/Dublin', 'Europe/London', 'Europe/Warsaw', 'Europe/Berlin', 'Europe/Paris', 'Europe/Amsterdam', 'Europe/Madrid', 'Europe/Rome', 'Europe/Stockholm', 'Europe/Prague', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo', 'Asia/Kolkata', 'Asia/Calcutta', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Australia/Sydney', 'Pacific/Auckland', 'UTC'];

// "GMT-5", "UTC+5:30", "+1" -> a single searchable token like "gmtm5", "gmtp5:30", "gmtp1".
const offsetToken = (s) => String(s).replace(/(?:\b(?:utc|gmt)\s*)?([+\-\u2212])\s*(\d{1,2}(?::\d{2})?)\b/gi, (_, sign, n) => ` gmt${sign === '+' ? 'p' : 'm'}${n} `);
const fold = (s) => offsetToken(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_/,.()-]+/g, ' ').replace(/\s+/g, ' ').trim();

let zoneIndex = null;
function getZoneIndex() {
  if (zoneIndex) return zoneIndex;
  const now = Date.now();
  const nameOf = (tz, style) => {
    try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: style }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value || ''; } catch { return ''; }
  };
  zoneIndex = allZones([detectTz(), 'UTC']).map((tz) => {
    const parts = tz.split('/');
    const city = tz === 'UTC' ? 'UTC' : tzName(parts[parts.length - 1]);
    const region = parts.length > 1 ? tzName(parts.slice(0, -1).join(' / ')) : '';
    const long = nameOf(tz, 'long');
    const short = nameOf(tz, 'short');
    const gmt = gmtLabel(tz, now);
    const aliases = ZONE_ALIASES[tz] || [];
    const pop = POPULAR_ZONES.indexOf(tz);
    return {
      tz, city, region, long, short, gmt, aliases,
      pop: pop === -1 ? 999 : pop,
      fCity: fold(city), fAliases: aliases.map(fold), fLong: fold(long), fShort: fold(short), fGmt: fold(gmt),
      hay: fold([city, region, tz, long, short, gmt, ...aliases].join(' ')),
    };
  });
  return zoneIndex;
}

function searchZones(query) {
  const idx = getZoneIndex();
  const q = fold(String(query).replace(/\butc\b/gi, 'gmt'));
  if (!q) {
    return idx.slice().sort((a, b) => a.pop - b.pop || a.city.localeCompare(b.city)).map((z) => ({ z }));
  }
  const terms = q.split(' ');
  const out = [];
  for (const z of idx) {
    if (!terms.every((t) => z.hay.includes(t))) continue;
    const alias = z.fAliases.findIndex((a) => a === q || a.startsWith(q));
    let score = 6;
    if (z.fCity === q) score = 0;
    else if (alias !== -1 && z.fAliases[alias] === q) score = 1;
    else if (z.fShort === q || z.fGmt === q) score = 2;
    else if (z.fCity.startsWith(q)) score = 3;
    else if (alias !== -1) score = 4;
    else if (z.fLong.startsWith(q) || z.fLong.includes(' ' + q)) score = 5;
    const viaIdx = z.fAliases.findIndex((a) => terms.every((t) => a.includes(t)));
    const via = viaIdx !== -1 && !terms.every((t) => z.fCity.includes(t)) ? z.aliases[viaIdx] : null;
    out.push({ z, score, via });
  }
  return out.sort((a, b) => a.score - b.score || a.z.pop - b.z.pop || a.z.city.localeCompare(b.z.city));
}

const zoneDisplay = (tz) => {
  const z = getZoneIndex().find((x) => x.tz === tz);
  return z ? `${z.city} (${gmtLabel(tz)})` : tzName(tz);
};

let pickerCount = 0;
// A search box for picking a time zone. Calls onChange(tz) when someone picks one.
function tzPicker(host, value, onChange, inputId) {
  const id = `tzp-${++pickerCount}`;
  host.classList.add('tz-picker');
  host.innerHTML = `
    <input type="text" id="${inputId || id + '-input'}" role="combobox" aria-autocomplete="list" aria-expanded="false"
      aria-controls="${id}-list" autocomplete="off" spellcheck="false" placeholder="Type a city, country or time zone">
    <ul class="tz-list" id="${id}-list" role="listbox" hidden></ul>`;
  const input = host.querySelector('input');
  const list = host.querySelector('ul');
  let current = value;
  let results = [];
  let active = -1;
  input.value = zoneDisplay(current);

  const timeIn = (tz) => { try { return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date()); } catch { return ''; } };

  function render() {
    const shown = results.slice(0, 60);
    if (!shown.length) {
      list.innerHTML = '<li class="tz-empty">No matching time zones. Try a nearby big city, like Lisbon or Chicago.</li>';
    } else {
      list.innerHTML = shown.map(({ z, via }, i) => `
        <li role="option" id="${id}-o${i}" data-i="${i}" class="tz-opt${i === active ? ' active' : ''}" aria-selected="${z.tz === current}">
          <span class="tz-main">
            <strong>${esc(z.city)}</strong>
            <span class="tz-sub">${esc(via ? `${via} uses this time zone. ` : '')}${esc(z.long || z.region)} (${esc(z.gmt)})</span>
          </span>
          <span class="tz-now">${esc(timeIn(z.tz))}</span>
        </li>`).join('');
    }
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `${id}-o${active}`);
      const el = list.querySelector('.tz-opt.active');
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function open(q) {
    results = searchZones(q);
    active = q ? (results.length ? 0 : -1) : Math.max(0, results.findIndex((r) => r.z.tz === current));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    render();
  }
  function close(restore = true) {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (restore) input.value = zoneDisplay(current);
  }
  function choose(i) {
    const r = results[i];
    if (!r) return;
    current = r.z.tz;
    close();
    onChange(current);
  }

  input.addEventListener('focus', () => { input.select(); open(''); });
  input.addEventListener('click', () => { if (list.hidden) open(''); });
  input.addEventListener('input', () => open(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) { open(''); return; }
      const n = Math.min(results.length, 60);
      if (!n) return;
      active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
      render();
    } else if (e.key === 'Enter') {
      if (!list.hidden) { e.preventDefault(); choose(active); }
    } else if (e.key === 'Escape') {
      if (!list.hidden) { e.preventDefault(); close(); input.select(); }
    }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 120));
  list.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the box
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.tz-opt');
    if (li) choose(+li.dataset.i);
  });

  return { set(tz) { current = tz; input.value = zoneDisplay(tz); } };
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
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const q = encodeURIComponent;
  const fromRow = (r) => ({ id: r.id, name: r.name, tz: r.tz, slots: (r.slots || []).map(Number), updatedAt: r.updated_at });

  const pollArgs = (p) => ({ p_title: p.title, p_tz: p.tz, p_dates: p.dates, p_start: p.startMin, p_end: p.endMin, p_step: p.step, p_slots: p.slots });
  const rpc = (fn, body) => call(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });
  const missingSetup = (err) => err.status === 404 || /function|schema cache/i.test(err.message);

  return {
    mode: 'supabase',
    async createPoll(id, p, key) {
      try {
        await rpc('create_poll', { p_id: id, ...pollArgs(p), p_key: key });
      } catch (err) {
        if (missingSetup(err)) throw new Error('the database needs updating. Run supabase-setup.sql again in Supabase');
        throw err;
      }
    },
    async updatePoll(id, p, key) { await rpc('update_poll', { p_id: id, ...pollArgs(p), p_key: key }); },
    async deletePoll(id, key) { await rpc('delete_poll', { p_id: id, p_key: key }); },
    async checkKey(id, key) {
      try { return (await rpc('can_manage_poll', { p_id: id, p_key: key })) === true; } catch (err) {
        if (missingSetup(err)) throw new Error('the database needs updating. Run supabase-setup.sql again in Supabase');
        throw err;
      }
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
    async updatePoll(id, p) {
      const all = ls.get('findatime:polls', {});
      if (!all[id]) throw new Error('this poll no longer exists');
      all[id] = { ...all[id], ...p };
      ls.set('findatime:polls', all);
    },
    async deletePoll(id) {
      const all = ls.get('findatime:polls', {});
      delete all[id];
      ls.set('findatime:polls', all);
      ls.del(rkey(id));
    },
    async checkKey() { return true; }, // demo mode: everything is on this device anyway
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
// `startAt` (minutes) forces where each column's day begins, e.g. the start of the viewer's chosen hours.
function buildLayout(slots, tz, step, startAt = null) {
  const local = slots.map((ms) => { const p = partsIn(ms, tz); return { ms, key: keyOf(p), tod: p.h * 60 + p.min }; });
  const tods = [...new Set(local.map((s) => s.tod))].sort((a, b) => a - b);
  let dayStart = 0;
  if (startAt != null) dayStart = startAt;
  else if (tods.length > 1) {
    let best = -1, bestIdx = tods.length - 1;
    tods.forEach((t, i) => {
      const gap = i < tods.length - 1 ? tods[i + 1] - t : tods[0] + 1440 - t;
      if (gap > best) { best = gap; bestIdx = i; }
    });
    // Only shift the day for a real overnight break; near round-the-clock polls use plain calendar days.
    dayStart = best >= 180 ? tods[(bestIdx + 1) % tods.length] : 0;
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
  // Mark columns that don't follow straight on from the day before.
  const dayNum = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const gapBefore = cols.map((k, i) => i > 0 && dayNum(k) - dayNum(cols[i - 1]) > 1);
  return { cols, rows, ms, pos, step, dayStart, gapBefore };
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
    time: `${fmtTime(aMin)} – ${bMin === 0 ? 'midnight' : fmtTime(bMin)}${nextDay ? ' (next day)' : ''}`,
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
function newKey() {
  return [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// The creator's manage key for a poll, or the site admin password, if this browser has one.
const pollKey = (id) => ls.get('findatime:key:' + id, null);
const manageKey = (id) => pollKey(id) || ls.get('findatime:admin', null);
function forgetPoll(id) {
  ls.del('findatime:key:' + id);
  ls.del('findatime:me:' + id);
  ls.set('findatime:recent', ls.get('findatime:recent', []).filter((r) => r.id !== id));
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

// `edit` is { id, poll, key } when editing an existing poll.
function showCreate(store, edit = null) {
  const poll = edit && edit.poll;
  const tz = poll ? poll.tz : detectTz();
  const now = partsIn(Date.now(), tz);
  const todayKey = keyOf(now);
  const selected = new Set(poll ? poll.dates : []);
  const firstSel = [...selected].sort()[0];
  const minMonth = firstSel && firstSel < todayKey
    ? { y: +firstSel.slice(0, 4), m: +firstSel.slice(5, 7) }
    : { y: now.y, m: now.m };
  let month = firstSel ? { y: +firstSel.slice(0, 4), m: +firstSel.slice(5, 7) } : { y: now.y, m: now.m };
  if (month.y * 12 + month.m < minMonth.y * 12 + minMonth.m) month = { ...minMonth };

  const startSel = poll ? poll.startMin : 540;
  const endSel = poll ? (poll.endMin > 1440 ? poll.endMin - 1440 : poll.endMin) : 1260;
  const stepSel = poll ? poll.step : 30;

  const hourOpts = (from, to, sel) => {
    let h = '';
    for (let t = from; t <= to; t += 30) h += `<option value="${t}"${t === sel ? ' selected' : ''}>${t === 1440 ? 'Midnight' : fmtTime(t)}</option>`;
    return h;
  };
  const stepOpts = [[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour']]
    .map(([v, l]) => `<option value="${v}"${v === stepSel ? ' selected' : ''}>${l}</option>`).join('');
  const recent = edit ? [] : ls.get('findatime:recent', []);

  app.innerHTML = `
    <section class="create">
      <div class="create-intro">
        ${edit
          ? `<h1>Edit poll</h1>
             <p class="lede">Changes show up for everyone straight away. People's answers are kept for any times still in the poll.</p>
             <p><a href="?poll=${esc(edit.id)}">Back to the poll</a></p>`
          : `<h1>Find a time that works for everyone</h1>
             <p class="lede">Pick the days and hours you're considering. Everyone marks when they're free, and each person sees the times in their own time zone.</p>`}
      </div>
      <form class="card create-form" novalidate>
        <label class="field">
          <span>What's it for?</span>
          <input name="title" maxlength="100" placeholder="Session planning" autocomplete="off" required value="${poll ? esc(poll.title) : ''}">
        </label>

        <fieldset class="field">
          <legend>Which days?</legend>
          <div class="cal" aria-label="Choose dates"></div>
          <p class="hint"><span class="date-count"></span> Click or drag across days to pick them. They don't need to be next to each other.</p>
        </fieldset>

        <div class="field-row">
          <label class="field"><span>From</span><select name="start">${hourOpts(0, 1410, startSel)}</select></label>
          <label class="field"><span>Until</span><select name="end">${hourOpts(30, 1440, endSel)}</select></label>
          <label class="field"><span>Slots of</span><select name="step">${stepOpts}</select></label>
        </div>
        <p class="hint overnight" hidden>The end time is before the start, so each day runs past midnight.</p>
        <p class="hint step-warning" hidden>Changing the slot length means people who already answered will need to mark their times again.</p>

        <div class="field">
          <label for="create-tz">Those hours are in</label>
          <div class="tz-host"></div>
          <input type="hidden" name="tz" value="${esc(tz)}">
        </div>

        <p class="form-error" role="alert" hidden></p>
        <button class="btn primary" type="submit">${edit ? 'Save changes' : 'Create poll'}</button>

        ${edit ? `
          <div class="manage-extra">
            ${pollKey(edit.id) ? `
              <div>
                <button type="button" class="link-btn" data-act="copy-manage">Copy manage link</button>
                <p class="hint">Anyone with the manage link can edit or delete this poll. Use it to manage the poll from another device.</p>
              </div>` : ''}
            <div>
              <button type="button" class="link-btn danger" data-act="delete">Delete this poll</button>
              <p class="hint">Deletes the poll and everyone's answers. This can't be undone.</p>
            </div>
          </div>` : ''}
      </form>
      ${recent.length ? `
        <aside class="recent">
          <h2>Your recent polls</h2>
          <ul>${recent.map((r) => `
            <li>
              <a href="?poll=${esc(r.id)}">${esc(r.title)}</a>
              ${manageKey(r.id) ? `<a class="recent-edit" href="?poll=${esc(r.id)}&amp;edit=1">Edit</a>` : ''}
            </li>`).join('')}</ul>
        </aside>` : ''}
    </section>`;

  const form = app.querySelector('form');
  const cal = app.querySelector('.cal');
  const countEl = app.querySelector('.date-count');
  const errEl = app.querySelector('.form-error');
  const overnightEl = app.querySelector('.overnight');
  const stepWarn = app.querySelector('.step-warning');
  tzPicker(app.querySelector('.create-form .tz-host'), tz, (z) => { form.tz.value = z; }, 'create-tz');

  const updateCount = () => {
    countEl.textContent = selected.size ? `${selected.size} day${selected.size === 1 ? '' : 's'} picked.` : 'No days picked yet.';
  };
  const updateOvernight = () => { overnightEl.hidden = +form.end.value > +form.start.value; };
  form.start.addEventListener('change', updateOvernight);
  form.end.addEventListener('change', updateOvernight);
  form.step.addEventListener('change', () => { stepWarn.hidden = !edit || +form.step.value === poll.step; });
  updateCount();
  updateOvernight();

  function renderCal() {
    const { y, m } = month;
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const atStart = y * 12 + m <= minMonth.y * 12 + minMonth.m;
    const wk = [];
    for (let i = 0; i < 7; i++) wk.push(fmtDay(`2024-01-${pad(1 + i)}`, { weekday: 'short' })); // 1 Jan 2024 was a Monday
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const k = `${y}-${pad(m)}-${pad(d)}`;
      const off = k < todayKey && !selected.has(k);
      cells += `<button type="button" class="day${selected.has(k) ? ' on' : ''}${k === todayKey ? ' today' : ''}" data-key="${k}" ${off ? 'disabled' : ''} aria-pressed="${selected.has(k)}">${d}</button>`;
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
      let { y, m } = month;
      m += +nav.dataset.nav;
      if (m < 1) { m = 12; y--; }
      if (m > 12) { m = 1; y++; }
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

  const fail = (msg) => { errEl.textContent = msg; errEl.hidden = false; };

  if (edit) {
    let armed = false;
    app.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'copy-manage') {
        const url = new URL(location.href);
        url.search = `?poll=${edit.id}&key=${pollKey(edit.id)}`;
        try { await navigator.clipboard.writeText(url.href); act.textContent = 'Manage link copied'; } catch { window.prompt('Copy your manage link:', url.href); }
        setTimeout(() => { act.textContent = 'Copy manage link'; }, 2000);
      }
      if (act.dataset.act === 'delete') {
        if (!armed) {
          armed = true;
          act.textContent = 'Click again to delete the poll and all answers';
          setTimeout(() => { armed = false; if (act.isConnected) act.textContent = 'Delete this poll'; }, 5000);
          return;
        }
        act.disabled = true;
        act.textContent = 'Deleting…';
        try {
          await store.deletePoll(edit.id, edit.key);
          forgetPoll(edit.id);
          location.href = './';
        } catch (err) {
          console.error(err);
          act.disabled = false;
          act.textContent = 'Delete this poll';
          fail(`The poll wasn't deleted: ${err.message}.`);
        }
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
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
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = edit ? 'Saving…' : 'Creating poll…';
    const data = { title, tz: zone, dates, startMin: start, endMin: end, step, slots };
    try {
      if (edit) {
        await store.updatePoll(edit.id, data, edit.key);
        addRecent(edit.id, title);
        location.href = `?poll=${edit.id}`;
      } else {
        const id = newId();
        const key = newKey();
        await store.createPoll(id, { ...data, createdAt: Date.now() }, key);
        ls.set('findatime:key:' + id, key);
        addRecent(id, title);
        location.href = `?poll=${id}`;
      }
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = label;
      fail(`${edit ? "The changes weren't saved" : "The poll wasn't created"}: ${err.message}.`);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Edit a poll: check this browser can manage it first                 */
/* ------------------------------------------------------------------ */

async function showEdit(store, id) {
  app.innerHTML = '<p class="loading">Loading poll…</p>';
  let poll;
  try { poll = await store.getPoll(id); } catch (err) {
    app.innerHTML = messageView("This poll didn't load", `The database said: ${esc(err.message)}. Check your connection and reload the page.`);
    return;
  }
  if (!poll) {
    forgetPoll(id);
    app.innerHTML = messageView('There is no poll at this link', 'It may have been deleted. <a href="./">Create a new poll</a>.');
    return;
  }
  const key = manageKey(id);
  if (!key) { location.href = `?poll=${id}`; return; }
  document.title = `Edit ${poll.title} | ${SITE}`;
  showCreate(store, { id, poll, key });
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
    forgetPoll(id);
    app.innerHTML = messageView('There is no poll at this link', 'It may have been deleted. Check the link you were sent, or <a href="./">create a new poll</a>.');
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
    hours: ls.get('findatime:hours:' + id, null), // { from, to } in the viewer's own clock, minutes
    answeredOnly: ls.get('findatime:answered:' + id, false),
    mineRows: new Set(),
  };

  app.innerHTML = `
    <section class="poll">
      <div class="poll-head">
        <h1 class="poll-title">${esc(poll.title)}</h1>
        <div class="head-actions">
          <button class="btn" type="button" data-act="copy">Copy link</button>
          <button class="btn" type="button" data-act="edit">Edit poll</button>
        </div>
      </div>
      <form class="unlock card" hidden>
        <label class="field">
          <span>Enter the admin password to edit this poll</span>
          <input type="password" name="pw" autocomplete="current-password">
        </label>
        <div class="unlock-actions">
          <button class="btn primary" type="submit">Unlock</button>
          <button class="link-btn" type="button" data-act="unlock-cancel">Cancel</button>
        </div>
        <p class="hint">If you created this poll on another device, open the manage link you copied there instead.</p>
        <p class="form-error" role="alert" hidden></p>
      </form>
      <div class="tzline">
        <label for="tz-input">Showing times in</label>
        <div class="tz-host"></div>
        <span class="tz-note"></span>
      </div>
      <div class="hours-line">
        <label for="hours-from">Show</label>
        <select id="hours-from" aria-label="Show hours from"></select>
        <span>to</span>
        <select id="hours-to" aria-label="Show hours until"></select>
        <span class="hours-note"></span>
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
          <label class="toggle"><input type="checkbox" class="answered-only"${S.answeredOnly ? ' checked' : ''}> Only show hours someone can make</label>
          <div class="grid-wrap"><div class="grid group-grid"></div></div>
          <p class="grid-empty group-empty" hidden></p>
        </section>

        <aside class="side">
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
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  tip.setAttribute('role', 'status');
  document.body.appendChild(tip);

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

  /* ---- which rows and days each grid shows ---- */
  const realTod = (r) => (S.L.rows[r] + S.L.dayStart) % 1440;
  function inHours(t) {
    const h = S.hours;
    if (!h || (h.from === 0 && h.to === 1440)) return true;
    return h.from < h.to ? t >= h.from && t < h.to : t >= h.from || t < h.to;
  }
  // Rows (by index into S.L.rows) and columns a grid should show.
  function visible(kind, counts) {
    const L = S.L;
    let R = L.rows.map((_, r) => r).filter((r) => inHours(realTod(r)));
    if (kind === 'group' && S.answeredOnly && counts) R = R.filter((r) => L.ms[r].some((ms) => ms != null && counts.get(ms) > 0));
    const C = L.cols.map((_, c) => c).filter((c) => R.some((r) => L.ms[r][c] != null));
    return { R, C };
  }
  const dayNum = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const gapsFor = (C) => C.map((c, i) => i > 0 && dayNum(S.L.cols[c]) - dayNum(S.L.cols[C[i - 1]]) > 1);

  /* ---- grid markup shared by both grids ---- */
  function gridHtml(kind, R, C) {
    const L = S.L;
    const gaps = gapsFor(C);
    let h = '<div class="corner"></div>';
    C.forEach((c, i) => {
      if (gaps[i]) h += '<div class="day-gap head" aria-hidden="true"></div>';
      const col = L.cols[c];
      h += `<div class="colhead"><span class="dow">${esc(fmtDay(col, { weekday: 'short' }))}</span><span class="dom">${esc(fmtDay(col, { day: 'numeric', month: 'short' }))}</span></div>`;
    });
    let anchor = L.rows[R[0]];
    R.forEach((r, i) => {
      const off = L.rows[r];
      if (i > 0 && off - L.rows[R[i - 1]] > S.step) {
        h += '<div class="gap" aria-hidden="true"></div>';
        anchor = off;
      }
      const tod = (off + L.dayStart) % 1440;
      const nextDay = off + L.dayStart >= 1440;
      const label = (off - anchor) % 60 === 0 ? fmtTime(tod) : '';
      const hourEnd = (off + S.step - anchor) % 60 === 0;
      h += `<div class="tl${nextDay && label ? ' next' : ''}"${nextDay && label ? ' title="Next day"' : ''}>${esc(label)}</div>`;
      C.forEach((c, j) => {
        if (gaps[j]) h += '<div class="day-gap" aria-hidden="true"></div>';
        if (L.ms[r][c] == null) { h += '<div class="cell off" aria-hidden="true"></div>'; return; }
        const realDay = nextDay ? keyOf(partsIn(L.ms[r][c], S.tz)) : L.cols[c];
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
  // Column tracks, plus a row height that keeps long polls from getting huge.
  function sizeGrid(grid, R, C) {
    const tracks = ['var(--tl-w)'];
    gapsFor(C).forEach((g) => {
      if (g) tracks.push('var(--day-gap)');
      tracks.push('minmax(var(--cell-min), 1fr)');
    });
    grid.style.gridTemplateColumns = tracks.join(' ');
    const base = ({ 15: 1.2, 30: 1.75, 60: 2.6 })[S.step] || 1.75;
    const h = Math.max(1.15, Math.min(base, 38 / Math.max(R.length, 1)));
    grid.style.setProperty('--cell-h', `${h.toFixed(2)}rem`);
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
      <p class="hint">Mark each day separately: drag up or down a day to highlight the times you're free, or tap a single slot. Drag over highlighted times to clear them.</p>
      <div class="grid-wrap"><div class="grid mine-grid"></div></div>
      <div class="mine-foot">
        <span class="save-status" aria-live="polite"></span>
        <button type="button" class="link-btn danger" data-act="remove">Remove my response</button>
      </div>`;
    const grid = mineBody.querySelector('.mine-grid');
    const { R, C } = visible('mine');
    S.mineRows = new Set(R);
    if (!R.length) {
      grid.outerHTML = '<p class="grid-empty">None of this poll\'s times fall within the hours you\'re showing. <button type="button" class="link-btn" data-act="hours-all">Show all hours</button></p>';
      S.mineEls = [];
      return;
    }
    sizeGrid(grid, R, C);
    grid.innerHTML = gridHtml('mine', R, C);
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
      // Each drag stays in the day it started on: only the time moves.
      const r = +cell.dataset.r;
      if (r === drag.r1) return;
      drag.r1 = r;
      paintMine(rect());
    });
    const finish = () => {
      if (!drag) return;
      const R = rect();
      for (let r = R.rMin; r <= R.rMax; r++) for (let c = R.cMin; c <= R.cMax; c++) {
        if (!S.mineRows.has(r)) continue; // skip hours that are hidden
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
    const counts = new Map(S.slots.map((ms) => [ms, P.reduce((a, p) => a + (p.set.has(ms) ? 1 : 0), 0)]));
    const { R, C } = visible('group', counts);
    const sig = `${S.tz}|${R.join(',')}|${C.join(',')}`;
    if (groupGrid.dataset.sig !== sig) {
      groupGrid.dataset.sig = sig;
      hideTip();
      S.groupByMs = new Map();
      S.groupEls = [];
      const empty = $('.group-empty');
      if (!R.length) {
        groupGrid.innerHTML = '';
        groupGrid.style.gridTemplateColumns = '';
        empty.innerHTML = S.answeredOnly && N === 0
          ? 'Nobody has added their times yet.'
          : S.answeredOnly
            ? 'Nobody can make any of the hours you\'re showing. <button type="button" class="link-btn" data-act="answered-off">Show every hour</button>'
            : 'None of this poll\'s times fall within the hours you\'re showing. <button type="button" class="link-btn" data-act="hours-all">Show all hours</button>';
        empty.hidden = false;
      } else {
        empty.hidden = true;
        sizeGrid(groupGrid, R, C);
        groupGrid.innerHTML = gridHtml('group', R, C);
        S.groupEls = collect(groupGrid);
        S.groupEls.forEach((row, r) => row.forEach((el, c) => { if (el) S.groupByMs.set(S.L.ms[r][c], el); }));
      }
      if (!groupGrid.dataset.wired) { wireGroupGrid(); groupGrid.dataset.wired = '1'; }
    }
    for (const [ms, el] of S.groupByMs) {
      const n = counts.get(ms) || 0;
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
    const msOf = (cell) => S.L.ms[+cell.dataset.r][+cell.dataset.c];
    groupGrid.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const cell = e.target.closest('.cell[data-r]');
      if (!cell) { hideTip(); return; }
      showTip(msOf(cell), { x: e.clientX, y: e.clientY });
    });
    groupGrid.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
    groupGrid.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell[data-r]');
      if (!cell) return;
      if (S.hover === msOf(cell) && !tip.hidden && e.detail !== 0) { hideTip(); return; }
      showTip(msOf(cell), { el: cell });
    });
    groupGrid.addEventListener('focusin', (e) => {
      const cell = e.target.closest('.cell[data-r]');
      if (cell && cell.matches(':focus-visible')) showTip(msOf(cell), { el: cell });
    });
    groupGrid.addEventListener('focusout', () => hideTip());
    groupGrid.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); else gridKeys(e, S.groupEls); });
    document.addEventListener('pointerdown', (e) => { if (!groupGrid.contains(e.target)) hideTip(); });
    window.addEventListener('scroll', () => { if (S.tipAt && S.tipAt.el) hideTip(); }, { passive: true });
  }

  function tipHtml() {
    const P = people();
    const N = P.length;
    const lbl = rangeLabel(S.hover, S.hover + S.step * 60000, S.tz);
    const yes = P.filter((p) => p.set.has(S.hover));
    const no = P.filter((p) => !p.set.has(S.hover));
    const list = (arr) => arr.map((p) => `<li>${esc(p.name)}</li>`).join('') || '<li class="none">Nobody</li>';
    return `
      <p class="tip-when"><span>${esc(lbl.day)}</span> <strong>${esc(lbl.time)}</strong></p>
      ${N ? `<p class="tip-count">${yes.length} of ${N} can make it</p>
      <div class="tip-cols">
        <div><h3>Free</h3><ul>${list(yes)}</ul></div>
        <div><h3>Not free</h3><ul>${list(no)}</ul></div>
      </div>` : '<p class="tip-count">Nobody has answered yet</p>'}`;
  }
  function showTip(ms, at) {
    S.hover = ms;
    S.tipAt = at;
    tip.innerHTML = tipHtml();
    tip.hidden = false;
    let x, y;
    if (at.el) { const r = at.el.getBoundingClientRect(); x = r.right; y = r.top; }
    else { x = at.x; y = at.y; }
    const w = tip.offsetWidth, h = tip.offsetHeight, pad = 8, off = at.el ? 6 : 16;
    let left = x + off, top = y + (at.el ? 0 : off);
    if (left + w > innerWidth - pad) left = (at.el ? at.el.getBoundingClientRect().left : x) - w - off;
    if (top + h > innerHeight - pad) top = innerHeight - h - pad;
    tip.style.left = `${Math.max(pad, left)}px`;
    tip.style.top = `${Math.max(pad, top)}px`;
  }
  function hideTip() { tip.hidden = true; S.hover = null; S.tipAt = null; }
  function refreshTip() { if (!tip.hidden && S.hover != null) tip.innerHTML = tipHtml(); }

  function renderSide(P) {
    refreshTip();
    const N = P.length;
    const best = bestTimes(S.slots, P, S.step);
    const bestEl = $('.best');
    if (!N) {
      bestEl.innerHTML = '<li class="best-empty">Nobody has added their times yet. Copy the link and send it to your group, and the best times will show up here.</li>';
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
    const detected = detectTz();
    $('.tz-note').innerHTML = [
      S.tz !== poll.tz ? `The poll was set up in ${esc(zoneDisplay(poll.tz))}.` : '',
      S.tz !== detected ? `<button type="button" class="link-btn" data-act="tz-mine">Use my time zone (${esc(zoneDisplay(detected))})</button>` : '',
    ].filter(Boolean).join(' ');
    renderHours();
    relayout();
    delete groupGrid.dataset.sig;
    renderMine();
    renderGroup();
  }

  /* ---- which hours to show ---- */
  // Nobody has chosen yet: long polls start on 7:00 to midnight in your own time.
  function effectiveHours() {
    if (S.hours) return S.hours;
    const spanH = (S.L.rows.length * S.step) / 60;
    return spanH > 16 ? { from: 420, to: 1440, auto: true } : { from: 0, to: 1440 };
  }
  function renderHours() {
    S.hours = effectiveHours();
    const from = $('#hours-from'), to = $('#hours-to');
    let fo = '', to_ = '';
    for (let t = 0; t < 1440; t += 60) fo += `<option value="${t}"${t === S.hours.from ? ' selected' : ''}>${fmtTime(t)}</option>`;
    for (let t = 60; t <= 1440; t += 60) to_ += `<option value="${t}"${t === S.hours.to ? ' selected' : ''}>${t === 1440 ? 'Midnight' : fmtTime(t)}</option>`;
    from.innerHTML = fo;
    to.innerHTML = to_;
    const shown = S.L.rows.filter((_, r) => inHours(realTod(r))).length;
    const hidden = ((S.L.rows.length - shown) * S.step) / 60;
    const fmtH = (h) => `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? '' : 's'}`;
    $('.hours-note').innerHTML = hidden > 0
      ? `${S.hours.auto ? 'This poll runs long, so hours outside your day are hidden' : `${fmtH(hidden)} of the poll hidden`}. <button type="button" class="link-btn" data-act="hours-all">Show all hours</button>`
      : 'in your time';
  }
  function relayout() {
    const h = S.hours;
    const filtered = h && !(h.from === 0 && h.to === 1440);
    S.L = buildLayout(S.slots, S.tz, S.step, filtered ? h.from : null);
  }
  function setHours(h) {
    S.hours = h;
    ls.set('findatime:hours:' + id, h);
    relayout();
    renderHours();
    delete groupGrid.dataset.sig;
    renderMine();
    renderGroup();
  }
  const readHours = () => ({ from: +$('#hours-from').value, to: +$('#hours-to').value });
  $('#hours-from').addEventListener('change', () => setHours(readHours()));
  $('#hours-to').addEventListener('change', () => setHours(readHours()));
  $('.answered-only').addEventListener('change', (e) => {
    S.answeredOnly = e.target.checked;
    ls.set('findatime:answered:' + id, S.answeredOnly);
    renderGroup();
  });
  function setTz(z) {
    S.tz = z;
    ls.set('findatime:tz', S.tz);
    picker.set(z);
    applyTz();
    if (S.me && S.mineLoaded && S.responses.some((r) => r.id === S.me.key)) save(); // keep their listed zone current
  }
  const picker = tzPicker($('.tzline .tz-host'), S.tz, setTz, 'tz-input');

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
    if (a === 'edit') {
      if (manageKey(id)) { location.href = `?poll=${id}&edit=1`; return; }
      const f = $('.unlock');
      f.hidden = false;
      f.pw.focus();
    }
    if (a === 'tz-mine') setTz(detectTz());
    if (a === 'hours-all') setHours({ from: 0, to: 1440 });
    if (a === 'answered-off') { $('.answered-only').checked = false; S.answeredOnly = false; ls.set('findatime:answered:' + id, false); renderGroup(); }
    if (a === 'unlock-cancel') $('.unlock').hidden = true;
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

  $('.unlock').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const err = f.querySelector('.form-error');
    const pw = f.pw.value;
    if (!pw) return;
    err.hidden = true;
    try {
      if (await store.checkKey(id, pw)) {
        ls.set('findatime:admin', pw);
        location.href = `?poll=${id}&edit=1`;
      } else {
        err.textContent = "That password doesn't work for this poll.";
        err.hidden = false;
      }
    } catch (ex) {
      err.textContent = `Couldn't check the password: ${ex.message}.`;
      err.hidden = false;
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
      $('.best').innerHTML = `<li class="best-empty error">Couldn't load answers: ${esc(err.message)}</li>`;
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
  const params = new URLSearchParams(location.search);
  const id = (params.get('poll') || '').trim();
  if (id && params.get('key')) {
    // Opened from a manage link: remember the key on this device, then tidy the address bar.
    ls.set('findatime:key:' + id, params.get('key'));
    history.replaceState(null, '', `?poll=${encodeURIComponent(id)}&edit=1`);
    await showEdit(store, id);
  } else if (id && params.get('edit')) await showEdit(store, id);
  else if (id) await showPoll(store, id);
  else showCreate(store);
}

main();
