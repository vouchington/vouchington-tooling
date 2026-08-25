export function tailText(tail: Buffer, maxBytes: number): string {
  const bounded = tail.subarray(Math.max(0, tail.length - maxBytes))
  for (let index = 0; index < Math.min(4, bounded.length); index += 1) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bounded.subarray(index))
    } catch {}
  }
  return ''
}
