"use strict";
// TR3 (docs/19_PLAYER.md): a real ES module now, imported here purely for
// its side effect (it assigns window.MizikiSocial itself, see its own
// header comment) -- must stay the very first import so that global
// exists before any of this file's own top-level code runs, the same
// ordering a separate classic <script src="src/miziki-social.js"> tag
// ahead of this module's <script> tag in miziki.html used to guarantee.
import './miziki-social.js';
import { S, current, SOCIAL_SUPABASE_URL, SOCIAL_SUPABASE_ANON_KEY } from './state.js';
import { $ } from './util/dom.js';
import { trackTier, albumKey } from './record-art/tiers.js';
import { albumMetalFor } from './record-art/metals.js';
import { formatWireCode } from './record-art/format.js';
import { albumFormatFor as computeAlbumFormat } from './shell/ceremony-timing.js';
import { applyDiscVariant } from './record-art/looks.js';
import { allIdx } from './library/model.js';
import { setQueue } from './player/queue.js';
import { restoreSessions } from './history/sessions.js';
import { loadOverlaysBatch } from './library/edit.js';
import { rebuildPeopleIndex, albumCreditPairs } from './library/credits.js';
import { renderSearchChips } from './library/search.js';
import { restoreSealedAlbums } from './library/sealed.js';
import { healThumbs, healDetails, healLoudness, healHooks } from './library/thumbs.js';
import { healCrateArt } from './crate/tiers.js';
import { invalidateCrateModel } from './crate/model.js';
import { renderTracks } from './library/view.js';
import {
  runLaunchSequence, resolveLastPlayedAlbum, resolveLastPlayedTrackIndex, markLibraryReady,
} from './launch/intro.js';
import { initLocationPrompt, fallbackSun, scheduleMidnightRecompute } from './sundown/location.js';
import { setMode } from './audio/mode.js';
import { scheduleDriftRecompute } from './audio/engine.js';
import { drawSun, frame } from './player/clock.js';
import { DB } from './storage/idb.js';
import { storage, tracks } from './storage/repo.js';
import { restoreMeta } from './storage/meta.js';
import { restoreResume } from './player/resume.js';
import { REDUCED } from './util/motion.js';
import { updateChromeInset } from './shell/mini-player.js';
import { putAwayInstant } from './shell/put-away.js';
import { isProfileRouteVisible, showRoute } from './shell/routes.js';
import { updateHomeTabVisibility } from './social/screens/home.js';
import { initNavStack, onRouteRestore } from './shell/nav-stack.js';
import { initScrollRestoration } from './shell/scroll-memory.js';
import { renderProfile } from './profile/screens.js';
import { resetLocalHistory } from './history/clear.js';
import { initBackupSync, onBackup } from './sync/backup.js';
import { applyTheme } from './ui/theme.js';

import { wireTransport } from './wiring/transport.js';
import { wireLibraryView } from './wiring/library-view.js';
import { wireSearch } from './wiring/search.js';
import { wireImport } from './wiring/import.js';
import { wireLibraryManagement } from './wiring/library-management.js';
import { wireGatefold } from './wiring/gatefold.js';
import { wireSundown } from './wiring/sundown.js';
import { wireCharacter } from './wiring/character.js';
import { wireEdit } from './wiring/edit.js';
import { wireAccount } from './wiring/account.js';
import { wireShare } from './wiring/share.js';
import { wireOverlays } from './wiring/overlays.js';
import { wireRoutes } from './wiring/routes.js';
import { wireLifecycle } from './wiring/lifecycle.js';
import { wirePullRefresh } from './wiring/pull-refresh.js';
import { wireSwipeClose } from './wiring/swipe-close.js';
import { wireBackdropClose } from './wiring/backdrop-close.js';

/* This is a short boot file: the audio graph, library, gatefold and
   sealed-record sheet, crate, launch intro, navigation shell, profile/
   social, share images, and every area's own DOM wiring each live in
   their own module (see CLAUDE.md's repo-layout entries). The actual
   per-area event wiring lives under src/wiring/, one file per UI area,
   each exporting a single wireX() function that main.js calls below; the
   library-loading boot sequence itself (restoreLibrary()) stays here,
   since that's what a boot file's own job actually is. */

renderSearchChips();

wireTransport();
wireLibraryView();
wireSearch();
wireImport();
wireLibraryManagement();
wireGatefold();
wireSundown();
wireCharacter();
wireEdit();
wireAccount();
wireShare();
wireOverlays();
wireRoutes();
wireLifecycle();
wirePullRefresh();
wireSwipeClose();
wireBackdropClose();

// NV2 (docs/11_SMOOTH_NAVIGATION.md): establishes the one clean history
// entry every later pushState/replaceState builds on, before anything else
// in the boot sequence (including restoreLibrary(), below) has a chance to
// run. onRouteRestore(showRoute) is what makes a real Back press (not one
// consumed by closing an overlay) land back on the route the tab-switch
// history exception (recordRoute(), shell/routes.js) saved.
initNavStack();
onRouteRestore(showRoute);
initScrollRestoration();   // NV3: hands scroll-position restoration entirely to the app

