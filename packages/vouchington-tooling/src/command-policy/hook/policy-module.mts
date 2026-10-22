import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { isRecord } from '../payload.mts'
import type { HookContext, HookPolicy } from './types.mts'

/**
 * Imports a `--policy` module and resolves its policy. The module's default export (or a named
 * `policy` export) is a `HookPolicy` object or a function of the hook context that returns one.
 * A relative path resolves against the repository root.
 */
export async function loadHookPolicy(specifier: string, context: HookContext): Promise<HookPolicy> {
  const url = pathToFileURL(resolve(context.root, specifier)).href
  const loaded = (await import(url)) as { default?: unknown; policy?: unknown }
  const exported = selectExport(loaded)
  const policy = typeof exported === 'function' ? await exported(context) : exported
  if (!isRecord(policy) || Array.isArray(policy)) {
    throw new Error(
      `policy module ${specifier} must default-export a policy object or a function returning one`,
    )
  }
  return policy as HookPolicy
}

// A CommonJS module's `default` is its whole `module.exports`, so `exports.policy = {...}` shows up as
// `default: { policy }` beside the named `policy`; the named export is the policy then.
function selectExport(loaded: { default?: unknown; policy?: unknown }): unknown {
  const wrapper = loaded.default
  const wrapsNamed =
    isRecord(wrapper) && loaded.policy !== undefined && wrapper.policy === loaded.policy
  return wrapsNamed ? loaded.policy : (wrapper ?? loaded.policy)
}
