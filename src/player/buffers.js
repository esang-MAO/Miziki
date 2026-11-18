/* ---- decoded audio is enormous (a four-minute stereo track is ~85 MB of
   float32), so only a few tracks stay decoded at once. Everything else is
   re-decoded from its stored file on demand. BD3 (docs/38_BEFORE_THE_DOMAIN.md):
   a track whose decode would be enormous gets a hard ceiling (never
   decoded at all, the same "file unavailable" path a missing file takes)
   and a softer one just below it (this track becomes the only one the
   LRU keeps decoded while it's current, so it can't be squeezed between
   two others the LRU would otherwise also try to hold). ---- */
import { S } from '../state.js';
import { tracks } from '../storage/repo.js';
import { setPathNote } from '../ui/path-note.js';
import { ensureContext } from '../audio/engine.js';

// ~13 minutes of stereo float32 at 48kHz.
export const DECODE_SOLO_BYTES = 300 * 1024 * 1024;
// ~52 minutes of stereo float32 at 48kHz. The native build (Capacitor)
// streams instead of decoding whole, so this ceiling is web-only.
export const DECODE_MAX_BYTES = 1.2 * 1024 * 1024 * 1024;

export function decodedBytesFor(durationSec, channels, sampleRate){
  return Math.max(0, durationSec || 0) * Math.max(1, channels || 0) * Math.max(1, sampleRate || 0) * 4;
}

export function touchLRU(i, maxKeep = 3){
  S.lru = [i].concat(S.lru.filter(x => x !== i));
  while(S.lru.length > maxKeep){
    const drop = S.lru.pop();
    if(drop !== S.index && S.tracks[drop]) S.tracks[drop].buffer = null;
  }
}

export async function ensureBuffer(i){
  const t = S.tracks[i];
  if(!t) return false;
  if(t.buffer){
    const solo = (t.buffer.length * t.buffer.numberOfChannels * 4) > DECODE_SOLO_BYTES;
    touchLRU(i, solo ? 1 : 3);
    return true;
  }
  let blob = t.blob;
  if(!blob && t.stored){ const rec = await tracks.get(t.id); blob = rec && rec.blob; }
  if(!blob){ setPathNote('The file for this track is no longer available. Add it again from Library.', true); return false; }
  try{
    // AU3 (docs/16_AUDIO.md §2.3): one fixed-rate context, never rebuilt
    // per track — decodeAudioData resamples to it regardless, so the
    // estimate below uses the context's own rate, not the file's.
    await ensureContext();
    const estBytes = decodedBytesFor(t.duration, t.meta && t.meta.ch, S.ctx.sampleRate);
    if(estBytes > DECODE_MAX_BYTES){
      setPathNote('This track is too long to play in the web version of Miziki.', true);
      return false;
    }
    const solo = estBytes > DECODE_SOLO_BYTES;
    setPathNote('Decoding ' + t.tags.title + '…');
    const raw = await blob.arrayBuffer();
    if(solo){
      for(const idx of S.lru) if(idx !== i && S.tracks[idx]) S.tracks[idx].buffer = null;
      S.lru = [];
    }
    t.buffer = await S.ctx.decodeAudioData(raw);
    // don't clobber the already-trimmed duration (encoder delay/padding
    // excluded) with the raw buffer's — see PLAYBACK spec §1
    t.duration = Math.max(0, t.buffer.duration - (t.gaplessDelaySec || 0) - (t.gaplessPaddingSec || 0)) || t.buffer.duration;
    touchLRU(i, solo ? 1 : 3);
    setPathNote();
    return true;
  }catch(_e){
    setPathNote('Could not decode ' + t.tags.title + '.', true);
    return false;
  }
}
