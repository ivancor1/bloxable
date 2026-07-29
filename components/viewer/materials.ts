import * as THREE from 'three'

import { detailMapsFor, studsTexture } from './proceduralTextures'

// Cached MeshStandardMaterial keyed by (Color, Material, Transparency, Reflectance).
//
// The roughness/metalness table below is RESEARCH Part 3's "Original (non-Roblox-
// sourced) PBR approximation table" -- explicitly an original design proposal, not a
// Roblox spec (Enum.Material's 44 values are official; per-value PBR numbers are
// not). D7/the brief pin this to MeshStandardMaterial specifically, so the source
// table's clearcoat/transmission suggestions (which need MeshPhysicalMaterial) are
// dropped: Glass is approximated as low-roughness + capped opacity instead of real
// transmission, and clearcoat is simply omitted everywhere. Flagged in friction.

interface MaterialParams {
  roughness: number
  metalness: number
  emissive?: boolean
  emissiveIntensity?: number
  /** Materials that are inherently see-through regardless of BasePart.Transparency
   *  (ForceField, Air, Water, Glass) -- caps opacity and forces transparent=true. */
  forceOpacity?: number
  additiveBlend?: boolean
}

const MATERIAL_PARAMS: Record<string, MaterialParams> = {
  Plastic: { roughness: 0.55, metalness: 0 },
  SmoothPlastic: { roughness: 0.25, metalness: 0 },
  Neon: { roughness: 0.4, metalness: 0, emissive: true, emissiveIntensity: 1.75 },
  Wood: { roughness: 0.75, metalness: 0 },
  WoodPlanks: { roughness: 0.75, metalness: 0 },
  Marble: { roughness: 0.35, metalness: 0 },
  Basalt: { roughness: 0.9, metalness: 0 },
  Slate: { roughness: 0.85, metalness: 0 },
  CrackedLava: { roughness: 0.8, metalness: 0 },
  Concrete: { roughness: 0.9, metalness: 0 },
  Limestone: { roughness: 0.85, metalness: 0 },
  Granite: { roughness: 0.85, metalness: 0 },
  Pavement: { roughness: 0.9, metalness: 0 },
  Brick: { roughness: 0.88, metalness: 0 },
  Pebble: { roughness: 0.9, metalness: 0 },
  Cobblestone: { roughness: 0.88, metalness: 0 },
  Rock: { roughness: 0.9, metalness: 0 },
  Sandstone: { roughness: 0.85, metalness: 0 },
  CorrodedMetal: { roughness: 0.6, metalness: 0.8 },
  DiamondPlate: { roughness: 0.3, metalness: 0.85 },
  Foil: { roughness: 0.2, metalness: 0.9 },
  Metal: { roughness: 0.35, metalness: 0.9 },
  Grass: { roughness: 0.95, metalness: 0 },
  LeafyGrass: { roughness: 0.95, metalness: 0 },
  Sand: { roughness: 0.95, metalness: 0 },
  Fabric: { roughness: 0.9, metalness: 0 },
  Snow: { roughness: 0.85, metalness: 0 },
  Mud: { roughness: 0.95, metalness: 0 },
  Ground: { roughness: 0.95, metalness: 0 },
  Asphalt: { roughness: 0.9, metalness: 0 },
  Salt: { roughness: 0.7, metalness: 0 },
  Ice: { roughness: 0.15, metalness: 0 },
  Glacier: { roughness: 0.2, metalness: 0 },
  // Glass: transparent + low roughness (approximation of RESEARCH's transmission
  // suggestion, adapted to MeshStandardMaterial per the brief).
  Glass: { roughness: 0.05, metalness: 0, forceOpacity: 0.35 },
  ForceField: { roughness: 1, metalness: 0, forceOpacity: 0.3, additiveBlend: true },
  Air: { roughness: 1, metalness: 0, forceOpacity: 0.05 },
  Water: { roughness: 0.1, metalness: 0, forceOpacity: 0.55 },
  Cardboard: { roughness: 0.9, metalness: 0 },
  Carpet: { roughness: 0.92, metalness: 0 },
  CeramicTiles: { roughness: 0.3, metalness: 0 },
  ClayRoofTiles: { roughness: 0.8, metalness: 0 },
  RoofShingles: { roughness: 0.85, metalness: 0 },
  Leather: { roughness: 0.7, metalness: 0 },
  Plaster: { roughness: 0.8, metalness: 0 },
  Rubber: { roughness: 0.9, metalness: 0 },
}

