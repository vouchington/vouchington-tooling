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
