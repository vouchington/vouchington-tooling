import { describe, expect, it, vi } from 'vitest'
import type { TypeScriptModuleFacts } from 'no-mistakes'

vi.mock('no-mistakes', () => ({ analyzeTypeScriptModules: vi.fn() }))

import { analyzeTypeScriptModules } from 'no-mistakes'
import { analyzeStorySources } from './analyze.mts'
import { storyCoverageConfig } from './options.mts'

const analyze = vi.mocked(analyzeTypeScriptModules)

function config() {
  return storyCoverageConfig({
    root: '/repo',
    componentRoot: 'ui/components',
    storyRoot: 'ui/stories',
    sourceExtensions: ['.tsx'],
    componentExtensions: ['.tsx'],
    marker: /marker/,
    storyFilePattern: /\.stories\.tsx$/,
  })
}

function moduleFacts(fileName: string, complete: boolean): TypeScriptModuleFacts {
  return {
    fileName,
    complete,
    imports: [],
    exports: [],
    bindings: [],
    scopes: [],
    loads: [],
    diagnostics: [],
  }
}

describe('analyzeStorySources', () => {
  it('rejects a short module report', async () => {
    analyze.mockResolvedValue({ modules: [] })
    await expect(analyzeStorySources(['ui/components/missing.tsx'], config())).rejects.toThrow(
      'Incomplete story source inventory',
    )
  })

  it('rejects a report that names a different file', async () => {
    analyze.mockResolvedValue({ modules: [moduleFacts('/repo/other.tsx', true)] })
    await expect(analyzeStorySources(['ui/components/missing.tsx'], config())).rejects.toThrow(
      'Incomplete story source inventory',
    )
  })

  it('rejects incomplete module facts', async () => {
    analyze.mockResolvedValue({
      modules: [moduleFacts('/repo/ui/components/missing.tsx', false)],
    })
    await expect(analyzeStorySources(['ui/components/missing.tsx'], config())).rejects.toThrow(
      'Incomplete source module facts: ui/components/missing.tsx',
    )
  })
})
