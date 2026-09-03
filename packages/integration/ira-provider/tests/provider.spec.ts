import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { execute } from '../src/index.ts'

function harness() {
  const steer = vi.fn()
  const cancel = vi.fn()
  const agent = { steer, cancel }
  const create = vi.fn(async () => ({ sessionId: SessionId('dsh-1') }))
  const resolveAgent = vi.fn(async () => ({ agent }))
  const ctx = {
    workspaceRegistry: { get: (id: string) => id === 'workspace-a' ? { id, path: 'C:/work/a' } : undefined },
    sessionController: { create, resolveAgent },
  } as unknown as Context
  return { ctx, create, resolveAgent, steer, cancel }
}

describe('embedded IRA Provider', () => {
  it('opens one visible DSH session and steers its initial turn', async () => {
    const test = harness()
    await execute(test.ctx, { workspaceIds: ['workspace-a'] }, {
      type: 'dsh.command', commandId: 'c1', operation: 'session.open', role: 'router',
      agentPreset: 'ira-intake-router', workspaceId: 'workspace-a', dshSessionId: 'dsh-1', text: 'start',
    })
    expect(test.create).toHaveBeenCalledWith({ sessionId: SessionId('dsh-1'), workspaceId: 'workspace-a', agentPreset: 'ira-intake-router' })
    expect(test.steer).toHaveBeenCalledOnce()
  })

  it('steers the same session without creating another one', async () => {
    const test = harness()
    await execute(test.ctx, { workspaceIds: ['workspace-a'] }, {
      type: 'dsh.command', commandId: 'c2', operation: 'session.steer', role: 'owner',
      agentPreset: 'ira-devloop', workspaceId: 'workspace-a', dshSessionId: 'dsh-1', text: 'change direction',
    })
    expect(test.create).not.toHaveBeenCalled()
    expect(test.resolveAgent).toHaveBeenCalledWith(SessionId('dsh-1'))
    expect(test.steer).toHaveBeenCalledOnce()
  })

  it('rejects workspaces outside the configured allowlist', async () => {
    const test = harness()
    await expect(execute(test.ctx, { workspaceIds: ['workspace-a'] }, {
      type: 'dsh.command', commandId: 'c3', operation: 'session.open', role: 'owner',
      agentPreset: 'ira-devloop', workspaceId: 'workspace-b', dshSessionId: 'dsh-2', text: 'no',
    })).rejects.toThrow('workspace is not allowed')
    expect(test.create).not.toHaveBeenCalled()
  })
})
