import { describe, expect, it } from 'vitest'

import { parsePnpmLockfileGraph, parsePnpmLockfileGraphDocument } from './pnpm-lockfile.mts'
import { PNPM_ENV_DOCUMENT, twoDocumentLockfile } from './pnpm-lockfile.test-helpers.mts'

const GRAPH = "lockfileVersion: '9.0'\nimporters:\n  .: {}\npackages:\n  left-pad@1.3.0: {}\n"

describe('parsePnpmLockfileGraph', () => {
  it('returns the only document of a single-document lockfile', () => {
    expect(parsePnpmLockfileGraph(GRAPH)).toEqual({
      importers: { '.': {} },
      lockfileVersion: '9.0',
      packages: { 'left-pad@1.3.0': {} },
    })
  })

  it('returns the graph document after the pnpm 12 env document', () => {
    expect(parsePnpmLockfileGraph(twoDocumentLockfile(GRAPH))).toEqual({
      importers: { '.': {} },
      lockfileVersion: '9.0',
      packages: { 'left-pad@1.3.0': {} },
    })
  })

  it('returns null for an empty lockfile', () => {
    expect(parsePnpmLockfileGraph('')).toBeNull()
  })

  it.each([
    ['the graph document', twoDocumentLockfile('packages: [\n')],
    ['the env document', `packages: [\n---\n${GRAPH}`],
  ])('throws when %s is malformed', (_label, source) => {
    expect(() => parsePnpmLockfileGraph(source)).toThrow()
  })

  it('rejects a lockfile with more than two documents', () => {
    expect(() => parsePnpmLockfileGraph(`${PNPM_ENV_DOCUMENT}---\n${GRAPH}---\n${GRAPH}`)).toThrow(
      'expected a pnpm lockfile to contain at most 2 YAML documents, found 3',
    )
  })
})

describe('parsePnpmLockfileGraphDocument', () => {
  it('starts the graph of a single-document lockfile at the beginning of the source', () => {
    expect(parsePnpmLockfileGraphDocument(GRAPH)?.start).toBe(0)
  })

  it('starts the graph at the document marker after the pnpm 12 env document', () => {
    const source = twoDocumentLockfile(GRAPH)
    const graph = parsePnpmLockfileGraphDocument(source)
    expect(graph?.start).toBe(PNPM_ENV_DOCUMENT.length)
    expect(source.slice(graph?.start)).toBe(`---\n${GRAPH}`)
  })

  it('returns undefined for an empty lockfile', () => {
    expect(parsePnpmLockfileGraphDocument('')).toBeUndefined()
  })
})
