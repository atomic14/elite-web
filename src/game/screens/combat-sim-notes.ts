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
  SCENARIOS, SHIPPED_DEFENCE_BRAIN, SHIPPED_PACK_BRAIN, SHIPPED_SOLO_BRAIN, type SimMode,
} from '../combat-sim-scenarios.ts';
import {
  AS_SHIPPED, BRAIN_CHARACTER, LIVE_BRAIN_IDS, brainCharacter, type LiveBrainId,
} from '../brain-names.ts';
import { AS_THE_GAME_FLIES, type SimDraft } from './combat-sim-setup.ts';

const MODE_BLURB: Record<SimMode, string> = {
  scenario: 'ONE NAMED FIGHT, SCORED, ENDS BY ITSELF',
  sparring: 'ONE OPPONENT, RESPAWNING, PATCHED UP BETWEEN ROUNDS',
  waves: 'ESCALATING WAVES UNTIL YOU DIE — HOW MANY CAN YOU TAKE?',
};

const MIXED_BRAINS = 'MIXED BRAINS CANNOT FLY: THE GAME LOADS ONE POLICY PER ROLE, '
  + 'SO THE LIVE BRAINS WILL. SET THE EXERCISE BRAIN ROW INSTEAD.';

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
  const out: string[] = [MODE_BLURB[d.mode]];
  if (d.mode !== 'waves' && d.groups.length === 0) {
    out.push(SCENARIOS[d.scenario].blurb.toUpperCase());
  }
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
    longest(Object.values(MODE_BLURB)),
    longest([...SCENARIOS.map((s) => s.blurb.toUpperCase()), MIXED_BRAINS]),
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
 * The exercise picker's "no override" value, described the way a brain is.
 *
 * It is not a policy, so it has no character; what a pilot needs to know is
 * that the answer comes from somewhere else, and where.
 */
const NO_OVERRIDE = 'NO OVERRIDE — EVERY SHIP FLIES WHAT THE LIVE GAME WOULD GIVE IT, '
  + 'BY ITS ROLE AND ITS TIER.';

/**
 * The career picker's "no override" value, DERIVED from the shipped rule.
 *
 * Three names that must not be typed out here: `SHIPPED_BRAINS` is the one line
 * that changes the default, and a hand-written list of what it currently means
 * would be a second home for it, wrong on the day somebody promotes a candidate.
 */
const shippedSet = (): string =>
  (`AS SHIPPED — ${SHIPPED_SOLO_BRAIN} SOLO, ${SHIPPED_PACK_BRAIN} FOR ORGANISED GANGS, `
    + `${SHIPPED_DEFENCE_BRAIN} FOR ARMED TRADERS.`).toUpperCase();

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
  return brainCharacter(id) ?? null;
}

/** The tallest `brainNote` can ever be: the longest line any brain has. */
export function brainNoteReserve(): string {
  return longest([...Object.values(BRAIN_CHARACTER), NO_OVERRIDE, shippedSet()]);
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
  `LIVE BRAINS: THE WHOLE GALAXY FLIES ${id.toUpperCase()} — IN YOUR CAREER, OUT THERE, `
  + 'AND SAVED WITH THE COMMANDER. SET THIS ROW BACK TO AS SHIPPED TO UNDO IT.';

/**
 * What the fence says when there is nothing to warn about.
 *
 * The reserved space has to be held whether or not a warning is in it, and held
 * space that is empty reads as a hole rather than as a promise. So the calm case
 * states the calm fact — in a quiet green, not the warning's red, because a
 * pilot must be able to tell the two apart without reading either.
 */
const AS_SHIPPED_NOTE = 'AS SHIPPED — NOTHING HERE FOLLOWS YOU OUT.';

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

/** The tallest `careerNote` can ever be — the longest policy name included. */
export function careerNoteReserve(): string {
  return longest([FROM_THE_CONSOLE, galaxyFlies(longest(LIVE_BRAIN_IDS) as LiveBrainId)]);
}
