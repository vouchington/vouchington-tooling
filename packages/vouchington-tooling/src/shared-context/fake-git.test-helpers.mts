import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FAKE_GIT_INSIDE = 'FAKE_GIT_INSIDE'
const FAKE_GIT_ROOT = 'FAKE_GIT_ROOT'
const FAKE_GIT_FILES = 'FAKE_GIT_FILES'
const FAKE_GIT_LS_FILES_EXIT_CODE = 'FAKE_GIT_LS_FILES_EXIT_CODE'
const FAKE_GIT_LS_FILES_STDERR = 'FAKE_GIT_LS_FILES_STDERR'

export type FakeGitOptions = {
  binDir: string
  isInsideWorkTree?: boolean
  lsFilesExitCode?: number
  lsFilesStderr?: string
  pathPrefix?: string
  repoRoot?: string
  trackedFiles?: readonly string[]
}

export function installFakeGit({
  binDir,
  isInsideWorkTree = true,
  lsFilesExitCode = 0,
  lsFilesStderr = '',
  pathPrefix = process.env.PATH,
  repoRoot,
  trackedFiles = [],
}: FakeGitOptions): void {
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, 'git'), fakeGitScript())
  chmodSync(join(binDir, 'git'), 0o755)

  process.env.PATH = [binDir, pathPrefix].filter(Boolean).join(':')
  process.env[FAKE_GIT_INSIDE] = String(isInsideWorkTree)
  process.env[FAKE_GIT_LS_FILES_EXIT_CODE] = String(lsFilesExitCode)
  process.env[FAKE_GIT_LS_FILES_STDERR] = lsFilesStderr
  if (repoRoot !== undefined) process.env[FAKE_GIT_ROOT] = repoRoot
  process.env[FAKE_GIT_FILES] = [...trackedFiles].toSorted().join('\n')
}

export function clearFakeGitEnv(): void {
  process.env.FAKE_GIT_INSIDE = 'false'
  process.env.FAKE_GIT_ROOT = ''
  process.env.FAKE_GIT_FILES = ''
  process.env.FAKE_GIT_LS_FILES_EXIT_CODE = ''
  process.env.FAKE_GIT_LS_FILES_STDERR = ''
}

function fakeGitScript(): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [ "${1:-}" = "-C" ]; then',
    '  shift 2',
    'fi',
    'case "${1:-} ${2:-}" in',
    '  "rev-parse --is-inside-work-tree")',
    '    [ "${FAKE_GIT_INSIDE:-false}" = "true" ]',
    '    ;;',
    '  "rev-parse --show-toplevel")',
    '    printf \'%s\\n\' "${FAKE_GIT_ROOT:?}"',
    '    ;;',
    '  "ls-files -z"|"ls-files " )',
    '    if [ "${FAKE_GIT_LS_FILES_EXIT_CODE:-0}" -ne 0 ]; then',
    '      printf \'%s\' "${FAKE_GIT_LS_FILES_STDERR:-}" >&2',
    '      exit "${FAKE_GIT_LS_FILES_EXIT_CODE}"',
    '    fi',
    '    printf \'%s\\n\' "${FAKE_GIT_FILES:-}" | while IFS= read -r file; do',
    '      if [ -n "$file" ]; then',
    String.raw`        printf '%s\0' "$file"`,
    '      fi',
    '    done',
    '    ;;',
    '  *)',
    String.raw`    printf 'unexpected fake git invocation: %s\n' "$*" >&2`,
    '    exit 2',
    '    ;;',
    'esac',
    '',
  ].join('\n')
}
