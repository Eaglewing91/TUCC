// ==UserScript==
// @name         Attack Hybrid Ultimate
// @namespace    https://github.com/Eaglewing91
// @version      3.7.3
// @description  Lets you drag Torn's own attack buttons (Start fight / Leave / Mug / Hosp) anywhere on the attack page by a grip on the weapon bar (Primary / Secondary / Melee / Temp), which moves with them. Before the fight any weapon button (or key 1-4) starts the fight; after that each one attacks with its weapon; when the fight ends it presses your chosen Leave / Mug / Hosp. One press = one action. Only your chosen finish option is shown, placed where your last-clicked weapon button was. Sends no requests of its own. No API usage.
// @author       Eaglewing [571041] - based on original scripts by olesien [2187764]
// @match        https://www.torn.com/page.php?sid=attack&user2ID=*
// @match        https://www.torn.com/loader.php?sid=attack&user2ID=*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_addStyle
// ==/UserScript==

// CREDITS
// - Original scripts (attack refresher and move-attack-buttons): olesien [2187764]
//   https://www.torn.com/profiles.php?XID=2187764
// - Combined into "Refresh + Move Attack Hybrid" by Eaglewing [571041]
// - Reworked into "Attack Hybrid Ultimate" by Eaglewing [571041]
// Original concept and code credit remains with olesien [2187764].
//
// HOW IT WORKS
// - Torn's own attack buttons can be dragged anywhere on the attack page by the ✥ grip
//   at the left end of the weapon bar (Primary / Secondary / Melee / Temp). The bar and
//   Torn's buttons always move together.
// - Each press of a weapon button or key 1-4 does exactly ONE thing:
//     before the fight -> presses Torn's Start fight
//     during the fight -> one hit with that weapon
//     after the fight  -> presses your chosen Leave / Mug / Hosp (Attack type row)
// - When the fight is won, only your chosen finish option is shown, placed where your
//   last-used weapon button was. Torn's own Start fight button is hidden while a weapon
//   button can start the fight.
// - Real input only, held keys never repeat, keys are ignored while typing, and short
//   guards stop a double press from starting or finishing twice.
// - The script makes no requests of its own; it only passes your press to one of Torn's
//   own buttons on this page. Version history: see CHANGELOG.md.
//
// Terms of Service
//   Data Storage:          Only locally (attack type, button position and keybinds
//                          on/off in this browser's localStorage).
//   Data Sharing:          Nobody.
//   Purpose of Use:        Competitive advantage - faster manual attacking.
//   Key Storage & Sharing: No API key used / Not stored / Not shared.
//   Key Access Level:      None (no API usage).
//   Network:               None of its own. Each press of a weapon button or key 1-4
//                          passes exactly ONE click to one of Torn's own buttons on
//                          this attack page: Start fight (before the fight), your
//                          weapon (during it) or your chosen finish option (after it).
//                          Torn's page then makes its normal request. Nothing is ever
//                          clicked without your press, and holding a key never repeats.
//                          Changing the attack type reloads the page when you click it.

