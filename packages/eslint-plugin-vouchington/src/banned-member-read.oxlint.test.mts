import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

type Fixture = {
  file: string
  code: string
  expectedDiagnosticCount?: number
}

const OXLINT_BIN = resolve('node_modules/.bin/oxlint')
const PLUGIN = resolve('packages/eslint-plugin-vouchington/src/index.mts')

const invalid: Fixture[] = [
  {
    file: 'src/services/example/static.test.mts',
    code: `RateLimiter.invalidate('prefix')`,
  },
  {
    file: 'src/services/example/instance.test.mts',
    code: `new RateLimiter({ prefix: 'x' }).invalidate()`,
  },
  {
    file: 'src/services/example/import.test.mts',
    code: `import cache from 'cache'\ncache.invalidate()`,
  },
  {
    file: 'src/services/example/factory.test.mts',
    code: `makeLimiter().invalidate()`,
  },
  {
    file: 'src/services/example/parameter.test.mts',
    code: `function reset(target: Cache) { target.invalidate() }`,
  },
  {
    file: 'src/services/example/container.test.mts',
    code: `items[0].invalidate()`,
  },
  {
    file: 'src/services/example/this.test.mts',
    code: `class Helper { reset() { this.limiter.invalidate() } }`,
  },
  {
    file: 'src/services/example/alias.test.mts',
    code: `const reset = limiter.invalidate`,
  },
  {
    file: 'src/services/example/bracket.test.mts',
    code: `cache['invalidate']()`,
  },
  {
    file: 'src/services/example/optional.test.mts',
    code: `cache?.invalidate?.()`,
  },
  {
    file: 'src/services/example/bind.test.mts',
    code: `const reset = cache.invalidate.bind(cache)`,
  },
  {
    file: 'src/services/example/call.test.mts',
    code: `cache.invalidate.call(cache)`,
  },
  {
    file: 'src/services/example/compound.test.mts',
    code: `cache.invalidate ||= reset
cache.invalidate &&= reset
cache.invalidate ??= reset
cache.invalidate += reset
cache.invalidate -= reset
cache.invalidate *= reset
cache.invalidate /= reset
cache.invalidate %= reset
cache.invalidate **= reset
cache.invalidate <<= reset
cache.invalidate >>= reset
cache.invalidate >>>= reset
cache.invalidate &= reset
cache.invalidate ^= reset
cache.invalidate |= reset
cache.invalidate++
--cache.invalidate`,
    expectedDiagnosticCount: 17,
  },
  {
    file: 'src/services/example/template.test.mts',
    code: `cache[\`invalidate\`]()
cache[('invalidate' as const)]()`,
    expectedDiagnosticCount: 2,
  },
  {
    file: 'src/services/example/destructure.test.mts',
    code: `const { invalidate } = cache`,
  },
  {
    file: 'src/services/example/destructure-alias.test.mts',
    code: `const { ['invalidate']: reset } = cache`,
  },
  {
    file: 'src/services/example/destructure-assignment.test.mts',
    code: `let invalidate\n;({ invalidate } = cache)`,
  },
  {
    file: 'src/services/example/destructure-template.test.mts',
    code: `const { [\`invalidate\`]: reset } = cache`,
  },
  {
    file: 'src/test-helpers/entities/scopes.mts',
    code: `import { CacheClient } from '@store/cache'
import { CacheClient as Cache } from '@store/cache'
const CACHE_GROUP_PREFIX = 'cache:group:active'
CacheClient.invalidate(CACHE_GROUP_PREFIX)
Cache.invalidate('cache:group:active')`,
  },
  {
    file: 'src/test-helpers/entities/domains.mts',
    code: `import { CacheClient } from '@store/cache'
import { CacheClient as Cache } from '@store/cache'
const cache = new CacheClient({ prefix: 'validation-domain', ttlSeconds: 3600 })
const other = new CacheClient({ prefix: 'other' })
const aliasCache = new Cache({ prefix: 'validation-domain' })
let mutable = new CacheClient({ prefix: 'validation-domain' })
const reassigned = new CacheClient({ prefix: 'validation-domain' })
const duplicateBad = new CacheClient({ prefix: 'validation-domain', prefix: 'other' })
const duplicateGood = new CacheClient({ prefix: 'other', prefix: 'validation-domain' })
const afterSpread = new CacheClient({ prefix: 'validation-domain', ...options })
const beforeSpread = new CacheClient({ ...options, prefix: 'validation-domain' })
const computedAfter = new CacheClient({ prefix: 'validation-domain', [key]: value })
const computedBefore = new CacheClient({ [key]: value, prefix: 'validation-domain' })
reassigned = other
cache.invalidate()
cache?.invalidate()
other.invalidate()
aliasCache.invalidate()
mutable.invalidate()
reassigned.invalidate()
duplicateBad.invalidate()
duplicateGood.invalidate()
afterSpread.invalidate()
beforeSpread.invalidate()
computedAfter.invalidate()
computedBefore.invalidate()`,
    expectedDiagnosticCount: 8,
  },
  ...[
    'src/services/example.spec.mts',
    'src/services/__tests__/example.mts',
    'src/test-helpers/example.mts',
    'src/services/example/test-helpers/example.mts',
    'src/services/example/test-support.mts',
    'src/services/example/test-support/nested.mts',
    'src/services/example/cleanup.test-helpers.mts',
    'src/services/example/cleanup-test-support.mts',
    'integration/example.mts',
    'browser/tests/example.spec.mts',
  ].map((file) => ({ file, code: `cache.invalidate()` })),
]

