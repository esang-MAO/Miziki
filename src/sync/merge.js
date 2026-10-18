/* ================= backup merge: generic primitives =================
   Pure functions over an array of already-doc-shaped rows (see
   backup-doc.js for the doc shape itself — this file never builds or
   reads a local S-shaped snapshot, only the portable doc). Each primitive
   is the one decision rule from the B2 doc's key-inventory table, kept
   small and separately testable; mergeRows() composes them into the one
   entry point backup-doc.js's fromDocs() calls.

   No network, no DOM, no S import — a doc here is exactly what a later
   PR will read from the server, one row per device. */

// ---- per-device counters: the total is the sum over devices (B2 table) ----
export function sumCounters(rows, field){
  const out = {};
  for(const row of rows){
    const c = row.counters && row.counters[field];
    if(!c) continue;
    for(const k of Object.keys(c)) out[k] = (out[k] || 0) + (c[k] || 0);
  }
  return out;
}

// ---- albumPhaseCounts (DA5): a per-device counter like sumCounters above,
// just one level deeper — {albumId: {phase: count}} rather than
// {key: count}. Kept as its own primitive rather than teaching sumCounters
// to recurse, since every other per-device counter in this file (and B2's
// own table) is genuinely flat; phasePlayCounts itself (flat, {phase:
// count}) uses plain sumCounters directly, no new primitive needed ----
export function sumNestedCounters(rows, field){
  const out = {};
  for(const row of rows){
    const c = row.counters && row.counters[field];
    if(!c) continue;
    for(const albumId of Object.keys(c)){
      const inner = c[albumId];
      if(!inner) continue;
      const dest = out[albumId] || (out[albumId] = {});
      for(const phase of Object.keys(inner)) dest[phase] = (dest[phase] || 0) + (inner[phase] || 0);
    }
  }
  return out;
}

// ---- trackLastPlayed / albumLastPlayed: max() across devices ----
export function maxField(rows, field){
  const out = {};
  for(const row of rows){
    const m = row.maxFields && row.maxFields[field];
    if(!m) continue;
    for(const k of Object.keys(m)) out[k] = Math.max(out[k] || 0, m[k] || 0);
  }
  return out;
}

// ---- rareUnlocked: union of {albumKey: true} maps ----
export function unionFlags(rows, field){
  const out = {};
  for(const row of rows){
    const m = row[field];
    if(!m) continue;
    for(const k of Object.keys(m)) if(m[k]) out[k] = true;
  }
  return out;
}

// ---- achievements / collection: union by key; on overlap, the record with
// the earliest earned date wins (the tier was reached that early on some
// device, regardless of which device's upload happens to be newest) ----
export function unionEarliest(rows, field, dateField){
  const out = {};
  for(const row of rows){
    const m = row[field];
    if(!m) continue;
    for(const k of Object.keys(m)){
      const rec = m[k];
      const prev = out[k];
      if(!prev || (rec[dateField] || 0) < (prev[dateField] || 0)) out[k] = rec;
    }
  }
  return out;
}

// ---- sealed records: a seal broken on any device stays broken everywhere
// (B2 table) — independent of historyClearedAt, since SEALED spec §2 keeps
// S.sealed independent of listening history on the local side too ----
export function mergeSealed(rows){
  const sealed = new Set(), broken = new Set();
  for(const row of rows){
    const s = row.sealed;
    if(!s) continue;
    (s.sealed || []).forEach(id => sealed.add(id));
    (s.broken || []).forEach(id => broken.add(id));
  }
  broken.forEach(id => sealed.delete(id));
  return { sealed: [...sealed], broken: [...broken] };
}

