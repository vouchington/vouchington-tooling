import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { SharedContext } from '../shared-context/index.mts'
import {
  buildSccArgs,
  checkSccComplexity,
  parseSccComplexityViolations,
  parseSccComplexityBaseline,
  SCC_COMPLEXITY_BASELINE_VERSION,
  SCC_COMPLEXITY_LIMIT,
} from './index.mts'

describe('scc-complexity', () => {
  const testDirs: string[] = []

  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  async function makeFixture(
    trackedFiles: string[],
    isInsideGitRepo = true,
  ): Promise<SharedContext> {
    const repoRoot = await mkdtemp(join(tmpdir(), 'scc-complexity-'))
    testDirs.push(repoRoot)

    for (const file of trackedFiles) {
      await mkdir(dirname(join(repoRoot, file)), { recursive: true })
      await writeFile(join(repoRoot, file), 'export const value = true\n')
    }

    return {
      isInsideGitRepo,
      repoRoot,
      trackedFiles,
      trackedFileSet: new Set(trackedFiles),
    }
  }

  it('reports tracked production files with complexity above the limit', () => {
    const report = JSON.stringify([
      {
        Files: [
          { Location: 'src/too-complex.mts', Complexity: 51 },
          { Location: 'src/at-limit.mts', Complexity: 50 },
          { Location: 'src/untracked.mts', Complexity: 99 },
          { Location: 12, Complexity: 99 },
          { Location: 'src/too-complex.mts', Complexity: '99' },
        ],
      },
      { Files: null },
      {},
    ])

    expect(
      parseSccComplexityViolations(report, new Set(['src/too-complex.mts', 'src/at-limit.mts'])),
    ).toEqual([{ complexity: 51, file: 'src/too-complex.mts' }])
  })

  it('sorts violations by descending complexity then file name', () => {
    const report = JSON.stringify([
      {
        Files: [
          { Location: 'b.mts', Complexity: 60 },
          { Location: 'a.mts', Complexity: 80 },
          { Location: 'c.mts', Complexity: 60 },
        ],
      },
    ])

    expect(parseSccComplexityViolations(report, new Set(['a.mts', 'b.mts', 'c.mts']))).toEqual([
      { complexity: 80, file: 'a.mts' },
      { complexity: 60, file: 'b.mts' },
      { complexity: 60, file: 'c.mts' },
    ])
  })

  it('rejects non-array scc JSON and respects a custom complexity limit', () => {
    expect(() => parseSccComplexityViolations('{}', new Set())).toThrow(
      'scc JSON output must be an array',
    )
    expect(
      parseSccComplexityViolations(
        JSON.stringify([{ Files: [{ Location: 'a.mts', Complexity: 11 }] }]),
        new Set(['a.mts']),
        10,
      ),
    ).toEqual([{ complexity: 11, file: 'a.mts' }])
  })

  it('encodes parameterized test and directory exclusions in the scc arguments', () => {
    expect(buildSccArgs()).toContain(String.raw`\.(test|spec)\.`)
    expect(buildSccArgs()).toContain('.git,fixtures,__tests__,test-helpers')
    expect(buildSccArgs({ excludeDir: 'vendor,dist' })).toContain('vendor,dist')
    expect(buildSccArgs({ includeExt: 'rs', notMatch: String.raw`\.generated\.` })).toEqual(
      expect.arrayContaining(['rs', String.raw`\.generated\.`]),
    )
  })

  it('formats errors for scanner violations using the configured limit', async () => {
    const ctx = await makeFixture(['src/too-complex.mts'])
    const report = JSON.stringify([
      { Files: [{ Location: 'src/too-complex.mts', Complexity: 72 }] },
    ])

    await expect(
      checkSccComplexity(ctx, { limit: 50 }, () => Promise.resolve(report)),
    ).resolves.toEqual({
      errors: [
        '::error file=src/too-complex.mts::src/too-complex.mts: scc complexity 72 exceeds 50; simplify or split this file',
      ],
    })
  })

  it('returns a setup error when scc cannot run and when the repo is missing', async () => {
    const ctx = await makeFixture(['src/file.mts'])
    await expect(
      checkSccComplexity(ctx, {}, () =>
        Promise.reject(new Error('scc executable not found; install with mise install')),
      ),
    ).resolves.toEqual({
      errors: [
        '::error::scc-complexity failed: scc executable not found; install with mise install',
      ],
    })
    await expect(checkSccComplexity(ctx, {}, () => Promise.reject('boom'))).resolves.toEqual({
      errors: ['::error::scc-complexity failed: boom'],
    })
    const outside = await makeFixture([], false)
    await expect(checkSccComplexity(outside)).resolves.toEqual({
      errors: [`::error::${outside.repoRoot} is not inside a git repository`],
    })
  })

  it('runs the default scc process wrapper and reads its output file', async () => {
    const ctx = await makeFixture(['src/file.mts'])
    const binDir = await mkdtemp(join(tmpdir(), 'scc-fake-'))
    testDirs.push(binDir)
    const executable = join(binDir, 'scc')
    await writeFile(
      executable,
      '#!/bin/sh\nprintf "%s\\n" "$@" >> "$0.args"\nwhile [ "$1" != "--output" ]; do shift; done\nprintf \'[{"Files":[]}]\' > "$2"\n',
    )
    await chmod(executable, 0o755)

    await expect(
      checkSccComplexity(ctx, {
        command: executable,
        tmpdirPrefix: 'scc-complexity-custom-',
        includeExt: 'mts',
        excludeDir: 'vendor',
      }),
    ).resolves.toEqual({ errors: [] })

    const previousPath = process.env.PATH
    process.env.PATH = `${binDir}${previousPath ? `:${previousPath}` : ''}`
    try {
      await expect(
        checkSccComplexity(ctx, { tmpdirPrefix: 'scc-complexity-path-' }),
      ).resolves.toEqual({
        errors: [],
      })
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
    }
    expect(SCC_COMPLEXITY_LIMIT).toBe(50)

    await expect(
      checkSccComplexity(ctx, {
        command: executable,
        scopes: [
          { includePaths: ['src'], name: 'application' },
          { includePaths: ['dev'], name: 'tooling' },
        ],
      }),
    ).resolves.toEqual({ errors: [] })
    await expect(readFile(`${executable}.args`, 'utf8')).resolves.toContain('src\n')
    await expect(readFile(`${executable}.args`, 'utf8')).resolves.toContain('dev\n')
  })

  it('reports missing and nonzero scc executables through the default wrapper', async () => {
    const ctx = await makeFixture(['src/file.mts'])
    const binDir = await mkdtemp(join(tmpdir(), 'scc-fake-'))
    testDirs.push(binDir)
    const executable = join(binDir, 'scc')
    await writeFile(executable, '#!/bin/sh\nprintf failure >&2\nexit 9\n')
    await chmod(executable, 0o755)

    await expect(
      checkSccComplexity(ctx, { command: join(binDir, 'missing-scc') }),
    ).resolves.toEqual({
      errors: [
        '::error::scc-complexity failed: scc executable not found; install with mise install',
      ],
    })
    const report = await checkSccComplexity(ctx, { command: executable })
    expect(report.errors[0]).toContain('scc-complexity failed:')
  })

  it('runs each named scope with positional paths and labels diagnostics', async () => {
    const ctx = await makeFixture(['dev/tool.mts', 'src/app.mts'])
    const calls: Array<{ outputPath: string; scope: string | undefined }> = []

    const report = await checkSccComplexity(
      ctx,
      {
        scopes: [
          { name: 'application', includePaths: ['src'] },
          { name: 'tooling', includePaths: ['dev'], limit: 10 },
        ],
      },
      (outputPath, scope) => {
        calls.push({ outputPath, scope: scope?.name })
        return Promise.resolve(
          JSON.stringify([
            {
              Files: [
                {
                  Complexity: scope?.name === 'tooling' ? 11 : 51,
                  Location: scope?.name === 'tooling' ? 'dev/tool.mts' : 'src/app.mts',
                },
              ],
            },
          ]),
        )
      },
    )

    expect(calls.map((call) => call.scope)).toEqual(['application', 'tooling'])
    expect(report.errors).toEqual([
      '::error file=src/app.mts::[application] src/app.mts: scc complexity 51 exceeds 50; simplify or split this file',
      '::error file=dev/tool.mts::[tooling] dev/tool.mts: scc complexity 11 exceeds 10; simplify or split this file',
    ])
  })

  it('allows only non-regressing scoped baseline entries and rejects invalid entries', async () => {
    const ctx = await makeFixture(['dev/tool.mts'])
    const baseline = parseSccComplexityBaseline(
      JSON.stringify({
        entries: [{ complexity: 12, file: 'dev/tool.mts', scope: 'tooling' }],
        version: SCC_COMPLEXITY_BASELINE_VERSION,
      }),
    )
    const options = { baseline, scopes: [{ name: 'tooling', includePaths: ['dev'], limit: 10 }] }
    const report = JSON.stringify([{ Files: [{ Complexity: 12, Location: 'dev/tool.mts' }] }])

    await expect(checkSccComplexity(ctx, options, () => Promise.resolve(report))).resolves.toEqual({
      errors: [],
    })
    await expect(
      checkSccComplexity(ctx, options, () =>
        Promise.resolve(
          JSON.stringify([{ Files: [{ Complexity: 13, Location: 'dev/tool.mts' }] }]),
        ),
      ),
    ).resolves.toEqual({
      errors: [
        '::error file=dev/tool.mts::[tooling] dev/tool.mts: scc complexity 13 exceeds baseline ceiling 12',
      ],
    })
    const stale = parseSccComplexityBaseline(
      JSON.stringify({
        entries: [{ complexity: 12, file: 'dev/missing.mts', scope: 'tooling' }],
        version: SCC_COMPLEXITY_BASELINE_VERSION,
      }),
    )
    await expect(
      checkSccComplexity(ctx, { ...options, baseline: stale }, () => Promise.resolve(report)),
    ).resolves.toEqual({
      errors: [
        '::error::scc-complexity failed: baseline entry tooling:dev/missing.mts is untracked',
      ],
    })
  })

  it('rejects malformed and duplicate baseline entries without suppressing scanner failures', () => {
    expect(() => parseSccComplexityBaseline('{}')).toThrow('baseline version must be 1')
    expect(() =>
      parseSccComplexityBaseline(
        JSON.stringify({
          entries: [{ complexity: -1, file: 'dev/tool.mts', scope: 'tooling' }],
          version: SCC_COMPLEXITY_BASELINE_VERSION,
        }),
      ),
    ).toThrow('baseline entry 0 has an invalid complexity')
    expect(() =>
      parseSccComplexityBaseline(
        JSON.stringify({
          entries: [
            { complexity: 11, file: 'dev/tool.mts', scope: 'tooling' },
            { complexity: 12, file: 'dev/tool.mts', scope: 'tooling' },
          ],
          version: SCC_COMPLEXITY_BASELINE_VERSION,
        }),
      ),
    ).toThrow('baseline entry tooling:dev/tool.mts is duplicated')
  })

  it('reports invalid, stale, and out-of-scope baseline configuration', async () => {
    const ctx = await makeFixture(['dev/tool.mts', 'src/app.mts'])
    await expect(checkSccComplexity(ctx, { scopes: [] })).resolves.toEqual({
      errors: ['::error::scc-complexity failed: scopes must not be empty'],
    })
    const stale = parseSccComplexityBaseline(
      JSON.stringify({
        entries: [{ complexity: 12, file: 'dev/tool.mts', scope: 'tooling' }],
        version: SCC_COMPLEXITY_BASELINE_VERSION,
      }),
    )
    await expect(
      checkSccComplexity(
        ctx,
        { baseline: stale, scopes: [{ includePaths: ['dev'], limit: 10, name: 'tooling' }] },
        () =>
          Promise.resolve(
            JSON.stringify([{ Files: [{ Complexity: 10, Location: 'dev/tool.mts' }] }]),
          ),
      ),
    ).resolves.toEqual({
      errors: ['::error::scc-complexity failed: baseline entry tooling:dev/tool.mts is stale'],
    })
    const misplaced = parseSccComplexityBaseline(
      JSON.stringify({
        entries: [{ complexity: 12, file: 'src/app.mts', scope: 'tooling' }],
        version: SCC_COMPLEXITY_BASELINE_VERSION,
      }),
    )
    await expect(
      checkSccComplexity(
        ctx,
        { baseline: misplaced, scopes: [{ includePaths: ['dev'], limit: 10, name: 'tooling' }] },
        () =>
          Promise.resolve(
            JSON.stringify([{ Files: [{ Complexity: 12, Location: 'src/app.mts' }] }]),
          ),
      ),
    ).resolves.toEqual({
      errors: [
        '::error::scc-complexity failed: baseline entry tooling:src/app.mts is out of scope',
      ],
    })
  })
})
