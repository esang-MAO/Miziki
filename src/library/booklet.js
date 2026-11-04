/* ================= GF10: the booklet (docs/29_GATEFOLD.md) =================
   Pure detection of a sidecar booklet page at import, plus the small
   storage layer over it. A page's real image bytes live in the `artwork`
   store (src/storage/idb.js) under 'booklet:<albumId>:<NNNN>' -- the same
   store GF6's back-cover photo and the crate-art tiers already share,
   each with its own id scheme (src/gatefold/back-cover.js,
   src/crate/tiers.js). Device-only, excluded from backup like audio and
   embedded art (CLAUDE.md's backup table) -- only the page *count*
   (S.albumBookletPages, state.js) round-trips through meta, purely so
   gatefold/view.js's "Booklet · N pages" row can read it synchronously. */
import { S } from '../state.js';
import { artwork } from '../storage/repo.js';
import { persistAlbumBookletPages } from '../history/sessions.js';

const PAGE_IMAGE_EXT = ['jpg','jpeg','png','webp','gif'];
const BOOKLET_FOLDER_NAMES = ['booklet','scans','artwork'];

function fileExt(name){
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}
export function isPageImageName(name){ return PAGE_IMAGE_EXT.includes(fileExt(name)); }

// GF10 point 1: "a folder named booklet/scans/artwork beside the audio
// files, or images whose names start with booklet" -- relativePath is a
// webkitRelativePath-style "AlbumFolder/sub/name.ext" string (empty/absent
// for a flat multi-file pick with no folder info, which still matches the
// filename rule, just never the folder one).
export function isBookletPageCandidate(name, relativePath){
  if(!isPageImageName(name)) return false;
  if(/^booklet/i.test(name)) return true;
  const parts = (relativePath || '').split('/').filter(Boolean);
  const parentFolder = parts.length >= 2 ? parts[parts.length - 2] : '';
  return BOOKLET_FOLDER_NAMES.includes(parentFolder.toLowerCase());
}

// Groups a batch's booklet candidates by the folder that holds their
// *album* -- a booklet/scans/artwork subfolder's own parent, or (a
// filename-rule page sitting right beside the audio) its own parent
// folder -- so import.js can match each group to the album whose audio
// files share that same folder. Each group's candidates come back sorted
// by file name (GF10 point 1, "ordered by file name" / point 4).
export function groupBookletCandidatesByAlbumFolder(candidates){
  const groups = new Map();
  for(const c of candidates){
    const parts = (c.relativePath || '').split('/').filter(Boolean);
    parts.pop();   // drop the filename itself
    const parentFolder = parts[parts.length - 1] || '';
    const albumFolderParts = BOOKLET_FOLDER_NAMES.includes(parentFolder.toLowerCase()) ? parts.slice(0, -1) : parts;
    const key = albumFolderParts.join('/');
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  groups.forEach(list => list.sort((a,b) => a.name.localeCompare(b.name)));
  return groups;
}

export function bookletPageArtworkId(albumId, index){ return 'booklet:' + albumId + ':' + String(index).padStart(4,'0'); }
export function bookletPageCount(albumId){ return S.albumBookletPages[albumId] || 0; }

// Ordered pages for the viewer -- {index, blob}, skipping any row that
// somehow went missing rather than breaking the whole viewer over one.
export async function bookletPages(albumId){
  const n = bookletPageCount(albumId);
  const out = [];
  for(let i = 0; i < n; i++){
    const rec = await artwork.get(bookletPageArtworkId(albumId, i));
    if(rec && rec.blob) out.push({ index: i, blob: rec.blob });
  }
  return out;
}

// Appends `blobs` (already ordered) after whatever pages the album
// already has -- both the import-time path (GF10 point 1) and "Add
// booklet pages…" from the inside-left panel go through this one writer.
export async function addBookletPages(albumId, blobs){
  if(!blobs.length) return;
  const start = bookletPageCount(albumId);
  for(let i = 0; i < blobs.length; i++) await artwork.put({ id: bookletPageArtworkId(albumId, start + i), blob: blobs[i] });
  S.albumBookletPages[albumId] = start + blobs.length;
  await persistAlbumBookletPages();
}
