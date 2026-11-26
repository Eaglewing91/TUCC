// ==UserScript==
// @name         TUCC Combat Desk
// @namespace    eaglewing.torn.tucc.combatdesk
// @version      0.6.0
// @description  Attack page: one button that starts the fight, uses the right weapon for the turn and presses your finish option. One press = one action. Plans come from your own equipped weapons, their bonuses and mods, your perks, the effects on both fighters and the opponent's armour; modes pick the finishing weapon (War, Mug, Merc, Farm). Makes no requests to torn.com.
// @author       Eaglewing [571041]
// @match        https://www.torn.com/page.php?sid=attack&user2ID=*
// @match        https://www.torn.com/loader.php?sid=attack&user2ID=*
// @run-at       document-end
// @grant        none
// @license      GPL-3.0
// ==/UserScript==

/*
 * Compliance notes
 * - Makes no requests to torn.com and none to outside sites. It reads the attack page you are viewing: your weapon
 *   slots (bonuses, mods, damage, accuracy, ammo), both health values, the effect icons on both fighters, the action
 *   log, and the opponent's weapons and armour when the page shows them.
 * - Optional, Torn API only (api.torn.com, through TUCC's shared engine, key in the request header): user/perks and
 *   user/equipment once when the attack page opens, and torn/{ids}/items only to name armour pieces it hasn't seen
 *   before (saved, so each piece is looked up once). No calls from a hidden tab. Without a key it works from the page.
 * - Each real press of the Combat Desk button passes exactly ONE click to ONE of Torn's own controls on this page:
 *   Start fight, one of your weapons, or your finish option. Torn's page then sends its own normal request.
 *   Nothing is pressed on a timer, by an observer or on page load, and a press never leads to a second press.
 * - Synthetic (script-made) events are ignored: only trusted input counts. A held key never repeats an action.
 * - Torn's own Start fight button is hidden while Combat Desk is showing (visual only); the Combat Desk button presses it.
 *
 * Terms of Service
 *   Data Storage:          Only locally: settings, sequences, button position, armour piece names, and the weapons and
 *                          armour last seen on opponents you attacked (newest 150). Perks and weapon stats are kept in
 *                          memory for the page only.
 *   Data Sharing:          Nobody.
 *   Purpose of Use:        Competitive advantage - faster, better-planned manual attacking.
 *   Key Storage & Sharing: Stored locally in TUCC / sent only to api.torn.com.
 *   Key Access Level:      Optional. Minimal (perks and item names need Public, equipped weapon stats need Minimal).
 */

if (typeof tucc === 'undefined' || !tucc) return;
const { esc } = tucc;

/* ---------- Torn's own controls on the attack page ---------- */
const SLOTS = [
  { key: 'primary', label: 'Primary', short: 'P', sel: '#weapon_main[aria-describedby*="label_attacker_primary"]' },
  { key: 'secondary', label: 'Secondary', short: 'S', sel: '#weapon_second[aria-describedby*="label_attacker_secondary"]' },
  { key: 'melee', label: 'Melee', short: 'M', sel: '#weapon_melee[aria-describedby*="label_attacker_melee"]' },
  { key: 'temp', label: 'Temp', short: 'T', sel: '#weapon_temp[aria-describedby*="label_attacker_temporary"]' },
];
const SLOT = Object.fromEntries(SLOTS.map((s) => [s.key, s]));
const MAINS = ['primary', 'secondary', 'melee'];
const DIALOG = '[class^="dialogButtons"], [class*="dialogButtons"]';
const FINISH_RE = /\b(leave|mug|hosp)/i;

/* ---------- bonuses (names as Torn shows them; anything else on a weapon is a mod) ---------- */
const BONUS_NAMES = ['Achilles', 'Assassinate', 'Backstab', 'Berserk', 'Bleed', 'Blindfire', 'Blindside', 'Bloodlust', 'Burn', 'Comeback', 'Conserve', 'Cripple', 'Crusher', 'Cupid', 'Deadeye', 'Deadly', 'Demoralize', 'Disarm', 'Double-edged', 'Double Tap', 'Emasculate', 'Empower', 'Eviscerate', 'Execute', 'Expose', 'Finale', 'Focus', 'Freeze', 'Frenzy', 'Fury', 'Grace', 'Hazardous', 'Home Run', 'Irradiate', 'Lacerate', 'Motivation', 'Paralyze', 'Parry', 'Penetrate', 'Plunder', 'Poison', 'Powerful', 'Proficience', 'Puncture', 'Quicken', 'Rage', 'Revitalize', 'Roshambo', 'Shock', 'Sleep', 'Slow', 'Smash', 'Smurf', 'Specialist', 'Spray', 'Storage', 'Stricken', 'Stun', 'Suppress', 'Sure Shot', 'Throttle', 'Toxin', 'Warlord', 'Weaken', 'Wind-up', 'Wither'];
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const ALIAS = { demoralized: 'demoralize', poisoned: 'poison', laceration: 'lacerate', lacerated: 'lacerate', paralyzed: 'paralyze', severeburning: 'burn', burning: 'burn' };
const BONUS = Object.fromEntries(BONUS_NAMES.map((n) => [norm(n), n]));
const bonusId = (title) => { const n = norm(title); const a = ALIAS[n] || n; return BONUS[a] ? a : null; };
const DEBUFFS = ['weaken', 'wither', 'slow', 'cripple', 'eviscerate'];
const DOTS = ['poison', 'bleed', 'burn', 'lacerate'];   // damage over time: one application is enough, they don't stack
// Used when a weapon's own text doesn't give the total: % of the hit's damage dealt over the effect, and its length in turns.
const DOT_DEF = { poison: [950, 19], lacerate: [400, 9], bleed: [200, 9], burn: [70, 3] };
// How each effect shows up in icon names and log lines (word stems).
const FX = { poison: /poison/, bleed: /bleed/, burn: /burn/, lacerate: /lacerat/, weaken: /weaken/, wither: /wither/, slow: /slow/, cripple: /crippl/, eviscerate: /eviscerat/ };
const NEEDLES = { epinephrine: 'Epinephrine', melatonin: 'Melatonin', serotonin: 'Serotonin', tyrosine: 'Tyrosine' };
const NEEDLES_SHORT = { epinephrine: 'Epi', melatonin: 'Mel', serotonin: 'Ser', tyrosine: 'Tyr' };
const needleOf = (name) => Object.keys(NEEDLES).find((k) => new RegExp(k, 'i').test(name || '')) || null;
const MODES = {
  normal: { label: 'Normal', bonus: [] },
  warfarm: { label: 'War Farm', bonus: ['warlord'], finish: 'leave' },
  warpush: { label: 'War Push', bonus: ['warlord'], finish: 'hosp' },
  mug: { label: 'Mug', bonus: ['plunder'], finish: 'mug' },
  merc: { label: 'Merc', bonus: ['stricken'], finish: 'hosp' },
  farm: { label: 'Farm', bonus: ['revitalize', 'proficience'], finish: 'leave' },
};

/* ---------- settings ---------- */
const DEF = {
  mode: 'normal', sticky: true, plan: 'smart', main: 'best', dock: 'fight', fallback: 'best',
  tempFirst: true, assFirst: true, execute: true, reload: true, finish: 'leave', warFinish: 'leave', finishAt: 15,
  side: 'right', locked: false, open: true, pos: null,
  seqs: [{ name: 'Seq 1', steps: [] }, { name: 'Seq 2', steps: [] }, { name: 'Seq 3', steps: [] }],
};
const S = Object.assign({}, DEF, GM_getValue('settings', {}) || {});
if (!Array.isArray(S.seqs) || S.seqs.length !== 3) S.seqs = JSON.parse(JSON.stringify(DEF.seqs));
if (S.plan === 'auto') S.plan = 'smart';
if (S.mode === 'war') S.mode = S.warFinish === 'hosp' ? 'warpush' : 'warfarm';
const save = () => GM_setValue('settings', S);

