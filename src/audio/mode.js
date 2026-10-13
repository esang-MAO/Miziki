import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { routeSource } from './engine.js';

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
}
