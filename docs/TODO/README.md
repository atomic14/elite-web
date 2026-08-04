# TODO — active development plans

One file per change. Each is self-contained so a fresh session can open one
file, make the change, verify it, and stop. Work through numbered dependencies
in order; independent items may be delegated in parallel only when their files
and generated outputs do not overlap.

TODO 01-16 were completed and checkpointed in commit `0fc8627`. TODO 17-20
were completed through commit `09278b7`.

## The combat trainer

Progress: **9 / 9 complete**. `T` at any station is where Chris playtests, so
this is the room that has to be good. The findings came from a walk through the
live panel plus the screens' own code, after the Elite-A phase changed what the
numbers mean.

31 to 36 are done: the panel is grouped, the career switch is fenced, a brain
row says what that brain does in a fight, you can tell you are in an exercise,
the report shows how the OPPOSITION flew — their speed, the spread of ranges
they held and their completed attack runs, on the same definitions
`train/flight-probe.ts` reads — ENTER on the report holds two records side by
side, refusing to difference a pair that is not one fight flown twice, and an
exercise now opens in front of the pilot at a stated range, with the geometry on
the record and the one scenario that opens behind you saying so. 37 is done too:
a tap that arrives in a busy frame is carried to the next one instead of being
thrown away, bounded so that only a key something is already reading keeps a
backlog and never more than three of it. Do 39 next; 38 is independent of the
rest and can go at any point.

- [x] 31 — [Give the setup panel a shape, and fence the career switch](31-trainer-setup-panel-hierarchy.md) — UI/UX · high · medium
- [x] 32 — [Make choosing a brain a real choice](32-trainer-brain-choice-is-legible.md) — UI/UX · high · medium
- [x] 33 — [Tell the pilot they are in an exercise](33-exercise-hud.md) — UI/UX · high · medium
- [x] 34 — [Put the turret tell in the report](34-report-shows-how-they-flew.md) — UI/UX · high · medium
- [x] 35 — [Compare two records without leaving the room](35-compare-two-records.md) — UI/UX · medium · medium
- [x] 36 — [Start the exercise where the pilot can see it](36-exercise-opening-geometry.md) — UI/UX · medium · small
- [x] 37 — [Do not throw away a tap that arrived in a busy frame](37-input-taps-are-not-lost.md) — correctness · medium · small
- [x] 38 — [The console still shows four energy banks](38-energy-reads-as-one-bank.md) — UI/UX · low · small
- [x] 39 — [Make the wave ramp keep getting harder](39-waves-keep-getting-harder.md) — gameplay · high · medium

## From the code review (2026-08-02)

Progress: **16 / 16 complete**. Five reviewers with separate lenses; every
finding below was verified against the code before it was written down. Two
reviewers found item 43 independently, by different routes.

43 is done: career identity has one home — `SaveRecord.career`, which is what
the `save:auto:<CAREER>:*` keys are built from — the snapshot carries none, and
a boot no longer writes a docked checkpoint, because a boot has not docked.
`test/save-transfer.test.ts` is the coverage that module never had.

44 and 45 are done, and they are one job because they are the same sentence
read twice: a save operation must not act on the strength of a write it never
checked. Migration now removes a legacy key only once the copy reads back — the
pre-slots commander included, which a full store used to read, write nowhere and
delete — and NEW COMMANDER aims the boot pointer AWAY from the shelf instead of
clearing it, because a cleared pointer means "lost" and `bootSave` answers that
with the career you just asked to put down.

53 then deleted the migration 44 had just hardened, which is not a reversal: 44
fixed a live bug in code that was shipping, and 53 asked who the code was for.
Nobody but us has ever played, so the answer was nobody, and a careful migration
serving nobody is still a hazard — 44 is the proof. `migrateLegacySaves` and its
two helpers are gone, `SaveRecord.from` with them, and the old keys are LEFT in
whatever browser holds them: a delete has no write to verify itself against, so
clearing them would be the one shape 44 says not to write. Nothing reads them,
and a store holding only them boots a fresh commander because `parseSaveId`
refuses their shape. The write-then-verify-then-delete order survives everywhere
a delete still follows a write.

46 is done. A restore now beats the dock that follows it: `Station.dock` takes
a `DockArrival` — you flew in, you booted with nothing to resume, or a world
came off the shelf — and only the last of the three declines to roll a market
and a bulletin board, because the restore stocked both from the snapshot four
lines earlier. That closes the combat trainer's reroll button with no special
case for the trainer, which tears down through the same restore. The skipped
draws move no seeded outcome: `Persistence.restore` assigns `snap.rng` on the
line after the one that reaches the station, so a resumed dock's stream is
replaced whatever it drew. `test/persistence.test.ts` is the coverage that
module never had, and it asserts the property the name-presence grep in
`test/state.test.ts` cannot see — that the VALUE came back.

