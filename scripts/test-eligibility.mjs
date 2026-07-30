#!/usr/bin/env node
// Test for the publish-tier eligibility service (lib/roblox/eligibility.ts).
//
//   mocked source states -> deriveTier -> assert the tier object
//   mocked fetch -> fetchPublicUser / fetchCloudUser -> assert request + parse + cache
//   authorizeUrl -> assert the user.advanced:read consent request is built right
//
// deriveTier is pure, so every unknown-state combination is swept exhaustively.
// Nothing here talks to Roblox and nothing reads data/ — the live checks are
// documented in the PR, not hidden in a test that would flake offline.
//
// Same resolve-hook trick as test-ai-mapping.mjs (Node strips types natively;
// the hook adds extensions and the `@/` alias).

import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier
    if (spec.startsWith('@/')) spec = pathToFileURL(path.join(ROOT, spec.slice(2))).href
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\.[a-z]+$/i.test(spec)) {
      const url = new URL(spec, context.parentURL)
      for (const ext of ['.ts', '/index.ts']) {
        if (existsSync(fileURLToPath(url) + ext)) return nextResolve(spec + ext, context)
      }
    }
    return nextResolve(spec, context)
  },
})

const failures = []
let checks = 0

function ok(condition, message) {
  checks += 1
  if (!condition) failures.push(message)
}

function eq(actual, expected, message) {
  checks += 1
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) failures.push(`${message} (got ${a}, expected ${b})`)
}

function section(title) {
  process.stdout.write(`\n— ${title}\n`)
}

const { deriveTier, fetchPublicUser, fetchCloudUser, hasAdvancedScope } = await import(
  '../lib/roblox/eligibility.ts'
)
const { authorizeUrl } = await import('../lib/roblox/oauth.ts')
const { ROBLOX_OAUTH_SCOPES } = await import('../lib/config.ts')

// A fixed "now" so age math is deterministic.
const NOW = new Date('2026-07-30T12:00:00.000Z')
const DAY_MS = 86_400_000
const iso = (daysAgo) => new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString()

const STATUSES = ['eligible', 'likely-eligible', 'needs-steps', 'unknown']

function tier(overrides = {}) {
  return deriveTier({
    studio: null,
    oauth: { state: 'not-connected' },
    publicUser: { state: 'no-user' },
    now: NOW,
    ...overrides,
  })
}

// --- 1. everything unknown ----------------------------------------------------

section('all sources missing')
{
  const t = tier()
  eq(t.studioUserId, 'unknown', 'no plugin report → studioUserId unknown')
  eq(t.account, null, 'no source → no account')
  eq(t.accountAgeDays, 'unknown', 'no source → age unknown')
  eq(t.idVerified, 'unknown', 'no OAuth → idVerified unknown')
  eq(t.premium, 'unknown', 'no OAuth → premium unknown')
  eq(t.needsConsent, true, 'no OAuth → consent needed')
  eq(t.audiences.sixteenPlus.status, 'unknown', 'no account → 16+ unknown')
  ok(
    t.audiences.sixteenPlus.missing.some((s) => s.includes('Connect a Roblox account')),
    '16+ missing tells the user to connect',
  )
  eq(t.audiences.underSixteen.status, 'closed', 'under-16 is closed')
  eq(t.audiences.underSixteen.reasons.length, 4, 'under-16 lists the 4 documented reasons')
  eq(t.creatorAgeFloorDocumented, false, 'no invented 16+ creator age floor')
  eq(t.twoFactor.status, 'not-checkable', '2FA is not-checkable, never inferred')
  ok(t.twoFactor.settingsUrl.startsWith('https://www.roblox.com/'), '2FA links out to Roblox settings')
  ok(t.docs.publishing.includes('publish-games-and-places'), 'docs carry the canonical publishing page')
  eq(t.checkedAt, NOW.toISOString(), 'checkedAt is the derivation time')
}

// --- 2. the Studio report's three meanings ------------------------------------

section('studio report semantics')
{
  eq(tier().studioUserId, 'unknown', 'never reported → unknown')

  const signedOut = tier({ studio: { userId: 0, reportedAt: iso(0) } })
  eq(signedOut.studioUserId, null, 'GetUserId()==0 → null (signed out, not unknown)')
  eq(signedOut.account, null, 'a signed-out Studio names no account')

  const signedIn = tier({
    studio: { userId: 156, reportedAt: iso(0) },
    publicUser: { state: 'ok', created: iso(7000), isBanned: false },
  })
  eq(signedIn.studioUserId, 156, 'signed-in Studio user id carried through')
  eq(signedIn.account, { userId: '156', source: 'studio' }, 'Studio user becomes the account fallback')
  ok(signedIn.accountAgeDays === 7000, 'public created date → age in days')
  eq(signedIn.needsConsent, true, 'Studio identity alone still needs OAuth consent for the flags')
  eq(signedIn.audiences.sixteenPlus.status, 'unknown', 'age check unconfirmable without consent → unknown')
}

