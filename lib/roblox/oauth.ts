// Roblox OAuth 2.0 (authorization code + PKCE). Server-only.
//
// This is how a user connects their OWN Roblox account so Bloxable can upload a
// model into their inventory. It is deliberately NOT an API-key flow: Roblox's
// Creator Third Party App Policy says "Do not request API keys from other Roblox
// Users" (RESEARCH.md Part 1 Q9), and asset:read + asset:write are both inside
// the OAuth2 "Creation & Productivity Tools" category, so the Assets API is
// reachable with a user's Bearer token.
//
// Endpoints below were re-checked live against
// https://apis.roblox.com/oauth/.well-known/openid-configuration.

import {
  clearRobloxAccount,
  getRobloxAccount,
  saveRobloxAccount,
  type RobloxAccount,
} from '@/lib/store'
import { RobloxError } from './discover'
import { ROBLOX_OAUTH_SCOPES } from '@/lib/config'

const AUTHORIZE_URL = 'https://apis.roblox.com/oauth/v1/authorize'
const TOKEN_URL = 'https://apis.roblox.com/oauth/v1/token'
const USERINFO_URL = 'https://apis.roblox.com/oauth/v1/userinfo'
const REVOKE_URL = 'https://apis.roblox.com/oauth/v1/token/revoke'
const TIMEOUT_MS = 20_000

/** Refresh this long before the access token actually expires. */
const REFRESH_SKEW_MS = 60_000

export interface OauthClient {
  clientId: string
  clientSecret: string
  /** Set when the operator pins a redirect URL; otherwise derived per request. */
  redirectUri?: string
}

/** Reads the operator's OAuth app credentials, or null when unconfigured. */
export function oauthClient(): OauthClient | null {
  const clientId = process.env.ROBLOX_OAUTH_CLIENT_ID?.trim()
  const clientSecret = process.env.ROBLOX_OAUTH_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, redirectUri: process.env.ROBLOX_OAUTH_REDIRECT_URI?.trim() }
}

/** The callback URL, pinned by env or derived from the incoming request origin. */
export function redirectUriFor(requestUrl: string): string {
  const pinned = process.env.ROBLOX_OAUTH_REDIRECT_URI?.trim()
  if (pinned) return pinned
  return new URL('/api/roblox/oauth/callback', requestUrl).toString()
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

export interface Pkce {
  verifier: string
  challenge: string
}

export async function createPkce(): Promise<Pkce> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

export function randomState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)))
}

export function authorizeUrl(args: {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
}): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', args.clientId)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('scope', ROBLOX_OAUTH_SCOPES.join(' '))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', args.state)
  url.searchParams.set('code_challenge', args.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

interface TokenEnvelope {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

async function postForm(url: string, body: Record<string, string>): Promise<TokenEnvelope> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new RobloxError(
      timedOut ? 'Roblox sign-in request timed out.' : `Roblox sign-in request failed: ${err instanceof Error ? err.message : String(err)}`,
      timedOut ? 504 : 502,
    )
  }

  const text = await res.text()
  let parsed: TokenEnvelope
  try {
    parsed = JSON.parse(text) as TokenEnvelope
  } catch {
    throw new RobloxError(`Unexpected response from Roblox: ${text.slice(0, 300)}`, 502)
  }
  if (!res.ok || parsed.error) {
    // Roblox's own wording, verbatim — never a guess at what went wrong.
    const message = parsed.error_description || parsed.error || text.slice(0, 300)
    throw new RobloxError(message, res.status === 200 ? 502 : res.status)
  }
  return parsed
}

function expiryFrom(expiresIn: number | undefined): string {
  // Roblox access tokens live 15 minutes; assume the short end if it is absent.
  return new Date(Date.now() + (expiresIn ?? 900) * 1000).toISOString()
}

export interface UserInfo {
  sub: string
  preferred_username?: string
  name?: string
  nickname?: string
}

export async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  let res: Response
  try {
    res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw new RobloxError(`Could not read your Roblox profile: ${err instanceof Error ? err.message : String(err)}`, 502)
  }
  const text = await res.text()
  if (!res.ok) throw new RobloxError(text.slice(0, 300) || `Roblox userinfo failed (${res.status})`, res.status)
  try {
    return JSON.parse(text) as UserInfo
  } catch {
    throw new RobloxError(`Unexpected userinfo response from Roblox: ${text.slice(0, 300)}`, 502)
  }
}

/** Exchanges the authorization code and persists the connected account. */
export async function completeAuthorization(args: {
  client: OauthClient
  code: string
  verifier: string
  redirectUri: string
}): Promise<RobloxAccount> {
  const token = await postForm(TOKEN_URL, {
    client_id: args.client.clientId,
    client_secret: args.client.clientSecret,
    grant_type: 'authorization_code',
    code: args.code,
    code_verifier: args.verifier,
    redirect_uri: args.redirectUri,
  })
  if (!token.access_token) throw new RobloxError('Roblox returned no access token.', 502)

  const info = await fetchUserInfo(token.access_token)
  const account: RobloxAccount = {
    userId: info.sub,
    username: info.preferred_username,
    displayName: info.nickname ?? info.name,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: expiryFrom(token.expires_in),
    scope: token.scope ?? ROBLOX_OAUTH_SCOPES.join(' '),
    connectedAt: new Date().toISOString(),
  }
  await saveRobloxAccount(account)
  return account
}

/**
 * Returns a usable access token for the connected account, refreshing first when
 * it is about to expire. Roblox refresh tokens are SINGLE USE, so the rotated one
 * is persisted immediately; a refresh that Roblox rejects clears the connection
 * rather than leaving a dead token behind.
 */
export async function getAccessToken(): Promise<{ token: string; account: RobloxAccount }> {
  const account = await getRobloxAccount()
  if (!account) throw new RobloxError('Connect your Roblox account first.', 401)

  const expiresAt = Date.parse(account.expiresAt)
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return { token: account.accessToken, account }
  }

  const client = oauthClient()
  if (!client) throw new RobloxError('Roblox sign-in is not configured on this server.', 500)
  if (!account.refreshToken) {
    await clearRobloxAccount()
    throw new RobloxError('Your Roblox sign-in expired — connect again.', 401)
  }

  let token: TokenEnvelope
  try {
    token = await postForm(TOKEN_URL, {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
    })
  } catch (err) {
    await clearRobloxAccount()
    const detail = err instanceof Error ? err.message : String(err)
    throw new RobloxError(`Your Roblox sign-in expired — connect again. (${detail})`, 401)
  }
  if (!token.access_token) {
    await clearRobloxAccount()
    throw new RobloxError('Your Roblox sign-in expired — connect again.', 401)
  }

  const updated: RobloxAccount = {
    ...account,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? account.refreshToken,
    expiresAt: expiryFrom(token.expires_in),
    scope: token.scope ?? account.scope,
  }
  await saveRobloxAccount(updated)
  return { token: updated.accessToken, account: updated }
}

/** Best-effort token revocation; disconnecting locally must succeed regardless. */
export async function revokeToken(client: OauthClient, token: string): Promise<void> {
  try {
    await postForm(REVOKE_URL, {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token,
    })
  } catch {
    // Roblox already considers the token dead, or is unreachable — either way the
    // local disconnect below is what the user asked for.
  }
}
