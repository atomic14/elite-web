// Build image prompts for the inhabitants of every system.
//
//   node --experimental-strip-types tools/species-prompts.ts [galaxy] [--json]
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

export function buildPrompt(sys: StarSystem): SpeciesPrompt {
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
    // The look is applied afterwards by posterising to the phosphor palette,
    // but asking for it here means the model gives us shapes that survive the
    // crush: strong silhouette, few tones, nothing fussy.
    'stark high contrast, single strong light source, plain dark background',
    'simple bold shapes, minimal detail, centred composition',
    'retro science fiction cover art, 1980s',
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
    negative: 'text, watermark, signature, blurry, low contrast, busy background, multiple figures',
  };
}

// --- CLI --------------------------------------------------------------------

const galaxy = Number(process.argv[2]) || 1;
const asJson = process.argv.includes('--json');
const systems = generateGalaxy(galaxy);
const prompts = systems.map(buildPrompt);

if (asJson) {
  console.log(JSON.stringify({ galaxy, count: prompts.length, prompts }, null, 2));
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
    `${new Set(prompts.map((p) => p.species)).size} distinct species.`);
}
