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

import { readFileSync } from 'node:fs';
import { escapeHtml } from '../src/engine/escape-html.ts';
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
    ...foreignSystemNames(`${entry.description} ${entry.inhabitants}`, entry.system, want.facts)
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
// A generation run really did close both of Tiraor's fields with `</br>`, and
// the render site interpolates this text into innerHTML. Markup in a field is
// content deciding how the page is built, so it never reaches the file.
check('markup is a fault',
  faults('A cold world of salt.</br> The wind never stops.', 'description').length > 0);
check('an angle bracket alone is a fault',
  faults('A cold world of salt. <b>The wind never stops.', 'description').length > 0);
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

// The regression the first taste run found. The goat-soup grammar builds its
// nouns from the name pool, so Tibedied's own canon line is "most notable for
// Tibediedian Vees brandy" — and Vees is a system. Rejecting the entry for
// repeating the single fact it was given was the checker being wrong, not the
// model. Assert both halves: canon passes, the same name unprompted does not.
const tibedied = systemPrompts(1)[0];
check('Tibedied is the system whose canon line names Vees',
  tibedied.system === 'Tibedied' && /\bVees\b/.test(tibedied.facts));
eq('a name from the system own canon line is allowed',
  foreignSystemNames('The Vees brandy is shipped out young.', 'Tibedied', tibedied.facts).length, 0);
eq('the same name is still caught without that canon',
  foreignSystemNames('The Vees brandy is shipped out young.', 'Tibedied')[0], 'Vees');

// --- the shape the renderer relies on ---------------------------------------

const sample: SystemDescription | undefined = systemDescription(g1[7], 1);
check('a description, when present, carries both fields',
  sample === undefined
  || (typeof sample.description === 'string' && typeof sample.inhabitants === 'string'));

// --- the travelogue formula -------------------------------------------------

// The first full run of galaxy 1 read well one entry at a time and read as a
// template in bulk: 207 of 256 descriptions mentioned arrival, 96 ended on the
// literal words "Arrival brings", 159 of the inhabitants fields said a visitor
// noticed something. The prompt caused it and the prompt was fixed, but a
// prompt is a request — this is the gate, and it is what sends a repeat back
// for another attempt.
check('an arrival sentence is a fault',
  faults('A cold world of salt. Arrival brings the smell of brine.', 'description').length > 0);
check('a first impression from orbit is a fault',
  faults('A cold world. From orbit it shows only white.', 'description').length > 0);
check('framing the people around a visitor is a fault',
  faults('Visitors notice their reserve.', 'inhabitants').length > 0);
check('so is the same framing at a distance',
  faults('Visitors to the port often remark on their reserve.', 'inhabitants').length > 0);
// Narrow on purpose: a world may still be hard to reach, it just may not be
// described from the cockpit on the way in.
eq('a world can still be hard to get to',
  faults('The only landing field lies inland. Ships put down twice a week.', 'description').length, 0);

// --- escaping has ONE home --------------------------------------------------

// Two surfaces paint this generated prose into HTML now: the game's DATA ON
// page and the encyclopaedia. The sweep after TODO 59 found them doing it with
// two different functions — `src/engine/escape-html.ts` had been written and
// its own header claimed to be the single home, but `ui/screens.ts` still
// carried a private copy, and the two had ALREADY diverged: the shared one
// escapes a double quote and the private one did not.
//
// That is this project's named failure with a new hat on, so it gets a test
// rather than a resolution to be careful. A third home is a failure here.
const escapers = ['src/ui/screens.ts', 'src/encyclopaedia/entry.ts']
  .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
check('no surface defines its own HTML escaper',
  escapers.every((src) => !/function\s+escape\w*\s*\(/.test(src)));
check('every surface imports the shared one',
  escapers.every((src) => src.includes("from '../engine/escape-html.ts'")));
eq('and it escapes the quote the private copy missed', escapeHtml('a"b'), 'a&quot;b');
