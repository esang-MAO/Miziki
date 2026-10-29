/* ================= social layer config =================
   Empty strings mean inert: MizikiSocial.init() leaves enabled:false and
   every screen that needs a server shows a calm "not set up yet" state (or
   hides). Step 04 of the backup/account-system plan (docs/SUPABASE_SETUP.md)
   fills these in once the project and its migrations exist — the anon key
   is safe in client code, RLS is the actual protection.
   SOCIAL_SUPABASE_ANON_KEY keeps its old name, but holds Supabase's newer
   *publishable* key (sb_publishable_…, Settings -> API Keys), not the
   legacy JWT-shaped anon key Supabase is retiring at the end of 2026 —
   never the secret key (sb_secret_…), which must never be in client code
   or this repo at all. */
export const SOCIAL_SUPABASE_URL = 'https://yeyeprzdlbyacisfftjp.supabase.co';
export const SOCIAL_SUPABASE_ANON_KEY = 'sb_publishable_g7Ywv3lxDfwqxuAyCUSojg_wXd9Csnv';

export const S = {
  ctx:null, nodes:null, source:null, gen:0,
  tracks:[], index:-1, playing:false, pos:0, rate:1,
  // RF15 (docs/12_REFINE.md): the platter label's mono arc text is built
  // from two pieces that change at different rates — the RPM (every
  // drawSun() tick, src/player/clock.js, since Sundown keeps it moving)
  // and the side/channel words (fixed per track, set once at load() time,
  // src/player/transport.js). This is the static half, cached here so
  // clock.js's tick doesn't need to re-derive it every ~220ms. Runtime
  // only — never saved, never a prefs field.
  labelSideFormat:'STEREO',
  // AU9 (docs/16_AUDIO.md §5): the currently-loaded record's own physical
  // format, computed by record-art/format.js's albumFormatFor() and cached
  // here once per track load (player/transport.js's load()) so the audio
  // graph (audio/engine.js's wowHzFor()/applyCharacter()) and the surface-
  // noise/run-out code (audio/surface-noise.js, shell/runout.js,
  // player/queue.js) all read the one same value rather than each
  // recomputing it. Runtime only -- never saved, never a prefs field,
  // the same shape as labelSideFormat just above.
  recordFormat:{size:'12"', speed:33.333},
  // AU10 (docs/16_AUDIO.md §5): "from 0 to 600ms the platter eases up to
  // the new speed" -- set by player/transport.js's load() only when the
  // player is open and the speed actually changed; null means "no ease in
  // progress, just render S.recordFormat.speed" (player/clock.js's frame()
  // reads it). Runtime only -- never saved, never a prefs field.
  rpmEase:null,
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
  // AU5 (docs/16_AUDIO.md §4): Off/Track/Album/Auto — a missing saved value
  // means Auto, the doc's own stated default.
  loudnessMode:'auto',
  // AU6 (docs/16_AUDIO.md §3): the EQ sheet's whole saved state — off by
  // default (flat, tilt 0, every graphic/parametric band at 0 dB), auto
  // preamp on. state.js stays import-free (it's the foundation every
  // other module imports from, never the reverse), so this literal is a
  // plain duplicate of src/audio/eq.js's own defaultEqState() rather than
  // an import of it — kept in sync by hand, the same "duplicate rather
  // than add an edge" call sync/images.js/player/clock.js already make
  // elsewhere in this codebase. A saved object missing the field entirely
  // (every device before this PR) loads with the EQ off and flat, same
  // "missing means the stated default" shape loudnessMode/charDrift/
  // autoFlip already established.
  eq: {
    enabled: false, mode: 'graphic', tilt: 0,
    graphicBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    parametricBands: [], autoPreamp: true, preampDb: 0, savedPresets: {},
  },
  // AU7 (docs/16_AUDIO.md §6): "a Mono switch that sends (L+R)/2 to both
  // sides, and a constant-power L/R balance" — both apply in the shared
  // output stage (audio/engine.js's applyMonoBalance()), after the EQ
  // bands and before the limiter, regardless of Pure or Vinyl. A missing
  // saved value means off/centered, the same "missing means the stated
  // default" shape loudnessMode/eq already established.
  mono: false, balance: 0,
  // AU7 §6: "Volume slider on desktop only, after the limiter, saved per
  // device. Phones keep the system volume." Device-only like S.theme
  // (stripped from the uploaded copy of prefs, sync/backup.js's own
  // buildLocalState()) — a desktop volume choice has no reason to follow
  // the account to a phone, which never shows the control at all.
  deviceVolume: 1,
  // scratch: true means spin-to-scrub plays real audio while spinning the
  // disc by hand in Vinyl (F2) — a missing saved value must mean On, so the
  // default here is what back-fills prefs saved before this field existed
  char:{wow:0.30,sat:0.35,soft:0.40,comp:0.35,scratch:true},
  angle:0,
  // Surface Noise & Vinyl Ritual (docs/15_SURFACE_NOISE.md §1): the lead-in/
  // run-out noise floor, the run-out's own length, and whether a faint bed
  // sits under playback. Defaults per that doc's own settings table —
  // Subtle for new users, Normal run-out, under-the-music off.
  surfaceNoise:'subtle', runoutLength:'normal', surfaceNoiseUnderMusic:false,
  // docs/15_SURFACE_NOISE.md §4: On (default) keeps today's behavior --
  // the record flips itself at the end of side A. Off leaves it waiting in
  // the run-out for the user to flip it (see shell/runout.js's runSideWait()).
  autoFlip:true,
  // runtime only, never saved: whether the track load() just landed on is
  // the first track of its side (so play() knows to run the needle-drop +
  // lead-in).
  pendingSideStart:false,
  // PL2 (docs/19_PLAYER.md, "one clock"): the single source of truth for
  // playback position — { ctxTime, offset, rate }, set whenever a source
  // starts or replaces another (startSource(), play()'s gapless-adoption
  // branch, seek()'s replace-source path) and whenever S.rate itself
  // changes (player/clock.js's tick(), the one place that happens).
  // Position is always derived from this, never accumulated:
  // player/clock.js's currentPos() reads it directly, replacing both the
  // old per-tick `S.pos += dt * S.rate` and S.openUntil's wall-clock
  // lead-in deadline (before anchor.ctxTime on the audio clock, position
  // reads 0). null until the first source ever starts. Runtime only,
  // never saved.
  anchor:null,
  // PL4 (docs/19_PLAYER.md, "interruptions and coming back"): true from the
  // moment player/transport.js's handleContextInterruption() freezes
  // playback because S.ctx left 'running' (a call, Siri, another app
  // taking the audio session) until play() next actually resumes — tells
  // the resume paths this is a system pause to restart from, not an
  // ordinary one with nothing pending. Runtime only, never saved — a fresh
  // launch has no interruption to remember.
  pausedBySystem:false,
  // AU1 (docs/16_AUDIO.md §2.1): true from the moment restoreResume()
  // (src/player/resume.js) lands a paused record on launch until Play is
  // first pressed (player/transport.js's play() clears it) — the one
  // flag the mini player reads to show "PAUSED AT m:ss OF m:ss" instead
  // of the artist line. Runtime only, never saved.
  resumePending:false,
  // record art + session tracking (see spec)
  sessions:{}, sessionCounts:{}, rareUnlocked:{}, sessionActive:null,
  curPlayed:[], curTrackDone:false,
  // PRESSINGS_110 PR7 (docs/PRESSINGS_110.md §5/§8): the zoetrope milestone
  // pool — its own counter and its own pool, separate from rareUnlocked
  // right above (§8, point 2: "Zoetropes get their own session
  // milestones"). zoetropeUnlocked is {albumId: true}, the exact same
  // union-of-flags shape as rareUnlocked, backed up the same way.
  // zoetropeDayProgress is {albumId: [dayKey, ...]}, the distinct local-
  // calendar days (sundown/rhythm.js's dayKeyFor()) a full, in-order,
  // every-side play-through has completed on for that album — earns the
  // zoetrope once ZOETROPE_DAYS_TO_EARN different days are recorded (10,
  // history/sessions.js). Also backed up (§8: "store earned zoetropes and
  // day-progress with the account backup") so progress isn't stranded on
  // one device.
  zoetropeUnlocked:{}, zoetropeDayProgress:{},
  // "Include an option in the settings to turn off zoetropes earned." A
  // saved boolean, same persisted-setting shape as paperLabelOnLossy
  // (docs/13_CRATE.md CR7) — default true (every
  // device before this PR loads as on, the long-standing behavior).
  // Turning it off stops awarding new zoetropes (history/sessions.js's
  // sessionTrackComplete() skips checkZoetropeUnlock() entirely, so
  // zoetropeDayProgress/zoetropeUnlocked are frozen, not reset) and stops
  // offering an already-earned one as the active look
  // (record-art/looks.js's availableLooks() stops pushing 'zoetrope',
  // which falls through resolveLook()'s existing rare/metal/variant
  // precedence with no further change needed there).
  zoetropesEnabled:true,
  // The frame count of whichever zoetrope is currently showing on the
  // platter, or null when none is. Runtime only — never saved, never a
  // prefs field, the same posture as recordFormat/labelSideFormat/rpmEase
  // above. Set by record-art/looks.js's applyDiscVariant() and read every
  // tick by player/clock.js's frame() to drive the quantized frame-ring
  // overlay (record-art/zoetrope-motion.js's zoetropeRingAngleDeg()).
  zoetropeFrameCount:null,
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
  // AU9 (docs/16_AUDIO.md §5): the personal per-album format override —
  // 'auto' (the default, read the format table), '33' (always a 12" at
  // 33⅓) or '45' (45, sized by the table). Backed up/synced per-key, the
  // same last-write-wins shape as albumSort/albumLookPref just above —
  // "the override is personal: it syncs in your backup, but friends see
  // the automatic format" (AU11's own territory, not this field).
  albumFormat:{},
  // navigation / player shell (see spec)
  route:'library', playerOpen:false, shellAlbumId:null,
  outgoingArt:null, outgoingHasArt:false, pendingShellInfo:null,
  sleeveSeq:0, sleevePullEnabled:true,
  // true once a put-away sequence completes (or is snapped to its end) —
  // not persisted; on reload the app restores the last track as it does today
  platterEmpty:false, spinDown:null,
  runout:null,   // CEREMONY §2/§3: the run-out groove or side flip in flight (shell/runout.js) — runtime only, never saved
  // metadata editing (see spec)
  editTarget:null, editArtBlob:null, editOriginal:null, lastUndo:null, undoTimer:null,
  // AU8 (docs/16_AUDIO.md §6): a single snapshot of {baseQueue, queue,
  // qpos} taken right before "Clear upcoming" or removing one queue row,
  // so Undo can restore it verbatim -- runtime-only, never saved, same
  // class of state as lastUndo/undoTimer just above (a second, parallel
  // undo slot rather than reusing lastUndo's own {trackIds, prevOverlays,
  // prevArt} shape, which is specific to track-edit undo).
  queueUndo:null, queueUndoTimer:null,
  // profile tab (see spec)
  // pictureHash: step 07 (B4) — the re-encoded hash this device last
  // uploaded for the profile picture / public avatar; null until the
  // first successful re-encode (upload itself may still be pending)
  profile:{name:'', username:'', art:null, artBlob:null, pictureHash:null},
  albumLastPlayed:{}, trackLastPlayed:{}, albumDisplay:{}, trackDisplay:{},
  achievements:{}, collection:{}, albumEdge:{},
  profileView:{screen:'home', recordsFilter:'all'},
  // SH1 (docs/18_SHARE.md): one sheet, five cards -- Include toggles are
  // per card now (`shareSelectionByCard`), replacing the old shareSelection/
  // playerShareSelection pair. SH5 removed crate-card.js's metals/
  // collection/rhythm sections outright, so `crate` now only ever holds
  // the one key the sheet shows it a toggle for, per SH1 item 3's own
  // Include-toggle table. Session-only, never saved to prefs/backup,
  // same as before this step.
  shareSelectionByCard:{
    nowPlaying:{phase:true},
    record:{note:true, friends:true},
    pressings:{},
    crate:{name:true},
    season:{name:true},
  },
  // Part 2 §2 / SH1 item 2: each card remembers its own format choice,
  // replacing the single shareFormat -- a per-card default (README table)
  // only applies the very first time, before that card's own sheet open
  // has ever set a preference.
  shareStyle:'night',
  shareFormatByCard:{nowPlaying:'story', record:'square', pressings:'story', crate:'square', season:'square'},
  // sleep timer — session-only, never persisted (see SLEEP spec §5)
  sleep:{mode:null, at:null, timer:null, fading:false},
  // RF21 (docs/12_REFINE.md, "a quieter broadcast"): "Don't share this
  // session" in the player's own "···" menu. Session-only, like `sleep`
  // above — never saved to prefs/backup, so it never follows to a new
  // tab/device and is always off at a fresh launch. While true,
  // player/transport.js's play() skips the MizikiSocial.nowSpinning() call
  // outright (no feed event, no "now spinning" row at all, not merely a
  // hidden one) and shell/runout.js's clearToRest() clears it back to
  // false once the queue genuinely ends, so it never silently stays on
  // for a later, different listening session.
  privateSpin:false
};

