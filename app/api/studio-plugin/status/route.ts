import { NextResponse } from 'next/server'
import { getHelperPluginStatus } from '@/lib/studio-plugin/install'
import { errorResponse } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Read-only: is BloxableHelper.luau present in Studio's local plugins folder,
 * and does it match the copy this app ships? Also returns the shipped source
 * verbatim so the consent UI can show the user the exact code before Install
 * exists as an option. Touches nothing, changes nothing, talks to no one.
 */
export async function GET() {
  try {
    return NextResponse.json(await getHelperPluginStatus())
  } catch (err) {
    return errorResponse(err)
  }
}
