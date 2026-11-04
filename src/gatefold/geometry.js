/* GF2/GF3 (docs/29_GATEFOLD.md): one pure, exported, tested function for
   the gatefold's own pixel geometry -- panel size, pan distance, pocket
   size and disc diameter -- replacing literals that used to be scattered
   independently through gatefold/view.js and 11-gatefold.css (view.js's
   own updateGatefoldScale() duplicated the CSS's 390/740 rather than
   sharing it). GF2 made this one function; GF3 is the step that makes it
   actually vary by format (point 1's panel sizes: 12" 350px, 10" 292px,
   7" 204px) instead of always returning the 12" numbers. Pan distance,
   pocket size (the sleeve paper's thumb-cut cutout) and disc diameter
   all scale proportionally off the panel size, at the same ratio the 12"
   case already used -- a 156px disc and a 132px cutout against a 350px
   panel (point 2: "drawn at true relative size"). viewport is accepted
   but unused so far (leading underscore, CLAUDE.md's deliberately-
   unused-argument convention) -- nothing here varies by viewport. */
const PANEL_SIZE_BY_RECORD_SIZE = { '7"': 204, '10"': 292, '12"': 350 };
const DISC_TO_PANEL_RATIO = 156 / 350;
const POCKET_TO_PANEL_RATIO = 132 / 350;

export function gatefoldGeometry(format, _viewport){
  const panelSize = (format && PANEL_SIZE_BY_RECORD_SIZE[format.size]) || PANEL_SIZE_BY_RECORD_SIZE['12"'];
  return {
    referenceWidth: 390,
    referenceHeight: 740,
    panelSize,
    panDistance: panelSize / 2,
    pocketSize: Math.round(panelSize * POCKET_TO_PANEL_RATIO),
    discDiameter: Math.round(panelSize * DISC_TO_PANEL_RATIO),
  };
}
