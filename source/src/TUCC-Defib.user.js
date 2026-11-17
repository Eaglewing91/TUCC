// ==UserScript==
// @name         TUCC Defib
// @namespace    eaglewing.torn.tucc.defib
// @version      1.0.0
// @description  Hospital HUD for revivers, in the style of Lockpick: your revive chance on every patient, energy and revives left, one-press Best Revive / Best Client, a chance floor, client alerts, billing and a formula that tunes itself to Torn's own numbers. API only.
// @author       Eaglewing [571041]
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
 * The revive chance formula comes from Torn's wiki and the 2021 medical changes (Torn City Newspaper):
 * base 90% at skill 1 rising to 100% at skill 100; each revive the patient had in the last 24 hours
 * costs 8% (skill 1) to 4% (skill 100), fading evenly over the 24 hours. Defib then fits those numbers
 * to the chances Torn itself recorded in your faction's revive log. Ideas drawn from a review of the
 * public revive scripts (Torn Revive Radar by Oxain, TornReviveChance by Resh, Torn City Reviver's Tool
 * by Lily, FastRevive by Upsilon, Revive Intel Pro by TheBeastMan); no code copied.
 *
 * Compliance notes
 * - Reads only the Torn API (api.torn.com, v2, key in the request header) through TUCC's shared engine.
 *   On the hospital page, while the tab is visible: your status (2 min), energy (1 min), revive skill
 *   (30 min), your revive log and your faction's incoming revive log (1 min, new entries only), your
 *   faction's member list (1 min), and up to 6 patients a minute for their daily "revives received"
 *   total. On other pages: your energy for the menu badge (2 min) and, if you set up clients, their
 *   status (1 min). Nothing at all in hidden tabs.
 * - Never sends a request to torn.com pages. Never revives, confirms or reloads anything by itself.
 * - "Best Revive" / "Best Client": one real press = one .click() on that patient's own Revive link on
 *   the page you are viewing, which opens Torn's own confirm box. You press Yes yourself.
 * - The chance floor and the early-discharge switch can only stop your own click (before Torn sees it);
 *   they never create one.
 * - Reads the hospital page you are viewing and Torn's confirm box (for Torn's shown chance).
 * - Stores your settings, logs and client list locally. Nothing is sent anywhere else.
 */

if (typeof tucc === 'undefined' || !tucc) return;
const { esc, fmt } = tucc;

/* ---------------------------------------------------------------- storage */
const DEF = {
  floor: 0, guard: true, skipED: false,
  greenAt: 80, redBelow: 50, dimBelow: 0,
  sort: 'chance', dimNoRevive: true, status: 'any', hide: false,
  bestButton: true, clientButton: true, lookups: true,
  badge: 'everywhere', energyCost: 0, learning: true, collapsed: false,
  mates: true, alerts: true, alertMates: false, alertRule: 'any', alertMin: 0, alertSkipED: true,
};
const S = Object.assign({}, DEF, GM_getValue('settings', {}) || {});
const C = Object.assign({ me: null, bars: null, skill: null, skillAt: 0, energySeen: 0, fit: null, noFac: 0, flogFrom: 0, flogAt: 0, mineIn: [], mineInAt: 0, err: '' }, GM_getValue('cache', {}) || {});
let FLOG = GM_getValue('flog', []) || [];       // faction incoming revives: {id,t,tid,ok,ch,sk}
let MINE = GM_getValue('mine', []) || [];       // your revives: {id,t,tid,tn,fid,fn,ok,ch,sk,ed}
let DAILY = GM_getValue('daily', {}) || {};     // id -> {n, at}: revives received in the last day (daily totals)
let TORNW = GM_getValue('tornw', {}) || {};     // id -> {W, at}: penalty read back from Torn's own shown chance
let CHECKS = GM_getValue('checks', []) || [];   // live checks: {t, id, est, src, torn}
const WATCH = Object.assign({ players: [], factions: [] }, GM_getValue('watch', {}) || {});
const dirty = new Set(); let saveT = null;
const save = (...w) => { w.forEach((x) => dirty.add(x)); if (!saveT) saveT = setTimeout(flush, 500); };
function flush() {
  saveT = null;
  if (dirty.has('s')) GM_setValue('settings', S);
  if (dirty.has('c')) GM_setValue('cache', C);
  if (dirty.has('flog')) GM_setValue('flog', FLOG);
  if (dirty.has('mine')) GM_setValue('mine', MINE);
  if (dirty.has('daily')) GM_setValue('daily', DAILY);
  if (dirty.has('tornw')) GM_setValue('tornw', TORNW);
  if (dirty.has('checks')) GM_setValue('checks', CHECKS);
  if (dirty.has('watch')) GM_setValue('watch', WATCH);
  dirty.clear();
}
window.addEventListener('pagehide', flush);

/* ---------------------------------------------------------------- helpers */
const DAY = 86400;
const now = () => Date.now();
const nowS = () => Date.now() / 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const onHosp = () => location.pathname === '/hospitalview.php';
const pct = (p) => (p == null ? '–' : p >= 99.95 ? '100%' : p < 1 ? '<1%' : `${Math.round(p)}%`);
const setText = (n, t) => { if (n && n.textContent !== t) n.textContent = t; };
const profileUrl = (id) => `https://www.torn.com/profiles.php?XID=${Number(id)}`;
const isOk = (r) => /success/i.test(String(r || ''));
const energyCost = () => S.energyCost > 0 ? S.energyCost : (C.energySeen || 75);
const svg = (b, s = 16) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const ICON = {
  pulse: svg('<path d="M3 12h4l2-5 4 10 2-5h6"/>', 18),
  plus: svg('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>', 18),
  star: svg('<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>', 18),
  sliders: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  minus: svg('<path d="M6 12h12"/>'), expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>', 14), cross: svg('<path d="M6 6l12 12M18 6 6 18"/>', 14),
};

/* ---------------------------------------------------------------- model */
// chance = base(skill) - perRevive(skill) x W, where W = sum over the patient's revives in the last 24h of
// (1 - age / 24h). Defaults are Torn's published numbers; the fit replaces them once your faction's log
// gives enough revives with Torn's recorded chance and the reviver's skill.
const PRIOR = { b0: 90, b1: 10, p0: 8, p1: 4, fails: false };
const par = () => (S.learning && C.fit && C.fit.use ? C.fit : PRIOR);
const base = (s, P = par()) => clamp(P.b0 + P.b1 * s / 100, 0, 100);
const perRev = (s, P = par()) => Math.max(0, P.p0 - (P.p0 - P.p1) * s / 100);
const chanceOf = (W, s, P = par()) => clamp(base(s, P) - perRev(s, P) * W, 1, 100);
const weight = (events, t, fails) => events.reduce((a, e) => { const age = t - e.t; return (e.ok || fails) && age >= 0 && age < DAY ? a + (1 - age / DAY) : a; }, 0);
const skill = () => (C.skill != null ? C.skill : 1);

function eventsFor(id) {
  const seen = new Set(), out = [];
  const add = (e) => { if (e.tid === id && !seen.has(e.id)) { seen.add(e.id); out.push(e); } };
  FLOG.forEach(add); MINE.forEach(add);
  if (C.me && id === C.me.id) (C.mineIn || []).forEach(add);
  return out;
}
const flogLive = () => !C.noFac && C.flogDone && C.flogAt && now() - C.flogAt < 10 * 60000 && C.flogFrom && C.flogFrom <= nowS() - DAY;