// ---- playlists/albumOrder/albumSort/albumDisplay/trackDisplay/albumEdge/
// albumLookPref/prefs/profileName: last write wins, per field (B2 table) —
// each field in a doc's lastWrite carries its own {seq, at, deviceId, value},
// so one device's newer playlist edit never loses to another device's
// unrelated, but later, crate-anchor change.
//
// RF16 (docs/12_REFINE.md, "edits that know what they've seen"): compares
// seq first, not at — a plain wall-clock timestamp alone can't tell two
// devices' edits apart correctly when one device's clock runs slow. seq is
// a Lamport counter (S.backupSeq, src/state.js): a device's own edit made
// after it has seen another device's stamp is guaranteed a strictly higher
// seq than that stamp, regardless of either device's clock. A stamp with no
// seq at all (a v2-or-earlier doc, before this field existed) reads as 0,
// so any real seq beats it outright — an old untouched-by-RF16 row always
// loses to a newer edit from an RF16-aware device. at is the fallback only
// for two edits that never observed each other (so neither's seq is higher)
// — the genuinely concurrent case. deviceId is the final, deterministic
// tiebreak for two edits with the same seq and the same at (two devices
// starting from the exact same baseline, editing at the exact same
// millisecond — vanishingly rare, but mergeRows' own "any order, same
// answer" invariant requires every tie to resolve the same way regardless
// of row order, and comparing two numbers alone can't guarantee that on its
// own without a last, order-independent tiebreak).
export function lastWriteWins(rows, field){
  let winner = null;
  for(const row of rows){
    const entry = row.lastWrite && row.lastWrite[field];
    if(!entry) continue;
    if(!winner || isNewerStamp(entry, winner)) winner = entry;
  }
  return winner ? winner.value : undefined;
}

// RF17 (docs/12_REFINE.md, "merge per item, not per blob"): the same
// seq/at/deviceId precedence as lastWriteWins above, exported so the
// per-key and playlist-membership merges below (and backup-doc.js's own
// upconverter) can share one definition of "newer."
export function isNewerStamp(a, b){
  const aSeq = (a && a.seq) || 0, bSeq = (b && b.seq) || 0;
  if(aSeq !== bSeq) return aSeq > bSeq;
  const aAt = (a && a.at) || 0, bAt = (b && b.at) || 0;
  if(aAt !== bAt) return aAt > bAt;
  const aDev = (a && a.deviceId) || '', bDev = (b && b.deviceId) || '';
  return aDev > bDev;
}

// ---- RF17: per-item last-write-wins, for a field that used to be one
// whole-blob stamp (B2 table) and is now one stamp per key — albumOrder,
// albumSort, albumDisplay, trackDisplay, albumEdge, albumLookPref, prefs,
// playlistDefs, playlistOrder. Each row contributes row.itemWrites[field],
// an array of {key, seq, at, deviceId, value} (the same shape
// mergeOverlays/mergeCovers already use, just keyed by whatever this field
// calls a "key" — an album title, a playlist name, a bare pref name — not
// always a trackIdentityKey). The newest entry per key wins; a tombstone
// (value === null) wins exactly like any other value but is left out of
// the returned map, the same "absent means deleted" shape mergeOverlays'
// own revert tombstone already uses ----
export function mergeKeyedLastWriteWins(rows, field){
  const winners = {};
  for(const row of rows){
    const entries = (row.itemWrites && row.itemWrites[field]) || [];
    for(const e of entries){
      const prev = winners[e.key];
      if(!prev || isNewerStamp(e, prev)) winners[e.key] = e;
    }
  }
  const out = {};
  Object.keys(winners).forEach(k => {
    const w = winners[k];
    if(w.value !== null) out[k] = w.value;
  });
  return out;
}

