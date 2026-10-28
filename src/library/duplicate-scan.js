/* ================= duplicate scan (library-wide) =================
   Separate from the single-file duplicate prompt shown during import (see
   duplicates-ui.js) — this is the "scan my whole library" screen reached
   from settings. Library-wide scan for
   duplicates that arise from metadata edits, not just import (see
   PLAYBACK/IMPORT spec §6) — offered separately in settings. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { trackIdentityKey } from '../record-art/tiers.js';
import { deleteTracks } from './delete.js';
import { openLayer } from '../shell/nav-stack.js';
import { closeDuplicateScan } from './duplicates-ui.js';

export function findAllDuplicateGroups(){
  const groups = {};
  S.tracks.forEach((t,i) => {
    const key = trackIdentityKey(t);
    (groups[key] = groups[key] || []).push(i);
  });
  return Object.values(groups).filter(idxs => idxs.length > 1);
}

export function openDuplicateScan(){
  renderDupScan();
  const overlay = $('#dupScanOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden','false');
  openLayer('duplicate-scan', closeDuplicateScan, { container: overlay });
}
// Pure-ish DOM builder, split out so a malicious tag value's handling is
// testable without the rest of renderDupScan's $()/deleteTracks chain.
// Track title/artist are untrusted file-tag text, so this must never
// reach innerHTML.
export function duplicateNamesElement(tracks){
  const namesEl = document.createElement('div');
  namesEl.className = 'k';
  namesEl.style.marginBottom = '8px';
  tracks.forEach((t, idx) => {
    if(idx > 0) namesEl.appendChild(document.createElement('br'));
    namesEl.appendChild(document.createTextNode(t.tags.title + ' — ' + t.tags.artist));
  });
  return namesEl;
}
export function renderDupScan(){
  const groups = findAllDuplicateGroups();
  const body = $('#dupScanBody');
  if(!groups.length){
    body.innerHTML = '<p class="note" style="margin-top:0">No duplicates found.</p>';
    return;
  }
  body.innerHTML = '';
  groups.forEach((idxs, _gi) => {
    const wrap = document.createElement('div');
    wrap.className = 'row';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'stretch';
    wrap.appendChild(duplicateNamesElement(idxs.map(i => S.tracks[i])));
    const stack = document.createElement('div');
    stack.className = 'stack';
    const keepBtn = document.createElement('button');
    keepBtn.className = 'cta ghost';
    keepBtn.textContent = 'Keep newest only';
    keepBtn.addEventListener('click', async () => {
      const ranked = idxs.map(i => S.tracks[i]).sort((a,b) => (b.addedAt||0) - (a.addedAt||0));
      const toRemove = ranked.slice(1).map(t => t.id);
      await deleteTracks(toRemove);
      renderDupScan();
    });
    const skipBtn = document.createElement('button');
    skipBtn.className = 'cta ghost';
    skipBtn.textContent = 'Skip';
    skipBtn.addEventListener('click', () => {
      wrap.remove();
    });
    stack.appendChild(keepBtn); stack.appendChild(skipBtn);
    wrap.appendChild(stack);
    body.appendChild(wrap);
  });
}
