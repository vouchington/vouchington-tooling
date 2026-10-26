import { COVERAGE_SCOPE_CHECK_USAGE } from './usage-text-coverage-scope.mts'

export const POLICY_COMMANDS = `  coverage-scope-check          Check positive-threshold coverage rules against the Vitest scope
  trivy-policy                 Check tracked Trivy workflow scans and the exception registry
  docker-image-mirror           Require tracked Docker images to come from a Docker Hub mirror
  workspace-registry-check      Check syncpack, pnpm workspace and CI path-filter registries against tracked manifests
`

export const POLICY_USAGE = `
${COVERAGE_SCOPE_CHECK_USAGE}
trivy-policy [--root <dir>] [--ignore-file <path>] [--findings-exit-code-env <NAME>] [--cleanup-url-prefix <url>] [--min-gates N] [--min-sboms N] [--max-expiry-days N]
  Reads git-tracked workflows, composite actions and shell scripts and prints each violation (exit 1).
  Every Trivy package scan must be an auditable CLI run block (no action, wrapper, substitution or
  background). Vulnerability gates need --scanners vuln, --pkg-types os, --severity CRITICAL,HIGH,
  --ignore-unfixed, --skip-db-update, --quiet, table output to a file, --ignorefile <ignore-file>
  (default .trivyignore.yaml) and --exit-code "$<NAME>" (default TRIVY_FINDINGS_EXIT_CODE).
  CycloneDX SBOM scans must be unfiltered with --exit-code 0. At least --min-gates gates and
  --min-sboms SBOM scans (default 2 each) must exist. The tracked ignore registry needs purl-exact OS
  packages, a "Not exploitable: ... Cleanup: <issue URL>" statement (URL must start with
  --cleanup-url-prefix when given) and an expired_at between tomorrow and --max-expiry-days (30).

docker-image-mirror [--root <dir>] [--mirror <host>] [--allow-registry <prefix>]... [--require-digest]
  [--allow-ref-expression <text>]...
  Prints each Docker Hub image in git-tracked workflows, composite actions and Dockerfiles (exit 1):
  run, pull and create commands, containers, services, docker:// references, buildx drivers, FROM,
  COPY --from and # syntax. Images must name a registry host; --mirror (default mirror.gcr.io) is
  the host the message tells you to use. --allow-registry (repeatable) instead requires every image,
  including FROM and COPY --from, to start with one of the prefixes; a reference that expands a
  variable passes only when its literal text before the variable starts with a prefix. --require-digest
  requires @sha256: plus 64 lowercase hex characters. Stage aliases and scratch stay exempt.
  --allow-ref-expression (repeatable) is an audited escape hatch for dynamic job outputs: a reference
  whose raw text exactly equals the value is accepted. Images the same file builds locally are exempt.

workspace-registry-check [--root <dir>] [--syncpack-config <path>] [--workspace-file <path>]
  [--path-filters <path>] [--tooling-group <name>] [--trigger-only-glob <glob>] [--runtime-prefix <prefix>]
  Reconciles git-tracked package.json manifests with the syncpack "source" globs (default
  .syncpackrc.json), the pnpm "packages" globs (pnpm-workspace.yaml) and the dorny/paths-filter groups
  (.github/ci-path-filters.yml) and prints one line per violation (exit 1). The --tooling-group group
  (default tooling) must reach every manifest and wildcard workspace glob, and its --trigger-only-glob
  (default **/package.json) does not count as registering a manifest. Each group named with
  --runtime-prefix (default runtime-) must mirror the primary group of the same name.

`
