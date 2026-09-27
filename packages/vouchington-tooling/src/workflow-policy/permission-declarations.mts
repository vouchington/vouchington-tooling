export const PERMISSION_LEVEL_RANK = { none: 0, read: 1, write: 2 } as const
export type PermissionLevel = keyof typeof PERMISSION_LEVEL_RANK
type PermissionMap = Record<string, PermissionLevel>
export type BoundedPermissionDeclaration = PermissionMap | 'read-all'

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

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function isValidPermissionMap(value: unknown): value is PermissionMap {
  if (!isPlainRecord(value)) return false
  return Object.entries(value).every(([scope, level]) => {
    const allowed = Object.hasOwn(LEVELS_BY_SCOPE, scope)
      ? (LEVELS_BY_SCOPE[scope as keyof typeof LEVELS_BY_SCOPE] as readonly PermissionLevel[])
      : undefined
    return typeof level === 'string' && allowed?.includes(level as PermissionLevel) === true
  })
}

export function isValidDeclaration(value: unknown): value is BoundedPermissionDeclaration {
  return value === 'read-all' || isValidPermissionMap(value)
}

export function permissionMap(value: BoundedPermissionDeclaration): Map<string, PermissionLevel> {
  if (value === 'read-all') {
    return new Map(
      Object.entries(LEVELS_BY_SCOPE)
        .filter(([, levels]) => (levels as readonly PermissionLevel[]).includes('read'))
        .map(([scope]) => [scope, 'read'] as const),
    )
  }
  return new Map(Object.entries(value).filter(([, level]) => level !== 'none'))
}

export function mergePermissionMaps(
  target: Map<string, PermissionLevel>,
  source: Map<string, PermissionLevel>,
): void {
  for (const [scope, level] of source) {
    const current = target.get(scope) ?? 'none'
    if (PERMISSION_LEVEL_RANK[level] > PERMISSION_LEVEL_RANK[current]) target.set(scope, level)
  }
}