// Your estimated chance on this patient, and how sure Defib is of it.
//   torn    Torn showed you the chance a few minutes ago (exact then)
//   faction faction mate: every revive they had is in your faction's log (exact)
//   self    you, from your own incoming revives (exact)
//   daily   estimated from their daily "revives received" total (a range)
//   you     only your own revives on them are known (an upper limit)
//   none    nothing known (an upper limit: their chance if nobody revived them today)
function estimate(id) {
  const s = skill(), t = nowS(), P = par();
  const tw = TORNW[id];
  if (tw && now() - tw.at < 10 * 60000) { const p = chanceOf(tw.W, s); return { p, lo: p, hi: p, src: 'torn', exact: true, W: tw.W }; }
  const ev = eventsFor(id);
  if ((members.has(id) && flogLive()) || (C.me && id === C.me.id && C.mineInAt && now() - C.mineInAt < 15 * 60000)) {
    const W = weight(ev, t, P.fails), p = chanceOf(W, s);
    return { p, lo: p, hi: p, src: members.has(id) ? 'faction' : 'self', exact: true, W, n: ev.filter((e) => t - e.t < DAY && (e.ok || P.fails)).length };
  }
  const Wk = weight(ev, t, P.fails);
  const d = DAILY[id];
  if (d && now() - d.at < 20 * 60000) {
    const Wmid = Math.max(Wk, d.n * 0.5), Wmax = Math.max(Wk, d.n);
    return { p: chanceOf(Wmid, s), lo: chanceOf(Wmax, s), hi: chanceOf(Wk, s), src: 'daily', exact: false, W: Wmid, n: d.n };
  }
  const p = chanceOf(Wk, s);
  return { p, lo: null, hi: p, src: Wk > 0 ? 'you' : 'none', exact: false, W: Wk };
}
const SRC_TEXT = {
  torn: "Torn's own number (shown when you opened this revive)",
  faction: "exact: every revive they had today is in your faction's log",
  self: 'exact: from your own revive log',
  daily: 'estimated from their daily "revives received" total',
  you: 'at most: only your own revives on them are known',
  none: 'at most: their chance if nobody has revived them today',
};

// Least squares with a pull toward Torn's published numbers:
// chance = b0 + b1*x - p0*W + q*x*W, with x = skill/100 and q = p0 - p1.
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let i = 0; i < n; i++) {
    let m = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[m][i])) m = k;
    [M[i], M[m]] = [M[m], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
function fitRows(fails) {
  const by = new Map();
  for (const e of FLOG) { if (!by.has(e.tid)) by.set(e.tid, []); by.get(e.tid).push(e); }
  const rows = [];
  for (const list of by.values()) {
    list.sort((a, b) => a.t - b.t);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.sk == null || e.ch == null || e.ch <= 1.5 || e.t < C.flogFrom + DAY) continue;
      let W = 0; for (let j = 0; j < i; j++) { const age = e.t - list[j].t; if (age > 0 && age < DAY && (list[j].ok || fails)) W += 1 - age / DAY; }
      rows.push({ x: e.sk / 100, W, y: e.ch });
    }
  }
  return rows;
}
const rmseOf = (rows, P) => Math.sqrt(rows.reduce((a, r) => a + (chanceOf(r.W, r.x * 100, P) - r.y) ** 2, 0) / rows.length);
function fit() {
  let best = null;
  for (const fails of [false, true]) {
    const rows = fitRows(fails);
    if (rows.length < 15) continue;
    const lam = 3, b0 = [PRIOR.b0, PRIOR.b1, PRIOR.p0, PRIOR.p0 - PRIOR.p1];
    const A = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? lam : 0)));
    const v = b0.map((x) => lam * x);
    for (const r of rows) {
      const f = [1, r.x, -r.W, r.x * r.W];
      for (let i = 0; i < 4; i++) { v[i] += f[i] * r.y; for (let j = 0; j < 4; j++) A[i][j] += f[i] * f[j]; }
    }
    const s = solve(A, v);
    if (!s || s.some((x) => !isFinite(x))) continue;
    const P = { b0: s[0], b1: s[1], p0: s[2], p1: s[2] - s[3], fails };
    if (P.b0 < 50 || P.b0 > 100 || P.p0 < 0 || P.p0 > 30 || P.p1 < 0) continue;
    const e = rmseOf(rows, P), ePrior = rmseOf(rows, Object.assign({}, PRIOR, { fails }));
    const mae = rows.reduce((a, r) => a + Math.abs(chanceOf(r.W, r.x * 100, P) - r.y), 0) / rows.length;
    if (!best || e < best.rmse) best = Object.assign(P, { n: rows.length, rmse: e, rmsePrior: ePrior, mae, at: now() });
  }
  if (best) { best.use = best.rmse < best.rmsePrior - 0.05; C.fit = best; save('c'); }
}

/* ---------------------------------------------------------------- API */
const members = new Map();   // your faction: id -> {name, revivable, ed, state, until, last}
let busy = false;
const due = {};
const dueNow = (k, ms) => { if (now() - (due[k] || 0) < ms) return false; due[k] = now(); return true; };
const FATAL = [2, 10, 13, 18];
function apiFail(e, where) {
  if (e.code === 'nokey') { C.err = 'Add a key in TUCC\'s API Keys app.'; return; }
  if (FATAL.includes(e.code)) { C.err = `API key problem: ${e.message}`; return; }
  C.err = `${where}: ${e.message}`;
}
const pctScale = (list) => (list.length && list.every((r) => r.success_chance == null || r.success_chance <= 1) ? 100 : 1);

async function getBasic() { const j = await tucc.api('/v2/user/basic', {}, { ttl: 60 }); const p = j.profile || j; C.me = { id: Number(p.id), name: p.name, level: p.level, state: p.status && p.status.state, until: p.status && p.status.until }; }
async function getBars() { const j = await tucc.api('/v2/user/bars', {}, { ttl: 30 }); const e = j.bars && j.bars.energy; if (e) C.bars = Object.assign({}, e, { at: now() }); }
async function getSkill() {
  const j = await tucc.api('/v2/user/skills', {}, { ttl: 600 });
  const r = (j.skills || []).find((x) => x.slug === 'reviving');
  if (r) { C.skill = Number(r.level); C.skillAt = now(); }
}
// Pages through a revive log from `from` upwards (oldest first), at most 5 pages per call.
// done = reached the newest entry (otherwise the next call carries on from where this one stopped).
async function pageRevives(path, filters, from) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const j = await tucc.api(path, { filters, limit: 100, sort: 'ASC', from: Math.floor(from) }, { ttl: 20 });
    const list = j.revives || [];
    out.push(...list);
    if (list.length < 100) return { list: out, done: true };
    from = list[list.length - 1].timestamp;
  }
  return { list: out, done: false };
}
async function getMine() {
  const since = MINE.length ? Math.max(...MINE.map((e) => e.t)) - 60 : nowS() - 8 * DAY;
  const { list } = await pageRevives('/v2/user/revives', 'outgoing', Math.max(since, nowS() - 8 * DAY));
  const k = pctScale(list), ids = new Set(MINE.map((e) => e.id));
  for (const r of list) {
    if (ids.has(r.id)) continue;
    const t = r.target || {}, f = t.faction || {};
    MINE.push({ id: r.id, t: r.timestamp, tid: Number(t.id), tn: t.name || '', fid: f.id || 0, fn: f.name || '', ok: isOk(r.result), ch: r.success_chance == null ? null : r.success_chance * k, sk: r.reviver && r.reviver.skill, ed: !!t.early_discharge });
    if (r.reviver && r.reviver.skill != null && (!C.skillAt || r.timestamp * 1000 > C.skillAt)) { C.skill = Number(r.reviver.skill); C.skillAt = r.timestamp * 1000; }
  }
  MINE = MINE.filter((e) => e.t > nowS() - 8 * DAY).sort((a, b) => a.t - b.t).slice(-1500);
  save('mine', 'c');
}
async function getFlog() {
  const keep = nowS() - 50 * 3600;
  // Start again from 50 hours ago when there is nothing yet or the last read is over two days old.
  if (!C.flogFrom || !C.flogAt || now() - C.flogAt > 48 * 3600000) { FLOG = []; C.flogFrom = keep; C.flogDone = false; }
  const since = FLOG.length ? Math.max(...FLOG.map((e) => e.t)) - 60 : C.flogFrom;
  const { list, done } = await pageRevives('/v2/faction/revives', 'incoming', since);
  C.flogDone = done;
  const k = pctScale(list), ids = new Set(FLOG.map((e) => e.id));
  for (const r of list) {
    if (ids.has(r.id)) continue;
    FLOG.push({ id: r.id, t: r.timestamp, tid: Number(r.target && r.target.id), ok: isOk(r.result), ch: r.success_chance == null ? null : r.success_chance * k, sk: r.reviver && r.reviver.skill != null ? Number(r.reviver.skill) : null });
  }
  // Keep 50 hours; the window start moves up with it so "complete since" stays true.
  FLOG = FLOG.filter((e) => e.t >= keep).sort((a, b) => a.t - b.t).slice(-4000);
  C.flogFrom = Math.max(C.flogFrom, keep);
  C.flogAt = now();
  save('flog', 'c');
  fit();
}
async function getMineIn() {
  const j = await tucc.api('/v2/user/revives', { filters: 'incoming', limit: 100, from: Math.floor(nowS() - 25 * 3600) }, { ttl: 60 });
  const list = j.revives || [];
  C.mineIn = list.map((r) => ({ id: r.id, t: r.timestamp, tid: C.me ? C.me.id : 0, ok: isOk(r.result) }));
  C.mineInAt = now();
}
async function getMembers() {
  const j = await tucc.api('/v2/faction/members', { striptags: 'true' }, { ttl: 30 });
  members.clear();
  for (const m of j.members || []) members.set(Number(m.id), { name: m.name, revivable: !!m.is_revivable, ed: !!m.has_early_discharge, state: m.status && m.status.state, until: m.status && m.status.until, last: m.last_action && m.last_action.status });
}
const facCode = (e) => [6, 7, 16].includes(e.code);
async function sync() {
  if (busy) return;
  busy = true;
  try {
    const step = async (k, ms, fn, where, fac) => {
      if (fac && C.noFac && now() - C.noFac < 6 * 3600000) return;
      if (!dueNow(k, ms)) return;
      try { await fn(); if (fac) C.noFac = 0; } catch (e) {
        if (fac && facCode(e)) { C.noFac = now(); save('c'); return; }
        apiFail(e, where);
        if (e.code === 'nokey' || FATAL.includes(e.code)) throw e;   // key problem: stop this round
      }
    };
    C.err = '';
    if (onHosp()) {
      await step('basic', 120000, getBasic, 'Status');
      await step('bars', 60000, getBars, 'Energy');
      await step('skill', 30 * 60000, getSkill, 'Revive skill');
      await step('mine', 60000, getMine, 'Your revive log');
      await step('members', 60000, getMembers, 'Faction members', true);
      await step('flog', 60000, getFlog, "Faction revive log", true);
      if (C.me && C.me.state === 'Hospital') await step('minein', 300000, getMineIn, 'Revives you received');
      await lookups();
    } else if (S.badge === 'everywhere') {
      await step('bars', 120000, getBars, 'Energy');
    }
  } catch (e) { /* message already set */ } finally {
    busy = false; save('c'); render(); if (w.isOpen()) renderWin();
  }
}

