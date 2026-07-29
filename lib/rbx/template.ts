// Verified Roblox content: the Studio Baseplate template (exact values from
// RESEARCH.md Part 2 "Roblox Baseplate template — exact instances and property
// values") and the honest blocky NPC rig (RESEARCH.md Part 2 "R6 rig from
// documented numbers … and the honest v1 NPC").
//
// Nothing here is invented Roblox lore: every property name is a real API name,
// every template value is copied from Roblox's own Studio-authored place file,
// and the NPC's Motor6D C0/C1 values are computed arithmetically from the part
// placements we author ourselves (C0 = Part0.CFrame:Inverse() * J,
// C1 = Part1.CFrame:Inverse() * J) rather than taken from unverified R6 folklore.

import type { RbxInstance, RbxPropValue, RbxTree } from './types'
import { newId } from './tree'

// --- small typed-value helpers ---------------------------------------------

type Vec3 = [number, number, number]
type Rot = [number, number, number, number, number, number, number, number, number]

const IDENTITY: Rot = [1, 0, 0, 0, 1, 0, 0, 0, 1]

const str = (value: string): RbxPropValue => ({ type: 'string', value })
const bool = (value: boolean): RbxPropValue => ({ type: 'bool', value })
const int = (value: number): RbxPropValue => ({ type: 'int', value })
const float = (value: number): RbxPropValue => ({ type: 'float', value })
const vector3 = (value: Vec3): RbxPropValue => ({ type: 'Vector3', value: [...value] })
const color3 = (value: Vec3): RbxPropValue => ({ type: 'Color3', value: [...value] })
const rgb = (r: number, g: number, b: number): RbxPropValue =>
  color3([r / 255, g / 255, b / 255])
const token = (value: number, enumName: string, itemName: string): RbxPropValue => ({
  type: 'token',
  value,
  enumName,
  itemName,
})
const ref = (value: string | null): RbxPropValue => ({ type: 'Ref', value })
const source = (value: string): RbxPropValue => ({ type: 'ProtectedString', value })
const cframe = (pos: Vec3, rot: Rot = IDENTITY): RbxPropValue => ({
  type: 'CFrame',
  value: { pos: [...pos] as Vec3, rot: [...rot] as Rot },
})

function inst(
  className: string,
  name: string,
  props: Record<string, RbxPropValue> = {},
  children: RbxInstance[] = [],
): RbxInstance {
  return { id: newId(), className, name, props, children }
}

/** All six surfaces Smooth — the class defaults are Studs/Inlet and show bumps. */
function smoothSurfaces(): Record<string, RbxPropValue> {
  const smooth = () => token(0, 'SurfaceType', 'Smooth')
  return {
    TopSurface: smooth(),
    BottomSurface: smooth(),
    LeftSurface: smooth(),
    RightSurface: smooth(),
    FrontSurface: smooth(),
    BackSurface: smooth(),
  }
}

// --- CFrame arithmetic (used for the NPC joints) ----------------------------

interface CF {
  pos: Vec3
  rot: Rot
}

const cf = (pos: Vec3, rot: Rot = IDENTITY): CF => ({ pos: [...pos] as Vec3, rot: [...rot] as Rot })

function rotMulVec(r: Rot, v: Vec3): Vec3 {
  return [
    r[0] * v[0] + r[1] * v[1] + r[2] * v[2],
    r[3] * v[0] + r[4] * v[1] + r[5] * v[2],
    r[6] * v[0] + r[7] * v[1] + r[8] * v[2],
  ]
}

function rotMul(a: Rot, b: Rot): Rot {
  const out = new Array<number>(9)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
    }
  }
  return out as Rot
}

function rotTranspose(r: Rot): Rot {
  return [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]]
}

/** CFrame:Inverse() — rotation matrices are orthonormal, so inverse = transpose. */
function cfInverse(a: CF): CF {
  const rot = rotTranspose(a.rot)
  const pos = rotMulVec(rot, a.pos)
  return { pos: [-pos[0], -pos[1], -pos[2]], rot }
}

/** CFrame * CFrame. */
function cfMul(a: CF, b: CF): CF {
  const rotated = rotMulVec(a.rot, b.pos)
  return {
    pos: [a.pos[0] + rotated[0], a.pos[1] + rotated[1], a.pos[2] + rotated[2]],
    rot: rotMul(a.rot, b.rot),
  }
}

const toCFrameProp = (value: CF): RbxPropValue => cframe(value.pos, value.rot)

/** JointInstance semantics: C0 = Part0:Inverse() * J, C1 = Part1:Inverse() * J. */
function jointOffsets(part0: CF, part1: CF, joint: CF): { c0: CF; c1: CF } {
  return { c0: cfMul(cfInverse(part0), joint), c1: cfMul(cfInverse(part1), joint) }
}

// --- the Baseplate template -------------------------------------------------

/**
 * The exact Studio Baseplate template. Values from RESEARCH.md Part 2, which
 * extracted them from Roblox's own Studio-saved place file.
 */
