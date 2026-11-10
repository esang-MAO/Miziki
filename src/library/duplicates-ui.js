/* ================= duplicates sheet (end of import) + scan overlay (close) =================
   36A decision 1 (docs/36A_LIBRARY_AND_LAUNCH.md, LB1): the import never
   stops to ask about a possible duplicate file by file any more. import.js
   collects every {file, dup} pair it finds into a pending list and keeps
   importing everything else; once the whole batch has landed, it calls
   openDuplicatesSheet() here exactly once (only if that list isn't empty).

   The sheet has two views, both painted into the same #dupHead/#dupBody
   pair (no separate nav-stack layer for Review — closing the sheet by ×,
   swipe or Back always means "stop here," whichever view is showing):
     - summary: "{n} possible duplicates", the first three as rows, then
       Keep both for all / Review one by one / Skip all.
     - review: today's old per-file Keep both / Replace / Skip choice,
       one file at a time, "{i} of {n}" in the header.
   dupSheetTitle()/resolveDupSheetClose() (duplicates-logic.js) are the
   pure decisions behind the header wording and "what happens to every
   not-yet-decided file when the sheet closes" -- unit-tested there,
   without a DOM.

   closeDuplicateScan() closes the separate, library-wide duplicate-scan
   overlay opened by openDuplicateScan() (see duplicate-scan.js) — kept
   here rather than there since it doesn't touch
   findAllDuplicateGroups/renderDupScan, just the dialog plumbing. No S,
   no main.js import. */
import { $, el } from '../util/dom.js';
import { openLayer, closeLayer } from '../shell/nav-stack.js';
import { sheetHeader } from '../ui/parts.js';
import { dupSheetTitle, resolveDupSheetClose } from './duplicates-logic.js';

export { dupSheetTitle, resolveDupSheetClose };

// --- the sheet itself -------------------------------------------------

let pendingItems = [];
let importedCount = 0;
let onResolvedCb = null;
let mode = 'summary';   // 'summary' | 'review'
let reviewIndex = 0;
let choices = [];
let finalAction = null; // set the instant a button picks a definite outcome, read by closeViaNav()

// The matched existing track's own art -- not thumbs.js's crate-tier
// thumbURL cache, so this sheet (and importing in general) stays decoupled
// from that module's own wide dependency web (profile/screens.js among
// them). A true duplicate's cover is the same image either way in
// practice; judgment call, flagged in the PR, that the missing design
// canvas frame would otherwise have settled.
function coverFor(item){
  return item.existingTrack.art || null;
}

function dupRow(item){
  const row = el('div', 'dup-row');
  const cover = el('div', 'row-menu-cover');
  const src = coverFor(item);
  if(src){ const img = el('img'); img.src = src; img.alt = ''; cover.appendChild(img); }
  else cover.appendChild(el('span', null, '◍'));
  row.appendChild(cover);
  const text = el('div', 'row-menu-text');
  text.appendChild(el('p', 'row-menu-title', item.tags.title));
  text.appendChild(el('p', 'row-menu-sub', 'Matches a song already in your library'));
  row.appendChild(text);
  return row;
}

function renderSummary(){
  const n = pendingItems.length;
  const head = $('#dupHead'); head.innerHTML = '';
  const built = sheetHeader(dupSheetTitle(n));
  built.closeBtn.addEventListener('click', () => closeLayer('duplicate-prompt'));
  head.appendChild(built);

  const body = $('#dupBody'); body.innerHTML = '';
  body.appendChild(el('p', 'note', `The rest of the import (${importedCount} songs) is already in your library. Decide once for all ${n}.`));

  const rows = el('div', 'dup-rows');
  pendingItems.slice(0, 3).forEach(item => rows.appendChild(dupRow(item)));
  body.appendChild(rows);
  if(n > 3) body.appendChild(el('p', 'note dup-more', `and ${n - 3} more`));

  const stack = el('div', 'stack dup-actions');
  const keepAllBtn = el('button', 'p-btn p-btn--primary', `Keep both for all ${n}`);
  keepAllBtn.type = 'button';
  keepAllBtn.addEventListener('click', () => { finalAction = 'keepAll'; closeLayer('duplicate-prompt'); });
  const reviewBtn = el('button', 'p-btn', 'Review one by one');
  reviewBtn.type = 'button';
  reviewBtn.addEventListener('click', () => { mode = 'review'; reviewIndex = 0; renderReview(); });
  const skipAllBtn = el('button', 'p-btn', `Skip all ${n}`);
  skipAllBtn.type = 'button';
  skipAllBtn.addEventListener('click', () => { finalAction = 'skipAll'; closeLayer('duplicate-prompt'); });
  stack.appendChild(keepAllBtn); stack.appendChild(reviewBtn); stack.appendChild(skipAllBtn);
  body.appendChild(stack);
}

