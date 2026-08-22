import { describe, expect, it } from 'vitest'
import {
  CURSOR_OPTIONS,
  lintCursor,
  messageIds,
} from './postgres-cursor-call-contract.test-helpers.mts'

const invalid: Array<{ file: string; code: string; messageId: string }> = [
  {
    file: 'src/raw-string.js',
    code: `import { runCursor } from '@db/cursors'\nrunCursor('SELECT 1')`,
    messageId: 'annotation',
  },
  {
    file: 'src/renamed-subpath.js',
    code: `import { runCursor as cursor } from '@db/cursors/batches'
import sql from 'sql-template-strings'
cursor(sql\`SELECT 1\`)`,
    messageId: 'annotation',
  },
  {
    file: 'src/namespace.js',
    code: `import * as db from '@db/cursors'
db.runCursorBatches(\`SELECT 1\`, { handler: async () => {} })`,
    messageId: 'annotation',
  },
  {
    file: 'src/const-binding.js',
    code: `import { runCursor } from '@db/cursors'
const statement = \`SELECT 1\`
runCursor(statement)`,
    messageId: 'annotation',
  },
  {
    file: 'src/unresolved.js',
    code: `import { runCursor } from '@db/cursors'
export function rows(statement) { return runCursor(statement) }`,
    messageId: 'staticQuery',
  },
  {
    file: 'src/alias.js',
    code: `import { runCursor } from '@db/cursors'
const cursor = runCursor
cursor('/* rows */ SELECT 1')`,
    messageId: 'directUse',
  },
  {
    file: 'src/container.js',
    code: `import { runCursor } from '@db/cursors'
const dependencies = { runCursor }
dependencies.runCursor('/* rows */ SELECT 1')`,
    messageId: 'directUse',
  },
  {
    file: 'src/namespace-alias.js',
    code: `import * as db from '@db/cursors'
const database = db
database.runCursor('SELECT 1')`,
    messageId: 'directUse',
  },
  {
    file: 'src/call.js',
    code: `import { runCursor } from '@db/cursors'
runCursor.call(null, '/* rows */ SELECT 1')`,
    messageId: 'directUse',
  },
  {
    file: 'src/empty-label.js',
    code: `import { runCursor } from '@db/cursors'
runCursor('/*  */ SELECT 1')`,
    messageId: 'annotation',
  },
  {
    file: 'src/interpolated-label.js',
    code: `import { runCursor } from '@db/cursors'
runCursor(\`/* rows\${kind} */ SELECT 1\`)`,
    messageId: 'annotation',
  },
  {
    file: 'src/mutable-statement.js',
    code: `import { runCursor } from '@db/cursors'
let statement = '/* rows */ SELECT 1'
statement = getStatement()
runCursor(statement)`,
    messageId: 'staticQuery',
  },
  {
    file: 'src/mutable-sql-statement.js',
    code: `import { runCursor } from '@db/cursors'
import sql from 'sql-template-strings'
const statement = sql\`/* rows */ SELECT 1\`
statement.text = 'SELECT 1'
runCursor(statement)`,
    messageId: 'staticQuery',
  },
  {
    file: 'src/aliased-mutable-sql-statement.js',
    code: `import { runCursor } from '@db/cursors'
import sql from 'sql-template-strings'
const statement = sql\`/* rows */ SELECT 1\`
const alias = statement
alias.text = 'SELECT 1'
runCursor(statement)`,
    messageId: 'staticQuery',
  },
  {
    file: 'src/aliased-appended-sql-statement.js',
    code: `import { runCursor } from '@db/cursors'; import sql from 'sql-template-strings'
const statement = sql\`/* rows */ SELECT 1\`; const alias = statement.append('')
alias.text = 'SELECT 1'
runCursor(statement)`,
    messageId: 'staticQuery',
  },
  {
    file: 'src/computed-namespace-member.js',
    code: `import * as db from '@db/cursors'
const method = 'runCursor'
db[method]('SELECT 1')`,
    messageId: 'staticNamespaceMember',
  },
  {
    file: 'src/invalid-cooked-template.js',
    code: `import { runCursor } from '@db/cursors'
import sql from 'sql-template-strings'
runCursor(sql\`/* rows */ SELECT '\\8'\`)`,
    messageId: 'staticQuery',
  },
  {
    file: 'src/reexport.js',
    code: `export { runCursor as cursor } from '@db/cursors'`,
    messageId: 'directUse',
  },
  {
    file: 'src/reexport-all.js',
    code: `export * from '@db/cursors/batches'`,
    messageId: 'directUse',
  },
  {
    file: 'src/namespace-member.js',
    code: `import * as db from '@db/cursors'
const fn = db.runCursor`,
    messageId: 'directUse',
  },
  {
    file: 'src/local-reexport.js',
    code: `import { runCursor } from '@db/cursors'
export { runCursor }`,
    messageId: 'directUse',
  },
]

