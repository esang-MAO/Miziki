import { S, current } from '../state.js';
import { $, el } from '../util/dom.js';
import { makeSwitch } from '../ui/switch.js';
import { normKey } from '../util/text.js';
import { albumKey, trackTier, albumPressingTrack, SOLID_IDS, EFFECT_IDS, RARE_IDS, ZOETROPE_IDS, VARIANT_DEFS, variantBackground, selectVariantForAlbum, getVariantDef } from '../record-art/tiers.js';
import { albumMetalFor } from '../record-art/metals.js';
import { discLook } from '../record-art/looks.js';
import { mostRecentlySpunAlbum, crateFlatAlbumOrder } from '../crate/model.js';
import { DB } from '../storage/idb.js';
import { persistProfile, formatDisplayName, renderProfile } from './screens.js';
import { beginSocialSignIn } from './settings.js';
// The Records screen (records + unlocked pressings/metals) — part of this
// file's circular cluster with screens.js; see records.js's own header.
// storeShelvesSection's own "Browse all" (GS11) opens straight into it via
// openRecords(); storePressingsTeaserRow() is the one other entry point
// this file still draws on the profile home.
import { openRecords, storePressingsTeaserRow, metalDisc, pressingDisc } from './records.js';
import { thumbURL } from '../library/thumbs.js';
import { achievementsList } from '../history/achievements.js';
import { PHASE_CAPS } from '../sundown/spin-wording.js';
// CR11 point 3: "tapping a chip jumps the crate to the first record in
// that pressing" — a real, one-directional import each (neither imports
// anything back from this file), widening the already-circular
// screens.js pair above rather than creating a new one.
import { showRoute } from '../shell/routes.js';
import { albumFormatFor } from '../shell/ceremony-timing.js';
import { renderTracks } from '../library/view.js';
import { renderShelfUnit, shelfUnitCubes, SHELF_UNIT_CUBES, dedupeCrateItems } from './shelf-unit.js';
import { displayShelfFinish } from './shelf-finish.js';
import { displayTurntable } from './turntable.js';
import { hasDeluxe } from '../deluxe.js';
import { RPM_33 } from '../record-art/format.js';
import { stickerBadge } from '../social/sticker.js';

// Shared card-building primitives (frame 01/04 of the social spec) — each
// is used both here, in "my own storefront," and in the friend-store
// screens (src/social/screens/friend-store.js), since a friend's crate is
// drawn with the same stats/picks/awning/time-ago vocabulary as your own.
export const STORE_TIER_LABEL = {1:'LOSSY', 2:'LOSSLESS', 3:'HI-RES'};
export const STORE_VIS_LABEL = {private:'Only you', friends:'Friends only', public:'Everyone'};

function wallDayMonth(ms){
  const d = new Date(ms);
  return d.getDate() + ' ' + d.toLocaleDateString('en-US', {month:'short'}).toUpperCase();
}
function wallMonth(ms){
  return new Date(ms).toLocaleDateString('en-US', {month:'short'}).toUpperCase();
}

// GS7 (docs/30_GROOVES_AND_SHELF.md): replaces the old striped awning +
// "Crate of [name]" card (and its colourway hash) with a paper sign taped
// above the crate, matching docs/design/grooves-shelf/HomeShelf.dc.html --
// stock-card paper, two tape strips, the handle in var(--hand) and "'s
// crate" in var(--hand) at a smaller weight/size. A friend's crate
// (social/screens/friend-store.js) gets the same sign with their handle --
// there's no colourway left to tell them apart by.
// `handle` is omitted while there's no username yet (renderLocalStorefront,
// before S.profile.username is set) -- nothing to letter onto a sign, so
// this returns an empty wrap.
export function storeSign(handle){
  const wrap = el('div','store-sign-wrap');
  if(!handle) return wrap;
  const sign = el('div','store-sign');
  const tape1 = el('span','store-sign-tape store-sign-tape--1'); tape1.setAttribute('aria-hidden','true');
  const tape2 = el('span','store-sign-tape store-sign-tape--2'); tape2.setAttribute('aria-hidden','true');
  sign.appendChild(tape1); sign.appendChild(tape2);
  // TY4-style step-down for a long handle -- same three-size ladder the
  // old .store-awning-name used, just against the hand-lettered sizes.
  const nameSize = handle.length > 22 ? 'sm' : handle.length > 14 ? 'md' : 'lg';
  sign.appendChild(el('span', 'store-sign-name store-sign-name--' + nameSize, handle));
  sign.appendChild(el('span','store-sign-suffix','’s crate'));
  wrap.appendChild(sign);
  return wrap;
}

