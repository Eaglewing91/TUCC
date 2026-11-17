// ==UserScript==
// @name         TUCC Market Watcher
// @namespace    eaglewing.torn.tucc.market
// @version      1.0.0
// @description  Watch item market and stock prices against your target prices and get a TUCC alert when one hits. Read-only: buying and selling stay manual. API only (Public key).
// @author       Eaglewing [571041]
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
 * Compliance notes
 * - Reads only the Torn API (api.torn.com) through TUCC's shared engine: item market listings
 *   and stock prices. Never buys, sells, clicks or loads anything on torn.com.
 * - Checks run only while "Watching" is on (your switch), while a Torn tab is visible: stocks every
 *   2-15 minutes (default 5); items at most every 30 minutes, because Torn refreshes item market data
 *   about once an hour (Nov 2026), so sooner checks only get the same answer. Item checks are spaced a
 *   few seconds apart. Max 20 item watches.
 * - Your watch list and last prices are stored locally.
 */

if (typeof tucc === 'undefined' || !tucc) return;
const { esc, fmt } = tucc;
const MAX_ITEMS = 20;
const ITEM_GAP = 30 * 60000;   // Torn refreshes item market data about once an hour
const S = Object.assign({ on: false, mins: 5, items: [], stocks: [] }, GM_getValue('settings', {}) || {});
const last = GM_getValue('last', {}) || {};      // key -> { price, amount, market, at }
const save = () => { GM_setValue('settings', S); GM_setValue('last', last); };
let catalogue = null, stockList = null, busy = false, msg = '';

const w = tucc.ui.window('market', 'Market Watcher', 'item & stock prices');
w.body.addEventListener('click', onClick);
w.body.addEventListener('change', onChange);

async function items() {
  if (catalogue) return catalogue;
  const j = await tucc.api('/v2/torn/items', {}, { ttl: 3600 });
  const list = Array.isArray(j.items) ? j.items : Object.entries(j.items || {}).map(([id, it]) => Object.assign({ id: Number(id) }, it));
  catalogue = list.filter((i) => i && i.id && i.name).map((i) => ({ id: Number(i.id), name: i.name, market: Number(i.value && i.value.market_price) || Number(i.market_value) || 0 }));
  return catalogue;
}
async function stocks() {
  const j = await tucc.api('/torn/', { selections: 'stocks' }, { ttl: 60 });
  const raw = j.stocks || {};
  stockList = (Array.isArray(raw) ? raw : Object.entries(raw).map(([id, s]) => Object.assign({ stock_id: Number(id) }, s)))
    .map((s) => ({ id: Number(s.stock_id || s.id), name: s.name, acr: String(s.acronym || '').toUpperCase(), price: Number(s.current_price) || 0 }));
  return stockList;
}
const hit = (wch, price) => price > 0 && (wch.dir === 'above' ? price >= wch.target : price <= wch.target);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkAll(manual) {
  if (busy) return;
  busy = true; msg = 'Checking…'; render();
  try {
    if (S.stocks.length) {
      const list = await stocks();
      for (const wch of S.stocks) {
        const s = list.find((x) => x.id === wch.id || (wch.acr && x.acr === wch.acr));
        if (!s) continue;
        last['s' + wch.id] = { price: s.price, at: Date.now() };
        if (hit(wch, s.price)) tucc.alert({ id: `stock-${wch.id}-${wch.dir}-${wch.target}`, title: `${s.acr || s.name} ${wch.dir === 'above' ? 'up to' : 'down to'} ${fmt.money(s.price)}`, text: `Your target: ${wch.dir} ${fmt.money(wch.target)}.`, level: 'warn', url: 'https://www.torn.com/page.php?sid=stocks', repeatAfter: 3600 });
      }
    }
    const due = S.items.filter((wch) => { const l = last['i' + wch.id]; return manual || !l || l.err || Date.now() - (l.at || 0) >= ITEM_GAP; });
    for (let i = 0; i < due.length; i++) {
      const wch = due[i];
      if (i) await sleep(manual ? 600 : 3000);
      try {
        const j = await tucc.api(`/v2/market/${wch.id}/itemmarket`, {}, { ttl: 1800 });
        const m = (j && j.itemmarket) || {};
        const ls = Array.isArray(m.listings) ? m.listings : [];
        const low = ls.length ? Number(ls[0].price) || 0 : 0;
        last['i' + wch.id] = { price: low, amount: ls.length ? Number(ls[0].amount) || 0 : 0, market: Number(m.item && m.item.average_price) || 0, at: Date.now() };
        if (hit(wch, low)) tucc.alert({ id: `item-${wch.id}-${wch.dir}-${wch.target}`, title: `${wch.name}: ${fmt.money(low)}`, text: `Lowest item market listing is ${wch.dir === 'above' ? 'at or above' : 'at or below'} your target of ${fmt.money(wch.target)}. Torn updates item market data about once an hour, so it may already be gone.`, level: 'warn', url: `https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${wch.id}`, repeatAfter: 3600 });
      } catch (e) { if (e.code === 'nokey') throw e; last['i' + wch.id] = Object.assign({}, last['i' + wch.id], { err: e.message, at: Date.now() }); }
      render();
    }
    msg = manual && S.items.length ? 'Item prices come from Torn\'s hourly data, so checking again soon may show the same prices.' : '';
  } catch (e) {
    msg = e.code === 'nokey' ? 'Add a key in the API Keys app. A Public key is enough.' : e.message;
  } finally { busy = false; save(); render(); }
}

