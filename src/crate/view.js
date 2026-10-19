/* ================= crate view (opens from within the "S3" header) ==========
   Moved out of main.js (step 7c). This is crate-shelf rendering, not
   gatefold code — it only sat under the old "S3: gatefold album view"
   header because that's physically where it landed; the step 7 prompt
   itself flagged that header as covering more than just the gatefold.
   `renderCrate()`/`applyCrateMiniInset()`/`centerEmptyState()` are
   exported for `renderTracks()` (`src/library/view.js`, step 7d) and
   `src/shell/mini-player.js` (step 7b) to call; `openCrateAlbum()` is the
   crate's own entry point into the gatefold/sealed sheet (step 7e). */
import { S } from '../state.js';
import { $, el } from '../util/dom.js';
import { clamp } from '../util/math.js';
import { REDUCED } from '../util/motion.js';
import { isDesktopShell } from '../util/viewport.js';
import { CRATE_ORIGIN_Y, CRATE_PALETTE, CRATE_VISIBLE_A, CRATE_DPR, CRATE_DEPTH_SPREAD } from './constants.js';
import { flowPose, flowZIndex } from './geometry.js';
import { isAlbumSealed, buildSealOverlay } from '../library/sealed.js';
import { thumbURL } from '../library/thumbs.js';
import { setQueue } from '../player/queue.js';
import { queueSave } from '../storage/meta.js';
import { isLibraryRouteVisible } from '../shell/routes.js';
import { openAddMenu } from '../shell/header.js';
import { getCrateArtURL, prewarmCrateAnchorL } from './tiers.js';
import {
  ensureCrateModel, invalidateCrateModel, isNowPlayingAlbum, persistCrateAnchor,
  crateRailJumpTarget, libraryHasGenres,
} from './model.js';
import { resolveLastPlayedAlbum } from '../launch/intro.js';
import { renderTracks } from '../library/view.js';
import { openGatefold, buildGatefoldTracklist, gatefoldTrackIndices, gatefoldSocialControlsHTML } from '../gatefold/view.js';
import { openSealedSheet, sealedQuietPlay } from '../gatefold/sealed-sheet.js';
import { openCreditsSheet } from '../library/credits.js';

// D5 (docs/DESKTOP_LAYOUT.md): flowPose()'s own pixel offsets (170, 34, 70…)
// were tuned against this exact card edge length — reading the live
// --crate-card-size (src/styles/10-crate.css, overridden larger at
// 1024px+ by src/styles/23-desktop.css) and scaling flowPose()'s existing
// opts.spread lever by the ratio keeps a bigger desktop card from
// overlapping its neighbours any more tightly than this baseline already
// does on a phone — no change needed to flowPose() itself, since spread
// already exists for exactly this (launch/intro.js's own flourish already
// uses it the same way).
const BASE_CRATE_CARD_SIZE = 278;
function currentCardSize(){
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--crate-card-size'));
  return (v > 0) ? v : BASE_CRATE_CARD_SIZE;
}

function openCrateAlbum(item){
  const v = S.view;
  if(item.kind === 'loose'){
    v.mode = 'crateLoose'; v.crateLooseArtist = item.artist; v.crateLooseIdx = item.idx.slice();
    v.group = null; v.playlist = null; v.person = null; v.artistAlbum = null;
    renderTracks();
    return;
  }
  // a sealed record can't be opened — the gatefold and its left panel only
  // unlock after the first play (SEALED spec §1, §5). Unchanged on desktop
  // too, per the doc's own instruction — a sealed record still opens the
  // sealed sheet there, same as on a phone.
  if(isAlbumSealed(item.albumId)){ openSealedSheet(item); return; }
  // D5 (docs/DESKTOP_LAYOUT.md): on desktop, tapping a record shows its
  // tracklist in the panel beside the crate instead of opening the
  // gatefold overlay — the gatefold stays the phone's own way in,
  // untouched just below. The panel only exists alongside the real 3D
  // crate stage (renderCrate()'s own layout build); prefers-reduced-motion
  // falls back to renderCrateFlat(), which never builds it (a real,
  // pre-existing gap found during a design-layout review pass, not touched
  // by D5 itself) — checking for the panel here, rather than assuming
  // isDesktopShell() alone is enough, keeps a reduced-motion desktop user
  // from a silent no-op tap and falls back to the one other way in that
  // already works everywhere: the gatefold.
  if(isDesktopShell() && $('#crateDetailPanel')){ renderCrateDetailPanel(item); return; }
  // the gatefold is an overlay on top of the still-rendered crate (GATEFOLD
  // spec §A1) — nothing about S.view/S.crate changes, so closing it needs no
  // navigation back, it's simply still there
  openGatefold(item);
}

// D5 (docs/DESKTOP_LAYOUT.md): the right-hand panel's own two states —
// nothing opened yet, and a record's own tracklist, reusing
// buildGatefoldTracklist()/gatefoldTrackIndices() (gatefold/view.js) so
// the row styling, side-splitting and now-playing marker are identical to
// the phone's own gatefold rather than a second implementation. D5's own
// "first cut" trimmed this down to just the art/Play/tracklist, deferring
// Credits and the gatefold's own rating/sleeve-note controls for later —
// a design-layout review pass (reading the original Oct 13 mockup, which
// shows both) added them back here the same way: a Credits button that
// opens the existing overlay sheet (openCreditsSheet(), library/credits.js)
// for this album rather than whatever's currently playing, and the
// gatefold's own gatefoldSocialControlsHTML() (now exported) appended
// after the tracklist, unchanged — same function, new container. Liner
// notes still aren't reproduced here; the mockup's own panel doesn't show
// them either, only a sleeve note.
function renderCrateDetailPlaceholder(panel){
  panel.innerHTML = '';
  panel.appendChild(el('p','note','Tap a record to see its track list.'));
}

