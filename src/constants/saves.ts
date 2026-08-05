// The shelf: how often the game saves on its own, how much it keeps, and how
// long a name may be.
//
// What a save IS — the record shape, the id grammar and the name rules — is
// `game/save-file.ts`, and WHERE one lives is `game/storage.ts`, the only file
// that may touch localStorage. The two format versions and the id prefix stay
// beside the shapes they version (a version bumped in a different file from
// the shape it describes is a divergence waiting to happen), and the storage
// namespaces stay module-private in storage.ts on that file's own security
// argument: nothing importable may be able to compute a player's key.

/** Seconds between mid-flight world saves — see Game.autoSave(). */
export const AUTOSAVE_INTERVAL = 20;

/**
 * How many in-flight autosaves are kept, PER CAREER.
 *
 * Three, at the `AUTOSAVE_INTERVAL` cadence, is the last minute of flying
 * (`test/saves.test.ts` pins the product at 60 seconds): far enough back to
 * step out of the fight you just lost, and no further, because every extra
 * slot buys another twenty seconds of the SAME engagement while costing
 * ~10 kB. The dock checkpoint is the real fallback (docs/TODO/40 decision 3),
 * and it is deliberately not part of this ring (decision 2).
 *
 * Per career and never global: a global ring silently belongs to whoever flew
 * last, so keeping two careers would mean the second one's quiet cruise
 * evicted the first one's only way back.
 *
 * SHRINKING IT ORPHANS KEYS. The ring's slots are storage keys
 * (`save:auto:<CAREER>:fly:<n>`), so a smaller ring leaves the higher slots
 * on the shelf where `flightIds` can no longer address them — they still list
 * and load, but nothing ever overwrites or clears them again.
 */
export const FLIGHT_RING = 3;

/**
 * How many NAMED saves a player may keep.
 *
 * A snapshot is about 10 kB against a few megabytes of localStorage, so this
 * is nowhere near the real limit — it is a guard rail so a stuck finger cannot
 * fill the store and start failing the AUTOSAVES, which are the saves nobody
 * asked for and everybody relies on. Reaching it refuses the write and says
 * so; nothing is ever deleted to make room.
 */
export const MAX_NAMED_SAVES = 20;

/**
 * Longest name a player may type.
 *
 * 16, because that is what the list column holds without wrapping and what
 * keeps an id short; the naming screen already refused anything but letters,
 * digits and space, and this is the same alphabet with a stated ceiling.
 */
export const MAX_SAVE_NAME = 16;