/* ---------- reading the page ---------- */
// "90% chance to Poison opponent causing 950% damage over 19 turns" -> chance 90, total 950, turns 19
function dotOf(id, desc, value) {
  if (!DOTS.includes(id)) return null;
  const m = /(\d+(?:\.\d+)?)\s*%\s*damage\s+over\s+(\d+)\s+turn/i.exec(desc || '');
  const c = /(\d+(?:\.\d+)?)\s*%\s*chance/i.exec(desc || '');
  return { chance: c ? Number(c[1]) : value || 100, total: m ? Number(m[1]) : DOT_DEF[id][0], turns: m ? Number(m[2]) : DOT_DEF[id][1] };
}
function readBonuses(el) {
  const bonuses = [], mods = [], seen = {};
  const scope = el.closest('[class*="weaponWrapper"]') || el;
  for (const n of scope.querySelectorAll('[data-bonus-attachment-title], i[class*="bonus-attachment-"]')) {
    const title = (n.getAttribute('data-bonus-attachment-title') || n.getAttribute('title') || '').trim();
    const desc = n.getAttribute('data-bonus-attachment-description') || '';
    if (!title || /blank/i.test(String(n.className || ''))) continue;
    const id = bonusId(title);
    if (!id) { if (!mods.some((x) => x.name === title)) mods.push({ name: title, desc }); continue; }
    if (seen[id]) continue;
    const m = /(\d+(?:\.\d+)?)\s*%/.exec(desc) || /(\d+)\s*turn/i.exec(desc);
    seen[id] = 1;
    const value = m ? Number(m[1]) : null;
    bonuses.push({ id, name: BONUS[id], value, unit: m && /turn/i.test(m[0]) ? ' turns' : '%', dot: dotOf(id, desc, value) });
  }
  return { bonuses, mods };
}
// "30/30 (2)" = rounds in the clip / clip size (spare clips). A single number is a count (temporaries). No digits = no limit.
function parseAmmo(t) {
  const s = String(t || '').trim();
  let m = /(\d+)\s*\/\s*(\d+)(?:\s*\((\d+)\))?/.exec(s);
  if (m) return { clip: Number(m[1]), size: Number(m[2]), clips: m[3] != null ? Number(m[3]) : 0 };
  if (/no ammo/i.test(s)) return { clip: 0, size: 0, clips: 0, none: true };
  m = /^(\d+)$/.exec(s);
  return m ? { count: Number(m[1]) } : null;
}
function readWeapons() {
  const w = {};
  for (const s of SLOTS) {
    const el = document.querySelector(s.sel);
    const free = !!el && !/emptySlot/i.test(String(el.className || '')) && el.getAttribute('aria-disabled') !== 'true';
    const num = (q) => { const n = el && el.querySelector(q); const v = n ? parseFloat((n.textContent || '').replace(/,/g, '')) : NaN; return v > 0 ? v : null; };
    const ammoText = el ? ((el.querySelector('[class*="bottomMarker"]') || {}).textContent || '').trim() : '';
    const ammo = parseAmmo(ammoText), b = el ? readBonuses(el) : { bonuses: [], mods: [] };
    const name = el ? (el.getAttribute('aria-label') || '').replace(/^Attack with\s*/i, '').trim() : '';
    w[s.key] = { el, name, ammo, ammoText, usable: free && !(ammo && (ammo.none || (ammo.clip === 0 && ammo.clips === 0) || ammo.count === 0)),
      damage: num('[id^="damage-value_attacker"]'), accuracy: num('span[id^="accuracy_attacker"], [id^="accuracy-value_attacker"]'),
      bonuses: b.bonuses, mods: b.mods, needle: s.key === 'temp' ? needleOf(name) : null };
  }
  return w;
}
const hp = (el) => { const m = /([\d,]+)\s*\/\s*([\d,]+)/.exec(el.textContent || ''); if (!m) return null; const cur = Number(m[1].replace(/,/g, '')), max = Number(m[2].replace(/,/g, '')); return max > 0 ? { cur, max } : null; };
const players = () => { let me = null, opp = null; for (const b of document.querySelectorAll('#attack-root [class*="player___"]')) { if (b.querySelector('[aria-describedby*="label_attacker_"]')) me = me || b; else opp = opp || b; } return { me, opp }; };
function boxHealth(box) {
  if (!box) return null;
  const sum = box.querySelector('[id$="-summary"]'), m = sum && /health\s+([\d,]+)\s+of\s+([\d,]+)/i.exec(sum.textContent || '');
  if (m) { const cur = Number(m[1].replace(/,/g, '')), max = Number(m[2].replace(/,/g, '')); if (max > 0) return { cur, max }; }
  const ic = box.querySelector('[class*="iconHealth"]'), sp = ic && ic.parentElement && ic.parentElement.querySelector('span');
  return sp ? hp(sp) : null;
}
function readHealth() { const p = players(); return { me: boxHealth(p.me), opp: boxHealth(p.opp) }; }
// Effects showing on a fighter (Torn's status icons): how many of each. Reads names from the icons, whatever their layout.
function boxEffects(box) {
  const out = {};
  if (!box) return out;
  for (const n of box.querySelectorAll('[class*="iconsWrap"] *, [class*="effectsWrap"] *')) {
    if (n.children.length) continue;
    let s = String(n.className && n.className.baseVal != null ? n.className.baseVal : n.className || '') + ' ' + (n.getAttribute('title') || '') + ' ' + (n.getAttribute('aria-label') || '');
    for (const a of n.attributes) if (/^data-/.test(a.name)) s += ' ' + a.value;
    s = s.toLowerCase();
    const m = /(?:^|x\s*)(\d)$/.exec((n.textContent || '').trim());
    for (const id in FX) if (FX[id].test(s)) out[id] = Math.max((out[id] || 0) + 1, m ? Number(m[1]) : 0);
  }
  return out;
}
function readLog() {
  const out = [];
  for (const li of document.querySelectorAll('ul[aria-describedby="log-header"] > li')) { const t = (li.textContent || '').replace(/\s+/g, ' ').trim(); if (t) out.push(t); }
  return out;
}
const nameOf = (box) => { const n = box && box.querySelector('[id$="-name"], [class*="userName"]'); return n ? (n.textContent || '').trim() : ''; };
// The opponent's weapons and armour, when the page shows them (Torn's own display, or anything else drawn in their panel).
function readOpp() {
  const box = players().opp, o = { id: (/user2ID=(\d+)/.exec(location.search) || [])[1] || '', name: nameOf(box), weapons: [], armour: [], ids: [] };
  if (!box) return o;
  for (const el of box.querySelectorAll('[aria-describedby*="label_defender_"]')) { const n = (el.getAttribute('aria-label') || '').replace(/^Attack with\s*/i, '').trim(); if (n && !/not available/i.test(n) && !/fists|kick/i.test(el.getAttribute('aria-describedby'))) o.weapons.push(n); }
  for (const a of box.querySelectorAll('map area[title]')) { const t = a.getAttribute('title').trim(); if (t && !o.armour.includes(t)) o.armour.push(t); }
  for (const img of box.querySelectorAll('img[src*="/user_model/items/"]')) { const m = /\/user_model\/items\/(\d+)/.exec(img.getAttribute('src') || ''); if (m && !o.ids.includes(Number(m[1]))) o.ids.push(Number(m[1])); }
  return o;
}
function findStart(any) {
  for (const box of document.querySelectorAll(DIALOG)) for (const b of box.querySelectorAll(':scope > button')) if (/start\s*fight/i.test((b.textContent || '').trim()) && (any || !b.disabled)) return b;
  return null;
}
function findFinish(word) {
  for (const box of document.querySelectorAll(DIALOG)) {
    const btns = Array.from(box.querySelectorAll(':scope > button'));
    if (btns.filter((b) => FINISH_RE.test((b.textContent || '').trim())).length < 2) continue;
    return btns.find((b) => (b.textContent || '').trim().toLowerCase().includes(word)) || 'unknown';
  }
  return null;
}

/* ---------- perks, mods and weapon stats (pure) ---------- */
const TYPES = [['heavyartillery', /heavy artillery/], ['smg', /sub-?machine gun|\bsmgs?\b/], ['machinegun', /machine gun/], ['shotgun', /shotgun/], ['rifle', /rifle/], ['pistol', /pistol/],
  ['clubbing', /clubbing|\bclub/], ['piercing', /piercing/], ['slashing', /slashing/], ['mechanical', /mechanical/], ['temp', /temporary/], ['primary', /primary/], ['secondary', /secondary/], ['melee', /melee/]];
