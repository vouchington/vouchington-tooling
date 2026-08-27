import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { writeMarkerAtomic } from './marker-write.mts'
import {
  moveAtomic,
  outputIdentity,
  removeOwnedOutput,
  type OutputIdentity,
} from './output-identity.mts'
import { outputExists, publishMarkerPath } from './publish-recovery.mts'

export { outputExists, publishMarkerPath, recoverIncompletePublish } from './publish-recovery.mts'

const MAX_MARKER_BYTES = 4096

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

export async function publishBundle(
  bundle: string,
  destination: string,
  metadata: string,
  metadataDestination: string,
  move: (from: string, to: string) => Promise<void> = moveAtomic,
  writeMarker: (path: string, contents: string) => Promise<void> = writeMarkerAtomic,
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
): {
  bundleIdentity: OutputIdentity
  createdAt: number
  destination: string
  metadata: string
  metadataIdentity: OutputIdentity
  owner: number
  token: string
  version: 1
} {
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