const DEFAULT_MATERIAL_PARAMS: MaterialParams = { roughness: 0.7, metalness: 0 }

function paramsFor(materialName: string | undefined): MaterialParams {
  if (!materialName) return MATERIAL_PARAMS.Plastic
  return MATERIAL_PARAMS[materialName] ?? DEFAULT_MATERIAL_PARAMS
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>()

/**
 * `repeat` > 0 opts into the procedural detail maps (proceduralTextures.ts) at
 * that tiling bucket; pass 0 for geometries without UVs (wedges) or headless
 * environments. Detail is a multiply over the part Color, so palettes hold.
 */
export function getCachedMaterial(
  color: readonly [number, number, number],
  materialName: string | undefined,
  transparency: number,
  reflectance: number,
  repeat = 0,
): THREE.MeshStandardMaterial {
  const detail = repeat > 0 ? detailMapsFor(materialName, repeat) : null
  const key = `${color[0].toFixed(4)},${color[1].toFixed(4)},${color[2].toFixed(4)}|${materialName ?? 'Plastic'}|${transparency.toFixed(3)}|${reflectance.toFixed(3)}|${detail ? repeat : 0}`
  const cached = materialCache.get(key)
  if (cached) return cached

  const params = paramsFor(materialName)
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color[0], color[1], color[2]),
    roughness: params.roughness,
    metalness: params.metalness,
  })

  if (detail) {
    mat.map = detail.map
    mat.bumpMap = detail.bumpMap
    mat.bumpScale = detail.bumpScale
  }

  // BasePart.Reflectance [0,1] -> envMapIntensity-style approximation (brief D7 /
  // RESEARCH Part 3: not literal mirror reflectivity, no env map is bound in v1 so
  // this mainly affects how strongly the scene's light probes/ambient read off it).
  mat.envMapIntensity = 1 + reflectance * 2

  if (params.emissive) {
    mat.emissive = mat.color.clone()
    mat.emissiveIntensity = params.emissiveIntensity ?? 1.5
  }

  let opacity = 1 - transparency
  let transparent = transparency > 0
  if (params.forceOpacity !== undefined) {
    opacity = Math.min(opacity, params.forceOpacity)
    transparent = true
  }
  if (params.additiveBlend) {
    mat.blending = THREE.AdditiveBlending
    mat.depthWrite = false
  }
  mat.opacity = opacity
  mat.transparent = transparent

  materialCache.set(key, mat)
  return mat
}

/**
 * Six-slot material array for a block part whose top face carries the classic
 * stud grid (the Baseplate's Texture child). BoxGeometry's material groups are
 * ordered +x,-x,+y,-y,+z,-z — index 2 is the top. The stud texture becomes the
 * top face's map (multiplied by the part color, like the real translucent
 * overlay reads against the gray plate).
 */
const studdedSetCache = new Map<string, THREE.Material[]>()

export function getStuddedTopMaterials(
  color: readonly [number, number, number],
  materialName: string | undefined,
  transparency: number,
  reflectance: number,
  repeat: number,
): THREE.Material[] | null {
  const studs = studsTexture(repeat)
  if (!studs) return null
  const key = `${color.join(',')}|${materialName ?? 'Plastic'}|${transparency.toFixed(3)}|${reflectance.toFixed(3)}|${repeat}`
  const cached = studdedSetCache.get(key)
  if (cached) return cached

  const base = getCachedMaterial(color, materialName, transparency, reflectance, 0)
  const top = base.clone()
  top.map = studs
  top.needsUpdate = true
  const set = [base, base, top, base, base, base]
  studdedSetCache.set(key, set)
  return set
}

// Selection highlight: a single shared unlit BackSide material (RESEARCH Part 3's
// recommended object-space outline-mesh technique; DESIGN.md accent — the light
// system's indigo #2C4FF0). Only one instance is ever selected at a time
// (AppState.selectionId is a single id), so one shared mesh+material suffices --
// see sceneSync.ts.
export const outlineMaterial = new THREE.MeshBasicMaterial({
  color: 0x2c4ff0,
  side: THREE.BackSide,
  toneMapped: false,
  depthWrite: true,
})

// SpawnLocation's "subtle distinct top face" marker -- a plain unlit translucent
// plane, deliberately not the reserved accent color (DESIGN.md reserves accent for
// primary action / selection / focus only).
export const spawnMarkerMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
  toneMapped: false,
})
