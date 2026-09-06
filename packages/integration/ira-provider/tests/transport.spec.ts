import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { WebSocketServer, WebSocket } from 'ws'
import { apply } from '../src/index.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function serverFixture() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.once('listening', resolve))
  cleanup.push(async () => {
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  })
  const address = server.address()
  if (typeof address === 'string' || !address) throw new Error('missing address')
  return { server, url: 'ws://127.0.0.1:' + String(address.port) }
}

function startProvider(url: string) {
  const installed = new Map<string, unknown>()
  const steer = vi.fn()
  const create = vi.fn(async () => ({}))
  const errors = vi.fn()
  const agent = { steer, cancel: vi.fn(), ctx: { on: vi.fn(), tools: {
    register: (tool: { name: string }) => installed.set(tool.name, tool),
    get: (name: string) => installed.get(name), schemas: () => [], restrict: vi.fn(), guard: vi.fn(),
  } } }
  let stop!: () => Promise<void>
  apply({ effect: (fn: () => () => Promise<void>) => { stop = fn() }, logger: { error: errors },
    workspaceRegistry: { resolveByPath: async () => ({ id: 'w' }), get: () => ({ id: 'w' }) },
    sessionController: { create, resolveAgent: async () => ({ agent }) },
  } as unknown as Context, { hubUrl: url, providerId: 'test-box', token: 'not-a-real-token',
    workspaces: { 'ira-agent-platform': 'C:/test' }, reconnectMs: 100,
  })
  cleanup.push(async () => { await stop() })
  return { create, steer, errors, stop }
}

function command(commandId: string) {
  return { type: 'dsh.command', commandId, operation: 'session.open', agentPreset: 'ira-devloop',
    workspace: 'ira-agent-platform', dshSessionId: commandId, hubMcpUrl: 'https://unused.invalid',
    sessionCapability: 'secret-do-not-log', text: 'test',
  }
}

describe('Provider WebSocket error containment', () => {
  it.each(['{', JSON.stringify({ ...command('bad'), operation: 'unknown' })])('rejects invalid frame then reconnects: %s', async (invalid) => {
    const { server, url } = await serverFixture()
    let connections = 0
    const results: Array<{ type: string; ok?: boolean }> = []
    server.on('connection', (socket) => {
      const ordinal = ++connections
      socket.on('message', (data) => {
        const frame = JSON.parse((Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data).toString('utf8')) as { type: string; ok?: boolean }
        if (frame.type === 'dsh.provider.hello') socket.send(ordinal === 1 ? invalid : JSON.stringify(command('valid-' + randomUUID())))
        else results.push(frame)
      })
    })
    const provider = startProvider(url)
    await vi.waitFor(() =>{  expect(results.some(frame => frame.type === 'dsh.command.result' && frame.ok)).toBe(true) }, { timeout: 4000 })
    expect(provider.create).toHaveBeenCalledOnce()
    expect(provider.steer).toHaveBeenCalledOnce()
    expect(provider.errors).toHaveBeenCalled()
    expect(JSON.stringify(provider.errors.mock.calls)).not.toContain('secret-do-not-log')
  })

  it('disposes the active connection without scheduling a replacement', async () => {
    const { server, url } = await serverFixture()
    let socket!: WebSocket
    server.once('connection', (connected) => { socket = connected })
    const provider = startProvider(url)
    await vi.waitFor(() =>{  expect(socket?.readyState).toBe(WebSocket.OPEN) })
    const closed = new Promise<void>(resolve => socket.once('close', () =>{  resolve() }))
    await provider.stop()
    await closed
    expect(server.clients.size).toBe(0)
  })
})
