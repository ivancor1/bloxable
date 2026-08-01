#!/usr/bin/env node
// Runs the Next.js CLI with framework telemetry off from the very first
// instruction of the process.
//
// Why a wrapper: next.config.ts already sets NEXT_TELEMETRY_DISABLED, but the
// config only loads after the CLI has started — and the parent CLI records a
// session event before that (the residual documented in the privacy PR #7).
// Setting the variable in the environment of the spawned process closes that
// gap for every `npm run dev/build/start`. A shell prefix in package.json
// ("VAR=1 next dev") would do the same on macOS/Linux but breaks on Windows
// cmd, and our users are on Windows — so: node sets the env, node runs the
// CLI. Zero dependencies, same behavior everywhere.
//
// Respects an explicit override: if the user has set NEXT_TELEMETRY_DISABLED
// themselves (any value), their value wins.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Next's real CLI entry (package.json "bin" → dist/bin/next) — running it with
// node sidesteps the .cmd-vs-symlink split between Windows and POSIX.
const nextBin = require.resolve('next/dist/bin/next')

const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { NEXT_TELEMETRY_DISABLED: '1', ...process.env },
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
child.on('error', (err) => {
  console.error(`could not start next: ${err.message}`)
  process.exit(1)
})
