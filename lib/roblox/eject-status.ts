// Eject outcome model — pure and client-safe. Imported by the eject route (to
// label failures), the eject modal (to speak plainly about them) and
// scripts/test-eject-status.mjs (to pin the mapping down).
//
// The route stamps every failure with a stable `code` at the throw site, where
// it still knows WHY — a missing connection, a dead sign-in and a Roblox 401
// all look like "auth failed" by the time they reach the browser otherwise.
// The server's message always rides along verbatim as `detail`, because
// Roblox's own words are the honest part of any error.
//
// Live failure shapes these codes were verified against (2026-07-30, local dev
// server + apis.roblox.com):
//   - no connection      → 401 {"error":"Connect your Roblox account first — …"}
//   - dead token at Roblox → 401 {"errors":[{"code":0,"message":"Failed to read token."}]}
//   - expired + no OAuth app → 500 {"error":"Roblox sign-in is not configured on this server."}

export type EjectErrorCode =
  | 'not_connected'
  | 'signin_expired'
  | 'not_configured'
  | 'missing_upload_permission'
  | 'roblox_denied'
  | 'rate_limited'
  | 'too_large'
  | 'build_failed'
  | 'roblox_unavailable'
  | 'timeout'
  | 'network'
  | 'unexpected'

export interface EjectFailureCopy {
  title: string
  body: string
  action: string
  /** True when the concrete next step lives in Settings (connect / reconnect). */
  settings: boolean
}

/**
 * Plain language, one concrete next action each, and never the user's fault.
 * Roblox's verbatim message is shown separately as `detail` — this copy is the
 * translation, not a replacement for it.
 */
const FAILURE_COPY: Record<EjectErrorCode, EjectFailureCopy> = {
  not_connected: {
    title: 'Connect your Roblox account first',
    body: 'Sending a game puts a model into your own Roblox inventory, so Bloxable needs you signed in to Roblox.',
    action: 'Open Settings, hit Connect Roblox account, then send again.',
    settings: true,
  },
  signin_expired: {
    title: 'Your Roblox sign-in ran out',
    body: 'Roblox sign-ins expire after a while for safety — your game and your account are fine.',
    action: 'Open Settings, connect your Roblox account again, then send again.',
    settings: true,
  },
  not_configured: {
    title: 'Roblox sign-in is not set up on this server',
    body: 'This app is missing its own Roblox sign-in keys, so nobody can connect an account yet.',
    action:
      'Add ROBLOX_OAUTH_CLIENT_ID and ROBLOX_OAUTH_CLIENT_SECRET to .env.local (the README shows how), restart, then connect in Settings.',
    settings: true,
  },
  missing_upload_permission: {
    title: 'Roblox needs one more permission',
    body: 'You are signed in, but the connection never granted upload permission, so Roblox will not take the model.',
    action:
      'Open Settings, disconnect, and connect again — say yes when Roblox asks about creating and managing your assets.',
    settings: true,
  },
  roblox_denied: {
    title: 'Roblox turned the upload down',
    body: 'Roblox refused this request — its exact words are below.',
    action: 'If it mentions permissions, reconnect your account in Settings. Otherwise wait a minute and try again.',
    settings: true,
  },
  rate_limited: {
    title: 'Roblox asked us to slow down',
    body: 'Too many uploads landed in a short time. Nothing is broken and nothing was lost.',
    action: 'Wait a minute or two, then hit Send to Roblox again.',
    settings: false,
  },
  too_large: {
    title: 'This game is too big to send as a model',
    body: 'Roblox caps model uploads at 20 MB, and this build is over the line.',
    action: 'Slim down the heaviest parts and send again — or use Export to carry the full place file over yourself.',
    settings: false,
  },
  build_failed: {
    title: 'The game did not finish packing',
    body: 'Turning this project into a Roblox model file hit a snag on our side — not something you did.',
    action: 'Try again. If it keeps happening, the details below say exactly where it stopped.',
    settings: false,
  },
  roblox_unavailable: {
    title: 'Could not reach Roblox',
    body: 'The upload never made it through — Roblox may be having trouble, or the connection dropped.',
    action: 'Check your internet, give it a minute, and try again.',
    settings: false,
  },
  timeout: {
    title: 'Roblox took too long to answer',
    body: 'The upload may still finish on Roblox’s side even though this window stopped waiting.',
    action:
      'Wait a few minutes and check Studio → Toolbox → Inventory → My Models before sending again — a second send makes a second model.',
    settings: false,
  },
  network: {
    title: 'Could not reach the Bloxable server',
    body: 'The request never got an answer — the app may have stopped, or the connection hiccuped.',
    action: 'Check that the app is still running, then try again.',
    settings: false,
  },
  unexpected: {
    title: 'That did not work, and we are not sure why',
    body: 'The upload stopped for a reason we did not expect. The exact message is below, word for word.',
    action: 'Try again once. If it fails the same way, the message below is the clue that matters.',
    settings: false,
  },
}

