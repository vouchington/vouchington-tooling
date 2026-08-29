export function format(f: Record<string, string | undefined>, raw: string): string {
  const scoped = f.scoped ? `n/a (scoped to ${f.scoped})` : undefined
  return `=== Retrospective Facts ===\nFetch: ${f.fetch}\nFetch status: ${f.fetchStatus}\nFetch note: ${f.fetchNote}\nBranch: ${f.branch}\nPR: ${f.pr ?? 'unavailable'}\nPR state: ${f.state}\nPR merged at: ${f.mergedAt ?? 'unavailable'}\nPR merge commit: ${f.mergeCommit ?? 'unavailable'}\nMerged to main: ${f.merged}\nCommits ahead of origin/main: ${f.commits}\nRemote updates for origin/${f.branch}: ${f.remote ?? scoped ?? 'unavailable'}\nPush-like updates for origin/${f.branch}: ${f.pushes ?? scoped ?? 'unavailable'}\nFiles changed from origin/main: ${f.files}\nTop-level dirs changed: ${f.dirs}\nWorking tree changes: ${scoped ?? f.working ?? 'unavailable'}\n${raw}`
}
export function readJson(value: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return undefined
  }
}
export function stringField(
  value: Record<string, unknown> | undefined,
  key: string,
  fallback = 'unavailable',
): string {
  const field = value?.[key]
  return typeof field === 'string' || typeof field === 'number' ? String(field) : fallback
}
export function objectField(
  value: Record<string, unknown> | undefined,
  key: string,
  child: string,
): string | undefined {
  const field = value?.[key]
  return field && typeof field === 'object'
    ? stringField(field as Record<string, unknown>, child)
    : undefined
}
export function count(value: Record<string, unknown> | undefined, key: string): string {
  const length = listLength(value, key)
  if (length === undefined) return 'unavailable'
  return length >= 100
    ? "100+ (gh's commits list caps at 100; actual count may be higher)"
    : String(length)
}

function listLength(value: Record<string, unknown> | undefined, key: string): number | undefined {
  return Array.isArray(value?.[key]) ? value[key].length : undefined
}
export function topDirs(files: string): string {
  const dirs = [
    ...new Set(
      files
        .split('\n')
        .filter(Boolean)
        .map((file) => (file.includes('/') ? file.split('/')[0]! : 'root')),
    ),
  ]
  return dirs.length ? dirs.sort().join(',') : 'none'
}
export function dirs(value: Record<string, unknown> | undefined): string {
  const files = value?.files
  if (!Array.isArray(files)) return 'unavailable'
  const result = topDirs(
    files
      .map((file) =>
        typeof file === 'object' && file
          ? stringField(file as Record<string, unknown>, 'path', '')
          : '',
      )
      .join('\n'),
  )
  const total = stringField(value, 'changedFiles')
  return total !== 'unavailable' && Number(total) > files.length
    ? `${result} (partial: gh returned ${files.length} of ${total} changed files)`
    : result
}
export function apiFiles(value: Record<string, unknown> | undefined): string {
  const total = stringField(value, 'changedFiles')
  const listed = listLength(value, 'files')
  return total !== 'unavailable' && listed !== undefined && Number(total) !== listed
    ? `${total} (partial: gh returned ${listed} of ${total} changed files)`
    : total
}