// UN12 (docs/36_UNIFORMITY.md point 12): "the profile has one header" --
// the plate that now fills #hdrProfilePlate (miziki.html), replacing
// storeSign()'s old job of being the first thing drawn in the profile
// body. A smaller, untaped twin of storeSign() above (same hand-lettered
// "{handle}'s crate" idea, 01-header.css's own sizing) -- kept as a
// separate function rather than a storeSign() size param, since this one
// also has to cover the signed-out case storeSign() deliberately leaves
// blank: "Signed out with no username, the plate reads 'your crate'."
export function profileHeaderPlate(handle){
  const card = el('div','hdr-profile-plate-card');
  if(handle){
    card.appendChild(el('span','hdr-profile-plate-name', handle));
    card.appendChild(el('span','hdr-profile-plate-suffix','’s crate'));
  } else {
    card.appendChild(el('span','hdr-profile-plate-name','your crate'));
  }
  return card;
}

// Fills #hdrProfilePlate with the current handle's plate -- called by both
// renderLocalStorefront() and renderStorefront() below (the only two
// places that know the live handle), rather than from renderProfile()'s
// own top-of-function pass, since a username/handle can change from a
// plain input `change` event that re-renders only the body host, not the
// whole profile screen. #hdrProfilePlate doesn't exist outside the
// Profile route's own header markup, so this no-ops everywhere else.
function updateHeaderPlate(handle){
  const host = $('#hdrProfilePlate');
  if(!host) return;
  host.innerHTML = '';
  host.appendChild(profileHeaderPlate(handle || ''));
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
  row.addEventListener('click', ()=>{ S.profileView.screen = 'listening'; S.profileView.seasonOffset = 0; renderProfile(); });
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

// UN16 (docs/36_UNIFORMITY.md point 3): a friend's own cover art never
// reaches this device — a shared fallback for every place a friend's
// record can show with nothing to draw (the wall, the shelf, Fresh for
// you, the digging list, Held for you): a printed title card in the
// record's own pressing colour, same artist+title+tier lookup CR11's
// pressingLineFor()/friendPressingSection() already use for a friend's
// pressing (never a new RPC). `tier` is whichever quality_tier the
// caller has on hand; several of these rows carry none at all (Held for
// you's releases, the digging list) — null just reads as a plain muted
// card instead of a wrong colour, never a thrown error.
export function noArtCover(title, artist, tier){
  const cover = el('div','store-no-art-cover');
  let color = null;
  if(tier != null){
    try{ color = getVariantDef(selectVariantForAlbum(artist, title, tier).variant).colors[1]; }catch(_e){ /* stays muted */ }
  }
  // backgroundColor, not the background shorthand -- the shorthand would
  // reset .store-no-art-cover's own CSS background-image scrim (05-parts/
  // 18-storefront.css), which is what keeps the title/artist text legible
  // over any pressing colour.
  cover.style.backgroundColor = color || 'var(--panel)';
  cover.appendChild(el('span','store-no-art-title', title));
  cover.appendChild(el('span','store-no-art-artist', artist));
  return cover;
}

// CC3 (docs/34_CARE_AND_CONTROL.md): `owners`, when given, is this
// record's own friends-sticker count (release_id -> owners, resolved by
// the caller) -- `pick` is always a face-out "in rotation" pin here (a
// friend's crate) or a Fresh-for-you row, both in the plan's "face-out
// pins" wiring list; the local profile home's own staff-pick tiles never
// pass one, since those are always already-owned records.
export function storePickTile(pick, owners){
  const tile = el('div','store-pick');
  const cover = el('div','store-pick-cover');
  const art = localAlbumArt(pick.title, pick.artist);
  if(art){ const im = document.createElement('img'); im.src = art; im.alt = ''; cover.appendChild(im); }
  else cover.appendChild(noArtCover(pick.title, pick.artist, pick.quality_tier));
  cover.appendChild(el('span','store-pick-tier', STORE_TIER_LABEL[pick.quality_tier] || ''));
  if(owners){
    const badge = stickerBadge(pick.release_id, owners);
    if(badge) cover.appendChild(badge);
  }
  tile.appendChild(cover);
  const note = el('div','store-pick-note');
  note.appendChild(el('div','store-pick-stars', pick.rating ? '★'.repeat(pick.rating) + '☆'.repeat(5 - pick.rating) : ''));
  note.appendChild(el('div','store-pick-name', pick.title));
  if(pick.sleeve_note) note.appendChild(el('div', 'store-pick-sleeve-note', pick.sleeve_note));
  // GS12 (docs/30_GROOVES_AND_SHELF.md): a note pinned to a track shows
  // this one extra mono line -- side.label already has "SIDE " baked in
  // (gatefoldSideSplits(), src/gatefold/view.js), note_anchor.side is that
  // same label with it stripped, so it's added back here to read "SIDE B · 4".
  if(pick.sleeve_note && pick.note_anchor) note.appendChild(el('div','store-pick-anchor',
    'SIDE ' + pick.note_anchor.side + ' · ' + pick.note_anchor.track));
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
  // UN12 (docs/36_UNIFORMITY.md point 12): "the profile has one header" --
  // the Settings gear lives in the shared #appHeader now
  // (#hdrProfileSettingsBtn, wired once in src/wiring/account.js), and the
  // plate (#hdrProfilePlate) is filled by renderLocalStorefront()/
  // renderStorefront() below via updateHeaderPlate() -- the gear-icon
  // dropdown this function used to build fresh on every render is gone;
  // nothing to append here any more.
  // D7 (docs/DESKTOP_LAYOUT.md): wraps .store-host below so
  // src/styles/23-desktop.css's own desktop grid can reach it —
  // display:contents below 1024px, the same invisible-scaffolding pattern
  // every prior D-step's own wrapper already uses, so this changes nothing
  // about how this renders on a phone. RF11 (docs/12_REFINE.md, "Profile is
  // your crate") moved the Top Album/Achievements/Collection/Share content
  // (formerly renderProfileExtras(), appended into this same grid) out to
  // its own routed Listening screen (src/profile/screens.js), reached by
  // the storeListeningRow() every one of the storefront states below
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
  // continuous view in every state. GS8 follow-up (Ken: "the profile view
  // [should be] uniform whether signed in or out"): local-only and
  // not-yet-signed-in are now the exact same renderLocalStorefront() call
  // (its own `cta` argument is the only thing that varies between them),
  // so there's no longer a separate renderOpenStoreCard() to drift out of
  // sync. Signed-in (renderStorefront()) keeps the same
  // turntable/wall/shelves/records order and shares the one identity
  // header (storeAvatarButton()/appendNameEditor()); signing in only adds
  // the extra server-shaped pieces into that same view, never a second
  // "profile" section of its own. GS11 (Ken: "'the shelves' should replace
  // the 'records' menu on the profile"): the shelves cube grid is now the
  // one crate-browsing entry point here -- see storeShelvesSection()'s own
  // header for what replaced the old records-preview-grid section.
  if(!soc.enabled){
    renderLocalStorefront(host);
  } else if(soc.auth === 'ready'){
    loadAndRenderStorefront(host);
  } else {
    renderLocalStorefront(host, soc.auth);
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
      rating: social.rating, sleeve_note: social.note, note_anchor: social.noteAnchor, pin_rank: social.pinRank};
  }).filter(Boolean);
}

