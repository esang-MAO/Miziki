/* ================= backup doc: format + local <-> doc conversion =========
   Pure functions only — no network, no DOM, no S import. sync/backup.js
   builds `localState` from the real S object and IndexedDB, uploads
   toDoc()'s output as this device's one row (`library_backup`, keyed by
   user + device), fetches every row for the user, and calls fromDocs() to
   get the merged result to apply back to S.

   SCHEMA_VERSION 3 (RF17, docs/12_REFINE.md, "merge per item, not per
   blob"): every field that's one last-write-wins stamp over a whole map
   (albumOrder, albumSort,
   albumDisplay, trackDisplay, albumEdge, albumLookPref, prefs) is now one
   stamp per key, so a change to one album or one pref key never competes
   on merge with an unrelated, but later, change to a different key of the
   same field. Playlists went further still — membership is now an
   add-wins set with a tombstone per (playlist, identityKey), so hearting
   different tracks on two offline devices keeps both, while the playlist's
   own order and its def (name/system) stay one LWW value per playlist
   name. profileName/picture are simple enough to keep as a single
   whole-value stamp (see src/sync/merge.js's mergeKeyedLastWriteWins/
   mergePlaylistMembership/lastWriteWins for the merge rules themselves).

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
     zoetropeUnlocked, zoetropeDayProgress,  (PRESSINGS_110 PR7,
       docs/PRESSINGS_110.md §8 — zoetropeUnlocked is the same union-of-
       flags shape as rareUnlocked right above; zoetropeDayProgress is
       {albumId: [dayKey, ...]}, already keyed by a portable albumKey()
       string and plain local-calendar-day strings, no idToKey conversion
       needed, merged by sync/merge.js's unionDaySets())
     sealedIds, brokenSealIds,       (S.sealed as an array, plus a *new*
       local list this device has ever broken — S doesn't track that today;
       see CLAUDE.md's step-03 note)
     overlaysRaw: [{id, fields, editedAt, reverted, revertedAt, cover}, ...],
     picture: {hash, updatedAt} | null,  (step 07/B4 — the profile picture)
     updatedAt: {albumOrder, albumSort, albumDisplay, trackDisplay,
       albumEdge, albumLookPref, prefs, playlistDefs, playlistOrder: {key:
       {seq, at}}; profileName, picture: {seq, at}}  (RF17 — per-key maps
       for the first group, a single stamp for the last two; state.js's
       S.backupUpdatedAt is exactly this shape)
     playlistMembershipAt: {'playlistName\u0000localId': {added: {seq,at}|
       null, removed: {seq,at}|null}}  (RF17 — state.js's
       S.playlistMembershipAt, local-id-keyed; converted to identityKey
       here, same as every other local-id list in this module)

   Tracks, embedded/custom art, and the social meta key are excluded here
   by construction: toDoc() never reads localState.tracks for anything but
   building the id -> identityKey lookup, and every *Display record this
   module touches has its own `art` (a runtime object URL) stripped before
   it's written into the doc. */
import { trackIdentityKey, albumKey } from '../record-art/tiers.js';
import { mergeRows } from './merge.js';

// v3 (RF17, docs/12_REFINE.md) replaced every whole-blob `lastWrite.<field>`
// entry (except profileName/picture) with per-key `itemWrites.<field>`
// arrays, and `lastWrite.playlists` with `playlistDefs`/`playlistOrder`
// (also per-key) plus `playlistMembership` (add-wins per track). A v1/v2
// remote row has none of this — upconvertToV3() (below) explodes its old
// whole-blob stamps into the same per-key shape, each key inheriting the
// one stamp the whole field had, so fromDocs() can merge every row — of
// any version this build still understands — through the one, current
// merge path. A row whose schemaVersion is *higher* than this build
// understands is never upconverted or guessed at — see fromDocs()'s own
// comment for why it's skipped outright instead.
export const SCHEMA_VERSION = 3;

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

