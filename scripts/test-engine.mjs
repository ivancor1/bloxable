#!/usr/bin/env node
// Golden test for the Bloxable place engine.
//
//   defaultBaseplateTree -> validate + apply sample ops -> Rojo projection
//   -> real `bin/rojo build` -> assert the place file -> (if bin/lune exists)
//   deserialize it with Lune and assert the instance tree.
//
// The lib/rbx modules are TypeScript. Node 26 strips types natively, but its ESM
// resolver still wants a file extension on relative specifiers, so a small
// resolve hook maps `./tree` -> `./tree.ts`. No extra dependencies.

import { registerHooks } from 'node:module'
import { existsSync, statSync } from 'node:fs'
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
const PROJECT_ID = 'engine-test'
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

const { applyPatchOps, indexTree, newId, outline, getInstances } = await import('../lib/rbx/tree.ts')
const { defaultBaseplateTree, blockyNpc } = await import('../lib/rbx/template.ts')
const { loadReflection, validateOps } = await import('../lib/rbx/validate.ts')
const { projectFromTree } = await import('../lib/rbx/rojo.ts')
const { buildPlace } = await import('../lib/rbx/build.ts')

// --- 1. template -------------------------------------------------------------

section('template')
const base = defaultBaseplateTree()
const workspace = base.services.find((s) => s.className === 'Workspace')
const lighting = base.services.find((s) => s.className === 'Lighting')
const serverScriptService = base.services.find((s) => s.className === 'ServerScriptService')

ok(workspace, 'Workspace service present')
ok(lighting, 'Lighting service present')
ok(serverScriptService, 'ServerScriptService service present')
ok(
  base.services.some((s) => s.className === 'Players'),
  'Players service present',
)

const baseplate = workspace.children.find((c) => c.name === 'Baseplate')
ok(baseplate, 'Baseplate part present')
eq(JSON.stringify(baseplate.props.Size.value), JSON.stringify([2048, 16, 2048]), 'Baseplate size')
eq(baseplate.props.CFrame.value.pos[1], -8, 'Baseplate Y')
eq(
  baseplate.children.filter((c) => c.className === 'Texture').length,
  1,
  'Baseplate has its stud Texture',
)
const spawn = workspace.children.find((c) => c.className === 'SpawnLocation')
ok(spawn, 'SpawnLocation present')
eq(spawn.props.Duration.value, 0, 'SpawnLocation Duration is 0')
eq(lighting.props.Technology.value, 3, 'Lighting.Technology = ShadowMap(3)')
eq(lighting.props.TimeOfDay.value, '14:30:00', 'Lighting.TimeOfDay')

// --- 2. patch ops ------------------------------------------------------------

section('patch ops')
const npc = blockyNpc('Guard', [12, 0, -8])
const scriptId = newId()
const partId = newId()