// GS8 follow-up: the one signed-out storefront, shown identically whether
// social is configured at all or not -- Ken: "the profile view [should be]
// uniform whether signed in or out." Used to be two near-duplicate
// functions (a "local preview" with no account configured, and a bare
// turntable + sign-in card once social was configured but not signed into)
// that drifted out of sync with each other and with the signed-in layout
// below. Now it's the one function, with `cta` the only thing that varies:
// null (social never configured) shows the quiet "local preview" note;
// 'signIn'/'needsProfile' (social configured, not signed in) shows the
// sign-in prompt in that same footer spot instead. Everything else --
// identity header, the editable @username row (S.profile.username, local
// regardless of sign-in state), turntable, wall, shelves, records -- is
// identical either way, same order the signed-in storefront
// (renderStorefront() below) uses for its own turntable/wall/shelves/records
// run.
function renderLocalStorefront(host, cta){
  host.innerHTML = '';
  updateHeaderPlate(S.profile.username || '');

  // FS7 (docs/25_FROM_SCRATCH.md point 3): the plate above (now in the
  // header -- UN12) already shows "{username}'s crate" (GS7 superseded
  // the old "Crate of {username}" wording) -- this input still sets that
  // same S.profile.username, just demoted out of the identity row's own
  // primary text (the display name takes that spot now) into a small
  // secondary line under the name, same "@handle" shape a social handle
  // gets once one exists.
  const userIn = document.createElement('input');
  userIn.className = 'store-username-input'; userIn.type = 'text'; userIn.placeholder = 'yourname'; userIn.maxLength = 30;
  userIn.setAttribute('aria-label','Your crate username');
  userIn.value = S.profile.username || '';
  userIn.addEventListener('change', ()=>{ S.profile.username = userIn.value.trim(); persistProfile(); renderLocalStorefront(host, cta); });

  const header = el('div','store-header');
  header.appendChild(storeAvatarButton());
  const idBox = el('div','store-id');
  appendNameEditor(idBox);
  const userRow = el('div','store-username-row');
  userRow.appendChild(el('span','store-username-at','@'));
  userRow.appendChild(userIn);
  idBox.appendChild(userRow);
  header.appendChild(idBox);
  const editBtn = el('button','store-edit-btn','Edit');
  editBtn.setAttribute('aria-label','Edit your crate username');
  editBtn.addEventListener('click', ()=>{ userIn.focus(); });
  header.appendChild(editBtn);
  host.appendChild(header);

  const picks = localStaffPicks();
  host.appendChild(storeWallSection(picks));
  host.appendChild(storeShelfUnitSection(shelfItemsFromCrate(crateFlatAlbumOrder(S.crateGroup)), picks.map(p => p.release_id), null));
  host.appendChild(storeListeningRow());
  host.appendChild(storePressingsTeaserRow());

  if(cta){
    const needsProfile = cta === 'needsProfile';
    const card = el('div','store-open-card');
    card.appendChild(el('h3', null, needsProfile ? 'Finish setting up your crate' : 'Add social features'));
    card.appendChild(el('p', null, needsProfile
      ? 'Pick a handle to start your crate — friends will find you there.'
      : 'Sign in to pin staff picks, see what friends are spinning, and share your crate.'));
    const btn = el('button','cta', needsProfile ? 'Finish setup' : 'Sign in');
    btn.addEventListener('click', beginSocialSignIn);
    card.appendChild(btn);
    host.appendChild(card);
  }
  // UN12 point 15: the plain "local preview" note this branch used to show
  // here is gone -- wirePrivacyLink() (profile/privacy-link.js, called
  // once per Profile-tab visit from screens.js's renderProfileHome) now
  // builds its replacement (a Privacy navRow + one muted line) right after
  // this same !soc.enabled state, so there's no empty gap left behind.
}

