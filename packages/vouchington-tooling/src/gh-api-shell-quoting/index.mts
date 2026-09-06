// Detects `gh api <arg>` invocations, in a shell script or a workflow/composite-action `run:`
// block, where the argument carries an unquoted `?` or `&`. An unquoted `&` backgrounds the
// command and drops every argument after it — the truncated call still exits 0, so CI can report
// success on a silently short-circuited query. An unquoted `?` fails loudly under zsh
// glob-nomatch but passes through unexpanded under bash.
//
// This module only scans already-in-scope source text; deciding which files count as a shell
// script or a workflow/action YAML file is repo-layout policy left to the caller.
import { ghApiShellQuotingHits, lineNumberAt } from './scan.mts'
import type { ShellQuotingViolation } from './yaml.mts'

export type { ShellQuotingViolation } from './yaml.mts'
export { workflowYamlViolations } from './yaml.mts'

/** For a plain shell script: `source` is the whole file, so hit offsets are already absolute. */
export function shellScriptViolations(source: string): ShellQuotingViolation[] {
  return ghApiShellQuotingHits(source).map((hit) => ({
    line: lineNumberAt(source, hit.offset),
    excerpt: hit.excerpt,
  }))
}
