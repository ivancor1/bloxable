// Server-only: finds the local Roblox Studio install and launches it on a
// local place file.
//
// Everything here follows the documented Studio CLI
// (create.roblox.com/docs/en-us/studio/command-line-interface, fetched
// 2026-07-30): the macOS executable lives at
// /Applications/RobloxStudio.app/Contents/MacOS/RobloxStudio, and a local
// `.rbxl`/`.rbxlx` opens with `--task EditFile --localPlaceFile <path>`.
// Only documented flags are used.
//
// The binary is spawned DIRECTLY, not via `open -a`: LaunchServices only
// forwards `open --args` to a cold start — with Studio already running, `open`
// re-activates the existing instance and silently drops the arguments. The
// documented executable path exists precisely so tools can invoke it.
//
// What this does NOT do: publish. A place opened this way is a local file;
// putting it on Roblox is a File → Publish step only the user can take.

import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

/** Thrown when no Studio install is found (or the platform is unsupported). */
export class StudioLaunchError extends Error {}

/** Relative path of the real executable inside RobloxStudio.app (documented). */
const MAC_APP_EXECUTABLE = 'RobloxStudio.app/Contents/MacOS/RobloxStudio'

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

/**
 * Candidate executable paths for this platform, or null when launching is not
 * wired up for it yet.
 *
 * Windows would slot in here: the documented install location is
 * `%localappdata%\Roblox\Versions\<version>\RobloxStudioBeta.exe`, which needs
 * a scan of the Versions directory — left unimplemented rather than faked,
 * because it has never been run on a real Windows install.
 */
function studioCandidates(platform: NodeJS.Platform): string[] | null {
  if (platform === 'darwin') {
    return [
      path.join('/Applications', MAC_APP_EXECUTABLE),
      path.join(os.homedir(), 'Applications', MAC_APP_EXECUTABLE),
    ]
  }
  return null
}

/** Resolves the Studio executable, or throws a StudioLaunchError that says why. */
export async function findStudioExecutable(): Promise<string> {
  const candidates = studioCandidates(process.platform)
  if (candidates === null) {
    throw new StudioLaunchError(
      'Opening in Roblox Studio from Bloxable currently works on macOS only.',
    )
  }
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  throw new StudioLaunchError(`Roblox Studio is not installed. ${STUDIO_INSTALL_HINT}`)
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
