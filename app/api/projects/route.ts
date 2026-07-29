import { NextRequest, NextResponse } from 'next/server'
import { createProject, listProjects } from '@/lib/store'
import { errorResponse, jsonError } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const projects = await listProjects()
    return NextResponse.json(projects)
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const name = (body as { name?: unknown } | null)?.name
  if (typeof name !== 'string' || !name.trim()) {
    return jsonError('name is required', 400)
  }

  try {
    const project = await createProject(name)
    return NextResponse.json(project, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
