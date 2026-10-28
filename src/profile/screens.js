import { S, touchBackupField } from '../state.js';
import { el, $ } from '../util/dom.js';
import { meta, profile } from '../storage/repo.js';
import { topAlbums, topTracks, achievementsList, crateFilled } from '../history/achievements.js';
import { metalBadge } from './badges.js';
import { renderStorefrontSection } from './storefront.js';
// The Records screen (All / Pressings) — the Collection screen and the
// pressing chart moved there; see records.js's own header.
import { renderRecordsScreen } from './records.js';
import { renderRhythmCard } from './rhythm-card.js';
import { renderSocialSettingsScreen } from './settings.js';
import { renderPrivacyScreen, wirePrivacyLink } from './privacy.js';
import { renderPrivacyPolicyScreen, renderTermsScreen, legalLinksRow } from './legal.js';
import { refreshLibraryTools } from '../shell/header.js';
import { queueAvatarUpload } from '../sync/backup.js';
import { setTheme, isDaylightPhase } from '../ui/theme.js';
import { renderSlipmatRow } from './slipmat-editor.js';
import { nowClock } from '../sundown/solar.js';
import { phaseAt } from '../sundown/arc.js';
import { openSundownSheet } from '../shell/sundown-sheet.js';
import { openEqSheet, eqStateLabel } from '../player/eq-sheet.js';
import { RHYTHM_MIN_PLAYS, RHYTHM_WINDOW_DAYS, computeRhythmShares, windowedPhaseCounts, rhythmVerdictLabel } from '../sundown/rhythm.js';

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
  // step 07, B4: the profile picture doubles as the account's public
  // avatar once signed in — re-encode/hash is idempotent and cheap, so
  // this runs on every save (including a name-only change) rather than
  // tracking separately whether the picture itself actually changed;
  // the real network upload is deduped by hash in queueAvatarUpload's
  // own flush cycle regardless.
  if(S.profile.artBlob) queueAvatarUpload(S.profile.artBlob);
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

// NV4 (docs/11_SMOOTH_NAVIGATION.md): "build once; on later visits, update
// only the parts whose data changed" for the Profile home screen.
// profileHomeHosts persists the storefront's own host element across
// refreshes, so a refresh (pull-to-refresh, or any other "just redraw with
// current data" call) never wipes the whole #profileBody — only a genuine
// screen change does (including entering the home screen from somewhere
// else, since the old host is detached once the body is wiped for a
// different screen anyway). Navigating to a sub-screen (Listening,
// Settings, …) and back still does a full rebuild of the home screen
// itself the first time it's entered again — this only changes what
// happens on a *refresh while already looking at it*, per the plan's own
// "Profile" bullet; avoiding re-creating unchanged <img> elements inside
// the storefront's own avatar (its header always rebuilds internally once
// called) is a deeper change to src/profile/storefront.js itself,
// deliberately left out of this PR's scope — see its PR description.
// RF11 (docs/12_REFINE.md, "Profile is your crate") moved the rhythm card
// off this home screen onto the new Listening sub-screen alongside the
// rest of renderListeningScreen()'s own content, so there's only the one
// host to track here now.
let profileHomeHosts = null;
let lastProfileScreen = null;

