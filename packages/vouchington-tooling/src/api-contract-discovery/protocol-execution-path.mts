import ts from '../contract-schema/typescript-api.mts'
import type { ProtocolCache } from './protocol-analysis-cache.mts'
import { isSupportedProtocolCallback } from './protocol-callback-invocation.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'

/** Proves execution up to an optional handler whose registered binding is already established. */
export function executableProtocolPath(
  node: ts.Node,
  checker: ts.TypeChecker,
  boundHandler?: ts.Node,
  cache?: ProtocolCache,
): boolean {
  if (!potentiallyExecuted(node)) return false
  let fn = enclosingFunction(node)
  while (fn && fn !== boundHandler) {
    if (!potentiallyExecuted(fn) || !isSupportedProtocolCallback(fn, checker, cache)) return false
    fn = enclosingFunction(fn)
  }
  return true
}
