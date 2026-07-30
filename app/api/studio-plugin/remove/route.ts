import { NextResponse } from 'next/server'
import { getHelperPluginStatus, removeHelperPlugin } from '@/lib/studio-plugin/install'
import { errorResponse } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Deletes BloxableHelper.luau from Studio's local plugins folder — uninstall
 * is one click, same as install (trust cuts both ways). Explicit user action
 * only: the one caller is the Remove button in
 * components/ui/HelperPluginConsent.tsx. Removes exactly that one file and
 * nothing else; removing an already-absent plugin reports `existed: false`
 * instead of failing, because the state the user asked for holds either way.
 */
export async function POST() {
  try {
    const result = await removeHelperPlugin()
    return NextResponse.json({ ok: true, ...result, status: await getHelperPluginStatus() })
  } catch (err) {
    return errorResponse(err)
  }
}
