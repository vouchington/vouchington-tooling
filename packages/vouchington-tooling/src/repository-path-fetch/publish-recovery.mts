import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { rm, rmdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isOutputIdentity, removeOwnedOutput, type OutputIdentity } from './output-identity.mts'
import { ownerIsAlive } from './process-liveness.mts'

interface PublishMarker {
  bundleIdentity: OutputIdentity
  createdAt: number
  destination: string
  metadata: string
  metadataIdentity: OutputIdentity
  owner: number
  token: string
  version: 1
}

const MAX_MARKER_BYTES = 4096
const MAX_ACTIVE_MARKER_AGE_MS = 6 * 60 * 60 * 1000

export function publishMarkerPath(destination: string): string {
  return join(dirname(destination), `.${basename(destination)}.fetch-incomplete`)
}

export function outputExists(path: string, stat: typeof lstatSync = lstatSync): boolean {
  try {
    stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function recoverIncompletePublish(
  destination: string,
  metadata: string,
  isOwnerAlive: (owner: number) => boolean = ownerIsAlive,
  now: () => number = Date.now,
): Promise<void> {
  const marker = publishMarkerPath(destination)
  if (!outputExists(marker)) return
  const markerStat = lstatSync(marker, { bigint: true })
  if (!markerStat.isFile()) {
    if (markerStat.isSymbolicLink()) await rm(marker, { force: true })
    else if (markerStat.isDirectory()) {
      if (readdirSync(marker).length > 0)
        throw new Error('incomplete publish marker directory is not empty')
      await rmdir(marker)
    } else throw new Error('incomplete publish marker has unsupported type')
    return
  }
  const markerIdentity: OutputIdentity = {
    dev: String(markerStat.dev),
    ino: String(markerStat.ino),
    type: 'file',
  }
  const parsed = readMarker(marker)
  if (!parsed) {
    await removeOwnedOutput(marker, markerIdentity, unlinkOutput)
    return
  }
  if (parsed.destination !== destination || parsed.metadata !== metadata)
    throw new Error('incomplete publish marker does not match requested outputs')
  if (now() - parsed.createdAt < MAX_ACTIVE_MARKER_AGE_MS && isOwnerAlive(parsed.owner))
    throw new Error('repository bundle publication is in progress')
  await removeOwnedOutput(destination, parsed.bundleIdentity, removeOutput)
  await removeOwnedOutput(metadata, parsed.metadataIdentity, removeOutput)
  await removeOwnedOutput(marker, markerIdentity, unlinkOutput)
}

function readMarker(path: string): PublishMarker | undefined {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size > MAX_MARKER_BYTES) return undefined
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return isMarker(value) ? value : undefined
  } catch {
    return undefined
  }
}

function isMarker(value: unknown): value is PublishMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const marker = value as Partial<PublishMarker>
  return (
    marker.version === 1 &&
    isOutputIdentity(marker.bundleIdentity) &&
    typeof marker.createdAt === 'number' &&
    Number.isSafeInteger(marker.createdAt) &&
    marker.createdAt > 0 &&
    typeof marker.destination === 'string' &&
    typeof marker.metadata === 'string' &&
    isOutputIdentity(marker.metadataIdentity) &&
    typeof marker.owner === 'number' &&
    Number.isSafeInteger(marker.owner) &&
    marker.owner > 0 &&
    typeof marker.token === 'string' &&
    /^[0-9a-f-]{36}$/i.test(marker.token)
  )
}

async function removeOutput(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true })
}

async function unlinkOutput(path: string): Promise<void> {
  await rm(path, { force: true })
}
