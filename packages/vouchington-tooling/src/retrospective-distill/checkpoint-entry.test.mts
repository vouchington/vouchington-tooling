import { describe, expect, it } from 'vitest'

import { entryFixture } from './fixtures.test-helpers.mts'
import { isCheckpointEntry } from './checkpoint-entry.mts'

// Hook-written checkpoints are no longer appended, but entries already in the journal keep their
// structural `checkpoint` field until they are archived, so they must still be recognized.
describe('isCheckpointEntry', () => {
  it.each(['compaction', 'command-failure', 'pr-create', 'push'])(
    'recognizes a historic %s checkpoint entry',
    (checkpoint) => {
      expect(isCheckpointEntry(entryFixture({ data: { type: 'journal', checkpoint } }))).toBe(true)
    },
  )

  it.each([
    ['an agent-written entry with no checkpoint field', { type: 'journal' }],
    ['an unknown checkpoint kind', { type: 'journal', checkpoint: 'milestone' }],
    ['a non-string checkpoint value', { type: 'journal', checkpoint: true }],
  ])('does not treat %s as a checkpoint', (_name, data) => {
    expect(isCheckpointEntry(entryFixture({ data }))).toBe(false)
  })
})
