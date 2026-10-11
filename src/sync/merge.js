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
// each field in a doc's lastWrite carries its own {at, value}, so one
// device's newer playlist edit never loses to another device's unrelated,
// but later, crate-anchor change ----
export function lastWriteWins(rows, field){
  let winner = null;
  for(const row of rows){
    const entry = row.lastWrite && row.lastWrite[field];
    if(!entry) continue;
    if(!winner || (entry.at || 0) > (winner.at || 0)) winner = entry;
  }
  return winner ? winner.value : undefined;
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
    lastWrite: {
      playlists: lastWriteWins(rows, 'playlists'),
      albumOrder: lastWriteWins(rows, 'albumOrder'),
      albumSort: lastWriteWins(rows, 'albumSort'),
      albumDisplay: lastWriteWins(rows, 'albumDisplay'),
      trackDisplay: lastWriteWins(rows, 'trackDisplay'),
      albumEdge: lastWriteWins(rows, 'albumEdge'),
      albumLookPref: lastWriteWins(rows, 'albumLookPref'),
      prefs: lastWriteWins(rows, 'prefs'),
      profileName: lastWriteWins(rows, 'profileName'),
    },
  };
}
