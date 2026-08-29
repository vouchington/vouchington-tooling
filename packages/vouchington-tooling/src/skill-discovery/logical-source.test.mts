import {
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
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

describe('logical skill source roots', () => {
  it('validates explicit prerequisite declarations', async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'vouchington-manifest-prerequisites-')),
    )
    directories.push(root)
    await writeSkillStore(root, '# Skill\n')
    const manifestPath = join(root, 'manifest.json')
    const entry = (prerequisites: unknown) => ({
      name: 'agent-workflow',
      plugin: 'workflow',
      pluginVersion: '1.0.0',
      path: 'agent-workflow/SKILL.md',
      prerequisites,
    })
    for (const prerequisites of ['agent-workflow', [1]]) {
      await writeFile(manifestPath, JSON.stringify({ version: 1, skills: [entry(prerequisites)] }))
      await expect(readSkillManifest(root)).rejects.toThrow('Invalid skills manifest')
    }
    await writeFile(
      manifestPath,
      JSON.stringify({ version: 1, skills: [entry(['agent-workflow', 'agent-workflow'])] }),
    )
    await expect(readSkillManifest(root)).rejects.toThrow('Duplicate skill prerequisite')
    await writeFile(manifestPath, JSON.stringify({ version: 1, skills: [entry(['missing'])] }))
    await expect(readSkillManifest(root)).rejects.toThrow('Missing prerequisite skill')
    await writeFile(manifestPath, JSON.stringify({ version: 1, skills: [entry(['unsafe/name'])] }))
    await expect(readSkillManifest(root)).rejects.toThrow('Invalid skill prerequisite')
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        skills: [{ ...entry([]), name: '../unsafe-skill' }],
      }),
    )
    await expect(readSkillManifest(root)).rejects.toThrow('Invalid skill name')
  })

  it('deduplicates a shared explicit prerequisite during one linking operation', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'vouchington-shared-prerequisite-')))
    directories.push(root)
    const targetRoot = join(root, 'target')
    await writeSkillStore(root, '# Requested skill\n')
    for (const name of ['first', 'second', 'shared']) {
      await mkdir(join(root, name), { recursive: true })
      await writeFile(join(root, name, 'SKILL.md'), `# ${name}\n`)
    }
    await writeFile(
      join(root, 'manifest.json'),
      JSON.stringify({
        version: 1,
        skills: [
          skillEntry('agent-workflow', ['first', 'second']),
          skillEntry('first', ['shared']),
          skillEntry('second', ['shared']),
          skillEntry('shared', []),
        ],
      }),
    )
    await mkdir(targetRoot)

    await expect(
      linkSkill({ name: 'agent-workflow', sourceRoot: root, targetRoot }),
    ).resolves.toMatchObject({
      created: true,
    })
    for (const name of ['agent-workflow', 'first', 'second', 'shared']) {
      await expect(readlink(join(targetRoot, name))).resolves.toBe(join(root, name))
    }
  })

  it('validates canonical source containment but links the stable logical installed path', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'vouchington-logical-skills-')))
    directories.push(root)
    const sourceRoot = join(root, 'installed-skills')
    const firstStore = join(root, 'store-v1')
    const secondStore = join(root, 'store-v2')
    const targetRoot = join(root, 'target')
    await writeSkillStore(firstStore, '# First store\n')
    await writeSkillStore(secondStore, '# Second store\n')
    await symlink(firstStore, sourceRoot, 'dir')
    await mkdir(targetRoot)

    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        linkSkill({ name: 'agent-workflow', sourceRoot, targetRoot }),
      ),
    )
    expect(results.filter((result) => result.created)).toHaveLength(1)
    expect(await readlink(join(targetRoot, 'agent-workflow'))).toBe(
      join(sourceRoot, 'agent-workflow'),
    )

    await unlink(sourceRoot)
    await symlink(secondStore, sourceRoot, 'dir')
    await expect(readFile(join(targetRoot, 'agent-workflow', 'SKILL.md'), 'utf8')).resolves.toBe(
      '# Second store\n',
    )
    await expect(linkSkill({ name: 'agent-workflow', sourceRoot, targetRoot })).resolves.toEqual({
      created: false,
      path: join(targetRoot, 'agent-workflow'),
      source: join(sourceRoot, 'agent-workflow'),
    })
  })
})

async function writeSkillStore(root: string, contents: string): Promise<void> {
  await mkdir(join(root, 'agent-workflow'), { recursive: true })
  await writeFile(join(root, 'agent-workflow', 'SKILL.md'), contents)
  await writeFile(
    join(root, 'manifest.json'),
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
}

function skillEntry(name: string, prerequisites: string[]) {
  return {
    name,
    plugin: 'workflow',
    pluginVersion: '1.0.0',
    path: `${name}/SKILL.md`,
    prerequisites,
  }
}
