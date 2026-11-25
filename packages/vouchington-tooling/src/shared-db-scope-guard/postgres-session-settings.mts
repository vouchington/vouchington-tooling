/** Keep the longest test SQL statement below typical 30-second test project deadlines. */
export const MAX_TEST_STATEMENT_TIMEOUT_MS = 20_000
/** Five-second projects reserve their remaining time for assertions and cleanup. */
export const FAST_TEST_STATEMENT_TIMEOUT_MS = 2_000
/** Shared notice observers require a full second; smaller operation-local bounds stay separate. */
export const MIN_TEST_STATEMENT_TIMEOUT_MS = 1_000

const GUC_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.]*$/u

export interface StatementTimeoutBounds {
  defaultMs?: number
  minMs?: number
  maxMs?: number
  envVarName?: string
}

/** Parses a bounded positive integer statement timeout in milliseconds. */
export function parseTestStatementTimeout(
  raw: string | undefined,
  bounds: StatementTimeoutBounds = {},
): number {
  const defaultMs = bounds.defaultMs ?? FAST_TEST_STATEMENT_TIMEOUT_MS
  const minMs = bounds.minMs ?? MIN_TEST_STATEMENT_TIMEOUT_MS
  const maxMs = bounds.maxMs ?? MAX_TEST_STATEMENT_TIMEOUT_MS
  const envVarName = bounds.envVarName ?? 'PG_TEST_STATEMENT_TIMEOUT_MS'
  if (!Number.isSafeInteger(minMs) || !Number.isSafeInteger(maxMs) || minMs < 1 || minMs > maxMs) {
    throw new RangeError(`${envVarName} bounds must be safe integers with 1 <= minMs <= maxMs`)
  }
  if (!Number.isSafeInteger(defaultMs) || defaultMs < minMs || defaultMs > maxMs) {
    throw new RangeError(`${envVarName} default must be an integer from ${minMs} to ${maxMs}`)
  }
  if (raw === undefined) return defaultMs
  const value = Number(raw)
  if (!/^[1-9]\d*$/u.test(raw) || !Number.isSafeInteger(value) || value < minMs || value > maxMs) {
    throw new RangeError(`${envVarName} must be an integer from ${minMs} to ${maxMs}`)
  }
  return value
}

export interface TestPostgresSessionOptions {
  /** Environment variable names holding PostgreSQL connection URIs. Defaults to `DATABASE_URL` and `READ_DATABASE_URL`. */
  envKeys?: readonly string[]
  /** Environment variable supplying a custom statement timeout. Defaults to `PG_TEST_STATEMENT_TIMEOUT_MS`. */
  statementTimeoutEnvVar?: string
  /** Optional bounds for `parseTestStatementTimeout`. */
  statementTimeoutBounds?: StatementTimeoutBounds
  /** Whether to prepend `-c jit=off` when adding a new `options` query parameter. Defaults to `true`. */
  jitOff?: boolean
  /** Additional PostgreSQL session GUC settings appended as `-c <name>=<value>` (for example `{ 'hnsw.ef_search': 1000 }`). */
  extraSettings?: Readonly<Record<string, string | number>>
}

function formatExtraSetting(name: string, settingValue: string | number): string {
  if (!GUC_NAME_PATTERN.test(name)) {
    throw new RangeError(`Invalid PostgreSQL GUC setting name: "${name}"`)
  }
  if (name.toLowerCase() === 'statement_timeout') {
    throw new RangeError(
      'Configure statement_timeout via statementTimeoutEnvVar or statementTimeoutBounds instead of extraSettings',
    )
  }
  const escaped = String(settingValue).replaceAll('\\', '\\\\').replace(/\s/gu, '\\$&')
  return `-c ${name}=${escaped}`
}

/**
 * Appends deterministic PostgreSQL startup `options` to configured connection URL environment
 * variables while preserving hostless socket URIs, fragments, `%20`, and raw `+` characters.
 * Idempotent when called repeatedly.
 */
export function configureTestPostgresSessions(
  env: NodeJS.ProcessEnv = process.env,
  options: TestPostgresSessionOptions = {},
): void {
  const envKeys = options.envKeys ?? ['DATABASE_URL', 'READ_DATABASE_URL']
  const timeoutEnvVar = options.statementTimeoutEnvVar ?? 'PG_TEST_STATEMENT_TIMEOUT_MS'
  const statementTimeoutMs = parseTestStatementTimeout(env[timeoutEnvVar], {
    ...options.statementTimeoutBounds,
    envVarName: options.statementTimeoutBounds?.envVarName ?? timeoutEnvVar,
  })
  const extraParts = Object.entries(options.extraSettings ?? {}).map(([name, settingValue]) =>
    formatExtraSetting(name, settingValue),
  )
  const settings = [`-c statement_timeout=${statementTimeoutMs}`, ...extraParts].join(' ')
  const initialPrefix = (options.jitOff ?? true) ? `-c jit=off ${settings}` : settings

  for (const key of envKeys) {
    const value = env[key]
    if (!value) continue
    const fragmentAt = value.indexOf('#')
    const beforeFragment = fragmentAt < 0 ? value : value.slice(0, fragmentAt)
    const fragment = fragmentAt < 0 ? '' : value.slice(fragmentAt)
    const queryAt = beforeFragment.indexOf('?')
    const connection = queryAt < 0 ? beforeFragment : beforeFragment.slice(0, queryAt)
    const query = queryAt < 0 ? '' : beforeFragment.slice(queryAt + 1)
    const parts = query ? query.split('&') : []
    const lastOptionsIndex = parts.findLastIndex((part) => new URLSearchParams(part).has('options'))
    const updated: string[] = []
    for (const [index, part] of parts.entries()) {
      if (!new URLSearchParams(part).has('options')) {
        updated.push(part)
        continue
      }
      if (index !== lastOptionsIndex) continue
      // libpq treats a raw '+' in options literally; URLSearchParams decodes it as a space.
      const equalsAt = part.indexOf('=')
      const rawOptions = equalsAt < 0 ? '' : part.slice(equalsAt + 1)
      const previous = new URLSearchParams(`options=${rawOptions.replaceAll('+', '%2B')}`).get(
        'options',
      )!
      const next = previous.endsWith(settings) ? previous : `${previous} ${settings}`
      updated.push(`options=${encodeURIComponent(next)}`)
    }
    if (lastOptionsIndex < 0) {
      updated.push(`options=${encodeURIComponent(initialPrefix)}`)
    }
    // Keep the original URI and unrelated query bytes, including hostless socket URLs and %20.
    env[key] = `${connection}?${updated.join('&')}${fragment}`
  }
}
