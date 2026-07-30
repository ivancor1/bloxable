import { NextResponse } from 'next/server'
import { getEligibility } from '@/lib/roblox/eligibility'
import { errorResponse } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The publish-tier eligibility object (lib/roblox/eligibility.ts). Missing
 * sources come back as 'unknown' fields, not errors, and this route never
 * starts an OAuth flow — `needsConsent: true` is the signal for the UI to
 * offer one when the user actually tries to publish.
 */
export async function GET() {
  try {
    return NextResponse.json(await getEligibility())
  } catch (err) {
    return errorResponse(err)
  }
}
