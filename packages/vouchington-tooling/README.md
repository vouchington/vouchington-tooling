# vouchington-tooling

Libraries and the `vouchington` CLI.

The [workflow and compiler primitives](docs/workflow-and-compiler.md) provide consumer supplied
GitHub Actions policy checks and compiler host freshness with bounded build settlement.

[`config-inventory`](../../docs/config-inventory.md) collects environment, dynamic-configuration,
and package-manager evidence using caller-owned file roles and policies.

[`finite-enum-ripple`](../../docs/finite-enum-ripple.md) compares finite TypeScript declarations,
route configuration, routed pages, and factory calls. Consumers supply every tracked-file role,
declaration name, route label, factory pattern, and exception.

```bash
npm install vouchington-tooling
# optional, only if you import vouchington-tooling/sql-ast
npm install @libpg-query/parser
# optional, if you import vouchington-tooling/contract-schema, finite-enum-ripple,
# or post-publication-inventory
# (classic compiler API; typescript@7's package root is version-only)
npm install @typescript/typescript6
# optional, only if you use the Vitest reporter export
npm install vitest
# optional, only for vouchington-tooling/agent-blackboard and agent-blackboard CLI commands
npm install agent-blackboard@^0.6.0
# optional, only for `vouchington mcp` (zod is a peer of the SDK)
npm install @modelcontextprotocol/sdk zod
```

[`vouchington mcp`](docs/mcp-server.md) serves the agent-blackboard journal tools to an agent over
stdio, with Claude, Codex, and Cursor registration examples.

## CLI

```bash
vouchington --help
vouchington runner-port-policy
vouchington runner-port-policy --file ./policy.json
vouchington runner-port-policy --reserved 2200
vouchington with-host-lock --name expensive-build --timeout-seconds 60 -- make build
vouchington gha-runtime-audit --pr-workflow CI --push-workflow '/^Main CI \\(.+\\)$/'
vouchington require-up-to-date --remote origin --branch main
vouchington gitleaks-directory-scan --config .gitleaks.toml
vouchington ast-grep-examples --rules ast-grep-tests --config sgconfig.yml
vouchington ast-grep-pack
vouchington gha-workspace-policy
vouchington gha-output name
vouchington gha-needs-results
vouchington download-with-diagnostics <url> <destination>
vouchington download-optional-run-artifacts --pattern 'coverage-*' --dir ./coverage-fallback
vouchington download-optional-run-artifacts --name coverage-tooling --name coverage-web --dir ./coverage-fallback
vouchington host-pressure-diagnostics
vouchington allocate-browser-safe-ports 2 --policy ./policy.json --forbidden-ports ./ports.json
vouchington diagnose-port-collision --ports "2200 2216"
vouchington prepare-trivy-db
vouchington gha-artifacts-cleanup run --run-id 123 --keep-pattern 'plan-*' --delete-pattern 'coverage-*'
vouchington agent-issue-labels labels-from-paths --labeler .github/labeler.yml src/a.ts
vouchington agent-issue-labels ensure-labels --policy-file labels.json --repo owner/name bug
vouchington http-origin --field cdn_origin https://images.example.com
vouchington vitest-blob-manifest <suite> [reports-directory]
vouchington vitest-report-attempt write <directory> <suite>
vouchington vitest-report-attempt read <root>
vouchington prepare-vitest-reports [primary-directory] [fallback-directory] [output-directory]
vouchington pnpm-install --runner-lifecycle persistent --install-scripts true
vouchington check-cache-size /tmp/cache 1048576 node-modules
vouchington make-shard-matrix 4
vouchington load-runner-env
vouchington clean-workspace
vouchington install-github-release --repo lycheeverse/lychee --version 0.24.2 --asset 'lychee-{platform}.tar.gz' --bin lychee
vouchington run-with-timeout 120 10 docker push example
vouchington lint-links --offline
vouchington materialize-pr-context
vouchington wait-for-apt-locks
vouchington retrospective-transcript --jsonl /path/to/transcript.jsonl
vouchington retrospective-facts --pr 49 --repo vouchington/vouchington-infra --raw
vouchington agent-blackboard probe
vouchington agent-blackboard distill classify <partition.jsonl> --retro-cutoff <iso> --session-cutoff <iso>
vouchington agent-blackboard snapshot partition --snapshot <snapshot.jsonl> --checksum <sha256> --counts <counts.json>
vouchington agent-blackboard snapshot cleanup --snapshot <snapshot.jsonl> --partition-directory <partitions-dir> --receipt <receipt-json>
vouchington mcp
vouchington install-playwright-chromium-arm64
vouchington ghcr-package-retention example%2Fapi
vouchington harness-admission-lane 4
vouchington harness-assert-gates HARNESS_DISPATCH_ENABLED HARNESS_SHEPHERD_ENABLED
echo '[{"login":"octocat","type":"User"}]' | vouchington gha-collaborator-trust owner/repo --allow-bot github-actions[bot]
vouchington nuget-central-version trusted.props candidate.props metadata.json out.props
vouchington verify-workflow-secrets --repo owner/name --inventory .github/workflows/workflow-secrets-inventory.mts
vouchington tmux up --config tmux.json --no-attach
vouchington tmux name my-topic
vouchington tmux read-title
vouchington tmux agent-reminder session-start
vouchington tmux post-tool < hook-payload.json
vouchington dead-code --baseline dead-code-baseline.json --config .jscpd.json --update
vouchington swift-semantic-equal BASE HEAD App.swift
vouchington post-review
vouchington stage-review-payload optional|required <source> <destination>
```

### Running `allocate-browser-safe-ports` without an install

The allocator is a standalone Python script that needs only the Python 3 standard library: no
Node, no `pnpm install`. Run it from the extracted published tarball:

```bash
npm pack vouchington-tooling@<version>   # or download the registry .tgz
mkdir extracted && tar -xzf vouchington-tooling-<version>.tgz -C extracted
python3 extracted/package/scripts/allocate-browser-safe-ports.py <count> [--policy ...] [--forbidden-ports ...]
```

`pnpm dlx` and `npx` resolve the package's whole dependency tree, which can fail under
`minimumReleaseAge` (`ERR_PNPM_NO_MATURE_MATCHING_VERSION`) when a lockstep-published dependency
straddles the cutoff. CI jobs without an install should fetch the tarball instead. Tests enforce
that the script stays stdlib-only and reads only its two sibling JSON files.

### Configuring `ghcr-package-retention`

Packages come from the arguments, or from `GHCR_PACKAGES` (space separated) when none are given.
`GHCR_OWNER_TYPE` (`user` default, or `org` with `GHCR_OWNER`) picks the API root.

- Default strategy: keep the newest `KEEP_MIN` (10) versions that carry no tag starting with
  `PROTECTED_TAG_PREFIX` (`latest`) or containing `PROTECTED_TAG_CONTAINS` (`buildcache`). It
  deletes unless `--dry-run` is passed.
- `--main-history`: for images tagged `sha-<40 hex>`. Run from a full-history checkout. Deletes
  images past the newest `GHCR_KEEP_MAIN` (30) commits reachable from `HEAD`, unreachable images
  idle for `GHCR_UNMERGED_MIN_AGE_DAYS` (7) days, and attestation/platform attachments that
  outlive every surviving image. A package that does not exist (HTTP 404) is skipped. This mode
  is a dry run unless `--apply` is passed.

For persistent `pnpm-install`, v5 metadata tracks structural inputs separately from the
`--install-scripts` policy. A warm scripts-enabled tree can therefore toggle
`true → false → true` without forced reconciliation; a tree first installed with scripts disabled
uses two script-suppressed verification installs followed by `pnpm rebuild --pending --recursive`.
Before rebuilding, duplicate pending IDs are collapsed. After rebuilding, IDs proven absent from
the current workspace and installed virtual-store lockfiles are reported and removed; live
dependency and workspace-importer IDs are retained. Any residual ID after the generic rebuild remains a reported hard failure. An isolated native-binary
mismatch uses one strict forced install only when structural provenance
matches, workspace links are valid, and pnpm records empty `ignoredBuilds` and `pendingBuilds` ledgers;
otherwise it retains the two script-free reconciliation passes. Native and workspace-link health
are verified before its metadata stamp is refreshed.
The command emits a structured non-secret provenance diagnostic identifying changed structural
categories, the last script policy, script capability, and native-binary health.

`download-optional-run-artifacts` uses the current Actions run and host. Pattern mode discovers
non-expired artifacts across the run, keeps the first result for each name (matching `gh run
download`), and extracts each selected name into its own directory. Ordinary absence is reported as
`availability=unavailable`. Artifact listing retries up to three times with bounded backoff;
exhausted transport errors, invalid names, and cancellation remain hard failures.

