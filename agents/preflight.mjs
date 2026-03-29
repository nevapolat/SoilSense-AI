#!/usr/bin/env node
/**
 * Preflight: runs `npm run build` in frontend/ (automation for CI or local checks).
 * Usage from repo root: node agents/preflight.mjs
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const frontend = path.join(root, 'frontend')

// shell: true keeps Windows/macOS/Linux happy when resolving `npm` on PATH
const result = spawnSync('npm', ['run', 'build'], {
  cwd: frontend,
  stdio: 'inherit',
  env: process.env,
  shell: true,
})

const code = result.status ?? 1
if (code !== 0) {
  console.error('[preflight] frontend build failed')
}
process.exit(code)
