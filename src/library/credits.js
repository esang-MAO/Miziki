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
// Temporary circular imports back to main.js (rule 8 in CLAUDE.md) —
// screen/library-rendering functions not yet extracted. Used only inside
// the functions below, never at module top level.
import { closePlayer, showRoute, renderTracks, songRow } from '../main.js';

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
  closeCreditsSheet();
  if($('#playerOverlay').classList.contains('open')) closePlayer();
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

function renderCreditsSheet(t){
  const host = $('#creditsBody'); host.innerHTML = '';
  $('#creditsTitle').textContent = t.tags.title;
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
  renderCreditsSheet(t);
  $('#creditsOverlay').classList.add('open');
  $('#creditsOverlay').setAttribute('aria-hidden','false');
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
  });
}
