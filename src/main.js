"use strict";
import { S, current, SOCIAL_SUPABASE_URL, SOCIAL_SUPABASE_ANON_KEY } from './state.js';
import { $ } from './util/dom.js';
import { trackTier, albumKey } from './record-art/tiers.js';
import { albumMetalFor } from './record-art/metals.js';
import { openLookPicker, closeLookPicker } from './record-art/looks.js';
import { allIdx, idxOf } from './library/model.js';
import {
  setQueue,
  playNext, addToQueue, openQueueSheet, closeQueueSheet,
} from './player/queue.js';
import { addFiles, filesFromDataTransferItems, addTestTone } from './library/import.js';
import { closeDupOverlay, closeDuplicateScan } from './library/duplicates-ui.js';
import {
  persistAlbumLookPref, touchActiveSession, restoreSessions,
} from './history/sessions.js';
import { clearListeningHistory } from './history/clear.js';
import {
  loadOverlayFor, cropSquareImage, revertTrack,
  undoLastEdit, openEditSheet, closeEditSheet, saveEditSheet,
  renderEditArtPreview,
} from './library/edit.js';
import { deleteTracks, forgetLibrary } from './library/delete.js';
import { openDuplicateScan } from './library/duplicate-scan.js';
import {
  openCreditsSheet, closeCreditsSheet, rebuildPeopleIndex,
} from './library/credits.js';
import { toggleFavorite } from './library/favorites.js';
import { renderSearchChips, updateSearchChipsVisibility, closeSortMenu } from './library/search.js';
import { restoreSealedAlbums } from './library/sealed.js';
import { healThumbs, healDetails } from './library/thumbs.js';
import { nowClock } from './sundown/solar.js';
import { healCrateArt } from './crate/tiers.js';
import { invalidateCrateModel } from './crate/model.js';
import {
  renderTracks, enterSelectMode, exitSelectMode, closeRowMenu,
  openConfirmDelete, closeConfirmDelete, applyTrackNumbersInOrder,
  rowMenuTrackId, confirmDeleteAction,
} from './library/view.js';
import { isGatefoldOpen, closeGatefold, gatefoldSwitchPanel, updateGatefoldScale } from './gatefold/view.js';
import { isSealedSheetOpen, closeSealedSheet } from './gatefold/sealed-sheet.js';
import {
  runLaunchSequence, attachLaunchSettingRow, toggleLaunchIntro,
  resolveLastPlayedAlbum, resolveLastPlayedTrackIndex, markLibraryReady,
} from './launch/intro.js';
import { askLocation, fallbackSun, toggleSleevePull, toggleMotion } from './sundown/location.js';
import { openSleepSheet, closeSleepSheet } from './player/sleep-timer.js';
import { ensureContext, applyCharacter } from './audio/engine.js';
import { setMode } from './audio/mode.js';
import { play, pause, seek } from './player/transport.js';
import { nextTrack, prevTrack, toggleShuffle, cycleRepeat } from './player/controls.js';
import {
  bgPrime, bgUpdateUI, toggleBgAudio,
} from './player/background.js';
import { drawSun, frame } from './player/clock.js';
import { wireSpinToScrub, toggleScratch } from './player/scrub.js';
import {
  closeShareSheet, openPlayerShareSheet, closePlayerShareSheet,
  queueShareRender, queuePlayerShareRender, shareDoSave, shareDoShare, shareDoCopy, shareSelectedFormat,
} from './share/sheet.js';
import { DB } from './storage/idb.js';
import { storage, tracks } from './storage/repo.js';
import { queueSave, restoreMeta } from './storage/meta.js';
import { persistProfile, renderProfile } from './profile/screens.js';
import { closeSocialAuth } from './profile/settings.js';
import { popSocialScreen, closeRecordSheet } from './social/screens/friend-store.js';
import { REDUCED } from './util/motion.js';
import { updateShellAlbum, updateChromeInset } from './shell/mini-player.js';
import { showRoute } from './shell/routes.js';
import {
  openSearchField, closeSearchField, isSearchFieldOpen,
  openAddMenu, closeAddMenu, isAddMenuOpen,
} from './shell/header.js';
import {
  openPlayer, closePlayer, morphInFlight, interruptMorph,
} from './shell/player-overlay.js';
import { runStartSequence, interruptStartSequence } from './shell/start-sequence.js';
import { gfHandoffInFlight, interruptGatefoldHandoff } from './shell/handoff.js';