async function loadAndRenderStorefront(host){
  host.innerHTML = '';
  host.appendChild(el('div','store-loading','Loading your crate…'));
  const me = await MizikiSocial.getMyProfile();
  if(!me.ok){ renderStoreError(host, me.error, ()=>loadAndRenderStorefront(host)); return; }
  if(!me.profile){ renderLocalStorefront(host, 'needsProfile'); return; }
  const [full, reqs] = await Promise.all([
    MizikiSocial.loadProfile(me.profile.handle),
    MizikiSocial.listRequests()
  ]);
  if(!full.ok){ renderStoreError(host, full.error, ()=>loadAndRenderStorefront(host)); return; }
  renderStorefront(host, full, (reqs.ok && reqs.requests) || []);
}

// ST6 (docs/32_SHELF_AND_TURNTABLES.md point 2): "the client writes them
// when S.shelfFinish/S.turntable change (signed in only)." Exported so
// shelf-finish-sheet.js/turntable-sheet.js (where the only two picks
// actually happen) can call it right after their own local S.*/queueSave()
// write, without either sheet needing its own MizikiSocial.status() gate
// -- fire-and-forget, same as this file's cycleStoreVisibility() above:
// a failed/offline push leaves the local choice intact (it just stays
// unpublished until the next successful pick or sign-in), never blocks
// the sheet's own instant-apply UI.
export function pushShelfChoice(patch){
  if(typeof MizikiSocial === 'undefined') return;
  const soc = MizikiSocial.status();
  if(!soc.enabled || soc.auth !== 'ready') return;
  MizikiSocial.updateProfile(patch);
}

async function cycleStoreVisibility(profile, host){
  const order = ['private','friends','public'];
  const next = order[(order.indexOf(profile.visibility) + 1) % order.length];
  const r = await MizikiSocial.updateProfile({visibility: next});
  if(r.ok) loadAndRenderStorefront(host);
}

// ST2: storeNowSpinningCard() is removed -- the shelf unit's own caption
// (shelfUnitTurntableInfo() above) now shows what's spinning, and the
// "Share what you're spinning" setting it also carried already has its
// own home on the Privacy screen (src/profile/privacy.js), unchanged.

// WS1 (docs/33_WALL_AND_LABELS.md), superseding GS8 (docs/30_GROOVES_AND_
// SHELF.md point 2): "On the wall" -- a floating picture ledge for "in
// rotation" (storeLedge() below, replacing the framed covers) and a wall
// cubby for the last three pressings/metals found (storeWallCubby(),
// replacing the loose discs), both built from the shelf unit's own wood
// finish (--wood-* custom properties, src/profile/shelf-unit.js/
// 18-storefront.css) via the one `data-finish` attribute set on the
// section itself. `picks` is the caller's own pin-rank-ordered staffPicks
// list (localStaffPicks() or full.staffPicks) -- only picks[0..2] stand
// on the ledge; picks[3]/[4] are drawn face-out on the shelves instead
// (storeShelvesSection() below).
export function storeWallSection(picks){
  const section = el('div','store-section store-wall');
  section.setAttribute('data-finish', displayShelfFinish(S.shelfFinish, hasDeluxe()));
  const head = el('div','store-section-head');
  head.appendChild(el('h2', 'p-label', 'On the wall'));
  section.appendChild(head);
  if(picks.length){
    section.appendChild(el('p','store-wall-caption','in rotation'));
    section.appendChild(storeLedge(picks.slice(0, 3)));
  } else {
    section.appendChild(el('p','store-loading','Pin a record to put it on the wall.'));
  }
  const cubby = storeWallCubby();
  // UN14 point 2/5 (docs/36_UNIFORMITY.md): no found pressings or metals
  // yet means no empty cubby or placeholder frames, just this one line.
  section.appendChild(cubby || el('p','store-loading','Play an album start to finish…'));
  return section;
}

