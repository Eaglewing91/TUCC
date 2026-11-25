#!/usr/bin/env python3
"""Build TUCC: header + core + each original script wrapped, unchanged, as a module."""
import re, sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'src')
VERSION = sys.argv[1] if len(sys.argv) > 1 else '0.1.0'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, f'TUCC-{VERSION}.user.js')

MODULES = [
  dict(id='spectrum', where='every page',  launch=dict(menu='Open Torn Spectrum', hide='.tcl-fab', icon='Aa', hint='Colour layers and reading aids'), file='Torn-Spectrum.user.js', name='Torn Spectrum', short='Spectrum', runAt='start',
       desc='Accessibility colour layers and reading aids for Torn (visual only, no requests).', keyLevel='None'),
  dict(id='travel', where='every page',  launch=dict(menu='Travel 2.Dough: open', hide='#ttp-fab', icon='✈', hint='Trip planner'), file='Travel_2.Dough-1.9.6.user.js', name='Travel 2.Dough', short='Travel', runAt='end',
       desc='Travel 2.0 trip planner (with hunting for South Africa trips): best trips, exports and imports, live prices, bazaars, Travel Agency and market badges.',
       keyStore='ttp_api_key', keyLevel='Public (Minimal adds travel status, energy, cooldowns, perks, your Business Class Ticket count and hunting skill; Limited adds exact restock times from your Stock Analysis reports)',
       tos={'external': 'Travel 2.Dough: foreign stock from <a href="https://prombot.co.uk/" target="_blank" rel="noopener">Prometheus</a>, <a href="https://torn-intel.com/" target="_blank" rel="noopener">TornIntel</a> and <a href="https://yata.yt/" target="_blank" rel="noopener">YATA</a>; bazaar prices from <a href="https://weav3r.dev/" target="_blank" rel="noopener">TornW3B</a>'}),
  dict(id='hybrid', where='attack pages',  inline=True, file='Attack-Hybrid-Ultimate-3.7.3.user.js', name='Attack Hybrid Ultimate', short='Hybrid', runAt='end', yieldTo='combatdesk',
       desc='Attack page: drag Torn\'s attack buttons and weapon bar anywhere; keys 1-4; one press = one action; shows only your chosen Leave / Mug / Hosp. Based on scripts by olesien [2187764].', keyLevel='None'),
  dict(id='recruit', where='the User List', home='/page.php?sid=UserList',  launch=dict(menu='Settings / API key', hide='#rm-fab', icon='✉', hint='Working stats settings'), file='Recruiting-Mastered-0.1.9.user.js', name='Recruiting Mastered (Experimental)', short='Recruiting', runAt='idle',
       desc='User List and company pages: Working Stats badge, local Contacted tick and one-click mail icon per player.',
       keyStore='rm_api_key', keyLevel='Public'),
  dict(id='oc', where='every page',  launch=dict(host='eaglewing-oc-command-centre', hide='#launcher', menu='OC Command Centre / CPR settings', icon='◎', hint='Organised crimes'), file='OC-Command-Centre.user.js', name='OC Command Centre', short='OC', runAt='idle',
       desc='Faction organised crimes: live overview, CPR helpers on the crimes page, item costs and reports.',
       keyStore='eaglewing_oc_command_centre_v1_key', keyLevel='Minimal (faction API access for the live overview)',
       tos={'external': 'OC Command Centre: role weights and success chances from <a href="https://tornprobability.com/" target="_blank" rel="noopener">tornprobability.com</a> (scenario and CPR numbers only)'}),
  dict(id='pulse', where='every page',  launch=dict(host='torn-pulse-host', hide='.launch', menu='Open Torn Pulse', embed=dict(panel='.drawer', root='.tp', openClass='open', close='[data-act=close]'), icon='♥', hint='Advisor and alerts'), file='Torn-Pulse-2.11.0.user.js', name='Torn Pulse', short='Pulse', runAt='idle',
       desc='Advisor and alerts: cooldown, booster and medical alerts, unused refills before the Torn day ends, growth advice, and gym training with Baldr\'s, Hank\'s or a custom stat ratio (Steadfast and other perks included, specialist gyms guarded, only gyms you have unlocked).',
       keyStore='tp_apiKey', keyReset=['tp_status'], seed=dict(tp_intro=True), keyLevel='Limited'),
  dict(id='rwguard', where='the gym', home='/gym.php',  inline=True, file='RW-Energy-Guard-0.4.0.user.js', name='RW Energy Guard', short='RW Guard', runAt='idle',
       desc='Gym: asks you to confirm before training while your faction has a ranked war pending, to protect stacked energy.',
       keyStore='rw_energy_guard_api_key_v1', keyLevel='Public'),
  dict(id='openmarket', where='the Item Market, auctions and bazaars', home='/page.php?sid=ItemMarket',  inline=True, file='OpenMarket-Enhanced-1.1.0.user.js', name='OpenMarket (Enhanced)', short='OpenMarket', runAt='start', pageContext=True,
       desc='Item market, auction house and bazaars: quality % and bonus values on weapons and armour, plus a Min Q filter. Original by Snickelfritz (GNU GPLv3), enhanced by Eaglewing.', keyLevel='None'),
  dict(id='medals', where='every page',  launch=dict(host='medal-detector-root', hide='.fab', menu='Open Medal Detector', icon='★', hint='Honours, medals and goals'), file='Medal-Detector-2.2.0.user.js', name='Medal Detector', short='Medals', runAt='idle',
       desc='Every honour and medal, your next award for each stat, and daily goals towards them (Torn API only).', keyStore='mh_key', keyLevel='Limited'),
  dict(id='lockpick', where='the jail', home='/jailview.php',  inline=True, pagePost=dict(path='/jailview.php', action='jail'), file='Lockpick-1.4.9.user.js', name='Lockpick: Jail Bust HUD', short='Lockpick', runAt='end',
       desc='Jail page: odds on every prisoner, a heat gauge for your bust penalty, a bail cap, and one-press Best Bust / Best Bail (one press = one click on that row\'s own link). Refresh reloads the page; an optional Fast refresh switch (off by default, awaiting a staff ruling) updates the list in place instead. Heat curve adapted from BUSTR by Adobi, Ironhydedragon and The_Baron (MIT).',
       keyStore='lockpick_key', separateKey=True, needSel={'user': ['basic', 'log', 'perks']}, keyLevel='Custom: user basic, log, perks (or Full Access)'),
  dict(id='cashdesk', where='your property vault, company funds and trades', home='/properties.php',  inline=True, file='Cash-Desk-1.1.0.user.js', name='Cash Desk', short='Cash Desk', runAt='end',
       desc='Vault and company funds: one-click 25m / 50m / 100m / 250m / 500m deposit and withdraw, plus Deposit All (only what fits in the vault). Trades: Offer All Cash. One click = one press of Torn\'s own button; it never confirms for you. Reads the page only; no requests.', keyLevel='None'),
  dict(id='itempins', where='your Items page', home='/item.php',  inline=True, file='Torn-Item-Pins-1.0.0.user.js', name='Item Pins', short='Item Pins', runAt='idle',
       desc='Items page: a pin on every item; pinned items stay at the top of their tab (weapons and armour by their own ID, other items by type). Only rearranges the page you are viewing; no requests.', keyLevel='None'),
  dict(id='rankednotes', where='the armoury, Items, auctions, Item Market, bazaars, display cases and trades', home='/item.php',  inline=True, file='Ranked-Notes-2.2.1.user.js', name='Ranked Notes', short='Ranked Notes', runAt='idle',
       desc='A + button on ranked war weapons and armour: attach a note to that exact item, shown wherever it appears. Reads the page only; no requests.', keyLevel='None'),
  dict(id='pricecheck', where='ranked war items: auction house, Item Market, Items, bazaars, display cases, faction armoury, trades and profiles', home='/amarket.php',  inline=True, file='TORN-Auction-Price-Checker-5.3.0.user.js', name='TORN Auction Price Checker', short='Price Check', runAt='end',
       desc='Ranked war weapons and armour: a Price Check button on each expanded item shows past auction prices for similar items, plus current Item Market and bazaar listings. By WinterValor [3945658], included with his permission. Searches only when you click.', keyLevel='None',
       tos={'external': 'TORN Auction Price Checker: past auction prices from WinterValor\'s search service (torn-auction-search.cfeternal.workers.dev) and current listings from <a href="https://weav3r.dev/" target="_blank" rel="noopener">TornW3B</a>; only the item name, bonuses and quality you search for are sent, only when you press Search or Price Check'}),
  # ---- TUCC's own modules (built for TUCC; use the shared feed, alerts and windows) ----
  dict(id='warroom', where='every page',  launch=dict(menu='Open War Room', icon='⚔', hint='Ranked war overview'), file='TUCC-War-Room.user.js', name='War Room', short='War Room', runAt='idle', native=True,
       desc='Ranked war overview: enemy members by status with hospital timers, who is out next, both chains, and a chain-timeout alert. Names link to attack pages; you click.',
       keyStore='api_key', keyLevel='Public'),
  dict(id='crimes', where='the Crimes page', home='/page.php?sid=crimes', autoOpen=True,  launch=dict(menu='Open Crimes Analyst', icon='◆', hint='Money per nerve'), file='TUCC-Crimes-Analyst.user.js', name='Crimes Analyst', short='Crimes', runAt='idle', native=True,
       desc='Crimes page: success rate, skill, money per nerve and critical fails for every crime type, from your own crime stats.',
       keyStore='api_key', keyLevel='Minimal'),
  dict(id='company', where='your company page', home='/companies.php', autoOpen=True,  launch=dict(menu='Open Company Manager', icon='▣', hint='Staff and company figures'), file='TUCC-Company-Manager.user.js', name='Company Manager', short='Company', runAt='idle', native=True,
       desc='Company page: employee effectiveness, inactivity and addiction flags, working stats, wages, and company funds, popularity and trains.',
       keyStore='api_key', keyLevel='Limited (director for full detail)'),
  dict(id='market', where='every page',  launch=dict(menu='Open Market Watcher', icon='◷', hint='Price watches'), file='TUCC-Market-Watcher.user.js', name='Market Watcher', short='Market', runAt='idle', native=True,
       desc='Watch items and stocks against your target prices and get an alert when they hit. Read-only: buying and selling stay manual.',
       keyStore='api_key', keyLevel='Public'),
  dict(id='bigals', where='every page',  launch=dict(menu="Open Big Al's Watch", icon='✦', hint='Special Ammo alert'), file='TUCC-Big-Als-Watch.user.js', name="Big Al's Watch", short="Big Al's", runAt='idle', native=True,
       desc="Alerts you when the cameras and guards at Big Al's Gun Shop are all down, the window for shoplifting Special Ammo. TUCC version of swervelord's Big Al's Special Ammo Alert.",
       keyStore='api_key', keyLevel='Public'),
  dict(id='defib', where='the hospital', home='/hospitalview.php',  launch=dict(menu='Open Defib', icon='✚', hint='Revive chances and clients'), file='TUCC-Defib.user.js', name='Defib: Hospital Revive HUD', short='Defib', runAt='idle', native=True,
       desc='Hospital page, in the style of Lockpick: your revive chance on every patient, energy and revives left, one-press Best Revive / Best Client (one press = one click on that row\'s own Revive link; you confirm), a chance floor, client alerts, billing from Torn\'s revive records, and a formula that tunes itself to the chances Torn recorded.',
       keyStore='api_key', keyLevel='Limited (faction API access for faction mates\' exact chances, the fit and faction alerts)'),
  dict(id='combatdesk', where='attack pages', inline=True, defaultOn=False, file='TUCC-Combat-Desk.user.js', name='Combat Desk', short='Combat Desk', runAt='end', native=True,
       desc='Attack page: one button that starts the fight, uses the right weapon for the turn and presses your finish option. One press = one action. Plans are built from your own equipped weapons, their bonuses and mods, the effects on both fighters, the action log and the opponent\'s armour; needles go first; War Farm, War Push, Mug, Merc and Farm modes pick the finishing weapon and finish option; needles active on you are shown with their time left. With a key it also reads your perks and weapon types and names armour pieces (Torn API). Off by default; while it is on, Attack Hybrid Ultimate steps aside. Makes no requests to torn.com.',
       keyStore='api_key', keyLevel='Optional: Minimal (perks and equipped weapon stats)'),
]

