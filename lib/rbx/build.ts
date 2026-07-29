// Server-only: projects a stored tree into data/projects/<id>/build/ and shells
// out to the pinned Rojo 7.7.0 binary to produce a real Roblox place file.

import { execFile } from 'node:child_process'
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import type { RbxTree } from './types'
import { modelProjectFromTree, projectFromTree } from './rojo'
import type { ModelProjection } from './rojo'

const execFileP = promisify(execFile)

export type PlaceFormat = 'rbxl' | 'rbxlx'

const SETUP_HINT = 'run `npm run setup`'

function repoRoot(): string {
  // The Next.js server runs with the repo root as cwd; import.meta.url can point
  // inside the build output, so it is only a fallback.
  const cwd = process.cwd()
  if (cwd && cwd !== '/') return cwd
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  } catch {
    return cwd
  }
}

export function rojoBinPath(): string {
  return path.join(repoRoot(), 'bin', 'rojo')
}

export function projectDir(projectId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
    throw new Error(`Invalid project id "${projectId}"`)
  }
  return path.join(repoRoot(), 'data', 'projects', projectId)
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Loads a project's stored tree plus its display name. */
async function loadProject(projectId: string): Promise<{ dir: string; tree: RbxTree; name: string }> {
  const dir = projectDir(projectId)
  const treePath = path.join(dir, 'tree.json')

  let tree: RbxTree
  try {
    tree = JSON.parse(await readFile(treePath, 'utf8')) as RbxTree
  } catch (err) {
    const reason = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'not found' : (err as Error).message
    throw new Error(`Cannot build project ${projectId}: ${treePath} ${reason}`)
  }
  if (!tree || !Array.isArray(tree.services)) {
    throw new Error(`Cannot build project ${projectId}: ${treePath} is not a place tree`)
  }

  let name = projectId
  try {
    const meta = JSON.parse(await readFile(path.join(dir, 'project.json'), 'utf8')) as {
      name?: string
    }
    if (meta?.name) name = meta.name
  } catch {
    // project.json is optional for a build
  }

  return { dir, tree, name }
}

/** Writes a projected Rojo project into a clean build dir and runs `bin/rojo build`. */
async function runRojo(
  buildDir: string,
  files: Record<string, string>,
  outPath: string,
): Promise<{ filePath: string; bytes: number }> {
  await rm(buildDir, { recursive: true, force: true })
  await mkdir(buildDir, { recursive: true })

  for (const relPath of Object.keys(files)) {
    const target = path.join(buildDir, relPath)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, files[relPath])
  }

  const rojo = rojoBinPath()
  if (!(await exists(rojo))) {
    throw new Error(`Roblox build tool missing at ${rojo} — ${SETUP_HINT}.`)
  }

  try {
    await execFileP(rojo, ['build', '--output', outPath, buildDir], {
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
    if (e.code === 'ENOENT') {
      throw new Error(`Roblox build tool missing at ${rojo} — ${SETUP_HINT}.`)
    }
    const detail = (e.stderr || e.stdout || e.message || '').trim()
    throw new Error(`Rojo build failed:\n${detail}`)
  }

  const info = await stat(outPath)
  return { filePath: outPath, bytes: info.size }
}

/**
 * Builds `data/projects/<projectId>/build/place.<format>`.
 * Throws with the Rojo error text verbatim when the build fails.
 */
export async function buildPlace(
  projectId: string,
  format: PlaceFormat,
): Promise<{ filePath: string; bytes: number }> {
  if (format !== 'rbxl' && format !== 'rbxlx') {
    throw new Error(`Unknown place format "${format}" — expected rbxl or rbxlx`)
  }

  const { dir, tree, name } = await loadProject(projectId)
  const buildDir = path.join(dir, 'build')
  return runRojo(buildDir, projectFromTree(tree, name), path.join(buildDir, `place.${format}`))
}

export type ModelBuild = { filePath: string; bytes: number } & Omit<ModelProjection, 'files'>

/**
 * Builds `data/projects/<projectId>/build-model/model.rbxm` — the same tree as a
 * Model asset, for uploading into a user's own Roblox account (the eject path).
 * Uses a separate build dir so an eject never races a place build.
 */
export async function buildModel(projectId: string): Promise<ModelBuild> {
  const { dir, tree, name } = await loadProject(projectId)
  const buildDir = path.join(dir, 'build-model')
  const { files, ...report } = modelProjectFromTree(tree, name)
  const built = await runRojo(buildDir, files, path.join(buildDir, 'model.rbxm'))
  return { ...built, ...report }
}
