import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readHeader, readTags, readDetails, findArtworkBlob } from '../../src/library/tags/index.js';

// import.js has temporary circular imports back to main.js (rule 8 in
// CLAUDE.md), plus real imports (queue.js, buffers.js, edit.js, delete.js)
// that themselves pull in transport.js/clock.js/sleep-timer.js/engine.js,
// and those in turn need more of main.js's DOM-dependent top level.
// findDuplicateTrack and DUP_DURATION_TOLERANCE_SEC don't touch any of
// that — they only read S.tracks — but loading import.js at all means
// stopping the chain at the door, the same approach as
// engine.test.js/queue.test.js. queue.js's own real chain now reaches
// skipWithLift(), which imports REDUCED from util/motion.js -- read once,
// at module load, from window.matchMedia.
globalThis.window = { matchMedia(){ return { matches: false }; } };
// Since step 7d, import.js's own renderTracks import, edit.js's
// exitSelectMode import (reached via import.js's real loadOverlayFor
// import, step 5d) and credits.js's songRow import (reached via
// import.js's real rebuildPeopleIndex import, step 5e) are all real ones
// from src/library/view.js instead of main.js — mocked directly here,
// same "stop the chain at the door" reasoning as the rest of this file.
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks(){}, exitSelectMode(){}, songRow(){}, updateTrackRow(){ return false; } },
});
// RF23 (docs/12_REFINE.md): credits.js's new, one-directional import of
// openFriendStore (social/screens/friend-store.js) would otherwise reach
// that module's own real chain (profile/storefront.js and everything past
// it) via import.js's own real rebuildPeopleIndex import — stopped at that
// new edge, the same way tests/unit/credits.test.js does.
mock.module(new URL('../../src/social/screens/friend-store.js', import.meta.url).href, {
  namedExports: { openFriendStore(){} },
});
// Since step 7c, import.js's invalidateCrateModel/healCrateArt imports and
// edit.js's/delete.js's deleteCrateArtTiers/buildCrateTier imports are real
// ones from src/crate/model.js/tiers.js instead of main.js — mocked
// directly here, same "stop the chain at the door" reasoning (crate/
// model.js's own real chain reads window.devicePixelRatio via crate/
// constants.js at module load, which there's no browser for here).
mock.module(new URL('../../src/crate/tiers.js', import.meta.url).href, {
  namedExports: {
    healCrateArt: async () => {},
    deleteCrateArtTiers: async () => {}, buildCrateTier: async () => {},
  },
});
mock.module(new URL('../../src/crate/model.js', import.meta.url).href, {
  namedExports: { invalidateCrateModel(){} },
});
// Since step 7b, queue.js's five screen/ceremony functions, edit.js's/
// delete.js's renderMiniPlayer, delete.js's clearSpinDown, delete.js's/
// credits.js's closePlayer and credits.js's showRoute all moved off
// main.js into real src/shell/ modules — mocked there directly instead,
// same "stop the chain at the door" reasoning as the rest of this file.
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { runStartSequence: async () => {} },
});
mock.module(new URL('../../src/shell/player-overlay.js', import.meta.url).href, {
  namedExports: { openPlayerViaSheet(){}, closePlayer(){} },
});
// CEREMONY PR 3: player/queue.js and shell/start-sequence.js import
// shell/runout.js, whose real chain reaches library/view.js — stop it here.
mock.module(new URL('../../src/shell/runout.js', import.meta.url).href, {
  namedExports: { endOfQueue(){}, maybeSideFlip(){ return false; }, cancelRunout(){}, interruptRunout(){ return false; }, clearToRest(){}, performPendingFlip(){ return false; } },
});
mock.module(new URL('../../src/shell/put-away.js', import.meta.url).href, {
  namedExports: {
    shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence: async () => {},
    clearSpinDown(){},
  },
});
mock.module(new URL('../../src/shell/mini-player.js', import.meta.url).href, {
  namedExports: { renderMiniPlayer(){} },
});
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { showRoute(){} },
});
// Since step 7a, import.js's own queueSave import is real (from
// storage/meta.js) instead of main.js — mocked directly here, same "stop
// the chain at the door" reasoning as the rest of this file.
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){}, touchBackupField(){} },
});
// import.js's own persistSealedAlbums import, and queue.js's (via
// history/sessions.js) applyDiscVariant/restoreThumbs imports, are real
// ones from library/sealed.js/record-art/looks.js/library/thumbs.js now
// (step 6b) — mocked on their own modules so none of their further real
// chains (sealed.js's/thumbs.js's own circular main.js imports, thumbs.js
// reaching library/edit.js) have to load. pruneThumbs is import.js's own
// direct import since step 02 (via its real deleteTracks/delete.js import,
// which forgetLibrary() calls it from) — mocked here too, for the same
// reason.
mock.module(new URL('../../src/library/sealed.js', import.meta.url).href, {
  namedExports: { persistSealedAlbums(){} },
});
mock.module(new URL('../../src/record-art/looks.js', import.meta.url).href, {
  namedExports: { applyDiscVariant(){} },
});
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { restoreThumbs: async () => {}, pruneThumbs: async () => {}, persistable(rec){ return rec; } },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load(){}, play(){}, pause(){}, pauseAndRest(){}, seek(){}, stop(){}, sideLetterFor(){ return ''; }, cancelPendingGapless(){} },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { sleepStopPlayback(){}, stopSleepState(){} },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext: async () => {}, applyCharacter(){}, applyWobbleRate(){}, applyLoudnessNorm(){}, routeSource(){}, decodeAudioFile: async () => {} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});

