/*! miziki-social.js — optional social layer for Miziki (client)
 *
 * Local-first: the player, library and audio never depend on this file.
 * Nothing here runs unless init() is given a Supabase URL + anon key, and
 * nothing is published until the user signs in AND creates a profile.
 * Only metadata is ever sent — never audio, filenames or paths.
 *
 * Every public async function resolves to {ok:true, ...} or
 * {ok:false, error:{code, message, retryable}} and never throws, so a
 * network hiccup can't break playback.
 */
(function (root) {
  'use strict';
  if (root.MizikiSocial) return;

  /* ====================================================================
     1. utilities
     ==================================================================== */
  const enc = new TextEncoder();
  const K256 = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];

  // Pure-JS SHA-256 so release keys are identical on every device and
  // never depend on crypto.subtle (which needs a secure context).
  function sha256hex(str) {
    const bytes = enc.encode(String(str));
    const l = bytes.length;
    const total = ((l + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(l / 0x20000000));
    dv.setUint32(total - 4, (l << 3) >>> 0);
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
        h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K256[i] + w[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7]
      .map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  const _sleep = ms => new Promise(r => setTimeout(r, ms));
  function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
  const _clone = o => JSON.parse(JSON.stringify(o));
  function cps(s) { return Array.from(String(s)); }              // code points, to match Postgres char_length

  /* ---- release identity -------------------------------------------------
     release_key = 'v1:' + sha256('v1|artist|album')[0..24].
     Keyed on artist + album (NOT year) so remasters/reissues of the same
     album land on one key. Edition suffixes like "(Remastered 2011)" are
     stripped. The 'v1:' prefix lets a later MusicBrainz pass remap keys. */
  const EDITION_RX = /[(\[][^)\]]*(remaster|deluxe|expanded|anniversary|edition|reissue|bonus|mono|stereo|version|explicit)[^)\]]*[)\]]/giu;
  function normText(s) {
    return String(s == null ? '' : s)
      .normalize('NFKD').replace(/\p{M}/gu, '')
      .toLowerCase().replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  const normAlbum = s => normText(String(s == null ? '' : s).replace(EDITION_RX, ' '));
  const normArtist = s => normText(s).replace(/^the /, '');
  const UNKNOWN_ARTISTS = new Set(['', 'unknown', 'unknown artist']);
  function releaseKey(artist, album) {
    const a = normArtist(artist), b = normAlbum(album);
    if (UNKNOWN_ARTISTS.has(a) || !b || b === 'unknown album') return null;
    return 'v1:' + sha256hex('v1|' + a + '|' + b).slice(0, 24);
  }

  // Deterministic label color for an avatar record: no schema needed.
  function labelColor(seed) {
    const n = parseInt(sha256hex(String(seed)).slice(0, 6), 16);
    return 'hsl(' + (n % 360) + ' 62% 56%)';
  }

  function cleanNote(s) {
    if (s == null) return null;
    const t = cps(String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()).slice(0, 140).join('').trim();
    return t || null;
  }

  /* ====================================================================
     2. state, events, results
     ==================================================================== */
  const DEFAULT_TIMING = {
    syncDebounce: 5000, backoff: [15000, 30000, 60000, 120000, 300000],
    spinDebounce: 3000, spinHeartbeat: 240000, spinPausedClear: 120000, spinTtlSeconds: 600
  };
  const MAX_PINS = 8, CHUNK = 200, GUARD_MIN = 10, GUARD_RATIO = 0.25;
  const HANDLE_RX = /^[a-z0-9_]{3,24}$/;
  // Nobody should be able to claim a handle that impersonates the app.
  // Keep this list in sync with the matching trigger in
  // supabase/migrations/005_backup.sql — this is just the fast, offline
  // check; the server-side trigger is the real enforcement.
  const RESERVED_HANDLES = new Set([
    'admin', 'administrator', 'support', 'help', 'miziki', 'official',
    'security', 'moderator', 'mod', 'staff', 'team', 'root', 'system',
    'null', 'undefined'
  ]);

  const X = {
    enabled: false, sb: null, adapter: null, timing: { ...DEFAULT_TIMING },
    userId: null, profile: null, libraryReady: false,
    // Starts as a fresh (not null) state rather than waiting for init()'s
    // own async loadState() to resolve — pins/ratings/notes are documented
    // as available whether or not the user has ever signed in (see
    // crate/model.js's/crate/view.js's own getPins()/getAlbumSocial()
    // comments), so there's no real "not loaded yet" state to represent;
    // a null here just meant a caller reached during that async window
    // (e.g. the very first profile-tab render, or a crate tap, on a cold
    // launch) threw `Cannot read properties of null` instead of seeing
    // the same empty state loadState() would have produced anyway. Some
    // call sites had grown their own try/catch around this race
    // (crate/model.js, crate/view.js); others (gatefold/view.js,
    // profile/storefront.js) hadn't, and could still crash. loadState()
    // overwrites this with the real persisted state once it resolves.
    state: freshState(),         // persisted (see freshState)
    st: {                        // observable status
      enabled: false, auth: 'signedOut', sync: 'idle', pendingRemovals: 0,
      skipped: { noArtist: 0, collisions: 0 }, lastSyncedAt: null, lastError: null
    },
    syncing: false, again: false, syncTimer: null, backoffIdx: 0, saveTimer: null,
    spin: { timer: null, heartbeat: null, pauseTimer: null, last: null, active: false },
    listeners: {}, channel: null, releaseCache: new Map(), inited: false
  };

  function freshState() {
    return {
      v: 1, userId: null,
      settings: { shareNowSpinning: false, shareMilestones: false, syncEnabled: true, shareListeningRhythm: false },
      pins: [],                   // local album ids, order = rank (1..8)
      items: {},                  // localAlbumId -> {rating, note, vis}
      synced: {},                 // releaseKey -> {fp, pin}
      statsSynced: {},            // releaseKey -> fp
      restoredFor: null
    };
  }

  function emit(evt, payload) {
    (X.listeners[evt] || []).slice().forEach(fn => { try { fn(payload); } catch (_e) { /* listener bugs must not break sync */ } });
  }
  function on(evt, fn) {
    (X.listeners[evt] = X.listeners[evt] || []).push(fn);
    return () => { X.listeners[evt] = (X.listeners[evt] || []).filter(f => f !== fn); };
  }
  function setStatus(patch) {
    Object.assign(X.st, patch);
    emit('status', status());
  }
  function status() { return JSON.parse(JSON.stringify(X.st)); }

  function wrapErr(e) {
    if (e && e.ok === false) return e;
    const message = (e && (e.message || e.error_description || e.msg)) || String(e);
    const code = (e && (e.code || e.status || e.name)) || 'error';
    const net = /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(message)
      || (typeof navigator !== 'undefined' && navigator.onLine === false);
    const auth = /jwt|not signed in|invalid.*token|refresh_token|401/i.test(message) || code === 401 || code === 'PGRST301';
    return { ok: false, error: { code: net ? 'offline' : (auth ? 'auth' : String(code)), message, retryable: net } };
  }
  const fail = (code, message) => ({ ok: false, error: { code, message, retryable: false } });
  async function guarded(fn) {
    if (!X.enabled) return fail('disabled', 'Social features are not configured.');
    try { return await fn(); } catch (e) { return wrapErr(e); }
  }
  async function rpc(name, args) {
    const { data, error } = await X.sb.rpc(name, args || {});
    if (error) throw error;
    return data;
  }
  async function q(promise) {                // unwrap a PostgREST builder
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }

  /* ====================================================================
     3. persistence of this module's own state (via the adapter)
     ==================================================================== */
  function persistSoon() {
    clearTimeout(X.saveTimer);
    X.saveTimer = setTimeout(persistNow, 300);
  }
  async function persistNow() {
    clearTimeout(X.saveTimer);
    try { if (X.adapter && X.adapter.save) await X.adapter.save(X.state); } catch (_e) { /* storage unavailable: session-only */ }
  }
  async function loadState() {
    let s = null;
    try { s = X.adapter && X.adapter.load ? await X.adapter.load() : null; } catch (_e) { s = null; }
    const base = freshState();
    if (s && s.v === 1) {
      X.state = { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) } };
    } else {
      X.state = base;
    }
  }

  /* ====================================================================
     4. starting up supabase-js
     ==================================================================== */
  /**
   * init({ url, anonKey, adapter | env, sb?, supabaseLib?, timing? })
   *   env = { S, DB, albumKey, trackTier, albumMetalFor }  → builds the Miziki adapter
   *   sb  = a ready client (tests); otherwise one is created from url/anonKey.
   *   supabaseLib = the bundled @supabase/supabase-js module (security
   *   hardening, step 01 — this used to fall back to fetching an unpinned
   *   copy from a CDN; the app now always passes its own bundled copy, or
   *   a real global at `root.supabase` for callers that load it another
   *   way, and init() fails closed (inert, same as no keys) rather than
   *   ever reaching out to a CDN on its own).
   */
  async function init(opts) {
    opts = opts || {};
    if (X.inited) return { ok: true, status: status() };
    X.timing = { ...DEFAULT_TIMING, ...(opts.timing || {}) };
    X.adapter = opts.adapter || (opts.env ? mizikiAdapter(opts.env) : null);
    if (!X.adapter) return fail('no_adapter', 'init needs an adapter or env.');
    await loadState();
    if (!opts.sb && !(opts.url && opts.anonKey)) {
      setStatus({ enabled: false });
      return { ok: true, status: status() };           // inert: app behaves exactly as before
    }
    try {
      if (opts.sb) {
        X.sb = opts.sb;
      } else {
        const lib = opts.supabaseLib || root.supabase;
        if (!lib || !lib.createClient) throw new Error('supabase-js not available (pass supabaseLib).');
        X.sb = lib.createClient(opts.url, opts.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
        });
      }
    } catch (e) {
      // offline at launch is normal: stay inert this session
      setStatus({ enabled: false, lastError: wrapErr(e).error });
      return wrapErr(e);
    }
    X.enabled = true; X.inited = true;
    setStatus({ enabled: true });

    X.sb.auth.onAuthStateChange((event, session) => { applySession(session).catch(() => {}); });
    const { data } = await X.sb.auth.getSession();
    await applySession(data && data.session);

    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', () => scheduleSync(1000));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(1500); });
    }
    return { ok: true, status: status() };
  }

  /* ====================================================================
     5. auth + profile
     ==================================================================== */
  async function applySession(session) {
    const uid = session && session.user ? session.user.id : null;
    if (uid === X.userId && (uid === null || X.profile !== undefined)) { if (uid) return; }
    X.userId = uid;
    if (!uid) {
      X.profile = null;
      stopSpinningNow();
      setStatus({ auth: 'signedOut', sync: 'idle' });
      return;
    }
    if (X.state.userId && X.state.userId !== uid) {          // different account on this device
      const keep = X.state.settings;
      X.state = { ...freshState(), settings: keep, pins: X.state.pins, items: X.state.items };
      persistSoon();
    }
    X.state.userId = uid;
    const prof = await getMyProfile();
    if (prof.ok && prof.profile) {
      setStatus({ auth: 'ready' });
      scheduleSync(500);
    } else {
      setStatus({ auth: prof.ok ? 'needsProfile' : 'signedOut' });
    }
  }

  // Email one-time code. Works in an iOS home-screen app, where a magic LINK would open Safari
  // and strand the session outside the app. (Supabase email template must include {{ .Token }}.)
  const sendCode = email => guarded(async () => {
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return fail('bad_email', 'Enter a valid email address.');
    const { error } = await X.sb.auth.signInWithOtp({ email: e, options: { shouldCreateUser: true } });
    if (error) throw error;
    return { ok: true };
  });
  const verifyCode = (email, code) => guarded(async () => {
    const token = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6,8}$/.test(token)) return fail('bad_code', 'Enter the code from the email.');
    const { data, error } = await X.sb.auth.verifyOtp({ email: String(email).trim().toLowerCase(), token, type: 'email' });
    if (error) throw error;
    await applySession(data.session);
    return { ok: true, status: status() };
  });
  // scope is always passed explicitly — supabase-js's own default has
  // changed across versions, and "sign out" vs. "sign out everywhere"
  // (step 06, B3 — a lost-phone escape hatch) must never depend on it.
  const signOut = () => guarded(async () => {
    stopSpinningNow();
    await X.sb.auth.signOut({ scope: 'local' });
    X.state.synced = {}; X.state.statsSynced = {}; X.state.restoredFor = null; X.state.userId = null;
    persistSoon();
    await applySession(null);
    return { ok: true };
  });
  const signOutEverywhere = () => guarded(async () => {
    stopSpinningNow();
    await X.sb.auth.signOut({ scope: 'global' });
    X.state.synced = {}; X.state.statsSynced = {}; X.state.restoredFor = null; X.state.userId = null;
    persistSoon();
    await applySession(null);
    return { ok: true };
  });
  // step 07 (B4): delete_my_account()'s own cascades (on delete cascade
  // foreign keys) reach every table that references the caller's row,
  // but Storage objects have no foreign key to auth.users at all — a
  // deleted account's covers/{uid}/ and avatars/{uid}/ files would
  // otherwise just sit there forever, orphaned. Listed and removed here,
  // before the RPC call, while this account's own Storage RLS policies
  // (migration 006, owner-only by uid) still clearly apply to it.
  // Best-effort: a Storage failure must never block the account deletion
  // itself, which is the part that actually matters for the App Store
  // requirement this exists for.
  async function removeStorageFolder(bucket, uid) {
    try {
      const { data } = await X.sb.storage.from(bucket).list(uid);
      if (data && data.length) await X.sb.storage.from(bucket).remove(data.map(f => uid + '/' + f.name));
    } catch (_e) { /* best-effort — account deletion must still proceed */ }
  }
  // Irreversible — removes the account, handle, backup and social data from
  // the server (supabase/migrations/005_backup.sql's delete_my_account(),
  // cascading through every table that references the caller's own row),
  // plus the caller's own Storage files (above), which the RPC's cascades
  // can't reach. Music and history on THIS device are never touched: they
  // live in IndexedDB, not in anything this RPC can reach. The caller (the
  // Account screen) is responsible for the type-your-handle confirmation —
  // this function does not ask again.
  const deleteAccount = () => guarded(async () => {
    const uid = X.userId;
    if (uid) { await removeStorageFolder('covers', uid); await removeStorageFolder('avatars', uid); }
    await rpc('delete_my_account');
    stopSpinningNow();
    try { await X.sb.auth.signOut({ scope: 'local' }); } catch (_e) { /* account is already gone server-side */ }
    X.state = freshState();
    persistSoon();
    await applySession(null);
    return { ok: true };
  });

  const getMyProfile = () => guarded(async () => {
    if (!X.userId) return { ok: true, profile: null };
    const row = await q(X.sb.from('profiles').select('*').eq('id', X.userId).maybeSingle());
    X.profile = row || null;
    return { ok: true, profile: X.profile };
  });
  const checkHandle = handle => guarded(async () => {
    const h = String(handle || '').trim().toLowerCase();
    if (!HANDLE_RX.test(h)) return { ok: true, available: false, reason: 'format' };
    if (RESERVED_HANDLES.has(h)) return { ok: true, available: false, reason: 'reserved' };
    const row = await q(X.sb.from('profiles').select('id').eq('handle', h).maybeSingle());
    return { ok: true, available: !row };
  });
  const createProfile = ({ handle, displayName }) => guarded(async () => {
    if (!X.userId) return fail('auth', 'Sign in first.');
    const h = String(handle || '').trim().toLowerCase();
    if (!HANDLE_RX.test(h)) return fail('bad_handle', '3–24 characters: letters, numbers, underscore.');
    if (RESERVED_HANDLES.has(h)) return fail('handle_reserved', 'That handle is reserved.');
    const dn = displayName ? cps(String(displayName).trim()).slice(0, 50).join('') : null;
    const { data, error } = await X.sb.from('profiles')
      .insert({ id: X.userId, handle: h, display_name: dn || null }).select().single();
    if (error) {
      if (error.code === '23505') return fail('handle_taken', 'That handle is taken.');
      if (error.code === 'P0001') return fail('handle_reserved', 'That handle is reserved.');
      throw error;
    }
    X.profile = data;
    setStatus({ auth: 'ready' });
    scheduleSync(300);
    return { ok: true, profile: data };
  });
  const updateProfile = patch => guarded(async () => {
    const allowed = {};
    if ('displayName' in patch) allowed.display_name = patch.displayName ? cps(String(patch.displayName).trim()).slice(0, 50).join('') : null;
    if ('bio' in patch) allowed.bio = patch.bio ? cps(String(patch.bio).trim()).slice(0, 280).join('') : null;
    if ('visibility' in patch) {
      if (!['private', 'friends', 'public'].includes(patch.visibility)) return fail('bad_visibility', 'Unknown visibility.');
      allowed.visibility = patch.visibility;
    }
    if ('showDiggingList' in patch) allowed.show_digging_list = !!patch.showDiggingList;
    if ('listeningRhythm' in patch) {
      const lr = patch.listeningRhythm;
      if (lr !== null && (typeof lr !== 'object' || typeof lr.verdict !== 'string' || typeof lr.shares !== 'object' || lr.shares === null)) {
        return fail('bad_listening_rhythm', 'Malformed listening rhythm payload.');
      }
      allowed.listening_rhythm = lr;
    }
    if ('handle' in patch) {
      const h = String(patch.handle).trim().toLowerCase();
      if (!HANDLE_RX.test(h)) return fail('bad_handle', '3–24 characters: letters, numbers, underscore.');
      if (RESERVED_HANDLES.has(h)) return fail('handle_reserved', 'That handle is reserved.');
      allowed.handle = h;
    }
    const { data, error } = await X.sb.from('profiles').update(allowed).eq('id', X.userId).select().single();
    if (error) {
      if (error.code === '23505') return fail('handle_taken', 'That handle is taken.');
      if (error.code === 'P0001') return fail('handle_reserved', 'That handle is reserved.');
      throw error;
    }
    X.profile = data;
    return { ok: true, profile: data };
  });
  // DA5 (docs/DAY_ARC.md): the shared half of listening rhythm -- the
  // aggregate percentages/verdict only, never raw plays, never raw times
  // (those stay local, src/sundown/rhythm.js's own callers). `payload` is
  // either null (clear, the Privacy switch's own "off" path) or a plain
  // {verdict, shares} object -- routed through updateProfile() so it gets
  // the exact same validated, single-column write every other profile
  // field already does, not a second write path of its own.
  const setListeningRhythm = payload => updateProfile({ listeningRhythm: payload });
  // Reads someone else's (or, trivially, your own) shared value through
  // the new get_listening_rhythm() RPC (007_rhythm.sql) -- never a direct
  // `.from('profiles').select('listening_rhythm')`, since profiles_select
  // is deliberately blanket and the RPC is where the crate's own
  // visibility check actually lives for this one column; see that
  // migration's own comment for why. Returns `rhythm: null` for an owner
  // who hasn't shared one, isn't visible to this viewer, or isn't signed
  // in at all -- the same "absent, not denied" shape can_view()'s own
  // callers already use, never an error for the ordinary "nothing to
  // show" case.
  const getListeningRhythm = userId => guarded(async () => ({
    ok: true, rhythm: (await rpc('get_listening_rhythm', { p_user: userId })) || null
  }));

  /* ====================================================================
     6. local social metadata: ratings, sleeve notes, staff picks, visibility
        (lives on this device; published by the sync engine)
     ==================================================================== */
  function entry(albumId) {
    return (X.state.items[albumId] = X.state.items[albumId] || { rating: null, note: null, vis: null });
  }
  function tidy(albumId) {
    const e = X.state.items[albumId];
    if (e && e.rating == null && e.note == null && e.vis == null && !e.pendingClear && !hasDirty(e)) delete X.state.items[albumId];
  }
  function hasDirty(e) { return !!(e.dirty && (e.dirty.rating || e.dirty.note || e.dirty.vis)); }
  function touched() { persistSoon(); scheduleSync(); }

  // RF3 (docs/12_REFINE.md): a field this device hasn't itself edited since
  // its last confirmed push should always defer to whatever the server has
  // for it -- that's mergeFromServer()'s whole job below. `dirty` is what
  // tells the two apart, per field: set the moment setRating/setNote/
  // setVisibility is called, cleared only once pushCrate() confirms that
  // field's current value actually reached the server. A row-level
  // "whichever side touched it more recently" timestamp compare was tried
  // first and rejected -- it fails exactly the scenario this PR exists for
  // (device A rates an album, device B almost immediately adds a note to
  // the same one): both edits land within the same instant as far as a
  // single per-row clock is concerned, so "newer" picks one side's touch
  // and discards the other side's still-unpushed-but-untouched-by-it field
  // along with it. A per-field dirty flag needs no clock comparison (and no
  // new server timestamp) at all: an untouched field is always safe to
  // adopt from the server, a touched-but-not-yet-pushed one never is.
  //
  // A field going to null here is a real, user-driven clear -- it has to
  // reach the server as the explicit sentinel sync_crate expects, not a
  // bare `null`, which now means "no change" so a stale device can never
  // again wipe another device's value by never having set one locally.
  // `pendingClear` tracks that narrower intent until it's actually been
  // pushed (see buildItems()/pushCrate() below).
  function markDirty(albumId, field) {
    const e = X.state.items[albumId];
    if (!e) return;
    e.dirty = e.dirty || {};
    e.dirty[field] = true;
  }
  function markClear(albumId, field, clearing) {
    const e = X.state.items[albumId];
    if (!e) return;
    if (clearing) { e.pendingClear = e.pendingClear || {}; e.pendingClear[field] = true; }
    else if (e.pendingClear) { delete e.pendingClear[field]; if (!Object.keys(e.pendingClear).length) delete e.pendingClear; }
  }
  function setRating(albumId, value) {
    if (value != null) {
      value = Math.round(Number(value));
      if (!(value >= 1 && value <= 5)) return false;
    }
    const e = entry(albumId);
    markClear(albumId, 'rating', value == null && e.rating != null);
    e.rating = value == null ? null : value;
    markDirty(albumId, 'rating');
    tidy(albumId); touched(); return true;
  }
  function setNote(albumId, text) {
    const e = entry(albumId);
    const cleaned = cleanNote(text);
    markClear(albumId, 'note', cleaned == null && e.note != null);
    e.note = cleaned;
    markDirty(albumId, 'note');
    tidy(albumId); touched(); return true;
  }
  function setVisibility(albumId, vis) {
    if (vis != null && !['private', 'friends', 'public'].includes(vis)) return false;
    const e = entry(albumId);
    e.vis = vis == null ? null : vis;
    markDirty(albumId, 'vis');
    tidy(albumId); touched(); return true;
  }
  function pin(albumId) {
    const p = X.state.pins;
    if (p.includes(albumId)) return true;
    if (p.length >= MAX_PINS) return false;
    p.push(albumId); touched(); return true;
  }
  function unpin(albumId) {
    const i = X.state.pins.indexOf(albumId);
    if (i < 0) return false;
    X.state.pins.splice(i, 1); touched(); return true;
  }
  function movePin(albumId, toIndex) {
    const p = X.state.pins, i = p.indexOf(albumId);
    if (i < 0) return false;
    p.splice(i, 1);
    p.splice(Math.max(0, Math.min(p.length, toIndex | 0)), 0, albumId);
    touched(); return true;
  }
  const getPins = () => X.state.pins.slice();
  function getAlbumSocial(albumId) {
    const e = X.state.items[albumId] || {};
    const i = X.state.pins.indexOf(albumId);
    return { rating: e.rating == null ? null : e.rating, note: e.note || null, visibility: e.vis || null, pinRank: i < 0 ? null : i + 1 };
  }
  const getSettings = () => ({ ...X.state.settings });
  function setSetting(key, value) {
    if (!(key in X.state.settings)) return false;
    X.state.settings[key] = !!value;
    if (key === 'shareNowSpinning' && !value) stopSpinningNow();
    touched(); return true;
  }

  /* ====================================================================
     7. sync engine: diff local desired state against what the server last
        confirmed. Idempotent, crash-safe, and offline-tolerant — there is no
        operation queue to corrupt, only fingerprints that advance after the
        server acknowledges each batch.
     ==================================================================== */
  function buildItems(albums) {
    const items = new Map();
    const skipped = { noArtist: 0, collisions: 0 };
    const idByKey = new Map();
    const pinnedLocal = X.state.pins.filter(id => albums.some(a => a.id === id));
    let rankCounter = 0;
    const rankOf = new Map();
    for (const id of pinnedLocal) {
      const a = albums.find(x => x.id === id);
      if (releaseKey(a.artist, a.title) && rankCounter < MAX_PINS) rankOf.set(id, ++rankCounter);
    }
    for (const a of albums) {
      const key = releaseKey(a.artist, a.title);
      if (!key) { skipped.noArtist++; continue; }
      const m = X.state.items[a.id] || {};
      // A real clear goes out as sync_crate's own sentinel (rating 0 /
      // sleeve_note '') -- a bare null now means "no change" server-side
      // (RF3), so "I have nothing to say about this field" (never touched,
      // or just merged in from the server) and "I want this field cleared"
      // have to be wire-distinguishable. See markClear()/mergeFromServer().
      const clearRating = !!(m.pendingClear && m.pendingClear.rating);
      const clearNote = !!(m.pendingClear && m.pendingClear.note);
      const item = {
        release_key: key,
        title: String(a.title).slice(0, 200),
        artist: String(a.artist).slice(0, 200),
        year: a.year || null,
        quality_tier: a.tier || null,
        // AU11 (docs/16_AUDIO.md §5): always present, null when unknown --
        // a plain overwrite column server-side (sync_crate(), migration
        // 021), with no "clear it"/"don't touch" distinction of its own
        // the way rating/sleeve_note or credits need.
        record_format: a.format || null,
        rating: clearRating ? 0 : (m.rating == null ? null : m.rating),
        sleeve_note: clearNote ? '' : (m.note || null),
        pin_rank: rankOf.get(a.id) || null,
        visibility: m.vis || null,
        added_at: a.addedAt ? new Date(a.addedAt).toISOString() : null
      };
      // RF23 (docs/12_REFINE.md): a `credits` key only when the caller
      // actually supplied one -- an absent key (a test harness album, or
      // any future caller that never computes credits) means sync_crate()
      // leaves that release's release_credits rows untouched, never wipes
      // them. mizikiAdapter's own describe() always supplies an array
      // (possibly empty), so this is only ever omitted outside real use.
      if (Array.isArray(a.credits)) {
        item.credits = a.credits.slice(0, 300).map(c => ({ name: String(c.name || '').slice(0, 200), role: String(c.role || '').slice(0, 60) }));
      }
      const prior = items.get(key);
      if (prior) {                               // two local albums collapse to one release
        skipped.collisions++;
        const keep = (prior.rating != null || prior.sleeve_note || prior.pin_rank) ? prior : item;
        const other = keep === prior ? item : prior;
        if (keep.pin_rank == null && other.pin_rank != null) keep.pin_rank = other.pin_rank;
        items.set(key, keep);
        continue;
      }
      items.set(key, item);
      idByKey.set(key, a.id);
    }
    // keep pin ranks unique and contiguous after collisions
    const pinned = [...items.values()].filter(i => i.pin_rank != null).sort((a, b) => a.pin_rank - b.pin_rank);
    pinned.forEach((i, n) => { i.pin_rank = n + 1; });
    for (const it of items.values()) {
      it.fp = sha256hex(JSON.stringify([it.title, it.artist, it.year, it.quality_tier, it.record_format, it.rating, it.sleeve_note, it.pin_rank, it.visibility, it.credits || null])).slice(0, 12);
    }
    return { items, skipped, idByKey };
  }
  function toWire(it) {
    const { fp: _fp, ...rest } = it;
    return rest;
  }

  // Pulls every server crate row for this account and merges it, field by
  // field (rating/note/visibility), into the local X.state.items (RF3,
  // docs/12_REFINE.md). Runs on every sync now, not just the first one ever
  // for this account on this device (the old restoreFromServer()'s own
  // gate, `X.state.restoredFor !== X.userId`) -- otherwise a device that
  // never happens to touch an album would only ever learn another device's
  // rating/note/visibility for it once, at first sign-in, and never again.
  //
  // Per field, not per row: a field this device has an unpushed local edit
  // for (tracked by `dirty`, set by setRating/setNote/setVisibility, cleared
  // by pushCrate() once that edit actually reaches the server) always keeps
  // its local value here; every other field always adopts whatever the
  // server currently has, regardless of either side's own timestamp.
  //
  // A single row-level `updated_at` compare (crate_items already has one,
  // via its own pre-existing touch trigger) was tried first and rejected:
  // it fails exactly the scenario this PR exists for (device A rates an
  // album, device B almost immediately adds a note to the same one) --
  // both edits land close enough in wall-clock time that "newer" picks one
  // side's touch and, with it, discards the other side's still-correct,
  // untouched-by-it field. Per-field dirty tracking needs no clock compare
  // (and no new server timestamp) at all: an untouched field is always safe
  // to adopt, a touched-but-not-yet-confirmed one never is.
  async function mergeFromServer(albums) {
    const byKey = new Map();
    for (const a of albums) { const k = releaseKey(a.artist, a.title); if (k && !byKey.has(k)) byKey.set(k, a); }
    const serverPins = [];
    const firstEver = X.state.restoredFor !== X.userId;
    for (let off = 0; ; off += 500) {
      const rows = await rpc('my_crate_meta', { p_offset: off, p_limit: 500 });
      for (const r of rows || []) {
        const a = byKey.get(r.release_key);
        if (!a) continue;
        const local = X.state.items[a.id];
        const dirty = (local && local.dirty) || {};
        const serverRating = r.rating == null ? null : r.rating;
        const serverNote = r.sleeve_note || null;
        const serverVis = r.visibility || null;
        const rating = dirty.rating ? (local ? local.rating : null) : serverRating;
        const note = dirty.note ? (local ? local.note : null) : serverNote;
        const vis = dirty.vis ? (local ? local.vis : null) : serverVis;
        if (rating != null || note != null || vis != null || hasDirty(local || {}) || (local && local.pendingClear)) {
          X.state.items[a.id] = { rating, note, vis };
          if (local && local.dirty) X.state.items[a.id].dirty = local.dirty;
          if (local && local.pendingClear) X.state.items[a.id].pendingClear = local.pendingClear;
        } else if (local) {
          delete X.state.items[a.id];
        }
        if (r.pin_rank != null) serverPins.push({ rank: r.pin_rank, id: a.id });
      }
      if (!rows || rows.length < 500) break;
    }
    // Pin adoption stays first-sign-in-only, same as before this change:
    // repeating it every sync would undo a user who deliberately unpinned
    // everything locally, since "no local pins" can't be told apart from
    // "never looked" once this runs more than once.
    if (firstEver && !X.state.pins.length && serverPins.length) {
      X.state.pins = serverPins.sort((a, b) => a.rank - b.rank).map(p => p.id).slice(0, MAX_PINS);
    }
    X.state.restoredFor = X.userId;
  }

  async function pushCrate(items, quiet, toUpsert, idByKey) {
    // Pin changes first, in one tiny batch, so a pin moving between two albums
    // never collides across chunks (each RPC is its own transaction).
    const clearFirst = [];
    for (const it of items.values()) {
      const prev = X.state.synced[it.release_key];
      if (prev && prev.pin != null && prev.pin !== it.pin_rank) clearFirst.push({ ...toWire(it), pin_rank: null });
    }
    if (clearFirst.length) {
      await rpc('sync_crate', { p_items: clearFirst, p_quiet: true });
      for (const w of clearFirst) { const s = X.state.synced[w.release_key]; if (s) { s.pin = null; s.fp = ''; } }
    }
    for (const part of chunk(toUpsert, CHUNK)) {
      await rpc('sync_crate', { p_items: part.map(toWire), p_quiet: quiet });
      for (const it of part) {
        X.state.synced[it.release_key] = { fp: it.fp, pin: it.pin_rank };
        // Every field this item carried (rating/note/visibility) has now
        // actually reached the server as a full snapshot -- clear the
        // dirty flags mergeFromServer() uses to decide what's still a
        // local-only edit, and the pending-clear sentinel tracking, so a
        // later pull can freely adopt whatever the server has for this
        // item again (including another device's own later edit), and
        // tidy() can drop the entry if there's nothing left in it.
        const albumId = idByKey && idByKey.get(it.release_key);
        if (albumId) {
          const e = X.state.items[albumId];
          if (e && e.dirty) delete e.dirty;
          if (it.rating === 0) markClear(albumId, 'rating', false);
          if (it.sleeve_note === '') markClear(albumId, 'note', false);
          tidy(albumId);
        }
      }
      persistSoon();
    }
  }

  async function pushStats(albums, items, quiet) {
    const out = [];
    for (const a of albums) {
      const key = releaseKey(a.artist, a.title);
      if (!key || !items.has(key)) continue;
      if (!(a.sessions > 0) && !a.metal) continue;
      const fp = sha256hex([a.sessions || 0, a.metal || ''].join('|')).slice(0, 12);
      if (X.state.statsSynced[key] === fp) continue;
      out.push({ key, fp, wire: {
        release_key: key, full_album_sessions: a.sessions || 0,
        unlocked_variant: a.metal || null,
        last_session_at: a.lastPlayed ? new Date(a.lastPlayed).toISOString() : null } });
    }
    for (const part of chunk(out, CHUNK)) {
      await rpc('sync_stats', { p_items: part.map(p => p.wire), p_quiet: quiet });
      part.forEach(p => { X.state.statsSynced[p.key] = p.fp; });
      persistSoon();
    }
    return out.length;
  }

  function scheduleSync(delay) {
    if (!X.enabled || !X.userId) return;
    clearTimeout(X.syncTimer);
    X.syncTimer = setTimeout(() => { syncNow(); }, delay == null ? X.timing.syncDebounce : delay);
  }

  /** Run a sync now. {confirmRemovals:true} approves a held-back mass removal. */
  async function syncNow(opts) {
    opts = opts || {};
    if (!X.enabled) return fail('disabled', 'Social features are not configured.');
    if (!X.userId || !X.profile) return fail('not_ready', 'Sign in and create a profile first.');
    if (!X.state.settings.syncEnabled) return fail('paused', 'Sync is paused.');
    if (!X.libraryReady) return fail('library_not_ready', 'Library has not finished loading.');
    if (X.syncing) { X.again = true; return { ok: true, queued: true }; }
    X.syncing = true;
    setStatus({ sync: 'syncing' });
    try {
      const albums = (await X.adapter.listAlbums()) || [];
      let first = X.state.restoredFor !== X.userId;
      await mergeFromServer(albums);
      const { items, skipped, idByKey } = buildItems(albums);

      const toUpsert = [...items.values()].filter(it => {
        const s = X.state.synced[it.release_key];
        return !s || s.fp !== it.fp;
      });
      const syncedKeys = Object.keys(X.state.synced);
      const toRemove = syncedKeys.filter(k => !items.has(k));

      // Guard: a library that failed to load must never wipe the published crate.
      const massRemoval = toRemove.length >= GUARD_MIN && toRemove.length > GUARD_RATIO * Math.max(1, syncedKeys.length);
      const emptied = items.size === 0 && syncedKeys.length > 0;
      let held = 0;
      if ((massRemoval || emptied) && !opts.confirmRemovals) held = toRemove.length;

      const quiet = first && X.state.settings.syncEnabled;
      await pushCrate(items, quiet, toUpsert, idByKey);

      let removed = 0;
      if (!held) {
        for (const part of chunk(toRemove, 500)) {
          await rpc('remove_from_crate', { p_keys: part });
          part.forEach(k => { delete X.state.synced[k]; });
          removed += part.length;
        }
      }
      let statCount = 0;
      if (X.state.settings.shareMilestones) statCount = await pushStats(albums, items, quiet);

      X.backoffIdx = 0;
      await persistNow();
      setStatus({
        sync: held ? 'needsReview' : 'idle', pendingRemovals: held, skipped,
        lastSyncedAt: Date.now(), lastError: null
      });
      const result = { ok: true, pushed: toUpsert.length, removed, held, stats: statCount, firstSync: first };
      emit('synced', result);
      return result;
    } catch (e) {
      const err = wrapErr(e);
      if (err.error.code === 'auth') {
        setStatus({ sync: 'error', lastError: err.error });
      } else if (err.error.retryable) {
        const wait = X.timing.backoff[Math.min(X.backoffIdx++, X.timing.backoff.length - 1)];
        setStatus({ sync: 'offline', lastError: err.error });
        clearTimeout(X.syncTimer);
        X.syncTimer = setTimeout(() => { syncNow(); }, wait);
      } else {
        setStatus({ sync: 'error', lastError: err.error });
      }
      return err;
    } finally {
      X.syncing = false;
      if (X.again) { X.again = false; scheduleSync(250); }
    }
  }
  const confirmRemovals = () => syncNow({ confirmRemovals: true });

  /* ====================================================================
     8. now spinning
     ==================================================================== */
  function _spinKey(albumId, trackTitle) { return albumId + '|' + (trackTitle || ''); }

  /** Call whenever a track starts. Debounced; a no-op unless the user opted in.
      `phase` (DA6, docs/DAY_ARC.md) is the spinner's own local day-arc phase
      ('night'/'dawn'/'morning'/'midday'/'afternoon'/'golden'/'twilight') at
      the moment playback started — never a clock time, never a location.
      It rides along with trackTitle/albumId for the heartbeat republish
      below: like those two, it's captured once per real play() call, not
      recomputed every 4-minute heartbeat tick, since miziki-social.js stays
      import-free by design (see its own repo-layout entry) and can't reach
      sundown/solar.js itself to recompute it. */
  function nowSpinning(albumId, trackTitle, phase) {
    if (!X.enabled || !X.userId || !X.profile || !X.state.settings.shareNowSpinning) return;
    clearTimeout(X.spin.pauseTimer);
    clearTimeout(X.spin.timer);
    X.spin.timer = setTimeout(() => publishSpin(albumId, trackTitle, phase), X.timing.spinDebounce);
  }
  async function publishSpin(albumId, trackTitle, phase) {
    try {
      const info = await X.adapter.albumInfo(albumId);
      if (!info) return;
      const key = releaseKey(info.artist, info.title);
      if (!key) return;
      const ok = await rpc('set_now_spinning', {
        p_key: key, p_title: info.title, p_artist: info.artist,
        p_track: trackTitle || null, p_ttl_seconds: Math.round(X.timing.spinTtlSeconds),
        p_phase: phase || null
      });
      X.spin.last = { albumId, trackTitle, key, phase };
      X.spin.active = ok === true;
      clearInterval(X.spin.heartbeat);
      if (X.spin.active) {
        X.spin.heartbeat = setInterval(() => {
          if (X.spin.last) publishSpin(X.spin.last.albumId, X.spin.last.trackTitle, X.spin.last.phase);
        }, X.timing.spinHeartbeat);
      }
    } catch (_e) { /* best effort */ }
  }
  /** Call on pause: the disc stays up briefly, then disappears. */
  function nowSpinningPaused() {
    if (!X.spin.active) return;
    clearTimeout(X.spin.pauseTimer);
    X.spin.pauseTimer = setTimeout(stopSpinningNow, X.timing.spinPausedClear);
  }
  function stopSpinningNow() {
    clearTimeout(X.spin.timer); clearTimeout(X.spin.pauseTimer); clearInterval(X.spin.heartbeat);
    const had = X.spin.active || X.spin.last;
    X.spin.active = false; X.spin.last = null;
    if (had && X.enabled && X.userId) { rpc('clear_now_spinning').catch(() => {}); }
  }
  const stopSpinning = () => { stopSpinningNow(); };

  /* ====================================================================
     9. people: search, follow, block, report
     ==================================================================== */
  const searchProfiles = query => guarded(async () => {
    const t = String(query || '').trim().toLowerCase().replace(/^@/, '').replace(/[%_\\]/g, m => '\\' + m);
    if (t.length < 2) return { ok: true, profiles: [] };
    const rows = await q(X.sb.from('profiles').select('id, handle, display_name, visibility')
      .ilike('handle', t + '%').neq('id', X.userId).limit(20));
    return { ok: true, profiles: rows || [] };
  });

  const follow = userId => guarded(async () => {
    const { data, error } = await X.sb.from('follows')
      .insert({ follower_id: X.userId, followee_id: userId }).select('status').single();
    if (error) { if (error.code === '23505') return { ok: true, status: 'exists' }; throw error; }
    return { ok: true, status: data.status };       // 'accepted' for public profiles, else 'pending'
  });
  const unfollow = userId => guarded(async () => {
    await q(X.sb.from('follows').delete().eq('follower_id', X.userId).eq('followee_id', userId));
    return { ok: true };
  });
  const respondToRequest = (followerId, accept) => guarded(async () => {
    if (accept) await q(X.sb.from('follows').update({ status: 'accepted' }).eq('followee_id', X.userId).eq('follower_id', followerId));
    else await q(X.sb.from('follows').delete().eq('followee_id', X.userId).eq('follower_id', followerId));
    return { ok: true };
  });
  const removeFollower = followerId => respondToRequest(followerId, false);
  const listRequests = () => guarded(async () => {
    const rows = await q(X.sb.from('follows')
      .select('follower_id, created_at, profiles!follows_follower_id_fkey(handle, display_name)')
      .eq('followee_id', X.userId).eq('status', 'pending').order('created_at', { ascending: false }));
    return { ok: true, requests: rows || [] };
  });
  const listFollowing = () => guarded(async () => {
    const rows = await q(X.sb.from('follows')
      .select('followee_id, status, profiles!follows_followee_id_fkey(handle, display_name)')
      .eq('follower_id', X.userId).order('created_at', { ascending: false }));
    return { ok: true, following: rows || [] };
  });
  const block = userId => guarded(async () => {
    await q(X.sb.from('blocks').insert({ blocker_id: X.userId, blocked_id: userId }));
    return { ok: true };
  });
  const unblock = userId => guarded(async () => {
    await q(X.sb.from('blocks').delete().eq('blocker_id', X.userId).eq('blocked_id', userId));
    return { ok: true };
  });
  const listBlocked = () => guarded(async () => {
    const rows = await q(X.sb.from('blocks')
      .select('blocked_id, created_at, profiles!blocks_blocked_id_fkey(handle, display_name)')
      .eq('blocker_id', X.userId).order('created_at', { ascending: false }));
    return { ok: true, blocked: rows || [] };
  });
  const report = ({ userId, releaseId, reason }) => guarded(async () => {
    const r = cps(String(reason || '').trim()).slice(0, 500).join('');
    if (!r) return fail('bad_reason', 'Say what is wrong.');
    await q(X.sb.from('reports').insert({ reporter_id: X.userId, target_user_id: userId, release_id: releaseId || null, reason: r }));
    return { ok: true };
  });

  /* ====================================================================
     10. reading other people's stores
     ==================================================================== */
  async function relationship(otherId) {
    const [mine, theirs] = await Promise.all([
      q(X.sb.from('follows').select('status').eq('follower_id', X.userId).eq('followee_id', otherId).maybeSingle()),
      q(X.sb.from('follows').select('status').eq('follower_id', otherId).eq('followee_id', X.userId).maybeSingle())
    ]);
    return { following: mine ? mine.status : 'none', followsYou: !!(theirs && theirs.status === 'accepted') };
  }

  /** Everything the friend-profile screen needs, in one round trip fan-out. */
  const loadProfile = handle => guarded(async () => {
    const h = String(handle || '').trim().toLowerCase().replace(/^@/, '');
    const profile = await q(X.sb.from('profiles').select('*').eq('handle', h).maybeSingle());
    if (!profile) return fail('not_found', 'No such crate.');
    const isMe = profile.id === X.userId;
    const rel = isMe ? { following: 'self', followsYou: false } : await relationship(profile.id);
    const canView = isMe || profile.visibility === 'public' || rel.following === 'accepted';
    const out = { ok: true, profile, relationship: rel, isMe, canView, labelColor: labelColor(profile.handle) };
    if (!canView) return out;
    const [summary, picks, spinning, fresh, inCommonRows, follows, rhythm] = await Promise.all([
      rpc('profile_summary', { p_user: profile.id }),
      rpc('crate_page', { p_user: profile.id, p_offset: 0, p_limit: 8, p_pinned_only: true }),
      q(X.sb.from('now_spinning').select('track_title, started_at, expires_at, phase, releases(title, artist)')
        .eq('user_id', profile.id).gt('expires_at', new Date().toISOString()).maybeSingle()),
      isMe ? Promise.resolve([]) : rpc('fresh_for_you', { p_other: profile.id, p_min_rating: 4, p_limit: 12 }),
      // RF20 point 3: "overlap first" — what the viewer already shares with
      // this crate, fetched eagerly alongside Fresh rather than lazily via
      // the separate inCommon() export, so the friend-store screen can
      // render it as its own, always-first section with no extra round trip.
      isMe ? Promise.resolve([]) : rpc('records_in_common', { p_other: profile.id }),
      // follower/following counts only make sense (and are only visible under
      // RLS) for your own storefront — frame 02's friend store shows
      // Records/Staff picks/In common instead, no followers count at all
      isMe ? rpc('my_follow_counts') : Promise.resolve(null),
      // DA5 (docs/DAY_ARC.md): the shared half of listening rhythm —
      // get_listening_rhythm() (007_rhythm.sql) does its own can_view()
      // check server-side (which also covers blocking, unlike the plain
      // `canView` computed just above), so this is always safe to call
      // regardless — it comes back null for anyone who shouldn't see it,
      // or for an owner who never shared one, same "absent, not denied"
      // shape as everything else in this function.
      rpc('get_listening_rhythm', { p_user: profile.id })
    ]);
    out.listeningRhythm = rhythm || null;
    out.summary = (summary && summary[0]) || { records: 0, pins: 0, in_common: 0 };
    if (isMe) {
      const f = (follows && follows[0]) || { followers: 0, following: 0 };
      out.summary.followers = f.followers || 0;
      out.summary.following = f.following || 0;
    }
    out.staffPicks = picks || [];
    out.nowSpinning = spinning || null;
    out.fresh = fresh || [];
    out.inCommon = inCommonRows || [];
    // Digging list: shown only when the owner left it on (default on). RLS enforces this too.
    out.diggingShared = isMe || profile.show_digging_list !== false;
    if (out.diggingShared) {
      const [dp, dc] = await Promise.all([
        rpc('digging_page', { p_user: profile.id, p_offset: 0, p_limit: 8 }),
        rpc('digging_count', { p_user: profile.id })]);
      out.digging = dp || []; out.diggingCount = dc || 0;
    } else { out.digging = []; out.diggingCount = 0; }
    return out;
  });
  const crate = (userId, { offset = 0, limit = 60 } = {}) => guarded(async () => ({
    ok: true, items: (await rpc('crate_page', { p_user: userId, p_offset: offset, p_limit: limit, p_pinned_only: false })) || []
  }));
  const inCommon = userId => guarded(async () => ({
    ok: true, items: (await rpc('records_in_common', { p_other: userId })) || []
  }));
  // RF23 (docs/12_REFINE.md, "credits across friends"): everyone this
  // viewer can see (per release_credits' own RLS, which mirrors the
  // crate item that supplied each row) with a credit matching this exact
  // (person, role) pair -- personNameNorm is expected pre-normalized
  // (normKey(), library/credits.js's albumCreditPairs() shape), since the
  // caller (renderPersonView, already working from a normalized name) has
  // no reason to re-derive it here.
  const creditFriends = (personNameNorm, role) => guarded(async () => ({
    ok: true, items: (await rpc('credit_friends', { p_person_name_norm: personNameNorm, p_role: role })) || []
  }));
  const homeFeed = ({ limit = 50, before } = {}) => guarded(async () => ({
    ok: true, events: (await rpc('home_feed_rich', { p_limit: limit, p_before: before || new Date().toISOString() })) || []
  }));

  /* ---- digging list (their record, your wishlist) ---- */
  const addToDigging = (releaseId, sourceUserId) => guarded(async () => {
    const { error } = await X.sb.from('digging_list')
      .upsert({ user_id: X.userId, release_id: releaseId, source_user_id: sourceUserId || null },
              { onConflict: 'user_id,release_id', ignoreDuplicates: true });
    if (error) throw error;
    return { ok: true };
  });
  const removeFromDigging = releaseId => guarded(async () => {
    await q(X.sb.from('digging_list').delete().eq('user_id', X.userId).eq('release_id', releaseId));
    return { ok: true };
  });
  const diggingOf = (userId, { offset = 0, limit = 30 } = {}) => guarded(async () => ({
    ok: true, items: (await rpc('digging_page', { p_user: userId, p_offset: offset, p_limit: limit })) || []
  }));
  const listDigging = () => guarded(async () => {
    const rows = await q(X.sb.from('digging_list')
      .select('release_id, added_at, source_user_id, releases(title, artist, year)')
      .eq('user_id', X.userId).order('added_at', { ascending: false }).limit(500));
    return { ok: true, items: rows || [] };
  });

  /* ---- realtime: friends' discs appear as they start spinning ---- */
  async function releaseInfo(id) {
    if (X.releaseCache.has(id)) return X.releaseCache.get(id);
    const r = await q(X.sb.from('releases').select('id, title, artist, year').eq('id', id).maybeSingle());
    if (r) X.releaseCache.set(id, r);
    return r;
  }
  function subscribeNowSpinning(cb) {
    if (!X.enabled) return () => {};
    const ch = X.sb.channel('miziki-now-spinning')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'now_spinning' }, async payload => {
        try {
          if (payload.eventType === 'DELETE') { cb({ type: 'stopped', userId: payload.old && payload.old.user_id }); return; }
          const row = payload.new;
          if (!row || row.user_id === X.userId) return;
          const rel = await releaseInfo(row.release_id);
          cb({ type: 'spinning', userId: row.user_id, track: row.track_title, expiresAt: row.expires_at, release: rel, phase: row.phase });
        } catch (_e) { /* ignore */ }
      }).subscribe();
    return () => { try { X.sb.removeChannel(ch); } catch (_e) { /* noop */ } };
  }

  /* ====================================================================
     11. Miziki adapter: maps the app's globals onto the module's interface
         env = { S, DB, albumKey, trackTier, albumMetalFor }
     ==================================================================== */
  function mizikiAdapter(env) {
    const { S, DB } = env;
    const isReal = t => t && t.id !== 'miziki:testtone' && t.tags && t.tags.album && t.tags.album !== 'Unknown Album';
    function pickArtist(tracks) {
      const aa = new Map(), ar = new Map();
      for (const t of tracks) {
        if (t.tags.albumArtist) aa.set(t.tags.albumArtist, (aa.get(t.tags.albumArtist) || 0) + 1);
        if (t.tags.artist) ar.set(t.tags.artist, (ar.get(t.tags.artist) || 0) + 1);
      }
      const top = m => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      if (aa.size) return top(aa)[0];
      if (ar.size > 1) return 'Various Artists';
      return ar.size ? top(ar)[0] : '';
    }
    function majorityTier(tracks) {
      const c = { 1: 0, 2: 0, 3: 0 };
      tracks.forEach(t => { const x = env.trackTier(t); c[x] = (c[x] || 0) + 1; });
      let best = 1;
      for (const k of [1, 2, 3]) if (c[k] > c[best] || (c[k] === c[best] && k < best && c[k] > 0)) best = k;
      return best;
    }
    function describe(id, tracks) {
      const first = tracks[0];
      // RF4 (docs/12_REFINE.md): the merged cross-device total, when one
      // exists, in place of this device's own S.sessionCounts — see
      // state.js's own S.mergedStats comment. env.albumMetalFor() already
      // does the same for `metal` internally (record-art/metals.js), so no
      // separate change is needed here for that field.
      const sessionCounts = S.mergedStats ? S.mergedStats.sessionCounts : S.sessionCounts;
      return {
        id, title: first.tags.album, artist: pickArtist(tracks), tier: majorityTier(tracks),
        addedAt: Math.min(...tracks.map(t => t.addedAt || Date.now())),
        sessions: sessionCounts[id] || 0,
        metal: S.rareUnlocked[id] ? 'rare' : (env.albumMetalFor(id) || null),
        lastPlayed: (S.albumLastPlayed && S.albumLastPlayed[id]) || null,
        // RF23 (docs/12_REFINE.md): the credits this album's own files
        // carry, straight off library/credits.js's albumCreditRoll() (via
        // the small env.albumCreditPairs() wrapper) -- always present,
        // even as an empty array for an album with no embedded credits at
        // all, since buildItems()/sync_crate() both treat "has a credits
        // key" (even empty) as "replace whatever's on the server" and a
        // missing key as "don't touch credits for this one."
        credits: env.albumCreditPairs ? env.albumCreditPairs(id) : [],
        // AU11 (docs/16_AUDIO.md §5): this album's own automatic format
        // (never the personal Auto/33⅓/45 override), as the short wire
        // code the env.albumFormatFor() wrapper already encodes it to --
        // this module stays import-free by design, so it never touches
        // record-art/format.js's own {size, speed} shape directly.
        format: env.albumFormatFor ? env.albumFormatFor(tracks) : null
      };
    }
    return {
      async load() { const r = await DB.get('meta', 'social'); return r ? r.v : null; },
      async save(v) { await DB.put('meta', { k: 'social', v }); },
      listAlbums() {
        const by = new Map();
        for (const t of S.tracks) {
          if (!isReal(t)) continue;
          const id = env.albumKey(t);
          if (!by.has(id)) by.set(id, []);
          by.get(id).push(t);
        }
        return [...by.entries()].map(([id, tracks]) => describe(id, tracks));
      },
      albumInfo(id) {
        const tracks = S.tracks.filter(t => isReal(t) && env.albumKey(t) === id);
        return tracks.length ? describe(id, tracks) : null;
      }
    };
  }

  /* ====================================================================
     12. public API
     ==================================================================== */
  // Step 06 (B3, account backup): the backup sync engine (src/sync/backup.js)
  // needs the same signed-in Supabase client this module already creates,
  // not a second one — a second client would mean two separate auth
  // sessions/token refreshes racing each other for no reason. getClient()
  // returns null whenever this module itself is inert (no keys configured,
  // or init() hasn't resolved yet), the same "behaves exactly as before"
  // fallback every other public method here already guards with.
  function getClient(){ return X.enabled ? X.sb : null; }

  root.MizikiSocial = {
    init, status, on, getClient,
    // host-app hooks
    libraryLoaded() { X.libraryReady = true; scheduleSync(1500); },
    libraryChanged() { scheduleSync(); },
    listeningChanged() { scheduleSync(); },
    nowSpinning, nowSpinningPaused, stopSpinning,
    // auth + profile
    sendCode, verifyCode, signOut, signOutEverywhere, deleteAccount,
    getMyProfile, checkHandle, createProfile, updateProfile,
    setListeningRhythm, getListeningRhythm,
    // local social metadata
    setRating, setNote, setVisibility, pin, unpin, movePin, getPins, getAlbumSocial, getSettings, setSetting,
    // sync
    syncNow, confirmRemovals,
    // people
    searchProfiles, follow, unfollow, respondToRequest, removeFollower, listRequests, listFollowing,
    block, unblock, listBlocked, report,
    // reading
    loadProfile, crate, inCommon, creditFriends, homeFeed, addToDigging, removeFromDigging, listDigging, diggingOf, subscribeNowSpinning,
    // helpers (also used by tests / UI)
    releaseKey, labelColor, sha256hex, mizikiAdapter,
    _internals: { X, buildItems, normAlbum, normArtist, cleanNote }
  };
})(typeof window !== 'undefined' ? window : globalThis);
