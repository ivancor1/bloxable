// Server-only validator. Every AI-authored PatchOp is checked against the
// OFFICIAL Roblox API dump cached by `npm run setup` (RESEARCH.md Part 2,
// "Property/class authority") before it is allowed anywhere near the tree.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { PatchOp, RbxInstance, RbxPropValue, RbxTree } from './types'
import { indexTree } from './tree'

/**
 * Classes the Open Cloud publish endpoint silently ignores (RESEARCH Part 1 Q1).
 * A place containing them cannot be published from this app, so we refuse to
 * create them rather than shipping something that quietly loses geometry.
 */
export const BANNED_CLASSES: Record<string, string> = {
  PartOperation: 'the Roblox publish API does not update solid-modelling parts',
  UnionOperation: 'the Roblox publish API does not update solid-modelling parts (unions)',
  NegateOperation: 'the Roblox publish API does not update solid-modelling parts (negates)',
  IntersectOperation: 'the Roblox publish API does not update solid-modelling parts (intersects)',
  SurfaceAppearance: 'the Roblox publish API does not update SurfaceAppearance',
  EditableImage: 'the Roblox publish API does not update EditableImage',
  EditableMesh: 'the Roblox publish API does not update EditableMesh',
  BaseWrap: 'the Roblox publish API does not update avatar wrap layers',
  WrapTarget: 'the Roblox publish API does not update avatar wrap layers',
  WrapLayer: 'the Roblox publish API does not update avatar wrap layers',
}

export interface ReflectionProperty {
  name: string
  /** Owning class in the inheritance chain. */
  owner: string
  /** API dump ValueType, e.g. { Category: 'Enum', Name: 'Material' }. */
  category: 'Primitive' | 'DataType' | 'Enum' | 'Class'
  typeName: string
  tags: string[]
}

export interface ReflectionClass {
  name: string
  superclass: string | null
  tags: string[]
  properties: Map<string, ReflectionProperty>
}

export interface Reflection {
  /** API dump format version (the dump's own `Version` field). */
  version: number
  classes: Map<string, ReflectionClass>
  enums: Map<string, Map<string, number>>
  /** Enum name → value → item name. */
  enumValues: Map<string, Map<number, string>>
}

interface DumpMember {
  MemberType: string
  Name: string
  ValueType?: { Category: string; Name: string }
  Tags?: string[]
}

interface DumpClass {
  Name: string
  Superclass?: string
  Tags?: string[]
  Members?: DumpMember[]
}

interface DumpEnum {
  Name: string
  Items: { Name: string; Value: number }[]
}

interface ApiDump {
  Version: number
  Classes: DumpClass[]
  Enums: DumpEnum[]
}

export const API_DUMP_RELATIVE_PATH = path.join('data', 'cache', 'api-dump.json')

const MISSING_DUMP_HINT =
  'Roblox API dump not found at data/cache/api-dump.json — run `npm run setup` to download it.'

function candidatePaths(): string[] {
  const paths = [path.join(process.cwd(), API_DUMP_RELATIVE_PATH)]
  try {
    // Fallback for runtimes whose cwd is not the repo root.
    const here = path.dirname(fileURLToPath(import.meta.url))
    const fromModule = path.resolve(here, '..', '..', API_DUMP_RELATIVE_PATH)
    if (!paths.includes(fromModule)) paths.push(fromModule)
  } catch {
    // import.meta.url unavailable — the cwd candidate is enough
  }
  return paths
}

let cached: Promise<Reflection> | null = null

/** Parsed + indexed API dump. Cached per process. */
export function loadReflection(): Promise<Reflection> {
  if (!cached) {
    cached = readDump().catch((err) => {
      cached = null
      throw err
    })
  }
  return cached
}

async function readDump(): Promise<Reflection> {
  const tried = candidatePaths()
  let raw: string | null = null
  for (const candidate of tried) {
    try {
      raw = await readFile(candidate, 'utf8')
      break
    } catch {
      // try the next candidate
    }
  }
  if (raw === null) throw new Error(MISSING_DUMP_HINT)

  let dump: ApiDump
  try {
    dump = JSON.parse(raw) as ApiDump
  } catch (err) {
    throw new Error(
      `${API_DUMP_RELATIVE_PATH} is not valid JSON (${(err as Error).message}) — re-run \`npm run setup\`.`,
    )
  }
  if (!Array.isArray(dump.Classes) || !Array.isArray(dump.Enums)) {
    throw new Error(`${API_DUMP_RELATIVE_PATH} is missing Classes/Enums — re-run \`npm run setup\`.`)
  }

  const classes = new Map<string, ReflectionClass>()
  for (const cls of dump.Classes) {
    const properties = new Map<string, ReflectionProperty>()
    for (const member of cls.Members ?? []) {
      if (member.MemberType !== 'Property' || !member.ValueType) continue
      properties.set(member.Name, {
        name: member.Name,
        owner: cls.Name,
        category: member.ValueType.Category as ReflectionProperty['category'],
        typeName: member.ValueType.Name,
        tags: member.Tags ?? [],
      })
    }
    classes.set(cls.Name, {
      name: cls.Name,
      superclass: cls.Superclass && cls.Superclass !== '<<<ROOT>>>' ? cls.Superclass : null,
      tags: cls.Tags ?? [],
      properties,
    })
  }

  const enums = new Map<string, Map<string, number>>()
  const enumValues = new Map<string, Map<number, string>>()
  for (const e of dump.Enums) {
    const byName = new Map<string, number>()
    const byValue = new Map<number, string>()
    for (const item of e.Items) {
      byName.set(item.Name, item.Value)
      if (!byValue.has(item.Value)) byValue.set(item.Value, item.Name)
    }
    enums.set(e.Name, byName)
    enumValues.set(e.Name, byValue)
  }

  return { version: dump.Version, classes, enums, enumValues }
}

