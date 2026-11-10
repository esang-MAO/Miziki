/* ================= the playlist name sheet =================
   36A decision 2 (docs/36A_LIBRARY_AND_LAUNCH.md, LB2): "Naming a
   playlist is a sheet, never the browser's window.prompt()." One sheet,
   used identically by New playlist, Save queue as playlist and (once a
   future step adds the row that opens it, see the PR body) Rename —
   same posture as duplicates-ui.js's openDuplicatesSheet(): built with
   sheetHeader()/.p-btn (UN2), registered with nav-stack so Back/Escape/
   tap-outside all close it the same way, and torn down into a resolved
   Promise rather than a callback, since every call site here just wants
   "the name, or null" and nothing else about how it closed.

   playlistNameCollides() is the one pure decision (unit-tested without a
   DOM, same "extract the pure core" shape as duplicates-logic.js). */
import { $, el } from '../util/dom.js';
import { openLayer, closeLayer } from '../shell/nav-stack.js';
import { sheetHeader } from '../ui/parts.js';

// Case-insensitive, trimmed -- no existing playlist-name dedup rule to
// follow (favorites.js's own `p.name === 'Favorites'` check is just how it
// finds the one system playlist, not a general uniqueness rule), so this is
// a judgment call: catches "Road trip" vs "road trip" as the same name a
// listener would read as a collision, flagged in the PR.
export function playlistNameCollides(name, existingNames = []){
  const trimmed = (name || '').trim().toLowerCase();
  if(!trimmed) return false;
  return existingNames.some(n => (n || '').trim().toLowerCase() === trimmed);
}

let resolveCb = null;
let resultName = null;

function teardown(){
  $('#playlistNameOverlay').classList.remove('open');
  $('#playlistNameOverlay').setAttribute('aria-hidden', 'true');
  const cb = resolveCb;
  resolveCb = null;
  if(cb) cb(resultName);
  resultName = null;
}

function updatePrimaryDisabled(input, primaryBtn){
  primaryBtn.disabled = !input.value.trim();
}

// openPlaylistNameSheet({title, initial, note, confirmLabel, existingNames})
// -> Promise<string|null>. `existingNames` (not in the addendum's own
// signature, but needed for the inline-collision refusal the spec asks
// for -- there's no other way this generic sheet could know what's
// already taken) defaults to none, so a call site that has nothing to
// check against (there isn't one today, but a future Rename could pass
// the playlist's other names, excluding its own current one) still works.
export function openPlaylistNameSheet({ title, initial = '', note, confirmLabel, existingNames = [] }){
  return new Promise(resolve => {
    resolveCb = resolve;
    resultName = null;

    const head = $('#plNameHead'); head.innerHTML = '';
    const built = sheetHeader(title);
    built.closeBtn.addEventListener('click', () => closeLayer('playlist-name'));
    head.appendChild(built);

    const body = $('#plNameBody'); body.innerHTML = '';
    const row = el('div', 'slider-row');
    // Same visual shape as every other .slider-head field (the Edit
    // track sheet's Title/Artist/Album rows) -- a <span>, since that's
    // what .slider-head span's own rule (16-edit-sheet.css) styles;
    // aria-label on the input itself carries the actual label semantics,
    // same posture as the Edit track sheet's own unlabelled fields.
    const fieldHead = el('div', 'slider-head');
    fieldHead.appendChild(el('span', null, 'Name'));
    row.appendChild(fieldHead);
    const input = el('input', 'pl-input');
    input.type = 'text';
    input.id = 'plNameInput';
    input.setAttribute('aria-label', 'Playlist name');
    input.value = initial;
    input.maxLength = 80;
    row.appendChild(input);
    body.appendChild(row);

    if(note) body.appendChild(el('p', 'note', note));
    // .warn (16-edit-sheet.css) is the app's one existing "this note is a
    // problem" treatment -- just `color:var(--danger)` over .note's own
    // sizing, so this needs no new CSS.
    const error = el('p', 'note warn');
    error.hidden = true;
    body.appendChild(error);

    const stack = el('div', 'stack');
    const primaryBtn = el('button', 'p-btn p-btn--primary', confirmLabel);
    primaryBtn.type = 'button';
    stack.appendChild(primaryBtn);
    body.appendChild(stack);

    const submit = () => {
      if(primaryBtn.disabled) return;
      const name = input.value.trim();
      if(playlistNameCollides(name, existingNames)){
        error.textContent = `You already have a playlist called ${name}.`;
        error.hidden = false;
        return;
      }
      resultName = name;
      closeLayer('playlist-name');
    };
    primaryBtn.addEventListener('click', submit);
    input.addEventListener('input', () => {
      error.hidden = true;
      updatePrimaryDisabled(input, primaryBtn);
    });
    input.addEventListener('keydown', e => { if(e.key === 'Enter') submit(); });
    updatePrimaryDisabled(input, primaryBtn);

    const overlay = $('#playlistNameOverlay');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    openLayer('playlist-name', teardown, { container: $('#playlistNameSheetBox') });
    // openLayer() already focuses the first focusable element in the
    // container (the close button); the field is what a listener actually
    // wants to type into first.
    input.focus({ preventScroll: true });
  });
}
