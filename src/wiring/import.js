/* ================= wiring: import =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the header + menu
   (S1 §3), the file pickers, drag-and-drop over the library route, the
   single-file duplicate prompt, and the library-wide duplicate scan.
   Every function called here was already a real export of its owning
   module. */
import { $ } from '../util/dom.js';
import { addFiles, filesFromDataTransferItems, addTestTone } from '../library/import.js';
import { closeDupOverlay, closeDuplicateScan } from '../library/duplicates-ui.js';
import { openDuplicateScan } from '../library/duplicate-scan.js';
import { openAddMenu, closeAddMenu, isAddMenuOpen } from '../shell/header.js';

export function wireImport(){
  // header + menu: Add songs / Add folder (S1 §3). The file-picker .click()
  // must fire synchronously inside this user-gesture handler (iOS Safari).
  $('#hdrAddBtn').addEventListener('click', ()=> isAddMenuOpen() ? closeAddMenu() : openAddMenu());
  $('#addScrim').addEventListener('click', closeAddMenu);
  $('#addSongsRow').addEventListener('click', ()=>{ closeAddMenu(); $('#file').click(); });
  $('#addFolderRow').addEventListener('click', ()=>{ closeAddMenu(); $('#folderFile').click(); });

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

  $('#dupClose').addEventListener('click', ()=>closeDupOverlay('skip'));
  $('#dupKeepBoth').addEventListener('click', ()=>closeDupOverlay('keep'));
  $('#dupReplace').addEventListener('click', ()=>closeDupOverlay('replace'));
  $('#dupSkip').addEventListener('click', ()=>closeDupOverlay('skip'));

  $('#scanDuplicatesBtn').addEventListener('click', openDuplicateScan);
  $('#dupScanClose').addEventListener('click', closeDuplicateScan);
}
