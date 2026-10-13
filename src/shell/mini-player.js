import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { albumKey } from '../record-art/tiers.js';
import { REDUCED } from '../util/motion.js';
import { bgSync } from '../player/background.js';
import { isLibraryRouteVisible } from './routes.js';
import { applyCrateMiniInset, centerEmptyState } from '../crate/view.js';
import { isDesktopShell } from '../util/viewport.js';

/* ================= navigation shell: mini-player, full-player overlay, sleeve pull =================
   Library is the landing route; Sundown and Character are peer routes reached
   via the tab bar. The full player is not a fourth tab — it only exists as an
   overlay, reached through the mini-player strip, once something is loaded. */
/* Two ways into the full player, chosen by whether a record is already on
   the platter: picking a track from Library always arrives via the SHEET
   (something is being started); tapping the mini-player always arrives via
   the MORPH (returning to what's already there). The sheet settles fully
   before any disc transition begins; the morph itself IS the disc arriving,
   so nothing else runs alongside it. Durations/easing live in one object so
   the return-to-sleeve/pull/morph ratio can be tuned without touching any
   trigger logic below. */
export const SLEEVE_ANIM = {
  sheetMs: 350,      // sheet settles fully before any disc transition begins
  arriveMs: 1000,    // sleeve slides in from the right
  holdCapMs: 2000,   // longest the sleeve sits static waiting on the buffer
  emergeMs: 2000,    // disc emerges + sleeve exits, concurrently (~3s total pull)
  returnMs: 1200,    // putting a record away — quicker than pulling one out
  morphMs: 420,
  // put-away: the queue ends, the sleeve comes to collect the disc (see
  // PRESENTATION spec, put-away sequence). Shorter than the pull (2.0s total).
  putSpinMs: 500, putInMs: 700, putSlideDelayMs: 600, putSlideMs: 800, putOutMs: 600,
  // the seal peel, inserted into a sealed album's first pull only (SEALED spec §6)
  peelTearMs: 300, peelOffMs: 400,
  easing: 'cubic-bezier(.3,.66,.35,1)'   // morph only; sleeve/disc easing lives in CSS per-phase
};
document.documentElement.style.setProperty('--sheet-duration', SLEEVE_ANIM.sheetMs + 'ms');
document.documentElement.style.setProperty('--arrive-duration', SLEEVE_ANIM.arriveMs + 'ms');
document.documentElement.style.setProperty('--emerge-duration', SLEEVE_ANIM.emergeMs + 'ms');
document.documentElement.style.setProperty('--return-duration', SLEEVE_ANIM.returnMs + 'ms');
document.documentElement.style.setProperty('--putaway-in-duration', SLEEVE_ANIM.putInMs + 'ms');
document.documentElement.style.setProperty('--putaway-slide-duration', SLEEVE_ANIM.putSlideMs + 'ms');
document.documentElement.style.setProperty('--putaway-out-duration', SLEEVE_ANIM.putOutMs + 'ms');
document.documentElement.style.setProperty('--sleeve-peel-tear-duration', SLEEVE_ANIM.peelTearMs + 'ms');
document.documentElement.style.setProperty('--sleeve-peel-off-duration', SLEEVE_ANIM.peelOffMs + 'ms');

export function renderMiniPlayer(){
  const t = current();
  const mini = $('#miniPlayer');
  if(!t){ mini.style.display = 'none'; updateChromeInset(); return; }
  mini.style.display = 'flex';
  $('#miniTitle').textContent = t.tags ? t.tags.title : t.name;
  $('#miniArtist').textContent = t.tags ? t.tags.artist : '';
  $('#miniSquare').classList.toggle('has-art', !!t.art);
  const art = $('#miniArt');
  if(t.art) art.src = t.art; else art.removeAttribute('src');
  $('#miniIndicator').classList.toggle('playing', S.playing);
  // the mini disc surface stays plain black regardless of tier — only this
  // tiny inset label carries artwork
  const discArt = $('#miniDiscArt');
  // the put-away leaves the disc put away — the tiny indicator shows idle,
  // even though the title/artist text above it still names the track
  if(t.art && !S.platterEmpty){ discArt.src = t.art; $('#miniDisc').classList.add('has-art'); }
  else { discArt.removeAttribute('src'); $('#miniDisc').classList.remove('has-art'); }
  const btn = $('#miniPlay');
  btn.textContent = S.playing ? '❚❚' : '▶';
  btn.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  updateChromeInset();
  bgSync();
}