export function renderProfile(opts = {}){
  const crumb = $('#profileCrumb');
  const screen = S.profileView.screen;
  const labels = {listening:'Listening', topAlbums:'Top Albums', topSongs:'Top Songs', records:'Records', collection:'Records', socialSettings:'Account', privacy:'Privacy',
    privacyPolicy:'Privacy Policy', termsOfUse:'Terms of use', settings:'Settings'};
  crumb.style.display = screen === 'home' ? 'none' : 'flex';
  if(screen !== 'home'){
    crumb.innerHTML = '';
    const back = el('button','crumb-back','‹ Back');
    back.addEventListener('click', ()=>{ S.profileView.screen = 'home'; renderProfile(); });
    crumb.appendChild(back);
    crumb.appendChild(el('span','crumb-label', labels[screen] || ''));
  }
  const body = $('#profileBody');
  parkPlaybackSettings();
  parkLibraryTools();
  const refreshingHome = !!opts.refresh && screen === 'home' && lastProfileScreen === 'home';
  if(!refreshingHome) body.innerHTML = '';
  if(screen === 'listening') renderListeningScreen(body);
  else if(screen === 'topAlbums') renderTopAlbumsScreen(body);
  else if(screen === 'topSongs') renderTopSongsScreen(body);
  else if(screen === 'records') renderRecordsScreen(body);
  // the old Collection screen's route now opens Records on its Pressings tab
  else if(screen === 'collection'){ S.profileView.screen = 'records'; S.profileView.recordsFilter = 'pressings'; renderRecordsScreen(body); }
  else if(screen === 'settings') renderAppSettingsScreen(body);
  else if(screen === 'socialSettings'){ renderSocialSettingsScreen(body); body.appendChild(legalLinksRow(renderProfile)); }
  else if(screen === 'privacy'){ renderPrivacyScreen(body); body.appendChild(legalLinksRow(renderProfile)); }
  else if(screen === 'privacyPolicy') renderPrivacyPolicyScreen(body);
  else if(screen === 'termsOfUse') renderTermsScreen(body);
  else renderProfileHome(body, refreshingHome);
  lastProfileScreen = screen;
  refreshLibraryTools();
}

// NV4: refreshes the Profile tab's own home screen in place (re-fetches the
// storefront/stats), without rebuilding #profileBody — a no-op when a
// different screen (Listening, Settings, …) is currently showing, since
// there's nothing "home" to refresh there. Never starts a restore, merge,
// or anything that writes library data — renderStorefrontSection() only
// ever reads from S and re-fetches the signed-in storefront's own
// already-read-only profile data.
export function refreshProfileHome(){
  if(S.profileView.screen !== 'home') return;
  renderProfile({ refresh: true });
}

function renderProfileHome(body, refresh){
  if(!refresh || !profileHomeHosts){
    const storefrontHost = el('div', null);
    body.appendChild(storefrontHost);
    profileHomeHosts = { storefrontHost };
    // reachable from Profile regardless of sign-in state — the privacy
    // screen itself shows the calm "sign in to use this" row for the
    // social-only sections when signed out (step 06, B3). Static across
    // refreshes, so only built the first time, like the host above.
    wirePrivacyLink(body, renderProfile);
  }
  profileHomeHosts.storefrontHost.innerHTML = '';
  renderStorefrontSection(profileHomeHosts.storefrontHost);
}

