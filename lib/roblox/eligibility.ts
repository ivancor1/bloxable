// Publish-tier eligibility. Server-only.
//
// One honest answer to "which audiences could this user publish to, and what
// stands in the way?", derived from three sources — none of which is ever
// faked when it is missing:
//
//   1. The user signed into Roblox Studio, reported by the helper plugin
//      (plugin/BloxableHelper.luau → POST /api/roblox/eligibility/studio-user).
//      StudioService:GetUserId() is 0 when Studio is signed out.
//   2. The connected OAuth account: GET apis.roblox.com/cloud/v2/users/{id}
//      with the user.advanced:read scope → createTime, premium, idVerified.
//      WITHOUT that scope Roblox silently answers false for both flags instead
//      of erroring (devforum.roblox.com/t/-/3116938), so those fields are only
//      read when the scope was actually granted — otherwise they stay
//      'unknown' and `needsConsent` says why. 10 req/min per app user → cached.
//   3. The public users API: GET users.roblox.com/v1/users/{id} → created,
//      isBanned. No auth at all.
//
// The requirements themselves come from the canonical docs (fetched as
// markdown 2026-07-30; the stale experience-guidelines page that still says
// 17+/30-day is deliberately ignored):
//   create.roblox.com/docs/production/publishing/publish-games-and-places
//   create.roblox.com/docs/production/publishing/account-verification
//   create.roblox.com/docs/production/publishing/kids-and-select
//
// 16+ / Trusted Friends needs exactly three things: an account in good
// standing at least 2 days old, ONE age check (facial age estimation, phone
// number, or government ID), and the Maturity & Compliance questionnaire.
// Roblox documents NO minimum creator age for that tier — the only documented
// age floors are 13+ to use a verification method and 18+ (verified) for
// Restricted content — so nothing here hard-codes a 16+ creator floor.
//
// This module never starts an OAuth flow and never touches cookies or
// .ROBLOSECURITY. 2FA status is exposed by no supported API, so it is modeled
// as not-checkable with a link out — never inferred, never faked.

import { getRobloxAccount, getStudioUser, type RobloxAccount, type StudioUserReport } from '@/lib/store'
import { getAccessToken } from './oauth'
import { RobloxError } from './discover'

const PUBLIC_USERS_URL = 'https://users.roblox.com/v1/users'
const CLOUD_USERS_URL = 'https://apis.roblox.com/cloud/v2/users'
const TIMEOUT_MS = 20_000

/** Cloud v2 users allows 10 req/min per app user; the public API is cached the
 * same way out of politeness. Both caches are per-process, like lib/store's
 * lock map — this is a local, single-process app. */
const CACHE_TTL_MS = 5 * 60_000

const ADVANCED_SCOPE = 'user.advanced:read'

/** Where Roblox lets the user manage 2FA — the honest substitute for a status
 * no supported API exposes. */
const TWO_FACTOR_SETTINGS_URL = 'https://www.roblox.com/my/account#!/security'

const DOCS = {
  publishing: 'https://create.roblox.com/docs/production/publishing/publish-games-and-places',
  accountVerification: 'https://create.roblox.com/docs/production/publishing/account-verification',
  kidsAndSelect: 'https://create.roblox.com/docs/production/publishing/kids-and-select',
} as const

// ---------------------------------------------------------------------------
// The tier object — the shape two other surfaces build on. Every field that
// cannot be checked says 'unknown' (or 'not-checkable') in the type itself, so
// no consumer can mistake an unchecked fact for a checked one.
// ---------------------------------------------------------------------------

/** A fact that could not be checked is said plainly, never defaulted. */
export type Tri = boolean | 'unknown'

export interface SixteenPlusAudience {
  /**
   * 'eligible' is reserved for every documented requirement being CONFIRMED.
   * No API exposes Maturity & Compliance questionnaire completion, so today's
   * derivation tops out at 'likely-eligible' — the UI must not present that
   * as a guarantee. 'needs-steps' means at least one requirement is known to
   * be unmet or unconfirmed by Roblox itself; 'unknown' means the sources to
   * decide are missing.
   */
  status: 'eligible' | 'likely-eligible' | 'needs-steps' | 'unknown'
  /** Concrete remaining steps, in the user's terms. Empty only for 'eligible'. */
  missing: string[]
}

export interface UnderSixteenAudience {
  /** Under-16 audiences (Select 9–15, Kids 5–8) are closed in Bloxable. */
  status: 'closed'
  /** The documented Roblox requirements that close this path — see DOCS. */
  reasons: string[]
}

