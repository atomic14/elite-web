// The extended-description overlay: that it is optional, and that what it
// carries obeys the rules it was generated under.
//
// Two claims, and they pull in opposite directions on purpose.
//
// The first is that the 1984 data is untouched. This whole feature is a
// decorator, so the test that matters most is the one asserting the thing it
// decorates did not move — `galaxy.test.ts` owns invariant 4, and this file
// re-asserts the narrower version of it that this work could plausibly break.
//
// The second is that a MISSING entry is normal. Every fallback path has to be
// exercised, because the overlay ships empty and stays partial for as long as
// seven of the eight galaxies are ungenerated. A test suite that only proved
// the populated case would pass today and prove nothing.

import {
  systemDescription, overlay, type SystemDescription,
} from '../src/galaxy/descriptions.ts';
import { planetDescription } from '../src/galaxy/goatsoup.ts';
import {
  systemPrompts, faults, foreignSystemNames, PROMPT_VERSION, MAX_FIELD, BANNED,
} from '../tools/system-prompts.ts';
import { generateGalaxy, describeSystem } from '../src/galaxy/galaxy.ts';
import { check, eq } from './harness.ts';
import { g1 } from './fixtures.ts';

console.log('\nextended system descriptions');

// --- the 1984 data is untouched ---------------------------------------------

eq('Lave is still Lave', g1[7].name, 'Lave');
eq('Lave is still TL:5 Rich Agricultural Dictatorship',
  describeSystem(g1[7]), 'LAVE  TL:5  Rich Agricultural  Dictatorship');
eq('the goat-soup line is unchanged',
  planetDescription(g1[7]),
  'Lave is most famous for its vast rain forests and the Lavian tree grub.');

// --- a missing entry is a supported state -----------------------------------

check('galaxy 2 has no overlay at all', overlay(2) === undefined);
check('a galaxy 2 system has no description',
  systemDescription(generateGalaxy(2)[7], 2) === undefined);
check('galaxy 0 does not throw', systemDescription(g1[7], 0) === undefined);

const g1Overlay = overlay(1);
check('galaxy 1 has an overlay file', g1Overlay !== undefined);
eq('the overlay declares the current prompt version',
  g1Overlay?.promptVersion, PROMPT_VERSION);

// Every system either has a description or does not, and BOTH are fine. What
// is not fine is throwing on the ones that do not.
let described = 0;
for (const sys of g1) {
  const d = systemDescription(sys, 1);
  if (d) described += 1;
}
check(`${described}/${g1.length} systems described, the rest fall back`,
  described >= 0 && described <= g1.length);

// --- the index is only meaningful against the galaxy that made it -----------

// This is the failure the runtime name check exists for: an overlay filed by
// index, read against a galaxy whose indices moved, hands Lave's paragraph to
// another world with nothing looking wrong. Prove the guard fires.
const wrongName = { ...g1[7], name: 'Notlave' };
check('a name mismatch falls back rather than lying',
  systemDescription(wrongName, 1) === undefined);

// --- what is committed obeys the rules --------------------------------------

const prompts = new Map(systemPrompts(1).map((p) => [String(p.index), p]));
const broken: string[] = [];
const stale: string[] = [];

for (const [index, entry] of Object.entries(g1Overlay?.entries ?? {})) {
  const want = prompts.get(index);
  if (!want) { stale.push(`${index}: no such system in galaxy 1`); continue; }
  if (want.system !== entry.system) {
    stale.push(`${index}: filed as ${entry.system}, galaxy says ${want.system}`);
    continue;
  }
  if (want.hash !== entry.hash) stale.push(`${index} ${entry.system}: prompt changed`);

  broken.push(
    ...faults(entry.description, 'description').map((f) => `${entry.system}: ${f}`),
    ...faults(entry.inhabitants, 'inhabitants').map((f) => `${entry.system}: ${f}`),
    ...foreignSystemNames(`${entry.description} ${entry.inhabitants}`, entry.system)
      .map((n) => `${entry.system}: names another system (${n})`),
  );
}

check(`every committed entry matches its prompt${stale.length ? `: ${stale.slice(0, 3).join('; ')}` : ''}`,
  stale.length === 0);
check(`every committed entry obeys the rules${broken.length ? `: ${broken.slice(0, 3).join('; ')}` : ''}`,
  broken.length === 0);

// --- the rule checker itself ------------------------------------------------

// The check above passes trivially on an empty overlay, so it cannot be the
// only evidence the rules are enforced. These assert the checker rejects what
// it claims to — without them, a `faults()` that returned [] unconditionally
// would leave the whole suite green.
const ok = 'A cold world of salt flats and low stone towns. The wind never stops.';
eq('clean prose has no faults', faults(ok, 'description').length, 0);
check('a digit is a fault', faults('It has 3 moons. The wind never stops.', 'description').length > 0);
check('the second person is a fault',
  faults('You arrive at dawn. The wind never stops.', 'description').length > 0);
check('over-length is a fault',
  faults(`${'a. '.repeat(MAX_FIELD)}`, 'description').length > 0);
check('a banned word is a fault',
  faults(`A ${BANNED[0]} world of salt. The wind never stops.`, 'description').length > 0);
check('a line break is a fault',
  faults('A cold world.\nThe wind never stops.', 'description').length > 0);
check('one sentence is too few for a description',
  faults('A cold world of salt flats.', 'description').length > 0);
eq('one sentence is enough for inhabitants',
  faults('They are a quiet people, slow to trust.', 'inhabitants').length, 0);

eq('naming another system is caught',
  foreignSystemNames('The trade with Riedquat is old.', 'Lave')[0], 'Riedquat');
eq('naming yourself is not', foreignSystemNames('Lave is warm.', 'Lave').length, 0);
// Nineteen system names are ordinary English words and are excluded, or every
// description that mentioned weather would be rejected. See WORD_NAMES.
eq('ordinary words are not mistaken for system names',
  foreignSystemNames('Rain falls for most of the year.', 'Lave').length, 0);

// --- the shape the renderer relies on ---------------------------------------

const sample: SystemDescription | undefined = systemDescription(g1[7], 1);
check('a description, when present, carries both fields',
  sample === undefined
  || (typeof sample.description === 'string' && typeof sample.inhabitants === 'string'));