function pickInReview(choice){
  choices[reviewIndex] = choice;
  reviewIndex++;
  if(reviewIndex >= pendingItems.length){ finalAction = 'reviewed'; closeLayer('duplicate-prompt'); return; }
  renderReview();
}

function renderReview(){
  const n = pendingItems.length;
  const item = pendingItems[reviewIndex];
  const head = $('#dupHead'); head.innerHTML = '';
  const built = sheetHeader(`${reviewIndex + 1} of ${n}`);
  built.closeBtn.addEventListener('click', () => closeLayer('duplicate-prompt'));
  head.appendChild(built);

  const body = $('#dupBody'); body.innerHTML = '';
  body.appendChild(el('p', 'note', `"${item.fileName}" looks like a duplicate of "${item.existingTrack.tags.title}" already in your library.`));

  const stack = el('div', 'stack dup-actions');
  const keepBtn = el('button', 'p-btn p-btn--primary', 'Keep both');
  keepBtn.type = 'button';
  keepBtn.addEventListener('click', () => pickInReview('keep'));
  const replaceBtn = el('button', 'p-btn p-btn--danger', 'Replace');
  replaceBtn.type = 'button';
  replaceBtn.addEventListener('click', () => pickInReview('replace'));
  const skipBtn = el('button', 'p-btn', 'Skip');
  skipBtn.type = 'button';
  skipBtn.addEventListener('click', () => pickInReview('skip'));
  stack.appendChild(keepBtn); stack.appendChild(replaceBtn); stack.appendChild(skipBtn);
  body.appendChild(stack);
}

function showDupToast(message){
  const toast = $('#dupSkipToast'); if(!toast) return;
  $('#dupSkipText').textContent = message;
  toast.style.display = 'flex';
  clearTimeout(showDupToast._t);
  showDupToast._t = setTimeout(() => { toast.style.display = 'none'; }, 6000);
}

function closeDupSheetViaNav(){
  const { choices: resolved, toast } = resolveDupSheetClose({
    mode, finalAction, choices, reviewIndex, n: pendingItems.length,
  });
  $('#dupOverlay').classList.remove('open');
  $('#dupOverlay').setAttribute('aria-hidden', 'true');
  const items = pendingItems;
  const cb = onResolvedCb;
  pendingItems = []; onResolvedCb = null; mode = 'summary'; reviewIndex = 0; choices = []; finalAction = null;
  if(toast) showDupToast(toast);
  if(cb) cb(items.map((item, i) => ({ item, choice: resolved[i] })));
}

// Opens once per import batch that ends with at least one possible
// duplicate. `pending` is import.js's own opaque per-file records (each
// must carry `.existingTrack` and `.fileName` for display); `imported` is
// how many non-duplicate songs this same batch already saved.
// `onResolved(results)` is called exactly once, with one
// {item, choice:'keep'|'replace'|'skip'} per pending item, however the
// sheet ends up closing.
export function openDuplicatesSheet(pending, imported, onResolved){
  pendingItems = pending;
  importedCount = imported;
  onResolvedCb = onResolved;
  mode = 'summary'; reviewIndex = 0; choices = pending.map(() => null); finalAction = null;
  renderSummary();
  const overlay = $('#dupOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  openLayer('duplicate-prompt', closeDupSheetViaNav, { container: overlay });
}

export function closeDuplicateScan(){
  $('#dupScanOverlay').classList.remove('open');
  $('#dupScanOverlay').setAttribute('aria-hidden','true');
}
