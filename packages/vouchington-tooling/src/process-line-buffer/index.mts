export const DEFAULT_TRUNCATED_LINE_MARKER = ' [oversized line truncated] '
export const DEFAULT_MAX_PENDING_LINE_LENGTH = 64 * 1024

export function boundPendingLine(
  value: string,
  marker = DEFAULT_TRUNCATED_LINE_MARKER,
  maxLength = DEFAULT_MAX_PENDING_LINE_LENGTH,
): string {
  if (value.length <= maxLength) return value
  if (marker.length >= maxLength) return marker
  const retainedLength = maxLength - marker.length
  const headLength = Math.floor(retainedLength / 2)
  const tailLength = retainedLength - headLength
  return value.slice(0, headLength) + marker + value.slice(-tailLength)
}

export function splitCompleteLines(value: string): { complete: string[]; pending: string } {
  const complete: string[] = []
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character !== '\n' && character !== '\r') continue
    if (character === '\r' && index === value.length - 1) break
    if (character === '\r' && value[index + 1] === '\n') index += 1
    complete.push(value.slice(start, index + 1))
    start = index + 1
  }
  return { complete, pending: value.slice(start) }
}
