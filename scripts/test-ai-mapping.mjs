#!/usr/bin/env node
// Test for the AI mapping layer (lib/ai/execute.ts) against the REAL API dump.
//
//   plain values -> mapToolCall -> validateOps -> applyPatchOps
//
// Covers the property shorthand (bare values typed from the official Roblox API
// dump), the tagged form it replaced, and the errors a wrong value produces.
// Needs data/cache/api-dump.json — run `npm run setup` first.
//
// Same resolve-hook trick as test-engine.mjs, plus the `@/` alias from
// tsconfig.json, since lib/ai imports through it.

import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier
    if (spec.startsWith('@/')) spec = pathToFileURL(path.join(ROOT, spec.slice(2))).href
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\.[a-z]+$/i.test(spec)) {
      const url = new URL(spec, context.parentURL)
      for (const ext of ['.ts', '/index.ts']) {
        if (existsSync(fileURLToPath(url) + ext)) return nextResolve(spec + ext, context)
      }
    }
    return nextResolve(spec, context)
  },
})

const failures = []
let checks = 0

function ok(condition, message) {
  checks += 1
  if (!condition) failures.push(message)
}

function eq(actual, expected, message) {
  checks += 1
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) failures.push(`${message} (got ${a}, expected ${b})`)
}

function section(title) {
  process.stdout.write(`\n— ${title}\n`)
}

const { applyPatchOps, indexTree, newId } = await import('../lib/rbx/tree.ts')
const { defaultBaseplateTree } = await import('../lib/rbx/template.ts')
const { loadReflection, validateOps } = await import('../lib/rbx/validate.ts')
const { mapToolCall } = await import('../lib/ai/execute.ts')

const reflection = await loadReflection()
const baseTree = defaultBaseplateTree()
const workspace = baseTree.services.find((s) => s.className === 'Workspace')
if (!workspace) throw new Error('template has no Workspace')

/** Runs one tool call end to end and returns the resulting tree + diagnostics. */
function run(tree, name, input) {
  const mapped = mapToolCall(name, input, tree, reflection)
  const validated = validateOps(reflection, tree, mapped.ops)
  const applied = validated.ok.length ? applyPatchOps(tree, validated.ok) : { tree, errors: [] }
  return {
    tree: applied.tree,
    ops: validated.ok,
    errors: [...mapped.errors, ...validated.errors, ...applied.errors],
  }
}

section('ids are short')
const id = newId()
eq(id.length, 8, 'newId is 8 characters')
ok(/^[0-9a-z]{8}$/.test(id), `newId is base36 (got ${id})`)
ok(new Set(Array.from({ length: 5000 }, newId)).size === 5000, '5000 ids are unique')

section('shorthand properties are typed from the API dump')
const created = run(baseTree, 'create_instances', {
  instances: [
    {
      parentId: workspace.id,
      className: 'Part',
      name: 'Platform',
      properties: {
        Size: [8, 1, 8],
        CFrame: [0, 12, 0],
        Color: [0.77, 0.16, 0.11],
        Material: 'Neon',
        Shape: 'Ball',
        Anchored: true,
        Transparency: 0.25,
      },
    },
  ],
})
eq(created.errors, [], 'no errors on a shorthand create')
const platform = indexTree(created.tree).get(created.ops[0]?.instance.id)?.inst
ok(platform, 'the part was created')
eq(platform.props.Size, { type: 'Vector3', value: [8, 1, 8] }, 'Size became a Vector3')
eq(platform.props.Color, { type: 'Color3', value: [0.77, 0.16, 0.11] }, 'Color became a Color3')
eq(platform.props.Anchored, { type: 'bool', value: true }, 'Anchored became a bool')
eq(
  platform.props.CFrame,
  { type: 'CFrame', value: { pos: [0, 12, 0], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] } },
  'a bare [x,y,z] became an unrotated CFrame',
)
eq(platform.props.Transparency.type, 'float', 'Transparency normalized to the dump type (float)')

