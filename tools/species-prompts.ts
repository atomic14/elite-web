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

  // Clothing only — never a noun for the wearer.
  //
  // These used to say "a grimy factory hand in worn overalls", and Tibedied
  // came back as a photograph of a man in overalls despite asking for a slimy
  // lobster. "Factory hand" is a concrete human noun and it was competing with
  // the species for the same slot; being the more ordinary request, it won.
  // Describing the clothes and letting the species own the subject removes the
  // competition entirely.
  if (econ.includes('Agricultural')) {
    bits.push(econ.startsWith('Rich')
      ? 'wearing heavy woven farm clothing, prosperous and well fed'
      : econ.startsWith('Poor')
        ? 'wearing patched sun-worn farm clothing, weathered by subsistence work'
        : 'wearing practical homespun work clothing');
  } else {
    bits.push(econ.startsWith('Rich')
      ? 'wearing sharply tailored expensive dress'
      : econ.startsWith('Poor')
        ? 'wearing worn grimy factory overalls'
        : 'wearing utilitarian industrial coveralls');
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

/**
 * "Harmless Felines" -> "harmless feline".
 *
 * Diso kept coming back as a group portrait — five cats in dungarees — and no
 * amount of negative prompting was going to fix it, because the prompt asked
 * for it three times over: a plural species ("felines"), a plural population
 * ("inhabitants of Diso") and a plural occupation ("agricultural workers").
 * Negating "multiple figures" while requesting three plurals is not a contest.
 *
 * Every species in the 1984 tables is a plain -s plural (Rodents, Lobsters,
 * Felines, Humanoids...), so this is as simple as it looks.
 */
const singular = (name: string): string =>
  (name.endsWith('s') && !name.endsWith('ss') ? name.slice(0, -1) : name);

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
export type Style = 'crt' | 'lit' | 'ink' | 'boxart' | 'pixel' | 'plain';

const STYLES: Record<Style, { look: string[]; negative: string[] }> = {
  // Ask for the finished article: green phosphor on black. If the model can
  // do this well, post-processing drops to a palette snap.
  // Describes the IMAGE, never the device. The first version said "CRT monitor
  // image ... retro computer terminal readout" and the model did exactly as
  // asked: it rendered a photograph of a television set, bezel, curved glass
  // and all, with the portrait shrunk inside it. Naming a display in a prompt
  // gets you a picture of the display. So: the qualities of phosphor, and an
  // explicit negative against the hardware.
  crt: {
    look: [
      'monochrome green image, glowing bright green on a pure black background',
      'strong key light on the face, deep black shadows, sharp visible facial features',
      'high contrast, subject fills the whole image edge to edge',
    ],
    negative: [
      // Not "frame", "border" or "device": the prompt says the subject fills
      // the frame, and the tech-level clause says "tools and simple devices".
      // Negating a word the prompt relies on is the ink-style bug again.
      'television set, monitor, screen, bezel, plastic casing, photograph of a screen',
      'white background, grey backdrop, studio lighting, full colour, washed out, flat lighting',
    ],
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
      // NOT "clear silhouette against plain background", which is what this
      // said first: every style also negative-prompts "silhouette", because a
      // flat black shape is the exact failure mode here. Asking for one and
      // forbidding it in the same breath leaves the model to split the
      // difference, and it splits it badly.
      'woodcut print style, strong dark outlines, clean separation from a plain background',
      'sharply defined facial features',
    ],
    negative: ['photograph, soft focus, gradient shading, colour'],
  },
  // The visual world Elite actually shipped into: airbrushed science fiction
  // cover illustration. Strong tonal modelling and theatrical lighting, which
  // is precisely what survives sixteen tones — and it is period-correct
  // without being a pastiche of the game's own graphics.
  boxart: {
    look: [
      'airbrushed 1980s science fiction paperback cover illustration',
      'dramatic theatrical lighting, bold modelled forms, strong rim light, deep shadow',
      'painted poster art, confident brushwork, sharply detailed face and eyes',
    ],
    negative: ['photograph, snapshot, flat lighting, pixelation, colour photography'],
  },
  // The literal reading of "1980s video game", and the one to be sceptical
  // about. Asked for chunky pixels, the model paints FAKE ones at whatever
  // grid it fancies, at 512px — which we then downsample to 256 and quantise
  // on our own grid. Two retro grids that do not align give moiré and mush,
  // and we would be paying the model to imitate the thing posterise.py does
  // exactly. Included because it should be settled by looking, not by me
  // being confident in a comment.
  pixel: {
    look: [
      'retro video game character portrait, chunky visible square pixels, limited palette',
      'clean readable sprite art, strong dark outline, bold simple shading',
      'clearly defined eyes and face',
    ],
    negative: ['photograph, soft focus, anti-aliasing, smooth gradients, blurry pixels'],
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
  // Non-human species need saying twice and defending in the negative. The
  // species tables ask for things like "Harmless Slimy Lobsters", and a lobster
  // in factory overalls is a far stranger request than a person in factory
  // overalls — so any human-shaped hint elsewhere in the prompt will win unless
  // the species is stated as the subject outright.
  const human = species === 'Human Colonials';
  // "Humanoids" is excluded from the anti-human negative for the obvious
  // reason: a humanoid is supposed to look like one.
  const humanoid = species.toLowerCase().includes('humanoid');
  const subject = human
    ? 'a single human colonist'
    : `a single anthropomorphic ${singular(species.toLowerCase())} creature`;

  const prompt = [
    `head and shoulders portrait of ${subject}, one individual alone`,
    ...(human || humanoid ? [] : [`clearly a ${singular(species.toLowerCase())}, animal head and face`]),
    `an inhabitant of ${sys.name}, ${article(ECONOMY_NAMES[sys.economy])} ` +
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
      'text, watermark, signature, blurry, busy background, full body',
      'multiple figures, two people, group portrait, crowd, background characters',
      ...(human || humanoid ? [] : ['human face, ordinary person, man, woman']),
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

/**
 * A term must never appear in both a prompt and its own negative.
 *
 * Twice now this has been a real bug rather than a theoretical one: `ink`
 * asked for a "clear silhouette" while negating "silhouette", and `crt`
 * negated "frame" and "device" while the prompt said the subject fills the
 * frame and the tech-level clause said "tools and simple devices". Both slip
 * past a read-through, because the two halves are written far apart and the
 * collision comes from a clause generated per system.
 *
 * So it is checked over every style against every system, which is cheap and
 * exhaustive where spot-checking one world is neither.
 */
function checkNoContradictions(): void {
  const bad: string[] = [];
  for (const s of Object.keys(STYLES) as Style[]) {
    for (const sys of systems) {
      const p = buildPrompt(sys, s);
      const positive = p.prompt.split(',').map((t) => t.trim().toLowerCase());
      for (const term of p.negative.split(',').map((t) => t.trim().toLowerCase())) {
        if (positive.some((t) => t.split(/\s+/).includes(term))) {
          bad.push(`  ${s}/${sys.name}: negative "${term}" also appears in the prompt`);
        }
      }
    }
  }
  if (bad.length) {
    console.error('prompt contradicts its own negative:');
    console.error([...new Set(bad)].slice(0, 10).join('\n'));
    process.exit(1);
  }
}
checkNoContradictions();

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
