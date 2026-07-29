// RbxTree → a real Rojo 7 project (default.project.json + src/**).
//
// Conventions used here were verified against the pinned rojo 7.7.0 binary, not
// recalled: property values always use Rojo's EXPLICIT typed form (survives
// reflection-DB lag), instance identity for Ref properties uses Rojo's
// Rojo_Id / Rojo_Target_<Property> attribute mechanism (the `$id` + {"Ref": …}
// form silently emits dangling referents), and duplicate sibling names are
// carried in `.model.json` children arrays because project-file keys — which
// ARE the instance name, `Name` cannot be set as a property — must be unique.

import type { RbxAttrValue, RbxInstance, RbxPropValue, RbxTree } from './types'
import { indexTree } from './tree'

/** Classes whose children Rojo can express as real files on disk. */
const CONTAINER_CLASSES = new Set(['Folder'])

/** Script classes Rojo can emit as `.luau` files with emitLegacyScripts:false. */
const FILE_SCRIPT_CLASSES = new Set(['Script', 'ModuleScript'])

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

interface ModelNode {
  name?: string
  className: string
  properties?: Record<string, Json>
  attributes?: Record<string, Json>
  children?: ModelNode[]
}

function stringifyJson(value: Json): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** Deterministic, filesystem-safe base name. */
function slug(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned.length > 0 ? cleaned.slice(0, 48) : 'Instance'
}

/** Per-directory name registry: deterministic `_2`, `_3`, … suffixes. */
class NameRegistry {
  private used = new Set<string>()

  take(preferred: string): string {
    const base = slug(preferred)
    let candidate = base
    let n = 2
    while (this.used.has(candidate.toLowerCase())) {
      candidate = `${base}_${n}`
      n += 1
    }
    this.used.add(candidate.toLowerCase())
    return candidate
  }
}

// --- property projection ----------------------------------------------------

/**
 * Roblox properties whose type is Content/ContentId. `lib/rbx/types.ts` carries
 * asset URIs as plain strings, but Rojo refuses `{"String": …}` for these — it
 * wants `{"ContentId": …}` and migrates e.g. Decal.Texture → TextureContent.
 *
 * Generated from the cached API dump (every property with ValueType.Name of
 * Content or ContentId); the only name that is also a plain string elsewhere is
 * PluginMenu.Icon, which cannot appear in a place file. Regenerate with:
 *   node -e "const d=require('./data/cache/api-dump.json');const s=new Set();
 *     for(const c of d.Classes)for(const m of c.Members||[])
 *       if(m.MemberType==='Property'&&/^Content(Id)?$/.test(m.ValueType.Name))s.add(m.Name);
 *     console.log(JSON.stringify([...s].sort()))"
 */
const CONTENT_PROPERTY_NAMES = new Set([
  'ActivatedCursorIcon', 'ActivatedCursorIconContent', 'AnimationContent', 'AnimationId',
  'Asset', 'AudioContent', 'BaseTextureContent', 'BottomImage', 'BottomImageContent',
  'CageMeshContent', 'CageMeshId', 'CameraButtonIcon', 'CameraButtonIconContent', 'ColorMap',
  'ColorMapContent', 'CursorIcon', 'CursorIconContent', 'DisplayImage', 'EmissiveMaskContent',
  'FallbackImage', 'FallbackImageContent', 'Graphic', 'HSRAssetId', 'HSRContent', 'HoverImage',
  'HoverImageContent', 'Icon', 'IconContent', 'Image', 'ImageContent', 'LinkedSource',
  'MeshContent', 'MeshId', 'MetalnessMap', 'MetalnessMapContent', 'MidImage', 'MidImageContent',
  'MoonTextureContent', 'MoonTextureId', 'MouseIcon', 'MouseIconContent', 'NormalMap',
  'NormalMapContent', 'OverlayTextureContent', 'PackageContent', 'PackageId', 'PantsTemplate',
  'PantsTemplateContent', 'PressedImage', 'PressedImageContent', 'ReferenceCageMeshContent',
  'ReferenceMeshContent', 'ReferenceMeshId', 'RoughnessMap', 'RoughnessMapContent',
  'ShirtTemplate', 'ShirtTemplateContent', 'SkyboxBackContent', 'SkyboxBk', 'SkyboxDn',
  'SkyboxDownContent', 'SkyboxFrontContent', 'SkyboxFt', 'SkyboxLeftContent', 'SkyboxLf',
  'SkyboxRightContent', 'SkyboxRt', 'SkyboxUp', 'SkyboxUpContent', 'SoundId', 'SunTextureContent',
  'SunTextureId', 'Texture', 'TextureContent', 'TextureID', 'TextureId', 'TexturePack',
  'TexturePackContent', 'TopImage', 'TopImageContent', 'Video', 'VideoContent',
])

