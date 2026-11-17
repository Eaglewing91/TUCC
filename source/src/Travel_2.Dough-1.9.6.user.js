// ==UserScript==
// @name         Travel 2.Dough – Torn Travel 2.0 Trip Planner
// @namespace    eaglewing.torn.trip.planner
// @version      1.9.6
// @description  Plans the most profitable Travel 2.0 round trip from live market listings and crowd-sourced foreign stock: what to take abroad and sell back to the shop, what to bring home, which country and flight method. Price-fall projections, restock timing, energy fit, alerts, and profit badges on shop, market and Travel Agency pages. Calculates only: every click is yours.
// @author       Eaglewing [571041]
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @connect      api.torn.com
// @connect      yata.yt
// @connect      api.prombot.co.uk
// @connect      torn-intel.com
// @connect      weav3r.dev
// @license      MIT
// @homepageURL  https://github.com/Eaglewing91/travel-2-dough
// @supportURL   https://github.com/Eaglewing91/travel-2-dough/issues
// @updateURL    https://raw.githubusercontent.com/Eaglewing91/travel-2-dough/main/Travel_2.Dough.user.js
// @downloadURL  https://raw.githubusercontent.com/Eaglewing91/travel-2-dough/main/Travel_2.Dough.user.js
// @noframes
// ==/UserScript==

/*
 * Terms of Service (also shown where you enter your API key)
 * ----------------------------------------------------------
 * Data Storage:          Only locally, in your userscript manager: your API key and settings; cached
 *                        item values (10 min), item market listings (30 min; Torn updates them hourly) and
 *                        foreign stock (2 min); 25 hours of
 *                        Black Market price history and stock-change times, used for trends, price
 *                        projections and restock estimates; travel slot counts read from the Travel
 *                        Agency page you viewed (12 h); your travel perks, Business Class Ticket count and
 *                        Torn's Tourism Day and Tiger Day dates and your hunting skill (30 min); the pay and result text of your
 *                        last 60 hunts, read from the hunting page you are viewing; stock-feed outage times.
 * Data Sharing:          Nobody. Your key and your data are sent only to api.torn.com. Item IDs (nothing about
 *                        you) are sent to TornW3B (weav3r.dev) to read public bazaar prices.
 * Purpose of Use:        Competitive advantage: planning profitable travel trades.
 * Key Storage & Sharing: Stored / Used only for automation (sent only to api.torn.com).
 * Key Access Level:      Public is enough for planning. A Minimal key adds travel status, energy bars,
 *                        drug cooldown, travel perks and your Business Class Ticket count (user > travel, bars,
 *                        cooldowns, perks, inventory, skills); Torn's event calendar (Tourism Day, Tiger Day) needs only Public. A Limited
 *                        key adds exact restock times from your own Stock Analysis reports (user > reports,
 *                        read every 30 min). With a lower key those features are simply skipped.
 *
 * Third-party data (read-only, nothing about you is sent): foreign stock and shop prices come from
 * Prometheus (https://prombot.co.uk), TornIntel (https://torn-intel.com) and YATA (https://yata.yt),
 * crowd-sourced by players who opted in to share stock they saw abroad. Bazaar prices come from
 * TornW3B (https://weav3r.dev), read-only, no key sent.
 *
 * Credits
 * -------
 * - Travel 2.Dough is written by Eaglewing [571041]. Copyright (c) 2026 Eaglewing, MIT licence.
 * - Foreign stock and shop prices, crowd-sourced, with thanks to:
 *     - YATA (https://yata.yt) by Kivou [2000607] (https://www.torn.com/profiles.php?XID=2000607)
 *     - Prometheus (https://prombot.co.uk) and its maintainers
 *     - TornIntel (https://torn-intel.com) and its maintainers
 *   and to every player who shares the stock they see abroad with these services.
 * - Bazaar prices: TornW3B (https://weav3r.dev) by Weav3r [1853324] (https://www.torn.com/profiles.php?XID=1853324).
 * - These services are independent of Travel 2.Dough; their data, terms and availability are their own.
 * - Market listings, item values, travel status and perks: the official Torn API (https://www.torn.com/api.html).
 * - Flight times, ticket prices, carry capacities and travel perks: the Torn wiki (https://wiki.torn.com),
 *   written by Torn's players.
 * - Torn, its name and its game data belong to Torn (Chedburn). Travel 2.Dough is a fan-made tool and is
 *   not affiliated with or endorsed by Torn.
 *
 * How this script keeps to Torn's rules
 * -------------------------------------
 * - It never clicks, buys, sells, packs, submits or loads anything on torn.com by itself.
 * - Links open one page when you click them. Packing (Add / Fill) and buying are yours to do.
 * - Badges on shop, market and Travel Agency pages only read the page you are viewing.
 * - Automatic requests go only to api.torn.com, the public stock feeds (Prometheus, TornIntel, YATA)
 *   and TornW3B bazaar prices (item IDs only):
 *     - while the panel is open: every 60 s;
 *     - if you turn on background alerts: every 5 minutes;
 *     - if page badges are on: once when a Torn page loads, for item values and foreign stock only
 *       (cached, so the stock feeds are asked at most every 2 minutes).
 * - TornW3B is asked only while the panel is open: at most 8 items per check, one every 1.5 s, each
 *   answer kept for 60 s (matching TornW3B's own cache) and shared by all your Torn tabs.
 */