// --- 3. OAuth states ------------------------------------------------------------

section('oauth source states')
{
  const missingScope = tier({ oauth: { state: 'missing-scope', userId: '42' } })
  eq(missingScope.needsConsent, true, 'connected without user.advanced:read → needsConsent')
  eq(missingScope.idVerified, 'unknown', 'missing scope → idVerified unknown, never false')
  eq(missingScope.premium, 'unknown', 'missing scope → premium unknown, never false')
  eq(missingScope.account, { userId: '42', source: 'oauth' }, 'identity still known from the connection')

  const errored = tier({ oauth: { state: 'error', userId: '42', message: 'boom' } })
  eq(errored.needsConsent, false, 'consent was granted; a failed lookup is not a consent problem')
  eq(errored.idVerified, 'unknown', 'failed lookup degrades to unknown')
  eq(errored.audiences.sixteenPlus.status, 'unknown', 'failed lookup → 16+ unknown')

  const okState = tier({
    oauth: { state: 'ok', userId: '42', createTime: iso(100), premium: true, idVerified: true },
  })
  eq(okState.needsConsent, false, 'granted scope → no consent needed')
  eq(okState.premium, true, 'premium carried through')
  eq(okState.idVerified, true, 'idVerified carried through')
  eq(okState.accountAgeDays, 100, 'no public answer → age from OAuth createTime')
}

// --- 4. the 16+ derivation ------------------------------------------------------

section('16+ derivation')
{
  const likely = tier({
    oauth: { state: 'ok', userId: '42', createTime: iso(100), premium: false, idVerified: true },
    publicUser: { state: 'ok', created: iso(100), isBanned: false },
  })
  eq(likely.audiences.sixteenPlus.status, 'likely-eligible', 'age ok + age check confirmed → likely-eligible')
  eq(likely.audiences.sixteenPlus.missing.length, 1, 'only the questionnaire remains')
  ok(
    likely.audiences.sixteenPlus.missing[0].includes('Maturity & Compliance'),
    'the questionnaire is the remaining step',
  )

  const notConfirmed = tier({
    oauth: { state: 'ok', userId: '42', createTime: iso(100), premium: false, idVerified: false },
    publicUser: { state: 'ok', created: iso(100), isBanned: false },
  })
  eq(notConfirmed.audiences.sixteenPlus.status, 'needs-steps', 'idVerified false → needs-steps')
  ok(
    notConfirmed.audiences.sixteenPlus.missing.some((s) => s.includes('did not confirm')),
    'false is phrased as "not confirmed", never as confirmed-unverified',
  )
  ok(
    !JSON.stringify(notConfirmed.audiences.sixteenPlus.missing).toLowerCase().includes('unverified'),
    'the word "unverified" never appears in the steps',
  )

  const tooNew = tier({
    oauth: { state: 'ok', userId: '42', createTime: iso(1), premium: false, idVerified: true },
    publicUser: { state: 'ok', created: iso(1), isBanned: false },
  })
  eq(tooNew.accountAgeDays, 1, 'a day-old account is 1 day old')
  eq(tooNew.audiences.sixteenPlus.status, 'needs-steps', '<2 days → needs-steps')
  ok(
    tooNew.audiences.sixteenPlus.missing.some((s) => s.includes('at least 2 days old')),
    'the 2-day floor is a concrete step',
  )

  const banned = tier({
    oauth: { state: 'ok', userId: '42', createTime: iso(100), premium: false, idVerified: true },
    publicUser: { state: 'ok', created: iso(100), isBanned: true },
  })
  eq(banned.audiences.sixteenPlus.status, 'needs-steps', 'banned → needs-steps')
  ok(
    banned.audiences.sixteenPlus.missing.some((s) => s.includes('good standing')),
    'standing is a concrete step',
  )

  const ageless = tier({
    oauth: { state: 'ok', userId: '42', createTime: null, premium: false, idVerified: true },
    publicUser: { state: 'error', message: 'down' },
  })
  eq(ageless.accountAgeDays, 'unknown', 'no created date anywhere → age unknown')
  eq(ageless.audiences.sixteenPlus.status, 'unknown', 'unknown age → unknown status, not a guess')
}

