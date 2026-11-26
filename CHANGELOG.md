# Changelog

All dates are 2026. Versions before 0.14.4 were private test builds.

## 0.16.4-tablet · 26 November

**War Room 1.2.1**
- Refresh buttons now read 1s / 5s / 30s, fastest first.

**Medal Detector 2.2.1**
- The sidebar row now stays in the sidebar when you have no merits to spend. Torn hides its Merits row then, so the row sits under Points instead, and moves back under Merits when that row returns.

## 0.16.3-tablet · 25 November

**War Room 1.2.0: refresh speed**
- **Three speeds:** 30 seconds (default), 5 seconds or 1 second, chosen with buttons above the list and remembered.
- **Light where it can be.** At the faster speeds only the enemy member list is asked for each time; the war score and both chains keep their slower schedule. A refresh is skipped while the last one is still waiting, so calls never pile up.
- **Steady list.** The list is only redrawn when something has changed, so it doesn't flicker or lose your place.
- **API use:** 5 seconds is 12 calls a minute and 1 second is 60, against Torn's limit of 100 a minute. If TUCC's shared API budget fills up, War Room says "Slowed: API budget full". The budget can be raised in TUCC's API settings.
- Refreshing still stops when the window is closed or the tab is hidden.

**Combat Desk**
- **Two war modes.** **War Farm** finishes with Leave and **War Push** finishes with Hosp. Both bring in a Warlord weapon for the last hit if you carry one. They replace the single War mode and its "War finish" setting.
- **Needle detection.** Combat Desk reads injections from the action log and shows each needle active on you (Epi, Mel, Ser, Tyr) with its time left out of 120 seconds. The timing uses Torn's own clock on the log line, and it carries across attack pages, so it still shows in your next fight.
- **No wasted needle.** If the needle in your temporary slot is already active on you, the plan skips it and goes straight to your weapon.
- **Opponent's needles** are flagged on the strip with their time left.
- **Losing a fight** clears your needles, as Torn does.
- **Phones:** the mode buttons now sit on their own full-width row.

## 0.16.2-tablet · 25 November

**War Room 1.1.0: BSP stats column**
- **For players who run Battle Stats Predictor (BSP) by TDup.** A new "BSP stats" switch adds a Stats column to the enemy list, showing each player's predicted total battle stats.
- **Same figures as BSP.** It reads the predictions and spies BSP has already saved in your browser: a recent spy first (marked S), otherwise the prediction while BSP still treats it as current (5 days). Hover a figure for its age.
- **Colour and sort.** Figures are tinted against your own total as saved by BSP (green weaker, amber similar, red stronger). Press the Stats heading to sort weakest or strongest first.
- **Read only.** War Room makes no request to BSP's server, does not read or send your BSP key, and keeps no copy of the figures. A player BSP hasn't looked up shows a dash; opening the enemy faction's page once with BSP on fills them in.
- **Without BSP** nothing changes: no switch and no column.

**Medal Detector 2.2.0: Torn's own award progress**
- **More awards show progress.** Torn's API now reports progress for honours and medals directly. Awards that Medal Detector could not follow from your stats, and listed as "In-game only", now show a progress bar with Torn's current and target figures wherever Torn tracks one.
- **Targets come from Torn.** For awards followed from a stat, Torn's target replaces the one read from the award's description when the two count the same thing, so a changed requirement is picked up without an update.
- **Earned status** also uses Torn's own flag for each award.
- **How it is fetched:** one API call per award category (7 for medals, 18 for honours), spaced out, at most every 6 hours or when you press "Check again". The key is sent in the request header. Your stats check still runs every minute as before.
- **Key:** the same Limited key as before. If a key is too low for award progress, it stops after one call and says so at the foot of the list.

## 0.16.1-tablet · 25 November

**Combat Desk**
- **Best picks a gun.** The main weapon is your Primary, or your Secondary when it scores at least 15% higher. Melee becomes the main weapon only when no gun is ready. A melee weapon with a debuff (Slow, Weaken, Wither, Cripple, Eviscerate) or a mode's finishing bonus still gets its own turns in the plan.
- **Rage counts for less.** It was valued as four extra hits when it triggers; it is now two, since Torn doesn't publish how often it gives more.
- **Action log read with Torn's real wording.** A hit is a line ending "for" and a number; "recovered ... life" is no longer mistaken for a hit. An effect line is counted for whoever it names, so "you are eviscerated" is not treated as an effect on the opponent.

