const { spawnSync } = require('child_process');
const crypto = require('crypto');
const assert = require('assert');
require('../src/miziki-social.js');
const M = globalThis.MizikiSocial;
const ENV = { ...process.env, PGHOST:process.env.PGHOST||'/var/tmp/pgmz', PGPORT:process.env.PGPORT||'5544', PGUSER:process.env.PGUSER||'postgres' };
function psql(sql){ const r=spawnSync('psql',['-d','mz','-X','-At','-v','ON_ERROR_STOP=1','-c',sql],{env:ENV,encoding:'utf8'}); if(r.status!==0) throw Object.assign(new Error(r.stderr.trim()),{code:'PG'}); return r.stdout.trim(); }
const UID='11111111-1111-1111-1111-111111111111', UID2='22222222-2222-2222-2222-222222222222';
psql(`insert into auth.users values ('${UID}'),('${UID2}') on conflict do nothing;
insert into profiles(id,handle,display_name,visibility) values ('${UID}','ken','Ken','public'),('${UID2}','amy','Amy','friends') on conflict do nothing`);
let calls=[], offline=false, uid=UID;
// every `returns table(...)` function PostgREST hands back as an array of
// rows regardless of how many rows come back — even exactly one (profile_summary,
// my_follow_counts) or zero (digging_page) — so each belongs here, not in the
// scalar branch below, which is only for a true scalar return (boolean/void/etc)
const SETS=new Set(['my_crate_meta','home_feed_rich','crate_page','fresh_for_you','home_feed','records_in_common',
  'digging_page','profile_summary','my_follow_counts']);
