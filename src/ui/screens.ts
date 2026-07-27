import {
  type StarSystem, type MarketEntry, ECONOMY_NAMES, GOVERNMENT_NAMES, COMMODITIES, speciesName,
} from '../galaxy/galaxy';
import { planetDescription } from '../galaxy/goatsoup';
import {
  type CommanderData, type Contract, rating, cargoTonnes, formatCredits, cargoCapacity,
  MAX_FUEL, EQUIPMENT_CATALOGUE, equipmentOwned,
} from '../game/commander';

// Full-page overlay screens, rendered as DOM. The Game owns all input and
// state; these are pure render functions.

const el = (): HTMLElement => document.getElementById('screen')!;

export function hideScreen(): void {
  el().classList.add('hidden');
}

function show(html: string): void {
  const s = el();
  s.innerHTML = html;
  s.classList.remove('hidden');
}

export function renderDockedMenu(sys: StarSystem, c: CommanderData, missionText = ''): void {
  show(`
    <h2>${sys.name.toUpperCase()} STATION</h2>
    <div class="rule"></div>
    <div class="info" style="text-align:center">
      ${ECONOMY_NAMES[sys.economy]} &middot; ${GOVERNMENT_NAMES[sys.government]} &middot; TECH LEVEL ${sys.techLevel + 1}<br/>
      ${formatCredits(c.credits)} &middot; FUEL ${(c.fuel / 10).toFixed(1)} LY &middot; MISSILES ${c.missiles}
      ${missionText ? `<br/><span style="color:var(--hud-amber)">${missionText}</span>` : ''}
    </div>
    <div class="menu">
      <div data-key="KeyL"><b>L</b> LAUNCH</div>
      <div data-key="KeyM"><b>M</b> MARKET PRICES</div>
      <div data-key="KeyC"><b>C</b> CONTRACTS</div>
      <div data-key="KeyE"><b>E</b> EQUIP SHIP</div>
      <div data-key="KeyN"><b>N</b> LOCAL CHART</div>
      <div data-key="KeyG"><b>G</b> GALACTIC CHART</div>
      <div data-key="KeyD"><b>D</b> DATA ON SYSTEM</div>
      <div data-key="KeyI"><b>I</b> COMMANDER STATUS</div>
    </div>
    <div class="keyline">? CONTROLS GUIDE &middot; B KEYBOARD LAYOUT &middot; X EXPORT SAVE &middot; Z IMPORT SAVE &middot; Q NEW COMMANDER</div>
  `);
}

/**
 * Confirmation for starting over. Deliberately spells out what is about to be
 * destroyed and points at the export key first — this is the only action in
 * the game that throws away a career.
 */
export function renderNewGameConfirm(sys: StarSystem, c: CommanderData): void {
  show(`
    <h2>NEW COMMANDER</h2>
    <div class="rule"></div>
    <div class="info" style="text-align:center; line-height:2">
      This will erase your current commander:<br/>
      <span style="color:var(--hud-amber)">
        ${sys.name.toUpperCase()} &middot; ${formatCredits(c.credits)} &middot;
        ${c.kills} KILLS &middot; ${rating(c.combatScore ?? c.kills).toUpperCase()}
      </span><br/>
      and start again at Lave with 100.0 Cr.<br/>
      <span style="opacity:0.8; font-size:11px">
        Press ESC or Q to cancel, X to export a backup first.
      </span>
    </div>
    <div class="buttons">
      <button data-key="KeyY">Y — ERASE AND START AGAIN</button>
      <button data-key="Escape">ESC — CANCEL</button>
    </div>
  `);
}

