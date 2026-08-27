import { MAX_BLOB_BYTES } from './github.mts'

export function decodeBlobContent(
  encoded: string,
  path: string,
  maxBytes = MAX_BLOB_BYTES,
): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new Error(`invalid blob encoding: ${path}`)
  const content = Buffer.from(encoded, 'base64')
  if (content.toString('base64') !== encoded) throw new Error(`invalid blob encoding: ${path}`)
  if (content.length > maxBytes) throw new Error(`source blob exceeds size limit: ${path}`)
  return content
}