const lit = v => "$j$"+JSON.stringify(v)+"$j$";
const sb = {
  async rpc(name,args){
    calls.push(name);
    if(offline) return {data:null,error:new Error('TypeError: Failed to fetch')};
    const params=Object.entries(args||{}).map(([k,v])=>{
      const cast = typeof v==='object'&&v!==null ? (name==='remove_from_crate'?`${lit(v)}::jsonb`:`${lit(v)}::jsonb`) : (typeof v==='string'?`'${v.replace(/'/g,"''")}'`:String(v));
      return `${k} => ${cast}`; }).join(', ');
    // arrays for text[] param
    let p=params; if(name==='remove_from_crate') p=`p_keys => array(select jsonb_array_elements_text(${lit(args.p_keys)}::jsonb))`;
    try{ const out=psql(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false); ${SETS.has(name)?`select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb)::text from ${name}(${p}) q;`:`select coalesce(to_jsonb(x),'null'::jsonb)::text from (select ${name}(${p}) as x) q;`}`);
      const lines=out.split('\n'); const last=lines[lines.length-1]; let d; try{d=JSON.parse(last)}catch(e){console.log('PARSE',name,JSON.stringify(out.slice(-200)));throw e} if(d&&typeof d==='object'&&'x' in d) d=d.x; return {data:d,error:null}; }
    catch(e){ return {data:null,error:e}; } },
  from(t){ const f={}; let patch=null; const b={select(){return b},eq(c,v){f[c]={op:'=',v};return b},gt(c,v){f[c]={op:'>',v};return b},
      update(p){ patch=p; return b; },
      async maybeSingle(){ const w=Object.entries(f).map(([c,{op,v}])=>`${c}${op}'${v}'`).join(' and ');
        const o=psql(`select coalesce(to_jsonb(p),'null') from ${t} p ${w?'where '+w:''} limit 1`); const d=JSON.parse(o||'null'); return {data:d,error:null}; },
      // minimal real-Postgres UPDATE, for updateProfile()'s own write path
      // (setListeningRhythm among them) -- same "real Postgres, not a
      // second fake of it" posture maybeSingle() already has above.
      async single(){
        const w=Object.entries(f).map(([c,{op,v}])=>`${c}${op}'${v}'`).join(' and ');
        const sets=Object.entries(patch||{}).map(([c,v])=>
          v===null ? `${c}=null` : typeof v==='object' ? `${c}=${lit(v)}::jsonb` : typeof v==='boolean' ? `${c}=${v}` : `${c}='${String(v).replace(/'/g,"''")}'`).join(', ');
        try{ const o=psql(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false); update ${t} set ${sets} where ${w} returning to_jsonb(${t}.*)`);
          // -At still prints the UPDATE/INSERT/DELETE command tag as its own
          // trailing line after the returned row's own JSON -- unlike every
          // other call site here, which only ever runs a bare SELECT (no
          // such tag) -- so take the last line that actually looks like a
          // value, not just the textual last line.
          const lines=o.split('\n').filter(l => !/^(SET|UPDATE|INSERT|DELETE)\b[^{[]*$/.test(l.trim()));
          const d=JSON.parse(lines[lines.length-1]||'null'); return {data:d,error:null}; }
        catch(e){ return {data:null,error:e}; } }};
    return b; },
  auth:{ onAuthStateChange(){}, async getSession(){ return {data:{session:{user:{id:uid}}}}; } },
  // step 07 (B4): a bare recorder, not a real Storage client -- just
  // enough for deleteAccount()'s own list-then-remove sequence (src/
  // miziki-social.js) to be observed, since neither Postgres nor this
  // fake sb has a real Storage API behind it. Each call appends to
  // storageCalls rather than touching anything.
  storage:{ from(bucket){ return {
    async list(){ storageCalls.push({op:'list', bucket}); return {data:[{name:'x.jpg'}]}; },
    async remove(paths){ storageCalls.push({op:'remove', bucket, paths}); return {data:paths, error:null}; },
  }; } },
};
let storageCalls=[];
let ALBUMS=[]; let store=null;
const adapter={ async load(){return store}, async save(v){store=JSON.parse(JSON.stringify(v))}, listAlbums(){return ALBUMS.map(a=>({...a}))}, albumInfo(id){return ALBUMS.find(a=>a.id===id)||null} };
const alb=(n,o={})=>({id:'a'+n,title:'Album '+n,artist:'Artist '+(n%7+1),year:2000+n%20,tier:2,addedAt:1700000000000+n,sessions:0,metal:null,lastPlayed:null,...o});
const q1=s=>psql(s);
let pass=0; const t=async(name,fn)=>{ try{await fn();pass++;console.log('ok  ',name)}catch(e){console.log('FAIL',name,'\n    ',e.message.split('\n')[0]); process.exitCode=1} };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await t('sha256 matches node crypto incl unicode',()=>{ for(const s of ['','abc','日本語のアルバム','é'.repeat(100),'x'.repeat(1000)]) assert.equal(M.sha256hex(s),crypto.createHash('sha256').update(s,'utf8').digest('hex'),s.slice(0,8)); });
 await t('releaseKey normalisation',()=>{ const k=M.releaseKey;
   assert.equal(k('The Beatles','Abbey Road (2019 Remaster)'),k('Beatles','Abbey Road'));
   assert.equal(k('Simon & Garfunkel','Bookends'),k('Simon and Garfunkel','Bookends'));
   assert.ok(/^v1:[0-9a-f]{24}$/.test(k('宇多田ヒカル','First Love')));
   assert.equal(k('','X'),null); assert.equal(k('Unknown Artist','X'),null); assert.equal(k('A',''),null);
   assert.notEqual(k('A','B'),k('A','C')); });
 await M.init({sb,adapter,timing:{syncDebounce:20,backoff:[60,60],spinDebounce:30,spinHeartbeat:10000,spinPausedClear:80,spinTtlSeconds:600}});
 await t('init signs in with profile',()=>{ const s=M.status(); assert.equal(s.auth,'ready',JSON.stringify(s)); });
 await t('sync refused until library ready',async()=>{ const r=await M.syncNow(); assert.equal(r.error.code,'library_not_ready'); });
 ALBUMS=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(n=>alb(n));
 // clean slate for events
 M.libraryLoaded(); await sleep(1800);
 const crateN=()=>+q1(`select count(*) from crate_items where user_id='${UID}'`);
 const evN=()=>+q1(`select count(*) from feed_events where actor_id='${UID}'`);
 await t('first sync pushes all, quietly (no events)',()=>{ assert.equal(crateN(),20); assert.equal(evN(),0); assert.equal(M.status().sync,'idle'); });
 // RF3 (docs/12_REFINE.md) made this pull -- not zero calls anymore: every
 // syncNow() now calls my_crate_meta first, via mergeFromServer(), to merge
 // in whatever another device might have changed since the last sync,
 // before deciding what (if anything) to push. An unchanged library still
 // pushes nothing (`pushed:0`, `sync_crate` never called) -- it just isn't
 // silent on the wire anymore.
 await t('unchanged library => pulls to merge, but pushes nothing',async()=>{ calls=[]; const r=await M.syncNow(); assert.equal(r.pushed,0); assert.deepEqual(calls,['my_crate_meta'],calls.join()); });
 await t('rating+note+pin produce events and server rows',async()=>{
   M.setRating('a1',5); M.setNote('a1','Perfect side A.\n Put it on at sundown.'); M.pin('a1'); M.pin('a2');
   const r=await M.syncNow(); assert.equal(r.pushed,2,JSON.stringify(r));
   assert.equal(q1(`select rating||'|'||pin_rank from crate_items where user_id='${UID}' and title_fix is null`.replace(" and title_fix is null",` and release_id=(select id from releases where title='Album 1')`)),'5|1');
   assert.ok(evN()>=1,'events '+evN()); });
 await t('pin swap works (two-phase)',async()=>{ M.movePin('a2',0); const r=await M.syncNow(); assert.equal(r.ok,true,JSON.stringify(r));
   assert.equal(q1(`select pin_rank from crate_items where user_id='${UID}' and release_id=(select id from releases where title='Album 2')`),'1');
   assert.equal(q1(`select pin_rank from crate_items where user_id='${UID}' and release_id=(select id from releases where title='Album 1')`),'2'); });
 await t('unpin then pin other albums, 8 max',async()=>{ for(const n of [3,4,5,6,7,8,9]) M.pin('a'+n); assert.equal(M.getPins().length,8); const r=await M.syncNow(); assert.equal(r.ok,true,JSON.stringify(r)); assert.equal(+q1(`select count(pin_rank) from crate_items where user_id='${UID}'`),8); });
 await t('small removal proceeds',async()=>{ ALBUMS=ALBUMS.filter(a=>a.id!=='a20'); const r=await M.syncNow(); assert.equal(r.removed,1); assert.equal(crateN(),19); });
 await t('mass removal held until confirm',async()=>{ ALBUMS=ALBUMS.slice(0,8); const r=await M.syncNow(); assert.equal(r.held,11,JSON.stringify(r)); assert.equal(crateN(),19); assert.equal(M.status().sync,'needsReview');
   const r2=await M.confirmRemovals(); assert.equal(r2.removed,11,JSON.stringify(r2)); assert.equal(crateN(),8); });
 await t('emptied library held',async()=>{ ALBUMS=[]; const r=await M.syncNow(); assert.ok(r.held>0); assert.equal(crateN(),8); ALBUMS=[1,2,3,4,5,6,7,8].map(n=>alb(n)); const r2=await M.syncNow(); assert.equal(r2.held,0); assert.equal(crateN(),8); });
 await t('fresh device restores server metadata, no blank overwrite',async()=>{
   store=null; const X=M._internals.X; X.state=null; // simulate wiped device
   X.state={v:1,userId:null,settings:{shareNowSpinning:false,shareMilestones:false,syncEnabled:true,shareListeningRhythm:false},pins:[],items:{},synced:{},statsSynced:{},restoredFor:null};
   const r=await M.syncNow(); assert.equal(r.firstSync,true);
   assert.equal(M.getAlbumSocial('a1').rating,5); assert.ok(M.getPins().length>0,'pins restored');
   assert.equal(q1(`select rating from crate_items where user_id='${UID}' and release_id=(select id from releases where title='Album 1')`),'5'); });
 // RF4 (docs/12_REFINE.md): "one number for sessions" -- sync_stats'
 // full_album_sessions column changed from greatest() to a plain
 // overwrite (migration 011_authoritative_stats.sql), since the client
 // now always sends its own already-merged, cross-device total (in the
 // real app, S.mergedStats-aware; this harness's ALBUMS/listAlbums()
 // stands in for that number directly), never a single device's own,
 // possibly-lower count that a later device's greatest() could only ever
 // ratchet upward. unlocked_variant is untouched by this migration --
 // still a coalesce, so a later push that says nothing about it (a null
 // payload value) never clears an already-earned metal.
 await t('milestones only when opted in; sessions overwrite authoritatively, unlocked_variant stays monotonic',async()=>{
   ALBUMS=ALBUMS.map(a=>a.id==='a1'?{...a,sessions:6,metal:'gold'}:a);
   await M.syncNow(); assert.equal(+q1(`select count(*) from verified_stats where user_id='${UID}'`),0);
   M.setSetting('shareMilestones',true); const r=await M.syncNow(); assert.equal(r.stats,1,JSON.stringify(r));
   assert.equal(q1(`select full_album_sessions||'|'||unlocked_variant from verified_stats where user_id='${UID}'`),'6|gold');
   // a later, lower count (and no metal in the payload) is now an
   // authoritative overwrite for sessions, but the already-earned metal
   // survives since the payload's own null never clears it.
   ALBUMS=ALBUMS.map(a=>a.id==='a1'?{...a,sessions:2,metal:null}:a); await M.syncNow();
   assert.equal(q1(`select full_album_sessions||'|'||unlocked_variant from verified_stats where user_id='${UID}'`),'2|gold'); });
 await t('now spinning off by default',async()=>{ M.nowSpinning('a3','Track X'); await sleep(300); assert.equal(+q1(`select count(*) from now_spinning where user_id='${UID}'`),0); M.setSetting('shareNowSpinning',true); });
 await t('now spinning public + stop clears',async()=>{
   M.nowSpinning('a3','Track X'); await sleep(400);
   assert.equal(+q1(`select count(*) from now_spinning where user_id='${UID}'`),1);
   M.stopSpinning(); await sleep(400); assert.equal(+q1(`select count(*) from now_spinning where user_id='${UID}'`),0); });
 // DA6 (docs/DAY_ARC.md, migration 008_spin_phase.sql): the phase rides
 // along as nowSpinning's third argument, through publishSpin's own
 // p_phase param, into the real now_spinning.phase column -- exercised
 // here through the real MizikiSocial client against the real Postgres
 // RPC, the same end-to-end shape every other now-spinning test above
 // already uses, not a second fake of the RPC layer.
 await t('now spinning sends the phase through to the real column',async()=>{
   M.nowSpinning('a3','Track X','golden'); await sleep(400);
   assert.equal(q1(`select phase from now_spinning where user_id='${UID}'`),'golden');
   M.stopSpinning(); await sleep(400); });
 await t('now spinning with no phase leaves the column null, not an error',async()=>{
   M.nowSpinning('a3','Track X'); await sleep(400);
   assert.equal(+q1(`select count(*) from now_spinning where user_id='${UID}' and phase is null`),1);
   M.stopSpinning(); await sleep(400); });
 await t('now spinning pause clears after delay',async()=>{ M.nowSpinning('a3','T'); await sleep(400); M.nowSpinningPaused(); await sleep(500); assert.equal(+q1(`select count(*) from now_spinning where user_id='${UID}'`),0); });
 await t('private record never spins',async()=>{ M.setVisibility('a4','private'); await M.syncNow(); M.nowSpinning('a4','T'); await sleep(400); assert.equal(+q1(`select count(*) from now_spinning where user_id='${UID}'`),0); });
 await t('offline => backoff then recovery',async()=>{ M.setRating('a5',3); offline=true; const r=await M.syncNow(); assert.equal(r.error.code,'offline',JSON.stringify(r)); assert.equal(M.status().sync,'offline');
   offline=false; await sleep(400); assert.equal(M.status().sync,'idle'); assert.equal(q1(`select rating from crate_items where user_id='${UID}' and release_id=(select id from releases where title='Album 5')`),'3'); });
 await t('key collisions + no-artist handled',async()=>{
   ALBUMS=[alb(1),alb(2),{...alb(2),id:'dup2'},{...alb(9),id:'na',artist:''}]; const r=await M.syncNow(); assert.equal(r.ok,true,JSON.stringify(r));
   const s=M.status().skipped; assert.equal(s.collisions,1); assert.equal(s.noArtist,1); });
 await t('rating out of range rejected locally',()=>{ const r=M.setRating('a1',9); assert.ok(!r||r.ok===false||M.getAlbumSocial('a1').rating!==9); });
 // ---------------------------------------------------------------------
 // RF3 (docs/12_REFINE.md): editing a note never erases a rating from
 // another device. Two parts: the server's own contract (sync_crate's null-
 // means-no-change / sentinel-clears semantics, migration 010_crate_merge.sql),
 // tested directly against sb.rpc so it holds regardless of what any given
 // client sends; and the real MizikiSocial client's own merge-before-push
 // fix (mergeFromServer(), called from every syncNow()), tested by swapping
 // X.state wholesale to simulate a second device on the same account -- the
 // exact same trick the "fresh device restores" test above already uses.
 // ---------------------------------------------------------------------
 await t('RF3 (server contract): a null payload field is "no change"; only the sentinel clears it',async()=>{
   const key=M.releaseKey('RF3 Artist','RF3 Direct Album');
   const base={release_key:key,title:'RF3 Direct Album',artist:'RF3 Artist',year:2020,quality_tier:null,pin_rank:null,visibility:null,added_at:null};
   const rowSql=`select coalesce(rating::text,'<null>')||'|'||coalesce(sleeve_note,'<null>') from crate_items where user_id='${UID}' and release_id=(select id from releases where release_key='${key}')`;
   let r=await sb.rpc('sync_crate',{p_items:[{...base,rating:4,sleeve_note:null}]});
   assert.equal(r.error,null,JSON.stringify(r));
   assert.equal(q1(rowSql),'4|<null>','device A sets a rating, says nothing about the note');
   r=await sb.rpc('sync_crate',{p_items:[{...base,rating:null,sleeve_note:'Great B-side.'}]});
   assert.equal(r.error,null,JSON.stringify(r));
   assert.equal(q1(rowSql),'4|Great B-side.','device B adds a note, saying nothing about rating -- the 4 must survive');
   r=await sb.rpc('sync_crate',{p_items:[{...base,rating:0,sleeve_note:null}]});
   assert.equal(r.error,null,JSON.stringify(r));
   assert.equal(q1(rowSql),'<null>|Great B-side.','the rating sentinel (0) clears it without touching the untouched note');
   r=await sb.rpc('sync_crate',{p_items:[{...base,rating:null,sleeve_note:''}]});
   assert.equal(r.error,null,JSON.stringify(r));
   assert.equal(q1(rowSql),'<null>|<null>','the sleeve_note sentinel (\'\') clears it too'); });
 await t('RF3 (client): a fresh "device B" on the same account adds a note without erasing device A\'s rating, and both devices end up seeing both',async()=>{
   const X=M._internals.X;
   const stateA=JSON.parse(JSON.stringify(X.state));
   M.setRating('a2',4);
   let r=await M.syncNow(); assert.equal(r.ok,true,JSON.stringify(r));
   assert.equal(q1(`select rating from crate_items where user_id='${UID}' and release_id=(select id from releases where title='Album 2')`),'4');
   // A fresh client state for the same account, never synced before --
   // buildItems() sends rating:null for a2 here, the exact shape that used
   // to wipe device A's rating outright before this PR's server fix.
   X.state={v:1,userId:null,settings:{shareNowSpinning:false,shareMilestones:false,syncEnabled:true,shareListeningRhythm:false},
     pins:[],items:{},synced:{},statsSynced:{},restoredFor:null};
   M.setNote('a2','Side B is better.');
   r=await M.syncNow(); assert.equal(r.ok,true,JSON.stringify(r));
   assert.equal(q1(`select rating||'|'||sleeve_note from crate_items where user_id='${UID}' and release_id=(select id from releases where title='Album 2')`),'4|Side B is better.');
   assert.equal(M.getAlbumSocial('a2').rating,4,'device B should pick up device A\'s rating via its own merge-on-pull, not just leave the server correct');
   // Device A, syncing again later, should likewise pick up device B's note.
   X.state=stateA;
   r=await M.syncNow(); assert.equal(r.ok,true,JSON.stringify(r));
   assert.equal(M.getAlbumSocial('a2').note,'Side B is better.','device A should see device B\'s note after its own next sync');
   assert.equal(M.getAlbumSocial('a2').rating,4,'and keep seeing its own rating'); });
 await t('own storefront reports a followers count, friend view does not',async()=>{
   // the follows_before_insert trigger forces a fresh row to 'pending' unless
   // the followee is public (amy is 'friends'), so force-accept afterward —
   // this is fixture setup, not a test of the accept workflow itself
   psql(`insert into follows(follower_id,followee_id) values ('${UID2}','${UID}') on conflict do nothing;
     insert into follows(follower_id,followee_id) values ('${UID}','${UID2}') on conflict do nothing;
     update follows set status='accepted' where (follower_id='${UID2}' and followee_id='${UID}') or (follower_id='${UID}' and followee_id='${UID2}')`);
   const mine=await M.loadProfile('ken'); assert.equal(mine.ok,true,JSON.stringify(mine));
   assert.equal(mine.isMe,true); assert.equal(mine.summary.followers,1,JSON.stringify(mine.summary));
   const theirs=await M.loadProfile('amy'); assert.equal(theirs.ok,true,JSON.stringify(theirs));
   assert.equal(theirs.isMe,false); assert.ok(theirs.canView,JSON.stringify(theirs));
   assert.ok(!('followers' in theirs.summary),JSON.stringify(theirs.summary)); });
 // ---------------------------------------------------------------------
 // DA5 (docs/DAY_ARC.md): the MizikiSocial-client half of listening
 // rhythm -- the shareListeningRhythm setting default, and
 // setListeningRhythm()/getListeningRhythm() against the real Postgres
 // backing this fake `sb` client (ken/UID is still signed in here, from
 // the init test at the top of this file). The RLS/visibility gating
 // itself (friend vs. stranger vs. blocked vs. signed-out) is already
 // covered at the SQL level further down -- this is just "does the JS
 // wrapper actually call the right thing, with the right validation."
 // ---------------------------------------------------------------------
 await t('shareListeningRhythm defaults to off',()=>{ assert.equal(M.getSettings().shareListeningRhythm,false); });
 await t('setListeningRhythm writes a valid payload, readable back via getListeningRhythm',async()=>{
   const r=await M.setListeningRhythm({verdict:'Mostly a night listener',shares:{night:0.6}});
   assert.equal(r.ok,true,JSON.stringify(r));
   const g=await M.getListeningRhythm(UID);
   assert.equal(g.ok,true,JSON.stringify(g));
   assert.equal(g.rhythm.verdict,'Mostly a night listener'); });
 await t('setListeningRhythm(null) clears it -- getListeningRhythm then reads null, not an error',async()=>{
   const r=await M.setListeningRhythm(null); assert.equal(r.ok,true,JSON.stringify(r));
   const g=await M.getListeningRhythm(UID); assert.equal(g.ok,true,JSON.stringify(g)); assert.equal(g.rhythm,null); });
 await t('setListeningRhythm rejects a malformed payload locally, before ever reaching Postgres',async()=>{
   const r=await M.setListeningRhythm({verdict:'x'}); // missing shares
   assert.equal(r.ok,false); assert.equal(r.error.code,'bad_listening_rhythm',JSON.stringify(r)); });
 await t('getListeningRhythm for someone who has never shared one reads null, not an error',async()=>{
   // amy (UID2) has no listening_rhythm set at all -- visible or not, there's
   // nothing there; the friend/stranger/blocked visibility gating itself is
   // the Postgres-level get_listening_rhythm tests further down this file
   const g=await M.getListeningRhythm(UID2); assert.equal(g.ok,true,JSON.stringify(g)); assert.equal(g.rhythm,null); });
 // ---------------------------------------------------------------------
 // B1 (step 05): library_backup, reserved handles, account deletion, and
 // the Oct 12 Security Advisor fixes (005_backup.sql). Raw SQL throughout
 // -- this PR is server-only, and the JS mock `sb` above has no insert/
 // update/delete on `.from()` to route these through, so these exercise
 // Postgres directly, the same way the follows-fixture setup just above
 // already does. New fixture users (not ken/amy) so nothing here can
 // collide with the tests above.
 // ---------------------------------------------------------------------
 const UID3='33333333-3333-3333-3333-333333333333', UID4='44444444-4444-4444-4444-444444444444';
 const DEV1='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', DEV2='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 psql(`insert into auth.users values ('${UID3}'),('${UID4}') on conflict do nothing;
   insert into profiles(id,handle,display_name,visibility) values ('${UID3}','cora','Cora','private'),('${UID4}','dale','Dale','private') on conflict do nothing`);
 // last line only (set_config's own output line, or an earlier statement's,
 // would otherwise shadow the thing we actually want) -- same convention
 // sb.rpc() above already uses.
 const lastLine = out => { const l=out.split('\n'); return l[l.length-1]; };
 const asUser = (uid, sql) => lastLine(psql(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false); ${sql}`));
 const asAnon = sql => lastLine(psql(`set role anon; ${sql}`));

 await t('library_backup: a user can insert and update their own row',()=>{
   asUser(UID3, `insert into library_backup(user_id,device_id,device_label,schema_version,doc) values ('${UID3}','${DEV1}','Test device',1,'{"a":1}'::jsonb)`);
   asUser(UID3, `update library_backup set doc='{"a":2}'::jsonb where user_id='${UID3}' and device_id='${DEV1}'`);
   assert.equal(asUser(UID3, `select doc->>'a' from library_backup where user_id='${UID3}' and device_id='${DEV1}'`), '2'); });

 await t('library_backup: two devices for the same user produce two rows, both readable',()=>{
   asUser(UID3, `insert into library_backup(user_id,device_id,device_label,schema_version,doc) values ('${UID3}','${DEV2}','Second device',1,'{"b":1}'::jsonb)`);
   assert.equal(asUser(UID3, `select count(*) from library_backup where user_id='${UID3}'`), '2'); });

 await t('library_backup: a user cannot read another user\'s rows',()=>{
   assert.equal(asUser(UID4, `select count(*) from library_backup where user_id='${UID3}'`), '0'); });

 await t('library_backup: a user cannot write another user\'s row',()=>{
   let threw=false;
   try{ asUser(UID4, `insert into library_backup(user_id,device_id,schema_version,doc) values ('${UID3}','${DEV1}',1,'{}'::jsonb)`); }
   catch(_e){ threw=true; }
   assert.ok(threw, 'expected RLS to reject a cross-user insert');
   // UPDATE just matches zero rows rather than throwing (USING, not WITH
   // CHECK) -- confirm the real owner's value is untouched by reading it
   // back as the real owner, not as the attacker (who can't see it either).
   asUser(UID4, `update library_backup set doc='{"x":1}'::jsonb where user_id='${UID3}' and device_id='${DEV1}'`);
   assert.equal(asUser(UID3, `select doc->>'a' from library_backup where user_id='${UID3}' and device_id='${DEV1}'`), '2'); });

 // RF25 point 3 (docs/12_REFINE.md, migration 018_stale_backup_devices.sql):
 // the stale-device notice's "Keep" button writes this one column via a
 // plain client update, no new RPC -- same library_backup_update policy
 // every other write to this table already goes through.
 await t('library_backup: a user can dismiss a stale-device notice on their own row',()=>{
   asUser(UID3, `update library_backup set stale_notice_dismissed_at=now() where user_id='${UID3}' and device_id='${DEV1}'`);
   assert.equal(asUser(UID3, `select stale_notice_dismissed_at is not null from library_backup where user_id='${UID3}' and device_id='${DEV1}'`), 't'); });

 await t('library_backup: a user cannot dismiss another user\'s stale-device notice',()=>{
   asUser(UID4, `update library_backup set stale_notice_dismissed_at=now() where user_id='${UID3}' and device_id='${DEV2}'`);
   assert.equal(asUser(UID3, `select stale_notice_dismissed_at is null from library_backup where user_id='${UID3}' and device_id='${DEV2}'`), 't'); });

 await t('library_backup: a user can delete their own stale device row',()=>{
   asUser(UID3, `delete from library_backup where user_id='${UID3}' and device_id='${DEV2}'`);
   assert.equal(asUser(UID3, `select count(*) from library_backup where user_id='${UID3}'`), '1'); });

 await t('library_backup: the size check rejects an oversized doc',()=>{
   const DEV3='cccccccc-cccc-cccc-cccc-cccccccccccc';
   let threw=false;
   try{ asUser(UID3, `insert into library_backup(user_id,device_id,schema_version,doc) values ('${UID3}','${DEV3}',1,jsonb_build_object('pad', repeat('x', 3*1024*1024)))`); }
   catch(_e){ threw=true; }
   assert.ok(threw, 'expected the size check to reject a 3MB doc');
   assert.equal(asUser(UID3, `select count(*) from library_backup where device_id='${DEV3}'`), '0'); });

 await t('reserved handles are rejected on insert; normal handles still work',()=>{
   const UID6='66666666-6666-6666-6666-666666666666';
   psql(`insert into auth.users values ('${UID6}') on conflict do nothing`);
   let threw=false;
   try{ psql(`insert into profiles(id,handle,visibility) values ('${UID6}','admin','private')`); }
   catch(e){ threw = /reserved/i.test(e.message); if(!threw) throw e; }
   assert.ok(threw, 'expected the reserved-handle trigger to fire for "admin"');
   assert.equal(q1(`select count(*) from profiles where id='${UID6}'`), '0');
   psql(`insert into profiles(id,handle,display_name,visibility) values ('${UID6}','frank','Frank','private')`);
   assert.equal(q1(`select handle from profiles where id='${UID6}'`), 'frank'); });

 await t('reserved handles are rejected on update too; existing rows are never retroactively checked',()=>{
   let threw=false;
   try{ psql(`update profiles set handle='staff' where id='66666666-6666-6666-6666-666666666666'`); }
   catch(e){ threw = /reserved/i.test(e.message); if(!threw) throw e; }
   assert.ok(threw);
   assert.equal(q1(`select handle from profiles where id='66666666-6666-6666-6666-666666666666'`), 'frank');
   // ken/amy (inserted long before this trigger existed) are untouched -- a
   // BEFORE trigger only ever fires on a future write, never a backfill.
   assert.equal(q1(`select handle from profiles where id='${UID}'`), 'ken'); });

 await t('the four RLS helpers now live in private, not public (API-schema lockout)',()=>{
   for(const n of ['is_blocked_between','item_visibility','effective_visibility','can_view']){
     const schema=q1(`select nspname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where p.proname='${n}' and ns.nspname in ('public','private')`);
     assert.equal(schema, 'private', n+' should be in schema private, found '+JSON.stringify(schema));
   } });

 await t('anon cannot call the four helpers directly',()=>{
   for(const call of [
     `select private.is_blocked_between('${UID3}'::uuid,'${UID4}'::uuid)`,
     `select private.item_visibility('${UID3}'::uuid, (select id from releases limit 1))`,
     `select private.effective_visibility('${UID3}'::uuid, null::public.visibility_level)`,
     `select private.can_view('${UID3}'::uuid)`]){
     let threw=false;
     try{ asAnon(call); } catch(e){ threw=/permission denied/i.test(e.message); if(!threw) throw e; }
     assert.ok(threw, 'expected permission denied for: '+call);
   } });

 await t('authenticated keeps direct execute on the four helpers (what the RLS policies themselves rely on)',()=>{
   assert.doesNotThrow(()=> asUser(UID3, `select private.can_view('${UID3}'::uuid)`)); });

 await t('sync_crate attributes a newly-created release to the caller (created_by)',()=>{
   asUser(UID3, `select sync_crate('[{"release_key":"createdbykey1","title":"CB Album","artist":"CB Artist"}]'::jsonb, true)`);
   assert.equal(q1(`select created_by from releases where release_key='createdbykey1'`), UID3); });

 await t('a direct insert into releases with someone else\'s created_by is rejected',()=>{
   let threw=false;
   try{ asUser(UID3, `insert into releases(release_key,title,artist,created_by) values ('createdbykey2','CB2','CB2 Artist','${UID4}')`); }
   catch(e){ threw=/row-level security|permission denied/i.test(e.message); if(!threw) throw e; }
   assert.ok(threw, 'expected RLS to reject created_by spoofing');
   assert.equal(q1(`select count(*) from releases where release_key='createdbykey2'`), '0'); });

 await t('delete_my_account removes the caller\'s auth user, profile, crate, follows and backup rows -- and leaves everyone else untouched',async()=>{
   const UID5='55555555-5555-5555-5555-555555555555';
   psql(`insert into auth.users values ('${UID5}') on conflict do nothing;
     insert into profiles(id,handle,display_name,visibility) values ('${UID5}','erin','Erin','public') on conflict do nothing;
     insert into follows(follower_id,followee_id,status) values ('${UID5}','${UID3}','accepted') on conflict do nothing;
     insert into library_backup(user_id,device_id,schema_version,doc) values ('${UID5}','dddddddd-dddd-dddd-dddd-dddddddddddd',1,'{}'::jsonb) on conflict do nothing;
     insert into releases(release_key,title,artist) values ('erin-delete-test-key','Erin Test Album','Erin Test Artist') on conflict do nothing;
     insert into crate_items(user_id,release_id,quality_tier) select '${UID5}', id, 2 from releases where release_key='erin-delete-test-key' on conflict (user_id,release_id) do nothing`);
   assert.equal(q1(`select count(*) from crate_items where user_id='${UID5}'`), '1');
   asUser(UID5, `select delete_my_account()`);
   assert.equal(q1(`select count(*) from auth.users where id='${UID5}'`), '0');
   assert.equal(q1(`select count(*) from profiles where id='${UID5}'`), '0');
   assert.equal(q1(`select count(*) from follows where follower_id='${UID5}'`), '0');
   assert.equal(q1(`select count(*) from library_backup where user_id='${UID5}'`), '0');
   assert.equal(q1(`select count(*) from crate_items where user_id='${UID5}'`), '0');
   assert.equal(q1(`select count(*) from profiles where id='${UID3}'`), '1');
   assert.equal(q1(`select count(*) from library_backup where user_id='${UID3}'`), '2'); });

 await t('delete_my_account can only ever remove the caller\'s own account',()=>{
   asUser(UID4, `select delete_my_account()`); // deletes UID4, and only UID4
   assert.equal(q1(`select count(*) from auth.users where id='${UID4}'`), '0');
   assert.equal(q1(`select count(*) from profiles where id='${UID3}'`), '1');
   assert.equal(q1(`select count(*) from library_backup where user_id='${UID3}'`), '2'); });

 // ---------------------------------------------------------------------
 // B3 (step 06): two real devices, sharing one account, syncing their
 // play counts through the real library_backup table. The merge logic
 // itself (sum/max/union/last-write-wins) already has its own thorough,
 // DB-free tests in tests/unit/backup-merge.test.js -- this one checks
 // the actual wiring end to end: each device's own toDoc()/fromDocs()
 // (src/sync/backup-doc.js, loaded for real via dynamic import, since
 // this file is CommonJS) writing to and reading from Postgres through
 // the real RLS policies, not a stand-in.
 // ---------------------------------------------------------------------
 const { toDoc, fromDocs } = await import('../src/sync/backup-doc.js');
 const { trackIdentityKey } = await import('../src/record-art/tiers.js');
 const UID7 = '77777777-7777-7777-7777-777777777777';
 const DEVA = 'a0000000-0000-0000-0000-00000000000a', DEVB = 'b0000000-0000-0000-0000-00000000000b';
 psql(`insert into auth.users values ('${UID7}') on conflict do nothing;
   insert into profiles(id,handle,display_name,visibility) values ('${UID7}','gail','Gail','private') on conflict do nothing`);

 // fetches every row library_backup's RLS will actually hand back for
 // UID7 (sign-in + pull, from whichever device is asking) and shapes it
 // the way fromDocs() expects: the doc plus its own deviceId
 function pullRows(asUid){
   const rows = JSON.parse(asUser(asUid, `select coalesce(jsonb_agg(jsonb_build_object('deviceId', device_id, 'doc', doc)), '[]') from library_backup where user_id='${UID7}'`));
   return rows.map(r => Object.assign({}, r.doc, { deviceId: r.deviceId }));
 }
 function pushDoc(asUid, deviceId, label, localState){
   const doc = toDoc(localState);
   asUser(asUid, `insert into library_backup(user_id,device_id,device_label,schema_version,doc)
     values ('${UID7}','${deviceId}','${label}',1,'${JSON.stringify(doc).replace(/'/g,"''")}'::jsonb)
     on conflict (user_id,device_id) do update set doc=excluded.doc`);
 }
 const SONG_KEY = trackIdentityKey({ tags: { artist: 'Band', album: 'Record', title: 'Song' } });
 const baseLocal = deviceId => ({
   deviceId, historyClearedAt: 0, tracks: [{ id: 't1', tags: { title: 'Song', artist: 'Band', album: 'Record' } }],
   playlists: [], albumOrder: {}, albumSort: {}, albumDisplay: {}, trackDisplay: {}, albumEdge: {}, albumLookPref: {},
   prefs: {}, profileName: '',
   trackPlayCounts: {}, sessionCounts: {}, metalEligibleSessions: {}, trackMetalEligiblePlays: {},
   trackLastPlayed: {}, albumLastPlayed: {}, rareUnlocked: {}, achievements: {}, collection: {},
   sealedIds: [], brokenSealIds: [], overlaysRaw: [], updatedAt: {},
 });

 await t('two devices, one account: sign in, play, sync, play, sync -- the total goes up by exactly two',()=>{
   // device A signs in first (nothing on the server yet), plays one song,
   // and pushes its own doc
   const localA = baseLocal(DEVA);
   localA.trackPlayCounts = { [SONG_KEY]: 1 };
   pushDoc(UID7, DEVA, 'Device A', localA);

   // device B signs in for the first time on this account: pulls
   // (device A's row only) and merges -- the "first sign-in merge" path
   const mergedOnB = fromDocs(baseLocal(DEVB), pullRows(UID7));
   assert.equal(mergedOnB.totals.counters.trackPlayCounts[SONG_KEY], 1);

   // device B plays the same song once on its own, independent of A's
   // count, then pushes its own doc
   const localB = baseLocal(DEVB);
   localB.trackPlayCounts = { [SONG_KEY]: 1 };
   pushDoc(UID7, DEVB, 'Device B', localB);

   // device A syncs again: pulls both rows (its own + B's) and merges --
   // per-device counters are summed, never double-counted
   const mergedOnA = fromDocs(localA, pullRows(UID7));
   assert.equal(mergedOnA.totals.counters.trackPlayCounts[SONG_KEY], 2);

   // syncing the exact same rows again must never inflate the total
   const mergedAgain = fromDocs(localA, pullRows(UID7));
   assert.equal(mergedAgain.totals.counters.trackPlayCounts[SONG_KEY], 2);

   assert.equal(q1(`select count(*) from library_backup where user_id='${UID7}'`), '2'); });

 await t('a full-scope clear on one device wins everywhere once synced',()=>{
   // device A clears listening history locally (bumps its own
   // historyClearedAt) and pushes -- its own trackPlayCounts resets to {}
   // in the same local action, matching history/clear.js's real behavior
   const localA = baseLocal(DEVA);
   localA.historyClearedAt = Date.now();
   localA.trackPlayCounts = {};
   pushDoc(UID7, DEVA, 'Device A', localA);

   // device B, still holding its own pre-clear count, syncs: its row is
   // older than the clear, so fromDocs reports ownReset and excludes it
   // from the merged totals -- device B's own next upload should zero
   // itself and adopt the newer historyClearedAt (the caller's job, not
   // fromDocs' own -- checked here is exactly what fromDocs reports)
   const localB = baseLocal(DEVB);
   localB.trackPlayCounts = { [SONG_KEY]: 1 }; // B's own stale, pre-clear count
   const merged = fromDocs(localB, pullRows(UID7));
   assert.equal(merged.ownReset, true);
   assert.equal(merged.totals.counters.trackPlayCounts[SONG_KEY] || 0, 0); });

 // ---------------------------------------------------------------------
 // B4 (step 07): migration 006's Storage policies, exercised against
 // this file's own minimal storage.objects/storage.buckets stub (see
 // tests/supabase_stub.sql) with real Postgres roles and auth.uid() --
 // the same "real RLS, not a real Storage API" approach the rest of this
 // file already takes for auth.users. What this can't cover -- the
 // Storage API's own file_size_limit/allowed_mime_types enforcement, and
 // actual byte upload/download -- isn't RLS and isn't testable here; see
 // docs/SUPABASE_SETUP.md's manual check for that.
 // ---------------------------------------------------------------------
 const UID8='88888888-8888-8888-8888-888888888888', UID9='99999999-9999-9999-9999-999999999999';
 psql(`insert into auth.users values ('${UID8}'),('${UID9}') on conflict do nothing;
   insert into profiles(id,handle,display_name,visibility) values ('${UID8}','hank','Hank','private'),('${UID9}','ivy','Ivy','private') on conflict do nothing`);

 await t('covers: a user can insert, read and delete their own file',()=>{
   asUser(UID8, `insert into storage.objects(bucket_id,name,owner) values ('covers','${UID8}/hash1.jpg','${UID8}')`);
   assert.equal(asUser(UID8, `select count(*) from storage.objects where bucket_id='covers' and name='${UID8}/hash1.jpg'`), '1');
   asUser(UID8, `delete from storage.objects where bucket_id='covers' and name='${UID8}/hash1.jpg'`);
   assert.equal(asUser(UID8, `select count(*) from storage.objects where bucket_id='covers' and name='${UID8}/hash1.jpg'`), '0'); });

 await t('covers: another user can neither read nor write someone else\'s folder',()=>{
   asUser(UID8, `insert into storage.objects(bucket_id,name,owner) values ('covers','${UID8}/hash2.jpg','${UID8}')`);
   assert.equal(asUser(UID9, `select count(*) from storage.objects where bucket_id='covers' and name='${UID8}/hash2.jpg'`), '0');
   let threw=false;
   try{ asUser(UID9, `insert into storage.objects(bucket_id,name,owner) values ('covers','${UID8}/hash3.jpg','${UID9}')`); }
   catch(_e){ threw=true; }
   assert.ok(threw, 'expected RLS to reject a cross-user covers insert');
   asUser(UID9, `delete from storage.objects where bucket_id='covers' and name='${UID8}/hash2.jpg'`);
   assert.equal(asUser(UID8, `select count(*) from storage.objects where bucket_id='covers' and name='${UID8}/hash2.jpg'`), '1', 'the attacker\'s delete must match zero rows, leaving the real file untouched'); });

 await t('avatars: anyone signed in can read, but only the owner can write',()=>{
   asUser(UID8, `insert into storage.objects(bucket_id,name,owner) values ('avatars','${UID8}/avatar-hash1.jpg','${UID8}')`);
   assert.equal(asUser(UID9, `select count(*) from storage.objects where bucket_id='avatars' and name='${UID8}/avatar-hash1.jpg'`), '1', 'a public bucket\'s files should be readable by any authenticated user');
   assert.equal(asAnon(`select count(*) from storage.objects where bucket_id='avatars' and name='${UID8}/avatar-hash1.jpg'`), '1', 'and by a signed-out (anon) request too');
   // UPDATE's USING clause can either throw or just match zero rows --
   // either way is fine here, so this doesn't assert on which happened,
   // only that the real file below is left untouched
   try{ asUser(UID9, `update storage.objects set name='${UID8}/avatar-stolen.jpg' where bucket_id='avatars' and name='${UID8}/avatar-hash1.jpg'`); }
   catch(_e){ /* either outcome is acceptable here */ }
   assert.equal(asUser(UID8, `select count(*) from storage.objects where bucket_id='avatars' and name='${UID8}/avatar-hash1.jpg'`), '1'); });

 await t('deleteAccount lists and removes the caller\'s own covers and avatars before the RPC call',async()=>{
   // the JS-level half of account deletion's Storage cleanup
   // (src/miziki-social.js's deleteAccount(), since Storage objects have
   // no foreign key to auth.users for delete_my_account()'s own cascades
   // to reach) -- exercised here against this test file's own fake `sb`
   // client (see its storage stub above M.init()), which just records
   // what it was asked to list/remove rather than touching Postgres.
   storageCalls.length = 0;
   const r = await M.deleteAccount();
   assert.equal(r.ok, true, JSON.stringify(r));
   assert.ok(storageCalls.some(c => c.op==='list' && c.bucket==='covers'), JSON.stringify(storageCalls));
   assert.ok(storageCalls.some(c => c.op==='list' && c.bucket==='avatars'), JSON.stringify(storageCalls));
   assert.ok(storageCalls.some(c => c.op==='remove' && c.bucket==='covers'), JSON.stringify(storageCalls));
   assert.ok(storageCalls.some(c => c.op==='remove' && c.bucket==='avatars'), JSON.stringify(storageCalls)); });

 // ---------------------------------------------------------------------
 // DA5 (docs/DAY_ARC.md, migration 007_rhythm.sql): get_listening_rhythm()
 // -- the one new server-side surface this step adds. The column itself
 // (profiles.listening_rhythm) is written by the owner through the
 // ordinary column-grant + updateProfile() mechanism (not re-tested here
 // -- it's the exact same mechanism 001's own display_name/bio grant
 // already uses, already covered by this file's profile-write coverage
 // elsewhere); what's new and actually worth its own RLS test is reading
 // *someone else's* value, gated by can_view(owner, null) rather than by
 // profiles_select (which stays deliberately blanket -- see 007's own
 // comment for why). Fresh fixture users, not ken/amy/cora/dale/etc., so
 // nothing here can collide with any test above.
 // ---------------------------------------------------------------------
 const RUID_OWNER='c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
       RUID_FRIEND='c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
       RUID_STRANGER='c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3',
       RUID_BLOCKED='c4c4c4c4-c4c4-c4c4-c4c4-c4c4c4c4c4c4';
 const RHYTHM_PAYLOAD = `'{"verdict":"Mostly a night listener","shares":{"night":0.6}}'::jsonb`;
 psql(`insert into auth.users values ('${RUID_OWNER}'),('${RUID_FRIEND}'),('${RUID_STRANGER}'),('${RUID_BLOCKED}') on conflict do nothing;
   insert into profiles(id,handle,display_name,visibility) values
     ('${RUID_OWNER}','rhyown','Rhy Owner','friends'),
     ('${RUID_FRIEND}','rhyfriend','Rhy Friend','friends'),
     ('${RUID_STRANGER}','rhystranger','Rhy Stranger','friends'),
     ('${RUID_BLOCKED}','rhyblocked','Rhy Blocked','friends')
   on conflict do nothing`);
 // an accepted, one-directional follow (friend -> owner) is exactly what
 // can_view(owner, null)'s own 'friends' branch checks -- see 001_schema.sql.
 // follows_before_insert always recomputes NEW.status itself (auto-accept
 // only for a *public* followee, 'pending' otherwise) regardless of what
 // the insert names, so -- same two-step dance the fixture setup at the
 // top of this file already uses for exactly this reason -- insert, then
 // force-accept with a separate update.
 psql(`insert into follows(follower_id,followee_id) values
     ('${RUID_FRIEND}','${RUID_OWNER}'),
     ('${RUID_BLOCKED}','${RUID_OWNER}')
   on conflict do nothing;
   update follows set status='accepted'
     where followee_id='${RUID_OWNER}' and follower_id in ('${RUID_FRIEND}','${RUID_BLOCKED}');
   insert into blocks(blocker_id,blocked_id) values ('${RUID_OWNER}','${RUID_BLOCKED}') on conflict do nothing`);
 asUser(RUID_OWNER, `update profiles set listening_rhythm=${RHYTHM_PAYLOAD} where id='${RUID_OWNER}'`);

 await t('get_listening_rhythm: the owner always sees their own value',()=>{
   assert.equal(asUser(RUID_OWNER, `select get_listening_rhythm('${RUID_OWNER}')->>'verdict'`), 'Mostly a night listener'); });

 await t('get_listening_rhythm: a friend (accepted follow, owner visibility friends) sees it',()=>{
   assert.equal(asUser(RUID_FRIEND, `select get_listening_rhythm('${RUID_OWNER}')->>'verdict'`), 'Mostly a night listener'); });

 await t('get_listening_rhythm: a stranger (no follow relationship) never sees it',()=>{
   assert.equal(asUser(RUID_STRANGER, `select coalesce(get_listening_rhythm('${RUID_OWNER}')::text,'null')`), 'null'); });

 await t('get_listening_rhythm: a blocked account never sees it, even with an accepted follow',()=>{
   assert.equal(asUser(RUID_BLOCKED, `select coalesce(get_listening_rhythm('${RUID_OWNER}')::text,'null')`), 'null'); });

 await t('get_listening_rhythm: a signed-out (anon) request never sees it',()=>{
   assert.equal(asAnon(`select coalesce(get_listening_rhythm('${RUID_OWNER}')::text,'null')`), 'null'); });

 await t('get_listening_rhythm: an owner with visibility private is never visible to a friend',()=>{
   asUser(RUID_OWNER, `update profiles set visibility='private' where id='${RUID_OWNER}'`);
   assert.equal(asUser(RUID_FRIEND, `select coalesce(get_listening_rhythm('${RUID_OWNER}')::text,'null')`), 'null');
   // owner can still always see their own, regardless of their own visibility
   assert.equal(asUser(RUID_OWNER, `select get_listening_rhythm('${RUID_OWNER}')->>'verdict'`), 'Mostly a night listener');
   asUser(RUID_OWNER, `update profiles set visibility='friends' where id='${RUID_OWNER}'`); });

 await t('get_listening_rhythm: a null column value reads back null, not an error, once cleared',()=>{
   asUser(RUID_OWNER, `update profiles set listening_rhythm=null where id='${RUID_OWNER}'`);
   assert.equal(asUser(RUID_OWNER, `select coalesce(get_listening_rhythm('${RUID_OWNER}')::text,'null')`), 'null');
   assert.equal(asUser(RUID_FRIEND, `select coalesce(get_listening_rhythm('${RUID_OWNER}')::text,'null')`), 'null'); });

 await t('listening_rhythm: the size check rejects an oversized payload',()=>{
   let threw=false;
   try{ asUser(RUID_OWNER, `update profiles set listening_rhythm=jsonb_build_object('pad', repeat('x', 3*1024)) where id='${RUID_OWNER}'`); }
   catch(_e){ threw=true; }
   assert.ok(threw, 'expected the 2000-byte check to reject an oversized listening_rhythm value'); });

 // DA6 (docs/DAY_ARC.md, migration 008_spin_phase.sql): now_spinning.phase's
 // own check constraint, and the "exactly one set_now_spinning, not two
 // overloads" requirement the migration's own drop-then-create exists for.
 // The JS-level nowSpinning()/phase round-trip tests live up with the rest
 // of the "now spinning" section above (M is the real client, same real
 // Postgres backend) -- this section is the lower-level SQL the doc's own
 // point 3 ("set_now_spinning accepts and rejects phases per the check
 // constraint... no stray overload remains") asks for directly.
 //
 // Its own fresh fixture user, not UID -- by this point in the file, UID's
 // own auth.users row no longer exists (the "deleteAccount lists and
 // removes..." test above genuinely deletes it, via the real
 // delete_my_account() RPC, acting as whatever `uid` the module-level
 // closure variable still holds) -- the same "fresh fixture users, so
 // nothing here can collide with any test above" reasoning the DA5
 // section right above this one already states for its own RUID_* users.
 const SUID='d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1';
 psql(`insert into auth.users values ('${SUID}') on conflict do nothing;
   insert into profiles(id,handle,display_name,visibility) values ('${SUID}','spinphasetest','Spin Phase Test','public')
   on conflict do nothing`);
 await t('now_spinning.phase: the check constraint accepts every one of the seven phase names',()=>{
   asUser(SUID, `insert into releases(release_key,title,artist) values ('phase-accept-rel','Phase Accept','Artist') on conflict do nothing`);
   const relId = asUser(SUID, `select id from releases where release_key='phase-accept-rel'`);
   for(const phase of ['night','dawn','morning','midday','afternoon','golden','twilight']){
     asUser(SUID, `insert into now_spinning(user_id,release_id,phase) values ('${SUID}','${relId}','${phase}')
       on conflict (user_id) do update set release_id=excluded.release_id, phase=excluded.phase`);
     assert.equal(asUser(SUID, `select phase from now_spinning where user_id='${SUID}'`), phase);
   }
   asUser(SUID, `delete from now_spinning where user_id='${SUID}'`); });
 await t('now_spinning.phase: the check constraint rejects a phase name outside the seven',()=>{
   asUser(SUID, `insert into releases(release_key,title,artist) values ('phase-check-rel','Phase Check','Artist') on conflict do nothing`);
   const relId = asUser(SUID, `select id from releases where release_key='phase-check-rel'`);
   let threw=false;
   try{ asUser(SUID, `insert into now_spinning(user_id,release_id,phase) values ('${SUID}','${relId}','not-a-real-phase')
     on conflict (user_id) do update set release_id=excluded.release_id, phase=excluded.phase`); }
   catch(e){ threw = /now_spinning_phase_check/.test(e.message) || /violates check constraint/.test(e.message); }
   assert.ok(threw, 'expected the phase check constraint (not some other error) to reject an unlisted value'); });
 await t('set_now_spinning: still works called with no p_phase at all (an older client)',()=>{
   asUser(SUID, `select set_now_spinning('older-client-rel','Older Client','Artist')`);
   assert.equal(asUser(SUID, `select coalesce(phase,'null') from now_spinning where user_id='${SUID}'`),'null');
   asUser(SUID, `select clear_now_spinning()`); });
 await t('set_now_spinning: exactly one overload exists after the migration, not two',()=>{
   assert.equal(q1(`select count(*) from pg_proc where proname='set_now_spinning' and pronamespace=(select oid from pg_namespace where nspname='public')`), '1'); });

 // RF2 (docs/12_REFINE.md, migration 009_feed_privacy.sql): hiding a record
 // used to leave its 'added'/'unlock' feed_events rows in place -- only
 // 'pinned'/'review' were ever deleted when visibility went private. Fresh
 // fixture users, not UID/UID2 -- by this point in the file UID's own
 // auth.users row no longer exists (the real deleteAccount() test above
 // genuinely deletes it), the same reasoning the DA5/DA6 sections above
 // already state for their own RUID_*/SUID fixture users.
 const FUID_A='e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1',
       FUID_B='e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2';
 psql(`insert into auth.users values ('${FUID_A}'),('${FUID_B}') on conflict do nothing;
   insert into profiles(id,handle,display_name,visibility) values
     ('${FUID_A}','rf2owner','RF2 Owner','friends'),
     ('${FUID_B}','rf2friend','RF2 Friend','friends')
   on conflict do nothing;
   insert into follows(follower_id,followee_id) values ('${FUID_B}','${FUID_A}') on conflict do nothing;
   update follows set status='accepted' where follower_id='${FUID_B}' and followee_id='${FUID_A}'`);

 await t('RF2: going private removes the added event too, not just pinned/review',()=>{
   asUser(FUID_A, `insert into releases(release_key,title,artist) values ('rf2-rel-1','RF2 Album','RF2 Artist') on conflict do nothing`);
   const relId = asUser(FUID_A, `select id from releases where release_key='rf2-rel-1'`);
   asUser(FUID_A, `insert into crate_items(user_id,release_id,visibility) values ('${FUID_A}','${relId}','public')
     on conflict (user_id,release_id) do update set visibility=excluded.visibility`);
   assert.equal(asUser(FUID_B, `select count(*) from home_feed_rich() where release_id='${relId}' and type='added'`), '1',
     'a friend sees the added event while the record is public');
   asUser(FUID_A, `update crate_items set visibility='private' where user_id='${FUID_A}' and release_id='${relId}'`);
   assert.equal(asUser(FUID_B, `select count(*) from home_feed_rich() where release_id='${relId}' and type='added'`), '0',
     'a friend must no longer see it once the record is private');
   assert.equal(asUser(FUID_A, `select count(*) from feed_events where actor_id='${FUID_A}' and release_id='${relId}'`), '0',
     'the private item leaves no feed_events row at all, not a hidden one'); });

 // RF21 (docs/12_REFINE.md, migration 016_quieter_broadcast.sql): a metal
 // unlock no longer posts to the feed at all -- superseding the RF2-era
 // test this replaces (which asserted the opposite: that an 'unlock' row
 // existed while public, and was removed only once private). There is
 // now no 'unlock' row to remove in either state.
 await t('RF21: a metal unlock never posts to the feed, public or private',()=>{
   asUser(FUID_A, `insert into releases(release_key,title,artist) values ('rf2-rel-2','RF2 Album 2','RF2 Artist') on conflict do nothing`);
   const relId = asUser(FUID_A, `select id from releases where release_key='rf2-rel-2'`);
   asUser(FUID_A, `insert into crate_items(user_id,release_id,visibility) values ('${FUID_A}','${relId}','public')
     on conflict (user_id,release_id) do update set visibility=excluded.visibility`);
   asUser(FUID_A, `insert into verified_stats(user_id,release_id,unlocked_variant) values ('${FUID_A}','${relId}','gold')
     on conflict (user_id,release_id) do update set unlocked_variant=excluded.unlocked_variant`);
   assert.equal(asUser(FUID_B, `select count(*) from home_feed_rich() where release_id='${relId}' and type='unlock'`), '0',
     'a friend never sees an unlock event, even while the metal and the record are both public');
   assert.equal(asUser(FUID_A, `select count(*) from feed_events where actor_id='${FUID_A}' and release_id='${relId}' and type='unlock'`), '0',
     'no unlock row exists at all, not merely a hidden one'); });

 await t('RF2/RF21: deleting a crate item entirely removes its added events (crate_items_after_delete)',()=>{
   asUser(FUID_A, `insert into releases(release_key,title,artist) values ('rf2-rel-3','RF2 Album 3','RF2 Artist') on conflict do nothing`);
   const relId = asUser(FUID_A, `select id from releases where release_key='rf2-rel-3'`);
   asUser(FUID_A, `insert into crate_items(user_id,release_id,visibility) values ('${FUID_A}','${relId}','public')
     on conflict (user_id,release_id) do update set visibility=excluded.visibility`);
   asUser(FUID_A, `insert into verified_stats(user_id,release_id,unlocked_variant) values ('${FUID_A}','${relId}','silver')
     on conflict (user_id,release_id) do update set unlocked_variant=excluded.unlocked_variant`);
   // RF21: just the 'added' row now -- the unlock no longer wrote one.
   assert.ok(+asUser(FUID_A, `select count(*) from feed_events where actor_id='${FUID_A}' and release_id='${relId}'`) >= 1);
   asUser(FUID_A, `delete from crate_items where user_id='${FUID_A}' and release_id='${relId}'`);
   assert.equal(asUser(FUID_A, `select count(*) from feed_events where actor_id='${FUID_A}' and release_id='${relId}'`), '0',
     'removing the record from the crate removes every one of its feed_events rows'); });

 await t('RF21: home_feed_rich expires a caller\'s own feed_events rows older than 45 days on every read',()=>{
   asUser(FUID_A, `insert into releases(release_key,title,artist) values ('rf21-expiry','RF21 Expiry','RF21 Artist') on conflict do nothing`);
   const relId = asUser(FUID_A, `select id from releases where release_key='rf21-expiry'`);
   q1(`insert into feed_events(actor_id,type,release_id,payload,created_at)
     values ('${FUID_A}','added','${relId}','{"count":1}'::jsonb, now() - interval '46 days')`);
   assert.equal(asUser(FUID_A, `select count(*) from feed_events where actor_id='${FUID_A}' and release_id='${relId}'`), '1',
     'the stale row is really there before any read');
   asUser(FUID_A, `select count(*) from home_feed_rich()`);  // the read itself is what triggers the sweep
   assert.equal(asUser(FUID_A, `select count(*) from feed_events where actor_id='${FUID_A}' and release_id='${relId}'`), '0',
     'reading the feed expired the caller\'s own stale row'); });

 await t('rebuild_feed_events: reproduces the same visible feed the triggers would, repairing a stale row a bad trigger left behind',()=>{
   asUser(FUID_A, `insert into releases(release_key,title,artist) values ('rf2-rel-4','RF2 Rebuild Public','RF2 Artist') on conflict do nothing`);
   const relPublic = asUser(FUID_A, `select id from releases where release_key='rf2-rel-4'`);
   asUser(FUID_A, `insert into releases(release_key,title,artist) values ('rf2-rel-5','RF2 Rebuild Private','RF2 Artist') on conflict do nothing`);
   const relPrivate = asUser(FUID_A, `select id from releases where release_key='rf2-rel-5'`);
   asUser(FUID_A, `insert into crate_items(user_id,release_id,visibility,pin_rank) values ('${FUID_A}','${relPublic}','public',null)
     on conflict (user_id,release_id) do update set visibility=excluded.visibility`);
   asUser(FUID_A, `insert into crate_items(user_id,release_id,visibility) values ('${FUID_A}','${relPrivate}','private')
     on conflict (user_id,release_id) do update set visibility=excluded.visibility`);
   // simulate the exact damage a bad trigger (pre-009) would have left: a
   // stale 'added' row for the private item. A plain q1()/psql() call runs
   // as the superuser the test harness connects as (no "set role"/jwt
   // claim, unlike asUser()), so this writes the row directly rather than
   // going through crate_items_emit_events at all -- modeling "the trigger
   // itself was wrong for a while," not a way around today's fixed one.
   q1(`insert into feed_events(actor_id,type,release_id,payload) values ('${FUID_A}','added','${relPrivate}','{"count":1}'::jsonb)`);
   assert.equal(asUser(FUID_A, `select count(*) from feed_events where actor_id='${FUID_A}' and release_id='${relPrivate}'`), '1',
     'the stale row is really there before the rebuild');
   asUser(FUID_A, `select rebuild_feed_events('${FUID_A}')`);
   assert.equal(asUser(FUID_A, `select count(*) from feed_events where actor_id='${FUID_A}' and release_id='${relPrivate}'`), '0',
     'rebuild_feed_events drops the stale private-item row, same as the fixed trigger would have');
   assert.equal(asUser(FUID_A, `select count(*) from feed_events where actor_id='${FUID_A}' and release_id='${relPublic}' and type='added'`), '1',
     'the still-public item\'s own added event survives the rebuild'); });

 await t('rebuild_feed_events: can only ever rebuild the callers own feed',()=>{
   let threw = false;
   try{ asUser(FUID_B, `select rebuild_feed_events('${FUID_A}')`); }
   catch(e){ threw = /can only rebuild your own feed/.test(e.message); }
   assert.ok(threw, 'expected rebuild_feed_events to refuse rebuilding someone elses feed'); });

 await t('RF21: rebuild_feed_events never resurrects an unlock row',()=>{
   asUser(FUID_A, `insert into releases(release_key,title,artist) values ('rf21-rebuild','RF21 Rebuild','RF21 Artist') on conflict do nothing`);
   const relId = asUser(FUID_A, `select id from releases where release_key='rf21-rebuild'`);
   asUser(FUID_A, `insert into crate_items(user_id,release_id,visibility) values ('${FUID_A}','${relId}','public')
     on conflict (user_id,release_id) do update set visibility=excluded.visibility`);
   asUser(FUID_A, `insert into verified_stats(user_id,release_id,unlocked_variant) values ('${FUID_A}','${relId}','platinum')
     on conflict (user_id,release_id) do update set unlocked_variant=excluded.unlocked_variant`);
   asUser(FUID_A, `select rebuild_feed_events('${FUID_A}')`);
   assert.equal(asUser(FUID_A, `select count(*) from feed_events where actor_id='${FUID_A}' and release_id='${relId}' and type='unlock'`), '0',
     'the repair path must not bring back a kind of row the feed no longer carries'); });

 // RF5 (docs/12_REFINE.md, point 1 -- migrations ledger, migration
 // 012_migrations_log.sql): private.schema_migrations backfilled 1-11 plus
 // its own version 12, and never reachable through the Data API roles.
 await t('migrations ledger: versions 1-12 are all present, in private (not public)',()=>{
   assert.equal(q1(`select nspname from pg_namespace n join pg_class c on c.relnamespace=n.oid where c.relname='schema_migrations'`),'private');
   assert.equal(q1(`select count(*) from private.schema_migrations where version between 1 and 12`),'12'); });
 await t('migrations ledger: neither anon nor authenticated can read or write it',()=>{
   let threw=false;
   try{ psql(`set role anon; select count(*) from private.schema_migrations`); }
   catch(e){ threw = /permission denied/.test(e.message); }
   assert.ok(threw, 'expected anon to be refused select on private.schema_migrations');
   threw=false;
   try{ psql(`set role authenticated; select count(*) from private.schema_migrations`); }
   catch(e){ threw = /permission denied/.test(e.message); }
   assert.ok(threw, 'expected authenticated to be refused select on private.schema_migrations too');
   threw=false;
   try{ psql(`set role authenticated; insert into private.schema_migrations(version) values (999)`); }
   catch(e){ threw = /permission denied/.test(e.message); }
   assert.ok(threw, 'expected authenticated to be refused insert on private.schema_migrations'); });
 await t('migrations ledger: a double-apply of the same version fails loudly (primary key), the backfill pattern does not',()=>{
   let threw=false;
   try{ psql(`insert into private.schema_migrations(version) values (12)`); }
   catch(e){ threw = /duplicate key value violates unique constraint/.test(e.message); }
   assert.ok(threw, 'expected a bare re-insert of an existing version to violate the primary key');
   // the bulk-backfill shape 012 itself uses for 1-11 (on conflict do
   // nothing) stays a safe no-op, confirming later migrations only need
   // the plain, loud-on-conflict insert for their own single new version
   assert.doesNotThrow(() => psql(`insert into private.schema_migrations(version) select generate_series(1,12) on conflict (version) do nothing`));
   assert.equal(q1(`select count(*) from private.schema_migrations where version between 1 and 12`),'12'); });

 // RF20 (docs/12_REFINE.md, migration 015_fresh_from_pins_notes.sql):
 // fresh_for_you now runs on pin_rank/sleeve_note, never the 1-5 rating --
 // a high rating alone no longer qualifies, and a low-rated pin does.
 // Reusing FUID_A (owner, visibility 'friends')/FUID_B (friend, follows
 // FUID_A, accepted) from the RF2 fixtures above -- the same visibility
 // shape fresh_for_you's own `security invoker` + crate_items RLS needs.
 await t('RF20: an unpinned, un-noted 5-star record is not fresh',()=>{
   asUser(FUID_A, `insert into releases(release_key,title,artist) values ('rf20-rel-1','RF20 High Rated','RF20 Artist') on conflict do nothing`);
   const relId = asUser(FUID_A, `select id from releases where release_key='rf20-rel-1'`);
   asUser(FUID_A, `insert into crate_items(user_id,release_id,visibility,rating,pin_rank,sleeve_note) values ('${FUID_A}','${relId}','public',5,null,null)
     on conflict (user_id,release_id) do update set visibility=excluded.visibility, rating=excluded.rating, pin_rank=excluded.pin_rank, sleeve_note=excluded.sleeve_note`);
   assert.equal(asUser(FUID_B, `select count(*) from fresh_for_you(p_other=>'${FUID_A}') where release_id='${relId}'`), '0',
     'a 5-star record with no pin and no note must not show up as fresh'); });
 await t('RF20: a pinned 2-star record is fresh',()=>{
   asUser(FUID_A, `insert into releases(release_key,title,artist) values ('rf20-rel-2','RF20 Pinned Low Rated','RF20 Artist') on conflict do nothing`);
   const relId = asUser(FUID_A, `select id from releases where release_key='rf20-rel-2'`);
   asUser(FUID_A, `insert into crate_items(user_id,release_id,visibility,rating,pin_rank,sleeve_note) values ('${FUID_A}','${relId}','public',2,8,null)
     on conflict (user_id,release_id) do update set visibility=excluded.visibility, rating=excluded.rating, pin_rank=excluded.pin_rank, sleeve_note=excluded.sleeve_note`);
   assert.equal(asUser(FUID_B, `select count(*) from fresh_for_you(p_other=>'${FUID_A}') where release_id='${relId}'`), '1',
     'a pinned record must be fresh even at a low rating'); });
 await t('RF20: an unpinned record with a sleeve note is fresh too',()=>{
   asUser(FUID_A, `insert into releases(release_key,title,artist) values ('rf20-rel-3','RF20 Noted Not Pinned','RF20 Artist') on conflict do nothing`);
   const relId = asUser(FUID_A, `select id from releases where release_key='rf20-rel-3'`);
   asUser(FUID_A, `insert into crate_items(user_id,release_id,visibility,rating,pin_rank,sleeve_note) values ('${FUID_A}','${relId}','public',1,null,'Still my favorite side B.')
     on conflict (user_id,release_id) do update set visibility=excluded.visibility, rating=excluded.rating, pin_rank=excluded.pin_rank, sleeve_note=excluded.sleeve_note`);
   assert.equal(asUser(FUID_B, `select count(*) from fresh_for_you(p_other=>'${FUID_A}') where release_id='${relId}'`), '1',
     'a noted-but-unpinned record must be fresh even at a 1-star rating'); });
 await t('RF20: pins outrank an unpinned note regardless of rating',()=>{
   // From the two fresh records above: rf20-rel-2 (pin_rank 8, rating 2)
   // must sort ahead of rf20-rel-3 (no pin, rating 1, note) -- pin beats
   // note-only, never mind which one has the higher rating.
   const relPinned = asUser(FUID_A, `select id from releases where release_key='rf20-rel-2'`);
   const relNoted = asUser(FUID_A, `select id from releases where release_key='rf20-rel-3'`);
   // asUser/lastLine only ever keeps the final output line -- fine for a
   // scalar, wrong for a multi-row result, so the ordered list of ids is
   // collapsed into one comma-joined row server-side instead of trusting
   // lastLine to hand back every row.
   const order = asUser(FUID_B,
     `select string_agg(release_id::text, ',') from fresh_for_you(p_other=>'${FUID_A}') q`).split(',');
   assert.ok(order.indexOf(relPinned) < order.indexOf(relNoted) && order.indexOf(relPinned) >= 0,
     'expected the pinned record to rank ahead of the merely-noted one: ' + JSON.stringify(order)); });
 await t('RF20: records_in_common already exists and still works unchanged',()=>{
   // RF20 adds an "overlap first" UI section around this existing RPC --
   // it isn't touched by migration 015, so a quick smoke check is enough.
   asUser(FUID_B, `insert into crate_items(user_id,release_id,visibility) values ('${FUID_B}','${asUser(FUID_A, `select id from releases where release_key='rf20-rel-2'`)}','public')
     on conflict (user_id,release_id) do nothing`);
   const relPinned = asUser(FUID_A, `select id from releases where release_key='rf20-rel-2'`);
   assert.equal(asUser(FUID_B, `select count(*) from records_in_common(p_other=>'${FUID_A}') where release_id='${relPinned}'`), '1'); });

 // ---------------------------------------------------------------------
 // RF23 (docs/12_REFINE.md, "credits across friends", migration
 // 017_credits_across_friends.sql): release_credits, sync_crate()'s own
 // credits replace-set, and credit_friends(). Fresh fixture users (CF_*)
 // so nothing here can collide with any test above.
 // ---------------------------------------------------------------------
 const CF_A='f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1',
       CF_B='f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2',
       CF_STRANGER='f3f3f3f3-f3f3-f3f3-f3f3-f3f3f3f3f3f3',
       CF_BLOCKED='f4f4f4f4-f4f4-f4f4-f4f4-f4f4f4f4f4f4';
 // All of CF_A/CF_B/CF_BLOCKED's profiles are 'friends' visibility, so a
 // 'public' crate item still resolves to effective 'friends' (least() of
 // profile and item, effective_visibility() above) -- every pair that is
 // meant to see each other's content needs an *accepted, mutual* follow,
 // not just one direction, since can_view(owner, item) only ever checks
 // whether the *viewer* follows the *owner*.
 psql(`insert into auth.users values ('${CF_A}'),('${CF_B}'),('${CF_STRANGER}'),('${CF_BLOCKED}') on conflict do nothing;
   insert into profiles(id,handle,display_name,visibility) values
     ('${CF_A}','cfowner','CF Owner','friends'),
     ('${CF_B}','cffriend','CF Friend','friends'),
     ('${CF_STRANGER}','cfstranger','CF Stranger','friends'),
     ('${CF_BLOCKED}','cfblocked','CF Blocked','friends')
   on conflict do nothing;
   insert into follows(follower_id,followee_id) values
     ('${CF_A}','${CF_B}'), ('${CF_B}','${CF_A}'),
     ('${CF_A}','${CF_BLOCKED}'), ('${CF_BLOCKED}','${CF_A}')
   on conflict do nothing;
   update follows set status='accepted'
     where (follower_id='${CF_A}' and followee_id in ('${CF_B}','${CF_BLOCKED}'))
        or (follower_id in ('${CF_B}','${CF_BLOCKED}') and followee_id='${CF_A}');
   insert into blocks(blocker_id,blocked_id) values ('${CF_A}','${CF_BLOCKED}') on conflict do nothing`);

 await t('sync_crate: an item carrying a credits key writes release_credits, de-duplicated',()=>{
   asUser(CF_A, `select sync_crate('[{"release_key":"cf-rel-1","title":"CF Album","artist":"CF Artist","visibility":"public",
     "credits":[{"name":"jane doe","role":"Producer"},{"name":"jane doe","role":"Producer"},{"name":"john roe","role":"Composer"}]}]'::jsonb, true)`);
   const relId = asUser(CF_A, `select id from releases where release_key='cf-rel-1'`);
   assert.equal(asUser(CF_A, `select count(*) from release_credits where user_id='${CF_A}' and release_id='${relId}'`), '2',
     'two distinct (person, role) pairs, the duplicate collapsed'); });

 await t('sync_crate: a later push with no credits key leaves release_credits untouched',()=>{
   const relId = asUser(CF_A, `select id from releases where release_key='cf-rel-1'`);
   asUser(CF_A, `select sync_crate('[{"release_key":"cf-rel-1","title":"CF Album","artist":"CF Artist","rating":4}]'::jsonb, true)`);
   assert.equal(asUser(CF_A, `select count(*) from release_credits where user_id='${CF_A}' and release_id='${relId}'`), '2',
     'a partial, pin/rating-only push must never wipe real credit rows'); });

 await t('sync_crate: an explicit empty credits array clears a release\'s credit rows',()=>{
   const relId = asUser(CF_A, `select id from releases where release_key='cf-rel-1'`);
   asUser(CF_A, `select sync_crate('[{"release_key":"cf-rel-1","title":"CF Album","artist":"CF Artist","credits":[]}]'::jsonb, true)`);
   assert.equal(asUser(CF_A, `select count(*) from release_credits where user_id='${CF_A}' and release_id='${relId}'`), '0'); });

 await t('sync_crate: a credits array over 300 entries is capped to none, not rejected',()=>{
   asUser(CF_A, `select sync_crate(jsonb_build_array(jsonb_build_object(
     'release_key','cf-rel-2','title','CF Album 2','artist','CF Artist',
     'credits', (select jsonb_agg(jsonb_build_object('name','person '||g,'role','Performer')) from generate_series(1,301) g)
   )), true)`);
   const relId = asUser(CF_A, `select id from releases where release_key='cf-rel-2'`);
   assert.equal(asUser(CF_A, `select count(*) from release_credits where user_id='${CF_A}' and release_id='${relId}'`), '0'); });

 await t('release_credits RLS: visible wherever the crate item that supplied it is visible',()=>{
   // cf-rel-1 is public (set above), but CF_A's own profile visibility is
   // 'friends' -- effective_visibility() takes least(profile, item), so a
   // public item under a friends-visibility profile is still only
   // effectively 'friends'. CF_B has an accepted mutual follow with CF_A
   // and can see it; CF_STRANGER has no follow relationship at all and
   // must not.
   const relId = asUser(CF_A, `select id from releases where release_key='cf-rel-1'`);
   asUser(CF_A, `select sync_crate('[{"release_key":"cf-rel-1","title":"CF Album","artist":"CF Artist","credits":[{"name":"jane doe","role":"Producer"}]}]'::jsonb, true)`);
   assert.equal(asUser(CF_B, `select count(*) from release_credits where user_id='${CF_A}' and release_id='${relId}'`), '1');
   assert.equal(asUser(CF_STRANGER, `select count(*) from release_credits where user_id='${CF_A}' and release_id='${relId}'`), '0');
   // now make the same item private -- it must drop out of sight for
   // everyone but the owner, exactly like verified_stats/now_spinning do.
   asUser(CF_A, `update crate_items set visibility='private' where user_id='${CF_A}' and release_id='${relId}'`);
   assert.equal(asUser(CF_B, `select count(*) from release_credits where user_id='${CF_A}' and release_id='${relId}'`), '0');
   assert.equal(asUser(CF_A, `select count(*) from release_credits where user_id='${CF_A}' and release_id='${relId}'`), '1',
     'the owner can always see their own');
   asUser(CF_A, `update crate_items set visibility='public' where user_id='${CF_A}' and release_id='${relId}'`); });

 await t('release_credits RLS: a blocked account never sees it, even with an accepted follow',()=>{
   const relId = asUser(CF_A, `select id from releases where release_key='cf-rel-1'`);
   assert.equal(asUser(CF_BLOCKED, `select count(*) from release_credits where user_id='${CF_A}' and release_id='${relId}'`), '0'); });

 await t('release_credits RLS: a user cannot insert or delete another user\'s credit rows',()=>{
   const relId = asUser(CF_A, `select id from releases where release_key='cf-rel-1'`);
   let threw=false;
   try{ asUser(CF_B, `insert into release_credits(user_id,release_id,person_name_norm,role) values ('${CF_A}','${relId}','mallory','Producer')`); }
   catch(_e){ threw=true; }
   assert.ok(threw, 'expected RLS to reject a cross-user insert');
   asUser(CF_B, `delete from release_credits where user_id='${CF_A}' and release_id='${relId}'`); // matches 0 rows, no throw (USING)
   assert.equal(asUser(CF_A, `select count(*) from release_credits where user_id='${CF_A}' and release_id='${relId}'`), '1',
     'the owner\'s row must survive the attacker\'s no-op delete attempt'); });

 await t('release_credits RLS: anon cannot select any rows',()=>{
   // same table-level posture as every other crate-adjacent table (001_schema.sql's
   // own "revoke all ... from anon") -- anon has no grant at all here, so this
   // is a hard permission error, not a filtered-to-zero-rows result.
   const relId = asUser(CF_A, `select id from releases where release_key='cf-rel-1'`);
   let threw=false;
   try{ asAnon(`select count(*) from release_credits where user_id='${CF_A}' and release_id='${relId}'`); }
   catch(e){ threw=/permission denied/i.test(e.message); if(!threw) throw e; }
   assert.ok(threw, 'expected permission denied for anon select on release_credits'); });

 await t('credit_friends: a friend whose own release_credits match the same (person, role) is returned',()=>{
   asUser(CF_B, `select sync_crate('[{"release_key":"cf-rel-3","title":"CF Friend Album","artist":"CF Artist","visibility":"public","credits":[{"name":"jane doe","role":"Producer"}]}]'::jsonb, true)`);
   const rows = asUser(CF_A, `select string_agg(handle, ',') from credit_friends(p_person_name_norm=>'jane doe', p_role=>'Producer') q`);
   assert.equal(rows, 'cffriend'); });

 // The remaining credit_friends cases all expect zero matching rows, which
 // means an aggregate over an empty set -- a bare NULL. In -At mode that
 // prints as an empty line, which this file's own psql()/lastLine() helpers
 // trim away entirely (same gotcha the RF DA5 getListeningRhythm tests above
 // already work around) -- so every one of these coalesces to the literal
 // string 'null' rather than asserting against a bare JS null.

 await t('credit_friends: never includes the caller\'s own rows',()=>{
   const rows = asUser(CF_A, `select coalesce(string_agg(handle, ','), 'null') from credit_friends(p_person_name_norm=>'jane doe', p_role=>'Producer') q where handle='cfowner'`);
   assert.equal(rows, 'null'); });

 await t('credit_friends: a stranger\'s matching credit never surfaces a release they can\'t see',()=>{
   // give the stranger's own release-with-this-credit a private crate
   // item -- its release_credits row drops out of RLS for everyone but
   // the stranger themselves, so it must never appear in CF_A's results.
   asUser(CF_STRANGER, `select sync_crate('[{"release_key":"cf-rel-4","title":"CF Stranger Album","artist":"CF Artist","visibility":"private","credits":[{"name":"jane doe","role":"Producer"}]}]'::jsonb, true)`);
   const rows = asUser(CF_A, `select coalesce(string_agg(handle, ','), 'null') from credit_friends(p_person_name_norm=>'jane doe', p_role=>'Producer') q where handle='cfstranger'`);
   assert.equal(rows, 'null'); });

 await t('credit_friends: a blocked account\'s credit never surfaces, even if the release is public',()=>{
   asUser(CF_BLOCKED, `select sync_crate('[{"release_key":"cf-rel-5","title":"CF Blocked Album","artist":"CF Artist","visibility":"public","credits":[{"name":"jane doe","role":"Producer"}]}]'::jsonb, true)`);
   const rows = asUser(CF_A, `select coalesce(string_agg(handle, ','), 'null') from credit_friends(p_person_name_norm=>'jane doe', p_role=>'Producer') q where handle='cfblocked'`);
   assert.equal(rows, 'null'); });

 await t('credit_friends: a different role for the same person never matches',()=>{
   const rows = asUser(CF_A, `select coalesce(string_agg(handle, ','), 'null') from credit_friends(p_person_name_norm=>'jane doe', p_role=>'Composer') q where handle='cffriend'`);
   assert.equal(rows, 'null'); });

 console.log(pass+' passed'); setTimeout(()=>process.exit(),100);
})();
