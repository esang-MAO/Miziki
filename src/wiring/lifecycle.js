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
   all. Since RF7 (docs/12_REFINE.md), also the one place that notices
   playback actually stopped while hidden (because Background playback was
   off) and, on return, offers to turn it on — src/player/background.js's
   own bgNoteHidden()/bgCheckReturnOffer(), the once-only card. */
import { flushBackupSync, pullBackupOnForeground } from '../sync/backup.js';
import { computeSun } from '../sundown/solar.js';
import { drawSun } from '../player/clock.js';
import { bgNoteHidden, bgCheckReturnOffer, bgSync } from '../player/background.js';
import { saveResumeNow } from '../player/resume.js';

export function wireLifecycle(){
  document.addEventListener('visibilitychange', () => {
    // AU1 (docs/16_AUDIO.md §2.1): "immediately on... visibilitychange
    // (hidden)" — the same backgrounding moment flushBackupSync() already
    // treats as "about to lose this," now also saving the queue/position.
    if(document.visibilityState === 'hidden'){ flushBackupSync(); bgNoteHidden(); saveResumeNow(); }
    // bgSync() re-asserts Media Session metadata/handlers/position on
    // return (found 2026-10-26, player/background.js's own comment): an
    // extended background/lock spell is a known class of iOS bug where
    // the system can silently clear a page's own Now Playing
    // registration until it's foregrounded again, and nothing else in
    // this app ever re-syncs it on its own.
    else { pullBackupOnForeground(); computeSun(); drawSun(); bgCheckReturnOffer(); bgSync(); }
  });
  // iOS Safari can terminate a backgrounded home-screen app without ever
  // firing visibilitychange — pagehide is the one event reliably fired
  // first in that case too, so background-flush listens to it as well,
  // not instead of visibilitychange (which pagehide doesn't cover intra-
  // session, e.g. switching tabs/apps and coming straight back). AU1's
  // own "immediately on... pagehide" rule rides along for the same reason.
  window.addEventListener('pagehide', () => { flushBackupSync(); saveResumeNow(); });
}
