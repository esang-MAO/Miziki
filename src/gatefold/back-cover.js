/* ================= GF5/GF6 (docs/29_GATEFOLD.md): the back cover =========
   Every record has a back. With no image of its own, a record gets the
   Miziki default back (GF5): built as DOM from the record's own data, not
   an image -- artist, title, both sides with track times and side totals
   (splitSides(), same time-balanced split the gatefold's own tracklist
   uses), the catalogue line (matches the dead wax's own
   matrixTail(releaseId)), the format/speed/channel/total-time line, and
   "℗ year label" only when the tags actually carry them.

   GF6 ("your own back cover") lets a photo stand in for that default,
   album-keyed (the back is a property of the record, not any one track):
   setAlbumBackCoverImage()/clearAlbumBackCoverImage() own the artwork-store
   row ('back:<albumKey>') and hand the sync claim off to sync/backup.js,
   getAlbumBackCoverBlob() is how a caller (gatefold/view.js, the edit
   sheet) checks whether one exists, and buildBackCoverImageEl() draws it
   -- same root structure/class as buildBackCoverEl() below (role="img",
   .gf-back-cover) so wear classes and sizing apply to either one alike. */
import { S } from '../state.js';
import { el } from '../util/dom.js';
import { fmt } from '../util/text.js';
import { splitSides } from '../shell/ceremony-timing.js';
import { matrixTail } from '../record-art/etchings.js';
import { formatSpeedText } from '../record-art/format.js';
import { wordmarkEl } from '../ui/wordmark.js';
import { artwork } from '../storage/repo.js';
import { queueBackCoverUpload, clearBackCoverClaim } from '../sync/backup.js';

// GF6: the artwork-store key a user's own back-cover photo for this album
// lives under -- 'back:<albumKey>', no new store, no schema bump (CLAUDE.md's
// GF6 storage note).
function backCoverArtworkId(albumId){ return 'back:' + albumId; }

export async function getAlbumBackCoverBlob(albumId){
  const rec = await artwork.get(backCoverArtworkId(albumId));
  return (rec && rec.blob) || null;
}

// blob is already square-cropped by the caller (cropSquareImage(), the
// same step the edit sheet's own cover picker already takes) -- this just
// owns the local artwork row and the sync claim, same split applyEdit()'s
// own artBlob branch has between artwork.put() and queueCoverUpload().
export async function setAlbumBackCoverImage(albumId, blob){
  await artwork.put({ id: backCoverArtworkId(albumId), blob });
  queueBackCoverUpload(albumId, blob);
}
// "Use Miziki default" -- GF6 point 1's menu, the edit sheet's own row.
export async function clearAlbumBackCoverImage(albumId){
  await artwork.del(backCoverArtworkId(albumId));
  clearBackCoverClaim(albumId);
}

// UN10 (docs/36_UNIFORMITY.md point 2): the back cover's own "⋯" rows
// (Choose an image…/Photograph your copy/Use Miziki default) now live at
// the top of the gatefold's one options menu (gfMoreMenu, #gfMoreBtn)
// instead of a second button/menu of their own -- shown only once the
// record is actually turned over. Pure so a unit test can assert this
// without view.js's own wide, DOM-heavy import graph.
export function backCoverMenuRowsVisible(turnedOver){ return !!turnedOver; }

// GF5 point 4: a worn record's back carries the same wear classes as its
// sleeve -- reusing .gf-back-cover here (rather than a new class) is what
// lets updateGatefoldSleeveState()'s existing `#gfBackCover .gf-back-cover`
// selector reach a photo back exactly the way it already reaches the
// data-built one below.
export function buildBackCoverImageEl(blob, item){
  const root = el('div', 'gf-back-cover gf-back-cover-photo');
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'Back cover for ' + item.album);
  const img = document.createElement('img');
  img.alt = '';
  img.src = URL.createObjectURL(blob);
  root.appendChild(img);
  return root;
}

// GF5 point 3: "a 10″ or 7″ back... when the tracklist still doesn't fit,
// shows each side's first tracks plus 'and N more'." 12″ has the room to
// show every track; 10″/7″ cap each side's own list, the overflow folded
// into one trailing line instead of ever scrolling.
const MAX_TRACKS_BY_SIZE = { '7"': 4, '10"': 6, '12"': Infinity };

