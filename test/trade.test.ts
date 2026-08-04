// The outfitter: what a purchase costs you, and what it refuses.
//
// `buyEquipment` is the most complex function in src/ by cyclomatic complexity
// (CCN 27, `uvx lizard src --languages typescript -w`) and until this file it
// had never been executed by a test — the worst pair of numbers in the project,
// on the one code path that moves a player's money. It could always have been
// tested; nothing in it needs a browser. Nobody had.
//
// It writes the save on success, which is the whole reason this is careful:
// every case here runs inside `withoutSaving`, which refuses the write and
// hands back the keys it refused, so the tests assert the save WOULD have
// happened without ever touching a real commander. `test/harness.ts` has
// already put this whole process in the harness namespace, so there is no
// player key to reach in the first place (docs/INVARIANTS.md invariant 3).

import { buyEquipment, type TradeContext } from '../src/game/screens/trade.ts';
import { equipRows, type EquipRow } from '../src/ui/screens.ts';
import {
  newCommander, MAX_FUEL, MAX_MISSILES, type CommanderData,
} from '../src/game/commander.ts';
import { generateMarket } from '../src/galaxy/galaxy.ts';
import { EQUIPMENT_CATALOGUE } from '../src/game/shop.ts';
import { withoutSaving, writeDockSave } from '../src/game/storage.ts';
import type { WorldSnapshot } from '../src/game/snapshot.ts';
import { check, eq } from './harness.ts';
import { g1 } from './fixtures.ts';

