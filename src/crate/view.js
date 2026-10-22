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
import { METAL_COLORS } from '../record-art/metals.js';
import { buildRailTicks } from '../ui/letter-rail.js';
import {
  ensureCrateModel, invalidateCrateModel, isNowPlayingAlbum, persistCrateAnchor,
  crateRailJumpTarget, crateVariantJumpTarget, libraryHasGenres, nextCrateGroup, CRATE_GROUP_LABELS, stickerFor, catalogLineFor, playedLineFor, eraTintFor,
  classifyCratePointerTrace, cratePullProgress, cratePendingTraceMoved, CRATE_PULL_HOLD_MS, CRATE_PULL_COMMIT_FRACTION,
  sectionIndexAt, clampToSection, isHorizontalCrateDrag, crateSectionDragCommits,
} from './model.js';
import { resolveLastPlayedAlbum } from '../launch/intro.js';
import { renderTracks } from '../library/view.js';
import { openGatefold, buildGatefoldTracklist, gatefoldTrackIndices } from '../gatefold/view.js';
import { openSealedSheet, sealedQuietPlay } from '../gatefold/sealed-sheet.js';
import { openCreditsSheet } from '../library/credits.js';
import { playNext, addToQueue } from '../player/queue.js';
import { openLayer, closeLayer } from '../shell/nav-stack.js';

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

// CR3 point 1: a small matte dot, not the full plated-finish band
// metalBackground() draws for the platter itself — "14px, radial
// highlight" per the design doc, reusing METAL_COLORS as the one source
// of truth for which hex means which metal.
function metalDotBackground(name){
  const m = METAL_COLORS[name];
  const base = m ? m.base : '#999';
  return 'radial-gradient(circle at 35% 30%, rgba(255,255,255,.65) 0%, ' + base + ' 55%, rgba(0,0,0,.35) 100%)';
}

// CR3 point 1/2: one .crate-sticker element for whichever kind
// stickerFor() returned — never called for 'sealed' (that's still the
// existing film+chip, CR6's own job to redesign) or null.
function buildStickerEl(sticker){
  if(sticker.kind === 'metal'){
    const dot = document.createElement('div');
    dot.className = 'crate-sticker crate-sticker-metal';
    dot.style.background = metalDotBackground(sticker.metal);
    dot.setAttribute('aria-label', sticker.metal + ' metal');
    return dot;
  }
  const tag = document.createElement('div');
  tag.className = 'crate-sticker crate-sticker-' + sticker.kind;
  tag.textContent = sticker.kind === 'new' ? 'NEW'
    : sticker.kind === 'friends' ? (sticker.count || 1) + (sticker.count === 1 ? ' FRIEND' : ' FRIENDS')
    : sticker.kind === 'hires' ? (sticker.bits || '') + '/' + Math.round((sticker.rate || 0) / 1000)
    : '';
  return tag;
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
  // too — a sealed record still opens the sealed sheet there, same as on
  // a phone.
  if(isAlbumSealed(item.albumId)){ openSealedSheet(item); return; }
  // CR10 (docs/13_CRATE.md) point 1: "Tap still opens the gatefold" — the
  // D5-era desktop branch that showed the tracklist in the side panel
  // instead, on tap, is gone. The panel now follows the front record on
  // its own (onSettled(), below) with nothing to tap first, so a tap's
  // only job left is what it's always been on a phone: open the gatefold.
  openGatefold(item);
}

// CR2 point 4 / CR10 point 1: the one-line description a divider's own
// catalog card shows — the bins get their own sentence, everything else
// keeps the existing panelSub. Shared by the below-stage info panel
// (updateInfoPanel, inside renderCrate()) and the desktop side panel
// (renderCrateDetailPanel, below) so the two can never drift apart on
// what a divider's own blurb says.
function dividerDescFor(item){
  return item.kind === 'bin' && item.key === 'new' ? 'Added in the last two weeks'
    : item.kind === 'bin' && item.key === 'picks' ? 'Pinned to staff picks'
    : (item.panelSub || '');
}

// CR3 point 3 / CR10 point 1: the catalog card — cream stock, an aubergine
// head rule, title/artist/catalog-number line, a second "PLAYED N TIMES ·
// LAST SPUN TUE" line once the record has actually been played, and a
// solid accent play disc at the right. Shared by the below-stage info
// panel and the desktop side panel. CR6 moved the SEALED·[date] tag onto
// the film itself (buildSealOverlay, library/sealed.js, lower-left, on
// the cover) — this card carries no text chip of its own for it, just
// the sr-only note (the film's own tag is aria-hidden, same as every
// other seal-wrap child).
function buildCrateCatalogCard(item, sealed){
  const card = el('div','crate-catalog-card');
  card.appendChild(el('div','crate-catalog-rule'));
  const body = el('div','crate-catalog-body');
  const text = el('div');
  const h3 = el('h3', null, item.album);
  if(isNowPlayingAlbum(item)) h3.appendChild(el('span','crate-now-chip','● Now playing'));
  text.appendChild(h3);
  text.appendChild(el('p','crate-info-sub', item.artist));
  text.appendChild(el('p','crate-info-meta', catalogLineFor(item)));
  const played = playedLineFor(item);
  if(played) text.appendChild(el('p','crate-info-played', played));
  if(sealed) text.appendChild(el('span','sr-only','Sealed, not played yet'));
  body.appendChild(text);
  const playBtn = el('button','crate-catalog-play','▶');
  playBtn.setAttribute('aria-label','Play ' + item.album);
  // a sealed album plays quietly from track 1, same first-play rules as
  // the sealed sheet — no sheet/overlay opens from here either (§5)
  playBtn.addEventListener('click', e => {
    e.stopPropagation();
    if(sealed){ sealedQuietPlay(item.idx, item.idx[0]); } else setQueue(item.idx, 0, true);
  });
  body.appendChild(playBtn);
  card.appendChild(body);
  return card;
}

// MizikiSocial.getAlbumSocial() reads X.state.items directly with no null
// guard of its own (miziki-social.js) -- X.state stays null until init()'s
// own async loadState() resolves, and the desktop panel can render (and
// call this) well before that, since onSettled() below calls it on every
// crate render rather than only once a user taps something. The same race
// crate/model.js's localStaffPickIds() already found and fixed this same
// way (try/catch rather than a status() check, since pin/note state is
// deliberately available whether or not the user has ever signed in).
function safeAlbumSocial(albumId){
  try{ return MizikiSocial.getAlbumSocial(albumId); }catch(_e){ return {}; }
}