Name mode takes one or more `--name <artifact>` flags (mutually exclusive with `--pattern`), lists
the run's artifacts once, and extracts every requested name that is present into `<dir>/<name>`.
Names are matched literally, in request order, with repeats downloaded once; empty names, `.`, `..`,
and names containing `/`, `\`, or a line break are rejected before anything is listed. Requested
names absent from the run are expected (callers pass a superset such as retry-attempt variants) and
are skipped with a single bounded `::notice::` (the absent count, the first three names, then
`and N more`) and never one line per name. `availability=available` means at least one requested
artifact was downloaded; `availability=unavailable` (exit 0) means none was
present. A present artifact whose download fails is a hard failure: the helper stops at the first
one, prints `download failed artifact=<name> exit=<n>`, exits non-zero (a downloader exit of 3 is
reported as 1 so it cannot be mistaken for absence), and writes no `availability` output.

`require-up-to-date` fetches the requested remote branch and fails unless its fetched tip is an
ancestor of `HEAD`. `fresh-base` refreshes `<remote>/<branch>` (default `origin/main`, 8 s fetch timeout, `--skip-fetch`
to compare the cached ref) and prints a JSON report classifying the worktree as `up-to-date`,
`ahead`, `behind`, `diverged`, `dirty` (matches the base but has uncommitted changes),
`fetch-failed` (a failed refresh outranks every other status), or `unknown`. It prints nothing
outside a Git repository. Unlike `require-up-to-date` it never fails on staleness; callers decide
what to do with the status.
`gitleaks-directory-scan` builds and scans isolated staged-index and current
nonignored-working-tree mirrors with an explicit config; `--directory` selects the repository root.
`ast-grep-examples` runs native `ast-grep test`, then validates each scoped rule's `files:` and
`ignores:` examples with project `languageGlobs` replay from its root `--config`.
The shipped pack maps `**/*.ts`, `**/*.mts`, `**/*.cts`, and `**/*.tsx` to `Tsx` so one rule
covers script and JSX surfaces. Consumers must use the same `languageGlobs` and `language: Tsx`;
do not add `-tsx` companion YAML. Angle-bracket type assertions (`<T>value`) are not valid TSX.
`compareAstGrepCompanions` compares recursive `<name>.yml`/`.yaml` and `<name>-tsx` companion
rules across every YAML field, returns stable JSON-pointer differences, and rejects unsafe or
ambiguous rule paths. The supplied rule path and every ancestor must be physical directories; YAML
aliases and non-JSON tagged values are rejected before comparison. Callers own any explicit
normalization for language-specific differences.
`ast-grep-pack` prints JSON `{ rules, config }` for the shipped unconditional rule pack. Point a
consumer `sgconfig.yml` `ruleDirs` at `rules` and keep product-specific YAML locally.
`gha-workspace-policy` checks tracked workflow and composite-action files in the current repository;
pass `--root`, `--workflow-directory`, or `--action-directory` for consumer-owned layouts.

`retrospective-transcript` discovers Codex and Claude transcripts by default. It also reads a
Claude-compatible transcript when `CURSOR_SESSION_ID` is set, and Grok's `updates.jsonl` session
layout when `GROK_SESSION_ID` is set. Use `--grok-sessions-dir` to point discovery at a nondefault
Grok session root. Without `--session-id`, it reads those session identities from the host
environment. `resolveTranscriptFile` is the canonical resolver: it lowercases and UUID-validates
session ids, honors `CODEX_HOME`, `CLAUDE_CONFIG_DIR` and `GROK_HOME`, and errors when more than one
transcript matches. The subpath also exports `normalizeCommandPrefix`, `splitCommandSegments`,
`isPackageRunner`, `asRecord`, `asArray` and `openTranscriptLines(path, { maxRecordBytes })`, which
streams lines (2 MiB per record by default) and throws from the iterable on an oversized record.

`retrospective-facts` keeps local Git evidence separate from GitHub PR data. `Commits ahead of
origin/main` is populated only from a local ancestry range; GitHub responses instead populate
`PR commits`. API-derived file and directory counts are labelled `GitHub API`. When a named local
branch is absent, the command refreshes `origin/<branch>` before using it and refuses a stale
remote ref when that refresh fails.
For an explicit `--repo`, it performs no local Git checks: `Merged to main` is `yes` only when
GitHub reports a merged PR whose `baseRefName` is `main`; a merged PR into another base is reported
as not merged to main, and a missing base is unavailable.

Agent Blackboard support is optional: only the `agent-blackboard` subpath and its CLI commands
need `agent-blackboard@^0.6.0`. Snapshot cleanup accepts only package-generated temporary paths.
`appendJournal` now requires explicit mode, stable source-event identity, work
outcome, feedback coverage, and exact repositories. This is a breaking pre-1.0 API change; adopt the
shared contract before upgrading consumers. `appendJournal` reads a bounded UTF-8 note and delegates
to `writeFeedback`, returning delivered or pending state rather than a success-shaped message.
Programmatic callers launched from a different workspace directory pass their own module URL as
`dependencies: { resolveFrom: import.meta.url }`; the CLI defaults to the current package context.
It captures a target under a private tombstone, validates partition names, permissions, JSONL,
ordering, terminal manifests, and the identity-bound cleanup receipt before deleting files, and
restores the original path on a validation failure. Once deletion begins, it retains a private
tombstone plus signed resume metadata instead; retry cleanup with the original partition-directory
path and the same receipt until it completes. The partition command returns that receipt; directory
cleanup requires it.
The receipt is authenticated with an owner-only per-user HMAC key stored under a dedicated
`0700` directory in the system temporary directory. This small host-local state is the trust
boundary: a copied or caller-created receipt cannot authorize cleanup without that key.

Host-lock environment:

| Variable                                | Default               | Meaning                                     |
| --------------------------------------- | --------------------- | ------------------------------------------- |
| `HOST_LOCK_ROOT`                        | `/tmp/host-lock-$UID` | Absolute lock directory root                |
| `HOST_LOCK_LEASE_SECONDS`               | `60`                  | Reclaim ceiling for a held lock             |
| `HOST_LOCK_PROCESS_GROUP_DRAIN_SECONDS` | `30`                  | Time to wait for the command process group  |
| `HOST_LOCK_ACTIVE`                      | unset                 | Set while a lock is held; nested locks fail |

`vouchington host-storage --path <path>` checks free space for each path. Paths on the same device
are measured once. The default floor is 5 GiB (`--minimum-free-bytes`). `--pnpm-store` discovers the
pnpm store. `--docker-root` checks Docker Desktop's `Docker.raw` on macOS and `docker info` on Linux.
Discovery waits 5 seconds unless `--discovery-timeout-ms` sets an integer from 1 through 2147483647. A required path that is missing or low
fails before optional discovery runs. Optional discovery failures are warnings; low space on a
discovered filesystem still fails. `inspectHostStorage` and `probeHostStorage` are exported from
`vouchington-tooling/host-storage`.

## Sourceable Bash libraries

`scripts/worktree/git-worktrees.sh` is included in the published package. Source it to parse
`git worktree list --porcelain` with `git_worktree_*` helpers. Path queries fail when git fails,
and `git_worktree_main_path` fails when git reports no worktree. Its
`git_worktree_canonical_path_hash <path>` helper resolves the physical path and prints a stable
`d` plus the first 12 lowercase hexadecimal characters of its SHA-256 digest.
`scripts/worktree/git-index-lock.sh` removes only a 0-byte `index.lock`. A non-empty lock is left
in place.

`scripts/worktree/operation-lock.sh` holds a host-wide lock across a region of the sourcing script,
for code that shares shell state with its surroundings and so cannot run under
`vouchington with-host-lock`, which wraps one command and forbids nesting. The lock is a symlink
named `lock` whose target is an owner token; a file with that name holds the owner PID. Pass the
absolute lock root to each call or set `WORKTREE_OPERATION_LOCK_ROOT`; there is no default.
`worktree_operation_lock_acquire [root]` takes the lock or prints the holder's PID (or says the
lock is stale) and returns 1 without waiting. `worktree_operation_lock_release` is a no-op unless
this shell holds the lock, so `trap worktree_operation_lock_release EXIT` is safe.
`worktree_operation_lock_clear_stale [root]` removes a lock whose owner PID is dead and sets
`WORKTREE_OPERATION_LOCK_CLEANUP_STATUS` to `missing`, `removed`, `active`, `invalid` or `busy` (another clearer is running, or the lock
changed during cleanup); it returns 2 for a missing or relative root, 0 for `missing` and
`removed`, and 1 otherwise. The root must be owned by the calling user and is meant for one user's
processes; run `clear_stale` only as operator recovery while no operation is starting, because
releasing and clearing are not serialized against each other.

`scripts/worktree/reset-worktree.sh --base-ref <ref>` checks out a new `reset-<hex>` branch and
hard-resets it to `<ref>`. A `remote/branch` ref is fetched first; `refs/...` and a local ref are
not. It refuses uncommitted or untracked changes unless `--force` is set, refuses a non-empty
`index.lock`, and deletes a zero-byte `index.lock`. Repeat `--cache <relative-path>` for caller-owned
outputs. `--pre` runs after fetch and before the branch switch; `--post` runs after cache removal.
The script also deletes `.cache` directories and the direct `.cache`, `.vite`, and `.vitest`
directories inside `node_modules`. It needs `flock` or `lockf` and holds
`.local/reset-worktree.lock` for the run.

## Rerunning known-transient workflow failures

`vouchington transient-retry --rules <module> [--repo owner/name] [--token-env NAME] [--dry-run]
<run-id>` fetches a failed GitHub Actions run, evaluates the rules your module exports, and runs
`gh run rerun` only when a rule asks for a rerun. The engine ships no rules: the module exports
`rules` (an array of `WorkflowRetryRule`) and optionally `limits`. It exits 0 when a rerun was
requested (or would be, with `--dry-run`), 2 when none is warranted, and 1 on error. The repository
comes from `--repo`, `GITHUB_REPOSITORY`, or the checkout; `--token-env` names the variable that
holds the token, which is passed to `gh` as `GH_TOKEN`.

Rules receive a `WorkflowRunContext`: job names, conclusions and steps, plus failed-job logs and
annotations that are fetched only when a rule reads them. Logs may contain secrets, so they are
streamed and never buffered whole: each job keeps a head window and a tail window
(`limits.headBytes`, `limits.tailBytes`), reading stops at `limits.maxReadBytes`, and the run keeps
at most `limits.totalBytes` in all. A log that cannot be read is reported through
`failedJobLogFetchFailures` with empty text. Only job names and the decision are printed. The same
pieces are exported from `vouchington-tooling/transient-retry` (`rerunKnownTransient`,
`buildWorkflowRunContext`, `createGhApi`).

## Auditing sandbox escalations

`vouchington sandbox-command-audit --rules <module> [--settings-path <file>] [--repo-root <dir>]...
[--worktree-glob <glob>]... [--projects-dir <dir>] [--codex-sessions-dir <dir>] [--session-id <id>]
[--limit N] [--since DAYS] [--json] [--raw]` scans agent transcripts for Bash calls that left the
sandbox (`dangerouslyDisableSandbox`), were denied, or failed on a permission signature, and groups
them by command prefix. Transcript roots default to `CLAUDE_CONFIG_DIR/projects` and
`CODEX_HOME/sessions` (else `~/.claude` and `~/.codex`). Discovery is scoped to the repository so
other projects' commands are not reported as this repository's gaps: the roots are the current
checkout plus every worktree `git worktree list` knows, or the `--repo-root` values, plus the
matches of each `--worktree-glob` (a glob relative to each root, for worktree layouts git no longer
lists). A transcript is attributed by its first recorded `cwd`; files whose cwd is unknown or
outside the roots are counted on the `Scope:` line, never dropped silently. `--limit` caps files per
source after scoping and `--since` is a day window. The default report holds only prefixes and
counts; `--raw` adds full command and failure text for local inspection and `--json` serializes
either view.

The package ships no classification. The module named by `--rules` default-exports (or exports as
`rules`) an object, or a function returning one:

```js
export default {
  // Required. Turns the settings location into the repository's coverage answer, or { error }.
  loadPolicy: ({ settingsPath, cwd }) => ({
    // list is 'allow' | 'deny' | 'excluded'. 'allow' and 'excluded' receive a normalized
    // command prefix; 'deny' receives each raw command.
    covers: (list, commandOrPrefix) =>
      myPolicy[list].some((rule) => matches(rule, commandOrPrefix)),
  }),
  // Optional. Claims a failed Bash result for a bucket of your own (any string); it runs after the
  // E2BIG check and before the generic permission signatures, and its kinds are reported
  // separately from bypass candidates. It also runs on Codex CommandExecution output, and Codex
  // transcripts are only read when this rule is set.
  classifyFailure: (command, text, source) =>
    /read-only file system/.test(text) ? 'write-path' : undefined,
  // Optional. Overrides any scan cap (see AuditLimits); each must be a non-negative integer.
  limits: { maxRetainedRecords: 1000 },
  worktreeGlobs: ['../checkouts/*'],
}
```

Built-in failure kinds are `genuine` (permission denied, `EACCES`, `EPERM`, sandbox start failures,
and a timeout against a loopback address) and `e2big`. A missing or unreadable policy, or an
unresolvable repository, prints a `Status: unavailable` report so a retrospective can still embed
the output. The pieces are exported from `vouchington-tooling/sandbox-command-audit`
(`scanTranscripts`, `discoverTranscriptFiles`, `resolveRepoRoots`, `classifyAudit`, `formatReport`,
`runAudit`). Codex escalations are not scanned: Codex agents journal those separately.

## Counting lines of code

`vouchington cloc --config <file> [--scc-bin <path>] [--json]` counts git-tracked lines with
[`scc`](https://github.com/boyter/scc) (`--by-file` CSV, streamed), classifies each file into
`source`, `tests` or `tooling` and into a service, and prints an aligned table with a `total` row
(`--json` prints the rows). The binary is `--scc-bin`, else `SCC_BIN`, else the config's `sccBin`,
else `scc`. Exits 0, 2 on a usage error, and 1 when the config or the count fails.

`<file>` is a `.json` file, or a module whose default (or `config`) export is the layout (or a
function returning it). Every field is optional:

```json
{
  "services": [
    { "name": "api", "match": ["api/"] },
    { "name": "web", "match": ["web/", "e2e/"] }
  ],
  "defaultService": "tooling",
  "categories": { "tests": "specs" },
  "testPatterns": ["*.test.*", "**/__tests__/**"],
  "toolingPatterns": [".github/", "**/scripts/**", "package.json", "*.config.*"],
  "countedRoots": ["api", "web", "e2e", ".github"],
  "countedRootFiles": ["package.json"],
  "excludedDirs": ["node_modules", "dist"],
  "ignoredDirs": ["fixtures", "__snapshots__"],
  "missingSccHint": "Install scc with your package manager."
}
```

- `services`: ordered; the first rule with a matching pattern wins, and the order is the row order.
  `defaultService` (default `other`) takes the rest and is appended when not listed.
- Patterns: no `/` matches the basename anywhere (`*.test.*`, `package.json`); a trailing `/` or a
  `/` without glob characters matches the path or anything under it; a `/` with glob characters is
  a full-path glob (`**/tests/**`). Dotfiles match. Tests are checked first, then tooling; the rest
  is source.
- `countedRoots` and `countedRootFiles` limit what is counted and what scc is given; omit both to
  count every tracked file. `excludedDirs` is passed to scc (defaults cover VCS, build and
  `node_modules` directories); `ignoredDirs` drops files under those directory names at any depth
  (defaults: `fixtures`, `__fixtures__`, `__snapshots__`).
- `categories` renames the three column labels; `missingSccHint` is appended to the error shown when
  the binary is not found.

The pieces are exported from `vouchington-tooling/cloc` (`loadClocConfig`, `normalizeClocConfig`,
`countFiles`, `buildRows`, `formatRows`, `createClassifier`, `createPathPolicy`,
`compilePatterns`).

## Checking the coverage collector scope

`vouchington coverage-scope-check [--rules <path>] [--scope-file <json>] [--include <glob>]...
[--exclude <glob>]...` fails when a `git ls-files -z` entry that a
[`coverage-check`](https://www.npmjs.com/package/coverage-check) rules file (default
`.coverage-rules.yml`) gives a `patch_coverage_min` above 0, and whose `scope` does not ignore, is
outside the collector's scope. Such a file would be required to have coverage that the collector can
never produce. Every mismatch is printed to stderr and the exit code is 1; 2 is a usage error.

The collector's scope is consumer input, mirroring the Vitest `coverage.include` and
`coverage.exclude` arrays: repeat `--include`/`--exclude`, or point `--scope-file` at a JSON file
`{ "include": [...], "exclude": [...] }` written from the Vitest config so the two cannot drift. Both
sources are combined, and at least one include glob is required.

```bash
vouchington coverage-scope-check --scope-file coverage-scope.json
vouchington coverage-scope-check --include '**/*.{mts,ts,tsx}' --exclude '**/fixtures/**'
```

The pure `findCoverageScopeMismatches(files, config, instrumentedScope)` and
`checkCoverageScope({ cwd, rulesFile, instrumentedScope, listFiles })` (which returns the
mismatches) are exported from `vouchington-tooling/coverage-scope`.

## Trivy policy and Docker Hub mirror checks

Two repository-file checks read the git-tracked files (`git ls-files -z`) under `--root` (default
the current directory), print one violation per line to stderr, and exit 1 when any exist (0 when
compliant, 2 on a usage error).

`vouchington trivy-policy [--ignore-file <path>] [--findings-exit-code-env <NAME>]
[--cleanup-url-prefix <url>] [--min-gates N] [--min-sboms N] [--max-expiry-days N]` requires every
Trivy package scan in tracked workflows, composite actions and shell scripts to be an auditable CLI
run block: no `trivy` action, wrapper, command or process substitution, `bash -c`, `eval`,
background job or grouped scan (shell scripts may only run `--download-db-only`). Vulnerability
gates must pass `--scanners vuln`, `--pkg-types os`, `--severity CRITICAL,HIGH`, `--ignore-unfixed`,
`--skip-db-update`, `--quiet`, `--format table --table-mode detailed`, one `--output`,
`--ignorefile <ignore-file>` (default `.trivyignore.yaml`) and `--exit-code "$<NAME>"` (default
`TRIVY_FINDINGS_EXIT_CODE`), with no other options. CycloneDX component SBOM scans must be unfiltered
(`--quiet --skip-db-update --exit-code 0 --format cyclonedx --output <file>`). At least `--min-gates`
gates and `--min-sboms` SBOM scans (default 2 each) must exist. The tracked ignore registry must list
exact versioned `deb`/`apk`/`rpm` purls, a `Not exploitable: <reason>. Cleanup: <issue URL>`
statement (the URL must start with `--cleanup-url-prefix` when given, else any GitHub issue) and an
`expired_at` UTC date after today and at most `--max-expiry-days` (default 30) away.

`vouchington docker-image-mirror [--mirror <host>] [--allow-registry <prefix>]... [--require-digest]` reports every Docker Hub image reference in
tracked workflows, composite actions and Dockerfiles: `docker run|pull|create`, `container:`,
`services:`, `docker://` uses, `docker/setup-buildx-action` drivers, `FROM`, `COPY --from` and
`# syntax=`. An image is accepted when it names a registry host; `--mirror` (default
`mirror.gcr.io`) is the host the message tells you to use.

`--allow-registry <prefix>` (repeatable) turns the check into an allowlist: every image reference
above, including `FROM`, `COPY --from` and `# syntax=`, must start with one of the prefixes, so
`mirror.gcr.io` and Docker Hub are rejected unless listed. `--require-digest` additionally requires
`@sha256:` followed by 64 lowercase hex characters. Earlier stage aliases, numeric `COPY --from`
indexes and `scratch` stay exempt. A reference that expands a variable (`${{ }}`, `$VAR`) is
checked by its literal text before the first variable: it passes only when that text already starts
with an allowed prefix, so a wholly dynamic reference is rejected, and a variable-expanded digest
never satisfies `--require-digest`. Without `--allow-registry`, behavior is unchanged (only Docker
Hub is rejected). Violations name the file, the image and the allowed prefixes or the digest requirement:

```bash
vouchington docker-image-mirror --allow-registry ghcr.io/vouchington/dependency- --require-digest
```

The checks are exported as `checkTrivyPolicy(root, trackedFiles, options)` from
`vouchington-tooling/trivy-policy` (plus the command parsers and `validateIgnoreRegistry`) and
`checkDockerImageMirrors(root, trackedFiles, { mirror, allowRegistries, requireDigest })` from `vouchington-tooling/docker-image-mirror`;
both return violation strings.

## Running the Storybook browser tests

`vouchington storybook-browser-runner --project <name> [--command <cmd>] [--result-file <path>]...
[--completion-file <path>] [--coverage-arg=<arg>]... [--optimize-deps-config <path>]
[--env-prefix <PREFIX>] [--progress-prefix <text>] [-- <argv>...]` runs the Storybook Vitest browser
project under a watchdog. It spawns `<cmd>` (default `pnpm`) in its own process group with `<argv>`
(default `exec vitest run --project <name>`) plus the coverage args (default `--coverage`, dropped
when `<PREFIX>_COVERAGE=0`), supervised by `browser-session-runner`. Arguments after `--` replace the
default argv and may begin with a dash; flag values that begin with a dash use `--flag=value`.

The runner keeps a Vite optimizer cache: a persistent one in CI (`.cache/vite/storybook-browser`, or
`<PREFIX>_PERSISTENT_CACHE_DIR`; `<PREFIX>_PERSISTENT_CACHE=0` turns it off) and a per-attempt one
otherwise. A successful attempt that used a fresh cache is promoted to the persistent one. It
retries (at most 3 attempts, `<PREFIX>_STARTUP_ATTEMPTS`) on known Vite and browser start-up flakes:
a failed dynamic import from the Vite server, `ERR_NETWORK_CHANGED` before any test progress, the
Storybook add-on's "Vitest failed to find the runner", an optimizer that stops progressing
(`_OPTIMIZER_STALL_MS`, default 30000), and a tester-connection hang (`_HANG_MS`, default 120000).
A start-up failure clears the persistent cache and the retry uses a fresh attempt cache. A stall
after test progress began, an expired session budget (`_SESSION_BUDGET_MS`, default 300000) and a
spawn failure are never retried. When Vite discovers new `optimizeDeps` and reloads, the run is not
retried and the guidance names `--optimize-deps-config`. Progress markers and `vite:deps` debug
output are kept out of the log and replayed from a bounded tail when an attempt fails, and a
diagnostics file (`_DIAGNOSTICS_FILE`, default `storybook-browser-diagnostics.log`) holds the
per-attempt summaries and the output tail.
Before it terminates a stall or hang, the runner writes
`[storybook-browser] process group <pgid> at stall:` and one line per process of the test command's
group and its descendants, including the detached browser (pid, RSS in MB, %CPU, state, role such as `renderer`, `gpu-process` or `browser`; never argv,
capped near 4KB), sampled with `ps -ax` and best effort. The semantic-stall message names the last
progress marker and its age, and the attempt summary counts Playwright `Target.targetCrashed` and
`Inspector.targetCrashed` (`targetCrashCount`) and `Target.detachedFromTarget`
(`targetDetachCount`) protocol lines.

Everything repository-specific is a parameter: the Vitest project name (also the browser-project
output marker), the command and argv, the `--result-file` paths removed before each attempt, the
`--completion-file` whose appearance is recorded, the optimizeDeps config path named in the
guidance, the env var prefix (default `STORYBOOK_BROWSER`) and the progress marker prefix (default
`[vitest-browser-progress]`, the one `createVitestStorybookProgressReporter` writes). The Vitest
config must read `VITEST_STORYBOOK_BROWSER`, `VITEST_STORYBOOK_BROWSER_API_PORT` and
`VITEST_STORYBOOK_BROWSER_CACHE_DIR`, which the runner sets for each attempt, and
`VITEST_COVERAGE_SCOPE`, set to the project name. The module is exported from
`vouchington-tooling/storybook-browser-runner` as `runStorybookBrowserTests(project, { env }, deps)`,
which resolves with the exit code; every effect (`spawn`, clock, timers, filesystem, streams) is
injectable through `deps`. Exits 2 on a usage error. The runner is POSIX-only (it signals process
groups) and the command exits 1 on Windows. Semantic progress comes from the progress-marker reporter
(`createVitestStorybookProgressReporter`); without it only the first project result counts as progress.
A session budget of 5000 ms or less caps the termination
grace at half the budget.

## Reclaiming finished worktrees

`vouchington worktree reclaim [--yes] [--json] [--max-worktrees N] [--timeout-ms N] [--pr-limit N] [--after PATH]` removes git worktrees whose work is done. It is a
dry run unless `--yes` is passed. It prints one line per worktree (`reclaimed`, `would reclaim`, or
`kept: <reason>`, control characters escaped), or `{ dryRun, worktrees, hasMore, nextAfter? }` with `--json`. Progress and elapsed time go to stderr.

Scans default to at most 100 registered worktrees and 30 seconds of read-only work. Read calls share
that deadline; a deletion already started is allowed to finish. An incomplete scan returns `hasMore`
and a path cursor (`nextAfter`) and prints `--after` instructions. Pass that cursor with the same
limits and `--yes` selection to resume; path ordering lets the cursor survive deletion of its worktree.
Increase `--timeout-ms` if a single slow worktree repeatedly exhausts the budget.
The cursor is an exclusive path boundary: newly added paths before it are covered by the next scan
from the beginning. When using a consumer cleanup wrapper that owns a resource lock, resume through
that wrapper rather than invoking the CLI directly.

It skips the main checkout, the caller's own worktree, and locked, bare, detached and missing
worktrees. Any other worktree is kept, with a reason, unless all of these hold:

- `git status` (untracked files and submodules included) is empty, and no index entry is
  assume-unchanged or skip-worktree.
- Shared repository-wide PR discovery has a merged or closed pull request from this repository (not a
  fork) whose `headRefOid` equals HEAD, and no open pull request from this repository. That PR also
  proves HEAD is published, so squash merges whose branch was deleted are reclaimed. A `gh` failure,
  or an incomplete open-PR list, keeps the worktree. Discovery reads open and recent PR lists once
  across all branches (paginated internally by `gh`). Each list is capped by `--pr-limit` (default
  1000, maximum 10000); worktrees without matching history are kept. Increase the limit to include
  older finished PRs. A full recent-history page can prove a candidate; a full open page cannot
  prove the absence of an open PR.

With `--yes`, candidates receive fresh branch-specific open/history PR checks, then HEAD,
cleanliness and registration are checked again right before `git worktree remove <path>` runs.
It is never forced, and a refusal from git is reported as kept. Ignored files (for example `.env`, `node_modules`, build output) are deleted with the worktree, exactly as `git worktree remove` does; keep anything you need outside ignored paths or commit it. An unexpected error on one worktree is reported as `kept: error: <message>` and the run carries on. There is no `prune`, no branch
deletion, and git runs with `core.fsmonitor=false`.

Known limitations: git cannot check and remove a worktree atomically, so a worktree that changes in the moment between the final check and `git worktree remove` can still be removed; the final check runs immediately before removal to keep that window small.

This is NOT a security boundary. Run it as a trusted user or agent, and do not grant it as an
unconditional allow rule. It has no teardown hook: per-worktree resources such as databases and
containers are reclaimed afterwards by the consumer's own orphan cleanup, because the worktree is
gone.

## Library

```ts
import {
  isRunnerReservedPort,
  listenOnLoopbackEphemeralPort,
  listenOnRunnerUnreservedEphemeralPort,
  runnerPortPolicy,
} from 'vouchington-tooling/runner-port-policy'
import { initSqlAst, extractCreateTableMetadata } from 'vouchington-tooling/sql-ast'
import { splitSqlStatements, stripSqlComments } from 'vouchington-tooling/sql-scanner'
import { auditCiJobRuntime } from 'vouchington-tooling/gha-runtime-audit'
import {
  inspectHarnessEnvironment,
  selectHarnessSession,
} from 'vouchington-tooling/agent-harness-identity'
import {
  readVitestReportAttempts,
  writeVitestBlobManifest,
} from 'vouchington-tooling/vitest-blob-manifest'
import { prepareVitestReports } from 'vouchington-tooling/vitest-reports'
import { runInstallLifecycle, validateReleaseAgePolicy } from 'vouchington-tooling/pnpm-install'
import {
  buildSharedContext,
  installFakeGit,
  runNamedChecks,
} from 'vouchington-tooling/shared-context'
import { createSourceModuleGraph } from 'vouchington-tooling/source-module-graph'
import {
  decodeSelectedFiles,
  writeSelectedFilesOutput,
} from 'vouchington-tooling/gha-selected-files'
import { createArtifactClassifier, runCleanup } from 'vouchington-tooling/gha-artifacts-cleanup'
import { ensureLabels, labelsFromPaths } from 'vouchington-tooling/agent-issue-labels'
import { validateOptionalHttpOrigin } from 'vouchington-tooling/http-origin'
// Replay recorded raw `.http` responses through an SDK `fetch` or AWS SDK v3 `requestHandler`:
// const replay = createProviderReplay({ chunkBytes: 3 })
// replay.respondWith(loadRecordedResponse('ok.http', { fixtureRoot: new URL('./fixtures/', import.meta.url) }))
// new Sdk({ fetch: replay.fetch }) or new AwsClient({ requestHandler: createAwsReplayRequestHandler(replay) })
import {
  createAwsReplayRequestHandler,
  createProviderReplay,
  loadRecordedResponse,
} from 'vouchington-tooling/provider-replay'
import { boundPendingLine, splitCompleteLines } from 'vouchington-tooling/process-line-buffer'
import {
  isProcessGroupAlive,
  runBrowserSession,
  waitForProcessGroupExit,
} from 'vouchington-tooling/browser-session-runner'
import {
  generateSchemaSnapshot,
  renderSchemaMarkdown,
} from 'vouchington-tooling/pg-schema-snapshot'
import { buildOpenApiDocument, writeOpenApi } from 'vouchington-tooling/openapi-document'
import {
  extractResponseContracts,
  validateResponseContract,
} from 'vouchington-tooling/contract-schema'
import {
  buildFixtureSchemaLock,
  validateFixtureContracts,
  writeGeneratedFiles,
} from 'vouchington-tooling/api-fixtures'
import { decide, deriveRetryAttempt } from 'vouchington-tooling/transient-retry'
import { scanTranscripts, classifyAudit } from 'vouchington-tooling/sandbox-command-audit'
import { runStorybookBrowserTests } from 'vouchington-tooling/storybook-browser-runner'
import { parseCsvRows, streamCsvRows } from 'vouchington-tooling/csv'
import {
  extractLooseMarkdownTableRows,
  extractMarkdownTables,
  markdownSectionBetweenHeadings,
  parseGfmMarkdown,
  parseMarkdownTables,
} from 'vouchington-tooling/markdown'
import { readResponseBody } from 'vouchington-tooling/http-body'
import { runAstGrepRule } from 'vouchington-tooling/ast-grep-rule'
import { parseReviewPayload, remapReviewComments } from 'vouchington-tooling/gha-review-payload'
import { postReviewWithTokenFromEnv, runPostReview } from 'vouchington-tooling/gha-post-review'
import { postClaudeReviewFromEnv } from 'vouchington-tooling/gha-claude-post-review'
import { nextPageUrlFromLinkHeader } from 'vouchington-tooling/http-link-pagination'
import {
  cmdUpload,
  discoverDownloadControl,
  mintPrefixUploadControl,
} from 'vouchington-tooling/coverage-transport'
import { pruneDeployedRuntimeDeps } from 'vouchington-tooling/pnpm-deploy'
import { parseDockerfileRuntimeImages } from 'vouchington-tooling/dockerfile-parse'
import { checkSccComplexity } from 'vouchington-tooling/scc-complexity'
import { runCiLocal } from 'vouchington-tooling/ci-local'
import { rateLimitDelay } from 'vouchington-tooling/gha-rate-limit'
import { parseCheckpoint } from 'vouchington-tooling/gha-pr-checkpoint'
import { checkWorkspaceGatesPolicy } from 'vouchington-tooling/workspace-gates'
import {
  collectPnpmLicenseReport,
  evaluatePnpmLicenseReport,
} from 'vouchington-tooling/dependency-license-policy'
import { checkGhaWorkspacePolicy } from 'vouchington-tooling/gha-workspace-policy'
import { requireUpToDate } from 'vouchington-tooling/require-up-to-date'
import { checkFreshBase, classifyFreshBase } from 'vouchington-tooling/fresh-base'
import { runGitleaksDirectoryScan } from 'vouchington-tooling/gitleaks-directory-scan'
import { runAstGrepExamples } from 'vouchington-tooling/ast-grep-examples'
import { astGrepPackPaths } from 'vouchington-tooling/ast-grep-pack'
import { validateNugetUpdate } from 'vouchington-tooling/nuget-central-version'
import { runVerifyWorkflowSecretsCli } from 'vouchington-tooling/workflow-secrets-drift'
import { launchSession, loadTmuxConfig } from 'vouchington-tooling/tmux'
import { runDeadCodeGate } from 'vouchington-tooling/dead-code'
import { normalizeSwiftSource } from 'vouchington-tooling/swift-semantic-equal'
import { parseUniqueSwiftBinaryTargetChecksum } from 'vouchington-tooling/swift-source-offset'
import { validateResolvedPinDelta } from 'vouchington-tooling/swift-resolved-pin-delta'
import {
  createForkLeakDetector,
  createVitestWorkerExitDiagnosticsReporter,
  formatDiagnosticReportSummaries,
  readDiagnosticReportSummaries,
  registerForkExitSentinel,
} from 'vouchington-tooling/vitest-diagnostics'
import { runRetrospectiveTranscript } from 'vouchington-tooling/retrospective-transcript'
import { appendJournal, probeBlackboard } from 'vouchington-tooling/agent-blackboard'
import { GITHUB_BODY_MAX_CHARACTERS, validateGitHubBodyLength } from 'vouchington-tooling'
import { createPullRequest, processDiffCommand, runGh, runGit } from 'vouchington-tooling/gh-cli'
import {
  shellScriptViolations,
  workflowYamlViolations,
} from 'vouchington-tooling/gh-api-shell-quoting'
import { tokenizeShellWords } from 'vouchington-tooling/shell-parse'
```

`vouchington-tooling/shell-parse` splits shell text into words, heredocs, redirections, and command prefixes. Callers pass the text. The parser does not decide which commands are allowed. `stripQuotedShellText` and `commandsToInspect*` do not scan `$(...)` substitutions in the command text: call `extractShellCommandSubstitutions` and inspect each result too.

`gitInvocations(command)` returns each `git` run in command position (after `;`, `&&`, `||`, `|`, a newline, env assignments, or wrappers such as `env`, `sudo`, `xargs`, `timeout`, `nice`) as `{ globalOptions, configOverrides: [{ key, value }], subcommand, args }`. Global options (`-c`, `-C`, `--git-dir`, `--no-pager`, ...) are skipped to reach the subcommand, and `git` as an argument (`printf '%s' git`) is not an invocation. `overridesConfig(invocation, 'core.hooksPath')` checks the `-c` keys case-insensitively. Substitutions and `bash -c` scripts are not read; run it on each result of `extractShellCommandSubstitutions` and `extractShellCommandArguments`. Known best-effort limits: value options inside clustered short wrapper flags are not read, backtick bodies are not read, and a quoted redirection-looking word mid-argv can truncate `args`.

`vouchington-tooling/command-policy` judges a tool call's shell command against a rule table the
caller supplies. `evaluateCommandPolicy(payload, policy, { automationContext })` returns a
`BlockDecision` or `null`. The `CommandPolicy` table holds typo paths, protected paths (blocked only
in automation), command and git regex rules (`standardGitPatterns()` is an opt-in preset), and an
optional `stack` section for `gh stack` workflow rules. Merge authority is generic: automation never
merges, and one plain interactive `gh pr merge` yields a `confirm` disposition. Every path, reason,
base branch, and guidance pointer is a parameter; the module has no repository-specific rules. The
GitHub command parsing it uses (invocations, options, command position and working directory,
checkout owners) is exported too.

`vouchington hook pre-tool-use|post-tool-use --harness claude|codex|cursor|grok --policy <module>`
runs that engine as a harness hook. Register it in each harness's hook configuration with the
repository's own policy module, which default-exports a `HookPolicy` (`defineHookPolicy`): a
`command` rule table, post-tool-use `checkers`, an optional `reminder`, and an optional `onPayload`
callback (for example to persist the harness session id). `pre-tool-use` exits 2 to block, including
when the module cannot load; `post-tool-use` is advisory and always exits 0, folding checker warnings
and the reminder into one `additionalContext`. `--root` defaults to the working directory. `--automation-env NAME` (repeatable) names an extra environment variable that marks the run unattended when it is set and not empty, `0`, or `false`; CI markers and `claude -p` always count. Register `post-tool-use` with an edit-only matcher (for example `Edit|Write|apply_patch`): the command treats every `file_path` it sees as an edit, and it emits the Claude/Codex `hookSpecificOutput` shape for Claude and Codex. Grok ignores stdout for passive events and its hooks contract documents no other channel for PostToolUse text (https://docs.x.ai/build/features/hooks#the-script-contract), so with `--harness grok` (or a Grok environment marker) it prints nothing. `pre-tool-use` also checks commands inside `$(...)` and backtick substitutions within double quotes, one level deep and best effort; single-quoted text and plain quoted arguments stay ignored.

`processDiffCommand` runs a caller-supplied `git diff` or `gh pr diff` executable and argv without
a shell, emitting complete unified-diff file blocks without accumulating the whole patch. It keeps
at most one file block (which can itself be large), preserves preambles and line content, and drains
a bounded stderr tail for typed command failures. Blocks are provisional until the returned promise
resolves: callers must discard accumulated results if the command later exits nonzero or is signaled.

```ts
let changedFileCount = 0
await processDiffCommand({ executable: 'git', args: ['diff', 'origin/main...HEAD'] }, async () => {
  changedFileCount += 1
})
// Use changedFileCount only after processDiffCommand resolves.
```

`vouchington-tooling/gh-cli` also parses pull request body references.
`parseClosingIssueReferences` finds GitHub closing keywords (`close`/`closes`/`closed`,
`fix`/`fixes`/`fixed`, `resolve`/`resolves`/`resolved`) followed by `#N`, `owner/repo#N` or an issue
URL, deduplicated by key (`#N` or lowercased `owner/repo#N`, see `formatReferenceKey`).
`parseNonClosingRefs` collects `Ref`, `Refs` and `Part of` keys from text the caller has already
scoped, such as a "Related issues" section.

`vouchington-tooling/pull-request-diff` counts added and deleted lines in unified-diff text
(`countDiffLineChanges`, excluding `+++`/`---` headers) and compares them with caller-supplied
`LargeDiffThresholds` through `exceedsLargeDiffThreshold`. `DEFAULT_LARGE_DIFF_THRESHOLDS`
(5,000 added, 20,000 deleted) is only an example default.

```ts
import {
  countDiffLineChanges,
  exceedsLargeDiffThreshold,
} from 'vouchington-tooling/pull-request-diff'

exceedsLargeDiffThreshold(countDiffLineChanges(diffText), {
  addedLines: 5000,
  deletedLines: 20_000,
})
```

This breaking minor removes `getDiffAgainstBase`; migrate callers to `processDiffCommand` and pass
the command they need to run.

`checkSccComplexity` keeps its single repository-wide scan when `scopes` is omitted. Consumers
that need separately ratcheted areas may provide named scopes with positional `includePaths`; SCC
runs once per scope and reports the scope in each diagnostic. Parse a consumer-owned JSON baseline
with `parseSccComplexityBaseline` and pass it as `baseline`. Baselines are versioned, record the
maximum permitted complexity for each `{ scope, file }`, suppress only values at or below that
ceiling, and reject malformed, duplicate, untracked, stale, or out-of-scope entries.

`shellScriptViolations`/`workflowYamlViolations` flag a `gh api` call whose argument carries an
unquoted `?` or `&`: an unquoted `&` silently backgrounds the command and truncates the query
(the call still exits 0), and an unquoted `?` fails loudly under zsh glob-nomatch but passes
through unexpanded under bash. `workflowYamlViolations` decodes quoted and folded YAML `run:`
scalars before scanning, so a hazard hidden by YAML's own quote-stripping is still caught; it
throws on a `run:` value that is a YAML alias or a multiline PLAIN scalar, shapes it cannot yet
scan safely. Both functions scan already-in-scope source text — deciding which files count as a
shell script or a workflow/action YAML file is left to the caller.

`validateGitHubBodyLength` measures an issue or pull-request body against GitHub's 65,536 Unicode
code-point limit without altering it. Its result includes the UTF-8 byte count for diagnostics; that
byte count is not a validation limit.

`vouchington-tooling/markdown` parses GFM into standard mdast/unist nodes, provides pre-order
walking and typed searches, normalizes node text, and extracts positioned tables or heading-bounded
source sections. `parseMarkdownTables` preserves its compact `{ cells, line }[][]` compatibility
shape, including short table delimiters. `extractLooseMarkdownTableRows` is intentionally literal
recovery for malformed pipe rows; callers supply table positions to exclude and retain ownership of
their policy interpretation.

`parseMarkdownSections` returns visible root H2 sections, their exact original `content`,
`startOffset`/`endOffset` source ranges, heading line, and `hasVisibleContent`. Heading text is
normalized by collapsing whitespace and removing Markdown formatting/comments and collapsed text; matching remains
case-sensitive. Source offsets are JavaScript string offsets, so `source.slice(startOffset,
endOffset)` preserves Unicode and CRLF exactly. Sections end at the next visible root H2 or EOF;
fenced examples, quoted headings, and headings inside `<details>` do not create boundaries.

```ts
import { parseMarkdownSections, validateMarkdownSections } from 'vouchington-tooling/markdown'

const document = parseMarkdownSections(body)
const diagnostics = validateMarkdownSections(document, {
  requiredHeadings: ['Summary', 'Impact'],
})
const relatedIssues = document.sections.find((section) => section.heading === 'Related issues')
```

The caller owns required headings. Validation returns diagnostics with `code`, `message`, and
optional `heading`/`line`, for `missing-heading`, `duplicate-heading`, `empty-section`, or
`malformed-details`. Nonempty visible paragraphs, lists, and populated table bodies satisfy the
content check; comments, fenced/indented code, images, disclosure labels, and collapsed-only content
do not. The parser tracks balanced nested details/summary tags in GFM HTML nodes, accepting optional
summaries and quoted attributes; it is not a general HTML validator or sanitizer. It never rewrites
the input or infers semantic relevance, cost, schema conformance, or failure causes. The existing
`markdownSectionBetweenHeadings` API retains its original boundary behavior.

`hasUncheckedMarkdownTask` reports parsed unchecked GFM task items, ignoring code and non-task text.
`markdownLiteralSpans` returns source-backed `{ kind, position, value }` facts for fenced or indented
code, inline code, and raw HTML. `markdownHtmlFacts` distinguishes inline HTML from block HTML and
labels CommonMark block types 1–7; `markdownHtmlBlocks` selects block types 1, 6, and 7, retaining
the parser's source bounds, including type 1 blocks through their matching closer or end of input.
Positions use 1-indexed line/column coordinates and JavaScript string offsets, including CRLF and
Unicode source text. These APIs return facts rather than mdast nodes so callers can apply their own
content policy without binding it to parser internals.

```ts
import {
  hasUncheckedMarkdownTask,
  markdownHtmlBlocks,
  markdownLiteralSpans,
} from 'vouchington-tooling/markdown'

const hasOpenTask = hasUncheckedMarkdownTask(body)
const literalSpans = markdownLiteralSpans(body)
const blockHtml = markdownHtmlBlocks(body)
```

`markdownHtmlBlocks` reports CommonMark types 1, 6, and 7; inline tags do not appear in that result.
Use `markdownHtmlFacts` when inline/block classification and other CommonMark HTML block types are
also needed.

Machine-wide agent configuration now belongs to [vouchington-machines](https://github.com/vouchington/vouchington-machines/blob/main/docs/agent-config.md).
Use its `configure-agents.sh` and `diagnose-agents.sh`; project hooks and MCP configuration remain in their checkouts.

`agent-harness-identity` inspects the four harness environment signals without choosing a winner.
Callers supply their own precedence to `selectHarnessSession`, keeping product-specific identity
policy out of this package.

`checkWorkspaceGatesPolicy` rejects tracked test assertions that hard-code the exact version of a
dependency declared by a non-fixture package manifest. Assert dependency membership or placement,
or derive a configuration or documentation package spec from that manifest instead.

`dependency-license-policy` keeps legal policy in the consumer. `collectPnpmLicenseReport` returns
a promise. It creates an isolated, script-free temporary workspace, expands pnpm's supported
architectures to every `os`, `cpu`, and `libc` selector represented in the lockfile, drops every
`engines` constraint from the audit copy of the lockfile, and validates the JSON report. Dropping
`engines` keeps `pnpm fetch` from skipping optional packages that exclude the running Node.js;
pnpm 12's `fetch` ignores `force`, so their licenses would otherwise report as Unknown.
Packages are fetched into a private store inside that temporary workspace. Each audit has its own
store, and workspace cleanup removes every downloaded package when the audit succeeds or fails,
without changing the developer's pnpm store. The exported options no longer accept a `storeDir`
override because caller-owned paths cannot be safely removed; callers that provide a custom
`prepareWorkspace` own the returned workspace and its nested store lifecycle.
Pass explicit denied SPDX IDs and prefixes, exact aliases, and justified allowlist scopes to
`evaluatePnpmLicenseReport`. Unknown, malformed, and custom SPDX references fail closed. Allowlist
scopes are either intentionally global or an exact package-name set; the library returns structured
violations and does not format CI-provider diagnostics.
When present, the repository `.npmrc` is copied into the owner-private temporary workspace so pnpm
can authenticate to the same registries. The workspace and its package store are removed when the
audit finishes, when the process receives SIGINT, SIGTERM, or SIGHUP, and on the next audit if the
previous process died first, including SIGKILL. Each workspace records its owner's PID so a later
audit can delete directories whose owner is gone.

The artifact, review-payload, HTTP body, and pagination APIs validate untrusted inputs at their
boundaries. Neutral review posting lives in `gha-post-review` and requires a caller-supplied GitHub
token. Claude App OIDC is an explicitly selected `gha-claude-post-review` adapter; the legacy
token-source router remains deprecated for one release line.

`vitest-diagnostics` reads Node diagnostic report JSON from a caller-selected directory. It sorts
filenames, tolerates partial files, returns only a bounded field allowlist, and never emits raw
native frame symbols. Both structured reads and text rendering have hard report-count limits.

Fork diagnostics use a caller-selected `recordDirectory` in both the worker setup file and the
main-process reporter. Call `registerForkExitSentinel({ recordDirectory })` once per fork, then
update `setCurrentForkExitModule` and `setCurrentForkExitProject` around tests. Construct
`createVitestWorkerExitDiagnosticsReporter({ recordDirectory })` in the Vitest reporter list
before workers start. The reporter clears stale records at construction, preserves them across
watch reruns, and prints an attribution summary only for abnormal worker exits. The worker writes
a synchronous stderr line and one JSONL file per PID; a start record without an exit record
identifies a fork killed before its handler could run. `createForkLeakDetector` accepts tracked
resource names and warmup, threshold, and sustained-growth settings; the caller supplies each
checkpoint's resource counts. `getForkLeakDetector` keeps one detector for the process.
`formatForkLeakDiagnostics` stays a one-line summary unless resource counts are passed, in which
case it prints the multi-line report and optional pool metrics. `waitForForkLeakHandshakeSettle`
waits for a caller-supplied pool snapshot to settle. `installTestNetworkAllowlist` takes the
allowed hosts, an exempt predicate, and the state key. `checkAndRestoreFakeTimers` restores real
timers and returns a diagnostic when a test left fake timers installed.
`countResourcesByType` turns resource names into per-type counts and `recordForkLeakCheckpoint`
feeds a handshake settlement's counts to a detector. `formatForkLeakDiagnostics` takes an optional
fourth argument, `{ poolMetricsLabel }`, to replace the default `pool metrics:` label (for example
`'PostgreSQL pool metrics:'`).

`ciReporters(options?)` builds the Vitest `reporters` list from env vars, and `ciOutputFile(options?)`
builds `outputFile`. Unset or empty `VITEST_CI_REPORTERS` returns `undefined` (or `default` plus file
progress when `VITEST_DIAGNOSTICS=1`); `run` returns `minimal`, the optional Storybook progress
reporter (`VITEST_STORYBOOK_BROWSER=1`), `github-actions`, `junit`, `extraReporters`,
`hanging-process`, and file progress (stdout with `VITEST_DIAGNOSTICS=1`, appended to
`VITEST_FILE_PROGRESS_FILE` when set). Options: `env`, `envNames` (rename any variable; see
`DEFAULT_CI_REPORTER_ENV_NAMES`), `fileProgressPrefix`, `storybookProgressPrefix`, `extraReporters`
(for example a no-skips or teardown-overrun reporter), and `cwd`. The progress reporters print
`<prefix> event=start|finish module="..."` and `<prefix> seq=N event=module-*` lines; the defaults
are `[vitest-file]` and `[vitest-browser-progress]`, exported as `DEFAULT_FILE_PROGRESS_PREFIX` and
`DEFAULT_STORYBOOK_PROGRESS_PREFIX`. Pass the same prefix to `formatFileProgress`,
`formatStorybookProgressMarker`, and `latestStorybookProgressSequence(text, prefix)` when parsing.
These stay in the Node entry, never the browser entry.

`vouchington-tooling/vitest-diagnostics/browser` is the browser-safe entry for Storybook and Vitest
browser projects, for example a root fake-timer setup file shared with a Node project. It exports
only `checkAndRestoreFakeTimers`, `formatFakeTimerLeakDiagnostics`, and the `FakeTimerController`
type, and its import graph contains no `node:*` imports (a test enforces this), so it needs no Vite
`optimizeDeps` entry. The resource, fork-leak, reporter, and network-allowlist helpers stay in the
Node entry, and the effective-timeout cap is a config-time plugin that belongs in Node config.

Use a caller-owned run directory: the reporter clears only regular numeric PID `.jsonl` files
there at construction and leaves the directory and other files alone. Application metrics and CI artifact handling stay with the caller.

`vitest-effective-timeout` exports `effectiveTimeoutCap`. The plugin rejects a project whose effective
`testTimeout` or `hookTimeout` is missing, non-finite, non-positive, or above the caller-supplied cap
(default 30 seconds). The plugin name, the expected root config filename, and the profile scratch
directory are parameters. `checkFiniteTimeoutProfiles` writes one scratch project per admission
profile and can take a caller-supplied runner.

`next-navigation-mock`, `jsdom-stubs` and `input-otp-mock` are test-only helpers for Vitest component
tests; `next` and `react` are optional peers, and each subpath imports only what it needs.
`vi.mock('next/navigation', () => navMockModule)` swaps in a singleton router whose spies and
state (`setSearchParams`, `setPathname`, `setParams`, `reset`) come from `createNavMock()`.
`installJsdomStubs()` adds no-op `ResizeObserver`, `IntersectionObserver`, `matchMedia` and
`scrollIntoView` only where jsdom lacks them. `installMemoryLocalStorage()` swaps in an in-memory
`localStorage` and returns it so `afterEach` can clear it. `vi.mock(import('input-otp'),
inputOtpMockFactory)` replaces the library's post-teardown timer with a plain input.

`playwright` monitors browser console errors, web errors, dialogs, page crashes, and failed
requests during Playwright tests. `@playwright/test` is an optional peer. `createBrowserTest` and
`withMonitoredPage` install the generic telemetry blocks (Google Tag Manager, Google Analytics, and
DoubleClick) and fail the test when an unallowlisted issue remains. Passing `rules` replaces those
generic defaults rather than adding to them; spread `BLOCKED_EXTERNAL_NETWORK_RULES` to extend them. The default request-failure allowlist follows
the active rules, and when two rules match one URL the later rule wins. `assertTimeout` runs in both
`createBrowserTest` and `withMonitoredPage`.
Pass host-specific block rules and request-failure allowlist entries, a warning pattern, and a timeout checker; the default warning
pattern records React hydration and render warnings. The fixture does not import a product timeout
guard: pass `assertTimeout` when the caller owns the timeout cap.

`playwright` waits for below-fold hydration, retries transient local connection loss, navigates
through an injectable Turnstile stub, and scrolls a caller-supplied sentinel into view.
`@playwright/test` is an optional peer. The stub's attribute name and token default to `data-pw`
and `PLAYWRIGHT_TURNSTILE_TOKEN`. The scroll helper's sentinel test id defaults to
`infinite-scroll-sentinel`.

`playwright` provides small Playwright helpers: a virtual authenticator, a Radix dropdown opener,
a Storybook index probe, required-value and mobile overflow assertions, an image-response guard,
random suffixes, viewport sizes, a 1x1 PNG fixture, RFC 6238 TOTP codes, and a test-lifecycle
reporter. The reporter prints one JSON line per test with the marker `playwright-test-lifecycle`.
`@playwright/test` is an optional peer. TOTP setup and cleanup stay with the caller.

`createBrowserErrorsFixture`, `withMonitoredPage`, and `BrowserIssueMonitor` take the narrow
exported `MonitoredTestInfo` type (`attach`, `status`, `expectedStatus`, `timeout`) instead of
Playwright's full `TestInfo`. A real `TestInfo` is assignable to it, so no cast is needed.

`TestLifecycleReporter` accepts `failOnSkippedTests`, a plain boolean that defaults to `false`; the
reporter never reads `process.env.CI`, so the caller opts in explicitly:
`reporter: [[TestLifecycleReporter.modulePath, { failOnSkippedTests: Boolean(process.env.CI) }]]`.
When enabled, a run that would otherwise pass fails through the reporter's `onEnd` result status,
and stderr lists each skipped test's title path and `file:line`. Every test whose latest attempt
is `skipped` counts, including `test.fixme`, `test.skip`, and runtime `test.skip()`, because
Playwright reports all of them as `skipped`. A run that already failed keeps its status.

`browser-session-runner` supervises caller-created browser-test processes. Callers supply command
construction, line classification, retry/outcome policy, and budgets; the library owns process-group
termination, output line buffering, shared deadlines, progress watchdogs, diagnostics, and parent signals.
The returned process must identify a dedicated process group, such as a child spawned with
`detached: true`; its `processGroupId` is signalled without assuming the child PID is a group ID.
Stall exits use the caller's `classifyExit` policy, while parent signals and shared-deadline expiration
are terminal. Output is decoded independently per stream; unfinished lines are classified at close and
`diagnosticTailBytes` retains a UTF-8-safe tail no larger than its byte budget.
The runner uses monotonic elapsed time, rejects timer budgets above Node's maximum delay, and waits for
the dedicated process group to exit after the direct child closes so descendants cannot overlap a retry.
`isProcessGroupAlive` and `waitForProcessGroupExit` are also available when callers need the same
process-group probe and bounded-drain semantics outside a browser session.

`listenOnLoopbackEphemeralPort(server, options?)` from `runner-port-policy` binds an ephemeral port
outside the reserved runner range on IPv6 loopback (`::1`) and falls back to `127.0.0.1` only when the
host reports `EAFNOSUPPORT` (for example a kernel booted with `ipv6.disable=1`). Any other bind error is
rethrown. It resolves `{ host, port }` and accepts the same `EphemeralListenerOptions` (`isAllowedPort`,
`listen`, `maxBindAttempts`, `policy`) as `listenOnRunnerUnreservedEphemeralPort`, whose bind-retry loop it reuses.

### Generated arbiter input

The `pg-schema-snapshot` export also provides `projectGeneratedArbiterInput(conflict)` for
`PostgresSqlConflict` facts from `no-mistakes@0.83.0` or newer. It projects normalized key and
partial-predicate column identities, ordered assignment columns, direct non-EXCLUDED references,
and assignment indirection. Named constraints and unresolved expression keys have undefined
`keyColumns`; missing or incomplete expression coverage sets `complete` to false. Callers must
reject incomplete projections and retain their own snapshot-dependent replay verdict. The adapter
loads no optional parser peer at runtime and implements no replay-safety policy. Its public
`GeneratedArbiterConflict` contract is structural, so importing snapshot declarations does not
require the optional peer either.

### Contract schema type queries

`getExportedTypeFacts` and `getCallRowTypeFacts` use an existing TypeScript `Program` from the
`contract-schema` subpath. Every request must also pass `typescript`, the same TypeScript compiler
API instance that created that `Program`. The source-file recognition check is a compatibility
guard, and callers remain responsible for pairing the same compiler instance; the query uses the
supplied API for compiler operations. Pass the exact `SourceFile.fileName`, an exported name or exact call
expression text, and only the property names and exported comparison types the consumer needs.
Facts include the displayed type, whether it is `any`, requested property displays, and requested
assignability booleans. `defaultTypeParameterIndex` selects an exported generic default;
direct defaults and direct references to preceding defaults are supported. Dependent composite
defaults and uninstantiated generic type declarations used as assignability targets fail with an
instruction to export and select a named instantiated type. Generic function values remain valid
compiler-backed comparison targets. Default lookup uses an outer class, interface, or type-alias
parameter list when present; otherwise it uses the first checker-visible call or construct
signature, never a hidden implementation or a later overload.
`rowSource: 'typeArgument'` selects a call's explicit type argument, while
`rowSource: 'awaitedRows'` selects `Awaited<ReturnType>.rows[number]`.
Call results are source ordered and include one-based line and column. An absent call returns an
empty array so the consumer can enforce its own cardinality; a selected call missing its requested
row type fails with a descriptive error. The package does not choose source files, expected
properties, or contract policy.

## Workflow skills outside plugins

The package ships a flat union of canonical workflow, testing, and database skills at
`skills/<skill>/SKILL.md`. This stable installed path supports agents that do not load Claude or
Codex plugins. The package build materializes plugin source trees without hand-copying skill content
and writes sorted schema-v1 provenance to `skills/manifest.json`.
Each manifest entry may declare its ordered `prerequisites`; ordinary Markdown links remain
cross-references and never cause additional skills to be linked.
Prerequisites ensure installation closure; they do not require eagerly reading every installed
skill. Follow the invoked skill's conditional instructions for the current task.

Canonical entrypoints direct agents to applicable local instructions and adapters before using
portable policy. Local `AGENTS.md` may name an adapter alias; an already-read canonical skill or
adapter is not loaded again. `linkSkill` still links files only: it does not load instructions,
resolve local aliases, or execute a workflow. Validate observed agent loading separately from
installation and packaged-resource checks.

Use `readSkillManifest(skillsRoot)` to discover installed skills or
`linkSkill({ name, sourceRoot, targetRoot })` to link one into an explicit consumer directory. The
CLI equivalent is `vouchington link-skill <name> --source-root <skills-dir> --target-root <dir>`.
When `sourceRoot` contains `manifest.json`, linking validates the packaged inventory and recursively
links declared prerequisites. Without a manifest, it links the conventional
`<sourceRoot>/<name>/SKILL.md` repository-local skill. It rejects missing or unsafe sources, paths
outside either root, and existing non-matching destinations.
`targetRoot` must already exist as a physical directory path: symlinked target roots or ancestors are
rejected.

## Validated feedback and delivery

Import `createFeedbackEnvelope`, `validateFeedbackEnvelope`, `writeFeedback`, `verifyFreshFeedback`,
`composeRetrospective`, `feedbackOutboxStatus`, and `flushFeedbackOutbox` from the existing
`vouchington-tooling/agent-blackboard` subpath. Consumers must run Node 24 or newer and install `agent-blackboard@^0.6.0` explicitly alongside
`vouchington-tooling`; the provider is not installed by this package. Missing provider installation
returns `client-unavailable`; missing or invalid connection configuration returns
`configuration-invalid`, separately from transport outages and authentication rejection.
The upstream `agent-blackboard` client still owns the
service protocol; this integration adds no provider schema or service. Supply consumer module
context through `dependencies.resolveFrom` or inject the client loader at the transport boundary.

The version-one envelope retains canonical `markdown` and storage `type: journal | retrospective`.
It requires exact canonical repositories, stable URL-safe `sourceEventId`, ISO timestamp, explicit
`workOutcome`, and `feedbackCoverage` with status, sources, and dropped count. Optional category is
context only. Retrospectives retain valid date and integer/string issue/PR references. Markdown is
capped at 12 KB and the envelope at 16 KB. Known credentials are redacted; authors remain responsible
for minimizing summaries and excluding raw logs, transcripts, environment dumps, and undisclosed
secrets. A bound violation fails visibly without clipping findings.

`writeFeedback({identity, envelope, mode, ...})` accepts an exact caller-owned session identity and
never manufactures native agent identities. Interactive mode requires an absolute outbox
directory. Ancestor ownership and permissions are not checked; existing directory and record modes
are accepted. New directories and files default to `0700` and `0600`. The outbox itself must be a
real directory, and records must be regular files. The writer persists before transport with atomic
rename, file/directory fsync, and a stable record path. The outbox holds at most 128 records and 2 MB. Saturation,
corruption, or persistence failure blocks capture and preserves unsent records. Delivered records
are removed only after matching readback. Pending state includes count and a safe diagnostic;
interactive CLI exit zero means durable retention, and callers must inspect the printed status to
know whether delivery was acknowledged. Autonomous errors and unpersisted writes fail nonzero.
Identity, content, and archived-session conflicts fail in either mode while preserving the unsent
record; they are not reported as transient pending delivery. Replay retains permanently conflicted
records and continues to deliver unrelated pending records; transient failures stop that replay.
Verified delivery retains its receipt when local cleanup fails, returning
`cleanupDiagnostic` with value `"outbox-cleanup-failed"`. A retained or crash-reappearing record is
safe to replay: an event is identified by session, `sourceEventId`, and content, and a duplicate that
differs only in `timestamp` is the same event, so it reports the stored record's `timestamp` and
receipt and the retained duplicate is removed.
Use the `outbox_flush` MCP tool to replay unchanged pending records after connectivity returns.

Autonomous mode prohibits the filesystem outbox. `verifyFreshFeedback` requires a fresh source-event
write plus readback of its own append receipt and rejects visible duplicate source records. This
is fresh online reporting evidence, not a distributed execution lease: eventually consistent
provider reads cannot establish source uniqueness. Trusted controllers
supply a unique new authorization-probe source ID, preserve their authoritative run/session
lineage, and atomically claim and revalidate the attempt before execution. Terminal writes keep work outcome separate from coverage and returned delivery state.
The delivered result includes a verified receipt with session ID, source-event ID and creation time.
Controllers require this online result together with atomically established attempt ownership
before execution.

Delivery is at least once. Replays pre-read matching source identity/content, accept equivalent
persistent duplicates, and reject conflicting reuse. Equality ignores object property order while
preserving array order. Each online operation has a 20-second deadline (`timeoutMs` can shorten it);
readback scans at most 10,000 records or 2 MB. The SDK does not expose cancellation for in-flight
requests, so a timed-out write can commit later. That never grants admission or a delivery receipt;
replay the identical envelope and source ID to verify its actual persistence.

`composeRetrospective` invokes the existing fact/transcript collectors with raw output disabled and
generates required sections and markers. Tool and architectural assessments preserve observation,
evidence, disposition and tracking reference. None-observed and unassessed states need a scoped
reason. Complete coverage is rejected when required sources are unavailable or capture is partial.
Typed collector reports expose availability independently of rendered text. Generated frontmatter carries validated `work_outcome` and `feedback_coverage`
for consumers to preserve or reject conflicting explicit overrides; trusted mode stays external.
Human top-five summaries do not authorize dropping additional durable findings.

The `## CI Failures` and `## Sandbox & Permission Audit` sections come from one optional audit
source, `journal: {journalLoader}`: both sections are assessed from the session's journal entries
alone, with the text stating `journal entries only`. `feedbackCoverage.status: 'complete'` is
rejected when no journal source is supplied (the error names the missing source), and a journal
audit does not count as assessed when the loader reports `not-found` (nothing else establishes that
the session was observed), throws, or is truncated by the scan bounds.

```ts
await composeRetrospective({ ...input, journal: { journalLoader } })
```

`journalLoader` is a `JournalLoader`; `JournalLoader`, `JournalLoadResult`,
`JournalEntry`, and `JournalAuditOptions` are exported as types from
`vouchington-tooling/agent-blackboard`. The `## CI Failures` block grammar has three status
lines (`failures observed`, `none observed`, `unavailable (<reason>)`).
Journal-only sandbox and permission entries are journal Markdown entries that hold exactly one
block, escaped and length-bounded like CI failures, and other entries are ignored:

```markdown
- `sandbox-escalation` — git push — network write blocked
  - Outcome: requested | approved | denied | unknown
  - Evidence: permission prompt shown
  - Disposition: reran with approval
- `sandbox-failure` — node test — EPERM writing outside the worktree
  - Evidence: stderr showed EPERM
  - Disposition: moved output under TMPDIR
```

`ambiguous-failure` takes the same shape as `sandbox-failure`. The section reports
`Status: none observed` or `Status: events observed`, each followed by
`(journal entries only)`; a truncated scan reports
`unavailable (journal scan incomplete)` with the entries read so far.

## Basic Auth exemption facts

`vouchington-tooling/basic-auth-doc-sync` extracts literal exemption collections from
TypeScript and route rows from Markdown. Callers configure declaration names and
runbook headings, then compare the returned data using their own route policy.
See the [API contract](docs/basic-auth-doc-sync.md).

## TypeScript source graph

`vouchington-tooling/source-module-graph` exports `createSourceModuleGraph`. It accepts the
`modules` report from released no-mistakes
`analyzeTypeScriptModules({ root, files })`, plus the caller's root, ordered source extensions,
aliases, and file inventory. It resolves local imports and reexport owners without reading or
parsing source again. `runtimeImports(file)` uses binding references rather than declaration
presence, and `reachableFrom(entrypoints, { runtimeOnly: true })` follows used runtime imports,
reexports, and literal dynamic/require loads. Missing or incomplete facts for a reached file
throw; external specifiers resolve to `null`. The default file inventory limit is 10,000
files and can be reduced with `maxFiles`.

## Story coverage

`vouchington-tooling/story-coverage` exports `checkStoryCoverage`. It reports component exports
that no reachable story imports. Callers pass the repository root, component directory, story
directory, source extensions, component extensions, a marker regular expression, a story-file
pattern, path aliases, and an optional exclusions map. An empty map is the zero-exclusion
ratchet: any exclusion entry, even one that matches no component, makes `ok` false. Namespace imports of the component directory fail
the check because coverage cannot see which export was used. `vouchington story-coverage` runs
the same check and needs the optional `no-mistakes` peer.

## Retrospective distill classifier

`vouchington-tooling/retrospective-distill` exports `classifySession(session, entries, cutoffs)`,
which assigns a session one of `retrospective`, `entry-type-unresolved`, `checkpoint-only`,
`journal-only`, `zero-entry-child`, or `zero-entry-root` and decides distillation eligibility
against caller-supplied `retroCutoff` and `sessionCutoff` timestamps. It deduplicates replayed
source events, quarantines unknown entry types, invalid feedback envelopes, and conflicting source
events, and never marks an `entry-type-unresolved` session eligible. `readPartitionRecords(path)`
reads a local agent-blackboard partition JSONL file; `parseDistillClassifyArgs` and
`runDistillClassify` wrap both behind `<partition.jsonl> --retro-cutoff <iso> --session-cutoff
<iso>` and print one tab-separated line per session. The code is the source of truth for the
taxonomy; the retrospective-distill skill is its human-facing description.

## Static schema-allowlist pairs

`extractStaticStringPairs(source)` from `pg-schema-snapshot` collects the first two string literals
of every array expression in ESTree field traversal order, including arrays with extra elements.
Conditional alternatives precede consequents, preserving the existing parser walker. It
preserves duplicates and decoded string values. It does not evaluate imports, exported constants,
spreads, or templates, and malformed source throws. Schema-allowlist consumers retain their own
file selection, key filtering, deduplication, snapshot comparison, and diagnostics. Parsing is
source-only and does not build a TypeScript compiler program or execute the source.

## SQL view declarations

`vouchington-tooling/sql-ast` exports `extractViewDeclarations(sql)` and the
`ManagedViewDeclaration` type. Await `initSqlAst()` before calling the extractor. It returns the
qualified, PostgreSQL-quoted names and kinds of top-level `CREATE VIEW` and
`CREATE MATERIALIZED VIEW` declarations. It ignores comments, string literals, and other SQL
statements. Keywords that cannot be bare relation names remain quoted. Blank or unparseable SQL returns an empty
array; parser initialization and unexpected errors propagate. Consumers own view teardown and
lifecycle decisions.

## SQL index shapes

`vouchington-tooling/sql-ast` exports asynchronous `extractIndexShapes(sql)`. Await its result;
it lazily loads the optional `no-mistakes` peer and requires version 0.81.0 or newer when
called with nonblank SQL. Other SQL exports do not require this peer. It does not need
`initSqlAst()`. It returns
`{ idxname, table, shapeKey }` for each named top-level `CREATE INDEX`. Consumers can group
identical keys to detect collisions. Keys use upstream structural identity, including effective
sort/null ordering, quoted relation identity, expressions, predicates, operator classes, and
`INCLUDE` columns. Key serialization is opaque and must not be persisted across versions.
Any parse diagnostic rejects the whole input. Anonymous indexes and indexes inside `DO` blocks
are omitted. Consumer call sites must change from synchronous calls to `await` when adopting
this release.

## Publication writer inventory facts

`vouchington-tooling/post-publication-inventory` exports
`analyzePostPublicationWriterSource(source, fileName, options)`. It returns five booleans for an
approved capture-helper call, a capture opt-out, writes through a configured entity table,
generated relation writes, and eligibility-table writes. Consumers supply every module, symbol,
property, receiver, and table name through `PostPublicationWriterSourceOptions` and retain their
inventory schema, tracked files, exceptions, and diagnostics.

This preserves source-inventory heuristics, rather than proving runtime execution or SQL safety.
Capture imports/calls are name-based and order-independent; relation-variable appends are
order-sensitive. DML recognition examines literal/template text. Static table matching lowercases
the extracted name; dynamic literal table matching preserves case. Malformed TypeScript uses the
compiler's recovery tree. An argument-free append returns no relation fact.
Pass TypeScript source (`.ts` or `.mts`); the parser uses TypeScript mode even if the file name ends
in `.tsx`. Template expressions join their static fragments for DML matching, while DML prefixes
for generated-table facts come from templates rather than ordinary quoted strings. Dynamic
eligibility-table matching expects an unquoted literal immediately after the DML prefix and does
not recognize `DELETE FROM ONLY`.

## Publication reader source facts

The same subpath exports `sourceImportsAndComposesAny`, `sourceImportsAndUsesBoundaryAny`, and
`sourceFiltersWithPublicBoundary`. Each accepts source text, selected imported symbols, and
`ReaderSourceAnalysisOptions`. Configure allowed modules per imported symbol, SQL tag and executor
imports through the existing `ReaderSqlTemplateOptions`, the ignored-call identifier, and the
candidate ID property. Missing import configuration admits no module.

These functions preserve the existing lexical source heuristics: named import aliases, local
builder bindings, reassignment rejection, append/push consumption, returned boundary results,
and collection filtering with the selected ID set. They do not prove runtime execution, general
call graphs, or type identity. Malformed source throws through the ESTree parser. Inventory
selection, classifications, exceptions, and diagnostics remain consumer policy.

`composesPublicEligibilityView(source, options)` checks live SQL fragments with
`ReaderPublicViewOptions`: SQL extraction settings, source and eligibility relation names, and
their ID columns. Await `initSqlAst()` from `vouchington-tooling/sql-ast` before calling it. The
existing parser is reused; no separate SQL facts or parser dependency is introduced.

The check preserves the existing nested SELECT/CTE, equality, inner-join, and correlated EXISTS
heuristics. It rejects weakened OR/NOT/boolean/CASE predicates and non-filtering left joins. Every
recognized live source reader must be protected. Unparseable SQL fragments are skipped; malformed
source returns false. These are bounded syntactic heuristics, not a general SQL safety proof.

## tmux dev sessions

`vouchington tmux up --config <file>` starts the windows named in a JSON config inside one tmux
session per worktree (`<sessionPrefix>d<hash of the worktree path>`), reuses a running session,
and respawns dead windows. The config holds everything product-specific:

```json
{
  "sessionPrefix": "dev-",
  "readyMarker": "ready",
  "launcherPidVar": "TMUX_LAUNCHER_PID",
  "env": { "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318" },
  "summary": ["Web: http://localhost:3000"],
  "windows": [
    {
      "name": "web",
      "cwd": "web",
      "command": "pnpm run dev",
      "env": { "OTEL_SERVICE_NAME": "web" }
    },
    { "name": "api", "command": "node --watch api.mts" }
  ]
}
```

Windows run through `bash -lc '<command>; read'` (`"keepOpen": false` drops the `; read`).
`--verbose` sets `TMUX_LOG_LEVEL=info` (default `error`) in every window. The tmux binary comes
from `TMUX_TARGET_BIN`, the worktree from `TMUX_TARGET_ROOT` (default: current directory).

`tmux name`, `tmux read-title` and `tmux agent-reminder` verify that the pane (from
`--socket/--pane/--worktree` or `AGENT_TMUX_SOCKET/PANE/WORKTREE`) belongs to the worktree before
touching it. `tmux post-tool` reads an agent post-tool hook payload on stdin and prints a rename
reminder at plan, PR, push and reset checkpoints; reminders name `TMUX_NAME_COMMAND` (default
`vouchington tmux name`).

## Request query profiles

`vouchington-tooling/request-query-profile` is the test-only rule layer on top of a per-request
query telemetry summary. It has no runtime dependencies: the summary is a structural type
(`{ totalQueries, serialDepth, repeats: { annotation, count }[] }`) and the route resolver is a
function you pass in.

```ts
import {
  buildStaleReport,
  findUnbaselinedRepeats,
  formatRequestProfileLine,
  formatUnbaselinedRepeats,
  parseRepeatBaseline,
  parseRequestProfileLine,
} from 'vouchington-tooling/request-query-profile'

const baseline = parseRepeatBaseline(JSON.parse(baselineJson))
const line = formatRequestProfileLine('GET /orders/:id', summary, { all: false }) // null if no repeats
const parsed = parseRequestProfileLine(line ?? '') // { route, queries, serialDepth, repeats }
const bad = findUnbaselinedRepeats('GET /orders/:id', summary.repeats, baseline)
if (bad.length > 0)
  throw new Error(
    formatUnbaselinedRepeats('GET /orders/:id', bad, { baselineFile: 'test/query-baseline.json' }),
  )
const report = buildStaleReport(baseline, [logText], (route) => route) // report-only
```

- A baseline entry names an `annotation`, a `reason`, exact `routes` (`METHOD /path`, optionally
  followed by ` tools/call <name>`) and optional `workers: [{ queue, job }]`, a `maxCount` (an
  integer of at least 2, or `null` for unbounded), and either `issue` (a positive issue number, a
  temporary entry) or `permanent: true` with `code` (`<repo path>:<line, range or symbol>`).
  `parseRepeatBaseline` throws naming every malformed or duplicate-scope entry.
- `formatClosedBaselineIssues(baseline, states, { issueGroup })` reports temporary entries whose
  issue is not open; `states` maps issue numbers to their GitHub state.
- `formatRequestProfileLine` and `parseRequestProfileLine` are inverses and live in one module, so
  the line format cannot drift. `collectProfileObservations` also reads
  `{"kind":"pg-worker-profile", ...}` JSON lines, including nested `children`.
- `buildStaleReport(baseline, logTexts, resolveRoute)` and `findStaleBaselineEntries` never treat a
  missing or malformed diagnostic kind as evidence of absence: `sufficient` is false then, and the
  scopes of that kind stay unreported.

## PostgreSQL test faults and lock waits

`vouchington-tooling/postgres-test-faults` injects real PostgreSQL failures and observes real lock
waits for any `pg.Pool` application. It needs the optional peer `pg` (>=8) and `@types/pg`; no
product code is imported, so pools and request ownership are passed in.

```ts
import {
  createPostgresLockObservers,
  withPostgresPoolQueryFailureForTest,
  withPostgresQueryFailureForTest,
} from 'vouchington-tooling/postgres-test-faults'

const { result, error } = await withPostgresQueryFailureForTest(
  '/* orders:insert */', // exact leading block comment that marks the statement to fail
  () => placeOrder().catch((err: unknown) => err), // absorb the injected error
  { pools: [readPool, writePool], command: 'INSERT' },
)
// error.code === '25P02': PostgreSQL rejected the marked statement on an aborted transaction.
```

- `withPostgresQueryFailureForTest(marker, operation, options)` fails one marked statement on a
  client leased from `options.pools` with the promise form of `pool.connect()` (the callback
  overload is not instrumented), inside a transaction the operation began with `BEGIN`. A
  division by zero aborts that transaction, so PostgreSQL itself answers `25P02`.
- `withPostgresPoolQueryFailureForTest(marker, operation, options)` does the same for a marked
  `pool.query({ text })` call: it leases a real client, aborts its transaction, and hands the client
  to the unchanged `pg.Pool#query` core.
