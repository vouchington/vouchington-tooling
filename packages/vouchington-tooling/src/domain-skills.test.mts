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

  it('keeps reusable practices in canonical resources without product policy', async () => {
    const resources = await Promise.all([
      readSkill('vouchington-workflow', 'agent-workflow/references/implementation.md'),
      readSkill('vouchington-workflow', 'agent-workflow/references/review.md'),
      readSkill('vouchington-workflow', 'agent-workflow/references/evidence-sweep.md'),
      readSkill('vouchington-testing', 'vitest-test-authoring/references/mock-boundaries.md'),
      readSkill(
        'vouchington-testing',
        'backend-vitest-test-authoring/references/integration-boundaries.md',
      ),
      readSkill('vouchington-testing', 'playwright-authoring/references/browser-reliability.md'),
      readSkill('vouchington-testing', 'swift-test-authoring/references/network-test-doubles.md'),
      readSkill(
        'vouchington-database',
        'postgres-node-performance-tuning/references/performance-patterns.md',
      ),
      readSkill(
        'vouchington-database',
        'postgres-partitioning-uuid-v7/references/partition-lifecycle.md',
      ),
    ])
    expect(resources.join('\n')).toMatch(
      /accepted-decision ledger|failure paths|acceptance criterion|typed module shape|collision-safe|locator|stopLoading|read-after-write|partition key/i,
    )
    for (const resource of resources) {
      expect(resource).not.toMatch(/filaments|voucha|@data-stores|glidemq/i)
    }
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

function readSkill(plugin: string, path: string): Promise<string> {
  return readFile(join(root, 'plugins', plugin, 'skills', path), 'utf8')
}
