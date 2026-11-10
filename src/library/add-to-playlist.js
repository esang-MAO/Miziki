/* ================= LB9: add to playlist =================
   docs/36A_LIBRARY_AND_LAUNCH.md point 4: "Add to playlist" from the song
   ⋯ menu (UN3) is one sheet -- the song's own title/artist as a caption,
   "New playlist…" first (opens LB2's name sheet, then adds the song on
   success), then every real playlist with its own mosaic (LB3) and song
   count. A playlist that already has the song shows "Already in" and is
   dimmed/non-tappable; tapping an eligible one adds the song, closes the
   sheet and toasts "Added to {name}" -- the same fixed-to-the-viewport,
   shown-the-instant-the-sheet-closes toast shape duplicates-ui.js's
   showDupToast() already uses (see miziki.html's own comment on
   #dupSkipToast for why it has to be a sibling, not a child, of the
   overlay). */
import { S, touchBackupKey, touchBackupMembership } from '../state.js';
import { $, el } from '../util/dom.js';
import { sheetHeader } from '../ui/parts.js';
import { openLayer, closeLayer } from '../shell/nav-stack.js';
import { openPlaylistNameSheet } from './playlist-sheet.js';
import { idxOf, displayArtist } from './model.js';

// The one pure decision here -- "already in", given a playlist and the
// track id being added -- kept separate from the sheet-building DOM half
// below, same "extract the pure core" shape playlist-sheet.js's own
// playlistNameCollides() and playlist-mosaic.js's selection logic already
// use, so it's directly unit-testable without a DOM.
export function isTrackInPlaylist(playlist, trackId){
  return !!playlist && playlist.items.includes(trackId);
}

function presentIdx(pl){ return pl.items.map(idxOf).filter(i => i >= 0); }

function addTrackToPlaylist(pl, trackId, queueSave){
  if(isTrackInPlaylist(pl, trackId)) return false;
  pl.items.push(trackId);
  queueSave();
  // RF17 (docs/12_REFINE.md): add-wins membership per (playlist, track)
  // pair -- see state.js's touchBackupMembership(), same shape
  // favorites.js's toggleFavorite()/library/view.js's togglePick() use.
  touchBackupMembership(pl.name, trackId, 'added');
  touchBackupKey('playlistOrder', pl.name);
  return true;
}

// Same banner look/timing as duplicates-ui.js's own showDupToast()
// (.dup-skip-toast, 16-edit-sheet.css) -- reused directly rather than a
// second near-identical toast component, since "Added to {name}" needs
// nothing that one doesn't already have (centered text, no second action).
function showAddedToast(name){
  const toast = $('#plAddToast'); if(!toast) return;
  $('#plAddToastText').textContent = `Added to ${name}`;
  toast.style.display = 'flex';
  clearTimeout(showAddedToast._t);
  showAddedToast._t = setTimeout(() => { toast.style.display = 'none'; }, 4000);
}

function playlistRow(pl, t, deps){
  const present = presentIdx(pl);
  const already = isTrackInPlaylist(pl, t.id);
  const b = el('button', 'add-to-pl-row' + (already ? ' add-to-pl-row--dim' : ''));
  b.type = 'button';
  b.disabled = already;
  const art = el('span', 'g-art add-to-pl-mosaic');
  art.appendChild(deps.mosaicArt(pl, present));
  b.appendChild(art);
  const text = el('span', 'add-to-pl-text');
  text.appendChild(el('b', null, pl.name));
  const songCount = present.length;
  text.appendChild(el('em', null, songCount + (songCount === 1 ? ' song' : ' songs')));
  b.appendChild(text);
  if(already) b.appendChild(el('span', 'add-to-pl-state', 'Already in'));
  else b.addEventListener('click', () => {
    addTrackToPlaylist(pl, t.id, deps.queueSave);
    closeLayer('add-to-playlist');
    showAddedToast(pl.name);
  });
  return b;
}

async function createPlaylistAndAdd(t, deps){
  const name = await openPlaylistNameSheet({
    title: 'New playlist', confirmLabel: 'Create playlist',
    existingNames: S.playlists.map(p => p.name),
  });
  if(!name) return;
  const pl = { name, items: [] };
  S.playlists.push(pl);
  deps.queueSave();
  touchBackupKey('playlistDefs', name);
  addTrackToPlaylist(pl, t.id, deps.queueSave);
  closeLayer('add-to-playlist');
  showAddedToast(name);
}

function renderAddToPlaylistBody(t, deps){
  const body = $('#addToPlBody'); body.innerHTML = '';
  const newRow = el('button', 'p-list-menu-item', 'New playlist…');
  newRow.type = 'button';
  newRow.addEventListener('click', () => createPlaylistAndAdd(t, deps));
  body.appendChild(newRow);
  if(S.playlists.length) body.appendChild(el('div', 'p-list-menu-divider'));

  // Favorites (and any other system playlist) pinned first, same order
  // the Playlists grid itself uses (library/view.js's own renderTracksBody()).
  const order = S.playlists.map((_, n) => n)
    .sort((a, b) => (S.playlists[a].system ? 0 : 1) - (S.playlists[b].system ? 0 : 1));
  order.forEach(n => body.appendChild(playlistRow(S.playlists[n], t, deps)));
}

// `deps.mosaicArt` is library/view.js's own playlistMosaicArt(), and
// `deps.queueSave` is storage/meta.js's own queueSave() -- both passed in
// by the caller rather than imported directly. view.js already imports
// both; importing them here too would pair this module into the big
// src/ import cycle scripts/cycles.mjs tracks (view.js is already in it,
// and storage/meta.js's own chain reaches audio/engine.js, player/
// background.js and others that are too), for no reason beyond reusing
// two functions view.js already has handy -- threading them through
// instead keeps this module's own import list exactly what the sheet
// itself needs, outside that cycle.
export function openAddToPlaylistSheet(t, deps){
  const head = $('#addToPlHead'); head.innerHTML = '';
  const built = sheetHeader('Add to playlist');
  built.closeBtn.addEventListener('click', () => closeLayer('add-to-playlist'));
  head.appendChild(built);

  const artist = displayArtist(t.tags.artist);
  $('#addToPlCaption').textContent = artist ? `${t.tags.title} · ${artist}` : t.tags.title;

  renderAddToPlaylistBody(t, deps);

  $('#addToPlOverlay').classList.add('open');
  $('#addToPlOverlay').setAttribute('aria-hidden', 'false');
  openLayer('add-to-playlist', closeAddToPlaylistSheet, { container: $('#addToPlOverlay') });
}
export function closeAddToPlaylistSheet(){
  $('#addToPlOverlay').classList.remove('open');
  $('#addToPlOverlay').setAttribute('aria-hidden', 'true');
}
