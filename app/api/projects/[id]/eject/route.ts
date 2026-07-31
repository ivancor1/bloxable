import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import { buildModel } from '@/lib/rbx/build'
import { getProject, getRobloxAccount, updateProject } from '@/lib/store'
import { getAccessToken } from '@/lib/roblox/oauth'
import { assetUrl, uploadModelAsset } from '@/lib/roblox/assets'
import { RobloxError } from '@/lib/roblox/discover'
import { ASSET_SIZE_LIMIT } from '@/lib/config'
import { ejectErrorCodeForStatus, type EjectErrorCode } from '@/lib/roblox/eject-status'
import { errorResponse } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Roblox rejects asset display names past 50 characters. */
const MAX_DISPLAY_NAME = 50

const TOO_LARGE_MESSAGE = 'Too large for a Roblox model upload (20 MiB) — export instead.'

/**
 * Every eject failure carries a stable `code` assigned HERE, where the route
 * still knows why it failed — a missing connection and a Roblox-rejected token
 * both surface as auth errors otherwise. The UI maps codes to plain language
 * (lib/roblox/eject-status.ts) and shows `error` verbatim as the detail.
 */
function fail(message: string, status: number, code: EjectErrorCode): NextResponse {
  return NextResponse.json({ error: message, code }, { status })
}

/**
 * Eject: build the project as a Model and upload it into the USER'S OWN Roblox
 * account over their OAuth token. They then insert it from the Toolbox
 * (Inventory → My Models) and publish it themselves, which is the step that
 * makes the game theirs — Roblox has no API that publishes a place on someone
 * else's behalf (RESEARCH.md Part 1 Q3b).
 *
 * Every eject creates a NEW model. Roblox's Assets guide states that content
 * updates are .fbx-only, and .rbxm PATCHes are exactly what the May 2026 report
 * at devforum.roblox.com/t/api-rejecting-valid-rbxmrbxmx-models/4628429
 * describes failing, so re-uploading is not dressed up as a revision.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let meta
  try {
    meta = await getProject(id)
  } catch (err) {
    return errorResponse(err)
  }

  const account = await getRobloxAccount()
  if (!account) {
    return fail('Connect your Roblox account first — Settings → Your Roblox account.', 401, 'not_connected')
  }
  if (!account.scope.includes('asset:write')) {
    return fail(
      'Your Roblox connection is missing the asset:write permission — disconnect and connect again to grant it.',
      403,
      'missing_upload_permission',
    )
  }

  let token: string
  try {
    ;({ token } = await getAccessToken())
  } catch (err) {
    if (err instanceof RobloxError) {
      // getAccessToken throws exactly two ways: the server has no OAuth app
      // (500) or the sign-in could not be refreshed (401 — connection cleared).
      return fail(err.message, err.status, err.status === 500 ? 'not_configured' : 'signin_expired')
    }
    return errorResponse(err)
  }

  let built
  try {
    built = await buildModel(id)
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Model build failed', 500, 'build_failed')
  }

  if (built.bytes > ASSET_SIZE_LIMIT) {
    return fail(TOO_LARGE_MESSAGE, 413, 'too_large')
  }

  const fileBytes = await fs.readFile(built.filePath)

  let uploaded
  try {
    uploaded = await uploadModelAsset({
      accessToken: token,
      userId: account.userId,
      fileBytes,
      displayName: meta.name.slice(0, MAX_DISPLAY_NAME),
      description: `${meta.name} — built with Bloxable.`,
    })
  } catch (err) {
    if (err instanceof RobloxError) return fail(err.message, err.status, ejectErrorCodeForStatus(err.status))
    return errorResponse(err)
  }

  if ('pending' in uploaded) {
    // Roblox accepted the upload but was still processing at the poll budget.
    // Honest 202: no assetId yet, so nothing is stamped on the project and the
    // UI says "still processing", never "done" and never "failed".
    return NextResponse.json(
      {
        pending: true,
        operationId: uploaded.operationId,
        account: { userId: account.userId, username: account.username ?? null },
        bytes: built.bytes,
        serviceFolders: built.serviceFolders,
        droppedInstances: built.droppedInstances,
        servicesWithProperties: built.servicesWithProperties,
      },
      { status: 202 },
    )
  }

  let updatedMeta = meta
  try {
    updatedMeta = await updateProject(id, {
      lastEject: {
        assetId: uploaded.assetId,
        at: new Date().toISOString(),
        moderationState: uploaded.moderationState,
      },
    })
  } catch {
    // The upload landed; a failed meta stamp must not fail the request.
  }

  return NextResponse.json({
    assetId: uploaded.assetId,
    revisionId: uploaded.revisionId ?? null,
    moderationState: uploaded.moderationState ?? null,
    state: uploaded.state ?? null,
    assetUrl: assetUrl(uploaded.assetId),
    account: { userId: account.userId, username: account.username ?? null },
    bytes: built.bytes,
    // What the user has to know to finish the job in Studio, straight from the
    // projection — never guessed at in the UI.
    serviceFolders: built.serviceFolders,
    droppedInstances: built.droppedInstances,
    servicesWithProperties: built.servicesWithProperties,
    meta: updatedMeta,
  })
}
