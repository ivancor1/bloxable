import { NextRequest, NextResponse } from 'next/server'
import { completeAuthorization, oauthClient } from '@/lib/roblox/oauth'
import { takeOauthPending } from '@/lib/store'
import { RobloxError } from '@/lib/roblox/discover'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Back to the app with a result the shell can show, never a bare JSON page. */
function back(req: NextRequest, params: Record<string, string>, returnTo?: string): NextResponse {
  const url = new URL(returnTo && /^\/[^/\\]/.test(returnTo) ? returnTo : '/', req.url)
  for (const key of Object.keys(params)) url.searchParams.set(key, params[key])
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams

  // Roblox reports a refused consent here rather than at the token endpoint.
  const denied = query.get('error')
  if (denied) {
    return back(req, { roblox: 'error', message: query.get('error_description') || denied })
  }

  const code = query.get('code')
  const state = query.get('state')
  const pending = await takeOauthPending()
  const returnTo = pending?.returnTo

  if (!code || !state) {
    return back(req, { roblox: 'error', message: 'Roblox sign-in came back incomplete.' }, returnTo)
  }
  if (!pending || pending.state !== state) {
    return back(req, { roblox: 'error', message: 'Roblox sign-in expired or was started somewhere else — try again.' }, returnTo)
  }

  const client = oauthClient()
  if (!client) {
    return back(req, { roblox: 'error', message: 'Roblox sign-in is not set up on this server.' }, returnTo)
  }

  try {
    const account = await completeAuthorization({
      client,
      code,
      verifier: pending.verifier,
      redirectUri: pending.redirectUri,
    })
    return back(req, { roblox: 'connected', user: account.username ?? account.userId }, returnTo)
  } catch (err) {
    const message = err instanceof RobloxError ? err.message : err instanceof Error ? err.message : 'Roblox sign-in failed.'
    return back(req, { roblox: 'error', message }, returnTo)
  }
}
