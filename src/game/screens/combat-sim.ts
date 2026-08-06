// The combat trainer's front of house: pick a fight, read the report, hold two
// of them against each other.
//
// The last piece of docs/COMBAT-SIM.md, and the smallest, because the modules
// underneath it already answer everything — combat-sim-scenarios.ts says who can
// be sent at you, combat-sim.ts runs the exercise, combat-sim-report.ts counts
// what happened, combat-sim-compare.ts decides what two records may honestly be
// said to show — and combat-sim-setup.ts beside it owns the draft. What is left
// here is the keyboard, the three panels, and the export.
//
// **The exercise is NOT this screen**, and that correction is in the spec.
// `Game.mode` is derived (`screens.topId ?? baseMode`) and `updateFlight()` runs
// only while it is `'flight'`, so the world does not step at all while an
// overlay is open. So one screen id holds three PANELS with the fight in
// between: pick a fight, launch, fly it as ordinary flight with a different
// `StepHost`, and the Game re-opens this screen on the report panel when it
// tears down. Compare is the report panel's own second view — ENTER, from the
// record you want as the baseline.
//
// It obeys the Screen contract like every other overlay: it never sets the mode,
// never touches the Game, and returns an outcome. What it needs from the Game is
// four things behind `CombatSimContext` — the commander the fit-out starts from,
// the records of the last exercise, something to say out loud, and `begin`.

import type { CommanderData } from '../commander.ts';
import type { ExerciseFit } from '../combat-sim.ts';
import { combatSimJson, type CombatSimReport } from '../combat-sim-report.ts';
import {
  compareReports, comparisonJson, type SimComparison,
} from '../combat-sim-compare.ts';
import type { ExerciseSpec } from '../combat-sim-scenarios.ts';
import {
  fitFrom, freshDraft, freshSeed, setupCells, specFrom,
  type SimDraft,
} from './combat-sim-setup.ts';
import {
  brainNote, brainNoteReserve, draftNotes, draftNotesReserve,
} from './combat-sim-notes.ts';
import {
  renderCombatSimSetup, renderCombatSimReport, renderCombatSimCompare,
} from '../../ui/screens.ts';
import type { Screen, ScreenOutcome } from '../../ui/screen-host.ts';
import type { Input } from '../../engine/input.ts';
import { sfx } from '../../audio.ts';

/** The slice of the Game this screen is allowed to see. */
export interface CombatSimContext {
  /** the CAREER commander — what the fit-out rows start from */
  readonly commander: CommanderData;
  /** the records the last exercise produced, oldest first */
  readonly reports: readonly CombatSimReport[];
  /** start one. False when the Game refused — you are dead, or one is running */
  begin(spec: ExerciseSpec, fit: ExerciseFit): boolean;
  message(text: string, seconds: number): void;
}

const cycle = (n: number, len: number, d: number): number => (n + d + len) % len;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
/** `REPORT` / `4 RECORDS` — ⇧X on a one-record session said "1 RECORDS". */
const plural = (n: number): string => (n === 1 ? 'REPORT' : `${n} RECORDS`);

export class CombatSimScreen implements Screen {
  readonly id = 'combat-sim' as const;

  private readonly ctx: () => CombatSimContext;

  /** setup, report or compare — three panels, one screen id, the fight in between */
  private panel: 'setup' | 'report' | 'compare' = 'setup';
  private row = 0;
  /** which of the exercise's records the report panel is showing — THIS */
  private record = 0;
  /**
   * The OTHER record the compare panel is holding this one against — THAT.
   *
   * Kept beside `record` rather than derived, because the compare panel's whole
   * gesture is to pin one record and walk the other: `←/→` moves this index and
   * leaves `record` where it was.
   */
  private other = 0;
  /**
   * What has been picked, or null until the screen is first opened.
   *
   * Built once and kept for the session on purpose: A/B-ing two brains over the
   * same fight means launching the same setup twice, and re-deriving the draft
   * from the commander on every open would throw the second one away.
   */
  private draft: SimDraft | null = null;

  constructor(ctx: () => CombatSimContext) {
    this.ctx = ctx;
  }

  /**
   * Show the report panel next time this screen opens.
   *
   * Called by the Game when an exercise tears down. The screen cannot notice
   * that for itself — it is not running while one is flying.
   */
  showReport(): void {
    this.panel = 'report';
    this.record = Math.max(0, this.ctx().reports.length - 1);
  }

