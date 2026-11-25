# Changelog

All dates are 2026. Versions before 0.14.4 were private test builds.

## 0.15.0-tablet · 25 November

- **New module: Combat Desk** (attack pages, **off by default**). One floating button runs the fight: the first press starts it, each press after uses the right weapon for that turn, and the last press is your finish option. One press = one action; it never presses by itself.
- **Plans from your own gear.** **Auto** reads your equipped weapons and their bonuses: temporary first, Assassinate on turn 1, Blindside while they are on full life, a debuff weapon (Weaken, Wither, Slow, Cripple, Eviscerate) for two hits, then your main weapon. Execute takes over once they drop below your weapon's own threshold. Rules for bonuses you don't carry never appear.
- **1 Wpn** uses one weapon with optional temp-first, Assassinate-first and Execute. **Three sequences** let you set your own order (weapon, count, by hits or by uses).
- **Modes** choose the finishing weapon and finish option: **War** (Warlord), **Mug** (Plunder, Mug), **Merc** (Stricken, Hosp), **Farm** (Revitalize or Proficience, Leave). The finisher comes in once they are below the life % you set (15% by default). War and Farm show only if you carry the weapon; a dashed Mug or Merc button means the bonus weapon isn't equipped and only the finish option changes.
- **Perks and weapon stats (optional, needs a key).** With a Minimal key saved in TUCC, Combat Desk reads your perks and your equipped weapons' damage and accuracy from the Torn API when the attack page opens (two calls, cached). **Main: Best** then ranks your weapons by listed damage, Powerful or Specialist, your damage and accuracy perks for that weapon type, and hit chance. A fire damage perk raises a Burn weapon. Passive stat perks are read but don't change the choice, since they help every weapon equally. Without a key it uses your Primary.
- Each weapon's perk boost is shown beside its bonuses, and the settings window lists the perks that were used. Perks it can't read are ignored.
- Your weapons' bonuses and values are listed on the button's panel. The button can be dragged, locked, collapsed and set to the left or right.
- While Combat Desk is on, **Attack Hybrid Ultimate steps aside** (shown as Paused), so the two never act on the same controls.
- Makes no requests to torn.com. **Not yet tested on a live fight**: try it on a low-stakes target first.

## 0.14.7-tablet · 25 November

- **OC Command Centre: crime details in the participation report.** A new **Load details** button on the Participation tab reads each completed crime's history from Torn's new API selection (`faction/{crimeId}/ochistory`) and adds three columns per member: **Left** (crimes they left), **Kicked** (crimes they were kicked from) and **Paid** (money received; item payouts are counted, not valued).
- It runs only when you press the button, makes one API call per crime (about one every 2 seconds) and can be cancelled. Each crime's history is saved once and never fetched again.
- A note under the table says how many crimes the figures cover. Torn has no history for older crimes, and those are shown as "no detail", not as zero.
- The participation CSV gains the same figures, plus jailed, hospitalised and injured counts.
- Needs the same key as the existing reports (Limited with faction API access). Torn marks this selection "Unstable"; if its format changes, the extra columns simply stay hidden.

## 0.14.6-tablet · 24 November

- **OC Command Centre:** added Torn's new level 4 scenario, **Earn Your Stripes**. It now appears in CPR settings under level 4. Its roles are read from your faction's open crimes, the same as other scenarios without a built-in role list.

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
