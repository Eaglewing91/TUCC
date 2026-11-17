// ==UserScript==
// @name         Cash Desk
// @namespace    eaglewing.torn.cashdesk
// @version      1.1.0
// @description  Cash Desk (formerly Vault Presets + Quick Cash 3.1.0): one-click deposit/withdraw presets for your property vault and company funds, Deposit All, and Offer All Cash on trades. One click = one press of Torn's own button; never confirms for you. Based on Eaglewing's earlier:
//               - Torn - Vault Preset Buttons (Deposit & Withdraw + Company Funds) v1.1.1
//               - Torn - Quick Cash Actions (Vault + Trade + Faction) v2.10
//
//               Enabled pages:
//               - Property Vault (presets + one-click deposit ABOVE presets)
//               - Company Funds (deposit + withdraw presets)
//               - Trade (one-click offer all cash)
//
//               Disabled pages:
//               - ALL Faction pages (including armoury): no UI injected, no logic executed
//
//               UI updates:
//               - Preset money options are side-by-side on a single row
//               - v3.1.0: one native action attempt per real user click, no automated confirmation
//               - Uses only visible, manually opened pages; no direct network requests
//               - Torn may still show a confirmation; confirm manually if required
//
// @author       Eaglewing [571041]
// @license      MIT
// @match        https://www.torn.com/property.php*
// @match        https://www.torn.com/properties.php*
// @match        https://www.torn.com/companies.php*
// @match        https://www.torn.com/trade.php*
// @grant        none
// ==/UserScript==

// SAFETY NOTE: The script issues no direct requests and initiates only one
// native Torn action per manual button click. Whether that native handler sends
// one request or displays a confirmation must be checked in the live browser.
// If a confirmation appears, press it yourself. Torn staff are the final
// authority on rules compliance; the script does not guarantee approval.

// TUCC: your own preset amounts (Deposit, Withdraw and Trade lists), kept in this browser. Editing them sends nothing.
const CD_PRESETS = (() => {
  const KEY = 'cashdesk_presets_v1', MAX = 8;
  const DEF = { dep: [25e6, 50e6, 100e6, 250e6, 500e6], wit: [25e6, 50e6, 100e6, 250e6, 500e6], trade: [10e6, 50e6, 100e6, 250e6] };
  const clean = (a, d) => (Array.isArray(a) ? a.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, MAX) : d.slice());
  const load = () => { let p = null; try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {} p = p || {}; return { dep: clean(p.dep, DEF.dep), wit: clean(p.wit, DEF.wit), trade: clean(p.trade, DEF.trade) }; };
  let cur = load();
  const short = (n) => (n >= 1e9 ? +(n / 1e9).toFixed(2) + 'b' : n >= 1e6 ? +(n / 1e6).toFixed(2) + 'm' : n >= 1e3 ? +(n / 1e3).toFixed(1) + 'k' : String(n));
  const parse = (text) => String(text || '').split(/[,;\s]+/).filter(Boolean).map((t) => {
    const m = /^\$?([\d.,]*\d)\s*([kmb]?)$/i.exec(t.trim()); if (!m) return NaN;
    return Math.round(parseFloat(m[1].replace(/,/g, '')) * { k: 1e3, m: 1e6, b: 1e9, '': 1 }[m[2].toLowerCase()]);
  }).filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, MAX);
  const listeners = [];
  return {
    get: (kind) => cur[kind].slice(), short, parse, onChange: (fn) => listeners.push(fn),
    set(kind, list) { cur[kind] = list.length ? list : DEF[kind].slice(); try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) {} listeners.forEach((fn) => { try { fn(); } catch (e) {} }); },
    reset(kind) { this.set(kind, DEF[kind].slice()); },
    // A small ✎ button that opens an inline editor under the strip (local only, no requests).
    editButton(kind, holder) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cd-edit'; b.textContent = '✎'; b.title = 'Edit these preset amounts';
      b.setAttribute('style', 'background:none;border:1px solid #555;color:inherit;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:12px;line-height:16px');
      b.addEventListener('click', () => {
        const open = holder.nextElementSibling && holder.nextElementSibling.classList.contains('cd-editor');
        if (open) { holder.nextElementSibling.remove(); return; }
        const ed = document.createElement('div');
        ed.className = 'cd-editor';
        ed.setAttribute('style', 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;font-size:12px');
        ed.innerHTML = `<input type="text" class="cd-ed-in" style="flex:1;min-width:180px;padding:4px 6px;border-radius:4px;border:1px solid #555;background:#1b1b1b;color:#eee" aria-label="Preset amounts">
          <button type="button" class="cd-ed-save" style="padding:4px 10px;border-radius:4px;cursor:pointer">Save</button>
          <button type="button" class="cd-ed-reset" style="padding:4px 10px;border-radius:4px;cursor:pointer">Default</button>
          <span class="cd-ed-note" style="width:100%;opacity:.85">Up to ${MAX} amounts, separated by commas: e.g. 5m, 75m, 1.5b</span>`;
        const inp = ed.querySelector('.cd-ed-in');
        inp.value = cur[kind].map(short).join(', ');
        const save = () => { const list = parse(inp.value); if (!list.length) { ed.querySelector('.cd-ed-note').textContent = 'No valid amounts. Use numbers like 25m or 1.5b.'; return; } CD_PRESETS.set(kind, list); };
        ed.querySelector('.cd-ed-save').addEventListener('click', save);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
        ed.querySelector('.cd-ed-reset').addEventListener('click', () => CD_PRESETS.reset(kind));
        holder.insertAdjacentElement('afterend', ed);
        inp.focus();
      });
      return b;
    },
  };
})();



