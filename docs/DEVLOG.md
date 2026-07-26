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