47 is done, and the shape it wanted was already in the file: the world step
reports `playerDealt` the way it reports `npcFired`, and the exercise credits
it. The two directions have separate closed lists now — `DamageSource` for the
five things that can hurt you, `DealtSource` for the four you can hurt a ship
with — and one function, `damage-dealt.ts`'s `dealToNpc`, spends the points and
measures what came OFF the bank, so a 250-point warhead into a Sidewinder
credits the 73 it had rather than the 250 it spent, which is what the laser
path always did. The energy bomb is the one path that never touches the step,
so game.ts hands it over beside the kill it already handed over. No damage
number moved: the campaign is byte-identical and the ai gates are unmoved. The
export schema is at 3, because `damageDealt` kept its name and changed what it
covers.

48 is done, and it was two halves of one boundary. `energyLow()` in
`systems.ts` is now the only test for "into the last bank", so the shield
cut-off, the ENERGY LOW flash and the red segment cannot disagree — they did,
at exactly 64, where the shields froze and the console stayed quiet. And
`destroyed` is a fact about THIS hit (`reachedHull && energy <= 0`) rather than
about the bank, with the E.C.M. refusing at `<=` its cost so no path can leave
the bank at zero with the ship still flying. `test/energy-low.test.ts` walks
all 256 values of the bank through the real `regenerate`, a real `WorldStep`
frame and a real HUD frame; the campaign is byte-identical.

50 is done, and it went the way the item asked: fewer homes rather than a
longer list to keep in step. A command key is `BINDINGS` in `controls.ts`; what
it DOES is one line in `command-help.ts` beside it, welded by
`Record<Command, CommandHelp>`, so a command nobody has written down does not
compile. The `?` panel, the manual page and the docked menu — the one with a
click path — are painted from that pair by `ui/key-help.ts` and hold no copy of
a key, which is three homes gone and the two undocumented keys (the distress
beacon, ⇧Y) documented everywhere at once. The README is the one surface left
in prose, and `test/key-help.test.ts` holds it to the table in both directions.

51 is done. The MARKET ESTIMATE panel and the campaign harness each carried the
1984 price formula rewritten; `contracts.ts`'s `marketEstimate` runs
`galaxy.ts`'s own model over all 256 fluctuations with the living galaxy's
pressure on top, and both call it. The old expression was out by more than 5 Cr
on 113 of the 4,352 system/commodity rows and by 38.4 on Teanrebi Narcotics; the
sweep is now exact to the tenth of a credit the game quotes in. The screen also
says what it is: an AVERAGE with the RANGE its rolls span, because the mean of a
market that wraps at 0xff describes no single visit. Trade decisions moved, as
they had to — a trader's median net worth 7426.6 → 7577.4 Cr, cash in hand 331.9
→ 764.1, 37/40 → 38/40 solvent. `npm run campaign -- 40 60 all` has one failing
check in the BOUNTY HUNTER cohort, and it fails identically before and after: a
hunter buys no cargo, so its figures are byte-identical either way.

54 is done, and both halves of it were one spread. `adoptSaveFile` copied a
parsed file into the record it wrote, so `v` and `savedAt` came off a stranger's
disk — and `readSave` refuses a record whose version is not this build's, so a
file from another build was written, pointed at, announced, and then did not
exist. The version is checked where the file is PARSED now, which is the only
place that can refuse it out loud, and the record is MINTED through
`makeRecord`: only the world and the commander come from the file, because only
they are the file's to give. `savedAt` is the import, not the claim, which
matters because the flight ring evicts by it and a lost pointer resumes the
newest record. The second half was TODO 44's third `setBootId` call site, and it
is honoured beside the reload it authorises. `test/save-transfer.test.ts`
asserts the shelf's own contract from the bytes: every record on it is readable
by `readSave`, which `listSaves()` cannot be asked because it drops exactly what
the question is about.

57 is done, and it is the one that made the tree smaller. `src/ai-training/brains/`
held 34 weights files, the game imported 9, three flew; it holds exactly the
three now and `npm test` fails on a fourth file, on a shipped one going missing,
and on any file in `src/` other than `game/brains.ts` importing weights — which
is the rule the combat viewer broke twice. `/viewer` is the combat viewer and
opens on it, `/gallery` is the 38 hulls and opens on them, neither has a mode key
or the other's controls, and every row the viewer offers flies a shipped brain or
a stated control, built from one table so a label and its weights cannot come
apart. `BrainSelection` is two flags rather than eight; a save carrying one of
the six deleted ones loads, is not migrated, and flies the shipped brains.
docs/TRAINING-LOG.md carries a dated note and is otherwise untouched: the figures
stand as the record of what was measured. The play bundle is 35.4 kB smaller
gzipped and the viewer 56.4 kB, with the shipped brains and therefore the game's
difficulty unchanged — `npm run campaign` and the `test/ai.test.ts` gates print
identical numbers before and after.

