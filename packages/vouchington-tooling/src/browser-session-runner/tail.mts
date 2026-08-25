export function tailText(tail: Buffer, maxBytes: number): string {
  const bounded = tail.subarray(Math.max(0, tail.length - maxBytes))
  for (let start = 0; start < Math.min(4, bounded.length); start += 1) {
    for (let end = 0; end < Math.min(4, bounded.length - start); end += 1) {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(
          bounded.subarray(start, bounded.length - end),
        )
      } catch {}
    }
  }
  return ''
}
