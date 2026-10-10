/* ================= duplicate scan (library-wide) =================
   Moved out of main.js (step 5d). Separate from the single-file duplicate
   prompt shown during import (see duplicates-ui.js) — this is the "scan my
   whole library" screen reached from settings. Library-wide scan for
   duplicates that arise from metadata edits, not just import (see
   PLAYBACK/IMPORT spec §6) — offered separately in settings. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { trackIdentityKey } from '../record-art/tiers.js';
import { deleteTracks } from './delete.js';

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
  $('#dupScanOverlay').classList.add('open');
  $('#dupScanOverlay').setAttribute('aria-hidden','false');
}
export function renderDupScan(){
  const groups = findAllDuplicateGroups();
  const body = $('#dupScanBody');
  if(!groups.length){
    body.innerHTML = '<p class="note" style="margin-top:0">No duplicates found.</p>';
    return;
  }
  body.innerHTML = '';
  groups.forEach((idxs, gi) => {
    const wrap = document.createElement('div');
    wrap.className = 'row';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'stretch';
    const names = idxs.map(i => S.tracks[i]).map(t => t.tags.title + ' — ' + t.tags.artist).join('<br>');
    wrap.innerHTML = '<div class="k" style="margin-bottom:8px">' + names + '</div>';
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
