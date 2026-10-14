// NV1: generates a synthetic library of tracks grouped into albums, used
// only by the perf harness (tests/perf/nav.perf.js) — never shipped, never
// imported by the app itself. No real audio: each record matches the shape
// `src/library/import.js`'s storeTrack() writes into the `tracks` IndexedDB
// store (src/storage/idb.js), so the app's own restoreLibrary() boot path
// (src/main.js) loads these exactly as it would a real imported file —
// `blob:null` is enough, since restoreLibrary() never reads it back into
// `t.blob` at boot (decoding only happens once a track is actually played,
// via ensureBuffer()).

const ARTISTS = ['Harbor Static', 'Low Tide Radio', 'Civic Daylight', 'Paper Weather', 'Slow Signal',
  'North Platform', 'Amber Transit', 'Quiet Freight', 'Glass Commute', 'Marrow Line'];
const GENRES = ['Indie Rock', 'Ambient', 'Electronic', 'Folk', 'Shoegaze', 'Jazz'];

// Builds `albumCount` albums (default 180) spread across the artist list,
// each with a random track count that keeps the total near `trackCount`
// (default 2000) without needing every album to carry the exact same size.
export function buildSyntheticLibrary(trackCount = 2000, albumCount = 180){
  const tracks = [];
  const baseTracksPerAlbum = Math.max(1, Math.floor(trackCount / albumCount));
  let id = 0;
  let remaining = trackCount;
  for(let a = 0; a < albumCount; a++){
    const albumsLeft = albumCount - a;
    const albumTrackCount = a === albumCount - 1
      ? remaining
      : Math.max(1, Math.min(remaining - (albumsLeft - 1), baseTracksPerAlbum + (a % 3)));
    remaining -= albumTrackCount;
    const artist = ARTISTS[a % ARTISTS.length];
    const album = 'Album ' + String(a + 1).padStart(3, '0');
    const genre = GENRES[a % GENRES.length];
    const year = 1990 + (a % 35);
    for(let n = 1; n <= albumTrackCount; n++){
      id++;
      tracks.push({
        id: 'perf-track-' + id,
        addedAt: Date.now() - (trackCount - id) * 1000,
        blob: null,
        art: null,
        tags: {
          title: album + ' — Track ' + n,
          artist, album, genre, year,
          track: n, disc: 1,
        },
        // a full emptyDetails()-shaped object rather than null: a null
        // `details` on a `stored` track makes healDetails() (library/thumbs.js)
        // try to re-read it from the track's own blob in the background —
        // harmless with blob:null (it falls back to emptyDetails() itself),
        // but it'd add ~2,000 tracks of background churn competing with
        // this harness's own measurements, representing an import in
        // progress rather than the steady-state "already-settled library"
        // this baseline means to measure.
        details: {
          v: 1,
          composers: [], lyricists: [], producers: [], conductors: [], arrangers: [],
          engineers: [], mixers: [], remixers: [], performers: [],
          genre, year, label: '', catalog: '', isrc: '',
          comment: '', hasLyrics: false,
        },
        meta: { codec: 'FLAC', rate: 44100, bits: 16, lossless: true, ch: 2 },
        duration: 150 + (n % 12) * 15,
        gaplessDelaySec: 0,
        gaplessPaddingSec: 0,
        sizeBytes: 4 * 1024 * 1024,
      });
    }
  }
  return tracks;
}
