import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const packageRoot = fileURLToPath(new URL('../', import.meta.url))

/** Real built entry points in an isolated consumer dependency graph, without installing packages. */
export async function optionalVitestConsumer(source: string, withVitest = false) {
  const directory = await mkdtemp(join(tmpdir(), 'optional-vitest-consumer-'))
  try {
    const target = join(directory, 'node_modules/vouchington-tooling')
    await mkdir(join(target, 'node_modules'), { recursive: true })
    await cp(join(packageRoot, 'dist'), join(target, 'dist'), { recursive: true })
    await cp(join(packageRoot, 'package.json'), join(target, 'package.json'))
    const manifest: {
      dependencies: Record<string, string>
      optionalDependencies: Record<string, string>
      peerDependencies: Record<string, string>
    } = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    for (const name of new Set([
      ...Object.keys(manifest.dependencies),
      ...Object.keys(manifest.optionalDependencies),
      ...Object.keys(manifest.peerDependencies).filter((name) => name !== 'vitest' || withVitest),
    ])) {
      const original = await realpath(join(packageRoot, 'node_modules', name))
      const installed = join(target, 'node_modules', name)
      await mkdir(dirname(installed), { recursive: true })
      await symlink(original, installed, 'dir')
    }
    return await execute(
      process.execPath,
      ['--no-global-search-paths', '--input-type=module', '--eval', source],
      {
        cwd: directory,
        timeout: 10000,
      },
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
