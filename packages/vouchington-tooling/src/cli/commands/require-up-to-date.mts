import { requireUpToDate } from '../../require-up-to-date/index.mts'

export function runRequireUpToDate(options: { remote: string; branch: string }): number {
  try {
    requireUpToDate(options)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
