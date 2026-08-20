import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseGithubOutput } from '../cli/commands/github-output.test-helpers.mts'
import {
  decodeSelectedFiles,
  encodeSelectedFiles,
  formatMultilineOutput,
  SELECTED_FILES_ENV_MAX_BYTES,
  selectedFilesExceedEnvBudget,
  writeSelectedFilesOutput,
} from './index.mts'

function filesExceedingEnvBudget(): string[] {
  const files: string[] = []
  while (!selectedFilesExceedEnvBudget(files)) {
    files.push(`src/suite/file-${files.length}.test.mts`)
  }
  return files
}

const SPACE_AND_GLOB_FILES = [
  'web/components/[id]/foo.test.tsx',
  'web/components/needs space/bar.test.tsx',
  'src/glob-*-star.test.mts',
  'tests/question?.spec.mts',
]

describe('encodeSelectedFiles', () => {
  it('newline-joins lists without a trailing newline', () => {
    expect(encodeSelectedFiles([])).toBe('')
    expect(encodeSelectedFiles(['web/foo.test.tsx'])).toBe('web/foo.test.tsx')
    expect(encodeSelectedFiles(['web/foo.test.tsx', 'web/bar.test.tsx'])).toBe(
      'web/foo.test.tsx\nweb/bar.test.tsx',
    )
    expect(encodeSelectedFiles(SPACE_AND_GLOB_FILES)).toBe(SPACE_AND_GLOB_FILES.join('\n'))
  })
})

describe('selectedFilesExceedEnvBudget', () => {
  it('accepts a small list and rejects one over Linux MAX_ARG_STRLEN headroom', () => {
    expect(selectedFilesExceedEnvBudget(['src/example.test.mts'])).toBe(false)
    const files = filesExceedingEnvBudget()
    expect(Buffer.byteLength(encodeSelectedFiles(files), 'utf8')).toBeGreaterThan(
      SELECTED_FILES_ENV_MAX_BYTES,
    )
    expect(selectedFilesExceedEnvBudget(files)).toBe(true)
  })
})

describe('decodeSelectedFiles', () => {
  it('treats empty and whitespace payloads as no selection', () => {
    expect(decodeSelectedFiles(undefined)).toEqual([])
    expect(decodeSelectedFiles(null)).toEqual([])
    expect(decodeSelectedFiles('')).toEqual([])
    expect(decodeSelectedFiles('   ')).toEqual([])
    expect(decodeSelectedFiles('\n\n')).toEqual([])
  })

  it('splits on newlines, keeps spaces, and round-trips encodings', () => {
    expect(decodeSelectedFiles('web/foo.test.tsx\nweb/bar.test.tsx\n')).toEqual([
      'web/foo.test.tsx',
      'web/bar.test.tsx',
    ])
    expect(decodeSelectedFiles('\nweb/foo.test.tsx\n\nweb/bar.test.tsx\n')).toEqual([
      'web/foo.test.tsx',
      'web/bar.test.tsx',
    ])
    expect(decodeSelectedFiles('web/components/needs space/bar.test.tsx')).toEqual([
      'web/components/needs space/bar.test.tsx',
    ])
    expect(decodeSelectedFiles(encodeSelectedFiles([]))).toEqual([])
    expect(decodeSelectedFiles(encodeSelectedFiles(['web/foo.test.tsx']))).toEqual([
      'web/foo.test.tsx',
    ])
    expect(decodeSelectedFiles(encodeSelectedFiles(SPACE_AND_GLOB_FILES))).toEqual(
      SPACE_AND_GLOB_FILES,
    )
    expect(decodeSelectedFiles(encodeSelectedFiles(['NO_TESTS_MATCHING_SELECTION']))).toEqual([
      'NO_TESTS_MATCHING_SELECTION',
    ])
  })
})

describe('formatMultilineOutput', () => {
  it('formats empty and multi-line values as heredoc records', () => {
    const record = formatMultilineOutput('files-test-web', '', () => '11111111-aaaa-4bbb-8ccc-1111')
    expect(record).toBe(
      'files-test-web<<FILES_TEST_WEB_11111111_AAAA_4BBB_8CCC_1111\nFILES_TEST_WEB_11111111_AAAA_4BBB_8CCC_1111\n',
    )
    expect(parseGithubOutput(record)).toEqual({ 'files-test-web': '' })

    const value = encodeSelectedFiles(SPACE_AND_GLOB_FILES)
    const multi = formatMultilineOutput('files', value, () => '22222222-dddd-4eee-8fff-2222')
    expect(parseGithubOutput(multi)).toEqual({ files: value })
    expect(decodeSelectedFiles(parseGithubOutput(multi).files)).toEqual(SPACE_AND_GLOB_FILES)
  })

  it('throws after ten delimiter collisions', () => {
    const colliding = 'FILES_TEST_11111111_AAAA_4BBB_8CCC_1111'
    expect(() =>
      formatMultilineOutput('files-test', colliding, () => '11111111-aaaa-4bbb-8ccc-1111'),
    ).toThrow(/after 10 attempts/)
  })
})

describe('writeSelectedFilesOutput', () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  function withGithubOutput<T>(run: (githubOutputPath: string) => T): T {
    const directory = mkdtempSync(join(tmpdir(), 'selected-files-output-'))
    temporaryDirectories.push(directory)
    const githubOutputPath = join(directory, 'github-output')
    writeFileSync(githubOutputPath, '')
    const previous = process.env.GITHUB_OUTPUT
    process.env.GITHUB_OUTPUT = githubOutputPath
    try {
      return run(githubOutputPath)
    } finally {
      if (previous === undefined) delete process.env.GITHUB_OUTPUT
      else process.env.GITHUB_OUTPUT = previous
    }
  }

  it('appends heredoc records for lists and empty selections', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    withGithubOutput((githubOutputPath) => {
      writeSelectedFilesOutput('files-test-web', SPACE_AND_GLOB_FILES, () => 'abcd')
      writeSelectedFilesOutput('files-test-unit', [], () => 'efgh')
      writeSelectedFilesOutput('files-test-unit-one', ['src/one.test.mts'], () => 'ijkl')
      const parsed = parseGithubOutput(readFileSync(githubOutputPath, 'utf8'))
      expect(decodeSelectedFiles(parsed['files-test-web'])).toEqual(SPACE_AND_GLOB_FILES)
      expect(parsed).toHaveProperty('files-test-unit', '')
      expect(decodeSelectedFiles(parsed['files-test-unit-one'])).toEqual(['src/one.test.mts'])
    })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('does not throw when GITHUB_OUTPUT is unset', () => {
    const previous = process.env.GITHUB_OUTPUT
    delete process.env.GITHUB_OUTPUT
    try {
      expect(() => writeSelectedFilesOutput('files-test-web', ['web/foo.test.tsx'])).not.toThrow()
    } finally {
      if (previous !== undefined) process.env.GITHUB_OUTPUT = previous
    }
  })

  it('uses the default UUID factory when writing a heredoc record', () => {
    withGithubOutput((githubOutputPath) => {
      writeSelectedFilesOutput('files', ['src/a.test.mts'])
      const parsed = parseGithubOutput(readFileSync(githubOutputPath, 'utf8'))
      expect(decodeSelectedFiles(parsed.files)).toEqual(['src/a.test.mts'])
    })
  })
})
