import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../.github/workflows/ci.yml'),
  'utf8',
)

describe('CI pull request events', () => {
  it('keeps the existing check runs when a draft pull request is marked ready', () => {
    expect(workflow).toContain('pull_request:\n    types: [opened, synchronize, reopened]\n')
    expect(workflow).not.toContain('ready_for_review')
    expect(workflow).not.toContain('converted_to_draft')
  })
})
