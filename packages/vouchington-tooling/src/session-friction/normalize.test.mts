import { describe, expect, it } from 'vitest'

import { normalizeCommandPrefix } from './index.mts'

describe('normalizeCommandPrefix', () => {
  it('normalizes compound commands, runners, assignments, and git options', () => {
    expect(normalizeCommandPrefix('cd /private/path && CI=1 pnpm exec vitest run')).toBe(
      'pnpm exec vitest',
    )
    expect(normalizeCommandPrefix('git -C /private/path push origin main')).toBe('git push')
    expect(normalizeCommandPrefix('/usr/bin/git -C /private/path push')).toBe('/usr/bin/git push')
    expect(normalizeCommandPrefix('git --no-pager status')).toBe('git status')
    expect(normalizeCommandPrefix('git --work-tree=/private/path status')).toBe('git status')
    expect(normalizeCommandPrefix('git --option1=value status')).toBe('git status')
    expect(normalizeCommandPrefix('git -- status')).toBe('git status')
    expect(normalizeCommandPrefix('git -C')).toBe('git [REDACTED]')
    expect(normalizeCommandPrefix('rtk git status', ['rtk'])).toBe('rtk git status')
    expect(normalizeCommandPrefix(`${'rtk '.repeat(5_000)}git status`, ['rtk'])).toBe(
      'rtk git status',
    )
    expect(normalizeCommandPrefix('rtk rtk', ['rtk'])).toBe('rtk')
    expect(normalizeCommandPrefix("echo 'git push' && gh pr view 1")).toBe('echo git push')
    expect(normalizeCommandPrefix('cd /private/path')).toBe('cd /private/path')
    expect(normalizeCommandPrefix('npm run build')).toBe('npm run build')
    expect(normalizeCommandPrefix('npm exec vitest')).toBe('npm exec vitest')
  })

  it('redacts overlong tokens in the report-safe prefix', () => {
    expect(normalizeCommandPrefix(`secret=${'x'.repeat(80)}`)).toBe('[REDACTED]')
    expect(normalizeCommandPrefix(`${'x'.repeat(80)} run`)).toBe('[REDACTED] run')
    const wrapper = 'w'.repeat(80)
    expect(normalizeCommandPrefix(`${wrapper} git status`, [wrapper])).toBe('[REDACTED] git status')
    expect(normalizeCommandPrefix('curl https://user:pass@example.test')).toBe('curl [REDACTED]')
    expect(normalizeCommandPrefix('client --token=secret')).toBe('client [REDACTED]')
    expect(normalizeCommandPrefix('npm run build')).toBe('npm run build')
    expect(normalizeCommandPrefix(`node ${'x'.repeat(100_001)}`)).toBe(
      '[REDACTED: command too long]',
    )
  })

  it('handles escaped quotes and strips env assignments', () => {
    expect(normalizeCommandPrefix('echo "hello \\"world\\"" && pnpm test')).toBe(
      'echo hello "world"',
    )
    expect(normalizeCommandPrefix('env API_TOKEN=secret curl https://example.test')).toBe(
      'curl https://example.test',
    )
    expect(normalizeCommandPrefix('env -i --ignore-environment API_TOKEN=secret curl')).toBe('curl')
    expect(normalizeCommandPrefix('/usr/bin/env API_TOKEN=secret curl')).toBe('curl')
    expect(normalizeCommandPrefix('rtk env API_TOKEN=secret curl', ['rtk'])).toBe('rtk curl')
    expect(normalizeCommandPrefix('env --chdir /tmp API_TOKEN=secret curl')).toBe('curl')
    expect(normalizeCommandPrefix('env --chdir=/tmp API_TOKEN=secret curl')).toBe('curl')
    expect(normalizeCommandPrefix('env --chd /tmp API_TOKEN=secret curl')).toBe('curl')
    expect(normalizeCommandPrefix("env --spl 'API_TOKEN=secret curl'")).toBe('[REDACTED]')
    expect(normalizeCommandPrefix('env --unknown secret curl')).toBe('[REDACTED]')
    expect(normalizeCommandPrefix('env -- API_TOKEN=secret curl')).toBe('curl')
    expect(normalizeCommandPrefix('env API_TOKEN=secret')).toBe('[REDACTED]')
    expect(normalizeCommandPrefix('env')).toBe('')
    expect(normalizeCommandPrefix('env -i')).toBe('')
    expect(normalizeCommandPrefix('echo \\')).toBe('echo \\')
    expect(normalizeCommandPrefix("echo '\\' && git push")).toBe('echo \\')
    expect(normalizeCommandPrefix('echo > /private/path')).toBe('echo')
  })
})
