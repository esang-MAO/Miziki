# Miziki Desktop Layout: Claude Code Handoff

Oct 13, 2026 · @Ken Ndiang

## Goal and scope

Ship the desktop layout from the [mockup](https://claude.ai/artifact/D9AhvQ7oYjDBLWhtkxX1pY) as a responsive mode of the existing web app, with an Auto, Light and Dark appearance setting, and leave the phone experience exactly as it is.

**In scope**

- A desktop mode at 1024 px and wider: left sidebar, main area, persistent player bar, and a side panel on Now playing.
- A light theme and a dark theme driven by tokens, chosen by an Auto/Light/Dark preference. Auto follows the device.
- The three mockup screens: Library, Now playing and Crate profile.

**Out of scope**

- The native iOS app, Supabase or schema changes, and any new social features. The Home tab stays hidden until social is on.
- Tablet widths between 768 and 1023 px. They keep the phone layout for now.

**What in the mockup is placeholder.** Album and artist names, the handle, the stats, the digging list entries and the sunset time are sample content. The light palette is my proposal, not something taken from the app. Two things in the mockup do not exist in the app today: the playlists list and Sundown card in the sidebar, and the tabbed side panel on Now playing.

## Constraints from the codebase

These come from CLAUDE.md and apply to every PR in this plan.

- **One feature per PR.** Refactor PRs change no behavior. Below the desktop breakpoint, the phone layout must render identically.
- **Deploy path.** The app stays at `/Miziki/miziki.html`. Check both builds: `npm run build` and `MIZIKI_BASE=/ npm run build`.
- **Lint and tests.** `npm run lint` runs with `--max-warnings=0`, and `npm run test:unit` must pass. A new unused variable fails CI.
- **No inline script, no new hosts.** The CSP allows only same-origin scripts, so a pre-paint theme script has to be an external file. Fonts are already self-hosted in `src/fonts/`. The mockup links Google Fonts for convenience; the app must not.
- **Styles load in numeric order.** Add new files as `21-...css` onward in `src/styles/` and link them in `miziki.html` after the existing ones.
- **New saved setting rule.** Add it to both `serializePrefs` and `parsePrefs` in `src/storage/prefs.js`, give it a default in `src/state.js`, and add a test in `tests/unit/prefs.test.js` that an old saved object still loads.
- **Backup table.** Every new saved key must be classified in the key-inventory table in CLAUDE.md. `prefs` is backed up with last-write-wins, so the theme choice would sync between devices unless excluded.
- **Wiring lives in `src/wiring/`.** Event listeners go in the matching `wireX()` file. No module may import from `main.js`.
- **iOS audio rules.** Do not touch the order of `await`s in `play()` or the sheet, pull and hand-off sequences. Desktop work is layout and CSS around them.
- **Tag text never reaches `innerHTML`.** The lint rule enforces this. Build credits, track names and sleeve notes with `textContent`.
- **Duplicate element ids are not allowed.** The full player owns `#play`, `#prev`, `#next`, `#scrub` and the rest. A desktop player bar must reuse or restyle those, not clone them.

## Light and dark theming

The app has one palette today: tokens in `:root` in `src/styles/00-base.css`, plus dark colors written directly into several rules (the body gradient, the mini-player and tab bar backgrounds, the player overlay gradient, and `<meta name="theme-color" content="#0F1A20">`). Theming means moving those literals onto tokens, then defining a second set.

**Tokens.** Keep `--sky1`, `--sky2`, `--paper`, `--muted`, `--line`, `--panel`, `--amber` and `--accent` as they are, so nothing else needs renaming. Add the ones below. Values are from the mockup; every text pair clears 4.5:1 (tightest: muted on the darkest light ground at 4.56).

| Token | Dark | Light | Used for |
| --- | --- | --- | --- |
| `--sky1` / `--sky2` / `--sky3` | #1D2F38 / #101A20 / #07080C | #F6F1E7 / #ECE5D8 / #E0D8C7 | Ground gradient. `--sky3` is new; today `#07080C` is a literal |
| `--paper` (text) | #EFE9DF | #15232B | Primary text |
| `--muted` | #94A0A6 | #4F616A | Secondary text |
| `--line` | rgba(239,233,223,.14) | rgba(21,35,43,.16) | Borders and dividers |
| `--panel` | rgba(10,14,18,.42) | rgba(255,252,246,.55) | Sidebar and side panels |
| `--chrome` (new) | rgba(10,14,18,.9) | rgba(246,241,231,.92) | Mini-player, tab bar, player bar |
| `--raised` / `--field` / `--sel` (new) | rgba(239,233,223,.04) / .06 / amber .14 | rgba(255,255,255,.55) / rgba(21,35,43,.06) / rgba(154,71,0,.12) | Cards, inputs, selected rows |
| `--accent` | #FF9E2C | #FF9E2C | Fills: play button, selected segment |
| `--accent-text` (new) | #FF9E2C | #9A4700 | Amber used as text or a thin line |
| `--on-accent` (new) | #2A1B38 | #2A1B38 | Text on amber fills |
| `--shadow` (new) | rgba(0,0,0,.45) | rgba(21,35,43,.22) | Drop shadows |

In the CSS, `--paper` is the text color, so keeping its name means existing text rules need no edits. The catch: `18-storefront.css` also uses `var(--paper)` as a surface (the awning's cream stripes and the sticker). Grep every `var(--paper)` used as a `background` and move those to a new `--cream` token that stays cream in both themes (#EFE9DF dark, #FFFDF8 light). The disc, sleeve art, metal tiers and the share-image styles (Night, Cover, Paper) keep their own colors in both themes. Only chrome changes.

**Selectors.** Dark stays on bare `:root`, so existing behavior is untouched. Light is defined in three places: `:root[data-theme="light"]`, `@media (prefers-color-scheme: light) { :root:not([data-theme]) { ... } }` for Auto, and `:root[data-theme="dark"]` re-asserting dark so a pinned choice beats the device. Set `color-scheme` to match so native controls follow.

**The preference.** Add `S.theme`, one of `auto`, `light` or `dark`, saved with the other prefs. A new `src/ui/theme.js` exports `applyTheme()`. It sets `document.documentElement.dataset.theme` (removed for Auto), updates the `theme-color` meta tag, and while Auto is active listens to `matchMedia('(prefers-color-scheme: light)')` so the app follows the device live, for example at sunset. `applyPrefs()` calls it on load and the control calls it on change. Auto needs no JavaScript at first paint because the media query does the work.

**Avoiding a flash.** A pinned Light or Dark is stored in IndexedDB, which is read after first paint. Mirror the choice in `localStorage` and read it from a small external classic script in `<head>`, which the CSP permits. Wrap both in try/catch, since storage can be blocked.

**Where the control lives.** A Character-menu row on phones, and the three-way segmented control at the bottom of the desktop sidebar. Both call the same function.

## Desktop shell

The phone layout is built from a 520 px column (`.wrap`) with a fixed bottom tab bar and a fixed mini-player, both capped at 520 px. The desktop mode reuses the same markup and routes, and changes how they are laid out.

- **Breakpoint.** `@media (min-width: 1024px)` turns on desktop. Under 1024 px nothing changes. Put these rules in new files so they can be reviewed apart from the phone CSS.
- **Sidebar from the tab bar.** The existing `.tabbar` buttons (`data-route="library"`, `home`, `sundown`, `character`, `profile`) become a vertical sidebar. Keep the same buttons and `wireRoutes()`, so routing needs no JavaScript change. At 1280 px and wider it is 232 px with labels; from 1024 to 1279 px it is a 76 px icon rail.
- **New sidebar content.** The playlists list, the Sundown summary card and the appearance control are new DOM. Build the playlists list from `S.playlists` with `textContent`. Reuse the Sundown readout that `drawSun()` already writes rather than computing it twice.
- **Main area.** Drop the 520 px cap on `.wrap` and let the routes fill the space beside the sidebar. The header's search field and `+` menu move into the main header row.
- **Player bar.** On desktop the mini-player becomes an 88 px bar across the bottom: now playing on the left, transport and seek in the middle, mode, queue and volume on the right. It must drive the existing playback functions, not a second set of controls.
- **Full player.** `.player-overlay` is a fixed full-screen sheet that slides up. On desktop, position it over the main area only, between the sidebar and the player bar, with no slide, and open it through the same `openPlayer()`. The sheet, pull and hand-off sequences keep their order.
- **Platter size.** `.platter-stage` is `min(72vw, 278px)`. The mockup uses 520 px. Drive it with a CSS custom property so JavaScript that reads the size still works.
- **Pointer and keyboard.** Spin-to-scrub already uses pointer events, so a mouse works. Add visible `:hover` and `:focus-visible` states, and keep the existing Escape handler. Space to play and pause and arrow-key skipping are worth adding later, but are not part of this plan.

## Screen by screen

Each mockup screen maps onto code that already exists. The work is mostly CSS and composition, with a small amount of new DOM.

| Mockup screen | Existing code to reuse | New |
| --- | --- | --- |
| Library (crate and record detail) | `renderCrate` and `flowPose` in `src/crate/`; `buildGatefoldTracklist`, `gatefoldTrackIndices` and `gatefoldSideSplits` in `src/gatefold/view.js`; sealed-record and metal data | Inline detail panel beside the crate; larger crate stage driven by CSS variables; Crate order toggle in the tab row |
| Now playing | The full-player overlay and its controls; queue sheet (`player/queue.js`); credits sheet and `albumLinerNotes` (`library/credits.js`) | A side panel that hosts Up next, Liner notes and Credits; a larger platter; the sleeve behind the disc |
| Crate profile | `renderProfile`, the storefront primitives in `src/profile/storefront.js`, `topAlbums`, `topTracks`, `collectionGroups` | A two-column grid: top records and digging list on the left, collection and now spinning on the right |

**Library.** The crate should keep its geometry. Scale the card size and stage height through CSS variables and read them in `renderCrate`, so the A to Z rail, the jump bubble and keyboard control carry over. On desktop, tapping a record shows its detail in the right panel instead of opening the gatefold overlay. The gatefold stays for phones. A sealed record still opens the sealed sheet, as today.

**Now playing.** On desktop the platter and sleeve sit on the left, the title block and transport on the right of them, and the side panel in a third column. The Up next, Liner notes and Credits tabs call the same render functions the sheets use, targeted at the panel instead of an overlay. Pure and Vinyl, Scratch and the Sundown readout stay where the mockup puts them.

**Crate profile.** The mobile tab is labelled Profile and the route is `profile`; the mockup calls it Crate, which matches the naming decision in the project notes. Keep the route id, change only the visible label on desktop if you agree. The awning, avatar disc, stats and metals row already exist and only need the wider grid.

**Sample content.** None of the mockup's sample names, counts or the handle should reach the code. Everything renders from `S`, the library and the profile.

## PR order

Seven PRs, each mergeable on its own. Do them in this order, since each builds on the one before.

1. **D1, tokens only.** Move every hard-coded dark color onto a token, add `--sky3`, `--chrome`, `--raised`, `--field`, `--sel`, `--accent-text`, `--on-accent`, `--shadow` and `--cream`, and make `theme-color` a variable. No visible change; compare before and after screenshots of every route.
2. **D2, light theme and the preference.** Add the light token set, `S.theme` with its `serializePrefs` and `parsePrefs` entries, `src/ui/theme.js`, the `localStorage` mirror and head script, and the Character-menu row. Tests included.
3. **D3, desktop shell.** Breakpoint, sidebar from the tab bar, main-area width, and the playlists and Sundown cards. CSS plus a small render function for the sidebar.
4. **D4, player bar.** The bottom bar on desktop, wired to the existing playback functions. No change to `play()`.
5. **D5, Library on desktop.** Crate scaling through CSS variables and the inline record detail panel.
6. **D6, Now playing on desktop.** The overlay as a main-area view, the larger platter, and the side panel.
7. **D7, Crate profile on desktop,** plus the appearance control at the foot of the sidebar.

If D5 or D6 turns out larger than expected, split it. A PR that touches the gatefold, the crate and the overlay together would be too hard to review.

## Tests and verification

**Unit tests** (`npm run test:unit`)

- `prefs.test.js`: `theme` round-trips; a saved object without it loads as the default; an unlisted value such as `"sepia"` is ignored.
- A new `theme.test.js`: `applyTheme('light')` sets the attribute, `'auto'` removes it, the `theme-color` meta tag changes, and a `matchMedia` change event updates the app only while Auto is on. Stub `document` and `matchMedia` the way `shell.test.js` and `launch.test.js` stub their globals.
- A sidebar render test for the playlists list that feeds a playlist name containing `<img src=x onerror=alert(1)>` and asserts it appears as text.

**Browser checks** (Playwright, both builds, as the earlier steps did)

- Load at 1440 x 900 and at 390 x 844, in light and in dark, using Playwright's `colorScheme` emulation. Compare each route against the matching mockup artboard.
- Switch to Auto and flip the emulated device scheme while the page is open; the app must follow without a reload.
- No horizontal scroll at 1024 px, and no overlap between the sidebar, content and player bar.
- Zero console errors and zero CSP violations on every route. Open the gatefold, a sealed record, the queue and the share sheet in both themes.
- Confirm a pinned Light or Dark does not flash the other theme on reload.

**Phone regression.** For D1 to D2, a before and after screenshot of each route at 390 px should match in dark. For D3 onward, the phone layout must be pixel-identical, since the new rules sit behind the breakpoint.

**Gates.** `npm run lint` with zero warnings, both builds, and the full unit suite.

**Device checklist.** Run the existing iPhone checklist in CLAUDE.md after D2 and again after D7. Add two checks: toggling the iPhone between Light and Dark with the app on Auto, and the status bar color in each.

## Open questions and the Claude Code prompt

Decide these before D2. Each has a default, so Claude Code can proceed if you do not answer.

- [ ] **Default for existing users.** With Auto as the default, anyone whose device is set to light mode sees the app turn light after the update. The alternative is to default to Dark until the user chooses. Default in this plan: Auto for new installs, and a saved prefs object without `theme` also loads as Auto.
- [ ] **Sync across devices.** `prefs` is backed up, so a pinned choice on a laptop would follow the account to the phone. Device-only is arguably better for an appearance setting. Default: device-only, listed as such in the CLAUDE.md key-inventory table.
- [ ] **Light palette.** The light values are mine. Check them on the real screens before D2 merges.
- [ ] **Record detail on desktop.** Inline panel (as in the mockup) or keep opening the gatefold. Default: inline panel, gatefold stays on phones.
- [ ] **Tablets, 768 to 1023 px.** Default: phone layout, unchanged.
- [ ] **Sidebar extras.** The playlists list and the Sundown card are new. Cut them if you want a smaller first release.

**How to use this.** Export this doc as Markdown, save it in the repo as `docs/DESKTOP_LAYOUT.md`, attach the mockup screenshots, and paste the prompt below into Claude Code from the repo root. Then run one PR at a time.

```text
Read CLAUDE.md and docs/DESKTOP_LAYOUT.md in full before doing anything.

We are adding a desktop layout and an Auto/Light/Dark appearance setting to Miziki, as described in that doc. The doc lists seven PRs, D1 to D7. Do only D1 now: move every hard-coded dark color onto tokens, add the new tokens with their dark values, and make the theme-color meta tag a variable. This PR must not change anything visible.

Follow the refactor rules in CLAUDE.md: one change per PR, no behavior change, lint with zero warnings, unit tests passing, and both builds working (npm run build and MIZIKI_BASE=/ npm run build). Before you start, list every file and rule that holds a literal color, and every place var(--paper) is used as a background. Do not rename existing tokens.

Verify with Playwright at 390 x 844 in dark: take before and after screenshots of each route and confirm they match. Report the lint result, the test count, and the screenshot comparison. Stop after D1 and wait for me before starting D2.
```