// The picture ledge: a full-width wood shelf with a front lip, pins
// standing behind it tilted back slightly. Pin 1 keeps the "must hear"
// sticker. Empty pins (fewer than 3 picks) just leave the ledge bare --
// no placeholders, per docs/24_QUIET_COUNTS.md.
function storeLedge(picks){
  const ledge = el('div','store-wall-ledge');
  ledge.appendChild(el('div','store-ledge-top'));
  const pins = el('div','store-ledge-pins');
  picks.forEach((pick, i) => {
    const pin = el('div','store-ledge-pin');
    const cover = el('div','store-ledge-cover');
    const art = localAlbumArt(pick.title, pick.artist);
    if(art){ const im = document.createElement('img'); im.src = art; im.alt = ''; cover.appendChild(im); }
    pin.appendChild(cover);
    if(i === 0) pin.appendChild(el('span','store-ledge-sticker','must hear'));
    pins.appendChild(pin);
  });
  ledge.appendChild(pins);
  ledge.appendChild(el('div','store-ledge-lip'));
  // names sit below the lip, outside its overlap band entirely --
  // "cover text sits clear of the lip" (WS1 point 1).
  const names = el('div','store-ledge-names');
  picks.forEach(pick => names.appendChild(el('span','store-ledge-name', pick.title)));
  ledge.appendChild(names);
  return ledge;
}

// Wall & Labels follow-up (Ken, 2026-11-08): replaces the wall cubby (a
// continuous wood shelf with posts/rails/stands, the shelf unit's own
// construction) with individual wood-framed squares, one per pressing or
// metal found -- each its own small picture frame rather than a shared
// shelf, so there's no shelf/rail reading as "shelving sitting over" the
// disc. For the last three pressings or metals found (S.collection +
// history/achievements.js's achievementsList(), merged and sorted by
// their own date, newest first). Fewer than three found just leaves the
// remaining frames out, per docs/24_QUIET_COUNTS.md.
// Pure: the last three pressings/metals found, newest first — extracted
// so UN14 (docs/36_UNIFORMITY.md) can test the 0/1/2/3/5-found section
// count without a DOM.
export function wallFoundList(collection, achievements){
  return [
    ...Object.values(collection).map(rec => ({rec, kind:'pressing', date: rec.discoveredAt})),
    ...achievements.map(rec => ({rec, kind:'metal', date: rec.updatedAt})),
  ].sort((a, b) => b.date - a.date).slice(0, 3);
}

// Pure: the mono readout under a wall frame. UN14 point 3 — no phase
// saved (older finds) means just the date, never a leading "· " dangling
// off a blank phase word.
export function wallFoundCaption(kind, phase, date){
  if(kind === 'metal') return 'METAL · ' + wallMonth(date);
  const phaseLabel = PHASE_CAPS[phase];
  return phaseLabel ? phaseLabel + ' · ' + wallDayMonth(date) : wallDayMonth(date);
}

function storeWallCubby(){
  const found = wallFoundList(S.collection, achievementsList());
  if(!found.length) return null;

  const wrap = el('div','store-wall-frames-wrap');
  const headRow = el('div','store-wall-frames-head');
  headRow.appendChild(el('span','store-wall-caption','pressings, found while listening'));
  const link = el('button','store-wall-all','All found ›');
  link.addEventListener('click', ()=>{ S.profileView.screen = 'records'; S.profileView.recordsFilter = 'all'; renderProfile(); });
  headRow.appendChild(link);
  wrap.appendChild(headRow);

  const frames = el('div','store-wall-frames');
  const captions = el('div','store-wall-frames-captions');
  found.forEach(({rec, kind, date}) => {
    const frame = el('div','store-pressing-frame');
    const mat = el('div','store-pressing-frame-mat');
    const disc = el('div','store-pressing-disc');
    const discBg = kind === 'metal' ? metalDisc(rec) : pressingDisc(rec);
    disc.style.background = discBg;
    disc.setAttribute('aria-label', rec.name);
    // WS2: zoetropes keep their own artwork (variantBackground()'s only
    // `url(...)` case, record-art/tiers.js) -- no label on top of it.
    if(!discBg.includes('url(')) disc.appendChild(el('span','paper-label-sm'));
    mat.appendChild(disc);
    frame.appendChild(mat);
    frames.appendChild(frame);

    const cap = el('div','store-pressing-caption');
    cap.appendChild(el('b', null, rec.name));
    cap.appendChild(el('span','store-found-mono', wallFoundCaption(kind, rec.phase, date)));
    captions.appendChild(cap);
  });
  wrap.appendChild(frames);
  wrap.appendChild(captions);
  return wrap;
}

