// Plain JavaScript on purpose: the bin shims import this first, and it must parse and run on old
// Node releases so the version check can report a clear error before any TypeScript output loads.
const REQUIRED_MAJOR = 24

/** One stderr line when `found` is older than the supported Node, otherwise undefined. */
export function unsupportedNodeMessage(found = process.versions.node) {
  if (Number(found.split('.')[0]) >= REQUIRED_MAJOR) return undefined
  return `vouchington requires Node >=${REQUIRED_MAJOR} (found ${found})\n`
}
