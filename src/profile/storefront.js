import { S } from '../state.js';
import { $, el } from '../util/dom.js';
import { normKey } from '../util/text.js';
import { albumKey, trackTier } from '../record-art/tiers.js';
import { albumMetalFor } from '../record-art/metals.js';
import { groupBy } from '../library/model.js';
import { DB } from '../storage/idb.js';
import { persistProfile, formatDisplayName, renderProfileExtras, renderProfile } from './screens.js';
import { beginSocialSignIn } from './settings.js';

// Shared card-building primitives (frame 01/04 of the social spec) — each
// is used both here, in "my own storefront," and in the friend-store
// screens (src/social/screens/friend-store.js), since a friend's crate is
// drawn with the same stats/picks/awning/time-ago vocabulary as your own.
export const STORE_TIER_LABEL = {1:'LOSSY', 2:'LOSSLESS', 3:'HI-RES'};
export const STORE_VIS_LABEL = {private:'Only you', friends:'Friends only', public:'Everyone'};

export function storeAwning(){
  const awning = el('div','store-awning');
  for(let i = 0; i < 10; i++) awning.appendChild(el('div'));
  return awning;
}

export function storeSwitch(label, checked, onToggle){
  const sw = document.createElement('button');
  sw.type = 'button'; sw.className = 'store-switch'; sw.setAttribute('role','switch');
  sw.setAttribute('aria-label', label);
  sw.setAttribute('aria-checked', String(!!checked));
  const track = el('div','store-switch-track');
  track.appendChild(document.createElement('i'));
  sw.appendChild(track);
  sw.addEventListener('click', ()=>{
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    onToggle(on);
  });
  return sw;
}

export function storeStat(label, value, accent){
  const s = el('div','store-stat' + (accent ? ' accent' : ''));
  s.appendChild(el('b', null, String(value)));
  s.appendChild(el('span', null, label));
  return s;
}

export function storeRequestsCard(requests, onChange){
  const wrap = el('div','store-requests-wrap');
  const card = el('button','store-card store-card-btn');
  card.appendChild(el('div','store-card-count', String(requests.length)));
  const text = el('div','store-card-text');
  text.appendChild(el('b', null, requests.length === 1 ? '1 person wants to browse' : requests.length + ' people want to browse'));
  text.appendChild(el('em', null, 'Review follow requests'));
  card.appendChild(text);
  card.appendChild(el('span','store-chev','›'));
  const list = el('div','store-requests-list');
  list.style.display = 'none';
  card.setAttribute('aria-expanded','false');
  card.addEventListener('click', ()=>{
    const open = list.style.display === 'none';
    list.style.display = open ? 'block' : 'none';
    card.setAttribute('aria-expanded', String(open));
  });
  requests.forEach(r => {
    const prof = r.profiles || {};
    const row = el('div','store-dig-row store-request-row');
    const rtext = el('div','store-dig-text');
    rtext.appendChild(el('b', null, prof.display_name || prof.handle || 'Someone'));
    if(prof.handle) rtext.appendChild(el('em', null, prof.handle));
    row.appendChild(rtext);
    const accept = document.createElement('button');
    accept.type = 'button'; accept.className = 'store-dig-remove'; accept.textContent = '✓';
    accept.setAttribute('aria-label','Accept follow request from ' + (prof.handle || 'this person'));
    accept.addEventListener('click', async ()=>{ await MizikiSocial.respondToRequest(r.follower_id, true); onChange(); });
    row.appendChild(accept);
    const decline = document.createElement('button');
    decline.type = 'button'; decline.className = 'store-dig-remove'; decline.textContent = '✕';
    decline.setAttribute('aria-label','Decline follow request from ' + (prof.handle || 'this person'));
    decline.addEventListener('click', async ()=>{ await MizikiSocial.respondToRequest(r.follower_id, false); onChange(); });
    row.appendChild(decline);
    list.appendChild(row);
  });
  wrap.appendChild(card);
  wrap.appendChild(list);
  return wrap;
}

