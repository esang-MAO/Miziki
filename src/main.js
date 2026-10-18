"use strict";
import { S, current, SOCIAL_SUPABASE_URL, SOCIAL_SUPABASE_ANON_KEY } from './state.js';
import { $ } from './util/dom.js';
import { trackTier, albumKey } from './record-art/tiers.js';
import { albumMetalFor } from './record-art/metals.js';
import { applyDiscVariant } from './record-art/looks.js';
import { allIdx } from './library/model.js';
import { setQueue } from './player/queue.js';
import { restoreSessions } from './history/sessions.js';
import { loadOverlayFor } from './library/edit.js';
import { rebuildPeopleIndex } from './library/credits.js';
import { renderSearchChips } from './library/search.js';
import { restoreSealedAlbums } from './library/sealed.js';
import { healThumbs, healDetails } from './library/thumbs.js';
import { healCrateArt } from './crate/tiers.js';
import { invalidateCrateModel } from './crate/model.js';
import { renderTracks } from './library/view.js';
import {
  runLaunchSequence, resolveLastPlayedAlbum, resolveLastPlayedTrackIndex, markLibraryReady,
} from './launch/intro.js';
import { askLocation, fallbackSun, scheduleMidnightRecompute } from './sundown/location.js';
import { setMode } from './audio/mode.js';
import { scheduleDriftRecompute } from './audio/engine.js';
import { drawSun, frame } from './player/clock.js';
import { DB } from './storage/idb.js';
import { storage, tracks } from './storage/repo.js';
import { restoreMeta } from './storage/meta.js';
import { REDUCED } from './util/motion.js';
import { updateChromeInset } from './shell/mini-player.js';
import { putAwayInstant } from './shell/put-away.js';
import { isProfileRouteVisible, showRoute } from './shell/routes.js';
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

/* Everything that used to live here — the audio graph, the library, the
   gatefold and sealed-record sheet, the crate, the launch intro, the
   navigation shell, profile/social, share images, and every area's own
   DOM wiring — has moved out into its own module over the course of this
   engagement's step 2 through 7f (see the repo-layout entries in
   CLAUDE.md for the full history of what moved where and when). This
   file is now what the "wiring" header always implied main.js itself
   should become: a short boot file. The actual per-area event wiring
   (step 7f) lives under src/wiring/, one file per UI area, each
   exporting a single wireX() function that main.js calls below; the
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
applyTheme();
fallbackSun();
askLocation();
drawSun();
scheduleMidnightRecompute();   // DA1: keeps the day model from going stale overnight
scheduleDriftRecompute();      // DA2: keeps Vinyl's character drift tracking the day
updateChromeInset();
window.addEventListener('resize', updateChromeInset);
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
    note.textContent = 'Storage is not available here, so this library lasts only for the session. '
      + 'Served from your own address and added to the Home Screen, it persists.';
    renderTracks();
    markLibraryReady();
    return;
  }
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(_e){}
  const recs = await tracks.all();
  recs.sort((a,b) => (a.addedAt||0) - (b.addedAt||0));
  for(const r of recs){
    const t = {
      id:r.id, addedAt:r.addedAt, name:r.tags.title, tags:Object.assign({}, r.tags), details: r.details || null, meta:r.meta,
      duration:r.duration, buffer:null, blob:null, stored:true, artBlob:null,
      gaplessDelaySec:r.gaplessDelaySec || 0, gaplessPaddingSec:r.gaplessPaddingSec || 0,
      sizeBytes:r.sizeBytes || 0,
      art: r.art ? URL.createObjectURL(r.art) : null
    };
    await loadOverlayFor(t);
    S.tracks.push(t);
  }
  await restoreMeta();
  await restoreSessions();
  await restoreSealedAlbums();
  rebuildPeopleIndex();
  invalidateCrateModel();
  renderTracks();
  healThumbs().catch(() => {});
  healDetails().catch(() => {});
  healCrateArt().catch(() => {});
  markLibraryReady();   // from here on the launch intro knows S.launchIntro
  if(S.tracks.length){
    // prime the last-played album into the mini player, silently, but leave
    // the platter empty: Play pulls the record (CEREMONY §2, §5)
    const lastAlbum = resolveLastPlayedAlbum();
    const lastIdx = lastAlbum !== null ? resolveLastPlayedTrackIndex(lastAlbum) : -1;
    setQueue(allIdx(), lastIdx >= 0 ? lastIdx : 0, false);
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
    env: { S, DB, albumKey, trackTier, albumMetalFor }, supabaseLib });
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
  $('#homeTabBtn').style.display = MizikiSocial.status().enabled ? '' : 'none';
  MizikiSocial.on('status', s => { $('#homeTabBtn').style.display = s.enabled ? '' : 'none'; });
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
