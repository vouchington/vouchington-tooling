import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('domain skill plugins', () => {
  it('publishes portable testing and database skills in every marketplace', async () => {
    const [codex, claude] = await Promise.all([
      readJson('.agents/plugins/marketplace.json'),
      readJson('.claude-plugin/marketplace.json'),
    ])
    for (const name of ['vouchington-testing', 'vouchington-database']) {
      expect(codex.plugins).toContainEqual(expect.objectContaining({ name }))
      expect(claude.plugins).toContainEqual(expect.objectContaining({ name }))
    }
    await expect(skillNames('vouchington-testing')).resolves.toEqual([
      'backend-vitest-test-authoring',
      'dotnet-test-authoring',
      'nextjs-vitest-test-authoring',
      'playwright-authoring',
      'storybook-authoring',
      'swift-test-authoring',
      'test-authoring',
      'vitest-test-authoring',
    ])
    await expect(skillNames('vouchington-database')).resolves.toEqual([
      'postgres-node-performance-tuning',
      'postgres-partitioning-uuid-v7',
    ])
  })
})

async function readJson(path: string): Promise<{ plugins: Array<{ name: string }> }> {
  return JSON.parse(await readFile(join(root, path), 'utf8')) as {
    plugins: Array<{ name: string }>
  }
}

async function skillNames(plugin: string): Promise<string[]> {
  const entries = await readdir(join(root, 'plugins', plugin, 'skills'), { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}
