// Display-only helpers for the Files tree. Real Roblox class names and the
// RunContext enum drive the mono file-style names shown in the sidebar and
// code sheet (DESIGN.md: ".server.luau / .client.luau / .luau per RunContext
// or class"). Pure and side-effect-free.

import type { RbxInstance } from '@/lib/rbx/types'

export const SCRIPT_CLASSES = new Set(['Script', 'LocalScript', 'ModuleScript'])

export function isScriptInstance(inst: RbxInstance): boolean {
  return SCRIPT_CLASSES.has(inst.className)
}

/** Rojo-style suffix for a script instance, e.g. "Rounds.server.luau". */
export function scriptSuffix(inst: RbxInstance): string {
  if (inst.className === 'LocalScript') return '.client.luau'
  if (inst.className === 'ModuleScript') return '.luau'
  if (inst.className === 'Script') {
    const runContext = inst.props['RunContext']
    if (runContext?.type === 'token' && runContext.itemName === 'Client') return '.client.luau'
    return '.server.luau'
  }
  return ''
}

export function scriptDisplayName(inst: RbxInstance): string {
  return `${inst.name}${scriptSuffix(inst)}`
}
