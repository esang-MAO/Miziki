/* ================= backup doc: format + local <-> doc conversion =========
   B2 (account backup, step 03): pure functions only — no network, no DOM,
   no S import. A later PR (B1/B3) builds `localState` from the real S
   object and IndexedDB, uploads toDoc()'s output as this device's one row
   (`library_backup`, keyed by user + device), fetches every row for the
   user, and calls fromDocs() to get the merged result to apply back to S.
   Nothing here is wired into the app yet.

   `localState` shape toDoc() expects (a snapshot, not S itself — the
   caller builds this from S/IndexedDB, letting this module stay DOM- and
   IndexedDB-free for its own tests):
     deviceId, historyClearedAt,
     tracks: [{id, tags:{title, artist, album, albumArtist}}, ...],
     playlists: [{name, items:[localId...], system}, ...],
     albumOrder: {[albumTitle]: [localId...]}, albumSort: {[albumTitle]: mode},
     albumDisplay, trackDisplay, albumEdge, albumLookPref,  (already keyed
       by albumKey/trackIdentityKey in real S — see each module's own file)
     prefs, profileName,
     trackPlayCounts, sessionCounts, metalEligibleSessions, trackMetalEligiblePlays,
     phasePlayCounts, albumPhaseCounts,  (DA5, docs/DAY_ARC.md — per-device
       counters, same rule as trackPlayCounts/sessionCounts; already keyed
       by a portable string, no idToKey conversion needed)
     trackLastPlayed, albumLastPlayed, rareUnlocked, achievements, collection,
     sealedIds, brokenSealIds,       (S.sealed as an array, plus a *new*
       local list this device has ever broken — S doesn't track that today;
       see CLAUDE.md's step-03 note)
     overlaysRaw: [{id, fields, editedAt, reverted, revertedAt, cover}, ...],
       (today's overlays store has no timestamps at all; the wiring PR
       needs to start recording editedAt/revertedAt alongside each write.
       cover, step 07/B4, is either {hash, updatedAt} — a custom cover is
       set and already re-encoded/hashed — or absent/null if this track
       has never had one or its cover was reverted along with the rest
       of the overlay)
     picture: {hash, updatedAt} | null,  (step 07/B4 — the profile picture,
       re-encoded/hashed the same way as a cover; doubles as the public
       account avatar once signed in)
     updatedAt: {playlists, albumOrder, albumSort, albumDisplay, trackDisplay,
       albumEdge, albumLookPref, prefs, profileName, picture}  (one
       last-write timestamp per field — also new local state the wiring
       PR must add)

   Tracks, embedded/custom art, and the social meta key are excluded here
   by construction: toDoc() never reads localState.tracks for anything but
   building the id -> identityKey lookup, and every *Display record this
   module touches has its own `art` (a runtime object URL) stripped before
   it's written into the doc. */
import { trackIdentityKey, albumKey } from '../record-art/tiers.js';
import { mergeRows } from './merge.js';

// v2 (step 07, B4) added `covers` (per-track custom-cover hash, last write
// wins by its own timestamp — separate from the overlay's text-field
// editedAt, since a cover change and a tag change are independent edits)
// and `lastWrite.picture` (the profile picture / public avatar hash, the
// same last-write-wins shape as profileName). A v1 doc simply has neither
// — every reader below already treats a missing field as "no claim" by
// construction (`row.covers || []`, `row.lastWrite && row.lastWrite[field]`),
// so an old doc still loads; see tests/unit/backup-merge.test.js.
export const SCHEMA_VERSION = 2;

function stripArt(rec){
  if(!rec) return rec;
  const r = Object.assign({}, rec);
  delete r.art;
  return r;
}
function stripArtMap(map){
  const out = {};
  Object.keys(map || {}).forEach(k => { out[k] = stripArt(map[k]); });
  return out;
}

// local file id ("name|size|lastModified") -> this track's portable
// trackIdentityKey, for whichever tracks are actually present right now
function buildIdentityLookup(tracks){
  const out = {};
  (tracks || []).forEach(t => { out[t.id] = trackIdentityKey(t); });
  return out;
}

