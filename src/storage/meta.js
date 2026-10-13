import { S, touchBackupField } from '../state.js';
import { $ } from '../util/dom.js';
import { storage, meta } from './repo.js';
import { serializePrefs, parsePrefs } from './prefs.js';
import { setMode } from '../audio/mode.js';
import { applyCharacter } from '../audio/engine.js';
import { applyVolume } from '../sundown/location.js';
import { toggleShuffle, cycleRepeat } from '../player/controls.js';
import { bgUpdateUI, applyBgAudioSetting } from '../player/background.js';
import { attachLaunchSettingRow } from '../launch/intro.js';
import { scheduleBackupSync } from '../sync/backup.js';
import { applyTheme } from '../ui/theme.js';

/* ================= persistence =================
   The rest of what gets saved, on top of the raw IndexedDB wrapper (`DB`,
   src/storage/idb.js, step 4a): queueSave()/saveMeta()/restoreMeta() and the
   various persist*() helpers elsewhere read and write through it. If storage
   is unavailable, every DB call quietly no-ops and Miziki behaves exactly as
   it did before: fully working, session-only. */

let saveTimer = null;
export function queueSave(){
  if(!storage.available()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveMeta, 600);
}

// touchBackupField (step 06, B3) lives in state.js, not here — see its own
// comment there for why. prefs has no finer-grained merge unit than the
// whole prefs object (unlike playlists/albumOrder/albumSort, each touched
// at its own real mutation site instead), so saveMeta() is the one place
// that field's timestamp is stamped, every time it runs.
async function saveMeta(){
  if(!storage.available()) return;
  // playlists/albumOrder already hold track ids, not positions (F3 spec,
  // step 02) — they're written straight through, including any id whose
  // track isn't currently in the library (forgotten, not yet reconnected);
  // dropping those here is exactly the write-back bug step 02 fixed
  await meta.put('playlists', S.playlists.map(p => ({name:p.name, items:p.items.slice(), system:p.system})));
  await meta.put('albumOrder', S.albumOrder);
  await meta.put('albumSort', S.albumSort);
  await meta.put('prefs', serializePrefs(S));
  touchBackupField('prefs');
  await meta.put('backupUpdatedAt', S.backupUpdatedAt);
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
  const hca = await meta.get('historyClearedAt');
  if(typeof hca === 'number') S.historyClearedAt = hca;
  const pr = await meta.get('prefs');
  if(pr) applyPrefs(parsePrefs(pr));
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
  if(p.crateGroup === 'az' || p.crateGroup === 'genre') S.crateGroup = p.crateGroup;
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
  if(p.shareFormat === 'story' || p.shareFormat === 'portrait' || p.shareFormat === 'square') S.shareFormat = p.shareFormat;
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
  // DA2: no dedicated UI side effect call of its own the way bgAudio/
  // launchIntro have above — just sync the segmented control's own
  // aria-pressed state here, the same inline shape sleevePullEnabled's own
  // button sync above already uses, rather than a whole extra function for
  // three buttons.
  if(p.charDrift === 'off' || p.charDrift === 'subtle' || p.charDrift === 'full') S.charDrift = p.charDrift;
  document.querySelectorAll('[data-char-drift]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.charDrift === S.charDrift)));
  // push the restored values back into the controls
  Object.keys(S.char).forEach(k => {
    const el2 = $('#'+k); if(el2){ el2.value = Math.round(S.char[k]*100); }
    const out = $('#'+k+'Out'); if(out) out.textContent = Math.round(S.char[k]*100) + '%';
  });
  document.querySelectorAll('[data-target]').forEach(b => b.setAttribute('aria-pressed', String(parseFloat(b.dataset.target) === S.target)));
  document.querySelectorAll('[data-pace]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pace === S.pace)));
  if(p.mode) setMode(p.mode);
  applyCharacter();
  applyVolume();
}