const { findDuplicateTrack, DUP_DURATION_TOLERANCE_SEC, shouldSealOnImport } = await import('../../src/library/import.js');
const { S } = await import('../../src/state.js');

// -- byte-fixture builders -----------------------------------------------
// These build the smallest real-shaped files the parsers need. No real
// music files are committed; everything here is synthesized.

function concatBytes(chunks){
  const total = chunks.reduce((n,c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for(const c of chunks){ out.set(c, off); off += c.length; }
  return out;
}
function u32beBytes(n){ return new Uint8Array([(n>>>24)&0xFF, (n>>>16)&0xFF, (n>>>8)&0xFF, n&0xFF]); }
function u24beBytes(n){ return new Uint8Array([(n>>>16)&0xFF, (n>>>8)&0xFF, n&0xFF]); }
function synchBytes(n){
  return new Uint8Array([(n>>>21)&0x7F, (n>>>14)&0x7F, (n>>>7)&0x7F, n&0x7F]);
}
function asciiBytes(s){ return new TextEncoder().encode(s); }
function u32leBytes(n){ return new Uint8Array([n&0xFF, (n>>>8)&0xFF, (n>>>16)&0xFF, (n>>>24)&0xFF]); }

// -- ID3v2.3 tag builder --
function id3Frame(id, encoding, text){
  const textBytes = encoding === 1
    ? concatBytes([new Uint8Array([0xFF,0xFE]), new Uint8Array(new Uint16Array([...text].map(c=>c.charCodeAt(0))).buffer)])
    : asciiBytes(text);
  const payload = concatBytes([new Uint8Array([encoding]), textBytes]);
  return concatBytes([asciiBytes(id), u32beBytes(payload.length), new Uint8Array([0,0]), payload]);
}
function txxxFrame(description, value, encoding=0){
  const descBytes = encoding === 1
    ? concatBytes([new Uint8Array([0xFF,0xFE]), new Uint8Array(new Uint16Array([...description].map(c=>c.charCodeAt(0))).buffer), new Uint8Array([0,0])])
    : concatBytes([asciiBytes(description), new Uint8Array([0])]);
  const valueBytes = encoding === 1
    ? concatBytes([new Uint8Array([0xFF,0xFE]), new Uint8Array(new Uint16Array([...value].map(c=>c.charCodeAt(0))).buffer)])
    : asciiBytes(value);
  const payload = concatBytes([new Uint8Array([encoding]), descBytes, valueBytes]);
  return concatBytes([asciiBytes('TXXX'), u32beBytes(payload.length), new Uint8Array([0,0]), payload]);
}
function apicFrame(mime, data, {encoding=0, description=''}={}){
  // the description's own null terminator width depends on `encoding` —
  // 1 byte for Latin-1/UTF-8 (0/3), 2 bytes for UTF-16 (1/2)
  const descBytes = encoding === 1
    ? concatBytes([new Uint8Array([0xFF,0xFE]), new Uint8Array(new Uint16Array([...description].map(c=>c.charCodeAt(0))).buffer), new Uint8Array([0,0])])
    : concatBytes([asciiBytes(description), new Uint8Array([0])]);
  const payload = concatBytes([
    new Uint8Array([encoding]),   // text encoding
    asciiBytes(mime), new Uint8Array([0]),  // mime + null (always Latin-1, per spec)
    new Uint8Array([3]),          // picture type (3 = front cover)
    descBytes,
    data,
  ]);
  return concatBytes([asciiBytes('APIC'), u32beBytes(payload.length), new Uint8Array([0,0]), payload]);
}
function buildID3File(frames){
  const body = concatBytes(frames);
  const header = concatBytes([asciiBytes('ID3'), new Uint8Array([3,0,0]), synchBytes(body.length)]);
  return concatBytes([header, body]).buffer;
}

// -- FLAC builder --
function flacBlockHeader(type, last, length){
  return concatBytes([new Uint8Array([(last?0x80:0)|type]), u24beBytes(length)]);
}
function streamInfoPayload({rate, ch, bits}){
  // bytes 0-9: min/max blocksize + min/max framesize (unused here, zeroed)
  const head = new Uint8Array(10);
  // bytes 10-13: 20-bit rate, 3-bit (ch-1), 5-bit (bits-1), top nibble of total_samples
  const b0 = (rate >> 12) & 0xFF;
  const b1 = (rate >> 4) & 0xFF;
  const chMinus1 = ch - 1, bitsMinus1 = bits - 1;
  const b2 = ((rate & 0x0F) << 4) | ((chMinus1 & 0x07) << 1) | ((bitsMinus1 >> 4) & 0x01);
  const b3 = (bitsMinus1 & 0x0F) << 4; // remaining bits_per_sample nibble + top of total_samples (zeroed)
  const tail = new Uint8Array(20); // rest of total_samples (36 bits) + 16-byte MD5, zeroed
  return concatBytes([head, new Uint8Array([b0,b1,b2,b3]), tail]); // 10 + 4 + 20 = 34 bytes
}
function vorbisCommentPayload(comments){
  const vendor = asciiBytes('test');
  const parts = [u32leBytes(vendor.length), vendor, u32leBytes(comments.length)];
  for(const c of comments){
    const bytes = asciiBytes(c);
    parts.push(u32leBytes(bytes.length), bytes);
  }
  return concatBytes(parts);
}
function flacPicturePayload(mime, data){
  const mimeBytes = asciiBytes(mime);
  return concatBytes([
    u32beBytes(3),                 // picture type (3 = front cover)
    u32beBytes(mimeBytes.length), mimeBytes,
    u32beBytes(0),                 // description length (empty)
    u32beBytes(0), u32beBytes(0), u32beBytes(0), u32beBytes(0), // width, height, depth, colours
    u32beBytes(data.length), data,
  ]);
}
function buildFlacFile({rate=44100, ch=2, bits=16, comments=[], picture=null}){
  const blocks = [];
  const streamInfo = streamInfoPayload({rate, ch, bits});
  const haveVorbis = true;
  const haveTrailingBlocks = haveVorbis || picture;
  blocks.push(flacBlockHeader(0, !haveTrailingBlocks, streamInfo.length), streamInfo);
  const vorbis = vorbisCommentPayload(comments);
  blocks.push(flacBlockHeader(4, !picture, vorbis.length), vorbis);
  if(picture){
    const pic = flacPicturePayload(picture.mime, picture.data);
    blocks.push(flacBlockHeader(6, true, pic.length), pic);
  }
  return concatBytes([asciiBytes('fLaC'), ...blocks]).buffer;
}

// -- tests: ID3v2 ----------------------------------------------------------

test('ID3v2: title/artist/album/track parse correctly', () => {
  const buf = buildID3File([
    id3Frame('TIT2', 0, 'Test Title'),
    id3Frame('TPE1', 0, 'Test Artist'),
    id3Frame('TALB', 0, 'Test Album'),
    id3Frame('TRCK', 0, '7'),
  ]);
  const tags = readTags(buf, 'fallback.mp3');
  assert.equal(tags.title, 'Test Title');
  assert.equal(tags.artist, 'Test Artist');
  assert.equal(tags.album, 'Test Album');
  assert.equal(tags.track, 7);
});

test('ID3v2: a UTF-16 text frame decodes correctly', () => {
  const buf = buildID3File([
    id3Frame('TIT2', 1, 'Café Title'),
    id3Frame('TPE1', 0, 'Artist'),
  ]);
  const tags = readTags(buf, 'fallback.mp3');
  assert.equal(tags.title, 'Café Title');
});

test('ID3v2: missing title falls back to the filename, missing artist/album to Unknown', () => {
  const buf = buildID3File([id3Frame('TRCK', 0, '1')]);
  const tags = readTags(buf, 'My Song.mp3');
  assert.equal(tags.title, 'My Song');
  assert.equal(tags.artist, 'Unknown Artist');
  assert.equal(tags.album, 'Unknown Album');
});

// -- tests: FLAC ------------------------------------------------------------

test('FLAC: VORBIS_COMMENT tags parse correctly', () => {
  const buf = buildFlacFile({
    comments: ['TITLE=Flac Title', 'ARTIST=Flac Artist', 'ALBUM=Flac Album', 'TRACKNUMBER=3', 'DISCNUMBER=1'],
  });
  const tags = readTags(buf, 'fallback.flac');
  assert.equal(tags.title, 'Flac Title');
  assert.equal(tags.artist, 'Flac Artist');
  assert.equal(tags.album, 'Flac Album');
  assert.equal(tags.track, 3);
  assert.equal(tags.disc, 1);
});

test('FLAC: STREAMINFO gives the right sample rate, channels and bit depth', () => {
  const buf = buildFlacFile({rate: 96000, ch: 2, bits: 24, comments: ['TITLE=Hi-res']});
  const meta = readHeader(buf);
  assert.equal(meta.codec, 'FLAC');
  assert.equal(meta.lossless, true);
  assert.equal(meta.rate, 96000);
  assert.equal(meta.ch, 2);
  assert.equal(meta.bits, 24);
});

test('FLAC: a different rate/bit-depth combination still parses correctly (CD quality)', () => {
  const buf = buildFlacFile({rate: 44100, ch: 2, bits: 16, comments: []});
  const meta = readHeader(buf);
  assert.equal(meta.rate, 44100);
  assert.equal(meta.bits, 16);
});

// -- tests: ReplayGain (AU5, docs/16_AUDIO.md §4) ---------------------------
// FLAC (Vorbis comment) and ID3 (TXXX) round trips -- MP4 freeform atoms
// have no existing fixture builder in this file at all (not even for
// title/artist), so building one from scratch for just this one field is
// out of scope here; mp4Details()'s own real parsing of REPLAYGAIN_*
// freeform atoms is covered by code review and the device checklist,
// same as every other MP4-specific path this file doesn't fixture-test.

test('FLAC: REPLAYGAIN_* Vorbis comments parse into details.replayGain', () => {
  const buf = buildFlacFile({
    comments: ['REPLAYGAIN_TRACK_GAIN=-3.20 dB', 'REPLAYGAIN_TRACK_PEAK=0.987654', 'REPLAYGAIN_ALBUM_GAIN=-4.50 dB', 'REPLAYGAIN_ALBUM_PEAK=0.998765'],
  });
  const details = readDetails(buf);
  assert.equal(details.replayGain.trackGain, -3.2);
  assert.equal(details.replayGain.trackPeak, 0.987654);
  assert.equal(details.replayGain.albumGain, -4.5);
  assert.equal(details.replayGain.albumPeak, 0.998765);
});

test('FLAC: no ReplayGain comments at all leaves every field null', () => {
  const buf = buildFlacFile({comments: ['TITLE=No Gain Tags']});
  const details = readDetails(buf);
  assert.equal(details.replayGain.trackGain, null);
  assert.equal(details.replayGain.trackPeak, null);
  assert.equal(details.replayGain.albumGain, null);
  assert.equal(details.replayGain.albumPeak, null);
});

test('ID3v2: REPLAYGAIN_* TXXX frames parse into details.replayGain', () => {
  const buf = buildID3File([
    txxxFrame('REPLAYGAIN_TRACK_GAIN', '-6.00 dB'),
    txxxFrame('REPLAYGAIN_TRACK_PEAK', '0.5'),
    txxxFrame('replaygain_album_gain', '+1.25 dB'),
    txxxFrame('REPLAYGAIN_ALBUM_PEAK', '1.0'),
  ]);
  const details = readDetails(buf);
  assert.equal(details.replayGain.trackGain, -6.0);
  assert.equal(details.replayGain.trackPeak, 0.5);
  assert.equal(details.replayGain.albumGain, 1.25);
  assert.equal(details.replayGain.albumPeak, 1.0);
});

test('ID3v2: a garbage or negative peak value is rejected (peak can never be negative)', () => {
  const buf = buildID3File([
    txxxFrame('REPLAYGAIN_TRACK_GAIN', 'not a number'),
    txxxFrame('REPLAYGAIN_TRACK_PEAK', '-0.5'),
  ]);
  const details = readDetails(buf);
  assert.equal(details.replayGain.trackGain, null);
  assert.equal(details.replayGain.trackPeak, null);
});

// -- tests: artwork ----------------------------------------------------------

test('FLAC PICTURE block returns artwork; a file with none returns null', async () => {
  const data = new Uint8Array([1,2,3,4,5]);
  const withArt = buildFlacFile({comments: [], picture: {mime: 'image/jpeg', data}});
  const blob = findArtworkBlob(withArt);
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'image/jpeg');
  assert.equal(blob.size, data.length);

  const withoutArt = buildFlacFile({comments: []});
  assert.equal(findArtworkBlob(withoutArt), null);
});

test('ID3 APIC frame returns artwork; a file with none returns null', async () => {
  const data = new Uint8Array([9,8,7,6]);
  const withArt = buildID3File([id3Frame('TIT2', 0, 'Art Test'), apicFrame('image/png', data)]);
  const blob = findArtworkBlob(withArt);
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'image/png');
  assert.equal(blob.size, data.length);

  const withoutArt = buildID3File([id3Frame('TIT2', 0, 'No Art')]);
  assert.equal(findArtworkBlob(withoutArt), null);
});

