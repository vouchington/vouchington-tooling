import {
  hasStorybookBrowserViteDependencyReady,
  hasStorybookViteNewDependenciesFound,
  hasStorybookViteOptimizerReload,
  stripAnsi,
} from './vite-detectors.mts'

// Quiet lines are machine-consumed watchdog evidence. They stay out of the job log on success
// and are replayed from this bounded tail when an attempt fails.
export const MAX_QUIET_TAIL_BYTES = 128 * 1024
const viteDepsDebugPattern = /\bvite:deps\b/

const indentedContinuationPattern = /^ {2,}\S/

function isOptimizerLifecycleLine(plain: string): boolean {
  // Keep the optimizer lifecycle lines that classify retry and optimizeDeps guidance visible.
  return (
    hasStorybookBrowserViteDependencyReady(plain) ||
    hasStorybookViteNewDependenciesFound(plain) ||
    hasStorybookViteOptimizerReload(plain)
  )
}

export type QuietOutputSource = 'stderr' | 'stdout'

export class StorybookQuietOutput {
  private chunks: Buffer[] = []
  private bytes = 0
  private readonly progressPrefix: string
  // A vite:deps message lists its dependency paths on indented lines that carry no namespace.
  // The block is tracked per stream so interleaved output cannot extend it.
  private readonly inViteDepsBlock: Record<QuietOutputSource, boolean> = {
    stderr: false,
    stdout: false,
  }

  constructor(progressPrefix: string) {
    this.progressPrefix = progressPrefix
  }

  /** Returns the lines that belong in the job log and retains the quiet ones. */
  split(output: string, source: QuietOutputSource = 'stdout'): string {
    let visible = ''
    for (const line of output.split(/(?<=\r?\n|\r(?!\n))/)) {
      if (this.isQuiet(line, source)) this.retain(line)
      else visible += line
    }
    return visible
  }

  private isQuiet(line: string, source: QuietOutputSource): boolean {
    const plain = stripAnsi(line)
    const inBlock = this.inViteDepsBlock[source]
    this.inViteDepsBlock[source] = false
    if (plain.includes(this.progressPrefix)) return true
    if (isOptimizerLifecycleLine(plain)) return false
    if (viteDepsDebugPattern.test(plain)) {
      this.inViteDepsBlock[source] = true
      return true
    }
    this.inViteDepsBlock[source] = inBlock && indentedContinuationPattern.test(plain)
    return this.inViteDepsBlock[source]
  }

  /** Returns the retained quiet output once, or an empty string when there is none. */
  drain(): string {
    const text = Buffer.concat(this.chunks).toString('utf8')
    this.chunks = []
    this.bytes = 0
    return text
  }

  private retain(line: string): void {
    const encoded = Buffer.from(line)
    const chunk =
      encoded.byteLength > MAX_QUIET_TAIL_BYTES
        ? encoded.subarray(encoded.byteLength - MAX_QUIET_TAIL_BYTES)
        : encoded
    this.chunks.push(chunk)
    this.bytes += chunk.byteLength
    while (this.bytes > MAX_QUIET_TAIL_BYTES) {
      const oldest = this.chunks[0]!
      const excess = this.bytes - MAX_QUIET_TAIL_BYTES
      if (excess >= oldest.byteLength) this.chunks.shift()
      else this.chunks[0] = oldest.subarray(excess)
      this.bytes -= Math.min(excess, oldest.byteLength)
    }
  }
}

export function quietOutputHeader(bytes: number): string {
  return `[storybook-browser] attempt did not succeed; replaying suppressed progress markers and vite:deps debug output (last ${bytes} bytes):\n`
}
