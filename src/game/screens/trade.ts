// The market and the outfitters: buying, selling, and fitting equipment.
//
// Second block out of game.ts, and it pairs with contracts.ts — between them
// they hold every rule about where a commander's money goes. Nothing here
// knows the ship is flying: no NPCs, no physics, no scene.
//
// `jettisonCargo` deliberately did NOT come with it. It touches cargo, but its
// job is talking pirates out of a fight — it spawns canisters into the world
// and marks attackers satisfied, so it belongs with flight.
//
// Same discipline as saves-screen.ts and NpcShip: this module decides nothing
// about game state. It returns an OUTCOME and the Game applies it.

import {
  formatCredits, cargoCapacity, cargoTonnes,
  MAX_FUEL, MAX_MISSILES,
  type CommanderData,
} from '../commander.ts';
import { fuelQuote } from '../shop.ts';
import { saveCommander } from '../storage.ts';
import { renderMarket, renderEquip, equipRows } from '../../ui/screens.ts';
import { COMMODITIES, type MarketEntry, type StarSystem } from '../../galaxy/galaxy.ts';
import type { Input } from '../../engine/input.ts';
import type { Screen, ScreenOutcome } from '../../ui/screen-host.ts';
import { sfx } from '../../audio.ts';
import { isContraband } from '../law.ts';

/** The slice of the Game these screens are allowed to see. */
export interface TradeContext {
  readonly commander: CommanderData;
  /** the system whose prices these are */
  readonly system: StarSystem;
  readonly market: MarketEntry[];
  /** trading at a rock hermit — changes the screen's title, nothing else */
  readonly atHermit: boolean;
  /** told when the market closes while at a hermit, so flight can tidy up */
  leaveHermit(): void;
  /** GameState.cheat — fits anything from the catalogue, free, at any tech level */
  readonly cheat: boolean;
  message(text: string, seconds: number): void;
  /** word gets around: see sell() */
  addNotoriety(amount: number): void;
}

/** The commodity market. */
export class MarketScreen implements Screen {
  readonly id = 'market' as const;
  /** @internal — test/playtest.js sets this directly before calling buy() */
  selected = 0;

  private readonly ctx: () => TradeContext;

  constructor(ctx: () => TradeContext) {
    this.ctx = ctx;
  }

  open(): void {
    this.selected = 0;
    this.render();
  }

  render(): void {
    const ctx = this.ctx();
    // The fuel price belongs on the price list: it is the one thing a trader
    // costs a run against that the market screen could not tell them, and the
    // answer lived a screen away in the outfitters. A hermit gets no quote —
    // the tank is filled by buyEquipment(), which is only reachable from the
    // station menu, so quoting a price there would be an offer we cannot honour.
    renderMarket(
      ctx.atHermit ? { ...ctx.system, name: 'Rock Hermit' } : ctx.system,
      ctx.market, ctx.commander, this.selected,
      ctx.atHermit ? null : fuelQuote(ctx.commander));
  }

  select(row: number): void {
    this.selected = row;
    this.render();
  }

  input(i: Input): ScreenOutcome {
    const ctx = this.ctx();
    const shift = i.held('ShiftLeft', 'ShiftRight');
    let changed = false;
    if (i.pressed('ArrowUp') || i.pressed('KeyW')) {
      this.selected = (this.selected + ctx.market.length - 1) % ctx.market.length;
      changed = true;
    }
    if (i.pressed('ArrowDown') || i.pressed('KeyS')) {
      this.selected = (this.selected + 1) % ctx.market.length;
      changed = true;
    }
    if (i.pressed('KeyB')) { this.buy(shift ? Infinity : 1); changed = true; }
    if (i.pressed('VirtBuyMax')) { this.buy(Infinity); changed = true; }
    if (i.pressed('KeyV')) { this.sell(shift ? Infinity : 1); changed = true; }
    if (i.pressed('VirtSellAll')) { this.sell(Infinity); changed = true; }
    if (i.pressed('Escape')) {
      if (ctx.atHermit) ctx.leaveHermit();
      return 'back';
    }
    if (changed) this.render();
    return 'stay';
  }

  /** Buy up to `want` units of the selected commodity (Infinity = fill up). */
  buy(want: number): void {
    const ctx = this.ctx();
    const idx = this.selected;
    const m = ctx.market[idx];
    const cost = Math.round(m.price * 10);
    let bought = 0;
    while (bought < want) {
      if (m.quantity <= 0 || ctx.commander.credits < cost) break;
      if (m.unit === 't' && cargoTonnes(ctx.commander) >= cargoCapacity(ctx.commander)) break;
      m.quantity -= 1;
      ctx.commander.cargo[idx] += 1;
      ctx.commander.credits -= cost;
      bought += 1;
    }
    if (bought > 0) {
      sfx.tradeBought();
      ctx.message(`BOUGHT ${bought}${m.unit} ${m.name.toUpperCase()}`, 2);
    } else {
      sfx.refused();
    }
  }

