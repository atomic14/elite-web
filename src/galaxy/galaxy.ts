// The classic Elite procedural galaxy, after Bell & Braben's original
// algorithm: three 16-bit seed words advanced by a Fibonacci-style "twist".
// Galaxy 1 must produce the canonical universe (system 7 = LAVE).

export type Seed = [number, number, number];

export interface StarSystem {
  index: number;
  name: string;
  /** Galactic chart coords: x 0-255, y 0-255 (chart is drawn half-height). */
  x: number;
  y: number;
  economy: number;
  government: number;
  techLevel: number;
  /** In billions, tenths. */
  population: number;
  /** Gross productivity, M CR. */
  productivity: number;
  /** Average planet radius in km. */
  radius: number;
  /** Seed snapshot at generation time; drives visuals + market. */
  seed: Seed;
}

export const ECONOMY_NAMES = [
  'Rich Industrial', 'Average Industrial', 'Poor Industrial', 'Mainly Industrial',
  'Mainly Agricultural', 'Rich Agricultural', 'Average Agricultural', 'Poor Agricultural',
];

export const GOVERNMENT_NAMES = [
  'Anarchy', 'Feudal', 'Multi-Government', 'Dictatorship',
  'Communist', 'Confederacy', 'Democracy', 'Corporate State',
];

// 32 digraphs; '.' means "no letter".
const DIGRAPHS = '..LEXEGEZACEBISOUSESARMAINDIREA.ERATENBERALAVETIEDORQUANTEISRION';

const GALAXY_1_SEED: Seed = [0x5a4a, 0x0248, 0xb753];

function twist(s: Seed): void {
  const t = (s[0] + s[1] + s[2]) & 0xffff;
  s[0] = s[1];
  s[1] = s[2];
  s[2] = t;
}

/** Seed for galaxy n (1-8): each galaxy is the previous with every byte rolled left. */
export function galaxySeed(galaxy: number): Seed {
  const roll = (w: number) => {
    const rollByte = (b: number) => ((b << 1) & 0xfe) | (b >> 7);
    return (rollByte(w >> 8) << 8) | rollByte(w & 0xff);
  };
  const s: Seed = [...GALAXY_1_SEED];
  for (let g = 1; g < galaxy; g++) {
    s[0] = roll(s[0]);
    s[1] = roll(s[1]);
    s[2] = roll(s[2]);
  }
  return s;
}

function makeSystem(index: number, s: Seed): StarSystem {
  const seed: Seed = [...s];

  const x = s[1] >> 8;
  const y = s[0] >> 8;
  const government = (s[1] >> 3) & 7;
  let economy = (s[0] >> 8) & 7;
  if (government <= 1) economy |= 2; // anarchy & feudal can't be rich
  let techLevel = ((s[1] >> 8) & 3) + (economy ^ 7) + (government >> 1);
  if (government & 1) techLevel += 1;
  const population = 4 * techLevel + economy + government + 1;
  const productivity = ((economy ^ 7) + 3) * (government + 4) * population * 8;
  const radius = 256 * (((s[2] >> 8) & 15) + 11) + x;

  const longName = (s[0] & 0x40) !== 0;
  let name = '';
  const pairCount = longName ? 4 : 3;
  for (let i = 0; i < 4; i++) {
    const d = 2 * ((s[2] >> 8) & 31);
    if (i < pairCount) {
      name += DIGRAPHS[d] === '.' ? '' : DIGRAPHS[d];
      name += DIGRAPHS[d + 1] === '.' ? '' : DIGRAPHS[d + 1];
    }
    twist(s);
  }

  return {
    index, x, y, economy, government, techLevel, population, productivity, radius, seed,
    // the canonical 8 galaxies never produce an empty name, but be safe
    name: name ? name[0] + name.slice(1).toLowerCase() : 'Unknown',
  };
}

export function generateGalaxy(galaxy: number): StarSystem[] {
  const s = galaxySeed(galaxy);
  const systems: StarSystem[] = [];
  for (let i = 0; i < 256; i++) systems.push(makeSystem(i, s));
  return systems;
}

const SPECIES_SIZE = ['Large ', 'Fierce ', 'Small ', '', '', '', '', ''];
const SPECIES_COLOR = ['Green ', 'Red ', 'Yellow ', 'Blue ', 'Black ', 'Harmless ', '', ''];
const SPECIES_TEXTURE = ['Slimy ', 'Bug-Eyed ', 'Horned ', 'Bony ', 'Fat ', 'Furry ', '', ''];
const SPECIES_TYPE = [
  'Rodents', 'Frogs', 'Lizards', 'Lobsters', 'Birds', 'Humanoids', 'Felines', 'Insects',
];

