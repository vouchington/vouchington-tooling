import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { OpenApiDocument } from './openapi-types.mts'

export type WriteOpenApiOptions = {
  path: string
  document: OpenApiDocument
  check?: boolean
  format?: (path: string, raw: string) => Promise<string>
  stringify?: (value: unknown) => string
}

function defaultStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export async function writeOpenApi(options: WriteOpenApiOptions): Promise<void> {
  const stringify = options.stringify ?? defaultStringify
  const format = options.format ?? (async (_path, raw) => raw)
  const content = await format(options.path, stringify(options.document))

  if (options.check) {
    const actual = await readFile(options.path, 'utf8').catch((error: NodeJS.ErrnoException) =>
      error.code === 'ENOENT' ? null : Promise.reject(error),
    )
    if (actual !== content) {
      throw new Error(`${options.path} is stale. Regenerate the OpenAPI document and commit it.`)
    }
    return
  }

  await mkdir(dirname(options.path), { recursive: true })
  await writeFile(options.path, content)
}
