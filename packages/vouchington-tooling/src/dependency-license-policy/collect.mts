import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parsePnpmLicenseReport } from './report.mts'
import type { PnpmExecutor, PnpmLicenseReport } from './types.mts'
import { preparePnpmLicenseAuditWorkspace, type PnpmLicenseAuditWorkspace } from './workspace.mts'

export interface CollectPnpmLicenseReportOptions {
  readonly execute?: PnpmExecutor
  readonly prepareWorkspace?: (
    repoRoot: string,
    lockfileSource: string,
    workspaceSource: string,
  ) => PnpmLicenseAuditWorkspace
  readonly readFile?: (path: string, encoding: 'utf8') => string
}

const DEFAULT_OPTIONS = {
  execute: spawnSync as PnpmExecutor,
  prepareWorkspace: preparePnpmLicenseAuditWorkspace,
  readFile: readFileSync,
}

function commandFailureOutput(result: { stderr: string; stdout: string }): string {
  return result.stderr.trim() || result.stdout.trim()
}

function assertCommandSucceeded(label: string, result: ReturnType<PnpmExecutor>): void {
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${label} exited with status ${String(result.status)}: ${commandFailureOutput(result)}`,
    )
  }
}

/** Collects licenses for every platform represented in a pnpm lockfile. */
export function collectPnpmLicenseReport(
  repoRoot: string,
  options: CollectPnpmLicenseReportOptions = {},
): PnpmLicenseReport {
  const { execute, prepareWorkspace, readFile } = { ...DEFAULT_OPTIONS, ...options }
  const lockfilePath = join(repoRoot, 'pnpm-lock.yaml')
  const workspacePath = join(repoRoot, 'pnpm-workspace.yaml')
  const auditWorkspace = prepareWorkspace(
    repoRoot,
    readFile(lockfilePath, 'utf8'),
    readFile(workspacePath, 'utf8'),
  )
  try {
    const storeConfig = `--config.store-dir=${join(auditWorkspace.cwd, '.pnpm-store')}`
    const fetchResult = execute('pnpm', [storeConfig, 'fetch', '--ignore-scripts'], {
      cwd: auditWorkspace.cwd,
      encoding: 'utf8',
    })
    assertCommandSucceeded('pnpm fetch', fetchResult)

    const result = execute('pnpm', [storeConfig, 'licenses', 'list', '--json'], {
      cwd: auditWorkspace.cwd,
      encoding: 'utf8',
    })
    assertCommandSucceeded('pnpm licenses list --json', result)
    try {
      return parsePnpmLicenseReport(JSON.parse(result.stdout) as unknown)
    } catch (error) {
      throw new Error(`pnpm licenses list --json produced unparseable output: ${String(error)}`, {
        cause: error,
      })
    }
  } finally {
    auditWorkspace.cleanup()
  }
}