// --- lookups ----------------------------------------------------------------

export function findProperty(
  reflection: Reflection,
  className: string,
  propName: string,
): ReflectionProperty | null {
  let cursor = reflection.classes.get(className)
  while (cursor) {
    const found = cursor.properties.get(propName)
    if (found) return found
    cursor = cursor.superclass ? reflection.classes.get(cursor.superclass) : undefined
  }
  return null
}

function ancestry(reflection: Reflection, className: string): string[] {
  const chain: string[] = []
  let cursor = reflection.classes.get(className)
  while (cursor) {
    chain.push(cursor.name)
    cursor = cursor.superclass ? reflection.classes.get(cursor.superclass) : undefined
  }
  return chain
}

/** Banned class, or a subclass of one. Returns the reason, or null. */
export function bannedReason(reflection: Reflection, className: string): string | null {
  for (const name of ancestry(reflection, className)) {
    const reason = BANNED_CLASSES[name]
    if (reason) {
      return name === className
        ? `${className} is not supported: ${reason}`
        : `${className} inherits from ${name}, which is not supported: ${reason}`
    }
  }
  return BANNED_CLASSES[className]
    ? `${className} is not supported: ${BANNED_CLASSES[className]}`
    : null
}

/** RbxPropValue.type tags accepted for a given API dump property type. */
function allowedValueTypes(prop: ReflectionProperty): string[] {
  if (prop.category === 'Enum') return ['token']
  if (prop.category === 'Class') return ['Ref']
  if (prop.category === 'Primitive') {
    switch (prop.typeName) {
      case 'bool':
        return ['bool']
      case 'int':
        return ['int', 'float', 'double']
      case 'int64':
        return ['int64', 'int', 'float', 'double']
      case 'float':
        return ['float', 'double', 'int']
      case 'double':
        return ['double', 'float', 'int']
      case 'string':
        return ['string']
      default:
        return []
    }
  }
  switch (prop.typeName) {
    case 'Vector3':
      return ['Vector3']
    case 'CFrame':
      return ['CFrame']
    case 'Color3':
      return ['Color3']
    case 'ProtectedString':
      return ['ProtectedString', 'string']
    case 'Content':
    case 'ContentId':
      return ['string']
    case 'BrickColor':
      return ['int']
    default:
      return []
  }
}

function finite(value: RbxPropValue): boolean {
  switch (value.type) {
    case 'int':
    case 'int64':
    case 'float':
    case 'double':
    case 'token':
      return Number.isFinite(value.value)
    case 'Vector3':
    case 'Color3':
      return value.value.length === 3 && value.value.every((n) => Number.isFinite(n))
    case 'CFrame':
      return (
        value.value.pos.length === 3 &&
        value.value.rot.length === 9 &&
        value.value.pos.every((n) => Number.isFinite(n)) &&
        value.value.rot.every((n) => Number.isFinite(n))
      )
    default:
      return true
  }
}

/**
 * Validates one property write. Returns a normalized value (enum tokens get
 * their numeric value + enumName + itemName filled in) or an error string.
 */
