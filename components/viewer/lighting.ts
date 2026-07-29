import * as THREE from 'three'
import type { RbxTree } from '@/lib/rbx/types'
import { getBool, getColor3, getFloat } from './rbxProps'

export interface LightingConfig {
  ambient: [number, number, number]
  outdoorAmbient: [number, number, number]
  brightness: number
  colorShiftTop: [number, number, number]
  colorShiftBottom: [number, number, number]
  clockTime: number // 0..24
  fogColor: [number, number, number]
  fogStart: number
  fogEnd: number
  globalShadows: boolean
}

// Baseplate template Lighting values, verified against Roblox's own
// DialogSystem.rbxlx (RESEARCH Part 2, "Roblox Baseplate template -- exact instances
// and property values" [OFFICIAL]). Used whenever the tree has no Lighting service
// yet, or a value it doesn't set.
export const DEFAULT_LIGHTING: LightingConfig = {
  ambient: [0.274509817, 0.274509817, 0.274509817],
  outdoorAmbient: [0.274509817, 0.274509817, 0.274509817],
  brightness: 3,
  colorShiftTop: [0, 0, 0],
  colorShiftBottom: [0, 0, 0],
  clockTime: 14.5, // "14:30:00"
  fogColor: [0.752941251, 0.752941251, 0.752941251],
  fogStart: 0,
  fogEnd: 100000,
  globalShadows: true,
}

function parseTimeOfDay(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  return Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600
}

/** Reads the tree's Lighting service (if the AI/template has added one) and layers
 *  its values over the verified Baseplate defaults -- keeps the rig reactive to
 *  AI-driven Lighting edits instead of a static one-time snapshot. */
export function readLightingConfig(tree: RbxTree | null): LightingConfig {
  const cfg: LightingConfig = { ...DEFAULT_LIGHTING }
  const svc = tree?.services.find((s) => s.className === 'Lighting')
  if (!svc) return cfg

  cfg.ambient = getColor3(svc, 'Ambient', cfg.ambient)
  cfg.outdoorAmbient = getColor3(svc, 'OutdoorAmbient', cfg.outdoorAmbient)
  cfg.brightness = getFloat(svc, 'Brightness', cfg.brightness)
  cfg.colorShiftTop = getColor3(svc, 'ColorShift_Top', cfg.colorShiftTop)
  cfg.colorShiftBottom = getColor3(svc, 'ColorShift_Bottom', cfg.colorShiftBottom)
  cfg.fogColor = getColor3(svc, 'FogColor', cfg.fogColor)
  cfg.fogStart = getFloat(svc, 'FogStart', cfg.fogStart)
  cfg.fogEnd = getFloat(svc, 'FogEnd', cfg.fogEnd)
  cfg.globalShadows = getBool(svc, 'GlobalShadows', cfg.globalShadows)

  const clockTimeProp = svc.props['ClockTime']
  if (clockTimeProp && (clockTimeProp.type === 'float' || clockTimeProp.type === 'double')) {
    cfg.clockTime = clockTimeProp.value
  } else {
    const timeOfDay = svc.props['TimeOfDay']
    if (timeOfDay?.type === 'string') {
      const parsed = parseTimeOfDay(timeOfDay.value)
      if (parsed !== null) cfg.clockTime = parsed
    }
  }
  return cfg
}

/**
 * Sun direction from ClockTime. RESEARCH Part 3: Roblox has never published its
 * ClockTime/GeographicLatitude -> sun-direction formula (two devforum threads asking
 * got no working answer) -- explicitly disclosed as an independent standard
 * solar-elevation approximation, NOT a bit-exact match to Roblox's renderer.
 * Latitude/declination are fixed "pleasant angle" constants rather than read from
 * GeographicLatitude (whose verified Baseplate-template value is 0, which would
 * flatten elevation variation almost entirely).
 */
export function sunDirectionFromClockTime(clockTime: number, latitudeDeg = 35, declinationDeg = 15): THREE.Vector3 {
  const hourAngle = THREE.MathUtils.degToRad((clockTime - 12) * 15)
  const lat = THREE.MathUtils.degToRad(latitudeDeg)
  const decl = THREE.MathUtils.degToRad(declinationDeg)
  const sinElevation = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)
  const elevation = Math.asin(THREE.MathUtils.clamp(sinElevation, -0.98, 0.98))
  const azimuth = hourAngle
  return new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  ).normalize()
}

export interface LightingRig {
  hemi: THREE.HemisphereLight
  sun: THREE.DirectionalLight
  ambient: THREE.AmbientLight
}

/** HemisphereLight + shadow-casting DirectionalLight + AmbientLight, approximating
 *  the Baseplate template's Lighting values (RESEARCH Part 3's recommended rig). */
export function createLightingRig(scene: THREE.Scene): LightingRig {
  const hemi = new THREE.HemisphereLight(0x7092a5, 0x2a2a2e, 0.6)
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.02
  const ambient = new THREE.AmbientLight(0xffffff, 0.3)
  scene.add(hemi, sun, sun.target, ambient)
  return { hemi, sun, ambient }
}

/** Refreshes the rig from a LightingConfig; sceneRadius sizes the sun's shadow
 *  frustum and orbit distance to fit the current scene (bounding-sphere radius,
 *  studs). */
export function updateLightingRig(rig: LightingRig, config: LightingConfig, sceneRadius: number) {
  const radius = Math.max(50, sceneRadius)
  const sunDir = sunDirectionFromClockTime(config.clockTime)
  rig.sun.position.copy(sunDir).multiplyScalar(radius * 1.5)
  rig.sun.target.position.set(0, 0, 0)
  rig.sun.intensity = Math.max(0.15, config.brightness / 2)

  // ColorShift_Top tints the sun; additive offset on a white base is a coarse but
  // cheap approximation (RESEARCH Part 3 does not define an exact blend formula).
  rig.sun.color.setRGB(
    THREE.MathUtils.clamp(1 + config.colorShiftTop[0] - 0.5, 0, 2),
    THREE.MathUtils.clamp(1 + config.colorShiftTop[1] - 0.5, 0, 2),
    THREE.MathUtils.clamp(1 + config.colorShiftTop[2] - 0.5, 0, 2),
  )
  rig.sun.castShadow = config.globalShadows

  rig.ambient.color.setRGB(...config.ambient)
  rig.ambient.intensity = 0.9

  rig.hemi.groundColor.setRGB(...config.outdoorAmbient)
  rig.hemi.intensity = 0.6

  const cam = rig.sun.shadow.camera
  cam.left = -radius
  cam.right = radius
  cam.top = radius
  cam.bottom = -radius
  cam.near = 1
  cam.far = radius * 3
  cam.updateProjectionMatrix()
}

/** Lighting.FogColor/FogStart/FogEnd, read straight through in studs (1:1 with
 *  three.js units) -- the verified Baseplate default (FogEnd=100000) is effectively
 *  invisible at normal scene scale, which matches Studio's near-fogless default. */
export function applyFog(scene: THREE.Scene, config: LightingConfig) {
  const color = new THREE.Color(config.fogColor[0], config.fogColor[1], config.fogColor[2])
  if (!(scene.fog instanceof THREE.Fog)) {
    scene.fog = new THREE.Fog(color, config.fogStart, config.fogEnd)
    return
  }
  scene.fog.color.copy(color)
  scene.fog.near = config.fogStart
  scene.fog.far = config.fogEnd
}
