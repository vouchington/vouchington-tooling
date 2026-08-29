import { mkdtemp, mkdir, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { linkSkill, readSkillManifest } from './index.mts'

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
      join(sourceRoot, 'agent-workflow'),
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
    await expect(linkSkill({ name: 'unknown', sourceRoot, targetRoot })).rejects.toThrow(
      'Unknown skill',
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
})