def split_header(text):
    m = re.search(r'// ==UserScript==(.*?)// ==/UserScript==\n?', text, re.S)
    if not m: raise SystemExit('no header')
    head, body = m.group(1), text[m.end():]
    meta = {}
    for line in head.splitlines():
        mm = re.match(r'\s*//\s*@(\S+)\s+(.*\S)?', line)
        if mm: meta.setdefault(mm.group(1), []).append((mm.group(2) or '').strip())
    return meta, body

grants, connects = set(), {'raw.githubusercontent.com'}   # core: update checker
wrapped = []
for m in MODULES:
    path = os.path.join(SRC, m['file'])
    if not os.path.exists(path):
        print('skip (missing):', m['file']); continue
    text = open(path, encoding='utf-8').read()
    # Torn PDA swaps this placeholder for the key saved in the app. Inside TUCC only the core may see it (and it only
    # uses it when you press "Use Torn PDA key"), so a module's own copy is written in two halves and stays a placeholder.
    text = text.replace("'###PDA-APIKEY###'", "('###PDA-' + 'APIKEY###')").replace('"###PDA-APIKEY###"', "('###PDA-' + 'APIKEY###')")
    meta, body = split_header(text)
    m['version'] = meta.get('version', ['0'])[0]
    m['matches'] = meta.get('match', []) + meta.get('include', [])
    connects.update(meta.get('connect', []))
    reg = {k: v for k, v in m.items() if k != 'file'}
    wrapped.append(
        f"\n/* ===================== MODULE: {m['name']} v{m['version']} (original script; TUCC changes listed in the build notes) ===================== */\n"
        f"TUCC.register({json.dumps(reg, ensure_ascii=False)}, function (GM_getValue, GM_setValue, GM_deleteValue, GM_listValues, GM_xmlhttpRequest, GM_addStyle, GM_registerMenuCommand, GM_notification, GM, GM_info, unsafeWindow, window, XMLHttpRequest, fetch, tucc, alert, confirm, prompt) {{\n"
        f"{body}\n}});\n")

