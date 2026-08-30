import type { SharedContext } from '../shared-context/index.mts'
import { checkDockerWorkspaceUserDocument } from './docker-workspace-user.mts'
import { ghaFileKind, loadWorkflowDocument } from './shared.mts'
import { checkNoSparseCheckoutDocument } from './sparse-checkout.mts'

export interface GhaWorkspacePolicyOptions {
  workflowDirectories?: readonly string[]
  actionDirectories?: readonly string[]
}

export async function checkGhaWorkspacePolicy(
  ctx: SharedContext,
  options: GhaWorkspacePolicyOptions = {},
): Promise<{ errors: string[] }> {
  const errors: string[] = []
  if (!ctx.isInsideGitRepo) return { errors }
  for (const file of ctx.trackedFiles) {
    const kind = ghaFileKind(file, options)
    if (!kind) continue
    const document = loadWorkflowDocument(ctx, file, errors)
    checkNoSparseCheckoutDocument(file, document, kind, errors)
    checkDockerWorkspaceUserDocument(file, document, kind, errors)
  }
  return { errors }
}