// Staff picks are always the viewer's own records when isMe, so the art
// already sits in the local library even though it never synced to the
// server (art/audio/filenames never leave the device, per the social spec).
export function localAlbumArt(title, artist){
  const ta = normKey(title), aa = normKey(artist);
  const t = S.tracks.find(x => normKey(x.tags.album) === ta && normKey(x.tags.albumArtist || x.tags.artist) === aa);
  return t ? t.art : null;
}

export function storePickTile(pick){
  const tile = el('div','store-pick');
  const cover = el('div','store-pick-cover');
  const art = localAlbumArt(pick.title, pick.artist);
  if(art){ const im = document.createElement('img'); im.src = art; im.alt = ''; cover.appendChild(im); }
  cover.appendChild(el('span','store-pick-tier', STORE_TIER_LABEL[pick.quality_tier] || ''));
  tile.appendChild(cover);
  const note = el('div','store-pick-note');
  note.appendChild(el('div','store-pick-stars', pick.rating ? '★'.repeat(pick.rating) + '☆'.repeat(5 - pick.rating) : ''));
  note.appendChild(el('div','store-pick-name', pick.title));
  if(pick.sleeve_note) note.appendChild(el('div', null, pick.sleeve_note));
  tile.appendChild(note);
  return tile;
}

export function timeAgoShort(ms){
  const s = Math.max(0, Math.round(ms / 1000));
  if(s < 60) return 'just now';
  const m = Math.round(s / 60);
  if(m < 60) return m + ' min' + (m === 1 ? '' : 's') + ' ago';
  const h = Math.round(m / 60);
  if(h < 24) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
  const d = Math.round(h / 24);
  return d + ' day' + (d === 1 ? '' : 's') + ' ago';
}

export function renderOpenStoreCard(host, authState){
  host.innerHTML = '';
  const needsProfile = authState === 'needsProfile';
  const card = el('div','store-open-card');
  card.appendChild(el('h3', null, needsProfile ? 'Finish setting up your crate' : 'Open your crate'));
  card.appendChild(el('p', null, needsProfile
    ? 'Pick a handle to start your crate — friends will find you there.'
    : 'Sign in to pin staff picks, see what friends are spinning, and share your crate.'));
  const btn = el('button','cta', needsProfile ? 'Finish setup' : 'Sign in');
  btn.addEventListener('click', beginSocialSignIn);
  card.appendChild(btn);
  host.appendChild(card);
}

export function renderStoreError(host, error, retry){
  host.innerHTML = '';
  const wrap = el('div','store-error');
  // not_found covers both a genuinely nonexistent handle and a blocked
  // viewer -- these must look identical (no retry affordance either way),
  // or blocking would leak information just by comparing the two states.
  if(error && error.code === 'not_found'){
    wrap.appendChild(el('p', null, 'No such crate.'));
    host.appendChild(wrap);
    return;
  }
  const offline = error && error.code === 'offline';
  wrap.appendChild(el('p', null, offline
    ? "You're offline — your crate will load when you're back."
    : "Couldn't load your crate."));
  const btn = el('button','cta ghost','Try again');
  btn.addEventListener('click', retry);
  wrap.appendChild(btn);
  host.appendChild(wrap);
}

