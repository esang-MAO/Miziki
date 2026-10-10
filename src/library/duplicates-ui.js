/* ================= duplicate prompt + scan overlay (close) =================
   Moved out of main.js's "file loading" section (step 5b), unchanged.
   askDuplicateResolution() is shown once per likely-duplicate file during
   import (see import.js); closeDuplicateScan() closes the separate,
   library-wide duplicate-scan overlay opened by openDuplicateScan() (see
   duplicate-scan.js, step 5d) — kept here rather than moved there since it
   doesn't touch findAllDuplicateGroups/renderDupScan, just the dialog
   plumbing shared with askDuplicateResolution(). No S, no main.js import. */
import { $ } from '../util/dom.js';

let dupResolvePromise = null;

export function askDuplicateResolution(existingTrack, newFileName){
  return new Promise(resolve => {
    $('#dupBody').textContent = '"' + newFileName + '" looks like a duplicate of "' + existingTrack.tags.title + '" already in your library.';
    dupResolvePromise = resolve;
    $('#dupOverlay').classList.add('open');
    $('#dupOverlay').setAttribute('aria-hidden','false');
  });
}
export function closeDupOverlay(choice){
  $('#dupOverlay').classList.remove('open');
  $('#dupOverlay').setAttribute('aria-hidden','true');
  if(dupResolvePromise){ const r = dupResolvePromise; dupResolvePromise = null; r(choice); }
}

export function closeDuplicateScan(){
  $('#dupScanOverlay').classList.remove('open');
  $('#dupScanOverlay').setAttribute('aria-hidden','true');
}
