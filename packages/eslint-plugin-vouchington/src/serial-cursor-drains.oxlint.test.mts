import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

it('keeps named boundaries and awaited TypeScript iteration semantics in Oxlint', () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-drain-oxlint-'))
  try {
    writeFileSync(
      join(root, 'selected.mts'),
      `async function writeRows() {
  consume(function nested() { Promise.all(rows.map(drain)) })
  const object = { nested() { Promise.all(rows.map(drain)) } }
  class Nested {
    nested() { Promise.all(rows.map(drain)) }
    nestedArrow = () => Promise.all(rows.map(drain))
  }
  await Promise.all(await rows.map(drain))
  await Promise.all(await (rows.map(drain) as Array<Promise<void>>))
}`,
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
    const { diagnostics } = JSON.parse(result.stdout) as {
      diagnostics: Array<{ code: string; labels: [{ span: { line: number } }] }>
    }
    expect(diagnostics.map(({ code }) => code)).toEqual([
      'vouchington(serial-cursor-drains)',
      'vouchington(serial-cursor-drains)',
    ])
    expect(diagnostics.map(({ labels }) => labels[0].span.line).toSorted((a, b) => a - b)).toEqual([
      8, 9,
    ])
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
