# Development log — rebuilding Elite for the web, and teaching it to fly

*A single long session, July 2026. What follows is the honest order things
happened in, including the parts that didn't work.*

---

## 1. The brief

> "I loved playing Elite when I was younger. I want to keep the wireframe
> style graphics, but maybe planets and suns could be more interesting?"

That one sentence set the whole aesthetic policy, and it turned out to be a
good one: **ships stay 1984, everything astronomical gets the modern
treatment.** Wireframe hulls are the soul of Elite; the flat white circles
that stood in for planets were a limitation, not a choice.

Stack: TypeScript, Vite, three.js. No game engine — Elite's charm is that
it's a small pile of maths, and a small pile of maths is exactly what this
turned out to be.

## 2. The galaxy is 250 lines and it still works

The first real code was `galaxy/galaxy.ts`: the original procedural
generator. Three 16-bit seed words, a Fibonacci-ish "twist" that shuffles
them, and out falls an entire universe — names from a digraph table,
economy, government, tech level, population, productivity, planet radius,
and the commodity market's price gradients.

The satisfying part is that it's *verifiable*. Galaxy 1, system 7 must be
**Lave, Rich Agricultural Dictatorship, Tech Level 5**. First run:

```
7 LAVE  TL:5  Rich Agricultural  Dictatorship
```

Diso, Leesti, Riedquat, Zaonce, Reorte — all present, all in the right
places. Forty-two years later, the same three numbers still produce the
same galaxy. That check became invariant #1 in the project's CLAUDE.md and
has been re-run after every risky change since.

## 3. Wireframes that occlude

First pass at ships: vertex and edge lists, exactly like the BBC data,
rendered as `LineSegments`. They looked right and were wrong — you could
see straight through every hull, including its own far side.

The fix is the classic hidden-line trick: give each ship a **matte-black
filled mesh** of its faces, sitting just behind the glowing edges via
`polygonOffset`. Suddenly ships occlude the stars, the planet, and their
own rear surfaces.

That change had a non-obvious consequence. The renderer had been using a
logarithmic depth buffer (sensible, given a sun 320,000 units away and
wireframes 30 units away). Log depth writes `gl_FragDepth`, which
**disables polygon offset**. So: no log depth buffer. It's invariant #3
now, because it's the kind of thing that silently un-fixes itself.

## 4. Planets: the deliberate anachronism

The planet shader is where the brief got spent. Procedural fbm noise gives
coastline contours; a lat/long graticule keeps it feeling like vector
graphics; there's a day/night terminator, a fresnel atmosphere rim, and a
solid body fill so the disc reads as a sphere even on its dark side. Every
parameter — hue, continents, sun bearing — derives from the same 1984 seed
that names the place.

The sun got animated fbm granulation, limb darkening, and an additive
corona. Neither would have run on a BBC Micro. Both feel like what Elite
was *pointing at*.

## 5. From tech demo to game

The middle stretch was systems, in roughly this order: flight model
(no inertia — the ship goes where the nose points), the elliptical 3D
scanner, the Coriolis station with its rotating slot, manual docking with a
roll-alignment check, the market, the charts, hyperspace with a fuel-range
circle, combat with lasers/missiles/shields/energy banks, bounties, ratings,
and save-on-dock.