export function renderMarket(
  sys: StarSystem,
  market: MarketEntry[],
  c: CommanderData,
  selected: number,
): void {
  const rows = market
    .map((m, i) => `
      <tr class="${i === selected ? 'sel' : ''} pick" data-row="${i}">
        <td>${m.name.toUpperCase()}</td>
        <td class="num">${m.price.toFixed(1)}</td>
        <td class="num">${m.quantity}${m.unit}</td>
        <td class="num">${c.cargo[i] > 0 ? c.cargo[i] + COMMODITIES[i].unit : '-'}</td>
      </tr>`)
    .join('');
  show(`
    <h2>${sys.name.toUpperCase()} MARKET</h2>
    <div class="rule"></div>
    <table>
      <tr><th>PRODUCT</th><th class="num">PRICE (Cr)</th><th class="num">FOR SALE</th><th class="num">IN HOLD</th></tr>
      ${rows}
    </table>
    <div class="buttons">
      <button data-key="KeyB">BUY 1</button>
      <button data-key="VirtBuyMax">BUY MAX</button>
      <button data-key="KeyV">SELL 1</button>
      <button data-key="VirtSellAll">SELL ALL</button>
      <button data-key="Escape">DONE</button>
    </div>
    <div class="keyline">
      CASH ${formatCredits(c.credits)} &middot; HOLD ${cargoTonnes(c)}/${cargoCapacity(c)}t
      &nbsp;&mdash;&nbsp; CLICK A ROW &middot; &uarr;&darr; SELECT &middot; B BUY (&#8679;B MAX) &middot; V SELL (&#8679;V ALL) &middot; ESC EXIT
    </div>
  `);
}

// --- Equip Ship ------------------------------------------------------------

export interface EquipRow {
  id: string;
  label: string;
  price: number; // tenths; 0 = nothing to buy
  status: '' | 'OWNED' | 'TL-LOCKED';
}

/** Purchasable rows for this station, shared by renderer and purchase logic. */
/**
 * @param cheat playtesting only — lifts the tech-level lock so anything in the
 *   catalogue can be fitted anywhere. See `window.__cheat` in game.ts.
 */
export function equipRows(sys: StarSystem, c: CommanderData, cheat = false): EquipRow[] {
  const fuelNeeded = MAX_FUEL - c.fuel;
  const rows: EquipRow[] = [{
    id: 'fuel',
    label: `Fuel (${(fuelNeeded / 10).toFixed(1)} LY needed)`,
    price: Math.round(fuelNeeded * 0.4),
    status: fuelNeeded <= 0 ? 'OWNED' : '',
  }];
  for (const item of EQUIPMENT_CATALOGUE) {
    const owned = equipmentOwned(item.id, c);
    const locked = !cheat && sys.techLevel + 1 < item.minTL;
    rows.push({
      id: item.id,
      label: item.name,
      price: item.price,
      status: owned ? 'OWNED' : locked ? 'TL-LOCKED' : '',
    });
  }
  return rows;
}

export function renderEquip(
  sys: StarSystem, c: CommanderData, selected: number, cheat = false,
): void {
  const rows = equipRows(sys, c, cheat)
    .map((r, i) => `
      <tr class="${i === selected ? 'sel' : ''} pick" data-row="${i}">
        <td>${r.label.toUpperCase()}</td>
        <td class="num">${r.price > 0 ? (r.price / 10).toFixed(1) : '-'}</td>
        <td class="num">${
          r.status === 'OWNED' ? 'OWNED'
          : r.status === 'TL-LOCKED' ? 'NOT AVAILABLE HERE'
          : cheat ? 'FREE'
          : ''
        }</td>
      </tr>`)
    .join('');
  show(`
    <h2>EQUIP SHIP &mdash; ${sys.name.toUpperCase()}</h2>
    <div class="rule"></div>
    ${cheat ? '<div class="info" style="text-align:center;color:var(--hud-amber)">CHEAT MODE &mdash; EVERYTHING FITTED FREE, ANY TECH LEVEL</div>' : ''}
    <table>
      <tr><th>ITEM</th><th class="num">PRICE (Cr)</th><th class="num"></th></tr>
      ${rows}
    </table>
    <div class="buttons">
      <button data-key="KeyB">BUY SELECTED</button>
      <button data-key="Escape">DONE</button>
    </div>
    <div class="keyline">
      CASH ${formatCredits(c.credits)} &middot; MISSILES ${c.missiles}
      &nbsp;&mdash;&nbsp; CLICK AN ITEM TO SELECT &middot; B / ENTER BUY &middot; ESC EXIT
    </div>
  `);
}

