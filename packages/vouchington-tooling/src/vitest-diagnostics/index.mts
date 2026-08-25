import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'

export const DEFAULT_MAX_DIAGNOSTIC_REPORTS = 100
export const DEFAULT_MAX_FORMATTED_DIAGNOSTIC_REPORTS = 20
export const HARD_MAX_DIAGNOSTIC_REPORTS = 100
export const MAX_DIAGNOSTIC_REPORT_BYTES = 5 * 1024 * 1024

export interface DiagnosticReportSummary {
  file: string
  trigger: string
  event: string
  threadId: number | null
  heapUsedMB: string
  heapTotalMB: string
  heapLimitMB: string
  maxRssMB: string
  topNativeFrameModule: string | null
}

export interface DiagnosticReportLimitOptions {
  maxReports?: number
}

const NATIVE_FRAME_MODULE_PATTERN = /\[([^\]]+)\]\s*$/
const TEXT_LIMIT = 200
const PATH_LIMIT = 240

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function boundedText(value: unknown, fallback: string, limit: number): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length === 0 ? fallback : normalized.slice(0, limit)
}

function formatMebibytes(value: unknown): string {
  const bytes = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
  return (bytes / 1024 / 1024).toFixed(1)
}

function threadId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function topNativeFrameModule(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  const symbol = objectValue(value[0]).symbol
  if (typeof symbol !== 'string') return null
  const module = NATIVE_FRAME_MODULE_PATTERN.exec(symbol)?.[1]
  if (module === undefined || (!posix.isAbsolute(module) && !win32.isAbsolute(module))) return null
  return boundedText(module, '', PATH_LIMIT)
}

function reportLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), 0), HARD_MAX_DIAGNOSTIC_REPORTS)
}

export function summarizeDiagnosticReport(file: string, report: unknown): DiagnosticReportSummary {
  const root = objectValue(report)
  const header = objectValue(root.header)
  const heap = objectValue(root.javascriptHeap)
  const resourceUsage = objectValue(root.resourceUsage)
  return {
    file: boundedText(file, 'unknown', PATH_LIMIT),
    trigger: boundedText(header.trigger, 'unknown', TEXT_LIMIT),
    event: boundedText(header.event, 'unknown', TEXT_LIMIT),
    threadId: threadId(header.threadId),
    heapUsedMB: formatMebibytes(heap.usedMemory),
    heapTotalMB: formatMebibytes(heap.totalMemory),
    heapLimitMB: formatMebibytes(heap.memoryLimit),
    maxRssMB: formatMebibytes(resourceUsage.maxRss),
    topNativeFrameModule: topNativeFrameModule(root.nativeStack),
  }
}

export function readDiagnosticReportSummaries(
  directory: string,
  options: DiagnosticReportLimitOptions = {},
): DiagnosticReportSummary[] {
  const maxReports = reportLimit(options.maxReports, DEFAULT_MAX_DIAGNOSTIC_REPORTS)
  if (maxReports === 0) return []

  let filenames: string[]
  try {
    filenames = readdirSync(directory)
      .filter((filename) => filename.endsWith('.json'))
      .sort()
  } catch {
    return []
  }

  const summaries: DiagnosticReportSummary[] = []
  for (const filename of filenames.slice(0, maxReports)) {
    try {
      if (statSync(join(directory, filename)).size > MAX_DIAGNOSTIC_REPORT_BYTES) continue
      const report: unknown = JSON.parse(readFileSync(join(directory, filename), 'utf8'))
      summaries.push(summarizeDiagnosticReport(filename, report))
    } catch {
      // Node can leave a partial report if the process exits while writing it.
    }
  }
  return summaries
}

export function formatDiagnosticReportSummaries(
  summaries: readonly DiagnosticReportSummary[],
  options: DiagnosticReportLimitOptions = {},
): string {
  const maxReports = reportLimit(options.maxReports, DEFAULT_MAX_FORMATTED_DIAGNOSTIC_REPORTS)
  const lines = ['[vitest-diagnostics]', `reports provided: ${summaries.length}`]
  if (summaries.length === 0) lines.push('  (none recorded)')
  for (const summary of summaries.slice(0, maxReports)) {
    lines.push(
      `  - file=${boundedText(summary.file, 'unknown', PATH_LIMIT)} ` +
        `trigger=${boundedText(summary.trigger, 'unknown', TEXT_LIMIT)} ` +
        `event=${boundedText(summary.event, 'unknown', TEXT_LIMIT)} ` +
        `threadId=${threadId(summary.threadId) ?? 'unknown'} ` +
        `heapUsedMB=${boundedText(summary.heapUsedMB, '0.0', TEXT_LIMIT)} ` +
        `heapTotalMB=${boundedText(summary.heapTotalMB, '0.0', TEXT_LIMIT)} ` +
        `heapLimitMB=${boundedText(summary.heapLimitMB, '0.0', TEXT_LIMIT)} ` +
        `maxRssMB=${boundedText(summary.maxRssMB, '0.0', TEXT_LIMIT)} ` +
        `topNativeFrameModule=${boundedText(summary.topNativeFrameModule, 'none', PATH_LIMIT)}`,
    )
  }
  if (summaries.length > maxReports) lines.push(`  ... ${summaries.length - maxReports} more`)
  return `${lines.join('\n')}\n`
}
