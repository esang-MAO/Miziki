/* ================= wiring: gatefold and sealed-record sheet =================
   The gatefold's own back/panel/resize controls and the sealed-record
   sheet's close button. The global Escape-key handler lives in
   src/shell/nav-stack.js (NV2, docs/11_SMOOTH_NAVIGATION.md) instead — a
   single generic handler that closes whichever registered layer is
   topmost, for every overlay in the app — not here. */
import { $ } from '../util/dom.js';
import {
  gatefoldSwitchPanel, updateGatefoldScale, gatefoldToggleTurnedOver,
  currentGatefoldAlbumId, refreshGatefoldBackCover,
  saveLinerEditSheet, revertLinerEditSheet,
  gatefoldTrackMenuPlayNext, gatefoldTrackMenuAddToQueue,
  gatefoldTrackMenuToggleFavorite, gatefoldTrackMenuOpenCredits,
  openGatefoldMoreMenu, isGatefoldMoreMenuOpen,
  gatefoldMoreMenuShare, gatefoldMoreMenuPin, gatefoldMoreMenuTrackOrder, gatefoldMoreMenuRemoveAlbum,
  gatefoldMoreMenuKeepFor, gatefoldKeepForPick, gatefoldMoreMenuSelect,
  gatefoldPlayRecord,
} from '../gatefold/view.js';
import { cropSquareImage } from '../library/edit.js';
import { setAlbumBackCoverImage, clearAlbumBackCoverImage } from '../gatefold/back-cover.js';
import { toggleSealedFrontTurnedOver, commitPeel } from '../gatefold/sealed-front.js';
import { handleBookletAddFileChange } from '../gatefold/booklet.js';
import { closeLayer, openLayer } from '../shell/nav-stack.js';

// GF6 (docs/29_GATEFOLD.md): "a ··· button on the back opens a small
// menu" -- same popover-off-its-own-button shape as the player/library
// headers' own "···" menus (src/shell/player-overlay.js's
// openPlayerOverflowMenu()), reusing their .overflow-menu/.overflow-scrim
// look rather than a new component.
function openBackCoverMenu(){
  const btn = $('#gfBackCoverMoreBtn'), r = btn.getBoundingClientRect();
  const menu = $('#gfBackCoverMenu');
  menu.style.top = Math.round(r.bottom + window.scrollY + 8) + 'px';
  menu.style.right = Math.round(window.innerWidth - r.right) + 'px';
  $('#gfBackCoverMenuScrim').classList.add('open');
  menu.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  openLayer('gf-back-cover-menu', closeBackCoverMenu, { container: [menu, $('#gfBackCoverMenuScrim')] });
}
function closeBackCoverMenu(){
  $('#gfBackCoverMenuScrim').classList.remove('open');
  $('#gfBackCoverMenu').classList.remove('open');
  $('#gfBackCoverMoreBtn').setAttribute('aria-expanded', 'false');
}
function isBackCoverMenuOpen(){ return $('#gfBackCoverMenu').classList.contains('open'); }

async function handleGfBackCoverFile(e){
  const file = e.target.files[0];
  e.target.value = '';
  const albumId = currentGatefoldAlbumId();
  if(!file || !albumId) return;
  try{
    const blob = await cropSquareImage(file, 800);
    await setAlbumBackCoverImage(albumId, blob);
    refreshGatefoldBackCover();
  }catch(_err){ /* bad image -- leave whatever was already showing */ }
}

