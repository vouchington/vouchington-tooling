import { execFileSync } from 'node:child_process'
import { chmod, copyFile, cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import skillManifest from '../skill-manifest.json' with { type: 'json' }

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
const skillsRoot = fileURLToPath(new URL('../skills/', import.meta.url))
const seenSkills = new Set()
for (const skill of skillManifest.skills) {
  if (seenSkills.has(skill.name)) throw new Error(`Duplicate skill: ${skill.name}`)
  seenSkills.add(skill.name)
  await cp(join(pluginRoot, skill.plugin, 'skills', skill.name), join(skillsRoot, skill.name), {
    recursive: true,
  })
}
await copyFile(
  new URL('../skill-manifest.json', import.meta.url),
  new URL('../skills/manifest.json', import.meta.url),
)
await chmod(new URL('../dist/cli/index.mjs', import.meta.url), 0o755)
