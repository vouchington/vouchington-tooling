import ts from '../contract-schema/typescript-api.mts'
import {
  isBodyRead,
  isHeaderGet,
  rootKind,
  type RootBindings,
} from './request-validation-origin.mts'
import type { Carrier } from './request-validation-types.mts'

/** The carrier a node reads directly from the request context, if it is such a read. */
export function requestOrigin(
  node: ts.Node,
  roots: RootBindings,
  checker: ts.TypeChecker,
): Carrier | undefined {
  const kind = ts.isExpression(node) ? rootKind(node, roots, checker) : undefined
  if (kind === 'query' || kind === 'path' || kind === 'header') return kind
  if (!ts.isCallExpression(node)) return undefined
  if (isBodyRead(node, roots, checker)) return 'body'
  return isHeaderGet(node, roots, checker) ? 'header' : undefined
}
