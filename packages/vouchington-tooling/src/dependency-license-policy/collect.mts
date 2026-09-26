import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { withAuditSignalCleanup } from './audit-signals.mts'
import { ensurePrivateLicenseAuditStore, licenseAuditStoreDirectory } from './audit-store.mts'
import { executePnpm } from './execute-pnpm.mts'
import { parsePnpmLicenseReport } from './report.mts'
import type { PnpmCommandResult, PnpmExecutor, PnpmLicenseReport } from './types.mts'
import { preparePnpmLicenseAuditWorkspace, type PnpmLicenseAuditWorkspace } from './workspace.mts'

export interface CollectPnpmLicenseReportOptions {
  readonly ensureStore?: (directory: string) => void
  readonly execute?: PnpmExecutor
  readonly prepareWorkspace?: (
    repoRoot: string,
    lockfileSource: string,
    workspaceSource: string,
  ) => PnpmLicenseAuditWorkspace
  readonly readFile?: (path: string, encoding: 'utf8') => string
  readonly storeDir?: string
}

const DEFAULT_OPTIONS = {
  ensureStore: ensurePrivateLicenseAuditStore,
  execute: executePnpm,
  prepareWorkspace: preparePnpmLicenseAuditWorkspace,
  readFile: readFileSync,
}

function commandFailureOutput(result: { stderr: string; stdout: string }): string {
  return result.stderr.trim() || result.stdout.trim()
}

function assertCommandSucceeded(label: string, result: PnpmCommandResult): void {
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${label} exited with status ${String(result.status)}: ${commandFailureOutput(result)}`,
    )
  }
}

/** Collects licenses for every platform represented in a pnpm lockfile. */
export async function collectPnpmLicenseReport(
  repoRoot: string,
  options: CollectPnpmLicenseReportOptions = {},
): Promise<PnpmLicenseReport> {
  const { ensureStore, execute, prepareWorkspace, readFile } = { ...DEFAULT_OPTIONS, ...options }
  const auditWorkspace = prepareWorkspace(
    repoRoot,
    readFile(join(repoRoot, 'pnpm-lock.yaml'), 'utf8'),
    readFile(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'),
  )
  const storeDir = options.storeDir ?? licenseAuditStoreDirectory()
  return withAuditSignalCleanup(auditWorkspace.cleanup, async (signal) => {
    ensureStore(storeDir)
    const storeConfig = `--config.store-dir=${storeDir}`
    const commandOptions = { cwd: auditWorkspace.cwd, encoding: 'utf8' as const, signal }
    const fetchResult = await execute(
      'pnpm',
      [storeConfig, 'fetch', '--ignore-scripts'],
      commandOptions,
    )
    assertCommandSucceeded('pnpm fetch', fetchResult)
    const result = await execute(
      'pnpm',
      [storeConfig, 'licenses', 'list', '--json'],
      commandOptions,
    )
    assertCommandSucceeded('pnpm licenses list --json', result)
    try {
      return parsePnpmLicenseReport(JSON.parse(result.stdout) as unknown)
    } catch (error) {
      throw new Error(`pnpm licenses list --json produced unparseable output: ${String(error)}`, {
        cause: error,
      })
    }
  })
}