console.log('\noutfitting');
{
  const LAVE = g1[7];
  /** A rich system, so the tech level does not gate what we are testing. */
  const RICH = g1.find((s) => s.techLevel >= 10) ?? LAVE;

  /**
   * The write the outfitter triggers, as the Game wires it: a docked
   * checkpoint. It goes through the real storage write so `withoutSaving` has
   * something to refuse — a stub that wrote nothing would make every "the save
   * was suppressed" assertion below true for the wrong reason.
   */
  const saveCheckpoint = (c: CommanderData): void => {
    writeDockSave('TEST CAREER', { commander: c } as unknown as WorldSnapshot);
  };

  const ctxFor = (system = RICH, cheat = false) => {
    const commander = newCommander();
    const said: string[] = [];
    const ctx: TradeContext = {
      commander,
      system,
      market: generateMarket(system, 0),
      atHermit: false,
      cheat,
      leaveHermit: () => {},
      message: (t) => { said.push(t); },
      addNotoriety: () => {},
      checkpoint: () => { saveCheckpoint(ctx.commander); },
    };
    return { ctx, commander, said };
  };

  /** Buy with the save suspended; returns the keys the write would have hit. */
  const buy = (id: string, ctx: TradeContext): string[] =>
    withoutSaving(() => buyEquipment(id, ctx)).refused;

  // --- the happy path, and that it really does persist ----------------------
  {
    const { ctx, commander } = ctxFor();
    commander.credits = 100_000;
    const row = equipRows(ctx.system, commander, false).find((r: EquipRow) => r.id === 'ecm');
    check('the E.C.M. is on sale in a high-tech system', !!row && row.status === '');
    const refused = buy('ecm', ctx);
    check('buying the E.C.M. fits it', commander.equipment.ecm === true);
    eq('...and charges exactly its price', commander.credits, 100_000 - row!.price);
    check('...and the purchase would have been saved', refused.length > 0,
      'buyEquipment must write the commander — it is one of only two save points');
  }

  // --- refusals, and that a refusal costs nothing ---------------------------
  {
    const { ctx, commander } = ctxFor();
    commander.credits = 100_000;
    const before = commander.credits;
    const refused = buy('no-such-item', ctx);
    eq('an unknown id charges nothing', commander.credits, before);
    check('...and does not write the save', refused.length === 0);
    check('...and does not throw — it used to be a non-null assertion', true);
  }
  {
    const { ctx, commander, said } = ctxFor();
    commander.credits = 10;   // ten tenths of a credit: one credit
    const refused = buy('ecm', ctx);
    eq('too little money leaves the credits alone', commander.credits, 10);
    check('...leaves the equipment unfitted', commander.equipment.ecm !== true);
    check('...says so', said.includes('INSUFFICIENT CREDITS'));
    check('...and writes nothing', refused.length === 0);
  }
  {
    const { ctx, commander } = ctxFor();
    commander.credits = 100_000;
    buy('ecm', ctx);
    const after = commander.credits;
    buy('ecm', ctx);
    eq('buying what you already own is refused, not charged twice',
      commander.credits, after);
  }

  // --- the laser refunds, which are the fiddly half -------------------------
  //
  // A trade-in is worth WHAT THE OLD GUN COST, so the refund for a beam is the
  // beam's own catalogue price and nothing else. This used to be written down
  // here as `10000`, a copy of that price with nothing holding the two
  // together: raise the beam to 12,000 and the game would refund 10,000 for a
  // gun the player had just paid 12,000 for, with this test still green. The
  // pulse's 4,000 has no catalogue row of its own — it is the starting gun, so
  // nobody buys one — and `trade.ts` is its only home; it is named here rather
  // than typed twice.
  {
    const { ctx, commander } = ctxFor();
    commander.credits = 100_000;
    const priceOf = (id: string): number =>
      EQUIPMENT_CATALOGUE.find((e) => e.id === id)?.price ?? 0;
    const PULSE_TRADE_IN = 4000;
    const beamRow = equipRows(ctx.system, commander, false).find((r: EquipRow) => r.id === 'beam');
    if (beamRow && beamRow.status === '') {
      buy('beam', ctx);
      eq('a beam laser refunds the pulse laser it replaces',
        commander.credits, 100_000 - beamRow.price + PULSE_TRADE_IN);
      eq('...and is fitted', commander.equipment.laser, 'beam');

      const milRow = equipRows(ctx.system, commander, false).find((r: EquipRow) => r.id === 'military');
      if (milRow && milRow.status === '') {
        const before = commander.credits;
        buy('military', ctx);
        eq('a military laser refunds what the BEAM cost, not what a pulse cost',
          commander.credits, before - milRow.price + priceOf('beam'));
      }
      // ...and the two refunds are actually different, so the line above is
      // distinguishing them rather than passing on a coincidence.
      check('the beam is worth more as a trade-in than the pulse it replaced',
        priceOf('beam') > PULSE_TRADE_IN && priceOf('beam') > 0);
    }
  }

  // --- the two that are not equipment --------------------------------------
  {
    const { ctx, commander } = ctxFor();
    commander.credits = 100_000;
    commander.fuel = 0;
    buy('fuel', ctx);
    eq('fuel fills the tank to the maximum', commander.fuel, MAX_FUEL);
  }
  {
    const { ctx, commander } = ctxFor();
    commander.credits = 1_000_000;
    for (let i = 0; i < MAX_MISSILES + 3; i++) buy('missile', ctx);
    eq('the missile rack cannot be overfilled', commander.missiles, MAX_MISSILES);
  }

  // --- the cheat is free, and free means UNCHANGED --------------------------
  //
  // Letting credits go negative would break the save, the status screen and the
  // campaign's "credits never go negative" assertion — so this is not cosmetic.
  {
    const { ctx, commander } = ctxFor(LAVE, true);
    commander.credits = 0;
    buy('galacticDrive', ctx);
    check('the cheat fits a galactic drive with no money', commander.equipment.galacticDrive === true);
    eq('...and does not take the credits below zero', commander.credits, 0);
  }

  // --- every catalogue row is buyable, so none of them is dead data ---------
  {
    const { ctx, commander } = ctxFor(LAVE, true);
    commander.credits = 10_000_000;
    // Only rows that are actually FOR SALE. A fresh commander has a full tank,
    // so `fuel` reads OWNED and is refused — correctly, and it is the reason
    // this check filters rather than asserting over the whole catalogue.
    const ids = equipRows(ctx.system, commander, true)
      .filter((r: EquipRow) => r.status === '').map((r: EquipRow) => r.id);
    check(`the catalogue offers rows to buy (${ids.length})`, ids.length > 5);
    let handled = 0;
    for (const id of ids) {
      const fresh = ctxFor(LAVE, true);
      fresh.commander.credits = 10_000_000;
      const before = JSON.stringify(fresh.commander);
      withoutSaving(() => buyEquipment(id, fresh.ctx));
      if (JSON.stringify(fresh.commander) !== before) handled += 1;
    }
    check(`every catalogue id changes the commander when bought (${handled}/${ids.length})`,
      handled === ids.length,
      'an id with no case in the switch takes the money and does nothing');
  }
}
