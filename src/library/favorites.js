/* ================= favorites: a real playlist, not a separate flag =======
   Moved out of main.js (step 5e). (CREDITS/FAVORITES spec §4). The
   system:'favorites' tag must be carried through every place playlists are
   copied — saveMeta, restoreMeta and deleteTracks' snapshot/rebuild — or
   it's lost on the next reload. */
import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { idxOf } from './model.js';
// Temporary circular imports back to main.js (rule 8 in CLAUDE.md) —
// persistence/screen functions not yet extracted. Used only inside the
// functions below, never at module top level.
import { queueSave, renderTracks, REDUCED } from '../main.js';

function findFavoritesPlaylist(){ return S.playlists.find(p => p.system === 'favorites'); }
function ensureFavoritesPlaylist(){
  let pl = findFavoritesPlaylist();
  if(pl) return pl;
  // adopt a playlist the user already named "Favorites" rather than duplicate it
  pl = S.playlists.find(p => p.name === 'Favorites' && !p.system);
  if(pl){ pl.system = 'favorites'; return pl; }
  pl = {name:'Favorites', items:[], system:'favorites'};
  S.playlists.unshift(pl);
  return pl;
}
export function isFavorite(id){
  const pl = findFavoritesPlaylist();
  if(!pl) return false;
  const i = idxOf(id);
  return i >= 0 && pl.items.includes(i);
}
export function toggleFavorite(id){
  const pl = ensureFavoritesPlaylist();
  const i = idxOf(id);
  if(i < 0) return;
  const at = pl.items.indexOf(i);
  if(at >= 0) pl.items.splice(at, 1); else pl.items.push(i);
  queueSave();
  updateFavoriteButtons();
  const t = current();
  if(!REDUCED && t && t.id === id){
    [$('#playerFavBtn'), $('#miniFavBtn')].forEach(b => { if(!b) return; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); });
  }
  renderTracks();
}
export function updateFavoriteButtons(){
  const t = current();
  const fav = t ? isFavorite(t.id) : false;
  [$('#playerFavBtn'), $('#miniFavBtn')].forEach(b => {
    if(!b) return;
    b.style.display = t ? '' : 'none';
    b.setAttribute('aria-pressed', String(fav));
    b.textContent = fav ? '♥' : '♡';
  });
}
