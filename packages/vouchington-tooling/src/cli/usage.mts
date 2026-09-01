export const USAGE = `Usage: vouchington <command> [options]

Commands:
  runner-port-policy   Print or validate a runner port policy
  with-host-lock       Run a command under a host-wide lock
  gha-runtime-audit             Audit successful GitHub Actions job runtimes
  require-up-to-date            Require HEAD to include a fetched remote branch
  gitleaks-directory-scan       Scan a directory with Gitleaks
  ast-grep-examples             Run AST-grep rule examples
  gha-workspace-policy          Check GitHub Actions workspace safety policy
  gha-output                    Write a collision-safe multiline GITHUB_OUTPUT record
  gha-needs-results             Fail if required GitHub Actions job results failed
  download-with-diagnostics     Download a URL and report HTTP status on failure
  download-optional-run-artifacts  Download optional artifacts from the current run
  host-pressure-diagnostics     Print a bounded host memory/OOM/PSI snapshot
  allocate-browser-safe-ports   Allocate Fetch-safe localhost ports
  diagnose-port-collision       Capture bounded localhost port diagnostics
  prepare-trivy-db              Download the Trivy vulnerability database
  gha-artifacts-cleanup         Delete classified GitHub Actions artifacts
  http-origin                   Validate an optional HTTP(S) origin
  vitest-blob-manifest          Stamp a vitest-blob-manifest:v1 identity file
  vitest-report-attempt         Write or read a Vitest report-attempt marker
  prepare-vitest-reports        Validate and select Vitest report JSON files
  pnpm-install                  Install a pnpm workspace with retry and release-age fail-fast
  check-cache-size              Measure a path and decide whether to save a GHA cache
  make-shard-matrix             Emit a [1..N] GitHub Actions shard matrix
  load-runner-env               Overlay a runner env file onto GITHUB_ENV with injection guards
  clean-workspace               Reset a persistent-runner workspace with a fork-PR trust gate
  install-github-release        Download a checksum-verified GitHub Release binary
  run-with-timeout              Run a command with GNU timeout or a Perl fallback
  lint-links                    Two-pass lychee: internal links fail, external warn
  materialize-pr-context        Dump PR title/body/files/diff/comments and #N crawl
  wait-for-apt-locks            Wait until apt/dpkg lock files are free
  install-playwright-chromium-arm64  Install Playwright Chromium from browsers.json
  ghcr-package-retention        Delete old GHCR package versions past KEEP_MIN
  harness-admission-lane        Compute a GITHUB_RUN_ID admission lane for fleet fan-out
  harness-assert-gates          Fail if any named HARNESS_*_ENABLED gate is enabled
  nuget-central-version         Validate a Directory.Packages.props PackageVersion delta
  swift-semantic-equal          Compare Swift sources ignoring comments and whitespace
  post-review                   Post one COMMENT review from a staged payload file
  stage-review-payload          Validate a review payload file into a staging directory
  retrospective-transcript      Format facts from Claude-compatible, Codex, or Grok transcripts
  link-skill                    Link one packaged skill into an explicit consumer directory
  retrospective-facts           Gather immutable facts for a retrospective
  agent-blackboard              Probe and journal an Agent Blackboard deployment

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

require-up-to-date --remote <name> --branch <name>
gitleaks-directory-scan --config <path> [--directory <path>]
ast-grep-examples --rules <directory> --config <path>
gha-workspace-policy [--root <directory>] [--workflow-directory <directory>] [--action-directory <directory>]

gha-output <name>
gha-needs-results [label]
download-with-diagnostics <url> <destination> [-- curl-args...]
download-optional-run-artifacts (--name <name> | --pattern <pattern>) --dir <directory>
host-pressure-diagnostics
allocate-browser-safe-ports [count] [--policy path] [--forbidden-ports path]
diagnose-port-collision [--ports "2200 2216"] [--output-dir PATH]
prepare-trivy-db
gha-artifacts-cleanup run --run-id <id> [--keep-pattern glob] [--delete-pattern glob] [--patterns-file json]
gha-artifacts-cleanup sweep --older-than-hours <n> [--keep-pattern glob] [--delete-pattern glob] [--patterns-file json]
http-origin [--field NAME] [value]
vitest-blob-manifest <suite> [reports-directory]
vitest-report-attempt <write DIRECTORY SUITE|read ROOT>
prepare-vitest-reports [primary-directory] [fallback-directory] [output-directory]
pnpm-install --runner-lifecycle persistent|ephemeral|ephemeral-full --install-scripts true|false
check-cache-size <path> <max-bytes> <label>
make-shard-matrix <total>
load-runner-env
clean-workspace
install-github-release --repo owner/name --version X --asset 'name-{platform}.tar.gz' --bin name [--tag-prefix PREFIX] [--expected-sha256 SHA256] [--no-checksum] [--checksums-asset NAME] [--version-flag FLAG] [--bin-dir DIR]
run-with-timeout <timeout-seconds> <kill-after-seconds> <command...>
lint-links [--offline] [--config PATH] [--glob PATTERN] [files...]
materialize-pr-context
wait-for-apt-locks
install-playwright-chromium-arm64 [name:archive...]
ghcr-package-retention <url-encoded-package>...
harness-admission-lane <lanes>
harness-assert-gates <gate>...
nuget-central-version <trusted-props> <candidate-props> <metadata-json> <output-props>
swift-semantic-equal <base> <head> <file.swift>
post-review
stage-review-payload optional|required <source> <destination>
retrospective-transcript [--session-id ID] [--jsonl PATH] [--projects-dir PATH] [--codex-sessions-dir PATH] [--grok-sessions-dir PATH]
link-skill <name> --source-root <skills-dir> --target-root <consumer-skills-dir>  Link a packaged or repository-local skill
retrospective-facts (--pr NUMBER | --branch NAME | --no-pr) [--repo OWNER/NAME] [--raw]
agent-blackboard probe
agent-blackboard journal append --session-id UUID --agent NAME --version VERSION --file PATH [--parent-session-id UUID] [--timestamp ISO8601]
agent-blackboard journal entries --session-id UUID
agent-blackboard snapshot partition --snapshot PATH --checksum SHA256 --counts '{"sessions":N,"entries":N,"records":N,"bytes":N}'
agent-blackboard snapshot cleanup [--snapshot PATH] [--partition-directory PATH --receipt JSON]
`

export function printUsage(stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(USAGE)
}
