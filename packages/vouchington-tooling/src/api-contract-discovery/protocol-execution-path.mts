import ts from '../contract-schema/typescript-api.mts'
import { isSupportedProtocolCallback } from './protocol-callback-invocation.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'

/** Proves execution up to an optional handler whose registered binding is already established. */
export function executableProtocolPath(
  node: ts.Node,
  checker: ts.TypeChecker,
  boundHandler?: ts.Node,
): boolean {
  if (!potentiallyExecuted(node)) return false
  let fn = enclosingFunction(node)
  while (fn && fn !== boundHandler) {
    if (!potentiallyExecuted(fn) || !isSupportedProtocolCallback(fn, checker)) return false
    fn = enclosingFunction(fn)
  }
  return true
}
