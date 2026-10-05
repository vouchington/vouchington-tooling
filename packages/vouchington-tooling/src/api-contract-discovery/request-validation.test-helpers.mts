import ts from '../contract-schema/typescript-api.mts'
import { discoverRequestValidationFacts } from './request-validation-facts.mts'
import type {
  ExecutedCallbackConfig,
  FactoryConfig,
  ValidatorConfig,
} from './request-validation-types.mts'

/** Synthetic library modules shared by the request-validation fixtures. */
export const librarySources = {
  'lib/validation.ts': `
    export function validateInput(ctx: any, operation: string, input?: any): boolean {
      if (ctx.query.limit && input && operation) ctx.throw(400)
      return true
    }
    export function validatePage(ctx: any, operation: string, options?: any): boolean {
      if (ctx.query.limit && operation && options) ctx.throw(400)
      return true
    }
  `,
  'lib/factory.ts': `
    import { validateInput } from './validation'
    export function createThingHandler(options: any) {
      return (ctx: any) => {
        if (options.mode) validateInput(ctx, options.operation, { path: ctx.params })
        ctx.status = 204
      }
    }
  `,
  'lib/reexport.ts': `export { validateInput as checkInput } from './validation'`,
  'lib/keys.ts': `export const LIST_KEY = 'GET:/api/items'`,
} as const

export const validators: readonly ValidatorConfig[] = [
  {
    module: 'lib/validation.ts',
    exportName: 'validateInput',
    operationArgument: 1,
    carriers: { kind: 'input-object', argument: 2 },
  },
  {
    module: 'lib/validation',
    exportName: 'validatePage',
    operationArgument: 1,
    carriers: {
      kind: 'fixed',
      carriers: ['query'],
      optionCarriers: [{ argument: 2, property: 'path', carrier: 'path' }],
    },
  },
]

const factories: readonly FactoryConfig[] = [
  {
    module: 'lib/factory.ts',
    exportName: 'createThingHandler',
    optionsArgument: 0,
    operationProperty: 'operation',
    carriers: ['path', 'body'],
  },
]

const ROOT = '/virtual/'

/** Builds a program whose files can import each other, relatively or through `@lib/*`. */
export function buildModuleProgram(files: Readonly<Record<string, string>>) {
  const sources = new Map(
    Object.entries(files).map(([path, text]) => [
      `${ROOT}${path}`,
      path.startsWith('global/') ? text : `${text}\nexport {}\n`,
    ]),
  )
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: ROOT,
    paths: { '@lib/*': ['lib/*'] },
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  }
  const host = ts.createCompilerHost(options, true)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (requested, languageVersion, ...rest) => {
    const text = sources.get(requested)
    return text === undefined
      ? getSourceFile(requested, languageVersion, ...rest)
      : ts.createSourceFile(requested, text, languageVersion, true, ts.ScriptKind.TS)
  }
  host.fileExists = (requested) => sources.has(requested) || ts.sys.fileExists(requested)
  host.directoryExists = (requested) =>
    [...sources.keys()].some((path) => path.startsWith(`${requested.replace(/\/$/, '')}/`)) ||
    !!ts.sys.directoryExists?.(requested)
  host.readFile = (requested) => sources.get(requested) ?? ts.sys.readFile(requested)
  const program = ts.createProgram([...sources.keys()], options, host)
  return {
    program,
    sourceFile(path: string) {
      const sourceFile = program.getSourceFile(`${ROOT}${path}`)!
      const diagnostics = [
        ...program.getSyntacticDiagnostics(sourceFile),
        ...program.getSemanticDiagnostics(sourceFile),
      ]
      if (diagnostics.length > 0)
        throw new Error(
          diagnostics
            .map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n'))
            .join('\n'),
        )
      return sourceFile
    },
  }
}

export type ModuleProgram = ReturnType<typeof buildModuleProgram>

/** Runs discovery over the given files with the shared configuration. */
export function discover(
  built: ModuleProgram,
  paths: readonly string[],
  overrides: {
    validators?: readonly ValidatorConfig[]
    factories?: readonly FactoryConfig[]
    executedCallbacks?: readonly ExecutedCallbackConfig[]
  } = {},
) {
  return discoverRequestValidationFacts({
    program: built.program,
    sourceFiles: paths.map((path) => built.sourceFile(path)),
    validators,
    factories,
    ...overrides,
  })
}