Order: 49 is why several of these survived — 46 is item 1 on its list, a guard
that greps persistence.ts for a field NAME while the value is clobbered four
lines later — so it is worth doing early rather than last.

- [x] 43 — [Loading or importing a save eats a career's checkpoint](43-career-identity-has-two-homes.md) — data loss · critical · medium
- [x] 44 — [A full store deletes a pre-slots commander](44-a-full-store-deletes-a-legacy-commander.md) — data loss · critical · small
- [x] 45 — ["NEW COMMANDER" does nothing](45-new-commander-does-nothing.md) — save model · high · small
- [x] 46 — [Docking rerolls the board a restore just loaded](46-docking-rerolls-the-board-a-restore-just-loaded.md) — save integrity · high · medium
- [x] 47 — [The trainer credits no damage for ordnance](47-the-trainer-credits-no-damage-for-ordnance.md) — trainer · high · medium
- [x] 48 — [The energy dead band, and dying at full shields](48-the-energy-dead-band.md) — combat · high · small
- [x] 49 — [Guards that do not guard](49-guards-that-do-not-guard.md) — test integrity · high · medium
- [x] 50 — [Key bindings have six homes](50-key-bindings-have-six-homes.md) — UI/docs · medium · medium
- [x] 51 — [The market estimate lies](51-the-market-estimate-is-wrong.md) — economy · medium · medium
- [x] 52 — [Say true things](52-say-true-things.md) — docs/dead code · medium · medium
- [x] 53 — [Delete the legacy save migration](53-delete-the-legacy-save-migration.md) — simplification · medium · small
- [x] 54 — [Import can write a save the shelf cannot read](54-import-can-write-an-unreadable-save.md) — save integrity · medium · small
- [x] 55 — [Make saving and loading legible](55-make-saving-legible.md) — UI/UX · high · medium
- [x] 56 — [A commander, not a career](56-a-commander-not-a-career.md) — naming/UX · medium · medium
- [x] 57 — [Ship only what ships](57-ship-only-what-ships.md) — simplification/UI · medium · large

## Content

Progress: **2 / 2 complete**. The 1984 galaxy says one line about each world.
There is a second paragraph beside it now, written offline by a model and
committed — the same pipeline `tools/species-prompts.ts` already uses for the
inhabitant portraits, for the same reason: the game deploys as a static site,
so nothing can call a model at build or play time.

Galaxy 1 is described, all 256 worlds, generated on Sonnet 5 for $0.95 (the
token counts are in the file; the money is only ever printed, because a token
count stays true and a price list does not). Every entry is optional by design
— a missing one renders exactly what the game rendered before — so galaxies
2-8 can follow whenever, and a refused record costs nothing:
`npm run generate:descriptions -- 2 --model claude-sonnet-5`.

`/encyclopaedia` is the same corpus as something to read rather than something
to find in-game: the 256-world chart, filterable, with every entry also written
into the HTML at build time so the page is a complete reference work with no
JavaScript at all. It is the first page to have invariant 1 enforced by a test.

The measurement worth keeping is that reading four entries proved nothing. The
first full run was excellent one world at a time and a template in bulk — 207
of 256 mentioned arrival, because the prompt had asked for it. Counting found
it; a gate holds it at zero now. **Read the set, not the sample.**

- [x] 58 — [Extended system descriptions, generated offline](58-extended-system-descriptions.md) — content/tooling · low · large
- [x] 59 — [The galaxy encyclopaedia](59-the-galaxy-encyclopaedia.md) — content/new page · low · large

## From the bug sweep (2026-08-03)

Progress: **1 / 1 complete**. A sweep after TODO 59 with every gate green —
2748 unit tests, the campaign, the Elite-A alignment gate, portability at zero
contaminated — plus the browser playtest, which is the one that found
something.

One defect was found and fixed inside the sweep rather than written up: HTML
escaping had grown a second home. `src/engine/escape-html.ts` was written
during TODO 59 with a header claiming to be the single home for it, and
`ui/screens.ts` was never migrated onto it — so two implementations shipped,
already diverged (one escaped a double quote, the other did not). That is this
project's named failure with a new hat on, so it now has a test that fails if a
third appears.

60 is done, and the cause was none of the obvious ones. The step budget was
tested first and cleared: at 60,000 steps the agent still spent 90% of them
parked at speed 0. It was a mutual standstill — the approach yielded to any
ship within 320 units, and `npc.ts` lets traders come to rest, so both sides
waited forever. Two further defects fell out of it: `alignRoll` aimed the wings
at the station's local X when the slot test wants local Y (the same bug in
`train/jameson-autopilot.js`, whose header promises alignment it never
delivered), and `openHermitTrade()` pushed the market screen twice — a real
player-facing bug since the screen-host migration, where leaving a rock hermit
needs two Escapes.

