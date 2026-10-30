import { S, touchBackupKey } from '../state.js';
import { $ } from '../util/dom.js';
import { storage, meta } from './repo.js';
import { serializePrefs, parsePrefs } from './prefs.js';
import { setMode } from '../audio/mode.js';
import { applyCharacter, applyLoudnessNorm, applyEQ, applyMonoBalance, applyDeviceVolume, balanceCaptionFor } from '../audio/engine.js';
import { applyVolume } from '../sundown/location.js';
import { depthKeyFor, depthCaptionFor } from '../sundown/solar.js';
import { loudnessCaptionFor } from '../audio/loudness.js';
import { updateToneCurveVisibility } from '../sundown/dial-view.js';
import { toggleShuffle, cycleRepeat } from '../player/controls.js';
import { bgUpdateUI, applyBgAudioSetting } from '../player/background.js';
import { attachLaunchSettingRow } from '../launch/intro.js';
import { scheduleBackupSync } from '../sync/backup.js';
import { applyTheme, applyLargerText } from '../ui/theme.js';
import { applySlipmat } from '../ui/slipmat.js';

/* ================= persistence =================
   The rest of what gets saved, on top of the raw IndexedDB wrapper (`DB`,
   src/storage/idb.js): queueSave()/saveMeta()/restoreMeta() and the
   various persist*() helpers elsewhere read and write through it. If storage
   is unavailable, every DB call quietly no-ops and Miziki behaves exactly as
   it did before: fully working, session-only. */

let saveTimer = null;
export function queueSave(){
  if(!storage.available()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveMeta, 600);
}

// RF17 (docs/12_REFINE.md, "merge per item, not per blob", point 3): prefs
// is now merged per *key*, like albumOrder/albumSort/etc — but unlike those,
// nothing in the app calls touchBackupKey('prefs', key) at each individual
// setting's own control, since that would mean touching dozens of call
// sites for one pref apiece. Instead this module (the one place that
// already serializes the whole prefs blob on every save) diffs the new
// blob against the last one it actually saved and stamps only the keys
// that changed — still real per-key granularity, just computed here rather
// than at each setting's own UI.
let lastSavedPrefs = null;
function touchChangedPrefKeys(nextPrefs){
  const prev = lastSavedPrefs || {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(nextPrefs)]);
  keys.forEach(k => {
    if(JSON.stringify(prev[k]) !== JSON.stringify(nextPrefs[k])) touchBackupKey('prefs', k);
  });
  lastSavedPrefs = nextPrefs;
}

async function saveMeta(){
  if(!storage.available()) return;
  // playlists/albumOrder hold track ids, not positions (F3 spec) — they're
  // written straight through, including any id whose track isn't
  // currently in the library (forgotten, not yet reconnected); dropping
  // those here would be a write-back bug (a reconnected track would never
  // rejoin its playlist/order)
  await meta.put('playlists', S.playlists.map(p => ({name:p.name, items:p.items.slice(), system:p.system})));
  await meta.put('albumOrder', S.albumOrder);
  await meta.put('albumSort', S.albumSort);
  const nextPrefs = serializePrefs(S);
  await meta.put('prefs', nextPrefs);
  touchChangedPrefKeys(nextPrefs);
  await meta.put('backupUpdatedAt', S.backupUpdatedAt);
  // RF17: playlist membership's own per-(playlist,track) add-wins stamps —
  // persisted alongside backupUpdatedAt/backupSeq, the same "survive a
  // reload" reasoning.
  await meta.put('playlistMembershipAt', S.playlistMembershipAt);
  // RF16 (docs/12_REFINE.md): S.backupSeq only ever moves forward (bumped by
  // touchBackupKey()/touchBackupMembership() at every field's own touch
  // site; bumped again on pull by sync/backup.js's own meta.put) —
  // persisted here too so a plain local edit's bump survives a reload
  // even before the next sign-in/sync ever runs.
  await meta.put('backupSeq', S.backupSeq);
  scheduleBackupSync();
}

