/** Real ordinary SessionController creation and AgentPresets Loader composition, without live services. */
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import * as AgentRegistry from '@deepseek-ai/dsh-agent'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import * as AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as AgentPresets from '@deepseek-ai/dsh-agent-presets'
import { COMPOSITION_FILE } from '@deepseek-ai/dsh-agent-presets'
import * as SessionController from '@deepseek-ai/dsh-api-session-controller'
import * as Llm from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as SessionProjections from '@deepseek-ai/dsh-session-projection'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as RealPersona from '@deepseek-ai/dsh-persona'
import * as SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolRuntime from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { afterEach, expect, it, vi } from 'vitest'
import { execute } from '../src/index.ts'
import * as Services from './fixtures/child-session-services.ts'
import * as Persona from './fixtures/child-session-persona.ts'
import { OfflineAdapter } from './fixtures/child-session-adapter.ts'

const presets = ['ira-intake-router', 'ira-devloop', 'ira-supervisor', 'ira-schedule-manager', 'ira-devloop-worker', 'ira-e2e-validator'] as const
const children = ['ira-devloop-worker', 'ira-e2e-validator'] as const
const mcpTools = ['mcp__ado__fixture', 'mcp__kusto__fixture', 'mcp__voice-dashboard__fixture']
const delegationTools = ['subagent', 'subagent_fork', 'send_message', 'workflow', 'ralph']
const workspaces = { repo: 'ira-child-test-workspace' }
let ctx: Context | undefined
let directory: string | undefined

afterEach(async () => {
  try { await ctx?.fiber.dispose() }
  finally {
    vi.unstubAllGlobals()
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    ctx = undefined
    directory = undefined
  }
})

async function harness(inheritedTools = false, persistent = false): Promise<Context> {
  directory ??= await mkdtemp(join(tmpdir(), 'dsh-ira-child-sessions-'))
  const roots = join(directory, 'presets')
  for (const preset of presets) {
    const path = join(roots, preset)
    await mkdir(path, { recursive: true })
    await writeFile(join(path, COMPOSITION_FILE), JSON.stringify([
      persistent
        ? { id: 'persona', name: 'cordis:real-persona', config: { text: `Offline qualification role: ${preset}.` } }
        : { id: 'persona', name: 'cordis:fixture-persona', config: { preset, inheritedTools } },
    ]))
  }
  const configPath = join(directory, 'cordis.yml')
  const row = (id: string, config?: object) => ({ id, name: 'cordis:' + id, ...(config ? { config } : {}) })
  await writeFile(configPath, JSON.stringify([
    row('sessions'), row('system-prompt', { persona: '' }), row('tools'), row('llm'),
    row('agents'), row('session-projections'), row('agent-loop', { agents: [] }),
    row('session-query'), row('fixture-services', { workspacePath: directory, rejectRequests: !persistent }),
    ...(persistent ? [row('session-persistence', { root: join(directory, 'logs'), compression: 'none' })] : []),
    row('agent-presets', {
      default: 'ira-devloop', roots: [{ path: roots, trust: 'system' }],
      includeShippedRoot: false, includeUserRoot: false,
    }),
    row('session-controller', { nativeOpen: false }),
  ]))
  ctx = await boot('ira-real-child-sessions', configPath, undefined, (host) => {
    Object.assign(host.loader.builtins, {
      sessions: SessionStore, 'system-prompt': SystemPrompt, tools: ToolRuntime,
      llm: Llm, agents: AgentRegistry, 'agent-loop': AgentLoop,
      'session-projections': SessionProjections, 'session-query': Services.PointQuery,
      'agent-presets': AgentPresets, 'session-controller': SessionController,
      'fixture-services': Services, 'fixture-persona': Persona,
      'real-persona': RealPersona, 'session-persistence': JsonlPersistence,
    })
  })
  return ctx
}

function command(preset: typeof presets[number], id = randomUUID()) {
  return {
    type: 'dsh.command' as const, operation: 'session.open' as const,
    commandId: randomUUID(), agentPreset: preset, workspace: 'repo',
    dshSessionId: id, hubMcpUrl: 'https://fixture.invalid/mcp',
    sessionCapability: 'fixture-capability-' + id, text: 'Carry out this isolated fixture task.',
  }
}

