/* ================= social layer config =================
   Empty strings mean inert: MizikiSocial.init() leaves enabled:false and
   every screen that needs a server shows a calm "not set up yet" state (or
   hides). Step 04 of the backup/account-system plan (docs/SUPABASE_SETUP.md)
   fills these in once the project and its migrations exist — the anon key
   is safe in client code, RLS is the actual protection.
   SOCIAL_SUPABASE_ANON_KEY keeps its old name, but as of step 04 it holds
   Supabase's newer *publishable* key (sb_publishable_…, Settings -> API
   Keys), not the legacy JWT-shaped anon key Supabase is retiring at the
   end of 2026 — never the secret key (sb_secret_…), which must never be
   in client code or this repo at all. */
export const SOCIAL_SUPABASE_URL = 'https://yeyeprzdlbyacisfftjp.supabase.co';
export const SOCIAL_SUPABASE_ANON_KEY = 'sb_publishable_g7Ywv3lxDfwqxuAyCUSojg_wXd9Csnv';

export const S = {
  ctx:null, nodes:null, source:null, gen:0,
  tracks:[], index:-1, playing:false, pos:0, rate:1,
  baseQueue:[], queue:[], qpos:0, shuffle:false, repeat:'off',
  playlists:[], view:{mode:'songs', group:null, artistAlbum:null, playlist:null, person:null, personReturn:null,
    crateLooseIdx:null, crateLooseArtist:null, picking:false, editSelecting:false},
  editSelection: new Set(),
  albumSort:{}, albumOrder:{}, lru:[], librarySort:'artist',
  mode:'vinyl', auto:true, manualRate:1, target:0.80, pace:'window',
  previewMin:0, live:true,
  // DA1 (docs/DAY_ARC.md): dawn/rise/noon alongside the original set/dusk
  // — dayPosition() (src/sundown/day.js) reads all five, plus
  // altitudeAtNoon (used only for the polar-day/polar-night fallback when
  // the other four come back null). computeSun()/fallbackSun() fill all
  // six whenever ok is set true.
  sun:{lat:null,lon:null,dawn:null,rise:null,noon:null,set:null,dusk:null,altitudeAtNoon:null,ok:false},
  // DA2 (docs/DAY_ARC.md): 'off'/'subtle'/'full' — how much Vinyl's own
  // character drifts off the user's own midday-baseline sliders across the
  // day (src/sundown/drift.js's driftOffsets()/effectiveChar(), applied in
  // src/audio/engine.js's applyCharacter()). Default 'subtle' per the
  // doc's own instruction; a saved prefs object from before DA2 has no
  // such field, and a missing value means Subtle, the same "missing means
  // the stated default" shape S.char.scratch (F2) already established.
  charDrift:'subtle',
  motion:{on:false,watch:null,speed:null,max:25,floor:0.55,factor:1},
  // scratch: true means spin-to-scrub plays real audio while spinning the
  // disc by hand in Vinyl (F2) — a missing saved value must mean On, so the
  // default here is what back-fills prefs saved before this field existed
  char:{wow:0.30,sat:0.35,soft:0.40,comp:0.35,scratch:true},
  angle:0,
  // record art + session tracking (see spec)
  sessions:{}, sessionCounts:{}, rareUnlocked:{}, sessionActive:null,
  curPlayed:[], curTrackDone:false,
  // metal tiers (see spec) — a separate counter from sessionCounts, keyed by
  // trackIdentityKey(). trackPlayCounts/sessionCounts are the true lifetime
  // totals (used for Top Songs, rare-variant progress, collection discovery);
  // the *MetalEligible* counters are a tier-1-only shadow of the same totals
  // that stops advancing once a track/album is no longer tier 1, so a
  // tier-upgrade re-import can't silently keep climbing the metal ladder —
  // see METAL spec §2, grandfathered metals.
  trackPlayCounts:{}, trackMetalEligiblePlays:{}, metalEligibleSessions:{},
  // per-album choice among whatever looks are currently available (rare /
  // metal / format variant) — see METAL spec §5, variant switching
  albumLookPref:{},
  // navigation / player shell (see spec)
  route:'library', playerOpen:false, shellAlbumId:null,
  outgoingArt:null, outgoingHasArt:false, pendingShellInfo:null,
  sleeveSeq:0, sleevePullEnabled:true,
  // true once a put-away sequence completes (or is snapped to its end) —
  // not persisted; on reload the app restores the last track as it does today
  platterEmpty:false, spinDown:null,
  // metadata editing (see spec)
  editTarget:null, editArtBlob:null, editOriginal:null, lastUndo:null, undoTimer:null,
  // profile tab (see spec)
  // pictureHash: step 07 (B4) — the re-encoded hash this device last
  // uploaded for the profile picture / public avatar; null until the
  // first successful re-encode (upload itself may still be pending)
  profile:{name:'', username:'', art:null, artBlob:null, pictureHash:null},
  albumLastPlayed:{}, trackLastPlayed:{}, albumDisplay:{}, trackDisplay:{},
  achievements:{}, collection:{}, albumEdge:{},
  // DA6 (docs/DAY_ARC.md): `rhythm` is the My Crate card's own Include
  // toggle for the listening-rhythm verdict line -- same session-only
  // shape (never saved to prefs/backup) as its four siblings here.
  profileView:{screen:'home'}, shareSelection:{albums:true, songs:true, metals:true, collection:true, name:true, rhythm:true},
  // DA6: the Now Playing card's own one Include toggle ("Time of day" ->
  // the "Spun at dusk" line) -- a separate object from shareSelection
  // above since the two sheets' own section lists are otherwise
  // unrelated, the same way shareSelection itself never applied to the
  // player card before this step. Session-only, same as shareSelection.
  playerShareSelection:{phase:true},
  // Part 2 §2: remembered across both share sheets; format's own per-type
  // default (story for Now Playing, square for Crate) only applies the very
  // first time, before either sheet has ever set a preference
  shareStyle:'night', shareFormat:null,
  // sleep timer — session-only, never persisted (see SLEEP spec §5)
  sleep:{mode:null, at:null, timer:null, fading:false}
};

