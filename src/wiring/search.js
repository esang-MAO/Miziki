/* ================= wiring: library search =================
   The library search field's own input/focus/blur handling and the
   header search icon/Cancel/× (S1 §2.1). */
import { $ } from '../util/dom.js';
import { renderTracks } from '../library/view.js';
import { updateSearchChipsVisibility } from '../library/search.js';
import { openSearchField } from '../shell/header.js';
import { closeLayer } from '../shell/nav-stack.js';

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
  // UN5 point 2: closeSearchField() (closeLayer's registered callback,
  // also reached from Escape via nav-stack) now does the clearing itself,
  // so Cancel is just the same close.
  $('#hdrSearchCancel').addEventListener('click', ()=>{
    closeLayer('search-field');
  });
  $('#hdrSearchClear').addEventListener('click', ()=>{
    $('#librarySearch').value = '';
    $('#hdrSearchClear').style.display = 'none';
    $('#librarySearch').focus();
    updateSearchChipsVisibility();
    renderTracks();
  });
}