// Scrollable content needs bottom padding equal to the chrome's actual
// rendered height, not a fixed guess — the mini-player strip comes and
// goes with playback, so this is re-measured every time renderMiniPlayer()
// runs rather than baked into CSS once (see LIBRARY spec §3). The tab bar's
// own box already includes its safe-area padding, so nothing is added here.
let chromeInsetRAF = null;
export function updateChromeInset(){
  if(chromeInsetRAF) return;
  chromeInsetRAF = requestAnimationFrame(() => {
    chromeInsetRAF = null;
    const tabbar = $('#tabbar'), mini = $('#miniPlayer');
    // D3 (docs/DESKTOP_LAYOUT.md): on desktop the tab bar is a vertical
    // sidebar (full viewport height, not a fixed strip at the bottom of
    // .wrap), so its own offsetHeight is no longer a bottom-chrome
    // measurement at all — including it here would inflate --chrome-inset
    // to roughly the sidebar's own height. The mini-player is hidden on
    // desktop until D4's player bar replaces it (its own "visible" check
    // below already yields 0 for it once hidden, with no change needed
    // here), so this collapses to the flat 16px fallback below on
    // desktop — moot in practice, since src/styles/23-desktop.css
    // overrides .wrap's padding outright there and never reads this
    // property at all, but a small, accurate number here beats a wildly
    // wrong one in case something else ever comes to depend on it.
    const tabH = (tabbar && !isDesktopShell()) ? tabbar.offsetHeight : 0;
    const miniVisible = mini && getComputedStyle(mini).display !== 'none';
    const miniH = miniVisible ? mini.offsetHeight : 0;
    document.documentElement.style.setProperty('--chrome-inset', (tabH + miniH + 16) + 'px');
    if(typeof applyCrateMiniInset === 'function') applyCrateMiniInset();
    if(typeof centerEmptyState === 'function' && !S.tracks.length && isLibraryRouteVisible()) centerEmptyState();
  });
}

// each untagged file gets its own identity here (never a shared "Unknown Album"
// bucket) purely so state stays coherent once a real, tagged album shows up
// next — untagged tracks are excluded from the pull/return ceremony entirely,
// see updateShellAlbum()
function shellAlbumIdentity(t){
  if(!t) return null;
  if(t.tags.album === 'Unknown Album') return 'single:' + t.id;
  return albumKey(t);
}

// Always updates "what's on the platter" bookkeeping, even while the player
// is closed or shuffled, so state stays correct for whenever it's next
// shown. Returns what the disc SHOULD do, without running anything —
// callers decide whether it's currently visible/safe to actually play it.
export function updateShellAlbum(t){
  const newId = shellAlbumIdentity(t);
  const prevId = S.shellAlbumId, prevArt = S.outgoingArt, prevHasArt = S.outgoingHasArt;
  // distinct from type:'none' below — that also covers shuffle/untagged
  // suppression, where the album may genuinely have changed. This is
  // specifically "still the same album", which is what the metal-tier
  // crossfade needs (see METAL spec §4): a real sleeve pull already covers
  // any background change when the album is actually different.
  const sameAlbum = prevId !== null && prevId === newId;
  S.shellAlbumId = newId;
  S.outgoingArt = t.art; S.outgoingHasArt = !!t.art;
  // the sleeve is physically sitting over an empty platter — always pull,
  // regardless of album identity/shuffle/reduced-motion, or the disc stays
  // stuck hidden behind it with nothing left to bring it back out
  if(S.platterEmpty) return {type:'pull', sameAlbum};
  // untagged tracks don't get the ceremony — an untagged file hasn't
  // established a release identity yet, so it silently occupies the
  // platter without a pull until a genuinely tagged one arrives
  if(t.tags.album === 'Unknown Album') return {type:'none', sameAlbum};
  if(S.shuffle || REDUCED || prevId === newId) return {type:'none', sameAlbum};
  if(prevId === null) return {type:'pull', sameAlbum};
  return {type:'swap', outgoingArt:prevArt, outgoingHasArt:prevHasArt, sameAlbum};
}