// Converts a list of local track ids to portable identity keys wherever the
// track is currently present. An id that doesn't resolve (the track has
// been forgotten but F3 keeps the entry anyway) has no tags left to derive
// an identity key from — kept as the bare local id rather than dropped, so
// a reinstall on the *same* device (which can still produce the same
// name|size|lastModified id on re-import) still reconnects; it simply
// isn't portable to a *different* device until this device re-imports the
// file and uploads a fresh doc with the now-resolvable identity key.
function idsToKeys(ids, idToKey){
  return (ids || []).map(id => idToKey[id] || id);
}

function convertPlaylists(playlists, idToKey){
  return (playlists || []).map(p => ({
    name: p.name, system: p.system, items: idsToKeys(p.items, idToKey),
  }));
}
function convertAlbumOrder(albumOrder, idToKey){
  const out = {};
  Object.keys(albumOrder || {}).forEach(album => { out[album] = idsToKeys(albumOrder[album], idToKey); });
  return out;
}

// Only overlays whose track is currently present convert at all — unlike a
// playlist entry, an overlay with no resolvable identity key can never be
// reapplied to anything, so there is nothing useful to keep.
function convertOverlays(overlaysRaw, idToKey){
  const out = [];
  (overlaysRaw || []).forEach(o => {
    const key = idToKey[o.id];
    if(!key) return;
    if(o.reverted) out.push({ identityKey: key, at: o.revertedAt || 0, tombstone: true });
    else out.push({ identityKey: key, at: o.editedAt || 0, tombstone: false, fields: o.fields });
  });
  return out;
}

// RF16 (docs/12_REFINE.md, "edits that know what they've seen"): updatedAt[field]
// is state.js's touchBackupField() stamp, {seq, at} since RF16 (a bare 0 only
// ever for a field that's never been touched on this device at all). deviceId
// is attached here, from the one doc-level value every field in a single
// toDoc() call shares, rather than stored redundantly inside the stamp itself
// at touch time (S.deviceId can be null before the first sign-in/sync, long
// after a field may already have been touched).
function lw(updatedAt, field, value, deviceId){
  const stamp = (updatedAt && updatedAt[field]) || 0;
  const seq = (stamp && stamp.seq) || 0;
  const at = (stamp && stamp.at) || 0;
  return { seq, at, deviceId: deviceId || null, value };
}

// step 07, B4: the per-track cover-image claim, kept apart from
// convertOverlays()'s text-field entries on purpose — a cover change and
// a tag change are independent edits with their own timestamps (B2's own
// "per field" rule, applied here one level deeper than the top-level doc
// fields it was written for). A whole-overlay revert tombstones the cover
// too (hash: null, at: the same revertedAt), matching the spec's own "a
// revert to the file's own art is a tombstone" — but a plain tag-only
// edit that never touched the cover emits no cover entry at all, since
// there is no claim to make either way.
function convertCovers(overlaysRaw, idToKey){
  const out = [];
  (overlaysRaw || []).forEach(o => {
    const key = idToKey[o.id];
    if(!key) return;
    if(o.reverted) out.push({ identityKey: key, at: o.revertedAt || 0, hash: null });
    else if(o.cover) out.push({ identityKey: key, at: o.cover.updatedAt || 0, hash: o.cover.hash });
  });
  return out;
}

