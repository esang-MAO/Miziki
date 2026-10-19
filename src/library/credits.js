/* ================= liner notes & credits (CREDITS spec §1) =================
   Moved out of main.js (step 5e). Read-only presentation of t.details —
   comments shown as "Notes" only when they read like real liner notes (long
   enough, or multi-line, and not a rip-tool signature), with everything
   else available behind a toggle.

   ================= credits that link: person view (CREDITS spec §2) =====
   A lazily-rebuilt index — rebuilt only when tracks change or healDetails
   runs, never per-render — so tapping a name is a map lookup, not a scan. */
import { S, current } from '../state.js';
import { $, el } from '../util/dom.js';
import { normKey } from '../util/text.js';
import { byName, albumTracks } from './model.js';
import { emptyDetails } from './tags/index.js';
import { setQueue } from '../player/queue.js';
import { showRoute } from '../shell/routes.js';
import { renderTracks, songRow } from './view.js';
import { openLayer, forceCloseLayer } from '../shell/nav-stack.js';
import { openFriendStore } from '../social/screens/friend-store.js';

const COMMENT_JUNK_RE = /^(ripped|encoded|exact audio copy|eac|cuetools|from musicbrainz)/i;
const CREDIT_ROLE_BUCKETS = [['composers','Composer'],['lyricists','Lyricist'],['producers','Producer'],
  ['conductors','Conductor'],['arrangers','Arranger'],['engineers','Engineer'],['mixers','Mixer'],['remixers','Remixer']];

function splitComments(raw){ return (raw || '').split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean); }
function commentQualifies(c){ return !COMMENT_JUNK_RE.test(c.trim()) && (c.length >= 40 || /\n/.test(c)); }

export function trackHasCreditsContent(t){
  const d = t && t.details;
  if(!d) return false;
  if(CREDIT_ROLE_BUCKETS.some(([k]) => (d[k]||[]).length)) return true;
  if((d.performers||[]).length) return true;
  if(d.genre || d.year || d.label || d.catalog || d.isrc) return true;
  return splitComments(d.comment).length > 0;
}

// exact normKey() match only — same "never auto-merge" principle as the
// duplicate scan (see CREDITS spec §2); if the name is already a library
// artist, that artist view is the more useful destination
function artistExists(name){
  const key = normKey(name);
  return S.tracks.some(t => normKey(t.tags.artist) === key || normKey(t.tags.albumArtist) === key);
}

export function openPersonOrArtist(name){
  if($('#creditsOverlay').classList.contains('open')) forceCloseLayer('credits');
  if($('#playerOverlay').classList.contains('open')) forceCloseLayer('player');
  const v = S.view;
  if(artistExists(name)){
    v.mode = 'artists'; v.group = name; v.artistAlbum = null; v.playlist = null; v.picking = false; v.person = null;
  } else {
    if(v.mode !== 'person') v.personReturn = {mode:v.mode, group:v.group, artistAlbum:v.artistAlbum, playlist:v.playlist};
    v.mode = 'person'; v.person = name; v.group = null; v.playlist = null; v.picking = false;
  }
  $('#librarySearch').value = '';
  showRoute('library');
  renderTracks();
}

function creditLinkButton(name){
  const b = el('button','credit-link', name);
  b.addEventListener('click', () => openPersonOrArtist(name));
  return b;
}
function creditNamesCell(names){
  const span = el('span','credit-names');
  names.forEach((n, i) => { if(i) span.appendChild(document.createTextNode(', ')); span.appendChild(creditLinkButton(n)); });
  return span;
}
export function creditRow(label, names){
  const row = el('div','credit-row');
  row.appendChild(el('span','credit-role', label));
  row.appendChild(creditNamesCell(names));
  return row;
}

function trackCreditRows(d){
  const rows = [];
  CREDIT_ROLE_BUCKETS.forEach(([key,label]) => { if((d[key]||[]).length) rows.push([label, d[key]]); });
  if((d.performers||[]).length){
    const byRole = new Map();
    d.performers.forEach(p => {
      const label = p.role || 'Performer';
      if(!byRole.has(label)) byRole.set(label, []);
      byRole.get(label).push(p.name);
    });
    byRole.forEach((names, label) => rows.push([label, names]));
  }
  return rows;
}

