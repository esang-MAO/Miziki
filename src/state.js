/* ================= social layer config =================
   Empty strings mean inert: MizikiSocial.init() leaves enabled:false and
   every screen that needs a server shows a calm "not set up yet" state (or
   hides). Paste a Supabase project URL + anon key here once one exists —
   the anon key is safe in client code, RLS is the actual protection. See
   miziki-social-handoff/README.md §9 for the one-time project setup. */
export const SOCIAL_SUPABASE_URL = '';
export const SOCIAL_SUPABASE_ANON_KEY = '';

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
  sun:{lat:null,lon:null,set:null,dusk:null,ok:false},
  motion:{on:false,watch:null,speed:null,max:25,floor:0.55,factor:1},
  char:{wow:0.30,sat:0.35,soft:0.40,comp:0.35},
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
  profile:{name:'', username:'', art:null, artBlob:null},
  albumLastPlayed:{}, trackLastPlayed:{}, albumDisplay:{}, trackDisplay:{},
  achievements:{}, collection:{}, albumEdge:{},
  profileView:{screen:'home'}, shareSelection:{albums:true, songs:true, metals:true, collection:true, name:true},
  // Part 2 §2: remembered across both share sheets; format's own per-type
  // default (story for Now Playing, square for Crate) only applies the very
  // first time, before either sheet has ever set a preference
  shareStyle:'night', shareFormat:null,
  // sleep timer — session-only, never persisted (see SLEEP spec §5)
  sleep:{mode:null, at:null, timer:null, fading:false}
};

export function current(){ return S.tracks[S.index] || null; }
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
