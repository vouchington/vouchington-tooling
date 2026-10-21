import assert from 'node:assert/strict'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CliOptions } from 'vitest/node'
import { EFFECTIVE_TIMEOUT_CASE, EFFECTIVE_TIMEOUT_SETUP } from './fixtures.mts'
import type { TimeoutProfile } from './profiles.mts'

type StartedTimeoutRun = {
  testModules: readonly { ok: () => boolean }[]
  unhandledErrors: readonly unknown[]
}

export type OpenTimeoutRun = (input: {
  root: string
  configFile: string
  cli: CliOptions
}) => Promise<{ start: () => Promise<StartedTimeoutRun>; close: () => Promise<void> }>

export type TimeoutProfileRow = {
  profile: string
  body: boolean
  setupImport: boolean
  setupCall: boolean
  rejected: boolean
}

export function effectiveTimeoutGuardHref(moduleUrl = import.meta.url): string {
  const fileName = moduleUrl.endsWith('.mjs') ? 'cap.mjs' : 'cap.mts'
  return new URL(fileName, moduleUrl).href
}

function renderConfig(input: {
  root: string
  profile: TimeoutProfile
  maxTimeoutMs: number
  pluginName: string
}): string {
  const test = {
    name: 'owned-effective-timeout',
    include: ['case.mts'],
    testTimeout: 5000,
    hookTimeout: 5000,
    globalSetup: [join(input.root, 'setup.mts')],
  }
  const plugins = input.profile.withoutGuard
    ? '[]'
    : `[effectiveTimeoutCap(${JSON.stringify({ maxTimeoutMs: input.maxTimeoutMs, name: input.pluginName })})]`
  const testConfig = input.profile.child
    ? '{ testTimeout: 0, hookTimeout: 0, projects: [{ extends: true, test }] }'
    : 'test'
  return `import { effectiveTimeoutCap } from ${JSON.stringify(effectiveTimeoutGuardHref())};
const test = { ...${JSON.stringify(test)}, hookTimeout: ${String(input.profile.configHookTimeout ?? 5000)} };
export default {
  root: ${JSON.stringify(input.root)},
  plugins: ${plugins},
  test: ${testConfig},
};
`
}

async function markerExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return false
    throw err
  }
}

export async function runTimeoutProfile(
  profile: TimeoutProfile,
  input: { scratch: string; maxTimeoutMs: number; pluginName: string; open: OpenTimeoutRun },
): Promise<TimeoutProfileRow> {
  const root = join(input.scratch, profile.name)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'case.mts'), EFFECTIVE_TIMEOUT_CASE)
  await writeFile(join(root, 'setup.mts'), EFFECTIVE_TIMEOUT_SETUP)
  const configFile = join(root, 'vitest.config.mts')
  await writeFile(
    configFile,
    renderConfig({ root, profile, maxTimeoutMs: input.maxTimeoutMs, pluginName: input.pluginName }),
  )
  let opened: Awaited<ReturnType<OpenTimeoutRun>> | undefined
  let rejected = false
  let rejection: unknown
  let result: StartedTimeoutRun | undefined
  const closeErrors: unknown[] = []
  try {
    opened = await input.open({ root, configFile, cli: profile.options ?? {} })
    result = await opened.start()
  } catch (err) {
    rejected = true
    rejection = err
  } finally {
    try {
      await opened?.close()
    } catch (err) {
      closeErrors.push(err)
    }
  }
  if (closeErrors.length) {
    const errors = [...(rejected ? [rejection] : []), ...closeErrors]
    throw new AggregateError(errors, 'Profile context close failed', { cause: errors[0] })
  }
  const row = {
    profile: profile.name,
    body: await markerExists(join(root, 'body.marker')),
    setupImport: await markerExists(join(root, 'setup-import.marker')),
    setupCall: await markerExists(join(root, 'setup-call.marker')),
    rejected,
  }
  for (const field of ['body', 'setupImport', 'setupCall'] as const) {
    assert.equal(row[field], profile.admitted, JSON.stringify(row))
  }
  assert.equal(rejected, !profile.admitted, String(rejection))
  if (profile.admitted) {
    assert.equal(result?.testModules.length, 1)
    assert.equal(result?.testModules[0]?.ok(), true)
    assert.equal(result?.unhandledErrors.length, 0)
  } else {
    assert.match(String(rejection), /effective (testTimeout|hookTimeout) must be/)
  }
  return row
}
