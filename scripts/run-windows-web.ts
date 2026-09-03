/**
 * Task Scheduler entry that keeps the Web application in the owned Node
 * process instead of launching it through a detachable package-manager child.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dshHome = process.argv[2]
if (dshHome === undefined || dshHome.length === 0) {
  throw new Error('run-windows-web: the Harness home argument is required')
}

process.env.DSH_HOME = dshHome
await loadOptionalEnvironment(path.join(dshHome, 'ira-provider.env'))
process.env.COPILOT_DSH_PROVIDER_API_KEY = 'local-copilot-provider'
process.argv = [
  process.execPath,
  fileURLToPath(new URL('../apps/cli/src/bin.ts', import.meta.url)),
  'web',
  '--no-open',
]
await import('../apps/cli/src/bin.ts')

async function loadOptionalEnvironment(file: string): Promise<void> {
  let content: string
  try { content = await readFile(file, 'utf8') }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  for (const raw of content.split(/\r?\n/u)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) throw new Error(`invalid IRA Provider environment line: ${raw}`)
    const name = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!name.startsWith('IRA_DSH_')) throw new Error(`unexpected IRA Provider environment variable: ${name}`)
    process.env[name] = value
  }
}
