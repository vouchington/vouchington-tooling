export const LOG_OMISSION_MARKER = '\n[...job log middle omitted...]\n'

export interface LogLimits {
  /** Bytes kept from the start of each job log. */
  headBytes: number
  /** Bytes kept from the end of each job log. */
  tailBytes: number
  /** Most bytes read from one job log stream before the rest is abandoned. */
  maxReadBytes: number
  /** Most bytes retained across every job log of one run context. */
  totalBytes: number
}

export const DEFAULT_LOG_LIMITS: LogLimits = {
  headBytes: 256 * 1024,
  tailBytes: 512 * 1024,
  maxReadBytes: 64 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
}

/**
 * Reads a log stream keeping only a head and a tail window, so memory stays bounded by the limits
 * rather than by the log size. Bytes between the windows are replaced by an omission marker.
 */
export async function collectDiagnosticWindow(
  stream: AsyncIterable<Buffer>,
  { headBytes, tailBytes, maxReadBytes }: LogLimits,
): Promise<string> {
  const head: Buffer[] = []
  const tail: Buffer[] = []
  let headLength = 0
  let tailLength = 0
  let total = 0
  let capped = false
  for await (let chunk of stream) {
    if (total + chunk.byteLength > maxReadBytes) {
      chunk = chunk.subarray(0, maxReadBytes - total)
      capped = true
    }
    total += chunk.byteLength
    const headPart = chunk.subarray(0, headBytes - headLength)
    head.push(headPart)
    headLength += headPart.byteLength
    tail.push(chunk)
    tailLength += chunk.byteLength
    while (tailLength > tailBytes) {
      const excess = tailLength - tailBytes
      const first = tail[0]!
      if (first.byteLength <= excess) tail.shift()
      else tail[0] = first.subarray(excess)
      tailLength -= Math.min(first.byteLength, excess)
    }
    if (capped) break
  }
  const headBuffer = Buffer.concat(head)
  const tailBuffer = Buffer.concat(tail)
  if (capped || total > headBytes + tailBytes) {
    return headBuffer.toString('utf8') + LOG_OMISSION_MARKER + tailBuffer.toString('utf8')
  }
  const unseen = total - headBuffer.byteLength
  return (
    headBuffer.toString('utf8') +
    tailBuffer.subarray(tailBuffer.byteLength - unseen).toString('utf8')
  )
}

export function fitDiagnosticWindow(log: string, maxBytes: number): string {
  if (Buffer.byteLength(log) <= maxBytes) return log
  const markerBytes = Buffer.byteLength(LOG_OMISSION_MARKER)
  if (maxBytes <= markerBytes) return takeUtf8Suffix(log, maxBytes)

  const contentBytes = maxBytes - markerBytes
  const headBytes = Math.floor(contentBytes / 3)
  return (
    takeUtf8Prefix(log, headBytes) +
    LOG_OMISSION_MARKER +
    takeUtf8Suffix(log, contentBytes - headBytes)
  )
}

function takeUtf8Prefix(value: string, maxBytes: number): string {
  let bytes = 0
  let end = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character)
    if (bytes + characterBytes > maxBytes) break
    bytes += characterBytes
    end += character.length
  }
  return value.slice(0, end)
}

function takeUtf8Suffix(value: string, maxBytes: number): string {
  let bytes = 0
  let start = value.length
  while (start > 0) {
    let characterStart = start - 1
    const trailing = value.charCodeAt(characterStart)
    if (trailing >= 0xdc00 && trailing <= 0xdfff && characterStart > 0) {
      const leading = value.charCodeAt(characterStart - 1)
      if (leading >= 0xd800 && leading <= 0xdbff) characterStart -= 1
    }
    const characterBytes = Buffer.byteLength(value.slice(characterStart, start))
    if (bytes + characterBytes > maxBytes) break
    bytes += characterBytes
    start = characterStart
  }
  return value.slice(start)
}
