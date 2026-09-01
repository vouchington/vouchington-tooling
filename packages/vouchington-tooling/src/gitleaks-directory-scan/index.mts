import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export type DirectoryScanExecutor = (executable: string, args: readonly string[]) => Promise<number>
export interface GitleaksDirectoryScanOptions {
  readonly config: string
  readonly directory?: string
  readonly execute?: DirectoryScanExecutor
}

function requirePath(value: string | undefined, option: string): string {
  if (!value) throw new Error(`${option} requires a path`)
  return value
}

export function gitleaksDirectoryScanArguments(options: GitleaksDirectoryScanOptions): string[] {
  return [
    '--config',
    requirePath(options.config, '--config'),
    ...(options.directory === undefined
      ? []
      : ['--root', requirePath(options.directory, '--directory')]),
  ]
}

function defaultExecute(executable: string, args: readonly string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
  })
}

export function runGitleaksDirectoryScan(options: GitleaksDirectoryScanOptions): Promise<number> {
  const script = fileURLToPath(new URL('../../scripts/gitleaks-directory-scan.sh', import.meta.url))
  return (options.execute ?? defaultExecute)('bash', [
    script,
    ...gitleaksDirectoryScanArguments(options),
  ])
}
