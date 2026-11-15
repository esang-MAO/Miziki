/* ================= sidecar image detection (pure) =================
   Moved out of the now-removed booklet feature (GF10, docs/29_GATEFOLD.md)
   by BD9 (docs/38_BEFORE_THE_DOMAIN.md) -- a plain image-extension check
   and the by-album-folder grouping it needs still have a use ahead of
   them (BD10's back-cover auto-detection), even with the booklet viewer
   itself gone. A move, no behaviour change. */

const PAGE_IMAGE_EXT = ['jpg','jpeg','png','webp','gif'];
const SIDECAR_FOLDER_NAMES = ['booklet','scans','artwork'];

function fileExt(name){
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}
export function isPageImageName(name){ return PAGE_IMAGE_EXT.includes(fileExt(name)); }

// BD10 (docs/38_BEFORE_THE_DOMAIN.md): the file-name forms a back-cover
// scan is likely to carry -- a leading track/page number (dropped, same
// as any other sidecar scan) then an exact match against a short list of
// plain English/common-scan names. Deliberately narrow: a folder's own
// front-cover scan or a loose booklet page must never be picked up.
const BACK_COVER_NAMES = ['back','back cover','backcover','back_cover','back-cover','rear','rear cover','tray','inlay'];

function stripExt(name){
  const i = name.lastIndexOf('.');
  return i === -1 ? name : name.slice(0, i);
}
export function isBackCoverName(name){
  const stem = stripExt(name).toLowerCase().trim().replace(/^\d+[\s\-_.]+/, '').replace(/[-_]+/g, ' ').trim();
  return BACK_COVER_NAMES.map(n => n.replace(/[-_]/g, ' ')).includes(stem);
}

// Groups a batch's sidecar-image candidates by the folder that holds their
// *album* -- a booklet/scans/artwork subfolder's own parent, or (a
// filename-rule match sitting right beside the audio) its own parent
// folder -- so a caller can match each group to the album whose audio
// files share that same folder. Each group's candidates come back sorted
// by file name.
export function groupSidecarCandidatesByAlbumFolder(candidates){
  const groups = new Map();
  for(const c of candidates){
    const parts = (c.relativePath || '').split('/').filter(Boolean);
    parts.pop();   // drop the filename itself
    const parentFolder = parts[parts.length - 1] || '';
    const albumFolderParts = SIDECAR_FOLDER_NAMES.includes(parentFolder.toLowerCase()) ? parts.slice(0, -1) : parts;
    const key = albumFolderParts.join('/');
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  groups.forEach(list => list.sort((a,b) => a.name.localeCompare(b.name)));
  return groups;
}