/* =====================================================================
 * MODULE 1 (Based on your original v1.1.1):
 * Vault Preset Buttons - PROPERTY + COMPANY ONLY
 * - Updated: presets displayed side-by-side (single row)
 * ===================================================================== */
(function () {
  'use strict';

  const PRESETS_MILLIONS = [25, 50, 100, 250, 500]; // m

  // Single-row, side-by-side layout (no wrap)
  const HOLDER_STYLE = `
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    flex-wrap: nowrap;
  `;

  // Spacing handled by flex gap
  const BTN_STYLE = `
    background: linear-gradient(#3a8b2f, #23581a);
    color: #fff;
    font-weight: 600;
    border: 1px solid #1a3a12;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
    line-height: 16px;
    box-shadow: 0 0 6px rgba(0,0,0,.6);
    white-space: nowrap;
  `;

  const GROUP_TAG_STYLE = `
    display:inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    background: #223322;
    color:#d0f0d0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing:.2px;
    white-space: nowrap;
  `;

  // One real user gesture -> at most one native Torn action attempt.
  // The script never sends its own fetch/XHR or submits a form separately.
  const lastActionByButton = new WeakMap();
  const ACTION_COOLDOWN_MS = 1200;

  function isManualForegroundClick(event, customButton) {
    if (!event.isTrusted || document.visibilityState !== 'visible' || !document.hasFocus()) {
      return false;
    }
    const now = Date.now();
    if ((lastActionByButton.get(customButton) || 0) > now) return false;
    lastActionByButton.set(customButton, now + ACTION_COOLDOWN_MS);
    return true;
  }

  // Vault room, read from the vault page you're viewing: Torn puts the limit and the stored amount on the
  // deposit box (data-max, data-deposit) and in the text ("There is $X stored", "a maximum of $Y").
  function vaultInfo() {
    const num = (v) => { const n = Number(String(v || '').replace(/[^0-9]/g, '')); return String(v || '').trim() && Number.isSafeInteger(n) && n >= 0 ? n : null; };
    const inp = document.querySelector('.deposit-box input.input-money[data-max], .cont.torn-divider input.input-money[data-max]');
    const shown = document.getElementById('vault-wvalue');
    let stored = num(shown && shown.textContent);
    if (stored == null) stored = num(inp && inp.getAttribute('data-deposit'));
    let max = num(inp && inp.getAttribute('data-max'));
    if (!max) { const m = /maximum of\s*\$\s*([\d,]+)/i.exec(document.body.innerText || ''); max = m ? num(m[1]) : null; }
    if (stored == null || !max) return null;
    return { stored, max, room: Math.max(0, max - stored) };
  }
  window.__cashDeskVault = vaultInfo;
  // Brief note on the button itself (nothing is pressed).
  function flash(btn, text) {
    const old = btn.textContent; btn.textContent = text; btn.disabled = true;
    setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1500);
  }

  function millions(n) {
    return Math.max(0, Math.floor(Number(n || 0))) * 1_000_000;
  }

  function fillMoneyInputs(container, amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0) return false;
    const vis = container.querySelector('.input-money-group input.input-money[type="text"]');
    const hid = container.querySelector('.input-money-group input.input-money[type="hidden"]');
    if (!vis && !hid) return false;
    const value = String(amount);
    // These are local DOM updates. No money shortcut button is auto-clicked.
    if (hid) {
      hid.value = value;
      hid.setAttribute('data-money', value);
    }
    if (vis) {
      vis.value = value;
      vis.setAttribute('data-money', value);
      vis.dispatchEvent(new Event('input', {bubbles: true}));
      vis.dispatchEvent(new Event('change', {bubbles: true}));
      // Some Torn widgets sync the hidden field when an event fires.
      if (hid) hid.value = value;
    }
    return true;
  }

  function clickOriginalActionOnce(container, kind) {
    // Never reach outside this transaction block and risk clicking a different action.
    const candidates = Array.from(container.querySelectorAll(
      'input[type="submit"], button[type="submit"], button.torn-btn'
    ));
    const expected = kind.toLowerCase();
    const byName = candidates.find(btn =>
      String(btn.value || btn.textContent || '').trim().toLowerCase() === expected
    );
    // Company buttons sometimes use a generic label: there must only be one candidate.
    const target = byName || (candidates.length === 1 ? candidates[0] : null);
    if (!target || target.disabled || target.classList?.contains('disabled')) {
      console.warn(`[VaultPresets] ${kind}: Torn's native action is unavailable; no request initiated.`);
      return false;
    }
    target.click(); // The ONLY action attempt: never also call form.submit().
    return true;
  }

  // Intentionally no automatic Yes/confirmation click. Without confirming the
  // live site's request flow, that could become a second non-API action.

  // ----------------------------
  // PROPERTY VAULT (Deposit/Withdraw)
  // ----------------------------
  function getPropertyVaultDepositBlock(){
    const icons = document.querySelectorAll('.cont.torn-divider .deposit-icon');
    for (const icon of icons){
      const block = icon.closest('.cont.torn-divider');
      if (!block) continue;
      const group = block.querySelector('.input-money-group');
      const deposit = block.querySelector('input[type="submit"][value="DEPOSIT"], button[type="submit"], button.torn-btn');
      if (group && deposit) return block;
    }
    return null;
  }

  function getPropertyVaultWithdrawBlock(){
    const candidates = document.querySelectorAll('.cont.torn-divider');
    for (const c of candidates){
      const group = c.querySelector('.input-money-group');
      const withdraw = Array.from(c.querySelectorAll('input[type="submit"], button[type="submit"], button.torn-btn'))
        .find(btn => String(btn.value || btn.textContent || '').trim().toLowerCase() === 'withdraw');
      if (group && withdraw) return c;
    }
    return null;
  }

  function injectPropertyButtons(){
    const depBlock = getPropertyVaultDepositBlock();
    if (depBlock && !depBlock.querySelector('.vault-presets-dep')){
      const wrap = depBlock.querySelector('.btn-wrap.silver')?.parentElement || depBlock;
      const holder = document.createElement('div');
      holder.className = 'vault-presets-dep';
      holder.setAttribute('style', HOLDER_STYLE);

      const label = document.createElement('span');
      label.setAttribute('style', GROUP_TAG_STYLE);
      label.textContent = 'Deposit:';
      holder.appendChild(label);

      CD_PRESETS.get('dep').forEach(preset=>{
        const btn = document.createElement('button');
        btn.type='button';
        btn.setAttribute('style', BTN_STYLE);
        btn.textContent = CD_PRESETS.short(preset);
        btn.addEventListener('click', (event)=>{
          if (!isManualForegroundClick(event, btn)) return;
          let amount = preset;
          const v = vaultInfo();
          if (v) {
            if (v.room <= 0) { flash(btn, 'Vault full'); return; }
            if (amount > v.room) amount = v.room;           // only what fits: Torn refuses more than the vault holds
          }
          // TUCC: never more than the cash you're carrying (read from Torn's money display on this page)
          const um = document.getElementById('user-money'), cash = um ? Number(um.getAttribute('data-money')) : NaN;
          if (Number.isSafeInteger(cash)) { if (cash <= 0) { flash(btn, 'No cash'); return; } if (amount > cash) amount = cash; }
          if (!fillMoneyInputs(depBlock, amount)) return;
          if (clickOriginalActionOnce(depBlock, 'Deposit'))
            console.log(`[VaultPresets] Property DEPOSIT $${amount.toLocaleString()}: single native action triggered.`);
        });
        holder.appendChild(btn);
      });
      holder.appendChild(CD_PRESETS.editButton('dep', holder));

      wrap.appendChild(holder);
    }

    const witBlock = getPropertyVaultWithdrawBlock();
    if (witBlock && !witBlock.querySelector('.vault-presets-wit')){
      const wrap = witBlock.querySelector('.btn-wrap.silver')?.parentElement || witBlock;
      const holder = document.createElement('div');
      holder.className = 'vault-presets-wit';
      holder.setAttribute('style', HOLDER_STYLE);

      const label = document.createElement('span');
      label.setAttribute('style', GROUP_TAG_STYLE);
      label.textContent = 'Withdraw:';
      holder.appendChild(label);

      CD_PRESETS.get('wit').forEach(preset=>{
        const btn = document.createElement('button');
        btn.type='button';
        btn.setAttribute('style', BTN_STYLE);
        btn.textContent = CD_PRESETS.short(preset);
        btn.addEventListener('click', (event)=>{
          if (!isManualForegroundClick(event, btn)) return;
          let amount = preset;
          const v = vaultInfo();
          if (v) {
            if (v.stored <= 0) { flash(btn, 'Vault empty'); return; }
            if (amount > v.stored) amount = v.stored;        // can't take out more than is stored
          }
          if (!fillMoneyInputs(witBlock, amount)) return;
          if (clickOriginalActionOnce(witBlock, 'Withdraw'))
            console.log(`[VaultPresets] Property WITHDRAW $${amount.toLocaleString()}: single native action triggered.`);
        });
        holder.appendChild(btn);
      });
      holder.appendChild(CD_PRESETS.editButton('wit', holder));

      wrap.appendChild(holder);
    }
  }

  // ----------------------------
  // COMPANY FUNDS (Deposit/Withdraw) — restored
  // ----------------------------
  function getCompanyFundsRoot(){ return document.querySelector('#funds.funds.ui-tabs-panel'); }

  function makeCompanyPresetStrip(kind){ // 'Deposit'|'Withdraw'
    const holder = document.createElement('div');
    holder.className = `company-presets-${kind === 'Deposit' ? 'dep' : 'wit'}`;
    holder.setAttribute('style', HOLDER_STYLE);

    const label = document.createElement('span');
    label.setAttribute('style', GROUP_TAG_STYLE);
    label.textContent = `${kind}:`;
    holder.appendChild(label);

    CD_PRESETS.get(kind === 'Deposit' ? 'dep' : 'wit').forEach(preset=>{
      const btn = document.createElement('button');
      btn.type='button';
      btn.className = 'cd-preset';
      btn.dataset.amount = String(preset);
      btn.setAttribute('style', BTN_STYLE);
      btn.textContent = CD_PRESETS.short(preset);
      holder.appendChild(btn);
    });
    holder.appendChild(CD_PRESETS.editButton(kind === 'Deposit' ? 'dep' : 'wit', holder));

    return holder;
  }

  function wireCompanyButtons(holder, targetBlock, actionLabel){
    const buttons = holder.querySelectorAll('button.cd-preset');
    buttons.forEach((btn)=>{
      const amount = Number(btn.dataset.amount);
      btn.addEventListener('click', (event)=>{
        if (!isManualForegroundClick(event, btn)) return;
        if (!fillMoneyInputs(targetBlock, amount)) return;
        if (clickOriginalActionOnce(targetBlock, actionLabel))
          console.log(`[VaultPresets] Company ${actionLabel.toUpperCase()} $${amount.toLocaleString()}: single native action triggered.`);
      });
    });
  }

  function injectCompanyButtons(){
    const root = getCompanyFundsRoot();
    if (!root) return;

    // WITHDRAW strip
    const withdrawBlock = root.querySelector('.funds-wrap.withdraw');
    if (withdrawBlock && !withdrawBlock.querySelector('.company-presets-wit')){
      const cont = withdrawBlock.querySelector('.funds-cont');
      const afterAnchor = cont?.querySelector('span.withdraw.btn-wrap.silver');
      if (afterAnchor){
        const strip = makeCompanyPresetStrip('Withdraw');
        afterAnchor.insertAdjacentElement('afterend', strip);
        wireCompanyButtons(strip, withdrawBlock, 'Withdraw');
      }
    }

    // DEPOSIT strip
    const depositBlock = root.querySelector('.funds-wrap.deposit');
    if (depositBlock && !depositBlock.querySelector('.company-presets-dep')){
      const cont = depositBlock.querySelector('.funds-cont');
      const afterAnchor = cont?.querySelector('span.deposit.btn-wrap.silver');
      if (afterAnchor){
        const strip = makeCompanyPresetStrip('Deposit');
        afterAnchor.insertAdjacentElement('afterend', strip);
        wireCompanyButtons(strip, depositBlock, 'Deposit');
      }
    }
  }

  // Init (property + company)
  function bootstrap(){
    injectPropertyButtons();
    injectCompanyButtons();
  }

  function init(){
    bootstrap();
    CD_PRESETS.onChange(() => {
      document.querySelectorAll('.vault-presets-dep,.vault-presets-wit,.company-presets-dep,.company-presets-wit,.cd-editor').forEach((n) => { if (!n.closest('#cd-trade-presets')) n.remove(); });
      bootstrap();
    });
    const obs = new MutationObserver(()=>bootstrap());
    obs.observe(document.body, {childList:true, subtree:true});
    console.log('[VaultPresets] Loaded: PROPERTY + COMPANY (your preset amounts).');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();


/* =====================================================================
 * MODULE 2 (Based on your original v2.10):
 * Quick Cash Actions - PROPERTY + TRADE ONLY (Faction removed)
 * - Updated: property one-click button placed ABOVE preset row
 * ===================================================================== */
(function () {
    'use strict';

    //--------------------------------------------------
    // SHARED STYLE (original)
    //--------------------------------------------------
    const BTN_STYLE = `
        background: linear-gradient(#3a8b2f, #23581a);
        color: #fff;
        font-weight: 600;
        border: 1px solid #1a3a12;
        border-radius: 4px;
        padding: 6px 10px;
        cursor: pointer;
        font-size: 13px;
        line-height: 16px;
        box-shadow: 0 0 6px rgba(0,0,0,.6);
        margin-left: 6px;
        white-space: nowrap;
    `;

    //--------------------------------------------------
    // CORE MONEY READ (original)
    //--------------------------------------------------
    const lastActionByButton = new WeakMap();
    const ACTION_COOLDOWN_MS = 1200;

    function isManualForegroundClick(event, customButton) {
        if (!event.isTrusted || document.visibilityState !== 'visible' || !document.hasFocus()) return false;
        const now = Date.now();
        if ((lastActionByButton.get(customButton) || 0) > now) return false;
        lastActionByButton.set(customButton, now + ACTION_COOLDOWN_MS);
        return true;
    }

    function parseNum(value) {
        const number = Number(String(value || '').replace(/[^0-9.-]/g, ''));
        return Number.isSafeInteger(number) && number >= 0 ? number : 0;
    }

    function getOnHand() {
        // Read only from the active, manually loaded Torn page.
        const hud = document.querySelector('#user-money');
        if (!hud) return 0;
        const attr = hud.getAttribute('data-money');
        return parseNum(attr || hud.textContent);
    }

    //--------------------------------------------------
    // SECTION 1: PROPERTY VAULT (original)
    //--------------------------------------------------
    function note(btn, text) {
      if (!btn) return;
      const old = btn.textContent; btn.textContent = text; btn.disabled = true;
      setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1500);
    }

    function getVaultBlock() {
        const icons = document.querySelectorAll('.cont.torn-divider .deposit-icon');
        for (const icon of icons) {
            const block = icon.closest('.cont.torn-divider');
            if (!block) continue;
            const group = block.querySelector('.input-money-group');
            const submit = block.querySelector('input[type="submit"][value="DEPOSIT"]');
            if (group && submit) return block;
        }
        return null;
    }

    function fillVaultInputs(vaultBlock, amt) {
        const vis = vaultBlock.querySelector('.input-money-group input.input-money[type="text"]');
        const hid = vaultBlock.querySelector('.input-money-group input.input-money[type="hidden"][name="deposit"]');
        if ((!vis && !hid) || !Number.isSafeInteger(amt) || amt <= 0) return false;
        const value = String(amt);
        if (hid) {
            hid.value = value;
            hid.setAttribute('data-money', value);
        }
        if (vis) {
            vis.value = value;
            vis.setAttribute('data-money', value);
            vis.dispatchEvent(new Event('input', { bubbles: true }));
            vis.dispatchEvent(new Event('change', { bubbles: true }));
            if (hid) hid.value = value;
        }
        return true;
    }

    function submitVaultForm(vaultBlock) {
        const btn = vaultBlock.querySelector('input[type="submit"][value="DEPOSIT"]');
        if (!btn || btn.disabled || btn.classList?.contains('disabled')) {
            console.warn('[QuickCash] Native vault deposit button unavailable; nothing submitted.');
            return false;
        }
        btn.click(); // One native action attempt, and no delayed form.submit().
        return true;
    }

    function doVaultDepositNow(btn) {
      const block = getVaultBlock();
      if (!block) return;
      let carry = getOnHand();
      if (carry <= 0) return;
      // Only deposit what fits: e.g. $900m stored, $1b limit, $200m on hand -> deposit $100m.
      const v = typeof window.__cashDeskVault === 'function' ? window.__cashDeskVault() : null;
      if (v) {
        if (v.room <= 0) { note(btn, 'Vault full'); return; }
        if (carry > v.room) carry = v.room;
      }
      if (!fillVaultInputs(block, carry)) return;
        if (submitVaultForm(block)) {
            console.log(`[QuickCash] Deposit All: triggered one native deposit action for $${carry.toLocaleString()}.`);
        }
    }

    // Insert one-click ABOVE preset row (if preset row exists)
    function injectVaultButton() {
        if (document.getElementById('vaultAssistManualBtn')) return;

        const block = getVaultBlock();
        if (!block) return;

        const btn = document.createElement('button');
        btn.id = 'vaultAssistManualBtn';
        btn.type = 'button';
        btn.textContent = 'Deposit All';
        btn.setAttribute('style', BTN_STYLE + ' margin-left:0; margin-top:6px;');
        btn.addEventListener('click', (event) => {
            if (!isManualForegroundClick(event, btn)) return;
            doVaultDepositNow(btn);
        });

        const presetRow = block.querySelector('.vault-presets-dep');
        if (presetRow) {
            presetRow.insertAdjacentElement('beforebegin', btn);
            console.log('[QuickCash] Property vault button injected ABOVE preset row.');
            return;
        }

        const wrap = block.querySelector('.btn-wrap.silver');
        if (!wrap || !wrap.parentElement) return;
        wrap.parentElement.appendChild(btn);
        console.log('[QuickCash] Property vault button injected (fallback).');
    }

    //--------------------------------------------------
    // SECTION 2: TRADE WINDOW (original)
    //--------------------------------------------------
    function getTradeMoneyRow() {
        const listItems = document.querySelectorAll('ul.inputs > li');
        for (const li of listItems) {
            const titleDiv = li.querySelector('.title');
            const moneyGroup = li.querySelector('.input-money-group');
            if (!titleDiv || !moneyGroup) continue;
            const titleText = titleDiv.textContent.trim().toLowerCase();
            if (titleText === 'money:' || titleText === 'money') {
                return li;
            }
        }
        return null;
    }

    function commitTradeMoney(row) {
        if (!row) return false;
        let clickable = row.querySelector('input[type="submit"], button[type="submit"]');
        if (!clickable) {
            // Preserve the original trade lookup, but never submit the form as a fallback.
            let up = row.parentElement;
            for (let depth = 0; depth < 4 && !clickable && up; depth++) {
                clickable = up.querySelector('input[type="submit"], button[type="submit"]');
                up = up.parentElement;
            }
        }
        if (!clickable || clickable.disabled || clickable.classList?.contains('disabled')) {
            console.warn('[QuickCash] Trade money submit button unavailable; nothing submitted.');
            return false;
        }
        clickable.click(); // Exactly one native action attempt.
        return true;
    }

    function doTradeOfferAllNow() {
        const row = getTradeMoneyRow();
        if (!row) return;

        const vis = row.querySelector('.input-money-group input.input-money[type="text"]');
        const hid = row.querySelector('.input-money-group input.input-money[type="hidden"][name="amount"]');

        const carry = getOnHand();
        if (!carry || carry <= 0) return;

        let existing = 0;
        if (vis && vis.value) {
            existing = parseNum(vis.value);
        } else if (hid && hid.value) {
            existing = parseNum(hid.value);
        }

        const newTotal = existing + carry;
        if (!Number.isSafeInteger(newTotal) || newTotal <= 0) return;

        if (!vis && !hid) return;
        if (hid) {
            hid.value = String(newTotal);
            hid.setAttribute('data-money', String(newTotal));
        }
        if (vis) {
            vis.value = String(newTotal);
            vis.setAttribute('data-money', String(newTotal));
            vis.dispatchEvent(new Event('input', { bubbles: true }));
            vis.dispatchEvent(new Event('change', { bubbles: true }));
            if (hid) hid.value = String(newTotal);
        }

        console.log(
            `[QuickCash] Trade offer set to $${newTotal.toLocaleString()} `
            + `(existing ${existing.toLocaleString()} + carry ${carry.toLocaleString()}).`
        );

        if (commitTradeMoney(row)) {
            console.log('[QuickCash] Offer All Cash: triggered one native trade-money action.');
        }
    }

    // TUCC: trade presets. One click sets the money offer to that amount (never more than you hold) and presses
    // Torn's own money button once, exactly like Offer All Cash.
    function doTradeOfferAmount(amount) {
        const row = getTradeMoneyRow();
        if (!row) return;
        const vis = row.querySelector('.input-money-group input.input-money[type="text"]');
        const hid = row.querySelector('.input-money-group input.input-money[type="hidden"][name="amount"]');
        if (!vis && !hid) return;
        const existing = vis && vis.value ? parseNum(vis.value) : hid && hid.value ? parseNum(hid.value) : 0;
        const most = existing + (getOnHand() || 0);
        const total = Math.min(amount, most);
        if (!Number.isSafeInteger(total) || total <= 0) return;
        if (hid) { hid.value = String(total); hid.setAttribute('data-money', String(total)); }
        if (vis) { vis.value = String(total); vis.setAttribute('data-money', String(total)); vis.dispatchEvent(new Event('input', { bubbles: true })); vis.dispatchEvent(new Event('change', { bubbles: true })); if (hid) hid.value = String(total); }
        if (commitTradeMoney(row)) console.log(`[QuickCash] Trade offer set to $${total.toLocaleString()}: one native trade-money action.`);
    }
    function injectTradePresets() {
        if (document.getElementById('cd-trade-presets')) return;
        const row = getTradeMoneyRow();
        if (!row) return;
        const holder = document.createElement('div');
        holder.id = 'cd-trade-presets';
        holder.setAttribute('style', 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px');
        const label = document.createElement('span');
        label.textContent = 'Offer:';
        label.setAttribute('style', 'font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;background:#223322;color:#d0f0d0');
        holder.appendChild(label);
        CD_PRESETS.get('trade').forEach((amount) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'cd-trade-preset'; b.textContent = CD_PRESETS.short(amount);
            b.setAttribute('style', BTN_STYLE + 'margin-left:0;padding:4px 8px;font-size:12px;');
            b.addEventListener('click', (event) => { if (!isManualForegroundClick(event, b)) return; doTradeOfferAmount(amount); });
            holder.appendChild(b);
        });
        holder.appendChild(CD_PRESETS.editButton('trade', holder));
        row.appendChild(holder);
    }
    CD_PRESETS.onChange(() => { const h = document.getElementById('cd-trade-presets'); if (h) { if (h.nextElementSibling && h.nextElementSibling.classList.contains('cd-editor')) h.nextElementSibling.remove(); h.remove(); } injectTradePresets(); });

    function injectTradeButton() {
        injectTradePresets();
        if (document.getElementById('tradeAllCashBtn')) return;

        const row = getTradeMoneyRow();
        if (!row) return;

        const btn = document.createElement('button');
        btn.id = 'tradeAllCashBtn';
        btn.type = 'button';
        btn.textContent = 'One-Click Offer All Cash';
        btn.setAttribute('style', BTN_STYLE + 'margin-top:6px;');
        btn.addEventListener('click', (event) => {
            if (!isManualForegroundClick(event, btn)) return;
            doTradeOfferAllNow();
        });

        row.appendChild(btn);
        console.log('[QuickCash] Trade button injected.');
    }

    //--------------------------------------------------
    // INIT + DOM WATCH (property + trade only)
    //--------------------------------------------------
    function bootstrap() {
        injectVaultButton();
        injectTradeButton();
    }

    function init() {
        bootstrap();

        const obs = new MutationObserver(() => {
            injectVaultButton();
            injectTradeButton();
        });
        obs.observe(document.body, { childList: true, subtree: true });

        console.log('[QuickCash] Active (Property Vault + Trade ONLY).');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
