/* ================= listening rhythm card (DA5, docs/DAY_ARC.md; windowed RF22) =================
   renderRhythmCard() is the local half — a read-only stat card on this
   device's own profile, built from a rolling window over
   S.phasePlayCountsByDay (the ring/verdict, RF22's "a season") plus
   lifetime S.albumPhaseCounts (the per-phase "best record" list, left
   unwindowed — see sundown/rhythm.js's own header comment for why).
   Both are counted by the real clock only, src/history/played.js's
   incrementTrackPlay() via sundown/solar.js's realDayPosition() — see
   that file's own header comment for why Preview the day can never
   affect either. Visible to everyone, signed in or not, the same way the
   rest of the profile's local stats already are — the *sharing* switch
   (Privacy screen, src/profile/privacy.js) is the social-only half, kept
   separate.

   renderSharedRhythmCard(), at the bottom of this file, is the other
   half: a friend's own already-shared snapshot (src/social/screens/
   friend-store.js), built from the same ring/legend/verdict primitives
   but over a plain {verdict, shares} payload — never raw plays, and
   never a "best record" list, since neither is ever part of what gets
   shared in the first place (src/sync/backup.js's buildRhythmPayload()).

   screens.js's own header comment ("no locked slots, no progress bars,
   no 'X more until Y'" — PROFILE spec §1) is deliberately not followed
   for this one card: DA5's own instruction explicitly asks for "a dashed
   locked-state card ('12 of 20 plays')" below the 20-play gate, the same
   kind of later-step-overrides-an-earlier-default pattern DA3 already
   used when it superseded D2's own "Light keeps its static sky tokens"
   rule.

   docs/design/day-arc/README.md's own "Listening rhythm" component calls
   for a true 24-hour, one-bar-per-hour radial clock and "a record for
   each hour." Neither is backed by anything S.phasePlayCounts/
   S.albumPhaseCounts actually track — both are tallied per *phase* (seven
   buckets), not per hour, per DA5's own point 1. Building an hourly model
   would mean inventing data this step never asked for; the trim here —
   a 7-wedge phase ring (still genuinely radial, via a plain CSS
   conic-gradient, not flattened to a bar chart) and "a record for each
   phase" instead of each hour — is the same deliberate, documented
   scope trim this engagement already made for DA1's schematic
   (non-animated) night moon and DA2's skipped drift sparkline. */
import { S } from '../state.js';
import { el } from '../util/dom.js';
import {
  PHASES, RHYTHM_MIN_PLAYS, RHYTHM_WINDOW_DAYS, computeRhythmShares, rhythmVerdictLabel,
  bestAlbumPerPhase, windowedPhaseCounts,
} from '../sundown/rhythm.js';

const PHASE_LABEL = {
  night: 'Night', dawn: 'Dawn', morning: 'Morning', midday: 'Midday',
  afternoon: 'Afternoon', golden: 'Golden hour', twilight: 'Twilight',
};
// docs/design/day-arc/README.md's own "Phase colours (DA5 ring, legend
// and phase accents)" table, dark theme only — every other phase-colored
// surface this engagement has shipped (the day arc itself, DA3) already
// stays dark-theme-only in both app themes too, since none of
// src/styles/22-theme.css's light-theme overrides touch phase colors
// either; the README's own "darken until >=3:1" instruction for light
// theme was noted here, not acted on, until CR8 below.
// CR8 (docs/13_CRATE.md point 3): Golden's own #FFB85E -> #F2B35C, the
// same fix and the same reason as player/clock.js's own duplicate of this
// table (see that file's comment) -- kept in sync by hand, same as every
// other value these two tables already share.
const PHASE_COLOR = {
  night: '#8E7CC3', dawn: '#E7A7B8', morning: '#9FD8E8', midday: '#EFE9DF',
  afternoon: '#D9C7A0', golden: '#F2B35C', twilight: '#FF9E2C',
};

// CR8 (docs/13_CRATE.md point 2): "light phase chips use the secondaries
// with cream text, not the dark-mode pastels" -- this is the one surface
// that comment above says had never acted on the README's own light-
// theme instruction. The ring segments/legend dots are the "chip" here;
// each of the seven phases maps onto one of the four secondaries (00-base
// .css's own --prussian/--verdigris/--puce/--olive(-deep)/--warm-grey),
// reused rather than given a seventh distinct hue, since the README
// names only four for this whole family. Hex literals, not var(...) --
// a CSS custom property can't be read back into a JS string here the way
// it can be assigned to an element's own style, and these seven values
// have to go straight into a conic-gradient() string. The adjacent
// legend label text stays on the page background, not drawn over the
// dot itself, so "cream text" doesn't carry over to it -- there is no
// chip-with-text surface in this component for that half of the
// instruction to land on.
const PHASE_COLOR_LIGHT = {
  night: '#2B5586', dawn: '#7E555A', morning: '#2B5586', midday: '#6B6A3A',
  afternoon: '#6B6A3A', golden: '#7E555A', twilight: '#3E3D22',
};

function isLightTheme(){
  // Defensive against a test harness's own minimal document stub (no
  // documentElement/matchMedia at all) -- the same "no document.documentElement
  // means no theme, read as dark" default every other document-dependent
  // check in this codebase already falls back to.
  try{
    const pinned = document.documentElement.dataset.theme;
    if(pinned === 'light') return true;
    if(pinned === 'dark') return false;
    // Auto, nothing pinned -- the same device-scheme check 22-theme.css's
    // own @media (prefers-color-scheme: light) block already keys off.
    return matchMedia('(prefers-color-scheme: light)').matches;
  }catch(_e){ return false; }
}

