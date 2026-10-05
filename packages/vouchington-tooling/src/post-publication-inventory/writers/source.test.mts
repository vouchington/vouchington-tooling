import { describe, expect, it } from 'vitest'
import { analyzePostPublicationWriterSource } from '../index.mts'

const path = 'fixtures/writer.mts'
const options = {
  captureModules: new Set(['@example/capture', './capture.mts', './delete-relations.mts']),
  captureSymbols: new Set(['captureChange', 'captureDeletion']),
  eligibilityTables: new Set(['articles', 'collections']),
  captureOption: 'trackChanges',
  insertBuilder: 'makeInsert',
  identifierAssertion: 'allowIdentifier',
  entityTable: { receiver: 'settings', property: 'table' },
  relationTable: { receiver: 'edge', property: 'sqlTable' },
  relationElectionAllowlist: 'edgeTables',
  appendMethod: 'add',
}

function analyze(source: string) {
  return analyzePostPublicationWriterSource(source, path, options)
}

describe('post-publication writer inventory source analysis', () => {
  it('ignores unsupported capture imports and unapproved imported names', () => {
    expect(
      analyze(`
      import capture from '@example/capture'
      import * as captureNamespace from '@example/capture'
      import { otherHelper } from '@example/capture'
      capture(); captureNamespace.captureChange(); otherHelper()
    `).callsApprovedCaptureHelper,
    ).toBe(false)
  })

  it('recognizes a quoted capture option and handles argument-free appends', () => {
    expect(analyze("run({ 'trackChanges': false }); query.add()").optsOutOfPublicationCapture).toBe(
      true,
    )
    expect(analyze('query.add()').writesGeneratedRelationTable).toBe(false)
  })

  it('does not treat a later SQL fragment as a dynamic table-name insertion', () => {
    expect(
      analyze("const sql = `prefix ${'articles'} UPDATE other SET value = 1`")
        .writesEligibilityTable,
    ).toBe(false)
  })

  it('collects every positive source fact', () => {
    expect(
      analyze(`
        import { captureChange as capture } from '@example/capture'
        capture(query, change)
        run({ trackChanges: false })
        const table = allowIdentifier(settings.table, entityTables, 'table')
        query.add(sql\`UPDATE \`)
        query.add(edge.sqlTable)
        const electionTable = allowIdentifier(
          target.edgeTable, edgeTables, 'edgeTable',
        )
        query.add(electionTable)
        const update = \`UPDATE \${'articles'} SET title = $1\`
      `),
    ).toEqual({
      callsApprovedCaptureHelper: true,
      optsOutOfPublicationCapture: true,
      writesConfigEntityTable: true,
      writesGeneratedRelationTable: true,
      writesEligibilityTable: true,
    })
  })

  it('does not conflate near-miss source shapes', () => {
    expect(
      analyze(`
        import { captureChange } from '@example/capture'
        const note = 'captureChange(query, change)'
        run({ trackChanges: true })
        const table = allowIdentifier(other.table, entityTables, 'table')
        query.add(sql\`SELECT \`)
        query.add(edge.otherTable)
        const query = \`SELECT \${'articles'} FROM articles\`
      `),
    ).toEqual({
      callsApprovedCaptureHelper: false,
      optsOutOfPublicationCapture: false,
      writesConfigEntityTable: false,
      writesGeneratedRelationTable: false,
      writesEligibilityTable: false,
    })
  })

  it('recognizes static and dynamic eligibility SQL', () => {
    expect(
      analyze('const query = \'UPDATE ONLY public."articles" SET title = $1\'')
        .writesEligibilityTable,
    ).toBe(true)
    expect(analyze("const query = `DELETE FROM ${'collections'}`").writesEligibilityTable).toBe(
      true,
    )
  })

  it('resolves approved capture aliases independently of source order', () => {
    expect(
      analyze(`
        capture(query, change)
        import { captureChange as capture } from '@example/capture'
      `).callsApprovedCaptureHelper,
    ).toBe(true)
  })

  it('recognizes deletion-lifecycle capture owners at their local module boundaries', () => {
    expect(
      analyze(`
        import { captureChange } from './capture.mts'
        captureChange(query, change)
      `).callsApprovedCaptureHelper,
    ).toBe(true)
    expect(
      analyze(`
        import { captureDeletion } from './delete-relations.mts'
        captureDeletion(changes, query)
      `).callsApprovedCaptureHelper,
    ).toBe(true)
    expect(
      analyze(`
        import { captureDeletion } from './unrelated.mts'
        captureDeletion(changes, query)
      `).callsApprovedCaptureHelper,
    ).toBe(false)
  })

  it('recognizes both generated-relation writer forms', () => {
    expect(
      analyze('const query = makeInsert(relation, creator, pairs)').writesGeneratedRelationTable,
    ).toBe(true)
    expect(
      analyze(`
        const table = allowIdentifier(target.edgeTable, edgeTables)
        query.add(sql\`UPDATE \`)
        query.add(table)
      `).writesGeneratedRelationTable,
    ).toBe(true)
    expect(
      analyze(`
        query.add(sql\`UPDATE \`)
        query.add(table)
        const table = allowIdentifier(target.edgeTable, edgeTables)
      `).writesGeneratedRelationTable,
    ).toBe(false)
  })

  it('returns safe empty facts for empty and malformed source', () => {
    expect(analyze('')).toEqual({
      callsApprovedCaptureHelper: false,
      optsOutOfPublicationCapture: false,
      writesConfigEntityTable: false,
      writesGeneratedRelationTable: false,
      writesEligibilityTable: false,
    })
    expect(analyze('const =')).toEqual({
      callsApprovedCaptureHelper: false,
      optsOutOfPublicationCapture: false,
      writesConfigEntityTable: false,
      writesGeneratedRelationTable: false,
      writesEligibilityTable: false,
    })
  })
})
