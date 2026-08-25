export class TailQueue {
  readonly chunks: Buffer[] = []
  bytes = 0

  constructor(readonly maxBytes: number) {}

  append(text: string): void {
    const chunk = Buffer.from(text)
    if (chunk.length >= this.maxBytes) {
      this.chunks.splice(0, this.chunks.length, chunk.subarray(-this.maxBytes))
      this.bytes = this.maxBytes
      return
    }
    this.chunks.push(chunk)
    this.bytes += chunk.length
    while (this.bytes > this.maxBytes) {
      const first = this.chunks[0]!
      const overflow = this.bytes - this.maxBytes
      if (first.length <= overflow) this.chunks.shift()
      else this.chunks[0] = first.subarray(overflow)
      this.bytes -= Math.min(first.length, overflow)
    }
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.bytes)
  }
}
