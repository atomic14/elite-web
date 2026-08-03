// What the setup panel says under its rows, and the tallest it can ever say it.
//
// The prose half of the combat trainer's setup panel, split from
// combat-sim-setup.ts because the two answer different questions. That file
// owns the draft and the cells that mutate it — a cell is a closure over the
// draft, which is why the rows must stay beside it — and this one only ever
// READS a draft in order to describe it. Pure, like its neighbour: no DOM, no
// Input, no Game.
//
// The second half of the file is the unusual part. Every note here is
// conditional, so one appearing mid-interaction pushed every row below it down
// by a line — about 17px, which is enough that the row under the cursor stops
// being the row the cursor is on, and you change a setting you were not
// pointing at. So each block also states the tallest it could EVER be, for any
// draft, and the renderer paints that invisibly underneath the live text to
// hold the height open. That is why the reserves take no argument: an upper
// bound that moved with the draft would not be one.

import {
  SCENARIOS, SHIPPED_DEFENCE_BRAIN, SHIPPED_PACK_BRAIN, SHIPPED_SOLO_BRAIN,
  WAVE_SATURATION, WAVE_STEPS, waveOfStage, type SimMode,
} from '../combat-sim-scenarios.ts';
import {
  AS_SHIPPED, AS_THE_GAME_FLIES, LIVE_BRAIN_IDS, brainCharacter, brainName,
  type LiveBrainId,
} from '../brain-names.ts';
import type { SimDraft } from './combat-sim-setup.ts';

const MODE_BLURB: Record<SimMode, string> = {
  scenario: 'ONE NAMED FIGHT, SCORED, ENDS BY ITSELF',
  sparring: 'ONE OPPONENT, RESPAWNING, PATCHED UP BETWEEN ROUNDS',
  waves: 'ESCALATING WAVES UNTIL YOU DIE — HOW MANY CAN YOU TAKE?',
};

const MIXED_BRAINS = 'MIXED BRAINS CANNOT FLY: THE GAME LOADS ONE POLICY PER ROLE, '
  + 'SO THE LIVE BRAINS WILL. SET THE OPPOSITION FLIES (THIS FIGHT) ROW INSTEAD.';

/**
 * What the waves mode escalates, and where it stops — DERIVED from the ramp.
 *
 * Typed out, this would be a second home for the step table, wrong the day
 * somebody adds a step or moves the cadence. The pilot needs to know two things
 * before launching: that the ramp has a top, and that it is not just more ships.
 */
const wavesRamp = (): string =>
  `PAST WAVE ${waveOfStage(1) - 1} THE NUMBERS STOP AND THE FIGHT CHANGES: `
  + `${WAVE_STEPS.map((s, i) => `${s.name} AT ${waveOfStage(i + 1)}`).join(', ')} `
  + `— AND NO HARDER FROM ${WAVE_SATURATION} ON.`;

/** `YOUR FURTHEST: WAVE 13.` — the one thing a run leaves behind. */
const bestWave = (n: number): string =>
  (n > 0 ? ` YOUR FURTHEST: WAVE ${n}.` : ' YOU HAVE NOT FLOWN ONE YET.');

/**
 * The longest of a set of strings.
 *
 * A proxy for "the tallest", and an honest one here: the panel is set in the
 * HUD's monospace face at a fixed size, so more characters is more lines.
 */
const longest = (xs: readonly string[]): string =>
  xs.reduce((a, b) => (b.length > a.length ? b : a), '');

// --- the contextual help ----------------------------------------------------

