// ==UserScript==
// @name         Crimes Analyst
// @namespace    eaglewing.torn.tucc.crimes
// @version      1.0.0
// @description  Crimes page: success rate, skill, money per nerve and critical fails for every crime type, from your own crime stats. Advice only: never commits crimes for you.
// @author       Eaglewing [571041]
// @match        https://www.torn.com/page.php?sid=crimes*
// @match        https://www.torn.com/loader.php?sid=crimes*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
 * Compliance: reads the Torn API only (through TUCC's shared engine) when you open the
 * window or press Refresh. It never presses Torn's crime buttons and never loads anything
 * from torn.com. Sorting and expanding rows happen locally.
 */
if (typeof tucc === 'undefined' || !tucc) return;
const esc = tucc.esc, fmt = tucc.fmt;
const S = Object.assign({ sort: 'mpn', dir: -1 }, GM_getValue('settings', {}) || {});
const save = () => GM_setValue('settings', S);
let list = null, stats = {}, prices = {}, err = '', loading = false, progress = '', open = {};
const w = tucc.ui.window('crimes', 'Crimes Analyst', 'TUCC');
if (window.innerWidth > 640) w.el.style.width = 'min(760px, calc(100vw - 28px))';   // nine columns need the room
w.onopen = () => { render(); if (!list) load(false); };

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const currentSlug = () => norm((location.hash.match(/#\/([^/?]+)/) || [])[1] || '');

async function load(force) {
  if (loading) return;
  loading = true; err = ''; progress = ''; render();
  try {
    const j = await tucc.api('/v2/torn/crimes', {}, { ttl: 86400 });
    list = (j && j.crimes) || [];
    stats = {};
    const it = await tucc.api('/v2/torn/items', {}, { ttl: 3600 }).catch(() => null);
    prices = {};
    ((it && it.items) || []).forEach((x) => { prices[x.id] = (x.value && x.value.market_price) || 0; });
    let i = 0;
    for (const c of list) {
      i++; progress = `Reading ${i} of ${list.length}: ${c.name}`; render();
      try { const r = await tucc.api(`/v2/user/${c.id}/crimes`, {}, force ? { nocache: true, ttl: 600 } : { ttl: 600 }); stats[c.id] = r && r.crimes; }
      catch (e) { if (e.code === 'nokey' || [2, 5, 8, 9, 10, 13, 14, 16, 18].includes(Number(e.code))) throw e; stats[c.id] = null; }
    }
    S.at = Date.now(); save();
  } catch (e) {
    err = e.code === 'nokey' ? 'No API key yet. Add a Minimal key in the TUCC panel (API key & ToS tab).' : String(e.message || e);
  }
  loading = false; progress = ''; render();
}

function rowsOf() {
  return (list || []).map((c) => {
    const s = stats[c.id];
    if (!s) return { c, none: true, mpn: -1 };
    const a = s.attempts || {}, rw = s.rewards || {};
    const tot = Number(a.total) || 0, nerve = Number(s.nerve_spent) || 0;
    const itemVal = (rw.items || []).reduce((acc, x) => acc + (prices[x.id] || 0) * (Number(x.amount) || 0), 0);
    const items = (rw.items || []).reduce((acc, x) => acc + (Number(x.amount) || 0), 0);
    const money = Number(rw.money) || 0;
    return {
      c, s, tot, nerve, money, items, itemVal,
      skill: Number(s.skill) || 0,
      succ: tot ? (Number(a.success) || 0) / tot * 100 : -1,
      crit: tot ? (Number(a.critical_fail) || 0) / tot * 100 : -1,
      mpn: nerve ? money / nerve : -1,
      vpn: nerve ? (money + itemVal) / nerve : -1,
    };
  });
}
const COLS = [['name', 'Crime'], ['skill', 'Skill'], ['tot', 'Tries'], ['succ', 'Success'], ['crit', 'Crit fail'], ['nerve', 'Nerve'], ['money', 'Money'], ['mpn', '$/nerve'], ['vpn', 'Incl. items']];

function render() {
  if (!w.isOpen()) return;
  let html = `<div class="row" style="margin-bottom:8px"><button type="button" class="b" id="cr-ref">${loading ? 'Loading…' : 'Refresh'}</button><span class="note" style="margin:0">${esc(progress || (S.at && list ? 'Updated ' + fmt.ago(S.at / 1000) : ''))}</span></div>`;
  if (err) html += `<div class="card bad">${esc(err)}</div>`;
  if (!list) { w.set(html); bind(); return; }
  const rows = rowsOf();
  const key = S.sort, dir = S.dir;
  rows.sort((a, b) => {
    if (key === 'name') return dir * String(a.c.name).localeCompare(String(b.c.name));
    return dir * ((a[key] == null ? -1 : a[key]) - (b[key] == null ? -1 : b[key]));
  });
  const done = rows.filter((r) => !r.none && r.nerve > 0);
  const bestId = done.length ? done.slice().sort((a, b) => b.mpn - a.mpn)[0].c.id : null;
  const here = currentSlug();
  const totalNerve = done.reduce((a, r) => a + r.nerve, 0), totalMoney = done.reduce((a, r) => a + r.money, 0);
  html += `<div class="row" style="margin-bottom:8px"><div class="kpi"><span>Nerve spent</span><b>${fmt.short(totalNerve)}</b></div><div class="kpi"><span>Money earned</span><b>${fmt.money(totalMoney)}</b></div><div class="kpi"><span>Overall $/nerve</span><b>${totalNerve ? fmt.money(totalMoney / totalNerve) : '–'}</b></div></div>`;
  html += `<table><thead><tr>${COLS.map(([k, l]) => `<th class="${k === 'name' ? '' : 'n'}" data-sort="${k}" style="cursor:pointer;white-space:nowrap">${l}${S.sort === k ? (S.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>`;
  const pct = (v) => (v < 0 ? '<span class="muted">–</span>' : v.toFixed(1) + '%');
  for (const r of rows) {
    const isHere = here && (norm(r.c.name) === here || here.startsWith(norm(r.c.name)) || norm(r.c.name).startsWith(here));
    const style = isHere ? ' style="background:rgba(248,113,113,.12)"' : '';
    const subs = r.s && r.s.attempts && Array.isArray(r.s.attempts.subcrimes) ? r.s.attempts.subcrimes : [];
    if (r.none) { html += `<tr${style}><td>${esc(r.c.name)}</td><td class="muted" colspan="8">no data for this crime</td></tr>`; continue; }
    html += `<tr${style}><td>${subs.length ? `<a href="#" data-x="${r.c.id}">${open[r.c.id] ? '▾' : '▸'}</a> ` : ''}<span style="white-space:nowrap">${esc(r.c.name)}</span>${r.c.id === bestId ? ' <span class="pill ok">best</span>' : ''}${isHere ? ' <span class="pill trav">here</span>' : ''}</td>
      <td class="n">${fmt.num(r.skill, 1)}</td><td class="n">${fmt.num(r.tot)}</td><td class="n ${r.succ >= 0 && r.succ < 60 ? 'warn' : ''}">${pct(r.succ)}</td><td class="n ${r.crit >= 5 ? 'bad' : ''}">${pct(r.crit)}</td>
      <td class="n">${fmt.num(r.nerve)}</td><td class="n">${fmt.money(r.money)}</td><td class="n${r.c.id === bestId ? ' good' : ''}">${r.mpn >= 0 ? fmt.money(r.mpn) : '–'}</td><td class="n">${r.vpn >= 0 ? fmt.money(r.vpn) : '–'}</td></tr>`;
    if (open[r.c.id] && subs.length) {
      html += `<tr><td colspan="9" style="padding-left:18px">${subs.map((x) => { const t = Number(x.total) || 0; return `<span class="pill" style="margin:2px">#${esc(x.id)}: ${t ? ((Number(x.success) || 0) / t * 100).toFixed(1) + '%' : '–'} of ${fmt.num(t)}</span>`; }).join('')}</td></tr>`;
    }
  }
  html += `</tbody></table><div class="note">From your own crime stats. "Incl. items" adds item rewards at market value. Click a column to sort. Commit crimes with Torn's own buttons; this window never does it for you.</div>`;
  w.set(html); bind();
}
function bind() {
  const r = w.body.querySelector('#cr-ref');
  if (r) r.onclick = () => load(true);
  w.body.querySelectorAll('[data-sort]').forEach((th) => { th.onclick = () => { const k = th.dataset.sort; if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = k === 'name' ? 1 : -1; } save(); render(); }; });
  w.body.querySelectorAll('[data-x]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); const id = a.dataset.x; open[id] = !open[id]; render(); }; });
}
window.addEventListener('hashchange', render);
tucc.menu('Open Crimes Analyst', () => w.open());
if (w.wasOpen()) w.open();
