import { S } from '../state.js';
import { el } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { REDUCED } from '../util/motion.js';
import { meta } from '../storage/repo.js';
import { renderTracks } from './view.js';
import { updateSealedSheetAfterBreak } from '../gatefold/sealed-sheet.js';

/* ================= S5: sealed records =================
   S.sealed is its own saved list, independent of S.albumLastPlayed/session
   history on purpose — "Clear listening history" must never reseal an
   album (SEALED spec §2). Grandfathering: no sealedAlbums row at all means
   this feature hasn't run here yet, so nothing existing is sealed. */
export async function restoreSealedAlbums(){
  const row = await meta.get('sealedAlbums');
  S.sealed = new Set(row && row.ids ? row.ids : []);
  // a durable "ever broken" record, independent of S.sealed itself (which
  // only ever records "still sealed") — the cross-device merge rule ("a
  // seal broken on any device stays broken everywhere") needs to tell
  // "broken" apart from "this device never had the album at all", which
  // S.sealed alone can't (see CLAUDE.md's sync table)
  const broken = await meta.get('sealedBrokenAlbums');
  S.sealedBroken = new Set(broken && broken.ids ? broken.ids : []);
}
export async function persistSealedAlbums(){ await meta.put('sealedAlbums', {init:true, ids:[...S.sealed]}); }
export async function persistBrokenSeals(){ await meta.put('sealedBrokenAlbums', {ids:[...S.sealedBroken]}); }

export function isAlbumSealed(albumId){ return S.sealedRecords && S.sealed.has(albumId); }

// "played" means playback began — no minimum duration, any track counts,
// and once removed an id can never be re-added except by a fresh import
// (SEALED spec §2, §6)
export function breakSeal(albumId){
  if(!S.sealed.has(albumId)) return;
  S.sealed.delete(albumId);
  S.sealedBroken.add(albumId);
  persistSealedAlbums();
  persistBrokenSeals();
  updateSealedSheetAfterBreak(albumId);
  renderTracks();
}

// CR6 (docs/13_CRATE.md): "SEALED · [date]", lower-left, on the film —
// short month/day, matching the mono-caps style every other crate label
// ("LAST SPUN TUE", etc.) already uses. No addedAt (a host that doesn't
// have one handy) still reads as a plain "SEALED" tag.
function sealedDateLabel(addedAt){
  if(!addedAt) return 'SEALED';
  const d = new Date(addedAt).toLocaleDateString(undefined, { month:'short', day:'numeric' });
  return 'SEALED · ' + d.toUpperCase();
}

// Breaking the seal (CR6, "Breaking the seal"): tear (380ms, the rest of
// the film staggered 60ms behind) -> lift (420ms) -> opened. Reduced
// motion: a 150ms fade. Either way this ends by calling the real
// breakSeal(albumId) — the choreography is purely visual on whichever DOM
// node is animating; breakSeal()'s own renderTracks() then takes over for
// real (a sealed card re-renders as a plain one, picking up the butter
// "NEW" tag on its own, same as it always has for a freshly-unsealed
// album -- see stickerFor()/buildStickerEl(), crate/view.js).
// exported for gatefold/sealed-sheet.js's own "Open" action
// (docs/15_SURFACE_NOISE.md §2, "Accessibility: ...an Open action in the
// record menu, to peel without the drag") — the same commit animation a
// drag past the tear-strip's own threshold already runs, triggered without
// requiring the drag itself.
export async function runBreakChoreography(wrap, strip, albumId){
  if(REDUCED){
    wrap.classList.add('seal-fading');
    await sleep(150);
    breakSeal(albumId);
    return;
  }
  strip.classList.add('seal-tearing');
  wrap.classList.add('seal-filming');
  await sleep(380);
  wrap.classList.add('seal-lifting');
  await sleep(420);
  breakSeal(albumId);
}

