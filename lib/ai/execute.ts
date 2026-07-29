// B3 — pure mapping between Anthropic tool calls and PatchOps.
//
// No I/O here: index.ts owns validation (lib/rbx/validate), application
// (lib/rbx/tree) and persistence (lib/store). Keeping this pure makes the
// mapping directly testable without a model or an API key.

import type { PatchOp, RbxInstance, RbxPropValue, RbxTree } from '@/lib/rbx/types'
import { getInstances, indexTree, newId, outline } from '@/lib/rbx/tree'
import { blockyNpc } from '@/lib/rbx/template'
import type { Reflection } from '@/lib/rbx/validate'
import { findProperty } from '@/lib/rbx/validate'

/** Roblox containers whose contents are copied to each client (RESEARCH Part 2). */
const STARTER_CONTAINERS = new Set([
  'StarterPlayerScripts',
  'StarterCharacterScripts',
  'StarterGui',
  'StarterPack',
])

const PROP_TYPES = new Set([
  'string',
  'bool',
  'int',
  'int64',
  'float',
  'double',
  'token',
  'Vector3',
  'CFrame',
  'Color3',
  'ProtectedString',
  'Ref',
])

/** Tool result payloads are capped so a huge subtree cannot blow up the context. */
const RESULT_CHAR_LIMIT = 20_000

const IDENTITY_ROT: [number, number, number, number, number, number, number, number, number] = [
  1, 0, 0, 0, 1, 0, 0, 0, 1,
]

export interface MappedToolCall {
  /** Ops to validate and apply. Empty for read-only tools. */
  ops: PatchOp[]
  /** Result fields for a read-only tool (returned to the model as-is). */
  readResult?: Record<string, unknown>
  /** Problems with the model's own arguments, before the validator runs. */
  errors: string[]
  /** Human-readable activity line for the `tool_start` event. */
  activity: string
}

/* ------------------------------------------------------------------ helpers */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isNumberTriple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number')
  )
}

export function instanceLabel(
  tree: RbxTree,
  id: string,
): { name: string; className: string } | null {
  const entry = indexTree(tree).get(id)
  return entry ? { name: entry.inst.name, className: entry.inst.className } : null
}

/** Names + class names from `id` up to its root service, nearest first. */
function ancestry(tree: RbxTree, id: string): string[] {
  const index = indexTree(tree)
  const out: string[] = []
  let cursor: string | null = id
  let guard = 0
  while (cursor && guard++ < 256) {
    const entry = index.get(cursor)
    if (!entry) break
    out.push(entry.inst.name, entry.inst.className)
    cursor = entry.parentId
  }
  return out
}

function isStarterContainer(tree: RbxTree, parentId: string): boolean {
  return ancestry(tree, parentId).some((n) => STARTER_CONTAINERS.has(n))
}

