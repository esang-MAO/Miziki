// NV1: generates a synthetic library of tracks grouped into albums, used
// only by the perf harness (tests/perf/nav.perf.js) — never shipped, never
// imported by the app itself. No real audio: each record matches the shape
// `src/library/import.js`'s storeTrack() writes into the `tracks` IndexedDB
// store (src/storage/idb.js), so the app's own restoreLibrary() boot path
// (src/main.js) loads these exactly as it would a real imported file —
// `blob:null` is enough, since restoreLibrary() never reads it back into
// `t.blob` at boot (decoding only happens once a track is actually played,
// via ensureBuffer()).
//
// RF5 (docs/12_REFINE.md, point 4) added buildSyntheticLocalState() below —
// a steady-state localState snapshot (src/sync/backup-doc.js's own toDoc()
// input shape) built from this same synthetic library, for estimating the
// backup doc's own byte size at 2,000 tracks / 180 albums.

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

// RF5, point 4: a representative steady-state localState — every track has
// been played at least once (the realistic long-run case: a library this
// old has a trackDisplay/trackPlayCounts entry for nearly everything in it,
// not just a handful of tracks), so the resulting doc size is a meaningful
// upper-bound-ish estimate against library_backup.doc's 2MB column cap
// (CLAUDE.md's "Backup: what gets synced"), not an optimistic near-empty
// one. Built from the exact same `tracks` buildSyntheticLibrary() returns,
// using the app's own trackIdentityKey()/albumKey() so the doc this
// produces is shaped exactly like toDoc()'s real output, not an
// approximation of it.
export function buildSyntheticLocalState(tracks, { trackIdentityKey, albumKey }){
  const trackPlayCounts = {}, trackLastPlayed = {}, trackDisplay = {}, trackMetalEligiblePlays = {};
  const sessionCounts = {}, albumLastPlayed = {}, albumDisplay = {}, metalEligibleSessions = {};
  const overlaysRaw = [];
  const now = Date.now();

  tracks.forEach((t, i) => {
    const tk = trackIdentityKey(t);
    const plays = 1 + (i % 40);
    trackPlayCounts[tk] = plays;
    trackMetalEligiblePlays[tk] = plays;
    trackLastPlayed[tk] = now - (i % 5000) * 60000;
    trackDisplay[tk] = { title: t.tags.title, artist: t.tags.artist, art: null };
    // every 40th track has a small text edit on file — a representative
    // sample of overlays, not every track (most tracks are never edited)
    if(i % 40 === 0){
      overlaysRaw.push({ id: t.id, fields: { title: t.tags.title + ' (edit)' }, editedAt: now - i * 1000 });
    }
  });
  tracks.forEach((t) => {
    const ak = albumKey(t);
    if(sessionCounts[ak] !== undefined) return;
    const sessions = 1 + (sessionCounts._seed = (sessionCounts._seed || 0) + 1) % 30;
    sessionCounts[ak] = sessions;
    metalEligibleSessions[ak] = sessions;
    albumLastPlayed[ak] = now - sessions * 86400000;
    albumDisplay[ak] = { name: t.tags.album, artist: t.tags.artist, art: null };
  });
  delete sessionCounts._seed;

  const favoriteIds = tracks.filter((_, i) => i % 25 === 0).map(t => t.id);

  return {
    deviceId: 'perf-device-1', historyClearedAt: 0,
    tracks: tracks.map(t => ({ id: t.id, tags: t.tags })),
    playlists: [{ name: 'Favorites', system: 'favorites', items: favoriteIds }],
    albumOrder: {}, albumSort: {}, albumEdge: {}, albumLookPref: {},
    albumDisplay, trackDisplay,
    prefs: { mode: 'vinyl', theme: 'auto', char: { wow: 0.4, sat: 0.3, soft: 0.2, comp: 0.5 } },
    profileName: 'Perf Test',
    trackPlayCounts, sessionCounts, metalEligibleSessions, trackMetalEligiblePlays,
    phasePlayCounts: { morning: 120, afternoon: 340, 'golden hour': 80, night: 600 },
    albumPhaseCounts: {},
    trackLastPlayed, albumLastPlayed,
    rareUnlocked: {}, achievements: {}, collection: {},
    sealedIds: [], brokenSealIds: [],
    overlaysRaw,
    picture: null,
    updatedAt: {},
  };
}
