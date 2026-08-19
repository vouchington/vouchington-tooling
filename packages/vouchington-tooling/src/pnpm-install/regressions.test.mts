import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { findWorkspaceLinkMismatches, parseInstallOptions } from './support.mts'
import { installCalls, makeFixture, runInstaller } from './pnpm-install-fixture.test-helpers.mts'

const execFileAsync = promisify(execFile)
const installer = join(process.cwd(), 'packages/vouchington-tooling/src/cli/index.mts')

async function writeJson(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value)}\n`)
}

async function makeLinkFixture(spec: string, target: 'dependency' | 'registry' | 'consumer') {
  const root = await mkdtemp(join(tmpdir(), 'pnpm-install-links-'))
  const consumer = join(root, 'consumer')
  const dependency = join(root, 'dependency')
  const registry = join(root, 'registry')
  const link = join(consumer, 'node_modules', '@fixture', 'dependency')
  await Promise.all([
    writeJson(join(consumer, 'package.json'), {
      name: '@fixture/consumer',
      dependencies: { '@fixture/dependency': spec },
    }),
    writeJson(join(dependency, 'package.json'), {
      name: '@fixture/dependency',
      version: '1.0.0',
    }),
    writeJson(join(registry, 'package.json'), {
      name: '@fixture/dependency',
      version: '999.0.0',
    }),
    mkdir(dirname(link), { recursive: true }),
  ])
  await symlink({ consumer, dependency, registry }[target], link, 'dir')
  const workspaces = [
    { name: '@fixture/consumer', path: consumer },
    { name: '@fixture/dependency', path: dependency },
  ]
  return {
    root,
    runCapture: async () => ({ code: 0, output: JSON.stringify(workspaces) }),
  }
}

describe('pnpm install regression boundaries', () => {
  it('ignores same-named registry dependencies without workspace protocol', async () => {
    const fixture = await makeLinkFixture('999.0.0', 'registry')
    try {
      await expect(findWorkspaceLinkMismatches(fixture.runCapture)).resolves.toEqual([])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('reports misdirected and unknown workspace protocol dependencies', async () => {
    const misdirected = await makeLinkFixture('workspace:^', 'consumer')
    try {
      await expect(findWorkspaceLinkMismatches(misdirected.runCapture)).resolves.toEqual([
        expect.objectContaining({
          actual: expect.stringContaining('/consumer'),
          dependency: '@fixture/dependency',
        }),
      ])
      await writeJson(join(misdirected.root, 'consumer', 'package.json'), {
        name: '@fixture/consumer',
        dependencies: { '@fixture/missing': 'workspace:^' },
      })
      await expect(findWorkspaceLinkMismatches(misdirected.runCapture)).resolves.toEqual([
        expect.objectContaining({
          actual: 'unknown workspace',
          dependency: '@fixture/missing',
        }),
      ])
    } finally {
      await rm(misdirected.root, { force: true, recursive: true })
    }
  })

  it('bounds timeout and retry inputs', () => {
    const required = ['--runner-lifecycle', 'persistent', '--install-scripts', 'true']
    expect(() => parseInstallOptions([...required, '--command-timeout-seconds', '3601'])).toThrow(
      '--command-timeout-seconds must not exceed 3600',
    )
    expect(() =>
      parseInstallOptions([...required, '--max-attempts', '999999999999999999']),
    ).toThrow('--max-attempts must not exceed 10')
  })

  it('does not let an unwritable summary mask the install outcome', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pnpm-install-summary-'))
    const bin = join(root, 'bin')
    await mkdir(bin)
    await writeJson(join(root, 'package.json'), { name: 'fixture', private: true })
    await writeFile(
      join(bin, 'pnpm'),
      '#!/usr/bin/env bash\nif [ "${1:-}" = m ]; then printf \'%s\\n\' "$PNPM_WORKSPACES_JSON"; fi\n',
    )
    await execFileAsync('chmod', ['+x', join(bin, 'pnpm')])
    try {
      await expect(
        execFileAsync(
          'node',
          [
            '--experimental-strip-types',
            installer,
            'pnpm-install',
            '--runner-lifecycle',
            'persistent',
            '--install-scripts',
            'true',
            '--max-attempts',
            '1',
            '--command-timeout-seconds',
            '0',
          ],
          {
            cwd: root,
            env: {
              ...process.env,
              GITHUB_STEP_SUMMARY: root,
              PATH: `${bin}:${process.env.PATH ?? ''}`,
              PNPM_WORKSPACES_JSON: JSON.stringify([{ name: 'fixture', path: root }]),
            },
          },
        ),
      ).resolves.toMatchObject({
        stderr: expect.stringContaining('unable to append pnpm install summary'),
      })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it(
    'fails fast on a release-age violation on a non-first attempt',
    { timeout: 15_000 },
    async () => {
      const fixture = await makeFixture()
      try {
        fixture.env.PNPM_FAIL_CALL = '1'
        fixture.env.PNPM_FAIL_RELEASE_AGE_CALL = '2'
        await expect(runInstaller(fixture, { maxAttempts: 3 })).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining('eligible at'),
        })
        await expect(installCalls(fixture)).resolves.toHaveLength(2)
      } finally {
        await rm(fixture.root, { force: true, recursive: true })
      }
    },
  )

  it('fails fast on a release-age violation without retrying or masking the eligibility message', async () => {
    const fixture = await makeFixture()
    try {
      fixture.env.PNPM_FAIL_CALL = '1'
      fixture.env.PNPM_FAIL_RELEASE_AGE = '1'
      await expect(runInstaller(fixture, { maxAttempts: 3 })).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          'undici@8.10.0 published 2026-08-03T15:06:33.000Z, eligible at 2026-08-05T15:06:33.000Z',
        ),
      })
      await expect(installCalls(fixture)).resolves.toHaveLength(1)
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it(
    'still retries an ordinary transient install failure up to max-attempts',
    { timeout: 15_000 },
    async () => {
      const fixture = await makeFixture()
      try {
        fixture.env.PNPM_FAIL_CALL = '1'
        await expect(runInstaller(fixture, { maxAttempts: 2 })).resolves.toBeDefined()
        await expect(installCalls(fixture)).resolves.toHaveLength(2)
      } finally {
        await rm(fixture.root, { force: true, recursive: true })
      }
    },
  )

  it('still terminates and fails a hung attempt after the always-piped stdio change', async () => {
    const fixture = await makeFixture()
    try {
      fixture.env.PNPM_SLEEP_SECONDS = '30'
      await expect(
        runInstaller(fixture, { commandTimeoutSeconds: 1, maxAttempts: 1 }),
      ).rejects.toMatchObject({ code: 1 })
      await expect(installCalls(fixture)).resolves.toHaveLength(1)
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })
})