export function defaultBaseplateTree(): RbxTree {
  const baseplate = inst(
    'Part',
    'Baseplate',
    {
      Size: vector3([2048, 16, 2048]),
      CFrame: cframe([0, -8, 0]),
      Anchored: bool(true),
      Locked: bool(true),
      Color: rgb(91, 91, 91),
      Material: token(256, 'Material', 'Plastic'),
      ...smoothSurfaces(),
    },
    [
      inst('Texture', 'Texture', {
        Texture: str('rbxassetid://6372755229'),
        Face: token(1, 'NormalId', 'Top'),
        StudsPerTileU: float(8),
        StudsPerTileV: float(8),
        Transparency: float(0.800000012),
        Color3: color3([0, 0, 0]),
      }),
    ],
  )

  const spawnLocation = inst(
    'SpawnLocation',
    'SpawnLocation',
    {
      Size: vector3([12, 1, 12]),
      CFrame: cframe([0, 0.5, 0]),
      Anchored: bool(true),
      Neutral: bool(true),
      Enabled: bool(true),
      Duration: int(0),
      AllowTeamChangeOnTouch: bool(false),
      Color: rgb(163, 162, 165),
      Material: token(256, 'Material', 'Plastic'),
      TopSurface: token(0, 'SurfaceType', 'Smooth'),
      BottomSurface: token(0, 'SurfaceType', 'Smooth'),
    },
    [
      inst('Decal', 'Decal', {
        Texture: str('rbxasset://textures/SpawnLocation.png'),
        Face: token(1, 'NormalId', 'Top'),
      }),
    ],
  )

  const workspace = inst(
    'Workspace',
    'Workspace',
    {
      Gravity: float(196.2),
      ExplicitAutoJoints: bool(true),
      FallenPartsDestroyHeight: float(-500),
      StreamingEnabled: bool(false),
    },
    [baseplate, spawnLocation],
  )

  const lighting = inst('Lighting', 'Lighting', {
    Ambient: color3([0.274509817, 0.274509817, 0.274509817]),
    OutdoorAmbient: color3([0.274509817, 0.274509817, 0.274509817]),
    Brightness: float(3),
    Technology: token(3, 'Technology', 'ShadowMap'),
    GlobalShadows: bool(true),
    ShadowSoftness: float(0.200000003),
    EnvironmentDiffuseScale: float(1),
    EnvironmentSpecularScale: float(1),
    ExposureCompensation: float(0),
    TimeOfDay: str('14:30:00'),
    GeographicLatitude: float(0),
    FogColor: color3([0.752941251, 0.752941251, 0.752941251]),
    FogStart: float(0),
    FogEnd: float(100000),
    ColorShift_Top: color3([0, 0, 0]),
    ColorShift_Bottom: color3([0, 0, 0]),
  })

  const players = inst('Players', 'Players', {
    RespawnTime: float(3),
    CharacterAutoLoads: bool(true),
  })

  const starterPlayer = inst('StarterPlayer', 'StarterPlayer', {}, [
    inst('StarterPlayerScripts', 'StarterPlayerScripts'),
    inst('StarterCharacterScripts', 'StarterCharacterScripts'),
  ])

  // Emit set per RESEARCH Part 2 "Playable-place requirements" — Studio fills in
  // the rest (Camera, Terrain, internal services) when the place is opened.
  return {
    formatVersion: 1,
    services: [
      workspace,
      lighting,
      inst('ReplicatedFirst', 'ReplicatedFirst'),
      inst('ReplicatedStorage', 'ReplicatedStorage'),
      inst('ServerScriptService', 'ServerScriptService'),
      inst('ServerStorage', 'ServerStorage'),
      starterPlayer,
      inst('StarterGui', 'StarterGui'),
      inst('StarterPack', 'StarterPack'),
      players,
      inst('SoundService', 'SoundService'),
      inst('Teams', 'Teams'),
    ],
  }
}

// --- the honest blocky NPC --------------------------------------------------

const WANDER_SOURCE = `-- Wander behaviour for a blocky NPC.
-- This is a simple primitive rig: it slides rather than walks, because animating
-- it would require uploaded animation assets.

local model = script.Parent
local humanoid = model:WaitForChild("Humanoid")
local rootPart = model:WaitForChild("HumanoidRootPart")

local ORIGIN = rootPart.Position
local RADIUS = 24
local PAUSE = 2
local GIVE_UP = 12

local rng = Random.new()

local function nextGoal()
	local angle = rng:NextNumber(0, math.pi * 2)
	local distance = rng:NextNumber(RADIUS * 0.25, RADIUS)
	return ORIGIN + Vector3.new(math.cos(angle) * distance, 0, math.sin(angle) * distance)
end

task.spawn(function()
	while humanoid.Health > 0 do
		local goal = nextGoal()
		local arrived = false
		local connection = humanoid.MoveToFinished:Connect(function()
			arrived = true
		end)

		local deadline = os.clock() + GIVE_UP
		while not arrived and os.clock() < deadline do
			-- Re-issued every second: Humanoid:MoveTo times out after 8 seconds.
			humanoid:MoveTo(goal)
			task.wait(1)
		end

		connection:Disconnect()
		task.wait(PAUSE)
	end
end)
`