// Enum values must be the real numbers from the dump, not something remembered.
const neon = reflection.enums.get('Material').get('Neon')
const ball = reflection.enums.get('PartType').get('Ball')
eq(
  platform.props.Material,
  { type: 'token', value: neon, enumName: 'Material', itemName: 'Neon' },
  `Material "Neon" resolved to Enum.Material.Neon (${neon})`,
)
eq(
  platform.props.Shape,
  { type: 'token', value: ball, enumName: 'PartType', itemName: 'Ball' },
  `Shape "Ball" resolved to Enum.PartType.Ball (${ball})`,
)

section('the tagged form still works')
const tagged = run(baseTree, 'create_instances', {
  instances: [
    {
      parentId: workspace.id,
      className: 'Part',
      name: 'Legacy',
      properties: {
        Size: { type: 'Vector3', value: [4, 4, 4] },
        Material: { type: 'token', enumName: 'Material', itemName: 'Grass' },
        Anchored: { type: 'bool', value: true },
      },
    },
  ],
})
eq(tagged.errors, [], 'no errors on a tagged create')
const legacy = indexTree(tagged.tree).get(tagged.ops[0]?.instance.id)?.inst
eq(legacy.props.Size, { type: 'Vector3', value: [4, 4, 4] }, 'tagged Vector3 survives')
eq(
  legacy.props.Material.value,
  reflection.enums.get('Material').get('Grass'),
  'tagged enum still resolves',
)

section('shorthand on update_instances')
const updated = run(created.tree, 'update_instances', {
  updates: [{ id: platform.id, props: { Transparency: 0.5, Material: 'Glass', CanCollide: false } }],
})
eq(updated.errors, [], 'no errors on a shorthand update')
const after = indexTree(updated.tree).get(platform.id).inst
eq(after.props.Transparency.value, 0.5, 'Transparency updated')
eq(after.props.Material.itemName, 'Glass', 'Material updated by name')
eq(after.props.CanCollide, { type: 'bool', value: false }, 'CanCollide updated')

section('bad values fail loudly')
const wrongType = run(baseTree, 'create_instances', {
  instances: [
    { parentId: workspace.id, className: 'Part', name: 'Bad', properties: { Size: 5 } },
  ],
})
ok(wrongType.errors.length > 0, 'a scalar for a Vector3 is rejected')
ok(
  wrongType.errors.some((e) => e.includes('Size') && e.includes('Vector3')),
  `the error names the property and its real type (got ${JSON.stringify(wrongType.errors)})`,
)

const unknownProp = run(baseTree, 'create_instances', {
  instances: [
    { parentId: workspace.id, className: 'Part', name: 'Bad', properties: { Wiggliness: 3 } },
  ],
})
ok(
  unknownProp.errors.some((e) => e.includes('Wiggliness')),
  'an invented property is rejected by name',
)

const badEnum = run(baseTree, 'create_instances', {
  instances: [
    { parentId: workspace.id, className: 'Part', name: 'Bad', properties: { Material: 'Cheese' } },
  ],
})
ok(
  badEnum.errors.some((e) => e.includes('Cheese')),
  'an invented enum item is rejected by name',
)

const banned = run(baseTree, 'create_instances', {
  instances: [{ parentId: workspace.id, className: 'UnionOperation', name: 'Nope' }],
})
ok(banned.errors.some((e) => e.includes('UnionOperation')), 'banned classes are still refused')

section('read tools')
const outlineOnce = mapToolCall('get_tree_outline', {}, baseTree, reflection)
ok(
  typeof outlineOnce.readResult.outline === 'string' && outlineOnce.readResult.outline.includes('Baseplate'),
  'get_tree_outline still returns the place',
)

process.stdout.write(`\n${checks} checks\n`)
if (failures.length) {
  process.stdout.write(`\nFAILED (${failures.length}):\n`)
  for (const f of failures) process.stdout.write(`  · ${f}\n`)
  process.exit(1)
}
process.stdout.write('OK\n')
