import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

type Group = {
  'applies-to': string
  patterns: string[]
  'update-types': string[]
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

  it('groups non-breaking and security updates without grouping majors', () => {
    for (const update of config.updates) {
      const groups = Object.values(update.groups)
      expect(groups).toContainEqual(
        expect.objectContaining({
          'applies-to': 'version-updates',
          patterns: ['*'],
          'update-types': ['minor', 'patch'],
        }),
      )
      expect(groups).toContainEqual(
        expect.objectContaining({
          'applies-to': 'security-updates',
          patterns: ['*'],
          'update-types': ['minor', 'patch'],
        }),
      )
      expect(groups.flatMap((group) => group['update-types'])).not.toContain('major')
    }
  })

  it('exempts only the verified first-party npm release', () => {
    const npm = config.updates.find((update) => update['package-ecosystem'] === 'npm')
    expect(npm?.cooldown.exclude).toEqual(['pr-shepherd'])
    expect(npm?.groups['first-party-minor-and-patch']).toEqual({
      'applies-to': 'version-updates',
      patterns: ['pr-shepherd'],
      'update-types': ['minor', 'patch'],
    })
  })
})
