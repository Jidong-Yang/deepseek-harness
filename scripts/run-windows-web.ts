/**
 * Task Scheduler entry that keeps the Web application in the owned Node
 * process instead of launching it through a detachable package-manager child.
 */

import { fileURLToPath } from 'node:url'

const dshHome = process.argv[2]
if (dshHome === undefined || dshHome.length === 0) {
  throw new Error('run-windows-web: the Harness home argument is required')
}

process.env.DSH_HOME = dshHome
process.env.COPILOT_DSH_PROVIDER_API_KEY = 'local-copilot-provider'
process.argv = [
  process.execPath,
  fileURLToPath(new URL('../apps/cli/src/bin.ts', import.meta.url)),
  'web',
  '--no-open',
]
await import('../apps/cli/src/bin.ts')
