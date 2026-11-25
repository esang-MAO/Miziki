export function normKey(s){
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,' ').trim();
}

// Seconds -> "m:ss" (floored, zero-padded). The one time display every
// scrubber/duration/mini-player readout and now-playing share card uses.
export function fmt(s){ s = Math.max(0, Math.floor(s)); return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0'); }

// AC2 (docs/39_ACCESSIBILITY.md): a seek slider's own spoken value --
// "1:23 of 4:05" -- instead of the raw 0-1000 range value VoiceOver would
// otherwise read. Pure so it's unit-testable on its own.
export function scrubValueText(pos, dur){ return fmt(pos) + ' of ' + fmt(dur); }

// AC2: whether player/transport.js's load() own "now playing" announcement
// should actually say anything -- true only for a genuinely different
// track object, never a reload of the one already playing. Pure so the
// "same track -> no announcement" rule has something testable to pin
// down, without reaching through load()'s own DOM/gesture-timing
// machinery (rule 9).
export function shouldAnnounceNewTrack(prevTrack, newTrack){
  return !!newTrack && prevTrack !== newTrack;
}

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
