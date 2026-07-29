import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import { buildModel } from '@/lib/rbx/build'
import { getProject, getRobloxAccount, updateProject } from '@/lib/store'
import { getAccessToken } from '@/lib/roblox/oauth'
import { assetUrl, uploadModelAsset } from '@/lib/roblox/assets'
import { RobloxError } from '@/lib/roblox/discover'
import { ASSET_SIZE_LIMIT } from '@/lib/config'
import { errorResponse, jsonError } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Roblox rejects asset display names past 50 characters. */
const MAX_DISPLAY_NAME = 50

const TOO_LARGE_MESSAGE = 'Too large for a Roblox model upload (20 MiB) — export instead.'

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
    return jsonError('Connect your Roblox account first — Settings → Your Roblox account.', 401)
  }
  if (!account.scope.includes('asset:write')) {
    return jsonError(
      'Your Roblox connection is missing the asset:write permission — disconnect and connect again to grant it.',
      403,
    )
  }

  let token: string
  try {
    ;({ token } = await getAccessToken())
  } catch (err) {
    if (err instanceof RobloxError) return jsonError(err.message, err.status)
    return errorResponse(err)
  }

  let built
  try {
    built = await buildModel(id)
  } catch (err) {
    return errorResponse(err)
  }

  if (built.bytes > ASSET_SIZE_LIMIT) {
    return jsonError(TOO_LARGE_MESSAGE, 413)
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
    if (err instanceof RobloxError) return jsonError(err.message, err.status)
    return errorResponse(err)
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
