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
const pluginRoot = fileURLToPath(new URL('../../../plugins', import.meta.url))
const skillsRoot = fileURLToPath(new URL('../skills', import.meta.url))
const seenSkills = new Set()
const skills = []
for (const pluginName of ['vouchington-workflow', 'vouchington-testing', 'vouchington-database']) {
  const source = join(pluginRoot, pluginName)
  const manifest = JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8'))
  for (const skill of await readdir(join(source, 'skills'), { withFileTypes: true })) {
    if (!skill.isDirectory()) continue
    if (seenSkills.has(skill.name)) throw new Error(`Duplicate skill: ${skill.name}`)
    seenSkills.add(skill.name)
    await cp(join(source, 'skills', skill.name), join(skillsRoot, skill.name), { recursive: true })
    skills.push({
      name: skill.name,
      plugin: pluginName,
      pluginVersion: manifest.version,
      path: `${skill.name}/SKILL.md`,
    })
  }
}
skills.sort((left, right) => left.name.localeCompare(right.name))
await writeFile(
  join(skillsRoot, 'manifest.json'),
  `${JSON.stringify({ version: 1, skills }, null, 2)}\n`,
)
await chmod(new URL('../dist/cli/index.mjs', import.meta.url), 0o755)
