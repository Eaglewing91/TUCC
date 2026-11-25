// ==UserScript==
// @name         TUCC Combat Desk
// @namespace    eaglewing.torn.tucc.combatdesk
// @version      0.2.0
// @description  Attack page: one button that starts the fight, uses the right weapon for the turn and presses your finish option. One press = one action. Plans come from your own equipped weapons and their bonuses; modes pick the finishing weapon (War, Mug, Merc, Farm). With a key it also reads your perks and equipped weapon stats from the Torn API to rank your weapons. Makes no requests to torn.com.
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
 *   slots, the bonus icons on them, and both health values.
 * - Optional, Torn API only (api.torn.com, through TUCC's shared engine, key in the request header): user/perks and
 *   user/equipment, once when the attack page opens (shared and cached), to rank your weapons by their real damage,
 *   accuracy and your perks. Without a key the module works from the page alone.
 * - Each real press of the Combat Desk button passes exactly ONE click to ONE of Torn's own controls on this page:
 *   Start fight, one of your weapons, or your finish option. Torn's page then sends its own normal request.
 *   Nothing is pressed on a timer, by an observer or on page load, and a press never leads to a second press.
 * - Synthetic (script-made) events are ignored: only trusted input counts.
 * - Stores only your settings, sequences and the button position, locally.
 *
 * Terms of Service
 *   Data Storage:          Only locally (settings, sequences, button position). Perks and weapon stats are kept in
 *                          memory for the page only.
 *   Data Sharing:          Nobody.
 *   Purpose of Use:        Competitive advantage - faster, better-planned manual attacking.
 *   Key Storage & Sharing: Stored / Used only for automation (TUCC's shared key, sent only to api.torn.com).
 *   Key Access Level:      Optional. Minimal (perks need Public, equipped weapon stats need Minimal).
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
const DIALOG = '[class^="dialogButtons"], [class*="dialogButtons"]';
const FINISH_RE = /\b(leave|mug|hosp)/i;

/* ---------- bonuses (names as Torn shows them; anything else on a weapon is an attachment and is ignored) ---------- */
const BONUS_NAMES = ['Achilles', 'Assassinate', 'Backstab', 'Berserk', 'Bleed', 'Blindfire', 'Blindside', 'Bloodlust', 'Burn', 'Comeback', 'Conserve', 'Cripple', 'Crusher', 'Cupid', 'Deadeye', 'Deadly', 'Demoralize', 'Disarm', 'Double-edged', 'Double Tap', 'Emasculate', 'Empower', 'Eviscerate', 'Execute', 'Expose', 'Finale', 'Focus', 'Freeze', 'Frenzy', 'Fury', 'Grace', 'Hazardous', 'Home Run', 'Irradiate', 'Lacerate', 'Motivation', 'Paralyze', 'Parry', 'Penetrate', 'Plunder', 'Poison', 'Powerful', 'Proficience', 'Puncture', 'Quicken', 'Rage', 'Revitalize', 'Roshambo', 'Shock', 'Sleep', 'Slow', 'Smash', 'Smurf', 'Specialist', 'Spray', 'Storage', 'Stricken', 'Stun', 'Suppress', 'Sure Shot', 'Throttle', 'Toxin', 'Warlord', 'Weaken', 'Wind-up', 'Wither'];
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const ALIAS = { demoralized: 'demoralize', poisoned: 'poison', laceration: 'lacerate', lacerated: 'lacerate', paralyzed: 'paralyze', severeburning: 'burn', burning: 'burn' };
const BONUS = Object.fromEntries(BONUS_NAMES.map((n) => [norm(n), n]));
const bonusId = (title) => { const n = norm(title); const a = ALIAS[n] || n; return BONUS[a] ? a : null; };
const DEBUFFS = ['weaken', 'wither', 'slow', 'cripple', 'eviscerate'];
const MODES = {
  normal: { label: 'Normal', bonus: [] },
  war: { label: 'War', bonus: ['warlord'] },
  mug: { label: 'Mug', bonus: ['plunder'], finish: 'mug' },
  merc: { label: 'Merc', bonus: ['stricken'], finish: 'hosp' },
  farm: { label: 'Farm', bonus: ['revitalize', 'proficience'], finish: 'leave' },
};

/* ---------- settings ---------- */
const DEF = {
  mode: 'normal', sticky: true, plan: 'auto', main: 'best', fallback: 'secondary',
  tempFirst: true, assFirst: true, execute: true, finish: 'leave', warFinish: 'leave', finishAt: 15,
  side: 'right', locked: false, open: true, pos: null,
  seqs: [{ name: 'Seq 1', steps: [] }, { name: 'Seq 2', steps: [] }, { name: 'Seq 3', steps: [] }],
};
const S = Object.assign({}, DEF, GM_getValue('settings', {}) || {});
if (!Array.isArray(S.seqs) || S.seqs.length !== 3) S.seqs = JSON.parse(JSON.stringify(DEF.seqs));
const save = () => GM_setValue('settings', S);

/* ---------- reading the page ---------- */
function readBonuses(el) {
  const out = [], seen = {};
  const scope = el.closest('[class*="weaponWrapper"]') || el;
  for (const n of scope.querySelectorAll('[data-bonus-attachment-title], i[class*="bonus-attachment-"]')) {
    const title = n.getAttribute('data-bonus-attachment-title') || n.getAttribute('aria-label') || n.getAttribute('title') || '';
    const id = bonusId(title);
    if (!id || seen[id]) continue;
    const desc = n.getAttribute('data-bonus-attachment-description') || '';
    const m = /(\d+(?:\.\d+)?)\s*%/.exec(desc) || /(\d+)\s*turn/i.exec(desc);
    seen[id] = 1;
    out.push({ id, name: BONUS[id], value: m ? Number(m[1]) : null, unit: m && /turn/i.test(m[0]) ? ' turns' : '%' });
  }
  return out;
}
function readWeapons() {
  const w = {};
  for (const s of SLOTS) {
    const el = document.querySelector(s.sel);
    const usable = !!el && !/emptySlot/i.test(String(el.className || '')) && el.getAttribute('aria-disabled') !== 'true';
    w[s.key] = { el, usable, name: el ? (el.getAttribute('aria-label') || '').replace(/^Attack with\s*/i, '').trim() : '', bonuses: el ? readBonuses(el) : [] };
  }
  return w;
}
const hp = (el) => { const m = /([\d,]+)\s*\/\s*([\d,]+)/.exec(el.textContent || ''); if (!m) return null; const cur = Number(m[1].replace(/,/g, '')), max = Number(m[2].replace(/,/g, '')); return max > 0 ? { cur, max } : null; };
function readHealth() {
  const els = Array.from(document.querySelectorAll('[id*="player-health-value"]'));
  let me = null, opp = null;
  for (const el of els) {
    const id = el.id || '';
    const box = el.closest('[class*="player___"]');
    const mine = /attacker/i.test(id) ? true : /defender/i.test(id) ? false : box ? !!box.querySelector('[aria-describedby*="label_attacker_"]') : null;
    if (mine === true && !me) me = hp(el); else if (mine === false && !opp) opp = hp(el);
  }
  if (!me && !opp && els.length === 2) { me = hp(els[0]); opp = hp(els[1]); }
  return { me, opp };
}
function findStart() {
  for (const box of document.querySelectorAll(DIALOG)) for (const b of box.querySelectorAll(':scope > button')) if (/start\s*fight/i.test((b.textContent || '').trim()) && !b.disabled) return b;
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

/* ---------- perks and weapon stats (pure) ---------- */
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
// Perk damage % that applies to the weapon in this slot.
function perkPct(P, key, g, W) {
  if (!P) return 0;
  const t = typeKey(g && g.type);
  let p = P.all + (P.dmg[key] || 0) + (t && t !== key ? P.dmg[t] || 0 : 0);
  if (P.fire && W && has(W[key], 'burn')) p += P.fire / 2;
  return p;
}
// A ranking figure (not a damage prediction): listed damage x always-on bonuses x perks x hit chance at even speed and dexterity.
function score(P, key, g, W) {
  if (!g || !(g.damage > 0)) return null;
  const b = (W && W[key] ? W[key].bonuses : []).filter((x) => x.id === 'powerful' || x.id === 'specialist').reduce((a, x) => a + (x.value || 0), 0);
  const t = typeKey(g.type), acc = Math.max(1, Math.min(100, (g.accuracy || 50) + (P ? P.accAll + (P.acc[key] || 0) + (t ? P.acc[t] || 0 : 0) : 0)));
  return g.damage * (1 + (b + perkPct(P, key, g, W)) / 100) * acc / 100;
}
function rank(W, I) {
  const out = {};
  for (const k of ['primary', 'secondary', 'melee']) out[k] = I && I.gear ? score(I.perks, k, I.gear[k], W) : null;
  return out;
}
const bestMain = (W, I, usableOnly) => { const r = rank(W, I); const ks = Object.keys(r).filter((k) => r[k] != null && (!usableOnly || (W[k] && W[k].usable))); return ks.length ? ks.sort((a, b) => r[b] - r[a])[0] : null; };

/* ---------- the plan (pure: no page access, so it can be tested on its own) ---------- */
const has = (w, id) => !!w && w.bonuses.some((b) => b.id === id);
const withBonus = (W, ids, usableOnly) => SLOTS.map((s) => s.key).find((k) => (!usableOnly || W[k].usable) && ids.some((id) => has(W[k], id))) || null;
const modeList = (W) => Object.keys(MODES).filter((m) => m === 'normal' || m === 'mug' || m === 'merc' || withBonus(W, MODES[m].bonus));
const finishWord = (s) => (s.mode === 'war' ? s.warFinish : (MODES[s.mode] || {}).finish || s.finish) || 'leave';

function buildPlan(W, s, I) {
  const main = s.main === 'best' ? bestMain(W, I, true) || bestMain(W, I) || 'primary' : s.main;
  if (/^seq[0-2]$/.test(s.plan)) return (s.seqs[Number(s.plan.slice(3))].steps || []).filter((x) => x && SLOT[x.w]).map((x) => ({ w: x.w, n: Number(x.n) || 0, by: x.by === 'use' ? 'use' : 'hit' }));
  const steps = [], auto = s.plan === 'auto';
  const ass = withBonus(W, ['assassinate']);
  if (ass && (auto || s.assFirst)) steps.push({ w: ass, n: 1, by: 'use', why: 'Assassinate' });
  if (auto || s.tempFirst) steps.push({ w: 'temp', n: 1, by: 'use', why: 'Temp' });
  if (auto) {
    const bs = withBonus(W, ['blindside']);
    if (bs) steps.push({ w: bs, n: 0, by: 'full', why: 'Blindside' });
    for (const k of ['primary', 'secondary', 'melee']) {
      const d = W[k].bonuses.find((b) => DEBUFFS.includes(b.id));
      if (d && k !== main) steps.push({ w: k, n: 2, by: 'hit', why: d.name });
    }
  }
  steps.push({ w: main, n: 0, by: 'use', why: s.main === 'best' && bestMain(W, I) ? 'Best' : '' });
  return steps;
}
// What the next press should use. F is the fight so far; H is { me, opp } health (either may be null).
function choose(W, s, F, H, I) {
  const pct = H && H.opp ? (H.opp.cur / H.opp.max) * 100 : null;
  const fin = s.mode !== 'normal' ? withBonus(W, MODES[s.mode].bonus, true) : null;
  if (fin && pct != null && pct <= s.finishAt) return { key: fin, why: MODES[s.mode].label, step: -1 };
  if (!fin && s.execute) {
    const k = withBonus(W, ['execute'], true);
    const b = k && W[k].bonuses.find((x) => x.id === 'execute');
    if (b && b.value && pct != null && pct <= b.value) return { key: k, why: 'Execute', step: -1 };
  }
  const plan = buildPlan(W, s, I);
  let i = F.step, uses = F.stepUses, hits = F.stepHits;
  for (; i < plan.length; i++, uses = 0, hits = 0) {
    const st = plan[i], last = i === plan.length - 1;
    if (!W[st.w] || !W[st.w].usable) continue;
    if (st.by === 'full') { if (H && H.opp ? H.opp.cur >= H.opp.max : uses < 1) return { key: st.w, why: st.why, step: i }; continue; }
    const count = st.by === 'hit' && F.hpOk ? hits : uses;
    if (st.n > 0 && count >= st.n && !last) continue;
    return { key: st.w, why: st.why || '', step: i };
  }
  const next = bestMain(W, I, true);
  for (const k of [s.fallback === 'best' ? next : s.fallback, next, 'primary', 'secondary', 'melee']) if (k && W[k] && W[k].usable) return { key: k, why: 'Fallback', step: -1 };
  return null;
}
// Fold the result of the last press into the fight record (did their health drop?).
function settle(F, H) {
  const n = Object.assign({}, F);
  if (F.last && H && H.opp && F.lastOpp != null) { n.hpOk = true; if (H.opp.cur < F.lastOpp) { n.hits = F.hits + 1; if (F.lastStep === F.step) n.stepHits = F.stepHits + 1; } }
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
const newFight = () => ({ step: 0, stepUses: 0, stepHits: 0, hits: 0, turn: 0, last: null, lastStep: -1, lastOpp: null, hpOk: false });
if (window.__TUCC_TEST) window.__tuccCombatDesk = { parsePerks, perkPct, score, rank, bestMain, typeKey, buildPlan, choose, settle, advance, newFight, bonusId, modeList, finishWord, DEF };

/* ---------- the button ---------- */
GM_addStyle(`#tucc-cd{position:fixed;z-index:2147481000;width:168px;font:600 12px/16px Arial,sans-serif;color:#eee;user-select:none;-webkit-user-select:none;touch-action:manipulation}
#tucc-cd .cd-main{display:block;width:100%;min-height:58px;border:1px solid #c33;border-radius:10px;background:#9f1d1d;color:#fff;font:700 16px/20px Arial,sans-serif;cursor:pointer;padding:6px 8px;box-shadow:0 2px 8px rgba(0,0,0,.5)}
#tucc-cd .cd-main:active{background:#7d1616}
#tucc-cd .cd-main small{display:block;font:600 11px/14px Arial,sans-serif;opacity:.85;min-height:14px}
#tucc-cd .cd-main[disabled]{opacity:.5;cursor:default}
#tucc-cd .cd-pan{margin-top:4px;background:#1c1c1c;border:1px solid #444;border-radius:8px;padding:5px}
#tucc-cd .cd-row{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:4px}
#tucc-cd .cd-row:last-child{margin-bottom:0}
#tucc-cd .cd-c{flex:1 1 auto;min-width:30px;min-height:26px;border:1px solid #555;border-radius:6px;background:#2a2a2a;color:#ddd;font:600 11px/14px Arial,sans-serif;cursor:pointer;padding:2px 5px}
#tucc-cd .cd-c.on{background:#9f1d1d;border-color:#c33;color:#fff}
#tucc-cd .cd-c.miss{border-style:dashed}
#tucc-cd .cd-w{font:400 11px/15px Arial,sans-serif;color:#bbb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#tucc-cd .cd-w b{color:#fff}
#tucc-cd .cd-grip{cursor:move}
#tucc-cd.locked .cd-grip{display:none}
#tucc-win-combatdesk select,#tucc-win-combatdesk input[type=text]{background:#222;color:#eee;border:1px solid #555;border-radius:4px;padding:2px 4px;font:12px Arial,sans-serif}
#tucc-win-combatdesk .cd-g{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;margin-bottom:10px}
#tucc-win-combatdesk .cd-seq{margin-bottom:10px}
#tucc-win-combatdesk .cd-st{display:flex;gap:4px;margin-top:3px}
@media (max-width:640px){#tucc-cd{width:150px}#tucc-cd .cd-main{min-height:64px}}`);

// Your perks and equipped weapon stats, from the Torn API (optional). One read when the attack page opens; never repeated on a timer.
let INTEL = { perks: null, gear: {} };
const flat = (o, out) => { if (typeof o === 'string') out.push(o); else if (o && typeof o === 'object') for (const k in o) flat(o[k], out); return out; };
async function loadIntel() {
  if (!tucc.key || !tucc.key()) return;
  try { const j = await tucc.api('/v2/user/perks', {}, { ttl: 3600 }); INTEL.perks = parsePerks(flat(j && (j.perks || j), [])); } catch (e) { /* works without */ }
  try {
    const j = await tucc.api('/v2/user/equipment', {}, { ttl: 120 });
    const W = readWeapons(), bySlot = { 1: 'primary', 2: 'secondary', 3: 'melee', 5: 'temp' };
    for (const it of (j && j.equipment) || []) {
      if (!it || !it.stats || !(it.stats.damage > 0)) continue;
      const nm = String(it.name || '').toLowerCase();
      const key = SLOTS.map((s) => s.key).find((k) => W[k].name && W[k].name.toLowerCase() === nm) || bySlot[it.slot];
      if (key && !INTEL.gear[key]) INTEL.gear[key] = { damage: it.stats.damage, accuracy: it.stats.accuracy, type: it.sub_type || '', ammo: it.ammo || null };
    }
  } catch (e) { /* works without */ }
  lastHtml = ''; render();
}
let F = newFight(), startAt = 0, finishAt = 0, hitAt = 0, fightKey = '';
const root = document.createElement('div'); root.id = 'tucc-cd';
root.innerHTML = '<button type="button" class="cd-main"></button><div class="cd-pan"></div>';
const mainBtn = root.firstChild, pan = root.lastChild;
const w = tucc.ui.window('combatdesk', 'Combat Desk', '');

function place() {
  const p = S.pos, W = window.innerWidth, H = window.innerHeight;
  if (p) { root.style.left = Math.max(0, Math.min(W - 60, p.x)) + 'px'; root.style.top = Math.max(0, Math.min(H - 60, p.y)) + 'px'; root.style.right = 'auto'; root.style.bottom = 'auto'; }
  else { root.style.top = 'auto'; root.style.bottom = '90px'; root.style.left = S.side === 'left' ? '10px' : 'auto'; root.style.right = S.side === 'left' ? 'auto' : '10px'; }
  root.classList.toggle('locked', !!S.locked);
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
    startAt = t; F = newFight();
    start.click();
    return;
  }
  if (t - hitAt < 150) return;
  const W = readWeapons(), H = readHealth();
  F = settle(F, H);
  const pick = choose(W, S, F, H, INTEL);
  if (!pick || !W[pick.key].el) return;
  hitAt = t;
  F = advance(F, pick, H);
  W[pick.key].el.click();
}
mainBtn.addEventListener('click', act);

function chip(act, val, text, on, extra) { return `<button type="button" class="cd-c${on ? ' on' : ''}${extra || ''}" data-act="${act}" data-val="${esc(val)}">${esc(text)}</button>`; }
let lastHtml = '', lastMain = '';
function render() {
  const key = location.search;
  if (key !== fightKey) { fightKey = key; F = newFight(); }
  const W = readWeapons(), H = readHealth();
  const fin = findFinish(finishWord(S)), start = !fin && findStart();
  let big = '', small = '';
  if (fin) { big = fin === 'unknown' ? 'Finish' : (fin.textContent || '').trim(); small = MODES[S.mode].label; }
  else if (start) { big = 'Start'; small = MODES[S.mode].label; if (F.turn) F = newFight(); }
  else {
    const pick = choose(W, S, settle(F, H), H, INTEL);
    big = pick ? SLOT[pick.key].label : 'No weapon';
    small = pick ? pick.why : '';
  }
  const mh = `${esc(big)}<small>${esc(small)}</small>`;
  if (mh !== lastMain) { mainBtn.innerHTML = mh; lastMain = mh; }
  let h = '';
  if (S.open) {
    const modes = modeList(W);
    if (!modes.includes(S.mode)) S.mode = 'normal';
    h += '<div class="cd-row">' + modes.map((m) => chip('mode', m, MODES[m].label, S.mode === m, m !== 'normal' && !withBonus(W, MODES[m].bonus) ? ' miss' : '')).join('') + '</div>';
    h += '<div class="cd-row">' + chip('plan', 'auto', 'Auto', S.plan === 'auto') + chip('plan', 'single', '1 Wpn', S.plan === 'single')
      + S.seqs.map((q, i) => (q.steps || []).length ? chip('plan', 'seq' + i, q.name || 'Seq ' + (i + 1), S.plan === 'seq' + i) : '').join('') + '</div>';
    h += SLOTS.map((s) => { const pk = Math.round(perkPct(INTEL.perks, s.key, INTEL.gear[s.key], W)); const parts = W[s.key].bonuses.map((b) => esc(b.name) + (b.value != null ? ' ' + b.value + esc(b.unit) : '')); if (pk) parts.push('Perks +' + pk + '%'); return parts.length ? `<div class="cd-w"><b>${s.short}</b> ${parts.join(', ')}</div>` : ''; }).join('');
  }
  h += '<div class="cd-row">' + chip('open', '', S.open ? '▴' : '▾', false) + chip('lock', '', S.locked ? '🔒' : '🔓', S.locked) + chip('set', '', '⚙', false) + '<button type="button" class="cd-c cd-grip" data-act="grip">✥</button></div>';
  if (h !== lastHtml) { pan.innerHTML = h; lastHtml = h; }
}
pan.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b || !e.isTrusted) return;
  const a = b.dataset.act, v = b.dataset.val;
  if (a === 'mode') S.mode = v; else if (a === 'plan') { S.plan = v; F = Object.assign(newFight(), { turn: F.turn }); }
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
    + `<span>War finish</span><select data-k="warFinish">${fo(S.warFinish)}</select>`
    + `<span>Finisher at</span><select data-k="finishAt" data-num="1">${[5, 10, 15, 20, 25, 30].map((n) => opt(n, n + '% life', S.finishAt)).join('')}</select>`
    + `<span>Side</span><select data-k="side">${opt('right', 'Right', S.side)}${opt('left', 'Left', S.side)}</select>`
    + '</div><div class="cd-g" style="grid-template-columns:1fr 1fr">'
    + sw('tempFirst', 'Temp first')
    + (withBonus(W, ['assassinate']) ? sw('assFirst', 'Assassinate first') : '')
    + (withBonus(W, ['execute']) ? sw('execute', 'Execute') : '')
    + sw('sticky', 'Keep mode') + '</div>';
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
  save(); place(); render();
});
w.body.addEventListener('click', (e) => { if (e.target.closest('[data-act="resetpos"]')) { S.pos = null; save(); place(); } });

/* ---------- start ---------- */
(document.body || document.documentElement).appendChild(root);
place(); render(); loadIntel();
let queued = false;
new MutationObserver(() => { if (queued) return; queued = true; setTimeout(() => { queued = false; render(); }, 120); }).observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-disabled', 'disabled'] });
window.addEventListener('resize', place);
