# 22 · Type: one voice to read, one to shout, one to label

> **Status:** Ready to build · **Area:** Styles / Crate / Profile / Share / Launch intro · **Written:** Oct 29, 2026 · **Follows:** `12_REFINE.md` (RF13 token scale), `13_CRATE.md` (CR8 palette) · **Design canvas:** "Miziki Type System" (11 artboards: three before/after screen pairs, the specimen, the wordmark and its alternatives A–J)

**Goal:** Miziki is a player you can use at any hour, but it shines in the dark, with Sundown. The target is for a user to live in the app for one or two records a day, start to finish — on the phone that usually means starting the record and letting it carry on in the background; on the desktop it means an open tab on a second monitor that is glanced at, not read, for forty minutes at a time. So the typography has two jobs: be the calmest thing on the screen while the sleeves, the sky and the platter are the loudest (the hour-long, phone-in-hand case), and hold up at a glance from across a desk (the second-monitor case). Today the UI chrome is set almost entirely in small, tracked-out, uppercase mono — the voice of a tape label applied to every tab, button and count — and the body face the app ships is barely used. This doc flips that: Archivo becomes what you read and tap, Antonio stays what you look at, Plex Mono retreats to the physical objects it was always meant for, and a fourth, hand-lettered voice gets a fenced-off home. It also fixes a 12px floor, two contrast failures, the tracking rule, numerals, the wordmark, and — new in TY7 — the desktop measure and a glance view sized for distance.

## Where this came from (Oct 29)

A read-only audit of `src/styles/*.css`, `src/styles/fonts.css`, `src/share/*.js`, `miziki.html` and the `docs/design/*` canvases, rendered on an iPhone 14 Pro viewport in both themes, measured against seven typography texts: Santa Maria *On Web Typography*, Latin *Better Web Typography*, Hunt *Advanced Typography*, Kunz *Macro- and Microaesthetics*, Ruder *Typographie*, Young *Fonts & Logos*, and the Salem Press *Principles of Graphic Design & Typography*. Contrast ratios were computed from the tokens in `00-base.css` and `22-theme.css`. `npm run build` was not run.

## What the audit found

