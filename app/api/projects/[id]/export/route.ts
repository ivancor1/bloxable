import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import { buildPlace } from '@/lib/rbx/build'
import { getProject } from '@/lib/store'
import { errorResponse } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Strips everything but safe filename characters; never empty. */
function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
  return cleaned || 'project'
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const meta = await getProject(id)
    const { filePath } = await buildPlace(id, 'rbxlx')
    const bytes = await fs.readFile(filePath)
    const filename = `${safeFilename(meta.name)}.rbxlx`
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    return errorResponse(err)
  }
}