  open(): void {
    this.draft ??= freshDraft(this.ctx().commander);
    // The best wave is re-read on every open: the draft is kept for the
    // session, and a run flown since the last open is exactly when it moves.
    this.draft.furthestWave = this.ctx().commander.furthestWave ?? 0;
    const n = this.ctx().reports.length;
    if (this.panel === 'report' && n === 0) this.panel = 'setup';
    // A pair needs two. The ring only grows while this screen is closed, but a
    // panel that reopened onto one record would have nothing to compare it with.
    if (this.panel === 'compare' && n < 2) this.panel = n ? 'report' : 'setup';
    this.render();
  }

  render(): void {
    const reports = this.ctx().reports;
    if (this.panel === 'compare') {
      renderCombatSimCompare({
        compare: this.pair(),
        thisIndex: this.record,
        thatIndex: this.other,
        total: reports.length,
      });
      return;
    }
    if (this.panel === 'report') {
      this.record = clamp(this.record, 0, reports.length - 1);
      renderCombatSimReport(reports[this.record], this.record, reports.length);
      return;
    }
    const draft = this.draft!;
    const cells = setupCells(draft);
    this.row = clamp(this.row, 0, cells.length - 1);
    renderCombatSimSetup({
      rows: cells,
      selected: this.row,
      notes: draftNotes(draft),
      notesReserve: draftNotesReserve(),
      // The row's own answer to "and what is that?", so a brain row says what it
      // does rather than only what it is called.
      brainNote: brainNote(cells[this.row].brain),
      brainReserve: brainNoteReserve(),
      hasReport: this.ctx().reports.length > 0,
    });
  }

  /** A click on a row selects it — the same path the arrow keys take. */
  select(row: number): void {
    if (this.panel !== 'setup' || !this.draft) return;
    this.row = clamp(row, 0, setupCells(this.draft).length - 1);
    this.render();
  }

  input(i: Input): ScreenOutcome {
    if (this.panel === 'compare') return this.compareInput(i);
    return this.panel === 'report' ? this.reportInput(i) : this.setupInput(i);
  }

  // --- the setup panel ------------------------------------------------------

  private setupInput(i: Input): ScreenOutcome {
    const d = this.draft!;
    if (i.pressed('Escape')) return 'back';
    if (i.pressed('Enter')) return this.launch();
    if (i.pressed('KeyL')) {
      if (this.ctx().reports.length === 0) return this.refuse('NO REPORT YET');
      this.panel = 'report';
      this.record = this.ctx().reports.length - 1;
      return this.repaint();
    }
    if (i.pressed('KeyR')) { d.seed = null; return this.repaint(); }

    const cells = setupCells(d);
    const up = i.pressed('ArrowUp');
    const down = i.pressed('ArrowDown');
    if (up || down) {
      this.row = cycle(this.row, cells.length, down ? 1 : -1);
      return this.repaint();
    }
    const left = i.pressed('ArrowLeft');
    const right = i.pressed('ArrowRight');
    // HOME / END are the same gesture with a bigger step: a list of twelve
    // brains or forty-odd hulls has ends you should not have to walk to. Rows
    // over a number have no `jump`, so the key does nothing on them rather than
    // meaning something different.
    const home = i.pressed('Home');
    const end = i.pressed('End');
    if (left || right || home || end) {
      const cell = cells[clamp(this.row, 0, cells.length - 1)];
      if (home || end) cell.jump?.(end ? 1 : -1);
      else cell.change?.(right ? 1 : -1);
      return this.repaint();
    }
    return 'stay';
  }

  /**
   * Launch it.
   *
   * `begin()` puts the ship in the sky and clears the screen stack itself
   * (`SimHost.enterFlight`), so `'exit'` here is belt and braces rather than the
   * mechanism. The rolled seed is kept and shown, so the fight can be flown
   * again: docs/COMBAT-SIM.md asks for the seed in the report AND on the panel.
   */
  private launch(): ScreenOutcome {
    const d = this.draft!;
    const seed = d.seed ?? freshSeed();
    d.lastSeed = seed;
    if (!this.ctx().begin(specFrom(d, seed), fitFrom(d))) {
      return this.refuse('SIMULATOR UNAVAILABLE');
    }
    sfx.combatSimulationLaunched();
    return 'exit';
  }

  // --- the report panel -----------------------------------------------------

