import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getCallRowTypeFacts } from './type-query-call.mts'
import ts from './typescript-api.mts'

describe('type-query display formatting', () => {
  it('keeps long type displays and requested property displays complete', () => {
    const directory = mkdtempSync(join(tmpdir(), 'type-query-long-display-'))
    try {
      const fileName = join(directory, 'long.ts')
      const fields = Array.from({ length: 1000 }, (_, index) => `field${index}: number`).join('; ')
      writeFileSync(fileName, `declare function read<T>(): T; read<{ value: { ${fields} } }>()`)
      const longProgram = ts.createProgram([fileName], { skipLibCheck: true, strict: true })
      const longFacts = getCallRowTypeFacts({
        typescript: ts,
        program: longProgram,
        fileName,
        calleeText: 'read',
        rowSource: 'typeArgument',
        propertyNames: ['value'],
      })
      expect(longFacts).toHaveLength(1)
      expect(longFacts[0]?.display).not.toContain('...')
      expect(longFacts[0]?.display).toContain('field999: number')
      const property = longFacts[0]?.properties.value
      expect(property).not.toContain('...')
      expect(property).toContain('field999: number')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
