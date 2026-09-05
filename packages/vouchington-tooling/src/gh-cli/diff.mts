import type { RunTextCommand } from './exec.mts'

/**
 * Runs `git diff <base>...HEAD` and returns the raw diff text. The base is parameterized rather
 * than hardcoded so callers can diff against any ref (`origin/main`, a release branch, etc.).
 */
export async function getDiffAgainstBase(runGit: RunTextCommand, base: string): Promise<string> {
  return runGit(['diff', `${base}...HEAD`])
}