async function agentFor(host: Context, id: string): Promise<Agent> {
  const resolved = await host.sessionController.resolveAgent(SessionId(id))
  if ('error' in resolved) throw resolved.error
  return resolved.agent
}

const names = (host: Context, agent?: Agent) => host.tools.schemas(agent).map(tool => tool.name).sort()

function registerProbe(host: Context, name: string) {
  const invoke = vi.fn(async () => 'fixture-executed')
  host.tools.register(defineTool({
    name, description: 'External capability probe: ' + name, parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: invoke,
  }))
  return invoke
}

it.each(children)('creates and adopts %s as an ordinary Session with a real mounted persona', async (preset) => {
  const host = await harness()
  const accepted = command(preset)
  await execute(host, { workspaces }, accepted)
  const agent = await agentFor(host, accepted.dshSessionId)
  await vi.waitFor(() => {
    expect(agent.session.events.some(event => event.type === 'turn/end')).toBe(true)
  })
  expect(agent.session).toBe(host.sessions.get(SessionId(accepted.dshSessionId)))
  expect(agent.session.header).toMatchObject({ id: accepted.dshSessionId, cwd: directory, agentPreset: preset })
  expect(agent.session.header.origin).not.toBe('subagent')
  expect(agent.session.header.parentSession).toBeUndefined()
  expect(agent.session.events.some(event => event.type === 'request/header')).toBe(false)
  const prompt = await host.systemPrompt.assemble(assembleContextFor(agent))
  expect(prompt.sections).toContainEqual({
    name: 'fixture-persona:' + preset, text: 'Fixture persona for ' + preset + '. Follow only this role.',
  })
  expect(prompt.tools.map(tool => tool.name).sort()).toEqual(['ira_child_report', 'ira_context'])
  const report = prompt.tools.find(tool => tool.name === 'ira_child_report')!
  expect(report.parameters).toMatchObject({
    type: 'object', properties: { kind: { type: 'string', enum: ['progress', 'blocker', 'complete'] }, text: { type: 'string' } },
    required: ['kind', 'text'],
  })

  await execute(host, { workspaces }, { ...accepted, commandId: randomUUID(), text: 'Adopt the same session.' })
  expect(await agentFor(host, accepted.dshSessionId)).toBe(agent)
  const other = preset === 'ira-devloop-worker' ? 'ira-e2e-validator' : 'ira-devloop-worker'
  await expect(execute(host, { workspaces }, { ...accepted, commandId: randomUUID(), agentPreset: other })).rejects.toThrow(/preset/i)
  expect(agent.session.header.agentPreset).toBe(preset)
  const afterRejection = await host.systemPrompt.assemble(assembleContextFor(agent))
  expect(afterRejection.sections.map(section => section.name)).not.toContain('fixture-persona:' + other)
})

