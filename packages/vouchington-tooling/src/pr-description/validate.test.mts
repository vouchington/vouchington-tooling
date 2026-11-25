import { describe, expect, it } from 'vitest'

import { GITHUB_BODY_MAX_CHARACTERS } from '../gh-cli/index.mts'
import {
  formatGitHubBodyLengthError,
  hasRelatedIssuesNoSourcePair,
  validatePrBody,
  validatePrBodyWithIssueReferences,
  type PrBodyValidationPolicy,
  type PullRequestIdentity,
  type ReferencedIssue,
} from './index.mts'

const VALID_BODY = [
  '## Summary',
  '',
  'Add policy-driven PR body validation.',
  '',
  '## Impact',
  '',
  'Dev tooling only; no runtime changes.',
  '',
  '## Related issues',
  '',
  '- Closes #42 — main issue',
  '',
  'Workspace setup: pnpm install',
  'Agent: codex',
  'Device: dev@host',
  'Worktree: main',
].join('\n')

const PARTIAL_TEMPLATE = {
  marker: '<!-- related-issues-validation: partial-batch -->',
  visibleLine: 'Partial batch; source issue remains open for remaining work.',
}

const DIRECT_TEMPLATE = {
  marker: '<!-- related-issues-validation: no-source-direct-request -->',
  visibleLine: 'No source issue; direct user request.',
}

const SCHEDULED_TEMPLATE = {
  marker: '<!-- related-issues-validation: no-source-scheduled-prompt -->',
  requiredBodyLines: new Set(['Workspace setup: Scheduled job']),
  visibleLine: 'No source issue; scheduled prompt run.',
}

const TEST_POLICY: PrBodyValidationPolicy = {
  noSourceRules: [
    {
      interactiveOnly: true,
      matches: (body) => hasRelatedIssuesNoSourcePair(body, DIRECT_TEMPLATE),
      nonInteractiveError: 'Direct user request requires interactive mode.',
    },
    {
      matches: (body) => hasRelatedIssuesNoSourcePair(body, SCHEDULED_TEMPLATE),
    },
  ],
  partialBatch: PARTIAL_TEMPLATE,
}

function makeIssue(overrides: Partial<ReferencedIssue> = {}): ReferencedIssue {
  return {
    body: '',
    isPullRequest: false,
    milestone: undefined,
    number: 42,
    state: 'open',
    title: 'Main issue',
    url: 'https://github.com/acme/repo/issues/42',
    ...overrides,
  }
}

describe('validatePrBody', () => {
  it('accepts a valid PR body with default policy and rejects oversized bodies', () => {
    expect(validatePrBody(VALID_BODY).ok).toBe(true)

    const oversized = 'a'.repeat(GITHUB_BODY_MAX_CHARACTERS + 1)
    const tooLong = validatePrBody(oversized)
    expect(tooLong.ok).toBe(false)
    expect(tooLong.errors).toEqual([
      formatGitHubBodyLengthError({
        characterCount: GITHUB_BODY_MAX_CHARACTERS + 1,
        maxCharacterCount: GITHUB_BODY_MAX_CHARACTERS,
        ok: false,
        utf8ByteCount: GITHUB_BODY_MAX_CHARACTERS + 1,
      }),
    ])

    const customTooLong = validatePrBody(oversized, {
      policy: { formatBodyLengthError: () => 'Too long.' },
    })
    expect(customTooLong.errors).toEqual(['Too long.'])
  })

  it('enforces missing closing ref, interactive-only no-source rules, provenance, and escape leaks', () => {
    const noRef = VALID_BODY.replace('- Closes #42 — main issue', '- Notes only')
    const missingRef = validatePrBody(noRef)
    expect(missingRef.ok).toBe(false)
    expect(missingRef.errors[0]).toContain('at least one GitHub closing keyword')

    const directBody = VALID_BODY.replace(
      '- Closes #42 — main issue',
      `${DIRECT_TEMPLATE.visibleLine}\n${DIRECT_TEMPLATE.marker}`,
    )
    expect(validatePrBody(directBody, { automationContext: false, policy: TEST_POLICY }).ok).toBe(
      true,
    )
    const nonInteractive = validatePrBody(directBody, {
      automationContext: true,
      policy: TEST_POLICY,
    })
    expect(nonInteractive.ok).toBe(false)
    expect(nonInteractive.errors).toContain('Direct user request requires interactive mode.')

    const defaultInteractiveErr = validatePrBody(directBody, {
      policy: {
        noSourceRules: [
          {
            interactiveOnly: true,
            matches: (body) => hasRelatedIssuesNoSourcePair(body, DIRECT_TEMPLATE),
          },
        ],
      },
    })
    expect(defaultInteractiveErr.errors).toContain(
      'This no-source representation is allowed only in an interactive session.',
    )

    const scheduledBody = VALID_BODY.replace(
      '- Closes #42 — main issue',
      `${SCHEDULED_TEMPLATE.visibleLine}\n${SCHEDULED_TEMPLATE.marker}`,
    ).replace('Workspace setup: pnpm install', 'Workspace setup: Scheduled job')
    expect(validatePrBody(scheduledBody, { automationContext: true, policy: TEST_POLICY }).ok).toBe(
      true,
    )

    const missingProvenance = validatePrBody(
      '## Summary\n\nS\n\n## Impact\n\nI\n\n## Related issues\n\nCloses #1\n',
      { policy: { checkEscapeCommentLeaks: false } },
    )
    expect(missingProvenance.errors).toHaveLength(4)

    const leakedEscape = `${VALID_BODY}\n<!-- related-issues-validation: allow #1 because closes #2 -->\n`
    expect(validatePrBody(leakedEscape).ok).toBe(false)
  })
})