- [x] 60 — [The playtest agent strands itself after two or three legs](60-the-playtest-agent-strands-itself.md) — verification · medium · medium

## Training fidelity, and one decision the guard is forcing

Chris, 2026-08-03: *"Training should match the 'real world' otherwise it's
always going to be wrong."*

It started as three items from one question — why a scripted NPC can fire a
missile in the game and not in a training episode — and answering two of them
turned it into six. The answer is that invariant 5's "one
combat model" covers the DECISION half of combat and not the RESOLUTION half:
`world-step.ts` and `ai-training/scenario.ts` are two implementations of
invariant 15's contract, and they have silently diverged on the weapon, the
missile rack and shield regeneration. 62 and 63 were the two known divergences —
**both are closed**, and **64 is done**: there is ONE resolver now,
`game/fire-resolution.ts`, called by both, over a four-member `FireWorld` each
side implements — the seam this codebase already uses for the platform, the
orchestrator and a sky to put a warhead in. The rules above it are the rack, the
dice, the damage and the shield face (`game/shield-face.ts`, one line that had two
homes and agreed); everything left with the callers is a tracer, a bang and a
tally. `test/fire-resolution.test.ts` is the mechanism that would have caught 62
and 63 and stops the next one — the same `FireEvent` and the same seed through
BOTH callers — and it is checked for vacuity by gutting the resolver and by
re-growing a copy in one caller. The game is byte-identical over 7,000 traced
frames; the trainer moved in 4 episodes of 120, from the one row 64 closed that
had a number in it (the range the hit dice read).

Doing 62 turned up a fourth divergence nobody was looking for, which is 64's whole
argument restated: **73**, a training pirate never hands over to the scripted
break-off, so it never completes a pass and can never earn a missile the way the
game intends. It is the one row of 64's table that does not read "same", it is
left open deliberately — closing it changes what every genome is scored against —
and it is where the seam goes next: `NpcShip.update()` is still the only place
that composes "pick a flight, then pick a weapon".

**74** is 64's own prediction coming true on the way out. 64 says of its table
"there is no reason to believe the list is complete", and finishing it turned up a
fifth divergence pointing the OTHER way: the episode's armed freighter shoots back
with the range curve where the game's armed trader rolls the flat
`NPC_VS_NPC_HIT`, so it lands 0.754 of its shots against the sky's 0.500 at the
ranges a fight is actually fought at. It is outside 64's seam — the shooter there
is the episode's target, not an `NpcShip` — and it feeds `fitnessDefend`,
`fitnessPack` and every defence-probe table, so it is a decision about which rule
is right rather than a refactor.

61 is decided and done: **deleted**. Chris, 2026-08-03. `pirate-attack-e1` was
restored to be compared against `pirate-attack-g3` as the solo pirate policy, and
`d563e3d` retired that job — the scripted attack run is what ships for solo
pirates and gangs alike, so the candidate was a candidate for a post that no
longer exists. The weights, the `BrainName`, the character line, both pickers'
rows, the `brains.ts` import and the `BrainSelection.passes` flag are all gone;
`train/evaluate.ts`'s `CANDIDATES` is empty again. docs/TRAINING-LOG.md keeps
every figure `e1` ever measured, with a dated note saying the file is no longer
there to re-run them against. A save carrying `passes` still loads, is not
migrated and flies the shipped brains, which is TODO 57's precedent, and
`test/brain-names.test.ts` now asserts it for `passes` too.

63 is done, and it changed a baseline rather than a brain: the episode's target
runs the whole of `systems.ts`'s `regenerate` now, so **every defence and evade
figure in docs/TRAINING-LOG.md before 2026-08-04 is incomparable with one after
it** — the entry there says so rather than re-baselining quietly. The defence
phase was retrained twice at run 19's budget and **neither shipped**: both
champions validate at 99.8-99.9% of her pools left and both are worse than the
incumbent on held-out seeds, which is 65's arithmetic doing exactly what 65 says
it does. 65 is done now and the retrain after it found a policy that kills seven
times as much; the two things 63 left open are still open and neither is 63's to
close — they are **70** and **71** below.

