import { expect, it } from 'vitest'
import { collectActivePatternCaptures } from './pattern-captures.mts'

it('requires a capture from a caller pattern', () => {
  expect(
    collectActivePatternCaptures("path: '/entry'", /path:\s*'(?:missing)?'|path:\s*'([^']+)'/g),
  ).toEqual(['/entry'])
  expect(collectActivePatternCaptures("path: '/entry'", /path:\s*'([^']+)'?/g)).toEqual(['/entry'])
  expect(collectActivePatternCaptures("path: '/entry'", /path:\s*'(optional)?/g)).toEqual([])
})
