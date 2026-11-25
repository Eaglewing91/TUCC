// ==UserScript==
// @name         TUCC War Room
// @namespace    eaglewing.torn.tucc.warroom
// @version      1.1.0
// @description  Ranked war overview: enemy members by status with hospital timers, who is out next, both chains, and an optional chain-timeout alert. Names are plain links to attack pages that you click yourself. API only (Public key).
// @author       Eaglewing [571041]
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
 * Compliance notes
 * - Reads only the Torn API (api.torn.com) through TUCC's shared engine. No clicks, submits or
 *   requests to torn.com; attack links are ordinary links you click (one click = one page load).
 * - Refreshes every 30s only while the window is open. Chain watch (off by default, your switch)
 *   checks your own faction's chain every 30s while a Torn tab is visible.
 * - Stores only settings (filter, chain watch, a typed enemy faction ID, the stats column switch and sort) locally.
 * - Optional "BSP stats" column (your switch, off by default, offered only if Battle Stats Predictor is set up in this
 *   browser): shows the predictions and spies that BSP by TDup has already saved on this device. Read only. War Room
 *   makes no request to BSP's server or any other site for it, does not read or send your BSP key, keeps no copy of the
 *   figures, and includes none of BSP's code. BSP's own terms: https://www.torn.com/forums.php#/p=threads&f=67&t=16290324
 */

if (typeof tucc === 'undefined' || !tucc) return;
const { esc, fmt } = tucc;
const S = { filter: GM_getValue('filter', 'all'), chainWatch: !!GM_getValue('chainWatch', false), enemyManual: GM_getValue('enemyManual', ''), bsp: !!GM_getValue('bsp', false), bspSort: GM_getValue('bspSort', '') };
const save = () => { GM_setValue('filter', S.filter); GM_setValue('chainWatch', S.chainWatch); GM_setValue('enemyManual', S.enemyManual); GM_setValue('bsp', S.bsp); GM_setValue('bspSort', S.bspSort); };

/* ---------- predicted battle stats, from Battle Stats Predictor's own saved data on this device (read only) ---------- */
const BSP = 'tdup.battleStatsPredictor.', BSP_LINK = 'https://www.torn.com/forums.php#/p=threads&f=67&t=16290324';
const ls = (k) => { try { const v = (typeof localStorage !== 'undefined' ? localStorage : window.localStorage).getItem(k); return v == null ? undefined : v; } catch (e) { return undefined; } };
const lsJson = (k) => { const v = ls(k); if (!v || v === '[object Object]') return null; try { return JSON.parse(v); } catch (e) { return null; } };
// Is BSP set up in this browser? Only checks that its "key is valid" flag exists; the key itself is never read.
const bspHere = () => ls(BSP + 'IsPrimaryAPIKeyValid') !== undefined;
// The figure BSP would show for this player: a recent spy first, else its prediction while BSP still treats it as current (5 days).
function bspOf(id) {
  let spy = null;
  for (const src of ['tornstats_', 'yata_']) { const o = lsJson(BSP + 'cache.spy_v2.' + src + id); if (o && Number(o.total) > 0 && (!spy || Number(o.timestamp) >= Number(spy.timestamp))) spy = o; }
  const spyAt = spy ? Number(spy.timestamp) * 1000 : 0, keep = (parseInt(ls(BSP + 'DaysToUseTornStatsSpy'), 10) || 30) * 86400000;
  if (spy && spyAt > Date.now() - keep) return { total: Number(spy.total), at: spyAt, spy: true };
  const p = lsJson(BSP + 'cache.prediction.' + id);
  if (!p || p.Result === 0 || p.Result === 4) return null;
  const at = Date.parse(p.DateFetched || p.PredictionDate || '') || 0;
  if (!at || at < Date.now() - 5 * 86400000) return null;
  const tbs = parseInt(String(p.TBS == null ? '' : p.TBS).replace(/[^\d.]/g, ''), 10);
  if (!(tbs > 0)) return null;
  return spy && Number(spy.total) > tbs ? { total: Number(spy.total), at: spyAt, spy: true } : { total: tbs, at };
}
const myTotal = () => { const o = lsJson(BSP + 'playerBattleStats'); if (!o) return 0; const t = Number(o.TBS) || [o.Str, o.Def, o.Spd, o.Dex].reduce((a, v) => a + (Number(v) || 0), 0); return t > 0 ? t : 0; };
const short = (n) => (n >= 1e12 ? (n / 1e12).toFixed(2) + 't' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'b' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'm' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)));
function statCell(b, mine) {
  if (!b) return '<span class="muted">–</span>';
  const r = mine ? b.total / mine : 0, cls = !mine ? '' : r <= 0.75 ? 'good' : r <= 1.25 ? 'warn' : 'bad';
  const days = Math.floor((Date.now() - b.at) / 86400000);
  return `<span class="${cls}" title="${b.spy ? 'Spy' : 'Prediction'}, ${days ? days + 'd old' : 'today'}">${short(b.total)}${b.spy ? ' <span class="muted">S</span>' : ''}</span>`;
}

