/* ================= wiring: library management =================
   The "Forget library" two-tap confirm button, and the
   clear-listening-history overlay. */
import { $ } from '../util/dom.js';
import { forgetLibrary } from '../library/delete.js';
import { clearListeningHistory } from '../history/clear.js';

export function wireLibraryManagement(){
  let armed = false, armTimer = null;
  $('#forget').addEventListener('click', async e => {
    if(!armed){
      armed = true; e.target.textContent = 'Tap again to forget';
      armTimer = setTimeout(()=>{ armed = false; e.target.textContent = 'Forget library'; }, 4000);
      return;
    }
    clearTimeout(armTimer); armed = false; e.target.textContent = 'Forget library';
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