// --- 5. exhaustive unknown-state sweep -------------------------------------------

section('exhaustive source-combination sweep')
{
  const studios = [null, { userId: 0, reportedAt: iso(0) }, { userId: 123, reportedAt: iso(0) }]
  const oauths = [
    { state: 'not-connected' },
    { state: 'missing-scope', userId: '42' },
    { state: 'error', userId: '42', message: 'boom' },
  ]
  for (const idVerified of [true, false, 'unknown']) {
    for (const premium of [true, false, 'unknown']) {
      for (const createTime of [null, iso(1), iso(400)]) {
        oauths.push({ state: 'ok', userId: '42', createTime, premium, idVerified })
      }
    }
  }
  const publics = [
    { state: 'no-user' },
    { state: 'error', message: 'down' },
    { state: 'ok', created: iso(400), isBanned: false },
    { state: 'ok', created: iso(1), isBanned: false },
    { state: 'ok', created: iso(400), isBanned: true },
  ]

  let swept = 0
  const sweepFailures = []
  const assert = (cond, msg, combo) => {
    if (!cond) sweepFailures.push(`${msg} [${JSON.stringify(combo)}]`)
  }

  for (const studio of studios) {
    for (const oauth of oauths) {
      for (const publicUser of publics) {
        const combo = { studio, oauth, publicUser }
        const t = deriveTier({ studio, oauth, publicUser, now: NOW })
        swept += 1

        const sp = t.audiences.sixteenPlus
        assert(STATUSES.includes(sp.status), '16+ status is a legal value', combo)
        assert(sp.status !== 'eligible', "'eligible' is unreachable from API data alone", combo)
        assert(
          sp.missing.length >= 1 && sp.missing.every((s) => typeof s === 'string' && s.length > 0),
          '16+ always lists at least one concrete step',
          combo,
        )
        assert(t.audiences.underSixteen.status === 'closed', 'under-16 always closed', combo)
        assert(t.audiences.underSixteen.reasons.length === 4, 'under-16 always carries its reasons', combo)
        assert(t.creatorAgeFloorDocumented === false, 'creator age floor never invented', combo)
        assert(t.twoFactor.status === 'not-checkable', '2FA never checked or inferred', combo)

        const expectConsent = oauth.state === 'not-connected' || oauth.state === 'missing-scope'
        assert(t.needsConsent === expectConsent, 'needsConsent tracks the scope grant exactly', combo)

        const expectVerified = oauth.state === 'ok' ? oauth.idVerified : 'unknown'
        const expectPremium = oauth.state === 'ok' ? oauth.premium : 'unknown'
        assert(t.idVerified === expectVerified, 'idVerified only ever from a scoped OAuth answer', combo)
        assert(t.premium === expectPremium, 'premium only ever from a scoped OAuth answer', combo)

        const expectStudio = studio === null ? 'unknown' : studio.userId === 0 ? null : studio.userId
        assert(t.studioUserId === expectStudio, 'studio report mapping', combo)

        if (oauth.state !== 'not-connected') {
          assert(
            t.account?.userId === oauth.userId && t.account?.source === 'oauth',
            'OAuth identity wins when connected',
            combo,
          )
        } else if (studio && studio.userId > 0) {
          assert(
            t.account?.userId === String(studio.userId) && t.account?.source === 'studio',
            'Studio identity is the fallback',
            combo,
          )
        } else {
          assert(t.account === null, 'no identity → no account', combo)
        }

        if (typeof t.accountAgeDays === 'number') {
          assert(t.accountAgeDays >= 0, 'age never negative', combo)
        }
        if (publicUser.state === 'ok') {
          assert(typeof t.accountAgeDays === 'number', 'public answer always yields an age', combo)
        }

        if (t.account === null) {
          assert(sp.status === 'unknown', 'no account → status unknown', combo)
        } else {
          assert(
            sp.missing.some((s) => s.includes('Maturity & Compliance')),
            'questionnaire always listed (no API exposes it)',
            combo,
          )
        }

        if (sp.status === 'likely-eligible') {
          assert(
            t.idVerified === true &&
              typeof t.accountAgeDays === 'number' &&
              t.accountAgeDays >= 2 &&
              !(publicUser.state === 'ok' && publicUser.isBanned),
            'likely-eligible only with a confirmed age check, ≥2-day account, and no known ban',
            combo,
          )
        }
      }
    }
  }

  ok(sweepFailures.length === 0, `sweep clean (${sweepFailures.length} violations; first: ${sweepFailures[0] ?? '—'})`)
  process.stdout.write(`  swept ${swept} source combinations\n`)
}

