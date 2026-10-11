/* ================= wiring: library management =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the "Forget
   library" two-tap confirm button, and the clear-listening-history
   overlay. Every function called here was already a real export of
   its owning module. */
import { $ } from '../util/dom.js';
import { forgetLibrary } from '../library/delete.js';
import { clearListeningHistory } from '../history/clear.js';

export function wireLibraryManagement(){
  let armed = false, armTimer = null;
  $('#forget').addEventListener('click', async e => {
    if(!armed){
      armed = true; e.target.textContent = 'TAP AGAIN';
      armTimer = setTimeout(()=>{ armed = false; e.target.textContent = 'FORGET'; }, 4000);
      return;
    }
    clearTimeout(armTimer); armed = false; e.target.textContent = 'FORGET';
    await forgetLibrary();
  });

  $('#clearHistoryBtn').addEventListener('click', ()=>{
    $('#clearHistoryOverlay').classList.add('open');
    $('#clearHistoryOverlay').setAttribute('aria-hidden', 'false');
  });
  const closeClearHistory = () => {
    $('#clearHistoryOverlay').classList.remove('open');
    $('#clearHistoryOverlay').setAttribute('aria-hidden', 'true');
  };
  $('#clearHistoryClose').addEventListener('click', closeClearHistory);
  $('#clearHistoryCancel').addEventListener('click', closeClearHistory);
  $('#clearOrphanedBtn').addEventListener('click', async ()=>{ closeClearHistory(); await clearListeningHistory(true); });
  $('#clearAllHistoryBtn').addEventListener('click', async ()=>{ closeClearHistory(); await clearListeningHistory(false); });
}
