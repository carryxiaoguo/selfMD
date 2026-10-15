/**
 * Smoke-test launcher.
 *
 * Launches the built app under the real Electron runtime, waits for the renderer
 * to report a completed boot, and propagates the exit code.
 *
 * A launcher script is needed rather than calling the `electron` CLI directly
 * because `ELECTRON_RUN_AS_NODE=1` may be present in the environment (it is set
 * by any host Electron application that shells out, including this project's own
 * development harness). With that variable set, the Electron binary degrades to
 * plain Node.js: `require('electron')` returns a path string instead of the API,
 * and `app`/`protocol`/`BrowserWindow` are all undefined. Clearing it here makes
 * the check behave identically in a terminal, in CI, and inside another Electron
 * app.
 */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// From plain Node this resolves to the path of the Electron executable.
const electronBinary = require('electron')
if (typeof electronBinary !== 'string') {
  console.error('[smoke] could not resolve the Electron binary; run `pnpm install` first.')
  process.exit(2)
}

const args = [projectRoot, '--smoke-test', ...process.argv.slice(2)]

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

console.log(`[smoke] launching ${electronBinary}`)
console.log(`[smoke] args: ${args.join(' ')}`)

const child = spawn(electronBinary, args, {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
  windowsHide: false
})

child.on('error', (err) => {
  console.error('[smoke] failed to launch Electron:', err)
  process.exit(2)
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[smoke] Electron terminated by signal ${signal}`)
    process.exit(1)
  }
  console.log(`[smoke] Electron exited with code ${code}`)
  process.exit(code ?? 1)
})
