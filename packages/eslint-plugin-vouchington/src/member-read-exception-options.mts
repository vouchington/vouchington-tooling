export type MemberReadException = {
  file: string
  member: string
  module: string
  imported: string
  local: string
} & (
  | { kind: 'constructor-constant'; constant: { name: string; value: string } }
  | { kind: 'const-instance-prefix'; prefix: string }
)

export const MEMBER_EXCEPTION_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['file', 'member', 'module', 'imported', 'local', 'kind'],
    properties: {
      file: { type: 'string' },
      member: { type: 'string' },
      module: { type: 'string' },
      imported: { type: 'string' },
      local: { type: 'string' },
      kind: { enum: ['constructor-constant', 'const-instance-prefix'] },
      prefix: { type: 'string' },
      constant: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'value'],
        properties: { name: { type: 'string' }, value: { type: 'string' } },
      },
    },
    oneOf: [
      { properties: { kind: { const: 'constructor-constant' } }, required: ['constant'] },
      { properties: { kind: { const: 'const-instance-prefix' } }, required: ['prefix'] },
    ],
  },
}

export function resolveMemberReadExceptions(raw: unknown): MemberReadException[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  const resolved: MemberReadException[] = []
  for (const item of raw as unknown[]) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null
    // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- Validate each exception at the unknown-to-record boundary.
    const value = item as Record<string, unknown>
    const common = ['file', 'member', 'module', 'imported', 'local']
    if (common.some((key) => typeof value[key] !== 'string')) return null
    if (value.kind === 'constructor-constant') {
      if (
        value.constant === null ||
        typeof value.constant !== 'object' ||
        !('name' in value.constant) ||
        typeof value.constant.name !== 'string' ||
        !('value' in value.constant) ||
        typeof value.constant.value !== 'string'
      )
        return null
    } else if (value.kind !== 'const-instance-prefix' || typeof value.prefix !== 'string') {
      return null
    }
    resolved.push({
      ...value,
      file: (value.file as string).replace(/^(?:\.\/)+/, ''),
    } as MemberReadException)
  }
  return resolved
}
