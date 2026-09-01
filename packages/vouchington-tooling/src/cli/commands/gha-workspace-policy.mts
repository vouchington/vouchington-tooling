import {
  checkGhaWorkspacePolicy,
  type GhaWorkspacePolicyOptions,
} from '../../gha-workspace-policy/index.mts'
import { buildSharedContext, type SharedContext } from '../../shared-context/index.mts'

export interface GhaWorkspacePolicyCliOptions extends GhaWorkspacePolicyOptions {
  readonly root?: string
}

interface Dependencies {
  readonly buildContext?: (root: string) => Promise<SharedContext>
  readonly check?: typeof checkGhaWorkspacePolicy
  readonly stderr?: NodeJS.WritableStream
}

export async function runGhaWorkspacePolicy(
  options: GhaWorkspacePolicyCliOptions,
  dependencies: Dependencies = {},
): Promise<number> {
  const context = await (dependencies.buildContext ?? buildSharedContext)(
    options.root ?? process.cwd(),
  )
  const result = await (dependencies.check ?? checkGhaWorkspacePolicy)(context, {
    ...(options.workflowDirectories === undefined
      ? {}
      : { workflowDirectories: options.workflowDirectories }),
    ...(options.actionDirectories === undefined
      ? {}
      : { actionDirectories: options.actionDirectories }),
  })
  if (result.errors.length === 0) return 0
  const stderr = dependencies.stderr ?? process.stderr
  stderr.write(`${result.errors.join('\n')}\n`)
  return 1
}
