import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'

export const name = 'ira-provider'
export const inject = ['sessionController', 'workspaceRegistry']

export interface Config {
  hubUrl: string
  providerId: string
  token: string
  workspaceIds: string[]
  reconnectMs?: number
}
export const Config: z<Config> = z.object({
  hubUrl: z.string().required(),
  providerId: z.string().required(),
  token: z.string().required(),
  workspaceIds: z.array(z.string()).required(),
  reconnectMs: z.number().step(1).min(100).max(60_000).default(1_000),
})

type Command = {
  type: 'dsh.command'
  commandId: string
  operation: 'session.open' | 'session.steer' | 'session.cancel'
  role: 'router' | 'owner'
  agentPreset: 'ira-intake-router' | 'ira-devloop' | 'ira-supervisor'
  workspaceId: string
  dshSessionId: string
  hubMcpUrl: string
  sessionCapability: string
  text?: string
}
type HubFrame = Command

export function apply(ctx: Context, config: Config): void {
  const abort = new AbortController()
  ctx.effect(() => {
    void connectLoop(ctx, config, abort.signal)
    return () => { abort.abort() }
  }, 'ira-provider connection')
}

async function connectLoop(ctx: Context, config: Config, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try { await connectOnce(ctx, config, signal) }
    catch (error) {
      if (!signal.aborted) ctx.logger.error(`ira-provider: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!signal.aborted) await delay(config.reconnectMs ?? 1_000, signal)
  }
}

async function connectOnce(ctx: Context, config: Config, signal: AbortSignal): Promise<void> {
  const workspaces = config.workspaceIds.map((id) => {
    const workspace = ctx.workspaceRegistry.get(WorkspaceId(id))
    if (!workspace) throw new Error(`workspace "${id}" is not registered`)
    return { workspaceId: id, cwd: workspace.path }
  })
  const url = new URL(config.hubUrl)
  url.searchParams.set('providerId', config.providerId)
  url.searchParams.set('token', config.token)
  const socket = new WebSocket(url)
  const connectorInstanceId = randomUUID()
  signal.addEventListener('abort', () => socket.close(), { once: true })
  await opened(socket)
  socket.send(JSON.stringify({
    type: 'dsh.provider.hello', providerId: config.providerId, connectorInstanceId,
    catalog: { workspaces, maxSessions: Number.MAX_SAFE_INTEGER },
  }))
  const heartbeat = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
      type: 'dsh.provider.heartbeat', providerId: config.providerId, connectorInstanceId, observedAt: new Date().toISOString(),
    }))
  }, 15_000)
  heartbeat.unref()
  try {
    await new Promise<void>((resolve) => {
      socket.addEventListener('message', (event) => {
        const command = JSON.parse(String(event.data)) as HubFrame
        void execute(ctx, config, command).then(
          () => socket.send(JSON.stringify({ type: 'dsh.command.result', commandId: command.commandId, ok: true })),
          (error: unknown) => socket.send(JSON.stringify({
            type: 'dsh.command.result', commandId: command.commandId, ok: false,
            error: error instanceof Error ? error.message : String(error),
          })),
        )
      })
      socket.addEventListener('close', () => resolve(), { once: true })
    })
  } finally { clearInterval(heartbeat) }
}

export async function execute(ctx: Context, config: Pick<Config, 'workspaceIds'>, command: Command): Promise<void> {
  if (!config.workspaceIds.includes(command.workspaceId)) throw new Error('workspace is not allowed')
  const workspace = ctx.workspaceRegistry.get(WorkspaceId(command.workspaceId))
  if (!workspace) throw new Error('workspace is not registered')
  const sessionId = SessionId(command.dshSessionId)
  if (command.operation === 'session.open') {
    await ctx.sessionController.create({
      sessionId, workspaceId: workspace.id, agentPreset: command.agentPreset,
    })
  }
  const resolved = await ctx.sessionController.resolveAgent(sessionId)
  if ('error' in resolved) throw resolved.error
  if (command.operation === 'session.open') installHubTools(resolved.agent.ctx, command)
  if (command.operation === 'session.cancel') {
    resolved.agent.cancel({ kind: 'user' }, { keepInbox: true })
    return
  }
  if (!command.text) throw new Error('command text is required')
  const text = command.operation === 'session.open'
    ? initialEnvelope(command)
    : command.text
  resolved.agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function installHubTools(ctx: Context, command: Command): void {
  const call = async (method: string, body: Record<string, unknown>) => {
    const response = await fetch(command.hubMcpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ira-session-capability': command.sessionCapability },
      body: JSON.stringify({ method, ...body }),
    })
    const result = await response.json() as { ok: boolean; value?: unknown; error?: string }
    if (!response.ok || !result.ok) throw new Error(result.error ?? `Hub returned HTTP ${response.status}`)
    return JSON.parse(JSON.stringify(result.value ?? {})) as JsonValue
  }
  const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }
  if (command.role === 'router') {
    ctx.tools.register(defineTool({
      name: 'ira_route', description: 'Route this new Teams post exactly once.',
      parameters: {
        mode: { type: 'string', required: true, enum: ['direct', 'supervisor', 'schedule'] },
        providerId: { type: 'string' }, workspaceId: { type: 'string' }, objective: { type: 'string' },
        cadence: { type: 'string' }, prompt: { type: 'string' },
      }, output, execute: args => call('route', args),
    }))
    return
  }
  ctx.tools.register(defineTool({ name: 'ira_context', description: 'Read this Teams root binding.', parameters: {}, output, execute: () => call('context', {}) }))
  for (const kind of ['progress', 'blocker', 'complete'] as const) {
    ctx.tools.register(defineTool({
      name: `ira_${kind}`, description: `Publish a Human-relevant ${kind} to the Teams thread.`,
      parameters: { text: { type: 'string', required: true } }, output, execute: args => call(kind, args),
    }))
  }
}

function initialEnvelope(command: Command): string {
  const authority = command.role === 'router'
    ? 'Call the Hub route method exactly once. Valid modes are direct, supervisor, or schedule.'
    : 'Use Hub context, progress, blocker, and complete. Publish only notable progress or Human blockers.'
  return [
    command.text,
    '',
    '<ira-hub>',
    `URL: ${command.hubMcpUrl}`,
    `Session-Capability: ${command.sessionCapability}`,
    `Authority: ${authority}`,
    '</ira-hub>',
  ].join('\n')
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('IRA Hub WebSocket failed to open')), { once: true })
  })
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}
