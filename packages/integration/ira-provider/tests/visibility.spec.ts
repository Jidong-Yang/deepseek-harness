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
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function tool(name: string) {
  return { name, description: name, parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] },
    execute: vi.fn(async () => 'executed'),
  } satisfies ToolDefinition
}

async function fixture(preset: 'ira-intake-router' | 'ira-schedule-manager' | 'ira-devloop' | 'ira-supervisor') {
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
  const provider = { workspaceRegistry: { get: () => ({ id: 'w' }) }, sessionController: {
    create: async () => ({}), resolveAgent: async () => ({ agent }),
  } } as unknown as Context
  await execute(provider, { workspaces: { repo: 'w' } }, { type: 'dsh.command', commandId: preset,
    operation: 'session.open', agentPreset: preset, workspace: 'repo', dshSessionId: agent.id,
    hubMcpUrl: 'https://unused.invalid', sessionCapability: 'unused', text: 'test',
  })
  return { ctx, agent, scope }
}

describe('global MCP visibility after server recovery', () => {
  it.each(['ira-intake-router', 'ira-schedule-manager'] as const)('keeps late tools hidden and uncallable for %s without a new steer', async (preset) => {
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

  it.each(['ira-devloop', 'ira-supervisor'] as const)('keeps permitted late tools available for %s', async (preset) => {
    const { ctx, agent } = await fixture(preset)
    const name = 'mcp__kusto__recovered_query'
    ctx.tools.register(tool(name))
    expect(ctx.tools.schemas(agent).map(t => t.name)).toContain(name)
  })
})
