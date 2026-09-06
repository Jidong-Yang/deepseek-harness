import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { execute, executeOnce, resolveWorkspaces } from '../src/index.ts'

function harness() {
  const steer = vi.fn<(message: UserMessage) => void>()
  const cancel = vi.fn()
  const installed = new Map<string, unknown>()
  const register = vi.fn((tool: { name: string }) => { installed.set(tool.name, tool) })
  const globalNames = ['ask_user_question', 'mcp__ado__wit_work_item', 'mcp__kusto__kusto_query', 'mcp__voice-dashboard__voice_dashboard_query_metric']
  const get = vi.fn((name: string) => installed.get(name))
  const schemas = vi.fn(() => globalNames.map(name => ({ name })))
  const restrict = vi.fn()
  const agent = { steer, cancel, ctx: { on: vi.fn(), tools: { register, get, schemas, restrict, guard: vi.fn() } } }
  let preset = 'ira-devloop'
  const create = vi.fn(async (options: { agentPreset: string }) => { preset = options.agentPreset; return { sessionId: SessionId('dsh-1') } })
  const resolvePreset = vi.fn(async (id: string): Promise<{ id: string; broken?: string }> => ({ id }))
  const composedPreset = vi.fn(() => preset)
  const resolveAgent = vi.fn(async () => ({ agent }))
  const ctx = {
    workspaceRegistry: { get: (id: string) => id === 'workspace-a' ? { id, path: 'C:/work/a' } : undefined },
    sessionController: { create, resolveAgent },
    agentPresets: { resolve: resolvePreset, composedPreset },
  } as unknown as Context
  return { ctx, create, resolveAgent, steer, cancel, register, get, schemas, restrict, installed, resolvePreset, composedPreset }
}