/* REDUCED moved to src/util/motion.js (step 7b), alongside easeOutCubic.

   metal tiers (albumMetalFor/trackMetalFor/metalBackground/setDiscBackground,
   plus the threshold/color tables) moved to src/record-art/metals.js
   (step 6b). */

/* look switching (availableLooks/resolveLook/setLookPref/lookLabel/
   openLookPicker/closeLookPicker/applyDiscVariant) moved to
   src/record-art/looks.js (step 6b). */

/* The "profile tab" / S5 sealed-records / thumbnails / achievements /
   duplicate-scan leftover comments that used to sit here were pure
   documentation of code already moved out in steps 5c/5d/6b — each
   destination module (profile/screens.js, library/sealed.js,
   library/thumbs.js, history/achievements.js, library/duplicate-scan.js)
   already carries its own copy of the relevant note, so this was a stale
   duplicate with no code under it. Removed in step 7a rather than moved
   again.

   Persistence (queueSave/saveTimer/saveMeta/restoreMeta/applyPrefs) moved
   to src/storage/meta.js (step 7a). */

/* Session tracking and played-duration tracking moved to
   src/history/sessions.js and src/history/played.js (step 5c). */

/* Metadata editing (the sidecar-overlay section: applyEdit, revertTrack,
   the undo banner, the edit sheet) moved to src/library/edit.js (step 5d). */

/* Deletion (deleteTracks, deleteAlbum/deleteArtist, forgetLibrary) moved to
   src/library/delete.js (step 5d). clearListeningHistory moved to
   src/history/clear.js (step 5c). */

/* The rest of "visible queue: reorder, remove, play next / add"
   (queueInsert/playNext/addToQueue, queueRemoveAt, queueMove, the
   queue-sheet UI) moved into src/player/queue.js (step 5e). */

/* nextTrack/prevTrack/toggleShuffle/cycleRepeat moved to
   src/player/controls.js (step 6c). */

/* Navigation shell: mini-player, full-player overlay, sleeve pull
   (SLEEVE_ANIM, renderMiniPlayer, updateChromeInset, updateShellAlbum) moved
   to src/shell/mini-player.js (step 7b). GATEFOLD_ANIM (the gatefold's own
   open/close timing) moved to src/gatefold/view.js alongside the gatefold
   itself (step 7e). */

/* Gatefold-to-player hand-off (HANDOFF_ANIM, runGatefoldHandoff,
   interruptGatefoldHandoff and helpers) moved to src/shell/handoff.js
   (step 7b). */

/* Put-away (runPutAwaySequence/putAwayInstant/shouldPutAway/clearSpinDown)
   moved to src/shell/put-away.js (step 7b). easeOutCubic moved to
   src/util/motion.js instead, alongside REDUCED (step 7b) — it's a generic
   easing helper only player/clock.js's render loop actually calls, not
   put-away-specific despite sitting physically in this section. */

/* Launch intro (runLaunchSequence, attachLaunchSettingRow,
   toggleLaunchIntro, resolveLastPlayedAlbum, resolveLastPlayedTrackIndex,
   the libraryReadyResolve/libraryReadyPromise pair now behind
   markLibraryReady()) moved to src/launch/intro.js (step 7c).
   toggleScratch sat in this same section only by physical accident (it's
   not launch-intro code) -- moved to src/player/scrub.js instead, the
   module that already owns Scratch. */

/* The player overlay (openPlayerViaSheet, openPlayer, closePlayer,
   morphInFlight, runMorphOpen, interruptMorph) sat under this "launch
   intro" header only by physical accident — moved to
   src/shell/player-overlay.js (step 7b). */

/* Background playback (background.js/bgPrime/bgRouteActive/bgIdleNow/
   bgPosition/bgSync/bgUpdateUI/toggleBgAudio/applyBgAudioSetting/
   applyOutputRoute, and the Media Session / lock-screen handlers) moved to
   src/player/background.js (step 6c). */

/* The "library" section's row/group renderers (songRow/groupRow) and
   selection/deletion UI helpers (enterSelectMode/exitSelectMode, the row
   overflow menu, the shared confirm dialog, applyTrackNumbersInOrder,
   togglePick, the manual-order mover controls, sortBar, renderAlbumDetail)
   moved to src/library/view.js (step 7d), alongside renderTracks() itself
   (see that header's own note below for where renderTracks() used to
   physically sit). */

