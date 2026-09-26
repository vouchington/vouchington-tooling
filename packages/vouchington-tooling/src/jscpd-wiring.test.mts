import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const COMMAND = 'jscpd .'

function read(file: string) {
  return readFileSync(resolve(root, file), 'utf8')
}

describe('jscpd wiring', () => {
  const config = JSON.parse(read('.jscpd.json')) as {
    crossFormats: string
    exitCode: number
    failOnEmpty: boolean
    format: string[]
    ignore: string[]
    minLines: number
    similarity: number
  }
  const doc = read('docs/jscpd.md')

  it('runs the plain jscpd CLI from lint, which CI already runs', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>
      scripts: Record<string, string>
    }
    expect(packageJson.devDependencies.jscpd).toBe('5.3.2')
    expect(packageJson.scripts.jscpd).toBe(COMMAND)
    expect(packageJson.scripts.lint).toContain('pnpm run jscpd')
    expect(read('.github/workflows/ci.yml')).toContain('pnpm run lint\n')
  })

  it('keeps minLines at 200 and similarity at 0.85', () => {
    expect(config).toEqual({
      format: ['typescript', 'tsx', 'javascript', 'sql', 'bash', 'css'],
      crossFormats: 'typescript,tsx',
      failOnEmpty: true,
      similarity: 0.85,
      minLines: 200,
      exitCode: 1,
      ignore: ['**/fixtures/**'],
    })
    expect(doc).toContain(`\`"minLines": ${config.minLines}\``)
    expect(doc).toContain(`\`"similarity": ${config.similarity}\``)
  })

  it('documents every configured ignore glob', () => {
    const undocumented = config.ignore.filter((glob) => !doc.includes(`\`${glob}\``))
    expect(undocumented).toEqual([])
  })

  it('lists only configured globs in the exceptions table', () => {
    const tableGlobs = [...doc.matchAll(/^\| `([^`]+)` +\|/gm)].map((match) => match[1])
    expect(tableGlobs.filter((glob) => !config.ignore.includes(glob ?? ''))).toEqual([])
  })
})