test('ID3 APIC frame with a UTF-16 description (empty or not) still returns intact artwork', async () => {
  // regression: a UTF-16 description ends in a 2-byte null, not 1 — reading
  // only a single zero byte shifted every byte of the picture data by one
  const data = new Uint8Array([9,8,7,6,5,4,3,2,1]);
  const emptyDesc = buildID3File([apicFrame('image/png', data, {encoding: 1, description: ''})]);
  let blob = findArtworkBlob(emptyDesc);
  assert.ok(blob instanceof Blob);
  assert.equal(blob.size, data.length);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), data);

  const realDesc = buildID3File([apicFrame('image/jpeg', data, {encoding: 1, description: 'Cover'})]);
  blob = findArtworkBlob(realDesc);
  assert.ok(blob instanceof Blob);
  assert.equal(blob.size, data.length);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), data);
});

// -- tests: never throw on bad input ----------------------------------------

test('truncated or garbage bytes never throw, and return the empty/default result', () => {
  const garbage = new Uint8Array([1,2,3,4,5,6,7,8]).buffer;
  assert.doesNotThrow(() => readHeader(garbage));
  assert.doesNotThrow(() => readTags(garbage, 'whatever.bin'));
  assert.doesNotThrow(() => readDetails(garbage));
  assert.doesNotThrow(() => findArtworkBlob(garbage));

  const tags = readTags(garbage, 'whatever.bin');
  assert.equal(tags.title, 'whatever');
  assert.equal(tags.artist, 'Unknown Artist');
  assert.equal(tags.album, 'Unknown Album');
  assert.deepEqual(readDetails(garbage), readDetails(new ArrayBuffer(0)));
  assert.equal(findArtworkBlob(garbage), null);

  const empty = new ArrayBuffer(0);
  assert.doesNotThrow(() => readHeader(empty));
  assert.doesNotThrow(() => readTags(empty, 'x'));
  assert.doesNotThrow(() => readDetails(empty));
  assert.doesNotThrow(() => findArtworkBlob(empty));

  // a truncated FLAC file (claims fLaC magic, but no actual STREAMINFO body)
  const truncatedFlac = concatBytes([asciiBytes('fLaC'), new Uint8Array([0,0,0,34])]).buffer;
  assert.doesNotThrow(() => readHeader(truncatedFlac));
  assert.doesNotThrow(() => readTags(truncatedFlac, 'x.flac'));
  assert.doesNotThrow(() => readDetails(truncatedFlac));
  assert.doesNotThrow(() => findArtworkBlob(truncatedFlac));
});

