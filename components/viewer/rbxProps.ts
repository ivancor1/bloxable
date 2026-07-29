import * as THREE from 'three'
import type { RbxInstance, RbxPropValue } from '@/lib/rbx/types'
import { brickColorRGB } from './brickColors'
import type { PartKind } from './geometry'

export function getProp(inst: RbxInstance, name: string): RbxPropValue | undefined {
  return inst.props[name]
}

export function getVector3(
  inst: RbxInstance,
  name: string,
  fallback: [number, number, number],
): [number, number, number] {
  const p = inst.props[name]
  return p && p.type === 'Vector3' ? p.value : fallback
}

export function getFloat(inst: RbxInstance, name: string, fallback: number): number {
  const p = inst.props[name]
  if (p && (p.type === 'float' || p.type === 'double' || p.type === 'int' || p.type === 'int64')) return p.value
  return fallback
}

export function getBool(inst: RbxInstance, name: string, fallback: boolean): boolean {
  const p = inst.props[name]
  return p && p.type === 'bool' ? p.value : fallback
}

export function getColor3(
  inst: RbxInstance,
  name: string,
  fallback: [number, number, number],
): [number, number, number] {
  const p = inst.props[name]
  return p && p.type === 'Color3' ? p.value : fallback
}

export function getToken(inst: RbxInstance, name: string): { value: number; itemName?: string } | undefined {
  const p = inst.props[name]
  return p && p.type === 'token' ? { value: p.value, itemName: p.itemName } : undefined
}

const IDENTITY_ROT: readonly [number, number, number, number, number, number, number, number, number] = [
  1, 0, 0, 0, 1, 0, 0, 0, 1,
]

export interface CFrameValue {
  pos: readonly [number, number, number]
  rot: readonly [number, number, number, number, number, number, number, number, number]
}

export function getCFrame(inst: RbxInstance, name = 'CFrame'): CFrameValue {
  const p = inst.props[name]
  if (p && p.type === 'CFrame') return p.value
  return { pos: [0, 0, 0], rot: IDENTITY_ROT }
}

/**
 * CFrame -> three.js Matrix4, exactly per RESEARCH Part 3: both engines are
 * right-handed, Y-up, forward = -Z, and CFrame's R00..R22 are already row-major --
 * a direct field copy into Matrix4.set(), NO transpose, NO axis flip. 1 stud = 1
 * three.js unit.
 */
export function cframeToMatrix4(cf: CFrameValue): THREE.Matrix4 {
  const [X, Y, Z] = cf.pos
  const [R00, R01, R02, R10, R11, R12, R20, R21, R22] = cf.rot
  return new THREE.Matrix4().set(
    R00, R01, R02, X,
    R10, R11, R12, Y,
    R20, R21, R22, Z,
    0, 0, 0, 1,
  )
}

// Part class default Color (Medium stone grey, BrickColor 194) -- RESEARCH Part 2.
const DEFAULT_PART_COLOR: [number, number, number] = [163 / 255, 162 / 255, 165 / 255]

/**
 * BasePart.Color (type Color3, real property name "Color" -- not "Color3", which is
 * only the value's type tag) wins when present. "Color3" is also checked as a
 * defensive alias in case a producer ever keys it by type-name instead of the real
 * API name. BrickColor is consulted only as a fallback for legacy-style int/token
 * properties (e.g. TeamColor) via the ported palette in brickColors.ts.
 */
export function resolvePartColorRGB(inst: RbxInstance): [number, number, number] {
  const color = inst.props['Color']
  if (color && color.type === 'Color3') return color.value
  const color3 = inst.props['Color3']
  if (color3 && color3.type === 'Color3') return color3.value
  const brick = inst.props['BrickColor']
  if (brick && (brick.type === 'int' || brick.type === 'int64' || brick.type === 'token')) {
    const rgb = brickColorRGB(brick.value)
    if (rgb) return rgb
  }
  return DEFAULT_PART_COLOR
}

/**
 * Part.Shape (Enum.PartType) [OFFICIAL, RESEARCH Part 3]: Ball=0, Block=1,
 * Cylinder=2, Wedge=3, CornerWedge=4. Prefers the token's itemName (readable,
 * survives enum-id drift); falls back to the numeric value.
 */
export function resolvePartShape(inst: RbxInstance): PartKind {
  const token = getToken(inst, 'Shape')
  if (!token) return 'block'
  if (token.itemName) {
    switch (token.itemName) {
      case 'Ball':
        return 'ball'
      case 'Cylinder':
        return 'cylinder'
      case 'Wedge':
        return 'wedge'
      case 'CornerWedge':
        return 'cornerWedge'
      default:
        return 'block'
    }
  }
  switch (token.value) {
    case 0:
      return 'ball'
    case 2:
      return 'cylinder'
    case 3:
      return 'wedge'
    case 4:
      return 'cornerWedge'
    default:
      return 'block'
  }
}
