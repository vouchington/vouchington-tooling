import type { Workflow } from './permissions.mts'

const LEVEL_RANK = { none: 0, read: 1, write: 2 } as const
type PermissionLevel = keyof typeof LEVEL_RANK
type PermissionMap = Record<string, PermissionLevel>
type BoundedPermissionDeclaration = PermissionMap | 'read-all'

const LEVELS_BY_SCOPE = {
  actions: ['none', 'read', 'write'],
  'artifact-metadata': ['none', 'read', 'write'],
  attestations: ['none', 'read', 'write'],
  checks: ['none', 'read', 'write'],
  'code-quality': ['none', 'read', 'write'],
  contents: ['none', 'read', 'write'],
  deployments: ['none', 'read', 'write'],
  discussions: ['none', 'read', 'write'],
  'id-token': ['none', 'write'],
  issues: ['none', 'read', 'write'],
  models: ['none', 'read'],
  packages: ['none', 'read', 'write'],
  pages: ['none', 'read', 'write'],
  'pull-requests': ['none', 'read', 'write'],
  'repository-projects': ['none', 'read', 'write'],
  'security-events': ['none', 'read', 'write'],
  statuses: ['none', 'read', 'write'],
  'vulnerability-alerts': ['none', 'read'],
} as const satisfies Record<string, readonly PermissionLevel[]>

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isValidPermissionMap(value: unknown): value is PermissionMap {
  if (!isPlainRecord(value)) return false
  return Object.entries(value).every(([scope, level]) => {
    const allowed = Object.hasOwn(LEVELS_BY_SCOPE, scope)
      ? (LEVELS_BY_SCOPE[scope as keyof typeof LEVELS_BY_SCOPE] as readonly PermissionLevel[])
      : undefined
    return typeof level === 'string' && allowed?.includes(level as PermissionLevel) === true
  })
}

function isValidDeclaration(value: unknown): value is BoundedPermissionDeclaration {
  return value === 'read-all' || isValidPermissionMap(value)
}

function permissionMap(value: BoundedPermissionDeclaration): Map<string, PermissionLevel> {
  if (value === 'read-all') {
    return new Map(
      Object.entries(LEVELS_BY_SCOPE)
        .filter(([, levels]) => (levels as readonly PermissionLevel[]).includes('read'))
        .map(([scope]) => [scope, 'read'] as const),
    )
  }
  return new Map(Object.entries(value).filter(([, level]) => level !== 'none'))
}

function mergePermissionMaps(
  target: Map<string, PermissionLevel>,
  source: Map<string, PermissionLevel>,
): void {
  for (const [scope, level] of source) {
    const current = target.get(scope) ?? 'none'
    if (LEVEL_RANK[level] > LEVEL_RANK[current]) target.set(scope, level)
  }
}

function sortedEntries(value: Map<string, PermissionLevel>): [string, PermissionLevel][] {
  return [...value].toSorted(([left], [right]) => left.localeCompare(right))
}

function formatMap(value: Map<string, PermissionLevel>): string {
  return JSON.stringify(Object.fromEntries(sortedEntries(value)))
}

function diagnostic(callerPath: string, callerJobKey: string, calleePath: string, detail: string) {
  return `  ${callerPath} job "${callerJobKey}" → ${calleePath}: ${detail}`
}

export function inheritanceAwarePermissionMismatches(args: {
  callerPath: string
  callerJobKey: string
  callerWorkflow: Workflow
  calleePath: string
  calleeWorkflow: Workflow
}): string[] {
  const prefix = (detail: string) =>
    diagnostic(args.callerPath, args.callerJobKey, args.calleePath, detail)
  const callerJob = args.callerWorkflow.jobs?.[args.callerJobKey]
  const callerPermissions = callerJob?.permissions
  if (callerPermissions === 'write-all') return [prefix('caller grants write-all')]
  if (
    callerJob == null ||
    !Object.hasOwn(callerJob, 'permissions') ||
    !isValidPermissionMap(callerPermissions)
  ) {
    return [prefix('caller permissions must be an explicit map')]
  }

  const jobsPresent = Object.hasOwn(args.calleeWorkflow, 'jobs')
  const jobsValue: unknown = args.calleeWorkflow.jobs
  if (jobsPresent && !isPlainRecord(jobsValue)) return [prefix('callee jobs are invalid')]
  const calleeJobEntries = Object.entries(isPlainRecord(jobsValue) ? jobsValue : {})
  const invalidJobKeys: string[] = []
  const calleeJobs: [string, Record<string, unknown>][] = []
  for (const [key, job] of calleeJobEntries) {
    if (isPlainRecord(job)) calleeJobs.push([key, job])
    else invalidJobKeys.push(key)
  }
  if (invalidJobKeys.length > 0) {
    return invalidJobKeys.map((key) => prefix(`callee job "${key}" is invalid`))
  }
  const topLevelPresent = Object.hasOwn(args.calleeWorkflow, 'permissions')
  const topLevelPermissions = args.calleeWorkflow.permissions
  let validatedTopLevelPermissions: BoundedPermissionDeclaration | undefined
  if (topLevelPresent) {
    if (topLevelPermissions === 'write-all') return [prefix('callee requires write-all')]
    if (!isValidDeclaration(topLevelPermissions)) {
      return [prefix('callee top-level permissions are invalid')]
    }
    validatedTopLevelPermissions = topLevelPermissions
  }
  if (calleeJobs.length === 0) return [prefix('callee must declare at least one job')]

  const invalidJobs: string[] = []
  const validatedJobPermissions: BoundedPermissionDeclaration[] = []
  let requiresWriteAll = false
  for (const [key, job] of calleeJobs) {
    if (!Object.hasOwn(job, 'permissions')) continue
    if (job.permissions === 'write-all') {
      requiresWriteAll = true
    } else if (isValidDeclaration(job.permissions)) {
      validatedJobPermissions.push(job.permissions)
    } else {
      invalidJobs.push(prefix(`callee job "${key}" permissions are invalid`))
    }
  }
  if (invalidJobs.length > 0) return invalidJobs
  if (requiresWriteAll) return [prefix('callee requires write-all')]

  const callerMap = permissionMap(callerPermissions)
  const calleeMap = new Map<string, PermissionLevel>()
  if (validatedTopLevelPermissions !== undefined) {
    mergePermissionMaps(calleeMap, permissionMap(validatedTopLevelPermissions))
  }
  for (const permissions of validatedJobPermissions) {
    mergePermissionMaps(calleeMap, permissionMap(permissions))
  }

  const calleeFitsCaller = [...calleeMap].every(([scope, level]) => {
    const callerLevel = callerMap.get(scope) ?? 'none'
    return LEVEL_RANK[callerLevel] >= LEVEL_RANK[level]
  })
  const hasCallerInheritance =
    !topLevelPresent && calleeJobs.some(([, job]) => !Object.hasOwn(job, 'permissions'))
  const permissionsMatch =
    JSON.stringify(sortedEntries(callerMap)) === JSON.stringify(sortedEntries(calleeMap))
  if (calleeFitsCaller && (hasCallerInheritance || permissionsMatch)) return []

  return [prefix(`caller grants ${formatMap(callerMap)}, callee requires ${formatMap(calleeMap)}`)]
}