describe('validatePrBodyWithIssueReferences', () => {
  const MERGED_TARGET: PullRequestIdentity = {
    mergeCommitOid: 'merge-1',
    number: 99,
    owner: 'acme',
    repo: 'repo',
    state: 'MERGED',
  }

  it('short-circuits on body validation errors without invoking resolver', async () => {
    let called = false
    const result = await validatePrBodyWithIssueReferences('invalid body', () => {
      called = true
      return Promise.resolve({ issue: makeIssue(), ok: true })
    })
    expect(result.ok).toBe(false)
    expect(called).toBe(false)
  })

  it('validates partial-batch source refs, rejects closing the same source, and allows merged closed sources', async () => {
    const partialBody = VALID_BODY.replace(
      '- Closes #42 — main issue',
      `- Refs #42 — slice 1\n${PARTIAL_TEMPLATE.visibleLine}\n${PARTIAL_TEMPLATE.marker}`,
    )

    const okPartial = await validatePrBodyWithIssueReferences(
      partialBody,
      () => Promise.resolve({ issue: makeIssue(), ok: true }),
      { policy: TEST_POLICY },
    )
    expect(okPartial.ok).toBe(true)

    const closingSameKey = `${partialBody}\nCloses #42\n`
    const sameKeyResult = await validatePrBodyWithIssueReferences(
      closingSameKey,
      () => Promise.resolve({ issue: makeIssue(), ok: true }),
      { policy: TEST_POLICY },
    )
    expect(sameKeyResult.errors).toContain('A partial batch must not also close its source issue.')

    const closingSameUrl = `${partialBody}\nCloses acme/repo#42\n`
    const sameUrlResult = await validatePrBodyWithIssueReferences(
      closingSameUrl,
      () => Promise.resolve({ issue: makeIssue(), ok: true }),
      { policy: TEST_POLICY },
    )
    expect(sameUrlResult.errors).toContain('A partial batch must not also close its source issue.')
  })

  it('checks merged-PR closure provenance and runs supersession, milestone, and project auditors', async () => {
    const multiBody = VALID_BODY.replace(
      '- Closes #42 — main issue',
      '- Closes #42 — local\n- Closes #43 — closed elsewhere\n- Closes acme/other#7 — cross-repo\n- Closes #99 — missing',
    )
    const auditedRepos: Array<string | undefined> = []

    const result = await validatePrBodyWithIssueReferences(
      multiBody,
      (ref) => {
        if (ref.key === '#42') {
          return Promise.resolve({ issue: makeIssue({ number: 42, state: 'closed' }), ok: true })
        }
        if (ref.key === '#43') {
          return Promise.resolve({ issue: makeIssue({ number: 43, state: 'closed' }), ok: true })
        }
        if (ref.key === 'acme/other#7') {
          return Promise.resolve({
            issue: makeIssue({
              number: 7,
              state: 'open',
              url: 'https://github.com/acme/other/issues/7',
            }),
            ok: true,
          })
        }
        return Promise.resolve({ error: '404', ok: false })
      },
      {
        closureResolver: (ref) =>
          Promise.resolve(
            ref.key === '#42'
              ? { closer: { number: 99, owner: 'Acme', repo: 'Repo' }, ok: true }
              : { closer: { number: 12, owner: 'Acme', repo: 'Repo' }, ok: true },
          ),
        milestoneAuditor: (_body, _refs, closingIssues) => {
          auditedRepos.push(...closingIssues.map((entry) => entry.repo))
          return Promise.resolve(['milestone issue'])
        },
        projectAuditor: () => Promise.resolve(['project advisory']),
        supersessionAuditor: () => Promise.resolve(['supersession issue']),
        targetPullRequest: MERGED_TARGET,
      },
    )

    expect(auditedRepos).toEqual([undefined, 'acme/other'])
    expect(result.advisories).toEqual(['project advisory'])
    expect(result.errors).toContain('supersession issue')
    expect(result.errors).toContain('milestone issue')
    expect(result.errors.some((e) => e.includes('#7 remains OPEN after merge'))).toBe(true)
    expect(result.errors.some((e) => e.includes('#43 is CLOSED'))).toBe(true)
    expect(result.errors.some((e) => e.includes('#42 is CLOSED'))).toBe(false)
    expect(result.ok).toBe(false)
  })
})
