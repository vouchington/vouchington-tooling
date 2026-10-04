import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SharedContext } from '../shared-context/index.mts'
import type { FiniteEnumRippleConfig, ReadTrackedFile } from './model.mts'
import { checkTopicTypes } from './types.mts'
import { checkPostTypes } from './post-types.mts'

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
    return readFileSync(join(ctx.repoRoot, file), 'utf8')
  }
  if (config.topic) {
    try {
      checkTopicTypes(errors, config.files, readTracked, config.topic)
    } catch (cause) {
      errors.push(String(cause instanceof Error ? cause.message : cause))
    }
  }
  if (config.post) {
    try {
      checkPostTypes(errors, config.files, readTracked, config.post)
    } catch (cause) {
      errors.push(String(cause instanceof Error ? cause.message : cause))
    }
  }
  return errors.map((error) => `${error}${config.diagnosticSuffix ?? ''}`)
}