// Patients on this page with nothing exact known: their "revives received" total now and a day ago.
// Up to 6 patients a minute, nearest the top of your sorted list first; each answer is kept 20 minutes.
let lookTimes = [];
const tried = {};   // id -> when it was last looked up, answered or not (20-minute gap)
async function lookups() {
  if (!S.lookups || !onHosp()) return;
  lookTimes = lookTimes.filter((t) => now() - t < 60000);
  const want = rows.filter((r) => r.can && r.id && !members.has(r.id) && !(C.me && r.id === C.me.id) && !(tried[r.id] && now() - tried[r.id] < 20 * 60000) && !(TORNW[r.id] && now() - TORNW[r.id].at < 10 * 60000));
  for (const r of want) {
    if (lookTimes.length >= 6) break;
    lookTimes.push(now()); tried[r.id] = now();
    try {
      const cur = await tucc.api(`/v2/user/${r.id}/personalstats`, { stat: 'revivesreceived' }, { ttl: 600 });
      const old = await tucc.api(`/v2/user/${r.id}/personalstats`, { stat: 'revivesreceived', timestamp: Math.floor(nowS() - DAY) }, { ttl: 3600 });
      const val = (j) => { const x = (j.personalstats || []).find((p) => p.name === 'revivesreceived'); return x ? Number(x.value) : null; };
      const a = val(cur), b = val(old);
      if (a != null && b != null) { DAILY[r.id] = { n: Math.max(0, a - b), at: now() }; save('daily'); }
    } catch (e) { if (e.code === 'nokey' || FATAL.includes(e.code)) { apiFail(e, 'Patient lookup'); break; } }
  }
  for (const id of Object.keys(DAILY)) if (now() - DAILY[id].at > 3600000) delete DAILY[id];
}

/* ---------------------------------------------------------------- hospital rows */
let rows = [], bestRow = null, clientRow = null;
function parseRow(li) {
  const nameA = li.querySelector('a.user.name') || li.querySelector('a[href*="profiles.php?XID="]');
  const id = nameA ? Number((/XID=(\d+)/.exec(nameA.getAttribute('href') || '') || [])[1] || 0) : 0;
  if (!id) return null;
  const name = ((nameA.textContent || '').trim() || nameA.getAttribute('title') || '').split('[')[0].trim();
  const lv = li.querySelector('.level'), tm = li.querySelector('.time');
  const level = lv ? Number((lv.textContent.match(/\d+/) || [0])[0]) : 0;
  const tt = tm ? tm.textContent : '';
  const num = (re) => Number((tt.match(re) || [0, 0])[1]);
  const minutes = num(/(\d+)\s*d/) * 1440 + num(/(\d+)\s*h/) * 60 + num(/(\d+)\s*m/);
  const rev = li.querySelector('a.revive');
  const can = !!rev && !rev.classList.contains('reviveNotAvailable');
  const icon = li.querySelector('[id^="icon1_"],[id^="icon62_"],[id^="icon2_"]');
  const lab = icon ? (icon.getAttribute('title') || icon.getAttribute('aria-label') || icon.id) : '';
  let status = /^icon1_|online/i.test(lab) ? 'online' : /^icon62_|idle/i.test(lab) ? 'idle' : /^icon2_|offline/i.test(lab) ? 'offline' : '';
  const m = members.get(id);
  if (m && m.last) status = String(m.last).toLowerCase();
  return { li, id, name, level, minutes, rev, can, status, ed: m ? m.ed : null };
}
const band = (p) => (p >= S.greenAt ? 'good' : p < S.redBelow ? 'bad' : 'mid');
const passStatus = (r) => S.status === 'any' || (S.status === 'online' ? r.status === 'online' : r.status === 'online' || r.status === 'idle');
const isClient = (id) => WATCH.players.some((p) => p.id === id) || (S.mates && members.has(id));
const RANK = { online: 3, idle: 2, offline: 1, '': 0 };

function renderRows() {
  const list = document.querySelector('ul.user-info-list-wrap');
  rows = []; bestRow = null; clientRow = null;
  if (!list) return;
  // Ranking: exact chances as they are; an estimated range by its low end (cautious); an upper limit slightly behind an equal exact one.
  const score = (r) => (r.e.src === 'daily' && r.e.lo != null ? r.e.lo : r.e.p) - (r.e.exact ? 0 : 0.5) + (RANK[r.status] || 0) * 0.01;
  for (const li of list.children) {
    if (li.tagName !== 'LI') continue;
    const r = parseRow(li);
    if (!r) continue;
    r.e = estimate(r.id);
    li._df = r;
    rows.push(r);
    let meter = li.querySelector('.df-meter');
    if (!meter) {
      meter = document.createElement('span');
      meter.className = 'df-meter';
      meter.innerHTML = '<span class="df-pins"><i></i><i></i><i></i><i></i><i></i></span><b></b>';
      const host = li.querySelector('.reason') || li.querySelector('.info-wrap') || li;
      host.insertBefore(meter, host.firstChild);
    }
    const e = r.e, show = e.exact ? pct(e.p) : e.src === 'daily' ? `≈${pct(e.p)}` : `≤${pct(e.p)}`;
    setText(meter.querySelector('b'), show);
    const lit = Math.max(1, Math.round(e.p / 20));
    meter.querySelectorAll('.df-pins i').forEach((pin, i) => pin.classList.toggle('on', i < lit));
    for (const b of ['good', 'mid', 'bad']) meter.classList.toggle('df-m-' + b, b === band(e.p));
    meter.classList.toggle('df-unsure', !e.exact);
    const cost = energyCost();
    meter.title = `Your chance: ${e.exact ? pct(e.p) : e.src === 'daily' ? `about ${pct(e.p)} (${pct(e.lo)}–${pct(e.hi)})` : `up to ${pct(e.p)}`}`
      + `\n${SRC_TEXT[e.src]}${e.n != null ? ` · ${e.n} revive${e.n === 1 ? '' : 's'} in 24h` : ''}`
      + `\nEnergy per success: about ${Math.round(cost / Math.max(0.01, e.p / 100))}e (${cost}e a try)`
      + (r.ed ? '\nHas early discharge (can leave hospital for free)' : '')
      + (isClient(r.id) ? `\n${WATCH.players.some((p) => p.id === r.id) ? 'Client' : 'Faction mate'}` : '');
    const dim = (S.dimNoRevive && !r.can) || (S.dimBelow > 0 && e.p < S.dimBelow) || !passStatus(r);
    li.classList.toggle('df-dim', dim && !S.hide);
    li.classList.toggle('df-hide', dim && S.hide);
    li.classList.toggle('df-client', isClient(r.id));
    const order = S.sort === 'chance' ? String(Math.round(1000 - score(r) * 10)) : S.sort === 'time' ? String(r.minutes) : '';
    if (li.style.order !== order) li.style.order = order;
    const eligible = r.can && passStatus(r) && !(S.skipED && r.ed) && !(S.floor > 0 && e.exact && e.p < S.floor);
    if (eligible && (!bestRow || score(r) > score(bestRow))) bestRow = r;
    if (eligible && isClient(r.id) && (!clientRow || score(r) > score(clientRow))) clientRow = r;
  }
  list.classList.toggle('df-sorted', S.sort !== 'off');
  for (const r of rows) r.li.classList.toggle('df-best', r === bestRow);
}