export function renderStorefrontSection(body){
  const soc = (typeof MizikiSocial === 'undefined') ? {enabled:false} : MizikiSocial.status();
  // DA3 (docs/DAY_ARC.md, artboard ProfileSettings): a universal Settings
  // entry point, added here rather than inside any one of the three
  // branches below, since before this step only the signed-in
  // renderStorefront() branch had its own gear button — the other two
  // states (renderLocalStorefront, the common default; renderOpenStoreCard,
  // "social enabled but not signed in yet") had no settings entry point
  // at all, which would have made the Appearance control (now moved off
  // the old Character tab onto a new screen reached from here)
  // unreachable in either of them. One button at the very top of every
  // state, rather than three separate additions.
  const settingsBtn = el('button','profile-settings-btn','Settings ›');
  settingsBtn.setAttribute('aria-label','Settings');
  settingsBtn.addEventListener('click', ()=>{ S.profileView.screen = 'settings'; renderProfile(); });
  body.appendChild(settingsBtn);
  // D7 (docs/DESKTOP_LAYOUT.md): wraps the two existing top-level pieces
  // (.store-host below, .profile-extras appended further down) so
  // src/styles/23-desktop.css's own two-column grid can reach into both
  // of their children at once — display:contents below 1024px, the same
  // invisible-scaffolding pattern every prior D-step's own wrapper
  // already uses, so this changes nothing about how either piece renders
  // on a phone.
  const grid = el('div','profile-desktop-grid');
  body.appendChild(grid);
  const host = el('div','store-host');
  grid.appendChild(host);
  // everything a storefront needs for staff picks, ratings, notes and the
  // crate preview already lives on this device (Step A's local engine never
  // touched the network) — so the storefront shell shows up right away,
  // with only the genuinely server-shaped pieces (followers, friend
  // requests, digging from others, sharing now-spinning) gated behind a
  // configured + signed-in account. Either way this is now the WHOLE profile
  // screen, not a storefront stacked on top of a duplicate "your library"
  // section — Top Album/Achievements/Collection/Share (renderProfileExtras)
  // just continue directly below, since nothing else shows them.
  if(!soc.enabled){
    renderLocalStorefront(host);
    grid.appendChild(renderProfileExtras(false));
    return;
  }
  if(soc.auth === 'ready') loadAndRenderStorefront(host);
  else renderOpenStoreCard(host, soc.auth);
  grid.appendChild(renderProfileExtras(true));
}

// Local albumId -> social metadata, by way of the same pure adapter the
// vendored client builds internally — none of this touches the network.
function localStaffPicks(){
  // DB (not the repo.js interface) is what MizikiSocial.mizikiAdapter's own
  // signature expects — this is the one call site step 4c's "no DB. calls
  // outside src/storage/" leaves alone, since the adapter is social-client
  // code, not main.js's own storage access.
  const adapter = MizikiSocial.mizikiAdapter({S, DB, albumKey, trackTier, albumMetalFor});
  return MizikiSocial.getPins().map(albumId => {
    const info = adapter.albumInfo(albumId);
    if(!info) return null;
    const social = MizikiSocial.getAlbumSocial(albumId);
    return {release_id: albumId, title: info.title, artist: info.artist, quality_tier: info.tier,
      rating: social.rating, sleeve_note: social.note, pin_rank: social.pinRank};
  }).filter(Boolean);
}

function renderLocalStorefront(host){
  host.innerHTML = '';
  host.appendChild(storeAwning());
  const header = el('div','store-header');
  const avatar = el('button','store-avatar'); avatar.setAttribute('aria-label','Change your picture');
  if(S.profile.art){
    const im = document.createElement('img'); im.src = S.profile.art; im.alt = '';
    avatar.appendChild(im);
  } else {
    const label = el('div','store-avatar-label');
    label.style.background = MizikiSocial.labelColor(S.profile.username || S.profile.name || 'me');
    avatar.appendChild(label);
  }
  avatar.addEventListener('click', ()=> $('#profilePicFile').click());
  header.appendChild(avatar);

  const idBox = el('div','store-id');
  idBox.appendChild(el('div','store-kicker','CRATE'));
  const userIn = document.createElement('input');
  userIn.className = 'store-handle-input'; userIn.type = 'text'; userIn.placeholder = 'yourname'; userIn.maxLength = 30;
  userIn.setAttribute('aria-label','Your crate username');
  userIn.value = S.profile.username || '';
  userIn.addEventListener('change', ()=>{ S.profile.username = userIn.value.trim(); persistProfile(); renderLocalStorefront(host); });
  idBox.appendChild(userIn);

  const nameDisplay = el('button','store-displayname-btn', formatDisplayName(S.profile.name) || 'Add your name');
  nameDisplay.setAttribute('aria-label','Edit your name');
  const nameIn = document.createElement('input');
  nameIn.className = 'store-displayname-input'; nameIn.type = 'text'; nameIn.placeholder = 'Your name'; nameIn.maxLength = 50;
  nameIn.value = S.profile.name || ''; nameIn.style.display = 'none';
  nameDisplay.addEventListener('click', ()=>{ nameDisplay.style.display = 'none'; nameIn.style.display = ''; nameIn.focus(); });
  const commitName = ()=>{
    S.profile.name = nameIn.value.trim(); persistProfile();
    nameDisplay.textContent = formatDisplayName(S.profile.name) || 'Add your name';
    nameIn.style.display = 'none'; nameDisplay.style.display = '';
  };
  nameIn.addEventListener('blur', commitName);
  nameIn.addEventListener('keydown', e => { if(e.key === 'Enter') nameIn.blur(); });
  idBox.appendChild(nameDisplay); idBox.appendChild(nameIn);
  header.appendChild(idBox);
  host.appendChild(header);

  const stats = el('div','store-stats');
  stats.appendChild(storeStat('Records', groupBy('album').length));
  stats.appendChild(storeStat('Staff picks', MizikiSocial.getPins().length, true));
  host.appendChild(stats);

  host.appendChild(storePicksSection({staffPicks: localStaffPicks()}));
  host.appendChild(storeCrateGrid());

  host.appendChild(el('p','note','This is a local preview — connect a Miziki account to add friends, followers, and sharing.'));
}

