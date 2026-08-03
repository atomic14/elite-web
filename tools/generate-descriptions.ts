// Generate the extended system descriptions, offline, and commit the result.
//
//   node --experimental-strip-types tools/generate-descriptions.ts [galaxy] \
//        [--model claude-haiku-4-5] [--limit N] [--out NAME] [--batch ID] [--check]
//
//   --check   the non-writing drift gate, wired into `npm run check`. No API
//             call, no key needed.
//   --batch   collect an already-submitted batch instead of sending a new one.
//   --limit   generate only the first N systems — for tasting a model cheaply.
//   --out     write to descriptions/<NAME>.json instead of galaxy-<n>.json, so
//             two models can be generated side by side and read against
//             each other before either is adopted.
//
// Uses the Message Batches API: the whole job is offline, nothing waits on it,
// and batching halves the price. Galaxy 1 costs roughly forty cents on Haiku
// 4.5 this way.
//
// The API key is a developer credential for an offline tool. It is read from
// the environment, never committed, and nothing in src/ ever sees it.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  systemPrompts, SYSTEM_PROMPT, PROMPT_VERSION, faults, foreignSystemNames,
  type SystemPrompt,
} from './system-prompts.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, '..', 'src', 'galaxy', 'descriptions');

const DEFAULT_MODEL = 'claude-haiku-4-5';

/**
 * The schema is the contract. Structured outputs constrain the SHAPE — two
 * fields, both strings, nothing else — which is the half a schema can express.
 * The half it cannot (no digits, no second person, length) is checked by
 * `faults()` after the fact, and a record that fails is dropped rather than
 * repaired: a missing entry falls back to the 1984 line, which is a supported
 * state, so there is nothing to gain by shipping a bad one.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: 'Two to four sentences on the world itself. No digits, no second person.',
    },
    inhabitants: {
      type: 'string',
      description: 'One to three sentences on the people. No digits, no second person.',
    },
  },
  required: ['description', 'inhabitants'],
  additionalProperties: false,
} as const;

interface Entry {
  system: string;
  hash: string;
  description: string;
  inhabitants: string;
}

/**
 * What the run actually cost.
 *
 * TOKENS are the durable fact and are what gets committed; the money is
 * derived and printed, never stored, because a price list goes stale and a
 * token count does not. Counted over EVERY result including the dropped ones —
 * a refused or over-length record was still paid for, and a cost record that
 * only counts what shipped would understate the next run.
 */
export interface Usage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Batch rates, USD per million tokens, already halved for the 50% batch
 * discount. As of 2026-08-03; Sonnet 5 is on its introductory rate ($2/$10
 * standard) until 2026-08-31, after which it is $1.50/$7.50 batched.
 */
const BATCH_RATES: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 0.50, out: 2.50 },
  'claude-sonnet-5': { in: 1.00, out: 5.00 },
  'claude-opus-5': { in: 2.50, out: 12.50 },
};

function reportCost(u: Usage, model: string, ofTotal: number): void {
  const per = (n: number) => (n / Math.max(u.requests, 1)).toFixed(0);
  console.log(`descriptions: ${u.inputTokens} in + ${u.outputTokens} out over `
    + `${u.requests} requests (${per(u.inputTokens)}/${per(u.outputTokens)} each)`);

  const rate = BATCH_RATES[model];
  if (!rate) return;
  const cost = (u.inputTokens * rate.in + u.outputTokens * rate.out) / 1e6;
  const full = cost * (ofTotal / Math.max(u.requests, 1));
  console.log(`descriptions: $${cost.toFixed(4)} at batch rates`
    + (ofTotal > u.requests ? ` — all ${ofTotal} would be about $${full.toFixed(2)}` : ''));
}

interface Overlay {
  galaxy: number;
  promptVersion: number;
  model: string;
  generated: string;
  usage: Usage;
  entries: Record<string, Entry>;
}

const overlayPath = (name: string): string => join(DIR, `${name}.json`);

