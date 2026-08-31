import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

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
    expect(codex.plugins).toHaveLength(4)
    expect((codex.plugins as Array<{ name: string }>).map(({ name }) => name)).toEqual([
      'security-triage',
      'vouchington-workflow',
      'vouchington-testing',
      'vouchington-database',
    ])
    expect(codex.plugins).toContainEqual(
      expect.objectContaining({
        name: 'security-triage',
        source: { source: 'local', path: './plugins/security-triage' },
      }),
    )
    expect(claude.name).toBe('vouchington')
    expect(claude.plugins).toHaveLength(4)
    expect((claude.plugins as Array<{ name: string }>).map(({ name }) => name)).toEqual([
      'security-triage',
      'vouchington-workflow',
      'vouchington-testing',
      'vouchington-database',
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
  const readSkill = (name: string): Promise<string> =>
    readFile(join(workflowPlugin, 'skills', name, 'SKILL.md'), 'utf8')

  it('uses one canonical skill source in every supported host manifest', async () => {
    const [codex, claude, agent] = await Promise.all([
      readJson(join(workflowPlugin, '.codex-plugin/plugin.json')),
      readJson(join(workflowPlugin, '.claude-plugin/plugin.json')),
      readJson(join(workflowPlugin, 'plugin.json')),
    ])

    for (const manifest of [codex, claude, agent]) {
      expect(manifest.name).toBe('vouchington-workflow')
      expect(manifest.version).toBe('0.6.2')
    }
    expect(codex.skills).toBe('./skills/')
    expect(claude.skills).toBe('./skills/')
    expect(agent.skills).toBe('./skills/')
    expect(agent.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json')
    await expect(access(join(workflowPlugin, '.grok-plugin/plugin.json'))).rejects.toThrow()
  })

  it('is listed in both marketplaces with portable skills and installation instructions', async () => {
    const skillNames = (await readdir(join(workflowPlugin, 'skills'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(skillNames).toEqual([
      'agent-workflow',
      'blackboard',
      'dependabot',
      'git-commit-checklist',
      'github-actions-authoring',
      'github-actions-checklist',
      'github-issue',
      'npm-publishing',
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
      expect(skill.replaceAll(/(?:AGENTS|CLAUDE)\.md/giu, '')).not.toMatch(/\b(?:claude|codex)\b/i)
      expect(skill).not.toMatch(/\.agents\/skills|\.github\/workflows\/RUNNERS|filaments|voucha/i)
      expect(skill).not.toMatch(
        /pr-shepherd|auto harness|agent hook|coverage (?:tooling|baseline)/i,
      )
      expect(skill).toMatch(/consumer\s+wrapper/i)
    }
    expect(skills[0]).toContain('every applicable')
    expect(skills[0]).not.toContain('assigned non-main worktree')
  })

  it('requires event-driven GitHub Actions authoring', async () => {
    const [skill, manifest] = await Promise.all([
      readSkill('github-actions-authoring'),
      readJson(join(root, 'packages/vouchington-tooling/skill-manifest.json')),
    ])
    const skills = manifest.skills as Array<Record<string, unknown>>

    expect(skill).toContain('Never poll in CI')
    expect(skill).toContain('event-driven')
    expect(skill).toContain('workflow_call')
    expect(skill).toContain('workflow_run')
    expect(skill).toContain('repository_dispatch')
    expect(skill).toContain('needs.<job>.result')
    expect(skill).toContain('default branch')
    expect(skill).toContain('three')
    expect(skill).toContain('external callback')
    expect(skill).toMatch(/repository_dispatch[\s\S]*default branch/)
    expect(skill).toMatch(/bounded retries/i)
    expect(skill).toMatch(/local process readiness/i)
    expect(skills).toContainEqual(
      expect.objectContaining({
        name: 'github-actions-authoring',
        plugin: 'vouchington-workflow',
        pluginVersion: '0.6.2',
        prerequisites: ['github-actions-checklist'],
      }),
    )
  })

  it('defines a portable fail-closed Dependabot policy', async () => {
    const [skill, manifest] = await Promise.all([
      readSkill('dependabot'),
      readJson(join(root, 'packages/vouchington-tooling/skill-manifest.json')),
    ])
    const skills = manifest.skills as Array<Record<string, unknown>>
    const exampleSource = skill.match(
      /## Group package families\r?\n[\s\S]*?```yaml\r?\n([\s\S]*?)\r?\n```/,
    )?.[1]
    if (!exampleSource) throw new Error('Dependabot package-family YAML example is missing')
    const example = parse(exampleSource) as {
      cooldown?: { exclude?: string[] }
      groups?: Record<
        string,
        { 'applies-to'?: string; patterns?: string[]; 'update-types'?: string[] }
      >
    } | null
    const normalized = skill.replaceAll(/\s+/g, ' ')

    expect(skill).toContain('open-pull-requests-limit')
    expect(skill).toContain('security-updates')
    expect(skill).toContain('minor')
    expect(skill).toContain('patch')
    expect(skill).toContain('major')
    expect(skill).toContain('OIDC')
    expect(skill).toContain('DEPENDABOT_AUTOMERGE_TOKEN')
    expect(skill).toContain('pull_request_target')
    expect(skill).toContain('consumer wrapper')
    expect(example?.groups).toEqual({
      'first-party': { patterns: ['@acme/*', 'acme-cli'] },
      oxc: { patterns: ['oxlint', 'oxfmt', 'oxlint-tsgolint'] },
      vitest: { patterns: ['vitest', '@vitest/*', '@vitejs/*'] },
      react: { patterns: ['react', 'react-dom'] },
      'react-security': {
        'applies-to': 'security-updates',
        patterns: ['react', 'react-dom'],
      },
      'react-email': { patterns: ['react-email', '@react-email/*'] },
    })
    expect(example?.cooldown?.exclude).toEqual(example?.groups?.['first-party']?.patterns)
    const patterns = Object.values(example?.groups ?? {}).flatMap((group) => group.patterns ?? [])
    expect(patterns).toContain('@vitest/*')
    expect(patterns).toContain('@react-email/*')
    expect(patterns).not.toContain('*')
    for (const [name, group] of Object.entries(example?.groups ?? {})) {
      expect(name).not.toMatch(
        /(?:^|-)minor-and-patch$|^(?:security(?:-updates)?|all-patches|version-updates)$/,
      )
      expect(group).not.toHaveProperty('update-types')
    }
    expect(normalized).toMatch(/omit `update-types`[^.]*major, minor, and patch/i)
    expect(normalized).toMatch(/first-party.*?`cooldown\.exclude`[^.]*zero-day/i)
    expect(skills).toContainEqual(
      expect.objectContaining({
        name: 'dependabot',
        plugin: 'vouchington-workflow',
        pluginVersion: '0.6.2',
        prerequisites: ['github-actions-checklist'],
      }),
    )
  })

  it('hands npm bootstrap mutations to a human with resolved working-directory and OTP prompts', async () => {
    const skill = await readSkill('npm-publishing')
    const cd = skill.indexOf('cd /absolute/repository/root')
    const publish = skill.indexOf('npm publish ./relative/package-directory --access public --otp=')
    const trust = skill.indexOf('npm trust github @scope/package')

    expect(skill).toContain('Do not run a real `npm publish` or a mutating `npm trust` subcommand')
    expect(skill).toContain('npm publish <package-directory> --access public --dry-run')
    expect(skill).toContain('must include `prepublishOnly`')
    expect(skill.match(/--otp=$/gm)).toHaveLength(2)
    expect(cd).toBeGreaterThan(-1)
    expect(publish).toBeGreaterThan(cd)
    expect(trust).toBeGreaterThan(publish)
    expect(skill).toContain('--allow-publish')
    expect(skill).toContain('Omit the initial publish command')
    expect(skill).toContain('npm trust list <package-name>')
    expect(skill).toContain('`id-token: write`')
    expect(skill).toContain('consumer wrapper')
  })

  it('defines portable GitHub Actions policy without freezing dependency updates', async () => {
    const skill = await readSkill('github-actions-checklist')
    const normalized = skill.replaceAll(/\s+/g, ' ')

    expect(skill).toMatch(/`pull_request`[\s\S]*private repositories?/i)
    expect(skill).toMatch(/`pull_request_target`[\s\S]*untrusted pull-request content/i)
    expect(skill).toMatch(/30 minutes/i)
    expect(skill).toMatch(/GitHub-hosted runners?[\s\S]*public repositories?/i)
    expect(skill).toMatch(
      /repository-backed external `uses:` reference[\s\S]*40-character Git SHA/i,
    )
    expect(skill).toMatch(/machine-maintainable\s+version[\s\S]*# v4\.2\.0/i)
    expect(skill).toMatch(/`docker:\/\/\.\.\.` actions[\s\S]*`@sha256:` image digest/i)
    expect(skill).toMatch(/Dependabot/i)
    expect(skill).toMatch(/tests?[\s\S]*must not assert[^\n]*exact SHA or version/i)
    expect(skill).toMatch(/exact source revision[\s\S]*`with\.ref`/i)
    expect(skill).toMatch(/required job or check name[\s\S]*fan-in/i)
    expect(skill).toMatch(/underlying phase[\s\S]*deadline of no more than 30 minutes/i)
    expect(skill).toMatch(/must not hide a longer-running[\s\S]*another service/i)
    expect(skill).toMatch(/top-level `jobs\.<job_id>\.uses`[\s\S]*cannot accept `timeout-minutes`/i)
    expect(normalized).toMatch(/required checks?.*actual workflow jobs?/i)
    expect(normalized).toMatch(/must not (create|publish|synthesize).*check (runs?|statuses?)/i)
    expect(normalized).toMatch(/main.*test jobs?.*domain/i)
    expect(normalized).toMatch(/pull requests?.*cancel-in-progress/i)
    expect(normalized).toMatch(/main.*cancel-in-progress: false/i)
    expect(normalized).toMatch(/older pending main run.*newest pending revision/i)
    expect(normalized).toMatch(/preserving every intermediate queued revision is not required/i)
  })

  it('defines evidence-backed persistent-workspace prevention and recovery policy', async () => {
    const [checklist, authoring, logs, analysis] = await Promise.all([
      readSkill('github-actions-checklist'),
      readSkill('github-actions-authoring'),
      readSkill('review-ci-logs'),
      readSkill('static-analysis-checklist'),
    ])

    expect(checklist).toMatch(/full tree[\s\S]*sparse checkout/i)
    expect(checklist).toMatch(/writable workspace bind mount[\s\S]*non-root identity/i)
    expect(checklist).toMatch(/unconditional[\s\S]*pre-checkout[\s\S]*workspace-wide/i)
    expect(checklist).toMatch(/bounded known generated paths/i)
    expect(checklist).toMatch(
      /failure-gated[\s\S]*same-filesystem[\s\S]*directory-only[\s\S]*batched/i,
    )
    expect(authoring).toMatch(/YAML-aware[\s\S]*tracked workflow and action files/i)
    expect(authoring).toMatch(/non-root identity[\s\S]*whole workspace[\s\S]*before checkout/i)
    expect(logs).toMatch(/producer[\s\S]*sparse state or unsafe ownership/i)
    expect(logs).toMatch(/path-count and timing evidence/i)
    expect(analysis).toMatch(/parse YAML[\s\S]*tracked\s+configuration files/i)
    expect(analysis).toMatch(/sparse-checkout inputs[\s\S]*writable workspace mounts/i)
    expect(analysis).toMatch(/accepted and rejected fixtures/i)
  })

  it('keeps issue creation and taxonomy changes behind the portable safety contract', async () => {
    const [issue, organize, taxonomy, revisit, distill] = await Promise.all([
      readSkill('github-issue'),
      readSkill('organize-github-issues'),
      readSkill('review-github-issue-taxonomy'),
      readSkill('revisit-followups'),
      readSkill('retrospective-distill'),
    ])
    const normalizedIssue = issue.replaceAll(/\s+/g, ' ')

    expect(normalizedIssue).toMatch(/before every write.*canonical identity.*still match/i)
    expect(normalizedIssue).toMatch(
      /repository not to be archived.*issue operations.*issues.*enabled/i,
    )
    expect(normalizedIssue).toMatch(/`TRIAGE`, `WRITE`, `MAINTAIN`, or `ADMIN`/)
    expect(normalizedIssue).toMatch(/issue creation additionally requires `viewerCanCreateIssues`/i)
    expect(normalizedIssue).toMatch(
      /taxonomy definitions requires `WRITE`, `MAINTAIN`, or `ADMIN`/i,
    )
    expect(normalizedIssue).toMatch(/insufficient permission.*hard deny.*approval cannot override/i)
    expect(normalizedIssue).toMatch(/external creation target is denied.*tracking issue/i)
    expect(normalizedIssue).toMatch(/copy-ready report/i)
    expect(normalizedIssue).toMatch(/authorization to file the external issue.*tracking fallback/i)
    expect(normalizedIssue).toMatch(/refetch the destination repository.*issue-operation gate/i)
    expect(normalizedIssue).toMatch(
      /less-restricted destination.*remove private repository identity/i,
    )
    expect(normalizedIssue).toMatch(/If no tracker passes, return the draft without mutation/i)
    expect(normalizedIssue).toMatch(/before editing.*refetch the issue and its current discussion/i)
    expect(normalizedIssue).toMatch(/close only when.*acceptance evidence.*resolved/i)
    expect(normalizedIssue).toMatch(/matching existing labels.*without separate approval/i)
    expect(normalizedIssue).toMatch(/selected existing milestone.*without separate approval/i)
    expect(normalizedIssue).toMatch(/exact repository, name, description, and color/i)
    expect(normalizedIssue).toMatch(/PR creation authority remains separate/i)
    expect(normalizedIssue).toMatch(/native sub-issues only for real hierarchy/i)
    expect(normalizedIssue).toMatch(/preflight every entry before writing any issue/i)
    expect(organize).toMatch(/existing labels[\s\S]*without requesting separate label approval/i)
    expect(organize).toContain('[github-issue](../github-issue/SKILL.md)')
    expect(taxonomy).toMatch(/Before creating a label[\s\S]*explicit approval/i)
    expect(taxonomy).toContain('[github-issue](../github-issue/SKILL.md)')
    expect(revisit).toContain('[github-issue](../github-issue/SKILL.md)')
    expect(distill).toContain('[github-issue](../github-issue/SKILL.md)')
    for (const skill of [issue, organize, taxonomy, revisit, distill]) {
      expect(skill).not.toMatch(/filaments|voucha|jonathanong|vouchington\//i)
    }
  })
})
