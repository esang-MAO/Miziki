import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readHeader, readTags, readDetails, findArtworkBlob } from '../../src/library/tags/index.js';

// import.js has temporary circular imports back to main.js (rule 8 in
// CLAUDE.md), plus real imports (queue.js, buffers.js) that themselves
// pull in transport.js/clock.js/sleep-timer.js/engine.js, and those in
// turn need more of main.js's DOM-dependent top level. findDuplicateTrack
// and DUP_DURATION_TOLERANCE_SEC don't touch any of that — they only read
// S.tracks — but loading import.js at all means stopping the chain at
// the door, the same approach as engine.test.js/queue.test.js.
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: {
    rebuildPeopleIndex(){}, invalidateCrateModel(){}, renderTracks(){}, renderMiniPlayer(){},
    queueSave(){}, persistSealedAlbums(){}, healCrateArt: async () => {},
    // queue.js's own main.js imports (step 5a) -- pulled in transitively
    // since import.js imports setQueue from queue.js
    runStartSequence: async () => {}, openPlayerViaSheet(){},
    shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence: async () => {},
    // queue.js's invalidateActiveSessionIfAny import is now a real one
    // from src/history/sessions.js (step 5c), which itself needs these
    // from main.js
    applyDiscVariant(){}, restoreThumbs: async () => {},
    // import.js's loadOverlayFor/deleteTracks imports are now real ones
    // from src/library/edit.js/delete.js (step 5d), which themselves need
    // these from main.js
    deleteCrateArtTiers: async () => {}, buildCrateTier: async () => {}, exitSelectMode(){},
    clearSpinDown(){}, closePlayer(){},
  },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load(){}, play(){}, pause(){}, seek(){}, stop(){} },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { sleepStopPlayback(){}, stopSleepState(){} },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext: async () => {} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});

const { findDuplicateTrack, DUP_DURATION_TOLERANCE_SEC } = await import('../../src/library/import.js');
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
function apicFrame(mime, data){
  const payload = concatBytes([
    new Uint8Array([0]),          // text encoding
    asciiBytes(mime), new Uint8Array([0]),  // mime + null
    new Uint8Array([3]),          // picture type (3 = front cover)
    new Uint8Array([0]),          // description + null (empty)
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