async function loadAndRenderStorefront(host){
  host.innerHTML = '';
  host.appendChild(el('div','store-loading','Loading your crate…'));
  const me = await MizikiSocial.getMyProfile();
  if(!me.ok){ renderStoreError(host, me.error, ()=>loadAndRenderStorefront(host)); return; }
  if(!me.profile){ renderOpenStoreCard(host, 'needsProfile'); return; }
  const [full, reqs] = await Promise.all([
    MizikiSocial.loadProfile(me.profile.handle),
    MizikiSocial.listRequests()
  ]);
  if(!full.ok){ renderStoreError(host, full.error, ()=>loadAndRenderStorefront(host)); return; }
  renderStorefront(host, full, (reqs.ok && reqs.requests) || []);
}

async function cycleStoreVisibility(profile, host){
  const order = ['private','friends','public'];
  const next = order[(order.indexOf(profile.visibility) + 1) % order.length];
  const r = await MizikiSocial.updateProfile({visibility: next});
  if(r.ok) loadAndRenderStorefront(host);
}

function storeNowSpinningCard(full, _host){
  const settings = MizikiSocial.getSettings();
  const card = el('div','store-card');
  const count = el('div','store-card-count','♪');
  card.appendChild(count);
  const text = el('div','store-card-text');
  if(full.nowSpinning && full.nowSpinning.track_title){
    const rel = full.nowSpinning.releases || {};
    text.appendChild(el('b', null, full.nowSpinning.track_title));
    text.appendChild(el('em', null, [rel.artist, rel.title].filter(Boolean).join(' · ') || 'Now spinning'));
  } else {
    text.appendChild(el('b', null, 'Nothing spinning right now'));
    text.appendChild(el('em', null, 'Shows here while you listen'));
  }
  card.appendChild(text);
  card.appendChild(storeSwitch('Share what you’re spinning', settings.shareNowSpinning,
    on => MizikiSocial.setSetting('shareNowSpinning', on)));
  return card;
}

function storePicksSection(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head');
  head.appendChild(el('h2', null, 'Staff picks'));
  section.appendChild(head);
  const row = el('div','store-picks-row');
  full.staffPicks.forEach(p => row.appendChild(storePickTile(p)));
  for(let i = full.staffPicks.length; i < 8; i++){
    const empty = el('div','store-pick-empty');
    empty.appendChild(el('span', null, 'Pin a record'));
    empty.appendChild(el('span', null, 'Slot ' + (i + 1) + ' of 8'));
    row.appendChild(empty);
  }
  section.appendChild(row);
  return section;
}

