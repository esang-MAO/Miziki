import { S } from '../state.js';
import { el } from '../util/dom.js';
import { meta } from '../storage/repo.js';
import { renderTracks } from './view.js';
import { updateSealedSheetAfterBreak } from '../gatefold/sealed-sheet.js';

/* ================= S5: sealed records =================
   S.sealed is its own saved list, independent of S.albumLastPlayed/session
   history on purpose — "Clear listening history" must never reseal an
   album (SEALED spec §2). Grandfathering: no sealedAlbums row at all means
   this feature hasn't run here yet, so nothing existing is sealed. */
export async function restoreSealedAlbums(){
  const row = await meta.get('sealedAlbums');
  S.sealed = new Set(row && row.ids ? row.ids : []);
  // a durable "ever broken" record, independent of S.sealed itself (which
  // only ever records "still sealed") — step 06, B3: the cross-device merge
  // rule ("a seal broken on any device stays broken everywhere") needs to
  // tell "broken" apart from "this device never had the album at all",
  // which S.sealed alone can't (see CLAUDE.md's step-03 backup-table note)
  const broken = await meta.get('sealedBrokenAlbums');
  S.sealedBroken = new Set(broken && broken.ids ? broken.ids : []);
}
export async function persistSealedAlbums(){ await meta.put('sealedAlbums', {init:true, ids:[...S.sealed]}); }
export async function persistBrokenSeals(){ await meta.put('sealedBrokenAlbums', {ids:[...S.sealedBroken]}); }

export function isAlbumSealed(albumId){ return S.sealedRecords && S.sealed.has(albumId); }

// "played" means playback began — no minimum duration, any track counts,
// and once removed an id can never be re-added except by a fresh import
// (SEALED spec §2, §6)
export function breakSeal(albumId){
  if(!S.sealed.has(albumId)) return;
  S.sealed.delete(albumId);
  S.sealedBroken.add(albumId);
  persistSealedAlbums();
  persistBrokenSeals();
  updateSealedSheetAfterBreak(albumId);
  renderTracks();
}

// one overlay + one sticker, plain CSS gradients, no images — shared by the
// crate card, the sealed sheet's small cover and the player's sleeve
// (SEALED spec §4). sizePx sizes only the sticker's text; everything else
// is percentage-based so the same markup scales with its host.
export function buildSealOverlay(sizePx){
  const frag = document.createDocumentFragment();
  const wrap = el('div','seal-wrap'); wrap.setAttribute('aria-hidden','true');
  frag.appendChild(wrap);
  const sticker = el('div','seal-sticker'); sticker.setAttribute('aria-hidden','true');
  const label = el('span', null, 'NEW');
  label.style.fontSize = Math.round(sizePx * 0.075) + 'px';
  sticker.appendChild(label);
  frag.appendChild(sticker);
  return frag;
}