// D5 (docs/DESKTOP_LAYOUT.md); rewritten CR10 (docs/13_CRATE.md) point 1,
// "the panel follows the front record" — renderCrateDetailPanel() is no
// longer tap-only. onSettled() (below) calls it for whatever item is at
// the front after every snap/momentum settle, and renderCrate() calls it
// once more at mount, so there's nothing to tap first and no placeholder
// state left to render (docs/design/crate/DesktopCrate.dc.html's own
// "nothing to tap first" caption). A divider at the front (a bin/letter/
// genre/decade/artist divider) gets its own short description-plus-
// Play-all body, the same text updateInfoPanel()'s own divider branch
// already shows below the stage on a phone, since the right half of the
// screen is never meant to go empty here either (CR10's own "Preview
// focus"). A sealed record has nothing to show yet (SEALED spec §1, §5)
// beyond its own catalog card. Buttons/tracklist reuse buildCrateCatalog
// Card()/buildGatefoldTracklist()/gatefoldTrackIndices() (this file/
// gatefold/view.js) rather than a second implementation of either.
function renderCrateDetailPanel(item){
  const panel = $('#crateDetailPanel');
  if(!panel || !item) return;
  panel.innerHTML = '';
  if(item.type !== 'rec'){
    panel.appendChild(el('h3', null, item.label));
    panel.appendChild(el('p','crate-info-sub', dividerDescFor(item)));
    panel.appendChild(el('p','crate-info-meta', item.meta));
    if(item.idx && item.idx.length){
      const playAllBtn = el('button','cta crate-detail-playall','▶ Play all');
      playAllBtn.setAttribute('aria-label','Play all in ' + item.label);
      playAllBtn.addEventListener('click', () => setQueue(item.idx, 0, true));
      panel.appendChild(playAllBtn);
    }
    return;
  }
  const sealed = isAlbumSealed(item.albumId);
  panel.appendChild(buildCrateCatalogCard(item, sealed));
  if(sealed){
    panel.appendChild(el('p','crate-detail-footnote','Sealed — play it to break the seal.'));
    return;
  }
  // CR10 point 1: "CREDITS · PIN · SLEEVE NOTE as text buttons" — the
  // mockup's own three plain mono text buttons, replacing both the old
  // Credits .cta.ghost pill and gatefoldSocialControlsHTML()'s full
  // rating-stars/always-open-textarea block (still the gatefold's own
  // shape, untouched there — this panel is a deliberately leaner second
  // surface onto the same local-first MizikiSocial rating/note/pin state,
  // not a second implementation of it). No star rating here at all, per
  // the mockup; Sleeve note opens the same gf-note-input textarea style
  // (11-gatefold.css's own selectors already cover .crate-detail-panel)
  // in a small disclosure rather than always showing it open.
  const actions = el('div','crate-detail-textactions');
  const creditsBtn = el('button','crate-detail-textbtn','CREDITS');
  creditsBtn.setAttribute('aria-label','Credits for ' + item.album);
  creditsBtn.addEventListener('click', () => { const t = S.tracks[item.idx[0]]; if(t) openCreditsSheet(t); });
  actions.appendChild(creditsBtn);
  const pinBtn = el('button','crate-detail-textbtn','PIN');
  function paintPin(){
    const pinned = safeAlbumSocial(item.albumId).pinRank != null;
    pinBtn.setAttribute('aria-pressed', String(pinned));
    pinBtn.textContent = pinned ? 'PINNED' : 'PIN';
  }
  pinBtn.addEventListener('click', () => {
    const pinned = safeAlbumSocial(item.albumId).pinRank != null;
    try{
      if(pinned) MizikiSocial.unpin(item.albumId);
      else if(!MizikiSocial.pin(item.albumId)){ pinBtn.textContent = 'FULL'; setTimeout(paintPin, 1800); return; }
    }catch(_e){ /* MizikiSocial.init() hasn't resolved yet -- see safeAlbumSocial() */ }
    paintPin();
  });
  paintPin();
  actions.appendChild(pinBtn);
  const noteWrap = el('div','crate-detail-note');
  noteWrap.hidden = true;
  const noteInput = document.createElement('textarea');
  noteInput.className = 'gf-note-input'; noteInput.maxLength = 140; noteInput.rows = 2;
  noteInput.placeholder = 'Sleeve note';
  noteInput.setAttribute('aria-label','Sleeve note for ' + item.album);
  noteInput.value = safeAlbumSocial(item.albumId).note || '';
  noteInput.addEventListener('change', () => {
    try{ MizikiSocial.setNote(item.albumId, noteInput.value); }catch(_e){ /* see safeAlbumSocial() */ }
  });
  noteWrap.appendChild(noteInput);
  const noteBtn = el('button','crate-detail-textbtn','SLEEVE NOTE');
  noteBtn.setAttribute('aria-expanded','false');
  noteBtn.addEventListener('click', () => {
    const show = noteWrap.hidden;
    noteWrap.hidden = !show;
    noteBtn.setAttribute('aria-expanded', String(show));
    if(show) noteInput.focus();
  });
  actions.appendChild(noteBtn);
  panel.appendChild(actions);
  panel.appendChild(noteWrap);
  const trackIdx = gatefoldTrackIndices(item);
  const list = el('div','crate-detail-tracklist');
  list.setAttribute('role','list');
  list.appendChild(buildGatefoldTracklist(item, trackIdx, (idx, i) => setQueue(idx, idx.indexOf(i), true)));
  panel.appendChild(list);
  panel.appendChild(el('p','crate-detail-footnote',
    'The panel follows the record at the front of the crate. Tapping the record still opens the gatefold.'));
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
    tabToggle.style.display = 'inline-flex';
    const label = CRATE_GROUP_LABELS[S.crateGroup] || CRATE_GROUP_LABELS.az;
    $('#crateGroupCycleLabel').textContent = label;
    const next = CRATE_GROUP_LABELS[nextCrateGroup(S.crateGroup, hasGenres)];
    tabToggle.setAttribute('aria-label', `Crate order: ${label}. Tap for ${next}.`);
  }
}

