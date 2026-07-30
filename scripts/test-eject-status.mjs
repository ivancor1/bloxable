#!/usr/bin/env node
// Pins the eject response-state mapping (lib/roblox/eject-status.ts): every
// failure code has real copy with a concrete next step, statuses classify the
// way the live API behaved, and outcomeFromEjectResponse turns actual observed
// wire shapes — including the ones captured against the running dev server and
// apis.roblox.com on 2026-07-30 — into the right modal state. Success is never
// fabricated from a status code alone.
//
// Same TS-resolve hook as test-engine.mjs: Node strips types but wants
// extensions on relative specifiers.

import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier, context.parentURL)
      if (!/\.[a-z]+$/i.test(url.pathname)) {
        for (const ext of ['.ts', '/index.ts']) {
          if (existsSync(fileURLToPath(url) + ext)) return nextResolve(specifier + ext, context)
        }
      }
    }
    return nextResolve(specifier, context)
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
  if (actual !== expected) failures.push(`${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`)
}

function section(title) {
  process.stdout.write(`\n— ${title}\n`)
}

const {
  EJECT_ERROR_CODES,
  describeModeration,
  ejectErrorCodeForStatus,
  ejectFailureCopy,
  isEjectErrorCode,
  networkFailureOutcome,
  outcomeFromEjectResponse,
} = await import('../lib/roblox/eject-status.ts')

// --- failure copy ------------------------------------------------------------

section('failure copy')
ok(EJECT_ERROR_CODES.length >= 10, `expected a full code set, got ${EJECT_ERROR_CODES.length}`)
for (const code of EJECT_ERROR_CODES) {
  const copy = ejectFailureCopy(code)
  ok(copy.title.length > 0, `${code}: empty title`)
  ok(copy.body.length > 0, `${code}: empty body`)
  ok(copy.action.length > 0, `${code}: empty action`)
  eq(typeof copy.settings, 'boolean', `${code}: settings flag`)
  // Copy tone: failures are never pinned on the user.
  for (const text of [copy.title, copy.body, copy.action]) {
    ok(!/your (fault|mistake|error)/i.test(text), `${code}: copy blames the user: ${text}`)
  }
}
// The connection-shaped failures must send the user to Settings.
for (const code of ['not_connected', 'signin_expired', 'missing_upload_permission', 'not_configured']) {
  ok(ejectFailureCopy(code).settings === true, `${code} should point at Settings`)
}
ok(isEjectErrorCode('rate_limited'), 'rate_limited is a known code')
ok(!isEjectErrorCode('nonsense'), 'unknown strings are not codes')
ok(!isEjectErrorCode(7), 'numbers are not codes')

// --- status classification ---------------------------------------------------

section('status classification')
// 401 observed live: Roblox rejects a dead Bearer token with
// {"errors":[{"code":0,"message":"Failed to read token."}]} — a new sign-in fixes it.
eq(ejectErrorCodeForStatus(401), 'signin_expired', '401 → signin_expired')
eq(ejectErrorCodeForStatus(403), 'roblox_denied', '403 → roblox_denied')
eq(ejectErrorCodeForStatus(413), 'too_large', '413 → too_large')
eq(ejectErrorCodeForStatus(429), 'rate_limited', '429 → rate_limited')
eq(ejectErrorCodeForStatus(502), 'roblox_unavailable', '502 → roblox_unavailable')
eq(ejectErrorCodeForStatus(504), 'timeout', '504 → timeout')
eq(ejectErrorCodeForStatus(500), 'unexpected', '500 without a code → unexpected')
eq(ejectErrorCodeForStatus(418), 'unexpected', 'unknown status → unexpected')

// --- moderation --------------------------------------------------------------

section('moderation')
// Both bare and MODERATION_STATE_-prefixed forms are live shapes (assets.ts).
eq(describeModeration('Approved').verdict, 'approved', 'Approved')
eq(describeModeration('MODERATION_STATE_APPROVED').verdict, 'approved', 'prefixed Approved')
eq(describeModeration('MODERATION_STATE_APPROVED').label, 'APPROVED', 'prefix stripped')
eq(describeModeration('Reviewing').verdict, 'reviewing', 'Reviewing')
eq(describeModeration('Rejected').verdict, 'rejected', 'Rejected')
eq(describeModeration('MODERATION_STATE_REJECTED').verdict, 'rejected', 'prefixed Rejected')
eq(describeModeration(null).verdict, 'unknown', 'null state')
eq(describeModeration(null).label, null, 'null state has no label')
eq(describeModeration('SomethingNew').verdict, 'unknown', 'unrecognized state stays unknown')
eq(describeModeration('SomethingNew').label, 'SomethingNew', 'unrecognized state keeps its label')