export async function restoreMeta(){
  const pl = await meta.get('playlists');
  if(pl) S.playlists = pl.map(p => ({name:p.name, items:p.items.slice(), system:p.system}));
  const ord = await meta.get('albumOrder');
  if(ord) S.albumOrder = ord;
  const srt = await meta.get('albumSort');
  if(srt) S.albumSort = srt;
  const bua = await meta.get('backupUpdatedAt');
  if(bua) Object.assign(S.backupUpdatedAt, bua);
  const bseq = await meta.get('backupSeq');
  if(typeof bseq === 'number') S.backupSeq = bseq;
  const pma = await meta.get('playlistMembershipAt');
  if(pma) Object.assign(S.playlistMembershipAt, pma);
  const hca = await meta.get('historyClearedAt');
  if(typeof hca === 'number') S.historyClearedAt = hca;
  // RF4 (docs/12_REFINE.md) — restores the last pull's merged counter
  // totals so a reload doesn't lose them before the next sync; null (never
  // pulled, or signed out) leaves S.mergedStats at its own default, and
  // every reader already falls back to its matching local counter then.
  const ms = await meta.get('mergedStats');
  if(ms) S.mergedStats = ms;
  const pr = await meta.get('prefs');
  if(pr){
    // RF17: seed the diff cache with what was actually loaded, so the very
    // next saveMeta() only stamps keys that genuinely change from here —
    // not every key, which a null cache would otherwise read as "all new".
    lastSavedPrefs = pr;
    applyPrefs(parsePrefs(pr));
  }
}

