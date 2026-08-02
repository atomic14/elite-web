# Browser play trials

The measurements a bot cannot take. CLAUDE.md's rule is the whole reason this
file exists: **prefer a fight a human flew to a bot-flown measurement**, because
bots mislead in both directions — flying straight flatters a brain fitted to
freighters, and the defence policy evades superbly while shooting badly.

Everything below is flown at `npm run dev` → http://localhost:5173/play.
Nothing here needs a console: `T` at any station opens the combat trainer, and
it exports the whole record as JSON (clipboard, file, and `window.__simLog`).

**Never write save slots 1-3.** The combat trainer already runs on a clone and
restores your career on exit; if you drop to a console, use slot 4.

---

## TODO 29 — the trial list

TODO 29 changed three things a human can feel and a harness cannot judge. Fly
each section, record the numbers the trainer prints, and note whether the fight
was FUN — which outranks every figure in it.

### 1. Threat: pirates now bite

**What changed.** A combat role flies the hardest released build of its hull
that the source ever filed under that job, instead of the pack's recommended
default (`src/game/role-variants.ts`). Same ships, same geometry, same names —
a different released build, with one more point of laser power on most of them.

| you meet | it did | it does now |
| --- | --- | --- |
| Sidewinder | 9 a hit | **13** |
| Krait, Mamba, Gecko, Cobra Mk I, Bushmaster | 9 | **13** |
| pirate Cobra Mk III | 9 | **13** |
| Python | 13 | **17** |
| Fer-de-Lance | 17 | **21** |
| Viper (police) | 13 | **17** |
| Worm, Ophidian, Rattler, Iguana, Chameleon, Monitor, Thargoid | unchanged | |

Your front face is 255 shield points and the bank behind it another 255.

**Fly:** `T` → a tier-0 scenario, then tier-1, then tier-2.

**Expect to see**
- a fore shield that visibly moves. Before this, 57 pirate hits stripped one
  face; now it is about 39, and the trainer's `poolsAtStart` / `poolsAtEnd`
  say exactly how much went.
- the same time-to-kill going the other way. Nothing about your guns changed.
- **no Asp Mk II** as a pirate or a bounty hunter. It is gone from those two
  rosters and the reason is in `ship-specs.ts`: every released Asp build does
  zero to every hull the commander can fly.

**Report:** shield low-water mark, damage by source, and whether the fight felt
threatening rather than merely longer.

### 2. Flight behaviour: attack runs, not a turret

**What changed.** Nothing yet, unless a brain is promoted — but the candidates
exist and are one line away. CLAUDE.md: *a well-optimised pirate is a turret
that hangs in space and snipes, and evolution will find it.*

**Fly:** the same scenario twice, same seed, swapping the opposition in the
trainer's brain picker (`pirate-attack-g3`, then a candidate).

**Watch for, in this order of importance**
1. **Attack runs.** Does it come at you, pass, and come back? Or does it park
   at 500 units and pivot?
2. **Overshoots.** A pirate that never overshoots is aiming, not flying.
3. **Weaving.** Hard to hit is the *same fact* as "they never shoot", seen from
   the other cockpit — that is the balance, and it is meant to be tight.
4. Only then: how much of your shield it took.

The trainer reports mean engagement range, time on each other's six and
lined-up share. A brain with a HIGH lined-up share and a LOW on-six time is the
turret; the one to want is the reverse.

### 3. Time-to-kill and hit readability

**Fly:** sparring, one opponent, and count.

**Expect:** every laser the Cobra Mk III can carry still breaks a cargo
canister in one hit. Kills should feel the same as before — the outgoing
direction did not change in TODO 29.

**Report:** shots to kill per hull, and whether a hit on you is legible — the
flash, the sound and the shield bar should agree about what just happened.

### 4. Warning cadence

**Expect:** CONDITION RED at 9,000 units, and the shield/energy readouts moving
in visible steps rather than a smooth crawl. A 13-point hit on a 255-point face
is 5% — check that it reads.

### 5. Docking risk

**Unchanged, and worth re-checking because the pools are the same object the
scrape spends from.** A fluffed slot costs 230 of a 255-point face. Try one
deliberately bad approach with a full shield and one with a half shield.

**Expect:** the bad approach on a full shield is survivable and expensive; on a
half shield it reaches the hull.

### 6. Old and new hull encounters

**Fly:** the trainer's hull picker, at least one of each —
- an original-roster hull: Sidewinder, Krait, Mamba, Gecko, Cobra Mk III
- one brought in by TODO 25: Bushmaster, Rattler, Iguana, Chameleon, Monitor,
  Ophidian, Cobra Mk I, Ghavial
- the Constrictor (see below)

**Expect:** every one of them renders with exact geometry and a target radius
that matches what you can hit. A hull whose ring sight does not match its
silhouette is a geometry bug, not a balance one.

### 7. The Navy mission's signposting

**What changed.** The Constrictor is untouched — its source-exact armour halves
your hit before its own defence subtracts, so a **beam laser does exactly zero**
and only the military laser kills it in a reasonable time. What is new is that
the Navy now tells you, in the docking transmission and on the mission line,
using your actual fitted gun:

> NAVY: TARGET ARMOUR HALVES LASER FIRE — YOUR BEAM LASER SCORES 0 A HIT, A
> MILITARY LASER 3

It says nothing at all once you are carrying the military laser.

**Fly:** reach the briefing (16 kills, galaxy 1) with a beam laser fitted, and
read the message. Then fit a military laser (6,000 Cr, TL10+ — 79% of galaxy 1
is within one jump of a system that sells it) and check the line goes away.

**Report:** whether the warning arrives in time to act on it, and whether it is
legible in the message queue at the moment of docking.

---

## What to send back

The trainer's JSON export, plus one sentence per section on whether it was fun.
Paste the records into a training-log entry; `docs/TRAINING-LOG.md`'s rule is
that entries are appended, never edited, so a trial that contradicts an earlier
one is the record working rather than a problem.
