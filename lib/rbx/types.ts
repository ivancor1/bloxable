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

export interface RbxInstance {
  /** Stable uuid; doubles as the .rbxlx referent. */
  id: string
  /** Exact Roblox class name: "Part", "Script", "SpawnLocation", "PointLight", ... */
  className: string
  /** Instance.Name */
  name: string
  /** Exact Roblox property names: "Size", "CFrame", "Anchored", "Source", ... */
  props: Record<string, RbxPropValue>
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
    }
  | { op: 'rename'; id: string; name: string }
  | { op: 'delete'; id: string }
  | { op: 'reparent'; id: string; parentId: string }

export interface ProjectMeta {
  id: string
  name: string
  createdAt: string // ISO 8601
  updatedAt: string
  /** Publish target; absent until the user connects Roblox. */
  roblox?: { universeId?: string; placeId?: string }
}
