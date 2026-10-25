import { tokens, trivyPackageScanSubcommand } from './invocations.mts'
import { resolveOptions, type TrivyPolicyOptions } from './options.mts'

const GATE_OPTIONS = new Set(
  '--scanners|--quiet|--skip-db-update|--pkg-types|--exit-code|--severity|--ignore-unfixed|--ignorefile|--format|--table-mode|--output'.split(
    '|',
  ),
)
const SBOM_OPTIONS = new Set('--quiet|--skip-db-update|--exit-code|--format|--output'.split('|'))

function policyTokens(command: string): string[] {
  const commandTokens = tokens(command)
  const terminator = commandTokens.indexOf('--')
  return terminator === -1 ? commandTokens : commandTokens.slice(0, terminator)
}

function flagValues(command: string, flag: string): string[] {
  const values: string[] = []
  const commandTokens = policyTokens(command)
  for (const [index, token] of commandTokens.entries()) {
    if (token === flag && commandTokens[index + 1] && !commandTokens[index + 1]!.startsWith('--')) {
      values.push(commandTokens[index + 1]!)
    } else if (token.startsWith(`${flag}=`)) values.push(token.slice(flag.length + 1))
  }
  return values
}

function hasBareBoolean(command: string, flag: string): boolean {
  const commandTokens = policyTokens(command)
  const flagIndexes = commandTokens.flatMap((token, index) => (token === flag ? [index] : []))
  return (
    flagIndexes.length === 1 &&
    !commandTokens.some((token) => token.startsWith(`${flag}=`)) &&
    !/^(?:false|true|0|1)$/i.test(commandTokens[flagIndexes[0]! + 1] ?? '')
  )
}

export function isDownloadDatabaseOnly(command: string): boolean {
  return hasBareBoolean(command, '--download-db-only')
}

function longOptions(command: string): string[] {
  const options: string[] = []
  for (const token of tokens(command)) {
    if (token === '--') break
    if (token.startsWith('-')) options.push(token.split('=')[0]!)
  }
  return options
}

function requireOnlyOptions(command: string, allowed: Set<string>, label: string): void {
  const option = longOptions(command).find((token) => !allowed.has(token))
  if (option) throw new Error(`${label} must not include ${option}`)
}

function hasExactSet(command: string, flag: string, required: string[]): boolean {
  const actual = flagValues(command, flag).flatMap((value) => value.split(','))
  return (
    actual.length === required.length &&
    actual.every((value) => required.includes(value)) &&
    required.every((value) => actual.includes(value))
  )
}

function hasSingleValue(command: string, flag: string, expected?: string): boolean {
  const values = flagValues(command, flag)
  return values.length === 1 && (expected === undefined ? values[0] !== '' : values[0] === expected)
}

function requireFlag(condition: boolean, argument: string): void {
  if (!condition) throw new Error(`Trivy vulnerability scan must include ${argument}`)
}

export function assertVulnerabilityGate(command: string, input: TrivyPolicyOptions = {}): void {
  const { ignoreFile, findingsExitCodeEnv } = resolveOptions(input)
  requireOnlyOptions(command, GATE_OPTIONS, 'Trivy vulnerability scan')
  requireFlag(hasExactSet(command, '--scanners', ['vuln']), '--scanners vuln')
  requireFlag(hasBareBoolean(command, '--quiet'), '--quiet')
  requireFlag(hasBareBoolean(command, '--skip-db-update'), '--skip-db-update')
  requireFlag(hasExactSet(command, '--pkg-types', ['os']), '--pkg-types os')
  requireFlag(
    hasSingleValue(command, '--exit-code', `$${findingsExitCodeEnv}`),
    `--exit-code "$${findingsExitCodeEnv}"`,
  )
  requireFlag(hasExactSet(command, '--severity', ['CRITICAL', 'HIGH']), '--severity CRITICAL,HIGH')
  requireFlag(hasBareBoolean(command, '--ignore-unfixed'), '--ignore-unfixed')
  requireFlag(hasExactSet(command, '--ignorefile', [ignoreFile]), `--ignorefile ${ignoreFile}`)
  requireFlag(hasExactSet(command, '--format', ['table']), '--format table')
  requireFlag(hasExactSet(command, '--table-mode', ['detailed']), '--table-mode detailed')
  requireFlag(hasSingleValue(command, '--output'), '--output <file>')
}

export function isComponentSbomGeneration(command: string): boolean {
  return (
    hasExactSet(command, '--format', ['cyclonedx']) &&
    trivyPackageScanSubcommand(command) !== 'sbom'
  )
}

export function assertUnfilteredComponentSbom(command: string): void {
  requireOnlyOptions(command, SBOM_OPTIONS, 'Trivy CycloneDX SBOM')
  if (!hasBareBoolean(command, '--quiet'))
    throw new Error('Trivy CycloneDX SBOM must include --quiet')
  if (!hasBareBoolean(command, '--skip-db-update'))
    throw new Error('Trivy CycloneDX SBOM must include --skip-db-update')
  if (!hasExactSet(command, '--exit-code', ['0']))
    throw new Error('Trivy CycloneDX SBOM must include --exit-code 0')
  if (!hasExactSet(command, '--format', ['cyclonedx']))
    throw new Error('Trivy CycloneDX SBOM must include --format cyclonedx')
  if (!hasSingleValue(command, '--output'))
    throw new Error('Trivy CycloneDX SBOM must include --output <file>')
}