// --- 6. fetchers: request construction, parsing, caching -------------------------

section('fetchers against a mocked fetch')
const realFetch = globalThis.fetch
try {
  const calls = []
  const respond = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })
  let nextResponse = respond(200, {})
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return nextResponse
  }

  // public users API — the live shape from users.roblox.com/v1/users/156.
  nextResponse = respond(200, {
    description: '',
    created: '2006-03-08T17:17:52.9Z',
    isBanned: false,
    id: 9999001,
    name: 'builderman',
    displayName: 'builderman',
  })
  const pub = await fetchPublicUser('9999001')
  eq(calls.at(-1).url, 'https://users.roblox.com/v1/users/9999001', 'public URL built correctly')
  eq(pub, { created: '2006-03-08T17:17:52.9Z', isBanned: false }, 'public facts parsed')
  const callsBefore = calls.length
  await fetchPublicUser('9999001')
  eq(calls.length, callsBefore, 'second public lookup served from cache')

  // public error → Roblox's message verbatim.
  nextResponse = respond(404, { errors: [{ code: 3, message: 'The user id is invalid.' }] })
  let threw = null
  try {
    await fetchPublicUser('9999002')
  } catch (err) {
    threw = err
  }
  ok(threw && threw.name === 'RobloxError', 'public failure throws RobloxError')
  eq(threw?.message, 'The user id is invalid.', "Roblox's message verbatim")
  eq(threw?.status, 404, 'real HTTP status carried')

  // cloud v2 — bearer token, field mapping, absent flags stay unknown.
  nextResponse = respond(200, {
    path: 'users/9999003',
    createTime: '2020-01-02T03:04:05.000Z',
    id: '9999003',
    name: 'tester',
    premium: true,
    idVerified: false,
  })
  const cloud = await fetchCloudUser('9999003', 'tok-abc')
  eq(calls.at(-1).url, 'https://apis.roblox.com/cloud/v2/users/9999003', 'cloud URL built correctly')
  eq(calls.at(-1).init.headers, { Authorization: 'Bearer tok-abc' }, 'bearer auth, no api key, no cookies')
  eq(cloud, { createTime: '2020-01-02T03:04:05.000Z', premium: true, idVerified: false }, 'cloud facts parsed')
  const cloudCallsBefore = calls.length
  await fetchCloudUser('9999003', 'tok-abc')
  eq(calls.length, cloudCallsBefore, 'second cloud lookup served from cache (10 req/min budget)')

  nextResponse = respond(200, { path: 'users/9999004', name: 'flagless' })
  const flagless = await fetchCloudUser('9999004', 'tok-abc')
  eq(flagless, { createTime: null, premium: 'unknown', idVerified: 'unknown' }, 'absent flags stay unknown, never default')
} finally {
  globalThis.fetch = realFetch
}

// --- 7. consent request construction ---------------------------------------------

section('oauth consent request')
{
  ok(ROBLOX_OAUTH_SCOPES.includes('user.advanced:read'), 'user.advanced:read is a requested scope')
  const url = new URL(
    authorizeUrl({
      clientId: 'cid',
      redirectUri: 'http://localhost:3000/api/roblox/oauth/callback',
      state: 'st',
      challenge: 'ch',
    }),
  )
  eq(url.origin + url.pathname, 'https://apis.roblox.com/oauth/v1/authorize', 'authorize endpoint')
  eq(url.searchParams.get('scope'), ROBLOX_OAUTH_SCOPES.join(' '), 'scope param carries the full list')
  ok(url.searchParams.get('scope').includes('user.advanced:read'), 'consent asks for user.advanced:read')
  eq(url.searchParams.get('response_type'), 'code', 'authorization-code flow')
  eq(url.searchParams.get('code_challenge_method'), 'S256', 'PKCE S256')

  ok(hasAdvancedScope('openid profile asset:read asset:write user.advanced:read'), 'space-separated grant detected')
  ok(hasAdvancedScope('openid,profile,user.advanced:read'), 'comma-separated grant detected')
  ok(!hasAdvancedScope('openid profile asset:read asset:write'), 'pre-existing connections read as not granted')
}

// --- report ------------------------------------------------------------------

process.stdout.write(`\n${checks - failures.length}/${checks} checks passed\n`)
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
  process.exit(1)
}
process.stdout.write('eligibility test: OK\n')
