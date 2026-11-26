"""One credit list for TUCC: shown in TUCC's Credits tab and written to CREDITS.md.
people: (name, Torn ID or None). Links are only Torn profiles or the original project pages."""

ME = ('Eaglewing', 571041)

CREDITS = [
    # ---- your scripts, bundled ----
    dict(module='Torn Spectrum', author=[ME], licence='MIT'),
    dict(module='Travel 2.Dough', author=[ME], licence='MIT', data=[
        'Foreign stock and shop prices: YATA by Kivou [2000607] (yata.yt), Prometheus (prombot.co.uk) and TornIntel (torn-intel.com), and every player who reports stock to them',
        'Bazaar prices: TornW3B by Weav3r [1853324] (weav3r.dev)',
        "Flight times, ticket prices, carry capacity and travel perks: the Torn wiki, written by Torn's players",
        "Hunting: the Torn wiki (Hunting), and player reports collected in TC Basic's hunting guide (tcbasic.com) for the pay estimate"]),
    dict(module='Attack Hybrid Ultimate', author=[ME], licence='Not stated', based=[
        'Original attack refresher and move-attack-buttons scripts by olesien [2187764]; original concept and code credit remains with olesien']),
    dict(module='Recruiting Mastered (Experimental)', author=[ME], licence='MIT'),
    dict(module='OC Command Centre', author=[ME], licence='MIT', based=[
        "Builds on earlier OC work by Flamer, Allenone, Verboten, Darrelia, Kohnago, pawl, Qfiffle, JohnNash, callmericky [3299880] and whatdoesthespacebardo (MIT-licensed work used under its licence, copyright with its authors)",
        'Grew out of OC Item Audit by Eaglewing [571041]'], data=[
        "Role weights and estimated success: Allenone's Torn Probability (tornprobability.com)"]),
    dict(module='Torn Pulse', author=[ME], licence='Not stated', based=[
        'Advice, checklist, progress and stock features inspired by "Torn Growth Advisor" by curtthecoder (MIT); an independent rewrite',
        "Gym gain estimates: the community Vladar training formula v2.0",
        "Stat ratios: Baldr's and Hank's ratios, from Baldr's forum guide \"Hank's Ratio / Baldr's Ratio\"",
        "Ideas only, no code copied: GymIQ by CLASIX (train-next order, balance grade, war weighting); TornTools' Specialist Gyms by DeKleineKobini [2114440] and the TornTools team (safe-to-train margins); StatForge by AeC3 (best gym per stat, as advice only)"]),
    dict(module='RW Energy Guard', author=[ME], licence='MIT'),
    dict(module='OpenMarket (Enhanced)', author=[('Snickelfritz', None), ME], roles='Original OpenMarket 1.0.1.1 by Snickelfritz; enhancements by Eaglewing', licence='GNU GPLv3',
         link='https://greasyfork.org/en/scripts/571158-openmarket'),
    dict(module='Medal Detector', author=[ME], licence='MIT'),
    dict(module='Lockpick: Jail Bust HUD', author=[ME], licence='MIT', based=[
        'Heat (bust penalty) curve constants adapted from BUSTR by Adobi, Ironhydedragon and The_Baron (MIT); the odds model and interface are original to Lockpick']),
    dict(module='Cash Desk', author=[ME], licence='MIT', based=['Formerly "Torn - Vault Presets + Quick Cash" 3.1.0, a merge of Vault Preset Buttons 1.1.1 and Quick Cash Actions 2.10']),
    dict(module='Item Pins', author=[ME], licence='MIT'),
    dict(module='TORN Auction Price Checker', author=[('WinterValor', 3945658)], licence='MIT', based=[
        'Version 5.3.0 by WinterValor [3945658], included unchanged in TUCC with his permission',
        'Data: his auction search service and TornW3B by Weav3r [1853324]'],
         link='https://greasyfork.org/scripts/564049'),
    dict(module='Ranked Notes', author=[ME], licence='MIT', based=[
        'Page-structure approach credited to TORN Auction Price Checker by WinterValor [3945658] (no code copied)']),
    dict(module="Big Al's Watch", author=[('swervelord', None), ME], roles="Original script by swervelord; TUCC version by Eaglewing", licence='Original: none stated', based=[
        'Original: "Torn Big Al\'s Special Ammo Alert" by swervelord',
        'TUCC version rewritten to run on TUCC\'s API engine, alerts and layout (the original states no licence, so its code isn\'t copied)'],
         link='https://greasyfork.org/en/scripts/565775-torn-big-al-s-special-ammo-alert'),
    # ---- built for TUCC ----
    dict(module='War Room', author=[ME], licence='MIT', tucc=True, based=[
        'Optional "BSP stats" column: shows the battle stats predictions and spies that Battle Stats Predictor (BSP) by TDup has saved in your own browser. BSP and its prediction service are TDup\'s work. TUCC includes none of BSP\'s code, makes no requests to BSP\'s server, and shows nothing unless you run BSP yourself'],
         link='https://www.torn.com/forums.php#/p=threads&f=67&t=16290324'),
    dict(module='Crimes Analyst', author=[ME], licence='MIT', tucc=True),
    dict(module='Company Manager', author=[ME], licence='MIT', tucc=True),
    dict(module='Market Watcher', author=[ME], licence='MIT', tucc=True),
    dict(module='Defib: Hospital Revive HUD', author=[ME], licence='MIT', tucc=True, based=[
        'Revive chance numbers from the Torn Wiki (Revive) and the 2021 medical changes (Torn City Newspaper); refined by fitting to the chances Torn records in your faction\'s revive log',
        'Ideas from a review of public revive scripts: Torn Revive Radar by Oxain, TornReviveChance by Resh, Torn City Reviver\'s Tool by Lily, FastRevive by Upsilon and Revive Intel Pro by TheBeastMan (no code copied)']),
]
CORE = dict(module='TUCC core (API engine, alerts, TUCC page, theme)', author=[ME], licence='GNU GPLv3 or later for TUCC as a whole, because it includes OpenMarket (GPLv3); the parts by Eaglewing may also be used on their own under MIT')
ALWAYS = ['All game data: the official Torn API (torn.com/api.html). Torn, its name and its game data belong to Torn (Chedburn). TUCC is fan-made and not affiliated with Torn.',
          'Torn PDA support uses the script functions Torn PDA provides: Torn PDA by Manuito [2225097], and its GMforPDA layer by Kwack [2190604]. Nothing of theirs is bundled.']


