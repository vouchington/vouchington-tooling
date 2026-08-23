import {
  normalizeFilename,
  propertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
} from './ast-helpers.mts'
import {
  isNamedImport,
  isNamespaceImport,
  requiredModuleSpecifier,
} from './factory-owner-require.mts'
import {
  matchesFileGlobs,
  resolveFileMatchOptions,
  stringArray,
  type FileMatchOptions,
} from './file-match.mts'

export type FactoryOwnerOptions = FileMatchOptions & {
  modules: ReadonlySet<string>
  factories: ReadonlySet<string>
  owners: readonly string[]
}

export function resolveFactoryOwnerOptions(raw: unknown): FactoryOwnerOptions | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const modules = stringArray(record.modules)
  const factories = stringArray(record.factories)
  const owners = stringArray(record.owners)
  if (!modules?.length || !factories?.length || !owners?.length) return null
  const files = resolveFileMatchOptions(record)
  if (!files) return null
  return {
    modules: new Set(modules),
    factories: new Set(factories),
    owners: owners.map((file) => file.replace(/^(?:\.\/)+/, '')),
    ...files,
  }
}

function isOwnerFile(context: RuleContextLike, options: FactoryOwnerOptions): boolean {
  const filename = normalizeFilename(context).replace(/^(?:\.\/)+/, '')
  return options.owners.includes(filename)
}

function isFactoryCallee(
  context: RuleContextLike,
  node: NodeLike | null | undefined,
  options: FactoryOwnerOptions,
): boolean {
  const value = unwrap(node)
  if (value?.type === 'Identifier') {
    return [...options.factories].some(
      (name) => value.name === name && isNamedImport(context, value, options.modules, name),
    )
  }
  if (value?.type !== 'MemberExpression') return false
  const name = propertyName(value)
  if (typeof name !== 'string' || !options.factories.has(name)) return false
  if (isNamespaceImport(context, value.object as NodeLike, options.modules)) return true
  const required = requiredModuleSpecifier(context, value.object as NodeLike)
  return required !== null && options.modules.has(required)
}

export function createFactoryOwnerLocationRule() {
  return {
    meta: {
      type: 'problem' as const,
      docs: { description: 'keep configured factories in their owner files' },
      schema: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            modules: { type: 'array', items: { type: 'string' } },
            factories: { type: 'array', items: { type: 'string' } },
            owners: { type: 'array', items: { type: 'string' } },
            include: { type: 'array', items: { type: 'string' } },
            exclude: { type: 'array', items: { type: 'string' } },
            includeFiles: { type: 'array', items: { type: 'string' } },
          },
        },
      ],
      messages: {
        constructionOwner: 'Construct this factory only in a configured owner file.',
      },
    },
    create(context: RuleContextLike) {
      const options = resolveFactoryOwnerOptions(context.options[0])
      if (!options || !matchesFileGlobs(context, options) || isOwnerFile(context, options)) {
        return {}
      }
      return {
        CallExpression(node: NodeLike) {
          if (isFactoryCallee(context, node.callee as NodeLike, options)) {
            context.report({ node, messageId: 'constructionOwner' })
          }
        },
      }
    },
  }
}
