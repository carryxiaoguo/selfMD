/**
 * Development launcher.
 *
 * Wraps `electron-vite dev` for the same reason `smoke.mjs` exists: if
 * `ELECTRON_RUN_AS_NODE=1` is inherited from the environment (any host Electron
 * app that shells out sets it), the Electron binary degrades to plain Node.js and
 * the app dies with "Cannot read properties of undefined (reading 'app')".
 * Clearing it here means `pnpm dev` behaves the same in every terminal.
 */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// electron-vite declares `bin/electron-vite.js` as its bin but does not expose it
// through the package `exports` map, so require.resolve() on that path fails.
// Its package.json *is* exported, which gives us the package directory.
const electronViteDir = dirname(require.resolve('electron-vite/package.json'))
const electronViteBin = join(electronViteDir, 'bin', 'electron-vite.js')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [electronViteBin, 'dev', ...process.argv.slice(2)], {
  cwd: projectRoot,
  env,
  stdio: 'inherit'
})

child.on('error', (err) => {
  console.error('[dev] failed to start:', err)
  process.exit(2)
})

child.on('exit', (code) => process.exit(code ?? 0))
