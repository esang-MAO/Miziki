/* ================= tag readers: liner notes / credits =================
   Moved out of main.js's "file loading" section (step 5b), unchanged —
   a separate, additive read, never touching the six identity fields
   (title/artist/album/albumArtist/track/disc) read by each format's own
   *Tags() function (see CREDITS spec §0). Shared by every format's
   *Details() function in this directory. */

export function emptyDetails(){
  return {
    v: 1,
    composers: [], lyricists: [], producers: [], conductors: [], arrangers: [],
    engineers: [], mixers: [], remixers: [], performers: [],
    genre: '', year: 0, label: '', catalog: '', isrc: '',
    comment: '', hasLyrics: false
  };
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
