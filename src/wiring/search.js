/* ================= wiring: library search =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the library search
   field's own input/focus/blur handling and the header search icon/
   Cancel/× (S1 §2.1). Every function called here was already a real
   export of its owning module. */
import { $ } from '../util/dom.js';
import { renderTracks } from '../library/view.js';
import { updateSearchChipsVisibility } from '../library/search.js';
import { openSearchField, closeSearchField } from '../shell/header.js';

export function wireSearch(){
  let searchDebounce = null;
  $('#librarySearch').addEventListener('input', ()=>{
    updateSearchChipsVisibility();
    $('#hdrSearchClear').style.display = $('#librarySearch').value ? '' : 'none';
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderTracks, 120);
  });
  $('#librarySearch').addEventListener('focus', updateSearchChipsVisibility);
  $('#librarySearch').addEventListener('blur', ()=>{ setTimeout(updateSearchChipsVisibility, 120); });

  // header search icon / Cancel / × (S1 §2.1)
  $('#hdrSearchBtn').addEventListener('click', openSearchField);
  $('#hdrSearchCancel').addEventListener('click', ()=>{
    $('#librarySearch').value = '';
    $('#hdrSearchClear').style.display = 'none';
    closeSearchField();
    renderTracks();
  });
  $('#hdrSearchClear').addEventListener('click', ()=>{
    $('#librarySearch').value = '';
    $('#hdrSearchClear').style.display = 'none';
    $('#librarySearch').focus();
    updateSearchChipsVisibility();
    renderTracks();
  });
}