/** What the panel says under the rows: the mode, the fight, and any warning. */
export function draftNotes(d: SimDraft): string[] {
  const out: string[] = [MODE_BLURB[d.mode] + (d.mode === 'waves' ? bestWave(d.furthestWave) : '')];
  // The waves mode sends the RAMP, and only the ramp: `nextOpposition` builds
  // every one of its rounds from the wave number, so a hand-built opposition is
  // not flown in it at all. That is why its second slot is the ramp and why the
  // mixed-brains complaint is not shown here — it is a warning about groups this
  // mode was never going to send.
  if (d.mode === 'waves') { out.push(wavesRamp()); return out; }
  if (d.groups.length === 0) out.push(SCENARIOS[d.scenario].blurb.toUpperCase());
  const asked = new Set(d.groups
    .filter((g) => g.brain !== AS_THE_GAME_FLIES).map((g) => g.brain));
  if (d.brain === AS_THE_GAME_FLIES && asked.size > 1) out.push(MIXED_BRAINS);
  return out;
}

/**
 * The tallest `draftNotes` can ever be, slot for slot.
 *
 * TWO slots, not three, and that is the whole subtlety: the fight's blurb is
 * only shown when the opposition comes from the scenario table, and the
 * mixed-brains complaint needs two hand-built groups, so the second and third
 * notes can never both be there. One slot holds whichever of them is longer.
 *
 * Each slot holds the longest thing it can ever hold, for ANY draft, so the
 * reserve is at least as tall as the notes — wrapping included, because the
 * panel is set in a monospace face at a fixed size.
 */
export function draftNotesReserve(): string[] {
  return [
    // The waves blurb carries the best wave, so the bound has to include every
    // tail it can grow — the never-flown line, and a three-digit wave nobody
    // will ever reach.
    longest(Object.values(MODE_BLURB).flatMap((b) => [b + bestWave(999), b + bestWave(0)])),
    longest([...SCENARIOS.map((s) => s.blurb.toUpperCase()), MIXED_BRAINS, wavesRamp()]),
  ];
}

// --- what the brain on the selected row actually does ------------------------
//
// A block of its own rather than a fourth line of the help above, and the
// reason is the reservation: the help's slots are "the mode" and "the fight or
// the complaint", so a line that comes and goes with the CURSOR rather than
// with the draft would land in slot 1 or slot 2 depending on the fight, and a
// per-slot upper bound would stop meaning anything. Its own block is its own
// bound.

/**
 * The exercise picker's "leave it alone" value, described the way a brain is.
 *
 * It is not a policy, so it has no character; what a pilot needs to know is that
 * nothing is being swapped, and what that leaves him fighting. In plain words —
 * the line it replaced said "NO OVERRIDE … BY ITS ROLE AND ITS TIER", which
 * presupposes you know there is an override and uses two words that are ours
 * rather than a pilot's.
 */
const NO_OVERRIDE = 'NOTHING IS SWAPPED OUT FOR THIS FIGHT — EVERY SHIP FLIES THE WAY IT '
  + 'WOULD OUT THERE: A PIRATE LIKE A PIRATE, A GANG LIKE A GANG, AN ARMED TRADER LIKE AN '
  + 'ARMED TRADER.';

/**
 * The career picker's "no override" value, DERIVED from the shipped rule.
 *
 * Three names that must not be typed out here: `SHIPPED_BRAINS` is the one line
 * that changes the default, and a hand-written list of what it currently means
 * would be a second home for it, wrong on the day somebody promotes a candidate.
 * The NAMES come from the same table for the same reason, and they are what a
 * pilot reads — the file stems follow, for the training log.
 */
const shippedSet = (): string =>
  ('THE ORIGINAL — SOLO PIRATE: ' + brainName(SHIPPED_SOLO_BRAIN)
    + ' · ORGANISED GANG: ' + brainName(SHIPPED_PACK_BRAIN)
    + ' · ARMED TRADER: ' + brainName(SHIPPED_DEFENCE_BRAIN)
    + ` (${SHIPPED_SOLO_BRAIN}, ${SHIPPED_PACK_BRAIN}, ${SHIPPED_DEFENCE_BRAIN}).`).toUpperCase();

/**
 * What the brain named on the selected row DOES — or null when the row names
 * none, which is most of them.
 *
 * The picker's two sentinels are answered here and every real policy is
 * answered by `game/brain-names.ts`, which owns naming and holds no weights.
 */