header = f"""// ==UserScript==
// @name         Torn Ultimate Command Centre [TUCC]
// @namespace    eaglewing.torn.tucc
// @version      {VERSION}
// @description  One install for Eaglewing's Torn tools: Travel 2.Dough, Torn Pulse, Attack Hybrid Ultimate, Combat Desk, RW Energy Guard, OC Command Centre, Recruiting Mastered, OpenMarket (Enhanced), Torn Spectrum, Medal Detector, Lockpick, Cash Desk, Item Pins, Ranked Notes, plus War Room, Crimes Analyst, Company Manager, Market Watcher, Big Al's Watch and Defib. One API engine (shared budget, shared responses, pause on API errors, key in a header), one alerts centre and one TUCC page, opened from its own row in Torn's Areas list. Each module can be switched off.
// @author       Eaglewing [571041]
// @match        https://www.torn.com/*
// @run-at       document-start
// @noframes
// @homepageURL  https://github.com/Eaglewing91/TUCC
// @supportURL   https://github.com/Eaglewing91/TUCC/issues
// @updateURL    https://raw.githubusercontent.com/Eaglewing91/TUCC/main/TUCC.user.js
// @downloadURL  https://raw.githubusercontent.com/Eaglewing91/TUCC/main/TUCC.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        unsafeWindow
""" + ''.join(f"// @connect      {c}\n" for c in sorted(connects)) + """// @license      GPL-3.0-or-later
// ==/UserScript==

/*
 * Licence and credits (full list in the TUCC page, Credits tab, and in CREDITS.md)
 * -------------------
 * TUCC as a whole is released under the GNU General Public License v3.0 or later
 * (https://www.gnu.org/licenses/gpl-3.0.html), because it includes OpenMarket, which is GPLv3.
 * Every module and the TUCC core are by Eaglewing [571041], except as credited here:
 *   - OpenMarket (Enhanced): original OpenMarket by Snickelfritz (GNU GPLv3,
 *     https://greasyfork.org/en/scripts/571158-openmarket); enhancements by Eaglewing.
 *   - Attack Hybrid Ultimate: based on original scripts by olesien [2187764].
 *   - OC Command Centre: builds on earlier OC work by Flamer, Allenone, Verboten, Darrelia, Kohnago, pawl,
 *     Qfiffle, JohnNash, callmericky [3299880] and whatdoesthespacebardo; Torn Probability by Allenone.
 *   - Torn Pulse: inspired by Torn Growth Advisor by curtthecoder (MIT); Vladar's training formula; Baldr's and Hank's
 *     ratios (Baldr's guide); ideas from GymIQ (CLASIX), TornTools' Specialist Gyms (DeKleineKobini and the TornTools team)
 *     and StatForge (AeC3), no code copied.
 *   - Lockpick: heat (bust penalty) curve constants adapted from BUSTR by Adobi, Ironhydedragon and The_Baron (MIT).
 *   - Ranked Notes: page-structure approach credited to TORN Auction Price Checker by WinterValor [3945658] (no code copied).
 *   - Travel 2.Dough data: YATA by Kivou [2000607], Prometheus, TornIntel, TornW3B by Weav3r [1853324], the Torn wiki.
 * Eaglewing's own parts were originally MIT-licensed and may also be used on their own under the MIT licence
 * (https://opensource.org/license/mit).
 */

/*
 * Terms of Service (also shown in the TUCC panel, API key & ToS tab)
 * ------------------------------------------------------------------
 * Data Storage:          Only locally, in your userscript manager, plus this browser's storage for a few modules
 *                        (Attack Hybrid Ultimate's layout, Combat Desk's settings and sequences, Cash Desk's presets, Torn Spectrum's settings, OpenMarket's
 *                        filter, Ranked Notes' notes, Item Pins' pins, TORN Auction Price Checker's settings and recent
 *                        searches, OC Command Centre's join-audit history). Each module keeps its own cache and settings.
 *                        OpenMarket keeps item market listings in memory only, never saved.
 * Data Sharing:          Nobody. Your key and your Torn data are sent only to api.torn.com. Travel 2.Dough sends item IDs
 *                        to TornW3B; OC Command Centre sends OC names and pass rates to tornprobability.com only if you
 *                        turn on success chances; TORN Auction Price Checker sends the item name, bonuses and quality you
 *                        search for to its search service and TornW3B, only when you click.
 * Purpose of Use:        Competitive advantage (travel and hunting, attacks, wars, training, crimes, busting and bailing,
 *                        reviving, item and stock prices);
 *                        public community tools (faction OCs, company management and
 *                        recruiting); other: accessibility (Torn Spectrum), personal award goals (Medal Detector), notes on
 *                        ranked war items (Ranked Notes), your own Items page (Item Pins) and your own money (Cash Desk).
 * Key Storage & Sharing: Stored / Used only for automation (sent only to api.torn.com; header on v2, address on v1, which
 *                        Lockpick, Torn Pulse, Medal Detector, Company Manager and Market Watcher use).
 *                        Torn PDA: saved data and the key sit in the Torn page's storage inside the app (PDA has no
 *                        separate script storage). PDA's own key is used only if you press "Use Torn PDA key".
 * Key Access Level:      Per module. Limited covers every shared module; OC Command Centre's live overview and Defib's
 *                        faction parts also need faction API access; Company Manager shows full detail to directors; Lockpick has its own slot
 *                        for a Custom key with user basic, log, perks (bust log), or Full Access.
 *                        Modules without a key never call the API.
 * Outside data (read-only, nothing about you sent): Prometheus, TornIntel, YATA, TornW3B (Travel 2.Dough);
 * tornprobability.com (OC Command Centre, scenario and CPR numbers only); WinterValor's auction search service and TornW3B
 * (TORN Auction Price Checker, only when you click). Update checker: reads the published TUCC file's
 * version from raw.githubusercontent.com (can be switched off in Settings).
 *
 * Rules: no module clicks, submits or loads anything on torn.com by itself (Lockpick's Refresh reloads the jail page; its optional
 *        Fast refresh switch, off by default and awaiting a staff ruling, sends one jail-list request per real click instead). Page reading is limited to the page you are viewing (for example Torn's revive
 *        confirm box for Defib, and the hunting result and Travel Agency for Travel 2.Dough). Every Torn API call goes through
 * one shared engine with a per-minute budget and pauses after "too many requests" or key/IP errors.
 */
"""
core = open(os.path.join(HERE, 'core.js'), encoding='utf-8').read()
# One theme: build/theme/page-*.css (light DOM, every selector starts with :root[data-tucc-theme="on"])
# and build/theme/shadow-<host id>.css (put inside that script's shadow root while the theme is on).
import glob
TH = os.path.join(HERE, 'theme')
theme = {'page': '', 'shadow': {}, 'layout': ''}
for f in sorted(glob.glob(os.path.join(TH, 'layout-*.css'))):   # always applied (positions), theme on or off
    theme['layout'] += open(f, encoding='utf-8').read()