const valid: Fixture[] = [
  {
    file: 'src/services/example/bare.test.mts',
    code: `import { invalidate } from './reset.mts'\nawait invalidate()`,
  },
  {
    file: 'src/services/example/domain-reset.test.mts',
    code: `resetDomainCaches()\ncache.invalidateCacheGetByAny()`,
  },
  {
    file: 'src/services/example/object.test.mts',
    code: `const handlers = { invalidate: reset }\ncache.invalidate = reset`,
  },
  {
    file: 'src/services/example/shadow.test.mts',
    code: `function invalidate() {}\ninvalidate()`,
  },
  {
    file: 'src/services/example/dynamic.test.mts',
    code: `cache[operation]()
cache[\`\${operation}\`]()
const { [operation]: reset } = cache`,
  },
  {
    file: 'src/services/example/write-only.test.mts',
    code: `cache.invalidate = reset
delete cache.invalidate`,
  },
  {
    file: 'src/services/example/source.mts',
    code: `cache.invalidate()`,
  },
  {
    file: 'browser/global-setup.mts',
    code: `RateLimiter.invalidate('global-setup')`,
  },
]

describe('vouchington/banned-member-read', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'vouchington-oxlint-rate-limiter-'))
    for (const fixture of [...invalid, ...valid]) {
      const path = join(root, fixture.file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, fixture.code)
    }
    writeFileSync(
      join(root, '.oxlintrc.json'),
      JSON.stringify({
        categories: { correctness: 'off', suspicious: 'off', perf: 'off' },
        jsPlugins: [{ name: 'vouchington', specifier: PLUGIN }],
        plugins: [],
        rules: {
          'vouchington/banned-member-read': [
            'error',
            {
              members: ['invalidate'],
              include: [
                '**/*.test.mts',
                '**/*.spec.mts',
                '**/__tests__/**',
                '**/test-helpers/**',
                '**/test-support*',
                '**/test-support/**',
                '**/*test-helpers.mts',
                '**/*test-support.mts',
                'integration/**',
                'browser/tests/**',
              ],
              exceptions: [
                {
                  file: './src/test-helpers/entities/scopes.mts',
                  member: 'invalidate',
                  module: '@store/cache',
                  imported: 'CacheClient',
                  local: 'CacheClient',
                  kind: 'constructor-constant',
                  constant: { name: 'CACHE_GROUP_PREFIX', value: 'cache:group:active' },
                },
                {
                  file: '././src/test-helpers/entities/domains.mts',
                  member: 'invalidate',
                  module: '@store/cache',
                  imported: 'CacheClient',
                  local: 'CacheClient',
                  kind: 'const-instance-prefix',
                  prefix: 'validation-domain',
                },
              ],
            },
          ],
        },
      }),
    )
  })

  afterAll(() => {
    rmSync(root, { force: true, recursive: true })
  })

  it('bans statically named invalidate reads throughout protected test surfaces', () => {
    const result = spawnSync(OXLINT_BIN, ['-c', '.oxlintrc.json', '--format', 'json', '.'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    const { diagnostics } = JSON.parse(result.stdout) as {
      diagnostics: Array<{ filename: string }>
    }
    const actual = diagnostics.map(({ filename }) => filename.replace(`${root}/`, '')).toSorted()
    const expected = invalid
      .flatMap(({ expectedDiagnosticCount = 1, file }) =>
        Array.from({ length: expectedDiagnosticCount }, () => file),
      )
      .toSorted()
    expect(actual).toEqual(expected)
  })
})
