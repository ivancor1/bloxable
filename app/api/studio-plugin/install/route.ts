import { NextResponse } from 'next/server'
import { getHelperPluginStatus, installHelperPlugin } from '@/lib/studio-plugin/install'
import { errorResponse } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Copies plugin/BloxableHelper.luau into Studio's local plugins folder.
 *
 * EXPLICIT USER ACTION ONLY: the one caller is the Install button in
 * components/ui/HelperPluginConsent.tsx, which the user reaches only after the
 * consent dialog has shown what the plugin does, what it never does, its full
 * source, and the exact path below. Nothing else in the app calls this, and
 * nothing calls it automatically.
 *
 * The request body is ignored on purpose — the source and destination are
 * fixed server-side (no client-supplied paths, ever). The write is verified
 * byte-identical before success is reported.
 */
export async function POST() {
  try {
    const result = await installHelperPlugin()
    return NextResponse.json({ ok: true, ...result, status: await getHelperPluginStatus() })
  } catch (err) {
    return errorResponse(err)
  }
}
