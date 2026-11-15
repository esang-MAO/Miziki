export function normKey(s){
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,' ').trim();
}

// Seconds -> "m:ss" (floored, zero-padded). The one time display every
// scrubber/duration/mini-player readout and now-playing share card uses.
export function fmt(s){ s = Math.max(0, Math.floor(s)); return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0'); }

// "N <one>"/"N <many>" — the one count pluralizer the profile's top-album/
// top-song lines and the crate share card use.
export const fmtCount = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// Bytes -> "N.N MB"/etc, used by both the library size line (library/delete.js)
// and the storage-usage line (storage/usage.js) -- kept here, not in either
// of those, so a leaf module can supply both without pulling one into the
// other's import graph (BD5, docs/38_BEFORE_THE_DOMAIN.md).
export function formatBytes(n){
  if(!n) return '0 MB';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0;
  while(n >= 1024 && i < units.length - 1){ n /= 1024; i++; }
  return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}
