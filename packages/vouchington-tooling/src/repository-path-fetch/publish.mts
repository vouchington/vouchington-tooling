import { randomUUID } from 'node:crypto'
import { constants, lstatSync, readFileSync } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

interface PublishMarker {
  destination: string
  metadata: string
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
  removeOutput: (path: string) => Promise<void>,
): Promise<void> {
  if (publishedBundle) await removeOutput(destination)
  if (publishedMetadata) await removeOutput(metadata)
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
  await rm(destination, { force: true, recursive: true })
  await rm(metadata, { force: true, recursive: true })
  await rm(marker, { force: true })
}

export async function publishBundle(
  bundle: string,
  destination: string,
  metadata: string,
  metadataDestination: string,
  move: (from: string, to: string) => Promise<void> = moveNoReplace,
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
  if (outputExists(destination) || outputExists(metadataDestination))
    throw new Error('output already exists')
  try {
    await writeMarker(marker, `${JSON.stringify(markerRecord(destination, metadataDestination))}\n`)
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
      removeOutput,
    )
    throw error
  }
}

async function moveNoReplace(from: string, to: string): Promise<void> {
  let created = false
  try {
    const stat = await lstat(from)
    if (stat.isDirectory()) {
      await mkdir(to, { mode: 0o700 })
      created = true
      await copyDirectoryContents(from, to)
      await chmod(to, stat.mode & 0o777)
    } else if (stat.isFile()) {
      await copyFile(from, to, constants.COPYFILE_EXCL)
      created = true
      await chmod(to, stat.mode & 0o777)
    } else {
      throw new Error('unsupported staged output')
    }
    await rm(from, { recursive: stat.isDirectory() })
  } catch (error) {
    if (created) await rm(to, { force: true, recursive: true })
    throw error
  }
}

async function copyDirectoryContents(from: string, to: string): Promise<void> {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const destination = join(to, entry.name)
    const stat = await lstat(source)
    if (entry.isDirectory()) {
      await mkdir(destination, { mode: 0o700 })
      await copyDirectoryContents(source, destination)
      await chmod(destination, stat.mode & 0o777)
    } else if (entry.isFile()) {
      await copyFile(source, destination, constants.COPYFILE_EXCL)
      await chmod(destination, stat.mode & 0o777)
    } else {
      throw new Error('unsupported staged output')
    }
  }
}

function markerRecord(destination: string, metadata: string): PublishMarker {
  return { destination, metadata, owner: process.pid, token: randomUUID(), version: 1 }
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
    typeof marker.destination === 'string' &&
    typeof marker.metadata === 'string' &&
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
