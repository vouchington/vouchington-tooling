export type ClocCategories = { source: string; tests: string; tooling: string }
export type ClocServiceRule = { name: string; match: string[] }

/** The repository layout, as a consumer writes it. Every field is optional. */
export type ClocConfigInput = {
  /** Ordered rules; the first whose `match` patterns match a file wins. Also the table row order. */
  services?: ClocServiceRule[]
  /** Service for files no rule matches. Appended after the listed services when not among them. */
  defaultService?: string
  /** Column names for the three categories. */
  categories?: Partial<ClocCategories>
  /** Patterns marking test files; checked first. */
  testPatterns?: string[]
  /** Patterns marking tooling files; checked after tests. Everything else is source. */
  toolingPatterns?: string[]
  /** Directories counted (themselves or anything under). Omit both root lists to count everything. */
  countedRoots?: string[]
  /** Individual files counted at exact paths. */
  countedRootFiles?: string[]
  /** Directory names scc skips. */
  excludedDirs?: string[]
  /** Directory names whose files are never counted, at any depth. */
  ignoredDirs?: string[]
  /** scc binary; `--scc-bin` and `SCC_BIN` override it. */
  sccBin?: string
  /** Appended to the error shown when the scc binary cannot be found. */
  missingSccHint?: string
}

export type ClocConfig = {
  services: ClocServiceRule[]
  defaultService: string
  categories: ClocCategories
  testPatterns: string[]
  toolingPatterns: string[]
  countedRoots: string[]
  countedRootFiles: string[]
  excludedDirs: string[]
  ignoredDirs: string[]
  sccBin?: string
  missingSccHint?: string
}

export const DEFAULT_EXCLUDED_DIRS = [
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]
export const DEFAULT_IGNORED_DIRS = ['fixtures', '__fixtures__', '__snapshots__']

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('cloc config must be an object')
  }
  return value as Record<string, unknown>
}

function list(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw new Error(`cloc config "${field}" must be an array of non-empty strings`)
  }
  return value as string[]
}

function text(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '') {
    throw new Error(`cloc config "${field}" must be a non-empty string`)
  }
  return value
}

function services(value: unknown): ClocServiceRule[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('cloc config "services" must be an array')
  return value.map((rule: unknown, index) => {
    const entry = (rule ?? {}) as Partial<ClocServiceRule>
    const name = text(entry.name, `services[${index}].name`)
    if (name === undefined) throw new Error(`cloc config "services[${index}].name" is required`)
    return { name, match: list(entry.match, `services[${index}].match`) }
  })
}

/** Validates a raw config value and fills defaults. Throws a descriptive error when malformed. */
export function normalizeClocConfig(raw: unknown): ClocConfig {
  const input = asRecord(raw)
  const rules = services(input.services)
  const defaultService = text(input.defaultService, 'defaultService') ?? 'other'
  if (!rules.some((rule) => rule.name === defaultService)) {
    rules.push({ name: defaultService, match: [] })
  }
  const names = rules.map((rule) => rule.name)
  const duplicate = names.find((name, index) => names.indexOf(name) !== index)
  if (duplicate !== undefined) throw new Error(`cloc config has duplicate service "${duplicate}"`)
  if (names.includes('total')) throw new Error('cloc config service name "total" is reserved')
  const categories = (input.categories ?? {}) as Partial<ClocCategories>
  const labels: ClocCategories = {
    source: text(categories.source, 'categories.source') ?? 'source',
    tests: text(categories.tests, 'categories.tests') ?? 'tests',
    tooling: text(categories.tooling, 'categories.tooling') ?? 'tooling',
  }
  if (new Set(Object.values(labels)).size !== 3) {
    throw new Error('cloc config category names must be distinct')
  }
  const sccBin = text(input.sccBin, 'sccBin')
  const missingSccHint = text(input.missingSccHint, 'missingSccHint')
  return {
    services: rules,
    defaultService,
    categories: labels,
    testPatterns: list(input.testPatterns, 'testPatterns'),
    toolingPatterns: list(input.toolingPatterns, 'toolingPatterns'),
    countedRoots: list(input.countedRoots, 'countedRoots'),
    countedRootFiles: list(input.countedRootFiles, 'countedRootFiles'),
    excludedDirs:
      input.excludedDirs === undefined
        ? DEFAULT_EXCLUDED_DIRS
        : list(input.excludedDirs, 'excludedDirs'),
    ignoredDirs:
      input.ignoredDirs === undefined
        ? DEFAULT_IGNORED_DIRS
        : list(input.ignoredDirs, 'ignoredDirs'),
    ...(sccBin === undefined ? {} : { sccBin }),
    ...(missingSccHint === undefined ? {} : { missingSccHint }),
  }
}
