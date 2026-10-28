/* ================= tag readers: liner notes / credits =================
   A separate, additive read, never touching the six identity fields
   (title/artist/album/albumArtist/track/disc) read by each format's own
   *Tags() function (see CREDITS spec §0). Shared by every format's
   *Details() function in this directory. */

export function emptyDetails(){
  return {
    v: 1,
    composers: [], lyricists: [], producers: [], conductors: [], arrangers: [],
    engineers: [], mixers: [], remixers: [], performers: [],
    genre: '', year: 0, label: '', catalog: '', isrc: '',
    comment: '', hasLyrics: false,
    // AU5 (docs/16_AUDIO.md §4): a tagged ReplayGain pair, read at import —
    // null until a format reader actually finds the matching tag (Vorbis
    // comment, ID3 TXXX, or an MP4 freeform atom; see flac.js/id3.js/mp4.js).
    // `loudness` (this app's own BS.1770 measurement, written by
    // library/import.js right after decode, never by a tag reader) is a
    // sibling field added the same way but intentionally left out of this
    // default object — see library/thumbs.js's healLoudness() for how an
    // already-imported track without it gets measured after the fact.
    replayGain: {trackGain: null, trackPeak: null, albumGain: null, albumPeak: null}
  };
}
// REPLAYGAIN_TRACK_GAIN/REPLAYGAIN_ALBUM_GAIN come as "-6.32 dB" (or "-6.32db",
// or no unit at all) — strip any trailing letters, keep the signed number.
export function parseReplayGainDb(str){
  if(str == null) return null;
  const m = /-?\d+(\.\d+)?/.exec(String(str));
  if(!m) return null;
  const n = parseFloat(m[0]);
  return isFinite(n) ? n : null;
}
// REPLAYGAIN_TRACK_PEAK/REPLAYGAIN_ALBUM_PEAK are a plain linear peak
// (0..~1, occasionally a hair over 1 for a peak found between samples).
export function parseReplayGainPeak(str){
  if(str == null) return null;
  const n = parseFloat(String(str));
  return isFinite(n) && n >= 0 ? n : null;
}
// null/`;`/` / ` only — never `,` or `&`, so "Earth, Wind & Fire" survives whole
export function splitNames(str){
  return (str || '').split(/\0|;| \/ /).map(s => s.trim()).filter(Boolean);
}
export function parsePerformerEntry(raw){
  const m = /^(.*)\(([^)]+)\)\s*$/.exec((raw || '').trim());
  if(m) return {name: m[1].trim(), role: m[2].trim()};
  return {name: (raw || '').trim(), role: ''};
}
export function parseYear(v){
  const m = /(\d{4})/.exec(String(v || ''));
  return m ? parseInt(m[1], 10) : 0;
}
export function creditRoleBucket(role){
  const r = (role || '').toLowerCase();
  if(/remix/.test(r)) return 'remixers';
  if(/produc/.test(r)) return 'producers';
  if(/engineer/.test(r)) return 'engineers';
  if(/mix/.test(r)) return 'mixers';
  if(/conduct/.test(r)) return 'conductors';
  if(/arrang/.test(r)) return 'arrangers';
  if(/compos/.test(r)) return 'composers';
  if(/lyric/.test(r)) return 'lyricists';
  return null;
}
