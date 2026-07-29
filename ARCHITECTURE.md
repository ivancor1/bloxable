# ARCHITECTURE.md — FINAL (decisions locked against RESEARCH.md, 2026-07-27)

Next.js 16.2 App Router, React 19, TypeScript, Tailwind v4, three 0.185, zustand 5, @anthropic-ai/sdk.
Local-first: all runtime state on disk under `data/` (gitignored). No external DB in v1.
NOTE: this Next.js version may differ from training data — read `node_modules/next/dist/docs/` guides before writing App Router code.

## Resolved decisions (rationale + exact facts live in RESEARCH.md — read it)

**D1 — Canonical model & place building.** Source of truth is our JSON `RbxTree` (`lib/rbx/types.ts`, LOCKED); the AI mutates it only through `PatchOp`s. To produce place files we project the tree to a REAL Rojo project (`default.project.json` with `emitLegacyScripts:false` + `src/**/*.luau` files) and shell out to a pinned Rojo 7.7.0 binary (`bin/rojo`) → `.rbxl` / `.rbxlx` (~11 ms). Lune 0.10.5 (`bin/lune`) is the verify sidecar (deserialize + assertions) used by the engine test, not per-turn. NO hand-rolled XML emitter (RESEARCH Part 2 documents the silent-corruption traps; that knowledge informs the validator only). Rojo project properties use API names in Rojo's EXPLICIT typed form always (survives reflection-DB lag; Rojo handles file-level SerializesAs renames). Projection rule for scripts: scripts whose ancestors are all services/Folders become real `src/**` `.luau` files; scripts nested under other instances (e.g. inside a Part) are emitted inline with a `Source` property.

**D1b — Property value types (extended 2026-07-28).** `RbxPropValue` covers the 12 original tags plus `UDim`, `UDim2`, `Vector2`, `Rect`, `NumberRange`, `NumberSequence`, `ColorSequence`, `Font` and `PhysicalProperties`. Together those nine were 116 real settable properties in the dump that the validator used to skip — every GUI `Size`/`Position`, `UICorner` radius, `UIListLayout` padding, `TextLabel.FontFace`, `ParticleEmitter` lifetime/size/transparency/colour, 9-slice `Rect`s and `BasePart.CustomPhysicalProperties`. Because of them the system prompt no longer forbids interface elements. `RbxInstance` also carries optional `attributes` (the creator data bag, `RbxAttrValue`) and `tags` (CollectionService), and `PatchOp.update` can change both. Every one of these was probed against the pinned rojo 7.7.0 binary before being added: `PhysicalProperties` needs all six camelCase fields including the undocumented `acousticAbsorption`; instance attributes go in the model node's `attributes` map (Rojo owns the `Rojo_*` names there, so user attributes with that prefix are dropped); tags go through as a `Tags` property. Font families are validated against the list Roblox publishes in its own Font datatype reference (`lib/rbx/fonts.ts`) — an unknown family is an error, never a silent fallback.

**D2 — Publish.** `POST https://apis.roblox.com/universes/v1/{universeId}/places/{placeId}/versions?versionType=Published` with `x-api-key` + `Content-Type: application/octet-stream` and the `.rbxl` bytes. Success = `{"versionNumber":N}`. Pre-check size: warn ≥ 8 MiB, block > 10,485,760 bytes (the Open Cloud cap) with export suggested. Surface Roblox error messages verbatim. "Test connection" = `POST https://apis.roblox.com/api-keys/v1/introspect` (see RESEARCH Part 1 Q4/setup). Per-turn chat does NOT rebuild the place; builds happen on export/publish/test only.

**D3 — Auth & onboarding (v1, local app).** The user pastes their OWN API key into their OWN local instance = the operator model Roblox blesses ("your own tooling against your own resources"); this is exactly how the Rojo ecosystem works. The third-party-app prohibition on collecting others' keys applies to a HOSTED service — documented for later: hosted multi-user Bloxable would use platform-owned universes with pooled places, or OAuth if Roblox ever ships `universe-places:write` for OAuth apps (it does not exist today; verified). One-time Studio step is unavoidable and stated honestly in the UI: NO API creates a universe/place (verified 404s), so the user mints the experience once in Studio (File → Publish), then never opens Studio again for updates.

**D4 — Export.** `.rbxlx` download always available, labeled "your game file — open it in Roblox Studio". This is also the overflow path for >10 MiB places and the path to user-owned experiences at scale.

