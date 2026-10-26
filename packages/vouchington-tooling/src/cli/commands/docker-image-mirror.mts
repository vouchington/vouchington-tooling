import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { checkDockerImageMirrors } from '../../docker-image-mirror/index.mts'
import { buildSharedContext, type SharedContext } from '../../shared-context/index.mts'
import { commandUsage } from '../usage.mts'

interface Dependencies {
  readonly buildContext?: (root: string) => Promise<SharedContext>
  readonly stdout?: Pick<NodeJS.WritableStream, 'write'>
  readonly stderr?: Pick<NodeJS.WritableStream, 'write'>
}

/**
 * `vouchington docker-image-mirror [--root <dir>] [--mirror <host>]`: prints each Docker Hub image
 * reference in tracked workflows, composite actions and Dockerfiles to stderr and exits 1; exits 2
 * on a usage error and 0 when every image comes from the mirror or another registry.
 */
export async function runDockerImageMirrorCommand(
  args: readonly string[],
  dependencies: Dependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  let values: {
    root?: string
    mirror?: string
    'allow-registry'?: string[]
    'require-digest'?: boolean
    'allow-ref-expression'?: string[]
  }
  try {
    values = parseArgs({
      args: [...args],
      allowPositionals: false,
      options: {
        root: { type: 'string' },
        mirror: { type: 'string' },
        'allow-registry': { type: 'string', multiple: true },
        'require-digest': { type: 'boolean' },
        'allow-ref-expression': { type: 'string', multiple: true },
      },
    }).values
  } catch (error) {
    stderr.write(`vouchington: ${(error as Error).message}\n${commandUsage('docker-image-mirror')}`)
    return 2
  }
  const allowRegistries = values['allow-registry']
  if (allowRegistries?.includes('')) {
    stderr.write(
      `vouchington: --allow-registry needs a non-empty prefix\n${commandUsage('docker-image-mirror')}`,
    )
    return 2
  }
  const allowRefExpressions = values['allow-ref-expression']
  if (allowRefExpressions?.includes('')) {
    stderr.write(
      `vouchington: --allow-ref-expression needs a non-empty value\n${commandUsage('docker-image-mirror')}`,
    )
    return 2
  }
  const root = resolve(values.root ?? process.cwd())
  const context = await (dependencies.buildContext ?? buildSharedContext)(root)
  if (!context.isInsideGitRepo) {
    stderr.write(`vouchington: ${root} is not inside a git repository\n`)
    return 1
  }
  const errors = checkDockerImageMirrors(context.repoRoot, context.trackedFiles, {
    mirror: values.mirror,
    allowRegistries,
    requireDigest: values['require-digest'],
    allowRefExpressions,
  })
  if (errors.length === 0) {
    stdout.write('Docker image mirror policy: ok\n')
    return 0
  }
  stderr.write(`${errors.join('\n')}\n`)
  return 1
}