// CR14 (docs/14_CRATE_SECTIONS.md PR 2): the section header shared by both
// the 3D stage (renderCrate(), below) and the reduced-motion flat list
// (renderCrateFlat(), just below) — previous arrow · name + one dot per
// section · next arrow. `onNav(dir)` gets -1/+1; the caller decides what
// "switch section" means for its own rendering (an animated slide on the
// stage, an instant list swap here).
function buildSectionHeader(sections, activeIdx, onNav){
  const header = el('div','crate-section-header');
  if(sections.length <= 1) return header;   // "a sort with only one section shows no arrows and no dots"
  const prevBtn = el('button','crate-section-arrow','‹');
  prevBtn.setAttribute('aria-label','Previous section');
  prevBtn.disabled = activeIdx <= 0;
  prevBtn.addEventListener('click', () => onNav(-1));
  const mid = el('div','crate-section-mid');
  mid.appendChild(el('span','crate-section-name', sections[activeIdx].label));
  const dots = el('div','crate-section-dots');
  sections.forEach((s, i) => {
    const dot = el('span', 'crate-section-dot' + (i === activeIdx ? ' current' : ''));
    dots.appendChild(dot);
  });
  mid.appendChild(dots);
  const nextBtn = el('button','crate-section-arrow','›');
  nextBtn.setAttribute('aria-label','Next section');
  nextBtn.disabled = activeIdx >= sections.length - 1;
  nextBtn.addEventListener('click', () => onNav(1));
  header.appendChild(prevBtn); header.appendChild(mid); header.appendChild(nextBtn);
  return header;
}

// flat, non-3D fallback for prefers-reduced-motion: a plain scrollable list,
// snap-scroll instead of momentum, cross-fade instead of the pull-to-camera
// (CRATE spec §6). CR14: "no sliding. Show the section header with arrows;
// arrows swap the flat list to that section instantly" — the list itself
// is sliced to the active section's own [start,end) span.
function renderCrateFlat(host, model){
  updateCrateGroupToggleUI();
  let activeIdx = Math.max(0, sectionIndexAt(model.sections, S.crate.pos || 0));
  const wrap = el('div','crate-flat-wrap');
  const headerSlot = el('div');
  wrap.appendChild(headerSlot);
  const listSlot = el('div');
  wrap.appendChild(listSlot);
  host.appendChild(wrap);

  function renderList(){
    headerSlot.innerHTML = '';
    headerSlot.appendChild(buildSectionHeader(model.sections, activeIdx, dir => {
      activeIdx = clamp(activeIdx + dir, 0, model.sections.length - 1);
      S.crate.pos = model.sections[activeIdx].start;
      renderList();
    }));
    listSlot.innerHTML = '';
    renderFlatList(listSlot, model, model.sections[activeIdx]);
  }
  renderList();
}