function renderCrateDetailPanel(item){
  const panel = $('#crateDetailPanel');
  if(!panel) return;
  panel.innerHTML = '';
  const art = thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art);
  if(art){
    const im = document.createElement('img');
    im.className = 'crate-detail-art';
    im.src = art; im.alt = '';
    panel.appendChild(im);
  }
  // .cta/.cta.ghost (src/styles/16-edit-sheet.css) rather than .tbtn —
  // .tbtn is the transport row's own 44px circular button, never meant to
  // hold a multi-word label; "▶ Play album" inside one wrapped onto two
  // lines (found during a design-layout review pass against the original
  // mockup, which shows a normal pill button here, the same shape the
  // player's own "Edit info"/"Share" row already uses).
  const actions = el('div','stack crate-detail-actions');
  const playBtn = el('button','cta crate-detail-play','▶ Play album');
  playBtn.setAttribute('aria-label','Play ' + item.album);
  playBtn.addEventListener('click', () => setQueue(item.idx, 0, true));
  actions.appendChild(playBtn);
  const creditsBtn = el('button','cta ghost','Credits');
  creditsBtn.setAttribute('aria-label','Credits for ' + item.album);
  creditsBtn.addEventListener('click', () => { const t = S.tracks[item.idx[0]]; if(t) openCreditsSheet(t); });
  actions.appendChild(creditsBtn);
  panel.appendChild(actions);
  const trackIdx = gatefoldTrackIndices(item);
  const list = el('div','crate-detail-tracklist');
  list.setAttribute('role','list');
  list.appendChild(buildGatefoldTracklist(item, trackIdx, (idx, i) => setQueue(idx, idx.indexOf(i), true)));
  panel.appendChild(list);
  panel.appendChild(gatefoldSocialControlsHTML(item));
}

function updateCrateGroupToggleUI(){
  const hasGenres = libraryHasGenres();
  if(!hasGenres && S.crateGroup === 'genre'){ S.crateGroup = 'az'; invalidateCrateModel(); queueSave(); }
  // RF8 (docs/12_REFINE.md): one home for this control. It used to have
  // two — a Profile › Library tools copy (#crateGroupToggle) shown on
  // every platform, plus this tab-row copy (#crateGroupToggleTab) shown
  // desktop-only — RF8 removed the first and made this one the only
  // home, so it now shows on every platform rather than being gated on
  // isDesktopShell(). renderTracks() already hides it by default on
  // every render; this is the one place (crate mode's own re-render
  // hook) that turns it back on. A bare window resize across the old
  // desktop breakpoint isn't separately handled, but that gating is gone
  // now anyway.
  const tabToggle = $('#crateGroupToggleTab');
  if(tabToggle){
    tabToggle.style.display = 'flex';
    $('#crateGenreBtnTab').style.display = hasGenres ? '' : 'none';
    document.querySelectorAll('#crateGroupToggleTab [data-group]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.group === S.crateGroup)));
  }
}

// flat, non-3D fallback for prefers-reduced-motion: a plain scrollable list,
// snap-scroll instead of momentum, cross-fade instead of the pull-to-camera
// (CRATE spec §6)
function renderCrateFlat(host, model){
  updateCrateGroupToggleUI();
  const list = el('div','crate-flat-list');
  list.setAttribute('role','listbox');
  list.setAttribute('aria-label','Crate');
  model.items.forEach(item => {
    if(item.type === 'div'){
      list.appendChild(el('div','crate-flat-divider', item.label + ' — ' + item.meta));
      return;
    }
    const row = el('div','crate-flat-item');
    row.setAttribute('role','option');
    if(isNowPlayingAlbum(item)) row.classList.add('crate-flat-current');
    const sealed = isAlbumSealed(item.albumId);
    const art = thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art);
    if(art){
      // NV6 (docs/11_SMOOTH_NAVIGATION.md): this is a plain scrolling list
      // of thumbnails (the reduced-motion fallback crate), the same "list
      // thumbnail" case library/view.js's songRow/groupRow already cover —
      // lazy/async plus the fixed size .crate-flat-item img already has in
      // CSS (10-crate.css, 56x56). The animated 3D crate stage just below
      // this function is a different, bounded-count case and is untouched.
      const im = document.createElement('img');
      im.src = art; im.alt = '';
      im.loading = 'lazy'; im.decoding = 'async';
      im.width = 56; im.height = 56;
      row.appendChild(im);
    }
    else { const flat = el('span','crate-flat-flat'); flat.style.background = CRATE_PALETTE[row.childElementCount % CRATE_PALETTE.length]; row.appendChild(flat); }
    const text = el('span','t-name');
    const titleEl = el('b', null, item.album);
    if(sealed) titleEl.appendChild(el('span','new-tag','NEW'));
    text.appendChild(titleEl);
    text.appendChild(el('em', null, item.artist + ' · ' + item.trackCount + (item.trackCount===1?' track':' tracks')));
    row.appendChild(text);
    const playBtn = el('button','t-edit','▶');
    playBtn.setAttribute('aria-label','Play ' + item.album);
    playBtn.addEventListener('click', e => {
      e.stopPropagation();
      if(sealed){ sealedQuietPlay(item.idx, item.idx[0]); } else setQueue(item.idx, 0, true);
    });
    row.appendChild(playBtn);
    row.addEventListener('click', () => {
      persistCrateAnchor(item);
      const host2 = $('#libBody');
      host2.style.transition = 'opacity 150ms ease'; host2.style.opacity = '0';
      setTimeout(() => { openCrateAlbum(item); $('#libBody').style.opacity = '1'; }, 150);
    });
    list.appendChild(row);
  });
  host.appendChild(list);
}