let own = null;          // { id, name }
let data = { war: null, enemy: null, members: [], ourChain: null, theirChain: null, at: 0, error: '' };
const nowS = () => Math.floor(Date.now() / 1000);

const w = tucc.ui.window('warroom', 'War Room', 'ranked war overview');
w.body.addEventListener('click', onClick);
w.body.addEventListener('change', onChange);

async function ownFaction() {
  if (own) return own;
  const j = await tucc.api('/v2/faction/basic', {}, { ttl: 3600 });
  const b = (j && j.basic) || {};
  if (!b.id) throw new Error('You are not in a faction (or the key cannot see it).');
  own = { id: Number(b.id), name: b.name || 'Your faction' };
  return own;
}

async function load() {
  try {
    const me = await ownFaction();
    let war = null, enemy = null;
    try {
      const wj = await tucc.api(`/v2/faction/${me.id}/wars`, {}, { ttl: 60 });
      const r = wj && wj.wars && wj.wars.ranked;
      if (r && Array.isArray(r.factions) && !(r.end && r.end < nowS() && r.winner)) {
        war = r;
        const e = r.factions.find((f) => Number(f.id) !== me.id);
        if (e) enemy = { id: Number(e.id), name: e.name || ('Faction ' + e.id) };
      }
    } catch (e) { if (e.code === 'nokey') throw e; }
    if (!enemy && /^\d+$/.test(String(S.enemyManual))) enemy = { id: Number(S.enemyManual), name: 'Faction ' + S.enemyManual, manual: true };
    const jobs = [tucc.api(`/v2/faction/${me.id}/chain`, {}, { ttl: 20 }).catch(() => null)];
    if (enemy) {
      jobs.push(tucc.api(`/v2/faction/${enemy.id}/members`, {}, { ttl: 20 }).catch((e) => ({ __err: e })));
      jobs.push(tucc.api(`/v2/faction/${enemy.id}/chain`, {}, { ttl: 20 }).catch(() => null));
    }
    const [oc, mj, tc] = await Promise.all(jobs);
    data = { war, enemy, members: [], ourChain: oc && oc.chain, theirChain: tc && tc.chain, at: Date.now(), error: '' };
    if (mj && mj.__err) data.error = mj.__err.message;
    else if (mj) {
      const list = Array.isArray(mj.members) ? mj.members : Object.entries(mj.members || {}).map(([id, m]) => Object.assign({ id: Number(id) }, m));
      data.members = list.filter((m) => m && m.id);
    }
  } catch (e) {
    data = Object.assign({}, data, { error: e.code === 'nokey' ? 'Add a key in the API Keys app. A Public key is enough.' : e.message, at: Date.now() });
  }
  render();
}

