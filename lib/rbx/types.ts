// LOCKED CONTRACT — manager-authored. Do not change shapes without updating
// ARCHITECTURE.md and every consumer. Report friction in your build summary instead.

/** Typed Roblox property value. `type` matches the .rbxlx tag family we emit. */
export type RbxPropValue =
  | { type: 'string'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'int'; value: number }
  | { type: 'int64'; value: number }
  | { type: 'float'; value: number }
  | { type: 'double'; value: number }
  /** Roblox Enum value; enumName/itemName kept for validation + AI readability. */
  | { type: 'token'; value: number; enumName?: string; itemName?: string }
  | { type: 'Vector3'; value: [number, number, number] }
  /** pos + row-major rotation matrix R00..R22, matching .rbxlx CoordinateFrame order. */
  | {
      type: 'CFrame'
      value: {
        pos: [number, number, number]
        rot: [number, number, number, number, number, number, number, number, number]
      }
    }
  /** RGB floats 0..1 (Color3). Serializer decides Color3 vs Color3uint8 per property. */
  | { type: 'Color3'; value: [number, number, number] }
  /** Script source. */
  | { type: 'ProtectedString'; value: string }
  /** Reference to another instance by our id (null = nil). */
  | { type: 'Ref'; value: string | null }
  /** UDim: [scale, offset]. */
  | { type: 'UDim'; value: [number, number] }
  /** UDim2: [[xScale, xOffset], [yScale, yOffset]] — the shape every GUI size/position uses. */
  | { type: 'UDim2'; value: [[number, number], [number, number]] }
  | { type: 'Vector2'; value: [number, number] }
  /** Rect: [[minX, minY], [maxX, maxY]]. */
  | { type: 'Rect'; value: [[number, number], [number, number]] }
  /** NumberRange: [min, max]. */
  | { type: 'NumberRange'; value: [number, number] }
  /** NumberSequence keypoints, time ascending, first time 0 and last time 1. */
  | { type: 'NumberSequence'; value: NumberKeypoint[] }
  /** ColorSequence keypoints, time ascending, first time 0 and last time 1. */
  | { type: 'ColorSequence'; value: ColorKeypoint[] }
  | { type: 'Font'; value: RbxFont }
  /** BasePart.CustomPhysicalProperties: 'Default', or the six custom numbers. */
  | { type: 'PhysicalProperties'; value: 'Default' | RbxCustomPhysicalProperties }

export interface NumberKeypoint {
  time: number
  value: number
  envelope: number
}

export interface ColorKeypoint {
  time: number
  color: [number, number, number]
}

export interface RbxFont {
  /** Font family asset, e.g. "rbxasset://fonts/families/GothamSSm.json". */
  family: string
  /** Enum.FontWeight item name, e.g. "Regular", "Bold". */
  weight: string
  /** Enum.FontStyle item name: "Normal" or "Italic". */
  style: string
}

export interface RbxCustomPhysicalProperties {
  density: number
  friction: number
  elasticity: number
  frictionWeight: number
  elasticityWeight: number
  acousticAbsorption: number
}

/**
 * Instance attribute value. Attributes are not properties — they are the
 * user-defined data bag Roblox creators hang off an instance, so the set of
 * types is deliberately small and JSON-shaped.
 */
export type RbxAttrValue =
  | { type: 'string'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'double'; value: number }
  | { type: 'Vector3'; value: [number, number, number] }
  | { type: 'Color3'; value: [number, number, number] }
  | { type: 'UDim2'; value: [[number, number], [number, number]] }

export interface RbxInstance {
  /** Stable uuid; doubles as the .rbxlx referent. */
  id: string
  /** Exact Roblox class name: "Part", "Script", "SpawnLocation", "PointLight", ... */
  className: string
  /** Instance.Name */
  name: string
  /** Exact Roblox property names: "Size", "CFrame", "Anchored", "Source", ... */
  props: Record<string, RbxPropValue>
  /** Instance attributes (the creator-defined data bag). Omitted when empty. */
  attributes?: Record<string, RbxAttrValue>
  /** CollectionService tags. Omitted when empty. */
  tags?: string[]
  children: RbxInstance[]
}

export interface RbxTree {
  formatVersion: 1
  /** Top-level services: Workspace, Lighting, ReplicatedStorage, ServerScriptService, ... */
  services: RbxInstance[]
}

/** The single mutation currency. AI tools, persistence, SSE, and the viewer all speak PatchOp. */
export type PatchOp =
  | { op: 'create'; parentId: string; instance: RbxInstance }
  | {
      /** null value deletes the prop (reverts to class default). */
      op: 'update'
      id: string
      props: Record<string, RbxPropValue | null>
      /** null value removes one attribute. Omitted key = leave the attribute alone. */
      attributes?: Record<string, RbxAttrValue | null>
      /** Full replacement of the instance's tag set. Omitted = leave tags alone. */
      tags?: string[]
    }
  | { op: 'rename'; id: string; name: string }
  | { op: 'delete'; id: string }
  | { op: 'reparent'; id: string; parentId: string }

export interface ProjectMeta {
  id: string
  name: string
  createdAt: string // ISO 8601
  updatedAt: string
  /** Publish target; auto-assigned from the operator place pool on first publish. */
  roblox?: { universeId?: string; placeId?: string }
  /** Set after the first successful Open Cloud publish. */
  lastPublish?: { versionNumber: number; at: string }
  /**
   * Set after the last successful eject — the model uploaded into the user's own
   * Roblox account. Every eject mints a new asset, so this is the latest one.
   */
  lastEject?: { assetId: string; at: string; moderationState?: string }
}
