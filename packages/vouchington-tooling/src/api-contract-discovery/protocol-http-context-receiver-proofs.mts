import ts from '../contract-schema/typescript-api.mts'
import { registeredContextApplication } from './protocol-http-context-application.mts'
import { createHttpContextPlatformMethodProof } from './protocol-http-context-platform-methods.mts'
import { createHttpContextExtensionLookup } from './protocol-http-context-extensions.mts'
import { createHttpContextWeakMembershipProof } from './protocol-http-context-weak-membership.mts'
import type { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'

/** Concrete receiver proofs share the selected registration and actual Program provenance. */
export function createHttpContextReceiverProofs(
  checker: ts.TypeChecker,
  sources: readonly ts.SourceFile[],
  options: ts.CompilerOptions,
  callbacks: ReturnType<typeof createProtocolCallbackValueResolver>,
) {
  const { platformMethod, applicationClass } = createHttpContextPlatformMethodProof(
    checker,
    sources,
    options,
  )
  const applications = new Map<
    ts.CallExpression,
    Map<ts.Symbol | undefined, ts.Symbol | undefined>
  >()
  const extensions = createHttpContextExtensionLookup(checker, sources, callbacks, applicationClass)
  const extension = (
    call: ts.CallExpression,
    context: ts.Symbol,
    root: ts.CallExpression,
    rootContext?: ts.Symbol,
  ) => {
    let selected = applications.get(root)
    if (!selected) applications.set(root, (selected = new Map()))
    if (!selected.has(rootContext))
      selected.set(rootContext, registeredContextApplication(root, checker, sources, rootContext))
    const application = selected.get(rootContext)
    return application ? extensions(call, context, application) : undefined
  }
  return {
    platformMethod,
    extension,
    weakMembership: createHttpContextWeakMembershipProof(checker, sources),
  }
}
