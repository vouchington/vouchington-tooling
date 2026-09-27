export type ConcurrencyScope =
  | 'fixed-resource'
  | 'pull-request'
  | 'ref'
  | 'sha'
  | 'run'
  | 'event'
  | 'input-resource'

export type NormalizedConcurrencyScope =
  | Exclude<ConcurrencyScope, 'fixed-resource'>
  | `unsupported:${string}`

const scopeOrder: Exclude<ConcurrencyScope, 'fixed-resource'>[] = [
  'pull-request',
  'ref',
  'sha',
  'run',
  'event',
  'input-resource',
]

const ignoredOwnerContexts = new Set(['github.workflow', 'github.run_attempt'])
const eventPayloadContexts = new Set([
  'github.event_name',
  'github.event.action',
  'github.event.label.name',
  'github.event.issue.number',
  'github.event.schedule',
  'github.event.workflow_run.event',
  'github.event.workflow_run.id',
  'github.event.workflow_run.workflow_id',
])

function classifyContext(reference: string): NormalizedConcurrencyScope | undefined {
  if (ignoredOwnerContexts.has(reference)) return undefined
  if (
    reference === 'github.event.pull_request.number' ||
    reference === 'github.event.workflow_run.pull_requests'
  )
    return 'pull-request'
  if (
    reference === 'github.event.pull_request.head.sha' ||
    reference === 'github.event.workflow_run.head_sha' ||
    reference === 'github.sha'
  )
    return 'sha'
  if (
    reference === 'github.ref' ||
    reference === 'github.ref_name' ||
    reference === 'github.event.workflow_run.head_branch'
  )
    return 'ref'
  if (reference === 'github.run_id') return 'run'
  if (
    reference.startsWith('inputs.') ||
    reference === 'github.event.inputs' ||
    reference.startsWith('github.event.inputs.')
  ) {
    return 'input-resource'
  }
  if (eventPayloadContexts.has(reference)) return 'event'
  return `unsupported:${reference}`
}

function sortScopes(scopes: Iterable<NormalizedConcurrencyScope>): NormalizedConcurrencyScope[] {
  return [...new Set(scopes)].toSorted((left, right) => {
    const leftIndex = scopeOrder.indexOf(left as (typeof scopeOrder)[number])
    const rightIndex = scopeOrder.indexOf(right as (typeof scopeOrder)[number])
    if (leftIndex === -1 || rightIndex === -1) {
      if (leftIndex === rightIndex) return left.localeCompare(right)
      return leftIndex === -1 ? 1 : -1
    }
    return leftIndex - rightIndex
  })
}

export function extractConcurrencyScopes(group: string): NormalizedConcurrencyScope[] {
  const references = group.match(/\b(?:github|inputs)(?:\.[A-Za-z_][\w-]*)+/gu) ?? []
  return sortScopes(references.flatMap((reference) => classifyContext(reference) ?? []))
}

export function normalizePolicyScopes(
  scopes: readonly ConcurrencyScope[],
): NormalizedConcurrencyScope[] {
  if (scopes.includes('fixed-resource')) {
    return scopes.length === 1 ? [] : ['unsupported:fixed-resource-combination']
  }
  return sortScopes(
    scopes.filter(
      (scope): scope is Exclude<ConcurrencyScope, 'fixed-resource'> => scope !== 'fixed-resource',
    ),
  )
}