export interface PublishTier {
  /**
   * The user signed into Roblox Studio, per the helper plugin. A number is a
   * real report; null means Studio reported signed-out (GetUserId() == 0);
   * 'unknown' means the plugin has never reported to this app.
   */
  studioUserId: number | null | 'unknown'
  /** The account the checks below ran against, and which source named it. */
  account: { userId: string; source: 'oauth' | 'studio' } | null
  /** Whole days since account creation, or 'unknown' without a usable source. */
  accountAgeDays: number | 'unknown'
  /**
   * Government-ID verification per Cloud v2. false means NOT CONFIRMED — a
   * known bug can report false for verified accounts — so no user-facing
   * surface may render false as "confirmed unverified".
   */
  idVerified: Tri
  /**
   * Premium per Cloud v2. Whether this flag also covers Roblox Plus
   * subscribers (Premium was discontinued 2026-04-30) is not documented:
   * treat true as meaningful and false as inconclusive.
   */
  premium: Tri
  /** 2FA is exposed by no supported API — never inferred; link out instead. */
  twoFactor: { status: 'not-checkable'; settingsUrl: string }
  /**
   * Roblox documents no minimum creator age for 16+ publishing (the only
   * documented floors: 13+ to use a verification method, 18+ verified for
   * Restricted content). A literal, so UI copy cannot drift into inventing one.
   */
  creatorAgeFloorDocumented: false
  /**
   * True when the OAuth-only facts (idVerified, premium, createTime) need a
   * user.advanced:read grant the user has not given. Consent is deferred: the
   * caller shows it when the user actually tries to publish — this module
   * never redirects anyone to Roblox.
   */
  needsConsent: boolean
  audiences: {
    sixteenPlus: SixteenPlusAudience
    underSixteen: UnderSixteenAudience
  }
  /** Canonical Roblox docs behind this derivation, for honest link-outs. */
  docs: { publishing: string; accountVerification: string; kidsAndSelect: string }
  checkedAt: string // ISO 8601
}

// ---------------------------------------------------------------------------
// Source states. deriveTier() is pure over these, which is what the test
// suite drives; the fetchers below fill them from the live APIs.
// ---------------------------------------------------------------------------

export type OauthSource =
  /** No Roblox account connected at all. */
  | { state: 'not-connected' }
  /** Connected before user.advanced:read was requested — reconnect grants it. */
  | { state: 'missing-scope'; userId: string }
  /** Consent granted but the lookup failed — facts degrade to 'unknown'. */
  | { state: 'error'; userId: string; message: string }
  | { state: 'ok'; userId: string; createTime: string | null; premium: Tri; idVerified: Tri }

export type PublicSource =
  /** No user id from any source — nothing to look up. */
  | { state: 'no-user' }
  | { state: 'error'; message: string }
  | { state: 'ok'; created: string; isBanned: boolean }

export function hasAdvancedScope(scope: string): boolean {
  return scope.split(/[\s,]+/).includes(ADVANCED_SCOPE)
}

const MS_PER_DAY = 86_400_000

function daysSince(iso: string, now: Date): number | 'unknown' {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'unknown'
  return Math.max(0, Math.floor((now.getTime() - t) / MS_PER_DAY))
}

/** Derive the tier object from the three sources. Pure — fully testable. */
export function deriveTier(args: {
  studio: StudioUserReport | null
  oauth: OauthSource
  publicUser: PublicSource
  now?: Date
}): PublishTier {
  const { studio, oauth, publicUser } = args
  const now = args.now ?? new Date()

  const studioUserId: number | null | 'unknown' =
    studio === null ? 'unknown' : studio.userId === 0 ? null : studio.userId

  // The OAuth identity wins when both exist: it is the account the user chose
  // to connect. A signed-in Studio user is the fallback identity.
  const account: PublishTier['account'] =
    oauth.state !== 'not-connected'
      ? { userId: oauth.userId, source: 'oauth' }
      : typeof studioUserId === 'number'
        ? { userId: String(studioUserId), source: 'studio' }
        : null

  const accountAgeDays: number | 'unknown' =
    publicUser.state === 'ok'
      ? daysSince(publicUser.created, now)
      : oauth.state === 'ok' && oauth.createTime
        ? daysSince(oauth.createTime, now)
        : 'unknown'

  const idVerified: Tri = oauth.state === 'ok' ? oauth.idVerified : 'unknown'
  const premium: Tri = oauth.state === 'ok' ? oauth.premium : 'unknown'
  const needsConsent = oauth.state === 'not-connected' || oauth.state === 'missing-scope'
  const banned: Tri = publicUser.state === 'ok' ? publicUser.isBanned : 'unknown'

  return {
    studioUserId,
    account,
    accountAgeDays,
    idVerified,
    premium,
    twoFactor: { status: 'not-checkable', settingsUrl: TWO_FACTOR_SETTINGS_URL },
    creatorAgeFloorDocumented: false,
    needsConsent,
    audiences: {
      sixteenPlus: sixteenPlus({ account, accountAgeDays, idVerified, banned, needsConsent }),
      underSixteen: underSixteen(),
    },
    docs: { ...DOCS },
    checkedAt: now.toISOString(),
  }
}

