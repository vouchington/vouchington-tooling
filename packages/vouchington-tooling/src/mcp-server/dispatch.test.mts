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

  it('rejects a separate git init repository and writes nothing', async () => {
    const h = harness(fixture())
    const result = await h.call('journal_append', {
      ...JOURNAL_ARGS,
      mode: 'interactive',
      worktree: fixture().outside,
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('is not a worktree of the repository this server was launched')
    writeNothing(h, fixture().main)
    expect(existsSync(outboxPath(fixture().outside))).toBe(false)
  })

  it('rejects a subdirectory of a worktree and a relative path on every tool', async () => {
    const nested = join(fixture().main, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    for (const tool of TOOLS) {
      const h = harness(fixture())
      const inside = await h.call(tool.name, { sessionId: 's', worktree: nested })
      expect(textOf(inside)).toContain('is not a worktree of the repository')
      const relative = await h.call(tool.name, { sessionId: 's', worktree: 'main' })
      expect(textOf(relative)).toContain('worktree must be an absolute path')
      writeNothing(h, fixture().main)
    }
  })

  it('resolves agent-blackboard from the validated worktree, not from the server', async () => {
    const install = (worktree: string, status: string) => {
      const stub = join(worktree, 'node_modules', 'agent-blackboard')
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
    install(fixture().main, 'exists')
    install(fixture().linked, 'created')
    const environment = { launchRoot: fixture().main, env: BLACKBOARD_ENV, runGit: runIsolatedGit }
    const args = { sessionId: 's', parentSessionId: null, agent: 'codex', version: '1' }
    const ensure = async (worktree?: string) =>
      jsonOf(
        await callTool(
          'session_ensure',
          worktree === undefined ? args : { ...args, worktree },
          environment,
        ),
      ).status
    expect(await ensure()).toBe('exists')
    expect(await ensure(fixture().main)).toBe('exists')
    expect(await ensure(fixture().linked)).toBe('created')
  })
})
