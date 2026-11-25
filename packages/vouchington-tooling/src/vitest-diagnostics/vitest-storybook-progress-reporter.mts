import type { Reporter, TestCase, TestModule } from 'vitest/node'

export const DEFAULT_STORYBOOK_PROGRESS_PREFIX = '[vitest-browser-progress]'
const MAX_MARKER_BYTES = 512
const MAX_MODULE_ID_CHARS = 400
const MAX_TEST_NAME_CHARS = 160

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
  const test =
    testName == null ? '' : ` test=${JSON.stringify(boundText(testName, MAX_TEST_NAME_CHARS))}`
  let boundedModuleId = moduleId.slice(0, MAX_MODULE_ID_CHARS)
  while (boundedModuleId.length > 0) {
    const suffix = boundedModuleId.length < moduleId.length ? '…' : ''
    const marker = `${head}${JSON.stringify(`${boundedModuleId}${suffix}`)}${test}\n`
    if (Buffer.byteLength(marker) <= MAX_MARKER_BYTES) return marker
    boundedModuleId = boundedModuleId.slice(0, -16)
  }
  return `${head}""\n`
}

function boundText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
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
