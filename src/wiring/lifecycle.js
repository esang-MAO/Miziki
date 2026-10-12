/* ================= wiring: app lifecycle =================
   New in step 06 (B3, account backup) — nothing else in src/wiring/ needed
   a visibilitychange/pagehide listener before this. Drives the backup sync
   engine's background-flush/foreground-pull behavior (the spec's own
   wording: "an upload when the app goes to the background... and a pull
   on launch and when it comes back to the foreground"); the "pull on
   launch" half happens once, directly from src/sync/backup.js's own
   initBackupSync(), not from here. */
import { flushBackupSync, pullBackupOnForeground } from '../sync/backup.js';

export function wireLifecycle(){
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden') flushBackupSync();
    else pullBackupOnForeground();
  });
  // iOS Safari can terminate a backgrounded home-screen app without ever
  // firing visibilitychange — pagehide is the one event reliably fired
  // first in that case too, so background-flush listens to it as well,
  // not instead of visibilitychange (which pagehide doesn't cover intra-
  // session, e.g. switching tabs/apps and coming straight back).
  window.addEventListener('pagehide', flushBackupSync);
}
