import type ts from '@typescript/typescript6'
import type { CompilerHostTrackingOptions } from './freshness.mts'

declare const generationBrand: unique symbol
/** Identity changes on each rebuild, including after clear(). */
export type CompilerProgramGeneration = { readonly [generationBrand]: true }

export interface CompilerProgramSnapshot {
  readonly generation: CompilerProgramGeneration
  readonly program: ts.Program
  readonly sourceFiles: readonly ts.SourceFile[]
}

export interface CompilerProgramCache {
  load(): CompilerProgramSnapshot
  clear(): void
  readonly buildCount: number
}

export interface CompilerProgramCacheOptions {
  /** Inject a compiler; otherwise load the optional peer when constructing this cache. */
  ts?: typeof ts
  configPath: string
  /** Relative names resolve beside configPath; the callback selects parsed roots on each load. */
  rootNames?: readonly string[] | ((configuration: ts.ParsedCommandLine) => readonly string[])
  /** Omit to return all sources; relative paths resolve beside configPath. */
  sourceFilePaths?: readonly string[] | (() => readonly string[])
  maximumAttempts?: number
  tracking?: CompilerHostTrackingOptions
}