export function current(){ return S.tracks[S.index] || null; }

// one last-write stamp per backed-up field that's otherwise just a bare
// value (step 06, B3 — see the matching S.backupUpdatedAt default near the
// bottom of this file for which fields and why). Lives here, not in
// storage/meta.js, deliberately: state.js is the one module every one of
// this function's callers (library/view.js, library/favorites.js,
// library/delete.js, library/thumbs.js, history/sessions.js,
// profile/screens.js, storage/meta.js itself) already imports for `S`
// anyway, so this adds zero new real-module dependencies to any of them —
// putting it in storage/meta.js instead would have made every one of
// those modules (several of them widely depended-on themselves) reach
// meta.js's own much larger chain (audio/mode.js, sundown/location.js,
// player/controls.js, player/background.js, launch/intro.js,
// sync/backup.js) just to stamp a timestamp.
//
// RF16 (docs/12_REFINE.md, "edits that know what they've seen"): a plain
// Date.now() stamp alone can't tell two devices' edits apart correctly
// when one device's clock runs slow — a device that pulls another's newer
// edit and then makes its own, later, edit could still lose to it on the
// next merge if its clock reads earlier. S.backupSeq is a Lamport counter
// fixing that: touchBackupField() always increments it first, so any edit
// made *after* this device has seen another device's stamp (which bumps
// backupSeq to at least that stamp's own seq — see sync/backup.js's pull
// path) is guaranteed a strictly higher seq than what it saw, regardless
// of either device's wall clock. `at` stays only as the tie-break for two
// edits that never saw each other (src/sync/merge.js's lastWriteWins).
export function touchBackupField(name){
  if(!S.backupUpdatedAt) return;
  S.backupSeq = (S.backupSeq || 0) + 1;
  S.backupUpdatedAt[name] = { seq: S.backupSeq, at: Date.now() };
}

