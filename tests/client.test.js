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
const SETS=new Set(['my_crate_meta','home_feed_rich','crate_page','fresh_for_you','home_feed','records_in_common']);
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
  from(t){ const f={}; const b={select(){return b},eq(c,v){f[c]=v;return b},
      async maybeSingle(){ const w=Object.entries(f).map(([c,v])=>`${c}='${v}'`).join(' and ');
        const o=psql(`select coalesce(to_jsonb(p),'null') from ${t} p ${w?'where '+w:''} limit 1`); const d=JSON.parse(o||'null'); return {data:d,error:null}; }};
    return b; },
  auth:{ onAuthStateChange(){}, async getSession(){ return {data:{session:{user:{id:uid}}}}; } }
};
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
 await t('mass removal held until confirm',async()=>{ const keep=ALBUMS.slice(); ALBUMS=ALBUMS.slice(0,8); const r=await M.syncNow(); assert.equal(r.held,11,JSON.stringify(r)); assert.equal(crateN(),19); assert.equal(M.status().sync,'needsReview');
   const r2=await M.confirmRemovals(); assert.equal(r2.removed,11,JSON.stringify(r2)); assert.equal(crateN(),8); });
 await t('emptied library held',async()=>{ ALBUMS=[]; const r=await M.syncNow(); assert.ok(r.held>0); assert.equal(crateN(),8); ALBUMS=[1,2,3,4,5,6,7,8].map(n=>alb(n)); const r2=await M.syncNow(); assert.equal(r2.held,0); assert.equal(crateN(),8); });
 await t('fresh device restores server metadata, no blank overwrite',async()=>{
   store=null; const X=M._internals.X; X.state=null; // simulate wiped device
   X.state={v:1,userId:null,settings:{shareNowSpinning:false,shareMilestones:false,syncEnabled:true},pins:[],items:{},synced:{},statsSynced:{},restoredFor:null};
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
 console.log(pass+' passed'); setTimeout(()=>process.exit(),100);
})();