// -- tests: duplicate detection ----------------------------------------------

test('findDuplicateTrack matches within the duration tolerance and not outside it', () => {
  S.tracks = [
    { id: 'existing', duration: 180, tags: {title:'Song', artist:'Artist', album:'Album'} },
  ];
  const sameTags = {title:'Song', artist:'Artist', album:'Album'};
  assert.ok(findDuplicateTrack(sameTags, 180 + DUP_DURATION_TOLERANCE_SEC));
  assert.ok(findDuplicateTrack(sameTags, 180 - DUP_DURATION_TOLERANCE_SEC));
  assert.equal(findDuplicateTrack(sameTags, 180 + DUP_DURATION_TOLERANCE_SEC + 0.5), undefined);
  assert.equal(findDuplicateTrack({title:'Different', artist:'Artist', album:'Album'}, 180), undefined);
});

// -- tests: RF7 point 3 — no seals on first import --------------------------

test('shouldSealOnImport: a first-run library (isFirstImport) seals nothing', () => {
  assert.equal(shouldSealOnImport('Some Album', 'aid', true, new Set()), false);
  // even an album already seen earlier in this same first batch
  assert.equal(shouldSealOnImport('Some Album', 'aid', true, new Set(['aid'])), false);
});

test('shouldSealOnImport: a later import seals a genuinely new album, once', () => {
  const existingAlbumIds = new Set(['old-album']);
  assert.equal(shouldSealOnImport('New Album', 'new-album', false, existingAlbumIds), true);
  // a second file from the same new album, same batch, isn't sealed twice —
  // the caller is expected to add the id after the first true (as addFiles() does)
  existingAlbumIds.add('new-album');
  assert.equal(shouldSealOnImport('New Album', 'new-album', false, existingAlbumIds), false);
  // an album already in the library before this batch is never (re-)sealed
  assert.equal(shouldSealOnImport('Old Album', 'old-album', false, existingAlbumIds), false);
});

test('shouldSealOnImport: loose tracks (Unknown Album) are never sealed', () => {
  assert.equal(shouldSealOnImport('Unknown Album', 'unknown-album', false, new Set()), false);
});