(function () {
  'use strict';
  const TTP_VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '1.7.0';
  // Run once per page, even if another copy of the planner is installed (it would add a second badge and double the API calls).
  if (document.documentElement.dataset.ttpLoaded) { console.warn('[Travel 2.Dough] Another copy is already running on this page; this one is stopping. Remove the duplicate in Tampermonkey.'); return; }
  document.documentElement.dataset.ttpLoaded = TTP_VERSION;
  try { if (window.self !== window.top) return; } catch (e) { return; }

  /* ===================== STATIC DATA (Torn wiki, Oct 2026) ===================== */
  const COUNTRIES = [
    { code: 'mex', name: 'Mexico', city: 'Ciudad Juárez', t: [24, 17, 12, 7], cost: 6500 },
    { code: 'cay', name: 'Cayman Islands', city: 'George Town', t: [33, 23, 17, 10], cost: 10000 },
    { code: 'can', name: 'Canada', city: 'Toronto', t: [39, 27, 19, 12], cost: 9000 },
    { code: 'haw', name: 'Hawaii', city: 'Honolulu', t: [127, 89, 63, 38], cost: 11000 },
    { code: 'uni', name: 'United Kingdom', city: 'London', t: [151, 106, 75, 45], cost: 18000 },
    { code: 'arg', name: 'Argentina', city: 'Buenos Aires', t: [158, 111, 79, 47], cost: 21000 },
    { code: 'swi', name: 'Switzerland', city: 'Zurich', t: [166, 116, 83, 50], cost: 27000 },
    { code: 'jap', name: 'Japan', city: 'Tokyo', t: [213, 149, 107, 64], cost: 32000 },
    { code: 'chi', name: 'China', city: 'Beijing', t: [229, 160, 114, 69], cost: 35000 },
    { code: 'uae', name: 'UAE', city: 'Dubai', t: [257, 180, 128, 77], cost: 32000 },
    { code: 'sou', name: 'South Africa', city: 'Johannesburg', t: [282, 197, 141, 85], cost: 40000 },
  ];
  const BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
  const SHORT_NAME = { mex: 'Mexico', cay: 'Cayman', can: 'Canada', haw: 'Hawaii', uni: 'UK', arg: 'Argentina', swi: 'Swiss', jap: 'Japan', chi: 'China', uae: 'UAE', sou: 'SA' };
  const NAME_TO_CODE = {
    mexico: 'mex', 'cayman islands': 'cay', canada: 'can', hawaii: 'haw', 'united kingdom': 'uni', uk: 'uni',
    argentina: 'arg', switzerland: 'swi', japan: 'jap', china: 'chi', uae: 'uae', 'united arab emirates': 'uae', 'south africa': 'sou',
  };
  const METHODS = [
    { id: 'standard', label: 'Standard', idx: 0, base: 10 },
    { id: 'airstrip', label: 'Airstrip', idx: 1, base: 15 },
    { id: 'private', label: 'Private (WLT)', idx: 2, base: 15 },
    { id: 'business', label: 'Business', idx: 3, base: 15 },
  ];
  const WEAPON_ARMOR_TYPES = /^(primary|secondary|melee|defensive|temporary|armor|armour|weapon)$/i;
  // Items you can't take with you when you fly out, so they're never planned as exports (you can still bring them home).
  const NO_EXPORT = /suitcase/i;
  const FLOWER_PLUSH_TYPES = /^(flower|plushie)$/i;
  const FLIGHT_VARIANCE = 0.03;

  const API = 'https://api.torn.com/v2';
  const STOCK_URLS = { prometheus: 'https://api.prombot.co.uk/api/travel', tornintel: 'https://torn-intel.com/api/foreign-stock/travel-table', yata: 'https://yata.yt/api/v1/travel/export/' };
  const ITEM_TTL = 10 * 60 * 1000, STOCK_TTL = 2 * 60 * 1000, LIST_TTL = 30 * 60 * 1000,   /* TUCC: Torn refreshes item market data hourly (Nov 2026) */ BZ_TTL = 60 * 1000;
  // TornW3B is a free community service. Its own responses are cached for ~60 s, so each answer is kept for 60 s
  // (shared by all your Torn tabs), at most 8 items are asked about per check, one every 1.5 s.
  const BZ_ITEMS = 8, BZ_GAP_MS = 1500;
  const W3B_URL = 'https://weav3r.dev/api/marketplace/';
  const HIST_EVERY = 10 * 60 * 1000, HIST_KEEP = 25 * 3600 * 1000;   // TUCC: trends and charts use the last 24 h only
  const STALE_MIN = 30, LISTING_ITEMS = 8, IMPORT_LISTING_ITEMS = 6, LIVE_MAX = 60 * 60 * 1000, MAX_VOL = 0.3;
  const SRC_LABEL = { prometheus: 'Prometheus', tornintel: 'TornIntel', yata: 'YATA' };

  /* ===================== SETTINGS ===================== */
  const K = { key: 'ttp_api_key', settings: 'ttp_settings_v2', items: 'ttp_items_v2', stock: 'ttp_stock_v2', lists: 'ttp_lists_v1', hist: 'ttp_hist_v2', restock: 'ttp_restock_v1', open: 'ttp_open_v1', alerted: 'ttp_alerted_v1' };
  const DEFAULTS = {
    hasAirstrip: false, hasWLT: false, bizTickets: 0, lingerie10: false, mailingBook: false, mailingUntil: '',
    suitcase: 0, job: 'none', excursion: 0, smugglingBook: false, smugglingUntil: '', tourismDay: false, flowerToy7: false,
    reserved: 0, stayMin: 3, sellVia: 'market', customFee: 5, buyPremium: 0, stockShare: 100, budget: 0,
    doExport: true, doImport: true, minProfit: 1, stockSource: 'auto', bmOverrides: '', showAllMethods: false,
    sortBy: 'hour', hideOlderH: 6, liveListings: true, projectPrices: true, conservative: false, usePerks: true, useReports: true, useBazaars: true, bazaarMaxAge: 30,
    alertOn: false, alertPerHour: 500000, alertMargin: 50000, alertBackground: false,
    overlays: true, weaponsArmour: true,
    huntShow: true, huntOn: true, huntPerHunt: 0, huntKeep: 0,
  };
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+n) ? +n : lo));
  const settings = Object.assign({}, DEFAULTS, GM_getValue(K.settings, {}) || {});
  const save = () => GM_setValue(K.settings, settings);
  let apiKey = String(GM_getValue(K.key, '') || '').trim();

  /* ===================== HELPERS ===================== */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (Number.isFinite(n) ? (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US') : '—');
  const short = (n) => {
    if (!Number.isFinite(n)) return '—';
    const a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}b`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}m`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}k`;
    return `${s}$${Math.round(a)}`;
  };
  const dur = (min) => { const m = Math.round(min); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
  const ago = (ms) => { const m = Math.floor((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };
  const clock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const marketLink = (id) => `https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${encodeURIComponent(id)}`;
  const sellFee = () => settings.sellVia === 'bazaar' ? 0 : settings.sellVia === 'custom' ? clamp(settings.customFee, 0, 50) / 100 : settings.sellVia === 'anon' ? 0.15 : 0.05;
  const lower = (s) => String(s || '').trim().toLowerCase();
  const page = () => { const u = new URL(location.href); return { path: u.pathname, sid: lower(u.searchParams.get('sid')), hash: u.hash }; };

  const gmGet = (url) => gmGetH(url, {});
  function gmGetH(url, headers) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method: 'GET', url, headers, timeout: 15000,
          onload: (r) => { try { resolve({ status: r.status, json: JSON.parse(r.responseText) }); } catch (e) { reject(new Error(`Bad response (HTTP ${r.status})`)); } },
          onerror: () => reject(new Error('Connection failed')),
          ontimeout: () => reject(new Error('Timed out')),
        });
      } catch (e) { reject(e); }
    });
  }
  // Torn API: the key goes in the Authorization header (never in the address). Calls pause after
  // "too many requests" or key/IP problems instead of retrying, shared across every tab.
  const BACKOFF = 'ttp_backoff_v1';
  const PAUSE_FOR = { 5: 60, 8: 600, 9: 600, 2: 600, 10: 600, 13: 600, 18: 600 };   // error code -> seconds
  async function torn(path) {
    if (!apiKey) throw new Error('Add your API key in Settings');
    const b = GM_getValue(BACKOFF, null);
    if (b && b.until > Date.now()) throw new Error(`Torn API paused for ${dur((b.until - Date.now()) / 60000 + 0.5)} after: ${b.why}`);
    const r = await gmGetH(`${API}${path}${path.includes('?') ? '&' : '?'}comment=Travel2Dough`, { Authorization: `ApiKey ${apiKey}` });
    if (r.json && r.json.error) {
      const code = Number(r.json.error.code), msg = `Torn API error ${code}: ${r.json.error.error}`;
      if (PAUSE_FOR[code]) GM_setValue(BACKOFF, { until: Date.now() + PAUSE_FOR[code] * 1000, why: msg });
      throw new Error(msg);
    }
    return r.json;
  }

  /* ===================== DATA ===================== */
  const data = { items: null, itemsAt: 0, stock: null, stockAt: 0, stockSrc: '', lists: {}, travel: null, bars: null, cooldowns: null, perks: null, errors: [], warns: [] };

  async function loadItems(force) {
    const c = GM_getValue(K.items, null);
    if (!force && c && Date.now() - c.at < ITEM_TTL) { data.items = c.map; data.itemsAt = c.at; return; }
    const j = await torn('/torn/items');
    const raw = (j && j.items) || {};
    const list = Array.isArray(raw) ? raw : Object.keys(raw).map((k) => Object.assign({ id: Number(k) }, raw[k]));
    const map = {};
    for (const it of list) {
      const mp = it.value && it.value.market_price != null ? it.value.market_price : (it.market_value != null ? it.market_value : null);
      // value.shops lists every NPC shop selling the item, by country (e.g. Japan → "Black Market").
      const shops = {};
      for (const sh of (it.value && Array.isArray(it.value.shops) ? it.value.shops : [])) {
        const code = NAME_TO_CODE[lower(sh.country)];
        if (code && sh.shop) shops[code] = String(sh.shop);
      }
      map[it.id] = { id: it.id, name: it.name, type: String(it.type || ''), mp: Number(mp) || 0, sp: Number(it.value && it.value.sell_price) || 0, shops };
    }
    data.items = map; data.itemsAt = Date.now();
    GM_setValue(K.items, { at: data.itemsAt, map });
  }

  // Any timestamp a feed might send: seconds, milliseconds, or a date string. Returns ms (0 if unknown).
  function toMs(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) { const n = Number(v); return n > 1e12 ? n : n * 1000; }
    const t = Date.parse(String(v)); return isNaN(t) ? 0 : t;
  }
  function parseStock(json) {
    const out = {}, stocks = (json && (json.stocks || json.data || json.countries)) || {};
    for (const key of Object.keys(stocks)) {
      const c = stocks[key] || {};
      const code = BY_CODE[lower(key)] ? lower(key) : NAME_TO_CODE[lower(key).replace(/_/g, ' ')] || lower(key).slice(0, 3);   // 'mex', 'mexico', 'Mexico', 'cayman_islands'…
      const list = c.stocks || c.items || [];
      let update = toMs(c.update != null ? c.update : c.updated != null ? c.updated : c.timestamp != null ? c.timestamp : c.last_updated);
      if (!update) update = Math.max(0, ...list.map((it) => toMs(it.update || it.updated || it.timestamp || it.last_updated)));   // per-item times
      out[code] = { update, items: list.map((it) => ({ id: Number(it.id || it.item_id), name: it.name, qty: Number(it.quantity != null ? it.quantity : it.stock) || 0, cost: Number(it.cost != null ? it.cost : it.price) || 0, nextRestock: it.nextRestock || it.next_restock || null })).filter((it) => it.id) };
    }
    return out;
  }
  // Each stock item remembers its country, so shop lookups (Black Market or not) are per country.
  const tagCodes = (stock) => { for (const code of Object.keys(stock || {})) for (const it of stock[code].items) it.code = code; return stock; };
  async function loadStock(force) {
    const c = GM_getValue(K.stock, null);
    if (!force && c && c.feeds && Date.now() - c.at < STOCK_TTL) { data.stock = tagCodes(c.data); data.stockAt = c.at; data.stockSrc = c.src; data.feeds = c.feeds || null; return; }
    // Read every enabled feed and keep the NEWEST report for each country, so a long flight starts from the freshest data.
    const srcs = STOCK_URLS[settings.stockSource] ? [settings.stockSource] : ['prometheus', 'tornintel', 'yata'];
    const errs = [];
    const results = await Promise.all(srcs.map(async (src) => {
      try { const r = await gmGet(STOCK_URLS[src]); const d = parseStock(r.json); if (!Object.keys(d).length) throw new Error('empty'); return { src, d }; }
      catch (e) { errs.push(`${SRC_LABEL[src]}: ${e.message}`); return { src, d: {}, failed: true, err: e.message }; }
    }));
    // Remember when each feed started failing: a brief outage is shown quietly in the status line, a long one as a warning.
    const down = GM_getValue('ttp_feed_down_v1', {}) || {};
    for (const r of results) { if (r.failed) down[r.src] = down[r.src] || Date.now(); else delete down[r.src]; }
    GM_setValue('ttp_feed_down_v1', down);
    data.feedDown = Object.keys(down).map((k) => ({ name: SRC_LABEL[k], since: down[k] }));
    const merged = {};
    for (const r of results) for (const code of Object.keys(r.d)) {
      if (!merged[code] || r.d[code].update > merged[code].update) merged[code] = Object.assign({}, r.d[code], { src: r.src });
    }
    if (Object.keys(merged).length) {
      for (const f of data.feedDown || []) if (srcs.length > 1 && Date.now() - f.since > 15 * 60000) data.warns.push(`${f.name} has been unreachable for ${dur((Date.now() - f.since) / 60000)}; using the other stock feed.`);
      // Per-feed summary: answered or not, how many countries it had, how many of them were the newest.
      data.feeds = results.map((r) => ({ src: r.src, name: SRC_LABEL[r.src], ok: !r.failed, err: r.err || '', countries: Object.keys(r.d).length, won: Object.values(merged).filter((st) => st.src === r.src).length, newest: Math.max(0, ...Object.values(r.d).map((st) => st.update)) }));
      const used = [...new Set(Object.values(merged).map((st) => st.src))].map((k) => SRC_LABEL[k]).join(' + ');
      data.stock = tagCodes(merged); data.stockAt = Date.now(); data.stockSrc = used;
      GM_setValue(K.stock, { at: data.stockAt, src: used, data: merged, feeds: data.feeds });
      recordHistory(merged, c && c.data);
      return;
    }
    if (c) { data.stock = tagCodes(c.data); data.stockAt = c.at; data.stockSrc = c.src + ' (cached)'; return; }
    throw new Error(`Couldn't load foreign stock (${errs.join('; ') || 'unknown'})`);
  }

  // Item market listings for the shortlisted export items (Torn updates them hourly): depth-aware cost of buying N units.
  async function loadListings(ids) {
    const store = GM_getValue(K.lists, {}) || {};
    const want = [...new Set(ids)].filter((id) => !(store[id] && Date.now() - store[id].at < LIST_TTL)).slice(0, LISTING_ITEMS + IMPORT_LISTING_ITEMS);
    for (const id of want) {
      try {
        const j = await torn(`/market/${id}/itemmarket`);
        const l = (j && j.itemmarket && j.itemmarket.listings) || [];
        const listings = l.map((x) => ({ price: Number(x.price) || 0, amount: Number(x.amount != null ? x.amount : x.quantity) || 0 })).filter((x) => x.price > 0 && x.amount > 0).sort((a, b) => a.price - b.price);
        store[id] = { at: Date.now(), listings };
      } catch (e) { data.warns.push(`Item market listings for item ${id}: ${e.message}`); }
    }
    for (const k of Object.keys(store)) if (!store[k] || Date.now() - store[k].at > 60 * 60000) delete store[k];   // TUCC: drop listings over an hour old
    GM_setValue(K.lists, store);
    data.lists = store;
  }
  // Cost of the cheapest n units from live listings; falls back to market value.
  // Cost of buying n: cheapest first across item market listings and recent bazaar listings (TornW3B).
  function buyCost(id, n, mp) {
    const l = freshListings(id), bz = freshBazaar(id);
    const pool = [];
    if (l) for (const x of l.listings) pool.push({ price: x.price, amount: x.amount, src: 'm' });
    if (bz) for (const x of bz.listings) pool.push({ price: x.price, amount: x.quantity, src: 'b', pid: x.player_id, pname: x.player_name, checked: x.checked });
    if (!pool.length) return { total: n * mp * (1 + settings.buyPremium / 100), live: false, avail: Infinity, cheapest: mp };
    pool.sort((a, b) => a.price - b.price);
    let left = n, total = 0, got = 0, fromBz = 0, seller = null;
    const used = new Map();
    for (const x of pool) {
      const take = Math.min(left, x.amount); if (take <= 0) continue;
      total += take * x.price; got += take; left -= take;
      if (x.src === 'b') { fromBz += take; if (!seller) seller = x; used.set(x, take); }
      if (!left) break;
    }
    const sellers = pool.filter((x) => x.src === 'b').slice(0, 3).map((x) => ({ pid: x.pid, pname: x.pname, price: x.price, amount: x.amount, checked: x.checked, take: used.get(x) || 0 }));
    const avail = pool.reduce((s, x) => s + x.amount, 0);
    if (got < n) total += (n - got) * pool[pool.length - 1].price;
    return { total, live: true, at: l ? l.at : bz.at, avail, cheapest: pool[0].price, got, fromBz, seller, sellers, bzAvg: bz ? bz.avg : null };
  }
  // Bazaar listings for an item, only those checked recently enough to trust.
  function freshBazaar(id) {
    if (!settings.useBazaars) return null;
    const b = (data.bazaars || {})[id];
    if (!b || Date.now() - b.at > 5 * 60 * 1000) return null;   // older bazaar data isn't used
    const maxAge = clamp(settings.bazaarMaxAge, 5, 1440) * 60000;
    const listings = b.listings.filter((x) => x.price > 0 && x.quantity > 0 && (!x.checked || Date.now() - x.checked <= maxAge));
    return { at: b.at, avg: b.avg, listings };
  }
  let bzRunning = false;
  function bazaarsInBackground(ids) {
    if (!settings.useBazaars || bzRunning) return;
    bzRunning = true;
    loadBazaars(ids).then(() => {
      bzRunning = false;
      if (refreshing || !data.items || !data.stock) return;
      lastPlans = allPlans();
      if (panel.classList.contains('open')) render();
      overlays();
    }, () => { bzRunning = false; });
  }
  async function loadBazaars(ids) {
    if (!settings.useBazaars) return;
    const store = GM_getValue('ttp_bazaar_v1', {}) || {};
    const want = [...new Set(ids)].filter((id) => !(store[id] && Date.now() - store[id].at < BZ_TTL)).slice(0, BZ_ITEMS);
    let failed = 0;
    for (const [n, id] of want.entries()) {
      if (n) await new Promise((r) => setTimeout(r, BZ_GAP_MS));   // spaced out, never a burst
      try {
        const r = await gmGet(`${W3B_URL}${encodeURIComponent(id)}?limit=50`);
        const j = r.json || {};
        if (!Array.isArray(j.listings)) throw new Error(`HTTP ${r.status}`);
        store[id] = { at: Date.now(), avg: Number(j.bazaar_average) || 0, listings: j.listings.map((x) => ({ price: Number(x.price) || 0, quantity: Number(x.quantity) || 0, player_id: Number(x.player_id) || 0, player_name: String(x.player_name || ''), checked: toMs(x.last_checked || x.content_updated) })).sort((a, b) => a.price - b.price) };
      } catch (e) { failed++; }
    }
    for (const k of Object.keys(store)) if (Date.now() - store[k].at > 60 * 60000) delete store[k];
    GM_setValue('ttp_bazaar_v1', store);
    data.bazaars = store;
    data.bazaarFail = failed && failed === want.length ? 'TornW3B (bazaar prices) is not answering; using the item market only.' : '';
  }
  // Listings count as LIVE only while they are under 5 minutes old; older ones fall back to Torn's market value.
  function freshListings(id) {
    const l = data.lists[id];
    return settings.liveListings && l && l.listings.length && Date.now() - l.at <= LIVE_MAX ? l : null;
  }
  // What an import would sell for at home: the lowest current listing (the price you'd have to match), else market value.
  function homeSell(id, mp) {
    const l = freshListings(id);
    return l ? { price: l.listings[0].price, live: true, at: l.at } : { price: mp, live: false };
  }

  // Perks (API, Minimal key): travel capacity and flight-time perks, so you don't have to enter them by hand.
  const PERK_TTL = 30 * 60 * 1000;
  async function loadPerks() {
    if (!settings.usePerks) return;
    const c = GM_getValue('ttp_perks_v1', null);
    data.perksErr = '';
    // Cached perks are reused only if they're non-empty and belong to the key in use now.
    if (c && c.list && c.list.length && c.key === apiKey.slice(-4) && Date.now() - c.at < PERK_TTL) { data.perks = c.list; return; }
    try {
      const j = await torn('/user/perks');
      const src = (j && (j.perks || j)) || {};
      const list = [];
      for (const k of Object.keys(src)) if (Array.isArray(src[k])) for (const t of src[k]) if (typeof t === 'string') list.push({ kind: k.replace(/_perks$/, ''), text: t });
      data.perks = list; data.perksErr = list.length ? '' : `Torn returned no perks (keys in the reply: ${Object.keys(j || {}).join(', ') || 'none'})`;
      if (list.length) GM_setValue('ttp_perks_v1', { at: Date.now(), list, key: apiKey.slice(-4) });
    } catch (e) { data.perks = c && c.key === apiKey.slice(-4) ? c.list : null; data.perksErr = e.message; }
  }
  // Stock Analysis reports (API v2 user/reports, Limited key): exact restock times for the items they cover.
  // Read at most every 30 minutes; without a report (or with a lower key) Travel keeps its own estimates.
  const REPORT_TTL = 30 * 60 * 1000;
  async function loadReports() {
    data.reportsErr = '';
    if (!settings.useReports || !apiKey) { data.reports = null; return; }
    const c = GM_getValue('ttp_reports_v1', null);
    if (c && c.key === apiKey.slice(-4) && Date.now() - c.at < (c.err ? 6 * 3600000 : REPORT_TTL)) { data.reports = c.map || null; data.reportsErr = c.err || ''; return; }
    try {
      const j = await torn('/user/reports?cat=stockanalysis&limit=5');
      const map = {}, byName = Object.fromEntries(COUNTRIES.map((x) => [x.name.toLowerCase(), x.code]));
      for (const r of ((j && j.reports) || []).slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))) {
        for (const x of ((r.report && r.report.items) || [])) {
          const code = byName[String(x.country || '').toLowerCase()], id = x.item && Number(x.item.id), ts = Number(x.restock_timestamp);
          if (code && id && ts > 0 && !(`${code}:${id}` in map)) map[`${code}:${id}`] = ts * 1000;   // newest report wins
        }
      }
      data.reports = map;
      GM_setValue('ttp_reports_v1', { at: Date.now(), key: apiKey.slice(-4), map });
    } catch (e) {
      data.reports = null;
      // A key without access (Torn errors 16 / 7) won't change soon: wait 6 hours before asking again.
      const noAccess = /error (16|7):/.test(e.message);
      data.reportsErr = noAccess ? 'Exact restock times need a Limited key.' : e.message;
      GM_setValue('ttp_reports_v1', { at: noAccess ? Date.now() : Date.now() - REPORT_TTL + 5 * 60000, key: apiKey.slice(-4), map: null, err: data.reportsErr });
    }
  }
  // Turn perk text into numbers. Suitcase, job, faction and book perks all read "+ N travel items/capacity".
  function perkInfo() {
    const list = data.perks;
    if (!list || !list.length) return null;
    let slots = 0, flowerPlush = 0, timeCut = 0, airstrip = false, wlt = false, freeBiz = false;
    const parts = [], methods = [], by = {};   // by: perk kind (enhancer, faction, job, book, ...) -> travel slots
    for (const p of list) {
      const t = p.text;
      if (/airstrip/i.test(t)) { airstrip = true; methods.push(`Airstrip (${p.kind})`); continue; }
      if (/private (jet|flight|plane)|wlt/i.test(t)) { wlt = true; methods.push(`Private flights (${p.kind})`); continue; }
      if (/business class/i.test(t) && /(free|no cost|without)/i.test(t)) { freeBiz = true; methods.push(`Free Business (${p.kind})`); continue; }
      if (!/travel/i.test(t)) continue;
      const n = Number((/(\d+)/.exec(t) || [])[1]) || 0;
      if (/flower|plush/i.test(t)) { if (/capacity|items?/i.test(t)) { flowerPlush = Math.max(flowerPlush, n); parts.push(`${t} (${p.kind})`); } continue; }
      if (/(capacity|items?)/i.test(t) && n) { slots += n; by[p.kind] = (by[p.kind] || 0) + n; parts.push(`+${n} ${p.kind}`); continue; }
      if (/time/i.test(t) && /%/.test(t) && /(reduc|decreas|-|less|faster)/i.test(t)) { timeCut = Math.max(timeCut, n / 100); parts.push(`−${n}% flight time (${p.kind})`); }
    }
    return { slots, flowerPlush, timeCut, parts, airstrip, wlt, freeBiz, methods, by };
  }
  // Extras (API, every 30 min): Business Class Tickets in your inventory (Minimal key) and Tourism Day dates
  // from Torn's event calendar (Public key). Each part fails on its own and the box stays yours to set.
  const EXTRA_TTL = 30 * 60 * 1000;
  async function loadExtras() {
    if (!settings.usePerks || !apiKey) { data.extra = null; return; }
    const c = GM_getValue('ttp_extra_v2', null);
    if (c && c.key === apiKey.slice(-4) && Date.now() - c.at < EXTRA_TTL) { data.extra = c; return; }
    const x = { at: Date.now(), key: apiKey.slice(-4), tickets: null, tourism: null, tiger: null, hunting: null, errs: [] };
    try {
      const j = await torn('/torn/calendar');
      const all = (j && j.calendar && j.calendar.events) || [];
      const win = (re) => all.filter((e) => re.test(e.title || '')).map((e) => ({ start: Number(e.start) * 1000, end: Number(e.end) * 1000, title: e.title }));
      x.tourism = win(/tourism/i);
      x.tiger = win(/tiger/i);
    } catch (e) { x.errs.push('Torn calendar: ' + e.message); }
    try {
      const j = await torn('/user/skills');
      const h = ((j && j.skills) || []).find((k) => k.slug === 'hunting');
      x.hunting = h ? Number(h.level) : 0;
    } catch (e) { x.huntErr = /error 16/.test(e.message) ? 'needs Minimal key' : 'not read'; x.errs.push('Hunting skill: ' + e.message); }
    try {
      const t = Object.values(data.items || {}).find((i) => /^business class ticket$/i.test(i.name));
      if (t) {
        let n = 0, offset = 0;
        for (let pg = 0; pg < 4; pg++) {
          const j = await torn(`/user/inventory?cat=${encodeURIComponent(t.type || 'Special')}&limit=250&offset=${offset}`);
          const items = (j && j.inventory && j.inventory.items) || [];
          for (const it of items) if (Number(it.id) === Number(t.id) || /^business class ticket$/i.test(it.name || '')) n += Number(it.amount) || 0;
          if (items.length < 250) break;
          offset += 250;
        }
        x.tickets = n;
      }
    } catch (e) { x.errs.push('Business Class Tickets: ' + (/error 16/.test(e.message) ? 'needs a Minimal key' : e.message)); }
    data.extra = x;
    GM_setValue('ttp_extra_v2', x);
  }
  // What the API says for each setting box (null = the API can't tell; the box is yours).
  function apiValues() {
    if (!settings.usePerks) return null;
    const pk = perkInfo(), x = data.extra, now = Date.now(), v = {};
    if (pk) {
      const b = pk.by;
      v.suitcase = clamp(b.enhancer || 0, 0, 3);
      v.excursion = clamp(b.faction || 0, 0, 10);
      v.jobSlots = b.job || 0;
      v.smugglingBook = (b.book || 0) >= 10 ? true : null;
      v.mailingBook = pk.timeCut > 0 ? true : null;
      v.hasAirstrip = pk.airstrip ? true : null;
      v.hasWLT = pk.wlt ? true : null;
      v.lingerie10 = pk.freeBiz ? true : null;
      v.flowerToy7 = pk.flowerPlush > 0 ? true : null;
    }
    if (x && x.tickets != null) v.bizTickets = x.tickets;
    if (x && x.tourism) { const on = x.tourism.find((e) => e.start <= now && now < e.end); v.tourismDay = !!on; v.tourismEnd = on ? on.end : null; }
    return v;
  }
  // The value a setting has right now: the API's where it has one, else yours.
  function eff(k) {
    const v = apiValues();
    if (v && v[k] != null) return typeof v[k] === 'boolean' && k !== 'tourismDay' ? (v[k] || !!settings[k]) : v[k];
    return settings[k];
  }
  // Travel status, energy and cooldowns: one reading per minute, shared by every page and tab.
  const USER_CACHE = 'ttp_user_v1', USER_TTL = 60 * 1000;
  function useUserCache(c) {
    data.travel = c.travel ? Object.assign({}, c.travel, { timeLeft: c.travel.arrive ? Math.max(0, c.travel.arrive - Math.floor(Date.now() / 1000)) : c.travel.timeLeft }) : null;
    data.bars = c.bars; data.cooldowns = c.cooldowns
      ? Object.fromEntries(Object.entries(c.cooldowns).map(([k, v]) => [k, typeof v === 'number' ? Math.max(0, v - Math.floor((Date.now() - c.at) / 1000)) : v])) : null;
  }
  async function loadUser() {
    const c = GM_getValue(USER_CACHE, null);
    if (c && c.key === apiKey.slice(-4) && Date.now() - c.at < USER_TTL) { useUserCache(c); return; }
    if (!(await iFetch())) {   // another tab is fetching: use its result
      const got = await waitForUserCache();
      if (got) { useUserCache(got); return; }
      if (c && c.key === apiKey.slice(-4)) { useUserCache(c); return; }
    }
    data.travel = null; data.bars = null; data.cooldowns = null;
    if (!apiKey) return;
    try {
      const j = await torn('/user/travel');
      const t = j && j.travel;
      if (t) {
        const code = NAME_TO_CODE[lower(t.destination)] || null;
        const arr = Number(t.arrival_at || t.timestamp) || 0;
        const left = Number(t.time_left) || Math.max(0, arr - Math.floor(Date.now() / 1000));
        data.travel = { code, destination: t.destination, timeLeft: left, method: t.method || '', arrive: left ? Math.floor(Date.now() / 1000) + left : 0 };
      }
    } catch (e) { /* optional */ }
    try {
      const j = await torn('/user/bars');
      const b = j && j.bars;
      if (b && b.energy) data.bars = { energy: b.energy, nerve: b.nerve, at: Date.now() };
    } catch (e) { /* optional */ }
    try {
      const j = await torn('/user/cooldowns');
      if (j && j.cooldowns) data.cooldowns = j.cooldowns;
    } catch (e) { /* optional */ }
    GM_setValue(USER_CACHE, { at: Date.now(), key: apiKey.slice(-4), travel: data.travel, bars: data.bars, cooldowns: data.cooldowns });
  }
  // 2. One fetching tab: a short shared lock so two tabs never fetch the same thing at once.
  const TAB_ID = Math.random().toString(36).slice(2), LOCK = 'ttp_fetch_lock_v1';
  async function iFetch() {
    const l = GM_getValue(LOCK, null);
    if (l && l.owner !== TAB_ID && l.until > Date.now()) return false;
    GM_setValue(LOCK, { owner: TAB_ID, until: Date.now() + 8000 });
    await new Promise((r) => setTimeout(r, 150));   // give a tab that claimed at the same moment time to show up
    const w = GM_getValue(LOCK, null);
    if (!w || w.owner === TAB_ID) return true;
    // Both tabs claimed at once: every tab picks the same winner (lowest id), so exactly one fetches.
    if (TAB_ID < w.owner) { GM_setValue(LOCK, { owner: TAB_ID, until: Date.now() + 8000 }); return true; }
    return false;
  }
  // A tab that lost the lock waits briefly for the winner's result instead of going without.
  async function waitForUserCache() {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const c = GM_getValue(USER_CACHE, null);
      if (c && c.key === apiKey.slice(-4) && Date.now() - c.at < USER_TTL) return c;
    }
    return null;
  }
  const releaseLock = () => { const l = GM_getValue(LOCK, null); if (l && l.owner === TAB_ID) GM_setValue(LOCK, null); };

  /* ===================== HISTORY: prices, restocks ===================== */
  function recordHistory(stock, prev) {
    if (!data.items) return;
    const h = GM_getValue(K.hist, []) || [];
    const last = h[h.length - 1];
    if (!last || Date.now() - last.t >= HIST_EVERY) {
      const snap = { t: Date.now(), p: {} };
      for (const code of Object.keys(stock)) for (const it of stock[code].items) if (isBM(it)) (snap.p[code] = snap.p[code] || {})[it.id] = it.cost;
      h.push(snap);
      GM_setValue(K.hist, h.filter((s) => Date.now() - s.t < HIST_KEEP));
    }
    // Restock inference: a quantity that goes UP since the last report means a restock happened.
    if (prev) {
      const rs = GM_getValue(K.restock, {}) || {};
      for (const code of Object.keys(stock)) {
        const old = prev[code]; if (!old) continue;
        for (const it of stock[code].items) {
          const o = old.items.find((x) => x.id === it.id);
          if (o && it.qty > o.qty + 5) {
            const k = `${code}:${it.id}`, e = rs[k] || { times: [] };
            if (!e.times.length || stock[code].update - e.times[e.times.length - 1] > 10 * 60 * 1000) { e.times.push(stock[code].update); e.times = e.times.slice(-12); e.qty = Math.max(e.qty || 0, it.qty); rs[k] = e; }
          }
        }
      }
      GM_setValue(K.restock, rs);
    }
  }
  function series(code, id) {
    return (GM_getValue(K.hist, []) || []).filter((s) => s.p[code] && s.p[code][id] != null).map((s) => ({ t: s.t, v: s.p[code][id] }));
  }
  function trend24(code, id, cost) {
    const pts = series(code, id), target = Date.now() - 24 * 3600 * 1000;
    let best = null;
    for (const p of pts) if (!best || Math.abs(p.t - target) < Math.abs(best.t - target)) best = p;
    if (!best || Date.now() - best.t < 3 * 3600 * 1000 || !best.v) return null;
    return { pct: ((cost - best.v) / best.v) * 100, hours: Math.round((Date.now() - best.t) / 3600000) };
  }
  // Price velocity (% per hour) from the last ~3 hours of snapshots; used to project the price at landing.
  function velocity(code, id) {
    const pts = series(code, id).filter((p) => Date.now() - p.t < 3 * 3600 * 1000);
    if (pts.length < 2) return null;
    const a = pts[0], b = pts[pts.length - 1];
    const hrs = (b.t - a.t) / 3600000;
    if (hrs < 0.4 || !a.v) return null;
    return ((b.v - a.v) / a.v) / hrs;
  }
  // Typical size of hourly price moves over the last 24h (fraction per hour); drives the landing-time range.
  function volatility(code, id) {
    const pts = series(code, id).filter((p) => Date.now() - p.t < 24 * 3600 * 1000);
    if (pts.length < 3) return null;
    let sum = 0, n = 0;
    for (let i = 1; i < pts.length; i++) {
      const hrs = (pts[i].t - pts[i - 1].t) / 3600000;
      if (hrs <= 0 || !pts[i - 1].v) continue;
      sum += Math.abs((pts[i].v - pts[i - 1].v) / pts[i - 1].v) / hrs; n++;
    }
    return n ? Math.min(MAX_VOL, sum / n) : null;
  }
  // Price expected at landing, plus a low–high range that widens with flight time.
  function projected(code, id, cost, minutesAhead) {
    const h = minutesAhead / 60;
    const v = settings.projectPrices ? velocity(code, id) : null;
    const mid = v == null ? cost : Math.max(0, cost * (1 + v * h));
    let vol = settings.projectPrices ? volatility(code, id) : null;
    if (vol == null && v != null) vol = Math.min(MAX_VOL, Math.abs(v));
    if (vol == null) return { price: mid, v, low: mid, high: mid, vol: null };
    const spread = mid * vol * h;
    return { price: mid, v, low: Math.max(0, mid - spread), high: mid + spread, vol };
  }
  function restockInfo(code, it) {
    // Exact time from your own Stock Analysis report (Torn API, Nov 2026), when it covers this item.
    const rep = data.reports && data.reports[`${code}:${it.id}`];
    if (rep && rep > Date.now()) return { text: `restocks in ${dur((rep - Date.now()) / 60000)} (your Stock Analysis report)`, at: rep, report: true };
    const live = it.nextRestock ? Date.parse(it.nextRestock) : NaN;
    const e = (GM_getValue(K.restock, {}) || {})[`${code}:${it.id}`];
    if (!isNaN(live) && live > Date.now()) return { text: `restocks in ${dur((live - Date.now()) / 60000)}`, at: live, qty: e && e.qty };
    if (!e || e.times.length < 2) return null;
    const gaps = e.times.slice(1).map((t, i) => t - e.times[i]);
    const interval = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const lastT = e.times[e.times.length - 1];
    let next = lastT + interval; while (next < Date.now()) next += interval;
    return { text: `~every ${dur(interval / 60000)}, next ~${dur((next - Date.now()) / 60000)} (est.)`, at: next, est: true, qty: e.qty };
  }

  /* ===================== RULES & MATHS ===================== */
  const bmNames = () => settings.bmOverrides.split(',').map(lower).filter(Boolean);
  const itemInfo = (id) => (data.items && data.items[id]) || null;
  // Shop name from Torn's API for this item in this country ("Black Market", or another shop), if listed.
  const shopFor = (it) => { const info = itemInfo(it.id); return info && info.shops && it.code ? info.shops[it.code] || null : null; };
  function isBM(it) {
    if (bmNames().includes(lower(it.name))) return true;           // your manual override always wins
    const shop = shopFor(it);
    if (shop) return /black\s*market/i.test(shop);                  // confirmed by Torn's API
    const info = itemInfo(it.id); return /^drug$/i.test(info ? info.type : '');   // fallback guess
  }
  const sellBack = (it) => (isBM(it) ? it.cost : Math.floor(it.cost * 0.75));
  function stockFactor(update) {
    const ageMin = (Date.now() - update) / 60000;
    return ageMin <= STALE_MIN ? 1 : Math.max(0.3, 1 - (ageMin - STALE_MIN) / 240);
  }
  function capacity(method) {
    const seen = settings.seenSlots && settings.seenSlots[method.id];
    if (seen && seen.n > 0 && Date.now() - seen.at < 12 * 3600000) return seen.n;   // what Torn's Travel Agency showed you
    const pk = settings.usePerks ? perkInfo() : null;
    if (pk) { let c = method.base + pk.slots; if (eff('tourismDay')) c *= 2; return c; }   // read from your perks via the API
    let cap = method.base + [0, 1, 2, 3][clamp(settings.suitcase, 0, 3)];
    if (settings.job === 'lingerie3') cap += 2;
    if (settings.job === 'cruise3') cap += 2;
    if (settings.job === 'cruise10') cap += 5;
    cap += clamp(settings.excursion, 0, 10);
    if (settings.smugglingBook) cap += 10;
    if (eff('tourismDay')) cap *= 2;
    return cap;
  }
  function methodAvailable(m) {
    const pk = settings.usePerks ? perkInfo() : null;
    if (m.id === 'airstrip') return eff('hasAirstrip') || !!(pk && pk.airstrip);
    if (m.id === 'private') return eff('hasWLT') || !!(pk && pk.wlt);
    if (m.id === 'business') return eff('lingerie10') || eff('bizTickets') > 0 || !!(pk && pk.freeBiz);
    return true;
  }
  // Times and prices read from the Travel Agency page you viewed (Travel 2.0 can change them). Times are stored
  // without your time-cut perks, so they stay right when a book runs out; prices are kept 30 days, times 30 days.
  const SEEN_TTL = 30 * 864e5;
  const timeCut = () => { const pk = settings.usePerks ? perkInfo() : null; return pk && pk.timeCut ? pk.timeCut : eff('mailingBook') ? 0.25 : 0; };
  const seenFlight = (code, m) => { const v = ((settings.seenTimes || {})[code] || {})[m.id]; return v && Date.now() - v.at < SEEN_TTL ? v.base : null; };
  const seenCost = (code) => { const v = (settings.seenCosts || {})[code]; return v && Date.now() - v.at < SEEN_TTL ? v.cost : null; };
  function ticketCost(country, m) {
    if (m.id === 'standard') { const c = seenCost(country.code); return c != null ? c : country.cost; }
    if (m.id === 'business') {
      if (eff('lingerie10') || (settings.usePerks && perkInfo() && perkInfo().freeBiz)) return 0;
      const t = Object.values(data.items || {}).find((i) => /^business class ticket$/i.test(i.name));
      return t ? t.mp : 0;
    }
    return 0;
  }
  const flightMin = (country, m) => {
    const seen = seenFlight(country.code, m);
    return (seen != null ? seen : country.t[m.idx]) * (1 - timeCut());
  };
  function perkWarnings(roundMin) {
    const w = [], end = Date.now() + roundMin * 60000;
    const chk = (on, until, label) => { if (!on || !until) return; const t = Date.parse(until); if (!isNaN(t) && t < end) w.push(`${label} ends ${clock(t)}, before this trip finishes: its slots vanish mid-trip (you must be within capacity to fly home).`); };
    chk(settings.smugglingBook, settings.smugglingUntil, 'Smuggling book');
    chk(settings.mailingBook, settings.mailingUntil, 'Mailing book');
    if (eff('tourismDay')) { const av = apiValues(), tEnd = av && av.tourismEnd ? av.tourismEnd : (() => { const mid = new Date(); mid.setUTCHours(24, 0, 0, 0); return mid.getTime(); })(); if (tEnd < end) w.push(`Tourism Day ends ${clock(tEnd)}, before this trip finishes: doubled slots vanish mid-trip.`); }
    return w;
  }
  // Energy from the sidebar bar on the page you're viewing (updates the moment you train), else the API's last reading.
  function sidebarEnergy() {
    const bar = document.querySelector('#barEnergy, a[id*="barEnergy"], [class*="energy___"][class*="bar"], [aria-label^="Energy"]');
    if (!bar) return null;
    // Read only the "25/150" value, never the timer beside it ("25/150" + "03:12:00" must not become 15003).
    const valEl = bar.querySelector('[class*="bar-value"], [class*="value"]');
    const texts = valEl ? [valEl.textContent] : [...bar.querySelectorAll('*')].filter((el) => !el.children.length).map((el) => el.textContent);
    texts.push(bar.getAttribute('aria-label') || '');
    let m = null;
    for (const t of texts) { m = /^\D*?(\d[\d,]*)\s*\/\s*(\d[\d,]*)(?!\d)/.exec((t || '').trim()); if (m) break; }
    if (!m) return null;
    const current = Number(m[1].replace(/,/g, '')), maximum = Number(m[2].replace(/,/g, ''));
    const api = data.bars && data.bars.energy && Number(data.bars.energy.maximum);
    if (api && maximum !== api) return null;            // doesn't match Torn's own maximum: don't trust it
    if (!api && (maximum < 50 || maximum > 1000)) return null;
    return maximum > 0 ? { current, maximum } : null;
  }
  function energyNow() {
    const api = data.bars && data.bars.energy;
    const inc = Number(api && api.increment) || 5, intv = Number(api && api.interval) || 600;
    const side = sidebarEnergy();
    if (side) {
      const missing = Math.max(0, side.maximum - side.current);
      return { current: side.current, maximum: side.maximum, inc, intv, full: Math.ceil(missing / inc) * intv, src: 'page' };
    }
    if (!api || !api.maximum) return null;
    const elapsed = (Date.now() - (data.bars.at || Date.now())) / 1000;   // count down since the API reading
    return { current: api.current, maximum: api.maximum, inc, intv, full: Math.max(0, (Number(api.fulltime) || 0) - elapsed), src: 'api' };
  }
  function energyFit(roundMin) {
    const e = energyNow();
    if (!e) return null;
    const full = e.full;                                  // seconds until full
    const inc = e.inc, intv = e.intv;
    const tripSec = roundMin * 60;
    const wastedSec = Math.max(0, tripSec - full);
    const wasted = Math.floor(wastedSec / intv) * inc;
    const departIn = Math.max(0, full - tripSec);
    return { wasted, departIn, full, current: e.current, maximum: e.maximum, src: e.src };
  }
  // Redraw the panel as soon as the sidebar energy changes (e.g. after training). Display only.
  let lastEnergyText = null;
  function watchEnergy() {
    const bar = document.querySelector('#barEnergy, a[id*="barEnergy"], [class*="energy___"][class*="bar"], [aria-label^="Energy"]');
    if (!bar || bar.__ttpWatched) return;
    bar.__ttpWatched = true;
    new MutationObserver(() => {
      const e = sidebarEnergy(), t = e ? `${e.current}/${e.maximum}` : '';   // only the numbers, not timers in the bar
      if (!t || t === lastEnergyText) return;
      lastEnergyText = t;
      if (panel.classList.contains('open') && data.items && data.stock) { lastPlans = allPlans(); render(); }
    }).observe(bar, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label'] });
  }

  /* ===================== HUNTING (South Africa) ===================== */
  // Torn wiki: a hunt costs 10 energy and $500; skill 1-100; Beginner, then Standard from about skill 25,
  // then Advanced from about 75; honors at 50, 75 and 100; about 164,000 energy from 1 to 100.
  // The API gives your skill but not what a hunt pays, so the money comes from your own "$ per hunt" setting.
  const HUNT_E = 10, HUNT_FEE = 500, HONORS = [50, 75, 100];
  // Skill gained per hunt, roughly: a·e^(−b·skill), fitted to the wiki's figures (about 0.025 a hunt at skill 40,
  // about 164,000 energy from 1 to 100). A rough guide, not Torn's formula.
  const HG_A = 0.1884, HG_B = 0.0505;
  const huntBonus = () => {   // from your perks: skill-gain and income bonuses that mention hunting
    const out = { skill: 0, income: 0, energy: 0, parts: [] };
    for (const p of data.perks || []) {
      if (!/hunt/i.test(p.text)) continue;
      const n = Number((/(\d+(?:\.\d+)?)\s*%/.exec(p.text) || [])[1]) || 0;
      if (/skill|experience|exp\b|xp|gain/i.test(p.text)) out.skill += n; else if (/energy|cost/i.test(p.text)) out.energy += n; else out.income += n;
      out.parts.push(`${p.text} (${p.kind})`);
    }
    return out;
  };
  function huntsToSkill(from, to) {
    if (!(from < to)) return 0;
    const b = huntBonus(), gain = 1 + b.skill / 100;
    return Math.ceil((Math.exp(HG_B * to) - Math.exp(HG_B * from)) / (HG_A * HG_B * gain) * (1 - b.energy / 100));
  }
  // Estimated pay per hunt (before the $500 fee) when you haven't set your own. The only current figure is the
  // wiki's "about $800K per full energy bar at max skill on Advanced" (about $53K a hunt). Player reports from
  // skill 79-99 (TC Basic's hunting guide, from before Torn raised hunting income) fall off steeply with skill;
  // scaled to the wiki's figure they fit $53K x (skill/100)^6. There's no usable data below about skill 70, so
  // nothing is estimated there. Income perks that mention hunting (job, faction) are added on top.
  const HUNT_EST_MIN = 70;
  // Learned pay: read from Torn's own hunting result after each of your hunts (the page you're viewing; no requests).
  // Kept on this device: the last 60 hunts, each { t, sess, gross, sk, txt }.
  const HUNT_LOG = 'ttp_hunts_v1';
  const huntLog = () => GM_getValue(HUNT_LOG, []) || [];
  function huntLearned(sk) {
    const log = huntLog().filter((h) => Date.now() - h.t < 30 * 864e5);
    if (!log.length) return null;
    const sess = sk != null ? huntSession(sk) : null;
    const same = sess ? log.filter((h) => h.sess === sess) : [];
    const use = (same.length >= 3 ? same : log).slice(-20).map((h) => h.gross).sort((a, b) => a - b);
    const mid = use.length % 2 ? use[(use.length - 1) / 2] : (use[use.length / 2 - 1] + use[use.length / 2]) / 2;   // median: rare animals don't skew it
    return { per: Math.round(mid), n: use.length, sess: same.length >= 3 ? sess : null };
  }
  function huntEstimate(sk) {
    if (sk == null || sk < HUNT_EST_MIN) return 0;
    return Math.round(53000 * Math.pow(Math.min(sk, 100) / 100, 6) * (1 + huntBonus().income / 100) / 100) * 100;
  }
  const huntSession = (sk) => (sk >= 75 ? 'Advanced' : sk >= 25 ? 'Standard' : 'Beginner');
  const inWindow = (list) => (list || []).find((e) => e.start <= Date.now() && Date.now() < e.end) || null;
  const nextWindow = (list) => (list || []).filter((e) => e.start > Date.now()).sort((a, b) => a.start - b.start)[0] || null;
  // Hunting on a South Africa trip: energy when you land (now + what the flight there refills; flyMin = 0 when
  // you're already there), hunts down to your "energy to keep", and what the flight home (backMin) refills.
  function huntPlan(flyMin, backMin) {
    const e = energyNow();
    if (!e) return null;
    const ticks = (min) => Math.floor(Math.max(0, min) * 60 / e.intv) * e.inc;
    const arrive = e.current >= e.maximum ? e.current : Math.min(e.maximum, e.current + ticks(flyMin));
    const wastedOut = e.current >= e.maximum ? ticks(flyMin) : Math.max(0, e.current + ticks(flyMin) - e.maximum);
    const keep = clamp(settings.huntKeep, 0, 1000);
    const hunts = Math.max(0, Math.floor((arrive - keep) / HUNT_E));
    const left = arrive - hunts * HUNT_E, landHome = Math.min(e.maximum, left + ticks(backMin));
    const wastedBack = Math.max(0, left + ticks(backMin) - e.maximum);
    const x = data.extra || {}, sk = x.hunting;
    const own = Number(settings.huntPerHunt) || 0, learned = own ? null : huntLearned(sk), est = own || learned ? 0 : huntEstimate(sk);
    const per = own || (learned && learned.per) || est;
    const cash = per > 0 ? hunts * (per - HUNT_FEE) : 0;
    return { arrive, hunts, left, landHome, refill: ticks(backMin), wasted: wastedOut + wastedBack, money: cash, per, estimated: !own && !learned && est > 0, learned, skill: sk, session: sk != null ? huntSession(sk) : null, maximum: e.maximum };
  }
  const money$ = (n) => money(n);
  function huntCardHTML(flyMin, backMin) {
    const h = huntPlan(flyMin, backMin);
    const x = data.extra || {}, sk = x.hunting;
    const honor = sk != null ? HONORS.find((v) => sk < v) : null;
    const tigerNow = inWindow(x.tiger), tigerNext = nextWindow(x.tiger);
    const stat = (k, v, sub) => `<div class="hstat"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    const stats = [
      stat('Skill', sk != null ? String(Math.round(sk * 100) / 100) : '–', sk != null ? huntSession(sk) : x.huntErr || 'reading…'),
      h ? stat('Hunts', String(h.hunts), `${h.arrive}E → ${h.left}E`) : '',
      h ? stat('Back home', `${h.landHome}E`, 'after the flight') : '',
      honor && sk != null ? stat(`To skill ${honor}`, huntsToSkill(sk, honor).toLocaleString(), 'hunts (rough)') : '',
    ].join('');
    const tiger = tigerNow ? `<div class="note pos" style="margin:6px 0 0">Tiger Day is on: ×5 hunting skill until ${esc(clock(tigerNow.end))}</div>`
      : tigerNext && tigerNext.start - Date.now() < 14 * 864e5 ? `<div class="note" style="margin:6px 0 0">Tiger Day ${esc(new Date(tigerNext.start).toUTCString().slice(0, 11))}: ×5 hunting skill</div>` : '';
    const money = h && h.money ? `<span class="sub pos" title="${h.estimated ? `Estimated at about ${money$(h.per)} a hunt for your skill` : h.learned ? `${money$(h.per)} a hunt: the middle of your last ${h.learned.n} hunts` : `${money$(h.per)} a hunt (your setting)`}">${h.estimated ? '≈' : ''}+${short(h.money)}</span>` : '';
    return `<div class="section"><div class="section-h"><span class="step">🎯</span><h4>Hunting</h4>${money}</div><div class="hstats">${stats}</div>${tiger}</div>`;
  }

  function planTrip(country, m) {
    const st = data.stock && data.stock[country.code];
    if (!st || !data.items) return null;
    if ((Date.now() - st.update) / 3600000 > clamp(settings.hideOlderH, 1, 72)) return null;
    const capAll = capacity(m), cap = Math.max(0, capAll - clamp(settings.reserved, 0, capAll));
    const fee = sellFee(), ticket = ticketCost(country, m);
    const oneWay = flightMin(country, m), roundMin = oneWay * 2 + clamp(settings.stayMin, 0, 120);
    const factor = stockFactor(st.update);
    let budget = settings.budget > 0 ? settings.budget - (m.id === 'standard' ? ticket : 0) : Infinity;

    // Exports: buy on Torn's market (live listings when available), sell back to the shop at landing-time price.
    const exports = [];
    for (const it of st.items) {
      const info = itemInfo(it.id);
      if (!info || !info.mp || !it.cost) continue;
      if (NO_EXPORT.test(it.name || info.name || '')) continue;   // suitcases can't be taken abroad
      const bm = isBM(it);
      const proj = bm ? projected(country.code, it.id, it.cost, oneWay) : { price: it.cost, v: null };
      const sbMid = bm ? proj.price : Math.floor(it.cost * 0.75), sbLow = bm ? proj.low : sbMid, sbHigh = bm ? proj.high : sbMid;
      const sb = settings.conservative ? sbLow : sbMid;   // what the plan is built on
      const unitCap = WEAPON_ARMOR_TYPES.test(info.type) ? 100 : Infinity;
      const probe = buyCost(it.id, 1, info.mp);
      exports.push({ id: it.id, name: it.name, type: info.type, bm, sbNow: sellBack(it), sb, sbMid, sbLow, sbHigh, per: sb - probe.cheapest, cheapest: probe.cheapest, live: probe.live, liveAt: probe.at, v: proj.v, vol: proj.vol, unitCap, uncertain: !bm && !shopFor(it), shop: shopFor(it) });
    }
    exports.sort((a, b) => b.per - a.per);
    const outPlan = [];
    let outSlots = cap, outProfit = 0, outProfitLow = 0, outSpend = 0;
    if (settings.doExport) {
      for (const e of exports) {
        if (outSlots <= 0 || e.per < settings.minProfit) break;
        let n = Math.min(outSlots, e.unitCap);
        // depth: shrink n until the average unit cost still beats the sell-back by the minimum profit
        let bc = buyCost(e.id, n, itemInfo(e.id).mp);
        while (n > 1 && (e.sb - bc.total / n) < settings.minProfit) { n = Math.max(1, Math.floor(n * 0.8)); bc = buyCost(e.id, n, itemInfo(e.id).mp); }
        if (Number.isFinite(budget)) while (n > 0 && bc.total > budget - outSpend) { n--; bc = buyCost(e.id, n, itemInfo(e.id).mp); }
        if (n <= 0 || (e.sb - bc.total / n) < settings.minProfit) continue;
        const avg = bc.total / n;
        outPlan.push({ ...e, n, buy: avg, per: e.sb - avg, perLow: e.sbLow - avg, total: bc.total, avail: bc.avail, fromBz: bc.fromBz || 0, seller: bc.seller || null, sellers: bc.sellers || [] });
        outSlots -= n; outProfit += n * (e.sb - avg); outProfitLow += n * (e.sbLow - avg); outSpend += bc.total;
      }
    }

    // Imports: buy abroad (stock discounted for report age), sell at home after tax.
    const imports = [];
    for (const it of st.items) {
      const info = itemInfo(it.id);
      if (!info || !info.mp || !it.cost) continue;
      if (!settings.weaponsArmour && WEAPON_ARMOR_TYPES.test(info.type)) continue;   // switched off in Settings (Torn's travel rules for these are changing)
      const restock = restockInfo(country.code, it);
      // A restock that lands before you do means a full shelf: no age discount, and a known post-restock quantity if the shelf is empty now.
      const restocked = !!(restock && restock.at && restock.at - Date.now() <= oneWay * 60000);
      let qty = it.qty;
      if (qty <= 0 && restocked && restock.qty) qty = restock.qty;
      if (qty <= 0) continue;
      qty = Math.floor(qty * (restocked ? 1 : factor) * settings.stockShare / 100);
      const hs = homeSell(it.id, info.mp), marketNet = hs.price * (1 - fee);
      const npc = info.sp > marketNet;                        // Torn's own shops pay more than the market would, after tax
      const sell = npc ? info.sp : marketNet;
      imports.push({ id: it.id, name: it.name, type: info.type, cost: it.cost, sell, npc, sellLive: hs.live && !npc, sellAt: hs.at, estimate: roundMin > 60, per: sell - it.cost, qty, fp: FLOWER_PLUSH_TYPES.test(info.type), restock, restocked, wasEmpty: it.qty <= 0 });
    }
    imports.sort((a, b) => b.per - a.per);
    const backPlan = [];
    const pkFp = settings.usePerks && perkInfo() ? perkInfo().flowerPlush : 0;
    let inSlots = cap, fpSlots = pkFp || (eff('flowerToy7') ? 5 : 0), inProfit = 0, inSpend = 0;
    const cashAbroad = Number.isFinite(budget) ? budget - outSpend + outPlan.reduce((s, e) => s + e.n * e.sb, 0) : Infinity;
    if (settings.doImport) {
      for (const it of imports) {
        if (it.per < settings.minProfit) break;
        let avail = it.qty;
        const use = (slots) => { let n = Math.min(slots, avail); if (Number.isFinite(cashAbroad)) n = Math.min(n, Math.floor((cashAbroad - inSpend) / it.cost)); return Math.max(0, n); };
        if (it.fp && fpSlots > 0) { const n = use(fpSlots); if (n) { backPlan.push({ ...it, n, bonus: true }); fpSlots -= n; avail -= n; inProfit += n * it.per; inSpend += n * it.cost; } }
        if (inSlots > 0 && avail > 0) { const n = use(inSlots); if (n) { backPlan.push({ ...it, n }); inSlots -= n; inProfit += n * it.per; inSpend += n * it.cost; } }
        if (inSlots <= 0 && fpSlots <= 0) break;
      }
    }
    const hunt = country.code === 'sou' && settings.huntShow ? huntPlan(oneWay, oneWay) : null;
    const huntMoney = hunt && settings.huntOn ? hunt.money : 0;
    const total = outProfit + inProfit - ticket + huntMoney, totalLow = outProfitLow + inProfit - ticket + huntMoney;
    return {
      country, method: m, cap, capAll, ticket, oneWay, roundMin, outPlan, backPlan, outProfit, outProfitLow, inProfit, total, totalLow, hunt, huntMoney,
      perHour: roundMin > 0 ? total / (roundMin / 60) : 0, perHourLow: roundMin > 0 ? totalLow / (roundMin / 60) : 0,
      hasRange: outPlan.some((e) => e.bm && e.vol != null && e.sbHigh > e.sbLow), exports: exports.slice(0, 10), imports: imports.slice(0, 10),
      update: st.update, src: SRC_LABEL[st.src] || st.src || '', stale: (Date.now() - st.update) / 60000 > STALE_MIN, factor, outSpend, inSpend,
      falling: outPlan.filter((e) => e.v != null && e.v < -0.02), perkWarns: perkWarnings(roundMin),
      energy: (() => { const f = energyFit(roundMin); if (f && hunt && settings.huntOn && hunt.hunts > 0 && hunt.per > 0) { f.wasted = hunt.wasted; f.hunting = true; } return f; })(),
    };
  }
  function allPlans() {
    const plans = [];
    for (const c of COUNTRIES) {
      const ps = METHODS.filter(methodAvailable).map((m) => planTrip(c, m)).filter(Boolean);
      if (!ps.length) continue;
      if (settings.showAllMethods) plans.push(...ps); else plans.push(ps.sort((a, b) => b.perHour - a.perHour)[0]);
    }
    const key = settings.sortBy === 'trip' ? 'total' : 'perHour';
    return plans.sort((a, b) => b[key] - a[key]);
  }
  // Which export items deserve a live-listing lookup: best market-value candidates across all countries.
  function shortlistIds() {
    if (!data.stock || !data.items) return [];
    const best = {};
    for (const code of Object.keys(data.stock)) for (const it of data.stock[code].items) {
      const info = itemInfo(it.id); if (!info || !info.mp) continue;
      const per = sellBack(it) - info.mp;
      if (per > settings.minProfit && (!best[it.id] || per > best[it.id])) best[it.id] = per;
    }
    return Object.keys(best).sort((a, b) => best[b] - best[a]).slice(0, LISTING_ITEMS).map(Number);
  }
  // Import candidates worth a listing lookup: best home-sale margins across all countries.
  function shortlistImportIds() {
    if (!data.stock || !data.items) return [];
    const fee = sellFee(), best = {};
    for (const code of Object.keys(data.stock)) for (const it of data.stock[code].items) {
      const info = itemInfo(it.id); if (!info || !info.mp) continue;   // empty shelves included: they may restock before you land
      const per = info.mp * (1 - fee) - it.cost;
      if (per > settings.minProfit && (!best[it.id] || per > best[it.id])) best[it.id] = per;
    }
    return Object.keys(best).sort((a, b) => best[b] - best[a]).slice(0, IMPORT_LISTING_ITEMS).map(Number);
  }

  /* ===================== ALERTS (API data only) ===================== */
  function checkAlerts(plans) {
    if (!settings.alertOn) return;
    const seen = GM_getValue(K.alerted, {}) || {};
    const fire = (key, text) => {
      if (seen[key] && Date.now() - seen[key] < 6 * 3600 * 1000) return;
      seen[key] = Date.now();
      banner(text);
      if (typeof GM_notification === 'function') try { GM_notification({ title: 'Travel 2.Dough', text, timeout: 8000 }); } catch (e) {}
    };
    for (const p of plans) if (p.perHour >= settings.alertPerHour) fire(`ph:${p.country.code}`, `${p.country.name}: ${short(p.perHour)}/h round trip (${p.outPlan[0] ? p.outPlan[0].name : p.backPlan[0] && p.backPlan[0].name})`);
    for (const code of Object.keys(data.stock || {})) for (const it of data.stock[code].items) {
      const info = itemInfo(it.id); if (!info || !isBM(it)) continue;
      const margin = it.cost - info.mp;
      if (margin >= settings.alertMargin) fire(`bm:${code}:${it.id}`, `${it.name} sells for ${short(margin)} over market in ${BY_CODE[code] ? BY_CODE[code].name : code}`);
    }
    GM_setValue(K.alerted, seen);
  }

  /* ===================== STYLES ===================== */
  // Palette chosen for contrast on dark: body text ~15:1, muted text ~8:1, green/red/amber all >= 7:1 on the panel.
  GM_addStyle(`
    #ttp,#ttp-fab,#ttp-ta,.ttp-badge{--bg:#121418;--s1:#1a1d23;--s2:#222630;--s3:#2b303b;--line:#343a46;--text:#f1f4f8;--muted:#b3bccb;
      --dim:#8d97a8;--accent:#6cb4ff;--accent-bg:rgba(108,180,255,.14);--pos:#5be08f;--pos-bg:rgba(91,224,143,.12);--neg:#ff9a92;--neg-bg:rgba(255,154,146,.12);
      --warn:#ffcf66;--warn-bg:rgba(255,207,102,.12);--bm:#cfb0ff;--bm-bg:rgba(207,176,255,.14);
      --font:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
    #ttp-fab{position:fixed;left:14px;bottom:14px;z-index:999998;display:flex;align-items:center;gap:8px;background:var(--s2);color:var(--text);
      border:1px solid var(--line);border-radius:999px;padding:9px 15px 9px 12px;font:600 14px var(--font);cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.45)}
    #ttp-fab:hover{border-color:var(--accent)}#ttp-fab .ic{font-size:16px}
    #ttp{position:fixed;top:56px;right:14px;width:min(820px,calc(100vw - 28px));max-height:calc(100vh - 72px);z-index:999999;display:none;flex-direction:column;
      background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.6);
      font:14px/1.5 var(--font);overflow:hidden;-webkit-font-smoothing:antialiased}
    #ttp.open{display:flex}
    #ttp *{box-sizing:border-box;font-family:inherit}
    /* Torn's own stylesheet colours td/li/label/etc. directly; pin them so the panel stays readable */
    #ttp td,#ttp li,#ttp label,#ttp p,#ttp h3,#ttp h4,#ttp ol,#ttp ul,#ttp div,#ttp span{color:inherit}
    #ttp td{color:var(--text)}
    #ttp input,#ttp select,#ttp option{color:var(--text);background-color:var(--bg)}
    #ttp b,#ttp strong{color:var(--text)}

    /* header */
    #ttp .hd{background:var(--s1);border-bottom:1px solid var(--line)}
    #ttp .hd-top{display:flex;align-items:center;gap:10px;padding:12px 14px 8px}
    #ttp .brand{font-size:16px;font-weight:700;letter-spacing:.1px;white-space:nowrap}
    #ttp .status{font-size:12px;color:var(--muted);background:var(--s2);border:1px solid var(--line);border-radius:999px;padding:2px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;cursor:pointer;font-family:inherit}
    #ttp .status:hover{border-color:var(--accent);color:var(--text)}
    #ttp .feeds{display:none;background:var(--s1);border-bottom:1px solid var(--line);padding:8px 14px}
    #ttp .feeds.open{display:block}
    #ttp .feed{display:grid;grid-template-columns:24px 110px 1fr;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--s3);font-size:13px}
    #ttp .feed:last-child{border-bottom:0}
    #ttp .feed .ic{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px}
    #ttp .feed .ic.ok{background:var(--pos-bg);color:var(--pos)}#ttp .feed .ic.bad{background:var(--neg-bg);color:var(--neg)}#ttp .feed .ic.off{background:var(--s3);color:var(--dim)}
    #ttp .feed .nm{font-weight:700}#ttp .feed .dt{color:var(--muted);font-size:12px}
    #ttp .hd-actions{margin-left:auto;display:flex;gap:6px}
    #ttp .icon{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:var(--s2);color:var(--text);border:1px solid var(--line);cursor:pointer;font-size:15px}
    #ttp .icon:hover{border-color:var(--accent);color:var(--accent)}
    #ttp .tabs{display:flex;gap:2px;padding:0 10px;overflow-x:auto}
    #ttp .tab{background:none;border:0;border-bottom:2px solid transparent;color:var(--muted);padding:8px 12px 10px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}
    #ttp .tab:hover{color:var(--text)}
    #ttp .tab.on{color:var(--text);border-bottom-color:var(--accent)}

    #ttp .bd{overflow:auto;padding:14px}
    #ttp a{color:var(--accent);text-decoration:none}#ttp a:hover{text-decoration:underline}
    #ttp button{font:inherit}
    #ttp .btn{background:var(--s2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer}
    #ttp .btn:hover{border-color:var(--accent)}
    #ttp .btn.primary{background:var(--accent);border-color:var(--accent);color:#08121f}
    #ttp .btn.sm{padding:3px 9px;font-size:12px}
    #ttp .btn:focus-visible,#ttp .tab:focus-visible,#ttp .icon:focus-visible,#ttp .trip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

    /* text helpers */
    #ttp .note{font-size:13px;color:var(--muted);margin:6px 0}
    #ttp .dim{color:var(--dim)}
    #ttp .pos{color:var(--pos)}#ttp .neg{color:var(--neg)}
    #ttp .num{font-variant-numeric:tabular-nums}
    #ttp .callout{display:flex;gap:8px;align-items:flex-start;border-radius:10px;padding:9px 12px;margin:8px 0;font-size:13px;border:1px solid}
    #ttp .callout.warn,#ttp .warn{color:var(--warn)}
    #ttp .callout.warn{background:var(--warn-bg);border-color:rgba(255,207,102,.35)}
    #ttp .callout.err,#ttp .err{color:var(--neg)}
    #ttp .callout.err{background:var(--neg-bg);border-color:rgba(255,154,146,.35)}
    #ttp .callout.ok{color:var(--pos);background:var(--pos-bg);border-color:rgba(91,224,143,.35);font-weight:600}
    #ttp div.warn:not(.callout),#ttp div.err:not(.callout){font-size:13px;margin:6px 0}

    /* tags */
    #ttp .tag{display:inline-flex;align-items:center;font-size:11px;font-weight:700;line-height:1;padding:3px 7px;border-radius:999px;margin-left:6px;vertical-align:2px;letter-spacing:.2px}
    #ttp .tag.bm{color:var(--bm);background:var(--bm-bg)}
    #ttp .tag.live{color:var(--pos);background:var(--pos-bg)}
    #ttp .tag.unc,#ttp .tag.stale{color:var(--warn);background:var(--warn-bg)}
    #ttp .tag.fall{color:var(--neg);background:var(--neg-bg)}
    #ttp .tag.plain{color:var(--muted);background:var(--s3)}

    /* toolbar */
    #ttp .toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
    #ttp .chip{font-size:12px;color:var(--muted);background:var(--s1);border:1px solid var(--line);border-radius:999px;padding:4px 10px}
    #ttp .chip b{color:var(--text);font-weight:600}
    #ttp .seg{display:inline-flex;background:var(--s1);border:1px solid var(--line);border-radius:9px;padding:2px;margin-left:auto}
    #ttp .seg button{background:none;border:0;color:var(--muted);font-size:12px;font-weight:600;padding:4px 10px;border-radius:7px;cursor:pointer}
    #ttp .seg button.on{background:var(--s3);color:var(--text)}

    /* hero */
    #ttp .hero{background:linear-gradient(135deg,rgba(108,180,255,.14),rgba(91,224,143,.08));border:1px solid rgba(108,180,255,.35);border-radius:14px;padding:16px;margin-bottom:14px;cursor:pointer}
    #ttp .hero:hover{border-color:var(--accent)}
    #ttp .eyebrow{font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--accent)}
    #ttp .hero-top{display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin-top:4px}
    #ttp .hero-dest{font-size:22px;font-weight:700;line-height:1.2}
    #ttp .hero-meta{color:var(--muted);font-size:13px;margin-top:2px}
    #ttp .hero-money{margin-left:auto;text-align:right}
    #ttp .hero-ph{font-size:28px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums}
    #ttp .hero-ph small{font-size:15px;font-weight:600;color:var(--muted)}
    #ttp .hero-trip{font-size:13px;color:var(--muted)}
    #ttp .legs{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
    #ttp .legs.legs3{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
    #ttp .leg{background:rgba(18,20,24,.55);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
    #ttp .leg-h{font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);display:flex;justify-content:space-between}
    #ttp .leg-h span+span{text-transform:none;font-size:13px;letter-spacing:0}
    #ttp .leg-item{margin-top:4px;font-weight:600}
    #ttp .leg-empty{margin-top:4px;color:var(--dim)}

    /* trip list */
    #ttp .list-h{font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);margin:4px 2px 8px}
    #ttp .trip{display:grid;grid-template-columns:34px minmax(150px,1.2fr) minmax(0,2fr) auto;gap:12px;align-items:center;background:var(--s1);
      border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px;cursor:pointer}
    #ttp .trip:hover{border-color:var(--accent);background:var(--s2)}
    #ttp .rank{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--s3);color:var(--muted);font-weight:700;font-size:13px}
    #ttp .dest{font-weight:700;font-size:15px}
    #ttp .meta{font-size:12px;color:var(--muted)}
    #ttp .goods{font-size:13px;min-width:0}
    #ttp .goods div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #ttp .goods .lbl{color:var(--dim);display:inline-block;width:74px;font-size:12px}
    #ttp .money{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    #ttp .money .ph{font-size:17px;font-weight:800}
    #ttp .money .ph small{font-size:12px;font-weight:600;color:var(--muted)}
    #ttp .money .pt{font-size:12px;color:var(--muted)}

    /* stat cards */
    #ttp .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:12px 0}
    #ttp .card{background:var(--s1);border:1px solid var(--line);border-radius:12px;padding:12px}
    #ttp .card .k{font-size:12px;color:var(--muted);font-weight:600}
    #ttp .card .v{font-size:20px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums}
    #ttp .card .note{margin:4px 0 0;font-size:12px}

    /* detail */
    #ttp .detail-h{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    #ttp .detail-h h3{margin:0;font-size:20px;font-weight:700}
    #ttp .detail-h .meta{font-size:13px}
    #ttp .section{background:var(--s1);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:12px 0}
    #ttp .section-h{display:flex;align-items:center;gap:10px;margin-bottom:8px}
    #ttp .step{width:24px;height:24px;border-radius:50%;background:var(--accent);color:#08121f;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
    #ttp .section-h h4{margin:0;font-size:15px;font-weight:700;color:var(--text)}
    #ttp .section-h .sub{margin-left:auto;font-size:12px;color:var(--muted)}
    #ttp h4{margin:16px 0 8px;font-size:15px;font-weight:700;color:var(--text)}

    /* tables */
    #ttp table{width:100%;border-collapse:collapse;font-size:13px;color:var(--text)}
    #ttp th{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);text-align:right;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap;background:inherit}
    #ttp td{padding:8px;border-bottom:1px solid var(--s3);text-align:right;vertical-align:top;font-variant-numeric:tabular-nums}
    #ttp th:first-child,#ttp td:first-child,#ttp th.l,#ttp td.l{text-align:left}
    #ttp tbody tr:last-child td{border-bottom:0}
    #ttp tbody tr:hover td{background:rgba(255,255,255,.025)}
    #ttp td .note{margin:2px 0 0;font-size:12px}
    #ttp td.pos,#ttp td.neg{font-weight:700}
    #ttp tr.best td{background:var(--accent-bg)}
    #ttp .tablewrap{overflow-x:auto}

    #ttp ol.steps{margin:6px 0 0;padding-left:20px;color:var(--text)}
    #ttp ol.steps li{margin:6px 0}
    #ttp .spark{vertical-align:middle}

    /* settings */
    #ttp .set-group{background:var(--s1);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:12px}
    #ttp .set-group h4{margin:0 0 10px}
    #ttp .hstats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
    #ttp .hstat{background:var(--s2);border:1px solid var(--line);border-radius:10px;padding:7px 10px}
    #ttp .hstat .k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
    #ttp .hstat .v{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}
    #ttp .hstat .s{font-size:11.5px;color:var(--muted)}
    #ttp .api-tag{display:inline-block;margin-left:4px;padding:0 5px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.04em;background:var(--good-soft,rgba(52,201,154,.16));color:var(--good,#34c99a);vertical-align:1px}
    #ttp input:disabled,#ttp select:disabled{opacity:.75;cursor:not-allowed}
    #ttp .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px}
    #ttp label{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text);flex-wrap:wrap;line-height:1.35}
    #ttp input[type=checkbox]{width:16px;height:16px;accent-color:var(--accent);flex:0 0 auto}
    #ttp input[type=number],#ttp input[type=text],#ttp input[type=password],#ttp input[type=datetime-local],#ttp select{
      background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:13px}
    #ttp input:focus,#ttp select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-bg)}
    #ttp input[type=number]{width:96px}
    #ttp .tos{margin-top:10px}#ttp .tos th{text-align:left;white-space:nowrap;width:1%;text-transform:none;letter-spacing:0;font-size:12px;vertical-align:top}
    #ttp .tos td{text-align:left;font-size:13px;color:var(--text)}

    /* banners */
    #ttp .ban{background:var(--pos-bg);border:1px solid rgba(91,224,143,.4);color:var(--pos);border-radius:10px;padding:9px 12px;margin:0 0 10px;font-weight:700}

    /* page badges + travel agency box */
    .ttp-badge{display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;font:700 11px/1.4 var(--font);vertical-align:middle;white-space:nowrap}
    .ttp-badge.pos{color:#0f5132;background:#c8f7d9}.ttp-badge.neg{color:#7a1d16;background:#ffd9d5}.ttp-badge.info{color:#0b3a66;background:#d6e9ff}
    .ttp-badge[data-tip]{position:relative;cursor:help}
    #ttp .bzrow{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
    #ttp .btn.bz{font-size:11px;padding:2px 7px;font-weight:600;color:var(--muted)}
    #ttp .btn.bz.use{color:var(--pos);border-color:rgba(91,224,143,.45)}
    #ttp-tip{position:fixed;z-index:1000000;display:none;max-width:280px;background:#2b303b;color:#f1f4f8;border:1px solid #343a46;border-radius:8px;padding:6px 10px;
      font:400 12px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);pointer-events:none}
    .ttp-badge[data-tip]:hover::after{content:attr(data-tip);position:absolute;left:0;top:calc(100% + 6px);z-index:999999;width:max-content;max-width:280px;white-space:normal;
      background:#1a1d23;color:#f1f4f8;border:1px solid #343a46;border-radius:8px;padding:6px 10px;font:400 12px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);pointer-events:none}
    #ttp-ta{margin:10px 0;padding:12px 14px;border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;background:var(--s1);color:var(--text);font:14px/1.5 var(--font)}
    #ttp-ta b{color:var(--text)}
    #ttp-ta .ta-h{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline}
    #ttp-ta .ta-ph{font-size:18px;font-weight:800;color:var(--pos)}
    #ttp-ta .ta-pack{margin-top:6px;display:flex;flex-wrap:wrap;gap:6px}
    #ttp-ta .ta-pack span{background:var(--s2);border:1px solid var(--line);border-radius:999px;padding:3px 10px;display:inline-flex;gap:6px;align-items:center}
    #ttp-ta .ta-warn{color:var(--warn);margin-top:4px}
    #ttp-ta .ta-note{color:var(--muted);font-size:12px;margin-top:4px}

    @media (max-width:640px){
      #ttp{top:0;right:0;width:100vw;max-height:100vh;border-radius:0}
      #ttp .grid,#ttp .legs{grid-template-columns:1fr}
      #ttp .trip{grid-template-columns:28px 1fr auto}
      #ttp .trip .goods{grid-column:2 / 4;grid-row:2}
      #ttp .trip .money{grid-column:3;grid-row:1}
      #ttp .hero-money{margin-left:0;text-align:left}
    }
  `);

  /* ===================== PANEL ===================== */
  const fab = document.createElement('button');
  fab.id = 'ttp-fab'; fab.type = 'button'; fab.innerHTML = '<span class="ic">✈</span>Travel 2.Dough';
  const panel = document.createElement('div');
  panel.id = 'ttp'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Travel 2.Dough');
  panel.innerHTML = `
    <div class="hd">
      <div class="hd-top">
        <span class="brand">✈ Travel 2.Dough <small style="font-weight:500;font-size:11px;color:var(--dim)">v${TTP_VERSION}</small></span>
        <button type="button" class="status" id="ttp-status" title="Show the stock feeds" aria-expanded="false" aria-controls="ttp-feeds"></button>
        <div class="hd-actions">
          <button type="button" class="icon" id="ttp-refresh" title="Refresh prices and stock" aria-label="Refresh">↻</button>
          <button type="button" class="icon" id="ttp-close" title="Close" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="tabs" role="tablist">
        <button type="button" class="tab on" data-tab="best" role="tab">Best trips</button>
        <button type="button" class="tab" data-tab="here" role="tab">Abroad</button>
        <button type="button" class="tab" data-tab="bm" role="tab">Black Market</button>
        <button type="button" class="tab" data-tab="set" role="tab">Settings</button>
      </div>
    </div>
    <div class="feeds" id="ttp-feeds"></div>
    <div class="bd" id="ttp-body"></div>`;
  document.body.appendChild(fab); document.body.appendChild(panel);
  const body = panel.querySelector('#ttp-body');
  let tab = 'best', selected = null, timer = null, autoSwitched = false, lastPlans = [];

  fab.addEventListener('click', () => toggle(true));
  panel.querySelector('#ttp-close').addEventListener('click', () => toggle(false));
  panel.querySelector('#ttp-refresh').addEventListener('click', () => refresh(true));
  panel.querySelector('#ttp-status').addEventListener('click', () => {
    const fl = panel.querySelector('#ttp-feeds'), open = !fl.classList.contains('open');
    fl.classList.toggle('open', open); panel.querySelector('#ttp-status').setAttribute('aria-expanded', String(open));
    if (open) fl.innerHTML = feedListHTML();
  });
  panel.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; selected = null; render(); }));
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Travel 2.Dough: open', () => toggle(true));

  function toggle(open) {
    panel.classList.toggle('open', open); fab.style.display = open ? 'none' : ''; GM_setValue(K.open, open);
    schedule();
    if (open) refresh(false);
  }
  function schedule() {
    clearInterval(timer);
    const open = panel.classList.contains('open');
    if (open) timer = setInterval(() => { if (!document.hidden) refresh(false); }, 60000);
    else if (settings.alertOn && settings.alertBackground) timer = setInterval(() => { if (!document.hidden) refresh(false, true); }, 5 * 60000);
  }
  // One row per stock feed: ✓ answered, ✗ failed, – not in use (Settings → Stock source).
  function feedListHTML() {
    const used = STOCK_URLS[settings.stockSource] ? [settings.stockSource] : Object.keys(STOCK_URLS);
    const site = { prometheus: 'https://prombot.co.uk/', tornintel: 'https://torn-intel.com/', yata: 'https://yata.yt/' };
    const down = GM_getValue('ttp_feed_down_v1', {}) || {};
    return Object.keys(STOCK_URLS).map((k) => {
      const f = (data.feeds || []).find((x) => x.src === k);
      let ic = 'off', mark = '–', detail = 'Not in use (Settings → Stock source)';
      if (used.includes(k)) {
        if (!f) { detail = 'Not checked yet'; }
        else if (f.ok) { ic = 'ok'; mark = '✓'; detail = `Active · ${f.countries} countries · newest data for ${f.won}${f.newest ? ` · latest report ${ago(f.newest)}` : ''}${f.won ? '' : ' (same or older than the others, so not needed right now)'}`; }
        else { ic = 'bad'; mark = '✗'; detail = `Not answering${f.err ? ` (${esc(f.err)})` : ''}${down[k] ? ` · since ${ago(down[k])}` : ''}`; }
      }
      return `<div class="feed"><span class="ic ${ic}">${mark}</span><a class="nm" href="${site[k]}" target="_blank" rel="noopener">${SRC_LABEL[k]}</a><span class="dt">${detail}</span></div>`;
    }).join('');
  }
  const setStatus = (t) => { const s = panel.querySelector('#ttp-status'); s.textContent = t; s.style.display = t ? '' : 'none'; };
  function banner(text) {
    const el = document.createElement('div'); el.className = 'ban'; el.textContent = '🔔 ' + text;
    body.prepend(el); setTimeout(() => el.remove(), 15000);
  }

  let refreshing = false, wantRender = false, wantFull = false;
  async function refresh(force, quiet) {
    if (refreshing) { if (!quiet) { wantRender = true; wantFull = true; } return; }
    refreshing = true;
    data.errors = []; data.warns = [];
    if (!quiet) setStatus('Updating…');
    try { await loadItems(force); } catch (e) { data.errors.push(e.message); }
    try { await loadStock(force); } catch (e) { data.errors.push(e.message); }
    // Listings and bazaar prices only matter for the plans, so page loads with the panel closed skip them.
    data.lists = GM_getValue(K.lists, {}) || {};
    data.bazaars = GM_getValue('ttp_bazaar_v1', {}) || {};
    if (!quiet && data.items && data.stock) {
      if (apiKey && settings.liveListings) await loadListings([...shortlistIds(), ...shortlistImportIds()]);
      bazaarsInBackground([...shortlistIds(), ...shortlistImportIds()]);   // spaced out, so the plan shows first and updates when they arrive
      if (data.bazaarFail) data.warns.push(data.bazaarFail);
    }
    await loadPerks();
    await loadExtras();
    await loadReports();
    await loadUser();
    releaseLock();
    { const b = GM_getValue(BACKOFF, null); if (b && b.until > Date.now()) data.warns.unshift(`Torn API calls paused for ${dur((b.until - Date.now()) / 60000 + 0.5)} after: ${b.why}`); }
    const okN = data.feeds ? data.feeds.filter((f) => f.ok).length : 0;
    setStatus(data.stockAt ? `Stock ${ago(data.stockAt)} · ${data.feeds ? `${okN}/${data.feeds.length} feeds` : data.stockSrc}${data.lists && Object.keys(data.lists).length ? ' · item market listings (hourly)' : ''} ▾` : '');
    const fl = panel.querySelector('#ttp-feeds'); if (fl && fl.classList.contains('open')) fl.innerHTML = feedListHTML();
    if (!autoSwitched && data.travel && data.travel.code && !data.travel.timeLeft && tab === 'best' && !selected) { tab = 'here'; autoSwitched = true; }
    lastPlans = data.items && data.stock ? allPlans() : [];
    checkAlerts(lastPlans);
    refreshing = false;
    if (!quiet || wantRender) { wantRender = false; render(); }
    overlays();
    watchEnergy();
    if (wantFull && quiet) { wantFull = false; refresh(false); }   // the panel was opened during a background refresh
    else wantFull = false;
  }

  const callout = (cls, icon, html) => `<div class="callout ${cls}"><span aria-hidden="true">${icon}</span><div>${html}</div></div>`;
  function render() {
    panel.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const msgs = data.errors.map((e) => callout('err', '✕', esc(e))).join('') + data.warns.slice(0, 3).map((e) => callout('warn', '⚠', esc(e))).join('');
    if (tab === 'set') { body.innerHTML = msgs + settingsHTML(); bindSettings(); return; }
    if (!apiKey) { body.innerHTML = callout('warn', '🔑', 'Add a <b>Public</b> API key in <b>Settings</b> to load item prices.') + msgs; return; }
    if (!data.items || !data.stock) { body.innerHTML = msgs || '<div class="note">Loading prices and stock…</div>'; return; }
    if (tab === 'here') body.innerHTML = msgs + abroadHTML();
    else if (tab === 'bm') body.innerHTML = msgs + bmHTML();
    else body.innerHTML = msgs + (selected ? detailHTML(selected) : bestHTML());
    body.querySelectorAll('[data-k]').forEach((el) => {
      const open = () => { const [code, mid] = el.dataset.k.split('|'); selected = { code, mid }; tab = 'best'; render(); body.scrollTop = 0; };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    const back = body.querySelector('#ttp-back'); if (back) back.addEventListener('click', () => { selected = null; render(); });
    body.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); try { navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied ✓'; } catch (err) {} }));
    // Hover text for panel links lives in one floating box, so tables that scroll can't clip it.
    body.querySelectorAll('#ttp [data-tip]').forEach((el) => {
      const show = () => {
        let tip = document.getElementById('ttp-tip');
        if (!tip) { tip = document.createElement('div'); tip.id = 'ttp-tip'; document.body.appendChild(tip); }
        tip.textContent = el.dataset.tip; tip.style.display = 'block';
        const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
        tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
        tip.style.top = `${r.bottom + 6 + h > window.innerHeight ? r.top - h - 6 : r.bottom + 6}px`;
      };
      const hide = () => { const tip = document.getElementById('ttp-tip'); if (tip) tip.style.display = 'none'; };
      el.addEventListener('mouseenter', show); el.addEventListener('focus', show);
      el.addEventListener('mouseleave', hide); el.addEventListener('blur', hide); el.addEventListener('click', hide);
    });
    { const tip = document.getElementById('ttp-tip'); if (tip) tip.style.display = 'none'; }
    body.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { settings.sortBy = b.dataset.sort; save(); lastPlans = allPlans(); render(); }));
  }

  const tagsFor = (e) => (e.bm ? '<span class="tag bm" title="Black Market: shop buys at its current price">BM</span>' : '') + (e.uncertain ? '<span class="tag unc" title="Torn\'s API doesn\'t list this shop: assumed 75% buy-back. If it\'s a Black Market item, add it in Settings">75%?</span>' : '') + (e.live ? `<span class="tag live" title="Priced from the item market's current listings, read ${e.liveAt ? ago(e.liveAt) : 'just now'}">LIVE</span>` : '') + (e.v != null && e.v < -0.02 ? `<span class="tag fall" title="Shop price falling">▼ ${Math.abs(e.v * 100).toFixed(0)}%/h</span>` : '');
  const pnClass = (n) => (n >= 0 ? 'pos' : 'neg');
  const goodsLine = (list) => list.length ? `${esc(list[0].name)} ×${list[0].n}${list.length > 1 ? ` <span class="dim">+${list.length - 1} more</span>` : ''}` : '<span class="dim">nothing</span>';

  function toolbar() {
    const ms = METHODS.filter(methodAvailable).map((m) => `${m.label} <b>${capacity(m)}</b>`).join(' · ');
    return `<div class="toolbar">
      <span class="chip">Slots: ${ms}${settings.reserved ? ` <span class="dim">(−${settings.reserved} gear)</span>` : ''}</span>
      <span class="chip">Sell home: <b>${settings.sellVia === 'bazaar' ? 'bazaar, no tax' : settings.sellVia === 'custom' ? `${settings.customFee}% fee` : settings.sellVia === 'anon' ? 'item market, anonymous 15%' : 'item market, 5% tax'}</b></span>
      <span class="seg" role="group" aria-label="Sort trips"><button type="button" data-sort="hour" class="${settings.sortBy !== 'trip' ? 'on' : ''}">Per hour</button><button type="button" data-sort="trip" class="${settings.sortBy === 'trip' ? 'on' : ''}">Per trip</button></span>
    </div>`;
  }

  // Big figure follows the Per hour / Per trip toggle; the other one sits underneath.
  function moneyBlock(p, hero) {
    const trip = settings.sortBy === 'trip';
    const big = trip ? p.total : p.perHour, bigUnit = trip ? (hero ? '/trip' : '/trip') : (hero ? '/hour' : '/h');
    const small = trip ? `${short(p.perHour)}${hero ? ' per hour' : '/h'}` : `${short(p.total)}${hero ? ' per trip' : ' / trip'}`;
    const worst = p.hasRange ? `<br><span class="warn" title="If Black Market prices move against you during the flight">${hero ? 'worst case' : 'worst'} ${trip ? `${short(p.totalLow)}/trip` : `${short(p.perHourLow)}/h`}</span>` : '';
    return hero
      ? `<div class="hero-ph ${pnClass(big)}">${short(big)}<small>${bigUnit}</small></div><div class="hero-trip">${small}${worst}</div>`
      : `<div class="ph ${pnClass(big)}">${short(big)}<small>${bigUnit}</small></div><div class="pt">${small}${worst}</div>`;
  }
  const huntMoneyTag = (p) => (p.huntMoney ? `<span class="pos"${p.hunt && p.hunt.estimated ? ' title="Estimated for your hunting skill; set your own in Settings"' : ''}>${p.hunt && p.hunt.estimated ? '≈' : ''}+${short(p.huntMoney)}</span>` : '');
  function bestHTML() {
    const plans = lastPlans;
    if (!plans.length) return callout('warn', '⚠', 'No trips to show: stock reports are missing or older than your limit in Settings.');
    const top = plans[0];
    const legList = (list, kind) => list.length ? list.slice(0, 3).map((e) => `<div class="leg-item">${esc(e.name)} ×${e.n}${kind === 'out' ? tagsFor(e) : ''}</div>`).join('') + (list.length > 3 ? `<div class="dim">+${list.length - 3} more</div>` : '') : '<div class="leg-empty">Nothing profitable</div>';
    const hero = `<div class="hero" data-k="${top.country.code}|${top.method.id}" tabindex="0" role="button" aria-label="Open the full plan for ${esc(top.country.name)}">
      <div class="eyebrow">Best trip right now</div>
      <div class="hero-top">
        <div><div class="hero-dest">${esc(top.country.name)}${top.stale ? '<span class="tag stale">STALE</span>' : ''}</div>
          <div class="hero-meta">${esc(top.method.label)} · ${dur(top.roundMin)} round trip${top.energy && top.energy.wasted ? ` · <span class="warn">${top.energy.wasted}E wasted</span>` : ''}</div></div>
        <div class="hero-money">${moneyBlock(top, true)}</div>
      </div>
      <div class="legs${top.hunt ? ' legs3' : ''}">
        <div class="leg"><div class="leg-h"><span>Take out</span><span class="${pnClass(top.outProfit)}">${short(top.outProfit)}</span></div>${legList(top.outPlan, 'out')}</div>
        <div class="leg"><div class="leg-h"><span>Bring back</span><span class="${pnClass(top.inProfit)}">${short(top.inProfit)}</span></div>${legList(top.backPlan, 'in')}</div>
        ${top.hunt ? `<div class="leg"><div class="leg-h"><span>Hunting</span>${huntMoneyTag(top)}</div><div class="leg-item">${top.hunt.hunts} hunt${top.hunt.hunts === 1 ? '' : 's'}</div></div>` : ''}
      </div>
      <div class="note" style="margin-bottom:0">Open the full plan →</div>
    </div>`;
    const rows = plans.slice(1).map((p, i) => `
      <div class="trip" data-k="${p.country.code}|${p.method.id}" tabindex="0" role="button" aria-label="${esc(p.country.name)}, ${short(p.perHour)} per hour">
        <div class="rank">${i + 2}</div>
        <div><div class="dest">${esc(p.country.name)}${p.stale ? '<span class="tag stale" title="Old stock report: quantities discounted">STALE</span>' : ''}</div>
          <div class="meta">${esc(p.method.label)} · ${dur(p.roundMin)}${p.energy && p.energy.wasted ? ` · <span class="warn">${p.energy.wasted}E wasted</span>` : ''}</div></div>
        <div class="goods"><div><span class="lbl">Take out</span>${goodsLine(p.outPlan)}${p.outPlan[0] ? tagsFor(p.outPlan[0]) : ''}</div><div><span class="lbl">Bring back</span>${goodsLine(p.backPlan)}</div>${p.hunt ? `<div><span class="lbl">Hunting</span>${p.hunt.hunts} hunt${p.hunt.hunts === 1 ? '' : 's'} ${huntMoneyTag(p)}</div>` : ''}</div>
        <div class="money">${moneyBlock(p, false)}</div>
      </div>`).join('');
    return `${toolbar()}${hero}${rows ? `<div class="list-h">Other destinations</div>${rows}` : ''}
      <div class="note">LIVE = priced from the cheapest current listings for the quantity you'd buy; otherwise Torn's average market value. Black Market prices are projected to your landing time. The planner can't see what's already packed in your Travel Inventory.</div>`;
  }

  function lineTable(list, kind) {
    if (!list.length) return '<div class="note">Nothing profitable here.</div>';
    return `<div class="tablewrap"><table><thead><tr><th>Item</th><th>Qty</th><th>${kind === 'out' ? 'Buy (avg)' : 'Buy abroad'}</th><th>${kind === 'out' ? 'Shop pays' : 'Sells home'}</th><th>Each</th><th>Total</th><th></th></tr></thead><tbody>${list.map((e) => `
      <tr><td><b>${esc(e.name)}</b>${kind === 'out' ? tagsFor(e) : ''}${kind === 'out' && e.fromBz ? `<span class="tag live" title="${e.fromBz} of these priced from bazaars (TornW3B)">BAZAAR ${e.fromBz}/${e.n}</span>` : ''}${e.bonus ? '<span class="tag plain">7★ slots</span>' : ''}${e.restocked ? `<span class="tag live" title="${e.wasEmpty ? `Empty now, but it restocks before you land; quantity from the last restock seen (${e.restock.qty})` : 'Restocks before you land, so the shelf will be full'}">↻ RESTOCKED BY LANDING</span>` : ''}${e.restock ? `<div class="note">${esc(e.restock.text)}</div>` : ''}${kind === 'out' && e.sellers && e.sellers.length ? `<div class="bzrow">${e.sellers.map((b) => `<a class="btn sm bz${b.take ? ' use' : ''}" href="https://www.torn.com/bazaar.php?userId=${encodeURIComponent(b.pid)}" target="_blank" rel="noopener" data-tip="${esc(b.pname)}'s bazaar: ${b.amount} at ${money(b.price)}${b.checked ? `, checked ${ago(b.checked)}` : ''}${b.take ? ` · the plan buys ${b.take} here` : ' · not needed for this plan'}">${esc(b.pname || 'Bazaar')} ${b.take || b.amount}×${short(b.price)} ↗</a>`).join('')}</div>` : ''}</td>
      <td>${e.n}${kind === 'out' && Number.isFinite(e.avail) && e.avail < e.n ? `<div class="note warn">only ${e.avail} listed</div>` : ''}</td>
      <td>${short(kind === 'out' ? e.buy : e.cost)}</td>
      <td>${short(kind === 'out' ? e.sb : e.sell)}${kind === 'in' && e.npc ? '<span class="tag plain" title="Torn\'s city shops buy this for more than the item market would pay after tax">CITY SHOP</span>' : ''}${kind === 'in' && e.sellLive ? `<span class="tag live" title="Lowest current listing after tax, read ${e.sellAt ? ago(e.sellAt) : 'just now'}">LIVE</span>` : ''}${kind === 'in' && e.estimate ? '<span class="tag plain" title="Round trip over an hour: home prices can move before you are back">EST</span>' : ''}${kind === 'out' && e.bm && Math.abs(e.sbMid - e.sbNow) > 1 ? `<div class="note">now ${short(e.sbNow)}</div>` : ''}${kind === 'out' && e.bm && e.vol != null && e.sbHigh > e.sbLow ? `<div class="note" title="Range at landing, from how much this price has moved over the last 24h">${short(e.sbLow)}–${short(e.sbHigh)} at landing</div>` : ''}</td>
      <td class="${pnClass(e.per)}">${short(e.per)}</td><td class="${pnClass(e.per)}">${short(e.per * e.n)}</td>
      <td style="white-space:nowrap">${kind === 'out' ? `<a class="btn sm" href="${marketLink(e.id)}" target="_blank" rel="noopener">Market ↗</a> ` : ''}<button type="button" class="btn sm" data-copy="${esc(e.name)}" title="Copy the name">Copy</button></td></tr>`).join('')}</tbody></table></div>`;
  }

  function detailHTML(sel) {
    const c = BY_CODE[sel.code], m = METHODS.find((x) => x.id === sel.mid);
    const p = c && m ? planTrip(c, m) : null;
    if (!p) return '<button type="button" class="btn" id="ttp-back">← All trips</button>' + callout('warn', '⚠', 'No data for this trip.');
    const others = METHODS.filter(methodAvailable).map((mm) => planTrip(c, mm)).filter(Boolean)
      .map((q) => `<tr class="${q.method.id === m.id ? 'best' : ''}"><td><b>${esc(q.method.label)}</b></td><td>${q.capAll}</td><td>${dur(q.oneWay)}</td><td>${short(q.ticket)}</td><td class="${pnClass(q.total)}">${short(q.total)}</td><td class="${pnClass(q.perHour)}">${short(q.perHour)}/h</td></tr>`).join('');
    const packTxt = p.outPlan.map((e) => `${e.n}x ${e.name}`).join(', ');
    const used = p.outPlan.reduce((s, e) => s + e.n, 0);
    const en = p.energy;
    const cd = data.cooldowns && Number(data.cooldowns.drug) || 0;
    return `<div class="detail-h"><button type="button" class="btn" id="ttp-back">← All trips</button>
        <div><h3>${esc(c.name)}</h3><div class="meta">${esc(c.city)} · ${esc(m.label)} · stock reported ${ago(p.update)}${p.src ? ` via ${esc(p.src)}` : ''}</div></div></div>
      <div class="cards">
        <div class="card"><div class="k">Profit per hour</div><div class="v ${pnClass(p.perHour)}">${money(p.perHour)}</div></div>
        <div class="card"><div class="k">Profit per trip</div><div class="v ${pnClass(p.total)}">${money(p.total)}</div></div>
        <div class="card"><div class="k">Round trip</div><div class="v">${dur(p.roundMin)}</div><div class="note">${dur(p.oneWay * (1 - FLIGHT_VARIANCE))}–${dur(p.oneWay * (1 + FLIGHT_VARIANCE))} each way, ${settings.stayMin}m abroad</div></div>
        <div class="card"><div class="k">Cash up front</div><div class="v">${short(p.outSpend + (m.id === 'standard' ? p.ticket : 0))}</div><div class="note">Imports (${short(p.inSpend)}) are paid from shop sales</div></div>
        ${p.hasRange ? `<div class="card"><div class="k">Worst case</div><div class="v ${pnClass(p.totalLow)}">${money(p.totalLow)}</div><div class="note">${money(p.perHourLow)}/h if Black Market prices move against you during the ${dur(p.oneWay)} flight${settings.conservative ? ' (plan is already built on this)' : ''}</div></div>` : ''}
        ${en ? `<div class="card"><div class="k">Energy</div><div class="v ${en.wasted ? 'neg' : 'pos'}">${en.wasted ? `${en.wasted}E wasted` : 'No waste'}</div><div class="note">${en.current}/${en.maximum}E ${en.src === 'page' ? 'now' : '(API, refreshes every minute)'} · ${en.current > en.maximum ? 'above max, so no regen until you use some' : en.departIn > 0 ? `leave within ${dur(en.departIn / 60)} to land full` : 'energy caps during this trip'}</div></div>` : ''}
        ${cd ? `<div class="card"><div class="k">Drug cooldown</div><div class="v">${dur(cd / 60)}</div><div class="note">${cd / 60 < p.roundMin ? 'Ends during the trip' : 'Still running when you land'}</div></div>` : ''}
      </div>
      ${p.perkWarns.map((w) => callout('warn', '⚠', esc(w))).join('')}
      ${p.falling.length ? callout('warn', '▼', `<b>Falling price:</b> ${p.falling.map((e) => `${esc(e.name)} ${Math.abs(e.v * 100).toFixed(0)}%/h`).join(', ')}. The plan uses the projected price at landing; a faster method helps.`) : ''}
      ${p.stale ? callout('warn', '⏱', `Stock for ${esc(c.name)} was reported ${ago(p.update)}; import quantities are discounted to ${Math.round(p.factor * 100)}%.`) : ''}
      <div class="section"><div class="section-h"><span class="step">1</span><h4>Before you fly: buy and pack</h4><span class="sub">${used} of ${p.cap} slots</span></div>
        ${settings.doExport ? lineTable(p.outPlan, 'out') : '<div class="note">Exporting is turned off in Settings.</div>'}
        ${packTxt ? `<div class="note" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">Packing list: <b>${esc(packTxt)}</b> <button type="button" class="btn sm" data-copy="${esc(packTxt)}">Copy list</button></div>` : ''}</div>
      <div class="section"><div class="section-h"><span class="step">2</span><h4>Abroad: sell to the shop, then buy</h4><span class="sub">${short(p.inSpend)} to spend</span></div>${lineTable(p.backPlan, 'in')}</div>
      ${c.code === 'sou' && settings.huntShow ? huntCardHTML(p.oneWay, p.oneWay) : ''}
      <div class="section"><div class="section-h"><span class="step">3</span><h4>Back home: sell</h4><span class="sub ${pnClass(p.inProfit)}">${money(p.inProfit)}</span></div>
        <div class="note" style="margin:0">After ${settings.sellVia === 'bazaar' ? 'bazaar sales (no tax)' : `the ${Math.round(sellFee() * 100)}% market tax`}.</div></div>
      <h4>Every flight method to ${esc(c.name)}</h4>
      <div class="tablewrap"><table><thead><tr><th>Method</th><th>Slots</th><th>Each way</th><th>Ticket</th><th>Trip</th><th>Per hour</th></tr></thead><tbody>${others}</tbody></table></div>
      <h4>Steps</h4><ol class="steps">
        <li>Buy the export items on the item market. <b>Market ↗</b> opens the page; you buy.</li>
        <li>At the <a href="https://www.torn.com/page.php?sid=travel" target="_blank" rel="noopener">Travel Agency ↗</a>, search each item, then Add / Fill. Pick <b>${esc(m.label)}</b>; the agency remembers your last method.</li>
        <li>Abroad: sell the exports first (that frees the slots), then buy the import list. You must be within capacity to fly home.</li>
        <li>Fly home and sell. ${settings.sellVia === 'bazaar' ? 'Bazaar sales avoid' : 'Item market sales pay'} the 5% sales tax.</li></ol>
      <div class="note">Buy-back rule (Traveling 2.0): Black Market goods at the current price, everything else at 75% of the shop price. Weapons and armour: up to 100 of each per trip. Suitcases can't be taken abroad, so they're never planned as exports.</div>`;
  }

  function abroadHTML() {
    const t = data.travel;
    if (!t || !t.code) return callout('warn', '🌍', 'You don\'t appear to be abroad, or your key can\'t read your travel status. Pick a trip in <b>Best trips</b>; this tab fills in when you land.');
    const c = BY_CODE[t.code];
    return `<div class="detail-h"><div><h3>${t.timeLeft > 0 ? `Flying to ${esc(c.name)}` : `You're in ${esc(c.name)}`}</h3>
      <div class="meta">${t.timeLeft > 0 ? `Lands in ${dur(t.timeLeft / 60)}` : esc(c.city)}</div></div></div>`
      + (c.code === 'sou' && settings.huntShow ? (() => { const back = flightMin(c, METHODS.filter(methodAvailable).sort((a, b) => flightMin(c, a) - flightMin(c, b))[0] || METHODS[0]); return huntCardHTML(t.timeLeft > 0 ? t.timeLeft / 60 : 0, back); })() : '') + localLists(c);
  }
  function localLists(c) {
    const st = data.stock[c.code];
    if (!st) return callout('warn', '⚠', 'No stock data for this country.');
    const fee = sellFee();
    const rows = st.items.map((it) => { const info = itemInfo(it.id) || {}; const sb = sellBack(it), home = (info.mp || 0) * (1 - fee); return { it, info, sb, home, buyProfit: home - it.cost, restock: restockInfo(c.code, it) }; });
    return `<div class="note">Stock reported ${ago(st.update)}.</div>
      <div class="section"><div class="section-h"><span class="step">1</span><h4>Sell to this shop (if you're carrying them)</h4></div>
      <div class="tablewrap"><table><thead><tr><th>Item</th><th>Shop pays</th><th>Torn market</th><th>vs market</th></tr></thead><tbody>${rows.slice().sort((a, b) => (b.sb - (b.info.mp || 0)) - (a.sb - (a.info.mp || 0))).map((r) => `
        <tr><td><b>${esc(r.it.name)}</b>${isBM(r.it) ? '<span class="tag bm">BM</span>' : ''}</td><td>${short(r.sb)}</td><td>${short(r.info.mp)}</td><td class="${pnClass(r.sb - (r.info.mp || 0))}">${short(r.sb - (r.info.mp || 0))}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="section"><div class="section-h"><span class="step">2</span><h4>Buy here to sell at home</h4></div>
      <div class="tablewrap"><table><thead><tr><th>Item</th><th>Stock</th><th>Cost</th><th>Sells home</th><th>Profit each</th></tr></thead><tbody>${rows.sort((a, b) => b.buyProfit - a.buyProfit).map((r) => `
        <tr><td><b>${esc(r.it.name)}</b>${r.restock ? `<div class="note">${esc(r.restock.text)}</div>` : ''}</td><td>${r.it.qty.toLocaleString()}</td><td>${short(r.it.cost)}</td><td>${short(r.home)}</td><td class="${pnClass(r.buyProfit)}">${short(r.buyProfit)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  function sparkline(pts) {
    if (pts.length < 2) return '';
    const w = 96, h = 24, vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${((p.t - t0) / Math.max(1, t1 - t0) * w).toFixed(1)},${(2 + (h - 4) - (hi === lo ? (h - 4) / 2 : (p.v - lo) / (hi - lo) * (h - 4))).toFixed(1)}`).join('');
    const up = vs[vs.length - 1] >= vs[0];
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${up ? '#5be08f' : '#ff9a92'}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  function bmHTML() {
    const rows = [];
    for (const c of COUNTRIES) {
      const st = data.stock[c.code]; if (!st) continue;
      for (const it of st.items) {
        if (!isBM(it)) continue;
        const info = itemInfo(it.id) || {};
        rows.push({ c, it, mp: info.mp || 0, tr: trend24(c.code, it.id, it.cost), v: velocity(c.code, it.id), spark: sparkline(series(c.code, it.id)) });
      }
    }
    if (!rows.length) return callout('warn', '⚠', 'No Black Market items found. If drugs are listed under another type, add their names in <b>Settings → Treat as Black Market</b>.');
    rows.sort((a, b) => (b.it.cost - b.mp) - (a.it.cost - a.mp));
    const arrow = (n, txt) => `<span class="${pnClass(n)}">${n >= 0 ? '▲' : '▼'} ${txt}</span>`;
    return `<div class="note" style="margin-top:0">Black Market shops buy at their current price. <b>Export margin</b> = shop price − Torn market value. Trend history builds every 10 minutes while the planner runs (7 days kept).</div>
      <div class="tablewrap"><table><thead><tr><th>Item</th><th class="l">Country</th><th>Shop price</th><th>Torn market</th><th>Export margin</th><th>Now</th><th>24h</th><th>Trend</th></tr></thead><tbody>${rows.map((r) => `
        <tr><td><b>${esc(r.it.name)}</b></td><td class="l">${esc(r.c.name)}</td><td>${short(r.it.cost)}</td><td>${short(r.mp)}</td>
        <td class="${pnClass(r.it.cost - r.mp)}">${short(r.it.cost - r.mp)}</td>
        <td>${r.v != null ? arrow(r.v, `${Math.abs(r.v * 100).toFixed(1)}%/h`) : '<span class="dim">—</span>'}</td>
        <td>${r.tr ? arrow(r.tr.pct, `${Math.abs(r.tr.pct).toFixed(1)}%`) : '<span class="dim">—</span>'}</td><td>${r.spark || '<span class="dim">building…</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function settingsHTML() {
    const s = settings;
    const opt = (v, cur, label) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${label}</option>`;
    const av = apiValues() || {};
    const TAG = '<span class="api-tag" title="Filled in from the Torn API. Untick &quot;Read my travel perks&quot; to set it yourself.">API</span>';
    // A tick box the API says yes to is ticked and locked; where the API has nothing, the box stays yours.
    // Tourism Day follows Torn's calendar both ways.
    const cb = (k, label) => {
      const a = av[k], locked = a === true || (k === 'tourismDay' && a === false);
      return `<label><input type="checkbox" data-s="${k}"${(locked ? a : s[k]) ? ' checked' : ''}${locked ? ' disabled' : ''}> ${label}${locked ? ' ' + TAG : ''}</label>`;
    };
    const num = (k, label, attrs) => { const a = av[k], locked = a != null; return `<label>${label}${locked ? ' ' + TAG : ''} <input type="number" ${attrs} data-s="${k}" value="${locked ? a : s[k]}"${locked ? ' disabled' : ''}></label>`; };
    const group = (title, inner) => `<div class="set-group"><h4>${title}</h4>${inner}</div>`;
    return group('API key', `
        <div class="note" style="margin-top:0">A <b>Public</b> key is enough. <a href="https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=Trip%20Planner&type=1" target="_blank" rel="noopener">Create one ↗</a> · ${apiKey ? `Saved key ends <b>…${esc(apiKey.slice(-4))}</b>` : 'No key saved'}</div>
        <label><input type="password" id="ttp-key" placeholder="16-character key" style="flex:1;min-width:160px"><button type="button" class="btn primary" id="ttp-savekey">Save</button><button type="button" class="btn" id="ttp-clearkey">Clear</button></label>
        <table class="tos"><tbody>
          <tr><th>Data Storage</th><td>Only locally: key, settings, cached item values (10 min), item market listings (30 min, used for up to an hour; Torn updates them hourly), foreign stock (2 min), 25 hours of Black Market price history and restock times, travel slot counts read from the Travel Agency (12 h), your travel perks, Business Class Ticket count, hunting skill and Torn's event dates (30 min), the pay from your last 60 hunts (read from the hunting page), restock times from your Stock Analysis reports (30 min), bazaar listings from TornW3B (1 min)</td></tr>
          <tr><th>Data Sharing</th><td>Nobody. Your key and data go only to api.torn.com; TornW3B receives item IDs only (nothing about you)</td></tr>
          <tr><th>Purpose of Use</th><td>Competitive advantage: planning profitable travel trades</td></tr>
          <tr><th>Key Storage &amp; Sharing</th><td>Stored / Used only for automation (sent only to api.torn.com)</td></tr>
          <tr><th>Key Access Level</th><td>Public. Optional with Minimal: travel status, energy bars, drug cooldown, travel perks, your Business Class Ticket count and hunting skill (user → travel, bars, cooldowns, perks, inventory, skills). Tourism Day and Tiger Day from Torn's calendar (Public). Optional with Limited: exact restock times from your own Stock Analysis reports (user → reports, every 30 min)</td></tr></tbody></table>
        <div class="note">Foreign stock: <a href="https://prombot.co.uk/" target="_blank" rel="noopener">Prometheus</a>, <a href="https://torn-intel.com/" target="_blank" rel="noopener">TornIntel</a> and <a href="https://yata.yt/" target="_blank" rel="noopener">YATA</a>, read-only; nothing about you is sent. See each site for its own terms. Bazaar prices: <a href="https://weav3r.dev/" target="_blank" rel="noopener">TornW3B</a>, read-only, no key sent.</div>
        <div class="note"><b>Credits:</b> made by <a href="https://www.torn.com/profiles.php?XID=571041" target="_blank" rel="noopener">Eaglewing [571041]</a>. Foreign stock: <a href="https://yata.yt/" target="_blank" rel="noopener">YATA</a> by <a href="https://www.torn.com/profiles.php?XID=2000607" target="_blank" rel="noopener">Kivou [2000607]</a>, <a href="https://prombot.co.uk/" target="_blank" rel="noopener">Prometheus</a> and <a href="https://torn-intel.com/" target="_blank" rel="noopener">TornIntel</a>, and every player who shares the stock they see abroad. Bazaar prices: <a href="https://weav3r.dev/" target="_blank" rel="noopener">TornW3B</a> by <a href="https://www.torn.com/profiles.php?XID=1853324" target="_blank" rel="noopener">Weav3r [1853324]</a>. Travel data: the <a href="https://wiki.torn.com" target="_blank" rel="noopener">Torn wiki</a>. Not affiliated with Torn. <a href="https://github.com/Eaglewing91/travel-2-dough" target="_blank" rel="noopener">Project page</a> · MIT licence.</div>`)
      + group('Flight methods you have', `${(() => { const pk = s.usePerks ? perkInfo() : null; return pk && pk.methods.length ? `<div class="note" style="margin-top:0"><b>From your perks:</b> ${esc(pk.methods.join(' · '))}. Tick any others you have below.</div>` : ''; })()}<div class="grid">
        ${cb('hasAirstrip', 'Airstrip + pilot')}${cb('hasWLT', 'WLT private flights')}
        ${num('bizTickets', 'Business Class Tickets', 'min="0"')}
        ${cb('lingerie10', '10★ Lingerie Store (free Business)')}
        ${cb('mailingBook', '"Mailing Yourself Abroad" book (−25% time)')}<label>Book ends <input type="datetime-local" data-s="mailingUntil" value="${esc(s.mailingUntil)}"></label>
        ${cb('showAllMethods', 'List every method separately')}</div>`)
      + group('Capacity', `${cb('usePerks', 'Read my travel perks from the API (needs a Minimal key)')}${cb('useReports', 'Use exact restock times from my Stock Analysis reports (needs a Limited key; read every 30 min)')}
        <div class="note">${(() => { const pk = s.usePerks ? perkInfo() : null; return pk ? (pk.parts.length ? `<b>From your perks:</b> ${esc(pk.parts.join(' · '))}. Standard ${10 + pk.slots}, other methods ${15 + pk.slots} slots${s.tourismDay ? ', doubled for Tourism Day' : ''}. Boxes marked API are filled in from Torn and locked; untick this to set them yourself.` : 'Your perks list has no travel capacity perks; base slots apply.') : s.usePerks ? `Perks not available${data.perksErr ? `: <b>${esc(data.perksErr)}</b>` : ''}. ${/error 16|access level/i.test(data.perksErr || '') ? 'Your key is Public; perks need a <b>Minimal</b> key. ' : ''}Using the boxes below.` : 'Using the boxes below.'; })()}</div>
        ${s.usePerks && data.perks && data.perks.length ? `<details class="note"><summary>Travel-related perks Torn returned (${data.perks.filter((p) => /travel|flower|plush|suitcase/i.test(p.text)).length} of ${data.perks.length})</summary>${data.perks.filter((p) => /travel|flower|plush|suitcase/i.test(p.text)).map((p) => `<div>${esc(p.kind)}: ${esc(p.text)}</div>`).join('') || '<div>None mention travel.</div>'}</details>` : ''}
        <button type="button" class="btn sm" id="ttp-perks-refresh" style="margin:6px 0">Re-read perks</button>
        <div class="grid">
        ${(() => { const a = av.suitcase, cur = a != null ? a : s.suitcase; return `<label>Suitcase${a != null ? ' ' + TAG : ''} <select data-s="suitcase"${a != null ? ' disabled' : ''}>${opt(0, cur, 'None')}${opt(1, cur, 'Small (+1)')}${opt(2, cur, 'Medium (+2)')}${opt(3, cur, 'Large (+3)')}</select></label>`; })()}
        ${av.jobSlots != null ? `<label>Job ${TAG} <select disabled><option>${av.jobSlots ? `From your job perks (+${av.jobSlots})` : 'No travel perks from your job'}</option></select></label>` : `<label>Job <select data-s="job">${opt('none', s.job, 'None of these')}${opt('lingerie3', s.job, 'Lingerie 3★+ (+2)')}${opt('cruise3', s.job, 'Cruise Line 3★ (+2)')}${opt('cruise10', s.job, 'Cruise Line 10★ (+5)')}</select></label>`}
        ${num('excursion', 'Faction Excursion', 'min="0" max="10"')}
        ${cb('smugglingBook', '"Smuggling For Beginners" (+10)')}<label>Book ends <input type="datetime-local" data-s="smugglingUntil" value="${esc(s.smugglingUntil)}"></label>
        ${cb('tourismDay', 'Tourism Day (×2)')}${cb('flowerToy7', '7★ Flower / Toy Shop (+5 flowers/plushies)')}
        <label>Slots kept for gear / meds <input type="number" min="0" max="80" data-s="reserved" value="${s.reserved}"></label></div>
        ${s.usePerks ? `<div class="note">${(() => { const x = data.extra, bits = []; if (x && x.tourism) { const nx = x.tourism.filter((e) => e.end > Date.now()).sort((a, b) => a.start - b.start)[0]; bits.push(av.tourismDay ? `<b>Tourism Day is on</b> (Torn's calendar), until ${esc(clock(av.tourismEnd))}.` : nx ? `Next Tourism Day (Torn's calendar): ${esc(new Date(nx.start).toUTCString().slice(0, 16))}.` : 'No Tourism Day left on Torn\'s calendar this year.'); } if (x && x.tickets != null) bits.push(`Business Class Tickets in your inventory: <b>${x.tickets}</b>.`); if (x && x.errs && x.errs.length) bits.push(`Couldn't read: ${esc(x.errs.join('; '))}.`); bits.push('Book end dates aren\'t in the API: set them yourself.'); return bits.join(' '); })()}</div>` : ''}
        <div class="note">${(() => { const seen = Object.entries(s.seenSlots || {}).filter(([, v]) => Date.now() - v.at < 12 * 3600000); return seen.length ? `<b>Read from the Travel Agency:</b> ${seen.map(([k, v]) => `${esc((METHODS.find((m) => m.id === k) || {}).label || k)} ${v.n} slots (${ago(v.at)})`).join(' · ')}. These override the numbers above for 12 hours; open the Travel Agency to refresh them.` : 'Open the Travel Agency once and the planner will read your real slot count from it.'; })()}</div>
        <div class="note">${(() => { const t = Object.keys(s.seenTimes || {}).length, c = Object.entries(s.seenCosts || {}); return t || c.length ? `<b>Flight times and prices read from the Travel Agency:</b> ${t} destination${t === 1 ? '' : 's'} timed${c.length ? `; Standard ticket ${c.map(([k, v]) => `${esc(BY_CODE[k] ? BY_CODE[k].name : k)} ${money(v.cost)}`).join(', ')}` : ''}. Used for 30 days instead of the built-in table; pick a destination in the Travel Agency to update it.` : 'Pick a destination in the Travel Agency and the planner will read its real flight times and Standard ticket price from the page.'; })()}</div>
        <div class="note">Weapons, armour, meds and Resupply Boxes all use slots (clothing doesn't). The planner can't see what's already packed.</div>`)
      + group('Trading', `<div class="grid">
        ${cb('doExport', 'Plan exports (take items out)')}${cb('doImport', 'Plan imports (bring items back)')}
        ${cb('weaponsArmour', 'Include weapons and armour bought abroad')}<div class="note">Torn has announced upcoming travel restrictions on weapons and armour. If they stop you bringing them home, switch this off.</div>
        ${cb('liveListings', 'Price exports and imports from item market listings (Torn updates these hourly; ≤14 API calls every 30 min)')}
        ${cb('useBazaars', 'Include bazaar prices from <a href="https://weav3r.dev/" target="_blank" rel="noopener">TornW3B</a> (no key sent)')}<label>Ignore bazaar listings older than (min) <input type="number" min="5" max="1440" data-s="bazaarMaxAge" value="${s.bazaarMaxAge}"></label>${cb('projectPrices', 'Project Black Market prices to landing time, with a range')}
        ${cb('conservative', 'Build plans on the worst-case Black Market price')}
        <label>Sell at home via <select data-s="sellVia">${opt('market', s.sellVia, 'Item market (5% tax)')}${opt('anon', s.sellVia, 'Item market, anonymous (5% + 10%)')}${opt('bazaar', s.sellVia, 'Bazaar (no tax)')}${opt('custom', s.sellVia, 'Custom fee')}</select></label>
        <label>Custom fee % <input type="number" min="0" max="50" step="0.5" data-s="customFee" value="${s.customFee}"></label>
        <label>Fallback premium over market value % <input type="number" min="-50" max="100" data-s="buyPremium" value="${s.buyPremium}"></label>
        <label>Share of foreign stock you'll get % <input type="number" min="1" max="100" data-s="stockShare" value="${s.stockShare}"></label>
        <label>Cash budget (0 = none) <input type="number" min="0" step="100000" data-s="budget" value="${s.budget}"></label>
        <label>Minutes spent abroad <input type="number" min="0" max="120" data-s="stayMin" value="${s.stayMin}"></label>
        <label>Ignore items earning under $ <input type="number" min="0" data-s="minProfit" value="${s.minProfit}"></label>
        <label>Hide stock reports older than (h) <input type="number" min="1" max="72" data-s="hideOlderH" value="${s.hideOlderH}"></label>
        <div style="grid-column:1 / -1"><div class="note" style="margin-top:0"><b>Stock feeds</b></div>${feedListHTML()}</div>
        <label>Stock source <select data-s="stockSource">${opt('auto', s.stockSource, 'All: newest report per country')}${opt('prometheus', s.stockSource, 'Prometheus only')}${opt('tornintel', s.stockSource, 'TornIntel only')}${opt('yata', s.stockSource, 'YATA only')}</select></label></div>
        <label style="margin-top:10px">Treat as Black Market (names, comma separated) <input type="text" data-s="bmOverrides" value="${esc(s.bmOverrides)}" style="flex:1;min-width:180px"></label>
        <div class="note">Which shop sells each item in each country comes from Torn's API, so Black Market goods are detected automatically. "75%?" only appears if the API doesn't list an item's shop; add it here if you know it's Black Market.</div>`)
      + group('Hunting (South Africa)', `<div class="grid">
        ${cb('huntShow', 'Show hunting on South Africa trips')}${cb('huntOn', 'Count hunting money in trip profits')}
        <label>Torn pays you per hunt $ <input type="number" min="0" step="1000" data-s="huntPerHunt" value="${s.huntPerHunt || ''}" placeholder="${(() => { const e = huntEstimate((data.extra || {}).hunting); return e ? `≈${e.toLocaleString()} (estimate)` : 'not set'; })()}"></label>
        <label>Energy to keep (don't hunt below) <input type="number" min="0" max="1000" data-s="huntKeep" value="${s.huntKeep}"></label></div>
        <div class="note">${(() => { const L = huntLearned((data.extra || {}).hunting), log = huntLog(); return L ? `Learned from your hunts: <b>${money(L.per)}</b> a hunt (middle of ${L.n}${L.sess ? `, ${L.sess}` : ''}). Last read: "${esc((log[log.length - 1] || {}).txt || '')}" <a href="#" id="ttp-hunts-clear">Clear</a>` : 'After each hunt, the pay Torn shows is learned here.'; })()}</div>
        <div class="note">Leave it empty to use what's learned, or an estimate from skill 70. A hunt costs 10 energy and $500, and that energy can't go to the gym. ${(() => { const b = huntBonus(); return b.parts.length ? `Your hunting perks: ${esc(b.parts.join(' · '))}.` : ''; })()}</div>`)
      + group('Alerts (API data only)', `<div class="grid">
        ${cb('alertOn', 'Alert me')}${cb('alertBackground', 'Keep checking every 5 min while the panel is closed')}
        <label>Trip worth at least $/h <input type="number" min="0" step="50000" data-s="alertPerHour" value="${s.alertPerHour}"></label>
        <label>Black Market margin at least $ <input type="number" min="0" step="10000" data-s="alertMargin" value="${s.alertMargin}"></label></div>
        <div class="note">Each alert fires once per 6 hours per trip or item.</div>`)
      + group('Page badges', `${cb('overlays', 'Show profit badges on foreign shop pages, the item market and the Travel Agency (reads only the page you are viewing)')}`);
  }
  function bindSettings() {
    const keyIn = body.querySelector('#ttp-key');
    body.querySelector('#ttp-savekey').addEventListener('click', () => {
      const k = keyIn.value.trim();
      if (!/^[A-Za-z0-9]{16}$/.test(k)) { keyIn.value = ''; keyIn.placeholder = 'Not a valid 16-character key'; return; }
      apiKey = k; GM_setValue(K.key, k); GM_setValue('ttp_perks_v1', null); data.perks = null; keyIn.value = ''; keyIn.placeholder = 'Saved. Reading prices and perks…'; refresh(true);
    });
    body.querySelector('#ttp-clearkey').addEventListener('click', () => { apiKey = ''; GM_setValue(K.key, ''); render(); });
    const hc = body.querySelector('#ttp-hunts-clear'); if (hc) hc.addEventListener('click', (e) => { e.preventDefault(); GM_setValue(HUNT_LOG, []); lastPlans = data.items && data.stock ? allPlans() : []; render(); });
    const pr = body.querySelector('#ttp-perks-refresh'); if (pr) pr.addEventListener('click', async () => { pr.textContent = 'Reading…'; GM_setValue('ttp_perks_v1', null); GM_setValue('ttp_extra_v2', null); await loadPerks(); await loadExtras(); lastPlans = data.items && data.stock ? allPlans() : []; render(); });
    body.querySelectorAll('[data-s]').forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.s;
      if (el.type === 'checkbox') settings[k] = el.checked;
      else if (el.type === 'number' || k === 'suitcase') settings[k] = Number(el.value) || 0;
      else settings[k] = el.value;
      save();
      if (k === 'stockSource') GM_setValue(K.stock, null);
      if (k === 'alertOn' || k === 'alertBackground') schedule();
      if (k === 'overlays') { if (!settings.overlays) clearOverlays(); else overlays(); }
    }));
  }

  /* ===================== PAGE OVERLAYS (read the page you're viewing only) ===================== */
  const nameIndex = () => {
    const idx = new Map();
    if (!data.items) return idx;
    for (const it of Object.values(data.items)) if (it.name) idx.set(lower(it.name), it);
    return idx;
  };
  function clearOverlays() { document.querySelectorAll('.ttp-badge, #ttp-ta').forEach((n) => n.remove()); }
  function bestShopFor(id) {
    let best = null;
    for (const code of Object.keys(data.stock || {})) for (const it of data.stock[code].items) if (it.id === id) { const sb = sellBack(it); if (!best || sb > best.sb) best = { code, sb, bm: isBM(it) }; }
    return best;
  }
  // Attach a badge after any element whose own text is exactly an item name (works on shop pages and the item market).
  // onePerItem: badge only the first occurrence of each item in page order (the market's header, not every listing tile).
  // Existing badges are refreshed in place when the best shop changes.
  function badgeItems(root, makeBadge, onePerItem) {
    const idx = nameIndex(); if (!idx.size) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, { acceptNode: (el) => (el.childElementCount === 0 && el.textContent && el.textContent.length < 60 && !el.closest('#ttp,#ttp-ta,script,style,textarea,input,button,select,[role="listbox"],[role="option"],[class*="dropdown"],[class*="Dropdown"]') && !el.classList.contains('ttp-badge') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    const seen = new Set();
    let n = 0;
    for (let el = walker.nextNode(); el && n < 400; el = walker.nextNode()) {
      const it = idx.get(lower(el.textContent)); if (!it) continue;
      const old = el.nextElementSibling && el.nextElementSibling.classList.contains('ttp-badge') ? el.nextElementSibling : null;
      if (onePerItem && seen.has(it.id)) { if (old) old.remove(); continue; }
      seen.add(it.id);
      const fresh = makeBadge(it);
      if (old) { if (!fresh) old.remove(); else updateBadge(old, fresh); continue; }
      if (fresh) { el.insertAdjacentElement('afterend', fresh); n++; }
    }
  }
  // Item market: the "Showing N market listings for <item>" header. The badge goes at the end of it and nowhere else.
  const textSansBadges = (el) => [...el.childNodes].map((n) => (n.nodeType === 3 ? n.textContent : n.nodeType === 1 && !n.classList.contains('ttp-badge') ? textSansBadges(n) : '')).join('');
  function marketHeader() {
    const found = [];
    for (const el of document.querySelectorAll('[class*="itemsHeader"], [class*="containerHeader"], [class*="itemsHeader"] [class*="title"], [class*="containerHeader"] [class*="title"]')) {
      const m = /listings? for (.+?)\s*$/i.exec(textSansBadges(el).trim());
      if (m) found.push({ el, name: m[1] });
    }
    // innermost match: the title div, not the container around it
    return found.find((f) => !found.some((g) => g !== f && f.el.contains(g.el))) || null;
  }
  function marketBadge(makeBadge) {
    const h = marketHeader();
    if (!h) { badgeItems(document.body, makeBadge, true); return; }
    const it = nameIndex().get(lower(h.name));
    const fresh = it ? makeBadge(it) : null;
    // Exactly one badge on the market page: the first one inside the header title. Everything else goes.
    const keep = h.el.querySelector(':scope > .ttp-badge');
    document.querySelectorAll('.ttp-badge').forEach((b) => { if (b !== keep) b.remove(); });
    const old = keep;
    if (!fresh) { if (old) old.remove(); return; }
    if (!old) h.el.appendChild(fresh);
    else updateBadge(old, fresh);
  }
  // Badges carry their hover text in data-tip (own CSS tooltip), not title: Torn's tooltip system would turn a title into a pop-up that can get stuck.
  const mkBadge = (cls, text, title) => { const b = document.createElement('span'); b.className = `ttp-badge ${cls}`; b.textContent = text; if (title) b.dataset.tip = title; return b; };
  const sameBadge = (a, b) => a.textContent === b.textContent && (a.dataset.tip || '') === (b.dataset.tip || '') && a.className === b.className;
  const updateBadge = (old, fresh) => { if (!sameBadge(old, fresh)) { old.textContent = fresh.textContent; old.className = fresh.className; if (fresh.dataset.tip) old.dataset.tip = fresh.dataset.tip; else delete old.dataset.tip; } };
  let overlayObs = null, overlayPending = false;
  function overlays() {
    if (!settings.overlays || !data.items || !data.stock) return;
    const pg = page();
    const abroad = data.travel && data.travel.code && !data.travel.timeLeft ? BY_CODE[data.travel.code] : null;
    const isMarket = pg.sid === 'itemmarket', isTravel = pg.sid === 'travel';
    const run = () => {
      if (isTravel) travelAgencyOverlay();
      // TUCC: short badge ("✈ UK $1.2m"); never on weapons or armour without a market value (ranked war weapons sell
      // for far more on the market than any shop abroad pays), and only when abroad pays more than market value.
      else if (isMarket) marketBadge((it) => { const b = bestShopFor(it.id); if (!b) return null;
        const where = SHORT_NAME[b.code] || BY_CODE[b.code].name, full = BY_CODE[b.code].name + (b.bm ? ' Black Market' : ' shop');
        if (!it.mp) { if (WEAPON_ARMOR_TYPES.test(it.type)) return null; return mkBadge('info', `✈ ${where} ${short(b.sb)}`, `${full} buys this back at ${money(b.sb)}. Torn has no market value for it, so compare with the listings on this page before buying.`); }
        if (b.sb <= it.mp) return null; return mkBadge('pos', `✈ ${where} ${short(b.sb)}`, `Exporting: ${full} buys back at ${money(b.sb)} vs market value ${money(it.mp)}`); });
      else if (abroad) {
        const st = data.stock[abroad.code]; if (!st) return;
        const fee = sellFee();
        badgeItems(document.body, (it) => {
          const s = st.items.find((x) => x.id === it.id); if (!s) return null;
          const profit = it.mp * (1 - fee) - s.cost, sb = sellBack(s);
          const b = mkBadge(profit >= 0 ? 'pos' : 'neg', `${profit >= 0 ? '+' : ''}${short(profit)} home`, `Buy here ${money(s.cost)} → sells at home for ${money(it.mp * (1 - fee))} after tax. Shop buys back at ${money(sb)}.`);
          return b;
        });
      }
    };
    run();
    if (!overlayObs && (isMarket || isTravel || abroad)) {
      overlayObs = new MutationObserver(() => { if (overlayPending) return; overlayPending = true; requestAnimationFrame(() => { overlayPending = false; run(); }); });
      overlayObs.observe(document.body, { childList: true, subtree: true });
    }
  }
  // Travel Agency: show the best plan and the current selection check (display only; no buttons, no input).
  // Read what you've picked on the Travel Agency page you're viewing: destination, method, and how many slots Torn gives you.
  const METHOD_BY_LABEL = { standard: 'standard', airstrip: 'airstrip', private: 'private', business: 'business' };
  function readAgency() {
    const txt = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.trim() : ''; };
    const destName = txt('#travel-root [class*="destDropdownToggler"] [class*="fromToValue"]')
      || ((document.querySelector('#travel-root button[class*="pin"][aria-pressed="true"]') || {}).getAttribute || (() => ''))('aria-label') || '';
    const methodLabel = txt('#travel-root [class*="flightTypeToggle"] [class*="label"]');
    const slots = document.querySelectorAll('#travel-root ul[class*="inventoryPanel"] > li[class*="inventorySlot"]').length;
    // Every flight type's time for this destination (Torn lists them in the flight-type menu), and the
    // Standard ticket price from the confirm sentence ("... $11,000 ..."). Read-only: nothing is clicked.
    const times = {};
    document.querySelectorAll('#travel-root [class*="flightTypeOption"]').forEach((o) => {
      const lab = o.querySelector('[class*="label"]'), dur = o.querySelector('[class*="duration"]');
      const id = lab && METHOD_BY_LABEL[lower(lab.textContent.trim())];
      const min = dur ? parseDur(dur.textContent) : 0;
      if (id && min) times[id] = min;
    });
    const sentence = (document.querySelector('#travel-root [class*="departPanel"] [class*="sentence"]') || {}).textContent || '';
    const price = /\$\s?([\d,]{3,})/.exec(sentence);
    return { code: NAME_TO_CODE[lower(destName)] || null, method: METHODS.find((m) => m.id === METHOD_BY_LABEL[lower(methodLabel)]) || null, slots,
      times, cost: price ? Number(price[1].replace(/,/g, '')) : null };
  }
  function parseDur(t) {
    const h = /(\d+)\s*h/.exec(t), mi = /(\d+)\s*m/.exec(t);
    return (h ? Number(h[1]) * 60 : 0) + (mi ? Number(mi[1]) : 0);
  }
  // Remember the times and Standard price the Travel Agency shows; returns true when something changed.
  function rememberAgency(ag) {
    if (!ag.code) return false;
    let changed = false;
    const cut = timeCut(), T = settings.seenTimes || {}, row = T[ag.code] || {};
    for (const [id, min] of Object.entries(ag.times || {})) {
      const base = Math.round((min / (1 - cut)) * 10) / 10, cur = row[id];
      if (!cur || Math.abs(cur.base - base) > 0.6 || Date.now() - cur.at > 864e5) { row[id] = { base, at: Date.now() }; changed = true; }
    }
    T[ag.code] = row; settings.seenTimes = T;
    if (ag.cost && ag.method && ag.method.id === 'standard') {
      const C = settings.seenCosts || {}, cur = C[ag.code];
      if (!cur || cur.cost !== ag.cost || Date.now() - cur.at > 864e5) { C[ag.code] = { cost: ag.cost, at: Date.now() }; settings.seenCosts = C; changed = true; }
    }
    if (changed) save();
    return changed;
  }
  // Remember the slot count Torn shows for each method; capacity() uses it for 12 hours (perks like books and Tourism Day expire).
  function rememberSlots(method, slots) {
    if (!method || !slots) return false;
    const seen = settings.seenSlots || {}, cur = seen[method.id];
    if (cur && cur.n === slots && Date.now() - cur.at < 3600000) return false;
    seen[method.id] = { n: slots, at: Date.now() }; settings.seenSlots = seen; save();
    return !cur || cur.n !== slots;
  }

  // Travel Agency: show the plan for the destination and method you've selected (display only; no buttons, no input).
  function travelAgencyOverlay() {
    if (!lastPlans.length) return;
    const ag = readAgency();
    const slotsChanged = rememberSlots(ag.method, ag.slots), agencyChanged = rememberAgency(ag);
    if (slotsChanged || agencyChanged) { lastPlans = allPlans(); }
    const best = lastPlans[0];
    const picked = ag.code && ag.method ? planTrip(BY_CODE[ag.code], ag.method) : null;
    const show = picked || best;
    let html;
    if (ag.code && ag.method && !picked) {
      html = `<div class="ta-h"><b>✈ Travel 2.Dough</b><span>No recent stock report for <b>${esc(BY_CODE[ag.code].name)}</b>, so no plan for it.</span></div>
        <div class="ta-note">Best trip right now: <b>${esc(best.country.name)}</b> · ${esc(best.method.label)} · <b>${short(best.perHour)}/h</b></div>`;
    } else {
      const key = settings.sortBy === 'trip' ? 'total' : 'perHour';
      const better = picked && best[key] > picked[key] * 1.05 && !(best.country.code === picked.country.code && best.method.id === picked.method.id);
      html = `<div class="ta-h"><b>✈ Travel 2.Dough</b><span>${picked ? 'Your pick:' : 'Best trip:'} <b>${esc(show.country.name)}</b> · ${esc(show.method.label)} · ${show.cap} slots · ${settings.sortBy === 'trip' ? `${short(show.perHour)}/h` : `${short(show.total)}/trip`}</span><span class="ta-ph">${settings.sortBy === 'trip' ? `${short(show.total)}/trip` : `${short(show.perHour)}/h`}</span></div>
      ${show.outPlan.length ? `<div class="ta-pack">${show.outPlan.map((e) => `<span>${e.n}× ${esc(e.name)}</span>`).join('')}</div>` : `<div class="ta-note">Nothing worth exporting; bring back ${show.backPlan[0] ? esc(show.backPlan[0].name) : '—'}.</div>`}
      ${better ? `<div class="ta-warn">⚠ ${esc(best.country.name)} by ${esc(best.method.label)} earns more right now (${settings.sortBy === 'trip' ? `${short(best.total)}/trip` : `${short(best.perHour)}/h`}).</div>` : ''}
      <div class="ta-note">Add / Fill and the method are your clicks.${show.perkWarns.length ? ' ⚠ ' + esc(show.perkWarns[0]) : ''}</div>`;
    }
    let box = document.getElementById('ttp-ta');
    if (!box) {
      box = document.createElement('div'); box.id = 'ttp-ta';
      const anchor = document.querySelector('#travel-root') || document.querySelector('.content-wrapper') || document.body;
      anchor.insertAdjacentElement('afterbegin', box);
    }
    if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
  }

  // Hunting learner: after your own click on a hunting session button, read the money from the result Torn shows.
  // Display-only: it never clicks or sends anything. Up to 20 s after the click; one reading per click.
  const HUNT_WORDS = /\b(sold|sell|carcass|animals?|hunt(?:ed|ing)?|killed|buffalo|zebra|baboon|warthog|giraffe|cheetah|hippo|leopard|lion|rhino|elephant|hyena|gorilla|tiger|addax|pangolin|vulture)\b/i;
  let huntPending = null, huntObs = null, huntStop = null;
  const huntEnd = () => { huntPending = null; if (huntObs) { huntObs.disconnect(); huntObs = null; } clearTimeout(huntStop); };
  document.addEventListener('click', (e) => {
    if (!e.isTrusted || !e.target || !e.target.closest) return;
    const t = data.travel;
    if (!(t && t.code === 'sou' && !(t.timeLeft > 0)) && !/hunt/i.test(location.href)) return;
    const btn = e.target.closest('button, a, [role="button"], input[type="submit"], input[type="button"]');
    if (!btn || btn.closest('#ttp') || btn.closest('#ttp-ta')) return;
    const label = ((btn.textContent || '') + ' ' + (btn.value || '') + ' ' + (btn.getAttribute('aria-label') || '')).trim();
    const sess = (/\b(beginner|standard|advanced)\b/i.exec(label) || [])[1];
    if (!sess && !/hunt/i.test(label)) return;
    huntPending = { at: Date.now(), sess: sess ? sess[0].toUpperCase() + sess.slice(1).toLowerCase() : (data.extra && data.extra.hunting != null ? huntSession(data.extra.hunting) : ''), done: false };
    if (!huntObs) {
      huntObs = new MutationObserver((muts) => {
        if (!huntPending || huntPending.done || Date.now() - huntPending.at > 20000) { huntEnd(); return; }
        for (const m of muts) for (const n of m.addedNodes || []) {
          if (n.nodeType !== 1 && n.nodeType !== 3) continue;
          if (n.nodeType === 1 && (n.closest('#ttp') || n.closest('#ttp-ta'))) continue;
          const txt = (n.textContent || '').replace(/\s+/g, ' ').trim();
          if (!txt || txt.length > 600 || !HUNT_WORDS.test(txt)) continue;
          const amounts = [...txt.matchAll(/\$\s?([\d,]+)/g)].map((x) => Number(x[1].replace(/,/g, ''))).filter((v) => v > 500 && v < 1e7);
          if (!amounts.length) continue;
          const gross = Math.max(...amounts);
          huntPending.done = true;
          const sess = huntPending.sess;
          huntEnd();
          const log = huntLog();
          log.push({ t: Date.now(), sess, gross, sk: data.extra ? data.extra.hunting : null, txt: txt.slice(0, 140) });
          GM_setValue(HUNT_LOG, log.slice(-60));
          if (data.items && data.stock) { lastPlans = allPlans(); if (panel.classList.contains('open')) render(); }
          return;
        }
      });
      huntObs.observe(document.body, { childList: true, subtree: true });
    }
    clearTimeout(huntStop); huntStop = setTimeout(huntEnd, 20000);   // the page watcher only runs for 20 s after your click
  }, true);

  // Keep overlays in sync with Torn's in-page navigation.
  (function watchNav() {
    const wrap = (t) => { const o = history[t]; return function () { const r = o.apply(this, arguments); window.dispatchEvent(new Event('ttp-nav')); return r; }; };
    history.pushState = wrap('pushState'); history.replaceState = wrap('replaceState');
    window.addEventListener('popstate', () => window.dispatchEvent(new Event('ttp-nav')));
    window.addEventListener('hashchange', () => window.dispatchEvent(new Event('ttp-nav')));
    window.addEventListener('ttp-nav', () => setTimeout(overlays, 300));
  })();

  if (GM_getValue(K.open, false)) toggle(true);
  else { schedule(); if (settings.overlays && apiKey) refresh(false, true); }
})();