function flatten(inst: RbxInstance, out: Array<{ id: string; name: string; className: string }>) {
  out.push({ id: inst.id, name: inst.name, className: inst.className })
  for (const child of inst.children) flatten(child, out)
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Human noun for a set of created instances: "parts", "Models", "objects". */
function classNoun(items: Array<{ className: string }>): string {
  if (items.length === 0) return 'objects'
  const first = items[0].className
  const uniform = items.every((i) => i.className === first)
  if (!uniform) return items.length === 1 ? 'object' : 'objects'
  const base = first === 'Part' ? 'part' : first
  return items.length === 1 ? base : `${base}s`
}

/* -------------------------------------------------------- property coercion */

/**
 * Plain value -> RbxPropValue, using the official API dump to decide the type.
 *
 * The tagged form ({"type":"Vector3","value":[8,1,8]}) still works and is what
 * the tree stores, but making the model write it cost 3-5x the tokens of the
 * bare value for every property of every instance it creates. The server
 * already knows from the dump that Part.Size is a Vector3 and Part.Material is
 * an Enum.Material, so it can do the tagging itself.
 */
function inferProp(
  reflection: Reflection,
  className: string,
  propName: string,
  raw: unknown,
  where: string,
  errors: string[],
): RbxPropValue | null {
  const prop = findProperty(reflection, className, propName)
  if (!prop) {
    errors.push(`${where}: "${propName}" is not a property of ${className}.`)
    return null
  }

  const reject = (want: string): null => {
    errors.push(`${where}: ${className}.${propName} is a ${prop.typeName} — ${want}`)
    return null
  }
  const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

  if (prop.category === 'Enum') {
    // itemName is authoritative; the validator resolves the number from the dump.
    if (typeof raw === 'string') {
      return { type: 'token', value: 0, enumName: prop.typeName, itemName: raw }
    }
    if (num(raw)) return { type: 'token', value: raw, enumName: prop.typeName }
    return reject(`give the item name as a string, e.g. "Grass".`)
  }

  if (prop.category === 'Class') {
    if (raw === null || typeof raw === 'string') return { type: 'Ref', value: raw }
    return reject('give another object\'s id, or null.')
  }

  if (prop.category === 'Primitive') {
    switch (prop.typeName) {
      case 'bool':
        return typeof raw === 'boolean' ? { type: 'bool', value: raw } : reject('give true or false.')
      case 'string':
        return typeof raw === 'string' ? { type: 'string', value: raw } : reject('give a string.')
      case 'int':
      case 'int64':
      case 'float':
      case 'double':
        return num(raw)
          ? ({ type: prop.typeName, value: raw } as RbxPropValue)
          : reject('give a number.')
      default:
        return reject('this build cannot set that type yet.')
    }
  }

  switch (prop.typeName) {
    case 'Vector3':
      return isNumberTriple(raw) ? { type: 'Vector3', value: raw } : reject('give [x, y, z].')
    case 'Color3':
      return isNumberTriple(raw)
        ? { type: 'Color3', value: raw }
        : reject('give [r, g, b] with each channel 0..1.')
    case 'CFrame': {
      // Position-only shorthand: the overwhelmingly common case is an unrotated
      // object, and the identity matrix is nine tokens of nothing.
      if (isNumberTriple(raw)) return { type: 'CFrame', value: { pos: raw, rot: IDENTITY_ROT } }
      const v = asRecord(raw)
      const pos = v?.pos
      const rot = v?.rot
      if (isNumberTriple(pos)) {
        if (rot === undefined) return { type: 'CFrame', value: { pos, rot: IDENTITY_ROT } }
        if (Array.isArray(rot) && rot.length === 9 && rot.every(num)) {
          return {
            type: 'CFrame',
            value: {
              pos,
              rot: rot as [number, number, number, number, number, number, number, number, number],
            },
          }
        }
      }
      return reject('give [x, y, z], or {"pos":[x,y,z],"rot":[9 numbers]}.')
    }
    case 'ProtectedString':
      return typeof raw === 'string'
        ? { type: 'ProtectedString', value: raw }
        : reject('give the source as a string.')
    case 'Content':
    case 'ContentId':
      return typeof raw === 'string' ? { type: 'string', value: raw } : reject('give a string.')
    case 'BrickColor':
      return num(raw) && Number.isInteger(raw)
        ? { type: 'int', value: raw }
        : reject('give the BrickColor number.')
    default:
      return reject('this build cannot set that type yet.')
  }
}

function coerceProp(
  className: string | null,
  propName: string,
  raw: unknown,
  where: string,
  errors: string[],
  reflection: Reflection | null,
): RbxPropValue | null {
  const record = asRecord(raw)
  const tagged =
    record !== null && typeof record.type === 'string' && PROP_TYPES.has(record.type)

  if (!tagged) {
    // Bare value: let the API dump say what type it is.
    if (reflection && className) {
      return inferProp(reflection, className, propName, raw, where, errors)
    }
    if (!record) {
      errors.push(
        `${where}: property "${propName}" must be a tagged value like {"type":"bool","value":true}.`,
      )
      return null
    }
    errors.push(
      `${where}: property "${propName}" has unknown type ${JSON.stringify(record.type)}. Use one of: ${[...PROP_TYPES].join(', ')}.`,
    )
    return null
  }

  const rec = record as Record<string, unknown>
  const type = rec.type as string

  switch (type) {
    case 'string':
    case 'ProtectedString': {
      if (typeof rec.value !== 'string') {
        errors.push(`${where}: property "${propName}" (${type}) needs a string value.`)
        return null
      }
      return { type, value: rec.value } as RbxPropValue
    }
    case 'bool': {
      if (typeof rec.value !== 'boolean') {
        errors.push(`${where}: property "${propName}" (bool) needs true or false.`)
        return null
      }
      return { type: 'bool', value: rec.value }
    }
    case 'int':
    case 'int64':
    case 'float':
    case 'double': {
      if (typeof rec.value !== 'number' || !Number.isFinite(rec.value)) {
        errors.push(`${where}: property "${propName}" (${type}) needs a finite number.`)
        return null
      }
      return { type, value: rec.value } as RbxPropValue
    }
    case 'token': {
      const enumName = typeof rec.enumName === 'string' ? rec.enumName : undefined
      const itemName = typeof rec.itemName === 'string' ? rec.itemName : undefined
      const value = typeof rec.value === 'number' ? rec.value : undefined
      if (!itemName && value === undefined) {
        errors.push(
          `${where}: property "${propName}" (token) needs enumName + itemName, e.g. {"type":"token","enumName":"Material","itemName":"Grass"}.`,
        )
        return null
      }
      // itemName is authoritative; the validator resolves the number from the
      // official API dump, so an omitted/stale number is fine here.
      return { type: 'token', value: value ?? 0, enumName, itemName }
    }
    case 'Vector3': {
      if (!isNumberTriple(rec.value)) {
        errors.push(`${where}: property "${propName}" (Vector3) needs [x, y, z].`)
        return null
      }
      return { type: 'Vector3', value: rec.value }
    }
    case 'Color3': {
      if (!isNumberTriple(rec.value)) {
        errors.push(
          `${where}: property "${propName}" (Color3) needs [r, g, b] with each channel 0..1.`,
        )
        return null
      }
      return { type: 'Color3', value: rec.value }
    }
    case 'CFrame': {
      const v = asRecord(rec.value)
      const pos = v?.pos
      const rot = v?.rot
      if (
        !isNumberTriple(pos) ||
        !Array.isArray(rot) ||
        rot.length !== 9 ||
        !rot.every((n) => typeof n === 'number')
      ) {
        errors.push(
          `${where}: property "${propName}" (CFrame) needs {"pos":[x,y,z],"rot":[9 numbers]}.`,
        )
        return null
      }
      return {
        type: 'CFrame',
        value: {
          pos,
          rot: rot as [
            number,
            number,
            number,
            number,
            number,
            number,
            number,
            number,
            number,
          ],
        },
      }
    }
    case 'Ref': {
      if (rec.value !== null && typeof rec.value !== 'string') {
        errors.push(`${where}: property "${propName}" (Ref) needs an instance id or null.`)
        return null
      }
      return { type: 'Ref', value: (rec.value as string | null) ?? null }
    }
    default:
      return null
  }
}

function coerceProps(
  className: string | null,
  raw: unknown,
  where: string,
  errors: string[],
  allowNull: boolean,
  reflection: Reflection | null,
): Record<string, RbxPropValue | null> {
  const out: Record<string, RbxPropValue | null> = {}
  const rec = asRecord(raw)
  if (raw !== undefined && !rec) {
    errors.push(`${where}: "properties" must be an object of property name -> tagged value.`)
    return out
  }
  if (!rec) return out
  for (const [key, value] of Object.entries(rec)) {
    if (value === null) {
      if (allowNull) out[key] = null
      else errors.push(`${where}: property "${key}" cannot be null when creating an instance.`)
      continue
    }
    const coerced = coerceProp(className, key, value, where, errors, reflection)
    if (coerced) out[key] = coerced
  }
  return out
}

/* --------------------------------------------------------- instance builder */

function buildInstance(
  raw: unknown,
  where: string,
  errors: string[],
  reflection: Reflection | null,
): RbxInstance | null {
  // Any problem anywhere in this subtree rejects the whole item rather than
  // silently creating an instance with properties quietly missing.
  const errorsBefore = errors.length
  const rec = asRecord(raw)
  if (!rec) {
    errors.push(`${where}: expected an object with className and name.`)
    return null
  }
  const className = asString(rec.className)
  const name = asString(rec.name)
  if (!className) {
    errors.push(`${where}: "className" is required (an exact Roblox class name).`)
    return null
  }
  if (!name) {
    errors.push(`${where}: "name" is required.`)
    return null
  }

  const props = coerceProps(
    className,
    rec.properties,
    `${where} (${name})`,
    errors,
    false,
    reflection,
  ) as Record<string, RbxPropValue>

  const children: RbxInstance[] = []
  if (rec.children !== undefined) {
    if (!Array.isArray(rec.children)) {
      errors.push(`${where} (${name}): "children" must be an array.`)
    } else {
      rec.children.forEach((child, i) => {
        const built = buildInstance(child, `${where} (${name}) child ${i}`, errors, reflection)
        if (built) children.push(built)
      })
    }
  }

  if (errors.length > errorsBefore) return null
  return { id: newId(), className, name, props, children }
}

/* ------------------------------------------------------------- script kinds */

interface ScriptShape {
  className: string
  props: Record<string, RbxPropValue>
}

function scriptShape(
  kind: string,
  tree: RbxTree,
  parentId: string,
  source: string,
  errors: string[],
): ScriptShape | null {
  const src: RbxPropValue = { type: 'ProtectedString', value: source }
  const starter = isStarterContainer(tree, parentId)

  if (kind === 'module') {
    return { className: 'ModuleScript', props: { Source: src } }
  }
  if (kind === 'server') {
    if (starter) {
      errors.push(
        'A server script cannot live in a Starter container — those are copied to every client. Put server logic in ServerScriptService.',
      )
      return null
    }
    return {
      className: 'Script',
      props: {
        Source: src,
        RunContext: { type: 'token', value: 0, enumName: 'RunContext', itemName: 'Server' },
      },
    }
  }
  if (kind === 'client') {
    // Starter* containers are copied to clients, so a Script with RunContext
    // would run twice (original and copy) — use a LocalScript there.
    if (starter) return { className: 'LocalScript', props: { Source: src } }
    return {
      className: 'Script',
      props: {
        Source: src,
        RunContext: { type: 'token', value: 0, enumName: 'RunContext', itemName: 'Client' },
      },
    }
  }
  errors.push(`Unknown script kind "${kind}". Use "server", "client" or "module".`)
  return null
}

/* ----------------------------------------------------------------- mapping */

export function mapToolCall(
  name: string,
  input: unknown,
  tree: RbxTree,
  reflection: Reflection | null = null,
): MappedToolCall {
  const errors: string[] = []
  const args = asRecord(input) ?? {}

  switch (name) {
    case 'get_tree_outline': {
      return {
        ops: [],
        readResult: { outline: truncate(outline(tree)) },
        errors,
        activity: 'Reading the project',
      }
    }

    case 'get_instances': {
      const ids = Array.isArray(args.ids) ? args.ids.filter((i): i is string => typeof i === 'string') : []
      if (ids.length === 0) errors.push('"ids" must be a non-empty array of instance ids.')
      const found = ids.length ? getInstances(tree, ids) : []
      const missing = ids.filter((id) => !found.some((f) => f.id === id))
      return {
        ops: [],
        readResult: {
          instances: JSON.parse(truncateJson(found)),
          ...(missing.length ? { missingIds: missing } : {}),
        },
        errors,
        activity: `Reading ${plural(ids.length, 'object', 'objects')}`,
      }
    }

    case 'create_instances': {
      const items = Array.isArray(args.instances) ? args.instances : []
      if (items.length === 0) errors.push('"instances" must be a non-empty array.')
      const ops: PatchOp[] = []
      const created: Array<{ id: string; name: string; className: string }> = []
      items.forEach((raw, i) => {
        const rec = asRecord(raw)
        const parentId = rec ? asString(rec.parentId) : null
        if (!parentId) {
          errors.push(`instances[${i}]: "parentId" is required.`)
          return
        }
        const instance = buildInstance(raw, `instances[${i}]`, errors, reflection)
        if (!instance) return
        ops.push({ op: 'create', parentId, instance })
        flatten(instance, created)
      })
      const parentName = firstParentName(tree, ops)
      return {
        ops,
        errors,
        activity: `Adding ${created.length} ${classNoun(created)}${parentName ? ` to ${parentName}` : ''}`,
      }
    }

    case 'update_instances': {
      const items = Array.isArray(args.updates) ? args.updates : []
      if (items.length === 0) errors.push('"updates" must be a non-empty array.')
      const ops: PatchOp[] = []
      items.forEach((raw, i) => {
        const rec = asRecord(raw)
        const id = rec ? asString(rec.id) : null
        if (!id) {
          errors.push(`updates[${i}]: "id" is required.`)
          return
        }
        const errorsBefore = errors.length
        const target = instanceLabel(tree, id)
        const props = coerceProps(
          target?.className ?? null,
          rec?.props,
          `updates[${i}]`,
          errors,
          true,
          reflection,
        )
        // A malformed property voids the whole update — never apply half of it.
        if (errors.length > errorsBefore) return
        // Name is not a serialized property in our tree — it is a rename op.
        const propName = props.Name
        if (propName !== undefined) delete props.Name
        const newName =
          (rec && asString(rec.name)) ??
          (propName && propName.type === 'string' ? propName.value : null)
        if (Object.keys(props).length > 0) ops.push({ op: 'update', id, props })
        if (newName) ops.push({ op: 'rename', id, name: newName })
        if (Object.keys(props).length === 0 && !newName) {
          errors.push(`updates[${i}]: nothing to change — send "props" and/or "name".`)
        }
      })
      return {
        ops,
        errors,
        activity: `Updating ${plural(items.length, 'object', 'objects')}`,
      }
    }

    case 'delete_instances': {
      const ids = Array.isArray(args.ids) ? args.ids.filter((i): i is string => typeof i === 'string') : []
      if (ids.length === 0) errors.push('"ids" must be a non-empty array of instance ids.')
      return {
        ops: ids.map((id) => ({ op: 'delete', id })),
        errors,
        activity: `Removing ${plural(ids.length, 'object', 'objects')}`,
      }
    }

    case 'write_script': {
      const source = typeof args.source === 'string' ? args.source : null
      if (source === null) {
        errors.push('"source" is required (the complete Luau source).')
        return { ops: [], errors, activity: 'Writing a script' }
      }
      const existingId = asString(args.id)
      if (existingId) {
        const label = instanceLabel(tree, existingId)
        if (!label) errors.push(`No instance with id ${existingId}.`)
        const ops: PatchOp[] = [
          {
            op: 'update',
            id: existingId,
            props: { Source: { type: 'ProtectedString', value: source } },
          },
        ]
        const rename = asString(args.name)
        if (rename && label && rename !== label.name) {
          ops.push({ op: 'rename', id: existingId, name: rename })
        }
        return {
          ops,
          errors,
          activity: `Updating ${label ? label.name : 'a script'}`,
        }
      }

      const parentId = asString(args.parentId)
      const scriptName = asString(args.name)
      const kind = asString(args.kind)
      if (!parentId) errors.push('"parentId" is required when creating a script.')
      if (!scriptName) errors.push('"name" is required when creating a script.')
      if (!kind) errors.push('"kind" is required: "server", "client" or "module".')
      if (!parentId || !scriptName || !kind) {
        return { ops: [], errors, activity: 'Writing a script' }
      }
      const shape = scriptShape(kind, tree, parentId, source, errors)
      if (!shape) return { ops: [], errors, activity: 'Writing a script' }
      const instance: RbxInstance = {
        id: newId(),
        className: shape.className,
        name: scriptName,
        props: shape.props,
        children: [],
      }
      return {
        ops: [{ op: 'create', parentId, instance }],
        errors,
        activity: `Writing ${scriptName}`,
      }
    }

    case 'insert_template': {
      const template = asString(args.template)
      const parentId = asString(args.parentId)
      const templateName = asString(args.name)
      const position = args.position
      if (template !== 'blocky_npc') {
        errors.push(`Unknown template ${JSON.stringify(args.template)}. Only "blocky_npc" exists.`)
      }
      if (!parentId) errors.push('"parentId" is required.')
      if (!templateName) errors.push('"name" is required.')
      if (!isNumberTriple(position)) errors.push('"position" must be [x, y, z] numbers.')
      if (errors.length > 0 || !parentId || !templateName || !isNumberTriple(position)) {
        return { ops: [], errors, activity: 'Adding a character' }
      }
      const instance = blockyNpc(templateName, position)
      const parentLabel = instanceLabel(tree, parentId)
      return {
        ops: [{ op: 'create', parentId, instance }],
        errors,
        activity: `Adding ${templateName}${parentLabel ? ` to ${parentLabel.name}` : ''}`,
      }
    }

    default:
      return {
        ops: [],
        errors: [`Unknown tool "${name}".`],
        activity: 'Working',
      }
  }
}

/** Flat list of everything the given create ops brought into existence. */
export function createdFrom(ops: PatchOp[]): Array<{ id: string; name: string; className: string }> {
  const out: Array<{ id: string; name: string; className: string }> = []
  for (const op of ops) if (op.op === 'create') flatten(op.instance, out)
  return out
}

function firstParentName(tree: RbxTree, ops: PatchOp[]): string | null {
  const first = ops.find((o) => o.op === 'create')
  if (!first || first.op !== 'create') return null
  return instanceLabel(tree, first.parentId)?.name ?? null
}

/* ---------------------------------------------------------------- summaries */

export interface AppliedSummary {
  /** Sentence for the `tool_done` event. */
  activity: string
  /** Transcript chip per DESIGN.md, or null for read-only tools. */
  chip: string | null
}

/**
 * Describe what actually landed. `tree` must be the tree BEFORE the ops were
 * applied so deleted/renamed instances can still be named.
 */
export function describeApplied(name: string, ops: PatchOp[], tree: RbxTree): AppliedSummary {
  switch (name) {
    case 'get_tree_outline':
      return { activity: 'Read the project', chip: null }
    case 'get_instances':
      return { activity: 'Read the project', chip: null }

    case 'insert_template': {
      const root = ops.find((o) => o.op === 'create')
      if (!root || root.op !== 'create') return { activity: 'Nothing added', chip: null }
      const parentName = firstParentName(tree, ops)
      return {
        activity: `Added ${root.instance.name}${parentName ? ` to ${parentName}` : ''}`,
        chip: `+ ${root.instance.name}${parentName ? ` · ${parentName}` : ''}`,
      }
    }

    case 'create_instances': {
      const created: Array<{ id: string; name: string; className: string }> = []
      for (const op of ops) if (op.op === 'create') flatten(op.instance, created)
      if (created.length === 0) return { activity: 'Nothing added', chip: null }
      const parentName = firstParentName(tree, ops)
      const noun = classNoun(created)
      return {
        activity: `Added ${created.length} ${noun}${parentName ? ` to ${parentName}` : ''}`,
        chip: `+ ${created.length} ${noun}${parentName ? ` · ${parentName}` : ''}`,
      }
    }

    case 'update_instances': {
      const ids = new Set(ops.map((o) => ('id' in o ? o.id : '')))
      ids.delete('')
      if (ids.size === 0) return { activity: 'Nothing changed', chip: null }
      if (ids.size === 1) {
        const label = instanceLabel(tree, [...ids][0])
        const text = label ? `${label.name} (${label.className})` : '1 instance'
        return { activity: `Changed ${text}`, chip: `✎ ${text}` }
      }
      return {
        activity: `Changed ${ids.size} objects`,
        chip: `✎ ${ids.size} instances`,
      }
    }

    case 'delete_instances': {
      const n = ops.filter((o) => o.op === 'delete').length
      if (n === 0) return { activity: 'Nothing removed', chip: null }
      if (n === 1) {
        const op = ops.find((o) => o.op === 'delete')
        const label = op && op.op === 'delete' ? instanceLabel(tree, op.id) : null
        const text = label ? `${label.name} (${label.className})` : '1 instance'
        return { activity: `Removed ${text}`, chip: `− ${text}` }
      }
      return { activity: `Removed ${n} objects`, chip: `− ${n} instances` }
    }

    case 'write_script': {
      const create = ops.find((o) => o.op === 'create')
      if (create && create.op === 'create') {
        return {
          activity: `Wrote ${create.instance.name}`,
          chip: `✎ ${create.instance.name} (${create.instance.className})`,
        }
      }
      const update = ops.find((o) => o.op === 'update')
      const label = update && update.op === 'update' ? instanceLabel(tree, update.id) : null
      const text = label ? `${label.name} (${label.className})` : 'script'
      return { activity: `Updated ${text}`, chip: `✎ ${text}` }
    }

    default:
      return { activity: 'Done', chip: null }
  }
}

/* --------------------------------------------------------------- truncation */

export function truncate(text: string, limit = RESULT_CHAR_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}\n… truncated.` : text
}

function truncateJson(value: unknown, limit = RESULT_CHAR_LIMIT): string {
  const json = JSON.stringify(value)
  if (json.length <= limit) return json
  // Drop whole entries until it fits rather than emitting invalid JSON.
  if (Array.isArray(value)) {
    const kept: unknown[] = []
    let size = 2
    for (const item of value) {
      const piece = JSON.stringify(item)
      if (size + piece.length + 1 > limit) break
      kept.push(item)
      size += piece.length + 1
    }
    return JSON.stringify(kept)
  }
  return '[]'
}
