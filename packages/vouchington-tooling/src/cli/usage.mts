export const USAGE = `Usage: vouchington <command> [options]

Commands:
  runner-port-policy   Print or validate a runner port policy
  with-host-lock       Run a command under a host-wide lock
  gha-runtime-audit    Audit successful GitHub Actions job runtimes

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
`

export function printUsage(stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(USAGE)
}