const valid: Array<{ file: string; code: string }> = [
  {
    file: 'src/annotated.js',
    code: `import { runCursor } from '@db/cursors'
runCursor('  /* rows */ SELECT 1')
runCursor(\`/* rows */ SELECT \${id}\`)`,
  },
  {
    file: 'src/sql-tag.js',
    code: `import { runCursorBatches as execute } from '@db/cursors/batches'
import statement from 'sql-template-strings'
const query = statement\`/* rows */ SELECT \${id}\`
execute(query, { handler: async () => {} })`,
  },
  {
    file: 'src/appended-sql-tag.js',
    code: `import { runCursor } from '@db/cursors'; import sql from 'sql-template-strings'
const query = sql\`/* rows */ SELECT id FROM posts\`
query.append(sql\` WHERE owner_id = \${ownerId}\`)
runCursor(query)`,
  },
  {
    file: 'src/chained-append.js',
    code: `import { runCursor } from '@db/cursors'; import sql from 'sql-template-strings'
const query = sql\`/* rows */ SELECT id FROM posts\`
query.append(sql\` WHERE owner_id = \${ownerId}\`).append(sql\` LIMIT 1\`)
runCursor(query)`,
  },
  {
    file: 'src/namespace-const-binding.js',
    code: `import * as db from '@db/cursors'
const statement = '/* rows */ SELECT 1'
db.runCursor(statement)`,
  },
  {
    file: 'src/namespace-annotated.js',
    code: `import * as db from '@db/cursors'
db.runCursor('/* rows */ SELECT 1')`,
  },
  {
    file: 'src/namespace-computed-literal.js',
    code: `import * as db from '@db/cursors'
db['runCursor']('/* rows */ SELECT 1')`,
  },
  {
    file: 'src/reused-const-binding.js',
    code: `import { runCursor } from '@db/cursors'
const statement = '/* rows */ SELECT 1'
runCursor(statement)
runCursor(statement)`,
  },
  {
    file: 'src/lookalike.js',
    code: `function runCursor(statement) { return statement }
runCursor('SELECT 1')`,
  },
  {
    file: 'src/unrelated-tag.js',
    code: `import { runCursor } from 'other'
runCursor(sql\`SELECT 1\`)`,
  },
  {
    file: 'src/namespace-other-member.js',
    code: `import * as db from '@db/cursors'
db.other('SELECT 1')`,
  },
  {
    file: 'src/reexport-other.js',
    code: `export { helper } from '@db/cursors'\nexport { runCursor } from 'other'`,
  },
]

describe('postgres-cursor-call-contract', () => {
  it.each(invalid)('reports $messageId for $file', async ({ file, code, messageId }) => {
    const result = await lintCursor(code, file)
    expect(messageIds(result)).toContain(messageId)
    expect(result.errorCount).toBeGreaterThan(0)
  })

  it.each(valid)('accepts $file', async ({ file, code }) => {
    const result = await lintCursor(code, file)
    expect(result.messages).toEqual([])
  })

  it('reports staticQuery when the cursor call has no SQL argument', async () => {
    const result = await lintCursor(
      `import { runCursor } from '@db/cursors'\nrunCursor()`,
      'src/missing-call-argument.js',
    )
    expect(messageIds(result)).toEqual(['staticQuery'])
  })

  it('skips excluded test files and still lints includeFiles', async () => {
    const options = {
      ...CURSOR_OPTIONS,
      exclude: ['**/*.test.js', '**/test-helpers/**'],
      includeFiles: ['lib/test-helpers/seed.js'],
    }
    const skipped = await lintCursor(
      `import { runCursor } from '@db/cursors'\nrunCursor('SELECT 1')`,
      'src/service.test.js',
      options,
    )
    expect(skipped.messages).toEqual([])
    const allowed = await lintCursor(
      `import { runCursor } from '@db/cursors'\nrunCursor('SELECT 1')`,
      'lib/test-helpers/seed.js',
      options,
    )
    expect(messageIds(allowed)).toEqual(['annotation'])
  })

  it('reports nothing when modules or executors are missing', async () => {
    const code = `import { runCursor } from '@db/cursors'\nrunCursor('SELECT 1')`
    expect((await lintCursor(code, 'src/a.js', null)).messages).toEqual([])
    expect(
      (await lintCursor(code, 'src/a.js', { modules: [], executors: ['runCursor'] })).messages,
    ).toEqual([])
    expect((await lintCursor(code, 'src/a.js', { modules: ['@db/cursors'] })).messages).toEqual([])
  })

  it('honors a custom annotation and ignores files outside include', async () => {
    const annotated = await lintCursor(
      `import { runCursor } from '@db/cursors'\nrunCursor('-- name SELECT 1')`,
      'src/custom.js',
      { ...CURSOR_OPTIONS, annotation: '^--' },
    )
    expect(annotated.messages).toEqual([])
    const skipped = await lintCursor(
      `import { runCursor } from '@db/cursors'\nrunCursor('SELECT 1')`,
      'src/service.js',
      { ...CURSOR_OPTIONS, include: ['**/*.mjs'] },
    )
    expect(skipped.messages).toEqual([])
  })
})
