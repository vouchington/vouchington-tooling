import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('domain skill plugins', () => {
  it('does not publish skills that moved to the upstream skills plugin', async () => {
    const [codex, claude] = await Promise.all([
      readJson('.agents/plugins/marketplace.json'),
      readJson('.claude-plugin/marketplace.json'),
    ])
    for (const marketplace of [codex, claude]) {
      expect(marketplace.plugins.map((plugin) => plugin.name)).toEqual(['vouchington-workflow'])
    }
    await expect(readdir(join(root, 'plugins'))).resolves.toEqual(['vouchington-workflow'])
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

  it('minimizes journal evidence before exporting retrospective follow-up issues', async () => {
    const distill = await readSkill('vouchington-workflow', 'retrospective-distill/SKILL.md')
    const normalized = distill.replaceAll(/\s+/g, ' ')

    expect(normalized).toMatch(/use source records only for local verification/i)
    expect(normalized).toMatch(
      /issue bodies contain only the minimum bounded facts or redacted summaries/i,
    )
    expect(normalized).toMatch(
      /never embed unredacted logs, command output, environment details, provider payloads, or transcript content/i,
    )
    expect(normalized).toMatch(/consumer wrappers cannot weaken this export boundary/i)
    expect(normalized).toMatch(
      /self-contained issues with the problem, concrete proposed work, relevant areas/i,
    )
    expect(normalized).not.toMatch(
      /(?<!not )(?<!never )\b(?:save|persist|store|retain|record|embed|include|export|publish)\s+(?:any\s+|all\s+|the\s+|only\s+)?(?:raw|unredacted)\b/i,
    )
    expect(normalized).not.toMatch(
      /(?:\b(?:may|can|should|must)\b(?!\s+(?:not|never)\b)|\b(?:is|are)\s+(?!not\s+)(?:allowed|permitted)\s+to\b)[^.!?]*\b(?:save|persist|store|retain|record|embed|include|export|publish)\b[^.!?]*\b(?:raw|unredacted)\b/i,
    )
    expect(normalized).not.toMatch(
      /\b(?:raw|unredacted)\b[^.!?]*\b(?:evidence|logs?|content|data|command output|environment details?|provider payloads?|transcript content)\b[^.!?]*(?:\b(?:may|can|should|must)\b(?!\s+(?:not|never)\b)|\b(?:is|are)\s+(?!not\s+)(?:allowed|permitted|acceptable|okay)(?:\s+to)?\b)/i,
    )
  })
})

async function readJson(path: string): Promise<{ plugins: Array<{ name: string }> }> {
  return JSON.parse(await readFile(join(root, path), 'utf8')) as {
    plugins: Array<{ name: string }>
  }
}

function readSkill(plugin: string, path: string): Promise<string> {
  return readFile(join(root, 'plugins', plugin, 'skills', path), 'utf8')
}
