import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from './build-openapi-document.mts'
import { writeOpenApi } from './write-openapi.mts'

describe('writeOpenApi', () => {
  it('writes and then accepts a matching check', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openapi-write-'))
    const path = join(dir, 'openapi.json')
    const document = buildOpenApiDocument({ title: 'Example API', responseContracts: {} })
    await writeOpenApi({ path, document })
    const written = await readFile(path, 'utf8')
    expect(JSON.parse(written).info.title).toBe('Example API')
    await writeOpenApi({ path, document, check: true })
  })

  it('fails check when the file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openapi-missing-'))
    const path = join(dir, 'openapi.json')
    const document = buildOpenApiDocument({ title: 'Example API', responseContracts: {} })
    await expect(writeOpenApi({ path, document, check: true })).rejects.toThrow('is stale')
  })

  it('fails check when the file is stale', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openapi-stale-'))
    const path = join(dir, 'openapi.json')
    await writeFile(path, '{}\n')
    const document = buildOpenApiDocument({ title: 'Example API', responseContracts: {} })
    await expect(writeOpenApi({ path, document, check: true })).rejects.toThrow('is stale')
  })

  it('uses custom stringify and format hooks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openapi-hooks-'))
    const path = join(dir, 'openapi.json')
    const document = buildOpenApiDocument({ title: 'Example API', responseContracts: {} })
    await writeOpenApi({
      path,
      document,
      stringify: () => 'RAW',
      format: async (_path, raw) => `${raw}-FMT`,
    })
    expect(await readFile(path, 'utf8')).toBe('RAW-FMT')
  })

  it('propagates non-ENOENT read failures during check', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openapi-dir-'))
    const document = buildOpenApiDocument({ title: 'Example API', responseContracts: {} })
    await expect(writeOpenApi({ path: dir, document, check: true })).rejects.toThrow()
  })
})