const typeKey = (t) => { const x = String(t || '').toLowerCase(); const m = TYPES.find(([, re]) => re.test(x)); return m ? m[0] : ''; };
// Turns Torn's perk sentences into numbers the ranking can use. Perks it can't read are kept as text and not used.
function parsePerks(list) {
  const P = { all: 0, fire: 0, dmg: {}, acc: {}, accAll: 0, passive: {}, used: [], other: [] };
  for (const raw of list || []) {
    const t = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const m = /(\d+(?:\.\d+)?)\s*%/.exec(t), flat = /(\d+(?:\.\d+)?)/.exec(t);
    const v = m ? Number(m[1]) : 0;
    if (!t || /^-|reduc|decreas|less /.test(t)) { if (t) P.other.push(raw); continue; }
    if (v && /fire damage|burn/.test(t)) { P.fire += v; P.used.push(raw); continue; }
    if (/accuracy/.test(t) && flat) { const k = typeKey(t); if (k) P.acc[k] = (P.acc[k] || 0) + Number(flat[1]); else P.accAll += Number(flat[1]); P.used.push(raw); continue; }
    if (v && /damage/.test(t) && !/critical|hospital|receiv|taken|incoming|chance|\bto the\b|against|while|when /.test(t)) {
      const k = typeKey(t);
      if (k) { P.dmg[k] = (P.dmg[k] || 0) + v; P.used.push(raw); continue; }
      if (/^\+?\s*\d+(?:\.\d+)?% (?:weapon |all )?damage(?: dealt)?\.?$/.test(t)) { P.all += v; P.used.push(raw); continue; }
      P.other.push(raw); continue;
    }
    const st = v && /(strength|speed|defen[sc]e|dexterity)/.exec(t);
    if (st && !/gym|gain|train/.test(t)) { const k = st[1].replace('defence', 'defense'); P.passive[k] = (P.passive[k] || 0) + v; P.used.push(raw); continue; }
    P.other.push(raw);
  }
  return P;
}
// Weapon mods as Torn lists them on the slot ("+2% critical hit rate", "+25% ammo conservation", "+1.00 accuracy").
// Only the critical hit rate adds to the ranking: Torn's damage and accuracy figures on the slot may already include the rest.
function modInfo(mods) {
  const o = { crit: 0, list: [] };
  for (const m of mods || []) { const d = String(m.desc || '').toLowerCase(), v = /([+-]?\d+(?:\.\d+)?)\s*%?/.exec(d); if (v && /critical hit rate|crit(ical)? chance/.test(d)) o.crit += Number(v[1]); o.list.push(m.name); }
  return o;
}
const has = (w, id) => !!w && (w.bonuses || []).some((b) => b.id === id);
const bval = (w, id) => { const b = w && (w.bonuses || []).find((x) => x.id === id); return b && b.value ? b.value : 0; };
// Perk damage % that applies to the weapon in this slot.
function perkPct(P, key, g, W) {
  if (!P) return 0;
  const t = typeKey(g && g.type);
  let p = P.all + (P.dmg[key] || 0) + (t && t !== key ? P.dmg[t] || 0 : 0);
  if (P.fire && W && W[key] && (has(W[key], 'burn') || /molotov|flamethrower/i.test(W[key].name || ''))) p += P.fire / 2;
  return p;
}
/* ---------- the opponent's armour (pure) ---------- */
// Ranked war sets and their armour rating. Any other piece counts as light armour.
const SETS = { eod: 57, sentinel: 55, marauder: 54, delta: 51, vanguard: 50, assault: 48, riot: 47, dune: 46 };
function armourInfo(names) {
  const A = { n: 0, sets: {}, mit: 0, blocks: [], tag: '' };
  const seen = [];
  for (const raw of names || []) {
    const t = String(raw || '').toLowerCase(); if (!t || seen.includes(t)) continue; seen.push(t);
    const set = Object.keys(SETS).find((k) => t.startsWith(k + ' ') || t === k);
    A.n++; if (set) A.sets[set] = (A.sets[set] || 0) + 1;
    A.mit += (set ? SETS[set] : 32) / 100 / 5;
    const add = (...x) => { for (const k of x) if (!A.blocks.includes(k)) A.blocks.push(k); };
    if (/gas mask|respirator|hazmat/.test(t)) add('pepper', 'tear', 'nerve');
    if (/riot helmet|marauder face mask|motorcycle helmet/.test(t)) add('pepper');
    if (/welding helmet/.test(t)) add('pepper', 'flash');
    if (/eod helmet/.test(t)) add('pepper', 'concussion');
  }
  A.mit = Math.min(0.6, A.mit);
  const top = Object.keys(A.sets).sort((a, b) => A.sets[b] - A.sets[a])[0];
  A.tag = top ? (top === 'eod' ? 'EOD' : top[0].toUpperCase() + top.slice(1)) + ' ' + A.sets[top] : A.n ? 'Armour ' + A.n : '';
  return A;
}
const tempKind = (name) => { const t = String(name || '').toLowerCase(); return /pepper/.test(t) ? 'pepper' : /tear/.test(t) ? 'tear' : /nerve/.test(t) ? 'nerve' : /flash/.test(t) ? 'flash' : /concussion/.test(t) ? 'concussion' : ''; };
const tempBlocked = (W, A) => !!(A && W.temp && tempKind(W.temp.name) && A.blocks.includes(tempKind(W.temp.name)));

// A ranking figure (not a damage prediction): listed damage x expected gain from always-on bonuses, mods and perks x the
// share that gets through their armour x hit chance at even speed and dexterity. Bonus weights are the average extra
// damage per turn: Powerful and Specialist at face value, an extra hit for Fury and Double Tap, two extra hits
// when Rage triggers (a cautious figure: Torn doesn't publish how often it gives more), +500% when Deadly triggers, Deadeye on roughly one hit in eight, half a hit's worth per point of
// critical hit rate (Expose, mods). Armour unknown: Penetrate counts at half its value and Puncture at a third.
const GAIN = { powerful: 1, specialist: 1, fury: 1, doubletap: 1, rage: 2, deadly: 5, deadeye: 0.12, expose: 0.5 };
function score(P, key, g, W, A) {
  if (!g || !(g.damage > 0)) return null;
  const w = (W && W[key]) || {};
  let b = (w.bonuses || []).reduce((a, x) => a + (x.value || 0) * (GAIN[x.id] || 0), 0) + modInfo(w.mods).crit * 0.5;
  const pen = bval(w, 'penetrate') / 100, pun = bval(w, 'puncture') / 100;
  let through = 1;
  if (A && A.n) {
    const m = A.mit, base = 1 - m * (1 - pen);                      // Penetrate ignores part of the mitigation
    through = pun * 1 + (1 - pun) * base;                           // Puncture ignores armour altogether when it triggers
    const block = 0.3 * ((A.sets.eod || 0) / 5);                    // EOD: chance to block a hit outright (Puncture gets past it)
    through *= 1 - block * (1 - pun);
    if (key === 'melee') through *= 1 - 0.3 * ((A.sets.riot || 0) / 5);                                         // Riot: less melee damage
    else if (typeKey(g.type) !== 'heavyartillery') through *= 1 - 0.3 * ((A.sets.assault || 0) / 5);           // Assault: less bullet damage
  } else b += pen * 50 + pun * 33;
  const t = typeKey(g.type), acc = Math.max(1, Math.min(100, (g.accuracy || 50) + (P ? P.accAll + (P.acc[key] || 0) + (t ? P.acc[t] || 0 : 0) : 0)));
  return g.damage * (1 + (b + perkPct(P, key, g, W)) / 100) * through * acc / 100;
}
function rank(W, I) {
  const out = {};
  for (const k of MAINS) out[k] = I && I.gear ? score(I.perks, k, I.gear[k], W, I.armour) : null;
  return out;
}
// Is a weapon ready this turn? Out of ammo never is; an empty clip is a reload turn, skipped for Specialist (one clip only) or when Reload is off.
const reloading = (w) => !!(w && w.ammo && w.ammo.clip === 0 && w.ammo.clips > 0);
const ready = (W, k, s) => !!(W[k] && W[k].usable && !(reloading(W[k]) && (has(W[k], 'specialist') || (s && s.reload === false))));
// The main weapon is a gun: Primary or Secondary. The ranking is an estimate, so a close call goes to the Primary; the
// Secondary takes over only when it scores at least 15% higher. Melee is the main weapon only when no gun is ready
// (no ammo, or none equipped). A melee weapon with a debuff or a mode's finishing bonus still gets its own turns in the plan.
const EDGE = 1.15, GUNS = ['primary', 'secondary'];
const bestMain = (W, I, s, usableOnly) => {
  const r = rank(W, I), ok = (k) => r[k] != null && (!usableOnly || ready(W, k, s));
  let best = null;
  for (const k of GUNS) if (ok(k) && (best == null || r[k] > r[best] * EDGE)) best = k;
  return best || (ok('melee') ? 'melee' : null);
};
// What one turn with a damage-over-time weapon is worth against a turn with the main weapon: its own hit plus the
// effect's chance x total (only the share that lands in about ten turns, since ticks are strongest early).
function dotWorth(W, I, key, main) {
  const d = (W[key].bonuses || []).map((b) => b.dot).find(Boolean);
  const any = (W[key].bonuses || []).find((b) => DOTS.includes(b.id));
  const dd = d || (any ? { chance: any.value || 100, total: DOT_DEF[any.id][0], turns: DOT_DEF[any.id][1] } : null);
  if (!dd) return null;
  const r = rank(W, I), tries = dd.chance >= 60 ? 2 : 3;
  if (r[key] == null || r[main] == null) return { worth: true, tries };
  const frac = 1 - Math.pow(Math.max(0, dd.turns - 10) / dd.turns, 2);
  const fire = I && I.perks && has(W[key], 'burn') ? 1 + I.perks.fire / 100 : 1;
  return { worth: r[key] * (1 + (dd.chance / 100) * (dd.total / 100) * frac * fire) > r[main], tries };
}

