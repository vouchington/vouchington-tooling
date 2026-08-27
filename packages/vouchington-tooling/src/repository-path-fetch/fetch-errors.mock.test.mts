import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRepositoryPaths } from './fetch.mts'
import { MAX_FETCH_METADATA_BYTES } from './metadata.mts'

const sha = 'a'.repeat(40)
const config = {
  paths: [{ destination: 'target', source: 'source' }],
  ref: 'main',
  repository: 'owner/repository',
  schemaVersion: 1 as const,
}

function options(root: string) {
  return {
    apiUrl: 'https://api.github.com/',
    config,
    destination: join(root, 'bundle'),
    metadata: join(root, 'metadata.json'),
    token: 'secret',
  }
}

function gitBlobSha(content: string, algorithm: 'sha1' | 'sha256' = 'sha1'): string {
  return createHash(algorithm)
    .update(`blob ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest('hex')
}

function mockApi(tree: unknown, blob: unknown = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const body = url.includes('/commits/')
        ? { commit: { tree: { sha } }, sha }
        : url.includes('/git/trees/')
          ? tree
          : blob
      return Promise.resolve(new Response(JSON.stringify(body)))
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchRepositoryPaths failure boundaries', () => {
  it('rejects oversized metadata before publishing either output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      const content = 'content'
      const blob = gitBlobSha(content)
      mockApi(
        { tree: [{ mode: '100644', path: 'source/file', sha: blob, type: 'blob' }] },
        { content: Buffer.from(content).toString('base64'), encoding: 'base64' },
      )
      const request = options(root)
      await expect(
        fetchRepositoryPaths({
          ...request,
          config: { ...config, ref: 'r'.repeat(MAX_FETCH_METADATA_BYTES) },
        }),
      ).rejects.toThrow('repository metadata exceeds size limit')
      expect(existsSync(request.destination)).toBe(false)
      expect(existsSync(request.metadata)).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each([
    ['same', 'same'],
    ['bundle', 'bundle/metadata.json'],
    ['bundle/nested', 'bundle'],
  ])('rejects overlapping outputs %s and %s', async (destination, metadata) => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      await expect(
        fetchRepositoryPaths({
          ...options(root),
          destination: join(root, destination),
          metadata: join(root, metadata),
        }),
      ).rejects.toThrow('destination and metadata overlap')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects metadata that collides with the publication marker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      await expect(
        fetchRepositoryPaths({
          ...options(root),
          metadata: join(root, '.bundle.fetch-incomplete'),
        }),
      ).rejects.toThrow('destination and metadata overlap')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects metadata below the publication marker path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      await expect(
        fetchRepositoryPaths({
          ...options(root),
          metadata: join(root, '.bundle.fetch-incomplete', 'nested'),
        }),
      ).rejects.toThrow('destination and metadata overlap')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each(['destination', 'metadata'])('rejects an existing %s', async (existing) => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      const request = options(root)
      if (existing === 'destination') mkdirSync(request.destination)
      else writeFileSync(request.metadata, '{}')
      await expect(fetchRepositoryPaths(request)).rejects.toThrow('output already exists')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('requires HTTPS', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      await expect(
        fetchRepositoryPaths({ ...options(root), apiUrl: 'http://api.example/' }),
      ).rejects.toThrow('api URL must use https')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects API URLs containing credentials', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      await expect(
        fetchRepositoryPaths({ ...options(root), apiUrl: 'https://user:secret@api.example/' }),
      ).rejects.toThrow('api URL must not contain credentials')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each([
    [{ sha: 'bad', commit: { tree: { sha } } }, 'invalid commit SHA'],
    [{ sha, commit: { tree: { sha: 'bad' } } }, 'invalid tree SHA'],
  ])('rejects malformed commit metadata', async (commit, message) => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(commit))),
      )
      await expect(fetchRepositoryPaths(options(root))).rejects.toThrow(message)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each([{ truncated: true, tree: [] }, { tree: null }])(
    'rejects incomplete repository trees',
    async (tree) => {
      const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
      try {
        mockApi(tree)
        await expect(fetchRepositoryPaths(options(root))).rejects.toThrow(
          'repository tree is incomplete',
        )
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    },
  )

  it.each([
    [{ mode: '100644', path: 'source/file', sha: 'bad', type: 'blob' }, 'invalid tree entry SHA'],
    [{ mode: '100600', path: 'source/file', sha, type: 'blob' }, 'unsupported source entry'],
    [
      { mode: '100644', path: 'source/file', sha: 'a'.repeat(41), type: 'blob' },
      'invalid tree entry SHA',
    ],
  ])('rejects malformed selected tree entries', async (entry, message) => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      mockApi({ tree: [entry] })
      await expect(fetchRepositoryPaths(options(root))).rejects.toThrow(message)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects duplicate repository tree paths before fetching blobs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const body = url.includes('/commits/')
          ? { commit: { tree: { sha } }, sha }
          : {
              tree: [
                { mode: '100644', sha, type: 'blob' },
                { mode: '100644', path: 'source/file', sha, type: 'blob' },
                { mode: '100755', path: 'source/file', sha, type: 'blob' },
              ],
            }
        return Promise.resolve(new Response(JSON.stringify(body)))
      })
      vi.stubGlobal('fetch', fetchMock)
      await expect(fetchRepositoryPaths(options(root))).rejects.toThrow(
        'duplicate repository tree path: source/file',
      )
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each([
    [{ content: 'YQ==', encoding: 'utf8' }, 'invalid blob'],
    [{ content: 1, encoding: 'base64' }, 'invalid blob'],
    [
      { content: Buffer.from('wrong').toString('base64'), encoding: 'base64' },
      'blob integrity mismatch',
    ],
  ])('rejects invalid blob payloads', async (blob, message) => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      mockApi({ tree: [{ mode: '100644', path: 'source/file', sha, type: 'blob' }] }, blob)
      await expect(fetchRepositoryPaths(options(root))).rejects.toThrow(message)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each(['\r\n', '\r'])('accepts %j-wrapped base64 content', async (lineEnding) => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      const content = 'content'
      const blob = gitBlobSha(content)
      mockApi(
        { tree: [{ mode: '100644', path: 'source/file', sha: blob, type: 'blob' }] },
        {
          content: `${Buffer.from(content).toString('base64').slice(0, 4)}${lineEnding}${Buffer.from(content).toString('base64').slice(4)}`,
          encoding: 'base64',
        },
      )
      await expect(fetchRepositoryPaths(options(root))).resolves.toMatchObject({
        files: [{ destination: 'target/file' }],
      })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('accepts an uppercase hexadecimal blob SHA', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      const content = 'content'
      const blob = gitBlobSha(content).toUpperCase()
      mockApi(
        { tree: [{ mode: '100644', path: 'source/file', sha: blob, type: 'blob' }] },
        { content: Buffer.from(content).toString('base64'), encoding: 'base64' },
      )
      await expect(fetchRepositoryPaths(options(root))).resolves.toMatchObject({
        files: [{ destination: 'target/file' }],
      })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('supports SHA-256 repositories and a source mapping that selects one file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      const content = 'content'
      const sha256 = gitBlobSha(content, 'sha256')
      const request = options(root)
      request.config = {
        ...config,
        paths: [
          { destination: 'renamed', source: 'source-file' },
          { destination: 'another', source: 'another-file' },
        ],
      }
      mockApi(
        {
          tree: [
            { mode: '100644', path: 'source-file', sha: sha256, type: 'blob' },
            { mode: '100644', path: 'another-file', sha: sha256, type: 'blob' },
          ],
        },
        { content: Buffer.from(content).toString('base64'), encoding: 'base64' },
      )
      await expect(fetchRepositoryPaths(request)).resolves.toMatchObject({
        files: [{ destination: 'another' }, { destination: 'renamed' }],
        sourcePaths: [
          { destination: 'another', source: 'another-file' },
          { destination: 'renamed', source: 'source-file' },
        ],
      })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('reports unsuccessful GitHub API responses', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-fetch-errors-'))
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 })),
      )
      await expect(fetchRepositoryPaths(options(root))).rejects.toThrow(
        'GitHub API request failed: 503',
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