const stateOf = (m) => String((m.status && m.status.state) || 'Okay').toLowerCase();
const online = (m) => String((m.last_action && m.last_action.status) || '').toLowerCase();
function group(m) {
  const s = stateOf(m);
  if (s === 'okay') return 'okay';
  if (s === 'hospital') return 'hospital';
  if (s === 'traveling' || s === 'travelling' || s === 'abroad') return 'travel';
  if (s === 'jail') return 'jail';
  return 'other';
}
const rank = { okay: 0, hospital: 1, jail: 2, travel: 3, other: 4 };
const onRank = { online: 0, idle: 1, offline: 2 };
function sorted(list) {
  return list.slice().sort((a, b) => {
    const ga = group(a), gb = group(b);
    if (ga !== gb) return rank[ga] - rank[gb];
    if (ga === 'okay') return (onRank[online(a)] ?? 3) - (onRank[online(b)] ?? 3);
    if (ga === 'hospital' || ga === 'jail') return (Number(a.status.until) || 0) - (Number(b.status.until) || 0);
    return 0;
  });
}
function pill(m) {
  const g = group(m), until = Number(m.status && m.status.until) || 0;
  const left = until > nowS() ? `<span data-until="${until}">${fmt.dur(until - nowS())}</span>` : '';
  if (g === 'okay') return '<span class="pill ok">Okay</span>';
  if (g === 'hospital') return `<span class="pill hosp">Hosp ${left}</span>`;
  if (g === 'jail') return `<span class="pill jail">Jail ${left}</span>`;
  if (g === 'travel') return `<span class="pill trav" title="${esc(m.status.description || '')}">${esc(m.status.description || 'Travelling')}</span>`;
  return `<span class="pill">${esc((m.status && m.status.state) || '?')}</span>`;
}
const atk = (m) => `<a href="https://www.torn.com/page.php?sid=attack&amp;user2ID=${encodeURIComponent(m.id)}" title="Open attack page">${esc(m.name || m.id)}</a>`;
const dot = (m) => { const o = online(m); return `<span title="${esc((m.last_action && m.last_action.relative) || '')}" class="${o === 'online' ? 'good' : o === 'idle' ? 'warn' : 'muted'}">●</span>`; };

function chainKpi(label, c) {
  if (!c) return `<div class="kpi"><b>–</b><span>${label}</span></div>`;
  const t = Number(c.timeout) || 0, cur = Number(c.current) || 0;
  const live = cur > 0 && t > 0 ? ` · <span data-left="${Math.floor(Date.now() / 1000) + t}" class="${t < 90 ? 'bad' : ''}">${fmt.dur(t)}</span>` : (Number(c.cooldown) > 0 ? ` · cooldown ${fmt.dur(c.cooldown)}` : '');
  return `<div class="kpi"><b>${fmt.num(cur)}${c.max ? `<span class="muted" style="font-size:12px"> / ${fmt.num(c.max)}</span>` : ''}</b><span>${label}${live}</span></div>`;
}

