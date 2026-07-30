// Manager-owned central config.

export const APP_NAME = 'Bloxable'

export const FREE_DAILY_CREDITS = 25

/**
 * Turns the daily limit off. PRODUCT.md locks a limited free allowance as the
 * shipping behaviour, so this is a switch and not a deletion: the counter, the
 * pill, the paywall and the server-side gate all stay in the codebase and come
 * back by flipping this to false. While it is true nothing is counted, the
 * credits pill is hidden, and the paywall never opens.
 */
export const UNLIMITED_CREDITS = true

// Chat model defaults, one per provider. The provider actually used is chosen by
// which API key is present (lib/ai/provider.ts); either default can be overridden
// with an ANTHROPIC_MODEL / OPENAI_MODEL line in .env.local.
export const CLAUDE_MODEL = 'claude-sonnet-5'
export const OPENAI_MODEL_DEFAULT = 'gpt-5.5'

/** Open Cloud publish request cap (bytes) — verified in RESEARCH.md Part 1 Q1. */
export const PUBLISH_SIZE_LIMIT = 10_485_760
export const PUBLISH_SIZE_WARN = 8 * 1024 * 1024

/** Pinned toolchain (RESEARCH.md Part 2). */
export const ROJO_VERSION = '7.7.0'
export const LUNE_VERSION = '0.10.5'

/**
 * Scopes requested when a user connects their own Roblox account (the eject
 * path). asset:read + asset:write are both inside the OAuth2 "Creation &
 * Productivity Tools" category — verified in RESEARCH.md Part 1 Q3b — and are
 * what the Assets API needs to upload a model into that user's inventory.
 *
 * user.advanced:read unlocks premium/idVerified/createTime on Cloud v2
 * GET /users/{id} for the publish-eligibility check (lib/roblox/eligibility).
 * Without it Roblox silently answers false for both flags rather than
 * erroring (devforum.roblox.com/t/-/3116938), so eligibility treats an
 * ungranted scope as 'unknown', never as false. Consent stays deferred: the
 * connect flow only runs when the user acts (publish/eject), never at first
 * run. Accounts connected before this scope existed report `needsConsent`
 * until they reconnect.
 */
export const ROBLOX_OAUTH_SCOPES = ['openid', 'profile', 'asset:read', 'asset:write', 'user.advanced:read']

/** Assets API cap for Model uploads (bytes) — RESEARCH.md Part 1 Q6. */
export const ASSET_SIZE_LIMIT = 20 * 1024 * 1024
