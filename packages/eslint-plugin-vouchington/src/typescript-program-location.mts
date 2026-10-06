import {
  findVariable,
  normalizeFilename,
  propertyName,
  unwrap,
  type RuleContextLike,
} from './ast-helpers.mts'
import {
  matchesFileGlobs,
  resolveFileMatchOptions,
  stringArray,
  type FileMatchOptions,
} from './file-match.mts'
import construction from './typescript-program-construction.cjs'

type VirtualMatrixOptions = {
  moduleBasename: string
  builder: string
  testModule: string
  testHook: string
  allowLifecycleFiles: readonly string[]
}

type ProgramLocationOptions = FileMatchOptions & {
  modules: readonly string[]
  factories: readonly string[]
  owners: readonly string[]
  virtualMatrix?: VirtualMatrixOptions
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function resolveProgramLocationOptions(raw: unknown): ProgramLocationOptions | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- Preserve the validated unknown-to-record boundary for option parsing.
  const record = raw as Record<string, unknown>
  const modules = stringArray(record.modules)
  const factories = stringArray(record.factories)
  const owners = stringArray(record.owners)
  const files = resolveFileMatchOptions(record)
  if (!modules?.length || !factories?.length || !owners?.length || !files) return null
  const virtualRaw = record.virtualMatrix
  let virtualMatrix: VirtualMatrixOptions | undefined
  if (virtualRaw !== undefined) {
    if (virtualRaw === null || typeof virtualRaw !== 'object' || Array.isArray(virtualRaw))
      return null
    // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- Preserve the validated unknown-to-record boundary for option parsing.
    const data = virtualRaw as Record<string, unknown>
    const allowLifecycleFiles = stringArray(data.allowLifecycleFiles)
    if (
      !nonemptyString(data.moduleBasename) ||
      !nonemptyString(data.builder) ||
      !nonemptyString(data.testModule) ||
      !nonemptyString(data.testHook) ||
      !allowLifecycleFiles
    )
      return null
    virtualMatrix = {
      moduleBasename: data.moduleBasename,
      builder: data.builder,
      testModule: data.testModule,
      testHook: data.testHook,
      allowLifecycleFiles: allowLifecycleFiles.map((file) => file.replace(/^(?:\.\/)+/, '')),
    }
  }
  return {
    modules,
    factories,
    owners: owners.map((file) => file.replace(/^(?:\.\/)+/, '')),
    ...files,
    ...(virtualMatrix && { virtualMatrix }),
  }
}

export function createTypescriptProgramLocationRule() {
  return {
    meta: {
      type: 'problem' as const,
      docs: {
        description:
          'keep configured compiler factories and virtual matrix construction in their owners',
      },
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
            virtualMatrix: {
              type: 'object',
              additionalProperties: false,
              properties: {
                moduleBasename: { type: 'string' },
                builder: { type: 'string' },
                testModule: { type: 'string' },
                testHook: { type: 'string' },
                allowLifecycleFiles: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      ],
      messages: {
        constructionOwner:
          'Construct configured compiler factories and virtual matrices only in their owner files.',
      },
    },
    create(context: RuleContextLike) {
      const options = resolveProgramLocationOptions(context.options[0])
      if (!options || !matchesFileGlobs(context, options)) return {}
      const filename = normalizeFilename(context).replace(/^(?:\.\/)+/, '')
      if (options.owners.includes(filename)) return {}
      const rule = construction.createTypescriptProgramConstructionRule({
        findVariable,
        propertyName,
        unwrap,
        options: {
          ...options,
          virtualMatrix: options.virtualMatrix && {
            ...options.virtualMatrix,
            currentFile: filename,
          },
        },
      })
      return rule.create(context)
    },
  }
}
