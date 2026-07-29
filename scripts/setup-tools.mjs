#!/usr/bin/env node
// Bloxable one-time toolchain setup (idempotent).
//
// 1. Downloads the pinned Rojo + Lune release binaries (macos-aarch64) into bin/.
// 2. Fetches the official Roblox API dump into data/cache/api-dump.json via the
//    clientsettings -> setup.rbxcdn flow verified in RESEARCH.md Part 2.
//
// Re-running is safe: existing binaries with the pinned version and an API dump
// matching the current Studio build are left alone. Pass --force to redo both.

import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { LUNE_VERSION, ROJO_VERSION } from '../lib/config.ts'

const execFileP = promisify(execFile)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN_DIR = path.join(ROOT, 'bin')
const CACHE_DIR = path.join(ROOT, 'data', 'cache')
const DUMP_PATH = path.join(CACHE_DIR, 'api-dump.json')
const DUMP_META_PATH = path.join(CACHE_DIR, 'api-dump.meta.json')

const FORCE = process.argv.includes('--force')

// Release archives are published per platform; v1 targets the local macOS arm64 dev box.
const PLATFORM_SLUG = 'macos-aarch64'

const TOOLS = [
  {
    name: 'rojo',
    version: ROJO_VERSION,
    url: `https://github.com/rojo-rbx/rojo/releases/download/v${ROJO_VERSION}/rojo-${ROJO_VERSION}-${PLATFORM_SLUG}.zip`,
  },
  {
    name: 'lune',
    version: LUNE_VERSION,
    url: `https://github.com/lune-org/lune/releases/download/v${LUNE_VERSION}/lune-${LUNE_VERSION}-${PLATFORM_SLUG}.zip`,
  },
]

function log(msg) {
  process.stdout.write(`${msg}\n`)
}

async function toolVersion(binPath) {
  try {
    const { stdout, stderr } = await execFileP(binPath, ['--version'])
    return `${stdout}${stderr}`.trim()
  } catch {
    return null
  }
}

async function download(url, destFile) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(destFile, buf)
  return buf.byteLength
}

async function installTool(tool) {
  const binPath = path.join(BIN_DIR, tool.name)
  if (!FORCE && existsSync(binPath)) {
    const current = await toolVersion(binPath)
    if (current && current.includes(tool.version)) {
      log(`${tool.name}: already installed (${current})`)
      return
    }
  }

  const work = await mkdtemp(path.join(tmpdir(), `bloxable-${tool.name}-`))
  try {
    const zipPath = path.join(work, `${tool.name}.zip`)
    log(`${tool.name}: downloading ${tool.url}`)
    const bytes = await download(tool.url, zipPath)
    log(`${tool.name}: ${bytes.toLocaleString('en-US')} bytes`)
    // -j flattens, -o overwrites; the release zips contain a single executable.
    await execFileP('unzip', ['-j', '-o', zipPath, '-d', BIN_DIR])
    await chmod(binPath, 0o755)
  } finally {
    await rm(work, { recursive: true, force: true })
  }

  const installed = await toolVersion(binPath)
  if (!installed) {
    throw new Error(`${tool.name}: installed but "${binPath} --version" failed`)
  }
  if (!installed.includes(tool.version)) {
    throw new Error(`${tool.name}: expected version ${tool.version}, got "${installed}"`)
  }
  log(`${tool.name}: ${installed} -> ${binPath}`)
}

async function currentStudioBuild() {
  const res = await fetch('https://clientsettings.roblox.com/v2/client-version/WindowsStudio64')
  if (!res.ok) {
    throw new Error(
      `GET clientsettings.roblox.com/v2/client-version/WindowsStudio64 -> HTTP ${res.status} ${res.statusText}`,
    )
  }
  const json = await res.json()
  if (!json?.clientVersionUpload) {
    throw new Error(`clientsettings response had no clientVersionUpload: ${JSON.stringify(json)}`)
  }
  return json
}

async function installApiDump() {
  const build = await currentStudioBuild()
  log(`api dump: Studio ${build.version} (${build.clientVersionUpload})`)

  if (!FORCE && existsSync(DUMP_PATH) && existsSync(DUMP_META_PATH)) {
    try {
      const meta = JSON.parse(await readFile(DUMP_META_PATH, 'utf8'))
      if (meta.clientVersionUpload === build.clientVersionUpload) {
        log(`api dump: already current (${DUMP_PATH})`)
        return
      }
    } catch {
      // fall through and refetch
    }
  }

  const url = `https://setup.rbxcdn.com/${build.clientVersionUpload}-API-Dump.json`
  log(`api dump: downloading ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText}`)
  }
  const text = await res.text()
  const parsed = JSON.parse(text) // fail loudly on a truncated/HTML response
  if (!Array.isArray(parsed.Classes) || !Array.isArray(parsed.Enums)) {
    throw new Error(`api dump at ${url} is missing Classes/Enums`)
  }
  await writeFile(DUMP_PATH, text)
  await writeFile(
    DUMP_META_PATH,
    `${JSON.stringify(
      {
        version: build.version,
        clientVersionUpload: build.clientVersionUpload,
        source: url,
        fetchedAt: new Date().toISOString(),
        classes: parsed.Classes.length,
        enums: parsed.Enums.length,
      },
      null,
      2,
    )}\n`,
  )
  log(
    `api dump: ${parsed.Classes.length} classes, ${parsed.Enums.length} enums -> ${DUMP_PATH}`,
  )
}

async function main() {
  await mkdir(BIN_DIR, { recursive: true })
  await mkdir(CACHE_DIR, { recursive: true })

  for (const tool of TOOLS) {
    await installTool(tool)
  }
  await installApiDump()

  log('setup: done')
}

main().catch((err) => {
  process.stderr.write(`setup failed: ${err?.message ?? err}\n`)
  process.exitCode = 1
})
