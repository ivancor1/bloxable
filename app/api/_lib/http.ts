// Private helper (underscore-prefixed folder — excluded from routing).
// Shared JSON-error shaping for B2's routes: app/api/projects/**,
// app/api/settings/**, app/api/credits/**.

import { NextResponse } from 'next/server'
import { NotFoundError, ValidationError } from '@/lib/store'

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

/** Maps a thrown error to a real HTTP status. Never fabricates success. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof NotFoundError) return jsonError(err.message, 404)
  if (err instanceof ValidationError) return jsonError(err.message, 400)
  const message = err instanceof Error ? err.message : 'Unexpected server error'
  return jsonError(message, 500)
}
