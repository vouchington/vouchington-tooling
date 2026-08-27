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

interface PublishMarker {
  bundleIdentity: OutputIdentity
  destination: string
  metadata: string
  metadataIdentity: OutputIdentity
  owner: number
  token: string
  version: 1
}

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
  removeOutput: (path: string) => Promise<void>,
): Promise<void> {
  if (publishedBundle) await removeOwnedOutput(destination, bundleIdentity, removeOutput)
  if (publishedMetadata) await removeOwnedOutput(metadata, metadataIdentity, removeOutput)
  await rm(marker, { force: true })
}

export async function recoverIncompletePublish(
  destination: string,
  metadata: string,
  isOwnerAlive: (owner: number) => boolean = ownerIsAlive,
): Promise<void> {
  const marker = publishMarkerPath(destination)
  if (!outputExists(marker)) return
  const parsed = readMarker(marker)
  if (!parsed) {
    await rm(marker, { force: true })
    return
  }
  if (parsed.destination !== destination || parsed.metadata !== metadata) {
    throw new Error('incomplete publish marker does not match requested outputs')
  }
  if (isOwnerAlive(parsed.owner)) throw new Error('repository bundle publication is in progress')
  await removeOwnedOutput(destination, parsed.bundleIdentity, async (path) => {
    await rm(path, { force: true, recursive: true })
  })
  await removeOwnedOutput(metadata, parsed.metadataIdentity, async (path) => {
    await rm(path, { force: true, recursive: true })
  })
  await rm(marker, { force: true })
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
  if (outputExists(destination) || outputExists(metadataDestination))
    throw new Error('output already exists')
  try {
    await writeMarker(
      marker,
      `${JSON.stringify(
        markerRecord(destination, metadataDestination, bundleIdentity, metadataIdentity),
      )}\n`,
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('output already exists')
    throw error
  }
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
    await removeMarker(marker)
  } catch (error) {
    await discardFailedPublish(
      destination,
      metadataDestination,
      marker,
      publishedBundle,
      publishedMetadata,
      bundleIdentity,
      metadataIdentity,
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
    if (!stat.isFile() || stat.size > 1024) return undefined
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
function ownerIsAlive(owner: number): boolean {
  try {
    process.kill(owner, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    throw error
  }
}
