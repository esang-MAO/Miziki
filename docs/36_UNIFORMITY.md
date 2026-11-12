# 36 · Uniformity

**Addendum: docs/36A_LIBRARY_AND_LAUNCH.md**

A look-and-flow pass over the whole app: one set of parts used everywhere, every screen built from them, and the visual bugs a full walk-through turned up. **This plan replaces the draft `docs/36_GATEFOLD_POLISH.md`.** That draft's gatefold work is folded in here as UN6–UN10, with its decisions kept.

**Checked against `main` at `dcc2fdc` (Nov 9, after #406).** Every finding below comes from running the app in a browser at 390×844 (phone, dark and light) and 1440×900 (desktop). The test setup:
- 51 test tracks across 16 albums: a 10-track LP, a 3-track 10″ EP, and fourteen 2-track 7″ singles with varied covers.
- Listening history created by playing albums all the way through.
- Pins, pressings, metals and all 12 turntables seeded.
- The clock set to 2:30 PM and to 11:30 PM.
- `?social=demo` for sign-in and a friend's crate.

The test-setup notes at the end say how to do the same again.

**Designs** (Claude Design canvases, both approved by Ken on 2026-11-09):
- **"Miziki Gatefold Polish"** (https://claude.ai/artifact/MdVvbhs3muWF4s6GxvEYUy): 10″ EP, 12″ LP, back cover and light theme, with screenshots of today's build for comparison.
- **"Miziki Uniformity"** (https://claude.ai/artifact/5qbTo7wfy18WqF4X4ohq6k), in seven rows:
  1. **Shared parts**, dark and light side by side (`Main`).
  2. **Fixes rebuilt with the parts:**
     - `PlayerLight`, `PlayerMenu`, `Sundown`
     - `Artist`, `Settings`
  3. **Profile flow and empty states:**
     - `Profile`, `Listening`
     - `Playlists`, `LibraryEmpty`
  4. **Desktop profile:** `DesktopProfile`.
  5. **Wall, shelves and turntables:**
     - `ProfileWall`, `ProfileShelf`, `ProfileWallLight`
     - `TurntablePicker`, `DesktopWall`
  6. **Second pass:**
     - `PlayerNight`, `SoundView`, `ListeningData`
     - `Records`, `WallOne`
     - `DesktopGatefold`, `DesktopSettings`
  7. **Third pass:**
     - `TrackMenu`, `RowMenu`
     - `Resting`, `FriendCrate`

GP0/UN0 exports them all to `docs/design/uniformity/`.

**One rule for the whole plan:** a screen is "done" when it uses only the parts in UN2. No new one-off button, heading, toggle or menu styles. If a screen seems to need one, add it to UN2's set (and its canvas frame) first, in the same PR, and say so in the PR description.

**One in, one out**, as usual: every PR names what it removes. The big removals:
- The scattered `color:var(--cream)` text rules (UN1)
- The per-screen heading styles: mono caps, Antonio caps and Antonio title case used as section labels (UN2/UN12)
- The grid-of-buttons song menu (UN3)
- The second profile header bar on sub-screens (UN12)
- The hardcoded plum gatefold panel (UN6)
- `.gf-back-cover-more` (UN10)
- The duplicate spines on the shelf (UN15)

---

## Decisions (Ken, 2026-11-09)

**Gatefold** (carried from the 36 draft):
1. **The gatefold stays one size for every format**, as decided on Nov 5 in `src/gatefold/geometry.js`. The panel is worked out from the viewport (334px on a 390-wide phone, 350px when there's room). It never changes size by format.
2. **Back cover footer:** the catalogue number, the spec line and the Miziki mark sit slightly above the frame's bottom line, never resting on it.
3. **The inside takes its colour from the cover.** Cream text clears 7:1 on it. Records with no art keep today's plum.
4. **One title.** Artist and title show in the panel only. The info block under the spread is two deliberate mono lines.

**Uniformity:**
5. **One set of parts** (canvas `Main`):
   - Titles: screen title Antonio 700 / 28px; sheet title Antonio 600 / 22px.
   - Section labels: Archivo 600 / 12px caps, `.08em` tracking, muted.
   - Text: row text Archivo 16px, supporting text Archivo 14px muted, and mono only for data (formats, times, sizes).
   - **Choice controls:** one segmented control (equal segments, selected segment filled with `--paper` and inverse text). It replaces the outlined boxes, the uppercase pills and the stacked full-width buttons.
   - **Rows:** one toggle row (label, inline ⓘ button, description, switch on the right) and one navigation row (label, value, chevron).
   - **Buttons:** primary, secondary and danger, all sentence case.
   - **Menus:** one list menu, sentence case, no emoji, grouped with dividers, destructive items last in the danger colour.
   - **Empty states:** one taped-paper note with a single clear action.
6. **Hand lettering (Caveat) stays only on paper and the wall:** the crate plate, "in rotation", "pressings, found while listening", stickers, notes and "on the platter". Everywhere else uses the parts above.
7. **Menus are sentence case everywhere.** "Sleep timer", "Save as playlist", "Sleeve pull", "Remove artist…", "Credits and notes".
8. **The "Don't share this session" item becomes a "Private session" switch** inside the player ⋯ menu.
9. **The theme choice "Nychthemeron" is labelled "Sun"** so all four fit on one row. The setting's stored id stays `nychthemeron`, and the label's ⓘ says it follows the sky all day.
10. **"Remove artist" moves into the artist page's ⋯ menu**, in the danger colour, with a confirm.
11. **The library ⋯ button opens Library tools directly**, since it's the only item.
12. **The profile has one header:** the "[username]'s crate" plate on the left and a settings gear on the right. Refresh moves to pull-to-refresh (`25-pull-refresh.css` already exists) and the "Refresh" text button goes. Sub-screens (Listening, Records, Top albums, Top songs, Played through, Privacy, Account, Privacy Policy, Terms, Settings) get a single "‹ Profile" back header with the screen's name, and no second bar.
13. **The desktop sidebar says "Profile", not "Crate",** matching the phone tab bar. "Crate" stays the library view's name only.
14. **Quiet Counts applies to pressings everywhere.** "6 PRESSINGS · 2 METALS" on the profile row and "Pressings · 1" on the Records filter both go. Library record counts ("14 records") stay.

**Shelf, wall and turntables:**
15. **One spine per record.** The shelf takes each album once, never once per crate section.
16. **Spines are solid colour**, taken from the cover with the same function as the gatefold tint (UN6), with a darker band at the top. **Spine height follows format:** 12″ full, 10″ a little shorter, 7″ shorter again. Decided as drawn; Ken can still ask for one height.
17. **The shelf unit is only as tall as its records.** It starts at one row of two cubes and adds a row as the crate grows, up to today's three. The "room to grow" note stays on the last open cube only. No padding with empty rows.
18. **The pressing cubby on the wall is sized to what's been found:** one section, two, then three (the most). It's never a full-width box with one small disc in it.
19. **The turntable on top of the shelf is about 15% larger.** The picker shows the selected deck's name and note right under the preview.
20. **A friend's crate uses the same plate, wall and shelf as yours**, not the older store sections. Where their cover art isn't on your device:
    - spines use the record's own pressing colour (same for everyone, keyed by artist + album)
    - covers use a printed title cover: their tint, the title in Antonio and the artist in Archivo.

**Player:**
21. **The player has one progress bar**, with side and track ("Side A · 1 of 2") in its caption. The separate segmented track bar goes.
22. **The player shows two spec lines, not three.** Line one is the format and file ("7″ · 45 · MP3 · 44.1 kHz · lossy"). Line two shows only when it means something (Night speed, a metal), in amber ink. "AFTERNOON · FULL SPEED" goes, since the phase button already says it.
23. **The end-of-record card sits in place of the spec lines**, never between them and the controls. The play button always stays on screen.

**Open (not blocking):**
- **The brown bar under the artist page's buttons:** what it shows isn't clear. UN13 gives it a label or removes it. Ken to say which.

---

## Order

UN0 → UN18, one PR each, the usual routine (preview, merge, after-merge check). Dependencies:

- **UN1 (light-theme text) and UN2 (parts) come first.** Everything after builds on them.
- **Gatefold (UN6–UN10)** needs UN1/UN2.
- **Profile (UN12–UN16)** needs UN2. UN15 also needs UN6's colour function.
- **Desktop (UN17)** comes after the screens it touches.
- **UN18 is the sweep.**

Each PR's own **Preview focus** says what Ken checks on his iPhone.

---

## UN0: designs and superseded notes (docs only)

> Read CLAUDE.md and this plan.
>
> 1. Export every frame from both canvases ("Miziki Gatefold Polish" and "Miziki Uniformity") as PNGs into `docs/design/uniformity/`, named by row and frame (`1-main.png`, `2-player-light.png`, … `7-friend-crate.png`; gatefold frames as `gf-1-ep.png` … `gf-4-light.png`). Add a `README.md` listing each frame, its canvas row and what it shows (use the Designs list above).
> 2. Delete `docs/36_GATEFOLD_POLISH.md` (never merged; folded into this plan).
> 3. Add a one-line "**Look refined by docs/36_UNIFORMITY.md**" note at the top of `docs/29_GATEFOLD.md`, `docs/32_SHELF_AND_TURNTABLES.md`, `docs/33_WALL_AND_LABELS.md` and `docs/30_GROOVES_AND_SHELF.md` (GS8). Leave their history as it is.
> 4. Add this plan's decision 14 (no pressing counts anywhere) to `docs/24_QUIET_COUNTS.md`'s rule list as a one-line cross-reference.
>
> Docs only, no code. Open the PR. Do not merge.

---

## UN1: light theme text

**The biggest single fix.** In light theme, `--cream` is `#FFFDF8`, so the 72 rules that colour *text or icons* with `var(--cream)` turn cream-on-cream. Seen broken:
- the selected library tab ("Crate"), the active tab-bar label and icon, and "Settings" in the profile header
- "Play all", "‹ Back", "Remove Artist", "Cancel" (search), and the matched text in search results
- the player's artist/album line, its progress bar and its play button
- "(i)" marks, "ALL FOUND ›", the selected turntable card's outline and the selected finish ring
- the second flip dot and the flip button's ring on the gatefold

> Read CLAUDE.md, this plan and the README (frames `2-player-light`, `5-wall-light`, `gf-4-light`).
>
> 1. **Audit every `var(--cream)`** in `src/styles/*.css` (72 today: `grep -rn "color:var(--cream)" src/styles`) and every inline `style.color = 'var(--cream)'` or `#EFE9DF`/`#fff` write in `src/**/*.js`. Sort each into one of two kinds:
>    - **Text or icon on the theme background** → `var(--paper)`. `--paper` is the theme's ink: `#EFE9DF` in dark, `#26202C` in light.
>    - **Text on a surface that's dark in both themes** (gatefold panels, the record label, dark stickers, the player at night) → keep a fixed cream, but name it. Add `--on-dark: #EFE9DF` to `00-base.css` (same value in both themes) and use that, so the intent is in the code.
>
>    List every changed rule in the PR description, grouped by kind.
> 2. **Fixed `rgba(239,233,223,…)` lines, dots and rings** that sit on the theme background become token-driven:
>    - `--line` (exists)
>    - new `--ring` (`rgba(239,233,223,.32)` dark / `rgba(38,32,44,.38)` light)
>    - new `--dot` (`rgba(239,233,223,.3)` dark / `rgba(38,32,44,.28)` light)
>
>    Known sites: `.gf-flip-dots span`, `.gf-turn-over`, the turntable picker's selected card, the finish swatch ring, the crate section dots, and the progress tracks.
> 3. **The tab bar:** `08-shell.css` lines 91–92 (`.tabbar-btn[aria-selected="true"] svg/span{color:var(--cream)}`) → `var(--paper)`.
> 4. **Contrast tests:** extend `tests/unit/theme.test.js`. Every new or changed token pair clears 4.5:1 for text and 3:1 for non-text (dots, rings, outlines), in both themes. Add a lint-style unit test that fails if `color:var(--cream)` reappears in `src/styles` outside an allow-list of the dark-surface files (gatefold panel, label, sticker, night). Cream text should then only come back on purpose.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (light theme):** library tabs, tab bar, artist page, search, player (title line, progress, play), gatefold flip dots, profile wall "All found ›", turntable picker. Nothing white on cream anywhere.

---

## UN2: the shared parts

> Read CLAUDE.md, this plan and the README (frame `1-main`). Depends on UN1.
>
> Build the parts once, as CSS classes in a new `src/styles/05-parts.css` (loaded right after `00-base.css`) plus small DOM helpers in a new `src/ui/parts.js`. Each part has exactly one style, in both themes:
>
> | Part | Class / helper | Spec |
> |---|---|---|
> | Screen title | `.p-title` | Antonio 700, `--fs-hero` (28px), `--paper` |
> | Sheet title | `.p-sheet-title` | Antonio 600, 22px, `.02em` |
> | Section label | `.p-label` | Archivo 600, `--fs-caption`, caps, `--track-caps`, `--muted` |
> | Back header | `backHeader(to, title, rightEl)` | 52px row: "‹ {to}" (≥44px hit area) · centred title (Antonio 600 20px) · optional right button |
> | Sheet header | `sheetHeader(title)` | title left, 44px × button right |
> | Segmented control | `.p-seg` + `segmented(opts, value, onChange)` | 1px `--line` frame, 11px radius, `--field` fill, 3px padding, equal flex segments, 40px tall; selected = `--paper` fill, `--sky1` text, 600. Labels never truncate: drop to 13px, then wrap to two rows of equal cells, never cut |
> | Toggle row | `toggleRow({label, desc, info, checked})` | label 16/500, ⓘ button (32px icon, ≥44px hit) right after the label, description 14 muted, existing switch (`31-switch.css`) on the right, `--line` divider between rows |
> | Navigation row | `navRow({label, value, onClick, danger})` | label 16/500, value 14 muted, chevron, 52px min |
> | Buttons | `.p-btn`, `.p-btn--primary`, `.p-btn--danger` | 44px, 10px radius, Archivo 15, sentence case; primary filled `--paper`/`--sky1`; secondary 1.5px `--ring` outline; danger `--danger` text + `--danger-line` outline |
> | List menu | `listMenu(groups)` | `--popover` card, 14px radius, 46px items, 16px Archivo, dividers between groups, `!`-prefixed items in `--danger`, no icons, no emoji |
> | Empty note | `emptyNote({head, sub, action})` | paper card (`--stock-card` light / `--paper` dark), amber tape strip, Caveat 28 headline, Archivo 14 body, one primary button below |
>
> 1. Build these from the canvas frame `1-main` exactly. Where an existing class already does one of these jobs, make it an alias of the new class first (so nothing breaks), and note it for UN18 to delete:
>    - `.seg`, `.cta`, `.cta.ghost`, `.edit-close`, `.crumb-back`
>    - `.store-section-head h2`, `.sd-*-seg`, `.share-style-chip`
> 2. **Focus rings:** today, opening a sheet focuses its × or back button, and the browser draws a hard white box. Replace every bare `:focus` outline with `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: inherit; }`. Keep moving focus programmatically on open (needed for VoiceOver), but the ring then shows only for keyboard users. Check `.gf-back`, `#sealedFrontCloseBtn`, the social auth ×, `#socialNavOverlay`'s back button and every `.edit-close`.
> 3. Unit tests for the helpers (DOM shape, `aria-pressed` on segments, `role="switch"` and `aria-checked` on toggles, the danger class on `!` items). There's no visual test here; the screens that adopt the parts carry their own preview checks.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## UN3: menus

> Read CLAUDE.md, this plan and the README (frames `2-player-menu`, `2-artist`, `7-track-menu`, `7-row-menu`). Depends on UN2.
>
> 1. **Player ⋯** (`#playerOverflowMenu`):
>    - Rebuild with `listMenu`, in three groups: [Queue, Credits and notes, Edit info], [Favorite, Share, EQ, Sleep timer], [the "Private session" switch row].
>    - Drop the ♡ and 🌙 glyphs.
>    - Position it so it always fits on screen. Anchor it above the ⋯ button, and flip it below if there's no room. Today "Don't share this session" is cut off at the bottom of a 390×844 screen.
>    - Rename "Don't share this session" to "Private session" (decision 8). The behaviour is unchanged: on means this session's now-spinning isn't shared.
> 2. **Song ⋯** (`#rowMenuOverlay`, opened from `.t-edit` in `src/library/view.js`):
>    - Replace today's 2×3 grid of Title Case buttons with a sheet: a header row (cover, title, artist · album, ×), then `listMenu` groups [Play next, Add to queue, Add to playlist…], [Add to Favorites, Credits and notes, Edit info], [!Remove from library…].
>    - Remove asks for confirmation through `#confirmOverlay`, as it does today.
> 3. **Gatefold track long-press** (`#gfTrackMenuOverlay`, `openGatefoldTrackMenu()` in `src/gatefold/view.js`):
>    - **Bug:** only the sheet's title and "4:10" show; the rest sits behind the mini-player and tab bar. Raise the overlay above both (z-index and bottom padding of `env(safe-area-inset-bottom)` + mini-player + tab bar height). It should open as a full sheet like frame `7-track-menu`.
>    - Rebuild it with `sheetHeader` (title + "Side A · 4:10" caption) and `listMenu` [Play from here, Play next, Add to queue], [Add to Favorites, Credits], [Share].
> 4. **Gatefold ⋯** (`#gfMoreMenu`): `listMenu` with the existing items, sentence case, "Remove album…" last in danger. **Back cover ⋯:** its items join this menu when the record is turned over (UN10). The Keep for, Track order and Record look sub-sheets get `sheetHeader`.
> 5. **Artist page:**
>    - Its header becomes `backHeader('Artists', name, ⋯)`.
>    - The ⋯ menu holds [Credits, Share artist], [!Remove artist…] (decision 10).
>    - The visible "Remove Artist" text button and the "Credits" button in the action row go. The action row is Play all (primary) and Shuffle (secondary).
> 6. **Library ⋯** (`#hdrOverflowBtn`): opens `#libToolsPanel` directly (decision 11). `#libOverflowMenu` and its scrim are removed. Library tools still also opens from Profile › Settings, as decided Oct 30.
> 7. **Add menu** (`#addMenu`): keeps its two items, restyled with `listMenu`. The icons stay, because both items have them, which makes this the one menu that does. Note it in the PR.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** long-press a gatefold track (whole menu visible); a song's ⋯; the player ⋯ fits; the artist ⋯ shows Remove in red with a confirm.

---

## UN4: sheets and settings rows

> Read CLAUDE.md, this plan and the README (frames `2-settings`, `2-sundown`, `6-sound-view`). Depends on UN2.
>
> 1. **Every sheet header** uses `sheetHeader`:
>    - Share, EQ, Sleep timer, Queue, Edit track, Credits
>    - Liner notes edit (keeps Cancel/Save), Library tools, Shelf finish, Turntable
>    - Duplicate scan, Clear history, Sign in, Sundown
>
>    Library tools' title moves from Archivo bold to the sheet title style.
> 2. **Every choice control** uses `segmented`:
>    - **Sundown and EQ:** night depth (Off/Gentle/Medium/Deep/Deepest; today cut to "Gentl", "Mediu", "Deepe"), night pitch (Slowed/Keep pitch; today "Slowe"), the EQ mode (Graphic/Parametric) and EQ presets (Flat/Warm/Bright/Vocals/Less bass, no longer uppercase pills).
>    - **Share:** Story/Square.
>    - **Settings and Library tools:** Appearance, Loudness (Off/Track/Album/Auto, today wrapping into a 2×2), and Library layout (List/Crate).
>    - **Sound view:** Starting point, Through the day, Surface noise.
>
>    **Sleep timer stays a list**, since it's a pick-one-and-go action rather than a setting, rebuilt as a `listMenu` (15, 30, 45, 60 min · End of track · End of side · End of album · Off).
> 3. **Every on/off row** uses `toggleRow`, and every link row uses `navRow`. Settings rows switch between Antonio labels ("Larger text", "Show wear") and Archivo ("Scratch"); they all become Archivo 16. The standalone "(i)" lines under descriptions become the inline ⓘ button after the label. The ⓘ opens the same explanation it does today.
> 4. **Settings order** (frame `2-settings`, top to bottom):
>    - **Appearance:** theme, plus Larger text, Sky follows the seasons, Show wear.
>    - **Your shelf:** Slipmat, Shelf finish, Turntable.
>    - **Playback:**
>      - Scratch, Sleeve pull, Launch intro, Background playback, Paper label on lossy files, Zoetropes earned
>      - Loudness, Mono, Balance, EQ
>    - **Sundown:** a row opening the sheet.
>    - **Library:** Library tools.
>    - **Account & privacy:** Account, Privacy.
>
>    Sundown moves out of "Account & privacy", where it sits today.
> 5. **Balance:** the "Center" readout moves onto the label row ("Balance … Center"), above the slider, so it can't run off the right edge (it shows as "Cent" today).
> 6. **Appearance:** four equal segments, Auto · Light · Dark · Sun (decision 9). The note under it reads "Auto turns dark at {time} today. Sun follows the sky all day."
> 7. **Sound view** (frame `6-sound-view`):
>    - Section labels use `.p-label` (today they're mono caps).
>    - "Vinyl" becomes a `toggleRow` at the top.
>    - "Hear it without Vinyl" becomes a full-width secondary button. It stays tap-to-toggle (Oct 30 decision), with `aria-pressed`.
> 8. **Buttons:** "FORGET" becomes "Forget library" (danger, sentence case). Every `.cta`/`.cta.ghost` becomes primary or secondary by role. The share sheet's "Save image / Copy / More options ›" row becomes one primary button plus a secondary, with "More options" as a text link under them.
> 9. **Edit track:** drop the divider lines between fields that already have boxes. Labels sit 6px above their field, 16px between fields.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** Sundown sheet (no cut-off labels, both views), Settings top to bottom, EQ, Share, Sleep timer, Library tools, Larger text on.

---

## UN5: empty states and small library fixes

> Read CLAUDE.md, this plan and the README (frames `3-playlists`, `3-library-empty`, `3-listening`). Depends on UN2.
>
> 1. **Empty states** use `emptyNote`, each with one action:
>
>    | Screen | Headline | Body | Action |
>    |---|---|---|---|
>    | Library, no music | "The crate is empty." | "Choose songs or a folder on this device. They stay here, nothing is uploaded or copied." | Choose files (primary), Choose folder (secondary), "Play a test tone" text link |
>    | Playlists, none | "No playlists yet." | "Name one here, or add songs to one from any song's ⋯ menu." | New playlist (opens a name sheet) |
>    | Listening, nothing earned | "Nothing earned yet." | "Play an album start to finish to earn your first metal." | Open the crate |
>    | Home, signed out | "See what friends are spinning" stays the headline | as today | Sign in |
>    | Player side panel, no liner notes / credits (desktop) | "No liner notes." / "No credits." | "These files don't carry any." | none |
>
>    Remove the dashed-border boxes and the giant empty Playlists card. On the no-music library screen, the stray `+ ⋯` row under the box goes; the header keeps its +. On signed-out Home, the floating "Refresh" button goes (pull to refresh).
> 2. **Search:** Cancel or Escape clears the query *and* hides the filter chips (`artist: album: year: More`). Today they stay on screen and overlap the Profile header and the Sundown sheet. The header tabs show no selected tab while results are showing, since results cover every type.
> 3. **Crate count:** when the crate is grouped (Genre/Decade), the count reads "{n} in {section}" ("1 in Ambient"), not "1 record". In A–Z it stays "{n} records".
> 4. **Larger text:** the library header tabs fit. With Larger text on, the gap between tabs shrinks from 16 to 12px. If they still don't fit, the row scrolls sideways with a fade at the right edge, and the selected tab scrolls into view. Today "Playlists" is cut to "Playli".
> 5. **Song rows:** drop "· MP3 · lossy" from every row's subline (it's the same on every row of a typical library). Show the file type only when it differs from the library's most common one, or in the Songs view's ⋯ › Track info.
> 6. **Gatefold Select and Track order** (frame-free, follow the parts):
>    - The panel header shows the mode's label ("Reordering tracks", "2 selected") with a primary "Done" on the right.
>    - Select's actions (Select all, Edit, Remove) move to a bottom bar above the mini-player, using `.p-btn`.
>    - The ▲▼ reorder buttons become 44px icon buttons with `aria-label`s, and gain drag handles.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## UN6: the gatefold takes its colour from the cover

**See also: docs/37_COLOUR.md.**

> Read CLAUDE.md, this plan and the README (frames `gf-1-ep`, `gf-2-lp`). Depends on UN1.
>
> 1. **One colour function.**
>    - Move `shareDominantColor()` out of `src/share/styles.js` into a new `src/ui/art-color.js`, and point the share cards at it.
>    - Add a pure, exported `artTint(rgb)` returning `{from, to}`. It keeps the cover's main hue, caps saturation, and pulls lightness down until `--on-dark` text clears 7:1 on `from` and the 66% muted text clears 4.5:1. `to` is the same hue a step darker.
>    - Near-greys (low saturation) get the warm black `--disc-a` family instead of a muddy tint.
>    - Add `spineColor(rgb)` beside it for UN15: the main colour lightly normalised, never darker than `to`.
> 2. **Use it.** `openGatefold()` works out the tint once from the crate's `M` art tier and sets `--gf-tint-from`/`--gf-tint-to` on `#gatefold`. Cache per `albumId` in memory only.
> 3. **CSS:** `.gf-right`, `.gf-face-front` and `.gf-face-back` (`11-gatefold.css` lines ~82, 152, 156) use `var(--gf-tint-from, #2A1B38)`/`var(--gf-tint-to, #1C1226)`, so a record with no art keeps today's plum. The desktop crate detail panel uses the same variables.
> 4. **Track list fade:** when `#gfTracklist` overflows, a 56px gradient to `--gf-tint-to` covers its bottom edge, hidden once scrolled to the end.
> 5. **Tests:** `artTint()` on a saturated orange, a navy and a near-grey (both contrast floors); `spineColor()` bounds; the no-art fallback.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** three records with very different covers. Each inside looks like it belongs to its cover and reads without squinting.

---

## UN7: the cover strip and a spread that fits

> Read CLAUDE.md, this plan and the README (frames `gf-1-ep`, `gf-2-lp`). Depends on UN6.
>
> 1. **Fit the phone.** `gatefoldGeometry()` (`src/gatefold/geometry.js`) keeps one size for every format (decision 1) but works it out from the viewport: `panelSize = min(350, viewport.width − 2×16 − 24)`. That gives 334 on a 390-wide phone and 350 when there's room. The strip and panel together are centred, and `panDistance` follows `panelSize`. Today the panel starts 40px in and runs off the right edge. Update the geometry tests: 390 → 334, a wide viewport → 350, and `format` has no effect.
> 2. **The cover strip.** The spread's left edge shows a 24px strip of the real cover art (`object-position:left`), darkening towards the spine. It replaces today's dark "‹ INSIDE" bar. `#gfLeftCue` becomes a paper chip on the strip: `--paper` on `#2B231C` ink, 28×72 visible, ≥44×44 hit area, vertical "‹ Inside" in Archivo 11/600 caps. It keeps its `aria-label`.
> 3. **Spine shading:** a 10px inner shadow down the panel's left edge.
> 4. **The mirror edge** ("Tracks ›" on the left panel) uses the same paper chip.
> 5. Check the camera pan, panel drag and `prefers-reduced-motion` against the new sizes. Opening a record, swiping left, swiping back and closing should land exactly where it started.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** equal margins; the cover on the strip; the Inside tab works; a 7″ single still opens at full size.

---

## UN8: one title, two spec lines

> Read CLAUDE.md, this plan and the README (frames `gf-1-ep`, `gf-2-lp`). Depends on UN7.
>
> 1. **No repeated title.** `#gfInfo` drops `.gf-info-title` and `.gf-info-sub` (around `src/gatefold/view.js` L1228–1229), since the panel already shows them. If the desktop wide layout still needs them, keep them for `.gf-wide` only and say so.
> 2. **Two lines.** Split `gatefoldFormatLine()` (L987) into `gatefoldFormatLines()` returning `[record, file]`:
>    - record: `10″ EP · 45 RPM · 3 tracks · 15:00`
>    - file: `2022 · Driftwood · MP3 · 44.1 kHz · lossy`
>
>    Render both centred, mono, `--fs-caption`, under the flip button. A line never starts with `·`. If a line is too long, drop the label, then lossy/lossless. The Record share card keeps its own single line.
> 3. **Tests:** both lines for an LP, an EP, a single with no year, and an overflowing label.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## UN9: "on the platter"

> Read CLAUDE.md, this plan and the README (frame `gf-1-ep`). Depends on UN0.
>
> 1. When the record is on the platter, its slot (`.gf-sleeve-disc-wrap.gf-disc-empty`) shows an **empty paper inner sleeve**. It's the same third-of-a-square size and position as the rack's sleeves, flush with the mini-player, fully visible, with a half-circle thumb cut at the top edge.
> 2. `.gf-disc-on-platter` (`11-gatefold.css` L390) becomes hand lettering: Caveat 600, `--fs-hero`, ink `#3B3229`, turned −2°, reading "on the platter" in lower case. Remove the tilted mono card styles.
> 3. Ink on paper clears 4.5:1 (`contrast.test.js`). Multi-disc: only the disc that's on the platter shows the empty sleeve.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## UN10: the back cover

> Read CLAUDE.md, this plan and the README (frame `gf-3-back`). Depends on UN3.
>
> 1. **Titles in Archivo.** `.gf-back-tt` (`11-gatefold.css` L240) uses `--body` 12px. Numbers and durations stay `--data` 11px. Titles wrap to two lines (`-webkit-line-clamp:2`) instead of "Track Numbe…". Two columns per side pair, with side headings in Antonio 700 and the side length in mono, over a thin rule.
> 2. **One menu.** Remove `.gf-back-cover-more` (button, scrim, CSS; L220–223 and markup around `miziki.html` L1485). When the record is turned over, `openGatefoldMoreMenu()` shows the back-cover items at the top: "Choose an image…", "Photograph your copy", and "Use Miziki default" (checked when active).
> 3. **Wordmark:** `.gf-back-wordmark` (L248) goes from 34 to 58px, letters `rgba(43,35,28,.78)`, rings `#B9742A`.
> 4. **Footer above the line (decision 2):** 22px bottom padding inside the frame and 10px above the footer rule. Nothing touches the frame line at any track count, including a 2-disc, 4-side back.
> 5. **Tests:** back-cover menu items appear only when turned over; the default is checked only without a custom back.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## UN11: the player and Sundown

> Read CLAUDE.md, this plan and the README (frames `2-player-light`, `6-player-night`, `7-resting`, `2-sundown`). Depends on UN2, UN4.
>
> 1. **One progress bar** (decision 21):
>    - Remove the segmented track bar (the second bar with "1 · Fieldnotes 1").
>    - The single bar gets elapsed and remaining times plus a centre caption, "Side A · 1 of 2" (or "Track 3 of 10" when sides are off).
>    - Side boundaries show as a 2px tick on the bar.
>    - Scrubbing is unchanged.
> 2. **Two spec lines** (decision 22):
>    - Line one: `{format} · {speed} · {file type} · {rate} · {lossy/lossless}`, for example "7″ · 45 · MP3 · 44.1 kHz · lossy". It drops "mono" (shown only in Track info), and "full speed" too, since it's the default.
>    - Line two shows only when the record isn't at plain full speed or wears a look: "Night · 0.80× · about 3¾ semitones lower", or "Gold". It uses `--accent-text` ink. That's printed amber, never a state colour, the same as the phase label.
>    - Remove "AFTERNOON · FULL SPEED": the phase button below already says it.
> 3. **End-of-record card** (decision 23; `paintRestingCard()`, `src/player/queue.js` L262):
>    - `#restingCard` takes the place of the spec lines and the bar, never between them and the controls. Today it pushes the transport below the bottom edge.
>    - It uses the card style from frame `7-resting`: a `.p-label` kicker ("Played through" / "Paused after this record"), "Side B · ended 7:04 PM" in mono on the right, one sentence of body, then primary "Play it again" and secondary "Back to the crate" (or "Flip to side B" when there's another side).
>    - The "Back to your queue" text link becomes that secondary button.
>    - Check at 390×664 (short iPhone) that the play button stays on screen.
> 4. **Focus header:** keep "Focus … Done" and "the record ends around 7:05 pm". "Done" becomes a secondary button, not bare text.
> 5. **Light theme player:** after UN1 everything should read. Confirm the title line, bar, play button and phase label against frame `2-player-light`.
> 6. **Sundown, Day view** (frame `2-sundown`):
>    - "Through the night" is a sheet title.
>    - Night depth is a full-width five-segment control under its label and description (not squeezed beside them).
>    - "At night, the music" is the same, with two segments.
>    - "Stop between records at sunset and midnight" is a `toggleRow`.
>    - The location note's "Use my location" button sits on its own line under the sentence. Today "pm." wraps beside the button.
> 7. **Stand-in times without location** (`standInEvents()`, `src/sundown/day.js` L196; the message in `src/sundown/location.js` L18):
>    - The fixed stand-in day is a summer day (sunset 8:10 pm). In November that makes "night" start three hours late for anyone who hasn't shared location.
>    - Replace the fixed times with a rough sun model from the device's own timezone offset and today's date, so the stand-in is in the right season. Use a latitude guess of 40°, with no location needed and none stored.
>    - The note reads "Location is off, so tonight is a stand-in: sunset about {time}." Keep the real cached times when present.
>    - Add unit tests for a June and a December date.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** play a record through to the end (card + controls visible); Focus on and off; the player at night; Sundown at night with location off (sunset time looks right for the season).

---

## UN12: one profile header

> Read CLAUDE.md, this plan and the README (frames `3-profile`, `3-listening`, `5-wall`). Depends on UN2.
>
> 1. **Header** (decision 12):
>    - The profile's top bar (`miziki.html` L85 area: the tiny wordmark, `#hdrProfileRefreshBtn`, `#hdrProfileSettingsBtn`) becomes the hand-lettered plate "[username]'s crate" on the left (as decided Nov 4) and a gear icon button (`aria-label="Settings"`) on the right.
>    - "Refresh" goes; pull-to-refresh (`25-pull-refresh.css`) does the same job on the profile home.
>    - Signed out with no username, the plate reads "your crate".
> 2. **Sub-screens:** `renderProfile()` (`src/profile/screens.js` L94) hides the top bar whenever `screen !== 'home'`. `#profileCrumb` becomes `backHeader('Profile', labels[screen])` (L97 labels). Rename the labels to sentence case: Top albums, Top songs, Played through, Records, Account, Privacy, Privacy policy, Terms of use, Settings. One header per screen, everywhere.
> 3. **Profile home sections:** "On the wall" and "The shelves" use `.p-label`. The hand-lettered captions stay. The display-name row stays (record avatar, name, @handle, Edit secondary button), with the handle under the name rather than above the row.
> 4. **The Pressings & metals row** (decision 14; `storePressingsTeaserRow()`, `src/profile/records.js` L210) becomes a `navRow` with the little disc dots kept, the label "Pressings & metals" and the value "Everything you've found, newest first". No counts.
> 5. **The "local preview" note and Privacy button** at the bottom of the signed-out profile become one `navRow` ("Privacy") plus a single muted line ("Sign in from Home to add friends and sharing.").
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## UN13: Listening, Records and the lists

> Read CLAUDE.md, this plan and the README (frames `6-listening-data`, `6-records`, `2-artist`). Depends on UN12.
>
> 1. **Listening** (`renderListeningScreen`):
>    - The season header keeps its arrows as 44px icon buttons, with the season name in the screen title style.
>    - "Most spun" shows up to three covers in a row (not one centred cover).
>    - The links read "Top albums ›" and "Top songs ›" (today "Top records ›" opens a screen titled "Top Albums"; `screens.js` L604).
>    - Card labels use `.p-label`, not mono caps.
>    - "Share crate" becomes "Share this season", a full-width secondary button. It's the Season card, which is what this screen shows.
> 2. **Played-through captions** (`playedThroughLine()`, L438): Archivo 13 muted, sentence case, one line: "Whole record · afternoon · Mon 9 Nov". Today it's mono caps that wrap ("MON 9 / NOV"). Same on the Played through screen.
> 3. **Top albums and Top songs** use the same unit. Top albums says "1 play" / "3 plays" (album plays), not "1 session" (`screens.js` L714), matching Top songs.
> 4. **Records** (`renderRecordsScreen`, `records.js` L234):
>    - The filter is a `segmented` "All records | Pressings", with no counts (decision 14; today "All · 14 / Pressings · 1", L244).
>    - The "14 RECORDS" line (`recordsCountLine`) stays only on "All records", in Archivo 13 muted.
>    - The grid is three across on phones (two today, leaving half the row empty), four or more on desktop by width.
>    - Letter dividers use Antonio 700 20px muted.
> 5. **Artist page** (beyond UN3's header and menu):
>    - Records show as a captioned grid (cover, title, "2019 · 12″ LP").
>    - "Your pressings" discs get the paper centre label (Nov 7 decision, `paper_disc` look from plan 33); today they're plain black.
>    - **The unlabelled brown bar under the buttons:** find what it represents. If it's a listening or wear measure, label it in Archivo 13 ("Listened to most at dusk", or whatever it measures). If it's decorative, remove it. Ken decides in review (open item).
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## UN14: the wall

> Read CLAUDE.md, this plan and the README (frames `5-wall`, `5-wall-light`, `6-wall-one`). Depends on UN12.
>
> 1. **Headings:** "On the wall" uses `.p-label`; "in rotation" and "pressings, found while listening" stay hand-lettered; "All found ›" is Archivo 14/600 in `--paper` with a chevron (readable in light theme).
> 2. **The pressing cubby** (decision 18) is built as one piece, as plan 33 intended: posts, rails, grained back panels and an inner shadow, with **as many sections as there are found pressings or metals, up to three.** Each section holds one disc on a clear stand, with name and `PHASE · DATE` captions beneath.
>    - Today one find draws a full-width box with a small disc in the middle, and three finds draw three separate boxes with gaps.
>    - No empty sections or placeholders (Oct 31 decision).
> 3. **Captions:** if a record has no phase saved (older finds), the caption is just the date. Never a leading "·" (today "· 9 NOV").
> 4. **Paper labels** on every wall disc, unchanged from plan 33.
> 5. **Tests:** cubby section count for 0/1/2/3/5 found (0 hides the cubby and shows "Play an album start to finish…" in muted Archivo); caption with and without phase.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## UN15: the shelf and the turntable

**See also: docs/37_COLOUR.md.**

> Read CLAUDE.md, this plan and the README (frames `5-shelf`, `5-turntable-picker`). Depends on UN6 (`spineColor()`), UN12.
>
> 1. **Duplicate spines (bug).**
>    - `shelfItemsFromCrate(crateFlatAlbumOrder(S.crateGroup))` (`src/profile/storefront.js` L653/L776) takes the crate's sections in a row: A–Z, New arrivals and In rotation.
>    - Any record in more than one section gets one spine per section. 14 albums drew 38 spines in testing.
>    - Fix it by de-duplicating by `albumId`, keeping the first appearance.
>    - Unit test: an album in three sections yields one item.
> 2. **Spine colour** (decision 16):
>    - `cubeSpine()` (`src/profile/shelf-unit.js` L63) stops using the cover image as `background-image`, which squeezes busy covers into stripes. It paints `spineColor(dominant)` instead, with a 7px darker band at the top (the same hue × 0.62) and a 1px right-edge shadow.
>    - The colour comes from `art-color.js`, cached per album.
>    - No art → the record's own pressing colour (`pressingKey` → the drawn variant's base colour), so it's the same on every device.
>    - **Height by format:** 12″ 92%, 10″ 80%, 7″ 70% of the cube's inner height.
> 3. **Rows that grow** (decision 17):
>    - `renderShelfUnit()` renders `rows = clamp(ceil(cubesNeeded / 2), 1, 3)`, not a fixed 6 cubes.
>    - `cubesNeeded` counts face-out cubes plus spine cubes at the existing `CUBE_CAPACITY` of 10.
>    - Only the last open cube gets the "room to grow" note.
>    - The "Browse all" link still appears when the crate is bigger than three rows.
>    - The unit's aspect ratio follows its row count, so the layout percentages in `18-storefront.css` become per-row values. Update the shelf unit tests (`shelfUnitCubes`) for 1, 2 and 3 rows.
> 4. **Turntable size:** the turntable on top of the unit scales to about 115% of today (`renderTurntable` container, `turntable.js`). The sleeve stand beside it stays the same, and the turntable and sleeve keep their bottoms aligned on the top plank.
> 5. **Turntable picker** (`src/profile/turntable-sheet.js`):
>    - The selected deck's name and note sit directly under the preview, not after all 12 cards.
>    - Cards use `--field` with a `--line` border; the selected card has a 2px `--paper` border (visible in light theme).
>    - Deluxe models carry a small "DELUXE" badge on the card.
>    - Locked decks (not yet found by listening) show a muted card with "Found by listening".
> 6. **Shelf finish sheet:** the selected swatch ring uses `--ring`, 2px. No other changes; it looked right.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus:** a library of about 15 records: one spine each, colour spines, two rows, the turntable a touch larger; the picker in light theme.

---

## UN16: a friend's crate

> Read CLAUDE.md, this plan and the README (frame `7-friend-crate`). Depends on UN14, UN15.
>
> 1. **Same layout as yours** (decision 20). `openFriendStore()` (`src/social/screens/friend-store.js` L78) renders the following, all with the parts from UN2:
>    - `backHeader('Home', '')`, then the plate "{handle}'s crate"
>    - name, bio and the Follow/Following button
>    - the wall (their in-rotation ledge and their pressing cubby)
>    - the shelf unit in **their** finish and turntable (already synced in docs/32 ST6)
>    - "You both have", "Fresh for you", "Digging list" and "Held for you" below the shelf, with `.p-label` headings instead of the Antonio-caps `store-section-head h2`
> 2. **Wording:**
>    - The nav title "Browsing crate" (L74, L87) goes; the plate says whose crate it is.
>    - "Recently at the counter" becomes "Lately". "Counter" is store language, and the crate isn't a store (Nov decision).
>    - The stat row (Records · In rotation · In common) stays: they're their library counts, not pressing counts.
> 3. **No-art fallbacks:** friends' cover art isn't on your device. In testing their shelf looked empty (blank spines) and their in-rotation covers were blank squares.
>    - **Spines:** use their record's pressing colour (UN15).
>    - **Covers:** a printed title cover in the album's tint (or pressing colour), with the title in Antonio 700 and the artist in Archivo, bottom-left.
>    - Use the same helper everywhere a friend's record shows (wall, shelf, Fresh for you, Digging list, Held for you).
> 4. **Their Pressings card:** show only what they've found. No unfound chart cells, per the no-placeholders rule (Oct 31). Today it shows the whole chart. Confirm against plan 33's card and say what changed.
> 5. **Friend-count stickers** stay on face-out records you don't own, as today.
>
> Lint and unit tests pass, and both builds preview with no console errors, using `?social=demo` in dev. Open the PR with the preview link at the top. Do not merge.

---

## UN17: desktop

> Read CLAUDE.md, this plan and the README (frames `4-desktop-profile`, `5-desktop-wall`, `6-desktop-gatefold`, `6-desktop-settings`). Depends on UN11–UN16.
>
> 1. **Sidebar** (`23-desktop.css` and the sidebar builder):
>    - It's `position:sticky`, so it doesn't scroll away with the page (today it does, on profile pages).
>    - "Crate" becomes "Profile" (decision 13).
>    - Bin rows are one line each, "45s · 7″ · 10″" with the value right-aligned ("13 records"). Today the label wraps into a stack and reads "1 RECORDS · 45 RPM".
>    - Fix the plural ("1 record").
>    - Section labels use `.p-label`.
> 2. **Content width:**
>    - Settings, Listening, Records, Privacy, Account and Terms centre in a `max-width: 640px` column. Today Settings' rows and segments stretch about 1,100px, with switches far from their labels.
>    - Records' grid can go wider (`max-width: 1000px`).
> 3. **Profile** (frames `4-desktop-profile`, `5-desktop-wall`):
>    - Two columns: the wall on the left (≤420px) and the shelf on the right.
>    - The header plate and gear sit across the top, with name and rows under the wall.
>    - The wall's ledge covers are 118px and the cubby sections match the shelf's cube size, so the two read at the same scale. Today the ledge covers run the full width at about 180px each, and the cubby is huge.
>    - The page background is one surface, with no band under the sidebar.
> 4. **Gatefold** (frame `6-desktop-gatefold`): the open spread (both panels) is centred in the content area at its full desktop size. The two spec lines and the actions (primary "Play the record", secondary "Turn it over") sit centred beneath it. Today the spread sits small in the top-left with about two-thirds of the screen empty.
> 5. **Player:**
>    - With the full player open, the bottom bar keeps the whole transport row or hides entirely; it never shows a lone volume slider. Hide it, since the player has its own controls, and keep volume in the player's right column.
>    - The side panel's empty states use UN5's notes.
>    - The Queue button opens the side panel's "Up next" tab rather than a second queue modal on top of it.
> 6. **Crate:** the current record draws larger (up to 360px) when the window allows, and the info card is capped to the record's width plus 40px instead of spanning the whole content area.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

---

## UN18: the sweep

> Read CLAUDE.md and this plan. After UN1–UN17 have merged.
>
> 1. **Walk every screen** at 390×844, 390×664 (short iPhone) and 1440×900, in both themes, before and after sunset, with Larger text on and off. The README in `docs/design/uniformity/` lists the screens; the test-setup notes below say how to reach each one. Nothing should be clipped, overlapped, cream-on-cream, or outside the parts.
> 2. **Delete the aliases from UN2** (`.seg`, `.cta`, `.cta.ghost`, `.edit-close`, `.crumb-back`, `.store-section-head h2`, `.sd-*-seg`, `.share-style-chip`) once nothing uses them. Also delete any CSS selector with no matching element (`grep` each), and any token no longer referenced.
> 3. **Grep for leftovers:**
>    - `color:var(--cream)` outside the allow-list
>    - `#2A1B38` as a gatefold background
>    - `.gf-back-cover-more`, `#libOverflowMenu`, "Browsing crate", "Recently at the counter", "Don't share this session", "Top records"
>    - Title Case menu labels
>    - `Pressings ·` and `PRESSINGS` count strings
> 4. CHANGELOG entry for plan 36.
>
> Lint and unit tests pass, and both builds preview with no console errors. Open the PR. Do not merge.

---

## Found while testing, not polish (check on device)

These came up during the walk-through. They're behaviour, not look, so they're not in a PR above. Each needs checking on Ken's iPhone first:

1. **Account screen while signed out** showed "Sign out" and "Sign out everywhere". This was seen in `?social=demo`, so it may be a demo-only state. If it reproduces in the real build, those buttons should only show when signed in.
2. **The library went empty once** after unsealing a record while an import was still running. It showed "No music loaded yet" with the import mid-way. Not reproduced. Worth one deliberate try: import a folder, then unseal a record before the import finishes.
3. **"Record look…" never appeared** in the gatefold ⋯ menu, even with a metal added to the album in the test setup. The test may not have set the state `hasLookChoice()` reads. Check on device with a record that has really earned a second look.
4. **The booklet viewer** didn't open after adding three images through "Add booklet pages…" in the test setup. Check on device.
5. **After a reload, the launch intro showed records, then the library said "No music loaded yet."** This is probably an artefact of how the test browser handled the files (picked files don't persist there). Confirm on the home-screen app.

---

## Test-setup notes (how this was checked)

For whoever repeats the walk-through (UN18):

- **Serving without Vite:** a small static server over the repo root that:
  - answers `*.svg?raw` imports with `export default "<file text>"`
  - rewrites `import.meta.env` to `{DEV:true, BASE_URL:'/'}` in served `.js`
  - points `'@supabase/supabase-js'` at a do-nothing stub module.

  `npm run dev` does all of this properly when installs are allowed.
- **Test library:** tagged MP3s made with ffmpeg (`-metadata album/artist/track/date`, cover via `-disposition:v attached_pic`). Use 2-track 20-second albums so a whole record plays through in about 40 seconds.
- **Seeding** (from the page, via dynamic `import()` of the real modules):
  - `breakSeal()` for sealed records
  - `S.achievements` / `S.collection` for metals and pressings
  - `S.turntablesFound`, `S.deluxe = true`
  - `MizikiSocial.pin(albumId)`
  - `S.profileView.screen = '…'` + `renderProfile()` for sub-screens
  - `selectSundownView('sound')`
  - `toggleFocus()`
  - `S.resting = {…}` + `paintRestingCard()`
  - `setTheme()` / `applyLargerText()`
- **Night:** Playwright `context.clock.install()` at 11:30 PM local, `timezone_id: 'America/New_York'`.
- **Social:** `?social=demo`. `beginSocialSignIn()`, then any email and code `123456`, then a handle; then `openFriendStore('june')`.
- **Clicks:** some buttons only respond to a real `element.click()` from the page, not a synthetic pointer click from outside. The gatefold long-press needs `PointerEvent`s with `pointerType:'touch'`.
