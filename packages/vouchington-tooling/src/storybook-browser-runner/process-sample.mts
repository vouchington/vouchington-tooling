import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

import type { StorybookBrowserRunnerDeps } from './types.mts'

/** Upper bound on the rendered sample, so a huge process tree cannot flood the log. */
export const MAX_SAMPLE_BYTES = 4096

const PS_TIMEOUT_MS = 2000
const PS_MAX_BUFFER_BYTES = 8 * 1024 * 1024
const RESERVED_TRAILER_BYTES = 80
const psRowPattern = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\S+)\s*(.*)$/
const chromiumTypePattern = /(?:^|\s)--type=([\w.-]+)/
const chromiumBinaryPattern =
  /^(?:chrome|chromium|chromium-browser|headless_shell|chrome-headless-shell|google chrome.*|chromium.*)$/i

type ProcessRow = { args: string; cpu: string; pid: number; rssKb: number; stat: string }

type Exec = (
  file: string,
  args: string[],
  options: { encoding: 'utf8'; maxBuffer: number; timeout: number },
) => string

/** Parses `ps -ax -o pid=,pgid=,rss=,pcpu=,stat=,args=` output, keeping only one process group. */
export function parseProcessGroupRows(psOutput: string, processGroupId: number): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of psOutput.split('\n')) {
    const match = psRowPattern.exec(line)
    if (!match || Number(match[2]) !== processGroupId) continue
    rows.push({
      args: match[6]!,
      cpu: match[4]!,
      pid: Number(match[1]),
      rssKb: Number(match[3]),
      stat: match[5]!,
    })
  }
  return rows
}

/** Chromium's `--type=<x>`, `browser` for a main Chromium binary, else the executable name. */
export function processRole(args: string): string {
  const type = chromiumTypePattern.exec(args)?.[1]
  if (type) return type
  const executable = basename(args.split(' --')[0]!.trim())
  if (chromiumBinaryPattern.test(executable)) return 'browser'
  return basename(args.trim().split(/\s+/)[0]!).replace(/[^\w.()-]/g, '') || 'unknown'
}

const megabytes = (kb: number) => (kb / 1024).toFixed(1)

/** One line per process (largest first): never argv, capped at MAX_SAMPLE_BYTES. */
export function renderProcessGroupSample(psOutput: string, processGroupId: number): string {
  const rows = parseProcessGroupRows(psOutput, processGroupId).sort((a, b) => b.rssKb - a.rssKb)
  const totalKb = rows.reduce((sum, row) => sum + row.rssKb, 0)
  let out = `  processes=${rows.length} totalRssMB=${megabytes(totalKb)}\n`
  let rendered = 0
  for (const row of rows) {
    const line = `  pid=${row.pid} rssMB=${megabytes(row.rssKb)} cpu=${row.cpu}% stat=${row.stat} role=${processRole(row.args)}\n`
    if (Buffer.byteLength(out + line) > MAX_SAMPLE_BYTES - RESERVED_TRAILER_BYTES) break
    out += line
    rendered += 1
  }
  if (rendered < rows.length) out += `  ... ${rows.length - rendered} more processes omitted\n`
  return out
}

/** Default sampler: portable `ps -ax` filtered by pgid (never `ps -g`). */
export function samplePsProcessGroup(
  processGroupId: number,
  exec: Exec = execFileSync as unknown as Exec,
): string {
  const output = exec('ps', ['-ax', '-o', 'pid=,pgid=,rss=,pcpu=,stat=,args='], {
    encoding: 'utf8',
    maxBuffer: PS_MAX_BUFFER_BYTES,
    timeout: PS_TIMEOUT_MS,
  })
  return renderProcessGroupSample(output, processGroupId)
}

/** Best effort: writes the sample, or one line naming why it failed, and never throws. */
export function writeProcessGroupSample(
  deps: Pick<StorybookBrowserRunnerDeps, 'sampleProcessGroup' | 'stderr'>,
  processGroupId: number | undefined,
): void {
  if (processGroupId == null) return
  try {
    const sample = deps.sampleProcessGroup(processGroupId)
    deps.stderr.write(`[storybook-browser] process group ${processGroupId} at stall:\n${sample}`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    deps.stderr.write(
      `[storybook-browser] process group ${processGroupId} sample failed: ${reason.slice(0, 200)}\n`,
    )
  }
}
