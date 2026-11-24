import { describe, expect, it } from 'vitest'
import { TOOLS } from './tools.mts'

const EXPECTED = [
  'journal_append',
  'journal_entries',
  'outbox_status',
  'outbox_flush',
  'outbox_prune_rejected',
  'session_ensure',
  'retrospective_check',
  'retrospective_save',
  'pr_validate',
  'pr_create',
  'pr_update',
  'snapshot_export',
  'snapshot_partition',
  'snapshot_archive',
  'snapshot_cleanup',
  'session_archive',
]

const byName = (name: string) => {
  const found = TOOLS.find((tool) => tool.name === name)
  if (!found) throw new Error(`missing tool ${name}`)
  return found
}

describe('tool contract', () => {
  it('lists exactly the journal and retrospective tools', () => {
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
    expect(Object.keys(properties)).toContain('category')
  })

  it('keeps the entry timestamp server-owned and documents how a retry works', () => {
    const { properties } = byName('journal_append').inputSchema
    expect(Object.keys(properties)).not.toContain('timestamp')
    const { description } = byName('journal_append')
    expect(description).toContain('The server owns the entry timestamp and returns it')
    expect(description).toContain('repeat the identical call')
  })

  it('names the session count and the worktree count apart on every outbox result', () => {
    for (const name of ['journal_append', 'outbox_status', 'outbox_flush']) {
      const { description } = byName(name)
      expect(description, name).toContain('pendingCount')
      expect(description, name).toContain('worktreePendingCount')
    }
  })

  it('marks reads read-only and pr_update, cleanup and archive as destructive', () => {
    const readOnly = TOOLS.filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name)
    expect(readOnly).toEqual([
      'journal_entries',
      'outbox_status',
      'retrospective_check',
      'pr_validate',
    ])
    const destructive = TOOLS.filter((tool) => tool.annotations.destructiveHint)
    expect(destructive.map((tool) => tool.name)).toEqual([
      'outbox_prune_rejected',
      'pr_update',
      'snapshot_archive',
      'snapshot_cleanup',
      'session_archive',
    ])
    // Only the pull request tools reach outside the server, to GitHub.
    const openWorld = TOOLS.filter((tool) => tool.annotations.openWorldHint)
    expect(openWorld.map((tool) => tool.name)).toEqual(['pr_validate', 'pr_create', 'pr_update'])
  })

  // Clients that check schemas with RE2 (Go) reject lookaround and backreferences, and
  // then refuse the whole server. Advertised patterns stay in the RE2-compatible subset.
  it('advertises only RE2-compatible patterns', () => {
    const patterns: string[] = []
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk)
      if (value === null || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        if (key === 'pattern' && typeof child === 'string') patterns.push(child)
        else walk(child)
      }
    }
    TOOLS.forEach((tool) => walk(tool.inputSchema))
    expect(patterns.length).toBeGreaterThan(0)
    for (const pattern of patterns) {
      expect(pattern).not.toMatch(/\(\?<?[=!]|\\[1-9]|\\k</u)
      expect(() => new RegExp(pattern, 'u')).not.toThrow()
    }
  })

  it('advertises a repository pattern that agrees with the parser on owner names', () => {
    const repository = (
      byName('pr_create').inputSchema.properties.relatedIssues as {
        items: { properties: { repository: { pattern: string } } }
      }
    ).items.properties.repository
    const advertised = new RegExp(repository.pattern, 'u')
    for (const valid of ['octo/repo', 'a/b', 'a-b/c.d', `${'a'.repeat(39)}/r`])
      expect(advertised.test(valid), valid).toBe(true)
    for (const invalid of ['-a/b', 'a-/b', `${'a'.repeat(40)}/r`, 'a/b/c', 'a b/c'])
      expect(advertised.test(invalid), invalid).toBe(false)
  })
})