// ST2 (docs/32_SHELF_AND_TURNTABLES.md point 2): "this absorbs plan 30's
// 'On the turntable' row: one caption line above the shelves remains."
// Replaces GS8 point 3's storeTurntableSection() (removed) — follows the
// player (current(), src/state.js) when something's loaded this session,
// falling back to the last album ever spun (mostRecentlySpunAlbum(),
// same source storeLastSpunRow() used) so the turntable/sleeve-stand/
// caption still show something after a fresh launch. null fields mean
// "nothing on" (ST2 point 3: empty library, or nothing ever played) —
// renderShelfUnit() reads hasRecord/sleeveArt as the "stand empty, no
// stand" signal.
function shelfUnitTurntableInfo(){
  const t = current();
  if(t){
    const playing = !!S.playing;
    const album = t.tags.album || '';
    const title = t.tags.title || '';
    // ST5 (docs/32_SHELF_AND_TURNTABLES.md point 2): the exact same live
    // rate/format the main player's own platter already tracks (player/
    // clock.js's currentBaseRpm()/S.platterRate — already bakes in
    // Sundown's Slowed-vs-Keep-pitch rule), just read once per render
    // rather than every frame, since the shelf's own spin is a plain CSS
    // animation (ST5 point 5's "one CSS animation"), not a second rAF loop.
    const rpm = (S.recordFormat && S.recordFormat.speed) || RPM_33;
    const turnSeconds = 60 / (rpm * (S.platterRate || 1));
    // ST5 follow-up (Ken, 2026-11-07): the shelf turntable's own record
    // must show the album's actual pressing -- the same shared
    // discLook().bg every other disc-showing surface (the full player's
    // #disc, the gatefold's sleeve-pocket disc, the gatefold-to-player
    // hand-off ghost) already paints with, not a plain album-art image.
    const discBg = pressingBgFor(t);
    return {
      hasRecord: true, art: discBg, spinning: playing, turnSeconds,
      sleeveArt: t.art, sleeveName: album,
      caption: playing ? 'Now spinning: ' + album + ' · ' + title : 'On the turntable: ' + album + ' · paused',
    };
  }
  const spun = mostRecentlySpunAlbum();
  const none = {hasRecord: false, art: null, spinning: false, sleeveArt: null, sleeveName: null, caption: null};
  if(!spun) return none;
  const adapter = MizikiSocial.mizikiAdapter({S, DB, albumKey, trackTier, albumMetalFor});
  const info = adapter.albumInfo(spun.albumId);
  if(!info) return none;
  const art = localAlbumArt(info.title, info.artist);
  // Same pressing-look resolution as the playing branch above, off
  // whatever track of this album is still in the library (it may well be
  // a different physical file than whatever was last spun, but it's the
  // same pressing either way -- albumPressingTrack()'s own "one pressing
  // per album" rule, record-art/tiers.js).
  const repTrack = albumPressingTrack(spun.albumId);
  const discBg = repTrack ? pressingBgFor(repTrack) : null;
  return {
    hasRecord: true, art: discBg, spinning: false, sleeveArt: art, sleeveName: info.title,
    caption: 'On the turntable: ' + info.title + ' · paused',
  };
}

// discLook() can throw for a track missing fields a never-played, oddly-
// tagged file might lack (format/tier lookups it assumes are already
// resolved) -- caught the same defensive way record-art/peek.js's own
// peekBackgroundFor() already guards the identical call, so a resolution
// miss falls back to no background (renderTurntable()'s plain generic
// disc) rather than breaking the whole shelf unit's render.
function pressingBgFor(t){
  try{ return discLook(t).bg; }catch(_e){ return null; }
}

// ST2 point 2-4: the one rendered shelf unit, replacing both
// storeTurntableSection() and storeShelvesSection()'s own maxCubes preview
// for this file's two profile-home call sites (friend-store.js's own
// unbounded "browse all" crate grid keeps calling storeShelvesSection()
// below, untouched). `pinIds` is the same pin-rank-ordered id list
// storeWallSection() takes -- only ranks 4-5 (pinIds[3]/[4]) draw face-out
// here, same as storeShelvesSection() always did.
function storeShelfUnitSection(items, pinIds, onTapAlbum){
  const section = el('div','store-section store-shelf-unit-section');
  const head = el('div','store-shelf-head');
  head.appendChild(el('h2', 'p-label', 'The shelves'));
  const faceOutIds = (pinIds || []).slice(3, 5);
  const truncated = shelfUnitCubes(items, faceOutIds).length > SHELF_UNIT_CUBES;
  if(truncated){
    const browseAll = el('button','store-chev-link','Browse all ›');
    browseAll.addEventListener('click', ()=> openRecords('all'));
    head.appendChild(browseAll);
  }
  section.appendChild(head);
  const info = shelfUnitTurntableInfo();
  if(!items.length && !info.hasRecord){
    section.appendChild(el('p','store-loading','Nothing in the crate yet.'));
    return section;
  }
  if(info.caption) section.appendChild(el('span','store-shelf-caption', info.caption));
  section.appendChild(renderShelfUnit({
    items, faceOutIds, onTapAlbum: id => shelfAlbumTap(id, onTapAlbum),
    model: displayTurntable(S.turntable, S.turntablesFound, hasDeluxe()),
    turntableInfo: {hasRecord: info.hasRecord, art: info.art, spinning: info.spinning, turnSeconds: info.turnSeconds},
    sleeveArt: info.sleeveArt, sleeveName: info.sleeveName,
    finish: displayShelfFinish(S.shelfFinish, hasDeluxe()),
  }));
  return section;
}

// ST3 (docs/32_SHELF_AND_TURNTABLES.md): the Shelf finish sheet's own live
// preview (src/profile/shelf-finish-sheet.js) wants the same real crate/
// turntable data the home unit renders, just with its own finish/model
// overrides -- exported rather than duplicated so both stay in sync with
// whatever the crate actually holds. Always reads the local crate (not a
// friend's), since the sheet only ever edits this account's own finish.
export function shelfUnitRenderProps(){
  const items = shelfItemsFromCrate(crateFlatAlbumOrder(S.crateGroup));
  const faceOutIds = localStaffPicks().map(p => p.release_id).slice(3, 5);
  const info = shelfUnitTurntableInfo();
  return {
    items, faceOutIds,
    turntableInfo: {hasRecord: info.hasRecord, art: info.art, spinning: info.spinning, turnSeconds: info.turnSeconds},
    sleeveArt: info.sleeveArt, sleeveName: info.sleeveName,
  };
}

