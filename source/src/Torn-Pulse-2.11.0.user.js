// ==UserScript==
// @name         Torn Pulse — Advisor & Alerts
// @namespace    eaglewing91.torn.pulse
// @version      2.11.0
// @description  One panel for your Torn day: notifications for cooldowns, full bars, happy resets and unused refills, plus gym-aware training advice (gains formula, specialist gyms, happy jumps), a daily checklist, progress tracking and stock dividends. Uses only the official Torn API.
// @author       Eaglewing [571041]
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @connect      api.torn.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * Credits: the advice, checklist, progress and stock features are inspired by "Torn Growth Advisor"
 * by curtthecoder (MIT licence). Gym gain estimates use the community "Vladar" training formula v2.0.
 * Ratio planning follows Baldr's and Hank's ratios from Baldr's forum guide "Hank's Ratio / Baldr's Ratio".
 * Ideas (no code copied) from GymIQ by CLASIX (train-next order, balance grade, war weighting),
 * TornTools' Specialist Gyms by DeKleineKobini and the TornTools team (safe-to-train margins) and
 * StatForge by AeC3 (best gym per stat, shown as advice only). This is an independent rewrite.
 *
 * COMPLIANCE NOTES (Torn scripting rules)
 * - Every network request goes to api.torn.com. Timed API calls are allowed.
 * - The script never requests torn.com pages and never clicks, submits or changes anything in the game.
 *   Links in the panel are ordinary links that only navigate when YOU click them.
 * - Your API key and all cached data stay in Tampermonkey's storage on this device; the key is only
 *   ever sent to api.torn.com.
 * - On the gym page you are viewing, it reads the "You gained …" result (page you loaded yourself, read only)
 *   and makes one API call to calibrate its gain estimates to your account. It never presses Train.
 * - All open Torn tabs share one cache: about two API calls per minute in total (your data, and live
 *   stock prices), plus a small call every 15 minutes (organised crime), one every 5 minutes for your faction
 *   balance (only if you turn that option on) and a public data call every 6 hours.
 */

