import { NextResponse } from 'next/server'
import { clearRobloxAccount, getRobloxAccount } from '@/lib/store'
import { oauthClient, revokeToken } from '@/lib/roblox/oauth'
import { ROBLOX_OAUTH_SCOPES } from '@/lib/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Identity and scopes only — the access and refresh tokens never leave the
 * server, exactly like the operator's API key.
 */
export async function GET() {
  const account = await getRobloxAccount()
  const granted = account?.scope?.split(/[\s,]+/).filter(Boolean) ?? []
  return NextResponse.json({
    configured: !!oauthClient(),
    connected: !!account,
    userId: account?.userId ?? null,
    username: account?.username ?? null,
    displayName: account?.displayName ?? null,
    connectedAt: account?.connectedAt ?? null,
    canUpload: granted.includes('asset:write'),
    scopes: granted,
    requiredScopes: ROBLOX_OAUTH_SCOPES,
  })
}

export async function DELETE() {
  const account = await getRobloxAccount()
  const client = oauthClient()
  if (account && client) {
    await revokeToken(client, account.refreshToken ?? account.accessToken)
  }
  await clearRobloxAccount()
  return NextResponse.json({ connected: false })
}
