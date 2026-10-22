import type { ScriptCommand } from './parse.mts'

export const SCRIPT_PATHS: Record<ScriptCommand, { command: string; path: string }> = {
  'gha-output': { command: 'bash', path: 'scripts/gha/write-github-multiline-output.sh' },
  'gha-needs-results': { command: 'bash', path: 'scripts/gha/check-needs-results.sh' },
  'download-with-diagnostics': {
    command: 'bash',
    path: 'scripts/gha/download-with-diagnostics.sh',
  },
  'download-optional-run-artifacts': {
    command: 'bash',
    path: 'scripts/gha/download-optional-run-artifacts.sh',
  },
  'host-pressure-diagnostics': {
    command: 'bash',
    path: 'scripts/gha/host-pressure-diagnostics.sh',
  },
  'allocate-browser-safe-ports': {
    command: 'python3',
    path: 'scripts/allocate-browser-safe-ports.py',
  },
  'diagnose-port-collision': {
    command: 'bash',
    path: 'scripts/gha/diagnose-port-collision.sh',
  },
  'prepare-trivy-db': { command: 'bash', path: 'scripts/gha/prepare-trivy-db.sh' },
  'check-cache-size': { command: 'bash', path: 'scripts/gha/check-cache-size.sh' },
  'make-shard-matrix': { command: 'bash', path: 'scripts/gha/make-shard-matrix.sh' },
  'load-runner-env': { command: 'bash', path: 'scripts/gha/load-runner-env.sh' },
  'clean-workspace': { command: 'bash', path: 'scripts/gha/clean-workspace.sh' },
  'install-github-release': { command: 'bash', path: 'scripts/gha/install-github-release.sh' },
  'run-with-timeout': { command: 'bash', path: 'scripts/gha/run-with-timeout.sh' },
  'lint-links': { command: 'bash', path: 'scripts/gha/lint-links.sh' },
  'materialize-pr-context': { command: 'bash', path: 'scripts/gha/materialize-pr-context.sh' },
  'wait-for-apt-locks': { command: 'bash', path: 'scripts/gha/wait-for-apt-locks.sh' },
  'install-playwright-chromium-arm64': {
    command: 'bash',
    path: 'scripts/gha/install-playwright-chromium-arm64.sh',
  },
  'ghcr-package-retention': { command: 'bash', path: 'scripts/gha/ghcr-package-retention.sh' },
  'harness-admission-lane': {
    command: 'bash',
    path: 'scripts/gha/harness-admission-lane.sh',
  },
  'harness-assert-gates': { command: 'bash', path: 'scripts/gha/harness-assert-gates.sh' },
  'gha-collaborator-trust': {
    command: 'bash',
    path: 'scripts/gha/gha-collaborator-trust.sh',
  },
}
