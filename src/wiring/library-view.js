/* ================= wiring: library view =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the Songs/Artists/
   Playlists/Crate view-mode tabs, the library layout toggle, the crate
   group toggle, the album-sides/sealed-records/play-in-full-player
   toggles, the library tools disclosure panel, select mode, the row
   overflow menu, and the shared confirm-delete dialog. Every function
   called here was already a real export of its owning module. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { idxOf } from '../library/model.js';
import { queueSave } from '../storage/meta.js';
import { invalidateCrateModel, nextCrateGroup } from '../crate/model.js';
import {
  renderTracks, enterSelectMode, exitSelectMode, closeRowMenu,
  openConfirmDelete, closeConfirmDelete, rowMenuTrackId, confirmDeleteAction,
  applyTrackNumbersInOrder,
} from '../library/view.js';
import { deleteTracks } from '../library/delete.js';
import { openEditSheet } from '../library/edit.js';
import { openCreditsSheet } from '../library/credits.js';
import { toggleFavorite } from '../library/favorites.js';
import { playNext, addToQueue } from '../player/queue.js';
import { openLibOverflowMenu, isLibOverflowMenuOpen } from '../shell/header.js';
import { closeLayer, forceCloseLayer } from '../shell/nav-stack.js';

export function wireLibraryView(){
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
  // RF8 (docs/12_REFINE.md): #crateGroupToggleTab is now the one home for
  // this control (the old Profile › Library tools copy, #crateGroupToggle,
  // was removed).
  // Crate-order chip: one tap steps A–Z → Genre → Decade → A–Z. Genre is
  // skipped when the library has no genre tags (the same rule
  // updateCrateGroupToggleUI() applies), via nextCrateGroup().
  const groupChip = document.getElementById('crateGroupToggleTab');
  if(groupChip) groupChip.addEventListener('click', ()=>{
    S.crateGroup = nextCrateGroup(S.crateGroup);
    invalidateCrateModel();
    queueSave();
    renderTracks();
  });
  // CR10 (docs/13_CRATE.md point 3): the desktop sidebar's BINS list —
  // "each jumps the crate." #sidebarBins itself is static markup (never
  // torn down); its [data-bin] rows are rebuilt on every renderTracks()
  // call (shell/sidebar.js's renderSidebarBins(), the same shape as the
  // playlists list right next to it), so this wires one delegated
  // listener on the static container rather than re-binding rows that
  // get thrown away and rebuilt on every render. Switches the library
  // view to the crate the same way a plain [data-view] tab click above
  // does, then sets the pending jump key renderCrate() (src/crate/
  // view.js) consumes on its very next render in place of the usual
  // cold-start/anchor position.
  const sidebarBins = document.getElementById('sidebarBins');
  if(sidebarBins) sidebarBins.addEventListener('click', e => {
    const b = e.target.closest('[data-bin]');
    if(!b) return;
    S.view.mode = 'crate'; S.view.group = null; S.view.artistAlbum = null; S.view.playlist = null;
    S.view.person = null; S.view.crateLooseIdx = null; S.view.picking = false;
    S.crate.pendingJumpKey = b.dataset.bin;
    renderTracks();
  });
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

  // Library tools disclosure panel (S1 §5)
  $('#libToolsToggle').addEventListener('click', ()=>{
    const open = $('#libToolsPanel').classList.toggle('open');
    $('#libToolsToggle').setAttribute('aria-expanded', String(open));
  });

  // RF8 (docs/12_REFINE.md): the library header's own "···" overflow —
  // Select and Library tools both moved here off the tabs row.
  $('#hdrOverflowBtn').addEventListener('click', ()=> isLibOverflowMenuOpen() ? closeLayer('lib-overflow-menu') : openLibOverflowMenu());
  $('#libOverflowScrim').addEventListener('click', () => closeLayer('lib-overflow-menu'));
  $('#libOverflowToolsBtn').addEventListener('click', ()=>{
    forceCloseLayer('lib-overflow-menu');
    if(!$('#libToolsPanel').classList.contains('open')) $('#libToolsToggle').click();
    $('#libTools').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#selectToggle').addEventListener('click', ()=>{ forceCloseLayer('lib-overflow-menu'); enterSelectMode(); });
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
}
