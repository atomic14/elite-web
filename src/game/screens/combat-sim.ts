// The combat trainer's front of house: pick a fight, then read the report.
//
// The last piece of docs/COMBAT-SIM.md, and the smallest, because the three
// modules underneath it already answer everything — combat-sim-scenarios.ts says
// who can be sent at you, combat-sim.ts runs the exercise, combat-sim-report.ts
// counts what happened — and combat-sim-setup.ts beside it owns the draft. What
// is left here is the keyboard, the two panels, and the export.
//
// **The exercise is NOT this screen**, and that correction is in the spec.
// `Game.mode` is derived (`screens.topId ?? baseMode`) and `updateFlight()` runs
// only while it is `'flight'`, so the world does not step at all while an
// overlay is open. So one screen id holds two PANELS with the fight in between:
// pick a fight, launch, fly it as ordinary flight with a different `StepHost`,
// and the Game re-opens this screen on the report panel when it tears down.
//
// It obeys the Screen contract like every other overlay: it never sets the mode,
// never touches the Game, and returns an outcome. What it needs from the Game is
// four things behind `CombatSimContext` — the commander the fit-out starts from,
// the records of the last exercise, something to say out loud, and `begin`.

import type { CommanderData } from '../commander.ts';
import type { ExerciseFit } from '../combat-sim.ts';
import { combatSimJson, type CombatSimReport } from '../combat-sim-report.ts';
import type { ExerciseSpec } from '../combat-sim-scenarios.ts';
import {
  defaultGroup, fitFrom, freshDraft, freshSeed, setupCells, specFrom,
  type SimDraft,
} from './combat-sim-setup.ts';
import {
  brainNote, brainNoteReserve, careerNote, careerNoteReserve, draftNotes, draftNotesReserve,
} from './combat-sim-notes.ts';
import type { LiveBrainId } from '../brain-names.ts';
import { renderCombatSimSetup, renderCombatSimReport } from '../../ui/screens.ts';
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
  /**
   * Which policy the CAREER is flying, as a name the picker can show — or null
   * when `state.brains` holds a combination only the console can express.
   */
  readonly liveBrain: LiveBrainId | null;
  /**
   * Point the career's brains at a named policy.
   *
   * The one thing this screen changes that outlives the exercise, and it is a
   * playtest switch rather than a leak: `state.brains` is state, it is in the
   * save, and the pilot picked it on a row that says so. Before this it was
   * reachable only from a developer console.
   */
  selectLiveBrain(id: LiveBrainId): void;
}

const cycle = (n: number, len: number, d: number): number => (n + d + len) % len;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
/** `REPORT` / `4 RECORDS` — ⇧X on a one-record session said "1 RECORDS". */
const plural = (n: number): string => (n === 1 ? 'REPORT' : `${n} RECORDS`);

export class CombatSimScreen implements Screen {
  readonly id = 'combat-sim' as const;

  private readonly ctx: () => CombatSimContext;

  /** setup or report — two panels, one screen id, the fight in between */
  private panel: 'setup' | 'report' = 'setup';
  private row = 0;
  /** which of the exercise's records the report panel is showing */
  private record = 0;
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
    this.draft ??= freshDraft(this.ctx().commander, this.ctx().liveBrain);
    // The LIVE BRAINS row shows the career's actual selection, so it is re-read
    // on every open: the draft is kept for the session (so an A/B is two
    // launches of the same setup), and a console or an exercise teardown can
    // have moved `state.brains` underneath it since.
    this.draft.live = this.ctx().liveBrain;
    if (this.panel === 'report' && this.ctx().reports.length === 0) this.panel = 'setup';
    this.render();
  }

  render(): void {
    if (this.panel === 'report') {
      const reports = this.ctx().reports;
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
      careerNote: careerNote(draft),
      careerReserve: careerNoteReserve(),
      hasReport: this.ctx().reports.length > 0,
    });
  }

  /** A click on a row selects it — the same path the arrow keys take. */
  select(row: number): void {
    if (this.panel === 'report' || !this.draft) return;
    this.row = clamp(row, 0, setupCells(this.draft).length - 1);
    this.render();
  }

  input(i: Input): ScreenOutcome {
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
    if (i.pressed('KeyA')) { d.groups.push(defaultGroup(d.tier)); return this.repaint(); }
    if (i.pressed('KeyX')) { d.groups.pop(); return this.repaint(); }

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
      // The LIVE BRAINS row is the one cell whose change has to reach the
      // career. Pushing it after every change rather than teaching this method
      // which row it is keeps the screen's ONE input surface: a click is a
      // keystroke, and both end up here.
      if (d.live !== null) this.ctx().selectLiveBrain(d.live);
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
    const left = i.pressed('ArrowLeft');
    const right = i.pressed('ArrowRight');
    if (left || right) {
      this.record = cycle(this.record, n, right ? 1 : -1);
      return this.repaint();
    }
    const all = i.held('ShiftLeft', 'ShiftRight');
    if (i.pressed('KeyC')) return this.copy(all);
    if (i.pressed('KeyX')) return this.download(all);
    return 'stay';
  }

  /** The shown record, or the whole set — the JSON is the deliverable. */
  private json(all: boolean): string {
    const reports = this.ctx().reports;
    return all ? JSON.stringify(reports, null, 1) : combatSimJson(reports[this.record]);
  }

  private copy(all: boolean): ScreenOutcome {
    // Say it NOW, and correct it if the write is refused.
    //
    // Not `.then(() => message('COPIED'))`, which is what this was, because the
    // promise is not guaranteed to settle at all: the clipboard wants a user
    // gesture in a secure context, and measured in an automated tab
    // `writeText` neither resolved nor rejected — so neither branch ran and the
    // pilot got no feedback whatsoever. X is the fallback and the records are on
    // `window.__simLog` either way, but silence is the one thing a key must not
    // do.
    this.ctx().message(`${plural(all ? this.ctx().reports.length : 1)} TO CLIPBOARD`, 3);
    navigator.clipboard?.writeText(this.json(all))
      .catch(() => this.ctx().message('CLIPBOARD REFUSED — PRESS X FOR A FILE', 5));
    return 'stay';
  }

  /**
   * The record as a file. `screens/saves.ts`'s `exportCommanderFile` is the
   * idiom — a Blob, an anchor, a click, and revoke it again.
   */
  private download(all: boolean): ScreenOutcome {
    const reports = this.ctx().reports;
    const r = reports[this.record];
    const stem = all ? `${reports.length}-records` : `${r.mode}-${r.outcome}-seed${r.seed}`;
    const blob = new Blob([this.json(all)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `combat-sim-${stem}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.ctx().message(`${plural(all ? reports.length : 1)} EXPORTED`, 3);
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
