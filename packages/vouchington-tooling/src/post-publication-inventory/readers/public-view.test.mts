import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { initSqlAst } from '../../sql-ast/parser.mts'
import { composesPublicEligibilityView } from './public-view.mts'
import type { ReaderPublicViewOptions } from './public-view-options.mts'

const options: ReaderPublicViewOptions = {
  sql: {
    templateTag: 'sql',
    appendMethod: 'append',
    placeholderPrefix: 'fixture_',
    executorImports: new Map([['@fixture/database', new Set(['read'])]]),
  },
  sourceRelation: 'entries',
  eligibilityRelation: 'eligible_entries',
  sourceIdColumn: 'id',
  eligibilityIdColumn: 'entry_id',
}
const cases = JSON.parse(
  readFileSync(new URL('./fixtures/public-view-cases.json', import.meta.url), 'utf8'),
) as { name: string; source: string; expected: boolean }[]

describe('relocated SQL public-view composition', () => {
  beforeAll(() => initSqlAst())
  it.each(cases)('$name', ({ source, expected }) => {
    expect(composesPublicEligibilityView(source, options)).toBe(expected)
  })
})