export function renderStatus(
  systems: StarSystem[],
  c: CommanderData,
  targetIndex: number | null,
  legalName: string,
): void {
  const sys = systems[c.systemIndex];
  const cargoLines = c.cargo
    .map((qty, i) => (qty > 0 ? `${COMMODITIES[i].name}: ${qty}${COMMODITIES[i].unit}` : null))
    .filter(Boolean)
    .join(' &middot; ') || 'Empty';
  const equipmentLines = EQUIPMENT_CATALOGUE
    .filter((item) => item.id !== 'missile' && equipmentOwned(item.id, c))
    .map((item) => item.name)
    .join(' &middot; ') || 'Standard fit';
  show(`
    <h2>COMMANDER ${c.name}</h2>
    <div class="rule"></div>
    <div class="info">
      Present system: ${sys.name}<br/>
      Hyperspace target: ${targetIndex === null ? 'None' : systems[targetIndex].name}<br/>
      Legal status: ${legalName}<br/>
      Fuel: ${(c.fuel / 10).toFixed(1)} / ${(MAX_FUEL / 10).toFixed(1)} light years<br/>
      Cash: ${formatCredits(c.credits)}<br/>
      Missiles: ${c.missiles}<br/>
      Equipment: ${equipmentLines}<br/>
      Cargo: ${cargoLines}<br/>
      ${c.trumbles > 0 ? `<span style="color:var(--hud-red)">Trumbles: ${c.trumbles}</span><br/>` : ''}
      Kills: ${c.kills}<br/>
      Rating: <span style="color:var(--hud-amber)">${rating(c.combatScore ?? c.kills).toUpperCase()}</span>
    </div>
    <div class="buttons"><button data-key="Escape">BACK</button></div>
  `);
}

/**
 * Chart distance in tenths of a light-year, after the original's asymmetric
 * metric: y counts half (the chart is drawn half-height), scaled so max fuel
 * 70 = the classic 7.0 LY range.
 */
export function distanceTenths(a: StarSystem, b: StarSystem): number {
  const dx = a.x - b.x;
  const dy = (a.y - b.y) / 2;
  return Math.round(4 * Math.sqrt(dx * dx + dy * dy));
}

export interface ChartState {
  cursorX: number;
  cursorY: number;
  targetIndex: number | null;
}

/**
 * Nearest system to a chart coordinate, within `radius` chart units
 * (measured with the half-weight-y metric the charts are drawn in).
 */
