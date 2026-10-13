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
 await t('unchanged library => zero rpc calls',async()=>{ calls=[]; const r=await M.syncNow(); assert.equal(r.pushed,0); assert.equal(calls.length,0,calls.join()); });
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
 await t('milestones only when opted in, monotonic',async()=>{
   ALBUMS=ALBUMS.map(a=>a.id==='a1'?{...a,sessions:6,metal:'gold'}:a);
   await M.syncNow(); assert.equal(+q1(`select count(*) from verified_stats where user_id='${UID}'`),0);
   M.setSetting('shareMilestones',true); const r=await M.syncNow(); assert.equal(r.stats,1,JSON.stringify(r));
   assert.equal(q1(`select full_album_sessions from verified_stats where user_id='${UID}'`),'6');
   ALBUMS=ALBUMS.map(a=>a.id==='a1'?{...a,sessions:2}:a); await M.syncNow();
   assert.equal(q1(`select full_album_sessions from verified_stats where user_id='${UID}'`),'6'); });
 await t('now spinning off by default',async()=>{ M.nowSpinning('a3','Track X'); await sleep(300); assert.equal(+q1(`select count(*) from now_spinning where user_id='${UID}'`),0); M.setSetting('shareNowSpinning',true); });
 await t('now spinning public + stop clears',async()=>{
   M.nowSpinning('a3','Track X'); await sleep(400);
   assert.equal(+q1(`select count(*) from now_spinning where user_id='${UID}'`),1);
   M.stopSpinning(); await sleep(400); assert.equal(+q1(`select count(*) from now_spinning where user_id='${UID}'`),0); });
 await t('now spinning pause clears after delay',async()=>{ M.nowSpinning('a3','T'); await sleep(400); M.nowSpinningPaused(); await sleep(500); assert.equal(+q1(`select count(*) from now_spinning where user_id='${UID}'`),0); });
 await t('private record never spins',async()=>{ M.setVisibility('a4','private'); await M.syncNow(); M.nowSpinning('a4','T'); await sleep(400); assert.equal(+q1(`select count(*) from now_spinning where user_id='${UID}'`),0); });
 await t('offline => backoff then recovery',async()=>{ M.setRating('a5',3); offline=true; const r=await M.syncNow(); assert.equal(r.error.code,'offline',JSON.stringify(r)); assert.equal(M.status().sync,'offline');
   offline=false; await sleep(400); assert.equal(M.status().sync,'idle'); assert.equal(q1(`select rating from crate_items where user_id='${UID}' and release_id=(select id from releases where title='Album 5')`),'3'); });
 await t('key collisions + no-artist handled',async()=>{
   ALBUMS=[alb(1),alb(2),{...alb(2),id:'dup2'},{...alb(9),id:'na',artist:''}]; const r=await M.syncNow(); assert.equal(r.ok,true,JSON.stringify(r));
   const s=M.status().skipped; assert.equal(s.collisions,1); assert.equal(s.noArtist,1); });
 await t('rating out of range rejected locally',()=>{ const r=M.setRating('a1',9); assert.ok(!r||r.ok===false||M.getAlbumSocial('a1').rating!==9); });
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

 console.log(pass+' passed'); setTimeout(()=>process.exit(),100);
})();