(function () {
    'use strict';

    // =================================================================== config
    const API_USER = 'https://api.torn.com/user/';
    const API_TORN = 'https://api.torn.com/torn/';
    const API_V2 = 'https://api.torn.com/v2/';
    const SEL_FAST = ['bars', 'cooldowns', 'refills'];                                // Minimal, every minute
    const SEL_SLOW_MIN = ['profile', 'missions', 'education', 'gym', 'perks'];         // Minimal, every 5 min
    const SEL_SLOW_LTD = ['money', 'battlestats', 'networth', 'stocks', 'personalstats']; // Limited, every 5 min
    const SEL_TORN = ['stocks', 'items', 'gyms', 'education', 'bank'];                 // Public, every 6 h
    const API_MARKET = 'https://api.torn.com/market/';

    const TICK_MS = 30 * 1000;
    const FAST_MS = 60 * 1000;
    const SLOW_MS = 5 * 60 * 1000;
    const PANEL_SLOW_MS = 2 * 60 * 1000;
    const OC_MS = 15 * 60 * 1000;
    const TORN_MS = 6 * 60 * 60 * 1000;
    const STOCKS_MS = 60 * 1000;            // share prices move every minute (wiki.torn.com/wiki/Stock_Market)
    const STOCKS_IDLE_MS = 15 * 60 * 1000;  // when set to update only while viewing the Stocks tab
    const FRESH_MS = 20 * 1000;
    const STALE_MS = 3 * 60 * 1000;
    const LOCK_MS = 10 * 1000;
    const SAME_MS = 2 * 60 * 1000;
    const END_WIN_MS = 10 * 60 * 1000;
    const SNAP_MS = 6 * 60 * 60 * 1000;
    const SNAP_MAX = 200;
    const FATAL_CODES = [1, 2, 10, 13, 16, 18];

    // Game constants (wiki.torn.com, pages edited 2025–2026)
    const ENERGY_HARD_CAP = 1000;        // max energy you can hold
    const XANAX_ENERGY = 250;
    const SSL_DRUG_LIMIT = 150;          // Sports Science Lab: lifetime Xanax + Ecstasy
    const CAN_BOOSTER_H = 2;             // each energy drink adds 2h booster cooldown
    const HAPPY_LOSS_PER_E = 0.5;        // gym trains cost 40–60% of energy as happy; 50% average
    const EDVD_HAPPY = 2500;
    const FHC_HAPPY = 500;
    const HAPPY_REGEN_PER_MS = 5 / 900000; // 5 happy every 15 minutes

    const K = {
        key: 'tp_apiKey', settings: 'tp_settings', data: 'tp_data', status: 'tp_status',
        lock: 'tp_lock', tornLock: 'tp_tornLock', ocLock: 'tp_ocLock', notified: 'tp_notified',
        snaps: 'tp_snaps', torn: 'tp_torn', oc: 'tp_oc', facMoney: 'tp_facMoney', facLock: 'tp_facLock', pointPrice: 'tp_pointPrice', pointLock: 'tp_pointLock', tornFail: 'tp_tornFail', snooze: 'tp_snooze', intro: 'tp_intro', tab: 'tp_tab',
        docked: 'tp_docked', gyms: 'tp_gyms', gymsLock: 'tp_gymsLock',
        calib: 'tp_calib', calibLock: 'tp_calibLock', calibWarn: 'tp_calibWarn', stocksLock: 'tp_stocksLock',
    };

    const CD = {
        drug:    { label: 'Drug',    emoji: '💊' },
        booster: { label: 'Booster', emoji: '⚡' },
        medical: { label: 'Medical', emoji: '🩹' },
    };
    const BARS = {
        energy: { label: 'Energy', emoji: '🟢' },
        nerve:  { label: 'Nerve',  emoji: '🔴' },
    };
    const STATS = { str: 'Strength', def: 'Defense', spd: 'Speed', dex: 'Dexterity' };
    const PHASES = ['Early game', 'Getting established', 'Mid game', 'Veteran'];

    // Gyms: [name, energy per train, str, spd, def, dex dots] — wiki.torn.com/wiki/Gym (edited Apr 2026).
    // Used when the API's gym data has no numbers; standard gyms are listed in ID order 1–24.
    const GYM_TABLE = [
        ['Premier Fitness', 5, 2.0, 2.0, 2.0, 2.0], ['Average Joes', 5, 2.4, 2.4, 2.8, 2.4],
        ["Woody's Workout", 5, 2.8, 3.2, 3.0, 2.8], ['Beach Bods', 5, 3.2, 3.2, 3.2, 0],
        ['Silver Gym', 5, 3.4, 3.6, 3.4, 3.2], ['Pour Femme', 5, 3.4, 3.6, 3.6, 3.8],
        ['Davies Den', 5, 3.7, 0, 3.7, 3.7], ['Global Gym', 5, 4.0, 4.0, 4.0, 4.0],
        ['Knuckle Heads', 10, 4.8, 4.4, 4.0, 4.2], ['Pioneer Fitness', 10, 4.4, 4.5, 4.8, 4.4],
        ['Anabolic Anomalies', 10, 5.0, 4.5, 5.2, 4.5], ['Core', 10, 5.0, 5.2, 5.0, 5.0],
        ['Racing Fitness', 10, 5.0, 5.4, 4.8, 5.2], ['Complete Cardio', 10, 5.5, 5.8, 5.5, 5.2],
        ['Legs, Bums and Tums', 10, 0, 5.6, 5.6, 5.8], ['Deep Burn', 10, 6.0, 6.0, 6.0, 6.0],
        ['Apollo Gym', 10, 6.0, 6.2, 6.4, 6.2], ['Gun Shop', 10, 6.6, 6.4, 6.2, 6.2],
        ['Force Training', 10, 6.4, 6.6, 6.4, 6.8], ["Cha Cha's", 10, 6.4, 6.4, 6.8, 7.0],
        ['Atlas', 10, 7.0, 6.4, 6.4, 6.6], ['Last Round', 10, 6.8, 6.6, 7.0, 6.6],
        ['The Edge', 10, 6.8, 7.0, 7.0, 6.8], ["George's", 10, 7.3, 7.3, 7.3, 7.3],
        ['Balboas Gym', 25, 0, 0, 7.5, 7.5], ['Frontline Fitness', 25, 7.5, 7.5, 0, 0],
        ['Gym 3000', 50, 8.0, 0, 0, 0], ['Mr. Isoyamas', 50, 0, 0, 8.0, 0],
        ['Total Rebound', 50, 0, 8.0, 0, 0], ['Elites', 50, 0, 0, 0, 8.0],
        ['Sports Science Lab', 25, 9.0, 9.0, 9.0, 9.0], ['Fight Club', 10, 10, 10, 10, 10],
    ];
    // Vladar formula v2.0 per-stat constants [A, B]
    const VLADAR = { str: [1600, 1700], spd: [1600, 2000], dex: [1800, 1500], def: [2100, -600] };

    const DEFAULTS = {
        alerts: {
            drug:    { on: true,  lead: 5,  atEnd: false },
            booster: { on: true,  lead: 30, atEnd: false },
            medical: { on: false, lead: 5,  atEnd: false },
            energy:  { on: true,  lead: 10 },
            nerve:   { on: false, lead: 10 },
            refills: { on: true,  lead: 30, energy: true, nerve: true },
            happy:   { on: false, lead: 5 },
        },
        focus: 'auto',
        ratio: 'off', ratioHigh: 'str', ratioSecond: 'spd', ratioLow: 'dex', ratioCustom: { str: 100, def: 80, spd: 80, dex: 80 }, warMode: false,
        useXanax: false,
        jumping: false,
        boosterCapH: 24,
        cashLimit: 50000,
        side: 'left',
        theme: 'auto',
        happyGoal: 95,
        errLimit: 5,
        stockMode: 'always',
        cashFaction: false,
        cashCayman: false,
        countPoints: true,
    };

    const LINKS = {
        gym: 'https://www.torn.com/gym.php',
        crimes: 'https://www.torn.com/page.php?sid=crimes',
        items: 'https://www.torn.com/item.php',
        bank: 'https://www.torn.com/bank.php',
        missions: 'https://www.torn.com/loader.php?sid=missions',
        stocks: 'https://www.torn.com/page.php?sid=stocks',
        points: 'https://www.torn.com/points.php',
        faction: 'https://www.torn.com/factions.php?step=your',
        apiKeys: 'https://www.torn.com/preferences.php#tab=api',
    };

    const ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#15181c"/>' +
        '<path d="M8 34h12l6-14 8 26 6-16 4 4h12" fill="none" stroke="#8fd16a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );

    // ================================================================== helpers
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const num = (v) => (Number.isFinite(+v) ? Math.max(0, +v) : 0);
    const int = (v) => Math.floor(num(v));
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const argBy = (arr, f, max) => arr.reduce((best, x) => (best === null || (max ? f(x) > f(best) : f(x) < f(best)) ? x : best), null);

    function deepMerge(base, over) {
        const out = Object.assign({}, base);
        if (!over || typeof over !== 'object') return out;
        for (const k of Object.keys(over)) {
            if (base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])) out[k] = deepMerge(base[k], over[k]);
            else if (over[k] !== undefined) out[k] = over[k];
        }
        return out;
    }
    const getSettings = () => deepMerge(DEFAULTS, GM_getValue(K.settings, {}) || {});
    const getStatus = () => Object.assign({ keyBad: false, error: null, backoffUntil: 0 }, GM_getValue(K.status, {}) || {});
    const setStatus = (p) => GM_setValue(K.status, Object.assign(getStatus(), p));
    const sameEnd = (a, b) => typeof a === 'number' && Math.abs(a - b) < SAME_MS;

    const tornDay = (ts) => new Date(ts).toISOString().slice(0, 10);   // TCT = UTC
    function nextResetAt(ts) {
        const d = new Date(ts);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    }
    const nextQuarter = (ts) => Math.floor(ts / 900000) * 900000 + 900000; // happy above max resets at :00/:15/:30/:45
    function fmtDur(ms) {
        if (ms <= 0) return 'now';
        const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
        if (d > 0) return `${d}d ${h % 24}h`;
        if (h > 0) return `${h}h ${m % 60}m`;
        if (m > 0) return `${m}m`;
        return `${Math.ceil(ms / 1000)}s`;
    }
    const fmtClock = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    function fmtNum(n) {
        n = +n || 0;
        if (n === 0) return '0';
        const a = Math.abs(n);
        if (a >= 1e12) return (n / 1e12).toFixed(2) + 't';
        if (a >= 1e9) return (n / 1e9).toFixed(2) + 'b';
        if (a >= 1e6) return (n / 1e6).toFixed(2) + 'm';
        if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k';
        if (a >= 100) return Math.round(n).toLocaleString();
        return n.toFixed(a >= 10 ? 1 : 2);
    }
    const fmtMoney = (n) => '$' + fmtNum(n);
    const fmtBar = (n) => (Math.abs(n) >= 1e5 ? fmtNum(n) : Math.round(n).toLocaleString());
    const fmtDots = (n) => (n ? (+n).toFixed(1) : '–');
    const signed = (n, f = fmtNum) => (n > 0 ? '+' : n < 0 ? '−' : '±') + f(Math.abs(n));

    // ============================================================ gym maths
    // Vladar training formula v2.0 (community-derived). Returns the expected stat gain for one train.
    function gainPerTrain(stat, statVal, happy, dots, energy, mult) {
        const [A, B] = VLADAR[stat];
        const H = Math.min(happy, 99999);
        let S = statVal;
        if (S > 5e7) S = 5e7 + 0.057406 * Math.pow(S - 5e7, 0.928996); // soft cap above 50m (approximate)
        const r4 = (x) => Math.round(x * 1e4) / 1e4;
        const base = S * r4(1 + 0.07 * r4(Math.log(1 + H / 250))) + 8 * Math.pow(H, 1.05) + (1 - Math.pow(H / 99999, 2)) * A + B;
        return Math.max(0, base * (1 / 200000) * dots * energy * mult);
    }

    // Simulate spending `energy` in `gym` on `stat`, losing ~50% of energy as happy per train.
    function simulate(stat, statVal, happy, gym, energy, mult) {
        const ept = gym.e, dots = gym[stat];
        if (!dots || !ept) return { total: 0, trains: 0, happyAfter: happy };
        const trains = Math.min(Math.floor(energy / ept), 400);
        let S = statVal, H = happy, total = 0;
        for (let i = 0; i < trains; i++) {
            const g = gainPerTrain(stat, S, H, dots, ept, mult);
            total += g; S += g; H = Math.max(0, H - HAPPY_LOSS_PER_E * ept);
        }
        return { total, trains, happyAfter: H };
    }

    // Gym-gain multipliers from perk strings, e.g. "+ 10% defense gym gains", "Increases all gym gains by 20%".
    function gymMultipliers(perks) {
        const m = { str: 1, spd: 1, def: 1, dex: 1 };
        const map = { strength: 'str', speed: 'spd', defense: 'def', defence: 'def', dexterity: 'dex' };
        for (const raw of perks || []) {
            const s = String(raw);
            if (!/gain/i.test(s) || !/gym|training/i.test(s) || /experience/i.test(s)) continue;
            const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
            if (!pct) continue;
            const v = 1 + parseFloat(pct[1]) / 100;
            const st = s.match(/strength|speed|defen[cs]e|dexterity/i);
            if (st) m[map[st[0].toLowerCase()]] *= v;
            else for (const k of Object.keys(m)) m[k] *= v;
        }
        return m;
    }

    // ---- Self-calibration: learn a per-stat correction from your real gym results
    const STAT_FIELD = { str: 'strength', def: 'defense', spd: 'speed', dex: 'dexterity' };
    function getCalib() { return GM_getValue(K.calib, {}) || {}; }
    function calibFactor(stat) {
        const c = getCalib()[stat];
        return c && c.n > 0 && Number.isFinite(c.f) ? clamp(c.f, 0.8, 1.25) : 1;
    }
    // Compares each real train with the (already calibrated) estimate, flags big misses with likely
    // causes, and keeps one-off glitches out of the calibration.
    function checkAndLearn(stat, actual, rawPredicted, ctx) {
        const ratio = actual / rawPredicted;
        if (!(ratio > 0.5 && ratio < 2)) return null; // the numbers don't line up at all — ignore
        const s = getSettings();
        const all = getCalib();
        const c = all[stat] || { f: 1, n: 0, errs: [] };
        c.errs = c.errs || [];
        const oldF = c.n > 0 && Number.isFinite(c.f) ? clamp(c.f, 0.8, 1.25) : 1;
        const expected = rawPredicted * oldF;
        const err = actual / expected - 1;               // how far the estimate you saw was off
        const limit = clamp(int(s.errLimit) || 5, 1, 50) / 100;
        const big = Math.abs(err) > limit;
        const outlier = Math.abs(err) > limit * 3;

        const causes = [];
        if (c.gym && c.gym !== ctx.gymName) causes.push(`You trained at ${ctx.gymName} instead of ${c.gym}.`);
        if (c.perkMult && Math.abs(ctx.perkMult / c.perkMult - 1) > 0.005) causes.push(`Your gym-gain perks changed (from +${((c.perkMult - 1) * 100).toFixed(1)}% to +${((ctx.perkMult - 1) * 100).toFixed(1)}%), for example a book starting or ending.`);
        if (ctx.trainsGuessed) causes.push('The number of trains was worked out from the energy you used, so it may be wrong.');
        if (!causes.length && big) causes.push('Nothing obvious changed. It could be a game update or a perk the script can\'t read.');

        // Learn from it unless it's a lone outlier. Two outliers in a row the same way mean something real changed.
        const sameWayAsLast = c.pendingOutlier && Math.sign(c.pendingOutlier) === Math.sign(err);
        let learned = true;
        if (outlier && !sameWayAsLast) { learned = false; c.pendingOutlier = err; }
        else {
            c.pendingOutlier = 0;
            const w = outlier ? 0 : Math.min(c.n, 9); // after a confirmed change, start the average again
            c.f = (c.f * w + ratio) / (w + 1);
            c.n = outlier ? 1 : c.n + 1;
            if (outlier) c.errs = [];
        }
        if (learned) c.errs.push(Math.abs(err)); // ignored glitches don't count against accuracy
        while (c.errs.length > 10) c.errs.shift();
        c.gym = ctx.gymName;
        c.perkMult = ctx.perkMult;
        c.last = { at: Date.now(), actual, expected, err, trains: ctx.trains };
        all[stat] = c;
        GM_setValue(K.calib, all);

        const warns = GM_getValue(K.calibWarn, {}) || {};
        if (big) warns[stat] = { at: Date.now(), err, actual, expected, causes, learned };
        else delete warns[stat];
        GM_setValue(K.calibWarn, warns);
        return c;
    }

    function rowToGym(r) { return { name: r[0], e: r[1], str: r[2], spd: r[3], def: r[4], dex: r[5] }; }
    // Gyms you can train in, from Torn's 'user' -> 'gym' (unlocked_gyms, Nov 2026). Null until it has loaded,
    // in which case advice falls back to assuming every normal gym is open (the old behaviour).
    const gymKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    function gymAllowed() {
        const g = GM_getValue(K.gyms, null);
        if (!g || !Array.isArray(g.list) || !g.list.length) return null;
        const ok = new Set(g.list.filter((x) => x.available !== false).map((x) => gymKey(x.name)));
        const ids = new Set(g.list.filter((x) => x.available !== false).map((x) => Number(x.id)));
        return (name) => ok.has(gymKey(name)) || ids.has(GYM_TABLE.findIndex((r) => r[0] === name) + 1);
    }

    function currentGym(u, torn) {
        const id = u.gymId;
        if (!id) return null;
        const api = torn && torn.gyms && torn.gyms[id];
        if (api && api.e && (api.str || api.spd || api.def || api.dex)) return Object.assign({ id }, api);
        const name = api && api.name;
        const row = name ? GYM_TABLE.find((r) => r[0].toLowerCase() === name.toLowerCase()) : (id >= 1 && id <= 24 ? GYM_TABLE[id - 1] : null);
        return row ? Object.assign({ id }, rowToGym(row)) : (name ? { id, name, e: 0, str: 0, spd: 0, def: 0, dex: 0 } : null);
    }

    function pickStat(u, gym, focus) {
        const st = u.stats;
        if (!st || !gym) return null;
        const avail = Object.keys(STATS).filter((k) => gym[k] > 0);
        if (!avail.length) return null;
        const lowest = (keys) => argBy(keys, (k) => st[k], false);
        const bestDots = () => argBy(avail, (k) => gym[k] * 1e15 - st[k], true);
        if (focus === 'balanced') return lowest(avail);
        if (focus === 'defdex' || focus === 'strspd') {
            const pair = (focus === 'defdex' ? ['def', 'dex'] : ['str', 'spd']).filter((k) => avail.includes(k));
            return pair.length ? lowest(pair) : bestDots();
        }
        if (STATS[focus]) return avail.includes(focus) ? focus : bestDots();
        return bestDots();
    }

    function specialistProgress(st) {
        if (!st) return [];
        const rows = [];
        const dd = st.def + st.dex, ss = st.str + st.spd;
        rows.push({ gym: 'Balboas Gym', need: "Cha Cha's unlocked", what: 'Defense and dexterity ahead of strength and speed', lead: ss ? dd / ss - 1 : 0 });
        rows.push({ gym: 'Frontline Fitness', need: "Cha Cha's unlocked", what: 'Strength and speed ahead of defense and dexterity', lead: dd ? ss / dd - 1 : 0 });
        const singles = { str: 'Gym 3000', def: 'Mr. Isoyamas', spd: 'Total Rebound', dex: 'Elites' };
        for (const k of Object.keys(singles)) {
            const second = Math.max(...Object.keys(STATS).filter((x) => x !== k).map((x) => st[x]));
            rows.push({ gym: singles[k], need: "George's unlocked", what: `${STATS[k]} ahead of your next best stat`, lead: second ? st[k] / second - 1 : 0 });
        }
        return rows;
    }

    // ============================================================ ratio planning
    // Baldr's and Hank's ratios (Baldr's forum guide), with Torn's 1.25x specialist-gym rules. Advice only:
    // nothing here clicks Train or changes gyms.
    const RATIOS = [['off', 'Off: use my training focus'], ['baldr', "Baldr's Ratio (100 : 80 : 72 : 72)"], ['hank', "Hank's Ratio (100 : 80 : 80 : 28)"], ['custom', 'Custom ratio']];
    const PAIR = { str: 'spd', spd: 'str', def: 'dex', dex: 'def' };
    const SINGLE_GYM = { str: 'Gym 3000', def: 'Mr. Isoyamas', spd: 'Total Rebound', dex: 'Elites' };
    const COMBO_GYM = { str: 'Frontline Fitness', spd: 'Frontline Fitness', def: 'Balboas Gym', dex: 'Balboas Gym' };
    const SPECIAL_RATIO = 1.25;
    function ratioTargets(s) {
        const keys = Object.keys(STATS), t = {};
        if (s.ratio === 'baldr' || s.ratio === 'hank') {
            const hi = STATS[s.ratioHigh] ? s.ratioHigh : 'str';
            if (s.ratio === 'baldr') {
                const sec = STATS[s.ratioSecond] && s.ratioSecond !== hi ? s.ratioSecond : PAIR[hi];
                for (const k of keys) t[k] = k === hi ? 1 : k === sec ? 0.8 : 0.72;
            } else {
                const lo = STATS[s.ratioLow] && s.ratioLow !== hi ? s.ratioLow : (hi === 'dex' ? 'spd' : 'dex');
                for (const k of keys) t[k] = k === hi ? 1 : k === lo ? 0.28 : 0.8;
            }
            return t;
        }
        if (s.ratio === 'custom') {
            const c = s.ratioCustom || {};
            const top = Math.max(...keys.map((k) => num(c[k])));
            if (!(top > 0)) return null;
            for (const k of keys) t[k] = num(c[k]) / top;
            return t;
        }
        return null;
    }
    const GRADES = [[98, 'A+'], [93, 'A'], [88, 'B+'], [83, 'B'], [78, 'C+'], [70, 'C'], [60, 'D'], [-1, 'F']];
    function ratioStatus(st, t) {
        const keys = Object.keys(STATS).filter((k) => t[k] > 0);
        const scale = Math.max(...keys.map((k) => st[k] / t[k]));
        const rows = {}; let dev = 0;
        for (const k of Object.keys(STATS)) {
            const target = t[k] > 0 ? scale * t[k] : 0;
            const pct = target ? st[k] / target : 1;
            rows[k] = { target, pct, gap: Math.max(0, target - st[k]) };
            if (t[k] > 0) dev += Math.abs(1 - pct);
        }
        const score = keys.length ? 100 - (dev / keys.length) * 100 : 100;
        return { rows, score, grade: GRADES.find((g) => score >= g[0])[1] };
    }
    // How much more of each stat you can train before losing a specialist gym you qualify for now.
    function specialistGuard(st) {
        const safe = {}; for (const k of Object.keys(STATS)) safe[k] = { amt: Infinity, gym: '' };
        const cut = (k, amt, gym) => { if (amt < safe[k].amt) safe[k] = { amt: Math.max(0, amt), gym }; };
        const qualified = [];
        for (const k of Object.keys(SINGLE_GYM)) {
            const others = Object.keys(STATS).filter((x) => x !== k);
            if (st[k] >= SPECIAL_RATIO * Math.max(...others.map((x) => st[x]))) {
                qualified.push(SINGLE_GYM[k]);
                for (const x of others) cut(x, st[k] / SPECIAL_RATIO - st[x], SINGLE_GYM[k]);
            }
        }
        const ss = st.str + st.spd, dd = st.def + st.dex;
        if (dd >= SPECIAL_RATIO * ss) { qualified.push('Balboas Gym'); cut('str', dd / SPECIAL_RATIO - ss, 'Balboas Gym'); cut('spd', dd / SPECIAL_RATIO - ss, 'Balboas Gym'); }
        if (ss >= SPECIAL_RATIO * dd) { qualified.push('Frontline Fitness'); cut('def', ss / SPECIAL_RATIO - dd, 'Frontline Fitness'); cut('dex', ss / SPECIAL_RATIO - dd, 'Frontline Fitness'); }
        return { safe, qualified };
    }
    // The gyms this ratio is built to use: the high stat's own gym, and the combo gym of its pair.
    function ratioGyms(s, t) {
        if (s.ratio !== 'baldr' && s.ratio !== 'hank') return [];
        const hi = Object.keys(t).find((k) => t[k] === 1) || 'str';
        return [SINGLE_GYM[hi], COMBO_GYM[hi]];
    }
    // Best gym for each stat among the specialist gyms you qualify for, else George's.
    function bestGyms(guard) {
        const out = {};
        for (const k of Object.keys(STATS)) {
            const allow = gymAllowed();
            const rows = GYM_TABLE.map(rowToGym).filter((g) => g[k] > 0 && g.name !== 'Sports Science Lab' && g.name !== 'Fight Club'
                && (!Object.values(SINGLE_GYM).concat(Object.values(COMBO_GYM)).includes(g.name) || guard.qualified.includes(g.name))
                && (!allow || allow(g.name)));
            out[k] = rows.sort((a, b) => b[k] - a[k])[0] || null;
        }
        return out;
    }
    // Train-next order: win back a gym the ratio needs, then the biggest gap (that is safe to train), then keep the cycle.
    function ratioPlan(u, s, mult) {
        const t = ratioTargets(s);
        const st = u.stats;
        if (!t || !st) return null;
        const status = ratioStatus(st, t), guard = specialistGuard(st), best = bestGyms(guard);
        const hi = Object.keys(t).reduce((a, b) => (t[b] > t[a] ? b : a));
        const happy = (u.happy && u.happy.max) || 5000;
        const perE = (k) => { const g = best[k]; return g ? gainPerTrain(k, st[k] + status.rows[k].gap / 2, happy, g[k], g.e, mult[k] || 1) / g.e : 0; };
        const energyTo = {};
        for (const k of Object.keys(STATS)) { const r = status.rows[k], pe = perE(k); energyTo[k] = r.gap > 0 && pe > 0 ? Math.ceil(r.gap / pe) : 0; }
        const oneTrain = (k) => { const g = best[k]; return g ? gainPerTrain(k, st[k], happy, g[k], g.e, mult[k] || 1) : 0; };
        const blocked = (k) => guard.safe[k].amt !== Infinity && guard.safe[k].amt < oneTrain(k);
        let pick = null;
        const missing = ratioGyms(s, t).filter((g) => !guard.qualified.includes(g));
        if (missing.includes(SINGLE_GYM[hi])) pick = { stat: hi, why: `win back ${SINGLE_GYM[hi]} (${STATS[hi]} needs to be 25% ahead of your next stat)` };
        else if (missing.includes(COMBO_GYM[hi])) {
            const pair = [hi, PAIR[hi]];
            const k = pair.reduce((a, b) => (status.rows[b].gap / (status.rows[b].target || 1) > status.rows[a].gap / (status.rows[a].target || 1) ? b : a));
            pick = { stat: k, why: `win back ${COMBO_GYM[hi]} (${STATS[pair[0]]} + ${STATS[pair[1]]} need to be 25% ahead of the other two)` };
        }
        if (!pick) {
            const war = (k) => (s.warMode && (k === 'def' || k === 'dex') ? 1.5 : 1);
            const cands = Object.keys(STATS).filter((k) => t[k] > 0 && status.rows[k].pct < 0.98 && !blocked(k))
                .sort((a, b) => (1 - status.rows[b].pct) * war(b) - (1 - status.rows[a].pct) * war(a));
            if (cands.length) pick = { stat: cands[0], why: `the biggest gap to your target (${Math.round(status.rows[cands[0]].pct * 100)}% of it)${s.warMode && war(cands[0]) > 1 ? ', war mode favours it' : ''}` };
        }
        if (!pick) pick = { stat: hi, why: 'your ratio is on target, so keep the cycle going with your main stat' };
        return { t, status, guard, best, energyTo, pick, blocked: Object.keys(STATS).filter(blocked), missing, name: (RATIOS.find((r) => r[0] === s.ratio) || [])[1] || '' };
    }

    // ================================================================ API layer
    function apiGet(url) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: 15000,
                onload: (res) => {
                    let data;
                    try { data = JSON.parse(res.responseText); } catch (e) {
                        setStatus({ error: 'Unreadable response from the Torn API.' });
                        return resolve(null);
                    }
                    if (data && data.error && typeof data.error === 'object' && 'code' in data.error && Object.keys(data).length === 1) {
                        return resolve({ err: { code: data.error.code, msg: data.error.error } });
                    }
                    resolve({ data });
                },
                onerror: () => { setStatus({ error: 'Network error reaching api.torn.com.' }); resolve(null); },
                ontimeout: () => { setStatus({ error: 'Torn API request timed out.' }); resolve(null); },
            });
        });
    }

    function handleApiError(err) {
        const msg = `API error ${err.code}: ${err.msg}`;
        if (FATAL_CODES.includes(err.code)) setStatus({ keyBad: true, error: msg + ' — check your key in Settings.' });
        else if (err.code === 5) setStatus({ error: msg + ' — pausing for 2 minutes.', backoffUntil: Date.now() + 120000 });
        else setStatus({ error: msg });
    }

    function canCall(lockKey) {
        const key = GM_getValue(K.key, '');
        const st = getStatus();
        if (!key || st.keyBad || Date.now() < (st.backoffUntil || 0)) return null;
        if (Date.now() - GM_getValue(lockKey, 0) < LOCK_MS) return null; // another tab is fetching
        GM_setValue(lockKey, Date.now());
        return key;
    }

    const v1Url = (base, sel, key) => `${base}?selections=${sel.join(',')}&key=${encodeURIComponent(key)}&comment=TornPulse`;

    async function fetchUser(wantSlow) {
        const key = canCall(K.lock);
        if (!key) return null;
        const prev = GM_getValue(K.data, null);
        let tier = (prev && prev.tier) || 'unknown';
        let sel = SEL_FAST.slice();
        if (wantSlow) {
            sel.push(...SEL_SLOW_MIN);
            if (tier !== 'minimal') sel.push(...SEL_SLOW_LTD);
        }
        let res = await apiGet(v1Url(API_USER, sel, key));
        if (res && res.err && res.err.code === 16 && wantSlow && tier !== 'minimal') {
            tier = 'minimal'; // Minimal key: carry on without the Limited selections
            sel = SEL_FAST.concat(SEL_SLOW_MIN);
            res = await apiGet(v1Url(API_USER, sel, key));
        } else if (wantSlow && tier !== 'minimal') {
            tier = 'limited';
        }
        if (!res) return null;
        if (res.err) { handleApiError(res.err); return null; }
        const d = normalize(res.data, prev, wantSlow, tier);
        GM_setValue(K.data, d);
        setStatus({ error: null, keyBad: false, backoffUntil: 0 });
        maybeSnapshot(d.u);
        return d;
    }

    async function fetchTorn(force) {
        const cached = GM_getValue(K.torn, null);
        if (!force && cached && cached.boosters && Date.now() - cached.fetchedAt < TORN_MS) return cached;
        // If the last attempt failed, wait 10 minutes before trying again rather than retrying every tick
        if (!force && Date.now() - (GM_getValue(K.tornFail, 0) || 0) < 10 * 60000) return cached;
        const key = canCall(K.tornLock);
        if (!key) return cached;
        const res = await apiGet(v1Url(API_TORN, SEL_TORN, key));
        if (!res || res.err) {
            GM_setValue(K.tornFail, Date.now());
            if (res && res.err) handleApiError(res.err);
            return cached;
        }
        GM_setValue(K.tornFail, 0);
        const r = res.data;
        const items = [];
        const boosters = [];
        for (const it of Object.values(r.items || {})) {
            if (!it || !it.name) continue;
            if (it.market_value) items.push({ n: it.name.toLowerCase(), v: num(it.market_value) });
            const b = parseHappyItem(it);
            if (b) boosters.push(b);
        }
        items.sort((a, b) => b.n.length - a.n.length);
        const stocks = parseStocks(r.stocks);
        const gyms = {};
        for (const [k, g] of Object.entries(r.gyms || {})) {
            if (!g) continue;
            const dots = (v) => (Number.isFinite(+v) && +v > 0 ? +v / 10 : 0); // API stores dots x10
            gyms[k] = { name: g.name || '', e: int(g.energy), str: dots(g.strength), spd: dots(g.speed), def: dots(g.defense), dex: dots(g.dexterity) };
        }
        const bank = {};
        for (const [k, v] of Object.entries(r.bank || {})) if (Number.isFinite(parseFloat(v))) bank[k] = parseFloat(v);
        const out = { fetchedAt: Date.now(), stocksAt: Date.now(), stocks, items, boosters, gyms, eduIds: Object.keys(r.education || {}).map(Number), bank };
        GM_setValue(K.torn, out);
        return out;
    }

    function parseStocks(raw) {
        const stocks = [];
        for (const [k, s] of Object.entries(raw || {})) {
            if (!s || !s.benefit) continue;
            stocks.push({ id: int(s.stock_id) || int(k), name: s.name, acr: s.acronym, price: num(s.current_price),
                req: int(s.benefit.requirement), freq: int(s.benefit.frequency) || 7, desc: String(s.benefit.description || '') });
        }
        return stocks;
    }

    // Live share prices: a small stocks-only call, merged into the 6-hourly public data
    async function fetchStocks(force) {
        const torn = GM_getValue(K.torn, null);
        if (!torn) return null;                       // wait for the first full public-data fetch
        const d = GM_getValue(K.data, null);
        if (!d || d.tier !== 'limited') return torn;  // the stock tools need a Limited key anyway
        const viewing = panelOpen() && activeTab === 'stocks';
        const every = getSettings().stockMode === 'viewing' && !viewing ? STOCKS_IDLE_MS : STOCKS_MS;
        if (!force && Date.now() - Math.max(torn.stocksAt || torn.fetchedAt, torn.stocksTry || 0) < every) return torn;
        const key = canCall(K.stocksLock);
        if (!key) return torn;
        const res = await apiGet(v1Url(API_TORN, ['stocks'], key));
        const latest = GM_getValue(K.torn, null) || torn;
        latest.stocksTry = Date.now(); // never retry faster than the normal interval, even after a failure
        if (!res || res.err || !parseStocks(res.data && res.data.stocks).length) {
            if (res && res.err) handleApiError(res.err);
            GM_setValue(K.torn, latest);
            return latest;
        }
        const fresh = parseStocks(res.data.stocks);
        latest.stocks = fresh;
        latest.stocksAt = Date.now();
        GM_setValue(K.torn, latest);
        return latest;
    }

    // Happy items: read the happy amount and booster cooldown from the item's own effect text,
    // falling back to the wiki's base values for candy (wiki.torn.com/wiki/Candy).
    const CANDY_BASE = [[/cupcake/i, 250], [/sherbet|humbug|pixie|jawbreaker/i, 150], [/reindeer|truffle/i, 100], [/eyeball|tootsie/i, 75],
        [/kisses|chocolate egg/i, 50], [/big box of chocolate/i, 35], [/bon ?bon|chocolate bar|lollipop|mint/i, 25]];
    function parseHappyItem(it) {
        const name = String(it.name);
        const type = String(it.type || '').toLowerCase();
        const text = `${it.effect || ''} ${it.description || ''}`;
        let kind = null;
        if (type === 'candy') kind = 'candy';
        else if (/^erotic dvd$/i.test(name)) kind = 'edvd';
        else if (/^feathery hotel coupon$/i.test(name)) kind = 'fhc';
        if (!kind) return null;
        let happy = 0;
        const m = text.match(/happiness by \+?([\d,]+)/i) || text.match(/\+\s*([\d,]+)\s*happ/i) || text.match(/([\d,]+)\s*happiness/i);
        if (m) happy = parseInt(m[1].replace(/,/g, ''), 10);
        if (!happy && kind === 'candy') { const f = CANDY_BASE.find(([re]) => re.test(name)); happy = f ? f[1] : 0; }
        if (!happy && kind === 'edvd') happy = EDVD_HAPPY;
        if (!happy && kind === 'fhc') happy = FHC_HAPPY;
        if (!happy) return null;
        let cdMin = kind === 'candy' ? 30 : 360;
        const c = text.match(/booster cool-?down by ([\d.]+)\s*(minute|hour)/i);
        if (c) cdMin = parseFloat(c[1]) * (/hour/i.test(c[2]) ? 60 : 1);
        return { name, kind, happy, cdMin, price: num(it.market_value) };
    }

    // Your own balance held in the faction (v2 user/money). Only fetched while the option is on.
    async function fetchFactionMoney(force) {
        const s = getSettings();
        const d = GM_getValue(K.data, null);
        if (!s.cashFaction || !d || d.tier !== 'limited' || !d.u || !d.u.factionId) return null;
        const cached = GM_getValue(K.facMoney, null);
        if (!force && cached && Date.now() - cached.fetchedAt < SLOW_MS) return cached;
        const key = canCall(K.facLock);
        if (!key) return cached;
        const res = await apiGet(`${API_V2}user/money?key=${encodeURIComponent(key)}&comment=TornPulse`);
        if (!res) return cached;
        if (res.err) { if (FATAL_CODES.includes(res.err.code)) handleApiError(res.err); return cached; }
        const m = (res.data && res.data.money) || {};
        const f = m.faction;
        const out = f && typeof f === 'object' && Number.isFinite(+f.money)
            ? { fetchedAt: Date.now(), ok: true, money: num(f.money), points: int(f.points) }
            : { fetchedAt: Date.now(), ok: false };
        GM_setValue(K.facMoney, out);
        return out;
    }

    // Unlocked gyms (v2 user/gym, Minimal key), hourly: so gym advice only names gyms you can use.
    async function fetchUnlockedGyms(force) {
        const d = GM_getValue(K.data, null);
        if (!d) return null;
        const cached = GM_getValue(K.gyms, null);
        if (!force && cached && Date.now() - cached.fetchedAt < 60 * 60000) return cached;
        const key = canCall(K.gymsLock);
        if (!key) return cached;
        const res = await apiGet(`${API_V2}user/gym?key=${encodeURIComponent(key)}&comment=TornPulse`);
        if (!res) return cached;
        if (res.err) {
            // No access to this one selection (16) isn't a broken key: keep the old advice and ask again in an hour.
            if (res.err.code === 16) { GM_setValue(K.gyms, { fetchedAt: Date.now(), list: null }); return null; }
            if (FATAL_CODES.includes(res.err.code)) handleApiError(res.err);
            return cached;
        }
        const g = (res.data && res.data.gym) || {};
        if (!Array.isArray(g.unlocked_gyms)) return cached;
        const out = { fetchedAt: Date.now(), list: g.unlocked_gyms.map((x) => ({ id: int(x.id), name: String(x.name || ''), available: x.available !== false })) };
        GM_setValue(K.gyms, out);
        return out;
    }

    // Points price: cheapest listing on the points market (v1 market endpoint), every 6 hours
    async function fetchPointPrice(force) {
        const d = GM_getValue(K.data, null);
        if (!d || d.tier !== 'limited' || !d.u || !(d.u.points > 0)) return null;
        const cached = GM_getValue(K.pointPrice, null);
        const wait = cached && cached.price ? TORN_MS : 10 * 60000; // retry sooner if we have no price yet
        if (!force && cached && Date.now() - cached.fetchedAt < wait) return cached;
        const key = canCall(K.pointLock);
        if (!key) return cached;
        const res = await apiGet(v1Url(API_MARKET, ['pointsmarket'], key));
        if (!res || res.err) {
            if (res && res.err && FATAL_CODES.includes(res.err.code)) handleApiError(res.err);
            GM_setValue(K.pointPrice, { fetchedAt: Date.now(), price: (cached && cached.price) || 0 });
            return cached;
        }
        const costs = Object.values(res.data.pointsmarket || {}).map((x) => num(x && x.cost)).filter((x) => x > 0);
        const out = { fetchedAt: Date.now(), price: costs.length ? Math.min(...costs) : (cached && cached.price) || 0 };
        GM_setValue(K.pointPrice, out);
        return out;
    }

    function pointsHint(u) {
        if (getSettings().countPoints || !(u.points > 0)) return '';
        const pp = GM_getValue(K.pointPrice, null);
        const worth = pp && pp.price ? ` (about ${fmtMoney(u.points * pp.price)})` : '';
        return `<p class="ph">You also have ${u.points.toLocaleString()} points${worth}, not counted.</p>`;
    }

    // Money you can put into shares now: wallet + vault, plus whatever extras you've chosen in Settings.
    function cashAvailable(u) {
        const s = getSettings();
        const parts = [['Wallet', u.wallet || 0], ['Vault', u.vault || 0]];
        const notes = [];
        if (s.cashFaction) {
            const fm = GM_getValue(K.facMoney, null);
            if (fm && fm.ok) parts.push(['Faction', fm.money]);
            else notes.push(fm ? 'Your faction balance isn\'t available from the API.' : 'Faction balance loading.');
        }
        if (s.cashCayman) parts.push(['Cayman', u.cayman || 0]);
        if (s.countPoints) {
            const pp = GM_getValue(K.pointPrice, null);
            const price = pp && pp.price;
            const pts = (u.points || 0) + (s.cashFaction && GM_getValue(K.facMoney, null) && GM_getValue(K.facMoney, null).points || 0);
            if (price) parts.push([`${pts.toLocaleString()} points`, pts * price]);
            else notes.push('Points price not available yet.');
        }
        return { total: parts.reduce((a, p) => a + p[1], 0), parts, notes };
    }

    // v2 organised crime: null = not in an OC; {error code 27} = faction still on OC 1.0
    async function fetchOC(force) {
        const d = GM_getValue(K.data, null);
        if (!d || !d.u || !d.u.factionId) return null;
        const cached = GM_getValue(K.oc, null);
        if (!force && cached && Date.now() - cached.fetchedAt < OC_MS) return cached;
        const key = canCall(K.ocLock);
        if (!key) return cached;
        const res = await apiGet(`${API_V2}user/organizedcrime?key=${encodeURIComponent(key)}&comment=TornPulse`);
        if (!res) return cached;
        if (res.err) { if (!FATAL_CODES.includes(res.err.code)) return cached; handleApiError(res.err); return cached; }
        const oc = 'organizedCrime' in res.data ? res.data.organizedCrime : res.data.organizedcrime;
        let out;
        if (oc === null || oc === undefined) out = { fetchedAt: Date.now(), state: 'none' };
        else if (oc.error || oc.code === 27) out = { fetchedAt: Date.now(), state: 'unsupported' };
        else out = { fetchedAt: Date.now(), state: 'in', name: oc.name || 'Organised crime', status: oc.status || '', readyAt: int(oc.ready_at) * 1000 };
        GM_setValue(K.oc, out);
        return out;
    }

    // ============================================================ normalising
    function normalize(r, prev, slow, tier) {
        const now = Date.now();
        const p = prev || {};
        const d = { fetchedAt: now, slowAt: slow ? now : (p.slowAt || 0), tier: slow ? tier : (p.tier || 'unknown'), u: Object.assign({}, p.u || {}) };
        const u = d.u;

        const bar = (b) => (b ? { cur: int(b.current), max: int(b.maximum) || 1, fullAt: int(b.fulltime) > 0 ? now + int(b.fulltime) * 1000 : 0 } : null);
        u.energy = bar(r.energy) || u.energy;
        u.nerve = bar(r.nerve) || u.nerve;
        u.happy = bar(r.happy) || u.happy;
        u.life = bar(r.life) || u.life;

        if (r.cooldowns) {
            const prevCd = (p.u && p.u.cd) || {};
            u.cd = {};
            for (const t of Object.keys(CD)) {
                const secs = int(r.cooldowns[t]);
                const pe = prevCd[t];
                u.cd[t] = secs > 0 ? now + secs * 1000 : (pe && pe <= now + 60000 && now - pe < END_WIN_MS ? pe : 0);
            }
        }
        if (r.refills) {
            const f = r.refills;
            const used = (a, b) => !!(typeof f[a] !== 'undefined' ? f[a] : f[b]);
            u.refills = { day: tornDay(now), energy: used('energy_refill_used', 'energy'), nerve: used('nerve_refill_used', 'nerve') };
        }

        if (slow) {
            if (r.name !== undefined) {
                u.name = r.name; u.level = int(r.level) || 1; u.id = int(r.player_id);
                u.factionId = int(r.faction && r.faction.faction_id);
            }
            if (r.missions && typeof r.missions === 'object') {
                let accepted = 0, available = 0;
                for (const list of Object.values(r.missions)) {
                    for (const m of (Array.isArray(list) ? list : Object.values(list || {}))) {
                        const s = String((m && m.status) || '').toLowerCase();
                        if (s === 'accepted') accepted++;
                        else if (s === 'available' || s === 'not accepted') available++;
                    }
                }
                u.missions = { accepted, available };
            }
            if ('education_current' in r) {
                u.edu = { current: int(r.education_current), endsAt: int(r.education_timeleft) > 0 ? now + int(r.education_timeleft) * 1000 : 0,
                    completed: Array.isArray(r.education_completed) ? r.education_completed.map(Number) : [] };
            }
            if ('active_gym' in r) u.gymId = int(r.active_gym);
            const perkLists = ['faction_perks', 'job_perks', 'property_perks', 'education_perks', 'enhancer_perks', 'book_perks', 'stock_perks', 'merit_perks', 'company_perks'];
            if (perkLists.some((k) => Array.isArray(r[k]))) u.perks = perkLists.flatMap((k) => (Array.isArray(r[k]) ? r[k] : []));

            if (tier === 'limited') {
                if ('money_onhand' in r) {
                    const cb = r.city_bank || {};
                    u.wallet = num(r.money_onhand);
                    u.vault = num(r.vault_amount);
                    u.points = int(r.points);
                    u.cayman = num(r.cayman_bank);
                    u.bank = { amount: num(cb.amount), endsAt: int(cb.time_left) > 0 ? now + int(cb.time_left) * 1000 : 0 };
                }
                if ('strength' in r) {
                    const s = { str: num(r.strength), def: num(r.defense), spd: num(r.speed), dex: num(r.dexterity) };
                    s.total = num(r.total) || (s.str + s.def + s.spd + s.dex);
                    u.stats = s;
                }
                if (r.networth) u.networth = num(r.networth.total);
                if (r.stocks && typeof r.stocks === 'object') {
                    u.owned = {}; u.dividends = [];
                    for (const [k, s] of Object.entries(r.stocks)) {
                        if (!s) continue;
                        const id = int(s.stock_id) || int(k);
                        u.owned[id] = { shares: num(s.total_shares), block: !!(s.benefit || s.dividend) };
                        if (s.dividend && s.dividend.ready) u.dividends.push(id);
                    }
                }
                const ps = r.personalstats;
                if (ps && ('xantaken' in ps || 'exttaken' in ps)) u.drugsTaken = { xan: int(ps.xantaken), ecs: int(ps.exttaken) };
            } else {
                for (const f of ['wallet', 'vault', 'points', 'cayman', 'bank', 'stats', 'networth', 'owned', 'dividends', 'drugsTaken']) delete u[f];
            }
        }
        return d;
    }

    function maybeSnapshot(u) {
        if (!u || !u.stats) return;
        const snaps = GM_getValue(K.snaps, []) || [];
        const last = snaps[snaps.length - 1];
        if (last && Date.now() - last.t < SNAP_MS) return;
        snaps.push({ t: Date.now(), level: u.level || 0, ...u.stats, nw: u.networth || 0 });
        while (snaps.length > SNAP_MAX) snaps.shift();
        GM_setValue(K.snaps, snaps);
    }

    // ================================================================ alerts
    function notify(title, text, tag) {
        GM_notification({ title, text, image: ICON, tag, onclick: () => { try { window.focus(); } catch (e) { /* ignore */ } } });
    }

    function collectDue(d) {
        const a = getSettings().alerts;
        const n = GM_getValue(K.notified, {}) || {};
        const now = Date.now();
        const u = d.u || {};
        const out = [];

        for (const t of Object.keys(CD)) {
            const cfg = a[t], end = (u.cd && u.cd[t]) || 0;
            if (!cfg.on || !end) continue;
            const left = end - now;
            if (left > 0 && left <= cfg.lead * 60000 && !sameEnd(n[t + ':lead'], end)) out.push({ slot: t + ':lead', kind: 'cdLead', type: t, at: end });
            if (cfg.atEnd && left <= 0 && -left < END_WIN_MS && !sameEnd(n[t + ':end'], end)) out.push({ slot: t + ':end', kind: 'cdEnd', type: t, at: end });
        }
        for (const b of Object.keys(BARS)) {
            const cfg = a[b], bar = u[b];
            if (!cfg.on || !bar || !bar.fullAt) continue;
            const left = bar.fullAt - now;
            if (left > 0 && left <= cfg.lead * 60000 && !sameEnd(n[b + ':full'], bar.fullAt)) out.push({ slot: b + ':full', kind: 'barFull', type: b, at: bar.fullAt });
        }
        if (a.happy.on && u.happy && u.happy.cur > u.happy.max) {
            const at = nextQuarter(now);
            if (at - now <= a.happy.lead * 60000 && !sameEnd(n['happy:reset'], at)) out.push({ slot: 'happy:reset', kind: 'happyReset', at, cur: u.happy.cur, max: u.happy.max });
        }
        const rc = a.refills;
        if (rc.on && (rc.energy || rc.nerve) && u.refills) {
            const reset = nextResetAt(now), day = tornDay(now);
            if (reset - now <= rc.lead * 60000 && n.refills !== day && u.refills.day === day) {
                const unused = [];
                if (rc.energy && !u.refills.energy) unused.push('energy');
                if (rc.nerve && !u.refills.nerve) unused.push('nerve');
                out.push({ slot: 'refills', kind: 'refills', day, unused, at: reset });
            }
        }
        return out;
    }

    async function fireAlert(a) {
        await sleep(Math.random() * 1500); // so two open tabs don't both notify
        const n = GM_getValue(K.notified, {}) || {};
        if (a.kind === 'refills') {
            if (n.refills === a.day) return;
            n.refills = a.day;
        } else {
            if (sameEnd(n[a.slot], a.at)) return;
            n[a.slot] = a.at;
        }
        GM_setValue(K.notified, n);

        const mins = Math.max(1, Math.round((a.at - Date.now()) / 60000));
        const mm = `${mins} minute${mins === 1 ? '' : 's'}`;
        const tag = `tp-${a.slot}-${Math.round(a.at / 60000)}`;
        if (a.kind === 'cdLead') notify(`${CD[a.type].emoji} ${CD[a.type].label} cooldown ending soon`, `About ${mm} left (ends ${fmtClock(a.at)}).`, tag);
        else if (a.kind === 'cdEnd') notify(`${CD[a.type].emoji} ${CD[a.type].label} cooldown over`, `Your ${CD[a.type].label.toLowerCase()} cooldown has finished.`, tag);
        else if (a.kind === 'barFull') notify(`${BARS[a.type].emoji} ${BARS[a.type].label} almost full`, `${BARS[a.type].label} will be full in about ${mm} (${fmtClock(a.at)}). Spend it so regen isn't wasted.`, tag);
        else if (a.kind === 'happyReset') notify('😊 Boosted happy resets soon', `Happy ${fmtNum(a.cur)} drops back to ${fmtNum(a.max)} at ${fmtClock(a.at)} (in about ${mm}). Train now to use it.`, tag);
        else if (a.kind === 'refills' && a.unused.length) {
            const what = a.unused.length === 2 ? 'energy and nerve refills' : `${a.unused[0]} refill`;
            notify(`🔋 Unused ${what}`, `Torn's new day starts in about ${mm} (${fmtClock(a.at)} your time). Your ${what} ${a.unused.length === 2 ? 'have' : 'has'} not been used today.`, tag);
        }
    }

    let ticking = false;
    async function tick(force) {
        if (ticking) return;
        ticking = true;
        try {
            let d = GM_getValue(K.data, null);
            const now = Date.now();
            const slowAge = d ? now - (d.slowAt || 0) : Infinity;
            const wantSlow = !!force || !d || slowAge > SLOW_MS || (panelOpen() && slowAge > PANEL_SLOW_MS);
            if (force || !d || now - d.fetchedAt > FAST_MS || wantSlow) {
                d = (await fetchUser(wantSlow)) || GM_getValue(K.data, null);
            }
            if (!d) return;
            let due = collectDue(d);
            if (due.length && Date.now() - d.fetchedAt > FRESH_MS) {
                d = (await fetchUser(false)) || GM_getValue(K.data, null);
                if (!d || Date.now() - d.fetchedAt > STALE_MS) return;
                due = collectDue(d);
            }
            for (const a of due) await fireAlert(a);
            await fetchTorn(false);
            await fetchStocks(!!force);
            await fetchFactionMoney(!!force);
            await fetchUnlockedGyms(!!force);
            await fetchPointPrice(false);
            await fetchOC(!!force);
        } finally {
            ticking = false;
            renderAll(false);
        }
    }

    // ======================================================= gym calibration
    // Reads the result line on the gym page YOU are viewing (no clicks, no page requests), then makes
    // one API call for your fresh stats and works out how far the formula was off.
    const GAIN_RE = /You gained ([\d,]+(?:\.\d+)?)\s+(strength|speed|defen[cs]e|dexterity)/i;
    const STAT_FROM_WORD = { strength: 'str', speed: 'spd', defense: 'def', defence: 'def', dexterity: 'dex' };

    function startGymWatcher() {
        if (!/\/gym\.php/i.test(location.pathname)) return;
        let lastText = '', lastAt = 0;
        const check = (node) => {
            let el = node.nodeType === 1 ? node : node.parentElement;
            if (!el) return;
            let text = el.textContent || '';
            if (!GAIN_RE.test(text)) return;
            if (text.length > 600) { // find the smallest element holding the message
                const hit = [...el.querySelectorAll('*')].reverse().find((x) => GAIN_RE.test(x.textContent || '') && (x.textContent || '').length <= 600);
                if (!hit) return;
                el = hit; text = hit.textContent;
            }
            if (text === lastText && Date.now() - lastAt < 4000) return;
            lastText = text; lastAt = Date.now();
            const m = text.match(GAIN_RE);
            // Torn often splits the result over two lines, so look at the surrounding message too
            const parentText = el.parentElement && (el.parentElement.textContent || '').length <= 800 ? el.parentElement.textContent : text;
            const msgN = (parentText.match(/complete\s+(\d[\d,]*)/i) || parentText.match(/(\d[\d,]*)\s+(?:sets?|reps?|laps?|lifts?|times|rounds?)\b/i) || [])[1];
            onGymResult(STAT_FROM_WORD[m[2].toLowerCase()], parseFloat(m[1].replace(/,/g, '')), msgN ? parseInt(msgN.replace(/,/g, ''), 10) : 0);
        };
        new MutationObserver((muts) => {
            for (const mu of muts) {
                if (mu.type === 'characterData') check(mu.target);
                for (const n of mu.addedNodes) check(n);
            }
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    async function onGymResult(stat, gain, msgTrains) {
        if (!stat || !(gain > 0)) return;
        const prev = GM_getValue(K.data, null);
        if (!prev || !prev.u || prev.tier !== 'limited') return;
        await sleep(600); // let Torn finish saving the train
        const key = canCall(K.calibLock);
        if (!key) return;
        const res = await apiGet(v1Url(API_USER, ['battlestats', 'bars', 'gym', 'perks'], key));
        if (!res) return;
        if (res.err) { if (res.err.code !== 16) handleApiError(res.err); return; }
        const r = res.data;
        const after = num(r[STAT_FIELD[stat]]);
        if (!after || !r.happy || !r.energy) return;
        const u = prev.u;
        const gym = currentGym({ gymId: int(r.active_gym) || u.gymId }, GM_getValue(K.torn, null));
        if (!gym || !gym.e || !gym[stat]) return;

        // How many trains? Prefer the number in Torn's message, else the energy that was spent.
        let trains = msgTrains;
        if (!trains && u.energy && Date.now() - prev.fetchedAt < 5 * 60000) trains = Math.round((u.energy.cur - int(r.energy.current)) / gym.e);
        if (!(trains >= 1) || trains * gym.e > ENERGY_HARD_CAP + 150) return;

        const before = after - gain;
        const happyBefore = int(r.happy.current) + HAPPY_LOSS_PER_E * gym.e * trains;
        const perkMult = gymMultipliers(['faction_perks', 'job_perks', 'property_perks', 'education_perks', 'enhancer_perks', 'book_perks', 'company_perks'].flatMap((k) => (Array.isArray(r[k]) ? r[k] : [])));
        const predicted = simulate(stat, before, happyBefore, gym, trains * gym.e, perkMult[stat]).total;
        if (!(predicted > 0)) return;
        checkAndLearn(stat, gain, predicted, { gymName: gym.name, perkMult: perkMult[stat], trains, trainsGuessed: !msgTrains });

        // Refresh the panel straight away with the new numbers
        const d = GM_getValue(K.data, null);
        if (d && d.u) {
            const now = Date.now();
            const bar = (b) => ({ cur: int(b.current), max: int(b.maximum) || 1, fullAt: int(b.fulltime) > 0 ? now + int(b.fulltime) * 1000 : 0 });
            d.u.energy = bar(r.energy); d.u.happy = bar(r.happy);
            if (r.nerve) d.u.nerve = bar(r.nerve);
            if (d.u.stats) {
                for (const k of Object.keys(STAT_FIELD)) if (STAT_FIELD[k] in r) d.u.stats[k] = num(r[STAT_FIELD[k]]);
                d.u.stats.total = d.u.stats.str + d.u.stats.def + d.u.stats.spd + d.u.stats.dex;
            }
            d.u.gymId = int(r.active_gym) || d.u.gymId;
            d.fetchedAt = now;
            GM_setValue(K.data, d);
        }
        renderAll(true);
    }

    // ============================================================= training
    // Everything the Gym tab and the advice need about training, in one place.
    function trainingInfo(d) {
        const u = (d && d.u) || {};
        const s = getSettings();
        const torn = GM_getValue(K.torn, null);
        const gym = currentGym(u, torn);
        const perkMult = gymMultipliers(u.perks);
        const mult = {};
        for (const k of Object.keys(STATS)) mult[k] = perkMult[k] * calibFactor(k); // perks x your personal calibration
        const info = { gym, mult, perkMult, stat: null, perTrain: null, session: null, jump: null, specialists: specialistProgress(u.stats), ratio: u.stats ? ratioPlan(u, s, mult) : null };
        if (!gym || !u.stats || !u.happy) return info;
        info.stat = info.ratio && gym[info.ratio.pick.stat] > 0 ? info.ratio.pick.stat : pickStat(u, gym, s.focus);
        info.rows = Object.keys(STATS).map((k) => ({
            k, value: u.stats[k], dots: gym[k],
            perTrain: gym[k] ? gainPerTrain(k, u.stats[k], u.happy.cur, gym[k], gym.e, mult[k]) : 0,
            session: gym[k] && u.energy ? simulate(k, u.stats[k], u.happy.cur, gym, u.energy.cur, mult[k]).total : 0,
        }));
        if (info.stat) {
            const k = info.stat;
            info.perTrain = info.rows.find((r) => r.k === k).perTrain;
            info.session = u.energy ? simulate(k, u.stats[k], u.happy.cur, gym, u.energy.cur, mult[k]) : null;
            info.fullBar = u.energy ? simulate(k, u.stats[k], u.happy.cur, gym, Math.max(u.energy.max, gym.e), mult[k]) : null;
            if (u.energy && u.energy.cur < gym.e && u.energy.cur < u.energy.max) {
                const now = Date.now();
                const rate = u.energy.fullAt > now ? (u.energy.max - u.energy.cur) / (u.energy.fullAt - now) : 0;
                info.nextTrainAt = rate > 0 ? now + (gym.e - u.energy.cur) / rate : 0; // when you can afford one train
            }
            // Happy jump estimate: 1000 E at max happy vs after 5 Erotic DVDs + Ecstasy (doubles happy)
            const normal = simulate(k, u.stats[k], u.happy.max, gym, ENERGY_HARD_CAP, mult[k]);
            const jumpHappy = (u.happy.max + 5 * EDVD_HAPPY) * 2;
            const jumped = simulate(k, u.stats[k], jumpHappy, gym, ENERGY_HARD_CAP, mult[k]);
            info.jump = { normal: normal.total, jumped: jumped.total, happy: jumpHappy, ratio: normal.total ? jumped.total / normal.total : 0 };
            info.happy = happyPlan(u, info, s, torn);
        }
        return info;
    }

    // ============================================================ happy check
    // Finds the lowest happy that still gives `happyGoal`% of your best gains (at max happy),
    // decides whether waiting for regen is free (energy won't fill first), and prices boosts.
    function happyPlan(u, tr, s, torn) {
        if (!tr.stat || !u.happy || !u.energy || !tr.gym || !tr.gym.e) return null;
        const k = tr.stat, gym = tr.gym, S = u.stats[k], m = tr.mult[k];
        const now = Date.now();
        const g = (H) => gainPerTrain(k, S, H, gym[k], gym.e, m);
        const best = g(u.happy.max);
        if (!(best > 0)) return null;
        const goal = clamp(int(s.happyGoal) || 95, 50, 99) / 100;
        let lo = 0, hi = u.happy.max;
        while (hi - lo > 1) { const mid = (lo + hi) / 2; if (g(mid) >= goal * best) hi = mid; else lo = mid; }
        const target = Math.min(u.happy.max, Math.ceil(hi / 5) * 5);
        const cur = u.happy.cur;
        const ok = cur >= target;
        const pctNow = g(cur) / best;

        const rate = u.happy.fullAt > now && u.happy.max > cur ? (u.happy.max - cur) / (u.happy.fullAt - now) : HAPPY_REGEN_PER_MS;
        const readyAt = ok ? now : now + (target - cur) / rate;
        const over = u.energy.cur > u.energy.max;             // regen is paused above max
        const energyFullAt = u.energy.cur >= u.energy.max ? now : (u.energy.fullAt || Infinity);
        const canWait = !ok && !over && readyAt < energyFullAt;
        const trains = Math.floor(u.energy.cur / gym.e);

        // Boost options, only those your cooldowns allow right now. Each shows gain before -> after.
        const energyUse = Math.max(u.energy.max, gym.e); // a full bar of natural energy
        const session = (H) => simulate(k, S, H, gym, energyUse, m).total;
        const before = { perTrain: g(cur), session: session(cur) };
        const capMs = clamp(int(s.boosterCapH) || 24, 24, 48) * 3600000;
        const roomMin = u.cd ? (capMs - Math.max(0, (u.cd.booster || 0) - now)) / 60000 : 0;
        const drugFree = u.cd && u.cd.drug === 0;
        const ssl = sslBudget(u);
        const items = (torn && torn.boosters) || [];
        const want = ok ? Math.max(0, u.happy.max - cur) : target - cur; // reach the target, or top up to max
        const boosts = [];
        const add = (b) => {
            b.after = { perTrain: g(b.newHappy), session: session(b.newHappy) };
            b.extra = b.after.session - before.session;
            if (b.extra > 0) boosts.push(b);
        };
        // Candy: cheapest way to cover what you need, within your booster cooldown room
        if (want > 0) {
            let bestCandy = null;
            for (const c of items.filter((x) => x.kind === 'candy' && x.price > 0)) {
                const maxCount = Math.floor(roomMin / c.cdMin);
                if (maxCount < 1) continue;
                const count = Math.min(Math.ceil(want / c.happy), maxCount);
                const cost = count * c.price;
                const gained = count * c.happy;
                const covers = gained >= want;
                // Prefer fewer items: each extra item uses booster cooldown, so weight cost by 10% per extra item
                const score = cost * (1 + 0.1 * (count - 1));
                if (!bestCandy || (covers && !bestCandy.covers) || (covers === bestCandy.covers && (covers ? score < bestCandy.score : gained > bestCandy.gained))) {
                    bestCandy = { item: c, count, cost, gained, covers, score };
                }
            }
            if (bestCandy) {
                add({ verb: 'Eat', name: bestCandy.item.name, count: bestCandy.count, happy: bestCandy.gained, newHappy: cur + bestCandy.gained, cost: bestCandy.cost,
                    note: `Adds ${cdText(bestCandy.count * bestCandy.item.cdMin)} of booster cooldown${bestCandy.covers ? '' : '. As many as your booster limit allows'}` });
            }
        }
        for (const kind of ['edvd', 'fhc']) {
            const it = items.find((x) => x.kind === kind) || { name: kind === 'edvd' ? 'Erotic DVD' : 'Feathery Hotel Coupon', happy: kind === 'edvd' ? EDVD_HAPPY : FHC_HAPPY, cdMin: 360, price: 0 };
            if (roomMin >= it.cdMin) add({ verb: 'Use', name: it.name, count: 1, happy: it.happy, newHappy: cur + it.happy, cost: it.price, note: `Adds ${cdText(it.cdMin)} of booster cooldown` });
        }
        if (drugFree) {
            const ecs = (torn && torn.items && torn.items.find((x) => x.n === 'ecstasy')) || { v: 0 };
            add({ verb: 'Take', name: 'Ecstasy', count: 1, happy: cur, newHappy: cur * 2, cost: ecs.v,
                note: 'Doubles your happy. Uses your drug cooldown and can overdose' + (ssl && ssl.left > 0 && ssl.left <= 20 ? `. Counts toward your Sports Science Lab limit (${ssl.left} left)` : '') });
        }
        // Recommend the cheapest option that reaches the target (or, if happy is fine, the cheapest top-up)
        const reaching = boosts.filter((b) => b.newHappy >= (ok ? u.happy.max : target) && b.name !== 'Ecstasy');
        const pick = (reaching.length ? reaching : boosts.filter((b) => b.name !== 'Ecstasy'))
            .slice().sort((a, b) => (a.cost || Infinity) - (b.cost || Infinity))[0] || boosts[0] || null;
        return { stat: k, energyUse, target, cur, max: u.happy.max, ok, pctNow, best, readyAt, canWait, over, trains, boosts, pick, before, goal };
    }

    const cdText = (min) => (min < 60 ? `${Math.round(min)} minutes` : `${+(min / 60).toFixed(1)} hour${min === 60 ? '' : 's'}`);
    const boostLabel = (b) => `${b.verb} ${b.count > 1 ? b.count + '× ' : ''}${b.name}`;

    // ================================================================ advice
    function phaseOf(u) {
        const t = u.stats && u.stats.total;
        if (t != null) return t < 1e5 ? 0 : t < 1e7 ? 1 : t < 1e8 ? 2 : 3;
        const L = u.level || 1;
        return L < 15 ? 0 : L < 30 ? 1 : L < 60 ? 2 : 3;
    }

    function sslBudget(u) {
        if (!u.drugsTaken) return null;
        const used = u.drugsTaken.xan + u.drugsTaken.ecs;
        return { used, left: SSL_DRUG_LIMIT - used };
    }

    function buildAdvice(d) {
        const u = d.u || {};
        const s = getSettings();
        const now = Date.now();
        const ph = phaseOf(u);
        const tr = trainingInfo(d);
        const torn = GM_getValue(K.torn, null);
        const oc = GM_getValue(K.oc, null);
        const out = [];
        const add = (id, score, emoji, title, detail, link) => out.push({ id, score, emoji, title, detail, link });
        const pct = (b) => (b ? b.cur / b.max : 0);
        const hp = !s.jumping && u.happy && u.happy.cur <= u.happy.max ? tr.happy : null;
        const happyLow = !!(hp && !hp.ok && hp.trains >= 1);
        const trainHint = happyLow ? ' Your happy is low, so boost it first if you can.' : tr.stat ? ` Train ${STATS[tr.stat]} for about ${fmtNum(tr.perTrain)} per train.` : '';
        const stacking = u.energy && u.energy.cur > u.energy.max;

        // Energy
        if (u.energy) {
            if (stacking && s.jumping) {
                const room = ENERGY_HARD_CAP - u.energy.cur;
                add('stack', 60, '📦', `Stacking energy: ${u.energy.cur}/${ENERGY_HARD_CAP}`,
                    room >= XANAX_ENERGY ? `Room for ${Math.floor(room / XANAX_ENERGY)} more Xanax.` : 'Your stack is full. Boost your happy, then train.');
            } else if (stacking) {
                add('energyOver', 90, '🟢', 'Energy is over your max', `Energy doesn't regenerate until you're back under ${u.energy.max}.${trainHint}`, ['Go to gym', LINKS.gym]);
            } else if (pct(u.energy) >= 0.85 || (u.energy.fullAt && u.energy.fullAt - now < 30 * 60000)) {
                const full = u.energy.cur >= u.energy.max;
                add('energy', full ? 100 : 92, '🟢', full ? 'Energy is full — spend it' : 'Spend your energy',
                    (full ? 'New energy is being wasted.' : `Full at ${fmtClock(u.energy.fullAt)}.`) + trainHint, ['Go to gym', LINKS.gym]);
            } else if (pct(u.energy) >= 0.5 && tr.stat && !s.jumping && !happyLow) {
                add('gym', 65, '🏋️', `Train ${STATS[tr.stat]}`, `About ${fmtNum(tr.perTrain)} per train.`, ['Go to gym', LINKS.gym]);
            }
        }
        // Happy above max (boosted) — use it before the quarter-hour reset
        if (u.happy && u.happy.cur > u.happy.max) {
            const at = nextQuarter(now);
            add('happyBoost', 97, '😊', 'Train before your happy boost ends', `Happy drops back to ${fmtNum(u.happy.max)} at ${fmtClock(at)}.${trainHint}`, ['Go to gym', LINKS.gym]);
        } else if (happyLow && hp.canWait) {
            add('happyWait', 82, '😊', 'Wait before training', `Your happy would only give ${Math.floor(hp.pctNow * 100)}% of your best gains. It reaches ${fmtNum(hp.target)} at ${fmtClock(hp.readyAt)}, before your energy is full.`, ['Ways to boost', '#gym']);
        } else if (happyLow) {
            const p = hp.pick;
            add('happyLow', 93, '😊', p ? `${boostLabel(p)} before training` : 'Boost your happy before training',
                p ? `That takes happy from ${fmtNum(hp.cur)} to ${fmtNum(p.newHappy)}, and your gains from ${fmtNum(hp.before.session)} to ${fmtNum(p.after.session)} for a full energy bar${p.cost ? ` (about ${fmtMoney(p.cost)})` : ''}.`
                  : `Your happy would only give ${Math.floor(hp.pctNow * 100)}% of your best gains, and your energy fills before it recovers.`, ['See all options', '#gym']);
        }
        // Refills
        if (u.refills && u.refills.day === tornDay(now) && (!u.refills.energy || !u.refills.nerve)) {
            const left = nextResetAt(now) - now;
            const what = [!u.refills.energy && 'energy', !u.refills.nerve && 'nerve'].filter(Boolean).join(' & ');
            const tip = !u.refills.energy ? ' Best used when your energy is empty.' : '';
            add('refills', left < 3 * 3600000 ? 95 : 64, '🔋', `Unused ${what} refill`, `Resets in ${fmtDur(left)}.${tip}`, ['Points', LINKS.points]);
        }
        // Drugs
        const ssl = sslBudget(u);
        if (s.useXanax && u.cd && u.cd.drug === 0 && u.energy) {
            const after = u.energy.cur + XANAX_ENERGY;
            let detail = after <= ENERGY_HARD_CAP ? `A Xanax would take your energy to ${after}.` : `Spend some energy first. You can't hold more than ${ENERGY_HARD_CAP}.`;
            if (ssl && ssl.left > 0 && ssl.left <= 20) detail += ` ${ssl.left} more before you lose Sports Science Lab access.`;
            add('drug', after <= ENERGY_HARD_CAP ? 78 : 40, '💊', 'Drug cooldown is empty', detail, ['Items', LINKS.items]);
        } else if (s.alerts.drug.on && u.cd && u.cd.drug === 0) {
            add('drug', 60, '💊', 'Drug cooldown is empty', 'You can take a drug now.', ['Items', LINKS.items]);
        }
        // Boosters
        if (s.alerts.booster.on && u.cd) {
            const capMs = clamp(int(s.boosterCapH) || 24, 1, 48) * 3600000;
            const used = Math.max(0, (u.cd.booster || 0) - now);
            const room = capMs - used;
            if (room >= CAN_BOOSTER_H * 3600000) {
                const cans = Math.floor(room / (CAN_BOOSTER_H * 3600000));
                add('booster', used === 0 ? 58 : 46, '⚡', used === 0 ? 'Booster cooldown is empty' : 'You can use more boosters',
                    `About ${cans} energy drink${cans === 1 ? '' : 's'} would fit.`, ['Items', LINKS.items]);
            }
        }
        // Levelling, crimes
        if ((u.level || 99) < 15) add('xp', 88, '🎯', 'Attack and choose “Leave”', 'Leaving after a win gives the most experience while you are levelling.');
        if (u.nerve && pct(u.nerve) >= 0.7) {
            add('nerve', u.nerve.cur >= u.nerve.max ? 90 : 85, '🔴', 'Use your nerve on crimes',
                `Nerve is ${u.nerve.cur} of ${u.nerve.max}.`, ['Crimes', LINKS.crimes]);
        }
        // Organised crime (OC 2.0)
        if (u.factionId && oc && oc.state === 'none') add('oc', 74, '🕵️', 'Join an organised crime', 'You are not in one right now.', ['Faction', LINKS.faction]);
        // Money
        if (u.wallet != null && u.wallet > s.cashLimit) add('cash', 80, '💰', `Bank your ${fmtMoney(u.wallet)}`, 'Cash on hand can be mugged.', ['Bank', LINKS.bank]);
        if (u.dividends && u.dividends.length) {
            const names = u.dividends.map((id) => { const st = torn && torn.stocks.find((x) => x.id === id); return st ? st.acr : '#' + id; }).join(', ');
            add('dividend', 84, '💵', 'Collect your dividend', `${names} is ready. It can't be saved for later.`, ['Stocks', LINKS.stocks]);
        }
        if (u.bank) {
            const best = torn && Object.keys(torn.bank || {}).length ? Object.entries(torn.bank).sort((a, b) => b[1] - a[1])[0] : null;
            const TERMS = { '1w': '1 week', '2w': '2 weeks', '1m': '1 month', '2m': '2 months', '3m': '3 months' };
            const rateTxt = best ? ` Best rate: ${TERMS[best[0]] || best[0]} at ${best[1]}%.` : '';
            if (u.bank.amount > 0 && u.bank.endsAt && u.bank.endsAt - now < 24 * 3600000) add('bankEnd', 76, '🏦', 'Bank investment ending soon', `It ends in ${fmtDur(u.bank.endsAt - now)}.${rateTxt}`, ['Bank', LINKS.bank]);
            else if (u.bank.amount === 0 && ph >= 1 && cashAvailable(u).total > 1e6) add('bankStart', 72, '🏦', 'Invest your spare cash', `You have no bank investment running.${rateTxt}`, ['Bank', LINKS.bank]);
        }
        // Missions, education
        if (u.missions) {
            if (u.missions.accepted > 0) add('missions', 72, '📜', `Finish your mission${u.missions.accepted === 1 ? '' : 's'}`, `${u.missions.accepted} in progress.`, ['Missions', LINKS.missions]);
            else if (u.missions.available > 0) add('missionsNew', 62, '📜', 'Accept a new mission', 'A mission is waiting for you.', ['Missions', LINKS.missions]);
        }
        if (u.edu && u.edu.current === 0) {
            const allDone = torn && torn.eduIds && torn.eduIds.length && torn.eduIds.every((id) => u.edu.completed.includes(id));
            if (!allDone) {
                const left = torn && torn.eduIds ? torn.eduIds.filter((id) => !u.edu.completed.includes(id)).length : null;
                add('edu', 68, '🎓', 'Start an education course', left ? `${left} course${left === 1 ? '' : 's'} left to complete.` : 'Courses give permanent bonuses.');
            }
        }
        // Specialist gym milestones
        if (tr.specialists.length && ph >= 2) {
            const close = tr.specialists.filter((x) => x.lead >= 0.18 && x.lead < 0.25).sort((a, b) => b.lead - a.lead)[0];
            if (close) add('specialist', 52, '🏆', `Almost unlocked: ${close.gym}`, `You're ${Math.round(close.lead * 100)}% of the way. You need 25%.`);
        }
        if (ph === 0) add('starter', 48, '🧭', 'Get a job and a course', 'Both give you bonuses while you play.');
        const best = bestStock(d);
        if (best) add('stock', 45, '📈', `Consider buying ${best.acr}`, `Best return you can afford: ${best.yieldPct.toFixed(1)}% a year.`, ['Stocks', LINKS.stocks]);

        const warns = GM_getValue(K.calibWarn, {}) || {};
        for (const [k, w] of Object.entries(warns)) {
            if (!STATS[k] || now - w.at > 24 * 3600000) continue;
            add('calib_' + k, 75, '⚠️', `Gym estimate was ${Math.abs(w.err * 100).toFixed(1)}% off`,
                `Your last ${STATS[k].toLowerCase()} train gained ${fmtNum(w.actual)}, not ${fmtNum(w.expected)}. ${w.causes[0] || ''}`, ['Details', '#gym']);
        }
        const snooze = GM_getValue(K.snooze, {}) || {};
        return out.filter((x) => !(snooze[x.id] > now)).sort((a, b) => b.score - a.score);
    }

    function buildChecklist(d) {
        const u = d.u || {};
        const s = getSettings();
        const oc = GM_getValue(K.oc, null);
        const now = Date.now();
        const day = tornDay(now);
        const list = [];
        const add = (label, ok, note) => list.push({ label, ok, note });
        if (u.energy) add('Energy not full', u.energy.cur < u.energy.max || (s.jumping && u.energy.cur > u.energy.max), `${u.energy.cur}/${u.energy.max}`);
        if (u.nerve) add('Nerve not full', u.nerve.cur / u.nerve.max < 0.9, `${u.nerve.cur}/${u.nerve.max}`);
        if (u.refills && u.refills.day === day) {
            add('Energy refill used', u.refills.energy);
            add('Nerve refill used', u.refills.nerve);
        }
        if (u.cd && (s.alerts.drug.on || s.useXanax)) add('Drug cooldown running', u.cd.drug > now, u.cd.drug > now ? fmtDur(u.cd.drug - now) + ' left' : 'empty');
        if (u.cd && s.alerts.booster.on) add('Booster cooldown running', u.cd.booster > now, u.cd.booster > now ? fmtDur(u.cd.booster - now) + ' left' : 'empty');
        if (u.wallet != null) add('Cash banked', u.wallet <= s.cashLimit, fmtMoney(u.wallet));
        if (u.dividends) add('No dividends waiting', u.dividends.length === 0);
        if (u.factionId && oc && oc.state !== 'unsupported') add('In an organised crime', oc.state === 'in', oc.state === 'in' ? oc.status : '');
        if (u.missions) add('No accepted missions waiting', u.missions.accepted === 0);
        if (u.edu) {
            // TUCC: once every course is finished, show that instead of "course running"
            const tornEdu = GM_getValue(K.torn, null);
            const ids = (tornEdu && tornEdu.eduIds) || [];
            const allDone = u.edu.current === 0 && ids.length > 0 && ids.every((id) => u.edu.completed.includes(id));
            if (allDone) add('All education complete', true, `${ids.length} courses`);
            else add('Education course running', u.edu.current > 0, u.edu.endsAt ? 'ends in ' + fmtDur(u.edu.endsAt - now) : '');
        }
        if (u.bank) add('Bank investment running', u.bank.amount > 0, u.bank.amount > 0 ? fmtMoney(u.bank.amount) : '');
        return list;
    }

    function payoutOf(st, items) {
        const desc = st.desc;
        const money = desc.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)?/i);
        if (money) {
            let v = parseFloat(money[1].replace(/,/g, ''));
            const unit = (money[2] || '').toLowerCase();
            if (unit === 'k' || unit === 'thousand') v *= 1e3;
            else if (unit === 'm' || unit === 'million') v *= 1e6;
            else if (unit === 'b' || unit === 'billion') v *= 1e9;
            return { value: v, kind: 'cash' };
        }
        const qtyM = desc.match(/^(\d[\d,]*)\s*x\s+/i);
        const qty = qtyM ? parseInt(qtyM[1].replace(/,/g, ''), 10) : 1;
        const lower = desc.toLowerCase();
        const hit = items.find((it) => lower.indexOf(it.n) !== -1);
        return hit ? { value: hit.v * qty, kind: 'item', qty, unit: hit.v } : null;
    }

    function stockRows(d) {
        const torn = GM_getValue(K.torn, null);
        if (!torn || !torn.stocks.length) return null;
        const u = (d && d.u) || {};
        const spendable = cashAvailable(u).total; // invested bank money is locked, so it is never counted
        return torn.stocks.map((st) => {
            const cost = st.req * st.price;
            const p = payoutOf(st, torn.items);
            const own = u.owned && u.owned[st.id];
            const row = { ...st, cost, owned: !!(own && (own.block || own.shares >= st.req)), ready: !!(u.dividends && u.dividends.includes(st.id)),
                affordable: u.wallet != null ? spendable >= Math.max(0, st.req - (own ? own.shares : 0)) * st.price : null, payout: p ? p.value : 0, passive: !p,
                payKind: p ? p.kind : null, qty: p ? p.qty : 0, unit: p ? p.unit : 0, shares: own ? own.shares : 0, spendable };
            if (p && cost > 0) {
                row.yieldPct = ((p.value / row.freq) * 365 / cost) * 100;
                row.breakEven = cost / (p.value / row.freq);
            }
            return row;
        }).sort((a, b) => (b.yieldPct || -1) - (a.yieldPct || -1));
    }

    function bestStock(d) {
        const rows = stockRows(d);
        if (!rows || !d.u || d.u.wallet == null) return null;
        return rows.find((r) => !r.passive && !r.owned && r.affordable && r.yieldPct > 0) || null;
    }

    // ===================================================================== UI
    // The panel lives inside a Shadow DOM so Torn's own stylesheets can't override its colours or fonts.

    const ICONS = {
        today: '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><polyline points="3.5 6 4.5 7 6 5"/><polyline points="3.5 12 4.5 13 6 11"/><polyline points="3.5 18 4.5 19 6 17"/>',
        gym: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/>',
        progress: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
        stocks: '<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
        settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
        zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
        pulse: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
        smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
        pill: '<path d="M10.5 20.5a5 5 0 0 1-7-7l10-10a5 5 0 0 1 7 7z"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/>',
        heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>',
        battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><line x1="22" y1="11" x2="22" y2="13"/><polyline points="11 8.5 8.5 12 12 12 9.5 15.5"/>',
        cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/>',
        bank: '<line x1="3" y1="21" x2="21" y2="21"/><line x1="5" y1="18" x2="5" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="19" y1="18" x2="19" y2="11"/><polygon points="12 3 21 8 3 8"/>',
        file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
        book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
        award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
        shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
        target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
        box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
        refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
        close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
        moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
        check: '<polyline points="20 6 9 17 4 12"/>',
        dot: '<circle cx="12" cy="12" r="3.5"/>',
    };
    const ico = (n, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ICONS.dot}</svg>`;
    const ADVICE_ICON = {
        energy: 'zap', energyOver: 'zap', stack: 'box', gym: 'gym', happyBoost: 'smile', happy: 'smile', happyWait: 'smile', happyLow: 'smile', refills: 'battery',
        drug: 'pill', booster: 'zap', xp: 'target', nerve: 'pulse', oc: 'shield', cash: 'cash', dividend: 'cash',
        bankEnd: 'bank', bankStart: 'bank', missions: 'file', missionsNew: 'file', edu: 'book', specialist: 'award',
        vet: 'target', starter: 'today', stock: 'progress', calib_str: 'gym', calib_def: 'gym', calib_spd: 'gym', calib_dex: 'gym',
    };
    const toneOf = (score) => (score >= 90 ? 'urgent' : score >= 70 ? 'soon' : 'info');

    const CSS = `
:host{all:initial}
.tp{--font:-apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
 font:14px/1.5 var(--font);color:var(--ink);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;font-feature-settings:"tnum" 1}
.tp.theme-dark{--bg:#151c27;--surface:#1e2734;--raised:#273243;--ink:#eef2f7;--ink2:#c3ccd8;--muted:#93a0b2;--line:#33415a;
 --accent:#f2b544;--accent-ink:#231802;--accent-soft:rgba(242,181,68,.14);--blue:#7cb0ff;--green:#5fd07f;--green-soft:rgba(95,208,127,.14);
 --red:#ff7a70;--red-soft:rgba(255,122,112,.13);--amber:#f2b544;--amber-soft:rgba(242,181,68,.13);--blue-soft:rgba(124,176,255,.13);
 --energy:#4fc46e;--nerve:#f0574d;--happy:#f5c040;--track:#2c3748;--shadow:0 24px 60px rgba(2,6,14,.6);--scrim:rgba(5,9,16,.5)}
.tp.theme-light{--bg:#eef1f6;--surface:#ffffff;--raised:#f4f6fa;--ink:#16202f;--ink2:#36435a;--muted:#5f6c80;--line:#d7dde7;
 --accent:#b5700a;--accent-ink:#ffffff;--accent-soft:rgba(181,112,10,.1);--blue:#2157c0;--green:#1f8545;--green-soft:rgba(31,133,69,.1);
 --red:#c4362c;--red-soft:rgba(196,54,44,.09);--amber:#a36500;--amber-soft:rgba(163,101,0,.1);--blue-soft:rgba(33,87,192,.08);
 --energy:#2f9e4f;--nerve:#d23f35;--happy:#cf9300;--track:#e2e7ef;--shadow:0 24px 60px rgba(18,30,52,.25);--scrim:rgba(20,28,44,.28)}
.tp *{box-sizing:border-box}
.tp :where(button,input,select){font:inherit;color:inherit}
.tp .ic{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.tp :focus-visible{outline:2px solid var(--blue);outline-offset:2px}

.launch{position:fixed;bottom:88px;z-index:2147483000;width:48px;height:48px;border-radius:50%;border:0;cursor:pointer;
 background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;box-shadow:0 6px 18px rgba(0,0,0,.3);padding:0;transition:transform .15s ease}
.launch:hover{transform:translateY(-2px)}
.launch .ic{width:24px;height:24px;stroke-width:2.4}
.launch .badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;padding:0 6px;background:var(--red);
 color:#fff;font:700 11px/20px var(--font);text-align:center;box-shadow:0 0 0 2px var(--bg);display:none}
.launch.alert .badge{display:block}
.scrim{position:fixed;inset:0;z-index:2147483001;background:var(--scrim);opacity:0;pointer-events:none;transition:opacity .2s ease}
.tp.open .scrim{opacity:1;pointer-events:auto}
/* TUCC: Pulse opens as a window in the centre of the screen (was a side drawer) */
.drawer{position:fixed;top:50%;left:50%;z-index:2147483002;width:min(600px,94vw);height:min(820px,90vh);background:var(--bg);display:flex;flex-direction:column;
 border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:var(--shadow);transform:translate(-50%,-47%);opacity:0;
 transition:transform .2s cubic-bezier(.2,.8,.2,1),opacity .2s ease;visibility:hidden}
.tp.open .drawer{visibility:visible;transform:translate(-50%,-50%);opacity:1}
@media (max-width:600px){.drawer{width:100vw;height:100vh;border-radius:0;border:0}}
/* TUCC: "Open in sidebar" docks Pulse to the left edge; the page stays usable and it stays open across pages until you close it */
.tp.docked .scrim{display:none}
.tp.docked .drawer{top:0;left:0;right:auto;bottom:0;width:min(400px,100vw);height:100vh;transform:none;opacity:1;border-radius:0;border:0;border-right:1px solid var(--line)}
.iconbtn.dock.on{color:var(--accent);border-color:var(--accent)}
.tp.docked .bars{grid-template-columns:1fr}
.tp.docked .bar{grid-template-columns:52px 1fr auto;grid-template-areas:"lbl trk val"}
.tp.docked .tab{padding:7px 2px 6px;gap:4px;font-size:12px}

.head{background:var(--surface);border-bottom:1px solid var(--line);padding:16px 18px 14px}
.who{display:flex;align-items:flex-start;gap:10px}
.who .name{flex:1;min-width:0}
.who h2{margin:0;font-size:17px;line-height:1.25;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.who h2 small{font-size:13px;font-weight:500;color:var(--muted);margin-left:4px}
.who .sub{display:flex;align-items:center;gap:8px;margin-top:3px;font-size:13px;color:var(--ink2)}
.chip{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:11px;background:var(--accent-soft);color:var(--accent);font-size:12px;font-weight:650}
.iconbtn{width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--raised);color:var(--ink2);display:grid;place-items:center;cursor:pointer;padding:0}
.iconbtn:hover{color:var(--ink);border-color:var(--muted)}
.iconbtn.spin .ic{animation:tp-spin .9s linear infinite}
@keyframes tp-spin{to{transform:rotate(360deg)}}

.bars{display:grid;gap:9px;margin-top:14px}
.bar{display:grid;grid-template-columns:58px 1fr auto;align-items:center;gap:10px}
.bar .lbl{font-size:13px;font-weight:600;color:var(--ink2)}
.track{height:10px;border-radius:6px;background:var(--track);overflow:hidden}
.fill{height:100%;border-radius:6px;transition:width .5s ease}
.fill.over{background-image:repeating-linear-gradient(-45deg,rgba(255,255,255,.28) 0 5px,transparent 5px 10px)}
.bar .val{font-size:13px;font-weight:600;min-width:104px;text-align:right;white-space:nowrap}
.bar .val span{font-weight:500;color:var(--muted);margin-left:5px}

.timers{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.timer{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:12px;background:var(--raised);border:1px solid var(--line)}
.ring{position:relative;width:38px;height:38px;flex:none}
.ring svg{width:38px;height:38px;transform:rotate(-90deg)}
.ring circle{fill:none;stroke-width:4}
.ring .bg{stroke:var(--track)}
.ring .fg{stroke-linecap:round;transition:stroke-dashoffset .5s ease}
.ring .ic{position:absolute;inset:0;margin:auto;width:16px;height:16px}
.timer .t{min-width:0}
.timer .t b{display:block;font-size:14px;font-weight:700;line-height:1.2;white-space:nowrap}
.timer .t span{font-size:12px;color:var(--muted)}
.timer.ready .t b{color:var(--green)}
.daily{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:12px;font-size:12.5px;color:var(--ink2)}
.daily span{display:inline-flex;align-items:center;gap:5px}
.daily .ic{width:15px;height:15px}
.daily .ok{color:var(--green)}
.daily .no{color:var(--amber)}

.tabs{display:flex;background:var(--surface);border-bottom:1px solid var(--line);padding:0 8px}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 4px 8px;border:0;background:none;cursor:pointer;
 color:var(--muted);font-size:12px;font-weight:600;border-bottom:2.5px solid transparent;margin-bottom:-1px}
.tab:hover{color:var(--ink)}
.tab.active{color:var(--ink);border-bottom-color:var(--accent)}
.tab .ic{width:19px;height:19px}

/* TUCC: compact header, so the scrolling part below gets most of the window */
.head{padding:10px 14px 8px}
.who{align-items:center;gap:8px}
.who .name{display:flex;align-items:center;flex-wrap:wrap;gap:2px 10px}
.who h2{font-size:16px}
.who .sub{margin-top:0}
.iconbtn{width:30px;height:30px}
.bars{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px 14px;margin-top:8px}
.bar{grid-template-columns:auto 1fr;grid-template-areas:"lbl val" "trk trk";gap:3px 8px}
.bar .lbl{grid-area:lbl;font-size:12.5px}
.bar .track{grid-area:trk;height:7px}
.bar .val{grid-area:val;min-width:0;font-size:12.5px}
.bar .val span{margin-left:4px}
.timers{gap:6px;margin-top:8px}
.timer{padding:4px 8px;gap:7px;border-radius:10px}
.ring,.ring svg{width:26px;height:26px}
.ring .ic{width:12px;height:12px}
.timer .t{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.timer .t b{display:inline;font-size:13px}
.daily{margin-top:6px;gap:4px 12px;font-size:12px}
.daily .ic{width:13px;height:13px}
.tab{flex-direction:row;justify-content:center;gap:6px;padding:7px 4px 6px;font-size:12.5px}
.tab .ic{width:16px;height:16px}
.foot{padding:5px 14px}
@media (max-width:560px){.bars{grid-template-columns:1fr}.bar{grid-template-columns:58px 1fr auto;grid-template-areas:"lbl trk val"}.tab span{display:none}}
.body{flex:1;overflow-y:auto;padding:16px 16px 24px;overscroll-behavior:contain}
.h{margin:20px 2px 10px;font-size:14px;font-weight:700;color:var(--ink);display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.h:first-child{margin-top:0}
.h small{font-size:12.5px;font-weight:500;color:var(--muted)}
.note{font-size:12.5px;color:var(--muted);margin:8px 2px 0}
.note a,.body a{color:var(--blue);text-decoration:none}
.note a:hover,.body a:hover{text-decoration:underline}

.card{position:relative;display:flex;gap:12px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:13px 14px 13px 16px;margin-bottom:10px;overflow:hidden}
.card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--tone)}
.card.urgent{--tone:var(--red);--tone-soft:var(--red-soft)}
.card.soon{--tone:var(--amber);--tone-soft:var(--amber-soft)}
.card.info{--tone:var(--blue);--tone-soft:var(--blue-soft)}
.card .badge{width:36px;height:36px;border-radius:10px;background:var(--tone-soft);color:var(--tone);display:grid;place-items:center;flex:none}
.card .main{flex:1;min-width:0}
.card h3{margin:0 0 3px;font-size:14.5px;line-height:1.3;font-weight:700;color:var(--ink)}
.card p{margin:0;font-size:13px;line-height:1.5;color:var(--ink2)}
.card .row{display:flex;align-items:center;gap:8px;margin-top:10px}
.btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border-radius:9px;border:1px solid var(--line);background:var(--raised);
 color:var(--ink);font-size:13px;font-weight:600;cursor:pointer;text-decoration:none}
.btn:hover{border-color:var(--muted);text-decoration:none}
.body a.btn{color:var(--ink)}
.body a.btn.primary{color:var(--accent-ink)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn.primary:hover{filter:brightness(1.06)}
.dismiss{position:absolute;top:10px;right:10px;width:28px;height:28px;border-radius:8px;border:0;background:none;color:var(--muted);cursor:pointer;display:grid;place-items:center;padding:0}
.dismiss:hover{background:var(--raised);color:var(--ink)}
.dismiss .ic{width:15px;height:15px}
.card.has-x .main{padding-right:22px}

.empty{text-align:center;padding:36px 16px;color:var(--ink2)}
.empty .ic{width:30px;height:30px;color:var(--green);margin-bottom:8px}
.empty b{display:block;font-size:15px;color:var(--ink);margin-bottom:4px}

.meter{height:8px;border-radius:5px;background:var(--track);overflow:hidden}
.meter i{display:block;height:100%;border-radius:5px;background:var(--green)}
.meter i.warn{background:var(--amber)}
.checks{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.checks .top{padding:12px 14px;border-bottom:1px solid var(--line)}
.checks .top div:first-child{display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:8px}
.check{display:flex;align-items:center;gap:11px;padding:10px 14px;border-bottom:1px solid var(--line);font-size:13.5px}
.check:last-child{border-bottom:0}
.check .mark{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;flex:none}
.check.ok .mark{background:var(--green-soft);color:var(--green)}
.check.no .mark{background:var(--amber-soft);color:var(--amber)}
.check .mark .ic{width:13px;height:13px;stroke-width:3}
.check .l{flex:1;color:var(--ink)}
.check .n{color:var(--muted);font-size:12.5px;white-space:nowrap}

.panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
.panel h3{margin:0 0 6px;font-size:14.5px;font-weight:700;display:flex;align-items:center;gap:8px}
.panel h3 .ic{color:var(--accent)}
.panel p{margin:0;font-size:13px;color:var(--ink2);line-height:1.55}
.hero{display:flex;align-items:baseline;gap:8px;margin:6px 0 4px}
.hero b{font-size:30px;line-height:1.1;font-weight:800;letter-spacing:-.02em;color:var(--ink)}
.hero span{font-size:13px;color:var(--muted)}
.cal{font-size:12.5px!important;color:var(--muted)!important;margin:6px 0 0!important}
.hs.ok .ic{color:var(--green)}.hs.soon .ic{color:var(--amber)}.hs.bad .ic{color:var(--red)}
.nowgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.nowgrid>div{background:var(--raised);border-radius:10px;padding:10px 12px}
.nowgrid small{display:block;font-size:12px;font-weight:650;color:var(--muted);margin-bottom:2px}
.nowgrid b{display:block;font-size:17px;font-weight:750;color:var(--ink)}
.nowgrid span{display:block;font-size:12px;color:var(--ink2);line-height:1.4;margin-top:3px}
@media (max-width:380px){.nowgrid{grid-template-columns:1fr}}
.rec{margin-top:12px;padding:12px 14px;border-radius:12px;background:var(--green-soft);border:1px solid var(--green)}
.rec .rl{display:block;font-size:12px;font-weight:650;color:var(--green);margin-bottom:2px}
.rec b{font-size:15px;color:var(--ink)}
.rec p{margin:4px 0 0!important;color:var(--ink2)!important}
.rec p b{font-size:13px}
.boosts{margin-top:0}
.whatif{margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
.whatif label{font-size:13px;font-weight:650;color:var(--ink);display:block;margin-bottom:8px}
.wirow{display:flex;align-items:center;gap:10px}
.wirow input[type=range]{flex:1;accent-color:var(--accent);height:24px;cursor:pointer}
.wirow input[type=number]{width:92px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--raised);color:var(--ink);padding:0 10px;font-size:13.5px}
.wirow input[type=number]:focus{border-color:var(--blue);outline:none;box-shadow:0 0 0 3px var(--blue-soft)}
.wiout{margin-top:10px;display:grid;gap:4px;font-size:13px;color:var(--ink2)}
.wiout div{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.wiout span{flex:1;min-width:150px;color:var(--muted)}
.wiout b{font-size:15px;color:var(--ink)}
.wiout em{font-style:normal;font-size:12.5px;color:var(--muted)}
.wiout small{font-size:12px;color:var(--amber)}
.boost{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)}
.boost:last-child{border-bottom:0}
.boost b{font-size:13.5px;font-weight:650;color:var(--ink)}
.boost small{display:block;font-size:12px;color:var(--muted);line-height:1.4;margin-top:1px}
.boost .bv{text-align:right;white-space:nowrap}
.boost .bv b{font-size:13.5px}
.more{margin-bottom:10px}
.more summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:14px;font-size:14px;font-weight:650;color:var(--ink)}
.more summary::-webkit-details-marker{display:none}
.more summary span{font-size:12.5px;font-weight:500;color:var(--muted);display:flex;align-items:center;gap:8px}
.more summary span::after{content:'';width:7px;height:7px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg) translateY(-2px);transition:transform .15s}
.more[open] summary span::after{transform:rotate(-135deg) translateY(-1px)}
.more[open] summary{border-radius:14px 14px 0 0;border-bottom-color:transparent}
.more[open] .panel{border-top:0;border-radius:0 0 14px 14px;margin-top:-1px}
.cal.ok{color:var(--green)!important}
.calwarn{margin-top:10px;padding:11px 13px;border-radius:12px;background:var(--amber-soft);border:1px solid var(--amber)}
.calwarn b{font-size:13.5px;color:var(--ink)}
.calwarn p{margin:4px 0 8px!important;font-size:12.5px!important;color:var(--ink2)!important}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.compare div{background:var(--raised);border-radius:10px;padding:10px 12px}
.compare span{display:block;font-size:12px;color:var(--muted)}
.compare b{font-size:17px;font-weight:750}
.compare .win b{color:var(--green)}

table.t{width:100%;border-collapse:collapse;font-size:13px}
.t th{font-size:12px;font-weight:600;color:var(--muted);text-align:right;padding:0 8px 8px;border-bottom:1px solid var(--line)}
.t td{padding:9px 8px;text-align:right;border-bottom:1px solid var(--line);color:var(--ink)}
.t td:not(:first-child),.t th:not(:first-child){white-space:nowrap}
.t tr:last-child td{border-bottom:0}
.t th:first-child,.t td:first-child{text-align:left;padding-left:2px}
.t tr.pick td{font-weight:700}
.t tr.pick td:first-child{color:var(--accent)}
.ratio p{margin:6px 0;line-height:1.45}.ratio p.warn,.ratio .warn{color:var(--amber);font-weight:600}.ratio .t td small{max-width:120px}.t.rt th,.t.rt td{padding-left:4px;padding-right:4px}.t.rt td:last-child small,.t.rt td:last-child span{display:block;max-width:92px;margin-left:auto;white-space:normal}
.t td small{display:block;font-size:12px;color:var(--muted);max-width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:400}
.cashp .cl{display:block;font-size:13px;font-weight:650;color:var(--muted)}
.cashp .cv{display:block;font-size:28px;font-weight:800;letter-spacing:-.02em;color:var(--ink);margin:2px 0 4px}
.cashp p{margin:0;font-size:12.5px;color:var(--ink2)}
.cashp .ph{margin-top:4px;color:var(--muted)}
.linkbtn{background:none;border:0;padding:0;margin-top:6px;color:var(--blue);font-size:12.5px;font-weight:600;cursor:pointer}
.linkbtn:hover{text-decoration:underline}
.srow{cursor:pointer}
.srow:hover td{background:var(--raised)}
.srow td:first-child b::after{content:'';display:inline-block;width:6px;height:6px;margin:0 6px 2px 6px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(-45deg);transition:transform .15s}
.srow.open td:first-child b::after{transform:rotate(45deg)}
.srow.open td{border-bottom-color:transparent}
.bdrow td{padding:0 2px 12px!important;text-align:left!important}
.bd{background:var(--raised);border-radius:10px;padding:10px 12px;white-space:normal}
.step{display:grid;grid-template-columns:96px 1fr;gap:10px;padding:6px 0;border-bottom:1px dashed var(--line);font-size:12.5px}
.step:last-of-type{border-bottom:0}
.step>span{color:var(--muted);font-weight:600}
.step>div{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap}
.step em{font-style:normal;color:var(--ink2)}
.step b{color:var(--ink);font-weight:700;white-space:nowrap}
.bd .you{margin:8px 0 0;font-size:12.5px;color:var(--ink);line-height:1.5}
.bd .note{margin:6px 0 0}
.up{color:var(--green)!important}.down{color:var(--red)!important}
.tag{display:inline-block;font-size:11px;font-weight:650;padding:1px 7px;border-radius:6px;margin-left:6px;vertical-align:1px}
.tag.afford{background:var(--green-soft);color:var(--green)}.tag.own{background:var(--raised);color:var(--ink2);border:1px solid var(--line)}.tag.short{background:var(--amber-soft);color:var(--amber)}.tag.ready{background:var(--blue-soft);color:var(--blue)}

.spec{padding:10px 0;border-bottom:1px solid var(--line)}
.spec:last-child{border-bottom:0;padding-bottom:0}
.spec:first-child{padding-top:0}
.spec .top{display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:6px}
.spec .top b{font-weight:650}
.spec .top span{color:var(--muted);white-space:nowrap}
.spec .top span.done{color:var(--green);font-weight:650}
.spec small{display:block;color:var(--muted);font-size:12px;margin-top:5px}

.spark{width:100%;height:110px;display:block;color:var(--accent)}
.sparkmeta{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}

.banner{display:flex;gap:10px;align-items:flex-start;border-radius:12px;padding:11px 13px;margin-bottom:14px;font-size:13px;line-height:1.5;
 background:var(--amber-soft);color:var(--ink);border:1px solid var(--amber)}
.banner.err{background:var(--red-soft);border-color:var(--red)}
.banner .ic{color:var(--amber);margin-top:1px}
.banner.err .ic{color:var(--red)}

.form .group{background:var(--surface);border:1px solid var(--line);border-radius:14px;margin-bottom:12px;overflow:hidden}
.form .line{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 14px;border-bottom:1px solid var(--line);font-size:13.5px}
.form .line:last-child{border-bottom:0}
.form .line .grow{flex:1;min-width:120px;font-weight:600}
.form .line .grow small{display:block;font-weight:400;color:var(--muted);font-size:12px;line-height:1.35;margin-top:1px}
.form .line .grow > span{display:block}
.form label.grow{align-items:flex-start}
.form label.grow input[type=checkbox]{margin-top:2px}
.form .ctrls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-left:27px;width:100%}
.form .ctrls label{font-size:13px;color:var(--ink2)}
.form label{display:inline-flex;align-items:center;gap:7px;cursor:pointer}
.form input[type=checkbox]{width:17px;height:17px;accent-color:var(--accent);margin:0;cursor:pointer}
.form input[type=number],.form input[type=text],.form input[type=password],.form select{height:34px;border-radius:9px;border:1px solid var(--line);
 background:var(--raised);color:var(--ink);padding:0 10px;font-size:13.5px}
.form input[type=number]{width:72px}
.form input:focus,.form select:focus{border-color:var(--blue);outline:none;box-shadow:0 0 0 3px var(--blue-soft)}
.form .key{display:flex;gap:8px;padding:12px 14px}
.form .key input{flex:1;min-width:0}
.tos{width:100%;border-collapse:collapse;font-size:12.5px}
.tos th,.tos td{padding:8px 14px;border-top:1px solid var(--line);text-align:left;vertical-align:top}
.tos th{width:40%;color:var(--muted);font-weight:600}
.savebar{position:sticky;bottom:-24px;margin:6px -16px -24px;padding:12px 16px 16px;background:linear-gradient(transparent,var(--bg) 30%);display:flex;align-items:center;gap:10px;justify-content:flex-end}
.savebar .msg{flex:1;font-size:13px;font-weight:600}
.msg.ok{color:var(--green)}.msg.err{color:var(--red)}
.foot{display:flex;justify-content:space-between;padding:9px 16px;border-top:1px solid var(--line);background:var(--surface);font-size:12px;color:var(--muted)}
@media (prefers-reduced-motion:reduce){.tp *{transition:none!important;animation:none!important}}
`;

    const TABS = [['today', 'Today'], ['gym', 'Gym'], ['progress', 'Progress'], ['stocks', 'Stocks'], ['settings', 'Settings']];
    const RING_C = 2 * Math.PI * 16;

    let host = null, shadow = null, root = null;
    let activeTab = TABS.some((t) => t[0] === GM_getValue(K.tab, 'today')) ? GM_getValue(K.tab, 'today') : 'today';
    let lastRenderedStamp = 0;
    let secondTimer = null;
    let formMsg = null;

    const panelOpen = () => !!(root && root.classList.contains('open'));
    const $ = (sel) => (shadow ? shadow.querySelector(sel) : null);

    function buildRoot() {
        if (root) return;
        host = document.createElement('div');
        host.id = 'torn-pulse-host';
        document.body.appendChild(host);
        shadow = host.attachShadow({ mode: 'open' });
        const st = document.createElement('style');
        st.textContent = CSS;
        root = document.createElement('div');
        root.className = 'tp';
        root.innerHTML = `
<button class="launch" type="button" aria-label="Open Torn Pulse">${ico('pulse')}<span class="badge"></span></button>
<div class="scrim"></div>
<aside class="drawer" role="dialog" aria-label="Torn Pulse">
  <header class="head"></header>
  <nav class="tabs">${TABS.map(([id, l]) => `<button class="tab" data-tab="${id}" type="button">${ico(id)}<span>${l}</span></button>`).join('')}</nav>
  <div class="body"></div>
  <footer class="foot"><span class="updated"></span><span>Torn Pulse 2.11.0</span></footer>
</aside>`;
        shadow.append(st, root);
        applyLook();
        root.querySelector('.launch').addEventListener('click', () => (panelOpen() ? closePanel() : openPanel()));
        root.querySelector('.scrim').addEventListener('click', closePanel);
        root.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) switchTab(b.dataset.tab); });
        root.querySelector('.head').addEventListener('click', (e) => {
            if (e.target.closest('[data-act=refresh]')) manualRefresh();
            if (e.target.closest('[data-act=close]')) closePanel();
            if (e.target.closest('[data-act=dock]')) setDocked(!docked());
        });
        root.querySelector('.body').addEventListener('click', onBodyClick);
        root.querySelector('.body').addEventListener('input', onWhatIf);
        root.querySelector('.body').addEventListener('keydown', (e) => {
            const sr = e.target.closest && e.target.closest('[data-stock]');
            if (sr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleStock(sr); }
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen() && !docked()) closePanel(); });   // the sidebar only closes with its own ✕
        // Follow Torn's own dark-mode switch when the theme is set to "Match Torn" (UI only, no requests)
        new MutationObserver(() => applyLook()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    function applyLook() {
        if (!root) return;
        const s = getSettings();
        const dark = s.theme === 'dark' || (s.theme !== 'light' && document.body.classList.contains('dark-mode'));
        root.classList.toggle('theme-dark', dark);
        root.classList.toggle('theme-light', !dark);
        const side = s.side === 'right' ? 'right' : 'left';
        root.classList.toggle('side-left', side === 'left');
        root.classList.toggle('side-right', side === 'right');
        const l = root.querySelector('.launch');
        l.style.left = side === 'left' ? '14px' : '';
        l.style.right = side === 'right' ? '14px' : '';
    }

    function openPanel(tab) {
        buildRoot();
        if (tab) activeTab = tab;
        root.classList.add('open');
        renderAll(true);
        clearInterval(secondTimer);
        secondTimer = setInterval(() => renderHead(), 1000);
        const d = GM_getValue(K.data, null);
        if (!d || Date.now() - (d.slowAt || 0) > PANEL_SLOW_MS) tick(false);
    }

    const docked = () => !!GM_getValue(K.docked, false);
    function setDocked(on) {
        GM_setValue(K.docked, !!on);
        buildRoot();
        root.classList.toggle('docked', !!on);
        // Inside the TUCC tablet: ask TUCC to let go of the panel and close the tablet, so the sidebar sits on the page.
        if (on) { const host = root.getRootNode && root.getRootNode().host; if (host) host.dispatchEvent(new CustomEvent('tucc-release')); }
        if (!panelOpen()) openPanel(); else renderHead();
    }

    function closePanel() {
        if (!root) return;
        if (docked()) { GM_setValue(K.docked, false); root.classList.remove('docked'); }
        root.classList.remove('open');
        clearInterval(secondTimer);
        secondTimer = null;
    }

    function switchTab(id) {
        activeTab = id;
        GM_setValue(K.tab, id);
        renderAll(true);
        if (id === 'stocks') fetchStocks(false).then(() => { if (activeTab === 'stocks') renderBody(true); });
        $('.body').scrollTop = 0;
    }

    async function manualRefresh() {
        const btn = $('[data-act=refresh]');
        if (btn) btn.classList.add('spin');
        await tick(true);
        renderAll(true);
    }

    function renderAll(forceBody) {
        if (!root) return;
        updateLauncher();
        if (!panelOpen()) return;
        root.querySelectorAll('.tab').forEach((b) => {
            b.classList.toggle('active', b.dataset.tab === activeTab);
            b.setAttribute('aria-current', b.dataset.tab === activeTab ? 'page' : 'false');
        });
        renderHead();
        renderBody(forceBody);
    }

    function updateLauncher() {
        if (!root) return;
        const d = GM_getValue(K.data, null);
        const urgent = d ? buildAdvice(d).filter((a) => a.score >= 90).length : 0;
        const l = root.querySelector('.launch');
        l.classList.toggle('alert', urgent > 0);
        l.querySelector('.badge').textContent = urgent;
        l.title = urgent ? `Torn Pulse: ${urgent} thing${urgent === 1 ? '' : 's'} need attention` : 'Torn Pulse';
    }

    function barRow(label, b, color) {
        if (!b) return '';
        const over = b.cur > b.max;
        const w = clamp((b.cur / b.max) * 100, 0, 100);
        const note = over ? 'boosted' : b.cur >= b.max ? 'full' : b.fullAt ? 'full ' + fmtClock(b.fullAt) : '';
        return `<div class="bar"><span class="lbl">${label}</span><div class="track"><div class="fill${over ? ' over' : ''}" style="width:${w}%;background-color:${color}"></div></div>
<span class="val">${fmtBar(b.cur)} / ${fmtBar(b.max)}${note ? `<span>${esc(note)}</span>` : ''}</span></div>`;
    }

    function timerTile(label, icon, end, refMs, color) {
        const now = Date.now();
        const left = Math.max(0, end - now);
        const frac = left > 0 ? clamp(left / refMs, 0.03, 1) : 0;
        return `<div class="timer${left ? '' : ' ready'}">
<div class="ring"><svg viewBox="0 0 38 38"><circle class="bg" cx="19" cy="19" r="16"/><circle class="fg" cx="19" cy="19" r="16" stroke="${color}" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${(RING_C * (1 - frac)).toFixed(2)}"/></svg>${ico(icon)}</div>
<div class="t"><b>${left ? fmtDur(left) : 'Ready'}</b><span>${label}</span></div></div>`;
    }

    function renderHead() {
        if (!panelOpen()) return;
        const d = GM_getValue(K.data, null);
        const u = (d && d.u) || {};
        const s = getSettings();
        const now = Date.now();
        const head = $('.head');
        const spinning = head.querySelector('[data-act=refresh].spin') && ticking;
        const name = u.name ? `${esc(u.name)}<small>[${u.id || ''}]</small>` : 'Torn Pulse';
        const sub = u.level ? `<span>Level ${u.level}</span><span class="chip">${PHASES[phaseOf(u)]}</span>` : '<span>Add your API key in Settings to get started</span>';
        let html = `<div class="who"><div class="name"><h2>${name}</h2><div class="sub">${sub}</div></div>
<button class="iconbtn dock${docked() ? ' on' : ''}" data-act="dock" type="button" aria-label="${docked() ? 'Open as a window' : 'Open in sidebar'}" title="${docked() ? 'Open as a window' : 'Open in sidebar (stays open on every page until you close it)'}"><svg class="ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg></button>
<button class="iconbtn${spinning ? ' spin' : ''}" data-act="refresh" type="button" aria-label="Refresh now" title="Refresh now">${ico('refresh')}</button>
<button class="iconbtn" data-act="close" type="button" aria-label="Close" title="Close">${ico('close')}</button></div>`;
        if (u.energy) html += `<div class="bars">${barRow('Energy', u.energy, 'var(--energy)')}${barRow('Nerve', u.nerve, 'var(--nerve)')}${barRow('Happy', u.happy, 'var(--happy)')}</div>`;
        if (u.cd) {
            html += `<div class="timers">${timerTile('Drug', 'pill', u.cd.drug, 8 * 3600000, 'var(--blue)')}${timerTile('Booster', 'zap', u.cd.booster, clamp(int(s.boosterCapH) || 24, 24, 48) * 3600000, 'var(--accent)')}${timerTile('Medical', 'heart', u.cd.medical, 6 * 3600000, 'var(--red)')}</div>`;
        }
        const daily = [];
        if (u.refills && u.refills.day === tornDay(now)) {
            daily.push(`<span class="${u.refills.energy ? 'ok' : 'no'}">${ico(u.refills.energy ? 'check' : 'battery')}Energy refill ${u.refills.energy ? 'used' : 'unused'}</span>`);
            daily.push(`<span class="${u.refills.nerve ? 'ok' : 'no'}">${ico(u.refills.nerve ? 'check' : 'battery')}Nerve refill ${u.refills.nerve ? 'used' : 'unused'}</span>`);
        }
        if (u.happy && u.happy.cur > u.happy.max) daily.push(`<span class="no">${ico('smile')}Happy boost resets in ${fmtDur(nextQuarter(now) - now)}</span>`);
        daily.push(`<span>${ico('moon')}New day in ${fmtDur(nextResetAt(now) - now)}</span>`);
        html += `<div class="daily">${daily.join('')}</div>`;
        head.innerHTML = html;
        const foot = $('.updated');
        if (foot) foot.textContent = d ? `Updated ${Math.max(0, Math.round((now - d.fetchedAt) / 1000))}s ago` : 'Not connected yet';
    }

    function renderBody(force) {
        if (!panelOpen()) return;
        const d = GM_getValue(K.data, null);
        const tornNow = GM_getValue(K.torn, null);
        const stamp = (d ? d.fetchedAt : 0) + (tornNow && tornNow.stocksAt ? tornNow.stocksAt : 0);
        if (!force && (activeTab === 'settings' || stamp === lastRenderedStamp)) return;
        if (!force && activeTab === 'gym' && shadow && shadow.activeElement && /^tp-wi/.test(shadow.activeElement.id || '')) return;
        lastRenderedStamp = stamp;
        const body = $('.body');
        const top = body.scrollTop;
        const views = { today: viewToday, gym: viewGym, progress: viewProgress, stocks: viewStocks, settings: viewSettings };
        // TUCC: keep each drop-down (details) open or closed as you left it when the panel redraws.
        const openKey = (x) => activeTab + '|' + ((x.querySelector('summary') || {}).firstChild || { textContent: '' }).textContent.trim();
        body._tpOpen = body._tpOpen || new Map();
        body.querySelectorAll('details').forEach((x) => body._tpOpen.set(openKey(x), x.open));
        body.innerHTML = statusBanner(d) + (views[activeTab] || viewToday)(d);
        body.querySelectorAll('details').forEach((x) => { const k = openKey(x); if (body._tpOpen.has(k)) x.open = body._tpOpen.get(k); });
        body.scrollTop = top;
        if (activeTab === 'settings') {
            const inp = body.querySelector('#tp-key');
            if (inp) inp.value = GM_getValue(K.key, ''); // never put the key into HTML
        }
    }

    function banner(text, err) {
        return `<div class="banner${err ? ' err' : ''}">${ico(err ? 'close' : 'shield')}<div>${text}</div></div>`;
    }

    function statusBanner(d) {
        const st = getStatus();
        if (!GM_getValue(K.key, '')) return activeTab === 'settings' ? '' : banner('Add your Torn API key in <b>Settings</b> to get started.');
        if (st.error) return banner(esc(st.error), true);
        if (d && d.tier === 'minimal' && activeTab !== 'settings') {
            return banner('Some features need a <b>Limited</b> API key. You can change it in Settings.');
        }
        return '';
    }

    function viewToday(d) {
        if (!d) return `<div class="empty">${ico('refresh')}<b>Loading your data</b>This takes a few seconds.</div>`;
        const adv = buildAdvice(d);
        let html = '<div class="h">Do this now</div>';
        html += adv.length ? adv.map((a) => `
<div class="card ${toneOf(a.score)} has-x">
  <div class="badge">${ico(ADVICE_ICON[a.id] || 'dot')}</div>
  <div class="main"><h3>${esc(a.title)}</h3><p>${esc(a.detail)}</p>
  ${a.link ? `<div class="row">${a.link[1].charAt(0) === '#' ? `<button class="btn${a.score >= 90 ? ' primary' : ''}" data-goto="${a.link[1].slice(1)}" type="button">${esc(a.link[0])}</button>` : `<a class="btn${a.score >= 90 ? ' primary' : ''}" href="${a.link[1]}">${esc(a.link[0])}</a>`}</div>` : ''}</div>
  <button class="dismiss" data-snooze="${a.id}" type="button" aria-label="Hide until tomorrow" title="Hide until tomorrow">${ico('close')}</button>
</div>`).join('') : `<div class="empty">${ico('check')}<b>You're all caught up</b>Nothing needs doing right now.</div>`;

        const list = buildChecklist(d);
        if (list.length) {
            const done = list.filter((x) => x.ok).length;
            html += `<div class="h">Daily checklist<small>${done} of ${list.length} done</small></div><div class="checks">
<div class="top"><div class="meter"><i style="width:${(done / list.length) * 100}%"></i></div></div>` +
                list.map((x) => `<div class="check ${x.ok ? 'ok' : 'no'}"><span class="mark">${ico(x.ok ? 'check' : 'dot')}</span><span class="l">${esc(x.label)}</span><span class="n">${esc(x.note || '')}</span></div>`).join('') + '</div>';
        }
        return html;
    }

    function viewGym(d) {
        if (!d || d.tier !== 'limited') return `<div class="empty">${ico('gym')}<b>Gym advice needs a Limited key</b>It reads your battle stats to estimate gains.</div>`;
        const u = d.u;
        const s = getSettings();
        const tr = trainingInfo(d);
        lastTr = tr;
        if (!tr.gym) return `<div class="empty">${ico('refresh')}<b>Loading your gym</b>This appears after the next update.</div>`;
        let html = '';
        if (tr.stat) {
            html += `<div class="panel"><h3>${ico('gym')}Train ${STATS[tr.stat]}</h3>
<div class="hero"><b>${fmtNum(tr.perTrain)}</b><span>per train</span></div>
<p>At ${esc(tr.gym.name)}, ${tr.gym.e} energy per train.</p>${nowBlock(tr, u)}${calibLine(tr.stat)}</div>`;
        } else {
            html += `<div class="panel"><h3>${ico('gym')}${esc(tr.gym.name || 'Unknown gym')}</h3><p>There are no gym numbers for this gym yet.</p></div>`;
        }
        html += ratioPanel(tr, s);
        if (tr.happy) html += happyPanel(tr.happy);
        if (tr.rows) {
            html += `<div class="h">Your stats</div><div class="panel"><table class="t"><tr><th>Stat</th><th>Now</th><th>Gain per train</th></tr>` +
                tr.rows.map((r) => `<tr class="${r.k === tr.stat ? 'pick' : ''}"><td>${STATS[r.k]}</td><td>${fmtNum(r.value)}</td><td>${r.dots ? fmtNum(r.perTrain) : 'Not trained here'}</td></tr>`).join('') +
                `</table><p class="note">Your focus: ${esc(focusLabel(s.focus))}. Change it in Settings.</p></div>`;
        }
        if (tr.jump && tr.jump.normal) {
            html += `<details class="more"><summary>Is a happy jump worth it?<span>${tr.jump.ratio.toFixed(1)}× gains</span></summary><div class="panel">
<div class="compare"><div><span>1,000 energy, normal</span><b>${fmtNum(tr.jump.normal)}</b></div>
<div class="win"><span>1,000 energy, happy jump</span><b>${fmtNum(tr.jump.jumped)}</b></div></div>
<p class="note">A jump means boosting happy with 5 Erotic DVDs and Ecstasy before training. It's expensive and risks an overdose, so it's mainly worth it on lower stats.</p></div></details>`;
        }
        const ssl = sslBudget(u);
        if (ssl) {
            const warn = ssl.left <= 20;
            html += `<details class="more"${warn && ssl.left > 0 ? ' open' : ''}><summary>Sports Science Lab access<span>${ssl.left > 0 ? `${ssl.left} drugs left` : 'Not available'}</span></summary><div class="panel">` + (ssl.left > 0
                ? `<div class="meter"><i class="${warn ? 'warn' : ''}" style="width:${clamp((ssl.used / SSL_DRUG_LIMIT) * 100, 0, 100)}%"></i></div>
<p class="note">You can take ${ssl.left} more Xanax or Ecstasy in total and still use this gym.</p>`
                : `<p>You've taken more than ${SSL_DRUG_LIMIT} Xanax and Ecstasy, so this gym is closed to you.</p>`) + '</div></details>';
        }
        if (tr.specialists.length) {
            const allow = gymAllowed(), isOk = (x) => (allow ? allow(x.gym) : x.lead >= 0.25);
            const qualified = tr.specialists.filter(isOk).length;
            html += `<details class="more"><summary>Specialist gyms<span>${qualified} of ${tr.specialists.length} unlocked</span></summary><div class="panel">` + tr.specialists.map((x) => {
                const ok = isOk(x);
                return `<div class="spec"><div class="top"><b>${esc(x.gym)}</b><span class="${ok ? 'done' : ''}">${ok ? 'Unlocked' : `${Math.round(clamp(x.lead / 0.25, 0, 1) * 100)}%`}</span></div>
<div class="meter"><i class="${ok ? '' : 'warn'}" style="width:${clamp(x.lead / 0.25, 0, 1) * 100}%"></i></div><small>${esc(x.what)}</small></div>`;
            }).join('') + `<p class="note">Each needs your stat lead to reach 25%, plus the right gym already unlocked.${allow ? ' "Unlocked" comes from Torn\'s list of the gyms you can use.' : ''}</p></div></details>`;
        }
        return html;
    }

    function ratioPanel(tr, s) {
        const r = tr.ratio;
        if (!r) return `<p class="note">Want Baldr's or Hank's ratio? Pick one under Settings, Training. Torn Pulse then picks what to train next and guards your specialist gyms.</p>`;
        const st = r.status, k = r.pick.stat;
        const notHere = tr.gym && !(tr.gym[k] > 0);
        const fmtE = (e) => (e ? `${fmtNum(e)} E` : '–');
        const safeTxt = (x) => { const g = r.guard.safe[x]; return g.amt === Infinity ? '<small>no limit</small>' : `<span class="${r.blocked.includes(x) ? 'warn' : ''}">${r.blocked.includes(x) ? 'Stop' : fmtNum(g.amt)}</span><small>${esc(g.gym)}</small>`; };
        let html = `<div class="h">${esc(r.name.replace(/ \(.*\)$/, ''))}<small>grade ${st.grade}${s.warMode ? ' · war mode' : ''}</small></div><div class="panel ratio">
<p><b>Train ${STATS[k]} next:</b> ${esc(r.pick.why)}.${notHere ? ` Your current gym doesn't train it${r.best[k] ? `; ${esc(r.best[k].name)} does (${fmtDots(r.best[k][k])} dots)` : ''}.` : ''}</p>
<table class="t rt"><tr><th>Stat</th><th>Of target</th><th>To target</th><th>Safe</th></tr>` +
            Object.keys(STATS).map((x) => `<tr class="${x === k ? 'pick' : ''}"><td>${STATS[x]}<small>${r.best[x] ? `${esc(r.best[x].name)} · ${fmtDots(r.best[x][x])}` : ''}</small></td><td>${r.t[x] > 0 ? Math.round(st.rows[x].pct * 100) + '%' : '–'}<small>${r.t[x] > 0 ? fmtNum(st.rows[x].target) : ''}</small></td><td>${fmtE(r.energyTo[x])}</td><td>${safeTxt(x)}</td></tr>`).join('') + `</table>`;
        if (r.missing.length) html += `<p class="warn">Not qualifying yet for ${esc(r.missing.join(' and '))}, which this ratio is built around.</p>`;
        if (r.blocked.length) html += `<p class="warn">Careful: one more train of ${esc(r.blocked.map((x) => STATS[x]).join(' or '))} would cost you ${esc([...new Set(r.blocked.map((x) => r.guard.safe[x].gym))].join(' and '))}.</p>`;
        html += `<p class="note">"To target" is the energy needed in the best gym you ${gymAllowed() ? 'have unlocked (from Torn)' : 'qualify for'}, with your gym-gain perks (Steadfast included). "Safe" is how much more of that stat you can train before losing the gym named under it. Gyms show the best one for each stat you qualify for; Torn doesn't share which gyms you've unlocked, so check you have it. Ratio numbers for Baldr's and Hank's follow the community tools; check Baldr's guide on the forum.</p></div>`;
        return html;
    }

    // "Right now" (current energy and happy) next to a full bar of energy
    function nowBlock(tr, u) {
        if (!u.energy || !tr.session || !tr.fullBar) return '';
        const ses = tr.session, full = tr.fullBar;
        let nowHtml;
        if (ses.trains >= 1) {
            nowHtml = `<b>${fmtNum(ses.total)}</b><span>${ses.trains} train${ses.trains === 1 ? '' : 's'} from ${fmtBar(u.energy.cur)} energy at ${fmtBar(u.happy.cur)} happy. Happy afterwards: ${fmtBar(ses.happyAfter)}.</span>`;
        } else {
            const need = tr.gym.e - u.energy.cur;
            nowHtml = `<b>No train yet</b><span>You have ${fmtBar(u.energy.cur)} energy and need ${tr.gym.e}. ${tr.nextTrainAt ? `${need} more, ready at ${fmtClock(tr.nextTrainAt)}.` : `${need} more needed.`}</span>`;
        }
        return `<div class="nowgrid"><div><small>Right now</small>${nowHtml}</div>
<div><small>Full bar of ${fmtNum(Math.max(u.energy.max, tr.gym.e))} energy</small><b>${fmtNum(full.total)}</b><span>${full.trains} trains at ${fmtBar(u.happy.cur)} happy.</span></div></div>`;
    }

    function happyPanel(hp) {
        const pct = Math.floor(hp.pctNow * 100);
        let status, body;
        if (hp.ok) {
            const missing = Math.max(0, hp.best - hp.before.perTrain);
            const missPct = hp.before.perTrain > 0 ? (missing / hp.before.perTrain) * 100 : 0;
            if (hp.cur >= hp.max || missPct < 0.05) {
                status = `<h3 class="hs ok">${ico('smile')}Your happy is full</h3>`;
                body = '<p>You are getting your best possible gains.</p>';
            } else {
                status = `<h3 class="hs ok">${ico('smile')}Not worth waiting for full happy</h3>`;
                body = `<p>Full happy would add <b>+${fmtNum(missing)}</b> per train (${missPct < 1 ? missPct.toFixed(1) : Math.round(missPct)}%). Train when you're ready.</p>`;
            }
        } else if (hp.canWait) {
            status = `<h3 class="hs soon">${ico('smile')}Wait for more happy</h3>`;
            body = `<p>Right now you'd get ${pct}% of your best gains. Your happy reaches ${fmtNum(hp.target)} at <b>${fmtClock(hp.readyAt)}</b>, before your energy is full, so waiting costs nothing.</p>`;
        } else {
            status = `<h3 class="hs bad">${ico('smile')}Happy is too low</h3>`;
            body = `<p>Right now you'd get ${pct}% of your best gains, and your energy ${hp.over ? "doesn't regenerate while it's over your max" : 'fills before your happy recovers'}.</p>`;
        }
        const gainLine = (b) => `${fmtNum(hp.before.perTrain)} → <b>${fmtNum(b.after.perTrain)}</b> per train`;
        let html = `<div class="panel">${status}${body}`;
        const p = hp.pick;
        if (p && !hp.ok) {
            html += `<div class="rec"><span class="rl">Best option</span><b>${esc(boostLabel(p))}</b>
<p>Happy ${fmtNum(hp.cur)} → ${fmtNum(p.newHappy)}. Gains ${gainLine(p)}, or ${fmtNum(hp.before.session)} → <b>${fmtNum(p.after.session)}</b> for a full energy bar.${p.cost ? ` Costs about ${fmtMoney(p.cost)}.` : ''}</p></div>`;
        }
        const wiMax = Math.max(hp.max * 2, hp.cur + 3000);
        html += `<div class="whatif"><label for="tp-wi">Try a happy value</label>
<div class="wirow"><input type="range" id="tp-wi" min="0" max="${Math.ceil(wiMax / 100) * 100}" step="25" value="${hp.cur}" aria-label="Happy value">
<input type="number" id="tp-win" min="0" max="99999" step="25" value="${hp.cur}" aria-label="Happy value"></div>
<div class="wiout" id="tp-wiout">${whatIfText(hp.cur)}</div></div>`;
        html += '</div>';
        const others = hp.boosts.filter((b) => b !== p || hp.ok);
        if (others.length) {
            html += `<details class="more"${hp.ok ? '' : ' open'}><summary>${hp.ok ? 'Want more gains anyway?' : 'Other options'}<span>${others.length}</span></summary><div class="panel"><div class="boosts">` +
                others.map((b) => `<div class="boost"><div><b>${esc(boostLabel(b))}</b><small>Happy ${fmtNum(hp.cur)} → ${fmtNum(b.newHappy)}. Per train ${fmtNum(hp.before.perTrain)} → ${fmtNum(b.after.perTrain)}. ${esc(b.note)}.</small></div>
<div class="bv"><b class="up">+${fmtNum(b.extra)}</b>${b.cost ? `<small>${fmtMoney(b.cost)}</small>` : ''}</div></div>`).join('') +
                `</div><p class="note">Green numbers are the extra ${STATS[hp.stat].toLowerCase()} for a full bar of ${fmtNum(hp.energyUse)} energy. Boosted happy drops back to your max at the next quarter hour, so boost right before you train.</p></div></details>`;
        }
        return html;
    }

    // Live "what if" for any happy value, using the last Gym tab calculation
    let lastTr = null;
    function whatIfText(H) {
        const tr = lastTr, hp = tr && tr.happy;
        if (!hp) return '';
        const d = GM_getValue(K.data, null);
        const u = d && d.u;
        if (!u || !u.stats) return '';
        const k = hp.stat, gym = tr.gym, m = tr.mult[k];
        H = clamp(int(H), 0, 99999);
        const per = gainPerTrain(k, u.stats[k], H, gym[k], gym.e, m);
        const bar = simulate(k, u.stats[k], H, gym, hp.energyUse, m).total;
        const diff = per - hp.before.perTrain;
        const diffTxt = Math.abs(diff) < 0.5 ? 'same as now' : `${diff > 0 ? '+' : '−'}${fmtNum(Math.abs(diff))} vs now`;
        const reset = H > hp.max ? `<small>Above your max, so it drops back at the next quarter hour.</small>` : '';
        return `<div><span>At ${fmtNum(H)} happy</span><b>${fmtNum(per)}</b> per train <em class="${diff > 0.5 ? 'up' : diff < -0.5 ? 'down' : ''}">${diffTxt}</em></div>
<div><span>Full bar of ${fmtNum(hp.energyUse)} energy</span><b>${fmtNum(bar)}</b></div>${reset}`;
    }
    function onWhatIf(e) {
        const id = e.target && e.target.id;
        if (id !== 'tp-wi' && id !== 'tp-win') return;
        const v = clamp(int(e.target.value), 0, 99999);
        const range = $('#tp-wi'), box = $('#tp-win');
        if (id === 'tp-wi' && box) box.value = v;
        if (id === 'tp-win' && range) range.value = Math.min(v, +range.max);
        const out = $('#tp-wiout');
        if (out) out.innerHTML = whatIfText(v);
    }

    function calibLine(stat) {
        const c = getCalib()[stat];
        const w = (GM_getValue(K.calibWarn, {}) || {})[stat];
        let html = '';
        if (w && Date.now() - w.at < 24 * 3600000) {
            html += `<div class="calwarn"><b>Your last ${STATS[stat].toLowerCase()} train was ${Math.abs(w.err * 100).toFixed(1)}% ${w.err < 0 ? 'below' : 'above'} the estimate</b>
<p>Expected ${fmtNum(w.expected)}, you gained ${fmtNum(w.actual)}. ${esc(w.causes.join(' '))} ${w.learned ? 'The estimate has adjusted.' : "It looked like a one-off, so the estimate hasn't changed. If the next train is off the same way, it will adjust."}</p>
<button class="btn" data-act="resetCalib" data-stat="${stat}" type="button">Reset tuning</button></div>`;
        }
        if (!c || !c.n) return html + '<p class="cal">Gets more accurate after you train.</p>';
        const errs = c.errs || [];
        const avg = errs.length ? (errs.reduce((a, b) => a + b, 0) / errs.length) * 100 : null;
        return html + `<p class="cal ok">Tuned to your last ${Math.min(c.n, 10)} train${c.n === 1 ? '' : 's'}${avg !== null && errs.length >= 2 ? `. Usually within ${avg < 0.1 ? '0.1' : avg.toFixed(1)}%` : ''}.</p>`;
    }

    const FOCI = [['auto', 'Best stat for my gym'], ['balanced', 'Balanced: train my lowest stat'], ['defdex', 'Defense and dexterity (Balboas)'], ['strspd', 'Strength and speed (Frontline)'],
        ['str', 'Strength only'], ['def', 'Defense only'], ['spd', 'Speed only'], ['dex', 'Dexterity only']];
    const focusLabel = (f) => (FOCI.find((x) => x[0] === f) || FOCI[0])[1];

    function viewProgress(d) {
        const snaps = GM_getValue(K.snaps, []) || [];
        if (!d || d.tier !== 'limited') return `<div class="empty">${ico('progress')}<b>Progress needs a Limited key</b>It tracks your battle stats and networth.</div>`;
        if (snaps.length < 2) return `<div class="empty">${ico('progress')}<b>Tracking has started</b>A snapshot is saved every 6 hours. Check back tomorrow to see your gains.</div>`;
        const last = snaps[snaps.length - 1];
        const target = last.t - 7 * 86400000;
        let base = snaps[0];
        for (const s of snaps) if (s.t <= target) base = s;
        const days = Math.max(0.5, (last.t - base.t) / 86400000);
        const W = 320, H = 110, P = 6;
        const vals = snaps.map((s) => s.total);
        const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
        const t0 = snaps[0].t, t1 = last.t, tspan = t1 - t0 || 1;
        const pts = snaps.map((s) => [P + ((s.t - t0) / tspan) * (W - 2 * P), H - P - ((s.total - min) / span) * (H - 2 * P)]);
        const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
        const area = line + ` L${pts[pts.length - 1][0].toFixed(1)} ${H - P} L${pts[0][0].toFixed(1)} ${H - P} Z`;
        const totalDiff = last.total - base.total;
        let html = `<div class="panel"><h3>${ico('progress')}Total battle stats</h3>
<div class="hero"><b>${fmtNum(last.total)}</b><span class="${totalDiff >= 0 ? 'up' : 'down'}">${signed(totalDiff)} in ${days.toFixed(1)} days</span></div>
<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="tpg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
<path d="${area}" fill="url(#tpg)"/><path d="${line}" fill="none" stroke="currentColor" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>
<div class="sparkmeta"><span>${new Date(t0).toLocaleDateString()}</span><span>${new Date(t1).toLocaleDateString()}</span></div></div>`;
        const rows = [['Strength', 'str'], ['Defense', 'def'], ['Speed', 'spd'], ['Dexterity', 'dex'], ['Networth', 'nw'], ['Level', 'level']];
        html += `<div class="h">Change over ${days.toFixed(1)} days</div><div class="panel"><table class="t"><tr><th></th><th>Now</th><th>Change</th><th>Per day</th></tr>` +
            rows.map(([l, k]) => {
                const diff = (last[k] || 0) - (base[k] || 0);
                const f = k === 'nw' ? fmtMoney : fmtNum;
                return `<tr><td>${l}</td><td>${f(last[k] || 0)}</td><td class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${signed(diff, f)}</td><td>${signed(diff / days, f)}</td></tr>`;
            }).join('') + '</table></div>';
        return html;
    }

    const openStocks = new Set(); // breakdowns the player has opened stay open across refreshes

    function stockBreakdown(r) {
        const step = (label, math, result) => `<div class="step"><span>${label}</span><div><em>${math}</em><b>${result}</b></div></div>`;
        const yrs = (days) => (days >= 730 ? ` (${(days / 365).toFixed(1)} years)` : '');
        let html = step('Block cost', `${r.req.toLocaleString()} shares × ${fmtMoney(r.price)}`, fmtMoney(r.cost));
        if (!r.passive) {
            const pay = r.payKind === 'item'
                ? `${esc(r.desc)}, worth about ${fmtMoney(r.payout)} at today's market price`
                : esc(r.desc);
            html += step('Payout', `${pay}, every ${r.freq} days`, fmtMoney(r.payout));
            const perYear = (r.payout / r.freq) * 365;
            html += step('Per year', `${fmtMoney(r.payout)} × (365 ÷ ${r.freq})`, fmtMoney(perYear));
            html += step('Yearly return', `${fmtMoney(perYear)} ÷ ${fmtMoney(r.cost)}`, `${r.yieldPct.toFixed(1)}%`);
            html += step('Pays back in', `${fmtMoney(r.cost)} ÷ ${fmtMoney(r.payout)} × ${r.freq} days`, `${Math.round(r.breakEven).toLocaleString()} days${yrs(r.breakEven)}`);
        } else {
            html += step('Benefit', esc(r.desc), 'Perk only');
        }
        // Your position, short
        const lines = [];
        if (r.owned) lines.push('You own this.');
        else {
            const need = Math.max(0, r.req - r.shares);
            if (r.shares > 0) lines.push(`You hold ${Math.round(r.shares).toLocaleString()} of ${r.req.toLocaleString()} shares.`);
            if (r.affordable != null) {
                const needCost = need * r.price;
                lines.push(r.spendable >= needCost ? (r.shares > 0 ? `The rest costs ${fmtMoney(needCost)}. You can afford it.` : 'You can afford this.') : `You're ${fmtMoney(needCost - r.spendable)} short.`);
            }
        }
        if (!r.passive) lines.push(`<br>BB 2: ${(r.req * 2).toLocaleString()} more shares (${fmtMoney(r.cost * 2)}), ${(r.yieldPct / 2).toFixed(1)}% a year.`);
        html += `<p class="you">${lines.join(' ')}</p>`;
        html += `<p class="note">Doesn't include changes in share price${r.payKind === 'item' ? '. Item values use today\'s market price' : ''}.</p>`;
        return html;
    }

    function viewStocks(d) {
        if (!d || d.tier !== 'limited') return `<div class="empty">${ico('stocks')}<b>Stocks need a Limited key</b>It compares benefit blocks against your cash.</div>`;
        const rows = stockRows(d);
        if (!rows) return `<div class="empty">${ico('refresh')}<b>Loading stock prices</b>This appears after the next update.</div>`;
        const paying = rows.filter((r) => !r.passive);
        const passive = rows.filter((r) => r.passive);
        const torn = GM_getValue(K.torn, null);
        const cash = cashAvailable(d.u);
        const tag = (r) => (r.ready ? '<span class="tag ready">Collect</span>' : '') + (r.owned ? '<span class="tag own">Owned</span>' : r.affordable === false ? '<span class="tag short">Can\'t afford</span>' : r.affordable ? '<span class="tag afford">Can afford</span>' : '');
        const row = (r, cols) => {
            const open = openStocks.has(r.id);
            return `<tr class="srow${open ? ' open' : ''}" data-stock="${r.id}" tabindex="0" role="button" aria-expanded="${open}">
<td><b>${esc(r.acr)}</b>${tag(r)}<small title="${esc(r.desc)}">${esc(r.desc)}</small></td>${cols}</tr>
${open ? `<tr class="bdrow"><td colspan="3"><div class="bd">${stockBreakdown(r)}</div></td></tr>` : ''}`;
        };
        let html = `<div class="panel cashp"><span class="cl">Cash you can spend</span><b class="cv">${fmtMoney(cash.total)}</b>
<p>${cash.parts.map(([l, v]) => `${esc(l)} ${fmtMoney(v)}`).join(' + ')}${cash.notes.length ? `. ${esc(cash.notes.join(' '))}` : ''}</p>
${pointsHint(d.u)}
<button class="linkbtn" data-goto="settings" type="button">Change what's counted</button></div>`;
        html += `<div class="h">Stocks that pay out<small>tap one for the maths</small></div><div class="panel"><table class="t"><tr><th>Stock</th><th>Cost</th><th>Yearly return</th></tr>` +
            paying.map((r) => row(r, `<td>${fmtMoney(r.cost)}</td><td class="up">${r.yieldPct ? r.yieldPct.toFixed(1) + '%' : '–'}</td>`)).join('') + '</table></div>';
        if (passive.length) {
            html += `<div class="h">Stocks with other perks</div><div class="panel"><table class="t"><tr><th>Stock</th><th>Cost</th></tr>` +
                passive.map((r) => row(r, `<td>${fmtMoney(r.cost)}</td>`)).join('') + '</table></div>';
        }
        const age = torn && (torn.stocksAt || torn.fetchedAt) ? Math.max(0, Math.round((Date.now() - (torn.stocksAt || torn.fetchedAt)) / 1000)) : null;
        html += `<p class="note">Prices ${age === null ? 'loading' : age < 90 ? `updated ${age}s ago` : `updated ${fmtDur(age * 1000)} ago`}. Share prices change every minute. <a href="${LINKS.stocks}">Open the stock market</a></p>`;
        return html;
    }

    function viewSettings() {
        const s = getSettings();
        const a = s.alerts;
        const cdLine = (t, sub) => `<div class="line"><label class="grow"><input type="checkbox" data-f="${t}.on" ${a[t].on ? 'checked' : ''}><span>${CD[t].label} cooldown${sub ? `<small>${sub}</small>` : ''}</span></label>
<div class="ctrls"><label><input type="number" min="1" max="1440" data-f="${t}.lead" value="${int(a[t].lead)}"> minutes before it ends</label>
<label><input type="checkbox" data-f="${t}.atEnd" ${a[t].atEnd ? 'checked' : ''}> Also when it ends</label></div></div>`;
        const barLine = (b) => `<div class="line"><label class="grow"><input type="checkbox" data-f="${b}.on" ${a[b].on ? 'checked' : ''}><span>${BARS[b].label} almost full</span></label>
<div class="ctrls"><label><input type="number" min="1" max="600" data-f="${b}.lead" value="${int(a[b].lead)}"> minutes before full</label></div></div>`;
        return `<div class="form">
<div class="h">API key</div>
<div class="group"><div class="key"><input id="tp-key" type="password" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Paste your 16-character key" aria-label="API key">
<button class="btn" data-act="showKey" type="button">Show</button></div>
<div class="line" style="border-top:1px solid var(--line)"><span class="grow" style="font-weight:400;color:var(--ink2)">Use a <b>Limited</b> key for every feature. <a href="${LINKS.apiKeys}">Create a key</a></span></div>
<table class="tos">
<tr><th>Data storage</th><td>Only locally, in Tampermonkey on this device</td></tr>
<tr><th>Data sharing</th><td>Nobody</td></tr>
<tr><th>Purpose of use</th><td>Personal gain: reminders, training and progression advice for your own account</td></tr>
<tr><th>Key storage and sharing</th><td>Stored, used only for automation; sent only to api.torn.com</td></tr>
<tr><th>Key access level</th><td>Limited (Minimal works with fewer features)</td></tr>
</table></div>

<div class="h">Notifications</div>
<div class="group">
${cdLine('drug', '')}${cdLine('booster', '')}${cdLine('medical', '')}
${barLine('energy')}${barLine('nerve')}
<div class="line"><label class="grow"><input type="checkbox" data-f="happy.on" ${a.happy.on ? 'checked' : ''}><span>Happy boost ending<small>For happy jumps</small></span></label>
<div class="ctrls"><label><input type="number" min="1" max="14" data-f="happy.lead" value="${int(a.happy.lead)}"> minutes before</label></div></div>
<div class="line"><label class="grow"><input type="checkbox" data-f="refills.on" ${a.refills.on ? 'checked' : ''}><span>Unused refills<small>Before the new Torn day</small></span></label>
<div class="ctrls"><label><input type="number" min="1" max="720" data-f="refills.lead" value="${int(a.refills.lead)}"> minutes before</label>
<label><input type="checkbox" data-f="refills.energy" ${a.refills.energy ? 'checked' : ''}> Energy</label>
<label><input type="checkbox" data-f="refills.nerve" ${a.refills.nerve ? 'checked' : ''}> Nerve</label></div></div>
<div class="line"><span class="grow" style="font-weight:400;color:var(--ink2)">Not seeing notifications?</span><button class="btn" data-act="test" type="button">Send a test</button></div>
</div>

<div class="h">Training</div>
<div class="group">
<div class="line"><span class="grow">Training focus</span><select id="tp-focus">${FOCI.map(([v, l]) => `<option value="${v}" ${s.focus === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
<div class="line"><span class="grow">Stat ratio<small>Overrides the focus when set</small></span><select id="tp-ratio">${RATIOS.map(([v, l]) => `<option value="${v}" ${s.ratio === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
<div class="line"><span class="grow">Main stat (100)</span><select id="tp-rhigh">${Object.entries(STATS).map(([v, l]) => `<option value="${v}" ${s.ratioHigh === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
<div class="line"><span class="grow">Baldr's: second stat (80)</span><select id="tp-rsecond">${Object.entries(STATS).map(([v, l]) => `<option value="${v}" ${s.ratioSecond === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
<div class="line"><span class="grow">Hank's: low stat (28)</span><select id="tp-rlow">${Object.entries(STATS).map(([v, l]) => `<option value="${v}" ${s.ratioLow === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
<div class="line"><span class="grow">Custom ratio<small>Strength, Defense, Speed, Dexterity</small></span><span>${['str', 'def', 'spd', 'dex'].map((k) => `<input id="tp-rc-${k}" type="number" min="0" max="1000" style="width:58px" value="${int((s.ratioCustom || {})[k])}" aria-label="${STATS[k]}">`).join(' ')}</span></div>
<div class="line"><label class="grow"><input type="checkbox" id="tp-war" ${s.warMode ? 'checked' : ''}><span>War mode<small>Favour Defense and Dexterity when choosing what to train next</small></span></label></div>
<div class="line"><label class="grow"><input type="checkbox" id="tp-xanax" ${s.useXanax ? 'checked' : ''}><span>I use Xanax for energy</span></label></div>
<div class="line"><label class="grow"><input type="checkbox" id="tp-jump" ${s.jumping ? 'checked' : ''}><span>I'm saving energy for a happy jump</span></label></div>
<div class="line"><span class="grow">Flag gym estimates that are off by more than<small>Checked after every train with the gym page open</small></span><label><input id="tp-errlimit" type="number" min="1" max="50" value="${int(s.errLimit)}"> %</label></div>
<div class="line"><span class="grow">Advise waiting for happy<small>When gains would be below this share of your best</small></span><label><input id="tp-happygoal" type="number" min="50" max="99" value="${int(s.happyGoal)}"> %</label></div>
<div class="line"><span class="grow">Booster cooldown limit<small>Usually 24 hours</small></span><label><input id="tp-cap" type="number" min="24" max="48" value="${int(s.boosterCapH)}"> hours</label></div>
</div>

<div class="h">Display</div>
<div class="group">
<div class="line"><span class="grow">Theme</span><select id="tp-theme"><option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Match Torn</option><option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option></select></div>
<div class="line"><span class="grow">Panel side</span><select id="tp-side"><option value="left" ${s.side === 'left' ? 'selected' : ''}>Left</option><option value="right" ${s.side === 'right' ? 'selected' : ''}>Right</option></select></div>
<div class="line"><label class="grow"><input type="checkbox" id="tp-cashfac" ${s.cashFaction ? 'checked' : ''}><span>Count my faction balance as cash<small>Only if you can withdraw it yourself</small></span></label></div>
<div class="line"><label class="grow"><input type="checkbox" id="tp-cashcay" ${s.cashCayman ? 'checked' : ''}><span>Count my Cayman bank as cash<small>You have to fly there to withdraw it</small></span></label></div>
<div class="line"><label class="grow"><input type="checkbox" id="tp-cashpts" ${s.countPoints ? 'checked' : ''}><span>Count my points as cash<small>Valued at the cheapest points market price</small></span></label></div>
<div class="line"><span class="grow">Update stock prices</span><select id="tp-stockmode"><option value="always" ${s.stockMode !== 'viewing' ? 'selected' : ''}>Every minute</option><option value="viewing" ${s.stockMode === 'viewing' ? 'selected' : ''}>Every minute on the Stocks tab only</option></select></div>
<div class="line"><span class="grow">Remind me to bank cash over</span><label>$ <input id="tp-cash" type="number" min="0" step="1000" value="${int(s.cashLimit)}" style="width:116px"></label></div>
<div class="line"><span class="grow" style="font-weight:400;color:var(--ink2)">Hidden suggestions</span><button class="btn" data-act="resetSnooze" type="button">Show them again</button></div>
</div>
<div class="savebar"><span class="msg ${formMsg && formMsg.err ? 'err' : 'ok'}" id="tp-formmsg">${formMsg ? esc(formMsg.text) : ''}</span><button class="btn primary" data-act="save" type="button">Save settings</button></div>
</div>`;
    }

    function setFormMsg(text, err) {
        formMsg = { text, err };
        const el = $('#tp-formmsg');
        if (el) { el.textContent = text; el.className = 'msg ' + (err ? 'err' : 'ok'); }
        setTimeout(() => { if (formMsg && formMsg.text === text) { formMsg = null; const e2 = $('#tp-formmsg'); if (e2) e2.textContent = ''; } }, 5000);
    }

    function toggleStock(row) {
        const id = int(row.dataset.stock);
        if (openStocks.has(id)) openStocks.delete(id); else openStocks.add(id);
        renderBody(true);
        const again = $(`[data-stock="${id}"]`);
        if (again) again.focus({ preventScroll: true });
    }

    function onBodyClick(e) {
        const sr = e.target.closest('[data-stock]');
        if (sr && !e.target.closest('a')) { toggleStock(sr); return; }
        const go = e.target.closest('[data-goto]');
        if (go) { switchTab(go.dataset.goto); return; }
        const sn = e.target.closest('[data-snooze]');
        if (sn) {
            const snooze = GM_getValue(K.snooze, {}) || {};
            snooze[sn.dataset.snooze] = nextResetAt(Date.now());
            GM_setValue(K.snooze, snooze);
            renderBody(true);
            updateLauncher();
            return;
        }
        const act = e.target.closest('[data-act]');
        if (!act) return;
        const body = $('.body');
        switch (act.dataset.act) {
            case 'test':
                notify('Torn Pulse', 'Test notification: alerts are working.', 'tp-test');
                break;
            case 'showKey': {
                const inp = body.querySelector('#tp-key');
                inp.type = inp.type === 'password' ? 'text' : 'password';
                act.textContent = inp.type === 'password' ? 'Show' : 'Hide';
                break;
            }
            case 'save': {
                const key = body.querySelector('#tp-key').value.trim();
                if (key && !/^[A-Za-z0-9]{16}$/.test(key)) { setFormMsg('That isn\'t a valid key. Torn keys are 16 letters and numbers.', true); return; }
                const s = getSettings();
                body.querySelectorAll('[data-f]').forEach((inp) => {
                    const [grp, field] = inp.dataset.f.split('.');
                    if (inp.type === 'checkbox') s.alerts[grp][field] = inp.checked;
                    else s.alerts[grp][field] = clamp(int(inp.value) || DEFAULTS.alerts[grp][field], 1, +inp.max || 1440);
                });
                const focus = body.querySelector('#tp-focus').value;
                s.focus = FOCI.some((f) => f[0] === focus) ? focus : 'auto';
                const ratio = body.querySelector('#tp-ratio').value;
                s.ratio = RATIOS.some((r) => r[0] === ratio) ? ratio : 'off';
                for (const [id, f] of [['#tp-rhigh', 'ratioHigh'], ['#tp-rsecond', 'ratioSecond'], ['#tp-rlow', 'ratioLow']]) { const v = body.querySelector(id).value; if (STATS[v]) s[f] = v; }
                s.ratioCustom = {}; for (const k of ['str', 'def', 'spd', 'dex']) s.ratioCustom[k] = clamp(int(body.querySelector('#tp-rc-' + k).value), 0, 1000);
                s.warMode = body.querySelector('#tp-war').checked;
                s.useXanax = body.querySelector('#tp-xanax').checked;
                s.jumping = body.querySelector('#tp-jump').checked;
                s.boosterCapH = clamp(int(body.querySelector('#tp-cap').value) || 24, 24, 48);
                s.happyGoal = clamp(int(body.querySelector('#tp-happygoal').value) || 95, 50, 99);
                s.errLimit = clamp(int(body.querySelector('#tp-errlimit').value) || 5, 1, 50);
                s.theme = ['auto', 'light', 'dark'].includes(body.querySelector('#tp-theme').value) ? body.querySelector('#tp-theme').value : 'auto';
                s.side = body.querySelector('#tp-side').value === 'right' ? 'right' : 'left';
                s.cashLimit = int(body.querySelector('#tp-cash').value);
                s.stockMode = body.querySelector('#tp-stockmode').value === 'viewing' ? 'viewing' : 'always';
                const facWas = s.cashFaction;
                s.cashFaction = body.querySelector('#tp-cashfac').checked;
                s.cashCayman = body.querySelector('#tp-cashcay').checked;
                s.countPoints = body.querySelector('#tp-cashpts').checked;
                delete s.cashPoints;
                if (s.cashFaction && !facWas) setTimeout(() => fetchFactionMoney(true).then(() => renderAll(true)), 0);
                GM_setValue(K.settings, s);
                applyLook();
                updateLauncher();
                renderHead();
                if (key !== GM_getValue(K.key, '')) {
                    GM_setValue(K.key, key);
                    GM_setValue(K.data, null);
                    GM_setValue(K.oc, null);
                    setStatus({ keyBad: false, error: null, backoffUntil: 0 });
                    setFormMsg(key ? 'Saved. Connecting…' : 'Key removed.', false);
                    if (key) {
                        tick(true).then(() => {
                            const st = getStatus();
                            const nd = GM_getValue(K.data, null);
                            if (st.error) setFormMsg(st.error, true);
                            else if (nd) setFormMsg(nd.tier === 'minimal' ? 'Connected with a Minimal key' : 'Connected', false);
                            renderHead();
                        });
                    }
                } else {
                    setFormMsg('Settings saved', false);
                }
                break;
            }
            case 'resetCalib': {
                const st = act.dataset.stat;
                const all = getCalib(); delete all[st]; GM_setValue(K.calib, all);
                const w = GM_getValue(K.calibWarn, {}) || {}; delete w[st]; GM_setValue(K.calibWarn, w);
                renderAll(true);
                break;
            }
            case 'resetSnooze':
                GM_setValue(K.snooze, {});
                setFormMsg('Hidden suggestions are back', false);
                updateLauncher();
                break;
        }
    }

    // =================================================================== boot
    function boot() {
        buildRoot();
        GM_registerMenuCommand('Open Torn Pulse', () => openPanel());
        GM_registerMenuCommand('Torn Pulse settings', () => openPanel('settings'));
        GM_registerMenuCommand('Send test notification', () => notify('Torn Pulse', 'Test notification: alerts are working.', 'tp-test'));
        if (!GM_getValue(K.key, '') && !GM_getValue(K.intro, false)) {
            GM_setValue(K.intro, true);
            openPanel('settings');
        }
        if (docked()) { root.classList.add('docked'); openPanel(); }   // stays open across pages until you close it
        startGymWatcher();
        tick(false);
        // TUCC: no API checks while the tab is hidden; one check when you come back to it.
        setInterval(() => { if (!document.hidden) tick(false); }, TICK_MS);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(false); });
    }

    boot();
})();
