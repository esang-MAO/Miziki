import { S } from '../state.js';
import { $, el } from '../util/dom.js';

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
