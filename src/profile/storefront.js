import { S } from '../state.js';
import { $, el } from '../util/dom.js';
import { normKey } from '../util/text.js';
import { albumKey, trackTier, SOLID_IDS, EFFECT_IDS, VARIANT_DEFS, variantBackground } from '../record-art/tiers.js';
import { albumMetalFor } from '../record-art/metals.js';
import { groupBy } from '../library/model.js';
import { DB } from '../storage/idb.js';
import { persistProfile, formatDisplayName, renderProfile } from './screens.js';
import { beginSocialSignIn } from './settings.js';
import { triggerProfileRefresh } from '../shell/pull-refresh.js';
// CR11 point 3: "tapping a chip jumps the crate to the first record in
// that pressing" — a real, one-directional import each (neither imports
// anything back from this file), widening the already-circular
// screens.js pair above rather than creating a new one.
import { showRoute } from '../shell/routes.js';
import { renderTracks } from '../library/view.js';

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

// RF11 (docs/12_REFINE.md, "Profile is your crate"): the one row every
// storefront state links into the new Listening sub-screen (top album/song,
// metals, collection, the rhythm card — src/profile/screens.js's
// renderListeningScreen()). Appended right after the stats row in all
// three storefront states, the same "one home for this content" shape the
// rest of this redesign already uses elsewhere.
export function storeListeningRow(){
  const row = el('button','store-listening-row');
  row.appendChild(el('span', null, 'Listening'));
  row.appendChild(el('span','g-chev','›'));
  row.addEventListener('click', ()=>{ S.profileView.screen = 'listening'; renderProfile(); });
  return row;
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

// The identity (avatar + name) and the local crate stats/preview are shown
// here exactly the way renderLocalStorefront shows them — signing in adds
// the social features (staff picks, followers, digging, sharing), it
// doesn't replace this view with a different one. See storeAvatarButton()/
// appendNameEditor() just above/below for the shared header pieces.
export function renderOpenStoreCard(host, authState){
  host.innerHTML = '';
  host.appendChild(storeAwning());
  const needsProfile = authState === 'needsProfile';

  const header = el('div','store-header');
  header.appendChild(storeAvatarButton());
  const idBox = el('div','store-id');
  appendNameEditor(idBox);
  header.appendChild(idBox);
  host.appendChild(header);

  const stats = el('div','store-stats');
  stats.appendChild(storeStat('Records', groupBy('album').length));
  host.appendChild(stats);
  host.appendChild(storeListeningRow());

  const card = el('div','store-open-card');
  card.appendChild(el('h3', null, needsProfile ? 'Finish setting up your crate' : 'Add social features'));
  card.appendChild(el('p', null, needsProfile
    ? 'Pick a handle to start your crate — friends will find you there.'
    : 'Sign in to pin staff picks, see what friends are spinning, and share your crate.'));
  const btn = el('button','cta', needsProfile ? 'Finish setup' : 'Sign in');
  btn.addEventListener('click', beginSocialSignIn);
  card.appendChild(btn);
  host.appendChild(card);

  host.appendChild(storeCrateGrid());
}

// The one avatar button, reused by every storefront state (local-only,
// not-yet-signed-in, signed-in) so there's exactly one identity picture
// shown and edited — never a second one further down the page. Always
// edits S.profile.art, which, once signed in, also doubles as the account's
// public avatar (step 07, B4 — see CLAUDE.md's "Backup: what gets synced").
function storeAvatarButton(){
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
  return avatar;
}

// The one name editor, reused the same way as storeAvatarButton() above —
// appended into whichever .store-id is already showing. Always edits
// S.profile.name (the same name used on share cards).
function appendNameEditor(idBox){
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
  // RF11 (docs/12_REFINE.md, point 4): the plain "Settings ›" button and
  // NV4's own separately-floating, absolutely-positioned keyboard Refresh
  // button (src/shell/pull-refresh.js) used to visually collide, both
  // sitting at the top of this same screen. One menu button now covers
  // both: a real popup (role="menu") with Refresh and Settings items. The
  // pull gesture itself (src/wiring/pull-refresh.js) is unchanged — this
  // menu's Refresh item calls the exact same debounced/throttled refresh
  // function via triggerProfileRefresh(), it just doesn't duplicate the
  // gesture's own separate floating button any more.
  const menuWrap = el('div','profile-settings-wrap');
  const menuBtn = el('button','profile-settings-btn','⚙');
  menuBtn.setAttribute('aria-haspopup','menu');
  menuBtn.setAttribute('aria-expanded','false');
  menuBtn.setAttribute('aria-label','Profile menu');
  const menu = el('div','profile-settings-menu');
  menu.setAttribute('role','menu');
  menu.hidden = true;
  const closeMenu = ()=>{ menu.hidden = true; menuBtn.setAttribute('aria-expanded','false'); };
  const refreshItem = el('button','profile-settings-menu-item','Refresh');
  refreshItem.setAttribute('role','menuitem');
  refreshItem.addEventListener('click', ()=>{ closeMenu(); triggerProfileRefresh(); });
  const settingsItem = el('button','profile-settings-menu-item','Settings');
  settingsItem.setAttribute('role','menuitem');
  settingsItem.addEventListener('click', ()=>{ closeMenu(); S.profileView.screen = 'settings'; renderProfile(); });
  menu.appendChild(refreshItem);
  menu.appendChild(settingsItem);
  menuBtn.addEventListener('click', ()=>{
    const open = menu.hidden;
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  menuWrap.appendChild(menuBtn);
  menuWrap.appendChild(menu);
  body.appendChild(menuWrap);
  // D7 (docs/DESKTOP_LAYOUT.md): wraps .store-host below so
  // src/styles/23-desktop.css's own desktop grid can reach it —
  // display:contents below 1024px, the same invisible-scaffolding pattern
  // every prior D-step's own wrapper already uses, so this changes nothing
  // about how this renders on a phone. RF11 (docs/12_REFINE.md, "Profile is
  // your crate") moved the Top Album/Achievements/Collection/Share content
  // (formerly renderProfileExtras(), appended into this same grid) out to
  // its own routed Listening screen (src/profile/screens.js), reached by
  // the storeListeningRow() every one of the three storefront states below
  // appends right after its own stats row — so this grid now wraps just
  // the one piece.
  const grid = el('div','profile-desktop-grid');
  body.appendChild(grid);
  const host = el('div','store-host');
  grid.appendChild(host);
  // everything a storefront needs for staff picks, ratings, notes and the
  // crate preview already lives on this device (Step A's local engine never
  // touched the network) — so the storefront shell shows up right away,
  // with only the genuinely server-shaped pieces (followers, friend
  // requests, digging from others, sharing now-spinning) gated behind a
  // configured + signed-in account. This is the WHOLE profile screen, one
  // continuous view in every state — local-only, not-yet-signed-in, and
  // signed-in all share the same single identity header (storeAvatarButton()/
  // appendNameEditor()); signing in only adds the extra social pieces
  // (staff picks, followers, digging, requests, now spinning) into that
  // one view, never a second "profile" section of its own.
  if(!soc.enabled){
    renderLocalStorefront(host);
  } else if(soc.auth === 'ready'){
    loadAndRenderStorefront(host);
  } else {
    renderOpenStoreCard(host, soc.auth);
  }
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
  header.appendChild(storeAvatarButton());

  const idBox = el('div','store-id');
  const userIn = document.createElement('input');
  userIn.className = 'store-handle-input'; userIn.type = 'text'; userIn.placeholder = 'yourname'; userIn.maxLength = 30;
  userIn.setAttribute('aria-label','Your crate username');
  userIn.value = S.profile.username || '';
  userIn.addEventListener('change', ()=>{ S.profile.username = userIn.value.trim(); persistProfile(); renderLocalStorefront(host); });
  idBox.appendChild(userIn);

  appendNameEditor(idBox);
  header.appendChild(idBox);
  const editBtn = el('button','store-edit-btn','Edit');
  editBtn.setAttribute('aria-label','Edit your crate username');
  editBtn.addEventListener('click', ()=>{ userIn.focus(); });
  header.appendChild(editBtn);
  host.appendChild(header);

  const stats = el('div','store-stats');
  stats.appendChild(storeStat('Records', groupBy('album').length));
  stats.appendChild(storeStat('Staff picks', MizikiSocial.getPins().length, true));
  host.appendChild(stats);
  host.appendChild(storeListeningRow());

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

// RF11 (docs/12_REFINE.md): "one empty slot and '0 of 8' in its heading;
// more slots appear as records are pinned" — a brand-new crate shows
// exactly one empty slot, not seven, and the heading's own count climbs
// as each pick is added, rather than every tile existing up front.
function storePicksSection(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head');
  head.appendChild(el('h2', null, 'Staff picks — ' + full.staffPicks.length + ' of 8'));
  section.appendChild(head);
  const row = el('div','store-picks-row');
  full.staffPicks.forEach(p => row.appendChild(storePickTile(p)));
  if(full.staffPicks.length < 8){
    // RF15 (docs/12_REFINE.md, point 4, "empty slots as bin dividers"): the
    // plain dashed placeholder becomes a cream bin-divider tile — a small
    // "+" tab plus a card reading "PIN A RECORD" — the same tab-and-card
    // shape the crate's own A-Z/genre dividers already use (10-crate.css's
    // .crate-divider-tab/.crate-divider-label), per Profile.dc.html's own
    // mockup. The slot count already shows in this section's own heading
    // ("Staff picks — N of 8"), so the tile itself doesn't repeat it.
    const empty = el('div','store-pick-empty');
    empty.setAttribute('aria-label', 'Pin a record — slot ' + (full.staffPicks.length + 1) + ' of 8');
    empty.appendChild(el('span','store-pick-empty-tab','+'));
    const card = el('div','store-pick-empty-card');
    card.appendChild(el('span', null, 'Pin a record'));
    empty.appendChild(card);
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
  header.appendChild(storeAvatarButton());
  const idBox = el('div','store-id');
  idBox.appendChild(el('h2','store-handle', full.profile.handle));
  if(full.profile.display_name) idBox.appendChild(el('div','store-displayname', full.profile.display_name));
  header.appendChild(idBox);
  // DA3: the signed-in storefront's own gear (which jumped straight to
  // Account) is gone — the new universal Settings button
  // renderStorefrontSection() now adds at the top of every profile-home
  // state covers this, one tap further (Settings -> Account). The header's
  // own Edit button (added alongside the mockup-matching restyle) is a
  // second, closer-at-hand way to the same screen.
  const editBtn = el('button','store-edit-btn','Edit');
  editBtn.setAttribute('aria-label','Edit your profile');
  editBtn.addEventListener('click', ()=>{ S.profileView.screen = 'socialSettings'; renderProfile(); });
  header.appendChild(editBtn);
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
  host.appendChild(storeListeningRow());
  if(requests && requests.length) host.appendChild(storeRequestsCard(requests, ()=> loadAndRenderStorefront(host)));
  host.appendChild(storeNowSpinningCard(full, host));
  host.appendChild(storePicksSection(full));
  if(full.diggingShared) host.appendChild(storeDiggingSection(full, host));
  host.appendChild(storeCrateGrid());
}

// CR11 point 3: how many of a family's own ids an owned-set actually holds —
// used only for the "N OF 40 · M OF 32" count line, never shown on a
// friend's card (point 4: counts are first-person only).
function countOwned(ownedIds, ids){
  let n = 0;
  for(const id of ids) if(ownedIds.has(id)) n++;
  return n;
}

// CR11 point 3: a cream catalog card with a paint-chip strip, in family
// order (SOLID_IDS/EFFECT_IDS are already in that order — see their own
// export comment in record-art/tiers.js). Shared between the profile's own
// chart (opts.showNumbers true: a real count, missing names, tap-to-jump)
// and a friend's (opts.showNumbers false: chips only, no numbers, no tap —
// point 4, nothing here compares two people).
export function renderPressingCard(ownedIds, opts = {}){
  const showNumbers = !!opts.showNumbers;
  const card = el('div','pressing-card');
  card.appendChild(el('h3','pressing-card-head','Pressings'));
  if(showNumbers){
    const solidN = countOwned(ownedIds, SOLID_IDS), effectN = countOwned(ownedIds, EFFECT_IDS);
    card.appendChild(el('div','pressing-card-count', solidN + ' OF ' + SOLID_IDS.length + ' · ' + effectN + ' OF ' + EFFECT_IDS.length));
  }
  const strip = el('div','pressing-chip-strip');
  const allIds = [...SOLID_IDS, ...EFFECT_IDS];
  const missingNames = [];
  allIds.forEach(id => {
    const def = VARIANT_DEFS[id];
    const owned = ownedIds.has(id);
    if(!owned) missingNames.push(def.name);
    const clickable = showNumbers && owned;
    const chip = el(clickable ? 'button' : 'div', 'pressing-chip' + (owned ? ' owned' : ' missing'));
    chip.style.background = variantBackground(def);
    chip.setAttribute('aria-label', def.name + (owned ? '' : ' (not yet in your crate)'));
    if(def.band === 'scarce') chip.appendChild(el('span','pressing-chip-dot'));
    if(clickable){
      chip.addEventListener('click', ()=>{
        S.view.mode = 'crate'; S.view.group = null; S.view.artistAlbum = null; S.view.playlist = null;
        S.view.person = null; S.view.crateLooseIdx = null; S.view.picking = false;
        S.crate.pendingJumpVariant = id;
        showRoute('library');
        renderTracks();
      });
    }
    strip.appendChild(chip);
  });
  card.appendChild(strip);
  if(showNumbers && missingNames.length){
    const shown = missingNames.slice(0, 4).join(', ') + (missingNames.length > 4 ? ', ...' : '');
    card.appendChild(el('p','pressing-card-missing','Missing: ' + shown));
  }
  return card;
}