// exported (previously module-private) since step D6 lets the desktop
// side panel's "Credits" tab target this at #playerSideBody instead of
// the phone overlay's #creditsBody — same render, just a different host.
// host defaults to the phone sheet's own element, unchanged for that call
// site (openCreditsSheet() below). The "#creditsTitle text" line that used
// to live here moved to openCreditsSheet() instead — it's overlay-sheet
// chrome, not part of "build credits content for this track," and the
// side panel has its own "Credits" tab label for the same job. A falsy t
// (never possible from the existing #trackInfoBtn call site, which is
// only ever shown once a track with real credits content is loaded, but
// reachable from the side panel before anything has ever played) renders
// a plain fallback instead of throwing.
export function renderCreditsSheet(t, host){
  host = host || $('#creditsBody'); host.innerHTML = '';
  if(!t){ host.appendChild(el('p','note','Nothing is playing.')); return; }
  const d = t.details || emptyDetails();

  const comments = splitComments(d.comment);
  if(comments.length){
    const section = el('div','credit-section');
    section.appendChild(el('h3', null, 'Notes'));
    const qualifying = comments.filter(commentQualifies);
    const notesList = el('div');
    let showingAll = !qualifying.length;
    const renderNotes = () => {
      notesList.innerHTML = '';
      (showingAll ? comments : qualifying).forEach(c => notesList.appendChild(el('p','credit-note', c)));
    };
    renderNotes();
    section.appendChild(notesList);
    if(qualifying.length && qualifying.length < comments.length){
      const toggle = el('button','credit-toggle', 'Show all comments');
      toggle.addEventListener('click', () => {
        showingAll = !showingAll;
        toggle.textContent = showingAll ? 'Show fewer comments' : 'Show all comments';
        renderNotes();
      });
      section.appendChild(toggle);
    }
    host.appendChild(section);
  }

  const creditRows = trackCreditRows(d);
  if(creditRows.length){
    const section = el('div','credit-section');
    section.appendChild(el('h3', null, 'Credits'));
    creditRows.forEach(([label, names]) => section.appendChild(creditRow(label, names)));
    host.appendChild(section);
  }

  const detailRows = [];
  if(d.genre) detailRows.push(['Genre', d.genre]);
  if(d.year) detailRows.push(['Year', String(d.year)]);
  if(d.label) detailRows.push(['Label', d.label]);
  if(d.catalog) detailRows.push(['Catalog #', d.catalog]);
  if(d.isrc) detailRows.push(['ISRC', d.isrc]);
  if(d.hasLyrics) detailRows.push(['Lyrics', 'Embedded']);
  if(detailRows.length){
    const section = el('div','credit-section');
    section.appendChild(el('h3', null, 'Details'));
    detailRows.forEach(([label, val]) => {
      const row = el('div','credit-row');
      row.appendChild(el('span','credit-role', label));
      row.appendChild(el('span','credit-names', val));
      section.appendChild(row);
    });
    host.appendChild(section);
  }

  if(!host.children.length) host.appendChild(el('p','note','No notes or credits found in this file.'));
}

export function openCreditsSheet(t){
  $('#creditsTitle').textContent = t.tags.title;
  renderCreditsSheet(t);
  const overlay = $('#creditsOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden','false');
  openLayer('credits', closeCreditsSheet, { container: overlay });
}
export function closeCreditsSheet(){
  $('#creditsOverlay').classList.remove('open');
  $('#creditsOverlay').setAttribute('aria-hidden','true');
}

export function updateCreditsButtonForCurrent(){
  const t = current();
  $('#trackInfoBtn').style.display = (t && trackHasCreditsContent(t)) ? '' : 'none';
}

export function albumLinerNotes(album){
  let best = '';
  albumTracks(album).forEach(i => {
    const d = S.tracks[i].details;
    if(!d) return;
    splitComments(d.comment).filter(commentQualifies).forEach(c => { if(c.length > best.length) best = c; });
  });
  return best;
}

// D6 (docs/DESKTOP_LAYOUT.md): the desktop side panel's own "Liner notes"
// tab — the one new render function this step adds, since albumLinerNotes()
// above was always a pure data accessor (a string), never something with
// a render counterpart of its own on the phone (the gatefold's left panel,
// src/gatefold/view.js, folds the same string into a bigger block alongside
// the credit roll and social controls — not reusable here, since this tab
// is deliberately just the notes, per the doc's own three-tab split). A
// falsy album (reachable before anything has ever played) gets the exact
// same "no notes" copy the gatefold's own minimal-note fallback uses, for
// the same reason: no notes and no album are both "nothing to show here."
export function renderLinerNotes(host, album){
  host.innerHTML = '';
  const text = album ? albumLinerNotes(album) : '';
  host.appendChild(text ? el('p','credit-note', text) : el('p','note','No liner notes in these files.'));
}

// de-duplicated by role + normKey(name) across every track on the album
export function albumCreditRoll(album){
  const seen = new Set(), byRole = new Map();
  const addCredit = (label, name) => {
    const key = label + '|' + normKey(name);
    if(!name || !normKey(name) || seen.has(key)) return;
    seen.add(key);
    if(!byRole.has(label)) byRole.set(label, []);
    byRole.get(label).push(name);
  };
  albumTracks(album).forEach(i => {
    const d = S.tracks[i].details;
    if(!d) return;
    CREDIT_ROLE_BUCKETS.forEach(([key,label]) => (d[key]||[]).forEach(n => addCredit(label, n)));
    (d.performers||[]).forEach(p => addCredit(p.role || 'Performer', p.name));
  });
  return byRole;
}

