import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import WebSocket from 'ws'

export const name = 'ira-provider'
export const inject = ['sessionController', 'workspaceRegistry']

/** Connection identity and local workspace mapping for one outbound Provider. */
export interface Config {
  /** Authenticated Hub WebSocket endpoint. */
  hubUrl: string
  /** Stable identity presented to the Hub. */
  providerId: string
  /** Bearer credential for the Hub WebSocket handshake. */
  token: string
  /** Stable workspace names mapped to local directories, including ira-agent-platform. */
  workspaces: Record<string, string>
  /** Delay in milliseconds before reconnecting after connection failure or closure. */
  reconnectMs?: number
}
export const Config: z<Config> = z.object({
  hubUrl: z.string().required(),
  providerId: z.string().required(),
  token: z.string().required(),
  workspaces: z.dict(z.string()).required(),
  reconnectMs: z.number().step(1).min(100).max(60_000).default(1_000),
})

type Command = {
  type: 'dsh.command'
  commandId: string
  operation: 'session.open' | 'session.steer' | 'session.cancel'
  agentPreset: 'ira-intake-router' | 'ira-devloop' | 'ira-supervisor' | 'ira-schedule-manager'
  workspace: string
  dshSessionId: string
  hubMcpUrl: string
  sessionCapability: string
  text?: string
}
function validateCommand(input: unknown): asserts input is Command {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid IRA command object')
  const value = input as Record<string, unknown>
  if (value.type !== 'dsh.command') throw new Error('Invalid IRA command type')
  if (!['session.open', 'session.steer', 'session.cancel'].includes(value.operation as string)) throw new Error('Invalid IRA command operation')
  if (!['ira-intake-router', 'ira-devloop', 'ira-supervisor', 'ira-schedule-manager'].includes(value.agentPreset as string)) throw new Error('Invalid IRA command preset')
  for (const field of ['commandId', 'workspace', 'dshSessionId', 'hubMcpUrl', 'sessionCapability']) {
    if (typeof value[field] !== 'string' || !(value[field]).trim()) throw new Error('Invalid IRA command field: ' + field)
  }
  const url = URL.parse(value.hubMcpUrl as string)
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid IRA Hub tool URL')
  if (value.operation !== 'session.cancel' && (typeof value.text !== 'string' || !value.text.trim())) throw new Error('command text is required')
}

const completedCommands = new Set<string>()
const runningCommands = new Map<string, Promise<void>>()

export function apply(ctx: Context, config: Config): void {
  const abort = new AbortController()
  ctx.effect(() => {
    const running = connectLoop(ctx, config, abort.signal)
    return async () => { abort.abort(); await running }
  }, 'ira-provider connection')
}

