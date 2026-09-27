import { readJson } from './format.mts'
import type { CommandResult } from './shared.mts'

export type RetrospectiveFactsReport = {
  markdown: string
  coverage: 'complete' | 'partial' | 'unavailable'
}
export function completeCommandFacts(
  command: string,
  args: string[],
  result: CommandResult,
): boolean {
  if (command === 'git' && args[0] === 'merge-base' && args[1] === '--is-ancestor')
    return result.ok || result.exitCode === 1
  if (!result.ok) return false
  if (command !== 'gh') {
    if (args[0] === 'branch') return Boolean(result.stdout.trim())
    if (args[0] === 'rev-list') return /^\d+$/.test(result.stdout.trim())
    return true
  }
  const data = readJson(result.stdout)
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  if (
    !Number.isInteger(data.number) ||
    Number(data.number) < 1 ||
    typeof data.state !== 'string' ||
    !['OPEN', 'CLOSED', 'MERGED'].includes(data.state) ||
    typeof data.headRefName !== 'string' ||
    !data.headRefName ||
    typeof data.baseRefName !== 'string' ||
    !data.baseRefName ||
    !Number.isInteger(data.changedFiles) ||
    Number(data.changedFiles) < 0 ||
    !Array.isArray(data.files) ||
    data.files.length !== data.changedFiles ||
    !data.files.every(
      (file) => file && typeof file === 'object' && typeof file.path === 'string' && file.path,
    ) ||
    !Array.isArray(data.commits) ||
    data.commits.length >= 100
  )
    return false
  if (data.state === 'MERGED')
    return (
      typeof data.mergedAt === 'string' &&
      Boolean(data.mergedAt) &&
      Boolean(
        data.mergeCommit &&
        typeof data.mergeCommit === 'object' &&
        'oid' in data.mergeCommit &&
        typeof data.mergeCommit.oid === 'string' &&
        data.mergeCommit.oid,
      )
    )
  return true
}