function validateProp(
  reflection: Reflection,
  className: string,
  propName: string,
  value: RbxPropValue,
  label: string,
): { value: RbxPropValue } | { error: string } {
  if (propName === 'Name') {
    return { error: `${label}: set Name with the rename op, not as a property` }
  }
  const prop = findProperty(reflection, className, propName)
  if (!prop) {
    return { error: `${label}: "${propName}" is not a property of ${className}` }
  }
  if (!finite(value)) {
    return { error: `${label}: ${propName} has a non-finite number` }
  }

  const allowed = allowedValueTypes(prop)
  if (allowed.length === 0) {
    return {
      error: `${label}: ${className}.${propName} is a ${prop.typeName}, which this build cannot set yet`,
    }
  }
  if (!allowed.includes(value.type)) {
    return {
      error: `${label}: ${className}.${propName} is a ${prop.typeName} — expected value type ${allowed[0]}, got ${value.type}`,
    }
  }

  if (prop.category === 'Enum') {
    if (value.type !== 'token') {
      return { error: `${label}: ${className}.${propName} must be an Enum.${prop.typeName} token` }
    }
    const byName = reflection.enums.get(prop.typeName)
    const byValue = reflection.enumValues.get(prop.typeName)
    if (!byName || !byValue) {
      return { error: `${label}: Enum.${prop.typeName} is not in the API dump` }
    }
    if (value.enumName && value.enumName !== prop.typeName) {
      return {
        error: `${label}: ${className}.${propName} takes Enum.${prop.typeName}, not Enum.${value.enumName}`,
      }
    }
    if (value.itemName) {
      const resolved = byName.get(value.itemName)
      if (resolved === undefined) {
        return {
          error: `${label}: Enum.${prop.typeName} has no item "${value.itemName}" (valid: ${[...byName.keys()].slice(0, 12).join(', ')}${byName.size > 12 ? ', …' : ''})`,
        }
      }
      return {
        value: { type: 'token', value: resolved, enumName: prop.typeName, itemName: value.itemName },
      }
    }
    const itemName = byValue.get(value.value)
    if (itemName === undefined) {
      return {
        error: `${label}: ${value.value} is not a valid Enum.${prop.typeName} value (valid: ${[...byName.entries()].slice(0, 12).map(([n, v]) => `${n}=${v}`).join(', ')}${byName.size > 12 ? ', …' : ''})`,
      }
    }
    return { value: { type: 'token', value: value.value, enumName: prop.typeName, itemName } }
  }

  // Normalize number tags to the exact Roblox type so the Rojo projection emits
  // the right explicit variant (Float32 vs Int32 are not interchangeable).
  if (prop.category === 'Primitive' && 'value' in value && typeof value.value === 'number') {
    const n = value.value
    switch (prop.typeName) {
      case 'float':
        if (value.type !== 'float') return { value: { type: 'float', value: n } }
        break
      case 'double':
        if (value.type !== 'double') return { value: { type: 'double', value: n } }
        break
      case 'int':
        if (!Number.isInteger(n)) {
          return { error: `${label}: ${className}.${propName} is an int — ${n} is not a whole number` }
        }
        if (value.type !== 'int') return { value: { type: 'int', value: n } }
        break
      case 'int64':
        if (!Number.isInteger(n)) {
          return { error: `${label}: ${className}.${propName} is an int64 — ${n} is not a whole number` }
        }
        if (value.type !== 'int64') return { value: { type: 'int64', value: n } }
        break
      default:
        break
    }
  }

  return { value }
}

export interface ValidateResult {
  ok: PatchOp[]
  errors: string[]
}

/**
 * Filters `ops` down to the ones that are safe to apply, normalizing enum
 * tokens on the way through. Errors are phrased for the model to act on.
 */
