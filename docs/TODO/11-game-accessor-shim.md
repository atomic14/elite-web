# 11 — Forwarding accessors are the orchestrator's public interface

**Kind:** pass-through · **Severity:** medium, but it is the largest single
distortion in the codebase's measured shape · **Size:** large — do this one on
its own

## What is wrong

`game.ts` has 83 one-line getter/setter lines (measured:
`grep -c "^  \(get\|set\) " src/game/game.ts`), each forwarding a single field to
`state`, `session`, `sys` or `ordnance` and adding no abstraction. Its measured
public surface is 122 over 1032 nloc — the widest interface in the project,
wrapped around a genuinely deep core.

Worse than the width: `state` is **also** public (`game.ts:187`
`readonly state: GameState = freshState(loadCommander())`), so every one of those
fields now has two writable paths — `g.commander = x` and `g.state.commander = x`
— with nothing saying which is canonical.

The result is that a reader looking for the orchestrator's actual interface — the
fixed-timestep loop, the mode machine, the `apply*` verbs — has to find it among
120 forwarders.

## Evidence (read at `de9a668`)

- `src/game/game.ts:187-205`:
  ```ts
  readonly state: GameState = freshState(loadCommander());

  get systems(): StarSystem[] { return this.state.systems; }
  set systems(v: StarSystem[]) { this.state.systems = v; }
  get commander(): CommanderData { return this.state.commander; }
  set commander(v: CommanderData) { this.state.commander = v; }
  ...
  ```
- `src/game/game.ts:196-201` states the reason plainly: the console harnesses
  (`test/playtest.js`, `gang-trial.js`, `combat-recorder.js`) and the docs reach
  for `g.npcs` and `g.scene` by name.

## The fix

The reason for the accessors is real — untyped JS harnesses depend on the names —
so this is not "delete them". It is: **stop them being the orchestrator's
interface.**

Move them out of the class into an explicitly-named compatibility shim: a
`legacyHandles(game)` object, or a separate `game-handles.ts` mixin, installed
where `console.ts` already installs the handles. `console.ts` is the one file
allowed to touch `globalThis` and already exists for exactly this kind of
outside-in access, so it is the natural home. Then `game.ts` contains the loop,
the step order, the mode machine, the wiring and the `apply*` verbs — which is
what CLAUDE.md says it is for — and a reader can see that in one screen.

While doing it, settle the two-write-paths question: decide whether `state` stays
public, and say so in a comment. If it does, the shim's setters are redundant and
should be getters only.

Two constraints to respect:

- The harnesses are **untyped JS**, so the compiler will not catch a rename.
  Grep `test/*.js` for every accessor name before moving it.
- `npm run sizes` — `game.ts` is 1742 loc. Removing ~120 lines helps; check
  whether it is in the allowlist in `tools/sizes.mjs` and whether the stated
  reason still holds afterwards.

## Verify

- `npm run lint && npm test && npm run sizes`
- `node test/playtest.js` (or however the harness is invoked) and the other two JS
  harnesses — they are the whole reason the accessors exist, so a green
  `npm test` is not sufficient evidence here.
- `npm run campaign`.
- Re-run the architecture review afterwards. This is the change most likely to
  move `game.ts`'s depth score, and it is worth seeing whether it does.

## Notes

Do **not** do this in the same session as anything else. It touches the file every
other fix also touches, and a large mechanical move is much easier to review on
its own.
