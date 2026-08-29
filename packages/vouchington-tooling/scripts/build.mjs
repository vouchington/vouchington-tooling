import { execFileSync } from 'node:child_process'
import { chmod, copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = new URL('..', import.meta.url)
const dist = new URL('../dist', import.meta.url)

await rm(dist, { recursive: true, force: true })
await rm(new URL('../skills', import.meta.url), { recursive: true, force: true })
execFileSync('tsc', ['--project', 'tsconfig.build.json'], {
  stdio: 'inherit',
  cwd: fileURLToPath(packageRoot),
})
await mkdir(new URL('../dist/runner-port-policy', import.meta.url), { recursive: true })
await copyFile(
  new URL('../src/runner-port-policy/runner-port-policy.json', import.meta.url),
  new URL('../dist/runner-port-policy/runner-port-policy.json', import.meta.url),
)
const skillsRoot = fileURLToPath(new URL('../skills', import.meta.url))
const plugins = [
  {
    name: 'vouchington-workflow',
    manifest: JSON.parse(
      await readFile(
        new URL('../../../plugins/vouchington-workflow/plugin.json', import.meta.url),
        'utf8',
      ),
    ),
    root: fileURLToPath(new URL('../../../plugins/vouchington-workflow/skills', import.meta.url)),
    skills: await readdir(
      new URL('../../../plugins/vouchington-workflow/skills', import.meta.url),
      {
        withFileTypes: true,
      },
    ),
  },
  {
    name: 'vouchington-testing',
    manifest: JSON.parse(
      await readFile(
        new URL('../../../plugins/vouchington-testing/plugin.json', import.meta.url),
        'utf8',
      ),
    ),
    root: fileURLToPath(new URL('../../../plugins/vouchington-testing/skills', import.meta.url)),
    skills: await readdir(new URL('../../../plugins/vouchington-testing/skills', import.meta.url), {
      withFileTypes: true,
    }),
  },
  {
    name: 'vouchington-database',
    manifest: JSON.parse(
      await readFile(
        new URL('../../../plugins/vouchington-database/plugin.json', import.meta.url),
        'utf8',
      ),
    ),
    root: fileURLToPath(new URL('../../../plugins/vouchington-database/skills', import.meta.url)),
    skills: await readdir(
      new URL('../../../plugins/vouchington-database/skills', import.meta.url),
      {
        withFileTypes: true,
      },
    ),
  },
]
const seenSkills = new Set()
const skills = []
for (const plugin of plugins) {
  for (const skill of plugin.skills) {
    if (!skill.isDirectory()) continue
    if (seenSkills.has(skill.name)) throw new Error(`Duplicate skill: ${skill.name}`)
    seenSkills.add(skill.name)
    await cp(join(plugin.root, skill.name), join(skillsRoot, skill.name), { recursive: true })
    skills.push({
      name: skill.name,
      plugin: plugin.name,
      pluginVersion: plugin.manifest.version,
      path: `${skill.name}/SKILL.md`,
    })
  }
}
skills.sort((left, right) => left.name.localeCompare(right.name))
await writeFile(
  new URL('../skills/manifest.json', import.meta.url),
  `${JSON.stringify({ version: 1, skills }, null, 2)}\n`,
)
await chmod(new URL('../dist/cli/index.mjs', import.meta.url), 0o755)
