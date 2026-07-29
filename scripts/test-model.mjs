#!/usr/bin/env node
// Golden test for the eject path: tree -> Model projection -> real
// `bin/rojo build` -> .rbxm -> Lune deserializeModel assertions.
//
// This is the file that gets uploaded to a user's Roblox account, so the shape
// matters: exactly one root Model, Workspace content directly under it, one
// Folder per other service, and instance refs (Motor6D) still wired.
//
// Same TS-resolve hook as test-engine.mjs: Node strips types but wants
// extensions on relative specifiers.

import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_ID = 'model-test'
const PROJECT_NAME = 'Model Test'
const PROJECT_DIR = path.join(ROOT, 'data', 'projects', PROJECT_ID)

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

const { applyPatchOps, newId } = await import('../lib/rbx/tree.ts')
const { defaultBaseplateTree, blockyNpc } = await import('../lib/rbx/template.ts')
const { modelProjectFromTree } = await import('../lib/rbx/rojo.ts')
const { buildModel } = await import('../lib/rbx/build.ts')

// --- a tree with something in three different services -----------------------

const base = defaultBaseplateTree()
const workspace = base.services.find((s) => s.className === 'Workspace')
const serverScriptService = base.services.find((s) => s.className === 'ServerScriptService')
const starterGui = base.services.find((s) => s.className === 'StarterGui')
ok(starterGui, 'StarterGui service present in the template')

const applied = applyPatchOps(base, [
  { op: 'create', parentId: workspace.id, instance: blockyNpc('Guard', [12, 0, -8]) },
  {
    op: 'create',
    parentId: serverScriptService.id,
    instance: {
      id: newId(),
      className: 'Script',
      name: 'Rounds',
      props: {
        Source: { type: 'ProtectedString', value: 'print("rounds")\n' },
        RunContext: { type: 'token', value: 1, enumName: 'RunContext', itemName: 'Server' },
      },
      children: [],
    },
  },
  {
    op: 'create',
    parentId: starterGui.id,
    instance: {
      id: newId(),
      className: 'ScreenGui',
      name: 'HUD',
      props: {},
      children: [
        {
          id: newId(),
          className: 'TextLabel',
          name: 'Score',
          props: { Text: { type: 'string', value: '0' } },
          children: [],
        },
      ],
    },
  },
])
eq(applied.errors.length, 0, `setup ops failed: ${applied.errors.join(' | ')}`)
const tree = applied.tree

// --- projection --------------------------------------------------------------

section('model projection')
const projection = modelProjectFromTree(tree, PROJECT_NAME)
const project = JSON.parse(projection.files['default.project.json'])
eq(project.name, PROJECT_NAME, 'project name is the model name')
eq(project.tree.$className, undefined, 'root node is $path-only (rojo refuses $className + $path)')
eq(project.tree.$path, 'src/__bloxable_root.model.json', 'root model file path')
const rootModel = JSON.parse(projection.files['src/__bloxable_root.model.json'])
eq(rootModel.className, 'Model', 'root instance is a Model')
ok(
  projection.serviceFolders.includes('ServerScriptService') && projection.serviceFolders.includes('StarterGui'),
  `service folders reported: ${projection.serviceFolders.join(', ')}`,
)
ok(!projection.serviceFolders.includes('Workspace'), 'Workspace is not a folder — its children are the model')
ok(
  projection.servicesWithProperties.includes('Lighting'),
  `Lighting is reported as a service whose properties cannot travel: ${projection.servicesWithProperties.join(', ')}`,
)

// --- build -------------------------------------------------------------------

section('build')
await rm(PROJECT_DIR, { recursive: true, force: true })
await mkdir(PROJECT_DIR, { recursive: true })
await writeFile(path.join(PROJECT_DIR, 'tree.json'), JSON.stringify(tree))
await writeFile(
  path.join(PROJECT_DIR, 'project.json'),
  JSON.stringify({
    id: PROJECT_ID,
    name: PROJECT_NAME,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
)

const built = await buildModel(PROJECT_ID)
ok(built.bytes > 0, 'model build produced bytes')
ok(built.filePath.endsWith('model.rbxm'), 'model build path')
const magic = (await readFile(built.filePath)).subarray(0, 8).toString('binary')
eq(magic, '<roblox!', 'rbxm has the Roblox binary magic')
// 20 MB is the Assets API cap for models; a baseplate + NPC must be nowhere near it.
ok(built.bytes < 20 * 1024 * 1024, 'model is under the Assets API size cap')

// --- lune verification -------------------------------------------------------

const lune = path.join(ROOT, 'bin', 'lune')
if (existsSync(lune)) {
  section('lune verify')
  const verifyPath = path.join(PROJECT_DIR, 'build-model', 'verify.luau')
  await writeFile(
    verifyPath,
    `local fs = require("@lune/fs")
local roblox = require("@lune/roblox")

local failures = {}
local function check(condition, message)
	if not condition then
		table.insert(failures, message)
	end
end

local roots = roblox.deserializeModel(fs.readFile(${JSON.stringify(built.filePath)}))
check(#roots == 1, "expected exactly one root instance, got " .. #roots)

local model = roots[1]
check(model.ClassName == "Model", "root class is " .. model.ClassName)
check(model.Name == ${JSON.stringify(PROJECT_NAME)}, "root name is " .. model.Name)

check(model:FindFirstChild("Baseplate") ~= nil, "Workspace children are not directly under the model")
check(model:FindFirstChildOfClass("SpawnLocation") ~= nil, "no SpawnLocation")

local sss = model:FindFirstChild("ServerScriptService")
check(sss ~= nil and sss.ClassName == "Folder", "ServerScriptService folder missing")
if sss then
	check(sss:GetAttribute("BloxableService") == "ServerScriptService", "service folder is not tagged with its origin")
	local script = sss:FindFirstChild("Rounds")
	check(script ~= nil and script.ClassName == "Script", "server Script did not survive")
end

local gui = model:FindFirstChild("StarterGui")
check(gui ~= nil, "StarterGui folder missing")
if gui then
	local hud = gui:FindFirstChild("HUD")
	check(hud ~= nil and hud.ClassName == "ScreenGui", "ScreenGui did not survive")
	check(hud ~= nil and hud:FindFirstChild("Score") ~= nil, "TextLabel did not survive")
end

local guard = model:FindFirstChild("Guard")
check(guard ~= nil, "NPC model missing")
if guard then
	local torso = guard:FindFirstChild("Torso")
	local neck = torso and torso:FindFirstChild("Neck")
	check(neck ~= nil, "Motor6D missing")
	if neck then
		check(neck.Part0 ~= nil and neck.Part1 ~= nil, "Motor6D refs are nil inside the model")
	end
end

if #failures > 0 then
	for _, message in failures do
		print("FAIL " .. message)
	end
	error(#failures .. " lune check(s) failed")
end
print("lune: model verified")
`,
  )
  try {
    const { stdout } = await execFileP(lune, ['run', verifyPath], { cwd: ROOT })
    process.stdout.write(stdout)
    checks += 1
  } catch (err) {
    failures.push(`lune verification failed:\n${err.stdout ?? ''}${err.stderr ?? ''}`)
  }
} else {
  process.stdout.write('\n(lune not installed — skipping deserialization checks; run npm run setup)\n')
}

// --- report ------------------------------------------------------------------

await rm(PROJECT_DIR, { recursive: true, force: true })

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} of ${checks} checks failed:\n`)
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n`)
  process.exit(1)
}
process.stdout.write(`\n${checks} checks passed\n`)