it('persists ordinary child requests and lists and resumes them from a fresh Loader without live models', async () => {
  const host = await harness(false, true)
  const model = new OfflineAdapter()
  host.llm.registerAdapter(['fixture-no-network'], model)
  const accepted = children.map(preset => ({ ...command(preset), text: 'Bounded offline task for ' + preset }))
  for (const input of accepted) {
    await execute(host, { workspaces }, input)
    const agent = await agentFor(host, input.dshSessionId)
    await agent.whenIdle()
    expect(agent.session.events.some(event => event.type === 'request/header')).toBe(true)
    expect(agent.session.events.some(event => event.type === 'assistant/message')).toBe(true)
    expect(agent.session.events.filter(event => event.type === 'turn/end')).toHaveLength(1)
    const request = model.requests.find(candidate => candidate.sessionId === agent.id)!
    expect(request.system).toContain('Offline qualification role: ' + input.agentPreset)
    expect(request.tools?.map(tool => tool.name).sort()).toEqual(['ira_child_report', 'ira_context'])
    expect(JSON.stringify(request.messages)).toContain(input.text)
    const logged = JSON.stringify(agent.session.events)
    expect(logged).toContain('Offline qualification role: ' + input.agentPreset)
    expect(logged).not.toContain(input.sessionCapability)
    expect(logged).not.toContain(input.hubMcpUrl)
  }
  expect(model.requests).toHaveLength(2)
  const signal = new AbortController().signal
  expect((await host.sessionController.list({}, signal)).items.map(item => item.sessionId).sort())
    .toEqual(accepted.map(input => input.dshSessionId).sort())
  // Whole-tree disposal drains the real persistence coordinator's writes.
  await host.fiber.dispose()

  const cold = await harness(false, true)
  const resumedModel = new OfflineAdapter()
  cold.llm.registerAdapter(['fixture-no-network'], resumedModel)
  expect(cold.sessions.list()).toHaveLength(0)
  expect(cold.agents.list()).toHaveLength(0)
  const rows = (await cold.sessionController.list({}, signal)).items
  expect(rows.map(item => item.sessionId).sort()).toEqual(accepted.map(input => input.dshSessionId).sort())
  for (const input of accepted) {
    const id = SessionId(input.dshSessionId)
    const row = rows.find(item => item.sessionId === id)!
    expect(row.cwd).toBe(directory)
    expect(row.origin).toBeUndefined()
    expect(row.parentSessionId).toBeUndefined()
    const persisted = await cold.sessionController.inspect(id)
    expect(persisted.meta.agentPreset).toBe(input.agentPreset)
    expect(persisted.meta.origin).not.toBe('subagent')
    expect(persisted.meta.parentSession).toBeUndefined()
    expect(JSON.stringify(persisted.events)).toContain(input.text)
    expect(JSON.stringify(persisted.events)).toContain('Offline qualification complete.')
    const raw = await cold.get('sessionPersistence')!.readRaw(id)
    expect(raw?.content).toContain(input.text)
  }
  // Listing and inspection are cold reads, not hidden Agent activations.
  expect(cold.sessions.list()).toHaveLength(0)
  expect(cold.agents.list()).toHaveLength(0)
  expect(resumedModel.requests).toHaveLength(0)
  const input = accepted[0]!
  await execute(cold, { workspaces }, { ...input, operation: 'session.steer', commandId: randomUUID(), text: 'Continue bounded offline task.' })
  const resumed = await agentFor(cold, input.dshSessionId)
  await resumed.whenIdle()
  expect(resumed.id).toBe(input.dshSessionId)
  expect(cold.agentPresets.composedPreset(resumed.ctx)).toBe(input.agentPreset)
  expect(resumedModel.requests).toHaveLength(1)
  expect(JSON.stringify(resumedModel.requests[0]!.messages)).toContain(input.text)
  expect(JSON.stringify(resumedModel.requests[0]!.messages)).toContain('Continue bounded offline task.')
  expect(resumedModel.requests[0]!.tools?.map(tool => tool.name).sort()).toEqual(['ira_child_report', 'ira_context'])
})

it('isolates owner, worker, validator and root scopes and enforces late capability restrictions at execution', async () => {
  const host = await harness()
  const agents = new Map<typeof presets[number], Agent>()
  for (const preset of presets) {
    const accepted = command(preset)
    await execute(host, { workspaces }, accepted)
    agents.set(preset, await agentFor(host, accepted.dshSessionId))
  }
  const worker = agents.get('ira-devloop-worker')!
  const validator = agents.get('ira-e2e-validator')!
  const owner = agents.get('ira-supervisor')!
  // Register after policy installation, as happens when external MCP servers recover.
  const probes = new Map([...mcpTools, ...delegationTools].map(name => [name, registerProbe(host, name)]))
  expect(names(host)).toEqual([...mcpTools, ...delegationTools].sort())
  expect(names(host, worker)).toEqual(['ira_child_report', 'ira_context', ...mcpTools].sort())
  expect(names(host, validator)).toEqual(['ira_child_report', 'ira_context'])
  expect(names(host, owner)).toEqual(expect.arrayContaining(['ira_progress', 'ira_blocker', 'ira_complete', ...mcpTools]))
  expect(names(host, owner)).not.toContain('ira_child_report')
  expect(names(host, agents.get('ira-intake-router'))).toEqual(expect.arrayContaining(['ira_route', 'ira_providers', mcpTools[0]]))
  expect(names(host, agents.get('ira-schedule-manager'))).not.toContain('ira_child_report')

  for (const [name, invoke] of probes) {
    for (const agent of mcpTools.includes(name) ? [validator] : [worker, validator]) {
      await host.tools.execute({ agent, name, arguments: {}, callId: ToolCallId(randomUUID()), signal: new AbortController().signal })
      expect(invoke).not.toHaveBeenCalled()
    }
    if (mcpTools.includes(name)) {
      await host.tools.execute({
        agent: worker, name, arguments: {},
        callId: ToolCallId(randomUUID()), signal: new AbortController().signal,
      })
      expect(invoke).toHaveBeenCalledOnce()
    }
  }
  const ownerPrompt = await host.systemPrompt.assemble(assembleContextFor(owner))
  expect(ownerPrompt.sections.map(section => section.name)).not.toContain('fixture-persona:ira-devloop-worker')
  expect((await host.systemPrompt.assemble({})).sections.map(section => section.name)).not.toContain('fixture-persona:ira-supervisor')
})

