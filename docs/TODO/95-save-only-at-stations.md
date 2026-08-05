# 95 — Save only at stations, and re-roll the sky on restore

**Kind:** architecture / saves · **Severity:** high · **Size:** large
**Depends on:** none · **Chris decided this on 2026-08-05**: "there is no
requirement for a restored game to play exactly the same every time it is
restored … move saving back to only in space stations."

## Why

The project carries a requirement that a restored world *continues* the run
it was saved from — tick for tick, byte for byte. Traced (2026-08-05,
session on the v2 defence brain), it is not a product decision at all:

- It began as a **debugging instrument**. Commit `178fde7` (2026-07-29)
  hand-listed the NPC snapshot and shipped wrong four times running; each
  missing field was found by saving mid-fight, restoring, and comparing the
  two runs. "Two reloads agreed with each other and not with the run they
  came from" was the *signature of a missing field* — a diagnostic, not a
  promise to players.
- The diagnostic then hardened into doctrine in three steps: the persistence
  tests pinned it as a gate ("a restored ship replays the run it came from",
  `test/snapshot.test.ts:157`), `docs/ARCHITECTURE.md` stated it as the
  property ("the restored world *continues* the run rather than merely
  resembling it"), and CLAUDE.md compressed it to "anything that drives
  behaviour … is state, and state is saved" with the scope note lost.
- From then on it **taxed design**: `AutopilotState` exists to persist a
  10Hz decision cache; the threat lock (`game/threat-lock.ts`) carries a
  paragraph arguing its way out of being saved; and it weighed against a
  recurrent defence brain, because RNN hidden state would have to be
  serialised into every snapshot.

The only reason the requirement has teeth is the **in-flight autosave**:
`world-step.ts:539` writes a snapshot every `AUTOSAVE_INTERVAL` (20s,
`constants/saves.ts:13`), three slots per career — "the last minute of
flying" — and `resume()` restores one mid-engagement. A save taken
mid-fight must carry the fight; a save taken docked carries a career.

## The decision

**Saving happens only docked at a station** — which is also what Elite
(1984) did, so this is the homage recovering its own shape, not a cut. A
restore rebuilds the world from the docked state and re-rolls the sky:
there is no mid-flight instant to resume, so there is nothing for a
snapshot to forget.

## What it dissolves

- The in-flight autosave: `session.autoSaveTimer`, `AUTOSAVE_INTERVAL`, the
  three-slot rotation and its "must not outlive the ship" cleanup
  (`game.ts:887`).
- Most of the NPC snapshot surface: `brainControl`, `brainTimer`, the
  ramped turn rates, trigger/trade clocks — the fields whose absence only a
  mid-flight restore could ever notice. A docked save has no NPCs in it.
- `AutopilotState` persistence (the combat computer is off when docked).
- The continuation gates: the "replays the run it came from" blocks in
  `test/snapshot.test.ts` / persistence tests, replaced by "a docked save
  round-trips the career and the world re-rolls legally".
- The design tax: recurrent brains stop being a serialisation question;
  future modules stop arguing with the snapshot about what counts as state.
- The `docs/ARCHITECTURE.md` sentence and the CLAUDE.md bullet get
  rewritten to the weaker, true claim: *material* career state is saved.

## What stays — do not confuse the two reproducibilities

**Seeded simulation reproducibility stays, untouched.** Same seed, same
run is what makes the trainer, the regression tests and a bisect possible
(`npm test` replays 600 world steps byte-identically). That property is
about the *step*, not about saves — none of it depends on restoring a
mid-flight instant. Only save/restore behavioural continuation goes.

Also stays: the docked save as the career's whole record — commander,
cargo, market, contracts, legal status, galaxy position, equipment — and
94's parse-at-the-door refusal of malformed saves.

## Consequences to decide deliberately

- **Death** currently offers the last minute of autosaves to step back
  into; station-only saving makes death cost everything since the last
  dock — the 1984 rule. That is a real difficulty change and should be
  stated in release notes, not discovered.
- **Mid-flight quit** (browser closed) resumes at the last dock. The
  session's flight is forfeit; nothing partial is written.
- **Old saves**: a stored autosave from before this change carries a
  mid-flight world. Decide whether `resume()` re-docks it at the nearest
  station or refuses it with words; silently flying it is the one wrong
  answer.
- The combat trainer's exercise records (`combat-sim-report`) are not
  saves and are unaffected.