for f in sorted(glob.glob(os.path.join(TH, 'page-*.css'))):
    theme['page'] += '\n/* ' + os.path.basename(f) + ' */\n' + open(f, encoding='utf-8').read()
for f in sorted(glob.glob(os.path.join(TH, 'shadow-*.css'))):
    theme['shadow'][os.path.basename(f)[7:-4]] = open(f, encoding='utf-8').read()
import credits as CR
core = re.sub(r'/\*__CREDITS__\*/.*?/\*__END_CREDITS__\*/', lambda m: CR.js(), core, count=1, flags=re.S)
open(os.path.join(HERE, 'CREDITS.md'), 'w', encoding='utf-8').write(CR.markdown())
core = re.sub(r'/\*__VERSION__\*/.*?/\*__END_VERSION__\*/', lambda m: json.dumps(VERSION), core, count=1, flags=re.S)
core = re.sub(r'/\*__THEME__\*/.*?/\*__END_THEME__\*/', lambda m: json.dumps(theme, ensure_ascii=False), core, count=1, flags=re.S)
out = header + '\n' + core + ''.join(wrapped)
# Torn PDA rewrites every curly quote in a script's source to a straight one before running it, which would end a
# quoted string early and stop the whole script from loading. So the built file carries them as \u escapes instead
# (the same characters once the script runs).
for ch in '\u201c\u201d\u2018\u2019':
    out = out.replace(ch, '\\u%04x' % ord(ch))
assert not any(c in out for c in '\u201c\u201d\u2018\u2019')
open(OUT, 'w', encoding='utf-8').write(out)
print(OUT, len(out.splitlines()), 'lines', sorted(connects))
