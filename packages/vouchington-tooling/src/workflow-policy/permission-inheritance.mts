import type { Workflow } from './permissions.mts'
import {
  isPlainRecord,
  isValidDeclaration,
  isValidPermissionMap,
  mergePermissionMaps,
  permissionMap,
  PERMISSION_LEVEL_RANK,
  type BoundedPermissionDeclaration,
  type PermissionLevel,
} from './permission-declarations.mts'

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
    return PERMISSION_LEVEL_RANK[callerLevel] >= PERMISSION_LEVEL_RANK[level]
  })
  const hasCallerInheritance =
    !topLevelPresent && calleeJobs.some(([, job]) => !Object.hasOwn(job, 'permissions'))
  const permissionsMatch =
    JSON.stringify(sortedEntries(callerMap)) === JSON.stringify(sortedEntries(calleeMap))
  if (calleeFitsCaller && (hasCallerInheritance || permissionsMatch)) return []

  return [prefix(`caller grants ${formatMap(callerMap)}, callee requires ${formatMap(calleeMap)}`)]
}
