export const COVERAGE_SCOPE_CHECK_USAGE = `coverage-scope-check [--rules <path>] [--scope-file <json>] [--include <glob>]... [--exclude <glob>]...
  Fails (exit 1) when a git-tracked file that a coverage rules file (default .coverage-rules.yml)
  gives a patch_coverage_min above 0, and its scope does not ignore, is outside the collector's
  scope. The collector scope is the repeated --include/--exclude globs plus, optionally, the
  include/exclude string arrays of a --scope-file JSON written from the Vitest coverage config.
  At least one include glob is required.
`
