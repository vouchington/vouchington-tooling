import {
  findVariable,
  propertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
} from './ast-helpers.mts'
import {
  matchesFileGlobs,
  resolveFileMatchOptions,
  stringArray,
  type FileMatchOptions,
} from './file-match.mts'

type SerialDrainOptions = FileMatchOptions & {
  functions: ReadonlySet<string>
  promiseMethods: ReadonlySet<string>
  iterationMethods: ReadonlySet<string>
}

export function resolveSerialDrainOptions(raw: unknown): SerialDrainOptions | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- Validate the unknown options record at the public rule boundary.
  const record = raw as Record<string, unknown>
  const functions = stringArray(record.functions)
  const promiseMethods = stringArray(record.promiseMethods ?? ['all', 'allSettled', 'any', 'race'])
  const iterationMethods = stringArray(record.iterationMethods ?? ['flatMap', 'forEach', 'map'])
  const files = resolveFileMatchOptions(record)
  if (!functions?.length || !promiseMethods?.length || !iterationMethods?.length || !files)
    return null
  return {
    functions: new Set(functions),
    promiseMethods: new Set(promiseMethods),
    iterationMethods: new Set(iterationMethods),
    ...files,
  }
}

function enclosingFunctionName(node: NodeLike): string | null {
  let current = node.parent
  while (current) {
    if (current.type === 'FunctionDeclaration') {
      const id = current.id as NodeLike | undefined
      return typeof id?.name === 'string' ? id.name : null
    }
    if (
      (current.type === 'ArrowFunctionExpression' || current.type === 'FunctionExpression') &&
      current.parent?.type === 'VariableDeclarator'
    ) {
      const id = current.parent.id as NodeLike | undefined
      if (id?.type === 'Identifier' && typeof id.name === 'string') return id.name
    }
    current = current.parent
  }
  return null
}

function unshadowedPromise(context: RuleContextLike, node: NodeLike | null | undefined): boolean {
  return (
    node?.type === 'Identifier' &&
    node.name === 'Promise' &&
    !findVariable(context, node)?.defs.length
  )
}

export function createSerialCursorDrainsRule() {
  return {
    meta: {
      type: 'problem' as const,
      docs: { description: 'keep configured cursor-draining functions serial' },
      schema: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            functions: { type: 'array', items: { type: 'string' } },
            promiseMethods: { type: 'array', items: { type: 'string' } },
            iterationMethods: { type: 'array', items: { type: 'string' } },
            include: { type: 'array', items: { type: 'string' } },
            exclude: { type: 'array', items: { type: 'string' } },
            includeFiles: { type: 'array', items: { type: 'string' } },
          },
        },
      ],
      messages: {
        serial:
          'Drain cursor streams serially so each database client is released before the next drain.',
      },
    },
    create(context: RuleContextLike) {
      const options = resolveSerialDrainOptions(context.options[0])
      if (!options || !matchesFileGlobs(context, options)) return {}
      return {
        CallExpression(node: NodeLike) {
          const callee = unwrap(node.callee as NodeLike | undefined)
          const method = propertyName(callee)
          const owner = enclosingFunctionName(node)
          if (
            callee?.type !== 'MemberExpression' ||
            typeof method !== 'string' ||
            !options.promiseMethods.has(method) ||
            !owner ||
            !options.functions.has(owner) ||
            !unshadowedPromise(context, unwrap(callee.object as NodeLike | undefined))
          )
            return
          const args = node.arguments as NodeLike[]
          const mapped = unwrap(args[0])
          const mappedCallee = unwrap(mapped?.callee as NodeLike | undefined)
          const iterator = propertyName(mappedCallee)
          if (
            mapped?.type === 'CallExpression' &&
            mappedCallee?.type === 'MemberExpression' &&
            typeof iterator === 'string' &&
            options.iterationMethods.has(iterator)
          ) {
            context.report({ messageId: 'serial', node })
          }
        },
      }
    },
  }
}
