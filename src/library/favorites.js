/* ================= favorites: a real playlist, not a separate flag =======
   Moved out of main.js (step 5e). (CREDITS/FAVORITES spec §4). The
   system:'favorites' tag must be carried through every place playlists are
   copied — saveMeta/restoreMeta and deleteTracks' explicit-removal filter
   — or it's lost on the next reload. Playlist items are track ids, not
   positions (F3 spec, step 02) — a favorited track that's since been
   forgotten (not deleted) just stays in the list, hidden until it
   reconnects, so this module never needs to resolve an index at all. */
import { S, current, touchBackupKey, touchBackupMembership } from '../state.js';
import { $ } from '../util/dom.js';
import { queueSave } from '../storage/meta.js';
import { REDUCED } from '../util/motion.js';
import { renderTracks } from './view.js';

function findFavoritesPlaylist(){ return S.playlists.find(p => p.system === 'favorites'); }
function ensureFavoritesPlaylist(){
  let pl = findFavoritesPlaylist();
  if(pl) return pl;
  // adopt a playlist the user already named "Favorites" rather than duplicate it
  pl = S.playlists.find(p => p.name === 'Favorites' && !p.system);
  if(pl){ pl.system = 'favorites'; return pl; }
  pl = {name:'Favorites', items:[], system:'favorites'};
  S.playlists.unshift(pl);
  touchBackupKey('playlistDefs', pl.name);
  return pl;
}
export function isFavorite(id){
  const pl = findFavoritesPlaylist();
  return !!pl && pl.items.includes(id);
}
export function toggleFavorite(id){
  const pl = ensureFavoritesPlaylist();
  const at = pl.items.indexOf(id);
  if(at >= 0) pl.items.splice(at, 1); else pl.items.push(id);
  queueSave();
  // RF17 (docs/12_REFINE.md): add-wins membership per (playlist, track) pair
  // — see state.js's touchBackupMembership() and view.js's togglePick() for
  // the same shape.
  touchBackupMembership(pl.name, id, at >= 0 ? 'removed' : 'added');
  touchBackupKey('playlistOrder', pl.name);
  updateFavoriteButtons();
  const t = current();
  if(!REDUCED && t && t.id === id){
    const b = $('#playerFavBtn');
    if(b){ b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  }
  // NV3 (docs/11_SMOOTH_NAVIGATION.md): songRow() never shows favorite
  // status at all, so toggling it changes nothing on screen except when
  // the visible list's own *membership* depends on it — the Favorites
  // playlist itself, or an active "is:favorite" search. Every other view
  // (Songs, Artists, Albums, any other playlist, the crate) is a pure
  // no-op here, not a render worth running at all.
  if(libraryShowsFavoriteMembership()) renderTracks();
}

function libraryShowsFavoriteMembership(){
  const v = S.view;
  const pl = v.playlist !== null ? S.playlists[v.playlist] : null;
  if(pl && pl.system === 'favorites') return true;
  const field = $('#librarySearch');
  const query = (field && typeof field.value === 'string') ? field.value.trim() : '';
  return /(^|\s)is:favorite(\s|$)/i.test(query);
}
export function updateFavoriteButtons(){
  const t = current();
  const fav = t ? isFavorite(t.id) : false;
  const b = $('#playerFavBtn');
  if(b){
    b.style.display = t ? '' : 'none';
    b.setAttribute('aria-pressed', String(fav));
    b.textContent = fav ? '♥' : '♡';
  }
}
