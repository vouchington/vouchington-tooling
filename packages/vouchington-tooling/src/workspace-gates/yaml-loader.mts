import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as load } from 'yaml'

export type AnyObj = Record<string, unknown>

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

export async function loadYaml(
  repoRoot: string,
  relPath: string,
  errors: string[],
): Promise<AnyObj | null> {
  let content: string
  try {
    content = await readFile(join(repoRoot, relPath), 'utf8')
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      errors.push(`::error file=${relPath}::${relPath}: failed to read YAML`)
    }
    return null
  }
  try {
    const parsed = load(content)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as AnyObj
  } catch {
    errors.push(`::error file=${relPath}::${relPath}: failed to parse YAML`)
    return null
  }
}
