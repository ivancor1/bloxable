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

## Publish — the hosted-universe model

Bloxable follows the Lovable shape (STRATEGY.md): projects publish into places inside **one operator-owned universe**, and each project is auto-assigned a free place on its first Publish — end users never see an ID, a key, or Studio.

Operator setup is **one field**: paste an Open Cloud API key (or set `ROBLOX_API_KEY` in `.env.local`) and hit Connect. The universe and its places are derived from the key itself — introspection reports which experiences the key may publish to, and place lists are a public endpoint — so nothing is copied out of the creator dashboard. Publish also runs that discovery automatically if settings are empty, meaning a key alone is enough.

The only unavoidable manual step is creating the experience, because **no Roblox API can create one**: in Studio, File → Publish to Roblox on an empty Baseplate, once ever (add extra places there if you want to host several games). Then mint a key with the `universe-places` system + Write operation.

`npm run setup:universe -- --universe <id>` does the same discovery from the CLI, and `npm run mint:place` is the standing experiment for refilling the pool via the Luau Execution API (`AssetService:CreatePlaceAsync`) — unverified until run against a real key.

The key is stored server-side in `data/settings.json` and never sent to the browser (the settings sheet only ever shows the last 4 characters).

## Eject — send the game to your own Roblox account

Publishing above puts a game into the operator's universe. **Send to Roblox** does the
opposite: it builds the project as a `.rbxm` model and uploads it into *your* Roblox
inventory over your own sign-in, so you insert it from the Toolbox and publish the
experience yourself. That is what makes the game genuinely yours — same account, same
ownership, DevEx included.

Verified against the live Assets API on 2026-07-29: a Rojo-built `.rbxm` uploads, moderates
clean and comes back `Approved` / `Active`.

How it works:

- You connect your Roblox account in **Settings → Your Roblox account** (OAuth 2.0, scopes
  `openid profile asset:read asset:write`). Bloxable never asks for your API key — Roblox's
  Creator Third Party App Policy forbids that, and OAuth is the sanctioned path for the
  Assets API.
- Hit **Send to Roblox**. The tree is projected as a Model: Workspace's children become the
  model's children, and every other service that holds anything becomes a Folder named after
  it (tagged with a `BloxableService` attribute).
- Studio → Toolbox → Inventory → My Models → drag it in, move those service folders into the
  services they are named after, and File → Publish to Roblox.

Operator setup, once:

```bash
# create.roblox.com/dashboard/credentials?activeTab=OAuthTab → new OAuth app
# permissions: asset:read + asset:write (Creation & Productivity Tools category)
# redirect URL: http://localhost:3000/api/roblox/oauth/callback
ROBLOX_OAUTH_CLIENT_ID=...
ROBLOX_OAUTH_CLIENT_SECRET=...
ROBLOX_OAUTH_REDIRECT_URI=...   # optional; defaults to <origin>/api/roblox/oauth/callback
```

A new OAuth app is in private mode until Roblox reviews it, capped at 10 unique users.
Without those two env vars the Settings section says so plainly instead of offering a button
that cannot work.

Two things it deliberately does not do:

- **No place publishing on your behalf.** Nothing in Open Cloud can publish a place into
  someone else's experience — `universe-places:write` is in no OAuth category, and
  `StudioPublishService:PublishAs` is locked to Roblox scripts. The final publish click is
  yours.