/* ---------- the plan (pure: no page access, so it can be tested on its own) ---------- */
const withBonus = (W, ids, usableOnly) => SLOTS.map((s) => s.key).find((k) => (!usableOnly || W[k].usable) && ids.some((id) => has(W[k], id))) || null;
const modeList = (W) => Object.keys(MODES).filter((m) => m !== 'farm' || withBonus(W, MODES[m].bonus));
const finishWord = (s) => (MODES[s.mode] || {}).finish || s.finish || 'leave';

function buildPlan(W, s, I) {
  const A = I && I.armour, live = (I && I.needles) || {};
  const main = s.main === 'best' ? bestMain(W, I, s, true) || bestMain(W, I, s) || 'primary' : s.main;
  if (/^seq[0-2]$/.test(s.plan)) return (s.seqs[Number(s.plan.slice(3))].steps || []).filter((x) => x && SLOT[x.w]).map((x) => ({ w: x.w, n: Number(x.n) || 0, by: x.by === 'use' ? 'use' : 'hit' }));
  const steps = [], smart = s.plan === 'smart';
  let needle = W.temp && W.temp.needle; const ass = withBonus(W, ['assassinate']);
  const held = needle && live[needle] > 0;                 // that needle is still active on you: keep it for later
  if (held) needle = null;
  // A needle (Epinephrine, Melatonin, Serotonin, Tyrosine) always goes first: it lifts every hit after it.
  if (needle && (smart || s.tempFirst)) steps.push({ w: 'temp', n: 1, by: 'use', why: NEEDLES[needle] });
  if (ass && !needle && (smart || s.assFirst)) steps.push({ w: ass, n: 1, by: 'use', why: 'Assassinate' });
  if (!needle && !held && (smart || s.tempFirst) && !(smart && tempBlocked(W, A))) steps.push({ w: 'temp', n: 1, by: 'use', why: 'Temp' });
  if (smart) {
    const bs = withBonus(W, ['blindside']);
    if (bs) steps.push({ w: bs, n: 0, by: 'full', why: 'Blindside' });
    // A damage-over-time weapon, when a turn with it is worth more than a turn with the main weapon. Left out when a
    // mode's finishing weapon is equipped, since a tick could end the fight instead of that weapon.
    if (!(s.mode !== 'normal' && withBonus(W, MODES[s.mode].bonus))) for (const k of MAINS) {
      const d = (W[k].bonuses || []).find((b) => DOTS.includes(b.id));
      const dw = d && k !== main ? dotWorth(W, I, k, main) : null;
      if (dw && dw.worth) steps.push({ w: k, n: 1, by: 'hit', max: dw.tries, fx: d.id, cap: 1, why: d.name });
    }
    // Debuffs: two hits, or up to three stacks once the page shows the effect. Delta armour shrugs most of it off.
    if (!(A && (A.sets.delta || 0) >= 3)) for (const k of MAINS) {
      const d = (W[k].bonuses || []).find((b) => DEBUFFS.includes(b.id));
      if (d && k !== main) steps.push({ w: k, n: 2, by: 'hit', max: 6, fx: d.id, cap: d.id === 'eviscerate' ? 1 : 3, why: d.name });
    }
  }
  steps.push({ w: main, n: 0, by: 'use', why: s.main === 'best' && bestMain(W, I, s) ? 'Best' : '' });
  return steps;
}
// What the next press should use. F: the fight so far. H: { me, opp } health. I: perks, weapon stats, their armour. X: effects on the opponent.
function choose(W, s, F, H, I, X) {
  const pct = H && H.opp ? (H.opp.cur / H.opp.max) * 100 : null;
  const out = (key, why, step) => ({ key, why: reloading(W[key]) ? 'Reload' : why, step });
  const fin = s.mode !== 'normal' ? withBonus(W, MODES[s.mode].bonus, true) : null;
  if (fin && pct != null && pct <= s.finishAt) return out(fin, MODES[s.mode].label, -1);
  if (!fin && s.execute) {
    const k = withBonus(W, ['execute'], true), v = k ? bval(W[k], 'execute') : 0;
    if (v && pct != null && pct <= v && !reloading(W[k])) return out(k, 'Execute', -1);
  }
  const fx = (id) => Math.max((X && X[id]) || 0, (F.fx && F.fx[id]) || 0);
  const plan = buildPlan(W, s, I);
  let i = F.step, uses = F.stepUses, hits = F.stepHits;
  for (; i < plan.length; i++, uses = 0, hits = 0) {
    const st = plan[i], last = i === plan.length - 1;
    if (!ready(W, st.w, s)) continue;
    if (st.by === 'full') { if (H && H.opp ? H.opp.cur >= H.opp.max : uses < 1) return out(st.w, st.why, i); continue; }
    if (!last) {
      const seen = st.fx ? fx(st.fx) : 0;
      if (st.fx && seen >= st.cap) continue;                         // the effect is on them: done
      if (st.max && uses >= st.max) continue;
      const count = st.by === 'hit' && F.hpOk ? hits : uses;
      if (st.n > 0 && count >= st.n && !(seen > 0 && st.cap > 1)) continue;   // stacking and the page shows it: carry on to the cap
    }
    return out(st.w, st.why || '', i);
  }
  const next = bestMain(W, I, s, true);
  for (const k of [s.fallback === 'best' ? next : s.fallback, next, ...MAINS]) if (k && ready(W, k, s)) return out(k, 'Fallback', -1);
  for (const k of MAINS) if (W[k] && W[k].usable) return out(k, 'Fallback', -1);   // only a reload is left
  return null;
}
// Fold the result of the last press into the fight record. L (from the action log) says hit or miss when it can; otherwise their health dropping counts as a hit.
function settle(F, H, L) {
  const n = Object.assign({}, F);
  if (L && L.fx) { n.fx = Object.assign({}, F.fx); for (const k in L.fx) n.fx[k] = (n.fx[k] || 0) + L.fx[k]; }
  if (F.last) {
    let hit = null;
    if (L && L.result) hit = L.result === 'hit';
    else if (H && H.opp && F.lastOpp != null) hit = H.opp.cur < F.lastOpp;
    if (hit != null) { n.hpOk = true; if (hit) { n.hits = F.hits + 1; if (F.lastStep === F.step) n.stepHits = F.stepHits + 1; } }
  }
  n.last = null;
  return n;
}
function advance(F, pick, H) {
  const n = Object.assign({}, F);
  if (pick.step >= 0 && pick.step !== F.step) { n.step = pick.step; n.stepUses = 0; n.stepHits = 0; }
  if (pick.step >= 0) n.stepUses += 1;
  n.turn = F.turn + 1; n.last = pick.key; n.lastStep = pick.step; n.lastOpp = H && H.opp ? H.opp.cur : null;
  return n;
}
const newFight = () => ({ step: 0, stepUses: 0, stepHits: 0, hits: 0, turn: 0, last: null, lastStep: -1, lastOpp: null, hpOk: false, fx: {} });
// A log line's clock time (Torn time = UTC) as a timestamp. A time that looks ahead of now belongs to yesterday.
function clockMs(line, now) {
  const m = /(\d{1,2}):(\d{2}):(\d{2})\s*$/.exec(String(line || '').trim()); now = now || Date.now();
  if (!m) return now;
  const d = new Date(now); let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(m[1]), Number(m[2]), Number(m[3]));
  if (t > now + 120000) t -= 86400000;
  return t;
}
const NEEDLE_MS = 120000;
const NEEDLE_STAT = { epinephrine: 'STR', melatonin: 'SPD', serotonin: 'DEF', tyrosine: 'DEX' };
// under 30 seconds a needle turns amber, under 10 red
const needleCls = (left) => (left <= 10 ? 'end' : left <= 30 ? 'low' : 'on');
// Seconds left on each needle active on you, from when it was injected.
const needlesLeft = (N, now) => { const out = {}; now = now || Date.now(); for (const id in N || {}) { const left = Math.ceil((N[id] + NEEDLE_MS - now) / 1000); if (left > 0 && left <= 121) out[id] = left; } return out; };
// New action-log lines since the last look. Torn's wording: "A missed B with his X", "A hit B with his X in the Stomach for 1218",
// "A fired 1 round of his X hitting B in the Right leg for 1712", and an effect as its own line starting with the one affected: "B is eviscerated".
function logNews(prev, cur, me, weaponName, names, opp) {
  const left = prev.slice(), fresh = [];
  for (const t of cur) { const i = left.indexOf(t); if (i >= 0) left.splice(i, 1); else fresh.push(t); }
  const L = { result: null, fx: {}, lines: fresh.length, needles: [], oppNeedles: [], lost: false };
  const m = String(me || '').toLowerCase(), o = String(opp || '').toLowerCase(), wn = String(weaponName || '').toLowerCase();
  for (const raw of fresh) {
    let t = raw.toLowerCase();
    // "A injected a syringe of Epinephrine into his arm 06:58:35": who, which needle, and Torn's own clock time for it
    const nd = /injected a syringe of (\w+)/.exec(t), id = nd && needleOf(nd[1]);
    if (id) { const at = clockMs(raw); if (m && t.startsWith(m)) L.needles.push({ id, at }); else if (o && t.startsWith(o)) L.oppNeedles.push({ id, at }); }
    if (m && (t.startsWith(m + ' lost to') || t.includes('hospitalized ' + m) || t.includes('mugged ' + m) || t.includes('defeated ' + m))) L.lost = true;
    if (m && t.startsWith(m) && (!wn || t.includes(wn))) { if (/\bmissed\b/.test(t)) { if (L.result == null) L.result = 'miss'; } else if (/\bfor\s+[\d,]+/.test(t)) L.result = 'hit'; }
    for (const nm of names || []) if (nm) t = t.split(nm.toLowerCase()).join(' ');     // a weapon called "Poison Umbrella" is not an effect
    if (o ? t.startsWith(o) || (t.includes(o) && !(m && t.startsWith(m) && / is | was /.test(t.slice(m.length, m.length + 5)))) : !(m && t.startsWith(m))) {
      const body = o && t.startsWith(o) ? t.slice(o.length) : t;
      if (!o || t.startsWith(o) ? / is | was |^ is |^ was /.test(body) : /\b(?:is|was)\b/.test(t.slice(t.indexOf(o) + o.length))) for (const id in FX) if (FX[id].test(t)) L.fx[id] = (L.fx[id] || 0) + 1;
    }
  }
  return L;
}
if (window.__TUCC_TEST) window.__tuccCombatDesk = { readWeapons, readHealth, readOpp, boxEffects, readLog, players, parseAmmo, clockMs, needlesLeft, parsePerks, perkPct, modInfo, armourInfo, tempBlocked, dotWorth, score, rank, bestMain, typeKey, buildPlan, choose, settle, advance, newFight, logNews, bonusId, modeList, finishWord, reloading, ready, DEF };

