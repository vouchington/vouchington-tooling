import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatDiagnosticReportSummaries,
  MAX_DIAGNOSTIC_REPORT_BYTES,
  readDiagnosticReportSummaries,
  summarizeDiagnosticReport,
} from './index.mts'

const SAMPLE_REPORT = {
  header: {
    trigger: 'FatalError',
    event: 'Allocation failed - JavaScript heap out of memory',
    threadId: 0,
  },
  javascriptHeap: { usedMemory: 83_886_080, totalMemory: 92_274_688, memoryLimit: 4_294_967_296 },
  resourceUsage: { maxRss: 137_592_832 },
  nativeStack: [
    {
      symbol: 'node::TriggerNodeReport(node::Environment*) [/opt/example/node/bin/node]',
    },
  ],
}

describe('summarizeDiagnosticReport', () => {
  it('extracts only the allowlisted fields and converts bytes to MiB', () => {
    expect(summarizeDiagnosticReport('report.json', SAMPLE_REPORT)).toEqual({
      file: 'report.json',
      trigger: 'FatalError',
      event: 'Allocation failed - JavaScript heap out of memory',
      threadId: 0,
      heapUsedMB: '80.0',
      heapTotalMB: '88.0',
      heapLimitMB: '4096.0',
      maxRssMB: '131.2',
      topNativeFrameModule: '/opt/example/node/bin/node',
    })
  })

  it('never surfaces a raw native frame symbol', () => {
    const summary = summarizeDiagnosticReport('report.json', SAMPLE_REPORT)
    expect(JSON.stringify(summary)).not.toContain('node::TriggerNodeReport')
  })

  it('defensively handles malformed values', () => {
    expect(
      summarizeDiagnosticReport('empty.json', {
        header: { trigger: 'line one\nline two', event: 42, threadId: 1.5 },
        javascriptHeap: { usedMemory: -1, totalMemory: Number.POSITIVE_INFINITY },
        resourceUsage: null,
        nativeStack: [{ symbol: 'frame_without_a_module_suffix' }],
      }),
    ).toEqual({
      file: 'empty.json',
      trigger: 'line one line two',
      event: 'unknown',
      threadId: null,
      heapUsedMB: '0.0',
      heapTotalMB: '0.0',
      heapLimitMB: '0.0',
      maxRssMB: '0.0',
      topNativeFrameModule: null,
    })
  })

  it('uses fallbacks for empty text and non-object report sections', () => {
    expect(summarizeDiagnosticReport(' \n ', [])).toMatchObject({
      file: 'unknown',
      trigger: 'unknown',
      event: 'unknown',
      threadId: null,
      topNativeFrameModule: null,
    })
    expect(
      summarizeDiagnosticReport('report.json', {
        header: { trigger: '  ', event: '' },
        nativeStack: [{ symbol: 42 }],
      }),
    ).toMatchObject({ trigger: 'unknown', event: 'unknown', topNativeFrameModule: null })
  })

  it('extracts a bounded module only from the first native frame', () => {
    expect(
      summarizeDiagnosticReport('report.json', {
        nativeStack: [{ symbol: 'first frame [/first]' }, { symbol: 'second frame [/second]' }],
      }).topNativeFrameModule,
    ).toBe('/first')
    expect(summarizeDiagnosticReport('report.json', { nativeStack: 'not-an-array' })).toMatchObject(
      {
        topNativeFrameModule: null,
      },
    )
    expect(
      summarizeDiagnosticReport('report.json', { nativeStack: [{ symbol: 'frame [   ]' }] }),
    ).toMatchObject({ topNativeFrameModule: null })
    expect(
      summarizeDiagnosticReport('report.json', {
        nativeStack: [{ symbol: 'private frame [private-data]' }],
      }),
    ).toMatchObject({ topNativeFrameModule: null })
    expect(
      summarizeDiagnosticReport('report.json', {
        nativeStack: [{ symbol: String.raw`frame [C:\node\node.exe]` }],
      }),
    ).toMatchObject({ topNativeFrameModule: String.raw`C:\node\node.exe` })
  })

  it('bounds untrusted strings', () => {
    const summary = summarizeDiagnosticReport(`${'f'.repeat(400)}.json`, {
      header: { trigger: 't'.repeat(400), event: 'e'.repeat(400) },
      nativeStack: [{ symbol: `frame [/${'m'.repeat(400)}]` }],
    })

    expect(summary.file.length).toBeLessThanOrEqual(240)
    expect(summary.trigger.length).toBeLessThanOrEqual(200)
    expect(summary.event.length).toBeLessThanOrEqual(200)
    expect(summary.topNativeFrameModule?.length).toBeLessThanOrEqual(240)
  })

  it('bounds normalization work and malformed native-symbol scanning', () => {
    const summary = summarizeDiagnosticReport('report.json', {
      header: { trigger: `${' '.repeat(1_000_000)}hidden`, event: 'e'.repeat(1_000_000) },
      nativeStack: [{ symbol: `${'['.repeat(1_000_000)}private-data` }],
    })

    expect(summary).toMatchObject({
      trigger: 'unknown',
      event: 'e'.repeat(200),
      topNativeFrameModule: null,
    })
  })
})

