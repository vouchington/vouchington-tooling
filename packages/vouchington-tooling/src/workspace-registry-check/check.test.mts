import { describe, expect, it } from 'vitest'

import { checkRegistries, type RegistryNames } from './check.mts'
import type { RegistryFiles } from './load.mts'

const names: RegistryNames = {
  syncpackConfig: '.syncpackrc.json',
  workspaceFile: 'pnpm-workspace.yaml',
  toolingGroup: 'tooling',
  triggerOnlyGlob: '**/package.json',
  runtimePrefix: 'runtime-',
}

const tracked = ['package.json', 'packages/a/package.json', 'README.md']

function files(overrides: Partial<RegistryFiles> = {}): RegistryFiles {
  return {
    syncpackSource: ['package.json', 'packages/*/package.json'],
    workspacePackages: ['packages/*'],
    pathFilters: {
      tooling: ['**/package.json', 'package.json', 'packages/*/package.json'],
      app: ['src/**', 'packages/a/**'],
      'runtime-app': ['{src/**,packages/a/**}', '!**/*.test.ts'],
    },
    ...overrides,
  }
}

function check(overrides: Partial<RegistryFiles> = {}, custom: Partial<RegistryNames> = {}) {
  return checkRegistries(tracked, files(overrides), { ...names, ...custom })
}

describe('checkRegistries', () => {
  it('accepts registries that cover every tracked manifest', () => {
    expect(check()).toEqual([])
  })

  it('reports an empty or incomplete syncpack source', () => {
    expect(check({ syncpackSource: [] })).toEqual([
      '.syncpackrc.json source must not be empty',
      'tracked package manifests missing from .syncpackrc.json source: package.json, packages/a/package.json',
    ])
    expect(
      check({ syncpackSource: ['package.json', 'packages/*/package.json', 'x/*/package.json'] }),
    ).toEqual(['unmatched wildcard .syncpackrc.json source entries: x/*/package.json'])
    expect(check({ syncpackSource: ['package.json', 'packages/{a,b}/package.json'] })).toEqual([
      'stale fixed .syncpackrc.json source entries: packages/b/package.json',
    ])
  })

  it('reports CI path-filter manifests that are missing, stale or unmatched', () => {
    const toolingOnlyTrigger = { tooling: ['**/package.json'] }
    expect(check({ pathFilters: toolingOnlyTrigger })).toEqual([
      'tracked package manifests missing from a real CI path-filter group: package.json, packages/a/package.json',
    ])
    const tooling = ['package.json', 'packages/*/package.json']
    expect(
      check({ pathFilters: { tooling: [...tooling, 'old/package.json', 'gone/*/package.json'] } }),
    ).toEqual([
      'stale fixed CI path-filter manifest entries: old/package.json',
      'unmatched wildcard CI path-filter manifest entries: gone/*/package.json',
    ])
    expect(check({ pathFilters: { tooling: [...tooling, 'docs/**', 'docs/readme.md'] } })).toEqual(
      [],
    )
  })

  it('reports pnpm workspace globs that are unmatched, negated or missing', () => {
    expect(check({ workspacePackages: ['packages/*', 'apps/*'] })).toEqual([
      'unmatched pnpm-workspace.yaml package globs: apps/*',
    ])
    expect(check({ workspacePackages: ['packages/*', '!packages/b'] })).toEqual([
      'negated pnpm-workspace.yaml package globs need complete-set semantics: !packages/b',
    ])
    expect(check({ workspacePackages: [] })).toEqual([
      'non-root tracked package manifests missing from pnpm-workspace.yaml: packages/a/package.json',
    ])
  })

  it('reports runtime groups without a primary group or with different globs', () => {
    const base = files().pathFilters
    expect(check({ pathFilters: { ...base, 'runtime-lib': ['lib/**'] } })).toEqual([
      'runtime-lib has no primary CI path-filter group',
      'runtime-lib positive path filters differ from its primary group',
    ])
    expect(check({ pathFilters: { ...base, 'runtime-app': ['src/**'] } })).toEqual([
      'runtime-app positive path filters differ from its primary group',
    ])
  })

  it('reports wildcard globs the tooling group cannot reach', () => {
    const pathFilters = { tooling: ['package.json', 'packages/a/package.json'] }
    expect(check({ pathFilters })).toEqual([
      'wildcard pnpm workspace globs unreachable from tooling CI: packages/*',
    ])
  })

  it('treats a missing tooling group as empty', () => {
    expect(check({ pathFilters: {} })).toEqual([
      'tracked package manifests missing from a real CI path-filter group: package.json, packages/a/package.json',
      'wildcard pnpm workspace globs unreachable from tooling CI: packages/*',
      'tracked package manifests unreachable from tooling CI: package.json, packages/a/package.json',
    ])
  })

  it('names the configured files, groups and prefix in messages', () => {
    const custom = {
      syncpackConfig: 'sync.json',
      workspaceFile: 'ws.yml',
      toolingGroup: 'ci',
      triggerOnlyGlob: '*',
      runtimePrefix: 'rt:',
    }
    const pathFilters = { ci: ['package.json'], 'rt:x': ['y'] }
    const result = check({ syncpackSource: [], workspacePackages: ['!a'], pathFilters }, custom)
    expect(result).toContain('sync.json source must not be empty')
    expect(result).toContain('negated ws.yml package globs need complete-set semantics: !a')
    expect(result).toContain('rt:x has no primary CI path-filter group')
    expect(result).toContain(
      'tracked package manifests unreachable from ci CI: packages/a/package.json',
    )
  })
})