export function toDoc(localState){
  const s = localState || {};
  const idToKey = buildIdentityLookup(s.tracks);
  const updatedAt = s.updatedAt || {};

  return {
    schemaVersion: SCHEMA_VERSION,
    deviceId: s.deviceId,
    historyClearedAt: s.historyClearedAt || 0,

    counters: {
      trackPlayCounts: s.trackPlayCounts || {},
      sessionCounts: s.sessionCounts || {},
      metalEligibleSessions: s.metalEligibleSessions || {},
      trackMetalEligiblePlays: s.trackMetalEligiblePlays || {},
      // DA5 (docs/DAY_ARC.md): both already keyed by a portable string —
      // phasePlayCounts by the phase name itself, albumPhaseCounts by
      // albumKey() (normKey(album title), same as sessionCounts/
      // albumLastPlayed above) — so neither needs idToKey conversion,
      // unlike trackPlayCounts's trackIdentityKey (computed by the
      // caller before it ever lands in S, not here either, for the
      // same reason).
      phasePlayCounts: s.phasePlayCounts || {},
      albumPhaseCounts: s.albumPhaseCounts || {},
    },
    maxFields: {
      trackLastPlayed: s.trackLastPlayed || {},
      albumLastPlayed: s.albumLastPlayed || {},
    },
    rareUnlocked: s.rareUnlocked || {},
    achievements: stripArtMap(s.achievements),
    collection: stripArtMap(s.collection),

    sealed: { sealed: s.sealedIds || [], broken: s.brokenSealIds || [] },

    lastWrite: {
      playlists: lw(updatedAt, 'playlists', convertPlaylists(s.playlists, idToKey), s.deviceId),
      albumOrder: lw(updatedAt, 'albumOrder', convertAlbumOrder(s.albumOrder, idToKey), s.deviceId),
      albumSort: lw(updatedAt, 'albumSort', s.albumSort || {}, s.deviceId),
      albumDisplay: lw(updatedAt, 'albumDisplay', stripArtMap(s.albumDisplay), s.deviceId),
      trackDisplay: lw(updatedAt, 'trackDisplay', stripArtMap(s.trackDisplay), s.deviceId),
      albumEdge: lw(updatedAt, 'albumEdge', s.albumEdge || {}, s.deviceId),
      albumLookPref: lw(updatedAt, 'albumLookPref', s.albumLookPref || {}, s.deviceId),
      prefs: lw(updatedAt, 'prefs', s.prefs || {}, s.deviceId),
      profileName: lw(updatedAt, 'profileName', s.profileName || '', s.deviceId),
      // step 07, B4
      picture: lw(updatedAt, 'picture', s.picture || null, s.deviceId),
    },

    overlays: convertOverlays(s.overlaysRaw, idToKey),
    covers: convertCovers(s.overlaysRaw, idToKey),
  };
}

// Merges this device's own current data with every other device's last-
// uploaded row and returns the merged result ready to apply back to S (a
// later PR's job). `ownLocal` is the same shape toDoc() takes — fromDocs()
// builds this device's own fresh doc from it internally, rather than
// trusting a possibly-stale copy of this same device that might be sitting
// in remoteRows, which is why any row in remoteRows sharing this device's
// id is dropped before merging (point 3's "never ends up containing other
// devices' counts" cuts both ways: it also must never count this device's
// own contribution twice).
//
// The merged totals/lastWrite/sealed/overlays stay in identity-key space
// throughout (see the module header) — resolving them back to local ids is
// deferred to apply time via resolveIdentityKey(), not done here.
//
// merged.totals.* are the cross-device grand totals, for display only
// (Top Songs, metal thresholds, Collection progress) — the caller must
// never write them back into this device's own local per-device counters
// (S.trackPlayCounts and friends). Those stay exactly ownLocal's own
// numbers, untouched by this call (point 3's invariant), so the next
// upload keeps contributing only this device's own plays.
//
// `ownReset` is true when some other device cleared listening history more
// recently than this device knows about (point 4): the caller must zero
// this device's own local history counters and adopt merged.historyClearedAt
// as its own, so the *next* doc this device uploads doesn't resurrect
// pre-clear numbers that mergeRows() is, from this call on, already
// ignoring everywhere else.
export function fromDocs(ownLocal, remoteRows){
  const ownDoc = toDoc(ownLocal);
  // One row per device (B1: each device keeps its own row), so a real
  // server fetch never returns the same deviceId twice — but deduping here
  // anyway (keep the last one seen) means a server-side duplicate can never
  // silently double-count that device's contribution.
  const byDevice = new Map();
  (remoteRows || []).forEach(r => { if(r && r.deviceId && r.deviceId !== ownDoc.deviceId) byDevice.set(r.deviceId, r); });
  const merged = mergeRows([ownDoc, ...byDevice.values()]);
  return Object.assign({ schemaVersion: SCHEMA_VERSION, ownReset: (ownDoc.historyClearedAt || 0) < merged.historyClearedAt }, merged);
}

// Finds the local track (if any) matching a backup entry's identity key —
// the "attaches when a matching file is imported" half of F3's own kept-
// not-dropped rule, applied to backup data. Not used in fromDocs() itself:
// resolution has to happen at *apply* time against whatever's in the
// library right now, not at merge time, since a merge computed once would
// go stale the moment the next file is imported.
export function resolveIdentityKey(identityKey, tracks){
  return (tracks || []).find(t => trackIdentityKey(t) === identityKey) || null;
}

export { albumKey };
