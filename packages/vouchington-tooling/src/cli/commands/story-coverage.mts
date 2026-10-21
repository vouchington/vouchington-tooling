import { readFile } from 'node:fs/promises'
import { checkStoryCoverage } from '../../story-coverage/index.mts'
import type { ParsedStoryCoverage } from '../parse-story-coverage.mts'

export async function runStoryCoverage(parsed: ParsedStoryCoverage): Promise<number> {
  let marker: RegExp
  let storyFilePattern: RegExp
  let exclusions: Record<string, unknown>
  try {
    marker = compile(parsed.marker, '--marker')
    storyFilePattern = compile(parsed.storyPattern, '--story-pattern')
    exclusions = parsed.exclusionsFile ? await readExclusions(parsed.exclusionsFile) : {}
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`)
    return 2
  }
  const report = await checkStoryCoverage({
    root: parsed.root,
    componentRoot: parsed.componentRoot,
    storyRoot: parsed.storyRoot,
    aliases: parsed.aliases,
    sourceExtensions: parsed.sourceExtensions,
    componentExtensions: parsed.componentExtensions,
    marker,
    storyFilePattern,
    exclusions,
    ...(parsed.exclusionsLabel === undefined ? {} : { exclusionsLabel: parsed.exclusionsLabel }),
  })
  for (const message of report.messages) process.stderr.write(`${message}\n`)
  if (!report.ok) {
    process.stderr.write('Component story coverage check failed\n')
    return 1
  }
  return 0
}

function compile(source: string, flag: string): RegExp {
  try {
    return new RegExp(source)
  } catch {
    throw new Error(`story-coverage ${flag} is not a valid regular expression`)
  }
}

async function readExclusions(file: string): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    throw new Error(`story-coverage could not read exclusions: ${file}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('story-coverage exclusions must be a JSON object')
  }
  return parsed as Record<string, unknown>
}
