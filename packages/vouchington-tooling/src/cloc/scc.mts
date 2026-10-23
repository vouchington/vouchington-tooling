import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { parse } from 'csv-parse/sync'
import { requireSuccess, terminateChild } from './child-process.mts'
import { normalizePath } from './patterns.mts'
import type { CountedFile } from './rows.mts'

function parseRecord(row: string): CountedFile {
  const records = parse(row) as string[][]
  const fields = records.length === 1 ? records[0] : undefined
  const path = fields?.[1]
  const code = Number(fields?.[4])
  if (!path || !fields?.[4]?.trim() || !Number.isSafeInteger(code)) {
    throw new Error('Invalid CSV record from scc')
  }
  return { code, path: normalizePath(path) }
}

export type SccRun = {
  sccBin: string
  targets: readonly string[]
  excludedDirs: readonly string[]
  cwd: string
  keep: (filePath: string) => boolean
}

/** Streams `scc --by-file` CSV and returns the rows `keep` accepts. */
export async function readSccFiles(run: SccRun): Promise<CountedFile[]> {
  const args = ['--format', 'csv-stream', '--by-file', '--no-cocomo', '--no-complexity']
  if (run.excludedDirs.length > 0) args.push('--exclude-dir', run.excludedDirs.join(','))
  const child = spawn(run.sccBin, [...args, ...run.targets], {
    cwd: run.cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const completion = requireSuccess(child, 'scc')
  // A spawn error (ENOENT) can reject before the stream loop reaches `await completion`.
  completion.catch(() => {})
  const files: CountedFile[] = []
  const rows = createInterface({ input: child.stdout, crlfDelay: Infinity })
  let header = true
  let completed = false
  try {
    for await (const row of rows) {
      if (header) {
        header = false
        continue
      }
      const file = parseRecord(row)
      if (run.keep(file.path)) files.push(file)
    }
    await completion
    completed = true
  } finally {
    rows.close()
    if (!completed) await terminateChild(child, completion)
  }
  return files
}