// DA3 (docs/DAY_ARC.md, artboard ProfileSettings): the Appearance control
// moved off the old Character tab (now gone — its content lives in
// Sundown's own Sound view, src/wiring/sundown.js) into this new screen,
// reached via the Settings button renderStorefrontSection() now adds at
// the top of every profile-home state — see storefront.js's own comment
// for why that needed to move there rather than staying only on the
// signed-in storefront's own gear button. RF8 (docs/12_REFINE.md) removed
// the desktop sidebar's own second copy of this control (D7,
// #sidebarAppearance) — this screen is its one home now, phone and
// desktop alike. This screen's own buttons are built fresh on every
// render, so each gets its own click listener right here rather than
// relying on wireCharacter()'s boot-time querySelectorAll pass; setTheme()
// still syncs aria-pressed on every [data-theme-choice] button in the
// document whenever any one of them is actually clicked.
//
// DA4 (docs/DAY_ARC.md, docs/design/day-arc/README.md): Nychthemeron is
// the fourth choice — the mockup's own 2×2 grid (settings-appearance's
// own CSS, src/styles/17-profile.css) gives the long word room at this
// screen's 320–390px width. Only this one button gets an aria-label — the
// other three's own visible text already says everything their
// aria-pressed state needs to convey; Nychthemeron's doesn't
// ("Nychthemeron" alone says nothing about what it does).
function nychthemeronSwitchCaption(){
  if(!S.sun.ok) return 'Resolves once your location is known.';
  const fmt = d => d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
  // PR7 (DAY_ARC_BRIEF.md): reads arc.js's phaseAt() (via theme.js's own
  // isDaylightPhase()), the same day model Nychthemeron's own
  // light/dark resolution now uses (src/ui/theme.js's effectiveTheme()),
  // in place of the old DA1-DA6 dayPosition()/currentDayPosition().
  // nowClock() folds S.previewMin in the same way every other Day Arc v2
  // readout does, so "Preview the day" moves this caption too.
  const now = nowClock();
  if(isDaylightPhase(phaseAt(now, S.sun))) return 'Turns dark at ' + fmt(S.sun.set) + ' today.';
  // "Today" only if today's own rise hasn't happened yet (the dawn phase,
  // or the night phase's own pre-dawn tail) — dayEvents()'s Julian-day
  // rounding always gives *today's* rise regardless of what hour `now`
  // is (DA1's own "continuity across midnight" trick), so right after
  // today's sunset S.sun.rise is already a past time, not an upcoming
  // one; saying so plainly beats showing a time that's already gone by.
  return now.getTime() < S.sun.rise.getTime()
    ? 'Turns light at ' + fmt(S.sun.rise) + ' today.'
    : 'Turns light at sunrise tomorrow.';
}
// The playback toggles (Scratch, Sleeve Pull, Launch intro, Background
// playback, Car Mode) are static markup in miziki.html so the listeners
// src/wiring/character.js attached at boot, and the ids bgUpdateUI()/
// applyPrefs() look up, survive every render. They sit hidden in
// #playbackSettingsStash; Settings borrows them, and renderProfile()
// hands them back before #profileBody is wiped.
function parkPlaybackSettings(){
  const panel = $('#playbackSettings'), stash = $('#playbackSettingsStash');
  if(panel && stash && panel.parentNode !== stash) stash.appendChild(panel);
}
// Ken, 2026-10-22: the same parking shape as parkPlaybackSettings() above,
// for #libTools — moved back out of #route-library (RF8's placement) into
// Profile › Settings. Parked here, hidden, in #libToolsStash
// (miziki.html); renderAppSettingsScreen() borrows it below.
function parkLibraryTools(){
  const panel = $('#libTools'), stash = $('#libToolsStash');
  if(panel && stash && panel.parentNode !== stash) stash.appendChild(panel);
}
function renderAppSettingsScreen(body){
  const appearance = el('div','settings-section');
  appearance.appendChild(el('div','settings-section-head', 'Appearance'));
  const seg = el('div','seg settings-appearance');
  [['auto','Auto'], ['light','Light'], ['dark','Dark'], ['nychthemeron','Nychthemeron']].forEach(([value, label]) => {
    const b = el('button', null, label);
    b.dataset.themeChoice = value;
    b.setAttribute('aria-pressed', String(S.theme === value));
    if(value === 'nychthemeron') b.setAttribute('aria-label', 'Nychthemeron: follows sunrise and sunset');
    b.addEventListener('click', () => setTheme(value));
    seg.appendChild(b);
  });
  appearance.appendChild(seg);
  // RF11 (docs/12_REFINE.md, point 5): "every helper is one line of
  // caption text; anything longer sits behind an (i)." Keeps the one
  // required sentence ("Turns dark at 8:10 PM today.") visible on its own
  // line; what Auto/Nychthemeron/Light/Dark each actually mean moves
  // behind the same native <details>/<summary> "(i)" disclosure pattern
  // src/wiring/character.js's own Sound-view Character card already
  // established (see src/styles/25-day-arc-v2.css's .sd-info).
  const note = el('p','note');
  note.appendChild(document.createTextNode(nychthemeronSwitchCaption() + ' '));
  const info = document.createElement('details'); info.className = 'sd-info';
  const summary = document.createElement('summary'); summary.textContent = '(i)';
  summary.setAttribute('aria-label','More about Appearance');
  info.appendChild(summary);
  info.appendChild(document.createTextNode(
    'Auto follows your device’s own Light/Dark setting, including live if it changes. Nychthemeron follows the whole day and night: light from sunrise to sunset, dark from sunset to sunrise. Choosing Light or Dark keeps that look regardless of the device.'));
  note.appendChild(info);
  appearance.appendChild(note);
  body.appendChild(appearance);

  // CEREMONY §6: the Slipmat row, part of Appearance. Filled once the saved
  // image (if any) has been read; placed now so the screen order is fixed.
  const slipmat = el('div','settings-slipmat');
  appearance.appendChild(slipmat);
  renderSlipmatRow(slipmat, () => { if(S.profileView.screen === 'settings') renderProfile(); });

  // Ken, 2026-10-22: Library tools (layout/sides/sealed/play-in-full-player,
  // find duplicates, clear history, test tone, forget library) moved here
  // from the Library route's own overflow menu (RF8's placement) — see
  // parkLibraryTools()/#libToolsStash above.
  const library = el('div','settings-section');
  library.appendChild(el('div','settings-section-head', 'Library'));
  const libPanel = $('#libTools');
  if(libPanel) library.appendChild(libPanel);
  body.appendChild(library);

  const playback = el('div','settings-section');
  playback.appendChild(el('div','settings-section-head', 'Playback & behavior'));
  const panel = $('#playbackSettings');
  if(panel) playback.appendChild(panel);
  // AU6 (docs/16_AUDIO.md §3): "an EQ row in Settings › Playback that
  // shows the current preset and state (CUSTOM · ON)" — a tappable row,
  // same shape as the Account & privacy rows below, just with a second
  // value span for that state text.
  const eqRow = el('button','settings-link-row');
  eqRow.appendChild(el('span', null, 'EQ'));
  const eqRowRight = el('span','settings-link-right');
  eqRowRight.appendChild(el('span','settings-link-value', eqStateLabel()));
  eqRowRight.appendChild(el('span','g-chev','›'));
  eqRow.appendChild(eqRowRight);
  eqRow.addEventListener('click', () => openEqSheet());
  playback.appendChild(eqRow);
  body.appendChild(playback);

  const links = el('div','settings-section');
  links.appendChild(el('div','settings-section-head', 'Account & privacy'));
  const row = (label, onTap) => {
    const b = el('button','settings-link-row');
    b.appendChild(el('span', null, label));
    b.appendChild(el('span','g-chev','›'));
    b.addEventListener('click', onTap);
    links.appendChild(b);
  };
  // RF26 (docs/12_REFINE.md): "Settings › Sundown, for when nothing has
  // played yet" — the one way in that doesn't depend on a record being on
  // the platter (the knob) or loaded in the mini-player (its sun button).
  row('Sundown', () => openSundownSheet());
  row('Account', () => { S.profileView.screen = 'socialSettings'; renderProfile(); });
  row('Privacy', () => { S.profileView.screen = 'privacy'; renderProfile(); });
  body.appendChild(links);
  body.appendChild(legalLinksRow(renderProfile));
}

