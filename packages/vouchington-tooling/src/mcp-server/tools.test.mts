import { describe, expect, it } from 'vitest'
import { TOOLS } from './tools.mts'

const EXPECTED = [
  'journal_append',
  'journal_entries',
  'outbox_status',
  'outbox_flush',
  'session_ensure',
  'snapshot_export',
  'session_archive',
]

const byName = (name: string) => {
  const found = TOOLS.find((tool) => tool.name === name)
  if (!found) throw new Error(`missing tool ${name}`)
  return found
}

describe('tool contract', () => {
  it('lists exactly the Phase 1 tools', () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual(EXPECTED)
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length)
  })

  it('has no entry_append or friction tool and no caller-chosen destination argument', () => {
    for (const tool of TOOLS) {
      expect(tool.name).not.toMatch(/entry_append|friction/)
      for (const forbidden of ['path', 'file', 'markdownFile', 'outboxDirectory', 'directory'])
        expect(Object.keys(tool.inputSchema.properties)).not.toContain(forbidden)
    }
  })

  it('makes every tool take an explicit sessionId and an optional worktree', () => {
    for (const tool of TOOLS) {
      const { inputSchema } = tool
      expect(inputSchema.type).toBe('object')
      expect(inputSchema.additionalProperties).toBe(false)
      expect(inputSchema.properties).toHaveProperty('sessionId')
      expect(inputSchema.properties).toHaveProperty('worktree')
      expect(inputSchema.required).toContain('sessionId')
      expect(inputSchema.required).not.toContain('worktree')
      for (const name of inputSchema.required) expect(inputSchema.properties).toHaveProperty(name)
      expect(tool.description.length).toBeGreaterThan(20)
    }
  })

  it('requires the whole feedback envelope for journal_append', () => {
    const { properties, required } = byName('journal_append').inputSchema
    expect(required.toSorted()).toEqual(
      [
        'agent',
        'feedbackCoverage',
        'markdown',
        'mode',
        'parentSessionId',
        'repositories',
        'sessionId',
        'sourceEventId',
        'version',
        'workOutcome',
      ].toSorted(),
    )
    expect(Object.keys(properties)).toEqual(expect.arrayContaining(['timestamp', 'category']))
  })

  it('marks reads read-only and archive as the only destructive tool', () => {
    const readOnly = TOOLS.filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name)
    expect(readOnly).toEqual(['journal_entries', 'outbox_status'])
    const destructive = TOOLS.filter((tool) => tool.annotations.destructiveHint)
    expect(destructive.map((tool) => tool.name)).toEqual(['session_archive'])
    for (const tool of TOOLS) expect(tool.annotations.openWorldHint).toBe(false)
  })
})
