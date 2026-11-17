// ==UserScript==
// @name         Company Manager (TUCC)
// @namespace    eaglewing.torn.tucc.company
// @version      1.0.0
// @description  Company page: employee effectiveness, inactivity and addiction flags, working stats, wages, and company funds, popularity and trains. API only; reads, never acts.
// @author       Eaglewing [571041]
// @match        https://www.torn.com/companies.php*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
 * Compliance: Torn API only (v1 company selections, through TUCC's shared engine).
 * No clicks, no form submits, no page requests. Names are plain links you click yourself.
 */
if (typeof tucc === 'undefined' || !tucc) return;
const esc = tucc.esc, F = tucc.fmt;
const S = { sort: GM_getValue('sort', 'eff'), dir: GM_getValue('dir', -1), low: Number(GM_getValue('low', 0)) || 0 };
const w = tucc.ui.window('company', 'Company Manager', 'TUCC');
let data = null, err = '', loading = false;

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
function errText(e) {
  if (e && e.code === 'nokey') return 'No API key saved. Add one in the TUCC panel, API key & ToS tab.';
  if (e && (e.code === 7 || e.code === 16)) return 'Your key can\'t read this company. Company Manager needs a Limited key; full employee detail needs you to be the director.';
  if (e && e.code === 6) return 'You don\'t appear to be in a company.';
  return (e && e.message) || 'Could not load company data.';
}

async function load(force) {
  if (loading) return;
  loading = true; err = ''; draw();
  try {
    const main = await tucc.api('/company/', { selections: 'profile,employees' }, { ttl: 120, nocache: !!force });
    let detailed = null;
    try { detailed = (await tucc.api('/company/', { selections: 'detailed' }, { ttl: 120, nocache: !!force })).company_detailed || null; } catch (e) { detailed = null; }
    data = { company: main.company || {}, employees: main.company_employees || {}, detailed, at: Date.now() };
  } catch (e) { err = errText(e); }
  loading = false; draw();
}

function rows() {
  const nowS = Date.now() / 1000;
  return Object.entries(data.employees || {}).map(([id, e]) => {
    e = e || {};
    const eff = e.effectiveness || {};
    const la = e.last_action || {};
    const idleDays = num(la.timestamp) ? Math.floor((nowS - num(la.timestamp)) / 86400) : null;
    const flags = [];
    if (num(eff.inactivity) != null && num(eff.inactivity) < 0) flags.push(['bad', `idle${idleDays != null ? ' ' + idleDays + 'd' : ''}`]);
    if (num(eff.addiction) != null && num(eff.addiction) <= -5) flags.push(['bad', `addict ${num(eff.addiction)}`]);
    if (S.low && num(eff.total) != null && num(eff.total) < S.low) flags.push(['warn', 'low']);
    return {
      id: Number(id), name: e.name || ('#' + id), pos: e.position || '', days: num(e.days_in_company), wage: num(e.wage),
      man: num(e.manual_labor), int: num(e.intelligence), end: num(e.endurance), eff: num(eff.total), effD: eff,
      idle: idleDays, rel: la.relative || '', flags,
    };
  });
}

const COLS = [['name', 'Name'], ['days', 'Days', 1], ['wage', 'Wage', 1], ['man', 'MAN', 1], ['int', 'INT', 1], ['end', 'END', 1], ['eff', 'Eff', 1], ['flags', 'Flags']];

function draw() {
  if (!w.isOpen()) return;
  if (loading && !data) { w.set('<div class="note">Loading company…</div>'); return; }
  if (err && !data) { w.set(`<div class="note bad">${esc(err)}</div><button type="button" class="b" data-act="reload">Try again</button>`); bind(); return; }
  if (!data) { w.set('<div class="note">No data yet.</div>'); return; }
  const c = data.company, d = data.detailed || {};
  const list = rows();
  const hasStats = list.some((r) => r.eff != null || r.man != null);
  const k = S.sort, dir = S.dir;
  list.sort((a, b) => {
    const x = k === 'flags' ? a.flags.length : a[k], y = k === 'flags' ? b.flags.length : b[k];
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
  });
  const wageWeek = list.reduce((s, r) => s + (r.wage || 0), 0) * 7;
  const weekly = num(c.weekly_income);
  const kpi = (v, l) => `<div class="kpi"><b>${v}</b><span>${esc(l)}</span></div>`;
  const kpis = [
    kpi(c.rating != null ? esc(c.rating) + '★' : '–', 'Rating'),
    kpi(`${F.num(num(c.employees_hired))}/${F.num(num(c.employees_capacity))}`, 'Staff'),
    kpi(F.short(num(c.daily_income)), 'Daily income'),
    kpi(F.short(weekly), 'Weekly income'),
    kpi(F.short(num(c.daily_customers)), 'Daily customers'),
  ];
  if (data.detailed) kpis.push(
    kpi(F.short(num(d.company_funds)), 'Funds'),
    kpi(F.num(num(d.popularity)), 'Popularity'),
    kpi(F.num(num(d.efficiency)), 'Efficiency'),
    kpi(F.num(num(d.environment)), 'Environment'),
    kpi(F.num(num(d.trains_available)), 'Trains available'),
    kpi(F.short(num(d.advertising_budget)), 'Ad budget / day'));
  const flagged = list.filter((r) => r.flags.some((f) => f[0] === 'bad')).length;
  const head = COLS.map(([key, label, n]) => `<th class="${n ? 'n' : ''}"><a href="#" data-sort="${key}">${esc(label)}${k === key ? (dir > 0 ? ' ▲' : ' ▼') : ''}</a></th>`).join('');
  const body = list.map((r) => {
    const tip = r.effD && r.eff != null ? Object.entries(r.effD).filter(([, v]) => typeof v === 'number').map(([n, v]) => `${n.replace(/_/g, ' ')}: ${v}`).join(' · ') : '';
    return `<tr><td><a href="https://www.torn.com/profiles.php?XID=${r.id}" target="_blank" rel="noopener">${esc(r.name)}</a><div class="muted" style="font-size:12px">${esc([r.pos, r.rel].filter(Boolean).join(' · '))}</div></td><td class="n">${F.num(r.days)}</td><td class="n">${r.wage != null ? F.money(r.wage) : '–'}</td>
      <td class="n">${F.short(r.man)}</td><td class="n">${F.short(r.int)}</td><td class="n">${F.short(r.end)}</td>
      <td class="n" title="${esc(tip)}">${F.num(r.eff)}</td>
      <td style="min-width:70px">${r.flags.map((f) => `<span style="white-space:nowrap;margin:0 2px 2px 0" class="pill ${f[0] === 'bad' ? 'hosp' : 'jail'}">${esc(f[1])}</span>`).join(' ') || '<span class="muted">–</span>'}</td></tr>`;
  }).join('');
  w.set(`
    <div class="row" style="justify-content:space-between;margin-bottom:6px"><b>${esc(String(c.name || 'Your company').replace(/<[^>]*>/g, ''))}</b>
      <span class="muted" style="font-size:12px">${loading ? 'Refreshing…' : 'Updated ' + F.ago(data.at / 1000)} <button type="button" class="b" data-act="reload">Refresh</button></span></div>
    ${err ? `<div class="note bad">${esc(err)}</div>` : ''}
    <div class="row" style="margin-bottom:8px">${kpis.join('')}</div>
    <div class="card"><div class="row" style="justify-content:space-between"><span>Weekly wage bill <b>${F.money(wageWeek)}</b></span>
      <span>Weekly income <b>${F.money(weekly)}</b></span>
      <span class="${weekly != null && wageWeek > weekly ? 'bad' : 'good'}">${weekly != null ? (wageWeek > weekly ? 'Wages exceed income' : 'Income covers wages') : ''}</span></div></div>
    <div class="row" style="justify-content:space-between;margin:4px 0 6px"><span>${flagged ? `<span class="bad">${flagged} employee${flagged > 1 ? 's' : ''} flagged</span>` : '<span class="good">No inactivity or addiction flags</span>'}</span>
      <label class="muted" style="font-size:12px">Flag effectiveness below <input type="number" data-act="low" min="0" max="500" value="${S.low || ''}" placeholder="off" style="width:64px"></label></div>
    ${!hasStats || !data.detailed ? '<div class="note warn">Some detail is hidden: working stats, effectiveness and company funds are only shown to the company director (with a Limited key).</div>' : ''}
    <div style="overflow-x:auto"><table><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="8" class="muted">No employees listed.</td></tr>'}</tbody></table></div>
    <div class="note">Hover an effectiveness number for its breakdown. Names open profiles in a new tab.</div>`);
  bind();
}

function bind() {
  w.body.querySelectorAll('[data-act=reload]').forEach((b) => { b.onclick = () => load(true); });
  w.body.querySelectorAll('[data-sort]').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); const k = a.dataset.sort; S.dir = S.sort === k ? -S.dir : (['name', 'pos', 'flags'].includes(k) ? 1 : -1); S.sort = k; GM_setValue('sort', S.sort); GM_setValue('dir', S.dir); draw(); };
  });
  const low = w.body.querySelector('[data-act=low]');
  if (low) low.onchange = () => { S.low = Math.max(0, Number(low.value) || 0); GM_setValue('low', S.low); draw(); };
}

w.onopen = () => { draw(); if (!data || Date.now() - data.at > 120000) load(false); };
tucc.menu('Open Company Manager', () => w.open());
if (w.wasOpen()) w.open();