const ops = [
  {
    op: 'create',
    parentId: workspace.id,
    instance: {
      id: partId,
      className: 'Part',
      name: 'Platform',
      props: {
        Size: { type: 'Vector3', value: [16, 1, 16] },
        CFrame: {
          type: 'CFrame',
          value: { pos: [0, 8, -24], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
        },
        Anchored: { type: 'bool', value: true },
        Color: { type: 'Color3', value: [0.9, 0.4, 0.2] },
        Material: { type: 'token', value: 0, enumName: 'Material', itemName: 'Neon' },
        Transparency: { type: 'int', value: 0 },
      },
      children: [],
    },
  },
  {
    op: 'create',
    parentId: serverScriptService.id,
    instance: {
      id: scriptId,
      className: 'Script',
      name: 'Rounds',
      props: {
        Source: {
          type: 'ProtectedString',
          value: 'local Players = game:GetService("Players")\n\nPlayers.PlayerAdded:Connect(function(player)\n\tprint(`{player.Name} joined`)\nend)\n',
        },
        RunContext: { type: 'token', value: 1, enumName: 'RunContext', itemName: 'Server' },
      },
      children: [],
    },
  },
  { op: 'create', parentId: workspace.id, instance: npc },
]

const reflection = await loadReflection()
const validated = validateOps(reflection, base, ops)
eq(validated.errors.length, 0, `validateOps rejected valid ops: ${validated.errors.join(' | ')}`)
eq(validated.ok.length, 3, 'validateOps kept all three ops')

const materialOp = validated.ok[0]
eq(materialOp.instance.props.Material.value, 288, 'Neon resolved from itemName to 288')
eq(materialOp.instance.props.Transparency.type, 'float', 'int normalized to float for Transparency')

const applied = applyPatchOps(base, validated.ok)
eq(applied.errors.length, 0, `applyPatchOps errors: ${applied.errors.join(' | ')}`)
eq(base.services.find((s) => s.className === 'Workspace').children.length, 2, 'input tree untouched')

let tree = applied.tree
const treeIndex = indexTree(tree)
ok(treeIndex.has(partId), 'created Part is in the tree')
ok(treeIndex.has(npc.id), 'NPC model is in the tree')

// rename + update + reparent + delete round
const renamed = applyPatchOps(tree, [
  { op: 'rename', id: partId, name: 'Platform A' },
  { op: 'update', id: partId, props: { Anchored: { type: 'bool', value: true } } },
])
eq(renamed.errors.length, 0, `rename/update errors: ${renamed.errors.join(' | ')}`)
eq(indexTree(renamed.tree).get(partId).inst.name, 'Platform A', 'rename applied')
tree = renamed.tree

section('patch op guards')
const guards = applyPatchOps(tree, [
  { op: 'delete', id: workspace.id },
  { op: 'rename', id: workspace.id, name: 'Nope' },
  { op: 'reparent', id: workspace.id, parentId: partId },
  { op: 'reparent', id: npc.id, parentId: npc.children[0].id },
  { op: 'update', id: 'does-not-exist', props: {} },
  { op: 'create', parentId: 'nope', instance: { id: newId(), className: 'Part', name: 'X', props: {}, children: [] } },
])
eq(guards.errors.length, 6, `expected 6 guard errors, got: ${guards.errors.join(' | ')}`)
eq(
  JSON.stringify(guards.tree),
  JSON.stringify(tree),
  'rejected ops left the tree unchanged',
)

section('validator guards')
const bad = validateOps(reflection, tree, [
  {
    op: 'create',
    parentId: workspace.id,
    instance: { id: newId(), className: 'UnionOperation', name: 'U', props: {}, children: [] },
  },
  {
    op: 'create',
    parentId: workspace.id,
    instance: { id: newId(), className: 'Nonsense', name: 'N', props: {}, children: [] },
  },
  {
    op: 'create',
    parentId: workspace.id,
    instance: { id: newId(), className: 'Workspace', name: 'W', props: {}, children: [] },
  },
  { op: 'update', id: partId, props: { Colour: { type: 'Color3', value: [1, 0, 0] } } },
  {
    op: 'update',
    id: partId,
    props: { Material: { type: 'token', value: 0, enumName: 'Material', itemName: 'Fictional' } },
  },
  { op: 'update', id: partId, props: { Anchored: { type: 'string', value: 'yes' } } },
])
eq(bad.ok.length, 0, 'validator rejected every bad op')
eq(bad.errors.length, 6, `expected 6 validator errors, got: ${bad.errors.join(' | ')}`)
ok(
  bad.errors[0].includes('publish API'),
  `banned class error explains why: ${bad.errors[0]}`,
)

// Partial failure stays partial: one unsupported property (or one bad child) must
// never discard the whole nested build. Regression guard for the real incident
// where a TextLabel's UDim2 Size threw away an entire 30-part obby.
section('partial failure')
const partialId = newId()
const partial = validateOps(reflection, tree, [
  {
    op: 'create',
    parentId: workspace.id,
    instance: {
      id: partialId,
      className: 'Model',
      name: 'Obby',
      props: {},
      children: [
        {
          id: newId(),
          className: 'Part',
          name: 'GoodPlatform',
          props: { Anchored: { type: 'bool', value: true } },
          children: [],
        },
        {
          id: newId(),
          className: 'TextLabel',
          name: 'Sign',
          // UDim2 is not expressible in this build — the property must be dropped,
          // not the model.
          props: { Size: { type: 'Vector3', value: [1, 1, 0] } },
          children: [],
        },
        {
          id: newId(),
          className: 'Nonsense',
          name: 'Bogus',
          props: {},
          children: [],
        },
      ],
    },
  },
])
eq(partial.ok.length, 1, 'a nested failure still yields the create op')
const built = partial.ok[0].instance
eq(built.children.length, 2, 'the invalid child is dropped, valid ones survive')
eq(built.children[0].name, 'GoodPlatform', 'the good child is intact')
ok(built.children[0].props.Anchored?.value === true, 'good child keeps its properties')
eq(built.children[1].name, 'Sign', 'the label survives without its bad property')
eq(Object.keys(built.children[1].props).length, 0, 'the unsupported property was skipped')
ok(
  partial.errors.some((e) => e.includes('UDim2') && e.includes('skipped')),
  `the skipped property is reported: ${partial.errors.join(' | ')}`,
)
ok(
  partial.errors.some((e) => e.includes('Nonsense')),
  'the skipped child is reported',
)

section('outline')
const text = outline(tree)
ok(text.includes(`Platform A [Part] id=${partId}`), 'outline lists id-annotated instances')
ok(text.includes('size=2048x16x2048'), 'outline summarizes Size')
ok(/Rounds \[Script\].*script:Server=/.test(text), 'outline marks scripts')
eq(getInstances(tree, [partId, 'missing']).length, 1, 'getInstances skips unknown ids')

// --- 3. projection -----------------------------------------------------------

section('rojo projection')
const files = projectFromTree(tree, 'Engine Test')
const project = JSON.parse(files['default.project.json'])
eq(project.emitLegacyScripts, false, 'emitLegacyScripts is false')
eq(project.tree.$className, 'DataModel', 'tree root is a DataModel')
ok(project.tree.Workspace.$path === 'src/Workspace.model.json', 'Workspace projected to a model.json')
ok(
  project.tree.ServerScriptService.Rounds.$path === 'src/ServerScriptService/Rounds.server.luau',
  'server Script projected to a real .luau file',
)
ok(
  files['src/ServerScriptService/Rounds.server.luau'].includes('Players.PlayerAdded'),
  'script file carries the real source',
)
const workspaceModel = JSON.parse(files['src/Workspace.model.json'])
const npcModel = workspaceModel.children.find((c) => c.name === 'Guard')
ok(npcModel, 'NPC is inline in the Workspace model.json')
ok(
  npcModel.children.some((c) => c.className === 'Script' && c.properties.Source.String.includes('MoveTo')),
  'NPC wander Script is emitted inline (its parent is a Model, not a container)',
)
ok(npcModel.attributes === undefined || !npcModel.attributes.Rojo_Id, 'no stray Rojo_Id on the model')
ok(
  npcModel.children.find((c) => c.name === 'HumanoidRootPart').attributes.Rojo_Id,
  'ref targets carry Rojo_Id',
)
const neck = npcModel.children
  .find((c) => c.name === 'Torso')
  .children.find((c) => c.name === 'Neck')
ok(neck.attributes.Rojo_Target_Part0 && neck.attributes.Rojo_Target_Part1, 'Motor6D refs projected')

// --- 4. build ----------------------------------------------------------------

section('build')
await rm(PROJECT_DIR, { recursive: true, force: true })
await mkdir(PROJECT_DIR, { recursive: true })
await writeFile(path.join(PROJECT_DIR, 'tree.json'), JSON.stringify(tree))
await writeFile(
  path.join(PROJECT_DIR, 'project.json'),
  JSON.stringify({
    id: PROJECT_ID,
    name: 'Engine Test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
)

const binary = await buildPlace(PROJECT_ID, 'rbxl')
ok(statSync(binary.filePath).size === binary.bytes && binary.bytes > 0, 'rbxl build produced bytes')
const magic = (await readFile(binary.filePath)).subarray(0, 8).toString('binary')
eq(magic, '<roblox!', 'rbxl has the Roblox binary magic')

const xml = await buildPlace(PROJECT_ID, 'rbxlx')
ok(xml.filePath.endsWith('place.rbxlx'), 'rbxlx path')
const place = await readFile(xml.filePath, 'utf8')
for (const marker of [
  '<roblox version="4">',
  '<Item class="Workspace"',
  '<Item class="SpawnLocation"',
  '<Item class="Decal"',
  '<Item class="Texture"',
  '<Item class="Model"',
  '<Item class="Humanoid"',
  '<Item class="Motor6D"',
  '<Item class="Script"',
  '<Color3uint8 name="Color3uint8">',
  '<CoordinateFrame name="CFrame">',
  '<token name="RunContext">1</token>',
]) {
  ok(place.includes(marker), `place file contains ${marker}`)
}
ok(!/<Ref name="Part0">null<\/Ref>/.test(place), 'Motor6D Part0 is not nil')

// --- 5. lune verification ----------------------------------------------------

const lune = path.join(ROOT, 'bin', 'lune')
if (existsSync(lune)) {
  section('lune verify')
  const verifyPath = path.join(PROJECT_DIR, 'build', 'verify.luau')
  await writeFile(
    verifyPath,
    `local fs = require("@lune/fs")
local roblox = require("@lune/roblox")

-- Lune exposes the Roblox datatypes on the module, not as globals.
local Vector3 = roblox.Vector3
local Enum = roblox.Enum

local failures = {}
local function check(condition, message)
	if not condition then
		table.insert(failures, message)
	end
end

local place = roblox.deserializePlace(fs.readFile(${JSON.stringify(xml.filePath)}))

for _, serviceName in { "Workspace", "Lighting", "ReplicatedStorage", "ServerScriptService", "StarterPlayer", "Players", "Teams" } do
	check(place:FindFirstChildOfClass(serviceName) ~= nil, "missing service " .. serviceName)
end

local workspace = place:GetService("Workspace")
local baseplate = workspace:FindFirstChild("Baseplate")
check(baseplate ~= nil, "no Baseplate")
check(baseplate.Size == Vector3.new(2048, 16, 2048), "baseplate size " .. tostring(baseplate and baseplate.Size))
-- Lune cannot read properties it has no default for, so go through CFrame.
check(baseplate.CFrame.Position == Vector3.new(0, -8, 0), "baseplate position " .. tostring(baseplate and baseplate.CFrame.Position))
check(baseplate.Anchored == true, "baseplate not anchored")
check(baseplate:FindFirstChildOfClass("Texture") ~= nil, "baseplate has no stud Texture")

local spawn = workspace:FindFirstChildOfClass("SpawnLocation")
check(spawn ~= nil, "no SpawnLocation")
check(spawn.Size == Vector3.new(12, 1, 12), "spawn size")
check(spawn.Duration == 0, "spawn Duration should be 0")
check(spawn:FindFirstChildOfClass("Decal") ~= nil, "spawn has no Decal")

local lighting = place:GetService("Lighting")
check(lighting.Technology == Enum.Technology.ShadowMap, "lighting technology " .. tostring(lighting.Technology))
check(lighting.TimeOfDay == "14:30:00", "lighting TimeOfDay " .. tostring(lighting.TimeOfDay))
check(lighting.Brightness == 3, "lighting Brightness")

local guard = workspace:FindFirstChild("Guard")
check(guard ~= nil, "no NPC model")
local humanoid = guard:FindFirstChildOfClass("Humanoid")
check(humanoid ~= nil, "NPC has no Humanoid")
check(humanoid.RigType == Enum.HumanoidRigType.R6, "NPC rig type")
local root = guard:FindFirstChild("HumanoidRootPart")
check(root ~= nil, "NPC has no HumanoidRootPart")
check(guard.PrimaryPart == root, "NPC PrimaryPart is not the HumanoidRootPart")
check(guard:FindFirstChild("Head") ~= nil, "NPC has no Head")
local torso = guard:FindFirstChild("Torso")
check(torso ~= nil, "NPC has no Torso")
local neck = torso and torso:FindFirstChild("Neck")
check(neck ~= nil, "NPC has no Neck joint")
if neck then
	check(neck.Part0 == torso, "Neck.Part0 is not the Torso")
	check(neck.Part1 == guard:FindFirstChild("Head"), "Neck.Part1 is not the Head")
	check(neck.C0.Position == Vector3.new(0, 1, 0), "Neck C0 " .. tostring(neck.C0.Position))
	check(neck.C1.Position == Vector3.new(0, -0.5, 0), "Neck C1 " .. tostring(neck.C1.Position))
end
local rootJoint = root and root:FindFirstChild("RootJoint")
check(rootJoint ~= nil, "NPC has no RootJoint")
if rootJoint then
	check(rootJoint.Part0 == root and rootJoint.Part1 == torso, "RootJoint parts")
end
local wander = guard:FindFirstChild("Wander")
check(wander ~= nil, "NPC has no wander Script")
if wander then
	check(wander.ClassName == "Script", "wander is a " .. wander.ClassName)
	check(string.find(wander.Source, "humanoid:MoveTo") ~= nil, "wander script lost its source")
	check(wander.RunContext == Enum.RunContext.Server, "wander RunContext")
end

local rounds = place:GetService("ServerScriptService"):FindFirstChild("Rounds")
check(rounds ~= nil, "no Rounds script")
if rounds then
	check(rounds.ClassName == "Script", "Rounds class " .. rounds.ClassName)
	check(rounds.RunContext == Enum.RunContext.Server, "Rounds RunContext")
	check(string.find(rounds.Source, "PlayerAdded") ~= nil, "Rounds source")
end

local platform = workspace:FindFirstChild("Platform A")
check(platform ~= nil, "renamed Part missing")
if platform then
	check(platform.Material == Enum.Material.Neon, "platform material " .. tostring(platform.Material))
end

if #failures > 0 then
	for _, message in failures do
		print("FAIL " .. message)
	end
	error(\`lune verify: {#failures} failed assertion(s)\`)
end

print("lune verify: all assertions passed")
`,
  )

  try {
    const { stdout } = await execFileP(lune, ['run', verifyPath], { cwd: ROOT })
    process.stdout.write(stdout)
    ok(stdout.includes('all assertions passed'), 'lune verify reported success')
  } catch (err) {
    failures.push(`lune verify failed:\n${(err.stderr || err.stdout || err.message).trim()}`)
  }
} else {
  process.stdout.write('\n— lune verify skipped (bin/lune missing — run `npm run setup`)\n')
}

// --- 6. projection edge cases ------------------------------------------------
// Duplicate sibling names, scripts under Folders, LocalScripts, script names
// that collide, and a literal ]]> in Luau source — the four places where a
// naive projection silently loses or corrupts data.

section('projection edge cases')
const EDGE_ID = 'engine-test-edge'
const EDGE_DIR = path.join(ROOT, 'data', 'projects', EDGE_ID)

const edgeBase = defaultBaseplateTree()
const edgeWorkspace = edgeBase.services.find((s) => s.className === 'Workspace')
const edgeReplicated = edgeBase.services.find((s) => s.className === 'ReplicatedStorage')
const edgeStarterPlayer = edgeBase.services.find((s) => s.className === 'StarterPlayer')
const edgeStarterPlayerScripts = edgeStarterPlayer.children.find(
  (c) => c.className === 'StarterPlayerScripts',
)
const edgeServer = edgeBase.services.find((s) => s.className === 'ServerScriptService')

const part = (name, x) => ({
  id: newId(),
  className: 'Part',
  name,
  props: {
    Size: { type: 'Vector3', value: [4, 8, 4] },
    CFrame: { type: 'CFrame', value: { pos: [x, 4, 0], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] } },
    Anchored: { type: 'bool', value: true },
  },
  children: [],
})

const scriptInst = (className, name, src, runContext) => ({
  id: newId(),
  className,
  name,
  props: {
    Source: { type: 'ProtectedString', value: src },
    ...(runContext === undefined
      ? {}
      : {
          RunContext: {
            type: 'token',
            value: runContext,
            enumName: 'RunContext',
            itemName: runContext === 1 ? 'Server' : 'Client',
          },
        }),
  },
  children: [],
})

const treeA = part('Tree', -10)
treeA.children.push(scriptInst('Script', 'Grow', 'print("grow")\n', 1))
const treeB = part('Tree', 10)
const modules = {
  id: newId(),
  className: 'Folder',
  name: 'Modules',
  props: {},
  children: [
    scriptInst('ModuleScript', 'Util', 'return { version = 1 }\n'),
    scriptInst('Script', 'Util', 'print("also called Util")\n', 1),
  ],
}
const EDGE_SOURCE = 'local rows = {}\nif rows[1][1] then\n\tprint("]]> stays intact")\nend\n'

const edgeOps = [
  { op: 'create', parentId: edgeWorkspace.id, instance: treeA },
  { op: 'create', parentId: edgeWorkspace.id, instance: treeB },
  { op: 'create', parentId: edgeReplicated.id, instance: modules },
  {
    op: 'create',
    parentId: edgeStarterPlayerScripts.id,
    instance: scriptInst('LocalScript', 'Controls', 'print("client")\n'),
  },
  { op: 'create', parentId: edgeServer.id, instance: scriptInst('Script', 'Edge', EDGE_SOURCE, 1) },
]

const edgeValidated = validateOps(reflection, edgeBase, edgeOps)
eq(edgeValidated.errors.length, 0, `edge validateOps: ${edgeValidated.errors.join(' | ')}`)
const edgeApplied = applyPatchOps(edgeBase, edgeValidated.ok)
eq(edgeApplied.errors.length, 0, `edge applyPatchOps: ${edgeApplied.errors.join(' | ')}`)

const edgeFiles = projectFromTree(edgeApplied.tree, 'Edge Cases')
const edgeProject = JSON.parse(edgeFiles['default.project.json'])
eq(
  edgeProject.tree.ReplicatedStorage.Modules.Util.$path,
  'src/ReplicatedStorage/Modules/Util.luau',
  'ModuleScript under a Folder becomes a real file',
)
ok(
  edgeFiles['src/ServerScriptService/Edge.server.luau'] === EDGE_SOURCE,
  'script file content is byte-identical',
)
const modulesModel = JSON.parse(edgeFiles['src/ReplicatedStorage/Modules.model.json'])
eq(modulesModel.className, 'Folder', 'Folder spine node keeps its class')
eq(
  modulesModel.children.filter((c) => c.name === 'Util').length,
  1,
  'the colliding second Util is emitted inline instead of overwriting the first',
)
const edgeWorkspaceModel = JSON.parse(edgeFiles['src/Workspace.model.json'])
eq(
  edgeWorkspaceModel.children.filter((c) => c.name === 'Tree').length,
  2,
  'duplicate sibling names survive the projection',
)

await rm(EDGE_DIR, { recursive: true, force: true })
await mkdir(EDGE_DIR, { recursive: true })
await writeFile(path.join(EDGE_DIR, 'tree.json'), JSON.stringify(edgeApplied.tree))
await writeFile(path.join(EDGE_DIR, 'project.json'), JSON.stringify({ id: EDGE_ID, name: 'Edge Cases' }))
const edgePlace = await buildPlace(EDGE_ID, 'rbxlx')
ok(edgePlace.bytes > 0, 'edge place built')

if (existsSync(lune)) {
  const edgeVerifyPath = path.join(EDGE_DIR, 'build', 'verify.luau')
  await writeFile(
    edgeVerifyPath,
    `local fs = require("@lune/fs")
local roblox = require("@lune/roblox")

local failures = {}
local function check(condition, message)
	if not condition then
		table.insert(failures, message)
	end
end

local place = roblox.deserializePlace(fs.readFile(${JSON.stringify(edgePlace.filePath)}))
local workspace = place:GetService("Workspace")

local trees = 0
for _, child in workspace:GetChildren() do
	if child.Name == "Tree" then
		trees += 1
	end
end
check(trees == 2, "expected 2 instances named Tree, found " .. trees)

local grow = nil
for _, child in workspace:GetChildren() do
	if child.Name == "Tree" and child:FindFirstChild("Grow") then
		grow = child:FindFirstChild("Grow")
	end
end
check(grow ~= nil, "Script nested under a Part was lost")
if grow then
	check(grow.ClassName == "Script", "nested script class " .. grow.ClassName)
	check(string.find(grow.Source, "grow") ~= nil, "nested script source")
end

local modules = place:GetService("ReplicatedStorage"):FindFirstChild("Modules")
check(modules ~= nil, "Modules folder missing")
if modules then
	local names = 0
	local moduleScript, plainScript = nil, nil
	for _, child in modules:GetChildren() do
		if child.Name == "Util" then
			names += 1
			if child.ClassName == "ModuleScript" then
				moduleScript = child
			elseif child.ClassName == "Script" then
				plainScript = child
			end
		end
	end
	check(names == 2, "expected both Util scripts, found " .. names)
	check(moduleScript ~= nil, "ModuleScript Util missing")
	check(plainScript ~= nil, "Script Util missing")
end

local controls = place:GetService("StarterPlayer"):FindFirstChild("StarterPlayerScripts"):FindFirstChild("Controls")
check(controls ~= nil, "LocalScript missing")
if controls then
	check(controls.ClassName == "LocalScript", "expected a LocalScript, got " .. controls.ClassName)
end

local edge = place:GetService("ServerScriptService"):FindFirstChild("Edge")
check(edge ~= nil, "Edge script missing")
if edge then
	check(edge.Source == ${JSON.stringify(EDGE_SOURCE)}, "]]> in Luau source did not round-trip")
end

if #failures > 0 then
	for _, message in failures do
		print("FAIL " .. message)
	end
	error(\`lune verify: {#failures} failed assertion(s)\`)
end

print("lune verify (edge cases): all assertions passed")
`,
  )
  try {
    const { stdout } = await execFileP(lune, ['run', edgeVerifyPath], { cwd: ROOT })
    process.stdout.write(stdout)
    ok(stdout.includes('all assertions passed'), 'edge-case lune verify reported success')
  } catch (err) {
    failures.push(`edge-case lune verify failed:\n${(err.stderr || err.stdout || err.message).trim()}`)
  }
}

// --- 7. rich property types --------------------------------------------------
// UI, particles, attributes and tags: the types that used to be silently
// skipped. Every one is checked all the way into a real place file, not just
// accepted by the validator.

section('rich property types')
const RICH_ID = 'engine-test-rich'
const RICH_DIR = path.join(ROOT, 'data', 'projects', RICH_ID)

const richBase = defaultBaseplateTree()
const richWorkspace = richBase.services.find((s) => s.className === 'Workspace')
const richStarterGui = richBase.services.find((s) => s.className === 'StarterGui')

const hud = {
  id: newId(),
  className: 'ScreenGui',
  name: 'HUD',
  props: { ResetOnSpawn: { type: 'bool', value: false } },
  children: [
    {
      id: newId(),
      className: 'Frame',
      name: 'Panel',
      props: {
        Size: { type: 'UDim2', value: [[0.5, 0], [0, 120]] },
        Position: { type: 'UDim2', value: [[0.5, 0], [0, 24]] },
        AnchorPoint: { type: 'Vector2', value: [0.5, 0] },
        BackgroundColor3: { type: 'Color3', value: [0.09, 0.09, 0.11] },
        BackgroundTransparency: { type: 'float', value: 0.15 },
      },
      children: [
        {
          id: newId(),
          className: 'UICorner',
          name: 'Corner',
          props: { CornerRadius: { type: 'UDim', value: [0, 12] } },
          children: [],
        },
        {
          id: newId(),
          className: 'UIListLayout',
          name: 'Layout',
          props: { Padding: { type: 'UDim', value: [0, 8] } },
          children: [],
        },
        {
          id: newId(),
          className: 'TextLabel',
          name: 'Score',
          props: {
            Size: { type: 'UDim2', value: [[1, -16], [0, 48]] },
            Text: { type: 'string', value: 'Score: 0' },
            TextScaled: { type: 'bool', value: true },
            TextColor3: { type: 'Color3', value: [1, 1, 1] },
            BackgroundTransparency: { type: 'float', value: 1 },
            FontFace: {
              type: 'Font',
              value: { family: 'rbxasset://fonts/families/BuilderSans.json', weight: 'Bold', style: 'Normal' },
            },
          },
          children: [],
        },
        {
          id: newId(),
          className: 'ImageLabel',
          name: 'Badge',
          props: {
            Size: { type: 'UDim2', value: [[0, 64], [0, 64]] },
            SliceCenter: { type: 'Rect', value: [[4, 4], [12, 12]] },
            ImageRectSize: { type: 'Vector2', value: [64, 64] },
          },
          children: [],
        },
      ],
    },
  ],
}

const coin = {
  id: newId(),
  className: 'Part',
  name: 'Coin',
  props: {
    Size: { type: 'Vector3', value: [2, 2, 0.4] },
    CFrame: { type: 'CFrame', value: { pos: [0, 5, -12], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] } },
    Anchored: { type: 'bool', value: true },
    CustomPhysicalProperties: {
      type: 'PhysicalProperties',
      value: {
        density: 2,
        friction: 0.4,
        elasticity: 0.6,
        frictionWeight: 1,
        elasticityWeight: 1,
        acousticAbsorption: 1,
      },
    },
  },
  attributes: {
    Points: { type: 'double', value: 5 },
    Rarity: { type: 'string', value: 'gold' },
  },
  tags: ['Coin', 'Collectible'],
  children: [
    {
      id: newId(),
      className: 'ParticleEmitter',
      name: 'Shine',
      props: {
        Rate: { type: 'float', value: 12 },
        Lifetime: { type: 'NumberRange', value: [0.4, 0.9] },
        Speed: { type: 'NumberRange', value: [1, 3] },
        Size: {
          type: 'NumberSequence',
          value: [
            { time: 0, value: 0.6, envelope: 0 },
            { time: 1, value: 0, envelope: 0 },
          ],
        },
        Transparency: {
          type: 'NumberSequence',
          value: [
            { time: 0, value: 0, envelope: 0 },
            { time: 1, value: 1, envelope: 0 },
          ],
        },
        Color: {
          type: 'ColorSequence',
          value: [
            { time: 0, color: [1, 0.85, 0.2] },
            { time: 1, color: [1, 0.4, 0] },
          ],
        },
      },
      children: [],
    },
  ],
}

const richOps = [
  { op: 'create', parentId: richStarterGui.id, instance: hud },
  { op: 'create', parentId: richWorkspace.id, instance: coin },
]

const richValidated = validateOps(reflection, richBase, richOps)
eq(richValidated.errors.length, 0, `rich validateOps: ${richValidated.errors.join(' | ')}`)
eq(richValidated.ok.length, 2, 'both rich subtrees survived validation')

// A sequence that does not start at 0 and end at 1 is a Roblox error, not ours.
const badSequence = validateOps(reflection, richBase, [
  {
    op: 'create',
    parentId: richWorkspace.id,
    instance: {
      id: newId(),
      className: 'ParticleEmitter',
      name: 'Bad',
      props: {
        Transparency: {
          type: 'NumberSequence',
          value: [
            { time: 0.2, value: 0, envelope: 0 },
            { time: 0.8, value: 1, envelope: 0 },
          ],
        },
      },
      children: [],
    },
  },
])
ok(
  badSequence.errors.some((e) => e.includes('must start at time 0 and end at time 1')),
  'a malformed NumberSequence is caught with a fixable message',
)
// The emitter itself still lands — partial failure stays partial.
eq(badSequence.ok.length, 1, 'the bad keypoint list is dropped, the instance is kept')

const richApplied = applyPatchOps(richBase, richValidated.ok)
eq(richApplied.errors.length, 0, `rich applyPatchOps: ${richApplied.errors.join(' | ')}`)

const richIndex = indexTree(richApplied.tree)
const storedCoin = [...richIndex.values()].find((e) => e.inst.name === 'Coin').inst
eq(storedCoin.tags.join(','), 'Coin,Collectible', 'tags survive the tree round trip')
eq(storedCoin.attributes.Points.value, 5, 'attributes survive the tree round trip')

// The outline is what the model re-reads; UI has to be legible in it.
const richOutline = outline(richApplied.tree)
ok(richOutline.includes('size=50%,120'), `UDim2 size in the outline:\n${richOutline}`)
ok(richOutline.includes('tags=Coin+Collectible'), 'tags in the outline')
ok(richOutline.includes('attrs=Points+Rarity'), 'attributes in the outline')

const richFiles = projectFromTree(richApplied.tree, 'Rich Types')
const guiModel = JSON.parse(richFiles['src/StarterGui.model.json'])
const panelNode = guiModel.children[0].children[0]
eq(
  JSON.stringify(panelNode.properties.Size),
  JSON.stringify({ UDim2: [[0.5, 0], [0, 120]] }),
  'UDim2 projects to Rojo explicit form',
)
const richWorkspaceModel = JSON.parse(richFiles['src/Workspace.model.json'])
const coinNode = richWorkspaceModel.children.find((c) => c.name === 'Coin')
eq(JSON.stringify(coinNode.properties.Tags), JSON.stringify({ Tags: ['Coin', 'Collectible'] }), 'tags project')
eq(JSON.stringify(coinNode.attributes.Points), JSON.stringify({ Float64: 5 }), 'attributes project')
ok(
  coinNode.properties.CustomPhysicalProperties.PhysicalProperties.acousticAbsorption === 1,
  'PhysicalProperties keeps all six fields rbx-dom requires',
)

await rm(RICH_DIR, { recursive: true, force: true })
await mkdir(RICH_DIR, { recursive: true })
await writeFile(path.join(RICH_DIR, 'tree.json'), JSON.stringify(richApplied.tree))
await writeFile(path.join(RICH_DIR, 'project.json'), JSON.stringify({ id: RICH_ID, name: 'Rich Types' }))
const richPlace = await buildPlace(RICH_ID, 'rbxlx')
ok(richPlace.bytes > 0, 'rich place built with the real rojo binary')

const richXml = await readFile(richPlace.filePath, 'utf8')
ok(richXml.includes('<UDim2 name="Size">'), 'the place file really contains a UDim2')
ok(richXml.includes('<Font name="FontFace">'), 'the place file really contains a Font')
ok(richXml.includes('<NumberSequence name="Transparency">'), 'the place file really contains a NumberSequence')
ok(richXml.includes('<ColorSequence name="Color">'), 'the place file really contains a ColorSequence')
ok(richXml.includes('<NumberRange name="Lifetime">'), 'the place file really contains a NumberRange')
ok(richXml.includes('<Rect2D name="SliceCenter">'), 'the place file really contains a Rect')
ok(richXml.includes('<PhysicalProperties name="CustomPhysicalProperties">'), 'the place file really contains PhysicalProperties')
// rbx-dom serializes UICorner.CornerRadius as the four per-corner radii; Lune
// has no default for the virtual property, so the file is the source of truth.
ok(richXml.includes('<UDim name="TopLeftRadius">'), 'UICorner radius reaches the place file')

if (existsSync(lune)) {
  const richVerifyPath = path.join(RICH_DIR, 'build', 'verify.luau')
  await writeFile(
    richVerifyPath,
    `local fs = require("@lune/fs")
local roblox = require("@lune/roblox")
local UDim = roblox.UDim
local UDim2 = roblox.UDim2
local Vector2 = roblox.Vector2
local NumberRange = roblox.NumberRange

local failures = {}
local function check(condition, message)
	if not condition then
		table.insert(failures, message)
	end
end

local place = roblox.deserializePlace(fs.readFile(${JSON.stringify(richPlace.filePath)}))

local panel = place:GetService("StarterGui"):FindFirstChild("HUD"):FindFirstChild("Panel")
check(panel ~= nil, "Frame missing from StarterGui")
check(panel.Size == UDim2.new(0.5, 0, 0, 120), "Frame.Size " .. tostring(panel.Size))
check(panel.Position == UDim2.new(0.5, 0, 0, 24), "Frame.Position " .. tostring(panel.Position))
check(panel.AnchorPoint == Vector2.new(0.5, 0), "Frame.AnchorPoint " .. tostring(panel.AnchorPoint))

local label = panel:FindFirstChild("Score")
check(label ~= nil, "TextLabel missing")
check(label.Text == "Score: 0", "TextLabel.Text " .. tostring(label.Text))
check(label.TextScaled == true, "TextLabel.TextScaled")
check(
	string.find(tostring(label.FontFace.Family), "BuilderSans") ~= nil,
	"TextLabel.FontFace family " .. tostring(label.FontFace.Family)
)
check(tostring(label.FontFace.Weight) == "Enum.FontWeight.Bold", "FontFace weight " .. tostring(label.FontFace.Weight))

check(panel:FindFirstChild("Corner") ~= nil, "UICorner missing")
check(panel:FindFirstChild("Layout").Padding == UDim.new(0, 8), "UIListLayout.Padding")

local coin = place:GetService("Workspace"):FindFirstChild("Coin")
check(coin ~= nil, "Coin missing")
check(coin:GetAttribute("Points") == 5, "Coin attribute Points " .. tostring(coin:GetAttribute("Points")))
check(coin:GetAttribute("Rarity") == "gold", "Coin attribute Rarity " .. tostring(coin:GetAttribute("Rarity")))
local tags = coin:GetTags()
table.sort(tags)
check(table.concat(tags, ",") == "Coin,Collectible", "Coin tags " .. table.concat(tags, ","))

local shine = coin:FindFirstChild("Shine")
check(shine ~= nil, "ParticleEmitter missing")
check(shine.Lifetime == NumberRange.new(0.4, 0.9), "emitter Lifetime " .. tostring(shine.Lifetime))
check(#shine.Transparency.Keypoints == 2, "emitter Transparency keypoints")
check(shine.Transparency.Keypoints[2].Value == 1, "emitter fades out")
check(#shine.Color.Keypoints == 2, "emitter Color keypoints")

if #failures > 0 then
	for _, message in failures do
		print("FAIL " .. message)
	end
	error(\`lune verify: {#failures} failed assertion(s)\`)
end

print("lune verify (rich types): all assertions passed")
`,
  )
  try {
    const { stdout } = await execFileP(lune, ['run', richVerifyPath], { cwd: ROOT })
    process.stdout.write(stdout)
    ok(stdout.includes('all assertions passed'), 'rich-type lune verify reported success')
  } catch (err) {
    failures.push(`rich-type lune verify failed:\n${(err.stderr || err.stdout || err.message).trim()}`)
  }
}

// --- report ------------------------------------------------------------------

process.stdout.write(`\n${checks - failures.length}/${checks} checks passed\n`)
if (failures.length > 0) {
  process.stdout.write(`artifacts left in ${PROJECT_DIR}, ${EDGE_DIR} and ${RICH_DIR}\n`)
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
  process.exit(1)
}
// Keep data/projects clean — these are not real user projects.
await rm(PROJECT_DIR, { recursive: true, force: true })
await rm(EDGE_DIR, { recursive: true, force: true })
await rm(RICH_DIR, { recursive: true, force: true })
process.stdout.write('engine test: OK\n')
