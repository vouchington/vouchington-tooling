import { describe, expect, it } from 'vitest'
import { collectConfigInventory, formatConfigInventoryMarkdown } from './index.mts'
import { addEnvVar } from './env-var-accumulator.mts'
import { matchNames } from './shared.mts'
import type { EnvVarAccumulator } from './types.mts'
import type { ConfigInventoryOptions, ConfigSourceRules } from './index.mts'

function inventory(
  files: Record<string, string | null>,
  rules: Record<string, ConfigSourceRules | null> = {},
  extra: Partial<ConfigInventoryOptions> = {},
) {
  return collectConfigInventory(
    { trackedFiles: Object.keys(files), readTrackedFile: (file) => files[file]! },
    { describeFile: (file) => (rules[file] === undefined ? {} : rules[file]), ...extra },
  )
}

describe('configuration inventory', () => {
  it('escapes configured helper names containing regular-expression characters', () => {
    const result = inventory(
      { 'service.ts': 'read$Env("DOLLAR_ENV"); $env("LEADING_DOLLAR"); other$env("NO_MATCH")' },
      {},
      { envHelperNames: ['read$Env', '$env'] },
    )
    expect(result.envVars.map((row) => row.name)).toEqual(['DOLLAR_ENV', 'LEADING_DOLLAR'])
  })
  it('rejects malformed names before they enter reference matchers', () => {
    const values = new Map<string, EnvVarAccumulator>()
    addEnvVar(values, 'bad-name', 'source.ts', 'readers')
    expect(values.size).toBe(0)
  })
  it('discovers different consumer layouts and attaches late references without product policy', () => {
    const result = inventory(
      {
        'a/ops.md': '`LATE_SETTING` some/PORT MY-PORT-ENV',
        'z/app.ts':
          'process.env.LATE_SETTING; process.env["PORT"]; const { TOKEN: alias, OTHER = "", ...rest } = process.env',
        'edge/main.ts': 'env.EDGE_BINDING',
        'settings/local.env': 'export PORT=3000\nARG=unused\nENV=unused\n',
        'tools/bootstrap': "export SHELL_SETTING=1\nprintf 'export GENERATED_SETTING=1'\nCOLOR=red",
        'settings/worker.json': '{"JSON_BINDING":"value"}',
        'image/spec': 'ARG BUILD_SETTING=0\nENV RUNTIME_SETTING=1\n',
        'automation/check.yaml':
          'env:\n  # comment\n\n  CI_SETTING: x\n  SCRIPT: |\n    NESTED: text\njobs: {}',
        'manifest.json': '{"scripts":{"test":"TEST_MODE=yes runner"}}',
        'skip/fixture.ts': 'process.env.IGNORED',
        'missing.ts': null,
      },
      {
        'a/ops.md': { markdown: true, referenceBuckets: ['docs'] },
        'edge/main.ts': { workerBindings: true },
        'settings/local.env': { localAssignments: true },
        'tools/bootstrap': { shellExports: true },
        'settings/worker.json': { jsonBindings: true },
        'image/spec': { docker: true },
        'automation/check.yaml': { workflow: true },
        'manifest.json': { packageManifest: true },
        'skip/fixture.ts': null,
      },
    )
    expect(result.envVars.map((row) => row.name)).toEqual([
      'ARG',
      'BUILD_SETTING',
      'CI_SETTING',
      'EDGE_BINDING',
      'ENV',
      'GENERATED_SETTING',
      'JSON_BINDING',
      'LATE_SETTING',
      'OTHER',
      'PORT',
      'RUNTIME_SETTING',
      'SCRIPT',
      'SHELL_SETTING',
      'TEST_MODE',
      'TOKEN',
    ])
    expect(result.envVars.find((row) => row.name === 'LATE_SETTING')).toMatchObject({
      readers: ['z/app.ts'],
      docs: ['a/ops.md'],
      classifications: [],
      reviewReason: null,
    })
    expect(result.envVars.find((row) => row.name === 'PORT')).toMatchObject({
      docs: [],
      localSetup: ['settings/local.env'],
    })
    expect(result.envVars.find((row) => row.name === 'BUILD_SETTING')).toMatchObject({
      dockerBuildArgs: ['image/spec'],
      deployment: ['image/spec'],
    })
    expect(result.envVars.find((row) => row.name === 'TEST_MODE')?.packageGates).toEqual([
      'manifest.json',
    ])
    expect(result.envVars.find((row) => row.name === 'CI_SETTING')?.workflows).toEqual([
      'automation/check.yaml',
    ])
    expect(result.envVars.find((row) => row.name === 'EDGE_BINDING')?.readers).toEqual([
      'edge/main.ts',
    ])
    expect(result.envVars.find((row) => row.name === 'JSON_BINDING')?.localSetup).toEqual([
      'settings/worker.json',
    ])
  })

  it('collects known helper calls, constant indexes, local wrappers and prefix readers', () => {
    const source = [
      'process.env[EXACT]; process.env[MISSING]',
      'readRequiredEnv("HELPER_ENV"); unknownHelper("NOT_CONFIGURED")',
      'read("LITERAL_ENV"); read(EXACT); read(UNKNOWN); read()',
      String.raw`read("NOT\"AN_ENV")`,
      'readFrom(env, "OBJECT_ENV"); readFrom(env, `${PREFIX}${name}`)',
      'readFrom(env, `${UNKNOWN_PREFIX}${name}`)',
      'function read(name: string) {',
      '  return process.env[name]',
      '}',
      'function readFrom(env: Record<string, string>, name: string) {',
      '  return env[name]',
      '}',
    ].join('\n')
    const result = inventory(
      { 'service.ts': source, 'notes.md': source },
      {
        'notes.md': { markdown: true },
      },
      {
        envContract: [{ name: 'PREFIX_ONE' }, { name: 'UNRELATED' }],
        envConstants: new Map([
          ['EXACT', 'CONSTANT_ENV'],
          ['PREFIX', 'PREFIX_'],
        ]),
        envHelperNames: ['readRequiredEnv'],
      },
    )
    expect(result.envVars.map((row) => row.name)).toEqual([
      'CONSTANT_ENV',
      'HELPER_ENV',
      'LITERAL_ENV',
      'OBJECT_ENV',
      'PREFIX_ONE',
      'UNRELATED',
    ])
    for (const row of result.envVars) {
      expect(row.readers).toEqual(row.name === 'UNRELATED' ? [] : ['service.ts'])
    }
  })

  it('keeps wrapper argument positions when an earlier parameter is destructured', () => {
    const source = [
      'function read({ ignored }: { ignored: string }, name: string) {',
      '  return process.env[name]',
      '}',
      "read({ ignored: 'x' }, 'AFTER_DESTRUCTURED')",
    ].join('\n')
    const result = inventory({ 'service.ts': source })
    expect(result.envVars.map((row) => row.name)).toEqual(['AFTER_DESTRUCTURED'])
  })

  it('ignores regular-expression matches with no participating name capture', () => {
    expect(matchNames('A AB', /A(B)?/g)).toEqual(['B'])
  })

  it('merges contract metadata and applies caller annotations after evidence collection', () => {
    const result = inventory(
      { 'src.ts': 'process.env.API_KEY' },
      {},
      {
        envContract: [
          { name: 'invalid-name', sensitivity: 'secret' },
          {
            name: 'API_KEY',
            contractKey: 'local',
            sourceOfTruth: 'local',
            sensitivity: 'custom',
            runtimeSurfaces: ['api'],
          },
          {
            name: 'API_KEY',
            contractKey: 'deploy',
            sourceOfTruth: 'infra',
            sensitivity: 'public',
            runtimeSurfaces: ['worker', 'api'],
          },
          { name: 'API_KEY', sensitivity: 'secret' },
          { name: 'API_KEY', sensitivity: 'internal' },
          { name: 'API_KEY' },
        ],
        annotateEnv: (row) => ({
          classifications: [row.readers.length ? 'used' : 'unused'],
          reviewReason: 'owner review',
        }),
      },
    )
    expect(result.envVars).toEqual([
      expect.objectContaining({
        name: 'API_KEY',
        contractKey: 'local',
        contractKeys: ['deploy', 'local'],
        sourceOfTruth: 'local',
        sensitivity: 'secret',
        runtimeSurfaces: ['api', 'worker'],
        classifications: ['used'],
        reviewReason: 'owner review',
      }),
    ])
  })

  it('uses caller sensitivity order for a second consumer taxonomy', () => {
    const result = inventory(
      { 'service.ts': 'process.env.CREDENTIAL' },
      {},
      {
        envContract: [
          { name: 'CREDENTIAL', sensitivity: 'restricted' },
          { name: 'CREDENTIAL', sensitivity: 'public' },
          { name: 'CREDENTIAL', sensitivity: 'sensitive' },
        ],
        sensitivityOrder: ['public', 'sensitive', 'restricted'],
      },
    )
    expect(result.envVars[0]?.sensitivity).toBe('restricted')
  })

  it('does not promote an unranked sensitivity over a ranked one', () => {
    const result = inventory(
      {},
      {},
      {
        envContract: [
          { name: 'CREDENTIAL', sensitivity: 'public' },
          { name: 'CREDENTIAL', sensitivity: 'unranked' },
        ],
        sensitivityOrder: ['public', 'restricted'],
      },
    )
    expect(result.envVars[0]?.sensitivity).toBe('public')
  })

  it('retains ARG and ENV when they are real environment variables', () => {
    const result = inventory({ 'service.ts': 'process.env.ARG; process.env.ENV' })
    expect(result.envVars.map((row) => row.name)).toEqual(['ARG', 'ENV'])
  })

  it('uses caller namespace adapters and merges package gates from multiple selected files', () => {
    const result = inventory(
      {
        'a/settings.yml':
          'allowBuilds:\n  native-module: true\nminimumReleaseAge: 1440\nignoredOptionalDependencies: [skip-me, 1, false, {not: scalar}]\noverrides: null',
        'b/settings.yml':
          'allowBuilds: [native-module, other-module]\nstrictDepBuilds: true\nminimumReleaseAge: 2880',
        'c/registry.ts': 'registry data',
      },
      {
        'a/settings.yml': { packageManagerConfig: true },
        'b/settings.yml': { packageManagerConfig: true },
      },
      {
        collectDynamicConfigs: (file) =>
          file.endsWith('.yml')
            ? [
                { namespace: 'search', kind: 'definition' },
                { namespace: 'search', kind: 'definition' },
              ]
            : [
                { namespace: 'search', kind: 'registry' },
                { namespace: 'other', kind: 'registry' },
              ],
      },
    )
    expect(result.dynamicConfigs).toEqual([
      { namespace: 'other', definitionFiles: [], registryFiles: ['c/registry.ts'] },
      {
        namespace: 'search',
        definitionFiles: ['a/settings.yml', 'b/settings.yml'],
        registryFiles: ['c/registry.ts'],
      },
    ])
    expect(result.packageGates).toEqual([
      {
        name: 'allowBuilds',
        values: ['native-module', 'other-module'],
        files: ['a/settings.yml', 'b/settings.yml'],
      },
      {
        name: 'ignoredOptionalDependencies',
        values: ['1', 'false', 'skip-me'],
        files: ['a/settings.yml'],
      },
      {
        name: 'minimumReleaseAge',
        values: ['1440', '2880'],
        files: ['a/settings.yml', 'b/settings.yml'],
      },
      { name: 'strictDepBuilds', values: ['true'], files: ['b/settings.yml'] },
    ])
  })

  it.each(['[', 'null', '3', '- item'])(
    'ignores unsupported package configuration %s',
    (source) => {
      expect(
        inventory({ settings: source }, { settings: { packageManagerConfig: true } }).packageGates,
      ).toEqual([])
    },
  )

  it('deduplicates selected files, excludes before reading and propagates reader failures', () => {
    const read: string[] = []
    const result = collectConfigInventory(
      {
        trackedFiles: ['skip', 'a', 'a'],
        readTrackedFile(file) {
          read.push(file)
          return 'process.env.ONE'
        },
      },
      { describeFile: (file) => (file === 'skip' ? null : {}) },
    )
    expect(read).toEqual(['a'])
    expect(result.envVars[0]?.readers).toEqual(['a'])
    expect(() =>
      collectConfigInventory(
        {
          trackedFiles: ['broken'],
          readTrackedFile() {
            throw new Error('unreadable')
          },
        },
        { describeFile: () => ({}) },
      ),
    ).toThrow('unreadable')
  })

  it('formats all evidence and keeps JSON output independent from classification policy', () => {
    const result = inventory(
      { 'file|name.ts': 'process.env.API_KEY' },
      {},
      {
        envContract: [
          {
            name: 'API_KEY',
            contractKey: 'deploy',
            sourceOfTruth: 'infra',
            sensitivity: 'secret',
            runtimeSurfaces: ['api'],
          },
        ],
        annotateEnv: () => ({ classifications: ['credential'], reviewReason: 'review' }),
        collectDynamicConfigs: () => [{ namespace: 'feature', kind: 'definition' }],
      },
    )
    result.packageGates.push({ name: 'allowBuilds', values: ['native'], files: ['config'] })
    const markdown = formatConfigInventoryMarkdown(result)
    expect(markdown).toContain(
      '| `API_KEY` | `credential` | `deploy` | `infra` | `secret` | `api` | `file\\|name.ts` |',
    )
    expect(markdown).toContain('| `feature` | `file\\|name.ts` |  |')
    expect(markdown).toContain('| `allowBuilds` | `native` | `config` |')
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(
      formatConfigInventoryMarkdown(inventory({ 'a.ts': 'process.env.EMPTY_METADATA' })),
    ).toContain('| `EMPTY_METADATA` |  |  |  |  |')
  })

  it('keeps unusual filenames and review reasons inside one Markdown table cell', () => {
    const result = inventory(
      { 'path|`name\nmore.ts': 'process.env.SERVICE_KEY' },
      {},
      {
        annotateEnv: () => ({ classifications: [], reviewReason: 'review|next\n<script>`' }),
      },
    )
    result.envVars[0]!.dockerBuildArgs.push('build|`step\nnext')
    const markdown = formatConfigInventoryMarkdown(result)
    expect(markdown).toContain('`` path\\|`name more.ts ``')
    expect(markdown).toContain('`` build\\|`step next ``')
    expect(markdown).toContain('review&#124;next &lt;script&gt;&#96;')
    expect(markdown).not.toContain('review|next\n<script>`')
  })
})
