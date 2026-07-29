// Pure, isomorphic tree operations. Imported by client code (the zustand store
// applies PatchOps in the browser) — NO node imports, no fs, no process.

import type { PatchOp, RbxInstance, RbxPropValue, RbxTree } from './types'

/** Stable instance id. Doubles as the .rbxlx referent / Rojo ref id. */
export function newId(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // Fallback for non-secure contexts that expose getRandomValues but not randomUUID.
  const bytes = new Uint8Array(16)
  if (c?.getRandomValues) {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export interface TreeEntry {
  inst: RbxInstance
  /** null for services (top-level instances). */
  parentId: string | null
}

/** id → { instance, parentId }. Built fresh; do not cache across mutations. */
export function indexTree(tree: RbxTree): Map<string, TreeEntry> {
  const index = new Map<string, TreeEntry>()
  const walk = (inst: RbxInstance, parentId: string | null) => {
    index.set(inst.id, { inst, parentId })
    for (const child of inst.children) walk(child, inst.id)
  }
  for (const service of tree.services) walk(service, null)
  return index
}

export function getInstances(tree: RbxTree, ids: string[]): RbxInstance[] {
  const index = indexTree(tree)
  const out: RbxInstance[] = []
  for (const id of ids) {
    const entry = index.get(id)
    if (entry) out.push(entry.inst)
  }
  return out
}

function cloneProps(props: Record<string, RbxPropValue>): Record<string, RbxPropValue> {
  const out: Record<string, RbxPropValue> = {}
  for (const key of Object.keys(props)) {
    const value = props[key]
    switch (value.type) {
      case 'Vector3':
        out[key] = { type: 'Vector3', value: [...value.value] as [number, number, number] }
        break
      case 'Color3':
        out[key] = { type: 'Color3', value: [...value.value] as [number, number, number] }
        break
      case 'CFrame':
        out[key] = {
          type: 'CFrame',
          value: {
            pos: [...value.value.pos] as [number, number, number],
            rot: [...value.value.rot] as RbxCFrameRot,
          },
        }
        break
      default:
        out[key] = { ...value }
    }
  }
  return out
}

type RbxCFrameRot = [number, number, number, number, number, number, number, number, number]

function cloneInstance(inst: RbxInstance): RbxInstance {
  return {
    id: inst.id,
    className: inst.className,
    name: inst.name,
    props: cloneProps(inst.props),
    children: inst.children.map(cloneInstance),
  }
}

export function cloneTree(tree: RbxTree): RbxTree {
  return { formatVersion: 1, services: tree.services.map(cloneInstance) }
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

/** Assigns ids to any instance in the subtree that is missing one. */
function ensureIds(inst: RbxInstance): void {
  if (!inst.id) inst.id = newId()
  for (const child of inst.children) ensureIds(child)
}

function collectIds(inst: RbxInstance, into: string[]): void {
  into.push(inst.id)
  for (const child of inst.children) collectIds(child, into)
}

/**
 * Applies ops to a copy of `tree`. Never mutates the input.
 * Invalid ops are skipped with an actionable error string; the rest still apply.
 */
export function applyPatchOps(
  tree: RbxTree,
  ops: PatchOp[],
): { tree: RbxTree; errors: string[] } {
  const next = cloneTree(tree)
  const errors: string[] = []
  const index = indexTree(next)
  const serviceIds = new Set(next.services.map((s) => s.id))

  const isDescendant = (ancestorId: string, candidateId: string): boolean => {
    let cursor: string | null = candidateId
    while (cursor) {
      if (cursor === ancestorId) return true
      cursor = index.get(cursor)?.parentId ?? null
    }
    return false
  }

  const detach = (id: string): boolean => {
    const entry = index.get(id)
    if (!entry) return false
    const parentId = entry.parentId
    if (parentId === null) {
      const at = next.services.findIndex((s) => s.id === id)
      if (at >= 0) next.services.splice(at, 1)
      return true
    }
    const parent = index.get(parentId)?.inst
    if (!parent) return false
    const at = parent.children.findIndex((c) => c.id === id)
    if (at >= 0) parent.children.splice(at, 1)
    return true
  }

  for (const op of ops) {
    switch (op.op) {
      case 'create': {
        const parent = index.get(op.parentId)
        if (!parent) {
          errors.push(`create: parent ${shortId(op.parentId)} not found`)
          break
        }
        if (!op.instance || typeof op.instance !== 'object') {
          errors.push(`create under ${parent.inst.name}: missing instance`)
          break
        }
        const inst = cloneInstance(op.instance)
        ensureIds(inst)
        if (!inst.className) {
          errors.push(`create under ${parent.inst.name}: missing className`)
          break
        }
        if (!inst.name) inst.name = inst.className
        const ids: string[] = []
        collectIds(inst, ids)
        const clash = ids.find((id) => index.has(id))
        if (clash) {
          errors.push(`create ${inst.name}: id ${shortId(clash)} already exists`)
          break
        }
        if (new Set(ids).size !== ids.length) {
          errors.push(`create ${inst.name}: duplicate ids inside the new subtree`)
          break
        }
        parent.inst.children.push(inst)
        const register = (node: RbxInstance, parentId: string) => {
          index.set(node.id, { inst: node, parentId })
          for (const child of node.children) register(child, node.id)
        }
        register(inst, parent.inst.id)
        break
      }

      case 'update': {
        const entry = index.get(op.id)
        if (!entry) {
          errors.push(`update ${shortId(op.id)}: instance not found`)
          break
        }
        if (!op.props || typeof op.props !== 'object') {
          errors.push(`update ${entry.inst.name}: missing props`)
          break
        }
        if ('Name' in op.props) {
          errors.push(`update ${entry.inst.name}: use the rename op to change Name`)
        }
        for (const key of Object.keys(op.props)) {
          if (key === 'Name') continue
          const value = op.props[key]
          if (value === null) {
            delete entry.inst.props[key]
          } else {
            entry.inst.props[key] = cloneProps({ [key]: value })[key]
          }
        }
        break
      }

      case 'rename': {
        const entry = index.get(op.id)
        if (!entry) {
          errors.push(`rename ${shortId(op.id)}: instance not found`)
          break
        }
        if (serviceIds.has(op.id)) {
          errors.push(`rename ${entry.inst.name}: services cannot be renamed`)
          break
        }
        if (!op.name) {
          errors.push(`rename ${entry.inst.name}: name cannot be empty`)
          break
        }
        entry.inst.name = op.name
        break
      }

      case 'delete': {
        const entry = index.get(op.id)
        if (!entry) {
          errors.push(`delete ${shortId(op.id)}: instance not found`)
          break
        }
        if (serviceIds.has(op.id)) {
          errors.push(`delete ${entry.inst.name}: services cannot be deleted`)
          break
        }
        detach(op.id)
        const removed: string[] = []
        collectIds(entry.inst, removed)
        for (const id of removed) index.delete(id)
        break
      }

      case 'reparent': {
        const entry = index.get(op.id)
        if (!entry) {
          errors.push(`reparent ${shortId(op.id)}: instance not found`)
          break
        }
        if (serviceIds.has(op.id)) {
          errors.push(`reparent ${entry.inst.name}: services cannot be reparented`)
          break
        }
        const parent = index.get(op.parentId)
        if (!parent) {
          errors.push(`reparent ${entry.inst.name}: parent ${shortId(op.parentId)} not found`)
          break
        }
        if (op.parentId === op.id) {
          errors.push(`reparent ${entry.inst.name}: an instance cannot parent itself`)
          break
        }
        if (isDescendant(op.id, op.parentId)) {
          errors.push(
            `reparent ${entry.inst.name}: ${parent.inst.name} is inside it (would create a cycle)`,
          )
          break
        }
        detach(op.id)
        parent.inst.children.push(entry.inst)
        index.set(op.id, { inst: entry.inst, parentId: op.parentId })
        break
      }

      default: {
        errors.push(`unknown op "${(op as { op?: string }).op ?? '?'}"`)
      }
    }
  }

  return { tree: next, errors }
}

// ---------------------------------------------------------------------------
// outline() — the compact map the AI reads before editing.

function num(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const rounded = Math.round(n * 1000) / 1000
  return String(rounded)
}

const SCRIPT_CLASSES = new Set(['Script', 'LocalScript', 'ModuleScript'])

function summarizeProps(inst: RbxInstance): string {
  const bits: string[] = []
  const props = inst.props

  const size = props.Size
  if (size?.type === 'Vector3') {
    bits.push(`size=${num(size.value[0])}x${num(size.value[1])}x${num(size.value[2])}`)
  }

  const cf = props.CFrame
  const pos = props.Position
  if (cf?.type === 'CFrame') {
    const p = cf.value.pos
    bits.push(`pos=(${num(p[0])},${num(p[1])},${num(p[2])})`)
    const r = cf.value.rot
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    if (r.some((v, i) => Math.abs(v - identity[i]) > 1e-6)) bits.push('rotated')
  } else if (pos?.type === 'Vector3') {
    bits.push(`pos=(${num(pos.value[0])},${num(pos.value[1])},${num(pos.value[2])})`)
  }

  const color = props.Color
  if (color?.type === 'Color3') {
    const [r, g, b] = color.value
    bits.push(`color=(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`)
  }

  const material = props.Material
  if (material?.type === 'token' && material.itemName) bits.push(`material=${material.itemName}`)

  const transparency = props.Transparency
  if (transparency?.type === 'float' || transparency?.type === 'double') {
    if (transparency.value > 0) bits.push(`transparency=${num(transparency.value)}`)
  }

  const anchored = props.Anchored
  if (anchored?.type === 'bool') bits.push(anchored.value ? 'anchored' : 'unanchored')

  if (SCRIPT_CLASSES.has(inst.className)) {
    const source = props.Source
    const text = source && (source.type === 'ProtectedString' || source.type === 'string') ? source.value : ''
    const lines = text ? text.split('\n').length : 0
    const runContext = props.RunContext
    const ctx = runContext?.type === 'token' ? runContext.itemName ?? String(runContext.value) : null
    bits.push(`script${ctx ? `:${ctx}` : ''}=${lines}L`)
  }

  return bits.length ? ` ${bits.join(' ')}` : ''
}

/**
 * Compact id-annotated text tree for the AI. Every line carries the exact id
 * that update/delete/reparent ops need.
 */
export function outline(tree: RbxTree): string {
  const lines: string[] = []
  const walk = (inst: RbxInstance, depth: number) => {
    const indent = '  '.repeat(depth)
    lines.push(`${indent}${inst.name} [${inst.className}] id=${inst.id}${summarizeProps(inst)}`)
    for (const child of inst.children) walk(child, depth + 1)
  }
  for (const service of tree.services) walk(service, 0)
  return lines.join('\n')
}
