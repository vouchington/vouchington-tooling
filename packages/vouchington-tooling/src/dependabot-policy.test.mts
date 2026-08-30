import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

type Group = {
  'applies-to': string
  patterns: string[]
}

type Update = {
  'package-ecosystem': string
  directory: string
  schedule: { interval: string }
  cooldown: { 'default-days': number; exclude?: string[] }
  'open-pull-requests-limit': number
  groups: Record<string, Group>
}

describe('Dependabot policy', () => {
  const config = parse(readFileSync(resolve(root, '.github/dependabot.yml'), 'utf8')) as {
    updates: Update[]
  }

  it('checks every ecosystem daily after the release cooldown with a bounded queue', () => {
    expect(
      config.updates.map(({ 'package-ecosystem': ecosystem, directory }) => [ecosystem, directory]),
    ).toEqual([
      ['npm', '/'],
      ['github-actions', '/'],
    ])
    for (const update of config.updates) {
      expect(update.schedule.interval).toBe('daily')
      expect(update.cooldown['default-days']).toBe(7)
      expect(update['open-pull-requests-limit']).toBe(5)
    }
  })

  it('groups only compatible package and action families', () => {
    const npm = config.updates.find((update) => update['package-ecosystem'] === 'npm')
    const actions = config.updates.find(
      (update) => update['package-ecosystem'] === 'github-actions',
    )

    expect(npm?.groups).toEqual({
      oxc: {
        'applies-to': 'version-updates',
        patterns: ['oxfmt', 'oxlint', 'oxlint-tsgolint'],
      },
      'oxc-security': {
        'applies-to': 'security-updates',
        patterns: ['oxfmt', 'oxlint', 'oxlint-tsgolint'],
      },
      vitest: {
        'applies-to': 'version-updates',
        patterns: ['vitest', '@vitest/*'],
      },
      'vitest-security': {
        'applies-to': 'security-updates',
        patterns: ['vitest', '@vitest/*'],
      },
      csv: { 'applies-to': 'version-updates', patterns: ['csv-*'] },
      'csv-security': { 'applies-to': 'security-updates', patterns: ['csv-*'] },
      picomatch: {
        'applies-to': 'version-updates',
        patterns: ['picomatch', '@types/picomatch'],
      },
    })
    expect(actions?.groups).toEqual({
      'artifact-actions': {
        'applies-to': 'version-updates',
        patterns: ['actions/download-artifact', 'actions/upload-artifact'],
      },
      'artifact-actions-security': {
        'applies-to': 'security-updates',
        patterns: ['actions/download-artifact', 'actions/upload-artifact'],
      },
    })
    for (const update of config.updates) {
      expect(Object.values(update.groups).flatMap((group) => group.patterns)).not.toContain('*')
    }
  })

  it('exempts only the verified first-party npm release', () => {
    const npm = config.updates.find((update) => update['package-ecosystem'] === 'npm')
    expect(npm?.cooldown.exclude).toEqual(['pr-shepherd'])
    expect(Object.values(npm?.groups ?? {}).flatMap((group) => group.patterns)).not.toContain(
      'pr-shepherd',
    )
  })
})