async function connectLoop(ctx: Context, config: Config, signal: AbortSignal): Promise<void> {
  const isRunning = (): boolean => !signal.aborted
  while (isRunning()) {
    try { await connectOnce(ctx, config, signal) }
    catch (error) {
      if (!signal.aborted) ctx.logger.error(`ira-provider: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!signal.aborted) await delay(config.reconnectMs ?? 1_000, signal)
  }
}

async function connectOnce(ctx: Context, config: Config, signal: AbortSignal): Promise<void> {
  if (!Object.hasOwn(config.workspaces, 'ira-agent-platform')) throw new Error('Provider must expose the ira-agent-platform workspace')
  const resolved = await resolveWorkspaces(ctx, config.workspaces)
  if (signal.aborted) return
  const workspaces = [...resolved.keys()].map(name => ({ name }))
  const socket = new WebSocket(config.hubUrl, {
    headers: { authorization: 'Bearer ' + config.token, 'x-ira-provider-id': config.providerId },
    handshakeTimeout: 30_000,
  })
  const connectorInstanceId = randomUUID()
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let abort = (): void => {}
  const send = (frame: object): void => {
    if (socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(JSON.stringify(frame), (error) => {
        if (error) { ctx.logger.error('ira-provider: result transport failed'); socket.terminate() }
      })
    } catch {
      ctx.logger.error('ira-provider: result transport failed')
      socket.terminate()
    }
  }
  try {
    await new Promise<void>((resolve) => {
      abort = () => { socket.terminate() }
      signal.addEventListener('abort', abort, { once: true })
      socket.on('error', () => {
        ctx.logger.error('ira-provider: Hub WebSocket connection failed')
        socket.terminate()
      })
      socket.once('close', (code, reason) => {
        trace('socket.close', { connectorInstanceId, code, reason: reason.toString() })
        resolve()
      })
      socket.on('message', (data) => {
        if (signal.aborted || socket.readyState !== WebSocket.OPEN) return
        let command: unknown
        try { command = JSON.parse((Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data).toString('utf8')); validateCommand(command) }
        catch {
          ctx.logger.error('ira-provider: rejected invalid Hub command frame')
          socket.close(1008, 'Invalid IRA command')
          return
        }
        const accepted = command
        void executeOnce(ctx, { workspaces: Object.fromEntries(resolved) }, accepted).then(
          () => { send({ type: 'dsh.command.result', commandId: accepted.commandId, ok: true }) },
          (error: unknown) => { send({ type: 'dsh.command.result', commandId: accepted.commandId, ok: false,
            error: error instanceof Error ? error.message : String(error) }) },
        )
      })
      socket.once('open', () => {
        trace('socket.open', { connectorInstanceId, providerId: config.providerId })
        send({ type: 'dsh.provider.hello', providerId: config.providerId, connectorInstanceId, catalog: { workspaces } })
        let sequence = 0
        heartbeat = setInterval(() => {
          send({ type: 'dsh.provider.heartbeat', providerId: config.providerId, connectorInstanceId,
            sequence: ++sequence, observedAt: new Date().toISOString() })
        }, 15_000)
        heartbeat.unref()
      })
      if (signal.aborted) abort()
    })
  } finally {
    clearInterval(heartbeat)
    signal.removeEventListener('abort', abort)
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
  }
}

/**
 * Resolve configured directories to private DSH workspace identities, creating missing entries.
 * @param ctx - Host context owning the workspace registry.
 * @param configured - Public workspace names mapped to local directories.
 * @returns Resolved name-to-identity mapping; propagates registry failures.
 */
export async function resolveWorkspaces(ctx: Context, configured: Record<string, string>): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  for (const [name, directory] of Object.entries(configured)) {
    let workspace = await ctx.workspaceRegistry.resolveByPath(directory)
    if (!workspace) workspace = await ctx.workspaceRegistry.create(directory)
    resolved.set(name, workspace.id)
  }
  return resolved
}

/**
 * Coalesce process-local retries; success is not a durable delivery receipt.
 * @param ctx - Host context owning SessionController and WorkspaceRegistry.
 * @param config - Exposed workspace names mapped to resolved local identities.
 * @param command - Current Hub command with an immutable delivery identity.
 * @returns Shared dispatch completion for an in-flight duplicate, rejecting on dispatch failure.
 */
export function executeOnce(ctx: Context, config: Pick<Config, 'workspaces'>, command: Command): Promise<void> {
  if (completedCommands.has(command.commandId)) return Promise.resolve()
  let running = runningCommands.get(command.commandId)
  if (!running) {
    running = execute(ctx, config, command).then(() => { completedCommands.add(command.commandId) })
      .finally(() => { runningCommands.delete(command.commandId) })
    runningCommands.set(command.commandId, running)
  }
  return running
}

/**
 * Validate and dispatch a Hub command; success does not await persistence or Agent completion.
 * @param ctx - Host context owning SessionController and WorkspaceRegistry.
 * @param config - Exposed workspace names mapped to resolved local identities.
 * @param command - Command to open, steer, or cancel one Session.
 * @returns Local dispatch completion; rejects invalid commands before Session mutation.
 */
export async function execute(ctx: Context, config: Pick<Config, 'workspaces'>, command: Command): Promise<void> {
  validateCommand(command)
  const workspaceId = config.workspaces[command.workspace]
  if (!workspaceId) throw new Error('workspace is not exposed')
  const workspace = ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
  if (!workspace) throw new Error('workspace is not registered')
  const sessionId = SessionId(command.dshSessionId)
  if (command.operation === 'session.open') {
    await ctx.sessionController.create({
      sessionId, workspaceId: workspace.id, agentPreset: command.agentPreset,
    })
  }
  const resolved = await ctx.sessionController.resolveAgent(sessionId)
  if ('error' in resolved) throw resolved.error
  ensureHubTools(resolved.agent.ctx, resolved.agent, command)
  if (command.operation === 'session.cancel') {
    resolved.agent.cancel({ kind: 'user' }, { keepInbox: true })
    return
  }
  if (!command.text) throw new Error('command text is required')
  resolved.agent.steer(createUserMessage({ content: [{ type: 'text', text: command.text }], source: { kind: 'user' } }))
}

function ensureHubTools(ctx: Context, agent: unknown, command: Command): void {
  const marker = command.agentPreset === 'ira-intake-router' ? 'ira_route'
    : command.agentPreset === 'ira-schedule-manager' ? 'ira_schedule_context' : 'ira_context'
  if (!ctx.tools.get(marker, agent as never)) installHubTools(ctx, command)
  restrictPresetTools(ctx, agent, command.agentPreset)
}

const presetPolicies = new WeakMap<object, () => void>()
function restrictPresetTools(ctx: Context, agent: unknown, preset: Command['agentPreset']): void {
  const key = agent as object
  const existing = presetPolicies.get(key)
  if (existing) { existing(); return }
  const visibleMcp = preset === 'ira-intake-router' ? ['mcp__ado__']
    : preset === 'ira-devloop' || preset === 'ira-supervisor' ? ['mcp__ado__', 'mcp__kusto__', 'mcp__voice-dashboard__'] : []
  const denied = (name: string): boolean =>
    (name === 'ask_user_question' && preset === 'ira-schedule-manager')
    || (name.startsWith('mcp__') && !visibleMcp.some(prefix => name.startsWith(prefix)))
  const known = new Set<string>()
  const refresh = (): void => {
    const added = ctx.tools.schemas().map(tool => tool.name).filter(name => denied(name) && !known.has(name))
    if (!added.length) return
    // restrict emits tools/change synchronously; mark first to make re-entry inert.
    added.forEach(name => known.add(name))
    try { ctx.tools.restrict({ deny: added }) }
    catch (error) { added.forEach(name => known.delete(name)); throw error }
  }
  ctx.tools.guard(exec => denied(exec.name) ? 'Tool is not available to this IRA preset' : undefined)
  ctx.on('tools/change', refresh)
  presetPolicies.set(key, refresh)
  refresh()
}

function installHubTools(ctx: Context, command: Command): void {
  const call = async (method: string, body: Record<string, unknown>) => {
    const requestId = `tool-${command.commandId}-${method}-${Date.now()}`
    trace('tool.request', { requestId, commandId: command.commandId, method, sessionId: command.dshSessionId, capabilityHash: shortHash(command.sessionCapability) })
    const response = await fetch(command.hubMcpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ira-session-capability': command.sessionCapability, 'x-ira-request-id': requestId },
      body: JSON.stringify({ method, ...body }),
    })
    const result = await response.json() as { ok: boolean; value?: unknown; error?: string }
    trace('tool.response', { requestId, commandId: command.commandId, method, status: response.status, ok: response.ok && result.ok })
    if (!response.ok || !result.ok) throw new Error(result.error ?? `Hub returned HTTP ${response.status}`)
    return JSON.parse(JSON.stringify(result.value ?? {})) as JsonValue
  }
  const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }
  if (command.agentPreset === 'ira-intake-router') {
    ctx.tools.register(defineTool({ name: 'ira_providers', description: 'List online DSH Providers and their exposed workspace names.', parameters: {}, output, execute: () => call('providers', {}) }))
    ctx.tools.register(defineTool({
      name: 'ira_route', description: 'Route this new Teams post exactly once.',
      parameters: {
        mode: { type: 'string', required: true, enum: ['direct', 'supervisor', 'schedule'] },
        providerId: { type: 'string', description: 'Required for direct/supervisor; copy an exact providerId from ira_providers.' },
        workspace: { type: 'string', description: 'Required for direct/supervisor; copy an exact workspace name from ira_providers.' },
        objective: { type: 'string', description: 'Required and non-empty for direct/supervisor. Never use prompt for these modes.' },
      }, output, execute: (args) => {
        return call('route', args)
      },
    }))
    return
  }
  if (command.agentPreset === 'ira-schedule-manager') {
    ctx.tools.register(defineTool({ name: 'ira_schedule_context', description: 'Read the schedule bound to this management thread.', parameters: {}, output, execute: () => call('schedule.context', {}) }))
    ctx.tools.register(defineTool({ name: 'ira_schedule_create', description: 'Create this schedule definition.', parameters: { title: { type: 'string', required: true }, prompt: { type: 'string', required: true }, cadence: { type: 'string', required: true }, timeZone: { type: 'string' } }, output, execute: args => call('schedule.create', args) }))
    ctx.tools.register(defineTool({ name: 'ira_schedule_blocker', description: 'Ask for required Human input in the original Teams management thread. Use instead of ask_user_question.', parameters: { text: { type: 'string', required: true } }, output, execute: args => call('schedule.blocker', args) }))
    ctx.tools.register(defineTool({ name: 'ira_schedule_confirm', description: 'Send exactly one concise management acknowledgement to the original Teams thread after a successful mutation.', parameters: { text: { type: 'string', required: true } }, output, execute: args => call('schedule.confirm', args) }))
    ctx.tools.register(defineTool({ name: 'ira_schedule_update', description: 'Update future occurrences only.', parameters: { expectedRevision: { type: 'number', required: true }, title: { type: 'string' }, prompt: { type: 'string' }, cadence: { type: 'string' }, timeZone: { type: 'string' } }, output, execute: args => call('schedule.update', args) }))
    for (const operation of ['pause', 'resume', 'delete', 'restore'] as const) ctx.tools.register(defineTool({ name: `ira_schedule_${operation}`, description: `${operation} this schedule.`, parameters: { expectedRevision: { type: 'number', required: true } }, output, execute: args => call(`schedule.${operation}`, args) }))
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


function shortHash(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 12) }
function trace(event: string, fields: Record<string, unknown>): void { console.log(JSON.stringify({ component: 'ira-provider', event, pid: process.pid, at: new Date().toISOString(), ...fields })) }

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}