  private reportInput(i: Input): ScreenOutcome {
    const n = this.ctx().reports.length;
    if (i.pressed('Escape')) {
      // back to the setup panel, not out of the screen: the seed is on the
      // report, and the reason to read one is to change something and fly again
      this.panel = 'setup';
      return this.repaint();
    }
    // ENTER is the launch key on the setup panel and free here, so comparing
    // costs no new binding: the report's own keys already spend ←/→, C and X,
    // and ESC is the way back. The gesture reads the same on both panels —
    // ENTER is what you press when you have chosen something.
    if (i.pressed('Enter')) {
      if (n < 2) return this.refuse('NEED TWO RECORDS TO COMPARE');
      // The one before it: two records flown back to back on one setup is the
      // A/B, so the pair the pilot most likely wants is already made.
      this.other = cycle(this.record, n, -1);
      this.panel = 'compare';
      return this.repaint();
    }
    const left = i.pressed('ArrowLeft');
    const right = i.pressed('ArrowRight');
    if (left || right) {
      this.record = cycle(this.record, n, right ? 1 : -1);
      return this.repaint();
    }
    const all = i.held('ShiftLeft', 'ShiftRight');
    if (i.pressed('KeyC')) return this.copy(this.json(all), plural(all ? n : 1));
    if (i.pressed('KeyX')) return this.download(this.json(all), this.stem(all), plural(all ? n : 1));
    return 'stay';
  }

  // --- the compare panel ----------------------------------------------------

  private compareInput(i: Input): ScreenOutcome {
    const n = this.ctx().reports.length;
    // ESC goes back to the record you opened it from, and so does ENTER: the
    // key that opened the pair closes it again.
    if (i.pressed('Escape') || i.pressed('Enter')) {
      this.panel = 'report';
      return this.repaint();
    }
    const left = i.pressed('ArrowLeft');
    const right = i.pressed('ArrowRight');
    if (left || right) {
      // The same key that walks the ring on the report panel, walking THAT and
      // leaving THIS pinned — and never landing on THIS, because a record
      // compared with itself is not a comparison.
      do {
        this.other = cycle(this.other, n, right ? 1 : -1);
      } while (this.other === this.record && n > 1);
      return this.repaint();
    }
    if (i.pressed('KeyC')) return this.copy(comparisonJson(this.pair()), 'PAIR');
    if (i.pressed('KeyX')) {
      const c = this.pair();
      return this.download(comparisonJson(c),
        `pair-seed${c.a.seed}-vs-seed${c.b.seed}`, 'PAIR');
    }
    return 'stay';
  }

  /**
   * The two records the compare panel is showing, held against each other.
   *
   * Derived on demand and kept nowhere: `compareReports` is a pure function of
   * two finished records, so there is no comparison state to go stale when the
   * ring grows.
   */
  private pair(): SimComparison {
    const reports = this.ctx().reports;
    this.record = clamp(this.record, 0, reports.length - 1);
    this.other = clamp(this.other, 0, reports.length - 1);
    if (this.other === this.record) this.other = cycle(this.record, reports.length, -1);
    return compareReports(reports[this.record], reports[this.other]);
  }

  /** The shown record, or the whole set — the JSON is the deliverable. */
  private json(all: boolean): string {
    const reports = this.ctx().reports;
    return all ? JSON.stringify(reports, null, 1) : combatSimJson(reports[this.record]);
  }

  /** What a downloaded file of records is called. */
  private stem(all: boolean): string {
    const reports = this.ctx().reports;
    const r = reports[this.record];
    return all ? `${reports.length}-records` : `${r.mode}-${r.outcome}-seed${r.seed}`;
  }

  private copy(json: string, what: string): ScreenOutcome {
    // Say it NOW, and correct it if the write is refused.
    //
    // Not `.then(() => message('COPIED'))`, which is what this was, because the
    // promise is not guaranteed to settle at all: the clipboard wants a user
    // gesture in a secure context, and measured in an automated tab
    // `writeText` neither resolved nor rejected — so neither branch ran and the
    // pilot got no feedback whatsoever. X is the fallback and the records are on
    // `window.__simLog` either way, but silence is the one thing a key must not
    // do.
    this.ctx().message(`${what} TO CLIPBOARD`, 3);
    navigator.clipboard?.writeText(json)
      .catch(() => this.ctx().message('CLIPBOARD REFUSED — PRESS X FOR A FILE', 5));
    return 'stay';
  }

  /**
   * JSON as a file. `screens/saves.ts`'s `exportCommanderFile` is the idiom — a
   * Blob, an anchor, a click, and revoke it again.
   *
   * One record, every record or the PAIR: what is being written is the caller's
   * question, and this is the one place that knows how to write it.
   */
  private download(json: string, stem: string, what: string): ScreenOutcome {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `combat-sim-${stem}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.ctx().message(`${what} EXPORTED`, 3);
    return 'stay';
  }

  // --- small change ---------------------------------------------------------

  private repaint(): ScreenOutcome {
    this.render();
    return 'stay';
  }

  private refuse(text: string): ScreenOutcome {
    this.ctx().message(text, 3);
    sfx.refused();
    return 'stay';
  }
}