- Both resolve to `{ result, error }` only when the operation absorbs the injected `25P02` (catch
  or translate it, and return the outcome as `result`). If the operation lets the error
  propagate, the helper rejects with that error; it also rejects when the marked SQL never ran.
  Observers give up after `timeoutMs` even when a query never settles; `signal` is checked between
  steps, not inside a pending query. `options` is
  `{ pools, command?, requestId?, isOwnedRequest?, endTimeoutMs? }`. A statement is owned by the
  operation's async context, or by `requestId` when `isOwnedRequest(requestId)` returns true
  (use it for work that runs outside that context, such as a request handler). Scopes are
  serialized and cannot be nested.
- `createPostgresLockObservers({ write, advisoryLockPool?, timeoutMs?, intervalMs? })` binds the
  observers to your executors (any `({ text, values }) => Promise<{ rows }>`, for example
  `query => pool.query(query)`), with defaults of 5000 ms and 10 ms. It returns
  `getTestPostgresBackendProcessId(executor)`, `getTestPostgresAdvisoryLockHolderProcessId({ key,
  mode?, namespace? })`, `waitForTestPostgresLockWaiter(holderPid, marker, observer?, onDiagnostic?,
  signal?, waiterPid?)` and `waitForTestPostgresBlockedLockChain(holderPid, directMarker,
  blockedMarkers, observer?)`. The waiters poll `pg_stat_activity` and `pg_blocking_pids`; the
  observer is `'write'`, `'advisoryLock'` or a reserved executor.

- `runPoolObservationExclusively(operation)` is the queue the two helpers above share. Wrap your own
  fault injection or pool observation in it so it never overlaps theirs on the same pool; it
  rejects when nested.

The package's own tests start a throwaway cluster with `initdb`/`pg_ctl` found through
`POSTGRES_BIN_DIR`, `PATH` or a standard install location. They skip where no server can run and
fail under `CI`.
