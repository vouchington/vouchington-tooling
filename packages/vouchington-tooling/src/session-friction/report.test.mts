import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildSessionFrictionReport, isConformingCiFailureBlock, recordFriction } from './index.mts'
import { getConformingGroups } from './ci-failures.mts'
import type { JournalEntry } from './types.mts'
import { buildSandboxSection } from './sandbox.mts'

const directories: string[] = []
const conforming = [
  '- `one-off` — `GitHub Actions` — build cache failure',
  '  - Evidence: CI run 123 failed',
  '  - Root diagnostic: cache corruption',
  '  - Disposition: rebuilt cache',
].join('\n')

async function makeDirectory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'session-friction-report-'))
  directories.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((value) => rm(value, { force: true, recursive: true })),
  )
})

describe('CI failure grammar', () => {
  it('accepts the complete block and rejects partial/trailing content', () => {
    expect(isConformingCiFailureBlock(conforming)).toBe(true)
    expect(isConformingCiFailureBlock(`\n\n${conforming.replaceAll('\n', '\r\n')}\n`)).toBe(true)
    expect(isConformingCiFailureBlock(`${conforming}\nextra`)).toBe(false)
    expect(isConformingCiFailureBlock(conforming.split('\n').slice(0, 2).join('\n'))).toBe(false)
    expect(isConformingCiFailureBlock(`${conforming} `)).toBe(false)
    expect(
      getConformingGroups([
        {
          data: {
            type: 'journal',
            markdown: conforming.replace('cache corruption', '~~hidden~~'),
          },
        },
      ])[0],
    ).toContain('\\~\\~hidden\\~\\~')
    expect(
      isConformingCiFailureBlock(
        conforming.replace('build cache failure', '\u202e').replace('CI run 123 failed', '\u202e'),
      ),
    ).toBe(false)
    expect(getConformingGroups([{ data: { type: 'journal', markdown: 42 } }])).toEqual([])
    expect(getConformingGroups([null] as unknown as JournalEntry[])).toEqual([])
  })
})

