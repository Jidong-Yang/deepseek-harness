import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
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
  agentPreset: 'ira-intake-router' | 'ira-devloop'
  workspaceId: string
  dshSessionId: string
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
  if (command.operation === 'session.cancel') {
    resolved.agent.cancel({ kind: 'user' }, { keepInbox: true })
    return
  }
  if (!command.text) throw new Error('command text is required')
  resolved.agent.steer(createUserMessage({ content: [{ type: 'text', text: command.text }], source: { kind: 'user' } }))
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