## 0.16.0-tablet · 25 November

**Combat Desk**
- **Needles:** Epinephrine, Melatonin, Serotonin and Tyrosine are recognised in your temporary slot and always used first, ahead of an Assassinate opener.
- **Weapon mods:** the mods on each weapon are read and shown beside its bonuses, and listed with their effects in settings. Critical hit rate from mods adds to the ranking.
- **Damage over time is valued:** each Poison, Bleed, Burn or Lacerate weapon's chance, total and length are read from its own text. It is used only when a turn with it is worth more than a turn with your main weapon, with two tries (three for a low chance).
- **Effects on the opponent:** status icons are read, so an effect already on them is not re-applied, and a debuff the page shows is carried on to three stacks.
- **Action log:** each turn's result is read from the log as a hit or a miss, with their health dropping as the fallback. Effects named in the log are counted.
- **Opponent armour:** armour shown in the opponent's panel is recognised by set (EOD, Riot, Assault, Dune, Delta, Marauder, Sentinel, Vanguard). The ranking allows for it: Puncture and Penetrate against heavy armour, guns against Riot, melee against Assault. A temporary their helmet blocks is left out, and Delta drops the debuff step. With a key, pieces shown only as pictures are named by one Torn API read each.
- **Opponent memory:** the weapons and armour last seen on an opponent are saved on your device (newest 150) and used the next time you attack them, marked "saved".
- **Reload and ammo:** clip, clip size and spare clips are read. An empty clip shows "Reload"; a new **Reload** switch lets the plan move to another weapon. A Specialist weapon is never reloaded.
- **Start fight:** Torn's own Start fight box is hidden while Combat Desk is showing; the Combat Desk button starts the fight.
- **New look:** the button is centred under the two fighters, with modes and plan to its left and your weapons, mods, perk boosts and the opponent's armour to its right. Collapsing it leaves only the centred button. On phones the button spans the full width with the two panels beneath it.

## 0.15.1-tablet · 25 November

- **Tablet: switched-off modules are now shown.** A new **Off** row lists them, so a new module that starts switched off (such as Combat Desk) is easy to find. Tapping one says how to switch it on.
- **Combat Desk now sits inside the attack screen**, as a strip directly under the two fighters, so the button is next to the fight. Settings has a **Position** choice if you prefer it floating.
- **Combat Desk reads the live attack page properly.** Both health values now come from Torn's own health line, so Execute, finishing weapons and hit counts work. Weapon damage, accuracy and ammo are read from your weapon slots, so **Best** ranks your weapons with no key at all. A weapon showing "No ammo" is skipped.
- **Ranking counts more bonuses:** Fury, Double Tap, Rage, Deadly, Deadeye and Penetrate now add to a weapon's score by their average effect, alongside Powerful and Specialist.
- **Damage-over-time weapons:** the Smart plan uses a Poison, Bleed, Burn or Lacerate weapon once, until it lands (two tries at most), before your main weapon. It is left out when a mode's finishing weapon is equipped.
- **Fire damage perks** now also count for a Molotov Cocktail and Flamethrower.
- The plan button is now labelled **Smart**.
- **Combat Desk: a held key no longer repeats.** Holding Enter on the button gave several actions from one input; it now gives one.
- **Combat Desk: no API read from a hidden tab.** The perks and weapon stats read waits until the attack tab is the one you are looking at.

## 0.15.0-tablet · 25 November

- **New module: Combat Desk** (attack pages, **off by default**). One floating button runs the fight: the first press starts it, each press after uses the right weapon for that turn, and the last press is your finish option. One press = one action; it never presses by itself.
- **Plans from your own gear.** **Smart** reads your equipped weapons and their bonuses: temporary first, Assassinate on turn 1, Blindside while they are on full life, a debuff weapon (Weaken, Wither, Slow, Cripple, Eviscerate) for two hits, then your main weapon. Execute takes over once they drop below your weapon's own threshold. Rules for bonuses you don't carry never appear.
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
