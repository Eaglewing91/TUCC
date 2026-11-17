// ==UserScript==
// @name         TUCC Big Al's Watch
// @namespace    eaglewing.torn.tucc.bigals
// @version      1.0.0
// @description  Watches the security at Big Al's Gun Shop (shoplifting) and alerts you when the cameras and guards are all down, the window for Special Ammo. TUCC version of swervelord's "Torn Big Al's Special Ammo Alert". API only (Public key).
// @author       swervelord (original script); Eaglewing [571041] (TUCC version)
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
 * Credit: original script "Torn Big Al's Special Ammo Alert" by swervelord
 * (https://greasyfork.org/en/scripts/565775). This is its TUCC version, rewritten to run on TUCC's API
 * engine, alerts and layout (the original states no licence, so its code isn't copied).
 *
 * Compliance notes
 * - Reads only the Torn API (api.torn.com, v2, key in the request header) through TUCC's shared engine:
 *   torn/shoplifting every 30 seconds while a Torn tab is visible (shared between your tabs), and
 *   torn/crimes + torn/{id}/subcrimes once a day to find Big Al's by name. Never clicks, submits or
 *   loads anything on torn.com by itself.
 * - When the cameras and guards are all down it raises a TUCC alert, and (if you leave it on) shows a
 *   slim banner at the top of the page. The banner is a plain link to the shoplifting page: one click,
 *   one page load, made by you. It doesn't flash.
 * - Stores only your settings and the last status locally.
 */

if (typeof tucc === 'undefined' || !tucc) return;
const { esc, fmt } = tucc;
const S = Object.assign({ on: true, banner: true }, GM_getValue('settings', {}) || {});
const SHOP = /big al/i;
const LINK = 'https://www.torn.com/page.php?sid=crimes#/shoplifting';
let last = GM_getValue('last', null);   // { open, status: [{ title, disabled }], at }
let ids = GM_getValue('ids', null);     // { crime, sub, at }: Shoplifting's crime ID and Big Al's sub-crime ID
let msg = '', busy = false;

// Banner style when TUCC's look is off; with it on, theme/page-bigals.css takes over (same layout, your colour theme).
GM_addStyle(`#tucc-bigals-banner{display:flex;align-items:center;justify-content:center;gap:12px;padding:8px 12px;background:#9f1d1d;color:#fff;font:600 13px/18px Arial,sans-serif;position:relative;z-index:5}
#tucc-bigals-banner a{color:#fff;text-decoration:underline}
#tucc-bigals-banner button{background:transparent;border:1px solid rgba(255,255,255,.6);color:#fff;border-radius:4px;font:600 12px/16px Arial,sans-serif;padding:2px 8px;cursor:pointer}`);

const w = tucc.ui.window('bigals', "Big Al's Watch", '');
w.body.addEventListener('change', onChange);
w.body.addEventListener('click', (e) => { const a = e.target.closest('[data-act]'); if (a && a.dataset.act === 'check') check(true); });

// Find Big Al's Gun Shop in Torn's crime list, once a day (Torn's v2 shoplifting reply lists shops by ID only).
async function findShop() {
  if (ids && ids.sub && Date.now() - ids.at < 86400000) return ids;
  const c = await tucc.api('/v2/torn/crimes', {}, { ttl: 86400 });
  const crime = ((c && c.crimes) || []).find((x) => /shoplifting/i.test(x.name || ''));
  if (!crime) throw new Error('Torn did not list the Shoplifting crime.');
  const s = await tucc.api(`/v2/torn/${crime.id}/subcrimes`, {}, { ttl: 86400 });
  const sub = ((s && s.subcrimes) || []).find((x) => SHOP.test(x.name || ''));
  if (!sub) throw new Error("Torn did not list Big Al's Gun Shop.");
  ids = { crime: crime.id, sub: sub.id, at: Date.now() };
  GM_setValue('ids', ids);
  return ids;
}

// Cameras and guards all disabled = the shop is open for Special Ammo.
const isOpen = (status) => {
  const watch = status.filter((x) => /camera|guard/i.test(x.title || ''));
  return watch.length > 0 && watch.every((x) => x.disabled === true);
};

async function check(manual) {
  if (busy) return;
  busy = true;
  try {
    const { sub } = await findShop();
    const j = await tucc.api('/v2/torn/shoplifting', {}, { ttl: 30 });
    const shop = ((j && j.shoplifting) || []).find((x) => Number(x.id) === Number(sub));
    if (!shop) { ids = null; GM_setValue('ids', null); throw new Error("Big Al's wasn't in Torn's shoplifting list. It will look it up again."); }
    const status = (shop.status || []).map((x) => ({ title: String(x.title || ''), disabled: x.disabled === true }));
    const open = isOpen(status);
    if (open && !(last && last.open)) {
      tucc.alert({ id: 'bigals-open', title: "Big Al's: cameras and guards are down", text: 'Special Ammo can be shoplifted now. It may not last long.', level: 'warn', url: LINK, repeatAfter: 900 });
    }
    last = { open, status, at: Date.now(), hidden: open && last && last.open ? !!last.hidden : false };   // ✕ lasts until it next opens
    GM_setValue('last', last);
    msg = '';
  } catch (e) {
    msg = e.code === 'nokey' ? 'Add a key in API Keys.' : e.message;
  } finally {
    busy = false; banner(); render();
  }
}

// Slim banner at the top of the page while the shop is open (your setting). A plain link; it never flashes.
function banner() {
  const show = S.on && S.banner && last && last.open && Date.now() - last.at < 5 * 60000;
  let el = document.getElementById('tucc-bigals-banner');
  if (!show) { if (el) el.remove(); return; }
  if (el || last.hidden) return;
  el = document.createElement('div');
  el.id = 'tucc-bigals-banner';
  el.setAttribute('role', 'status');
  el.innerHTML = `<a href="${LINK}">Big Al's: cameras and guards are down</a><button type="button" aria-label="Hide until it next opens">✕</button>`;
  el.querySelector('button').addEventListener('click', () => { el.remove(); last.hidden = true; GM_setValue('last', last); });
  document.body.prepend(el);
}

function render() {
  if (!w.isOpen()) return;
  const rows = last && last.status.length
    ? last.status.map((x) => `<tr><td>${esc(x.title)}</td><td>${x.disabled ? '<span class="good">down</span>' : '<span class="muted">active</span>'}</td></tr>`).join('')
    : '';
  const head = !last ? '<span class="muted">Checking…</span>'
    : last.open ? `<b class="good">Open: cameras and guards are down.</b> <a href="${LINK}">Go to shoplifting</a>`
    : '<b>Closed:</b> <span class="muted">security is up.</span>';
  w.set(`
    <div class="row" style="margin-bottom:8px;gap:16px">
      <label class="row"><input type="checkbox" data-on${S.on ? ' checked' : ''}> Watching</label>
      <label class="row"><input type="checkbox" data-banner${S.banner ? ' checked' : ''}> Banner</label>
      <button type="button" class="b" data-act="check" style="margin-left:auto"${busy ? ' disabled' : ''}>Check now</button>
    </div>
    <div class="card"><div>${head}</div>${last ? `<div class="muted" style="font-size:12px;margin-top:4px">Checked ${fmt.ago(Math.floor(last.at / 1000))}</div>` : ''}</div>
    ${msg ? `<div class="note bad">${esc(msg)}</div>` : ''}
    ${rows ? `<table style="margin-top:8px"><thead><tr><th>Security</th><th>Now</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
`);
}

function onChange(e) {
  if (e.target.matches('[data-on]')) { S.on = e.target.checked; GM_setValue('settings', S); schedule(); banner(); render(); }
  else if (e.target.matches('[data-banner]')) { S.banner = e.target.checked; GM_setValue('settings', S); banner(); }
}

let timer = null;
function schedule() {
  if (timer) { timer.stop(); timer = null; }
  if (!S.on) return;
  timer = tucc.every(30000, () => { if (S.on) check(false); });   // tucc.every: only while a Torn tab is visible
}
schedule();
banner();

w.onopen = () => render();
tucc.menu("Open Big Al's Watch", () => w.open());
if (w.wasOpen()) w.open();
