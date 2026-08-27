import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { mapBounded } from './concurrency.mts'
import { bundleEntries, comparePaths, digestEntries, type BundleEntry } from './digest.mts'
import {
  outputExists,
  publishBundle,
  publishMarkerPath,
  recoverIncompletePublish,
} from './publish.mts'
import {
  validateDestination,
  validateRelativePath,
  type RepositoryPathFetchConfig,
} from './validation.mts'
interface ApiCommit {
  commit?: { tree?: { sha?: string } }
  sha?: string
}
interface ApiTreeEntry {
  mode?: string
  path?: string
  sha?: string
  type?: string
}
interface ApiTree {
  truncated?: boolean
  tree?: ApiTreeEntry[]
}
interface ApiBlob {
  content?: string
  encoding?: string
}
export interface FetchMetadata {
  digest: string
  files: BundleEntry[]
  repository: string
  requestedRef: string
  resolvedSha: string
  schemaVersion: 1
  sourcePaths: readonly { destination: string; source: string }[]
}
export async function fetchRepositoryPaths(options: {
  apiUrl: string
  config: RepositoryPathFetchConfig
  destination: string
  metadata: string
  token: string
}): Promise<FetchMetadata> {
  validateDestination(options.destination)
  validateDestination(options.metadata)
  ensureDistinctOutputs(options.destination, options.metadata)
  await recoverIncompletePublish(options.destination, options.metadata)
  if (outputExists(options.destination) || outputExists(options.metadata))
    throw new Error('output already exists')
  const api = new URL(options.apiUrl.endsWith('/') ? options.apiUrl : `${options.apiUrl}/`)
  if (api.protocol !== 'https:') throw new Error('api URL must use https')
  const commit = await getJson<ApiCommit>(
    api,
    `repos/${options.config.repository}/commits/${encodeURIComponent(options.config.ref)}`,
    options.token,
  )
  const resolvedSha = requireSha(commit.sha, 'commit SHA')
  const tree = await getJson<ApiTree>(
    api,
    `repos/${options.config.repository}/git/trees/${requireSha(commit.commit?.tree?.sha, 'tree SHA')}?recursive=1`,
    options.token,
  )
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('repository tree is incomplete')
  await mkdir(dirname(options.destination), { recursive: true })
  await mkdir(dirname(options.metadata), { recursive: true })
  const stagedBundle = temporaryPath(options.destination)
  const stagedMetadata = temporaryPath(options.metadata)
  await mkdir(stagedBundle, { mode: 0o700 })
  await chmod(stagedBundle, 0o700)
  try {
    for (const mapping of options.config.paths) {
      const selected = tree.tree
        .filter(
          (entry) => typeof entry.path === 'string' && selectedPath(entry.path, mapping.source),
        )
        .map(validateApiEntry)
        .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
      const blobs = selected.filter((entry) => entry.type === 'blob')
      if (blobs.length === 0) throw new Error(`source path contains no files: ${mapping.source}`)
      await mapBounded(blobs, 10, (entry) =>
        writeBlob(api, options.config.repository, mapping, entry, stagedBundle, options.token),
      )
    }
    const files = await bundleEntries(stagedBundle)
    const metadata: FetchMetadata = {
      digest: digestEntries(files),
      files,
      repository: options.config.repository,
      requestedRef: options.config.ref,
      resolvedSha,
      schemaVersion: 1,
      sourcePaths: [...options.config.paths].sort(comparePaths),
    }
    await writeFile(stagedMetadata, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 })
    await publishBundle(stagedBundle, options.destination, stagedMetadata, options.metadata)
    return metadata
  } catch (error) {
    await rm(stagedBundle, { force: true, recursive: true })
    await rm(stagedMetadata, { force: true })
    throw error
  }
}

async function writeBlob(
  api: URL,
  repository: string,
  mapping: RepositoryPathFetchConfig['paths'][number],
  entry: Required<ApiTreeEntry>,
  root: string,
  token: string,
): Promise<void> {
  const destination =
    entry.path === mapping.source
      ? mapping.destination
      : join(mapping.destination, relative(mapping.source, entry.path))
  validateRelativePath(destination)
  const blob = await getJson<ApiBlob>(api, `repos/${repository}/git/blobs/${entry.sha}`, token)
  if (blob.encoding !== 'base64' || typeof blob.content !== 'string')
    throw new Error(`invalid blob: ${entry.path}`)
  const encoded = blob.content.replaceAll('\r\n', '').replaceAll('\n', '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(`invalid blob encoding: ${entry.path}`)
  }
  const content = Buffer.from(encoded, 'base64')
  if (
    content.toString('base64') !== encoded ||
    gitBlobSha(content, entry.sha.length) !== entry.sha
  ) {
    throw new Error(`blob integrity mismatch: ${entry.path}`)
  }
  const absolute = join(root, destination)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, content, {
    mode: Number.parseInt(entry.mode, 8) & 0o777,
  })
  await chmod(absolute, Number.parseInt(entry.mode, 8) & 0o777)
}

function validateApiEntry(entry: ApiTreeEntry): Required<ApiTreeEntry> {
  /* v8 ignore next -- selection filters entries without string paths */
  if (typeof entry.path !== 'string') throw new Error('invalid API path')
  validateRelativePath(entry.path)
  const sha = requireSha(entry.sha, 'tree entry SHA')
  if (entry.type === 'tree' && entry.mode === '040000')
    return { mode: entry.mode, path: entry.path, sha, type: entry.type }
  if (entry.type === 'blob' && (entry.mode === '100644' || entry.mode === '100755'))
    return { mode: entry.mode, path: entry.path, sha, type: entry.type }
  throw new Error(`unsupported source entry: ${entry.path}`)
}

function selectedPath(path: string, source: string): boolean {
  return path === source || path.startsWith(`${source}/`)
}
function temporaryPath(target: string): string {
  return join(dirname(target), `.${basename(target)}.fetch-${randomUUID()}`)
}
function ensureDistinctOutputs(destination: string, metadata: string): void {
  const destinationIdentity = filesystemIdentity(destination)
  const metadataIdentity = filesystemIdentity(metadata)
  const markerIdentity = filesystemIdentity(publishMarkerPath(destination))
  if (
    destinationIdentity === metadataIdentity ||
    metadataIdentity.startsWith(`${destinationIdentity}/`) ||
    destinationIdentity.startsWith(`${metadataIdentity}/`) ||
    metadataIdentity === markerIdentity ||
    metadataIdentity.startsWith(`${markerIdentity}/`) ||
    markerIdentity.startsWith(`${metadataIdentity}/`)
  )
    throw new Error('destination and metadata overlap')
}
function filesystemIdentity(path: string): string {
  return path.normalize('NFC').toLowerCase()
}
async function getJson<T>(api: URL, path: string, token: string): Promise<T> {
  const response = await fetch(new URL(path, api), {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'vouchington-tooling',
    },
  })
  if (!response.ok) throw new Error(`GitHub API request failed: ${response.status}`)
  return (await response.json()) as T
}
function requireSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value))
    throw new Error(`invalid ${label}`)
  return value
}
function gitBlobSha(content: Buffer, length: number): string {
  const algorithm = length === 40 ? 'sha1' : 'sha256'
  return createHash(algorithm).update(`blob ${content.length}\0`).update(content).digest('hex')
}
