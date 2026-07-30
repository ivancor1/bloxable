// Open Cloud Assets API — uploading a built model into a user's own account.
// Server-only.
//
// Verified end to end against the live API on 2026-07-29 with a Rojo-built
// .rbxm: POST /assets/v1/assets returns an operation, polling
// /assets/v1/operations/{id} returns the asset with moderationState Approved and
// state Active. The same call takes an OAuth Bearer token (scopes asset:read +
// asset:write) instead of x-api-key, which is what makes this compliant for
// other people's accounts.
//
// CREATE ONLY, deliberately. Roblox's own guide says of the update endpoint:
// "Currently, you can only update the asset content for .fbx files." A .rbxm
// PATCH is the exact failure reported in
// https://devforum.roblox.com/t/api-rejecting-valid-rbxmrbxmx-models/4628429 —
// so every eject mints a NEW model rather than a new revision of an old one.

import { RobloxError } from './discover'

const ASSETS_URL = 'https://apis.roblox.com/assets/v1/assets'
const OPERATIONS_URL = 'https://apis.roblox.com/assets/v1/operations'

const UPLOAD_TIMEOUT_MS = 120_000
const POLL_TIMEOUT_MS = 20_000
/** Moderation is asynchronous; this is how long we wait for the operation. */
const POLL_BUDGET_MS = 90_000
const POLL_INTERVAL_MS = 2_000

interface ErrorEnvelope {
  errors?: { code?: number; message?: string }[]
  message?: string
  error?: string
}

interface OperationEnvelope {
  done?: boolean
  operationId?: string
  path?: string
  error?: { message?: string; code?: number }
  response?: {
    assetId?: string
    revisionId?: string
    displayName?: string
    moderationResult?: { moderationState?: string }
    state?: string
  }
  errors?: { code?: number; message?: string }[]
}

/** Roblox's message, verbatim, whatever envelope shape it arrived in. */
function robloxMessage(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as ErrorEnvelope
    if (Array.isArray(parsed.errors) && parsed.errors[0]?.message) return parsed.errors[0].message
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error
  } catch {
    // not JSON
  }
  return null
}

/** MODERATION_STATE_APPROVED and Approved are both live shapes; normalize. */
function normalizeModeration(state: string | undefined): string | undefined {
  if (!state) return undefined
  return state.replace(/^MODERATION_STATE_/, '')
}

export interface UploadedAsset {
  assetId: string
  revisionId?: string
  moderationState?: string
  /** Roblox's own state field, e.g. "Active". */
  state?: string
}

/**
 * Roblox accepted the upload but was still processing it when the poll budget
 * ran out. NOT a failure: the model almost always lands in the inventory a
 * moment later, so the caller must report "still processing", never "failed".
 */
export interface PendingUpload {
  pending: true
  operationId: string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Uploads a .rbxm as a new Model asset owned by `userId`, then waits for the
 * operation to finish so the caller can report a real assetId (and moderation
 * result) instead of an operation id nobody can use. Resolves to PendingUpload
 * when Roblox is still processing after the poll budget.
 */
export async function uploadModelAsset(args: {
  accessToken: string
  userId: string
  fileBytes: Uint8Array
  displayName: string
  description: string
}): Promise<UploadedAsset | PendingUpload> {
  const form = new FormData()
  form.append(
    'request',
    JSON.stringify({
      assetType: 'Model',
      displayName: args.displayName,
      description: args.description,
      creationContext: { creator: { userId: args.userId } },
    }),
  )
  form.append(
    'fileContent',
    new Blob([new Uint8Array(args.fileBytes)], { type: 'model/x-rbxm' }),
    'model.rbxm',
  )

  let res: Response
  try {
    res = await fetch(ASSETS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.accessToken}` },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new RobloxError(
      timedOut
        ? 'Roblox upload timed out after 2 minutes.'
        : `Roblox upload failed: ${err instanceof Error ? err.message : String(err)}`,
      timedOut ? 504 : 502,
    )
  }

  const text = await res.text()
  if (!res.ok) {
    throw new RobloxError(robloxMessage(text) ?? text ?? `Roblox upload failed (${res.status})`, res.status)
  }

  let started: OperationEnvelope
  try {
    started = JSON.parse(text) as OperationEnvelope
  } catch {
    throw new RobloxError(`Unexpected response from Roblox: ${text.slice(0, 300)}`, 502)
  }

  const operationId = started.operationId ?? started.path?.split('/').pop()
  if (!operationId) {
    throw new RobloxError(`Roblox did not return an operation id: ${text.slice(0, 300)}`, 502)
  }

  return waitForOperation(args.accessToken, operationId)
}

/**
 * Polls one asset operation to completion. A freshly created operation can
 * answer with an empty error envelope for a second or two before it exists —
 * observed live — so that shape is a retry, not a failure. When the budget
 * runs out with the operation still running, that is reported as a
 * PendingUpload — the upload was accepted and usually finishes on Roblox's
 * side; pretending it failed would just push the user into uploading twice.
 */
export async function waitForOperation(
  accessToken: string,
  operationId: string,
): Promise<UploadedAsset | PendingUpload> {
  const deadline = Date.now() + POLL_BUDGET_MS
  let lastText = ''

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)

    let res: Response
    try {
      res = await fetch(`${OPERATIONS_URL}/${encodeURIComponent(operationId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      })
    } catch {
      continue // transient — keep polling until the budget runs out
    }

    lastText = await res.text()
    if (!res.ok) continue

    let op: OperationEnvelope
    try {
      op = JSON.parse(lastText) as OperationEnvelope
    } catch {
      continue
    }

    if (op.error?.message) throw new RobloxError(op.error.message, 502)
    if (!op.done) continue

    const assetId = op.response?.assetId
    if (!assetId) {
      throw new RobloxError(
        robloxMessage(lastText) ?? `Roblox finished the upload without an asset id: ${lastText.slice(0, 300)}`,
        502,
      )
    }

    return {
      assetId,
      revisionId: op.response?.revisionId,
      moderationState: normalizeModeration(op.response?.moderationResult?.moderationState),
      state: op.response?.state,
    }
  }

  return { pending: true, operationId }
}

/** Where the user actually finds the model afterwards. */
export function assetUrl(assetId: string): string {
  return `https://create.roblox.com/store/asset/${assetId}`
}
