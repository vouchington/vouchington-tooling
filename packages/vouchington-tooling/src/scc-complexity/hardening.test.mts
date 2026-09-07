import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SharedContext } from '../shared-context/index.mts'
import {
  checkSccComplexity,
  parseSccComplexityBaseline,
  SCC_COMPLEXITY_BASELINE_VERSION,
} from './index.mts'
import { escapeWorkflowCommandMessage, escapeWorkflowCommandProperty } from './workflow-command.mts'

describe('scc-complexity hardening', () => {
  const testDirs: string[] = []
  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  async function makeFixture(trackedFiles: string[]): Promise<SharedContext> {
    const repoRoot = await mkdtemp(join(tmpdir(), 'scc-complexity-'))
    testDirs.push(repoRoot)
    for (const file of trackedFiles) {
      await mkdir(dirname(join(repoRoot, file)), { recursive: true })
      await writeFile(join(repoRoot, file), 'export const value = true\n')
    }
    return { isInsideGitRepo: true, repoRoot, trackedFiles, trackedFileSet: new Set(trackedFiles) }
  }

  it('inherits the top-level limit and rejects custom results outside a named scope', async () => {
    const ctx = await makeFixture(['dev/tool.mts', 'src/app.mts'])
    await expect(
      checkSccComplexity(
        ctx,
        { limit: 10, scopes: [{ includePaths: ['dev'], name: 'tooling' }] },
        () =>
          Promise.resolve(
            JSON.stringify([{ Files: [{ Complexity: 11, Location: 'dev/tool.mts' }] }]),
          ),
      ),
    ).resolves.toEqual({
      errors: [
        '::error file=dev/tool.mts::[tooling] dev/tool.mts: scc complexity 11 exceeds 10; simplify or split this file',
      ],
    })
    await expect(
      checkSccComplexity(ctx, { scopes: [{ includePaths: ['dev'], name: 'tooling' }] }, () =>
        Promise.resolve(JSON.stringify([{ Files: [{ Complexity: 99, Location: 'src/app.mts' }] }])),
      ),
    ).resolves.toEqual({
      errors: [
        '::error::scc-complexity failed: scope tooling received result outside its paths: src/app.mts',
      ],
    })
  })

  it('rejects workflow-command control characters and physical scope escapes', async () => {
    const ctx = await makeFixture(['src/app.mts'])
    await expect(
      checkSccComplexity(ctx, { scopes: [{ includePaths: ['src'], name: 'tooling\nerror' }] }),
    ).resolves.toEqual({
      errors: [
        '::error::scc-complexity failed: scope name contains a workflow command control character',
      ],
    })
    expect(() =>
      parseSccComplexityBaseline(
        JSON.stringify({
          entries: [{ complexity: 12, file: 'src/app.mts', scope: 'tooling\rerror' }],
          version: SCC_COMPLEXITY_BASELINE_VERSION,
        }),
      ),
    ).toThrow('baseline entry 0 contains a workflow command control character')
    expect(() =>
      parseSccComplexityBaseline(
        JSON.stringify({
          entries: [{ complexity: 12, file: 'src/app\n.mts', scope: 'tooling' }],
          version: SCC_COMPLEXITY_BASELINE_VERSION,
        }),
      ),
    ).toThrow('baseline entry 0 contains a workflow command control character')
    for (const includePath of ['C:\\outside', '\\outside']) {
      await expect(
        checkSccComplexity(ctx, { scopes: [{ includePaths: [includePath], name: 'tooling' }] }),
      ).resolves.toEqual({
        errors: [
          '::error::scc-complexity failed: scope tooling includes a path outside the repository',
        ],
      })
    }
    const outside = await mkdtemp(join(tmpdir(), 'scc-complexity-outside-'))
    testDirs.push(outside)
    await symlink(outside, join(ctx.repoRoot, 'src', 'linked-outside'))
    await expect(
      checkSccComplexity(ctx, {
        scopes: [{ includePaths: ['src/linked-outside'], name: 'tooling' }],
      }),
    ).resolves.toEqual({
      errors: [
        '::error::scc-complexity failed: scope tooling includes a path outside the repository',
      ],
    })
  })

  it('escapes defensive workflow-command output boundaries', () => {
    expect(escapeWorkflowCommandMessage('scope%\r\n')).toBe('scope%25%0D%0A')
    expect(escapeWorkflowCommandProperty('src:a,b')).toBe('src%3Aa%2Cb')
  })
})