- **No revisions.** Every eject creates a new model. Roblox's own Assets guide says content
  updates are `.fbx`-only, which is exactly the `.rbxm` PATCH failure reported in
  [devforum #4628429](https://devforum.roblox.com/t/api-rejecting-valid-rbxmrbxmx-models/4628429),
  so re-uploading is honest about being a new asset.

A model carries instances, not service properties: Lighting settings and the like stay
behind, and the result panel says so after each upload.

`npm run test:model` builds a model with the real toolchain and verifies it by deserializing
with Lune: one root Model, Workspace content directly under it, a Folder per service, Motor6D
refs still wired.

Every eject ends in one of three honest states: **uploaded** (with the Studio steps and the
moderation verdict — a Rejected review is said out loud, not buried in a status suffix),
**still processing** (HTTP 202 when Roblox takes longer than the 90s poll budget — the upload
usually lands moments later, so it is never reported as a failure), or **failed** with a
stable `code` (`not_connected`, `signin_expired`, `rate_limited`, …) that the modal turns
into plain language plus one concrete next step, with Roblox's own message shown verbatim
underneath. `npm run test:eject` pins that mapping against response shapes captured live.

## What works today

- Projects persisted on disk under `data/` (atomic writes), seeded from the real Studio Baseplate template.
- Chat → tool-use loop → validated `PatchOp`s → live tree, viewer and file list updates over SSE.
- Every op checked against the official API dump: class exists, property exists, enum name resolved to its token.
- Every property type the `.rbxlx` format carries, including `UDim2`, `UDim`, `Vector2`, `Rect`, `NumberRange`, `NumberSequence`, `ColorSequence`, `Font` and `PhysicalProperties`, plus instance attributes and CollectionService tags.
- **Direct manipulation**: select a part → Move/Rotate/Scale gizmo (1-stud / 15° snapping), validated and persisted through the same op pipeline as the AI.
- **Undo/redo**: Cmd+Z / Shift+Cmd+Z (and topbar buttons) — one step per chat turn or drag, 30 steps per project, server-side snapshots.
- `.rbxlx` export (always available) and Open Cloud publish with place auto-assignment + play link.
- **Eject to your own account**: OAuth sign-in + `.rbxm` model upload into your Roblox inventory, with the Studio steps spelled out afterwards.
- 3D preview: parts, wedges, cylinders, spheres, BrickColors, procedural material detail (wood grain, brick, concrete, grass, metal…), the classic stud-grid baseplate, screen UI, lighting and fog — all read from the real tree.
- 25 free messages/day, enforced server-side (currently disabled via `UNLIMITED_CREDITS`).

## Known limitations

These are real constraints, not TODOs we forgot:

- **No experience-creation API.** Roblox has no endpoint that mints a universe or place, so the one-time Studio step above is unavoidable.
- **10 MiB publish cap.** Open Cloud rejects place uploads over 10,485,760 bytes. Bloxable warns at 8 MiB and blocks past the cap, pointing you at export instead.
- **The preview is an approximation.** Screen UI under `StarterGui` is drawn as real DOM over the canvas, but terrain, MeshParts, decal/texture images, `BillboardGui` and `SurfaceGui` are not rendered — they show up in Roblox only. `TextScaled` is solved from the laid-out box instead of by Roblox's own formula, materials are PBR approximations and the sun direction is not Roblox's real formula.
- **Some classes are refused.** Solid modelling (`UnionOperation`, `NegateOperation`, `IntersectOperation`, `PartOperation`), `SurfaceAppearance`, `EditableImage`, `EditableMesh` and the avatar wrap classes are blocked, because the publish API silently ignores them — a place containing them would upload "successfully" and be wrong.
- **NPCs are blocky, not avatars.** Avatar-grade characters need uploaded mesh assets. The `blocky_npc` template is a real R6-shaped rig with computed `Motor6D` joints and a walk script, and it has no animations — it slides.
- **No terrain.** Roblox terrain is a packed voxel blob (`Terrain.SmoothGrid`) the tree format does not emit, so landscapes are built out of parts. A runtime `Terrain:FillBlock` script is the way in later.
- **No mesh/image/audio upload.** IDs that already exist can be referenced, but Bloxable only uploads the game itself (as a model, via Eject) — meshes, images and audio of your own are not wired up.
- **Eject hands you a model, not a published game.** No API can publish a place into someone else's experience, so the last step — insert from the Toolbox, drag the service folders into place, File → Publish — is yours. Service properties (Lighting and friends) do not travel in a model, and each eject creates a new asset rather than a revision.
- **Local, single user.** All state is on disk; there is no auth, no multi-user isolation, and concurrent builds of one project would race. The upgrade button in the paywall is explicitly not wired.
- **Not yet opened in Studio.** Generated places are verified by round-tripping through Lune, but no one has loaded one into Roblox Studio and pressed Play.
