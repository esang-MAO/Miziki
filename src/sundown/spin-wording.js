/* ---- DA6 (docs/DAY_ARC.md): "spun at dusk" -- the day-arc phase a
   record was playing in, turned into the short prepositional phrase
   friends see it rendered as. One table, reused verbatim in three
   places: the home feed's now-spinning row ("Spinning [Album] at
   dusk"), a friend's crate page header line ("Now spinning [Album] at
   golden hour"), and the Now Playing share card's own line ("SPUN AT
   DUSK"). Pure, no imports -- the phase itself always comes from
   src/sundown/solar.js's currentDayPosition()/realDayPosition(), never
   computed here. ---- */
export const SPIN_PHASE_WORDING = {
  night: 'late at night',
  dawn: 'at dawn',
  morning: 'this morning',
  midday: 'at midday',
  afternoon: 'this afternoon',
  golden: 'at golden hour',
  twilight: 'at dusk',
};

// GS8/GS9 (docs/30_GROOVES_AND_SHELF.md): a short, all-caps single word
// for a mono readout (the profile wall's "recently found" line, the
// Listening screen's played-through log's own mono line) -- the same
// seven phases as SPIN_PHASE_WORDING above, just the bare noun rather
// than its "at dusk"/"this morning" sentence form.
export const PHASE_CAPS = {
  night: 'NIGHT', dawn: 'DAWN', morning: 'MORNING', midday: 'MIDDAY',
  afternoon: 'AFTERNOON', golden: 'GOLDEN HOUR', twilight: 'DUSK',
};

/** The bare wording for a phase ("at dusk"), or null for an unknown/missing
    phase (an older client's row that never sent one, or a stale/garbled
    value) -- callers render nothing rather than "undefined". */
export function spinPhaseWording(phase){
  return SPIN_PHASE_WORDING[phase] || null;
}

/** The exact chip text the Now Playing share card draws ("SPUN AT DUSK"),
    or null when the Include switch is off or the phase can't be worded --
    the one function that also knows about the include flag, so the card
    composer itself never has to special-case "include is false" vs.
    "phase is unknown" differently. */
export function spinChipText(phase, include){
  if(include === false) return null;
  const wording = spinPhaseWording(phase);
  return wording ? ('SPUN ' + wording).toUpperCase() : null;
}