/**
 * The 16+ / Trusted Friends derivation. Requirements per DOCS.publishing:
 * good standing + ≥2 days old, ONE age check, the questionnaire. `missing`
 * only ever phrases an unconfirmed check as "not confirmed" — Roblox's API
 * under-reports idVerified (known bug), so false is never presented as a
 * verified absence.
 */
function sixteenPlus(facts: {
  account: PublishTier['account']
  accountAgeDays: number | 'unknown'
  idVerified: Tri
  banned: Tri
  needsConsent: boolean
}): SixteenPlusAudience {
  const { account, accountAgeDays, idVerified, banned, needsConsent } = facts

  if (!account) {
    return {
      status: 'unknown',
      missing: [
        'Connect a Roblox account (or sign into Studio with the Bloxable helper plugin installed) so eligibility can be checked.',
      ],
    }
  }

  const missing: string[] = []
  const ageKnown = accountAgeDays !== 'unknown'
  const tooYoung = ageKnown && accountAgeDays < 2

  if (tooYoung) {
    missing.push(
      `Wait until the account is at least 2 days old — Roblox requires this (currently ${accountAgeDays} day${accountAgeDays === 1 ? '' : 's'} old).`,
    )
  }
  if (banned === true) {
    missing.push(
      'Resolve the account standing — Roblox reports this account as banned, and publishing requires an account in good standing.',
    )
  }
  if (idVerified !== true) {
    missing.push(
      idVerified === false
        ? 'Complete one age check — facial age estimation, phone number, or government ID. Roblox did not confirm one on this account; if you already verified, its API is known to under-report.'
        : needsConsent
          ? 'Complete one age check — facial age estimation, phone number, or government ID. Bloxable can confirm it once you grant the extra Roblox permission (asked when you publish).'
          : 'Complete one age check — facial age estimation, phone number, or government ID. It could not be confirmed right now.',
    )
  }
  missing.push(
    'Complete the Maturity & Compliance questionnaire in Creator Hub — no API exposes its status, so confirm it there.',
  )

  const status: SixteenPlusAudience['status'] =
    tooYoung || banned === true
      ? 'needs-steps'
      : !ageKnown || idVerified === 'unknown'
        ? 'unknown'
        : idVerified === true
          ? 'likely-eligible' // questionnaire remains unconfirmable — never 'eligible' from API data alone
          : 'needs-steps'

  return { status, missing }
}

/** The under-16 path, closed with the documented reasons (DOCS.kidsAndSelect). */
function underSixteen(): UnderSixteenAudience {
  return {
    status: 'closed',
    reasons: [
      'Roblox requires ID verification via government ID or a linked parental account — a minor cannot ID-verify themselves.',
      'Roblox requires 2FA on the creator account, which no supported API can check.',
      'Roblox requires a refundable 1,000-Robux per-game publishing fee, or a Roblox Plus/Premium subscription held 2+ consecutive months.',
      'The game itself must pass evaluation: about 500 unique plays by highly engaged, age-checked users within 60 days.',
    ],
  }
}

// ---------------------------------------------------------------------------
// Live fetchers, with per-process caches sized to the documented rate limits.
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  at: number
  value: T
}

export interface PublicUserFacts {
  created: string
  isBanned: boolean
}

export interface CloudUserFacts {
  createTime: string | null
  premium: Tri
  idVerified: Tri
}

const publicCache = new Map<string, CacheEntry<PublicUserFacts>>()
const cloudCache = new Map<string, CacheEntry<CloudUserFacts>>()

function cached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  if (hit) cache.delete(key)
  return null
}

/** Roblox's message, verbatim, from either error envelope shape. */
function robloxMessage(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { errors?: { message?: string }[]; message?: string }
    if (Array.isArray(parsed.errors) && parsed.errors[0]?.message) return parsed.errors[0].message
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message
  } catch {
    // not JSON
  }
  return null
}

