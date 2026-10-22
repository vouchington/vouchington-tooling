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
  const exported = loaded.default ?? loaded.policy
  const policy = typeof exported === 'function' ? await exported(context) : exported
  if (!isRecord(policy) || Array.isArray(policy)) {
    throw new Error(
      `policy module ${specifier} must default-export a policy object or a function returning one`,
    )
  }
  return policy as HookPolicy
}
