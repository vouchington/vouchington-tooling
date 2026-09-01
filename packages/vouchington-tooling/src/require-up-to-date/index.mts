import { execFileSync } from 'node:child_process'

export type GitExecutor = (args: readonly string[], cwd?: string) => number

export interface RequireUpToDateOptions {
  readonly remote: string
  readonly branch: string
  readonly cwd?: string
  readonly execute?: GitExecutor
}

function defaultExecute(args: readonly string[], cwd?: string): number {
  try {
    execFileSync('git', args, { cwd, stdio: 'inherit' })
    return 0
  } catch (error) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') return status
    throw error
  }
}

function validateName(value: string, option: string): void {
  if (!value || value.startsWith('-') || /\s/u.test(value)) {
    throw new Error(`${option} must be a non-option Git name`)
  }
}

export function requireUpToDate(options: RequireUpToDateOptions): void {
  validateName(options.remote, '--remote')
  validateName(options.branch, '--branch')
  const execute = options.execute ?? defaultExecute
  const fetchStatus = execute(['fetch', '--quiet', options.remote, options.branch], options.cwd)
  if (fetchStatus !== 0) throw new Error(`git fetch failed with exit code ${fetchStatus}`)
  const ancestryStatus = execute(['merge-base', '--is-ancestor', 'FETCH_HEAD', 'HEAD'], options.cwd)
  if (ancestryStatus === 1)
    throw new Error(`Current HEAD is not up to date with ${options.remote}/${options.branch}`)
  if (ancestryStatus !== 0)
    throw new Error(`git merge-base failed with exit code ${ancestryStatus}`)
}
