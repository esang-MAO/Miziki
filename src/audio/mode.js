import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { routeSource, applyCharacter, disconnectVinylChain, rebuildVinylChain } from './engine.js';
import { fadeMusicTo } from './surface-noise.js';
import { cancelPendingGapless } from '../player/transport.js';

// AU2 (docs/16_AUDIO.md §2.2): the same 15ms edge player/transport.js's
// own EDGE_FADE_MS names for pause/stop/seek -- duplicated, not imported,
// the same "a small shared number is cheaper to repeat than to wire a new
// edge for" call CLAUDE.md already documents for player/clock.js's own
// PHASE_COLOR duplication (and sync/images.js's crop logic before it).
const MODE_DIP_MS = 15;

export function setMode(m){
  const prevMode = S.mode, prevSource = S.source;
  S.mode = m;
  const vinyl = m === 'vinyl';
  document.documentElement.style.setProperty('--accent', vinyl ? 'var(--amber)' : 'var(--cool)');
  // RF15 (docs/12_REFINE.md): "Pure means untouched" has to show on the
  // platter's own label too, not just the colour swap above — see
  // .mode-pure .label.has-art in 02-stage-platter.css.
  document.documentElement.classList.toggle('mode-pure', !vinyl);
  // CEREMONY (docs/CEREMONY.md, §1): one toggle, not a two-button group —
  // a real switch (role="switch", aria-checked) whose own label text
  // reads the current mode, same as the mockup's "Label reads the
  // current mode" requirement.
  const toggle = $('#modeToggle'), label = $('#modeToggleLabel');
  if(toggle) toggle.setAttribute('aria-checked', String(vinyl));
  if(label) label.textContent = vinyl ? 'Vinyl' : 'Pure';
  // D4 (docs/DESKTOP_LAYOUT.md): the desktop player bar's own mode
  // toggle mirrors the same state — null-guarded the same way drawSun()
  // guards its sidebar mirror, since these ids exist only in the player
  // bar's own markup (miziki.html), hidden below 1024px by CSS.
  const barToggle = $('#barModeToggle'), barLabel = $('#barModeToggleLabel');
  if(barToggle) barToggle.setAttribute('aria-checked', String(vinyl));
  if(barLabel) barLabel.textContent = vinyl ? 'Vinyl' : 'Pure';
  // AU2 (docs/16_AUDIO.md §2.2): the Pure/Vinyl toggle is a dip, never a
  // crossfade -- fade out, reroute, fade in -- rather than an instant
  // reconnect. The Vinyl path runs ~12ms behind Pure (n.wobble's own
  // delay, audio/engine.js's buildGraph()), and that delay node keeps
  // draining whatever it already had buffered for ~12ms after trackGain
  // disconnects from it -- so an instant switch either sums that drain
  // tail against the new, undelayed path (Vinyl -> Pure: a delayed copy
  // of the same signal at similar level, a comb filter, McCarthy 4.2.1.3)
  // or leaves ~12ms of silence before the newly-rerouted chain's first
  // sample actually arrives (Pure -> Vinyl). The dip's own 15ms of near-
  // silence comfortably covers either case, so there's nothing left to
  // comb-filter against, and nothing audible as a gap, by the time either
  // path is actually carrying the new routing. Only a real transition
  // (prevMode !== m) with something actually playing gets the dip --
  // every restore-from-prefs/boot-time call (storage/meta.js's
  // applyPrefs(), main.js's own setMode('vinyl')) either repeats the
  // already-current mode or has no live source yet, so routeSource() just
  // runs immediately there, same as before this step. The same rule
  // applies to any future path change (this file's own CLAUDE.md entry).
  // PL3 (docs/19_PLAYER.md, item 3): a pre-armed gapless source was routed
  // (routeSource()) for the mode that was current when it was armed —
  // cancel so maybeScheduleGaplessNext() re-arms (and re-routes) it fresh
  // under the new mode, rather than letting a stale-routed source adopt.
  if(prevMode !== m) cancelPendingGapless();
  // PL5 item 6: the Vinyl chain itself (its own oscillators included)
  // only needs touching on a real transition -- rebuild happens inside
  // the dip, before the reroute that feeds it (so Vinyl's chain is
  // already live the instant trackGain reconnects to it); disconnect
  // happens after the reroute, once trackGain has already moved off of
  // it (so nothing is severed out from under a signal still flowing
  // through it).
  if(prevSource && prevMode !== m){
    fadeMusicTo(0, MODE_DIP_MS);
    setTimeout(() => {
      if(S.source !== prevSource) return;   // interrupted mid-dip (paused/stopped/track changed)
      if(vinyl) rebuildVinylChain();
      routeSource(prevSource);
      if(!vinyl) disconnectVinylChain();
      fadeMusicTo(1, MODE_DIP_MS);
    }, MODE_DIP_MS);
  } else {
    if(S.source) routeSource(S.source);
    if(prevMode !== m){
      if(vinyl) rebuildVinylChain(); else disconnectVinylChain();
    }
  }
  // DA2 (docs/DAY_ARC.md): applyCharacter() now also gates on S.mode (Pure
  // forces drift to 'off' regardless of S.charDrift — see engine.js's own
  // comment), so every one of this function's own callers needs the Vinyl
  // chain's nodes re-applied the moment a switch actually happens, not
  // left holding whichever gate was in effect up to 30s ago — not just the
  // few call sites that already happened to call applyCharacter() of
  // their own accord afterward (storage/meta.js's applyPrefs() still does,
  // redundantly but harmlessly, right after its own setMode(p.mode) call).
  applyCharacter();
}
