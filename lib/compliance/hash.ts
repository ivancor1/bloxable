// Tree revision marker for staleness detection. Pure and isomorphic — the
// client hashes the tree it pre-filled from, the server hashes the tree on
// disk, and a mismatch means "the game changed after the questionnaire was
// answered — prompt a retake". Not cryptographic and does not need to be:
// this is a change detector, not a signature.

import type { RbxTree } from '@/lib/rbx/types'

/** FNV-1a 32-bit over the serialized tree, plus its length for extra spread. */
export function treeHash(tree: RbxTree): string {
  const s = JSON.stringify(tree)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    // h *= 16777619 (mod 2^32), in 16-bit halves to stay in float-safe range.
    h = (h + ((h << 1) >>> 0) + ((h << 4) >>> 0) + ((h << 7) >>> 0) + ((h << 8) >>> 0) + ((h << 24) >>> 0)) >>> 0
  }
  return `${h.toString(16).padStart(8, '0')}-${s.length.toString(36)}`
}
