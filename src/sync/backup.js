/* ================= account backup: sync engine =================
   Step 06 (B3), extended in step 07 (B4) with custom-cover and profile-
   picture/avatar backup to Supabase Storage (migration 006). The server
   table (public.library_backup, migration 005), the pure merge logic
   (backup-doc.js/merge.js, step 03) and the storage buckets already
   exist — this is the part that wires them into the running app. Nothing
   here runs unless the user is signed in; with social config empty (or
   signed out), every exported function here is a safe no-op, same as the
   rest of the social layer (see CLAUDE.md's "Social config" note).

   Never imports library/view.js, record-art/looks.js or storage/meta.js
   — all three reach the exact same circularly-connected hub (library/
   view.js's own seven circular pairs; record-art/looks.js and storage/
   meta.js both reach it transitively, the former through history/
   sessions.js -> library/thumbs.js -> library/edit.js, the latter
   through player/background.js -> player/transport.js). A UI refresh
   need goes through the small onBackup('applied', ...) event instead —
   see applyMerged()'s own note below — and a meta-store write that would
   otherwise go through storage/meta.js's queueSave()/saveMeta() calls
   meta.put() directly on the already-imported, leaf storage/repo.js
   instead (see queueAvatarUpload()'s own comment).

   Reuses the Supabase client the social layer already creates
   (MizikiSocial.getClient()) rather than opening a second one — a second
   client would mean two separate auth sessions/token refreshes racing
   each other for no reason.

   Never on the iOS tap-to-play path (rule 9, CLAUDE.md): every function
   below either runs on a timer, in response to a background/foreground
   transition, or after an already-asynchronous storage write — none of
   it is reachable from play()/pause()/seek(), and nothing here is ever
   awaited by playback code. */
import { S, touchBackupField } from '../state.js';
import { meta, overlays as overlaysRepo, artwork as artworkRepo, profile as profileRepo } from '../storage/repo.js';
import { serializePrefs, parsePrefs } from '../storage/prefs.js';
import { trackIdentityKey, albumKey } from '../record-art/tiers.js';
import { idxOf } from '../library/model.js';
import { toDoc, fromDocs, resolveIdentityKey, SCHEMA_VERSION } from './backup-doc.js';
// crate/tiers.js is a leaf (only S, sleep, albumKey, artwork) — safe to
// import directly, unlike library/view.js or record-art/looks.js (see
// applyMerged()'s own note below for why those two stay out).
import { deleteCrateArtTiers, buildCrateTier } from '../crate/tiers.js';
import { prepareCoverUpload, prepareAvatarUpload } from './images.js';
// sundown/rhythm.js is a leaf (no imports at all) -- the same safe-to-
// import-directly shape as crate/tiers.js above, for the exact same reason.
import { RHYTHM_MIN_PLAYS, computeRhythmShares, rhythmVerdictLabel } from '../sundown/rhythm.js';

const BACKUP_DEBOUNCE_MS = 30000;
const BACKOFF = [15000, 30000, 60000, 120000, 300000];
const SCHEMA_TABLE = 'library_backup';

const B = {
  timer: null, backoffIdx: 0, syncing: false, again: false,
  status: { backedUp: false, lastSyncedAt: null, waiting: false, lastError: null },
  listeners: {},
  // pending cross-device entries this device couldn't resolve to a local
  // track yet (B2's own "doesn't exist locally yet" list, applied) — kept
  // in memory and mirrored to meta so a restart doesn't lose them
  pending: { overlays: {}, playlistItems: [], albumOrderItems: [], covers: {} },
  // step 07 (B4): hashes this device has already confirmed uploaded this
  // install, so an unchanged cover/avatar isn't re-uploaded every single
  // sync cycle once online — keyed 'bucket:hash', persisted to meta so a
  // restart doesn't forget and immediately re-upload everything once
  uploadedHashes: null,
};

function emit(evt, payload){
  (B.listeners[evt] || []).slice().forEach(fn => { try{ fn(payload); }catch(_e){ /* listener bugs must not break sync */ } });
}
// Like emit(), but awaits whatever every listener returns before resolving
// — used only where the caller's own next step depends on a listener's
// work actually finishing (applyMerged()'s 'reset' branch below, RF1: it
// must not adopt the remote historyClearedAt stamp until main.js's
// resetLocalHistory() call has actually zeroed and persisted this
// device's counters, or a reload in between would read the old ones
// straight back out of meta).
async function emitAwait(evt, payload){
  const fns = (B.listeners[evt] || []).slice();
  await Promise.all(fns.map(fn => Promise.resolve().then(() => fn(payload)).catch(()=>{ /* listener bugs must not break sync */ })));
}
export function onBackup(evt, fn){
  (B.listeners[evt] = B.listeners[evt] || []).push(fn);
  return () => { B.listeners[evt] = (B.listeners[evt] || []).filter(f => f !== fn); };
}
function setStatus(patch){ Object.assign(B.status, patch); emit('status', { ...B.status }); }

// MizikiSocial is a real global (src/miziki-social.js, a classic script
// loaded just before this one — see CLAUDE.md's own note on why), never
// imported — but a Node unit test has no such global at all, and nothing
// here should ever throw just because the social layer hasn't loaded
// (same "behaves exactly as before" guarantee every other MizikiSocial
// caller in the app already gets). getSocial() is the one place that
// checks, so every call site below just gets null instead of a
// ReferenceError.
function getSocial(){ return typeof MizikiSocial === 'undefined' ? null : MizikiSocial; }
function getClient(){ const soc = getSocial(); return soc ? soc.getClient() : null; }

