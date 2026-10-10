/* ================= duplicate prompt + scan overlay (close) =================
   Moved out of main.js's "file loading" section (step 5b), unchanged.
   askDuplicateResolution() is shown once per likely-duplicate file during
   import (see import.js); closeDuplicateScan() closes the separate,
   library-wide duplicate-scan overlay that still opens from main.js's
   settings screen (openDuplicateScan()/renderDupScan() haven't moved yet —
   they call deleteTracks(), which moves in step 5d). No S, no main.js
   import — just the dialog plumbing. */
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
