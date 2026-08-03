#!/usr/bin/env python3
"""Repair the graphify extraction before the graph is built.

    python3 tools/graphify-augment.py <extraction.json> <out.json>

graphify's AST pass emits an edge for every import it sees, including imports of
things that are not files in this corpus — `three`, `node:fs`, `argparse`. Those
edges have no node to land on, so `build_from_json` drops them: 149 of 8,677 on
the first run of this repo. Nothing is corrupt, but the questions those edges
would answer are simply missing, and for this project one of them matters a lot.
"Which modules touch `node:fs`?" is the portability gate's whole question
(`npm run portability`), and the graph could not answer it.

Four repairs, in the order they are applied:

  1. EXTERNAL   an import of something outside the corpus becomes a node, typed
                so it is filterable: an npm package, a node builtin, a python
                import. The edge then lands instead of being dropped.
  2. DATA       a JSON/asset file the code imports but that produces no AST
                nodes of its own (the three shipped brains, the generated
                descriptions) becomes a node, so "what loads this?" is
                answerable.
  3. REPOINT    an import the extractor failed to resolve to a file that IS in
                the corpus is aimed at the right node rather than a ghost.
  4. DROP       a phantom edge the extractor invented is removed. There is
                exactly one class of these and it is named below; anything else
                is repaired, never silently discarded.

Run before `build_from_json`. Idempotent: re-running on an already-augmented
extraction changes nothing.
"""

import json
import re
import sys
from pathlib import Path

# --- 1. externals -----------------------------------------------------------
#
# Keyed by the id graphify's AST pass generates for an unresolved import. The
# label is what a reader sees in the graph, so it is the name you would type
# into a package manager rather than the mangled id.

NODE_BUILTINS = {
    'ref_node_fs': 'node:fs',
    'ref_node_path': 'node:path',
    'ref_node_url': 'node:url',
    'ref_node_os': 'node:os',
    'ref_node_crypto': 'node:crypto',
    'ref_node_child_process': 'node:child_process',
    'ref_node_assert_strict': 'node:assert/strict',
}

NPM_PACKAGES = {
    'ref_three': 'three',
    'ref_vite': 'vite',
    'ref_anthropic_ai_sdk': '@anthropic-ai/sdk',
    'ref_three_addons_postprocessing_effectcomposer_js': 'three/addons EffectComposer',
    'ref_three_addons_postprocessing_renderpass_js': 'three/addons RenderPass',
    'ref_three_addons_postprocessing_unrealbloompass_js': 'three/addons UnrealBloomPass',
}

PYTHON_IMPORTS = {
    'argparse': 'argparse', 'json': 'json', 'math': 'math',
    'pathlib': 'pathlib', 'sys': 'sys', 'pil': 'PIL (Pillow)',
    # `re` arrived when this very file started importing it, which is the table
    # working as intended: an unreferenced entry synthesises nothing, so listing
    # a few more stdlib names than tools/ currently uses costs nothing and saves
    # the next unresolved-endpoint hunt.
    're': 're', 'os': 'os', 'io': 'io', 'time': 'time', 'shutil': 'shutil',
    'subprocess': 'subprocess', 'hashlib': 'hashlib', 'random': 'random',
    'typing': 'typing', 'dataclasses': 'dataclasses', 'collections': 'collections',
    'itertools': 'itertools', 'functools': 'functools', 'textwrap': 'textwrap',
    'numpy': 'numpy', 'requests': 'requests',
}

# --- 2. data files ----------------------------------------------------------
#
# Real files in the repo that the code imports and that carry no symbols, so
# the AST pass produces no node for them. Their edges are the answer to "what
# reads this data?", which is exactly the question worth asking about a brain
# or a generated catalogue.

DATA_FILES = {
    'src_ai_training_brains_pirate_attack_g3':
        ('pirate-attack-g3.json', 'src/ai-training/brains/pirate-attack-g3.json'),
    'src_ai_training_brains_pirate_pack_r4_selectonly':
        ('pirate-pack-r4-selectonly.json', 'src/ai-training/brains/pirate-pack-r4-selectonly.json'),
    'src_ai_training_brains_jameson_defend_g1':
        ('jameson-defend-g1.json', 'src/ai-training/brains/jameson-defend-g1.json'),
    'src_galaxy_descriptions_galaxy_1':
        ('galaxy-1.json (256 descriptions)', 'src/galaxy/descriptions/galaxy-1.json'),
    'tools_fixtures_portability_transitive_src_middle_step':
        ('step (portability fixture)', 'tools/fixtures/portability/transitive/src/middle.ts'),
}

