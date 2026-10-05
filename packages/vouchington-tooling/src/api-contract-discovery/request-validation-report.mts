import type ts from '../contract-schema/typescript-api.mts'

/** Collects facts once per originating AST node and fact; a repeat returns the fact reported. */
export function createReporter() {
  const reported = new Map<string, object>()
  const nodeIds = new Map<ts.Node, number>()
  const nodeId = (node: ts.Node | undefined) => {
    if (!node) return ''
    if (!nodeIds.has(node)) nodeIds.set(node, nodeIds.size)
    return nodeIds.get(node)
  }
  return <T extends object>(
    kind: string,
    target: T[],
    item: T,
    node?: ts.Node,
    identity: object = item,
  ) => {
    const key = `${kind}${nodeId(node)}${JSON.stringify(identity)}`
    const existing = reported.get(key) as T | undefined
    if (existing) return existing
    reported.set(key, item)
    target.push(item)
    return item
  }
}