// the stage is a fixed height regardless of viewport, so on a short screen
// it (plus the info panel below it) can run into the (fixed-position) mini
// player — shrink the stage by however much the mini player + tabbar
// actually take up, rather than overlapping them (CRATE spec addendum,
// "Mini player"). Fewer distant neighbours show on a short screen; the
// centre record and info panel are unaffected. Called at mount time and
// again from updateChromeInset() whenever the mini player's own visibility
// changes later, since that happens after the crate has already rendered.
export function applyCrateMiniInset(){
  const stage = document.querySelector('.crate-stage'), info = document.querySelector('.crate-info');
  const wrap = document.querySelector('.crate-wrap');
  if(!stage || !wrap) return;
  const miniEl = $('#miniPlayer'), tabbarEl = $('#tabbar');
  const miniH = (miniEl && getComputedStyle(miniEl).display !== 'none') ? miniEl.getBoundingClientRect().height : 0;
  // D3 (docs/DESKTOP_LAYOUT.md): same reasoning as updateChromeInset()'s
  // own guard (src/shell/mini-player.js) — on desktop the tab bar is a
  // full-height vertical sidebar, not bottom chrome, so its height has
  // nothing to do with this budget. Full desktop crate sizing is D5's
  // job; this is strictly "don't let the sidebar's own height break the
  // pre-existing phone-layout math" ahead of that.
  const tabbarH = (tabbarEl && !isDesktopShell()) ? tabbarEl.getBoundingClientRect().height : 0;
  const infoReserve = info ? info.getBoundingClientRect().height : 84;
  // CR1 (docs/13_CRATE.md): the header row (record-count/group label, plus
  // the now-playing indicator on the same line) always occupies its own
  // line above the stage now, unlike the old standalone .crate-topbar pill
  // that only took up space while actually shown — its height has to come
  // out of this same budget every render, not just conditionally.
  const headerEl = document.querySelector('.crate-header');
  const headerReserve = headerEl
    ? headerEl.getBoundingClientRect().height + (parseFloat(getComputedStyle(headerEl).marginBottom) || 0)
    : 0;
  const wrapTop = wrap.getBoundingClientRect().top;
  // .wrap itself already reserves tabbarH + miniH + 16px as its own
  // bottom padding (--chrome-inset, set by updateChromeInset() for every
  // route so a normally-scrolling list's last item doesn't hide under the
  // fixed tabbar/mini player) — that padding lands right after this route's
  // content regardless of what's inside it, stacking on top of whatever
  // margin this function leaves. 28 here, not just the 16 that padding
  // already covers, so after .crate-info's own 12px margin-top cancels
  // part of it, the two reservations land flush with zero net overflow —
  // verified against the actual rendered page height, not just by eye.
  const available = window.innerHeight - wrapTop - miniH - tabbarH - infoReserve - headerReserve - 28;
  // the stage always claims all available room instead of capping and
  // banking the rest as dead space below the info panel — the info panel
  // sits flush just above the mini player, and the crate itself (the thing
  // people are actually here to flip through) gets whatever room that frees up.
  // Crucially this must never be pushed ABOVE "available": on a short
  // screen that would make the stage (plus the info panel still sitting
  // right below it) taller than the room between the header and the fixed
  // mini player/tabbar, overflowing the route and forcing the whole PAGE
  // to scroll — the one thing this layout exists to prevent. A previous
  // version enforced a floor here so the focal card wouldn't clip too much
  // against the stage's own overflow:hidden; that floor could exceed
  // "available" and is exactly what caused the page-scroll regression, so
  // on a truly cramped screen the card clips a little more instead.
  const stageHeight = Math.max(0, available);
  stage.style.height = stageHeight + 'px';
  // the rail is a sibling of the stage, absolutely positioned against
  // .crate-wrap rather than sized to the stage — it used to be a hardcoded
  // 440px (left over from when the stage itself was a fixed height) and
  // didn't shrink along with a dynamic stage, so on a short screen it could
  // poke out well past the stage's own bottom edge and inflate the page's
  // scrollable height even once the stage/info math above was correct.
  // Keep it inset the same 10px top and bottom as the stage always has.
  const railEl = document.querySelector('.crate-rail');
  if(railEl) railEl.style.height = Math.max(0, stageHeight - 20) + 'px';
}