/** Rojo's explicit typed property form. Returns null for values Rojo takes elsewhere. */
function rojoValue(propName: string, prop: RbxPropValue): Json | null {
  switch (prop.type) {
    case 'string':
      return CONTENT_PROPERTY_NAMES.has(propName)
        ? { ContentId: prop.value }
        : { String: prop.value }
    case 'bool':
      return { Bool: prop.value }
    case 'int':
      return { Int32: prop.value }
    case 'int64':
      return { Int64: prop.value }
    case 'float':
      return { Float32: prop.value }
    case 'double':
      return { Float64: prop.value }
    case 'token':
      return { Enum: prop.value }
    case 'Vector3':
      return { Vector3: [...prop.value] }
    case 'Color3':
      return { Color3: [...prop.value] }
    case 'ProtectedString':
      return { String: prop.value }
    case 'CFrame': {
      const r = prop.value.rot
      return {
        CFrame: {
          position: [...prop.value.pos],
          orientation: [
            [r[0], r[1], r[2]],
            [r[3], r[4], r[5]],
            [r[6], r[7], r[8]],
          ],
        },
      }
    }
    case 'UDim':
      return { UDim: [...prop.value] }
    case 'UDim2':
      return { UDim2: [[...prop.value[0]], [...prop.value[1]]] }
    case 'Vector2':
      return { Vector2: [...prop.value] }
    case 'Rect':
      return { Rect: [[...prop.value[0]], [...prop.value[1]]] }
    case 'NumberRange':
      return { NumberRange: [...prop.value] }
    case 'NumberSequence':
      return {
        NumberSequence: {
          keypoints: prop.value.map((k) => ({ time: k.time, value: k.value, envelope: k.envelope })),
        },
      }
    case 'ColorSequence':
      return {
        ColorSequence: {
          keypoints: prop.value.map((k) => ({ time: k.time, color: [...k.color] })),
        },
      }
    case 'Font':
      return {
        Font: {
          family: prop.value.family,
          weight: prop.value.weight,
          style: prop.value.style,
        },
      }
    case 'PhysicalProperties':
      // rbx-dom takes the tagged enum: "Default", or Custom with all six fields
      // (acousticAbsorption included — it is required and undocumented).
      return prop.value === 'Default'
        ? { PhysicalProperties: 'Default' }
        : {
            PhysicalProperties: {
              density: prop.value.density,
              friction: prop.value.friction,
              elasticity: prop.value.elasticity,
              frictionWeight: prop.value.frictionWeight,
              elasticityWeight: prop.value.elasticityWeight,
              acousticAbsorption: prop.value.acousticAbsorption,
            },
          }
    case 'Ref':
      // Refs travel as Rojo_Target_<Property> attributes.
      return null
    default:
      return null
  }
}

/** Instance attribute → Rojo's explicit typed form. */
function rojoAttrValue(attr: RbxAttrValue): Json {
  switch (attr.type) {
    case 'string':
      return { String: attr.value }
    case 'bool':
      return { Bool: attr.value }
    case 'double':
      return { Float64: attr.value }
    case 'Vector3':
      return { Vector3: [...attr.value] }
    case 'Color3':
      return { Color3: [...attr.value] }
    case 'UDim2':
      return { UDim2: [[...attr.value[0]], [...attr.value[1]]] }
  }
}

interface Projected {
  properties: Record<string, Json>
  attributes: Record<string, Json>
}

function projectProps(
  inst: RbxInstance,
  refTargets: Set<string>,
  skip: Set<string>,
): Projected {
  const properties: Record<string, Json> = {}
  const attributes: Record<string, Json> = {}

  if (refTargets.has(inst.id)) attributes.Rojo_Id = inst.id

  for (const attrName of Object.keys(inst.attributes ?? {})) {
    // Rojo owns the Rojo_* attribute namespace for instance identity; a user
    // attribute must never be able to forge a ref target.
    if (attrName.startsWith('Rojo_')) continue
    attributes[attrName] = rojoAttrValue(inst.attributes![attrName])
  }

  if (inst.tags && inst.tags.length > 0) properties.Tags = { Tags: [...inst.tags] }

  for (const propName of Object.keys(inst.props)) {
    if (propName === 'Name' || skip.has(propName)) continue
    const prop = inst.props[propName]
    if (prop.type === 'Ref') {
      // A dangling ref is simply omitted; the property stays nil, exactly as a
      // Roblox file with an unset Ref would.
      if (prop.value && refTargets.has(prop.value)) {
        attributes[`Rojo_Target_${propName}`] = prop.value
      }
      continue
    }
    const value = rojoValue(propName, prop)
    if (value !== null) properties[propName] = value
  }

  return { properties, attributes }
}

// --- script files -----------------------------------------------------------

function sourceOf(inst: RbxInstance): string {
  const src = inst.props.Source
  if (src && (src.type === 'ProtectedString' || src.type === 'string')) return src.value
  return ''
}

function runContextOf(inst: RbxInstance): number {
  const rc = inst.props.RunContext
  return rc && rc.type === 'token' ? rc.value : 0
}

// --- projection -------------------------------------------------------------

