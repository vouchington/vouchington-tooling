const FORBIDDEN_EVENT = 'pull_request_target'

function triggerNames(on: unknown): string[] {
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on.filter((event): event is string => typeof event === 'string')
  if (on && typeof on === 'object') return Object.keys(on)
  return []
}

export function checkNoPullRequestTargetDocument(
  file: string,
  document: unknown,
  errors: string[],
): void {
  if (!document || typeof document !== 'object') return
  if (!triggerNames((document as Record<string, unknown>).on).includes(FORBIDDEN_EVENT)) return
  errors.push(
    `::error file=${file}::${file}: triggers on ${FORBIDDEN_EVENT}. It runs with a write token ` +
      'and secrets in the base repository for pull requests from forks, and GitHub no longer ' +
      'allows it by default. Trigger on pull_request instead.',
  )
}