// GS8 point 4-5: "a cube-shelving view of your crate (2 columns), records
// spines-out by the crate's current order; pins 4-5 face-out... A friend's
// crate: same layout." The one shared shelf component, reused by both
// this file's own profile (fed crateFlatAlbumOrder()'s local, idx-based
// items) and a friend's (social/screens/friend-store.js's own
// MizikiSocial.crate() rows, which carry no idx into S.tracks at all) --
// so `items` is each caller's own small, already-resolved {id, name,
// artist, art} list, never either source's own richer shape. `pinIds` is
// the same pin-rank-ordered id list storeWallSection() takes (only ranks
// 4-5, i.e. pinIds[3]/[4], are drawn face-out here -- 1-3 already hang on
// the wall). `onTapAlbum`, when given, replaces the default "open the
// library crate at that spot" tap with the caller's own (a friend's shelf
// opens the record sheet instead).
// GS11 (docs/30_GROOVES_AND_SHELF.md, Ken: "the shelves should replace the
// records menu on the profile... limited to 6 shelves and when a user
// clicks browse all it then shows all the records they own"): `opts.
// maxCubes`, when given, caps how many cube rows this draws and appends a
// "Browse all" button calling `opts.onBrowseAll` once there's more than
// that to show -- used by this file's own two profile-home call sites
// only; friend-store.js's call (no opts) is untouched, since it already
// has its own paged "Browse all N records" button outside this function.
const SHELF_CUBE_CAPACITY = 10, SHELF_FACE_WIDTH = 3;
export const SHELF_PREVIEW_CUBES = 6;
export function storeShelvesSection(items, pinIds, onTapAlbum, opts = {}){
  const faceOut = new Set((pinIds || []).slice(3, 5));
  const section = el('div','store-section store-shelves');
  const head = el('div','store-section-head');
  head.appendChild(el('h2', 'p-label', 'The shelves'));
  section.appendChild(head);
  if(!items.length){
    section.appendChild(el('p','store-loading','Nothing in the crate yet.'));
    return section;
  }
  const cubes = [];
  let cube = el('div','cube'), used = 0;
  const pushCube = ()=>{ cubes.push(cube); cube = el('div','cube'); used = 0; };
  items.forEach(item => {
    const isFace = faceOut.has(item.id);
    const width = isFace ? SHELF_FACE_WIDTH : 1;
    if(used && used + width > SHELF_CUBE_CAPACITY) pushCube();
    cube.appendChild(isFace ? shelfFaceCover(item, onTapAlbum, opts.stickers) : shelfSpine(item, onTapAlbum));
    used += width;
  });
  if(used) pushCube();
  const truncated = opts.maxCubes && cubes.length > opts.maxCubes;
  const shown = truncated ? cubes.slice(0, opts.maxCubes) : cubes;
  const grid = el('div','shelf-grid');
  shown.forEach(c => grid.appendChild(c));
  if(!truncated && grid.childElementCount % 2 === 1){
    const empty = el('div','cube cube-empty');
    empty.appendChild(el('span','cube-empty-label','room to grow'));
    grid.appendChild(empty);
  }
  section.appendChild(grid);
  if(truncated && opts.onBrowseAll){
    const browseAll = el('button','cta ghost store-shelves-browse-all','Browse all');
    browseAll.addEventListener('click', opts.onBrowseAll);
    section.appendChild(browseAll);
  }
  return section;
}

function shelfAlbumTap(albumId, onTapAlbum){
  if(onTapAlbum) return onTapAlbum(albumId);
  S.view.mode = 'crate'; S.view.group = null; S.view.artistAlbum = null; S.view.playlist = null;
  S.view.person = null; S.view.crateLooseIdx = null; S.view.picking = false;
  S.crate.pendingJumpAlbum = albumId;
  showRoute('library');
  renderTracks();
}

// GS11 (Ken: "cover art should be rendered for the shelves as well"): a
// spine is only 10px wide (18-storefront.css's own .sp), too narrow for
// its cover to read as a picture, but cropped-and-stretched real art still
// reads as that record's own color rather than an arbitrary per-id hash --
// falls back to the old hashed label color only for an item with no art at
// all (a friend's crate row this device has no local file for).
function shelfSpine(item, onTapAlbum){
  const sp = el('button','sp');
  // Quoted, not a bare url(...) -- a real track's art is always a simple
  // blob: URL with nothing CSS would choke on, but an unquoted value still
  // breaks (silently, same failure shape as grooves.js's own CSS-stops
  // bug, PR #346) the moment any art URL ever contains a "(" or ")".
  if(item.art) sp.style.backgroundImage = 'url("' + item.art + '")';
  else sp.style.background = MizikiSocial.labelColor(item.id);
  sp.setAttribute('aria-label', item.name + (item.artist ? ', ' + item.artist : ''));
  sp.addEventListener('click', ()=> shelfAlbumTap(item.id, onTapAlbum));
  return sp;
}