export function ejectFailureCopy(code: EjectErrorCode): EjectFailureCopy {
  return FAILURE_COPY[code]
}

export const EJECT_ERROR_CODES = Object.keys(FAILURE_COPY) as EjectErrorCode[]

export function isEjectErrorCode(value: unknown): value is EjectErrorCode {
  return typeof value === 'string' && value in FAILURE_COPY
}

/**
 * Status-only fallback, used for upload-stage Roblox errors (where the status
 * is all the context there is) and for responses that carry no `code` at all.
 * 401 here means Roblox itself rejected the Bearer token — observed live as
 * {"errors":[{"code":0,"message":"Failed to read token."}]} — which a fresh
 * sign-in fixes, hence `signin_expired`.
 */
export function ejectErrorCodeForStatus(status: number): EjectErrorCode {
  switch (status) {
    case 401:
      return 'signin_expired'
    case 403:
      return 'roblox_denied'
    case 413:
      return 'too_large'
    case 429:
      return 'rate_limited'
    case 502:
      return 'roblox_unavailable'
    case 504:
      return 'timeout'
    default:
      return 'unexpected'
  }
}

// --- moderation --------------------------------------------------------------

export type ModerationVerdict = 'approved' | 'reviewing' | 'rejected' | 'unknown'

export interface Moderation {
  verdict: ModerationVerdict
  /** Roblox's state, prefix-stripped, e.g. "Approved" — null when absent. */
  label: string | null
}

/** Both "Approved" and "MODERATION_STATE_APPROVED" are live shapes. */
export function describeModeration(state: string | null | undefined): Moderation {
  if (!state) return { verdict: 'unknown', label: null }
  const label = state.replace(/^MODERATION_STATE_/, '')
  switch (label.toLowerCase()) {
    case 'approved':
      return { verdict: 'approved', label }
    case 'reviewing':
      return { verdict: 'reviewing', label }
    case 'rejected':
      return { verdict: 'rejected', label }
    default:
      return { verdict: 'unknown', label }
  }
}

// --- outcome -----------------------------------------------------------------

export interface EjectUploaded {
  kind: 'uploaded'
  projectName: string
  assetId: string
  /** create.roblox.com/store/asset/<id> — the page the model actually lives at. */
  assetUrl: string
  moderation: Moderation
  /** Roblox username the model was uploaded to, when the server knew it. */
  username: string | null
  serviceFolders: string[]
  droppedInstances: string[]
  servicesWithProperties: string[]
}

export interface EjectProcessing {
  kind: 'processing'
  projectName: string
  username: string | null
  operationId: string | null
  serviceFolders: string[]
}

export interface EjectFailed {
  kind: 'failed'
  projectName: string
  code: EjectErrorCode
  /** The server's / Roblox's message, verbatim — shown small, never hidden. */
  detail: string | null
}

export type EjectOutcome = EjectUploaded | EjectProcessing | EjectFailed

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function usernameOf(body: Record<string, unknown>): string | null {
  const account = body.account
  return isRecord(account) && typeof account.username === 'string' ? account.username : null
}

/**
 * Maps one eject response (status + parsed body) to the single outcome the
 * modal renders. A 2xx without an assetId is still a failure — success is never
 * fabricated from a status code alone.
 */
export function outcomeFromEjectResponse(status: number, body: unknown, projectName: string): EjectOutcome {
  const rec = isRecord(body) ? body : {}

  if (status === 202 && rec.pending === true) {
    return {
      kind: 'processing',
      projectName,
      username: usernameOf(rec),
      operationId: typeof rec.operationId === 'string' ? rec.operationId : null,
      serviceFolders: strArray(rec.serviceFolders),
    }
  }

  if (status >= 200 && status < 300 && typeof rec.assetId === 'string' && rec.assetId) {
    return {
      kind: 'uploaded',
      projectName,
      assetId: rec.assetId,
      assetUrl:
        typeof rec.assetUrl === 'string' && rec.assetUrl
          ? rec.assetUrl
          : `https://create.roblox.com/store/asset/${rec.assetId}`,
      moderation: describeModeration(typeof rec.moderationState === 'string' ? rec.moderationState : null),
      username: usernameOf(rec),
      serviceFolders: strArray(rec.serviceFolders),
      droppedInstances: strArray(rec.droppedInstances),
      servicesWithProperties: strArray(rec.servicesWithProperties),
    }
  }

  const detail =
    typeof rec.error === 'string' && rec.error
      ? rec.error
      : typeof rec.message === 'string' && rec.message
        ? rec.message
        : null
  return {
    kind: 'failed',
    projectName,
    code: isEjectErrorCode(rec.code) ? rec.code : ejectErrorCodeForStatus(status),
    detail,
  }
}

/** The fetch itself threw — the request never reached the eject route. */
export function networkFailureOutcome(projectName: string): EjectFailed {
  return { kind: 'failed', projectName, code: 'network', detail: null }
}