function render() {
  if (!w.isOpen()) return;
  const d = data, war = d.war;
  const filters = [['all', 'All'], ['okay', 'Okay'], ['hospital', 'Hospital'], ['travel', 'Travelling'], ['jail', 'Jail'], ['online', 'Online']];
  let html = '';
  if (d.error) html += `<div class="card bad">${esc(d.error)}</div>`;
  if (war) {
    const us = war.factions.find((f) => Number(f.id) === (own && own.id)) || {}, them = war.factions.find((f) => Number(f.id) !== (own && own.id)) || {};
    const st = Number(war.start) || 0;
    const when = st > nowS() ? `starts in <span data-left="${st}">${fmt.dur(st - nowS())}</span>` : `running ${fmt.dur(nowS() - st)}`;
    html += `<div class="row" style="margin-bottom:8px"><div class="kpi"><b>${fmt.num(us.score)} <span class="muted">vs</span> ${fmt.num(them.score)}</b><span>${esc(us.name || 'Us')} vs ${esc(them.name || 'Them')}${war.target ? ` · target ${fmt.num(war.target)}` : ''}</span></div><div class="kpi"><b style="font-size:13px">${when}</b><span>Ranked war</span></div></div>`;
  } else if (own || S.enemyManual) {
    const m = S.enemyManual;
    html += `<div class="card"><div class="note" style="margin-top:0">${m ? `Watching faction <b>[${esc(m)}]</b> by ID. Change it or stop watching:` : 'No ranked war found for your faction. Watch another faction by ID:'}</div>
      <div class="row"><input type="text" data-enemy value="${esc(m)}" placeholder="Enemy faction ID" inputmode="numeric" style="width:140px"><button type="button" class="b pri" data-act="enemy">${m ? 'Change' : 'Watch'}</button>${m ? '<button type="button" class="b" data-act="clear">Stop watching this faction</button>' : ''}</div></div>`;
  }
  html += `<div class="row" style="margin-bottom:8px">${chainKpi('Our chain', d.ourChain)}${d.enemy ? chainKpi('Their chain', d.theirChain) : ''}</div>`;
  html += `<label class="row note" style="margin:0 0 8px;flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" style="margin-top:2px;flex:none" data-chainwatch${S.chainWatch ? ' checked' : ''}> Chain watch: alert me when our chain is about to time out (checks every 30s while a Torn tab is open)</label>`;
  if (d.enemy) {
    const ms = d.members;
    const next = ms.filter((m) => group(m) === 'hospital' && Number(m.status.until) > nowS()).sort((a, b) => a.status.until - b.status.until).slice(0, 5);
    const counts = { okay: 0, hospital: 0, travel: 0, jail: 0, online: 0 };
    ms.forEach((m) => { counts[group(m)] = (counts[group(m)] || 0) + 1; if (online(m) === 'online') counts.online++; });
    if (next.length) html += `<div class="card"><b style="font-size:12px">Out of hospital next</b><div class="row" style="margin-top:4px">${next.map((m) => `<span>${atk(m)} <span class="muted" data-until="${m.status.until}">${fmt.dur(m.status.until - nowS())}</span></span>`).join(' · ')}</div></div>`;
    html += `<div class="row" style="margin-bottom:6px">${filters.map(([k, l]) => `<button type="button" class="b${S.filter === k ? ' pri' : ''}" data-filter="${k}">${l}${k === 'all' ? ` ${ms.length}` : counts[k] != null ? ` ${counts[k]}` : ''}</button>`).join('')}</div>`;
    let shown = sorted(ms).filter((m) => S.filter === 'all' || (S.filter === 'online' ? online(m) === 'online' : group(m) === S.filter));
    const here = bspHere(), col = here && S.bsp, mine = col ? myTotal() : 0, st = {};
    if (col) {
      shown.forEach((m) => { st[m.id] = bspOf(m.id); });
      if (S.bspSort) shown = shown.slice().sort((a, b) => { const x = st[a.id], y = st[b.id]; if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1); return S.bspSort === 'up' ? x.total - y.total : y.total - x.total; });
    }
    if (here) html += `<label class="row note" style="margin:0 0 6px"><input type="checkbox" data-bsp${S.bsp ? ' checked' : ''}> <a href="${BSP_LINK}" target="_blank" rel="noopener">BSP</a> stats</label>`;
    html += `<table><thead><tr><th></th><th>Name</th><th class="n">Lvl</th>${col ? `<th class="n"><a href="#" data-act="bspsort" title="Sort by stats">Stats${S.bspSort === 'up' ? ' ▴' : S.bspSort === 'down' ? ' ▾' : ''}</a></th>` : ''}<th>Status</th></tr></thead><tbody>${shown.map((m) => `<tr><td>${dot(m)}</td><td>${atk(m)}</td><td class="n">${fmt.num(m.level)}</td>${col ? `<td class="n">${statCell(st[m.id], mine)}</td>` : ''}<td>${pill(m)}</td></tr>`).join('') || `<tr><td colspan="${col ? 5 : 4}" class="muted">Nobody in this filter.</td></tr>`}</tbody></table>`;
    html += `<div class="note">${esc(d.enemy.name)} [${d.enemy.id}]${d.enemy.manual ? ` · <a href="#" data-act="clear">stop watching</a>` : ''} · updated ${d.at ? fmt.ago(Math.floor(d.at / 1000)) : '–'} · refreshes every 30s while open. Names open the attack page when you click them.</div>`;
  }
  w.set(html);
}

