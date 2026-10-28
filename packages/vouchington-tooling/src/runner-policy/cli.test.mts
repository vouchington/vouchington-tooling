import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runRunnerPolicyCli } from './cli.mts'
import { discoverWorkflows, loadRunnerPolicyConfig } from './discover.mts'

let dir: string
let root: string
let configFile: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runner-policy-'))
  root = join(dir, 'workflows')
  configFile = join(dir, 'policy.json')
  await mkdir(root)
  await writeFile(configFile, JSON.stringify({ allowedLabels: ['label-a'] }))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const capture = () => {
  const logs: string[] = []
  const errors: string[] = []
  return {
    logs,
    errors,
    output: { log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) },
  }
}

const workflowText = (label: string) => `on: push\njobs:\n  job:\n    runs-on: ${label}\n`
const run = (args: string[] = []) => {
  const sink = capture()
  return runRunnerPolicyCli(['--config', configFile, '--root', root, ...args], {
    output: sink.output,
  }).then((code) => ({ code, ...sink }))
}

describe('discoverWorkflows', () => {
  it('reads sorted yml and yaml files only', async () => {
    await writeFile(join(root, 'b.yaml'), 'b')
    await writeFile(join(root, 'a.yml'), 'a')
    await writeFile(join(root, 'notes.md'), 'n')
    await mkdir(join(root, 'dir.yml'))
    expect(await discoverWorkflows(root)).toEqual([
      { path: 'a.yml', text: 'a' },
      { path: 'b.yaml', text: 'b' },
    ])
  })

  it('throws for a missing root and for a root that is a file', async () => {
    await expect(discoverWorkflows(join(dir, 'absent'))).rejects.toThrow('does not exist')
    await expect(discoverWorkflows(configFile)).rejects.toThrow('not a directory')
  })
})

describe('loadRunnerPolicyConfig', () => {
  it('throws for unreadable or non-JSON files', async () => {
    await expect(loadRunnerPolicyConfig(join(dir, 'absent.json'))).rejects.toThrow(
      'cannot read runner-policy config',
    )
    await writeFile(configFile, '{oops')
    await expect(loadRunnerPolicyConfig(configFile)).rejects.toThrow('cannot read')
  })

  it('validates the config', async () => {
    await writeFile(configFile, '{}')
    await expect(loadRunnerPolicyConfig(configFile)).rejects.toThrow('invalid runner-policy config')
  })
})

describe('runRunnerPolicyCli', () => {
  it('exits 0 when workflows conform', async () => {
    await writeFile(join(root, 'ok.yml'), workflowText('label-a'))
    const result = await run()
    expect(result.code).toBe(0)
    expect(result.logs).toEqual(['runner-policy: 1 workflow file(s) conform'])
  })

  it('exits 1 and lists violations', async () => {
    await writeFile(join(root, 'bad.yml'), workflowText('nope'))
    const result = await run()
    expect(result.code).toBe(1)
    expect(result.errors[0]).toContain('1 violation(s)')
    expect(result.errors[0]).toContain('bad.yml#job: runs-on label "nope" is not allowed')
  })

  it('fails closed on an empty root, missing root and bad config', async () => {
    const empty = await run()
    expect(empty.code).toBe(1)
    expect(empty.errors[0]).toContain('no workflow files were discovered')
    const missing = await run(['--root', join(dir, 'absent')])
    expect(missing.code).toBe(1)
    expect(missing.errors[0]).toContain('runner-policy failed:')
    const badConfig = await run(['--config', join(dir, 'absent.json')])
    expect(badConfig.code).toBe(1)
  })

  it('exits 2 on usage errors', async () => {
    const unknown = await run(['--bogus'])
    expect(unknown.code).toBe(2)
    expect(unknown.errors[0]).toContain('Usage: vouchington runner-policy')
    const blank = await run(['--root', ' '])
    expect(blank.code).toBe(2)
    expect(blank.errors[0]).toContain('--root requires a non-empty value')
  })

  it('defaults to console output', async () => {
    const code = await runRunnerPolicyCli(['--bogus'])
    expect(code).toBe(2)
  })
})