- [x] 61 — [Promote or delete the attack-run candidate](61-decide-the-attack-run-candidate.md) — decision · medium · small
- [x] 62 — [Missiles do not exist in training, and nothing said so](62-missiles-do-not-exist-in-training.md) — training fidelity · high · medium
- [x] 63 — [A training target's shields never come back](63-shields-never-come-back-in-training.md) — training fidelity · high · small
- [x] 64 — [One resolver, so the trainer and the game cannot drift](64-one-fire-resolver.md) — architecture · high · large
- [x] 65 — [The defender is selected for not fighting](65-the-defender-is-selected-for-not-fighting.md) — training methodology · high · medium
- [ ] 70 — [The pack's kill bonus can no longer be earned](70-the-packs-kill-bonus-is-dead-signal.md) — training methodology · high · medium
- [ ] 71 — [A defender cannot see its own pools](71-a-defender-cannot-see-its-own-pools.md) — training fidelity · high · medium
- [ ] 72 — [The target cannot answer a missile](72-the-target-cannot-answer-a-missile.md) — training fidelity · high · large
- [ ] 73 — [A training pirate never hands over, so it never earns a missile](73-a-training-pirate-never-breaks-off.md) — training fidelity · medium · medium
- [ ] 74 — [An armed freighter shoots 51% straighter in training than in the game](74-the-armed-freighter-shoots-straighter-in-training.md) — training fidelity · medium · small

70 and 71 came out of 63 and are the two things it could not close. 70: a gang of
three killed the armed scripted trader in 21 of 60 episodes and now kills her in
0, so `fitnessPack`'s kill bonus — **51% of the shipped pack policy's fitness** —
is a constant zero, and it blocks a meaningful pack retrain. 71: `observe()` is
fourteen numbers and own health is not one of them, so "break off and heal" is
not learnable however 65 fixes the selection — which is why the kill rate was
identical either side of 63.

62 is done, and like 63 it changed a world rather than a brain. A training pirate
calls `NpcShip.chooseWeapon` now, the trainer's resolver reads `shot.weapon`, and
the round is spent through `ordnance.ts`'s own `launchNpcMissile` over an
`OrdnanceWorld` an episode supplies — no second missile model, which was the one
thing the item forbade. `jameson-defend-g1` fell from **99.2% of her pools left to
90.1%** over 240 held-out fights and died in **6 of them where it had died in
none**, and `npm run survivability` moved off 0% destroyed at every gang size for
the first time: four organised pirates now kill her in 8.3 seconds, which is
Chris's real 9.1-second death appearing in the trainer. `EPISODE_SCHEMA` is **3**;
a schema-2 record describes a world where only a laser could reach her.

62 leaves two things open and each has its own file. **72**: she has no E.C.M. and
no output that could press it, so missiles are currently undodgeable in training —
which is the same fidelity fault as 62 pointing the other way, and it wants 65 and
71 first. **73**: brain-flown pirates make **zero passes** in an episode because
there is no handover to the scripted break-off at `BRAIN_HANDOVER_RANGE`, so the
"tougher than you thought" launch — the one that rewards ENGAGING — is unreachable
for exactly the ships the game sends at a player. 62 did NOT restore 70's kill
bonus for the same reason: three shipped pack pirates against the armed scripted
trader still launch **0** missiles and still kill her **0** times in 60.

## The attack run, and what comes after it

`d563e3d` gave every hostile a three-phase attack run. These are the four things
it left open — two measured faults in the run's geometry, the design it makes
possible, and one piece of wording nobody could read.

- [x] 66 — [The pass aims where you were, not where you will be](66-the-pass-aims-where-you-were.md) — combat bug · medium · small
- [x] 67 — [Short attack runs are not flyable, so the rhythm is fixed at ~9s](67-short-attack-runs-are-not-flyable.md) — combat feel · medium · medium
- [ ] 68 — [A vocabulary of tactics, not one behaviour](68-a-vocabulary-of-tactics.md) — combat feel/design · medium · large
- [x] 69 — [The setup panel says "HULL (0)" and means "ask the hull"](69-the-panel-says-hull-zero.md) — UI/UX · low · small

66 is done, and it needed a tool before it needed a fix. Nothing in the training
world both TRANSLATED and stayed in the fight — `holding` sits at 42, and
`scripted` and `runner` both settle at ~397 against a pirate's ~240 and are
never caught again — so there was no way to ask the question the item is about.
`train/ram-probe.ts` and a `weaving` target are that way: five ships, contact
counted where the ram is billed rather than divided out of a damage total.

The aim point now leads (`game/pass-aim.ts`, which is where the run's aim went
when it had grown to a third of `break-off.ts`) and the miss distance stretches
with the range and the closure, so a pass opens the gap it always claimed to.
Against five ships and a target that holds — the closest model of how Chris
actually flies — contact fell from 1.15 to 0.42 an episode, 132 points to 48;
ship-on-ship contact fell 67%; the passes count did not move. It cost 1.5 points
of the commander's pools in `defence-probe`, where simply raising the constant
to 130 for the same result costs 3.6. The honest caveat is in the item's own
report: the geometry the item PREDICTED — a fast head-on merge eating the offset
— is real but is not what was producing Chris's rams, and against a target
translating at 400 the fix buys a quarter more merges at the same contact per
merge rather than less contact.

67 is done, and the item's diagnosis was half of the cause. The half it named
is real: `extending` steered for nothing, so the whole 180 had to happen in the
closing leg. `game/extend-arc.ts` is the curve that fixes it — a heading held at
a ramping angle to the OUTWARD radial, which keeps the range opening (so the
phase machine cannot be starved and the curve cannot become an orbit) while the
nose comes round. The half it did not name was bigger: **the aim point was on
whichever side the ship's own +X happened to point**, which is the far side of
the target about half the time, and a run aimed at the far side is a run through
the middle. Worse, it ran away — steering at a point defined by your own +X
moves the point, so the nose sat 25-60 degrees off the aim for seconds while the
ship turned at its cap. That is what "an intended 110 delivered as 75" was, and
what the old band table was really measuring. `passOffset` takes the side off
the HEADING now: the side the ship is already stepping to, which no run has to
cross the target to reach.

Together they take the merge-to-merge gap Chris asked about from **9.47s to
7.22s** with the run-out still apexing at 792, and contact does not pay for it —
it falls. One pirate against a target that holds: 4.4 points an episode to
**0.0**, closest approach 47 to 108. Five against a moving one (`ram-probe`):
holds 0.38 rams an episode to 0.17, evades 0.63 to 0.20, weaves 0.38 to **0.05**.
The band is 500-850 and `EXTEND_RANGE_MIN` came down as the item asked, with its
table re-derived over the five bands that are now all flyable.

The price is a threshold and a point of balance, both stated rather than hidden.
`PASS_FAR` is **600**: at 900 the new runs would have counted 12% of the merges
they actually fly, so every attack-run figure in the game and in flight-probe
would have read near zero for a model that had just got better — the archived
rows in `train/logs/todo32/` are now a record of a different threshold as well
as a different flight model. And a shorter rhythm is more pressure: over 240
held-out defence fights `jameson-defend-g1` keeps **88.7%** of her pools where
she kept 90.1%. The decomposition says which half did it — the aim fix alone
takes her to 91.8%, and the arc's extra runs per minute take her back down —
so it is the rate, not the ramming, and it is the thing to fly before keeping.
No retrain is owed (no combat number moved; the shipped policies do not run
`attack()` outside `BRAIN_HANDOVER_RANGE`), but the defence brain was fitted
against a slower opponent and that is a retrain that might now find something.


69 is done: a delegated row reads `FROM THE HULL — NONE` / `FROM THE HULL — 60%`
and a set one reads `0` / `60%`, so the mode is words and the number after it is
a consequence. `null` still means "whatever this hull carries" — the behaviour
did not move, only the wording — and one `setOrHull()` phrases both rows, which
is the whole of it: the record never quoted the string, so there was no second
home to keep in step. The assertions went to a new `test/combat-sim-rows.test.ts`
along with TODO 41's, because "what a row READS AS" is a different question from
the panel's shape and the panel's file was full of the second one.

65 came out of trying to act on 62-64 and failing. Two retrains across a wider
training distribution both came out worse than the shipped brain, and tripling
the search budget was not the answer: the defend phase picked its champion on
pools-left alone, where killing a whole pirate was worth 3 points and losing 1%
of your pools cost 10. Under that rule shooting is strictly irrational, which
is CLAUDE.md's long-standing "evades superbly and shoots badly" — not a property
of the brain, a property of the selection.

**65 is done.** `train/selection.ts` is the rule now — `0.75 x outcome +
0.25 x shaped`, a STATED ratio where the old ±499 clamp let shaping contribute
1.9%, and a defender's outcome is `0.6 x the pools she kept + 0.4 x the share of
the attacking force she broke`, cumulative rather than terminal (which also
closes 63's second inversion, where clearing a fight early scored WORSE because
she healed for less of the clock) and zero if she died. `evade` deliberately
keeps no fighting term and says why. `test/selection.test.ts` asserts the
ordering on two hand-built genomes that differ in exactly one weight — the bias
on the fire head — and asserts that the rule this replaced ranked them the other
way round.

The retrain found the brain the old rule could not: `jameson-defend-t65c` kills
**41.0%** of its attackers against the shipped brain's 5.7%, on held-out seeds,
and takes less cumulative damage doing it. It is **not promoted**: it is
destroyed in 42 of 800 held-out fights against 19, which is not equal
survivability. Every death of every defence policy has a warhead in it, so that
column is **72**'s — until she can answer a missile it measures how many
warheads a policy attracts — and the ceiling on the fighting itself is **71**'s.

## From the independent AI review (2026-08-04)

An outside read of every NPC-AI and scripting path — the scripted flight model,
the weapons and their resolution, the four encoders and the three shipped
policies, the training pipeline, the probes, and the tests that are supposed to
hold all of it — after commits `83426d0`..`dbc7f3c`. Every item below was
CONFIRMED by running something, and each file carries the command and the output.

The method that found half of them was a mutation sweep: eighteen deliberate
breaks to rules in `npc.ts`, `break-off.ts`, `pass-aim.ts`, `extend-arc.ts`,
`separation.ts`, `gunnery.ts`, `shield-face.ts`, `tactic-choice.ts`,
`observation.ts` and `selection.ts`, each run against `npm test` and restored.
Fifteen of the eighteen were caught. **Three were not, and one more constant —
`BRAIN_RATE_DECAY`, which governs how every brain-flown ship and the purchasable
combat computer bleeds off a turn — can be moved with no test failing at all.**

- [ ] 75 — [A gang never knows it is losing](75-a-gang-never-knows-it-is-losing.md) — combat bug/training fidelity · high · small
- [ ] 76 — [Wingman avoidance can be deleted and nothing notices](76-wingman-avoidance-has-no-test.md) — test gap · medium · small
- [ ] 77 — [A brain-flown ship is "evading" forever](77-a-brain-flown-ship-is-evading-forever.md) — combat bug · medium · small
- [ ] 78 — [Every ram in training lands on the fore shield](78-every-ram-in-training-hits-the-fore-shield.md) — training fidelity · medium · small
- [ ] 79 — [The "trader that shoots back" in the attack pool never fires](79-the-armed-hauler-in-the-pool-never-fires.md) — training methodology · medium · small
- [ ] 80 — [The defence probe's headline is the metric 65 threw out](80-the-defence-headline-is-the-metric-65-rejected.md) — training methodology · medium · small
- [ ] 81 — [Two rows in the brain picker both say they are what ships](81-two-rows-both-say-they-are-what-ships.md) — UI/UX · medium · small
- [ ] 82 — [The tournament and survivability do not score what ships](82-the-tournament-does-not-score-what-ships.md) — training methodology · medium · small
- [ ] 83 — [The one-warhead-in-the-air cap has no test](83-the-one-warhead-cap-has-no-test.md) — test gap · medium · small
- [ ] 84 — [The probe's "on-six" column cannot move](84-the-on-six-column-cannot-move.md) — training methodology · low · small
- [ ] 85 — [The combat computer flies a ramp the policy was not fitted at](85-the-combat-computer-flies-a-ramp-the-policy-was-not-fitted-at.md) — training fidelity · medium · small
- [ ] 86 — [The co-pilot you buy parks your ship](86-the-co-pilot-you-buy-parks-your-ship.md) — combat feel/design · medium · medium
- [ ] 87 — [Three parity checks assert `f(x) === f(x)`](87-three-checks-that-restate-their-own-implementation.md) — test gap · low · small

**75 is the one to do first**, and it is the third instance of the shape 70 and
73 already name: a reward reason that cannot be earned. `matesLost` counts dead
ships in `world.npcs`, and every kill path splices the ship out of that array
inside the same statement — so "the gang is losing" is a launch reason the game
can never reach, while a training episode (which never prunes its fleet) reaches
it fine. 70 is `passesMade` dead in the trainer, 73 is the handover that would
fix it, and this is `matesLost` dead in the sky. Between them, each of
`npcMissileEmergency`'s three reasons is unreachable in one of the two worlds.
Do **83** with it or before it: the one-in-the-air cap is what keeps a gang that
CAN escalate survivable, and it has no test either.

**76, 83 and 87 are the mutation sweep's three misses**, and they are not the
same kind of gap. 76 is a whole rule module — `separation.ts`, with its own swept
constants and three call sites in the attack run — that no test imports at all.
83 is one guard on a stated fairness rule with a recorded failure behind it. 87
is three assertions that expand to `f(x) === f(x)` in the file whose own comment
says "assert the rule rather than the copies".

**81, 82 and 84 are the same root**: `d563e3d` made the scripted attack run what
ships, and the surfaces that describe or measure the AI did not all follow.
`pirate-attack-g3`'s picker line still says "THE FIGHT THE GAME SHIPS" beside a
`scripted` line that says "WHAT SHIPS"; `npm run evaluate`'s flight table and
`npm run survivability`'s eight rows have no entry for the AI a player meets;
and the `scripted` line's own quoted figures do not reproduce (4.42 attack runs
measured against a claimed 5.2, and it is not the tactics vocabulary — forcing
every roll to `run` reads 4.33).

**86 is the one that needs a human.** Nothing about `jameson-defend-g2` has been
flown, and it is both the armed trader's brain and the combat computer the player
buys. It is stationary on nine frames out of ten — mean speed 10.6 out of 400 on
the commander's own hull — and no term in the selection can see that. The
measurements say it is excellent (0 deaths in 800, 41.6% of its attackers
destroyed, every warhead answered); CLAUDE.md says a policy that wins every
measurement can still be the wrong one, and this is exactly that case.

## Follow-ups

- [x] 41 — [Name the opposition, not the file](41-name-the-opposition-not-the-file.md) — UI/UX · high · medium
- [x] 42 — [They stop shooting when you get close](42-they-stop-shooting-when-you-close.md) — combat bug · critical · small

## Saves

Progress: **1 / 1 complete**. The model is Chris's and is decided: S prompts
for a name and the same name overwrites, autosaves happen on their own and are
kept as a set, and you can load either. One question in the spec is a
game-design call rather than an implementation one — whether the death screen
may offer an autosave — and it is marked ask, do not decide silently.

- [x] 40 — [Named save files, and an autosave that cannot eat one](40-named-save-files.md) — save model/UI · high · large

## Elite-A damage and ship-catalogue alignment

Progress: **10 / 10 complete**. Start with the
[scope, fidelity decisions and dependency map](ELITE-A-COMBAT-PLAN.md). The
source pack is vendored at `reference/elite-a/source/` and regenerated by
`npm run generate:elite-a`; nothing reads it from `Downloads` any more.

- [x] 21 — [Vendor and generate the Elite-A reference catalogue](21-elite-a-reference-import.md) — data provenance · high · medium
- [x] 22 — [Implement the pure Elite-A combat oracle](22-elite-a-combat-oracle.md) — rules foundation · high · medium
- [x] 23 — [Add stable ship and combat-profile identities](23-stable-ship-and-combat-profile-ids.md) — state/future seam · high · medium
- [x] 24 — [Replace approximate geometry with all 38 designs](24-exact-elite-a-geometry.md) — rendering/hit registration · high · large
- [x] 25 — [Bring the complete Elite-A ship roster into runtime](25-complete-elite-a-runtime-roster.md) — world model · high · large
- [x] 26 — [Use exact player lasers, NPC energy and defence](26-player-lasers-and-npc-energy.md) — combat migration · critical · large
- [x] 27 — [Use 255-point player defence and clean NPC lasers](27-player-defence-and-npc-lasers.md) — combat migration · critical · large
- [x] 28 — [Audit secondary damage and eliminate mixed units](28-secondary-damage-and-mixed-units.md) — combat audit · critical · medium
- [x] 29 — [Rebaseline simulations, training and campaign combat](29-combat-training-and-balance-rebaseline.md) — AI/balance · high · large
- [x] 30 — [Make Elite-A damage alignment a permanent gate](30-elite-a-damage-alignment-gate.md) — verification · high · medium

## Completed architecture queue

Last verified after item 20: `npm run build`, `npm run campaign`, and
`npm run portability` — **1293 passed, 0 failed**, with **0 contaminated
files**.

- [x] 17 — [NPC docking latch is missing from the snapshot](17-npc-dock-plan-snapshot.md)
- [x] 18 — [`draw()` advances the cockpit beam lifetime](18-beam-timer-in-step.md)
- [x] 19 — [Core rule modules still perform platform side effects](19-core-platform-side-effects.md)
- [x] 20 — [The portability gate does not follow imports](20-dependency-aware-portability.md)

## Review context

These four items came from a fresh read of the live worktree after TODO 16, not
from the stale `.architecture-review/analysis.json` generated against
`de9a668`. The old deterministic findings remain useful historical evidence,
but their `Game` and `NpcShip` surface counts do not describe current code.

Manual sound, Dodo-docking, and pasted browser-playtest checks still require a
browser and speakers; every item should record which of those was feasible.
