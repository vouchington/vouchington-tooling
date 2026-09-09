import ts from './typescript-api.mts'

const virtualCompilerSourceFiles = new Map<string, ts.SourceFile>()
const virtualProgramMatrixExecutions = new WeakSet<ImportMeta>()
const virtualSourceIdPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
let virtualProgramBuildCount = 0

export interface VirtualProgramMatrix<Id extends string> {
  readonly program: ts.Program
  sourceFile(id: Id): ts.SourceFile
}

export function buildVirtualProgramMatrix<const Id extends string>(
  ownerExecution: ImportMeta,
  sources: Readonly<Record<Id, string>>,
): VirtualProgramMatrix<Id> {
  const owner = normalizeOwnerFileUrl(ownerExecution.url)
  const entries = Object.entries(sources) as [Id, string][]
  if (entries.length === 0) throw new Error('A virtual program matrix requires at least one source')

  const sourcesByFileName = new Map<string, string>()
  const fileNameById = new Map<Id, string>()
  for (const [id, sourceText] of entries) {
    if (!virtualSourceIdPattern.test(id)) {
      throw new Error(
        `Virtual source ID "${id}" must contain only lowercase letters, digits, and hyphens`,
      )
    }
    const fileName = `/virtual/${id}.ts`
    sourcesByFileName.set(fileName, `${sourceText}\nexport {}\n`)
    fileNameById.set(id, fileName)
  }

  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  }
  const host = ts.createCompilerHost(options, true)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (requested, languageVersion, onError, shouldCreateNewSourceFile) => {
    const virtualSource = sourcesByFileName.get(requested)
    if (virtualSource !== undefined) {
      return ts.createSourceFile(requested, virtualSource, languageVersion, true, ts.ScriptKind.TS)
    }
    const cached = virtualCompilerSourceFiles.get(requested)
    if (cached) return cached
    const sourceFile = originalGetSourceFile(
      requested,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    )
    if (sourceFile) virtualCompilerSourceFiles.set(requested, sourceFile)
    return sourceFile
  }
  host.fileExists = (requested) => sourcesByFileName.has(requested) || ts.sys.fileExists(requested)
  host.readFile = (requested) => sourcesByFileName.get(requested) ?? ts.sys.readFile(requested)

  if (virtualProgramMatrixExecutions.has(ownerExecution)) {
    throw new Error(
      `Virtual program matrix for "${owner}" was already built; each contract test file execution may build exactly one`,
    )
  }
  const program = ts.createProgram([...sourcesByFileName.keys()], options, host)
  virtualProgramMatrixExecutions.add(ownerExecution)
  virtualProgramBuildCount += 1

  return {
    program,
    sourceFile(id) {
      const fileName = fileNameById.get(id)
      if (!fileName) throw new Error(`Unknown virtual source ID "${id}"`)
      const sourceFile = program.getSourceFile(fileName)
      if (!sourceFile) throw new Error(`Unable to load ${fileName}`)
      const diagnostics = [
        ...program.getSyntacticDiagnostics(sourceFile),
        ...program.getSemanticDiagnostics(sourceFile),
      ]
      if (diagnostics.length > 0) throw new Error(formatDiagnostics(diagnostics))
      return sourceFile
    },
  }
}

export function virtualProgramBuildCountForTest(): number {
  return virtualProgramBuildCount
}

function normalizeOwnerFileUrl(ownerFileUrl: string): string {
  const owner = new URL(ownerFileUrl)
  if (owner.protocol !== 'file:') {
    throw new Error(`Virtual program matrix owner must be a file URL, received "${ownerFileUrl}"`)
  }
  return owner.href
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => '/',
    getNewLine: () => '\n',
  })
}
