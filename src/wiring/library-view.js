/* ================= wiring: library view =================
   The Songs/Artists/Playlists/Crate view-mode tabs, the library layout
   toggle, the crate group toggle, the album-sides/sealed-records/
   play-in-full-player toggles, the library tools disclosure panel,
   select mode, the row overflow menu, and the shared confirm-delete
   dialog. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { queueSave } from '../storage/meta.js';
import { invalidateCrateModel, nextCrateGroup } from '../crate/model.js';
import {
  renderTracks, enterSelectMode, exitSelectMode, selectAllVisible,
  openConfirmDelete, closeConfirmDelete, confirmDeleteAction,
  applyTrackNumbersInOrder,
} from '../library/view.js';
import { deleteTracks } from '../library/delete.js';
import { openEditSheet } from '../library/edit.js';
import { openLibraryToolsPanel, isLibraryToolsPanelOpen } from '../shell/header.js';
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
  $('#sidesToggle').addEventListener('click', ()=>{
    S.albumSides = !S.albumSides;
    $('#sidesToggle').setAttribute('aria-checked', String(S.albumSides));
    queueSave();
  });
  $('#sealedToggle').addEventListener('click', ()=>{
    S.sealedRecords = !S.sealedRecords;
    $('#sealedToggle').setAttribute('aria-checked', String(S.sealedRecords));
    queueSave();
    renderTracks();
  });
  $('#playFullToggle').addEventListener('click', ()=>{
    S.playInFullPlayer = !S.playInFullPlayer;
    $('#playFullToggle').setAttribute('aria-checked', String(S.playInFullPlayer));
    queueSave();
  });

  // Library tools disclosure panel (S1 §5)
  $('#libToolsToggle').addEventListener('click', ()=>{
    const open = $('#libToolsPanel').classList.toggle('open');
    $('#libToolsToggle').setAttribute('aria-expanded', String(open));
  });

  // UN3 (docs/36_UNIFORMITY.md point 6, decision 11): the library
  // header's own "···" opens Library tools directly now (shell/header.js's
  // openLibraryToolsPanel()) -- #libOverflowMenu and its scrim are gone.
  $('#hdrOverflowBtn').addEventListener('click', ()=> isLibraryToolsPanelOpen() ? closeLayer('lib-tools-sheet') : openLibraryToolsPanel());
  // UN3 point 5: the artist page's own ⋯ menu -- opened from
  // library/view.js's own openArtistMoreMenu(), only the scrim's
  // tap-to-dismiss needs wiring here.
  $('#artistMoreMenuScrim').addEventListener('click', () => closeLayer('artist-more-menu'));
  // UN3 point 6: "Select" moves from the old small popover into a
  // navRow at the top of the Library tools sheet itself (a judgment
  // call -- see miziki.html's own comment on #libToolsSheetOverlay).
  $('#libToolsSelectRow').addEventListener('click', ()=>{ forceCloseLayer('lib-tools-sheet'); enterSelectMode(); });
  $('#selectCancel').addEventListener('click', exitSelectMode);
  $('#selectAll').addEventListener('click', selectAllVisible);
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

  // UN3 (docs/36_UNIFORMITY.md): the row menu's own action rows (Play
  // next/Add to queue/Favorite/Credits and notes/Edit info/Remove from
  // library) are now built and wired inline by library/view.js's
  // openRowMenu() each time it opens, since the menu is a real list-menu
  // sheet rebuilt per track rather than a fixed set of ids — only the ×
  // stays a static element with its own id.
  $('#rowMenuClose').addEventListener('click', () => closeLayer('row-menu'));

  $('#confirmClose').addEventListener('click', closeConfirmDelete);
  $('#confirmCancel').addEventListener('click', closeConfirmDelete);
  $('#confirmGo').addEventListener('click', async ()=>{
    const action = confirmDeleteAction;
    closeConfirmDelete();
    if(action) await action();
  });
}