function phaseColors(){
  return isLightTheme() ? PHASE_COLOR_LIGHT : PHASE_COLOR;
}

// A plain conic-gradient built from each phase's own share, in PHASES'
// fixed order — pure CSS, no SVG/canvas needed for a ring this simple.
function ringGradient(shares){
  const colors = phaseColors();
  let acc = 0;
  const stops = PHASES.map(p => {
    const start = acc * 360;
    acc += shares[p] || 0;
    return `${colors[p]} ${start}deg ${acc * 360}deg`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

function legendRow(phase, share){
  const row = el('div', 'rhythm-legend-row');
  const dot = el('span', 'rhythm-dot');
  dot.style.background = phaseColors()[phase];
  row.appendChild(dot);
  row.appendChild(el('span', 'rhythm-legend-label', PHASE_LABEL[phase]));
  row.appendChild(el('span', 'rhythm-legend-pct', Math.round(share * 100) + '%'));
  return row;
}

// disp.name/disp.artist trace back to a file's own embedded tag text
// (the same snapshot history/achievements.js's topAlbums() already
// reads) — built with el()/textContent throughout, never innerHTML, the
// same rule every other tag-derived string in this app already follows.
function recordRow(phase, albumId){
  const disp = S.albumDisplay[albumId] || { name: albumId, artist: '', art: null };
  const row = el('div', 'rhythm-record-row');
  const art = el('span', 'rhythm-record-art');
  if(disp.art){ const im = document.createElement('img'); im.src = disp.art; im.alt = ''; art.appendChild(im); }
  row.appendChild(art);
  const text = el('div', 'rhythm-record-text');
  text.appendChild(el('b', null, PHASE_LABEL[phase]));
  text.appendChild(el('span', null, disp.name + (disp.artist ? ' — ' + disp.artist : '')));
  row.appendChild(text);
  return row;
}

function renderLocked(host, total){
  const card = el('div', 'rhythm-card rhythm-locked');
  card.appendChild(el('div', 'rhythm-card-head', 'Listening rhythm'));
  card.appendChild(el('p', 'note', total + ' of ' + RHYTHM_MIN_PLAYS + ' plays — keep listening to unlock your rhythm.'));
  host.appendChild(card);
}

// Shared by both renderRhythmCard() (this device's own full card) and
// renderSharedRhythmCard() (a friend's shared snapshot) — the ring +
// legend + verdict are identical either way; only what goes in the
// ring's own centre, and whether a "record per phase" list follows,
// differ between the two.
function buildCard(verdict, shares, centerLines){
  const card = el('div', 'rhythm-card');
  card.appendChild(el('div', 'rhythm-card-head', 'Listening rhythm'));

  const top = el('div', 'rhythm-top');
  const ring = el('div', 'rhythm-ring');
  ring.style.background = ringGradient(shares);
  const center = el('div', 'rhythm-ring-center');
  centerLines.forEach(([tag, text]) => center.appendChild(el(tag, null, text)));
  ring.appendChild(center);
  top.appendChild(ring);

  const legend = el('div', 'rhythm-legend');
  PHASES.forEach(p => { if(shares[p] > 0) legend.appendChild(legendRow(p, shares[p])); });
  top.appendChild(legend);
  card.appendChild(top);

  card.appendChild(el('div', 'rhythm-verdict', verdict));
  return card;
}

// Called from profile/screens.js's renderProfileHome(), right alongside
// the existing storefront section — host is a plain container, cleared
// and rebuilt on every render the same way every other profile section
// already is.
//
// RF22 (docs/12_REFINE.md, "words that invite", point 3): "listening
// rhythm as a season" — windowed to the last RHYTHM_WINDOW_DAYS, not a
// lifetime total, so the 20-play gate below is also a 20-plays-*lately*
// gate: a device that hasn't played anything in a season reads as
// "not enough plays yet" again, the same honest "nothing to show"
// renderLocked() already gives a brand-new profile.
export function renderRhythmCard(host){
  host.innerHTML = '';
  const { total, shares } = computeRhythmShares(windowedPhaseCounts(S.phasePlayCountsByDay, Date.now(), RHYTHM_WINDOW_DAYS));
  if(total < RHYTHM_MIN_PLAYS){ renderLocked(host, total); return; }

  const card = buildCard(rhythmVerdictLabel(shares), shares,
    [['b', String(total)], ['span', total === 1 ? 'play' : 'plays']]);

  const best = bestAlbumPerPhase(S.albumPhaseCounts);
  const withRecords = PHASES.filter(p => best[p]);
  if(withRecords.length){
    const list = el('div', 'rhythm-records');
    withRecords.forEach(p => list.appendChild(recordRow(p, best[p])));
    card.appendChild(list);
  }

  host.appendChild(card);
}

// A friend's own shared rhythm, read straight off whatever
// MizikiSocial.loadProfile()'s own get_listening_rhythm() call already
// fetched (src/social/screens/friend-store.js) — `rhythm` is exactly
// {verdict, shares}, the one payload shape DA5 point 3 allows a device to
// ever publish: no raw play counts (so the ring's own centre carries no
// number here, unlike the local card's), and no per-phase "best record"
// list (that's never part of what gets shared at all — see
// src/sync/backup.js's buildRhythmPayload()). `rhythm` itself is already
// null-checked by the one caller before this is ever invoked.
export function renderSharedRhythmCard(host, rhythm){
  host.innerHTML = '';
  host.appendChild(buildCard(rhythm.verdict, rhythm.shares, [['span', '♪']]));
}
