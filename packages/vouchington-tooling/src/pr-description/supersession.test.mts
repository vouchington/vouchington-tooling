import { describe, expect, it } from 'vitest'

import {
  buildSupersessionSearchArgs,
  createDiffSummary,
  createSupersessionAuditor,
  findSupersessionHits,
  parseAuditDecisions,
  reduceDiffBlock,
  runAdvisorySupersessionSearch,
  validateAuditHits,
  type PackageJsonReader,
} from './index.mts'

const NO_PACKAGE_JSON: PackageJsonReader = () => Promise.resolve(undefined)

const DELETION_BLOCK = [
  'diff --git a/src/legacy-handler.mts b/src/legacy-handler.mts',
  'deleted file mode 100644',
  '--- a/src/legacy-handler.mts',
  '+++ /dev/null',
  '-export const handle = () => {}',
].join('\n')

describe('supersession', () => {
  it('builds gh search args and deduplicates hits across terms preserving first attribution', async () => {
    expect(buildSupersessionSearchArgs('acme/repo', '"src/legacy-handler.mts"')).toEqual([
      'issue',
      'list',
      '--repo',
      'acme/repo',
      '--search',
      '"src/legacy-handler.mts"',
      '--state',
      'open',
      '--json',
      'number,title,url',
      '--limit',
      '10',
    ])

    let call = 0
    const hits = await findSupersessionHits(
      () => {
        call += 1
        return Promise.resolve(
          JSON.stringify(
            call === 1
              ? [{ number: 10, title: 'First', url: 'https://github.com/acme/repo/issues/10' }]
              : [
                  { number: 10, title: 'First', url: 'https://github.com/acme/repo/issues/10' },
                  { number: 20, title: 'Second', url: 'https://github.com/acme/repo/issues/20' },
                ],
          ),
        )
      },
      'acme/repo',
      ['termA', 'termB'],
    )
    expect(hits).toEqual([
      {
        matchedTerm: 'termA',
        number: 10,
        title: 'First',
        url: 'https://github.com/acme/repo/issues/10',
      },
      {
        matchedTerm: 'termB',
        number: 20,
        title: 'Second',
        url: 'https://github.com/acme/repo/issues/20',
      },
    ])
  })

  it('parses decisions and enforces local vs cross-repo disposition guards', () => {
    const body = [
      'Closes #1',
      '<!-- issue-audit: keep-open #2 because unrelated: incidental -->',
      '<!-- issue-audit: keep-open other/repo#3 because unrelated: foreign -->',
    ].join('\n')
    const decisions = parseAuditDecisions(body)
    expect(decisions).toHaveLength(3)

    const errors = validateAuditHits(
      'Acme/Repo',
      [
        { matchedTerm: 't1', number: 1, title: 'Closed local', url: 'u1' },
        { matchedTerm: 't2', number: 2, title: 'Kept open local', url: 'u2' },
        { matchedTerm: 't3', number: 3, title: 'Foreign keep-open ignored', url: 'u3' },
        { matchedTerm: 't4', number: 4, title: 'Closed via self-qualified ref', url: 'u4' },
        { matchedTerm: 't5', number: 5, title: 'Foreign close ignored', url: 'u5' },
      ],
      decisions,
      [
        { key: '#1', number: 1, owner: undefined, repo: undefined },
        { key: 'acme/repo#4', number: 4, owner: 'acme', repo: 'repo' },
        { key: 'other/repo#5', number: 5, owner: 'other', repo: 'repo' },
      ],
    )

    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('#3 ("Foreign keep-open ignored")')
    expect(errors[1]).toContain('#5 ("Foreign close ignored")')
  })

  it('runs blocking auditor and advisory search, skipping gh when no removal terms exist', async () => {
    const emptySummary = createDiffSummary()
    let calls = 0
    const runGh = () => {
      calls += 1
      return Promise.resolve(
        JSON.stringify([
          { number: 7, title: 'Legacy cleanup', url: 'https://github.com/acme/repo/issues/7' },
        ]),
      )
    }

    await expect(
      createSupersessionAuditor(runGh, 'acme/repo', emptySummary, NO_PACKAGE_JSON)('', []),
    ).resolves.toEqual([])
    await expect(
      runAdvisorySupersessionSearch(runGh, 'acme/repo', emptySummary, NO_PACKAGE_JSON),
    ).resolves.toBe('')
    expect(calls).toBe(0)

    const summary = createDiffSummary()
    reduceDiffBlock(summary, DELETION_BLOCK)
    const auditorErrors = await createSupersessionAuditor(
      runGh,
      'acme/repo',
      summary,
      NO_PACKAGE_JSON,
    )('', [])
    expect(auditorErrors).toHaveLength(1)
    expect(auditorErrors[0]).toContain('#7 ("Legacy cleanup")')

    const advisory = await runAdvisorySupersessionSearch(
      runGh,
      'acme/repo',
      summary,
      NO_PACKAGE_JSON,
    )
    expect(advisory).toContain('#7: Legacy cleanup')
  })
})
