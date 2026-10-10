/* ================= file import and tag reading =================
   Moved out of main.js (step 5b): addFiles()'s import loop (and its
   drag-and-drop file-walking helpers), the test tone, storeTrack(), and
   likely-duplicate detection. Byte-level tag/artwork parsing itself lives
   in src/library/tags/ — this module is "what to do with a File object,"
   not "how to read one." The import loop's behavior is unchanged: one
   file at a time, the "Importing N of M" note, a failed file skipped
   (not aborting the batch), and new albums sealed once per batch
   (SEALED spec §2). */
import { S } from '../state.js';
import { albumKey, trackIdentityKey } from '../record-art/tiers.js';
import { setPathNote } from '../ui/path-note.js';
import { ensureContext } from '../audio/engine.js';
import { touchLRU } from '../player/buffers.js';
import { setQueue } from '../player/queue.js';
import { allIdx } from './model.js';
import { storage, tracks } from '../storage/repo.js';
import { readHeader, readTags, readDetails, findArtworkBlob, emptyDetails } from './tags/index.js';
import { askDuplicateResolution } from './duplicates-ui.js';
// Temporary circular imports back to main.js (rule 8 in CLAUDE.md) — screen/
// persistence functions not yet extracted. Used only inside the functions
// below, never at module top level.
import {
  loadOverlayFor, rebuildPeopleIndex, invalidateCrateModel, renderTracks,
  queueSave, persistSealedAlbums, healCrateArt, deleteTracks,
} from '../main.js';

// Likely-duplicate match: same normalized artist+album+title identity,
// within a small duration tolerance — never auto-merged, only surfaced
// (see PLAYBACK/IMPORT spec §6).
export const DUP_DURATION_TOLERANCE_SEC = 2;
export function findDuplicateTrack(newTags, newDuration){
  const key = trackIdentityKey({tags:newTags});
  return S.tracks.find(t => trackIdentityKey(t) === key &&
    Math.abs((t.duration||0) - (newDuration||0)) <= DUP_DURATION_TOLERANCE_SEC);
}

// Walks a dropped selection (files and/or folders) via the DataTransferItem
// entry API — the drag-and-drop analog of the folder <input webkitdirectory>
// picker (see PLAYBACK/IMPORT spec §2).
function readDirEntries(dirReader){
  return new Promise((resolve, reject) => dirReader.readEntries(resolve, reject));
}
async function walkEntry(entry, out){
  if(!entry) return;
  if(entry.isFile){
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push(file);
  } else if(entry.isDirectory){
    const reader = entry.createReader();
    let batch;
    do{
      batch = await readDirEntries(reader);
      for(const child of batch) await walkEntry(child, out);
    }while(batch.length);
  }
}
export async function filesFromDataTransferItems(items){
  const entries = Array.from(items).map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  const out = [];
  for(const entry of entries) await walkEntry(entry, out);
  return out;
}

