import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AuditArgs } from './args.mts'
import { bashUse, jsonl, tempDir, toolResult, writeLines } from './fixtures.test-helpers.mts'
import { importRulesModule, loadAuditRules, runAudit } from './run.mts'

const covers = { covers: (list: string) => list === 'allow' }

function args(overrides: Partial<AuditArgs> = {}): AuditArgs {
  const base = tempDir()
  const projectsDir = join(base, 'projects')
  writeLines(
    join(projectsDir, 'p', 'a.jsonl'),
    jsonl(
      { type: 'system', cwd: '/repo' },
      bashUse('1', 'curl x', { dangerouslyDisableSandbox: true }),
      toolResult('1', 'permission denied'),
    ),
  )
  return {
    rules: 'rules.mjs',
    projectsDir,
    codexSessionsDir: join(base, 'sessions'),
    maxFilesPerRoot: 10,
    json: false,
    raw: false,
    repoRoots: ['/repo'],
    worktreeGlobs: [],
    ...overrides,
  }
}

const deps = (module: unknown) => ({ cwd: '/work', load: async () => ({ default: module }) })

describe('loadAuditRules', () => {
  const policy = { loadPolicy: () => covers }

  it('reads the default export, a named rules export, or a function returning one', async () => {
    expect(await loadAuditRules('r.mjs', '/work', async () => ({ default: policy }))).toBe(policy)
    expect(await loadAuditRules('r.mjs', '/work', async () => ({ rules: policy }))).toBe(policy)
    expect(
      await loadAuditRules('r.mjs', '/work', async () => ({ default: async () => policy })),
    ).toBe(policy)
  })

  it('resolves the specifier against cwd into a file URL', async () => {
    let seen = ''
    await loadAuditRules(
      'rel/r.mjs',
      '/work',
      async (specifier) => ((seen = specifier), { default: policy }),
    )
    expect(seen).toBe('file:///work/rel/r.mjs')
  })

  it.each([undefined, null, {}, { loadPolicy: 1 }, 'text'])(
    'rejects a module exporting %j',
    async (value) => {
      await expect(
        loadAuditRules('r.mjs', '/work', async () => ({ default: value })),
      ).rejects.toThrow('rules module r.mjs must export an object with a loadPolicy function')
    },
  )

  it('imports real modules by default', async () => {
    const dir = tempDir()
    const file = join(dir, 'rules.mjs')
    writeLines(file, ['export default { loadPolicy: () => ({ covers: () => true }) }'])
    const rules = await loadAuditRules(file, dir)
    expect(typeof rules.loadPolicy).toBe('function')
    expect(importRulesModule).toBeTypeOf('function')
  })
})

describe('runAudit', () => {
  it('scans, classifies and formats', async () => {
    const seen: unknown[] = []
    const rules = {
      loadPolicy: (context: unknown) => (seen.push(context), covers),
      classifyFailure: () => undefined,
      limits: { maxRetainedRecords: 5 },
    }
    const text = await runAudit(args({ settingsPath: 'cfg.json' }), deps(rules))
    expect(text).toContain('  - curl x (1) [already allowed]')
    expect(text).toContain('Scope: /repo')
    expect(seen).toEqual([{ cwd: '/work', settingsPath: 'cfg.json' }])
  })

  it('omits the settings path when none was given, and honors the other options', async () => {
    const seen: unknown[] = []
    const rules = { loadPolicy: (context: unknown) => (seen.push(context), covers) }
    const input = args({ json: true, sinceDays: 1, sessionId: 'abc', raw: false })
    const text = await runAudit(input, deps(rules))
    expect(JSON.parse(text).claudeFilesScanned).toBe(0)
    expect(seen).toEqual([{ cwd: '/work' }])
  })

  it('reports an unavailable policy as a status, not an error', async () => {
    const text = await runAudit(
      args(),
      deps({ loadPolicy: async () => ({ error: 'bad settings' }) }),
    )
    expect(text).toBe('=== Sandbox Command Audit ===\nStatus: unavailable (bad settings)\n')
  })

  it('reports an unresolvable repository as a status that points at --repo-root', async () => {
    const dir = tempDir()
    const input = args()
    delete input.repoRoots
    const text = await runAudit(input, {
      cwd: dir,
      load: async () => ({ default: { loadPolicy: () => covers } }),
    })
    expect(text).toContain('Status: unavailable (repo root resolution failed:')
    expect(text).toContain('pass --repo-root')
  })

  it('stringifies a non-Error failure while resolving the repository', async () => {
    const rules = { loadPolicy: () => covers, worktreeGlobs: [] as string[] }
    Object.defineProperty(rules, 'worktreeGlobs', {
      get() {
        throw 'plain failure'
      },
    })
    expect(await runAudit(args(), deps(rules))).toContain(
      'repo root resolution failed: plain failure',
    )
  })

  it('merges worktree layouts from the module and the flags', async () => {
    const base = tempDir()
    writeLines(join(base, 'extra', 'one', 'keep'), [])
    writeLines(join(base, 'more', 'two', 'keep'), [])
    const input = args({ repoRoots: [join(base, 'main')], worktreeGlobs: ['../more/*'] })
    const text = await runAudit(
      input,
      deps({ loadPolicy: () => covers, worktreeGlobs: ['../extra/*'] }),
    )
    expect(text).toContain(`Scope: ${join(base, 'main')} (+2 worktrees)`)
  })
})
