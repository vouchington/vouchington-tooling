import { checkFreshBase } from '../../fresh-base/index.mts'

/** Prints the JSON report (nothing outside a Git repository). Exits 0 whenever a report is made. */
export function runFreshBase(options: {
  remote?: string
  branch?: string
  skipFetch: boolean
}): number {
  try {
    const report = checkFreshBase(options)
    if (report !== null) process.stdout.write(`${JSON.stringify(report)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
