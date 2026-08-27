import { existsSync, readFileSync } from 'node:fs'
import { rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

interface PublishMarker {
  destination: string
  metadata: string
}

function publishMarkerPath(destination: string): string {
  return join(dirname(destination), `.${basename(destination)}.fetch-incomplete`)
}

async function discardFailedPublish(
  destination: string,
  metadata: string,
  marker: string,
): Promise<void> {
  await Promise.all([
    rm(destination, { force: true, recursive: true }),
    rm(metadata, { force: true, recursive: true }),
    rm(marker, { force: true }),
  ])
}

export async function recoverIncompletePublish(
  destination: string,
  metadata: string,
): Promise<void> {
  const marker = publishMarkerPath(destination)
  if (!existsSync(marker)) return
  const parsed = JSON.parse(readFileSync(marker, 'utf8')) as Partial<PublishMarker>
  if (parsed.destination !== destination || parsed.metadata !== metadata) {
    throw new Error('incomplete publish marker does not match requested outputs')
  }
  await rm(destination, { force: true, recursive: true })
  await rm(metadata, { force: true, recursive: true })
  await rm(marker, { force: true })
}

export async function publishBundle(
  bundle: string,
  destination: string,
  metadata: string,
  metadataDestination: string,
  move: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  const marker = publishMarkerPath(destination)
  await writeFile(marker, `${JSON.stringify({ destination, metadata: metadataDestination })}\n`, {
    mode: 0o600,
  })
  try {
    await move(bundle, destination)
    await move(metadata, metadataDestination)
    await rm(marker, { force: true })
  } catch (error) {
    await discardFailedPublish(destination, metadataDestination, marker)
    throw error
  }
}