it.each(children)('masks mounted preset capabilities only on the adopted %s identity', async (preset) => {
  const host = await harness(true)
  const accepted = command(preset)
  const siblingId = SessionId(randomUUID())
  for (const sessionId of [SessionId(accepted.dshSessionId), siblingId]) {
    const created = await host.sessionController.create({
      sessionId, workspaceId: WorkspaceId(workspaces.repo), agentPreset: preset,
    })
    expect(created).toEqual({ sessionId, agentPreset: preset })
  }
  const adopted = await agentFor(host, accepted.dshSessionId)
  const sibling = await agentFor(host, siblingId)
  expect(adopted).not.toBe(sibling)
  expect(names(host, adopted)).toEqual([...Persona.inheritedTools].sort())
  expect(names(host, sibling)).toEqual([...Persona.inheritedTools].sort())
  expect(names(host)).toEqual([])

  // The adapter adopts this exact ordinary identity instead of creating a fake
  // child, replacing the Agent, or editing the shared standing preset mount.
  await execute(host, { workspaces }, accepted)
  expect(await agentFor(host, accepted.dshSessionId)).toBe(adopted)
  expect(host.agentPresets.composedPreset(adopted.ctx)).toBe(preset)
  expect(adopted.session.header.agentPreset).toBe(preset)
  const allowed = preset === 'ira-devloop-worker'
    ? Persona.inheritedTools.filter(name => name.startsWith('mcp__')) : []
  const expected = ['ira_context', 'ira_child_report', ...allowed].sort()
  expect(names(host, adopted)).toEqual(expected)
  expect((await host.systemPrompt.assemble(assembleContextFor(adopted))).tools.map(tool => tool.name).sort()).toEqual(expected)
  expect(names(host, sibling)).toEqual([...Persona.inheritedTools].sort())
  expect(names(host)).toEqual([])

  for (const name of Persona.inheritedTools) {
    const invoke = (agent: Agent) => host.tools.execute({
      agent, name, arguments: {}, callId: ToolCallId(randomUUID()), signal: new AbortController().signal,
    })
    const siblingResult = await invoke(sibling)
    const output = [{ type: 'text', text: 'inherited:' + preset + ':' + name }]
    expect(siblingResult.content).toEqual(output)
    const result = await invoke(adopted)
    if (allowed.includes(name)) expect(result.content).toEqual(output)
    else expect(result.content).not.toEqual(output)
  }
})

it('routes all child report kinds through the child capability, never the owner publication endpoints', async () => {
  const host = await harness()
  const accepted = command('ira-devloop-worker')
  await execute(host, { workspaces }, accepted)
  const agent = await agentFor(host, accepted.dshSessionId)
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    new Response(JSON.stringify({ ok: true, value: { reported: true } }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  for (const kind of ['progress', 'blocker', 'complete']) {
    await host.tools.execute({
      agent, name: 'ira_child_report', arguments: { kind, text: 'Child ' + kind },
      callId: ToolCallId(randomUUID()), signal: new AbortController().signal,
    })
    const [url, request] = fetch.mock.calls.at(-1)!
    expect(url).toBe(accepted.hubMcpUrl)
    expect(new Headers(request?.headers).get('x-ira-session-capability')).toBe(accepted.sessionCapability)
    const body = request?.body
    if (typeof body !== 'string') throw new Error('Expected a JSON request body')
    const value: unknown = JSON.parse(body)
    expect(value).toEqual({ method: 'child.report', kind, text: 'Child ' + kind })
  }
  expect(fetch).toHaveBeenCalledTimes(3)
  await host.tools.execute({
    agent, name: 'ira_complete', arguments: { text: 'Not owner authority' },
    callId: ToolCallId(randomUUID()), signal: new AbortController().signal,
  })
  expect(fetch).toHaveBeenCalledTimes(3)
})
