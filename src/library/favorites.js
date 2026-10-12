/* ================= favorites: a real playlist, not a separate flag =======
   Moved out of main.js (step 5e). (CREDITS/FAVORITES spec §4). The
   system:'favorites' tag must be carried through every place playlists are
   copied — saveMeta/restoreMeta and deleteTracks' explicit-removal filter
   — or it's lost on the next reload. Playlist items are track ids, not
   positions (F3 spec, step 02) — a favorited track that's since been
   forgotten (not deleted) just stays in the list, hidden until it
   reconnects, so this module never needs to resolve an index at all. */
import { S, current, touchBackupField } from '../state.js';
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
  touchBackupField('playlists');
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
