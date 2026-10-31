import { S } from '../state.js';
import { $, el } from '../util/dom.js';
import { makeSwitch } from '../ui/switch.js';
import { normKey } from '../util/text.js';
import { albumKey, trackTier, SOLID_IDS, EFFECT_IDS, RARE_IDS, ZOETROPE_IDS, VARIANT_DEFS, variantBackground } from '../record-art/tiers.js';
import { albumMetalFor } from '../record-art/metals.js';
import { mostRecentlySpunAlbum, lastSpunPhrase } from '../crate/model.js';
import { DB } from '../storage/idb.js';
import { persistProfile, formatDisplayName, renderProfile } from './screens.js';
import { beginSocialSignIn } from './settings.js';
// The Records section (records + unlocked pressings/metals) — part of this
// file's circular cluster with screens.js; see records.js's own header.
import { storeRecordsSection } from './records.js';
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

// TY4 (docs/22_TYPE.md): four colourways from the CR8 palette, picked by a
// hash of the username rather than anything about the account, so friends'
// storefronts differ from each other by colour alone, never by type.
const AWNING_COLORWAYS = ['var(--olive)', 'var(--verdigris)', 'var(--prussian)', 'var(--puce)'];
function awningColorway(handle){
  let h = 0;
  for(let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) | 0;
  return AWNING_COLORWAYS[Math.abs(h) % AWNING_COLORWAYS.length];
}

// `handle` is omitted while there's no username yet (renderOpenStoreCard) —
// the plain striped strip, no "Crate of" card, since there's no name to set
// a colourway from or print on it. `isMe` (FS7, docs/25_FROM_SCRATCH.md
// point 2): "your own crate defaults to the oxblood colourway" -- your own
// three storefront states all pass it; a friend's crate (social/screens/
// friend-store.js) doesn't, and keeps its own hash-picked colourway.
export function storeAwning(handle, isMe){
  const wrap = el('div','store-awning-wrap');
  const awning = el('div','store-awning');
  // FS2 (docs/25_FROM_SCRATCH.md): the no-handle default is oxblood, not
  // amber -- amber never signals state, and this fallback is the one
  // place the awning has no username to hash a colourway from.
  const stripe = isMe ? '#7A2E2A' : handle ? awningColorway(handle) : '#7A2E2A';
  for(let i = 0; i < 10; i++){
    const div = el('div');
    div.style.background = (i % 2 === 0) ? stripe : (handle ? 'var(--cream)' : 'var(--stock-divider-1)');
    awning.appendChild(div);
  }
  wrap.appendChild(awning);
  if(handle){
    const card = el('div','store-awning-card');
    card.appendChild(el('div','store-awning-kicker','Crate of'));
    // TY4: a long name drops a weight/tracking step rather than condensing,
    // wrapping or ellipsizing — see 18-storefront.css's own three size rules.
    const nameSize = handle.length > 22 ? 'sm' : handle.length > 14 ? 'md' : 'lg';
    card.appendChild(el('div', 'store-awning-name store-awning-name--' + nameSize, handle));
    wrap.appendChild(card);
  }
  return wrap;
}

// FS3 (docs/25_FROM_SCRATCH.md): the one switch component for the whole
// app now lives in ui/switch.js -- this stays as a thin wrapper so every
// existing call site (profile/privacy.js, profile/screens.js,
// profile/slipmat-editor.js, this file's own storefront/social rows)
// keeps working unchanged. `row`, when passed, is the whole settings-row
// element the switch sits in, so tapping the row's label also toggles it.
export function storeSwitch(label, checked, onToggle, row){
  return makeSwitch({checked, label, onChange: onToggle, row});
}

export function storeStat(label, value, accent){
  const s = el('div','store-stat' + (accent ? ' accent' : ''));
  s.appendChild(el('b', null, String(value)));
  s.appendChild(el('span', null, label));
  return s;
}