export function validateOps(
  reflection: Reflection,
  tree: RbxTree,
  ops: PatchOp[],
): ValidateResult {
  const index = indexTree(tree)
  const classNameById = new Map<string, string>()
  for (const [id, entry] of index) classNameById.set(id, entry.inst.className)

  const ok: PatchOp[] = []
  const errors: string[] = []
  /** Ids created earlier in this same batch. */
  const pendingIds = new Set<string>()
  const knownId = (id: string) => classNameById.has(id) || pendingIds.has(id)

  // Partial failure must stay partial. A create op carries a whole nested model,
  // so rejecting the subtree over one bad property used to throw away an entire
  // build (e.g. a 30-part obby lost because one sign's TextLabel.Size is a UDim2,
  // a type this build cannot express). Instead: drop the offending property or
  // child, keep everything else, and hand the reasons back so the model can fix
  // just that piece. Only a node that is itself unusable fails outright.
  const validateSubtree = (
    node: RbxInstance,
    label: string,
  ): { instance: RbxInstance; warnings: string[] } | { error: string } => {
    if (!node || typeof node !== 'object') return { error: `${label}: missing instance` }
    const className = node.className
    if (!className) return { error: `${label}: missing className` }

    const cls = reflection.classes.get(className)
    if (!cls) return { error: `${label}: "${className}" is not a Roblox class` }

    const banned = bannedReason(reflection, className)
    if (banned) return { error: `${label}: ${banned}` }

    if (cls.tags.includes('Service')) {
      return { error: `${label}: ${className} is a service and already exists in the place` }
    }
    if (cls.tags.includes('NotCreatable')) {
      return { error: `${label}: ${className} cannot be created` }
    }

    const warnings: string[] = []
    const props: Record<string, RbxPropValue> = {}
    for (const propName of Object.keys(node.props ?? {})) {
      const result = validateProp(
        reflection,
        className,
        propName,
        node.props[propName],
        `${label} (${className})`,
      )
      if ('error' in result) {
        warnings.push(`${result.error} — property skipped, the instance was still created`)
        continue
      }
      props[propName] = result.value
    }

    const children: RbxInstance[] = []
    for (const child of node.children ?? []) {
      const result = validateSubtree(child, `${label} > ${child?.name ?? '?'}`)
      if ('error' in result) {
        warnings.push(`${result.error} — this object was skipped, the rest was created`)
        continue
      }
      children.push(result.instance)
      warnings.push(...result.warnings)
    }

    return {
      instance: { id: node.id, className, name: node.name || className, props, children },
      warnings,
    }
  }

  const registerCreated = (node: RbxInstance) => {
    if (node.id) {
      pendingIds.add(node.id)
      classNameById.set(node.id, node.className)
    }
    for (const child of node.children) registerCreated(child)
  }

  for (const op of ops) {
    switch (op?.op) {
      case 'create': {
        if (!knownId(op.parentId)) {
          errors.push(`create: parent ${op.parentId} is not in this place`)
          break
        }
        const label = `create ${op.instance?.name ?? '?'}`
        const result = validateSubtree(op.instance, label)
        if ('error' in result) {
          errors.push(result.error)
          break
        }
        errors.push(...result.warnings)
        registerCreated(result.instance)
        ok.push({ op: 'create', parentId: op.parentId, instance: result.instance })
        break
      }

      case 'update': {
        const className = classNameById.get(op.id)
        if (!className) {
          errors.push(`update: instance ${op.id} is not in this place`)
          break
        }
        // Same rule as create: skip the properties we cannot honour, apply the rest.
        const props: Record<string, RbxPropValue | null> = {}
        const errorsBefore = errors.length
        for (const propName of Object.keys(op.props ?? {})) {
          const value = op.props[propName]
          if (value === null) {
            if (propName === 'Name') {
              errors.push(`update ${op.id} (${className}): Name cannot be cleared`)
              continue
            }
            if (!findProperty(reflection, className, propName)) {
              errors.push(`update ${op.id} (${className}): "${propName}" is not a property of ${className}`)
              continue
            }
            props[propName] = null
            continue
          }
          const result = validateProp(
            reflection,
            className,
            propName,
            value,
            `update ${op.id} (${className})`,
          )
          if ('error' in result) {
            errors.push(`${result.error} — property skipped`)
            continue
          }
          props[propName] = result.value
        }
        if (Object.keys(props).length === 0) {
          // Only say this when nothing was offered at all — if every property was
          // skipped, the reasons above already explain it.
          if (errors.length === errorsBefore) {
            errors.push(`update ${op.id} (${className}): no properties given`)
          }
          break
        }
        ok.push({ op: 'update', id: op.id, props })
        break
      }

      case 'rename': {
        if (!classNameById.has(op.id)) {
          errors.push(`rename: instance ${op.id} is not in this place`)
          break
        }
        if (!op.name) {
          errors.push(`rename ${op.id}: name cannot be empty`)
          break
        }
        ok.push(op)
        break
      }

      case 'delete': {
        if (!classNameById.has(op.id)) {
          errors.push(`delete: instance ${op.id} is not in this place`)
          break
        }
        ok.push(op)
        break
      }

      case 'reparent': {
        if (!classNameById.has(op.id)) {
          errors.push(`reparent: instance ${op.id} is not in this place`)
          break
        }
        if (!knownId(op.parentId)) {
          errors.push(`reparent ${op.id}: parent ${op.parentId} is not in this place`)
          break
        }
        ok.push(op)
        break
      }

      default:
        errors.push(`unknown op "${(op as { op?: string })?.op ?? '?'}"`)
    }
  }

  // Ref properties must point at something that exists once the batch is applied.
  const refErrors: string[] = []
  const checkRefs = (props: Record<string, RbxPropValue | null>, label: string) => {
    for (const propName of Object.keys(props)) {
      const value = props[propName]
      if (value && value.type === 'Ref' && value.value !== null && !knownId(value.value)) {
        refErrors.push(`${label}: ${propName} points at ${value.value}, which is not in this place`)
      }
    }
  }
  const walkRefs = (node: RbxInstance) => {
    checkRefs(node.props, `create ${node.name}`)
    for (const child of node.children) walkRefs(child)
  }
  const kept: PatchOp[] = []
  for (const op of ok) {
    const before = refErrors.length
    if (op.op === 'create') walkRefs(op.instance)
    else if (op.op === 'update') checkRefs(op.props, `update ${op.id}`)
    if (refErrors.length === before) kept.push(op)
  }
  errors.push(...refErrors)

  return { ok: kept, errors }
}
