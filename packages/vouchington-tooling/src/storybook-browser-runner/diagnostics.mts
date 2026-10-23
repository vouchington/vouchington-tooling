const MAX_DIAGNOSTIC_BYTES = 1024 * 1024
const MAX_OUTPUT_TAIL_BYTES = 960 * 1024
const truncatedMarker = Buffer.from('[diagnostic output truncated]\n')

export class StorybookBrowserDiagnostics {
  private readonly summaries: string[] = []
  private outputTail = Buffer.alloc(0)
  private outputTruncated = false

  recordOutput(chunk: string | Buffer): void {
    const next = Buffer.concat([this.outputTail, Buffer.from(chunk)])
    if (next.byteLength <= MAX_OUTPUT_TAIL_BYTES) {
      this.outputTail = next
      return
    }
    this.outputTruncated = true
    this.outputTail = next.subarray(next.byteLength - MAX_OUTPUT_TAIL_BYTES)
  }

  recordAttempt(summary: string): void {
    this.summaries.push(summary.trimEnd())
  }

  render(): Buffer {
    const summary = Buffer.from(
      `${['[storybook-browser-diagnostics]', ...this.summaries, 'output tail:'].join('\n')}\n`,
    )
    const prefix = this.outputTruncated ? Buffer.concat([summary, truncatedMarker]) : summary
    const available = Math.max(0, MAX_DIAGNOSTIC_BYTES - prefix.byteLength)
    const tail =
      this.outputTail.byteLength <= available
        ? this.outputTail
        : this.outputTail.subarray(this.outputTail.byteLength - available)
    return Buffer.concat([prefix, tail]).subarray(0, MAX_DIAGNOSTIC_BYTES)
  }
}
