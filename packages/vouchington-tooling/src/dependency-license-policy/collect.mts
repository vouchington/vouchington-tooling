import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { assertCommandSucceeded } from './assert-command.mts'
import { withAuditSignalCleanup } from './audit-signals.mts'
import { ensurePrivateLicenseAuditStore } from './audit-store.mts'
import { executePnpm } from './execute-pnpm.mts'
import { parsePnpmLicenseReport } from './report.mts'
import { resolveUnknownLicenses } from './resolve-unknown-licenses.mts'
import type { PnpmExecutor, PnpmLicenseReport } from './types.mts'
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
}

const DEFAULT_OPTIONS = {
  ensureStore: ensurePrivateLicenseAuditStore,
  execute: executePnpm,
  prepareWorkspace: preparePnpmLicenseAuditWorkspace,
  readFile: readFileSync,
}

/**
 * Collects licenses for every platform represented in a pnpm lockfile.
 *
 * Only the current platform is fetched, because fetching every platform binary can exceed the disk
 * quota of a temporary directory. The workspace then switches to the all-platform configuration so
 * `pnpm licenses list` reports the full package set. pnpm reports packages missing from the store
 * as `Unknown`, and those are resolved from the registry with `pnpm view`.
 */
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
  const storeDir = join(auditWorkspace.cwd, 'store')
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
    auditWorkspace.useListingWorkspace()
    const result = await execute(
      'pnpm',
      [storeConfig, 'licenses', 'list', '--json'],
      commandOptions,
    )
    assertCommandSucceeded('pnpm licenses list --json', result)
    let report: PnpmLicenseReport
    try {
      report = parsePnpmLicenseReport(JSON.parse(result.stdout) as unknown)
    } catch (error) {
      throw new Error(`pnpm licenses list --json produced unparseable output: ${String(error)}`, {
        cause: error,
      })
    }
    return resolveUnknownLicenses(report, execute, commandOptions)
  })
}