function storeDiggingSection(full, host){
  // D7: the one modifier class this step adds, since store-section alone
  // (shared with storePicksSection/storeCrateGrid below) gives
  // src/styles/23-desktop.css's own two-column grid no way to place this
  // one section differently from its siblings — "digging list" goes in
  // the left column, per the mockup's own mapping; the other two stay
  // full width.
  const section = el('div','store-section store-section-digging');
  const head = el('div','store-section-head');
  head.appendChild(el('h2', null, 'Digging list'));
  head.appendChild(storeSwitch('Show digging list on my crate', full.profile.show_digging_list !== false,
    on => MizikiSocial.updateProfile({showDiggingList: on})));
  section.appendChild(head);
  if(!full.digging.length){
    section.appendChild(el('p','store-loading','Nothing in your digging list yet.'));
    return section;
  }
  full.digging.forEach(item => {
    const row = el('div','store-dig-row');
    row.appendChild(el('div','store-dig-cover'));
    const text = el('div','store-dig-text');
    text.appendChild(el('b', null, item.title));
    text.appendChild(el('em', null, item.artist));
    text.appendChild(el('small', null, item.source_handle ? 'Spotted in @' + item.source_handle + '’s crate' : 'Added by you'));
    row.appendChild(text);
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'store-dig-remove'; rm.textContent = '−';
    rm.setAttribute('aria-label','Remove ' + item.title + ' from digging list');
    rm.addEventListener('click', async ()=>{ await MizikiSocial.removeFromDigging(item.release_id); loadAndRenderStorefront(host); });
    row.appendChild(rm);
    section.appendChild(row);
  });
  return section;
}

function storeCrateGrid(){
  const section = el('div','store-section');
  const head = el('div','store-section-head');
  head.appendChild(el('h2', null, 'All records'));
  section.appendChild(head);
  const albums = groupBy('album');
  if(!albums.length){
    section.appendChild(el('p','store-loading','Nothing in the crate yet.'));
    return section;
  }
  const grid = el('div','store-crate-grid');
  albums.slice(0, 60).forEach(([name, idxs]) => {
    const t = S.tracks[idxs[0]];
    const cell = el('div');
    const cover = el('div','store-crate-cover');
    if(t && t.art){ const im = document.createElement('img'); im.src = t.art; im.alt = ''; cover.appendChild(im); }
    cell.appendChild(cover);
    cell.appendChild(el('div','store-crate-name', name));
    cell.appendChild(el('div','store-crate-artist', t ? (t.tags.albumArtist || t.tags.artist || '') : ''));
    grid.appendChild(cell);
  });
  section.appendChild(grid);
  return section;
}

function renderStorefront(host, full, requests){
  host.innerHTML = '';
  host.appendChild(storeAwning());
  const header = el('div','store-header');
  const avatar = el('div','store-avatar');
  const label = el('div','store-avatar-label');
  label.style.background = full.labelColor;
  avatar.appendChild(label);
  header.appendChild(avatar);
  const idBox = el('div','store-id');
  idBox.appendChild(el('div','store-kicker','CRATE'));
  idBox.appendChild(el('h2','store-handle', full.profile.handle));
  if(full.profile.display_name) idBox.appendChild(el('div','store-displayname', full.profile.display_name));
  header.appendChild(idBox);
  // DA3: the signed-in storefront's own gear (which jumped straight to
  // Account) is gone — the new universal Settings button
  // renderStorefrontSection() now adds at the top of every profile-home
  // state covers this, one tap further (Settings -> Account), the same
  // entry point every other state uses too.
  host.appendChild(header);
  if(full.profile.bio) host.appendChild(el('p','store-bio', full.profile.bio));
  const visRow = el('div','store-vis-row');
  const visChip = el('button','store-vis-chip', STORE_VIS_LABEL[full.profile.visibility] || 'Friends only');
  visChip.setAttribute('aria-label','Change who can see your crate — currently ' + (STORE_VIS_LABEL[full.profile.visibility] || 'Friends only'));
  visChip.addEventListener('click', ()=> cycleStoreVisibility(full.profile, host));
  visRow.appendChild(visChip);
  host.appendChild(visRow);
  const stats = el('div','store-stats');
  stats.appendChild(storeStat('Records', full.summary.records));
  stats.appendChild(storeStat('Staff picks', full.summary.pins));
  stats.appendChild(storeStat('Followers', full.summary.followers || 0, true));
  stats.appendChild(storeStat('Digging', full.diggingCount || 0));
  host.appendChild(stats);
  if(requests && requests.length) host.appendChild(storeRequestsCard(requests, ()=> loadAndRenderStorefront(host)));
  host.appendChild(storeNowSpinningCard(full, host));
  host.appendChild(storePicksSection(full));
  if(full.diggingShared) host.appendChild(storeDiggingSection(full, host));
  host.appendChild(storeCrateGrid());
}
