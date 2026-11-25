# Torn Ultimate Command Centre [TUCC]

One userscript for Torn that bundles Eaglewing's Torn tools (20 modules, including WinterValor's TORN Auction Price Checker, with his permission) behind one key screen, one dark theme (in five accent colours: Red, Blue, Purple, Teal and Graphite) and one shared Torn API engine.

Version **0.16.0-tablet** · by **Eaglewing [571041]** · licence **GPL-3.0-or-later** · for Tampermonkey and Torn PDA (PDA support is new; 0.14.5 fixes a fault that stopped TUCC loading in PDA at all).

**[Install TUCC](https://raw.githubusercontent.com/Eaglewing91/TUCC/main/TUCC.user.js)** · [Changelog](CHANGELOG.md) · [Terms of Service](TOS.md) · [Compliance record](COMPLIANCE.md) · [Credits](CREDITS.md)

TUCC is fan-made and not affiliated with Torn. All game data comes from the official [Torn API](https://www.torn.com/api.html) or from the page you are viewing.

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open the TUCC file (`TUCC.user.js`) and press **Install**.
3. **Disable or uninstall the standalone copies** of any bundled script (Travel 2.Dough, Torn Pulse, Lockpick, OC Command Centre and so on), so nothing runs twice.
4. Reload Torn. A **TUCC** row appears in the Areas list in Torn's sidebar.

### Torn PDA

1. In Torn PDA open the **userscripts manager** (in Settings, under the browser settings) and add TUCC from its address or by pasting the file.
2. If PDA asks when to run it, choose **Start**. (TUCC also works at End; tools then appear a moment later.)
3. Remove PDA copies of any bundled script, so nothing runs twice.
4. Open Torn. A round **TUCC button** floats on the page: tap it to open the tablet, drag it to move it.

What is different in Torn PDA:

- **Floating button** instead of the Areas row (Torn folds the Areas list away on phones). Settings → Floating TUCC button has Auto, Always and Off. It also appears in any browser where the Areas row can't be seen.
- **Use Torn PDA key**: the API Keys app offers the key saved in PDA. TUCC only uses it if you press that button.
- **Alerts stay inside TUCC.** PDA shows script notifications as a pop-up box that blocks the page, so TUCC doesn't send them there; alerts still collect in the Alerts app and on the button's badge.
- **Requests** go through PDA's own request functions, with the same rules: api.torn.com and the listed outside services only.
- **Storage**: PDA keeps script data in the Torn page's storage (about 5 MB, shared with Torn). TUCC warns you if it is nearly full.
- **Phone layout**: the tablet fills the screen, tool windows open as bottom sheets, wide tables scroll sideways inside their box, and Attack Hybrid's weapon bar sits across the bottom.
- Attack Hybrid's number-key binds need a keyboard.

## Using TUCC: the tablet

Click **TUCC** in the Areas list and a tablet opens over the page you are on. Opening it only draws on the page; it makes no request to Torn.

- **Apps** (tap to open): modules that can open their window on the page you are on. Tapping one closes the tablet and opens that module, exactly like its own button would.
- **Page tools** (dashed outline): modules that work on a particular Torn page, such as Lockpick on the jail or OpenMarket on the Item Market. Tapping one shows what it does and a link to that page. The rows follow the page you are on.
- **TUCC apps**: **Settings** (switch modules on or off, alerts, shared API data, updates), **Themes** (pick the accent colour: Red, Blue, Purple, Teal or Graphite, or turn the TUCC look off for modules), **Alerts**, **API Keys** (keys and Terms of Service), **API Usage** and **Credits**.
- Close the tablet with ✕, the Esc key or a click outside it. The bar at the bottom always returns to the home screen.
- Ctrl-click or middle-click **TUCC** to open the full TUCC page in a new tab instead.

A module switched off in Settings does not run at all and has no app. Changes take effect when you reload the page.

## API keys

Create keys on Torn's [API key page](https://www.torn.com/preferences.php#tab=api). TUCC has two key slots (**API Keys** app):

| Slot | Used by | Key to use |
|---|---|---|
| **Limited key or less** | every module that calls the API except Lockpick | A **Limited** key. Some modules need less (Public or Minimal). OC Command Centre's live overview and Defib's faction parts also need your faction to give your position API access. |
| **Full Access key** | Lockpick (it reads your bust log) | A **Custom** key with user → basic, log, perks, or a Full Access key. Only Lockpick ever receives it. |

One key for everything: paste the same Full Access (or Custom) key in both slots. When you save a key, TUCC checks it once with Torn's key-info call and shows a green **✓ Key OK** or a red reason on every module, then rechecks every 6 hours.

## Modules

### No API needed (7)
These never call the Torn API and need no key. They work only with the page you are viewing.

| Module | Version | Where it works | What it does |
|---|---|---|---|
| **Torn Spectrum** | 1.6.0 | every page | Accessibility colour layers and reading aids for Torn (visual only, no requests). |
| **Attack Hybrid Ultimate** | 3.7.3 | attack pages | Attack page: drag Torn's attack buttons and weapon bar anywhere; keys 1-4; one press = one action; shows only your chosen Leave / Mug / Hosp. Based on scripts by olesien [2187764]. |
| **Combat Desk** | 0.4.0 | attack pages | One button that starts the fight, uses the right weapon for the turn and presses your finish option. One press = one action. Plans are built from your own equipped weapons, their bonuses and mods, the effects on both fighters, the action log and the opponent's armour; needles go first; War, Mug, Merc and Farm modes pick the finishing weapon. **Off by default** and new: switch it on in Settings. With a key (optional, Minimal) it also reads your perks and equipped weapon stats from the Torn API and ranks your weapons by them. While it is on, Attack Hybrid Ultimate steps aside. Makes no requests to torn.com. |
| **OpenMarket (Enhanced)** | 1.1.0 | the Item Market, auctions and bazaars | Item market, auction house and bazaars: quality % and bonus values on weapons and armour, plus a Min Q filter. Original by Snickelfritz (GNU GPLv3), enhanced by Eaglewing. |
| **Cash Desk** | 1.1.0 | your property vault, company funds and trades | Vault and company funds: one-click 25m / 50m / 100m / 250m / 500m deposit and withdraw, plus Deposit All (only what fits in the vault). Trades: Offer All Cash. One click = one press of Torn's own button; it never confirms for you. Reads the page only; no requests. |
| **Item Pins** | 1.0.0 | your Items page | Items page: a pin on every item; pinned items stay at the top of their tab (weapons and armour by their own ID, other items by type). Only rearranges the page you are viewing; no requests. |
| **Ranked Notes** | 2.2.1 | the armoury, Items, auctions, Item Market, bazaars, display cases and trades | A + button on ranked war weapons and armour: attach a note to that exact item, shown wherever it appears. Reads the page only; no requests. |
| **TORN Auction Price Checker** | 5.3.0 | ranked war items: auction house, Item Market, Items, bazaars, display cases, faction armoury, trades and profiles | Ranked war weapons and armour: a Price Check button on each expanded item shows past auction prices for similar items, plus current Item Market and bazaar listings. By WinterValor [3945658], included with his permission. Searches only when you click. |

### Limited key or less (12)

| Module | Version | Where it works | Key needed | What it does |
|---|---|---|---|---|
| **Travel 2.Dough** | 1.9.6 | every page | Public (Minimal adds travel status, energy, cooldowns, perks, your Business Class Ticket count and hunting skill; Limited adds exact restock times from your Stock Analysis reports) | Travel 2.0 trip planner: best trips, exports and imports, item market prices, restock times, bazaars, Travel Agency and market badges. |
| **Recruiting Mastered (Experimental)** | 0.1.9-experimental | the User List | Public | User List and company pages: Working Stats badge, local Contacted tick and one-click mail icon per player. |
| **OC Command Centre** | 4.3.2 | every page | Minimal (faction API access for the live overview) | Faction organised crimes: live overview, CPR helpers on the crimes page, item costs and reports. |
| **Torn Pulse** | 2.11.0 | every page | Limited | Advisor and alerts: cooldown, booster and medical alerts, unused refills before the Torn day ends, growth advice, and gym training with Baldr's, Hank's or a custom stat ratio (Steadfast and other perks included, specialist gyms guarded, only gyms you have unlocked). |
| **RW Energy Guard** | 0.4.0 | the gym | Public | Gym: asks you to confirm before training while your faction has a ranked war pending, to protect stacked energy. |
| **Medal Detector** | 2.1.1 | every page | Limited | Every honour and medal, your next award for each stat, and daily goals towards them (Torn API only). |
| **War Room** | 1.0.0 | every page | Public | Ranked war overview: enemy members by status with hospital timers, who is out next, both chains, and a chain-timeout alert. Names link to attack pages; you click. |
| **Crimes Analyst** | 1.0.0 | the Crimes page | Minimal | Crimes page: success rate, skill, money per nerve and critical fails for every crime type, from your own crime stats. |
| **Company Manager** | 1.0.0 | your company page | Limited (director for full detail) | Company page: employee effectiveness, inactivity and addiction flags, working stats, wages, and company funds, popularity and trains. |
| **Market Watcher** | 1.0.0 | every page | Public | Watch items and stocks against your target prices and get an alert when they hit. Items are checked every 30 minutes, since Torn updates item market data about once an hour. Read-only: buying and selling stay manual. |
| **Big Al's Watch** | 1.0.0 | every page | Public | Alerts you when the cameras and guards at Big Al's Gun Shop are all down, the window for shoplifting Special Ammo. TUCC version of swervelord's Big Al's Special Ammo Alert. |
| **Defib: Hospital Revive HUD** | 1.0.0 | the hospital | Limited (faction API access for faction mates' exact chances, the fit and faction alerts) | Hospital page, in the style of Lockpick: your revive chance on every patient, energy and revives left, one-press Best Revive / Best Client (one press = one click on that row's own Revive link; you confirm), a chance floor, client alerts, billing from Torn's revive records, and a formula that tunes itself to the chances Torn recorded. |

### Full Access key (1)

| Module | Version | Where it works | Key needed | What it does |
|---|---|---|---|---|
| **Lockpick: Jail Bust HUD** | 1.4.9 | the jail | Custom: user basic, log, perks (or Full Access) | Jail page: odds on every prisoner, a heat gauge for your bust penalty, a bail cap, and one-press Best Bust / Best Bail (one press = one click on that row's own link). Heat curve adapted from BUSTR by Adobi, Ironhydedragon and The_Baron (MIT). |

## How TUCC keeps to Torn's scripting rules

Torn allows scripts that use data from the Torn API or from a page you loaded yourself, and forbids non-API requests to Torn that you did not trigger. TUCC is built around that:

- **Only the Torn API is called automatically.** Background refreshes, alerts and timers call `api.torn.com` only.
- **No automatic requests to torn.com pages.** TUCC's core blocks any module request to torn.com that is not the API. Lockpick's **Refresh** button reloads the jail page (one press, one ordinary page load). The one exception is Lockpick's optional **Fast refresh** switch, which is **off by default and awaiting a staff ruling**: with it on, Refresh instead sends one request for Torn's own jail list (the same one the jail page makes when you change page), allowed only straight after a real click and only once per click.
- **One input = one action.** Every button that acts on Torn (Best Bust, Best Bail, Best Revive, Best Client, Cash Desk presets, Hybrid's weapon keys, RW Energy Guard's confirm) presses exactly one of Torn's own buttons or links, once, and only on a real click or key press. Holding a key never repeats an action. Nothing clicks, submits or navigates by itself.
- **Reading the page is passive.** Modules read only the page you are viewing and never send anything because of it: OpenMarket reads the data your own page has already loaded, Defib reads the chance in Torn's revive confirm box, and Travel 2.Dough reads the Travel Agency and the result of your own hunts.
- **Hidden tabs.** Modules built for TUCC (War Room, Market Watcher, Big Al's Watch, Defib and the rest) call the API only while a Torn tab is visible. Torn Pulse and Medal Detector keep checking in the background (about 4 calls a minute) so their alerts and daily history stay current.
- **One API engine.** Every Torn API call goes through one shared engine: a per-minute budget (60 by default, adjustable), a pause after "too many requests" or key/IP errors, and shared answers so two modules or tabs asking for the same data within seconds cost one call.
- **No WebSockets, no hidden code.** No eval, no obfuscation, no tracking.

## Terms of Service

| | |
|---|---|
| **Data Storage** | Only locally: in your userscript manager, plus this browser's storage for a few modules: Attack Hybrid Ultimate (button layout, key binds, attack type), Combat Desk (settings, sequences, button position, and the weapons and armour last seen on up to 150 opponents you attacked), Cash Desk (your presets), Torn Spectrum (settings), OpenMarket (filter), Ranked Notes (notes), Item Pins (pins), TORN Auction Price Checker (settings, recent searches, window position) and OC Command Centre (join-audit history). Defib keeps your revive log (8 days) and your faction's incoming revive log (50 hours). Travel 2.Dough keeps 25 hours of price history and the pay from your last 60 hunts. TUCC keeps recent Torn API answers for seconds up to an hour so modules and tabs don't ask twice. Nothing is uploaded. |
| **Data Sharing** | Nobody. Your key and your Torn data are sent only to api.torn.com. Three modules read public data from community sites (see below): Travel 2.Dough sends item IDs (nothing about you), OC Command Centre sends OC names and pass rates to Torn Probability only if you turn on success chances, and TORN Auction Price Checker sends the item name, bonuses and quality you search for, only when you click. |
| **Purpose of Use** | Competitive advantage: travel planning and hunting, attacking, ranked wars, training and daily progress, crimes and shoplifting alerts, busting and bailing, reviving (revive chances, revive clients and billing), item and stock prices (including ranked war item price history). Public community tools: faction OC management, company management and recruiting. Other: accessibility colour layers, personal award goals, notes on ranked war items, organising your own Items page and moving your own money. |
| **Key Storage & Sharing** | Stored / Used only for automation. Kept in your userscript manager on this device; sent only to api.torn.com (in a request header on API v2; in the address on API v1, which Lockpick, Torn Pulse, Medal Detector, Company Manager and Market Watcher use). In Torn PDA, saved data and your key are kept in the Torn page's storage inside the app (PDA has no separate script storage), so other scripts you add to PDA could read them. In Torn PDA, the key saved in the app is used only if you press "Use Torn PDA key". |
| **Key Access Level** | Custom, per module: **Limited** covers every shared module (OC Command Centre's live overview and Defib's faction parts also need faction API access; Company Manager shows full detail to directors). **Lockpick**: Custom with user → basic, log, perks (or Full Access). Modules with no key never call the API. |

### Outside services

These are read-only. No API key and nothing about you is sent to any of them.

| Service | Used by | What is sent | On by default? |
|---|---|---|---|
| [Prometheus](https://prombot.co.uk/) (api.prombot.co.uk) | Travel 2.Dough: foreign stock | Nothing (plain request for the public travel table) | Yes (choose sources in Travel settings) |
| [TornIntel](https://torn-intel.com/) | Travel 2.Dough: foreign stock | Nothing | Yes (choose sources in Travel settings) |
| [YATA](https://yata.yt/) by Kivou [2000607] | Travel 2.Dough: foreign stock | Nothing | Yes (choose sources in Travel settings) |
| [TornW3B](https://weav3r.dev/) by Weav3r [1853324] | Travel 2.Dough: bazaar prices | Item IDs only | Yes (switch off "Include bazaar prices") |
| [Torn Probability](https://tornprobability.com/) by Allenone | OC Command Centre: role weights; optional success chances | Nothing for role weights; OC names and pass rates only if you turn on success chances | Role weights yes; success chances no |
| WinterValor's auction search service (torn-auction-search.cfeternal.workers.dev) | TORN Auction Price Checker: past auction prices | The item name, bonuses and quality you search for | Searches only when you click Price Check or Search |
| [TornW3B](https://weav3r.dev/) | TORN Auction Price Checker: current Item Market and bazaar listings | The item name, bonuses and quality you search for | Only when you open its Market & Bazaar tab and search |
| [GitHub](https://github.com/) ([terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)) | TUCC update checker | Nothing (reads the version line of the published file) | Yes (switch off in Settings → Updates) |

Each service has its own terms on its site; using a module that reads from it means using that service.

## Credits and licence

Every module and the TUCC core are by **Eaglewing [571041]**, except as credited in the **Credits** app and in [CREDITS.md](CREDITS.md): OpenMarket (original by Snickelfritz, GNU GPLv3), Attack Hybrid Ultimate (based on scripts by olesien [2187764]), OC Command Centre (builds on earlier OC work by several authors, with Torn Probability by Allenone), Torn Pulse (inspired by curtthecoder's Torn Growth Advisor; Vladar's formula; Baldr's and Hank's ratios), Lockpick (heat curve adapted from BUSTR), TORN Auction Price Checker (by WinterValor [3945658], MIT, included unchanged with his permission), Ranked Notes (page approach credited to WinterValor [3945658]) and Travel 2.Dough's data sources.

TUCC as a whole is released under the **GNU General Public License v3.0 or later**, because it includes OpenMarket (GPLv3). The parts written by Eaglewing may also be used on their own under MIT.

## Feedback

Message **Eaglewing [571041]** in Torn. Torn staff are welcome to get in touch about anything in this script.
