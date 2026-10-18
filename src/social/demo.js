import { S } from '../state.js';
import { DB } from '../storage/idb.js';
import { albumKey, trackTier } from '../record-art/tiers.js';
import { albumMetalFor } from '../record-art/metals.js';
import { groupBy } from '../library/model.js';

/* ================= Social Step E: demo mode (?social=demo, dev only) =================
   Loaded with a dynamic import() only when the URL has ?social=demo (see
   main.js's restoreLibrary()), so Vite puts this in its own chunk and
   nobody downloads fixture data or this file's ~700 lines just to run
   the real app. installSocialDemo() is the only export: it monkey-patches
   every MizikiSocial method with fixture data, so every real render
   function elsewhere in the app (profile, storefront, friend store, home
   feed) runs completely unmodified against it — this file touches no UI
   itself. */
export function installSocialDemo(){
  // see the same note on DB in profile/storefront.js's localStaffPicks() —
  // mizikiAdapter's own signature expects DB, not the repo.js interface.
  const adapter = MizikiSocial.mizikiAdapter({S, DB, albumKey, trackTier, albumMetalFor});
  const me = { handle:'', display_name:'', bio:'', visibility:'friends', show_digging_list:true };
  let auth = 'signedOut';
  const settings = { shareNowSpinning:false, shareMilestones:false, syncEnabled:true };
  const followState = new Map([['june','accepted'], ['mateo','none'], ['amy','pending'], ['nora','accepted'], ['theo','accepted']]);
  let incomingRequests = [{follower_id:'zed', created_at:new Date().toISOString(), profiles:{handle:'zed', display_name:'Zed'}}];
  const takenHandles = ['june','mateo','amy','nora','theo','zed'];
  const longWords = n => Array(n).fill('word').join(' ');

  const juneArtists = ['John Coltrane','Miles Davis','Herbie Hancock','Wayne Shorter','Art Blakey','Nina Simone','Pharoah Sanders','Alice Coltrane','McCoy Tyner','Sun Ra'];
  const juneCrate = [];
  for(let i = 0; i < 420; i++){
    const artist = juneArtists[i % juneArtists.length];
    juneCrate.push({release_id:'june-r' + i, title: artist + ' Session ' + i, artist, year: 1960 + (i % 40),
      quality_tier: 1 + (i % 3), rating: i % 7 === 0 ? 1 + (i % 5) : null, sleeve_note: null, pin_rank: null});
  }
  juneCrate.sort((a, b) => a.artist.localeCompare(b.artist));

  const FRIENDS = {
    june: {
      profile: {id:'june', handle:'june', display_name:'June Okafor', bio:'Jazz & soul digger. Mostly vinyl, some cassette.', visibility:'public', show_digging_list:true},
      staffPicks: [
        {release_id:'june-r0', title:'Blue Train', artist:'John Coltrane', quality_tier:3, rating:5, sleeve_note:'Side A on repeat this whole month, genuinely cannot stop.', pin_rank:1},
        {release_id:'june-r1', title:'A Supremely Long Album Title That Should Wrap Onto Several Lines Without Ever Breaking The Layout', artist:'An Artist With An Unusually Long Name, For Testing Purposes Only', quality_tier:2, rating:4, sleeve_note: longWords(30), pin_rank:2},
        {release_id:'june-r2', title:'Head Hunters', artist:'Herbie Hancock', quality_tier:2, rating:4, sleeve_note:null, pin_rank:3}
      ],
      crate: juneCrate,
      fresh: [
        {release_id:'june-f1', title:'Maiden Voyage', artist:'Herbie Hancock', rating:5, quality_tier:2, in_digging:false},
        {release_id:'june-f2', title:'The Köln Concert', artist:'Keith Jarrett', rating:4, quality_tier:3, in_digging:false}
      ],
      digging: [{release_id:'june-d1', title:'Water from an Ancient Well', artist:'Randy Weston', in_my_digging:false, in_my_crate:false}],
      nowSpinning: null
    },
    mateo: {
      profile: {id:'mateo', handle:'mateo', display_name:'Mateo', bio:'Vinyl hoarder, no apologies.', visibility:'friends', show_digging_list:true},
      staffPicks: [], crate: [], fresh: [], digging: [], nowSpinning: null
    },
    amy: {
      profile: {id:'amy', handle:'amy', display_name:'Amy', bio:'New to collecting, loving it so far.', visibility:'friends', show_digging_list:true},
      staffPicks: [], crate: [], fresh: [], digging: [], nowSpinning: null
    },
    nora: {
      // empty state: public (so it's viewable), but nothing in it yet
      profile: {id:'nora', handle:'nora', display_name:'Nora', bio:'', visibility:'public', show_digging_list:true},
      staffPicks: [], crate: [], fresh: [], digging: [], nowSpinning: null
    },
    theo: {
      // digging list off: section should be absent entirely, not just empty
      profile: {id:'theo', handle:'theo', display_name:'Theo', bio:'Keeps the digging list to myself.', visibility:'public', show_digging_list:false},
      staffPicks: [{release_id:'theo-r0', title:'Moon Rock', artist:'Com Truise', quality_tier:2, rating:4, sleeve_note:null, pin_rank:1}],
      crate: [{release_id:'theo-r0', title:'Moon Rock', artist:'Com Truise', year:2015, quality_tier:2, rating:4, sleeve_note:null, pin_rank:1}],
      fresh: [], digging: [], nowSpinning: null
    }
  };
  function friendByHandle(h){ return FRIENDS[h]; }
  function friendById(id){ return Object.values(FRIENDS).find(f => f.profile.id === id); }
  function relationshipFor(handle){ return {following: followState.get(handle) || 'none', followsYou: handle === 'june'}; }

  MizikiSocial.status = () => ({enabled:true, auth, sync:'idle', pendingRemovals:0,
    skipped:{noArtist:0, collisions:0}, lastSyncedAt: auth === 'ready' ? Date.now() - 60000 : null, lastError:null});
  MizikiSocial.getSettings = () => ({...settings});
  MizikiSocial.setSetting = (k, v) => { settings[k] = !!v; return true; };

  MizikiSocial.sendCode = async () => ({ok:true});
  MizikiSocial.verifyCode = async (email, code) => {
    if(String(code || '').trim() !== '123456')
      return {ok:false, error:{code:'bad_code', message:'Enter the code from the email (demo code is 123456).', retryable:false}};
    auth = me.handle ? 'ready' : 'needsProfile';
    return {ok:true, status: MizikiSocial.status()};
  };
  MizikiSocial.checkHandle = async h => {
    if(!/^[a-z0-9_]{3,24}$/.test(h)) return {ok:true, available:false, reason:'format'};
    return {ok:true, available: !takenHandles.includes(h)};
  };
  MizikiSocial.createProfile = async ({handle, displayName}) => {
    me.handle = handle; me.display_name = displayName || null; auth = 'ready';
    return {ok:true, profile:{...me, id:'me'}};
  };
  MizikiSocial.updateProfile = async patch => {
    if('displayName' in patch) me.display_name = patch.displayName;
    if('bio' in patch) me.bio = patch.bio;
    if('visibility' in patch) me.visibility = patch.visibility;
    if('showDiggingList' in patch) me.show_digging_list = patch.showDiggingList;
    return {ok:true, profile:{...me, id:'me'}};
  };
  MizikiSocial.getMyProfile = async () => ({ok:true, profile: me.handle ? {...me, id:'me'} : null});
  MizikiSocial.signOut = async () => { auth = 'signedOut'; return {ok:true}; };

  MizikiSocial.loadProfile = async handleRaw => {
    const handle = String(handleRaw || '').replace(/^@/, '').toLowerCase();
    if(handle === me.handle){
      const pins = MizikiSocial.getPins();
      return {
        ok:true, profile:{...me, id:'me'}, relationship:{following:'self', followsYou:false}, isMe:true, canView:true,
        labelColor: MizikiSocial.labelColor('me:' + me.handle),
        summary: {records: groupBy('album').length, pins: pins.length, in_common:0,
          followers:2, following:[...followState.values()].filter(s => s === 'accepted').length},
        staffPicks: pins.map(albumId => {
          const info = adapter.albumInfo(albumId); if(!info) return null;
          const social = MizikiSocial.getAlbumSocial(albumId);
          return {release_id: albumId, title: info.title, artist: info.artist, quality_tier: info.tier,
            rating: social.rating, sleeve_note: social.note, pin_rank: social.pinRank};
        }).filter(Boolean),
        nowSpinning: null, fresh: [], diggingShared: me.show_digging_list !== false, digging: [], diggingCount: 0
      };
    }
    if(handle === 'offline') return {ok:false, error:{code:'offline', message:'You appear to be offline.', retryable:true}};
    if(handle === 'broken') return {ok:false, error:{code:'error', message:'Something went wrong loading this crate.', retryable:false}};
    if(handle === 'ghost') return {ok:false, error:{code:'not_found', message:'No such crate.', retryable:false}};
    const f = friendByHandle(handle);
    if(!f) return {ok:false, error:{code:'not_found', message:'No such crate.', retryable:false}};
    const rel = relationshipFor(handle);
    const canView = f.profile.visibility === 'public' || rel.following === 'accepted';
    const out = {ok:true, profile:f.profile, relationship:rel, isMe:false, canView, labelColor: MizikiSocial.labelColor(f.profile.handle)};
    if(!canView) return out;
    out.summary = {records: f.crate.length, pins: f.staffPicks.length, in_common: Math.min(f.crate.length, 7)};
    out.staffPicks = f.staffPicks;
    out.nowSpinning = f.nowSpinning;
    out.fresh = f.fresh;
    out.diggingShared = f.profile.show_digging_list !== false;
    out.digging = out.diggingShared ? f.digging : [];
    out.diggingCount = out.digging.length;
    return out;
  };

  MizikiSocial.crate = async (userId, opts) => {
    const f = friendById(userId); if(!f) return {ok:true, items:[]};
    const offset = (opts && opts.offset) || 0, limit = (opts && opts.limit) || 60;
    return {ok:true, items: f.crate.slice(offset, offset + limit)};
  };
  MizikiSocial.inCommon = async () => ({ok:true, items:[]});
  MizikiSocial.addToDigging = async (releaseId, sourceUserId) => {
    const f = friendById(sourceUserId);
    if(f){
      const item = [...f.crate, ...f.digging, ...f.fresh, ...f.staffPicks].find(x => x.release_id === releaseId);
      if(item) item.in_digging = true;
    }
    return {ok:true};
  };
  MizikiSocial.removeFromDigging = async () => ({ok:true});
  MizikiSocial.listDigging = async () => ({ok:true, items:[]});
  MizikiSocial.diggingOf = async () => ({ok:true, items:[]});

  MizikiSocial.searchProfiles = async q => {
    const t = String(q || '').trim().toLowerCase().replace(/^@/, '');
    if(t.length < 2) return {ok:true, profiles:[]};
    return {ok:true, profiles: Object.values(FRIENDS).map(f => f.profile).filter(p => p.handle.startsWith(t))
      .map(p => ({id:p.id, handle:p.handle, display_name:p.display_name, visibility:p.visibility}))};
  };
  MizikiSocial.follow = async userId => {
    const f = friendById(userId); if(!f) return {ok:true, status:'exists'};
    const status = f.profile.visibility === 'public' ? 'accepted' : 'pending';
    followState.set(f.profile.handle, status);
    return {ok:true, status};
  };
  MizikiSocial.unfollow = async userId => {
    const f = friendById(userId); if(f) followState.set(f.profile.handle, 'none');
    return {ok:true};
  };
  MizikiSocial.respondToRequest = async followerId => {
    incomingRequests = incomingRequests.filter(r => r.follower_id !== followerId);
    return {ok:true};
  };
  MizikiSocial.removeFollower = id => MizikiSocial.respondToRequest(id);
  MizikiSocial.listRequests = async () => ({ok:true, requests: incomingRequests});
  MizikiSocial.listFollowing = async () => ({ok:true, following: [...followState.entries()].map(([handle, status]) => ({
    followee_id: FRIENDS[handle].profile.id, status, profiles: {handle, display_name: FRIENDS[handle].profile.display_name}}))});
  MizikiSocial.block = async () => ({ok:true});
  MizikiSocial.unblock = async () => ({ok:true});
  MizikiSocial.report = async () => ({ok:true});

  MizikiSocial.subscribeNowSpinning = cb => {
    const timer = setTimeout(()=> cb({type:'spinning', userId:'june', track:'So What',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      release:{id:'june-r0', title:'Kind of Blue', artist:'Miles Davis'}, phase:'golden'}), 2500);
    return () => clearTimeout(timer);
  };
  MizikiSocial.homeFeed = async () => ({ok:true, events: [
    {id:1, actor_id:'june', actor_handle:'june', actor_name:'June Okafor', type:'pinned', release_id:'june-r0', title:'Blue Train', artist:'John Coltrane', payload:{}, created_at:new Date(Date.now() - 3600e3).toISOString()},
    {id:2, actor_id:'june', actor_handle:'june', actor_name:'June Okafor', type:'review', release_id:'june-r2', title:'Head Hunters', artist:'Herbie Hancock', payload:{rating:4}, created_at:new Date(Date.now() - 3700e3).toISOString()},
    {id:3, actor_id:'theo', actor_handle:'theo', actor_name:'Theo', type:'added', release_id:null, title:null, artist:null, payload:{count:5}, created_at:new Date(Date.now() - 7200e3).toISOString()},
    {id:4, actor_id:'nora', actor_handle:'nora', actor_name:'Nora', type:'unlock', release_id:'nora-r0', title:'Some Record', artist:'Some Artist', payload:{variant:'splatter'}, created_at:new Date(Date.now() - 10000e3).toISOString()}
  ]});

  MizikiSocial.syncNow = async () => ({ok:true, pushed:0, removed:0, held:0, stats:0, firstSync:false});
  MizikiSocial.confirmRemovals = async () => ({ok:true});
  MizikiSocial.nowSpinning = () => {};
  MizikiSocial.nowSpinningPaused = () => {};
  MizikiSocial.stopSpinning = () => {};

  console.info('[Miziki] social demo mode active — fixture data only, for UI development.');
}