export function current(){ return S.tracks[S.index] || null; }

// one last-write timestamp per backed-up field that's otherwise just a
// bare value (step 06, B3 — see the matching S.backupUpdatedAt default
// near the bottom of this file for which fields and why). Lives here, not
// in storage/meta.js, deliberately: state.js is the one module every one
// of this function's callers (library/view.js, library/favorites.js,
// library/delete.js, library/thumbs.js, history/sessions.js,
// profile/screens.js, storage/meta.js itself) already imports for `S`
// anyway, so this adds zero new real-module dependencies to any of them —
// putting it in storage/meta.js instead would have made every one of
// those modules (several of them widely depended-on themselves) reach
// meta.js's own much larger chain (audio/mode.js, sundown/location.js,
// player/controls.js, player/background.js, launch/intro.js,
// sync/backup.js) just to stamp a timestamp.
export function touchBackupField(name){
  if(S.backupUpdatedAt) S.backupUpdatedAt[name] = Date.now();
}
// Background playback (optional, off by default) — see the section below
S.bgAudio = false;
S.bg = {el:null, failed:false, swapping:false, idleTimer:null, silentURL:null, handlers:false, msKey:''};
// Launch intro (cold start only, on by default) — see the launch sequence section
S.launchSeq = 0;
S.launchIntro = true;
// Crate view: a second way to browse the library, beside the list (see
// CRATE spec). libraryLayout/crateGroup/crateAnchor are persisted prefs;
// `crate` itself is session-only render/gesture state, rebuilt on demand.
// Crate is the default for new and existing users alike — only an
// explicitly saved 'list' keeps the list (see CRATE spec §7/addendum).
S.libraryLayout = 'crate';
S.view.mode = 'crate';
S.crateGroup = 'az';
S.crateAnchor = null;
// gatefold spec §A5: off by default, saved like the other library-tools prefs
S.albumSides = false;
// SEALED spec §2/§3 — albums imported after this feature ships stay
// shrink-wrapped until first played; the set itself is independent of
// listening history so "Clear listening history" never reseals anything
S.sealed = new Set();
S.sealedRecords = true;
// Part 2 §1: the gatefold-to-player hand-off, on by default — off keeps a
// gatefold track tap entirely in the mini player, no flight, no sheet
S.playInFullPlayer = true;
// pos stays null until first resolved — see renderCrate()'s cold-start
// anchor logic (last-played album wins once, crateAnchor from then on)
S.crate = {pos:null, model:null, modelGroup:null, modelDirty:true, coldStartDone:false};
// true while the #scrub time slider is being dragged, so drawTime() doesn't
// fight the user's own input value (step 3c — was a top-level let in main.js)
S.scrubbing = false;

