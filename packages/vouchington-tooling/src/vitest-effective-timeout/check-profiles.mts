import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createVitest, type CliOptions } from 'vitest/node'
import {
  assertEffectiveTimeoutCap,
  DEFAULT_EFFECTIVE_TIMEOUT_MS,
  DEFAULT_EFFECTIVE_TIMEOUT_PLUGIN,
} from './cap.mts'
import { timeoutProfiles } from './profiles.mts'
import { runTimeoutProfile, type OpenTimeoutRun, type TimeoutProfileRow } from './run-profile.mts'

export type FiniteTimeoutProfileOptions = {
  maxTimeoutMs?: number
  pluginName?: string
  scratchDir?: string
  open?: OpenTimeoutRun
  removeScratch?: (path: string) => Promise<void>
}

export async function openVitestTimeoutRun(input: {
  root: string
  configFile: string
  cli: CliOptions
}): Promise<Awaited<ReturnType<OpenTimeoutRun>>> {
  const context = await createVitest({
    root: input.root,
    config: input.configFile,
    watch: false,
    run: true,
    reporters: [],
    ...input.cli,
  })
  return { start: () => context.start(), close: () => context.close() }
}

export async function checkFiniteTimeoutProfiles(
  repoRoot: string,
  options: FiniteTimeoutProfileOptions = {},
): Promise<TimeoutProfileRow[]> {
  const maxTimeoutMs = assertEffectiveTimeoutCap(
    options.maxTimeoutMs ?? DEFAULT_EFFECTIVE_TIMEOUT_MS,
  )
  const pluginName = options.pluginName ?? DEFAULT_EFFECTIVE_TIMEOUT_PLUGIN
  const open = options.open ?? openVitestTimeoutRun
  const removeScratch =
    options.removeScratch ?? ((path: string) => rm(path, { recursive: true, force: true }))
  const scratchParent = options.scratchDir ?? join(repoRoot, '.cache')
  await mkdir(scratchParent, { recursive: true })
  const scratch = await mkdtemp(join(scratchParent, 'effective-timeout-cap-'))
  const rows: TimeoutProfileRow[] = []
  let failed = false
  let primary: unknown
  const cleanup: unknown[] = []
  try {
    for (const profile of timeoutProfiles(maxTimeoutMs)) {
      rows.push(await runTimeoutProfile(profile, { scratch, maxTimeoutMs, pluginName, open }))
    }
  } catch (err) {
    failed = true
    primary = err
  } finally {
    try {
      await removeScratch(scratch)
    } catch (err) {
      cleanup.push(err)
    }
  }
  if (failed || cleanup.length) {
    const errors = [...(failed ? [primary] : []), ...cleanup]
    throw new AggregateError(errors, 'Finite timeout admission failed', { cause: errors[0] })
  }
  return rows
}
