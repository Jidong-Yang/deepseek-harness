/** A preset contribution that must be discovered and mounted by the real Loader. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'ira-child-session-persona'
export const inject = ['systemPrompt', 'tools']

export const inheritedTools = [
  'subagent_inherited_probe', 'mcp__ado__inherited_probe',
  'mcp__kusto__inherited_probe', 'mcp__voice-dashboard__inherited_probe',
]

/** Publish a distinct model-facing section to prove the requested preset was mounted. */
export function apply(ctx: Context, config: { preset: string; inheritedTools?: boolean }): void {
  ctx.systemPrompt.section({
    name: 'fixture-persona:' + config.preset,
    order: 0,
    text: 'Fixture persona for ' + config.preset + '. Follow only this role.',
  })
  // These remain enabled in the mounted preset: the adapter, not fixture row
  // omission or a global registry filter, must mask them for each child role.
  if (config.inheritedTools) for (const name of inheritedTools) {
    ctx.tools.register(defineTool({
      name, description: 'Inherited fixture capability ' + name, parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => 'inherited:' + config.preset + ':' + name,
    }))
  }
}
