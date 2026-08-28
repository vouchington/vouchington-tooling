export function decodeUtf8(value: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    throw new Error('session-friction log is not valid UTF-8')
  }
}
