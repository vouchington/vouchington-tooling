import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SharedContext } from '../shared-context/index.mts'
import type { FiniteEnumRippleConfig, ReadTrackedFile } from './model.mts'
import { checkStructuredTypes } from './types.mts'
import { checkUnionTypes } from './union-types.mts'
import { escapeWorkflowData, finiteEnumError } from './compare.mts'

export function checkFiniteEnumRipple(
  ctx: SharedContext,
  config: FiniteEnumRippleConfig,
): string[] {
  const errors: string[] = []
  const readTracked: ReadTrackedFile = (file) => {
    if (!config.files.existingFileSet.has(file)) throw new Error(`Not tracked: ${file}`)
    const content = ctx.readTrackedFile?.(file)
    if (content !== undefined) {
      if (content === null) throw new Error(`Cannot read tracked file: ${file}`)
      return content
    }
    try {
      return readFileSync(join(ctx.repoRoot, file), 'utf8')
    } catch (cause) {
      throw new Error(`${file}: ${String(cause)}`)
    }
  }
  if (config.structured) {
    try {
      checkStructuredTypes(errors, config.files, readTracked, config.structured)
    } catch (cause) {
      errors.push(
        familyError(cause, config.structured.backendPath, config.files, [
          config.structured.webPath,
          config.structured.routeConfigsPath,
        ]),
      )
    }
  }
  if (config.union) {
    try {
      checkUnionTypes(errors, config.files, readTracked, config.union)
    } catch (cause) {
      errors.push(
        familyError(cause, config.union.typesPath, config.files, [config.union.routeConfigsPath]),
      )
    }
  }
  return errors.map((error) => `${error}${escapeWorkflowData(config.diagnosticSuffix ?? '')}`)
}

function familyError(
  cause: unknown,
  defaultFile: string,
  files: FiniteEnumRippleConfig['files'],
  otherPaths: readonly string[],
): string {
  const message = String(cause instanceof Error ? cause.message : cause)
  const selectedPaths = [
    defaultFile,
    ...otherPaths,
    ...files.structuredDetailPages.map((page) => page.file),
    ...files.structuredCollectionPages.map((page) => page.file),
    ...files.structuredComponentFiles.map((page) => page.file),
    ...files.unionDetailPages.map((page) => page.file),
    ...files.unionCollectionPages.map((page) => page.file),
    ...files.unionCreatePages.map((page) => page.file),
  ]
  const file =
    selectedPaths.find((path) => message.startsWith(`${path}:`) || message.endsWith(`: ${path}`)) ??
    defaultFile
  return finiteEnumError(
    file,
    message.startsWith(`${file}: `) ? message.slice(file.length + 2) : message,
  )
}
