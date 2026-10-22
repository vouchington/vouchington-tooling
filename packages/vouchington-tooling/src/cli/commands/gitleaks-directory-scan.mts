import { packageScriptPath } from '../script-path.mts'
import { runScript } from './spawn-script.mts'

export function runGitleaksDirectoryScanCommand(parsed: {
  config: string
  directory?: string | undefined
}): number | Promise<number> {
  return runScript('bash', packageScriptPath('scripts/gitleaks-directory-scan.sh'), [
    '--config',
    parsed.config,
    ...(parsed.directory === undefined ? [] : ['--root', parsed.directory]),
  ])
}
