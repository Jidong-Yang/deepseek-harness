/** Optional current-user pipe handoff for a local browser URL; never a diagnostic record. */
import { createConnection } from 'node:net'

/**
 * Capture and delete the pipe request before Host environment snapshots exist.
 * The supervisor owns a current-user-only pipe; missing requests preserve normal launch behavior.
 * @returns a bounded one-shot sender, or undefined when no local display was requested.
 */
export function consumeLocalLaunchLink(): ((url: string) => Promise<void>) | undefined {
  const pipe = process.env.DSH_HOST_LOCAL_LINK_PIPE
  const nonce = process.env.DSH_HOST_READY_NONCE
  delete process.env.DSH_HOST_LOCAL_LINK_PIPE
  if (pipe === undefined) return undefined
  if (!/^ira-dsh-link-[0-9a-f]{32}$/u.test(pipe) || nonce === undefined || !/^[0-9a-f]{32}$/iu.test(nonce)) {
    throw new Error('run-windows-web: invalid local link request')
  }
  let attempted = false
  return async (url: string): Promise<void> => {
    if (attempted) return
    attempted = true
    let parsed: URL
    try { parsed = new URL(url) }
    catch { throw new Error('run-windows-web: invalid local browser URL') }
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/'
      || parsed.username !== '' || parsed.password !== '' || parsed.hash !== ''
      || !/^\?token=[A-Za-z0-9_-]{16,256}$/u.test(parsed.search)) {
      throw new Error('run-windows-web: invalid local browser URL')
    }
    const payload = JSON.stringify({ schemaVersion: 1, nonce, pid: process.pid, url })
    if (Buffer.byteLength(payload) > 2048) throw new Error('run-windows-web: local link limit exceeded')
    await new Promise<void>((resolve) => {
      const socket = createConnection('\\\\.\\pipe\\' + pipe)
      const timeout = setTimeout(() => { socket.destroy(); resolve() }, 2000)
      socket.once('connect', () => socket.end(payload))
      socket.once('error', () => { socket.destroy(); resolve() })
      socket.once('close', () => { clearTimeout(timeout); resolve() })
    })
  }
}