// D2 (docs/DESKTOP_LAYOUT.md): one of 'auto'/'light'/'dark'. Auto is the
// default for new installs, and a saved prefs object without this field
// (every device before D2) also loads as Auto — the doc's own stated
// default for both open questions it left to a default. Saved alongside
// the rest of prefs (src/storage/prefs.js) but deliberately excluded from
// the account backup doc (src/sync/backup.js's buildLocalState() strips
// it before upload) — an appearance choice is device-only by the same
// doc's own default, not something that should follow the account to a
// different device the way the rest of `prefs` does.
S.theme = 'auto';

/* ================= account backup (step 06, B3) =================
   Local state the merge logic (src/sync/merge.js, src/sync/backup-doc.js,
   step 03) needs but nothing wrote yet, per that step's own "doesn't exist
   locally yet" list — now written by src/sync/backup.js and the small
   touch-site edits across library/history/profile this step adds. None of
   this is read unless signed in; see src/sync/backup.js's own header. */
S.deviceId = null;
S.deviceLabel = null;
// bumped only by a *full*-scope "Clear listening history" (never the
// orphaned-only scope) — see history/clear.js and CLAUDE.md's backup table
S.historyClearedAt = 0;
// a durable "ever broken" record per album, independent of S.sealed itself
// (which only ever records "still sealed") — see library/sealed.js
S.sealedBroken = new Set();
// one last-write timestamp per backed-up field that's otherwise just a
// last-value with no timestamp of its own — see storage/meta.js's
// touchBackupField() and every call site that calls it
S.backupUpdatedAt = {
  playlists:0, albumOrder:0, albumSort:0, albumDisplay:0, trackDisplay:0,
  albumEdge:0, albumLookPref:0, prefs:0, profileName:0,
  picture:0,   // step 07, B4 — the profile picture / public avatar
};
// the account id this device has already merged a backup restore for —
// null until the first successful merge, so the one-time "Restored..."
// summary shows exactly once per account per device
S.backupRestoredFor = null;

/* ================= DA5 (docs/DAY_ARC.md) — listening rhythm =================
   Every counted play (checkTrackCompletion -> incrementTrackPlay,
   src/history/played.js) also tallies which day-arc phase it happened in,
   using the real clock -- never S.previewMin -- so dragging Preview the
   day can never create or change a stat (see sundown/solar.js's
   realDayPosition(), the one place this distinction is enforced).
   phasePlayCounts is a flat {phase: count} map, the same per-device-
   counter shape as trackPlayCounts; albumPhaseCounts is keyed by
   albumKey() same as sessionCounts/albumLastPlayed, one {phase: count}
   map per album -- both are "per-device counters: summed across
   devices" in the backup key-inventory table (CLAUDE.md), the exact same
   merge rule trackPlayCounts already has. Persisted by the matching
   persist-and-restore functions in history/sessions.js, written by
   history/played.js, reset by a full-scope Clear listening history,
   pruned (albumPhaseCounts only -- phasePlayCounts has no per-identity
   shape to prune by) on an orphaned-only clear, and left alone by Forget
   library (F3) like every other history counter. */
S.phasePlayCounts = {};
S.albumPhaseCounts = {};
// device-only sync bookkeeping -- the last time this device actually
// pushed a listening-rhythm snapshot to the account (src/sync/backup.js's
// pushBackup(), "updated at most daily" per the doc) -- never itself
// backed up or shown to the user, the same class of local-only timestamp
// as uploadedImageHashes in backup.js.
S.rhythmPushedAt = 0;
