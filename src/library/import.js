/* ================= file import and tag reading =================
   addFiles()'s import loop (and its drag-and-drop file-walking helpers),
   the test tone, storeTrack(), and likely-duplicate detection. Byte-level
   tag/artwork parsing itself lives in src/library/tags/ — this module is
   "what to do with a File object," not "how to read one." One file at a
   time, the "Importing N of M" note, a failed file skipped (not aborting
   the batch), and new albums sealed once per batch (SEALED spec §2). The
   import loop also runs the BS.1770 loudness measurement (AU5,
   docs/16_AUDIO.md §4) and the hook-detection pass (AU12, §7) right after
   decodeAudioData, both via audio/analysis-client.js's analyzeTrack()
   (off the main thread, in a Worker). */
import { S } from '../state.js';
import { albumKey, trackIdentityKey } from '../record-art/tiers.js';
import { setPathNote } from '../ui/path-note.js';
import { ensureContext, decodeAudioFile } from '../audio/engine.js';
import { touchLRU, decodedBytesFor, DECODE_MAX_BYTES } from '../player/buffers.js';
import { setQueue } from '../player/queue.js';
import { allIdx } from './model.js';
import { storage, tracks } from '../storage/repo.js';
import { readHeader, readTags, readDetails, findArtworkBlob, emptyDetails } from './tags/index.js';
import { openDuplicatesSheet } from './duplicates-ui.js';
import { loadOverlayFor } from './edit.js';
import { deleteTracks } from './delete.js';
import { rebuildPeopleIndex } from './credits.js';
import { persistSealedAlbums } from './sealed.js';
import { queueSave } from '../storage/meta.js';
import { invalidateCrateModel } from '../crate/model.js';
import { healCrateArt } from '../crate/tiers.js';
import { renderTracks } from './view.js';
import { reconcileImportedTrack } from '../sync/backup.js';
import { analyzeTrack } from '../audio/analysis-client.js';
import { isBookletPageCandidate, groupBookletCandidatesByAlbumFolder, addBookletPages } from './booklet.js';

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
  const allFiles = Array.from(list).filter(f => f.size > 0);
  if(!allFiles.length) return;
  // GF10 (docs/29_GATEFOLD.md): sidecar booklet-page images, picked up
  // from a folder import or a folder dropped in, never reach the audio
  // decode loop below (they'd just fail it as "could not decode") --
  // pulled out first, matched to an album by shared folder once this
  // batch's audio files are known, and stored as the album's booklet.
  const bookletCandidates = [];
  const files = allFiles.filter(f => {
    if(!isBookletPageCandidate(f.name, f.webkitRelativePath)) return true;
    bookletCandidates.push(f);
    return false;
  });
  if(!files.length) return;   // booklet images with no audio sibling in this batch have no album to attach to
  const folderAlbumIds = new Map();   // audio file's own folder -> the album it belongs to
  const failed = [];
  // BD3: stored with tags but never decoded -- too long to safely decode
  // in the web build. Named separately from `failed` since nothing about
  // these actually failed; they're just waiting for the native build.
  const tooLong = [];
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
  // LB1 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 1): a possible duplicate
  // no longer pauses the loop to ask -- it's collected here, fully decoded
  // and ready to finish building (finishDuplicateTrack() below), and the
  // file is skipped for now. Every other file keeps importing. Once the
  // whole batch is in, addFiles() opens one sheet for every item still in
  // this list, instead of asking once per file.
  const pendingDupes = [];
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
      // BD3 (docs/38_BEFORE_THE_DOMAIN.md): a file long enough to decode
      // into an unmanageable amount of memory never reaches decodeAudioFile()
      // at all -- only possible where the header itself gives an exact
      // duration (FLAC/WAV today; readHeader() leaves durationSec null
      // for every other format, so those still decode as before this
      // step -- the native build, which streams instead of decoding
      // whole, covers the rest).
      await ensureContext();
      const tooLongToDecode = meta.durationSec != null &&
        decodedBytesFor(meta.durationSec, meta.ch || 2, S.ctx.sampleRate) > DECODE_MAX_BYTES;
      // AU3 (docs/16_AUDIO.md §2.3): the context is created once, at the
      // device's own fixed rate — decodeAudioData resamples to it
      // regardless of the file's own rate, so there's no rate to pass here.
      // Decoded on a disposable OfflineAudioContext, not the live S.ctx, so
      // a big import batch can't contend with whatever is already playing
      // — see decodeAudioFile()'s own comment.
      const buffer = tooLongToDecode ? null : await decodeAudioFile(raw);
      // Encoder delay/padding sample counts are expressed at the file's own
      // native rate — converting to seconds here keeps everything else
      // (t.duration, startSource's offsets) rate-independent. Lossless
      // formats and files with no/malformed gapless tag get zero trim,
      // which is exactly standard playback (see PLAYBACK spec §1). A file
      // too long to decode has no buffer to trim against, so its duration
      // is the header's own, untrimmed.
      const gaplessRate = meta.rate || (buffer && buffer.sampleRate);
      const gaplessDelaySec = (!tooLongToDecode && meta.gapless) ? meta.gapless.delay / gaplessRate : 0;
      const gaplessPaddingSec = (!tooLongToDecode && meta.gapless) ? meta.gapless.padding / gaplessRate : 0;
      const trimmedDuration = buffer
        ? Math.max(0, buffer.duration - gaplessDelaySec - gaplessPaddingSec)
        : (meta.durationSec || 0);
      // AU5 (docs/16_AUDIO.md §4)/AU12 (§7): "Import already decodes every
      // file, so compute BS.1770 integrated loudness and true peak there"
      // / "find each track's most-repeated section" — one round trip to
      // the analysis worker (PL6 item 1) computes both from the same
      // decode, off the main thread. detectHook()'s own result is null
      // for anything too short for a meaningful 8-30s repeat (or with no
      // clear one at all) — hookStart/hookEnd are simply left unset on
      // details, the same "absent means unknown" posture every other
      // optional details field already has. A track too long to decode
      // gets neither — same posture, one more reason for "unmeasured."
      if(buffer){
        const channels = [];
        for(let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
        const analysis = await analyzeTrack(channels, buffer.sampleRate);
        details.loudness = analysis.loudness;
        if(analysis.hook){ details.hookStart = analysis.hook.hookStart; details.hookEnd = analysis.hook.hookEnd; }
      } else {
        tooLong.push(f.name);
      }
      const dup = findDuplicateTrack(tags, trimmedDuration || (buffer && buffer.duration) || 0);
      if(dup){
        // The matched existing track is already in the library, so the
        // album it belongs to is never "new" -- GF10's folder->album
        // booklet mapping doesn't need to wait on Keep/Replace/Skip
        // either way, so it's recorded now same as a normal track's own.
        const dir = (f.webkitRelativePath || '').split('/').slice(0, -1).join('/');
        folderAlbumIds.set(dir, albumKey({tags}));
        pendingDupes.push({
          id, tags, details, buffer, trimmedDuration, gaplessDelaySec, gaplessPaddingSec,
          sizeBytes: raw.byteLength, artBlob, fileBlob, fileName: f.name, existingTrack: dup,
          // normalized the same way the non-duplicate path below builds
          // its own t.meta -- finishDuplicateTrack() uses this as-is.
          meta: {
            codec: meta.codec || 'Audio',
            rate: meta.rate || (buffer && buffer.sampleRate) || null,
            bits: meta.bits || null,
            lossless: meta.lossless === true,
            ch: meta.ch || (buffer && buffer.numberOfChannels) || null,
          },
        });
        continue;
      }
      const t = {
        id, addedAt: Date.now(),
        name: tags.title, tags, details, buffer,
        duration: trimmedDuration || (buffer && buffer.duration) || 0,
        gaplessDelaySec, gaplessPaddingSec, sizeBytes: raw.byteLength,
        art: artBlob ? URL.createObjectURL(artBlob) : null,
        artBlob, blob: fileBlob, stored: false,
        meta: {
          codec: meta.codec || 'Audio',
          rate: meta.rate || (buffer && buffer.sampleRate) || null,
          bits: meta.bits || null,
          lossless: meta.lossless === true,
          ch: meta.ch || (buffer && buffer.numberOfChannels) || null
        }
      };
      await loadOverlayFor(t);
      S.tracks.push(t);
      if(buffer) touchLRU(S.tracks.length - 1);
      // a backed-up edit/playlist entry that arrived (via sync) before this
      // exact file ever did ("music re-added later") waits by identity key
      // until this moment to attach
      reconcileImportedTrack(t);
      {
        const aid = albumKey(t);
        if(shouldSealOnImport(tags.album, aid, isFirstImport, existingAlbumIds)){ S.sealed.add(aid); existingAlbumIds.add(aid); }
        // GF10: this file's own folder (dirname of its webkitRelativePath,
        // '' for a flat pick) is where a sidecar booklet/scans/artwork
        // subfolder -- or a booklet-prefixed page right beside it -- would
        // live, so the booklet group keyed by that same folder belongs to
        // this track's album.
        const dir = (f.webkitRelativePath || '').split('/').slice(0, -1).join('/');
        folderAlbumIds.set(dir, aid);
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
  await storeBookletCandidates(bookletCandidates, folderAlbumIds);
  syncAfterImportChange();
  if(failed.length || tooLong.length){
    let note = 'Imported ' + (files.length - failed.length - tooLong.length) + ' of ' + files.length + '.';
    if(failed.length) note += ' Could not decode: ' + failed.join(', ')
      + '. This browser may not support that format — WAV works everywhere, and FLAC works in Safari and Chrome.';
    if(tooLong.length) note += ' Too long to play in the web version of Miziki: ' + tooLong.join(', ') + '.';
    setPathNote(note, true);
  } else {
    setPathNote();
  }
  if(pendingDupes.length){
    const imported = files.length - failed.length - pendingDupes.length;
    openDuplicatesSheet(pendingDupes, imported, async (resolved) => {
      for(const { item, choice } of resolved) await finishDuplicateTrack(item, choice, isFirstImport, existingAlbumIds);
      syncAfterImportChange();
    });
  }
}

// The same five bookkeeping steps the import loop above used to reach only
// once, at the very end -- also re-run once a possible duplicate's
// Keep/Replace/Skip choice has actually landed any new track(s) (see
// finishDuplicateTrack() below), since those arrive after addFiles()'s own
// first call already ran. Cheap and idempotent either way.
function syncAfterImportChange(){
  rebuildPeopleIndex();
  invalidateCrateModel();
  renderTracks();
  queueSave();
  persistSealedAlbums();
  MizikiSocial.libraryChanged();
  healCrateArt().catch(() => {});   // resumable — only the newly-imported albums are missing a tier
  if(S.index < 0 && S.tracks.length) setQueue(allIdx(), 0, false);
}

// Finishes exactly what addFiles()'s own loop would have done for a
// duplicate file, now that its choice is known -- 'skip' leaves it out
// entirely (nothing was ever decoded-and-discarded beyond what 'skip'
// already discarded before this point), 'replace' removes the matched
// existing track first, and both 'replace'/'keep' then build and add the
// track exactly as a non-duplicate file would have. `isFirstImport`/
// `existingAlbumIds` are addFiles()'s own per-batch state, passed through
// rather than closed over, so this stays a plain top-level function.
async function finishDuplicateTrack(item, choice, isFirstImport, existingAlbumIds){
  if(choice === 'skip') return;
  if(choice === 'replace') await deleteTracks([item.existingTrack.id]);
  const t = {
    id: item.id, addedAt: Date.now(),
    name: item.tags.title, tags: item.tags, details: item.details, buffer: item.buffer,
    duration: item.trimmedDuration || (item.buffer && item.buffer.duration) || 0,
    gaplessDelaySec: item.gaplessDelaySec, gaplessPaddingSec: item.gaplessPaddingSec, sizeBytes: item.sizeBytes,
    art: item.artBlob ? URL.createObjectURL(item.artBlob) : null,
    artBlob: item.artBlob, blob: item.fileBlob, stored: false,
    meta: item.meta,
  };
  await loadOverlayFor(t);
  S.tracks.push(t);
  if(t.buffer) touchLRU(S.tracks.length - 1);
  reconcileImportedTrack(t);
  const aid = albumKey(t);
  // Always a no-op in practice: `aid` was already in existingAlbumIds
  // before this batch even started (a duplicate only exists because its
  // album's existing track is already in the library) -- kept so this
  // stays exactly the same decision shouldSealOnImport makes for every
  // other track, rather than a special case for this path.
  if(shouldSealOnImport(t.tags.album, aid, isFirstImport, existingAlbumIds)){ S.sealed.add(aid); existingAlbumIds.add(aid); }
  if(await storeTrack(t, item.fileBlob)){
    t.stored = true;
    t.blob = null;
    t.artBlob = null;
  }
}

// GF10: matches each booklet-candidate group (by its shared folder) to
// the album whose audio files landed in that same folder this batch, and
// appends its pages in file-name order. A group with no matching folder
// (its audio siblings weren't part of this import, or there were none)
// is silently left unattached — nothing in this batch knows which album
// it belongs to.
async function storeBookletCandidates(candidates, folderAlbumIds){
  if(!candidates.length) return;
  const groups = groupBookletCandidatesByAlbumFolder(candidates.map(f => ({ name: f.name, relativePath: f.webkitRelativePath, file: f })));
  for(const [folder, group] of groups){
    const albumId = folderAlbumIds.get(folder);
    if(!albumId) continue;
    await addBookletPages(albumId, group.map(c => c.file));
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
