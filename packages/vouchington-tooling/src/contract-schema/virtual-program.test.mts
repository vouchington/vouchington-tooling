import { beforeAll, describe, expect, it } from 'vitest'

import { buildVirtualProgramMatrix, virtualProgramBuildCountForTest } from './virtual-program.mts'

function ownerExecution(caseName: string): ImportMeta {
  return { url: new URL(`#${caseName}`, import.meta.url).href } as ImportMeta
}

describe('virtual TypeScript program matrix', () => {
  it('builds one program for independent named sources', () => {
    const buildsBefore = virtualProgramBuildCountForTest()
    const matrix = buildVirtualProgramMatrix(ownerExecution('independent-sources'), {
      alpha: 'interface Result { alpha: string }',
      beta: 'interface Result { beta: number }',
    })

    expect(virtualProgramBuildCountForTest()).toBe(buildsBefore + 1)
    expect(matrix.sourceFile('alpha').fileName).toBe('/virtual/alpha.ts')
    expect(matrix.sourceFile('beta').fileName).toBe('/virtual/beta.ts')
    expect(matrix.program.getSourceFiles()).toEqual(
      expect.arrayContaining([matrix.sourceFile('alpha'), matrix.sourceFile('beta')]),
    )
  })

  it('reports diagnostics only when the owning source is requested', () => {
    const matrix = buildVirtualProgramMatrix(ownerExecution('source-diagnostics'), {
      valid: 'interface Result { value: string }',
      invalid: 'const value: string = 1',
    })

    expect(matrix.sourceFile('valid').fileName).toBe('/virtual/valid.ts')
    expect(() => matrix.sourceFile('invalid')).toThrow('virtual/invalid.ts')
  })

  it('rejects unknown virtual source IDs', () => {
    const matrix = buildVirtualProgramMatrix(ownerExecution('unknown-source-id'), {
      alpha: 'export interface Alpha {}',
    })
    expect(() => matrix.sourceFile('beta' as 'alpha')).toThrow('Unknown virtual source ID')
  })

  it('rejects matrix IDs that cannot form stable virtual filenames', () => {
    expect(() =>
      buildVirtualProgramMatrix(ownerExecution('invalid-source-id'), {
        '../escape': 'export {}',
      }),
    ).toThrow('Virtual source ID')
  })

  it('rejects empty matrices and non-file owner URLs', () => {
    expect(() => buildVirtualProgramMatrix(ownerExecution('empty-matrix'), {})).toThrow(
      'at least one source',
    )
    expect(() =>
      buildVirtualProgramMatrix({ url: 'https://example.test/owner' } as ImportMeta, {
        one: 'export {}',
      }),
    ).toThrow('must be a file URL')
  })

  describe('one build per consumer test file', () => {
    let firstMatrix: ReturnType<typeof buildVirtualProgramMatrix>
    let duplicateBuildError: unknown

    beforeAll(() => {
      const owner = ownerExecution('duplicate-build')
      firstMatrix = buildVirtualProgramMatrix(owner, { first: 'export interface First {}' })
      try {
        buildVirtualProgramMatrix(owner, { second: 'export interface Second {}' })
      } catch (error) {
        duplicateBuildError = error
      }
    })

    it('allows one matrix build for the owning test file', () => {
      expect(firstMatrix.sourceFile('first').fileName).toBe('/virtual/first.ts')
    })

    it('rejects a second matrix build for the same owning test file', () => {
      expect(duplicateBuildError).toEqual(
        new Error(
          `Virtual program matrix for "${ownerExecution('duplicate-build').url}" was already built; each contract test file execution may build exactly one`,
        ),
      )
    })
  })

  it('does not couple distinct owner test cases', () => {
    expect(
      buildVirtualProgramMatrix(ownerExecution('owner-case-a'), {
        one: 'export interface One {}',
      }).sourceFile('one').fileName,
    ).toBe('/virtual/one.ts')
    expect(
      buildVirtualProgramMatrix(ownerExecution('owner-case-b'), {
        two: 'export interface Two {}',
      }).sourceFile('two').fileName,
    ).toBe('/virtual/two.ts')
  })

  it('allows the same owner URL when a watch rerun creates a new module execution', () => {
    const firstExecution = ownerExecution('watch-rerun')
    const rerunExecution = ownerExecution('watch-rerun')

    buildVirtualProgramMatrix(firstExecution, { first: 'export interface FirstExecution {}' })

    expect(() =>
      buildVirtualProgramMatrix(firstExecution, {
        duplicate: 'export interface DuplicateExecution {}',
      }),
    ).toThrow('each contract test file execution may build exactly one')
    expect(
      buildVirtualProgramMatrix(rerunExecution, {
        rerun: 'export interface WatchRerunExecution {}',
      }).sourceFile('rerun').fileName,
    ).toBe('/virtual/rerun.ts')
  })
})
