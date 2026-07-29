// Manager-owned central config.

export const APP_NAME = 'Bloxable'

export const FREE_DAILY_CREDITS = 25

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