setMode('vinyl');
// The Home tab itself is hidden outright while signed out/social off,
// shown again the instant sign-in completes -- status() already has a
// real answer this early (it starts at auth:'signedOut' regardless of
// whether social is even configured, well before MizikiSocial.init() ever
// runs inside restoreLibrary() below), so there's no reason to wait for
// that. Wired here, not inside home.js itself, so tests (and any other
// early-loading module) can stub MizikiSocial first — see
// updateHomeTabVisibility()'s own comment.
updateHomeTabVisibility();
MizikiSocial.on('status', updateHomeTabVisibility);
applyTheme();
fallbackSun();
initLocationPrompt();   // RF7: never prompts for location at boot, only on request
drawSun();
scheduleMidnightRecompute();   // DA1: keeps the day model from going stale overnight
scheduleDriftRecompute();      // DA2: keeps Vinyl's character drift tracking the day
updateChromeInset();
window.addEventListener('resize', updateChromeInset);
// The Library route's own lock/inset (shell/routes.js's showRoute()) is
// only ever applied inside showRoute() itself -- the
// default .route.on state is static HTML with no matching JS call, so
// without this the lock/inset would never actually take effect on a fresh
// load, only once the user later switched away from and back to Library.
// Called after updateChromeInset() above so --chrome-inset is already set
// by the time updateLibBodyInset() reads it.
showRoute('library');
requestAnimationFrame(frame);
restoreLibrary();   // runs underneath the launch intro below; never waits on it
// REDUCED and document.hidden are known synchronously; S.launchIntro's
// persisted value isn't (it loads inside restoreLibrary()), so
// runLaunchSequence() re-checks it itself once that's resolved
if(REDUCED || document.hidden) $('#launchOverlay').remove();
else runLaunchSequence();

