import {
  memberIsRead,
  patternPropertyName,
  propertyName,
  type NodeLike,
  type RuleContextLike,
} from './ast-helpers.mts'
import {
  matchesFileGlobs,
  resolveFileMatchOptions,
  stringArray,
  type FileMatchOptions,
} from './file-match.mts'

export type BannedMemberOptions = FileMatchOptions & {
  members: ReadonlySet<string>
}

export function resolveBannedMemberOptions(raw: unknown): BannedMemberOptions | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- Preserve the validated unknown-to-record boundary for option parsing.
  const record = raw as Record<string, unknown>
  const members = stringArray(record.members)
  if (!members?.length) return null
  const files = resolveFileMatchOptions(record)
  if (!files) return null
  return { members: new Set(members), ...files }
}

export function createBannedMemberReadRule() {
  return {
    meta: {
      type: 'problem' as const,
      docs: { description: 'ban reads of configured object members' },
      schema: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            members: { type: 'array', items: { type: 'string' } },
            include: { type: 'array', items: { type: 'string' } },
            exclude: { type: 'array', items: { type: 'string' } },
            includeFiles: { type: 'array', items: { type: 'string' } },
          },
        },
      ],
      messages: {
        bannedRead: 'Do not read a banned member. Use an explicit replacement from the consumer.',
      },
    },
    create(context: RuleContextLike) {
      const options = resolveBannedMemberOptions(context.options[0])
      if (!options || !matchesFileGlobs(context, options)) return {}
      return {
        MemberExpression(node: NodeLike) {
          const name = propertyName(node)
          if (typeof name === 'string' && options.members.has(name) && memberIsRead(node)) {
            context.report({ node, messageId: 'bannedRead' })
          }
        },
        Property(node: NodeLike) {
          const name = patternPropertyName(node)
          if (
            typeof name === 'string' &&
            options.members.has(name) &&
            node.parent?.type === 'ObjectPattern'
          ) {
            context.report({ node, messageId: 'bannedRead' })
          }
        },
      }
    },
  }
}
