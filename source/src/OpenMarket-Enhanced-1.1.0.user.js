// ==UserScript==
// @name         OpenMarket (Enhanced)
// @namespace    eaglewing91-openmarket-enhanced
// @version      1.1.0
// @description  Add quality and bonus percentages to the item market, auction house, and bazaars, with a local quality filter. Based on OpenMarket 1.0.1.1 by Snickelfritz.
// @author       Snickelfritz (original), Eaglewing (enhancements)
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://www.torn.com/amarket.php*
// @match        https://www.torn.com/bazaar.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        none
// @run-at       document-start
// @license      GNU GPLv3
// ==/UserScript==

// Original script: https://greasyfork.org/en/scripts/571158-openmarket (Snickelfritz, GNU GPLv3)
// Original forum thread: https://www.torn.com/forums.php#p=threads&f=67&t=16469095
//
// Changes in this edition (1.1.0):
//  - Tiles that Torn re-uses for a different item (sorting, filtering, scrolling) are re-labelled
//    instead of keeping the old item's badge.
//  - Item Market falls back to reading the item ID and stats from the page when no matching
//    listing data was captured, so quality still shows (without bonuses).
//  - Listing data is also read from XHR responses, not only fetch.
//  - A listing whose price and stats match several listings with different bonuses is skipped
//    rather than mislabelled.
//  - The in-memory cache is capped so it can't grow forever on long sessions.
//  - Processing is batched to once per animation frame instead of on every DOM change.
//  - Waits for each page's root element to appear instead of giving up if it isn't there yet.
//  - Badge colours follow dark/light mode changes live.
//  - New: a small "Min Q" filter that dims (or hides) listings below a chosen quality.
//    It only changes how listings look on the page and never sends anything.
//
// COMPLIANCE NOTE (kept from the original): the Torn admin team agreed that keeping intercepted
// item market data in an in-memory cache is fine "just as long as it's not persisted
// anywhere/repurposed for anything else". This edition keeps that: the cache lives only in memory,
// is only used to label listings on the page you are viewing, and is only used while the tab is
// visible and focused. The script makes no requests of its own, clicks nothing, and the only thing
// it saves is your filter setting (in this browser's localStorage).