describe('buildSessionFrictionReport', () => {
  it('validates the session ID before invoking the journal loader', async () => {
    const directory = await makeDirectory()
    let loaded = false
    await expect(
      buildSessionFrictionReport('', {
        directory,
        journalLoader: () => {
          loaded = true
          return { status: 'not-found' }
        },
      }),
    ).rejects.toThrow(/non-empty/)
    expect(loaded).toBe(false)
  })

  it('omits sandbox event kinds with no events', () => {
    const section = buildSandboxSection([
      {
        kind: 'sandbox-escalation',
        commandPrefix: 'git push',
        detail: 'permission-request',
        timestamp: '1',
      },
    ])
    expect(section).toContain('sandbox-escalation (1)')
    expect(section).not.toContain('sandbox-failure')
  })

  it('bounds sandbox fields after Markdown escaping', () => {
    const section = buildSandboxSection([
      {
        kind: 'sandbox-escalation',
        commandPrefix: 'git push',
        detail: '*'.repeat(120),
        timestamp: '1',
      },
    ])
    expect(section.split(' — ')[1]).toHaveLength(120)
    const boundary = buildSandboxSection([
      {
        kind: 'sandbox-escalation',
        commandPrefix: 'git push',
        detail: `${'a'.repeat(119)}*`,
        timestamp: '1',
      },
    ])
    expect(boundary.split(' — ')[1]).toHaveLength(119)
    expect(boundary.split(' — ')[1]).not.toMatch(/\\$/)
    expect(
      buildSandboxSection([
        {
          kind: 'sandbox-failure',
          commandPrefix: 'git push',
          detail: '~~hidden~~',
          timestamp: '1',
        },
      ]),
    ).toContain('\\~\\~hidden\\~\\~')
  })

  it('keeps report fields on one markdown line', async () => {
    const directory = await makeDirectory()
    recordFriction(
      'session\n## forged',
      { type: 'tool-result', command: 'git push', escalationDetail: 'override\n- forged' },
      { directory, timestamp: '1\n## forged' },
    )
    const report = await buildSessionFrictionReport('session\n## forged', {
      directory,
      journalLoader: async () => ({ status: 'not-found' }),
    })
    expect(report.markdown).not.toContain('\n## forged')
    expect(report.markdown).toContain('override \\- forged')
  })

  it('renders journal failures and deterministic sandbox events', async () => {
    const directory = await makeDirectory()
    recordFriction(
      's',
      { type: 'permission-request', command: 'git push' },
      { directory, timestamp: '1' },
    )
    recordFriction(
      's',
      { type: 'tool-result', command: 'node test', structuredStderr: 'EPERM' },
      { directory, timestamp: '2' },
    )
    const report = await buildSessionFrictionReport('s', {
      directory,
      journalLoader: async () => ({
        status: 'ok',
        entries: [
          { data: { type: 'journal', markdown: conforming } },
          { data: { type: 'journal', markdown: 42 } },
          { data: { type: 'retrospective', markdown: 'ignore' } },
        ],
      }),
    })
    expect(report).toEqual({
      markdown: expect.stringContaining('Status: failures observed'),
    })
    expect(report.markdown).toContain('## Sandbox & Permission Audit')
    expect(report.markdown.indexOf('sandbox-escalation')).toBeLessThan(
      report.markdown.indexOf('sandbox-failure'),
    )
  })

  it('escapes accepted journal fields before rendering them', async () => {
    const directory = await makeDirectory()
    const unsafe = conforming
      .replace('build cache failure', '<!-- hidden')
      .replace('rebuilt cache', '--> *forged*')
    const report = await buildSessionFrictionReport('s', {
      directory,
      journalLoader: () => ({
        status: 'ok',
        entries: [{ data: { type: 'journal', markdown: unsafe } }],
      }),
    })
    expect(report.markdown).not.toMatch(/(?:^|[^\\])<!--/)
    expect(report.markdown).not.toMatch(/(?:^|[^\\])-->/)
    expect(report.markdown).toContain('\\<\\!\\-\\- hidden')
    expect(report.markdown).toContain('\\-\\-\\> \\*forged\\*')
  })

  it('treats not-found as empty and keeps thrown diagnostics separate', async () => {
    const directory = await makeDirectory()
    await expect(
      buildSessionFrictionReport('missing', {
        directory,
        journalLoader: async () => ({ status: 'not-found' }),
      }),
    ).resolves.toEqual({
      markdown:
        '## CI Failures\nStatus: unavailable (no friction log for session missing)\n\n' +
        '## Sandbox & Permission Audit\nStatus: unavailable (no friction log)',
    })
    await expect(
      buildSessionFrictionReport('broken', {
        directory,
        journalLoader: async () => {
          throw new Error('fetch failed')
        },
      }),
    ).resolves.toEqual({
      markdown:
        '## CI Failures\nStatus: unavailable (blackboard unreachable)\n\n' +
        '## Sandbox & Permission Audit\nStatus: unavailable (no friction log)',
      diagnostic: 'fetch failed',
    })
  })

  it('supports an async journal iterable', async () => {
    const directory = await makeDirectory()
    const report = await buildSessionFrictionReport('s', {
      directory,
      journalLoader: () => ({
        status: 'ok',
        entries: (async function* () {
          yield { data: { type: 'journal', markdown: conforming } }
        })(),
      }),
    })
    expect(report.markdown).toContain(conforming)
  })

  it('renders sandbox evidence status independently of CI failures', async () => {
    const directory = await makeDirectory()
    const options = {
      directory,
      journalLoader: () => ({
        status: 'ok' as const,
        entries: [{ data: { type: 'journal' as const, markdown: conforming } }],
      }),
    }
    const absent = await buildSessionFrictionReport('independent', options)
    expect(absent.markdown).toContain('Status: unavailable (no friction log)')
    recordFriction('independent', { type: 'tool-result', command: 'echo ok' }, { directory })
    const observed = await buildSessionFrictionReport('independent', options)
    expect(observed.markdown).toContain('## Sandbox & Permission Audit\nStatus: none observed')
  })

  it('bounds journal entries consumed from an iterable', async () => {
    const directory = await makeDirectory()
    recordFriction('s', { type: 'tool-result', command: 'echo ok' }, { directory })
    let consumed = 0
    let closed = false
    const report = await buildSessionFrictionReport('s', {
      directory,
      journalLoader: () => ({
        status: 'ok',
        entries: (function* () {
          try {
            while (true) {
              consumed++
              yield { data: { type: 'retrospective' } }
            }
          } finally {
            closed = true
          }
        })(),
      }),
    })
    expect(consumed).toBe(500)
    expect(closed).toBe(true)
    expect(report.markdown).toContain('unavailable (journal scan incomplete)')
  })

  it('does not retain oversized journal markdown', async () => {
    const directory = await makeDirectory()
    const report = await buildSessionFrictionReport('s', {
      directory,
      journalLoader: () => ({
        status: 'ok',
        entries: [{ data: { type: 'journal', markdown: 'x'.repeat(10_001) } }],
      }),
    })
    expect(report.markdown).toContain('unavailable (journal scan incomplete)')
    expect(report.markdown).not.toContain('x'.repeat(1_000))
  })

  it('returns paste-safe output when the friction log is unreadable', async () => {
    const directory = await makeDirectory()
    recordFriction('oversized', { type: 'tool-result', command: 'echo ok' }, { directory })
    const [file] = await readdir(directory)
    await writeFile(join(directory, file!), 'x'.repeat(2_000_001))
    await expect(
      buildSessionFrictionReport('oversized', {
        directory,
        journalLoader: async () => ({ status: 'not-found' }),
      }),
    ).resolves.toEqual({
      markdown:
        '## CI Failures\nStatus: unavailable (friction log unreadable)\n\n' +
        '## Sandbox & Permission Audit\nStatus: unavailable (friction log unreadable)',
      diagnostic: 'session-friction log is too large',
    })
    await expect(
      buildSessionFrictionReport('oversized', {
        directory,
        journalLoader: async () => {
          throw new Error('journal unavailable')
        },
      }),
    ).resolves.toEqual({
      markdown:
        '## CI Failures\nStatus: unavailable (blackboard unreachable)\n\n' +
        '## Sandbox & Permission Audit\nStatus: unavailable (friction log unreadable)',
      diagnostic: 'journal unavailable; session-friction log is too large',
    })
  })

  it('preserves validated CI failures when the friction log is unreadable', async () => {
    const directory = await makeDirectory()
    recordFriction('oversized-with-ci', { type: 'tool-result', command: 'echo ok' }, { directory })
    const [file] = await readdir(directory)
    await writeFile(join(directory, file!), 'x'.repeat(2_000_001))
    const report = await buildSessionFrictionReport('oversized-with-ci', {
      directory,
      journalLoader: () => ({
        status: 'ok',
        entries: [{ data: { type: 'journal', markdown: conforming } }],
      }),
    })
    expect(report.markdown).toContain('Status: failures observed')
    expect(report.markdown).toContain(conforming)
    expect(report.markdown).toContain('Status: unavailable (friction log unreadable)')
    expect(report.diagnostic).toBe('session-friction log is too large')
  })

  it('bounds bytes inspected from rejected journal markdown', async () => {
    const directory = await makeDirectory()
    let consumed = 0
    await buildSessionFrictionReport('s', {
      directory,
      journalLoader: () => ({
        status: 'ok',
        entries: (function* () {
          while (true) {
            consumed++
            yield { data: { type: 'journal', markdown: '😀'.repeat(5_001) } }
          }
        })(),
      }),
    })
    expect(consumed).toBe(50)
  })

  it('reports observed-clean only when the friction log was touched', async () => {
    const directory = await makeDirectory()
    recordFriction('clean', { type: 'tool-result', command: 'echo ok' }, { directory })
    await expect(
      buildSessionFrictionReport('clean', {
        directory,
        journalLoader: async () => ({ status: 'not-found' }),
      }),
    ).resolves.toEqual({
      markdown:
        '## CI Failures\nStatus: none observed\n\n' +
        '## Sandbox & Permission Audit\nStatus: none observed',
    })
  })

  it('handles an unprintable thrown journal value without rejecting', async () => {
    const directory = await makeDirectory()
    const unprintable = Object.create(null) as { toString(): string }
    Object.defineProperty(unprintable, 'toString', {
      value() {
        throw new Error('cannot stringify')
      },
    })
    await expect(
      buildSessionFrictionReport('broken', {
        directory,
        journalLoader: async () => {
          throw unprintable
        },
      }),
    ).resolves.toEqual({
      markdown:
        '## CI Failures\nStatus: unavailable (blackboard unreachable)\n\n' +
        '## Sandbox & Permission Audit\nStatus: unavailable (no friction log)',
      diagnostic: '[unprintable error]',
    })
  })
})
