import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import {
  configureCatalog,
  configureSettingsFile,
  configureSettingsText,
} from './configure-local-copilot-provider.ts'

const responses = {
  object: 'list',
  data: [{
    id: 'gpt-test',
    display_name: 'GPT Test',
    context_window: 128_000,
    max_output_tokens: 16_000,
    input: ['text', 'image', 'unsupported'],
    reasoning_efforts: {
      off: null,
      high: 'high',
      future: 'future',
      low: '',
      medium: null,
    },
  }],
}

describe('local Copilot provider bridge', () => {
  it('maps only supported, positive catalog metadata', () => {
    expect(configureCatalog(responses)).toEqual([{
      id: 'gpt-test',
      name: 'GPT Test',
      contextWindow: 128_000,
      maxTokens: 16_000,
      input: ['text', 'image'],
      reasoningEfforts: { off: null, high: 'high' },
    }])
  })

  it('replaces only Copilot routes and preserves unrelated settings comments', () => {
    const text = [
      '# personal settings',
      'other:',
      '  enabled: true',
      'llm-pi-ai:',
      '  providers:',
      '    custom:',
      '      baseURL: https://example.test',
      '    copilot-chat:',
      '      models: [{ id: stale }]',
      '',
    ].join('\n')
    const configured = configureSettingsText(text, responses, { data: [] })
    const parsed: unknown = parse(configured)

    expect(configured).toContain('# personal settings')
    expect(parsed).toEqual({
      other: { enabled: true },
      'llm-pi-ai': {
        providers: {
          custom: { baseURL: 'https://example.test' },
          'copilot-proxy': {
            displayName: 'GitHub Copilot',
            apiKeyEnv: 'COPILOT_DSH_PROVIDER_API_KEY',
            baseURL: 'http://127.0.0.1:4141/responses/v1',
            api: 'openai-responses',
            retryPolicy: {
              mode: 'normal',
              maxRetries: 1,
              retryableCodes: [
                'EMPTY_RESPONSE',
                'RATE_LIMIT',
                'SERVER',
                'TIMEOUT',
                'TRANSPORT',
              ],
            },
            models: [{
              id: 'gpt-test',
              name: 'GPT Test',
              contextWindow: 128_000,
              maxTokens: 16_000,
              input: ['text', 'image'],
              reasoningEfforts: { off: null, high: 'high' },
            }],
          },
        },
      },
    })
  })

  it('rejects duplicate ids and an entirely empty catalog', () => {
    expect(() => configureCatalog({ data: [{ id: 'same' }, { id: 'same' }] }))
      .toThrow(/duplicate model ids/)
    expect(() => configureSettingsText(undefined, { data: [] }, { data: [] }))
      .toThrow(/no models/)
  })

  it('re-reads settings after waiting for another writer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-copilot-bridge-'))
    try {
      const path = join(directory, 'settings.yaml')
      await writeFile(path, 'before: true\n')
      await writeFile(`${path}.lock`, 'other-writer\n')

      const update = configureSettingsFile(path, responses, { data: [] })
      await writeFile(path, 'concurrent: preserved\n')
      await rm(`${path}.lock`)
      await update

      const parsed: unknown = parse(await readFile(path, 'utf8'))
      expect(parsed).toMatchObject({
        concurrent: 'preserved',
        'llm-pi-ai': {
          providers: {
            'copilot-proxy': { models: [{ id: 'gpt-test' }] },
          },
        },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
