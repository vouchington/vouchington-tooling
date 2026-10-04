import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

it('preserves asserted bindings and separates type-only from runtime shadowing in Oxlint', () => {
  const root = mkdtempSync(join(tmpdir(), 'typescript-rule-boundaries-'))
  try {
    writeFileSync(
      join(root, 'selected.mts'),
      `
import { CacheClient } from '@store/cache'
const CACHE_GROUP = 'cache:group' as const
CacheClient.invalidate(CACHE_GROUP)
{ const writeRows = (async () => Promise.all(rows.map(drain))) as Drain }
{ const writeRows = (async () => Promise.all(rows.map(drain))) satisfies Drain }
{ const writeRows = ((async () => Promise.all(rows.map(drain))) as Drain) satisfies Drain }
{
  async function writeRows() {
    interface Promise<T> { marker: T }
    Promise.all(rows.map(drain))
  }
}
{
  async function writeRows() {
    type Promise<T> = { marker: T }
    Promise.all(rows.map(drain))
  }
}
{
  function outer(Promise: unknown) {
    async function writeRows() {
      interface Promise<T> { marker: T }
      Promise.all(rows.map(drain))
    }
  }
}
`,
    )
    writeFileSync(
      join(root, '.oxlintrc.json'),
      JSON.stringify({
        categories: { correctness: 'off', suspicious: 'off', perf: 'off' },
        plugins: [],
        jsPlugins: [
          {
            name: 'vouchington',
            specifier: resolve('packages/eslint-plugin-vouchington/src/index.mts'),
          },
        ],
        rules: {
          'vouchington/serial-cursor-drains': [
            'error',
            { functions: ['writeRows'], includeFiles: ['selected.mts'] },
          ],
          'vouchington/banned-member-read': [
            'error',
            {
              members: ['invalidate'],
              includeFiles: ['selected.mts'],
              exceptions: [
                {
                  file: 'selected.mts',
                  member: 'invalidate',
                  module: '@store/cache',
                  imported: 'CacheClient',
                  local: 'CacheClient',
                  kind: 'constructor-constant',
                  constant: { name: 'CACHE_GROUP', value: 'cache:group' },
                },
              ],
            },
          ],
        },
      }),
    )
    const result = spawnSync(
      resolve('node_modules/.bin/oxlint'),
      ['-c', '.oxlintrc.json', '--format', 'json', 'selected.mts'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    const { diagnostics } = JSON.parse(result.stdout) as { diagnostics: Array<{ code: string }> }
    expect(diagnostics.map(({ code }) => code)).toEqual(
      Array.from({ length: 5 }, () => 'vouchington(serial-cursor-drains)'),
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
