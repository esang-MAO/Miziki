/* ================= duplicates sheet: pure logic =================
   LB1 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 1): the two decisions
   duplicates-ui.js's sheet actually makes, pulled out pure and exported so
   they're unit-testable without a real DOM — the same "extract the pure
   core" shape this codebase already uses (import.js's own
   shouldSealOnImport, scrub.js's angleDelta, gatefold/view.js's
   gatefoldSideSplits). No DOM, no S, no other imports. */

// "1 possible duplicate" vs "{n} possible duplicates" -- the one place
// this wording lives.
export function dupSheetTitle(n){
  return n === 1 ? '1 possible duplicate' : n + ' possible duplicates';
}

// The one decision for what happens to every pending file once the sheet
// closes, however it closes.
//   - finalAction 'keepAll'/'skipAll': every item gets that choice.
//   - finalAction 'reviewed': Review ran to the end; `choices` already
//     holds one entry per item.
//   - no finalAction (× / swipe / Back, before any of the three buttons
//     or a full Review landed): summary view means Skip all (decision 1,
//     point 4); review view means the remainder (from `reviewIndex` on)
//     is skipped, and the count of those gets reported back as a toast.
// Returns {choices, toast}. `choices` is always exactly `n` entries long,
// each 'keep' | 'replace' | 'skip'.
export function resolveDupSheetClose({ mode, finalAction, choices, reviewIndex, n }){
  if(finalAction === 'keepAll') return { choices: Array(n).fill('keep'), toast: null };
  if(finalAction === 'skipAll') return { choices: Array(n).fill('skip'), toast: null };
  if(finalAction === 'reviewed') return { choices: (choices || []).slice(0, n), toast: null };
  if(mode === 'review'){
    const resolved = (choices || []).slice(0, n);
    let skipped = 0;
    for(let i = reviewIndex; i < n; i++){
      if(resolved[i] == null){ resolved[i] = 'skip'; skipped++; }
    }
    return { choices: resolved, toast: skipped > 0 ? `Skipped ${skipped} you didn't review.` : null };
  }
  // summary view, dismissed with no button pressed
  return { choices: Array(n).fill('skip'), toast: null };
}
