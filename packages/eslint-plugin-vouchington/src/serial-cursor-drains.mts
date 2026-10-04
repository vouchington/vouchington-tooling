import {
  findVariable,
  patternPropertyName,
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
    if (current.type === 'ArrowFunctionExpression' || current.type === 'FunctionExpression') {
      if (current.parent?.type === 'VariableDeclarator') {
        const binding = current.parent.id as NodeLike | undefined
        if (binding?.type === 'Identifier') return binding.name as string
      }
      const id = current.id as NodeLike | undefined
      if (id?.type === 'Identifier') return id.name as string
      if (
        current.parent?.type === 'Property' ||
        current.parent?.type === 'MethodDefinition' ||
        current.parent?.type === 'PropertyDefinition'
      ) {
        const name = patternPropertyName(current.parent)
        return typeof name === 'string' ? name : null
      }
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
          let mapped = unwrap(args[0])
          while (mapped?.type === 'AwaitExpression') {
            mapped = unwrap(mapped.argument as NodeLike | undefined)
          }
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