describe('embedded IRA Provider', () => {
  it('resolves existing paths and creates missing DSH workspaces', async () => {
    const existing = { id: 'existing' }
    const created = { id: 'created' }
    const createMissing = vi.fn(async () => created)
    const ctx = { workspaceRegistry: {
      resolveByPath: vi.fn(async (path: string) => path === 'C:/existing' ? existing : undefined),
      create: createMissing,
    } } as unknown as Context
    const result = await resolveWorkspaces(ctx, { existing: 'C:/existing', missing: 'C:/missing' })
    expect(Object.fromEntries(result)).toEqual({ existing: 'existing', missing: 'created' })
    expect(createMissing).toHaveBeenCalledWith('C:/missing')
  })

  it('opens one visible DSH session and steers its initial turn', async () => {
    const test = harness()
    await execute(test.ctx, { workspaces: { 'ira-agent-platform': 'workspace-a' } }, {
      type: 'dsh.command', commandId: 'c1', operation: 'session.open',
      agentPreset: 'ira-intake-router', workspace: 'ira-agent-platform', dshSessionId: 'dsh-1', hubMcpUrl: 'https://hub.example/mcp', sessionCapability: 'router-capability', text: 'start',
    })
    expect(test.create).toHaveBeenCalledWith({ sessionId: SessionId('dsh-1'), workspaceId: 'workspace-a', agentPreset: 'ira-intake-router' })
    expect(test.steer).toHaveBeenCalledOnce()
    expect(test.steer.mock.calls[0]?.[0].content).toEqual([{ type: 'text', text: 'start' }])
    expect(JSON.stringify(test.steer.mock.calls[0]?.[0])).not.toContain('router-capability')
    expect(JSON.stringify(test.steer.mock.calls[0]?.[0])).not.toContain('hub.example')
    expect(test.register).toHaveBeenCalledTimes(3)
    expect(test.register.mock.calls.map(call => call[0].name)).toEqual(['ira_context', 'ira_providers', 'ira_route'])
  })

  it('steers the same session without creating another one', async () => {
    const test = harness()
    await execute(test.ctx, { workspaces: { 'ira-agent-platform': 'workspace-a' } }, {
      type: 'dsh.command', commandId: 'c2', operation: 'session.steer',
      agentPreset: 'ira-devloop', workspace: 'ira-agent-platform', dshSessionId: 'dsh-1', hubMcpUrl: 'https://hub.example/mcp', sessionCapability: 'owner-capability', text: 'change direction',
    })
    expect(test.create).not.toHaveBeenCalled()
    expect(test.resolveAgent).toHaveBeenCalledWith(SessionId('dsh-1'))
    expect(test.steer).toHaveBeenCalledOnce()
    expect(test.register).toHaveBeenCalledTimes(4)
    expect(test.register.mock.calls.map(call => call[0].name)).toEqual(['ira_context', 'ira_progress', 'ira_blocker', 'ira_complete'])
    await execute(test.ctx, { workspaces: { 'ira-agent-platform': 'workspace-a' } }, {
      type: 'dsh.command', commandId: 'c2b', operation: 'session.steer',
      agentPreset: 'ira-devloop', workspace: 'ira-agent-platform', dshSessionId: 'dsh-1', hubMcpUrl: 'https://hub.example/mcp', sessionCapability: 'owner-capability', text: 'again',
    })
    expect(test.register).toHaveBeenCalledTimes(4)
    expect(test.steer).toHaveBeenCalledTimes(2)
  })

  it('removes Web-only questions from Schedule Manager scope', async () => {
    const test = harness()
    await execute(test.ctx, { workspaces: { 'ira-agent-platform': 'workspace-a' } }, {
      type: 'dsh.command', commandId: 'schedule-open', operation: 'session.open', agentPreset: 'ira-schedule-manager',
      workspace: 'ira-agent-platform', dshSessionId: 'manager', hubMcpUrl: 'https://hub.example/mcp', sessionCapability: 'manager-capability', text: 'manage',
    })
    expect(test.restrict).toHaveBeenCalledWith({ deny: ['ask_user_question', 'mcp__ado__wit_work_item', 'mcp__kusto__kusto_query', 'mcp__voice-dashboard__voice_dashboard_query_metric'] })
    expect(test.register.mock.calls.map(call => call[0].name)).toContain('ira_schedule_blocker')
  })

  it.each([
    ['ira-intake-router', ['mcp__kusto__kusto_query', 'mcp__voice-dashboard__voice_dashboard_query_metric']],
    ['ira-devloop', []], ['ira-supervisor', []],
    ['ira-devloop-worker', ['ask_user_question']],
    ['ira-e2e-validator', ['ask_user_question', 'mcp__ado__wit_work_item', 'mcp__kusto__kusto_query', 'mcp__voice-dashboard__voice_dashboard_query_metric']],
    ['ira-schedule-manager', ['ask_user_question', 'mcp__ado__wit_work_item', 'mcp__kusto__kusto_query', 'mcp__voice-dashboard__voice_dashboard_query_metric']],
  ] as const)('restricts global MCPs for %s', async (preset, denied) => {
    const test = harness()
    await execute(test.ctx, { workspaces: { 'ira-agent-platform': 'workspace-a' } }, { type: 'dsh.command', commandId: 'matrix-' + preset, operation: 'session.open', agentPreset: preset, workspace: 'ira-agent-platform', dshSessionId: 'matrix', hubMcpUrl: 'https://hub.example/mcp', sessionCapability: 'cap', text: 'test' })
    if (denied.length) expect(test.restrict).toHaveBeenCalledWith({ deny: [...denied] })
    else expect(test.restrict).not.toHaveBeenCalled()
  })

  it('adds restrictions for MCP tools discovered after session open', async () => {
    const test = harness()
    const command = { type: 'dsh.command' as const, commandId: 'dynamic-open', operation: 'session.open' as const, agentPreset: 'ira-intake-router' as const, workspace: 'ira-agent-platform', dshSessionId: 'dynamic', hubMcpUrl: 'https://hub.example/mcp', sessionCapability: 'cap', text: 'open' }
    await execute(test.ctx, { workspaces: { 'ira-agent-platform': 'workspace-a' } }, command)
    test.schemas.mockImplementation(() => [...['ask_user_question', 'mcp__ado__wit_work_item', 'mcp__kusto__kusto_query', 'mcp__voice-dashboard__voice_dashboard_query_metric', 'mcp__kusto__new_tool'].map(name => ({ name }))])
    await execute(test.ctx, { workspaces: { 'ira-agent-platform': 'workspace-a' } }, { ...command, commandId: 'dynamic-steer', operation: 'session.steer', text: 'again' })
    expect(test.restrict).toHaveBeenLastCalledWith({ deny: ['mcp__kusto__new_tool'] })
  })

  it('joins and remembers duplicate command IDs', async () => {
    const test = harness()
    const command = {
      type: 'dsh.command' as const, commandId: `duplicate-${Date.now()}`, operation: 'session.open' as const,
      agentPreset: 'ira-devloop' as const, workspace: 'ira-agent-platform', dshSessionId: 'dedup-session',
      hubMcpUrl: 'https://hub.example/mcp', sessionCapability: 'owner-capability', text: 'once',
    }
    await Promise.all([executeOnce(test.ctx, { workspaces: { 'ira-agent-platform': 'workspace-a' } }, command), executeOnce(test.ctx, { workspaces: { 'ira-agent-platform': 'workspace-a' } }, command)])
    await executeOnce(test.ctx, { workspaces: { 'ira-agent-platform': 'workspace-a' } }, command)
    expect(test.create).toHaveBeenCalledOnce()
    expect(test.steer).toHaveBeenCalledOnce()
  })

  it.each([
    { operation: 'session.unknown' }, { agentPreset: 'old-router' },
    { commandId: '' }, { type: 'not-a-command' }, { text: '   ' },
    { workspace: '' }, { dshSessionId: '' }, { hubMcpUrl: 'file:///bad' },
    { sessionCapability: '' },
  ])('rejects malformed commands before any Session mutation: %j', async (patch) => {
    const test = harness()
    const command = { type: 'dsh.command', commandId: 'invalid-input', operation: 'session.open',
      agentPreset: 'ira-devloop', workspace: 'ira-agent-platform', dshSessionId: 'invalid-session',
      hubMcpUrl: 'https://hub.example/mcp', sessionCapability: 'cap', text: 'test', ...patch,
    }
    await expect(execute(test.ctx, { workspaces: { 'ira-agent-platform': 'workspace-a' } }, command as Parameters<typeof execute>[2])).rejects.toThrow()
    expect(test.create).not.toHaveBeenCalled()
    expect(test.resolveAgent).not.toHaveBeenCalled()
    expect(test.steer).not.toHaveBeenCalled()
  })

  it.each(['missing', 'broken'])('rejects an unavailable child preset before create: %s', async (state) => {
    const test = harness()
    if (state === 'missing') test.resolvePreset.mockRejectedValue(new Error('preset not found'))
    else test.resolvePreset.mockResolvedValue({ id: 'ira-devloop-worker', broken: 'missing plugin' })
    await expect(execute(test.ctx, { workspaces: { repo: 'workspace-a' } }, {
      type: 'dsh.command', commandId: 'unavailable-' + state, operation: 'session.open',
      agentPreset: 'ira-devloop-worker', workspace: 'repo', dshSessionId: 'child',
      hubMcpUrl: 'https://unused.invalid', sessionCapability: 'cap', text: 'work',
    })).rejects.toThrow()
    expect(test.create).not.toHaveBeenCalled()
    expect(test.resolveAgent).not.toHaveBeenCalled()
    expect(test.register).not.toHaveBeenCalled()
  })

  it.each(['session.open', 'session.steer', 'session.cancel'] as const)('refuses a mismatched actual preset on %s before role installation', async (operation) => {
    const test = harness()
    test.composedPreset.mockReturnValue('ira-devloop-worker')
    await expect(execute(test.ctx, { workspaces: { repo: 'workspace-a' } }, {
      type: 'dsh.command', commandId: 'mismatch-' + operation, operation,
      agentPreset: 'ira-supervisor', workspace: 'repo', dshSessionId: 'child',
      hubMcpUrl: 'https://unused.invalid', sessionCapability: 'cap', text: 'work',
    })).rejects.toThrow('does not match the Session composition')
    expect(test.register).not.toHaveBeenCalled()
    expect(test.steer).not.toHaveBeenCalled()
    expect(test.cancel).not.toHaveBeenCalled()
  })

  it('rejects workspaces outside the configured mapping', async () => {
    const test = harness()
    await expect(execute(test.ctx, { workspaces: { 'ira-agent-platform': 'workspace-a' } }, {
      type: 'dsh.command', commandId: 'c3', operation: 'session.open',
      agentPreset: 'ira-devloop', workspace: 'missing', dshSessionId: 'dsh-2', hubMcpUrl: 'https://hub.example/mcp', sessionCapability: 'owner-capability', text: 'no',
    })).rejects.toThrow('workspace is not exposed')
    expect(test.create).not.toHaveBeenCalled()
  })
})