// --- outcome mapping ---------------------------------------------------------

section('outcome mapping')

// Shape of the real, proven upload (assetId 87162101590552, Approved/Active).
const success = outcomeFromEjectResponse(
  200,
  {
    assetId: '87162101590552',
    assetUrl: 'https://create.roblox.com/store/asset/87162101590552',
    moderationState: 'Approved',
    state: 'Active',
    account: { userId: '11379911478', username: 'Fuegovan1' },
    serviceFolders: ['ServerScriptService', 'StarterGui'],
    droppedInstances: [],
    servicesWithProperties: ['Lighting'],
    meta: {},
  },
  'My Game',
)
eq(success.kind, 'uploaded', 'real success shape → uploaded')
eq(success.assetId, '87162101590552', 'assetId carried')
eq(success.assetUrl, 'https://create.roblox.com/store/asset/87162101590552', 'assetUrl carried')
eq(success.moderation.verdict, 'approved', 'moderation mapped')
eq(success.username, 'Fuegovan1', 'username carried')
eq(success.serviceFolders.length, 2, 'service folders carried')

const noUrl = outcomeFromEjectResponse(200, { assetId: '123' }, 'G')
eq(noUrl.kind, 'uploaded', 'assetId without url still uploads')
eq(noUrl.assetUrl, 'https://create.roblox.com/store/asset/123', 'assetUrl built from assetId')

// 202 pending — Roblox accepted the upload but was still processing.
const pending = outcomeFromEjectResponse(
  202,
  {
    pending: true,
    operationId: 'op-abc',
    account: { userId: '11379911478', username: 'Fuegovan1' },
    serviceFolders: ['StarterGui'],
  },
  'My Game',
)
eq(pending.kind, 'processing', '202 pending → processing')
eq(pending.operationId, 'op-abc', 'operationId carried')
eq(pending.username, 'Fuegovan1', 'pending username carried')

// Captured live 2026-07-30: eject with no connected account.
const notConnected = outcomeFromEjectResponse(
  401,
  { error: 'Connect your Roblox account first — Settings → Your Roblox account.', code: 'not_connected' },
  'My Game',
)
eq(notConnected.kind, 'failed', 'not connected → failed')
eq(notConnected.code, 'not_connected', 'route code wins over status fallback')
ok(notConnected.detail.includes('Connect your Roblox account'), 'server message kept verbatim as detail')

// Captured live 2026-07-30: expired sign-in with no OAuth app on the server.
const notConfigured = outcomeFromEjectResponse(
  500,
  { error: 'Roblox sign-in is not configured on this server.', code: 'not_configured' },
  'My Game',
)
eq(notConfigured.code, 'not_configured', '500 with explicit code stays not_configured')

// Captured live 2026-07-30: Roblox itself rejecting a dead token (verbatim
// message forwarded by the route, classified by status).
const deadToken = outcomeFromEjectResponse(401, { error: 'Failed to read token.' }, 'My Game')
eq(deadToken.kind, 'failed', 'Roblox 401 → failed')
eq(deadToken.code, 'signin_expired', 'Roblox 401 without code → signin_expired')
eq(deadToken.detail, 'Failed to read token.', 'Roblox message verbatim')

// A 2xx without an assetId must never be dressed up as success.
const emptySuccess = outcomeFromEjectResponse(200, { meta: {} }, 'My Game')
eq(emptySuccess.kind, 'failed', '200 without assetId → failed, never fake success')

// Bodies that are not JSON records at all.
eq(outcomeFromEjectResponse(502, null, 'G').kind, 'failed', 'null body → failed')
eq(outcomeFromEjectResponse(502, null, 'G').code, 'roblox_unavailable', 'null body classified by status')
eq(outcomeFromEjectResponse(502, null, 'G').detail, null, 'no message → null detail, not an invented one')

// The fetch itself throwing — request never left the browser.
const network = networkFailureOutcome('My Game')
eq(network.kind, 'failed', 'network failure is a failure')
eq(network.code, 'network', 'network code')
eq(network.projectName, 'My Game', 'project name carried')

// --- report ------------------------------------------------------------------

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} of ${checks} checks failed:\n`)
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n`)
  process.exit(1)
}
process.stdout.write(`\n${checks} checks passed\n`)