// ---- RF17: playlist membership as an add-wins set — a (playlist,
// identityKey) pair is present iff the newest event anywhere for that pair
// is an add, not a remove (B2's own concurrency concern: hearting track X
// on one offline device and track Y on another must keep both, which this
// achieves trivially since they're independent keys; a genuine toggle race
// on the *same* pair resolves by the same seq/at/deviceId total order
// every other field uses, so "any order, same answer" still holds). Each
// row contributes row.playlistMembership, an array of {playlist,
// identityKey, added: stamp|null, removed: stamp|null} — at most one
// entry per pair per row, but a row may legitimately have only one side
// set (it only ever added, or only ever removed, that pair). Returns
// {playlistName: [identityKey, ...]}, in no particular order — ordering is
// playlistOrder's job (see backup-doc.js's own compose step) ----
export function mergePlaylistMembership(rows){
  const latest = {};   // 'playlist\u0000identityKey' -> {stamp, present}
  const consider = (ck, stamp, present) => {
    if(!stamp) return;
    const prev = latest[ck];
    if(!prev || isNewerStamp(stamp, prev.stamp)) latest[ck] = { stamp, present };
  };
  for(const row of rows){
    for(const e of row.playlistMembership || []){
      const ck = e.playlist + '\u0000' + e.identityKey;
      consider(ck, e.added, true);
      consider(ck, e.removed, false);
    }
  }
  const out = {};
  Object.keys(latest).forEach(ck => {
    if(!latest[ck].present) return;
    const i = ck.indexOf('\u0000');
    const playlist = ck.slice(0, i), identityKey = ck.slice(i + 1);
    (out[playlist] || (out[playlist] = [])).push(identityKey);
  });
  return out;
}

// ---- the highest seq seen anywhere across every stamp of every given row
// (RF16) — src/sync/backup.js's pull path uses this to bump this device's
// own S.backupSeq to at least as high as anything it's just seen, so its
// next edit is guaranteed a higher seq than every stamp it has ever
// observed, on any device. RF17 widened this beyond row.lastWrite (now
// just profileName/picture) to row.itemWrites' per-key arrays and
// row.playlistMembership's added/removed stamps — every place a seq can
// appear in a doc at all — or a device whose only recent edits were to an
// album's sort order or a playlist heart would fail to bump its own
// counter past what it just saw there ----
function bumpMax(map, entry){
  const seq = (entry && entry.seq) || 0;
  if(seq > map.max) map.max = seq;
}
export function maxSeqAcross(rows){
  const acc = { max: 0 };
  for(const row of rows){
    for(const entry of Object.values(row.lastWrite || {})) bumpMax(acc, entry);
    for(const entries of Object.values(row.itemWrites || {})){
      for(const e of entries || []) bumpMax(acc, e);
    }
    for(const e of row.playlistMembership || []){
      bumpMax(acc, e.added);
      bumpMax(acc, e.removed);
    }
  }
  return acc.max;
}

// ---- overlays: last edit wins by timestamp; a revert is a tombstone that
// also wins by timestamp (B2 table) — merged per track identityKey, the
// same portable key playlists/duplicate-detection/play counts already use ----
export function mergeOverlays(rows){
  const out = {};
  for(const row of rows){
    for(const entry of row.overlays || []){
      const prev = out[entry.identityKey];
      if(!prev || (entry.at || 0) > (prev.at || 0)) out[entry.identityKey] = entry;
    }
  }
  return out;
}

// ---- cover images: last write wins per track identity key, same shape as
// mergeOverlays above and for the same reason — a null hash is the
// tombstone ("reverted to the file's own embedded art") and wins exactly
// like any other newer value (step 07, B4, point 4) ----
export function mergeCovers(rows){
  const out = {};
  for(const row of rows){
    for(const entry of row.covers || []){
      const prev = out[entry.identityKey];
      if(!prev || (entry.at || 0) > (prev.at || 0)) out[entry.identityKey] = entry;
    }
  }
  return out;
}

// ---- "Clear listening history" has to win everywhere (B2 doc, point 4) ----
export function computeHistoryClearedAt(rows){
  let max = 0;
  for(const row of rows) max = Math.max(max, row.historyClearedAt || 0);
  return max;
}