// RF17 (docs/12_REFINE.md, "merge per item, not per blob"): the per-key
// twin of touchBackupField() above, for the fields that no longer carry
// one stamp for the whole value but one stamp per entry (albumOrder,
// albumSort, albumDisplay, trackDisplay, albumEdge, albumLookPref,
// playlistDefs, playlistOrder — each S.backupUpdatedAt[name] is now a map
// {key: {seq, at}}, not a single stamp) — so a change to one album/
// playlist never bumps, or competes on merge with, every other album's
// own last-touched stamp. prefs is touched this way too, but not by any UI
// call site directly — storage/meta.js's saveMeta() diffs the new prefs
// blob against the last-saved one and calls this once per pref key that
// actually changed, which is what gives prefs real per-key granularity
// without a touch call at every individual settings control.
export function touchBackupKey(name, key){
  if(!S.backupUpdatedAt) return;
  const map = S.backupUpdatedAt[name] || (S.backupUpdatedAt[name] = {});
  S.backupSeq = (S.backupSeq || 0) + 1;
  map[key] = { seq: S.backupSeq, at: Date.now() };
}

// RF17: playlist membership is an add-wins set, not a last-write-wins
// value — hearting track X on one offline device and track Y on another
// must keep both once they sync, which a single per-playlist stamp (the
// old touchBackupField('playlists')) could never guarantee if the two
// edits raced for the same whole-field stamp. Each (playlist, local track
// id) pair gets its own {added, removed} pair of stamps, keyed by
// 'playlistName\u0000localId' — identity-key conversion (the portable key
// a cross-device merge actually compares) happens only at toDoc() time,
// same as every other local-id list in this app (see backup-doc.js's own
// header). kind is 'added' or 'removed'.
export function touchBackupMembership(playlistName, localId, kind){
  if(!S.playlistMembershipAt) return;
  const mapKey = playlistName + '\u0000' + localId;
  const entry = S.playlistMembershipAt[mapKey] || (S.playlistMembershipAt[mapKey] = { added: null, removed: null });
  S.backupSeq = (S.backupSeq || 0) + 1;
  entry[kind] = { seq: S.backupSeq, at: Date.now() };
}
// Background playback (optional, off by default) — see the section below
S.bgAudio = false;
S.bg = {el:null, failed:false, swapping:false, idleTimer:null, silentURL:null, handlers:false, msKey:'', awaitingReturnOffer:false};
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
// anchor logic (last-played album wins once, crateAnchor from then on).
// pendingJumpKey (CR10, docs/13_CRATE.md point 3): a bin/letter/genre/decade
// key set just before switching to the crate view, so renderCrate() jumps
// straight there on mount instead of resolving the usual cold-start/anchor
// position — set by the desktop sidebar's BINS list (src/shell/sidebar.js),
// consumed and cleared by renderCrate() itself on its very next render.
// pendingJumpVariant (CR11, docs/13_CRATE.md point 3): the same one-shot
// shape, for "tapping a chip jumps the crate to the first record in that
// pressing" — a VARIANT_DEFS id rather than a divider key, resolved by a
// separate crateVariantJumpTarget() scan (crate/model.js) since a
// pressing isn't one of the model's own divider jump targets. Set by the
// profile's pressing chart (src/profile/screens.js).
// sectionPos (CR14, docs/14_CRATE_SECTIONS.md PR 2): the position left off
// on inside each side-by-side section, keyed by that section's own `key`
// (model.sections[].key) — session-only, like `pos` itself, rebuilt from
// scratch every time the model is. Restored on returning to a section;
// the A–Z section's own first visit still uses the cold-start/anchor logic
// above instead of this map (nothing to restore there yet).
S.crate = {pos:null, model:null, modelGroup:null, modelDirty:true, coldStartDone:false, pendingJumpKey:null, pendingJumpVariant:null, sectionPos:{}};
// true while the #scrub time slider is being dragged, so drawTime() doesn't
// fight the user's own input value
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