function onClick(e) {
  const f = e.target.closest('[data-filter]');
  if (f) { S.filter = f.dataset.filter; save(); render(); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'bspsort') { e.preventDefault(); S.bspSort = S.bspSort === '' ? 'up' : S.bspSort === 'up' ? 'down' : ''; save(); render(); return; }
  if (a.dataset.act === 'enemy') {
    const v = (w.body.querySelector('[data-enemy]') || {}).value || '';
    if (/^\d+$/.test(v.trim())) { S.enemyManual = v.trim(); save(); load(); }
    else if (!v.trim() && S.enemyManual) { S.enemyManual = ''; save(); data = Object.assign({}, data, { enemy: null, members: [], theirChain: null, error: '' }); render(); load(); }
  } else if (a.dataset.act === 'clear') { e.preventDefault(); S.enemyManual = ''; save(); data = Object.assign({}, data, { enemy: null, members: [], theirChain: null, error: '' }); render(); load(); }
}
function onChange(e) {
  if (e.target.matches('[data-chainwatch]')) { S.chainWatch = e.target.checked; save(); startWatch(); }
  if (e.target.matches('[data-bsp]')) { S.bsp = e.target.checked; save(); render(); }
}

// live countdowns (display only)
setInterval(() => {
  if (!w.isOpen()) return;
  const n = nowS();
  w.body.querySelectorAll('[data-until],[data-left]').forEach((el) => { const t = Number(el.dataset.until || el.dataset.left); el.textContent = t > n ? fmt.dur(t - n) : 'now'; });
}, 1000);

// refresh every 30s while open
let poll = null;
w.onopen = () => { render(); if (!poll) { const mine = {}; poll = tucc.every(30000, () => { if (w.isOpen() && poll === mine.h) load(); }); mine.h = poll; poll.now(); } else poll.now(); };
w.onclose = () => { if (poll) { poll.stop(); poll = null; } };

// chain watch (your switch): own chain only
let watch = null;
function startWatch() {
  if (watch) { watch.stop(); watch = null; }
  if (!S.chainWatch) return;
  const mine = {};
  watch = tucc.every(30000, async () => {
    if (!S.chainWatch || watch !== mine.h) return;
    try {
      const me = await ownFaction();
      const j = await tucc.api(`/v2/faction/${me.id}/chain`, {}, { ttl: 10 });
      const c = j && j.chain;
      if (!c) return;
      if (w.isOpen()) { data.ourChain = c; render(); }
      const t = Number(c.timeout) || 0, cur = Number(c.current) || 0;
      if (t > 0 && t < 90 && cur >= 10) {
        tucc.alert({ id: 'chain-' + (c.start || c.id || 'x'), title: `Chain ${fmt.num(cur)} times out in ${fmt.dur(t)}`, text: 'Hit someone to keep the chain going.', level: 'urgent', url: 'https://www.torn.com/factions.php?step=your#/', repeatAfter: 60 });
      }
    } catch (e) { /* quiet: shown in the window when open */ }
  });
  mine.h = watch;
  watch.now();
}
startWatch();

tucc.menu('Open War Room', () => w.open());
// Stays open across Torn pages until you close it (the open/closed state is remembered).
if (w.wasOpen()) w.open();