// RF17: builds one field's itemWrites array — one entry per key that
// either has a current value, a recorded stamp, or both. A key with a
// stamp but no current value (an explicit local removal — e.g. an album
// that lost its last track, src/library/delete.js) becomes a tombstone
// (value: null); a key with a value but no recorded stamp at all (data
// that predates RF17, or a field this build never calls touchBackupKey()
// for) falls back to {seq:0, at:0} — the same "an untouched/legacy value
// always loses to any real edit" convention RF16 already established for
// a stamp with no seq.
function itemWriteEntries(valueMap, stampMap, deviceId){
  const keys = new Set([
    ...Object.keys(valueMap || {}),
    ...Object.keys(stampMap || {}),
  ]);
  const out = [];
  keys.forEach(k => {
    const stamp = (stampMap && stampMap[k]) || {};
    const hasValue = !!valueMap && Object.prototype.hasOwnProperty.call(valueMap, k);
    out.push({
      key: k,
      seq: stamp.seq || 0,
      at: stamp.at || 0,
      deviceId: deviceId || null,
      value: hasValue ? valueMap[k] : null,
    });
  });
  return out;
}

// RF17: the playlist def (name/system) and order (ids -> identity keys)
// are each their own per-playlist-name itemWrites field — a rename or a
// reorder on one playlist never competes with another playlist's own
// last change the way one shared whole-blob stamp used to.
function buildPlaylistDefsAndOrder(playlists, idToKey, stamps){
  const defs = {}, order = {};
  (playlists || []).forEach(p => {
    defs[p.name] = { system: p.system || null };
    order[p.name] = idsToKeys(p.items, idToKey);
  });
  return {
    playlistDefs: itemWriteEntries(defs, stamps.playlistDefs, stamps.deviceId),
    playlistOrder: itemWriteEntries(order, stamps.playlistOrder, stamps.deviceId),
  };
}

// RF17: converts local playlist membership into the portable {playlist,
// identityKey, added, removed} shape mergePlaylistMembership() reads. Two
// sources, combined:
//   1. every item currently present in a playlist asserts its own 'added'
//      claim — the real stamp this device recorded for it in
//      S.playlistMembershipAt, if touchBackupMembership() was ever called
//      for that pair, or an implicit, lowest-priority {seq:0, at:0} one
//      otherwise. The fallback matters: it's what keeps every playlist
//      membership that predates this PR (or any future touch site this
//      build doesn't cover yet) from silently vanishing on the first
//      sync after upgrade — present-but-unstamped still outranks
//      "no claim at all," and a real stamp from any device still wins a
//      genuine edit race against it, the same convention
//      itemWriteEntries() uses for every other field.
//   2. a pair this device explicitly removed (recorded in
//      S.playlistMembershipAt, no longer present in playlists) still
//      needs to broadcast that removal, so another device's own
//      still-present copy of the same pair loses the merge — the
//      tombstone every other field here already has.
// An entry whose local id doesn't resolve to a track present right now is
// dropped — there's nothing a remote device could ever match it against,
// and this device still has its own in-memory S.playlists membership
// regardless of what gets uploaded.
function convertPlaylistMembership(playlists, membershipAt, idToKey){
  const out = [];
  const seenMapKeys = new Set();
  (playlists || []).forEach(p => {
    (p.items || []).forEach(localId => {
      const key = idToKey[localId];
      if(!key) return;
      const mapKey = p.name + '\u0000' + localId;
      seenMapKeys.add(mapKey);
      const entry = (membershipAt && membershipAt[mapKey]) || {};
      out.push({ playlist: p.name, identityKey: key, added: entry.added || { seq: 0, at: 0 }, removed: entry.removed || null });
    });
  });
  Object.keys(membershipAt || {}).forEach(mapKey => {
    if(seenMapKeys.has(mapKey)) return;
    const sep = mapKey.indexOf('\u0000');
    if(sep < 0) return;
    const playlist = mapKey.slice(0, sep), localId = mapKey.slice(sep + 1);
    const key = idToKey[localId];
    if(!key) return;
    const entry = membershipAt[mapKey];
    out.push({ playlist, identityKey: key, added: entry.added || null, removed: entry.removed || null });
  });
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

  const playlistParts = buildPlaylistDefsAndOrder(s.playlists, idToKey, {
    playlistDefs: updatedAt.playlistDefs, playlistOrder: updatedAt.playlistOrder, deviceId: s.deviceId,
  });

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
    // PRESSINGS_110 PR7 (docs/PRESSINGS_110.md §8): "store earned zoetropes
    // and day-progress with the account backup" — same shape/posture as
    // rareUnlocked right above, a second, entirely independent pool.
    zoetropeUnlocked: s.zoetropeUnlocked || {},
    zoetropeDayProgress: s.zoetropeDayProgress || {},
    achievements: stripArtMap(s.achievements),
    collection: stripArtMap(s.collection),

    sealed: { sealed: s.sealedIds || [], broken: s.brokenSealIds || [] },

    // RF17: one itemWrites array per key-merged field (see
    // itemWriteEntries()'s own comment above for the tombstone/fallback
    // rules), plus playlistMembership's own add-wins shape.
    itemWrites: {
      albumOrder: itemWriteEntries(
        Object.fromEntries(Object.entries(s.albumOrder || {}).map(([album, ids]) => [album, idsToKeys(ids, idToKey)])),
        updatedAt.albumOrder, s.deviceId),
      albumSort: itemWriteEntries(s.albumSort, updatedAt.albumSort, s.deviceId),
      albumDisplay: itemWriteEntries(stripArtMap(s.albumDisplay), updatedAt.albumDisplay, s.deviceId),
      trackDisplay: itemWriteEntries(stripArtMap(s.trackDisplay), updatedAt.trackDisplay, s.deviceId),
      albumEdge: itemWriteEntries(s.albumEdge, updatedAt.albumEdge, s.deviceId),
      albumLookPref: itemWriteEntries(s.albumLookPref, updatedAt.albumLookPref, s.deviceId),
      // AU9 (docs/16_AUDIO.md §5): the personal per-album format override
      // (Auto/33⅓/45) — keyed by albumKey() the same way albumLookPref is,
      // same per-key last-write-wins shape. "The override is personal: it
      // syncs in your backup" — friends seeing the automatic format is
      // AU11's own territory, not this field.
      albumFormat: itemWriteEntries(s.albumFormat, updatedAt.albumFormat, s.deviceId),
      prefs: itemWriteEntries(s.prefs, updatedAt.prefs, s.deviceId),
      playlistDefs: playlistParts.playlistDefs,
      playlistOrder: playlistParts.playlistOrder,
    },
    playlistMembership: convertPlaylistMembership(s.playlists, s.playlistMembershipAt, idToKey),

    lastWrite: {
      profileName: lw(updatedAt, 'profileName', s.profileName || '', s.deviceId),
      // step 07, B4
      picture: lw(updatedAt, 'picture', s.picture || null, s.deviceId),
    },

    overlays: convertOverlays(s.overlaysRaw, idToKey),
    covers: convertCovers(s.overlaysRaw, idToKey),
  };
}