describe('readDiagnosticReportSummaries', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  function makeDirectory() {
    const directory = mkdtempSync(join(tmpdir(), 'vitest-diagnostics-'))
    directories.push(directory)
    return directory
  }

  it('returns an empty array for a missing directory', () => {
    expect(readDiagnosticReportSummaries(join(tmpdir(), 'missing-vitest-diagnostics'))).toEqual([])
  })

  it('sorts reports and skips non-JSON and torn files', () => {
    const directory = makeDirectory()
    writeFileSync(join(directory, 'z.json'), JSON.stringify(SAMPLE_REPORT))
    writeFileSync(join(directory, 'a.json'), JSON.stringify({}))
    writeFileSync(join(directory, 'torn.json'), '{"header":')
    writeFileSync(join(directory, 'ignored.txt'), '{}')

    expect(readDiagnosticReportSummaries(directory).map((summary) => summary.file)).toEqual([
      'a.json',
      'z.json',
    ])
  })

  it('bounds attempted files even when early candidates are torn', () => {
    const directory = makeDirectory()
    writeFileSync(join(directory, 'a-torn.json'), '{')
    writeFileSync(join(directory, 'b-valid.json'), JSON.stringify(SAMPLE_REPORT))

    expect(readDiagnosticReportSummaries(directory, { maxReports: 1 })).toEqual([])
    expect(readDiagnosticReportSummaries(directory, { maxReports: 2 })).toHaveLength(1)
  })

  it('skips diagnostic files that exceed the per-report byte limit', () => {
    const directory = makeDirectory()
    const oversized = join(directory, 'oversized.json')
    writeFileSync(oversized, '{}')
    truncateSync(oversized, MAX_DIAGNOSTIC_REPORT_BYTES + 1)
    writeFileSync(join(directory, 'report.json'), JSON.stringify(SAMPLE_REPORT))

    expect(readDiagnosticReportSummaries(directory).map((summary) => summary.file)).toEqual([
      'report.json',
    ])
  })

  it('skips non-regular directory entries without reading them', () => {
    const directory = makeDirectory()
    mkdirSync(join(directory, 'not-a-report.json'))
    writeFileSync(join(directory, 'report.json'), JSON.stringify(SAMPLE_REPORT))

    expect(readDiagnosticReportSummaries(directory).map((summary) => summary.file)).toEqual([
      'report.json',
    ])
  })

  it('caps structured output', () => {
    const directory = makeDirectory()
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(directory, `${index}.json`), JSON.stringify({}))
    }

    expect(readDiagnosticReportSummaries(directory, { maxReports: 2 })).toHaveLength(2)
    expect(readDiagnosticReportSummaries(directory, { maxReports: 10_000 })).toHaveLength(5)
    expect(readDiagnosticReportSummaries(directory, { maxReports: 0 })).toEqual([])
  })

  it('uses the bounded default for non-finite report limits', () => {
    const directory = makeDirectory()
    writeFileSync(join(directory, 'report.json'), JSON.stringify([]))

    expect(readDiagnosticReportSummaries(directory, { maxReports: Number.NaN })).toHaveLength(1)
    expect(
      readDiagnosticReportSummaries(directory, { maxReports: Number.POSITIVE_INFINITY }),
    ).toHaveLength(1)
  })
})

