# RESEARCH.md — Verified Roblox Platform Facts

Researched 2026-07-27 by three agents against live official documentation (create.roblox.com/docs, the Roblox/creator-docs repo, official OpenAPI specs, rbx-dom) plus live endpoint probes and locally-executed Rojo/Lune binaries. Every load-bearing claim carries citations fetched at research time. Status legend: OFFICIAL | BETA | COMMUNITY-STANDARD | NOT-POSSIBLE | UNCLEAR.

This file is the source of truth for Roblox facts in this repo. Do not code against memory; code against this.

## Part 1 — Open Cloud, publishing, and account connection

### Summary

Place publishing from an external server is real, officially supported, and API-key-only: POST https://apis.roblox.com/universes/v1/{universeId}/places/{placeId}/versions?versionType=Published|Saved, scope universe-places:write, 10 MiB body cap, 30 req/min. Both .rbxl (application/octet-stream) and .rbxlx (application/xml) are accepted. Luau Execution is now STABLE (not beta) and is genuinely useful for validation, but cannot persist data-model changes. Three hard blockers shape the product: (1) there is NO Open Cloud API to create a universe or place — schemas reference CreateUniverse/CreatePlace/ListTemplatePlaces but the routes return 404, and the Creator Hub website has no create-experience flow, so Studio is required to mint an experience; (2) OAuth2 CANNOT publish places — universe-places:write is absent from every OAuth2 app category in the current (2026-07-13) policy, and a Bearer token is rejected with "Missing API Key Header"; (3) the Creator Third Party App Policy explicitly says "Do not request API keys from other Roblox Users", which forecloses the obvious paste-your-key onboarding. Net: there is no compliant, Studio-free path to publish into a user-owned experience today. Recommended v1 is platform-owned universes published with our own key, plus .rbxl export.

### Q1: Place publishing endpoint (exact spec)  `[OFFICIAL]`

BETA stability flag in the official spec, but it is the production publish path.

POST https://apis.roblox.com/universes/v1/{universeId}/places/{placeId}/versions?versionType=Published
- versionType: `Saved` (save, do not publish) | `Published` (save and publish). Query param, nullable string; omitting it defaults server-side — always send it explicitly.
- Auth header: `x-api-key: <key>`. NOTHING else works (see Q3).
- Content-Type: `application/octet-stream` for binary .rbxl; `application/xml` for XML .rbxlx. XML uploads ARE officially accepted — the spec's own curl sample posts `--data-raw '<roblox></roblox>'` with `Content-Type: application/xml`.
- Body: raw file bytes (curl --data-binary). Not multipart.
- 200 response: Content-Type text/plain containing JSON, e.g. `{"versionNumber":7}`.
- Errors: 400 Invalid request / invalid file content; 401 API key not valid for operation / user not authorized; 403 Publish not allowed on place; 404 Place or universe does not exist; 409 Place not part of the universe; 500 server error. Error envelope is the legacy shape — verified live: `{"errors":[{"code":0,"message":"Missing API Key Header"}]}` with HTTP 401.
- Required API key scope: `universe-places:write`. Creator Hub API-key UI calls the API System `universe-places`; add the `Write` operation and select the target experience.
- SIZE LIMIT: `x-roblox-size-limit: 10485760` = 10 MiB per request. This is the single most important architectural constraint — it is 10x smaller than the 100 MB (104,857,600 bytes) platform place-size limit. AI-generated places must stay under 10 MiB or they cannot be published via Open Cloud at all.
- RATE LIMITS: perIp 30/MINUTE; perApiKeyOwner 30/MINUTE; throttling perApiKey 30 per 60s. Note API-key limits are pooled across ALL keys per owner, so a single platform account is capped at 30 publishes/min globally.
- HTTPS only.
- INSTANCE TYPES NOT UPDATED by this API: EditableImage, EditableMesh, PartOperation (unions/negates), SurfaceAppearance, BaseWrap. Anything using these must be published from Studio. This meaningfully constrains what the AI can generate — no CSG unions, no custom surface appearances.

There is NO cloud/v2 equivalent for publishing. /cloud/v2/universes/{universe_id}/places/{place_id} is STABLE but only GET (read metadata) and PATCH (displayName, description, serverSize) — it does not accept place content.

Version history (useful for rollback UX): GET https://apis.roblox.com/place-version-history-api/v1/{placeId}/history (EXPERIMENTAL, supports x-api-key; filters cursor/isPublished/hasNotes/saveType/searchTerm/contributor/startTime/endTime/pageSize) and POST .../v1/{placeId}/version/{version}/notes to set version notes.

Citations:
- https://create.roblox.com/docs/cloud/guides/usage-place-publishing
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/cloud/guides/usage-place-publishing.md
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/cloud/universes-api/v1.json
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/cloud/openapi.json
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/includes/place-size-limit.md

### Q2: Creating a NEW experience without Studio  `[NOT-POSSIBLE]`

No official API creates a universe or a place, and the Creator Hub website has no create-experience flow. Studio is mandatory to mint an experience.

Evidence (three independent confirmations):
1. Scanned all 688 paths in the official openapi.json: there is no POST for universes or places. The only universe/place writes are PATCH (metadata) and the versions POST (content into an EXISTING place).
2. Tantalizing but dead: the `Universe` schema has required writeOnly `templateRootPlace` documented as "used for CreateUniverse", and the `Place` schema has required writeOnly `templatePlace` for place creation; both say "A list of the valid template places can be obtained from ListTemplatePlaces". The strings CreateUniverse / CreatePlace / ListTemplatePlaces appear ONLY inside schema field descriptions — never as published operations. Roblox has clearly built or is building these; they are not shipped.
3. Live probes distinguish 404 (route absent) from 403 (route exists, auth required). Baselines: GET /cloud/v2/universes/1 -> 403, GET /cloud/v2/universes/1/places/1 -> 403. All creation candidates -> 404: POST /cloud/v2/universes, POST /cloud/v2/universes/1/places, POST /cloud/v2/universes:create, GET /cloud/v2/template-places, POST https://develop.roblox.com/v1/universes, POST https://develop.roblox.com/v1/universes/1/places.

Creator Hub: the official docs page "Create and publish games and places" documents creation exclusively as Studio -> Open a Template -> Baseplate | Platformer | Racing -> File > Publish to Roblox -> Name/Description/Creator/Devices -> Create. The creator-hub.md doc frames the Hub as managing existing creations ("You'll often use Creator Hub and Studio together"), not creating them. No web create-experience click-path exists to document. There is also no official browser-based Studio.

ADJACENT (worth testing, do not assume): the engine API `AssetService:CreatePlaceAsync(placeName: string, templatePlaceID: number, description: string): number` creates a NEW PLACE inside the SAME universe from a running script (capability `AssetCreateUpdate`); the Place schema's readOnly `universeRuntimeCreation` flag exists specifically to mark places made this way. Because the Luau Execution API runs engine code server-side and may "invoke engine APIs that read and/or modify data stored in the cloud", CreatePlaceAsync may be callable from a Luau Execution task to mint places programmatically inside a universe you already own. This is UNVERIFIED — it is not documented as supported and must be empirically tested before any architecture depends on it. It cannot create a new UNIVERSE in any case.

Citations:
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/cloud/openapi.json
- https://create.roblox.com/docs/production/publishing/publish-experiences-and-places
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/production/publishing/publish-games-and-places.md
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/creator-hub.md
- https://create.roblox.com/docs/reference/engine/classes/AssetService

### Q3a: Creator Hub API keys  `[OFFICIAL]`

Creation: Creator Dashboard -> https://create.roblox.com/dashboard/credentials?activeTab=ApiKeysTab -> Create API Key -> name -> Access Permissions: pick an API System (e.g. `universe-places`) -> select the experience -> Select Operations (e.g. Write) -> optional Security IP allowlist -> optional expiration -> Save & Generate key. Key shown once.

Scoping to a specific experience: yes, via the per-system experience selector. A "Restrict by Experience" toggle can be DISABLED, in which case the key reaches all user-owned games plus group games where the user has the role — including games created in the future. Not all scopes support per-experience restriction.

IP restrictions: CIDR allowlist (e.g. 192.168.0.0/24). Docs warn NOT to use IP restrictions if the key is used from inside Roblox game servers via HttpService.

Expiration — critical operational trap: optional explicit expiry, PLUS an automatic one. "If you or your group don't use or update an API key for 60 days, it automatically expires, even if it doesn't have a set expiration date." Statuses: Active, Disabled, Expired, Auto-Expired, Revoked (group key when the generating account loses permission), Moderated, User Moderated. A key's power equals the owning user's permissions.

Validation endpoint (excellent for onboarding UX): POST https://apis.roblox.com/api-keys/v1/introspect, Content-Type application/json, body {"apiKey":"..."} — NO auth header; the key travels in the body. Verified live: bogus key returns HTTP 400 {"code":3,"message":"API Key is not provided in a valid format.","details":[]}. Success returns {name, authorizedUserId, scopes:[{name, operations, universeIds|groupIds|userIds|universeDatastores}], enabled, expired, expirationTimeUtc}, where "*" means all resources of that type. This yields both the owner's userId AND the universe IDs the key is scoped to — it can drive an experience picker and verify the key is publish-capable before the user ever hits Publish.

Group keys: Roblox strongly recommends a dedicated alternate account invited to the group with a minimal role, rather than a personal key.

Citations:
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/cloud/auth/api-keys.md
- https://create.roblox.com/docs/cloud/auth/api-keys

### Q3b: OAuth2 — place publishing is NOT available  `[NOT-POSSIBLE]`

OAuth 2.0 is itself still flagged BETA in the docs. Place publishing is NOT available to OAuth2 apps, confirmed three independent ways:
1. Spec: the publish operation's security block lists ONLY `roblox-api-key`. Every OAuth-capable operation lists `roblox-oauth2` alongside it; this one does not.
2. Live: POST to the publish endpoint with `Authorization: Bearer faketoken` and no x-api-key returns HTTP 401 {"errors":[{"code":0,"message":"Missing API Key Header"}]} — the endpoint does not even consider bearer auth.
3. Policy: the current Creator Third Party App Policy (updated 2026-07-13) enumerates allowed scopes per app category. `universe-places:write` appears in NONE of the four categories.

CURRENT OAuth2 scope list for "Creation & Productivity Tools" (the only relevant category), as of 2026-07-13: openid, profile, user.user-notification:write, group:read, group:write, legacy-group:manage, asset:read, asset:write, legacy-asset:manage, creator-store-product:read, creator-store-product:write, universe:write, legacy-universe:manage, legacy-team-collaboration:manage, universe.place:write, legacy-badge:manage, legacy-universe.badge:write, legacy-universe.badge:manage-and-spend-robux, legacy-game-pass:manage, legacy-developer-product:manage, universe.user-restriction:read, universe.user-restriction:write, universe.secret:read, universe.secret:write, universe-messaging-service:publish, developer-product:read, developer-product:write, game-pass:read, game-pass:write, group-forum:read, group-forum:write, thumbnail:read, universe:read, universe.analytics:read, universe.place:read.
Note `universe.place:write` (place METADATA — displayName/description/serverSize) is present and is easily confused with `universe-places:write` (place CONTENT publishing) which is absent. Changelog shows active churn: 7/13/2026 removed universe-datastores.objects:delete and universe.ordered-data-store.scope.entry:write, added universe.analytics:read and universe.place:read.

Other identity scopes (OIDC discovery, fetched live): openid, profile, email, verification, credentials, age, premium, roles, attributes. Docs warn not all are available to third-party developers.

Mechanics: base https://apis.roblox.com/oauth. GET v1/authorize (PKCE S256 supported), POST v1/token, POST v1/token/introspect, POST v1/token/resources, POST v1/token/revoke, GET v1/userinfo, GET .well-known/openid-configuration, jwks https://apis.roblox.com/oauth/v1/certs. Client auth via client_secret_basic or client_secret_post.
TOKEN LIFETIMES: authorization code 1 minute, single use. Access token 15 minutes (expires_in 899), reusable. Refresh token 90 days, SINGLE USE (rotating — you must persist the new refresh token on every refresh or you lose the session). ID token via openid.
Rate limits are per access token, i.e. per user per app — a real advantage over API keys, which pool per owner.
REGISTRATION/REVIEW: create at https://create.roblox.com/dashboard/credentials?activeTab=OAuthTab. App starts in PRIVATE MODE capped at 10 unique users. To exceed that you must submit for review with description, thumbnail, entry link, HTTPS privacy + ToS URLs (<=256 chars). Scopes must fall within a SINGLE app category. Approval is one-way (cannot revert to private). While review is pending you cannot edit or resubmit. Adding/changing scopes later requires re-consent from every user AND, for public apps, another review. Up to 10 redirect URLs, <=256 chars, plain HTTPS or localhost or custom scheme.

Citations:
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/cloud/auth/oauth2-reference.md
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/cloud/auth/oauth2-registration.md
- https://en.help.roblox.com/api/v2/help_center/en-us/articles/37924211313044.json
- https://devforum.roblox.com/t/changes-to-open-cloud-api-usage-policies/3671058
- https://apis.roblox.com/oauth/.well-known/openid-configuration

### Q4: Reading, listing, and the experience picker  `[OFFICIAL]`

Universe metadata: GET https://apis.roblox.com/cloud/v2/universes/{universe_id} (STABLE, api-key + oauth2, no scope for read, 100/min). Returns path, createTime, updateTime, displayName (readOnly), description (readOnly), user|group owner, visibility (PUBLIC|PRIVATE), ageRating, voiceChatEnabled, desktop/mobile/tablet/console/vrEnabled, privateServerPriceRobux, social links, rootPlace.
Update universe: PATCH same path + ?updateMask=..., scope `universe:write`. NOTE displayName and description are readOnly on Universe — "This field can be updated by updating the root place's name."
Place metadata: GET/PATCH https://apis.roblox.com/cloud/v2/universes/{universe_id}/places/{place_id} (STABLE, api-key + oauth2). PATCH scope `universe.place:write`, ?updateMask=displayName,description,serverSize. So renaming an experience = PATCH the ROOT place's displayName.

LIST PLACES IN A UNIVERSE — works with NO auth at all. Verified live: GET https://develop.roblox.com/v1/universes/{universeId}/places?limit=10&sortOrder=Asc&cursor= returns 200 with {previousPageCursor,nextPageCursor,data:[{id,universeId,name,description}]}. limit enum 10|25|50|100. The spec marks security as [{}] (anonymous). Ideal for a place picker once you know the universeId.

LIST THE AUTHENTICATED USER'S UNIVERSES — no clean Open Cloud endpoint exists, but two indirect routes work well:
1. API key: POST /api-keys/v1/introspect returns authorizedUserId AND the universeIds each scope is bound to. This is the best picker source — it needs no extra permission and tells you exactly which experiences the key can publish to.
2. OAuth2: POST https://apis.roblox.com/oauth/v1/token/resources (form-encoded token/client_id/client_secret) returns resource_infos[].resources.universe.ids — the exact universes the user consented to. Also the correct way to validate access statefully.
3. Legacy fallback, PARTIAL: GET https://games.roblox.com/v2/users/{userId}/games?accessFilter=2&limit=50&sortOrder=Asc. Verified live 200, returns {data:[{id (universeId), name, description, creator, rootPlace:{id}, created, updated, placeVisits}]}. CAVEAT verified live: accessFilter=1 and accessFilter=4 both return {"errors":[{"code":0,"message":"NotImplemented"}]} anonymously, and accessFilter=2 means PUBLIC only. Since new experiences default to PRIVATE, a freshly created experience will NOT appear here. Do not build the primary picker on this.

MANUAL ID DISCOVERY (document this in-product as the fallback): Universe ID — https://create.roblox.com/dashboard/creations, hover the experience tile, click the ⋯ overflow button, "Copy Universe ID" (the same menu has "Copy Start Place ID"). Place ID — from Creations click the experience thumbnail, left nav "Places" tab, click the place thumbnail; the ID is in the URL: https://create.roblox.com/dashboard/creations/experiences/{universeId}/places/{placeId}/configure.

Citations:
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/cloud/openapi.json
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/cloud/auth/api-keys.md
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/cloud/auth/oauth2-reference.md
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/cloud/guides/usage-place-publishing.md

### Q5: Luau Execution API — now STABLE, useful for validation only  `[OFFICIAL]`

STATUS CHANGED: no longer beta. The official spec marks every Luau Execution operation x-roblox-stability: STABLE, and the live reference page labels them Stable. (It launched as a beta in Sept 2024 as "Open Cloud Engine API for Executing Luau".)

Endpoints (all api-key ONLY, no OAuth2):
- POST /cloud/v2/universes/{universe_id}/places/{place_id}/luau-execution-session-tasks — runs against the current published place. Quota 40/min per API key owner.
- POST /cloud/v2/universes/{universe_id}/places/{place_id}/versions/{version_id}/luau-execution-session-tasks — runs against a SPECIFIC place version. Quota 5/min per API key owner, 45/min per IP.
- GET /cloud/v2/universes/{u}/places/{p}/versions/{v}/luau-execution-sessions/{s}/tasks/{t} — poll `state`.
- GET .../tasks/{t}/logs — stdout from print().
- POST /cloud/v2/universes/{universe_id}/luau-execution-session-task-binary-inputs — presigned upload for large inputs. Quota 5/min.
Scopes: universe.place.luau-execution-session:write (create), :read or :write (get/logs).

Request: {script, timeout, binaryInput?, enableBinaryOutput?}. state enum: STATE_UNSPECIFIED | QUEUED | PROCESSING | CANCELLED | COMPLETE | FAILED. Result is oneOf error|output. Async — create returns immediately, you poll.

CAPABILITIES AND THE DECISIVE LIMIT: "The script may access and update the data model of the place, including invoking any module scripts. However, data model changes are local to the task and CANNOT BE PERSISTED." Physics does not run. Server and local scripts in the place do NOT auto-run. It CAN invoke cloud-mutating engine APIs (DataStores etc.). Scripts run as-is (no function wrapper) and may `return` values.
Numeric limits: script <=4 MB; runtime <=5 min (timeout default 5 min, format like "3s"); return values JSON-serialized <=4 MB; logs retained <=450 KB (older discarded); task info retained 24h; AT MOST 10 INCOMPLETE TASKS PER PLACE (11th gets HTTP 429). Binary input <=100 MiB, presigned URI valid 15 min, reusable across tasks in the universe. Binary output buffer <=256 MiB, binaryOutputUri valid 15 min after completion; requires returning a LuauExecutionTaskOutput table {BinaryOutput=buffer, ReturnValues={...}} and nothing else.
Latency: NOT DOCUMENTED. The model is queue -> cold engine session -> execute, so treat it as seconds-to-tens-of-seconds, not interactive. rocale-cli defaults to 2s poll interval and a 300s timeout, which is a reasonable proxy for expected duration.