export function renderCrate(host){
  const model = ensureCrateModel();
  // CR1 (docs/13_CRATE.md): an empty bin reads as a bin with nothing in it
  // yet, not a bare caption — the same lip the populated bin shows, under
  // a cream "Fill the crate" card wired straight to the header's own
  // Add-songs menu (src/shell/header.js's openAddMenu(), the same one
  // #hdrAddBtn opens — src/wiring/import.js). In today's app this branch
  // is never actually reached on a genuinely empty library: library/view.
  // js's renderTracks() shows the shared app-wide #empty screen (its own
  // "No music loaded yet" + Choose files/folder/test tone card) before it
  // would ever call renderCrate() at all, and buildCrateRecords() (crate/
  // model.js) always yields at least one record from a non-empty S.tracks
  // — so model.items can only be empty alongside an empty library, which
  // never gets this far. Kept correct anyway, for whenever it is reached
  // (a future caller, a test) and because it's what the design doc
  // describes for an empty bin — worth Ken's call on whether a future PR
  // should route the shared #empty screen through this instead when the
  // crate layout is the active one, rather than something decided here.
  if(!model.items.length){
    const empty = el('div','crate-wrap crate-empty');
    const stage = el('div','crate-stage');
    stage.appendChild(el('div','crate-lip'));
    empty.appendChild(stage);
    const card = el('div','crate-empty-card');
    card.appendChild(el('p','crate-empty-title','Fill the crate'));
    card.appendChild(el('p','crate-empty-sub','No albums to show yet.'));
    const addBtn = el('button','cta','+ Add songs');
    addBtn.addEventListener('click', () => openAddMenu());
    card.appendChild(addBtn);
    empty.appendChild(card);
    host.appendChild(empty);
    return;
  }
  updateCrateGroupToggleUI();
  if(REDUCED){ renderCrateFlat(host, model); return; }

  let startPos = S.crate.pos;
  if(startPos == null || isNaN(startPos) || startPos < 0 || startPos >= model.items.length){
    // cold start: the last-played album wins, falling back to the saved
    // anchor, then the first record. After this first resolution, the
    // (continuously updated) anchor takes over on any later rebuild
    // (CRATE spec addendum, "Cold-start anchor")
    const lastPlayedId = !S.crate.coldStartDone ? resolveLastPlayedAlbum() : null;
    if(lastPlayedId && model.byAlbumId.has(lastPlayedId)) startPos = model.byAlbumId.get(lastPlayedId);
    else if(S.crateAnchor && model.byAlbumId.has(S.crateAnchor)) startPos = model.byAlbumId.get(S.crateAnchor);
    else startPos = model.items.findIndex(it => it.type === 'rec');
    if(startPos < 0) startPos = 0;
    S.crate.coldStartDone = true;
  }
  S.crate.pos = startPos;

  // resolved once per render — the playing album can't change while the
  // user is actively scrubbing the stage, so this doesn't need to be
  // recomputed every frame (CRATE spec §4, "Now playing")
  const nowPlayingIdx = model.items.findIndex(isNowPlayingAlbum);

  // D5 (docs/DESKTOP_LAYOUT.md): read once per render, not per frame — the
  // card's own CSS size only ever changes on a breakpoint crossing (see
  // currentCardSize()'s own comment for why a bare resize isn't separately
  // re-synced), the same assumption applyCrateMiniInset()'s own measurements
  // already make about .crate-stage's rendered width/height.
  const cardSize = currentCardSize();
  // CR1 (docs/13_CRATE.md): CRATE_DEPTH_SPREAD is crate-only — folded in
  // here, after the D5 desktop-card-size ratio, rather than into
  // flowPose() itself, so the launch intro's own call (which never reads
  // this constant) is untouched. See constants.js's own comment for why
  // this value, combined with CRATE_ORIGIN_Y and the taller --crate-stage-h,
  // is what keeps six receding record tops inside the stage instead of
  // clipped by its overflow:hidden.
  const cardSpread = (cardSize / BASE_CRATE_CARD_SIZE) * CRATE_DEPTH_SPREAD;

  const wrap = el('div','crate-wrap');
  // CR1 (docs/13_CRATE.md): a header row rather than the now-playing chip
  // sitting alone above the stage — a left label naming how many records
  // are in the bin and how it's grouped, and the (restyled) now-playing
  // indicator on the right, as plain phase-coloured text rather than a
  // bordered pill.
  const header = el('div','crate-header');
  const recordCount = model.items.filter(it => it.type === 'rec').length;
  const headerLeft = el('div','crate-header-left',
    recordCount + (recordCount === 1 ? ' RECORD' : ' RECORDS') + ' · ' + (model.group === 'genre' ? 'GENRE' : 'A–Z'));
  const nowPlayingBtn = el('button','crate-topbar');
  nowPlayingBtn.setAttribute('aria-label','Scroll to the album that is now playing');
  nowPlayingBtn.addEventListener('click', () => { if(nowPlayingIdx >= 0) snapTo(nowPlayingIdx); });
  header.appendChild(headerLeft); header.appendChild(nowPlayingBtn);
  const stage = el('div','crate-stage');
  stage.tabIndex = 0;
  stage.setAttribute('role','listbox');
  stage.setAttribute('aria-label','Crate');
  const live = el('div','sr-only'); live.id = 'crateLive'; live.setAttribute('aria-live','polite');
  stage.appendChild(live);
  // CR1: the bin's own cardboard lip at the stage's bottom edge, tagged
  // with whichever divider the centred record currently falls under (or,
  // in an ungrouped bin, the overall record count) — kept in sync from
  // syncCards() via updateLip() below, the same "recompute on position
  // change" shape updateRailUI()/updateNowPlayingTopBar() already use.
  const lip = el('div','crate-lip');
  const lipTag = el('div','crate-lip-tag');
  lip.appendChild(lipTag);
  stage.appendChild(lip);
  const rail = el('div','crate-rail');
  const info = el('div','crate-info');
  wrap.appendChild(header); wrap.appendChild(stage); wrap.appendChild(rail); wrap.appendChild(info);

  // D5 (docs/DESKTOP_LAYOUT.md): the inline record-detail panel beside the
  // crate — a new sibling of .crate-wrap, not a child of it, so .crate-wrap
  // itself (and every selector/measurement above that already assumes it's
  // host's own direct child, e.g. applyCrateMiniInset()'s .crate-wrap
  // lookup) is completely untouched. Invisible scaffolding below 1024px
  // (src/styles/23-desktop.css's .crate-layout{display:contents}), the
  // same pattern D3's own sidebar wrapper already established, so the
  // phone layout stays byte-for-byte what it was before this PR.
  const layout = el('div','crate-layout');
  const detailPanel = el('div','crate-detail-panel');
  detailPanel.id = 'crateDetailPanel';
  renderCrateDetailPlaceholder(detailPanel);
  layout.appendChild(wrap);
  layout.appendChild(detailPanel);
  host.appendChild(layout);

  applyCrateMiniInset();

  const pool = new Map();      // item index -> element, only the visible window
  let animToken = 0, rafHandle = null;
  const cancelAnim = () => { animToken++; if(rafHandle){ cancelAnimationFrame(rafHandle); rafHandle = null; } };

  function itemAt(i){ return model.items[i]; }

  function makeCardEl(i){
    const item = itemAt(i);
    const card = document.createElement('div');
    card.className = 'crate-card';
    if(item.type === 'div'){
      const d = document.createElement('div'); d.className = 'crate-divider';
      const tab = document.createElement('div'); tab.className = 'crate-divider-tab'; tab.textContent = item.label;
      const label = document.createElement('div'); label.className = 'crate-divider-label'; label.textContent = item.label;
      const meta = document.createElement('div'); meta.className = 'crate-divider-meta'; meta.textContent = item.meta;
      d.appendChild(tab); d.appendChild(label); d.appendChild(meta);
      card.appendChild(d);
    } else {
      const face = document.createElement('div'); face.className = 'crate-card-face';
      face.style.background = CRATE_PALETTE[i % CRATE_PALETTE.length];
      card.appendChild(face);
      if(isNowPlayingAlbum(item)){
        const dot = document.createElement('div'); dot.className = 'crate-now-dot'; card.appendChild(dot);
      }
      if(isAlbumSealed(item.albumId)) card.appendChild(buildSealOverlay(cardSize));
    }
    return card;
  }
  // S tier for the pool (spec §B2); falls back to the existing album
  // thumbnail, then the first track's own art, while the tier builds
  function setCardImage(i, card){
    const item = itemAt(i);
    if(item.type !== 'rec') return;
    const face = card.querySelector('.crate-card-face');
    if(!face || face.querySelector('img') || card.dataset.artPending) return;
    card.dataset.artPending = '1';
    getCrateArtURL(item.albumId, 'S').then(tierUrl => {
      delete card.dataset.artPending;
      if(pool.get(i) !== card) return;        // recycled while the lookup was in flight
      if(face.querySelector('img')) return;
      const art = tierUrl || thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art);
      if(!art) return;
      const img = document.createElement('img');
      img.decoding = 'async'; img.alt = '';
      face.appendChild(img);
      img.src = art;
    });
  }
  function clearCardImage(card){ const img = card.querySelector('img'); if(img) img.remove(); delete card.dataset.artPending; }

  // 200ms after the stack settles, quietly decode and swap the centre
  // record's S image for the L tier — sharper at rest, nothing visibly
  // changes but the crispness (spec §B4, "swap S to L at rest")
  let largeSwapTimer = null;
  function scheduleLargeSwap(){
    clearTimeout(largeSwapTimer);
    largeSwapTimer = setTimeout(async () => {
      const idx = Math.round(S.crate.pos);
      const item = itemAt(idx);
      const card = pool.get(idx);
      if(!item || item.type !== 'rec' || !card) return;
      const url = await getCrateArtURL(item.albumId, 'L');
      if(!url || Math.round(S.crate.pos) !== idx || pool.get(idx) !== card) return;
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      try{ await img.decode(); }catch(_e){ return; }
      if(Math.round(S.crate.pos) !== idx || pool.get(idx) !== card) return;
      const face = card.querySelector('.crate-card-face');
      const liveImg = face && face.querySelector('img');
      if(liveImg) liveImg.src = url; else if(face){ img.alt = ''; face.appendChild(img); }
    }, 200);
  }

  // the info panel's rendered height isn't constant while scrolling: a
  // divider item renders shorter (no play-button row) than a record, and a
  // long album/artist name can wrap to an extra line. applyCrateMiniInset
  // sized the stage against whatever the info panel measured at mount (or
  // the last topbar toggle) — if the real height grows past that while
  // scrolling, the stage doesn't shrink to compensate, and the taller info
  // panel gets pushed down behind the (fixed-position) mini player.
  // Re-measured after every updateInfoPanel call below, and only when it
  // actually changed, so this doesn't force a layout pass every frame.
  let lastInfoH = null;
  function syncInfoReserve(){
    const h = info.getBoundingClientRect().height;
    if(h !== lastInfoH){ lastInfoH = h; applyCrateMiniInset(); }
  }

  // a chip above the stage for when the playing album has been scrolled
  // away from — tapping it scrolls back (CRATE spec §4, "Now playing")
  let topbarShown = false;
  function updateNowPlayingTopBar(position){
    const shouldShow = nowPlayingIdx >= 0 && Math.round(position) !== nowPlayingIdx;
    const changed = shouldShow !== topbarShown;
    topbarShown = shouldShow;
    if(shouldShow){
      const item = itemAt(nowPlayingIdx);
      nowPlayingBtn.textContent = '● Now playing — ' + item.album;
      nowPlayingBtn.classList.add('show');
    } else {
      nowPlayingBtn.classList.remove('show');
    }
    // CR1 (docs/13_CRATE.md): now that this indicator lives inline inside
    // the always-visible .crate-header row rather than as its own
    // standalone pill, showing/hiding it no longer changes the header's
    // own height (headerReserve, applyCrateMiniInset()) — recomputing here
    // is now a harmless no-op rather than the real fix it used to be, kept
    // anyway in case a future change (e.g. the text wrapping to a second
    // line on a narrow screen) makes it matter again.
    if(changed) applyCrateMiniInset();
  }

  function updateInfoPanel(idx){
    const item = itemAt(idx);
    info.innerHTML = '';
    if(!item) return;
    if(item.type === 'div'){
      info.appendChild(el('h3', null, item.label));
      info.appendChild(el('p','crate-info-sub', item.panelSub || ''));
      info.appendChild(el('p','crate-info-meta', item.meta));
      return;
    }
    const sealed = isAlbumSealed(item.albumId);
    const row = el('div','crate-info-row');
    const text = el('div');
    const h3 = el('h3', null, item.album);
    if(isNowPlayingAlbum(item)) h3.appendChild(el('span','crate-now-chip','● Now playing'));
    text.appendChild(h3);
    text.appendChild(el('p','crate-info-sub', item.artist));
    const metaBits = [item.genre || null, item.year || null,
      item.trackCount + (item.trackCount === 1 ? ' track' : ' tracks')].filter(Boolean);
    text.appendChild(el('p','crate-info-meta', metaBits.join(' · ').toUpperCase()));
    if(sealed){
      text.appendChild(el('span','seal-tag','SEALED'));
      text.appendChild(el('span','sr-only','Sealed, not played yet'));
    }
    row.appendChild(text);
    const playBtn = el('button','tbtn play','▶');
    playBtn.setAttribute('aria-label','Play ' + item.album);
    // a sealed album plays quietly from track 1, same first-play rules as
    // the sealed sheet — no sheet/overlay opens from here either (§5)
    playBtn.addEventListener('click', e => {
      e.stopPropagation();
      if(sealed){ sealedQuietPlay(item.idx, item.idx[0]); } else setQueue(item.idx, 0, true);
    });
    row.appendChild(playBtn);
    info.appendChild(row);
  }

  function updateRailUI(position){
    const entries = model.railEntries;
    rail.innerHTML = '';
    if(!entries.length) return;
    // ticks spread across the rail's own current height (kept in sync with
    // the dynamic stage by applyCrateMiniInset), not a number tuned to the
    // old fixed-height stage — otherwise they'd run off the bottom of a
    // shorter rail instead of spanning it
    const h = Math.max(0, rail.getBoundingClientRect().height - 20);
    entries.forEach((e_, k) => {
      const t = entries.length > 1 ? k / (entries.length - 1) : 0;
      const tick = el('button','crate-rail-item' + (e_.present ? '' : ' crate-rail-dim'), e_.label);
      tick.style.top = (t * h) + 'px';
      tick.disabled = !e_.present;
      if(e_.present){
        const target = crateRailJumpTarget(model, e_.key);
        if(target != null && Math.abs(position - target) < 2) tick.classList.add('crate-rail-current');
        tick.addEventListener('pointerdown', ev => { ev.stopPropagation(); });
        tick.addEventListener('click', ev => { ev.stopPropagation(); snapTo(target); });
      }
      rail.appendChild(tick);
    });
  }

  // CR1: finds the divider item nearest at-or-before the given item index,
  // walking backward through the already-ordered model.items array (cheap —
  // a crate's own divider count is small, and this only runs once per
  // position change via syncCards(), not per frame). Falls back to the
  // whole-bin count when there's no divider yet (an ungrouped bin, e.g.
  // fewer than 20 records — crate/model.js's own showDividers gate).
  function nearestDividerBefore(itemIdx){
    for(let i = Math.min(itemIdx, model.items.length - 1); i >= 0; i--){
      if(model.items[i].type === 'div') return model.items[i];
    }
    return null;
  }
  let lastLipKey = null;
  function updateLip(position){
    const idx = Math.round(position);
    const div = nearestDividerBefore(idx);
    const key = div ? div.label : '*all*';
    if(key === lastLipKey) return;
    lastLipKey = key;
    if(div){ lipTag.textContent = div.label + ' — ' + div.meta; }
    else { lipTag.textContent = recordCount + (recordCount === 1 ? ' RECORD' : ' RECORDS'); }
  }

  function announceCurrent(){
    const item = itemAt(Math.round(S.crate.pos));
    if(!item) return;
    live.textContent = item.type === 'div' ? ('Divider ' + item.label + ', ' + item.meta.toLowerCase())
      : (item.album + ', ' + item.artist + ', ' + item.trackCount + (item.trackCount===1?' track':' tracks'));
  }

  // will-change only while the stack is actually moving, dropped 150ms
  // after the last moving frame (spec §B4, "promote only while moving")
  let moveClassTimer = null;
  function applyMovingClass(speed){
    if(speed > 0.02){
      clearTimeout(moveClassTimer); moveClassTimer = null;
      pool.forEach(card => card.classList.add('crate-moving'));
    } else if(moveClassTimer == null){
      moveClassTimer = setTimeout(() => { pool.forEach(card => card.classList.remove('crate-moving')); moveClassTimer = null; }, 150);
    }
  }

  function syncCards(position, speed){
    const lo = Math.max(0, Math.floor(position) - CRATE_VISIBLE_A), hi = Math.min(model.items.length - 1, Math.ceil(position) + CRATE_VISIBLE_A);
    for(const i of Array.from(pool.keys())) if(i < lo || i > hi){ pool.get(i).remove(); pool.delete(i); }
    for(let i = lo; i <= hi; i++) if(!pool.has(i)){ const c = makeCardEl(i); stage.appendChild(c); pool.set(i, c); }
    pool.forEach((card, i) => {
      const d = i - position, a = Math.abs(d);
      const pose = flowPose(a, d, speed, {originY: CRATE_ORIGIN_Y, spread: cardSpread});
      // integer device pixels so edges don't smear at rest (spec §B4)
      const y = Math.round(pose.y * CRATE_DPR) / CRATE_DPR;
      card.style.transform = 'translateY(' + y.toFixed(2) + 'px) translateZ(' + pose.z.toFixed(1) + 'px) '
        + 'rotateX(' + pose.rotX.toFixed(2) + 'deg) scale(' + pose.scale.toFixed(3) + ')';
      card.style.opacity = pose.opacity;
      card.style.zIndex = flowZIndex(a);
      card.classList.toggle('crate-current', a < 0.02);
      if(a <= 2 && speed < 0.5) setCardImage(i, card);
      else if(a > 2) clearCardImage(card);
    });
    applyMovingClass(speed);
    updateInfoPanel(Math.round(position));
    syncInfoReserve();
    updateRailUI(position);
    updateNowPlayingTopBar(position);
    updateLip(position);
  }
  function draw(speed){ syncCards(S.crate.pos, speed); }

  function onSettled(){
    const item = itemAt(Math.round(S.crate.pos));
    if(item && item.type === 'rec') persistCrateAnchor(item);
    announceCurrent();
    scheduleLargeSwap();
  }

  // the animation loop is draw-on-demand: paused outright (not just slowed)
  // whenever the library route isn't visible or the page is hidden — the
  // next interaction (or a resize/visibility change) picks up normally,
  // so a stalled frame never leaves the pose stuck mid-animation
  function pausedNow(){ return document.hidden || !isLibraryRouteVisible(); }

  function snapTo(target, ms){
    cancelAnim();
    const token = ++animToken;
    target = clamp(Math.round(target), 0, model.items.length - 1);
    const start = S.crate.pos, startTime = performance.now(), dur = ms || 250;
    function step(now){
      if(token !== animToken) return;
      if(pausedNow()){ S.crate.pos = target; draw(0); onSettled(); return; }
      const p = clamp((now - startTime) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      S.crate.pos = start + (target - start) * eased;
      draw((1 - p) * 0.35);
      if(p < 1){ rafHandle = requestAnimationFrame(step); }
      else { S.crate.pos = target; draw(0); onSettled(); }
    }
    rafHandle = requestAnimationFrame(step);
  }

  function momentumThenSnap(velocity){
    cancelAnim();
    const token = ++animToken;
    let v = velocity, last = performance.now();
    function step(now){
      if(token !== animToken) return;
      if(pausedNow()){ snapTo(Math.round(S.crate.pos)); return; }
      const dt = Math.min(48, now - last); last = now;
      v *= Math.exp(-0.0022 * dt);
      let pos = clamp(S.crate.pos + v * dt, 0, model.items.length - 1);
      S.crate.pos = pos;
      draw(clamp(Math.abs(v) * 40, 0, 1));
      if(Math.abs(v) > 0.00025 && pos > 0 && pos < model.items.length - 1){ rafHandle = requestAnimationFrame(step); }
      else snapTo(Math.round(pos));
    }
    rafHandle = requestAnimationFrame(step);
  }

  // ---- pointer / touch drag ----
  let dragState = null;
  stage.addEventListener('pointerdown', e => {
    if(e.button != null && e.button !== 0) return;
    cancelAnim();
    try{ stage.setPointerCapture(e.pointerId); }catch(_err){}
    dragState = {startY:e.clientY, lastY:e.clientY, lastT:performance.now(), v:0, moved:false};
  });
  stage.addEventListener('pointermove', e => {
    if(!dragState) return;
    const now = performance.now();
    const dy = e.clientY - dragState.lastY;
    if(Math.abs(e.clientY - dragState.startY) > 3) dragState.moved = true;
    const dt = Math.max(1, now - dragState.lastT);
    const deltaPos = -dy / 70;
    S.crate.pos = clamp(S.crate.pos + deltaPos, 0, model.items.length - 1);
    const instV = deltaPos / dt;
    dragState.v = dragState.v * 0.7 + instV * 0.3;
    dragState.lastY = e.clientY; dragState.lastT = now;
    draw(clamp(Math.abs(dragState.v) * 60, 0, 1));
    e.preventDefault();
  });
  function endDrag(){
    if(!dragState) return;
    const v = dragState.v, moved = dragState.moved;
    dragState = null;
    if(!moved) return;   // a plain tap — the click handler below deals with it
    if(Math.abs(v) > 0.00035) momentumThenSnap(v);
    else snapTo(Math.round(S.crate.pos));
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---- wheel / trackpad ----
  let wheelSnapTimer = null;
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    cancelAnim();
    const deltaPos = e.deltaY / 70;
    S.crate.pos = clamp(S.crate.pos + deltaPos, 0, model.items.length - 1);
    draw(clamp(Math.abs(deltaPos) * 3, 0, 1));
    clearTimeout(wheelSnapTimer);
    wheelSnapTimer = setTimeout(() => snapTo(Math.round(S.crate.pos)), 120);
  }, {passive:false});

  // ---- keyboard ----
  stage.addEventListener('keydown', e => {
    const cur = Math.round(S.crate.pos);
    if(e.key === 'ArrowDown'){ snapTo(cur + 1); e.preventDefault(); }
    else if(e.key === 'ArrowUp'){ snapTo(cur - 1); e.preventDefault(); }
    else if(e.key === 'PageDown'){ snapTo(cur + 5); e.preventDefault(); }
    else if(e.key === 'PageUp'){ snapTo(cur - 5); e.preventDefault(); }
    else if(e.key === 'Home'){ snapTo(0); e.preventDefault(); }
    else if(e.key === 'End'){ snapTo(model.items.length - 1); e.preventDefault(); }
    else if(e.key === 'Enter'){ const item = itemAt(cur); if(item && item.type === 'rec') openCrateAlbum(item); e.preventDefault(); }
    else if(e.key === ' '){ const item = itemAt(cur); if(item && item.type === 'rec') setQueue(item.idx, 0, true); e.preventDefault(); }
    else if(model.group === 'az' && /^[a-zA-Z]$/.test(e.key)){
      const target = crateRailJumpTarget(model, e.key.toUpperCase());
      if(target != null){ snapTo(target); e.preventDefault(); }
    }
  });

  // ---- tap a card: centre one scrolls to it, the centred one opens ----
  stage.addEventListener('click', e => {
    const cardEl = e.target.closest('.crate-card');
    if(!cardEl) return;
    let idx = null;
    pool.forEach((elC, i) => { if(elC === cardEl) idx = i; });
    if(idx == null) return;
    if(idx === Math.round(S.crate.pos)){
      const item = itemAt(idx);
      if(item.type === 'rec') openCrateAlbum(item);
    } else snapTo(idx);
  });

  // ---- rail drag-to-scrub, with the amber bubble ----
  let bubbleEl = null, scrubbing = false;
  function railEntryAtClientY(clientY){
    const entries = model.railEntries;
    if(!entries.length) return null;
    const rect = rail.getBoundingClientRect();
    const t = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    const k = Math.round(t * (entries.length - 1));
    return entries[k];
  }
  rail.addEventListener('pointerdown', e => {
    const entry = railEntryAtClientY(e.clientY);
    if(!entry) return;
    scrubbing = true;
    cancelAnim();
    try{ rail.setPointerCapture(e.pointerId); }catch(_err){}
    bubbleEl = document.createElement('div');
    bubbleEl.className = 'crate-rail-bubble';
    document.body.appendChild(bubbleEl);
    scrubMove(e);
    e.preventDefault();
  });
  function scrubMove(e){
    if(!scrubbing) return;
    const entry = railEntryAtClientY(e.clientY);
    if(!entry) return;
    bubbleEl.textContent = entry.label;
    bubbleEl.style.left = (e.clientX - 34 - 60) + 'px';
    bubbleEl.style.top = (e.clientY - 34) + 'px';
    if(entry.present && entry.itemIndex != null){ S.crate.pos = clamp(entry.itemIndex, 0, model.items.length - 1); draw(0.9); }
    scrubMove.lastEntry = entry;
  }
  rail.addEventListener('pointermove', e => { if(scrubbing){ scrubMove(e); e.preventDefault(); } });
  function endScrub(){
    if(!scrubbing) return;
    scrubbing = false;
    if(bubbleEl){ bubbleEl.remove(); bubbleEl = null; }
    const entry = scrubMove.lastEntry;
    if(entry && entry.present){ const target = crateRailJumpTarget(model, entry.key); if(target != null) snapTo(target); }
  }
  rail.addEventListener('pointerup', endScrub);
  rail.addEventListener('pointercancel', endScrub);

  draw(0);
  // info started out empty when applyCrateMiniInset() first ran above, so
  // its height was measured at the CSS min-height floor rather than its
  // real content height (title + artist + meta, sometimes a wrapped "Now
  // playing" chip). Now that draw(0) has filled it in, remeasure so the
  // stage doesn't claim room the info panel actually needs — without this,
  // using all available space (rather than banking a safety margin of dead
  // space) let the info panel's true height push past the mini player.
  applyCrateMiniInset();
  announceCurrent();
  scheduleLargeSwap();
  prewarmCrateAnchorL().catch(() => {});
}

// vertically centres the empty-library placeholder in whatever room is left
// under the header and above the tab bar, rather than always hugging the
// top — a one-off static block, unlike the scrollable track lists
export function centerEmptyState(){
  const empty = $('#empty');
  empty.style.marginTop = '0px';
  const tabbarEl = $('#tabbar');
  const tabbarH = tabbarEl ? tabbarEl.getBoundingClientRect().height : 0;
  const top = empty.getBoundingClientRect().top;
  const available = window.innerHeight - top - tabbarH - 16;
  const slack = available - empty.getBoundingClientRect().height;
  if(slack > 0) empty.style.marginTop = Math.round(slack / 2) + 'px';
}