/* ---------------------------------------------------------------- HUD */
let hud = null;
function ring(size, stroke) {
  const r = (size - stroke) / 2, cx = size / 2, c = 2 * Math.PI * r;
  return `<svg class="df-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" data-c="${c}" aria-hidden="true"><circle class="df-ring-track" cx="${cx}" cy="${cx}" r="${r}" stroke-width="${stroke}" fill="none"/><circle class="df-ring-arc" cx="${cx}" cy="${cx}" r="${r}" stroke-width="${stroke}" fill="none" stroke-dasharray="${c} ${c}" stroke-dashoffset="${c}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cx})"/></svg>`;
}
function setRing(el, frac) {
  if (!el) return;
  const c = Number(el.dataset.c), off = String(c * (1 - clamp(frac, 0, 1)));
  const arc = el.querySelector('.df-ring-arc');
  if (arc.getAttribute('stroke-dashoffset') !== off) arc.setAttribute('stroke-dashoffset', off);
}
function energy() {
  const b = C.bars;
  if (!b) return null;
  const el = Math.max(0, (now() - b.at) / 1000);
  let cur = b.current, next = b.tick_time - el;
  while (next < 0 && b.interval > 0 && cur < b.maximum) { cur = Math.min(b.maximum, cur + b.increment); next += b.interval; }
  const cost = energyCost(), left = Math.floor(cur / cost);
  let wait = 0;
  if (cur < cost && b.increment > 0) wait = Math.max(0, next) + (Math.ceil((cost - cur) / b.increment) - 1) * b.interval;
  return { cur, max: b.maximum, left, wait, cost };
}
function buildHud() {
  hud = document.createElement('div');
  hud.className = 'df-hud df-ui';
  hud.innerHTML = `
    <div class="df-bar">
      <div class="df-brand">${ICON.pulse}<b>Defib</b></div>
      <div class="df-gauge" title="">${ring(58, 6)}<div class="df-gauge-val"><b data-k="left">–</b><small>revives</small></div></div>
      <dl class="df-stats">
        <div><dt>Skill</dt><dd data-k="skill">–</dd></div>
        <div><dt>Next revive</dt><dd data-k="next">–</dd></div>
        <div><dt>Per revive</dt><dd data-k="per">–</dd></div>
      </dl>
      <div class="df-actions">
        <button type="button" class="df-go" data-act="best"><span class="df-go-main">${ICON.plus}<span>Best Revive</span><b data-k="bestp"></b></span><span class="df-go-sub" data-k="bestname">Looking for patients…</span></button>
        <button type="button" class="df-go df-go-client" data-act="client"><span class="df-go-main">${ICON.star}<span>Best Client</span><b data-k="clientp"></b></span><span class="df-go-sub" data-k="clientname">Looking for clients…</span></button>
      </div>
      <div class="df-switches">
        <label class="df-sw" title="Stops your Yes click when Torn's own chance is below your floor (set the floor in Defib's settings)."><input type="checkbox" data-q="guard"><i></i><span>Chance floor<em data-k="floor"></em></span></label>
        <label class="df-sw" title="Stops your revive on patients who have early discharge (they can leave hospital for free)."><input type="checkbox" data-q="skipED"><i></i><span>Skip early discharge</span></label>
      </div>
      <div class="df-tools">
        <button type="button" class="df-ib" data-act="settings" title="Defib settings, learning, clients and billing" aria-label="Settings">${ICON.sliders}</button>
        <button type="button" class="df-ib" data-act="collapse" title="Compact view" aria-label="Compact view">${ICON.minus}</button>
      </div>
    </div>
    <div class="df-mini">
      <span class="df-brand">${ICON.pulse}</span>
      <span class="df-mini-text" data-k="mini">–</span>
      <button type="button" class="df-go-mini" data-act="best" data-k="minibest">Best Revive</button>
      <button type="button" class="df-go-mini df-go-mini-client" data-act="client" data-k="miniclient">Best Client</button>
      <span class="df-tools"><button type="button" class="df-ib" data-act="settings" title="Settings" aria-label="Settings">${ICON.sliders}</button><button type="button" class="df-ib" data-act="expand" title="Full view" aria-label="Full view">${ICON.expand}</button></span>
    </div>
    <div class="df-feed" data-k="feed"><div class="df-alert" data-k="alert" hidden></div><div class="df-patient" data-k="patient" hidden></div></div>`;
  hud.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'collapse' || a === 'expand') { S.collapsed = a === 'collapse'; save('s'); render(); }
    else if (a === 'settings') { tab = 'revives'; w.open(); }
    // Real clicks only: one press = one click on that patient's own Revive link.
    else if ((a === 'best' || a === 'client') && e.isTrusted) pick(b, a);
  });
  hud.addEventListener('change', (e) => {
    const k = e.target.dataset.q;
    if (!k) return;
    S[k] = e.target.checked; save('s');
    if (k === 'guard' && S.guard && !(S.floor > 0)) toast('Set a chance floor in Defib\'s settings first.', 'info');
    render();
  });
}
function placeHud() {
  if (!hud) buildHud();
  const anchor = document.querySelector('.users-list-title') || document.querySelector('ul.user-info-list-wrap');
  if (!anchor || !anchor.parentNode) return false;
  if (hud.nextElementSibling !== anchor) anchor.parentNode.insertBefore(hud, anchor);
  return true;
}
let lastPick = 0;
function pick(btn, kind) {
  if (now() - lastPick < 1000) return;   // one action per second at most
  const r = kind === 'client' ? clientRow : bestRow;
  const link = r && r.li.isConnected && r.rev;
  if (!link || !r.can) { toast(kind === 'client' ? 'No clients you can revive on this page' : 'No patients you can revive on this page', 'info'); return; }
  lastPick = now();
  btn.disabled = true; setTimeout(() => { btn.disabled = false; }, 1200);
  r.li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  r.li.classList.remove('df-flash'); void r.li.offsetWidth; r.li.classList.add('df-flash');
  link.click();
}
function toast(text, kind) {
  if (!hud) return;
  const host = hud.querySelector('[data-k="feed"]');
  const t = document.createElement('div');
  t.className = `df-toast df-t-${kind || 'info'}`;
  t.setAttribute('role', 'status');
  t.innerHTML = `${kind === 'good' ? ICON.check : kind === 'bad' ? ICON.cross : ''}<span></span>`;
  t.querySelector('span').textContent = text;
  host.appendChild(t);
  const chips = host.querySelectorAll('.df-toast');
  if (chips.length > 3) chips[0].remove();
  setTimeout(() => { t.classList.add('df-out'); setTimeout(() => t.remove(), 300); }, 7000);
}
// When you're in hospital: your own chance of being revived, from a skill 1 to a skill 100 medic.
function patientText() {
  if (!C.me || C.me.state !== 'Hospital' || !C.mineInAt) return '';
  const ev = (C.mineIn || []), t = nowS(), P = par();
  const W = weight(ev, t, P.fails);
  const n = ev.filter((e) => t - e.t < DAY && (e.ok || P.fails)).length;
  let back = '';
  if (chanceOf(W, 50) < 80) {
    let lo = 0, hi = DAY;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (chanceOf(weight(ev, t + mid, P.fails), 50) >= 80) hi = mid; else lo = mid; }
    back = ` · back to 80% (skill 50 medic) in ${fmt.dur(hi)}`;
  }
  return `You: ${n} revive${n === 1 ? '' : 's'} in 24h · a skill 1 medic has ${pct(chanceOf(W, 1))}, skill 50 ${pct(chanceOf(W, 50))}, skill 100 ${pct(chanceOf(W, 100))}${back}`;
}
function renderHud() {
  if (!placeHud()) return;
  const q = (k) => hud.querySelector(`[data-k="${k}"]`);
  hud.classList.toggle('df-collapsed', !!S.collapsed);
  const en = energy();
  hud.querySelectorAll('.df-ring').forEach((r) => setRing(r, en ? en.cur / Math.max(1, en.max) : 0));
  setText(q('left'), en ? String(en.left) : '–');
  q('left').closest('.df-gauge').title = en ? `Energy ${en.cur}/${en.max} · ${en.cost}e per revive` : 'Energy unknown';
  setText(q('skill'), C.skill != null ? String(Math.round(C.skill * 10) / 10) : '–');
  setText(q('next'), !en ? '–' : en.cur >= en.cost ? 'Ready' : fmt.dur(en.wait));
  setText(q('per'), `${energyCost()}e`);
  setText(q('mini'), en ? `${en.left} revive${en.left === 1 ? '' : 's'} left · skill ${C.skill != null ? Math.round(C.skill) : '?'} · ${en.cur >= en.cost ? 'ready' : 'next in ' + fmt.dur(en.wait)}` : 'Energy unknown');
  setText(q('floor'), S.floor > 0 ? ` · ${S.floor}%` : ' · not set');
  hud.querySelectorAll('input[data-q]').forEach((i) => { i.checked = !!S[i.dataset.q]; });

  const al = q('alert');
  const msg = C.err || (C.noFac && !C.err ? "No faction API access: faction mates' chances are estimates." : '');
  al.hidden = !msg; setText(al, msg);
  const pt = patientText(), pe = q('patient');
  pe.hidden = !pt; setText(pe, pt);

  const set = (kind, row, mainK, subK, miniK, label) => {
    const big = hud.querySelector(`.df-go[data-act="${kind}"]`), mini = q(miniK);
    const on = kind === 'best' ? S.bestButton : S.clientButton;
    big.hidden = mini.hidden = !on;
    const ok = !!(row && row.e.p >= 80), none = !row;
    big.classList.toggle('df-go-ok', ok); mini.classList.toggle('df-go-ok', ok);
    big.classList.toggle('df-go-none', none && kind === 'client'); mini.classList.toggle('df-go-none', none && kind === 'client');
    const p = row ? (row.e.exact ? pct(row.e.p) : (row.e.src === 'daily' ? '≈' : '≤') + pct(row.e.p)) : '';
    setText(q(mainK), p);
    setText(q(subK), row ? `${row.name}${row.status ? ' · ' + row.status : ''}` : kind === 'client' ? 'No clients on this page' : 'Nobody you can revive here');
    setText(mini, row ? `${label} · ${p}` : label);
  };
  set('best', bestRow, 'bestp', 'bestname', 'minibest', 'Best Revive');
  set('client', clientRow, 'clientp', 'clientname', 'miniclient', 'Best Client');
  hud.querySelector('.df-actions').hidden = !S.bestButton && !S.clientButton;
}

