/* =====================================================================
 * TUCC core: module loader, shared storage, Torn API engine, TUCC panel
 * ---------------------------------------------------------------------
 * Every feature lives in a module that runs unchanged inside its own
 * wrapper. The core gives each module:
 *   - its own storage space (keys are prefixed with the module id)
 *   - its pages and timing (from the original @match / @run-at)
 *   - one shared Torn API engine: a per-minute budget shared by every
 *     module and tab, a pause after "too many requests" / key / IP errors,
 *     the key moved from the address to an Authorization header on v2
 *     calls, and a comment tag so calls are named in your API log
 *   - shared responses: the same Torn API request made by two modules or two
 *     tabs within a few seconds is answered once and shared
 *   - one alerts centre (every module's notifications, mute per module)
 *   - an optional update checker (reads the published script's version)
 * The core itself never clicks, submits or loads anything on torn.com.
 * ===================================================================== */
const TUCC = (() => {
  'use strict';
  const T_START = performance.now();                          // ms from the page starting to load until Tampermonkey ran TUCC
  const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || /*__VERSION__*/'0.0.0'/*__END_VERSION__*/;
  const CORE = 'tucc_core:';
  const modules = [];
  const state = {}; // id -> { status, error, menus: [] }

  /* ---------- real userscript-manager functions (with fallbacks) ---------- */
  const hasGM = typeof GM_getValue === 'function';
  const rawGet = (k, d) => { try { if (hasGM) return GM_getValue(k, d); const v = localStorage.getItem('tucc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const rawSet = (k, v) => { try { if (hasGM) GM_setValue(k, v); else localStorage.setItem('tucc.' + k, JSON.stringify(v)); } catch (e) {} };
  const rawDel = (k) => { try { if (typeof GM_deleteValue === 'function') GM_deleteValue(k); else localStorage.removeItem('tucc.' + k); } catch (e) {} };
  /* ---------- Torn PDA ----------
   * Torn PDA gives scripts its own request functions (PDA_httpGet / PDA_httpPost), keeps saved values in the
   * page's localStorage, and swaps the placeholder below for the API key saved in the app. TUCC only uses that
   * key if you press "Use Torn PDA key" on the API Keys screen. The build writes each module's own copy of the
   * placeholder in two halves, so no module can pick the PDA key up by itself. */
  const PDA_KEY_RAW = '###PDA-APIKEY###';
  const pdaFns = () => typeof PDA_httpGet === 'function' && typeof PDA_httpPost === 'function';
  const IS_PDA = (() => { try { return PDA_KEY_RAW.charAt(0) !== '#' || pdaFns() || typeof window.flutter_inappwebview !== 'undefined' || /tornpda/i.test(navigator.userAgent || '') || (typeof GM_info !== 'undefined' && /GMforPDA/i.test(String(GM_info.scriptHandler || ''))); } catch (e) { return false; } })();
  const pdaKey = () => (/^[A-Za-z0-9]{16}$/.test(PDA_KEY_RAW) ? PDA_KEY_RAW : '');
  const OWN_KEY = /^[a-z0-9_]+:/;                          // every value TUCC saves is named "<module>:<name>"
  const rawList = () => { try { if (typeof GM_listValues === 'function') { const l = GM_listValues(); return IS_PDA ? l.filter((k) => OWN_KEY.test(k) && ownPrefix(k)) : l; } return Object.keys(localStorage).filter((k) => k.startsWith('tucc.')).map((k) => k.slice(5)); } catch (e) { return []; } };
  // In Torn PDA the list above is the whole page's localStorage (Torn's own values included), so TUCC keeps to its own names.
  const ownPrefix = (k) => { const id = k.slice(0, k.indexOf(':')); return id === 'tucc_core' || /^(ledger|mugger|interceptor|armoury|combatdesk)$/.test(id) || modules.some((m) => m.id === id); };
  const gmXhr = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest
    : (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function') ? (o) => GM.xmlHttpRequest(o)
    : null;
  // One shape for every answer, whichever route it came by (Torn PDA's answers have no "response" or "finalUrl").
  const tidyResp = (r, o) => {
    r = r || {};
    const text = r.responseText == null ? '' : String(r.responseText);
    let resp = r.response;
    if (resp === undefined) { resp = text; if (o.responseType === 'json') { try { resp = JSON.parse(text); } catch (e) { resp = null; } } }
    return { status: Number(r.status) || 0, statusText: r.statusText || '', responseText: text, response: resp, responseHeaders: r.responseHeaders || '', readyState: 4, finalUrl: r.finalUrl || o.url };
  };
  function pdaXhr(o) {                                     // one request = one call to Torn PDA's request function
    let done = false;
    const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { fn && fn(v); } catch (e) { console.warn('[TUCC]', e); } };
    const timer = setTimeout(() => end(o.ontimeout || o.onerror, { error: 'Request timed out' }), o.timeout || 30000);
    let call;
    try { call = String(o.method || 'GET').toUpperCase() === 'POST' ? PDA_httpPost(o.url, o.headers || {}, o.data == null ? '' : o.data) : PDA_httpGet(o.url, o.headers || {}); } catch (e) { call = Promise.reject(e); }
    Promise.resolve(call).then((r) => end(o.onload, tidyResp(r, o)), (e) => end(o.onerror, { error: String((e && e.message) || e || 'Request failed') }));
    return { abort() { end(o.onabort); } };
  }
  const canXhr = () => !!gmXhr || pdaFns();
  const rawXhr = (o) => {
    const plain = /^(GET|POST)$/i.test(o.method || 'GET') && !/^(arraybuffer|blob|stream)$/i.test(o.responseType || '');
    if (IS_PDA && plain && pdaFns()) return pdaXhr(o);
    if (gmXhr) return IS_PDA ? gmXhr(Object.assign({}, o, { onload: (r) => o.onload && o.onload(tidyResp(r, o)) })) : gmXhr(o);
    if (plain && pdaFns()) return pdaXhr(o);
    setTimeout(() => o.onerror && o.onerror({ error: 'No userscript manager request function' }), 0);
    return { abort() {} };
  };
  const rawStyle = (css) => { try { if (typeof GM_addStyle === 'function') return GM_addStyle(css); } catch (e) {} const s = document.createElement('style'); s.textContent = css; (document.head || document.documentElement).appendChild(s); return s; };
  const rawMenu = (name, fn) => { try { if (typeof GM_registerMenuCommand === 'function') return GM_registerMenuCommand(name, fn); } catch (e) {} return null; };
  const rawNotify = (o) => { try { if (!IS_PDA && typeof GM_notification === 'function') return GM_notification(o); } catch (e) {} return null; };
  const pageWin = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now();

  /* ---------- settings ---------- */
  const UPDATE_URL = 'https://raw.githubusercontent.com/Eaglewing91/TUCC/main/TUCC.user.js';
  const cfg = Object.assign({ enabled: {}, budget: 60, key: '', panelOpen: false, shareSecs: 15 }, rawGet(CORE + 'settings', {}) || {});
  cfg.alerts = Object.assign({ desktop: true, sound: true, mute: {} }, cfg.alerts || {});
  cfg.update = Object.assign({ on: true, url: UPDATE_URL }, cfg.update || {});
  if (cfg.launcher === undefined) cfg.launcher = true;   // hide the scripts' own floating buttons (open them from the TUCC page)
  // TUCC has its own page, opened from its row in Torn's Areas list (one click = one normal page load).
  const TUCC_URL = '/index.php?tucc=1';
  const ON_TUCC_PAGE = /^\/(index\.php)?$/.test(location.pathname) && new URLSearchParams(location.search).has('tucc');
  if (cfg.theme === undefined) cfg.theme = true;         // one theme: TUCC colours and type on every module

  /* =====================================================================
   * One theme. Each original script runs unchanged; TUCC adds a stylesheet that
   * restyles its panels by their own element names. Scripts that draw inside a
   * shadow root get the stylesheet inside that root (TUCC notes the roots its own
   * modules create; it never changes them otherwise). Switch off in Settings.
   * ===================================================================== */
  const THEME = /*__THEME__*/{ page: '', shadow: {}, layout: '' }/*__END_THEME__*/;
  // One theme, dark with red accents. Every text colour below passes WCAG AA (4.5:1) on every surface colour;
  // red fills take white text (5.7:1). Minimum text size across all modules: 12px.
  // Colour themes: only the accent changes. Status colours (green good, amber warning, rose bad, blue info) never change,
  // so their meaning stays the same in every theme. Each accent passes 4.5:1 on every surface; white on each fill passes too.
  const PALETTES = {
    red:      { name: 'Red',      accent: '#f87171', fill: '#c81e1e', hover: '#b91c1c' },
    blue:     { name: 'Blue',     accent: '#60a5fa', fill: '#1d4ed8', hover: '#1e40af' },
    purple:   { name: 'Purple',   accent: '#c084fc', fill: '#7e22ce', hover: '#6b21a8' },
    teal:     { name: 'Teal',     accent: '#2dd4bf', fill: '#0f766e', hover: '#115e59' },
    graphite: { name: 'Graphite', accent: '#e4e4e7', fill: '#52525b', hover: '#3f3f46' },
  };
  const palette = () => PALETTES[cfg.palette] || PALETTES.red;
  function paletteVars() {
    const p = palette();
    return `--tucc-accent:${p.accent};--tucc-accent-soft:color-mix(in srgb,${p.accent} 14%,transparent);--tucc-accent-fill:${p.fill};--tucc-accent-fill-hover:${p.hover};--tucc-accent-ink:#ffffff;`;
  }
  const TOKENS = () => `:root[data-tucc-theme="on"],#tucc,#tucc-page,#tucc-tablet,.tucc-win{--tucc-bg:#111113;--tucc-s1:#18181b;--tucc-s2:#202024;--tucc-s3:#2a2a30;--tucc-line:#3a3a42;--tucc-line2:#52525b;
    --tucc-text:#f4f4f5;--tucc-muted:#c9c9d1;--tucc-dim:#a1a1aa;
    ${paletteVars()}
    --tucc-good:#4ade80;--tucc-good-soft:rgba(74,222,128,.14);--tucc-bad:#fda4af;--tucc-bad-soft:rgba(253,164,175,.14);--tucc-warn:#fbbf24;--tucc-warn-soft:rgba(251,191,36,.14);--tucc-info:#93c5fd;--tucc-info-soft:rgba(147,197,253,.14);
    --tucc-font:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;--tucc-mono:ui-monospace,"SF Mono",Consolas,monospace;--tucc-fs:13.5px;--tucc-fs-sm:12px;
    --tucc-r:12px;--tucc-r2:8px;--tucc-shadow:0 24px 60px rgba(0,0,0,.6)}`;
  const shadowHosts = new Map();                       // host element -> its shadow root (TUCC modules' hosts only)
  const THEMED_HOSTS = () => Object.keys(THEME.shadow || {});
  try {
    const realAttach = Element.prototype.attachShadow;
    if (realAttach && !realAttach.__tucc) {
      const wrapped = function (init) {
        const r = realAttach.call(this, init);
        try { if (this.id && (THEMED_HOSTS().includes(this.id) || LAUNCH_HOSTS.has(this.id))) { shadowHosts.set(this, r); themeShadow(this, r); } } catch (e) {}
        return r;
      };
      wrapped.__tucc = true;
      Element.prototype.attachShadow = wrapped;
    }
  } catch (e) {}
  const LAUNCH_HOSTS = new Set();
  function themeShadow(host, root) {
    const css = (THEME.shadow || {})[host.id];
    let st = root.querySelector && root.querySelector('style.tucc-theme');
    const want = (cfg.theme && css ? css : '') + (cfg.launcher ? (LAUNCH_HIDE_SHADOW[host.id] || '') : '') + (EMBED_SHADOW[host.id] || '');
    if (!want) { if (st) st.remove(); return; }
    if (!st) { st = document.createElement('style'); st.className = 'tucc-theme'; }
    st.textContent = want;
    root.appendChild(st);                                  // last in the root, so it wins over the script's own styles
  }
  const LAUNCH_HIDE_SHADOW = {};
  // Modules that can open inside the TUCC tablet: their panel is placed over the tablet's screen while embedded,
  // and kept under the tablet when the tablet is open but the module wasn't opened from it.
  const EMBED_SHADOW = {};                           // host id -> css that hides that script's own floating button
  let launchHidePage = '';
  function applyTheme() {
    document.documentElement.dataset.tuccTheme = cfg.theme ? 'on' : 'off';
    let st = document.getElementById('tucc-theme-style');
    if (!st) { st = document.createElement('style'); st.id = 'tucc-theme-style'; }
    st.textContent = TOKENS() + (THEME.layout || '') + (cfg.theme ? THEME.page || '' : '') + (cfg.launcher ? launchHidePage : '');
    (document.head || document.documentElement).appendChild(st);   // re-appended so it stays after scripts' own styles
    shadowHosts.forEach((root, host) => themeShadow(host, root));
  }
  const saveCfg = () => rawSet(CORE + 'settings', cfg);
  const isEnabled = (m) => cfg.enabled[m.id] !== undefined ? !!cfg.enabled[m.id] : m.defaultOn !== false;

  /* ---------- page matching ---------- */
  const toRe = (pattern) => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const matches = (m) => m.matches.some((p) => toRe(p).test(location.href));

  /* =====================================================================
   * Torn API engine
   * ===================================================================== */
  const PAUSE_FOR = { 5: 60, 8: 600, 9: 600, 14: 900 };  // error code -> seconds, shared by all modules and tabs (14 = daily read limit)
  const LOG = CORE + 'api_log', PAUSE = CORE + 'api_pause';
  const tabStats = {};                                   // module id -> [timestamps] (this tab)
  const budget = () => Math.max(10, Math.min(95, Number(cfg.budget) || 60));
  function recentCalls() {
    const log = (rawGet(LOG, []) || []).filter((t) => now() - t < 60000);
    return log;
  }
  function takeSlot() {
    const log = recentCalls();
    if (log.length >= budget()) return Math.max(250, 60000 - (now() - log[0]) + 50);   // ms to wait
    log.push(now()); rawSet(LOG, log); return 0;
  }
  function pauseInfo() { const p = rawGet(PAUSE, null); return p && p.until > now() ? p : null; }
  const fake = (o, body) => setTimeout(() => { try { o.onload && o.onload({ status: 200, statusText: 'OK', responseText: JSON.stringify(body), response: body, readyState: 4, finalUrl: o.url }); } catch (e) {} }, 0);

  /* ---------- shared responses ----------
   * A GET that another module or tab made moments ago (same address, same key) is
   * answered from that response instead of calling Torn again. Logs, events,
   * messages and key checks are never shared. Stored in the userscript manager so
   * every tab can use it; big responses stay in this tab only. */
  const CACHE = CORE + 'cache';
  const NO_SHARE = /\/(log|events|newevents|messages|newmessages|notifications|key|attacks|attacksfull|timestamp|revives|revivesfull)(\/|$)/i;
  const NO_SHARE_SEL = /(^|,)(log|events|newevents|messages|newmessages|notifications|attacks|attacksfull|timestamp|revives|revivesfull|info)(,|$)/i;
  const LONG_SHARE = [[/\/v2\/torn\/(items|crimes|education|itemmods|logtypes|logcategories|itemammo)\b/, 3600], [/^\/torn\/?$/, 300]];
  const memCache = new Map(), inflight = new Map();
  // A module asking again for the same thing in the same tab wants it fresh (for example a live
  // status check), so it is never answered from its own earlier response; only other modules and other tabs share.
  const TAB_ID = Math.random().toString(36).slice(2, 10);
  const sameAsk = (e, modId) => e && e.tab === TAB_ID && (e.mods || []).includes(modId);
  let cacheHits = 0;
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  function shareSecsFor(u, o) {
    if (o.nocache || (o.method && o.method.toUpperCase() !== 'GET') || o.data) return 0;
    const base = Math.max(0, Math.min(120, Number(cfg.shareSecs)));
    if (!base || NO_SHARE.test(u.pathname) || NO_SHARE_SEL.test(u.searchParams.get('selections') || '')) return 0;
    if (o.ttl != null) return Math.max(0, Number(o.ttl) || 0);
    for (const [re, secs] of LONG_SHARE) if (re.test(u.pathname)) return /^\/torn\/?$/.test(u.pathname) && !/gyms|stocks/.test(u.searchParams.get('selections') || '') ? base : secs;
    return base;
  }
  function cacheKey(u, key) {
    const q = [...u.searchParams.entries()].filter(([k]) => !['key', 'comment', 'timestamp', '_'].includes(k)).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
    return u.pathname + '?' + q.map(([k, v]) => k + '=' + v).join('&') + '#' + hash(key || '');
  }
  function cacheGet(k, modId) {
    const m = memCache.get(k);
    if (m && m.until > now() && !sameAsk(m, modId)) return m.text;
    const all = rawGet(CACHE, null) || {};
    const e = all[k];
    return e && e.until > now() && !sameAsk(e, modId) ? e.text : null;
  }
  // Storage limits for what other tabs can reuse. Tampermonkey hands a script's whole storage to every
  // page before it runs, and rewrites it on every save, so shared answers must stay small: bigger
  // answers are kept in this tab's memory only.
  const SHARE_MAX_ENTRY = 30000, SHARE_MAX_TOTAL = 250000;
  const newest = (v) => (Array.isArray(v) ? Math.max(0, ...v.map((x) => x.at || 0)) : v.until || 0);
  const trimShared = (all, size) => {                                  // keeps the newest entries within the total
    let total = 0;
    Object.keys(all).filter((x) => all[x]).sort((a, b) => newest(all[b]) - newest(all[a]))
      .forEach((x) => { total += size(all[x]); if (total > SHARE_MAX_TOTAL) delete all[x]; });
    return all;
  };
  function cachePut(k, text, secs, modIds) {
    const until = now() + secs * 1000, mods = modIds || [], tab = TAB_ID;
    memCache.set(k, { until, text, mods, tab });
    if (memCache.size > 150) memCache.delete(memCache.keys().next().value);
    if (text.length > SHARE_MAX_ENTRY) return;                          // bigger answers stay in this tab only
    const all = rawGet(CACHE, null) || {};
    for (const x of Object.keys(all)) if (!all[x] || all[x].until < now() || (all[x].text || '').length > SHARE_MAX_ENTRY) delete all[x];
    all[k] = { until, text, mods, tab };
    const ks = Object.keys(all);
    if (ks.length > 80) ks.sort((a, b) => all[a].until - all[b].until).slice(0, ks.length - 80).forEach((x) => delete all[x]);
    rawSet(CACHE, trimShared(all, (e) => (e.text || '').length));
  }

  /* ---------- one shared feed per resource ----------
   * TUCC is one script, so modules share Torn API data instead of each asking for it:
   *  - Requests for the same resource (your user data, the torn data, your faction) made within
   *    a moment of each other are sent as ONE call with all their selections combined.
   *  - Each call also asks for the selections other modules have needed recently, so their next
   *    request is answered from it without another call.
   *  - A request is answered from a recent combined response that covers all its selections:
   *    fast-changing data (bars, cooldowns, travel) for the shared time in Settings, slower data
   *    (profile, stats, perks, education...) for up to a minute.
   * Logs, events, messages and anything with extra parameters are never combined. If Torn refuses
   * a combined call (for example a selection your key can't read), the module's own call is sent alone. */
  const MERGE_RES = /^(user|torn|faction|company|market)$/;
  const FAST_SEL = /^(bars|cooldowns|refills|travel|icons|chain|notifications|bazaar|itemmarket|organizedcrime|stocks)$/;
  const SLOW_SECS = 60, BATCH_MS = 120, INTEREST_MS = 10 * 60000;
  const feedMem = new Map(), interest = new Map(), refused = new Map(), batches = new Map();
  const FEED = CORE + 'feed';
  let feedCalls = 0, feedSaved = 0;
  // Clean up shared answers saved by versions before 0.12.5, which kept up to megabytes here.
  try {
    const big = (k) => { const v = rawGet(k, null); return v && JSON.stringify(v).length > SHARE_MAX_TOTAL; };
    if (big(CACHE)) rawSet(CACHE, {});
    if (big(FEED)) rawSet(FEED, {});
  } catch (e) { /* storage unavailable: nothing to clean */ }
  function feedReq(u, o, keyUsed) {
    if (o.nocache || (o.method && o.method.toUpperCase() !== 'GET') || o.data || o.ttl != null) return null;
    if (!(Number(cfg.shareSecs) > 0) || cfg.feed === false) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const v2 = parts[0] === 'v2'; if (v2) parts.shift();
    const res = parts[0] || '';
    if (!MERGE_RES.test(res)) return null;
    let id = '', i = 1;
    if (parts[1] && /^\d+$/.test(parts[1])) { id = parts[1]; i = 2; }
    const tail = parts.slice(i);
    for (const k of u.searchParams.keys()) if (!['key', 'comment', 'selections', 'timestamp', '_'].includes(k)) return null;   // extra parameters: not combined
    let sels = (u.searchParams.get('selections') || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (v2) { if (tail.length > 1) return null; if (tail.length === 1) { if (sels.length) return null; sels = [tail[0]]; } }
    else if (tail.length) return null;
    if (!sels.length || sels.some((x) => NO_SHARE_SEL.test(x) || NO_SHARE.test('/' + x))) return null;
    if (v2 && res === 'torn' && LONG_SHARE.some(([re]) => re.test(u.pathname))) return null;   // static v2 lists keep their own long cache
    return { v2, res, id, sels, base: (v2 ? 'v2/' : 'v1/') + res + '/' + id + '#' + hash(keyUsed || '') };
  }
  const TORN_SECS = 600;                                         // game data (items, gyms, honours...) barely changes
  const selSecs = (s, r) => (r && r.id && r.res === 'user' ? Math.max(5, Math.min(120, Number(cfg.shareSecs) || 15)) : r && r.res === 'torn' ? (/^(stocks|pointsmarket|bazaar|itemmarket|timestamp)$/.test(s) ? SLOW_SECS : TORN_SECS)
    : FAST_SEL.test(s) ? Math.max(5, Math.min(120, Number(cfg.shareSecs) || 15)) : SLOW_SECS);
  function feedLookup(r, modId) {
    const need = Math.min(...r.sels.map((x) => selSecs(x, r))) * 1000;
    const lists = [feedMem.get(r.base) || []].concat([((rawGet(FEED, null) || {})[r.base]) || []]);
    for (const list of lists) for (const e of list) if (now() - e.at <= need && r.sels.every((x) => e.sels.includes(x)) && !sameAsk(e, modId)) return e.text;
    return null;
  }
  function feedStore(base, sels, text, modIds) {
    const e = { at: now(), sels, text, mods: modIds || [], tab: TAB_ID };
    const keep = (list) => [e].concat((list || []).filter((x) => now() - x.at < TORN_SECS * 1000 && !x.sels.every((y) => sels.includes(y)))).slice(0, 4);
    feedMem.set(base, keep(feedMem.get(base)));
    if (text.length > SHARE_MAX_ENTRY) return;                          // bigger answers stay in this tab only
    const all = rawGet(FEED, null) || {};
    for (const k of Object.keys(all)) { all[k] = (all[k] || []).filter((x) => now() - x.at < TORN_SECS * 1000 && (x.text || '').length <= SHARE_MAX_ENTRY); if (!all[k].length) delete all[k]; }
    all[base] = keep(all[base]);
    rawSet(FEED, trimShared(all, (list) => list.reduce((n, x) => n + (x.text || '').length, 0)));
  }
  function feedUrl(r, sels, orig) {
    const u = new URL(orig.toString());
    u.pathname = (r.v2 ? '/v2/' : '/') + r.res + (r.id ? '/' + r.id : (r.v2 ? '' : '/'));
    u.searchParams.set('selections', sels.join(','));
    u.searchParams.set('comment', 'TUCC-shared');
    return u.toString();
  }
  function apiRequest(mod, o) {
    let u, r = null;
    try { u = new URL(o.url, location.href); } catch (e) { u = null; }
    if (u && u.hostname === 'api.torn.com' && canXhr()) {
      const authH = Object.keys(o.headers || {}).find((h) => h.toLowerCase() === 'authorization');
      const keyUsed = u.searchParams.get('key') || (authH ? String(o.headers[authH]).replace(/^ApiKey\s+/i, '') : '');
      r = feedReq(u, o, keyUsed);
    }
    if (!r) return sendApi(mod, o);
    const im = interest.get(r.base) || {}; r.sels.forEach((x) => { im[x] = now(); }); interest.set(r.base, im);
    const hit = feedLookup(r, mod.id);
    if (hit != null) { feedSaved++; cacheHits++; setTimeout(() => { try { o.onload && o.onload({ status: 200, statusText: 'OK', responseText: hit, response: hit, readyState: 4, finalUrl: o.url }); } catch (e) {} }, 0); return { abort() {} }; }
    // Join (or open) a short batch for this resource, then send one combined call.
    let b = batches.get(r.base);
    const w = { o, mod, dead: false };
    if (b && !b.sent) { r.sels.forEach((x) => b.sels.add(x)); b.waiters.push(w); return { abort() { w.dead = true; } }; }
    if (b && b.sent && r.sels.every((x) => b.all.includes(x))) { feedSaved++; cacheHits++; b.waiters.push(w); return { abort() { w.dead = true; } }; }
    b = { r, u, mod, sels: new Set(r.sels), waiters: [w], sent: false, all: [] };
    batches.set(r.base, b);
    setTimeout(() => {
      b.sent = true;
      const no = refused.get(r.base) || {};
      const extra = Object.keys(interest.get(r.base) || {}).filter((x) => now() - interest.get(r.base)[x] < INTEREST_MS && !b.sels.has(x) && !(no[x] > now()));
      const own = [...b.sels], all = own.concat(extra).slice(0, 24);
      b.all = all;
      const finish = (resp, ok) => {
        if (batches.get(r.base) === b) batches.delete(r.base);
        if (ok) feedStore(r.base, all, resp.responseText, b.waiters.map((x) => (x.mod || mod).id));
        if (b.waiters.length > 1) feedSaved += b.waiters.length - 1;
        b.waiters.forEach((x) => { if (!x.dead) try { x.o.onload && x.o.onload(resp); } catch (e) {} });
      };
      const fail = (kind, e) => { if (batches.get(r.base) === b) batches.delete(r.base); b.waiters.forEach((x) => { if (!x.dead) try { const f = x.o[kind] || x.o.onerror; f && f(e); } catch (er) {} }); };
      // Each waiter's own request, sent exactly as the module wrote it (used alone, or as the fallback).
      const sendOriginals = () => {
        if (batches.get(r.base) === b) batches.delete(r.base);
        b.waiters.forEach((x) => { if (x.dead) return; const xo = x.o;
          sendApi(x.mod || mod, Object.assign({}, xo, { onload: (resp) => { let code = 0; try { const j = JSON.parse(resp.responseText); code = j && j.error ? Number(j.error.code) : 0; } catch (e) {}
            if (!code && (resp.status || 200) < 400) { const rr = feedReq(new URL(xo.url, location.href), xo, keyOf(xo)); if (rr) feedStore(rr.base, rr.sels, resp.responseText, [(x.mod || mod).id]); }
            xo.onload && xo.onload(resp); } })); });
      };
      const keyOf = (xo) => { try { const uu = new URL(xo.url, location.href); const h = Object.keys(xo.headers || {}).find((k) => k.toLowerCase() === 'authorization'); return uu.searchParams.get('key') || (h ? String(xo.headers[h]).replace(/^ApiKey\s+/i, '') : ''); } catch (e) { return ''; } };
      if (all.length === own.length && b.waiters.length === 1) { b.all = own; return sendOriginals(); }
      const sendSels = (sels) => {
        sendApi(Object.assign({}, SHARED_MOD, { name: 'Shared feed (' + [...new Set(b.waiters.map((x) => (x.mod || mod).name))].join(', ') + ')' }),
          Object.assign({}, o, { url: feedUrl(r, sels, u), nocache: true, onabort: null,
          onload: (resp) => {
            let code = 0; try { const j = JSON.parse(resp.responseText); code = j && j.error ? Number(j.error.code) : 0; } catch (e) {}
            if (code && !PAUSE_FOR[code]) {
              // Torn refused the combined call (a selection your key can't read, or one that doesn't combine).
              // Stop adding the extras for an hour, and send the modules' own requests as they wrote them.
              if (sels.length > own.length) { const nb = refused.get(r.base) || {}; sels.filter((x) => !own.includes(x)).forEach((x) => { nb[x] = now() + 3600000; }); refused.set(r.base, nb); }
              return sendOriginals();
            }
            finish(resp, !code && (resp.status || 200) < 400);
          },
          onerror: (e) => fail('onerror', e), ontimeout: (e) => fail('ontimeout', e) }));
      };
      feedCalls++;
      sendSels(all);
    }, BATCH_MS);
    return { abort() { w.dead = true; } };
  }
  const SHARED_MOD = { id: 'shared', name: 'Shared feed (several modules)' };

  function sendApi(mod, o) {
    let u;
    try { u = new URL(o.url, location.href); } catch (e) { u = null; }
    const isTornApi = u && u.hostname === 'api.torn.com';
    if (!canXhr()) { setTimeout(() => o.onerror && o.onerror({ error: 'No userscript manager request function' }), 0); return { abort() {} }; }
    // Rule guard: no module may request torn.com pages or data outside the API. Such a request is refused here.
    if (u && /(^|\.)torn\.com$/i.test(u.hostname) && !isTornApi) {
      console.warn('[TUCC] blocked a non-API request to torn.com from ' + mod.name + ': ' + u.pathname);
      setTimeout(() => o.onerror && o.onerror({ error: 'TUCC blocks non-API requests to torn.com' }), 0); return { abort() {} };
    }
    if (!isTornApi) return rawXhr(o);                     // outside services: passed straight through (declared in @connect)

    // Shared responses: answer from a recent identical call, or wait for one already on its way.
    const authH = Object.keys(o.headers || {}).find((h) => h.toLowerCase() === 'authorization');
    const keyUsed = u.searchParams.get('key') || (authH ? String(o.headers[authH]).replace(/^ApiKey\s+/i, '') : '');
    const share = shareSecsFor(u, o);
    const ck = share ? cacheKey(u, keyUsed) : null;
    if (ck) {
      const hit = cacheGet(ck, mod.id);
      if (hit != null) { cacheHits++; setTimeout(() => { try { o.onload && o.onload({ status: 200, statusText: 'OK', responseText: hit, response: hit, readyState: 4, finalUrl: o.url }); } catch (e) {} }, 0); return { abort() {} }; }
      if (inflight.has(ck)) { cacheHits++; const w = { o, dead: false }; inflight.get(ck).push(w); return { abort() { w.dead = true; } }; }
      inflight.set(ck, []);
    }
    const settleWaiters = (fn) => { if (!ck) return; const ws = inflight.get(ck) || []; inflight.delete(ck); ws.forEach((w) => { if (!w.dead) try { fn(w.o); } catch (e) {} }); };

    const p = pauseInfo();
    if (p) { fake(o, { error: { code: p.code, error: `TUCC paused Torn API calls for ${Math.ceil((p.until - now()) / 1000)}s after: ${p.why}` } }); return { abort() {} }; }

    // Key goes in a header on API v2, never in the address. Every call is tagged with the module's name.
    const headers = Object.assign({}, o.headers || {});
    if (u.pathname.startsWith('/v2/') && u.searchParams.has('key')) {
      const k = u.searchParams.get('key'); u.searchParams.delete('key');
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'authorization')) headers.Authorization = 'ApiKey ' + k;
    }
    if (!u.searchParams.has('comment')) u.searchParams.set('comment', 'TUCC-' + mod.id);
    const req = Object.assign({}, o, { url: u.toString(), headers });
    req.onload = (r) => {
      let ok = false;
      // Torn (or the network in front of it) says slow down or is unavailable: every module and tab waits.
      const hs = Number(r && r.status) || 0;
      if (hs === 429 || hs === 502 || hs === 503 || hs === 504) {
        const ra = /retry-after:\s*(\d+)/i.exec(String((r && r.responseHeaders) || ''));
        const secs = Math.max(hs === 429 ? 60 : 30, Math.min(300, ra ? Number(ra[1]) : 0));
        rawSet(PAUSE, { until: now() + secs * 1000, code: hs === 429 ? 5 : 9, why: `${mod.name}: HTTP ${hs} (${hs === 429 ? 'too many requests' : 'Torn API unavailable'})` });
      }
      try {
        const j = JSON.parse(r.responseText);
        const code = j && j.error && Number(j.error.code);
        if (PAUSE_FOR[code]) rawSet(PAUSE, { until: now() + PAUSE_FOR[code] * 1000, code, why: `${mod.name}: Torn API error ${code} (${j.error.error})` });
        ok = !code && (r.status || 200) < 400;
      } catch (e) {}
      if (ck && ok) cachePut(ck, r.responseText, share, [mod.id]);
      o.onload && o.onload(r);
      settleWaiters((w) => w.onload && w.onload(r));
    };
    req.onerror = (e) => { o.onerror && o.onerror(e); settleWaiters((w) => w.onerror && w.onerror(e)); };
    req.ontimeout = (e) => { o.ontimeout && o.ontimeout(e); settleWaiters((w) => (w.ontimeout || w.onerror) && (w.ontimeout || w.onerror)(e)); };

    let aborted = false, handle = null;
    const send = () => {
      if (aborted) return;
      const wait = takeSlot();
      if (wait) { setTimeout(send, wait); return; }
      (tabStats[mod.id] = tabStats[mod.id] || []).push(now());
      handle = rawXhr(req);
    };
    send();
    return { abort() { aborted = true; settleWaiters((w) => w.onabort && w.onabort()); try { handle && handle.abort && handle.abort(); } catch (e) {} } };
  }

  /* =====================================================================
   * Alerts centre: every module's notifications in one list, shared by all tabs.
   * Per-module mute, one desktop-notification switch, one sound switch.
   * ===================================================================== */
  const ALERTS = CORE + 'alerts', SEEN = CORE + 'alerts_seen';
  const CORE_MOD = { id: 'tucc', name: 'TUCC', short: 'TUCC' };
  let audioCtx = null;
  function beep(level) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = level === 'urgent' ? 880 : 660; g.gain.value = 0.06;
      o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + (level === 'urgent' ? 0.35 : 0.18));
    } catch (e) {}
  }
  const alertList = () => (rawGet(ALERTS, []) || []).filter((a) => a && now() - a.at < 3 * 86400000);
  function unread() { const seen = Number(rawGet(SEEN, 0)) || 0; return alertList().filter((a) => a.at > seen && !cfg.alerts.mute[a.mod]).length; }
  function addAlert(mod, a, onclick) {
    a = a || {};
    const list = alertList();
    const id = mod.id + ':' + (a.id || hash(String(a.title || '') + '|' + String(a.text || '')));
    const again = Math.max(30, Number(a.repeatAfter) || 600) * 1000;
    if (list.some((x) => x.id === id && now() - x.at < again)) return false;     // same alert from another tab or a repeat: once
    const level = ['info', 'warn', 'urgent'].includes(a.level) ? a.level : 'info';
    const item = { id, mod: mod.id, modName: mod.short || mod.name, title: String(a.title || mod.name).slice(0, 120), text: String(a.text || '').slice(0, 400), level, url: /^https:\/\/www\.torn\.com\//.test(a.url || '') ? a.url : '', at: now() };
    list.unshift(item); rawSet(ALERTS, list.slice(0, 60));
    if (!cfg.alerts.mute[mod.id]) {
      if (cfg.alerts.desktop) rawNotify({ title: `${item.modName}: ${item.title}`, text: item.text || item.title, timeout: 20000, onclick: () => { try { window.focus(); } catch (e) {} if (onclick) { try { onclick(); } catch (e) {} } else if (item.url) location.href = item.url; } });
      if (cfg.alerts.sound && level !== 'info') beep(level);
    }
    updateBadge(); renderSoon();
    return true;
  }
  function updateBadge() {
    const n = unread();
    document.querySelectorAll('.tucc-nav-badge').forEach((b) => { b.textContent = n ? (n > 9 ? '9+' : String(n)) : ''; b.title = n ? `${n} new TUCC alert${n > 1 ? 's' : ''}` : ''; });
  }

  /* =====================================================================
   * Update checker: reads the "@version" line of the published TUCC file
   * (a plain GET that sends nothing about you), at most twice a day.
   * Installing is always your own click.
   * ===================================================================== */
  const UPD = CORE + 'update';
  // The update address must be https and never torn.com (the check is a timed request, so it may only go to the published file).
  const updateUrlOk = (x) => { try { const u = new URL(x); return u.protocol === 'https:' && !/(^|\.)torn\.com$/i.test(u.hostname); } catch (e) { return false; } };
  const newer = (a, b) => { const x = String(a).split(/[.-]/).map(Number), y = String(b).split(/[.-]/).map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const p = x[i] || 0, q = y[i] || 0; if (isNaN(p) || isNaN(q)) return false; if (p !== q) return p > q; } return false; };
  function checkUpdate(force) {
    const u = rawGet(UPD, {}) || {};
    if (!force && (!cfg.update.on || now() - (u.checked || 0) < 12 * 3600000)) return;
    if (!canXhr() || !updateUrlOk(cfg.update.url)) return;
    rawSet(UPD, Object.assign({}, u, { checked: now() }));
    rawXhr({
      method: 'GET', url: cfg.update.url, timeout: 20000, headers: { 'Cache-Control': 'no-cache' },
      onload: (r) => {
        const m = /\/\/\s*@version\s+(\S+)/.exec(String(r.responseText || '').slice(0, 4000));
        const res = { checked: now(), latest: m ? m[1] : '', error: (r.status || 200) >= 400 ? `HTTP ${r.status}` : (m ? '' : 'No version line found') };
        rawSet(UPD, res);
        if (res.latest && newer(res.latest, VERSION)) addAlert(CORE_MOD, { id: 'update-' + res.latest, title: `Update available: v${res.latest}`, text: `You have v${VERSION}. Open TUCC from the Areas list, Settings, to install.`, level: 'info', repeatAfter: 7 * 86400 });
        renderSoon();
      },
      onerror: () => { rawSet(UPD, { checked: now(), latest: '', error: 'Could not reach the update address' }); renderSoon(); },
      ontimeout: () => { rawSet(UPD, { checked: now(), latest: '', error: 'Timed out' }); renderSoon(); },
    });
  }

  /* =====================================================================
   * Per-module sandbox: prefixed storage + wrapped GM functions
   * ===================================================================== */
  /* ---------- no browser pop-ups ----------
   * Modules get these in place of the browser's alert / confirm / prompt (which block the page, and in Torn PDA
   * every script). confirm = "press again": the first press shows a short note and does nothing; pressing the same
   * control again within 8 seconds goes ahead. Nothing here makes a request. */
  let toastEl = null, toastT = 0;
  function toast(text, ms) {
    if (!document.body) return;
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'tucc-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); }
    if (!toastEl.isConnected) document.body.appendChild(toastEl);
    toastEl.textContent = text; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), ms || 6000);
  }
  const short = (m) => { const t = String(m == null ? '' : m).split('\n')[0].trim(); return t.length > 150 ? t.slice(0, 147) + '…' : t; };
  let lastPress = { el: null, t: 0 };
  document.addEventListener('click', (e) => { if (e.isTrusted) lastPress = { el: (e.composedPath && e.composedPath()[0]) || e.target, t: now() }; }, true);
  const armedEl = new WeakMap(), armedAny = new Map();
  function softConfirm(msg) {
    const el = now() - lastPress.t < 3000 ? lastPress.el : null;
    let map = el ? armedEl.get(el) : armedAny;
    if (!map) { map = new Map(); armedEl.set(el, map); }
    const key = String(msg);
    if ((map.get(key) || 0) > now()) { map.set(key, now() + 8000); return true; }
    map.set(key, now() + 8000);
    toast(short(msg) + ' Press again to confirm.', 8000);
    return false;
  }
  const softAlert = (msg) => { toast(short(msg)); };
  const softPrompt = () => { toast('Enter keys in TUCC: open the tablet and tap API Keys.'); return null; };
  function sandboxFor(mod) {
    const P = mod.id + ':';
    const st = state[mod.id];
    const GM_getValue = (k, d) => { const v = rawGet(P + k, undefined); return v === undefined ? d : v; };
    const GM_setValue = (k, v) => rawSet(P + k, v);
    const GM_deleteValue = (k) => rawDel(P + k);
    const GM_listValues = () => rawList().filter((k) => k.startsWith(P)).map((k) => k.slice(P.length));
    const GM_xmlhttpRequest = (o) => apiRequest(mod, o);
    const GM_addStyle = (css) => rawStyle(css);
    const GM_registerMenuCommand = (name, fn) => { st.menus.push({ name, fn }); renderSoon(); return rawMenu(`${mod.short}: ${name}`, fn); };
    // Notifications go to the TUCC alerts centre (one list, mute per module) and on to the desktop from there.
    const GM_notification = (o, title, image, onclick) => {
      const opt = typeof o === 'object' && o ? Object.assign({}, o) : { text: String(o), title, image, onclick };
      addAlert(mod, { id: opt.tag, title: opt.title || mod.name, text: opt.text || '', level: 'warn', repeatAfter: 60 }, opt.onclick);
      return null;
    };
    const GM_info = { script: { name: mod.name, version: mod.version, namespace: 'tucc/' + mod.id }, scriptHandler: (typeof window.GM_info !== 'undefined' && window.GM_info.scriptHandler) || 'TUCC', version: VERSION };
    const GM = {
      info: GM_info,
      getValue: async (k, d) => GM_getValue(k, d),
      setValue: async (k, v) => GM_setValue(k, v),
      deleteValue: async (k) => GM_deleteValue(k),
      listValues: async () => GM_listValues(),
      addStyle: async (css) => GM_addStyle(css),
      notification: async (o) => GM_notification(o),
      registerMenuCommand: (n, f) => GM_registerMenuCommand(n, f),
      xmlHttpRequest(o) {
        let h;
        const pr = new Promise((resolve, reject) => {
          h = GM_xmlhttpRequest(Object.assign({}, o, {
            onload: (r) => { try { o.onload && o.onload(r); } finally { resolve(r); } },
            onerror: (e) => { try { o.onerror && o.onerror(e); } finally { reject(e); } },
            ontimeout: (e) => { try { o.ontimeout && o.ontimeout(e); } finally { reject(e); } },
          }));
        });
        pr.abort = () => h && h.abort && h.abort();
        pr.catch(() => {});   // callers that only use callbacks don't get unhandled-rejection noise
        return pr;
      },
    };
    // fetch(): Torn API calls go through the shared engine (budget, pause, header key); everything else is the normal fetch.
    const realFetch = (mod.pageContext ? pageWin : window).fetch.bind(mod.pageContext ? pageWin : window);
    const moduleFetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      let host = ''; try { host = new URL(url, location.href).hostname; } catch (e) {}
      if (/(^|\.)torn\.com$/i.test(host) && host !== 'api.torn.com') return Promise.reject(new TypeError('TUCC blocks non-API requests to torn.com'));
      if (host !== 'api.torn.com' || !canXhr()) return realFetch(input, init);
      init = init || {};
      return new Promise((resolve, reject) => {
        const sig = init.signal;
        if (sig && sig.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        const headers = {};
        try { new Headers(init.headers || (typeof input === 'object' && input.headers) || {}).forEach((v, k) => { headers[k] = v; }); } catch (e) {}
        const h = apiRequest(mod, {
          method: init.method || 'GET', url, headers, data: init.body,
          onload: (r) => resolve(new Response(r.responseText, { status: r.status || 200, headers: { 'content-type': 'application/json' } })),
          onerror: () => reject(new TypeError('Failed to fetch')), ontimeout: () => reject(new TypeError('Failed to fetch')),
        });
        if (sig) sig.addEventListener('abort', () => { try { h.abort(); } catch (e) {} reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
    };
    const win = mod.pageContext ? pageWin : window;
    return [GM_getValue, GM_setValue, GM_deleteValue, GM_listValues, GM_xmlhttpRequest, GM_addStyle, GM_registerMenuCommand, GM_notification, GM, GM_info, pageWin, win, win.XMLHttpRequest, mod.pageContext ? realFetch : moduleFetch, helperFor(mod), softAlert, softConfirm, softPrompt];
  }

  /* =====================================================================
   * Helpers for TUCC's own modules (War Room, Crimes Analyst, ...)
   * ===================================================================== */
  let winStyled = false;
  const WIN_STYLE = `
    .tucc-win{position:fixed;right:14px;top:70px;width:min(460px,calc(100vw - 28px));max-height:calc(100vh - 150px);z-index:2147483005;display:none;flex-direction:column;
      background:var(--tucc-bg) !important;color:var(--tucc-text) !important;border:1px solid var(--tucc-line);border-top:3px solid var(--tucc-accent-fill);border-radius:var(--tucc-r);box-shadow:var(--tucc-shadow);font:var(--tucc-fs)/1.45 var(--tucc-font);overflow:hidden}
    .tucc-win.open{display:flex}
    .tucc-win *{box-sizing:border-box;font-family:inherit}
    .tucc-win div,.tucc-win span,.tucc-win td,.tucc-win label,.tucc-win p,.tucc-win li,.tucc-win b{color:inherit}
    .tucc-win .tw-hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--tucc-s1);border-bottom:1px solid var(--tucc-line);cursor:move;user-select:none}
    .tucc-win .tw-t{font-weight:700;font-size:14.5px;color:var(--tucc-text) !important}
    .tucc-win .tw-s{font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--tucc-accent) !important;margin-left:4px}
    .tucc-win .tw-x{margin-left:auto;background:var(--tucc-s2);border:1px solid var(--tucc-line);color:var(--tucc-text) !important;border-radius:var(--tucc-r2);width:30px;height:30px;font-size:14px;cursor:pointer}
    .tucc-win .tw-x:hover{border-color:var(--tucc-accent)}
    .tucc-win .tw-bd{overflow:auto;padding:12px}
    .tucc-win table{width:100%;border-collapse:collapse;font-size:13px}
    .tucc-win th,.tucc-win td{text-align:left;padding:6px 8px !important;border-bottom:1px solid var(--tucc-line);vertical-align:top}.tucc-win th.n,.tucc-win td.n{text-align:right}
    .tucc-win th{color:var(--tucc-muted) !important;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
    .tucc-win td{color:var(--tucc-text) !important}
    .tucc-win td.n,.tucc-win th.n{text-align:right;font-variant-numeric:tabular-nums}
    .tucc-win a{color:var(--tucc-accent) !important;text-decoration:none}.tucc-win a:hover{text-decoration:underline}
    .tucc-win td a{color:var(--tucc-text) !important;font-weight:600}.tucc-win td a:hover{color:var(--tucc-accent) !important}
    .tucc-win .muted{color:var(--tucc-dim) !important}.tucc-win .good{color:var(--tucc-good) !important}.tucc-win .bad{color:var(--tucc-bad) !important}.tucc-win .warn{color:var(--tucc-warn) !important}
    .tucc-win .card{background:var(--tucc-s2);border:1px solid var(--tucc-line);border-radius:var(--tucc-r2);padding:9px 11px;margin-bottom:8px}
    .tucc-win .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .tucc-win .kpi{flex:1;min-width:90px;background:var(--tucc-s2);border:1px solid var(--tucc-line);border-radius:var(--tucc-r2);padding:7px 9px}
    .tucc-win .kpi b{display:block;font-size:17px;font-variant-numeric:tabular-nums}.tucc-win .kpi span{font-size:12px;color:var(--tucc-muted) !important}
    .tucc-win button.b{background:var(--tucc-s2);color:var(--tucc-text) !important;border:1px solid var(--tucc-line);border-radius:var(--tucc-r2);padding:5px 11px;font-size:12.5px;font-weight:600;cursor:pointer}
    .tucc-win button.b:hover{border-color:var(--tucc-accent)}.tucc-win button.b.pri{background:var(--tucc-accent-fill);border-color:var(--tucc-accent-fill);color:var(--tucc-accent-ink) !important}
    .tucc-win button.b.pri:hover{background:var(--tucc-accent-fill-hover)}
    .tucc-win button:focus-visible,.tucc-win input:focus-visible,.tucc-win select:focus-visible{outline:2px solid var(--tucc-accent);outline-offset:1px}
    .tucc-win input,.tucc-win select{background:var(--tucc-s1) !important;color:var(--tucc-text) !important;border:1px solid var(--tucc-line);border-radius:var(--tucc-r2);padding:5px 7px;font-size:13px}
    .tucc-win input[type=checkbox],.tucc-win input[type=radio],.tucc-win input[type=range]{accent-color:var(--tucc-accent-fill)}
    .tucc-win .pill{display:inline-block;font-size:12px;font-weight:700;padding:1px 8px;border-radius:999px;background:var(--tucc-s3);color:var(--tucc-muted) !important}
    .tucc-win .pill.ok{background:var(--tucc-good-soft);color:var(--tucc-good) !important}.tucc-win .pill.hosp{background:var(--tucc-bad-soft);color:var(--tucc-bad) !important}
    .tucc-win .pill.trav{background:rgba(147,197,253,.14);color:var(--tucc-info) !important}.tucc-win .pill.jail{background:var(--tucc-warn-soft);color:var(--tucc-warn) !important}
    .tucc-win .bar{height:8px;background:var(--tucc-s3);border-radius:999px;overflow:hidden;margin:4px 0}.tucc-win .bar i{display:block;height:100%;background:var(--tucc-accent-fill)}
    .tucc-win .note{font-size:12.5px;color:var(--tucc-muted) !important;margin:6px 0}
    @media (max-width:640px){.tucc-win{right:0;left:0;top:auto;bottom:0;width:100vw;max-height:80vh;border-radius:var(--tucc-r) var(--tucc-r) 0 0}}
  `;

  // Real user input counter: bumped only by trusted clicks and key presses (a script can't fake isTrusted).
  // A module allowed one page request (see pagePost) may use it once per real input, within 3 seconds.
  let inputSeq = 0, inputAt = 0;
  ['click', 'keydown'].forEach((t) => document.addEventListener(t, (e) => { if (e.isTrusted) { inputSeq++; inputAt = now(); } }, true));
  const pageUsed = {};
  function helperFor(mod) {
    const P = mod.id + ':';
    const key = () => (mod.keyStore ? String(rawGet(P + mod.keyStore, '') || '').replace(/^"(.*)"$/, '$1') : '');
    // One Torn API call through the shared engine. Resolves with the JSON, rejects on Torn errors.
    const api = (path, params, opt) => new Promise((resolve, reject) => {
      opt = opt || {};
      const k = opt.key || key();
      if (!k) { reject(Object.assign(new Error('No API key saved (TUCC panel, API key & ToS)'), { code: 'nokey' })); return; }
      const u = new URL(/^https:/.test(path) ? path : 'https://api.torn.com' + (path.startsWith('/') ? '' : '/') + path);
      if (u.hostname !== 'api.torn.com') { reject(new Error('tucc.api only calls api.torn.com')); return; }   // the key never goes anywhere else
      Object.entries(params || {}).forEach(([a, b]) => { if (b != null && b !== '') u.searchParams.set(a, String(b)); });
      u.searchParams.set('key', k);                       // moved into a header by the engine on v2
      apiRequest(mod, {
        method: 'GET', url: u.toString(), ttl: opt.ttl, nocache: opt.nocache, timeout: 30000,
        onload: (r) => {
          let j; try { j = JSON.parse(r.responseText); } catch (e) { reject(new Error('Unexpected API response')); return; }
          if (j && j.error) { reject(Object.assign(new Error(`Torn API error ${j.error.code}: ${j.error.error}`), { code: j.error.code })); return; }
          resolve(j);
        },
        onerror: () => reject(new Error('Could not reach the Torn API')), ontimeout: () => reject(new Error('Torn API timed out')),
      });
    });
    // A floating window in TUCC's style. Opening and closing is remembered per module.
    const ui = {
      window(id, title, sub) {
        if (!winStyled) { rawStyle(WIN_STYLE); winStyled = true; }
        let el = document.getElementById('tucc-win-' + id);
        if (!el) {
          el = document.createElement('div'); el.id = 'tucc-win-' + id; el.className = 'tucc-win'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', title);
          el.innerHTML = `<div class="tw-hd"><span class="tw-t">${esc(title)}</span><span class="tw-s">${esc(sub || '')}</span><button type="button" class="tw-x" aria-label="Close">✕</button></div><div class="tw-bd"></div>`;
          (document.body || document.documentElement).appendChild(el);
          const pos = rawGet(P + '__winpos_' + id, null);
          if (pos && window.innerWidth > 640) { el.style.left = Math.max(0, Math.min(window.innerWidth - 80, pos.x)) + 'px'; el.style.top = Math.max(0, Math.min(window.innerHeight - 60, pos.y)) + 'px'; el.style.right = 'auto'; }
          const hd = el.querySelector('.tw-hd');
          hd.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button') || window.innerWidth <= 640) return;
            const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
            const mv = (ev) => { el.style.left = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dx)) + 'px'; el.style.top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy)) + 'px'; el.style.right = 'auto'; };
            const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); const rr = el.getBoundingClientRect(); rawSet(P + '__winpos_' + id, { x: Math.round(rr.left), y: Math.round(rr.top) }); };
            document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
          });
        }
        const body = el.querySelector('.tw-bd');
        const w = {
          el, body,
          isOpen: () => el.classList.contains('open'),
          open() { el.classList.add('open'); rawSet(P + '__winopen_' + id, true); w.onopen && w.onopen(); },
          close() { el.classList.remove('open'); rawSet(P + '__winopen_' + id, false); w.onclose && w.onclose(); },
          toggle() { w.isOpen() ? w.close() : w.open(); },
          wasOpen: () => !!rawGet(P + '__winopen_' + id, false),
          set(html) { body.innerHTML = html; },
        };
        el.querySelector('.tw-x').onclick = () => w.close();
        return w;
      },
    };
    // Runs fn now and then every `ms` while this tab is visible (API calls only; shared responses stop tabs doubling up).
    const every = (ms, fn) => {
      let t = null, stopped = false, last = 0;
      const run = () => { if (stopped) return; clearTimeout(t); if (!document.hidden) { last = now(); try { fn(); } catch (e) { console.warn('[TUCC] ' + mod.name, e); } } t = setTimeout(run, ms); };
      const vis = () => { if (!document.hidden && now() - last >= ms) run(); };   // back on the tab: only if a run is due
      document.addEventListener('visibilitychange', vis);
      run();
      return { stop() { stopped = true; clearTimeout(t); t = null; document.removeEventListener('visibilitychange', vis); }, now: () => { stopped = false; run(); } };
    };
    // One request to a Torn page (not the API), only for a module whose build entry allows that exact page and
    // action, only right after a real click or key press, and only once per input. Everything else stays blocked.
    const pagePost = (params) => new Promise((resolve, reject) => {
      const rule = mod.pagePost;
      if (!rule || !params || params.action !== rule.action) { reject(new Error('Not allowed')); return; }
      if (!(inputSeq > (pageUsed[mod.id] || 0)) || now() - inputAt > 3000) { reject(new Error('Needs a click')); return; }
      pageUsed[mod.id] = inputSeq;
      const rfc = (/(?:^|;\s*)rfc_v=([^;]+)/.exec(document.cookie) || [])[1] || '';
      const body = new URLSearchParams(Object.entries(params).map(([a, b]) => [a, String(b)]));
      (tabStats[mod.id] = tabStats[mod.id] || []).push(now());
      window.fetch(rule.path + '?rfcv=' + encodeURIComponent(rfc), { method: 'POST', credentials: 'same-origin', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' } })
        .then((r) => r.text()).then((t) => { try { resolve(JSON.parse(t)); } catch (e) { reject(new Error('Unexpected reply')); } }, () => reject(new Error('Could not reach Torn')));
    });
    return {
      api, key, ui, every, esc, pagePost,
      alert: (a) => addAlert(mod, a),
      fmt: {
        money: (n) => (n == null || isNaN(n) ? '–' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')),
        num: (n, d) => (n == null || isNaN(n) ? '–' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d == null ? 0 : d })),
        short: (n) => { if (n == null || isNaN(n)) return '–'; const a = Math.abs(n); return (a >= 1e9 ? (n / 1e9).toFixed(2) + 'b' : a >= 1e6 ? (n / 1e6).toFixed(2) + 'm' : a >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n))); },
        dur: (s) => { s = Math.max(0, Math.round(s)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`; },
        ago: (ts) => { const s = Math.round(now() / 1000 - ts); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; },
      },
      menu: (name, fn) => { state[mod.id].menus.push({ name, fn }); renderSoon(); return rawMenu(`${mod.short}: ${name}`, fn); },
    };
  }

  /* =====================================================================
   * Loader
   * ===================================================================== */
  function whenTime(runAt, fn) {
    if (runAt === 'start') return fn();
    const go = runAt === 'idle' ? () => setTimeout(fn, 0) : fn;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
    else go();
  }
  // TUCC itself runs once per page, even if it is installed twice.
  const DUPLICATE = !!document.documentElement.dataset.tucc;
  const T_CORE = performance.now() - T_START;                 // the core's own set-up time
  // Saved data left behind by modules that are no longer in TUCC (Stock Ledger, Mugger Manager, Attack Interceptor, Armoury & Vault Tracker, Combat Desk).
  if (!DUPLICATE) setTimeout(() => { try { for (const k of rawList()) if (/^(ledger|mugger|interceptor|armoury|combatdesk):/.test(k)) rawDel(k); } catch (e) {} }, 5000);
  document.documentElement.dataset.tucc = VERSION;
  // You pressed "Go to …" on a module's app screen: when that page loads, open the module's window for you
  // (only draws on the page; the page load was your own click). Used by modules that are a window, not page tools.
  const OPEN_NEXT = CORE + 'open_next';
  function openIfAsked(mod) {
    const want = rawGet(OPEN_NEXT, null);
    if (!want || want.id !== mod.id) return;
    rawDel(OPEN_NEXT);
    if (now() - want.t > 60000 || !mod.autoOpen) return;
    setTimeout(() => { try { const t = launchTarget(mod); if (t) t.run(); } catch (e) {} }, 600);
  }
  function register(meta, body) {
    if (DUPLICATE) return;
    const mod = Object.assign({ short: meta.name, runAt: 'end', matches: ['https://www.torn.com/*'], keyStore: null, keyLevel: 'None', tos: null }, meta);
    modules.push(mod);
    state[mod.id] = { status: 'idle', error: '', menus: [] };
    const L = mod.launch || {};
    if (L.host) { LAUNCH_HOSTS.add(L.host); if (L.hide) LAUNCH_HIDE_SHADOW[L.host] = (LAUNCH_HIDE_SHADOW[L.host] || '') + `${L.hide}{display:none !important}`; }
    else if (L.hide) launchHidePage += `${L.hide}{display:none !important}`;
    if (L.hidePage) launchHidePage += `${L.hidePage}{display:none !important}`;
    if (L.host && L.embed) {
      const P = L.embed.panel;
      EMBED_SHADOW[L.host] = `:host([data-tt-embed]) ${P}{top:var(--tt-y) !important;left:var(--tt-x) !important;right:auto !important;bottom:auto !important;width:var(--tt-w) !important;height:var(--tt-h) !important;max-width:none !important;max-height:none !important;transform:none !important;border:0 !important;border-radius:0 0 16px 16px !important;box-shadow:none !important;z-index:2147483646 !important}
        :host([data-tt-embed]) .scrim{display:none !important}
        :host([data-tt-under]:not([data-tt-embed])) ${P},:host([data-tt-under]:not([data-tt-embed])) .scrim{z-index:2147482000 !important}`;
    }
    if (!isEnabled(mod)) { state[mod.id].status = 'off'; return; }
    if (!matches(mod)) { state[mod.id].status = 'not-here'; return; }
    whenTime(mod.runAt, () => {
      // A module added after you saved your keys starts with no key: give it the key from its slot
      // (Limited, or Full Access/Custom), the same one the API Keys app would have saved for it.
      if (mod.keyStore && !String(rawGet(mod.id + ':' + mod.keyStore, '') || '')) {
        const twin = modules.find((m) => m !== mod && m.keyStore && !!m.separateKey === !!mod.separateKey && rawGet(m.id + ':' + m.keyStore, ''));
        if (twin) rawSet(mod.id + ':' + mod.keyStore, rawGet(twin.id + ':' + twin.keyStore, ''));
      }
      // Values a module starts with inside TUCC (for example: skip a script's own first-run screen, since keys are entered in TUCC).
      for (const k in (mod.seed || {})) if (rawGet(mod.id + ':' + k, undefined) === undefined) rawSet(mod.id + ':' + k, mod.seed[k]);
      const t0 = performance.now();
      try { body.apply(window, sandboxFor(mod)); state[mod.id].status = 'running'; openIfAsked(mod); }
      catch (e) { state[mod.id].status = 'error'; state[mod.id].error = String(e && e.message || e); console.warn('[TUCC] ' + mod.name + ' failed to start:', e); }
      finally { state[mod.id].ms = performance.now() - t0; }
      renderSoon();
    });
  }

  /* =====================================================================
   * TUCC panel: modules, shared key, API usage, ToS
   * ===================================================================== */
  let panel, tab = 'modules', renderTimer = null;
  const renderSoon = () => { if (!panel) return; clearTimeout(renderTimer); renderTimer = setTimeout(render, 50); };
  const STYLE = `
    .tucc-nav-badge{margin-left:auto;margin-right:6px;min-width:18px;padding:0 6px;border-radius:999px;background:var(--tucc-accent-fill,#c81e1e);color:#fff !important;font:700 12px/18px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;text-align:center;align-self:center}
    .tucc-nav-badge:empty{display:none}
    #tucc-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(20px);max-width:min(520px,calc(100vw - 24px));box-sizing:border-box;padding:10px 14px;border-radius:10px;background:#16161a;color:#f4f4f5;border:1px solid var(--tucc-accent-fill,#c81e1e);font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.55);z-index:2147483646;opacity:0;pointer-events:none;transition:opacity .15s,transform .15s}
    #tucc-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
    #tucc-fab{position:fixed;z-index:99990;width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:var(--tucc-accent-fill,#c81e1e);color:#fff;display:none;align-items:center;justify-content:center;padding:0;cursor:pointer;touch-action:none;-webkit-tap-highlight-color:transparent;box-shadow:0 3px 12px rgba(0,0,0,.5);opacity:.92}
    #tucc-fab.show{display:flex}#tucc-fab svg{width:20px;height:20px;fill:#fff;pointer-events:none}
    #tucc-fab .tucc-nav-badge{position:absolute;top:-4px;right:-6px;margin:0;background:#111;border:1px solid rgba(255,255,255,.35);font:700 11px/16px system-ui,sans-serif;min-width:16px;padding:0 4px}
    html.tucc-on-page .content-wrapper > *:not(#tucc-page){display:none !important}
    #tucc-page{padding:10px 0 20px}
    #tucc.inpage{position:static;display:flex;width:100%;max-width:none;max-height:none;right:auto;bottom:auto;z-index:auto;box-shadow:0 8px 24px rgba(0,0,0,.3);border-radius:var(--tucc-r)}
    #tucc.inpage .bd{overflow:visible;padding:16px}
    #tucc.inpage .mods{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
    #tucc.inpage .mods .mod{margin-bottom:0;align-content:start}
    #tucc a.b{display:inline-block;text-decoration:none !important;color:var(--tucc-text) !important}
    #tucc .al{display:grid;grid-template-columns:auto 1fr auto;gap:3px 10px;padding:9px 11px;background:var(--tucc-s2);border:1px solid var(--tucc-line);border-left-width:4px;border-radius:var(--tucc-r2);margin-bottom:6px}
    #tucc .al.info{border-left-color:var(--tucc-info)}#tucc .al.warn{border-left-color:var(--tucc-warn)}#tucc .al.urgent{border-left-color:var(--tucc-accent-fill)}#tucc .al.muted{opacity:.7}
    #tucc .al .m{font-size:12px;font-weight:700;color:var(--tucc-accent) !important}#tucc .al .t{font-weight:700}#tucc .al .w{font-size:12px;color:var(--tucc-dim) !important;white-space:nowrap}
    #tucc .al .tx{grid-column:2 / -1;font-size:13px;color:var(--tucc-muted) !important}
    #tucc input[type=text],#tucc input[type=password],#tucc input[type=number],#tucc select{background:var(--tucc-s1);color:var(--tucc-text);border:1px solid var(--tucc-line);border-radius:var(--tucc-r2);padding:6px 8px;font-size:13.5px}
    #tucc input:focus-visible,#tucc select:focus-visible,#tucc button:focus-visible,#tucc a:focus-visible{outline:2px solid var(--tucc-accent);outline-offset:1px}
    #tucc h4{margin:14px 0 6px;font-size:14px;color:var(--tucc-text) !important}
    #tucc{position:fixed;right:14px;bottom:60px;width:min(560px,calc(100vw - 28px));max-height:calc(100vh - 90px);z-index:2147483647;display:none;flex-direction:column;
      background:var(--tucc-bg);color:var(--tucc-text);border:1px solid var(--tucc-line);border-top:3px solid var(--tucc-accent-fill);border-radius:var(--tucc-r);box-shadow:var(--tucc-shadow);font:14px/1.5 var(--tucc-font);overflow:hidden}
    #tucc.open{display:flex}
    #tucc *{box-sizing:border-box;font-family:inherit}
    #tucc div,#tucc span,#tucc td,#tucc th,#tucc label,#tucc p,#tucc li{color:inherit}
    #tucc .hd{display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--tucc-s1);border-bottom:1px solid var(--tucc-line)}
    #tucc .brand{font-weight:800;font-size:16px;white-space:nowrap;letter-spacing:.02em}
    #tucc .ver{font-size:12px;color:var(--tucc-dim);font-weight:500}
    #tucc .x{margin-left:auto;background:var(--tucc-s2);border:1px solid var(--tucc-line);color:var(--tucc-text);border-radius:var(--tucc-r2);width:30px;height:30px;cursor:pointer}
    #tucc .tt-themes{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin:8px 0 14px}
    #tucc .tt-theme{display:grid;gap:8px;padding:12px;border-radius:var(--tucc-r);background:var(--tucc-s2);border:2px solid var(--tucc-line);color:var(--tucc-text);cursor:pointer;text-align:left;font:inherit}
    #tucc .tt-theme:hover{border-color:var(--tucc-line2)}
    #tucc .tt-theme.on{border-color:var(--tucc-accent)}
    #tucc .tt-theme .sw{height:46px;border-radius:var(--tucc-r2)}
    #tucc .tt-theme .tn{font-weight:700;font-size:14px}
    #tucc .tt-theme .tick{color:var(--tucc-accent)}
    #tucc .tt-theme .pv{display:flex;align-items:center;gap:10px;font-size:12.5px}
    #tucc .tt-theme .pb{color:#fff;padding:3px 9px;border-radius:6px;font-weight:600}
    #tucc .tt-theme .pl{font-weight:600;text-decoration:underline}
    #tucc .tabs{display:flex;gap:2px;padding:0 12px;background:var(--tucc-s1);border-bottom:1px solid var(--tucc-line);overflow-x:auto}
    #tucc .tab{background:none;border:0;border-bottom:3px solid transparent;color:var(--tucc-muted);padding:9px 12px 10px;font-weight:600;cursor:pointer;font-size:13.5px;white-space:nowrap}
    #tucc .tab:hover{color:var(--tucc-text)}
    #tucc .tab.on{color:var(--tucc-text);border-bottom-color:var(--tucc-accent-fill)}
    #tucc .bd{overflow:auto;padding:12px 16px}
    #tucc .mod{display:grid;grid-template-columns:1fr auto;gap:5px 12px;padding:11px 13px;background:var(--tucc-s2);border:1px solid var(--tucc-line);border-radius:var(--tucc-r2);margin-bottom:8px}
    #tucc .mod:hover{border-color:var(--tucc-line2)}
    #tucc .mod .nm{font-weight:700;font-size:14.5px}
    #tucc .mod .ds{grid-column:1 / -1;font-size:13px;color:var(--tucc-muted)}
    #tucc .pill{display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:12px;margin-left:6px;vertical-align:1px}
    #tucc .p-run{background:var(--tucc-good-soft);color:var(--tucc-good)}#tucc .p-here{background:var(--tucc-s3);color:var(--tucc-muted)}#tucc .p-off{background:var(--tucc-s3);color:var(--tucc-dim)}
    #tucc .p-ok{background:var(--tucc-good-soft);color:var(--tucc-good)}#tucc .p-bad{background:var(--tucc-bad-soft);color:var(--tucc-bad)}#tucc .p-chk{background:var(--tucc-warn-soft);color:var(--tucc-warn)}#tucc .p-nokey{background:var(--tucc-s3);color:var(--tucc-muted)}
    #tucc .p-lvl{background:var(--tucc-s3);color:var(--tucc-text)}#tucc .p-full{background:var(--tucc-accent-fill);color:#fff}#tucc .p-fac{background:var(--tucc-info-soft);color:var(--tucc-info)}
    #tucc .tier{margin:4px 0 18px}#tucc .tier h3{display:flex;align-items:center;gap:10px;margin:6px 0 4px;font-size:16px;font-weight:800;color:var(--tucc-text) !important}
    #tucc .tier h3::before{content:"";width:4px;height:18px;border-radius:2px;background:var(--tucc-line2)}#tucc .tier-full h3::before{background:var(--tucc-accent-fill)}
    #tucc ul.cr{margin:5px 0 0;padding-left:18px;color:var(--tucc-muted)}#tucc ul.cr li{margin:2px 0;font-size:13px}
    #tucc .tier .cnt{font-size:12px;font-weight:600;color:var(--tucc-dim)}
    #tucc .tier-full .mod{border-color:color-mix(in srgb,var(--tucc-accent-fill) 55%,transparent)}
    #tucc .tier-none h3::before{background:var(--tucc-good)}
    #tucc .p-err{background:var(--tucc-bad-soft);color:var(--tucc-bad)}#tucc .p-key{background:var(--tucc-accent-soft);color:var(--tucc-accent)}
    #tucc .acts{grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
    #tucc .b{display:inline-block;background:var(--tucc-s1);color:var(--tucc-text);border:1px solid var(--tucc-line);border-radius:var(--tucc-r2);padding:5px 11px;font-size:13px;font-weight:600;cursor:pointer}
    #tucc .b:hover{border-color:var(--tucc-accent)}#tucc .b.pri{background:var(--tucc-accent-fill);border-color:var(--tucc-accent-fill);color:var(--tucc-accent-ink) !important}
    #tucc .b.pri:hover{background:var(--tucc-accent-fill-hover)}
    #tucc .sw{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--tucc-muted);cursor:pointer}
    #tucc .sw input{width:16px;height:16px;accent-color:var(--tucc-accent-fill)}
    #tucc .note{font-size:13px;color:var(--tucc-muted);margin:6px 0}
    #tucc table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
    #tucc th,#tucc td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--tucc-line);vertical-align:top}
    #tucc th{color:var(--tucc-muted) !important;font-weight:700;width:34%}
    #tucc td{color:var(--tucc-text) !important}
    #tucc b,#tucc strong{color:var(--tucc-text) !important}
    #tucc .warn,#tucc td .warn{color:var(--tucc-warn) !important}
    #tucc .note,#tucc td .note{color:var(--tucc-muted) !important}
    #tucc a{color:var(--tucc-accent) !important;text-decoration:underline}
    #tucc .bar{height:8px;background:var(--tucc-s3);border-radius:999px;overflow:hidden;margin:6px 0}
    #tucc .bar i{display:block;height:100%;background:var(--tucc-accent-fill)}
    @media (max-width:640px){#tucc{right:0;bottom:0;width:100vw;max-height:85vh;border-radius:var(--tucc-r) var(--tucc-r) 0 0}}
  `;

  /* ---------- the TUCC page and its row in Torn's Areas list ----------
   * No floating button: TUCC is a row in Torn's own Areas list (a copy of one of Torn's rows,
   * so it matches Torn's look in every theme). Clicking it loads TUCC's page, where every
   * module can be opened or found. Opening an original script runs that script's own menu
   * command or presses its own (hidden) button, so it behaves exactly as before. */
  function launchTarget(m) {
    const L = m.launch || {};
    if (L.host || L.sel) {
      let root = document;
      if (L.host) { const h = document.getElementById(L.host); root = h ? (shadowHosts.get(h) || h.shadowRoot) : null; }
      const el = root && L.sel ? root.querySelector(L.sel) : null;
      if (el) return { run: () => el.click(), sub: L.subFromButton ? String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : '' };
    }
    if (L.scroll) { const el = document.querySelector(L.scroll); if (el) return { run: () => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), sub: 'On this page' }; }
    const menus = state[m.id].menus;
    if (menus.length) {
      const pick = (L.menu && menus.find((c) => c.name === L.menu)) || menus[0];
      return { run: () => pick.fn(), sub: '' };
    }
    return null;
  }
  const TUCC_ICON = '<svg xmlns="http://www.w3.org/2000/svg" stroke="transparent" stroke-width="0" width="16" height="16" viewBox="0 0 16 16"><path d="M1 1h6v6H1zM9 1h6v6H9zM1 9h6v6H1zM11 9h2v2h2v2h-2v2h-2v-2H9v-2h2z"></path></svg>';
  const activeIn = (el) => (el ? [...el.classList].find((c) => /^active___/.test(c)) : null);
  function sidebarRow() {
    if (document.getElementById('nav-tucc')) return;
    const rows = [...document.querySelectorAll('[id^="nav-"]')].filter((e) => e.querySelector('a[href]'));
    const src = document.getElementById('nav-calendar') || document.getElementById('nav-hall_of_fame') || rows[rows.length - 1];
    if (!src) return;
    const row = src.cloneNode(true);
    row.id = 'nav-tucc';
    [row, ...row.querySelectorAll('[class]')].forEach((e) => [...e.classList].filter((c) => /^(active|attention)___/.test(c)).forEach((c) => e.classList.remove(c)));
    const a = row.querySelector('a');
    if (!a) return;
    ['i-data', 'role', 'title', 'onclick', 'target'].forEach((x) => a.removeAttribute(x));
    a.href = TUCC_URL; a.setAttribute('aria-label', 'Torn Ultimate Command Centre');
    // Keep only Torn's icon wrapper and the name (drop anything another script added to the copied row).
    const iconWrap = a.querySelector('[class*="svgIconWrap"]'), name = a.querySelector('[class*="linkName"]');
    [...a.childNodes].forEach((n) => { if (n !== iconWrap && n !== name) n.remove(); });
    const svg = iconWrap && iconWrap.querySelector('svg');
    if (svg) svg.outerHTML = TUCC_ICON;
    if (name) name.textContent = 'TUCC';
    const badge = document.createElement('span'); badge.className = 'tucc-nav-badge'; a.appendChild(badge);
    if (ON_TUCC_PAGE) {
      // Show TUCC as the current area, using the same class names Torn uses (they carry a build hash).
      rows.forEach((r) => {
        const rc = activeIn(r);
        if (!rc) return;
        r.classList.remove(rc); row.classList.add(rc);
        r.querySelectorAll('[class]').forEach((e) => { const ic = activeIn(e); if (ic) { e.classList.remove(ic); const twin = row.querySelector('.' + [...e.classList].filter((c) => !/^active___/.test(c)).join('.')); if (twin) twin.classList.add(ic); } });
      });
    }
    if (!ON_TUCC_PAGE) a.addEventListener('click', (e) => { if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; e.preventDefault(); e.stopPropagation(); openTablet(); });
    src.after(row);
    updateBadge();
  }

  /* ---------- floating TUCC button ----------
   * For Torn PDA and small screens, where Torn's Areas list is folded away. One tap opens the tablet
   * (nothing is requested). Drag it anywhere; Settings has Auto / Always / Off. */
  let fabEl = null;
  const fabRowShown = () => { const r = document.getElementById('nav-tucc'); if (!r) return false; const b = r.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const fabWanted = () => !ON_TUCC_PAGE && (cfg.fab === 'on' || (cfg.fab !== 'off' && (IS_PDA || !fabRowShown())));
  function fabPlace() {
    if (!fabEl) return;
    const W = window.innerWidth, H = window.innerHeight, p = cfg.fabPos || { x: 0.02, y: 0.72 };
    fabEl.style.left = Math.round(Math.max(4, Math.min(W - 48, p.x * W))) + 'px';
    fabEl.style.top = Math.round(Math.max(4, Math.min(H - 48, p.y * H))) + 'px';
  }
  function fabUpdate() {
    if (!fabWanted()) { if (fabEl) fabEl.classList.remove('show'); return; }
    if (!fabEl) {
      fabEl = document.createElement('button'); fabEl.id = 'tucc-fab'; fabEl.type = 'button'; fabEl.setAttribute('aria-label', 'Open TUCC');
      fabEl.innerHTML = TUCC_ICON + '<span class="tucc-nav-badge"></span>';
      let drag = null, moved = false;
      fabEl.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, l: fabEl.offsetLeft, t: fabEl.offsetTop }; moved = false; try { fabEl.setPointerCapture(e.pointerId); } catch (x) {} });
      fabEl.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 8) return;
        moved = true;
        fabEl.style.left = Math.max(4, Math.min(window.innerWidth - 48, drag.l + dx)) + 'px';
        fabEl.style.top = Math.max(4, Math.min(window.innerHeight - 48, drag.t + dy)) + 'px';
      });
      const drop = () => { if (drag && moved) { cfg.fabPos = { x: fabEl.offsetLeft / window.innerWidth, y: fabEl.offsetTop / window.innerHeight }; saveCfg(); } drag = null; };
      fabEl.addEventListener('pointerup', drop); fabEl.addEventListener('pointercancel', drop);
      fabEl.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (moved) { moved = false; return; } openTablet(); });
      window.addEventListener('resize', fabPlace);
    }
    if (!fabEl.isConnected) document.body.appendChild(fabEl);
    fabPlace(); fabEl.classList.add('show'); updateBadge();
  }
  function watchSidebar() {
    sidebarRow();
    let queued = false;
    new MutationObserver(() => {                         // Torn redraws its sidebar: put the row back (DOM only, no requests)
      if (queued || document.getElementById('nav-tucc')) return;
      queued = true; requestAnimationFrame(() => { queued = false; sidebarRow(); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  function mountPage() {
    document.documentElement.classList.add('tucc-on-page');
    document.title = 'TUCC | TORN';
    panel = document.createElement('div'); panel.id = 'tucc'; panel.className = 'open inpage';
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Torn Ultimate Command Centre');
    const wrap = document.createElement('div'); wrap.id = 'tucc-page'; wrap.appendChild(panel);
    const place = () => {
      const host = document.querySelector('#mainContainer .content-wrapper') || document.querySelector('.content-wrapper') || document.getElementById('mainContainer') || document.body;
      if (wrap.parentNode !== host) host.appendChild(wrap);
    };
    place();
    new MutationObserver(() => { if (!wrap.isConnected) place(); }).observe(document.body, { childList: true, subtree: true });
    if (/alerts/i.test(location.hash)) tab = 'alerts';
    render();
    setTimeout(() => checkAllKeys(false).then((r) => { if (r.some(Boolean)) render(); }), 1200);   // stale or new keys only
  }


  /* =====================================================================
   * TUCC Tablet (trial): clicking TUCC in the Areas list opens a tablet over the page instead of
   * loading a new page. Home screen = one app per enabled module + TUCC's own apps (Settings,
   * Alerts, Keys, Usage, Credits). Opening it is page drawing only: no requests to Torn.
   * Tapping a module app runs that module's own launcher (one tap = one action, as before).
   * ===================================================================== */
  let tabletEl = null, tabletApp = null, tabletClock = null;
  const SYS_APPS = [
    { id: 'settings', name: 'Settings', icon: '⚙', tab: 'settings' },
    { id: 'themes', name: 'Themes', icon: '🎨', tab: 'themes' },
    { id: 'alerts', name: 'Alerts', icon: '🔔', tab: 'alerts' },
    { id: 'key', name: 'API Keys', icon: '🔑', tab: 'key' },
    { id: 'usage', name: 'API Usage', icon: '📶', tab: 'usage' },
    { id: 'credits', name: 'Credits', icon: '★', tab: 'credits' },
  ];
  const TABLET_STYLE = `
    #tucc-tablet{--tt-ic:clamp(40px,6.2vh,58px);position:fixed;inset:0;z-index:2147483600;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.62);font:13.5px/1.45 var(--tucc-font)}
    #tucc-tablet.open{display:flex}
    #tucc-tablet .tt-dev{position:relative;width:min(1040px,94vw);height:min(720px,88vh);background:#0a0a0c;border:1px solid #2a2a30;border-radius:34px;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,.7),inset 0 0 0 2px #1c1c20}
    #tucc-tablet .tt-cam{position:absolute;top:9px;left:50%;width:8px;height:8px;margin-left:-4px;border-radius:50%;background:#1d1d22;box-shadow:inset 0 0 0 2px #121215}
    #tucc-tablet .tt-scr{position:relative;width:100%;height:100%;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;color:var(--tucc-text);
      background:radial-gradient(120% 90% at 85% 0%,color-mix(in srgb,var(--tucc-accent-fill) 38%,transparent),transparent 60%),radial-gradient(90% 80% at 0% 100%,color-mix(in srgb,var(--tucc-accent-fill) 35%,transparent),transparent 60%),#111113}
    #tucc-tablet .tt-bar{display:flex;align-items:center;gap:12px;padding:7px 18px;font-size:12.5px;font-weight:600;color:var(--tucc-text);background:rgba(0,0,0,.25)}
    #tucc-tablet .tt-bar .tt-r{margin-left:auto;display:flex;gap:12px;align-items:center;color:var(--tucc-muted)}
    #tucc-tablet .tt-x{background:rgba(255,255,255,.08);border:1px solid var(--tucc-line);color:var(--tucc-text);border-radius:999px;width:26px;height:26px;cursor:pointer;font-size:14px;line-height:1}
    #tucc-tablet .tt-x:hover{border-color:var(--tucc-accent)}
    #tucc-tablet .tt-home{flex:1;overflow:auto;padding:clamp(12px,2.2vh,22px) 30px 8px}
    #tucc-tablet .tt-h{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--tucc-muted);margin:2px 0 clamp(6px,1.1vh,10px)}
    #tucc-tablet .tt-sub{font-weight:500;letter-spacing:0;text-transform:none;color:var(--tucc-dim);margin-left:6px}
    #tucc-tablet .tt-app.tool .tt-ic{border-style:dashed}
    #tucc-tablet .tt-app.off{opacity:.55}
    #tucc-tablet .tt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(calc(var(--tt-ic) + 26px),1fr));gap:clamp(6px,1.3vh,14px) 8px;margin-bottom:clamp(8px,1.8vh,18px)}
    #tucc-tablet .tt-app{display:flex;flex-direction:column;align-items:center;gap:5px;background:none;border:0;color:var(--tucc-text);cursor:pointer;padding:4px;border-radius:14px;font:inherit}
    #tucc-tablet .tt-app:hover .tt-ic,#tucc-tablet .tt-app:focus-visible .tt-ic{transform:translateY(-2px);border-color:var(--tucc-accent)}
    #tucc-tablet .tt-app:focus-visible{outline:2px solid var(--tucc-accent);outline-offset:2px}
    #tucc-tablet .tt-ic{position:relative;width:var(--tt-ic);height:var(--tt-ic);border-radius:calc(var(--tt-ic) * .27);display:grid;place-items:center;font-size:calc(var(--tt-ic) * .42);font-weight:800;color:#fff;
      background:linear-gradient(160deg,#2a2a30,#18181b);border:1px solid #3a3a42;box-shadow:0 6px 14px rgba(0,0,0,.45);transition:transform .12s,border-color .12s}
    #tucc-tablet .tt-app.sys .tt-ic{background:linear-gradient(160deg,var(--tucc-accent-fill),color-mix(in srgb,var(--tucc-accent-fill) 60%,#000));border-color:color-mix(in srgb,var(--tucc-accent-fill) 60%,#000)}
    #tucc-tablet .tt-app.dim .tt-ic{opacity:.55}
    #tucc-tablet .tt-nm{font-size:12px;font-weight:600;text-align:center;max-width:calc(var(--tt-ic) + 34px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.6)}
    #tucc-tablet .tt-bd{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:var(--tucc-accent-fill);color:#fff;font-size:12px;font-weight:700;line-height:20px;text-align:center;border:2px solid #111113}
    #tucc-tablet .tt-empty{color:var(--tucc-muted);font-size:13px;margin-bottom:22px}
    #tucc-tablet .tt-view{flex:1;display:flex;flex-direction:column;min-height:0;background:var(--tucc-bg)}
    #tucc-tablet .tt-vh{display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--tucc-s1);border-bottom:1px solid var(--tucc-line)}
    #tucc-tablet .tt-back{background:none;border:0;color:var(--tucc-accent);font:600 13.5px var(--tucc-font);cursor:pointer;padding:4px 6px;border-radius:6px}
    #tucc-tablet .tt-back:hover{background:var(--tucc-accent-soft)}
    #tucc-tablet .tt-vt{font-weight:700;font-size:15px}
    #tucc-tablet #tucc{position:static;display:flex;flex:1;min-height:0;width:auto;max-width:none;max-height:none;border:0;border-radius:0;box-shadow:none;z-index:auto}
    #tucc-tablet #tucc .bd{flex:1;overflow:auto;padding:16px 18px}
    #tucc-tablet #tucc .mods{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
    #tucc-tablet #tucc .mods .mod{margin-bottom:0;align-content:start}
    #tucc-tablet .tt-info{padding:18px;display:grid;gap:10px;max-width:640px}
    #tucc-tablet .tt-info .tt-big{display:flex;gap:14px;align-items:center}
    #tucc-tablet .tt-info p{margin:0;color:var(--tucc-muted)}
    #tucc-tablet .tt-ind{height:22px;display:grid;place-items:center;cursor:pointer;background:none;border:0;width:100%}
    #tucc-tablet .tt-ind i{display:block;width:130px;height:5px;border-radius:999px;background:rgba(255,255,255,.55)}
    #tucc-tablet .tt-ind:hover i{background:#fff}
    @media (max-width:760px){#tucc-tablet .tt-dev{width:96vw;height:90vh;padding:14px;border-radius:26px}#tucc-tablet .tt-home{padding:18px 16px 8px}
      #tucc-tablet{--tt-ic:clamp(34px,4.8vh,46px)}#tucc-tablet .tt-grid{grid-template-columns:repeat(auto-fill,minmax(calc(var(--tt-ic) + 18px),1fr));gap:8px 4px}#tucc-tablet .tt-nm{font-size:10.5px;max-width:calc(var(--tt-ic) + 14px)}#tucc-tablet .tt-sub{display:none}}
    @media (max-width:480px){#tucc-tablet .tt-dev{box-sizing:border-box;width:100vw;max-width:100vw;height:100vh;height:100dvh;padding:6px;border:0;border-radius:0;box-shadow:none}#tucc-tablet .tt-scr{border-radius:12px;min-width:0}#tucc-tablet .tt-view,#tucc-tablet .tt-vb{min-width:0}
      #tucc-tablet .tt-back{min-height:36px;padding:6px 10px}#tucc-tablet .tt-ind{min-height:28px}#tucc-tablet .tt-x{min-width:32px;min-height:32px}#tucc .bd{overflow-wrap:break-word}#tucc input[type=checkbox]{min-width:18px;min-height:18px}}`;
  const appIcon = (m) => esc((m.launch && m.launch.icon) || (m.short || m.name || '?').charAt(0).toUpperCase());
  const tct = () => new Date().toISOString().slice(11, 16) + ' TCT';
  function tabletStatus() {
    const bar = tabletEl && tabletEl.querySelector('.tt-bar');
    if (!bar) return;
    bar.querySelector('.tt-clock').textContent = tct();
    bar.querySelector('.tt-api').textContent = `API ${recentCalls().length}/${budget()}`;
    const n = unread(); bar.querySelector('.tt-al').textContent = n ? `🔔 ${n}` : '';
  }
  function tabletHome() {
    tabletApp = null;
    const scr = tabletEl.querySelector('.tt-main');
    const on = modules.filter((m) => isEnabled(m)), off = modules.filter((m) => !isEnabled(m));
    const app = (m) => `<button type="button" class="tt-app" data-app="${esc(m.id)}" title="${esc(m.name)}${m.launch && m.launch.hint ? ' · ' + esc(m.launch.hint) : ''}"><span class="tt-ic">${appIcon(m)}</span><span class="tt-nm">${esc(m.short || m.name)}</span></button>`;
    const sys = (a) => `<button type="button" class="tt-app sys" data-sys="${a.id}" title="${a.name}"><span class="tt-ic">${a.icon}${a.id === 'alerts' && unread() ? `<span class="tt-bd">${unread() > 9 ? '9+' : unread()}</span>` : ''}</span><span class="tt-nm">${a.name}</span></button>`;
    // Apps open their own window. Page tools work on one Torn page (the jail, the market…): tapping one shows what it does and a link to that page.
    const canOpen = (m) => { let away = false; try { away = !!(m.inline && m.home && new URL(m.home, location.href).pathname !== location.pathname); } catch (e) {} return state[m.id].status === 'running' && !away && !!launchTarget(m); };
    const wins = on.filter(canOpen), tools = on.filter((m) => !canOpen(m));
    scr.innerHTML = `<div class="tt-home">
      ${!on.length ? '<div class="tt-h">Apps</div><div class="tt-empty">No modules switched on. Open Settings to switch them on.</div>' : ''}
      ${wins.length ? `<div class="tt-h">Apps <span class="tt-sub">tap to open</span></div><div class="tt-grid">${wins.map(app).join('')}</div>` : ''}
      ${tools.length ? `<div class="tt-h">Page tools <span class="tt-sub">work on other Torn pages · tap for details and a link</span></div><div class="tt-grid">${tools.map((m) => app(m).replace('class="tt-app', 'class="tt-app tool')).join('')}</div>` : ''}
      ${off.length ? `<div class="tt-h">Off <span class="tt-sub">switch on in Settings</span></div><div class="tt-grid">${off.map((m) => app(m).replace('class="tt-app', 'class="tt-app tool off')).join('')}</div>` : ''}
      <div class="tt-h">TUCC</div>
      <div class="tt-grid">${SYS_APPS.map(sys).join('')}</div></div>`;
    scr.querySelectorAll('[data-app]').forEach((b) => b.addEventListener('click', () => openModuleApp(modules.find((m) => m.id === b.dataset.app))));
    scr.querySelectorAll('[data-sys]').forEach((b) => b.addEventListener('click', () => openSysApp(SYS_APPS.find((a) => a.id === b.dataset.sys))));
    panel = null;
  }
  function tabletView(title) {
    const scr = tabletEl.querySelector('.tt-main');
    scr.innerHTML = `<div class="tt-view"><div class="tt-vh"><button type="button" class="tt-back">‹ Home</button><span class="tt-vt">${esc(title)}</span></div><div class="tt-vb" style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:auto"></div></div>`;
    scr.querySelector('.tt-back').addEventListener('click', () => { embedClose(true); tabletHome(); });
    return scr.querySelector('.tt-vb');
  }
  function openSysApp(a) {
    tabletApp = a.id;
    const body = tabletView(a.name);
    panel = document.createElement('div'); panel.id = 'tucc'; panel.className = 'open inpage tt-panel';
    body.appendChild(panel);
    tab = a.tab;
    render();
    if (a.id === 'key' || a.id === 'settings') checkAllKeys(false).then((r) => { if (r.some(Boolean) && tabletApp === a.id) render(); });
  }
  function openModuleApp(m) {
    if (!m) return;
    // Modules that live on one page (Lockpick on the jail, OpenMarket on the market…): away from that page, show its app screen with a link there.
    let away = false; try { away = !!(m.inline && m.home && new URL(m.home, location.href).pathname !== location.pathname); } catch (e) {}
    const t = state[m.id].status === 'running' && !away ? launchTarget(m) : null;
    if (t && embedHost(m)) { embedOpen(m, t); return; }
    if (t) { closeTablet(); try { t.run(); } catch (e) { console.warn('[TUCC] open', e); } return; }
    tabletApp = m.id;
    const body = tabletView(m.name);
    const st = state[m.id].status;
    const why = st === 'off' ? 'This module is switched off. Switch it on in Settings, then reload the page.'
      : st === 'error' ? `This module failed to start: ${esc(state[m.id].error)}`
      : st === 'not-here' || away ? (!m.autoOpen ? `This module works on ${esc(m.where || 'other pages')}. Its tools appear there by themselves.` : `This module opens on ${esc(m.where || 'other pages')}. Press the button below and it opens there.`)
      : `This module works on ${esc(m.where || 'this page')}. Its tools are on the page itself.`;
    body.innerHTML = `<div class="tt-info"><div class="tt-big"><span class="tt-ic" style="position:static">${appIcon(m)}</span><div><div style="font-weight:700;font-size:16px">${esc(m.name)}</div><div style="color:var(--tucc-dim);font-size:12.5px">v${esc(m.version)} · Key: ${esc(m.keyLevel)}</div></div></div>
      <p>${esc(m.desc || '')}</p><p>${why}</p>
      ${m.home && st !== 'off' ? `<div><a class="tt-go" href="${esc(m.home)}" style="display:inline-block;background:var(--tucc-accent-fill);color:#fff;text-decoration:none;font-weight:700;padding:7px 14px;border-radius:8px">Go to ${esc(m.where || 'its page')} ›</a></div>` : ''}</div>`;
    const go = body.querySelector('.tt-go'); if (go && m.autoOpen) go.addEventListener('click', () => rawSet(OPEN_NEXT, { id: m.id, t: now() }));
  }
  // ---- modules opened inside the tablet (Torn Pulse) ----
  let embedded = null, embedEndedAt = 0;                 // { m, host, body, obs }
  const embedHost = (m) => { const L = m.launch || {}; return L.host && L.embed ? document.getElementById(L.host) : null; };
  function embedPlace() {
    if (!embedded) return;
    const r = embedded.body.getBoundingClientRect();
    const h = embedded.host.style;
    h.setProperty('--tt-x', r.left + 'px'); h.setProperty('--tt-y', r.top + 'px');
    h.setProperty('--tt-w', r.width + 'px'); h.setProperty('--tt-h', r.height + 'px');
  }
  function embedOpen(m, t) {
    embedClose(false);
    tabletApp = m.id;
    const body = tabletView(m.name);
    body.style.background = 'var(--tucc-bg)';
    const host = embedHost(m), E = m.launch.embed;
    embedded = { m, host, body, obs: null };
    host.setAttribute('data-tt-embed', '');
    embedPlace();
    try { t.run(); } catch (e) { console.warn('[TUCC] open', e); }
    // The module can ask to leave the tablet (Pulse's "Open in sidebar"): let go of it without closing it, then close the tablet.
    host.addEventListener('tucc-release', function rel() { host.removeEventListener('tucc-release', rel); if (embedded && embedded.host === host) { embedClose(false); closeTablet(); } });
    // The module's own close button (or Esc) takes you back to the tablet's home screen.
    const sr = shadowHosts.get(host) || host.shadowRoot, root = sr && sr.querySelector(E.root);
    if (root) {
      embedded.obs = new MutationObserver(() => { if (embedded && !root.classList.contains(E.openClass)) { embedClose(false); if (tabletEl && tabletEl.classList.contains('open')) tabletHome(); } });
      embedded.obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    }
  }
  function embedClose(closeModule) {
    if (!embedded) return;
    const { m, host, obs } = embedded;
    embedded = null; embedEndedAt = Date.now();
    if (obs) obs.disconnect();
    if (closeModule) {
      const sr = shadowHosts.get(host) || host.shadowRoot, E = m.launch.embed;
      const root = sr && sr.querySelector(E.root);
      if (root && root.classList.contains(E.openClass)) { const x = sr.querySelector(E.close); if (x) x.click(); }   // the module's own close button: no request
    }
    host.removeAttribute('data-tt-embed');
  }
  window.addEventListener('resize', () => embedPlace());
  function setUnder(on) { modules.forEach((m) => { const h = embedHost(m); if (h) { if (on) h.setAttribute('data-tt-under', ''); else h.removeAttribute('data-tt-under'); } }); }
  function buildTablet() {
    if (tabletEl) return;
    rawStyle(TABLET_STYLE);
    tabletEl = document.createElement('div'); tabletEl.id = 'tucc-tablet';
    tabletEl.setAttribute('role', 'dialog'); tabletEl.setAttribute('aria-modal', 'true'); tabletEl.setAttribute('aria-label', 'TUCC tablet');
    tabletEl.innerHTML = `<div class="tt-dev"><span class="tt-cam"></span><div class="tt-scr">
      <div class="tt-bar"><span>TUCC</span><span class="tt-clock"></span><span class="tt-r"><span class="tt-al"></span><span class="tt-api"></span><button type="button" class="tt-x" title="Close (Esc)" aria-label="Close">✕</button></span></div>
      <div class="tt-main" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>
      <button type="button" class="tt-ind" title="Home" aria-label="Home"><i></i></button></div></div>`;
    document.body.appendChild(tabletEl);
    tabletEl.addEventListener('click', (e) => { if (e.target === tabletEl) closeTablet(); });
    tabletEl.querySelector('.tt-x').addEventListener('click', closeTablet);
    tabletEl.querySelector('.tt-ind').addEventListener('click', () => { embedClose(true); tabletHome(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tabletEl.classList.contains('open') && !embedded && Date.now() - embedEndedAt > 400) closeTablet(); });   // with a module open inside, Esc closes the module (back to home)
  }
  function openTablet() {
    buildTablet();
    document.body.appendChild(tabletEl);                   // last in the page, so it sits above any module window
    tabletEl.classList.add('open');
    if (fabEl) fabEl.classList.remove('show');
    setUnder(true);
    document.documentElement.style.overflow = 'hidden';
    tabletHome(); tabletStatus();
    clearInterval(tabletClock); tabletClock = setInterval(() => { if (!document.hidden) { tabletStatus(); if (tabletApp === 'usage') render(); } }, 5000);
    const f = tabletEl.querySelector('.tt-app'); if (f) f.focus();
  }
  function closeTablet() {
    if (!tabletEl) return;
    embedClose(true);
    setUnder(false);
    tabletEl.classList.remove('open');
    fabUpdate();
    document.documentElement.style.overflow = '';
    clearInterval(tabletClock); tabletApp = null; panel = null;
  }
  function buildUI() {
    if (document.documentElement.dataset.tuccUi) return;
    document.documentElement.dataset.tuccUi = '1';
    rawStyle(STYLE);
    applyTheme(); setTimeout(applyTheme, 1500);          // again after the modules have added their own styles
    rawMenu('TUCC: open', () => { if (ON_TUCC_PAGE) location.href = TUCC_URL; else openTablet(); });
    watchSidebar();
    if (IS_PDA) fabUpdate();
    setTimeout(fabUpdate, 3000); setInterval(() => { if (!document.hidden && !(tabletEl && tabletEl.classList.contains('open'))) fabUpdate(); }, 15000);
    if (ON_TUCC_PAGE) mountPage();
    setInterval(() => { if (!document.hidden) updateBadge(); }, 5000);   // alerts added in other tabs
    setTimeout(() => checkUpdate(false), 4000);
    if (IS_PDA) setTimeout(() => { try { let n = 0; for (const k of Object.keys(localStorage)) n += k.length + String(localStorage.getItem(k) || '').length; if (n > 4000000) addAlert(CORE_MOD, { id: 'pda-storage', title: 'Storage nearly full', text: 'Torn PDA gives scripts about 5 MB. Clear a tool\'s saved data in its settings, or new data may not save.' }); } catch (e) {} }, 20000);
  }

  function statusPill(m) {
    const s = state[m.id];
    if (s.status === 'running') return '<span class="pill p-run">Ready</span>';
    if (s.status === 'error') return `<span class="pill p-err" title="${esc(s.error)}">Error</span>`;
    if (s.status === 'off') return '<span class="pill p-off">Off</span>';
    return `<span class="pill p-here">Works on ${esc(m.where || 'other pages')}</span>`;
  }
  /* ---------- key check ----------
   * When a key is saved (and every 6 hours after), TUCC asks Torn's API what the key can read
   * (/v2/key/info, one call per distinct key) and marks each module: key OK, too low, or invalid. */
  const KEYINFO = CORE + 'keyinfo', KEY_RECHECK = 6 * 3600000;
  const LEVEL_NAME = { 1: 'Public', 2: 'Minimal', 3: 'Limited', 4: 'Full Access' };
  const needLevel = (m) => { const k = String(m.keyLevel || ''); return /^None/i.test(k) ? 0 : /^Public/i.test(k) ? 1 : /^Minimal/i.test(k) ? 2 : /^Limited/i.test(k) ? 3 : 4; };
  const keyInfos = () => rawGet(KEYINFO, {}) || {};
  const checking = new Set();
  function checkKey(k, force) {
    const h = hash(k), all = keyInfos(), cur = all[h];
    if (!k || checking.has(h) || (!force && cur && now() - cur.at < KEY_RECHECK)) return Promise.resolve(cur);
    checking.add(h);
    return new Promise((resolve) => {
      apiRequest(CORE_MOD, { method: 'GET', url: 'https://api.torn.com/v2/key/info', headers: { Authorization: 'ApiKey ' + k }, nocache: true, timeout: 15000,
        onload: (r) => {
          let e = { at: now() };
          try {
            const j = JSON.parse(r.responseText);
            if (j && j.error) e = Object.assign(e, { ok: false, code: Number(j.error.code), err: String(j.error.error || 'Torn API error') });
            else { const a = (j.info && j.info.access) || {}; e = Object.assign(e, { ok: true, level: Number(a.level) || 0, type: String(a.type || ''), faction: a.faction, company: a.company, sels: (j.info && j.info.selections) || {} }); }
          } catch (er) { e = Object.assign(e, { ok: null, err: 'Unreadable reply' }); }
          if (e.code === 5 || e.code === 8 || e.code === 9) e.ok = null;     // rate limit / API down: not the key's fault, check again later
          const all2 = keyInfos(); all2[h] = e; rawSet(KEYINFO, all2); checking.delete(h); resolve(e);
        },
        onerror: () => { checking.delete(h); resolve(null); }, ontimeout: () => { checking.delete(h); resolve(null); } });
    });
  }
  function checkAllKeys(force) {
    const ks = [...new Set(modules.filter((m) => m.keyStore).map(keyOf).filter(Boolean))];
    return Promise.all(ks.map((k) => checkKey(k, force)));
  }
  // What the saved key means for this module: {cls, text, title}
  function keyStatus(m) {
    const k = keyOf(m);
    if (!m.keyStore) return null;
    if (!k) return { cls: 'p-nokey', text: 'No key saved', title: 'Save a key on the API key & ToS tab' };
    const e = keyInfos()[hash(k)];
    if (!e) return { cls: 'p-chk', text: 'Checking key…', title: `Key …${k.slice(-4)}` };
    if (e.ok === false) return { cls: 'p-bad', text: e.code === 2 ? '✗ Key invalid' : `✗ Key error ${e.code}`, title: `${e.err} (key …${k.slice(-4)})` };
    if (e.ok == null) return { cls: 'p-chk', text: 'Key not checked yet', title: (e.err || 'Torn API unavailable') + '; it will be checked again' };
    const need = needLevel(m), have = e.level || 0, custom = /custom/i.test(e.type) || !have;
    const lacks = Object.entries(m.needSel || {}).flatMap(([cat, list]) => list.filter((x) => !((e.sels || {})[cat] || []).includes(x)).map((x) => `${cat} → ${x}`));
    const label = e.type || LEVEL_NAME[have] || 'key';
    if (m.needSel && custom) return lacks.length ? { cls: 'p-bad', text: '✗ Key missing ' + lacks.join(', '), title: `${label} key …${k.slice(-4)} can't read: ${lacks.join(', ')}` }
      : { cls: 'p-ok', text: `✓ Key OK (${label})`, title: `Key …${k.slice(-4)} checked ${ago(e.at)}` };
    if (custom) return { cls: 'p-chk', text: `✓ Valid ${label} key`, title: `Custom keys can't be matched to every selection; if something in this module is blank, check the key's selections. Checked ${ago(e.at)}` };
    if (have < need) return { cls: 'p-bad', text: `✗ Needs ${LEVEL_NAME[need]} (key is ${label})`, title: `Key …${k.slice(-4)} is ${label}; this module needs ${m.keyLevel}` };
    if (/faction API access/i.test(m.keyLevel || '') && e.faction === false) return { cls: 'p-chk', text: `✓ Key OK (${label}) · no faction access`, title: 'Your faction has not given your position API access, so faction-wide parts stay empty' };
    return { cls: 'p-ok', text: `✓ Key OK (${label})`, title: `Key …${k.slice(-4)} checked ${ago(e.at)}` };
  }
  const keyPill = (m) => { const st = keyStatus(m); return st ? `<span class="pill ${st.cls}" title="${esc(st.title)}">${esc(st.text)}</span>` : ''; };
  const keyOf = (m) => (m.keyStore ? String(rawGet(m.id + ':' + m.keyStore, '') || '').replace(/^"(.*)"$/, '$1') : '');
  // Key tiers: modules that read your log (trade log, bust log) need a Full Access key (or a Custom key
  // with user -> log); everything else runs on a Limited key or less.
  const isFull = (m) => !!m.separateKey;
  const noApi = (m) => !m.keyStore && /^None/i.test(m.keyLevel || 'None');
  const lvlName = (m) => { const k = String(m.keyLevel || 'None'); return /^None/i.test(k) ? 'No key' : /^Public/i.test(k) ? 'Public' : /^Minimal/i.test(k) ? 'Minimal' : /^Limited/i.test(k) ? 'Limited' : 'Full Access'; };
  const needsFaction = (m) => /faction API access/i.test(m.keyLevel || '');
  const lvlPills = (m) => `<span class="pill ${isFull(m) ? 'p-full' : 'p-lvl'}" title="${esc(m.keyLevel)}">${esc(lvlName(m))}</span>${needsFaction(m) ? '<span class="pill p-fac" title="Your faction must give your position API access">+ faction access</span>' : ''}`;
  const TIER_NOTE = {
    none: 'These modules never call the Torn API and need no key. They only work with the page you are viewing, so you can keep them on whatever key you use, or none.',
    limited: 'One <b>Limited</b> key covers every module in this section. Some need less (Public or Minimal). Modules marked <b>+ faction access</b> also need your faction to give your position API access.',
    full: 'These modules read your Torn <b>log</b> (your trade log and bust log). Only a <b>Full Access</b> key, or a Custom key with user → log, can do that. Their key has its own slot, so only these modules ever get it.',
  };
  function modulesHTML() {
    const L = (m) => m.launch || {};
    const card = (m) => {
      const t = state[m.id].status === 'running' ? launchTarget(m) : null;
      const pick = t && L(m).menu ? L(m).menu : null;
      const others = state[m.id].menus.map((c, i) => ({ c, i })).filter((x) => x.c.name !== pick);
      const acts = [
        t ? `<button type="button" class="b pri" data-open="${esc(m.id)}">Open</button>` : '',
        !t && m.home && isEnabled(m) ? `<a class="b" href="${esc(m.home)}">Go to ${esc(m.where || 'its page')} ›</a>` : '',
      ].concat(others.map((x) => `<button type="button" class="b" data-act="${esc(m.id)}|${x.i}">${esc(x.c.name)}</button>`)).filter(Boolean);
      return `
      <div class="mod">
        <div><span class="nm">${esc(m.name)}</span> <span class="ver">v${esc(m.version)}</span>${statusPill(m)}${lvlPills(m)}${keyPill(m)}</div>
        <label class="sw"><input type="checkbox" data-mod="${esc(m.id)}"${isEnabled(m) ? ' checked' : ''}> On</label>
        <div class="ds">${esc(m.desc || '')} <span class="ver">· Key: ${esc(m.keyLevel)}</span></div>
        ${acts.length ? `<div class="acts">${acts.join('')}</div>` : ''}
      </div>`;
    };
    const none = modules.filter(noApi), lim = modules.filter((m) => !isFull(m) && !noApi(m)), full = modules.filter(isFull);
    const section = (id, title, list) => list.length ? `<div class="tier tier-${id}"><h3>${title} <span class="cnt">${list.length} module${list.length === 1 ? '' : 's'}</span></h3>
      <div class="note">${TIER_NOTE[id]}</div><div class="mods">${list.map(card).join('')}</div></div>` : '';
    return `<div class="note" style="margin-top:0">Open a module here, or go to the page where it works. Switching a module on or off takes effect when you reload. Uninstall or disable the standalone copies of these scripts so they don't run twice.</div>
      ${section('none', 'No API needed', none)}${section('limited', 'Limited key or less', lim)}${section('full', 'Full Access key', full)}`;
  }
  function keyHTML() {
    const lim = modules.filter((m) => m.keyStore && !isFull(m)), full = modules.filter((m) => m.keyStore && isFull(m));
    const rows = (list) => `<table><tbody>${list.map((m) => `<tr><th>${esc(m.name)}</th><td>${keyOf(m) ? `Key …${esc(keyOf(m).slice(-4))} ` : ''}${keyPill(m)} ${lvlPills(m)}<div class="note" style="margin:3px 0 0">Needs: ${esc(m.keyLevel)}</div></td></tr>`).join('')}</tbody></table>`;
    const box = (id, ph, btn) => `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input type="password" id="${id}" placeholder="${ph}" style="flex:1;min-width:180px"><button type="button" class="b pri" data-key-save="${id}">${btn}</button>${pdaKey() ? `<button type="button" class="b" data-key-pda="${id}">Use Torn PDA key</button>` : ''}</div>`;
    return `<div class="tier tier-limited"><h3>Limited key or less <span class="cnt">${lim.length} modules</span></h3>
      <div class="note">${TIER_NOTE.limited} Company Manager shows full detail only to directors.</div>
      ${box('tucc-key', 'Limited key (16 characters)', 'Save to these modules')}
      ${rows(lim)}</div>
      ${full.length ? `<div class="tier tier-full"><h3>Full Access key <span class="cnt">${full.length} modules</span></h3>
      <div class="note">${TIER_NOTE.full} A Custom key with user → basic, log, perks, profile and torn → stocks covers both and is safer than Full Access.</div>
      ${box('tucc-key-full', 'Full Access or Custom key (16 characters)', 'Save to these modules')}
      ${rows(full)}
      <div class="note">Want one key for everything? Paste the same Full Access (or Custom) key in both boxes.</div></div>` : ''}
      <div style="margin:8px 0 14px"><button type="button" class="b" id="tucc-key-recheck">Check keys again</button> <span class="note">Each key is checked with one call to Torn's API (key info) when you save it and every 6 hours.</span></div>
      ${tosHTML()}`;
  }
  const CREDITS = /*__CREDITS__*/{ core: null, list: [], also: [] }/*__END_CREDITS__*/;
  function creditsHTML() {
    const prof = (t) => esc(t).replace(/\[(\d{3,8})\]/g, (_, id) => `[<a href="https://www.torn.com/profiles.php?XID=${id}" target="_blank" rel="noopener">${id}</a>]`);
    const row = (c) => `<tr><th>${esc(c.m)}</th><td><b>${prof(c.a)}</b> <span class="pill p-lvl">${esc(c.l)}</span>${c.x.length ? `<ul class="cr">${c.x.map((x) => `<li>${prof(x)}</li>`).join('')}</ul>` : ''}${c.u ? `<div class="note" style="margin:3px 0 0"><a href="${esc(c.u)}" target="_blank" rel="noopener">Original project page</a></div>` : ''}</td></tr>`;
    const sec = (t, list) => `<div class="tier"><h3>${t} <span class="cnt">${list.length}</span></h3><table><tbody>${list.map(row).join('')}</tbody></table></div>`;
    return `<div class="note" style="margin-top:0">Who wrote each module, and whose work it builds on. Please keep these credits when sharing or adapting TUCC.</div>
      ${CREDITS.core ? `<table><tbody>${row(CREDITS.core)}</tbody></table>` : ''}
      ${sec('Bundled scripts', CREDITS.list.filter((c) => !c.t))}${sec('Built for TUCC', CREDITS.list.filter((c) => c.t))}
      ${CREDITS.also.map((a) => `<div class="note">${esc(a)}</div>`).join('')}`;
  }
  function tosHTML() {
    const ext = modules.filter((m) => m.tos && m.tos.external).map((m) => m.tos.external);   // trusted text from the build, contains links
    return `<table class="tos"><tbody>
      <tr><th>Data Storage</th><td>Only locally: in your userscript manager, plus this browser's storage for a few modules: Attack Hybrid Ultimate (button layout, key binds, attack type), Cash Desk (your presets), Torn Spectrum (settings), OpenMarket (filter), Ranked Notes (notes), Item Pins (pins), TORN Auction Price Checker (settings, recent searches, window position) and OC Command Centre (join-audit history). Defib keeps your revive log (8 days) and your faction's incoming revive log (50 hours). Travel 2.Dough keeps 25 hours of price history and the pay from your last 60 hunts. OpenMarket keeps the item market listings your page loads in memory only, to label that page, and never saves them. TUCC keeps recent Torn API responses for seconds to an hour (shared responses), so modules and tabs don't ask twice. Each module keeps its own cache and settings (see each module's own ToS for details).${IS_PDA ? ` In Torn PDA, saved data and your key are kept in the Torn page\'s storage inside the app (PDA has no separate script storage), so other scripts you add to PDA could read them.` : ''}</td></tr>
      <tr><th>Data Sharing</th><td>Nobody. Your key and your Torn data are sent only to api.torn.com. Three modules read public data from community sites: Travel 2.Dough sends item IDs (nothing about you) to TornW3B for bazaar prices, OC Command Centre sends OC names and pass rates to tornprobability.com only if you turn on success chances, and TORN Auction Price Checker sends the item name, bonuses and quality you search for to its search service and TornW3B, only when you click.</td></tr>
      <tr><th>Purpose of Use</th><td>Competitive advantage: planning travel and hunting (Travel 2.Dough); attacking (Attack Hybrid Ultimate) and ranked war training (RW Energy Guard); ranked wars (War Room); training and daily progress (Torn Pulse); crimes (Crimes Analyst) and shoplifting alerts (Big Al's Watch); busting and bailing (Lockpick); reviving, revive clients and revive billing (Defib); item and stock prices (OpenMarket, Market Watcher, TORN Auction Price Checker). Public community tools: faction OC management (OC Command Centre), company management (Company Manager) and company recruiting (Recruiting Mastered). Other: accessibility colour layers (Torn Spectrum), personal award goals (Medal Detector), personal notes on ranked war items (Ranked Notes), organising your own Items page (Item Pins) and moving your own money (Cash Desk).</td></tr>
      <tr><th>Key Storage &amp; Sharing</th><td>Stored / Used only for automation, sent only to api.torn.com: in a request header on every API v2 call. API v1 takes the key in the address; v1 is used by Lockpick (bust log, level and perks), Torn Pulse (most calls), Medal Detector, Company Manager (company data) and Market Watcher (stock prices).${pdaKey() || IS_PDA ? ` In Torn PDA, the key saved in the app is used only if you press &quot;Use Torn PDA key&quot;.` : ''}</td></tr>
      <tr><th>Key Access Level</th><td>${modules.filter((m) => m.keyStore).map((m) => `${esc(m.short)}: ${esc(m.keyLevel)}`).join(' · ')}</td></tr>
      </tbody></table>
      ${ext.length ? `<div class="note"><b>Outside data, read-only, nothing about you or your key sent:</b> ${ext.join(' · ')}</div>` : ''}
      <div class="note"><b>Update checker</b> (Settings, can be switched off): reads the version line of the published TUCC file on <a href="https://docs.github.com/en/site-policy/github-terms/github-terms-of-service" target="_blank" rel="noopener">GitHub</a>. Nothing about you or your key is sent.</div>`;
  }
  function usageHTML() {
    const log = recentCalls(), p = pauseInfo(), b = budget();
    const rows = modules.concat([SHARED_MOD]).filter((m) => tabStats[m.id] && tabStats[m.id].length).map((m) => `<tr><th>${esc(m.name)}</th><td>${tabStats[m.id].filter((t) => now() - t < 60000).length} in the last minute (this tab)</td></tr>`).join('');
    return `${p ? `<div class="note warn">Torn API calls paused for ${Math.ceil((p.until - now()) / 1000)}s: ${esc(p.why)}</div>` : ''}
      <div class="note" style="margin-top:0"><b>${log.length}</b> of <b>${b}</b> Torn API calls used in the last minute (all modules, all tabs). Torn's limit is 100 per key.</div>
      <div class="bar"><i style="width:${Math.min(100, Math.round(log.length / b * 100))}%"></i></div>
      <label class="sw" style="color:#f1f4f8">Budget per minute <input type="number" id="tucc-budget" min="10" max="95" value="${b}" style="width:80px"></label>
      <div class="note">Calls over the budget wait their turn instead of failing. Leave room for any other scripts using the same key.</div>
      <div class="note"><b>${cacheHits}</b> calls saved in this tab: ${feedSaved} by the shared feed (modules asking for the same data are answered from one combined call), the rest by identical recent requests. ${feedCalls} combined calls made.</div>
      ${rows ? `<table><tbody>${rows}</tbody></table>` : '<div class="note">No Torn API calls from this tab yet.</div>'}
      ${speedHTML()}`;
  }
  // Speed check: how long each module took to start on this page, and how much each has saved.
  // Tampermonkey hands all of TUCC's saved data to every page before it runs, so a large total slows every page change.
  function speedHTML() {
    const sizes = {}; let total = 0;
    try { for (const k of rawList()) { let n = 0; try { n = JSON.stringify(rawGet(k, null)).length; } catch (e) {} const id = k.includes(':') ? k.slice(0, k.indexOf(':')) : 'other'; sizes[id] = (sizes[id] || 0) + n; total += n; } } catch (e) {}
    const kb = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    const names = Object.assign({ tucc_core: 'TUCC core (shared cache, alerts, settings)' }, Object.fromEntries(modules.map((m) => [m.id, m.name])));
    const ids = [...new Set(Object.keys(sizes).concat(modules.filter((m) => state[m.id].ms != null).map((m) => m.id)))];
    const rows = ids.map((id) => ({ id, size: sizes[id] || 0, ms: state[id] && state[id].ms })).sort((a, b) => (b.ms || 0) - (a.ms || 0) || b.size - a.size)
      .map((r) => `<tr><th>${esc(names[r.id] || r.id)}</th><td>${r.ms != null ? Math.round(r.ms) + ' ms' : '–'}</td><td>${r.size ? kb(r.size) : '–'}</td></tr>`).join('');
    const modMs = modules.reduce((n, m) => n + (state[m.id].ms || 0), 0);
    return `<h4>Speed check (this page)</h4>
      <div class="note">Page load: <b>${nav ? Math.round(nav.domContentLoadedEventEnd) + ' ms' : '–'}</b> to ready. Torn's server and your connection: <b>${nav ? Math.round(nav.responseEnd) + ' ms' : '–'}</b> of that.</div>
      <div class="note">${IS_PDA ? 'Torn PDA' : 'Tampermonkey'} started TUCC <b>${Math.round(T_START)} ms</b> after the page began loading${nav ? ` (the page arrived at ${Math.round(nav.responseStart)} ms)` : ''}. TUCC's core took <b>${Math.round(T_CORE)} ms</b> and its modules <b>${Math.round(modMs)} ms</b> in all.</div>
      <div class="note">TUCC's saved data: <b>${kb(total)}</b> in all (${IS_PDA ? 'Torn PDA keeps it in the page\'s storage, about 5 MB shared with Torn' : 'Tampermonkey loads all of it on every page'}; under 1 MB is fine).</div>
      <table><thead><tr><th>Module</th><th>Start-up</th><th>Saved data</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function updateBanner() {
    const u = rawGet(UPD, {}) || {};
    return u.latest && newer(u.latest, VERSION) ? `<div class="note" style="margin:0;padding:8px 14px;background:var(--tucc-accent-soft)">Update available: <b>v${esc(u.latest)}</b> (you have v${esc(VERSION)}). <a href="${esc(cfg.update.url)}" target="_blank" rel="noopener">Install update</a></div>` : '';
  }
  const ago = (t) => { const s = Math.round((now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
  function alertsHTML() {
    const list = alertList(), seen = Number(rawGet(SEEN, 0)) || 0;
    if (!list.length) return '<div class="note" style="margin-top:0">No alerts yet. Every module\'s notifications collect here (from all your Torn tabs), newest first. New ones show as a count on TUCC\'s row in the Areas list.</div>';
    return `<div style="display:flex;gap:6px;margin-bottom:8px"><button type="button" class="b" id="tucc-al-clear">Clear all</button><span class="note" style="margin:4px 0 0">Mute modules in Settings.</span></div>` +
      list.map((a) => `<div class="al ${esc(a.level)}${cfg.alerts.mute[a.mod] ? ' muted' : ''}"><span class="m">${esc(a.modName)}</span><span class="t">${a.at > seen ? '● ' : ''}${a.url ? `<a href="${esc(a.url)}">${esc(a.title)}</a>` : esc(a.title)}</span><span class="w">${esc(ago(a.at))}</span>${a.text ? `<span class="tx">${esc(a.text)}</span>` : ''}</div>`).join('');
  }
  function themesHTML() {
    const cur = cfg.palette && PALETTES[cfg.palette] ? cfg.palette : 'red';
    const card = (id, p) => `<button type="button" class="tt-theme${id === cur ? ' on' : ''}" data-palette="${id}" aria-pressed="${id === cur}">
      <span class="sw" style="background:linear-gradient(135deg,${p.fill},${p.accent})"></span>
      <span class="tn">${esc(p.name)}${id === cur ? ' <span class="tick">✓</span>' : ''}</span>
      <span class="pv"><span class="pb" style="background:${p.fill}">Button</span><span class="pl" style="color:${p.accent}">Link</span></span></button>`;
    return `<div class="note" style="margin-top:0">Pick the accent colour for TUCC and every module. It changes straight away, on every page; nothing is sent anywhere. Status colours stay the same in every theme (green ready, amber warning, rose problem), so their meaning never changes.</div>
      <div class="tt-themes">${Object.entries(PALETTES).map(([id, p]) => card(id, p)).join('')}</div>
      <h4>Module look</h4>
      <label class="sw"><input type="checkbox" id="tucc-theme"${cfg.theme ? ' checked' : ''}> Use the TUCC look on every module (off = each script's original look; TUCC's own screens always use your theme)</label>`;
  }
  function settingsHTML() {
    const u = rawGet(UPD, {}) || {};
    const mods = [CORE_MOD].concat(modules);
    return `<h4 style="margin-top:0">Look and launcher</h4>
      <label class="sw"><input type="checkbox" id="tucc-launcher"${cfg.launcher ? ' checked' : ''}> Hide the scripts' own floating buttons (open them from TUCC instead)</label>
      <label class="sw"><input type="checkbox" id="tucc-theme"${cfg.theme ? ' checked' : ''}> One theme: TUCC colours and type on every module (off = each script's original look)</label>
      <label class="sw">Floating TUCC button <select id="tucc-fab-mode">${[['auto', 'Auto'], ['on', 'Always'], ['off', 'Off']].map(([v, n]) => `<option value="${v}"${(cfg.fab || 'auto') === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <h4>Alerts</h4>
      ${IS_PDA ? '' : `<label class="sw"><input type="checkbox" id="tucc-al-desk"${cfg.alerts.desktop ? ' checked' : ''}> Desktop notifications</label>`}
      <label class="sw"><input type="checkbox" id="tucc-al-snd"${cfg.alerts.sound ? ' checked' : ''}> Sound for warnings and urgent alerts</label>
      <div class="note">Muted modules still list their alerts (dimmed) but never notify or count on TUCC's row in the Areas list.</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px 14px">${mods.map((m) => `<label class="sw"><input type="checkbox" data-mute="${esc(m.id)}"${cfg.alerts.mute[m.id] ? ' checked' : ''}> Mute ${esc(m.short || m.name)}</label>`).join('')}</div>
      <h4>Shared API data</h4>
      <label class="sw"><input type="checkbox" id="tucc-feed"${cfg.feed !== false ? ' checked' : ''}> Shared feed: modules asking for your user, faction or game data get it from one combined call</label>
      <label class="sw">Fast-changing data (bars, cooldowns, travel) is shared for <input type="number" id="tucc-share" min="0" max="120" value="${Number(cfg.shareSecs)}" style="width:70px"> seconds (0 = off)</label>
      <div class="note">Slower data (profile, stats, perks, education) is shared for up to a minute, game data (items, gyms, honours) for 10 minutes. Logs, events, messages and key checks are never shared or combined.</div>
      <h4>Updates</h4>
      <label class="sw"><input type="checkbox" id="tucc-upd-on"${cfg.update.on ? ' checked' : ''}> Check for TUCC updates (twice a day at most)</label>
      <div style="display:flex;gap:6px;margin-top:6px"><input type="text" id="tucc-upd-url" value="${esc(cfg.update.url)}" style="flex:1"><button type="button" class="b" id="tucc-upd-now">Check now</button></div>
      <div class="note">${u.checked ? `Last checked ${esc(ago(u.checked))}: ${u.error ? `<span class="warn">${esc(u.error)}</span>` : u.latest ? (newer(u.latest, VERSION) ? `v${esc(u.latest)} available. <a href="${esc(cfg.update.url)}" target="_blank" rel="noopener">Install update</a>` : `you have the latest (v${esc(VERSION)})`) : ''}` : 'Not checked yet.'}
      The check reads the version line of the published TUCC file. Nothing about you or your key is sent, and installing is always your own click.</div>`;
  }
  // Redraws keep your place: the live screens (API Usage) redraw every few seconds.
  function render() {
    if (!panel || !panel.classList.contains('open')) return;
    const keep = [];
    for (let e = panel; e && e !== document.documentElement; e = e.parentElement) if (e.scrollTop) keep.push([e, e.scrollTop]);
    const bd = panel.querySelector('.bd'), bdTop = bd ? bd.scrollTop : 0;
    renderPanel();
    keep.forEach(([e, t]) => { e.scrollTop = t; });
    const nb = panel.querySelector('.bd'); if (nb && bdTop) nb.scrollTop = bdTop;
  }
  function renderPanel() {
    if (panel.classList.contains('tt-panel')) {
      const body = tab === 'settings' ? `<h4 style="margin-top:0">Modules</h4><div class="note" style="margin-top:0">Switch modules on or off here. Each one switched on gets an app on the home screen. Changes take effect when you reload the page.</div>${modulesHTML().replace(/^\s*<div class="note" style="margin-top:0">[\s\S]*?<\/div>/, '')}<h4>General</h4>${settingsHTML()}`
        : tab === 'alerts' ? alertsHTML() : tab === 'key' ? keyHTML() : tab === 'usage' ? usageHTML() : tab === 'themes' ? themesHTML() : creditsHTML();
      panel.innerHTML = `${updateBanner()}<div class="bd">${body}</div>`;
    } else panel.innerHTML = `
      <div class="hd"><span class="brand">⚙ TUCC</span><span class="ver">Torn Ultimate Command Centre v${esc(VERSION)}</span></div>
      ${updateBanner()}
      <div class="tabs">${[['modules', 'Modules'], ['alerts', 'Alerts' + (unread() ? ` (${unread()})` : '')], ['key', 'API key & ToS'], ['usage', 'API usage'], ['settings', 'Settings'], ['themes', 'Themes'], ['credits', 'Credits']].map(([k, l]) => `<button type="button" class="tab${tab === k ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="bd">${tab === 'modules' ? modulesHTML() : tab === 'alerts' ? alertsHTML() : tab === 'key' ? keyHTML() : tab === 'usage' ? usageHTML() : tab === 'credits' ? creditsHTML() : tab === 'themes' ? themesHTML() : settingsHTML()}</div>`;
    if (tab === 'alerts') { rawSet(SEEN, now()); updateBadge(); }
    panel.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
    panel.querySelectorAll('[data-mod]').forEach((c) => c.addEventListener('change', () => { cfg.enabled[c.dataset.mod] = c.checked; saveCfg(); }));
    panel.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { const m = modules.find((x) => x.id === b.dataset.open), t = m && launchTarget(m); if (t) { try { t.run(); } catch (e) { console.warn('[TUCC] open', e); } } }));
    panel.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => { const [id, i] = b.dataset.act.split('|'); const c = state[id].menus[Number(i)]; try { c.fn(); } catch (e) { console.warn(e); } }));
    panel.querySelectorAll('[data-key-save]').forEach((btn) => btn.addEventListener('click', () => {
      const id = btn.dataset.keySave, inp = panel.querySelector('#' + id), k = inp.value.trim();
      if (!/^[A-Za-z0-9]{16}$/.test(k)) { inp.value = ''; inp.placeholder = 'Not a valid 16-character key'; return; }
      const fullBox = id === 'tucc-key-full';
      modules.filter((m) => m.keyStore && isFull(m) === fullBox).forEach((m) => {
        rawSet(m.id + ':' + m.keyStore, k);
        (m.keyReset || []).forEach((x) => rawDel(m.id + ':' + x));   // clear a module's "bad key, stop calling" flag (Torn Pulse), so the new key is used
      });
      inp.value = ''; btn.textContent = 'Saved ✓ (reload to apply)';
      checkKey(k, true).then(() => render()); setTimeout(render, 1500);
    }));
    panel.querySelectorAll('[data-key-pda]').forEach((btn) => btn.addEventListener('click', () => { const id = btn.dataset.keyPda, inp = panel.querySelector('#' + id), save = panel.querySelector(`[data-key-save="${id}"]`); if (inp && save) { inp.value = pdaKey(); save.click(); } }));
    const rc = panel.querySelector('#tucc-key-recheck'); if (rc) rc.addEventListener('click', () => { rc.textContent = 'Checking…'; checkAllKeys(true).then(() => render()); });
    const cl = panel.querySelector('#tucc-al-clear'); if (cl) cl.addEventListener('click', () => { rawSet(ALERTS, []); updateBadge(); render(); });
    const on = (sel, fn) => { const e = panel.querySelector(sel); if (e) e.addEventListener('change', () => { fn(e); saveCfg(); updateBadge(); }); };
    on('#tucc-fab-mode', (e) => { cfg.fab = e.value; setTimeout(fabUpdate, 0); });
    on('#tucc-al-desk', (e) => { cfg.alerts.desktop = e.checked; });
    on('#tucc-launcher', (e) => { cfg.launcher = e.checked; applyTheme(); });
    on('#tucc-theme', (e) => { cfg.theme = e.checked; applyTheme(); });
    panel.querySelectorAll('[data-palette]').forEach((b) => b.addEventListener('click', () => { cfg.palette = b.dataset.palette; saveCfg(); applyTheme(); render(); }));
    on('#tucc-al-snd', (e) => { cfg.alerts.sound = e.checked; if (e.checked) beep('warn'); });
    on('#tucc-share', (e) => { cfg.shareSecs = Math.max(0, Math.min(120, Number(e.value) || 0)); });
    on('#tucc-feed', (e) => { cfg.feed = e.checked; });
    on('#tucc-upd-on', (e) => { cfg.update.on = e.checked; });
    on('#tucc-upd-url', (e) => { cfg.update.url = updateUrlOk(e.value.trim()) ? e.value.trim() : UPDATE_URL; render(); });
    panel.querySelectorAll('[data-mute]').forEach((c) => c.addEventListener('change', () => { cfg.alerts.mute[c.dataset.mute] = c.checked; saveCfg(); updateBadge(); }));
    const un = panel.querySelector('#tucc-upd-now'); if (un) un.addEventListener('click', () => { un.textContent = 'Checking…'; checkUpdate(true); });
    const bi = panel.querySelector('#tucc-budget');
    if (bi) bi.addEventListener('change', () => { cfg.budget = Math.max(10, Math.min(95, Number(bi.value) || 60)); saveCfg(); render(); });
  }
  // refresh the usage tab while it's open
  setInterval(() => { if (panel && panel.classList.contains('open') && tab === 'usage' && !document.hidden) render(); }, 5000);

  if (!DUPLICATE) whenTime('end', buildUI);
  return { register, version: VERSION, alert: (a) => addAlert(CORE_MOD, a) };
})();
