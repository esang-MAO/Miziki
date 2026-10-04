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

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
  const clone = o => JSON.parse(JSON.stringify(o));
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

  const X = {
    enabled: false, sb: null, adapter: null, timing: { ...DEFAULT_TIMING },
    userId: null, profile: null, libraryReady: false,
    state: null,                 // persisted (see freshState)
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
      settings: { shareNowSpinning: false, shareMilestones: false, syncEnabled: true },
      pins: [],                   // local album ids, order = rank (1..8)
      items: {},                  // localAlbumId -> {rating, note, vis}
      synced: {},                 // releaseKey -> {fp, pin}
      statsSynced: {},            // releaseKey -> fp
      restoredFor: null
    };
  }

  function emit(evt, payload) {
    (X.listeners[evt] || []).slice().forEach(fn => { try { fn(payload); } catch (e) { /* listener bugs must not break sync */ } });
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
    try { if (X.adapter && X.adapter.save) await X.adapter.save(X.state); } catch (e) { /* storage unavailable: session-only */ }
  }
  async function loadState() {
    let s = null;
    try { s = X.adapter && X.adapter.load ? await X.adapter.load() : null; } catch (e) { s = null; }
    const base = freshState();
    if (s && s.v === 1) {
      X.state = { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) } };
    } else {
      X.state = base;
    }
  }

  /* ====================================================================
     4. loading supabase-js and starting up
     ==================================================================== */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = resolve; el.onerror = () => reject(new Error('Failed to fetch supabase-js'));
      document.head.appendChild(el);
    });
  }

  /**
   * init({ url, anonKey, adapter | env, sb?, supabaseLib?, libUrl?, timing? })
   *   env = { S, DB, albumKey, trackTier, albumMetalFor }  → builds the Miziki adapter
   *   sb  = a ready client (tests); otherwise one is created from url/anonKey.
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
        let lib = opts.supabaseLib || root.supabase;
        if (!lib || !lib.createClient) {
          await loadScript(opts.libUrl || 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
          lib = root.supabase;
        }
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
  const signOut = () => guarded(async () => {
    stopSpinningNow();
    await X.sb.auth.signOut();
    X.state.synced = {}; X.state.statsSynced = {}; X.state.restoredFor = null; X.state.userId = null;
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
    const row = await q(X.sb.from('profiles').select('id').eq('handle', h).maybeSingle());
    return { ok: true, available: !row };
  });
  const createProfile = ({ handle, displayName }) => guarded(async () => {
    if (!X.userId) return fail('auth', 'Sign in first.');
    const h = String(handle || '').trim().toLowerCase();
    if (!HANDLE_RX.test(h)) return fail('bad_handle', '3–24 characters: letters, numbers, underscore.');
    const dn = displayName ? cps(String(displayName).trim()).slice(0, 50).join('') : null;
    const { data, error } = await X.sb.from('profiles')
      .insert({ id: X.userId, handle: h, display_name: dn || null }).select().single();
    if (error) {
      if (error.code === '23505') return fail('handle_taken', 'That handle is taken.');
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
    if ('handle' in patch) {
      const h = String(patch.handle).trim().toLowerCase();
      if (!HANDLE_RX.test(h)) return fail('bad_handle', '3–24 characters: letters, numbers, underscore.');
      allowed.handle = h;
    }
    const { data, error } = await X.sb.from('profiles').update(allowed).eq('id', X.userId).select().single();
    if (error) { if (error.code === '23505') return fail('handle_taken', 'That handle is taken.'); throw error; }
    X.profile = data;
    return { ok: true, profile: data };
  });

  /* ====================================================================
     6. local social metadata: ratings, sleeve notes, staff picks, visibility
        (lives on this device; published by the sync engine)
     ==================================================================== */
  function entry(albumId) {
    return (X.state.items[albumId] = X.state.items[albumId] || { rating: null, note: null, vis: null });
  }
  function tidy(albumId) {
    const e = X.state.items[albumId];
    if (e && e.rating == null && e.note == null && e.vis == null) delete X.state.items[albumId];
  }
  function touched() { persistSoon(); scheduleSync(); }

  function setRating(albumId, value) {
    if (value != null) {
      value = Math.round(Number(value));
      if (!(value >= 1 && value <= 5)) return false;
    }
    entry(albumId).rating = value == null ? null : value;
    tidy(albumId); touched(); return true;
  }
  function setNote(albumId, text) {
    entry(albumId).note = cleanNote(text);
    tidy(albumId); touched(); return true;
  }
  function setVisibility(albumId, vis) {
    if (vis != null && !['private', 'friends', 'public'].includes(vis)) return false;
    entry(albumId).vis = vis == null ? null : vis;
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
      const item = {
        release_key: key,
        title: String(a.title).slice(0, 200),
        artist: String(a.artist).slice(0, 200),
        year: a.year || null,
        quality_tier: a.tier || null,
        rating: m.rating == null ? null : m.rating,
        sleeve_note: m.note || null,
        pin_rank: rankOf.get(a.id) || null,
        visibility: m.vis || null,
        added_at: a.addedAt ? new Date(a.addedAt).toISOString() : null
      };
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
      it.fp = sha256hex(JSON.stringify([it.title, it.artist, it.year, it.quality_tier, it.rating, it.sleeve_note, it.pin_rank, it.visibility])).slice(0, 12);
    }
    return { items, skipped, idByKey };
  }
  function toWire(it) {
    const { fp, ...rest } = it;
    return rest;
  }

  // Fresh device: adopt what the server already has so we never push blanks over it.
  async function restoreFromServer(albums) {
    const byKey = new Map();
    for (const a of albums) { const k = releaseKey(a.artist, a.title); if (k && !byKey.has(k)) byKey.set(k, a); }
    const serverPins = [];
    for (let off = 0; ; off += 500) {
      const rows = await rpc('my_crate_meta', { p_offset: off, p_limit: 500 });
      for (const r of rows || []) {
        const a = byKey.get(r.release_key);
        if (!a) continue;
        if (!X.state.items[a.id]) {
          if (r.rating != null || r.sleeve_note || r.visibility) {
            X.state.items[a.id] = { rating: r.rating == null ? null : r.rating, note: r.sleeve_note || null, vis: r.visibility || null };
          }
        }
        if (r.pin_rank != null) serverPins.push({ rank: r.pin_rank, id: a.id });
      }
      if (!rows || rows.length < 500) break;
    }
    if (!X.state.pins.length && serverPins.length) {
      X.state.pins = serverPins.sort((a, b) => a.rank - b.rank).map(p => p.id).slice(0, MAX_PINS);
    }
    X.state.restoredFor = X.userId;
  }

  async function pushCrate(items, quiet, toUpsert) {
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
      for (const it of part) X.state.synced[it.release_key] = { fp: it.fp, pin: it.pin_rank };
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
      if (first) await restoreFromServer(albums);
      const { items, skipped } = buildItems(albums);

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
      await pushCrate(items, quiet, toUpsert);

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
  function spinKey(albumId, trackTitle) { return albumId + '|' + (trackTitle || ''); }

  /** Call whenever a track starts. Debounced; a no-op unless the user opted in. */
  function nowSpinning(albumId, trackTitle) {
    if (!X.enabled || !X.userId || !X.profile || !X.state.settings.shareNowSpinning) return;
    clearTimeout(X.spin.pauseTimer);
    clearTimeout(X.spin.timer);
    X.spin.timer = setTimeout(() => publishSpin(albumId, trackTitle), X.timing.spinDebounce);
  }
  async function publishSpin(albumId, trackTitle) {
    try {
      const info = await X.adapter.albumInfo(albumId);
      if (!info) return;
      const key = releaseKey(info.artist, info.title);
      if (!key) return;
      const ok = await rpc('set_now_spinning', {
        p_key: key, p_title: info.title, p_artist: info.artist,
        p_track: trackTitle || null, p_ttl_seconds: Math.round(X.timing.spinTtlSeconds)
      });
      X.spin.last = { albumId, trackTitle, key };
      X.spin.active = ok === true;
      clearInterval(X.spin.heartbeat);
      if (X.spin.active) {
        X.spin.heartbeat = setInterval(() => {
          if (X.spin.last) publishSpin(X.spin.last.albumId, X.spin.last.trackTitle);
        }, X.timing.spinHeartbeat);
      }
    } catch (e) { /* best effort */ }
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
    if (!profile) return fail('not_found', 'No such store.');
    const isMe = profile.id === X.userId;
    const rel = isMe ? { following: 'self', followsYou: false } : await relationship(profile.id);
    const canView = isMe || profile.visibility === 'public' || rel.following === 'accepted';
    const out = { ok: true, profile, relationship: rel, isMe, canView, labelColor: labelColor(profile.handle) };
    if (!canView) return out;
    const [summary, picks, spinning, fresh, follows] = await Promise.all([
      rpc('profile_summary', { p_user: profile.id }),
      rpc('crate_page', { p_user: profile.id, p_offset: 0, p_limit: 8, p_pinned_only: true }),
      q(X.sb.from('now_spinning').select('track_title, started_at, expires_at, releases(title, artist)')
        .eq('user_id', profile.id).gt('expires_at', new Date().toISOString()).maybeSingle()),
      isMe ? Promise.resolve([]) : rpc('fresh_for_you', { p_other: profile.id, p_min_rating: 4, p_limit: 12 }),
      // follower/following counts only make sense (and are only visible under
      // RLS) for your own storefront — frame 02's friend store shows
      // Records/Staff picks/In common instead, no followers count at all
      isMe ? rpc('my_follow_counts') : Promise.resolve(null)
    ]);
    out.summary = (summary && summary[0]) || { records: 0, pins: 0, in_common: 0 };
    if (isMe) {
      const f = (follows && follows[0]) || { followers: 0, following: 0 };
      out.summary.followers = f.followers || 0;
      out.summary.following = f.following || 0;
    }
    out.staffPicks = picks || [];
    out.nowSpinning = spinning || null;
    out.fresh = fresh || [];
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
          cb({ type: 'spinning', userId: row.user_id, track: row.track_title, expiresAt: row.expires_at, release: rel });
        } catch (e) { /* ignore */ }
      }).subscribe();
    return () => { try { X.sb.removeChannel(ch); } catch (e) { /* noop */ } };
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
      return {
        id, title: first.tags.album, artist: pickArtist(tracks), tier: majorityTier(tracks),
        addedAt: Math.min(...tracks.map(t => t.addedAt || Date.now())),
        sessions: S.sessionCounts[id] || 0,
        metal: S.rareUnlocked[id] ? 'rare' : (env.albumMetalFor(id) || null),
        lastPlayed: (S.albumLastPlayed && S.albumLastPlayed[id]) || null
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
  root.MizikiSocial = {
    init, status, on,
    // host-app hooks
    libraryLoaded() { X.libraryReady = true; scheduleSync(1500); },
    libraryChanged() { scheduleSync(); },
    listeningChanged() { scheduleSync(); },
    nowSpinning, nowSpinningPaused, stopSpinning,
    // auth + profile
    sendCode, verifyCode, signOut, getMyProfile, checkHandle, createProfile, updateProfile,
    // local social metadata
    setRating, setNote, setVisibility, pin, unpin, movePin, getPins, getAlbumSocial, getSettings, setSetting,
    // sync
    syncNow, confirmRemovals,
    // people
    searchProfiles, follow, unfollow, respondToRequest, removeFollower, listRequests, listFollowing, block, unblock, report,
    // reading
    loadProfile, crate, inCommon, homeFeed, addToDigging, removeFromDigging, listDigging, diggingOf, subscribeNowSpinning,
    // helpers (also used by tests / UI)
    releaseKey, labelColor, sha256hex, mizikiAdapter,
    _internals: { X, buildItems, normAlbum, normArtist, cleanNote }
  };
})(typeof window !== 'undefined' ? window : globalThis);
