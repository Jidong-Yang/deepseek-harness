/** Package-owned invariant companion for the outbound IRA Provider. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'ira-provider-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: remote Hub acknowledgement state is not observable in
 * the local session event stream; transport and admission boundaries are tested
 * against their owning interfaces instead of asserting a second local truth.
 */
const install: InvariantInstaller = () => {}

/** Register IRA Provider ownership and release it with the companion fiber. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-ira-provider', install))
