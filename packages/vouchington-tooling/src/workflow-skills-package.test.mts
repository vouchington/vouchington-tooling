import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { linkSkill } from './skill-discovery/index.mts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginRoots = ['vouchington-workflow'].map((plugin) =>
  resolve(packageRoot, '../../plugins', plugin, 'skills'),
)
type SkillManifest = {
  version: number
  skills: Array<{
    name: string
    plugin: string
    pluginVersion: string
    path: string
    prerequisites?: string[]
  }>
}

describe('workflow skills package contract', () => {
  // Builds and packs the full package before verifying its installed skill resources.
  it('ships canonical resources and links required skills without tracked copies', async () => {
    const output = realpathSync(mkdtempSync(resolve(tmpdir(), 'vouchington-skills-pack-')))
    try {
      const canonical = pluginRoots
        .flatMap((root) => skillPaths(root))
        .map((path) => `package/skills/${path}`)
        .sort()
      execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: packageRoot })
      expect(
        skillPaths(join(packageRoot, 'skills'))
          .map((path) => `package/skills/${path}`)
          .sort(),
      ).toEqual(canonical)
      execFileSync('pnpm', ['pack', '--pack-destination', output], { cwd: packageRoot })
      const tarball = join(
        output,
        readdirSync(output).find((name) => name.endsWith('.tgz'))!,
      )
      const packaged = tarPaths(gunzipSync(readFileSync(tarball)))
        .filter((path) => path.startsWith('package/skills/') && path.endsWith('/SKILL.md'))
        .sort()
      expect(packaged).toHaveLength(9)
      expect(packaged).toEqual(canonical)
      const resources = pluginRoots
        .flatMap((root) => skillPaths(root, root, false))
        .map((path) => `package/skills/${path}`)
        .sort()
      expect(
        tarPaths(gunzipSync(readFileSync(tarball)))
          .filter(
            (path) =>
              path.startsWith('package/skills/') &&
              !path.endsWith('/') &&
              path !== 'package/skills/manifest.json',
          )
          .sort(),
      ).toEqual(resources)
      const unpacked = join(output, 'unpacked')
      mkdirSync(unpacked)
      execFileSync('tar', ['-xzf', tarball, '-C', unpacked])
      const packedSkills = join(unpacked, 'package/skills')
      for (const root of pluginRoots) {
        for (const path of skillPaths(root, root, false)) {
          expect(readFileSync(join(packedSkills, path), 'utf8')).toBe(
            readFileSync(join(root, path), 'utf8'),
          )
        }
      }
      const manifest = JSON.parse(
        readFileSync(join(packageRoot, 'skill-manifest.json'), 'utf8'),
      ) as SkillManifest
      expect(manifest.version).toBe(1)
      expect(manifest.skills.map((skill) => `package/skills/${skill.path}`).toSorted()).toEqual(
        canonical,
      )
      expect(manifest.skills.map((skill) => skill.name)).toEqual(
        manifest.skills
          .map((skill) => skill.name)
          .toSorted((left, right) => left.localeCompare(right)),
      )
      const prerequisites = new Map(
        manifest.skills.map((skill) => [skill.name, skill.prerequisites ?? []]),
      )
      for (const [name, required, closure = required] of [
        ['organize-github-issues', []],
        ['retrospective-distill', []],
        ['review-github-issue-taxonomy', ['organize-github-issues']],
        ['triage-prs', ['pr-description', 'retrospective']],
        [
          'triage-sweep',
          ['triage-loop', 'triage-prs', 'organize-github-issues', 'retrospective-distill'],
          [
            'triage-loop',
            'triage-prs',
            'organize-github-issues',
            'retrospective-distill',
            'pr-description',
            'retrospective',
          ],
        ],
        ['triage-loop', []],
      ] as const) {
        expect(prerequisites.get(name)).toEqual(required)
        const targetRoot = join(output, name)
        mkdirSync(targetRoot)
        await linkSkill({ name, sourceRoot: packedSkills, targetRoot })
        expect(readdirSync(targetRoot).sort()).toEqual([name, ...closure].sort())
        for (const linked of [name, ...closure]) {
          expect(realpathSync(join(targetRoot, linked))).toBe(
            realpathSync(join(packedSkills, linked)),
          )
        }
      }
      expect(readFileSync(join(output, 'triage-prs/pr-description/SKILL.md'), 'utf8')).toBe(
        readFileSync(
          resolve(packageRoot, '../../plugins/vouchington-workflow/skills/pr-description/SKILL.md'),
          'utf8',
        ),
      )
      for (const skill of manifest.skills) {
        const pluginManifest = JSON.parse(
          readFileSync(resolve(packageRoot, '../../plugins', skill.plugin, 'plugin.json'), 'utf8'),
        ) as { version: string }
        expect(skill.pluginVersion).toBe(pluginManifest.version)
      }
      expect(readFileSync(join(packageRoot, 'skills/manifest.json'), 'utf8')).toBe(
        readFileSync(join(packageRoot, 'skill-manifest.json'), 'utf8'),
      )
      expect(
        execFileSync('git', ['ls-files', 'skills'], { cwd: packageRoot, encoding: 'utf8' }),
      ).toBe('')
    } finally {
      rmSync(output, { force: true, recursive: true })
    }
  }, 30_000)
})

function skillPaths(root: string, path = root, entrypointsOnly = true): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    if (entry.isDirectory()) return skillPaths(root, child, entrypointsOnly)
    return !entrypointsOnly || entry.name === 'SKILL.md'
      ? [relative(root, child).replaceAll('\\', '/')]
      : []
  })
}

function tarPaths(archive: Buffer): string[] {
  const paths: string[] = []
  for (let offset = 0; offset < archive.length;) {
    const name = archive
      .subarray(offset, offset + 100)
      .toString()
      .replace(/\0.*$/, '')
    if (!name) break
    const prefix = archive
      .subarray(offset + 345, offset + 500)
      .toString()
      .replace(/\0.*$/, '')
    const size = Number.parseInt(archive.subarray(offset + 124, offset + 136).toString(), 8)
    paths.push(prefix ? `${prefix}/${name}` : name)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return paths
}
