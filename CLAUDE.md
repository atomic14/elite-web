# CLAUDE.md — working on HARMLESS

**HARMLESS** — an unofficial browser tribute to Elite (1984). TypeScript, Vite,
three.js, with a scripted attack run for the ships that hunt you and
neuroevolution self-play for the ones that fly with you. Public repo, MIT plus
a fan-project notice; keep the non-commercial homage framing intact.

This is a guide to how we work, not a specification. Facts about the code belong
in the code. The numbered invariants are `docs/INVARIANTS.md` — code cites them
by number. Where things live is `docs/ARCHITECTURE.md`. Why a decision was made
is `docs/TODO/` and the git log.

## How we work

**Understand the problem in full before changing anything.** Read the code that
actually runs, not the code you expect. Find the real cause rather than the first
plausible one — most of the expensive mistakes in this repo were a correct fix to
a misdiagnosed problem. If you cannot explain why something is broken, you are
not ready to fix it. If a doc and the code disagree, the code is what ships.

**We are not constrained by time or resources.** There is no deadline and no
budget to protect. Read the whole file. Run the measurement again at a larger
sample. Write the harness. Check the thing you assumed. Never pick a worse answer
because the better one takes longer, and never narrow the scope of a job to
finish sooner — if the work turns out bigger than it looked, do the bigger work.

**Say what is true.** Report what you actually ran and what it actually printed.
A number you did not measure is not evidence, and neither is a number from a doc
that may predate a physics change — measure, don't cite. If something failed, say
so plainly. If you are unsure, say that instead of hedging a guess into a claim.

**One rule has one home.** The recurring failure here is one rule with two homes,
kept in step by hope. Two copies that currently agree are still a defect: nobody
can change either without remembering the other. When you find a second home,
deleting it is the fix — not a comment asking the next person to keep them in
step.

**Read `src/constants/` before you start.** Read the files, in full. Do not grep
it, do not search it for the name you have in mind, and do not skim it — the
whole point is to find the constant you did not know was already there, under a
name you would not have guessed. Before adding any constant, including one
derived from another, confirm it does not already exist. A value that exists
twice is a rule with two homes, and this is the directory that stops that.

**Leave the reasoning where the next person will look.** A constant is worth the
sentence that says how it was chosen, beside it. A decision worth making is worth
a line saying what else was considered.

## The architecture we are building toward

**One world state. A pure step that advances it. A renderer that only reads it.**

- The world advances in fixed slices from one seeded source of chance, so the
  same inputs give the same run. That is what makes a replay, a regression test
  and a training run possible at all — seeded reproducibility is not negotiable.
- The trainer flies the **real game**. There is no second physics, and no second
  copy of a rule for training to use.
- A module decides and reports; the orchestrator applies. Modules return events;
  the game applies them.
- Anything that drives behaviour and is not a constant is state, and state is
  saved. Nothing that matters is read from ambient globals.
- The platform lives behind one seam, so the game runs headless under node. Keep
  it that way; the portability gate measures it.

## Testing

**Everything is tested.** New code comes with tests, and a change to a rule
changes the test that pins it.

- **A gate you have not broken is not a gate.** After writing a test that
  protects a rule, break the rule and confirm the test fails. Whole rules have
  survived deletion in this repo with nothing going red.
- **Assert the rule, not the implementation.** A check that expands to
  `f(x) === f(x)` passes on any code.
- **Read the set, not the sample.** Defaults are a convenience, not a sample
  size. Before a number decides anything, run it at two sizes and check the
  answer is the same one. Findings here have reversed sign between a small run
  and a large one.
- **Prove equivalence, not self-consistency.** When refactoring, show the same
  seed gives the same outcome as the old code.

Lint and tests run as part of the build, which is what stops a broken commit
reaching the live site. Don't move them out of that path.

## The AI

**Two kinds of pilot, and they are not interchangeable.** Know which one you are
touching before you touch it — `brain-names.ts` is where the rule lives.

- **Scripted flies the opposition.** Every pirate a player meets, solo or in an
  organised gang, flies the hand-written three-phase attack run — close, pass,
  extend. No neural net is involved. This is what ships, so a fix here is a fix
  to the fight.
- **Trained flies your side, and ONLY your side.** One policy — the
  `jameson-defend` line — is both the armed trader's pilot and the combat
  computer the player buys, and since 2026-08-05 it is the only trained policy
  in the bundle: the two trained pirate policies were deleted outright
  (scripted is the opposition everywhere, the trainer's rows included), so
  "the pirate brain" no longer names anything and an encoder change costs one
  retrain, not three.

**Threat is not fun**, and the split above is the scar it left. A well-optimised
pirate is a turret that hangs in space and snipes; evolution found it twice, won
every measurement both times, and Chris asked for the old brain back both times.
So the hostile is scripted, because a run we write can be made to feel like a
dogfight the player can win and a run we fit was not. Reach for training when the
job is to survive a fight; reach for script when the job is to give the player
one.

Lethality is a proxy for threat, and a brain that wins every measurement can
still be the wrong brain — **a measurement can be excellent and be measuring the
wrong quantity**. Prefer a fight a human flew to a bot-flown number, and **fly it
before tuning it**. Changing a combat number invalidates the brains; retrain
deliberately.

Two hazards worth knowing before your first training run: a run with no output
name **overwrites a shipped brain**, and without validation-based selection the
champion is the luckiest generation rather than the best genome.

## Style

- **Keep files small**, and keep each one about a single thing. When adding to a
  long file the question is not "will this fit" but "what is this file FOR, and
  is this that?" If the answer needs an "and", it belongs elsewhere. Going over
  the ceiling deliberately, with a stated reason, is a fine answer. Trimming real
  content to fit under it is not.
- **Module headers state what a file is for** — maintain them. A file that needs
  a paragraph elsewhere to make sense has the wrong name.
- This is a **homage, not a museum piece**: instantly recognisable to anyone who
  played the original, but applying what game design has learned since 1984.
  Deliberate deviations get written down.
- Commit per milestone, with a message saying what changed and why.