/* ================= device identity ================= */
function makeDeviceId(){
  if(typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // fallback for a browser without crypto.randomUUID — v4-shaped, not
  // cryptographically strong, which doesn't matter here: it's a row key,
  // never a secret
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function guessDeviceLabel(){
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if(/iPhone/.test(ua)) return 'iPhone';
  if(/iPad/.test(ua)) return 'iPad';
  if(/Android/.test(ua)) return 'Android device';
  if(/Macintosh/.test(ua)) return 'Mac';
  if(/Windows/.test(ua)) return 'Windows PC';
  return 'This device';
}
async function ensureDeviceId(){
  if(S.deviceId) return S.deviceId;
  let id = await meta.get('deviceId');
  if(!id){ id = makeDeviceId(); await meta.put('deviceId', id); }
  S.deviceId = id;
  let label = await meta.get('deviceLabel');
  if(!label){ label = guessDeviceLabel(); await meta.put('deviceLabel', label); }
  S.deviceLabel = label;
  return id;
}

async function restorePending(){
  const p = await meta.get('pendingBackupEntries');
  if(p && typeof p === 'object'){
    B.pending.overlays = p.overlays || {};
    B.pending.playlistItems = p.playlistItems || [];
    B.pending.albumOrderItems = p.albumOrderItems || [];
    B.pending.covers = p.covers || {};
  }
}
function persistPending(){ meta.put('pendingBackupEntries', B.pending).catch(() => {}); }

async function loadUploadedHashes(){
  if(B.uploadedHashes) return B.uploadedHashes;
  const saved = await meta.get('uploadedImageHashes');
  B.uploadedHashes = new Set(Array.isArray(saved) ? saved : []);
  return B.uploadedHashes;
}
function persistUploadedHashes(){ meta.put('uploadedImageHashes', [...B.uploadedHashes]).catch(() => {}); }

/* ================= building this device's own snapshot ================= */
function buildLocalState(){
  return {
    deviceId: S.deviceId,
    historyClearedAt: S.historyClearedAt,
    tracks: S.tracks,
    playlists: S.playlists,
    albumOrder: S.albumOrder,
    albumSort: S.albumSort,
    albumDisplay: S.albumDisplay,
    trackDisplay: S.trackDisplay,
    albumEdge: S.albumEdge,
    albumLookPref: S.albumLookPref,
    // D2 (docs/DESKTOP_LAYOUT.md): theme is device-only by that doc's own
    // default -- stripped here, not in serializePrefs itself, since it's
    // still a perfectly normal local pref (saveMeta()'s own
    // serializePrefs(S) call, in storage/meta.js, keeps it) -- only the
    // uploaded copy must never carry it, or a pinned choice on one device
    // would silently follow the account to every other one via prefs'
    // existing last-write-wins sync.
    // CEREMONY §6: the slipmat flags are device-only too, since the image
    // they point at never leaves this device.
    prefs: (() => {
      const p = serializePrefs(S);
      delete p.theme; delete p.slipmatCustom; delete p.slipmatWordmark; delete p.slipmatDim;
      return p;
    })(),
    profileName: S.profile.name || '',
    trackPlayCounts: S.trackPlayCounts,
    sessionCounts: S.sessionCounts,
    metalEligibleSessions: S.metalEligibleSessions,
    trackMetalEligiblePlays: S.trackMetalEligiblePlays,
    // DA5 (docs/DAY_ARC.md): per-device counters, same shape/rule as
    // trackPlayCounts above
    phasePlayCounts: S.phasePlayCounts,
    albumPhaseCounts: S.albumPhaseCounts,
    trackLastPlayed: S.trackLastPlayed,
    albumLastPlayed: S.albumLastPlayed,
    rareUnlocked: S.rareUnlocked,
    achievements: S.achievements,
    collection: S.collection,
    sealedIds: [...S.sealed],
    brokenSealIds: [...S.sealedBroken],
    overlaysRaw: B.overlaysRawCache || [],
    // step 07, B4 — null until a picture has been set and re-encoded at
    // least once (uploadedAt isn't a precondition; a hash can be claimed
    // here before its upload actually finishes, same as a cover's own
    // overlay.cover field — see applyEdit()'s call into queueCoverUpload)
    picture: S.profile.pictureHash ? { hash: S.profile.pictureHash, updatedAt: S.backupUpdatedAt.picture } : null,
    updatedAt: S.backupUpdatedAt,
  };
}

/* ================= push: upload this device's own doc ================= */
async function pushBackup(){
  const client = getClient();
  if(!client) return { ok:false };
  const { data } = await client.auth.getUser();
  const uid = data && data.user && data.user.id;
  if(!uid) return { ok:false };
  await ensureDeviceId();
  B.overlaysRawCache = await overlaysRepo.all();
  const doc = toDoc(buildLocalState());
  const { error } = await client.from(SCHEMA_TABLE).upsert({
    user_id: uid, device_id: S.deviceId, device_label: S.deviceLabel,
    schema_version: SCHEMA_VERSION, doc,
  }, { onConflict: 'user_id,device_id' });
  if(error) throw error;
  await flushPendingImages(client, uid);
  // DA5 (docs/DAY_ARC.md): "updated at most daily" piggybacks this same
  // debounced/offline-safe push cycle rather than a timer of its own —
  // see maybePushListeningRhythm()'s own comment below for the gate.
  await maybePushListeningRhythm();
  return { ok:true };
}

/* ================= listening rhythm (step DA5, docs/DAY_ARC.md) =================
   The shared half of listening rhythm: an opt-in (default off), at-most-
   daily snapshot of the aggregate {verdict, shares} only — never raw
   plays, never S.phasePlayCounts/S.albumPhaseCounts themselves, which
   stay local like every other per-device counter (see the backup
   key-inventory table, CLAUDE.md). Written through MizikiSocial's own
   setListeningRhythm() (updateProfile()'s own validated write path), not
   a direct `.from('profiles').update(...)` the way avatar_url above is —
   unlike that one write (which the sync engine itself derives from a
   Storage upload's own result), this one has real, reusable shape
   validation worth going through once rather than duplicating here. */
const RHYTHM_PUSH_INTERVAL_MS = 24 * 60 * 60 * 1000;
let rhythmPushedAtLoaded = false;
async function ensureRhythmPushedAt(){
  if(rhythmPushedAtLoaded) return;
  rhythmPushedAtLoaded = true;
  const saved = await meta.get('rhythmPushedAt');
  if(typeof saved === 'number') S.rhythmPushedAt = saved;
}
function setRhythmPushedAt(at){
  S.rhythmPushedAt = at;
  meta.put('rhythmPushedAt', at).catch(() => {});
}
// null (not a thrown error) when there's nothing to share yet — below the
// 20-play gate (DA5 point 2) is the ordinary "just signed up" case, not a
// failure, so every caller treats it the same way a signed-out/not-
// configured social layer already is: a quiet no-op, not a surfaced error.
function buildRhythmPayload(){
  const { total, shares } = computeRhythmShares(S.phasePlayCounts);
  if(total < RHYTHM_MIN_PLAYS) return null;
  return { verdict: rhythmVerdictLabel(shares), shares };
}
// Called from pushBackup()'s own already-running cycle, every ordinary
// debounced sync — a no-op unless the Privacy switch is on, the daily
// interval has actually elapsed, and there's enough data to share at all.
async function maybePushListeningRhythm(){
  // best-effort, piggybacked onto a push that has already actually
  // succeeded by the time this runs (see pushBackup()'s own call site) --
  // any failure here (a missing/old MizikiSocial build without
  // getSettings()/setListeningRhythm(), a network hiccup on just this one
  // extra write) must never turn an otherwise-successful backup push into
  // a failed one, the same posture cleanupOrphanedImages() already has.
  try{
    const soc = getSocial();
    if(!soc || typeof soc.getSettings !== 'function' || typeof soc.setListeningRhythm !== 'function') return;
    if(!soc.getSettings().shareListeningRhythm) return;
    await ensureRhythmPushedAt();
    if(Date.now() - S.rhythmPushedAt < RHYTHM_PUSH_INTERVAL_MS) return;
    const payload = buildRhythmPayload();
    if(!payload) return;   // not 20 plays yet -- the next push after that picks it up
    const r = await soc.setListeningRhythm(payload);
    if(r && r.ok) setRhythmPushedAt(Date.now());
  }catch(_e){ /* best-effort -- see the comment above */ }
}
// The Privacy screen's own switch handler calls this directly (DA5 point
// 3's "updated... immediately when the switch is flipped") rather than
// waiting out the daily interval above, which exists only to keep an
// *already-on* switch's shared value from going stale, not to gate the
// very first share or an explicit turn-off. Turning off always clears the
// column right away, even if nothing was ever actually shared (a harmless
// no-op null-over-null write) -- simpler than first checking whether a
// value exists, and it's what makes "flip off" an unconditional guarantee
// rather than one with its own exception.
export async function pushOrClearListeningRhythm(on){
  const soc = getSocial();
  if(!soc) return { ok:false };
  await ensureRhythmPushedAt();
  if(!on){
    const r = await soc.setListeningRhythm(null);
    if(r && r.ok) setRhythmPushedAt(0);
    return r;
  }
  const payload = buildRhythmPayload();
  if(!payload) return { ok:true, skipped:true };
  const r = await soc.setListeningRhythm(payload);
  if(r && r.ok) setRhythmPushedAt(Date.now());
  return r;
}

/* ================= images: upload (step 07, B4) =================
   Called right after the local write (applyEdit()'s artBlob branch,
   persistProfile()'s avatar branch) — re-encodes and hashes immediately
   (fast, local, no network) so the doc's own cover/picture claim is
   correct the moment the next sync fires, then leaves the actual network
   upload to flushPendingImages(), which runs as part of the same
   debounced/backoff push cycle as the doc itself (point 5: "the same
   continuous, debounced, offline-safe queue as B3") rather than a queue
   of its own. Never awaited by anything on the playback path — both
   callers are already deep in an async edit/save flow, nowhere near
   play(). */
export async function queueCoverUpload(trackId, blob){
  try{
    const { hash } = await prepareCoverUpload(blob);
    const existing = await overlaysRepo.get(trackId);
    await overlaysRepo.put(Object.assign({}, existing, { id: trackId, cover: { hash, updatedAt: Date.now() } }));
    scheduleBackupSync();
  }catch(_e){ /* a failed re-encode just means no cover backup claim this round */ }
}
export async function queueAvatarUpload(blob){
  try{
    const { hash } = await prepareAvatarUpload(blob);
    S.profile.pictureHash = hash;
    touchBackupField('picture');
    // storage/meta.js's own queueSave()/saveMeta() is exactly the module
    // this file must never import (see the header note above) — it
    // reaches player/background.js -> player/transport.js ->
    // library/view.js, the same chain-explosion risk as library/view.js
    // or record-art/looks.js directly. meta.put() alone, on the already-
    // imported `meta` from storage/repo.js (a leaf), writes the same
    // backupUpdatedAt row immediately, with no debounce and no new edge.
    meta.put('backupUpdatedAt', S.backupUpdatedAt).catch(() => {});
    const prof = await profileRepo.get('me');
    await profileRepo.put(Object.assign({}, prof, { k:'me', pictureHash: hash }));
    scheduleBackupSync();
  }catch(_e){ /* same as above */ }
}

async function uploadOne(client, uid, bucket, hash, blob){
  const set = await loadUploadedHashes();
  const tag = bucket + ':' + hash;
  if(set.has(tag)) return true;
  const path = uid + '/' + (bucket === 'avatars' ? 'avatar-' : '') + hash + '.jpg';
  const { error } = await client.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if(error) return false;
  set.add(tag);
  persistUploadedHashes();
  return true;
}

// One upload attempt per track with a custom-cover claim, plus one for
// the profile picture if set — small enough in practice (a handful of
// custom covers, at most one avatar) to just re-scan every push cycle
// rather than track a separate "needs upload" queue; uploadOne()'s own
// uploadedHashes check already makes a repeat scan with nothing new a
// no-op. Re-encodes from the original locally-stored blob each time
// (prepareCoverUpload/prepareAvatarUpload are deterministic) rather than
// keeping a second copy of the re-encoded bytes around.
async function flushPendingImages(client, uid){
  const overlaysNow = await overlaysRepo.all();
  for(const o of overlaysNow){
    if(!o.cover || !o.cover.hash) continue;
    const artRec = await artworkRepo.get(o.id);
    if(!artRec || !artRec.blob) continue;
    const { blob, hash } = await prepareCoverUpload(artRec.blob);
    if(hash !== o.cover.hash) continue;   // the stored art changed since the hash was stamped; next edit will restamp it
    await uploadOne(client, uid, 'covers', hash, blob);
  }
  const prof = await profileRepo.get('me');
  if(prof && prof.pictureHash && prof.pictureBlob){
    const { blob, hash } = await prepareAvatarUpload(prof.pictureBlob);
    if(hash === prof.pictureHash && await uploadOne(client, uid, 'avatars', hash, blob)){
      const { data } = client.storage.from('avatars').getPublicUrl(uid + '/avatar-' + hash + '.jpg');
      if(data && data.publicUrl) await client.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', uid);
    }
  }
  await cleanupOrphanedImages(client, uid, overlaysNow, prof);
}

// pure: given a bucket's current file list ({name, hash, updatedAt}) and
// the set of hashes still referenced anywhere, returns the filenames that
// reference none of them and are therefore safe to delete — point 5's
// "no other entry in the user's merged doc still references that hash".
// keepNewest (point 5's avatar rule: "keep at most one unreferenced
// avatar file per user") skips that many of the most-recently-updated
// unreferenced files rather than deleting every one of them outright, so
// a device mid-sync still has something to fall back to; covers pass 0,
// since an orphaned cover can always be re-derived from the file's own
// embedded art instead.
export function orphanedFiles(files, referencedHashes, keepNewest){
  const unreferenced = (files || []).filter(f => !referencedHashes.has(f.hash));
  if(!keepNewest) return unreferenced.map(f => f.name);
  return unreferenced.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(keepNewest).map(f => f.name);
}

function parseHashFromFilename(name, prefix){
  const m = name.match(prefix ? /^avatar-([0-9a-f]+)\.jpg$/ : /^([0-9a-f]+)\.jpg$/);
  return m ? m[1] : null;
}
async function listBucketFiles(client, bucket, uid){
  const { data } = await client.storage.from(bucket).list(uid);
  return (data || []).map(f => ({
    name: f.name, hash: parseHashFromFilename(f.name, bucket === 'avatars'),
    updatedAt: f.updated_at ? new Date(f.updated_at).getTime() : 0,
  })).filter(f => f.hash);
}
async function cleanupOrphanedImages(client, uid, overlaysNow, prof){
  try{
    const coverHashes = new Set(overlaysNow.filter(o => o.cover && o.cover.hash).map(o => o.cover.hash));
    const coverFiles = await listBucketFiles(client, 'covers', uid);
    const staleCovers = orphanedFiles(coverFiles, coverHashes, 0);
    if(staleCovers.length) await client.storage.from('covers').remove(staleCovers.map(n => uid + '/' + n));

    const avatarHashes = new Set(prof && prof.pictureHash ? [prof.pictureHash] : []);
    const avatarFiles = await listBucketFiles(client, 'avatars', uid);
    const staleAvatars = orphanedFiles(avatarFiles, avatarHashes, 1);
    if(staleAvatars.length) await client.storage.from('avatars').remove(staleAvatars.map(n => uid + '/' + n));
  }catch(_e){ /* best-effort housekeeping — never worth failing the sync cycle over */ }
}

/* ================= images: download on restore (step 07, B4) =================
   Only fetched when a matching local track (or the local profile) exists
   — a cover/avatar for a track this device doesn't have yet stays
   pending, the same "kept, not dropped" shape B3 already uses for
   playlist/albumOrder/overlay entries, resolved later by
   reconcileImportedTrack(). A hash this device already has locally
   (artwork/profile store already holds it) is never re-fetched. */
async function queueCoverDownload(client, uid, t, entry){
  const existing = await overlaysRepo.get(t.id);
  const localAt = (existing && existing.cover && existing.cover.updatedAt)
    || (existing && existing.reverted ? existing.revertedAt : 0) || 0;
  if((entry.at || 0) <= localAt) return;
  if(!entry.hash){
    await artworkRepo.del(t.id);
    await overlaysRepo.put(Object.assign({}, existing, { id: t.id, cover: null }));
  } else {
    const { data, error } = await client.storage.from('covers').download(uid + '/' + entry.hash + '.jpg');
    if(error || !data) return;   // not uploaded yet, or offline — retried on the next pull
    await artworkRepo.put({ id: t.id, blob: data });
    await overlaysRepo.put(Object.assign({}, existing, { id: t.id, cover: { hash: entry.hash, updatedAt: entry.at } }));
  }
  const albumId = albumKey(t);
  await deleteCrateArtTiers(albumId);
  buildCrateTier(albumId, 'S').catch(() => {});
  emit('applied');
}
async function queueAvatarDownload(client, uid, picture){
  if(!picture) return;
  const prof = await profileRepo.get('me');
  const localAt = (prof && prof.pictureUpdatedAt) || 0;
  if(!picture.hash || (picture.at || 0) <= localAt) return;
  const { data, error } = await client.storage.from('avatars').download(uid + '/avatar-' + picture.hash + '.jpg');
  if(error || !data) return;
  if(S.profile.art) try{ URL.revokeObjectURL(S.profile.art); }catch(_e){}
  S.profile.artBlob = data;
  S.profile.art = URL.createObjectURL(data);
  S.profile.pictureHash = picture.hash;
  await profileRepo.put(Object.assign({}, prof, {
    k:'me', pictureBlob: data, pictureHash: picture.hash, pictureUpdatedAt: picture.at,
  }));
  emit('applied');
}

/* ================= pull: fetch every row, merge, apply ================= */
async function fetchRemoteRows(client){
  const { data, error } = await client.from(SCHEMA_TABLE).select('device_id, doc');
  if(error) throw error;
  return (data || []).map(r => Object.assign({}, r.doc, { deviceId: r.device_id }));
}

// Apply only the fields the B2 design says are safe to adopt directly —
// never the four per-device counters, which stay this device's own
// numbers forever (see backup-doc.js's own header comment: writing a
// cross-device total back into a per-device counter would double-count
// on the very next upload).
async function applyMerged(merged, ownLocal, client, uid){
  if(merged.ownReset){
    // RF1 (docs/12_REFINE.md): history/clear.js's resetLocalHistory() is
    // the one place that zeroes *and persists* every field a full clear
    // touches (not just the four counters this branch used to reset in
    // memory, with nothing written to meta) — but it reaches library/
    // view.js's whole import web (see this file's own header comment), so
    // it can't be imported here directly. 'reset' is emitted the same way
    // 'applied' already is, for main.js to wire up; emitAwait (unlike
    // plain emit()) waits for that work to actually finish, since adopting
    // merged.historyClearedAt before it does would leave the old, not-yet-
    // reset counters queued up for the very next push.
    await emitAwait('reset');
    S.historyClearedAt = merged.historyClearedAt;
    await meta.put('historyClearedAt', S.historyClearedAt);
  }
  Object.assign(S.rareUnlocked, merged.totals.rareUnlocked);
  Object.assign(S.achievements, merged.totals.achievements);
  Object.assign(S.collection, merged.totals.collection);
  Object.keys(merged.totals.maxFields.trackLastPlayed).forEach(k => {
    S.trackLastPlayed[k] = Math.max(S.trackLastPlayed[k] || 0, merged.totals.maxFields.trackLastPlayed[k]);
  });
  Object.keys(merged.totals.maxFields.albumLastPlayed).forEach(k => {
    S.albumLastPlayed[k] = Math.max(S.albumLastPlayed[k] || 0, merged.totals.maxFields.albumLastPlayed[k]);
  });
  // sealed/broken: union, broken wins (library/sealed.js's own data, kept
  // independent of listening history on purpose — SEALED spec §2)
  merged.sealed.sealed.forEach(id => { if(!merged.sealed.broken.includes(id)) S.sealed.add(id); });
  merged.sealed.broken.forEach(id => { S.sealed.delete(id); S.sealedBroken.add(id); });

  const byIdentity = {};
  ownLocal.tracks.forEach(t => { byIdentity[trackIdentityKey(t)] = t; });

  applyLastWriteField('albumSort', merged.lastWrite.albumSort, v => { S.albumSort = v; });
  // art is a runtime-only object URL, stripped before it ever reaches a
  // doc (backup-doc.js's stripArtMap) — reattach each entry's own local
  // art rather than blanking it out when another device's name/artist wins
  applyLastWriteField('albumDisplay', merged.lastWrite.albumDisplay, v => { S.albumDisplay = reattachArt(v, S.albumDisplay); });
  applyLastWriteField('trackDisplay', merged.lastWrite.trackDisplay, v => { S.trackDisplay = reattachArt(v, S.trackDisplay); });
  applyLastWriteField('albumEdge', merged.lastWrite.albumEdge, v => { S.albumEdge = v; });
  applyLastWriteField('albumLookPref', merged.lastWrite.albumLookPref, v => { S.albumLookPref = v; });
  applyLastWriteField('prefs', merged.lastWrite.prefs, applyPrefsPatch);
  applyLastWriteField('profileName', merged.lastWrite.profileName, v => { if(typeof v === 'string') S.profile.name = v; });
  // step 07, B4 — the picture itself is fetched lazily by
  // queueAvatarDownload, not applied as a plain value like the fields
  // above (there's nothing to assign synchronously but the hash/at pair,
  // and queueAvatarDownload already re-checks that against what's local)
  if(merged.lastWrite.picture !== undefined) queueAvatarDownload(client, uid, merged.lastWrite.picture).catch(() => {});

  applyPlaylists(merged.lastWrite.playlists, byIdentity);
  applyAlbumOrder(merged.lastWrite.albumOrder, byIdentity);
  applyOverlays(merged.overlays, byIdentity);
  applyCovers(merged.covers, byIdentity, client, uid);

  persistPending();
  // no direct renderTracks()/applyDiscVariant() import here on purpose:
  // library/view.js is the single most circularly-connected module in the
  // app (six sibling modules plus crate/view.js), and record-art/looks.js
  // reaches the exact same hub through its own circular pair with
  // history/sessions.js (sessions.js -> library/thumbs.js ->
  // library/edit.js -> library/view.js) — importing either from here
  // would mean every real dependent of *this* file could reach that whole
  // graph too. main.js already imports renderTracks for the boot
  // sequence, so it listens for this event and calls it (and, since the
  // current track's disc can't refresh itself from here, re-plays the
  // disc variant the same way any other track-list redraw already does)
  // instead — see initBackupSync() below and main.js's own wiring.
  emit('applied');
}

function applyLastWriteField(name, value, setter){
  if(value === undefined) return;
  setter(value);
}
function reattachArt(incoming, existingLocal){
  const out = {};
  Object.keys(incoming || {}).forEach(k => {
    const prevArt = existingLocal && existingLocal[k] && existingLocal[k].art;
    out[k] = prevArt ? Object.assign({}, incoming[k], { art: prevArt }) : incoming[k];
  });
  return out;
}
function applyPrefsPatch(rawPrefs){
  const parsed = parsePrefs(rawPrefs || {});
  // only the plain data fields that have no dedicated UI side effect of
  // their own are adopted here — applying every one of applyPrefs()'s UI
  // calls (setMode, bgUpdateUI, ...) on a background sync, mid-session,
  // would yank the screen out from under whatever the user is doing right
  // now. The ones with real UI/audio consequences stay this device's own
  // until the user actually changes them here, same as the B2 table's
  // "last write wins, per field" rule for prefs as a whole doc.
  if(parsed.shareStyle) S.shareStyle = parsed.shareStyle;
  if(parsed.shareFormat) S.shareFormat = parsed.shareFormat;
  if(parsed.librarySort) S.librarySort = parsed.librarySort;
  if(parsed.crateAnchor) S.crateAnchor = parsed.crateAnchor;
}

function applyPlaylists(value, byIdentity){
  if(value === undefined) return;
  const resolved = value.map(p => ({
    name: p.name, system: p.system,
    items: (p.items || []).map(key => {
      const t = byIdentity[key] || resolveIdentityKey(key, S.tracks);
      return t ? t.id : key;
    }),
  }));
  // anything still unresolved (an identity key, not a real local id — no
  // track with that identity exists on this device yet) is queued instead
  // of left sitting inside S.playlists, which the rest of the app assumes
  // only ever holds real file ids. It reconnects via reconcileImportedTrack
  // the moment a matching file is imported (step 06's "music re-added
  // later" requirement), the same "kept, not dropped" shape F3 already
  // established for a forgotten-but-not-deleted track's playlist entry.
  B.pending.playlistItems = [];
  resolved.forEach(p => {
    p.items = p.items.filter(idOrKey => {
      if(idxOf(idOrKey) >= 0 || !looksLikeIdentityKey(idOrKey)) return true;
      B.pending.playlistItems.push({ playlistName: p.name, identityKey: idOrKey });
      return false;
    });
  });
  S.playlists = resolved;
}
function applyAlbumOrder(value, byIdentity){
  if(value === undefined) return;
  const out = {};
  B.pending.albumOrderItems = [];
  Object.keys(value).forEach(album => {
    out[album] = value[album].map(key => {
      const t = byIdentity[key] || resolveIdentityKey(key, S.tracks);
      return t ? t.id : key;
    }).filter(idOrKey => {
      if(idxOf(idOrKey) >= 0 || !looksLikeIdentityKey(idOrKey)) return true;
      B.pending.albumOrderItems.push({ album, identityKey: idOrKey });
      return false;
    });
  });
  S.albumOrder = out;
}
// a real local id is "name|size|lastModified"; a trackIdentityKey (from
// util/text.js's normKey) never contains a pipe followed by a number the
// way a lastModified timestamp would, but the cheap, reliable tell is
// simpler: an id always has exactly two '|' separators with a numeric
// tail, an identity key's last segment is a normalized title, never pure
// digits. Checking idxOf() first (above) already resolves the common
// case; this is only the fallback for an id that isn't present *and*
// doesn't look like a file id either.
function looksLikeIdentityKey(s){
  const parts = String(s).split('|');
  return !(parts.length === 3 && /^\d+$/.test(parts[2]));
}

function applyOverlays(mergedOverlays, byIdentity){
  const pending = {};
  Object.keys(mergedOverlays).forEach(key => {
    const entry = mergedOverlays[key];
    const t = byIdentity[key] || resolveIdentityKey(key, S.tracks);
    if(!t){ pending[key] = entry; return; }
    applyOverlayToTrack(t, entry);
  });
  B.pending.overlays = pending;
}
function applyOverlayToTrack(t, entry){
  const i = idxOf(t.id);
  if(i < 0) return;
  if(entry.tombstone){
    overlaysRepo.put({ id: t.id, fields: null, reverted: true, revertedAt: entry.at }).catch(() => {});
    return;
  }
  overlaysRepo.get(t.id).then(existing => {
    // a local edit newer than the incoming one already wins locally
    // (loadOverlayFor() already applied it at boot) — only adopt the
    // remote fields when this device has nothing newer of its own
    if(existing && (existing.editedAt || 0) >= (entry.at || 0)) return;
    const merged = Object.assign({}, existing && existing.fields, entry.fields);
    overlaysRepo.put({ id: t.id, fields: merged, editedAt: entry.at }).then(() => {
      Object.assign(S.tracks[i].tags, entry.fields);
      emit('applied');
    });
  }).catch(() => {});
}

function applyCovers(coversMap, byIdentity, client, uid){
  if(!client) return;   // nothing to fetch from without a signed-in client
  const pending = {};
  Object.keys(coversMap || {}).forEach(key => {
    const entry = coversMap[key];
    const t = byIdentity[key] || resolveIdentityKey(key, S.tracks);
    if(!t){ pending[key] = entry; return; }
    queueCoverDownload(client, uid, t, entry).catch(() => {});
  });
  B.pending.covers = pending;
}

/* ================= reconciliation: a file is imported later ================= */
export function reconcileImportedTrack(t){
  const key = trackIdentityKey(t);
  const ov = B.pending.overlays[key];
  if(ov){
    delete B.pending.overlays[key];
    if(ov.tombstone){ /* nothing to apply — the embedded tags are already what shows */ }
    else { Object.assign(t.tags, ov.fields); overlaysRepo.put({ id: t.id, fields: ov.fields, editedAt: ov.at }).catch(() => {}); }
  }
  const cov = B.pending.covers[key];
  if(cov){
    delete B.pending.covers[key];
    const client = getClient();
    if(client){
      client.auth.getUser().then(({ data }) => {
        const uid = data && data.user && data.user.id;
        if(uid) queueCoverDownload(client, uid, t, cov).catch(() => {});
      }).catch(() => {});
    }
  }
  B.pending.playlistItems = B.pending.playlistItems.filter(entry => {
    if(entry.identityKey !== key) return true;
    const pl = S.playlists.find(p => p.name === entry.playlistName);
    if(pl && !pl.items.includes(t.id)) pl.items.push(t.id);
    return false;
  });
  B.pending.albumOrderItems = B.pending.albumOrderItems.filter(entry => {
    if(entry.identityKey !== key) return true;
    if(S.albumOrder[entry.album] && !S.albumOrder[entry.album].includes(t.id)) S.albumOrder[entry.album].push(t.id);
    return false;
  });
  persistPending();
}

/* ================= restore summary (first merge on this device) ================= */
function buildRestoreSummary(merged, ownLocal){
  const totalPlays = Object.values(merged.totals.counters.trackPlayCounts).reduce((a,b) => a+b, 0);
  const metals = Object.keys(merged.totals.achievements).length;
  const playlists = (merged.lastWrite.playlists || []).length;
  const ownTracks = Object.values(ownLocal.trackPlayCounts || {}).reduce((a,b) => a+b, 0);
  return { totalPlays, newPlays: Math.max(0, totalPlays - ownTracks), metals, playlists };
}

/* ================= the two entry points ================= */
let initedUserId = null;

async function pullAndMergeBackup(){
  const client = getClient();
  if(!client) return { ok:false };
  const { data } = await client.auth.getUser();
  const uid = data && data.user && data.user.id;
  if(!uid) return { ok:false };
  await ensureDeviceId();
  await restorePending();
  B.overlaysRawCache = await overlaysRepo.all();
  const ownLocal = buildLocalState();
  const remoteRows = await fetchRemoteRows(client);
  const merged = fromDocs(ownLocal, remoteRows);
  const firstTime = S.backupRestoredFor !== uid;
  await applyMerged(merged, ownLocal, client, uid);
  if(firstTime){
    S.backupRestoredFor = uid;
    await meta.put('backupRestoredFor', uid);
    emit('restored', buildRestoreSummary(merged, ownLocal));
  }
  await pushBackup();
  return { ok:true };
}

export function scheduleBackupSync(delay){
  const client = getClient();
  if(!client) return;
  clearTimeout(B.timer);
  B.timer = setTimeout(runPush, delay == null ? BACKUP_DEBOUNCE_MS : delay);
}
export function flushBackupSync(){
  clearTimeout(B.timer);
  runPush();
}
export function pullBackupOnForeground(){
  runPull();
}

async function runPush(){
  if(B.syncing){ B.again = true; return; }
  B.syncing = true;
  setStatus({ waiting: true });
  try{
    const r = await pushBackup();
    if(r.ok){
      B.backoffIdx = 0;
      setStatus({ backedUp: true, lastSyncedAt: Date.now(), waiting: false, lastError: null });
    } else {
      setStatus({ waiting: false });
    }
  }catch(e){
    const wait = BACKOFF[Math.min(B.backoffIdx++, BACKOFF.length - 1)];
    setStatus({ waiting: false, lastError: { message: (e && e.message) || String(e) } });
    clearTimeout(B.timer);
    B.timer = setTimeout(runPush, wait);
  }finally{
    B.syncing = false;
    if(B.again){ B.again = false; scheduleBackupSync(250); }
  }
}
async function runPull(){
  const client = getClient();
  if(!client) return;
  try{
    await pullAndMergeBackup();
    setStatus({ backedUp: true, lastSyncedAt: Date.now(), lastError: null });
  }catch(e){
    setStatus({ lastError: { message: (e && e.message) || String(e) } });
  }
}

/* ================= boot ================= */
export function initBackupSync(){
  const soc = getSocial();
  if(!soc || !soc.on) return;
  soc.on('status', s => {
    if(s.auth === 'ready'){
      getClient().auth.getUser().then(({ data }) => {
        const uid = data && data.user && data.user.id;
        if(uid && uid !== initedUserId){ initedUserId = uid; runPull(); }
      }).catch(() => {});
    } else if(s.auth === 'signedOut'){
      initedUserId = null;
      setStatus({ backedUp: false, lastSyncedAt: null, waiting: false, lastError: null });
    }
  });
  const now = soc.status();
  if(now.auth === 'ready'){
    getClient().auth.getUser().then(({ data }) => {
      const uid = data && data.user && data.user.id;
      if(uid){ initedUserId = uid; runPull(); }
    }).catch(() => {});
  }
}

export function getBackupStatus(){ return { ...B.status, deviceId: S.deviceId }; }

export async function listBackupDevices(){
  const client = getClient();
  if(!client) return [];
  await ensureDeviceId();
  const { data, error } = await client.from(SCHEMA_TABLE).select('device_id, device_label, updated_at');
  if(error || !data) return [];
  return data.map(r => ({
    deviceId: r.device_id, label: r.device_label || 'Unnamed device',
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null,
    isThisDevice: r.device_id === S.deviceId,
  })).sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/* ================= download my data ================= */
// Local data only — no account, no audio/images (step 06 spec point 5).
// Works fully signed out, which is why this lives separate from the
// account-fetching half below rather than one combined function.
export function collectLocalDownloadData(){
  const local = buildLocalState();
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    local: {
      playlists: local.playlists,
      albumOrder: local.albumOrder,
      albumSort: local.albumSort,
      albumLookPref: local.albumLookPref,
      prefs: local.prefs,
      profileName: local.profileName,
      trackPlayCounts: local.trackPlayCounts,
      // DA5 (docs/DAY_ARC.md) — the per-device counters behind the
      // listening-rhythm card (src/profile/rhythm-card.js), same class of
      // local data as trackPlayCounts just above
      phasePlayCounts: local.phasePlayCounts,
      albumPhaseCounts: local.albumPhaseCounts,
      sessionCounts: local.sessionCounts,
      metalEligibleSessions: local.metalEligibleSessions,
      trackMetalEligiblePlays: local.trackMetalEligiblePlays,
      trackLastPlayed: local.trackLastPlayed,
      albumLastPlayed: local.albumLastPlayed,
      rareUnlocked: local.rareUnlocked,
      achievements: local.achievements,
      collection: local.collection,
      sealedIds: local.sealedIds,
      historyClearedAt: local.historyClearedAt,
      overlays: local.overlaysRaw,
    },
  };
}
export async function collectDownloadData(){
  const out = collectLocalDownloadData();
  const client = getClient();
  if(!client) return out;
  const { data: userData } = await client.auth.getUser();
  const uid = userData && userData.user && userData.user.id;
  if(!uid) return out;
  const soc = getSocial();
  const [profileRes, cratePage, followingRes, diggingRes, backupRows] = await Promise.all([
    soc.getMyProfile(),
    soc.crate(uid, { limit: 500 }),
    soc.listFollowing(),
    soc.listDigging(),
    client.from(SCHEMA_TABLE).select('device_id, device_label, schema_version, updated_at'),
  ]);
  out.account = {
    email: userData.user.email || null,
    profile: profileRes.ok ? profileRes.profile : null,
    crate: cratePage.ok ? cratePage.items : [],
    following: followingRes.ok ? followingRes.following : [],
    diggingList: diggingRes.ok ? diggingRes.items : [],
    backupDevices: (backupRows && backupRows.data) || [],
  };
  return out;
}
