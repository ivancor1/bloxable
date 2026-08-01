#!/usr/bin/env node
// Pins strictOpShapeErrors (lib/rbx/validate.ts): the ops route used to accept
// an update op whose payload said `properties` instead of `props` and apply it
// as a silent no-op — every property dropped, no word to the caller. Real
// observed failure (2026-07-31). These checks pin the rejection of every
// off-shape op, the did-you-mean hints, and — just as important — that every
// LEGAL op shape sails through untouched.
//
// Same TS-resolve hook as test-engine.mjs.

import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier, context.parentURL)
      if (!/\.[a-z]+$/i.test(url.pathname)) {
        for (const ext of ['.ts', '/index.ts']) {
          if (existsSync(fileURLToPath(url) + ext)) return nextResolve(specifier + ext, context)
        }
      }
    }
    return nextResolve(specifier, context)
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
  if (actual !== expected) failures.push(`${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`)
}

function section(title) {
  process.stdout.write(`\n— ${title}\n`)
}

const { strictOpShapeErrors } = await import('../lib/rbx/validate.ts')

// --- every legal shape passes ---------------------------------------------------

section('legal shapes pass')

const inst = { id: 'aaaa1111', className: 'Part', name: 'P', props: { Anchored: true }, children: [] }
eq(strictOpShapeErrors([{ op: 'create', parentId: 'ws', instance: inst }]).length, 0, 'create')
eq(strictOpShapeErrors([{ op: 'update', id: 'x', props: { Anchored: true } }]).length, 0, 'update')
eq(
  strictOpShapeErrors([{ op: 'update', id: 'x', props: {}, attributes: { Health: { type: 'number', value: 5 } }, tags: ['Enemy'] }]).length,
  0,
  'update with attributes + tags',
)
eq(strictOpShapeErrors([{ op: 'rename', id: 'x', name: 'New' }]).length, 0, 'rename')
eq(strictOpShapeErrors([{ op: 'delete', id: 'x' }]).length, 0, 'delete')
eq(strictOpShapeErrors([{ op: 'reparent', id: 'x', parentId: 'y' }]).length, 0, 'reparent')
eq(
  strictOpShapeErrors([
    { op: 'create', parentId: 'ws', instance: { ...inst, attributes: {}, tags: [], children: [{ ...inst, id: 'bbbb2222' }] } },
  ]).length,
  0,
  'create with nested child, attributes, tags',
)

// --- THE bug: properties instead of props ----------------------------------------

section('the reported bug')

const bug = strictOpShapeErrors([{ op: 'update', id: 'x', properties: { Anchored: true } }])
eq(bug.length, 1, 'properties-for-props caught')
ok(bug[0].includes('did you mean "props"'), `hint present: ${bug[0]}`)

const bugCreate = strictOpShapeErrors([{ op: 'create', parentId: 'ws', instance: { ...inst, properties: { A: 1 } } }])
eq(bugCreate.length, 1, 'properties inside an instance payload caught')
ok(bugCreate[0].includes('did you mean "props"'), 'instance-level hint present')

// --- other off-shape ops ----------------------------------------------------------

section('other off-shape ops')

ok(strictOpShapeErrors([{ op: 'update', id: 'x', props: {}, extra: 1 }])[0].includes('unknown key "extra"'), 'unknown key named')
ok(strictOpShapeErrors([{ op: 'delete', id: 'x', name: 'n' }]).length === 1, 'delete carries no name')
ok(strictOpShapeErrors([{ op: 'reparent', id: 'x', parent: 'y', parentId: 'y' }])[0].includes('did you mean "parentId"'), 'parent → parentId hint')
ok(strictOpShapeErrors([{ op: 'update', id: 'x', attrs: {} }])[0].includes('did you mean "attributes"'), 'attrs → attributes hint')
ok(strictOpShapeErrors([{ op: 'explode', id: 'x' }])[0].includes('"op" must be one of'), 'unknown op kind named')
ok(strictOpShapeErrors([null])[0].includes('must be an object'), 'null op rejected')
ok(strictOpShapeErrors([[1, 2]])[0].includes('must be an object'), 'array op rejected')
ok(strictOpShapeErrors(['delete x'])[0].includes('must be an object'), 'string op rejected')

// Nested child with a wrong key is found, with its path named.
const nested = strictOpShapeErrors([
  { op: 'create', parentId: 'ws', instance: { ...inst, children: [{ ...inst, id: 'cccc3333', Klass: 'Part' }] } },
])
eq(nested.length, 1, 'nested unknown key caught')
ok(nested[0].includes('children[0]'), `nested path named: ${nested[0]}`)

// create with a non-object instance is a shape error, not a crash.
ok(strictOpShapeErrors([{ op: 'create', parentId: 'ws', instance: 'Part' }])[0].includes('must be an object'), 'string instance rejected')

// Several bad ops → several errors, all indexed.
const multi = strictOpShapeErrors([
  { op: 'update', id: 'a', properties: {} },
  { op: 'delete', id: 'b' },
  { op: 'rename', id: 'c', Name: 'x', name: 'x' },
])
eq(multi.length, 2, 'two bad ops → two errors, good one untouched')
ok(multi[0].startsWith('ops[0]') && multi[1].startsWith('ops[2]'), 'errors carry op indexes')

// --- report ------------------------------------------------------------------

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} of ${checks} checks failed:\n`)
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n`)
  process.exit(1)
}
process.stdout.write(`\n${checks} checks passed\n`)
