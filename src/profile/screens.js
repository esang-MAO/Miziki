import { S, touchBackupField } from '../state.js';
import { el, $ } from '../util/dom.js';
import { meta, profile } from '../storage/repo.js';
import { topAlbums, topTracks, achievementsList, crateFilled, collectionGroups } from '../history/achievements.js';
import { metalBadge, collectionBadge } from './badges.js';
import { renderStorefrontSection } from './storefront.js';
import { renderSocialSettingsScreen } from './settings.js';
import { renderPrivacyScreen, wirePrivacyLink } from './privacy.js';
import { openShareSheet } from '../share/sheet.js';
import { refreshLibraryTools } from '../shell/header.js';

/* ================= profile tab =================
   Everything here reads from existing counters — session records, track
   play counts, variant assignments. No new tracking, per the spec's build
   notes. Achievements and Collection do persist lightweight pointer+tier
   records, since "has this album reached Gold" can't assume the source
   track is still in the library to read a display name/cover off of —
   albumDisplay is the one place that snapshot lives, shared by both.
   Timestamps double as the recency tie-break and, per §11, keep every
   record ready for a future account system: stable ids, no device-keyed
   identifiers, no absolute paths. persistAlbumLastPlayed moved to
   src/history/sessions.js (step 5c) — its only writer, sessionTrackComplete,
   lives there. */
export async function persistTrackLastPlayed(){ await meta.put('trackLastPlayed', S.trackLastPlayed); }

/* ================= profile tab rendering =================
   A stat sheet, not the app's center of gravity. Earned/discovered items
   only — no locked slots, no progress bars, no "X more until Y", no
   general listening stats. See PROFILE spec §1. */
export async function persistProfile(){
  await profile.put({k:'me', name:S.profile.name, username:S.profile.username, pictureBlob:S.profile.artBlob || undefined});
  touchBackupField('profileName');
}

