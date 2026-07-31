import { NextRequest, NextResponse } from 'next/server'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { buildPlace, projectDir } from '@/lib/rbx/build'
import { getProject } from '@/lib/store'
import { launchStudio, StudioLaunchError } from '@/lib/studio/launch'
import { errorResponse, jsonError } from '@/app/api/_lib/http'
import { safeFilename } from '@/app/api/_lib/filename'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Open in Studio: build the project to a real `.rbxl` with the pinned Rojo
 * binary (the same path export uses) and open that file in the local Roblox
 * Studio via its documented CLI (`--task EditFile --localPlaceFile <path>`).
 *
 * Honesty contract: what opens is a LOCAL place file — a fresh copy of the
 * project, built on every click. Nothing is converted, nothing is uploaded,
 * nothing is published; edits saved in Studio stay in that file and do not
 * flow back into Bloxable. Publishing a place to Roblox remains a
 * File → Publish step only the user can take in Studio (or Bloxable's own
 * Publish button for the operator universe).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let meta
  try {
    meta = await getProject(id)
  } catch (err) {
    return errorResponse(err)
  }

  let built
  try {
    built = await buildPlace(id, 'rbxl')
  } catch (err) {
    return errorResponse(err)
  }

  // buildPlace wipes its build dir on every run (export/publish share it), so
  // the file Studio holds open lives in a stable per-project spot instead:
  // data/projects/<id>/studio/<Name>.rbxl — same path every time, overwritten
  // with the current project state on each open. The dir is cleared first so a
  // project rename cannot strand stale copies under the old name.
  const studioDir = path.join(projectDir(id), 'studio')
  const placePath = path.join(studioDir, `${safeFilename(meta.name)}.rbxl`)
  try {
    await rm(studioDir, { recursive: true, force: true })
    await mkdir(studioDir, { recursive: true })
    await copyFile(built.filePath, placePath)
  } catch (err) {
    return errorResponse(err)
  }

  try {
    const launch = await launchStudio(placePath)
    return NextResponse.json({
      filePath: placePath,
      bytes: built.bytes,
      executable: launch.executable,
      args: launch.args,
    })
  } catch (err) {
    // 424: the request was fine; the local Studio dependency is what's missing.
    if (err instanceof StudioLaunchError) return jsonError(err.message, 424)
    return errorResponse(err)
  }
}
