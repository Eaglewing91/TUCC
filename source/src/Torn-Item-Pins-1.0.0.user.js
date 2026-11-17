// ==UserScript==
// @name         Torn Item Pins
// @namespace    https://github.com/Eaglewing91
// @version      1.0.0
// @author       Eaglewing [571041]
// @description  Pin your favourite items to the top of your Items page. Click the pin on any item to keep it at the top of its tab. Only rearranges the page you're viewing; makes no requests and never uses, equips or sends anything.
// @match        https://www.torn.com/item.php*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
 * HOW IT WORKS
 *  - Adds a small pin button to every item row on item.php.
 *  - Pinned items are moved to the top of each tab's list (in the order you pinned them).
 *  - Weapons and armour are pinned individually (by their unique ID), so pinning one Kodachi
 *    doesn't pin your other Kodachis. Stackable items (drugs, candy, medical...) are pinned by
 *    item type.
 *
 * COMPLIANCE
 *  - Only reorders the list that's already on the page you're viewing. Makes no requests.
 *  - The pin button only pins/unpins; its clicks are stopped so they never reach Torn's own
 *    buttons (use, equip, send, trash...).
 *  - It doesn't load more items for you. Items Torn hasn't loaded yet (further down the list)
 *    jump to the top as soon as Torn loads them.
 *
 * Terms of Service
 * | Data Storage          | Only locally (your pinned items, in your browser's localStorage) |
 * | Data Sharing          | Nobody                                                           |
 * | Purpose of Use        | Other: organising your own Items page                            |
 * | Key Storage & Sharing | Not stored / Not shared (no API key is used)                     |
 * | Key Access Level      | None required                                                    |
 */

(function () {
  'use strict';
  if (window.__tipLoaded) return;
  window.__tipLoaded = true;

  /* ---------------- pins (local only) ---------------- */
  const KEY = 'tip-pins-v1';
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  let pins = load();                                   // [{ k, n }] in pin order
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pins)); } catch { /* storage blocked */ } };
  const order = () => new Map(pins.map((p, i) => [p.k, i]));

  // Unique weapons/armour use their armoury ID; stackables use their item type.
  const keyOf = (li) => li.dataset.armoryid ? 'u' + li.dataset.armoryid : (li.dataset.item ? 'i' + li.dataset.item : null);
  const nameOf = (li) => (li.querySelector('.title-wrap .name')?.textContent || li.dataset.sort || 'Item').trim();
  const rows = (ul) => [...ul.children].filter((li) => li.matches('li[data-item]'));

  function togglePin(li) {
    const k = keyOf(li);
    if (!k) return;
    const i = pins.findIndex((p) => p.k === k);
    if (i >= 0) pins.splice(i, 1);
    else pins.push({ k, n: nameOf(li) });
    save();
    apply();
  }

  /* ---------------- pin button ---------------- */
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

  function addButton(li) {
    const host = li.querySelector('.title-wrap .name-wrap') || li.querySelector('.title-wrap');
    if (!host || host.querySelector('.tip-pin')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tip-pin';
    b.textContent = '📌';
    for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'dblclick']) b.addEventListener(ev, stop, true);
    b.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { capture: true, passive: true });
    b.addEventListener('click', (e) => { stop(e); togglePin(li); }, true);
    host.appendChild(b);
  }

  function paint(li, pinned) {
    li.classList.toggle('tip-pinned', pinned);
    const b = li.querySelector('.tip-pin');
    if (b) {
      b.classList.toggle('on', pinned);
      b.title = pinned ? 'Unpin from top' : 'Pin to top';
      b.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${nameOf(li)}`);
      b.setAttribute('aria-pressed', String(pinned));
    }
  }

  /* ---------------- reorder ---------------- */
  let busy = false;
  let seen = 0;
  function apply() {
    if (busy) return;
    busy = true;
    try {
      const pos = order();
      for (const ul of document.querySelectorAll('ul.items-cont')) {
        const list = rows(ul);
        if (!list.length) continue;
        // Remember each row's original place in Torn's list the first time we see it
        // (rows we haven't moved are still in Torn's order, so new rows slot in after them)
        for (const li of list) {
          addButton(li);
          paint(li, pos.has(keyOf(li)));
          if (li.__tipIdx === undefined) li.__tipIdx = ++seen;
        }
        // Unpinned items go back to their original place among the other unpinned items
        for (const li of list) {
          if (pos.has(keyOf(li)) || !li.__tipMoved) continue;
          delete li.__tipMoved;
          const before = rows(ul).find((o) => o !== li && !pos.has(keyOf(o)) && o.__tipIdx > li.__tipIdx);
          if (before) ul.insertBefore(li, before); else ul.appendChild(li);
        }
        const pinned = rows(ul).filter((li) => pos.has(keyOf(li))).sort((a, b) => pos.get(keyOf(a)) - pos.get(keyOf(b)));
        for (const li of pinned) li.__tipMoved = true;
        // Only touch the DOM if the top of the list isn't already in the right order
        const top = rows(ul).slice(0, pinned.length);
        if (pinned.every((li, i) => top[i] === li)) continue;
        // Move pinned rows to the top, last one first, so they end up in pin order
        for (let i = pinned.length - 1; i >= 0; i--) ul.insertBefore(pinned[i], ul.firstElementChild);
      }
    } finally {
      busy = false;
    }
  }

  /* ---------------- styles ---------------- */
  function addStyles() {
    if (document.getElementById('tip-css')) return;
    const s = document.createElement('style');
    s.id = 'tip-css';
    s.textContent = `
      .tip-pin{display:inline-flex;align-items:center;justify-content:center;width:22px;height:20px;margin:0 0 0 6px;padding:0;
        border:1px solid transparent;border-radius:4px;background:none;cursor:pointer;font-size:12px;line-height:1;vertical-align:middle;
        opacity:.35;filter:grayscale(1);transition:opacity .15s}
      .tip-pin:hover,.tip-pin:focus-visible{opacity:.9;filter:none;border-color:#888;outline:none}
      .tip-pin.on{opacity:1;filter:none}
      li.tip-pinned{box-shadow:inset 3px 0 0 #e8a33d}
      @media (hover:none){ .tip-pin{width:28px;height:26px;opacity:.55} }`;
    document.head.appendChild(s);
  }

  /* ---------------- run ---------------- */
  let timer = null;
  const schedule = () => { if (!timer && !busy) timer = setTimeout(() => { timer = null; apply(); }, 150); };

  // Keep pins in sync with other open Torn tabs
  window.addEventListener('storage', (e) => { if (e.key === KEY) { pins = load(); apply(); } });

  const start = () => {
    addStyles();
    apply();
    new MutationObserver(() => { if (!busy) schedule(); })
      .observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