// Pure: every value the back needs, with no DOM. `format` is the album's
// own resolved format (gatefoldItemFormat()'s return shape, {size,speed})
// -- passed in rather than recomputed here so this module never needs its
// own override lookup. trackIdx/tracks follow the same shape every other
// ceremony-timing.js caller uses.
export function buildBackCoverData(item, trackIdx, format){
  const idx = trackIdx || [];
  const sides = (idx.length >= 2 ? splitSides(idx, S.tracks, true) : null)
    || [{ label: 'SIDE A', idx }];
  const size = (format && format.size) || '12"';
  const maxPerSide = MAX_TRACKS_BY_SIZE[size];
  const capped = Number.isFinite(maxPerSide);
  const sideData = sides.map(side => {
    const total = side.idx.reduce((s,i) => s + (S.tracks[i].duration || 0), 0);
    const shown = capped ? side.idx.slice(0, maxPerSide) : side.idx;
    const overflow = side.idx.length - shown.length;
    return {
      label: side.label,
      total,
      tracks: shown.map(i => ({
        title: (S.tracks[i].tags && S.tracks[i].tags.title) || '',
        duration: S.tracks[i].duration || 0,
      })),
      overflow: overflow > 0 ? overflow : 0,
    };
  });
  const totalSec = idx.reduce((s,i) => s + (S.tracks[i].duration || 0), 0);
  const t0 = idx.length ? S.tracks[idx[0]] : null;
  const ch = t0 && t0.meta ? t0.meta.ch : null;
  const speed = formatSpeedText(format ? format.speed : undefined);
  const formatLine = [
    size.replaceAll('"', '″'), speed + ' RPM', ch === 1 ? 'MONO' : 'STEREO', fmt(totalSec),
  ].join(' · ');
  const label = (t0 && t0.tags && t0.tags.label) || null;
  const year = item.year || (t0 && t0.tags && t0.tags.year) || null;
  return {
    artist: item.artist,
    title: item.album,
    sides: sideData,
    catalogLine: 'MZK-' + matrixTail(item.albumId),
    formatLine,
    label,
    year,
  };
}

function sideRowEl(side){
  const col = el('div','gf-back-side');
  const head = el('div','gf-back-side-head');
  head.appendChild(el('b', null, side.label));
  head.appendChild(el('span', null, fmt(side.total)));
  col.appendChild(head);
  side.tracks.forEach((t, i) => {
    const row = el('p','gf-back-track');
    row.appendChild(el('span','gf-back-tn', String(i + 1)));
    row.appendChild(el('span','gf-back-tt', t.title));
    row.appendChild(el('span','gf-back-td', fmt(t.duration)));
    col.appendChild(row);
  });
  if(side.overflow > 0) col.appendChild(el('p','gf-back-more', 'and ' + side.overflow + ' more'));
  return col;
}

// Built fresh per open (same lifetime as the tracklist/left-panel content),
// never cached -- one ink on --stock-card, a printed frame, the wordmark
// as the back's one allowed amber (CLAUDE.md: "nothing else is amber").
export function buildBackCoverEl(item, trackIdx, format){
  const data = buildBackCoverData(item, trackIdx, format);
  const size = (format && format.size) || '12"';
  const root = el('div', 'gf-back-cover ' + (size === '7"' ? 'gf-back-7' : size === '10"' ? 'gf-back-10' : 'gf-back-12'));
  root.setAttribute('role','img');
  root.setAttribute('aria-label', 'Default Miziki back cover for ' + data.title);
  const frame = el('div','gf-back-frame');
  frame.appendChild(el('p','gf-back-artist', data.artist));
  frame.appendChild(el('h2','gf-back-title', data.title));
  const grid = el('div','gf-back-sides');
  data.sides.forEach(side => grid.appendChild(sideRowEl(side)));
  frame.appendChild(grid);
  const footer = el('div','gf-back-footer');
  const meta = el('div','gf-back-meta');
  meta.appendChild(el('p','gf-back-catalog', data.catalogLine));
  meta.appendChild(el('p', null, data.formatLine));
  if(data.label || data.year) meta.appendChild(el('p', null, ['℗', data.year, data.label].filter(Boolean).join(' ')));
  footer.appendChild(meta);
  const mark = wordmarkEl();
  mark.classList.add('gf-back-wordmark');
  footer.appendChild(mark);
  frame.appendChild(footer);
  root.appendChild(frame);
  return root;
}
