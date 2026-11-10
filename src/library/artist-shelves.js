/* ================= artist page: the local shelves (docs/21_ARTIST_PAGE.md) =================
   Three shelves under an artist's own record shelf, built only from what's
   already on this device — no social layer, no network:

   - Your most spun: this artist's five most-played records, by full plays
     (S.sessionCounts, LB8/docs/36A_LIBRARY_AND_LAUNCH.md decision 9)
   - You & [artist]: total spins, when you last spun them, and the
     time-of-day phase you most often play them in (S.albumPhaseCounts)
   - Your pressings: the disc each of this artist's albums presses as —
     the same discLook() the platter and the crate's pressing peek use, so
     a saved look, an earned metal, rare or zoetrope all carry through

   Each shelf is omitted entirely until it has something real to show (no
   empty states on an artist page). The model functions are pure — they
   take the stat maps as arguments — and tested in
   tests/unit/artist-shelves.test.js. Read-only: nothing here writes a
   listening counter (src/history/ is the only writer). */
import { S } from '../state.js';
import { el } from '../util/dom.js';
import { albumKey, trackIdentityKey, getVariantDef } from '../record-art/tiers.js';
import { discLook } from '../record-art/looks.js';
import { PHASES } from '../sundown/rhythm.js';
import { PHASE_LABEL } from '../profile/rhythm-card.js';
import { lastSpunLabel } from '../crate/model.js';

export const TOP_TRACKS = 5;
export const TOP_RECORDS = 5;
// Below this many phase-counted plays, "mostly spun at" is noise.
export const PHASE_MIN_PLAYS = 5;

/* ---- pure model ---- */

// One entry per distinct track identity (a re-imported duplicate file
// doesn't list twice), most-played first, ties broken by most recently
// played. Only tracks you've actually played.
export function topTracksFor(idx, tracks, playCounts, lastPlayed, n = TOP_TRACKS){
  const seen = new Map();
  idx.forEach(i => {
    const t = tracks[i];
    if(!t) return;
    const key = trackIdentityKey(t);
    const plays = playCounts[key] || 0;
    if(!plays || seen.has(key)) return;
    seen.set(key, { i, key, plays, last: lastPlayed[key] || 0 });
  });
  return [...seen.values()].sort((a, b) => b.plays - a.plays || b.last - a.last).slice(0, n);
}