export function nearestSystem(
  systems: StarSystem[],
  x: number,
  y: number,
  radius = 12,
): StarSystem | null {
  let best: StarSystem | null = null;
  let bestD = radius * radius;
  for (const s of systems) {
    const dx = s.x - x;
    const dy = (s.y - y) / 2;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export function renderChart(
  systems: StarSystem[],
  c: CommanderData,
  chart: ChartState,
): void {
  show(`
    <h2>GALACTIC CHART ${c.galaxy}</h2>
    <div class="rule"></div>
    <canvas id="chart-canvas" width="780" height="400"></canvas>
    <div class="keyline" id="chart-info"></div>
    <div class="keyline">CLICK A SYSTEM TO TARGET IT &middot; ARROWS MOVE &middot; ENTER TARGET &middot; D DATA ON SYSTEM &middot; M MARKET &middot; F FIND &middot; ESC EXIT</div>
  `);
  drawChart(systems, c, chart);
}

/** Redraw only the canvas + info line (cheap, for cursor moves). */
export function drawChart(systems: StarSystem[], c: CommanderData, chart: ChartState): void {
  const canvas = document.getElementById('chart-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  const sx = w / 256;
  const sy = h / 128;
  const px = (s: { x: number; y: number }) => s.x * sx;
  const py = (s: { x: number; y: number }) => (s.y / 2) * sy;
  const current = systems[c.systemIndex];

  ctx.clearRect(0, 0, w, h);

  // fuel range ellipse
  ctx.strokeStyle = '#1d6b26';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.ellipse(px(current), py(current), (c.fuel / 4) * sx, (c.fuel / 4) * sy * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // systems
  for (const s of systems) {
    const within = distanceTenths(current, s) <= c.fuel;
    ctx.fillStyle = within ? '#4dff5c' : '#2a7a33';
    const r = s.index === c.systemIndex ? 3 : 1.5;
    ctx.fillRect(px(s) - r / 2, py(s) - r / 2, r, r);
  }

  // current system crosshair
  ctx.strokeStyle = '#4dff5c';
  ctx.beginPath();
  ctx.moveTo(px(current) - 8, py(current)); ctx.lineTo(px(current) + 8, py(current));
  ctx.moveTo(px(current), py(current) - 8); ctx.lineTo(px(current), py(current) + 8);
  ctx.stroke();

  // target marker
  if (chart.targetIndex !== null) {
    const t = systems[chart.targetIndex];
    ctx.strokeStyle = '#ffb444';
    ctx.beginPath();
    ctx.arc(px(t), py(t), 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // cursor
  ctx.strokeStyle = '#ff4d4d';
  const cx = chart.cursorX * sx;
  const cy = (chart.cursorY / 2) * sy;
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy);
  ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6);
  ctx.stroke();

  const info = document.getElementById('chart-info');
  if (info) {
    const near = nearestSystem(systems, chart.cursorX, chart.cursorY);
    if (near) {
      const d = distanceTenths(current, near);
      info.innerHTML =
        `${near.name.toUpperCase()} &middot; ${(d / 10).toFixed(1)} LY` +
        ` &middot; ${ECONOMY_NAMES[near.economy]} &middot; ${GOVERNMENT_NAMES[near.government]}` +
        ` &middot; TL ${near.techLevel + 1}` +
        (d > c.fuel ? ' &middot; <span style="color:var(--hud-red)">OUT OF RANGE</span>' : '');
    } else {
      info.textContent = ' ';
    }
  }
}

// --- Short range (local) chart ---------------------------------------------

export const LOCAL_SCALE = 19; // canvas px per chart x-unit

export function renderLocalChart(
  systems: StarSystem[],
  c: CommanderData,
  chart: ChartState,
): void {
  show(`
    <h2>SHORT RANGE CHART</h2>
    <div class="rule"></div>
    <canvas id="local-canvas" width="780" height="380"></canvas>
    <div class="info" id="local-info" style="text-align:center; min-height:76px"></div>
    <div class="keyline">CLICK A SYSTEM TO TARGET IT &middot; ARROWS MOVE &middot; ENTER TARGET &middot; D DATA ON SYSTEM &middot; M MARKET &middot; F FIND &middot; ESC EXIT</div>
  `);
  drawLocalChart(systems, c, chart);
}

export function drawLocalChart(
  systems: StarSystem[],
  c: CommanderData,
  chart: ChartState,
): void {
  const canvas = document.getElementById('local-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const current = systems[c.systemIndex];
  // x in chart units; y at half-weight so screen distance matches LY distance
  const px = (s: { x: number; y: number }) => cx + (s.x - current.x) * LOCAL_SCALE;
  const py = (s: { x: number; y: number }) => cy + ((s.y - current.y) / 2) * LOCAL_SCALE;

  ctx.clearRect(0, 0, w, h);

  // fuel range circle (isotropic in this projection)
  ctx.strokeStyle = '#1d6b26';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(cx, cy, (c.fuel / 4) * LOCAL_SCALE, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '10px Menlo, Consolas, monospace';
  for (const s of systems) {
    const x = px(s);
    const y = py(s);
    if (x < -20 || x > w + 20 || y < -12 || y > h + 12) continue;
    const within = distanceTenths(current, s) <= c.fuel;
    ctx.fillStyle = within ? '#4dff5c' : '#2a7a33';
    ctx.beginPath();
    ctx.arc(x, y, s.index === c.systemIndex ? 3.5 : 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = within ? '#8affa0' : '#3f9950';
    ctx.fillText(s.name.toUpperCase(), x + 7, y - 6);
  }

  // current system crosshair
  ctx.strokeStyle = '#4dff5c';
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
  ctx.stroke();

  // target marker
  if (chart.targetIndex !== null) {
    const t = systems[chart.targetIndex];
    ctx.strokeStyle = '#ffb444';
    ctx.beginPath();
    ctx.arc(px(t), py(t), 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  // cursor
  ctx.strokeStyle = '#ff4d4d';
  const ux = cx + (chart.cursorX - current.x) * LOCAL_SCALE;
  const uy = cy + ((chart.cursorY - current.y) / 2) * LOCAL_SCALE;
  ctx.beginPath();
  ctx.moveTo(ux - 7, uy); ctx.lineTo(ux + 7, uy);
  ctx.moveTo(ux, uy - 7); ctx.lineTo(ux, uy + 7);
  ctx.stroke();

  // data on system (the nearest to the cursor)
  const info = document.getElementById('local-info');
  if (info) {
    const near = nearestSystem(systems, chart.cursorX, chart.cursorY);
    if (near) {
      const d = distanceTenths(current, near);
      info.innerHTML =
        `<span style="color:var(--hud-amber); letter-spacing:3px">${near.name.toUpperCase()}</span>` +
        ` &middot; ${(d / 10).toFixed(1)} LY` +
        (d > c.fuel && near.index !== c.systemIndex
          ? ' &middot; <span style="color:var(--hud-red)">OUT OF RANGE</span>' : '') +
        `<br/>${ECONOMY_NAMES[near.economy]} &middot; ${GOVERNMENT_NAMES[near.government]}` +
        ` &middot; TECH LEVEL ${near.techLevel + 1}` +
        `<br/>Population: ${(near.population / 10).toFixed(1)} Billion (${speciesName(near)})` +
        `<br/>Gross productivity: ${near.productivity} M CR` +
        ` &middot; Average radius: ${near.radius} km`;
    } else {
      info.textContent = ' ';
    }
  }
}

/**
 * Market estimate for a system you haven't visited: expected prices/stock
 * (mean over the fluctuation byte). Opened from the charts with M.
 */
export function renderMarketEstimate(sys: StarSystem, c: CommanderData): void {
  const rows = COMMODITIES.map((cm, i) => {
    const price = ((cm.basePrice + cm.mask / 2 + sys.economy * cm.gradient) & 0xff) * 0.4;
    let qty = (cm.baseQuantity + cm.mask / 2 - sys.economy * cm.gradient) & 0xff;
    if (qty & 0x80) qty = 0;
    qty &= 0x3f;
    const inHold = c.cargo[i] > 0 ? `${c.cargo[i]}${cm.unit}` : '-';
    return `<tr><td>${cm.name.toUpperCase()}</td><td class="num">~${price.toFixed(1)}</td>` +
      `<td class="num">~${qty}${cm.unit}</td><td class="num">${inHold}</td></tr>`;
  }).join('');
  show(`
    <h2>${sys.name.toUpperCase()} — MARKET ESTIMATE</h2>
    <div class="rule"></div>
    <div class="info" style="text-align:center">
      ${ECONOMY_NAMES[sys.economy]} &middot; ${GOVERNMENT_NAMES[sys.government]} &middot;
      expected values; actual prices fluctuate per visit
    </div>
    <table>
      <tr><th>PRODUCT</th><th class="num">EST. PRICE (Cr)</th><th class="num">EST. STOCK</th><th class="num">IN HOLD</th></tr>
      ${rows}
    </table>
    <div class="buttons"><button data-key="Escape">BACK TO CHART</button></div>
  `);
}

/**
 * Inverse of the galactic chart projection: a click on the canvas → chart
 * coordinates. Accounts for CSS scaling of the canvas element.
 */
export function chartCoordsFromClick(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const px = (clientX - r.left) * (canvas.width / r.width);
  const py = (clientY - r.top) * (canvas.height / r.height);
  return { x: px / (canvas.width / 256), y: (py / (canvas.height / 128)) * 2 };
}

/** Inverse of the short-range chart projection (centred on the current system). */
export function localCoordsFromClick(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  current: StarSystem,
): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const px = (clientX - r.left) * (canvas.width / r.width);
  const py = (clientY - r.top) * (canvas.height / r.height);
  return {
    x: current.x + (px - canvas.width / 2) / LOCAL_SCALE,
    y: current.y + ((py - canvas.height / 2) / LOCAL_SCALE) * 2,
  };
}

/**
 * The original's "DATA ON <SYSTEM>" page: the full statistics block plus
 * the procedurally generated planet description.
 */
export function renderSystemData(sys: StarSystem, current: StarSystem, news = ''): void {
  const d = distanceTenths(current, sys);
  show(`
    <h2>DATA ON ${sys.name.toUpperCase()}</h2>
    <div class="rule"></div>
    <table class="sysdata">
      <tr><td>Distance:</td><td>${(d / 10).toFixed(1)} Light Years</td></tr>
      <tr><td>Economy:</td><td>${ECONOMY_NAMES[sys.economy]}</td></tr>
      <tr><td>Government:</td><td>${GOVERNMENT_NAMES[sys.government]}</td></tr>
      <tr><td>Tech Level:</td><td>${sys.techLevel + 1}</td></tr>
      <tr><td>Population:</td><td>${(sys.population / 10).toFixed(1)} Billion<br/>
        <span style="opacity:0.85">(${speciesName(sys)})</span></td></tr>
      <tr><td>Gross Productivity:</td><td>${sys.productivity} M CR</td></tr>
      <tr><td>Average Radius:</td><td>${sys.radius} km</td></tr>
    </table>
    <div class="rule"></div>
    <div class="info sysdesc">${planetDescription(sys)}</div>
    ${news ? `<div class="info sysdesc" style="color:var(--hud-amber);margin-top:8px">${news}</div>` : ''}
    <div class="buttons"><button data-key="Escape">BACK</button></div>
  `);
}

export function describeContract(k: Contract, systems: StarSystem[]): string {
  const dest = systems[k.destination].name.toUpperCase();
  if (k.kind === 'cargo') return `Deliver ${k.qty}t ${COMMODITIES[k.commodity].name} to ${dest}`;
  if (k.kind === 'courier') return `Carry sealed data to ${dest}`;
  return `Destroy ${k.qty} pirates around ${dest}`;
}

/** The station bulletin board: jobs on offer, and the ones you've taken. */
export function renderContracts(
  sys: StarSystem,
  systems: StarSystem[],
  c: CommanderData,
  offers: Contract[],
  selected: number,
): void {
  const rows = offers.map((k, i) => `
    <tr class="${i === selected ? 'sel' : ''} pick" data-row="${i}">
      <td>${describeContract(k, systems)}</td>
      <td class="num">${(distanceTenths(sys, systems[k.destination]) / 10).toFixed(1)} LY</td>
      <td class="num">${k.deadlineDay - c.day} days</td>
      <td class="num">${formatCredits(k.reward)}</td>
    </tr>`).join('') || '<tr><td colspan="4">No work on offer today.</td></tr>';

  const taken = c.contracts.map((k) => `
    <tr><td>${describeContract(k, systems)}${k.kind === 'bounty' ? ` (${k.progress}/${k.qty})` : ''}</td>
      <td class="num">${k.deadlineDay - c.day} days left</td>
      <td class="num">${formatCredits(k.reward)}</td></tr>`).join('');

  show(`
    <h2>${sys.name.toUpperCase()} BULLETIN BOARD</h2>
    <div class="rule"></div>
    <table>
      <tr><th>WORK ON OFFER</th><th class="num">DISTANCE</th><th class="num">TIME</th><th class="num">PAYS</th></tr>
      ${rows}
    </table>
    ${taken ? `<div class="rule"></div><table>
      <tr><th>ACCEPTED</th><th class="num">DEADLINE</th><th class="num">PAYS</th></tr>${taken}</table>` : ''}
    <div class="buttons">
      <button data-key="KeyA">ACCEPT SELECTED</button>
      <button data-key="Escape">DONE</button>
    </div>
    <div class="keyline">
      DAY ${c.day} &middot; CASH ${formatCredits(c.credits)} &middot;
      HOLD ${cargoTonnes(c)}/${cargoCapacity(c)}t &nbsp;&mdash;&nbsp; CLICK A JOB &middot; A ACCEPT &middot; ESC EXIT
    </div>
  `);
}

export function renderGameOver(c: CommanderData): void {
  show(`
    <h2>GAME OVER</h2>
    <div class="big">SHIP DESTROYED</div>
    <div class="info" style="text-align:center">
      Final rating: ${rating(c.combatScore ?? c.kills).toUpperCase()} &middot; ${c.kills} kills
    </div>
    <div class="buttons"><button data-key="Enter">RELOAD LAST STATION SAVE</button></div>
  `);
}