// CR6 point 4: "Dragging the tab leftward past 50% of the width breaks
// it; so does Play, as today." Only wired when a real albumId is given —
// the transient sleeve overlay during the start sequence (which decides
// sealed-or-not once, up front, and tears itself down on its own timeline
// the instant the ceremony's own peel runs) has no use for a second,
// independent way to break the same seal, so start-sequence.js's own call
// leaves albumId out and gets no listeners at all.
// A mouse's pointerup always synthesizes a trailing click a moment later,
// on whatever element ends up under the final cursor position, regardless
// of how far the pointer travelled first -- so a tear-strip drag that
// moved but sprang back (didn't cross the break threshold) would
// otherwise still fire a click that bubbles up to crate/view.js's own
// stage-level "tap the card" handler and pops the sealed sheet open as an
// unwanted side effect. Swallowed once, capture-phase on document (so it
// runs before that bubble-phase listener ever sees it), and self-removes
// either on that one click or after a short timeout if no click follows
// (e.g. a touch gesture, which doesn't always synthesize one the same way).
function suppressOneClick(){
  function swallow(e){ e.stopPropagation(); e.preventDefault(); cleanup(); }
  function cleanup(){ document.removeEventListener('click', swallow, true); clearTimeout(timer); }
  document.addEventListener('click', swallow, true);
  const timer = setTimeout(cleanup, 400);
}

function wireTearDrag(tab, wrap, strip, albumId){
  if(!albumId) return;
  let startX = 0, hostWidth = 0, dragging = false, committed = false, moved = false;
  tab.style.touchAction = 'none';
  tab.addEventListener('pointerdown', e => {
    // Stops this from ever reaching crate/view.js's own stage-level
    // pointerdown (CR5's pull/flip/hold gesture) -- that handler calls
    // stage.setPointerCapture() on the very same bubbling event, which
    // would otherwise steal the pointer away from this tab (whichever
    // element captures last wins) the instant this listener returns.
    // Same fix as the crate rail's own tick buttons use for the identical
    // problem (crate/view.js).
    e.stopPropagation();
    if(committed) return;
    dragging = true;
    moved = false;
    startX = e.clientX;
    hostWidth = wrap.getBoundingClientRect().width || 1;
    try{ tab.setPointerCapture(e.pointerId); }catch(_err){}
  });
  tab.addEventListener('pointermove', e => {
    if(!dragging || committed) return;
    e.preventDefault();
    const left = Math.min(0, e.clientX - startX);
    if(left < -3) moved = true;
    strip.style.transform = 'translateX(' + left + 'px)';
  });
  function release(e){
    if(!dragging) return;
    dragging = false;
    const left = Math.min(0, (e.clientX || startX) - startX);
    if(-left >= hostWidth * 0.5){
      committed = true;
      runBreakChoreography(wrap, strip, albumId);
    } else {
      strip.style.transform = '';
      if(moved) suppressOneClick();
    }
  }
  tab.addEventListener('pointerup', release);
  tab.addEventListener('pointercancel', () => { dragging = false; strip.style.transform = ''; });
}

// The film (CR6, "The film"): a 4% white milk over the cover, a specular
// band tinted 30% with the current phase colour (--phase-color, written
// by drawSun()), a film edge and one crease line -- plus the tear strip
// (bone, dashed perforation, a 44x30 pull tab) and the SEALED·[date] tag,
// lower-left, on the film. No orange "NEW" dot any more -- a freshly-
// unsealed album's own butter NEW chip (buildStickerEl(), crate/view.js)
// already covers that once the seal is actually broken. Shared by the
// crate card, the sealed sheet's small cover (64px, CR6 point 5) and the
// player's sleeve (SEALED spec §4) -- everything here is percentage-based
// except the tear strip/tab/tag, which the README gives literal px for
// (22px / 44x30 / etc.) at every host size alike.
export function buildSealOverlay(sizePx, albumId, addedAt){
  const frag = document.createDocumentFragment();
  const wrap = el('div','seal-wrap'); wrap.setAttribute('aria-hidden','true');
  wrap.appendChild(el('div','seal-film'));
  wrap.appendChild(el('div','seal-edge'));
  wrap.appendChild(el('div','seal-crease'));
  const tag = el('div','seal-date-tag', sealedDateLabel(addedAt));
  wrap.appendChild(tag);
  const strip = el('div','seal-strip');
  strip.appendChild(el('span','seal-strip-text','PULL TO OPEN ▸ ▸ ▸'));
  const tab = el('div','seal-strip-tab'); tab.setAttribute('aria-hidden','true');
  strip.appendChild(tab);
  wrap.appendChild(strip);
  // sizePx no longer drives anything directly -- every size here reads
  // straight off the host via CSS percentages/fixed px (per the README's
  // own literal values), not a computed font-size the way the old orange
  // sticker needed. Kept as a parameter so every call site below reads
  // the same as it always has.
  wireTearDrag(tab, wrap, strip, albumId);
  frag.appendChild(wrap);
  return frag;
}
