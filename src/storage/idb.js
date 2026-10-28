/* ================= IndexedDB =================
   The raw storage layer: one object, `DB`, wrapping the browser's IndexedDB
   API in small Promise-based methods. Holds the original files plus their
   tags, so the library and every order you set survive a restart. If
   storage is unavailable — a sandboxed preview, private browsing, an old
   engine — every call below quietly no-ops and Miziki behaves exactly as it
   did before: fully working, session-only.

   The rest of the persistence layer (queueSave, saveMeta, restoreMeta and
   the various persist*() helpers, src/storage/meta.js) sits on top of this.
   See CLAUDE.md's persistence rules: any future version bump must
   come with a new upgrade test in tests/unit/idb.test.js that starts from
   the previous version's real store layout, with data in it. */
export const DB = {
  db:null, ok:false,
  // RF5 (docs/12_REFINE.md, point 3): `blocked` is true when the most recent
  // open() was held up by another tab's own open connection to an older
  // version (onblocked) — distinct from every other reason open() can fail,
  // since it's the one case where storage genuinely isn't unavailable, just
  // temporarily unreachable from this tab. `staleVersion` is true once
  // *this* tab's own, already-open connection is the one that's gone stale
  // (onversionchange — another tab is upgrading the schema right now).
  // Neither main.js nor any other importer may ever reassign DB wholesale
  // (refactor rule 7), but reading/setting a property on it is fine — same
  // as every other mutable field on this object.
  blocked:false, staleVersion:false,
  noticeListeners:[],
  // Registers fn(kind) for 'blocked'/'staleVersion' notices — the same
  // small pub-sub shape src/sync/backup.js's onBackup() already uses, kept
  // here (not importing anything DOM-related) so this file stays a leaf;
  // main.js is the one place that turns a notice into something the user
  // sees (CLAUDE.md rule 8 — a temporary main.js-side wiring, same as every
  // other "stop the chain at the door" case already noted there).
  onNotice(fn){ this.noticeListeners.push(fn); return () => { this.noticeListeners = this.noticeListeners.filter(f => f !== fn); }; },
  notify(kind){ this.noticeListeners.slice().forEach(fn => { try{ fn(kind); }catch(_e){ /* listener bugs must not break storage */ } }); },
  req(r){ return new Promise((res,rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); },
  async open(){
    if(typeof indexedDB === 'undefined') return false;
    this.blocked = false;
    try{
      this.db = await Promise.race([
        new Promise((res,rej)=>{
          const r = indexedDB.open('miziki', 4);
          r.onupgradeneeded = () => {
            const d = r.result;
            if(!d.objectStoreNames.contains('tracks'))   d.createObjectStore('tracks',   {keyPath:'id'});
            if(!d.objectStoreNames.contains('meta'))     d.createObjectStore('meta',     {keyPath:'k'});
            if(!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', {keyPath:'albumId'});
            // user metadata edits (sparse — only fields the user actually changed)
            // and their artwork, kept separate from the original file so the
            // source stays untouched and a track can always revert
            if(!d.objectStoreNames.contains('overlays'))  d.createObjectStore('overlays',  {keyPath:'id'});
            if(!d.objectStoreNames.contains('artwork'))   d.createObjectStore('artwork',   {keyPath:'id'});
            // profile tab: kept in its own store, separable from playback
            // state, ready for a future account system (see PROFILE spec §11)
            if(!d.objectStoreNames.contains('profile'))      d.createObjectStore('profile',      {keyPath:'k'});
            if(!d.objectStoreNames.contains('achievements'))  d.createObjectStore('achievements',  {keyPath:'albumId'});
            if(!d.objectStoreNames.contains('collection'))    d.createObjectStore('collection',    {keyPath:'albumId'});
          };
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error || new Error('open failed'));
          // RF5: flag *why* this failed before rejecting — the catch below
          // still sets ok=false/returns false either way (an app that can't
          // open its database at all still has to run session-only), but
          // the caller can now tell "genuinely unavailable" apart from
          // "another tab has it open right now" and say so accurately,
          // instead of the one generic message both used to share.
          r.onblocked = () => { this.blocked = true; rej(new Error('blocked')); };
        }),
        new Promise((_,rej) => setTimeout(()=>rej(new Error('timeout')), 4000))
      ]);
      this.ok = true;
      // RF5: another tab can still upgrade the database later in the same
      // session (it opens once this tab's own onblocked above would have
      // fired for *it*, the moment this connection closes or is dropped) —
      // left open, this connection would keep that tab's own open() stuck
      // forever, and any further write here would go through against a
      // connection whose schema the other tab is actively replacing. Close
      // it and flag it instead, the standard IndexedDB "another connection
      // wants to upgrade" handshake — every DB.* method already treats
      // `ok:false` as "quietly no-op," the same safe degradation storage-
      // unavailable already gets, so nothing forks; main.js's own listener
      // is what turns this into "Miziki updated in another tab. Reload."
      this.db.onversionchange = () => {
        this.staleVersion = true;
        this.ok = false;
        this.db.close();
        this.notify('staleVersion');
      };
      return true;
    }catch(_e){ this.ok = false; return false; }
  },
  store(name, mode){ return this.db.transaction(name, mode).objectStore(name); },
  async put(name, val){ if(!this.ok) return false;
    try{ await this.req(this.store(name,'readwrite').put(val)); return true; }catch(_e){ return false; } },
  async get(name, k){ if(!this.ok) return null;
    try{ return await this.req(this.store(name,'readonly').get(k)); }catch(_e){ return null; } },
  async all(name){ if(!this.ok) return [];
    try{ return await this.req(this.store(name,'readonly').getAll()) || []; }catch(_e){ return []; } },
  async clear(name){ if(!this.ok) return;
    try{ await this.req(this.store(name,'readwrite').clear()); }catch(_e){} },
  async del(name, k){ if(!this.ok) return false;
    try{ await this.req(this.store(name,'readwrite').delete(k)); return true; }catch(_e){ return false; } }
};