/**
 * A blocky NPC rig — Model{ HumanoidRootPart, Torso, Head, arms, legs, Motor6D
 * joints, Humanoid, wander Script }. Honest primitive geometry, NOT an avatar:
 * avatar-grade characters need uploaded mesh assets (RESEARCH Part 2).
 *
 * `position` is the point on the ground the NPC stands on; the rig is built above it.
 */
export function blockyNpc(name: string, position: [number, number, number]): RbxInstance {
  const [px, py, pz] = position
  const at = (x: number, y: number, z: number): Vec3 => [px + x, py + y, pz + z]

  // Authored blocky proportions. Feet rest on `position`, so the legs run from
  // y+0 to y+2, the torso from y+2 to y+4 and the head from y+4 to y+5.
  const torsoCF = cf(at(0, 3, 0))
  const rootCF = cf(at(0, 3, 0))
  const headCF = cf(at(0, 4.5, 0))
  const leftArmCF = cf(at(-1.5, 3, 0))
  const rightArmCF = cf(at(1.5, 3, 0))
  const leftLegCF = cf(at(-0.5, 1, 0))
  const rightLegCF = cf(at(0.5, 1, 0))

  const skin = rgb(245, 205, 48)
  const shirt = rgb(13, 105, 172)
  const pants = rgb(40, 127, 71)

  const bodyPart = (
    partName: string,
    size: Vec3,
    frame: CF,
    color: RbxPropValue,
    extra: Record<string, RbxPropValue> = {},
  ): RbxInstance =>
    inst('Part', partName, {
      Size: vector3(size),
      CFrame: toCFrameProp(frame),
      Anchored: bool(false),
      Color: color,
      Material: token(256, 'Material', 'Plastic'),
      ...smoothSurfaces(),
      ...extra,
    })

  const rootPart = bodyPart('HumanoidRootPart', [2, 2, 1], rootCF, shirt, {
    Transparency: float(1),
    CanCollide: bool(true),
  })
  const torso = bodyPart('Torso', [2, 2, 1], torsoCF, shirt)
  const head = bodyPart('Head', [2, 1, 1], headCF, skin)
  const leftArm = bodyPart('Left Arm', [1, 2, 1], leftArmCF, skin)
  const rightArm = bodyPart('Right Arm', [1, 2, 1], rightArmCF, skin)
  const leftLeg = bodyPart('Left Leg', [1, 2, 1], leftLegCF, pants)
  const rightLeg = bodyPart('Right Leg', [1, 2, 1], rightLegCF, pants)

  const joint = (
    jointName: string,
    part0: RbxInstance,
    part0CF: CF,
    part1: RbxInstance,
    part1CF: CF,
    world: CF,
  ): RbxInstance => {
    const { c0, c1 } = jointOffsets(part0CF, part1CF, world)
    return inst('Motor6D', jointName, {
      Part0: ref(part0.id),
      Part1: ref(part1.id),
      C0: toCFrameProp(c0),
      C1: toCFrameProp(c1),
    })
  }

  // Joint world CFrames: the surface point each limb pivots around.
  rootPart.children.push(joint('RootJoint', rootPart, rootCF, torso, torsoCF, cf(at(0, 3, 0))))
  torso.children.push(
    joint('Neck', torso, torsoCF, head, headCF, cf(at(0, 4, 0))),
    joint('Left Shoulder', torso, torsoCF, leftArm, leftArmCF, cf(at(-1, 3.5, 0))),
    joint('Right Shoulder', torso, torsoCF, rightArm, rightArmCF, cf(at(1, 3.5, 0))),
    joint('Left Hip', torso, torsoCF, leftLeg, leftLegCF, cf(at(-0.5, 2, 0))),
    joint('Right Hip', torso, torsoCF, rightLeg, rightLegCF, cf(at(0.5, 2, 0))),
  )

  const humanoid = inst('Humanoid', 'Humanoid', {
    RigType: token(0, 'HumanoidRigType', 'R6'),
    MaxHealth: float(100),
    WalkSpeed: float(16),
    JumpPower: float(50),
    HipHeight: float(2),
    MaxSlopeAngle: float(89),
  })

  const wander = inst('Script', 'Wander', {
    Source: source(WANDER_SOURCE),
    RunContext: token(1, 'RunContext', 'Server'),
    Disabled: bool(false),
  })

  return inst(
    'Model',
    name,
    { PrimaryPart: ref(rootPart.id) },
    [rootPart, torso, head, leftArm, rightArm, leftLeg, rightLeg, humanoid, wander],
  )
}
