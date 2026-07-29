import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import type { RbxInstance, RbxTree } from '@/lib/rbx/types'
import {
  blockGeometry,
  geometryForKind,
  shapeScaleVector,
  spawnTopMarkerGeometry,
  type PartKind,
} from './geometry'
import { getCachedMaterial, outlineMaterial, spawnMarkerMaterial } from './materials'
import {
  cframeToMatrix4,
  getBool,
  getCFrame,
  getColor3,
  getFloat,
  getToken,
  getVector3,
  resolvePartColorRGB,
  resolvePartShape,
} from './rbxProps'

// RectAreaLight (used for SurfaceLight) needs its LTC uniforms table initialized
// once before any instance renders correctly.
RectAreaLightUniformsLib.init()

const LIGHT_CLASSES = new Set(['PointLight', 'SpotLight', 'SurfaceLight'])
const PART_CLASSES = new Set(['Part', 'WedgePart', 'CornerWedgePart', 'TrussPart'])

// Tuning constants, not verified Roblox facts -- three.js punctual lights use
// candela-scale physically-based intensity; Roblox's Brightness has no published
// unit conversion, so these are empirically reasonable multipliers ("reasonable
// mapping" per the brief), not a spec.
const LIGHT_INTENSITY_SCALE = 18
const SURFACE_LIGHT_INTENSITY_SCALE = 3
const SURFACE_LIGHT_SIZE = 4

const FACE_NORMALS: Record<string, THREE.Vector3> = {
  Top: new THREE.Vector3(0, 1, 0),
  Bottom: new THREE.Vector3(0, -1, 0),
  Left: new THREE.Vector3(-1, 0, 0),
  Right: new THREE.Vector3(1, 0, 0),
  Front: new THREE.Vector3(0, 0, -1),
  Back: new THREE.Vector3(0, 0, 1),
}
// SpotLight/SurfaceLight.Face default assumed Front (-Z) -- RESEARCH Part 3 did not
// cover NormalId/Face defaults, so this is a disclosed, unverified assumption.
function faceNormal(itemName: string | undefined): THREE.Vector3 {
  return (itemName && FACE_NORMALS[itemName]) || FACE_NORMALS.Front
}

function partKindForInstance(inst: RbxInstance, previous?: PartKind): PartKind {
  switch (inst.className) {
    case 'Part':
      return resolvePartShape(inst)
    case 'WedgePart':
      return 'wedge'
    case 'CornerWedgePart':
      return 'cornerWedge'
    case 'TrussPart':
      return 'truss'
    case 'SpawnLocation':
      return 'block'
    default:
      return previous ?? 'block'
  }
}

/** Cheap change-detection signature covering every prop this module reads. Recomputed
 *  once per instance per sync() pass; when unchanged, the entry's visuals are left
 *  untouched (the actual diff-sync -- see SceneSync.refreshEntry). */
function computeSig(inst: RbxInstance): string {
  const cf = getCFrame(inst)
  const size = getVector3(inst, 'Size', [4, 1.2, 2])
  const color = resolvePartColorRGB(inst)
  const material = getToken(inst, 'Material')?.itemName ?? ''
  const shapeToken = getToken(inst, 'Shape')
  const shape = shapeToken?.itemName ?? shapeToken?.value ?? ''
  const transparency = getFloat(inst, 'Transparency', 0)
  const reflectance = getFloat(inst, 'Reflectance', 0)
  const enabled = getBool(inst, 'Enabled', true)
  const brightness = getFloat(inst, 'Brightness', 1)
  const range = getFloat(inst, 'Range', 8)
  const angle = getFloat(inst, 'Angle', 90)
  const face = getToken(inst, 'Face')?.itemName ?? ''
  const lightColor = getColor3(inst, 'Color', [1, 1, 1])
  const shadows = getBool(inst, 'Shadows', false)
  return JSON.stringify([
    cf.pos, cf.rot, size, color, material, shape, transparency, reflectance,
    enabled, brightness, range, angle, face, lightColor, shadows,
  ])
}

interface CacheEntry {
  id: string
  className: string
  object3D: THREE.Object3D
  kind: 'part' | 'group' | 'light'
  partKind?: PartKind
  sig: string
}

/**
 * Maintains an id -> Object3D cache and diff-syncs it against the current RbxTree on
 * every treeVersion bump (see ARCHITECTURE D7 / lib/state/store.ts). Only Workspace's
 * subtree is rendered -- other services (Lighting, ReplicatedStorage, ...) never
 * appear in the 3D world in real Roblox either; Lighting is instead read separately
 * by lighting.ts for the light rig.
 *
 * IMPORTANT Roblox semantics this sync relies on: BasePart.CFrame is always WORLD
 * space, never relative to a parent Instance (unlike a typical scene-graph engine).
 * So while Model/Folder instances become plain identity-matrix THREE.Group containers
 * (safe to nest, since identity composes losslessly), a Part-family instance's
 * *Part-family/Model/Folder* children (rare, but structurally legal) must skip past
 * that mesh's own baked CFrame*Size matrix and attach at the nearest true world
 * anchor instead -- otherwise they would be double-transformed by the parent's
 * matrix. The only children that legitimately inherit a parent Part's transform are
 * PointLight/SpotLight/SurfaceLight (they have no CFrame of their own in real
 * Roblox -- they take their position from the part they're parented to).
 */