// a row whose own historyClearedAt predates the newest clear anywhere is
// ignored for every history-shaped field (counters, max-timestamps, rare
// unlocks, achievements, Collection) — it's pre-clear data that a clear
// elsewhere has since superseded. Not applied to lastWrite/sealed/overlays,
// none of which are "history" (B2 doc, point 4).
export function freshRows(rows, maxClearedAt){
  return rows.filter(row => (row.historyClearedAt || 0) >= maxClearedAt);
}

// The one entry point: given every row for a user (one per device, this
// device's own fresh doc included), returns the fully merged result.
// Counter/invariant note (B2 doc, point 3): each row must hold only that
// device's own contribution — mergeRows only ever sums/unions/max()s across
// rows, so running it twice on the same input, or on the rows in any order,
// produces the same totals (sum/max/union are all order- and
// repetition-safe) — never a running total that itself gets fed back in
// as one more row.
export function mergeRows(rows){
  const maxClearedAt = computeHistoryClearedAt(rows);
  const fresh = freshRows(rows, maxClearedAt);

  return {
    historyClearedAt: maxClearedAt,
    totals: {
      counters: {
        trackPlayCounts: sumCounters(fresh, 'trackPlayCounts'),
        sessionCounts: sumCounters(fresh, 'sessionCounts'),
        metalEligibleSessions: sumCounters(fresh, 'metalEligibleSessions'),
        trackMetalEligiblePlays: sumCounters(fresh, 'trackMetalEligiblePlays'),
        // DA5 (docs/DAY_ARC.md): per-device counters, same rule as every
        // other row in this object
        phasePlayCounts: sumCounters(fresh, 'phasePlayCounts'),
        albumPhaseCounts: sumNestedCounters(fresh, 'albumPhaseCounts'),
      },
      maxFields: {
        trackLastPlayed: maxField(fresh, 'trackLastPlayed'),
        albumLastPlayed: maxField(fresh, 'albumLastPlayed'),
      },
      rareUnlocked: unionFlags(fresh, 'rareUnlocked'),
      achievements: unionEarliest(fresh, 'achievements', 'updatedAt'),
      collection: unionEarliest(fresh, 'collection', 'discoveredAt'),
    },
    sealed: mergeSealed(rows),
    overlays: mergeOverlays(rows),
    covers: mergeCovers(rows),
    // RF17: everything that used to be a whole-blob lastWriteWins() value
    // (playlists, albumOrder, albumSort, albumDisplay, trackDisplay,
    // albumEdge, albumLookPref, prefs) is now merged per item instead —
    // see mergeKeyedLastWriteWins()/mergePlaylistMembership() above.
    // profileName/picture are the two fields simple enough to stay as a
    // single whole-value stamp (there's no meaningful "per item" to split
    // either into).
    itemWrites: {
      albumOrder: mergeKeyedLastWriteWins(rows, 'albumOrder'),
      albumSort: mergeKeyedLastWriteWins(rows, 'albumSort'),
      albumDisplay: mergeKeyedLastWriteWins(rows, 'albumDisplay'),
      trackDisplay: mergeKeyedLastWriteWins(rows, 'trackDisplay'),
      albumEdge: mergeKeyedLastWriteWins(rows, 'albumEdge'),
      albumLookPref: mergeKeyedLastWriteWins(rows, 'albumLookPref'),
      prefs: mergeKeyedLastWriteWins(rows, 'prefs'),
      playlistDefs: mergeKeyedLastWriteWins(rows, 'playlistDefs'),
      playlistOrder: mergeKeyedLastWriteWins(rows, 'playlistOrder'),
    },
    playlistMembership: mergePlaylistMembership(rows),
    lastWrite: {
      profileName: lastWriteWins(rows, 'profileName'),
      // step 07, B4: the profile picture / public avatar — last write
      // wins per field, the same shape as profileName right above it
      picture: lastWriteWins(rows, 'picture'),
    },
  };
}
