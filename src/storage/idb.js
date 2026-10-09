/* ================= IndexedDB =================
   The raw storage layer: one object, `DB`, wrapping the browser's IndexedDB
   API in small Promise-based methods. Holds the original files plus their
   tags, so the library and every order you set survive a restart. If
   storage is unavailable — a sandboxed preview, private browsing, an old
   engine — every call below quietly no-ops and Miziki behaves exactly as it
   did before: fully working, session-only.

   Moved out of main.js's "persistence" section unchanged (step 4a) — the
   rest of that section (queueSave, saveMeta, restoreMeta and the various
   persist*() helpers) stays in main.js for now; this is just the layer they
   sit on. See CLAUDE.md's persistence rules: any future version bump must
   come with a new upgrade test in tests/unit/idb.test.js that starts from
   the previous version's real store layout, with data in it. */
export const DB = {
  db:null, ok:false,
  req(r){ return new Promise((res,rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); },
  async open(){
    if(typeof indexedDB === 'undefined') return false;
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
          r.onblocked = () => rej(new Error('blocked'));
        }),
        new Promise((_,rej) => setTimeout(()=>rej(new Error('timeout')), 4000))
      ]);
      this.ok = true;
      return true;
    }catch(e){ this.ok = false; return false; }
  },
  store(name, mode){ return this.db.transaction(name, mode).objectStore(name); },
  async put(name, val){ if(!this.ok) return false;
    try{ await this.req(this.store(name,'readwrite').put(val)); return true; }catch(e){ return false; } },
  async get(name, k){ if(!this.ok) return null;
    try{ return await this.req(this.store(name,'readonly').get(k)); }catch(e){ return null; } },
  async all(name){ if(!this.ok) return [];
    try{ return await this.req(this.store(name,'readonly').getAll()) || []; }catch(e){ return []; } },
  async clear(name){ if(!this.ok) return;
    try{ await this.req(this.store(name,'readwrite').clear()); }catch(e){} },
  async del(name, k){ if(!this.ok) return false;
    try{ await this.req(this.store(name,'readwrite').delete(k)); return true; }catch(e){ return false; } }
};
