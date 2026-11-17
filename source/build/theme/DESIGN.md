# TUCC one theme: dark with red accents

Goal: every module in TUCC looks like one product, dark with red accents, and every piece of text is easy to read.

## How the theme layer works (read before editing)

- The module scripts in `../../src/` are NOT edited for the theme. The theme is CSS only, in this folder.
- `page-<name>.css` is injected into the page while the theme is on. Every selector MUST start with
  `:root[data-tucc-theme="on"]` so turning the theme off restores each script's original look.
- `shadow-<host element id>.css` is put inside that host's shadow root (appended last, so it wins
  ties). Write selectors as you would inside the shadow root; `:host` works. The file name decides
  the host: e.g. `shadow-medal-detector-root.css` for `<div id="medal-detector-root">`.
- `layout-*.css` is always applied (theme on or off). Don't add colour there.
- The tokens below are defined on `:root[data-tucc-theme="on"]` (and on TUCC's own UI). Inside a
  shadow root, custom properties inherit from the host, so `var(--tucc-…)` works there too.
- Use `!important` where the script's own CSS is inline or more specific. Prefer overriding the
  script's own CSS variables (e.g. `--bg`, `--text`) when it has them: fewer rules, fewer misses.

## Colour themes

The accent (`--tucc-accent`, `-soft`, `-fill`, `-fill-hover`) comes from the palette picked in the Themes app: Red (default), Blue, Purple, Teal, Graphite (`PALETTES` in core.js). Never hard-code an accent colour: use the tokens, or `color-mix(in srgb,var(--tucc-accent) N%,transparent)` for a see-through accent. Status colours never change with the theme. Every palette passes the readability audit.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--tucc-bg` | #111113 | window/panel background |
| `--tucc-s1` | #18181b | headers, inputs, toolbars |
| `--tucc-s2` | #202024 | cards, rows, secondary buttons |
| `--tucc-s3` | #2a2a30 | hover, raised, bar tracks |
| `--tucc-line` / `--tucc-line2` | #3a3a42 / #52525b | borders / strong borders |
| `--tucc-text` | #f4f4f5 | main text |
| `--tucc-muted` | #c9c9d1 | labels, secondary text |
| `--tucc-dim` | #a1a1aa | meta text (timestamps, hints). Never use anything darker for text. |
| `--tucc-accent` | #f87171 | red for text, links, icons, active tab, focus ring, borders |
| `--tucc-accent-soft` | rgba(248,113,113,.14) | selected/highlight background |
| `--tucc-accent-fill` / `--tucc-accent-fill-hover` | #c81e1e / #b91c1c | primary button background, with `--tucc-accent-ink` (#fff) text |
| `--tucc-good` `--tucc-warn` `--tucc-bad` `--tucc-info` (+ `-soft`) | #4ade80 #fbbf24 #fda4af #93c5fd | status text; `-soft` versions for status backgrounds |
| `--tucc-font` | system-ui stack | all text |
| `--tucc-mono` | monospace stack | keys, code |
| `--tucc-fs` / `--tucc-fs-sm` | 13.5px / 12px | body / smallest allowed |
| `--tucc-r` / `--tucc-r2` | 12px / 8px | windows / controls |
| `--tucc-shadow` | | floating windows |

All text tokens pass 4.5:1 on all four surfaces (`dim` on `s3` is the lowest at 5.6:1).

## Rules

1. Surfaces: window `bg`, header/toolbar `s1`, cards/rows `s2`, hover `s3`; 1px `line` borders;
   radius `r` for windows, `r2` for controls. Inputs/selects: `s1` background, `line` border, `text` colour,
   focus border `accent`.
2. Buttons: primary = `accent-fill` background + white text (hover `accent-fill-hover`);
   secondary = `s2` background, `line` border, `text` colour, hover border `accent`.
   Links, active tabs, focus outlines, selected states: `accent` / `accent-soft`.
   Checkbox/radio/range: `accent-color: var(--tucc-accent-fill)`.
3. Text: `text`, then `muted`, then `dim`. No text darker than `dim`. No coloured text on a
   coloured background unless you checked the ratio.
4. Status colours keep their meaning (green = good/ready, yellow = warning, rose = bad/danger,
   blue = info/travelling). Map a script's own status colours to the tokens. If a script uses red to
   mean "danger", use `--tucc-bad` (rose) so it is not confused with the red accent.
5. Type: `font-family: var(--tucc-font)`; body 13.5px; **minimum 12px for every piece of text**
   (pills, labels, footers, table headers, kbd, small). Numbers: `font-variant-numeric: tabular-nums`.
   Headings 600–700 weight. Don't make line-height tighter than 1.3.
6. Colours and type only: don't change positions, sizes of windows, layout, or hide anything
   (except what TUCC already hides). Torn's own page content is not ours to restyle.
7. Brand bits that carry meaning stay recognisable (e.g. Lockpick's
   odds meter bands), but in token colours.

## Checking

- `test/uiaudit.js` hooks `page.screenshot()` and records every visible text element inside module
  UIs whose contrast is under 4.5:1 (3:1 for large text) or whose size is under 12px:
  `test/ui_audit/<test>.json`; run a test with `UIAUDIT=1` to print a summary line per screenshot.
- Target: 0 failures for your modules with the theme on, and the screenshots look like one family.
