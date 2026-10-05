import { dirname, resolve } from 'node:path'
import type ts from '@typescript/typescript6'
import type { CompilerProgramCacheOptions } from './program-types.mts'

export interface CompilerProgramConfiguration {
  parsed: ts.ParsedCommandLine
  roots: string[]
  selectedSources: Set<string> | undefined
  signature: string
}

export function readProgramConfiguration(
  api: typeof ts,
  input: CompilerProgramCacheOptions,
): CompilerProgramConfiguration {
  const configPath = resolve(input.configPath)
  const directory = dirname(configPath)
  const config = api.readConfigFile(configPath, (file) => api.sys.readFile(file))
  const format = (diagnostics: readonly ts.Diagnostic[]): string =>
    api.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => directory,
      getNewLine: () => '\n',
    })
  if (config.error) throw new Error(format([config.error]))
  const parsed = api.parseJsonConfigFileContent(
    config.config,
    api.sys,
    directory,
    undefined,
    configPath,
  )
  if (parsed.errors.length > 0) throw new Error(format(parsed.errors))
  const rootNames =
    typeof input.rootNames === 'function' ? input.rootNames(parsed) : input.rootNames
  const roots = (rootNames ?? parsed.fileNames).map((file) => resolve(directory, file))
  const names =
    typeof input.sourceFilePaths === 'function' ? input.sourceFilePaths() : input.sourceFilePaths
  const selectedSources = names && new Set(names.map((file) => resolve(directory, file)))
  const signature = JSON.stringify({
    config: config.config,
    options: parsed.options,
    projectReferences: parsed.projectReferences?.map((reference) => reference.path),
    roots,
    sources: selectedSources && [...selectedSources].toSorted(),
  })
  return { parsed, roots, selectedSources, signature }
}