export class SceneSync {
  private readonly cache = new Map<string, CacheEntry>()
  private raycastTargetsCache: THREE.Object3D[] = []
  private unsupportedSummary = ''

  readonly workspaceRoot: THREE.Group
  readonly outlineMesh: THREE.Mesh

  constructor(private readonly scene: THREE.Scene) {
    this.workspaceRoot = new THREE.Group()
    this.workspaceRoot.name = 'Workspace'
    this.workspaceRoot.matrixAutoUpdate = false
    scene.add(this.workspaceRoot)

    this.outlineMesh = new THREE.Mesh(blockGeometry, outlineMaterial)
    this.outlineMesh.matrixAutoUpdate = false
    this.outlineMesh.visible = false
    this.outlineMesh.castShadow = false
    this.outlineMesh.receiveShadow = false
    this.outlineMesh.raycast = () => {}
    scene.add(this.outlineMesh)
  }

  get raycastTargets(): THREE.Object3D[] {
    return this.raycastTargetsCache
  }

  idForObject3D(object: THREE.Object3D): string | undefined {
    return object.userData.rbxId as string | undefined
  }

  /** Diff-sync entry point: walks Workspace's subtree, creating/updating/reparenting
   *  entries in place; anything not visited this pass is removed. Full rebuild would
   *  also be correct but is not what this does -- unchanged instances are left alone
   *  (see refreshEntry's sig short-circuit). */
  sync(tree: RbxTree | null) {
    const workspace = tree?.services.find((s) => s.className === 'Workspace')
    const visited = new Set<string>()
    const unsupported = new Map<string, number>()

    if (workspace) {
      for (const child of workspace.children) {
        this.syncInstance(child, this.workspaceRoot, this.workspaceRoot, visited, unsupported)
      }
    }

    for (const [id, entry] of this.cache) {
      if (!visited.has(id)) {
        entry.object3D.parent?.remove(entry.object3D)
        this.cache.delete(id)
      }
    }

    this.raycastTargetsCache = []
    for (const entry of this.cache.values()) {
      if (entry.kind === 'part') this.raycastTargetsCache.push(entry.object3D)
    }

    this.logUnsupported(unsupported)
  }

  /** Repositions/reshapes the shared selection-outline mesh to match `id`, or hides
   *  it. Cheap enough to call unconditionally after every sync() + on every
   *  selection change. */
  setSelection(id: string | null) {
    const entry = id ? this.cache.get(id) : undefined
    if (!entry || entry.kind !== 'part') {
      this.outlineMesh.visible = false
      return
    }
    const mesh = entry.object3D as THREE.Mesh
    this.outlineMesh.geometry = mesh.geometry
    this.outlineMesh.matrix.copy(mesh.matrix).scale(new THREE.Vector3(1.04, 1.04, 1.04))
    this.outlineMesh.matrixWorldNeedsUpdate = true
    this.outlineMesh.visible = true
  }

  dispose() {
    this.scene.remove(this.workspaceRoot, this.outlineMesh)
    this.cache.clear()
    this.raycastTargetsCache = []
  }

  private syncInstance(
    inst: RbxInstance,
    worldParent: THREE.Object3D,
    localParent: THREE.Object3D,
    visited: Set<string>,
    unsupported: Map<string, number>,
  ) {
    visited.add(inst.id)
    const isLight = LIGHT_CLASSES.has(inst.className)
    const attachTo = isLight ? localParent : worldParent

    let entry = this.cache.get(inst.id)
    if (!entry) {
      entry = this.createEntry(inst)
      if (!entry) unsupported.set(inst.className, (unsupported.get(inst.className) ?? 0) + 1)
    } else {
      this.refreshEntry(entry, inst)
    }

    if (entry) {
      if (entry.object3D.parent !== attachTo) attachTo.add(entry.object3D)
      this.cache.set(inst.id, entry)
    }

    const nextWorldParent = entry && entry.kind === 'group' ? entry.object3D : worldParent
    const nextLocalParent = entry ? entry.object3D : localParent

    for (const child of inst.children) {
      this.syncInstance(child, nextWorldParent, nextLocalParent, visited, unsupported)
    }
  }

  private logUnsupported(unsupported: Map<string, number>) {
    if (unsupported.size === 0) return
    const summary = [...unsupported.entries()].map(([cls, n]) => `${cls}x${n}`).sort().join(',')
    if (summary === this.unsupportedSummary) return
    this.unsupportedSummary = summary
    const total = [...unsupported.values()].reduce((a, b) => a + b, 0)
    console.debug(`[viewer] skipped ${total} unsupported instance(s):`, Object.fromEntries(unsupported))
  }

