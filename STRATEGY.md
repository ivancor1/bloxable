# STRATEGY.md — the platform thesis

Decided with Ivan, 2026-07-28. PRODUCT.md stays the locked product spec; this file
is the direction: **Bloxable is a substitute for Roblox Studio, not a plugin for
it.** A plugin is a feature Roblox absorbs in a release note (and a usage signal
telling them what to fix); a platform with its own users is something they must
out-innovate or buy.

## The model: host by default, eject on demand (the Lovable shape)

- **Tier 0 — zero install (shipping).** Prompt → preview → export a real
  `.rbxlx`. Top of the funnel, works with no Roblox anything.
- **Tier 1 — hosted universe (built, awaiting operator setup).** Projects
  publish into places inside a universe WE own; the user gets a live play link
  in seconds — no Roblox account setup, no Studio, no key. Legal basis: our own
  tooling against our own resources, which Roblox explicitly blesses
  (RESEARCH.md Part 1 Q9). Games live under our account → we carry moderation
  exposure → pre-publish content filtering before this scales beyond us.
- **Ownership/eject.** Download `.rbxlx` → Studio (File → Publish) → theirs.
  Required for DevEx payout. Deliberate later step, not a prerequisite.
- **Tier 2 — Studio farm (v3 moat).** OUR accounts + official Studio MCP server
  on cloud VMs for the few things nothing else can do: CSG unions, >10 MiB
  publishes, real-engine capture. Never signed in as a user.

## Access levers (how we reach Studio parity without the engine)

1. **File layer** (shipping): everything serializable — parts, GUIs, scripts,
   lighting, attributes, tags → real Rojo project → `rojo build`.
2. **Open Cloud** (official, keyed): publish versions, Assets API upload
   (images/audio/fbx — BETA), asset-delivery download, Luau Execution (STABLE,
   validation only), Instance API (script edits; needs live Team Create),
   DataStore/MessagingService (live ops later), version history (rollback).
3. **Runtime materialization**: what's hard to *serialize*, AI-authored Luau
   builds at runtime — terrain via `Terrain:FillBlock/FillRegion`, animations
   via `KeyframeSequenceProvider:RegisterKeyframeSequence` (verify), toolbox
   models via `InsertService`/`require(assetId)` (verify current ownership rules).
4. **Studio-as-backend**: official MCP server + our own accounts (Tier 2).
5. **User bridges**: OAuth (identity, experience picker, `asset:read/write`),
   `.rbxl` import via Lune/rbx-util.

## Feature map

| Studio capability | Path | Status |
|---|---|---|
| Edit everything | file layer | ✅ shipping |
| Scripting | we write Luau; add luau-lsp diagnostics; Luau Exec smoke tests | ✅ + upgrade |
| Toolbox / Creator Store | paste link → asset-delivery fetch (keyed) → Lune/rbx-util parse → **editable instances in our tree**; search via toolbox-service (unofficial, read-only) | 🟢 next build |
| Custom assets | Open Cloud Assets API (beta) | 🟢 next build |
| Terrain | AI-written TerrainGen script now; SmoothGrid voxel writer later | 🟢 script path |
| Animations | KeyframeSequence + runtime register | 🟡 verify |
| Playtest | publish→play link (seconds); Studio-farm capture later | 🟡 |
| CSG, >10 MiB | Studio farm only | 🔴 tier 2 |
| New experience | Studio once → test `CreatePlaceAsync` via Luau Exec (`npm run mint:place`) → Roblox's own CreateUniverse/CreatePlace schemas exist, unshipped | 🟡 improving |
| Live edits w/o republish | Team-Create "editor bot" keeps Instance API writable; MessagingService pushes config into running servers | 🟡 test |
| Live ops | DataStore/Messaging Open Cloud dashboards | 🟢 whenever |

## Risk lines

- **Green**: everything Open Cloud; runtime materialization; local Studio MCP;
  OAuth; parsing/serializing place files.
- **Yellow (verify or counsel first)**: toolbox-service search endpoint;
  CreatePlaceAsync-via-Luau-Exec; RegisterKeyframeSequence; InsertService
  ownership rules; Studio farm at VM scale.
- **Red (never)**: holding user session cookies or passwords (child-safety +
  explicit ToS: sharing account access is prohibited; the cookie itself says
  DO NOT SHARE); collecting user API keys in a hosted product (Creator Third
  Party App Policy); shipping/emulating the engine; cookie-authenticated
  writes from our servers.

## Moat (why Roblox improving Studio's AI doesn't kill this)

1. **Audience**: people who bounced off Studio never see Studio's AI. Net-new
   creator acquisition — the number that makes acquisition rational.
2. **Correctness layer**: validated property/class mapping, partial-failure
   recovery, verified templates, the tuned prompt — compounds, invisible from
   outside.
3. **Engine-agnostic core**: the canonical tree + projection step can target
   UEFN and beyond. "Describe a game, ship to any creator platform" is the
   thesis Roblox cannot absorb by improving Studio.
4. Leverage loop: `universe-places:write` on OAuth is the single unlock for
   user-owned hosted publishing. Roblox grants that to platforms with real
   creators, not to feature requests.

## Verification checklist (day the operator account exists)

1. Real publish through the app (endpoint shape verified from docs only).
2. `npm run setup:universe -- --universe <id>` → pool fills; project auto-assigns; play link works.
3. `npm run mint:place` → does CreatePlaceAsync mint pool places? (Enable
   "Allow game to create places" first.)
4. Open one exported `.rbxlx` in Studio, press Play (last unautomated proof).
5. Team-Create + Instance API live-edit experiment.
6. `roblox-studio:` URI scheme — can "Open in Studio" be one click?
