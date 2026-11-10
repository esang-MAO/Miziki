/* ================= library model =================
   Pure library-indexing helpers moved out of main.js's "library",
   "favorites" and "persistence" sections (step 5a) — sort comparators,
   grouping, and track id/index lookups. No DOM, no storage: everything
   here reads only S.tracks and the small per-album prefs on S. */
import { S } from '../state.js';

export const byName = (a,b) => String(a).localeCompare(String(b), undefined, {sensitivity:'base', numeric:true});

export const trackSort = (a,b) => (S.tracks[a].tags.disc - S.tracks[b].tags.disc)
  || (S.tracks[a].tags.track - S.tracks[b].tags.track)
  || byName(S.tracks[a].tags.title, S.tracks[b].tags.title);

export function allIdx(){ return S.tracks.map((_,i) => i); }

export function groupBy(key){
  const m = new Map();
  S.tracks.forEach((t,i) => {
    const k = t.tags[key];
    if(!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  });
  return [...m.entries()].sort((a,b) => byName(a[0], b[0]));
}

/* orders and playlists are saved as track ids, never as positions —
   positions mean nothing once the library is rebuilt */
export const idOf = i => (S.tracks[i] ? S.tracks[i].id : null);
export const idxOf = id => S.tracks.findIndex(t => t.id === id);

// UN5 (docs/36_UNIFORMITY.md point 5): a song row's subline drops "·
// CODEC · lossy" when it's the same on every row of a typical library --
// shown only for a track whose format differs from the library's own most
// common one. Pure/testable: takes the tracks array directly rather than
// reading S, so a caller (or a test) can pass any list.
export function mostCommonFormat(tracks){
  const counts = new Map();
  tracks.forEach(t => {
    const key = t.meta.codec + '|' + (t.meta.lossless ? '1' : '0');
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  let best = null, bestCount = 0;
  for(const [key, count] of counts){
    if(count > bestCount){ bestCount = count; best = key; }
  }
  if(!best) return null;
  const [codec, lossless] = best.split('|');
  return { codec, lossless: lossless === '1' };
}

// '' when t's format matches `common` (the library's most common one, or
// null for a library of one track/format), else the same " · CODEC[ ·
// lossy]" suffix the subline always showed before this point.
export function formatSuffix(t, common){
  if(common && t.meta.codec === common.codec && t.meta.lossless === common.lossless) return '';
  return ' · ' + t.meta.codec + (t.meta.lossless ? '' : ' · lossy');
}

// UN5 point 3: a grouped crate section (genre:/decade:) reads "{n} in
// {section}" ("1 in Ambient"); A-Z and the virtual bins keep "{n} records"
// -- section.key's own prefix (src/crate/model.js's buildCrateModel) is
// the one place that already distinguishes a real group from a plain list.
export function crateCountLabel(count, section){
  const grouped = section && (section.key.startsWith('genre:') || section.key.startsWith('decade:'));
  if(grouped) return count + ' in ' + section.label;
  return count + (count === 1 ? ' record' : ' records');
}

export function albumTracks(album){
  const base = S.tracks.map((t,i)=>i).filter(i => S.tracks[i].tags.album === album);
  const mode = S.albumSort[album] || 'auto';
  if(mode === 'title') return base.sort((a,b) => byName(S.tracks[a].tags.title, S.tracks[b].tags.title));
  if(mode === 'manual'){
    // S.albumOrder[album] holds track ids, not positions (F3 spec) — ids
    // the user can no longer see (forgotten, not yet reconnected) just
    // stay in the saved order rather than being dropped from it
    let ord = S.albumOrder[album];
    if(!ord) ord = base.slice().sort(trackSort).map(idOf);
    base.forEach(i => { const id = idOf(i); if(ord.indexOf(id) < 0) ord.push(id); });   // pick up newly added files
    S.albumOrder[album] = ord;
    const baseSet = new Set(base);
    return ord.map(idxOf).filter(i => i >= 0 && baseSet.has(i));
  }
  return base.sort(trackSort);
}