export function brainNote(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id === AS_THE_GAME_FLIES) return NO_OVERRIDE;
  if (id === AS_SHIPPED) return shippedSet();
  const character = brainCharacter(id);
  if (!character) return null;
  // The stem last, and only here. It is a build artefact and a pilot choosing
  // between `pirate-attack-g3` and `pirate-pack-r4-selectonly` is choosing
  // between file names — so it is out of the value column entirely and lives at
  // the end of the sentence, for whoever is cross-referencing
  // docs/TRAINING-LOG.md.
  return `${character} (${id.toUpperCase()})`;
}

/**
 * The tallest `brainNote` can ever be.
 *
 * Every id put THROUGH `brainNote`, not the raw character lines. Those two
 * stopped being the same thing the moment the file stem moved into the note:
 * the reserve went on measuring the character alone, so the space held was
 * shorter than the sentence it was holding space for and the panel jumped by a
 * line when a long-stemmed brain was selected. Same failure `careerNoteReserve`
 * documents — measure the SENTENCE, never the longest ingredient.
 */
export function brainNoteReserve(): string {
  return longest([
    ...LIVE_BRAIN_IDS.map((id) => brainNote(id) ?? ''), NO_OVERRIDE, shippedSet(),
  ]);
}

// --- the one note that is not about this exercise ---------------------------

const FROM_THE_CONSOLE = 'LIVE BRAINS WERE SET FROM THE CONSOLE TO SOMETHING THIS PICKER '
  + 'CANNOT NAME — ARROW THIS ROW TO TAKE IT BACK.';

/**
 * The career warning, worded so it cannot be read as more contextual help.
 *
 * The help above it describes the fight you are about to fly. This describes a
 * state you are IN, out there, after you leave — which is a thing a pilot can
 * set once and forget, so it says where it applies and how to undo it rather
 * than what it does.
 */
const galaxyFlies = (id: LiveBrainId): string =>
  `LIVE BRAINS: THE WHOLE GALAXY FLIES ${brainName(id)} (${id.toUpperCase()}) — IN YOUR `
  + 'GAME, OUT THERE, AND SAVED WITH THE COMMANDER. SET THIS ROW BACK TO THE ORIGINAL TO UNDO IT.';

/**
 * What the fence says when there is nothing to warn about.
 *
 * The reserved space has to be held whether or not a warning is in it, and held
 * space that is empty reads as a hole rather than as a promise. So the calm case
 * states the calm fact — in a quiet green, not the warning's red, because a
 * pilot must be able to tell the two apart without reading either.
 *
 * It read "AS SHIPPED — NOTHING HERE FOLLOWS YOU OUT", which was true of the
 * VALUE and flatly contradicted the heading above it, which is true of the ROW.
 * Sitting two lines apart the pair cancelled out. The calm case now says what
 * changing the row would do, because that is what the fence is warning about.
 */
const AS_SHIPPED_NOTE =
  'THE ORIGINAL — YOUR CAREER IS UNCHANGED. ANY OTHER VALUE HERE APPLIES OUT THERE TOO.';

/** The line under the fenced row, and whether it is a warning or a status. */
export interface CareerNote {
  text: string;
  /** true when the career is flying something other than the shipped set */
  warning: boolean;
}

/** The note under the fenced row. Always present; only sometimes a warning. */
export function careerNote(d: SimDraft): CareerNote {
  if (d.live === null) return { text: FROM_THE_CONSOLE, warning: true };
  return d.live === AS_SHIPPED
    ? { text: AS_SHIPPED_NOTE, warning: false }
    : { text: galaxyFlies(d.live), warning: true };
}

/**
 * The tallest `careerNote` can ever be.
 *
 * Every id the row can hold, put through the sentence — not the longest ID put
 * through it, which stopped being the longest SENTENCE the moment the name went
 * in front of the stem.
 */
export function careerNoteReserve(): string {
  return longest([FROM_THE_CONSOLE, ...LIVE_BRAIN_IDS.map(galaxyFlies)]);
}
