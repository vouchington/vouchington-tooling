import { randomUUID } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  isOutputIdentity,
  moveAtomic,
  outputIdentity,
  removeOwnedOutput,
  type OutputIdentity,
} from './output-identity.mts'
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

async function discardFailedPublish(
  destination: string,
  metadata: string,
  marker: string,
  publishedBundle: boolean,
  publishedMetadata: boolean,
  bundleIdentity: OutputIdentity,
  metadataIdentity: OutputIdentity,
  markerIdentity: OutputIdentity,
  removeMarker: (path: string) => Promise<void>,
  removeOutput: (path: string) => Promise<void>,
): Promise<void> {
  if (publishedBundle) await removeOwnedOutput(destination, bundleIdentity, removeOutput)
  if (publishedMetadata) await removeOwnedOutput(metadata, metadataIdentity, removeOutput)
  await removeOwnedOutput(marker, markerIdentity, removeMarker)
}

export async function recoverIncompletePublish(
  destination: string,
  metadata: string,
  isOwnerAlive: (owner: number) => boolean = ownerIsAlive,
  now: () => number = Date.now,
): Promise<void> {
  const marker = publishMarkerPath(destination)
  if (!outputExists(marker)) return
  const markerIdentity = await outputIdentity(marker)
  const parsed = readMarker(marker)
  if (!parsed) {
    await removeOwnedOutput(marker, markerIdentity, unlinkOutput)
    return
  }
  if (parsed.destination !== destination || parsed.metadata !== metadata) {
    throw new Error('incomplete publish marker does not match requested outputs')
  }
  if (now() - parsed.createdAt < MAX_ACTIVE_MARKER_AGE_MS && isOwnerAlive(parsed.owner))
    throw new Error('repository bundle publication is in progress')
  await removeOwnedOutput(destination, parsed.bundleIdentity, async (path) => {
    await rm(path, { force: true, recursive: true })
  })
  await removeOwnedOutput(metadata, parsed.metadataIdentity, async (path) => {
    await rm(path, { force: true, recursive: true })
  })
  await removeOwnedOutput(marker, markerIdentity, unlinkOutput)
}

export async function publishBundle(
  bundle: string,
  destination: string,
  metadata: string,
  metadataDestination: string,
  move: (from: string, to: string) => Promise<void> = moveAtomic,
  writeMarker: (path: string, contents: string) => Promise<void> = async (path, contents) => {
    await writeFile(path, contents, { flag: 'wx', mode: 0o600 })
  },
  removeMarker: (path: string) => Promise<void> = async (path) => {
    await rm(path, { force: true })
  },
  removeOutput: (path: string) => Promise<void> = async (path) => {
    await rm(path, { force: true, recursive: true })
  },
): Promise<void> {
  const marker = publishMarkerPath(destination)
  const bundleIdentity = await outputIdentity(bundle)
  const metadataIdentity = await outputIdentity(metadata)
  const markerContents = `${JSON.stringify(
    markerRecord(destination, metadataDestination, bundleIdentity, metadataIdentity),
  )}\n`
  if (Buffer.byteLength(markerContents) > MAX_MARKER_BYTES)
    throw new Error('output paths are too long for recovery metadata')
  if (outputExists(destination) || outputExists(metadataDestination))
    throw new Error('output already exists')
  try {
    await writeMarker(marker, markerContents)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('output already exists')
    throw error
  }
  const markerIdentity = await outputIdentity(marker)
  let publishedBundle = false
  let publishedMetadata = false
  try {
    if (outputExists(destination) || outputExists(metadataDestination))
      throw new Error('output already exists')
    await move(bundle, destination)
    publishedBundle = true
    if (outputExists(metadataDestination)) throw new Error('output already exists')
    await move(metadata, metadataDestination)
    publishedMetadata = true
    await removeOwnedOutput(marker, markerIdentity, removeMarker)
  } catch (error) {
    await discardFailedPublish(
      destination,
      metadataDestination,
      marker,
      publishedBundle,
      publishedMetadata,
      bundleIdentity,
      metadataIdentity,
      markerIdentity,
      removeMarker,
      removeOutput,
    )
    throw error
  }
}

function markerRecord(
  destination: string,
  metadata: string,
  bundleIdentity: OutputIdentity,
  metadataIdentity: OutputIdentity,
): PublishMarker {
  return {
    bundleIdentity,
    createdAt: Date.now(),
    destination,
    metadata,
    metadataIdentity,
    owner: process.pid,
    token: randomUUID(),
    version: 1,
  }
}
function readMarker(path: string): PublishMarker | undefined {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size > MAX_MARKER_BYTES) return undefined
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isMarker(value)) return undefined
    return value
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
async function unlinkOutput(path: string): Promise<void> {
  await rm(path, { force: true })
}
