# TUCC — Terms of Service

| | |
|---|---|
| **Data Storage** | Only locally: in your userscript manager, plus this browser's storage for a few modules: Attack Hybrid Ultimate (button layout, key binds, attack type), Combat Desk (settings, sequences, button position, the weapons and armour last seen on up to 150 opponents you attacked, and when your needles were injected), Cash Desk (your presets), Torn Spectrum (settings), OpenMarket (filter), Ranked Notes (notes), Item Pins (pins), TORN Auction Price Checker (settings, recent searches, window position) and OC Command Centre (join-audit history). Defib keeps your revive log (8 days) and your faction's incoming revive log (50 hours). Travel 2.Dough keeps 25 hours of price history and the pay from your last 60 hunts. TUCC keeps recent Torn API answers for seconds up to an hour so modules and tabs don't ask twice. Nothing is uploaded. |
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

### Other scripts on your device

| Script | Used by | What TUCC does | On by default? |
|---|---|---|---|
| [Battle Stats Predictor (BSP)](https://www.torn.com/forums.php#/p=threads&f=67&t=16290324) by TDup | War Room: optional "BSP stats" column | Reads the predictions and spies BSP has already saved in your browser, and your own totals as saved by BSP, to show and colour them. Nothing is sent to BSP's server or anywhere else, your BSP key is not read, and TUCC keeps no copy. BSP itself is a separate script and service with its own terms (linked); TUCC shows nothing unless you run it. | No (your switch in War Room; offered only if BSP is set up in this browser) |
| [TornW3B](https://weav3r.dev/) | TORN Auction Price Checker: current Item Market and bazaar listings | The item name, bonuses and quality you search for | Only when you open its Market & Bazaar tab and search |
| [GitHub](https://github.com/) ([terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)) | TUCC update checker | Nothing (reads the version line of the published file) | Yes (switch off in Settings → Updates) |

Each service has its own terms on its site; using a module that reads from it means using that service.

TUCC version 0.16.3-tablet · Eaglewing [571041]. Reviewed 25 November 2026. The same table is shown in TUCC's API Keys app, under the key boxes.
