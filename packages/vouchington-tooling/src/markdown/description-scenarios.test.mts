import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  findMarkdownNodes,
  parseGfmMarkdown,
  parseMarkdownSections,
  validateMarkdownSections,
} from './index.mts'

describe('PR-description examples through the public Markdown API', () => {
  it('accepts the published behavior, schema, workflow, and harness-gap scenarios', async () => {
    const examples = await readFile(
      new URL(
        '../../../../plugins/vouchington-workflow/skills/pr-description/references/examples.md',
        import.meta.url,
      ),
      'utf8',
    )
    const descriptions = findMarkdownNodes(
      parseGfmMarkdown(examples),
      (node) => node.type === 'code',
    )
      .filter((node) => node.type === 'code' && node.lang === 'markdown')
      .map((node) => {
        if (node.type !== 'code') throw new Error('Expected a Markdown description example')
        return parseMarkdownSections(node.value)
      })
    expect(
      descriptions.some((document) =>
        document.sections.some((section) => section.heading === 'Summary'),
      ),
    ).toBe(true)
    expect(
      descriptions.some((document) =>
        document.sections.some((section) => section.heading === 'Harness gaps'),
      ),
    ).toBe(true)
    for (const document of descriptions) {
      const requiredHeadings =
        document.sections[0]?.heading === 'Harness gaps' ? ['Harness gaps'] : ['Summary', 'Impact']
      expect(validateMarkdownSections(document, { requiredHeadings })).toEqual([])
    }
  })

  it('rejects a workflow diagram used as the entire visible explanation', () => {
    const body =
      '## Summary\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n## Impact\n\nContributors retain their existing checks.'
    expect(
      validateMarkdownSections(parseMarkdownSections(body), {
        requiredHeadings: ['Summary', 'Impact'],
      }),
    ).toEqual([expect.objectContaining({ code: 'empty-section', heading: 'Summary' })])
  })

  it('requires an audience conclusion before a collapsed schema inventory', () => {
    const body =
      '## Summary\n\nRecovery attempts now reference retained identities.\n\n## Impact\n\n<details>\n<summary>Schema inventory</summary>\n\n| Object | Change |\n| --- | --- |\n| identity_id | Foreign key added |\n\n</details>'
    expect(
      validateMarkdownSections(parseMarkdownSections(body), {
        requiredHeadings: ['Summary', 'Impact'],
      }),
    ).toEqual([expect.objectContaining({ code: 'empty-section', heading: 'Impact' })])
  })
})
