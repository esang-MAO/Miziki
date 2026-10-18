import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { routeSource, applyCharacter } from './engine.js';

export function setMode(m){
  S.mode = m;
  const vinyl = m === 'vinyl';
  document.documentElement.style.setProperty('--accent', vinyl ? 'var(--amber)' : 'var(--cool)');
  // RF15 (docs/12_REFINE.md): "Pure means untouched" has to show on the
  // platter's own label too, not just the colour swap above — see
  // .mode-pure .label.has-art in 02-stage-platter.css.
  document.documentElement.classList.toggle('mode-pure', !vinyl);
  // CEREMONY (docs/CEREMONY.md, §1): one toggle, not a two-button group —
  // a real switch (role="switch", aria-checked) whose own label text
  // reads the current mode, same as the mockup's "Label reads the
  // current mode" requirement.
  const toggle = $('#modeToggle'), label = $('#modeToggleLabel');
  if(toggle) toggle.setAttribute('aria-checked', String(vinyl));
  if(label) label.textContent = vinyl ? 'Vinyl' : 'Pure';
  // D4 (docs/DESKTOP_LAYOUT.md): the desktop player bar's own mode
  // toggle mirrors the same state — null-guarded the same way drawSun()
  // guards its sidebar mirror, since these ids exist only in the player
  // bar's own markup (miziki.html), hidden below 1024px by CSS.
  const barToggle = $('#barModeToggle'), barLabel = $('#barModeToggleLabel');
  if(barToggle) barToggle.setAttribute('aria-checked', String(vinyl));
  if(barLabel) barLabel.textContent = vinyl ? 'Vinyl' : 'Pure';
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
