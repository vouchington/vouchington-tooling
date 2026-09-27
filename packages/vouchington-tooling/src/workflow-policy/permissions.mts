import { parse as load } from 'yaml'

export type Workflow = {
  permissions?: unknown
  on?: unknown
  jobs?: Record<string, Job>
}

type Job = {
  uses?: string
  permissions?: unknown
}

export function parseWorkflow(source: string): Workflow {
  return load(source) as Workflow
}

export function parsePermissions(
  perms: unknown,
): Map<string, string> | 'read-all' | 'write-all' | null {
  if (perms == null) return null
  if (perms === 'read-all') return 'read-all'
  if (perms === 'write-all') return 'write-all'
  if (typeof perms === 'object' && !Array.isArray(perms)) {
    return new Map(Object.entries(perms as Record<string, string>))
  }
  return null
}

const PERM_LEVEL: Record<string, number> = { none: 0, read: 1, write: 2 }
const READ_ALL_PERMISSIONS = [
  'actions',
  'attestations',
  'checks',
  'contents',
  'deployments',
  'discussions',
  'issues',
  'models',
  'packages',
  'pages',
  'pull-requests',
  'repository-projects',
  'security-events',
  'statuses',
] as const

function expandReadAllPermissions(): Map<string, string> {
  return new Map(READ_ALL_PERMISSIONS.map((permission) => [permission, 'read']))
}

export function permissionsToMap(
  permissions: Map<string, string> | 'read-all' | null,
): Map<string, string> | null {
  if (permissions === 'read-all') return expandReadAllPermissions()
  return permissions
}

function unionPermissions(
  left: Map<string, string> | 'read-all' | 'write-all' | null,
  right: Map<string, string> | 'read-all' | 'write-all' | null,
): Map<string, string> | 'read-all' | 'write-all' | null {
  if (left === 'write-all' || right === 'write-all') return 'write-all'
  if (left === 'read-all' && right === 'read-all') return 'read-all'

  const leftMap = permissionsToMap(left)
  const rightMap = permissionsToMap(right)
  if (leftMap == null) return rightMap
  if (rightMap == null) return leftMap

  const result = new Map(leftMap)
  for (const [perm, level] of rightMap) {
    const current = result.get(perm)
    if ((PERM_LEVEL[level] ?? 0) > (PERM_LEVEL[current ?? 'none'] ?? 0)) {
      result.set(perm, level)
    }
  }
  return result
}

export function requiredWorkflowPermissions(
  workflow: Workflow,
): Map<string, string> | 'read-all' | 'write-all' | null {
  const topLevelPerms = parsePermissions(workflow.permissions)
  let requiredPerms: Map<string, string> | 'read-all' | 'write-all' | null = topLevelPerms

  for (const job of Object.values(workflow.jobs ?? {})) {
    requiredPerms = unionPermissions(requiredPerms, parsePermissions(job.permissions))
  }

  return requiredPerms
}

function isPureReusableWorkflow(workflow: Workflow): boolean {
  const on = workflow.on as Record<string, unknown> | string | null | undefined
  return Boolean(
    on && typeof on === 'object' && 'workflow_call' in on && Object.keys(on).length === 1,
  )
}

export function missingTopLevelPermissionPaths(
  workflows: Readonly<Record<string, Workflow>>,
): string[] {
  const missing: string[] = []
  for (const [path, workflow] of Object.entries(workflows)) {
    if (isPureReusableWorkflow(workflow)) continue
    if (!('permissions' in workflow)) missing.push(path)
  }
  return missing
}