// LB8 (docs/36A_LIBRARY_AND_LAUNCH.md decision 9/point 4): "Your most
// spun" shows one line per *record*, not per track -- full plays
// (S.sessionCounts, the same per-record counter history/achievements.js's
// topAlbums() reads) rather than individual track plays, since that's
// what "plays" means for a record. `entries` is the artist page's own
// [album, trackIdx[]] list (same shape appendPressings() below takes).
// Fixes the old per-track row's own "long title shows twice" bug (the
// track title and its album name, often identical on a single-track
// single, both rendered on the same row) by only ever showing the one
// record title, never a track title.
export function topRecordsFor(entries, tracks, sessionCounts, albumLastPlayed = {}, n = TOP_RECORDS){
  return entries
    .map(([album, aidx]) => {
      const t = tracks[aidx[0]];
      if(!t) return null;
      const albumId = albumKey(t);
      const plays = sessionCounts[albumId] || 0;
      return plays ? { albumId, album, aidx, plays, last: albumLastPlayed[albumId] || 0 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.plays - a.plays || b.last - a.last)
    .slice(0, n);
}

// The phase with the most plays; ties go to the earlier phase in the day.
export function topPhase(phaseCounts){
  let best = null, bestN = 0;
  PHASES.forEach(p => { const n = phaseCounts[p] || 0; if(n > bestN){ best = p; bestN = n; } });
  return best;
}

// Everything the You & [artist] card shows, or null when this artist has
// never been played on this device.
export function historyFor(idx, tracks, { playCounts, trackLast, albumLast, albumPhase }){
  const keys = new Set(), albums = new Set();
  idx.forEach(i => { const t = tracks[i]; if(t){ keys.add(trackIdentityKey(t)); albums.add(albumKey(t)); } });
  let spins = 0, last = 0;
  keys.forEach(k => { spins += playCounts[k] || 0; last = Math.max(last, trackLast[k] || 0); });
  if(!spins) return null;
  const phases = {};
  let phasePlays = 0;
  albums.forEach(a => {
    last = Math.max(last, albumLast[a] || 0);
    const pc = albumPhase[a] || {};
    Object.keys(pc).forEach(p => { phases[p] = (phases[p] || 0) + pc[p]; phasePlays += pc[p]; });
  });
  return { spins, last, phase: phasePlays >= PHASE_MIN_PLAYS ? topPhase(phases) : null };
}

const METAL_NAME = { platinum: 'Platinum', gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };

// The name under a pressing disc, from a discLook() result.
export function pressingLabel(look){
  if(!look) return 'Pressing';
  if(look.rare){ const d = getVariantDef(look.rareId); return d ? d.name : 'Rare'; }
  const d = look.variant ? getVariantDef(look.variant) : null;
  if(look.metal) return (METAL_NAME[look.metal] || 'Metal') + (d ? ' · ' + d.name : '');
  return d ? d.name : 'Pressing';
}

/* ---- rendering ---- */

function eyebrow(text){ return el('h3','artist-eyebrow', text); }

// LB8 point 4: "one line per record (cover, title ending with '…', '{n}
// plays')". `entries` is the artist page's own [album, trackIdx[]] list.
// `onOpen(album, aidx)` opens that record the same way its shelf sleeve
// above does (openAlbumFromLibrary(), passed in by the caller rather than
// imported here, to avoid a circular import with library/view.js).
// `artFor(albumId, firstTrack)` resolves a cover the same way, passed in
// rather than importing thumbURL from ./thumbs.js directly -- that module
// real-chains into profile/screens.js/crate/model.js/audio/engine.js (its
// own file-top comment), exactly the wide dependency web this module's
// own header says it stays free of for its unit tests.
export function appendMostSpun(host, entries, onOpen, artFor){
  const counts = S.mergedStats ? S.mergedStats.sessionCounts : S.sessionCounts;
  const top = topRecordsFor(entries, S.tracks, counts, S.albumLastPlayed);
  if(!top.length) return;
  const section = el('section','artist-section most-spun');
  section.appendChild(eyebrow('Your most spun'));
  const list = el('ol','most-spun-list');
  top.forEach(x => {
    const li = el('li');
    const btn = el('button','most-spun-row');
    const firstTrack = S.tracks[x.aidx[0]];
    const src = artFor ? artFor(x.albumId, firstTrack) : firstTrack.art;
    if(src){
      const im = el('img', 'most-spun-art'); im.src = src; im.alt = '';
      im.loading = 'lazy'; im.decoding = 'async'; im.width = 40; im.height = 40;
      btn.appendChild(im);
    } else btn.appendChild(el('span','most-spun-art g-art','◍'));
    btn.appendChild(el('span','most-spun-title', x.album));
    btn.appendChild(el('span','most-spun-plays', x.plays + (x.plays === 1 ? ' play' : ' plays')));
    btn.addEventListener('click', () => onOpen && onOpen(x.album, x.aidx));
    li.appendChild(btn);
    list.appendChild(li);
  });
  section.appendChild(list);
  host.appendChild(section);
}

export function appendArtistHistory(host, artist, idx){
  const h = historyFor(idx, S.tracks, {
    playCounts: S.trackPlayCounts, trackLast: S.trackLastPlayed,
    albumLast: S.albumLastPlayed, albumPhase: S.albumPhaseCounts,
  });
  if(!h) return;
  const card = el('section','artist-section artist-history');
  card.appendChild(el('span','artist-history-tape'));
  card.appendChild(el('h3','artist-history-title', 'You & ' + artist));
  const stats = el('div','artist-history-stats');
  const stat = (value, label) => {
    const s = el('div','artist-history-stat');
    s.appendChild(el('b', null, value));
    s.appendChild(el('span', null, label));
    stats.appendChild(s);
  };
  stat(String(h.spins), h.spins === 1 ? 'Spin' : 'Spins');
  if(h.last) stat(lastSpunLabel(h.last), 'Last spun');
  if(h.phase) stat(PHASE_LABEL[h.phase], 'Mostly spun');
  card.appendChild(stats);
  host.appendChild(card);
}

// entries: the artist page's own [album, trackIdx[]] list, in shelf order.
export function appendPressings(host, entries){
  const items = [];
  entries.forEach(([album, aidx]) => {
    const t = S.tracks[aidx[0]];
    if(!t) return;
    let look = null;
    try{ look = discLook(t); } catch(_e){ return; }
    items.push({ album, bg: look.bg, label: pressingLabel(look), paperLabel: look.paperLabel });
  });
  if(!items.length) return;
  const section = el('section','artist-section artist-pressings');
  section.appendChild(eyebrow('Your pressings'));
  const row = el('div','pressings-row');
  items.forEach(it => {
    const fig = el('figure','pressing-item');
    const disc = el('span','pressing-disc');
    disc.setAttribute('aria-hidden','true');
    disc.style.background = it.bg;
    // UN13 point 5 (Nov 7 decision): the same paper centre label every
    // other disc carries (record-art/looks.js's own paperLabel flag --
    // false for a zoetrope, whose own art already fills the centre).
    if(it.paperLabel) disc.appendChild(el('span','paper-label-sm'));
    disc.appendChild(el('span','pressing-disc-hole'));
    fig.appendChild(disc);
    const cap = el('figcaption');
    cap.appendChild(el('b', null, it.label));
    cap.appendChild(el('span', null, it.album));
    fig.appendChild(cap);
    row.appendChild(fig);
  });
  section.appendChild(row);
  host.appendChild(section);
}