// FS7 (docs/25_FROM_SCRATCH.md point 4): "one raised row with the last
// record you played and 'Spun last night'/'Spun 3 hours ago'" -- replaces
// the stats row in every one of this own crate's three storefront states.
// A friend's crate keeps its own stats row (Records/Staff picks/In common,
// QC3) untouched -- social/screens/friend-store.js's own storeStat() calls
// aren't this function's job. Returns null (nothing played yet) rather
// than a placeholder, so the caller can skip the row entirely.
export function storeLastSpunRow(){
  const spun = mostRecentlySpunAlbum();
  if(!spun) return null;
  const adapter = MizikiSocial.mizikiAdapter({S, DB, albumKey, trackTier, albumMetalFor});
  const info = adapter.albumInfo(spun.albumId);
  if(!info) return null;
  const row = el('div','store-last-spun');
  const cover = el('div','store-last-spun-cover');
  const art = localAlbumArt(info.title, info.artist);
  if(art){ const im = document.createElement('img'); im.src = art; im.alt = ''; cover.appendChild(im); }
  row.appendChild(cover);
  const text = el('div','store-last-spun-text');
  text.appendChild(el('b', null, info.title));
  text.appendChild(el('span','store-last-spun-when', 'Spun ' + lastSpunPhrase(spun.ts)));
  row.appendChild(text);
  return row;
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
  if(pick.sleeve_note) note.appendChild(el('div', 'store-pick-sleeve-note', pick.sleeve_note));
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
  host.appendChild(storeAwning(undefined, true));
  const needsProfile = authState === 'needsProfile';

  const header = el('div','store-header');
  header.appendChild(storeAvatarButton());
  const idBox = el('div','store-id');
  appendNameEditor(idBox);
  header.appendChild(idBox);
  host.appendChild(header);

  const lastSpun = storeLastSpunRow();
  if(lastSpun) host.appendChild(lastSpun);
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

  host.appendChild(storeRecordsSection());
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
  // FS7 (docs/25_FROM_SCRATCH.md point 1): "the wordmark top-left, Settings
  // top-right" moved this universal entry point into the shared #appHeader
  // (#hdrProfileSettingsBtn/#hdrProfileRefreshBtn, wired once in
  // src/wiring/account.js) -- the gear-icon dropdown this function used to
  // build fresh on every render is gone; nothing to append here any more.
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
  // signature expects — the one deliberate exception to "no DB calls
  // outside src/storage/," since the adapter is social-client code, not
  // this app's own storage access.
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
  host.appendChild(storeAwning(S.profile.username || '', true));

  // FS7 (docs/25_FROM_SCRATCH.md point 3): the awning above already prints
  // "Crate of {username}" (point 2) -- this input still sets that same
  // S.profile.username, just demoted out of the identity row's own
  // primary text (the display name takes that spot now) into a small
  // secondary line below the header, same "@handle" shape a social handle
  // gets once one exists.
  const userIn = document.createElement('input');
  userIn.className = 'store-username-input'; userIn.type = 'text'; userIn.placeholder = 'yourname'; userIn.maxLength = 30;
  userIn.setAttribute('aria-label','Your crate username');
  userIn.value = S.profile.username || '';
  userIn.addEventListener('change', ()=>{ S.profile.username = userIn.value.trim(); persistProfile(); renderLocalStorefront(host); });

  const header = el('div','store-header');
  header.appendChild(storeAvatarButton());
  const idBox = el('div','store-id');
  appendNameEditor(idBox);
  header.appendChild(idBox);
  const editBtn = el('button','store-edit-btn','Edit');
  editBtn.setAttribute('aria-label','Edit your crate username');
  editBtn.addEventListener('click', ()=>{ userIn.focus(); });
  header.appendChild(editBtn);
  host.appendChild(header);

  const userRow = el('div','store-username-row');
  userRow.appendChild(el('span','store-username-at','@'));
  userRow.appendChild(userIn);
  host.appendChild(userRow);

  const lastSpun = storeLastSpunRow();
  if(lastSpun) host.appendChild(lastSpun);
  host.appendChild(storeListeningRow());

  host.appendChild(storePicksSection({staffPicks: localStaffPicks()}));
  const found = storeRecentlyFoundSection();
  if(found) host.appendChild(found);
  host.appendChild(storeRecordsSection());

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

// QC3 (docs/24_QUIET_COUNTS.md): staff picks are shown as found, never
// counted toward their cap — heading has no "— N of 8", and there is no
// empty "Pin a record" slot (pinning itself happens from a record's own
// gatefold/crate menu, src/gatefold/view.js and src/crate/view.js's own
// MizikiSocial.pin() calls — never from a tile in this section). The cap
// of 8 is still enforced as a rule by MizikiSocial.pin() itself; this
// section just stops displaying it. Zero picks gets one plain line
// instead of a placeholder tile.
export function storePicksSection(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head');
  head.appendChild(el('h2', null, 'Staff picks'));
  section.appendChild(head);
  if(!full.staffPicks.length){
    section.appendChild(el('p','store-loading','Pin a record to put it here.'));
    return section;
  }
  const row = el('div','store-picks-row');
  full.staffPicks.forEach(p => row.appendChild(storePickTile(p)));
  section.appendChild(row);
  return section;
}

// FS7 (docs/25_FROM_SCRATCH.md point 6): "the three newest pressings
// you've found, as discs (newest first, no count, no link to 'more' —
// the full chart stays on Records)." S.collection (history/achievements.js's
// upsertCollectionEntry()) already carries exactly what this needs --
// variant/pattern to draw the disc, name/artist/discoveredAt -- with no
// new tracking. Local-only data, so it's the same across all three
// storefront states; returns null when nothing's been found yet, same
// "skip the row entirely" shape storeLastSpunRow() uses.
export function storeRecentlyFoundSection(){
  const found = Object.values(S.collection)
    .sort((a, b) => b.discoveredAt - a.discoveredAt)
    .slice(0, 3);
  if(!found.length) return null;
  const section = el('div','store-section');
  const head = el('div','store-section-head');
  head.appendChild(el('h2', null, 'Recently found'));
  section.appendChild(head);
  const row = el('div','store-found-row');
  found.forEach(rec => {
    const tile = el('div','store-found-tile');
    const disc = el('div','store-found-disc');
    const def = VARIANT_DEFS[rec.variant];
    if(def) disc.style.background = variantBackground(def);
    disc.setAttribute('aria-label', (def && def.name) || rec.name);
    tile.appendChild(disc);
    const label = el('div','store-found-label');
    label.appendChild(el('b', null, rec.name));
    label.appendChild(el('span', null, rec.artist));
    tile.appendChild(label);
    row.appendChild(tile);
  });
  section.appendChild(row);
  return section;
}

function storeDiggingSection(full, host){
  // D7: the one modifier class this step adds, since store-section alone
  // (shared with storePicksSection/storeRecordsSection) gives
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

function renderStorefront(host, full, requests){
  host.innerHTML = '';
  host.appendChild(storeAwning(full.profile.handle, true));
  const header = el('div','store-header');
  header.appendChild(storeAvatarButton());
  // FS7 (docs/25_FROM_SCRATCH.md point 3): "display name Archivo 20/600,
  // then your own short line (bio/name field) in --muted — nothing when
  // it's empty." The @handle moves out of this primary spot -- the awning
  // above already prints "Crate of {handle}" (point 2), so repeating it
  // here would be the second big heading this redesign's "one in one out"
  // rule keeps dropping; it gets the same small "@handle" secondary line
  // the local-only state's own username now does, right below the header.
  const idBox = el('div','store-id');
  idBox.appendChild(el('div','store-name', full.profile.display_name || full.profile.handle));
  if(full.profile.bio) idBox.appendChild(el('p','store-bio', full.profile.bio));
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
  const handleRow = el('div','store-username-row');
  handleRow.appendChild(el('span','store-username-at','@'));
  handleRow.appendChild(el('span', null, full.profile.handle));
  host.appendChild(handleRow);
  const visRow = el('div','store-vis-row');
  const visChip = el('button','store-vis-chip', STORE_VIS_LABEL[full.profile.visibility] || 'Friends only');
  visChip.setAttribute('aria-label','Change who can see your crate — currently ' + (STORE_VIS_LABEL[full.profile.visibility] || 'Friends only'));
  visChip.addEventListener('click', ()=> cycleStoreVisibility(full.profile, host));
  visRow.appendChild(visChip);
  host.appendChild(visRow);
  const lastSpun = storeLastSpunRow();
  if(lastSpun) host.appendChild(lastSpun);
  host.appendChild(storeListeningRow());
  if(requests && requests.length) host.appendChild(storeRequestsCard(requests, ()=> loadAndRenderStorefront(host)));
  host.appendChild(storeNowSpinningCard(full, host));
  host.appendChild(storePicksSection(full));
  const found = storeRecentlyFoundSection();
  if(found) host.appendChild(found);
  if(full.diggingShared) host.appendChild(storeDiggingSection(full, host));
  host.appendChild(storeRecordsSection());
}

// QC1 (docs/24_QUIET_COUNTS.md): pressings are found, never counted toward
// a total — one row per family (SOLID_IDS/EFFECT_IDS/RARE_IDS/ZOETROPE_IDS,
// already in family order — see their own export comments in
// record-art/tiers.js) that has at least one owned chip, and only the
// owned chips themselves; nothing missing is ever drawn. Shared between
// the profile's own chart (opts.interactive true: tap-to-jump, see CR11)
// and a friend's (opts.interactive false — point 4, nothing here compares
// two people). opts.metals, when given, is the caller's own pre-resolved
// {tier, label, bg} list (highest tier last) for the dashed-off Metals
// row; omitted or empty draws no Metals row at all. A friend's own owned
// set (social/screens/friend-store.js) only ever carries solid/effect
// ids, since quality_tier can't say whether a rare or zoetrope was
// earned, and passes no metals.
const PRESSING_FAMILIES = [
  {label:'Colors', ids:SOLID_IDS},
  {label:'Effects', ids:EFFECT_IDS},
  {label:'Rare', ids:RARE_IDS},
  {label:'Zoetropes', ids:ZOETROPE_IDS},
];
export function renderPressingCard(ownedIds, opts = {}){
  const interactive = !!opts.interactive;
  const metals = opts.metals || [];
  const card = el('div','pressing-card');
  const head = el('div','pressing-card-head-row');
  head.appendChild(el('h3','pressing-card-head','Pressings'));
  head.appendChild(el('span','pressing-card-found','found while listening'));
  card.appendChild(head);

  PRESSING_FAMILIES.forEach(({label, ids}) => {
    const owned = ids.filter(id => ownedIds.has(id));
    if(!owned.length) return;
    const row = el('div','pressing-family-row');
    row.appendChild(el('span','pressing-family-label', label));
    const strip = el('div','pressing-chip-strip');
    owned.forEach(id => {
      const def = VARIANT_DEFS[id];
      const chip = el(interactive ? 'button' : 'div', 'pressing-chip owned');
      chip.style.background = variantBackground(def);
      chip.setAttribute('aria-label', def.name);
      if(def.band === 'scarce') chip.appendChild(el('span','pressing-chip-dot'));
      if(interactive){
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
    row.appendChild(strip);
    card.appendChild(row);
  });

  if(metals.length){
    const metalsBlock = el('div','pressing-metals');
    metalsBlock.appendChild(el('span','pressing-family-label','Metals'));
    const row = el('div','pressing-metals-row');
    metals.forEach(m => {
      const cell = el('div','pressing-metal-cell');
      const disc = el('span','pressing-metal-disc');
      disc.style.background = m.bg;
      disc.setAttribute('aria-label', m.label);
      cell.appendChild(disc);
      cell.appendChild(el('span','pressing-metal-name', m.label));
      row.appendChild(cell);
    });
    metalsBlock.appendChild(row);
    card.appendChild(metalsBlock);
  }

  return card;
}
