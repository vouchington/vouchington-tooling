import { describe, expect, it } from 'vitest'
import { sourceImportsAndComposesAny } from './composes.mts'
import { sourceImportsAndUsesBoundaryAny } from './composition.mts'
import type { ReaderSourceAnalysisOptions } from './source-options.mts'

const options: ReaderSourceAnalysisOptions = {
  canonicalImports: new Map([
    ['buildFilter', new Set(['@fixture/builders'])],
    ['buildAccess', new Set(['./access.mts'])],
    ['buildPublicFilter', new Set(['@fixture/builders'])],
    ['collectVisibleIds', new Set(['@fixture/boundary'])],
    ['loadDescendants', new Set(['@fixture/descendants'])],
    ['loadVisibleDescendants', new Set(['./visible-ids.mts'])],
  ]),
  sql: {
    templateTag: 'sql',
    appendMethod: 'append',
    placeholderPrefix: 'fixture_',
    executorImports: new Map([
      ['@fixture/database', new Set(['read', 'write', 'query', 'readStream', 'explainAnalyze'])],
    ]),
  },
  ignoredCall: 'ignore',
  candidateIdProperty: 'id',
}
const cases = [
  {
    title: 'rejects implemented readers that stop composing the canonical helper',
    classification: 'direct-sql',
    direct: '// buildFilter()\nexport const bypass = true',
    expected: 'must compose buildFilter, buildAccess',
  },
  {
    title: 'rejects canonical helper calls whose results are never appended to the reader query',
    classification: 'direct-sql',
    direct: `import {
  buildFilter,
} from '@fixture/builders'
import { buildAccess } from './access.mts'
const unused = buildFilter()
query.append(sql\`SELECT * FROM records\`)
void unused
buildAccess()`,
    expected: 'must compose buildFilter, buildAccess',
  },
  {
    title:
      'accepts canonical helper results assigned to a variable then appended to the reader query',
    classification: 'direct-sql',
    direct: `import {
  buildFilter,
} from '@fixture/builders'
import { buildAccess } from './access.mts'
const eligibility = buildFilter()
query.append(eligibility)
query.append(buildAccess())`,
    expected: null,
  },
  {
    title: 'accepts a SQL builder returned for composition by its caller',
    classification: 'direct-sql',
    direct: `import { buildFilter } from '@fixture/builders'
return buildFilter()`,
    expected: null,
  },
  {
    title: 'accepts a conditional SQL builder pushed into a compositional filter collection',
    classification: 'public-sql',
    direct: `import { buildPublicFilter } from '@fixture/builders'
filters.push(isPublic ? buildPublicFilter() : sql\`TRUE\`)
return filters`,
    expected: null,
  },
  {
    title: 'rejects a canonical filter pushed into an unconsumed collection',
    classification: 'public-sql',
    direct: `import { buildPublicFilter } from '@fixture/builders'
const filters = []
filters.push(buildPublicFilter())
const query = sql\`SELECT * FROM records\`
read(query)`,
    expected: 'must compose buildPublicFilter',
  },
  {
    title: 'accepts an awaited authorization boundary without requiring SQL composition',
    classification: 'public-boundary',
    direct:
      "import { collectVisibleIds } from '@fixture/boundary'\nconst ids = await collectVisibleIds()\nreturn ids",
    expected: null,
  },
  {
    title: 'rejects an unused boundary helper decoy',
    classification: 'public-boundary',
    direct: "import { collectVisibleIds } from '@fixture/boundary'\ncollectVisibleIds([])",
    expected: 'must compose collectVisibleIds',
  },
  {
    title: 'rejects a canonical binding that is reassigned before the query appends it',
    classification: 'public-sql',
    direct: `import { buildPublicFilter } from '@fixture/builders'
let eligibility = buildPublicFilter()
eligibility = sql\`TRUE\`
query.append(eligibility)`,
    expected: 'must compose buildPublicFilter',
  },
  {
    title: 'rejects a canonical helper appended only to an unconsumed local SQL statement',
    classification: 'public-sql',
    direct: `import { buildPublicFilter } from '@fixture/builders'
const deadQuery = sql\`SELECT * FROM records\`
deadQuery.append(buildPublicFilter())
const readerQuery = sql\`SELECT * FROM records\`
read(readerQuery)`,
    expected: 'must compose buildPublicFilter',
  },
  {
    title: 'rejects a homonymous helper imported from another module',
    classification: 'direct-sql',
    direct: "import { buildFilter } from '@fixture/unrelated'\nbuildFilter()",
    expected: 'must compose buildFilter, buildAccess',
  },
]

describe('relocated reader source composition', () => {
  it.each(cases)('$title', ({ classification, direct, expected }) => {
    const symbols =
      classification === 'direct-sql'
        ? ['buildFilter', 'buildAccess']
        : classification === 'public-sql'
          ? ['buildPublicFilter']
          : ['collectVisibleIds']
    const analyze = classification.endsWith('-sql')
      ? sourceImportsAndComposesAny
      : sourceImportsAndUsesBoundaryAny
    expect(analyze(direct!, symbols, options)).toBe(expected === null)
  })
})