**D5a — Token cost of the loop.** The model pays for every character it reads and writes, on every round of a build. So: property values cross the tool boundary as bare JSON (`"Size":[8,1,8]`, `"Material":"Slate"`) and are typed server-side from the API dump — the tagged `RbxPropValue` form is still accepted and is still what the tree stores; instance ids are 8 base36 characters, not UUIDs, because ids repeat in the outline and in every reference; `get_tree_outline` returns "unchanged" when the place has not moved since the model last read it; and both providers cache their prefix — Anthropic with a fixed breakpoint on the static system block plus one that rolls forward through the conversation each round, OpenAI by sending the static prompt and the volatile context as two separate system messages (a single concatenated one made every request a cache miss) with a per-project `prompt_cache_key`.

**D5 — AI tool surface (exactly these):** `get_tree_outline`, `get_instances`, `create_instances` (batch), `update_instances` (batch), `delete_instances`, `write_script`, `insert_template` (v1 templates: `blocky_npc`). `create_instances` and `update_instances` also carry `attributes` and `tags`. Every op validates against the cached official API dump (class exists, property exists, enum name→token, font weight/style, sequence keypoints run 0→1) plus a banned-class list — `PartOperation`/`UnionOperation`/`NegateOperation`/`IntersectOperation`, `SurfaceAppearance`, `EditableImage`, `EditableMesh`, `BaseWrap`/`WrapTarget`/`WrapLayer` — because the publish API silently ignores them (RESEARCH Part 1 Q1).

**D6 — NPCs.** No official R6 spec exists; avatar-grade NPCs need uploaded mesh assets. v1 ships an honest blocky rig template (Model: HumanoidRootPart + parts joined by arithmetically computed Motor6Ds — `C0 = Part0.CFrame:Inverse()*J`, `C1 = Part1.CFrame:Inverse()*J` — + Humanoid + walk/wander Script using MoveTo). Never claim avatar quality. System prompt must carry the AnimationConstraint-superseded-Motor6D caveat for player characters (RESEARCH Part 2).

**D7 — Viewer math.** Per RESEARCH Part 3: CFrame rows map straight into `Matrix4.set()` (both engines right-handed Y-up, forward −Z; 1 stud = 1 unit; no transpose). Cylinder axis along X; Ball diameter = min(Size); hand-authored Wedge/CornerWedge geometries; Truss = box placeholder (documented). BrickColor table + Color3; material PBR approximations (Neon = emissive, Glass = transmission); hemisphere + directional rig approximating the Baseplate template's Lighting (Technology=3, Brightness=3, TimeOfDay 14:30); sun direction is a disclosed approximation.

**D8 — Model.** Pluggable provider behind `lib/ai/provider.ts`, selected by the key present in `.env.local`: `OPENAI_API_KEY` → OpenAI (default `gpt-5.5`), else `ANTHROPIC_API_KEY` → Anthropic (default `claude-sonnet-5`); either default overridable via `OPENAI_MODEL` / `ANTHROPIC_MODEL`. No key → honest SSE `error` event, never a fake reply. Vendor SDKs are confined to `lib/ai/providers/*`; the loop in `lib/ai/index.ts` (rounds, validation, patch emission, persistence) is provider-agnostic, and `lib/ai/tools.ts` is the single canonical tool list both providers translate from. OpenAI uses Chat Completions — verified live: `max_tokens` is rejected in favour of `max_completion_tokens`, and `temperature` is rejected for any non-default value.

## Module map & ownership (builders stay inside their columns)

| Area | Owner | Contents |
|---|---|---|
| `lib/rbx/**` (except `types.ts`), `scripts/**`, `package.json` scripts | B1 engine | `tree.ts` (pure ops, isomorphic — no fs), `template.ts` (verified Baseplate values + blocky NPC), `validate.ts` (API-dump validator + banned classes + enum resolution), `rojo.ts` (tree→Rojo project projection), `build.ts` (shell to `bin/rojo`), `scripts/setup-tools.mjs` (download pinned rojo/lune macos-aarch64 + API dump → `bin/`, `data/cache/`), `scripts/test-engine.mjs` (golden test + lune verify) |
| `lib/store/**`, `app/api/projects/**`, `app/api/settings/**` | B2 persistence/publish | atomic fs CRUD (projects/trees/threads/settings/credits), export route (build → .rbxlx download), publish route (D2), settings routes (key write-only; GET returns masked), test-connection route |
| `lib/ai/**`, `app/api/chat/**` | B3 AI loop | system prompt (Luau style card + banned classes + RunContext rules + NPC stance + enum guidance, all from RESEARCH Part 2), tool defs (D5), executor bridging validate→tree ops→store, SSE per `lib/protocol.ts`, credits enforcement |
| `components/viewer/**` | B4 viewer | three.js canvas, geometry/material/lighting per D7, store subscription (applies PatchOps incrementally), raycast selection + outline-mesh highlight, orbit + RMB-look/WASD fly |
| `app/**` pages/layout, `components/ui/**`, `lib/state/**` | B5 shell | DESIGN.md implementation: tokens, sidebar (switcher/threads/files + read-only code sheet), composer + transcript dock (SSE consumer), topbar (credits pill/Export/Publish/gear), settings sheet (exact copy provided), paywall modal, empty states, keyboard; completes the store stub |

