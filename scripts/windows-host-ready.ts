/** Optional Windows supervisor startup record; no Host imports or environment snapshot. */
import { closeSync, fsyncSync, linkSync, lstatSync, openSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { win32 } from 'node:path'

const INVALID = 'run-windows-web: invalid Host readiness request'
const FAILED = 'run-windows-web: Host readiness publication failed'

/** Reject link-shaped ancestors and require the caller-created directory to exist. */
function inspectParent(file: string): void {
  let parent = win32.dirname(file)
  for (;;) {
    const stat = lstatSync(parent)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(INVALID)
    const next = win32.dirname(parent)
    if (next === parent) return
    parent = next
  }
}

/** A local drive path without alternate streams, traversal or device names. */
function validPath(file: string): boolean {
  const normalized = file.split(String.fromCharCode(92)).join('/')
  if (file.length > 240 || !/^[a-z]:$/iu.test(normalized.slice(0, 2)) || normalized[2] !== '/') return false
  const parts = normalized.slice(3).split('/')
  return parts.every(part => part.length > 0 && !/[<>:"|?*\x00-\x1f]/u.test(part)
    && !/[. ]$/u.test(part) && part !== '.' && part !== '..'
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))
}

/**
 * Consume and erase the optional request before any Host code reads the environment.
 * The caller owns a private, stable, existing attempt directory on a local Windows
 * filesystem supporting hard links. Existing destinations, including links, fail closed.
 * @returns a synchronous, one-shot publisher to subscribe to AppReady, or undefined.
 * @throws a static diagnostic without request values or filesystem error details.
 */
export function consumeHostReadiness(): (() => void) | undefined {
  const file = process.env.DSH_HOST_READY_FILE
  const nonce = process.env.DSH_HOST_READY_NONCE
  delete process.env.DSH_HOST_READY_FILE
  delete process.env.DSH_HOST_READY_NONCE
  if (file === undefined && nonce === undefined) return undefined
  if (file === undefined || nonce === undefined || !/^[0-9a-f]{32}$/iu.test(nonce) || !validPath(file)) {
    throw new Error(INVALID)
  }
  try {
    inspectParent(file)
    if (lstatSync(file, { throwIfNoEntry: false }) !== undefined) throw new Error(INVALID)
  } catch { throw new Error(INVALID) }
  let attempted = false
  return () => {
    if (attempted) return
    attempted = true
    const temporary = win32.join(win32.dirname(file), '.dsh-ready-' + randomUUID() + '.tmp')
    let fd: number | undefined
    let created = false
    try {
      inspectParent(file)
      fd = openSync(temporary, 'wx', 0o600)
      created = true
      const record = JSON.stringify({ schemaVersion: 1, nonce, pid: process.pid, state: 'ready', at: new Date().toISOString() }) + '\n'
      if (Buffer.byteLength(record) > 1024) throw new Error(FAILED)
      writeFileSync(fd, record)
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      // Creating a hard link atomically publishes complete bytes WITHOUT rename's
      // replacement semantics: a raced file/symlink at the destination stays intact.
      linkSync(temporary, file)
    } catch { throw new Error(FAILED) }
    finally {
      if (fd !== undefined) {
        try { closeSync(fd) } catch { /* Preserve the static publication failure. */ }
      }
      if (created) {
        try { unlinkSync(temporary) } catch { /* Only our random temporary entry; never remove the destination. */ }
      }
    }
  }
}
