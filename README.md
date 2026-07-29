# Bloxable

Bloxable is a prompt-first Roblox creation app. You describe a game in plain language and an AI edits a real Roblox place: every change is a validated patch against a canonical instance tree, rendered live in a three.js preview, projected to a genuine Rojo project and built into a real `.rbxl` / `.rbxlx` by a pinned Rojo binary. Export the file and open it in Studio, or publish straight to an experience you already own through the Roblox Open Cloud API. Nothing is mocked — class and property names are validated against the official Roblox API dump, and upstream Roblox and model-provider errors are surfaced verbatim.

## Run

```bash
npm install
npm run setup                      # downloads pinned rojo 7.7.0 + lune 0.10.5 into bin/, fetches the API dump
echo "OPENAI_API_KEY=sk-..." >> .env.local     # or ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

`npm run setup` is idempotent and picks the right binaries for macOS, Linux or Windows on x86_64 or arm64 (`scripts/setup-tools.mjs`). Without a model key the app still runs — projects, the 3D preview and export all work — but chat returns an explicit key-missing error instead of a reply.

### Model provider

The chat loop runs on either provider, chosen by whichever key is in `.env.local` (`OPENAI_API_KEY` wins if both are set). Defaults are `gpt-5.5` and `claude-sonnet-5`; override with an `OPENAI_MODEL` or `ANTHROPIC_MODEL` line. The vendor is confined to `lib/ai/providers/` — tools, validation, patching and persistence are shared, so behaviour is identical either way.

`npm run test:engine` builds a place with the real toolchain and verifies it by deserializing with Lune. `npm run test:ai` checks the chat tool layer against the real API dump: bare property values are typed from the dump, wrong ones are rejected by name.

## Publish

Publishing needs a one-time Roblox setup, because **no Roblox API can create an experience**. The exact three steps live in the app: gear icon → "Where do I find these?". In short: publish a place once from Studio (File → Publish to Roblox), copy the Universe ID and Place ID from your creations dashboard, then mint an Open Cloud API key with `universe-places` Write scope for that experience and paste it into the settings sheet. After that Studio is never needed again — Bloxable updates the place directly.

The key is stored server-side in `data/settings.json` and never sent to the browser (the settings sheet only ever shows the last 4 characters).

## What works today

- Projects persisted on disk under `data/` (atomic writes), seeded from the real Studio Baseplate template.
- Chat → tool-use loop → validated `PatchOp`s → live tree, viewer and file list updates over SSE.
- Every op checked against the official API dump: class exists, property exists, enum name resolved to its token.
- `.rbxlx` export (always available) and Open Cloud publish.
- 3D preview: parts, wedges, cylinders, spheres, BrickColors, materials, lighting and fog read from the real tree.
- 25 free messages/day, enforced server-side.

## Known limitations

These are real constraints, not TODOs we forgot:

- **No experience-creation API.** Roblox has no endpoint that mints a universe or place, so the one-time Studio step above is unavoidable.
- **10 MiB publish cap.** Open Cloud rejects place uploads over 10,485,760 bytes. Bloxable warns at 8 MiB and blocks past the cap, pointing you at export instead.
- **The preview is an approximation.** Terrain, MeshParts, decal/texture images and GUI instances are not rendered — they show up in Roblox only. Materials are PBR approximations and the sun direction is not Roblox's real formula.
- **Some classes are refused.** Solid modelling (`UnionOperation`, `NegateOperation`, `IntersectOperation`, `PartOperation`), `SurfaceAppearance`, `EditableImage`, `EditableMesh` and the avatar wrap classes are blocked, because the publish API silently ignores them — a place containing them would upload "successfully" and be wrong.
- **NPCs are blocky, not avatars.** Avatar-grade characters need uploaded mesh assets. The `blocky_npc` template is a real R6-shaped rig with computed `Motor6D` joints and a walk script, and it has no animations — it slides.
- **Some property types can't be set yet.** `UDim2`, `NumberRange`, `Font`, `PhysicalProperties`, attributes and tags are outside the tree format, so requests needing them are refused with an explicit message rather than silently dropped.
- **Local, single user.** All state is on disk; there is no auth, no multi-user isolation, and concurrent builds of one project would race. The upgrade button in the paywall is explicitly not wired.
- **Not yet opened in Studio.** Generated places are verified by round-tripping through Lune, but no one has loaded one into Roblox Studio and pressed Play.