// CEREMONY §6: the custom slipmat. Only these flags are prefs; the image
// itself lives in the artwork store (src/ui/slipmat.js). Device-only, like
// theme: stripped from the uploaded prefs in src/sync/backup.js.
S.slipmatCustom = false;
S.slipmatWordmark = true;
S.slipmatDim = true;

// "Decided" (docs/13_CRATE.md, CR7): the platter label on a lossy (tier-1,
// Jet) record — paper (#EFE9DF, olive ring) when on, amber everywhere
// else. Off by default. An ordinary playback pref — rides inside `prefs`
// with no carve-out, unlike `theme`/the slipmat flags above.
S.paperLabelOnLossy = false;

// TY5 (docs/22_TYPE.md): Settings → Appearance's "Larger text" switch —
// multiplies the six TY1 --fs-* tokens by 1.15 (src/ui/theme.js's
// applyLargerText(), src/styles/00-base.css's :root.larger-text block).
// A readability need, not a look, so unlike `theme` it rides inside
// `prefs` with no device-only carve-out — it should follow the account.
S.largerText = false;

/* ================= account backup (step 06, B3) =================
   Local state the merge logic (src/sync/merge.js, src/sync/backup-doc.js,
   step 03) needs but nothing wrote yet, per that step's own "doesn't exist
   locally yet" list — now written by src/sync/backup.js and the small
   touch-site edits across library/history/profile this step adds. None of
   this is read unless signed in; see src/sync/backup.js's own header. */
