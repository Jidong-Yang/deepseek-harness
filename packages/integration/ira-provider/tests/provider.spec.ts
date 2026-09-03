import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { execute, executeOnce, resolveWorkspaces } from '../src/index.ts'

function harness() {
  const steer = vi.fn()
  const cancel = vi.fn()
  const register = vi.fn()
  const agent = { steer, cancel, ctx: { tools: { register } } }
  const create = vi.fn(async () => ({ sessionId: SessionId('dsh-1') }))
  const resolveAgent = vi.fn(async () => ({ agent }))
  const ctx = {
    workspaceRegistry: { get: (id: string) => id === 'workspace-a' ? { id, path: 'C:/work/a' } : undefined },
    sessionController: { create, resolveAgent },
  } as unknown as Context
  return { ctx, create, resolveAgent, steer, cancel, register }
}

describe('embedded IRA Provider', () => {
  it('resolves existing paths and creates missing DSH workspaces', async () => {
    const existing = { id: 'existing' }
    const created = { id: 'created' }
    const ctx = { workspaceRegistry: {
      resolveByPath: vi.fn(async (path: string) => path === 'C:/existing' ? existing : undefined),
      create: vi.fn(async () => created),
    } } as unknown as Context
    const result = await resolveWorkspaces(ctx, { existing: 'C:/existing', missing: 'C:/missing' })
    expect(Object.fromEntries(result)).toEqual({ existing: 'existing', missing: 'created' })
    expect(ctx.workspaceRegistry.create).toHaveBeenCalledWith('C:/missing')
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
    expect(test.register).toHaveBeenCalledTimes(2)
    expect(test.register.mock.calls.map(call => call[0].name)).toEqual(['ira_providers', 'ira_route'])
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
    expect(test.register).not.toHaveBeenCalled()
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

  it('rejects workspaces outside the configured mapping', async () => {
    const test = harness()
    await expect(execute(test.ctx, { workspaces: { 'ira-agent-platform': 'workspace-a' } }, {
      type: 'dsh.command', commandId: 'c3', operation: 'session.open',
      agentPreset: 'ira-devloop', workspace: 'missing', dshSessionId: 'dsh-2', hubMcpUrl: 'https://hub.example/mcp', sessionCapability: 'owner-capability', text: 'no',
    })).rejects.toThrow('workspace is not exposed')
    expect(test.create).not.toHaveBeenCalled()
  })
})