/* ---------------------------------------------------------------- menu badge */
function renderBadge() {
  const a = document.querySelector('#nav-hospital a');
  if (!a) return;
  let b = a.querySelector('.df-badge');
  const en = energy();
  const show = en && (S.badge === 'everywhere' || (S.badge === 'hospital' && onHosp()));
  if (!show) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('span'); b.className = 'df-badge'; b.innerHTML = '<i></i><b></b>'; a.appendChild(b); }
  setText(b.querySelector('b'), String(en.left));
  b.classList.toggle('df-badge-ready', en.left > 0);
  b.title = `Defib: ${en.left} revive${en.left === 1 ? '' : 's'} left (${en.cur}/${en.max} energy, ${en.cost}e each)`;
}

/* ---------------------------------------------------------------- your clicks on Torn's revive */
const CHANCE_RX = /(\d+(?:\.\d+)?)\s*%\s*chance\s*of\s*success/i;
let pending = null;
const confirmText = (li) => { const c = (li && li.querySelector('.confirm-revive')) || document.querySelector('.confirm-revive'); return c ? c.textContent.replace(/\s+/g, ' ') : ''; };
function onDocClick(e) {
  if (!onHosp() || !e.target || !e.target.closest) return;
  const rev = e.target.closest('a.revive');
  if (rev) {
    const li = rev.closest('li'), r = li && li._df;
    if (!r) return;
    if (S.skipED && r.ed) { block(e, `Stopped: ${r.name} has early discharge`); return; }
    if (S.guard && S.floor > 0 && r.e.exact && r.e.p < S.floor) { block(e, `Stopped: ${r.name} is ${pct(r.e.p)}, below your ${S.floor}% floor`); return; }
    pending = { id: r.id, li, name: r.name, est: r.e.p, src: r.e.src, at: now(), read: false };
    return;
  }
  const yes = e.target.closest('.confirm-revive .action-yes, .confirm-revive a, .confirm-revive button');
  if (yes && /yes/i.test(yes.textContent || '') || (yes && yes.classList.contains('action-yes'))) {
    const li = yes.closest('li'), txt = confirmText(li), m = CHANCE_RX.exec(txt);
    const torn = m ? Number(m[1]) : null;
    if (S.skipED && /early discharge/i.test(txt)) { block(e, 'Stopped: this patient has early discharge'); return; }
    if (S.guard && S.floor > 0 && torn != null && torn < S.floor) { block(e, `Stopped: Torn says ${pct(torn)}, below your ${S.floor}% floor`); return; }
    due.mine = now() - 45000; due.bars = now() - 45000;   // pick up the result and energy within ~15s
  }
}
function block(e, text) { e.preventDefault(); e.stopImmediatePropagation(); toast(text, 'bad'); }
// Reads Torn's own chance from the confirm box you opened, and works out this patient's real penalty from it.
function checkPending() {
  if (!pending) return;
  if (now() - pending.at > 15000) { pending = null; return; }
  if (pending.read) return;
  const txt = confirmText(pending.li), m = CHANCE_RX.exec(txt);
  if (!m) return;
  pending.read = true;
  const torn = Number(m[1]), s = skill(), b = base(s), per = perRev(s);
  CHECKS.push({ t: Math.floor(nowS()), id: pending.id, est: Math.round(pending.est * 10) / 10, src: pending.src, torn });
  if (CHECKS.length > 300) CHECKS.splice(0, CHECKS.length - 300);
  if (per > 0) { TORNW[pending.id] = { W: Math.max(0, (b - torn) / per), at: now() }; save('tornw'); }
  const en = /(\d+)\s*energy/i.exec(txt);
  if (en && Number(en[1]) >= 10 && Number(en[1]) <= 75) C.energySeen = Number(en[1]);
  save('checks', 'c');
  const gap = torn - pending.est;
  if (pending.src !== 'torn') toast(`Torn says ${pct(torn)} for ${pending.name} · Defib had ${pending.src === 'none' || pending.src === 'you' ? 'up to ' : ''}${pct(pending.est)} (${gap >= 0 ? '+' : ''}${Math.round(gap)})`, Math.abs(gap) <= 2 ? 'good' : 'info');
  render();
}

