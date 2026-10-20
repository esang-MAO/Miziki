import { S } from '../state.js';
import { $, el } from '../util/dom.js';
import { ensureCrateModel } from '../crate/model.js';

/* ================= desktop shell: sidebar content (step D3,
   docs/DESKTOP_LAYOUT.md) =================
   The playlists list that the mockup's sidebar shows and the phone
   layout has never needed — new DOM, built every time renderTracks()
   runs (the same single "a playlist changed, redraw" call point every
   other playlist-touching module already lands on — library/view.js's
   own entry in CLAUDE.md spells out why) and hidden below the 1024px
   breakpoint entirely by CSS (src/styles/23-desktop.css), rather than by
   a JS breakpoint check — the DOM exists on every viewport, just
   invisible on a phone, the same way the tab bar's own buttons are
   shared between the phone tab bar and the desktop sidebar through pure
   CSS reflow. The Sundown summary card lives in src/player/clock.js's
   drawSun() instead (see that function's own comment) — it mirrors a
   readout drawSun() already computes, so it has no render function of
   its own here.
   Playlist names are user-typed, not a file's own embedded tag, but the
   same tag-injection rule applies to any text that isn't a literal in
   this codebase (CLAUDE.md's "Security" section) — built with
   textContent (via el()), never innerHTML. */
export function renderSidebarPlaylists(){
  const host = $('#sidebarPlaylists');
  if(!host) return;
  host.innerHTML = '';
  if(!S.playlists.length){
    host.appendChild(el('li', 'sidebar-playlists-empty', 'No playlists yet'));
    return;
  }
  // Favorites (and any other system playlist) pinned first — the same
  // order library/view.js's own playlist tab already uses, so the
  // sidebar list and the Playlists tab never disagree.
  const order = S.playlists.map((_, n) => n)
    .sort((a, b) => (S.playlists[a].system ? 0 : 1) - (S.playlists[b].system ? 0 : 1));
  for(const n of order){
    host.appendChild(el('li', 'sidebar-playlist-row', S.playlists[n].name));
  }
}

/* CR10 (docs/13_CRATE.md point 3): "a BINS list (New arrivals, Staff
   picks, Sealed, with counts) above PLAYLISTS; each jumps the crate."
   Built straight from the crate's own virtual-bin dividers (crate/model.js's
   buildVirtualBins(), already computed as part of ensureCrateModel() for
   the crate view itself) rather than a second count computed here --
   "reuse the readout, don't compute it twice," the same call this file's
   own renderSidebarPlaylists() and drawSun()'s sidebar mirrors already
   make. Each row is a plain button carrying the bin's own key in
   data-bin; the click -> jump-the-crate wiring lives in
   src/wiring/library-view.js (the module that already owns switching the
   library's own view mode), not here, so this stays a pure render like
   renderSidebarPlaylists() above. */
export function renderSidebarBins(){
  const host = $('#sidebarBins');
  if(!host) return;
  host.innerHTML = '';
  const model = ensureCrateModel();
  const bins = model.items.filter(it => it.type === 'div' && it.kind === 'bin');
  if(!bins.length){
    host.appendChild(el('li', 'sidebar-bins-empty', 'No bins yet'));
    return;
  }
  bins.forEach(bin => {
    const li = el('li');
    const btn = el('button', 'sidebar-bin-row');
    btn.dataset.bin = bin.key;
    btn.appendChild(el('span', 'sidebar-bin-label', bin.label));
    btn.appendChild(el('span', 'sidebar-bin-count', bin.meta));
    li.appendChild(btn);
    host.appendChild(li);
  });
}
