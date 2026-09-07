import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { execute } from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function tool(name: string) {
  return { name, description: name, parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] },
    execute: vi.fn(async () => 'executed'),
  } satisfies ToolDefinition
}

async function fixture(preset: Parameters<typeof execute>[2]['agentPreset']) {
  const ctx = new Context()
  const prompt = ctx.plugin(SystemPrompt, {})
  await prompt
  const tools = ctx.plugin(ToolRuntime)
  await tools
  cleanups.push(async () => { await tools.dispose(); await prompt.dispose() })
  const agent = { id: SessionId('visibility-' + preset), steer: vi.fn(), cancel: vi.fn() } as unknown as Agent
  let scope!: Scope
  const minter = ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, { inject: ['tools', 'systemPrompt'] }))
  await minter
  Object.assign(agent, { ctx: scope.ctx })
  cleanups.push(async () => { await scope.dispose(); await minter.dispose() })
  ctx.tools.register(tool('ask_user_question'))
  const provider = { agentPresets: { resolve: async (id: string) => ({ id }), composedPreset: () => preset }, workspaceRegistry: { get: () => ({ id: 'w' }) }, sessionController: {
    create: async () => ({}), resolveAgent: async () => ({ agent }),
  } } as unknown as Context
  await execute(provider, { workspaces: { repo: 'w' } }, { type: 'dsh.command', commandId: preset,
    operation: 'session.open', agentPreset: preset, workspace: 'repo', dshSessionId: agent.id,
    hubMcpUrl: 'https://unused.invalid', sessionCapability: 'unused', text: 'test',
  })
  return { ctx, agent, scope }
}

describe('global MCP visibility after server recovery', () => {
  it.each(['ira-intake-router', 'ira-schedule-manager', 'ira-e2e-validator'] as const)('keeps late tools hidden and uncallable for %s without a new steer', async (preset) => {
    const { ctx, agent } = await fixture(preset)
    const name = 'mcp__voice-dashboard__recovered_tool'
    const recovered = tool(name)
    const dispose = ctx.tools.register(recovered)
    expect(ctx.tools.schemas(agent).map(t => t.name)).not.toContain(name)
    const result = await ctx.tools.execute({ agent, name, callId: ToolCallId('late'), arguments: {}, signal: new AbortController().signal })
    expect(result.content).not.toEqual([{ type: 'text', text: 'executed' }])
    expect(recovered.execute).not.toHaveBeenCalled()
    expect(ctx.tools.schemas().map(t => t.name)).toContain(name)
    dispose()
    ctx.tools.register(tool(name))
    expect(ctx.tools.schemas(agent).map(t => t.name)).not.toContain(name)
    const newName = 'mcp__kusto__new_query'
    ctx.tools.register(tool(newName))
    expect(ctx.tools.schemas(agent).map(t => t.name)).not.toContain(newName)
  })

  it.each(['ira-devloop', 'ira-supervisor', 'ira-devloop-worker'] as const)('keeps permitted late tools available for %s', async (preset) => {
    const { ctx, agent } = await fixture(preset)
    const name = 'mcp__kusto__recovered_query'
    ctx.tools.register(tool(name))
    expect(ctx.tools.schemas(agent).map(t => t.name)).toContain(name)
  })
})

async function invoke(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>) {
  return ctx.tools.execute({ agent, name, callId: ToolCallId('role-tool'), arguments: args, signal: new AbortController().signal })
}

