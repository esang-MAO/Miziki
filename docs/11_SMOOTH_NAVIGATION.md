# 11 · Smoother navigation

**Goal:** moving around Miziki should feel instant and steady. Tabs keep your place, Back always does what you expect, screens never flash blank, and long libraries scroll without stutter.

## What the audit found (Oct 14)

1. **No Back.** Nothing uses the browser history (`pushState`/`popstate`). On Android and desktop, Back leaves the app instead of closing the open sheet, album or player. Only the gatefold closes on Escape; none of the ~10 sheets do.
2. **Tabs don't keep your place.** The whole page is one scroller (`body`), and tab switching just toggles `display` (`showRoute` in `src/shell/routes.js`). No scroll position is saved anywhere. Switching tabs can land you halfway down the new tab, and coming back to Library loses where you were.
3. **Home and Profile blank out on every visit.** `renderHome()` clears its container and then waits for the network, showing "Loading…" each time. `renderProfile()` wipes and rebuilds its whole body, so images re-decode and the layout jumps.
4. **The library is rebuilt from scratch on every change.** `renderTracks()` empties `#libBody` and rebuilds every row, and 47 places call it, including starring a favorite or editing one title. On a big library that's a visible hitch, and the scroll position jumps.
5. **The sky repaints about 4 times a second for no reason.** `drawSun()` (every 220 ms) rewrites `--sky1`/`--sky2` even when the colors haven't changed. Each write repaints the full-screen fixed gradient behind everything, a classic cause of scroll stutter on iPhone.
6. **Tab switches are hard cuts, and taps feel dead.** Few controls have a pressed state, iOS shows its grey tap flash, and sheets and the player can't be swiped down to close.
7. **No way to refresh Home or Profile by hand.** The home-screen app has no built-in pull to refresh, so the only way to see a friend's new spin is to leave and come back. NV4 adds pull to refresh on those two tabs.

## The plan: six PRs, in this order

Each PR has the usual routine (preview, merge, after-merge check). **NV1 measures first**, so every later PR proves its improvement with numbers instead of feel.

---

### NV1: measure, plus three quick wins

> Read CLAUDE.md first. This PR sets a **navigation performance baseline** and fixes three cheap problems.
>
> 1. **Measurement harness** (`tests/perf/nav.perf.js`, run with `npm run perf`; not in CI, since timings vary):
>    - Use Playwright with CPU throttling at 4× to approximate an iPhone.
>    - Load a synthetic library of **2,000 tracks / 180 albums**, generated in the test with no real audio.
>    - Measure: time from tab tap to the next painted frame, for each tab; long tasks (>50 ms) during a 5-second library scroll; time to open and close the gatefold, the player and the queue sheet; and frames dropped while the Sundown sky is live.
>    - Write results to `docs/perf/BASELINE.md`. Every later NV PR re-runs this and adds a before/after table to its description.
> 2. **Sky writes only on change.** In `drawSun()`, keep the last written `--sky1`/`--sky2` strings and skip `setProperty` when they're identical. Also remove `transition: background 1.2s` from `body`, which does nothing for gradients, and check whether `background-attachment: fixed` is still needed; if a fixed-position background layer behind the content gives the same look, use that, since it's cheaper to scroll over.
> 3. **Tap feel:** add `-webkit-tap-highlight-color: transparent` globally, and a consistent pressed state (the existing `:active` tint) for tab-bar buttons, library rows, crate cards, segmented buttons and CTAs. Keep `touch-action: manipulation` on tappable controls, so a double-tap doesn't zoom.
>
> No behavior change beyond those. Lint and tests pass; both builds preview cleanly. Do not merge.

**Preview focus (Ken, iPhone):** scroll a long library while Sundown is live: is it steadier? Taps show a pressed state and no grey flash.

---

### NV2: Back works everywhere