export async function addFiles(list){
  const files = Array.from(list).filter(f => f.size > 0);
  if(!files.length) return;
  const failed = [];
  // an album not already in the library when this batch starts is "new" —
  // sealed once, regardless of how many of its files land in this same
  // batch (SEALED spec §2); loose tracks have no release identity to seal
  const existingAlbumIds = new Set(S.tracks.map(albumKey));
  let i = 0;
  for(const f of files){
    i++;
    setPathNote('Importing ' + i + ' of ' + files.length + ' — ' + f.name);
    const id = f.name + '|' + f.size + '|' + (f.lastModified || 0);
    if(S.tracks.some(t => t.id === id)) continue;              // already in the library
    try{
      const raw = await f.arrayBuffer();
      const meta = readHeader(raw);
      // tags, artwork and a keepable copy of the file, all before
      // decodeAudioData detaches the buffer out from under us
      const tags = readTags(raw, f.name);
      const details = readDetails(raw);
      const artBlob = findArtworkBlob(raw);
      const fileBlob = new Blob([raw], {type: f.type || 'application/octet-stream'});
      // Decode at the file's own rate so the OS is not resampling underneath us.
      await ensureContext(meta.rate || null);
      const buffer = await S.ctx.decodeAudioData(raw);
      // Encoder delay/padding sample counts are expressed at the file's own
      // native rate — converting to seconds here keeps everything else
      // (t.duration, startSource's offsets) rate-independent. Lossless
      // formats and files with no/malformed gapless tag get zero trim,
      // which is exactly standard playback (see PLAYBACK spec §1).
      const gaplessRate = meta.rate || buffer.sampleRate;
      const gaplessDelaySec = meta.gapless ? meta.gapless.delay / gaplessRate : 0;
      const gaplessPaddingSec = meta.gapless ? meta.gapless.padding / gaplessRate : 0;
      const trimmedDuration = Math.max(0, buffer.duration - gaplessDelaySec - gaplessPaddingSec);
      const dup = findDuplicateTrack(tags, trimmedDuration || buffer.duration);
      if(dup){
        const choice = await askDuplicateResolution(dup, f.name);
        if(choice === 'skip') continue;
        if(choice === 'replace') await deleteTracks([dup.id]);
      }
      const t = {
        id, addedAt: Date.now(),
        name: tags.title, tags, details, buffer,
        duration: trimmedDuration || buffer.duration,
        gaplessDelaySec, gaplessPaddingSec, sizeBytes: raw.byteLength,
        art: artBlob ? URL.createObjectURL(artBlob) : null,
        artBlob, blob: fileBlob, stored: false,
        meta: {
          codec: meta.codec || 'Audio',
          rate: meta.rate || buffer.sampleRate,
          bits: meta.bits || null,
          lossless: meta.lossless === true,
          ch: meta.ch || buffer.numberOfChannels
        }
      };
      await loadOverlayFor(t);
      S.tracks.push(t);
      touchLRU(S.tracks.length - 1);
      {
        const aid = albumKey(t);
        if(tags.album !== 'Unknown Album' && !existingAlbumIds.has(aid)){ S.sealed.add(aid); existingAlbumIds.add(aid); }
      }
      if(await storeTrack(t, fileBlob)){
        t.stored = true;
        t.blob = null;            // it lives on disk now; no need to hold it in memory
        t.artBlob = null;
      }
    }catch(err){
      // one bad file should never stop the rest of the batch — note it and
      // move on, then summarize every failure once the batch is done
      failed.push(f.name);
    }
  }
  rebuildPeopleIndex();
  invalidateCrateModel();
  renderTracks();
  queueSave();
  persistSealedAlbums();
  MizikiSocial.libraryChanged();
  healCrateArt().catch(() => {});   // resumable — only the newly-imported albums are missing a tier
  if(S.index < 0 && S.tracks.length) setQueue(allIdx(), 0, false);
  if(failed.length){
    setPathNote('Imported ' + (files.length - failed.length) + ' of ' + files.length + '. Could not decode: ' + failed.join(', ')
      + '. This browser may not support that format — WAV works everywhere, and FLAC works in Safari and Chrome.', true);
  } else {
    setPathNote();
  }
}

function makeTestTone(){
  const rate = 48000, dur = 12, ctx = S.ctx;
  const buf = ctx.createBuffer(2, rate*dur, rate);
  const chord = [110, 164.81, 220, 261.63, 329.63, 440];
  for(let ch=0; ch<2; ch++){
    const d = buf.getChannelData(ch);
    for(let i=0;i<d.length;i++){
      const t = i/rate; let v = 0;
      chord.forEach((f,k)=>{
        const det = 1 + (ch? 0.0012 : -0.0012)*(k+1);
        const env = 0.5 + 0.5*Math.sin(2*Math.PI*(0.09*(k+1))*t - 1.2);
        v += Math.sin(2*Math.PI*f*det*t) * env / chord.length;
        v += 0.14*Math.sin(4*Math.PI*f*det*t) * env / chord.length;
      });
      const fade = Math.min(1, t/1.5, (dur-t)/1.5);
      d[i] = v * 0.42 * fade;
    }
  }
  return buf;
}

export async function addTestTone(){
  if(S.tracks.some(t=>t.id==='miziki:testtone')) return;
  await ensureContext(48000);
  const buf = makeTestTone();
  S.tracks.push({id:'miziki:testtone', addedAt:Date.now(), name:'Test tone — Dm9 pad',
    buffer:buf, duration:buf.duration, art:null, artBlob:null, blob:null, stored:false,
    tags:{title:'Test tone — Dm9 pad', artist:'Miziki', album:'Bench Tones',
          albumArtist:'Miziki', track:1, disc:0},
    details: emptyDetails(),
    meta:{codec:'Generated', rate:48000, bits:32, ch:2, lossless:true}});
  touchLRU(S.tracks.length - 1);
  renderTracks();
  if(S.index < 0) setQueue(allIdx(), S.tracks.length-1, false);
}

export async function storeTrack(t, blob){
  if(!storage.available()) return false;
  const artBlob = t.artBlob || null;
  // always the embedded tags, never the overlay-resolved ones — the overlay
  // already lives in its own store and is re-applied on every load
  const ok = await tracks.put({id:t.id, blob, art:artBlob, tags:(t.embeddedTags || t.tags), details:t.details || null, meta:t.meta,
    duration:t.duration, gaplessDelaySec:t.gaplessDelaySec || 0, gaplessPaddingSec:t.gaplessPaddingSec || 0,
    addedAt:t.addedAt, sizeBytes:t.sizeBytes || 0});
  return ok;
}
