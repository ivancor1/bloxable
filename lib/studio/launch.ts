// Server-only: finds the local Roblox Studio install and launches it on a
// local place file.
//
// Everything here follows the documented Studio CLI
// (create.roblox.com/docs/en-us/studio/command-line-interface, fetched
// 2026-07-30 and re-checked 2026-07-31): a local `.rbxl`/`.rbxlx` opens with
// `--task EditFile --localPlaceFile <path>`, and the executable is documented
// per platform as
//
//   macOS    /Applications/RobloxStudio.app/Contents/MacOS/RobloxStudio
//   Windows  %localappdata%\Roblox\Versions\[version]\RobloxStudioBeta.exe
//
// Only documented flags and locations are used.
//
// The binary is spawned DIRECTLY, not via `open -a` (macOS) or a shell:
// LaunchServices only forwards `open --args` to a cold start — with Studio
// already running, `open` re-activates the existing instance and silently
// drops the arguments. The documented executable path exists precisely so
// tools can invoke it.
//
// Windows note: `[version]` is an opaque per-build folder under
// `%localappdata%\Roblox\Versions\`, and the same folder tree also holds the
// player (RobloxPlayerBeta.exe), so the scan looks for folders that actually
// contain RobloxStudioBeta.exe and picks the most recently modified one —
// Roblox's own bootstrapper writes a fresh folder per Studio update. The
// selection rule is pinned by fixture tests (scripts/test-studio-launch.mjs);
// it has NOT run on a real Windows machine yet, and the PR that added it
// says so.
//
// What this does NOT do: publish. A place opened this way is a local file;
// putting it on Roblox is a File → Publish step only the user can take.

import { spawn } from 'node:child_process'
import { access, constants, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

/** Thrown when no Studio install is found (or the platform is unsupported). */
export class StudioLaunchError extends Error {}

/** Relative path of the real executable inside RobloxStudio.app (documented). */
const MAC_APP_EXECUTABLE = 'RobloxStudio.app/Contents/MacOS/RobloxStudio'

/** The documented Windows executable name inside a Versions/[version] folder. */
export const WINDOWS_STUDIO_EXE = 'RobloxStudioBeta.exe'

const STUDIO_INSTALL_HINT =
  'Install Roblox Studio from create.roblox.com (see create.roblox.com/docs/en-us/studio/setup), then try again.'

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** macOS candidate executable paths — the documented app location, both app dirs. */
export function macStudioCandidates(homedir: string): string[] {
  return [
    path.join('/Applications', MAC_APP_EXECUTABLE),
    path.join(homedir, 'Applications', MAC_APP_EXECUTABLE),
  ]
}

/**
 * The documented Windows install root, derived from the environment. Null when
 * LOCALAPPDATA is absent — the documented path is defined in terms of it, and
 * guessing another location would not be the documented install.
 */
export function windowsVersionsRoot(env: Record<string, string | undefined>): string | null {
  const localAppData = env.LOCALAPPDATA
  if (!localAppData) return null
  return path.join(localAppData, 'Roblox', 'Versions')
}

/**
 * Picks the newest Studio build from scanned candidates — pure, so the
 * selection rule is testable without a Windows filesystem. `mtimeMs` is the
 * version folder's modification time; Roblox's bootstrapper writes a fresh
 * folder per update, so the newest folder is the current install.
 */
export function newestStudioExe(candidates: { exePath: string; mtimeMs: number }[]): string | null {
  if (candidates.length === 0) return null
  let best = candidates[0]
  for (const candidate of candidates.slice(1)) {
    if (candidate.mtimeMs > best.mtimeMs) best = candidate
  }
  return best.exePath
}

/**
 * Scans `%localappdata%\Roblox\Versions\*` for folders that contain
 * RobloxStudioBeta.exe. The same tree holds player builds, so the executable
 * check is what separates a Studio build from everything else. Exported for
 * the fixture test, which runs it against a synthetic Versions tree.
 */
export async function scanWindowsStudioBuilds(versionsRoot: string): Promise<{ exePath: string; mtimeMs: number }[]> {
  let entries
  try {
    entries = await readdir(versionsRoot, { withFileTypes: true })
  } catch {
    return [] // No Roblox install at all — same answer as an empty folder.
  }
  const found: { exePath: string; mtimeMs: number }[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(versionsRoot, entry.name)
    const exePath = path.join(dir, WINDOWS_STUDIO_EXE)
    try {
      await access(exePath, constants.F_OK)
      const dirStat = await stat(dir)
      found.push({ exePath, mtimeMs: dirStat.mtimeMs })
    } catch {
      // No Studio executable in this build folder (player build, partial download).
    }
  }
  return found
}

/** Resolves the Studio executable, or throws a StudioLaunchError that says why. */
export async function findStudioExecutable(): Promise<string> {
  const platform = process.platform

  if (platform === 'darwin') {
    for (const candidate of macStudioCandidates(os.homedir())) {
      if (await exists(candidate)) return candidate
    }
    throw new StudioLaunchError(`Roblox Studio is not installed. ${STUDIO_INSTALL_HINT}`)
  }

  if (platform === 'win32') {
    const root = windowsVersionsRoot(process.env)
    const builds = root ? await scanWindowsStudioBuilds(root) : []
    const exePath = newestStudioExe(builds)
    if (exePath) return exePath
    throw new StudioLaunchError(`Roblox Studio is not installed. ${STUDIO_INSTALL_HINT}`)
  }

  throw new StudioLaunchError(
    'Roblox Studio only runs on Windows and macOS, so Bloxable cannot open it on this computer.',
  )
}

export interface StudioLaunch {
  executable: string
  args: string[]
}

/**
 * Launches Roblox Studio on a local place file and resolves once the process
 * has actually spawned. The child is detached so Studio outlives the dev
 * server; it belongs to the user, not to this process.
 */
export async function launchStudio(placeFilePath: string): Promise<StudioLaunch> {
  const executable = await findStudioExecutable()
  const args = ['--task', 'EditFile', '--localPlaceFile', placeFilePath]

  const child = spawn(executable, args, { detached: true, stdio: 'ignore' })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', (err) =>
      reject(new StudioLaunchError(`Roblox Studio failed to start: ${err.message}`)),
    )
  })
  child.unref()

  return { executable, args }
}
