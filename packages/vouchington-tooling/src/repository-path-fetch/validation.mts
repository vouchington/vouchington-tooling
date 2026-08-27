import * as nativePath from 'node:path'
import { posix } from 'node:path'

interface DestinationPathOperations {
  isAbsolute(path: string): boolean
  normalize(path: string): string
  parse(path: string): { root: string }
  sep: string
}

export interface RepositoryPathFetchConfig {
  paths: readonly RepositoryPathMapping[]
  ref: string
  repository: string
  schemaVersion: 1
}

export interface RepositoryPathMapping {
  destination: string
  source: string
}

const repositoryPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/
const refPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

export function parseRepositoryPathFetchConfig(input: unknown): RepositoryPathFetchConfig {
  if (!isRecord(input)) throw new Error('config must be an object')
  const { repository, ref, schemaVersion, paths } = input
  if (schemaVersion !== 1) throw new Error('config schemaVersion must be 1')
  if (typeof repository !== 'string' || !repositoryPattern.test(repository)) {
    throw new Error('repository must be owner/name')
  }
  if (
    typeof ref !== 'string' ||
    !refPattern.test(ref) ||
    ref.includes('..') ||
    ref.includes('//') ||
    ref.endsWith('/') ||
    ref.endsWith('.') ||
    ref.split('/').some((component) => component.startsWith('.') || component.endsWith('.lock'))
  ) {
    throw new Error('ref contains unsupported characters')
  }
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('paths must not be empty')
  const seen = new Set<string>()
  const mappings = paths.map((path) => parseMapping(path, seen))
  for (const mapping of mappings) {
    if (
      mappings.some((candidate) => {
        const destination = filesystemIdentity(mapping.destination)
        const candidateDestination = filesystemIdentity(candidate.destination)
        return candidate !== mapping && candidateDestination.startsWith(`${destination}/`)
      })
    ) {
      throw new Error(`overlapping destination: ${mapping.destination}`)
    }
  }
  return { paths: mappings, ref, repository, schemaVersion: 1 }
}

export function validateDestination(
  destination: string,
  operations: DestinationPathOperations = nativePath,
): void {
  if (
    !operations.isAbsolute(destination) ||
    operations.parse(destination).root === destination ||
    destination.endsWith(operations.sep) ||
    operations.normalize(destination) !== destination
  )
    throw new Error('destination must be a normalized non-root absolute path')
}

function parseMapping(value: unknown, seen: Set<string>): RepositoryPathMapping {
  if (
    !isRecord(value) ||
    typeof value.source !== 'string' ||
    typeof value.destination !== 'string'
  ) {
    throw new Error('each path must contain source and destination')
  }
  validateRelativePath(value.source)
  validateRelativePath(value.destination)
  const identity = filesystemIdentity(value.destination)
  if (seen.has(identity)) throw new Error(`duplicate destination: ${value.destination}`)
  seen.add(identity)
  return { destination: value.destination, source: value.source }
}

function filesystemIdentity(value: string): string {
  return value.normalize('NFC').toLowerCase()
}

export function validateRelativePath(path: string): void {
  if (
    posix.isAbsolute(path) ||
    path.includes('\\') ||
    path === '.' ||
    path.endsWith('/') ||
    path.startsWith('-') ||
    posix.normalize(path) !== path ||
    posix.relative('.', path).startsWith('..')
  ) {
    throw new Error(`unsafe path: ${path}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
