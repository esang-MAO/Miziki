/* ================= wiring: app lifecycle =================
   New in step 06 (B3, account backup) — nothing else in src/wiring/ needed
   a visibilitychange/pagehide listener before this. Drives the backup sync
   engine's background-flush/foreground-pull behavior (the spec's own
   wording: "an upload when the app goes to the background... and a pull
   on launch and when it comes back to the foreground"); the "pull on
   launch" half happens once, directly from src/sync/backup.js's own
   initBackupSync(), not from here. Since DA1 (docs/DAY_ARC.md), returning
   to the foreground also recomputes the day model (computeSun()) — the
   same "don't trust a value computed hours ago" reasoning as the backup
   pull, since a backgrounded session's own dawn/dusk/etc. could easily
   have gone stale (or belong to the wrong calendar day entirely) by the
   time the tab is looked at again; the local-midnight timer
   (src/sundown/location.js's scheduleMidnightRecompute()) is the other
   half of keeping it fresh, for a session that's never backgrounded at
   all. */
import { flushBackupSync, pullBackupOnForeground } from '../sync/backup.js';
import { computeSun } from '../sundown/solar.js';
import { drawSun } from '../player/clock.js';

export function wireLifecycle(){
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden') flushBackupSync();
    else { pullBackupOnForeground(); computeSun(); drawSun(); }
  });
  // iOS Safari can terminate a backgrounded home-screen app without ever
  // firing visibilitychange — pagehide is the one event reliably fired
  // first in that case too, so background-flush listens to it as well,
  // not instead of visibilitychange (which pagehide doesn't cover intra-
  // session, e.g. switching tabs/apps and coming straight back).
  window.addEventListener('pagehide', flushBackupSync);
}
