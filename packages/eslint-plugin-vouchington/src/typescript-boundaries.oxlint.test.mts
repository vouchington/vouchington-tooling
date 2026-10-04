import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

it('preserves asserted bindings and separates type-only from runtime shadowing in Oxlint', () => {
  const root = mkdtempSync(join(tmpdir(), 'typescript-rule-boundaries-'))
  try {
    writeFileSync(
      join(root, 'selected.tsx'),
      `
import { CacheClient } from '@store/cache'
const CACHE_GROUP = 'cache:group' as const
CacheClient.invalidate(CACHE_GROUP)
CacheClient.invalidate(CACHE_GROUP satisfies string)
CacheClient.invalidate(CACHE_GROUP as string)
CacheClient.invalidate(CACHE_GROUP!)
CacheClient.invalidate!(CACHE_GROUP);
(CacheClient.invalidate as (group: string) => void)(CACHE_GROUP)
{ interface CacheClient { marker: string }; CacheClient.invalidate(CACHE_GROUP) }
{ type CacheClient = { marker: string }; CacheClient.invalidate(CACHE_GROUP) }
const instance = new CacheClient({ prefix: 'validation' as const })
instance.invalidate()
const checked = new CacheClient({ prefix: 'validation' satisfies string })
checked.invalidate();
(checked.invalidate as () => void)()
{
  async function writeRows() {
    Promise.all(rows?.map(drain) ?? [])
    Promise.all(enabled ? rows.map(drain) : [])
    Promise.all([...rows.map(drain)])
    Promise.all(rows.map(drain).filter(Boolean))
    Promise.all(passThrough(rows.map(drain)))
    Promise.all((() => rows.map(drain))())
    Promise.all(jobs = rows.map(drain))
    Promise.all(((jobs = rows.map(drain)) => jobs)())
    Promise.all(((jobs = rows.map(drain)) => jobs)(void 0))
    Promise.all(((jobs = rows.map(drain)) => jobs)(...[]))
    Promise.all(((jobs = rows.map(drain)) => jobs)(...[undefined]))
    Promise.all((function () { return rows.map(drain) }).call(null))
    Promise.all((function () { return rows.map(drain) }).apply(null, []))
    Promise.all((function* () { yield rows.map(drain) })())
    Promise.all([<Widget jobs={rows.map(drain)} />])
    Promise.all([<Widget>{rows.map(drain)}</Widget>])
    Promise.all([<Widget {...{ jobs: rows.map(drain) }} />])
    Promise.all([<>{rows.map(drain)}</>])
    Promise.all(((jobs = rows.map(drain)) => jobs)(undefined))
    Promise.all((() => { class Batch { static jobs = rows.map(drain) }; return Batch.jobs })())
    Promise.all(([jobs = rows.map(drain)] = []))
    Promise.all([], rows.map(drain))
    class Later { jobs = Promise.all(rows.map(drain)); static jobs = Promise.all(rows.map(drain)) }
    Promise.all([() => rows.map(drain)])
  }
}
{
  declare const Promise: PromiseConstructor
  interface Promise<T> { marker: T }
  async function writeRows() { Promise.all(rows.map(drain)) }
}
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
            { functions: ['writeRows'], includeFiles: ['selected.tsx'] },
          ],
          'vouchington/banned-member-read': [
            'error',
            {
              members: ['invalidate'],
              includeFiles: ['selected.tsx'],
              exceptions: [
                {
                  file: 'selected.tsx',
                  member: 'invalidate',
                  module: '@store/cache',
                  imported: 'CacheClient',
                  local: 'CacheClient',
                  kind: 'const-instance-prefix',
                  prefix: 'validation',
                },
                {
                  file: 'selected.tsx',
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
      ['-c', '.oxlintrc.json', '--format', 'json', 'selected.tsx'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    const { diagnostics } = JSON.parse(result.stdout) as { diagnostics: Array<{ code: string }> }
    expect(diagnostics.map(({ code }) => code)).toEqual(
      Array.from({ length: 29 }, () => 'vouchington(serial-cursor-drains)'),
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
