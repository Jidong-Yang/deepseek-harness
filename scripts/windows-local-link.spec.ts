import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { consumeLocalLaunchLink } from './windows-local-link.ts'

const pipeKey = 'DSH_HOST_LOCAL_LINK_PIPE'
const nonceKey = 'DSH_HOST_READY_NONCE'
afterEach(() => { delete process.env.DSH_HOST_LOCAL_LINK_PIPE; delete process.env.DSH_HOST_READY_NONCE })

describe('local-only launch URL', () => {
  it('leaves ordinary launch unchanged and rejects a malformed request without echo', () => {
    expect(consumeLocalLaunchLink()).toBeUndefined()
    process.env[pipeKey] = 'secret-canary-invalid-endpoint'
    process.env[nonceKey] = 'f'.repeat(32)
    expect(() => consumeLocalLaunchLink()).toThrow('invalid local link request')
    expect(process.env[pipeKey]).toBeUndefined()
  })
  it.runIf(process.platform === 'win32')('sends one exact packet through a real private local pipe', async () => {
    const name = 'ira-dsh-link-' + randomUUID().replaceAll('-', '')
    const nonce = 'a'.repeat(32)
    const url = 'http://127.0.0.1:54321/?token=fixture_local_token_0123456789'
    const server = createServer()
    let packet = ''
    const done = new Promise<void>(resolve => server.once('connection', (socket) => {
      socket.setEncoding('utf8')
      socket.on('data', (text: string) => { packet += text })
      socket.once('end', () => { socket.end(); resolve() })
    }))
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen('\\\\.\\pipe\\' + name, resolve) })
    try {
      process.env[pipeKey] = name
      process.env[nonceKey] = nonce
      const send = consumeLocalLaunchLink()!
      expect(process.env[pipeKey]).toBeUndefined()
      await send(url)
      await done
      expect(JSON.parse(packet)).toEqual({ schemaVersion: 1, nonce, pid: process.pid, url })
      await send(url)
      expect(JSON.parse(packet) as unknown).toEqual({ schemaVersion: 1, nonce, pid: process.pid, url })
    } finally { await new Promise<void>(resolve => server.close(() => { resolve() })) }
  })
  it('rejects a nonlocal URL and never reflects its token', async () => {
    process.env[pipeKey] = 'ira-dsh-link-' + 'b'.repeat(32)
    process.env[nonceKey] = 'a'.repeat(32)
    const send = consumeLocalLaunchLink()!
    await expect(send('https://example.invalid/?token=never-echo')).rejects.toThrow('invalid local browser URL')
  })
})