(function () {
    'use strict';

    // Choose which pages the script is active on.
    // Change "true" to "false" to disable a page.
    const CONFIG = {
        enableItemMarket: true,
        enableAuctionHouse: true,
        enableBazaar: true,
        showFilter: true,          // Show the "Min Q" filter control.
        maxCacheItems: 1500        // Item market listings kept in memory (oldest dropped first).
    };

    // You can customise the colours however you want. Tiers for quality are lowest to highest.
    const COLOURS = {
        tiers: {
            dark: ['#e4e4e4', '#57efea', '#c286ff', '#ffd700'],
            light: ['#717171', '#009590', '#8e19c1', '#e37100']
        },
        bonus: {
            dark: '#e8d1ff',
            light: '#370b40'
        },
        qualityBoxBg: {
            dark: 'rgba(0,0,0,0.8)',
            light: 'rgba(255,255,255,0.9)'
        }
    };

    // These are the various elements that need to be found/selected within the page source.
    // Changes to the game may break these, so finding the new values may be a necessary part
    // of debugging the script.
    const SELECTORS = {
        itemMarket: {
            root: '#item-market-root',
            tile: '[class*="itemTile___"]',
            imageWrapper: '[class*="imageWrapper___"]',
            image: '[class*="imageWrapper___"] img',
            title: 'div > [class*="title___"]',
            price: '[class*="priceAndTotal___"] span',
            statsContainer: '[class*="properties___"]',
            statEntry: '[class*="property___"]',
            statIcon: '[class*="icon___"]',
            statValue: '[class*="value___"]',
            statTypeElement: 'value',
            statTypeAttribute: 'aria-label',
            bonusIcons: '[class*="bonuses___"] i'
        },
        auctionHouse: {
            root: '#auction-house-tabs',
            visibleTab: '#auction-house-tabs .tabContent:not([style*="display: none"])',
            tile: 'ul.items-list li',
            imageWrapper: '.img-wrap',
            title: '.title',
            itemHover: '.item-hover',
            rarityLine: 'p.t-gray-6',
            statsContainer: '.infobonuses',
            statEntry: 'span.bonus-attachment',
            statIcon: 'i',
            statValue: '.label-value',
            statTypeElement: 'icon',
            statTypeAttribute: 'className',
            bonusIcons: '.iconsbonuses .bonus-attachment-icons',
            bonusTitleAttr: 'title',
            bonusDescAttr: null
        },
        bazaar: {
            root: '#bazaarRoot',
            itemsContainer: 'div[class*="itemsContainner"]',
            tile: '[class*="item___"]',
            imageWrapper: '[class*="imgBar___"]',
            image: '[class*="imgContainer___"] img',
            title: '[class*="description___"]',
            stockElement: '[class*="amount___"]',
            statsContainer: '[class*="infoBonuses___"]',
            statEntry: '[class*="container___"]',
            statIcon: 'i',
            statValue: 'span',
            statTypeElement: 'icon',
            statTypeAttribute: 'className',
            bonusIcons: '[class*="iconBonuses___"] i',
            bonusTitleAttr: 'data-bonus-attachment-title',
            bonusDescAttr: 'data-bonus-attachment-description'
        }
    };

    // When new items are added, or if values are updated, these three sections will need to be adjusted.
    // The first number is the item ID. https://wiki.torn.com/ / https://tornstats.com/items
    const BASE_DAMAGE_VALUES = {
        1: 17, 2: 16, 3: 20, 4: 11, 5: 21, 6: 25, 7: 28, 8: 34, 9: 40, 10: 61,
        11: 58, 12: 28, 13: 29, 14: 32, 15: 36, 16: 44, 17: 48, 18: 52, 19: 55, 20: 59,
        21: 64, 22: 41, 23: 39, 24: 45, 25: 48, 26: 56, 27: 55, 28: 59, 29: 61, 30: 64,
        31: 67, 63: 72, 76: 52, 98: 59, 99: 33, 100: 64, 108: 65, 109: 77, 110: 27, 111: 39,
        146: 65, 147: 22, 170: 60, 173: 24, 174: 50, 175: 1, 177: 61, 189: 42, 217: 57, 218: 35,
        219: 63, 223: 69, 224: 23, 225: 56, 227: 38, 228: 50, 230: 18, 231: 60, 232: 62, 233: 61,
        234: 31, 235: 22, 236: 35, 237: 62, 238: 29, 240: 78, 241: 50, 243: 30, 244: 15, 245: 13,
        247: 52, 248: 62, 249: 46, 250: 50, 251: 53, 252: 49, 253: 27, 254: 47, 255: 67, 289: 70,
        290: 70, 291: 70, 292: 70, 346: 40, 359: 16, 360: 53, 382: 75, 387: 67, 388: 74, 391: 57,
        393: 14, 395: 61, 397: 71, 398: 69, 399: 68, 400: 63, 401: 26, 402: 51, 438: 18, 439: 19,
        440: 1, 483: 42, 484: 46, 485: 40, 486: 38, 487: 39, 488: 37, 489: 35, 490: 46, 539: 36,
        545: 79, 546: 76, 547: 78, 548: 77, 549: 80, 599: 60, 600: 61, 604: 43, 605: 45, 612: 65,
        613: 47, 614: 60, 615: 64, 632: 48, 790: 5, 792: 17, 805: 18, 830: 95, 831: 54, 832: 21,
        837: 66, 838: 63, 839: 60, 844: 15, 845: 58, 846: 56, 850: 58, 871: 5, 874: 68, 1053: 41,
        1055: 35, 1056: 40, 1152: 76, 1153: 74, 1154: 73, 1155: 70, 1156: 68, 1157: 69, 1158: 62,
        1159: 51, 1173: 37, 1231: 29, 1255: 54, 1257: 1, 1296: 27
    };

    const BASE_ACCURACY_VALUES = {
        1: 55, 2: 57, 3: 52, 4: 62, 5: 45, 6: 55, 7: 60, 8: 52, 9: 58, 10: 23,
        11: 52, 12: 53, 13: 52, 14: 56, 15: 54, 16: 58, 17: 51, 18: 49, 19: 38, 20: 36,
        21: 30, 22: 63, 23: 65, 24: 51, 25: 51, 26: 52, 27: 47, 28: 55, 29: 47, 30: 45,
        31: 41, 63: 28, 76: 24, 98: 24, 99: 57, 100: 24, 108: 43, 109: 39, 110: 52, 111: 51,
        146: 49, 147: 15, 170: 24, 173: 55, 174: 56, 175: 54, 177: 53, 189: 54, 217: 49, 218: 63,
        219: 55, 223: 52, 224: 52, 225: 62, 227: 48, 228: 48, 230: 22, 231: 46, 232: 50, 233: 55,
        234: 52, 235: 59, 236: 55, 237: 56, 238: 52, 240: 25, 241: 57, 243: 57, 244: 39, 245: 55,
        247: 55, 248: 53, 249: 47, 250: 53, 251: 51, 252: 62, 253: 41, 254: 52, 255: 39, 289: 54,
        290: 54, 291: 54, 292: 54, 346: 63, 359: 50, 360: 57, 382: 62, 387: 63, 388: 45, 391: 65,
        393: 54, 395: 60, 397: 28, 398: 50, 399: 57, 400: 35, 401: 33, 402: 60, 438: 42, 439: 43,
        440: 63, 483: 52, 484: 41, 485: 54, 486: 45, 487: 43, 488: 41, 489: 48, 490: 24, 539: 55,
        545: 38, 546: 47, 547: 46, 548: 45, 549: 36, 599: 48, 600: 41, 604: 45, 605: 48, 612: 52,
        613: 63, 614: 62, 615: 52, 632: 48, 790: 29, 792: 57, 805: 55, 830: 45, 831: 53, 832: 54,
        837: 36, 838: 60, 839: 45, 844: 45, 845: 53, 846: 52, 850: 50, 871: 59, 874: 57, 1053: 65,
        1055: 49, 1056: 47, 1152: 42, 1153: 44, 1154: 40, 1155: 45, 1156: 36, 1157: 49, 1158: 39,
        1159: 56, 1173: 67, 1231: 59, 1255: 52, 1257: 59, 1296: 58
    };

    const BASE_ARMOUR_VALUES = {
        32: 20, 33: 32, 34: 34, 49: 31, 50: 36, 176: 23, 178: 30, 332: 38, 333: 40, 334: 42,
        348: 10, 538: 25, 640: 32, 641: 34, 642: 30, 643: 30, 644: 34, 645: 30, 646: 24, 647: 20,
        648: 20, 649: 20, 650: 20, 651: 38, 652: 38, 653: 38, 654: 38, 655: 35, 656: 45, 657: 45,
        658: 45, 659: 45, 660: 44, 661: 44, 662: 44, 663: 44, 664: 44, 665: 46, 666: 46, 667: 46,
        668: 46, 669: 46, 670: 49, 671: 49, 672: 49, 673: 49, 674: 49, 675: 40, 676: 52, 677: 52,
        678: 52, 679: 52, 680: 55, 681: 55, 682: 55, 683: 55, 684: 55, 848: 32, 1164: 38, 1165: 50,
        1166: 50, 1167: 50, 1168: 50, 1174: 39, 1307: 53, 1308: 53, 1309: 53, 1310: 53, 1311: 53,
        1355: 48, 1356: 48, 1357: 48, 1358: 48, 1359: 48
    };

    // Map of item ID -> base damage/accuracy/armour. Missing values are 0.
    const BASE_STATS_MAP = Object.keys({
        ...BASE_DAMAGE_VALUES,
        ...BASE_ACCURACY_VALUES,
        ...BASE_ARMOUR_VALUES
    }).reduce((map, id) => {
        map[id] = {
            baseDamage: BASE_DAMAGE_VALUES[id] ?? 0,
            baseAccuracy: BASE_ACCURACY_VALUES[id] ?? 0,
            baseArmour: BASE_ARMOUR_VALUES[id] ?? 0
        };
        return map;
    }, {});

    // Bonuses with a fixed effect and no number (sledgehammer, tranquilizer gun, handbag).
    const FIXED_BONUSES = ['Smash', 'Sleep', 'Storage'];

    const NUMBER_REGEX = /(\d+(?:\.\d+)?)/;
    const ITEM_ID_FROM_IMG = /\/images\/items\/(\d+)\//;
    const SETTINGS_KEY = 'openmarket-enhanced-settings';

    let darkMode = false;
    let currentHandler = null;

    // ---------------------------------------------------------------- settings (filter only)

    const settings = loadSettings();

    function loadSettings() {
        const defaults = { minQuality: 0, hideBelow: false, collapsed: false, pos: null };
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return defaults;
            const parsed = JSON.parse(raw);
            return {
                minQuality: clampNumber(parsed.minQuality, 0, 300, 0),
                hideBelow: !!parsed.hideBelow,
                collapsed: !!parsed.collapsed,
                pos: parsed.pos && Number.isFinite(parsed.pos.x) && Number.isFinite(parsed.pos.y) ? { x: parsed.pos.x, y: parsed.pos.y } : null
            };
        } catch (e) {
            return defaults;
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) { /* storage unavailable: the filter still works for this page view */ }
    }

    function clampNumber(value, min, max, fallback) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    }

    // ---------------------------------------------------------------- helpers

    function checkDarkMode() {
        darkMode = !!document.body && document.body.classList.contains('dark-mode');
    }

    function getTierColour(percent) {
        const colours = darkMode ? COLOURS.tiers.dark : COLOURS.tiers.light;
        if (percent <= 25) return colours[0];
        if (percent <= 50) return colours[1];
        if (percent <= 75) return colours[2];
        return colours[3];
    }

    function qs(selector, parent = document) {
        try {
            return parent ? parent.querySelector(selector) : null;
        } catch (e) {
            return null;
        }
    }

    function qsa(selector, parent = document) {
        try {
            return parent ? Array.from(parent.querySelectorAll(selector)) : [];
        } catch (e) {
            return [];
        }
    }

    function create(tag, attrs = {}, children = []) {
        const el = document.createElement(tag);
        Object.entries(attrs).forEach(([key, value]) => {
            if (key === 'style' && typeof value === 'object') {
                Object.assign(el.style, value);
            } else if (key === 'dataset' && typeof value === 'object') {
                Object.entries(value).forEach(([k, v]) => el.dataset[k] = v);
            } else {
                el[key] = value;
            }
        });
        children.forEach(child => {
            if (typeof child === 'string') {
                el.appendChild(document.createTextNode(child));
            } else if (child) {
                el.appendChild(child);
            }
        });
        return el;
    }

    // Waits for an element to exist, then calls back once. Gives up after ~60 seconds.
    function waitFor(selector, callback) {
        const found = qs(selector);
        if (found) { callback(found); return; }
        const observer = new MutationObserver(() => {
            const el = qs(selector);
            if (el) {
                observer.disconnect();
                clearTimeout(timer);
                callback(el);
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        const timer = setTimeout(() => observer.disconnect(), 60000);
    }

    // Batches processing to at most once per animation frame. This only re-reads the page and
    // updates labels; it never triggers any request.
    let processQueued = false;
    function scheduleProcess() {
        if (processQueued || !currentHandler) return;
        processQueued = true;
        requestAnimationFrame(() => {
            processQueued = false;
            if (currentHandler) currentHandler.processAll();
        });
    }

    function getQualityColour(value, maxRange) {
        return getTierColour((value / maxRange) * 100);
    }

    function getBonusColour() {
        return darkMode ? COLOURS.bonus.dark : COLOURS.bonus.light;
    }

    function getQualityBoxBg() {
        return darkMode ? COLOURS.qualityBoxBg.dark : COLOURS.qualityBoxBg.light;
    }

    // Reads damage/accuracy/armour from a tile. Works for item market, bazaar and auction house.
    function extractStats(el, selectors) {
        let damage = 0, accuracy = 0, armour = 0;

        const container = qs(selectors.statsContainer, el);
        if (!container) return { damage, accuracy, armour };

        qsa(selectors.statEntry, container).forEach(entry => {
            const valueEl = qs(selectors.statValue, entry);
            const iconEl = qs(selectors.statIcon, entry);
            const val = parseFloat(valueEl?.textContent) || 0;

            const typeEl = selectors.statTypeElement === 'value' ? valueEl : iconEl;
            let typeText = '';
            if (selectors.statTypeAttribute === 'className') {
                typeText = String(typeEl?.className || '').toLowerCase();
            } else {
                typeText = (typeEl?.getAttribute(selectors.statTypeAttribute) || '').toLowerCase();
            }

            if (typeText.includes('damage')) damage = val;
            else if (typeText.includes('accuracy')) accuracy = val;
            else if (typeText.includes('armor') || typeText.includes('defence')) armour = val;
        });

        return { damage, accuracy, armour };
    }

    // Auction house and bazaar keep bonus info in the DOM.
    function extractBonusesFromDOM(el, selectors) {
        const bonuses = [];

        qsa(selectors.bonusIcons, el).forEach(icon => {
            const titleAttr = (selectors.bonusTitleAttr && icon.getAttribute(selectors.bonusTitleAttr)) || '';
            const descAttr = (selectors.bonusDescAttr && icon.getAttribute(selectors.bonusDescAttr)) || '';
            if (!titleAttr && !descAttr) return;

            // Parse the title HTML without attaching it to the page (inert, nothing runs or loads).
            const tmp = document.implementation.createHTMLDocument('').createElement('div');
            tmp.innerHTML = titleAttr;
            const title = qs('b', tmp)?.textContent || tmp.textContent || '';
            const descText = tmp.textContent.replace(title, '').trim() || descAttr;

            const valueMatch = descText.match(NUMBER_REGEX);
            const value = valueMatch ? parseFloat(valueMatch[1]) : null;

            if (title) bonuses.push({ title, value, description: descText });
        });

        return bonuses;
    }

    function itemIdFromImage(el, selector) {
        const img = qs(selector, el);
        const match = img?.src?.match(ITEM_ID_FROM_IMG);
        return match ? match[1] : null;
    }

    // Quality isn't provided by the game, so it's estimated from the stats. Not perfectly accurate.
    function calcQuality(itemID, damage, accuracy, armour) {
        const base = BASE_STATS_MAP[itemID];
        if (!base) return null;

        if (armour && armour !== 0) {
            return ((armour - base.baseArmour) * 20).toFixed(1);
        }
        return (((damage - base.baseDamage) + (accuracy - base.baseAccuracy)) * 10).toFixed(1);
    }

    function getUnitFromDescription(description, value) {
        if (!description || value === undefined || value === null) return '';
        const pattern = new RegExp(String(value).replace('.', '\\.') + '\\s*%');
        return pattern.test(description) ? '%' : '';
    }

    function createBonusEl(bonus) {
        const name = bonus.title || '';
        const value = bonus.value;
        const description = bonus.description || '';

        let text = name;
        if (!FIXED_BONUSES.includes(name) && value !== undefined && value !== null) {
            text = `${name}: ${value}${getUnitFromDescription(description, value)}`;
        }

        return create('div', {
            className: 'openmarket-bonus',
            textContent: text,
            style: { color: getBonusColour() }
        });
    }

    function insertQualityBox(container, value, maxRange) {
        if (!container) return;

        const span = create('span', {
            className: 'label-value t-overflow',
            textContent: `Q ${value}%`
        });

        const box = create('div', {
            className: 'openmarket-quality-box',
            dataset: { omValue: value, omMax: maxRange },
            style: {
                position: 'absolute',
                top: '2px',
                left: '2px',
                padding: '1px 3px',
                borderRadius: '3px',
                fontSize: '11px',
                fontWeight: 'bold',
                zIndex: '2',
                background: getQualityBoxBg(),
                color: getQualityColour(parseFloat(value), maxRange)
            }
        }, [span]);

        if (window.getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        container.appendChild(box);
    }

    // Removes this script's labels from a tile and un-hides anything it hid.
    function clearTile(el) {
        qsa('.openmarket-quality-box, .openmarket-bonuses', el).forEach(n => n.remove());
        qsa('[data-om-hidden]', el).forEach(n => {
            n.style.display = n.dataset.omHidden === '_' ? '' : n.dataset.omHidden;
            delete n.dataset.omHidden;
        });
        delete el.dataset.omSig;
        delete el.dataset.omQ;
        el.classList.remove('openmarket-dim', 'openmarket-hide');
    }

    // Labels one tile. Torn re-uses tile elements for different items, so each tile remembers
    // a signature of what it was labelled for and is re-labelled when that changes.
    function processItem(el, data) {
        const { itemID, stats, bonuses, selectors } = data;

        const quality = calcQuality(itemID, stats.damage, stats.accuracy, stats.armour);
        const sig = quality === null ? '' : [
            itemID, stats.damage, stats.accuracy, stats.armour,
            bonuses.map(b => `${b.title}:${b.value}`).join(',')
        ].join('|');

        if (el.dataset.omSig === sig && sig !== '') {
            applyFilterToTile(el);
            return;
        }

        clearTile(el);
        if (quality === null) return;

        const titleEl = qs(selectors.title, el);
        if (!titleEl) return;

        if (bonuses.length > 0) {
            const bonusContainer = create('div', {
                className: 'openmarket-bonuses',
                style: { lineHeight: '1' }
            }, bonuses.map(createBonusEl));

            if (data.insertBefore && data.insertBefore.parentNode === titleEl) {
                titleEl.insertBefore(bonusContainer, data.insertBefore);
            } else {
                titleEl.appendChild(bonusContainer);
            }
        }

        (data.hideElements || []).forEach(hideEl => {
            if (!hideEl || hideEl.dataset.omHidden !== undefined) return;
            hideEl.dataset.omHidden = hideEl.style.display || '_';
            hideEl.style.display = 'none';
        });

        const isArmour = stats.armour > 0;
        insertQualityBox(qs(selectors.imageWrapper, el), quality, isArmour ? 100 : 300);

        el.dataset.omSig = sig;
        el.dataset.omQ = quality;
        applyFilterToTile(el);
    }

    // Re-colours existing badges after a dark/light mode switch.
    function recolourAll() {
        qsa('.openmarket-quality-box').forEach(box => {
            box.style.background = getQualityBoxBg();
            box.style.color = getQualityColour(parseFloat(box.dataset.omValue), Number(box.dataset.omMax));
        });
        qsa('.openmarket-bonus').forEach(b => { b.style.color = getBonusColour(); });
        filterUI.refreshTheme();
    }

    // ---------------------------------------------------------------- quality filter (visual only)

    function applyFilterToTile(el) {
        const q = parseFloat(el.dataset.omQ);
        const below = settings.minQuality > 0 && Number.isFinite(q) && q < settings.minQuality;
        const wantDim = below && !settings.hideBelow;
        const wantHide = below && settings.hideBelow;
        // Only touch classes when they actually change, so we don't feed our own observers.
        if (el.classList.contains('openmarket-dim') !== wantDim) el.classList.toggle('openmarket-dim', wantDim);
        if (el.classList.contains('openmarket-hide') !== wantHide) el.classList.toggle('openmarket-hide', wantHide);
    }

    function applyFilterToAll() {
        qsa('[data-om-q]').forEach(applyFilterToTile);
        filterUI.updateCount();
    }

    const filterUI = {
        el: null,

        mount() {
            if (!CONFIG.showFilter || this.el) return;

            const label = create('span', { className: 'om-f-label' });
            const slider = create('input', {
                type: 'range', min: '0', max: '300', step: '5',
                value: String(settings.minQuality), className: 'om-f-range',
                title: 'Minimum quality. Weapons go up to about 300%, armour to about 100%.'
            });
            const hide = create('input', { type: 'checkbox', checked: settings.hideBelow, id: 'om-f-hide' });
            const hideLabel = create('label', { htmlFor: 'om-f-hide', className: 'om-f-small' }, [hide, ' Hide']);
            const count = create('span', { className: 'om-f-small om-f-count' });
            const toggle = create('button', { type: 'button', className: 'om-f-toggle', title: 'Show or hide the filter' });
            const body = create('div', { className: 'om-f-body' }, [slider, hideLabel, count]);

            const render = () => {
                label.textContent = settings.minQuality > 0 ? `Min Q ${settings.minQuality}%` : 'Min Q off';
                body.style.display = settings.collapsed ? 'none' : '';
                toggle.textContent = settings.collapsed ? '▸' : '▾';
            };

            slider.addEventListener('input', () => {
                settings.minQuality = Number(slider.value);
                render();
                applyFilterToAll();
            });
            slider.addEventListener('change', saveSettings);
            hide.addEventListener('change', () => {
                settings.hideBelow = hide.checked;
                saveSettings();
                applyFilterToAll();
            });
            toggle.addEventListener('click', () => {
                settings.collapsed = !settings.collapsed;
                saveSettings();
                render();
            });

            // TUCC: drag the grip to move the filter anywhere; double-click the grip to put it back bottom-right.
            const grip = create('span', { className: 'om-f-grip', title: 'Drag to move · double-click to reset' });
            grip.textContent = '⠿';
            this.el = create('div', { id: 'openmarket-filter' }, [grip, toggle, label, body]);
            const el = this.el;
            const place = () => {
                if (!settings.pos) { el.style.left = el.style.top = ''; el.style.right = el.style.bottom = ''; return; }
                const w = el.offsetWidth || 200, h = el.offsetHeight || 30;
                const x = Math.max(0, Math.min(window.innerWidth - w, settings.pos.x)), y = Math.max(0, Math.min(window.innerHeight - h, settings.pos.y));
                el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
            };
            grip.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                const r0 = el.getBoundingClientRect(), dx = e.clientX - r0.left, dy = e.clientY - r0.top;
                const move = (ev) => { settings.pos = { x: ev.clientX - dx, y: ev.clientY - dy }; place(); };
                const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveSettings(); };
                document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
            });
            grip.addEventListener('dblclick', () => { settings.pos = null; place(); saveSettings(); });
            window.addEventListener('resize', place);
            setTimeout(place, 0);
            this.countEl = count;
            document.body.appendChild(this.el);
            render();
            this.refreshTheme();
            this.updateCount();
        },

        updateCount() {
            if (!this.countEl) return;
            const tiles = qsa('[data-om-q]');
            const below = tiles.filter(t => t.classList.contains('openmarket-dim') || t.classList.contains('openmarket-hide')).length;
            this.countEl.textContent = settings.minQuality > 0 ? `${tiles.length - below}/${tiles.length}` : '';
        },

        refreshTheme() {
            if (this.el) this.el.classList.toggle('om-light', !darkMode);
        }
    };

    // ---------------------------------------------------------------- page activity

    // Only process while this tab is visible AND the window has focus (as in the original).
    function isPageActive() {
        return !document.hidden && document.hasFocus();
    }

    function setupActiveListeners() {
        document.addEventListener('visibilitychange', scheduleProcess);
        window.addEventListener('focus', scheduleProcess);
    }

    // ---------------------------------------------------------------- item market

    const itemMarket = {
        // In-memory only. See COMPLIANCE NOTE at the top.
        cache: [],
        selectors: SELECTORS.itemMarket,

        addToCache(items) {
            const existingIds = new Set(this.cache.map(i => i.listingID));
            const newItems = items.filter(item => item && !existingIds.has(item.listingID));
            if (newItems.length === 0) return;
            this.cache.push(...newItems);
            if (this.cache.length > CONFIG.maxCacheItems) {
                this.cache.splice(0, this.cache.length - CONFIG.maxCacheItems);
            }
            if (currentHandler === this && isPageActive()) scheduleProcess();
        },

        // Finds the captured listing matching a tile's price and stats. If several listings match
        // but carry different bonuses, returns null rather than guess.
        matchToCache(el) {
            if (this.cache.length === 0) return null;
            const price = parseInt(qs(this.selectors.price, el)?.textContent.replace(/[^\d]/g, ''), 10) || 0;
            const stats = extractStats(el, this.selectors);

            const matches = this.cache.filter(item => {
                if (item.armor && item.armor > 0) {
                    return item.minPrice === price && item.armor === stats.armour;
                }
                return item.minPrice === price && item.damage === stats.damage && item.accuracy === stats.accuracy;
            });
            if (matches.length === 0) return null;

            const bonusKey = item => JSON.stringify((item.bonuses || []).map(b => [b.title, b.value]));
            const first = bonusKey(matches[0]);
            if (matches.some(m => bonusKey(m) !== first)) return null;
            return matches[0];
        },

        processAll() {
            if (!isPageActive()) return;

            qsa(this.selectors.tile).forEach(el => {
                const cached = this.matchToCache(el);
                if (cached) {
                    processItem(el, {
                        itemID: cached.itemID,
                        stats: {
                            damage: cached.damage || 0,
                            accuracy: cached.accuracy || 0,
                            armour: cached.armor || 0
                        },
                        bonuses: cached.bonuses || [],
                        selectors: this.selectors
                    });
                    return;
                }

                // Fallback: read the item from the tile itself (quality only, no bonuses).
                const itemID = itemIdFromImage(el, this.selectors.image);
                if (!itemID || !BASE_STATS_MAP[itemID]) { clearTile(el); return; }
                const stats = extractStats(el, this.selectors);
                if (stats.damage === 0 && stats.accuracy === 0 && stats.armour === 0) { clearTile(el); return; }
                processItem(el, { itemID, stats, bonuses: [], selectors: this.selectors });
            });
            filterUI.updateCount();
        },

        init(root) {
            new MutationObserver(scheduleProcess).observe(root, { childList: true, subtree: true });
            scheduleProcess();
        }
    };

    // ---------------------------------------------------------------- auction house

    const auctionHouse = {
        selectors: SELECTORS.auctionHouse,

        processAll() {
            if (!isPageActive()) return;

            const visibleTab = qs(this.selectors.visibleTab);
            if (!visibleTab) return;

            qsa(this.selectors.tile, visibleTab).forEach(el => {
                const hoverEl = qs(this.selectors.itemHover, el);
                const itemID = hoverEl?.getAttribute('item');
                if (!itemID || !BASE_STATS_MAP[itemID]) { clearTile(el); return; }

                const stats = extractStats(el, this.selectors);
                if (stats.damage === 0 && stats.accuracy === 0 && stats.armour === 0) { clearTile(el); return; }

                const titleEl = qs(this.selectors.title, el);
                const rarityLine = qs(this.selectors.rarityLine, titleEl);

                processItem(el, {
                    itemID,
                    stats,
                    bonuses: extractBonusesFromDOM(el, this.selectors),
                    selectors: this.selectors,
                    hideElements: [rarityLine]
                });
            });
            filterUI.updateCount();
        },

        init(root) {
            // The auction countdown changes the DOM every second; batching keeps that cheap.
            new MutationObserver(scheduleProcess).observe(root, { childList: true, subtree: true });
            scheduleProcess();
        }
    };

    // ---------------------------------------------------------------- bazaar

    const bazaar = {
        selectors: SELECTORS.bazaar,

        processAll() {
            if (!isPageActive()) return;

            qsa(this.selectors.tile, qs(this.selectors.root)).forEach(el => {
                const itemID = itemIdFromImage(el, this.selectors.image);
                if (!itemID || !BASE_STATS_MAP[itemID]) { clearTile(el); return; }

                const stats = extractStats(el, this.selectors);
                if (stats.damage === 0 && stats.accuracy === 0 && stats.armour === 0) { clearTile(el); return; }

                const titleEl = qs(this.selectors.title, el);
                const stockEl = qs(this.selectors.stockElement, titleEl);

                processItem(el, {
                    itemID,
                    stats,
                    bonuses: extractBonusesFromDOM(el, this.selectors),
                    selectors: this.selectors,
                    insertBefore: stockEl,
                    hideElements: [stockEl]
                });
            });
            filterUI.updateCount();
        },

        init(root) {
            new MutationObserver(scheduleProcess).observe(root, { childList: true, subtree: true });
            scheduleProcess();
        }
    };

    // ---------------------------------------------------------------- reading the page's own responses

    // Read-only: passes every response through untouched and only reads item market listing data
    // that the page itself requested. Makes no requests of its own.
    function readListingData(url, getJson) {
        if (!String(url || '').includes('sid=iMarket')) return;
        Promise.resolve().then(getJson).then(data => {
            if (data?.items?.length) itemMarket.addToCache(data.items);
        }).catch(() => { });
    }

    function interceptResponses() {
        const originalFetch = window.fetch;
        if (typeof originalFetch === 'function') {
            window.fetch = async function (...args) {
                const response = await originalFetch.apply(this, args);
                try {
                    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
                    readListingData(url, () => response.clone().json());
                } catch (e) { /* never interfere with the page */ }
                return response;
            };
        }

        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            try {
                const xhrUrl = String(url || '');
                if (xhrUrl.includes('sid=iMarket')) {
                    this.addEventListener('load', () => {
                        readListingData(xhrUrl, () => {
                            if (this.responseType === 'json') return this.response;
                            if (this.responseType && this.responseType !== 'text') return null;
                            return JSON.parse(this.responseText);
                        });
                    });
                }
            } catch (e) { /* never interfere with the page */ }
            return originalOpen.apply(this, arguments);
        };
    }

    // ---------------------------------------------------------------- styles

    function insertStyles() {
        const css = `
        [class*="itemTile___"] { padding: 5px 3px 0 !important; }
        [class*="itemTile___"] [class*="title___"] { padding: 5px 0 0px !important; }
        .openmarket-bonuses div { font-size: 11px !important; }
        .openmarket-dim { opacity: 0.28 !important; transition: opacity .15s; }
        .openmarket-hide { display: none !important; }

        #openmarket-filter {
            position: fixed; right: 12px; bottom: 12px; z-index: 99999;
            display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
            max-width: calc(100vw - 24px); box-sizing: border-box;
            padding: 6px 10px; border-radius: 8px;
            font: 12px/1.2 Arial, sans-serif;
            background: rgba(20,20,20,0.92); color: #ddd;
            border: 1px solid #444; box-shadow: 0 2px 8px rgba(0,0,0,.4);
        }
        #openmarket-filter.om-light { background: rgba(250,250,250,0.95); color: #333; border-color: #bbb; }
        #openmarket-filter .om-f-body { display: flex; align-items: center; gap: 8px; }
        #openmarket-filter .om-f-label { font-weight: bold; min-width: 78px; }
        #openmarket-filter .om-f-range { width: 130px; margin: 0; }
        #openmarket-filter .om-f-small { font-size: 11px; opacity: .85; display: inline-flex; align-items: center; gap: 3px; cursor: pointer; }
        #openmarket-filter .om-f-count { cursor: default; }
        #openmarket-filter .om-f-grip { cursor: grab; user-select: none; touch-action: none; font-size: 14px; line-height: 1; opacity: .8; padding: 0 2px; }
        #openmarket-filter .om-f-grip:active { cursor: grabbing; }
        #openmarket-filter .om-f-toggle {
            background: none; border: none; color: inherit; cursor: pointer;
            font-size: 12px; padding: 0 2px; line-height: 1;
        }
    `;
        const style = document.createElement('style');
        style.textContent = css;
        const attach = () => {
            const parent = document.head || document.documentElement;
            if (!parent) return false;
            parent.appendChild(style);
            return true;
        };
        // At document-start the page may not have a root element yet; attach once it does.
        if (!attach()) {
            const observer = new MutationObserver(() => { if (attach()) observer.disconnect(); });
            observer.observe(document, { childList: true, subtree: true });
        }
    }

    // ---------------------------------------------------------------- initialisation

    function start() {
        checkDarkMode();
        setupActiveListeners();

        // Follow dark/light mode changes live.
        new MutationObserver(() => {
            const was = darkMode;
            checkDarkMode();
            if (was !== darkMode) recolourAll();
        }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

        const href = window.location.href;
        let handler = null;

        if (href.includes('sid=ItemMarket') && CONFIG.enableItemMarket) handler = itemMarket;
        else if (href.includes('amarket.php') && CONFIG.enableAuctionHouse) handler = auctionHouse;
        else if (href.includes('bazaar.php') && CONFIG.enableBazaar) handler = bazaar;
        if (!handler) return;

        currentHandler = handler;
        filterUI.mount();
        waitFor(handler.selectors.root, root => handler.init(root));
    }

    function init() {
        // Styles and response reading are set up before the page loads.
        insertStyles();
        interceptResponses();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start);
        } else {
            start();
        }
    }

    init();
})();
