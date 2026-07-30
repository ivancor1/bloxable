// lib/studio-plugin/install.ts — server-only status/install/remove for the
// BloxableHelper Studio plugin (plugin/BloxableHelper.luau).
//
// Nothing in this module runs on its own. Every export is called from an
// app/api/studio-plugin/* route handler, and those only fire when the user
// clicks Install or Remove inside the consent UI
// (components/ui/HelperPluginConsent.tsx), which shows the full plugin source
// and the exact destination path before the Install button does anything.
//
// Where the file goes — Studio's local plugins folder:
//
//   macOS    ~/Documents/Roblox/Plugins
//   Windows  %LOCALAPPDATA%\Roblox\Plugins
//
// Sources for that location: Roblox's docs treat the local plugins folder as a
// first-class Studio concept ("Save as Local Plugin" and the Plugins Folder
// button — create.roblox.com/docs/studio/plugins) backed by the documented
// `Studio.PluginsDir` setting (create.roblox.com/docs/reference/engine/
// classes/Studio#PluginsDir), but never print the default path in prose. The
// concrete defaults above are the ones Rojo's own `rojo plugin install`
// resolves via the roblox-install crate (github.com/Kampfkarren/roblox-install
// — macOS: Documents/Roblox/Plugins, Windows: %LOCALAPPDATA%\Roblox\Plugins),
// and were verified live on this machine on 2026-07-30: the repo's pinned
// bin/rojo installed and removed RojoManagedPlugin.rbxm in
// ~/Documents/Roblox/Plugins. A user who has changed Studio.PluginsDir in
// Studio settings keeps that override — we install to the default folder and
// say so in the UI rather than guessing at overrides we cannot read reliably.
//
// Trust rules this module keeps:
//   - Fixed paths only. No caller-supplied path ever reaches the filesystem.
//   - Installs are verified: after writing, the file is read back and must be
//     byte-identical to the copy this app ships, or the install throws.
//   - Remove is one unlink of that one known file — never a directory, never
//     anything else in the plugins folder.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir, platform } from 'node:os'
import path from 'node:path'

export const PLUGIN_FILE_NAME = 'BloxableHelper.luau'

/** The copy of the plugin this app ships, checked into the repo. */
function shippedPluginPath(): string {
  return path.join(process.cwd(), 'plugin', PLUGIN_FILE_NAME)
}

export interface PluginsFolderInfo {
  supported: boolean
  /** Absolute path to Studio's local plugins folder, when supported. */
  folder: string | null
  /** Plain-language reason when unsupported. */
  reason: string | null
}

/**
 * Studio's default local plugins folder for this OS. Roblox Studio only runs
 * on macOS and Windows, so anything else is honestly unsupported rather than
 * a guessed path.
 */
export function pluginsFolderInfo(): PluginsFolderInfo {
  const os = platform()
  if (os === 'darwin') {
    return {
      supported: true,
      folder: path.join(homedir(), 'Documents', 'Roblox', 'Plugins'),
      reason: null,
    }
  }
  if (os === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local')
    return {
      supported: true,
      folder: path.join(localAppData, 'Roblox', 'Plugins'),
      reason: null,
    }
  }
  return {
    supported: false,
    folder: null,
    reason: 'Roblox Studio only runs on macOS and Windows, so there is no plugins folder to install into on this computer.',
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export interface HelperPluginStatus {
  supported: boolean
  reason: string | null
  /** Studio's local plugins folder (null when unsupported). */
  folder: string | null
  /** Exactly where the file is / would be written. */
  targetPath: string | null
  installed: boolean
  /** True when the installed file is byte-identical to the copy this app ships. Null when not installed. */
  byteIdentical: boolean | null
  /** SHA-256 of the copy this app ships. */
  shippedSha256: string
  shippedBytes: number
  /** SHA-256 of the installed file, when present. */
  installedSha256: string | null
  /** The shipped plugin source, verbatim — the consent UI displays this before Install is possible. */
  source: string
}

export async function getHelperPluginStatus(): Promise<HelperPluginStatus> {
  const shipped = await fs.readFile(shippedPluginPath())
  const info = pluginsFolderInfo()
  const targetPath = info.folder ? path.join(info.folder, PLUGIN_FILE_NAME) : null

  let installedBytes: Buffer | null = null
  if (targetPath) {
    try {
      installedBytes = await fs.readFile(targetPath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  return {
    supported: info.supported,
    reason: info.reason,
    folder: info.folder,
    targetPath,
    installed: installedBytes !== null,
    byteIdentical: installedBytes === null ? null : installedBytes.equals(shipped),
    shippedSha256: sha256(shipped),
    shippedBytes: shipped.byteLength,
    installedSha256: installedBytes === null ? null : sha256(installedBytes),
    source: shipped.toString('utf8'),
  }
}

export interface InstallResult {
  path: string
  bytes: number
  sha256: string
  /** True when an existing (e.g. older) copy was overwritten. */
  replaced: boolean
}

/**
 * Copies the shipped plugin into Studio's local plugins folder. Explicit user
 * action only — the sole caller is POST /api/studio-plugin/install, wired to
 * the consent UI's Install button. Writes via temp file + rename, then reads
 * the result back and refuses to report success unless it is byte-identical
 * to the shipped copy.
 */
export async function installHelperPlugin(): Promise<InstallResult> {
  const info = pluginsFolderInfo()
  if (!info.supported || !info.folder) {
    throw new Error(info.reason ?? 'Unsupported platform')
  }
  const shipped = await fs.readFile(shippedPluginPath())
  const target = path.join(info.folder, PLUGIN_FILE_NAME)

  let replaced = false
  try {
    await fs.access(target)
    replaced = true
  } catch {
    // not there yet — a fresh install
  }

  await fs.mkdir(info.folder, { recursive: true })
  const tmp = path.join(info.folder, `.${PLUGIN_FILE_NAME}.tmp-${Date.now()}`)
  await fs.writeFile(tmp, shipped)
  await fs.rename(tmp, target)

  const written = await fs.readFile(target)
  if (!written.equals(shipped)) {
    throw new Error(`Install verification failed: ${target} does not match the shipped plugin`)
  }

  return { path: target, bytes: written.byteLength, sha256: sha256(written), replaced }
}

export interface RemoveResult {
  path: string
  /** False when there was nothing to remove — reported honestly, not as an error. */
  existed: boolean
}

/**
 * Deletes exactly one file: BloxableHelper.luau in Studio's local plugins
 * folder. Explicit user action only (POST /api/studio-plugin/remove). Removing
 * a plugin that is not there is a no-op, not an error — the end state the user
 * asked for ("not installed") holds either way.
 */
export async function removeHelperPlugin(): Promise<RemoveResult> {
  const info = pluginsFolderInfo()
  if (!info.supported || !info.folder) {
    throw new Error(info.reason ?? 'Unsupported platform')
  }
  const target = path.join(info.folder, PLUGIN_FILE_NAME)
  try {
    await fs.unlink(target)
    return { path: target, existed: true }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path: target, existed: false }
    }
    throw err
  }
}
