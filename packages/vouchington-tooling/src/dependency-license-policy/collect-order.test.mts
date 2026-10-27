import { describe, expect, it } from 'vitest'

import { collectPnpmLicenseReport } from './collect.mts'
import type { PnpmExecutor } from './types.mts'

describe('pnpm license collection order', () => {
  it('fetches, switches to the listing workspace, lists, then views Unknown licenses', async () => {
    const steps: string[] = []
    const execute: PnpmExecutor = (_command, args) => {
      const verb = args.find((arg) => !arg.startsWith('--')) ?? ''
      steps.push(verb === 'view' ? `view ${args[1] ?? ''}` : verb)
      const stdout =
        verb === 'licenses'
          ? JSON.stringify({ Unknown: [{ name: '@esbuild/aix-ppc64', versions: ['0.25.0'] }] })
          : '"MIT"'
      return { status: 0, stderr: '', stdout }
    }
    const report = await collectPnpmLicenseReport('/repo', {
      ensureStore: () => undefined,
      execute,
      prepareWorkspace: () => ({
        cwd: '/audit',
        cleanup: () => undefined,
        useListingWorkspace: () => {
          steps.push('switch')
        },
      }),
      readFile: () => 'packages: {}\n',
    })
    expect(steps).toEqual(['fetch', 'switch', 'licenses', 'view @esbuild/aix-ppc64@0.25.0'])
    expect(report).toEqual({ MIT: [{ name: '@esbuild/aix-ppc64', versions: ['0.25.0'] }] })
  })
})