describe('bounded child tool contract', () => {
  it.each(['ira-intake-router', 'ira-devloop', 'ira-supervisor', 'ira-schedule-manager', 'ira-devloop-worker', 'ira-e2e-validator'] as const)('keeps own context available to %s', async (preset) => {
    const { ctx, agent } = await fixture(preset)
    const request = vi.fn<typeof fetch>(async () => Response.json({ ok: true, value: { sessionId: agent.id, parentRootId: 'parent-root' } }))
    vi.stubGlobal('fetch', request)
    const result = await invoke(ctx, agent, 'ira_context', {})
    expect(result.isError).not.toBe(true)
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({ method: 'context' })
    expect(JSON.stringify(result.content)).toContain('parent-root')
  })

  it.each([
    { action: 'create', agentPreset: 'ira-devloop-worker', providerId: 'box', workspace: 'repo', text: 'Implement only this change.' },
    { action: 'create', agentPreset: 'ira-e2e-validator', providerId: 'box', workspace: 'repo', text: 'Validate the frozen build.' },
    { action: 'continue', taskId: 'task', text: 'Narrow the assignment.' },
    { action: 'settle', taskId: 'task' },
    { action: 'resume', taskId: 'task', text: 'Resume with this new instruction.' },
  ])('dispatches supervisor child action %j', async (args) => {
    const { ctx, agent } = await fixture('ira-supervisor')
    const request = vi.fn<typeof fetch>(async () => Response.json({ ok: true, value: { taskId: 'task' } }))
    vi.stubGlobal('fetch', request)
    const result = await invoke(ctx, agent, 'ira_child_task', args)
    expect(result.isError).not.toBe(true)
    expect(request).toHaveBeenCalledOnce()
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({ method: 'child.task', ...args })
    expect(request.mock.calls[0]![1]!.headers).toMatchObject({ 'x-ira-session-capability': 'unused' })
    expect(ctx.tools.schemas(agent).map(t => t.name)).toEqual(expect.arrayContaining([
      'ira_context', 'ira_providers', 'ira_progress', 'ira_blocker', 'ira_complete', 'ira_child_task',
    ]))
  })

  it.each([
    { action: 'create' },
    { action: 'create', agentPreset: 'ira-supervisor', providerId: 'box', workspace: 'repo', text: 'wrong role' },
    { action: 'create', agentPreset: 'ira-devloop-worker', providerId: ' ', workspace: 'repo', text: 'work' },
    { action: 'create', agentPreset: 'ira-e2e-validator', providerId: 'box', workspace: '', text: 'validate' },
    { action: 'create', agentPreset: 'ira-devloop-worker', providerId: 'box', workspace: 'repo' },
    { action: 'continue', text: 'missing task' },
    { action: 'continue', taskId: 'task', text: ' ' },
    { action: 'settle', taskId: '' },
    { action: 'resume', taskId: 'task' },
    { action: 'unknown', taskId: 'task', text: 'bad action' },
  ])('rejects malformed child action before Hub dispatch: %j', async (args) => {
    const { ctx, agent } = await fixture('ira-supervisor')
    const request = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', request)
    const result = await invoke(ctx, agent, 'ira_child_task', args)
    expect(result.isError).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['ira-intake-router', 'ira-devloop', 'ira-schedule-manager', 'ira-devloop-worker', 'ira-e2e-validator'] as const)('does not install Supervisor child dispatch for %s', async (preset) => {
    const { ctx, agent } = await fixture(preset)
    expect(ctx.tools.schemas(agent).map(t => t.name)).not.toContain('ira_child_task')
    expect((await invoke(ctx, agent, 'ira_child_task', { action: 'settle', taskId: 'task' })).isError).toBe(true)
  })

  it.each(['ira-devloop-worker', 'ira-e2e-validator'] as const)('denies late delegation and owner reporting for %s even after pre-execute allows', async (preset) => {
    const { ctx, agent, scope } = await fixture(preset)
    scope.ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' }), { prepend: true })
    for (const name of ['subagent', 'subagent_fork', 'subagent_codex', 'subagent_claude_code', 'workflow', 'ralph', 'send_message', 'interrupt_agent', 'list_agents', 'ira_child_task', 'ira_complete', 'ira_progress', 'ira_blocker']) {
      const forbidden = tool(name)
      ctx.tools.register(forbidden)
      expect(ctx.tools.schemas(agent).map(t => t.name)).not.toContain(name)
      expect((await invoke(ctx, agent, name, {})).isError).toBe(true)
      expect(forbidden.execute).not.toHaveBeenCalled()
      // Same-scope registrations cannot be hidden by inherited-name restrictions.
      // A shadow must still hit the monotonic guard after an explicit allow.
      const shadow = tool(name)
      const dispose = scope.ctx.tools.register(shadow)
      expect(ctx.tools.schemas(agent).map(t => t.name)).toContain(name)
      const guarded = await invoke(ctx, agent, name, {})
      expect(guarded.isError).toBe(true)
      expect(JSON.stringify(guarded.content)).toContain('Tool is not available to this IRA preset')
      expect(shadow.execute).not.toHaveBeenCalled()
      dispose()
    }
    expect(ctx.tools.schemas(agent).filter(t => t.name.startsWith('ira_')).map(t => t.name).sort()).toEqual(['ira_child_report', 'ira_context'])
  })

  it.each([{ kind: 'progress', text: '' }, { kind: 'complete', text: '  ' }, { kind: 'owner.complete', text: 'wrong kind' }])('rejects invalid child report: %j', async (args) => {
    const { ctx, agent } = await fixture('ira-devloop-worker')
    const request = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', request)
    expect((await invoke(ctx, agent, 'ira_child_report', args)).isError).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })
})

it('uses Session and tool-call identity, not wall-clock time, for child operations', async () => {
  const { ctx, agent } = await fixture('ira-supervisor')
  const request = vi.fn<typeof fetch>(async () => Response.json({ ok: true, value: { taskId: 'task' } }))
  vi.stubGlobal('fetch', request)
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const args = { action: 'create', agentPreset: 'ira-devloop-worker', providerId: 'box', workspace: 'repo', text: 'bounded work' }
  const invokeCall = (id: string) => ctx.tools.execute({ agent, name: 'ira_child_task', callId: ToolCallId(id), arguments: args, signal: new AbortController().signal })
  try {
    expect((await invokeCall('first')).isError).not.toBe(true)
    expect((await invokeCall('second')).isError).not.toBe(true)
    clock.mockReturnValue(2000)
    expect((await invokeCall('first')).isError).not.toBe(true)
    const ids = request.mock.calls.map(([, init]) => new Headers(init!.headers).get('x-ira-request-id'))
    expect(ids[0]).not.toBe(ids[1])
    expect(ids[2]).toBe(ids[0])
  }
  finally { clock.mockRestore() }
})

it.each(['subagent', 'subagent_fork', 'workflow', 'ralph', 'spawn_teammate'])('Supervisor uses Hub child tasks rather than inherited %s', async (name) => {
  const { ctx, agent } = await fixture('ira-supervisor')
  const inherited = tool(name)
  ctx.tools.register(inherited)
  expect(ctx.tools.schemas(agent).map(item => item.name)).not.toContain(name)
  const result = await invoke(ctx, agent, name, {})
  expect(result.isError).toBe(true)
  expect(inherited.execute).not.toHaveBeenCalled()
  expect(ctx.tools.schemas(agent).map(item => item.name)).toContain('ira_child_task')
})

it('cannot redirect a child report to an owner Hub method through extra arguments', async () => {
  const { ctx, agent } = await fixture('ira-devloop-worker')
  const request = vi.fn<typeof fetch>(async () => Response.json({ ok: true, value: { accepted: true } }))
  vi.stubGlobal('fetch', request)
  const result = await invoke(ctx, agent, 'ira_child_report', { kind: 'complete', text: 'ready for review', method: 'complete' })
  expect(result.isError).not.toBe(true)
  const value: unknown = JSON.parse(request.mock.calls[0]![1]!.body as string)
  expect(value).toEqual({ kind: 'complete', text: 'ready for review', method: 'child.report' })
})
