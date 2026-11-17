// ==UserScript==
// @name         Recruiting Mastered (Experimental)
// @namespace    eaglewing.recruiting.mastered
// @version      0.1.9-experimental
// @description  Working Stats badge, a local "Contacted" tick box and a one-click mail icon next to each player on the User List and company pages. Requires a Public API key. Works in Tampermonkey and Torn PDA.
// @author       Eaglewing [571041]
// @license      MIT
// @match        https://www.torn.com/page.php?sid=UserList*
// @match        https://www.torn.com/joblist.php*
// @run-at       document-idle
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

// Required API key access level: Public

(function () {
  'use strict';

  /* ================= CONFIG ================= */
  const API = 'https://api.torn.com';
  const API_COMMENT = 'RecruitingMastered';
  // Lookup speed in requests per minute. Torn allows 100 per minute per player,
  // shared by every tool using that player's keys, so each option leaves headroom.
  const SPEEDS = Object.freeze({
    fast: { perMinute: 90, label: 'Fast (90 per minute)' },
    normal: { perMinute: 60, label: 'Normal (60 per minute)' },
    shared: { perMinute: 35, label: 'Shared (35 per minute, for when other API tools are running)' }
  });
  const DEFAULT_SPEED = 'fast';
  const MAX_PARALLEL = 3;                          // requests allowed in flight at once
  const WINDOW_MS = 61 * 1000;                     // rolling window for the per-minute cap (1s margin)
  const CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;  // WS kept for a year; use "Refresh WS" for fresh numbers
  const CACHE_MAX = 5000;                          // oldest cached players are dropped beyond this
  const RATE_LIMIT_PAUSE_MS = 60 * 1000;           // pause after Torn says "too many requests"
  const API_DOWN_PAUSE_MS = 5 * 60 * 1000;         // pause while the API is disabled
  const MAX_RETRIES = 3;
  const OLD_KEY_STORAGE = 'torn_api_key_full';     // where v0.1.7 kept its key (page localStorage)

  const K = Object.freeze({
    key: 'rm_api_key',
    cache: 'rm_ws_cache',
    contacted: 'rm_contacted',
    migrated: 'rm_migrated_v017',
    seen: 'rm_setup_seen',
    speed: 'rm_speed'
  });

  const WS_LEVELS = [
    { max: 50000, cls: 'ws-low' },
    { max: 100000, cls: 'ws-mid' },
    { max: Infinity, cls: 'ws-high' }
  ];

  // Errors that mean the key cannot be used: every request stops until a key is saved again.
  const KEY_ERRORS = {
    1: 'The API key is empty. Save a Public key in the settings.',
    2: 'Incorrect API key. Check it and save it again.',
    8: 'Torn has temporarily blocked API requests from your IP. Wait a while, then save your key again.',
    10: 'This key\'s owner is in federal jail, so the key cannot be used.',
    13: 'This key is disabled because its owner has been inactive.',
    14: 'This key has reached its daily read limit. Try again tomorrow.',
    16: 'This key\'s access level is too low for this request.',
    18: 'This key is paused. Unpause it in your Torn API settings, then save it again.'
  };

  /* ================= STORAGE (script storage, not Torn's page storage) ================= */
  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  const store = {
    get(name, fallback) {
      try {
        if (hasGM) return GM_getValue(name, fallback);
        const raw = localStorage.getItem('rm_fallback_' + name);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(name, value) {
      try {
        if (hasGM) GM_setValue(name, value);
        else localStorage.setItem('rm_fallback_' + name, JSON.stringify(value));
      } catch { /* storage full or blocked: keep working in memory */ }
    }
  };
  const readObject = (name) => {
    const value = store.get(name, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  };

  function addStyle(css) {
    if (typeof GM_addStyle === 'function') return GM_addStyle(css);
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ================= STYLES ================= */
  addStyle(`
    .ws-wrap{display:inline-flex;align-items:center;gap:6px;margin-left:6px;vertical-align:middle}
    .ws-box{width:14px;height:14px;border-radius:3px;border:1px solid rgba(255,255,255,0.25);
      background:rgba(0,0,0,0.30);cursor:pointer;transition:all .15s ease-in-out;padding:0}
    .ws-box:hover{border-color:#3fb950}
    .ws-box.is-on{background:#00ff66 !important;border-color:#00ff66 !important;box-shadow:0 0 6px rgba(0,255,102,0.55)}
    .ws-badge{font-size:12px;padding:2px 6px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);
      display:inline-flex;align-items:center;white-space:nowrap}
    .ws-badge.ws-action{cursor:pointer;text-decoration:underline dotted}
    .ws-low {color:#ff6b6b;border-color:rgba(255,107,107,0.35);background:rgba(255,107,107,0.08)}
    .ws-mid {color:#ffb067;border-color:rgba(255,176,103,0.35);background:rgba(255,176,103,0.08)}
    .ws-high{color:#6fe28d;border-color:rgba(111,226,141,0.35);background:rgba(111,226,141,0.08)}
    .ws-na  {color:#9aa4b2;border-color:rgba(154,164,178,0.28);background:rgba(154,164,178,0.07)}
    .ws-mail{font-size:13px;padding:2px 5px;border-radius:6px;border:1px solid rgba(255,255,255,0.18);
      background:rgba(255,255,255,0.06);text-decoration:none;user-select:none}
    .ws-mail:hover{border-color:#3fb950;background:rgba(63,185,80,0.12)}

    #rm-fab{position:fixed;right:12px;bottom:72px;z-index:99998;width:40px;height:40px;border-radius:50%;
      border:1px solid #3fb950;background:#14181d;color:#6fe28d;font:700 12px/1 Arial,sans-serif;
      cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.5);padding:0}
    #rm-fab.rm-alert::after{content:"";position:absolute;top:2px;right:2px;width:10px;height:10px;
      border-radius:50%;background:#ff6b6b;box-shadow:0 0 0 2px #14181d}
    #rm-panel{position:fixed;right:12px;bottom:120px;z-index:99999;width:min(360px,calc(100vw - 24px));
      max-height:min(80vh,620px);overflow:auto;padding:12px;border:1px solid #2f3a44;border-radius:10px;
      background:#14181d;color:#d8dee4;font:13px/1.4 Arial,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.6)}
    #rm-panel[hidden]{display:none}
    #rm-panel *{box-sizing:border-box}
    #rm-panel .rm-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
    #rm-panel .rm-head b{font-size:14px;color:#fff}
    #rm-panel button{font:inherit;padding:5px 9px;border:1px solid #3a4652;border-radius:6px;
      background:#1f262d;color:#d8dee4;cursor:pointer}
    #rm-panel button:hover{border-color:#3fb950}
    #rm-panel button:disabled{opacity:.6;cursor:default}
    #rm-panel button.rm-primary{border-color:#3fb950;background:#1d3324;color:#fff}
    #rm-panel .rm-x{padding:0 8px;font-size:18px;line-height:24px}
    #rm-panel .rm-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0}
    #rm-panel .rm-spacer{flex:1}
    #rm-panel input{flex:1;min-width:0;padding:6px 8px;border:1px solid #3a4652;border-radius:6px;
      background:#0d1014;color:#fff;font:inherit}
    #rm-panel a{color:#6fb7ff}
    #rm-panel .rm-status{padding:6px 8px;border-radius:6px;background:#0d1014;margin-bottom:6px}
    #rm-panel .rm-note{min-height:1em;color:#f3c27a}
    #rm-panel .rm-warn{margin:8px 0;padding:8px;border:1px solid #9a6b2f;border-radius:6px;background:#2a1f12;color:#f3d7a8}
    #rm-panel .rm-warn[hidden]{display:none}
    #rm-panel .rm-access{margin:2px 0 4px;color:#d8dee4}
    #rm-panel .rm-access b{color:#6fe28d}
    #rm-panel select{flex:1;min-width:0;padding:5px 6px;border:1px solid #3a4652;border-radius:6px;
      background:#0d1014;color:#fff;font:inherit}
    #rm-panel table.rm-tos{width:100%;border-collapse:collapse;margin:6px 0;font-size:11px;line-height:1.3}
    #rm-panel .rm-tos th,#rm-panel .rm-tos td{padding:3px 6px;border:1px solid #2f3a44;text-align:left;vertical-align:top}
    #rm-panel .rm-tos th{width:42%;color:#9aa4b2;font-weight:600;background:#181e24}
    .ws-streak{margin-left:6px;padding-left:6px;border-left:1px solid currentColor;color:#ffb067}
    .ws-streak.ws-old{opacity:.55}
    #rm-panel h4{margin:10px 0 2px;font-size:12px;color:#9aa4b2;text-transform:uppercase;letter-spacing:.05em}
  `);

  /* ================= HELPERS ================= */
  class Halted extends Error {}
  class Skipped extends Error {}

  // Old cache shapes -> number or null
  function normalizeWs(value) {
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object') {
      if (typeof value.ws === 'number') return value.ws;
      if (typeof value.value === 'number') return value.value;
    }
    return null;
  }

  function xidFrom(link) {
    try {
      const xid = new URL(link.href, location.href).searchParams.get('XID');
      return /^\d+$/.test(xid || '') ? xid : null;
    } catch {
      return null;
    }
  }

  function wsClass(ws) {
    if (typeof ws !== 'number') return 'ws-na';
    return WS_LEVELS.find(level => ws <= level.max)?.cls || 'ws-high';
  }

  /* ================= ONE-TIME MIGRATION FROM v0.1.7 ================= */
  // Copies Contacted ticks and cached WS out of Torn's page storage. The old
  // Full Access key is NOT copied: this version only needs a Public key.
  function migrate() {
    if (store.get(K.migrated, false)) return;
    try {
      const oldContacted = JSON.parse(localStorage.getItem('ws_contacted') || '{}');
      if (oldContacted && typeof oldContacted === 'object') {
        store.set(K.contacted, { ...oldContacted, ...readObject(K.contacted) });
      }
      const oldCache = JSON.parse(localStorage.getItem('ws_cache_v2') || '{}');
      const cache = readObject(K.cache);
      for (const [id, entry] of Object.entries(oldCache || {})) {
        const ws = normalizeWs(entry?.data);
        if (typeof ws === 'number' && !cache[id]) cache[id] = { t: Number(entry.t) || Date.now(), ws };
      }
      store.set(K.cache, cache);
    } catch { /* unreadable old data is simply skipped */ }
    store.set(K.migrated, true);
  }

  function oldKeyPresent() {
    try { return Boolean(localStorage.getItem(OLD_KEY_STORAGE)); } catch { return false; }
  }

  /* ================= WS CACHE (in memory, saved in batches) ================= */
  let wsCache = {};
  let saveTimer = null;

  // Entries are { t: fetched at, ws: working stats, streak: activity streak or null }.
  function cacheGet(id) {
    const entry = wsCache[id];
    if (!entry || typeof entry.ws !== 'number') return null;
    if (Date.now() - Number(entry.t) > CACHE_TTL_MS) return null;
    return entry;
  }

  function cacheSet(id, ws, streak) {
    const entry = { t: Date.now(), ws, streak: typeof streak === 'number' ? streak : null };
    wsCache[id] = entry;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCache, 1500);
    return entry;
  }

  // Merges with what other tabs saved (newest entry wins) and drops the oldest past CACHE_MAX.
  function saveCache() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const merged = { ...wsCache };
    for (const [id, entry] of Object.entries(readObject(K.cache))) {
      if (!merged[id] || Number(merged[id].t) < Number(entry?.t)) merged[id] = entry;
    }
    const ids = Object.keys(merged);
    if (ids.length > CACHE_MAX) {
      ids.sort((a, b) => Number(merged[b].t) - Number(merged[a].t))
        .slice(CACHE_MAX).forEach(id => delete merged[id]);
    }
    wsCache = merged;
    store.set(K.cache, merged);
  }

  function clearCache() {
    clearTimeout(saveTimer);
    saveTimer = null;
    wsCache = {};
    store.set(K.cache, {});
  }

  /* ================= CONTACTED ================= */
  let contacted = {};
  const isContacted = id => Boolean(contacted[id]);

  function setContacted(id, on) {
    const map = readObject(K.contacted);   // re-read so other tabs' ticks are kept
    if (on) map[id] = 1;
    else delete map[id];
    store.set(K.contacted, map);
    contacted = map;
  }

  /* ================= API QUEUE ================= */
  let apiKey = '';
  let halted = '';        // set when the key cannot be used; stops every request
  let pausedUntil = 0;    // set after a rate-limit or API-down error
  let speed = DEFAULT_SPEED;
  const queue = [];
  const pending = new Map();  // xid -> queued item, so one player is fetched once
  const starts = [];          // start times of recent requests, for the per-minute cap
  let active = 0;             // requests in flight
  let pumpTimer = null;

  // Players currently on screen (plus a margin) are fetched first.
  const visible = new WeakSet();
  const viewport = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      if (queue.length) pump();
    }, { rootMargin: '300px 0px' })
    : null;

  const perMinute = () => (SPEEDS[speed] || SPEEDS[DEFAULT_SPEED]).perMinute;

  function settle(item, ws, error) {
    pending.delete(item.xid);
    if (error) item.reject(error);
    else item.resolve(ws);
  }

  function requestWS(xid, link) {
    const existing = pending.get(xid);
    if (existing) {
      existing.links.add(link);
      return existing.promise;
    }
    const item = { xid, links: new Set([link]), tries: 0 };
    item.promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject; });
    pending.set(xid, item);
    queue.push(item);
    updateStatus();
    pump();
    return item.promise;
  }

  function schedulePump(delay) {
    if (pumpTimer) return;
    pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, Math.max(0, delay));
  }

  // Drops players no longer on the page (no request is made for them), then
  // picks the first queued player on screen, or the oldest one if none are.
  function takeNext() {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (![...queue[i].links].some(link => link.isConnected)) settle(queue.splice(i, 1)[0], null, new Skipped());
    }
    if (!queue.length) return null;
    const index = queue.findIndex(item => [...item.links].some(link => visible.has(link)));
    return queue.splice(index < 0 ? 0 : index, 1)[0];
  }

  // Starts requests evenly spaced (start to start, so response time doesn't slow
  // things down), up to MAX_PARALLEL at once, never more than the chosen speed
  // in any rolling minute.
  function pump() {
    if (halted) {
      while (queue.length) settle(queue.shift(), null, new Halted(halted));
      updateStatus();
      return;
    }
    while (queue.length && active < MAX_PARALLEL) {
      const now = Date.now();
      if (pausedUntil > now) {
        updateStatus();
        schedulePump(Math.min(pausedUntil - now, 5000));
        return;
      }
      while (starts.length && now - starts[0] >= WINDOW_MS) starts.shift();
      const limit = perMinute();
      let wait = starts.length ? starts[starts.length - 1] + 60000 / limit - now : 0;
      if (starts.length >= limit) wait = Math.max(wait, starts[0] + WINDOW_MS - now);
      if (wait > 0) {
        schedulePump(wait);
        break;
      }
      const item = takeNext();
      if (!item) break;
      starts.push(now);
      active++;
      fetchPlayer(item.xid).then(
        entry => settle(item, entry),
        error => {
          if (error.retry && ++item.tries < MAX_RETRIES && !halted) queue.unshift(item);
          else settle(item, null, error);
        }
      ).finally(() => {
        active--;
        updateStatus();
        pump();
      });
    }
    updateStatus();
  }

  function apiError(data) {
    const code = Number(data.error.code);
    if (KEY_ERRORS[code]) {
      haltRequests(KEY_ERRORS[code]);
      return new Halted(KEY_ERRORS[code]);
    }
    if (code === 5) {
      pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
      return Object.assign(new Error('Too many requests'), { retry: true });
    }
    if (code === 9) {
      pausedUntil = Date.now() + API_DOWN_PAUSE_MS;
      return Object.assign(new Error('API disabled'), { retry: true });
    }
    // Torn rejected the request's shape (wrong type/fields/selection or stat name).
    const badRequest = [3, 4, 21, 22, 23].includes(code);
    return Object.assign(new Error('API error ' + code + ': ' + data.error.error), { badRequest });
  }

  async function apiGet(path, key, params = {}) {
    const url = new URL(API + path);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    url.searchParams.set('key', key);
    url.searchParams.set('comment', API_COMMENT);
    let response;
    try {
      response = await fetch(url.href, { cache: 'no-store' });
    } catch {
      throw Object.assign(new Error('Network error'), { retry: true });
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('Unexpected API response (HTTP ' + response.status + ')');
    }
    if (data?.error) throw apiError(data);
    return data;
  }

  // Activity streak can come from a few response shapes, depending on how Torn returns it.
  function readStreak(stats) {
    if (!stats) return null;
    if (Array.isArray(stats)) {
      const value = stats.find(stat => stat?.name === 'activestreak')?.value;
      return typeof value === 'number' ? value : null;
    }
    if (typeof stats.activestreak === 'number') return stats.activestreak;
    const current = stats.other?.activity?.streak?.current;
    return typeof current === 'number' ? current : null;
  }

  // One request per player: working stats and activity streak together (Torn counts
  // a request as one call however many selections it asks for). If Torn rejects
  // the combined form, the rest of the session uses the working-stats-only request,
  // so the call count never goes up.
  let combined = true;

  async function fetchPlayer(xid) {
    const id = encodeURIComponent(xid);
    if (combined) {
      try {
        const data = await apiGet('/v2/user/' + id, apiKey,
          { selections: 'hof,personalstats', stat: 'activestreak' });
        const ws = data?.hof?.working_stats?.value;
        if (typeof ws === 'number') return cacheSet(xid, ws, readStreak(data.personalstats));
        combined = false;   // no Hall of Fame data in this shape: stop using it
      } catch (error) {
        if (!error.badRequest) throw error;
        combined = false;
      }
    }
    const data = await apiGet('/v2/user/' + id + '/hof', apiKey);
    const ws = data?.hof?.working_stats?.value;
    if (typeof ws !== 'number') throw new Error('WS missing');
    return cacheSet(xid, ws, null);
  }

  function haltRequests(message) {
    halted = message;
    updateFab();
    updateStatus();
    // Badges already on screen switch to "key error" so the problem is visible.
    document.querySelectorAll('[data-rm-wrap] .ws-badge[data-state="loading"]')
      .forEach(badge => setBadge(badge, 'halted'));
  }

  /* ================= BADGES ================= */
  const STREAK_OLD_MS = 7 * 24 * 60 * 60 * 1000;   // streak shown dimmed when older than this

  function setBadge(badge, state, entry) {
    badge.dataset.state = state;
    badge.className = 'ws-badge ' + (state === 'ok' ? wsClass(entry.ws) : 'ws-na');
    if (state === 'nokey' || state === 'halted') badge.classList.add('ws-action');
    switch (state) {
      case 'ok': {
        const fetched = new Date(Number(entry.t)).toISOString().slice(0, 10);
        badge.textContent = 'WS: ' + entry.ws.toLocaleString();
        let title = 'Working stats ' + entry.ws.toLocaleString();
        if (typeof entry.streak === 'number') {
          const streak = document.createElement('span');
          streak.className = 'ws-streak' + (Date.now() - Number(entry.t) > STREAK_OLD_MS ? ' ws-old' : '');
          streak.textContent = '🔥' + entry.streak.toLocaleString() + 'd';
          badge.appendChild(streak);
          title += '\nActivity streak ' + entry.streak.toLocaleString() + ' days';
        }
        badge.title = title + '\nAs of ' + fetched + ' (use "Refresh WS" for fresh numbers)';
        break;
      }
      case 'loading':
        badge.textContent = 'WS: …';
        badge.title = 'Loading working stats';
        break;
      case 'nokey':
        badge.textContent = 'WS: add key';
        badge.title = 'Click to add a Public API key';
        break;
      case 'halted':
        badge.textContent = 'WS: key error';
        badge.title = halted || 'The API key cannot be used. Click to fix it.';
        break;
      default:
        badge.textContent = 'WS: N/A';
        badge.title = 'Could not load working stats';
    }
  }

  function buildUI(xid) {
    const wrap = document.createElement('span');
    wrap.className = 'ws-wrap';
    wrap.dataset.rmWrap = '1';

    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'ws-box' + (isContacted(xid) ? ' is-on' : '');
    box.title = 'Contacted';
    box.setAttribute('aria-pressed', String(isContacted(xid)));
    box.addEventListener('click', () => {
      const on = !box.classList.contains('is-on');
      box.classList.toggle('is-on', on);
      box.setAttribute('aria-pressed', String(on));
      setContacted(xid, on);
    });

    const badge = document.createElement('span');
    badge.addEventListener('click', () => {
      if (badge.classList.contains('ws-action')) openPanel();
    });

    const mail = document.createElement('a');
    mail.className = 'ws-mail';
    mail.textContent = '✉️';
    mail.title = 'Send mail';
    mail.href = 'https://www.torn.com/messages.php#/p=compose&XID=' + xid;
    mail.target = '_blank';
    mail.rel = 'noopener';

    wrap.append(box, badge, mail);
    return { wrap, badge };
  }

  /* ================= DECORATE / REDRAW ================= */
  const LINK_SELECTOR = 'a.user.name[href*="XID="]';
  let generation = 0;

  function decorate(link) {
    if (link.dataset.rmGen === String(generation)) return;
    const xid = xidFrom(link);
    if (!xid) return;
    link.dataset.rmGen = String(generation);

    // One wrap per link, inserted straight away; only its badge updates later.
    const next = link.nextElementSibling;
    if (next && next.dataset && next.dataset.rmWrap === '1') next.remove();
    const { wrap, badge } = buildUI(xid);
    link.after(wrap);

    const cached = cacheGet(xid);
    if (cached != null) return setBadge(badge, 'ok', cached);
    if (!apiKey) return setBadge(badge, 'nokey');
    if (halted) return setBadge(badge, 'halted');
    setBadge(badge, 'loading');
    viewport?.observe(link);
    requestWS(xid, link).then(
      ws => setBadge(badge, 'ok', ws),
      error => {
        if (error instanceof Skipped) {
          if (!link.isConnected) wrap.remove();   // the player left the page; drop the leftover badge
          return;
        }
        setBadge(badge, error instanceof Halted ? 'halted' : 'na');
      }
    ).finally(() => viewport?.unobserve(link));
  }

  function scan() {
    document.querySelectorAll(LINK_SELECTOR).forEach(decorate);
  }

  function redraw() {
    generation++;
    document.querySelectorAll('[data-rm-wrap]').forEach(element => element.remove());
    scan();
  }

  /* ================= SETTINGS PANEL ================= */
  let fab = null;
  let panel = null;

  function updateFab() {
    if (fab) fab.classList.toggle('rm-alert', !apiKey || Boolean(halted));
  }

  function setNote(text) {
    const note = panel?.querySelector('#rm-note');
    if (note) note.textContent = text || '';
  }

  function updateStatus() {
    const status = panel?.querySelector('#rm-status');
    if (!status) return;
    if (halted) {
      status.textContent = 'Stopped: ' + halted;
      return;
    }
    if (!apiKey) {
      status.textContent = 'No key saved. Contacted ticks and mail icons still work; WS needs a Public key.';
      return;
    }
    const parts = ['Key saved'];
    const waiting = queue.length + active;
    if (waiting) parts.push(waiting + ' lookup' + (waiting === 1 ? '' : 's') + ' left');
    const wait = pausedUntil - Date.now();
    if (wait > 0) parts.push('paused ' + Math.ceil(wait / 1000) + 's (Torn rate limit)');
    parts.push(Object.keys(wsCache).length.toLocaleString() + ' players cached');
    status.textContent = parts.join(' · ');
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'rm-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Recruiting Mastered settings');
    panel.innerHTML = `
      <div class="rm-head"><b>Recruiting Mastered</b>
        <button class="rm-x" type="button" id="rm-close" aria-label="Close">×</button></div>
      <div class="rm-status" id="rm-status"></div>
      <h4>API key</h4>
      <div class="rm-access">Required key access level: <b>Public</b></div>
      <div class="rm-row">
        <input id="rm-key" type="password" autocomplete="off" spellcheck="false"
          placeholder="16-character Public key" aria-label="Public API key">
        <button id="rm-save" class="rm-primary" type="button">Save &amp; test</button>
      </div>
      <div class="rm-row">
        <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noopener">Create a Public key</a>
        <span class="rm-spacer"></span>
        <button id="rm-remove" type="button">Remove key</button>
      </div>
      <div class="rm-note" id="rm-note" aria-live="polite"></div>
      <div class="rm-warn" id="rm-old" hidden>
        An old Full Access key saved by v0.1.7 is still in Torn's page storage. This version never uses it.
        Remove it unless another script of yours relies on it.
        <div class="rm-row"><button id="rm-old-remove" type="button">Remove old key</button></div>
      </div>
      <table class="rm-tos" aria-label="Terms of Service">
        <tr><th>Data Storage</th><td>Only locally</td></tr>
        <tr><th>Data Sharing</th><td>Nobody</td></tr>
        <tr><th>Purpose of Use</th><td>Other: company recruitment</td></tr>
        <tr><th>Key Storage &amp; Sharing</th><td>Stored / Used only for automation</td></tr>
        <tr><th>Key Access Level</th><td>Public</td></tr>
      </table>
      <h4>Working stats</h4>
      <div class="rm-row">
        <label for="rm-speed">Lookup speed</label>
        <select id="rm-speed"></select>
      </div>
      <div class="rm-row">
        <button id="rm-refresh" type="button">Refresh WS on this page</button>
        <button id="rm-clear" type="button">Clear WS cache</button>
      </div>`;
    document.body.appendChild(panel);

    const input = panel.querySelector('#rm-key');
    const saveButton = panel.querySelector('#rm-save');
    panel.querySelector('#rm-close').addEventListener('click', closePanel);
    saveButton.addEventListener('click', () => saveKey(input, saveButton));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') saveKey(input, saveButton);
    });
    panel.querySelector('#rm-remove').addEventListener('click', removeKey);
    panel.querySelector('#rm-old-remove').addEventListener('click', () => {
      try { localStorage.removeItem(OLD_KEY_STORAGE); } catch { /* ignore */ }
      panel.querySelector('#rm-old').hidden = true;
      setNote('Old Full Access key removed from Torn\'s page storage.');
    });
    panel.querySelector('#rm-refresh').addEventListener('click', refreshWs);
    panel.querySelector('#rm-clear').addEventListener('click', clearWs);

    const speedSelect = panel.querySelector('#rm-speed');
    for (const [value, option] of Object.entries(SPEEDS)) {
      speedSelect.appendChild(new Option(option.label, value, false, value === speed));
    }
    speedSelect.addEventListener('change', () => {
      speed = SPEEDS[speedSelect.value] ? speedSelect.value : DEFAULT_SPEED;
      store.set(K.speed, speed);
      setNote('Lookup speed set to ' + SPEEDS[speed].label + '.');
      pump();
    });
  }

  function openPanel() {
    if (!panel) buildPanel();
    panel.hidden = false;
    panel.querySelector('#rm-old').hidden = !oldKeyPresent();
    updateStatus();
    if (!apiKey || halted) panel.querySelector('#rm-key').focus();
  }

  function closePanel() {
    if (panel) panel.hidden = true;
  }

  // Tests the key on your own Hall of Fame (the same data the badges use), then
  // checks its access level so a higher-than-needed key can be flagged.
  async function saveKey(input, button) {
    const value = input.value.trim();
    if (!/^[A-Za-z0-9]{16}$/.test(value)) {
      setNote('Torn API keys are 16 letters and numbers.');
      return;
    }
    button.disabled = true;
    setNote('Testing key…');
    try {
      const data = await apiGetForTest('/v2/user/hof', value);
      if (typeof data?.hof?.working_stats?.value !== 'number') {
        setNote('The key works, but Torn did not return working stats. Try again later.');
        return;
      }
      let accessNote = '';
      try {
        const info = await apiGetForTest('/v2/key/info', value);
        const level = Number(info?.info?.access?.level ?? info?.access_level);
        const type = info?.info?.access?.type ?? info?.access_type;
        if (type) accessNote = ' (' + type + ')';
        if (level > 1) accessNote += '. This key has more access than this script needs; a Public key is enough and safer';
      } catch { /* access check is optional */ }
      apiKey = value;
      store.set(K.key, value);
      halted = '';
      pausedUntil = 0;
      input.value = '';
      setNote('Key saved' + accessNote + '.');
      updateFab();
      redraw();
    } catch (error) {
      setNote(error.message || 'Could not reach the Torn API. Try again.');
    } finally {
      button.disabled = false;
      updateStatus();
    }
  }

  // Like apiGet, but reports key errors without stopping the main queue.
  async function apiGetForTest(path, key) {
    const url = new URL(API + path);
    url.searchParams.set('key', key);
    url.searchParams.set('comment', API_COMMENT);
    let data;
    try {
      data = await (await fetch(url.href, { cache: 'no-store' })).json();
    } catch {
      throw new Error('Could not reach the Torn API. Try again.');
    }
    if (data?.error) {
      throw new Error(KEY_ERRORS[data.error.code] || 'API error ' + data.error.code + ': ' + data.error.error);
    }
    return data;
  }

  function removeKey() {
    if (!confirm('Remove the saved API key?\n\nCached WS and Contacted ticks are kept.')) return;
    apiKey = '';
    halted = '';
    store.set(K.key, '');
    setNote('Saved API key removed.');
    updateFab();
    redraw();
    updateStatus();
  }

  function refreshWs() {
    if (!confirm('Refresh Working Stats now?\n\nThis clears ONLY cached WS and refetches players on this page.\nContacted ticks will remain.')) return;
    clearCache();
    redraw();
    updateStatus();
  }

  function clearWs() {
    if (!confirm('Clear ONLY cached WS?\n\nContacted ticks will remain.')) return;
    clearCache();
    setNote('WS cache cleared.');
    updateStatus();
  }

  function buildFab() {
    fab = document.createElement('button');
    fab.id = 'rm-fab';
    fab.type = 'button';
    fab.textContent = 'RM';
    fab.title = 'Recruiting Mastered settings';
    fab.setAttribute('aria-label', 'Recruiting Mastered settings');
    fab.addEventListener('click', () => (panel && !panel.hidden ? closePanel() : openPanel()));
    document.body.appendChild(fab);
    updateFab();
  }

  /* ================= BOOT ================= */
  migrate();
  apiKey = String(store.get(K.key, '') || '');
  speed = SPEEDS[store.get(K.speed, DEFAULT_SPEED)] ? store.get(K.speed, DEFAULT_SPEED) : DEFAULT_SPEED;
  wsCache = readObject(K.cache);
  contacted = readObject(K.contacted);
  window.addEventListener('pagehide', () => { if (saveTimer) saveCache(); });

  buildFab();

  // Tampermonkey menu (Torn PDA users get the same controls from the RM button).
  if (typeof GM_registerMenuCommand === 'function') {
    try {
      GM_registerMenuCommand('Settings / API key', openPanel);
      GM_registerMenuCommand('Refresh cached WS', refreshWs);
      GM_registerMenuCommand('Clear WS cache (no refresh)', clearWs);
    } catch { /* menu not supported here */ }
  }

  // First run without a key: open the settings once instead of a blocking prompt.
  if (!apiKey && !store.get(K.seen, false)) {
    store.set(K.seen, true);
    openPanel();
  }

  scan();

  // DOM-only observer, debounced. It ignores changes made by this script.
  let scanTimer = null;
  const ours = node => node.nodeType !== 1 ||
    Boolean(node.closest?.('[data-rm-wrap], #rm-panel, #rm-fab'));
  new MutationObserver(mutations => {
    if (mutations.every(m => [...m.addedNodes].every(ours) && [...m.removedNodes].every(n => n.nodeType !== 1 || n.dataset?.rmWrap === '1'))) return;
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 250);
  }).observe(document.body, { childList: true, subtree: true });

  // Torn sometimes renders the list late.
  setTimeout(scan, 1200);
})();