# --- 3. repoints ------------------------------------------------------------
#
# `posterise`: `tools/generate-species.py` does `from posterise import posterise`
# and `tools/posterise.py` is right beside it — the python extractor did not
# resolve the sibling import, so the edge pointed at a bare module name.
#
# `chartDistanceTenths`: `contracts.ts` has
# `export { distanceTenths as chartDistanceTenths }`. The alias is a real part of
# the interface — `navigation.ts` names it in a comment as what the campaign
# simulator used — but an aliased re-export produces an edge and no node.

REPOINT = {
    'posterise': 'tools_posterise',
}

ALIAS_NODES = {
    'src_game_contracts_chartdistancetenths':
        ('chartDistanceTenths (alias of distanceTenths)', 'src/game/contracts.ts'),
}

# --- 4. drops ---------------------------------------------------------------
#
# `src/world/sun.ts` writes `const NOISE_GLSL = /* glsl */ \`...\`` — the comment
# is an editor hint for syntax highlighting inside a template literal, and the
# extractor read it as a module path. There is no file and no dependency; the
# edge is a phantom and the only correct repair is to remove it.

DROP_TARGETS = {'src_world_sun_noise_glsl'}


def node(node_id: str, label: str, file_type: str, source_file: str) -> dict:
    return {
        'id': node_id, 'label': label, 'file_type': file_type,
        'source_file': source_file, 'source_location': None,
        'source_url': None, 'captured_at': None, 'author': None, 'contributor': None,
    }


def augment(extraction: dict) -> tuple[dict, dict]:
    nodes = list(extraction.get('nodes', []))
    edges = list(extraction.get('edges', []))
    have = {n['id'] for n in nodes}
    tally = {'external': 0, 'data': 0, 'alias': 0, 'repointed': 0, 'dropped': 0}

    def add(node_id, label, file_type, source_file, kind):
        if node_id in have:
            return
        nodes.append(node(node_id, label, file_type, source_file))
        have.add(node_id)
        tally[kind] += 1

    # Only synthesise for endpoints something actually references, so an
    # unused table entry never invents a node nothing points at.
    referenced = {e[k] for e in edges for k in ('source', 'target')}

    for nid, label in NODE_BUILTINS.items():
        if nid in referenced:
            add(nid, label, 'concept', 'external:node', 'external')
    for nid, label in NPM_PACKAGES.items():
        if nid in referenced:
            add(nid, label, 'concept', 'external:npm', 'external')
    for nid, label in PYTHON_IMPORTS.items():
        if nid in referenced:
            add(nid, label, 'concept', 'external:python', 'external')
    for nid, (label, path) in DATA_FILES.items():
        if nid in referenced:
            add(nid, label, 'document', path, 'data')
    for nid, (label, path) in ALIAS_NODES.items():
        if nid in referenced:
            add(nid, label, 'code', path, 'alias')

    kept = []
    for e in edges:
        if e.get('target') in DROP_TARGETS or e.get('source') in DROP_TARGETS:
            tally['dropped'] += 1
            continue
        for end in ('source', 'target'):
            if e[end] in REPOINT and REPOINT[e[end]] in have:
                e[end] = REPOINT[e[end]]
                tally['repointed'] += 1
        kept.append(e)

    out = dict(extraction)
    out['nodes'] = nodes
    out['edges'] = kept
    return out, tally


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    extraction = json.loads(src.read_text(encoding='utf-8'))

    before = len(extraction.get('edges', []))
    ids = {n['id'] for n in extraction.get('nodes', [])}
    dangling_before = sum(
        1 for e in extraction.get('edges', [])
        if e['source'] not in ids or e['target'] not in ids
    )

    out, tally = augment(extraction)

    ids = {n['id'] for n in out['nodes']}
    dangling_after = sum(
        1 for e in out['edges'] if e['source'] not in ids or e['target'] not in ids
    )
    dst.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding='utf-8')

    print(f"augment: +{tally['external']} external, +{tally['data']} data, "
          f"+{tally['alias']} alias nodes; {tally['repointed']} edges repointed, "
          f"{tally['dropped']} phantom dropped")
    print(f"augment: dangling edges {dangling_before} -> {dangling_after} "
          f"({before} edges in, {len(out['edges'])} out)")
    if dangling_after:
        remaining = sorted({
            e[k] for e in out['edges'] for k in ('source', 'target') if e[k] not in ids
        })
        print(f"augment: still unresolved -> {', '.join(remaining[:12])}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
