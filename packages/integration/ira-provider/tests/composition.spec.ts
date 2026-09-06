/** IRA command admission and transport disposal through the real app-boot Loader. */
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as SessionStore from '@deepseek-ai/dsh-session'
import * as SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolRuntime from '@deepseek-ai/dsh-tools'
import * as IraProvider from '../src/index.ts'
import * as ExternalWebHost from './fixtures/composition-services.ts'
import { WebSocket, WebSocketServer } from 'ws'
import type { ControllerProbe } from './fixtures/composition-services.ts'

let ctx: Context | undefined
let server: WebSocketServer | undefined
let directory: string | undefined

afterEach(async () => {
  try {
    await ctx?.fiber.dispose()
  } finally {
    try {
      if (server) {
        for (const socket of server.clients) socket.terminate()
        await new Promise<void>((resolve, reject) => {
          server!.close((error) => {
            if (error) reject(error)
            else resolve()
          })
        })
      }
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      ctx = undefined
      server = undefined
      directory = undefined
    }
  }
})

it('rejects an invalid Hub frame before Session mutation, reconnects and delivers, then closes on Loader disposal', async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-ira-composition-'))
  server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing loopback address')

  const connections: Array<{
    socket: WebSocket
    frames: Array<Record<string, unknown>>
    close?: { code: number; reason: string }
  }> = []
  server.on('connection', (socket) => {
    const connection: typeof connections[number] = { socket, frames: [] }
    connections.push(connection)
    socket.on('message', (data) => {
      const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
      connection.frames.push(JSON.parse(buffer.toString('utf8')) as Record<string, unknown>)
    })
    socket.once('close', (code, reason) => { connection.close = { code, reason: reason.toString() } })
  })

  const configPath = join(directory, 'cordis.yml')
  await writeFile(configPath, [
    '- id: ira-provider',
    '  name: cordis:ira-provider',
    '  config:',
    '    hubUrl: ' + JSON.stringify('ws://127.0.0.1:' + String(address.port)),
    '    providerId: composition-provider',
    '    token: fixture-only-token',
    '    reconnectMs: 100',
    '    workspaces:',
    '      ira-agent-platform: ' + JSON.stringify(directory),
    '- id: sessions',
    '  name: cordis:sessions',
    '- id: system-prompt',
    '  name: cordis:system-prompt',
    '- id: tools',
    '  name: cordis:tools',
    '- id: external-web-host',
    '  name: cordis:external-web-host',
    '  config:',
    '    workspacePath: ' + JSON.stringify(directory),
    '',
  ].join('\n'))
  // Register actual namespaces, not apply() wrappers: Loader still unwraps exports,
  // validates Config, and waits for inject. Builtins keep native imports out of lib/.
  ctx = await boot('ira-provider-composition', configPath, undefined, (host) => {
    Object.assign(host.loader.builtins, {
      'ira-provider': IraProvider, sessions: SessionStore,
      'system-prompt': SystemPrompt, tools: ToolRuntime,
      'external-web-host': ExternalWebHost,
    })
  })
  const controller = ctx.get('sessionController') as unknown as ControllerProbe
  const sessions = ctx.get('sessions')!
  const tools = ctx.get('tools')!
  const provider = [...ctx.loader.entries()].find(entry => entry.options.id === 'ira-provider')
  expect(provider?.fiber).toBeDefined()

  await vi.waitFor(() => {
    expect(connections[0]?.frames[0]).toMatchObject({
      type: 'dsh.provider.hello', providerId: 'composition-provider',
      catalog: { workspaces: [{ name: 'ira-agent-platform' }] },
    })
  }, { timeout: 10_000 })
  const command = {
    type: 'dsh.command', commandId: randomUUID(), operation: 'session.open',
    agentPreset: 'ira-devloop', workspace: 'ira-agent-platform',
    dshSessionId: 'composition-' + randomUUID(), hubMcpUrl: 'https://unused.invalid/mcp',
    sessionCapability: 'fixture-private-capability', text: 'Deliver after reconnect',
  }
  connections[0]!.socket.send(JSON.stringify({ ...command, operation: 'session.unknown' }))
  await vi.waitFor(() => {
    expect(connections[0]!.close).toEqual({
      code: 1008, reason: 'Invalid IRA command',
    })
  }, { timeout: 10_000 })
  // Hold the valid frame until after rejection: a later success cannot hide an invalid mutation.
  expect(sessions.list()).toEqual([])
  expect(controller.creates).toEqual([])
  expect(controller.resolves).toEqual([])
  expect(controller.messages).toEqual([])
  expect(controller.cancellations).toBe(0)
  expect(tools.schemas().map(tool => tool.name)).not.toContain('ira_context')

  await vi.waitFor(() => {
    expect(connections[1]?.frames[0]).toMatchObject({
      type: 'dsh.provider.hello', providerId: 'composition-provider',
    })
  }, { timeout: 10_000 })
  expect(connections[1]!.frames[0]!.connectorInstanceId).not.toBe(connections[0]!.frames[0]!.connectorInstanceId)
  connections[1]!.socket.send(JSON.stringify(command))
  await vi.waitFor(() => {
    expect(connections[1]!.frames).toContainEqual({
      type: 'dsh.command.result', commandId: command.commandId, ok: true,
    })
  }, { timeout: 10_000 })
  expect(controller.creates).toEqual([{
    sessionId: command.dshSessionId, workspaceId: 'composition-workspace', agentPreset: 'ira-devloop',
  }])
  expect(controller.resolves).toEqual([command.dshSessionId])
  expect(sessions.list().map(session => session.id)).toEqual([SessionId(command.dshSessionId)])
  expect(controller.messages).toHaveLength(1)
  expect(controller.messages[0]).toMatchObject({
    content: [{ type: 'text', text: command.text }], source: { kind: 'user' },
  })
  expect(JSON.stringify(controller.messages)).not.toContain(command.sessionCapability)
  expect(JSON.stringify(controller.messages)).not.toContain(command.hubMcpUrl)
  expect(tools.schemas(controller.agent).map(tool => tool.name)).toEqual(expect.arrayContaining([
    'ira_context', 'ira_progress', 'ira_blocker', 'ira_complete',
  ]))

  const transportClosed = once(connections[1]!.socket, 'close')
  await provider!.fiber!.dispose()
  await transportClosed
  expect(connections[1]!.socket.readyState).toBe(WebSocket.CLOSED)
  expect(server.clients.size).toBe(0)
  expect(connections).toHaveLength(2)
  expect(sessions.list()).toHaveLength(1) // Provider unload does not own the Web Host session.
  await ctx.fiber.dispose()
  expect(sessions.list()).toEqual([])
  expect(tools.schemas(controller.agent).map(tool => tool.name)).not.toContain('ira_context')
  expect(ctx.get('sessionController')).toBeUndefined()
})
