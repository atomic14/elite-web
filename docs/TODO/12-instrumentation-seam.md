# 12 — Console harnesses are load-bearing on production signatures

**Kind:** conjoined modules · **Severity:** medium · **Size:** medium

## What is wrong

Untyped console harnesses have become part of the production interface. A method's
name, its visibility, and at least one otherwise-unused parameter are all fixed by
what `test/*.js` monkey-patches — and the constraint is *documented* rather than
removed.

Documenting a coupling is better than leaving it implicit, but it still means
refactoring the orchestrator requires grepping JS files the compiler never sees.
An unused parameter kept alive so a monkey-patch can read argument three is the
clearest symptom.

## Evidence (read at `de9a668`)

`src/game/game.ts:1105-1113`:

```ts
 * `DamageSource`, and test/combat-recorder.js, which reads it off argument
 * three instead of guessing from `amount`.
 *
 * @internal — wrapped by test/combat-recorder.js
 */
applyPlayerDamage(amount: number, from: THREE.Vector3, _source: DamageSource): void {
```

The `_source` prefix says the production code does not use it; the docstring says
a JS harness does.

Also `test/playtest.js:168` — `if (c.fire) g.fireLaser();` — so `fireLaser`'s name
and public visibility are fixed by an untyped file.

## The fix

Publish an explicit instrumentation seam instead of relying on monkey-patching:
an optional observer the recorder registers, e.g.

```ts
export interface CombatObserver {
  onPlayerDamaged?(amount: number, from: THREE.Vector3, source: DamageSource): void;
  onShot?(...): void;
}
```

set through a named method (or via `console.ts`, which already exists to publish
handles for outside-in access). Then `combat-recorder.js` registers an observer
rather than wrapping a method, `_source` becomes a real argument passed to a real
consumer, and the orchestrator's methods are free to change.

Keep the recorder working — the combat trainer's records are the project's best
evidence about the AI, and CLAUDE.md prefers a fight a human flew to a bot-flown
measurement. Do not trade that away for tidiness.

`fireLaser()` being public and named is a much smaller matter: it is a genuine
verb, so a harness calling it is not the same smell as a harness wrapping it.
Leave it, or fold it into whatever `Command`-driven path a driver already uses.

## Verify

- `npm run lint && npm test`
- **Run the recorder end to end**: dock, `T` for the combat trainer, fly an
  exercise, and confirm the exported JSON still has damage-by-source populated
  (clipboard, file, and `window.__simLog`). If `source` comes back as unknown or
  missing, the seam is not equivalent.
- Grep `test/*.js` for every method the harnesses touch before changing any of
  them; the compiler will not help.