function row(kind, wch) {
  const l = last[kind + wch.id] || {};
  const name = kind === 'i' ? `<a href="https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&amp;itemID=${encodeURIComponent(wch.id)}">${esc(wch.name)}</a>` : `<a href="https://www.torn.com/page.php?sid=stocks">${esc(wch.acr || wch.name)}</a>`;
  const status = l.err ? `<span class="bad" title="${esc(l.err)}">error</span>` : !l.at ? '<span class="muted">–</span>' : hit(wch, l.price) ? '<span class="good">● hit</span>' : '<span class="muted">waiting</span>';
  return `<tr><td>${name}${kind === 'i' && l.market ? `<div class="muted" style="font-size:12px">avg ${fmt.short(l.market)}</div>` : ''}</td><td class="n">${l.price ? fmt.money(l.price) : '–'}${l.amount ? `<div class="muted" style="font-size:12px">x${fmt.num(l.amount)}</div>` : ''}</td><td class="n">${wch.dir === 'above' ? '≥' : '≤'} ${fmt.money(wch.target)}</td><td>${status}<div class="muted" style="font-size:12px">${l.at ? 'checked ' + fmt.ago(Math.floor(l.at / 1000)) : ''}</div></td><td><button type="button" class="b" data-del="${kind}|${wch.id}" title="Remove">✕</button></td></tr>`;
}

function render() {
  if (!w.isOpen()) return;
  const all = S.items.map((x) => row('i', x)).concat(S.stocks.map((x) => row('s', x)));
  w.set(`
    <div class="row" style="margin-bottom:8px">
      <label class="row"><input type="checkbox" data-on${S.on ? ' checked' : ''}> <b>Watching</b></label>
      <select data-mins>${[2, 5, 10, 15].map((m) => `<option value="${m}"${S.mins === m ? ' selected' : ''}>stocks every ${m} min</option>`).join('')}</select>
      <button type="button" class="b" data-act="check"${busy ? ' disabled' : ''}>Check now</button>
      <span class="note" style="margin:0">${esc(msg)}</span>
    </div>
    <table><thead><tr><th>Watch</th><th class="n">Now</th><th class="n">Target</th><th>Status</th><th></th></tr></thead>
    <tbody>${all.join('') || '<tr><td colspan="5" class="muted">No watches yet. Add an item or a stock below.</td></tr>'}</tbody></table>
    <div class="card" style="margin-top:8px">
      <div class="row">
        <select data-kind><option value="i">Item</option><option value="s">Stock</option></select>
        <input type="text" data-name list="tucc-mw-list" placeholder="Item name or stock acronym" style="flex:1;min-width:150px">
        <datalist id="tucc-mw-list"></datalist>
      </div>
      <div class="row" style="margin-top:6px">
        <select data-dir><option value="below">Alert at or below</option><option value="above">Alert at or above</option></select>
        <input type="number" data-target min="1" placeholder="Target $" style="width:130px">
        <button type="button" class="b pri" data-act="add">Add</button>
      </div>
    </div>
    <div class="note">Item prices are the lowest item market listing. Torn updates item market data about once an hour, so items are checked every 30 minutes and a price can be up to an hour old; stocks are checked at the interval you pick. Up to ${MAX_ITEMS} items. Checks run only while Watching is on and a Torn tab is open; alerts go to the TUCC alerts centre. Links open the market; buying and selling are up to you.</div>`);
  fillList();
}
async function fillList() {
  const kind = (w.body.querySelector('[data-kind]') || {}).value || 'i';
  const dl = w.body.querySelector('#tucc-mw-list');
  if (!dl) return;
  try {
    const opts = kind === 'i' ? (await items()).map((i) => i.name) : (stockList || await stocks()).map((s) => s.acr);
    dl.innerHTML = opts.map((n) => `<option value="${esc(n)}">`).join('');
  } catch (e) { /* the add button reports errors */ }
}

