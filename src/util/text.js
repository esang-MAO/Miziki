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