// CC3 (docs/34_CARE_AND_CONTROL.md): `stickers` -- a {releaseId: owners}
// map -- only ever passed by friend-store.js's own "Browse all" grid
// (storeShelvesSection's one other caller, the local profile home, never
// has one: every item there is already owned). Same face-only reasoning
// as shelf-unit.js's own cubeFace().
function shelfFaceCover(item, onTapAlbum, stickers){
  const face = el('button','shelf-face');
  if(item.art){ const im = document.createElement('img'); im.src = item.art; im.alt = ''; face.appendChild(im); }
  face.setAttribute('aria-label', item.name + (item.artist ? ', ' + item.artist : ''));
  face.addEventListener('click', ()=> shelfAlbumTap(item.id, onTapAlbum));
  if(stickers){
    const badge = stickerBadge(item.id, stickers[item.id]);
    if(badge) face.appendChild(badge);
  }
  return face;
}

// GS8 point 4: crateFlatAlbumOrder()'s own item shape (albumId/idx/album/
// artist, see crate/model.js) resolved down to storeShelvesSection()'s
// generic {id, name, artist, art} -- kept here rather than inside
// storeShelvesSection so a friend's shelf (which resolves its own items
// from social/screens/friend-store.js's MizikiSocial.crate() rows instead)
// never has to know this file's crate-model-specific shape at all.
// UN15 point 1: crateFlatAlbumOrder() walks the crate's sections in a row
// (A-Z, New arrivals, In rotation), so an album that belongs to more than
// one section -- any album newly added, or any that's currently spinning
// -- appears once per section. dedupeCrateItems() (shelf-unit.js) drops the
// repeats by albumId, keeping the first appearance, so the shelf draws one
// spine per album rather than one per section membership -- split out
// there, pure, rather than inline here, so it's unit-testable without this
// file's own DOM/state-heavy import web.
function shelfItemsFromCrate(crateItems){
  return dedupeCrateItems(crateItems).map(it => {
    // UN15 point 2's spine-height-by-format reuses the same format
    // resolution the launch ceremony and the per-album edit sheet already
    // call -- albumFormatFor() takes the album's own override
    // (S.albumFormat), same as every other caller of it.
    const override = (S.albumFormat && S.albumFormat[it.albumId]) || 'auto';
    const format = albumFormatFor(it.idx, S.tracks, override);
    return {id: it.albumId, name: it.album, artist: it.artist,
      art: thumbURL['album:' + it.albumId] || (S.tracks[it.idx[0]] || {}).art || null,
      format: format ? format.size : null};
  });
}

function storeDiggingSection(full, host){
  // D7: the one modifier class this step adds, since store-section alone
  // (shared with the wall/shelves sections) gives
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
  updateHeaderPlate(full.profile.handle);
  const header = el('div','store-header');
  header.appendChild(storeAvatarButton());
  // FS7 (docs/25_FROM_SCRATCH.md point 3): "display name Archivo 20/600,
  // then your own short line (bio/name field) in --muted — nothing when
  // it's empty." The @handle moves out of this primary spot -- the plate
  // above (now in the header -- UN12) already shows "{handle}'s crate"
  // (GS7), so repeating it here would be the second big heading this
  // redesign's "one in one out" rule keeps dropping; it gets the same
  // small "@handle" secondary line the local-only state's own username
  // now does, right under the name (UN12 point 3).
  const idBox = el('div','store-id');
  idBox.appendChild(el('div','store-name', full.profile.display_name || full.profile.handle));
  const handleRow = el('div','store-username-row');
  handleRow.appendChild(el('span','store-username-at','@'));
  handleRow.appendChild(el('span', null, full.profile.handle));
  idBox.appendChild(handleRow);
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
  const visRow = el('div','store-vis-row');
  const visChip = el('button','store-vis-chip', STORE_VIS_LABEL[full.profile.visibility] || 'Friends only');
  visChip.setAttribute('aria-label','Change who can see your crate — currently ' + (STORE_VIS_LABEL[full.profile.visibility] || 'Friends only'));
  visChip.addEventListener('click', ()=> cycleStoreVisibility(full.profile, host));
  visRow.appendChild(visChip);
  host.appendChild(visRow);
  if(requests && requests.length) host.appendChild(storeRequestsCard(requests, ()=> loadAndRenderStorefront(host)));
  host.appendChild(storeWallSection(full.staffPicks));
  host.appendChild(storeShelfUnitSection(shelfItemsFromCrate(crateFlatAlbumOrder(S.crateGroup)), full.staffPicks.map(p => p.release_id), null));
  host.appendChild(storeListeningRow());
  if(full.diggingShared) host.appendChild(storeDiggingSection(full, host));
  host.appendChild(storePressingsTeaserRow());
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