// RF17: a v1/v2 row's old whole-blob lastWrite entries, exploded into this
// build's current per-key shape — every key in the old value inherits the
// exact same {seq, at, deviceId} the whole field had, since an old doc
// never recorded anything finer. playlists' old {name, system, items}
// array becomes one playlistDefs/playlistOrder entry per playlist (same
// shared stamp) plus one playlistMembership entry per item (added: that
// same stamp, removed: null) — the "whole array, one point in time"
// equivalent of the add-wins set this build expects. A doc already at
// schemaVersion 3 is returned unchanged.
function upconvertToV3(doc){
  if(!doc || (doc.schemaVersion || 0) >= 3) return doc;
  const old = (doc.lastWrite) || {};
  const stampOf = field => {
    const e = old[field];
    return e ? { seq: e.seq || 0, at: e.at || 0, deviceId: e.deviceId || doc.deviceId || null } : null;
  };
  const explode = (field) => {
    const stamp = stampOf(field);
    const value = old[field] && old[field].value;
    if(!stamp) return [];
    return Object.keys(value || {}).map(k => ({ key: k, seq: stamp.seq, at: stamp.at, deviceId: stamp.deviceId, value: value[k] }));
  };

  const playlistsEntry = old.playlists;
  const playlistDefs = [], playlistOrder = [], playlistMembership = [];
  if(playlistsEntry){
    const stamp = stampOf('playlists');
    (playlistsEntry.value || []).forEach(p => {
      playlistDefs.push({ key: p.name, seq: stamp.seq, at: stamp.at, deviceId: stamp.deviceId, value: { system: p.system || null } });
      playlistOrder.push({ key: p.name, seq: stamp.seq, at: stamp.at, deviceId: stamp.deviceId, value: (p.items || []).slice() });
      (p.items || []).forEach(identityKey => {
        playlistMembership.push({ playlist: p.name, identityKey, added: { seq: stamp.seq, at: stamp.at, deviceId: stamp.deviceId }, removed: null });
      });
    });
  }

  return Object.assign({}, doc, {
    itemWrites: {
      albumOrder: explode('albumOrder'),
      albumSort: explode('albumSort'),
      albumDisplay: explode('albumDisplay'),
      trackDisplay: explode('trackDisplay'),
      albumEdge: explode('albumEdge'),
      albumLookPref: explode('albumLookPref'),
      prefs: explode('prefs'),
      playlistDefs,
      playlistOrder,
    },
    playlistMembership,
  });
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
// The merged totals/itemWrites/playlistMembership/sealed/overlays stay in
// identity-key space throughout (see the module header) — resolving them
// back to local ids is deferred to apply time via resolveIdentityKey(),
// not done here.
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
//
// `newerVersionSeen` (RF17) is true when at least one remote row's own
// schemaVersion is higher than SCHEMA_VERSION — this build has no idea
// what that row's newer fields mean, so rather than guess (or, worse,
// silently misread a shape it doesn't recognize and merge garbage), that
// row is left out of the merge entirely, same as the forward-compat rule
// for a single key already gives a field this build has never heard of
// (it simply never competes, so it's never clobbered either). The caller
// surfaces this on the Account screen ("Another device has a newer
// Miziki.") rather than acting on it.
export function fromDocs(ownLocal, remoteRows){
  const ownDoc = toDoc(ownLocal);
  // One row per device (B1: each device keeps its own row), so a real
  // server fetch never returns the same deviceId twice — but deduping here
  // anyway (keep the last one seen) means a server-side duplicate can never
  // silently double-count that device's contribution.
  const byDevice = new Map();
  (remoteRows || []).forEach(r => { if(r && r.deviceId && r.deviceId !== ownDoc.deviceId) byDevice.set(r.deviceId, r); });

  let newerVersionSeen = false;
  const usable = [];
  byDevice.forEach(row => {
    if((row.schemaVersion || 0) > SCHEMA_VERSION){ newerVersionSeen = true; return; }
    const upconverted = upconvertToV3(row);
    // RF19, point 2: a structurally invalid row (corrupted, truncated, or
    // hand-edited) never gets a vote in the merge — skipped silently, the
    // same way a too-new schemaVersion already is above, rather than
    // letting a bad shape throw deep inside mergeRows() or poison another
    // device's own merged totals.
    if(!validateDoc(upconverted)) return;
    usable.push(upconverted);
  });

  const merged = mergeRows([ownDoc, ...usable]);
  return Object.assign(
    { schemaVersion: SCHEMA_VERSION, newerVersionSeen, ownReset: (ownDoc.historyClearedAt || 0) < merged.historyClearedAt },
    merged,
  );
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

// RF19 (docs/12_REFINE.md, "verify, and keep a way back"), point 1: a stable
// string for a doc regardless of its own object-key insertion order, so a
// checksum computed from it is reproducible from the same logical content —
// two builds of the identical doc (e.g. this device's own doc, recomputed
// for verification after a round trip through JSON) must hash identically
// even if some JS engine or JSON.parse happened to reorder keys along the
// way. Arrays keep their own order (order is meaningful there — e.g.
// itemWrites entries, playlist membership), only object keys are sorted.
export function canonicalStringify(value){
  const sort = v => {
    if(Array.isArray(v)) return v.map(sort);
    if(v && typeof v === 'object'){
      const out = {};
      Object.keys(v).sort().forEach(k => { out[k] = sort(v[k]); });
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

// RF19, point 2: a cheap, structural sanity check applied to a *remote* row
// before it's ever allowed to compete in a merge — not a full schema
// validator, just enough to catch a corrupted or truncated row (a failed
// write, a hand-edited row, a future bug) before it can poison every other
// device's own merged totals (a non-numeric counter breaking sumCounters()'s
// addition, a non-string id breaking every identity-key lookup, etc.). A row
// that fails is dropped outright in fromDocs() — never partially merged.
function isNonNegInt(v){ return typeof v === 'number' && Number.isFinite(v) && v >= 0 && Math.floor(v) === v; }
function isNonNegNum(v){ return typeof v === 'number' && Number.isFinite(v) && v >= 0; }
function isStr(v){ return typeof v === 'string'; }
// seq/deviceId are checked only when present, never required outright: a
// v1/v2 remote row's lastWrite.profileName/picture (the two fields RF17
// kept as a single stamp) predates RF16's own seq field entirely, and
// merge.js's isNewerStamp()/lastWriteWins() already read a missing seq as
// 0 and a missing deviceId as '' — a stamp with neither is a perfectly
// ordinary, if maximally low-priority, stamp to both of those, so it must
// be an ordinary, valid one here too. `at` is the one field RF16 docs
// always had regardless of version, so it alone is required.
function isStampLike(v){
  if(!v || typeof v !== 'object') return false;
  if(!isNonNegInt(v.at)) return false;
  if(v.seq !== undefined && !isNonNegInt(v.seq)) return false;
  if(v.deviceId !== undefined && v.deviceId !== null && !isStr(v.deviceId)) return false;
  return true;
}
function isFlatCounterMap(v){
  if(!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.keys(v).every(k => isNonNegInt(v[k]));
}
function isFlatMaxMap(v){
  if(!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.keys(v).every(k => isNonNegNum(v[k]));
}
function isStringArray(v){ return Array.isArray(v) && v.every(isStr); }
// PRESSINGS_110 PR7: zoetropeDayProgress's own shape, {albumId: [dayKey,
// ...]} — unlike rareUnlocked (a flat flag map merge.js's unionFlags()
// already tolerates any truthy value in, with no explicit check needed
// here, same precedent), unionDaySets() calls .forEach on each album's own
// value, so a malformed non-array there would throw mid-merge rather than
// just being silently ignored — worth the one explicit check.
function isAlbumDaySetMap(v){
  if(!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.keys(v).every(k => isStringArray(v[k] || []));
}
function isItemWritesArray(v){
  return Array.isArray(v) && v.every(e => e && typeof e === 'object'
    && isStr(e.key) && isNonNegInt(e.seq) && isNonNegInt(e.at)
    && (e.deviceId === null || isStr(e.deviceId)));
}

export function validateDoc(doc){
  if(!doc || typeof doc !== 'object') return false;
  if(!isStr(doc.deviceId)) return false;
  if(!isNonNegInt(doc.historyClearedAt || 0)) return false;

  const counters = doc.counters || {};
  const flatCounterFields = ['trackPlayCounts', 'sessionCounts', 'metalEligibleSessions', 'trackMetalEligiblePlays', 'phasePlayCounts'];
  if(!flatCounterFields.every(f => isFlatCounterMap(counters[f] || {}))) return false;
  const albumPhaseCounts = counters.albumPhaseCounts || {};
  if(typeof albumPhaseCounts !== 'object' || Array.isArray(albumPhaseCounts)) return false;
  if(!Object.keys(albumPhaseCounts).every(k => isFlatCounterMap(albumPhaseCounts[k]))) return false;

  const maxFields = doc.maxFields || {};
  if(!isFlatMaxMap(maxFields.trackLastPlayed || {})) return false;
  if(!isFlatMaxMap(maxFields.albumLastPlayed || {})) return false;

  if(doc.zoetropeDayProgress !== undefined && !isAlbumDaySetMap(doc.zoetropeDayProgress)) return false;

  const sealed = doc.sealed || {};
  if(!isStringArray(sealed.sealed || [])) return false;
  if(!isStringArray(sealed.broken || [])) return false;

  const itemWrites = doc.itemWrites || {};
  const itemWriteFields = ['albumOrder', 'albumSort', 'albumDisplay', 'trackDisplay', 'albumEdge', 'albumLookPref', 'albumFormat', 'prefs', 'playlistDefs', 'playlistOrder'];
  if(!itemWriteFields.every(f => isItemWritesArray(itemWrites[f] || []))) return false;

  const playlistMembership = doc.playlistMembership || [];
  if(!Array.isArray(playlistMembership)) return false;
  if(!playlistMembership.every(e => e && typeof e === 'object'
    && isStr(e.playlist) && isStr(e.identityKey)
    && (e.added === null || isStampLike(e.added))
    && (e.removed === null || isStampLike(e.removed)))) return false;

  const lastWrite = doc.lastWrite || {};
  if(lastWrite.profileName !== undefined && !isStampLike(lastWrite.profileName)) return false;
  if(lastWrite.picture !== undefined && !isStampLike(lastWrite.picture)) return false;

  const overlays = doc.overlays || [];
  if(!Array.isArray(overlays)) return false;
  if(!overlays.every(e => e && typeof e === 'object' && isStr(e.identityKey) && isNonNegInt(e.at || 0))) return false;

  const covers = doc.covers || [];
  if(!Array.isArray(covers)) return false;
  if(!covers.every(e => e && typeof e === 'object' && isStr(e.identityKey) && isNonNegInt(e.at || 0)
    && (e.hash === null || isStr(e.hash)))) return false;

  return true;
}

export { albumKey };
