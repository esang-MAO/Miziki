import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { routeSource, applyCharacter } from './engine.js';

export function setMode(m){
  S.mode = m;
  const vinyl = m === 'vinyl';
  document.documentElement.style.setProperty('--accent', vinyl ? 'var(--amber)' : 'var(--cool)');
  $('#modeVinyl').setAttribute('aria-pressed', String(vinyl));
  $('#modePure').setAttribute('aria-pressed', String(!vinyl));
  // D4 (docs/DESKTOP_LAYOUT.md): the desktop player bar's own mode
  // buttons mirror the same state — null-guarded the same way drawSun()
  // guards its sidebar mirror, since these ids exist only in the player
  // bar's own markup (miziki.html), hidden below 1024px by CSS.
  const barVinyl = $('#barModeVinyl'), barPure = $('#barModePure');
  if(barVinyl) barVinyl.setAttribute('aria-pressed', String(vinyl));
  if(barPure) barPure.setAttribute('aria-pressed', String(!vinyl));
  $('#modeTag').textContent = m;
  $('#modeNote').textContent = vinyl
    ? 'Vinyl adds character on purpose: platter wobble, gentle saturation, a softer top end, a light squeeze. Dial it in under Character.'
    : 'Pure is the reference: decode straight to the output, nothing added — always at full speed. Sundown\'s slow-down is a Vinyl thing, part of the platter.';
  if(S.source) routeSource(S.source);
  // DA2 (docs/DAY_ARC.md): applyCharacter() now also gates on S.mode (Pure
  // forces drift to 'off' regardless of S.charDrift — see engine.js's own
  // comment), so every one of this function's own callers needs the Vinyl
  // chain's nodes re-applied the moment a switch actually happens, not
  // left holding whichever gate was in effect up to 30s ago — not just the
  // few call sites that already happened to call applyCharacter() of
  // their own accord afterward (storage/meta.js's applyPrefs() still does,
  // redundantly but harmlessly, right after its own setMode(p.mode) call).
  applyCharacter();
}
