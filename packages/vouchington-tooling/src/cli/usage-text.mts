export const USAGE = `Usage: vouchington <command> [options]

Commands:
  runner-port-policy   Print or validate a runner port policy
  with-host-lock       Run a command under a host-wide lock
  host-storage         Check free space on caller-supplied paths
  gha-runtime-audit             Audit successful GitHub Actions job runtimes
  require-up-to-date            Require HEAD to include a fetched remote branch
  fresh-base                    Classify the worktree against a remote base branch
  gitleaks-directory-scan       Scan a directory with Gitleaks
  ast-grep-examples             Run AST-grep rule examples
  ast-grep-pack                 Print shipped unconditional AST-grep pack paths as JSON
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
  agent-issue-labels            Map changed paths to labels; create missing repository labels
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
  ghcr-package-retention        Delete old GHCR package versions (KEEP_MIN or --main-history)
  harness-admission-lane        Compute a GITHUB_RUN_ID admission lane for fleet fan-out
  harness-assert-gates          Fail if any named HARNESS_*_ENABLED gate is enabled
  gha-collaborator-trust        Classify authors as write-access collaborators or not
  nuget-central-version         Validate a Directory.Packages.props PackageVersion delta
  verify-workflow-secrets       Check a secret inventory against live repository and environment secrets
  dead-code                     Gate unused code against a committed jscpd baseline
  swift-semantic-equal          Compare Swift sources ignoring comments and whitespace
  post-review                   Post one COMMENT review from a staged payload file
  stage-review-payload          Validate a review payload file into a staging directory
  retrospective-transcript      Format facts from Claude-compatible, Codex, or Grok transcripts
  link-skill                    Link one packaged skill into an explicit consumer directory
  retrospective-facts           Gather immutable facts for a retrospective
  agent-blackboard              Probe an Agent Blackboard deployment, classify distill sessions, manage snapshots
  mcp                           Serve the agent-blackboard journal tools over stdio (MCP)
  hook                          Run a repository policy module as a pre/post tool-use hook
  worktree                      Reclaim finished git worktrees (dry run unless --yes)
  tmux                          Run configured dev windows in tmux; name panes; agent reminders
  story-coverage                Check component exports are imported by stories
  transient-retry               Rerun a failed GitHub Actions run when an injected rule matches
  sandbox-command-audit         Audit agent transcripts for sandbox escalations and denials

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

host-storage --path <path> [--path <path>...] [--minimum-free-bytes <bytes>] [--pnpm-store] [--docker-root] [--docker-desktop-path <path>] [--discovery-timeout-ms <ms>]

gha-runtime-audit
  [--repository owner/name]   Default GITHUB_REPOSITORY
  [--branch main]
  [--median-threshold-floor <seconds>]    Off unless set. Must be below the ceiling
  [--median-threshold-ceiling <seconds>]  Default 360. Flags a five-sample median above this
  --pr-workflow <name|/regex/>     Repeatable
  --push-workflow <name|/regex/>   Repeatable

require-up-to-date --remote <name> --branch <name>
fresh-base [--remote <name>] [--branch <name>] [--skip-fetch]
gitleaks-directory-scan --config <path> [--directory <path>]
ast-grep-examples --rules <directory> --config <path>
ast-grep-pack
gha-workspace-policy [--root <directory>] [--workflow-directory <directory>] [--action-directory <directory>]

gha-output <name>
gha-needs-results [label]
download-with-diagnostics <url> <destination> [-- curl-args...]
download-optional-run-artifacts (--name <name>... | --pattern <pattern>) --dir <directory>
host-pressure-diagnostics
allocate-browser-safe-ports <count> [--policy path] [--forbidden-ports path]
diagnose-port-collision [--ports "2200 2216"] [--output-dir PATH]
prepare-trivy-db
gha-artifacts-cleanup run --run-id <id> [--keep-pattern glob] [--delete-pattern glob] [--patterns-file json]
gha-artifacts-cleanup sweep --older-than-hours <n> [--keep-pattern glob] [--delete-pattern glob] [--patterns-file json]
agent-issue-labels labels-from-paths [--labeler <path>] <path>...
agent-issue-labels ensure-labels [--repo owner/name] [--policy-file json] [--update] <label>...
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
ghcr-package-retention [--main-history] [--apply|--dry-run] [<url-encoded-package>...]
harness-admission-lane <lanes>
harness-assert-gates <gate>...
gha-collaborator-trust <owner/repo> [--allow-bot <login>]... < authors.json
nuget-central-version <trusted-props> <candidate-props> <metadata-json> <output-props>
verify-workflow-secrets [--repo OWNER/NAME] [--confirm NAME,...] [--inventory MODULE] [--export NAME] [--branch NAME]
dead-code --baseline PATH [--seed|--update] [--config PATH] [--binary PATH] [--repo-root PATH] [--entry GLOB]... [--snapshot-ignore GLOB]... [--exclude GLOB]...
swift-semantic-equal <base> <head> <file.swift>
post-review
stage-review-payload optional|required <source> <destination>
retrospective-transcript [--session-id ID] [--jsonl PATH] [--projects-dir PATH] [--codex-sessions-dir PATH] [--grok-sessions-dir PATH]
link-skill <name> --source-root <skills-dir> --target-root <consumer-skills-dir>  Link a packaged or repository-local skill
retrospective-facts (--pr NUMBER | --branch NAME | --no-pr) [--repo OWNER/NAME] [--raw]
agent-blackboard probe
agent-blackboard session-start [--skip-env NAME] [--setup-hint TEXT] [--docs-path PATH] [--restore-hint TEXT] [--timeout-ms N]  (SessionStart hook; payload on stdin)
agent-blackboard distill classify <partition.jsonl> --retro-cutoff ISO8601 --session-cutoff ISO8601
agent-blackboard snapshot partition --snapshot PATH --checksum SHA256 --counts '{"sessions":N,"entries":N,"records":N,"bytes":N}'
agent-blackboard snapshot cleanup [--snapshot PATH] [--partition-directory PATH --receipt JSON]
mcp
  (no args)              Serve journal_append, journal_entries, outbox_status, outbox_flush,
                         session_ensure, retrospective_check, retrospective_save,
                         pr_validate, pr_create, pr_update,
                         snapshot_export, snapshot_cleanup, and session_archive over stdio.
                         Needs the optional @modelcontextprotocol/sdk peer (and zod).
                         Launch it from inside the repository's git worktree.

hook pre-tool-use|post-tool-use --harness claude|codex|cursor|grok --policy <module> [--root <dir>] [--automation-env NAME]...
  Reads the harness hook payload on stdin. <module> default-exports a policy object (or a function
  of the hook context returning one) with a command rule table, post-tool-use checkers, and an
  optional reminder. pre-tool-use exits 2 to block, and also when the policy cannot load.
  post-tool-use is advisory and always exits 0. --root defaults to the working directory.
  Each --automation-env NAME (repeatable) marks the run unattended when that environment variable
  is set, non-empty, and not 0 or false; CI markers and claude -p are always unattended.

worktree reclaim [--yes] [--json] [--max-worktrees N] [--timeout-ms N] [--pr-limit N] [--after PATH]
  Dry run by default. Removes clean, fully pushed worktrees whose same-repository PR for the
  branch is merged or closed at exactly HEAD, using git worktree remove (never forced).
  Skips the main checkout, the current worktree, and locked, bare or detached worktrees.

transient-retry --rules <module> [--repo owner/name] [--token-env NAME] [--dry-run] <run-id>
  Loads a module exporting "rules" (and optionally "limits"), evaluates them against the failed run,
  and reruns only on a match. Exits 0 on rerun, 2 when none is warranted, 1 on error.

sandbox-command-audit --rules <module> [--settings-path <file>] [--repo-root <dir>]... [--worktree-glob <glob>]... [--projects-dir <dir>] [--codex-sessions-dir <dir>] [--session-id <id>] [--limit N] [--since DAYS] [--json] [--raw]
  Scans Claude and Codex transcripts scoped to this repository (git roots plus any --worktree-glob
  layouts) and reports Bash escalations, denials and permission failures by command prefix.
  <module> exports an object (default or "rules") with loadPolicy({ settingsPath, cwd }), which
  returns { covers(list, commandOrPrefix) } for the allow/deny/excluded lists or { error }, and
  optionally classifyFailure(command, text, source), limits and worktreeGlobs. Transcript roots
  default to CLAUDE_CONFIG_DIR/projects and CODEX_HOME/sessions. --raw prints full command text.

tmux up --config <file> [--root <dir>] [--no-attach] [-v|--verbose]
tmux name [--socket PATH --pane %ID --worktree PATH] <name> | read-title | post-tool | agent-reminder <event>
  Environment: TMUX_TARGET_BIN, TMUX_TARGET_ROOT, TMUX_NAME_COMMAND, AGENT_TMUX_SOCKET/PANE/WORKTREE.

story-coverage --root <dir> --component-root <rel> --story-root <rel> --source-extension <ext> --component-extension <ext> --marker <regex> --story-pattern <regex> [--alias <prefix>=<path>] [--exclusions <json>] [--exclusions-label <text>]
`