/* ================= S3: gatefold album view (opens from the crate) =========
   and the sealed-record sheet -- moved to src/gatefold/view.js and
   src/gatefold/sealed-sheet.js (step 7e). See that pair's own header
   comments for why they're split the way they are, and for the
   misleading-header history this section and the ones below share. */

/* The crate view (openCrateAlbum, renderCrate, renderCrateFlat,
   applyCrateMiniInset, centerEmptyState) sat under the old "S3: gatefold
   album view" header only by physical accident -- moved to
   src/crate/view.js (step 7c). */

/* renderTracks() -- the function that actually draws the Songs/Artists/
   Playlists/crate tabs, search results, and the breadcrumb/drill-down
   between them -- used to sit here, inside this misleadingly-named
   "S3: gatefold album view" header (which also covered the gatefold and
   the sealed-record sheet, moved separately in step 7e -- see above).
   Moved to src/library/view.js (step 7d), alongside its own row/group
   renderers and selection/deletion helpers (see the old "library" header's
   own note above). */

/* Profile tab rendering (persistProfile, formatDisplayName, fmtCount,
   topTile, badges, the socialAuth wizard, renderSocialSettingsScreen, the
   storefront, and the real profile screens -- renderProfile,
   renderProfileHome, renderProfileExtras, renderTopAlbumsScreen,
   renderTopSongsScreen, renderCollectionScreen, which used to sit under
   the "Social Step E: demo mode" header below only because that's
   physically where they ended up) moved to src/profile/ (badges.js,
   storefront.js, settings.js, screens.js -- step 6e). persistTrackLastPlayed
   (the tiny "profile tab" section) moved there too, into screens.js.

   Social Step D (friend store, locked state, record sheet, home feed --
   socialNav, openFriendStore, openRecordSheet/closeRecordSheet, renderHome,
   the now-spinning subscription) moved to src/social/screens/
   (friend-store.js, home.js -- step 6e).

   installSocialDemo (Social Step E's only other export) moved to
   src/social/demo.js, loaded with a dynamic import() only when
   ?social=demo is present, so it never reaches the main bundle real
   users download -- see restoreLibrary() below. */

/* Share images (the style x format system, the My Crate card, the Now
   Playing card, and the share sheets' wiring) moved to src/share/
   (styles.js, crate-card.js, now-playing-card.js, sheet.js — step 6d). */

/* Navigation shell: header actions, search field, add menu
   (isLibraryRouteVisible/isProfileRouteVisible/showRoute moved to
   src/shell/routes.js; updateHeaderActionsAvailability/
   updateLibTabsForLayout/refreshLibraryTools/the header search field/the
   header + menu moved to src/shell/header.js — step 7b). These sat under
   the old "share image"/"setMode" header only because that's physically
   where they were in the file, not because they're share-image or mode
   code. */

