import type { Reporter, TestCase, TestModule } from 'vitest/node'

export const DEFAULT_STORYBOOK_PROGRESS_PREFIX = '[vitest-browser-progress]'
const MAX_MARKER_BYTES = 512
const MAX_MODULE_ID_CHARS = 400
const MAX_TEST_NAME_CHARS = 160
const MAX_SEQUENCE_DIGITS = 10
// Bytes of the marker kept for the test field, taken from the module budget.
const TEST_RESERVE_BYTES = 200

/**
 * `module-*` events are semantic progress. `test-start` and `test-end` only name the running test
 * for the stall diagnostics and never count as progress.
 */
export type StorybookProgressEvent =
  | 'module-collected'
  | 'module-start'
  | 'module-end'
  | 'test-start'
  | 'test-end'

type WriteProgress = (chunk: string) => void

export interface StorybookProgressReporterOptions {
  write?: WriteProgress
  /** Marker prefix for each line. Defaults to `DEFAULT_STORYBOOK_PROGRESS_PREFIX`. */
  prefix?: string
}

class VitestStorybookProgressReporter implements Reporter {
  private sequence = 0
  private readonly write: WriteProgress
  private readonly prefix: string

  constructor(write: WriteProgress, prefix: string) {
    this.write = write
    this.prefix = prefix
  }

  onTestRunStart(): void {
    this.sequence = 0
  }

  onTestModuleCollected(testModule: TestModule): void {
    this.emit('module-collected', testModule)
  }

  onTestModuleStart(testModule: TestModule): void {
    this.emit('module-start', testModule)
  }

  onTestModuleEnd(testModule: TestModule): void {
    this.emit('module-end', testModule)
  }

  onTestCaseReady(testCase: TestCase): void {
    this.emit('test-start', testCase.module, testCase.fullName)
  }

  onTestCaseResult(testCase: TestCase): void {
    this.emit('test-end', testCase.module, testCase.fullName)
  }

  private emit(event: StorybookProgressEvent, testModule: TestModule, testName?: string): void {
    this.sequence += 1
    this.write(
      formatStorybookProgressMarker(
        this.sequence,
        event,
        testModule.relativeModuleId || testModule.moduleId,
        this.prefix,
        testName,
      ),
    )
  }
}

export function createVitestStorybookProgressReporter(
  options: StorybookProgressReporterOptions = {},
): VitestStorybookProgressReporter {
  return new VitestStorybookProgressReporter(
    options.write ?? ((chunk) => process.stdout.write(chunk)),
    options.prefix ?? DEFAULT_STORYBOOK_PROGRESS_PREFIX,
  )
}

export function formatStorybookProgressMarker(
  sequence: number,
  event: StorybookProgressEvent,
  moduleId: string,
  prefix: string = DEFAULT_STORYBOOK_PROGRESS_PREFIX,
  testName?: string,
): string {
  const head = `${prefix} seq=${sequence} event=${event} module=`
  // The module budget assumes the longest event and sequence, so every event spells one module the
  // same way and the tracker keys it consistently; the test gets what the module leaves.
  const worstHead = `${prefix} seq=${'9'.repeat(MAX_SEQUENCE_DIGITS)} event=module-collected module=`
  const moduleBudget = MAX_MARKER_BYTES - 1 - Buffer.byteLength(worstHead) - TEST_RESERVE_BYTES
  const module = boundedJson(moduleId, MAX_MODULE_ID_CHARS, moduleBudget)
  if (module == null) return `${head}""\n`
  const prefixed = `${head}${module}`
  if (testName == null) return `${prefixed}\n`
  const testBudget = MAX_MARKER_BYTES - 1 - Buffer.byteLength(`${prefixed} test=`)
  const test = boundedJson(testName, MAX_TEST_NAME_CHARS, testBudget)
  return test == null ? `${prefixed}\n` : `${prefixed} test=${test}\n`
}

/** `text` as a JSON string within `maxChars` characters and `maxBytes` bytes, or null if none fits. */
function boundedJson(text: string, maxChars: number, maxBytes: number): string | null {
  const points = Array.from(text)
  for (let keep = Math.min(points.length, maxChars); keep >= 0; keep -= 1) {
    const suffix = keep < points.length ? '…' : ''
    const json = JSON.stringify(`${points.slice(0, keep).join('')}${suffix}`)
    if (Buffer.byteLength(json) <= maxBytes) return json
  }
  return null
}

export function latestStorybookProgressSequence(
  text: string,
  prefix: string = DEFAULT_STORYBOOK_PROGRESS_PREFIX,
): number | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`${escaped} seq=(\\d+) event=module-(?:collected|start|end)\\b`, 'g')
  let latest: number | null = null
  for (const match of text.matchAll(pattern)) {
    const sequence = Number(match[1])
    if (Number.isSafeInteger(sequence)) latest = Math.max(latest ?? 0, sequence)
  }
  return latest
}