S.deviceId = null;
S.deviceLabel = null;
// RF16 (docs/12_REFINE.md, "edits that know what they've seen") — a Lamport
// logical clock, device-only like deviceId/deviceLabel (never backed up,
// never part of prefs). touchBackupField() (this file) always increments it
// before stamping a field; src/sync/backup.js's pull path bumps it to the
// max of itself and every seq it sees in a remote row, so an edit made after
// observing another device's stamp is guaranteed a strictly higher seq than
// that stamp, regardless of either device's wall clock. Restored from meta
// the same way deviceId is (src/sync/backup.js's ensureDeviceId()).
S.backupSeq = 0;
// RF18 (docs/12_REFINE.md, "pushes that can't go backwards") — a separate,
// much simpler counter from S.backupSeq above: a plain per-device push
// attempt number, bumped once at the start of every pushBackup() call
// (src/sync/backup.js) and persisted immediately (not debounced), so a
// stale, slow-to-land push (a retry after backoff, or two overlapping
// upload attempts) can never clobber a push this same device already
// landed more recently — see migration 013_backup_seq.sql's
// put_library_backup() RPC, which only accepts a row whose doc_seq is
// strictly higher than what's already stored. Device-only, never backed
// up, never part of prefs — it's row-ordering bookkeeping for this
// device's own uploads, not a field-level edit timestamp the way
// S.backupSeq's stamps are.
S.backupPushSeq = 0;
// bumped only by a *full*-scope "Clear listening history" (never the
// orphaned-only scope) — see history/clear.js and CLAUDE.md's backup table
S.historyClearedAt = 0;
// a durable "ever broken" record per album, independent of S.sealed itself
// (which only ever records "still sealed") — see library/sealed.js
S.sealedBroken = new Set();
// one last-write stamp per backed-up field that's otherwise just a
// last-value with no stamp of its own — see state.js's touchBackupField()
// and every call site that calls it. Since RF16, each value this function
// itself writes is {seq, at}, not a bare number — the 0 default here is only
// ever read by lastWriteWins()'s own "no entry yet" fallback (src/sync/
// merge.js), which treats a falsy entry as absent regardless of shape.
//
// RF17 (docs/12_REFINE.md): profileName/picture are the only two fields
// left with a single whole-value stamp — everything else here is now a
// *map* of per-key stamps ({} default, not 0), touched by touchBackupKey()
// above rather than touchBackupField(). playlists itself is gone from this
// object entirely, replaced by playlistDefs/playlistOrder (per-playlist-
// name stamps, same map shape) plus S.playlistMembershipAt below (a
// different shape again — see touchBackupMembership()'s own comment).
S.backupUpdatedAt = {
  albumOrder:{}, albumSort:{}, albumDisplay:{}, trackDisplay:{},
  albumEdge:{}, albumLookPref:{}, albumFormat:{}, prefs:{},
  playlistDefs:{}, playlistOrder:{},
  profileName:0,
  picture:0,   // step 07, B4 — the profile picture / public avatar
};
// RF17: add-wins playlist membership, {['playlistName\u0000localId']:
// {added: {seq,at}|null, removed: {seq,at}|null}} — see
// touchBackupMembership()'s own comment above for why this needs its own
// shape rather than reusing S.backupUpdatedAt. Device-only in the sense
// that it's keyed by *local* ids, not identity keys — converted at
// toDoc() time, same as S.playlists itself.
S.playlistMembershipAt = {};
// the account id this device has already merged a backup restore for —
// null until the first successful merge, so the one-time "Restored..."
// summary shows exactly once per account per device
S.backupRestoredFor = null;
// RF4 (docs/12_REFINE.md) — "one number for sessions": the cross-device sum
// src/sync/merge.js's mergeRows() already computes on every pull
// (merged.totals.counters), set by src/sync/backup.js's applyMerged() and
// read in place of the matching per-device counter (S.sessionCounts,
// S.trackPlayCounts, S.metalEligibleSessions, S.trackMetalEligiblePlays,
// S.phasePlayCounts, S.albumPhaseCounts) by history/achievements.js's
// topAlbums()/topTracks(), record-art/metals.js's albumMetalFor()/
// trackMetalFor(), and miziki-social.js's mizikiAdapter — so a session
// played on one device and a session played on another both count toward
// the same number and the same metal everywhere, instead of three answers
// that disagree (CLAUDE.md's "What the audit found," item 4). null until
// the first pull this session (or ever, signed out) — every reader above
// falls back to its own local counter whenever this is null, so signed-out
// behavior is unchanged. Never written back into a per-device counter
// (CLAUDE.md's backup table already forbids that, same as rareUnlocked/
// achievements/collection) — it's its own value for exactly that reason.
S.mergedStats = null;

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
// RF22 (docs/12_REFINE.md, "words that invite", point 3): a day-bucketed
// twin of phasePlayCounts above -- {dayKey: {phase: count}}, dayKey a
// local-calendar 'YYYY-MM-DD' string (sundown/rhythm.js's dayKeyFor()) --
// kept so the profile's listening-rhythm card can read "a season" (a
// rolling RHYTHM_WINDOW_DAYS-day window, sundown/rhythm.js's
// windowedPhaseCounts()) instead of a lifetime total. Device-only: unlike
// phasePlayCounts/albumPhaseCounts, this is never in the backup doc and
// never merged across devices -- a season is "what this device has heard
// lately," the same posture S.theme/S.rhythmPushedAt already have, not
// one more per-device counter to sum. Pruned on every write
// (history/played.js's incrementTrackPlay(), via pruneDayBuckets()) to a
// generous multiple of the window so it never grows without bound.
S.phasePlayCountsByDay = {};
// device-only sync bookkeeping -- the last time this device actually
// pushed a listening-rhythm snapshot to the account (src/sync/backup.js's
// pushBackup(), "updated at most daily" per the doc) -- never itself
// backed up or shown to the user, the same class of local-only timestamp
// as uploadedImageHashes in backup.js.
S.rhythmPushedAt = 0;
