# Changelog

All dates are 2026. Versions before 0.14.4 were private test builds.

## 0.14.5-tablet · 17 November

- **Torn PDA: TUCC now loads.** PDA rewrites curly quotes in a script to straight ones before running it, which broke a quoted string and stopped 0.14.0 to 0.14.4 from loading in PDA at all. The built file now carries those characters as escapes. Nothing changes in Tampermonkey.

## 0.14.4-tablet · 17 November · first public release

- **Lockpick:** Refresh now reloads the jail page. The in-place update is an optional **Fast refresh** switch in Lockpick's settings, off by default and awaiting a staff ruling.
- Script header now carries the repository, update and download addresses, so Tampermonkey can update TUCC.
- ToS, README, compliance record and credits brought up to date.

## 0.14.3-tablet · 17 November

- **Hidden tabs:** Torn Pulse and Medal Detector no longer call the API while the tab is hidden; each checks once when you return.
- **No browser pop-ups:** every "are you sure?" box is replaced by a short note and a second press of the same button within 8 seconds. Messages show as a note at the bottom of the page.
- **Slow-down replies:** an HTTP 429, 502, 503 or 504 from Torn pauses every module and tab.

## 0.14.2-tablet · 17 November

- **Crimes Analyst** and **Company Manager** open by themselves after you press "Go to…" on the tablet.
- Table spacing fixed in every TUCC window (Torn's page styles were removing it).

## 0.14.1-tablet · 17 November

- **Cash Desk:** preset buttons use a dark tint of the accent colour; only Deposit All and Offer All Cash keep the full fill.

## 0.14.0-tablet · 17 November

- **Torn PDA support.** Requests go through PDA's own request functions; a floating TUCC button opens the tablet; the API Keys app offers "Use Torn PDA key" (PDA's key is never used unless you press it); alerts stay inside TUCC because PDA shows notifications as a blocking box.
- **Floating TUCC button** for phones and any browser where the Areas row can't be seen (Settings: Auto, Always, Off).
- **Phone layout:** the tablet fills the screen; fixes for Recruiting Mastered's panel, Attack Hybrid's weapon bar and OC Command Centre's settings.
- Torn Pulse's first-run screen and Medal Detector's own floating button are hidden inside TUCC.

## 0.13.0 to 0.13.11 · November

- **New: Defib**, a hospital revive HUD in the style of Lockpick: your revive chance on every patient, Best Revive, a chance floor, revive clients and billing.
- **Travel 2.Dough 1.8 to 1.9.6:** suitcase, faction and other perks are read from the API; hunting information for South Africa trips, with an estimate from skill 70 and a learner below that.
- **Tablet:** app tiles scale with screen height so the home screen needs no scrolling.
- **Removed: Armoury.**
- Full review of the ToS, README, compliance record and credits.

## 0.10.7 to 0.12.12 · early November

- The tablet interface, the shared API engine and key store, the alerts centre, themes, and the first full compliance check (0.10.7, 2 November).