  /** Sell up to `want` units of the selected commodity (Infinity = all). */
  sell(want: number): void {
    const ctx = this.ctx();
    const idx = this.selected;
    const m = ctx.market[idx];
    let sold = 0;
    let revenue = 0;
    while (sold < want && ctx.commander.cargo[idx] > 0) {
      ctx.commander.cargo[idx] -= 1;
      m.quantity += 1;
      revenue += Math.round(m.price * 10);
      sold += 1;
    }
    if (sold > 0) {
      ctx.commander.credits += revenue;
      sfx.tradeSold();
      ctx.message(`SOLD ${sold}${m.unit} FOR ${formatCredits(revenue)}`, 2);
      // Word gets around. A big payday — or any quantity of contraband — makes
      // you worth watching for, here and in the systems within a jump. This is
      // why smuggling raises the temperature of your *next* arrival.
      const contraband = isContraband(idx);
      const notice = revenue / 40_000 + (contraband ? sold * 0.04 : 0);
      ctx.addNotoriety(Math.min(0.5, notice));
    } else {
      sfx.refused();
    }
  }
}

/** The outfitters. */
export class EquipScreen implements Screen {
  readonly id = 'equip' as const;
  private selected = 0;

  private readonly ctx: () => TradeContext;

  constructor(ctx: () => TradeContext) {
    this.ctx = ctx;
  }

  open(): void {
    this.selected = 0;
    this.render();
  }

  render(): void {
    const ctx = this.ctx();
    renderEquip(ctx.system, ctx.commander, this.selected, ctx.cheat);
  }

  select(row: number): void {
    this.selected = row;
    this.render();
  }

  input(i: Input): ScreenOutcome {
    const ctx = this.ctx();
    const rows = equipRows(ctx.system, ctx.commander, ctx.cheat);
    let changed = false;
    if (i.pressed('ArrowUp') || i.pressed('KeyW')) {
      this.selected = (this.selected + rows.length - 1) % rows.length;
      changed = true;
    }
    if (i.pressed('ArrowDown') || i.pressed('KeyS')) {
      this.selected = (this.selected + 1) % rows.length;
      changed = true;
    }
    if (i.pressed('KeyB') || i.pressed('Enter')) {
      this.buy(rows[this.selected].id);
      changed = true;
    }
    if (i.pressed('Escape')) return 'back';
    if (changed) this.render();
    return 'stay';
  }

  buy(id: string): void {
    buyEquipment(id, this.ctx());
  }
}

/**
 * Fit a piece of equipment. A free function because the docked menu and the
 * test harness both buy things without the outfitters being open.
 */
export function buyEquipment(id: string, ctx: TradeContext): void {
  const c = ctx.commander;
  const cheat = ctx.cheat;
  // `.find(...)!` used to be a non-null assertion, so an unknown id threw a
  // TypeError instead of failing politely — reachable from the test harness
  // and from any stale data-key in the DOM.
  const row = equipRows(ctx.system, c, cheat).find((r) => r.id === id);
  if (!row) {
    sfx.refused();
    return;
  }
  if (row.status !== '' || (row.price <= 0 && id !== 'fuel')) {
    sfx.refused();
    return;
  }
  if (!cheat && c.credits < row.price) {
    ctx.message('INSUFFICIENT CREDITS', 2);
    sfx.refused();
    return;
  }
  // Cheat purchases are free rather than deducted-from-nothing: letting
  // credits go negative would break the save, the status screen and the
  // campaign simulator's "credits never go negative" assertion.
  if (!cheat) c.credits -= row.price;
  switch (id) {
    case 'fuel': c.fuel = MAX_FUEL; break;
    case 'missile': c.missiles = Math.min(MAX_MISSILES, c.missiles + 1); break;
    case 'largeBay': c.equipment.largeBay = true; break;
    case 'ecm': c.equipment.ecm = true; break;
    case 'rearLaser': c.equipment.rearLaser = true; break;
    case 'leftLaser': c.equipment.leftLaser = true; break;
    case 'rightLaser': c.equipment.rightLaser = true; break;
    case 'beam':
      c.credits += 4000; // pulse laser refunded, as per the manual
      c.equipment.laser = 'beam';
      break;
    case 'military':
      c.credits += c.equipment.laser === 'beam' ? 10000 : 4000; // old laser refunded
      c.equipment.laser = 'military';
      break;
    case 'scoops': c.equipment.scoops = true; break;
    case 'escapePod': c.equipment.escapePod = true; break;
    case 'energyBomb': c.equipment.energyBomb = true; break;
    case 'energyUnit': c.equipment.energyUnit = true; break;
    case 'dockingComputer': c.equipment.dockingComputer = true; break;
    case 'miningLaser': c.equipment.miningLaser = true; break;
    case 'combatComputer': c.equipment.combatComputer = true; break;
    case 'trumble':
      c.trumbles = 1;
      ctx.message('IT PURRS. WHAT COULD POSSIBLY GO WRONG?', 5);
      break;
    case 'galacticDrive': c.equipment.galacticDrive = true; break;
  }
  // one of only two places a save happens (the other is docking)
  saveCommander(c);
  sfx.equipmentBought();
}

/** Re-exported so game.ts's jettison path keeps its commodity table. */
export { COMMODITIES };
