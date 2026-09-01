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

  it('provides Codex marketplace long descriptions for testing and database plugins', async () => {
    for (const plugin of ['vouchington-testing', 'vouchington-database']) {
      const manifest = await readRecordJson(`plugins/${plugin}/.codex-plugin/plugin.json`)
      expect(manifest.interface).toMatchObject({ longDescription: expect.any(String) })
      expect((manifest.interface as { longDescription: string }).longDescription).not.toHaveLength(
        0,
      )
    }
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

  it('keeps raw retrospective evidence out of durable records', async () => {
    const retrospective = await readSkill('vouchington-workflow', 'retrospective/SKILL.md')
    const normalized = retrospective.replaceAll(/\s+/g, ' ')

    expect(normalized).toMatch(/use raw evidence only for local verification/i)
    expect(normalized).toMatch(/save only bounded structured facts or redacted summaries/i)
    expect(normalized).toMatch(
      /never embed unredacted logs, command output, environment dumps, provider payloads, or transcript content there/i,
    )
    expect(normalized).not.toMatch(
      /(?<!not )(?<!never )\b(?:save|persist|store|retain|record|embed|include)\s+(?:any\s+|all\s+|the\s+|only\s+)?(?:raw|unredacted)\b/i,
    )
    expect(normalized).not.toMatch(
      /(?:\b(?:may|can|should|must)\b(?!\s+(?:not|never)\b)|\b(?:is|are)\s+(?!not\s+)(?:allowed|permitted)\s+to\b)[^.!?]*\b(?:save|persist|store|retain|record|embed|include)\b[^.!?]*\b(?:raw|unredacted)\b/i,
    )
    expect(normalized).not.toMatch(
      /\b(?:raw|unredacted)\b[^.!?]*\b(?:evidence|logs?|content|data|command output|environment dumps?|provider payloads?|transcript content)\b[^.!?]*(?:\b(?:may|can|should|must)\b(?!\s+(?:not|never)\b)|\b(?:is|are)\s+(?!not\s+)(?:allowed|permitted)\s+to\b)[^.!?]*\b(?:be\s+)?(?:saved|persisted|stored|retained|recorded|embedded|included)\b/i,
    )
  })
})

async function readJson(path: string): Promise<{ plugins: Array<{ name: string }> }> {
  return JSON.parse(await readFile(join(root, path), 'utf8')) as {
    plugins: Array<{ name: string }>
  }
}

async function readRecordJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, path), 'utf8')) as Record<string, unknown>
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