function renderFlatList(host, model, section){
  const list = el('div','crate-flat-list');
  list.setAttribute('role','listbox');
  list.setAttribute('aria-label','Crate');
  model.items.slice(section.start, section.end).forEach(item => {
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
  // CR14 (docs/14_CRATE_SECTIONS.md PR 2): the new section header (prev
  // arrow · name + dots · next arrow) sits above .crate-stage too, same
  // "its height has to come out of this same budget every render" reasoning
  // as .crate-header just above — it renders empty (no arrows/dots at all)
  // for a sort with only one section, so its own real height already
  // collapses to ~0 there with no extra branch needed here.
  const sectionHeaderEl = document.querySelector('.crate-section-header');
  const sectionHeaderReserve = sectionHeaderEl
    ? sectionHeaderEl.getBoundingClientRect().height + (parseFloat(getComputedStyle(sectionHeaderEl).marginBottom) || 0)
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
  const available = window.innerHeight - wrapTop - miniH - tabbarH - infoReserve - headerReserve - sectionHeaderReserve - 28;
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
  if(railEl){
    railEl.style.height = Math.max(0, stageHeight - 20) + 'px';
    // CR14 (docs/14_CRATE_SECTIONS.md PR 2): a real bug found during this
    // PR's own device-checklist pass, not present before it — the rail's
    // CSS top:10px is a fixed offset against .crate-wrap, authored back
    // when .crate-header was the only thing ever sitting above .crate-stage
    // in the wrap. This PR's own .crate-section-header can now also sit
    // there (any sort with more than one section), pushing the stage
    // further down than that fixed 10px accounts for, so the rail — still
    // anchored near the wrap's own top — overlapped the section header row
    // instead of lining up with the stage, at every width, worst on a
    // narrow phone where the two rows are tallest relative to the screen.
    // Setting the rail's own top to the stage's *actual* offset within the
    // wrap (plus the same 10px inset the stage always keeps) makes it track
    // whatever's above it — zero, one, or (on a future header addition)
    // more rows — instead of a number authored for exactly one case.
    railEl.style.top = (stage.offsetTop + 10) + 'px';
  }
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
  // CR10 point 3: the desktop sidebar's BINS list sets pendingJumpKey right
  // before switching to this view, so the jump wins over whatever the
  // cold-start/anchor logic below would otherwise land on — consumed once,
  // same shape as S.crate.coldStartDone just below.
  if(S.crate.pendingJumpKey){
    const jumpTarget = crateRailJumpTarget(model, S.crate.pendingJumpKey);
    S.crate.pendingJumpKey = null;
    if(jumpTarget != null) startPos = jumpTarget;
  }
  // CR11 point 3: the pressing chart's chips set pendingJumpVariant the
  // same one-shot way — "tapping a chip jumps the crate to the first
  // record in that pressing."
  if(S.crate.pendingJumpVariant){
    const variantTarget = crateVariantJumpTarget(model, S.crate.pendingJumpVariant);
    S.crate.pendingJumpVariant = null;
    if(variantTarget != null) startPos = variantTarget;
  }
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
  // CR14 (docs/14_CRATE_SECTIONS.md PR 2): which side-by-side section
  // startPos actually falls in — a bin/letter jump already lands inside
  // its own section (crateRailJumpTarget()/crateVariantJumpTarget() never
  // cross a section boundary), so resolving this from the final startPos,
  // once, after every jump/cold-start branch above has had its say, is
  // "switch straight to that section" with no special-casing needed.
  let activeSectionIdx = Math.max(0, sectionIndexAt(model.sections, startPos));

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
  const groupLabel = model.group === 'genre' ? 'GENRE' : model.group === 'decade' ? 'DECADE' : 'A–Z';
  // CR14 (docs/14_CRATE_SECTIONS.md PR 2): the count is the active
  // section's own record count, not the whole crate's — updateHeaderLeft()
  // recomputes it on every section switch.
  const headerLeft = el('div','crate-header-left');
  function updateHeaderLeft(){
    const section = curSection();
    const count = model.items.slice(section.start, section.end).filter(it => it.type === 'rec').length;
    headerLeft.textContent = count + (count === 1 ? ' RECORD' : ' RECORDS') + ' · ' + groupLabel;
  }
  const nowPlayingBtn = el('button','crate-topbar');
  nowPlayingBtn.setAttribute('aria-label','Scroll to the album that is now playing');
  // CR14: the playing album may sit in a different section than the one
  // currently centred (another genre/decade, or outside the A–Z section
  // entirely for a bin-only distance) — switch straight to its section
  // first, same as a sidebar BINS jump, then snap within it.
  nowPlayingBtn.addEventListener('click', () => {
    if(nowPlayingIdx < 0) return;
    const targetSectionIdx = sectionIndexAt(model.sections, nowPlayingIdx);
    if(targetSectionIdx >= 0 && targetSectionIdx !== activeSectionIdx) switchToSectionIndex(targetSectionIdx);
    snapTo(nowPlayingIdx);
  });
  header.appendChild(headerLeft); header.appendChild(nowPlayingBtn);
  // CR14: previous/next section arrows, section name, one dot per section
  // — above the stage, kept in sync (which arrows are enabled, which dot
  // is current) by refreshSectionHeaderUI() on every section switch.
  const sectionHeaderSlot = el('div');
  function refreshSectionHeaderUI(){
    sectionHeaderSlot.innerHTML = '';
    sectionHeaderSlot.appendChild(buildSectionHeader(model.sections, activeSectionIdx, dir => switchToSection(dir)));
  }
  const stage = el('div','crate-stage');
  stage.tabIndex = 0;
  stage.setAttribute('role','listbox');
  stage.setAttribute('aria-label','Crate');
  const live = el('div','sr-only'); live.id = 'crateLive'; live.setAttribute('aria-live','polite');
  stage.appendChild(live);
  // CR14: the two side-by-side neighbour crates, a clipped sliver at each
  // edge of the stage (the spec's own "accepted" ~30px peek) — static,
  // rebuilt only on a section switch, not animated frame-by-frame during a
  // drag; the sliding stack itself (via hDragX below) is what conveys
  // motion during the gesture.
  const peekPrev = el('div','crate-peek crate-peek-prev');
  const peekNext = el('div','crate-peek crate-peek-next');
  stage.appendChild(peekPrev); stage.appendChild(peekNext);
  const rail = el('div','crate-rail');
  const info = el('div','crate-info');
  wrap.appendChild(header); wrap.appendChild(sectionHeaderSlot); wrap.appendChild(stage); wrap.appendChild(rail); wrap.appendChild(info);

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
  layout.appendChild(wrap);
  layout.appendChild(detailPanel);
  host.appendChild(layout);

  applyCrateMiniInset();

  const pool = new Map();      // item index -> element, only the visible window
  let animToken = 0, rafHandle = null;
  const cancelAnim = () => { animToken++; if(rafHandle){ cancelAnimationFrame(rafHandle); rafHandle = null; } };

  function itemAt(i){ return model.items[i]; }

  // CR14 (docs/14_CRATE_SECTIONS.md PR 2): the active side-by-side section
  // — model.items/pos/snapTo/etc. all stay index-based exactly as before
  // this PR, just clamped to curSection()'s own [start, end) span instead
  // of the whole model, via clampToSection() (crate/model.js).
  function curSection(){ return model.sections[activeSectionIdx]; }
  function sectionDefaultPos(section){
    for(let i = section.start; i < section.end; i++) if(model.items[i].type === 'rec') return i;
    return section.start;
  }
  // "first visit: the A–Z section uses today's cold-start/anchor logic;
  // any other section starts on its first record" — the A–Z half of that
  // is already satisfied by the existing cold-start block above (it runs
  // before activeSectionIdx is even resolved); this is the general rule
  // for every later switch, back into a section already visited this
  // session (S.crate.sectionPos) or into one that hasn't been yet.
  function sectionRestorePos(section){
    const saved = S.crate.sectionPos[section.key];
    if(saved != null && saved >= section.start && saved < section.end) return saved;
    return sectionDefaultPos(section);
  }

  function makeCardEl(i){
    const item = itemAt(i);
    const card = document.createElement('div');
    card.className = 'crate-card';
    if(item.type === 'div'){
      // CR2 point 3: a divider's own card is 12% taller than a sleeve, with
      // cream stock everywhere except a genre divider (manila) — see
      // 10-crate.css's own .crate-card-div/.crate-divider-genre comments.
      card.classList.add('crate-card-div');
      const d = document.createElement('div'); d.className = 'crate-divider';
      if(item.kind === 'genre') d.classList.add('crate-divider-genre');
      // CR4 (docs/13_CRATE.md): "tinted by the README's era table (20-25%
      // over divider stock plus a 6px edge stripe)" — undated, and any
      // decade the table has no row for, stay plain cream (no tint class,
      // no custom properties set) rather than reaching for a default.
      if(item.kind === 'decade'){
        const tints = eraTintFor(item.decadeKey);
        if(tints){
          d.classList.add('crate-divider-decade');
          d.style.setProperty('--era-1', tints[0]);
          d.style.setProperty('--era-2', tints[1]);
          d.style.setProperty('--era-3', tints[2]);
        }
      }
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
      const sealed = isAlbumSealed(item.albumId);
      if(sealed) card.appendChild(buildSealOverlay(cardSize, item.albumId, item.addedAt));
      else {
        // CR3 point 1: "most sleeves are quiet; the few stickers mean
        // something" — stickerFor() already returns null for most records.
        const sticker = stickerFor(item, false);
        if(sticker) card.appendChild(buildStickerEl(sticker));
      }
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
      // CR2 point 4: the divider catalog card below the stage — title, a
      // one-line description, the count/year-span line, and PLAY ALL
      // (bin/artist/letter/genre — plays the whole group in order).
      info.appendChild(el('h3', null, item.label));
      info.appendChild(el('p','crate-info-sub', dividerDescFor(item)));
      info.appendChild(el('p','crate-info-meta', item.meta));
      if(item.idx && item.idx.length){
        const playAllBtn = el('button','crate-divider-playall','PLAY ALL');
        playAllBtn.setAttribute('aria-label','Play all in ' + item.label);
        playAllBtn.addEventListener('click', e => { e.stopPropagation(); setQueue(item.idx, 0, true); });
        info.appendChild(playAllBtn);
      }
      return;
    }
    const sealed = isAlbumSealed(item.albumId);
    info.appendChild(buildCrateCatalogCard(item, sealed));
  }

  // CR9 (docs/13_CRATE.md): the tick-building loop itself — spread entries
  // across the rail's own current measured height, one button per letter
  // — is now src/ui/letter-rail.js's buildRailTicks(), shared with the
  // library's own Artists/Songs rail (src/library/view.js). The crate's
  // own drag-to-scrub pointer handling on `rail` (below, pointerdown/
  // pointermove/the amber bubble) stays here untouched — it's the crate's
  // 3D flow-stage scrubbing, not tick building, and CLAUDE.md's refactor
  // rules (no behavior change) argue against moving it just to make this
  // extraction look more complete than the spec actually asked for.
  // CR14: the rail only exists in the A–Z section (docs/14_CRATE_SECTIONS.md
  // PR 2, "The letter rail moves to the left edge") — genre/decade sections,
  // and any A–Z-only bin, have no rail at all. CSS (.crate-rail-hidden)
  // fades it out and drops pointer-events, rather than removing/rebuilding
  // the element on every section switch.
  function updateRailUI(position){
    if(curSection().key !== 'az'){ rail.classList.add('crate-rail-hidden'); rail.innerHTML = ''; return; }
    rail.classList.remove('crate-rail-hidden');
    buildRailTicks(rail, model.railEntries, {
      itemClass: 'crate-rail-item', dimClass: 'crate-rail-dim', currentClass: 'crate-rail-current',
      isCurrent: e_ => {
        const target = crateRailJumpTarget(model, e_.key);
        return target != null && Math.abs(position - target) < 2;
      },
      onTap: e_ => {
        const target = crateRailJumpTarget(model, e_.key);
        if(target != null) snapTo(target);
      },
    });
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
    // CR14: the visible pool window never crosses into a neighbouring
    // section — cards from the next/prev crate must never show in this
    // one's own stack.
    const section = curSection();
    const lo = Math.max(section.start, Math.floor(position) - CRATE_VISIBLE_A), hi = Math.min(section.end - 1, Math.ceil(position) + CRATE_VISIBLE_A);
    for(const i of Array.from(pool.keys())) if(i < lo || i > hi){ pool.get(i).remove(); pool.delete(i); }
    for(let i = lo; i <= hi; i++) if(!pool.has(i)){ const c = makeCardEl(i); stage.appendChild(c); pool.set(i, c); }
    pool.forEach((card, i) => {
      const d = i - position, a = Math.abs(d);
      const pose = flowPose(a, d, speed, {originY: CRATE_ORIGIN_Y, spread: cardSpread});
      // integer device pixels so edges don't smear at rest (spec §B4)
      const y = Math.round(pose.y * CRATE_DPR) / CRATE_DPR;
      // CR14: hDragX is the in-progress horizontal section-swipe offset
      // (0 outside a horizontal drag/slide) — folded into the same
      // transform string so the whole stack slides as one rigid body.
      card.style.transform = 'translateX(' + hDragX.toFixed(1) + 'px) translateY(' + y.toFixed(2) + 'px) translateZ(' + pose.z.toFixed(1) + 'px) '
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
  }
  function draw(speed){ syncCards(S.crate.pos, speed); }

  function onSettled(){
    const item = itemAt(Math.round(S.crate.pos));
    if(item && item.type === 'rec') persistCrateAnchor(item);
    // CR10 point 1: the desktop side panel follows whatever's at the front
    // once it comes to rest — not every animation frame, since the panel's
    // own content (the catalog card, text actions, side-split tracklist)
    // is heavier than the below-stage info row updateInfoPanel repaints on
    // every frame regardless of platform.
    if(isDesktopShell()) renderCrateDetailPanel(item);
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
    target = clampToSection(curSection(), Math.round(target));
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
      const section = curSection();
      let pos = clampToSection(section, S.crate.pos + v * dt);
      S.crate.pos = pos;
      draw(clamp(Math.abs(v) * 40, 0, 1));
      if(Math.abs(v) > 0.00025 && pos > section.start && pos < section.end - 1){ rafHandle = requestAnimationFrame(step); }
      else snapTo(Math.round(pos));
    }
    rafHandle = requestAnimationFrame(step);
  }

  // ---- CR14 (docs/14_CRATE_SECTIONS.md PR 2): horizontal section swipe ----
  // A pointerdown's axis isn't known until the first few pixels of
  // movement — hStartX/hStartY/hGestureT0 are stashed at every pointerdown
  // below (front-record or not), and the first pointermove on either the
  // flip-drag or the pull/hold path (whichever one this pointerdown landed
  // on) checks isHorizontalCrateDrag() before doing anything of its own;
  // once hActive flips true, that path's own vertical/pull state is torn
  // down and every further move/up on this pointer is routed here instead.
  let hStartX = null, hStartY = null, hGestureT0 = 0, hActive = false, hDragX = 0;
  function rubberBandX(dx){
    if(dx > 0 && activeSectionIdx === 0) return dx * 0.35;
    if(dx < 0 && activeSectionIdx === model.sections.length - 1) return dx * 0.35;
    return dx;
  }
  // Takes over for *either* gesture path the instant a move is classified
  // horizontal — returns true once it has (so the caller can bail out of
  // its own vertical logic for this and every later move on this pointer).
  function maybeTakeOverHorizontal(e){
    if(hActive || model.sections.length <= 1) return hActive;
    const dx = e.clientX - hStartX, dy = e.clientY - hStartY;
    if(!isHorizontalCrateDrag(dx, dy)) return false;
    hActive = true; gestureConsumed = true;
    if(pullState){ clearHoldTimer(); pullState.cardEl.style.transform = pullState.baseTransform; pullState = null; }
    dragState = null;
    return true;
  }
  function handleHorizontalMove(e){
    hDragX = rubberBandX(e.clientX - hStartX);
    draw(0);
  }
  function rebuildPeeks(){
    [[peekPrev, -1], [peekNext, 1]].forEach(([container, dir]) => {
      container.innerHTML = '';
      const targetIdx = activeSectionIdx + dir;
      if(targetIdx < 0 || targetIdx >= model.sections.length) return;
      const pos = Math.round(sectionRestorePos(model.sections[targetIdx]));
      const card = makeCardEl(pos);
      card.classList.remove('crate-moving');
      container.appendChild(card);
    });
  }
  // The actual section switch, once a horizontal gesture (or an arrow/dot
  // tap, or the now-playing/sidebar-jump shortcuts below) commits:
  // snapshot this section's own position, animate the whole stack off
  // toward the edge, then swap the active section's bounds and resolve its
  // own remembered (or default) position before drawing it back in.
  function switchToSectionIndex(toIdx, animate){
    const fromSection = curSection();
    toIdx = clamp(toIdx, 0, model.sections.length - 1);
    if(toIdx === activeSectionIdx){ springBackHorizontal(); return; }
    S.crate.sectionPos[fromSection.key] = S.crate.pos;
    const settle = () => {
      activeSectionIdx = toIdx;
      const section = curSection();
      pool.forEach(c => c.remove()); pool.clear();
      S.crate.pos = sectionRestorePos(section);
      hDragX = 0;
      refreshSectionHeaderUI();
      rebuildPeeks();
      updateHeaderLeft();
      draw(0);
      onSettled();
    };
    if(!animate){ settle(); return; }
    const dir = toIdx > activeSectionIdx ? -1 : 1;
    const width = stage.getBoundingClientRect().width || 300;
    animateHDrag(hDragX, dir * width, 170, settle);
  }
  function switchToSection(delta){ switchToSectionIndex(activeSectionIdx + delta, true); }
  function springBackHorizontal(){ animateHDrag(hDragX, 0, 160, () => { hDragX = 0; draw(0); }); }
  function animateHDrag(from, to, ms, cb){
    const start = performance.now();
    function step(now){
      const p = clamp((now - start) / ms, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      hDragX = from + (to - from) * eased;
      draw(0.3);
      if(p < 1) requestAnimationFrame(step);
      else { hDragX = to; cb && cb(); }
    }
    requestAnimationFrame(step);
  }
  function endHorizontalDrag(){
    const dx = hDragX, elapsedMs = performance.now() - hGestureT0;
    hActive = false;
    if(!crateSectionDragCommits(dx, elapsedMs)){ springBackHorizontal(); return; }
    switchToSectionIndex(activeSectionIdx + (dx < 0 ? 1 : -1), true);
  }

  // ---- pointer / touch drag ----
  let dragState = null;
  // Set true the moment any gesture on this pointerdown actually becomes
  // something other than a plain tap (a flip drag, a pull, or a long
  // hold) -- read at pointerup instead of dragState.moved/pullState.phase,
  // since stage has two separate pointerup listeners (this one and the
  // older endDrag registration just below) and the first one to run
  // already nulls dragState/pullState before the second ever sees them;
  // a flag set live, during the gesture, has no such ordering race.
  let gestureConsumed = false;
  function beginFlipDrag(e, moved){
    dragState = {startY:e.clientY, lastY:e.clientY, lastT:performance.now(), v:0, moved:!!moved};
    if(moved) gestureConsumed = true;
  }
  stage.addEventListener('pointermove', e => {
    if(hActive){ handleHorizontalMove(e); e.preventDefault(); return; }
    if(!dragState) return;
    if(maybeTakeOverHorizontal(e)){ handleHorizontalMove(e); e.preventDefault(); return; }
    const now = performance.now();
    const dy = e.clientY - dragState.lastY;
    if(Math.abs(e.clientY - dragState.startY) > 3){ dragState.moved = true; gestureConsumed = true; }
    const dt = Math.max(1, now - dragState.lastT);
    const deltaPos = -dy / 70;
    S.crate.pos = clampToSection(curSection(), S.crate.pos + deltaPos);
    const instV = deltaPos / dt;
    dragState.v = dragState.v * 0.7 + instV * 0.3;
    dragState.lastY = e.clientY; dragState.lastT = now;
    draw(clamp(Math.abs(dragState.v) * 60, 0, 1));
    e.preventDefault();
  });
  function endDrag(){
    // CR14: the horizontal gesture's own pointerup/pointercancel listeners
    // (further down) decide commit vs. spring-back directly — this older,
    // separately-registered listener (stage.addEventListener('pointerup',
    // endDrag) just below) must stay a no-op while hActive, not make its
    // own second commit decision.
    if(hActive) return;
    if(!dragState) return;
    const v = dragState.v, moved = dragState.moved;
    dragState = null;
    if(!moved) return;   // a plain tap — the click handler below deals with it
    if(Math.abs(v) > 0.00035) momentumThenSnap(v);
    else snapTo(Math.round(S.crate.pos));
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---- pull-to-remove and hold-for-actions on the front record (CR5) ----
  // A small state machine layered in front of the flip drag above: a
  // pointerdown that lands on the currently-centred record is held as a
  // "pull candidate" (not yet a flip drag at all) until classifyCratePointer
  // Trace() (crate/model.js, the pure, unit-tested half of this gesture)
  // says which of pull/flip/hold it has become. Until then S.crate.pos is
  // left untouched — flip and pull would otherwise fight over the same
  // vertical drag for their first ~24px, per the README's own "the pull
  // never fights the vertical flip" rule.
  //
  // No REDUCED-motion branch is needed here at all: renderCrate() (above)
  // already bails into renderCrateFlat() — a plain scrollable list whose
  // own row click handlers open the gatefold directly, no gesture of any
  // kind — whenever REDUCED is true, so none of this pointer-handling code
  // (this whole block included) is ever attached in the first place. That
  // pre-existing fallback is what satisfies the spec's own "Reduced motion:
  // a pull is a tap" on its own, structurally, with nothing added here.
  let pullState = null;
  let holdTimer = null;
  // See the pointerdown handler's own comment -- the card index a tap
  // would open or snap to, resolved before pointer capture can retarget
  // anything.
  let tapCandidateIdx = null;
  function clearHoldTimer(){ if(holdTimer != null){ clearTimeout(holdTimer); holdTimer = null; } }

  // Shared by frontRecordAt() below and by the tap-candidate lookup at
  // pointerdown -- both need "which pooled card, if any, is e.target
  // inside" and nothing more.
  function cardIdxAt(e){
    const cardEl = e.target.closest('.crate-card');
    if(!cardEl) return null;
    let idx = null;
    pool.forEach((elC, i) => { if(elC === cardEl) idx = i; });
    return idx;
  }

  function frontRecordAt(e){
    const idx = cardIdxAt(e);
    if(idx == null || idx !== Math.round(S.crate.pos)) return null;
    const item = itemAt(idx);
    // a "loose tracks" pseudo-record (no real sleeve/gatefold to pull
    // open) and a sealed record (SEALED spec §1 — no "inside" to reveal
    // until the first play) are both pull/hold candidates in name only;
    // the pointerdown handler below falls back to the ordinary flip drag
    // for either, same as for any other non-centred card.
    if(!item || item.type !== 'rec' || item.kind === 'loose' || isAlbumSealed(item.albumId)) return null;
    return {item, cardEl: pool.get(idx)};
  }

  function setPullLift(ps, upPx){
    ps.lastUpPx = upPx;
    ps.cardEl.style.transform = ps.baseTransform + ' translateY(' + (-upPx).toFixed(1) + 'px)';
  }

  function commitPull(ps){
    ps.cardEl.style.transform = ps.baseTransform;
    // The README's "the gatefold opens with the disc already out" entrance
    // choreography doesn't exist yet — openGatefold() has no hook for
    // "start with the disc already pulled" today. Opening it the plain way
    // (same call a tap already makes) is the honest scope call for this PR;
    // the hand-off polish is a follow-up, flagged in the PR body.
    openCrateAlbum(ps.item);
  }

  function springBackPull(ps){
    const el = ps.cardEl, base = ps.baseTransform, from = ps.lastUpPx || 0;
    const start = performance.now(), dur = 220;
    function step(now){
      const p = clamp((now - start) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.style.transform = base + ' translateY(' + (-(from * (1 - eased))).toFixed(1) + 'px)';
      if(p < 1) requestAnimationFrame(step);
      else el.style.transform = base;
    }
    requestAnimationFrame(step);
  }

  function endPullGesture(){
    if(!pullState) return;
    clearHoldTimer();
    const ps = pullState;
    pullState = null;
    if(ps.phase === 'pull'){
      const progress = cratePullProgress(ps.lastUpPx || 0, currentCardSize());
      if(progress >= CRATE_PULL_COMMIT_FRACTION) commitPull(ps);
      else springBackPull(ps);
      return;
    }
    if(ps.phase === 'hold') return;   // already handled by the hold timer
    // phase === 'pending': the gesture never crossed the pull or flip
    // threshold, and never held long enough either -- classifyCratePointer
    // Trace() (model.js) correctly keeps a steadily-rising sub-threshold
    // drag 'pending' right up to release, so it can't resolve this itself.
    // A trace with real movement here is an aborted drag, not a tap -- mark
    // it consumed and resolve the net displacement the same way the
    // ordinary flip drag would, rather than letting the stage's pointerup
    // handler fall through to opening the record.
    if(cratePendingTraceMoved(ps.trace)){
      gestureConsumed = true;
      const netDy = ps.trace[ps.trace.length - 1].dy;
      S.crate.pos = clampToSection(curSection(), S.crate.pos - netDy / 70);
      snapTo(Math.round(S.crate.pos));
    }
  }

  function openCrateHoldCard(item){
    const scrim = el('div', 'crate-hold-scrim');
    const card = el('div', 'crate-hold-card');
    card.setAttribute('role', 'menu');
    card.appendChild(el('p', 'crate-hold-title', item.artist + ' — ' + item.album));
    function teardown(){ scrim.remove(); card.remove(); }
    function action(label, fn){
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'crate-hold-btn'; b.setAttribute('role', 'menuitem');
      b.textContent = label;
      b.addEventListener('click', () => { closeLayer('crate-hold'); fn(); });
      card.appendChild(b);
    }
    action('Play next', () => { item.idx.slice().reverse().forEach(i => playNext(i)); });
    action('Add to queue', () => { item.idx.forEach(i => addToQueue(i)); });
    // local-first, same as the gatefold's own pin button (gatefold/view.js's
    // gatefoldSocialControlsHTML) — works with no server configured at all.
    const pinned = MizikiSocial.getAlbumSocial(item.albumId).pinRank != null;
    action(pinned ? 'Unpin from staff picks' : 'Pin to staff picks', () => {
      if(pinned) MizikiSocial.unpin(item.albumId);
      else MizikiSocial.pin(item.albumId);
    });
    action('Sleeve note', () => openCrateAlbum(item));
    document.body.appendChild(scrim);
    document.body.appendChild(card);
    scrim.addEventListener('click', () => closeLayer('crate-hold'));
    openLayer('crate-hold', teardown, {container: [scrim, card]});
  }

  stage.addEventListener('pointerdown', e => {
    if(e.button != null && e.button !== 0) return;
    cancelAnim();
    // Resolved from this pointerdown's own e.target -- the one event in
    // this whole gesture whose target setPointerCapture() below hasn't
    // touched yet (capture only retargets events *after* the call that
    // sets it). Every later pointer event, and the mouse's own trailing
    // "click" a tap ends in, gets retargeted to stage itself once capture
    // is set, which is why the stage's own click handler below can no
    // longer reliably resolve ".crate-card" from e.target -- see the
    // pointerup handler further down for the fix that actually opens or
    // snaps to this card on a plain tap, using this stashed index instead
    // of waiting on that click event.
    tapCandidateIdx = cardIdxAt(e);
    gestureConsumed = false;
    // CR14: stashed on every pointerdown, front-record or not, so whichever
    // path's pointermove runs first can classify the gesture's axis before
    // committing to a vertical flip/pull.
    hStartX = e.clientX; hStartY = e.clientY; hGestureT0 = performance.now();
    try{ stage.setPointerCapture(e.pointerId); }catch(_err){}
    const front = frontRecordAt(e);
    if(!front){ beginFlipDrag(e, false); return; }
    pullState = {
      startY: e.clientY, startT: performance.now(),
      trace: [{dy:0, t:0}], phase: 'pending',
      item: front.item, cardEl: front.cardEl, baseTransform: front.cardEl.style.transform,
      lastUpPx: 0,
    };
    holdTimer = setTimeout(() => {
      if(pullState && pullState.phase === 'pending'){
        pullState.phase = 'hold';
        gestureConsumed = true;
        openCrateHoldCard(pullState.item);
        pullState = null;
      }
    }, CRATE_PULL_HOLD_MS + 20);
  });
  stage.addEventListener('pointermove', e => {
    if(hActive){ handleHorizontalMove(e); e.preventDefault(); return; }
    if(!pullState) return;
    if(pullState.phase === 'pending' && maybeTakeOverHorizontal(e)){ handleHorizontalMove(e); e.preventDefault(); return; }
    const dy = e.clientY - pullState.startY;
    pullState.trace.push({dy, t: performance.now() - pullState.startT});
    e.preventDefault();
    if(pullState.phase === 'pending'){
      const cls = classifyCratePointerTrace(pullState.trace);
      if(cls === 'pull'){ pullState.phase = 'pull'; gestureConsumed = true; clearHoldTimer(); }
      else if(cls === 'flip'){
        clearHoldTimer();
        pullState.cardEl.style.transform = pullState.baseTransform;
        pullState = null;
        beginFlipDrag(e, true);
        return;
      } else return;   // still pending — no visual change until it commits
    }
    setPullLift(pullState, Math.max(0, -dy));
  });
  function openOrSnapIdx(idx){
    if(idx === Math.round(S.crate.pos)){
      const item = itemAt(idx);
      if(item.type === 'rec') openCrateAlbum(item);
    } else snapTo(idx);
  }
  stage.addEventListener('pointerup', e => {
    // gestureConsumed, not a read of dragState/pullState here -- stage has
    // two separate pointerup listeners (this one and the older endDrag
    // registration a few lines up), and that one runs first and already
    // nulls dragState/pullState before this listener's body ever executes,
    // which would make a real flip-drag misread as "never moved." The flag
    // is set live, during the gesture itself, so it has no such race.
    if(hActive){ endHorizontalDrag(); tapCandidateIdx = null; return; }
    endPullGesture();
    endDrag(e);
    if(!gestureConsumed && tapCandidateIdx != null){
      openOrSnapIdx(tapCandidateIdx);
    }
    tapCandidateIdx = null;
  });
  stage.addEventListener('pointercancel', () => {
    if(hActive){ springBackHorizontal(); hActive = false; return; }
    if(pullState){ clearHoldTimer(); pullState.cardEl.style.transform = pullState.baseTransform; pullState = null; }
    endDrag();
  });

  // CR5 point 4, "Desktop: ... hold becomes right-click/context" — a mouse's
  // own context-menu gesture on the front record opens the exact same hold
  // card a 450ms touch/mouse dwell does, instead of (or on top of) the
  // browser's native context menu.
  stage.addEventListener('contextmenu', e => {
    const front = frontRecordAt(e);
    if(!front) return;
    e.preventDefault();
    if(pullState){ clearHoldTimer(); pullState.cardEl.style.transform = pullState.baseTransform; pullState = null; }
    openCrateHoldCard(front.item);
  });

  // ---- wheel / trackpad ----
  let wheelSnapTimer = null;
  // CR14: a trackpad's horizontal delta steps one section per notch
  // (debounced like the vertical one below, so a long two-finger swipe
  // doesn't fire a dozen section switches); whichever axis is larger wins
  // for a single wheel event, same "classify, then commit to one axis"
  // shape the pointer gestures use.
  let wheelHSnapTimer = null;
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    cancelAnim();
    if(Math.abs(e.deltaX) > Math.abs(e.deltaY) && model.sections.length > 1){
      clearTimeout(wheelHSnapTimer);
      wheelHSnapTimer = setTimeout(() => { switchToSection(e.deltaX > 0 ? 1 : -1); }, 60);
      return;
    }
    const section = curSection();
    const deltaPos = e.deltaY / 70;
    S.crate.pos = clampToSection(section, S.crate.pos + deltaPos);
    draw(clamp(Math.abs(deltaPos) * 3, 0, 1));
    clearTimeout(wheelSnapTimer);
    wheelSnapTimer = setTimeout(() => snapTo(Math.round(S.crate.pos)), 120);
  }, {passive:false});

  // ---- keyboard ----
  stage.addEventListener('keydown', e => {
    const cur = Math.round(S.crate.pos);
    const section = curSection();
    if(e.key === 'ArrowDown'){ snapTo(cur + 1); e.preventDefault(); }
    else if(e.key === 'ArrowUp'){ snapTo(cur - 1); e.preventDefault(); }
    else if(e.key === 'PageDown'){ snapTo(cur + 5); e.preventDefault(); }
    else if(e.key === 'PageUp'){ snapTo(cur - 5); e.preventDefault(); }
    else if(e.key === 'Home'){ snapTo(section.start); e.preventDefault(); }
    else if(e.key === 'End'){ snapTo(section.end - 1); e.preventDefault(); }
    else if(e.key === 'Enter'){ const item = itemAt(cur); if(item && item.type === 'rec') openCrateAlbum(item); e.preventDefault(); }
    else if(e.key === ' '){ const item = itemAt(cur); if(item && item.type === 'rec') setQueue(item.idx, 0, true); e.preventDefault(); }
    else if(e.key === 'ArrowLeft'){ switchToSection(-1); e.preventDefault(); }
    else if(e.key === 'ArrowRight'){ switchToSection(1); e.preventDefault(); }
    else if(section.key === 'az' && /^[a-zA-Z]$/.test(e.key)){
      const target = crateRailJumpTarget(model, e.key.toUpperCase());
      if(target != null){ snapTo(target); e.preventDefault(); }
    }
  });

  // ---- tap a card: centre one scrolls to it, the centred one opens ----
  // The actual dispatch now happens from the pointerup handler above
  // (tapCandidateIdx, resolved at pointerdown before pointer capture can
  // retarget anything) -- this click listener is kept only as a harmless
  // fallback for whatever synthetic/non-pointer-capture click might still
  // reach it with a correctly-targeted e.target.
  stage.addEventListener('click', e => {
    const idx = cardIdxAt(e);
    if(idx == null) return;
    openOrSnapIdx(idx);
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
    // CR14 (docs/14_CRATE_SECTIONS.md PR 2, "the rail moves to the left
    // edge"): the bubble opens to the right of the finger now, so it never
    // sits off the left edge of the screen — mirrored from the old
    // "60px to the left, centred" formula.
    bubbleEl.style.left = (e.clientX + 60 - 34) + 'px';
    bubbleEl.style.top = (e.clientY - 34) + 'px';
    if(entry.present && entry.itemIndex != null){ S.crate.pos = clampToSection(curSection(), entry.itemIndex); draw(0.9); }
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

  updateHeaderLeft();
  refreshSectionHeaderUI();
  rebuildPeeks();
  draw(0);
  // info started out empty when applyCrateMiniInset() first ran above, so
  // its height was measured at the CSS min-height floor rather than its
  // real content height (title + artist + meta, sometimes a wrapped "Now
  // playing" chip). Now that draw(0) has filled it in, remeasure so the
  // stage doesn't claim room the info panel actually needs — without this,
  // using all available space (rather than banking a safety margin of dead
  // space) let the info panel's true height push past the mini player.
  applyCrateMiniInset();
  if(isDesktopShell()) renderCrateDetailPanel(itemAt(Math.round(S.crate.pos)));
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
