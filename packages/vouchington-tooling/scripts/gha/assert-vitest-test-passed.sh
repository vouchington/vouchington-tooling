#!/usr/bin/env bash
set -euo pipefail

# Guards against a `it.runIf(...)` (or equivalent conditional test) silently
# degrading to a skip: `--reporter=json` records every test's status, and a
# skipped or absent test must fail the job, not report green. A CI job whose
# only assertion is "did the suite exit 0" cannot tell "ran and passed" apart
# from "never ran at all".

report_path="${1:?usage: assert-vitest-test-passed.sh <report-json-path> <full-test-name>}"
full_name="${2:?usage: assert-vitest-test-passed.sh <report-json-path> <full-test-name>}"

if [ ! -r "$report_path" ]; then
  echo "::error::vitest report not found at $report_path"
  exit 1
fi

status=$(jq -r --arg name "$full_name" '
  [.testResults[].assertionResults[] | select(.fullName == $name) | .status] | first // "absent"
' "$report_path")

echo "test \"$full_name\": $status"

if [ "$status" != passed ]; then
  echo "::error::required test did not pass (status: $status) -- a skipped or absent test must not report green"
  exit 1
fi
