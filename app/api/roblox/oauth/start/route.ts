import { NextRequest, NextResponse } from 'next/server'
import { authorizeUrl, createPkce, oauthClient, randomState, redirectUriFor } from '@/lib/roblox/oauth'
import { setOauthPending } from '@/lib/store'
import { jsonError } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Kicks off the Roblox sign-in. The browser is sent straight to Roblox's consent
 * screen; the CSRF state and PKCE verifier are held server-side until the
 * callback comes back.
 */
export async function GET(req: NextRequest) {
  const client = oauthClient()
  if (!client) {
    return jsonError(
      'Roblox sign-in is not set up on this server — add ROBLOX_OAUTH_CLIENT_ID and ROBLOX_OAUTH_CLIENT_SECRET to .env.local (see README).',
      501,
    )
  }

  const redirectUri = redirectUriFor(req.url)
  const state = randomState()
  const { verifier, challenge } = await createPkce()

  // Only a same-origin path — never an absolute URL an open redirect could use.
  const requested = req.nextUrl.searchParams.get('returnTo')
  const returnTo = requested && /^\/[^/\\]/.test(requested) ? requested : undefined

  await setOauthPending({ state, verifier, redirectUri, returnTo, createdAt: new Date().toISOString() })

  return NextResponse.redirect(authorizeUrl({ clientId: client.clientId, redirectUri, state, challenge }))
}