/* ---------- the button ---------- */
GM_addStyle(`#tucc-cd{position:fixed;z-index:2147481000;width:190px;display:flex;flex-direction:column;gap:5px;font:600 12px/16px Arial,Helvetica,sans-serif;color:#ddd;user-select:none;-webkit-user-select:none;touch-action:manipulation;box-sizing:border-box}
#tucc-cd *{box-sizing:border-box}
#tucc-cd .cd-main{order:-1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;width:100%;min-height:58px;padding:6px 14px;border:1px solid #5c0f0b;border-radius:8px;background:linear-gradient(180deg,#b7281f,#8c1a14);color:#fff;font:700 17px/20px Arial,Helvetica,sans-serif;letter-spacing:.3px;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 2px 6px rgba(0,0,0,.45);transition:filter .08s}
#tucc-cd .cd-main:hover{filter:brightness(1.08)}
#tucc-cd .cd-main:active{filter:brightness(.88)}
#tucc-cd .cd-main:focus-visible{outline:2px solid #fff;outline-offset:2px}
#tucc-cd .cd-main small{font:600 11px/13px Arial,Helvetica,sans-serif;letter-spacing:.2px;color:rgba(255,255,255,.78);min-height:13px}
#tucc-cd .cd-pan{background:linear-gradient(180deg,#333,#2a2a2a);border:1px solid #111;border-radius:8px;padding:6px 8px;box-shadow:inset 0 1px 0 rgba(255,255,255,.05);min-width:0}
#tucc-cd .cd-pan:empty{display:none}
#tucc-cd .cd-seg{display:flex;flex-wrap:wrap;gap:1px;border:1px solid #111;border-radius:6px;overflow:hidden;background:#111}
#tucc-cd .cd-seg+.cd-seg{margin-top:5px}
#tucc-cd .cd-c{flex:1 1 auto;min-width:0;min-height:26px;padding:3px 8px;border:0;background:#222;color:#aaa;font:600 11px/14px Arial,Helvetica,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
#tucc-cd .cd-c:hover{color:#fff;background:#383838}
#tucc-cd .cd-c.on{background:linear-gradient(180deg,#a8241c,#86190f);color:#fff}
#tucc-cd .cd-c.miss:not(.on){color:#777}
#tucc-cd .cd-r{display:flex;gap:8px;align-items:flex-start}
#tucc-cd .cd-ws{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
#tucc-cd .cd-w{display:flex;gap:6px;align-items:baseline;font:400 11px/15px Arial,Helvetica,sans-serif;color:#c8c8c8;min-width:0}
#tucc-cd .cd-w b{flex:0 0 16px;height:15px;border-radius:3px;background:#1b1b1b;color:#999;font:700 10px/15px Arial,Helvetica,sans-serif;text-align:center}
#tucc-cd .cd-w span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#tucc-cd .cd-w i{font-style:normal;color:#808080}
#tucc-cd .cd-w em{font-style:normal;color:#7fbf5a}
#tucc-cd .cd-w.warn span{color:#f0a030}
#tucc-cd .cd-t{flex:0 0 auto;display:flex;gap:3px}
#tucc-cd .cd-i{width:24px;height:24px;padding:0;border:1px solid #111;border-radius:5px;background:#222;color:#999;font:13px/22px Arial,Helvetica,sans-serif;cursor:pointer}
#tucc-cd .cd-i:hover{color:#fff;background:#383838}
#tucc-cd .cd-i.on{color:#fff;background:#86190f}
#tucc-cd .cd-grip{cursor:move}
#tucc-cd.locked .cd-grip{display:none}
#tucc-cd.dock{position:relative;z-index:5;width:auto;margin:8px 0;display:grid;grid-template-columns:minmax(0,1fr) 220px minmax(0,1fr);gap:8px;align-items:stretch;left:auto !important;top:auto !important;right:auto !important;bottom:auto !important}
#tucc-cd.dock .cd-main{order:0;grid-column:2;min-height:62px}
#tucc-cd.dock .cd-l{grid-column:1;grid-row:1;display:flex;flex-direction:column;justify-content:center}
#tucc-cd.dock .cd-r{grid-column:3;grid-row:1;align-items:center}
#tucc-cd.dock.shut{grid-template-columns:minmax(0,1fr) 220px minmax(0,1fr)}
#tucc-cd.dock.shut .cd-l{display:none}
#tucc-cd.dock.shut .cd-r{background:none;border-color:transparent;box-shadow:none;justify-content:flex-start;padding-left:0}
#tucc-cd.dock .cd-grip,#tucc-cd.dock .cd-lock{display:none}
#tucc-cd .cd-n{display:none;gap:6px;align-items:stretch}
#tucc-cd .cd-n.on{display:flex}
#tucc-cd.dock .cd-n{grid-column:1 / -1;grid-row:2}
#tucc-cd .cd-nd{position:relative;flex:1 1 0;min-width:0;display:flex;align-items:baseline;justify-content:center;gap:6px;padding:7px 8px 9px;border:1px solid #2f6b1f;border-radius:7px;background:#16260f;color:#d9f5c8;overflow:hidden}
#tucc-cd .cd-nd b{font:700 13px/16px Arial,Helvetica,sans-serif;color:#fff}
#tucc-cd .cd-nd i{font:700 9px/12px Arial,Helvetica,sans-serif;font-style:normal;letter-spacing:.5px;color:#8fce6c}
#tucc-cd .cd-nd em{font:700 15px/16px Arial,Helvetica,sans-serif;font-style:normal;font-variant-numeric:tabular-nums;color:#9be870;margin-left:auto}
#tucc-cd .cd-nd u{position:absolute;left:0;bottom:0;height:3px;background:#6fd03f;text-decoration:none;transition:width 1s linear}
#tucc-cd .cd-nd.low{border-color:#8a5a00;background:#2b1f05}#tucc-cd .cd-nd.low i,#tucc-cd .cd-nd.low em{color:#ffb829}#tucc-cd .cd-nd.low u{background:#ffb829}
#tucc-cd .cd-nd.end{border-color:#b3261e;background:#3a0d0a;animation:cd-pulse 1s ease-in-out infinite}#tucc-cd .cd-nd.end i,#tucc-cd .cd-nd.end em{color:#ff6b5e}#tucc-cd .cd-nd.end u{background:#ff5347}
#tucc-cd .cd-nd.off{border-color:#2a2a2a;border-style:dashed;background:#1c1c1c}#tucc-cd .cd-nd.off b{color:#6e6e6e}#tucc-cd .cd-nd.off i,#tucc-cd .cd-nd.off em{color:#555}
#tucc-cd .cd-no{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid #8a5a00;border-radius:7px;background:#2b1f05;color:#ffb829;font:700 12px/16px Arial,Helvetica,sans-serif}
#tucc-cd .cd-no b{font:700 10px/15px Arial,Helvetica,sans-serif;color:#c98f1c}#tucc-cd .cd-no em{font-style:normal;font-variant-numeric:tabular-nums;color:#fff}
#tucc-cd:not(.dock) .cd-n{flex-wrap:wrap}#tucc-cd:not(.dock) .cd-nd{flex:1 1 40%;padding:5px 6px 7px;gap:4px}#tucc-cd:not(.dock) .cd-nd i{display:none}#tucc-cd:not(.dock) .cd-no{flex:1 1 100%;justify-content:center}
@keyframes cd-pulse{50%{box-shadow:0 0 0 2px rgba(255,83,71,.55)}}
@media (prefers-reduced-motion:reduce){#tucc-cd .cd-nd.end{animation:none}#tucc-cd .cd-nd u{transition:none}}
@media (max-width:700px){#tucc-cd.dock .cd-n{grid-column:1;grid-row:auto;flex-wrap:wrap}#tucc-cd .cd-nd{flex:1 1 40%;padding:6px 8px 8px}#tucc-cd .cd-no{flex:1 1 100%;justify-content:center}}
[data-cd-hide="1"]{display:none !important}
#tucc-win-combatdesk select,#tucc-win-combatdesk input[type=text]{background:#222;color:#eee;border:1px solid #555;border-radius:4px;padding:2px 4px;font:12px Arial,sans-serif}
#tucc-win-combatdesk .cd-g{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;margin-bottom:10px}
#tucc-win-combatdesk .cd-seq{margin-bottom:10px}
#tucc-win-combatdesk .cd-st{display:flex;gap:4px;margin-top:3px}
@media (max-width:700px){#tucc-cd.dock{grid-template-columns:1fr;gap:6px}#tucc-cd.dock .cd-main{grid-column:1;grid-row:1;min-height:66px}#tucc-cd.dock .cd-l{grid-column:1;grid-row:2}#tucc-cd.dock .cd-r{grid-column:1;grid-row:3;align-items:flex-start}#tucc-cd.dock.shut .cd-r{justify-content:center}}`);

