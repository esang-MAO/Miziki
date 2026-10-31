// FS3 (docs/25_FROM_SCRATCH.md): the one switch component for the whole
// app, generalized from profile/storefront.js's old .store-switch. A real
// <button role="switch" aria-checked>, so Space/Enter toggling comes for
// free from the browser's own button semantics -- nothing extra to wire.
//
// `row`, when passed, is the whole settings-row element the switch sits
// in: clicking anywhere in that row toggles it too ("the label taps it
// too"), without double-firing when the click actually lands on the
// switch's own button.
export function makeSwitch({checked, label, onChange, row}){
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'switch';
  sw.setAttribute('role', 'switch');
  if(label) sw.setAttribute('aria-label', label);
  sw.setAttribute('aria-checked', String(!!checked));
  const track = document.createElement('span');
  track.className = 'switch-track';
  track.appendChild(document.createElement('i'));
  sw.appendChild(track);
  const toggle = () => {
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    onChange(on);
  };
  sw.addEventListener('click', toggle);
  if(row){
    row.classList.add('switch-row');
    row.addEventListener('click', (e) => {
      if(e.target === sw || (sw.contains && sw.contains(e.target))) return;
      toggle();
    });
  }
  return sw;
}
