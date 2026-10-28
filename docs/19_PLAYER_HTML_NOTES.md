# `miziki.html` notes

TR4 (`docs/19_PLAYER.md`, "`miziki.html` diet") moved the longer, still-relevant
rationale out of `miziki.html`'s own comments into this file, leaving only
short structural markers or one-line pointers in the markup itself. Read this
when you need to know *why* a particular element in `miziki.html` is shaped
the way it is; `miziki.html` itself still tells you *what* each element is.

Organized in the same top-to-bottom order as the markup.

## iOS fullscreen meta tags (`apple-mobile-web-app-capable`/`-status-bar-style`)

Without these two, a home-screen install never actually runs fullscreen on
iOS — the status bar sits as native OS chrome entirely outside the viewport
(`env(safe-area-inset-top)` always reads 0 as a result), and a Home Screen
web app without `apple-mobile-web-app-capable` also reserves a bit more
height above the webview than the status bar alone, on top of `.top`'s own
~24px spacer (`01-header.css`) — reported by Ken as an oversized gap above
the tab row. `black-translucent` lets the app's own background (`.sky-bg`)
show straight through the status bar instead of a second, opaque bar sitting
above it; every route's own top padding reads `env(safe-area-inset-top)`
(`.top`, `.add-menu`, `.social-nav-head`) so nothing ends up drawn under the
notch/Dynamic Island once the webview extends under it.

## `theme-boot.js` script tag

Avoids a flash of the wrong theme for a pinned Light or Dark choice. The real
saved choice (`S.theme`) lives in IndexedDB, only readable after first paint
— this tiny external classic script (the CSP allows only same-origin
scripts, no inline) reads the `localStorage` mirror `src/ui/theme.js` keeps
in sync with it instead, and sets `documentElement`'s `data-theme` attribute
before the stylesheet `<link>` tags are even parsed, since it's a blocking
classic script placed ahead of them. A relative path, not an absolute one:
Vite only rewrites paths it actually bundles, and a plain classic script src
is explicitly left untouched ("can't be bundled without `type=module`") — a
`%BASE_URL%` prefix here got double-applied by Vite's own dev-server base
handling (`http://host/Miziki/Miziki/src/...`). A relative path sidesteps
that: it resolves correctly against the page's own final URL in both dev and
the built site, with no base-rewriting involved at all. The
`copy-theme-boot` plugin in `vite.config.js` keeps the file at this same
`src/` path under the build output. Auto needs none of this — with no
`data-theme` attribute set, `src/styles/22-theme.css`'s own
`@media (prefers-color-scheme)` rule handles it with zero JavaScript at
first paint.

## `#libToolsStash`/`#libTools` (Profile)

Static markup — not rebuilt by `renderProfile()`'s own `innerHTML` reset
elsewhere, or by `renderTracks()` back when this lived in `#route-library` —
so its listeners survive every re-render. Parked here, hidden, moved into
Profile › Settings by `renderAppSettingsScreen()`; moved back by
`renderProfile()` (via `parkLibraryTools()`) before the body is wiped on any
screen change. Refreshed by `refreshLibraryTools()`.

## `#playbackSettingsStash`/`#playbackSettings` (Profile)

Static markup (like `#libTools`) so its listeners survive
`renderProfile()`'s `innerHTML` reset. Parked here, hidden, moved into
Profile › Settings by `renderAppSettingsScreen()`; moved back by
`renderProfile()` before the body is wiped. Each row's own `<em>` is one
sentence; the rest sits behind a native `<details class="sd-info">` "(i)"
disclosure. `#bgAudioNote` keeps its id and stays a plain `<em>` —
`src/player/background.js`'s `bgUpdateUI()` overwrites its `textContent`
directly for the unsupported-browser/retry states, which a `<details>`
child would not survive — so its own (i) is a separate, static sibling
instead of nested inside it.

## Desktop player-bar controls (`#barPrev`/`#barNext`/`#barScrub`/`#barVolume` etc.)

New ids throughout, driving the exact same `prevTrack()`/`nextTrack()`/
`seek()`/`setMode()` the full player's own `#prev`/`#next`/`#scrub`/
`#modePure`/`#modeVinyl` already call (`src/wiring/transport.js`) — a
desktop player bar must reuse or restyle those ids, never clone them, so
these are new elements, not copies. Each is `display:none` below 1024px
(`src/styles/08-shell.css`), so on a phone none of them occupy a flex slot
in this strip at all — the existing `#miniTap`/`#miniQueueBtn`/`#miniPlay`
stay in their same relative visual order, unchanged.

## `.player-layout`/`#stageInfo` (full player, desktop)

`.player-layout` is invisible scaffolding below the desktop breakpoint
(`display:contents`, the same pattern `.sidebar`/`.crate-layout` already
use), so `.stage` lays out exactly as it always has on a phone. At 1024px+
it becomes a flex row: `.stage` (platter+sleeve, then `#stageInfo`) on the
left, `#playerSidePanel` (Up next / Liner notes / Credits) on the right.
`#stageInfo` wraps six pre-existing, untouched elements (unchanged ids,
unchanged content, unchanged own CSS) purely so `.stage` can lay the
platter and "everything else" out side by side on desktop without becoming
a flat, un-groupable multi-item flex row — it is itself `display:contents`
below 1024px, so these six elements remain exactly as if they were still
direct children of `.stage` there.

## `#zoetropeRing` (platter)

A sibling of `#disc`, never a child — so it never inherits the per-frame
rotation transform `player/clock.js`'s `frame()` writes onto `#disc` alone
(the same reasoning `#discMetalLight` already established). Shows the same
full-disc background image as `#disc`, CSS-masked (`02-stage-platter.css`)
to just the ring annulus every zoetrope disc shares, then given its own,
separately-quantized transform each frame
(`record-art/zoetrope-motion.js`'s `zoetropeRingAngleDeg()`, called from
`player/clock.js`'s `frame()`) so the figures appear to animate in place
instead of merely spinning. Hidden (`opacity 0`) whenever the current look
isn't a zoetrope.

## `#sunKnob` (platter)

"Where a turntable's speed knob sits," at the platter's lower right. A
sibling of `#platterBox`/`#disc`, not a child, so it sits on top of the
platter without ever becoming part of `#disc`'s own scratch/spin pointer
target (`src/player/scrub.js`'s `wireSpinToScrub()` binds to
`#platterStage`/`#disc` directly; this button's own click handler is a
separate listener on a separate element, so spinning the record still
scratches exactly as it always has — the knob never moves the platter).
`data-phase` is written by `drawSun()` (`src/player/clock.js`) the same way
the mini-player's sun button's is — CSS (`src/styles/26-sundown-sheet.css`)
owns the ring colour per phase, not JS.

## `#dbStaleBanner` (the IndexedDB-upgrade reload banner)

Shown when another tab upgrades the database (IndexedDB `onversionchange`)
while this tab is open — this tab's own connection to it has already been
closed by then (`src/storage/idb.js`), so reloading is the only way back to
a working, persistent library here. Same fixed-banner shape as the undo
banner, just with no dismiss but Reload — there's nothing to undo and
nothing useful left to do here until the page reloads.