export function wireGatefold(){
  $('#gfBack').addEventListener('click', () => closeLayer('gatefold'));
  $('#gfFlatBack').addEventListener('click', () => closeLayer('gatefold'));
  $('#gfLeftCue').addEventListener('click', () => gatefoldSwitchPanel('left'));
  $('#gfRightCue').addEventListener('click', () => gatefoldSwitchPanel('right'));
  $('#gfTurnOver').addEventListener('click', gatefoldToggleTurnedOver);
  $('#gfPlayRecordBtn').addEventListener('click', gatefoldPlayRecord);
  document.querySelectorAll('#gfPanelToggle [data-panel], #gfFlatSeg [data-panel]').forEach(b =>
    b.addEventListener('click', () => gatefoldSwitchPanel(b.dataset.panel)));
  window.addEventListener('resize', updateGatefoldScale);
  $('#sealedFrontCloseBtn').addEventListener('click', () => closeLayer('sealed-front'));
  $('#sealedFrontTurnBtn').addEventListener('click', toggleSealedFrontTurnedOver);
  $('#sealedFrontUnsealBtn').addEventListener('click', commitPeel);

  // GF6
  $('#gfBackCoverMoreBtn').addEventListener('click', () => isBackCoverMenuOpen() ? closeLayer('gf-back-cover-menu') : openBackCoverMenu());
  $('#gfBackCoverMenuScrim').addEventListener('click', () => closeLayer('gf-back-cover-menu'));
  $('#gfBackCoverChooseBtn').addEventListener('click', () => { closeLayer('gf-back-cover-menu'); $('#gfBackCoverFile').click(); });
  $('#gfBackCoverPhotoBtn').addEventListener('click', () => { closeLayer('gf-back-cover-menu'); $('#gfBackCoverCameraFile').click(); });
  $('#gfBackCoverFile').addEventListener('change', handleGfBackCoverFile);
  $('#gfBackCoverCameraFile').addEventListener('change', handleGfBackCoverFile);
  $('#gfBackCoverDefaultBtn').addEventListener('click', async () => {
    const albumId = currentGatefoldAlbumId();
    closeLayer('gf-back-cover-menu');
    if(!albumId) return;
    await clearAlbumBackCoverImage(albumId);
    refreshGatefoldBackCover();
  });

  // GF7 (docs/29_GATEFOLD.md): the liner-notes sheet's own Cancel/Save/
  // "Use the notes from the files" -- opened from buildLinerNotesHeading()'s
  // Edit button (src/gatefold/view.js), wired here once like every other
  // static gatefold control.
  $('#linerEditCancel').addEventListener('click', () => closeLayer('liner-edit'));
  $('#linerEditSave').addEventListener('click', saveLinerEditSheet);
  $('#linerEditRevert').addEventListener('click', revertLinerEditSheet);

  // GF9 (docs/29_GATEFOLD.md): the long-press track menu's own buttons --
  // opened from wireGatefoldTrackLongPress() (src/gatefold/view.js), wired
  // here once like every other static gatefold control.
  $('#gfTrackMenuClose').addEventListener('click', () => closeLayer('gf-track-menu'));
  $('#gfTrackMenuPlayNext').addEventListener('click', gatefoldTrackMenuPlayNext);
  $('#gfTrackMenuAddQueue').addEventListener('click', gatefoldTrackMenuAddToQueue);
  $('#gfTrackMenuFav').addEventListener('click', gatefoldTrackMenuToggleFavorite);
  $('#gfTrackMenuCredits').addEventListener('click', gatefoldTrackMenuOpenCredits);

  // GF10 (docs/29_GATEFOLD.md): the booklet viewer's own Done button --
  // opened from buildBookletRow() (src/gatefold/view.js) -- plus the
  // hidden file input "Add booklet pages…" opens via
  // openAddBookletPagesPicker() (src/gatefold/booklet.js).
  $('#bookletDoneBtn').addEventListener('click', () => closeLayer('booklet-viewer'));
  $('#bookletAddFile').addEventListener('change', e => {
    const files = e.target.files;
    e.target.value = '';
    handleBookletAddFileChange(files);
  });

  // GF11 (docs/29_GATEFOLD.md), generalized by GF12 into an always-present
  // "record options" menu, then GF14: its opener (#gfMoreBtn) became a
  // fixed top-corner button, same static-control wiring as every other
  // gatefold control here, instead of being rebuilt into the info block
  // every open. Share/Pin/Keep for…/Track order/Select/Remove album all
  // show every time now, day or night.
  $('#gfMoreBtn').addEventListener('click', () => isGatefoldMoreMenuOpen() ? closeLayer('gf-more-menu') : openGatefoldMoreMenu());
  $('#gfMoreMenuScrim').addEventListener('click', () => closeLayer('gf-more-menu'));
  $('#gfMoreShareBtn').addEventListener('click', gatefoldMoreMenuShare);
  $('#gfMorePinBtn').addEventListener('click', gatefoldMoreMenuPin);
  $('#gfMoreKeepForBtn').addEventListener('click', gatefoldMoreMenuKeepFor);
  $('#gfMoreTrackOrderBtn').addEventListener('click', gatefoldMoreMenuTrackOrder);
  $('#gfMoreSelectBtn').addEventListener('click', gatefoldMoreMenuSelect);
  $('#gfMoreRemoveAlbumBtn').addEventListener('click', gatefoldMoreMenuRemoveAlbum);

  // GS10 (docs/30_GROOVES_AND_SHELF.md point 1): the "Keep for…" submenu's
  // own five slots + "Not kept" -- same static-menu wiring shape as the
  // more-menu rows just above.
  $('#gfKeepForMenuScrim').addEventListener('click', () => closeLayer('gf-keep-for-menu'));
  $('#gfKeepForFirstLightBtn').addEventListener('click', () => gatefoldKeepForPick('firstLight'));
  $('#gfKeepForMorningBtn').addEventListener('click', () => gatefoldKeepForPick('morning'));
  $('#gfKeepForGoldenBtn').addEventListener('click', () => gatefoldKeepForPick('golden'));
  $('#gfKeepForSundownBtn').addEventListener('click', () => gatefoldKeepForPick('sundown'));
  $('#gfKeepForNightBtn').addEventListener('click', () => gatefoldKeepForPick('night'));
  $('#gfKeepForNoneBtn').addEventListener('click', () => gatefoldKeepForPick(null));
}
