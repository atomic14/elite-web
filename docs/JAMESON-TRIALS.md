# The Jameson Trials — end-to-end economy simulation (2026-07-26)

> **A dated report, left as written.** Two things in it have since moved: the
> `hull x/6` figures are the retired normalized damage scale (the commander now
> has three 255-point pools — `docs/ELITE-A.md`), and the defence brain is
> `jameson-defend-g1`. The economic findings are unaffected; the combat numbers
> describe a different damage model.

Question: can an autopiloted Commander Jameson accumulate cash running trade
legs in the live game? Method: a scripted pilot driving the *real* game in
the browser through the debug handle — real market rules, real fuel costs,
real hyperspace (witch-space included), real pirates, real docking physics,
real legal system. No cheats except perfect aim on the docking approach (a
stand-in for the docking computer). The player's actual save was backed up
before and restored after.

## The route

- **Lave ↔ Diso** (as first proposed): both agricultural — margins proved
  thin, as the economy model predicts. Best find was one-off fluctuation
  bargains (~+7 Cr on a single tonne of Alien Items).
- **Lave ↔ Leesti** (agri ↔ industrial, the classic): genuinely profitable —
  food/alloys out (≈ +2.5 Cr/t and better), computers back (≈ +30 Cr/t when
  affordable).

## Three commanders

**MkI** — died on his first day. The v1 autopilot aligned its nose to the
station but never corrected lateral drift: repeated hull collisions (bounce
damage) in a Dictatorship system full of pirates. Cause of death: pilot
error, finished off by pirates. *Validated: collision damage, bounce
mechanics, pirate lethality.*

**MkII** — the tragic one. Survived a witch-space Thargoid ambush, docked
successfully (v2 autopilot), then during a bouncy approach **rammed a ship to
death** (kill credited), was branded a criminal, and had his savings
confiscated as the docking fine. Left in a poverty trap: 1.3 Cr, unable to
afford the 1.5 Cr of fuel to reach Lave. *Validated: witch-space escape,
collision kills, legal escalation, fines, and an emergent poverty trap —
all working as designed.* (His chronic losses were compounded by a harness
bug — see below.)

**MkIII** — the professional. Collision-avoidance added (traffic holds when
ships come within 320), affordability-aware cargo buyer (maximise affordable
total profit, not per-tonne margin — the poor commander's liquor-and-food
strategy). Results on Lave↔Leesti:

| leg | cargo | profit | notes |
| --- | --- | --- | --- |
| Lave → Leesti | 16t Food | **+38.4** | clean run |
| Leesti → Lave | empty | −1.5 | fought through 3 pirates, hull 3.6/6, 35 traffic holds |
| Lave → Leesti | 10t Food | **+26.5** | |
| Lave → Leesti | 5t Alloys | **+38.5** | |
| Leesti → Lave | 2t Computers | (unsold) | pirates prevented docking… |

…and then MkIII was killed by pirates on the Lave approach, holding two
tonnes of computers. *Validated: the compounding loop works — when you
survive.*

## Harness bugs the simulation caught (fixed in-session)

1. **v1 docking**: no lateral correction → hull collisions.
2. **v3 gate oscillation**: bang-bang limit cycle between "seek gate" and
   "final run" branches; fixed by latching the final run.
3. **The embezzling accountant**: the harness's `sellAll` took the cargo and
   counted the revenue but *never credited the commander*. Every sale before
   the fix paid nothing. (MkII's poverty was two-thirds this bug, one-third
   his fine.)

## Findings about the game itself

- **The economy is sound**: agri↔agri ≈ break-even; agri↔industrial
  reliably profitable; margins and prices behave per the original model.
- **Piracy risk is real and asymmetric**, exactly as intended: Lave
  (Dictatorship, gov 3) legs saw 1-3 pirates nearly every run; Leesti/Diso
  legs were quiet. An unarmed, non-fighting trader has meaningful mortality
  on the Lave side — a human (or the combat AI) who shoots back fares far
  better.
- **Witch-space** fired 2-3 times across ~12 jumps (9% design rate — a
  little unlucky, within expectation). Escapes worked; ambushes hurt.
- **The legal system bites**: one accidental ram cascaded into
  kill → fugitive → near-total fine. Emergent, fair, very Elite.
- **Poverty traps exist**: below ~2 Cr with an empty tank you cannot buy
  fuel to leave. The original had this too (players begged for the escape
  pod). Possible mercy rule if wanted: stations advance 1 LY of fuel to
  broke commanders.

## Verdict

Yes — Jameson accumulates cash on the proper route (~+30-40 Cr per outbound
leg, computers home when capital allows), and the constraint is *survival*,
not economics: pirates on the low-government side are the tax. Which is,
give or take, the 1984 experience working as intended.

## Epilogue — the Jameson AI (same day)

The trials' conclusion — *survival is the binding constraint* — led straight
to training run 5: a *defence policy* for armed traders (see
TRAINING-LOG.md). Against two shipped pirates on held-out seeds, scripted
traders die 100% of the time; the trained Jameson dies 10%, holding enemy
accuracy to 1% and occasionally shooting an attacker down. Its successor
(`jameson-defend-g1`) flies every armed trader in the game, and it can be
watched in the viewer
("Commander Jameson (defence AI) vs 2 pirates"). MkI, MkII and MkIII did
not die in vain.

## MkIV — first of his name (trade autopilot + trained defence brain)

The full integration: MkIII's trade logic, but when pirates close within
4.5 km the ship is handed to the trained `jameson-defend` policy (flown at
trader-Cobra dynamics, matching its training distribution; it also fires
the player's real laser). Six legs, Lave ↔ Leesti:

| leg | cargo | trade P&L | events |
| --- | --- | --- | --- |
| Lave → Leesti | 16t Food | +44.8 | clean |
| Leesti → Lave | 1t Computers | +14.9 | **witch-space**, 3 pirates, 69s combat, **3 kills**, hull 3.8/6 |
| Lave → Leesti | 7t Liquor | +45.7 | clean |
| Leesti → Lave | 3t Computers | +48.9 | **witch-space**, 3 pirates, 58s combat, 1 kill |
| Lave → Leesti | 11t Liquor | +81.7 | quiet |
| Leesti → Lave | 5t Computers | +82.5 | 1 pirate, 43s combat, 1 kill |

**100.0 → 461.5 Cr (trade P&L +318.5, the rest pirate bounties). Five
kills. Two witch-space ambushes survived. Hull never below 3.8/6. Legal
status: Clean throughout. Zero deaths.**

The compounding curve is the story: per-leg profit *grew* from +45 to +82
as capital converted into higher-value cargo (1 → 3 → 5 computers per
return leg). Where MkIII died holding his first computers, MkIV fought
through the same corridor five times. The difference is one trained policy.

Rating at retirement: still Harmless (5 kills; Mostly Harmless at 8).
Next milestone for a MkV endurance run: Competent (512).