  private createEntry(inst: RbxInstance): CacheEntry | undefined {
    const built = this.buildObject3D(inst)
    if (!built) return undefined
    built.object3D.userData.rbxId = inst.id
    const entry: CacheEntry = {
      id: inst.id,
      className: inst.className,
      object3D: built.object3D,
      kind: built.kind,
      partKind: built.partKind,
      sig: '',
    }
    this.applyVisuals(entry, inst)
    return entry
  }

  private refreshEntry(entry: CacheEntry, inst: RbxInstance) {
    const sig = computeSig(inst)
    if (sig === entry.sig) return
    this.applyVisuals(entry, inst)
  }

  private buildObject3D(
    inst: RbxInstance,
  ): { object3D: THREE.Object3D; kind: CacheEntry['kind']; partKind?: PartKind } | undefined {
    if (inst.className === 'Model' || inst.className === 'Folder') {
      const group = new THREE.Group()
      group.name = inst.name
      group.matrixAutoUpdate = false // Models/Folders carry no transform -- BasePart CFrames are world-space
      return { object3D: group, kind: 'group' }
    }
    if (PART_CLASSES.has(inst.className)) {
      return { object3D: this.makePartMesh(), kind: 'part' }
    }
    if (inst.className === 'SpawnLocation') {
      const mesh = this.makePartMesh()
      const marker = new THREE.Mesh(spawnTopMarkerGeometry, spawnMarkerMaterial)
      marker.matrixAutoUpdate = false
      marker.castShadow = false
      marker.receiveShadow = false
      marker.raycast = () => {}
      mesh.add(marker)
      return { object3D: mesh, kind: 'part', partKind: 'block' }
    }
    if (inst.className === 'PointLight') {
      return { object3D: new THREE.PointLight(), kind: 'light' }
    }
    if (inst.className === 'SpotLight') {
      const light = new THREE.SpotLight()
      light.add(light.target)
      return { object3D: light, kind: 'light' }
    }
    if (inst.className === 'SurfaceLight') {
      const light = new THREE.RectAreaLight(0xffffff, 1, SURFACE_LIGHT_SIZE, SURFACE_LIGHT_SIZE)
      return { object3D: light, kind: 'light' }
    }
    return undefined
  }

  private makePartMesh(): THREE.Mesh {
    const mesh = new THREE.Mesh(blockGeometry)
    mesh.matrixAutoUpdate = false
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }

  private applyVisuals(entry: CacheEntry, inst: RbxInstance) {
    if (entry.kind === 'part') {
      const mesh = entry.object3D as THREE.Mesh
      const kind = partKindForInstance(inst, entry.partKind)
      if (kind !== entry.partKind) {
        mesh.geometry = geometryForKind(kind)
        entry.partKind = kind
      }

      const cf = getCFrame(inst)
      const size = getVector3(inst, 'Size', [4, 1.2, 2])
      const m = cframeToMatrix4(cf).scale(shapeScaleVector(kind, size))
      mesh.matrix.copy(m)
      mesh.matrixWorldNeedsUpdate = true

      const color = resolvePartColorRGB(inst)
      const materialName = getToken(inst, 'Material')?.itemName
      const transparency = getFloat(inst, 'Transparency', 0)
      const reflectance = getFloat(inst, 'Reflectance', 0)
      mesh.material = getCachedMaterial(color, materialName, transparency, reflectance)
    } else if (entry.kind === 'light') {
      this.applyLightVisuals(entry, inst)
    }
    entry.sig = computeSig(inst)
  }

  private applyLightVisuals(entry: CacheEntry, inst: RbxInstance) {
    const color = getColor3(inst, 'Color', [1, 1, 1])
    const brightness = getFloat(inst, 'Brightness', 1)
    const enabled = getBool(inst, 'Enabled', true)
    const shadows = getBool(inst, 'Shadows', false)
    const threeColor = new THREE.Color(color[0], color[1], color[2])

    if (entry.className === 'PointLight' || entry.className === 'SpotLight') {
      const light = entry.object3D as THREE.PointLight | THREE.SpotLight
      const range = getFloat(inst, 'Range', 8)
      light.color.copy(threeColor)
      light.intensity = brightness * LIGHT_INTENSITY_SCALE
      light.distance = range
      light.decay = 2
      light.visible = enabled
      light.castShadow = shadows
      light.shadow.mapSize.set(512, 512)
      light.position.set(0, 0, 0)

      if (entry.className === 'SpotLight') {
        const spot = light as THREE.SpotLight
        const angleDeg = getFloat(inst, 'Angle', 90)
        spot.angle = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(angleDeg / 2, 1, 89))
        spot.penumbra = 0.4
        spot.target.position.copy(faceNormal(getToken(inst, 'Face')?.itemName))
      }
    } else if (entry.className === 'SurfaceLight') {
      const light = entry.object3D as THREE.RectAreaLight
      light.color.copy(threeColor)
      light.intensity = brightness * SURFACE_LIGHT_INTENSITY_SCALE
      light.visible = enabled
      light.position.set(0, 0, 0)
      const normal = faceNormal(getToken(inst, 'Face')?.itemName)
      light.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), normal)
    }
  }
}
