import { describe, expect, it } from 'vitest'

import {
  getGithubActionsStepGroupSlices,
  sliceGithubActionsStepGroup,
  terminalFailedGithubActionsStepLog,
} from './github-actions-log.mts'

const tscRunGroup = '##[group]Run pnpm exec tsc --noEmit --project app/tsconfig.json'
const oxlintRunGroup = '##[group]Run pnpm exec oxlint --type-aware --deny-warnings'

const multiStepLog = [
  '2026-06-01T04:30:00.0000000Z ##[group]Run pnpm exec tsc --noEmit --project app/tsconfig.json',
  'pnpm exec tsc --noEmit --project app/tsconfig.json',
  "backend/src/index.mts(1,1): error TS2307: Cannot find module 'vitest' or its corresponding type declarations.",
  '2026-06-01T04:31:00.0000000Z ##[group]Run pnpm exec oxlint --type-aware --deny-warnings',
  'pnpm exec oxlint --type-aware --deny-warnings',
  '##[error]Process completed with exit code 1.',
].join('\n')

describe('github-actions-log', () => {
  it('slices a step group through the next GitHub Actions step boundary', () => {
    const stepLog = sliceGithubActionsStepGroup(multiStepLog, tscRunGroup)

    expect(stepLog).toContain(tscRunGroup)
    expect(stepLog).toContain("Cannot find module 'vitest'")
    expect(stepLog).not.toContain(oxlintRunGroup)
  })

  it('returns the tail when the requested step is the last group', () => {
    const stepLog = sliceGithubActionsStepGroup(multiStepLog, oxlintRunGroup)

    expect(stepLog).toContain(oxlintRunGroup)
    expect(stepLog).toContain('##[error]Process completed with exit code 1.')
  })

  it('returns an empty string when the requested step group is missing', () => {
    expect(sliceGithubActionsStepGroup(multiStepLog, '##[group]Run missing')).toBe('')
  })

  it('returns all step group slices in order', () => {
    const stepGroups = getGithubActionsStepGroupSlices(multiStepLog)

    expect(stepGroups).toHaveLength(2)
    expect(stepGroups[0]?.header).toBe(tscRunGroup)
    expect(stepGroups[0]?.log).toContain("Cannot find module 'vitest'")
    expect(stepGroups[0]?.log).not.toContain(oxlintRunGroup)
    expect(stepGroups[1]?.header).toBe(oxlintRunGroup)
    expect(stepGroups[1]?.log).toContain('##[error]Process completed with exit code 1.')
  })

  it('returns the last failed step group', () => {
    expect(terminalFailedGithubActionsStepLog(multiStepLog)).toContain(oxlintRunGroup)
    expect(terminalFailedGithubActionsStepLog(multiStepLog)).not.toContain(tscRunGroup)
    expect(terminalFailedGithubActionsStepLog('no groups')).toBe('')
  })

  it('handles a header with no trailing newline and a step that timed out', () => {
    const timedOut = "##[group]Run slow\nThe action 'slow' has timed out"
    expect(getGithubActionsStepGroupSlices('##[group]Run last')[0]?.header).toBe(
      '##[group]Run last',
    )
    expect(terminalFailedGithubActionsStepLog(timedOut)).toBe(timedOut)
    expect(terminalFailedGithubActionsStepLog('##[group]Run fine\nok')).toBe('')
  })
})
