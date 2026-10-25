import { hasBackgroundOperator } from './background.mts'
import { shellSegments, withoutShellComment } from './shell.mts'

const SUBCOMMANDS = new Set(
  'image|fs|filesystem|rootfs|repo|repository|sbom|vm|k8s|kubernetes'.split('|'),
)

// Trivy reads every CLI option from a TRIVY_* variable, so an inline assignment could filter a scan
// that its flags leave compliant. Only variables that cannot change what is scanned are allowed.
const SAFE_ENVIRONMENT =
  /^TRIVY_(?:CACHE_DIR|DB_REPOSITORY|JAVA_DB_REPOSITORY|TIMEOUT|DEBUG|NO_PROGRESS)=/

type TrivyInvocation = { args: string[]; source: string }

export function tokens(command: string): string[] {
  const uncommented = withoutShellComment(command)
  return (uncommented.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((token) =>
    token.replace(/"([^"]*)"|'([^']*)'/g, '$1$2').replace(/\\(.)/g, '$1'),
  )
}

function isPackageScan(args: string[]): boolean {
  return args.some((token) => SUBCOMMANDS.has(token))
}

function isTrivyExecutable(token: string): boolean {
  return token === 'trivy' || /(?:^|\/)trivy$/.test(token)
}

function hasTrivyPackageScan(command: string): boolean {
  const commandTokens = tokens(command)
  const executable = commandTokens.findIndex(isTrivyExecutable)
  return executable !== -1 && isPackageScan(commandTokens.slice(executable + 1))
}

function assertDirectExecution(command: string, uncommented: string): void {
  if (/(?:\$\([^)]*|`[^`]*)\b(?:[^\s()`]+\/)?trivy(?:\s|\))/.test(uncommented))
    throw new Error(`${command.trim()}: unsupported Trivy command substitution`)
  if (/[<>]\(\s*(?:[^\s()]+\/)?trivy(?:\s|\))/.test(uncommented))
    throw new Error(`${command.trim()}: unsupported Trivy process substitution`)
  if (
    /\b(?:bash|sh|zsh)\s+-[A-Za-z]*c[A-Za-z]*\s+['"][^'"]*(?:[^\s()]+\/)?trivy(?:\s|$)/.test(
      uncommented,
    )
  )
    throw new Error(`${command.trim()}: unsupported indirect Trivy execution`)
  if (hasBackgroundOperator(uncommented) && hasTrivyPackageScan(uncommented))
    throw new Error(`${command.trim()}: unsupported background Trivy package scan`)
}

function trivyExecutableInvocations(command: string): TrivyInvocation[] {
  const uncommented = withoutShellComment(command)
  assertDirectExecution(command, uncommented)
  return shellSegments(uncommented).flatMap((source) => {
    if (/^\(\s*(?:[^\s()]+\/)?trivy(?:\s|\))/.test(source.trimStart()))
      throw new Error(`${source.trim()}: unsupported grouped Trivy package scan`)
    const segmentTokens = tokens(source)
    const evalIndex = segmentTokens.indexOf('eval')
    if (
      evalIndex !== -1 &&
      segmentTokens.slice(evalIndex + 1).some((token) => /(?:^|\s|\/)trivy(?:\s|$)/.test(token))
    )
      throw new Error(`${source.trim()}: unsupported indirect Trivy execution`)
    const executable = segmentTokens.findIndex(isTrivyExecutable)
    if (executable === -1) return []
    const args = segmentTokens.slice(executable + 1)
    const leading = segmentTokens.slice(0, executable)
    if (leading.includes('echo')) return []
    const unsafe = leading.find(
      (token) => token.startsWith('TRIVY_') && !SAFE_ENVIRONMENT.test(token),
    )
    if (unsafe !== undefined && isPackageScan(args))
      throw new Error(
        `${source.trim()}: unsupported Trivy environment option ${unsafe.split('=')[0]}`,
      )
    if (leading.some((token) => token !== 'env' && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token))) {
      if (isPackageScan(args))
        throw new Error(`${source.trim()}: unsupported wrapper before Trivy package scan`)
      return []
    }
    return [{ args, source }]
  })
}

export function trivyPackageScanSubcommand(command: string): string | undefined {
  return trivyExecutableInvocations(command)
    .flatMap(({ args }) => args)
    .find((token) => SUBCOMMANDS.has(token))
}

export function isTrivyPackageScanCommand(command: string): boolean {
  return trivyPackageScanSubcommand(command) !== undefined
}

export function trivyPackageScanCommandSegments(command: string): string[] {
  const segments: string[] = []
  for (const { args, source } of trivyExecutableInvocations(command)) {
    if (isPackageScan(args)) segments.push(source)
  }
  return segments
}