export function projectFromTree(tree: RbxTree, name: string): Record<string, string> {
  const files: Record<string, string> = {}
  const index = indexTree(tree)

  // Only instances something actually points at get a Rojo_Id attribute.
  const refTargets = new Set<string>()
  for (const [, entry] of index) {
    for (const propName of Object.keys(entry.inst.props)) {
      const prop = entry.inst.props[propName]
      if (prop.type === 'Ref' && prop.value && index.has(prop.value)) refTargets.add(prop.value)
    }
  }

  const isFileScript = (inst: RbxInstance) => FILE_SCRIPT_CLASSES.has(inst.className)

  const hasFileScriptDescendant = (inst: RbxInstance): boolean =>
    inst.children.some(
      (child) =>
        isFileScript(child) ||
        (CONTAINER_CLASSES.has(child.className) && hasFileScriptDescendant(child)),
    )

  /** Inline (model.json) form of an instance and everything under it. */
  const modelNodeFor = (inst: RbxInstance, includeName: boolean): ModelNode => {
    const { properties, attributes } = projectProps(inst, refTargets, new Set())
    const node: ModelNode = { className: inst.className }
    if (includeName) node.name = inst.name
    if (Object.keys(properties).length > 0) node.properties = properties
    if (Object.keys(attributes).length > 0) node.attributes = attributes
    if (inst.children.length > 0) {
      node.children = inst.children.map((child) => modelNodeFor(child, true))
    }
    return node
  }

  /**
   * Emits a script as a real `.luau` file (plus a `.meta.json` when its
   * properties are not implied by the file name) and returns the project node.
   */
  const emitScriptFile = (
    inst: RbxInstance,
    dir: string,
    registry: NameRegistry,
  ): Record<string, Json> => {
    const base = registry.take(inst.name)
    const isModule = inst.className === 'ModuleScript'
    const runContext = runContextOf(inst)
    const suffix = isModule ? '.luau' : runContext === 2 ? '.client.luau' : '.server.luau'
    const scriptPath = `${dir}/${base}${suffix}`
    files[scriptPath] = sourceOf(inst)

    const { properties, attributes } = projectProps(
      inst,
      refTargets,
      new Set(['Source', 'RunContext']),
    )
    // The file extension already implies RunContext Server(1)/Client(2); anything
    // else (Legacy, Plugin) has to be stated.
    const impliedRunContext = isModule ? null : runContext === 2 ? 2 : 1
    if (impliedRunContext !== null && runContext !== impliedRunContext) {
      properties.RunContext = { Enum: runContext }
    }
    if (Object.keys(properties).length > 0 || Object.keys(attributes).length > 0) {
      const meta: Record<string, Json> = {}
      if (Object.keys(properties).length > 0) meta.properties = properties
      if (Object.keys(attributes).length > 0) meta.attributes = attributes
      files[`${dir}/${base}.meta.json`] = stringifyJson(meta)
    }

    return { $path: scriptPath }
  }

  /**
   * A "spine" instance keeps its identity in default.project.json so real files
   * can hang off it. Everything else is described inline in its model.json.
   */
  const emitSpine = (inst: RbxInstance, modelPath: string, dir: string): Record<string, Json> => {
    const node: Record<string, Json> = { $path: modelPath }
    const keys = new Set<string>()
    const fileNames = new NameRegistry()
    const inlineChildren: ModelNode[] = []

    for (const child of inst.children) {
      const keyIsFree = !keys.has(child.name) && !child.name.startsWith('$') && child.name.length > 0

      if (keyIsFree && isFileScript(child)) {
        keys.add(child.name)
        node[child.name] = emitScriptFile(child, dir, fileNames)
        continue
      }

      if (keyIsFree && CONTAINER_CLASSES.has(child.className) && hasFileScriptDescendant(child)) {
        keys.add(child.name)
        const childBase = fileNames.take(child.name)
        node[child.name] = emitSpine(child, `${dir}/${childBase}.model.json`, `${dir}/${childBase}`)
        continue
      }

      inlineChildren.push(modelNodeFor(child, true))
    }

    const { properties, attributes } = projectProps(inst, refTargets, new Set())
    const model: ModelNode = { className: inst.className }
    if (Object.keys(properties).length > 0) model.properties = properties
    if (Object.keys(attributes).length > 0) model.attributes = attributes
    if (inlineChildren.length > 0) model.children = inlineChildren
    files[modelPath] = stringifyJson(model as unknown as Json)

    return node
  }

  const treeNode: Record<string, Json> = { $className: 'DataModel' }
  const serviceFiles = new NameRegistry()
  const serviceKeys = new Set<string>()
  for (const service of tree.services) {
    if (serviceKeys.has(service.name)) continue // a DataModel cannot hold two of the same service
    serviceKeys.add(service.name)
    const base = serviceFiles.take(service.name)
    treeNode[service.name] = emitSpine(service, `src/${base}.model.json`, `src/${base}`)
  }

  files['default.project.json'] = stringifyJson({
    name: name || 'place',
    emitLegacyScripts: false,
    tree: treeNode,
  })

  return files
}
