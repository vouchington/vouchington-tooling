import { describe, expect, it } from 'vitest'

import { parseMarkdownSections, validateMarkdownSections } from './index.mts'

describe('PR-description scenarios through the public Markdown API', () => {
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