/* ---------------------------------------------------------------- client alerts (any page) */
async function watchClients() {
  if (!S.alerts) return;
  const P = WATCH.players.slice(0, 15), F = WATCH.factions.slice(0, 5);
  if (!P.length && !F.length && !S.alertMates) return;
  if (C.skill == null) { try { await getSkill(); } catch (e) { /* the alert just shows the chance for skill 1 */ } }
  const people = [];
  const take = (id, name, revivable, ed, state, until, last, note) => people.push({ id: Number(id), name, revivable, ed, state, until, last: String(last || '').toLowerCase(), note });
  try {
    for (const f of F) {
      const j = await tucc.api(`/v2/faction/${f.id}/members`, { striptags: 'true' }, { ttl: 50 });
      for (const m of j.members || []) take(m.id, m.name, m.is_revivable, m.has_early_discharge, m.status && m.status.state, m.status && m.status.until, m.last_action && m.last_action.status, f.note || `faction ${f.id}`);
    }
    if (S.alertMates) {
      const j = await tucc.api('/v2/faction/members', { striptags: 'true' }, { ttl: 50 });
      for (const m of j.members || []) take(m.id, m.name, m.is_revivable, m.has_early_discharge, m.status && m.status.state, m.status && m.status.until, m.last_action && m.last_action.status, 'faction mate');
    }
    for (const p of P) {
      const j = await tucc.api(`/v2/user/${p.id}/profile`, { striptags: 'true' }, { ttl: 50 });
      const x = j.profile || {};
      if (x.name && p.name !== x.name) { p.name = x.name; save('watch'); }
      take(x.id || p.id, x.name || String(p.id), x.revivable, null, x.status && x.status.state, x.status && x.status.until, x.last_action && x.last_action.status, p.note || 'client');
    }
  } catch (e) { if (e.code === 'nokey' || FATAL.includes(e.code)) return; }
  const okRule = (st) => S.alertRule === 'any' || (S.alertRule === 'online' ? st === 'online' : S.alertRule === 'active' ? st === 'online' || st === 'idle' : st === 'offline');
  for (const x of people) {
    if (x.state !== 'Hospital' || x.revivable !== true || (C.me && x.id === C.me.id)) continue;
    if (S.alertSkipED && x.ed) continue;
    if (!okRule(x.last)) continue;
    const est = estimate(x.id);
    if (S.alertMin > 0 && est.p < S.alertMin) continue;
    tucc.alert({ id: `rev-${x.id}-${x.until || ''}`, title: `${x.name} needs a revive`, text: `${x.note} · ${est.exact ? '' : est.src === 'daily' ? 'about ' : 'up to '}${pct(est.p)} for you${x.until ? ' · out in ' + fmt.dur(x.until - nowS()) : ''}`, level: 'warn', url: profileUrl(x.id), repeatAfter: 3600 });
  }
}