// "John Smith" -> "John S."; a single word (or nothing) passes through as-is
export function formatDisplayName(name){
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '';
  if(parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase() + '.';
}

export const fmtCount = (n, one, many) => n + ' ' + (n === 1 ? one : many);

export function topTile(label, art, title, subtitle, emptyText, onTap){
  const b = el('button','profile-top-tile');
  const cover = el('span','profile-top-cover');
  if(art){ const im = document.createElement('img'); im.src = art; im.alt = ''; cover.appendChild(im); }
  else cover.appendChild(el('span','profile-empty-cover', title ? '◍' : '—'));
  b.appendChild(cover);
  if(title){
    b.appendChild(el('b', null, title));
    if(subtitle) b.appendChild(el('em', null, subtitle));
  } else {
    b.appendChild(el('b', null, label));
    b.appendChild(el('em', null, emptyText));
  }
  b.addEventListener('click', onTap);
  return b;
}

export function renderProfile(){
  const crumb = $('#profileCrumb');
  const screen = S.profileView.screen;
  const labels = {topAlbums:'Top Albums', topSongs:'Top Songs', collection:'Collection', socialSettings:'Account', privacy:'Privacy'};
  crumb.style.display = screen === 'home' ? 'none' : 'flex';
  if(screen !== 'home'){
    crumb.innerHTML = '';
    const back = el('button','crumb-back','‹ Back');
    back.addEventListener('click', ()=>{ S.profileView.screen = 'home'; renderProfile(); });
    crumb.appendChild(back);
    crumb.appendChild(el('span','crumb-label', labels[screen] || ''));
  }
  const body = $('#profileBody'); body.innerHTML = '';
  if(screen === 'topAlbums') renderTopAlbumsScreen(body);
  else if(screen === 'topSongs') renderTopSongsScreen(body);
  else if(screen === 'collection') renderCollectionScreen(body);
  else if(screen === 'socialSettings') renderSocialSettingsScreen(body);
  else if(screen === 'privacy') renderPrivacyScreen(body);
  else renderProfileHome(body);
  refreshLibraryTools();
}

function renderProfileHome(body){
  renderStorefrontSection(body);
  // reachable from Profile regardless of sign-in state — the privacy
  // screen itself shows the calm "sign in to use this" row for the
  // social-only sections when signed out (step 06, B3)
  wirePrivacyLink(body, renderProfile);
}

// Top Album/Top Song, Achievements, Collection and Share don't exist
// anywhere else, so every storefront state (local-only, open-store card,
// signed-in) appends this directly below its own header+stats rather than
// repeating a whole second profile header — the avatar/name editor only
// needs to appear once, inline in whichever header is actually showing.
// includeShareCardEditor is true wherever the storefront's own header isn't
// already editing S.profile.art/.name itself (i.e. everywhere except the
// local-only storefront, which edits them directly as its avatar/name).
export function renderProfileExtras(includeShareCardEditor){
  const wrap = el('div','profile-extras');

  if(includeShareCardEditor){
    const header = el('div','profile-header');
    const picBtn = el('button','profile-pic'); picBtn.setAttribute('aria-label','Change share-card picture');
    if(S.profile.art) picBtn.classList.add('has-art');
    if(S.profile.art){ const im = document.createElement('img'); im.src = S.profile.art; im.alt = ''; picBtn.appendChild(im); }
    picBtn.appendChild(el('span','profile-pic-mark','+'));
    picBtn.addEventListener('click', ()=> $('#profilePicFile').click());
    header.appendChild(picBtn);
    const nameIn = el('input','profile-name-input');
    nameIn.type = 'text'; nameIn.placeholder = 'Your name'; nameIn.value = S.profile.name || '';
    nameIn.addEventListener('change', ()=>{ S.profile.name = nameIn.value.trim(); persistProfile(); });
    header.appendChild(nameIn);
    wrap.appendChild(header);
    wrap.appendChild(el('p','note','Shown on shared cards (Now Playing, My Crate) — separate from your crate.'));
  }

  const row = el('div','profile-top-row');
  const albums = topAlbums(1), tracks = topTracks(1);
  row.appendChild(topTile('Top Album', albums[0] ? albums[0].display.art : null,
    albums[0] ? albums[0].display.name : null, albums[0] ? albums[0].display.artist : null,
    'nothing in the crate yet', ()=>{ S.profileView.screen = 'topAlbums'; renderProfile(); }));
  row.appendChild(topTile('Top Song', tracks[0] ? tracks[0].art : null,
    tracks[0] ? tracks[0].title : null, tracks[0] ? tracks[0].artist : null,
    'nothing in the sleeve yet', ()=>{ S.profileView.screen = 'topSongs'; renderProfile(); }));
  wrap.appendChild(row);

  const achSection = el('div','profile-section');
  const achHead = el('div','profile-section-head'); achHead.appendChild(el('span', null, 'Achievements'));
  achSection.appendChild(achHead);
  const achList = achievementsList();
  if(achList.length){
    const grid = el('div','profile-grid');
    achList.forEach(rec => grid.appendChild(metalBadge(rec)));
    achSection.appendChild(grid);
  } else {
    const empty = el('div','profile-empty'); empty.appendChild(el('p', null, 'Nothing earned yet.'));
    achSection.appendChild(empty);
  }
  wrap.appendChild(achSection);

  const collList = Object.values(S.collection);
  const collSection = el('button','profile-section');
  const collHead = el('div','profile-section-head');
  collHead.appendChild(el('span', null, 'Collection'));
  collHead.appendChild(el('span','g-chev','›'));
  collSection.appendChild(collHead);
  if(collList.length){
    const grid = el('div','profile-grid mini');
    collList.slice(0, 6).forEach(rec => grid.appendChild(collectionBadge(rec)));
    collSection.appendChild(grid);
  } else {
    const empty = el('div','profile-empty'); empty.appendChild(el('p', null, 'Nothing in the collection yet.'));
    collSection.appendChild(empty);
  }
  collSection.addEventListener('click', ()=>{ S.profileView.screen = 'collection'; renderProfile(); });
  wrap.appendChild(collSection);

  const shareBtn = el('button','cta ghost profile-share','Share');
  shareBtn.classList.toggle('active', crateFilled());
  shareBtn.addEventListener('click', openShareSheet);
  wrap.appendChild(shareBtn);

  return wrap;
}

function renderTopAlbumsScreen(body){
  const list = topAlbums(5);
  if(!list.length){
    const empty = el('div','profile-empty'); empty.appendChild(el('p', null, 'Nothing in the crate yet.'));
    body.appendChild(empty); return;
  }
  const ul = el('ul','tracklist');
  list.forEach((a, pos) => {
    const li = el('li');
    li.appendChild(el('span','t-idx', String(pos + 1).padStart(2,'0')));
    if(a.display.art){ const im = el('img','t-art'); im.src = a.display.art; im.alt=''; li.appendChild(im); }
    else li.appendChild(el('span','t-art'));
    const name = el('span','t-name');
    name.appendChild(el('b', null, a.display.name));
    name.appendChild(el('em', null, a.display.artist + ' · ' + fmtCount(a.count, 'session', 'sessions')));
    li.appendChild(name);
    ul.appendChild(li);
  });
  body.appendChild(ul);
}

function renderTopSongsScreen(body){
  const list = topTracks(5);
  if(!list.length){
    const empty = el('div','profile-empty'); empty.appendChild(el('p', null, 'Nothing in the sleeve yet.'));
    body.appendChild(empty); return;
  }
  const ul = el('ul','tracklist');
  list.forEach((t, pos) => {
    const li = el('li');
    li.appendChild(el('span','t-idx', String(pos + 1).padStart(2,'0')));
    if(t.art){ const im = el('img','t-art'); im.src = t.art; im.alt=''; li.appendChild(im); }
    else li.appendChild(el('span','t-art'));
    const name = el('span','t-name');
    name.appendChild(el('b', null, t.title));
    name.appendChild(el('em', null, t.artist + ' · ' + fmtCount(t.count, 'play', 'plays')));
    li.appendChild(name);
    ul.appendChild(li);
  });
  body.appendChild(ul);
}

function renderCollectionScreen(body){
  const groups = collectionGroups();
  const names = {solid:'Colors', split:'Splits', splatter:'Splatter', swirl:'Swirls'};
  const any = Object.values(groups).some(g => g.length);
  if(!any){
    const empty = el('div','profile-empty'); empty.appendChild(el('p', null, 'Your pressings will show up here once you’ve played an album through.'));
    body.appendChild(empty); return;
  }
  Object.keys(names).forEach(key => {
    const items = groups[key];
    if(!items || !items.length) return;
    const section = el('div','collection-group');
    section.appendChild(el('div','collection-group-name', names[key]));
    const grid = el('div','profile-grid');
    items.forEach(rec => grid.appendChild(collectionBadge(rec)));
    section.appendChild(grid);
    body.appendChild(section);
  });
}
