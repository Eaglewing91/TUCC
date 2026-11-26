# TUCC compliance record

First full check: v0.10.7-tablet (2 November 2026). Last updated: **v0.16.6-tablet (26 November 2026)**.

## Current status: v0.16.6

| Check (tested on 10 mock Torn pages, 5 simulated minutes each, every module on) | Result |
|---|---|
| Requests to torn.com after the page loads | 0 on every page |
| Page errors | 0 |
| API key in the console | Never |
| Torn API calls | Through one engine, 60 a minute by default. Key in a request header on API v2; in the address on API v1, still used by Lockpick, Torn Pulse, Medal Detector, Company Manager and Market Watcher. |
| Hidden tabs | No API calls from any module while the tab is hidden (0 in 5 simulated minutes on every page). Each checks once when you come back to the tab. |
| Torn says slow down | An API error for too many requests, or an HTTP 429, 502, 503 or 504 reply, pauses every module and tab (60 seconds for 429, 30 for the others, longer if Torn's reply says so). |
| Combat Desk (new, off by default) | Tested on a mock attack page: nothing is pressed without input; each real press passes exactly one click to one of Torn's own controls (Start fight, one weapon, or the finish option); script-made clicks are ignored; a held key gives one action; it makes no requests to torn.com. With a key it makes two Torn API reads (user/perks, user/equipment) when the attack page opens and the tab is visible, plus one torn/{ids}/items read to name armour pieces it has not seen before (saved, so each piece is asked once), all through the shared engine. Torn's own Start fight box is hidden while Combat Desk shows (visual only). It reads effect icons, the action log and the opponent's panel on the page you are viewing; it saves the weapons and armour last seen on up to 150 opponents, on your device only. Not yet tested on a live fight. While it is on, Attack Hybrid Ultimate does not run. |
| War Room BSP stats column (new, off by default) | Tested with and without BSP data present: reads Battle Stats Predictor's saved predictions from the browser's storage for torn.com; makes no request for it; leaves that data unchanged; does not read the BSP key; copies nothing into TUCC's storage. Offered only when BSP is set up in the browser. |
| Modules | 21. Removed since the first check: Stock Ledger, Mugger Manager, Attack Interceptor Pro, Armoury & Vault Tracker (their saved data is cleared automatically). Added: TORN Auction Price Checker, Big Al's Watch, Defib, Combat Desk. |

### Torn PDA (new in v0.14.0)

Tested in a mock of Torn PDA's script environment (PDA's own GMforPDA layer and request functions, taken from PDA's repository), on phone screens. Since 0.14.5 the mock also applies what PDA does to a script's source before running it (swapping the key placeholder, turning curly quotes into straight ones, wrapping the script in a function that runs once per page). Versions 0.14.0 to 0.14.4 did not load in PDA at all: PDA's quote change broke a quoted string. 0.14.5 writes those characters as escapes, so there is nothing for PDA to change.

| Check | Result |
|---|---|
| Requests to torn.com after the page loads (10 mock pages, 5 simulated minutes each) | 0 on every page |
| Torn API calls | Same count as in Tampermonkey on every page; all go through TUCC's engine and then PDA's request functions (`PDA_httpGet` / `PDA_httpPost`). Key in a header on v2. |
| Pop-up boxes | 0. PDA turns script notifications into a confirm box, so TUCC sends none there. |
| Floating TUCC button | One tap opens the tablet (draws on the page only, no request). Dragging it moves it and never opens anything. |
| PDA's own API key | Only the core can read PDA's key placeholder, and it is used only when you press "Use Torn PDA key". The build writes each module's copy of the placeholder in two halves so no module can pick it up by itself. |
| Torn's own saved values | Untouched. In PDA the saved-values list is the whole page's storage, so TUCC only lists and clears names that start with one of its own module names. |
| Layout | Every tablet app opened at 360, 390 and 412 pixels wide: no sideways page scroll, nothing off the screen. |

### For staff: the points worth a ruling

| Item | What it does | Why it is believed to be within the rules |
|---|---|---|
| Lockpick: Refresh | One press reloads the jail page you are viewing. At most one per second; never automatic. | An ordinary page load that you triggered. |
| Lockpick: Fast refresh (optional, **off by default**) | A switch in Lockpick's settings. With it on, one press of Refresh instead sends one request for Torn's own jail list (`jailview.php`, `action=jail`, current page), the same request the jail page sends when you change page, and redraws the rows. At most one per second; never automatic. | **Awaiting a staff ruling.** A request you triggered manually, for the page you are viewing, but one the script builds itself. It is the only place a module does that, and nobody gets it unless they switch it on. |
| Lockpick: skip-confirm switches | Rewrites the Bust or Bail link you clicked to Torn's own no-confirm variant at the moment of your click. | Your click is still the one and only request. |
| Cash Desk: presets | One click fills the amount box and presses Torn's own Deposit or Withdraw button once. It never confirms for you. | Filling a box sends nothing; one input leads to one request. |
| Best Bust / Best Bail / Best Revive / Best Client | One real press = one click on that row's own link on the page you are viewing. | One input, one action; script-made presses are ignored. |
| Page reading | Defib reads the chance in Torn's revive confirm box; Travel 2.Dough reads the Travel Agency and the result of your own hunts. | Data from a page you loaded and are viewing; nothing is sent because of it. |
| Browser pop-ups | None. Where a bundled script asked "are you sure?" in a browser box, TUCC now shows a short note and waits for you to press the same button again within 8 seconds. Messages show as a note at the bottom of the page; key entry points to the API Keys app. | Draws on the page only; nothing is requested, and the second press is your own. |

---

# First check — v0.10.7-tablet (2 November 2026)

Checked against Torn's scripting rule: scripts may only use data from the Torn API or a page you loaded yourself and are viewing; no non-API requests to Torn that you did not trigger manually. Also checked: one input = at most one action, nothing on torn.com triggered by timers or observers, outside sites, WebSockets, hidden code and injected instructions.

Two passes: a scan of every network call, scripted click, navigation and timer in the built file, then an independent second review of the same file.

## Result: no rule breaks

| Check | Result |
|---|---|
| Non-API requests to torn.com | None. TUCC's core blocks any module request to torn.com that is not api.torn.com. The one module given the page's own fetch/XHR (OpenMarket) only reads responses the page already loaded. |
| Automatic actions on Torn | None. Timers and observers only call api.torn.com, read the page, or redraw TUCC's own panels. |
| One input = one action | Yes. Every scripted click (Best Bust/Bail, Cash Desk presets, Hybrid weapon keys, RW Energy Guard's Train anyway) acts once, on a real click or key press; key repeats are ignored. |
| Page loads from TUCC | Only from your own clicks (links, Lockpick's settings link, Hybrid's attack-type reload). Opening the TUCC tablet and moving between apps causes no page load (tested: 0). |
| API use | All Torn API calls go through one engine: 60 per minute by default, pauses on "too many requests" and key/IP errors, shared answers between modules and tabs. |
| WebSockets / beacons / workers | None. |
| eval / new Function / obfuscation | None. The only base64 code decodes OC Command Centre's own settings codes. |
| Instructions aimed at AI reviewers | None found. |

## Fixed during this check

| Module | Change |
|---|---|
| Lockpick | Best Bust, Best Bail and the reload button now act only on a real click (script-made clicks are ignored). Tested: script click → 0 Torn clicks, real click → 1. |
| RW Energy Guard | "Train anyway" now continues to Torn's TRAIN button only on a real click. |
| TUCC ToS | Purpose of Use no longer lists the removed Gym Optimiser and now names every module; Data Sharing now states what goes to TornW3B and Torn Probability. |

## Added after the check (v0.10.11)

| Module | Change | Verdict |
|---|---|---|
| Lockpick | **Refresh list** button updates the prisoner list in place: one POST to Torn's own jail list (`jailview.php`, `action=jail`, current page), the same request the jail page makes when you change page. | Allowed: manually triggered, one request per real click. TUCC's core only permits it for Lockpick, only for that action, only within 3 s of a trusted click or key press, and only once per input. Tested: script click → 0 requests, real click → 1. |

## Added: TORN Auction Price Checker 5.3.0 (v0.11.0), by WinterValor, with permission

| Check | Result |
|---|---|
| Requests to torn.com | None. |
| Automatic actions | None. It adds its Price Check buttons to items on the page you're viewing (every 2 s and on page changes: page drawing only). |
| Outside requests | Only when you click Price Check or Search: item name, bonuses and quality go to WinterValor's search service (torn-auction-search.cfeternal.workers.dev) and TornW3B (weav3r.dev). No API key, nothing about you. Tested: 0 requests before a click, 1 search after. |
| Storage | Its settings, window position and a 5-minute search cache in this browser only. |
| Hidden code / AI-aimed text | None. |

## Flags for review (allowed, listed for transparency)

| Item | Detail |
|---|---|
| Outside sites (read-only, no key sent) | Prometheus (api.prombot.co.uk), TornIntel (torn-intel.com), YATA (yata.yt) and TornW3B (weav3r.dev) for Travel 2.Dough; tornprobability.com for OC Command Centre; raw.githubusercontent.com for the update checker. All declared in `@connect`. TornW3B receives item IDs only; Torn Probability receives OC names and pass rates only if success chances are switched on. |
| OC Command Centre settings from mail | When you open a faction mail containing an OC settings code on the Messages page, OC Command Centre applies those CPR settings automatically (with Undo). It reads the page you are viewing and sends nothing, so it is within the rules, but a mail can change settings without asking. |

## Added: Defib: Hospital Revive HUD 1.0.0 (v0.13.0)

| Check | Result |
|---|---|
| Requests to torn.com | None (tested: 0 over 5 simulated minutes on the hospital page). |
| Torn API | v2 only, key in the request header (tested: no key in any address). About 5 calls a minute on the hospital page in steady state; 2 calls per patient estimate, at most 6 patients a minute, each at most every 20 minutes; energy every 2 minutes on other pages for the menu badge; client checks every minute only if you set up clients. |
| Hidden tabs | No calls (tested: 0 in 5 minutes). |
| One input = one action | Best Revive / Best Client: one real press = one `.click()` on that patient's own Revive link (opens Torn's confirm box), at most one per second; the button is disabled for 1.2 s. Script-made presses are ignored (tested: synthetic press → 0 clicks, real press → 1). Defib never presses Yes. |
| Blocking | Chance floor and Skip early discharge can only stop your own Revive or Yes click (tested: Yes at Torn's 68% with a 90% floor → 0 requests; floor 0 → 1). |
| Page reading | The hospital list and Torn's confirm box on the page you are viewing (Torn's shown chance and energy cost). |
| Outside requests | None. No WebSockets. |
| Grey areas avoided | No click relays, no moving Torn's Yes button, no skip-confirm, no list refresh request, no outside revive services. |

## Added: Travel 2.Dough 1.8.0 to 1.9.6 (v0.13.3 to v0.13.11)

| Check | Result |
|---|---|
| Settings filled in from the API | Suitcase, Faction Excursion, job, books, Airstrip, WLT and job specials from `user/perks`; Business Class Tickets from `user/inventory` (Minimal key); Tourism Day and Tiger Day from `torn/calendar` (Public key); hunting skill from `user/skills` (Minimal key). Read every 30 minutes; API only. |
| Hunting in South Africa trips | Display only: hunts your energy covers, energy after the flight home, rough hunts to the next hunting honor. It never hunts. |
| Hunting pay learner | After your own real click on a hunting session button, reads the money from the result Torn shows on the page you are viewing, for up to 20 seconds, then stops watching. No request is made; script-made clicks are ignored (tested). Keeps your last 60 hunts locally. |
| Requests to torn.com | None (tested). |
| Outside requests | Unchanged: Prometheus, TornIntel, YATA and TornW3B, read-only, nothing about you sent. |
