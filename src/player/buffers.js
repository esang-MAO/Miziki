/* ---- decoded audio is enormous (a four-minute stereo track is ~85 MB of
   float32), so only a few tracks stay decoded at once. Everything else is
   re-decoded from its stored file on demand. ---- */
import { S } from '../state.js';
import { tracks } from '../storage/repo.js';
import { setPathNote } from '../ui/path-note.js';
import { ensureContext } from '../audio/engine.js';

export function touchLRU(i){
  S.lru = [i].concat(S.lru.filter(x => x !== i));
  while(S.lru.length > 3){
    const drop = S.lru.pop();
    if(drop !== S.index && S.tracks[drop]) S.tracks[drop].buffer = null;
  }
}

export async function ensureBuffer(i){
  const t = S.tracks[i];
  if(!t) return false;
  if(t.buffer){ touchLRU(i); return true; }
  let blob = t.blob;
  if(!blob && t.stored){ const rec = await tracks.get(t.id); blob = rec && rec.blob; }
  if(!blob){ setPathNote('The file for this track is no longer available. Add it again from Library.', true); return false; }
  try{
    setPathNote('Decoding ' + t.tags.title + '…');
    const raw = await blob.arrayBuffer();
    await ensureContext(t.meta.rate || null);
    t.buffer = await S.ctx.decodeAudioData(raw);
    // don't clobber the already-trimmed duration (encoder delay/padding
    // excluded) with the raw buffer's — see PLAYBACK spec §1
    t.duration = Math.max(0, t.buffer.duration - (t.gaplessDelaySec || 0) - (t.gaplessPaddingSec || 0)) || t.buffer.duration;
    touchLRU(i);
    setPathNote();
    return true;
  }catch(e){
    setPathNote('Could not decode ' + t.tags.title + '.', true);
    return false;
  }
}