// RF23 (docs/12_REFINE.md, "credits across friends") — the flat,
// normalized-name wire shape src/miziki-social.js's buildItems() sends as
// a crate item's own `credits` field, straight off albumCreditRoll()'s
// Map<role, name[]> (the same de-duplication, role labels and name
// casing renderPersonView()'s own byRole grouping already uses — so a
// server-side "3 friends have records [person] [role]" match lines up
// with the exact role section this device would group that same credit
// under). Normalizing the name here, not server-side, keeps the match
// rule (normKey()) in the one place the rest of the credits code already
// trusts it.
export function albumCreditPairs(album){
  const pairs = [];
  albumCreditRoll(album).forEach((names, role) => {
    names.forEach(name => { const n = normKey(name); if(n) pairs.push({ name: n, role }); });
  });
  return pairs;
}

let peopleIndex = new Map();
export const PERSON_ROLE_KEYS = CREDIT_ROLE_BUCKETS.map(([k]) => k);

export function rebuildPeopleIndex(){
  peopleIndex = new Map();
  const addPerson = (name, role, trackIdx) => {
    const n = (name || '').trim(); if(!n) return;
    const key = normKey(n); if(!key) return;
    if(!peopleIndex.has(key)) peopleIndex.set(key, {name:n, entries:[]});
    peopleIndex.get(key).entries.push({trackIdx, role});
  };
  S.tracks.forEach((t, i) => {
    const d = t.details;
    if(!d) return;
    PERSON_ROLE_KEYS.forEach(key => (d[key]||[]).forEach(name => addPerson(name, CREDIT_ROLE_BUCKETS.find(b=>b[0]===key)[1], i)));
    (d.performers||[]).forEach(p => addPerson(p.name, p.role || 'Performer', i));
  });
}

// named accessor rather than exporting the Map itself — keeps peopleIndex
// private to this module (search.js is the one other caller, for the
// "People" result group)
export function personEntryFor(name){ return peopleIndex.get(normKey(name)); }

// RF23 (docs/12_REFINE.md, "credits across friends") — the person view's
// own "N friends have records [person] [role]" line, one per role
// section (the same granularity release_credits/credit_friends() are
// keyed by), signed in only. Appended into `section` asynchronously —
// renderPersonView() itself stays synchronous, so this never delays
// showing the tracklist, and a stale response landing after the person
// view has moved on just writes into a now-detached node, harmlessly.
function appendCreditFriendsLine(section, name, role){
  if(typeof MizikiSocial === 'undefined' || !MizikiSocial.status || MizikiSocial.status().auth !== 'ready') return;
  const holder = el('div','credit-friends');
  section.appendChild(holder);
  MizikiSocial.creditFriends(normKey(name), role).then(res => {
    if(!res.ok || !res.items.length) return;
    const byFriend = new Map();
    res.items.forEach(it => {
      if(!byFriend.has(it.user_id)) byFriend.set(it.user_id, { handle: it.handle, name: it.display_name || it.handle, releases: [] });
      byFriend.get(it.user_id).releases.push(it.title);
    });
    const friends = [...byFriend.values()];
    const n = friends.length;
    const btn = el('button','link-btn credit-friends-btn',
      n + (n === 1 ? ' friend has' : ' friends have') + ' records ' + name + ' ' + role.toLowerCase());
    const list = el('ul','credit-friends-list'); list.hidden = true;
    friends.sort((a,b) => byName(a.name, b.name)).forEach(f => {
      const li = el('li');
      const link = el('button','link-btn', f.name + (f.releases.length > 1 ? ' (' + f.releases.length + ')' : ''));
      link.addEventListener('click', () => openFriendStore(f.handle));
      li.appendChild(link);
      list.appendChild(li);
    });
    btn.addEventListener('click', () => { list.hidden = !list.hidden; });
    holder.appendChild(btn);
    holder.appendChild(list);
  }).catch(()=>{});
}

export function renderPersonView(host, name){
  const entry = peopleIndex.get(normKey(name));
  if(!entry || !entry.entries.length){
    host.appendChild(el('p','note','No credits found for “' + name + '”.'));
    return;
  }
  const byRole = new Map();
  entry.entries.forEach(({trackIdx, role}) => {
    const label = role || 'Performer';
    if(!S.tracks[trackIdx]) return;
    if(!byRole.has(label)) byRole.set(label, []);
    if(!byRole.get(label).includes(trackIdx)) byRole.get(label).push(trackIdx);
  });
  const everyIdx = [...new Set(entry.entries.map(e => e.trackIdx))].filter(i => S.tracks[i]);
  const playAll = el('button','cta','Play all (' + everyIdx.length + (everyIdx.length===1?' track)':' tracks)'));
  playAll.addEventListener('click', () => setQueue(everyIdx, 0, true));
  host.appendChild(playAll);
  [...byRole.entries()].sort((a,b) => byName(a[0], b[0])).forEach(([role, idxs]) => {
    const section = el('div','credit-section');
    section.appendChild(el('h3', null, role));
    const ul = el('ul','tracklist');
    idxs.slice().sort((a,b) => byName(S.tracks[a].tags.title, S.tracks[b].tags.title))
      .forEach((i,pos) => ul.appendChild(songRow(i, idxs, pos)));
    section.appendChild(ul);
    host.appendChild(section);
    appendCreditFriendsLine(section, name, role);
  });
}
