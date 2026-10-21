import { describe, expect, it } from 'vitest'
import {
  formatExclusionsMessage,
  formatMissingComponentsMessage,
  formatNamespaceImportsMessage,
} from './messages.mts'
import { storyCoverageConfig } from './options.mts'

const config = storyCoverageConfig({
  root: 'repo',
  componentRoot: 'ui/components',
  storyRoot: 'ui/stories',
  sourceExtensions: ['.ts'],
  componentExtensions: ['.tsx'],
  marker: /marker/,
  storyFilePattern: /\.stories\.tsx$/,
  exclusionsLabel: 'coverage-exclusions.json',
})

describe('story coverage messages', () => {
  it('formats missing components with the caller label and story root', () => {
    expect(formatMissingComponentsMessage([], config)).toBe('')
    const message = formatMissingComponentsMessage(
      [
        { component: 'Alpha', exportName: 'Alpha', file: 'ui/components/alpha.tsx' },
        { component: 'Layout', exportName: 'default', file: 'ui/components/layout.tsx' },
      ],
      config,
    )
    expect(message).toContain('coverage-exclusions.json')
    expect(message).toContain('ui/stories/')
    expect(message).toContain('add a story')
    expect(message).toContain('imports and uses the component at runtime')
    expect(message).not.toContain('path alias')
    expect(message).toContain("'default'")
    expect(message).toContain('ui/components/alpha.tsx#Alpha')
    expect(message).toContain('ui/components/layout.tsx#default')
    expect(message).toContain('zero-exclusion ratchet')
    expect(message).not.toContain('Example exclusion')
  })

  it('formats namespace imports and exclusion keys', () => {
    expect(formatNamespaceImportsMessage([], config)).toBe('')
    expect(formatExclusionsMessage([])).toBe('')
    const names = formatNamespaceImportsMessage(
      [{ file: 'ui/stories/buttons.stories.tsx', source: '@/components/button', local: 'Buttons' }],
      config,
    )
    expect(names).toContain('ui/components/')
    expect(names).toContain('ui/stories/buttons.stories.tsx')
    expect(names).toContain('* as Buttons')
    expect(names).toContain('@/components/button')
    expect(names).toContain('named imports')
    const excluded = formatExclusionsMessage(['ui/components/alpha.tsx#Alpha'])
    expect(excluded).toContain('ui/components/alpha.tsx#Alpha')
    expect(excluded).toContain('zero-exclusion ratchet')
  })
})
