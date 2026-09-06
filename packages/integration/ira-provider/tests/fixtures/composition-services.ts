/** External Web Host seams for the IRA Loader test; Session and tool services stay real. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-api-session-controller'

export const name = 'ira-composition-services'
export const inject = ['sessions', 'tools', 'systemPrompt']

/** Records calls at the external SessionController seam without starting an LLM. */
export interface ControllerProbe {
  creates: Array<{ sessionId: SessionId; workspaceId: string; agentPreset: string }>
  resolves: SessionId[]
  messages: UserMessage[]
  cancellations: number
  agent?: Agent
}

/** Supply the two services the real IRA Provider declares as required injections. */
export function apply(ctx: Context, config: { workspacePath: string }): void {
  const workspace = { id: WorkspaceId('composition-workspace'), path: config.workspacePath }
  const probe: ControllerProbe = { creates: [], resolves: [], messages: [], cancellations: 0 }
  ctx.provide('workspaceRegistry', {
    resolveByPath: async (path: string) => path === workspace.path ? workspace : undefined,
    get: (id: string) => id === workspace.id ? workspace : undefined,
    create: async () => { throw new Error('Fixture workspace must already be registered') },
  } as unknown as Context['workspaceRegistry'])
  ctx.provide('sessionController', {
    ...probe,
    async create(options: ControllerProbe['creates'][number]) {
      probe.creates.push(options)
      const session = ctx.sessions.create(options.sessionId)
      // Only the controller-returned handle is a stand-in; its scope and tools are real.
      const agent = {
        id: session.id, session,
        steer: (message: UserMessage) => { probe.messages.push(message) },
        cancel: () => { probe.cancellations++ },
      } as unknown as Agent
      const scope = createScope(ctx, agent)
      Object.assign(agent, { ctx: scope.ctx })
      probe.agent = agent
      return { sessionId: session.id }
    },
    async resolveAgent(sessionId: SessionId) {
      probe.resolves.push(sessionId)
      if (!probe.agent || probe.agent.id !== sessionId) throw new Error('Unknown fixture session')
      return { agent: probe.agent }
    },
    get agent() { return probe.agent },
    get cancellations() { return probe.cancellations },
  } as unknown as Context['sessionController'])
}
