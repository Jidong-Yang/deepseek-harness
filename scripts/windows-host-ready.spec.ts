import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { execa } from 'execa'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumeHostReadiness } from './windows-host-ready.ts'

const roots: string[] = []
const nonce = randomUUID().replaceAll('-', '')
const repo = fileURLToPath(new URL('../', import.meta.url))
const runner = join(repo, 'scripts/run-windows-web.ts')
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href
const invalid = 'run-windows-web: invalid Host readiness request'
const failed = 'run-windows-web: Host readiness publication failed'
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ready-'))
  roots.push(root)
  return root
}
function request(file: string): void {
  vi.stubEnv('DSH_HOST_READY_FILE', file)
  vi.stubEnv('DSH_HOST_READY_NONCE', nonce)
}
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('optional readiness request', () => {
  it('does nothing when both variables are absent', () => {
    vi.stubEnv('DSH_HOST_READY_FILE', undefined)
    vi.stubEnv('DSH_HOST_READY_NONCE', undefined)
    expect(consumeHostReadiness()).toBeUndefined()
  })
  it.each([
    [undefined, nonce], ['C:/ready.json', undefined], ['C:/ready.json', 'secret-not-a-nonce'],
    ['relative.json', nonce], ['C:relative.json', nonce], ['/root/ready.json', nonce],
    ['C:/../ready.json', nonce], ['C:/ready.json:stream', nonce], ['C:/NUL', nonce],
    ['C:/dir./ready.json', nonce], ['C:/' + 'x'.repeat(240), nonce],
  ])('rejects invalid or partial input without reflecting values', (file, value) => {
    vi.stubEnv('DSH_HOST_READY_FILE', file)
    vi.stubEnv('DSH_HOST_READY_NONCE', value)
    expect(consumeHostReadiness).toThrow(invalid)
    expect(process.env.DSH_HOST_READY_FILE).toBeUndefined()
    expect(process.env.DSH_HOST_READY_NONCE).toBeUndefined()
  })
})

describe.skipIf(process.platform !== 'win32')('Windows atomic ready file', () => {
  it('publishes once, with complete bounded JSON and canonical UTC', () => {
    const file = join(scratch(), 'ready.json')
    request(file)
    const publish = consumeHostReadiness()!
    expect(existsSync(file)).toBe(false)
    publish()
    const raw = readFileSync(file, 'utf8')
    const record = JSON.parse(raw) as { at: string }
    expect(record).toEqual({ schemaVersion: 1, nonce, pid: process.pid, state: 'ready', at: record.at })
    expect(new Date(record.at).toISOString()).toBe(record.at)
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(1024)
    publish()
    expect(readFileSync(file, 'utf8')).toBe(raw)
    expect(readdirSync(join(file, '..'))).toEqual(['ready.json'])
  })
  it('does not adopt stale files or follow link-shaped parents', () => {
    const root = scratch()
    const file = join(root, 'ready.json')
    writeFileSync(file, 'old')
    request(file)
    expect(consumeHostReadiness).toThrow(invalid)
    expect(readFileSync(file, 'utf8')).toBe('old')
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    mkdirSync(target)
    symlinkSync(target, alias, 'junction')
    request(join(alias, 'record.json'))
    expect(consumeHostReadiness).toThrow(invalid)
    expect(readdirSync(target)).toEqual([])
  })
  it('fails closed if a destination races publication, without replacing it', () => {
    const root = scratch()
    const file = join(root, 'ready.json')
    request(file)
    const publish = consumeHostReadiness()!
    const target = join(root, 'target')
    mkdirSync(target)
    symlinkSync(target, file, 'junction')
    expect(publish).toThrow(failed)
    expect(readdirSync(target)).toEqual([])
    expect(readdirSync(root).sort()).toEqual(['ready.json', 'target'])
  })
  it('reports static write failure when the private parent disappears', () => {
    const root = scratch()
    const directory = join(root, 'attempt')
    mkdirSync(directory)
    request(join(directory, 'ready.json'))
    const publish = consumeHostReadiness()!
    rmSync(directory, { recursive: true })
    expect(publish).toThrow(failed)
  })
})

