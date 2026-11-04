/* GF2 (docs/29_GATEFOLD.md point 2): one pure, exported, tested function
   for the gatefold's own pixel geometry -- panel size, pan distance,
   pocket size and disc diameter -- replacing the 175px pan, the 390x740
   reference canvas and the 350px panel literals that used to be
   scattered independently through gatefold/view.js and 11-gatefold.css
   (view.js's own updateGatefoldScale() duplicated the CSS's 390/740
   rather than sharing it). format/viewport are accepted now but unused
   (leading underscore, CLAUDE.md's "deliberately unused argument" rule)
   -- this PR returns today's 12" numbers for every record and viewport,
   so nothing changes visually; GF3 is the step that makes these vary by
   format. */
export function gatefoldGeometry(_format, _viewport){
  return {
    referenceWidth: 390,
    referenceHeight: 740,
    panelSize: 350,
    panDistance: 175,
    pocketSize: 156,
    discDiameter: 156,
  };
}
