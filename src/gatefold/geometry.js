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
// tagged multi-disc album with more than 2 discs gets additional rows,
// up to 3 discs across each -- never a size cap (that cap stays CC5's
// own, on a *computed* double/quad LP from a too-long single disc, via
// splitSingleDiscGroups()'s bestSideCuts(durations, 4) in
// ceremony-timing.js, untouched by this function). row 0 is the front
// row (today's plain two-disc position); each higher row is one row
// further back.
//
// Design-mockup follow-up (Ken, 2026-11-09): "For albums that have 3
// discs it should just be 1 row of 3 across. For 4, then 2 rows of 2...
// For 5: bottom row has 3, top has 2. For 6: 2 rows of 3." Rows of up to
// 3 (never an unpaired front disc) with any remainder absorbed by the
// front row(s) first, so a count that doesn't split evenly always puts
// the fuller row in front, never the back.
//
// x is each disc's horizontal offset from center, in units of one
// disc-width-plus-gap (CSS turns it into an actual px offset) -- -1/0/1
// for a row of 3, -0.5/0.5 for a row of 2, 0 alone for a row of 1.
export function gatefoldRowLayout(n){
  if(n <= 0) return [];
  const maxPerRow = 3;
  const numRows = Math.max(1, Math.ceil(n / maxPerRow));
  const base = Math.floor(n / numRows);
  const extra = n % numRows;
  const rowCounts = [];
  for(let row = 0; row < numRows; row++) rowCounts.push(base + (row < extra ? 1 : 0));
  const xOffsetsFor = count => count === 1 ? [0] : count === 2 ? [-0.5, 0.5] : [-1, 0, 1];
  const layout = [];
  rowCounts.forEach((count, row) => {
    xOffsetsFor(count).forEach(x => layout.push({ row, x }));
  });
  return layout;
}
