/* ================= file import and tag reading =================
   Moved out of main.js (step 5b): addFiles()'s import loop (and its
   drag-and-drop file-walking helpers), the test tone, storeTrack(), and
   likely-duplicate detection. Byte-level tag/artwork parsing itself lives
   in src/library/tags/ — this module is "what to do with a File object,"
   not "how to read one." The import loop's behavior is unchanged: one
   file at a time, the "Importing N of M" note, a failed file skipped
   (not aborting the batch), and new albums sealed once per batch
   (SEALED spec §2). Since AU5 (docs/16_AUDIO.md §4), the import loop also
   runs the BS.1770 loudness measurement right after decodeAudioData (see
   that call site's own comment for why there's no literal Worker, despite
   the doc's "in a worker" suggestion) — src/audio/loudness.js is a pure,
   DOM-free leaf, imported directly. */
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
import { loadOverlayFor } from './edit.js';
import { deleteTracks } from './delete.js';
import { rebuildPeopleIndex } from './credits.js';
import { persistSealedAlbums } from './sealed.js';
import { queueSave } from '../storage/meta.js';
import { invalidateCrateModel } from '../crate/model.js';
import { healCrateArt } from '../crate/tiers.js';
import { renderTracks } from './view.js';
import { reconcileImportedTrack } from '../sync/backup.js';
import { measureTrack } from '../audio/loudness.js';

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

// RF7 (docs/12_REFINE.md): the one decision addFiles()'s own sealing step
// actually makes, pulled out pure and exported so it's unit-testable
// without the real AudioContext.decodeAudioData the rest of addFiles()
// needs — the same "extract the pure core" shape this codebase already
// uses wherever the surrounding function can't be tested directly (e.g.
// scrub.js's angleDelta, gatefold/view.js's gatefoldSideSplits).
export function shouldSealOnImport(albumName, aid, isFirstImport, existingAlbumIds){
  return !isFirstImport && albumName !== 'Unknown Album' && !existingAlbumIds.has(aid);
}

export async function addFiles(list){
  const files = Array.from(list).filter(f => f.size > 0);
  if(!files.length) return;
  const failed = [];
  // an album not already in the library when this batch starts is "new" —
  // sealed once, regardless of how many of its files land in this same
  // batch (SEALED spec §2); loose tracks have no release identity to seal
  const existingAlbumIds = new Set(S.tracks.map(albumKey));
  // RF7 (docs/12_REFINE.md): a literally-empty library opens unwrapped —
  // "new" is supposed to mean "arrived after the library already had
  // something in it," not "arrived ever," so the very first import seals
  // nothing. Any later batch (the library has at least one track before
  // it starts, even if that track came from this same first batch's
  // earlier files) seals exactly as before.
  const isFirstImport = S.tracks.length === 0;
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
      // AU3 (docs/16_AUDIO.md §2.3): the context is created once, at the
      // device's own fixed rate — decodeAudioData resamples to it
      // regardless of the file's own rate, so there's no rate to pass here.
      await ensureContext();
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
      // AU5 (docs/16_AUDIO.md §4): "Import already decodes every file,
      // so compute BS.1770 integrated loudness and true peak there." Done
      // as a plain async step in this same loop rather than a literal
      // Worker — the measurement is a few biquad passes over one decoded
      // track (tens to low hundreds of ms of JS time), and this codebase
      // has no existing precedent of reaching for a Worker for comparable
      // on-device work (crate tiers/thumbnails are plain async main-thread
      // functions too) — not worth the message-protocol/lifecycle plumbing
      // a Worker needs for a one-shot, already-background (await-based)
      // computation that already yields the main thread between files via
      // the loop's own await points.
      const channels = [];
      for(let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
      details.loudness = measureTrack(channels, buffer.sampleRate);
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
      // a backed-up edit/playlist entry that arrived (via sync) before this
      // exact file ever did — step 06, B3's "music re-added later" — waits
      // by identity key until this moment to attach
      reconcileImportedTrack(t);
      {
        const aid = albumKey(t);
        if(shouldSealOnImport(tags.album, aid, isFirstImport, existingAlbumIds)){ S.sealed.add(aid); existingAlbumIds.add(aid); }
      }
      if(await storeTrack(t, fileBlob)){
        t.stored = true;
        t.blob = null;            // it lives on disk now; no need to hold it in memory
        t.artBlob = null;
      }
    }catch(_err){
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
  await ensureContext();
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