function fixture(mode: 'ready' | 'fail' | 'exit' | 'dispose' | 'write-fail' | 'link' = 'ready', pipe?: string) {
  const home = scratch()
  const profile = join(home, 'profiles/web')
  const bundle = join(profile, 'node_modules/dsh-readiness-fixture')
  mkdirSync(bundle, { recursive: true })
  const file = join(home, 'ready.json')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-readiness-profile', private: true,
    dsh: { profile: { bundles: ['dsh-readiness-fixture'], patchReload: 'startup' } },
  }))
  writeFileSync(join(profile, 'cordis.patch.yml'), '[]')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({
    name: 'dsh-readiness-fixture', version: '0.0.0', type: 'module', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  // Generated fixture imports only built-ins; no production test hook or browser/Hub.
  writeFileSync(join(bundle, 'plugin.mjs'), [
    "import { existsSync, writeFileSync } from 'node:fs'",
    "import { join } from 'node:path'",
    "import { spawnSync } from 'node:child_process'",
    "export const name = 'readiness-fixture'",
    'export async function apply(ctx) {',
    '  const home = process.env.DSH_HOME',
    '  const keys = ["DSH_HOST_READY_FILE", "DSH_HOST_READY_NONCE", "DSH_HOST_LOCAL_LINK_PIPE"]',
    '  const snapshot = ctx.get("launchEnvironment")',
    '  if (!snapshot) throw new Error("fixture snapshot missing")',
    '  const child = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify([process.env.DSH_HOST_READY_FILE,process.env.DSH_HOST_READY_NONCE,process.env.DSH_HOST_LOCAL_LINK_PIPE]))"], { encoding: "utf8" })',
    '  writeFileSync(join(home, "environment.json"), JSON.stringify({ ambient: keys.map(k => process.env[k] ?? null), snapshot: keys.map(k => snapshot.get(k) ?? null), child: JSON.parse(child.stdout) }))',
    '  const timer = setInterval(() => { if (existsSync(join(home, "stop"))) process.emit("SIGTERM") }, 20)',
    '  ctx.effect(() => () => clearInterval(timer))',
    '  writeFileSync(join(home, "activating"), "yes")',
    '  while (!existsSync(join(home, "release"))) await new Promise(r => setTimeout(r, 10))',
    mode === 'link' ? '  ctx.provide("webServer", { port: 54321 }); ctx.provide("connection", { authenticatedUrl: base => base + "/?token=fixture_boot_link_token_0123456789" })' : '',
    mode === 'fail' ? '  throw new Error("fixture activation failed")' : '',
    mode === 'exit' ? '  ctx.appExit(0)' : '',
    mode === 'dispose' ? '  void ctx.root.fiber.dispose()' : '',
    mode === 'write-fail' ? '  writeFileSync(join(home, "ready.json"), "raced")' : '',
    '}',
  ].join('\n'))
  writeFileSync(join(bundle, 'cordis.patch.yml'), '- insert:\n    - id: readiness-fixture\n      name: ' + pathToFileURL(join(bundle, 'plugin.mjs')).href + '\n')
  const child = execa(process.execPath, ['--import', loader, runner, home], {
    cwd: home, input: '', timeout: 30_000, killSignal: 'SIGKILL', reject: false,
    env: { DSH_HOME: home, DSH_HOST_READY_FILE: file, DSH_HOST_READY_NONCE: nonce, DSH_HOST_LOCAL_LINK_PIPE: pipe, TSX_TSCONFIG_PATH: join(repo, 'tsconfig.json') },
  })
  return { home, file, child }
}
async function waitFile(file: string): Promise<void> {
  await vi.waitFor(() => { expect(existsSync(file)).toBe(true) }, { timeout: 20_000, interval: 20 })
}

describe.skipIf(process.platform !== 'win32')('real Windows runner and disposable profile boot', () => {
  it('waits for activation, subscribes after commit, and never inherits the request', async () => {
    const f = fixture()
    try {
      await waitFile(join(f.home, 'activating'))
      expect(existsSync(f.file)).toBe(false)
      expect(JSON.parse(readFileSync(join(f.home, 'environment.json'), 'utf8'))).toEqual({ ambient: [null, null, null], snapshot: [null, null, null], child: [null, null, null] })
      writeFileSync(join(f.home, 'release'), 'go')
      await waitFile(f.file)
      const record = JSON.parse(readFileSync(f.file, 'utf8')) as { nonce: string; pid: number }
      expect(record.nonce).toBe(nonce)
      expect(record.pid).toBe(f.child.pid)
      writeFileSync(join(f.home, 'stop'), 'stop')
      expect((await f.child).exitCode).toBe(0)
    } finally { f.child.kill('SIGKILL'); await f.child }
  }, 35_000)
  it('hands the local URL off only after AppReady without persisting it or inheriting bootstrap variables', async () => {
    const pipe = 'ira-dsh-link-' + randomUUID().replaceAll('-', '')
    const server = createServer()
    let packet = ''
    server.on('connection', (socket) => {
      socket.setEncoding('utf8')
      socket.on('data', (text: string) => { packet += text })
      socket.once('end', () => socket.end())
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen('\\\\.\\pipe\\' + pipe, resolve) })
    const f = fixture('link', pipe)
    try {
      await waitFile(join(f.home, 'activating'))
      expect(packet).toBe('')
      expect(JSON.parse(readFileSync(join(f.home, 'environment.json'), 'utf8'))).toEqual({ ambient: [null, null, null], snapshot: [null, null, null], child: [null, null, null] })
      writeFileSync(join(f.home, 'release'), 'go')
      await waitFile(f.file)
      await vi.waitFor(() => { expect(packet).not.toBe('') }, { timeout: 5000 })
      expect(JSON.parse(packet)).toEqual({ schemaVersion: 1, nonce, pid: f.child.pid, url: 'http://127.0.0.1:54321/?token=fixture_boot_link_token_0123456789' })
      expect(readFileSync(f.file, 'utf8')).not.toContain('fixture_boot_link_token')
      writeFileSync(join(f.home, 'stop'), 'stop')
      const result = await f.child
      expect(result.exitCode).toBe(0)
      expect(result.stdout + result.stderr).not.toContain('fixture_boot_link_token')
    } finally { f.child.kill('SIGKILL'); await f.child; await new Promise<void>(resolve => server.close(() => { resolve() })) }
  }, 35_000)
  it.each(['fail', 'exit', 'dispose', 'write-fail'] as const)('never signals successful boot for %s', async (mode) => {
    const f = fixture(mode)
    try {
      await waitFile(join(f.home, 'activating'))
      writeFileSync(join(f.home, 'release'), 'go')
      const result = await f.child
      if (mode === 'write-fail') {
        expect(readFileSync(f.file, 'utf8')).toBe('raced')
        expect(result.stderr).toContain(failed)
        expect(result.stderr).not.toContain(nonce)
        expect(result.exitCode).not.toBe(0)
      } else {
        expect(existsSync(f.file)).toBe(false)
        expect(result.exitCode).toBe(mode === 'fail' ? 1 : 0)
      }
    } finally { f.child.kill('SIGKILL'); await f.child }
  }, 35_000)
})
