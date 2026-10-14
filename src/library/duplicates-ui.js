/* ================= duplicate prompt + scan overlay (close) =================
   Moved out of main.js's "file loading" section (step 5b), unchanged.
   askDuplicateResolution() is shown once per likely-duplicate file during
   import (see import.js); closeDuplicateScan() closes the separate,
   library-wide duplicate-scan overlay opened by openDuplicateScan() (see
   duplicate-scan.js, step 5d) — kept here rather than moved there since it
   doesn't touch findAllDuplicateGroups/renderDupScan, just the dialog
   plumbing shared with askDuplicateResolution(). No S, no main.js import. */
import { $ } from '../util/dom.js';
import { openLayer, closeLayer } from '../shell/nav-stack.js';

let dupResolvePromise = null;
// NV2 (docs/11_SMOOTH_NAVIGATION.md): Back/Escape have to resolve this
// prompt's Promise same as any button would (nothing else is waiting on
// it otherwise) — 'skip' is the same safe default a user dismissing any
// confirm dialog without picking an option would expect (leave the new
// file out, keep the existing one, same as Cancel). A button's own click
// instead goes through resolveDuplicatePrompt(choice) below, which stashes
// the real choice here first so the one registered nav-stack close
// callback (closeDupOverlayViaNav) still resolves with it instead of the
// 'skip' default.
let pendingDupChoice = 'skip';

export function askDuplicateResolution(existingTrack, newFileName){
  return new Promise(resolve => {
    $('#dupBody').textContent = '"' + newFileName + '" looks like a duplicate of "' + existingTrack.tags.title + '" already in your library.';
    dupResolvePromise = resolve;
    pendingDupChoice = 'skip';
    const overlay = $('#dupOverlay');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden','false');
    openLayer('duplicate-prompt', closeDupOverlayViaNav, { container: overlay });
  });
}
export function closeDupOverlay(choice){
  $('#dupOverlay').classList.remove('open');
  $('#dupOverlay').setAttribute('aria-hidden','true');
  if(dupResolvePromise){ const r = dupResolvePromise; dupResolvePromise = null; r(choice); }
}
function closeDupOverlayViaNav(){
  closeDupOverlay(pendingDupChoice);
}
// what each of the prompt's own buttons call instead of closeDupOverlay()
// directly, so the pick is also what Back/Escape would have resolved with
// if nothing had been tapped, and the layer stack/history stay in sync.
export function resolveDuplicatePrompt(choice){
  pendingDupChoice = choice;
  closeLayer('duplicate-prompt');
}

export function closeDuplicateScan(){
  $('#dupScanOverlay').classList.remove('open');
  $('#dupScanOverlay').setAttribute('aria-hidden','true');
}
