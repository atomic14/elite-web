// Build image prompts for the inhabitants of every system.
//
//   node --experimental-strip-types tools/species-prompts.ts [galaxy] [--style crt] [--json]
//
// Writes nothing by default — prints a sample so the prompts can be eyeballed
// before anyone spends GPU time. With --json it emits the full manifest that
// tools/generate-species.py consumes.
//
// Everything here derives from the 1984 seeds, so the manifest is reproducible:
// same galaxy in, same prompts and seeds out. No model runs at build time and
// none can — the game deploys as a static site, so the images are generated
// offline and committed.

import {
  generateGalaxy, speciesName, ECONOMY_NAMES, GOVERNMENT_NAMES, type StarSystem,
} from '../src/galaxy/galaxy.ts';
import { planetDescription } from '../src/galaxy/goatsoup.ts';

export interface SpeciesPrompt {
  index: number;
  system: string;
  species: string;
  economy: string;
  government: string;
  techLevel: number;
  /** deterministic per system, so a rerun reproduces the same image */
  seed: number;
  prompt: string;
  negative: string;
}

/**
 * What the world does to the people on it. The species tables give us a body;
 * the economy, government and tech level give us a life — and that is what
 * stops 256 portraits looking like 256 rolls on the same table.
 */
function environmentPhrase(sys: StarSystem): string {
  const econ = ECONOMY_NAMES[sys.economy];
  const gov = GOVERNMENT_NAMES[sys.government];
  const bits: string[] = [];

  if (econ.includes('Agricultural')) {
    bits.push(econ.startsWith('Rich')
      ? 'prosperous farmers in heavy woven clothing'
      : econ.startsWith('Poor')
        ? 'weathered subsistence farmers, patched and sun-worn clothing'
        : 'agricultural workers in practical homespun');
  } else {
    bits.push(econ.startsWith('Rich')
      ? 'wealthy industrialists in sharp tailored dress'
      : econ.startsWith('Poor')
        ? 'grimy factory hands in worn overalls'
        : 'industrial workers in utilitarian coveralls');
  }

  if (gov === 'Anarchy') bits.push('armed, wary, improvised gear');
  else if (gov === 'Feudal') bits.push('rigid caste dress, ornamental rank markings');
  else if (gov === 'Dictatorship') bits.push('uniform military styling, severe expression');
  else if (gov === 'Communist') bits.push('identical state-issue uniforms');
  else if (gov === 'Corporate State') bits.push('corporate insignia, immaculate and cold');
  else if (gov === 'Democracy') bits.push('varied civilian dress, open expression');
  else if (gov === 'Confederacy') bits.push('mixed regional dress, travelling gear');
  // Multi-Government was missing from this chain, so those worlds silently
  // lost their whole political flavour — eight governments, seven branches.
  else if (gov === 'Multi-Government') bits.push('clashing factional dress, competing insignia');

  const tl = sys.techLevel + 1;
  bits.push(tl >= 10
    ? 'advanced technology, implants and fine instruments'
    : tl >= 6
      ? 'serviceable technology, tools and simple devices'
      : 'primitive equipment, hand-made and crude');

  return bits.join(', ');
}

const article = (word: string): string => (/^[AEIOU]/i.test(word) ? 'an' : 'a');

/** The goat-soup line, trimmed to the evocative clause. */
function habitatPhrase(sys: StarSystem): string {
  const d = planetDescription(sys)
    .replace(/^.*? is (?:most )?/i, '')
    .replace(/\.$/, '');
  return d.length > 90 ? d.slice(0, 90) : d;
}

/**
 * How much of the look to ask the model for.
 *
 * Z-Image is strong enough to render the era itself, so the honest split is
 * not "model makes images, post makes the look" — it is: the model owns
 * LIGHTING, BACKGROUND and RENDERING STYLE, and post owns only the palette
 * lock and the resolution. Those last two cannot move: 256 portraits ship in
 * a static site and must sit in the game's three greens exactly, which no
 * generator will hit to the byte.
 *
 * The failed first attempt is still instructive, and the boundary it teaches
 * is precise. Asking for "minimal detail, simple bold shapes" told the model
 * to REMOVE information, and it obliged with a flat white silhouette — 2 grey
 * levels against 210 for a lit bust. Asking for dramatic lighting or engraved
 * linework instead RESTRUCTURES the information, putting it into edges and
 * large tonal masses, which is exactly what survives 96px and four tones.
 * Restructure, never suppress.
 */
export type Style = 'crt' | 'lit' | 'ink' | 'plain';