function readOverlay(name: string): Overlay | null {
  try {
    return JSON.parse(readFileSync(overlayPath(name), 'utf8')) as Overlay;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ the drift gate

/**
 * Does the committed file still describe the galaxy it claims to?
 *
 * Three ways to fail, and one deliberate way to pass:
 *
 *  - an entry whose hash no longer matches the manifest — the rules or that
 *    system's facts changed, so the prose was written against a world that no
 *    longer exists;
 *  - an entry whose name no longer matches the system at that index;
 *  - an entry at an index the galaxy does not have.
 *
 * A file with FEWER entries than the galaxy has systems passes, because a
 * missing entry is a supported state (src/galaxy/descriptions.ts). That is why
 * an empty overlay — which is what ships until a generation run happens — does
 * not fail the build.
 */
function check(galaxy: number, name: string): number {
  const prompts = systemPrompts(galaxy);
  const byIndex = new Map(prompts.map((p) => [String(p.index), p]));
  const file = readOverlay(name);

  if (!file) {
    console.error(`descriptions: no ${name}.json — nothing to check`);
    return 1;
  }

  const bad: string[] = [];
  if (file.promptVersion !== PROMPT_VERSION) {
    bad.push(`file was generated under prompt version ${file.promptVersion}, now ${PROMPT_VERSION}`);
  }

  for (const [index, entry] of Object.entries(file.entries)) {
    const want = byIndex.get(index);
    if (!want) { bad.push(`${index}: galaxy ${galaxy} has no such system`); continue; }
    if (want.system !== entry.system) {
      bad.push(`${index}: file says ${entry.system}, galaxy says ${want.system}`);
    } else if (want.hash !== entry.hash) {
      bad.push(`${index} ${entry.system}: prompt changed (${entry.hash} -> ${want.hash})`);
    }
  }

  const n = Object.keys(file.entries).length;
  if (bad.length) {
    console.error(`descriptions: ${name}.json is stale\n  ${bad.slice(0, 10).join('\n  ')}`);
    if (bad.length > 10) console.error(`  ...and ${bad.length - 10} more`);
    console.error('  regenerate with: npm run generate:descriptions');
    return 1;
  }
  console.log(`descriptions: ${name}.json ok — ${n}/${prompts.length} systems described`);
  return 0;
}

// ------------------------------------------------------------- the generator

/**
 * One batch request per system. `custom_id` is the index — results come back
 * in any order, so nothing may be matched by position.
 *
 * `max_tokens` is 2048 rather than the 1024 it started at, because it caps
 * THINKING plus response and Sonnet 5 thinks by default. The first taste run
 * showed exactly that: Sonnet spent 506 output tokens per request against
 * Haiku's 205 and truncated two of twelve entries mid-sentence, while the
 * prose it did finish was well inside any sane length. Truncation was the
 * ceiling being sized for the answer alone.
 *
 * `retryNote` carries the reason a previous attempt was thrown away. Naming
 * the fault is the whole point — "avoid banned words" gets ignored, "you used
 * sprawling" does not.
 */
function requestsFor(prompts: SystemPrompt[], model: string, retryNote = new Map<number, string>()) {
  return prompts.map((p) => {
    const note = retryNote.get(p.index);
    return {
      custom_id: `sys-${p.index}`,
      params: {
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema' as const, schema: SCHEMA } },
        messages: [{
          role: 'user' as const,
          content: note
            ? `${p.facts}\n\nA previous attempt at this system was rejected: ${note}. Write it again and do not repeat that fault.`
            : p.facts,
        }],
      },
    };
  });
}

/**
 * Turn one batch result into an entry, or say why not.
 *
 * Everything that can go wrong here is expected rather than exceptional — a
 * refusal, a truncation, prose that breaks a rule — so all of it returns a
 * reason and none of it throws. The run reports what it dropped and writes
 * the rest.
 */
function entryFrom(result: any, want: SystemPrompt): { entry?: Entry; why?: string } {
  if (result.result.type !== 'succeeded') {
    return { why: `${result.result.type}: ${result.result.error?.type ?? ''}` };
  }
  const msg = result.result.message;
  if (msg.stop_reason === 'refusal') return { why: 'refused' };
  if (msg.stop_reason === 'max_tokens') return { why: 'truncated' };

  const text = msg.content.find((b: any) => b.type === 'text')?.text;
  if (!text) return { why: 'no text block' };

  let parsed: { description?: string; inhabitants?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { why: 'not JSON' };
  }

  const description = (parsed.description ?? '').trim();
  const inhabitants = (parsed.inhabitants ?? '').trim();
  const bad = [
    ...faults(description, 'description'),
    ...faults(inhabitants, 'inhabitants'),
    // The facts block is the canon it was handed, goat-soup line included —
    // anything named in there is not the model wandering off.
    ...foreignSystemNames(`${description} ${inhabitants}`, want.system, want.facts)
      .map((n) => `names another system (${n})`),
  ];
  if (bad.length) return { why: bad.join('; ') };

  return { entry: { system: want.system, hash: want.hash, description, inhabitants } };
}

/**
 * Read `ANTHROPIC_API_KEY` out of `.env.local` if it is not already in the
 * environment.
 *
 * `*.local` is gitignored, so the key stays on the machine that owns it. This
 * exists because the alternative is passing a secret on a command line, where
 * it lands in shell history — and because the other seven galaxies will want
 * generating later, by which time nobody will remember the incantation.
 */
function loadKey(): void {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const text = readFileSync(join(HERE, '..', '.env.local'), 'utf8');
    const hit = /^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/m.exec(text);
    if (hit) process.env.ANTHROPIC_API_KEY = hit[1].replace(/^['"]|['"]$/g, '');
  } catch { /* no file: the SDK will say what is missing */ }
}

async function generate(
  galaxy: number, name: string, model: string, limit: number, existingBatch: string,
): Promise<number> {
  loadKey();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('descriptions: no ANTHROPIC_API_KEY — set it, or put it in .env.local');
    return 1;
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();

  const prompts = systemPrompts(galaxy).slice(0, limit);
  const byId = new Map(prompts.map((p) => [`sys-${p.index}`, p]));

  const entries: Record<string, Entry> = {};
  const usage: Usage = { requests: 0, inputTokens: 0, outputTokens: 0 };
  let todo = prompts;
  let notes = new Map<number, string>();
  let dropped: string[] = [];

  /**
   * Up to three passes. A dropped record is not a lost cause — the faults are
   * almost all a banned word or a length overrun, and a model told which word
   * it used does not use it again. Without this, roughly one system in eight
   * would silently have no description forever, which the fallback makes
   * invisible rather than harmless.
   */
  for (let pass = 0; pass < 3 && todo.length; pass += 1) {
    let batchId = pass === 0 ? existingBatch : '';
    if (!batchId) {
      const what = pass === 0 ? `${todo.length} systems` : `${todo.length} retries`;
      console.log(`descriptions: submitting ${what} to ${model}...`);
      const batch = await client.messages.batches.create({
        requests: requestsFor(todo, model, notes) as any,
      });
      batchId = batch.id;
      console.log(`descriptions: batch ${batchId} — resume with --batch ${batchId}`);
    }

    // Most batches land inside an hour; the cap is 24. Poll gently.
    for (;;) {
      const batch = await client.messages.batches.retrieve(batchId);
      if (batch.processing_status === 'ended') break;
      const c = batch.request_counts;
      console.log(`descriptions: ${batch.processing_status} — ${c.succeeded} done, ${c.processing} running`);
      await new Promise((r) => { setTimeout(r, 30_000); });
    }

    const failed: SystemPrompt[] = [];
    notes = new Map();
    dropped = [];

    for await (const result of await client.messages.batches.results(batchId)) {
      // Count the tokens before deciding whether to keep the prose: a dropped
      // record was still generated and still billed, retries included.
      const u = (result.result as any).message?.usage;
      if (u) {
        usage.requests += 1;
        usage.inputTokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
          + (u.cache_read_input_tokens ?? 0);
        usage.outputTokens += u.output_tokens ?? 0;
      }

      const want = byId.get(result.custom_id);
      if (!want) { dropped.push(`${result.custom_id}: not in this galaxy`); continue; }
      const { entry, why } = entryFrom(result, want);
      if (entry) { entries[String(want.index)] = entry; continue; }
      failed.push(want);
      notes.set(want.index, why ?? 'unknown');
      dropped.push(`${want.index} ${want.system}: ${why}`);
    }

    if (failed.length) console.log(`descriptions: ${failed.length} to retry`);
    todo = failed;
  }

  const overlay: Overlay = {
    galaxy,
    promptVersion: PROMPT_VERSION,
    model,
    generated: new Date().toISOString().slice(0, 10),
    usage,
    // Sorted numerically so the committed file diffs cleanly between runs.
    entries: Object.fromEntries(
      Object.entries(entries).sort((a, b) => Number(a[0]) - Number(b[0])),
    ),
  };
  writeFileSync(overlayPath(name), `${JSON.stringify(overlay, null, 2)}\n`);

  const kept = Object.keys(entries).length;
  console.log(`descriptions: wrote ${kept}/${prompts.length} to ${name}.json`);
  if (dropped.length) {
    console.log(`descriptions: dropped ${dropped.length} —\n  ${dropped.join('\n  ')}`);
  }
  reportCost(usage, model, systemPrompts(galaxy).length);
  return 0;
}

// ---------------------------------------------------------------------- cli

const argv = process.argv.slice(2);
const flag = (n: string, d = ''): string => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};

const galaxy = Number(argv.find((a) => /^\d+$/.test(a)) ?? 1);
const name = flag('out') || `galaxy-${galaxy}`;

process.exit(argv.includes('--check')
  ? check(galaxy, name)
  : await generate(
    galaxy, name, flag('model') || DEFAULT_MODEL,
    Number(flag('limit')) || Infinity, flag('batch'),
  ));