HONEST ASSESSMENT:
(a) Validating AI-generated code — YES, this is the strong use case. Upload the candidate place with versionType=Saved (unpublished), run a task against that version_id, require() and exercise the generated ModuleScripts, assert on results, read print() output and unhandled errors. This is a real server-side test harness for AI output and is exactly what Roblox's own archived place-ci-cd-demo does.
(b) Server-side build steps — NO for anything that must persist. Data model mutations evaporate at task end; there is no SavePlace from a task. It is fine for pure computation (validate/transform/analyze, emit results via return values or binary output).
(c) Nothing yet — overstated; it is genuinely valuable, but only as a verifier/compute step, never as the mechanism that writes your place.

Citations:
- https://create.roblox.com/docs/cloud/features/luau-execution
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/cloud/openapi.json
- https://devforum.roblox.com/t/beta-open-cloud-engine-api-for-executing-luau/3172185
- https://raw.githubusercontent.com/Roblox/rocale-cli/master/README.md

### Instance API — granular script editing (important, and sharply limited)  `[BETA]`

Not in your numbered list but decisive for a "real project files" product, so flagging it. It lets you read/mutate instances inside an ALREADY-PUBLISHED place without reuploading a place file.

- GET /cloud/v2/universes/{u}/places/{p}/instances/{instance_id} (scope universe.place.instance:read)
- PATCH same path (scope universe.place.instance:write)
- GET /cloud/v2/universes/{u}/places/{p}/instances/{instance_id}:listChildren (start with instance_id = `root`)
- GET .../instances/{id}/operations/{operation_id} — all three are async and return an Operation you poll for `done`.
PATCH body shape: {"engineInstance":{"Details":{"<ClassName>":{"<Property>":"<value>"}}}}. listChildren returns engineInstance {Id, Parent, Name, Details}; scripts expose type, source, enabled in Details.

BETA RESTRICTIONS THAT KILL IT AS A PRIMARY BUILD PATH:
- You can ONLY read and update Script, LocalScript and ModuleScript. No parts, models, GUIs, or any other class.
- Update only — no create and no delete. You cannot add a new script.
- API KEY AUTH ONLY. Creator Hub API System is `universe-place-instances` with read+write on the chosen experience.
- REQUIRES a collaborative (Team Create) session enabled on the experience.
- Cannot update a script currently open in Studio (error: "Engine_OC_API: Processing Error - Live scripting session is active"), nor scripts belonging to a package.
- Request bodies capped at 200 KB.
Useful for fast single-script hot-patches on an existing place; cannot build a game. Full .rbxl upload remains the only way to author structure.

Citations:
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/cloud/guides/instance.md
- https://create.roblox.com/docs/cloud/guides/instance
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/cloud/openapi.json

### Q6: Assets API (v2 feature)  `[BETA]`

POST https://apis.roblox.com/assets/v1/assets — multipart/form-data with two parts: `request` (JSON: assetType, displayName, description, creationContext:{creator:{userId|groupId}}) and `fileContent` (bytes with its own content-type). Auth: x-api-key OR Authorization: Bearer (OAuth2 IS supported here). Scopes asset:read + asset:write — and note both are inside the OAuth2 "Creation & Productivity Tools" category, so asset upload IS reachable via OAuth2 even though place publishing is not.
Other ops (all BETA, api-key + oauth2): GET /assets/v1/assets/{assetId}; PATCH /assets/v1/assets/{assetId}; GET /assets/v1/assets/{assetId}/versions; GET .../versions/{versionNumber}; POST .../versions:rollback; POST /assets/v1/assets/{assetId}:archive; POST .../:restore; GET /cloud/v2/users/{user_id}/asset-quotas.
MODERATION + POLLING: create/update return a long-running Operation. Poll GET https://apis.roblox.com/assets/v1/operations/{operationId} until done; the response carries asset metadata including moderationState (e.g. MODERATION_STATE_APPROVED). Budget for async moderation — uploads are not usable instantly.
Formats/limits: Decal/Image .png .jpeg .bmp .tga, max 8000x8000. Audio .mp3 .ogg .wav .flac, <=7 min, and a hard account quota of 100/month ID-verified or 10/month unverified — a real constraint for AI-generated audio at scale. Model .fbx .gltf .glb .rbxm .rbxmx and Animation .rbxm/.rbxmx, 20 MB. Video .mp4 .mov, <=5 min, <=4096x2160, 20/day for ID-verified 13+.
Server-side delivery/thumbnails: GET https://apis.roblox.com/asset-delivery-api/v1/assetId/{assetId} and /version/{versionNumber} (api-key + oauth2, scope legacy-asset:manage). Thumbnails: GET https://thumbnails.roblox.com/v1/games/{universeId}/thumbnails and /v1/games/multiget/thumbnails (STABLE); GET /v1/assets-thumbnail-3d (BETA, thumbnail:read).
Also available: POST /cloud/v2/universes/{universe_id}:generateSpeechAsset (BETA, text-to-speech into an asset, scopes universe:write + asset:read + asset:write).

Citations:
- https://create.roblox.com/docs/cloud/guides/usage-assets
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/cloud/openapi.json
- https://en.help.roblox.com/api/v2/help_center/en-us/articles/37924211313044.json

### Q7: Embedding a playable experience  `[NOT-POSSIBLE]`

There is no official way to embed a playable Roblox experience in an external web page, and Roblox actively blocks framing. Verified live: https://www.roblox.com/... responds with `x-frame-options: SAMEORIGIN`, so an <iframe> of any roblox.com page is refused by the browser. Roblox ships no web player, no embed SDK, and no documented iframe/embed product; the browser plugin era ended and playing requires the installed client. No official docs page describes embedding.

OFFICIAL PLAY / DEEP-LINK FORMATS (from the deep linking docs):
- Canonical experience page: https://www.roblox.com/games/{placeId}/{url-slug} (slug is cosmetic).
- Web-to-app (shows the web page, then launches the client): https://www.roblox.com/games/start?placeId=<id>&launchData=<string>
- Direct-to-app custom scheme (launches the client immediately): roblox://placeId=<id>&launchData=<string>
- Deferred deep link for users without the app installed (AppsFlyer): https://ro.blox.com/Ebh5?af_dp=<direct_to_app_link>&af_web_dp=<web_listing_to_app_link>
- launchData is retrieved in-experience via Player:GetJoinData(); max 200 bytes decoded; URL-encode it; it is user-modifiable so never put secrets in it.
A non-root place is joinable directly by its own placeId, which is what makes a multi-place shared universe viable.

Consequence for your center-pane "live preview of the actual Roblox place": it cannot be the real engine. There is also no server-side render/screenshot API — Luau Execution runs with no rendering and no physics, and game thumbnails are creator-uploaded, not auto-rendered from place content. You must either render your own approximation in-browser from the project tree you already control, or show a Play button that deep-links into the Roblox client.

Citations:
- https://create.roblox.com/docs/production/promotion/deeplinking
- https://www.roblox.com/games/1818/Classic-Crossroads
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/cloud/openapi.json

### Q8: Official headless build/CLI tooling and recent changes  `[OFFICIAL]`

rocale-cli — https://github.com/Roblox/rocale-cli. OFFICIAL Roblox-org repo, active (created 2025-11-06, updated 2026-07-15), not archived. "A command-line tool for building, uploading, and running Roblox projects via Roblox's Open Cloud APIs for Luau Execution." This is effectively a reference implementation of your exact pipeline. It states the API key needs `universe-places:write` and `luau-execution-sessions:write`, and its `run` command takes --universeId/--placeId/--apiKey with --load.project (build a Rojo project.json/rbxp), --load.place (an .rbxl), or --load.version (reuse an uploaded version; 0 = rerun last), plus --script (entrypoint), --lua.globals key=value injection, --timeout (default 300s), --pollInterval (default 2s), --binaryOutput. Distributed via foreman: rocale-cli = { source = "Roblox/rocale-cli", version = "0.1.0" }. Built with `lute`, Roblox's Luau runtime.
Roblox/place-ci-cd-demo — official demo of "a Place CI/CD flow using Rojo and the Open Cloud Luau Execution API", but ARCHIVED (default branch `production`). Confirms the intended pattern: build with Rojo -> upload a place version -> validate via Luau Execution.
Roblox/rbxasset — "Deploy from GitHub to the Creator Store" (active, created 2025-06-26).
Roblox/studio-rust-mcp-server — the OFFICIAL Roblox Studio MCP server (docs at create.roblox.com/docs/studio/mcp). Important: it is NOT headless. It "runs as a local process on your machine and communicates with the AI client using stdio transport" and drives an ACTIVE local Studio session (launch: macOS /Applications/RobloxStudio.app/Contents/MacOS/StudioMCP; Windows cmd.exe /c %LOCALAPPDATA%\Roblox\mcp.bat). It exposes 30+ tools (script read/edit/search, asset generation, data model exploration, Luau execution, playtesting with screenshots and console output, input simulation, docs access, multi-session management). Useless server-side for a hosted web product, but it proves the AI-edits-a-real-place model and is a good local-power-user story.
Roblox/cube — "Roblox Foundation Model for 3D Intelligence" (open weights, active). Cube 3D is text-to-mesh, integrated into Studio and its API; 4D creation went public beta Feb 2026 and Cube 3D was announced Mar 2026.
Undocumented and probably not for you: an `open-eval-api` spec ships in the docs repo — POST /open-eval-api/v1/eval and GET /open-eval-api/v1/eval-records/{jobId}, BETA, scope `studio-evaluations:create`, 100/DAY per API key owner. The scope does not appear in the main scope list and a live probe of POST /open-eval-api/v1/eval returns 404, so it is not generally available. Treat as UNCLEAR.
No open-source Roblox engine and no official headless renderer exist. Rojo, foreman, tarmac and selene are the toolchain (foreman and tarmac ARE Roblox-org repos).
Last-12-months sweep: Mar 2026 — new consistent, open-source Open Cloud reference docs (all endpoints published as openapi.json in Roblox/creator-docs, which is now the single best machine-readable source of truth). Open Cloud APIs added for developer products and game passes (create/fetch/update/list-by-universe). Configs API launched for programmatic experience config. May 11 — MessagingService Open Cloud limits aligned with in-experience limits. May 30 2025 -> ongoing — Open Cloud API Policy scope categorization (see Q9). 7/13/2026 — latest policy scope changes. Luau Execution promoted beta -> STABLE. Nothing shipped that enables third-party universe/place creation.

Citations:
- https://github.com/Roblox/rocale-cli
- https://raw.githubusercontent.com/Roblox/rocale-cli/master/README.md
- https://github.com/Roblox/place-ci-cd-demo
- https://create.roblox.com/docs/studio/mcp
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/studio/mcp.md
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/cloud/open-eval-api/v1.json
- https://devforum.roblox.com/t/your-brand-new-cloud-api-reference-documentation-is-here/4139597

### Q9: Terms — automating publishes on behalf of users  `[OFFICIAL]`

Governing document: Creator Third Party App Policy, https://en.help.roblox.com/hc/en-us/articles/37924211313044-Creator-Third-Party-App-Policy (Cloudflare-blocked to normal fetchers; readable via the Zendesk API at https://en.help.roblox.com/api/v2/help_center/en-us/articles/37924211313044.json). Last updated 2026-07-13.

THE DECISIVE LINE, verbatim, under Scope Access > Scope Requests: "Do not request API keys from other Roblox Users". The same section requires that you "only request access to specific scopes required for your app's functionality" and "Do not request any additional scopes outside the ones needed for your app's primary function".
This directly forecloses the obvious onboarding for your product ("paste your Open Cloud API key"). Combined with the fact that OAuth2 has no publish scope, THERE IS NO COMPLIANT WAY TODAY FOR A THIRD-PARTY WEB APP TO PUBLISH INTO A USER-OWNED EXPERIENCE. Many existing community tools do ask for keys; that is a policy violation, not a precedent to rely on.

What IS clearly allowed: using YOUR OWN API keys against YOUR OWN resources. Roblox's announcement FAQ, verbatim: "No, this change does not affect your own internal tooling running against your own resources. You will be able to use Open Cloud API Keys. We will not restrict the scopes you can select for your API Keys." API key scopes are explicitly not restricted by the category system — only OAuth2 apps are.

Other binding constraints for your product:
- Third-party apps are strictly prohibited from "Automatically joining an experience without user consent", "Executing automated in game actions such as movements", "Simulating user actions such as clicks, scrolls, views", and automating account creation at scale or captcha solving.
- "You may not utilize any user data for the training of AI or language learning models." Read this before you plan to train on user projects/prompts tied to Roblox user data.
- "You may not sell any data obtained through Roblox APIs." "You must expunge all data obtained through Roblox APIs if your app or platform has lost access to our APIs for any reason." "You must notify Roblox of any sales or transfers of ownership of your app or platform."
- No cross-experience user tracking; users may be identified only by user ID; no fingerprinting; no combining Roblox data with off-Roblox data.
- Roblox "may make appropriate changes to your app's access to data or enforce specific rate limits", and out-of-bounds apps get unpublished.
Also referenced: Roblox Terms of Use (https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use), Community Standards, and the Creator Third Party App Terms.

Citations:
- https://en.help.roblox.com/api/v2/help_center/en-us/articles/37924211313044.json
- https://en.help.roblox.com/hc/en-us/articles/37924211313044-Creator-Third-Party-App-Policy
- https://devforum.roblox.com/t/changes-to-open-cloud-api-usage-policies/3671058
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/cloud/auth/oauth2-registration.md

### Recommendations

ARCHITECTURE — build these three layers.

1) PROJECT MODEL + SERIALIZER (the core IP, no Roblox dependency).
Keep the canonical project as a Rojo-style tree of real instance classes, real properties and real .luau files (this is what the left sidebar shows). Serialize to .rbxlx (XML) server-side — it is officially accepted by the publish endpoint with Content-Type: application/xml, it is diffable, and it avoids implementing the binary .rbxl format. Hard-budget the serialized output under 10 MiB (the publish request cap), not the 100 MB platform place cap. Ban generation of EditableImage, EditableMesh, PartOperation/unions, SurfaceAppearance and BaseWrap — the publish API silently does not update them. Mirror rocale-cli's pipeline; it is Roblox's own reference implementation of exactly this.

2) PUBLISH PIPELINE.
Two-phase, using the versionType flag as a staging mechanism: POST ...?versionType=Saved to upload a candidate without going live, run a Luau Execution task against the returned version to validate (require the generated modules, assert, read logs and errors), and only on green POST ...?versionType=Published. This gives you a real CI gate on AI output and is worth a lot in a product where nontechnical users cannot debug. Poll with exponential backoff; handle 429 using retry-after; remember API-key rate limits pool per OWNER (30 publishes/min total), so queue publishes centrally rather than per-tenant. Use the place-version-history-api for a rollback UI.

3) AUTH — and this is where you must make a real decision.
For v1, use PLATFORM-OWNED universes with YOUR OWN API keys. This is the only path that is simultaneously compliant, Studio-free for the user, and actually able to publish. Roblox explicitly blesses "your own internal tooling running against your own resources" and does not restrict API key scopes. Onboarding becomes zero-friction: the user never sees Roblox at all until they click Play.
Exploit the multi-place universe: a universe holds many places, each with its own placeId and its own joinable URL. Pre-create a pool of places inside a small number of platform-owned universes and assign one per user project. Test whether AssetService:CreatePlaceAsync can be driven from a Luau Execution task to mint places on demand — if it works it removes all manual provisioning, and if it does not, pre-provision in Studio in batches. Verify this empirically before designing around it.
Do NOT ship "paste your API key". It is explicitly prohibited and it is also terrible UX for your stated nontechnical audience.
In parallel, register an OAuth2 app under "Creation & Productivity Tools" now (openid, profile, universe:read, universe.place:read, universe.place:write, asset:read, asset:write). It cannot publish today, but it gives you compliant identity, an experience picker via POST /oauth/v1/token/resources, metadata/rename via PATCH on the root place, and asset upload. Then lobby Roblox to add universe-places:write to that category — that single scope is the unlock for user-owned publishing and is the highest-leverage external dependency you have. Budget for the review cycle: apps are capped at 10 users until approved, approval is one-way, and adding scopes later forces re-consent plus another review.

CENTER-PANE PREVIEW — set expectations now.
There is no official embed and no server-side render. Build your own WebGL/three.js preview from the project tree you already own (you control the model, so this is tractable and gives you instant feedback with no Roblox round-trip), and put a prominent Play button that deep-links to https://www.roblox.com/games/start?placeId=<id> or roblox://placeId=<id>. Do not promise a real embedded Roblox client.

EXPORT FALLBACK — make it first-class, not a footnote.
Always offer .rbxlx/.rbxl download. It satisfies the founder's fallback requirement, it is the escape hatch when a place exceeds 10 MiB or uses banned instance types, and it is the ONLY compliant way a user can move an AI-built game into an experience they personally own (they open it in Studio and publish).

SEQUENCING: ship the project model + serializer + .rbxlx export first (zero Roblox auth surface, fully testable), then platform-owned publishing, then Luau Execution validation, then assets (v2).

### Limitations (surface honestly in-product)

Surface these honestly in the product and to the founder.

1. NO COMPLIANT STUDIO-FREE PATH TO A USER-OWNED EXPERIENCE. OAuth2 cannot publish (universe-places:write is in no app category; a Bearer token is rejected outright), and the Creator Third Party App Policy says "Do not request API keys from other Roblox Users". If the product promises "publish to YOUR Roblox experience without Studio," that promise cannot be kept compliantly today. Platform-owned universes solve the UX but mean the user does not own the experience — decide deliberately and say so in your marketing.

