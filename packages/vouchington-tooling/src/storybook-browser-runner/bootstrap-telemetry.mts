import { stripAnsi } from './vite-detectors.mts'
import { boundPendingLine, splitCompleteLines } from '../process-line-buffer/index.mts'

type OutputStream = 'stderr' | 'stdout'

export type StorybookBrowserBootstrapMilestone =
  | 'context-ready'
  | 'navigation-requested'
  | 'orchestrator-connected'
  | 'page-ready'
  | 'provider-started'
  | 'semantic-progress'

type StorybookBrowserBootstrapTerminalStage =
  | 'context-to-page'
  | 'handshake-after-websocket'
  | 'launch-or-context'
  | 'navigation-to-websocket'
  | 'no-provider-evidence'
  | 'page-to-navigation'
  | 'semantic-progress'

export interface StorybookBrowserBootstrapSnapshot {
  orchestratorDisconnectCount: number
  requestFailureCount: number
  requestFailureSamples: string[]
  terminalStage: StorybookBrowserBootstrapTerminalStage
  timeline: Array<{ atMs: number; milestone: StorybookBrowserBootstrapMilestone }>
}

interface ConsumedOutput {
  hasNonDiagnosticOutput: boolean
  output: string
}

const maxRequestFailureLines = 20
const maxRequestFailureSamples = 5
const maxPlaywrightBrowserLines = 200
const maxSampleLength = 400

const diagnosticLinePattern =
  /\bvitest:browser:(?:api|playwright)\b|\bpw:(?:browser|protocol)\b|\[PW Error\]/
const providerStartedPattern =
  /\bvitest:browser:playwright\b.*(?:creating the browser page|initializing the browser)/
const contextReadyPattern = /\bvitest:browser:playwright\b.*the context is ready/
const pageReadyPattern = /\bvitest:browser:playwright\b.*the page is ready/
const navigationRequestedPattern =
  /\bvitest:browser:playwright\b.*browser page is created, opening /
const orchestratorConnectedPattern = /\bvitest:browser:api\b.*Browser API connected to orchestrator/
const orchestratorDisconnectedPattern =
  /\bvitest:browser:api\b.*Browser API disconnected from orchestrator/

const terminalStageByMilestone: Record<
  StorybookBrowserBootstrapMilestone,
  StorybookBrowserBootstrapTerminalStage
> = {
  'provider-started': 'launch-or-context',
  'context-ready': 'context-to-page',
  'page-ready': 'page-to-navigation',
  'navigation-requested': 'navigation-to-websocket',
  'orchestrator-connected': 'handshake-after-websocket',
  'semantic-progress': 'semantic-progress',
}
const milestoneRank: Record<StorybookBrowserBootstrapMilestone, number> = {
  'provider-started': 1,
  'context-ready': 2,
  'page-ready': 3,
  'navigation-requested': 4,
  'orchestrator-connected': 5,
  'semantic-progress': 6,
}

export class StorybookBrowserBootstrapTelemetry {
  private readonly lineBuffers: Record<OutputStream, string> = { stderr: '', stdout: '' }
  private readonly milestones = new Set<StorybookBrowserBootstrapMilestone>()
  private readonly requestFailureSamples: string[] = []
  private readonly timeline: StorybookBrowserBootstrapSnapshot['timeline'] = []
  private playwrightBrowserLineCount = 0
  private orchestratorDisconnectCount = 0
  private requestFailureCount = 0

  consume(stream: OutputStream, chunk: string | Buffer, atMs: number): ConsumedOutput {
    const combined = this.lineBuffers[stream] + String(chunk)
    const { complete, pending } = splitCompleteLines(combined)
    this.lineBuffers[stream] = boundPendingLine(pending)
    return this.consumeLines(complete, atMs)
  }

  flush(stream: OutputStream, atMs: number): ConsumedOutput {
    const pending = this.lineBuffers[stream]
    this.lineBuffers[stream] = ''
    return pending
      ? this.consumeLines([pending], atMs)
      : { hasNonDiagnosticOutput: false, output: '' }
  }

