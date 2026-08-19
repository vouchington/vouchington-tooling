import { parseGhaRuntimeAudit, type ParsedGhaRuntimeAudit } from './parse-gha-runtime-audit.mts'

export type ParsedCli =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string }
  | { kind: 'runner-port-policy'; file?: string; reserved?: number }
  | { kind: 'with-host-lock'; args: string[] }
  | ParsedGhaRuntimeAudit

export function parseCli(argv: readonly string[]): ParsedCli {
  const args = argv.slice(2)
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') return { kind: 'help' }
  if (args[0] === '--version' || args[0] === '-v') return { kind: 'version' }

  const [command, ...rest] = args
  if (command === 'runner-port-policy') return parseRunnerPortPolicy(rest)
  if (command === 'with-host-lock') return { kind: 'with-host-lock', args: rest }
  if (command === 'gha-runtime-audit') return parseGhaRuntimeAudit(rest)
  return { kind: 'error', message: `unknown command: ${command}` }
}

function parseRunnerPortPolicy(args: readonly string[]): ParsedCli {
  let file: string | undefined
  let reserved: number | undefined
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--file') {
      const value = args[index + 1]
      if (value === undefined) return { kind: 'error', message: '--file requires a path' }
      file = value
      index += 1
      continue
    }
    if (flag === '--reserved') {
      const value = args[index + 1]
      if (value === undefined) return { kind: 'error', message: '--reserved requires a port' }
      const port = Number(value)
      if (!Number.isInteger(port))
        return { kind: 'error', message: '--reserved must be an integer' }
      reserved = port
      index += 1
      continue
    }
    if (flag === '--help' || flag === '-h') return { kind: 'help' }
    return { kind: 'error', message: `unknown runner-port-policy option: ${flag}` }
  }
  return {
    kind: 'runner-port-policy',
    ...(file === undefined ? {} : { file }),
    ...(reserved === undefined ? {} : { reserved }),
  }
}