2. NO API CREATES AN EXPERIENCE. Universe and place creation do not exist in Open Cloud (verified: 404 on every candidate route vs 403 on real ones) and the Creator Hub has no web create flow. Studio is required to mint a universe. Roblox's own schemas reference CreateUniverse, CreatePlace and ListTemplatePlaces, so this is coming — but you cannot ship on it.

3. 10 MiB PUBLISH CEILING. The publish request is capped at 10,485,760 bytes — 10x below the 100 MB place limit. Ambitious AI-generated worlds will hit this. You need size budgeting and user-visible warnings, and .rbxl export as the overflow path.

4. INSTANCE TYPES SILENTLY NOT PUBLISHED. EditableImage, EditableMesh, PartOperation, SurfaceAppearance, BaseWrap are not updated by the publish API. No CSG unions, no custom surface appearances. Constrain the generator or users will see changes that never appear.

5. NO LIVE PREVIEW OF THE REAL PLACE. x-frame-options: SAMEORIGIN blocks iframing roblox.com; there is no web player, no embed SDK, and no server-side render or screenshot API (Luau Execution runs with no rendering and no physics; game thumbnails are creator-uploaded). The center pane can only ever be your own approximation.

6. LUAU EXECUTION CANNOT SAVE. "Data model changes are local to the task and cannot be persisted." It is a verifier, not a builder. Also 10 incomplete tasks per place max (429 beyond), 5/min per API key owner on versioned tasks, and latency is undocumented and queue-based — not interactive.

7. INSTANCE API IS NOT A BUILD PATH. Script/LocalScript/ModuleScript only, update-only (no create/delete), API-key only, 200 KB bodies, and it REQUIRES an active Team Create session and fails while the script is open in Studio.

8. API KEYS AUTO-EXPIRE AFTER 60 DAYS of no use or update, silently breaking automation. Needs monitoring and a rotation runbook.

9. RATE LIMITS POOL PER OWNER. All API keys for one owner share the quota (30 publishes/min). A single platform account is a global bottleneck and a single point of moderation failure — if that account is moderated, every customer's publishing stops. Plan for sharding across accounts/groups and for the "Moderated"/"User Moderated" key states.

10. POLICY LANDMINES. "You may not utilize any user data for the training of AI or language learning models" — check this against your training/eval plans. Also no cross-experience tracking, no selling API-derived data, and mandatory data expungement if API access is lost.

11. MODERATION AND LIABILITY. Under platform-owned universes, everything users generate is published under YOUR Roblox account. You inherit moderation exposure for AI-generated content at scale. You need pre-publish content filtering and a kill switch.

12. STABILITY FLAGS. The publish endpoint is still marked BETA in Roblox's own spec, OAuth 2.0 is marked beta, and the Instance and Assets APIs are beta. Only Luau Execution and the cloud/v2 universe/place metadata endpoints are STABLE.

13. LISTING A USER'S EXPERIENCES IS WEAK. games.roblox.com/v2/users/{userId}/games only supports accessFilter=2 (PUBLIC) — verified: 1 and 4 return NotImplemented — so brand-new private experiences never appear. Use API-key introspect or OAuth token/resources instead.

14. VERIFIED BY DOCS AND PROBES, NOT BY A REAL PUBLISH. Endpoint existence, auth rejection modes, listing responses and framing headers were confirmed live, but no successful authenticated publish was performed (no API key available). The 10 MiB cap and the 30/min limits come from Roblox's official OpenAPI spec and should be confirmed with one real upload before launch.

### User setup steps

Two paths. Ship A; document B for users who insist on owning the experience.

PATH A — RECOMMENDED v1: platform-owned experience. User setup is ZERO Roblox steps.
The user needs only a Roblox account to PLAY, never to build.
1. User signs up on your product with email/OAuth of your choosing. No Roblox connection required.
2. User prompts; you build the project tree and serialize .rbxlx server-side.
3. You assign the project one of your pre-provisioned placeIds inside a platform-owned universe.
4. You publish with YOUR API key: POST https://apis.roblox.com/universes/v1/{yourUniverseId}/places/{assignedPlaceId}/versions?versionType=Published with headers x-api-key and Content-Type: application/xml.
5. Product shows a Play button -> https://www.roblox.com/games/start?placeId={assignedPlaceId} (or roblox://placeId={assignedPlaceId}). First click prompts the user to install/open the Roblox client and sign in to Roblox — that is the only Roblox account touchpoint.
6. Offer "Download .rbxlx" at all times so the user can take ownership later.