Shared LOCKED contracts: `lib/rbx/types.ts`, `lib/protocol.ts`, store shape in `lib/state/store.ts` (manager stub — B5 completes actions, keeps shape). `lib/config.ts` is manager-owned config.

## Module interfaces (implement exactly; report friction rather than drifting)

```ts
// lib/rbx/tree.ts (pure, importable client+server)
newId(): string
indexTree(tree: RbxTree): Map<string, { inst: RbxInstance; parentId: string | null }>
applyPatchOps(tree: RbxTree, ops: PatchOp[]): { tree: RbxTree; errors: string[] }  // immutable result
outline(tree: RbxTree): string                       // compact id-annotated outline for the AI
getInstances(tree: RbxTree, ids: string[]): RbxInstance[]

// lib/rbx/template.ts
defaultBaseplateTree(): RbxTree                      // exact Studio Baseplate values from RESEARCH Part 2
blockyNpc(name: string, position: [number, number, number]): RbxInstance

// lib/rbx/validate.ts
loadReflection(): Promise<Reflection>                // from data/cache/api-dump.json (throw with "run npm run setup" if absent)
validateOps(reflection: Reflection, tree: RbxTree, ops: PatchOp[]): { ok: PatchOp[]; errors: string[] }

// lib/rbx/rojo.ts
projectFromTree(tree: RbxTree, name: string): Record<string, string> // relPath → file contents

// lib/rbx/build.ts
buildPlace(projectId: string, format: 'rbxl' | 'rbxlx'): Promise<{ filePath: string; bytes: number }>

// lib/store/index.ts (server-only)
listProjects(): Promise<ProjectMeta[]>
createProject(name: string): Promise<ProjectMeta>    // seeds defaultBaseplateTree()
getProject(id): Promise<ProjectMeta>; updateProject(id, patch): Promise<ProjectMeta>
getTree(id): Promise<RbxTree>; saveTree(id, tree): Promise<void>
listThreads(id): Promise<ThreadSummary[]>; getThread(id, tid): Promise<Thread>; saveThread(id, thread): Promise<void>
getSettings(): Promise<{ robloxApiKey?: string; hasKey: boolean }>; saveSettings(patch): Promise<void>
getCredits(): Promise<{ remaining: number; total: number }>; spendCredit(): Promise<{ remaining: number; total: number }>

// lib/ai/index.ts
runChat(req: ChatRequest, emit: (e: ChatEvent) => void): Promise<void>
```

## Data layout (`data/`, gitignored)

```
data/
  projects/{projectId}/
    project.json  tree.json  threads/{threadId}.json
    build/                    # generated Rojo project + artifacts (transient)
  settings.json               # server-only (Roblox API key, universeId/placeId live on ProjectMeta.roblox)
  credits.json                # { day: 'YYYY-MM-DD', used: number }
  cache/api-dump.json         # official API dump, fetched by npm run setup
bin/rojo  bin/lune            # pinned binaries, downloaded by npm run setup (gitignored)
```

## Chat flow

1. Client POSTs `/api/chat` (ChatRequest) → SSE `ChatEvent` stream.
2. Server: credits check → Anthropic tool-use loop → each tool call: validateOps → applyPatchOps → saveTree → emit `patch` → … → persist thread, decrement credit, `credits` + `done`.
3. Client store applies `patch` ops (viewer + file tree react); text deltas and tool chips render per DESIGN.md.

## Credits v1

25 free messages/day (`lib/config.ts`), 1 credit per user message, enforced server-side pre-model. Paywall modal per DESIGN.md; upgrade button explicitly labeled not-wired.

## Honest-limitation copy (must appear where relevant; keep to one line each)

- Settings sheet: the 3-step one-time connect flow (Studio mint → copy IDs → API key) — exact copy in B5's brief.
- Preview footer line in settings sheet: "Preview renders real place data (parts, colors, lighting). Terrain, meshes and GUIs show in Roblox only."
- Paywall: "Upgrade — payments not wired in this build".
- Publish errors: Roblox messages verbatim; >10 MiB → "Too large for Open Cloud publish (10 MiB) — export instead."

## Deployment stance

v1 runs locally (`npm run dev`; requires `npm run setup` once and `ANTHROPIC_API_KEY` in `.env.local`). Hosted multi-user later = storage swap + platform-owned universes (RESEARCH Part 1 Path A) — documented, not built.
