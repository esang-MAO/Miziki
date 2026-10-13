/* D6 (docs/DESKTOP_LAYOUT.md): the desktop-only side panel beside the full
   player — Up next, Liner notes and Credits, per the mockup's three-tab
   split. None of the three render functions it calls are new: Up next is
   the existing queue sheet (player/queue.js), Liner notes and Credits are
   the existing album/track-liner-notes rendering (library/credits.js),
   each now parametrized to take a host instead of always writing into its
   own phone-overlay element — see each module's own entry for why. This
   file is just the "which tab is active, repaint it" glue the doc calls
   for ("the Up next... tabs call the same render functions the sheets
   use, targeted at the panel instead of an overlay").

   renderPlayerSidePanel() reads whichever tab #playerSideTabs currently
   marks aria-selected="true" (defaulting to "upnext" if somehow none is)
   and repaints only that one — called once per tab click (src/wiring/
   transport.js) and once per track change, from player/transport.js's
   load(), the same single choke point updateCreditsButtonForCurrent()/
   drawTime() already use for "something that must track current()." The
   panel is display:none below the 1024px breakpoint (src/styles/23-
   desktop.css), so painting it on every load() even on a phone is
   harmless — the same "build it anyway, CSS hides it" precedent D3's
   sidebar and D5's crate detail panel already established. */
import { current } from '../state.js';
import { $ } from '../util/dom.js';
import { albumKey } from '../record-art/tiers.js';
import { renderQueueSheet } from '../player/queue.js';
import { renderCreditsSheet, renderLinerNotes } from '../library/credits.js';

export function activePlayerSideTab(){
  const btn = document.querySelector('#playerSideTabs [aria-selected="true"]');
  return (btn && btn.dataset.panelTab) || 'upnext';
}

export function renderPlayerSidePanel(){
  const host = $('#playerSideBody');
  if(!host) return;
  const t = current();
  const tab = activePlayerSideTab();
  if(tab === 'liner') renderLinerNotes(host, t ? albumKey(t) : null);
  else if(tab === 'credits') renderCreditsSheet(t, host);
  else renderQueueSheet(host);
}
