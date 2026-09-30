import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import { callTool, type ServerEnvironment, type ToolCallResult } from './dispatch.mts'
import {
  BLACKBOARD_ENV,
  fakeBlackboard,
  type FakeBlackboard,
  type FakeOptions,
} from './fake-blackboard.test-helpers.mts'
import { createRepoFixture, type RepoFixture } from './git-fixture.test-helpers.mts'
import { runIsolatedGit } from './worktree.mts'

/** A fresh pair of real repositories for every test. */
export function useRepoFixture(): () => RepoFixture {
  let fixture: RepoFixture | undefined
  beforeEach(() => {
    fixture = createRepoFixture()
  })
  afterEach(() => fixture?.cleanup())
  return () => fixture as RepoFixture
}

export function outboxPath(worktree: string): string {
  return join(worktree, '.local', 'blackboard-outbox')
}

export type Harness = {
  fake: FakeBlackboard
  call: (name: string, args?: unknown) => Promise<ToolCallResult>
}

/** Calls tools against a repository fixture with the blackboard client faked. */
export function harness(
  fixture: RepoFixture,
  options: FakeOptions & { env?: NodeJS.ProcessEnv } = {},
): Harness {
  const fake = fakeBlackboard(options)
  const environment: ServerEnvironment = {
    launchRoot: fixture.main,
    env: options.env ?? BLACKBOARD_ENV,
    runGit: runIsolatedGit,
    blackboard: fake.dependencies,
  }
  return { fake, call: (name, args) => callTool(name, args, environment) }
}

export function textOf(result: ToolCallResult): string {
  return result.content.map((part) => part.text).join('\n')
}

export function jsonOf(result: ToolCallResult): Record<string, unknown> {
  return JSON.parse(textOf(result)) as Record<string, unknown>
}

export const JOURNAL_ARGS = {
  sessionId: 'native:owner',
  parentSessionId: null,
  agent: 'codex',
  version: '1',
  mode: 'autonomous',
  markdown: '## Finding\nThe build cache was cold.',
  sourceEventId: 'journal:1',
  workOutcome: 'success',
  repositories: ['owner/repo'],
  feedbackCoverage: { status: 'complete', sources: ['tool-result'], droppedCount: 0 },
  timestamp: '2026-01-01T00:00:00.000Z',
}
