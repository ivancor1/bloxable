// The canonical tool definitions. Exactly the seven tools in ARCHITECTURE.md D5.
//
// Schemas are deliberately shallow and boring: the model fills a small, flat
// shape and the tagged property form is taught in the description (with worked
// examples) rather than encoded as a giant oneOf it has to satisfy.
//
// This list is provider-neutral and is the SINGLE source of truth: each provider
// in ./providers translates it into its own wire format (Anthropic passes
// input_schema through; OpenAI wraps it as a function tool's `parameters`).
// Never hand-maintain a second copy — the two would drift.

/** Provider-neutral tool definition; structurally compatible with Anthropic.Tool. */
export interface ToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
}

export const TOOL_NAMES = [
  'get_tree_outline',
  'get_instances',
  'create_instances',
  'update_instances',
  'delete_instances',
  'write_script',
  'insert_template',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

/** Shared prose describing the RbxPropValue tagged form (lib/rbx/types.ts). */
const PROPS_DOC = `Map of exact Roblox property name -> tagged value. Every value is an object with a "type" field.
Types: "string", "bool", "int", "int64", "float", "double", "token" (an Enum), "Vector3" ([x,y,z]), "CFrame" ({"pos":[x,y,z],"rot":[r00,r01,r02,r10,r11,r12,r20,r21,r22]}), "Color3" ([r,g,b] each 0..1), "ProtectedString" (script source), "Ref" (another instance's id, or null).
Example 1 — a red anchored block 8x1x8 at (0, 4, 0):
{"Size":{"type":"Vector3","value":[8,1,8]},"CFrame":{"type":"CFrame","value":{"pos":[0,4,0],"rot":[1,0,0,0,1,0,0,0,1]}},"Color":{"type":"Color3","value":[0.77,0.16,0.11]},"Anchored":{"type":"bool","value":true}}
Example 2 — a neon green sphere that players pass through:
{"Shape":{"type":"token","enumName":"PartType","itemName":"Ball"},"Material":{"type":"token","enumName":"Material","itemName":"Neon"},"Color":{"type":"Color3","value":[0.29,0.85,0.39]},"CanCollide":{"type":"bool","value":false},"Transparency":{"type":"float","value":0.2}}
For Enum properties always give enumName + itemName by name; the raw number is resolved from the official Roblox API dump for you.`

/** One level of the create_instances node, inlined to a fixed depth. */
function childNode(depth: number): Record<string, unknown> {
  const props: Record<string, unknown> = {
    className: {
      type: 'string',
      description: 'Exact Roblox class name, e.g. "Part", "Model", "PointLight", "Decal".',
    },
    name: { type: 'string', description: 'Instance.Name.' },
    properties: {
      type: 'object',
      description: PROPS_DOC,
      additionalProperties: true,
    },
  }
  if (depth > 0) {
    props.children = {
      type: 'array',
      description: 'Child instances created inside this one.',
      items: {
        type: 'object',
        properties: childNode(depth - 1),
        required: ['className', 'name'],
        additionalProperties: false,
      },
    }
  }
  return props
}

export const TOOLS: ToolDef[] = [
  {
    name: 'get_tree_outline',
    description:
      'Read the current place as a compact outline: every service, instance, class name and id. Call this after you change the place, or whenever you need an id you do not already have.',
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_instances',
    description:
      'Read the full property set of specific instances (and their children) by id. Use it before changing something you did not just create.',
    input_schema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          description: 'Instance ids from the outline or from a previous tool result.',
          items: { type: 'string' },
        },
      },
      required: ['ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_instances',
    description:
      'Create one or more instances. Batch everything you can into a single call — one call with 40 items, not 40 calls. Each item is placed under an existing parent id and may carry children nested up to three levels deep; for anything deeper, make a second call using the ids this one returns. Returns the new ids so you can reference them afterwards. Banned classes (PartOperation, UnionOperation, NegateOperation, IntersectOperation, SurfaceAppearance, EditableImage, EditableMesh, BaseWrap, WrapTarget, WrapLayer) are rejected — the Roblox publish API ignores them.',
    input_schema: {
      type: 'object',
      properties: {
        instances: {
          type: 'array',
          description: 'The instances to create.',
          items: {
            type: 'object',
            properties: {
              parentId: {
                type: 'string',
                description:
                  'Id of the existing instance to parent this under (a service id such as Workspace, or another instance).',
              },
              ...childNode(2),
            },
            required: ['parentId', 'className', 'name'],
            additionalProperties: false,
          },
        },
      },
      required: ['instances'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_instances',
    description:
      'Change properties on existing instances. Batch them. Only send the properties you want to change; a null value clears a property back to its class default.',
    input_schema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Id of the instance to change.' },
              name: {
                type: 'string',
                description: 'Optional new Instance.Name (renames it).',
              },
              props: {
                type: 'object',
                description: `${PROPS_DOC}\nUse null as the value to clear a property.`,
                additionalProperties: true,
              },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      required: ['updates'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_instances',
    description:
      'Delete instances (and everything inside them) by id. Never delete the Baseplate or the SpawnLocation unless the user asked for it.',
    input_schema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_script',
    description:
      'Write Luau. Creates a new script under parentId, or replaces the source of an existing script when you pass its id. "kind" picks the right Roblox class and run context for you: "server" -> Script with RunContext Server (put these in ServerScriptService), "client" -> Script with RunContext Client, or a LocalScript when the parent is StarterPlayerScripts / StarterCharacterScripts / StarterGui / StarterPack, "module" -> ModuleScript (put these in ReplicatedStorage, or ServerStorage if only the server uses it).',
    input_schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Id of an existing script to overwrite. Omit when creating a new one.',
        },
        parentId: {
          type: 'string',
          description: 'Where to create the script. Required unless "id" is given.',
        },
        name: {
          type: 'string',
          description: 'Script name, e.g. "RoundLoop". Required unless "id" is given.',
        },
        kind: {
          type: 'string',
          enum: ['server', 'client', 'module'],
          description: 'Required unless "id" is given.',
        },
        source: { type: 'string', description: 'The complete Luau source. Not a diff.' },
      },
      required: ['source'],
      additionalProperties: false,
    },
  },
  {
    name: 'insert_template',
    description:
      'Insert a ready-made template. "blocky_npc" builds a working blocky character: a Model with HumanoidRootPart, Torso, Head, arms and legs joined by Motor6Ds, plus a Humanoid. It is an honest blocky placeholder, not an avatar-quality character — avatar NPCs need uploaded mesh assets this app cannot create. Say so if the user expects a real avatar.',
    input_schema: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          enum: ['blocky_npc'],
        },
        parentId: {
          type: 'string',
          description: 'Usually the Workspace id.',
        },
        name: { type: 'string', description: 'Name for the new model, e.g. "Guard".' },
        position: {
          type: 'array',
          description: 'World position [x, y, z] in studs. The ground is at y = 0.',
          items: { type: 'number' },
        },
      },
      required: ['template', 'parentId', 'name', 'position'],
      additionalProperties: false,
    },
  },
]
