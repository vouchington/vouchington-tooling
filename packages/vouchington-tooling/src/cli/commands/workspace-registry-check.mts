import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { buildSharedContext, type SharedContext } from '../../shared-context/index.mts'
import { checkRegistries, loadRegistryFiles } from '../../workspace-registry-check/index.mts'
import { commandUsage } from '../usage.mts'

interface Dependencies {
  readonly buildContext?: (root: string) => Promise<SharedContext>
  readonly stdout?: Pick<NodeJS.WritableStream, 'write'>
  readonly stderr?: Pick<NodeJS.WritableStream, 'write'>
}

/**
 * `vouchington workspace-registry-check [--root <dir>] [--syncpack-config <path>]
 * [--workspace-file <path>] [--path-filters <path>] [--tooling-group <name>]
 * [--trigger-only-glob <glob>] [--runtime-prefix <prefix>]`: prints one line per violation of the
 * package registries against tracked `package.json` manifests to stderr and exits 1; exits 2 on a
 * usage error and 0 when every registry covers every manifest.
 */
export async function runWorkspaceRegistryCheckCommand(
  args: readonly string[],
  dependencies: Dependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  let values
  try {
    values = parseArgs({
      args: [...args],
      allowPositionals: false,
      options: {
        root: { type: 'string' },
        'syncpack-config': { type: 'string', default: '.syncpackrc.json' },
        'workspace-file': { type: 'string', default: 'pnpm-workspace.yaml' },
        'path-filters': { type: 'string', default: '.github/ci-path-filters.yml' },
        'tooling-group': { type: 'string', default: 'tooling' },
        'trigger-only-glob': { type: 'string', default: '**/package.json' },
        'runtime-prefix': { type: 'string', default: 'runtime-' },
      },
    }).values
  } catch (error) {
    stderr.write(
      `vouchington: ${(error as Error).message}\n${commandUsage('workspace-registry-check')}`,
    )
    return 2
  }
  if (values['runtime-prefix'] === '') {
    stderr.write(
      `vouchington: --runtime-prefix needs a non-empty value\n${commandUsage('workspace-registry-check')}`,
    )
    return 2
  }
  const root = resolve(values.root ?? process.cwd())
  try {
    const context = await (dependencies.buildContext ?? buildSharedContext)(root)
    if (!context.isInsideGitRepo) {
      stderr.write(`vouchington: ${root} is not inside a git repository\n`)
      return 1
    }
    const syncpackConfig = values['syncpack-config']
    const workspaceFile = values['workspace-file']
    const files = loadRegistryFiles(context.repoRoot, {
      syncpackConfig,
      workspaceFile,
      pathFilters: values['path-filters'],
    })
    const violations = checkRegistries(context.trackedFiles, files, {
      syncpackConfig,
      workspaceFile,
      toolingGroup: values['tooling-group'],
      triggerOnlyGlob: values['trigger-only-glob'],
      runtimePrefix: values['runtime-prefix'],
    })
    if (violations.length === 0) {
      stdout.write('Workspace registry coverage: ok\n')
      return 0
    }
    stderr.write(`${violations.join('\n')}\n`)
    return 1
  } catch (error) {
    stderr.write(`vouchington: ${(error as Error).message}\n`)
    return 1
  }
}
