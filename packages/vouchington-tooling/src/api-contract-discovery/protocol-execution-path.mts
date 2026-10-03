import ts from '../contract-schema/typescript-api.mts'
import { isSupportedProtocolCallback } from './protocol-callback-invocation.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'

/** Proves the node and every lexical callback ancestor can execute. */
export function executableProtocolPath(node: ts.Node, checker: ts.TypeChecker): boolean {
  if (!potentiallyExecuted(node)) return false
  let fn = enclosingFunction(node)
  while (fn) {
    if (!potentiallyExecuted(fn) || !isSupportedProtocolCallback(fn, checker)) return false
    fn = enclosingFunction(fn)
  }
  return true
}
