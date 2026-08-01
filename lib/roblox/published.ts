// Finding the game the USER published — server-only.
//
// After eject → Studio → File → Publish, the game exists on the user's own
// account, but no API hands us the placeId: publishing happened inside Studio,
// out of our sight. What IS real:
//
//   - games.roblox.com/v2/users/{userId}/games (public, no auth) lists a
//     user's PUBLIC experiences with rootPlace ids — verified live 2026-07-31.
//     New experiences start private, so this only finds the game once the user
//     flips it to Public (Game Settings → Permissions) — which they must do
//     anyway for a friend to join. The UI says exactly that.
//   - apis.roblox.com/universes/v1/places/{placeId}/universe (public) resolves
//     a pasted placeId to its universe, and games.roblox.com/v1/games
//     (public) returns that universe's creator + root place — together they
//     let us VERIFY a pasted link instead of trusting it. Both verified live
//     2026-07-31.
//
// No cookies, no scraping, no pretending: if the game cannot be found, the
// route says why it might not be findable and offers the paste-once fallback.

import { RobloxError } from './discover'

const USER_GAMES_URL = (userId: string) =>
  `https://games.roblox.com/v2/users/${encodeURIComponent(userId)}/games?sortOrder=Desc&limit=50`
const PLACE_UNIVERSE_URL = (placeId: string) =>
  `https://apis.roblox.com/universes/v1/places/${encodeURIComponent(placeId)}/universe`
const GAMES_URL = (universeId: string) =>
  `https://games.roblox.com/v1/games?universeIds=${encodeURIComponent(universeId)}`

const FETCH_TIMEOUT_MS = 15_000

export interface UserGame {
  universeId: string
  rootPlaceId: string
  name: string
  /** ISO 8601 — when the experience was created (File → Publish mints it). */
  created: string
  updated: string
}

/** The player-facing link — what a friend actually clicks. */
export function shareLink(placeId: string): string {
  return `https://www.roblox.com/games/start?placeId=${placeId}`
}

/** Lists the user's PUBLIC experiences, newest first. Public endpoint, no auth. */
export async function fetchUserGames(userId: string): Promise<UserGame[]> {
  let res: Response
  try {
    res = await fetch(USER_GAMES_URL(userId), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (err) {
    throw new RobloxError(
      `Could not reach Roblox to list games: ${err instanceof Error ? err.message : String(err)}`,
      502,
    )
  }
  if (!res.ok) {
    throw new RobloxError(`Roblox games lookup failed (${res.status})`, res.status === 429 ? 429 : 502)
  }
  const body = (await res.json().catch(() => null)) as {
    data?: { id?: number; name?: string; rootPlace?: { id?: number }; created?: string; updated?: string }[]
  } | null
  if (!body || !Array.isArray(body.data)) return []
  const games: UserGame[] = []
  for (const entry of body.data) {
    if (typeof entry.id !== 'number' || typeof entry.rootPlace?.id !== 'number') continue
    games.push({
      universeId: String(entry.id),
      rootPlaceId: String(entry.rootPlace.id),
      name: typeof entry.name === 'string' ? entry.name : '',
      created: typeof entry.created === 'string' ? entry.created : '',
      updated: typeof entry.updated === 'string' ? entry.updated : '',
    })
  }
  return games
}

/** Case- and whitespace-insensitive name equality — Studio titles the new
 * experience after the place file, so this is how "our" game looks over there. */
function sameName(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Finds the game the user just published: any of `acceptableNames` (project
 * name and its filename-safe form), created OR updated after `since` (minus
 * slack for clock drift between us and Roblox). Newest match wins. Pure.
 */
export function matchPublishedGame(
  games: UserGame[],
  args: { acceptableNames: string[]; since: string; slackMs?: number },
): UserGame | null {
  const slack = args.slackMs ?? 5 * 60 * 1000
  const cutoff = Date.parse(args.since) - slack
  if (Number.isNaN(cutoff)) return null

  let best: UserGame | null = null
  let bestTime = -Infinity
  for (const game of games) {
    if (!args.acceptableNames.some((name) => sameName(name, game.name))) continue
    const created = Date.parse(game.created)
    const updated = Date.parse(game.updated)
    const newest = Math.max(Number.isNaN(created) ? -Infinity : created, Number.isNaN(updated) ? -Infinity : updated)
    if (newest < cutoff) continue
    if (newest > bestTime) {
      best = game
      bestTime = newest
    }
  }
  return best
}

/**
 * Pulls a placeId out of whatever the user pasted. Accepted, because these are
 * the shapes Roblox itself hands out: a bare id, roblox.com/games/<id>/<slug>,
 * and any URL with a placeId query param (games/start deep links). Anything
 * else — including ro.blox.com short links, which need a redirect we will not
 * follow blind — returns null and the UI says what it accepts. Pure.
 */
export function parsePlaceIdInput(input: string): string | null {
  const text = input.trim()
  if (!text) return null

  if (/^\d{3,}$/.test(text)) return text

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (!/(^|\.)roblox\.com$/i.test(url.hostname)) return null

  const fromQuery = url.searchParams.get('placeId')
  if (fromQuery && /^\d{3,}$/.test(fromQuery)) return fromQuery

  const fromPath = url.pathname.match(/\/games\/(\d{3,})(?:[/?]|$)/)
  if (fromPath) return fromPath[1]

  return null
}

export interface VerifiedPlace {
  placeId: string
  universeId: string
  rootPlaceId: string
  name: string
  creatorId: string | null
  creatorType: string | null
}

/**
 * Verifies a pasted placeId against Roblox's public endpoints: the place must
 * resolve to a universe and the universe must answer with its creator. The
 * caller decides what a creator mismatch means — this just reports the truth.
 */
export async function verifyPlace(placeId: string): Promise<VerifiedPlace> {
  let universeRes: Response
  try {
    universeRes = await fetch(PLACE_UNIVERSE_URL(placeId), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (err) {
    throw new RobloxError(
      `Could not reach Roblox to check that place: ${err instanceof Error ? err.message : String(err)}`,
      502,
    )
  }
  const universeBody = (await universeRes.json().catch(() => null)) as { universeId?: number | null } | null
  if (!universeRes.ok || typeof universeBody?.universeId !== 'number') {
    throw new RobloxError('Roblox does not know that place id — check the link and try again.', 404)
  }
  const universeId = String(universeBody.universeId)

  let gameRes: Response
  try {
    gameRes = await fetch(GAMES_URL(universeId), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (err) {
    throw new RobloxError(
      `Could not reach Roblox to check that game: ${err instanceof Error ? err.message : String(err)}`,
      502,
    )
  }
  const gameBody = (await gameRes.json().catch(() => null)) as {
    data?: { rootPlaceId?: number; name?: string; creator?: { id?: number; type?: string } }[]
  } | null
  const game = gameBody?.data?.[0]
  if (!gameRes.ok || !game) {
    throw new RobloxError('Roblox knows the place but not its game — is it public yet?', 404)
  }

  return {
    placeId,
    universeId,
    rootPlaceId: typeof game.rootPlaceId === 'number' ? String(game.rootPlaceId) : placeId,
    name: typeof game.name === 'string' ? game.name : '',
    creatorId: typeof game.creator?.id === 'number' ? String(game.creator.id) : null,
    creatorType: typeof game.creator?.type === 'string' ? game.creator.type : null,
  }
}
