import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { callTool } from './dispatch.mts'
import { BLACKBOARD_ENV } from './fake-blackboard.test-helpers.mts'
import {
  JOURNAL_ARGS,
  harness,
  jsonOf,
  outboxPath,
  textOf,
  useRepoFixture,
} from './harness.test-helpers.mts'
import { TOOLS } from './tools.mts'
import { runIsolatedGit } from './worktree.mts'

const fixture = useRepoFixture()

function writeNothing(h: ReturnType<typeof harness>, root: string) {
  expect(h.fake.calls).toEqual({
    ensure: [],
    patch: [],
    append: [],
    get: [],
    archive: [],
    export: [],
  })
  expect(existsSync(outboxPath(root))).toBe(false)
}

describe('argument validation', () => {
  it('rejects an unknown tool and lists the available ones', async () => {
    const result = await harness(fixture()).call('entry_append', { sessionId: 'a' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('unknown tool entry_append')
    for (const tool of TOOLS) expect(textOf(result)).toContain(tool.name)
  })

  it('rejects arguments that are not an object', async () => {
    for (const bad of ['text', 4, [], null])
      expect(textOf(await harness(fixture()).call('journal_entries', bad))).toContain(
        bad === null ? 'sessionId is required' : 'tool arguments must be an object',
      )
  })

  it('requires a sessionId on every tool and never infers one', async () => {
    for (const tool of TOOLS) {
      const h = harness(fixture())
      for (const args of [undefined, {}, { sessionId: '' }, { sessionId: 7 }]) {
        const result = await h.call(tool.name, args)
        expect(result.isError).toBe(true)
        expect(textOf(result)).toContain('sessionId is required')
      }
      writeNothing(h, fixture().main)
    }
  })

  it('rejects a sessionId that is not URL-safe before touching git or the blackboard', async () => {
    for (const tool of TOOLS) {
      const h = harness(fixture())
      const result = await h.call(tool.name, {
        sessionId: '../escape',
        worktree: '/definitely/not/a/worktree',
      })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain('session id must be URL-safe')
      writeNothing(h, fixture().main)
    }
  })

  it('rejects unsupported arguments including caller-chosen destinations', async () => {
    for (const extra of ['path', 'outboxDirectory', 'file', 'markdownFile']) {
      const h = harness(fixture())
      const result = await h.call('snapshot_export', { sessionId: 's', [extra]: '/tmp/x' })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain(`unsupported argument(s): ${extra}`)
      writeNothing(h, fixture().main)
    }
  })
})

describe('worktree gate', () => {
  it('accepts the launch worktree by default and any listed worktree by path', async () => {
    const h = harness(fixture())
    const args = { ...JOURNAL_ARGS, mode: 'interactive' }
    expect(jsonOf(await h.call('journal_append', args)).status).toBe('delivered')
    expect(existsSync(outboxPath(fixture().main))).toBe(true)
    const linked = await h.call('journal_append', {
      ...args,
      sourceEventId: 'journal:2',
      worktree: fixture().linked,
    })
    expect(jsonOf(linked).status).toBe('delivered')
    expect(existsSync(outboxPath(fixture().linked))).toBe(true)
  })

  it('accepts the worktree of a second, unrelated repository', async () => {
    const h = harness(fixture())
    const result = await h.call('journal_append', {
      ...JOURNAL_ARGS,
      mode: 'interactive',
      worktree: fixture().outside,
    })
    expect(jsonOf(result).status).toBe('delivered')
    expect(existsSync(outboxPath(fixture().outside))).toBe(true)
    expect(existsSync(outboxPath(fixture().main))).toBe(false)
  })

  it('works from a non-git launch directory with an explicit worktree', async () => {
    const h = harness(fixture(), { launchRoot: undefined })
    const result = await h.call('journal_append', {
      ...JOURNAL_ARGS,
      mode: 'interactive',
      worktree: fixture().linked,
    })
    expect(jsonOf(result).status).toBe('delivered')
    expect(existsSync(outboxPath(fixture().linked))).toBe(true)
  })

  it('asks for an explicit worktree when launched outside git and none is given', async () => {
    for (const tool of TOOLS) {
      const h = harness(fixture(), { launchRoot: undefined })
      const result = await h.call(tool.name, { sessionId: 's' })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain('worktree is required')
      expect(textOf(result)).toContain('pass worktree as the absolute path')
      writeNothing(h, fixture().main)
    }
  })

  it('rejects a non-git directory and writes nothing', async () => {
    const h = harness(fixture())
    const result = await h.call('journal_append', {
      ...JOURNAL_ARGS,
      mode: 'interactive',
      worktree: fixture().root,
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('is not the top level of a git worktree')
    writeNothing(h, fixture().main)
    expect(existsSync(outboxPath(fixture().root))).toBe(false)
  })

  it('rejects a subdirectory of a worktree and a relative path on every tool', async () => {
    const nested = join(fixture().main, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    for (const tool of TOOLS) {
      const h = harness(fixture())
      const inside = await h.call(tool.name, { sessionId: 's', worktree: nested })
      expect(textOf(inside)).toContain('is not the top level of a git worktree')
      const relative = await h.call(tool.name, { sessionId: 's', worktree: 'main' })
      expect(textOf(relative)).toContain('worktree must be an absolute path')
      writeNothing(h, fixture().main)
    }
  })

  it("resolves agent-blackboard from the server's own install, not from the worktree", async () => {
    const install = (directory: string, status: string) => {
      const stub = join(directory, 'node_modules', 'agent-blackboard')
      mkdirSync(stub, { recursive: true })
      writeFileSync(
        join(stub, 'package.json'),
        JSON.stringify({ name: 'agent-blackboard', version: '0.0.0', main: 'index.mjs' }),
      )
      writeFileSync(
        join(stub, 'index.mjs'),
        `export class Sessions {
          async ensure() { return { status: '${status}', session: { data: {} } } }
        }
        export class Entries {}`,
      )
    }
    const installation = join(fixture().root, 'machine-install')
    install(installation, 'exists')
    install(fixture().main, 'decoy-main')
    install(fixture().linked, 'decoy-linked')
    const environment = {
      launchRoot: fixture().main,
      env: BLACKBOARD_ENV,
      runGit: runIsolatedGit,
      resolveFrom: join(installation, 'server.mjs'),
    }
    const args = { sessionId: 's', parentSessionId: null, agent: 'codex', version: '1' }
    for (const worktree of [undefined, fixture().main, fixture().linked, fixture().outside]) {
      const result = await callTool(
        'session_ensure',
        worktree === undefined ? args : { ...args, worktree },
        environment,
      )
      expect(jsonOf(result).status).toBe('exists')
    }
  })

  it("defaults to this package's own location, ignoring a client installed in the worktree", async () => {
    const stub = join(fixture().main, 'node_modules', 'agent-blackboard')
    mkdirSync(stub, { recursive: true })
    writeFileSync(join(stub, 'package.json'), '{"name":"agent-blackboard","main":"index.mjs"}')
    writeFileSync(join(stub, 'index.mjs'), 'throw new Error("worktree decoy was loaded")')
    const result = await callTool(
      'session_ensure',
      { sessionId: 's', parentSessionId: null, agent: 'codex', version: '1' },
      { launchRoot: fixture().main, env: {}, runGit: runIsolatedGit },
    )
    expect(textOf(result)).not.toContain('decoy')
  })

  it('reports a missing agent-blackboard peer as a tool error naming the install', async () => {
    const result = await callTool(
      'session_ensure',
      { sessionId: 's', parentSessionId: null, agent: 'codex', version: '1' },
      {
        launchRoot: fixture().main,
        env: BLACKBOARD_ENV,
        runGit: runIsolatedGit,
        resolveFrom: join(fixture().root, 'empty', 'server.mjs'),
      },
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('agent-blackboard is not installed')
  })
})