describe('formatDiagnosticReportSummaries', () => {
  it('formats a stable empty result', () => {
    expect(formatDiagnosticReportSummaries([])).toBe(
      '[vitest-diagnostics]\nreports provided: 0\n  (none recorded)\n',
    )
  })

  it('labels unavailable thread and native-frame details explicitly', () => {
    const summary = summarizeDiagnosticReport('empty.json', {
      header: { threadId: 'invalid' },
      nativeStack: [{ symbol: 'frame_without_a_module_suffix' }],
    })

    expect(formatDiagnosticReportSummaries([summary])).toContain(
      'threadId=unknown heapUsedMB=0.0 heapTotalMB=0.0 heapLimitMB=0.0 maxRssMB=0.0 topNativeFrameModule=none',
    )
  })

  it('sanitizes summaries constructed by public API callers', () => {
    const untrusted = {
      ...summarizeDiagnosticReport('report.json', SAMPLE_REPORT),
      file: `report.json\n\u001B[2Jinjected=${'x'.repeat(400)}`,
      heapUsedMB: '1.0\u202Einjected=true',
      threadId: -1,
      topNativeFrameModule: null,
    }
    const output = formatDiagnosticReportSummaries([untrusted])

    expect(output).not.toContain('\ninjected')
    expect(output).not.toContain('\u001B')
    expect(output).not.toContain('\u202E')
    expect(output).toContain('threadId=unknown')
    expect(output).toContain('topNativeFrameModule=none')
    expect(output.split('\n')).toHaveLength(4)
  })

  it('uses fallbacks for malformed summary entries', () => {
    const output = formatDiagnosticReportSummaries([null, 'invalid'])

    expect(output).toContain('reports provided: 2')
    expect(output.match(/file=unknown/g)).toHaveLength(2)
    expect(output).toContain('threadId=unknown')
  })

  it('caps formatted output and reports the remainder', () => {
    const summaries = Array.from({ length: 25 }, (_, index) =>
      summarizeDiagnosticReport(`report-${index}.json`, SAMPLE_REPORT),
    )
    const output = formatDiagnosticReportSummaries(summaries)

    expect(output).toContain('reports provided: 25')
    expect(output).toContain('report-19.json')
    expect(output).not.toContain('report-20.json')
    expect(output).toContain('... 5 more')
  })

  it('honors a lower caller cap but never an unbounded one', () => {
    const summaries = Array.from({ length: 150 }, (_, index) =>
      summarizeDiagnosticReport(`report-${index}.json`, SAMPLE_REPORT),
    )

    expect(formatDiagnosticReportSummaries(summaries, { maxReports: 1 })).toContain('... 149 more')
    expect(formatDiagnosticReportSummaries(summaries, { maxReports: 10_000 })).not.toContain(
      'report-100.json',
    )
  })

  it('formats no summaries when the caller cap is zero but retains the remainder count', () => {
    const summaries = [summarizeDiagnosticReport('report.json', SAMPLE_REPORT)]

    expect(formatDiagnosticReportSummaries(summaries, { maxReports: 0 })).toBe(
      '[vitest-diagnostics]\nreports provided: 1\n  ... 1 more\n',
    )
    expect(formatDiagnosticReportSummaries(summaries, { maxReports: Number.NaN })).toContain(
      'report.json',
    )
  })
})
