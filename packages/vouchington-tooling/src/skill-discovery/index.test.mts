import {
  lstat,
  mkdtemp,
  mkdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { linkSkill, readSkillManifest } from './index.mts'
import {
  linkDirectoryEntry,
  resolveTargetDirectory,
  snapshotTargetDirectory,
} from './target-directory.mts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (path) => rm(path, { force: true, recursive: true })),
  )
})

async function fixture(): Promise<{ sourceRoot: string; targetRoot: string }> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'vouchington-skill-discovery-')))
  directories.push(directory)
  const sourceRoot = join(directory, 'source')
  const targetRoot = join(directory, 'target')
  await mkdir(join(sourceRoot, 'agent-workflow'), { recursive: true })
  await writeFile(join(sourceRoot, 'agent-workflow', 'SKILL.md'), '# Agent workflow\n')
  await writeFile(
    join(sourceRoot, 'manifest.json'),
    JSON.stringify({
      version: 1,
      skills: [
        {
          name: 'agent-workflow',
          plugin: 'workflow',
          pluginVersion: '1.0.0',
          path: 'agent-workflow/SKILL.md',
        },
      ],
    }),
  )
  return { sourceRoot, targetRoot }
}

describe('skill discovery', () => {
  it('reads the schema-v1 manifest and links a named skill within explicit roots', async () => {
    const { sourceRoot, targetRoot } = await fixture()
    await mkdir(targetRoot)
    await expect(readSkillManifest(sourceRoot)).resolves.toEqual({
      version: 1,
      skills: [
        {
          name: 'agent-workflow',
          plugin: 'workflow',
          pluginVersion: '1.0.0',
          path: 'agent-workflow/SKILL.md',
        },
      ],
    })
    await expect(
      linkSkill({ name: 'agent-workflow', sourceRoot, targetRoot }),
    ).resolves.toMatchObject({ created: true })
    await expect(readlink(join(targetRoot, 'agent-workflow'))).resolves.toBe(
      await realpath(join(sourceRoot, 'agent-workflow')),
    )
  })

  it('is idempotent only for the matching symlink and never overwrites paths', async () => {
    const { sourceRoot, targetRoot } = await fixture()
    await mkdir(targetRoot)
    await linkSkill({ name: 'agent-workflow', sourceRoot, targetRoot })
    await expect(
      linkSkill({ name: 'agent-workflow', sourceRoot, targetRoot }),
    ).resolves.toMatchObject({ created: false })
    const blocked = join(targetRoot, 'blocked')
    await mkdir(join(blocked, 'agent-workflow'), { recursive: true })
    await expect(
      linkSkill({ name: 'agent-workflow', sourceRoot, targetRoot: blocked }),
    ).rejects.toThrow('already exists')
    const mismatched = join(targetRoot, 'mismatched')
    await mkdir(mismatched, { recursive: true })
    await mkdir(join(sourceRoot, 'other'))
    await symlink(join(sourceRoot, 'other'), join(mismatched, 'agent-workflow'), 'dir')
    await expect(
      linkSkill({ name: 'agent-workflow', sourceRoot, targetRoot: mismatched }),
    ).rejects.toThrow('already exists')
    await expect(linkSkill({ name: 'unknown', sourceRoot, targetRoot })).rejects.toThrow(
      'Unknown skill',
    )
  })

  it('links transitive relative sibling prerequisites before the requested skill', async () => {
    const { sourceRoot, targetRoot } = await fixture()
    await mkdir(targetRoot)
    const skills = [
      ['test-authoring', '# Test authoring\n'],
      ['vitest-test-authoring', 'Apply [test authoring](../test-authoring/SKILL.md) first.\n'],
      [
        'backend-vitest-test-authoring',
        'Apply [Vitest authoring](../vitest-test-authoring/SKILL.md) first. Again, see [Vitest](../vitest-test-authoring/SKILL.md).\n',
      ],
    ] as const
    for (const [name, contents] of skills) {
      await mkdir(join(sourceRoot, name), { recursive: true })
      await writeFile(join(sourceRoot, name, 'SKILL.md'), contents)
    }
    await writeFile(
      join(sourceRoot, 'manifest.json'),
      JSON.stringify({
        version: 1,
        skills: [
          ...skills.map(([name]) => ({
            name,
            plugin: 'testing',
            pluginVersion: '1.0.0',
            path: `${name}/SKILL.md`,
          })),
          {
            name: 'agent-workflow',
            plugin: 'workflow',
            pluginVersion: '1.0.0',
            path: 'agent-workflow/SKILL.md',
          },
        ],
      }),
    )
    await linkSkill({ name: 'backend-vitest-test-authoring', sourceRoot, targetRoot })
    for (const [name] of skills) {
      await expect(readlink(join(targetRoot, name))).resolves.toBe(
        await realpath(join(sourceRoot, name)),
      )
    }
  })

  it('does not link into a root swapped for a directory link before its worker starts', async () => {
    const { sourceRoot, targetRoot } = await fixture()
    const source = await realpath(join(sourceRoot, 'agent-workflow'))
    await mkdir(targetRoot)
    const target = await resolveTargetDirectory(targetRoot)
    const moved = `${targetRoot}-moved`
    const victim = join(sourceRoot, '..', 'victim')
    await mkdir(victim)
    await expect(
      linkDirectoryEntry(source, target, 'agent-workflow', async () => {
        await rename(targetRoot, moved)
        await symlink(victim, targetRoot, 'dir')
      }),
    ).rejects.toThrow('Target root changed during skill linking')
    await expect(lstat(join(victim, 'agent-workflow'))).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(moved, { force: true, recursive: true })
  })

  it('rejects non-directory target snapshots and unexpected worker results', async () => {
    const { sourceRoot, targetRoot } = await fixture()
    const source = await realpath(join(sourceRoot, 'agent-workflow'))
    const victim = join(sourceRoot, '..', 'victim')
    const link = join(sourceRoot, '..', 'target-link')
    await mkdir(victim)
    await symlink(victim, link, 'dir')
    await expect(snapshotTargetDirectory(link)).rejects.toThrow('contains symlink')
    await writeFile(targetRoot, '')
    await expect(snapshotTargetDirectory(targetRoot)).rejects.toThrow('Invalid target root')
    const validTarget = join(sourceRoot, '..', 'valid-target')
    await mkdir(validTarget)
    const target = await resolveTargetDirectory(validTarget)
    await expect(
      linkDirectoryEntry(source, target, 'agent-workflow', undefined, async () => 'unexpected'),
    ).rejects.toThrow('invalid result')
  })

  it('rejects a target root swapped after the worker writes through its bound directory', async () => {
    const { sourceRoot, targetRoot } = await fixture()
    const source = await realpath(join(sourceRoot, 'agent-workflow'))
    await mkdir(targetRoot)
    const target = await resolveTargetDirectory(targetRoot)
    const moved = `${targetRoot}-moved`
    const victim = join(sourceRoot, '..', 'victim')
    await mkdir(victim)
    await expect(
      linkDirectoryEntry(source, target, 'agent-workflow', undefined, undefined, async () => {
        await rename(targetRoot, moved)
        await symlink(victim, targetRoot, 'dir')
      }),
    ).rejects.toThrow('Target root changed during skill linking')
    await expect(lstat(join(victim, 'agent-workflow'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(moved, 'agent-workflow'))).resolves.toMatchObject({
      isSymbolicLink: expect.any(Function),
    })
    await rm(moved, { force: true, recursive: true })
  })

  it('rejects circular relative sibling prerequisites', async () => {
    const { sourceRoot, targetRoot } = await fixture()
    await mkdir(targetRoot)
    for (const [name, prerequisite] of [
      ['first', 'second'],
      ['second', 'first'],
    ] as const) {
      await mkdir(join(sourceRoot, name), { recursive: true })
      await writeFile(
        join(sourceRoot, name, 'SKILL.md'),
        `Apply [${prerequisite}](../${prerequisite}/SKILL.md) first.\n`,
      )
    }
    await writeFile(
      join(sourceRoot, 'manifest.json'),
      JSON.stringify({
        version: 1,
        skills: ['first', 'second'].map((name) => ({
          name,
          plugin: 'workflow',
          pluginVersion: '1.0.0',
          path: `${name}/SKILL.md`,
        })),
      }),
    )
    await expect(linkSkill({ name: 'first', sourceRoot, targetRoot })).rejects.toThrow(
      'Circular skill prerequisite',
    )
  })

  it('rejects relative sibling prerequisites that are absent from the manifest', async () => {
    const { sourceRoot, targetRoot } = await fixture()
    await mkdir(targetRoot)
    await mkdir(join(sourceRoot, 'dependent'), { recursive: true })
    await writeFile(
      join(sourceRoot, 'dependent', 'SKILL.md'),
      'Apply [missing](../missing/SKILL.md) first.\n',
    )
    await writeFile(
      join(sourceRoot, 'manifest.json'),
      JSON.stringify({
        version: 1,
        skills: [
          {
            name: 'dependent',
            plugin: 'workflow',
            pluginVersion: '1.0.0',
            path: 'dependent/SKILL.md',
          },
        ],
      }),
    )
    await expect(linkSkill({ name: 'dependent', sourceRoot, targetRoot })).rejects.toThrow(
      'Missing prerequisite skill',
    )
  })

  it('rejects manifest paths that escape the supplied source root', async () => {
    const { sourceRoot } = await fixture()
    await writeFile(
      join(sourceRoot, 'manifest.json'),
      JSON.stringify({
        version: 1,
        skills: [
          { name: 'bad', plugin: 'workflow', pluginVersion: '1.0.0', path: '../bad/SKILL.md' },
        ],
      }),
    )
    await expect(readSkillManifest(sourceRoot)).rejects.toThrow('escapes')
  })

  it('rejects malformed manifests and absolute or non-file skill sources', async () => {
    const { sourceRoot } = await fixture()
    for (const invalid of [
      null,
      1,
      { version: 2, skills: [] },
      { version: 1, skills: null },
      { version: 1, skills: [null] },
      { version: 1, skills: [1] },
      {
        version: 1,
        skills: [{ name: '', plugin: 'workflow', pluginVersion: '1.0.0', path: 'x/SKILL.md' }],
      },
      {
        version: 1,
        skills: [{ name: 'x', plugin: 1, pluginVersion: '1.0.0', path: 'x/SKILL.md' }],
      },
    ]) {
      await writeFile(join(sourceRoot, 'manifest.json'), JSON.stringify(invalid))
      await expect(readSkillManifest(sourceRoot)).rejects.toThrow('Invalid skills manifest')
    }

    await writeFile(
      join(sourceRoot, 'manifest.json'),
      JSON.stringify({
        version: 1,
        skills: [
          {
            name: 'agent-workflow',
            plugin: 'workflow',
            pluginVersion: '1.0.0',
            path: join(sourceRoot, 'agent-workflow', 'SKILL.md'),
          },
        ],
      }),
    )
    await expect(readSkillManifest(sourceRoot)).rejects.toThrow('escapes')

    await writeFile(
      join(sourceRoot, 'manifest.json'),
      JSON.stringify({
        version: 1,
        skills: [
          {
            name: 'agent-workflow',
            plugin: 'workflow',
            pluginVersion: '1.0.0',
            path: 'agent-workflow/README.md',
          },
        ],
      }),
    )
    await expect(readSkillManifest(sourceRoot)).rejects.toThrow('Invalid skill source')

    await writeFile(
      join(sourceRoot, 'manifest.json'),
      JSON.stringify({
        version: 1,
        skills: [
          {
            name: 'missing',
            plugin: 'workflow',
            pluginVersion: '1.0.0',
            path: 'missing/SKILL.md',
          },
        ],
      }),
    )
    await expect(readSkillManifest(sourceRoot)).rejects.toThrow('Invalid skill source')

    await rm(join(sourceRoot, 'agent-workflow', 'SKILL.md'))
    await mkdir(join(sourceRoot, 'agent-workflow', 'SKILL.md'))
    await writeFile(
      join(sourceRoot, 'manifest.json'),
      JSON.stringify({
        version: 1,
        skills: [
          {
            name: 'agent-workflow',
            plugin: 'workflow',
            pluginVersion: '1.0.0',
            path: 'agent-workflow/SKILL.md',
          },
        ],
      }),
    )
    await expect(readSkillManifest(sourceRoot)).rejects.toThrow('Invalid skill source')
  })

  it('rejects escaped or dangling skill sources before linking', async () => {
    const { sourceRoot } = await fixture()
    const outside = join(sourceRoot, '..', 'outside')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'SKILL.md'), '# Outside\n')
    await rm(join(sourceRoot, 'agent-workflow'), { force: true, recursive: true })
    await symlink(outside, join(sourceRoot, 'agent-workflow'), 'dir')
    await expect(readSkillManifest(sourceRoot)).rejects.toThrow('escapes')
    await rm(join(sourceRoot, 'agent-workflow'))
    await symlink(join(sourceRoot, 'missing'), join(sourceRoot, 'agent-workflow'), 'dir')
    await expect(readSkillManifest(sourceRoot)).rejects.toThrow('Invalid skill source')
  })

  it('rejects unsafe skill names before they can escape the target root', async () => {
    const { sourceRoot, targetRoot } = await fixture()
    await expect(linkSkill({ name: '../agent-workflow', sourceRoot, targetRoot })).rejects.toThrow(
      'Invalid skill name',
    )
    await expect(linkSkill({ name: 'agent/workflow', sourceRoot, targetRoot })).rejects.toThrow(
      'Invalid skill name',
    )
  })

  it('validates unsafe transitive prerequisite names before creating a target', async () => {
    const { sourceRoot, targetRoot } = await fixture()
    await mkdir(join(sourceRoot, 'dependent'), { recursive: true })
    await mkdir(join(sourceRoot, 'prerequisite'), { recursive: true })
    await writeFile(
      join(sourceRoot, 'dependent', 'SKILL.md'),
      'Apply [prerequisite](../prerequisite/SKILL.md) first.\n',
    )
    await writeFile(join(sourceRoot, 'prerequisite', 'SKILL.md'), '# Prerequisite\n')
    await writeFile(
      join(sourceRoot, 'manifest.json'),
      JSON.stringify({
        version: 1,
        skills: [
          {
            name: 'dependent',
            plugin: 'workflow',
            pluginVersion: '1.0.0',
            path: 'dependent/SKILL.md',
          },
          {
            name: '../unsafe-prerequisite',
            plugin: 'workflow',
            pluginVersion: '1.0.0',
            path: 'prerequisite/SKILL.md',
          },
        ],
      }),
    )
    await expect(linkSkill({ name: 'dependent', sourceRoot, targetRoot })).rejects.toThrow(
      'Invalid skill name',
    )
    await expect(lstat(targetRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects duplicate manifest names and lexical or canonical paths', async () => {
    const { sourceRoot } = await fixture()
    await mkdir(join(sourceRoot, 'second'), { recursive: true })
    await writeFile(join(sourceRoot, 'second', 'SKILL.md'), '# Second\n')
    const entry = (name: string, path: string) => ({
      name,
      plugin: 'workflow',
      pluginVersion: '1.0.0',
      path,
    })
    for (const [entries, message] of [
      [
        [
          entry('agent-workflow', 'agent-workflow/SKILL.md'),
          entry('agent-workflow', 'second/SKILL.md'),
        ],
        'Duplicate skill name',
      ],
      [
        [
          entry('agent-workflow', 'agent-workflow/SKILL.md'),
          entry('second', 'agent-workflow/../agent-workflow/SKILL.md'),
        ],
        'Duplicate skill path',
      ],
    ] as const) {
      await writeFile(
        join(sourceRoot, 'manifest.json'),
        JSON.stringify({ version: 1, skills: entries }),
      )
      await expect(readSkillManifest(sourceRoot)).rejects.toThrow(message)
    }
    await symlink(join(sourceRoot, 'agent-workflow'), join(sourceRoot, 'alias'), 'dir')
    await writeFile(
      join(sourceRoot, 'manifest.json'),
      JSON.stringify({
        version: 1,
        skills: [
          entry('agent-workflow', 'agent-workflow/SKILL.md'),
          entry('alias', 'alias/SKILL.md'),
        ],
      }),
    )
    await expect(readSkillManifest(sourceRoot)).rejects.toThrow('Duplicate skill path')
  })

  it('rejects a symlinked target ancestor before it can escape the target root', async () => {
    const { sourceRoot, targetRoot } = await fixture()
    const outside = join(sourceRoot, '..', 'outside-target')
    const fileTarget = join(sourceRoot, '..', 'target-file')
    await mkdir(outside, { recursive: true })
    await mkdir(targetRoot)
    await symlink(outside, join(targetRoot, 'redirect'), 'dir')
    await expect(
      linkSkill({
        name: 'agent-workflow',
        sourceRoot,
        targetRoot: join(targetRoot, 'redirect', 'nested'),
      }),
    ).rejects.toThrow('Target root contains symlink')
    await expect(lstat(join(outside, 'nested'))).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(fileTarget, '')
    await expect(
      linkSkill({ name: 'agent-workflow', sourceRoot, targetRoot: fileTarget }),
    ).rejects.toThrow('Invalid target root')
    await expect(
      linkSkill({ name: 'agent-workflow', sourceRoot, targetRoot: join(targetRoot, 'missing') }),
    ).rejects.toThrow('Target root must exist')
  })
})