/** Inhabitant species, after the original's seed-bit tables. */
export function speciesName(sys: StarSystem): string {
  const [s0, s1, s2] = sys.seed;
  const s2hi = (s2 >> 8) & 0xff;
  if ((s2hi & 0x80) === 0) return 'Human Colonials';
  const texture = ((s0 >> 8) ^ (s1 >> 8)) & 7;
  const type = (texture + (s2hi & 3)) & 7;
  return (
    SPECIES_SIZE[(s2hi >> 2) & 7] +
    SPECIES_COLOR[(s2hi >> 5) & 7] +
    SPECIES_TEXTURE[texture] +
    SPECIES_TYPE[type]
  );
}

export function describeSystem(sys: StarSystem): string {
  return `${sys.name.toUpperCase()}  TL:${sys.techLevel + 1}  ` +
    `${ECONOMY_NAMES[sys.economy]}  ${GOVERNMENT_NAMES[sys.government]}`;
}

// ---------------------------------------------------------------------------
// Market — commodity table after the original (prices in tenths of a credit).

interface Commodity {
  name: string;
  basePrice: number;
  gradient: number;
  baseQuantity: number;
  mask: number;
  unit: 't' | 'kg' | 'g';
}

export const COMMODITIES: Commodity[] = [
  { name: 'Food',         basePrice: 0x13, gradient: -0x02, baseQuantity: 0x06, mask: 0x01, unit: 't' },
  { name: 'Textiles',     basePrice: 0x14, gradient: -0x01, baseQuantity: 0x0a, mask: 0x03, unit: 't' },
  { name: 'Radioactives', basePrice: 0x41, gradient: -0x03, baseQuantity: 0x02, mask: 0x07, unit: 't' },
  { name: 'Slaves',       basePrice: 0x28, gradient: -0x05, baseQuantity: 0xe2, mask: 0x1f, unit: 't' },
  { name: 'Liquor/Wines', basePrice: 0x53, gradient: -0x05, baseQuantity: 0xfb, mask: 0x0f, unit: 't' },
  { name: 'Luxuries',     basePrice: 0xc4, gradient: +0x08, baseQuantity: 0x36, mask: 0x03, unit: 't' },
  { name: 'Narcotics',    basePrice: 0xeb, gradient: +0x1d, baseQuantity: 0x08, mask: 0x78, unit: 't' },
  { name: 'Computers',    basePrice: 0x9a, gradient: +0x0e, baseQuantity: 0x38, mask: 0x03, unit: 't' },
  { name: 'Machinery',    basePrice: 0x75, gradient: +0x06, baseQuantity: 0x28, mask: 0x07, unit: 't' },
  { name: 'Alloys',       basePrice: 0x4e, gradient: +0x01, baseQuantity: 0x11, mask: 0x1f, unit: 't' },
  { name: 'Firearms',     basePrice: 0x7c, gradient: +0x0d, baseQuantity: 0x1d, mask: 0x07, unit: 't' },
  { name: 'Furs',         basePrice: 0xb0, gradient: -0x09, baseQuantity: 0xdc, mask: 0x3f, unit: 't' },
  { name: 'Minerals',     basePrice: 0x20, gradient: -0x01, baseQuantity: 0x35, mask: 0x03, unit: 't' },
  { name: 'Gold',         basePrice: 0x61, gradient: -0x01, baseQuantity: 0x42, mask: 0x07, unit: 'kg' },
  { name: 'Platinum',     basePrice: 0xab, gradient: -0x02, baseQuantity: 0x37, mask: 0x1f, unit: 'kg' },
  { name: 'Gem-Stones',   basePrice: 0x2d, gradient: -0x01, baseQuantity: 0xfa, mask: 0x0f, unit: 'g' },
  { name: 'Alien Items',  basePrice: 0x35, gradient: +0x0f, baseQuantity: 0xc0, mask: 0x07, unit: 't' },
];

export interface MarketEntry {
  name: string;
  /** Price in credits (one decimal place). */
  price: number;
  quantity: number;
  unit: string;
}

/** Market for a system; fluctuation is a 0-255 byte (vary per visit). */
export function generateMarket(sys: StarSystem, fluctuation: number): MarketEntry[] {
  return COMMODITIES.map((c) => {
    let price = (c.basePrice + (fluctuation & c.mask) + sys.economy * c.gradient) & 0xff;
    price = (price * 4) / 10;
    let quantity = (c.baseQuantity + (fluctuation & c.mask) - sys.economy * c.gradient) & 0xff;
    if (quantity & 0x80) quantity = 0;
    quantity &= 0x3f;
    return { name: c.name, price, quantity, unit: c.unit };
  });
}