// Your perks and weapon types (Torn API, optional), armour piece names, and what opponents were last seen carrying.
const INTEL = { perks: null, gear: {} };
// Needles active on you: when each was injected (kept across pages, since they last 120 seconds whatever fight you are in).
let ACTIVE = GM_getValue('needles', null) || {};
let oppNeedles = {};
function noteLog(L) {
  let ch = false;
  for (const n of L.needles || []) if (!(ACTIVE[n.id] >= n.at)) { ACTIVE[n.id] = n.at; ch = true; }
  if (L.lost && Object.keys(ACTIVE).length) { ACTIVE = {}; ch = true; }          // hospital ends them
  for (const id in ACTIVE) if (Date.now() - ACTIVE[id] > NEEDLE_MS) { delete ACTIVE[id]; ch = true; }
  if (ch) GM_setValue('needles', ACTIVE);
  for (const n of L.oppNeedles || []) oppNeedles[n.id] = Math.max(oppNeedles[n.id] || 0, n.at);
}
let ITEMS = GM_getValue('items', null) || { 680: 'EOD Helmet', 681: 'EOD Apron', 682: 'EOD Pants', 683: 'EOD Boots', 684: 'EOD Gloves' };
let OPPS = GM_getValue('opps', null) || {};
const asked = {};
const flat = (o, out) => { if (typeof o === 'string') out.push(o); else if (o && typeof o === 'object') for (const k in o) flat(o[k], out); return out; };
const visible = (fn) => { if (!document.hidden) fn(); else document.addEventListener('visibilitychange', function once() { if (document.hidden) return; document.removeEventListener('visibilitychange', once); fn(); }); };
async function loadIntel() {
  if (!tucc.key || !tucc.key()) return;
  try { const j = await tucc.api('/v2/user/perks', {}, { ttl: 3600 }); INTEL.perks = parsePerks(flat(j && (j.perks || j), [])); } catch (e) { /* works without */ }
  try {
    const j = await tucc.api('/v2/user/equipment', {}, { ttl: 120 });
    const W = readWeapons(), bySlot = { 1: 'primary', 2: 'secondary', 3: 'melee', 5: 'temp' };
    for (const it of (j && j.equipment) || []) {
      if (!it) continue;
      const nm = String(it.name || '').toLowerCase();
      const key = SLOTS.map((s) => s.key).find((k) => W[k].name && W[k].name.toLowerCase() === nm) || bySlot[it.slot];
      if (key && !INTEL.gear[key]) INTEL.gear[key] = { damage: it.stats && it.stats.damage, accuracy: it.stats && it.stats.accuracy, type: it.sub_type || '' };
    }
  } catch (e) { /* works without */ }
  lastHtml = ''; render();
}
// Name armour pieces the page shows only as pictures: one Torn API read per new set of pieces, then saved for good.
function nameItems(ids) {
  const need = ids.filter((id) => !ITEMS[id] && !asked[id]);
  if (!need.length || !tucc.key || !tucc.key()) return;
  need.forEach((id) => { asked[id] = 1; });
  visible(async () => {
    try {
      const j = await tucc.api('/v2/torn/' + need.join(',') + '/items', {}, { ttl: 86400 });
      for (const it of (j && j.items) || []) if (it && it.id) ITEMS[it.id] = String(it.name || '') + (/armor|armour|defensive/i.test(String(it.type || '')) ? '' : ' (' + String(it.type || 'item') + ')');
      GM_setValue('items', ITEMS); lastHtml = ''; render();
    } catch (e) { /* works without */ }
  });
}
// The opponent's armour for the ranking: what the page shows now, else what was saved the last time you fought them.
function oppInfo() {
  const o = readOpp();
  const names = o.armour.concat(o.ids.map((id) => ITEMS[id]).filter((n) => n && !/\(/.test(n)).filter((n) => !o.armour.includes(n)));
  if (o.ids.length) nameItems(o.ids);
  let saved = false;
  if (o.id && (names.length || o.weapons.length)) {
    const old = OPPS[o.id] || {}, rec = { name: o.name, weapons: o.weapons.length ? o.weapons : old.weapons || [], armour: names.length ? names : old.armour || [], at: Date.now() };
    if (JSON.stringify([old.weapons, old.armour]) !== JSON.stringify([rec.weapons, rec.armour])) {
      OPPS[o.id] = rec;
      const ks = Object.keys(OPPS); if (ks.length > 150) ks.sort((a, b) => OPPS[a].at - OPPS[b].at).slice(0, ks.length - 150).forEach((k) => delete OPPS[k]);
      GM_setValue('opps', OPPS);
    }
  }
  let use = names;
  if (!use.length && o.id && OPPS[o.id] && (OPPS[o.id].armour || []).length) { use = OPPS[o.id].armour; saved = true; }
  const A = armourInfo(use); A.saved = saved; A.names = use;
  return A;
}
// What the ranking sees: damage and accuracy as shown on your weapon slots (no key needed); the API adds the weapon type and your perks.
function intel(W) {
  const gear = {};
  for (const s of SLOTS) { const g = INTEL.gear[s.key] || {}, x = W[s.key] || {}; if (x.damage || g.damage) gear[s.key] = { damage: x.damage || g.damage, accuracy: x.accuracy || g.accuracy, type: g.type || '' }; }
  return { perks: INTEL.perks, gear, armour: oppInfo(), needles: needlesLeft(ACTIVE) };
}
let F = newFight(), startAt = 0, finishAt = 0, hitAt = 0, fightKey = '', logPrev = [];
const root = document.createElement('div'); root.id = 'tucc-cd';
root.innerHTML = '<div class="cd-pan cd-l"></div><button type="button" class="cd-main"></button><div class="cd-pan cd-r"></div><div class="cd-n" role="status" aria-label="Needles"></div>';
const panL = root.children[0], mainBtn = root.children[1], panR = root.children[2], panN = root.children[3], pan = root;
const w = tucc.ui.window('combatdesk', 'Combat Desk', '');

// Docked: a strip directly under the two fighters, inside the attack screen. Put back if Torn redraws that area.
function dock() {
  const want = S.dock !== 'float';
  root.classList.toggle('dock', want);
  if (!want) { if (root.parentNode !== document.body) { document.body.appendChild(root); place(); } return; }
  const host = document.querySelector('#attack-root [class*="playersModelWrap"]');
  if (!host || !host.parentNode) { if (!root.isConnected) document.body.appendChild(root); root.classList.remove('dock'); return; }
  if (root.previousElementSibling !== host) host.parentNode.insertBefore(root, host.nextSibling);
}
function place() {
  if (root.classList.contains('dock')) return;
  const p = S.pos, W = window.innerWidth, H = window.innerHeight;
  if (p) { root.style.left = Math.max(0, Math.min(W - 60, p.x)) + 'px'; root.style.top = Math.max(0, Math.min(H - 60, p.y)) + 'px'; root.style.right = 'auto'; root.style.bottom = 'auto'; }
  else { root.style.top = 'auto'; root.style.bottom = '90px'; root.style.left = S.side === 'left' ? '10px' : 'auto'; root.style.right = S.side === 'left' ? 'auto' : '10px'; }
  root.classList.toggle('locked', !!S.locked);
}
// Torn's own Start fight button is hidden while this button is on the page (it presses that button for you, one press at a time).
function hideStart() {
  const b = root.isConnected ? findStart(true) : null;
  const box = b && (b.closest('[class*="dialogWrapper"]') || b);
  for (const el of document.querySelectorAll('[data-cd-hide="1"]')) if (el !== box) el.removeAttribute('data-cd-hide');
  if (box && box.getAttribute('data-cd-hide') !== '1') box.setAttribute('data-cd-hide', '1');
}
// Reads the action log once per look: the result of the last press and any effects applied.
function news(W) {
  const cur = readLog(), p = players();
  const L = logNews(logPrev, cur, nameOf(p.me), F.last && W[F.last] ? W[F.last].name : '', SLOTS.map((s) => W[s.key].name), nameOf(p.opp));
  return { L, cur };
}

// One real press = one click on one of Torn's own controls. Nothing else calls this.
function act(e) {
  if (!e.isTrusted) return;
  const t = Date.now();
  const fin = findFinish(finishWord(S));
  if (fin) {
    if (fin === 'unknown' || fin.disabled || t - finishAt < 1000) return;
    finishAt = t;
    if (!S.sticky && S.mode !== 'normal') { S.mode = 'normal'; save(); }
    fin.click();
    return;
  }
  const start = findStart();
  if (start) {
    if (t - startAt < 1000) return;
    startAt = t; F = newFight(); logPrev = readLog();
    start.click();
    return;
  }
  if (t - hitAt < 150) return;
  const W = readWeapons(), H = readHealth(), n = news(W);
  F = settle(F, H, n.L); logPrev = n.cur;
  const pick = choose(W, S, F, H, intel(W), boxEffects(players().opp));
  if (!pick || !W[pick.key].el) return;
  hitAt = t;
  F = advance(F, pick, H);
  W[pick.key].el.click();
}
mainBtn.addEventListener('click', act);
// A held key repeats by itself, which would be several actions from one input: the button ignores key repeats.
mainBtn.addEventListener('keydown', (e) => { if (e.repeat) { e.preventDefault(); e.stopPropagation(); } });

function chip(a, val, text, on, extra) { return `<button type="button" class="cd-c${on ? ' on' : ''}${extra || ''}" data-act="${a}" data-val="${esc(val)}" aria-pressed="${on ? 'true' : 'false'}">${esc(text)}</button>`; }
let lastHtml = '', lastMain = '', lastN = '';
function render() {
  const key = location.search;
  if (key !== fightKey) { fightKey = key; F = newFight(); logPrev = readLog(); oppNeedles = {}; }
  dock(); hideStart();
  // Needles are read from every log line still on the page, so one injected by hand or before a reload is still seen.
  { const pl = players(); noteLog(logNews([], readLog(), nameOf(pl.me), '', [], nameOf(pl.opp))); }
  const W = readWeapons(), H = readHealth(), I = intel(W), A = I.armour;
  const fin = findFinish(finishWord(S)), start = !fin && findStart();
  let big = '', small = '';
  if (fin) { big = fin === 'unknown' ? 'Finish' : (fin.textContent || '').trim(); small = MODES[S.mode].label; }
  else if (start) { big = 'Start'; small = MODES[S.mode].label; if (F.turn) { F = newFight(); logPrev = readLog(); } }
  else {
    const pick = choose(W, S, settle(F, H, news(W).L), H, I, boxEffects(players().opp));
    big = pick ? SLOT[pick.key].label : 'No weapon';
    small = pick ? pick.why : '';
  }
  const mh = `${esc(big)}<small>${esc(small)}</small>`;
  if (mh !== lastMain) { mainBtn.innerHTML = mh; lastMain = mh; }
  root.classList.toggle('shut', !S.open);
  let hl = '', hr = '';
  if (S.open) {
    const modes = modeList(W);
    if (!modes.includes(S.mode)) S.mode = 'normal';
    hl += '<div class="cd-seg">' + modes.map((m) => chip('mode', m, MODES[m].label, S.mode === m, m !== 'normal' && !withBonus(W, MODES[m].bonus) ? ' miss' : '')).join('') + '</div>';
    hl += '<div class="cd-seg">' + chip('plan', 'smart', 'Smart', S.plan === 'smart') + chip('plan', 'single', '1 Wpn', S.plan === 'single')
      + S.seqs.map((q, i) => (q.steps || []).length ? chip('plan', 'seq' + i, q.name || 'Seq ' + (i + 1), S.plan === 'seq' + i) : '').join('') + '</div>';
    hr += '<div class="cd-ws">' + SLOTS.map((s) => {
      const x = W[s.key], pk = Math.round(perkPct(I.perks, s.key, I.gear[s.key], W));
      const parts = x.bonuses.map((b) => esc(b.name) + (b.value != null ? ' ' + b.value + esc(b.unit) : ''));
      if (x.needle) parts.push(esc(NEEDLES[x.needle]));
      const tail = (x.mods.length ? ' <i>' + x.mods.map((m) => esc(m.name)).join(', ') + '</i>' : '') + (pk ? ' <em>+' + pk + '%</em>' : '');
      return parts.length || tail ? `<div class="cd-w" title="${esc(x.name)}"><b>${s.short}</b><span>${parts.join(', ')}${tail}</span></div>` : '';
    }).join('');
    if (A.tag) hr += `<div class="cd-w${tempBlocked(W, A) ? ' warn' : ''}" title="${esc((A.names || []).join(', '))}"><b>vs</b><span>${esc(A.tag)}${A.saved ? ' <i>saved</i>' : ''}${tempBlocked(W, A) ? ' · Temp blocked' : ''}</span></div>`;
    hr += '</div>';
  }
  const ib = (a, text, title, cls) => `<button type="button" class="cd-i${cls || ''}" data-act="${a}" title="${title}" aria-label="${title}">${text}</button>`;
  hr += '<div class="cd-t">' + ib('lock', S.locked ? '■' : '□', 'Lock position', ' cd-lock' + (S.locked ? ' on' : '')) + ib('grip', '✥', 'Move', ' cd-grip') + ib('set', '⚙', 'Settings') + ib('open', S.open ? '▴' : '▾', S.open ? 'Collapse' : 'Expand') + '</div>';
  if (hl + hr !== lastHtml) { panL.innerHTML = hl; panR.innerHTML = hr; lastHtml = hl + hr; }
  // Needle bar: all four needles in one row, lit with a countdown while active on you. Shown even when collapsed.
  const nl = needlesLeft(ACTIVE), ol = needlesLeft(oppNeedles), clock = (sec) => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  let hn = '';
  if (Object.keys(nl).length || Object.keys(ol).length) {
    hn = Object.keys(NEEDLES).map((id) => { const left = nl[id], end = ACTIVE[id] + NEEDLE_MS;
      return left ? `<div class="cd-nd ${needleCls(left)}" title="${esc(NEEDLES[id])}"><b>${esc(NEEDLES_SHORT[id])}</b><i>${NEEDLE_STAT[id]}</i><em data-cd-end="${end}">${clock(left)}</em><u style="width:${Math.round(left / 1.2)}%"></u></div>`
        : `<div class="cd-nd off" title="${esc(NEEDLES[id])}"><b>${esc(NEEDLES_SHORT[id])}</b><i>${NEEDLE_STAT[id]}</i><em>–</em></div>`; }).join('');
    const oon = Object.keys(ol);
    if (oon.length) hn += `<div class="cd-no" title="Needles on your opponent"><b>vs</b>${oon.map((id) => `<span>${esc(NEEDLES_SHORT[id])} <em data-cd-end="${oppNeedles[id] + NEEDLE_MS}">${clock(ol[id])}</em></span>`).join('')}</div>`;
  }
  const sigN = hn.replace(/>\d+:\d\d</g, '><').replace(/width:\d+%/g, '');
  if (sigN !== lastN) { panN.innerHTML = hn; lastN = sigN; panN.classList.toggle('on', !!hn); }
}
pan.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b || !e.isTrusted || b === mainBtn) return;
  const a = b.dataset.act, v = b.dataset.val;
  if (a === 'mode') S.mode = v; else if (a === 'plan') { S.plan = v; F = Object.assign(newFight(), { turn: F.turn, fx: F.fx }); }
  else if (a === 'open') S.open = !S.open; else if (a === 'lock') S.locked = !S.locked;
  else if (a === 'set') { drawSettings(); w.toggle(); return; } else return;
  save(); place(); render();
});
pan.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.cd-grip') || S.locked) return;
  e.preventDefault();
  const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
  const mv = (ev) => { S.pos = { x: Math.round(ev.clientX - dx), y: Math.round(ev.clientY - dy) }; place(); };
  const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); save(); };
  document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
});

