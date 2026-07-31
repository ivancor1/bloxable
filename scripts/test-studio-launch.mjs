#!/usr/bin/env node
// Pins the Studio executable resolution (lib/studio/launch.ts) — above all the
// Windows scan, which cannot be exercised on this Mac any other way: the
// documented install layout (%localappdata%\Roblox\Versions\[version]\
// RobloxStudioBeta.exe, per create.roblox.com/docs/en-us/studio/
// command-line-interface) is rebuilt as a synthetic fixture tree and the real
// scan runs against it. Fixture-level confidence only — a real Windows machine
// has still never run this code, and the PR says so.
//
// Same TS-resolve hook as test-engine.mjs.

import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier, context.parentURL)
      if (!/\.[a-z]+$/i.test(url.pathname)) {
        for (const ext of ['.ts', '/index.ts']) {
          if (existsSync(fileURLToPath(url) + ext)) return nextResolve(specifier + ext, context)
        }
      }
    }
    return nextResolve(specifier, context)
  },
})

const failures = []
let checks = 0

function ok(condition, message) {
  checks += 1
  if (!condition) failures.push(message)
}

function eq(actual, expected, message) {
  checks += 1
  if (actual !== expected) failures.push(`${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`)
}

function section(title) {
  process.stdout.write(`\n— ${title}\n`)
}

const {
  WINDOWS_STUDIO_EXE,
  findStudioExecutable,
  macStudioCandidates,
  newestStudioExe,
  scanWindowsStudioBuilds,
  windowsVersionsRoot,
} = await import('../lib/studio/launch.ts')

// --- documented locations, verbatim -------------------------------------------

section('documented locations')

const mac = macStudioCandidates('/Users/someone')
eq(mac.length, 2, 'two macOS candidates')
eq(mac[0], '/Applications/RobloxStudio.app/Contents/MacOS/RobloxStudio', 'system Applications first')
eq(mac[1], '/Users/someone/Applications/RobloxStudio.app/Contents/MacOS/RobloxStudio', 'user Applications second')

eq(WINDOWS_STUDIO_EXE, 'RobloxStudioBeta.exe', 'documented Windows executable name')

// The documented Windows root is defined in terms of LOCALAPPDATA — no
// LOCALAPPDATA, no guessed fallback.
eq(
  windowsVersionsRoot({ LOCALAPPDATA: 'C:\\Users\\kid\\AppData\\Local' }),
  path.join('C:\\Users\\kid\\AppData\\Local', 'Roblox', 'Versions'),
  'Versions root from LOCALAPPDATA',
)
eq(windowsVersionsRoot({}), null, 'no LOCALAPPDATA → null, never a guess')
eq(windowsVersionsRoot({ LOCALAPPDATA: '' }), null, 'empty LOCALAPPDATA → null')

// --- newest-build selection (pure) --------------------------------------------

section('newest-build selection')

eq(newestStudioExe([]), null, 'no builds → null')
eq(newestStudioExe([{ exePath: 'a', mtimeMs: 5 }]), 'a', 'single build wins')
eq(
  newestStudioExe([
    { exePath: 'old', mtimeMs: 100 },
    { exePath: 'new', mtimeMs: 200 },
    { exePath: 'mid', mtimeMs: 150 },
  ]),
  'new',
  'newest mtime wins regardless of order',
)

// --- the scan, against a synthetic documented layout ---------------------------

section('Versions scan (fixture tree)')

const root = await mkdtemp(path.join(tmpdir(), 'bloxable-studio-scan-'))
const versions = path.join(root, 'Roblox', 'Versions')

// version-old: a Studio build from "yesterday".
const oldBuild = path.join(versions, 'version-0a1b2c3d')
await mkdir(oldBuild, { recursive: true })
await writeFile(path.join(oldBuild, WINDOWS_STUDIO_EXE), 'exe')
const oldTime = new Date(Date.now() - 24 * 60 * 60 * 1000)
await utimes(oldBuild, oldTime, oldTime)

// version-new: a Studio build from "now".
const newBuild = path.join(versions, 'version-9z8y7x6w')
await mkdir(newBuild, { recursive: true })
await writeFile(path.join(newBuild, WINDOWS_STUDIO_EXE), 'exe')

// version-player: the PLAYER build that shares the tree — must be ignored.
const playerBuild = path.join(versions, 'version-player11')
await mkdir(playerBuild, { recursive: true })
await writeFile(path.join(playerBuild, 'RobloxPlayerBeta.exe'), 'exe')

// A stray file at the root — must be ignored (not a directory).
await writeFile(path.join(versions, 'RobloxCookies.dat'), 'not a build')

const scanned = await scanWindowsStudioBuilds(versions)
eq(scanned.length, 2, 'exactly the two Studio builds found')
ok(
  scanned.every((c) => c.exePath.endsWith(WINDOWS_STUDIO_EXE)),
  'every candidate is the documented executable',
)
eq(newestStudioExe(scanned), path.join(newBuild, WINDOWS_STUDIO_EXE), 'the fresh build is picked')

eq((await scanWindowsStudioBuilds(path.join(root, 'nowhere'))).length, 0, 'missing root → empty, not a crash')

await rm(root, { recursive: true, force: true })

// --- resolution on THIS machine (macOS) ----------------------------------------

section('resolution on this machine')

// Deterministic either way: if Studio is installed here the real documented
// path resolves; if not, the error names the install page. Both are honest.
const installedHere = existsSync('/Applications/RobloxStudio.app/Contents/MacOS/RobloxStudio')
try {
  const exe = await findStudioExecutable()
  ok(installedHere, 'resolves only when Studio is actually installed')
  ok(exe.endsWith('/RobloxStudio'), 'resolved the documented executable')
} catch (err) {
  ok(!installedHere, `threw although Studio is installed: ${err?.message}`)
  ok(String(err?.message).includes('create.roblox.com'), 'error points at the install docs')
}

// --- report ------------------------------------------------------------------

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} of ${checks} checks failed:\n`)
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n`)
  process.exit(1)
}
process.stdout.write(`\n${checks} checks passed\n`)
