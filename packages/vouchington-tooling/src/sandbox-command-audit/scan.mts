import { tmpdir } from 'node:os'
import { openTranscriptLines } from '../retrospective-transcript/index.mts'
import { createClaudeRecordExtractor, type ClaudeExtraction } from './claude-extract.mts'
import { scanCodexFile, type CodexFileResult } from './codex-scan.mts'
import { discoverTranscriptFiles, type DiscoverOptions } from './discover-files.mts'
import { appendBounded, resolveLimits, type AuditLimits, type RawRetention } from './limits.mts'
import { emptyScanResult, type ScanResult, type ScanRules } from './types.mts'

export type ScanOptions = DiscoverOptions & ScanRules & { tempRoot?: string }

type ClaudeFileResult = ClaudeExtraction | { error: string }

async function scanClaudeFile(
  file: string,
  options: { classifyFailure: ScanRules['classifyFailure']; limits: AuditLimits },
): Promise<ClaudeFileResult> {
  const opened = await openTranscriptLines(file)
  if ('error' in opened) return { error: opened.error }
  const extractor = createClaudeRecordExtractor(options)
  try {
    for await (const line of opened.lines) extractor.pushLine(line)
    return extractor.result()
  } catch (err) {
    return { error: (err as Error).message }
  }
}

function mergeRetention(target: RawRetention, source: RawRetention): void {
  target.commandTextsTruncated += source.commandTextsTruncated
  target.errorTextsTruncated += source.errorTextsTruncated
  target.pendingToolUsesDropped += source.pendingToolUsesDropped
  target.pendingToolUseBytesDropped += source.pendingToolUseBytesDropped
  target.recordsDropped += source.recordsDropped
  target.rawBytesDropped += source.rawBytesDropped
}

/**
 * Discovers transcripts and folds their records into one bounded `ScanResult`. Files are read
 * one at a time so only one stream is ever open and each file's result arrays are released at once.
 */
export async function scanTranscripts(options: ScanOptions): Promise<ScanResult> {
  const limits = resolveLimits(options.limits)
  const { classifyFailure } = options
  const discovered = await discoverTranscriptFiles(options)
  const result = emptyScanResult()
  result.repoRoots = options.repoRoots
  result.skippedOtherRepo = discovered.skippedOtherRepo
  result.skippedUnknownCwd = discovered.skippedUnknownCwd
  const keep = <T,>(records: T[], record: T): void =>
    appendBounded(records, record, result.rawRetention, limits)
  const readError = (file: string, error: string): void =>
    keep(result.readErrors, `${file}: ${error}`)
  for (const file of discovered.claudeFiles) {
    // oxlint-disable-next-line no-await-in-loop
    const scanned = await scanClaudeFile(file, { classifyFailure, limits })
    if ('error' in scanned) {
      readError(file, scanned.error)
      continue
    }
    result.claudeFilesScanned++
    mergeRetention(result.rawRetention, scanned.rawRetention)
    for (const record of scanned.escalations) keep(result.claudeEscalations, record)
    for (const record of scanned.denials) keep(result.claudeDenials, record)
    for (const record of scanned.sandboxFailures) keep(result.claudeSandboxFailures, record)
  }
  const tempRoot = options.tempRoot ?? tmpdir()
  // Codex output is only classified by the caller's rule, so without one the files are not read.
  const codexFiles = classifyFailure === undefined ? [] : discovered.codexFiles
  for (const file of codexFiles) {
    // oxlint-disable-next-line no-await-in-loop
    const scanned: CodexFileResult = await scanCodexFile(file, tempRoot, {
      classifyFailure,
      limits,
    })
    if ('error' in scanned) {
      readError(file, scanned.error)
      continue
    }
    result.codexFilesScanned++
    mergeRetention(result.rawRetention, scanned.rawRetention)
    for (const record of scanned.sandboxFailures) keep(result.codexSandboxFailures, record)
  }
  return result
}