// RF11 (docs/12_REFINE.md, "Profile is your crate"): formerly
// renderProfileExtras(), appended directly below the storefront's own
// identity header on every profile-home render. Point 1 ("a Listening
// sub-screen — top album/song, metals, collection, listening rhythm —
// linked from one row") moved it here instead, its own routed screen,
// reached from src/profile/storefront.js's storeListeningRow() in every
// storefront state (local-only, open-store card, signed-in) — the avatar/
// name identity itself stays exactly where it was, inline in whichever
// store-header is already showing.
function renderListeningScreen(body){
  const wrap = el('div','profile-extras');

  const albums = topAlbums(1), tracks = topTracks(1);
  const achList = achievementsList();
  const collList = Object.values(S.collection);
  // RF11 point 2: "a new profile with no stats shows one card... instead
  // of several 'nothing yet' boxes." Only for a genuinely fresh profile —
  // once anything exists, each section still shows its own ordinary state
  // (including its own, more specific empty copy, e.g. achievements earned
  // but no collection pressing yet).
  if(!albums.length && !tracks.length && !achList.length && !collList.length){
    const empty = el('div','profile-empty profile-empty-first');
    empty.appendChild(el('p', null, 'Play an album start to finish to earn your first metal.'));
    wrap.appendChild(empty);
    body.appendChild(wrap);
    return;
  }

  const row = el('div','profile-top-row');
  row.appendChild(topTile('Top Album', albums[0] ? albums[0].display.art : null,
    albums[0] ? albums[0].display.name : null, albums[0] ? albums[0].display.artist : null,
    'nothing in the crate yet', ()=>{ S.profileView.screen = 'topAlbums'; renderProfile(); }));
  row.appendChild(topTile('Top Song', tracks[0] ? tracks[0].art : null,
    tracks[0] ? tracks[0].title : null, tracks[0] ? tracks[0].artist : null,
    'nothing in the sleeve yet', ()=>{ S.profileView.screen = 'topSongs'; renderProfile(); }));
  wrap.appendChild(row);

  // DA5 (docs/DAY_ARC.md): local to this device, visible regardless of
  // sign-in state. The *sharing* switch is the social-only half (Privacy
  // screen, src/profile/privacy.js) and stays separate.
  const rhythmHost = el('div', null);
  wrap.appendChild(rhythmHost);
  renderRhythmCard(rhythmHost);

  const achSection = el('div','profile-section');
  const achHead = el('div','profile-section-head'); achHead.appendChild(el('span', null, 'Achievements'));
  achSection.appendChild(achHead);
  if(achList.length){
    const grid = el('div','profile-grid');
    achList.forEach(rec => grid.appendChild(metalBadge(rec)));
    achSection.appendChild(grid);
  } else {
    const empty = el('div','profile-empty'); empty.appendChild(el('p', null, 'Nothing earned yet.'));
    achSection.appendChild(empty);
  }
  wrap.appendChild(achSection);

  // Collection (unlocked pressings) and the pressing chart moved to the
  // profile's Records section/screen (records.js), alongside the records
  // they belong to.

  // SH1 (docs/18_SHARE.md): "Profile home: the existing Share button
  // becomes two rows, 'Share crate' and 'Share season' (the second only
  // once the rhythm card is unlocked, >= 20 plays in the 90-day window)."
  // Same gate renderRhythmCard() itself uses (rhythm-card.js) -- windowed,
  // not the lifetime phasePlayCounts.
  const shareStack = el('div','profile-share-stack');
  const shareCrateBtn = el('button','cta ghost profile-share','Share crate');
  shareCrateBtn.classList.toggle('active', crateFilled());
  shareCrateBtn.addEventListener('click', async () => {
    const { openShareSheet } = await import('../share/sheet.js');
    openShareSheet({ card:'crate' });
  });
  shareStack.appendChild(shareCrateBtn);

  const rhythm = computeRhythmShares(windowedPhaseCounts(S.phasePlayCountsByDay, Date.now(), RHYTHM_WINDOW_DAYS));
  if(rhythm.total >= RHYTHM_MIN_PLAYS){
    const shareSeasonBtn = el('button','cta ghost profile-share','Share season');
    shareSeasonBtn.addEventListener('click', async () => {
      // SH6 (docs/18_SHARE.md) item 1: metals = per-tier counts from
      // achievementsList(), playedThrough = that same list's own length
      // (every earned tier counts once toward "played through").
      const achList = achievementsList();
      const metals = {};
      achList.forEach(a => { metals[a.tier] = (metals[a.tier] || 0) + 1; });
      const { openShareSheet } = await import('../share/sheet.js');
      openShareSheet({ card:'season', data:{
        verdict: rhythmVerdictLabel(rhythm.shares), shares: rhythm.shares, total: rhythm.total,
        metals, playedThrough: achList.length, ownerName: S.profile.name || null,
      } });
    });
    shareStack.appendChild(shareSeasonBtn);
  }
  wrap.appendChild(shareStack);

  body.appendChild(wrap);
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
