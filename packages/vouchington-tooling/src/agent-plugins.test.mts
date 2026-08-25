import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const plugin = join(root, 'plugins/security-triage')
const workflowPlugin = join(root, 'plugins/vouchington-workflow')

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
}

async function readJsonArray(path: string): Promise<Array<Record<string, unknown>>> {
  return JSON.parse(await readFile(path, 'utf8')) as Array<Record<string, unknown>>
}

describe('security-triage plugin', () => {
  it('uses one canonical skill source in every host manifest', async () => {
    const [codex, claude, cursor] = await Promise.all([
      readJson(join(plugin, '.codex-plugin/plugin.json')),
      readJson(join(plugin, '.claude-plugin/plugin.json')),
      readJson(join(plugin, 'plugin.json')),
    ])

    for (const manifest of [codex, claude, cursor]) {
      expect(manifest.name).toBe('security-triage')
      expect(manifest.version).toBe('0.1.0')
    }
    expect(codex.skills).toBe('./skills/')
    expect(claude.skills).toBe('./skills/')
    expect(codex.interface).not.toHaveProperty('privacyPolicyURL')
    expect(codex.interface).not.toHaveProperty('termsOfServiceURL')
    expect(cursor.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json')
    expect(cursor).not.toHaveProperty('skills')
    await expect(access(join(plugin, '.grok-plugin/plugin.json'))).rejects.toThrow()
    await expect(access(join(root, '.grok-plugin/marketplace.json'))).rejects.toThrow()
  })

  it('publishes each marketplace and preserves the safe workflow contract', async () => {
    const [codex, claude, skill, handoff, bindings] = await Promise.all([
      readJson(join(root, '.agents/plugins/marketplace.json')),
      readJson(join(root, '.claude-plugin/marketplace.json')),
      readFile(join(plugin, 'skills/triage-codex-security/SKILL.md'), 'utf8'),
      readFile(join(plugin, 'skills/triage-codex-security/references/handoff-v1.md'), 'utf8'),
      readJsonArray(
        join(plugin, 'skills/triage-codex-security/references/two-repository-fixture.json'),
      ),
    ])

    expect(codex.name).toBe('vouchington')
    expect(codex.plugins).toHaveLength(2)
    expect((codex.plugins as Array<{ name: string }>).map(({ name }) => name)).toEqual([
      'security-triage',
      'vouchington-workflow',
    ])
    expect(codex.plugins).toContainEqual(
      expect.objectContaining({
        name: 'security-triage',
        source: { source: 'local', path: './plugins/security-triage' },
      }),
    )
    expect(claude.name).toBe('vouchington')
    expect(claude.plugins).toHaveLength(2)
    expect((claude.plugins as Array<{ name: string }>).map(({ name }) => name)).toEqual([
      'security-triage',
      'vouchington-workflow',
    ])
    expect(claude.plugins).toContainEqual(
      expect.objectContaining({ name: 'security-triage', source: './plugins/security-triage' }),
    )
    expect(skill).toContain('one repository per run')
    expect(skill).toContain('@openai/codex-security')
    expect(skill).toContain('Select `origin` when it exists')
    expect(skill).toContain('hosted finding/repository selector')
    expect(skill).toContain('at most 25')
    expect(skill).toContain('session-bound')
    expect(skill).toMatch(/stop and wait for an affirmative response\s+approving/i)
    expect(skill).toContain('exact finding IDs and actions')
    expect(skill).toContain('native authenticated browser')
    expect(skill).not.toMatch(/playwright/i)
    expect(skill).not.toMatch(/create (a |an )?github issue/i)
    expect(skill).not.toMatch(/\bgh\s+(issue|api).*\b(create|edit|issues)\b/i)
    expect(`${skill}\n${handoff}`).not.toMatch(/filaments|vouchington-(infra|tooling)/i)
    expect(handoff).toContain('codex-security-triage/v1')
    expect(handoff).toContain('canonicalRepository')
    expect(handoff).toContain('selectedRemote')
    expect(handoff).toContain('defaultBranch')
    expect(handoff).toContain('evidenceSha')
    expect(handoff).toContain('issueCandidate')
    expect(handoff).toContain('groupKey')
    expect(handoff).toContain('observed')
    expect(handoff).toContain('proposed')
    expect(handoff).toContain('resulting')
    expect(handoff).toContain('must reject')
    expect(new Set(bindings.map((binding) => binding.canonicalRepository)).size).toBe(2)
    expect(new Set(bindings.map((binding) => binding.evidenceSha)).size).toBe(2)
    expect(bindings).toSatisfy((binding) =>
      binding.every(
        (entry: Record<string, unknown>) =>
          typeof entry.canonicalRepository === 'string' &&
          typeof entry.defaultBranch === 'string' &&
          typeof entry.evidenceSha === 'string',
      ),
    )
  })
})

describe('vouchington-workflow plugin', () => {
  it('uses one canonical skill source in every supported host manifest', async () => {
    const [codex, claude, agent] = await Promise.all([
      readJson(join(workflowPlugin, '.codex-plugin/plugin.json')),
      readJson(join(workflowPlugin, '.claude-plugin/plugin.json')),
      readJson(join(workflowPlugin, 'plugin.json')),
    ])

    for (const manifest of [codex, claude, agent]) {
      expect(manifest.name).toBe('vouchington-workflow')
      expect(manifest.version).toBe('0.1.0')
    }
    expect(codex.skills).toBe('./skills/')
    expect(claude.skills).toBe('./skills/')
    expect(agent.skills).toBe('./skills/')
    expect(agent.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json')
    await expect(access(join(workflowPlugin, '.grok-plugin/plugin.json'))).rejects.toThrow()
  })

  it('is listed in both marketplaces with portable skills and installation instructions', async () => {
    const [codex, claude, readme, manifests, skills] = await Promise.all([
      readJson(join(root, '.agents/plugins/marketplace.json')),
      readJson(join(root, '.claude-plugin/marketplace.json')),
      readFile(join(root, 'README.md'), 'utf8'),
      Promise.all(
        ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', 'plugin.json'].map((path) =>
          readFile(join(workflowPlugin, path), 'utf8'),
        ),
      ),
      Promise.all(
        [
          'agent-workflow',
          'blackboard',
          'git-commit-checklist',
          'github-issue',
          'github-actions-checklist',
          'organize-github-issues',
          'package-json-checklist',
          'planning',
          'pr-description',
          'retrospective',
          'retrospective-distill',
          'review-ci-logs',
          'review-github-issue-taxonomy',
          'revisit-followups',
          'static-analysis-checklist',
        ].map((name) => readFile(join(workflowPlugin, 'skills', name, 'SKILL.md'), 'utf8')),
      ),
    ])

    expect(codex.plugins).toContainEqual(
      expect.objectContaining({
        name: 'vouchington-workflow',
        source: { source: 'local', path: './plugins/vouchington-workflow' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
      }),
    )
    expect(claude.plugins).toContainEqual(
      expect.objectContaining({
        name: 'vouchington-workflow',
        source: './plugins/vouchington-workflow',
      }),
    )
    expect(readme).toContain('vouchington-workflow@vouchington')
    expect(readme).toContain('plugins/vouchington-workflow')
    expect(readme).toContain(
      'grok plugin install vouchington/vouchington-tooling#plugins/security-triage',
    )
    expect(readme).toContain('~/.cursor/plugins/local/security-triage')
    expect(readme).toContain('~/.cursor/plugins/local/vouchington-workflow')
    await expect(access(workflowPlugin)).resolves.toBeUndefined()

    for (const artifact of [...manifests, ...skills]) {
      expect(artifact).not.toMatch(/filaments|voucha/i)
    }
    for (const skill of skills) {
      expect(skill).toContain('AGENTS.md')
      expect(skill).toContain('CLAUDE.md')
      expect(skill).not.toMatch(/\.agents\/skills|\.github\/workflows\/RUNNERS|filaments|voucha/i)
      expect(skill).not.toMatch(
        /pr-shepherd|auto harness|agent hook|coverage (?:tooling|baseline)/i,
      )
    }
    expect(skills[0]).toContain('every applicable')
    expect(skills[0]).not.toContain('assigned non-main worktree')
    expect(skills.join('\n')).toContain('consumer wrapper')
  })
})
