# 25 · From scratch

Miziki redrawn as if the type books (`22_TYPE.md`), the colour books (`13_CRATE.md`) and the Taoist rules (`23_RHYTHM_AND_WEAR.md`, `24_QUIET_COUNTS.md`, CLAUDE.md's **How Miziki behaves**) had all been there on day one. Ken compared the from-scratch design against the current build screen by screen (Oct 30) and chose the from-scratch version everywhere. This plan moves the build there, and adds two features that came out of the same session: **Focus** and **Library tools in the library**.

Most of the behaviour is already in the build. What changes is mostly the look: the palette, where amber is allowed, switches, and the screens drawn to those rules.

**Decisions (Ken, Oct 30):**
- **Everything from scratch.** Palette, type, Now Playing, Crate, Storefront, share cards, themes and after-dark screens all follow the frames in `docs/design/from-scratch/`.
- **One amber, as a printed ink:** `#E9A24A`. It lives on the paper label, the sun (the Sundown knob) and the wordmark's rings, and nowhere else. **Amber never marks a selected, active or "on" state.** The active tab, underlines, pressed buttons and switches use cream and weight instead.
- **Warm neutrals:** muted text comes from the warm black and paper family (`#ABA298`), not blue-grey. The teal night sky stays (it is amber's complement).
- **Every on/off control is a switch.** Two-way choices that aren't on/off (List/Crate) stay segmented.
- **Focus replaces This record only.** It's a button on the player, beside the queue.
- **Library tools: one panel, two places.** Reachable from the library's ··· menu as well as Profile › Settings; the same element, never a copy.
- **No new names for times of day, no Chinese terms, plain wording** (unchanged from docs/23).

**Open, not blocking:** while Focus is on, does "now spinning" still broadcast? Default in this plan: **unchanged** (it follows the existing Privacy setting and the player's "Don't share this session"). Ken can flip that later in one line.

**Designs:** `docs/design/from-scratch/` (frames plus README). Every prompt below points Claude Code there. Frames ending in `b-…-current` are the build as it was, for comparison only.

**Order:** FS0 → FS12, one PR each, the usual routine (preview, merge, after-merge check). FS1–FS3 are the foundation and go first, in order. FS10 (Focus) waits for FS5. FS11 waits for FS3. FS6–FS9 can run in any order after FS4. FS12 is last, after everything else has merged.

**One in, one out (CLAUDE.md):** each PR's description names what it removes, absorbs or simplifies. Every step below has a **Removed** list naming the exact code to delete. Those lists are the minimum, not the whole job (see **Replace, don't layer**).

**Tests:** existing tests that assert the old colours, the On/Off segmented markup, `#recordOnlyBtn`, or `#modeToggle` on the player will fail on purpose. Rewrite or delete them in the same PR as the change; a failure there is expected, not a regression.

## Replace, don't layer (applies to every PR)

This plan **replaces** parts of Miziki. It never adds a new version beside an old one.

1. **Delete what you replace, in the same PR.** That means the old markup, CSS rules, JS handlers, state fields, tokens, tests and CLAUDE.md lines. No aliases, compatibility shims, feature flags, `display:none` leftovers, commented-out code or "old" classes kept just in case.
2. **Rename instead of copying.** When a new thing does an old thing's job (Focus doing This record only's job, `.switch` doing `.store-switch`'s), move and rename the old code. Don't write a second implementation and leave the first.
3. **Rewrite tests, don't stack them.** A test for removed behaviour is deleted or rewritten to the new behaviour. No parallel test files for the new thing while the old file still tests the old.
4. **Saved data:** if anything removed was ever saved (prefs, IndexedDB, Supabase), `parsePrefs` (or the store's loader) drops the old key on load, with a round-trip test. Nothing in this plan is expected to need it (This record only was session-only), but check.
5. **Every PR description has a "Removed" section.** It lists the files, ids, classes, tokens, functions and tests deleted. Beside it, the greps proving each is gone (zero hits in `src/`, `miziki.html` and `tests/`, outside the changelog).
6. **Docs say what's true now.** CLAUDE.md is edited to the new state. The old description moves to `docs/CHANGELOG.md` as history, and is never left in CLAUDE.md beside the new one.

FS12, at the end, sweeps for anything the earlier PRs missed.

---

## FS0: the plan and the frames (docs only)

> Read CLAUDE.md first. Docs-only PR.
>
> 1. Add this doc and `docs/design/from-scratch/` (README plus `frames/`) if they aren't in the repo yet.
> 2. Mark what this plan supersedes with a one-line note at the top of each affected section — "**Superseded by docs/25_FROM_SCRATCH.md:** …" — and don't rewrite the history:
>    - `docs/13_CRATE.md` CR8 and CLAUDE.md's colour notes: the accent is now `#E9A24A` and never signals state.
>    - `docs/22_TYPE.md` wherever it uses `--accent`/amber for an active or selected state.
>    - `docs/23_RHYTHM_AND_WEAR.md` RW3: "This record only" becomes Focus (FS10).
>    - `docs/12_REFINE.md` / `docs/CEREMONY.md` §1: the player's Vinyl/Pure toggle moves into the Sundown sheet (FS5).
> 3. Add the two new rules to CLAUDE.md's design section, next to "amber never signals state": **"Every on/off control is a switch (`.switch`, `role="switch"`)."** and **"One amber: `--amber` is the label, the sun and the wordmark's rings. Nothing else is amber."**
>
> No code. Open the PR. Do not merge.

**Preview focus:** none (docs only).

---

## FS1: the palette (tokens only)

> Read CLAUDE.md and `docs/design/from-scratch/README.md` (frames `02-day-one-rules`, `10-theme-tokens`, `08-theme-light`, `09-theme-follow-sun-dawn`). Tokens only, plus the few places that hard-code the old values; no layout.
>
> 1. **Dark** (`src/styles/00-base.css`): `--amber` `#FF9E2C` → `#E9A24A`. **Delete `--miziki-orange`**: switch its uses (`audio/mode.js`, `02-stage-platter.css`, `12-sealed-records.css`, `22-theme.css`, `25-day-arc-v2.css`) to `--amber`, and replace every literal `#FF9E2C`/`#ff9e2c`/`rgba(255,158,44,…)` in `src/` with the token; `--accent-text` → `var(--amber)`; `--muted` `#94A0A6` → `#ABA298`; `--muted-2` `#86939A` → `#9A9187`; `--panel` and `--chrome` take a warm base, `rgba(12,10,9,.55)` / `rgba(12,10,9,.92)`; `--sel` → `rgba(239,233,223,.10)` (no amber in it); `--disc-a/b/c` → `#242127 / #1C1A1F / #141216` (the warm black from CR8's plinth). New: `--popover:#2A2522`, `--danger:#E8A196`, `--danger-line:#D9877C`.
> 2. **Light** (`src/styles/22-theme.css`): ink `#26202C`, `--muted` `#6B6258`, `--accent-text` `#9A4700` (already the amber shade); stickers and paper slips lift to `#FBF7EE` so they still read as paper on the light ground; `--danger` `#A2382C`. The day sky's top anchor warms to `#DCE4E4` so muted text clears 4.5:1 at the top of the screen.
> 3. **Follow the sun** (Nychthemeron): no new tokens; any blue- or mauve-grey neutral left in the phase blocks becomes the warm muted. Dawn's muted `#C9BFB4`, its secondary `#D6CCC0`.
> 4. **Contrast test** (`tests/unit/theme.test.js`, RF12's): extend to every new/changed token in both themes and every phase anchor: muted ≥ 4.5, `--danger` ≥ 4.5 on `--popover`, light `--accent-text` ≥ 4.5 on `--sky1`/`--sky2`/`--stock-card`. If a phase fails, darken that phase's anchor, not the text.
>
> **Removed:** `--miziki-orange`, `--cool`, every literal old-orange and blue-grey value, and any token unused after this PR (grep each token name; zero hits outside `00-base.css` means delete it). The contrast test's old expected values are replaced, not kept beside the new ones. Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** the label and the sun knob look like ink, not neon; muted text feels warm; the light theme feels like paper. Nothing has moved.

---

## FS2: amber never signals state

> Read CLAUDE.md and the README (every frame). The rule: `--amber`/`--accent` appears only on **the paper label, the Sundown knob's sun, and the wordmark's rings**. Everything that shows *state* — active, selected, pressed, current, on — uses cream (`--cream`) and weight instead.
>
> 1. Audit every `var(--accent)`, `var(--amber)`, `var(--sel)` and `--accent-text` use in `src/styles/` (64 `--accent` uses at the time of writing) and every JS that sets them inline. For each, keep it only if it's one of the three allowed objects; otherwise:
>    - **Active tab** (bottom bar and library tabs): icon and label `--cream`, label weight 700 (bottom bar) / 600 (library tabs); the library tabs' underline becomes a `1.5px` `--cream` rule. Inactive stays `--muted`.
>    - **Pressed / selected** buttons, chips, segmented options: cream fill, `--ink` text (frame `18-library-tools-expanded`'s List/Crate).
>    - **Primary play buttons** on paper (crate catalog card, gatefold): `--ink` disc with paper glyph (frame `03-crate`).
>    - **The letter rail's current letter**: cream, weight 600.
>    - **Rating ticks**: cream (they're decoration, never a score).
>    - **Progress fills**: cream.
>    - **Default awning** (`profile/storefront.js` `awningColorway()` fallback, currently `var(--accent)`): oxblood `#7A2E2A` stripes with `--stock-divider-1`.
> 2. Leave the phase colour where it already marks the time of day (it isn't amber).
> 3. **Tests:** a unit test that greps the built CSS for `--accent`/`--amber` and fails on any selector outside an allowlist (`.label*`, `.sun-knob*`, `.wordmark*`, `.disc-label*`, share-card label/wordmark classes). Add to the allowlist only with a comment saying which of the three objects it is.
>
> **Removed:** every amber state rule. Each is *edited in place* to its cream/weight version, never overridden by a later rule. `--sel`'s amber tint and any `.active`/`[aria-pressed=true]`/`[aria-selected=true]` override written only to undo an amber are deleted too. Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** walk every tab. The only amber you see is a label, the sun, or the wordmark.

---

## FS3: every on/off control is a switch

> Read CLAUDE.md and the README (frame `18-library-tools-expanded`). One switch component for the whole app.
>
> 1. **The component:** generalize `profile/storefront.js`'s `.store-switch` into `.switch` (new `src/styles/31-switch.css`, plus a tiny `ui/switch.js` helper `makeSwitch({checked, label, onChange})` for JS-built rows). A real `<button role="switch" aria-checked>`; track 44×26, radius 13; **off** = `rgba(239,233,223,.16)` track, `--muted` knob at left; **on** = `--cream` track, warm-black knob at right; 160 ms ease, none under reduced motion. Hit area is the whole row (the label taps it too), at least 44 px tall. Light theme: off track `rgba(38,32,44,.14)`, on track `--ink` with a paper knob.
> 2. **Convert every on/off control** — every `.seg` whose options are On/Off (18 in `miziki.html` at the time of writing: Library tools' Sides A/B, Sealed records, Play in full player; Playback settings' Scratch, Sleeve Pull, Launch intro, Background playback and the rest; `#stopAtTurnsBtn`; …) and every JS-built one in `profile/settings.js`, `profile/privacy.js`, `profile/screens.js`, `wiring/character.js`, `wiring/sundown.js`, `wiring/share.js`, `storage/meta.js`. Grep `aria-pressed` and `>On<`/`>Off<` to find them all. State, prefs and handlers stay exactly as they are; only the control changes. `#recordOnlyBtn` is left alone (FS10 removes it).
> 3. **Stay segmented:** controls with two or more *named* options that aren't on/off — Library layout (List/Crate), Sundown depth, EQ presets, theme (Auto/Light/Dark/Follow the sun).
> 4. **Tests:** `makeSwitch` (aria-checked follows state, label tap toggles, keyboard Space/Enter); update any test that queried the old `.seg` buttons.
>
> **Removed:** every On/Off `.seg` wrapper and its two-button markup; the CSS that only styled On/Off segs (`.seg` stays only for the multi-option controls); `.store-switch` and its rules in `18-storefront.css` and `01-header.css` (renamed to `.switch`, with `storefront.js` calling `makeSwitch`); every hand-built switch or toggle elsewhere (`eq-sheet.js`'s `switchBtn` moves to `makeSwitch`). Handlers are re-pointed to the switch, never duplicated. Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** Profile › Settings, Library tools, Sundown, Privacy: every on/off is a switch, and each still does what it did.

---

## FS4: shared chrome — wordmark, tab bar, headers

> Read CLAUDE.md and the README (frames `02`, `03`, `04`). TY1–TY7 already set the type system; this PR closes the gaps against the frames.
>
> 1. **Wordmark:** the ring version (A) everywhere it appears, rings in `--amber`; the −12° cut stays for the launch intro and empty sleeves only. Profile's header shows it top-left at 22 px (frame `04-storefront`).
> 2. **Bottom tab bar:** labels Archivo 12, sentence case, no tracking; active 700 cream with a 2.2 stroke icon, inactive 500 `--muted`; no top indicator line (frame `03-crate`).
> 3. **Section kickers** ("Side A", "Now spinning", "View"): Archivo 12/600 caps, `.06em`, `--muted`. Section headings ("Staff picks", "Most spun", "This morning"): Antonio 20, tracking 0, with any qualifier ("Last 30 days", "from friends") as an Archivo 13 `--muted` sibling on the baseline.
> 4. **Popovers and menus** (`#addMenu`, `#libOverflowMenu`, `#playerOverflowMenu`): `--popover` background, 12 px radius, `1px rgba(239,233,223,.12)` edge, 48 px rows, Archivo 16/500.
>
> **Removed:** the old wordmark renderings (Antonio tracked `.16em`, Archivo with an orange "zi", the spaced "M I Z I K I") and their CSS/canvas code, so one mark function draws every wordmark; any leftover mono/caps tab labels; the tab bar's top indicator line and its CSS. Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** the tab bar and headers read calmly; the wordmark is the same mark everywhere.

---

## FS5: Now Playing

> Read CLAUDE.md (rule 9 especially) and the README (frames `01-now-playing`, `11-after-dark-midnight`, `13b-focus-button-closeup`). Layout and styling of the full player (`src/styles/02-stage-platter.css`, `05-transport.css`, `06-mode-switch.css`, `13-player-overlay.css`, `shell/player-overlay.js`). **No change to anything on the play path.**
>
> 1. **Top row:** the kicker "Side A" (`--muted`, FS4's kicker style) left; `#playerOverflowBtn` right. **Credits and notes, Favorite and Share move into the player's ··· menu** (beside EQ), so the title row is just the title.
> 2. **Platter:** 342 px on a 390 px phone (scale with width), warm-black grooves, centred with 36 px above. Paper label unchanged.
> 3. **Text block:** title Antonio 44, tracking 0, `text-wrap: balance`; artist Archivo 16/500 cream; one line of the taped format chip (`12″ · 33⅓`, mono 12) then the short spec in mono 12 `--muted` (`FLAC 16/44.1`).
> 4. **Progress:** a 2 px line, cream fill on a 16% track, no visible thumb until it's pressed (the range input stays for accessibility and keyboard). Times Archivo 13 tabular, left elapsed, right **remaining** (`−2:46`).
> 5. **Transport:** play/pause a 64 px *outlined* circle (`1.5px` cream), prev/next 24 px glyphs, 48 px apart.
> 6. **Bottom row:** left the Sundown knob as **sun icon + phase word** in `--amber` ("Dusk", "Midnight", "Afternoon"; at night a small 24-hour ring icon); right the **Focus** pill (FS10 wires it; this PR draws it disabled-hidden) and the queue icon.
> 7. **Vinyl/Pure moves into the Sundown sheet's Sound view** (`#sundownSoundView`), as the first row — a switch labelled "Vinyl", on = Vinyl. `#modeToggle` leaves the player; `#barModeToggle` (desktop mini-bar) stays. `setMode()` is unchanged; only the control moves.
> 8. **After dark** (frame `11`): in the night phase, cream text drops to `#DCD6CC`, muted to `#A39A90`, the label to ~80% brightness, and the evening glance (RW5) works as it does today.
>
> **Removed:**
> - `#modeToggle` and `#modeToggleLabel` markup, their click handler in `wiring/transport.js`, and their rules in `06-mode-switch.css`. The rules `#barModeToggle` still needs move into `23-desktop.css`, and `06-mode-switch.css` is deleted if nothing is left in it. `audio/mode.js` stops updating the removed element; the Sound view's switch calls the same `setMode()`.
> - The title-row buttons `#trackInfoBtn`, `#playerFavBtn` and `#playerShareIconBtn`: markup, CSS, and their show/hide code in `player/transport.js`, `shell/runout.js`, `wiring/edit.js`, `library/delete.js`. Their handlers in `wiring/share.js`, `library/favorites.js` and `library/credits.js` are re-pointed to the new ··· menu items, not copied. Update `favorites.test.js` and `credits.test.js` to the menu items.
> - The progress thumb's always-visible styles.
>
> Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** play an album; the screen matches frame `01`. Switch Vinyl/Pure from the Sundown sheet. Favorite and share from the ··· menu. Spin to scrub still works.

**After-merge check:** a record start to finish one evening; nothing feels missing.

---

## FS6: the crate

> Read CLAUDE.md and the README (frames `03-crate`, `17-library-tools-menu`). `src/styles/01-header.css`, `10-crate.css`, `crate/view.js`.
>
> 1. **Header:** Songs / Crate / Artists / Playlists in Archivo 16, sentence case, 16 px apart, active 600 with FS2's cream underline; then search, add and **···** icons (28 px wide, 44 px tall), all on one line at 390 px with nothing overlapping.
> 2. **Under it:** the sort chip (Archivo 14/500, 36 px pill, cycle icon) left; "N records" in Archivo 13 `--muted` right — nothing else on that line.
> 3. **Section header:** the section's name in Archivo 14/600 and the dots under it (CR14's), centred.
> 4. **The bin:** the current letter's divider is a kraft card with the letter hand-lettered in Caveat 700 (~58 px) and its range in Caveat 500 ("Kelp → Kuti"), a strip of tape, −1.5°. The neighbouring section peeks in from the right edge with its name hand-lettered on its tab.
> 5. **Catalog card:** paper ground; title Antonio 28; artist Archivo 16/500; "Label · Year · Format" Archivo 13 in the paper's muted (`#5E534B`); play button per FS2 (ink disc).
> 6. Format stickers stay mono (11 px), one sticker per sleeve (CR3).
>
> **Removed:** the old header, chip, count-line and catalog-card styles. Each is restyled in place in `01-header.css`/`10-crate.css`, never overridden. Also the old count formats in `crate/view.js` and any divider/label code the hand-lettered divider replaces. Lint and unit tests pass; both builds preview with no console errors; NV1's perf numbers show no regression. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** the crate matches frame `03`; the header fits on one line at the largest Dynamic Type size you use.

---

## FS7: your storefront

> Read CLAUDE.md, docs/24 (QC3) and the README (frame `04-storefront`). `profile/storefront.js`, `src/styles/17-profile.css`, `18-storefront.css`.
>
> 1. **Header:** the wordmark top-left, Settings top-right.
> 2. **Awning:** your own crate defaults to the oxblood colourway (FS2); "Crate of" Archivo 12/600 caps over the username in Archivo 700 32, caps, `+.08em`.
> 3. **Identity row:** avatar disc, display name Archivo 20/600, then your own short line (the profile's existing bio/name field) in `--muted` — nothing when it's empty; Edit as an outlined pill.
> 4. **Last spun:** one raised row with the last record you played and "Spun last night" / "Spun 3 hours ago" (`lastSpunLabel()`). This replaces any stats row.
> 5. **Staff picks:** Antonio 20 heading, no count; three sleeves; a sleeve with a note shows it as a Caveat price-tag slip on paper.
> 6. **Recently found:** the three newest pressings you've found, as discs (newest first, no count, no link to "more" — the full chart stays on Records).
>
> **Removed:** your own crate's stats row (the `storeStat` calls and their CSS; a friend's crate keeps "In common" per QC3) and any header markup the new wordmark row replaces. Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** your crate matches frame `04`; a friend's crate keeps its own colourway and "In common".

---

## FS8: share cards

> Read CLAUDE.md, docs/18 and docs/24 (QC2), and the README (frames `05`, `06`, `07`). `src/share/*-card.js`, `share/styles.js`.
>
> 1. **All five cards:** the ring wordmark bottom-left (Antonio 22–28), "from the crate of **name**" bottom-right in Archivo 13–14; no slogan line ("LOCAL · LOSSLESS · NO STREAMING" goes); no caps chips; the four voices only (Antonio title, Archivo words, mono on objects, Caveat on paper).
> 2. **Now Playing (story):** the sky of the phase it was spun in; the jacket with the record peeking out in its pressing; title Antonio 56, artist Archivo 20/500, "Album · Year" Archivo 16 muted; one line "Spun at dusk · Vinyl · FLAC 16/44.1" with the sun icon. **No progress bar or clock.**
> 3. **Record (square):** pressing name block (kicker "Pressing", Antonio 40 name, "Finish · speed" muted); rating ticks cream; the friends sticker as a round butter sticker on the jacket ("3 friends"); album title Antonio 28; the sleeve note in Caveat 24 on a taped paper slip.
> 4. **Season (square):** season name Antonio 40 with "Sep – Nov · N records" muted; the 24-hour listening ring (from `sundown/rhythm.js`'s data, noon at top, the busiest arcs in amber at full strength, quieter ones at 45%); the verdict as a sentence ("Mostly after dark."); the top 3 covers.
> 5. **Pressings and Crate cards** (no frames): same footer, voices and palette; no counts (QC2).
>
> **Removed:** in `now-playing-card.js`, the slogan `fillText` ("LOCAL · … · NO STREAMING"), the progress line, the clock and the spec-chip row, with their layout constants (`CHIPS_GAP` and the rest) and SH2 comments. The old "Mi zi ki" footer drawing in every card is replaced by one shared wordmark helper in `share/styles.js`. Nothing left unused in `share/`. Lint and unit tests pass (update `tests/unit/share.test.js` where it asserts the old footer or chips); both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** share each card type to Photos from the iPhone; compare with frames `05`–`07`.

---

## FS9: Home after sunset

> Read CLAUDE.md, docs/23 (RW2) and the README (frame `12-after-dark-home`). `social/screens/home.js`. Behaviour is unchanged (RW2): this is the look.
>
> 1. "Now spinning" rows: a small disc with the record's pressing colour, title Archivo 16/500, "handle · side B" muted.
> 2. "This morning" (the sunrise update, heading Antonio 20 + "from friends" muted): sleeves with a muted caption under each — "added by …" or "pinned by …"; a pinned record with a sleeve note shows it as a Caveat slip on the sleeve.
> 3. The caught-up line is plain Archivo 14 muted: "You're caught up."
>
> **Removed:** any remaining feed chrome (badges, counts, accent dots) and the old caught-up banner's styling, restyled in place. Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** preview the Sundown dial to 10 PM and open Home: it matches frame `12`.

---

## FS10: Focus (replaces This record only)

> Read CLAUDE.md (rule 9, **How Miziki behaves**), docs/23 RW3–RW5, and the README (frames `13-focus-entry`, `13b-focus-button-closeup`, `14-focus-on`, `15-focus-between-sides`, `16-focus-end`). Depends on FS5. One in, one out: **Focus absorbs This record only** (`#recordOnlyRow`, `#recordOnlyBtn`, `toggleRecordOnly`) and **reuses RW5's evening-glance fading** instead of a new idle system.
>
> 1. **The way in:** the Focus pill in the player's bottom row (FS5), right of the Sundown knob, left of the queue: outlined (`1px rgba(239,233,223,.32)`, 6% fill), three-ring icon, "Focus". `S.focus` is per-session, never saved (same as RW3's `S.recordOnly`, which it replaces).
> 2. **While Focus is on** (frame `14`):
>    - It covers **the current record, both sides**. The queue isn't touched.
>    - The player can't be minimised into the mini-bar, and the tab bar is hidden. **Done** (top right) or a swipe down **ends Focus**; playback carries on.
>    - Top row: "Focus" with the ring icon (muted) left, **Done** right. Under the artist, one line: "Side A · the record ends around 10:42 pm" — the remaining duration of this album's tracks at the current rate (Sundown slows Vinyl), rounded to the minute, recomputed when the rate changes.
>    - **Controls fade after 6 s idle, at any hour**: RW5's first layer (transport, times, spec lines, bottom row) with the progress line at 40%; RW5's deeper night layer still applies only at night. Any touch brings them back without pressing what was underneath (RW5's rule).
> 3. **Between sides** (frame `15`): the run-out's wait state reads "Side A is over." with a **Flip to side B** pill. If auto-flip is on, it flips itself as today. A one-track single has no flip (docs/17).
> 4. **The end** (frame `16`): when the record ends — the album boundary in `advance()`, the same shared boundary helper RW3 uses — playback stops and the screen holds the sleeve (RW4's resting state) with "Side B ended at 10:42 pm", **Play it again** (outlined, restarts side A) and **Back to your queue** (`continueFromResting()`). Focus ends on its own at that moment.
> 5. **Stop at sunset and midnight** (`S.stopAtTurns`) is untouched and still lives in Sundown.
> 6. **Now spinning:** unchanged while Focus is on (see Open, above).
> 7. **Desktop:** the same states inside the player panel; the sidebar and library pane fold away while Focus is on.
> 8. **Rule 9:** the stop is a decision inside `advance()` before `load()`, exactly where RW3's is. Don't add, remove or reorder any `await` on the play path.
> 9. **Tests:** **rewrite** the This record only cases in `tests/unit/queue.test.js` and `tests/unit/runout-held-sleeve.test.js` as Focus cases, not new files beside them. Cover the end-of-record decision with Focus on (same album continues across sides, different album stops, queue end stops, single with no flip); "ends around" arithmetic at rates 1.0 and 0.8; Done/swipe ending Focus without stopping playback; and `S.focus` not being serialized.
> 10. **Removed (This record only is renamed into Focus, not kept beside it):**
>     - `S.recordOnly` in `state.js` becomes `S.focus`.
>     - `toggleRecordOnly` and its branches in `player/queue.js` and `player/transport.js` become the Focus versions.
>     - `#recordOnlyRow` and `#recordOnlyBtn` come out of `miziki.html`, with their handler in `wiring/transport.js`.
>     - The `.record-only-row` rules come out of `03-sleeve-pull.css`, and the record-only selectors in `29-evening-glance.css` are rewritten for Focus.
>     - The resting copy "Playback stops after this record." is replaced by frame `16`'s.
>
>     Greps for `recordOnly` and `record-only` return zero hits.
>
> Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** queue two albums, start the first, tap Focus. Controls fade; touch brings them back. Skip to near the end of side A: flip prompt (auto-flip off). Finish side B: the sleeve holds, "Back to your queue" starts album two. Start Focus again and tap Done: music keeps playing, tabs return.

**After-merge check:** one record in Focus one evening, start to finish.

---

## FS11: Library tools in the library

> Read CLAUDE.md and the README (frames `17-library-tools-menu`, `18-library-tools-expanded`). Depends on FS3. `shell/header.js`, `wiring/library-view.js`, `profile/screens.js`, `src/styles/01-header.css`.
>
> 1. **The menu:** `#libOverflowMenu` gets a second row under Select: "Library tools ›".
> 2. **Expanding:** tapping it grows the menu in place into the Library tools panel — anchored under the header, 12 px from each side, 14 px radius, `--popover`, max height `calc(100dvh - 140px)` with its own scroll. Header row: "Library tools" (Archivo 16/600) and a 44 px **×** close button. The scrim stays. The grow is one 200 ms ease from the menu's rect to the panel's; none under reduced motion.
> 3. **One panel, two places:** the panel's body is the existing `#libTools` element, **reparented**, never copied — moved from `#libToolsStash` (or from Settings) into the panel on open, and parked back on close, the same stash pattern `renderAppSettingsScreen()` uses. In the panel its disclosure row (`#libToolsToggle`) is hidden and the body is always expanded; Settings keeps its disclosure. `refreshLibraryTools()` runs on open.
> 4. **Closing:** the ×, a tap on the scrim, Escape, or the back gesture (`openLayer`/`closeLibOverflowMenu`). Opening Library tools from Settings while the panel is open can't happen (different routes), but guard it: whichever opens last owns the element.
> 5. **Contents** (unchanged, restyled per frame `18`): View — Library layout (segmented List/Crate), Sides A / B, Sealed records, Play in full player (switches, FS3); Maintain — Find duplicates, Clear listening history (with its sub-line), Play test tone; Danger — Forget library with an outlined `--danger` "Forget" button; footer "N tracks · size · stored on this device".
> 6. **Tests:** reparenting (open from the library, close, open Settings: one `#libTools` in the DOM, in the right parent, state intact); scrim and × both close.
>
> **Removed / not added:** no second copy of any Library tools markup, handler or state; the panel only reparents `#libTools`. The old disclosure-only styling that the panel restyles in place goes. Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** from the crate, ··· › Library tools; toggle Sealed records off and back; close with ×, then with a tap outside; open Profile › Settings: Library tools is there and shows the same state.

---

## FS12: the sweep

> Read CLAUDE.md and this doc's **Replace, don't layer** rules. Runs after FS0–FS11 have all merged. Cleanup only; no behaviour or visual change.
>
> 1. **Orphaned ids:** every `id="…"` in `miziki.html` must be referenced somewhere in `src/` (or by a `for=`/`aria-*` in the markup); remove the ones that aren't.
> 2. **Dead CSS:** build, then list every class and id selector in `src/styles/` that matches nothing in `miziki.html` or in any class/id string set from `src/` (`el('div','…')`, `className`, `classList.add`). Delete the dead rules. Delete any stylesheet left empty, along with its `<link>`.
> 3. **Dead tokens:** every `--token` defined in `00-base.css`/`22-theme.css` with no `var(--token)` anywhere goes.
> 4. **Dead JS:** exported functions with no importer and constants with no reader in `src/` go. Lint's unused-binding rule must stay at zero warnings.
> 5. **Dead tests and fixtures** for anything removed by FS1–FS11.
> 6. **The old greps return nothing** (outside `docs/CHANGELOG.md` and superseded-note lines): `#FF9E2C`, `miziki-orange`, `recordOnly`, `record-only`, `store-switch`, `modeToggle"` (the player one), `NO STREAMING`, `>On<`/`>Off<` in a `.seg`.
> 7. **Docs:** CLAUDE.md describes only the current app; `docs/CHANGELOG.md` gets one entry per FS PR.
> 8. **Bundle size:** compare `dist/` JS and CSS sizes before and after FS1–FS12 in the PR description. It should go down, or the PR explains why not.
>
> Lint and unit tests pass; both builds preview with no console errors; the device checklist passes in full. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** run the full device checklist. Nothing looks or behaves differently from the end of FS11.
