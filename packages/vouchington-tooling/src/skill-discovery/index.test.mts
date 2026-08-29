import { mkdtemp, mkdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { linkSkill, readSkillManifest } from './index.mts'
import { createDirectoryLink } from './link.mts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (path) => rm(path, { force: true, recursive: true })),
  )
})

async function fixture(): Promise<{ sourceRoot: string; targetRoot: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'vouchington-skill-discovery-'))
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

  it('falls back to a Windows junction when directory symlink creation needs privileges', async () => {
    const calls: Array<{ source: string; path: string; type: string }> = []
    await createDirectoryLink(
      '/source',
      '/target',
      async (source, path, type) => {
        calls.push({ source, path, type })
        if (type === 'dir') throw Object.assign(new Error('permission denied'), { code: 'EPERM' })
      },
      'win32',
    )
    expect(calls).toEqual([
      { source: '/source', path: '/target', type: 'dir' },
      { source: '/source', path: '/target', type: 'junction' },
    ])
    await expect(
      createDirectoryLink(
        '/source',
        '/target',
        async () => {
          throw Object.assign(new Error('permission denied'), { code: 'EPERM' })
        },
        'darwin',
      ),
    ).rejects.toThrow('permission denied')
    await expect(
      createDirectoryLink(
        '/source',
        '/target',
        async () => {
          throw Object.assign(new Error('missing source'), { code: 'ENOENT' })
        },
        'win32',
      ),
    ).rejects.toThrow('missing source')
    await expect(
      createDirectoryLink(
        '/source',
        '/target',
        async () => {
          throw new Error('missing error code')
        },
        'win32',
      ),
    ).rejects.toThrow('missing error code')
  })

  it('rejects circular relative sibling prerequisites', async () => {
    const { sourceRoot, targetRoot } = await fixture()
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
    const { sourceRoot, targetRoot } = await fixture()
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
    await expect(linkSkill({ name: 'agent-workflow', sourceRoot, targetRoot })).rejects.toThrow(
      'Invalid skill source',
    )

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
    await expect(linkSkill({ name: 'agent-workflow', sourceRoot, targetRoot })).rejects.toThrow(
      'escapes root',
    )
  })

  it('rejects escaped or dangling skill sources before linking', async () => {
    const { sourceRoot, targetRoot } = await fixture()
    const outside = join(sourceRoot, '..', 'outside')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'SKILL.md'), '# Outside\n')
    await rm(join(sourceRoot, 'agent-workflow'), { force: true, recursive: true })
    await symlink(outside, join(sourceRoot, 'agent-workflow'), 'dir')
    await expect(linkSkill({ name: 'agent-workflow', sourceRoot, targetRoot })).rejects.toThrow(
      'escapes',
    )
    await rm(join(sourceRoot, 'agent-workflow'))
    await symlink(join(sourceRoot, 'missing'), join(sourceRoot, 'agent-workflow'), 'dir')
    await expect(linkSkill({ name: 'agent-workflow', sourceRoot, targetRoot })).rejects.toThrow(
      'Invalid skill source',
    )
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
})