/* ---------- settings window ---------- */
const opt = (v, t, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(t)}</option>`;
const slotOpts = (cur, none) => (none ? opt('', '–', cur) : '') + SLOTS.map((s) => opt(s.key, s.label, cur)).join('');
const sw = (k, t) => `<label><input type="checkbox" data-k="${k}"${S[k] ? ' checked' : ''}> ${esc(t)}</label>`;
function drawSettings() {
  const W = readWeapons();
  const fo = (cur) => opt('leave', 'Leave', cur) + opt('mug', 'Mug', cur) + opt('hosp', 'Hosp', cur);
  let h = '<div class="cd-g">'
    + `<span>Main</span><select data-k="main">${opt('best', 'Best', S.main)}${slotOpts(S.main)}</select>`
    + `<span>Fallback</span><select data-k="fallback">${opt('best', 'Best', S.fallback)}${slotOpts(S.fallback)}</select>`
    + `<span>Finish</span><select data-k="finish">${fo(S.finish)}</select>`
    + `<span>Finisher at</span><select data-k="finishAt" data-num="1">${[5, 10, 15, 20, 25, 30].map((n) => opt(n, n + '% life', S.finishAt)).join('')}</select>`
    + `<span>Position</span><select data-k="dock">${opt('fight', 'Under fight', S.dock)}${opt('float', 'Floating', S.dock)}</select>`
    + `<span>Side</span><select data-k="side">${opt('right', 'Right', S.side)}${opt('left', 'Left', S.side)}</select>`
    + '</div><div class="cd-g" style="grid-template-columns:1fr 1fr">'
    + sw('tempFirst', 'Temp first')
    + (withBonus(W, ['assassinate']) ? sw('assFirst', 'Assassinate first') : '')
    + (withBonus(W, ['execute']) ? sw('execute', 'Execute') : '')
    + sw('reload', 'Reload') + sw('sticky', 'Keep mode') + '</div>';
  S.seqs.forEach((q, i) => {
    h += `<div class="cd-seq"><input type="text" maxlength="8" data-seq="${i}" data-f="name" value="${esc(q.name || '')}">`;
    for (let j = 0; j < 5; j++) {
      const st = (q.steps || [])[j] || { w: '', n: 1, by: 'hit' };
      h += `<div class="cd-st"><select data-seq="${i}" data-step="${j}" data-f="w">${slotOpts(st.w, true)}</select>`
        + `<select data-seq="${i}" data-step="${j}" data-f="n">${[1, 2, 3, 5].map((n) => opt(n, '× ' + n, st.n)).join('')}${opt(0, 'to end', st.n)}</select>`
        + `<select data-seq="${i}" data-step="${j}" data-f="by">${opt('hit', 'hits', st.by)}${opt('use', 'uses', st.by)}</select></div>`;
    }
    h += '</div>';
  });
  const P = INTEL.perks;
  if (P && P.used.length) h += '<div class="cd-seq"><b>Perks used</b>' + P.used.map((x) => `<div>${esc(x)}</div>`).join('') + '</div>';
  const mods = SLOTS.map((s) => W[s.key].mods.map((m) => `<div>${esc(s.short)} ${esc(m.name)}: ${esc(m.desc)}</div>`).join('')).join('');
  if (mods) h += '<div class="cd-seq"><b>Mods</b>' + mods + '</div>';
  h += '<button type="button" class="b" data-act="resetpos">Reset position</button>';
  w.set(h);
}
w.body.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.k) S[t.dataset.k] = t.type === 'checkbox' ? t.checked : t.dataset.num ? Number(t.value) : t.value;
  else if (t.dataset.seq != null) {
    const q = S.seqs[Number(t.dataset.seq)];
    if (t.dataset.f === 'name') q.name = t.value.trim().slice(0, 8) || 'Seq ' + (Number(t.dataset.seq) + 1);
    else {
      const rows = Array.from(w.body.querySelectorAll(`.cd-st select[data-seq="${t.dataset.seq}"][data-f="w"]`)).map((sel) => {
        const j = sel.dataset.step, g = (f) => w.body.querySelector(`select[data-seq="${t.dataset.seq}"][data-step="${j}"][data-f="${f}"]`).value;
        return { w: sel.value, n: Number(g('n')), by: g('by') };
      });
      q.steps = rows.filter((r) => r.w);
    }
  } else return;
  if (S.side && t.dataset.k === 'side') S.pos = null;
  save(); dock(); place(); render();
});
w.body.addEventListener('click', (e) => { if (e.target.closest('[data-act="resetpos"]')) { S.pos = null; save(); place(); } });

/* ---------- start ---------- */
(document.body || document.documentElement).appendChild(root);
dock(); place(); render();
// The API read waits until this tab is the one you are looking at (no calls from a hidden tab).
visible(loadIntel);
let queued = false;
new MutationObserver(() => { if (queued) return; queued = true; setTimeout(() => { queued = false; render(); }, 120); }).observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-disabled', 'disabled'] });
window.addEventListener('resize', place);
// Needle countdowns tick once a second (display only), and the strip redraws when one runs out.
setInterval(() => {
  const els = root.querySelectorAll('[data-cd-end]'); if (!els.length) return;
  let done = false;
  els.forEach((el) => { const s = Math.ceil((Number(el.dataset.cdEnd) - Date.now()) / 1000); if (s <= 0) { done = true; return; } el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    const chip = el.closest('.cd-nd'); if (!chip) return; const c = 'cd-nd ' + needleCls(s); if (chip.className !== c) chip.className = c; const bar = chip.querySelector('u'); if (bar) bar.style.width = Math.round(s / 1.2) + '%'; });
  if (done) render();
}, 1000);
