/**
 * Machine-local bridge from the Copilot provider's live catalogs into the
 * Harness settings document.
 */

import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { Document, parseDocument } from 'yaml'

const PROVIDER_BASE_URL = 'http://127.0.0.1:4141'
const CREDENTIAL_REF = 'COPILOT_DSH_PROVIDER_API_KEY'
const RETRY_POLICY = {
  mode: 'normal',
  maxRetries: 1,
  retryableCodes: [
    'EMPTY_RESPONSE',
    'RATE_LIMIT',
    'SERVER',
    'TIMEOUT',
    'TRANSPORT',
  ],
}
const MODALITIES = new Set(['text', 'image'])
const REASONING_LEVELS = new Set([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

interface ConfiguredModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: string[]
  reasoningEfforts?: Record<string, string | null>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined
}

/** Map one provider model without inventing capabilities the catalog omitted. */
export function configureModel(value: unknown): ConfiguredModel {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('Copilot provider catalog contains a model without a non-empty id')
  }
  const input = Array.isArray(value.input)
    ? value.input.filter((entry): entry is string =>
      typeof entry === 'string' && MODALITIES.has(entry))
    : []
  const reasoningEfforts: Record<string, string | null> = {}
  if (isRecord(value.reasoning_efforts)) {
    for (const [level, spelling] of Object.entries(value.reasoning_efforts)) {
      if (
        REASONING_LEVELS.has(level)
        && (
          (level === 'off' && spelling === null)
          || (typeof spelling === 'string' && spelling.length > 0)
        )
      ) {
        reasoningEfforts[level] = spelling
      }
    }
  }
  const contextWindow = positiveInteger(value.context_window)
  const maxTokens = positiveInteger(value.max_output_tokens)
  return {
    id: value.id,
    ...typeof value.display_name === 'string' && value.display_name.length > 0
      ? { name: value.display_name }
      : {},
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...input.length === 0 ? {} : { input },
    ...Object.keys(reasoningEfforts).length === 0 ? {} : { reasoningEfforts },
  }
}

/** Validate and map one protocol-specific catalog. */
export function configureCatalog(value: unknown): ConfiguredModel[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error('Copilot provider catalog is not an OpenAI model list')
  }
  const models = value.data.map(configureModel)
  const ids = new Set(models.map(model => model.id))
  if (ids.size !== models.length) {
    throw new Error('Copilot provider catalog contains duplicate model ids')
  }
  return models
}

function providerProfile(
  displayName: string,
  baseURL: string,
  api: 'openai-completions' | 'openai-responses',
  models: ConfiguredModel[],
): Record<string, unknown> {
  return {
    displayName,
    apiKeyEnv: CREDENTIAL_REF,
    baseURL,
    api,
    retryPolicy: RETRY_POLICY,
    models,
  }
}

/**
 * Replace only the two machine-local Copilot routes while preserving every
 * unrelated node and comment in the settings document.
 */
export function configureSettingsText(
  text: string | undefined,
  responsesCatalog: unknown,
  chatCatalog: unknown,
): string {
  const responses = configureCatalog(responsesCatalog)
  const chat = configureCatalog(chatCatalog)
  if (responses.length === 0 && chat.length === 0) {
    throw new Error('Copilot provider returned no models on either protocol route')
  }

  const document = text === undefined || text.trim().length === 0
    ? new Document({})
    : parseDocument(text, { prettyErrors: false })
  if (document.errors.length > 0 || !isRecord(document.toJS())) {
    throw new Error('Harness settings document must be a valid object')
  }
  const providersPath = ['llm-pi-ai', 'providers']
  if (responses.length === 0) {
    document.deleteIn([...providersPath, 'copilot-proxy'])
  } else {
    document.setIn([...providersPath, 'copilot-proxy'], providerProfile(
      'GitHub Copilot',
      `${PROVIDER_BASE_URL}/responses/v1`,
      'openai-responses',
      responses,
    ))
  }
  if (chat.length === 0) {
    document.deleteIn([...providersPath, 'copilot-chat'])
  } else {
    document.setIn([...providersPath, 'copilot-chat'], providerProfile(
      'GitHub Copilot Chat',
      `${PROVIDER_BASE_URL}/chat/v1`,
      'openai-completions',
      chat,
    ))
  }
  return document.toString()
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  return await response.json()
}

async function main(args: string[]): Promise<void> {
  const dshHomeFlag = args.indexOf('--dsh-home')
  if (dshHomeFlag >= 0 && args[dshHomeFlag + 1] === undefined) {
    throw new Error('--dsh-home requires a path')
  }
  const explicitDshHome = dshHomeFlag >= 0 ? args[dshHomeFlag + 1] : undefined
  const dshHome = resolve(
    explicitDshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'),
  )
  const health = await fetchJson(`${PROVIDER_BASE_URL}/health`)
  if (!isRecord(health) || health.status !== 'ready') {
    const status = isRecord(health) && typeof health.status === 'string'
      ? health.status
      : 'invalid-response'
    throw new Error(`Copilot provider is not ready (${status})`)
  }
  const [responsesCatalog, chatCatalog] = await Promise.all([
    fetchJson(`${PROVIDER_BASE_URL}/responses/v1/models`),
    fetchJson(`${PROVIDER_BASE_URL}/chat/v1/models`),
  ])
  const settingsPath = join(dshHome, 'settings.yaml')
  await configureSettingsFile(settingsPath, responsesCatalog, chatCatalog)
  process.stdout.write(`Configured local Copilot routes in ${settingsPath}\n`)
}

/**
 * Update the Copilot routes under the settings provider's cross-process lock.
 * @param settingsPath - resolved Harness settings document path.
 * @param responsesCatalog - live Responses model catalog.
 * @param chatCatalog - live Chat Completions model catalog.
 * @returns when the locked atomic replacement is complete.
 */
export async function configureSettingsFile(
  settingsPath: string,
  responsesCatalog: unknown,
  chatCatalog: unknown,
): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true, mode: 0o700 })
  await withFileLock(settingsPath, async () => {
    let current: string | undefined
    try {
      current = await readFile(settingsPath, 'utf8')
    } catch (error: unknown) {
      if (!isRecord(error) || error.code !== 'ENOENT') throw error
    }
    await writeFileAtomic(
      settingsPath,
      configureSettingsText(current, responsesCatalog, chatCatalog),
      { mode: 0o600, dirMode: 0o700 },
    )
  })
}

const entry = process.argv[1]
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`configure-local-copilot-provider: ${message}\n`)
    process.exitCode = 1
  })
}
