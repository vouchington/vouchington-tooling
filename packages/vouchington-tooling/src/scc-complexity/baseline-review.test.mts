import { describe, expect, it } from 'vitest'

import type { SharedContext } from '../shared-context/index.mts'
import {
  checkSccComplexity,
  parseSccComplexityBaseline,
  SCC_COMPLEXITY_BASELINE_VERSION,
} from './index.mts'

const ctx: SharedContext = {
  isInsideGitRepo: true,
  repoRoot: process.cwd(),
  trackedFiles: ['src/app.mts', 'src/tool.mts'],
  trackedFileSet: new Set(['src/app.mts', 'src/tool.mts']),
}

describe('scc-complexity baseline normalization', () => {
  it('rejects malformed baseline shapes and missing named-scope configuration', async () => {
    expect(() => parseSccComplexityBaseline('[]')).toThrow('baseline must be an object')
    expect(() =>
      parseSccComplexityBaseline(JSON.stringify({ version: SCC_COMPLEXITY_BASELINE_VERSION })),
    ).toThrow('baseline entries must be an array')
    expect(() =>
      parseSccComplexityBaseline(
        JSON.stringify({ entries: [null], version: SCC_COMPLEXITY_BASELINE_VERSION }),
      ),
    ).toThrow('baseline entry 0 must be an object')
    const baseline = parseSccComplexityBaseline(
      JSON.stringify({
        entries: [{ complexity: 12, file: 'src/app.mts', scope: 'tooling' }],
        version: SCC_COMPLEXITY_BASELINE_VERSION,
      }),
    )

    await expect(checkSccComplexity(ctx, { baseline })).resolves.toEqual({
      errors: ['::error::scc-complexity failed: baseline requires named scopes'],
    })
    await expect(
      checkSccComplexity(ctx, { scopes: [{ includePaths: ['src'], name: '' }] }),
    ).resolves.toEqual({
      errors: ['::error::scc-complexity failed: scope name (empty) is invalid'],
    })
  })

  it('reports unknown baseline scopes and accepts values at a scope limit', async () => {
    const unknownScope = parseSccComplexityBaseline(
      JSON.stringify({
        entries: [{ complexity: 12, file: 'src/app.mts', scope: 'missing' }],
        version: SCC_COMPLEXITY_BASELINE_VERSION,
      }),
    )
    await expect(
      checkSccComplexity(
        ctx,
        { baseline: unknownScope, scopes: [{ includePaths: ['src'], limit: 10, name: 'tooling' }] },
        () =>
          Promise.resolve(
            JSON.stringify([{ Files: [{ Complexity: 12, Location: 'src/app.mts' }] }]),
          ),
      ),
    ).resolves.toEqual({
      errors: [
        '::error::scc-complexity failed: baseline entry missing:src/app.mts is out of scope',
      ],
    })
    await expect(
      checkSccComplexity(
        ctx,
        { scopes: [{ includePaths: ['src'], limit: 10, name: 'tooling' }] },
        () =>
          Promise.resolve(
            JSON.stringify([{ Files: [{ Complexity: 10, Location: 'src/app.mts' }] }]),
          ),
      ),
    ).resolves.toEqual({ errors: [] })
  })

  it('rejects a tracked baseline entry when SCC no longer reports the file', async () => {
    const baseline = parseSccComplexityBaseline(
      JSON.stringify({
        entries: [{ complexity: 12, file: './src/app.mts', scope: 'tooling' }],
        version: SCC_COMPLEXITY_BASELINE_VERSION,
      }),
    )

    await expect(
      checkSccComplexity(
        ctx,
        { baseline, scopes: [{ includePaths: ['.'], limit: 10, name: 'tooling' }] },
        () => Promise.resolve(JSON.stringify([{ Files: [] }])),
      ),
    ).resolves.toEqual({
      errors: ['::error::scc-complexity failed: baseline entry tooling:src/app.mts is stale'],
    })
  })

  it('rejects baseline entries that collide after repository-relative normalization', async () => {
    const baseline = parseSccComplexityBaseline(
      JSON.stringify({
        entries: [
          { complexity: 12, file: './src/tool.mts', scope: 'tooling' },
          { complexity: 12, file: 'src/../src/tool.mts', scope: 'tooling' },
        ],
        version: SCC_COMPLEXITY_BASELINE_VERSION,
      }),
    )

    await expect(
      checkSccComplexity(ctx, {
        baseline,
        scopes: [{ includePaths: ['./src/'], limit: 10, name: 'tooling' }],
      }),
    ).resolves.toEqual({
      errors: ['::error::scc-complexity failed: baseline entry tooling:src/tool.mts is duplicated'],
    })
  })
})
