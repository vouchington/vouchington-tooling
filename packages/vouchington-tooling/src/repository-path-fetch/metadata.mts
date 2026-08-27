export const MAX_FETCH_METADATA_BYTES = 4 * 1024 * 1024

export function serializeFetchMetadata(metadata: unknown): string {
  const contents = `${JSON.stringify(metadata, null, 2)}\n`
  if (Buffer.byteLength(contents) > MAX_FETCH_METADATA_BYTES)
    throw new Error('repository metadata exceeds size limit')
  return contents
}