def who(p):
    return f'{p[0]} [{p[1]}]' if p[1] else p[0]


def markdown():
    out = ['# Credits', '', 'Torn Ultimate Command Centre [TUCC] by Eaglewing [571041]. Every module, who wrote it, and whose work it builds on.', '',
           f"**{CORE['module']}**: {', '.join(who(p) for p in CORE['author'])}. Licence: {CORE['licence']}.", '']
    for title, rows in (('Bundled scripts', [c for c in CREDITS if not c.get('tucc')]), ('Built for TUCC', [c for c in CREDITS if c.get('tucc')])):
        out += [f'## {title}', '', '| Module | Author | Licence | Builds on / thanks to |', '|---|---|---|---|']
        for c in rows:
            author = c.get('roles') or ', '.join(who(p) for p in c['author'])
            extra = '<br>'.join(c.get('based', []) + c.get('data', []) + ([c['link']] if c.get('link') else [])) or '–'
            out.append(f"| {c['module']} | {author} | {c['licence']} | {extra} |")
        out.append('')
    out += ['## Also', ''] + [f'- {a}' for a in ALWAYS]
    return '\n'.join(out) + '\n'


def js():
    import json
    def row(c):
        return dict(m=c['module'], a=c.get('roles') or ', '.join(who(p) for p in c['author']), l=c['licence'],
                    x=c.get('based', []) + c.get('data', []), u=c.get('link', ''), t=bool(c.get('tucc')))
    return json.dumps(dict(core=row(CORE), list=[row(c) for c in CREDITS], also=ALWAYS), ensure_ascii=False)