Then a research pass against **the original 1984 manual** (fetched over
plain HTTP — the fan-site's certificate has expired) plus Wikipedia, written
up as `docs/GAP-ANALYSIS.md`. That document drove everything after: cabin
temperature and sun-skimming, the energy bomb, ECM, cargo canisters and
scooping, mining lasers, CLEAN → OFFENDER → FUGITIVE legal tiers with
contraband scans, witch-space Thargoid ambushes, dodecahedral "Dodo"
stations at high-tech worlds, the Navy missions, and the manual's exact
equipment price/tech-level table.

Two details worth the effort: the **species generator** ("Population: 4.1
Billion — Black Furry Felines") is the original's seed-bit table, and the
launch/dock **tunnel effect** — concentric rings rushing past — takes about
70 lines of canvas drawing and does more for the 1984 feeling than anything
else in the project.

## 6. "Could we train the AI with reinforcement learning?"

The scripted NPC AI was decent: traders that flee, pirates that pack-hunt,
police that enforce. Then came the question that changed the project's
character.

The answer was yes, and the reason is worth stating: **the entire flight
model is about ten numbers per ship with closed-form updates.** That's the
regime where simple methods beat sophisticated ones.

The architecture:

- `src/sim/core.ts` — a **render-free copy of the combat physics**, own
  vector/quaternion maths, no three.js. Node runs it flat out; the browser
  viewer replays identical episodes.
- `src/sim/policy.ts` — a **1,899-parameter MLP** (14 → 32 → 32 → 11) whose
  observation is entirely in the ship's own frame, and whose outputs are
  the *same discrete keyboard controls a human gets*: pitch ±/0, roll ±/0,
  throttle ±/0, fire y/n. No cheating with continuous steering.
- `train/evolve.ts` — population evolution strategy. Elites survive,
  offspring are gaussian mutations at mixed sigmas, and every genome in a
  generation is scored on identical episode seeds (common random numbers).
  No dependencies, no Python, no GPU.

### Run 1 — the pirate

400 generations, 210 seconds of one CPU core. Fitness went from −0.5
(random flailing) to **18.36 — statistical parity with the hand-scripted
hunter's 18.34**, which gets perfect continuous steering for free. The
network had to *learn* intercept geometry, throttle management on approach,
and how to hold a firing cone using only key taps.

### Run 2 — self-play, and the arms race appears

Train a trader policy *against that pirate*. The scripted trader scores
about 1 in that matchup — it dies in seconds. The evolved evader reached
**14.44**, surviving most or all of a 45-second episode in a slower, less
agile, unarmed ship.

Then the evaluation tournament made the arms race legible in one table:

| matchup (40 held-out seeds) | kills |
| --- | --- |
| trained pirate r1 vs scripted trader | **100%** |
| trained pirate r1 vs trained evader | **0%** |

Textbook. Which is exactly why league play exists.

### How you tell it's working

This deserves its own note, because it's the part that's easy to skip.
`train/evaluate.ts` is the gate everything must pass:

1. **Held-out seeds.** Training consumes seeds below ~400,000; evaluation
   starts at 10,000,019. A policy that scores well there generalises
   rather than memorises.
2. **Baselines on identical seeds** — the scripted AI as an upper bound
   (it's an aimbot, honestly labelled as such) and an untrained random
   policy as the floor.
3. **Behaviour metrics, not just fitness**: kill rate, time-to-kill, shot
   accuracy, survival time, losses, and the mean angular spread of
   attackers at the moment shots land — a flanking measure.

### Run 4 — the league fixes it, and the pack does not

One league round (seeded from the r1 champion, trained against the evader)
produced a pirate that beats the evader **98%** of the time while still
taking scripted traders 90%. That brain now flies every pirate in the game,
because human players fly evasively.

The pack phase is the honest failure. Three ships sharing one policy with
packmate observations and a shared reward hit the training target (25.04,
matching the scripted-pack benchmark)… and then the held-out tournament
caught it: **70% kill rate versus 100% for three copies of the solo
brain.** When it does kill, it's the fastest anything managed (0.6s — a
coordinated alpha strike), but it had learned a gamble, not a strategy. The
solo trio stayed shipped. The failure is written up with its likely causes
in `docs/TRAINING-LOG.md`, because a training log that only records
successes isn't a log, it's marketing.

## 7. The Jameson Trials

The best story in the project. The question was simple: *can an autopiloted
commander actually make money?* So a script was written to drive the **real
game** through its debug handle — real markets, real fuel, real pirates,
real witch-space, real docking physics, real legal system.

- **MkI** died on his first day. The autopilot aimed its nose at the
  station without correcting lateral drift, bounced off the hull repeatedly,
  and was finished off by pirates. *Validated: collision damage, bounce
  mechanics, pirate lethality.*
- **MkII** is the tragedy. He survived a Thargoid witch-space ambush,
  docked successfully — then during a clumsy approach **rammed another ship
  to death**, was branded a criminal, had his savings confiscated as the
  fine, and ended stranded with 1.3 credits and a 1.5-credit fuel bill.
  A poverty trap, emerging unprompted from systems that were each behaving
  correctly. (Two-thirds of his losses were later traced to a harness bug:
  the test script's `sellAll` took the cargo and *never credited the
  commander*. An embezzling accountant.)
- **MkIII** traded profitably — +38, +26, +38 credits a leg — until pirates
  killed him on the Lave approach holding two tonnes of computers.

Conclusion: the economy works (agricultural↔industrial runs make money;
Lave↔Diso, both agricultural, does not — which is exactly the original's
design), and **survival, not economics, is the binding constraint.**

So the constraint got trained away. Run 5: an *armed* trader policy versus
two of the shipped pirates.

| trader | died | survival | enemy accuracy |
| --- | --- | --- | --- |
| scripted armed trader | 100% | 14.0s | 20% |
| **trained "Jameson" policy** | **10%** | 41.9s / 45s | **1%** |

Evasion-first flying that makes it nearly unhittable, with opportunistic
return fire. It now flies every armed trader in the game — attack a Python
and you're fighting a 90%-survival commander.

**MkIV**, running the trade autopilot with that brain at the stick during
combat: **100 → 461.5 credits in six legs, five kills, two witch-space
ambushes survived, zero deaths.** Per-leg profit *grew* from +45 to +82 as
capital converted into higher-value cargo. The same corridor that killed
MkIII, five times, uneventfully.

The difference between MkIII's grave and MkIV's fortune is one trained
policy — which then became a purchasable **Combat Computer** the player can
buy and engage with a key.

## 8. Going public

Three independent audit agents were turned loose before release: one on
game code readability, one on training reproducibility, one fact-checking
every claim in every document against the code.

They earned their keep. Real bugs found: the galactic hyperdrive left you
permanently flagged as being in witch-space; traders' attacker lists were
never pruned, so they'd dogfight ghosts; two spawn calls used a per-axis
offset that biased ships into one octant of the sky; the hostility
predicate was hand-copied in three places and drifting. The docs audit
caught a README roadmap still advertising *implemented features as
missing*, and a key binding documented on the wrong key.

The reproducibility audit's most useful finding was a footgun: retraining
silently overwrites the committed brains the game imports. That's now
warned about in three places, and the trainer says so before it writes.

## 9. Things worth remembering

- **Verifiable authenticity is a gift.** "System 7 must be Lave" caught
  regressions all session. Find the equivalent invariant in whatever you're
  building.
- **Small models, small problems.** 1,899 parameters, no GPU, 210 seconds
  to parity with hand-written AI. Reach for the sophisticated thing second.
- **The evaluation harness is the product.** Training fitness lied twice
  (the pack phase, and the r1 pirate's apparent dominance). Held-out seeds
  and baseline comparisons told the truth both times.
- **Let the AI play the game to test it.** Three dead commanders exposed
  more real behaviour — collision damage, legal escalation, poverty traps,
  a save-corrupting harness bug — than any amount of clicking around.
- **Document failures with the same care as successes.** The pack-phase
  write-up is the most useful page in the training log.

## 10. Where it stands

A complete Elite: 256 systems per galaxy across 8 galaxies, 21 wireframe
hulls, trading, mining, scooping, four laser mounts, missiles, ECM, energy
bombs, escape pods, legal status, Navy missions, Thargoids in witch-space,
Coriolis and Dodo stations — with the classic 1984 keyboard layout as the
default and a modern WASD alternative one keypress away.

And both sides of every dogfight run on neural networks that taught
themselves to fly, in a simulator built from the game's own physics, using
nothing but the keys you have.

*Right on, Commander.*

---

## 11. Second wave: from recreation to homage

Some time after "it works", the brief sharpened: *treat this as a homage
rather than an exact recreation — it must be recognisable to anyone who
played the original, never "they've ruined it", but we've learned a lot
about game design since 1984.*

That reframing unlocked the most valuable changes in the project.

### The play guide settles some arguments

Fetching the original Players' Guide alongside the manual answered
questions no amount of reasoning could. Two mechanics we'd missed were
pure canon and went straight in:

- **Missiles arm before they lock.** T arms one (amber pylon); it locks by
  itself when a target enters your crosshairs (red pylon, beep). The old
  behaviour — press T, instantly locked — was both wrong and less fun,
  because it removed the act of *flying the shot*.
- **Hull hits cost you things.** "Once a shield is depleted... may destroy
  items of cargo or ship fittings." Losing your combat computer mid-fight
  is a genuinely alarming moment.

The guide also settled provenance on the "rare encounters" list. Ian Bell's
own preface notes that **generation ships were never coded** — they're
fiction from The Dark Wheel. Rock hermits and Trumbles are
[Oolite](https://wiki.alioth.net/index.php/Rock_Hermit_(Oolite))
inventions, [Trumbles arriving in 2005](https://wiki.alioth.net/index.php/Trumble).
So they went in as clearly-labelled homage, each given a *reason to exist*
rather than being decoration: hermits deal ore and ask no questions (the
place to fence contraband, if you can find one), and Trumbles can only be
purged by taking the cabin temperature up on a sun-skim — tying the joke
to an existing mechanic instead of bolting on a cure.

### The mission problem

The sharpest design note in the whole project: *"One thing that really
frustrated me in the original was that you didn't get any missions until
you were way up the skill level."*

That is exactly right, and it's the kind of thing 1984 couldn't afford to
fix. So every station now runs a **bulletin board** — cargo runs, courier
jobs, pirate-clearing bounties, with deadlines measured in days that pass
as you jump. Available from your first landing at Lave. The Constrictor
hunt and the Navy courier run still sit at the top of the ladder, so the
original's structure survives; there's simply a bottom rung now.

A commander with 100 credits used to have no direction at all. Now they
have three or four concrete reasons to pick a destination.

### Modern hands, modern affordances

"We're on much more modern systems now with mouse pointers" turned into:

- **The whole UI is clickable** — menus, market rows, equipment, contracts,
  action buttons — implemented by having clicks *inject synthetic key
  presses*, so mouse and keyboard run through identical handlers.
- **BUY MAX / SELL ALL.** Filling a hold used to take twenty keypresses.
- **Click a star on either chart** to target it (projections inverted, snap
  radius measured in screen pixels so it feels identical at both zooms).
- **Pointer-lock mouse flight** (V) — a self-centring analogue stick, the
  nearest thing to the joystick the original supported.
- **Target brackets with a lead marker** — the single biggest
  fun-per-line-of-code change in the project. Dogfighting went from spray-
  and-hope to something you can get good at.

And yet the default flight keys are now the *authentic* 1984 set — S/X
dive-climb, `<` `>` roll, A to fire — with WASD available on a toggle.
Recognisable first, accessible second.

### Teaching the AI to playtest the game

The unit tests guard the maths. Nothing guarded *gameplay* — until the
combat AI got repurposed into an **autonomous playtest agent**
(`test/playtest.js`): a commander that takes contracts, trades, equips,
jumps, fights (flown by the trained defence brain), docks, detours to
hermits, and asserts invariants every 30 frames — finite positions,
non-negative credits, hold within capacity, valid modes, no screen showing
without a mode behind it.

Its first run found a real defect in two of eight legs: the agent got stuck
in unending dogfights, because the defence policy is trained to *evade*,
and against a pirate it can't kill, the fight simply never ends. A human
would break off and run for the station; now the agent does too.

Its second run came back clean — six legs, four systems, seventeen in-game
days, thirty-six seconds of wall clock — and produced something better than
a pass: **balance telemetry.** Successful legs netted +28 to +55 credits,
with the agent reinvesting everything in cargo, and in six legs it never
accumulated the 400 credits for its first upgrade.

That is the original's grind, measured rather than guessed. Which meant the
next change could be made against evidence instead of vibes.

---

## 12. The galaxy that trades without you

The last big idea had been on the list since the first session: *"I'm
wondering if we could simulate a whole environment of ships doing their own
thing flying between systems."*

The naive reading of that is expensive — 256 systems of NPCs, ticking
forever, 255 of them unwatched. The version that actually shipped is a
**two-level simulation**, and the split is the whole trick:

- **Level 1** (`src/galaxy/living.ts`) is *records, not objects.* A convoy
  is `{from, to, commodity, qty, arrivesOn}` — nine numbers. Time only
  advances when the player's clock does, and it advances in **whole days**,
  because a jump costs days anyway. A year of galactic trade is a few
  hundred integer updates.
- **Level 2** is the NPC spawner that already existed. When you arrive
  somewhere, `populateSystem` asks the living galaxy what's due in — and
  materialises those records as real wireframe ships flying real physics.

So the galaxy is cheap everywhere and expensive only where you're looking.
Convoys depart in proportion to productivity, are lost to piracy in
proportion to lawlessness, and on arrival nudge the destination's prices.
The 1984 seeded economy stays the **baseline** underneath; this layer only
ever stores deltas, caps them at ±25%, and decays them back toward zero when
trade stops. The save grew by about 26 KB.

### Two bugs that only a simulation could have

The first was invisible until the numbers were printed: **danger never
accumulated.** Systems gained 0.1 danger per convoy lost and decayed 0.08
per day, so within a day of any incident the galaxy forgot it happened.
Nothing crashed; the feature simply didn't exist. Slowing the decay to
0.015/day gave piracy a memory — a reputation for danger should outlast a
single ambush.

The second was funnier and much worse. With danger fixed, the report came
back with **Lave as the most dangerous system in the galaxy.** Which is
absurd: Lave is the tutorial. But the code was doing exactly what it was
told — danger was accumulating with *traffic*, and Lave is the busiest
system in human space, so the safest place in Elite had become its worst
pirate haven.

The fix is a one-line reweighting, and it's the sort of thing that only
looks obvious afterwards: piracy scales with **lawlessness**, not volume.

```ts
const lawlessness = (7 - this.systems[c.to].government) / 7;
dest.danger = Math.min(1, dest.danger + 0.22 * lawlessness);
```

…with decay scaled the other way, by how much government there is to do the
policing. After a simulated year: anarchies average 0.143 danger, corporate
states 0.000, and Lave sits at 0.000 with 242 convoys in flight across 51
systems that carry any risk at all. Hotspots now *emerge* along genuinely
lawless routes instead of being scripted — which was the point of building
the layer rather than hand-placing pirates.

One more thing had to change for it to feel like a galaxy. Trade partners
were originally drawn at random from all 256 systems, which produced a
uniform smear of nothing. Restricting each system's partners to its ten
nearest neighbours **within jump range** — because a 7 LY drive means trade
is inherently local — made lanes appear. Trade routes are an emergent
property of the fuel tank.

### A career simulator, because eight legs isn't a sample

The autonomous browser agent (chapter 11) plays the real game, which is its
strength and its limit: it takes four minutes to play eight legs. Balance
questions need hundreds of careers.

So `npm run campaign` runs the game's **actual economic code** headlessly —
the real galaxy generator, the real market model, the real living galaxy,
the real contract rules — with only *flight* abstracted into a dice roll.
That constraint is what makes it trustworthy, and it's why the contract and
market logic was extracted into `src/game/contracts.ts` in the first place:
so there is exactly one copy of the rules, and the simulator can't drift
from the game by construction.

Forty commanders, sixty legs each, in **0.4 seconds**:

```
WEALTH   median net worth 3661.5 Cr, from a 100.0 Cr start
SURVIVAL 32/40 never went broke · 1.4 deaths per career
PACE     median day 136 after 60 legs · first upgrade at leg 7
CONTRACT 22.0 completed · 14.2 failed per career
RATING   median Mostly Harmless
GALAXY   living prices ranged 0.75x..1.25x · mean system danger 0.050
```

It asserts those invariants and fails the build if the economy stops
working. Its first verdict was that contracts paid too little to be worth
the deadline risk — rewards went up about 1.9×, on evidence. The equipment
progression line is the one I find most satisfying: everyone finishes with a
large cargo bay, three quarters have fuel scoops, and only 5% ever afford an
extra energy unit. That's a difficulty curve, printed as a fact.

### AI round 3: two hypotheses, two refutations

Meanwhile the AI got a third round, and it failed twice — which is worth
writing down properly.

**Hypothesis 1: the pack's reward was wrong.** Run 4's pack learned an
all-in alpha strike; the theory was that reshaping the reward toward
sustained pressure would teach coordination. Result: 68% kills against r2's
70%, with accuracy *falling* from 9% to 3%. The reshaping moved the training
score without moving the behaviour. **The bottleneck is not the reward
function** — it's that the policy can't see its mates.

**Hypothesis 2: train the attacker against the best evader.** Seed from r2,
train against `trader-evade-r2`, get a better pirate. Training fitness went
*up* — 18.40, the highest of any run. Kill rate went to **3%**. Textbook
self-play collapse: the r2 evader is so good at running away that the
fitness landscape rewarded closing behaviour that scores points without ever
landing a shot. The number went up and the ship got worse.

Both r3 brains are committed, unshipped, purely as evidence. The game still
flies r2. The evaluation harness caught this in one command — which is, for
the third time in this project, the actual lesson: **training fitness is a
proxy, and proxies lie.** The held-out tournament is the product.

### What this chapter taught

- **Cheap simulation beats no simulation.** Records-not-objects made a
  living galaxy affordable enough to ship; the fidelity you skip is the
  fidelity nobody can observe.
- **A feature that silently does nothing is worse than one that crashes.**
  Danger decayed faster than it accumulated for a whole development cycle.
  Print the aggregate; look at it.
- **Correlate with the right variable.** Danger-follows-traffic and
  danger-follows-lawlessness are the same amount of code and produce
  opposite games.
- **Share the rules, don't copy them.** The campaign simulator is only
  evidence because it imports the same `contracts.ts` the game does.
- **Publish the refutations.** Round 3 is two failures and no shipped
  artefact, and it's the most informative run in the log.
