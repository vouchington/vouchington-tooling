import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { parse as yamlLoad } from 'yaml'
import { runAstGrepExamples } from '../ast-grep-examples/index.mts'
import { runAstGrepPackCommand } from '../cli/commands/ast-grep-pack.mts'
import { astGrepPackPaths } from './index.mts'

const astGrepExecutable = fileURLToPath(
  new URL('../../node_modules/@ast-grep/cli/ast-grep', import.meta.url),
)

const PRODUCT = /voucha|filaments|jonathanong|account-data-requests|@local\/voucha/iu

describe('ast-grep pack', () => {
  it('resolves shipped rules and config', () => {
    const pack = astGrepPackPaths()
    expect(pack.rules).toMatch(/ast-grep\/rules$/)
    expect(pack.config).toMatch(/ast-grep\/sgconfig\.yml$/)
    expect(readFileSync(pack.config, 'utf8')).toContain('languageGlobs')
  })

  it('ships product-identifier-free unconditional rules with examples', () => {
    const { rules } = astGrepPackPaths()
    const files = readdirSync(rules)
      .filter((file) => file.endsWith('.yml'))
      .toSorted()
    expect(files.length).toBeGreaterThan(20)
    for (const file of files) {
      const text = readFileSync(join(rules, file), 'utf8')
      expect(text, file).not.toMatch(PRODUCT)
      const rule = yamlLoad(text) as { id?: string; examples?: unknown[] }
      expect(rule.id, file).toBe(file.replace(/\.yml$/u, ''))
      expect(rule.examples?.length, file).toBeGreaterThan(0)
    }
  })

  it('passes native ast-grep example replay for the shipped pack', () => {
    const pack = astGrepPackPaths()
    expect(runAstGrepExamples({ ...pack, executable: astGrepExecutable })).toBe(0)
  })

  it('prints pack paths as JSON from the CLI', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(runAstGrepPackCommand()).toBe(0)
      expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toEqual(astGrepPackPaths())
    } finally {
      stdout.mockRestore()
    }
  })
})