YOUR ONE-TIME OPERATOR SETUP (done once by you, not by users):
a. Create a Roblox account for the platform (ideally a Roblox GROUP owning the experiences, with a dedicated automation alt account holding a minimal role — Roblox's own recommendation).
b. Install Roblox Studio once on one machine. File > New > Baseplate. File > Publish to Roblox. Name it, set Creator to your group, click Create. Repeat to create the universes you need.
c. In Studio, add extra places per universe (or test whether AssetService:CreatePlaceAsync via a Luau Execution task can mint them on demand).
d. Go to https://create.roblox.com/dashboard/creations, hover the experience tile, click the ⋯ overflow, "Copy Universe ID" and "Copy Start Place ID". For other places: click the tile > Places tab > click the place; the placeId is in the URL .../experiences/{universeId}/places/{placeId}/configure.
e. Go to https://create.roblox.com/dashboard/credentials?activeTab=ApiKeysTab > Create API Key. Name it e.g. PLATFORM_PUBLISH. Access Permissions > add API System `universe-places` > select your experiences > add the `Write` operation. (Add the Luau Execution system with read+write if you want the validation gate.) Under Security add your egress IPs in CIDR, or leave unrestricted. Set no expiration. Save & Generate Key, copy it into your secret manager.
f. IMPORTANT: keys auto-expire after 60 days of no use or update. Add a monitor and a rotation runbook.
g. Validate at any time: POST https://apis.roblox.com/api-keys/v1/introspect with {"apiKey":"..."} to confirm enabled/expired and the scoped universeIds.

PATH B — user-owned experience. Requires Studio ONCE; you cannot publish for them compliantly.
1. User installs Roblox Studio (https://create.roblox.com — Windows/macOS only; there is no browser Studio).
2. Studio > Open a Template > Baseplate.
3. File > Publish to Roblox. Fill Name, Description, Creator, Devices. Click Create. The experience now exists and is PRIVATE by default.
4. Connect to your product with OAuth2 (identity + metadata only): send the user to https://apis.roblox.com/oauth/v1/authorize?client_id=<id>&redirect_uri=<https url>&scope=openid%20profile%20universe%3Aread%20universe.place%3Aread%20universe.place%3Awrite&response_type=code&state=<csrf>&code_challenge=<S256>&code_challenge_method=S256. Exchange the code at POST https://apis.roblox.com/oauth/v1/token (grant_type=authorization_code). Access token lives 15 minutes; refresh token lives 90 days and is SINGLE-USE, so persist the rotated one every refresh.
5. Show an experience picker from POST https://apis.roblox.com/oauth/v1/token/resources (returns resource_infos[].resources.universe.ids), then GET https://develop.roblox.com/v1/universes/{universeId}/places for place names (no auth needed).
6. You can now rename/describe their experience (PATCH /cloud/v2/universes/{u}/places/{p}?updateMask=displayName,description) and upload assets — but you CANNOT publish place content.
7. To ship the game: user clicks "Download .rbxlx" in your product, opens it in Studio, then File > Publish to Roblox > select their existing experience. One manual step per release until Roblox adds universe-places:write to the Creation & Productivity Tools OAuth2 category.

DO NOT ask users to paste an Open Cloud API key. The Creator Third Party App Policy states: "Do not request API keys from other Roblox Users."

## Part 2 — Place file format, build strategy, and project model

### Summary

I verified everything empirically rather than from memory: I downloaded Rojo 7.7.0 and Lune 0.10.5, hand-wrote a minimal .rbxlx, and confirmed it parses through rbx-dom and round-trips to binary. I also pulled Roblox's own Studio-authored place files out of the creator-docs repo via Git LFS, which gave exact Baseplate/SpawnLocation/Lighting values, an official R15 NPC, and Roblox's shipped Animate script.

Recommendation: Rojo CLI as the primary builder, Lune as the parse/verify sidecar. Rojo alone has an escape hatch for properties newer than its reflection database (verified), Lune alone can import existing places, and a Rojo project doubles as your AI-editable project model.

Three things that will break naive assumptions: Motor6D has been superseded by AnimationConstraint for avatar rigs (default for new experiences); file-level property names diverge from API names (Size→size, Color→Color3uint8, Health→Health_XML, 65 ContentId→Content migrations); and a literal `]]>` in Luau source corrupts CDATA unless split.

No official R6 rig spec exists — the circulating numbers are unverified folklore. I give an honest alternative NPC path.

### rbxlx XML format: document structure, version, Item/referent, Properties, Meta, External, SharedStrings  `[COMMUNITY-STANDARD]`

Spec = rbx-dom `docs/xml.md` "Roblox XML Model Format, Version 4" (RFC-2119 language). Verified against a real Roblox-authored place file (creator-docs `DialogSystem.rbxlx`) which I downloaded and parsed.

Root: exactly one `<roblox>` with REQUIRED attribute `version` which MUST be `4`. All other root attributes OPTIONAL — Studio writes `xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd"`; my `<roblox version="4">` bare root round-tripped fine through rbx-dom.

Under `<roblox>`: zero+ `<Meta>`, zero+ `<External>`, zero+ `<Item>`, zero-or-one `<SharedStrings>`. Under each `<Item>`: exactly one `<Properties>` + zero+ nested `<Item>`.

`<Item class="X" referent="Y">` — both REQUIRED. `referent` MUST be unique in the file and MUST NOT be the literal `null` (reserved for empty Ref). Roblox generates `RBX` + UUID-hex, but this is NOT required — Rojo emits plain integers (`referent="0"`, `"1"`, …) and it works. My hand-written referents `RBX0000…000A` parsed fine.

`<Properties>`: every child is a Type Element with REQUIRED `name` attribute. Critical: "Roblox does not utilize the actual element name" — decoders SHOULD use a reflection system, not the tag name. That's why Rojo writes `<string name="Source"><![CDATA[…]]></string>` and Studio still loads it as ProtectedString.

`<Meta name="...">value</Meta>`: Roblox writes `ExplicitAutoJoints=true` for **model** files (.rbxmx) only. "Roblox does not currently generate any Meta elements for place files." Confirmed: the official DialogSystem.rbxlx has zero Meta elements. For places, the equivalent is the real Workspace property `<bool name="ExplicitAutoJoints">true</bool>` (rbx-dom default: true).

`<External>null</External><External>nil</External>`: legacy, does nothing, OPTIONAL. Studio writes exactly these two.

`<SharedStrings><SharedString md5="KEY">BASE64</SharedString></SharedStrings>`: `md5` is just a unique key, need not be a real MD5. Referenced by `<SharedString name="Prop">KEY</SharedString>` and by `NetAssetRef`.

Citations:
- https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/docs/xml.md
- https://media.githubusercontent.com/media/Roblox/creator-docs/main/content/en-us/assets/solutions/DialogSystem.rbxlx
- https://github.com/rojo-rbx/rbx-dom

### Exact encoding of every property type tag we will emit  `[COMMUNITY-STANDARD]`

All verbatim from rbx-dom xml.md §Type Elements; cross-checked against Studio output.

string: `<string name="Name">Hello</string>` — escape `&<>` normally.
bool: `<bool name="Anchored">true</bool>` — lowercase by convention.
int (Int32): `<int name="Duration">0</int>`; range −2147483648..2147483647; no leading `+`.
int64: `<int64 name="SourceAssetId">-1</int64>`.
float (Float32): `<float name="Brightness">3</float>`; XSD precisionDecimal; `INF`/`+INF`/`-INF`/`NAN` uppercase MANDATORY; encode ≥7 sig figs.
double (Float64): `<double name="DistributedGameTime">0</double>`; ≥16 sig figs.
token (= Enum): `<token name="Material">256</token>` — numeric Value. MUST be named `token`.
Vector3: `<Vector3 name="size"><X>2048</X><Y>16</Y><Z>2048</Z></Vector3>` (children are floats).
CoordinateFrame (= CFrame): MUST be named `CoordinateFrame`; 12 float children in order `X Y Z R00 R01 R02 R10 R11 R12 R20 R21 R22`.
Color3: `<Color3 name="Ambient"><R>0.274509817</R><G>…</G><B>…</B></Color3>` (floats 0–1).
Color3uint8: single u32, RGB packed in low 24 bits, upper 8 bits SHOULD be `FF`. Studio Baseplate: `4284177243` = 0xFF5B5B5B = RGB(91,91,91). NOTE: rbx-dom writes it WITHOUT the FF (it emitted `5987163` = 0x005B5B5B); both decode to the same color, but emit `0xFF000000 | (r<<16) | (g<<8) | b` for Studio fidelity.
ProtectedString: contents MUST be preserved byte-exactly incl. whitespace; SHOULD be wrapped in CDATA. `<ProtectedString name="Source"><![CDATA[print("hi")]]></ProtectedString>`. CDATA ESCAPING RULE (verified empirically): a literal `]]>` inside Luau source must be split — rbx-dom emits `]]]]><![CDATA[>`. I round-tripped `print(t[1][1]]>0)` through Lune and got byte-identical source back. If you don't implement this, any script containing `]]>` corrupts the file.
Ref (= Referent): MUST be named `Ref`. `<Ref name="Part0">RBX466F…</Ref>`; empty = `null`.
UniqueId: 16 bytes hex, 32 chars (spec's example shows 30 — Studio writes 32, e.g. `766756f93d4eb92d0a015d7000000ba1`). Layout: bytes 0–7 Random(u64), 8–11 Time(u32), 12–15 Index(u32). XML rotates the Random component left-circular by 1 bit vs the binary format. **Just omit UniqueId/HistoryId entirely** — Studio regenerates them.
BinaryString: base64 (RFC 2045). Used for `AttributesSerialize`, `Tags`, `CollisionGroupData`.
SharedString: content is the `md5` key of a `<SharedString>` definition. **Not needed for generation** — only for dedup of large blobs (mesh data). Emit BinaryString instead.
OptionalCoordinateFrame: `<OptionalCoordinateFrame name="WorldPivotData"><CFrame>…12 children…</CFrame></OptionalCoordinateFrame>`; omit the child element for `None`. Not needed unless you set Model.WorldPivot.
Content (new type, post-release-645): child MUST be exactly one of `<null />`, `<uri>…</uri>`, or `<Ref>…</Ref>`.
ContentId (the old type formerly called `Content`): child is `<url>…</url>` or `<null />`.
Also relevant: BrickColor serializes as `<int>` (e.g. TeamColor 194 = Medium stone grey); PhysicalProperties = `<CustomPhysics>false</CustomPhysics>` alone, or true + Density/Friction/Elasticity/FrictionWeight/ElasticityWeight/AcousticAbsorption; UDim2 = `XS/XO/YS/YO`; NumberRange = `"0.95 1 "`; Font = Family(Content)/Weight(int)/Style(String)/CachedFaceId.

Citations:
- https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/docs/xml.md
- https://media.githubusercontent.com/media/Roblox/creator-docs/main/content/en-us/assets/solutions/DialogSystem.rbxlx

### CRITICAL: file-level property names diverge from API names (SerializesAs / Migrate)  `[COMMUNITY-STANDARD]`

The official API dump does NOT contain this mapping. rbx-dom's reflection database does, under `Classes[C].Properties[P].Kind.Canonical.Serialization`. Getting this wrong is the #1 way a hand-rolled serializer produces a file that opens but looks wrong.

Complete `SerializesAs` list from rbx-dom DB v0.728 (26 entries; deduped):
  BasePart.Size → `size`  (lowercase!)
  BasePart.Color → `Color3uint8`
  BasePart.MaterialVariant → `MaterialVariantSerialized`
  Part.Shape → `shape`
  FormFactorPart.FormFactor → `formFactorRaw`
  Instance.Archivable → `archivable`
  Instance.Attributes → `AttributesSerialize`
  Instance.Sandboxed → `DefinesCapabilities`
  Model.Scale → `ScaleFactor`
  Players.MaxPlayers → `MaxPlayersInternal`; Players.PreferredPlayers → `PreferredPlayersInternal`
  Workspace.SignalBehavior → `SignalBehavior2`
  StarterPlayer.AvatarJointUpgrade → `AvatarJointUpgrade_SerializedRollout`
  WeldConstraint.Part0/Part1 → `Part0Internal`/`Part1Internal`
  Sound.RollOffMaxDistance → `xmlRead_MaxDistance_3`; Sound.RollOffMinDistance → `EmitterSize`
  Fire.Heat/Size → `heat_xml`/`size_xml`; Smoke.Opacity/RiseVelocity → `opacity_xml`/`riseVelocity_xml`
  MaterialService.Use2022Materials → `Use2022MaterialsXml`; PackageLink.PackageContent → `PackageContentSerialize`; StyleRule.Properties → `PropertiesSerialize`

Separately: `Humanoid.Health` has Serialization=`DoesNotSerialize`; the serializing property is `Health_XML` (Hidden, NotScriptable, Float32, default 100). Emit `<float name="Health_XML">100</float>`, never `Health`.

65 `Migrate` entries — legacy ContentId props auto-migrate to new Content props. Key ones: Decal.Texture→TextureContent, MeshPart.TextureID→TextureContent, MeshPart.MeshId→MeshContent, Sound.SoundId→AudioContent, Animation.AnimationId→AnimationContent, ImageLabel/ImageButton.Image→ImageContent, Sky.SkyboxBk/Ft/Lf/Rt/Up/Dn→Skybox{Back,Front,Left,Right,Up,Down}Content, BasePart.BrickColor→Color (BrickColorToColor), TextBox.Font→FontFace (FontToFontFace), ScreenGui.IgnoreGuiInset→ScreenInsets. Both forms load; Studio itself still writes `<Content name="Texture"><url>rbxasset://textures/SpawnLocation.png</url></Content>` for Decals, while rbx-dom canonicalizes to `<Content name="TextureContent"><uri>…</uri></Content>`. Emit either; prefer the legacy `Texture`/`<url>` form for maximum Studio-version compatibility.

Attributes blob format (decoded empirically from a Lune-produced file): `u32 count`, then per entry `u32 nameLen | nameBytes | u8 typeId | value`, entries sorted by name. Type IDs from rbx_types/src/attributes/type_id.rs: 0x02 String/BinaryString, 0x03 Bool(u8), 0x04 Int32, 0x05 Float32, 0x06 Float64, 0x09 UDim, 0x0A UDim2, 0x0E BrickColor, 0x0F Color3, 0x10 Vector2, 0x11 Vector3, 0x14 CFrame, 0x15 EnumItem, 0x17 NumberSequence, 0x19 ColorSequence, 0x1B NumberRange, 0x1C Rect, 0x21 Font. Example: `{Label="gold", Rare=true, Value=5}` → `03000000 05000000 "Label" 02 04000000 "gold" 04000000 "Rare" 03 01 05000000 "Value" 05 0000a040`.

CollectionService tags format: `<BinaryString name="Tags">` = base64 of NUL-separated UTF-8 tag names. `AddTag("Coin"); AddTag("Collectible")` → `Q29pbgBDb2xsZWN0aWJsZQ==` = `b'Coin\x00Collectible'`. Verified.

Citations:
- https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/rbx_dom_lua/src/database.json
- https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/rbx_types/src/attributes/type_id.rs
- https://media.githubusercontent.com/media/Roblox/creator-docs/main/content/en-us/assets/solutions/DialogSystem.rbxlx

### Which properties may be omitted (defaults) — verified  `[COMMUNITY-STANDARD]`

Any property may be omitted; the loader fills the class default. Empirically verified: I wrote a `<Item class="Part">` with only Name/size/CFrame/Anchored/Locked/Color3uint8/Material/6×Surface, parsed it with rbx-dom, and got Reflectance=0, CanCollide=true, Transparency=0, Material=Plastic. Rojo and Lune both emit *sparse* files by design (Lune emitted a working place with 3 services and 9 properties on the Baseplate). Only `Name` is practically mandatory (default is the ClassName otherwise).

Machine-readable defaults: rbx-dom's `Classes[C].DefaultProperties` (JSON at rbx_dom_lua/src/database.json, 2.35 MB, keyed by *serialized* names). The official Roblox API dump has NO default values — this is a second reason you need rbx-dom.

Defaults that WILL bite you if omitted:
  Part.Size = (4, 1.2, 2)
  Part.TopSurface = 3 (Studs), BottomSurface = 4 (Inlet) → visible bumps/holes. Studio's own templates explicitly write all six surfaces as 0 (Smooth). ALWAYS emit Top/Bottom/Left/Right/Front/BackSurface = 0.
  Part.Color = Color3uint8 (163,162,165) "Medium stone grey"
  Part.Anchored = false → unanchored parts fall
  SpawnLocation.Duration = 10 (ForceField for 10 s); the Baseplate template sets 0
  Script.RunContext = 0 (Legacy)
  Players.RespawnTime = 5.0; Players.MaxPlayers(→MaxPlayersInternal) = 12
  Workspace.Gravity = 196.2, StreamingEnabled = false, ExplicitAutoJoints = true, FallenPartsDestroyHeight = −500
  Humanoid: WalkSpeed 16, JumpPower 50, JumpHeight 7.2, UseJumpPower true, MaxSlopeAngle 89, HipHeight 0, RigType 0 (R6), Health_XML 100, MaxHealth 100
  Lighting class defaults: Ambient (0.5,0.5,0.5), Brightness 1.9812492, Technology 1 (Voxel), GlobalShadows false, TimeOfDay "14:00:00", GeographicLatitude 41.7333, ShadowSoftness 0.5, FogEnd 100000

Citations:
- https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/rbx_dom_lua/src/database.json
- https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/docs/xml.md

### Verified minimal place skeleton (parses through rbx-dom, round-trips to binary)  `[COMMUNITY-STANDARD]`

I wrote this by hand, parsed it with Lune 0.10.5 (rbx-dom backed), read every property back correctly, and re-serialized to .rbxl and .rbxlx. Values for Baseplate/SpawnLocation/Lighting are copied from Roblox's own DialogSystem.rbxlx.

<roblox version="4">
 <Item class="Workspace" referent="RBX...0A"><Properties>
  <string name="Name">Workspace</string>
  <float name="Gravity">196.2</float>
  <bool name="StreamingEnabled">false</bool>
  <bool name="ExplicitAutoJoints">true</bool>
 </Properties>
  <Item class="Part" referent="RBX...0B"><Properties>
   <string name="Name">Baseplate</string>
   <Vector3 name="size"><X>2048</X><Y>16</Y><Z>2048</Z></Vector3>
   <CoordinateFrame name="CFrame"><X>0</X><Y>-8</Y><Z>0</Z><R00>1</R00><R01>0</R01><R02>0</R02><R10>0</R10><R11>1</R11><R12>0</R12><R20>0</R20><R21>0</R21><R22>1</R22></CoordinateFrame>
   <bool name="Anchored">true</bool><bool name="Locked">true</bool>
   <Color3uint8 name="Color3uint8">4284177243</Color3uint8>
   <token name="Material">256</token>
   <token name="TopSurface">0</token><token name="BottomSurface">0</token><token name="LeftSurface">0</token><token name="RightSurface">0</token><token name="FrontSurface">0</token><token name="BackSurface">0</token>
  </Properties>
   <Item class="Texture" referent="RBX...0C"><Properties>
    <string name="Name">Texture</string>
    <Content name="Texture"><url>rbxassetid://6372755229</url></Content>
    <token name="Face">1</token>
    <float name="StudsPerTileU">8</float><float name="StudsPerTileV">8</float>
    <float name="Transparency">0.8</float>
    <Color3 name="Color3"><R>0</R><G>0</G><B>0</B></Color3>
   </Properties></Item></Item>
  <Item class="SpawnLocation" referent="RBX...0D"><Properties>
   <string name="Name">SpawnLocation</string>
   <Vector3 name="size"><X>12</X><Y>1</Y><Z>12</Z></Vector3>
   <CoordinateFrame name="CFrame"><X>0</X><Y>0.5</Y><Z>0</Z><R00>1</R00>…identity…<R22>1</R22></CoordinateFrame>
   <bool name="Anchored">true</bool><bool name="Neutral">true</bool><bool name="Enabled">true</bool>
   <int name="Duration">0</int>
   <Color3uint8 name="Color3uint8">4288914085</Color3uint8>
   <token name="TopSurface">0</token><token name="BottomSurface">0</token>
  </Properties>
   <Item class="Decal" referent="RBX...0E"><Properties>
    <string name="Name">Decal</string>
    <Content name="Texture"><url>rbxasset://textures/SpawnLocation.png</url></Content>
    <token name="Face">1</token>
   </Properties></Item></Item></Item>
 <Item class="Lighting" referent="RBX...10"><Properties>
  <string name="Name">Lighting</string>
  <Color3 name="Ambient"><R>0</R><G>0</G><B>0</B></Color3>
  <float name="Brightness">3</float>
  <Color3 name="OutdoorAmbient"><R>0.27451</R><G>0.27451</G><B>0.27451</B></Color3>
  <bool name="GlobalShadows">true</bool>
  <token name="Technology">3</token>
  <string name="TimeOfDay">14:30:00</string>
  <float name="GeographicLatitude">0</float>
  <float name="EnvironmentDiffuseScale">1</float><float name="EnvironmentSpecularScale">1</float>
  <float name="ShadowSoftness">0.2</float><bool name="Outlines">false</bool>
 </Properties></Item>
 <Item class="ReplicatedStorage" referent="RBX...11"><Properties><string name="Name">ReplicatedStorage</string></Properties></Item>
 <Item class="ServerScriptService" referent="RBX...12"><Properties><string name="Name">ServerScriptService</string></Properties>
  <Item class="Script" referent="RBX...13"><Properties>
   <string name="Name">Main</string>
   <token name="RunContext">1</token>
   <bool name="Disabled">false</bool>
   <ProtectedString name="Source"><![CDATA[local Players = game:GetService("Players")

Players.PlayerAdded:Connect(function(player)
	print(("%s joined"):format(player.Name))
end)
]]></ProtectedString>
  </Properties></Item></Item>
 <Item class="StarterPlayer" referent="RBX...14"><Properties><string name="Name">StarterPlayer</string></Properties>
  <Item class="StarterPlayerScripts" referent="RBX...15"><Properties><string name="Name">StarterPlayerScripts</string></Properties></Item>
  <Item class="StarterCharacterScripts" referent="RBX...16"><Properties><string name="Name">StarterCharacterScripts</string></Properties></Item></Item>
 <Item class="StarterGui" referent="RBX...17"><Properties><string name="Name">StarterGui</string></Properties></Item>
 <Item class="Players" referent="RBX...18"><Properties><string name="Name">Players</string><float name="RespawnTime">3</float><bool name="CharacterAutoLoads">true</bool></Properties></Item>
</roblox>

Parse output: DataModel → Workspace{Part Baseplate{Texture}, SpawnLocation{Decal}}, Lighting, ReplicatedStorage, ServerScriptService{Script Main}, StarterPlayer{StarterPlayerScripts, StarterCharacterScripts}, StarterGui, Players. Baseplate.Size=(2048,16,2048), CFrame=(0,−8,0), Color=(0.35686,0.35686,0.35686), Material=Plastic, TopSurface=Smooth. Lighting.Technology=ShadowMap. Script.RunContext=Server. Source byte-identical.

Citations:
- https://media.githubusercontent.com/media/Roblox/creator-docs/main/content/en-us/assets/solutions/DialogSystem.rbxlx
- https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/docs/xml.md
- https://lune-org.github.io/docs/api-reference/roblox

### Build strategy (a): hand-rolled TypeScript .rbxlx serializer  `[COMMUNITY-STANDARD]`

Feasible and I proved a hand-written file is accepted. ~600–900 LOC for a bounded surface (Part, MeshPart, Model, Folder, Script/LocalScript/ModuleScript, SpawnLocation, Decal/Texture, Attachment, Motor6D/WeldConstraint, ProximityPrompt, Sound, GUI basics, Lighting/Workspace/service roots).

PROS: zero subprocess, zero binary deployment, trivially serverless (Vercel/Lambda), you control formatting/diffs, no reflection-DB staleness — you can emit a property Roblox shipped yesterday.
CONS you must own: (1) the ~26 SerializesAs renames + 65 ContentId→Content migrations + Health_XML; (2) the `]]>` CDATA split; (3) Color3uint8 |0xFF000000; (4) float formatting (≥7 sig figs, INF/NAN uppercase); (5) attribute + tag binary blobs; (6) **no import path** — parsing an existing binary .rbxl is a large separate project (LZ4 chunks, interleaved/transposed property arrays, rotation-ID CFrame compression). You would still need rbx-dom for import.

Verdict: viable as a *fallback/emergency* emitter, not as the primary, precisely because of the import requirement.

Citations:
- https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/docs/xml.md
- https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/rbx_dom_lua/src/database.json

### Build strategy (b): Rojo CLI — conventions, install, empirical results  `[COMMUNITY-STANDARD]`

Rojo 7.7.0, released 2026-07-02. I installed it and built real places.

Project file (`default.project.json`): required `name` (string) + `tree` (Instance Description). Optional: `servePort` (default 34872), `servePlaceIds`, `placeId`, `gameId`, `serveAddress`, `globIgnorePaths`, `emitLegacyScripts` (default **true**).
Instance Description keys: `$className` (optional if `$path`), `$path` (optional if `$className`), `$properties`, `$attributes`, `$ignoreUnknownInstances`. Any other key = a named child instance.
Property values: implicit (`"Anchored": true`) — resolved via Rojo's bundled rbx-dom reflection DB — or explicit (`"Anchored": {"Bool": true}`, `"Size": {"Vector3": [2048,16,2048]}`, `"CFrame": {"CFrame": {"position":[0,-8,0],"orientation":[[1,0,0],[0,1,0],[0,0,1]]}}`, `"Color": {"Color3uint8":[91,91,91]}`, `"Material": {"Enum": 256}`).
**Verified escape hatch**: implicit unknown property → hard error `Unknown property Part.SomeBrandNewProp2026`. Explicit `{"Bool": true}` / `{"Enum": 7}` on the SAME unknown property **builds successfully** and emits `<bool name="SomeBrandNewProp2026">true</bool>`. This is the single most important differentiator: it makes Rojo forward-compatible with Roblox properties newer than its reflection DB.

File→class map: `.lua`/`.luau`→ModuleScript; `.server.lua(u)`→Script; `.client.lua(u)`→LocalScript; `init.luau` turns the containing folder into a ModuleScript (same for `init.server`/`init.client`); `.model.json`; `.project.json` (nested projects); `.rbxm`/`.rbxmx`; `.txt`→StringValue; `.csv`→LocalizationTable; `.json`→ModuleScript returning a table; `*.meta.json` / `init.meta.json` add `className`, `properties`, `ignoreUnknownInstances`.
`.model.json` shape: `{"className":"Model","properties":{},"children":[{"className":"Part","name":"Marker","properties":{"Anchored":true}}]}` — a top-level `name` field is ignored since Rojo 6.0 (warns); the file's basename is the instance name.

Build: `rojo build --output game.rbxlx .` (also `.rbxl` binary — verified, magic `3c 72 6f 62 6c 6f 78 21 89 ff 0d 0a 1a 0a`). Measured **~11 ms** wall clock for the sample project.

emitLegacyScripts semantics (measured): true → `.server.luau` becomes `class="Script"` with `<token name="RunContext">0</token>` (Legacy) and `.client.luau` becomes `class="LocalScript"`. false → both become `class="Script"` with RunContext 1 (Server) / 2 (Client). Set it **false** to match modern Roblox guidance.

Source encoding: Rojo writes `<string name="Source"><![CDATA[...]]></string>` — element named `string`, CDATA-wrapped, whitespace preserved. Loads fine because Roblox uses reflection, not tag names. Referents are plain integers.

Install (macOS arm64 + Linux): Rokit is the recommended toolchain manager — `rokit add rojo-rbx/rojo && rokit install`, pinned in `rokit.toml`. Rokit 1.2.0 ships `rokit-1.2.0-{macos,linux}-{aarch64,x86_64}.zip`. For a Docker/serverless image, skip Rokit: download `rojo-7.7.0-linux-x86_64.zip` (5.90 MB) or `-linux-aarch64.zip` (5.90 MB) from GitHub releases, unzip, chmod +x. Also `cargo install rojo --version ^7`. Aftman/Foreman still work but Rokit supersedes them.

Limitation: Rojo has **no import** — it can build files, not read them back.

Citations:
- https://rojo.space/docs/v7/project-format/
- https://rojo.space/docs/v7/sync-details/
- https://rojo.space/docs/v7/getting-started/installation/
- https://api.github.com/repos/rojo-rbx/rojo/releases/latest
- https://api.github.com/repos/rojo-rbx/rokit/releases/latest

### Build strategy (c): Lune — API surface, maturity, empirical results  `[COMMUNITY-STANDARD]`

Lune 0.10.5, released 2026-07-02. Standalone Luau runtime in Rust; `@lune/roblox` is backed by rbx-dom. I installed and used it extensively.

Exact API (from `crates/lune-std-roblox/types.d.luau`):
  roblox.deserializePlace(contents: string): DataModel     — accepts both .rbxl and .rbxlx
  roblox.deserializeModel(contents: string): { Instance }
  roblox.serializePlace(dataModel: DataModel, xml: boolean?): string   — xml defaults false (binary)
  roblox.serializeModel(instances: { Instance }, xml: boolean?): string
  roblox.getReflectionDatabase(): Database  → :GetClass/:GetEnum/:FindClass/:FindEnum/:GetClassNames/:GetEnumNames; DatabaseClass = {Name, Superclass, Properties, DefaultProperties, Tags}
  roblox.implementProperty / implementMethod  — polyfill engine-only APIs
  roblox.getAuthCookie(raw)  — reads the local .ROBLOSECURITY (desktop only; useless on a server)
  roblox.studioApplicationPath/ContentPath/PluginPath/BuiltinPluginPath
NOTE: the older `readPlaceFile`/`writePlaceFile` path-based functions were **removed**; pair with `@lune/fs`. Instance.new("DataModel") is allowed (not possible in-engine).

Measured: full place build from scratch ≈ **18 ms**. Parsed Roblox's 1.29 MB DialogSystem.rbxlx and a 133 KB binary .rbxl without issue.

Validation behavior (this is the interesting part): Lune type-checks every write against the reflection DB.
  Instance.new("NotARealClass") → "'NotARealClass' is not a valid class name"
  part.TotallyFakeProp = 5 → "TotallyFakeProp is not a valid member of Part"
  part.Anchored = "yes" → "Failed to convert from 'string' into 'Bool'"
That is a free, correct validation layer for AI-generated edits.

Hard limitations found:
  1. **No escape hatch.** Unlike Rojo's explicit `{"Bool": true}`, Lune has no way to set a property its DB doesn't know. Its DB is pinned at Roblox **0.728.0.7280895** while live Studio is **0.731.0.7310942** — three releases stale. Any brand-new property is unsettable until Lune ships a new build.
  2. Reading some Content-typed properties fails: `decal.Texture` threw "Failed to get property 'Texture' - missing default value". Writing/round-tripping is fine; reading is not.
  3. Sparse output: it writes only touched properties and only touched services (my scratch place emitted just Workspace/ServerScriptService/Lighting). Fine for Studio (which fills in the rest) but means you cannot use Lune output as a diffable canonical form.
  4. Emits `<string name="Source">` not `<ProtectedString>`, and Color3uint8 without the 0xFF high byte.

Install: `rokit add lune-org/lune`, or GitHub release zips `lune-0.10.5-{macos,linux}-{aarch64,x86_64}.zip` (~5 MB). No npm package (`lune` on npm is an unrelated carbon-accounting SDK).

Citations:
- https://lune-org.github.io/docs/api-reference/roblox
- https://raw.githubusercontent.com/lune-org/lune/main/crates/lune-std-roblox/types.d.luau
- https://api.github.com/repos/lune-org/lune/releases/latest
- https://clientsettings.roblox.com/v2/client-version/WindowsStudio64

### npm ecosystem: no credible rbx-dom JS/WASM port  `[NOT-POSSIBLE]`

Searched the npm registry directly. Nothing credible exists.
  rbxm-parser 1.1.4 (2025-06-03), github.com/fiveman1/rbxm-parser-ts — **1,458 downloads/month**. Reads/writes .rbxm (binary model) only. Not places, not XML.
  rbxlx-parser 1.0.1 (2024-02-02) — 43 downloads/month.
  roblox-xml2-parser 1.0.0 (2022-06-08) — 47 downloads/month.
  rbxl-inspect 0.1.1 (2026-03-24) — 592/month; read-only extraction for LLMs, not a DOM.
  rojo-programmatic-sync 0.0.2 (2025-12-22) — merges a Rojo project into an existing place; thin wrapper.
There is **no** WASM build of rbx_xml / rbx_binary published to npm. If you want in-process JS, your only real options are (a) write the XML emitter yourself, or (b) compile rbx-dom to WASM yourself (rbx_xml + rbx_binary + rbx_reflection_database via wasm-bindgen) — a real but nontrivial project that would give you parse+serialize for both formats inside Node with no subprocess.

Citations:
- https://registry.npmjs.org/-/v1/search?text=rbxlx&size=8
- https://registry.npmjs.org/rbxm-parser
- https://api.npmjs.org/downloads/point/last-month/rbxm-parser

### Playable-place requirements: services, spawning, character loading  `[OFFICIAL]`

Services present in a Studio-saved place (from Roblox's own DialogSystem.rbxlx, 53 top-level Items): Workspace, Lighting, Players, ReplicatedFirst, ReplicatedStorage, ServerScriptService, ServerStorage, StarterPlayer, StarterPack, StarterGui, Teams, SoundService, TextChatService, VoiceChatService, MaterialService, TweenService, CollectionService, Chat, Debris, InsertService, TeleportService, PhysicsService, AssetService, HttpService, ProximityPromptService, DataStoreService, TestService, LocalizationService, VRService, ContextActionService, plus ~20 internal ones (CSGDictionaryService, StudioData, GuidRegistryService, ProcessInstancePhysicsService, …).
**You do not need to emit them.** Rojo places containing only 5 services build and open in Studio, which auto-creates the rest (and Workspace.Camera and Workspace.Terrain) on load. Recommended emit set: Workspace (+Baseplate, SpawnLocation), Lighting, ReplicatedStorage, ReplicatedFirst, ServerScriptService, ServerStorage, StarterPlayer{StarterPlayerScripts, StarterCharacterScripts}, StarterGui, StarterPack, Players, SoundService, Teams.

Spawning: `SpawnLocation`s "determine where a Player respawns when they die." Rules from the official class reference: Neutral=false → only Players whose Player.TeamColor matches SpawnLocation.TeamColor respawn above it; Neutral=true → anyone; "If multiple eligible spawns are available to a Player, a random one will be chosen"; players spawn at different points on top of a SpawnLocation but may still overlap. `Duration` = ForceField seconds; if 0 "the ForceField is never created." `Enabled=false` disables it. Gotcha from the same page: adding a SpawnLocation in Studio with Neutral=false auto-creates a matching Team — this does NOT happen when created from a Script, so always create Teams explicitly.
Behavior with **no** SpawnLocation: not stated in the official reference. Community consensus is spawn at world origin (0,0,0), which drops the character through/onto whatever is there. **Always emit a SpawnLocation** and treat "no spawn" as a lint error.

Character loading: `Players.CharacterAutoLoads` default true — "If this property is disabled (false), player Characters will not spawn until Player:LoadCharacterAsync() is called for each Player, including when players join." `Players.RespawnTime` "defaults to 5.0 seconds" (Studio's own templates often set 3).
StarterPlayer is relevant for: CharacterWalkSpeed (16), CharacterJumpPower (50) / CharacterJumpHeight (7.2) / CharacterUseJumpPower, CharacterMaxSlopeAngle (89), CameraMin/MaxZoomDistance (0.5/128), EnableMouseLockOption, LoadCharacterAppearance, DevComputerMovementMode / DevTouchMovementMode (must be `Scriptable` for scripted player pathfinding), CreateDefaultPlayerModule, and AvatarJointUpgrade.
Script execution order on join (official): ReplicatedFirst contents load → ReplicatedFirst client scripts run → rest of game loads → DataModel.Loaded fires → PlayerScripts (from StarterPlayerScripts) + client Scripts in ReplicatedStorage run → Character spawns → StarterCharacterScripts copies run. Hence `WaitForChild` is mandatory in client code.

Citations:
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/classes/SpawnLocation.yaml
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/classes/Players.yaml
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/scripting/attributes.md
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/projects/data-model.md
- https://media.githubusercontent.com/media/Roblox/creator-docs/main/content/en-us/assets/solutions/DialogSystem.rbxlx

### Roblox Baseplate template — exact instances and property values  `[OFFICIAL]`

Official docs: "The Baseplate template includes only two default objects: Spawn location … and Baseplate – a floor with a 4x4 grid texture that aligns with stud measurements." (Baseplate template place 95206881, universe 28220420.)
Exact values extracted from Roblox's own `DialogSystem.rbxlx` in the creator-docs repo (a Studio-saved place built on the Baseplate template):

Workspace.Baseplate — class **Part**
  size = Vector3(2048, 16, 2048)   [serialized tag `<Vector3 name="size">`]
  CFrame = position (0, −8, 0), identity rotation  → top face sits exactly at Y = 0
  Anchored = true, Locked = true
  Color3uint8 = 4284177243 = 0xFF5B5B5B = **RGB(91, 91, 91)**
  Material = 256 (Plastic); formFactorRaw = 0 (Symmetric); shape = 1 (Block)
  All six surfaces = 0 (Smooth); CanCollide true; CastShadow true; Transparency 0; Reflectance 0
  Child **Texture** "Texture": Texture = `rbxassetid://6372755229`, Face = 1 (Top), StudsPerTileU = 8, StudsPerTileV = 8, Transparency = 0.800000012, Color3 = (0,0,0)

Workspace.SpawnLocation — class **SpawnLocation**
  size = Vector3(12, 1, 12); CFrame = position (0, 0.5, 0), identity
  Anchored = true; Neutral = true; Enabled = true; **Duration = 0** (class default is 10)
  AllowTeamChangeOnTouch = false; TeamColor = BrickColor 194 (Medium stone grey)
  Color3uint8 = 4288914085 = 0xFFA3A2A5 = RGB(163, 162, 165); Material 256; TopSurface/BottomSurface = 0
  Child **Decal** "Decal": Texture = `rbxasset://textures/SpawnLocation.png`, Face = 1 (Top)

Lighting (same file)
  Ambient (0.274509817)³ ; OutdoorAmbient (0.274509817)³ ; Brightness 3
  **Technology = 3 (ShadowMap)**, LightingStyle = 1, GlobalShadows true, PrioritizeLightingQuality true
  ShadowSoftness 0.200000003; EnvironmentDiffuseScale 1; EnvironmentSpecularScale 1; ExposureCompensation 0
  TimeOfDay "14:30:00"; GeographicLatitude 0; FogColor (0.752941251)³; FogStart 0; FogEnd 100000; Outlines false
  ColorShift_Top/Bottom (0,0,0)
Enum.Technology (current, from live API dump): Legacy 0, Voxel 1, Compatibility 2, ShadowMap 3, Future 4, **Unified 5**. Enum.LightingStyle: Realistic 0, Soft 1. Roblox is mid-migration to Unified — rbx-dom's Lighting defaults carry attributes `RBX_LightingTechnologyUnifiedMigration`, `RBX_OriginalTechnologyOnFileLoad`, `RBX_BackupBrightness`, `RBX_BackupExposureCompensation`, and the real Roblox file carries `RBX_LightingTechnologyUnifiedMigration=true` + `RBX_OriginalTechnologyOnFileLoad=3` in AttributesSerialize. Emit Technology = 3 (ShadowMap) to match what Studio's Baseplate produces today; do not emit the RBX_* attributes.
Workspace (same file): Gravity 196.199997, ExplicitAutoJoints true, FallenPartsDestroyHeight −500, AirDensity 0.0012, AvatarUnificationMode 0, CollisionGroupData `AQEABP////8HRGVmYXVsdA==` (base64 for the single "Default" group).

Citations:
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/resources/templates.md
- https://media.githubusercontent.com/media/Roblox/creator-docs/main/content/en-us/assets/solutions/DialogSystem.rbxlx
- https://setup.rbxcdn.com/version-14d8b191232f4ddd-API-Dump.json
- https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/rbx_dom_lua/src/database.json

### NPC anatomy: what a Humanoid actually requires  `[OFFICIAL]`

Verbatim from the official Humanoid class reference: "Humanoids are always parented inside of a Model, and the model is expected to be an assembly of BasePart and Motor6D; the root part of the assembly is expected to be named **HumanoidRootPart**. It also expects a part named **Head** to be connected to the character's torso part, either directly or indirectly."
R6 rules (verbatim): "A basic character rig that uses 6 parts for limbs. The Head part must be attached to a part named **Torso**, or the Humanoid will die immediately. BodyPart appearances are applied using CharacterMesh objects. Certain properties, such as Humanoid.LeftLeg and Humanoid.RightLeg, only work with R6."
R15 rules (verbatim): "Uses 15 parts for limbs. The Head part must be attached to a part named **UpperTorso** or the Humanoid will die immediately. BodyPart appearances have to be assembled directly. Can be dynamically rescaled by using special NumberValue objects parented inside of the Humanoid" named BodyDepthScale / BodyHeightScale / BodyWidthScale / HeadScale; "The Humanoid will automatically create Vector3Value objects named OriginalSize inside of each limb."
Enum.HumanoidRigType: R6 = 0 (the class default), R15 = 1.
Measured on an official R15 NPC ("Guard" in Roblox's StateMachineDemo.rbxl): HumanoidRootPart is a **Part**, Size (2, 2, 1), Transparency 1, CanCollide true, Anchored false, RootPriority 0; Model.PrimaryPart = HumanoidRootPart; Humanoid.HipHeight = 2, WalkSpeed 16, MaxSlopeAngle 89.
Humanoid:MoveTo(location, part?) — official: sets WalkToPoint/WalkToPart. "the movement operation will time out after **8 seconds** if the humanoid doesn't reach its goal … If you don't want this to happen, call MoveTo() at a repeated interval so that the timeout keeps resetting." It ends when the character arrives ("assuming a ~1 stud threshold"), when the timer expires, or when WalkToPoint/WalkToPart change. MoveToFinished(reached: boolean) fires on completion.

Citations:
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/classes/Humanoid.yaml
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/characters/index.md
- https://media.githubusercontent.com/media/Roblox/creator-docs/main/content/en-us/assets/solutions/StateMachineDemo.rbxl

### BREAKING CHANGE since training data: Motor6D superseded by AnimationConstraint for avatar rigs  `[OFFICIAL]`

This is post-cutoff and invalidates most Motor6D-based NPC recipes an LLM will generate from memory.
Motor6D class summary, verbatim: "Creates an animatable joint between two BaseParts. **Superseded by AnimationConstraint for avatar/character rigs. Motor6D is no longer used by default for player characters when StarterPlayer.AvatarJointUpgrade is enabled.**" … "As of the Avatar Joint Upgrade, R15 player characters spawn with AnimationConstraints instead of Motor6Ds when AvatarJointUpgrade is enabled (**the default for new experiences**). Code that assumes character joints are Motor6Ds — such as character:FindFirstChildOfClass("Motor6D") or joint:IsA("Motor6D") — will not find joints on upgraded characters." … "Motor6D remains appropriate for non-avatar mechanical rigs (doors, turrets, vehicles) where physical simulation is not needed."
AnimationConstraint summary: "Aligns two BaseParts with an animate-able kinematic or force-based joint that supports physical simulation (ragdoll, arm strength). **The default joint type for R15 avatar rigs.**" Migration notes: use `:FindFirstChildWhichIsA("AnimationConstraint")`; C0/C1/Part0/Part1 exist only as **read-only** aliases mapping to Attachment0.CFrame / Attachment1.CFrame / Attachment0.Parent / Attachment1.Parent — do not write them; do not modify RigAttachment.CFrame directly; `Transform` works identically to Motor6D.Transform (multiply into it during RunService.PreSimulation); `IsKinematic` default true = Motor6D-equivalent, false = force-based simulation; `animConstraint:IsA("Motor6D")` returns **false**.
Empirical confirmation: the official R15 NPC "Guard" contains **15 AnimationConstraint + 14 BallSocketConstraint + 19 NoCollisionConstraint + 0 Motor6D**. The R15 rigs in DialogSystem.rbxlx are the same. Serialized property: `StarterPlayer.AvatarJointUpgrade` → `<token name="AvatarJointUpgrade_SerializedRollout">1</token>` (type Enum.RolloutState).
Roblox reference threads cited by the docs: devforum 4298561 (AJU live) and 4656414 (AJU Phase 2 migration).
Related new surfaces to be aware of: Workspace.AvatarUnificationMode (Default 0 / Disabled 1 / Enabled 2) + Workspace:SetAvatarUnificationMode(), Workspace.EnableSLIMAvatars (RolloutState), Workspace.SlimHash.

Citations:
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/classes/Motor6D.yaml
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/classes/AnimationConstraint.yaml
- https://media.githubusercontent.com/media/Roblox/creator-docs/main/content/en-us/assets/solutions/StateMachineDemo.rbxl
- https://setup.rbxcdn.com/version-14d8b191232f4ddd-API-Dump.json

### R6 rig from documented numbers, the Animate script, and the honest v1 NPC  `[UNCLEAR]`

**No official source publishes R6 Motor6D C0/C1 values or R6 part sizes.** I searched create.roblox.com docs (via the creator-docs source repo), rbx-dom (which ships zero .rbxlx/.rbxmx test fixtures in its tree), and every Roblox-published model/place asset in creator-docs. The two official character assets I could open are both **R15 MeshPart** rigs (TemplateNPC.rbxm, StateMachineDemo Guard) that depend on uploaded mesh assets and therefore cannot be reconstructed from primitives. The widely-circulated R6 numbers (Torso 2×2×1, arms/legs 1×2×1, Head 2×1×1 with SpecialMesh Scale 1.25, `Right Shoulder` C0 = CFrame.new(1,0.5,0,0,0,1,0,1,0,−1,0,0), etc.) are **community folklore that I could not verify against a primary source** — do not ship them as fact.
What IS documented: the official avatar rig hierarchy (avatar/character-bodies/specifications.md §Rigging): Root → HumanoidRootNode → LowerTorso → UpperTorso → {Head, LeftUpperArm→LeftLowerArm→LeftHand, RightUpperArm→RightLowerArm→RightHand}, LowerTorso → {LeftUpperLeg→LeftLowerLeg→LeftFoot, RightUpperLeg→RightLowerLeg→RightFoot}. And JointInstance semantics: C0 attaches the offset point to Part0; C1 "is subtracted from the C0 property to create an offset point for Part1"; when C0/C1 change, the assembly root part stays put. So for any rig you author yourself, C0/C1 are derivable arithmetic, not lore: pick joint world CFrame J, set C0 = Part0.CFrame:Inverse() * J and C1 = Part1.CFrame:Inverse() * J.
Default Animate script: obtainable legitimately — Roblox ships it inside every character, and it is embedded verbatim in Roblox's own published template places. I extracted `humanoidAnimateR15Moods.lua` (26,090 bytes, a **Script** with RunContext=Legacy, parented directly under the character Model) from the official StateMachineDemo.rbxl. Its default R15 animation asset IDs: idle 507766666 / 507766951 / 507766388 (weights 1/1/9), walk 507777826, run 507767714, swim 507784897, swimidle 507785072, jump 507765000, fall 507767968, climb 507765644, sit 2506281703, toolnone 507768375. Other legitimate routes: Studio's Rig Generator (Avatar ▸ Character) "inserts character Models with the appropriate joints and humanoid structure"; or `Players:CreateHumanoidModelFromDescriptionAsync(desc, rigType)` at runtime.
**Recommended v1 "add an NPC" (honest, buildable, no rig lore):**
1. Serialize a *blocky* NPC into the place: Model{ Part "HumanoidRootPart" (2,2,1, Transparency 1, CanCollide true) ; Part "Torso" (2,2,1) ; Part "Head" (2,1,1) ; Part "Left Leg"/"Right Leg" (1,2,1) ; Motor6D joints with C0/C1 you compute from your own part placements ; Humanoid{ RigType=0 (R6), HipHeight, Health_XML } } and set Model.PrimaryPart → HumanoidRootPart. Naming Torso+Head+HumanoidRootPart satisfies the two documented hard rules. Motor6D is still correct here because this is not an avatar rig — AJU only affects R15 avatar characters.
2. Attach a server Script that does PathfindingService:CreatePath{AgentCanClimb=true, Costs={…}} → Path:ComputeAsync(start, goal) → Path:GetWaypoints() → per-waypoint humanoid:MoveTo(wp.Position) with `if wp.Action == Enum.PathWaypointAction.Jump then humanoid.Jump = true end`, re-issuing MoveTo inside a loop to beat the 8-second timeout, and reconnecting on Path.Blocked.
Honest limitations to surface in the product: (a) it will T-pose-slide unless you also load animations — a blocky R6 rig cannot use the R15 Animate script or the R15 animation IDs above; (b) an avatar-quality NPC requires uploaded mesh assets you cannot generate; (c) if you later want a real avatar NPC, generate it at **runtime** from a Script via `Players:CreateHumanoidModelFromDescriptionAsync` rather than serializing a rig — note `CreateHumanoidModelFromDescription` and `CreateHumanoidModelFromUserId` are now **Deprecated** in favor of the `...Async` names.

Citations:
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/avatar/character-bodies/specifications.md
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/classes/JointInstance.yaml
- https://media.githubusercontent.com/media/Roblox/creator-docs/main/content/en-us/assets/solutions/StateMachineDemo.rbxl
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/studio/rig-builder.md
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/characters/pathfinding.md
- https://setup.rbxcdn.com/version-14d8b191232f4ddd-API-Dump.json

### Luau style card for the AI system prompt  `[OFFICIAL]`

SCRIPT CONTAINERS & RUN CONTEXT (official, verbatim where quoted)
• Three types: Script ("runs on either the server or the client, depending on its location and Script.RunContext"), LocalScript ("runs only on the client. Does not have a run context"), ModuleScript ("code you can reuse"; no run context).
• Enum.RunContext: Legacy 0 (default), Server 1, Client 2, Plugin 3.
• "When you create a Script, its default run context is Legacy, meaning that it a) is a server-side script and b) only runs if it is in a server container, such as Workspace or ServerScriptService."
• RunContext=Server also permits ReplicatedStorage "but that's not recommended. The contents of that location are replicated to clients."
• RunContext=Client can run in ReplicatedStorage, StarterCharacterScripts and StarterPlayerScripts — but "Starter containers are copied to clients, so the original script **and** the copy run, which isn't desirable."
• OFFICIAL RECOMMENDATIONS: client Scripts in ReplicatedStorage with RunContext=Client; server Scripts in ServerScriptService with RunContext=Server; shared code as ModuleScripts in ReplicatedStorage; ServerStorage for server-only ModuleScripts; minimal loading script in ReplicatedFirst with RunContext=Client; use **LocalScripts** in StarterCharacterScripts / StarterPlayerScripts / StarterGui / StarterPack; always set RunContext explicitly on scripts inside models/packages.
• Rule for our generator: emit `Script` + RunContext token 1 or 2 everywhere except the four Starter* containers, where emit `LocalScript`.

SERVICE ACCESS: always `local X = game:GetService("X")` at the top; never `game.Workspace` / `workspace.Foo` chains in client code. `game.Workspace` alias is fine but GetService is the idiom.

SCHEDULING — task.* only (official table): wait()→task.wait(); wait(n)→task.wait(n); spawn(f)→task.defer(f) (or task.delay(0,f)); delay(n,f)→task.delay(n,f). "Certain legacy global methods, such as spawn(), delay(), and wait() … are less optimized and configurable than their task alternatives." task.spawn resumes immediately; task.defer resumes at the end of the current resume point; task.wait() with no arg ≡ RunService.Heartbeat. Use task.cancel(thread) to stop.

EVENTS: `local c = obj.Event:Connect(fn)` … `c:Disconnect()`; `:Once()` for one-shot; `:Wait()` yields. Replication order is NOT guaranteed — "use the available methods and events to detect changes rather than assuming a change has replicated." Client code MUST use `:WaitForChild(name)` for anything outside ReplicatedFirst. This matters even more with StreamingEnabled.

ATTRIBUTES & TAGS as AI-managed metadata (perfect fit for our tool layer):
  inst:SetAttribute("Speed", 12) / inst:GetAttribute("Speed") / inst:GetAttributes() / inst:GetAttributeChangedSignal("Speed")
  inst:AddTag("Coin") / :RemoveTag / :HasTag / :GetTags ; CollectionService:GetTagged("Coin"), :GetInstanceAddedSignal("Coin")
  Both serialize into the place file (AttributesSerialize / Tags BinaryStrings), so the AI can round-trip its own semantic annotations.

BEGINNER PATTERNS THE USERS WILL ASK FOR:
  Touched: `part.Touched:Connect(function(hit) local h = hit.Parent:FindFirstChildWhichIsA("Humanoid"); if h then … end end)` + a debounce flag (see scripting/debounce).
  leaderstats: server Script in ServerScriptService on Players.PlayerAdded → `local f = Instance.new("Folder"); f.Name = "leaderstats"; f.Parent = player` then IntValue/StringValue children. Official warning: "It's essential that the folder is named `leaderstats` with all lowercase letters. Roblox doesn't add the player to the leaderboard if you name it any other way."
  ProximityPrompt: parent to a Part/Attachment, set ActionText/ObjectText/HoldDuration/MaxActivationDistance/KeyboardKeyCode, handle `.Triggered:Connect(function(player) … end)` on the server.
  RemoteEvent: instance lives in ReplicatedStorage. Client `re:FireServer(args)` → server `re.OnServerEvent:Connect(function(player, args) … end)` (player is prepended automatically). Server `re:FireClient(player, …)` / `:FireAllClients(…)` → client `re.OnClientEvent`. RemoteFunction = InvokeServer/OnServerInvoke. **Never trust client arguments**; validate everything server-side.
  TweenService: `TweenService:Create(inst, TweenInfo.new(1, Enum.EasingStyle.Quad, Enum.EasingDirection.Out, 0, false, 0), {Position = …}):Play()`. EasingStyle values: Linear 0, Sine 1, Back 2, Quad 3, Quart 4, Quint 5, Bounce 6, Elastic 7, Exponential 8, Circular 9, Cubic 10.

TOP-10 DEPRECATIONS / FOOTGUNS (all confirmed `Deprecated` in the live 0.731 API dump):
  1. wait/spawn/delay → task.wait/task.defer/task.delay.
  2. Instance:Remove(), :clone(), :destroy(), :findFirstChild(), :getChildren(), :children → Destroy/Clone/FindFirstChild/GetChildren.
  3. BasePart.Velocity / RotVelocity → AssemblyLinearVelocity / AssemblyAngularVelocity.
  4. Body* movers (BodyPosition, BodyVelocity, BodyGyro, BodyForce, BodyThrust, BodyAngularVelocity, RocketPropulsion) are **deprecated classes** → AlignPosition, LinearVelocity, AlignOrientation, VectorForce, AngularVelocity.
  5. Humanoid:LoadAnimation → Animator:LoadAnimation (get/create an Animator under the Humanoid). Also deprecated: Humanoid.Torso / LeftLeg / RightLeg, Humanoid:TakeDamage, Humanoid.MaxHealth alias `maxHealth`.
  6. Model:SetPrimaryPartCFrame / GetPrimaryPartCFrame / MoveTo(legacy) → Model:PivotTo(cf) / :GetPivot().
  7. BasePart:MakeJoints/BreakJoints, Workspace:MakeJoints/BreakJoints → WeldConstraint.
  8. Player:LoadCharacter → LoadCharacterAsync; Players:CreateHumanoidModelFromDescription/FromUserId, GetHumanoidDescriptionFromUserId/OutfitId → the ...Async variants.
  9. Chat:FilterStringForPlayerAsync → TextService:FilterStringAsync + TextFilterResult; legacy `Chat` service and Message/Hint classes are deprecated → TextChatService.
  10. Sound.Pitch/MinDistance/MaxDistance/EmitterSize/:play()/:stop() → PlaybackSpeed / RollOffMinDistance / RollOffMaxDistance / :Play() / :Stop(). Also: Lighting.Outlines is deprecated; Workspace.FilteringEnabled is deprecated (FE is always on); GuiMain/Hopper/HopperBin/Hat/Flag/Glue/Snap/Skin/Status/JointsService/PointsService are deprecated classes.
BONUS footguns: `IsA("Motor6D")` on modern R15 characters is false (see AJU finding); default `Part.TopSurface` is Studs — set Smooth; `wait()` inside `Touched` without debounce fires dozens of times per contact.

Citations:
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/scripting/locations.md
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/scripting/scheduler.md
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/scripting/attributes.md
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/players/leaderboards.md
- https://setup.rbxcdn.com/version-14d8b191232f4ddd-API-Dump.json
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/libraries/task.yaml

### Property/class authority: API dump retrieval flow + rbx-dom database  `[OFFICIAL]`

All endpoints tested live on 2026-07-27; all returned HTTP 200.

STEP 1 — resolve the current build:
  GET https://clientsettings.roblox.com/v2/client-version/WindowsStudio64
  → {"version":"0.731.0.7310942","clientVersionUpload":"version-14d8b191232f4ddd","bootstrapperVersion":""}
  Other channels: /WindowsPlayer → 0.731.23.7310943 ; /MacStudio → 0.731.0.7310942 with a DIFFERENT upload hash `version-42c9cfa0f67b407b`. Use **WindowsStudio64** — it is the build Studio-compatible files must match.
STEP 2 — fetch the dump using `clientVersionUpload` as the CDN prefix:
  GET https://setup.rbxcdn.com/{clientVersionUpload}-API-Dump.json        → 7,087,037 bytes
  GET https://setup.rbxcdn.com/{clientVersionUpload}-Full-API-Dump.json   → 8,019,826 bytes (includes internal/non-scriptable members)
  Mirror host, byte-identical: https://s3.amazonaws.com/setup.roblox.com/{clientVersionUpload}-API-Dump.json
  No auth, no headers required.
STEP 3 (fallback / diffing) — maintained mirror:
  https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json → 7,086,705 bytes (tracks within a build or two).

Dump shape: `{Version, Classes:[{Name, Superclass, MemoryCategory, Tags?, Members:[…]}], Enums:[{Name, Items:[{Name, Value}]}]}`. 897 classes in 0.731. A Member looks like: `{MemberType:"Property", Name:"Shape", ValueType:{Category:"Enum", Name:"PartType"}, Category:"Part", Security:{Read,Write}, Serialization:{CanLoad, CanSave}, ThreadSafety, Capabilities, Tags:["NotReplicated"]}`. Tags to filter on: Deprecated, ReadOnly, NotScriptable, NotReplicated, Hidden, NotCreatable, Service, Settings, Yields.
**What the dump does NOT give you:** default property values, and the API-name → serialized-name mapping. Both live only in rbx-dom's reflection database.

rbx-dom database:
  JSON (directly loadable in Node, 2.35 MB): https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/rbx_dom_lua/src/database.json — `{Version:[0,728,0,7280895], Classes:{Name→{Name, Superclass, Tags, Properties:{…}, DefaultProperties:{…}}}, Enums:{Name→{name, items:{Name→Value}}}}`, 892 classes. Property entries carry `{Name, Scriptability, DataType:{Value|Enum}, Tags, Kind:{Canonical:{Serialization: "Serializes"|"DoesNotSerialize"|{SerializesAs:"…"}|{Migrate:{To,Migration}}} | Alias:{…}}}`. DefaultProperties are keyed by **serialized** name and typed (`{"Vector3":[4,1.2,2]}`, `{"Enum":256}`, `{"Color3uint8":[163,162,165]}`).
  Canonical binary: rbx_reflection_database/database.msgpack (Rust crate; `RBX_DATABASE` env var overrides the location).
  Currently pinned at Roblox 0.728.0.7280895 — three releases behind live. Plan for that lag.

RECOMMENDED VALIDATION PIPELINE for AI edits (cheapest → strongest, run in this order):
  1. Schema gate in TypeScript against the **live** API dump, refreshed nightly via steps 1–2 and cached: class exists && not Tags∋NotCreatable/Service (for `Instance.new`-style creation); property exists on the class or an ancestor; ValueType matches; reject Tags∋{ReadOnly, Deprecated, NotScriptable}; reject Security.Write ≠ "None"; reject Serialization.CanSave = false for anything you intend to persist. Give the model the enum item names→values so it emits `token` correctly.
  2. Name mapping + defaults from the rbx-dom JSON DB: resolve SerializesAs/Migrate before writing the tag name; drop any property whose value equals the class default (keeps files small and diffs clean).
  3. Structural lint (your own rules): exactly one SpawnLocation-bearing Workspace; Script in a server container; LocalScript only in Starter*; Model with a Humanoid has HumanoidRootPart + Head (+Torso if RigType=R6); no unanchored floating geometry; RunContext explicitly set.
  4. Build gate: run the actual builder (Rojo/Lune) — both hard-fail on unknown classes and type mismatches, which is a real second opinion. Measured cost ~11–18 ms, so run it on every AI turn.
  5. Round-trip gate: re-parse the emitted file with Lune `deserializePlace` and diff the instance tree against your intended project model. This is the check that catches CDATA corruption, bad referents, and dropped properties.
When the model wants a property newer than your rbx-dom copy: allow it only through Rojo's explicit typed form (`{"Bool": true}`), which I verified bypasses the reflection DB.

Citations:
- https://clientsettings.roblox.com/v2/client-version/WindowsStudio64
- https://setup.rbxcdn.com/version-14d8b191232f4ddd-API-Dump.json
- https://setup.rbxcdn.com/version-14d8b191232f4ddd-Full-API-Dump.json
- https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json
- https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/rbx_dom_lua/src/database.json
- https://rojo.space/docs/v7/project-format/

### Adjacent capability worth flagging: Roblox Studio ships a built-in MCP server  `[OFFICIAL]`

Not in my mission scope but directly relevant to the live-preview/verification loop and it is new enough that it will not be in the model's memory. "The Roblox Studio MCP server is **built into Roblox Studio**." It runs as a local process, communicates over **stdio** transport, and all actions are initiated by the AI client against the user's open Studio session. Tools include `script_read` (dot-notation paths like `game.ServerScriptService.MyScript`, whole file or line ranges), `multi_edit` (batched edits; creates the script if the path is missing; requires a `datamodel_type` of Edit), `script_search` (fuzzy, ≤10 results), plus data-model exploration, model insertion, Luau execution and play-mode control. Requires the latest Studio. This is a legitimate second channel for "apply the AI's edit and see it live" that does not require our backend to own the file format — worth evaluating against the .rbxlx-generation path for the preview pane.

Citations:
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/studio/mcp.md

### Recommendations

PRIMARY BUILD STRATEGY: Rojo CLI (strategy b), with Lune as the parse/verify sidecar.

Rationale, weighted against your four criteria:
- Fidelity: Rojo and Lune share the same rbx-dom core, so correctness is a tie — except Rojo alone has an escape hatch (explicit `{"Bool": true}`) for properties newer than the bundled reflection DB. I verified this: the implicit form hard-errors, the explicit form builds and emits correctly. Given Roblox ships every ~2 weeks and your users will ask for new features, that escape hatch is decisive.
- Server deployability: single static binary, ~5.9 MB zipped, official prebuilds for linux-x86_64, linux-aarch64, macos-aarch64. `COPY` it into your image; no Rokit needed in prod.
- Speed: measured ~11 ms per build. Irrelevant to your latency budget; you can rebuild on every AI turn.
- Import: Rojo cannot parse. Lune can — `deserializePlace` handles both .rbxl and .rbxlx, so pair the two.
- Bonus: the Rojo project *is* your project model. `default.project.json` + `src/**/*.luau` maps 1:1 onto the left-sidebar "threads + project files" UI, it is git-diffable, and Rojo's live-sync mode gives you a free path to real-time Studio preview later.

CONCRETE ARCHITECTURE
1. Project model on disk = a Rojo project. Directory per user project: `default.project.json` (world/instances, AI-edited as JSON), `src/server/*.server.luau`, `src/client/*.client.luau`, `src/shared/*.luau`, `src/**/*.model.json` for non-script instance trees. Set `"emitLegacyScripts": false` so scripts emit as `Script` + RunContext instead of legacy Script/LocalScript.
2. AI tool surface — do not let the model write XML or free-form JSON. Give it typed tools: `create_instance(parent, className, name, properties)`, `set_properties(path, props)`, `delete_instance(path)`, `write_script(path, runContext, source)`, `set_attribute`, `add_tag`. Each tool validates against the live API dump before touching disk (see the validation pipeline in the authority finding). Emit properties in Rojo's **explicit** typed form always — it is unambiguous, survives DB lag, and is easy to generate mechanically.
3. Build pipeline per turn: validate → write files → `rojo build --output place.rbxlx` → `lune run verify.luau` (deserializePlace + structural assertions + diff against the intended tree) → publish artifact. Total ~30 ms.
4. Bake the default project from the verified Baseplate values in this report (Part 2048×16×2048 at Y=−8, RGB(91,91,91), Texture rbxassetid://6372755229 at StudsPerTileU/V=8 Transparency 0.8; SpawnLocation 12×1×12 at Y=0.5 Duration=0 with the SpawnLocation.png Decal; Lighting Technology=3, Brightness=3, TimeOfDay 14:30:00). Users will A/B this against Studio's File▸New and it must match.
5. Reflection cache: a nightly job hits clientsettings → setup.rbxcdn → stores API-Dump.json + the rbx-dom database.json in blob storage; ship both to the validator and inject the enum tables into the codegen system prompt.
6. Import path (later): user uploads .rbxl/.rbxlx → Lune deserializePlace → walk the DataModel → emit a Rojo project + src tree. This is the reason Lune is in the stack; design the project model now so this projection is lossless enough.

DO NOT build the hand-rolled TypeScript serializer as the primary. Keep the knowledge in this report as a documented fallback and use it to write the *validator*, not the emitter — you need to understand SerializesAs, CDATA splitting, and Color3uint8 packing to lint Rojo's output, but you should not be the one producing bytes.

DO NOT depend on npm. No credible rbx-dom port exists (best candidate: rbxm-parser, 1.4k downloads/month, .rbxm only). If you later need in-process JS with zero subprocess, the right move is compiling rbx_xml + rbx_binary + rbx_reflection_database to WASM yourself.

FOR THE SYSTEM PROMPT, non-negotiable: RunContext rules and the Starter*-container LocalScript exception; task.* over wait/spawn/delay; WaitForChild in all client code; leaderstats must be lowercase; AnimationConstraint has replaced Motor6D on avatars; the top-10 deprecation list. Feed enum names→values from the cached dump rather than letting the model recall token numbers.

### Limitations (surface honestly in-product)

HARD LIMITS
1. No official R6 rig spec exists. Roblox does not publish R6 part sizes or Motor6D C0/C1 anywhere I could find, and every Roblox-published character asset I opened is an R15 MeshPart rig requiring uploaded mesh assets. The commonly-cited R6 numbers are unverified folklore. Do not ship a "real Roblox R6 character" claim. Author your own blocky rig and compute C0/C1 arithmetically (C0 = Part0.CFrame:Inverse()*J, C1 = Part1.CFrame:Inverse()*J).
2. Motor6D is no longer the avatar joint. R15 player characters spawn with AnimationConstraint when StarterPlayer.AvatarJointUpgrade is enabled — the default for new experiences. Any AI-generated code doing FindFirstChildOfClass("Motor6D") or IsA("Motor6D") on a character silently finds nothing. This must be in the system prompt or a large fraction of generated NPC/animation code will be broken.
3. Avatar-quality NPCs are not generatable. They need uploaded MeshPart/SurfaceAppearance/WrapTarget assets. Runtime CreateHumanoidModelFromDescriptionAsync is the only no-asset route, and it needs a live server, so it cannot be previewed from a static file.
4. Reflection-DB lag is structural. rbx-dom (and therefore Lune, and Rojo's implicit property path) is pinned at Roblox 0.728.0.7280895 while live Studio is 0.731.0.7310942. Anything Roblox shipped in the last ~3 releases is invisible to it. Only Rojo's explicit typed property syntax escapes this; Lune has no escape hatch at all.
5. I could not test in Roblox Studio. Every "opens in Studio" claim rests on (a) conformance to the rbx-dom spec, (b) byte-level comparison against a genuine Roblox-authored .rbxlx, and (c) the fact that Rojo's output is what thousands of studios ship daily. You must run one real Studio open-and-play smoke test before launch, and put it in CI via a Studio-in-a-VM or the Studio MCP server.
6. Place-file import from Roblox is gated. https://assetdelivery.roblox.com/v1/asset/?id=<placeId> returns 401 without auth. Lune's getAuthCookie reads a local desktop cookie and is useless server-side. "Import my existing game" therefore requires the user to upload a file, or Open Cloud — not this path.
7. Silent-corruption traps in a hand-rolled emitter, in order of likelihood: a literal `]]>` in Luau source breaking CDATA; writing `Size`/`Shape`/`FormFactor`/`Color`/`MaterialVariant`/`Attributes` instead of `size`/`shape`/`formFactorRaw`/`Color3uint8`/`MaterialVariantSerialized`/`AttributesSerialize`; writing `Health` instead of `Health_XML`; omitting the six Surface tokens so every part gets stud bumps; forgetting the 0xFF high byte on Color3uint8; duplicate or `null` referents.
8. Lune cannot read some Content-typed properties — decal.Texture threw "missing default value" on a file it had just written. Writing and round-tripping are fine; do not build a reader on it without testing each property type you care about.
9. Roblox is mid-migration on lighting (Technology Unified = 5) and avatars (AvatarUnificationMode, EnableSLIMAvatars, SLIM rigs). Defaults here will move. Pin Technology = 3 (ShadowMap) to match today's Baseplate template and re-verify quarterly.

### User setup steps

END-USER (nontechnical, in-product): zero setup for building. The two exit paths are (1) we publish to their Roblox experience through officially supported means — out of my scope, covered by the publishing research — or (2) the Studio fallback: click Download, get `MyGame.rbxlx`, then in Roblox Studio choose File ▸ Open from File and select it, or just double-click the file. Nothing is installed, no plugin, no CLI. Present the .rbxlx as "your game file — open it in Roblox Studio" and never surface the format name.

If we later add live sync (Rojo serve), the user WOULD need to install the Rojo Studio plugin — treat that as a power-user opt-in, not the default flow, because it breaks the zero-setup promise.

BACKEND / DEPLOY (engineering, one-time):
1. Local dev on macOS arm64 — install Rokit, then pin the toolchain:
   curl -fsSL https://raw.githubusercontent.com/rojo-rbx/rokit/main/scripts/install.sh | bash
   rokit add rojo-rbx/rojo && rokit add lune-org/lune && rokit install
   (writes rokit.toml so every dev and CI gets identical versions)
2. Production container (Linux, no Rokit) — pin exact versions in the Dockerfile:
   ADD https://github.com/rojo-rbx/rojo/releases/download/v7.7.0/rojo-7.7.0-linux-x86_64.zip /tmp/rojo.zip
   ADD https://github.com/lune-org/lune/releases/download/v0.10.5/lune-0.10.5-linux-x86_64.zip /tmp/lune.zip
   RUN unzip -j /tmp/rojo.zip -d /usr/local/bin && unzip -j /tmp/lune.zip -d /usr/local/bin && chmod +x /usr/local/bin/rojo /usr/local/bin/lune
   (swap x86_64 → aarch64 for Graviton/arm64 runners; both architectures are published)
   Verify: `rojo --version` → "Rojo 7.7.0", `lune --version` → "lune 0.10.5". Note these are binaries, so a pure-serverless runtime without subprocess support (edge functions) will not work — use a container or a normal Node Lambda with the binary in the layer.
3. Nightly reflection refresh (cron):
   HASH=$(curl -s https://clientsettings.roblox.com/v2/client-version/WindowsStudio64 | jq -r .clientVersionUpload)
   curl -sLo api-dump.json  "https://setup.rbxcdn.com/$HASH-API-Dump.json"
   curl -sLo rbx-database.json https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/rbx_dom_lua/src/database.json
   Store both in blob storage keyed by the Roblox version; alert if the rbx-dom Version field falls more than ~5 releases behind the live one.
4. Pre-launch smoke test (manual, once, then quarterly): take the generated place.rbxlx, open it in the current Roblox Studio, press Play, confirm the character spawns on the SpawnLocation and the ServerScriptService script prints. This is the one thing I could not automate here and the only real proof of Studio compatibility.

## Part 3 — Web preview rendering (three.js)

### Summary

Researched the exact Roblox math/format needed for a faithful three.js preview of a real .rbxlx place. Highest-value finding: CFrame's row-major R00..R22 layout maps 1:1 onto three.js Matrix4.set()'s row-major-input/column-major-storage constructor with zero transpose or axis flip, because both engines are right-handed, Y-up, with forward = -Z — 1 stud = 1 three.js unit is correct. Verified official enum values (PartType, Material), confirmed via Roblox's own devforum announcement that Ball diameter = min(Size.X,Y,Z), and cross-validated WedgePart/CornerWedgePart exact vertex geometry against an independent open-source geometry library. Cylinder axis-along-X and CornerWedge face-assignment are COMMUNITY-STANDARD (high confidence, multiple converging sources) not OFFICIAL-documented. Two real gaps: (1) Roblox has never published the ClockTime/GeographicLatitude→sun-direction formula — must ship an approximation and disclose it; (2) two official-adjacent sources disagree on Lighting.Ambient's default (black vs. 0.5 grey) — needs a live Studio check before hardcoding. MeshPart/texture fetch now requires Open Cloud auth (since Apr 2025) and returns a proprietary, only-community-documented FileMesh binary — real v2 work, not a quick win. No mature open-source three.js rbxlx viewer exists to fork; rbx-dom is the strongest format-spec reference to build against.

### CFrame → three.js Matrix4 (coordinate math)  `[OFFICIAL]`

Roblox is right-handed, Y-up; Front/LookVector = -Z (confirmed: 'LookVector: forward-direction... equivalent to the negated ZVector or the negated third column of the rotation matrix'). CFrame.new(x,y,z,R00,R01,R02,R10,R11,R12,R20,R21,R22) docs literally state the orientation matrix as '[[R00 R01 R02] [R10 R11 R12] [R20 R21 R22]]' — i.e. Rij with i=row, j=col (row-major). RightVector/XVector = column 0 = (R00,R10,R20). UpVector/YVector = column 1 = (R01,R11,R21). ZVector = column 2 = (R02,R12,R22); LookVector = -ZVector.

.rbxlx XML encoding (rbx-dom xml.md, unofficial but production-grade spec used by Rojo): element <CoordinateFrame> with children in this exact order: X, Y, Z, R00, R01, R02, R10, R11, R12, R20, R21, R22, each a <float>-typed child, row-major. Example:
<CoordinateFrame name="...">
 <X>10</X><Y>20</Y><Z>30</Z>
 <R00>1</R00><R01>0</R01><R02>0</R02>
 <R10>0</R10><R11>1</R11><R12>0</R12>
 <R20>0</R20><R21>0</R21><R22>1</R22>
</CoordinateFrame>

three.js Matrix4.set(n11,n12,...,n44) takes arguments in row-major reading order but stores them column-major internally (three.js docs). Because Roblox's Rij is already row-major and both engines share the same handedness/up-axis/forward convention, the conversion is a **direct field copy with no transpose and no axis negation**:
```js
const m = new THREE.Matrix4().set(
  R00, R01, R02, X,
  R10, R11, R12, Y,
  R20, R21, R22, Z,
  0,   0,   0,   1
);
object3D.matrix.copy(m);
object3D.matrixAutoUpdate = false; // or decompose into position/quaternion/scale if the pipeline needs TRS
```
Studs↔world-units: 1 stud = 1 three.js unit is the correct mapping (both are unitless; Part size range is documented 0.001–2048 studs/axis, an ordinary scene-scale for three.js's default camera/shadow-frustum defaults).

Citations:
- https://create.roblox.com/docs/reference/engine/datatypes/CFrame
- https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/docs/xml.md
- https://github.com/rojo-rbx/rbx-dom/blob/master/docs/xml.md
- https://threejs.org/docs/#api/en/math/Matrix4.set

### Part.Shape enum (Enum.PartType) and Size semantics  `[OFFICIAL]`

Enum.PartType values (create.roblox.com/docs/reference/engine/enums/PartType): Ball=0, Block=1, Cylinder=2, Wedge=3, CornerWedge=4. Part.Shape docs state descriptions verbatim: Ball 'A spherical shape.'; Block 'A block shape.'; Cylinder 'A cylinder shape.'; Wedge 'A wedge shape with a slope on one side.'; CornerWedge 'A wedge shape with slopes on two sides.' Collision note (verbatim): 'Collisions between balls, blocks, and wedges, and corner wedges are exact, whereas collisions between terrain, cylinders, TriangleMeshes, and other geometry types are approximations.'

Size is FULL extents along local X/Y/Z (width/height/depth as absolute stud dimensions), not half-extents — confirmed by devforum consensus around BasePart.Size and by how resizing behaves (expands from center in both directions equally, i.e. Size itself is the full span). Per-axis practical bounds surfaced in secondary sources (BasePart.Size doc synthesis): min 0.001, values below 0.05 studs render as if 0.05, max 2048 — this numeric detail was NOT independently re-verified against the live docs page in this pass (the direct WebFetch of BasePart returned a thin excerpt without it) and should be spot-checked before hardcoding clamps.

Citations:
- https://create.roblox.com/docs/reference/engine/enums/PartType
- https://create.roblox.com/docs/reference/engine/classes/Part
- https://create.roblox.com/docs/reference/engine/classes/BasePart#Size

### Ball shape: diameter derivation from non-uniform Size  `[OFFICIAL]`

Roblox staff announcement (devforum 'Improvements to Part Shape & Size'): previously Size was locked X=Y=Z when Shape=Ball; that lock was lifted. Verbatim: 'the real diameter is the minimum of all three sides.' A Ball with Size (4,6,2) renders and collides as a true sphere of diameter 2 (NOT an ellipsoid stretched to the bounding box). three.js: `radius = Math.min(size.x, size.y, size.z) / 2` fed into SphereGeometry, centered at the part's CFrame origin.

Citations:
- https://devforum.roblox.com/t/improvements-to-part-shape-size/2443389

### Cylinder shape: axis orientation (notorious gotcha)  `[COMMUNITY-STANDARD]`

Could NOT find an explicit create.roblox.com/docs sentence stating the axis explicitly in this research pass — this is the one gotcha official docs stayed silent on. High-confidence community/behavioral evidence instead: Studio's freshly-inserted Cylinder part appears 'lying on its side' by default and a standing devforum feature-request exists specifically titled 'Change default orientation of inserted cylinders to be vertical' (#592447) — this default-sideways behavior is only consistent with the round axis running along local X (a horizontal axis), since an axis aligned to Y (up) would already stand vertical with zero rotation. Practical convention: Size.X = length along the axis, Size.Y and Size.Z = the circular cross-section diameter in the local Y–Z plane (keep equal for a true circle). three.js CylinderGeometry defaults to a Y-aligned axis, so bake a fixed `geometry.rotateZ(Math.PI/2)` (swaps X↔Y) into the reusable cylinder geometry before applying the CFrame matrix, OR construct radiusTop/radiusBottom from min(Size.Y,Size.Z)/2 and height from Size.X directly with a custom axis. RECOMMENDATION: do one manual Studio confirmation (insert Cylinder, screenshot, read Size/Orientation) before shipping — this is the single load-bearing claim in this report resting on inference rather than a quoted doc sentence.

Citations:
- https://devforum.roblox.com/t/change-default-orientation-of-inserted-cylinders-to-be-vertical/592447
- https://create.roblox.com/docs/parts

### WedgePart geometry: which face is sloped  `[COMMUNITY-STANDARD]`

create.roblox.com/docs only says 'WedgeParts are great for building slopes because of their slanted surface' — no face-level spec. Resolved with high confidence via two independent, mutually-consistent community sources: (1) stravant/roblox-geometry (open-source Lua geometry/collision helper, MIT), whose init.lua defines WedgePart's 6 vertices as combinations of ±xvec·sx, ±yvec·sy, ±zvec·sz with NO vertex at (+Y,−Z) — i.e. there is no top-front edge. Vertices present: top-back-left/right (+Y,+Z), bottom-back-left/right (−Y,+Z), bottom-front-left/right (−Y,−Z). The library explicitly names the diagonal quad the 'FrontSurface' with outward normal `slantVec = (-zvec*sy + yvec*sz).Unit` (blend of −Z 'front' and +Y 'up'). Net shape: the Back face (+Z) is a full vertical rectangle at full Size.Y height, the Bottom (−Y) is a full rectangle, extrusion runs unmodified along local X, and the entire Front (−Z) face is replaced by the diagonal slope running from the top-back edge down to the bottom-front edge. (2) Independent devforum thread (#703790) gives the slope's pitch angle as `math.atan2(wedge.Size.Z, wedge.Size.Y)` applied as a local-X-axis rotation — confirming the slope lives entirely in the Y–Z plane, consistent with (1). For three.js: hardcode this as a single reusable 6-vertex/8-triangle BufferGeometry (2 bottom-cap triangles are not needed since bottom is already a quad — total: 1 back quad, 1 bottom quad, 2 end-cap right-triangles at ±X, 1 sloped front quad = 6 quads/triangles), scaled per-instance by Size, matching how Roblox's own FormFactorPart likely works.

Citations:
- https://raw.githubusercontent.com/stravant/roblox-geometry/master/src/init.lua
- https://devforum.roblox.com/t/make-part-face-same-direction-as-wedges-sloped-face/703790
- https://create.roblox.com/docs/reference/engine/classes/WedgePart

### CornerWedgePart geometry: which corner/faces are sloped  `[COMMUNITY-STANDARD]`

create.roblox.com/docs gives only: 'This is a corner piece which has the same properties as a Part.' — no geometry. Derived from the same stravant/roblox-geometry source: 5 vertices — a single elevated apex at local (+X,+Y,−Z) i.e. Top-Front-Right, plus all four bottom corners at −Y (Back-Right, Front-Right, Back-Left, Front-Left) forming a full rectangular Bottom face. This yields: Front (−Z) and Right (+X) faces are flat/planar but triangular (each is missing its far-top corner, since no vertex exists at Back-top or Left-top). Back and Left are the two sloped quad faces, named in source as 'BackSurface' (normal = blend of +Z and +Y: `zvec*sy + yvec*sz`) and 'LeftSurface' (normal = blend of −X and +Y: `-xvec*sy + yvec*sx`), each running from the single apex down to the two most-distant bottom vertices. Net shape: a box with exactly one full-height vertical edge remaining (at the Front-Right corner) that tapers to zero height at the diagonally opposite (Back-Left) corner — the classic 'corner ramp' piece. Self-consistency check: Euler characteristic V−E+F=2 holds (5 vertices, 8 edges, 5 faces: 1 bottom quad + 2 flat triangles + 2 sloped quads) confirming this is a well-formed closed polyhedron. Not independently re-confirmed against a Studio screenshot in this pass — recommend a visual spot-check before shipping.

Citations:
- https://raw.githubusercontent.com/stravant/roblox-geometry/master/src/init.lua
- https://create.roblox.com/docs/reference/engine/classes/CornerWedgePart

### WedgePart/CornerWedgePart/TrussPart as standalone classes  `[UNCLEAR]`

WedgePart and CornerWedgePart are confirmed standalone classes inheriting FormFactorPart→BasePart→PVInstance→Instance (create.roblox.com/docs class hierarchy), geometrically equivalent to Part+Shape=Wedge/CornerWedge respectively. TrussPart inherits BasePart directly and exposes a Style property; the doc fetch only surfaced the property stub (typed as 'Enum.Style', 'Not Replicated', 'Read Parallel') without enum values or a geometry description — the exact enum name (commonly believed to be `Enum.TrussStyle` with values like `RustMetal`, `WoodPlanks`, `Ridged`, `Bracket`) was NOT confirmed against live docs in this pass. The common claim that a TrussPart's *collision* geometry is a plain box despite its visual lattice mesh was also not verified against a fetched source — flag both as open items, low priority since Truss is rare in typical builds; treat as a v1 fallback = simple box render until confirmed.

Citations:
- https://create.roblox.com/docs/reference/engine/classes/TrussPart

### BrickColor number → RGB table  `[COMMUNITY-STANDARD]`

create.roblox.com/docs does not publish the numeric palette (BrickColor reference page has no table). The complete, production-grade table lives in rojo-rbx/rbx-dom's `rbx_types` crate at `rbx_types/src/brick_color.rs` (mirrored at docs.rs/rbx_types/latest/src/rbx_types/brick_color.rs.html): a macro-generated list of ~230 entries shaped `[VariantName, "Display Name", NumericId, (R,G,B)]`, e.g. `[Black, "Black", 26, (27,42,53)]`, `[ReallyRed, "Really red", 1004, (255,0,0)]`, `[HotPink, "Hot pink", 1032, (255,0,191)]`. rbx_types is the serialization backbone of Rojo, the de facto standard Roblox↔filesystem sync tool (MIT/Apache-2.0 dual license, actively maintained) — this table is battle-tested against real Roblox files in production. RECOMMENDATION: port this table once into a static JSON lookup for the renderer.

.rbxlx encoding: BrickColor is stored as a bare integer, e.g. `<int name="BrickColorExample">194</int>` (the BrickColor.Number, NOT an RGB triplet) — the renderer must resolve Number→RGB via the table above.
Color3 encoding: `<Color3><R>f</R><G>f</G><B>f</B></Color3>`, each a float in [0,1] (also legally encodes INF/-INF/NAN per spec, though real content won't use these).

Citations:
- https://github.com/rojo-rbx/rbx-dom/blob/master/rbx_types/src/brick_color.rs
- https://docs.rs/rbx_types/latest/src/rbx_types/brick_color.rs.html
- https://raw.githubusercontent.com/rojo-rbx/rbx-dom/master/docs/xml.md
- https://create.roblox.com/docs/reference/engine/datatypes/Color3

### Material enum + Transparency/Reflectance semantics  `[OFFICIAL (enum list) / COMMUNITY-STANDARD (PBR mapping is original design, not a Roblox spec)]`

Full Enum.Material list (create.roblox.com/docs/reference/engine/enums/Material), 44 values: Plastic, SmoothPlastic, Neon, Wood, WoodPlanks, Marble, Basalt, Slate, CrackedLava, Concrete, Limestone, Granite, Pavement, Brick, Pebble, Cobblestone, Rock, Sandstone, CorrodedMetal, DiamondPlate, Foil, Metal, Grass, LeafyGrass, Sand, Fabric, Snow, Mud, Ground, Asphalt, Salt, Ice, Glacier, Glass, ForceField, Air, Water, Cardboard, Carpet, CeramicTiles, ClayRoofTiles, RoofShingles, Leather, Plaster, Rubber. Per-value descriptions in the current docs are thin (mostly just 'Applies to BasePart only' / 'Applies to BasePart and Terrain'); Glass adds a note: 'refraction of light through this material is not supported on mobile devices.' Neon's official description does not state emissive/self-lit behavior explicitly, but this is extremely well-established Roblox behavior across many devforum threads (Neon glows independent of scene lighting; HSV Value channel drives glow intensity) — mark Neon-is-emissive as COMMUNITY-STANDARD, not officially documented in these terms.

BasePart.Transparency: number, 0 = opaque; official code sample ('Fade Door') sets 0 and 0.7, implying standard [0,1] range → maps directly to `material.opacity = 1 - Transparency`, `material.transparent = Transparency > 0`.
BasePart.Reflectance: number; devforum consensus is a documented/UI-clamped [0,1] range in current Studio (a legacy quirk allowed -1..1 causing black-tint bugs, considered a bug not a feature) → recommend mapping to a small environment-intensity/clearcoat boost, not literal mirror reflectivity.

Original (non-Roblox-sourced) PBR approximation table for three.js MeshStandardMaterial/MeshPhysicalMaterial, proposed by this research, not found in any spec: Plastic (roughness .55, metalness 0, clearcoat .15), SmoothPlastic (.25, 0, clearcoat .25), Neon (roughness .4, metalness 0, emissive=baseColor, emissiveIntensity ~1.5-2), Wood/WoodPlanks (.75, 0), Concrete (.9, 0), Metal (.35, .9), CorrodedMetal (.6, .8), Foil (.2, .9), DiamondPlate (.3, .85), Grass/LeafyGrass (.95, 0), Sand/Ground/Mud (.95, 0), Brick/Cobblestone/Rock/Sandstone/Granite/Pavement (.85-.9, 0), Glass (roughness .05, metalness 0, transmission .9, ior 1.5 via MeshPhysicalMaterial), ForceField (roughness 1, transparent, opacity ~.3, additive blending — v1 can skip the fresnel-rim shader).

Citations:
- https://create.roblox.com/docs/reference/engine/enums/Material
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/enums/Material.yaml
- https://create.roblox.com/docs/reference/engine/classes/BasePart#Reflectance

### Lighting defaults for a new place  `[UNCLEAR (source disagreement on Ambient default)]`

From creator-docs Lighting.yaml (GitHub source of create.roblox.com/docs) vs. robloxapi.github.io (class-metadata mirror of Roblox's own reflection/API dump) — the two disagree on Ambient's default: creator-docs description implies default [0,0,0] (black) while the robloxapi class-metadata table shows Ambient default = Color3(0.5,0.5,0.5). OutdoorAmbient is consistent across both at ~Color3(0.5,0.5,0.5)/[127,127,127]. THIS MUST BE VERIFIED by reading Lighting.Ambient in a freshly created Studio place before hardcoding a preview default.

Other class-metadata defaults (robloxapi.github.io, single-sourced, not cross-verified against a second source in this pass): Brightness=1, ColorShift_Top=Color3(0,0,0), ColorShift_Bottom=Color3(0,0,0), ClockTime=14 (2:00 PM), GeographicLatitude=41.7332993° (this number does not correspond to any obviously meaningful real-world Roblox location — treat as an arbitrary engine constant, not a geographic Easter egg), EnvironmentDiffuseScale=0, EnvironmentSpecularScale=0 (independently corroborated by a 2020 tweet from Roblox co-founder asimo3089 instructing users to manually set both to 1 to enable environment reflections — i.e. confirmed OFF by default), Technology(class-default)='Compatibility' — but Technology itself is DEPRECATED per creator-docs Lighting.yaml, superseded by `LightingStyle` (Enum.LightingStyle: Realistic=0 'the most advanced and realistic lighting and shadows,' Soft=1 'a flat, retro-Roblox look') and `PrioritizeLightingQuality`. Given the Jan 2025 deprecation announcement and that today is 2026-07-27, LightingStyle is very likely the property actually driving current rendering — do not build the v1 pipeline around the legacy `Technology` enum without a fresh confirmation of which property new places actually set today.

Sun-direction formula from ClockTime+GeographicLatitude: NOT PUBLISHED by Roblox anywhere found. Two devforum threads explicitly asking for it (#3921848, #3594002) got no working forward-formula answer; only a partial INVERSE snippet surfaced (world-direction → lat/lon, using an unexplained '+23.5' constant resembling Earth's axial tilt, suggesting — but not confirming — Roblox may use a real solar-position-style model). Status: NOT-POSSIBLE to obtain the exact internal formula from public sources today. RECOMMENDATION: implement an independent standard solar-elevation/azimuth approximation (`sin(elevation) = sin(lat)·sin(decl) + cos(lat)·cos(decl)·cos(hourAngle)`, hourAngle from ClockTime, decl fixed or seasonally faked since Roblox has no date/season concept) and explicitly disclose in-product that sun position is an approximation, not a bit-exact match to Roblox's renderer.

Citations:
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/classes/Lighting.yaml
- https://robloxapi.github.io/ref/class/Lighting.html
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/enums/LightingStyle.yaml
- https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/environment/lighting.md
- https://devforum.roblox.com/t/formula-for-converting-lighting-data-to-sun-direction-python/3921848
- https://devforum.roblox.com/t/how-does-lightinggetsundirection-calculate-the-direction-of-the-sun-based-on-clocktime-and-geographiclatitude/3594002
- https://x.com/asimo3089/status/1224555613121736704

### three.js lighting rig + default Baseplate recommendation  `[COMMUNITY-STANDARD (original design recommendation)]`

Recommended rig: HemisphereLight(skyColor≈tinted-sky hex, groundColor≈Ambient-derived dark gray, intensity≈0.6) + DirectionalLight (color tinted by ColorShift_Top over white, intensity ∝ Brightness/2, positioned via the sun-approximation above, shadow.mapSize=2048, shadow camera frustum fit to scene AABB) + a low-intensity THREE.AmbientLight standing in for the indoor `Ambient` property. Tone mapping: ACESFilmicToneMapping (exposure≈1.0) reads closer to modern Future/ShadowMap-quality Studio renders; ReinhardToneMapping reads closer to the flatter legacy/Soft look — expose as a style toggle mirroring LightingStyle Realistic/Soft. Approximate default Studio sky colors (zenith ~#7092A5–#8FB8DE fading to a lighter horizon ~#C6D9EA) are THIS REPORT'S OWN ESTIMATE from general familiarity, NOT pulled from a fetched authoritative source — sample actual pixel colors from a fresh Studio screenshot before finalizing hex values.

Default Baseplate: a Part named 'Baseplate', Size (512, 20, 512) confirmed via the 'Classic Baseplate' Studio template description; Position such that the top surface sits at world Y=0 (commonly Position (0,-10,0)) is the near-universal convention but the exact Y was not found quoted in an authoritative source in this pass — treat as high-confidence default, not a verified quote.

Citations:
- https://devforum.roblox.com/t/how-big-is-a-default-baseplate/998651
- https://github.com/Roblox/creator-docs/blob/main/content/en-us/resources/templates.md

### Prior art: rbxlx/three.js viewers and rbx-dom ports  `[COMMUNITY-STANDARD]`

No mature, actively-maintained, MIT/permissive three.js-based rbxlx viewer exists to fork as of 2026-07-27 — the rendering layer must be built from scratch.
• rojo-rbx/rbx-dom (github.com/rojo-rbx/rbx-dom): Rust, dual MIT/Apache-2.0, actively maintained, the de facto standard (de)serializer for rbxlx/rbxmx/rbxl/rbxm, powers Rojo. No published npm/WASM build was located in this pass — only Rust crates on crates.io/docs.rs. If browser-side binary parsing is wanted, plan to compile `rbx_xml`/`rbx_binary` to WASM via wasm-bindgen yourself, or hand-write a JS/TS XML parser directly against the precise xml.md spec (very tractable given how exact that spec is). STRONGEST BORROW TARGET for format math (this is where the CFrame/Color3/BrickColor encoding facts in this report came from).
• LPGhatguy/rbxplorer (github.com/LPGhatguy/rbxplorer): MIT, 'Super early WIP,' archived/read-only since July 2020, 2 stars — dead; only useful as historical proof that rbx-dom→WASM→browser is feasible, no 3D rendering was ever built.
• GooglyBlox/rbxlx-explorer (github.com/GooglyBlox/rbxlx-explorer): MIT, Next.js/TypeScript, ~5 stars, small/hobby scale — property/tree editor and Lua script editor only; explicitly does NOT render 3D geometry. Worth reading for its TS-side rbxlx parse/serialize round-trip approach, not for rendering math.
• npm `rbx-reader`: reads .rbxm(x)/.rbxl(x); page fetch was blocked (HTTP 403) in this pass, so license/maturity/API surface could not be verified — spot-check before depending on it.
• Gl2imm/RBX_Toolbox (Blender addon, github.com/Gl2imm/RBX_Toolbox): actively maintained per its devforum thread, ships a 'custom RBXM reader' importing FileMesh geometry + textures into Blender with 'accurate Roblox-to-Blender conversion for orientation and scale.' Since Blender is Z-up (vs. Roblox/three.js Y-up), its axis-remap code is a useful secondary reference for the FileMesh-parsing logic (v2) even though the coordinate remap itself doesn't apply to a three.js target.

Citations:
- https://github.com/rojo-rbx/rbx-dom
- https://github.com/rojo-rbx/rbx-dom/blob/master/docs/xml.md
- https://github.com/LPGhatguy/rbxplorer
- https://github.com/GooglyBlox/rbxlx-explorer
- https://www.npmjs.com/package/rbx-reader
- https://github.com/Gl2imm/RBX_Toolbox
- https://devforum.roblox.com/t/rbx-toolbox-free-blender-addon/2170259

### MeshPart/Decal/Texture feasibility via AssetDelivery API (v2)  `[OFFICIAL (endpoints/auth) / NOT-POSSIBLE (public/anonymous fetch) / COMMUNITY-STANDARD (mesh binary format)]`

Public/anonymous asset content fetch is dead: as of 2 Apr 2025 the legacy `assetdelivery.roblox.com/v1|v2/asset(Id)[/version/{n}]` and `/v1/assets/batch` endpoints reject unauthenticated calls with HTTP 401 (devforum 'Creator Action Required: New Asset Delivery API Endpoints for Community Tools,' #3574403). Roblox's sanctioned replacement is the Open Cloud endpoint `GET https://apis.roblox.com/asset-delivery-api/v1/assetId/{assetId}[/version/{versionNumber}]`, authenticated via a scoped API key or OAuth2 with the `legacy-asset:manage` scope. The official create.roblox.com/docs/cloud/reference/domains/assetdelivery page lists the newer v2 surface (`GET /v2/asset`, `/v2/assetId/{assetId}`, `/v2/assetId/{assetId}/version/{versionNumber}`, `POST /v2/assets/batch`, `/v2/marAssetHash/.../marCheckSum/...`) but the fetched page excerpt did not surface the exact header name for the API key (standard Open Cloud convention is `x-api-key`) — confirm against the live Open Cloud auth guide before implementing.
CONSEQUENCE: MeshPart texture/geometry fetch is not anonymous — the platform needs either the end-user's own OAuth-delegated permission or a platform-owned service credential scoped per-asset, adding real auth-flow surface for a v2 feature.

Even once fetched, the payload is Roblox's proprietary binary 'FileMesh' format (multiple versions, 1.00 through 6.00+), which is NOT glTF/OBJ/FBX and has no official spec — only community reverse-engineering exists (devforum 'Roblox FileMesh Format Specification' #326114, with contributions credited to Roblox-adjacent community figure MaximumADHD; a supplementary GitHub gist at gist.github.com/uyjulian/c10b3a80e02059803e16). No ready-made three.js loader for FileMesh was found; a bespoke binary parser → THREE.BufferGeometry converter must be hand-written or ported from an existing reverse-engineered parser (e.g. from C# tooling).
VERDICT: feasible but nontrivial, correctly scoped as v2. Ship v1 rendering MeshPart instances as a placeholder (bounding-box or simple hidden/skip with a visible 'mesh preview unavailable' affordance) rather than blocking primitive-geometry launch on this.

Citations:
- https://create.roblox.com/docs/cloud/reference/domains/assetdelivery
- https://devforum.roblox.com/t/creator-action-required-new-asset-delivery-api-endpoints-for-community-tools/3574403
- https://devforum.roblox.com/t/roblox-mesh-format/326114
- https://gist.github.com/uyjulian/c10b3a80e02059803e16

### Recommendations

Scene mapping (v1): one THREE.Mesh per Part/WedgePart/CornerWedgePart/TrussPart instance, built from a small set of reusable, per-shape BufferGeometry templates (Block=BoxGeometry, Ball=SphereGeometry(radius=min(size)/2), Cylinder=CylinderGeometry rotated to X-axis, Wedge/CornerWedge=hand-authored 6-/5-vertex geometries per findings above), each non-uniformly scaled by Size and positioned/oriented via the direct CFrame→Matrix4 copy (no per-part CPU triangulation). Switch any shape class exceeding a few thousand live instances (e.g. repeated decorative parts) to THREE.InstancedMesh keyed by (shape,material,color) once real places show that scale — premature in v1.
Grid/stud treatment: since the actual Baseplate Part is rendered (not a synthetic floor), do NOT draw a separate ground grid; instead add a subtle procedural stud-bump normal map or a thin fragment-shader grid overlay on Parts whose Material read is Plastic/SmoothPlastic at Baseplate-scale, purely cosmetic, off by default, toggleable — keeps the "this is the real place" promise intact.
Selection: GPU-friendly ID-buffer or bounding-sphere raycast (THREE.Raycaster against the instance list, not per-triangle) for hit-testing; render a selection highlight as a slightly-scaled duplicate mesh with a flat unlit outline shader (view-space normal-extrude outline) rather than THREE.OutlineEffect post-processing, since outline post-processing on a dark UI tends to bleed/halo — an object-space outline mesh is more predictable on dark backgrounds and cheaper to keep isolated per-selected-object.
Camera: default orbit controls (drag-orbit, scroll-zoom, matching Studio's default camera feel) PLUS a Studio-style right-mouse-hold-to-look + WASD/QE fly mode (right button captures pointer, mouse-move rotates yaw/pitch, WASDQE translate along camera-local axes at a stud/sec speed scaled to scene size) — this is the single most-recognizable Studio-parity feature for the target nontechnical-but-Studio-curious user.
Pipeline sequencing: given the auth/format complexity found in MeshPart research, sequence v1 as primitives-only (Part family) + Decal/texture skipped entirely, and treat MeshPart as an explicit, separately-scoped v2 milestone requiring its own OAuth/Open-Cloud integration work — do not let it block the core prompt-to-preview loop.

### Limitations (surface honestly in-product)

State these honestly in-product: (1) Sun/shadow direction is an independent approximation, not Roblox's exact ClockTime/GeographicLatitude formula (which Roblox has never published) — shadow angles will visually diverge from a real Studio/in-game render at the same ClockTime. (2) Lighting.Ambient's true default is unresolved from documentation alone (two sources disagree between black and 0.5-grey) and the legacy `Technology` property this report characterized may already be superseded in practice by `LightingStyle`/`PrioritizeLightingQuality` — both need a live-Studio confirmation pass before the lighting rig ships. (3) v1 skips Terrain (voxel/SmoothTerrain — an entirely separate, undocumented-in-this-pass rendering system), SurfaceGui/BillboardGui and other Instance-based UI, ParticleEmitter/Trail/Beam effects, Decal/Texture image rendering, and MeshPart custom geometry (proprietary FileMesh format, gated behind post-Apr-2025 Open Cloud auth) — the preview is a faithful renderer of primitive Part-family geometry, coloring, and lighting only; anything relying on the skipped systems will visibly differ from an actual Roblox client/Studio render until built in v2+. (4) TrussPart's Style enum and exact collision-vs-visual geometry split were not confirmed against live docs — treated as a simple box placeholder for now. (5) Cylinder's X-axis orientation, CornerWedge's exact face assignment, and the default Baseplate Y-position all rest on strong-but-inferred community evidence rather than a directly quoted create.roblox.com sentence — each is flagged individually above with a recommended manual Studio spot-check before the numbers are frozen into shipped geometry templates. (6) This report covers the preview-rendering layer only; the separate hard requirement to "publish/update the user's experience on Roblox through officially supported means" (Open Cloud Places/Universes publish API, OAuth consent flow for end users) was NOT researched in this pass and needs its own dedicated verification sweep before launch.

### User setup steps

For v1 (primitive-geometry preview): none — parsing an uploaded/generated .rbxlx and rendering Block/Ball/Cylinder/Wedge/CornerWedge/Truss geometry, BrickColor/Color3, and the approximate lighting rig requires no Roblox account, API key, or OAuth from the end user; it's pure client-side math against the file the AI already generated.
For v2 (MeshPart/Decal/texture rendering): each user (or the platform, on their behalf) must have a Roblox Open Cloud credential scoped to read assets: (1) In the Roblox Creator Dashboard, create an API key (or register an OAuth2 app if the platform wants per-user delegated consent instead of a shared service key) and grant it the `legacy-asset:manage` scope required by the new `apis.roblox.com/asset-delivery-api/v1/...` endpoint. (2) Store the key server-side (never client-exposed) and proxy MeshPart/texture fetches through the platform's backend, attaching the credential as an `x-api-key` header (standard Open Cloud convention — confirm exact header name against the live Open Cloud auth docs before implementation). (3) Budget separate engineering time for the FileMesh binary parser since no ready three.js loader exists for it.
