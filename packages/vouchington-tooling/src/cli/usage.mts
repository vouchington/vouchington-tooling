export const USAGE = `Usage: vouchington <command> [options]

Commands:
  runner-port-policy   Print or validate a runner port policy
  with-host-lock       Run a command under a host-wide lock
  gha-runtime-audit             Audit successful GitHub Actions job runtimes
  gha-output                    Write a collision-safe multiline GITHUB_OUTPUT record
  gha-needs-results             Fail if required GitHub Actions job results failed
  download-with-diagnostics     Download a URL and report HTTP status on failure
  host-pressure-diagnostics     Print a bounded host memory/OOM/PSI snapshot
  allocate-browser-safe-ports   Allocate Fetch-safe localhost ports
  diagnose-port-collision       Capture bounded localhost port diagnostics
  prepare-trivy-db              Download the Trivy vulnerability database
  gha-artifacts-cleanup         Delete classified GitHub Actions artifacts
  http-origin                   Validate an optional HTTP(S) origin
  vitest-blob-manifest          Stamp a vitest-blob-manifest:v1 identity file
  pnpm-install                  Install a pnpm workspace with retry and release-age fail-fast

Options:
  -h, --help       Show this help
  -v, --version    Print the package version

runner-port-policy
  (no args)              Print the shipped policy as JSON
  --file <path>          Validate and print a policy file
  --reserved <port>      Print true if the port is reserved

with-host-lock
  --name <family>
  [--slots <n>]
  --timeout-seconds <n>
  [--command-timeout-seconds <n>]
  [--failure-diagnostics <absolute-script>]
  [--on-acquire-timeout fail|run-unlocked]
  -- <command> [args...]

gha-runtime-audit
  [--repository owner/name]   Default GITHUB_REPOSITORY
  [--branch main]
  --pr-workflow <name|/regex/>     Repeatable
  --push-workflow <name|/regex/>   Repeatable

gha-output <name>
gha-needs-results [label]
download-with-diagnostics <url> <destination> [-- curl-args...]
host-pressure-diagnostics
allocate-browser-safe-ports [count] [--policy path] [--forbidden-ports path]
diagnose-port-collision [--ports "2200 2216"] [--output-dir PATH]
prepare-trivy-db
gha-artifacts-cleanup run --run-id <id> [--keep-pattern glob] [--delete-pattern glob] [--patterns-file json]
gha-artifacts-cleanup sweep --older-than-hours <n> [--keep-pattern glob] [--delete-pattern glob] [--patterns-file json]
http-origin [--field NAME] [value]
vitest-blob-manifest <suite> [reports-directory]
pnpm-install --runner-lifecycle persistent|ephemeral|ephemeral-full --install-scripts true|false
`

export function printUsage(stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(USAGE)
}