/* ================= wiring ================= */
(function init(){
  renderSearchChips();
  $('#play').addEventListener('click', async ()=>{
    if(!S.playing) bgPrime();
    if(!S.ctx) await ensureContext(null);
    if(S.playing) pause();
    // the sleeve is covering an empty platter — bring the disc back out
    // before playing, same ceremony as picking a track from the library
    else if(S.platterEmpty) runStartSequence(current(), updateShellAlbum(current()), play);
    else play();
  });
  $('#next').addEventListener('click', nextTrack);
  $('#prev').addEventListener('click', prevTrack);
  $('#shuffle').addEventListener('click', ()=>{ toggleShuffle(); queueSave(); });
  $('#repeat').addEventListener('click', ()=>{ cycleRepeat(); queueSave(); });
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', ()=>{
    S.view.mode = b.dataset.view; S.view.group = null; S.view.artistAlbum = null; S.view.playlist = null;
    S.view.person = null; S.view.crateLooseIdx = null; S.view.picking = false;
    renderTracks();
  }));
  document.querySelectorAll('#libLayoutToggle [data-layout]').forEach(b => b.addEventListener('click', ()=>{
    S.libraryLayout = b.dataset.layout;
    document.querySelectorAll('#libLayoutToggle [data-layout]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    // the first tab's identity (crate vs flat albums) follows the layout —
    // if that's where the user currently is, follow it there too; otherwise
    // (Songs/Artists/Playlists, or drilled into something) leave them put
    if(S.view.mode === 'crate' || (S.view.mode === 'albums' && S.view.group === null)){
      S.view.mode = (S.libraryLayout === 'crate') ? 'crate' : 'albums';
    }
    queueSave();
    renderTracks();
  }));
  document.querySelectorAll('#crateGroupToggle [data-group]').forEach(b => b.addEventListener('click', ()=>{
    if(b.style.display === 'none') return;
    S.crateGroup = b.dataset.group;
    invalidateCrateModel();
    queueSave();
    renderTracks();
  }));
  document.querySelectorAll('#sidesToggle [data-sides]').forEach(b => b.addEventListener('click', ()=>{
    S.albumSides = b.dataset.sides === 'on';
    document.querySelectorAll('#sidesToggle [data-sides]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave();
  }));
  document.querySelectorAll('#sealedToggle [data-sealed]').forEach(b => b.addEventListener('click', ()=>{
    S.sealedRecords = b.dataset.sealed === 'on';
    document.querySelectorAll('#sealedToggle [data-sealed]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave();
    renderTracks();
  }));
  document.querySelectorAll('#playFullToggle [data-playfull]').forEach(b => b.addEventListener('click', ()=>{
    S.playInFullPlayer = b.dataset.playfull === 'on';
    document.querySelectorAll('#playFullToggle [data-playfull]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave();
  }));
  $('#scrub').addEventListener('input', ()=>{ S.scrubbing = true; });
  $('#scrub').addEventListener('change', e=>{
    S.scrubbing = false;
    const t = current(); if(t) seek((t.duration || 0) * e.target.value/1000);
  });
  $('#modeVinyl').addEventListener('click', ()=>{ setMode('vinyl'); queueSave(); });
  $('#modePure').addEventListener('click', ()=>{ setMode('pure'); queueSave(); });

  document.querySelectorAll('.tabbar-btn').forEach(b => b.addEventListener('click', ()=> showRoute(b.dataset.route)));

  $('#autoOn').addEventListener('click', ()=>{
    S.auto = true; $('#autoOn').setAttribute('aria-pressed','true'); $('#autoOff').setAttribute('aria-pressed','false');
    $('#manualRow').style.display = 'none';
    $('#autoDesc').textContent = 'The platter eases down across twilight.';
  });
  $('#autoOff').addEventListener('click', ()=>{
    S.auto = false; $('#autoOn').setAttribute('aria-pressed','false'); $('#autoOff').setAttribute('aria-pressed','true');
    $('#manualRow').style.display = 'block';
    $('#autoDesc').textContent = 'You are driving the platter yourself.';
  });
  $('#manual').addEventListener('input', e=>{
    S.manualRate = e.target.value/1000;
    $('#manualOut').textContent = S.manualRate.toFixed(3) + '×';
  });

  document.querySelectorAll('[data-target]').forEach(b => b.addEventListener('click', ()=>{
    S.target = parseFloat(b.dataset.target); queueSave();
    document.querySelectorAll('[data-target]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  document.querySelectorAll('[data-pace]').forEach(b => b.addEventListener('click', ()=>{
    S.pace = b.dataset.pace; queueSave();
    document.querySelectorAll('[data-pace]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('#pacingDesc').textContent = S.pace === 'window'
      ? 'Spread across the whole twilight window.'
      : 'Held back, then a felt drop near the end.';
  }));

  $('#preview').addEventListener('input', e=>{
    const v = +e.target.value;
    if(!S.sun.ok || v === 0){ S.previewMin = 0; $('#previewOut').textContent = 'Live'; return; }
    const span = (S.sun.dusk - S.sun.set)/60000;
    const from = (S.sun.set - Date.now())/60000 - 5;
    S.previewMin = from + (v/100) * (span + 12);
    const c = nowClock();
    $('#previewOut').textContent = c.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
  });
  $('#liveBtn').addEventListener('click', ()=>{ S.previewMin = 0; $('#preview').value = 0; $('#previewOut').textContent = 'Live'; });

  const charMap = {wow:'wowOut', sat:'satOut', soft:'softOut', comp:'compOut'};
  Object.keys(charMap).forEach(k => {
    $('#' + k).addEventListener('input', e=>{
      S.char[k] = e.target.value/100;
      $('#' + charMap[k]).textContent = e.target.value + '%';
      applyCharacter(); queueSave();
    });
  });
  const presets = {light:{wow:.12,sat:.18,soft:.22,comp:.2}, classic:{wow:.30,sat:.35,soft:.40,comp:.35}, worn:{wow:.62,sat:.6,soft:.68,comp:.55}};
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', ()=>{
    const p = presets[b.dataset.preset];
    Object.keys(p).forEach(k => {
      S.char[k] = p[k]; $('#' + k).value = Math.round(p[k]*100);
      $('#' + charMap[k]).textContent = Math.round(p[k]*100) + '%';
    });
    applyCharacter(); queueSave();
    if(S.mode !== 'vinyl') setMode('vinyl');
  }));

  $('#scratchBtn').addEventListener('click', toggleScratch);
  $('#motionBtn').addEventListener('click', toggleMotion);
  $('#sleevePullBtn').addEventListener('click', toggleSleevePull);
  $('#launchIntroBtn').addEventListener('click', toggleLaunchIntro);
  attachLaunchSettingRow();
  $('#bgAudioBtn').addEventListener('click', toggleBgAudio);
  bgUpdateUI();
  $('#floor').addEventListener('input', e=>{ S.motion.floor = e.target.value/100; $('#floorOut').textContent = e.target.value + '%'; });
  $('#maxSpeed').addEventListener('input', e=>{
    S.motion.max = +e.target.value;
    $('#maxSpeedOut').textContent = Math.round(S.motion.max*2.23694) + ' mph';
  });

  $('#pick').addEventListener('click', ()=> $('#file').click());
  $('#pickFolder').addEventListener('click', ()=> $('#folderFile').click());
  $('#tone').addEventListener('click', addTestTone);
  $('#tone2').addEventListener('click', addTestTone);
  $('#file').addEventListener('change', e=> addFiles(e.target.files));
  $('#folderFile').addEventListener('change', e=> addFiles(e.target.files));

  // Drag-and-drop over the library route — the nearest web equivalent to
  // "Open in Miziki"/UIFileSharingEnabled, which have no web API (see
  // PLAYBACK/IMPORT spec §2). Folders dropped via the OS file manager are
  // walked recursively through the DataTransferItem entry API.
  const libRoute = $('#route-library');
  ['dragenter','dragover'].forEach(evt => libRoute.addEventListener(evt, e => {
    e.preventDefault(); libRoute.classList.add('drag-over');
  }));
  ['dragleave','drop'].forEach(evt => libRoute.addEventListener(evt, e => {
    e.preventDefault(); libRoute.classList.remove('drag-over');
  }));
  libRoute.addEventListener('drop', async e => {
    const items = e.dataTransfer && e.dataTransfer.items;
    const files = items ? await filesFromDataTransferItems(items) : Array.from(e.dataTransfer.files || []);
    if(files.length) addFiles(files);
  });

  let armed = false, armTimer = null;
  $('#forget').addEventListener('click', async e => {
    if(!armed){
      armed = true; e.target.textContent = 'TAP AGAIN';
      armTimer = setTimeout(()=>{ armed = false; e.target.textContent = 'FORGET'; }, 4000);
      return;
    }
    clearTimeout(armTimer); armed = false; e.target.textContent = 'FORGET';
    await forgetLibrary();
  });

  $('#clearHistoryBtn').addEventListener('click', ()=>{
    $('#clearHistoryOverlay').classList.add('open');
    $('#clearHistoryOverlay').setAttribute('aria-hidden', 'false');
  });
  const closeClearHistory = () => {
    $('#clearHistoryOverlay').classList.remove('open');
    $('#clearHistoryOverlay').setAttribute('aria-hidden', 'true');
  };
  $('#clearHistoryClose').addEventListener('click', closeClearHistory);
  $('#clearHistoryCancel').addEventListener('click', closeClearHistory);
  $('#clearOrphanedBtn').addEventListener('click', async ()=>{ closeClearHistory(); await clearListeningHistory(true); });
  $('#clearAllHistoryBtn').addEventListener('click', async ()=>{ closeClearHistory(); await clearListeningHistory(false); });

  $('#dupClose').addEventListener('click', ()=>closeDupOverlay('skip'));
  $('#dupKeepBoth').addEventListener('click', ()=>closeDupOverlay('keep'));
  $('#dupReplace').addEventListener('click', ()=>closeDupOverlay('replace'));
  $('#dupSkip').addEventListener('click', ()=>closeDupOverlay('skip'));

  $('#scanDuplicatesBtn').addEventListener('click', openDuplicateScan);
  $('#dupScanClose').addEventListener('click', closeDuplicateScan);

  let searchDebounce = null;
  $('#librarySearch').addEventListener('input', ()=>{
    updateSearchChipsVisibility();
    $('#hdrSearchClear').style.display = $('#librarySearch').value ? '' : 'none';
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderTracks, 120);
  });
  $('#librarySearch').addEventListener('focus', updateSearchChipsVisibility);
  $('#librarySearch').addEventListener('blur', ()=>{ setTimeout(updateSearchChipsVisibility, 120); });

  // header search icon / Cancel / × (S1 §2.1)
  $('#hdrSearchBtn').addEventListener('click', openSearchField);
  $('#hdrSearchCancel').addEventListener('click', ()=>{
    $('#librarySearch').value = '';
    $('#hdrSearchClear').style.display = 'none';
    closeSearchField();
    renderTracks();
  });
  $('#hdrSearchClear').addEventListener('click', ()=>{
    $('#librarySearch').value = '';
    $('#hdrSearchClear').style.display = 'none';
    $('#librarySearch').focus();
    updateSearchChipsVisibility();
    renderTracks();
  });

  // header + menu: Add songs / Add folder (S1 §3). The file-picker .click()
  // must fire synchronously inside this user-gesture handler (iOS Safari).
  $('#hdrAddBtn').addEventListener('click', ()=> isAddMenuOpen() ? closeAddMenu() : openAddMenu());
  $('#addScrim').addEventListener('click', closeAddMenu);
  $('#addSongsRow').addEventListener('click', ()=>{ closeAddMenu(); $('#file').click(); });
  $('#addFolderRow').addEventListener('click', ()=>{ closeAddMenu(); $('#folderFile').click(); });
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    if(isGatefoldOpen()) closeGatefold();
    else if(isSealedSheetOpen()) closeSealedSheet();
    else if(isAddMenuOpen()){ closeAddMenu(); $('#hdrAddBtn').focus(); }
    else if(isSearchFieldOpen()){ $('#librarySearch').value = ''; closeSearchField(); renderTracks(); }
  });

  $('#gfBack').addEventListener('click', closeGatefold);
  $('#gfFlatBack').addEventListener('click', closeGatefold);
  $('#gfLeftCue').addEventListener('click', () => gatefoldSwitchPanel('left'));
  document.querySelectorAll('#gfPanelToggle [data-panel], #gfFlatSeg [data-panel]').forEach(b =>
    b.addEventListener('click', () => gatefoldSwitchPanel(b.dataset.panel)));
  window.addEventListener('resize', updateGatefoldScale);
  $('#sealSheetClose').addEventListener('click', closeSealedSheet);

  // Library tools disclosure panel (S1 §5)
  $('#libToolsToggle').addEventListener('click', ()=>{
    const open = $('#libToolsPanel').classList.toggle('open');
    $('#libToolsToggle').setAttribute('aria-expanded', String(open));
  });

  $('#selectToggle').addEventListener('click', enterSelectMode);
  $('#selectCancel').addEventListener('click', exitSelectMode);
  $('#selectEdit').addEventListener('click', ()=>{
    if(S.editSelection.size) openEditSheet(Array.from(S.editSelection));
  });
  $('#selectNumber').addEventListener('click', ()=>{
    if(S.editSelection.size) applyTrackNumbersInOrder();
  });
  $('#selectDelete').addEventListener('click', ()=>{
    const ids = Array.from(S.editSelection);
    if(!ids.length) return;
    openConfirmDelete('batch', ids.length, null, async () => { await deleteTracks(ids); exitSelectMode(); });
  });

  $('#rowMenuClose').addEventListener('click', closeRowMenu);
  $('#rowMenuEdit').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    if(id) openEditSheet([id]);
  });
  $('#rowMenuCredits').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    const t = S.tracks[idxOf(id)]; if(t) openCreditsSheet(t);
  });
  $('#rowMenuFav').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    if(id) toggleFavorite(id);
  });
  $('#rowMenuRemove').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    const t = S.tracks[idxOf(id)]; if(!t) return;
    openConfirmDelete('song', 1, t.tags.title, async () => { await deleteTracks([id]); });
  });
  $('#rowMenuPlayNext').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    const i = idxOf(id); if(i >= 0) playNext(i);
  });
  $('#rowMenuAddQueue').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    const i = idxOf(id); if(i >= 0) addToQueue(i);
  });

  $('#confirmClose').addEventListener('click', closeConfirmDelete);
  $('#confirmCancel').addEventListener('click', closeConfirmDelete);
  $('#confirmGo').addEventListener('click', async ()=>{
    const action = confirmDeleteAction;
    closeConfirmDelete();
    if(action) await action();
  });

  $('#editCurrentBtn').addEventListener('click', ()=>{ const t = current(); if(t) openEditSheet([t.id]); });
  $('#trackInfoBtn').addEventListener('click', ()=>{ const t = current(); if(t) openCreditsSheet(t); });
  $('#creditsClose').addEventListener('click', closeCreditsSheet);
  $('#socialAuthClose').addEventListener('click', closeSocialAuth);
  $('#socialNavBack').addEventListener('click', popSocialScreen);
  $('#recordSheetClose').addEventListener('click', closeRecordSheet);
  $('#playerFavBtn').addEventListener('click', ()=>{ const t = current(); if(t) toggleFavorite(t.id); });
  $('#miniFavBtn').addEventListener('click', e => { e.stopPropagation(); const t = current(); if(t) toggleFavorite(t.id); });
  $('#sleepTimerBtn').addEventListener('click', openSleepSheet);
  $('#sleepClose').addEventListener('click', closeSleepSheet);
  $('#editClose').addEventListener('click', closeEditSheet);
  $('#editSave').addEventListener('click', saveEditSheet);
  $('#editRevert').addEventListener('click', async ()=>{
    const target = S.editTarget;
    if(!target || target.batch) return;
    await revertTrack(target.trackIds[0]);
    closeEditSheet();
  });
  $('#editArtPick').addEventListener('click', ()=> $('#editArtFile').click());
  $('#editArtFile').addEventListener('change', async e=>{
    const file = e.target.files[0];
    e.target.value = '';
    if(!file) return;
    try{
      const blob = await cropSquareImage(file, 800);
      S.editArtBlob = blob;
      renderEditArtPreview(URL.createObjectURL(blob));
    }catch(err){ /* bad image — leave whatever preview was already showing */ }
  });
  $('#undoBtn').addEventListener('click', undoLastEdit);

  $('#profilePicFile').addEventListener('change', async e=>{
    const file = e.target.files[0];
    e.target.value = '';
    if(!file) return;
    try{
      const blob = await cropSquareImage(file, 500);
      if(S.profile.art) try{ URL.revokeObjectURL(S.profile.art); }catch(err){}
      S.profile.artBlob = blob;
      S.profile.art = URL.createObjectURL(blob);
      await persistProfile();
      renderProfile();
    }catch(err){ /* bad image — leave the existing picture as-is */ }
  });

  $('#shareClose').addEventListener('click', closeShareSheet);
  document.querySelectorAll('#shareToggles button').forEach(b => b.addEventListener('click', ()=>{
    const key = b.dataset.section;
    S.shareSelection[key] = !S.shareSelection[key];
    b.setAttribute('aria-pressed', String(S.shareSelection[key]));
    queueShareRender();
  }));
  document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(b => b.addEventListener('click', ()=>{
    S.shareStyle = b.dataset.style;
    document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.style === S.shareStyle)));
    queueSave(); queueShareRender();
  }));
  document.querySelectorAll('#shareFormatSeg [data-format]').forEach(b => b.addEventListener('click', ()=>{
    S.shareFormat = b.dataset.format;
    document.querySelectorAll('#shareFormatSeg [data-format]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave(); queueShareRender();
  }));
  $('#shareShareBtn').addEventListener('click', () => shareDoShare($('#shareCanvas'), 'miziki-crate-' + shareSelectedFormat('shareFormatSeg','square') + '.png'));
  $('#shareSave').addEventListener('click', () => shareDoSave($('#shareCanvas'), 'miziki-crate-' + shareSelectedFormat('shareFormatSeg','square') + '.png'));
  $('#shareCopy').addEventListener('click', () => shareDoCopy($('#shareCanvas')));

  $('#playerShareBtn').addEventListener('click', openPlayerShareSheet);
  $('#playerShareClose').addEventListener('click', closePlayerShareSheet);
  $('#lookBtn').addEventListener('click', openLookPicker);
  $('#queueBtn').addEventListener('click', openQueueSheet);
  $('#miniQueueBtn').addEventListener('click', openQueueSheet);
  $('#queueClose').addEventListener('click', closeQueueSheet);
  $('#lookClose').addEventListener('click', closeLookPicker);
  $('#sortMenuClose').addEventListener('click', closeSortMenu);
  document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(b => b.addEventListener('click', ()=>{
    S.shareStyle = b.dataset.style;
    document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.style === S.shareStyle)));
    queueSave(); queuePlayerShareRender();
  }));
  document.querySelectorAll('#playerShareFormatSeg [data-format]').forEach(b => b.addEventListener('click', ()=>{
    S.shareFormat = b.dataset.format;
    document.querySelectorAll('#playerShareFormatSeg [data-format]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave(); queuePlayerShareRender();
  }));
  $('#playerShareShareBtn').addEventListener('click', () => shareDoShare($('#playerShareCanvas'), 'miziki-now-playing-' + shareSelectedFormat('playerShareFormatSeg','story') + '.png'));
  $('#playerShareSave').addEventListener('click', () => shareDoSave($('#playerShareCanvas'), 'miziki-now-playing-' + shareSelectedFormat('playerShareFormatSeg','story') + '.png'));
  $('#playerShareCopy').addEventListener('click', () => shareDoCopy($('#playerShareCanvas')));

  // backgrounding is the last reliable moment before the OS can kill the tab —
  // write the in-progress session synchronously, not on a timer
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden') touchActiveSession();
  });

  wireSpinToScrub();

  $('#miniTap').addEventListener('click', openPlayer);
  $('#miniPlay').addEventListener('click', async ()=>{
    if(!S.playing) bgPrime();
    if(!S.ctx) await ensureContext(null);
    if(S.playing) pause();
    else if(S.platterEmpty && S.playerOpen) runStartSequence(current(), updateShellAlbum(current()), play);
    else if(S.platterEmpty){
      // the full player isn't open to show the pull, so there's nothing to
      // animate — skip straight to the pulled-out end state, same as
      // advance() already does for an ordinary track change with the
      // player closed, rather than running an unseen ~3-5s ceremony first
      S.platterEmpty = false;
      $('#platterBox').classList.remove('disc-hidden');
      play();
    }
    else play();
  });
  $('#playerDismiss').addEventListener('click', closePlayer);
  $('#playerOverlay').addEventListener('pointerdown', ()=>{
    interruptStartSequence();            // pull/return-to-sleeve: snap to end state
    if(morphInFlight()) interruptMorph(); // morph: reverse cleanly instead
    if(gfHandoffInFlight()) interruptGatefoldHandoff();   // hand-off flight: land instantly
  }, {capture:true});

  setMode('vinyl');
  fallbackSun();
  askLocation();
  drawSun();
  updateChromeInset();
  window.addEventListener('resize', updateChromeInset);
  requestAnimationFrame(frame);
  restoreLibrary();   // runs underneath the launch intro below; never waits on it
  // REDUCED and document.hidden are known synchronously; S.launchIntro's
  // persisted value isn't (it loads inside restoreLibrary()), so
  // runLaunchSequence() re-checks it itself once that's resolved
  if(REDUCED || document.hidden) $('#launchOverlay').remove();
  else runLaunchSequence();
})();

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
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
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
  markLibraryReady();   // from here on the launch intro's library variant has what it needs
  if(S.tracks.length){
    // the mini player should agree with the launch intro's title screen —
    // both show what was last played, not just the first file in the
    // library (see LAUNCH spec C5)
    const lastAlbum = resolveLastPlayedAlbum();
    const lastIdx = lastAlbum !== null ? resolveLastPlayedTrackIndex(lastAlbum) : -1;
    setQueue(allIdx(), lastIdx >= 0 ? lastIdx : 0, false);
    note.textContent = S.tracks.length + (S.tracks.length === 1 ? ' track' : ' tracks')
      + ' restored from this device. Tracks are decoded as you play them, so opening Miziki stays quick.';
  } else {
    note.textContent = 'Your library will be kept on this device. Add it to your Home Screen so iOS does not clear it.';
  }
  await MizikiSocial.init({ url: SOCIAL_SUPABASE_URL, anonKey: SOCIAL_SUPABASE_ANON_KEY,
    env: { S, DB, albumKey, trackTier, albumMetalFor } });
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
