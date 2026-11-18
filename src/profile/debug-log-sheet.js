// BD13 (docs/38_BEFORE_THE_DOMAIN.md): "Copy error log" -- a Settings row
// opening a small sheet that shows exactly the text a tap on Copy would
// copy (an error message can contain a file name, which is why the text
// is shown first rather than copied straight off the tap), reusing the
// generic edit-overlay sheet pattern src/profile/shelf-finish-sheet.js
// already follows.
import { $, el } from '../util/dom.js';
import { openLayer } from '../shell/nav-stack.js';
import { debugLogEntries, formatDebugLog, BUILD_ID } from '../util/debug-log.js';

function currentLogText(){
  const browser = (typeof navigator !== 'undefined' && navigator.userAgent) || 'unknown';
  return formatDebugLog(debugLogEntries(), { buildId: BUILD_ID, browser });
}

function renderDebugLogSheet(){
  const body = $('#debugLogBody');
  body.innerHTML = '';

  const text = currentLogText();
  const box = el('textarea', 'debug-log-text');
  box.readOnly = true;
  box.value = text;
  body.appendChild(box);

  const copyBtn = el('button', 'cta', 'Copy');
  const status = el('p', 'note debug-log-status');
  copyBtn.addEventListener('click', async () => {
    try{
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copied.';
    }catch(_e){
      // Clipboard access refused (or unavailable) -- select the text so
      // it can still be copied by hand, same as point 3 of this step.
      box.focus();
      box.select();
      status.textContent = 'Copy was blocked -- the text above is selected, so you can copy it by hand.';
    }
  });
  body.appendChild(copyBtn);
  body.appendChild(status);

  body.appendChild(el('p', 'note', 'Nothing here is ever sent anywhere by Miziki -- this only copies text to your own clipboard.'));
}

export function openDebugLogSheet(){
  renderDebugLogSheet();
  const overlay = $('#debugLogOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  openLayer('debug-log', closeDebugLogSheet, {container: overlay});
}

export function closeDebugLogSheet(){
  $('#debugLogOverlay').classList.remove('open');
  $('#debugLogOverlay').setAttribute('aria-hidden', 'true');
}
