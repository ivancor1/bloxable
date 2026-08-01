import { NextRequest, NextResponse } from 'next/server'
import { getProject, getRobloxAccount, getStudioUser, updateProject } from '@/lib/store'
import {
  fetchUserGames,
  matchPublishedGame,
  parsePlaceIdInput,
  shareLink,
  verifyPlace,
} from '@/lib/roblox/published'
import { RobloxError } from '@/lib/roblox/discover'
import { errorResponse, jsonError } from '@/app/api/_lib/http'
import { safeFilename } from '@/app/api/_lib/filename'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The user's OWN published game — the last leg of prompt → link.
 *
 * GET   returns what is already known (stamped userPlace or found:false).
 * POST  one honest look at the public games API: does an experience named
 *       like this project, newer than the last eject, exist on the user's
 *       account? Public games only — Roblox's list shows nothing private,
 *       which the response says out loud instead of pretending to search.
 * PUT   the paste-once fallback: takes a link or place id, VERIFIES it
 *       against Roblox's public endpoints (place → universe → creator), and
 *       refuses ids Roblox does not know. A creator mismatch with the
 *       connected account is reported, not silently accepted.
 *
 * Free path, deliberately: every endpoint here works without the operator
 * key and without any paid step — this is the conversion event.
 */

/** The user id we can honestly attribute a publish to: OAuth first, then the
 * Studio helper's report (0 means signed out and is never used). */
async function knownUserId(): Promise<string | null> {
  const account = await getRobloxAccount()
  if (account?.userId) return account.userId
  const studio = await getStudioUser()
  if (studio && studio.userId > 0) return String(studio.userId)
  return null
}

function placeResponse(meta: { userPlace?: { placeId: string; universeId: string; at: string; source: string } }) {
  if (!meta.userPlace) return null
  return { ...meta.userPlace, shareUrl: shareLink(meta.userPlace.placeId) }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const meta = await getProject(id)
    const place = placeResponse(meta)
    return NextResponse.json(place ? { found: true, place } : { found: false })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let meta
  try {
    meta = await getProject(id)
  } catch (err) {
    return errorResponse(err)
  }

  // Already found once — a stamp is stable, no need to search again.
  const existing = placeResponse(meta)
  if (existing) return NextResponse.json({ found: true, place: existing })

  const userId = await knownUserId()
  if (!userId) {
    return NextResponse.json({
      found: false,
      reason: 'no-user',
      detail:
        'No Roblox account is connected and Studio has not reported a signed-in user, so there is no account to search.',
    })
  }

  // Anything published for this project happened after the last eject (or
  // failing that, after the project last changed) — minus generous slack.
  const since = meta.lastEject?.at ?? meta.updatedAt

  let games
  try {
    games = await fetchUserGames(userId)
  } catch (err) {
    if (err instanceof RobloxError) return jsonError(err.message, err.status)
    return errorResponse(err)
  }

  const match = matchPublishedGame(games, {
    acceptableNames: [meta.name, safeFilename(meta.name)],
    since,
  })

  if (!match) {
    return NextResponse.json({
      found: false,
      reason: 'not-listed',
      checked: { userId, gamesSeen: games.length, since },
      detail:
        'Roblox lists no public experience with this name on your account yet. That usually means one of: you have not hit File → Publish in Studio yet; the game is still private (Game Settings → Permissions → Public); or it was published under a different name.',
    })
  }

  let updated = meta
  try {
    updated = await updateProject(id, {
      userPlace: {
        placeId: match.rootPlaceId,
        universeId: match.universeId,
        at: new Date().toISOString(),
        source: 'games-api',
      },
    })
  } catch {
    // The find is real even if the stamp failed; the response still carries it.
  }

  return NextResponse.json({ found: true, place: placeResponse(updated) ?? undefined, meta: updated })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: { link?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonError('Body must be JSON.', 400)
  }
  if (typeof body.link !== 'string' || !body.link.trim()) {
    return jsonError('Send { link }: your game link or place id.', 400)
  }

  const placeId = parsePlaceIdInput(body.link)
  if (!placeId) {
    return jsonError(
      'That does not look like a Roblox game link. Paste the game page link (roblox.com/games/…) or the place id number.',
      422,
    )
  }

  let meta
  try {
    meta = await getProject(id)
  } catch (err) {
    return errorResponse(err)
  }

  let verified
  try {
    verified = await verifyPlace(placeId)
  } catch (err) {
    if (err instanceof RobloxError) return jsonError(err.message, err.status)
    return errorResponse(err)
  }

  // If we know who the user is, a creator mismatch is worth stopping on —
  // pasting someone else's game would make every later claim about "your
  // game" false. Group-owned games are allowed through: the public creator id
  // is the group, not the member who published.
  const userId = await knownUserId()
  if (userId && verified.creatorType === 'User' && verified.creatorId && verified.creatorId !== userId) {
    return jsonError(
      `That game belongs to a different Roblox account (creator ${verified.creatorId}, you are ${userId}). Paste the link of the game YOU published.`,
      409,
    )
  }

  let updated = meta
  try {
    updated = await updateProject(id, {
      userPlace: {
        placeId: verified.rootPlaceId,
        universeId: verified.universeId,
        at: new Date().toISOString(),
        source: 'user-link',
      },
    })
  } catch (err) {
    return errorResponse(err)
  }

  return NextResponse.json({ found: true, place: placeResponse(updated) ?? undefined, meta: updated, name: verified.name })
}
