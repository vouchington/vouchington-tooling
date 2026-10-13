import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'

function packagePolicy(worktree: string, text: string): string | undefined {
  let manifest: unknown
  try {
    manifest = JSON.parse(text)
  } catch {
    throw new Error(`${join(worktree, 'package.json')} is not valid JSON`)
  }
  const section = (manifest as Record<string, unknown> | null)?.['vouchington-tooling']
  const policy = (section as { policy?: unknown } | null | undefined)?.policy
  if (policy === undefined) return undefined
  if (typeof policy !== 'string' || !policy.trim())
    throw new Error('package.json "vouchington-tooling".policy must be a non-empty string path')
  return policy
}

/**
 * The real path of the policy module the worktree's package.json declares as
 * `"vouchington-tooling": { "policy": "<relative path>" }`, or undefined when it declares none.
 * The path must be relative and, after resolving symlinks, stay inside the worktree.
 */
export async function resolvePolicyModule(worktree: string): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(join(worktree, 'package.json'), 'utf8')
  } catch (error) {
    // Only a missing manifest means "no policy"; an unreadable one must not silently disable it.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(
      `${join(worktree, 'package.json')} could not be read: ${(error as Error).message}`,
      {
        cause: error,
      },
    )
  }
  const declared = packagePolicy(worktree, text)
  if (declared === undefined) return undefined
  if (isAbsolute(declared)) throw new Error(`policy path ${declared} must be relative`)
  const root = await realpath(worktree)
  let resolved: string
  try {
    resolved = await realpath(join(root, declared))
  } catch {
    throw new Error(`policy module ${declared} does not exist in the worktree`)
  }
  if (!resolved.startsWith(root + sep))
    throw new Error(`policy path ${declared} must stay inside the worktree`)
  return resolved
}