const STYLES: Record<Style, { look: string[]; negative: string[] }> = {
  // Ask for the finished article: green phosphor on black. If the model can
  // do this well, post-processing drops to a palette snap.
  crt: {
    look: [
      'monochrome green phosphor CRT monitor image, glowing bright green on a pure black background',
      'strong key light on the face, deep black shadows, sharp visible facial features',
      'high contrast retro computer terminal readout, faint scanlines',
    ],
    negative: ['white background, grey backdrop, studio lighting, full colour, washed out, flat lighting'],
  },
  // The safe big win: keep the model's photoreal strength, just light it the
  // way a CRT works — subject lit out of darkness rather than pasted on a wall.
  lit: {
    look: [
      'single dramatic key light from the front left, subject lit out of near-total darkness',
      'black background, deep shadows, strong rim light along the jaw and shoulders',
      'detailed, sharp focus, clearly visible eyes and facial features',
    ],
    negative: ['white background, grey backdrop, bright evenly lit room, flat lighting'],
  },
  // Linework survives a hard downsample better than fur does: it is already
  // edges. Worth trying if photoreal texture keeps dithering into speckle.
  ink: {
    look: [
      'black and white engraved illustration, bold confident linework and crosshatching',
      'woodcut print style, strong dark outlines, clear silhouette against plain background',
      'sharply defined facial features',
    ],
    negative: ['photograph, soft focus, gradient shading, colour'],
  },
  // Neutral: a good photograph and nothing else, leaving every decision to post.
  plain: {
    look: [
      'detailed, sharp focus, clearly lit, natural full tonal range',
      'plain uncluttered background, centred head and shoulders portrait',
    ],
    negative: [],
  },
};

export function buildPrompt(sys: StarSystem, style: Style = 'crt'): SpeciesPrompt {
  const species = speciesName(sys);
  // "Human Colonials" describes a people, not a body — say so plainly rather
  // than asking for a creature.
  const subject = species === 'Human Colonials'
    ? 'human colonists'
    : species.toLowerCase();

  const prompt = [
    `head and shoulders portrait of ${subject}`,
    `inhabitants of ${sys.name}, ${article(ECONOMY_NAMES[sys.economy])} ` +
      `${ECONOMY_NAMES[sys.economy].toLowerCase()} ${GOVERNMENT_NAMES[sys.government].toLowerCase()} world`,
    environmentPhrase(sys),
    `homeworld ${habitatPhrase(sys)}`,
    ...STYLES[style].look,
  ].join(', ');

  return {
    index: sys.index,
    system: sys.name,
    species,
    economy: ECONOMY_NAMES[sys.economy],
    government: GOVERNMENT_NAMES[sys.government],
    techLevel: sys.techLevel + 1,
    seed: (sys.seed[0] ^ (sys.seed[1] << 3) ^ (sys.seed[2] << 7)) >>> 0,
    prompt,
    // "silhouette" and "backlit" earn their place: that is the exact failure
    // the first prompt produced, and the crt/lit styles push towards it.
    negative: [
      'silhouette, featureless, solid black shape, face in shadow',
      'text, watermark, signature, blurry, busy background, multiple figures, full body',
      ...STYLES[style].negative,
    ].join(', '),
  };
}

// --- CLI --------------------------------------------------------------------

const galaxy = Number(process.argv[2]) || 1;
const asJson = process.argv.includes('--json');
const styleArg = process.argv.find((a) => a.startsWith('--style'));
const style = ((styleArg?.includes('=')
  ? styleArg.split('=')[1]
  : styleArg && process.argv[process.argv.indexOf(styleArg) + 1]) || 'crt') as Style;
if (!(style in STYLES)) {
  console.error(`unknown --style ${style}; try ${Object.keys(STYLES).join(', ')}`);
  process.exit(1);
}
const systems = generateGalaxy(galaxy);
const prompts = systems.map((s) => buildPrompt(s, style));

if (asJson) {
  console.log(JSON.stringify({ galaxy, style, count: prompts.length, prompts }, null, 2));
} else {
  // a spread: the famous ones, plus the extremes of the environment axes
  const picks = [
    systems[7], // Lave
    systems.find((s) => s.name === 'Diso')!,
    systems.find((s) => s.name === 'Riedquat')!,
    systems.find((s) => s.government === 0)!, // an anarchy
    systems.find((s) => s.economy === 0 && s.techLevel >= 9)!, // rich industrial, high TL
    systems.find((s) => s.economy === 7)!, // poor agricultural
  ].filter(Boolean);
  for (const sys of picks) {
    const p = buildPrompt(sys);
    console.log(`\n=== ${p.system} — ${p.species} (${p.economy}, ${p.government}, TL ${p.techLevel})`);
    console.log(p.prompt);
  }
  console.log(`\n${prompts.length} systems in galaxy ${galaxy}; ` +
    `${new Set(prompts.map((p) => p.species)).size} distinct species; style '${style}'.`);
  console.log(`styles: ${Object.keys(STYLES).join(', ')} (--style ink)`);
}
