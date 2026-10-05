import ts from '../contract-schema/typescript-api.mts'
import { visit } from './response-contract-route-analysis.mts'
import { sseWriteMutation, type SseWriteMutation } from './protocol-sse-write-mutations.mts'

export function collectSseInvocations(files: readonly ts.SourceFile[]) {
  const invocations: (ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression)[] = []
  const mutations: SseWriteMutation[] = []
  for (const file of files)
    visit(file, (node) => {
      if (
        ts.isCallExpression(node) ||
        ts.isNewExpression(node) ||
        ts.isTaggedTemplateExpression(node)
      )
        invocations.push(node)
      const mutation = sseWriteMutation(node)
      if (mutation) mutations.push(mutation)
    })
  return { invocations, mutations }
}