  recordSemanticProgress(atMs: number): void {
    this.recordMilestone('semantic-progress', atMs)
  }

  snapshot(): StorybookBrowserBootstrapSnapshot {
    const terminalMilestone = this.timeline.reduce<StorybookBrowserBootstrapMilestone | undefined>(
      (furthest, { milestone }) =>
        !furthest || milestoneRank[milestone] > milestoneRank[furthest] ? milestone : furthest,
      undefined,
    )
    return {
      orchestratorDisconnectCount: this.orchestratorDisconnectCount,
      requestFailureCount: this.requestFailureCount,
      requestFailureSamples: [...this.requestFailureSamples],
      terminalStage: terminalMilestone
        ? terminalStageByMilestone[terminalMilestone]
        : 'no-provider-evidence',
      timeline: [...this.timeline],
    }
  }

  private consumeLines(lines: string[], atMs: number): ConsumedOutput {
    let hasNonDiagnosticOutput = false
    let output = ''
    for (const line of lines) {
      const plainLine = stripAnsi(line)
      const trimmed = plainLine.trim()
      if (!trimmed) {
        output += line
        continue
      }
      this.observeLine(plainLine, atMs)
      const diagnostic = diagnosticLinePattern.test(plainLine)
      if (!diagnostic) hasNonDiagnosticOutput = true
      output += this.filterLine(line, plainLine)
    }
    return { hasNonDiagnosticOutput, output }
  }

  private observeLine(plainLine: string, atMs: number): void {
    if (providerStartedPattern.test(plainLine)) this.recordMilestone('provider-started', atMs)
    if (contextReadyPattern.test(plainLine)) this.recordMilestone('context-ready', atMs)
    if (pageReadyPattern.test(plainLine)) this.recordMilestone('page-ready', atMs)
    if (navigationRequestedPattern.test(plainLine)) {
      this.recordMilestone('navigation-requested', atMs)
    }
    if (orchestratorConnectedPattern.test(plainLine)) {
      this.recordMilestone('orchestrator-connected', atMs)
    }
    if (orchestratorDisconnectedPattern.test(plainLine)) {
      this.orchestratorDisconnectCount += 1
    }
    if (plainLine.includes('[PW Error]')) {
      this.requestFailureCount += 1
      if (this.requestFailureSamples.length < maxRequestFailureSamples) {
        this.requestFailureSamples.push(plainLine.trim().slice(0, maxSampleLength))
      }
    }
  }

  private filterLine(originalLine: string, plainLine: string): string {
    if (
      plainLine.includes('vitest:browser:api') &&
      !orchestratorConnectedPattern.test(plainLine) &&
      !orchestratorDisconnectedPattern.test(plainLine)
    ) {
      return ''
    }
    if (plainLine.includes('[PW Error]')) {
      if (this.requestFailureCount <= maxRequestFailureLines) return originalLine
      return this.requestFailureCount === maxRequestFailureLines + 1
        ? '[storybook-browser] suppressed additional request-failure diagnostic lines; see attempt summary count\n'
        : ''
    }
    if (/\bpw:protocol\b/.test(plainLine)) return ''
    if (/\bpw:browser\b/.test(plainLine)) {
      this.playwrightBrowserLineCount += 1
      if (this.playwrightBrowserLineCount <= maxPlaywrightBrowserLines) return originalLine
      return this.playwrightBrowserLineCount === maxPlaywrightBrowserLines + 1
        ? '[storybook-browser] suppressed additional pw:browser lines after 200 entries\n'
        : ''
    }
    return originalLine
  }

  private recordMilestone(milestone: StorybookBrowserBootstrapMilestone, atMs: number): void {
    if (this.milestones.has(milestone)) return
    this.milestones.add(milestone)
    this.timeline.push({ atMs, milestone })
  }
}
