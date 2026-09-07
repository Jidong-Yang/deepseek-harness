/** Test-only deployment seams; Session creation, preset mounting and tool policy stay real. */
import type { Context } from '@deepseek-ai/cordis'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'ira-child-session-services'
export const inject = ['sessions', 'tools', 'systemPrompt']

/** Keep the real point-read implementation without introducing a search backend. */
export class PointQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> { return Promise.reject(new Error('Search is outside this fixture')) }
  override searchEvents(): Promise<never> { return Promise.reject(new Error('Search is outside this fixture')) }
}

/** Supply local workspace and unused UI boundaries; no Host, profile or network is mounted. */
export function apply(ctx: Context, config: { workspacePath: string; rejectRequests?: boolean }): void {
  const sessions = new Set<SessionId>()
  const workspace = {
    id: WorkspaceId('ira-child-test-workspace'), path: config.workspacePath,
    attachSession: async (id: SessionId) => { sessions.add(id) },
  }
  ctx.provide('workspaceRegistry', {
    get: (id: string) => id === workspace.id ? workspace : undefined,
  } as unknown as Context['workspaceRegistry'])
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture-no-network', model: 'fixture-model' }),
  } as Context['agentDefaultModel'])
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  } as unknown as Context['typert'])
  ctx.provide('attachments', {
    imageLimits: {
      maxImageBytes: 1024, maxImagesPerMessage: 1, maxMessageImageBytes: 1024,
      maxImagePixels: 1024, maxImageDimension: 32, mediaTypes: ['image/png'],
    },
  } as unknown as Context['attachments'])
  // An admitted steer still exercises the real inbox and durable turn lifecycle,
  // but cannot open a model request even if a developer has live credentials.
  if (config.rejectRequests !== false) ctx.on('agent/pre-step', async () => ({ kind: 'reject' }))
}
