import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'

export function encodeSelectedFiles(files: readonly string[]): string {
  return files.join('\n')
}

// Linux MAX_ARG_STRLEN is 131072. GitHub Actions interpolates selected-file
// lists into a step env block, so the encoded list plus the variable prefix
// must fit in one exec argument.
export const SELECTED_FILES_ENV_MAX_BYTES = 120_000

export function selectedFilesExceedEnvBudget(files: readonly string[]): boolean {
  return Buffer.byteLength(encodeSelectedFiles(files), 'utf8') > SELECTED_FILES_ENV_MAX_BYTES
}

export function decodeSelectedFiles(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw.split('\n').filter((file) => file.trim().length > 0)
}

export function formatMultilineOutput(
  key: string,
  value: string,
  createId: () => string = randomUUID,
): string {
  const delimiter = collisionFreeDelimiter(key, value, createId)
  const body = value === '' ? '' : `${value}\n`
  return `${key}<<${delimiter}\n${body}${delimiter}\n`
}

export function writeSelectedFilesOutput(
  key: string,
  files: readonly string[],
  createId: () => string = randomUUID,
): void {
  const target = process.env.GITHUB_OUTPUT
  if (target) {
    appendFileSync(target, formatMultilineOutput(key, encodeSelectedFiles(files), createId))
  }
  console.log(`[select] ${key} (${files.length} file${files.length === 1 ? '' : 's'})`)
}

function collisionFreeDelimiter(key: string, value: string, createId: () => string): string {
  const prefix = key.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `${prefix}_${createId().toUpperCase().replaceAll('-', '_')}`
    if (!value.includes(candidate)) return candidate
  }
  throw new Error(
    `could not create a collision-free GitHub output delimiter for ${key} after 10 attempts`,
  )
}
