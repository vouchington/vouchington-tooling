import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const workflowPlugin = join(root, 'plugins/vouchington-workflow')

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
}

describe('vouchington-workflow plugin', () => {
  const readSkill = (name: string): Promise<string> =>
    readFile(join(workflowPlugin, 'skills', name, 'SKILL.md'), 'utf8')

  it('uses one canonical skill source in every supported host manifest', async () => {
    const [codex, claude, agent] = await Promise.all([
      readJson(join(workflowPlugin, '.codex-plugin/plugin.json')),
      readJson(join(workflowPlugin, '.claude-plugin/plugin.json')),
      readJson(join(workflowPlugin, 'plugin.json')),
    ])

    expect(codex.version).toMatch(/^\d+\.\d+\.\d+$/)
    for (const manifest of [codex, claude, agent]) {
      expect(manifest).toMatchObject({ name: 'vouchington-workflow', version: codex.version })
    }
    expect(codex.skills).toBe('./skills/')
    expect(claude.skills).toBe('./skills/')
    expect(agent.skills).toBe('./skills/')
    expect(agent.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json')
    await expect(access(join(workflowPlugin, '.grok-plugin/plugin.json'))).rejects.toThrow()
  })

  it('is listed in both marketplaces with portable skills and installation instructions', async () => {
    const skillNames = (await readdir(join(workflowPlugin, 'skills'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
    expect(skillNames).toEqual([
      'blackboard',
      'organize-github-issues',
      'pr-description',
      'retrospective',
      'retrospective-distill',
      'review-github-issue-taxonomy',
      'triage-loop',
      'triage-prs',
      'triage-sweep',
    ])
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
        skillNames.map((name) =>
          readFile(join(workflowPlugin, 'skills', name, 'SKILL.md'), 'utf8'),
        ),
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
      'grok plugin install vouchington/vouchington-tooling#plugins/vouchington-workflow',
    )
    expect(readme).not.toMatch(/security-triage|vouchington-testing|vouchington-database/)
    expect(readme).toContain('~/.cursor/plugins/local/vouchington-workflow')
    await expect(access(workflowPlugin)).resolves.toBeUndefined()

    for (const artifact of [...manifests, ...skills]) {
      expect(artifact).not.toMatch(/filaments|voucha/i)
    }
    for (const skill of skills) {
      expect(skill).toContain('AGENTS.md')
      expect(skill).not.toContain('CLAUDE.md')
      expect(skill.replaceAll(/(?:AGENTS|CLAUDE)\.md/giu, '')).not.toMatch(/\b(?:claude|codex)\b/i)
      expect(skill).not.toMatch(/\.github\/workflows\/RUNNERS|filaments|voucha/i)
      expect(skill).not.toMatch(
        /agent hook|coverage (?:tooling|baseline)|HARNESS_|activation (?:gate|disabled)|dispatch workflow|shepherd trigger|ready-and-shepherd/i,
      )
      expect(skill).toMatch(/consumer\s+wrapper/i)
    }
    const loop = skills[skillNames.indexOf('triage-loop')]
    for (const term of ['hook-harness', '/shepherd', '/plan', '/fix']) {
      expect(loop).toContain(term)
    }
    const triage = ['triage-loop', 'triage-sweep', 'triage-prs'].map(
      (name) => skills[skillNames.indexOf(name)]!,
    )
    const triageResources = await Promise.all(
      [
        'triage-loop/references/config.md',
        'triage-loop/scripts/state.py',
        'triage-loop/scripts/wait.py',
        'triage-sweep/references/dependency-update-check.md',
      ].map((path) => readFile(join(workflowPlugin, 'skills', path), 'utf8')),
    )
    for (const text of triage) {
      expect(text).toContain('.triage-loop.json')
      expect(text).not.toContain('.agents/skills/triage-loop')
    }
    for (const text of [...triage, ...triageResources]) {
      expect(text).not.toMatch(/jonathanong|vouchington\/|~\/\.local|opentofu|herdr/i)
    }
    const retrospective = skills[skillNames.indexOf('retrospective')]
    for (const term of ['`/shepherd`', 'handoff-pr<number>', 'merge-pr<number>']) {
      expect(retrospective).toContain(term)
    }
  })

  it('keeps project rules in organize-github-issues and taxonomy review linked to them', async () => {
    const [organize, taxonomy, distill, sweep] = await Promise.all([
      readSkill('organize-github-issues'),
      readSkill('review-github-issue-taxonomy'),
      readSkill('retrospective-distill'),
      readSkill('triage-sweep'),
    ])
    const normalizedOrganize = organize.replaceAll(/\s+/g, ' ')
    const normalizedTaxonomy = taxonomy.replaceAll(/\s+/g, ' ')

    expect(organize).toMatch(/existing labels[\s\S]*without requesting separate label approval/i)
    expect(normalizedOrganize).toMatch(/\[Projects and milestones\]\(#projects-and-milestones\)/)
    expect(normalizedOrganize).toMatch(
      /existing open project for strategic, initiative-level tracking.*milestone for repo-local release or sequencing.*not by how many repositories it touches.*can have both.*at most one project, and not every issue needs one/i,
    )
    expect(normalizedOrganize).toMatch(
      /project's automation could pull in.*skip the add and report the conflict.*re-read the project/i,
    )
    expect(normalizedOrganize).toMatch(
      /Missing project scope or permission skips the project step only/i,
    )
    expect(normalizedOrganize).toMatch(
      /project status that closes the issue unless closing is separately authorized.*Auto-close issue workflow/i,
    )
    expect(normalizedOrganize).toMatch(
      /plan issue takes its source's milestone.*exactly one accessible open membership exists.*skip the project and report the conflict/i,
    )
    expect(taxonomy).toMatch(/Before creating a label[\s\S]*explicit approval/i)
    expect(normalizedTaxonomy).toMatch(
      /duplicated across repositories is a candidate project.*only routine, non-initiative work is a candidate milestone.*Repository count is not the signal/i,
    )
    expect(taxonomy).toMatch(/auto-add of a parent issue's sub-issues/i)
    expect(taxonomy).toContain('(../organize-github-issues/SKILL.md#projects-and-milestones)')
    expect(distill).toMatch(/labels, milestones, projects/i)
    expect(distill).toContain('`github-issue` skill (`skills` plugin)')
    expect(sweep.replaceAll(/\s+/g, ' ')).toMatch(/exact existing `follow-up` label/)
    for (const skill of [organize, taxonomy, distill]) {
      expect(skill).not.toMatch(/filaments|voucha|jonathanong|vouchington\//i)
    }
  })
})
