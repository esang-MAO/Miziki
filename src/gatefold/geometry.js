/* GF2/GF3 (docs/29_GATEFOLD.md): one pure, exported, tested function for
   the gatefold's own pixel geometry -- panel size, pan distance, pocket
   size and disc diameter -- replacing literals that used to be scattered
   independently through gatefold/view.js and 11-gatefold.css (view.js's
   own updateGatefoldScale() duplicated the CSS's 390/740 rather than
   sharing it).

   GF3 briefly made this vary by format (12" 350px, 10" 292px, 7" 204px),
   mirroring real relative record sizes the way the platter's own SZ1
   to-scale drawing does. Ken, 2026-11-05: the gatefold's own display
   should stay one uniform size for every record regardless of format --
   unlike the platter (which draws a record actually spinning, where the
   size difference is part of what's being shown), the gatefold is a
   browsing view, and a 7" single shrinking the whole spread read as
   broken rather than intentional. format is kept as a parameter (callers
   still pass it) so a future format-aware layout tweak doesn't need a
   new call shape, but it no longer changes the numbers below. */
const PANEL_SIZE = 350;
const DISC_DIAMETER = 156;
const POCKET_SIZE = 132;

export function gatefoldGeometry(_format, _viewport){
  return {
    referenceWidth: 390,
    referenceHeight: 740,
    panelSize: PANEL_SIZE,
    panDistance: PANEL_SIZE / 2,
    pocketSize: POCKET_SIZE,
    discDiameter: DISC_DIAMETER,
  };
}

// Box-set follow-up to CC5 (docs/34_CARE_AND_CONTROL.md point 5): a real
// tagged multi-disc album with more than 2 discs gets additional rows of
// 2, straight back, in the exact same left/right positions the existing
// two-disc row already uses -- never a size cap (that cap stays CC5's
// own, on a *computed* double/quad LP from a too-long single disc, via
// splitSingleDiscGroups()'s bestSideCuts(durations, 4) in
// ceremony-timing.js, untouched by this function). row 0 is the front
// row (today's plain two-disc position); each higher row is one row
// further back. An odd disc out sits alone, centered, as its own row at
// the very back -- Ken, 2026-11-09: "The odd one out should be in the
// back" -- never as an unpaired front disc.
export function gatefoldRowLayout(n){
  if(n <= 0) return [];
  const pairRows = Math.floor(n / 2);
  const hasOdd = n % 2 === 1;
  const layout = [];
  for(let i = 0; i < n; i++){
    const isOddLast = hasOdd && i === n - 1;
    layout.push({
      row: isOddLast ? pairRows : Math.floor(i / 2),
      col: isOddLast ? 'center' : (i % 2 === 0 ? 'left' : 'right'),
    });
  }
  return layout;
}
