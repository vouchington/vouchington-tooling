import { execFileSync } from 'node:child_process'
import { chmod, copyFile, cp, mkdir, rm } from 'node:fs/promises'
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
await cp(
  new URL('../../../plugins/vouchington-workflow/skills', import.meta.url),
  new URL('../skills', import.meta.url),
  { recursive: true },
)
await chmod(new URL('../dist/cli/index.mjs', import.meta.url), 0o755)