1. **The mono is the default voice, not the accent.** `var(--data)` appears 148 times across the stylesheets; `var(--body)` 7 times. Tabs, tab bar, buttons, section kickers, record counts, settings rows, empty-state buttons and the A–Z chip are all Plex Mono uppercase. Every author in the stack says the same thing about a characterful face: a few words at a time (Santa Maria), one grey for information lightened by letterspacing or darkened by bold (Ruder), form becoming the message when it dominates (Kunz). The record-store feel was never in the mono — it is in the sleeves, tape and paper — so the mono can retreat without loss.
2. **Two-thirds of the UI is ≤12px.** Of ~330 `font-size` declarations, 101 are `--fs-micro` (10px), 44 `--fs-label` (11px), 75 `--fs-caption` (12px). Hunt: phones are held closer, but users still expect ≥14px for anything read; Santa Maria puts captions at ~12px; Young says anything smaller must also get *wider and bolder*, not just more spaced, which Plex Mono at 10px cannot.
3. **Caps tracking is past the ceiling.** 58 `text-transform: uppercase` rules, tracked `.08–.32em`. Latin and Young agree on 5–10% for caps; `.14em` on the tab bar and `.16em` on kickers is the "picket fence" Young warns about in condensed gothics. Separately, Antonio at `--fs-head` and up is tracked *open* (`.02em`) — every author says larger type gets tighter, not looser.
4. **Two contrast failures.** `--muted-2` (#7A868C) on `--sky1` (#1D2F38) is **3.7:1**, under the 4.5:1 floor, and it is used at 10px — the worst case. `--amber` on the light sky is **1.65:1**; it must never be text in light theme (it isn't today via `--accent-text`, but nothing enforces it).
5. **No OpenType features anywhere.** No `tnum` on durations, clocks or counts (Archivo has it; Plex Mono is inherently tabular, which is partly why the mono crept into every number). No `liga`, no `calt`, no `text-wrap: balance` on two-line titles (the share-card title wraps "…run to / two lines]").
6. **The wordmark is three things.** Antonio Bold tracked `.16em` on launch (`09-launch-intro.css`), Archivo Bold with an orange "zi" on share cards (`share/styles.js` `drawShareWordmark`), and "M I Z I K I" spaced around the platter. Young: draw it once, build it as a vector, use it everywhere, and derive subsidiary lettering (the awning) from its bones.
7. **Light theme is an inversion.** Same weights, same `-webkit-font-smoothing: antialiased` (which Latin notes is *for* light-on-dark and thins dark-on-light). Hunt: dark and light are two settings, not a flip.
8. **Hand lettering has no system.** The crate's taped labels are mono in a tilted box (`10-crate.css` `rotate(-4deg)`); the "hand" the crate aesthetic calls for (CR8, "taped and hand-lettered touches") has no face and no rule for where it may appear. Ruder's hardest rule applies: never mix writing and printing on the same surface.
9. **`fonts.css` declares each variable file three times** (one `@font-face` per weight, identical `src`). One declaration with `font-weight: 400 700` is the same bytes and lets the theme-weight rule in TY5 use intermediate weights.

Already in good shape, leave alone: the three families themselves (Antonio is right for the display voice; Archivo is a Franklin-lineage grotesque, close to what Young would reach for on the awning; Plex Mono is the right tape-label voice), self-hosted Latin subsets, `font-display: swap`, the spacing scale and "heading sits closer to what it heads", the no-hairline-per-row rule, the one-amber rule, the film grain, `mutedGradientStops()` drifting the muted tone with the sky (that is Ruder's kinetics done right — keep it, and keep it to tone only).

## Shared rules for every PR in this doc

- Read CLAUDE.md first. One PR at a time; each waits for Ken's go-ahead. Do not merge.
- **Tokens first, then call sites.** TY1 changes `00-base.css` only and must leave every screen rendering (sizes may shift by the token remap; nothing may disappear or overflow). Call-site PRs reference tokens by name; no literal px without a comment, per the existing RF13 rule.
- **Three voices, one hand.** After this doc, every text rule in `src/styles` is one of: `var(--body)` (Archivo — read or tapped), `var(--display)` (Antonio — looked at), `var(--data)` (Plex Mono — on a physical object or a number that must align), `var(--hand)` (Caveat or successor — on paper, tape or a sticker). A rule that can't say which it is, is wrong.
- **The mono whitelist** (the only surfaces that keep `var(--data)`): format chips (`7″ · 45`, `12″ · 33`), the sample-rate/bit-depth line, catalogue numbers and dead-wax etchings, the paper label's rim text, the crate's taped bin labels *when they are typed* (hand-lettered ones use `--hand`), timestamps and format lines on share cards, the EQ's frequency/dB readouts, the duplicate-scan and import-log readouts. Everything else moves to `--body`.
- **12px is the floor for anything read.** 11px survives only on physical-object detail (label rim, dead wax, the pressing peek's tiny stamp) and only where the same information is legibly repeated nearby (Ruder's rule for distorted type).
- **Tracking follows size, not font:** caps `+.06–.10em` with ~130% word space; lowercase never tracked; Antonio ≥ 28px `0` to `−.01em`, ≥ 44px `−.015em`; reversed (dark-theme) text `+.01em` over its light-theme value. The one hand-tuned exception stays: the launch wordmark lockup (TY4).
- **Hierarchy by tone before size.** In any list: title at `--paper`, secondary at `rgba(paper, .85)`, tertiary at `--muted`; `--muted-2` only at ≥ 14px. Don't add a size step where a tone step will do.
- Lint and tests pass; both builds preview cleanly; NV1's perf numbers show no regression. Every PR screenshots the three canvas screens (now playing, crate, profile) in both themes and attaches them.

### Device checklist additions (iPhone, home-screen app)

1. Crate, 212+ records, dark, at dusk: tab labels, the A–Z chip and the record count are readable at arm's length without squinting; nothing in the chrome is uppercase mono.
2. Now playing, light theme, noon sky: the "Vinyl" pill and any accent text are amber-shade, never amber; nothing is thinner than it was in dark.
3. Gatefold: track durations sit in a straight right-aligned column (tabular figures), including a 10:00+ track.
4. Profile, a 20-character username: the awning drops a weight and tracking rather than condensing or wrapping.
5. Launch intro: the wordmark is the F cut (A at −12°) on the Miziki sleeve, then the A cut floating; both are the same drawing.
6. Dynamic Type at the largest non-accessibility size: no label truncates in the tab bar; the crate header's four tabs stay on one line.
7. (Desktop, TY7) Miziki on a secondary monitor, a record playing, idle for a minute: from the primary monitor's working position the title, artist and the next side flip are readable without leaning; no other text is asking to be read.

## TY1: tokens (`00-base.css`, `22-theme.css`, `fonts.css` only)

The scale collapses from ten steps to six plus one hero step. Ratios follow Kunz's calibrated range (3:4, 1:1.5, 1:2, roughly 1:3 from caption to title).

| Token | Was | Now | Role |
|---|---|---|---|
| `--fs-micro` | 10 / 1.3 | **removed** — alias to `--fs-caption` for one release, with a build-time warning | — |
| `--fs-label` | 11 / 1.3 | **removed** — alias to `--fs-caption` | — |
| `--fs-caption` | 12 / 1.45 | 12 / 1.45 | captions, kickers (caps), the smallest readable text |
| `--fs-body` | 14 / 1.5 | 14 / 1.45 | metadata lines, paragraphs, tab-bar labels, chips, counts |
| `--fs-row` | 16 / 1.35 | 16 / 1.35 | list titles, tabs, buttons, inputs, setting names |
| `--fs-title` | 20 / 1.2 | 20 / 1.2 | sheet titles, section titles (Archivo 600 or Antonio) |
| `--fs-head` | 24 / 1.15 | **removed** — alias to `--fs-hero` | — |
| `--fs-hero` | 28 / 1.1 | 28 / 1.05 | crate album name, headings, stats (Antonio) |
| `--fs-display` | 36 / 1 | **removed** — alias to `--fs-giant` | — |
| `--fs-giant` | 44 / 1 | 44 / 1 | player title, profile name, dial time (Antonio) |
| `--fs-numeral` | — | 64 / 1 | the one hero numeral: dial hour, season-card figure |

New tokens:

- `--hand: 'Caveat', 'Bradley Hand', cursive;` plus `@font-face` for Caveat 500/700, Latin subset, self-hosted like the others (OFL). `--hand` is only ever used by `10-crate.css`, `12-sealed-records.css`, `17-profile.css` (stickers), `18-storefront.css` (the "Crate of" sticker is *not* hand — it's Archivo; the staff-pick sticker is) and the share cards.
- `--track-caps: .08em; --track-display: -.01em; --track-numeral: -.015em;` — the three tracking values. No others in the codebase.
- `--muted-2` dark: `#7A868C` → `#86939A` (4.6:1 on `--sky1`, 5.5:1 on `--sky2`). Light: `#6E7A80` → `#5E6A70` (4.6:1 on `--sky2`). `mutedGradientStops()` in `player/clock.js` keeps its warm/cool drift but clamps to these as its floor.
- `--accent-text` is already `--amber-shade` in light; add a comment and a unit test in `tests/unit/theme.test.js` that asserts the light-theme `--accent-text` contrast ≥ 4.5 on `--sky1`/`--sky2`/`--stock-card`.
- `font-feature-settings: "tnum"` on `body` is wrong (it would affect running text); instead add a utility class `.num` → `font-variant-numeric: tabular-nums` and apply it in TY2/TY3 to every clock, duration, count and stat.
- `-webkit-font-smoothing: antialiased` moves from `body` to the dark-theme and Nychthemeron-at-night blocks only; light theme gets `auto`.
- `fonts.css`: one `@font-face` per family with `font-weight: 400 700` (Antonio, Archivo); Plex Mono stays two files. Add `size-adjust`/`ascent-override` on a `'Archivo Fallback'` local face so system-ui fallback doesn't shift layout when the webfont lands.

CLAUDE.md's "CSS token scale" table is replaced with the one above; the "Letter-spacing follows size" paragraph is replaced with the tracking rule from Shared rules; "Antonio stays to no more than two sizes per screen" stays.

## TY2: the chrome moves to Archivo (`01-header`, `07-routes`, `08-shell`, `10-crate` header, `16-edit-sheet`, `17-profile`, `19-signin`, `21-legal`, `23-desktop` sidebar/mini-bar, `27-eq` labels)

- Tab bar labels: `--body` 12px 600 (active) / 500, sentence case, no tracking. Active indicator hairline `1.5px`, not `2px` (Kunz: a short rule reads heavier).
- Library header tabs (Songs / Crate / Artists / Playlists): `--row` 15–16px 500/600, sentence case, baseline-aligned, `gap: var(--sp-5)`; the orange underline stays. This also fixes the "nothing overlapping on one line" ask from 14_CRATE_SECTIONS at Dynamic Type sizes, because Archivo lowercase is ~30% narrower than tracked mono caps.
- Section kickers ("Now spinning · Side A", "Your crate", "Other masters read"): `--caption` 12px 500 caps `--track-caps` in `--muted`; the separator dot in `--muted-2`.
- Counts and status lines ("[18] records · 45 rpm", "6 records · 2 sealed", "Most spun · Last 30 days"): `--body` 13–14px sentence case, `.num`. Brackets go.
- Buttons and chips (A–Z chip, Choose files, Play all, Edit, the Vinyl/Pure pill): `--row` or `--body` 500, sentence case. The pill keeps its dot and outline.
- Section headings keep Antonio where they are Antonio ("STAFF PICKS", "RECORDS") but drop the `.03em` and take `0`; the count beside them ("6 of 8") becomes an Archivo 13px `.num` sibling at the baseline rather than part of the heading.
- Settings, Account, Privacy, Legal screens: all `--body`/`--row`; the only mono left is a device ID or a version string.
- Desktop sidebar and mini-bar (`23-desktop.css`): bin names, the sundown legend (`.sidebar-sundown-leg`), the mini-bar time and mode-toggle text all move to `--body`; the mini-bar time takes `.num`. The sidebar's phase word stays Antonio.

The crate's stacked bin labels (`45s · 7″ & 12″`, `THIS WEEK`) are the one place TY2 *introduces* `--hand`: Caveat 700 at 20–22px on the stock-card chip, `rotate(-1.5deg)`, with the existing tape shadow. Format stickers on the sleeves (`12″ · 45`) stay mono — they're printed stickers, not handwriting.

## TY3: lists, numbers and the player (`02-stage-platter`, `05-transport`, `11-gatefold`, `13-player-overlay`, `27-library-sleeves`, `28-picture-sleeve`)

- Player title: Antonio `--giant` 44px `--track-display`, `text-wrap: balance`, `hyphens: none`, max two lines (the existing step-down in `share/styles.js` `fitLines` is reused for the overlay). Artist: `--row` 16px 500 at `rgba(paper,.85)`. Album · year: `--body` 14px `--muted`, `.num`.
- The format line under the platter: chip stays mono 12px 500 on stock-card at `rotate(-1.5deg)` (it's a sticker); the sample-rate line stays mono but mixed case and 12px (`FLAC · 44.1 kHz · 16-bit · Stereo`), `--muted`.
- Times (1:12 / 3:58, mini-player, sleep timer, lock-screen mirror): `--body` 13px `.num` in `--muted`. Not mono — Hunt and Latin both put durations in the text face's tabular figures; the mono was doing tabular's job.
- Gatefold track list: number column `--body` 14px `--muted` `.num`; title `--row` 16px 500; duration `--body` 14px `.num` right-aligned; side headings stay Antonio; the "Liner notes" kicker is `--caption` caps. Side totals `.num`.
- Song list / artist list rows: title `--row` 16px 500 at `--paper`, sub-line `--body` 14px `--muted`; playing row at full `--paper`, others at `.85` — the tone rule, no size change.
- Label rim text on the platter (`45 RPM · Side A · Stereo`): stays mono, may stay 6–7px (physical object; the format line below repeats it). Dead-wax etchings unchanged.
- EQ sheet: band labels `--body`; Hz/dB readouts mono `.num` (whitelist).

## TY4: the wordmark and the awning (`09-launch-intro`, `18-storefront`, `20-friend-store`, `share/styles.js`, `data/wordmark.svg`)

The mark is **A** from the canvas: Antonio Bold skeleton, lowercase after the cap M, letter-spaced `−.01em`, the three i-dots replaced by spindle rings (stroke ≈ 0.28 × dot diameter, ring diameter ≈ 1.2 × the original dot, centred on the stem, sitting 1 dot-height above x-height). Orange rings, paper letters; in light theme and on stock-card, aubergine letters (`#26202C`) with amber-shade rings; reversed on the orange label, `--on-accent` letters with paper rings. Minimum size 16px; below that, use the A-with-filled-dots cut (C on the canvas) which holds at favicon size.

**F** is the display cut: the same drawing rotated `−12°`, used in exactly two places — the launch intro's Miziki sleeve (the default cover until the library fills) and the empty-sleeve state. It is never used upright anywhere F appears, and A is never used tilted.

- Draw it once as `data/wordmark.svg` (outlines, not `<text>`), with the rings as separate paths so they can take the accent colour. Export a 1× PNG set for the share cards' canvas (`drawShareWordmark` draws the SVG via `Image`, dropping the Archivo "zi" treatment) and for the Capacitor icon set later.
- `09-launch-intro.css`: `.launch-wordmark` becomes the SVG; the `.16em`/`.1em` tracking rules go. The "grown" state scales the SVG, not the font-size.
- The platter's "M I Z I K I" ring text goes; the label gets A at 16px in the lower half (the canvas's label mock).
- **Awning** (`18-storefront.css`, `20-friend-store.css`): "Crate of" `--caption` 10–11px 600 caps `.1em` in `--warm-grey`; the username Archivo 700 26px caps `+.08em`, `#26202C` on `--stock-card`, centred, single line. Names over 14 characters drop to 600 / 20px / `+.06em`; over 22 drop to 500 / 17px / `+.04em`; never condense, never wrap, never ellipsize before 28. Four awning colourways from the CR8 palette (amber, verdigris, prussian, puce stripes on paper), chosen by a hash of the username, so friends' storefronts differ by colour, never by type.
- `.store-handle` (Antonio 36px username) and `.store-stat b` stay Antonio but take `--track-display`; `.store-stat span` becomes `--body` 13px sentence case.

## TY5: two themes, not one inverted (`22-theme.css`, `ui/theme.js`)

- Row and body text weight: dark 450, light 500 (Archivo is variable; `fonts.css` after TY1 allows it). Titles stay 700 in both. Metadata is never lighter than 400 in dark.
- `-webkit-font-smoothing`: dark/night only (TY1 did the token; this PR verifies Nychthemeron flips it with the sky and adds the test).
- Nychthemeron and `mutedGradientStops()` move tone only. Add a comment and a test asserting no `font-size`, `font-family`, `letter-spacing` or `font-weight` is ever written by `drawSun()`/`clock.js`.
- A "Larger text" switch in Settings → Appearance that multiplies the six tokens by 1.15 (Salem Press's readability-toggle recommendation; cheaper than full Dynamic Type until the Capacitor wrap). Saved in prefs; round-trip test per CLAUDE.md.

## TY6: the hand and the share cards (`share/*.js`, `12-sealed-records`, `17-profile` stickers)

- Share cards: titles Antonio `--track-display` with `text-wrap: balance`-equivalent line breaking from `fitLines`; the kicker ("Now playing", "Spun at dusk") Archivo caps `--track-caps`; metadata Archivo `.num`; the format chip mono. Each card keeps exactly one hand-lettered element — the sleeve note on the Record card, the "staff pick" sticker on the Crate card, the season word on the Season card — in Caveat. The wordmark is the SVG (TY4). The `LOCAL · LOSSLESS · NO STREAMING` strapline becomes Archivo 11px caps `.1em` in `--muted`.
- Stickers (staff pick, "friends have this", sealed/shrink-wrap, "new arrival"): Caveat 700 on `--stock-manila` or `#F0D650`, `rotate(−4° to +3°)`, never more than one per sleeve face.
- Sleeve notes (the short per-record note): Caveat 500 at 18px on stock-card, max three lines; the 1–5 rating stays as the existing glyphs.
- User tags in the free-form tagging feature: Caveat with `font-feature-settings: "calt"` on; if Caveat's alternates prove too few in practice (Young: two or three per round letter), swap to a hand face with richer `calt` — candidates to evaluate: Kalam, Gaegu, Reenie Beanie — before the social layer ships tags.
- Fixed crate divider words (New arrivals, Sealed, Staff picks, 45s, This week) are pre-drawn SVGs in `data/dividers/`, not live Caveat, so repeated letters never give the font away.

## TY7: desktop — measure, size, and the glance view (`23-desktop.css`, `shell/player-overlay.js`, `shell/mini-player.js`)

**Not `.at-rest`.** The existing `.player-overlay.at-rest` (CEREMONY §2, toggled in `shell/mini-player.js` `renderMiniPlayer()` as `!current()`) is the desktop *empty* state: nothing loaded, platter and transport hidden, the bare slipmat with the felt wordmark, and the `.rest-hint` card ("Nothing spinning / Pick a record"). It has no idle timer and ends the moment a record loads. It stays exactly as it is; its type is fixed by TY2 (`.rest-eyebrow` mono `.14em` → Archivo caps `--track-caps`; `.rest-hint h2` drops `.03em`) and TY4 (the `.slipmat-rest span` "MIZIKI" at `.18em` becomes the A wordmark SVG on the felt). The glance view below is a new, separate state, `.player-overlay.glance`, and the two are mutually exclusive by construction — glance requires a current track.

The phone rules carry over through the tokens, but desktop has two things the phone doesn't: long lines and distance. The books split these cleanly — line length and leading for anything read (Ruder's 50–60 characters, Kunz's 40–60, Latin's 45–75), and signage rules for anything glanced at (Hunt: large enough, very legible, and in keeping with its surroundings; the viewer's distance and angle decide the size).

**Measure.** A `--measure: 34em` token (≈ 60 characters of Archivo at 16px) applied as `max-width` to every run of prose on desktop: liner notes and the master read-out, sleeve notes, the empty-state copy, Settings descriptions, the Privacy and Terms screens, the friend store's bio. Prose never spans a panel just because the panel is wide. The crate's detail panel and the gatefold's text column get the same cap; their sleeves and track lists are not prose and stay fluid.

**Size at the desk.** Desktop is further from the eye and the surface is brighter and larger, so the phone floor moves up one notch at `min-width: 1024px`: rows 16px (unchanged) but `--fs-body` 15px, `--fs-caption` 13px, body line-height 1.5. Nothing on desktop is set at 12px. Hunt's note that a page full of white space "may be overpowering on a light-emitting screen" applies to the light theme on a 27-inch monitor: the desktop light sky keeps its grain and the panels stay stock-card rather than white.

**The glance view (the second-monitor case).** When the player overlay is open on desktop with a record loaded and has had no pointer movement, key or wheel for 60 s, `shell/player-overlay.js` adds `.glance`; any of those events removes it (a `pointermove` listener on the overlay, throttled, plus `keydown` and `wheel` on `document`; the timer is cleared on `visibilitychange` to hidden and on overlay close). `prefers-reduced-motion` doesn't disable it — nothing in it moves — but the "Larger text" switch (TY5) scales it like everything else. At a glance the screen is read from across a desk, so it follows signage rules, not reading rules:

- The title steps up to `--fs-numeral` 64px (two lines max, `fitLines` steps it down); artist `--fs-hero` 28px Archivo 500; album · year `--fs-title` 20px `--muted`. Nothing smaller than 20px is visible in glance; the format line, times, chips and controls fade to 0 and return on pointer movement. Hunt's test for signage: can it be read at the distance it will be seen from, at the angle it will be seen at — a second monitor is often off-axis, so Antonio at 64px with `--track-numeral` is the floor, not the ceiling.
- The platter stays the only moving element; the title is the stillest thing on the screen (Hunt: motionless type stands out when everything else moves). No looping text animation, ever — no marquee for long titles; they wrap or step down.
- Sundown's sky is the surrounding the type must sit in. As the sky darkens the title's tone follows `mutedGradientStops()` the way the muted tokens already do — paper at noon, a warmer paper at dusk, never below 7:1 against the current `--sky2`. The glance view is the one place the accent may be text: "Spun at dusk" / the phase word in amber at ≥ 20px, since Hunt's rule is that coloured type must be larger or bolder to carry.
- Side flips and the put-away show their wording ("Side B", "End of record") at `--fs-numeral` for the three seconds they're up; these are the only words a user across the room needs.
- In glance, the chrome (sidebar, mini-bar, the overlay's side panel) dims to 40% rather than hiding, so the layout doesn't jump when the pointer returns. Leaving glance is a 250 ms opacity return, nothing else.

**Dual-monitor check.** Add to the device checklist: open Miziki on a secondary monitor, start a record, sit at the primary monitor for a side. From the normal working position, without leaning, the title, artist and the side flip are readable; nothing else is asking to be read.

## Build order

1. **TY1** tokens — small, touches three files, every later PR depends on it. Ship alone and look at every screen.
2. **TY2** chrome → Archivo — the visible change; most of the 148 mono call sites are here.
3. **TY3** lists, numbers, player.
4. **TY4** wordmark + awning — needs the SVG drawn first (can be done in parallel with 2–3; the drawing is the work, the CSS is small).
5. **TY5** themes.
6. **TY6** hand + share cards — depends on TY4's SVG and TY1's `--hand`.
7. **TY7** desktop measure and glance — last, because it builds on TY3's player sizes and TY5's theme weights; can be split into TY7a (measure and sizes, CSS only) and TY7b (the glance view, which adds the idle timer to `player-overlay.js` and must not touch `.at-rest`).

TY2 and TY3 together are the "mono migration"; grep `var(--data)` after TY3 should return ≤ 25 rules, every one on the whitelist, each with a one-line comment naming which whitelist item it is.

## Later ideas (not in this build)

- Full iOS Dynamic Type once Capacitor wraps the app (replaces TY5's switch).
- Optical-size axis: Antonio has none; if a display face with an `opsz` axis ever replaces it, the `--track-display`/`--track-numeral` tokens become unnecessary.
- Artist-designed pressings and RSD-style variants may want artist-supplied lettering on the label; the whitelist should grow a "label art" item then, not before.
- A true "ambient" desktop mode beyond glance — full-window platter, no chrome at all, the sky edge to edge — once the glance view has been lived with for a few weeks.