> Read CLAUDE.md first. This PR gives Miziki **one navigation stack**, so Back (Android, desktop, the browser button, Escape on a keyboard) always closes the top thing first.
>
> 1. **`src/shell/nav-stack.js`:** a small layer manager. `openLayer(id, close)` pushes a history entry (`history.pushState({layer:id})`) and records how to close it; `popstate` closes the top layer. Closing from the UI (an × or a scrim tap) calls `history.back()`, so the entry and the UI stay in sync. It also handles Escape.
> 2. **Register every overlay:** the player overlay, gatefold, sealed sheet, queue, credits, edit sheet, record sheet, share sheets, sleep timer, duplicate dialogs, search field, add menu and the Profile › Settings / social sub-screens (`socialNav`). Opening one from inside another stacks correctly; Back closes them one at a time.
> 3. **Tabs:** switching tabs uses `replaceState` (no history entry per tab, so Back doesn't walk back through every tab you touched). One exception: from any non-Library tab, Back with nothing open goes to Library, then a second Back leaves the app as normal.
> 4. **Focus:** when a layer opens, move focus into it; when it closes, return focus to what opened it. While open, the content behind it is `inert`.
> 5. **iOS rules unchanged:** `pushState` is synchronous, so it's safe inside tap handlers. Never `await` before `bgPrime()`/`play()`. The player open path must keep its exact order.
> 6. **Tests:** layer push/pop order; Back closes the top layer only; × and Back don't double-close; Escape works; a stale `popstate` with no layers open is a no-op; reloading with a layer entry in history doesn't open a broken state.
>
> Lint and tests pass; both builds preview cleanly; NV1's numbers show no regression. Do not merge.

**Preview focus:** on desktop or Android, open an album, then the queue, then credits; Back closes them one at a time. On iPhone everything closes as before, and Escape works on a keyboard if you have one.

---

### NV3: tabs keep your place, and the list never jumps

> Read CLAUDE.md first. This PR makes **scroll position stable**.
>
> 1. **Per-tab scroll memory:** in `showRoute`, save `scrollY` for the tab you're leaving, and restore it for the tab you're entering (top on first visit). Do the same for Sundown's Day and Sound views, and for the crate's horizontal position if it isn't already saved. Set `history.scrollRestoration = 'manual'`.
> 2. **Stable re-renders:** before `renderTracks()` rebuilds, record the first visible row's track id and its offset; after, scroll so that row sits at the same offset. Keep keyboard focus on the same track if it had focus.
> 3. **Targeted updates for small changes** (the most frequent of the 47 call sites): starring a favorite, a play count changing, the now-playing marker, and a single-track edit update just that row (`updateTrackRow(id)`) instead of rebuilding the library. List which call sites you converted and which still need a full render, with reasons.
> 4. **Tests:** scroll memory per tab and view; anchor-preserving re-render (fake DOM metrics); `updateTrackRow` updates the right row and nothing else.
>
> Lint and tests pass; preview clean; NV1 numbers improve or hold. Do not merge.

**Preview focus:** scroll far down Library, switch to Sundown (top), then back to Library (exactly where you were). Star a song mid-list: nothing jumps.

---

### NV4: Home and Profile appear instantly, plus pull to refresh

> Read CLAUDE.md first. This PR makes **Home and Profile render once and refresh in place**, and adds **pull to refresh** on both tabs.
>
> 1. **Home:** keep the last rendered feed (in memory, plus a small device-only cache in `localStorage`: the feed items only, no tokens, cleared on sign-out and account deletion). Show it **immediately** on entry, then refresh in the background and patch only what changed. "Loading…" appears only on the very first load ever; afterwards use a quiet "Updating…" hint. Prefetch the feed once after launch, when the app is idle.
> 2. **Profile:** build once; on later visits, update only the parts whose data changed (stats, rhythm card, avatar), and never wipe the body. Images keep their decoded `<img>` elements.
> 3. **No blank frames anywhere:** when any screen must rebuild, build it off-screen and swap it in with one `replaceChildren` call.
> 4. **Privacy:** add the Home cache to CLAUDE.md's key inventory as **device-only**, never backed up, and cleared on sign-out.
> 5. **Pull to refresh (Home and Profile only)**, in `src/shell/pull-refresh.js`:
>    - **When it starts:** only on the Home or Profile tab, only when the page is scrolled to the very top (`scrollY <= 0`) at touch start, and only when no layer from NV2 is open. Lock the axis after ~10 px: if the drag is mostly sideways (the crate strip, any horizontal row), it's not a pull. Never on Library or Sundown (the Sundown preview slider and Library scrolling must be untouched).
>    - **The feel:** a small record-style indicator slides down from under the header, following the finger with resistance (move = pull × 0.5, capped at ~96 px), and spins up as it nears the threshold. Release past **64 px** of indicator travel to refresh; otherwise it springs back. While refreshing, the indicator holds at ~48 px and spins, then tucks away when done. A light haptic isn't available to web apps, so don't fake one.
>    - **iOS details:** the home-screen app has no built-in pull to refresh, and the body rubber-bands at the top. Add `overscroll-behavior-y: contain` on the scroller, and register `touchmove` with `{passive:false}`, calling `preventDefault()` **only once a pull has actually started** (never on ordinary scrolls). Use transform/opacity only on the indicator, not on the page.
>    - **What it does:** calls the same refresh functions this PR builds (items 1–2), with the patch-in-place behaviour, so nothing blanks.
>      - **Home:** re-fetch the feed and now-spinning.
>      - **Profile:** re-fetch profile, follow counts, stats and rhythm card, and the backup status line. If a "sync now" path already exists, it may nudge it. **Never** start a restore, merge or anything that writes library data from a pull.
>    - **Limits:** ignore a new pull while one is running. Allow at most one network refresh every 10 seconds; a pull inside that window just plays the animation and shows "Up to date". Offline or signed out: no request, show a short status line ("Offline: showing what's saved" / "Sign in to see Home"), and the indicator tucks away.
>    - **Accessibility and desktop:** pull is touch-only. Add a refresh control in the tab's header overflow, or reuse an existing one, with the label "Refresh", reachable by keyboard and screen reader. Announce "Updated" or "Couldn't refresh" through a polite live region. Under reduced motion, the indicator appears and disappears without the spring or spin.
>    - **The gesture logic is a pure function** (`decidePull({dy, dx, startScrollY, elapsedMs})` → `idle | pulling | armed | cancel`). NV5's swipe-to-close reuses the same pattern.
> 6. **Tests:** cached feed shows synchronously; refresh patches without reordering unchanged items; sign-out clears the cache; Profile re-entry doesn't recreate unchanged images. Pull decision: starts only at the top, cancels on sideways drags, arms past the threshold, ignored while a layer is open or on Library and Sundown. The 10-second throttle, offline and signed-out paths, and that a pull never calls restore or merge.
>
> Lint and tests pass; preview clean; NV1 numbers improve, and scrolling Home and Profile from the top shows no added long tasks. Do not merge.

**Preview focus (test account, iPhone):** switch to Home several times: no blank, no "Loading…" after the first time. Same for Profile. At the top of Home, pull down and release past the threshold: the record spins and the feed updates in place. A short pull springs back with no refresh. Pull again immediately: "Up to date". Swiping sideways on the crate never triggers it. Library and Sundown never pull. In Airplane Mode: "Offline: showing what's saved".

---

### NV5: motion and gestures

> Read CLAUDE.md first. This PR adds **gentle, fast motion** and **swipe-to-close**, using transform and opacity only (compositor-friendly). Everything is off under reduced motion.
>
> 1. **Tab transitions:** the incoming tab fades in and rises 6 px over 140 ms; the outgoing one hides instantly. No sideways slides, since the tabs aren't a sequence. Use the frontend-design guidance; keep it in the vinyl aesthetic.
> 2. **Sheets:** slide up with a short ease-out (200 ms), and close with the reverse. **Swipe down to close** for the queue, credits, edit, share, sleep and record sheets, and the **full player**. Follow the finger, release past a third of the height or with enough speed to close, otherwise spring back. The close goes through NV2's `history.back()`.
>    - Don't conflict with **spin-to-scrub** on the platter: the player's swipe only starts on the header area, or outside the disc.
>    - Don't conflict with the **gatefold's** own gestures.
> 3. **Day / Sound switch:** the underline slides between the two views.
>    - Don't conflict with **pull to refresh** (NV4): it only exists on Home and Profile with no layer open, and sheets are layers, so the two never compete. Follow NV4's `decidePull` pattern for the gesture code.
> 4. **Tests:** pure gesture-decision function (distance/velocity thresholds); reduced motion disables transitions; with a sheet open on Home, dragging down moves the sheet, never pull to refresh.
>
> Lint and tests pass; preview clean; NV1 shows no dropped frames during transitions. Do not merge.

**Preview focus (iPhone):** switch tabs (subtle and quick, never sluggish). Swipe down the queue, credits and the full player. Scratching the record still works and never closes the player. Turn on Reduce Motion: everything is instant.

---

### NV6: big libraries stay smooth

> Read CLAUDE.md first. This PR makes **large libraries cheap to show and scroll**.
>
> 1. **`content-visibility: auto`** with `contain-intrinsic-size` on library rows and album groups, so off-screen rows cost nothing to lay out or paint. Check that find-in-page, scroll anchoring (NV3) and the alphabet rail still work.
> 2. **Chunked first render:** for more than ~400 rows, render the first screenful synchronously and the rest in idle-time chunks, without blocking taps or playback.
> 3. **Images:** list and crate thumbnails get `loading="lazy"` and `decoding="async"` where missing, with fixed width and height so nothing shifts.
> 4. **Search:** debounce typing (~120 ms), and filter the existing rows rather than rebuilding when possible.
>
> Lint and tests pass; preview clean; NV1 on the 2,000-track library shows tab switch and scroll within budget. Do not merge.

**Budgets (checked against NV1's harness at 4× throttling):** a tab switch paints in **< 100 ms**; no long task **> 50 ms** while scrolling; sheets open in **< 1 frame** of work before their animation starts.

**After-merge check for the whole series (real app):** a normal session of browsing, playing, opening albums and switching tabs should feel steady. NV1's final table in `docs/perf/BASELINE.md` shows the before and after.
