import { execFileSync } from 'node:child_process'

import { normalizeSwiftSource } from './normalize.mts'

export function runSwiftSemanticEqualCli(
  args: readonly string[],
  gitShow: typeof execFileSync = execFileSync,
): number {
  const [base, head, file] = args
  if (!base || !head || !file || args.length !== 3 || !file.endsWith('.swift')) {
    return 1
  }

  try {
    const baseSource = gitShow('git', ['show', `${base}:${file}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const headSource = gitShow('git', ['show', `${head}:${file}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return normalizeSwiftSource(String(baseSource)) === normalizeSwiftSource(String(headSource))
      ? 0
      : 1
  } catch {
    return 1
  }
}
