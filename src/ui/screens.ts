import {
  type StarSystem, type MarketEntry, ECONOMY_NAMES, GOVERNMENT_NAMES, COMMODITIES, speciesName,
} from '../galaxy/galaxy';
import {
  type CommanderData, rating, cargoTonnes, formatCredits, cargoCapacity, MAX_FUEL,
  EQUIPMENT_CATALOGUE, equipmentOwned,
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
      <div><b>L</b> LAUNCH</div>
      <div><b>M</b> MARKET PRICES</div>
      <div><b>E</b> EQUIP SHIP</div>
      <div><b>N</b> LOCAL CHART</div>
      <div><b>G</b> GALACTIC CHART</div>
      <div><b>I</b> COMMANDER STATUS</div>
    </div>
    <div class="keyline">PRESS ? FOR THE FULL CONTROLS GUIDE</div>
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
      <tr class="${i === selected ? 'sel' : ''}">
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
    <div class="keyline">
      CASH ${formatCredits(c.credits)} &middot; HOLD ${cargoTonnes(c)}/${cargoCapacity(c)}t
      &nbsp;&mdash;&nbsp; &uarr;&darr; SELECT &middot; B BUY &middot; V SELL &middot; ESC EXIT
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
export function equipRows(sys: StarSystem, c: CommanderData): EquipRow[] {
  const fuelNeeded = MAX_FUEL - c.fuel;
  const rows: EquipRow[] = [{
    id: 'fuel',
    label: `Fuel (${(fuelNeeded / 10).toFixed(1)} LY needed)`,
    price: Math.round(fuelNeeded * 0.4),
    status: fuelNeeded <= 0 ? 'OWNED' : '',
  }];
  for (const item of EQUIPMENT_CATALOGUE) {
    const owned = equipmentOwned(item.id, c);
    const locked = sys.techLevel + 1 < item.minTL;
    rows.push({
      id: item.id,
      label: item.name,
      price: item.price,
      status: owned ? 'OWNED' : locked ? 'TL-LOCKED' : '',
    });
  }
  return rows;
}

export function renderEquip(sys: StarSystem, c: CommanderData, selected: number): void {
  const rows = equipRows(sys, c)
    .map((r, i) => `
      <tr class="${i === selected ? 'sel' : ''}">
        <td>${r.label.toUpperCase()}</td>
        <td class="num">${r.price > 0 ? (r.price / 10).toFixed(1) : '-'}</td>
        <td class="num">${
          r.status === 'OWNED' ? 'OWNED'
          : r.status === 'TL-LOCKED' ? 'NOT AVAILABLE HERE'
          : ''
        }</td>
      </tr>`)
    .join('');
  show(`
    <h2>EQUIP SHIP &mdash; ${sys.name.toUpperCase()}</h2>
    <div class="rule"></div>
    <table>
      <tr><th>ITEM</th><th class="num">PRICE (Cr)</th><th class="num"></th></tr>
      ${rows}
    </table>
    <div class="keyline">
      CASH ${formatCredits(c.credits)} &middot; MISSILES ${c.missiles}
      &nbsp;&mdash;&nbsp; &uarr;&darr; SELECT &middot; B / ENTER BUY &middot; ESC EXIT
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
      Kills: ${c.kills}<br/>
      Rating: <span style="color:var(--hud-amber)">${rating(c.kills).toUpperCase()}</span>
    </div>
    <div class="keyline">ESC EXIT</div>
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

export function nearestSystem(systems: StarSystem[], x: number, y: number): StarSystem | null {
  let best: StarSystem | null = null;
  let bestD = 12 * 12;
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
    <div class="keyline">ARROWS MOVE &middot; ENTER SET TARGET &middot; ESC EXIT</div>
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

const LOCAL_SCALE = 19; // canvas px per chart x-unit

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
    <div class="keyline">ARROWS MOVE &middot; ENTER SET TARGET &middot; ESC EXIT</div>
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

export function renderGameOver(c: CommanderData): void {
  show(`
    <h2>GAME OVER</h2>
    <div class="big">SHIP DESTROYED</div>
    <div class="info" style="text-align:center">
      Final rating: ${rating(c.kills).toUpperCase()} &middot; ${c.kills} kills
    </div>
    <div class="keyline">PRESS ENTER TO RELOAD LAST STATION SAVE</div>
  `);
}
