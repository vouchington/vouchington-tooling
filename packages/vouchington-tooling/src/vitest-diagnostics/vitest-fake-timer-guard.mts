// Fake-timer-leak guard: a test that leaves vi.useFakeTimers() installed corrupts every later
// test sharing the same fork (isolate: false) or file (isolate: true). This asserts the
// invariant after every test — a source-level lint rule can't help because a correct
// beforeEach/afterEach pair looks identical to a stray call at the AST level.
//
// Kept dependency-free (no import from 'vitest' at module scope) so the check function is
// unit-testable with a fake vi-shaped object, mirroring vitest-fork-leak-detection.mts.
//
// `.ts`, not `.mts`: the root-level setupFiles chain imports this inside the
// browser project whose transform hardcodes TypeScript detection to
// `.ts`/`.tsx` and silently misparses `.mts` as plain JS.

export type FakeTimerController = {
  isFakeTimers(): boolean
  useRealTimers(): void
}

export function formatFakeTimerLeakDiagnostics(testName: string): string {
  return [
    '[vitest-fake-timer-leak]',
    `test: ${testName}`,
    'vi.useFakeTimers() was still installed when this test finished.',
    "Fake timers are process-global state: under pool: 'forks', isolate: false they leak into",
    'every later test file sharing this fork (not just later tests in this file); under',
    'isolate: true they still leak into later tests in this same file. Either way, real',
    'timer-driven code in a later test can hang or silently behave differently.',
    'Fix: call vi.useRealTimers() in an afterEach for this file (or wrap the test body in',
    'try/finally) so real timers are restored even when the test throws or returns early.',
  ].join('\n')
}

// Restores real timers defensively before returning, so a single offending test cannot corrupt
// every test that runs after it even when this guard's own failure aborts the current file.
// Returns a diagnostic string when the invariant was violated, or null when the test left
// real timers in place (the expected, clean state).
export function checkAndRestoreFakeTimers(
  controller: FakeTimerController,
  testName: string,
): string | null {
  if (!controller.isFakeTimers()) return null

  controller.useRealTimers()
  return formatFakeTimerLeakDiagnostics(testName)
}