function applyPrefs(p){
  if(p.char){ Object.keys(S.char).forEach(k => { if(typeof p.char[k] === 'number') S.char[k] = p.char[k]; }); }
  // scratch is a boolean, not a slider percentage, and a saved prefs object
  // from before F2 won't have it at all — missing must mean On, so S.char's
  // own default (true) is left alone unless a saved value says otherwise
  if(p.char && typeof p.char.scratch === 'boolean'){
    S.char.scratch = p.char.scratch;
  }
  const scratchBtn = $('#scratchBtn');
  if(scratchBtn){
    scratchBtn.textContent = S.char.scratch ? 'On' : 'Off';
    scratchBtn.setAttribute('aria-pressed', String(S.char.scratch));
  }
  if(typeof p.target === 'number') S.target = p.target;
  if(p.pace) S.pace = p.pace;
  if(typeof p.auto === 'boolean') S.auto = p.auto;
  if(p.librarySort) S.librarySort = p.librarySort;
  if(typeof p.sleevePullEnabled === 'boolean'){
    S.sleevePullEnabled = p.sleevePullEnabled;
    const b = $('#sleevePullBtn');
    b.textContent = S.sleevePullEnabled ? 'On' : 'Off';
    b.setAttribute('aria-pressed', String(S.sleevePullEnabled));
  }
  if(typeof p.bgAudio === 'boolean'){ S.bgAudio = p.bgAudio; bgUpdateUI(); applyBgAudioSetting(); }
  if(typeof p.launchIntro === 'boolean'){ S.launchIntro = p.launchIntro; attachLaunchSettingRow(); }
  if(p.libraryLayout === 'crate' || p.libraryLayout === 'list'){
    S.libraryLayout = p.libraryLayout;
    // this runs before the library's first render, while the view is still
    // at its pristine top-level default, so keep the two in sync (S1/S2 spec)
    if(S.view.mode === 'crate' || (S.view.mode === 'albums' && S.view.group === null)){
      S.view.mode = (S.libraryLayout === 'crate') ? 'crate' : 'albums';
    }
    document.querySelectorAll('#libLayoutToggle [data-layout]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.layout === S.libraryLayout)));
  }
  if(p.crateGroup === 'az' || p.crateGroup === 'genre' || p.crateGroup === 'decade') S.crateGroup = p.crateGroup;
  if(p.crateAnchor) S.crateAnchor = p.crateAnchor;
  if(typeof p.albumSides === 'boolean'){
    S.albumSides = p.albumSides;
    document.querySelectorAll('#sidesToggle [data-sides]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.sides === (S.albumSides ? 'on' : 'off'))));
  }
  if(typeof p.sealedRecords === 'boolean'){
    S.sealedRecords = p.sealedRecords;
    document.querySelectorAll('#sealedToggle [data-sealed]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.sealed === (S.sealedRecords ? 'on' : 'off'))));
  }
  if(typeof p.playInFullPlayer === 'boolean'){
    S.playInFullPlayer = p.playInFullPlayer;
    document.querySelectorAll('#playFullToggle [data-playfull]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.playfull === (S.playInFullPlayer ? 'on' : 'off'))));
  }
  if(p.shareStyle === 'night' || p.shareStyle === 'cover' || p.shareStyle === 'paper') S.shareStyle = p.shareStyle;
  // SH1 (docs/18_SHARE.md): merge onto the existing object, never replace
  // it wholesale -- the same "keep the object identity, merge the
  // restored keys onto it" shape S.eq's own restore already uses.
  if(p.shareFormatByCard) Object.assign(S.shareFormatByCard, p.shareFormatByCard);
  if(p.repeat && p.repeat !== S.repeat){ S.repeat = 'off'; for(let n=0;n<3 && S.repeat!==p.repeat;n++) cycleRepeat(); }
  if(p.shuffle && !S.shuffle) toggleShuffle();
  // D2: theme has no dedicated UI side effect of its own here, the way
  // sleevePullEnabled/bgAudio do above -- applyTheme() is called
  // unconditionally below regardless of whether a saved value exists, so
  // it also re-applies S.theme's own default (Auto) correctly on a
  // restore where this field simply isn't there yet. DA4 added
  // 'nychthemeron' to the same enum here -- parsePrefs() (storage/
  // prefs.js) already accepts it, but this function keeps its own
  // independent copy of the check rather than trusting parsePrefs()'s
  // own filtering, so it needs the same addition or a saved Nychthemeron
  // choice would silently fail to restore here even though it survived
  // parsePrefs() correctly.
  if(p.theme === 'auto' || p.theme === 'light' || p.theme === 'dark' || p.theme === 'nychthemeron') S.theme = p.theme;
  applyTheme();
  // TY5: no dedicated aria sync of its own needed here — renderProfile()
  // rebuilds the Settings screen's switch fresh from S.largerText on every
  // open, the same reason the theme seg's buttons above need a live sync
  // (document.querySelectorAll) but this one doesn't.
  if(typeof p.largerText === 'boolean') S.largerText = p.largerText;
  applyLargerText();
  // DA2: no dedicated UI side effect call of its own the way bgAudio/
  // launchIntro have above — just sync the segmented control's own
  // aria-pressed state here, the same inline shape sleevePullEnabled's own
  // button sync above already uses, rather than a whole extra function for
  // three buttons.
  if(p.charDrift === 'off' || p.charDrift === 'subtle' || p.charDrift === 'full') S.charDrift = p.charDrift;
  document.querySelectorAll('[data-char-drift]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.charDrift === S.charDrift)));
  // RF9 (docs/12_REFINE.md): the "Tone today" chart's own restore-time
  // sync, alongside the drift seg's aria-pressed sync just above.
  updateToneCurveVisibility();
  // CEREMONY §6: called unconditionally, like applyTheme() above, so the
  // default (felt) is applied too; fire-and-forget, it only touches the DOM
  if(typeof p.slipmatCustom === 'boolean') S.slipmatCustom = p.slipmatCustom;
  if(typeof p.slipmatWordmark === 'boolean') S.slipmatWordmark = p.slipmatWordmark;
  if(typeof p.slipmatDim === 'boolean') S.slipmatDim = p.slipmatDim;
  applySlipmat();
  // "Decided" (docs/13_CRATE.md, CR7): no dedicated UI side effect of its
  // own -- applyDiscVariant() already re-runs once a track loads, so this
  // just syncs the Settings switch's own aria-pressed, the same inline
  // shape sealedRecords/playInFullPlayer use above.
  if(typeof p.paperLabelOnLossy === 'boolean') S.paperLabelOnLossy = p.paperLabelOnLossy;
  { const b = $('#paperLabelBtn'); if(b) b.setAttribute('aria-pressed', String(S.paperLabelOnLossy)); }
  // docs/15_SURFACE_NOISE.md §1: no dedicated UI side effect of their own —
  // just sync each seg/switch's own aria-pressed, the same inline shape
  // charDrift/paperLabelOnLossy already use above.
  if(p.surfaceNoise === 'off' || p.surfaceNoise === 'subtle' || p.surfaceNoise === 'well-loved') S.surfaceNoise = p.surfaceNoise;
  document.querySelectorAll('[data-surface-noise]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.surfaceNoise === S.surfaceNoise)));
  if(p.runoutLength === 'short' || p.runoutLength === 'normal' || p.runoutLength === 'until-lift') S.runoutLength = p.runoutLength;
  document.querySelectorAll('[data-runout-length]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.runoutLength === S.runoutLength)));
  if(typeof p.surfaceNoiseUnderMusic === 'boolean') S.surfaceNoiseUnderMusic = p.surfaceNoiseUnderMusic;
  { const b = $('#surfaceNoiseUnderMusicBtn'); if(b){ b.textContent = S.surfaceNoiseUnderMusic ? 'On' : 'Off'; b.setAttribute('aria-pressed', String(S.surfaceNoiseUnderMusic)); } }
  // docs/15_SURFACE_NOISE.md §4: same inline sync shape as the three above.
  if(typeof p.autoFlip === 'boolean') S.autoFlip = p.autoFlip;
  document.querySelectorAll('[data-auto-flip]').forEach(b =>
    b.setAttribute('aria-pressed', String((b.dataset.autoFlip === 'on') === S.autoFlip)));
  // RW3 (docs/23_RHYTHM_AND_WEAR.md): same inline text+aria-pressed sync
  // shape as surfaceNoiseUnderMusicBtn above -- no dedicated UI side
  // effect beyond the button's own label.
  if(typeof p.stopAtTurns === 'boolean') S.stopAtTurns = p.stopAtTurns;
  { const b = $('#stopAtTurnsBtn'); if(b){ b.textContent = S.stopAtTurns ? 'On' : 'Off'; b.setAttribute('aria-pressed', String(S.stopAtTurns)); } }
  // RW6: no dedicated UI sync of its own needed here, same reason as
  // largerText above — renderProfile() rebuilds the Settings screen's
  // switch fresh from S.seasonalSky on every open.
  if(typeof p.seasonalSky === 'boolean') S.seasonalSky = p.seasonalSky;
  // AU5 (docs/16_AUDIO.md §4): same inline [data-*] sync shape as the
  // controls above — no dedicated UI side effect beyond aria-pressed.
  if(p.loudnessMode === 'off' || p.loudnessMode === 'track' || p.loudnessMode === 'album' || p.loudnessMode === 'auto') S.loudnessMode = p.loudnessMode;
  document.querySelectorAll('[data-loudness]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.loudness === S.loudnessMode)));
  { const d = $('#loudnessDesc'); if(d) d.textContent = loudnessCaptionFor(S.loudnessMode); }
  // AU6 (docs/16_AUDIO.md §3): merge onto the existing S.eq object (same
  // "assign the fields that were actually saved" shape p.char gets above)
  // rather than replacing it wholesale — a key parsePrefs() left out
  // (missing from an older save, or one that failed its own check) keeps
  // whatever default/previous value S.eq already held. The EQ sheet
  // itself (src/player/eq-sheet.js) rebuilds its DOM fresh every time it's
  // opened, straight from S.eq, so there's no [data-*] aria-pressed sync
  // to do here the way loudnessMode's own simple button row needs.
  if(p.eq && typeof p.eq === 'object') Object.assign(S.eq, p.eq);
  // AU7 (docs/16_AUDIO.md §6): same inline [data-*]/slider-value sync shape
  // as loudnessMode above — no dedicated UI side effect beyond reflecting
  // the restored value onto whichever control is currently in the DOM.
  if(typeof p.mono === 'boolean') S.mono = p.mono;
  { const b = $('#monoBtn'); if(b){ b.textContent = S.mono ? 'On' : 'Off'; b.setAttribute('aria-pressed', String(S.mono)); } }
  if(typeof p.balance === 'number') S.balance = p.balance;
  { const s = $('#balanceSlider'); if(s) s.value = String(S.balance);
    const d = $('#balanceDesc'); if(d) d.textContent = balanceCaptionFor(S.balance); }
  if(typeof p.deviceVolume === 'number') S.deviceVolume = p.deviceVolume;
  { const s = $('#barVolume'); if(s) s.value = String(S.deviceVolume); }
  // No dedicated UI side effect of its own beyond the switch's own
  // text/aria-pressed — same inline sync shape as monoBtn/
  // surfaceNoiseUnderMusicBtn above.
  if(typeof p.zoetropesEnabled === 'boolean') S.zoetropesEnabled = p.zoetropesEnabled;
  { const b = $('#zoetropesBtn'); if(b){ b.textContent = S.zoetropesEnabled ? 'On' : 'Off'; b.setAttribute('aria-pressed', String(S.zoetropesEnabled)); } }
  // RF9 (docs/12_REFINE.md): [data-target]/[data-pace] were replaced by
  // one [data-depth] control -- this is the restore-time half of the
  // same depthKeyFor()/depthCaptionFor() sync src/wiring/sundown.js's
  // click handler already does, so a reload reflects a saved Off/Gentle/
  // Medium/Deep choice. S.pace itself needs no sync call here any more --
  // there's no [data-pace] control left to point its aria-pressed at.
  {
    const depthKey = depthKeyFor(S.auto, S.target);
    document.querySelectorAll('[data-depth]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.depth === depthKey)));
    const depthDesc = $('#depthDesc');
    if(depthDesc) depthDesc.textContent = depthCaptionFor(depthKey, S.target);
  }
  if(p.mode) setMode(p.mode);
  applyCharacter();
  applyVolume();
  applyLoudnessNorm();
  applyEQ();
  applyMonoBalance();
  applyDeviceVolume();
}