async function robloxGet(url: string, headers?: Record<string, string>): Promise<string> {
  let res: Response
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new RobloxError(
      timedOut ? 'Roblox request timed out.' : `Roblox request failed: ${err instanceof Error ? err.message : String(err)}`,
      timedOut ? 504 : 502,
    )
  }
  const text = await res.text()
  if (!res.ok) throw new RobloxError(robloxMessage(text) ?? text.slice(0, 300) ?? `Roblox request failed (${res.status})`, res.status)
  return text
}

/**
 * Public, unauthenticated user lookup — account creation date and ban state.
 * Verified live 2026-07-30: GET users.roblox.com/v1/users/156 →
 * { created: "2006-03-08T17:17:52.9Z", isBanned: false, id: 156, ... }.
 */
export async function fetchPublicUser(userId: string): Promise<PublicUserFacts> {
  const hit = cached(publicCache, userId)
  if (hit) return hit

  const text = await robloxGet(`${PUBLIC_USERS_URL}/${encodeURIComponent(userId)}`)
  let parsed: { created?: unknown; isBanned?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RobloxError(`Unexpected response from Roblox: ${text.slice(0, 300)}`, 502)
  }
  if (typeof parsed.created !== 'string') {
    throw new RobloxError(`Roblox returned no creation date: ${text.slice(0, 300)}`, 502)
  }

  const facts: PublicUserFacts = { created: parsed.created, isBanned: parsed.isBanned === true }
  publicCache.set(userId, { at: Date.now(), value: facts })
  return facts
}

/**
 * Cloud v2 user lookup over the user's own Bearer token. Only called when the
 * user.advanced:read scope was granted — without it Roblox answers false for
 * premium/idVerified instead of failing, which is exactly the lie the
 * 'missing-scope' state exists to avoid. A flag missing from the response
 * stays 'unknown' rather than defaulting.
 */
export async function fetchCloudUser(userId: string, accessToken: string): Promise<CloudUserFacts> {
  const hit = cached(cloudCache, userId)
  if (hit) return hit

  const text = await robloxGet(`${CLOUD_USERS_URL}/${encodeURIComponent(userId)}`, {
    Authorization: `Bearer ${accessToken}`,
  })
  let parsed: { createTime?: unknown; premium?: unknown; idVerified?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RobloxError(`Unexpected response from Roblox: ${text.slice(0, 300)}`, 502)
  }

  const facts: CloudUserFacts = {
    createTime: typeof parsed.createTime === 'string' ? parsed.createTime : null,
    premium: typeof parsed.premium === 'boolean' ? parsed.premium : 'unknown',
    idVerified: typeof parsed.idVerified === 'boolean' ? parsed.idVerified : 'unknown',
  }
  cloudCache.set(userId, { at: Date.now(), value: facts })
  return facts
}

// ---------------------------------------------------------------------------
// Orchestration — gather the three sources, then derive.
// ---------------------------------------------------------------------------

async function oauthSource(account: RobloxAccount | null): Promise<OauthSource> {
  if (!account) return { state: 'not-connected' }
  if (!hasAdvancedScope(account.scope)) return { state: 'missing-scope', userId: account.userId }
  try {
    const { token } = await getAccessToken()
    const facts = await fetchCloudUser(account.userId, token)
    return { state: 'ok', userId: account.userId, ...facts }
  } catch (err) {
    // A dead refresh token already cleared the connection (lib/roblox/oauth);
    // either way the eligibility answer degrades instead of failing the route.
    return { state: 'error', userId: account.userId, message: err instanceof Error ? err.message : String(err) }
  }
}

async function publicSource(userId: string | null): Promise<PublicSource> {
  if (!userId) return { state: 'no-user' }
  try {
    const facts = await fetchPublicUser(userId)
    return { state: 'ok', ...facts }
  } catch (err) {
    return { state: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

/** The whole picture, from whatever sources exist right now. Never throws for
 * a missing source — missing means 'unknown', not an error. */
export async function getEligibility(): Promise<PublishTier> {
  const [studio, account] = await Promise.all([getStudioUser(), getRobloxAccount()])
  const oauth = await oauthSource(account)
  const lookupId =
    oauth.state !== 'not-connected' ? oauth.userId : studio && studio.userId > 0 ? String(studio.userId) : null
  const publicUser = await publicSource(lookupId)
  return deriveTier({ studio, oauth, publicUser })
}
