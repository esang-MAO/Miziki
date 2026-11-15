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