/* ---------------------------------------------------------------- settings window */
const w = tucc.ui.window('defib', 'Defib', 'hospital HUD');
let tab = 'revives', billDays = 7;
const sw = (k, label, hint) => `<label class="row df-wrow"><input type="checkbox" data-s="${k}"${S[k] ? ' checked' : ''}> <span><b>${label}</b>${hint ? `<br><span class="note">${hint}</span>` : ''}</span></label>`;
const numIn = (k, label, min, max, hint) => `<label class="row df-wrow"><span style="flex:1"><b>${label}</b>${hint ? `<br><span class="note">${hint}</span>` : ''}</span><input type="number" data-s="${k}" min="${min}" max="${max}" value="${S[k]}" style="width:70px"></label>`;
const sel = (k, label, opts) => `<label class="row df-wrow"><span style="flex:1"><b>${label}</b></span><select data-s="${k}">${opts.map(([v, t]) => `<option value="${v}"${String(S[k]) === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
function winRevives() {
  return `<div class="card">${numIn('floor', 'Chance floor (%)', 0, 100, 'With "Chance floor" on in the HUD, Defib stops your Yes click when Torn\'s own chance is below this, and leaves those patients out of Best Revive. 0 = off.')}
    ${sw('guard', 'Chance floor on')}${sw('skipED', 'Skip early discharge', 'Stops your revive on patients who can leave hospital for free.')}</div>
    <div class="card">${numIn('energyCost', 'Energy per revive', 0, 75, `0 = automatic (${C.energySeen ? `${C.energySeen}e, read from Torn's confirm box` : '75e until Defib reads it from Torn'}). Faction Reviver upgrades take it down to 25.`)}
    ${sel('badge', 'Revives-left badge on Hospital in the menu', [['everywhere', 'Every page'], ['hospital', 'Hospital page only'], ['off', 'Off']])}</div>`;
}
function winList() {
  return `<div class="card">${sel('sort', 'Sort patients', [['chance', 'By your chance'], ['time', 'By time left'], ['off', "Torn's order"]])}
    ${sel('status', 'Patients to show', [['any', 'Everyone'], ['active', 'Online or idle'], ['online', 'Online only']])}
    ${sw('dimNoRevive', "Fade patients you can't revive", "Torn greys out their Revive link (their revive setting doesn't include you).")}
    ${numIn('dimBelow', 'Fade patients below (%)', 0, 100, '0 = off.')}
    ${sw('hide', 'Hide faded patients instead of fading them')}</div>
    <div class="card">${numIn('greenAt', 'Good chance from (%)', 0, 100)}${numIn('redBelow', 'Poor chance below (%)', 0, 100)}
    ${sw('bestButton', '"Best Revive" button', 'One press clicks the best patient\'s own Revive link once. Torn then asks you to confirm.')}
    ${sw('clientButton', '"Best Client" button', 'The same, for your clients and (if on) faction mates.')}
    ${sw('lookups', 'Estimate other patients', 'Up to 6 patients a minute: their "revives received" total now and a day ago (API). Shown as ≈.')}</div>`;
}
function winClients() {
  const line = (x, kind) => `<tr><td>${kind === 'p' ? `<a href="${profileUrl(x.id)}">${esc(x.name || x.id)}</a>` : `<a href="https://www.torn.com/factions.php?step=profile&ID=${Number(x.id)}">Faction ${Number(x.id)}</a>`}</td><td>${esc(x.note || '')}</td><td class="n"><button type="button" class="b" data-act="rm" data-kind="${kind}" data-id="${Number(x.id)}">Remove</button></td></tr>`;
  const list = WATCH.players.map((x) => line(x, 'p')).concat(WATCH.factions.map((x) => line(x, 'f'))).join('');
  return `<div class="card"><div class="row"><select data-k="addkind"><option value="p">Player</option><option value="f">Whole faction</option></select>
      <input data-k="addids" placeholder="IDs, e.g. 12345, 67890" style="flex:1;min-width:120px"><input data-k="addnote" placeholder="Note (who pays, rate)" style="flex:1;min-width:120px">
      <button type="button" class="b pri" data-act="add">Add</button></div>
      ${list ? `<table style="margin-top:8px"><thead><tr><th>Client</th><th>Note</th><th></th></tr></thead><tbody>${list}</tbody></table>` : '<p class="note">No clients yet. Clients are outlined on the hospital page and picked by Best Client.</p>'}</div>
    <div class="card">${sw('mates', 'Faction mates count as clients')}
      ${sw('alerts', 'Alert me when a client needs a revive', 'A TUCC alert when one is in hospital and revivable by you. Checked every minute while a Torn tab is visible.')}
      ${sw('alertMates', 'Also alert for faction mates')}
      ${sel('alertRule', 'Only when they are', [['any', 'Any status'], ['online', 'Online'], ['active', 'Online or idle'], ['offline', 'Offline']])}
      ${numIn('alertMin', 'Only at or above (%)', 0, 100, '0 = any chance.')}
      ${sw('alertSkipED', 'Not while they have early discharge')}</div>`;
}
function winLearn() {
  const F = C.fit, P = par();
  const fitTxt = !F ? `<p class="note">${C.noFac ? 'Needs faction API access: your faction\'s revive log is what Defib learns from.' : 'Not enough data yet. Defib needs 15 revives in your faction\'s log with a full day of history before them.'}</p>`
    : `<p>Fitted on <b>${F.n}</b> revives from your faction's log: Defib's formula is within <b>±${F.mae.toFixed(1)}%</b> of Torn's own number on average (RMSE ${F.rmse.toFixed(2)}; Torn's published numbers: ${F.rmsePrior.toFixed(2)}).</p>
       <p class="note">${F.use ? 'Using the fitted numbers.' : 'The fit is no better than Torn\'s published numbers, so those are used.'} Failed revives ${F.fails ? '<b>do</b>' : 'do <b>not</b>'} seem to count towards the penalty.</p>`;
  const c = CHECKS.slice(-100);
  const bySrc = {};
  for (const x of c) { const k = x.src; (bySrc[k] = bySrc[k] || []).push(Math.abs(x.torn - x.est)); }
  const chk = c.length ? `<table><thead><tr><th>Source</th><th class="n">Checks</th><th class="n">Avg gap</th></tr></thead><tbody>${Object.entries(bySrc).map(([k, v]) => `<tr><td>${esc(SRC_TEXT[k] || k)}</td><td class="n">${v.length}</td><td class="n">${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)}%</td></tr>`).join('')}</tbody></table>` : '<p class="note">Each time you open a revive, Defib compares its number with the chance Torn shows you. None yet.</p>';
  const mine = MINE.filter((e) => e.ch != null).slice(-100);
  const res = mine.length ? `<div class="row"><div class="kpi"><b>${mine.length}</b><span>your last revives</span></div><div class="kpi"><b>${pct(mine.reduce((a, e) => a + e.ch, 0) / mine.length)}</b><span>Torn's average chance</span></div><div class="kpi"><b>${pct(100 * mine.filter((e) => e.ok).length / mine.length)}</b><span>actually succeeded</span></div></div>` : '';
  return `<div class="card"><b>Formula</b><p class="note">Base ${P.b0.toFixed(1)}% at skill 0 to ${(P.b0 + P.b1).toFixed(1)}% at skill 100; each revive in the last 24h costs ${P.p0.toFixed(1)}% (skill 0) to ${P.p1.toFixed(1)}% (skill 100), fading over the day.</p>${fitTxt}
      ${sw('learning', 'Use the fitted numbers when they are better')}</div>
    <div class="card"><b>Live checks</b>${chk}</div>${res ? `<div class="card"><b>Your results</b>${res}</div>` : ''}
    <div class="card"><button type="button" class="b" data-act="resetlearn">Clear live checks</button></div>`;
}
function billRows() {
  const from = nowS() - billDays * DAY;
  return MINE.filter((e) => e.t >= from);
}
function winBill() {
  const list = billRows(), cost = energyCost();
  const groups = new Map();
  for (const e of list) {
    const client = WATCH.players.find((p) => p.id === e.tid);
    const k = client ? `Client: ${client.name || e.tn || e.tid}` : e.fn ? e.fn : 'No faction';
    const g = groups.get(k) || { n: 0, ok: 0, ch: 0 }; g.n++; if (e.ok) g.ok++; g.ch += e.ch || 0; groups.set(k, g);
  }
  const body = [...groups.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, g]) => `<tr><td>${esc(k)}</td><td class="n">${g.ok}/${g.n}</td><td class="n">${pct(g.ch / g.n)}</td><td class="n">${fmt.num(g.n * cost)}e</td></tr>`).join('');
  const ok = list.filter((e) => e.ok).length;
  return `<div class="row" style="margin-bottom:8px"><select data-k="billdays"><option value="1"${billDays === 1 ? ' selected' : ''}>Last 24 hours</option><option value="7"${billDays === 7 ? ' selected' : ''}>Last 7 days</option></select>
      <button type="button" class="b" data-act="csv" style="margin-left:auto"${list.length ? '' : ' disabled'}>Download CSV</button></div>
    <div class="row"><div class="kpi"><b>${ok}/${list.length}</b><span>revived / tries</span></div><div class="kpi"><b>${fmt.num(list.length * cost)}e</b><span>energy (${cost}e a try)</span></div></div>
    ${body ? `<table style="margin-top:8px"><thead><tr><th>Who</th><th class="n">Revived</th><th class="n">Avg chance</th><th class="n">Energy</th></tr></thead><tbody>${body}</tbody></table>` : '<p class="note">No revives in this period. Your revive log is read from the API while you are on the hospital page.</p>'}
    <p class="note">From Torn's own revive records, so attempts, results and chances match what Torn logged.</p>`;
}
function renderWin() {
  const tabs = [['revives', 'Revives'], ['list', 'List'], ['clients', 'Clients'], ['learn', 'Learning'], ['bill', 'Billing']];
  const body = tab === 'list' ? winList() : tab === 'clients' ? winClients() : tab === 'learn' ? winLearn() : tab === 'bill' ? winBill() : winRevives();
  const top = `<div class="row" style="margin-bottom:8px">${[['Skill', C.skill != null ? (Math.round(C.skill * 10) / 10) : '–'], ['Revives left', energy() ? energy().left : '–'], ['Faction log', C.noFac ? 'no access' : FLOG.length], ['Live checks', CHECKS.length]].map(([a, b]) => `<div class="kpi"><b>${esc(b)}</b><span>${a}</span></div>`).join('')}</div>`;
  w.set(`${top}<div class="row df-tabs" style="margin-bottom:8px">${tabs.map(([k, t]) => `<button type="button" class="b${tab === k ? ' pri' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>${body}
    ${C.err ? `<div class="note bad">${esc(C.err)}</div>` : ''}`);
}
w.body.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; renderWin(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  if (a === 'add') {
    const kind = w.body.querySelector('[data-k="addkind"]').value;
    const note = w.body.querySelector('[data-k="addnote"]').value.trim().slice(0, 60);
    const ids = [...new Set(String(w.body.querySelector('[data-k="addids"]').value).split(/[\s,;]+/).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
    const listK = kind === 'f' ? 'factions' : 'players';
    for (const id of ids) { WATCH[listK] = WATCH[listK].filter((x) => x.id !== id); WATCH[listK].push({ id, note, name: '' }); }
    WATCH.players = WATCH.players.slice(-50); WATCH.factions = WATCH.factions.slice(-10);
    save('watch'); renderWin(); render();
  } else if (a === 'rm') {
    const listK = b.dataset.kind === 'f' ? 'factions' : 'players', id = Number(b.dataset.id);
    WATCH[listK] = WATCH[listK].filter((x) => x.id !== id); save('watch'); renderWin(); render();
  } else if (a === 'resetlearn') { CHECKS = []; TORNW = {}; save('checks', 'tornw'); renderWin(); }
  else if (a === 'csv') {
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [['time_utc', 'target_id', 'target', 'faction', 'result', 'torn_chance', 'your_skill', 'early_discharge'].join(',')]
      .concat(billRows().map((e) => [new Date(e.t * 1000).toISOString(), e.tid, q(e.tn), q(e.fn), e.ok ? 'success' : 'failure', e.ch == null ? '' : e.ch.toFixed(2), e.sk == null ? '' : e.sk, e.ed ? 'yes' : 'no'].join(',')));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const link = document.createElement('a'); link.href = url; link.download = `defib-revives-${billDays}d.csv`; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
});
const onWinInput = (e) => {
  const t = e.target;
  if (t.dataset.k === 'billdays') { billDays = Number(t.value) || 7; renderWin(); return; }
  const k = t.dataset.s;
  if (!k) return;
  if (t.type === 'checkbox') S[k] = t.checked;
  else if (t.type === 'number') { if (e.type !== 'change') return; const v = Number(t.value); S[k] = Number.isFinite(v) ? clamp(v, Number(t.min) || 0, Number(t.max) || 100) : DEF[k]; }
  else S[k] = t.value;
  save('s'); render();
  if (t.tagName === 'SELECT' || t.type === 'checkbox') renderWin();
};
w.body.addEventListener('change', onWinInput);
w.onopen = () => renderWin();

/* ---------------------------------------------------------------- styles */
GM_addStyle(`
.df-ui{--df-bg:var(--tucc-bg,#14171b);--df-card:var(--tucc-s1,#1a1e23);--df-raise:var(--tucc-s3,#252a32);--df-line:var(--tucc-line,#2f353e);--df-text:var(--tucc-text,#e8ebee);--df-dim:var(--tucc-muted,#8d96a0);
  --df-good:var(--tucc-good,#34c99a);--df-mid:var(--tucc-warn,#f1b33c);--df-bad:var(--tucc-bad,#ef5f5f);--df-acc:var(--tucc-accent,#ef6b73);--df-fill:var(--tucc-accent-fill,#c8434d);--df-ink:var(--tucc-accent-ink,#fff);--df-num:var(--tucc-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
  font-family:var(--tucc-font,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif);color:var(--df-text);font-size:12px;line-height:1.4;box-sizing:border-box;text-align:left}
.df-ui *{box-sizing:border-box}.df-ui button{font-family:inherit}.df-ui [hidden]{display:none!important}
.df-hud{width:100%;margin:0 0 8px;background:var(--df-bg);border:1px solid var(--df-line);border-radius:var(--tucc-r,10px);overflow:hidden}
.df-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px;padding:10px 12px}
.df-brand{display:inline-flex;align-items:center;gap:6px;color:var(--df-acc)}.df-brand b{color:var(--df-text);font-size:13px;font-weight:700}
.df-gauge{position:relative;width:58px;height:58px;flex:0 0 auto;cursor:help}.df-gauge .df-ring{position:absolute;inset:0}
.df-gauge-val{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.df-gauge-val b{font:700 15px var(--df-num)}.df-gauge-val small{color:var(--df-dim);font-size:9px;text-transform:uppercase;letter-spacing:.08em}
.df-ring-track{stroke:var(--df-line)}.df-ring-arc{stroke:var(--df-good);transition:stroke-dashoffset .5s}
.df-stats{display:flex;gap:18px;margin:0}.df-stats div{display:flex;flex-direction:column}
.df-stats dt{color:var(--df-dim);font-size:10px;text-transform:uppercase;letter-spacing:.06em}.df-stats dd{margin:0;font:700 15px var(--df-num)}
.df-actions{display:flex;flex-direction:column;gap:6px;flex:0 1 250px;min-width:190px}
.df-go{width:100%;display:flex;flex-direction:column;gap:1px;padding:7px 11px;border-radius:var(--tucc-r2,9px);cursor:pointer;text-align:left;border:1px solid var(--df-fill);background:var(--df-fill);color:var(--df-ink)}
.df-go:hover,.df-go-mini:hover{filter:brightness(1.08)}.df-go:disabled,.df-go-mini:disabled{filter:grayscale(.6) brightness(.8);cursor:default}
.df-go-main{display:flex;align-items:center;gap:7px;font-weight:800;font-size:13px}
.df-go-main b{margin-left:auto;font:800 13px var(--df-num);padding:0 7px;border-radius:999px;background:rgba(0,0,0,.22)}
.df-go-sub{font-size:11px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:25px}
.df-go-client{background:#2d6b5a;border-color:#1f4d41;color:#e6f7f1}
.df-go.df-go-none,.df-go-mini.df-go-none{background:#7a2e2e!important;border-color:#4d1a1a!important;color:#ffe3e3!important}
.df-go.df-go-ok,.df-go-mini.df-go-ok{background:#15803d!important;border-color:#166534!important;color:#fff!important}
.df-switches{display:grid;gap:5px}
.df-sw{display:inline-flex;align-items:center;gap:8px;cursor:pointer;color:var(--df-dim);font-size:11px;user-select:none}
.df-sw input{position:absolute;opacity:0;pointer-events:none}
.df-sw i{position:relative;flex:0 0 auto;width:30px;height:17px;border-radius:999px;background:var(--df-line);transition:background .2s}
.df-sw i::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#cfd5db;transition:transform .2s}
.df-sw input:checked+i{background:var(--df-good)}.df-sw input:checked+i::after{transform:translateX(13px);background:#fff}
.df-sw input:checked~span{color:var(--df-text)}.df-sw input:focus-visible+i{outline:2px solid var(--df-acc);outline-offset:2px}
.df-sw em{font-style:normal;color:var(--df-acc);font-weight:700}
.df-tools{display:inline-flex;gap:2px;margin-left:auto}
.df-ib{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:7px;border:0;background:transparent;color:var(--df-dim);cursor:pointer}
.df-ib:hover{background:var(--df-raise);color:var(--df-text)}
.df-mini{display:none;align-items:center;gap:10px;padding:5px 8px 5px 10px}
.df-collapsed .df-bar{display:none}.df-collapsed .df-mini{display:flex}
.df-mini-text{font:600 12px var(--df-num);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.df-go-mini{flex:0 0 auto;padding:4px 10px;border-radius:7px;cursor:pointer;font-weight:800;font-size:12px;border:1px solid var(--df-fill);background:var(--df-fill);color:var(--df-ink)}
.df-go-mini-client{background:#2d6b5a;border-color:#1f4d41;color:#e6f7f1}
.df-feed{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px}.df-feed>*{margin-bottom:8px}
.df-alert{padding:5px 10px;border-radius:999px;background:rgba(239,95,95,.12);color:#ffb3b3;font-size:11px}
.df-patient{padding:5px 10px;border-radius:10px;background:rgba(52,201,154,.10);border:1px solid rgba(52,201,154,.35);font-size:11px}
.df-toast{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:var(--df-card);border:1px solid var(--df-line);font-size:11px;max-width:100%}
.df-toast span{white-space:normal}.df-t-good{border-color:rgba(52,201,154,.5)}.df-t-good svg{color:var(--df-good)}.df-t-bad{border-color:rgba(239,95,95,.6)}.df-t-bad svg{color:var(--df-bad)}
.df-toast.df-out{opacity:0;transition:opacity .3s}
.df-meter{display:inline-flex;align-items:center;gap:5px;margin-right:7px;padding:2px 7px 2px 5px;border-radius:6px;vertical-align:middle;background:rgba(20,23,27,.82);border:1px solid rgba(255,255,255,.08);line-height:14px;cursor:help}
.df-pins{display:inline-flex;gap:2px;align-items:flex-end}.df-pins i{display:block;width:3px;border-radius:1px;background:#3a414b}
.df-pins i:nth-child(1){height:5px}.df-pins i:nth-child(2){height:7px}.df-pins i:nth-child(3){height:9px}.df-pins i:nth-child(4){height:11px}.df-pins i:nth-child(5){height:13px}
.df-meter b{font:700 11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e8ebee;min-width:30px;text-align:right}
.df-m-good .df-pins i.on{background:#34c99a}.df-m-mid .df-pins i.on{background:#f1b33c}.df-m-bad .df-pins i.on{background:#ef5f5f}
.df-m-good b{color:#7ee6c3}.df-m-mid b{color:#ffd27a}.df-m-bad b{color:#ff9a9a}
.df-meter.df-unsure{border-style:dashed;opacity:.85}
ul.user-info-list-wrap.df-sorted{display:flex!important;flex-direction:column}
ul.user-info-list-wrap>li.df-dim{opacity:.38}ul.user-info-list-wrap>li.df-hide{display:none!important}
ul.user-info-list-wrap>li.df-client{box-shadow:inset 3px 0 0 #2d9c7f}
ul.user-info-list-wrap>li.df-best{box-shadow:inset 3px 0 0 var(--tucc-accent,#ef6b73);background-image:linear-gradient(90deg,rgba(239,107,115,.16),transparent 45%)}
@keyframes dfFlash{0%{background-color:rgba(239,107,115,.45)}100%{background-color:transparent}}
ul.user-info-list-wrap>li.df-flash{animation:dfFlash 1.2s ease-out}
.df-badge{display:inline-flex;align-items:center;gap:3px;margin-left:auto;margin-right:4px;padding:1px 6px;border-radius:999px;background:#14171b;border:1px solid #2f353e;line-height:14px}
.df-badge i{width:7px;height:7px;border-radius:50%;background:#8d96a0}.df-badge-ready i{background:#34c99a}
.df-badge b{font:700 10px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e8ebee}
@media (max-width:1000px){#nav-hospital a{position:relative}.df-badge{position:absolute;top:-2px;right:-2px;margin:0;padding:0 4px}}
.tucc-win .df-wrow{padding:6px 0;border-bottom:1px solid var(--tucc-line,#2f353e);flex-wrap:nowrap}.tucc-win .df-wrow:last-child{border-bottom:0}
@media (max-width:700px){.df-bar{gap:8px 12px;padding:8px 10px}.df-bar>.df-brand{display:none}.df-stats{gap:12px}.df-stats dd{font-size:13px}
  .df-actions{flex:1 1 100%;order:5}.df-switches{order:6;grid-template-columns:1fr 1fr;flex:1 1 100%}.df-ib{width:36px;height:36px}}
@media (prefers-reduced-motion:reduce){.df-ui *,.df-ui{transition:none!important;animation:none!important}}
`);

/* ---------------------------------------------------------------- loop */
let observer = null, rafQ = false;
function render() {
  renderBadge();
  if (!onHosp()) return;
  renderRows();
  renderHud();
  if (observer) observer.takeRecords();
}
function onMut() {
  if (rafQ) return;
  rafQ = true;
  requestAnimationFrame(() => { rafQ = false; checkPending(); render(); });
}
document.addEventListener('click', onDocClick, true);
if (onHosp()) {
  const root = document.querySelector('#mainContainer') || document.querySelector('.content-wrapper') || document.body;
  observer = new MutationObserver(onMut);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
}
render();
setTimeout(renderBadge, 1500);
tucc.every(15000, () => { render(); sync(); });          // API calls inside sync() are spaced by their own timers
tucc.every(60000, () => { watchClients(); });
tucc.menu('Open Defib', () => { w.open(); });
if (w.wasOpen()) w.open();