async function add() {
  const kind = w.body.querySelector('[data-kind]').value, name = w.body.querySelector('[data-name]').value.trim();
  const dir = w.body.querySelector('[data-dir]').value, target = Math.round(Number(w.body.querySelector('[data-target]').value));
  if (!name || !(target > 0)) { msg = 'Enter a name and a target price.'; render(); return; }
  try {
    if (kind === 'i') {
      if (S.items.length >= MAX_ITEMS) { msg = `Up to ${MAX_ITEMS} item watches.`; render(); return; }
      const it = (await items()).find((i) => i.name.toLowerCase() === name.toLowerCase() || String(i.id) === name);
      if (!it) { msg = 'No item with that name.'; render(); return; }
      S.items = S.items.filter((x) => x.id !== it.id).concat({ id: it.id, name: it.name, target, dir });
    } else {
      const s = (await stocks()).find((x) => x.acr === name.toUpperCase() || String(x.id) === name || String(x.name).toLowerCase() === name.toLowerCase());
      if (!s) { msg = 'No stock with that acronym.'; render(); return; }
      S.stocks = S.stocks.filter((x) => x.id !== s.id).concat({ id: s.id, acr: s.acr, name: s.name, target, dir });
    }
    msg = ''; save(); schedule(); render();
  } catch (e) { msg = e.code === 'nokey' ? 'Add a key in the API Keys app.' : e.message; render(); }
}

function onClick(e) {
  const d = e.target.closest('[data-del]');
  if (d) { const [k, id] = d.dataset.del.split('|'); if (k === 'i') S.items = S.items.filter((x) => String(x.id) !== id); else S.stocks = S.stocks.filter((x) => String(x.id) !== id); delete last[k + id]; save(); schedule(); render(); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'add') add();
  if (a.dataset.act === 'check') checkAll(true);
}
function onChange(e) {
  if (e.target.matches('[data-on]')) { S.on = e.target.checked; save(); schedule(); render(); }
  else if (e.target.matches('[data-mins]')) { S.mins = Number(e.target.value) || 5; save(); schedule(); }
  else if (e.target.matches('[data-kind]')) fillList();
}

// background checks: only while Watching is on (your switch)
let timer = null;
function schedule() {
  if (timer) { timer.stop(); timer = null; }
  if (!S.on || !(S.items.length || S.stocks.length)) return;
  const ms = S.stocks.length ? Math.max(2, S.mins) * 60000 : ITEM_GAP, mine = {};
  // tucc.every runs once straight away; that first run is skipped (page loads shouldn't all check at once)
  timer = tucc.every(ms, () => { if (!S.on || timer !== mine.h) return; checkAll(false); });
  mine.h = timer;
  const newest = Math.max(0, ...Object.values(last).map((l) => l.at || 0));
  if (Date.now() - newest > ms) setTimeout(() => { if (S.on && timer === mine.h) checkAll(false); }, 5000);
}
schedule();

w.onopen = () => render();
tucc.menu('Open Market Watcher', () => w.open());
if (w.wasOpen()) w.open();