async function restoreLibrary(){
  const note = $('#storeNote');
  const ok = await storage.open();
  if(!ok){
    // RF5 (docs/12_REFINE.md, point 3): DB.blocked means another tab already
    // has this same database open at an older version — genuinely
    // different from storage being unavailable, and saying so here matters:
    // the old, shared "lasts only for the session... it persists" message
    // read as an invitation to keep using the app and add songs, which
    // would fork this device's own library the moment the other tab closes
    // and the real, persistent database becomes reachable again.
    note.textContent = DB.blocked
      ? 'Miziki is open in another tab. Close it there, then reload this one.'
      : 'Storage is not available here, so this library lasts only for the session. '
        + 'Served from your own address and added to the Home Screen, it persists.';
    renderTracks();
    markLibraryReady();
    return;
  }
  // RF5, point 3: if another tab upgrades the database later in this same
  // session, this connection closes itself (DB.open()'s own onversionchange
  // handler) rather than leaving every further read/write to quietly no-op
  // with nothing said — tell the user plainly, since by then they may be
  // deep in the app with no reason to suspect storage has gone stale.
  DB.onNotice(kind => { if(kind === 'staleVersion') showStaleVersionBanner(); });
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(_e){}
  const recs = await tracks.all();
  recs.sort((a,b) => (a.addedAt||0) - (b.addedAt||0));
  // Perf fix: build every track record first, then resolve every overlay/
  // custom-cover claim in one pass (loadOverlaysBatch(), src/library/edit.js)
  // instead of once per track -- see that function's own comment for why
  // this turns 2*N sequential IndexedDB transactions into a small constant
  // number of them.
  const newTracks = recs.map(r => ({
    id:r.id, addedAt:r.addedAt, name:r.tags.title, tags:Object.assign({}, r.tags), details: r.details || null, meta:r.meta,
    duration:r.duration, buffer:null, blob:null, stored:true, artBlob:null,
    gaplessDelaySec:r.gaplessDelaySec || 0, gaplessPaddingSec:r.gaplessPaddingSec || 0,
    sizeBytes:r.sizeBytes || 0,
    art: r.art ? URL.createObjectURL(r.art) : null
  }));
  await loadOverlaysBatch(newTracks);
  for(const t of newTracks) S.tracks.push(t);
  await restoreMeta();
  await restoreSessions();
  await restoreSealedAlbums();
  rebuildPeopleIndex();
  invalidateCrateModel();
  renderTracks();
  healThumbs().catch(() => {});
  healDetails().catch(() => {});
  healCrateArt().catch(() => {});
  healLoudness().catch(() => {});
  healHooks().catch(() => {});
  markLibraryReady();   // from here on the launch intro knows S.launchIntro
  if(S.tracks.length){
    // AU1 (docs/16_AUDIO.md §2.1): try the saved queue/position first — it
    // falls back to false (not restored at all, or nothing left of it
    // after missing tracks were dropped) when there's nothing to restore,
    // same as every device before this step. Either way the platter stays
    // empty: Play pulls the record (CEREMONY §2, §5).
    const resumed = await restoreResume();
    if(!resumed){
      // prime the last-played album into the mini player, silently
      const lastAlbum = resolveLastPlayedAlbum();
      const lastIdx = lastAlbum !== null ? resolveLastPlayedTrackIndex(lastAlbum) : -1;
      setQueue(allIdx(), lastIdx >= 0 ? lastIdx : 0, false);
    }
    putAwayInstant();
    note.textContent = S.tracks.length + (S.tracks.length === 1 ? ' track' : ' tracks')
      + ' restored from this device. Tracks are decoded as you play them, so opening Miziki stays quick.';
  } else {
    note.textContent = 'Your library will be kept on this device. Add it to your Home Screen so iOS does not clear it.';
  }
  // Dynamic import, not a static one, for the same reason as the
  // ?social=demo import below: SOCIAL_SUPABASE_URL/ANON_KEY are empty for
  // every real user today, so supabase-js (bundled, not CDN-loaded — see
  // CLAUDE.md's security hardening note) should never be in what they
  // download. Only fetched once both keys are actually set.
  const supabaseLib = (SOCIAL_SUPABASE_URL && SOCIAL_SUPABASE_ANON_KEY)
    ? await import('@supabase/supabase-js')
    : undefined;
  await MizikiSocial.init({ url: SOCIAL_SUPABASE_URL, anonKey: SOCIAL_SUPABASE_ANON_KEY,
    env: { S, DB, albumKey, trackTier, albumMetalFor, albumCreditPairs,
      // AU11 (docs/16_AUDIO.md §5): the record's own *automatic* format
      // (never S.albumFormat's personal override -- "friends see the
      // automatic format"), as the short wire code sync_crate() stores.
      // A record with no measured duration at all (every track reads 0)
      // has nothing real for the table to size itself from -- read as
      // unknown (null), the same guard crate/model.js's own
      // hasKnownFormat() already applies locally, rather than silently
      // publishing formatForLongestSide's own shortest-cell default.
      albumFormatFor: tracks => (tracks.some(t => (t.duration || 0) > 0)
        ? formatWireCode(computeAlbumFormat(tracks.map((_, i) => i), tracks))
        : null)
    }, supabaseLib });
  // sync/backup.js deliberately doesn't import library/view.js itself (see
  // its own applyMerged() comment) — main.js already has renderTracks for
  // the boot sequence, so it's the one place that connects the two.
  onBackup('applied', ()=>{
    renderTracks();
    const t = current();
    if(t) applyDiscVariant(t, true);
    // step 07, B4: a downloaded cover/avatar also needs the profile tab
    // redrawn if it's the one currently on screen — renderTracks() alone
    // doesn't touch it. Cheap and rare enough (only fires after an
    // actual pull-merge) that there's no need for its own debounce the
    // way library/thumbs.js's refreshProfileIfOpen() has for its own,
    // much more frequent, per-thumbnail callers.
    if(isProfileRouteVisible()) renderProfile();
  });
  // RF1 (docs/12_REFINE.md): sync/backup.js can't import history/clear.js
  // directly for the same reason it can't import library/view.js (its own
  // header comment) — clear.js reaches that same hub. applyMerged()'s
  // 'ownReset' branch awaits this listener's own return value (emitAwait,
  // not plain emit()) before adopting the remote historyClearedAt stamp.
  onBackup('reset', () => resetLocalHistory());
  initBackupSync();
  MizikiSocial.libraryLoaded();
  // The Home tab itself is hidden outright while signed out or social
  // off, and reappears the instant sign-in completes (overrides RF7's own
  // "the tab bar never changes shape" rule). See social/screens/home.js's
  // updateHomeTabVisibility() for the actual
  // show/hide logic (wired to MizikiSocial's own 'status' event, so no
  // separate call is needed here).
  if(new URLSearchParams(location.search).get('social') === 'demo'){
    // Dynamic import, not a static one: ?social=demo is dev-only (see
    // CLAUDE.md), so src/social/demo.js — fixture data and ~700 lines of
    // monkey-patching MizikiSocial's methods — must not be in the main
    // bundle real users download. Vite puts it in its own chunk; this is
    // the exact point in startup installSocialDemo() has always run from.
    const { installSocialDemo } = await import('./social/demo.js');
    installSocialDemo();
  }
}

// RF5 (docs/12_REFINE.md, point 3): shown once, the first time DB's
// onversionchange fires in a session (another tab is upgrading the
// database right now) — every DB.* call already quietly no-ops from that
// point on (DB.ok is false), so nothing here forks data; this is purely
// telling the user why, and that reloading is what gets them back to a
// working, persistent library.
let staleVersionShown = false;
function showStaleVersionBanner(){
  if(staleVersionShown) return;
  staleVersionShown = true;
  $('#dbStaleBanner').style.display = 'flex';
}
$('#dbStaleReload').addEventListener('click', () => location.reload());