(function () {
    "use strict";

    /***********************************************************
     * STORAGE KEYS
     ***********************************************************/

    const DEFAULT_TOP_PX = 220;                 // default starting height of the buttons
    const TYPE_KEY = "torn-attack-type";
    const OFFSET_KEY = "torn-hybrid-buttons-offset";

    const TITLE_CONTAINER_SELECTOR =
        '#attack-root [class^="titleContainer"], ' +
        '#attack-root [class*="titleContainer"], ' +
        '[class^="titleContainer"], ' +
        '[class*="titleContainer"]';

    const PLAYER_WINDOW_SELECTOR =
        '#attack-root div[class^="playerWindow"], #attack-root div[class*="playerWindow"]';

    // Your own (attacker) weapons. Torn uses the same ids for the defender,
    // so the attacker's are picked by their "label_attacker_..." description.
    const WEAPONS = [
        { key: "primary",   label: "Primary",   sel: '#weapon_main[aria-describedby*="label_attacker_primary"]' },
        { key: "secondary", label: "Secondary", sel: '#weapon_second[aria-describedby*="label_attacker_secondary"]' },
        { key: "melee",     label: "Melee",     sel: '#weapon_melee[aria-describedby*="label_attacker_melee"]' },
        { key: "temp",      label: "Temp",      sel: '#weapon_temp[aria-describedby*="label_attacker_temporary"]' }
    ];

    const WEAPON_BAR_GAP_PX = 44;               // space between Torn's button row and the weapon bar

    // Your chosen finish option, as text on Torn's finish buttons
    const FINISH_WORDS = { 1: "leave", 2: "mug", 3: "hosp" };
    const ALL_FINISH_RE = /\b(leave|mug|hosp)/i;

    // Last weapon-bar button you clicked this page (used to place the finish button)
    let lastWeaponKey = null;

    // Start fight guard: after a start press, ignore further presses only while
    // Torn still shows its Start fight button (up to 1s, then a retry is allowed
    // in case the start didn't go through). Hits are never delayed: they are only
    // possible once Torn has removed Start fight, i.e. the fight has started.
    const START_GUARD_MS = 1000;
    let startForwardedAt = 0;

    // Keybinds 1-4 (on by default)
    const KEYBINDS_KEY = "torn-hybrid-keybinds";
    let keybindsOn = (localStorage.getItem(KEYBINDS_KEY) ?? "1") === "1";
    const KEY_TO_WEAPON = { "1": "primary", "2": "secondary", "3": "melee", "4": "temp" };

    // Suppress the click that follows a press we already acted on
    let handledByPress = false;   // set by a mouse/pen press; the click that follows it is ignored

    // Finish guard: ignore extra presses right after pressing finish
    const FINISH_GUARD_MS = 1000;
    let finishForwardedAt = 0;

    const DIALOG_BUTTONS_SELECTOR =
        '[class^="dialogButtons"], [class*="dialogButtons"]';

    /***********************************************************
     * STATE FROM LOCALSTORAGE
     ***********************************************************/

    // Attack type: 1 = Leave, 2 = Mug, 3 = Hospitalize
    let attackType = Number(localStorage.getItem(TYPE_KEY)) || 2;

    // Drag offset of Torn's buttons from their starting spot
    let offset = { x: 0, y: 0 };

    try {
        const saved = JSON.parse(localStorage.getItem(OFFSET_KEY) || "null");
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
            offset = saved;
        }
    } catch (e) { /* ignore */ }


    /***********************************************************
     * UTILITIES
     ***********************************************************/

    function waitFor(selector, timeoutMs = 20000) {
        return new Promise((resolve, reject) => {

            const existing = document.querySelector(selector);

            if (existing) {
                resolve(existing);
                return;
            }

            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });

            observer.observe(document.documentElement, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout waiting for ${selector}`));
            }, timeoutMs);
        });
    }

    function applyOffset() {
        document.documentElement.style.setProperty("--hybrid-dx", offset.x + "px");
        document.documentElement.style.setProperty("--hybrid-dy", offset.y + "px");
    }

    function saveOffset() {
        try {
            localStorage.setItem(OFFSET_KEY, JSON.stringify({
                x: Math.round(offset.x),
                y: Math.round(offset.y)
            }));
        } catch (e) { /* ignore */ }
    }

    function resetOffset() {
        offset = { x: 0, y: 0 };
        try { localStorage.removeItem(OFFSET_KEY); } catch (e) { /* ignore */ }
        applyOffset();
    }

    /***********************************************************
     * MOVE ATTACK UI (CSS only)
     ***********************************************************/

    function injectMoveStyles() {

        const topStyle = DEFAULT_TOP_PX + "px";

        GM_addStyle(`

            /* Torn attack model */
            [class^="modelWrap"],
            [class*="modelWrap"] {
                max-width: 100%;
            }

            /* Player windows: let the moved buttons show outside them */
            #attack-root div[class^="playerWindow"],
            #attack-root div[class*="playerWindow"] {
                overflow: visible;
            }

            /* Torn's own attack buttons: default spot + your drag offset */
            [class^="dialogButtons"],
            [class*="dialogButtons"] {
                z-index: 1000;
                position: absolute;
                top: calc(${topStyle} + var(--hybrid-dy, 0px));
                left: calc(-300px + var(--hybrid-dx, 0px));
                display: flex;
                align-items: stretch;
                width: 420px;
                justify-content: center;
                flex-direction: row !important;
            }

            /* Attack type button re-ordering */
            ${attackType === 1 ? `
                /* LEAVE */
                [class^="dialogButtons"] button:nth-child(1),
                [class*="dialogButtons"] button:nth-child(1) { order: 2; }
                [class^="dialogButtons"] button:nth-child(2),
                [class*="dialogButtons"] button:nth-child(2) { order: 1; }
                [class^="dialogButtons"] button:nth-child(3),
                [class*="dialogButtons"] button:nth-child(3) { order: 3; }
            ` : attackType === 3 ? `
                /* HOSPITALIZE */
                [class^="dialogButtons"] button:nth-child(1),
                [class*="dialogButtons"] button:nth-child(1) { order: 1; }
                [class^="dialogButtons"] button:nth-child(2),
                [class*="dialogButtons"] button:nth-child(2) { order: 3; }
                [class^="dialogButtons"] button:nth-child(3),
                [class*="dialogButtons"] button:nth-child(3) { order: 2; }
            ` : ``}

            /*
             * Weapon bar: directly under Torn's button row, same drag offset,
             * so it always moves with the attack buttons. Lives in the
             * defender window, so it stays visible during the fight.
             */
            .hybridWeaponBar {
                position: absolute;
                z-index: 1001;
                top: calc(${topStyle} + ${WEAPON_BAR_GAP_PX}px + var(--hybrid-dy, 0px));
                left: calc(-300px + var(--hybrid-dx, 0px));
                width: 420px;
                display: flex;
                justify-content: center;
                align-items: stretch;
                gap: 4px;
                pointer-events: none;
            }

            .hybridWeaponBar > * {
                pointer-events: auto;
            }

            /*
             * Grip: first item in the weapon bar (the script's own element),
             * so it is there before, during and after the fight and Torn's
             * re-renders can never remove it.
             */
            .hybridGrip {
                display: flex;
                align-items: center;
                justify-content: center;
                min-width: 26px;
                padding: 0 6px;
                cursor: grab;
                user-select: none;
                touch-action: none;
                color: #ffd2a6;
                background: #3a2a1a;
                border: 1px solid rgba(255, 170, 90, 0.75);
                border-radius: 6px;
                font-size: 14px;
                line-height: 1;
            }

            .hybridGrip:hover {
                background: #4a3420;
            }

            .hybridWeaponBar.hybridDragging .hybridGrip {
                cursor: grabbing;
            }

            .hybridWeaponBar.hybridDragging {
                outline: 2px dashed rgba(255, 170, 90, 0.85);
                outline-offset: 3px;
            }

            /* Same size as Torn's attack buttons (they use the torn-btn class too) */
            .hybridWeaponBar button.hybridWeaponBtn[data-key]:not([data-key=""])::after {
                content: attr(data-key);
                margin-left: 5px;
                padding: 0 4px;
                font-size: 10px;
                line-height: 14px;
                border-radius: 3px;
                border: 1px solid currentColor;
                opacity: 0.75;
            }

            .hybridWeaponBar button.hybridWeaponBtn {
                margin: 0 !important;
                padding: 0 10px !important;
                min-width: 0 !important;
            }

            .hybridWeaponBar button.hybridWeaponBtn[disabled] {
                opacity: 0.45;
                cursor: not-allowed;
            }

            /* Torn's Start fight button hidden: the weapon buttons start the fight */
            button[data-hybrid-start-hidden="1"] {
                display: none !important;
            }

            /* Start mode: any weapon button starts the fight */
            .hybridWeaponBar.hybridStartMode button.hybridWeaponBtn:not([disabled]) {
                background: linear-gradient(180deg, #3f8f3f, #2c6b2c) !important;
                color: #fff !important;
            }

            .hybridWeaponBar.hybridStartMode button.hybridWeaponBtn:not([disabled])::before {
                content: "▶ ";
            }

            /* Fight over: show only your chosen finish option */
            .hybridFinishOnly > button:not([data-hybrid-chosen="1"]) {
                display: none !important;
            }

            /* Weapon bar hidden while the finish button sits in its place... */
            .hybridWeaponBar.hybridBarHidden {
                visibility: hidden !important;
            }

            /* ...but the grip stays, so you can still move things */
            .hybridWeaponBar.hybridBarHidden > .hybridGrip {
                visibility: visible !important;
            }

        `);

        applyOffset();
    }

    /***********************************************************
     * GRIP (on the script's own weapon bar)
     *
     * Dragging only changes the shared offset used by both the weapon
     * bar and Torn's button row. Nothing is clicked or requested.
     ***********************************************************/

    let dragging = false;
    let dragStart = null;
    let dragBox = null;

    function createGrip(bar) {

        const grip = document.createElement("span");
        grip.className = "hybridGrip";
        grip.textContent = "✥";
        grip.title = "Drag to move the weapon bar and Torn's attack buttons. Double-click to reset.";

        grip.addEventListener("pointerdown", (e) => {

            if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) {
                return;
            }

            dragging = true;
            dragBox = bar;
            dragStart = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y };

            bar.classList.add("hybridDragging");

            e.preventDefault();
            e.stopPropagation();
        });

        grip.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        grip.addEventListener("dblclick", (e) => {
            e.preventDefault();
            e.stopPropagation();
            resetOffset();
        });

        return grip;
    }

    /***********************************************************
     * WEAPON BAR
     *
     * Each button passes exactly ONE click to your matching Torn
     * weapon, and only when you really clicked it. It never clicks
     * anything on its own.
     ***********************************************************/

    function findWeapon(w) {
        return document.querySelector(w.sel);
    }

    function weaponUsable(el) {
        if (!el) return false;
        const cls = el.className || "";
        return !/emptySlot/i.test(cls) && el.getAttribute("aria-disabled") !== "true";
    }

    function ensureWeaponBar() {

        const windows = document.querySelectorAll(PLAYER_WINDOW_SELECTOR);
        const host = windows[1] || windows[0];

        if (!host) {
            return null;
        }

        let bar = host.querySelector(":scope > .hybridWeaponBar");

        if (!bar) {

            if (window.getComputedStyle(host).position === "static") {
                host.style.position = "relative";
            }

            bar = document.createElement("div");
            bar.className = "hybridWeaponBar";

            bar.appendChild(createGrip(bar));

            WEAPONS.forEach((w) => {

                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "torn-btn silver hybridWeaponBtn";
                btn.dataset.weapon = w.key;
                btn.textContent = w.label;

                // Act on press (mouse / pen): fires as soon as the button goes down.
                btn.addEventListener("pointerdown", (e) => {

                    // Real presses only; touch acts on tap (click) so scrolling can't hit.
                    if (!e.isTrusted || e.pointerType === "touch" || e.button !== 0) {
                        return;
                    }

                    e.preventDefault();
                    e.stopPropagation();

                    handledByPress = true;
                    weaponAction(w);
                });

                // Click: only used for touch taps and keyboard (Enter/Space) activation.
                btn.addEventListener("click", (e) => {

                    e.preventDefault();
                    e.stopPropagation();

                    if (!e.isTrusted) {
                        return;
                    }

                    const viaPress = handledByPress;
                    handledByPress = false;

                    // Keyboard (Enter / Space) activation: one action.
                    if (e.detail === 0) {
                        weaponAction(w);
                        return;
                    }

                    // A mouse or pen press already acted on pointerdown: its click never acts again,
                    // however long the button was held.
                    if (viaPress || e.pointerType === "mouse" || e.pointerType === "pen") {
                        return;
                    }

                    // Touch tap: one action.
                    weaponAction(w);
                });

                bar.appendChild(btn);
            });

            host.appendChild(bar);
        } else if (!bar.querySelector(":scope > .hybridGrip")) {
            // Safety net: put the grip back if anything ever removed it.
            bar.insertBefore(createGrip(bar), bar.firstChild);
        }

        refreshWeaponBar(bar);
        updateKeyHints();
        return bar;
    }

    /***********************************************************
     * ONE ACTION PER INPUT
     *
     * Used by a button press, a tap, or a 1-4 key press. Each call does
     * exactly one thing: start the fight, hit once with the weapon, OR press
     * your chosen finish option once the fight is over.
     ***********************************************************/

    // Your chosen finish button (Leave / Mug / Hosp), if the fight is over.
    // Returns: the button, "unknown" if finish is shown but your option isn't
    // there, or null if the fight isn't over.
    function findChosenFinishButton() {
        const word = FINISH_WORDS[attackType] || "mug";
        for (const box of document.querySelectorAll(DIALOG_BUTTONS_SELECTOR)) {
            const buttons = finishButtonsIn(box);
            if (!buttons) continue;
            const chosen = buttons.find((b) => (b.textContent || "").trim().toLowerCase().includes(word));
            return chosen || "unknown";
        }
        return null;
    }

    function weaponAction(w) {

        // Fight over: press your chosen finish option (one click) and nothing else.
        const finish = findChosenFinishButton();

        if (finish) {

            if (finish === "unknown" || finish.disabled) {
                return;
            }

            if (Date.now() - finishForwardedAt < FINISH_GUARD_MS) {
                return;
            }

            finishForwardedAt = Date.now();
            finish.click();
            return;
        }

        const el = findWeapon(w);

        if (!weaponUsable(el)) {
            return;
        }

        // Before the fight: start it (one click on Torn's Start fight) and nothing else.
        const startBtn = findStartFightButton();

        if (startBtn) {

            if (Date.now() - startForwardedAt < START_GUARD_MS) {
                return;
            }

            startForwardedAt = Date.now();
            startBtn.click();
            return;
        }

        startForwardedAt = 0;

        // During the fight: one hit with this weapon.
        lastWeaponKey = w.key;

        el.click();
    }

    function isTypingTarget(t) {
        if (!t || !t.tagName) return false;
        const tag = t.tagName.toLowerCase();
        return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
    }

    function watchKeybinds() {

        document.addEventListener("keydown", (e) => {

            if (!keybindsOn || !e.isTrusted) return;

            // No auto-repeat: holding a key down never repeats an action.
            if (e.repeat) return;

            if (e.ctrlKey || e.altKey || e.metaKey) return;
            if (isTypingTarget(e.target)) return;

            const key = KEY_TO_WEAPON[e.key];
            if (!key) return;

            const w = WEAPONS.find((x) => x.key === key);
            if (!w) return;

            e.preventDefault();
            weaponAction(w);
        }, true);
    }

    function updateKeyHints() {
        document.querySelectorAll("button.hybridWeaponBtn").forEach((btn) => {
            const w = WEAPONS.find((x) => x.key === btn.dataset.weapon);
            if (!w) return;
            const n = Object.keys(KEY_TO_WEAPON).find((k) => KEY_TO_WEAPON[k] === w.key);
            btn.dataset.key = keybindsOn ? n : "";
        });
    }

    // Torn's own Start fight button, if it's currently shown.
    function findStartFightButton() {
        for (const box of document.querySelectorAll(DIALOG_BUTTONS_SELECTOR)) {
            for (const b of box.querySelectorAll(":scope > button")) {
                if (/start\s*fight/i.test((b.textContent || "").trim()) && !b.disabled) {
                    return b;
                }
            }
        }
        return null;
    }

    function refreshWeaponBar(bar) {
        const startBtn = findStartFightButton();
        const startMode = !!startBtn;
        bar.classList.toggle("hybridStartMode", startMode);

        // Hide Torn's own Start fight button while a weapon button can start
        // the fight instead. Visual only: the button stays in the page, and is
        // shown again as a fallback if no weapon is available.
        const anyUsable = WEAPONS.some((w) => weaponUsable(findWeapon(w)));
        document.querySelectorAll('button[data-hybrid-start-hidden="1"]').forEach((b) => {
            if (b !== startBtn || !anyUsable) {
                delete b.dataset.hybridStartHidden;
            }
        });
        if (startBtn && anyUsable) {
            startBtn.dataset.hybridStartHidden = "1";
        }

        bar.querySelectorAll("button.hybridWeaponBtn").forEach((btn) => {
            const w = WEAPONS.find((x) => x.key === btn.dataset.weapon);
            const el = w && findWeapon(w);
            const usable = weaponUsable(el);
            btn.disabled = !usable;
            const name = el && (el.getAttribute("aria-label") || "").replace(/^Attack with\s*/i, "");
            btn.title = !usable ? `${w.label}: not available`
                : startMode ? `Start fight (then attack with ${name || w.label})`
                : `${w.label}: ${name || "attack"}`;
        });
    }

    /***********************************************************
     * FIGHT OVER: CHOSEN FINISH OPTION ONLY, ON THE LAST WEAPON SPOT
     *
     * Visual only. Torn's own finish buttons are hidden or moved on
     * screen; the script never presses them.
     ***********************************************************/

    function finishButtonsIn(box) {
        const buttons = Array.from(box.querySelectorAll(":scope > button"));
        const finish = buttons.filter((b) => ALL_FINISH_RE.test((b.textContent || "").trim()));
        return finish.length >= 2 ? buttons : null;
    }

    function handleFinish() {

        const bar = document.querySelector(".hybridWeaponBar");
        let finishShown = false;

        document.querySelectorAll(DIALOG_BUTTONS_SELECTOR).forEach((box) => {

            const buttons = finishButtonsIn(box);

            if (!buttons) {
                return;
            }

            finishShown = true;

            if (box.dataset.hybridFinishDone === "1") {
                return;
            }

            const word = FINISH_WORDS[attackType] || "mug";
            const chosen = buttons.find((b) => (b.textContent || "").trim().toLowerCase().includes(word));

            // Safety: if your option can't be found, hide nothing.
            if (!chosen) {
                box.dataset.hybridFinishDone = "1";
                return;
            }

            chosen.dataset.hybridChosen = "1";
            box.classList.add("hybridFinishOnly");

            // Place it exactly on your last-clicked weapon button.
            const weaponBtn = lastWeaponKey && bar
                ? bar.querySelector(`button.hybridWeaponBtn[data-weapon="${lastWeaponKey}"]`)
                : null;

            if (weaponBtn) {
                box.style.transform = "";
                const wr = weaponBtn.getBoundingClientRect();
                const cr = chosen.getBoundingClientRect();
                const dx = (wr.left + wr.width / 2) - (cr.left + cr.width / 2);
                const dy = (wr.top + wr.height / 2) - (cr.top + cr.height / 2);
                box.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
                bar.classList.add("hybridBarHidden");
            }

            box.dataset.hybridFinishDone = "1";
        });

        // Finish row gone (new fight / page change): bring the weapon bar back.
        if (!finishShown && bar) {
            bar.classList.remove("hybridBarHidden");
        }
    }

    function watchForButtons() {

        ensureWeaponBar();
        handleFinish();

        let pending = false;

        new MutationObserver(() => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => {
                pending = false;
                ensureWeaponBar();
                handleFinish();
            });
        }).observe(document.body, { childList: true, subtree: true });

        window.addEventListener("pointermove", (e) => {
            if (!dragging) return;
            offset = {
                x: dragStart.ox + (e.clientX - dragStart.mx),
                y: dragStart.oy + (e.clientY - dragStart.my)
            };
            applyOffset();
            e.preventDefault();
        }, { passive: false });

        const endDrag = () => {
            if (!dragging) return;
            dragging = false;
            if (dragBox) dragBox.classList.remove("hybridDragging");
            dragBox = null;
            saveOffset();
        };

        window.addEventListener("pointerup", endDrag);
        window.addEventListener("pointercancel", endDrag);
    }

    /***********************************************************
     * SLOT / ATTACK TYPE UI
     ***********************************************************/

    function injectSlotTypeUI() {

        waitFor(TITLE_CONTAINER_SELECTOR, 20000)
        .then((container) => {

            // Avoid duplicates if Torn re-renders
            if (container.querySelector("[data-hybrid-slot-type='1']")) {
                return;
            }

            const wrap = document.createElement("div");
            wrap.setAttribute("data-hybrid-slot-type", "1");

            wrap.innerHTML = `
                <fieldset style="border:0; padding:0; margin:0;">

                    <span style="padding-right:5px;">Attack type</span>

                    <input type="radio" id="leave" name="attackType" value="leave" ${attackType === 1 ? "checked" : ""}>
                    <label for="leave">Leave</label>

                    <input type="radio" id="mug" name="attackType" value="mug" ${attackType === 2 ? "checked" : ""}>
                    <label for="mug">Mug</label>

                    <input type="radio" id="hosp" name="attackType" value="hosp" ${attackType === 3 ? "checked" : ""}>
                    <label for="hosp" style="padding-right:10px;">Hosp</label>

                    <span>
                        Drag the <b>✥</b> on the weapon bar to move the attack buttons
                    </span>

                    <a href="#" id="hybridResetPos" style="padding-left:6px; text-decoration:underline;">
                        Reset position
                    </a>

                    <input type="checkbox" id="hybridKeybinds" style="margin-left:12px;" ${keybindsOn ? "checked" : ""}>
                    <label for="hybridKeybinds" title="1 = Primary, 2 = Secondary, 3 = Melee, 4 = Temp">Keybinds 1-4</label>

                </fieldset>
            `;

            container.appendChild(wrap);

            wrap.addEventListener("click", (event) => {

                const id = event?.target?.id;

                if (!id) {
                    return;
                }

                // Keybinds on/off (no reload, no request)
                if (id === "hybridKeybinds") {
                    keybindsOn = !!event.target.checked;
                    localStorage.setItem(KEYBINDS_KEY, keybindsOn ? "1" : "0");
                    updateKeyHints();
                    return;
                }

                // Reset button position (no request)
                if (id === "hybridResetPos") {
                    event.preventDefault();
                    resetOffset();
                    return;
                }

                // Attack type (reloads the page to re-order the buttons)
                const types = { leave: 1, mug: 2, hosp: 3 };
                if (types[id]) {
                    localStorage.setItem(TYPE_KEY, String(types[id]));
                    location.reload();
                }
            });
        })
        .catch(() => {
            console.warn("[Attack Hybrid Ultimate] Could not find attack title container.");
        });
    }

    /***********************************************************
     * BOOT
     ***********************************************************/

    injectMoveStyles();
    injectSlotTypeUI();
    watchForButtons();
    watchKeybinds();

})();
